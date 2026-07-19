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
import {
  getProposal,
  getProposalContext,
  listProposals,
  upsertProposal,
} from "@backend/services/changelog-proposals";
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

const proposalStatusSchema = z.enum(["proposed", "accepted", "in_progress", "shipped", "rejected"]);

const proposalTaskSchema = z.object({
  taskKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  workstream: z.string().optional(),
  phase: z.number().int().min(0).optional(),
  targetRoute: z.string().optional().nullable(),
  changeType: z
    .enum(["new", "move", "update", "delete", "keep", "investigate", "recover"])
    .optional(),
  status: z.enum(["pending", "in_progress", "blocked", "deferred", "done"]).optional(),
  dependsOn: z.array(z.string()).optional().nullable(),
  sortOrder: z.number().int().optional(),
  notes: z.string().optional().nullable(),
});

const proposalSchema = z.object({
  slug: z.string().min(1),
  title: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  area: z.string().optional().nullable(),
  branch: z.string().optional().nullable(),
  prNumber: z.number().int().optional().nullable(),
  planSlug: z.string().optional().nullable(),
  prdMarkdown: z.string().optional().nullable(),
  designBriefMarkdown: z.string().optional().nullable(),
  promptMarkdown: z.string().optional().nullable(),
  /** Raw transcript — no max length here; it goes to R2, not a bound param. */
  context: z.string().optional().nullable(),
  contextCoverageNote: z.string().optional().nullable(),
  sourceKind: z.enum(["ai_chat", "coding_agent", "human"]).optional(),
  sourceModel: z.string().optional().nullable(),
  status: proposalStatusSchema.optional(),
  tasks: z.array(proposalTaskSchema).optional(),
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

// ─── Feature proposals ───────────────────────────────────────────────────────
// Registered BEFORE `GET /:slug` on purpose: Hono matches in registration order,
// so a `/:slug` handler declared first would swallow `GET /proposals`.
//
// All logic lives in the service so the MCP tools (which run in-process) and
// `scripts/changelog/*.mjs` (which call these routes) share one implementation.

/** GET /proposals — list bundles, newest first. `?status=` filters. */
changelogRouter.get("/proposals", async (c) => {
  const db = drizzle(c.env.DB);
  const status = c.req.query("status");
  const limit = Number(c.req.query("limit") ?? 50);
  const parsed = status ? proposalStatusSchema.safeParse(status) : null;
  if (parsed && !parsed.success) {
    return c.json({ error: `Unknown status "${status}".` }, 400);
  }
  const proposals = await listProposals(db, {
    status: parsed?.data,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return c.json({ proposals });
});

/**
 * POST /proposals — upsert a bundle by slug.
 *
 * `context` (the raw transcript) is accepted inline and streamed to R2; only the
 * key/size/hash land in D1. It is stored VERBATIM — summarizing it on the way in
 * would destroy the only thing this feature exists to preserve.
 */
changelogRouter.post("/proposals", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = proposalSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const result = await upsertProposal(c.env, db, parsed.data);
  return c.json({ success: true, ...result }, result.created ? 201 : 200);
});

/** GET /proposals/:slug — bundle metadata + live plan tasks. Never the raw blob. */
changelogRouter.get("/proposals/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const bundle = await getProposal(db, c.req.param("slug"));
  if (!bundle) return c.json({ error: "Not found" }, 404);
  return c.json(bundle);
});

/** GET /proposals/:slug/context — stream the raw transcript out of R2. */
changelogRouter.get("/proposals/:slug/context", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  const object = await getProposalContext(c.env, db, slug);
  if (!object) return c.json({ error: "No transcript stored for this proposal." }, 404);
  // Stream rather than buffer — these are ~450KB and there is no reason to hold
  // one in the isolate just to hand it straight back.
  return new Response(object.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-length": String(object.size),
      etag: object.httpEtag,
      "content-disposition": `inline; filename="${slug}.md"`,
    },
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
