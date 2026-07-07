import {
  homeownerMessages,
  images,
  roomMaterialQuotes,
  visitorEvents,
  visitorSessions,
} from "@backend/db";
import {
  getVisitorCookieFromRequest,
  isRequestAuthenticated,
  setVisitorCookie,
} from "@backend/utils/access";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const portalRouter = new Hono<{ Bindings: Env }>();

const ALLOWED_EVENT_TYPES = new Set(["page_view", "click", "page_exit"]);

function toIsoDate(value: Date | string | number | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function normalizePath(value: string | null | undefined): string {
  const raw = (value || "").trim();
  if (!raw) {
    return "/";
  }
  if (raw.startsWith("/")) {
    return raw;
  }
  return `/${raw}`;
}

async function listActiveHomeownerMessages(env: Env) {
  const db = drizzle(env.DB);
  const all = await db
    .select()
    .from(homeownerMessages)
    .orderBy(desc(homeownerMessages.datetimeCreated))
    .all();

  const now = Date.now();
  return all
    .filter((message) => {
      if (!message.isActive) {
        return false;
      }
      if (!message.expiresAt) {
        return true;
      }
      return new Date(message.expiresAt).getTime() > now;
    })
    .map((message) => ({
      ...message,
      datetimeCreated: toIsoDate(message.datetimeCreated),
      datetimeUpdated: toIsoDate(message.datetimeUpdated),
      expiresAt: toIsoDate(message.expiresAt),
    }));
}

portalRouter.get("/home", async (c) => {
  try {
    const db = drizzle(c.env.DB);

    const [activeMessages, recentImages] = await Promise.all([
      listActiveHomeownerMessages(c.env),
      db.select().from(images).orderBy(desc(images.datetimeCreated)).limit(24).all(),
    ]);

    const recentUpdates = recentImages.map((image) => ({
      id: image.id,
      displayName: image.displayName,
      roomType: image.roomType,
      photoCategory: image.photoCategory,
      datetimeCreated: toIsoDate(image.datetimeCreated),
    }));

    return c.json({
      success: true,
      audience: "contractor",
      navigationGuide: [
        {
          label: "Start with Listing Photos",
          href: "/photos/listing",
          description:
            "Review existing conditions room-by-room before discussing scope, sequence, and trade constraints.",
        },
        {
          label: "Check the Floor Plan",
          href: "/floor-plan",
          description:
            "Confirm room layout, dimensions, and adjacencies before scheduling work in a given area.",
        },
        {
          label: "Review Design Intent",
          href: "/photos/inspiration",
          description:
            "See the target look and finish notes attached to each inspirational reference image.",
        },
        {
          label: "Read Supporting Docs",
          href: "/supporting-docs",
          description:
            "Access permits, spec sheets, and shared documentation relevant to the current phase.",
        },
        {
          label: "Log Daily Progress",
          href: "/log/daily",
          description:
            "Post site updates, blockers, and photos so the homeowner can follow along day to day.",
        },
      ],
      recentUpdates,
      homeownerMessages: activeMessages,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load contractor home data",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

portalRouter.post("/messages", async (c) => {
  try {
    const authenticated = await isRequestAuthenticated(c.req.raw, c.env);
    if (!authenticated) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const body = (await c.req.json()) as {
      title?: string;
      message?: string;
      author?: string;
      expiresAt?: string | null;
    };

    const title = body.title?.trim();
    const message = body.message?.trim();
    const author = body.author?.trim() || "Homeowner";

    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }
    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    let expiresAt: Date | null = null;
    if (body.expiresAt && body.expiresAt.trim().length > 0) {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return c.json({ error: "Invalid expiration date" }, 400);
      }
      expiresAt = parsed;
    }

    const db = drizzle(c.env.DB);
    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(homeownerMessages)
      .values({
        id,
        title,
        message,
        author,
        isActive: true,
        expiresAt,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    const created = await db
      .select()
      .from(homeownerMessages)
      .where(eq(homeownerMessages.id, id))
      .get();

    return c.json({
      success: true,
      message: created,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to create homeowner message",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/portal/rooms/:roomId/quotes
 *
 * Lists material quotes for a single room — used by the room viewport inside
 * `ConstructionChecklistApp.tsx` to render the homeowner-vs-contractor ledger.
 */
portalRouter.get("/rooms/:roomId/quotes", async (c) => {
  const roomId = Number.parseInt(c.req.param("roomId"), 10);
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return c.json({ success: false, error: "Invalid roomId" }, 400);
  }

  try {
    const db = drizzle(c.env.DB);
    const quotes = await db
      .select()
      .from(roomMaterialQuotes)
      .where(eq(roomMaterialQuotes.roomId, roomId))
      .orderBy(desc(roomMaterialQuotes.datetimeCreated))
      .all();

    return c.json({
      success: true,
      quotes: quotes.map((quote) => ({
        ...quote,
        datetimeCreated: toIsoDate(quote.datetimeCreated),
        datetimeUpdated: toIsoDate(quote.datetimeUpdated),
      })),
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: "Failed to load room quotes",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

portalRouter.post("/track", async (c) => {
  try {
    const body = (await c.req.json()) as {
      sessionId?: string;
      eventType?: string;
      path?: string;
      element?: string;
      durationMs?: number;
      metadata?: unknown;
    };

    const eventType = (body.eventType || "").trim();
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return c.json({ error: "Unsupported eventType" }, 400);
    }

    const path = normalizePath(body.path);
    const sessionId = body.sessionId?.trim() || "";
    const eventId = crypto.randomUUID();
    const now = new Date();

    const request = c.req.raw;
    const existingVisitor = getVisitorCookieFromRequest(request);
    const visitorId = existingVisitor || crypto.randomUUID();

    const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
    const country = typeof cf?.country === "string" ? cf.country : null;
    const city = typeof cf?.city === "string" ? cf.city : null;
    const timezone = typeof cf?.timezone === "string" ? cf.timezone : null;

    const userAgent = c.req.header("user-agent") || null;
    const referrer = c.req.header("referer") || null;

    const db = drizzle(c.env.DB);
    const visitor = await db
      .select()
      .from(visitorSessions)
      .where(eq(visitorSessions.id, visitorId))
      .get();

    if (!visitor) {
      await db
        .insert(visitorSessions)
        .values({
          id: visitorId,
          firstPath: path,
          lastPath: path,
          firstReferrer: referrer,
          lastReferrer: referrer,
          userAgent,
          country,
          city,
          timezone,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .run();
    } else {
      await db
        .update(visitorSessions)
        .set({
          lastPath: path,
          lastReferrer: referrer,
          userAgent,
          country,
          city,
          timezone,
          lastSeenAt: now,
        })
        .where(eq(visitorSessions.id, visitorId))
        .run();
    }

    await db
      .insert(visitorEvents)
      .values({
        id: eventId,
        visitorId,
        sessionId,
        eventType,
        path,
        element: body.element?.trim() || null,
        durationMs:
          typeof body.durationMs === "number" && Number.isFinite(body.durationMs)
            ? Math.round(Math.max(0, body.durationMs))
            : null,
        referrer,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        datetimeCreated: now,
      })
      .run();

    if (!existingVisitor) {
      setVisitorCookie(c, visitorId);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        error: "Failed to track visitor event",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { portalRouter };
