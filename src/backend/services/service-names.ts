/**
 * Enrich rows that carry a nullable `serviceId` with the linked service's
 * `serviceName`, so detail GETs echo a display name and the UI doesn't fall
 * back to `Service #<id>` until a full refetch.
 *
 * One `WHERE id IN (...)` lookup for the whole batch; rows with a null (or
 * dangling) serviceId get `serviceName: null`.
 */
import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { services } from "@backend/db/schema/services/services";

export async function attachServiceNames<T extends { serviceId: number | null }>(
  db: DrizzleD1Database,
  rows: T[],
): Promise<(T & { serviceName: string | null })[]> {
  const ids = Array.from(
    new Set(rows.map((r) => r.serviceId).filter((id): id is number => id != null)),
  );
  if (ids.length === 0) {
    return rows.map((r) => ({ ...r, serviceName: null }));
  }
  const found = await db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(inArray(services.id, ids))
    .all();
  const nameById = new Map(found.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    ...r,
    serviceName: r.serviceId != null ? nameById.get(r.serviceId) ?? null : null,
  }));
}
