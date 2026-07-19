/**
 * @fileoverview Showroom Scout API router — `/api/showroom-scout`
 *
 * HTTP surface over the `ShowroomScout` Durable Object agent. One DO instance
 * per named session, so a scouting day survives reconnects, tab closes and
 * losing signal in a parking garage.
 *
 * Endpoints:
 *   POST /api/showroom-scout/:session/start    Begin a scouting run
 *   POST /api/showroom-scout/:session/update   Live replan while on the road
 *   GET  /api/showroom-scout/:session          Current session state
 *   POST /api/showroom-scout/:session/reset    Clear the session
 *
 * For streaming, clients should connect directly to the agent over WebSocket
 * via `routeAgentRequest` (see `src/_worker.ts`) and read broadcast state — this
 * router is the request/response path for clients that do not hold a socket.
 *
 * Auth: gated by `requireAccessAuth` registered in `src/backend/api/index.ts`.
 * Do not mount this router without that middleware — the agent spends real
 * Gemini and Google Maps quota on every run.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getAgentByName } from "agents";

import type { ShowroomScout } from "@backend/ai/agents/showroom-scout/index";

export const showroomScoutRouter = new OpenAPIHono<{ Bindings: Env }>();

const ErrorSchema = z.object({
  error: z.string().openapi({ description: "Human-readable error message." }),
});

/**
 * Session names become DO ids, so they must be constrained — an unbounded
 * user-supplied string is a cheap way to spawn unlimited Durable Objects.
 */
const SessionParams = z.object({
  session: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "session must be alphanumeric, dash or underscore")
    .openapi({
      param: { name: "session", in: "path" },
      description: "Session id — one scouting day per session.",
      example: "saturday-stone-run",
    }),
});

const TimelineEntrySchema = z.object({
  at: z.number(),
  kind: z.enum(["status", "tool", "error", "result"]),
  message: z.string(),
  tool: z.string().optional(),
  durationMs: z.number().optional(),
});

/**
 * The agent's structured payload is deep and evolves with the model's output;
 * `passthrough` keeps the OpenAPI contract honest about the stable envelope
 * without freezing every nested showroom field into the spec.
 */
const StateSchema = z
  .object({
    status: z.enum(["idle", "planning", "running", "complete", "error"]),
    goal: z.string().nullable(),
    window: z.any().nullable().openapi({ description: "Resolved California time window." }),
    timeline: z.array(TimelineEntrySchema),
    result: z.any().nullable().openapi({ description: "Candidates, route, exclusions, degraded tools." }),
    driveListSlug: z.string().nullable(),
    lastError: z.string().nullable(),
    updatedAt: z.number(),
  })
  .passthrough();

const ReplySchema = z.object({
  reply: z.string().openapi({ description: "The agent's prose response." }),
  state: StateSchema,
});

const StartBodySchema = z.object({
  goal: z
    .string()
    .min(3)
    .max(2000)
    .openapi({
      description: "Natural-language sourcing goal.",
      example: "Find high-end bathroom and plumbing fixture showrooms in Orange County open today.",
    }),
  geography: z.string().max(200).optional().openapi({ example: "Orange County, CA" }),
  homeBase: z
    .string()
    .max(300)
    .optional()
    .openapi({ description: "Where the day starts — the routing origin.", example: "126 Colby St, San Francisco, CA" }),
  when: z
    .string()
    .max(100)
    .optional()
    .openapi({ description: "Time phrase, resolved in California time.", example: "saturday morning" }),
  includeKnown: z
    .boolean()
    .optional()
    .openapi({ description: "Include showrooms already in the directory (default false)." }),
  includeBigBox: z
    .boolean()
    .optional()
    .openapi({ description: "Include big-box retailers (default false)." }),
});

const UpdateBodySchema = z.object({
  message: z
    .string()
    .min(1)
    .max(2000)
    .openapi({ description: "Live update from the road.", example: "Skip the next stop, I'm running 40 min behind." }),
});

/** Resolve the session's DO stub. Returns a promise — always await it. */
function scout(env: Env, session: string) {
  return getAgentByName<Env, ShowroomScout>(env.SHOWROOM_SCOUT, session);
}

