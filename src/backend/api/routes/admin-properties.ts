/**
 * @fileoverview Property / origin configuration API — `/api/admin/properties`.
 *
 * The target property is the single origin for permits, drive routing, and
 * showroom proximity (plan 0032). This route reads and writes the ONE primary
 * property, geocoding the address on write so every distance consumer reads
 * cached `lat/lng` instead of re-geocoding.
 *
 * Mounted under `/api/admin/*`, so `requireAccessAuth` gates it (api/index.ts).
 *
 *   GET /  — the primary property (resolves from the table, else the legacy KV)
 *   PUT /  — upsert the primary property from structured parts + geocode
 *
 * Conventions (matching config-tax.ts / brands.ts):
 *   - Hand-written Zod v4 (drizzle-zod is banned repo-wide).
 *   - `OpenAPIHono` + `createRoute`; `drizzle(c.env.DB)` per request.
 *   - Error envelope `{ error: { code, message } }`.
 *   - Address is stored as STRUCTURED PARTS; the display string is derived, never stored.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { properties } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import { formatPropertyAddress, getPrimaryProperty } from "@backend/services/property";

export const adminPropertiesRouter = new OpenAPIHono<{ Bindings: Env }>();

const propertySchema = z.object({
  id: z.number().int().nullable(),
  label: z.string().nullable(),
  streetNumber: z.string().nullable(),
  streetName: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zipCode: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  placeId: z.string().nullable(),
  googleMapsLink: z.string().nullable(),
  formattedAddress: z.string(),
  source: z.enum(["properties", "config_fallback"]),
});

const responseSchema = z.object({
  property: propertySchema.nullable(),
  /** Present when geocoding failed — stored parts kept, coords null. Not fatal. */
  warning: z.string().nullable(),
});

const upsertBody = z.object({
  label: z.string().optional(),
  streetNumber: z.string().optional(),
  streetName: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  sfAssessorBlock: z.string().optional(),
  sfAssessorLot: z.string().optional(),
});

// ─── GET / ─────────────────────────────────────────────────────────────────

adminPropertiesRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    summary: "The primary property / origin",
    description:
      "Resolves the active property from the `properties` table (`is_primary`), falling back to the legacy permit-config KV so it answers before any backfill.",
    responses: {
      200: { description: "Primary property", content: { "application/json": { schema: responseSchema } } },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const property = await getPrimaryProperty(db);
    return c.json({ property, warning: null });
  },
);

// ─── PUT / ─────────────────────────────────────────────────────────────────

adminPropertiesRouter.openapi(
  createRoute({
    method: "put",
    path: "/",
    summary: "Upsert the primary property (geocode on write)",
    description:
      "Writes the primary property from structured parts and geocodes the assembled address to cache lat/lng. Only one row is `is_primary`. A geocode failure stores the parts with null coords and returns a warning — never a 500.",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: upsertBody } },
      },
    },
    responses: {
      200: { description: "Primary property", content: { "application/json": { schema: responseSchema } } },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");

    // Geocode the derived address (never a stored raw string) to cache coords.
    const query = formatPropertyAddress(body);
    let latitude: number | null = null;
    let longitude: number | null = null;
    let placeId: string | null = null;
    let warning: string | null = null;
    if (query) {
      try {
        const place = await new GoogleMapsService(c.env).placesTextSearch(query);
        if (place?.latitude != null && place.longitude != null) {
          latitude = place.latitude;
          longitude = place.longitude;
          placeId = (place as { placeId?: string }).placeId ?? null;
        } else {
          warning = "Address could not be geocoded — coordinates left empty.";
        }
      } catch {
        warning = "Geocode lookup failed — coordinates left empty.";
      }
    }

    const values = {
      isPrimary: true,
      label: body.label ?? null,
      streetNumber: body.streetNumber ?? null,
      streetName: body.streetName ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zipCode: body.zipCode ?? null,
      placeId,
      googleMapsLink: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : null,
      latitude,
      longitude,
      sfAssessorBlock: body.sfAssessorBlock ?? null,
      sfAssessorLot: body.sfAssessorLot ?? null,
      updatedAt: new Date(),
    };

    // Upsert the single primary row (the partial unique index allows only one).
    const [existing] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.isPrimary, true))
      .limit(1);
    if (existing) {
      await db.update(properties).set(values).where(eq(properties.id, existing.id));
    } else {
      await db.insert(properties).values(values);
    }

    const property = await getPrimaryProperty(db);
    return c.json({ property, warning });
  },
);
