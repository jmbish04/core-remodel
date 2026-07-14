/**
 * @fileoverview MCP OAuth consent screen (`/oauth/authorize`).
 *
 * workers-oauth-provider auto-serves `/oauth/token`, `/oauth/register`, and the
 * two `.well-known` metadata docs, but delegates the *authorize* endpoint to
 * our default handler so we can render the login + consent UI. This module is
 * that handler.
 *
 * Flow (single operator — Justin):
 *   GET  /oauth/authorize?<oauth params>
 *     → not logged in  → password form (validates against WORKER_API_KEY)
 *     → logged in      → consent screen (Approve / Deny)
 *   POST /oauth/authorize?<oauth params>
 *     → password       → validate, set `remodel_access` cookie, re-render consent
 *     → approve        → OAUTH_PROVIDER.completeAuthorization(...) → 302 to client
 *     → deny           → 302 back to client with error=access_denied
 *
 * The original OAuth query string is preserved on the form `action` so
 * `parseAuthRequest` works identically on GET and POST.
 */
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import {
  ACCESS_COOKIE_MAX_AGE,
  ACCESS_COOKIE_NAME,
  isRequestAuthenticated,
  issueAccessCookieValue,
  validatePasswordAgainstWorkerKey,
} from "../utils/access";
import type { McpProps } from "./types";

/** The single full-parity scope this connector grants (0015 §0.5). */
const GRANTED_SCOPE = ["remodel"];
const GRANT_USER_ID = "justin";

/** env with the provider-injected OAuth helper binding. */
type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

function htmlResponse(body: string, extraHeaders?: Record<string, string>): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

/** Escape untrusted strings before interpolating into HTML. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Dark Monolith consent/login chrome. */
function page(inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect · 126 Colby Remodel MCP</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:#0a0a0b; color:#e7e7ea; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; }
  .card { width:min(420px,92vw); background:#141416; border-radius:16px; padding:32px;
    box-shadow:0 0 0 1px rgba(255,255,255,.06), 0 24px 60px rgba(0,0,0,.5); }
  h1 { font-size:19px; margin:0 0 4px; letter-spacing:-.01em; }
  p { color:#a1a1aa; margin:0 0 20px; font-size:13.5px; }
  .client { background:#1c1c1f; border-radius:10px; padding:12px 14px; margin:0 0 20px;
    font-size:13px; color:#d4d4d8; }
  .client b { color:#fff; }
  .scope { display:inline-block; background:#26262b; color:#c7c7cd; border-radius:6px;
    padding:2px 8px; font-size:12px; margin-top:8px; }
  input { width:100%; padding:11px 13px; border-radius:9px; border:0; margin:0 0 14px;
    background:#1c1c1f; color:#fff; font-size:14px; outline:2px solid transparent; }
  input:focus { outline-color:#5b7cfa; }
  .row { display:flex; gap:10px; }
  button { flex:1; padding:11px 14px; border-radius:9px; border:0; font-size:14px; font-weight:600;
    cursor:pointer; }
  .approve { background:#5b7cfa; color:#fff; }
  .deny { background:#26262b; color:#c7c7cd; }
  .err { background:#3a1417; color:#fca5a5; border-radius:8px; padding:8px 12px; font-size:13px; margin:0 0 14px; }
  .muted { color:#6b6b73; font-size:12px; margin-top:16px; }
</style></head><body><div class="card">${inner}</div></body></html>`;
}

function loginForm(actionQuery: string, error?: string): string {
  return page(`
    <h1>126 Colby Remodel</h1>
    <p>Enter the access password to connect this MCP client.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ""}
    <form method="POST" action="/oauth/authorize${actionQuery}">
      <input type="password" name="password" placeholder="Access password" autofocus required />
      <div class="row"><button class="approve" type="submit">Continue</button></div>
    </form>`);
}

function consentForm(actionQuery: string, req: AuthRequest, clientName: string): string {
  return page(`
    <h1>Connect to the remodel</h1>
    <p>An MCP client wants to access your 126 Colby remodel data.</p>
    <div class="client"><b>${esc(clientName)}</b><br/>
      <span class="scope">scope: remodel (full access)</span></div>
    <form method="POST" action="/oauth/authorize${actionQuery}">
      <div class="row">
        <button class="deny" name="decision" value="deny" type="submit">Deny</button>
        <button class="approve" name="decision" value="approve" type="submit">Approve</button>
      </div>
    </form>
    <p class="muted">Requested by client id <code>${esc(req.clientId)}</code></p>`);
}

/** Build the `Set-Cookie` header matching the app's access cookie. */
async function accessCookieHeader(env: Env, secure: boolean): Promise<string> {
  const value = await issueAccessCookieValue(env);
  const attrs = [
    `${ACCESS_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ACCESS_COOKIE_MAX_AGE}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Redirect back to the OAuth client with an error (e.g. access_denied). */
function denyRedirect(req: AuthRequest, code: string): Response {
  const url = new URL(req.redirectUri);
  url.searchParams.set("error", code);
  if (req.state) url.searchParams.set("state", req.state);
  return Response.redirect(url.toString(), 302);
}

/**
 * Handle `/oauth/authorize`. Returns a Response, or `null` if the path is not
 * the authorize endpoint (so the caller can fall through to normal routing).
 */
export async function handleOAuthAuthorize(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/oauth/authorize") return null;

  const oauth = (env as OAuthEnv).OAUTH_PROVIDER;
  const actionQuery = url.search; // preserve the original OAuth params on the form action
  const secure = url.protocol === "https:";

  let authReq: AuthRequest;
  try {
    authReq = await oauth.parseAuthRequest(request);
  } catch (err) {
    return htmlResponse(
      page(`<h1>Invalid request</h1><p>${esc(err instanceof Error ? err.message : "Bad OAuth request")}</p>`),
      undefined,
    );
  }

  const client = await oauth.lookupClient(authReq.clientId).catch(() => null);
  const clientName = client?.clientName || "Unknown MCP client";
  const authed = await isRequestAuthenticated(request, env);

  if (request.method === "GET") {
    return authed
      ? htmlResponse(consentForm(actionQuery, authReq, clientName))
      : htmlResponse(loginForm(actionQuery));
  }

  if (request.method === "POST") {
    const form = await request.formData();

    // Step 1: password submission (not yet authenticated).
    if (!authed) {
      const password = String(form.get("password") ?? "");
      const ok = await validatePasswordAgainstWorkerKey(password, env);
      if (!ok) return htmlResponse(loginForm(actionQuery, "Incorrect password."));
      // Set the cookie and re-render the consent screen (now authenticated).
      return htmlResponse(consentForm(actionQuery, authReq, clientName), {
        "set-cookie": await accessCookieHeader(env, secure),
      });
    }

    // Step 2: consent decision (authenticated).
    const decision = String(form.get("decision") ?? "");
    if (decision !== "approve") {
      return denyRedirect(authReq, "access_denied");
    }

    const props: McpProps = { userId: GRANT_USER_ID, scope: "remodel", kind: "oauth" };
    const { redirectTo } = await oauth.completeAuthorization({
      request: authReq,
      userId: GRANT_USER_ID,
      scope: GRANTED_SCOPE,
      metadata: { connectedAt: new Date().toISOString(), client: clientName },
      props,
    });
    return Response.redirect(redirectTo, 302);
  }

  return new Response("Method Not Allowed", { status: 405 });
}
