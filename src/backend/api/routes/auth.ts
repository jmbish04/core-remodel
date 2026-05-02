/**
 * @fileoverview Authentication API routes
 */

import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import type { Bindings } from "../index";

import { users, sessions } from "../../db/schema";

const authRouter = new Hono<{ Bindings: Bindings }>();

// Validation schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
});

// Simple password hashing (in production, use a proper library)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// POST /api/auth/register
authRouter.post("/register", zValidator("json", registerSchema), async (c) => {
  const { email, password, name } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  try {
    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existingUser.length > 0) {
      return c.json({ error: "User already exists" }, 400);
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const result = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        name,
      })
      .returning();

    const user = result[0];

    // Create session
    const token = generateToken();
    const expiresAt = new Date(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);

    await db.insert(sessions).values({
      userId: user.id,
      token,
      expiresAt,
    });

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Registration error:", error);
    return c.json({ error: "Registration failed" }, 500);
  }
});

// POST /api/auth/login
authRouter.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const db = drizzle(c.env.DB);

  try {
    // Find user
    const userResult = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (userResult.length === 0) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const user = userResult[0];

    // Verify password
    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Create session
    const token = generateToken();
    const expiresAt = new Date(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);

    await db.insert(sessions).values({
      userId: user.id,
      token,
      expiresAt,
    });

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json({ error: "Login failed" }, 500);
  }
});

// POST /api/auth/logout
authRouter.post("/logout", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "No token provided" }, 400);
  }

  const token = authHeader.substring(7);
  const db = drizzle(c.env.DB);

  try {
    await db.delete(sessions).where(eq(sessions.token, token));
    return c.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return c.json({ error: "Logout failed" }, 500);
  }
});

export { authRouter };
