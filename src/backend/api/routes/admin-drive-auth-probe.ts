/**
 * @fileoverview One-shot check that domain-wide delegation actually covers
 * Drive. Deliberately hits BOTH a token mint and a real Drive read, because a
 * token can be issued and the API still refuse.
 *
 * Run this on a PREVIEW worker before trusting the scope change in production:
 * if Drive is not delegated, the token exchange fails and every Gmail call on
 * that worker fails with it.
 */
import { getGmailAccessToken } from "@backend/services/gmail/auth";
import { Hono } from "hono";

const ONBOARDING_ROOT = "1ZUJ_taFjsdWUusVZtng8ZzUAX5BFVMxU";

export const driveAuthProbeRouter = new Hono<{ Bindings: Env }>();

driveAuthProbeRouter.get("/", async (c) => {
  try {
    // getGmailAccessToken defaults to justin@126colby.com; the SA impersonates
    // that user via domain-wide delegation.
    const token = await getGmailAccessToken(c.env);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${ONBOARDING_ROOT}` +
        `?fields=id,name,mimeType&supportsAllDrives=true`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = await res.text();
    if (!res.ok) {
      return c.json({ ok: false, scopeGranted: true, error: `drive ${res.status}: ${body}` });
    }
    return c.json({ ok: true, scopeGranted: true, folder: JSON.parse(body) });
  } catch (err) {
    return c.json({
      ok: false,
      scopeGranted: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
