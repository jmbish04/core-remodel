/**
 * Enrich rows that carry a nullable `serviceId` with the linked service's
 * `serviceName`, so detail GETs echo a display name and the UI doesn't fall
 * back to `Service #<id>` until a full refetch.
 *
 * Batched `WHERE id IN (...)` lookup; rows with a null (or dangling) serviceId
 * get `serviceName: null`. Ids are chunked at 100 to stay under D1's bound-
 * parameter ceiling.
 */
import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { services } from "@backend/db/schema/services/services";

export async function attachServiceNames<T extends { serviceId?: number | null }>(
  db: DrizzleD1Database,
  rows: T[],
): Promise<(T & { serviceName: string | null })[]> {
  const ids = Array.from(
    new Set(rows.map((r) => r.serviceId).filter((id): id is number => id != null)),
  );
  if (ids.length === 0) {
    return rows.map((r) => ({ ...r, serviceName: null }));
  }
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 100) {
    chunks.push(ids.slice(i, i + 100));
  }
  const found = (
    await Promise.all(
      chunks.map((chunk) =>
        db.select({ id: services.id, name: services.name }).from(services).where(inArray(services.id, chunk)).all(),
      ),
    )
  ).flat();
  const nameById = new Map(found.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    ...r,
    serviceName: r.serviceId != null ? nameById.get(r.serviceId) ?? null : null,
  }));
}
