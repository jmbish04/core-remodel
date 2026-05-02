/**
 * @fileoverview Threads API routes for AI assistant conversations
 */

import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import type { Bindings, Variables } from "../index";

import { threads, messages } from "../../db/schema";
import { authMiddleware } from "../middleware/auth";

const threadsRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Apply auth middleware
threadsRouter.use("*", authMiddleware);

const createThreadSchema = z.object({
  title: z.string().min(1),
});

const createMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  metadata: z.string().optional(),
});

// GET /api/threads
threadsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;

  try {
    const userThreads = await db
      .select()
      .from(threads)
      .where(eq(threads.userId, userId))
      .orderBy(desc(threads.updatedAt));

    return c.json({ threads: userThreads });
  } catch (error) {
    console.error("Error fetching threads:", error);
    return c.json({ error: "Failed to fetch threads" }, 500);
  }
});

// POST /api/threads
threadsRouter.post("/", zValidator("json", createThreadSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;
  const { title } = c.req.valid("json");

  try {
    const result = await db
      .insert(threads)
      .values({
        userId,
        title,
      })
      .returning();

    return c.json({ thread: result[0] }, 201);
  } catch (error) {
    console.error("Error creating thread:", error);
    return c.json({ error: "Failed to create thread" }, 500);
  }
});

// GET /api/threads/:id
threadsRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;
  const threadId = parseInt(c.req.param("id"));

  try {
    const threadResult = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);

    if (threadResult.length === 0) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const thread = threadResult[0];

    if (thread.userId !== userId) {
      return c.json({ error: "Unauthorized" }, 403);
    }

    return c.json({ thread });
  } catch (error) {
    console.error("Error fetching thread:", error);
    return c.json({ error: "Failed to fetch thread" }, 500);
  }
});

// GET /api/threads/:id/messages
threadsRouter.get("/:id/messages", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;
  const threadId = parseInt(c.req.param("id"));

  try {
    // Verify thread ownership
    const threadResult = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);

    if (threadResult.length === 0 || threadResult[0].userId !== userId) {
      return c.json({ error: "Thread not found" }, 404);
    }

    const threadMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.createdAt);

    return c.json({ messages: threadMessages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return c.json({ error: "Failed to fetch messages" }, 500);
  }
});

// POST /api/threads/:id/messages
threadsRouter.post("/:id/messages", zValidator("json", createMessageSchema), async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;
  const threadId = parseInt(c.req.param("id"));
  const { role, content, metadata } = c.req.valid("json");

  try {
    // Verify thread ownership
    const threadResult = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);

    if (threadResult.length === 0 || threadResult[0].userId !== userId) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // Create message
    const result = await db
      .insert(messages)
      .values({
        threadId,
        role,
        content,
        metadata,
      })
      .returning();

    // Update thread's updatedAt
    await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));

    return c.json({ message: result[0] }, 201);
  } catch (error) {
    console.error("Error creating message:", error);
    return c.json({ error: "Failed to create message" }, 500);
  }
});

// DELETE /api/threads/:id
threadsRouter.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;
  const threadId = parseInt(c.req.param("id"));

  try {
    // Verify thread ownership
    const threadResult = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);

    if (threadResult.length === 0 || threadResult[0].userId !== userId) {
      return c.json({ error: "Thread not found" }, 404);
    }

    // Delete thread (messages will cascade delete)
    await db.delete(threads).where(eq(threads.id, threadId));

    return c.json({ message: "Thread deleted successfully" });
  } catch (error) {
    console.error("Error deleting thread:", error);
    return c.json({ error: "Failed to delete thread" }, 500);
  }
});

export { threadsRouter };
