/**
 * @fileoverview Notifications API routes
 */

import { notifications } from "@backend/db";
import { desc, eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import type { Variables } from "../index";

import { authMiddleware } from "../middleware/auth";

const notificationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply auth middleware
notificationsRouter.use("*", authMiddleware);

// GET /api/notifications
notificationsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;
  const unreadOnly = c.req.query("unreadOnly") === "true";

  try {
    const userNotifications = unreadOnly
      ? await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
          .orderBy(desc(notifications.createdAt))
          .limit(100)
      : await db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, userId))
          .orderBy(desc(notifications.createdAt))
          .limit(100);

    const unreadCount = userNotifications.filter((n) => !n.isRead).length;

    return c.json({
      notifications: userNotifications,
      unreadCount,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return c.json({ error: "Failed to fetch notifications" }, 500);
  }
});

// PUT /api/notifications/:id/read
notificationsRouter.put("/:id/read", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;
  const notificationId = parseInt(c.req.param("id"));

  try {
    // Verify ownership
    const notif = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .limit(1);

    if (notif.length === 0 || notif[0].userId !== userId) {
      return c.json({ error: "Notification not found" }, 404);
    }

    // Mark as read
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, notificationId));

    return c.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error updating notification:", error);
    return c.json({ error: "Failed to update notification" }, 500);
  }
});

// PUT /api/notifications/read-all
notificationsRouter.put("/read-all", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId")!;

  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

    return c.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error updating notifications:", error);
    return c.json({ error: "Failed to update notifications" }, 500);
  }
});

export { notificationsRouter };
