import type { Context, MiddlewareHandler } from "hono";

import { deleteCookie, setCookie } from "hono/cookie";

export const ACCESS_COOKIE_NAME = "remodel_access";
export const VISITOR_COOKIE_NAME = "remodel_visitor";

const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function getCookieValueFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.trim().split("=");
    if (rawKey !== name) {
      continue;
    }

    const value = rest.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

async function hashString(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getAccessCookieHash(env: Env): Promise<string> {
  const apiKey = (await env.WORKER_API_KEY.get())?.trim() || "";
  if (!apiKey) {
    return "";
  }
  return hashString(apiKey);
}

/**
 * Public accessor for the access-cookie value (SHA-256 of WORKER_API_KEY).
 *
 * Used by the MCP OAuth consent screen (0015) to set the same `remodel_access`
 * cookie the rest of the app trusts, from a raw `Response` rather than a Hono
 * context. Returns "" when WORKER_API_KEY is unset.
 */
export async function issueAccessCookieValue(env: Env): Promise<string> {
  return getAccessCookieHash(env);
}

/** Max-age (seconds) for the access cookie — shared with the OAuth consent UI. */
export const ACCESS_COOKIE_MAX_AGE = ACCESS_COOKIE_MAX_AGE_SECONDS;

export function getAccessCookieFromRequest(request: Request): string | null {
  return getCookieValueFromHeader(request.headers.get("cookie"), ACCESS_COOKIE_NAME);
}

export function getVisitorCookieFromRequest(request: Request): string | null {
  return getCookieValueFromHeader(request.headers.get("cookie"), VISITOR_COOKIE_NAME);
}

export async function isRequestAuthenticated(request: Request, env: Env): Promise<boolean> {
  const [cookieValue, expectedHash] = await Promise.all([
    Promise.resolve(getAccessCookieFromRequest(request)),
    getAccessCookieHash(env),
  ]);

  if (!cookieValue || !expectedHash) {
    return false;
  }

  return cookieValue === expectedHash;
}

export async function validatePasswordAgainstWorkerKey(
  password: string,
  env: Env,
): Promise<boolean> {
  const expected = (await env.WORKER_API_KEY.get())?.trim() || "";
  if (!expected || !password) {
    return false;
  }

  return password === expected;
}

export async function setAccessCookie(c: Context<{ Bindings: Env }>): Promise<void> {
  const hash = await getAccessCookieHash(c.env);
  if (!hash) {
    return;
  }

  const secure = c.req.url.startsWith("https://");

  setCookie(c, ACCESS_COOKIE_NAME, hash, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearAccessCookie(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, ACCESS_COOKIE_NAME, {
    path: "/",
  });
}

export function setVisitorCookie(c: Context<{ Bindings: Env }>, visitorId: string): void {
  const secure = c.req.url.startsWith("https://");
  setCookie(c, VISITOR_COOKIE_NAME, visitorId, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
  });
}

export const requireAccessAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const authenticated = await isRequestAuthenticated(c.req.raw, c.env);
  if (!authenticated) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return next();
};
