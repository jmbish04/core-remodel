/**
 * @fileoverview Source-agnostic work-item API — `/api/pmo` (0028 P0).
 *
 *   GET   /api/pmo/work-items        List across sources, normalized to WorkItem.
 *   PATCH /api/pmo/work-items/:id     Update one item; dispatches to its adapter.
 *
 * Gated by `requireAccessAuth` via the `/api/pmo/*` middleware in
 * `src/backend/api/index.ts`. Every read passes through `viewerContext` +
 * `filterVisibleItems` — the single authorization seam (see `pmo/viewer.ts`).
 *
 * Plain Hono + hand-written Zod v4 to match the sibling plan routes
 * (`admin-plans.ts`, `planning-extended.ts`); the OpenAPI docs surface this
 * family is not part of does not apply here.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { adapterFor, ALL_ADAPTERS } from "@backend/services/pmo/registry";
import {
  canEditItem,
  filterVisibleItems,
  viewerContext,
} from "@backend/services/pmo/viewer";
import {
  parseWorkItemId,
  WORK_STATUSES,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemQuery,
  type WorkSource,
} from "@/shared/pmo/types";

export const pmoRouter = new Hono<{ Bindings: Env }>();

const SOURCES = ["plan", "planning", "clickup"] as const;
const HEALTHS = ["on_track", "at_risk", "blocked", "unknown"] as const;
const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Now" as an ISO date, computed once per request so health derivation is stable. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const querySchema = z.object({
  source: z.enum(SOURCES).optional(),
  container: z.string().min(1).optional(),
  status: z.enum(WORK_STATUSES as unknown as [string, ...string[]]).optional(),
  health: z.enum(HEALTHS).optional(),
  phase: z.coerce.number().int().optional(),
  assignee: z.coerce.number().int().positive().optional(),
});

// PATCH body. Every field optional; `null` is meaningful (clears the field), so
// nullable fields are `.nullable()`, not merely `.optional()`.
const patchSchema = z
  .object({
    status: z.enum(WORK_STATUSES as unknown as [string, ...string[]]),
    priority: z.enum(PRIORITIES).nullable(),
    progressPct: z.number().int().min(0).max(100).nullable(),
    startAt: z.string().regex(ISO_DATE).nullable(),
    dueAt: z.string().regex(ISO_DATE).nullable(),
    sortOrder: z.number().int(),
    notes: z.string().nullable(),
  })
  .partial();

/**
 * GET /api/pmo/work-items
 *
 * With `?source=`, reads that one adapter; without it, reads every adapter and
 * concatenates. Status and health filter in WorkItem-space (health is derived),
 * so they are applied by the adapters after mapping.
 */
pmoRouter.get("/work-items", async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const db = drizzle(c.env.DB);
  const today = todayIso();

  const query: WorkItemQuery = {
    source: q.source as WorkSource | undefined,
    container: q.container,
    status: q.status as WorkItemQuery["status"],
    health: q.health as WorkItemQuery["health"],
    phase: q.phase,
    assigneeParticipantId: q.assignee,
  };

  let items: WorkItem[] = [];
  if (q.source) {
    const adapter = adapterFor(q.source as WorkSource);
    // A known-but-unimplemented source (clickup pre-P6) is an empty list, not an
    // error — the surface exists, it just has no adapter yet.
    if (adapter) items = await adapter.list(db, query, today);
  } else {
    const lists = await Promise.all(ALL_ADAPTERS.map((a) => a.list(db, query, today)));
    items = lists.flat();
  }

  const viewer = await viewerContext(c);
  const visible = await filterVisibleItems(db, viewer, items);
  return c.json({ items: visible, total: visible.length });
});

/**
 * PATCH /api/pmo/work-items/:id
 *
 * `:id` is the composite `${source}:${nativeId}`. Dispatches to the owning
 * adapter, which honors only the fields its source supports. Uses `db.batch`
 * inside adapters where multiple statements are needed — never `db.transaction`,
 * which is dead on D1.
 */
pmoRouter.patch("/work-items/:id", async (c) => {
  const id = c.req.param("id");
  let source: WorkSource;
  let nativeId: string;
  try {
    ({ source, nativeId } = parseWorkItemId(id));
  } catch {
    return c.json({ error: `Malformed work item id: ${id}` }, 400);
  }

  const adapter = adapterFor(source);
  if (!adapter) return c.json({ error: `No adapter for source: ${source}` }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Body must be JSON" }, 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid patch", details: parsed.error.flatten() }, 400);
  }

  const db = drizzle(c.env.DB);
  const viewer = await viewerContext(c);
  if (!(await canEditItem(db, viewer, id))) {
    return c.json({ error: "Not permitted to edit this item" }, 403);
  }

  const updated = await adapter.patch(db, nativeId, parsed.data as WorkItemPatch, todayIso());
  if (!updated) return c.json({ error: "Work item not found" }, 404);
  return c.json({ item: updated });
});
