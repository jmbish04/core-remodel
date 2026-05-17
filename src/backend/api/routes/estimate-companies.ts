import { and, asc, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { estimateCompanies } from "@backend/db";

const estimateCompaniesRouter = new Hono<{ Bindings: Env }>();

estimateCompaniesRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const search = (c.req.query("search") || "").trim();
    const activeOnly = c.req.query("activeOnly") !== "false";
    const conditions = [];
    if (activeOnly) {
      conditions.push(eq(estimateCompanies.isActive, true));
    }
    if (search.length > 0) {
      conditions.push(like(estimateCompanies.name, `%${search}%`));
    }
    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(estimateCompanies)
            .where(and(...conditions))
            .orderBy(asc(estimateCompanies.name))
            .all()
        : await db.select().from(estimateCompanies).orderBy(asc(estimateCompanies.name)).all();
    return c.json({ companies: rows });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list estimate companies",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimateCompaniesRouter.post("/", async (c) => {
  try {
    const body = (await c.req.json()) as {
      name?: string;
      businessType?: string;
      website?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      cslbLicenseNumber?: string | null;
    };
    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }
    const now = new Date();
    const db = drizzle(c.env.DB);
    const result = await db
      .insert(estimateCompanies)
      .values({
        name,
        businessType: body.businessType?.trim() || "unknown",
        website: body.website?.trim() || null,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        address: body.address?.trim() || null,
        cslbLicenseNumber: body.cslbLicenseNumber?.trim() || null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .returning();
    return c.json({ company: result[0] }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create estimate company",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

estimateCompaniesRouter.patch("/:id", async (c) => {
  try {
    const companyId = Number(c.req.param("id"));
    if (!Number.isFinite(companyId)) {
      return c.json({ error: "Invalid company ID" }, 400);
    }
    const body = (await c.req.json()) as Partial<{
      name: string;
      businessType: string;
      website: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
      cslbLicenseNumber: string | null;
      isActive: boolean;
    }>;
    const updates: Record<string, unknown> = {
      datetimeUpdated: new Date(),
    };
    if (typeof body.name === "string") updates.name = body.name.trim();
    if (typeof body.businessType === "string") updates.businessType = body.businessType.trim();
    if (typeof body.website === "string" || body.website === null) updates.website = body.website;
    if (typeof body.email === "string" || body.email === null) updates.email = body.email;
    if (typeof body.phone === "string" || body.phone === null) updates.phone = body.phone;
    if (typeof body.address === "string" || body.address === null) updates.address = body.address;
    if (typeof body.cslbLicenseNumber === "string" || body.cslbLicenseNumber === null) {
      updates.cslbLicenseNumber = body.cslbLicenseNumber;
    }
    if (typeof body.isActive === "boolean") updates.isActive = body.isActive;

    const db = drizzle(c.env.DB);
    const result = await db
      .update(estimateCompanies)
      .set(updates)
      .where(eq(estimateCompanies.id, companyId))
      .returning();
    if (!result[0]) {
      return c.json({ error: "Company not found" }, 404);
    }
    return c.json({ company: result[0] });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update estimate company",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { estimateCompaniesRouter };

