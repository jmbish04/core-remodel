/**
 * @fileoverview Google Photos Picker API — Hono routes.
 *
 * Mounts at /api/google-photos (admin-only via requireAccessAuth in api/index.ts).
 *
 * The browser never talks to Google directly (Google's OAuth token stays
 * server-side and picked-media base URLs are CORS-restricted). This router:
 *   - runs the OAuth consent handshake (start + callback),
 *   - creates/polls picker sessions,
 *   - lists picked items, and
 *   - proxies (streams) the picked image bytes back to the browser as files.
 *
 * See the service in src/backend/services/google-photos/.
 */

import { Hono } from "hono";

import {
  buildConsentUrl,
  consumeStateNonce,
  createSession,
  createStateNonce,
  downloadItemBytes,
  exchangeCodeForTokens,
  getSession,
  isConnected,
  listMediaItems,
} from "@backend/services/google-photos";

const googlePhotosRouter = new Hono<{ Bindings: Env }>();

/** Request origin (scheme + host) used to build the OAuth redirect URI. */
function originOf(url: string): string {
  return new URL(url).origin;
}

/**
 * Minimal HTML returned to the OAuth popup on callback. It notifies the opener
 * window and closes itself. `ok` toggles the success/failure message.
 */
function callbackHtml(ok: boolean, message: string): string {
  const status = ok ? "connected" : "error";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Google Photos</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
</head><body>
<p>${ok ? "✅ Google Photos connected. You can close this window." : `⚠️ ${message}`}</p>
<script>
  try { window.opener && window.opener.postMessage({ source: "google-photos", status: "${status}" }, window.location.origin); } catch (e) {}
  setTimeout(function(){ window.close(); }, ${ok ? 400 : 2500});
</script>
</body></html>`;
}

/** GET /status — whether Google Photos is connected (a refresh token exists). */
googlePhotosRouter.get("/status", async (c) => {
  try {
    return c.json({ connected: await isConnected(c.env) });
  } catch (err) {
    return c.json({ connected: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** GET /auth/start — redirect the user (popup) to Google's consent screen. */
googlePhotosRouter.get("/auth/start", async (c) => {
  try {
    const state = await createStateNonce(c.env);
    const url = await buildConsentUrl(c.env, originOf(c.req.url), state);
    return c.redirect(url, 302);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/** GET /auth/callback — Google redirects here with ?code & ?state. */
googlePhotosRouter.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const oauthError = c.req.query("error");

  const html = (ok: boolean, msg: string) =>
    c.html(callbackHtml(ok, msg), ok ? 200 : 400);

  if (oauthError) return html(false, `Google returned: ${oauthError}`);
  if (!code) return html(false, "Missing authorization code.");
  if (!(await consumeStateNonce(c.env, state))) {
    return html(false, "Invalid or expired state. Please try connecting again.");
  }

  try {
    await exchangeCodeForTokens(c.env, originOf(c.req.url), code);
    return html(true, "");
  } catch (err) {
    return html(false, err instanceof Error ? err.message : "Token exchange failed.");
  }
});

/** POST /sessions — create a new picker session. */
googlePhotosRouter.post("/sessions", async (c) => {
  try {
    const session = await createSession(c.env);
    return c.json(session);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/** GET /sessions/:id — poll a session (mediaItemsSet flips true when done). */
googlePhotosRouter.get("/sessions/:id", async (c) => {
  try {
    const session = await getSession(c.env, c.req.param("id"));
    return c.json(session);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/** GET /sessions/:id/items — list picked items (metadata only, small payload). */
googlePhotosRouter.get("/sessions/:id/items", async (c) => {
  try {
    const items = await listMediaItems(c.env, c.req.param("id"));
    // Do not expose base URLs to the browser — bytes are proxied by index below.
    return c.json({
      items: items.map((it, index) => ({
        index,
        id: it.id,
        filename: it.filename,
        mimeType: it.mimeType,
      })),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/**
 * GET /sessions/:id/items/:index/bytes — stream one picked image's bytes.
 * Re-lists the session's items and streams the item at :index. The bearer token
 * stays server-side; the browser receives raw image bytes it can wrap in a File.
 */
googlePhotosRouter.get("/sessions/:id/items/:index/bytes", async (c) => {
  const index = Number.parseInt(c.req.param("index"), 10);
  if (!Number.isInteger(index) || index < 0) {
    return c.json({ error: "Invalid item index." }, 400);
  }
  try {
    const items = await listMediaItems(c.env, c.req.param("id"));
    const item = items[index];
    if (!item) return c.json({ error: "Item not found in session." }, 404);

    const { body, contentType, contentLength } = await downloadItemBytes(c.env, item.baseUrl);
    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${item.filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    });
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(body, { headers });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

export { googlePhotosRouter };
