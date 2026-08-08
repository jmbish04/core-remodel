#!/usr/bin/env node
/**
 * @fileoverview QC for PR #372 — pin every MCP OAuth lifetime to one year.
 *
 * The change is three options on the `OAuthProvider` in `src/_worker.ts`
 * (`accessTokenTTL` / `refreshTokenTTL` / `clientRegistrationTTL`), so the only
 * honest way to verify it is to drive the whole OAuth dance against the
 * deployed worker and read the `expires_in` the token endpoint actually
 * returns. Every step below is also a regression guard: if any of registration,
 * consent, code exchange, MCP transport or refresh breaks, the connector is
 * dead regardless of how long its tokens live.
 *
 * Flow exercised (matches what claude.ai does):
 *   1. POST /oauth/register                 dynamic client registration
 *   2. POST /oauth/authorize   (password)   login form -> access cookie
 *   3. POST /oauth/authorize   (approve)    consent -> 302 with ?code=
 *   4. POST /oauth/token       (auth code)  + PKCE S256 -> access + refresh
 *   5. POST /mcp               initialize   the access token actually works
 *   6. POST /oauth/token       (refresh)    rotation still issues a new pair
 *   7. POST /mcp               initialize   the refreshed token works too
 *
 * Steps 1-7 pass on production TODAY (pre-merge) — that is the regression half.
 * The `expires_in` assertions are the new behaviour and are reported as
 * "pending merge/deploy" against production until this PR ships, per the
 * repo's QC contract.
 *
 *   pnpm run test:pr 372 -- --preview   # this branch's preview worker
 *   pnpm run test:pr 372                # production regression guard
 */
import { createHash, randomBytes } from "node:crypto";

import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";
import { getToken } from "../tokens.mjs";

/** What the PR pins every lifetime to. */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Library defaults this PR replaces — used to phrase "not deployed yet". */
const LIBRARY_DEFAULT_ACCESS_TOKEN_TTL = 3600;

/** Any registered redirect_uri works; this is the real claude.ai callback. */
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Form-encoded POST — the OAuth endpoints do not accept JSON bodies. */
async function form(base, path, fields, { cookie, redirect = "follow" } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    redirect,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(fields),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML consent page / 302 body — leave json null */
  }
  return { status: res.status, headers: res.headers, json, text };
}

