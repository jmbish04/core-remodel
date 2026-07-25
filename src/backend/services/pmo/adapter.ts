/**
 * @fileoverview The `WorkItemAdapter` contract — 0028 Phase 0.
 *
 * One adapter per source table. Every PMO surface reads and writes through this
 * interface and never touches a source table directly, so the components stay
 * source-blind and ClickUp becomes a third adapter (P6) rather than a rewrite.
 *
 * The `today` parameter is threaded through reads rather than read from the
 * clock inside the adapter: health derivation depends on it (see `deriveHealth`),
 * and passing it keeps a single request internally consistent and the whole
 * thing testable.
 */
import type { RemodelDb } from "@backend/mcp/types";
import type { WorkItem, WorkItemPatch, WorkItemQuery, WorkSource } from "@/shared/pmo/types";

export interface WorkItemAdapter {
  /** Which source this adapter owns. The registry dispatches on it. */
  readonly source: WorkSource;

  /** List items matching `query`. `today` (ISO date) drives health derivation. */
  list(db: RemodelDb, query: WorkItemQuery, today: string): Promise<WorkItem[]>;

  /** One item by its native id, or null. */
  get(db: RemodelDb, nativeId: string, today: string): Promise<WorkItem | null>;

  /**
   * Apply a patch and return the updated item, or null if the id is unknown.
   * The adapter honors only the fields its source supports and silently ignores
   * the rest — a caller cannot know which source an item came from, so it may
   * send a superset.
   */
  patch(
    db: RemodelDb,
    nativeId: string,
    patch: WorkItemPatch,
    today: string,
  ): Promise<WorkItem | null>;
}
