/**
 * @fileoverview Resolve the target property / routing origin from ONE place.
 *
 * Plan 0032: the property used to live in three unrelated spots — the
 * `project_system_variables` KV (`permits_target_*`), a hardcoded
 * `"126 Colby St, San Francisco, CA"` origin scattered through the code, and a
 * denormalized `permits_records.property_address`. `getPrimaryProperty` is the
 * single reader every consumer (drives, showroom distance, permits) calls.
 *
 * It prefers the new `properties` table (`is_primary`), and falls back to the
 * legacy config KV so it works BEFORE the backfill has run — no consumer needs
 * to know which source answered.
 */
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { projectSystemVariables, properties } from "@backend/db";

type RemodelDb = ReturnType<typeof drizzle>;

export interface ResolvedProperty {
  id: number | null;
  label: string | null;
  streetNumber: string | null;
  streetName: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  googleMapsLink: string | null;
  /** Display address, DERIVED from the parts — never a stored raw string. */
  formattedAddress: string;
  /** Which source answered — useful for a "backfill me" nudge in the UI. */
  source: "properties" | "config_fallback";
}

/** Build a display address from structured parts. Shared with the showroom refactor. */
export function formatPropertyAddress(p: {
  streetNumber?: string | null;
  streetName?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): string {
  const street = [p.streetNumber, p.streetName].filter(Boolean).join(" ").trim();
  const cityState = [p.city, p.state].filter(Boolean).join(", ").trim();
  return [street, cityState, p.zipCode].filter(Boolean).join(", ").trim();
}

/**
 * The active property. Returns null only when neither the table nor the config
 * KV has an address at all.
 */
export async function getPrimaryProperty(db: RemodelDb): Promise<ResolvedProperty | null> {
  const [row] = await db
    .select()
    .from(properties)
    .where(eq(properties.isPrimary, true))
    .limit(1);

  if (row) {
    return {
      id: row.id,
      label: row.label,
      streetNumber: row.streetNumber,
      streetName: row.streetName,
      city: row.city,
      state: row.state,
      zipCode: row.zipCode,
      latitude: row.latitude,
      longitude: row.longitude,
      placeId: row.placeId,
      googleMapsLink: row.googleMapsLink,
      formattedAddress: formatPropertyAddress(row),
      source: "properties",
    };
  }

  // Fallback: the legacy permit-pipeline config KV, so callers work pre-backfill.
  const rows = await db
    .select({ key: projectSystemVariables.variableKey, value: projectSystemVariables.valueText })
    .from(projectSystemVariables)
    .where(
      inArray(projectSystemVariables.variableKey, [
        "permits_target_address",
        "permits_target_city",
        "permits_target_zip",
      ]),
    )
    .all();
  const cfg = new Map(rows.map((r) => [r.key, r.value]));
  const street = cfg.get("permits_target_address");
  if (!street) return null;

  const city = cfg.get("permits_target_city") ?? null;
  const zip = cfg.get("permits_target_zip") ?? null;
  return {
    id: null,
    label: null,
    streetNumber: null,
    // The KV stores a single free-text street line; keep it as streetName so the
    // formatter still assembles a sensible address. The backfill parses it into
    // real parts once it runs.
    streetName: street,
    city,
    state: "CA",
    zipCode: zip,
    latitude: null,
    longitude: null,
    placeId: null,
    googleMapsLink: null,
    formattedAddress: [street, [city, "CA"].filter(Boolean).join(", "), zip]
      .filter(Boolean)
      .join(", ")
      .trim(),
    source: "config_fallback",
  };
}
