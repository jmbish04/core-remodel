/**
 * @fileoverview Persistent changelog API — the WRITE side. The overview page
 * READS D1 directly (Astro SSR); this router lets every branch/PR register its
 * changelog into D1 (via CLI, an MCP tool, or CI) where it accumulates forever
 * and is never overwritten. Upserts are keyed by branch name / entry slug.
 */
import { Hono } from "hono";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql } from "drizzle-orm";

import { changelogBranches, changelogEntries } from "@backend/db/schema/changelog/changelog";
import { BRANCHES, CHANGELOG } from "@/data/changelog";
import { CHANGELOG_DETAIL } from "@/data/changelog-detail";

export const changelogRouter = new Hono<{ Bindings: Env }>();

const branchSchema = z.object({
  branch: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional().nullable(),
  date: z.string().min(1),
  status: z.enum(["shipped", "staged", "open"]).optional(),
  prNumber: z.number().int().optional().nullable(),
  prUrl: z.string().optional().nullable(),
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
  changes: z
    .array(z.object({ kind: z.enum(["added", "changed", "removed", "migration", "fixed"]), text: z.string() }))
    .optional(),
  migrations: z.array(z.string()).optional(),
  detail: z.record(z.string(), z.unknown()).optional().nullable(),
});

/** GET / — branches (newest first) each with their entries. */
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

/** GET /:slug — one entry. */
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
  const parsed = branchSchema.safeParse(await c.req.json().catch(() => null));
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
        updatedAt: new Date(),
      },
    });
  return c.json({ success: true, branch: d.branch }, 201);
});

/** POST /entries — upsert an entry by slug (append-only across branches). */
changelogRouter.post("/entries", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = entrySchema.safeParse(await c.req.json().catch(() => null));
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
 * POST /seed — idempotent seed of the bundled static changelog into D1. Inserts
 * are onConflictDoNothing so re-runs never overwrite entries edited in D1.
 */
changelogRouter.post("/seed", async (c) => {
  const db = drizzle(c.env.DB);

  // Build all inserts, then run them chunked through db.batch() — one query per
  // row keeps us well under D1's 100-bound-param limit while avoiding a slow
  // sequential await-per-row that could hit Worker execution limits.
  const stmts = [
    ...BRANCHES.map((b) =>
      db
        .insert(changelogBranches)
        .values({
          branch: b.branch,
          title: b.title,
          summary: b.summary ?? null,
          date: b.date,
          status: b.status,
          prNumber: b.prNumber ?? null,
          prUrl: b.prUrl ?? null,
        })
        .onConflictDoNothing(),
    ),
    ...CHANGELOG.map((e) =>
      db
        .insert(changelogEntries)
        .values({
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
        })
        .onConflictDoNothing(),
    ),
  ];

  const BATCH = 50;
  for (let i = 0; i < stmts.length; i += BATCH) {
    const chunk = stmts.slice(i, i + BATCH) as [(typeof stmts)[number], ...(typeof stmts)[number][]];
    await db.batch(chunk);
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(changelogEntries);
  return c.json({ seeded: true, entries: n }, 201);
});
