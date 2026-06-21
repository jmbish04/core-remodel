import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../../../backend/db";
import { prospectState, callAttempts } from "../../../backend/db/schemas";
import { logEvent } from "../../../backend/lib/logger";

export const stateRouter = new OpenAPIHono<{ Bindings: Env }>();

const StatePatch = z.object({
  disposition: z.enum(["not_called", "attempted", "no_answer", "voicemail", "connected"]).optional(),
  rating: z.number().min(1).max(5).nullable().optional(),
  favorite: z.boolean().optional(),
  leftVoicemail: z.boolean().optional(),
  availableToHire: z.boolean().nullable().optional(),
  goodFeeling: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const patchRoute = createRoute({
  method: "patch",
  path: "/{id}/state",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: StatePatch } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Updated" },
  },
});

stateRouter.openapi(patchRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const set: Record<string, unknown> = { prospectId: id, updatedAt: sql`CURRENT_TIMESTAMP` };
  for (const [k, v] of Object.entries(body)) set[k] = v;

  await db
    .insert(prospectState)
    .values(set as typeof prospectState.$inferInsert)
    .onConflictDoUpdate({ target: prospectState.prospectId, set });

  await logEvent(c.env.DB, "info", "prospects.state.patch", `state updated for ${id}`, body);
  return c.json({ ok: true });
});

const CallBody = z.object({
  outcome: z.enum(["no_answer", "voicemail", "connected", "callback"]),
  note: z.string().nullable().optional(),
});

const callRoute = createRoute({
  method: "post",
  path: "/{id}/call",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: CallBody } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean(), callCount: z.number() }) } }, description: "Logged" },
  },
});

stateRouter.openapi(callRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { outcome, note } = c.req.valid("json");
  const db = createDb(c.env.DB);

  await db.insert(callAttempts).values({ prospectId: id, outcome, note: note ?? null });

  const disposition = outcome === "callback" ? "attempted" : outcome;
  const leftVoicemail = outcome === "voicemail";

  const existing = (await db.select().from(prospectState).where(eq(prospectState.prospectId, id)))[0];
  const callCount = (existing?.callCount ?? 0) + 1;

  const set = {
    prospectId: id,
    disposition,
    callCount,
    leftVoicemail: leftVoicemail || (existing?.leftVoicemail ?? false),
    lastContactedAt: sql`CURRENT_TIMESTAMP`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as typeof prospectState.$inferInsert;

  await db.insert(prospectState).values(set).onConflictDoUpdate({ target: prospectState.prospectId, set });

  await logEvent(c.env.DB, "info", "prospects.call", `call logged for ${id}: ${outcome}`);
  return c.json({ ok: true, callCount });
});

const emailedRoute = createRoute({
  method: "post",
  path: "/{id}/emailed",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.object({ ok: z.boolean() }) } }, description: "Marked emailed" },
  },
});

stateRouter.openapi(emailedRoute, async (c) => {
  const { id } = c.req.valid("param");
  const db = createDb(c.env.DB);
  const set = {
    prospectId: id,
    emailedAt: sql`CURRENT_TIMESTAMP`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  } as typeof prospectState.$inferInsert;
  await db.insert(prospectState).values(set).onConflictDoUpdate({ target: prospectState.prospectId, set });
  await logEvent(c.env.DB, "info", "prospects.emailed", `emailed ${id}`);
  return c.json({ ok: true });
});
