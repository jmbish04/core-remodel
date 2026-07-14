/**
 * @fileoverview Persistent changelog API — writes + seed. The overview + detail
 * pages READ D1 directly (Astro SSR); this router handles the WRITE side so
 * every branch/PR can register its changelog into D1 (via the CLI, an MCP tool,
 * or CI) where it accumulates forever.
 */
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql } from "drizzle-orm";

import { changelogBranches, changelogEntries } from "@backend/db/schema/changelog/changelog";
import { BRANCHES, CHANGELOG } from "@/data/changelog";
import { CHANGELOG_DETAIL } from "@/data/changelog-detail";

export const changelogRouter = new OpenAPIHono<{ Bindings: Env }>();

const branchSchema = z.object({
  branch: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional().nullable(),
  date: z.string().min(1),
  status: z.enum(["shipped", "staged", "open"]).optional(),
  prNumber: z.number().int().optional().nullable(),
  prUrl: z.string().optional().nullable(),
  diagrams: z.array(z.object({ caption: z.string(), code: z.string() })).optional().nullable(),
});

const entrySchema = z.object({
  slug: z.string().min(1),
  branch: z.string().min(1),
  tag: z.string().optional().nullable(),
  area: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  status: z.enum(["shipped", "staged"]).optional(),
  date: z.string().min(1),
  changes: z.array(z.object({ kind: z.string(), text: z.string() })).optional(),
  migrations: z.array(z.string()).optional(),
  detail: z.record(z.string(), z.unknown()).optional().nullable(),
});

/** GET / — branches (newest first) each with their entries (for external use). */
changelogRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const [branches, entries] = await Promise.all([
    db.select().from(changelogBranches).orderBy(desc(changelogBranches.createdAt)),
    db.select().from(changelogEntries).orderBy(desc(changelogEntries.createdAt)),
  ]);
  return c.json({
    branches: branches.map((b) => ({
      ...b,
      entries: entries.filter((e) => e.branch === b.branch),
    })),
  });
});

/** GET /:slug — one entry with its detail. */
changelogRouter.get("/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const [entry] = await db
    .select()
    .from(changelogEntries)
    .where(eq(changelogEntries.slug, c.req.param("slug")))
    .limit(1);
  if (!entry) return c.json({ error: "Not found" }, 404);
  return c.json({ entry });
});

/** POST /branches — upsert a branch by name. */
changelogRouter.post("/branches", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = branchSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const d = parsed.data;
  await db
    .insert(changelogBranches)
    .values({
      branch: d.branch,
      title: d.title,
      summary: d.summary ?? null,
      date: d.date,
      status: d.status ?? "open",
      prNumber: d.prNumber ?? null,
      prUrl: d.prUrl ?? null,
      diagramsJson: d.diagrams ?? null,
    })
    .onConflictDoUpdate({
      target: changelogBranches.branch,
      set: {
        title: d.title,
        summary: d.summary ?? null,
        date: d.date,
        status: d.status ?? "open",
        prNumber: d.prNumber ?? null,
        prUrl: d.prUrl ?? null,
        diagramsJson: d.diagrams ?? null,
        updatedAt: new Date(),
      },
    });
  return c.json({ success: true, branch: d.branch }, 201);
});

/** POST /entries — upsert an entry by slug. */
changelogRouter.post("/entries", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = entrySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const d = parsed.data;
  await db
    .insert(changelogEntries)
    .values({
      slug: d.slug,
      branch: d.branch,
      tag: d.tag ?? null,
      area: d.area,
      title: d.title,
      summary: d.summary,
      status: d.status ?? "staged",
      date: d.date,
      changesJson: d.changes ?? [],
      migrationsJson: d.migrations ?? [],
      detailJson: d.detail ?? null,
    })
    .onConflictDoUpdate({
      target: changelogEntries.slug,
      set: {
        branch: d.branch,
        tag: d.tag ?? null,
        area: d.area,
        title: d.title,
        summary: d.summary,
        status: d.status ?? "staged",
        date: d.date,
        changesJson: d.changes ?? [],
        migrationsJson: d.migrations ?? [],
        detailJson: d.detail ?? null,
        updatedAt: new Date(),
      },
    });
  return c.json({ success: true, slug: d.slug }, 201);
});

/**
 * POST /seed — one-time idempotent seed of the current static changelog data
 * into D1. Only inserts when the tables are empty, so re-runs are safe.
 */
changelogRouter.post("/seed", async (c) => {
  const db = drizzle(c.env.DB);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(changelogEntries);
  if (n > 0) return c.json({ seeded: false, reason: "already has entries", count: n }, 200);

  for (const b of BRANCHES) {
    await db.insert(changelogBranches).values({
      branch: b.branch,
      title: b.title,
      summary: b.summary ?? null,
      date: b.date,
      status: b.status,
      prNumber: b.prNumber ?? null,
      prUrl: b.prUrl ?? null,
      diagramsJson: b.diagrams ?? null,
    }).onConflictDoNothing();
  }
  for (const e of CHANGELOG) {
    await db.insert(changelogEntries).values({
      slug: e.id,
      branch: e.branch,
      tag: e.tag ?? null,
      area: e.area,
      title: e.title,
      summary: e.summary,
      status: e.status,
      date: e.date,
      changesJson: e.changes,
      migrationsJson: e.migrations ?? [],
      detailJson: (CHANGELOG_DETAIL[e.id] as unknown as Record<string, unknown>) ?? null,
    }).onConflictDoNothing();
  }
  return c.json({ seeded: true, branches: BRANCHES.length, entries: CHANGELOG.length }, 201);
});
