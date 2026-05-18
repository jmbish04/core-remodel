import { estimateCompanies, estimateCompanyContacts } from "@backend/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const estimateContactsRouter = new Hono<{ Bindings: Env }>();

estimateContactsRouter.get("/", async (c) => {
  try {
    const onlyNeedsMapping = c.req.query("needsMapping") === "true";
    const db = drizzle(c.env.DB);
    const rows = onlyNeedsMapping
      ? await db
          .select()
          .from(estimateCompanyContacts)
          .where(eq(estimateCompanyContacts.mappingStatus, "needs_mapping"))
          .orderBy(asc(estimateCompanyContacts.name))
          .all()
      : await db
          .select()
          .from(estimateCompanyContacts)
          .orderBy(asc(estimateCompanyContacts.name))
          .all();
    return c.json({ contacts: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list estimate contacts",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimateContactsRouter.get("/mapping-queue", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(estimateCompanyContacts)
      .where(eq(estimateCompanyContacts.mappingStatus, "needs_mapping"))
      .orderBy(asc(estimateCompanyContacts.datetimeUpdated))
      .all();
    return c.json({ contacts: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load mapping queue",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimateContactsRouter.post("/", async (c) => {
  try {
    const body = (await c.req.json()) as {
      estimateCompanyId?: number | null;
      name?: string;
      title?: string | null;
      email?: string | null;
      phone?: string | null;
      source?: string | null;
      mappingStatus?: string | null;
    };

    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }

    const db = drizzle(c.env.DB);
    if (typeof body.estimateCompanyId === "number") {
      const company = await db
        .select()
        .from(estimateCompanies)
        .where(eq(estimateCompanies.id, body.estimateCompanyId))
        .get();
      if (!company) {
        return c.json({ error: "estimateCompanyId not found" }, 400);
      }
    }

    const now = new Date();
    const result = await db
      .insert(estimateCompanyContacts)
      .values({
        estimateCompanyId:
          typeof body.estimateCompanyId === "number" ? body.estimateCompanyId : null,
        name,
        title: body.title?.trim() || null,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        source: body.source?.trim() || "manual",
        mappingStatus: body.mappingStatus?.trim() || "mapped",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    return c.json({ contact: result[0] }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create estimate contact",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimateContactsRouter.patch("/:id", async (c) => {
  try {
    const contactId = Number(c.req.param("id"));
    if (!Number.isFinite(contactId)) {
      return c.json({ error: "Invalid contact ID" }, 400);
    }

    const body = (await c.req.json()) as Partial<{
      estimateCompanyId: number | null;
      name: string;
      title: string | null;
      email: string | null;
      phone: string | null;
      source: string;
      mappingStatus: string;
    }>;

    const updates: Record<string, unknown> = {
      datetimeUpdated: new Date(),
    };
    if ("estimateCompanyId" in body) {
      if (typeof body.estimateCompanyId === "number") {
        const db = drizzle(c.env.DB);
        const company = await db
          .select()
          .from(estimateCompanies)
          .where(eq(estimateCompanies.id, body.estimateCompanyId))
          .get();
        if (!company) {
          return c.json({ error: "estimateCompanyId not found" }, 400);
        }
        updates.estimateCompanyId = body.estimateCompanyId;
      } else {
        updates.estimateCompanyId = null;
      }
    }
    if (typeof body.name === "string") updates.name = body.name.trim();
    if (typeof body.title === "string" || body.title === null) updates.title = body.title;
    if (typeof body.email === "string" || body.email === null) updates.email = body.email;
    if (typeof body.phone === "string" || body.phone === null) updates.phone = body.phone;
    if (typeof body.source === "string") updates.source = body.source.trim();
    if (typeof body.mappingStatus === "string") updates.mappingStatus = body.mappingStatus.trim();

    const db = drizzle(c.env.DB);
    const result = await db
      .update(estimateCompanyContacts)
      .set(updates)
      .where(eq(estimateCompanyContacts.id, contactId))
      .returning();
    if (!result[0]) {
      return c.json({ error: "Contact not found" }, 404);
    }
    return c.json({ contact: result[0] });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update estimate contact",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimateContactsRouter.post("/resolve-by-domain", async (c) => {
  try {
    const body = (await c.req.json()) as {
      email?: string;
      name?: string;
      title?: string;
      phone?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    if (!email || !name) {
      return c.json({ error: "email and name are required" }, 400);
    }
    const domain = email.includes("@") ? email.split("@")[1] : "";
    const db = drizzle(c.env.DB);
    let companyId: number | null = null;
    if (domain) {
      const allCompanies = await db.select().from(estimateCompanies).all();
      const matched = allCompanies.find((company) => {
        const website = (company.website || "").toLowerCase();
        const companyEmail = (company.email || "").toLowerCase();
        return website.includes(domain) || companyEmail.endsWith(`@${domain}`);
      });
      companyId = matched?.id ?? null;
    }

    const now = new Date();
    const result = await db
      .insert(estimateCompanyContacts)
      .values({
        estimateCompanyId: companyId,
        name,
        title: body.title?.trim() || null,
        email,
        phone: body.phone?.trim() || null,
        source: "email_monitor",
        mappingStatus: companyId ? "mapped" : "needs_mapping",
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();

    return c.json({ contact: result[0], companyMatched: companyId !== null }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to resolve contact by domain",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { estimateContactsRouter };
