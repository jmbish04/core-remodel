/**
 * @fileoverview Authentication middleware
 */

import type { Context, Next } from "hono";
import type { Variables } from "../index";

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.substring(7);

  try {
    const validToken = await c.env.WORKER_API_KEY.get();
    
    if (token !== validToken) {
      return c.json({ error: "Invalid session" }, 401);
    }

    // There is only 1 user in the system. Populate context to satisfy Variable types.
    c.set("userId", 1);
    c.set("user", {
      id: 1,
      email: "admin@local.host",
      name: "Admin",
    });

    await next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return c.json({ error: "Authentication failed" }, 500);
  }
}
