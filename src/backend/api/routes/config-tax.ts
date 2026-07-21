/**
 * @fileoverview Sales-tax configuration API — `/api/config/tax`.
 *
 * One rate: the one applying to goods delivered to the property. CA district tax
 * on delivered goods is sourced to the delivery location, so a quote from a
 * showroom in another county should still bill OUR rate. The quote states what
 * it charged; this states what it should have charged.
 *
 * Resolved automatically from CDTFA's free address lookup, using the property
 * address already configured at `/admin/config/address`. Mounted behind
 * requireAccessAuth (wired in api/index.ts).
 *
 *   GET  /            — current rate + address + history (resolves on first use)
 *   POST /refresh     — re-check CDTFA now
 *   PUT  /            — manual override
 *
 * Conventions (matching brands.ts / config.ts in this folder):
 *   - Hand-written Zod v4 schemas. `drizzle-zod` is banned repo-wide — it breaks
 *     `pnpm run build` on the pinned drizzle-orm@0.33.0 even though `tsc` passes.
 *   - `OpenAPIHono` + `createRoute`, so /openapi.json and /scalar describe this.
 *   - `drizzle(c.env.DB)` per request — no global mutable state.
 *   - Error envelope `{ error: { code, message } }`.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";

import {
  ensureDeliveryRate,
  getPropertyAddress,
  listRateHistory,
  percentToPpm,
  ppmToPercent,
  recordRate,
} from "@backend/services/tax";
import type { SalesTaxRate } from "@backend/db";

export const configTaxRouter = new OpenAPIHono<{ Bindings: Env }>();

/**
 * A rate as sent to clients. `ratePercent` is derived at serialization time —
 * computed, never stored, so it cannot drift from `ratePpm`.
 */
const rateSchema = z.object({
  id: z.number().int(),
  ratePpm: z.number().int(),
  ratePercent: z.number(),
  jurisdiction: z.string().nullable(),
  county: z.string().nullable(),
  tac: z.string().nullable(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  source: z.string(),
  resolvedAddress: z.string().nullable(),
  notes: z.string().nullable(),
});

const addressSchema = z.object({
  address: z.string(),
  city: z.string(),
  zip: z.string(),
  formatted: z.string(),
});

const configSchema = z.object({
  rate: rateSchema.nullable(),
  address: addressSchema.nullable(),
  history: z.array(rateSchema),
  /** Present when a lookup failed or the address is incomplete. Not fatal. */
  warning: z.string().nullable(),
});

function toDto(r: SalesTaxRate) {
  return { ...r, ratePercent: ppmToPercent(r.ratePpm) };
}

// ─── GET / ───────────────────────────────────────────────────────────────────

configTaxRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    summary: "Current delivery tax rate, address, and rate history",
    description:
      "Resolves the rate from CDTFA on first use. A lookup failure returns the stored rate with a warning rather than an error — a failed fetch must never erase a good rate.",
    responses: {
      200: { description: "Tax config", content: { "application/json": { schema: configSchema } } },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const { rate, address, error } = await ensureDeliveryRate(db);
    const history = await listRateHistory(db);
    return c.json({
      rate: rate ? toDto(rate) : null,
      address,
      history: history.map(toDto),
      warning: error ?? null,
    });
  },
);

// ─── POST /refresh ───────────────────────────────────────────────────────────

configTaxRouter.openapi(
  createRoute({
    method: "post",
    path: "/refresh",
    summary: "Re-check the rate against CDTFA",
    description:
      "Forces a fresh lookup. A manually-set rate is left alone unless `overrideManual` is true, so a re-check never silently undoes a deliberate human decision.",
    request: {
      body: {
        required: false,
        content: {
          "application/json": {
            schema: z.object({ overrideManual: z.boolean().optional() }),
          },
        },
      },
    },
    responses: {
      200: { description: "Tax config", content: { "application/json": { schema: configSchema } } },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = await c.req.json().catch(() => ({}) as { overrideManual?: boolean });
    const { rate, address, error } = await ensureDeliveryRate(db, {
      force: true,
      overrideManual: body?.overrideManual === true,
    });
    const history = await listRateHistory(db);
    return c.json({
      rate: rate ? toDto(rate) : null,
      address,
      history: history.map(toDto),
      warning: error ?? null,
    });
  },
);

// ─── PUT / ───────────────────────────────────────────────────────────────────

configTaxRouter.openapi(
  createRoute({
    method: "put",
    path: "/",
    summary: "Set the rate manually",
    description:
      "Records a manual rate, superseding whatever was in effect. Use when CDTFA cannot resolve the address — e.g. it sits on a jurisdiction boundary and returns several candidates.",
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z.object({
              ratePercent: z.number().min(0).max(20),
              jurisdiction: z.string().min(1).optional(),
              notes: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Tax config", content: { "application/json": { schema: configSchema } } },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    // Range is enforced by the Zod schema above (0–20%), so there is no separate
    // validity branch here — zod-openapi rejects an out-of-range body before the
    // handler runs.
    const body = c.req.valid("json");
    const ratePpm = percentToPpm(body.ratePercent);

    const address = await getPropertyAddress(db);
    const rate = await recordRate(db, {
      ratePpm,
      jurisdiction: body.jurisdiction ?? null,
      source: "manual",
      resolvedAddress: address?.formatted ?? null,
      notes: body.notes ?? null,
    });
    const history = await listRateHistory(db);
    return c.json({ rate: toDto(rate), address, history: history.map(toDto), warning: null });
  },
);
