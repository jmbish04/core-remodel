import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { guestContacts } from "@backend/db";

/**
 * Vendor portal guest identity (0043).
 *
 * This is DELIBERATELY separate from the homeowner `remodel_access` cookie
 * (`utils/access.ts`). A `remodel_guest` cookie is an opaque uuid mapped to a
 * `guest_contacts` row; it identifies a vendor and unlocks the PUBLIC portal
 * surface (photos-only floor plan) — it grants ZERO homeowner/admin access.
 * Never conflate the two: a guest cookie must never satisfy `isRequestAuthenticated`.
 */

export const GUEST_COOKIE_NAME = "remodel_guest";
const GUEST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The public short domain the vendor portal is served on. */
export const GUEST_PORTAL_HOST = "remodel.hacolby.app";

/**
 * Hosts on which the `?_portal=1` testing override is IGNORED: the production
 * worker domain and the portal host itself. This stops a user-controlled query
 * param from forcing chrome-less/gate routing on production. The override stays
 * usable on preview workers (wcrp-*.workers.dev) and localhost so the portal can
 * be exercised where the custom domain doesn't resolve.
 */
const OVERRIDE_DISALLOWED_HOSTS = new Set([GUEST_PORTAL_HOST, "core-remodel.hacolby.workers.dev"]);

/**
 * Is this request for the vendor portal? True when it arrives on the portal
 * host, or carries a `_portal=1` override on a non-production host.
 */
export function isGuestPortalRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.hostname === GUEST_PORTAL_HOST) return true;
  if (url.searchParams.get("_portal") === "1" && !OVERRIDE_DISALLOWED_HOSTS.has(url.hostname)) {
    return true;
  }
  return false;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const [rawKey, ...rest] = pair.trim().split("=");
    if (rawKey === name) {
      const value = rest.join("=");
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export function getGuestCookieFromRequest(request: Request): string | null {
  return readCookie(request, GUEST_COOKIE_NAME);
}

export type GuestContact = typeof guestContacts.$inferSelect;

/**
 * Resolve the current guest from the `remodel_guest` cookie. Returns the
 * `guest_contacts` row, or null when there is no cookie / no matching row.
 * Read-only — does not touch `lastSeenAt` (page-view tracking, P3, owns that).
 */
export async function getGuestFromRequest(
  request: Request,
  env: Env,
): Promise<GuestContact | null> {
  const cookieId = getGuestCookieFromRequest(request);
  if (!cookieId) return null;
  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(guestContacts)
    .where(eq(guestContacts.cookieId, cookieId))
    .get();
  return row ?? null;
}

/** Has this request registered as a portal guest? */
export async function isGuestRegistered(request: Request, env: Env): Promise<boolean> {
  return (await getGuestFromRequest(request, env)) !== null;
}

/** Set the `remodel_guest` identity cookie to the given opaque id. */
export function setGuestCookie(c: Context<{ Bindings: Env }>, cookieId: string): void {
  const secure = c.req.url.startsWith("https://");
  setCookie(c, GUEST_COOKIE_NAME, cookieId, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
  });
}
