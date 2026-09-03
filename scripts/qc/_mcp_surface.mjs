#!/usr/bin/env node
/**
 * @fileoverview Shared MCP-surface exercise used by this branch's QC script.
 *
 * Drives the connector the way a real client does — dynamic client
 * registration, the consent-screen approval, the token exchange, then a full
 * JSON-RPC handshake — and asserts on what comes back. Split out of the
 * pr_<n>.mjs so the same flow can be pointed at the preview and at production
 * without duplicating 150 lines of OAuth.
 */
import { createHash } from "node:crypto";

import { getToken } from "../tokens.mjs";

const REDIRECT = "http://localhost:9999/cb";

/** The `remodel_access` cookie the app trusts: SHA-256 hex of WORKER_API_KEY. */
async function accessCookie() {
  const key = (await getToken("WORKER_API_KEY")).trim();
  return { key, cookie: `remodel_access=${createHash("sha256").update(key).digest("hex")}` };
}

/** One JSON-RPC round trip against an MCP streamable-HTTP endpoint. */
async function rpc(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // Streamable HTTP answers as SSE; the JSON payload is the `data:` line.
  const line = text.match(/^data: (.*)$/m);
  let json = null;
  try {
    json = JSON.parse(line ? line[1] : text);
  } catch {
    /* leave null — the caller reports the raw text */
  }
  return { status: res.status, sessionId: res.headers.get("mcp-session-id"), json, text };
}

/**
 * Full OAuth authorization-code flow against the deployed worker, using the
 * operator cookie to click through the consent screen. Returns the access token
 * plus `expiresIn` so the caller can assert the one-year lifetime.
 */
export async function oauthAccessToken(base) {
  const { cookie } = await accessCookie();
  const reg = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "qc-probe",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!reg.ok) throw new Error(`DCR failed: ${reg.status} ${await reg.text()}`);
  const client = await reg.json();

  const query = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    scope: "remodel",
    state: "qc",
  });
  const authorize = await fetch(`${base}/oauth/authorize?${query}`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: "decision=approve",
  });
  const location = authorize.headers.get("location");
  if (!location) throw new Error(`authorize did not redirect: ${authorize.status}`);
  const code = new URL(location).searchParams.get("code");

  const tok = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
    }),
  });
  const token = await tok.json();
  if (!token.access_token) throw new Error(`token exchange failed: ${JSON.stringify(token)}`);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    registrationClientUri: client.registration_client_uri,
  };
}

/** initialize + notifications/initialized + tools/list. Returns the tool names. */
export async function listTools(base, path, authHeader) {
  const url = `${base}${path}`;
  const init = await rpc(url, authHeader, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "qc-probe", version: "1" },
    },
  });
  if (init.status !== 200) {
    return { status: init.status, tools: null, error: init.text.slice(0, 200) };
  }
  const session = init.sessionId ? { "mcp-session-id": init.sessionId } : {};
  const headers = { ...authHeader, ...session };
  await rpc(url, headers, { jsonrpc: "2.0", method: "notifications/initialized" });

  const list = await rpc(url, headers, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  if (list.json?.error) {
    return { status: list.status, tools: null, error: JSON.stringify(list.json.error) };
  }
  const tools = list.json?.result?.tools ?? null;
  return {
    status: list.status,
    tools: tools ? tools.map((t) => t.name) : null,
    descriptionBytes: tools?.[0]?.description?.length ?? 0,
    error: tools ? null : list.text.slice(0, 200),
  };
}

/** Registry tool count as the public catalog reports it. */
export async function catalogToolCount(base) {
  const res = await fetch(`${base}/api/mcp-docs`);
  const body = await res.json();
  return body.toolCount ?? body.tools?.length ?? 0;
}

export { accessCookie };
