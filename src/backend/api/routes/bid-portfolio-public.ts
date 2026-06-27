import { BidPortfolioAgent } from "@backend/ai/agents/BidPortfolioAgent";
import {
  bidPortfolios,
  bidPortfolioRoomConfigs,
  bidPortfolioComments,
  companies,
  businessTypes,
  bidPortfolioSelectedPhotos,
  rooms,
  images,
  inspirationalImageRooms,
  budgetTrackerItems,
  budgetTrackerItemRooms,
  assumptionLineItems,
  remodelScenarios,
  scenarioRoomPlans,
  visitorSessions,
  visitorEvents,
  notifications,
  users,
} from "@backend/db";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getAgentByName } from "agents";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { Hono } from "hono";
import { getVisitorCookieFromRequest, setVisitorCookie } from "@backend/utils/access";

const bidPortfolioPublicRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExpired(portfolio: { expirationDate: Date | null; status: string }): boolean {
  if (portfolio.status === "archived" || portfolio.status === "expired") {
    return true;
  }
  if (portfolio.expirationDate && portfolio.expirationDate.getTime() < Date.now()) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Portfolio Data (Public)
// ---------------------------------------------------------------------------

/** GET /:token — fetch full portfolio data for public viewer */
bidPortfolioPublicRouter.get("/:token", async (c) => {
  try {
    const token = c.req.param("token")?.trim();
    if (!token) {
      return c.json({ error: "Token is required" }, 400);
    }

    const db = drizzle(c.env.DB);

    // Fetch portfolio by token
    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.token, token))
      .get();

    if (!portfolio) {
      return c.json({ error: "Portfolio not found" }, 404);
    }

    // Check expiration
    if (isExpired(portfolio)) {
      return c.json({ error: "This portfolio has expired" }, 410);
    }

    // Fetch company info (for businessType / role adaptation)
    const company = await db
      .select({
        company: companies,
        businessType: businessTypes,
      })
      .from(companies)
      .leftJoin(businessTypes, eq(companies.businessTypeId, businessTypes.id))
      .where(eq(companies.id, portfolio.companyId))
      .get();

    // Fetch room configs with joined room data
    const roomConfigRows = await db
      .select({
        config: bidPortfolioRoomConfigs,
        room: rooms,
      })
      .from(bidPortfolioRoomConfigs)
      .leftJoin(rooms, eq(bidPortfolioRoomConfigs.roomId, rooms.id))
      .where(eq(bidPortfolioRoomConfigs.portfolioId, portfolio.id))
      .orderBy(bidPortfolioRoomConfigs.sortOrder)
      .all();

    // Gather room IDs from configs
    const configuredRoomIds = roomConfigRows
      .map((r) => r.config.roomId)
      .filter((id): id is number => typeof id === "number");
      
    // Fetch selected photos for this portfolio
    const selectedPhotos = await db
      .select({
        selection: bidPortfolioSelectedPhotos,
        image: images
      })
      .from(bidPortfolioSelectedPhotos)
      .innerJoin(images, eq(bidPortfolioSelectedPhotos.imageId, images.id))
      .where(eq(bidPortfolioSelectedPhotos.portfolioId, portfolio.id))
      .orderBy(bidPortfolioSelectedPhotos.sortOrder)
      .all();

    // Fetch photos (listing photos) for configured rooms
    const allRoomImages =
      configuredRoomIds.length > 0
        ? await db
            .select()
            .from(images)
            .all()
            .then((all) => all.filter((img) => img.roomId !== null && configuredRoomIds.includes(img.roomId)))
        : [];

    // Fetch inspiration images for configured rooms
    const allInspirationMappings =
      configuredRoomIds.length > 0
        ? await db
            .select({
              mapping: inspirationalImageRooms,
              image: images,
            })
            .from(inspirationalImageRooms)
            .leftJoin(images, eq(inspirationalImageRooms.imageId, images.id))
            .all()
            .then((all) => all.filter((row) =>
              configuredRoomIds.includes(row.mapping.roomId) &&
              !row.image?.isDuplicate && !row.image?.isDeleted
            ))
        : [];

    // Build per-room image maps
    const photosByRoom = new Map<number, typeof allRoomImages>();
    for (const img of allRoomImages) {
      if (img.roomId === null) continue;
      const current = photosByRoom.get(img.roomId) || [];
      current.push(img);
      photosByRoom.set(img.roomId, current);
    }
    
    // Group selected photos by room
    const selectedPhotosByRoom = new Map<number, any[]>();
    for (const row of selectedPhotos) {
      if (row.selection.roomId === null) continue;
      const roomId = row.selection.roomId;
      const current = selectedPhotosByRoom.get(roomId) || [];
      // Combine image data with selection metadata (captionOverride)
      current.push({
        ...row.image,
        captionOverride: row.selection.captionOverride
      });
      selectedPhotosByRoom.set(roomId, current);
    }

    const inspirationByRoom = new Map<number, Array<typeof allInspirationMappings[number]>>();
    for (const row of allInspirationMappings) {
      const current = inspirationByRoom.get(row.mapping.roomId) || [];
      current.push(row);
      inspirationByRoom.set(row.mapping.roomId, current);
    }

    // Build enriched room configs
    const enrichedRoomConfigs = roomConfigRows.map((row) => {
      const roomId = row.config.roomId;
      // If there are selected photos for this room, use only those. Otherwise fallback to all photos if includePhotos is true.
      const hasSelectedPhotos = selectedPhotosByRoom.has(roomId);
      let photos = [];
      if (hasSelectedPhotos) {
        photos = selectedPhotosByRoom.get(roomId) || [];
      } else if (row.config.includePhotos) {
        photos = photosByRoom.get(roomId) || [];
      }
      
      return {
        ...row.config,
        room: row.room,
        photos,
        inspirationImages: row.config.includeInspiration
          ? (inspirationByRoom.get(roomId) || []).map((r) => r.image)
          : [],
      };
    });

    // Budget ranges (only if showBudgetRanges is true)
    let budgetData: {
      trackerItems: Array<Record<string, unknown>>;
      assumptionItems: Array<Record<string, unknown>>;
    } | null = null;

    if (portfolio.showBudgetRanges) {
      // Get active budget tracker items that relate to configured rooms
      const activeItems = await db
        .select()
        .from(budgetTrackerItems)
        .where(eq(budgetTrackerItems.isActive, true))
        .all();

      // Fetch room mappings for all active items
      const allItemRooms = await db
        .select()
        .from(budgetTrackerItemRooms)
        .all();

      // Filter items that have at least one room in our configured rooms
      const itemsWithRoomMappings = activeItems.map((item) => {
        const itemRoomIds = allItemRooms
          .filter((ir) => ir.budgetTrackerItemId === item.id)
          .map((ir) => ir.roomId);
        return { ...item, roomIds: itemRoomIds };
      });

      // Include items that overlap with configured rooms, or items with no room assignment
      const relevantItems = itemsWithRoomMappings.filter(
        (item) =>
          item.roomIds.length === 0 ||
          item.roomIds.some((rid) => configuredRoomIds.includes(rid)),
      );

      // Assumption line items (all of them — they're room-grouped by sectionName)
      const assumptions = await db
        .select()
        .from(assumptionLineItems)
        .orderBy(assumptionLineItems.sortOrder)
        .all();

      budgetData = {
        trackerItems: relevantItems.map(({ roomIds, ...rest }) => ({
          ...rest,
          estimatedLowCents: rest.estimatedLowCents,
          estimatedHighCents: rest.estimatedHighCents,
        })),
        assumptionItems: assumptions,
      };
    }

    // Scenario data
    const scenarios = await db.select().from(remodelScenarios).all();
    const scenarioPlans = await db.select().from(scenarioRoomPlans).all();

    return c.json({
      portfolio: {
        id: portfolio.id,
        title: portfolio.title,
        welcomeMessage: portfolio.welcomeMessage,
        overviewStatement: portfolio.overviewStatement,
        showBudgetRanges: portfolio.showBudgetRanges,
        status: portfolio.status,
        datetimeCreated: portfolio.datetimeCreated,
      },
      company: company
        ? {
            id: company.company.id,
            name: company.company.name,
            businessType: company.businessType?.name || "other",
          }
        : null,
      roomConfigs: enrichedRoomConfigs,
      budgetData,
      scenarios: scenarios.map((s) => ({
        ...s,
        roomPlans: scenarioPlans.filter((p) => p.scenarioId === s.id),
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load portfolio",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Visitor Tracking
// ---------------------------------------------------------------------------

/** POST /:token/track — record a visitor event */
bidPortfolioPublicRouter.post("/:token/track", async (c) => {
  try {
    const token = c.req.param("token")?.trim();
    if (!token) {
      return c.json({ error: "Token is required" }, 400);
    }

    const body = (await c.req.json()) as {
      eventType?: string;
      path?: string;
      element?: string | null;
      durationMs?: number | null;
      metadata?: unknown;
    };

    const eventType = body.eventType?.trim();
    const path = body.path?.trim();

    if (!eventType) {
      return c.json({ error: "eventType is required" }, 400);
    }
    if (!path) {
      return c.json({ error: "path is required" }, 400);
    }

    const db = drizzle(c.env.DB);

    // Verify portfolio exists by token
    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.token, token))
      .get();
    if (!portfolio) {
      return c.json({ error: "Portfolio not found" }, 404);
    }

    // Retrieve or generate a visitor session ID using cookie
    const request = c.req.raw;
    const existingVisitor = getVisitorCookieFromRequest(request);
    const visitorId = existingVisitor || crypto.randomUUID();

    const cfData = (request as Request & { cf?: Record<string, string> }).cf;
    const country = cfData?.country || null;
    const city = cfData?.city || null;
    const timezone = cfData?.timezone || null;
    const userAgent = c.req.header("user-agent") || null;
    const referrer = c.req.header("referer") || null;

    const eventId = crypto.randomUUID();
    const now = new Date();

    // Check if session already exists
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

    // Insert the event
    await db
      .insert(visitorEvents)
      .values({
        id: eventId,
        visitorId,
        eventType,
        path,
        element: body.element?.trim() || null,
        durationMs: typeof body.durationMs === "number" ? body.durationMs : null,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
        datetimeCreated: now,
      })
      .run();

    if (!existingVisitor) {
      setVisitorCookie(c, visitorId);
    }

    return c.json({ success: true, visitorId, eventId }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to track event",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Comments (Public)
// ---------------------------------------------------------------------------

/** GET /:token/comments — list comments for public viewer */
bidPortfolioPublicRouter.get("/:token/comments", async (c) => {
  try {
    const token = c.req.param("token")?.trim();
    if (!token) {
      return c.json({ error: "Token is required" }, 400);
    }

    const db = drizzle(c.env.DB);

    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.token, token))
      .get();
    if (!portfolio) {
      return c.json({ error: "Portfolio not found" }, 404);
    }

    const rows = await db
      .select()
      .from(bidPortfolioComments)
      .where(eq(bidPortfolioComments.portfolioId, portfolio.id))
      .orderBy(desc(bidPortfolioComments.datetimeCreated))
      .all();

    return c.json({ comments: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list comments",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/** POST /:token/comments — submit a new comment */
bidPortfolioPublicRouter.post("/:token/comments", async (c) => {
  try {
    const token = c.req.param("token")?.trim();
    if (!token) {
      return c.json({ error: "Token is required" }, 400);
    }

    const body = (await c.req.json()) as {
      authorName?: string;
      authorEmail?: string | null;
      content?: string;
      section?: string | null;
      roomId?: number | null;
    };

    const authorName = body.authorName?.trim();
    const content = body.content?.trim();

    if (!authorName) {
      return c.json({ error: "authorName is required" }, 400);
    }
    if (!content) {
      return c.json({ error: "content is required" }, 400);
    }

    const db = drizzle(c.env.DB);

    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.token, token))
      .get();
    if (!portfolio) {
      return c.json({ error: "Portfolio not found" }, 404);
    }

    const now = new Date();

    // Insert comment
    const result = await db
      .insert(bidPortfolioComments)
      .values({
        portfolioId: portfolio.id,
        section: body.section?.trim() || null,
        roomId: typeof body.roomId === "number" ? body.roomId : null,
        authorName,
        authorEmail: body.authorEmail?.trim() || null,
        content,
        isRead: false,
        datetimeCreated: now,
      })
      .returning();

    // Create a notification for the homeowner
    // Use the first user in the system as the notification recipient
    const firstUser = await db.select().from(users).limit(1).get();
    if (firstUser) {
      await db
        .insert(notifications)
        .values({
          userId: firstUser.id,
          type: "info",
          title: "New Bid Portfolio Comment",
          message: `${authorName} commented on portfolio "${portfolio.title}": ${content.substring(0, 200)}`,
          isRead: false,
          createdAt: now,
        })
        .run();
    }

    return c.json({ comment: result[0] }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to submit comment",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** Extract user message text from parts (matches budget-agent pattern) */
function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;

  if (typeof record.content === "string") return record.content;

  const parts = Array.isArray(record.parts) ? record.parts : Array.isArray(record.content) ? record.content : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const partRecord = part as Record<string, unknown>;
      return partRecord.type === "text" && typeof partRecord.text === "string" ? partRecord.text : "";
    })
    .join("\n")
    .trim();
}

/** POST /:token/chat — invoke BidPortfolioAgent for this portfolio */
bidPortfolioPublicRouter.post("/:token/chat", async (c) => {
  try {
    const token = c.req.param("token")?.trim();
    if (!token) {
      return c.json({ error: "Token is required" }, 400);
    }

    const db = drizzle(c.env.DB);

    // Verify portfolio exists and is not expired
    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.token, token))
      .get();

    if (!portfolio) {
      return c.json({ error: "Portfolio not found" }, 404);
    }

    if (isExpired(portfolio)) {
      return c.json({ error: "This portfolio has expired" }, 410);
    }

    // Parse request body
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: string;
      messages?: unknown[];
    };

    const conversationId = body.id || `bid-portfolio-${token}`;
    const latestUserMessage = [...(body.messages ?? [])]
      .reverse()
      .find(
        (message) =>
          Boolean(
            message &&
              typeof message === "object" &&
              (message as { role?: string }).role === "user",
          ),
      );
    const prompt = extractMessageText(latestUserMessage);

    if (!prompt) {
      return c.json({ error: "A user message is required." }, 400);
    }

    // Fetch company info for businessType
    const company = await db
      .select({ businessType: businessTypes })
      .from(companies)
      .leftJoin(businessTypes, eq(companies.businessTypeId, businessTypes.id))
      .where(eq(companies.id, portfolio.companyId))
      .get();

    // Fetch room IDs scoped to this portfolio
    const roomConfigRows = await db
      .select({ roomId: bidPortfolioRoomConfigs.roomId })
      .from(bidPortfolioRoomConfigs)
      .where(eq(bidPortfolioRoomConfigs.portfolioId, portfolio.id))
      .all();
    const roomScope = roomConfigRows
      .map((r) => r.roomId)
      .filter((id): id is number => typeof id === "number");

    // Get the BidPortfolioAgent DO — one instance per token
    const agent = await getAgentByName<Env, BidPortfolioAgent>(
      c.env.BID_PORTFOLIO_AGENT as any,
      token,
    );

    // Initialize agent with portfolio config (idempotent)
    await agent.initialize({
      portfolioToken: token,
      contactBusinessType: company?.businessType?.name ?? "",
      showBudgetRanges: portfolio.showBudgetRanges ?? false,
      roomScope,
    });

    // Chat with the agent
    const result = await agent.chat({ conversationId, prompt });

    // Return response as UI message stream
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: (body.messages ?? []) as UIMessage[],
      execute({ writer }) {
        const textId = crypto.randomUUID();
        writer.write({ type: "start" });
        writer.write({ type: "text-start", id: textId });
        writer.write({ type: "text-delta", id: textId, delta: result.text });
        writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish", finishReason: "stop" });
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: { "Cache-Control": "no-cache" },
    });
  } catch (error) {
    return c.json(
      {
        error: "Chat request failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { bidPortfolioPublicRouter };
