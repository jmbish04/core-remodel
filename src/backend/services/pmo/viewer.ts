/**
 * @fileoverview The single authorization decision point for PMO — 0028 P0.
 *
 * Every PMO read routes through `viewerContext()` and `filterVisibleItems()`.
 * That is the whole design: when 0029 lands real per-person logins, ONLY this
 * file changes, and every board, grid, Gantt and endpoint inherits the new
 * rules for free.
 *
 * ## What is true today
 *
 * The live gate is a single shared-password cookie (`remodel_access`), so every
 * authenticated caller IS the homeowner. `viewerContext()` therefore returns
 * `{ isAdmin: true }` and `filterVisibleItems()` is a pass-through. The seam is
 * real even though the gate is open — the watcher table, the roles, and the
 * filter are all in place and exercised, just with one privileged viewer.
 *
 * ## What 0029 will change (and nothing else)
 *
 * `viewerContext()` will resolve the signed-in person to a `participantId` and
 * decide `isAdmin` from their role. The non-admin branch of `filterVisibleItems`
 * is already written and correct: an item is visible only if the viewer holds a
 * `work_item_watchers` row on it. So 0029 is "make viewerContext return the real
 * person", not an authorization audit.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";

import { isRequestAuthenticated } from "@backend/utils/access";
import { workItemWatchers } from "@backend/db/schema/plans/index";
import type { RemodelDb } from "@backend/mcp/types";
import { parseWorkItemId, type WorkItem, type WorkSource } from "@/shared/pmo/types";

export interface ViewerContext {
  /**
   * The signed-in person, or null. Null today because the shared-password cookie
   * carries no identity — 0029 populates it.
   */
  participantId: number | null;
  /** Admins see everything. Everyone else sees only what they watch. */
  isAdmin: boolean;
}

/**
 * Resolve the viewer for a request.
 *
 * TODAY: an authenticated request is the homeowner → admin. An unauthenticated
 * one is nobody (the caller should already have been rejected by
 * `requireAccessAuth`, but this stays honest if the seam is ever reached raw).
 */
export async function viewerContext(c: Context<{ Bindings: Env }>): Promise<ViewerContext> {
  const authed = await isRequestAuthenticated(c.req.raw, c.env);
  return { participantId: null, isAdmin: authed };
}

/**
 * Filter a list of work items down to what the viewer may see.
 *
 * Admin → the list unchanged. Otherwise → only items the viewer holds a watcher
 * row on. Written against the watcher table, not stubbed, so it is correct the
 * moment `viewerContext` starts returning a real `participantId`.
 */
export async function filterVisibleItems(
  db: RemodelDb,
  viewer: ViewerContext,
  items: WorkItem[],
): Promise<WorkItem[]> {
  if (viewer.isAdmin) return items;
  if (viewer.participantId == null) return []; // no identity → sees nothing
  if (items.length === 0) return items;

  // One query for every (source, nativeId) this viewer watches among the batch.
  const bySource = new Map<WorkSource, string[]>();
  for (const it of items) {
    const arr = bySource.get(it.source) ?? [];
    arr.push(it.nativeId);
    bySource.set(it.source, arr);
  }

  const visible = new Set<string>();
  for (const [source, nativeIds] of bySource) {
    const rows = await db
      .select({ itemNativeId: workItemWatchers.itemNativeId })
      .from(workItemWatchers)
      .where(
        and(
          eq(workItemWatchers.participantId, viewer.participantId),
          eq(workItemWatchers.source, source),
          inArray(workItemWatchers.itemNativeId, nativeIds),
        ),
      );
    for (const r of rows) visible.add(`${source}:${r.itemNativeId}`);
  }

  return items.filter((it) => visible.has(`${it.source}:${it.nativeId}`));
}

/**
 * May this viewer WRITE to this item?
 *
 * Admin → yes. Otherwise → only if they hold a watcher row with `can_edit`.
 * Used by the PATCH endpoint before dispatching to an adapter.
 */
export async function canEditItem(
  db: RemodelDb,
  viewer: ViewerContext,
  itemId: string,
): Promise<boolean> {
  if (viewer.isAdmin) return true;
  if (viewer.participantId == null) return false;
  const { source, nativeId } = parseWorkItemId(itemId);
  const [row] = await db
    .select({ canEdit: workItemWatchers.canEdit })
    .from(workItemWatchers)
    .where(
      and(
        eq(workItemWatchers.participantId, viewer.participantId),
        eq(workItemWatchers.source, source),
        eq(workItemWatchers.itemNativeId, nativeId),
        eq(workItemWatchers.canEdit, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}
