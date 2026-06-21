import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, like, or, sql } from "drizzle-orm";
import { createDb } from "../../../backend/db";
import { prospects, prospectState } from "../../../backend/db/schemas";
import { logEvent } from "../../../backend/lib/logger";

export const prospectsRouter = new OpenAPIHono<{ Bindings: Env }>();

const ProspectRow = z.object({
  id: z.string(),
  rank: z.number(),
  fullName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  firm: z.string().nullable(),
  roles: z.string(),
  permitCount: z.number(),
  avgCost: z.number().nullable(),
  medianCost: z.number().nullable(),
  scopeKeywords: z.string().nullable(),
  isUnbundledCandidate: z.boolean(),
  collisionRisk: z.boolean(),
  phone: z.string().nullable(),
  phoneSource: z.string().nullable(),
  email: z.string().nullable(),
  emailSource: z.string().nullable(),
  website: z.string().nullable(),
  contactStatus: z.string(),
  licenseNote: z.string().nullable(),
  callScript: z.string(),
  // joined state
  disposition: z.string(),
  rating: z.number().nullable(),
  favorite: z.boolean(),
  leftVoicemail: z.boolean(),
  availableToHire: z.boolean().nullable(),
  goodFeeling: z.boolean().nullable(),
  notes: z.string().nullable(),
  callCount: z.number(),
  emailedAt: z.string().nullable(),
  lastContactedAt: z.string().nullable(),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: z.object({
      status: z.enum(["all", "not_called", "called", "favorites"]).optional(),
      hideUnavailable: z.enum(["true", "false"]).optional(),
      q: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ prospects: z.array(ProspectRow) }) } },
      description: "List prospects with call state",
    },
  },
});

prospectsRouter.openapi(listRoute, async (c) => {
  const { status, hideUnavailable, q } = c.req.valid("query");
  const db = createDb(c.env.DB);

  const rows = await db
    .select({
      id: prospects.id,
      rank: prospects.rank,
      fullName: prospects.fullName,
      firstName: prospects.firstName,
      lastName: prospects.lastName,
      firm: prospects.firm,
      roles: prospects.roles,
      permitCount: prospects.permitCount,
      avgCost: prospects.avgCost,
      medianCost: prospects.medianCost,
      scopeKeywords: prospects.scopeKeywords,
      isUnbundledCandidate: prospects.isUnbundledCandidate,
      collisionRisk: prospects.collisionRisk,
      phone: prospects.phone,
      phoneSource: prospects.phoneSource,
      email: prospects.email,
      emailSource: prospects.emailSource,
      website: prospects.website,
      contactStatus: prospects.contactStatus,
      licenseNote: prospects.licenseNote,
      callScript: prospects.callScript,
      disposition: sql<string>`coalesce(${prospectState.disposition}, 'not_called')`,
      rating: prospectState.rating,
      favorite: sql<boolean>`coalesce(${prospectState.favorite}, 0)`,
      leftVoicemail: sql<boolean>`coalesce(${prospectState.leftVoicemail}, 0)`,
      availableToHire: prospectState.availableToHire,
      goodFeeling: prospectState.goodFeeling,
      notes: prospectState.notes,
      callCount: sql<number>`coalesce(${prospectState.callCount}, 0)`,
      emailedAt: prospectState.emailedAt,
      lastContactedAt: prospectState.lastContactedAt,
    })
    .from(prospects)
    .leftJoin(prospectState, eq(prospects.id, prospectState.prospectId))
    .orderBy(prospects.rank);

  let out = rows;
  if (status === "not_called") out = out.filter((r) => (r.callCount ?? 0) === 0);
  if (status === "called") out = out.filter((r) => (r.callCount ?? 0) > 0);
  if (status === "favorites") out = out.filter((r) => !!r.favorite);
  if (hideUnavailable === "true") out = out.filter((r) => r.availableToHire !== false);
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter(
      (r) =>
        r.fullName.toLowerCase().includes(needle) ||
        (r.firm ?? "").toLowerCase().includes(needle) ||
        r.roles.toLowerCase().includes(needle),
    );
  }

  await logEvent(c.env.DB, "info", "prospects.list", `listed ${out.length} prospects`, { status, q });
  return c.json({ prospects: out });
});

const detailRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: ProspectRow } }, description: "One prospect" },
    404: { content: { "application/json": { schema: z.object({ error: z.string() }) } }, description: "Not found" },
  },
});

prospectsRouter.openapi(detailRoute, async (c) => {
  const { id } = c.req.valid("param");
  const db = createDb(c.env.DB);
  const row = (
    await db
      .select()
      .from(prospects)
      .leftJoin(prospectState, eq(prospects.id, prospectState.prospectId))
      .where(eq(prospects.id, id))
  )[0];
  if (!row) return c.json({ error: "not found" }, 404);

  const p = row.prospects;
  const s = row.prospect_state;
  return c.json({
    ...p,
    disposition: s?.disposition ?? "not_called",
    rating: s?.rating ?? null,
    favorite: s?.favorite ?? false,
    leftVoicemail: s?.leftVoicemail ?? false,
    availableToHire: s?.availableToHire ?? null,
    goodFeeling: s?.goodFeeling ?? null,
    notes: s?.notes ?? null,
    callCount: s?.callCount ?? 0,
    emailedAt: s?.emailedAt ?? null,
    lastContactedAt: s?.lastContactedAt ?? null,
  });
});