/** Agent failures are upstream-model failures — 502, not 500. */
function agentError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

// ─── POST /:session/start ────────────────────────────────────────────────────

showroomScoutRouter.openapi(
  createRoute({
    method: "post",
    path: "/{session}/start",
    tags: ["Showroom Scout"],
    summary: "Start a scouting run",
    description:
      "Discover, vet, score and route remodel showrooms for a shopping day. Big-box retailers and " +
      "showrooms already in the directory are excluded unless explicitly requested. Time phrases " +
      "are resolved in California time.",
    request: {
      params: SessionParams,
      body: { content: { "application/json": { schema: StartBodySchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: ReplySchema } }, description: "Run complete." },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid request." },
      502: { content: { "application/json": { schema: ErrorSchema } }, description: "Agent or model failure." },
    },
  }),
  async (c) => {
    const { session } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const result = await (await scout(c.env, session)).startScout(body);
      return c.json(result, 200);
    } catch (error) {
      console.error("[showroom-scout] start failed", error);
      return c.json(agentError(error), 502);
    }
  },
);

// ─── POST /:session/update ───────────────────────────────────────────────────

showroomScoutRouter.openapi(
  createRoute({
    method: "post",
    path: "/{session}/update",
    tags: ["Showroom Scout"],
    summary: "Replan live while on the road",
    description:
      "Send a mid-drive update — skip a stop, swap the next destination, running behind, only N " +
      "hours left, prioritize a category. The agent re-sequences the route, updates timing, " +
      "preserves business-hour realism and explains the tradeoff.",
    request: {
      params: SessionParams,
      body: { content: { "application/json": { schema: UpdateBodySchema } } },
    },
    responses: {
      200: { content: { "application/json": { schema: ReplySchema } }, description: "Replan complete." },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid request." },
      409: { content: { "application/json": { schema: ErrorSchema } }, description: "No active run in this session." },
      502: { content: { "application/json": { schema: ErrorSchema } }, description: "Agent or model failure." },
    },
  }),
  async (c) => {
    const { session } = c.req.valid("param");
    const { message } = c.req.valid("json");
    try {
      const result = await (await scout(c.env, session)).sendUpdate(message);
      return c.json(result, 200);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.includes("No active scouting run")) return c.json({ error: detail }, 409);
      console.error("[showroom-scout] update failed", error);
      return c.json(agentError(error), 502);
    }
  },
);

// ─── GET /:session ───────────────────────────────────────────────────────────

showroomScoutRouter.openapi(
  createRoute({
    method: "get",
    path: "/{session}",
    tags: ["Showroom Scout"],
    summary: "Get session state",
    description:
      "Current status, tool timeline, published candidates and route. Use this to resume after a " +
      "reconnect; for live updates prefer the agent WebSocket.",
    request: { params: SessionParams },
    responses: {
      200: { content: { "application/json": { schema: StateSchema } }, description: "Session state." },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid session id." },
      502: { content: { "application/json": { schema: ErrorSchema } }, description: "Agent unavailable." },
    },
  }),
  async (c) => {
    const { session } = c.req.valid("param");
    try {
      return c.json(await (await scout(c.env, session)).getScoutState(), 200);
    } catch (error) {
      console.error("[showroom-scout] state read failed", error);
      return c.json(agentError(error), 502);
    }
  },
);

// ─── POST /:session/reset ────────────────────────────────────────────────────

showroomScoutRouter.openapi(
  createRoute({
    method: "post",
    path: "/{session}/reset",
    tags: ["Showroom Scout"],
    summary: "Reset a session",
    description: "Clear goal, timeline, candidates and route for this session.",
    request: { params: SessionParams },
    responses: {
      200: { content: { "application/json": { schema: StateSchema } }, description: "Cleared state." },
      400: { content: { "application/json": { schema: ErrorSchema } }, description: "Invalid session id." },
      502: { content: { "application/json": { schema: ErrorSchema } }, description: "Agent unavailable." },
    },
  }),
  async (c) => {
    const { session } = c.req.valid("param");
    try {
      return c.json(await (await scout(c.env, session)).reset(), 200);
    } catch (error) {
      console.error("[showroom-scout] reset failed", error);
      return c.json(agentError(error), 502);
    }
  },
);
