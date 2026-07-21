import {
  contacts,
  bidPortfolios,
  bidPortfolioRoomConfigs,
  bidPortfolioComments,
  rooms,
  visitorSessions,
  visitorEvents,
  permitsContactInsights,
  permitsContactActivity,
  businessTypes,
  companies,
  companyContacts,
  bidPortfolioSelectedPhotos,
} from "@backend/db";
import type { PermitIntelligenceAgent } from "@backend/ai/agents/PermitIntelligenceAgent";
import { getAgentByName } from "agents";
import type { BatchItem } from "drizzle-orm/batch";
import { desc, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const bidPortfoliosRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Business Types & Companies
// ---------------------------------------------------------------------------

/** GET /business-types — list all business types */
bidPortfoliosRouter.get("/business-types", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(businessTypes).orderBy(businessTypes.name).all();
    return c.json({ businessTypes: rows });
  } catch (error) {
    return c.json({ error: "Failed to list business types", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/** GET /companies — list all non-archived companies */
bidPortfoliosRouter.get("/companies", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select({
        company: companies,
        businessType: businessTypes,
      })
      .from(companies)
      .leftJoin(businessTypes, eq(companies.businessTypeId, businessTypes.id))
      .where(eq(companies.isArchived, false))
      .orderBy(desc(companies.datetimeCreated))
      .all();
    
    // Format output
    const formatted = rows.map(r => ({
      ...r.company,
      businessType: r.businessType
    }));
    return c.json({ companies: formatted });
  } catch (error) {
    return c.json({ error: "Failed to list companies", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/** POST /companies — create a company */
bidPortfoliosRouter.post("/companies", async (c) => {
  try {
    const body = (await c.req.json()) as {
      name: string;
      businessTypeId?: number | null;
      phone?: string | null;
      email?: string | null;
      website?: string | null;
      licenseNumber?: string | null;
      notes?: string | null;
    };

    if (!body.name?.trim()) {
      return c.json({ error: "name is required" }, 400);
    }

    const db = drizzle(c.env.DB);
    const now = new Date();
    
    // Look up business type name for permit intelligence
    let businessTypeName = "other";
    if (body.businessTypeId) {
       const bt = await db.select().from(businessTypes).where(eq(businessTypes.id, body.businessTypeId)).get();
       if (bt) businessTypeName = bt.name.toLowerCase();
    }

    const result = await db
      .insert(companies)
      .values({
        name: body.name.trim(),
        businessTypeId: body.businessTypeId || null,
        phone: body.phone?.trim() || null,
        email: body.email?.trim() || null,
        website: body.website?.trim() || null,
        licenseNumber: body.licenseNumber?.trim() || null,
        notes: body.notes?.trim() || null,
        isArchived: false,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    // Trigger PermitIntelligenceAgent if it's a contractor/architect/engineer
    if (businessTypeName.includes("contractor") || businessTypeName.includes("architect") || businessTypeName.includes("engineer")) {
      const agent = await getAgentByName<Env, PermitIntelligenceAgent>(
        c.env.PERMIT_INTELLIGENCE_AGENT as any,
        body.name.trim(),
      );
      c.executionCtx.waitUntil(agent.runIntelligence(body.name.trim()));
    }

    return c.json({ company: result[0] }, 201);
  } catch (error) {
    return c.json({ error: "Failed to create company", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/** PUT /companies/:id — update a company */
bidPortfoliosRouter.put("/companies/:id", async (c) => {
  try {
    const companyId = Number(c.req.param("id"));
    const body = (await c.req.json()) as any;
    
    const updates: Record<string, unknown> = { datetimeUpdated: new Date() };
    if (typeof body.name === "string") updates.name = body.name.trim();
    if (body.businessTypeId !== undefined) updates.businessTypeId = body.businessTypeId;
    if (body.phone !== undefined) updates.phone = body.phone?.trim() ?? null;
    if (body.email !== undefined) updates.email = body.email?.trim() ?? null;
    if (body.website !== undefined) updates.website = body.website?.trim() ?? null;
    if (body.licenseNumber !== undefined) updates.licenseNumber = body.licenseNumber?.trim() ?? null;
    if (body.notes !== undefined) updates.notes = body.notes?.trim() ?? null;

    const db = drizzle(c.env.DB);
    const result = await db.update(companies).set(updates).where(eq(companies.id, companyId)).returning();
    if (!result[0]) return c.json({ error: "Company not found" }, 404);
    
    return c.json({ company: result[0] });
  } catch (error) {
    return c.json({ error: "Failed to update company", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/** GET /companies/:id/contacts — get all contacts for a company */
bidPortfoliosRouter.get("/companies/:id/contacts", async (c) => {
  try {
    const companyId = Number(c.req.param("id"));
    const db = drizzle(c.env.DB);
    
    const rows = await db
      .select({
        mapping: companyContacts,
        contact: contacts,
      })
      .from(companyContacts)
      .innerJoin(contacts, eq(companyContacts.contactId, contacts.id))
      .where(eq(companyContacts.companyId, companyId))
      .all();
      
    const formatted = rows.map(r => ({
      ...r.contact,
      title: r.mapping.title,
      isPrimary: r.mapping.isPrimary,
      mappingId: r.mapping.id,
    }));
      
    return c.json({ contacts: formatted });
  } catch (error) {
    return c.json({ error: "Failed to load company contacts", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Contacts CRUD

/** GET /contacts — list all non-archived contacts */
bidPortfoliosRouter.get("/contacts", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.isArchived, false))
      .orderBy(desc(contacts.datetimeCreated))
      .all();
    return c.json({ contacts: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list contacts",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/** POST /contacts — create a contact */
bidPortfoliosRouter.post("/contacts", async (c) => {
  try {
    const body = (await c.req.json()) as {
      companyId?: number; // Optional, creates mapping if provided
      contactName?: string;
      title?: string | null; // title for the mapping table
      email?: string | null;
      phone?: string | null;
      notes?: string | null;
    };

    const contactName = body.contactName?.trim();
    if (!contactName) return c.json({ error: "contactName is required" }, 400);

    const db = drizzle(c.env.DB);
    const now = new Date();

    // `db.transaction()` doesn't work on D1 (see AGENTS.md — BEGIN is
    // rejected), and batch() can't help here either: the company mapping
    // needs the contact's generated id, and a batch is built before any of
    // it runs. Insert the contact, then link it to the company if requested,
    // with a compensating delete if that link fails so a broken mapping
    // can't be left pointing at nothing (or worse, silently succeed without
    // us knowing the contact is orphaned).
    const result = await db
      .insert(contacts)
      .values({
        contactName,
        title: body.title?.trim() || null,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        notes: body.notes?.trim() || null,
        isArchived: false,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    const createdContact = result[0];

    if (body.companyId) {
      try {
        await db.insert(companyContacts).values({
          companyId: body.companyId,
          contactId: createdContact.id,
          title: body.title?.trim() || null,
          isPrimary: false,
          datetimeCreated: now,
        });
      } catch (err) {
        try {
          await db.delete(contacts).where(eq(contacts.id, createdContact.id));
        } catch {
          console.error(
            `[bid-portfolios] orphaned contact ${createdContact.id} — company mapping failed and cleanup failed`,
          );
        }
        throw err;
      }
    }

    const contactRecord = createdContact;

    return c.json({ contact: contactRecord }, 201);
  } catch (error) {
    return c.json({ error: "Failed to create contact", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/** PUT /contacts/:id — update a contact */
bidPortfoliosRouter.put("/contacts/:id", async (c) => {
  try {
    const contactId = Number(c.req.param("id"));
    if (!Number.isFinite(contactId)) {
      return c.json({ error: "Invalid contact ID" }, 400);
    }

    const body = (await c.req.json()) as Partial<{
      companyName: string;
      contactName: string;
      title: string | null;
      email: string | null;
      phone: string | null;
      businessType: string;
      licenseNumber: string | null;
      website: string | null;
      notes: string | null;
    }>;

    const updates: Record<string, unknown> = { datetimeUpdated: new Date() };
    if (typeof body.contactName === "string") updates.contactName = body.contactName.trim();
    if (typeof body.title === "string" || body.title === null) updates.title = body.title?.trim() ?? null;
    if (typeof body.email === "string" || body.email === null) updates.email = body.email?.trim() ?? null;
    if (typeof body.phone === "string" || body.phone === null) updates.phone = body.phone?.trim() ?? null;
    if (typeof body.notes === "string" || body.notes === null) updates.notes = body.notes?.trim() ?? null;

    const db = drizzle(c.env.DB);
    const result = await db
      .update(contacts)
      .set(updates)
      .where(eq(contacts.id, contactId))
      .returning();

    if (!result[0]) {
      return c.json({ error: "Contact not found" }, 404);
    }
    return c.json({ contact: result[0] });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update contact",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/** DELETE /contacts/:id — archive (soft delete) a contact */
bidPortfoliosRouter.delete("/contacts/:id", async (c) => {
  try {
    const contactId = Number(c.req.param("id"));
    if (!Number.isFinite(contactId)) {
      return c.json({ error: "Invalid contact ID" }, 400);
    }

    const db = drizzle(c.env.DB);
    const result = await db
      .update(contacts)
      .set({ isArchived: true, datetimeUpdated: new Date() })
      .where(eq(contacts.id, contactId))
      .returning();

    if (!result[0]) {
      return c.json({ error: "Contact not found" }, 404);
    }
    return c.json({ message: "Contact archived", contact: result[0] });
  } catch (error) {
    return c.json(
      {
        error: "Failed to archive contact",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

/** GET /companies/:id/insights — get permit portfolio insights for a company */
bidPortfoliosRouter.get("/companies/:id/insights", async (c) => {
  try {
    const companyId = Number(c.req.param("id"));
    if (!Number.isFinite(companyId)) {
      return c.json({ error: "Invalid company ID" }, 400);
    }

    const db = drizzle(c.env.DB);
    const company = await db.select().from(companies).where(eq(companies.id, companyId)).get();

    if (!company) {
      return c.json({ error: "Company not found" }, 404);
    }

    // Fetch insights and activity by companyName
    const insightsRecord = await db.select().from(permitsContactInsights).where(eq(permitsContactInsights.contactName, company.name)).get().catch(() => null);

    // Activity
    const activityRows = await db.select().from(permitsContactActivity).where(eq(permitsContactActivity.contactName, company.name)).orderBy(desc(permitsContactActivity.issuedDate)).limit(50).all().catch(() => []);

    return c.json({ insights: insightsRecord, activity: activityRows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load insights",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Portfolio CRUD
// ---------------------------------------------------------------------------

/** GET / — list all portfolios with joined contact info */
bidPortfoliosRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select({
        portfolio: bidPortfolios,
        company: companies,
      })
      .from(bidPortfolios)
      .leftJoin(companies, eq(bidPortfolios.companyId, companies.id))
      .orderBy(desc(bidPortfolios.datetimeCreated))
      .all();

    return c.json({
      portfolios: rows.map((row) => ({
        ...row.portfolio,
        company: row.company,
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list portfolios",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/** POST / — create a portfolio */
bidPortfoliosRouter.post("/", async (c) => {
  try {
    const body = (await c.req.json()) as {
      companyId?: number;
      title?: string;
      welcomeMessage?: string | null;
      overviewStatement?: string | null;
      showBudgetRanges?: boolean;
      expirationDate?: string | null;
      status?: string;
      roomConfigs?: Array<{
        roomId: number;
        includePhotos?: boolean;
        includeDimensions?: boolean;
        includeConditionNotes?: boolean;
        includeScopeItems?: boolean;
        includeInspiration?: boolean;
        sortOrder?: number;
        selectedPhotos?: Array<{
          imageId: string;
          captionOverride?: string;
          sortOrder?: number;
        }>;
      }>;
    };

    const companyId = body.companyId;
    const title = body.title?.trim();

    if (typeof companyId !== "number" || !Number.isFinite(companyId)) {
      return c.json({ error: "companyId is required" }, 400);
    }
    if (!title) {
      return c.json({ error: "title is required" }, 400);
    }

    const db = drizzle(c.env.DB);

    // Validate companyId exists
    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .get();
    if (!company) {
      return c.json({ error: "companyId not found" }, 400);
    }

    const now = new Date();
    const token = crypto.randomUUID();

    let expirationDate: Date | null = null;
    if (body.expirationDate) {
      const parsed = new Date(body.expirationDate);
      if (!Number.isNaN(parsed.getTime())) {
        expirationDate = parsed;
      }
    }

    // `db.transaction()` doesn't work on D1 (see AGENTS.md — BEGIN is
    // rejected). The room configs and selected photos both need the
    // portfolio's generated id, so they can't be batched together with the
    // portfolio insert itself — but they're independent of EACH OTHER, so
    // once the portfolio exists, both go in one db.batch() for real
    // atomicity. If that batch fails, the portfolio is a childless orphan;
    // delete it (its FKs are ON DELETE CASCADE, so this also cleans up
    // anything the batch partially inserted before it was reverted, though
    // batch() itself is all-or-nothing) and rethrow the original error.
    const insertedPortfolio = await db
      .insert(bidPortfolios)
      .values({
        companyId,
        token,
        title,
        welcomeMessage: body.welcomeMessage?.trim() || null,
        overviewStatement: body.overviewStatement?.trim() || null,
        showBudgetRanges: body.showBudgetRanges ?? false,
        expirationDate,
        status: body.status?.trim() || "active",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    const portfolio = insertedPortfolio[0];

    if (body.roomConfigs && body.roomConfigs.length > 0) {
      const configValues = body.roomConfigs.map((cfg, index) => ({
        portfolioId: portfolio.id,
        roomId: cfg.roomId,
        includePhotos: cfg.includePhotos ?? true,
        includeDimensions: cfg.includeDimensions ?? true,
        includeConditionNotes: cfg.includeConditionNotes ?? true,
        includeScopeItems: cfg.includeScopeItems ?? true,
        includeInspiration: cfg.includeInspiration ?? true,
        sortOrder: cfg.sortOrder ?? index,
        datetimeCreated: now,
      }));

      const photoValues = body.roomConfigs.flatMap((cfg) => {
        if (!cfg.selectedPhotos) return [];
        return cfg.selectedPhotos.map((p, pIndex) => ({
          portfolioId: portfolio.id,
          roomId: cfg.roomId,
          imageId: p.imageId,
          captionOverride: p.captionOverride?.trim() || null,
          sortOrder: p.sortOrder ?? pIndex,
          datetimeCreated: now,
        }));
      });

      try {
        const stmts: BatchItem<"sqlite">[] = [
          db.insert(bidPortfolioRoomConfigs).values(configValues),
        ];
        if (photoValues.length > 0) {
          stmts.push(db.insert(bidPortfolioSelectedPhotos).values(photoValues));
        }
        await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
      } catch (err) {
        try {
          await db.delete(bidPortfolios).where(eq(bidPortfolios.id, portfolio.id));
        } catch {
          console.error(
            `[bid-portfolios] orphaned portfolio ${portfolio.id} — room config insert failed and cleanup failed`,
          );
        }
        throw err;
      }
    }

    const result = portfolio;

    return c.json({ portfolio: result }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create portfolio",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/** PUT /:id — update portfolio config */
bidPortfoliosRouter.put("/:id", async (c) => {
  try {
    const portfolioId = Number(c.req.param("id"));
    if (!Number.isFinite(portfolioId)) {
      return c.json({ error: "Invalid portfolio ID" }, 400);
    }

    const body = (await c.req.json()) as Partial<{
      companyId: number;
      title: string;
      welcomeMessage: string | null;
      overviewStatement: string | null;
      showBudgetRanges: boolean;
      expirationDate: string | null;
      status: string;
    }>;

    const updates: Record<string, unknown> = {
      datetimeUpdated: new Date(),
    };

    if (typeof body.companyId === "number") {
      const db = drizzle(c.env.DB);
      const company = await db.select().from(companies).where(eq(companies.id, body.companyId)).get();
      if (!company) {
        return c.json({ error: "companyId not found" }, 400);
      }
      updates.companyId = body.companyId;
    }
    if (typeof body.title === "string") updates.title = body.title.trim();
    if (typeof body.welcomeMessage === "string" || body.welcomeMessage === null)
      updates.welcomeMessage = body.welcomeMessage?.trim() ?? null;
    if (typeof body.overviewStatement === "string" || body.overviewStatement === null)
      updates.overviewStatement = body.overviewStatement?.trim() ?? null;
    if (typeof body.showBudgetRanges === "boolean") updates.showBudgetRanges = body.showBudgetRanges;
    if (typeof body.status === "string") updates.status = body.status.trim();

    if (body.expirationDate !== undefined) {
      if (body.expirationDate === null) {
        updates.expirationDate = null;
      } else {
        const parsed = new Date(body.expirationDate);
        if (!Number.isNaN(parsed.getTime())) {
          updates.expirationDate = parsed;
        }
      }
    }

    const db = drizzle(c.env.DB);
    const result = await db
      .update(bidPortfolios)
      .set(updates)
      .where(eq(bidPortfolios.id, portfolioId))
      .returning();

    if (!result[0]) {
      return c.json({ error: "Portfolio not found" }, 404);
    }
    return c.json({ portfolio: result[0] });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update portfolio",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/** DELETE /:id — archive a portfolio (set status='archived') */
bidPortfoliosRouter.delete("/:id", async (c) => {
  try {
    const portfolioId = Number(c.req.param("id"));
    if (!Number.isFinite(portfolioId)) {
      return c.json({ error: "Invalid portfolio ID" }, 400);
    }

    const db = drizzle(c.env.DB);
    const result = await db
      .update(bidPortfolios)
      .set({ status: "archived", datetimeUpdated: new Date() })
      .where(eq(bidPortfolios.id, portfolioId))
      .returning();

    if (!result[0]) {
      return c.json({ error: "Portfolio not found" }, 404);
    }
    return c.json({ message: "Portfolio archived", portfolio: result[0] });
  } catch (error) {
    return c.json(
      {
        error: "Failed to archive portfolio",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Room Configs
// ---------------------------------------------------------------------------

/** GET /:id/rooms — list room configs for a portfolio */
bidPortfoliosRouter.get("/:id/rooms", async (c) => {
  try {
    const portfolioId = Number(c.req.param("id"));
    if (!Number.isFinite(portfolioId)) {
      return c.json({ error: "Invalid portfolio ID" }, 400);
    }

    const db = drizzle(c.env.DB);

    // Verify portfolio exists
    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.id, portfolioId))
      .get();
    if (!portfolio) {
      return c.json({ error: "Portfolio not found" }, 404);
    }

    const rows = await db
      .select({
        config: bidPortfolioRoomConfigs,
        room: rooms,
      })
      .from(bidPortfolioRoomConfigs)
      .leftJoin(rooms, eq(bidPortfolioRoomConfigs.roomId, rooms.id))
      .where(eq(bidPortfolioRoomConfigs.portfolioId, portfolioId))
      .orderBy(bidPortfolioRoomConfigs.sortOrder)
      .all();

    return c.json({
      roomConfigs: rows.map((row) => ({
        ...row.config,
        room: row.room,
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list room configs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/** POST /:id/rooms — bulk upsert room configs */
bidPortfoliosRouter.post("/:id/rooms", async (c) => {
  try {
    const portfolioId = Number(c.req.param("id"));
    if (!Number.isFinite(portfolioId)) {
      return c.json({ error: "Invalid portfolio ID" }, 400);
    }

    const body = (await c.req.json()) as {
      configs?: Array<{
        roomId: number;
        includePhotos?: boolean;
        includeDimensions?: boolean;
        includeConditionNotes?: boolean;
        includeScopeItems?: boolean;
        includeInspiration?: boolean;
        sortOrder?: number;
      }>;
    };

    const configs = Array.isArray(body.configs) ? body.configs : [];
    if (configs.length === 0) {
      return c.json({ error: "configs array is required" }, 400);
    }

    const db = drizzle(c.env.DB);

    // Verify portfolio exists
    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.id, portfolioId))
      .get();
    if (!portfolio) {
      return c.json({ error: "Portfolio not found" }, 404);
    }

    // Delete existing configs and insert new ones (bulk upsert strategy)
    await db
      .delete(bidPortfolioRoomConfigs)
      .where(eq(bidPortfolioRoomConfigs.portfolioId, portfolioId))
      .run();

    const now = new Date();
    const values = configs
      .filter((cfg) => typeof cfg.roomId === "number" && Number.isFinite(cfg.roomId))
      .map((cfg, index) => ({
        portfolioId,
        roomId: cfg.roomId,
        includePhotos: cfg.includePhotos ?? true,
        includeDimensions: cfg.includeDimensions ?? true,
        includeConditionNotes: cfg.includeConditionNotes ?? true,
        includeScopeItems: cfg.includeScopeItems ?? true,
        includeInspiration: cfg.includeInspiration ?? true,
        sortOrder: cfg.sortOrder ?? index,
        datetimeCreated: now,
      }));

    if (values.length > 0) {
      await db.insert(bidPortfolioRoomConfigs).values(values).run();
    }

    // Return updated configs
    const updatedRows = await db
      .select()
      .from(bidPortfolioRoomConfigs)
      .where(eq(bidPortfolioRoomConfigs.portfolioId, portfolioId))
      .orderBy(bidPortfolioRoomConfigs.sortOrder)
      .all();

    return c.json({ roomConfigs: updatedRows, updated: updatedRows.length });
  } catch (error) {
    return c.json(
      {
        error: "Failed to upsert room configs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** GET /:id/analytics — return visit/session data for a portfolio */
bidPortfoliosRouter.get("/:id/analytics", async (c) => {
  try {
    const portfolioId = Number(c.req.param("id"));
    if (!Number.isFinite(portfolioId)) {
      return c.json({ error: "Invalid portfolio ID" }, 400);
    }

    const db = drizzle(c.env.DB);

    // Fetch portfolio to get token
    const portfolio = await db
      .select()
      .from(bidPortfolios)
      .where(eq(bidPortfolios.id, portfolioId))
      .get();
    if (!portfolio) {
      return c.json({ error: "Portfolio not found" }, 404);
    }

    const pathPrefix = `/bid/${portfolio.token}`;

    // Get visitor events where path starts with /bid/{token}
    const events = await db
      .select()
      .from(visitorEvents)
      .where(like(visitorEvents.path, `${pathPrefix}%`))
      .orderBy(desc(visitorEvents.datetimeCreated))
      .all();

    // Collect unique visitor IDs from matching events
    const visitorIds = [...new Set(events.map((e) => e.visitorId))];

    // Fetch the corresponding sessions
    const sessions =
      visitorIds.length > 0
        ? await db
            .select()
            .from(visitorSessions)
            .all()
            .then((all) => all.filter((s) => visitorIds.includes(s.id)))
        : [];

    // Summarize
    const totalPageViews = events.filter((e) => e.eventType === "page_view").length;
    const uniqueVisitors = visitorIds.length;
    const totalEvents = events.length;

    return c.json({
      analytics: {
        portfolioId,
        token: portfolio.token,
        totalPageViews,
        uniqueVisitors,
        totalEvents,
      },
      sessions,
      events,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load analytics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Comments (admin view)
// ---------------------------------------------------------------------------

/** GET /:id/comments — list all comments for a portfolio */
bidPortfoliosRouter.get("/:id/comments", async (c) => {
  try {
    const portfolioId = Number(c.req.param("id"));
    if (!Number.isFinite(portfolioId)) {
      return c.json({ error: "Invalid portfolio ID" }, 400);
    }

    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(bidPortfolioComments)
      .where(eq(bidPortfolioComments.portfolioId, portfolioId))
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

/** PUT /comments/:commentId/read — mark a comment as read */
bidPortfoliosRouter.put("/comments/:commentId/read", async (c) => {
  try {
    const commentId = Number(c.req.param("commentId"));
    if (!Number.isFinite(commentId)) {
      return c.json({ error: "Invalid comment ID" }, 400);
    }

    const db = drizzle(c.env.DB);
    const result = await db
      .update(bidPortfolioComments)
      .set({ isRead: true })
      .where(eq(bidPortfolioComments.id, commentId))
      .returning();

    if (!result[0]) {
      return c.json({ error: "Comment not found" }, 404);
    }
    return c.json({ message: "Comment marked as read", comment: result[0] });
  } catch (error) {
    return c.json(
      {
        error: "Failed to mark comment as read",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { bidPortfoliosRouter };
