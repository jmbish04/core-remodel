/**
 * @fileoverview Adapter registry — the one place source → adapter is resolved.
 */
import type { WorkSource } from "@/shared/pmo/types";
import type { WorkItemAdapter } from "./adapter";
import { planAdapter } from "./adapters/plan";
import { planningAdapter } from "./adapters/planning";

/** Every adapter, keyed by source. ClickUp joins here in P6. */
export const ADAPTERS: Record<Exclude<WorkSource, "clickup">, WorkItemAdapter> = {
  plan: planAdapter,
  planning: planningAdapter,
};

/** All adapters as a list, for the source-agnostic "everything" read. */
export const ALL_ADAPTERS: WorkItemAdapter[] = Object.values(ADAPTERS);

/** Resolve the adapter that owns a source, or null if none (e.g. clickup pre-P6). */
export function adapterFor(source: WorkSource): WorkItemAdapter | null {
  return (ADAPTERS as Record<string, WorkItemAdapter>)[source] ?? null;
}