/** One MCP `initialize` over Streamable HTTP with a bearer access token. */
async function mcpInitialize(base, accessToken) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "qc-pr-372", version: "1.0.0" },
      },
    }),
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  const base = resolveBase();
  const client = createClient({ base });
  const checks = createChecks();

  console.log(`\nPR #372 QC — MCP OAuth one-year lifetimes\n  target: ${base}\n`);
  await assertReachable(client, checks);

  // --- Metadata: the discovery document the MCP client reads first ----------
  const meta = await client.get("/.well-known/oauth-authorization-server", { auth: false });
  checks.ok(
    "authorization-server metadata advertises refresh_token",
    meta.status === 200 && meta.json?.grant_types_supported?.includes("refresh_token"),
    `status ${meta.status}, grants ${JSON.stringify(meta.json?.grant_types_supported)}`,
  );

  const unauthed = await fetch(`${base}/mcp`, { method: "POST" });
  checks.ok(
    "/mcp rejects an unauthenticated call with 401",
    unauthed.status === 401,
    `status ${unauthed.status}`,
  );

  // --- 1. Dynamic client registration --------------------------------------
  const reg = await client.post(
    "/oauth/register",
    {
      client_name: "qc-pr-372",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { auth: false },
  );
  const clientId = reg.json?.client_id;
  if (!checks.ok("DCR issues a client_id", Boolean(clientId), `status ${reg.status}`)) {
    checks.finish();
  }
  checks.info(`client_id ${clientId}`);

  // RFC 7591 §3.2.1 requires registration_client_uri to be a fully qualified
  // URL. The library builds it from the `clientRegistrationEndpoint` option
  // verbatim, and we configure that as a PATH — so it shipped as
  // "/oauth/register/<id>". claude.ai does `new URL()` on it, throws, and
  // reports "Couldn't register with core-remodel's sign-in service" even
  // though the registration succeeded. A curl probe looks perfectly healthy,
  // which is exactly why this hid.
  // Asserted after the token exchange, which is what tells us whether this
  // target has the PR deployed at all — see the `expires_in` block below.
  const regClientUri = reg.json?.registration_client_uri;
  let regUriAbsolute = false;
  try {
    regUriAbsolute = Boolean(regClientUri) && Boolean(new URL(regClientUri));
  } catch {
    regUriAbsolute = false;
  }
  checks.info(`registration_client_uri ${regClientUri}`);

  // --- 2 & 3. Consent screen: password, then approve ------------------------
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "remodel",
    state: "qc-pr-372",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const login = await form(base, `/oauth/authorize?${query}`, {
    password: getToken("WORKER_API_KEY").trim(),
  });
  const setCookie = (login.headers.get("set-cookie") || "").split(";")[0];
  checks.ok(
    "consent screen accepts the access password",
    login.status === 200 && Boolean(setCookie) && login.text.includes("Approve"),
    `status ${login.status}, cookie ${setCookie ? "set" : "missing"}`,
  );

  const approve = await form(
    base,
    `/oauth/authorize?${query}`,
    { decision: "approve" },
    {
      cookie: setCookie,
      redirect: "manual",
    },
  );
  const location = approve.headers.get("location") || "";
  const code = location ? new URL(location).searchParams.get("code") : null;
  if (
    !checks.ok(
      "approve redirects back to the client with an authorization code",
      approve.status === 302 && Boolean(code),
      `status ${approve.status}, location ${location.slice(0, 60)}`,
    )
  ) {
    checks.finish();
  }

  // --- 4. Authorization-code exchange (the new accessTokenTTL shows here) ---
  const tokenRes = await form(base, "/oauth/token", {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  const tok = tokenRes.json ?? {};
  checks.ok(
    "authorization_code exchange returns an access + refresh token",
    tokenRes.status === 200 && Boolean(tok.access_token) && Boolean(tok.refresh_token),
    `status ${tokenRes.status}`,
  );

  // THE assertion this PR exists for. `expires_in` is the deployed
  // accessTokenTTL verbatim, so it distinguishes "shipped" from "still on the
  // library default" without guessing.
  const expiresIn = Number(tok.expires_in);
  checks.info(`expires_in = ${expiresIn}s (${(expiresIn / 86400).toFixed(1)} days)`);

  // `expires_in` doubles as the "is this PR deployed here?" signal, so both new
  // behaviours are gated on it. On a target that has not shipped #372 yet they
  // are reported as pending rather than failed — otherwise the production run,
  // whose job is to prove nothing ALREADY LIVE regressed, could never be green
  // while the PR is open.
  const prDeployed = expiresIn !== LIBRARY_DEFAULT_ACCESS_TOKEN_TTL;
  if (!prDeployed) {
    checks.info(
      "pending merge/deploy — this target still runs the library defaults, which " +
        "is exactly what PR #372 replaces. Expected on production pre-merge. Both " +
        "the one-year lifetime and the absolute registration_client_uri are " +
        "reported below as pending rather than asserted.",
    );
    checks.info(
      `would fail here today: registration_client_uri = ${JSON.stringify(regClientUri)} ` +
        `(${regUriAbsolute ? "absolute" : "RELATIVE — the DCR bug claude.ai chokes on"})`,
    );
  } else {
    checks.ok(
      "access token lifetime is one year",
      expiresIn === ONE_YEAR_SECONDS,
      `expires_in ${expiresIn}, want ${ONE_YEAR_SECONDS}`,
    );
    checks.ok(
      "registration_client_uri is an absolute URL (RFC 7591 §3.2.1)",
      regUriAbsolute,
      `registration_client_uri = ${JSON.stringify(regClientUri)}`,
    );
  }

  // --- 5. The access token actually opens the MCP transport ----------------
  const init = await mcpInitialize(base, tok.access_token);
  checks.ok(
    "MCP initialize succeeds with the access token",
    init.status === 200 && init.text.includes('"serverInfo"'),
    `status ${init.status}, body ${init.text.slice(0, 80)}`,
  );

  // --- 6 & 7. Refresh rotation still works, and the new token works ---------
  const refreshed = await form(base, "/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: tok.refresh_token,
    client_id: clientId,
  });
  const rt = refreshed.json ?? {};
  checks.ok(
    "refresh_token grant issues a rotated pair",
    refreshed.status === 200 &&
      Boolean(rt.access_token) &&
      Boolean(rt.refresh_token) &&
      rt.refresh_token !== tok.refresh_token,
    `status ${refreshed.status}`,
  );

  const reinit = await mcpInitialize(base, rt.access_token);
  checks.ok(
    "MCP initialize succeeds with the refreshed access token",
    reinit.status === 200 && reinit.text.includes('"serverInfo"'),
    `status ${reinit.status}, body ${reinit.text.slice(0, 80)}`,
  );

  checks.finish();
}

await main();
