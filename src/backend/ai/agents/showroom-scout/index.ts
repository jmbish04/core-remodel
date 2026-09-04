/**
 * @fileoverview Showroom Scout — Durable Object agent.
 *
 * Two runtimes, one job, with a clean split of ownership:
 *
 *   Cloudflare Agents SDK (this class) owns the DURABLE concerns —
 *     identity, session state, streaming transport to connected clients,
 *     resumability across reconnects, conversation history, route persistence.
 *
 *   OpenAI Agents SDK (`run()` below) owns the COGNITIVE concerns —
 *     goal interpretation, multi-step planning, tool orchestration, scoring,
 *     and route adaptation.
 *
 * State changes are broadcast to every connected client by `setState`, so the
 * frontend gets progressive status, tool progress and the final route for free,
 * and a phone that drops signal mid-drive resumes with full context.
 *
 * Workers caveat (documented SDK limitation): `AsyncLocalStorage` is only
 * partially supported here, so OpenAI's tracing is unreliable. Rather than ship
 * broken traces we disable that exporter and emit our own structured events
 * into the state timeline, which is what actually drives the UI anyway.
 */
import type { McpProps } from "@backend/mcp/types";

import { run, setTracingDisabled, tool, type AgentInputItem } from "@openai/agents";
import { Agent as OpenAIAgent } from "@openai/agents";
import { Agent, callable } from "agents";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { extractOfferableDetours, findMissedDetours, type OfferableDetour } from "./detours";
import { buildInstructions } from "./instructions";
import { bridgeTools, type ToolEvent } from "./mcp-bridge";
import { createScoutModel, resolveScoutModelConfig } from "./model";
import { SCOUT_RETRY } from "./retry";
import { routePlanSchema, showroomCandidateSchema } from "./schemas";
import { resolveWindow, type CaWindow } from "./time";
import { createWebSearchTool } from "./tools/web-search";

// Tracing exports to OpenAI's backend and needs an OpenAI key we deliberately
// do not have. Disable once at module scope; our own timeline is the trace.
setTracingDisabled(true);

/**
 * Registry tools the scout may call. An explicit allow-list, not the whole
 * ~90-tool registry: a focused surface measurably improves tool selection and
 * keeps unrelated destructive tools (budget writes, render jobs) off the table.
 */
const SCOUT_TOOL_ALLOWLIST = [
  "search_showrooms",
  "import_showroom_from_place",
  "find_known_showrooms",
  "list_showrooms",
  "get_showroom",
  "plan_drive_route",
  "create_drive_list",
  "analyze_drive_coverage",
  // Vehicle context: the scout plans a driving day, so where the car is and
  // whether the integration is even alive are legitimate inputs. Read-only —
  // send_vehicle_navigation is deliberately NOT here; an agent must not
  // redirect the car mid-plan.
  "get_tesla_status",
  "get_vehicle_location",
] as const;

export interface ScoutTimelineEntry {
  at: number;
  kind: "status" | "tool" | "error" | "result";
  message: string;
  tool?: string;
  durationMs?: number;
}

export interface ScoutState {
  status: "idle" | "planning" | "running" | "complete" | "error";
  goal: string | null;
  window: CaWindow | null;
  timeline: ScoutTimelineEntry[];
  /** Latest published discovery + route payload. */
  result: {
    candidates: z.infer<typeof showroomCandidateSchema>[];
    route: z.infer<typeof routePlanSchema> | null;
    excluded: Array<{ name: string; reason: string }>;
    degradedTools: string[];
  } | null;
  /** Persisted drive list, once the user commits to the route. */
  driveListSlug: string | null;
  lastError: string | null;
  updatedAt: number;
}

const INITIAL_STATE: ScoutState = {
  status: "idle",
  goal: null,
  window: null,
  timeline: [],
  result: null,
  driveListSlug: null,
  lastError: null,
  updatedAt: 0,
};

export interface StartScoutInput {
  goal: string;
  geography?: string;
  homeBase?: string;
  /** Natural-language time phrase — "today", "Saturday", "this afternoon". */
  when?: string;
  includeKnown?: boolean;
  includeBigBox?: boolean;
}

export class ShowroomScout extends Agent<Env, ScoutState> {
  initialState: ScoutState = INITIAL_STATE;

  /** Conversation history, so replanning mid-drive keeps full context. */
  private history: AgentInputItem[] = [];

  /**
   * Cheap, open detour options from the most recent `plan_drive_route`.
   *
   * Held so `publish_route` can check the agent actually considered them. The
   * planner computes real diversion costs, but across live runs the model
   * consistently ignored them and published `detours: []` even with a +0 and
   * +6 minute option available — the same "instructions fade" pattern that made
   * publishing itself unreliable.
   */
  private pendingDetours: OfferableDetour[] = [];

  static docsMetadata() {
    return {
      title: "Showroom Scout",
      summary:
        "Discovers, vets, scores and routes remodel showrooms for a shopping day. " +
        "Excludes big-box and already-registered showrooms by default, reasons in " +
        "California time, and replans live while the user is on the road.",
      callable: ["startScout", "sendUpdate", "reset", "getScoutState"],
    };
  }

  // ─── Public RPC surface ───────────────────────────────────────────────────

  /**
   * Begin a scouting run. Returns the assistant's prose; the structured
   * discovery + route lands in agent state (and streams to connected clients).
   */
  @callable()
  async startScout(input: StartScoutInput): Promise<{ reply: string; state: ScoutState }> {
    const window = resolveWindow(input.when, new Date());

    this.history = [];
    this.setState({
      ...INITIAL_STATE,
      status: "planning",
      goal: input.goal,
      window,
      updatedAt: Date.now(),
    });

    const instructions = buildInstructions({
      window,
      goal: input.goal,
      geography: input.geography,
      homeBase: input.homeBase,
      includeKnown: input.includeKnown ?? false,
      includeBigBox: input.includeBigBox ?? false,
    });

    return this.execute(instructions, input.goal);
  }

  /**
   * Live update while on the road — "skip this stop", "I'm running behind",
   * "that place was a waste", "I only have 3 hours left".
   *
   * Reuses the accumulated history so the agent replans against the route it
   * already built rather than starting over.
   */
  @callable()
  async sendUpdate(message: string): Promise<{ reply: string; state: ScoutState }> {
    const state = this.state;
    if (!state.goal || !state.window) {
      throw new Error("No active scouting run — call startScout first");
    }

    const instructions = buildInstructions({
      window: state.window,
      goal: state.goal,
      includeKnown: false,
      includeBigBox: false,
    });

    return this.execute(instructions, message);
  }

  /** Read current state without mutating it (cheap poll / reconnect path). */
  @callable()
  async getScoutState(): Promise<ScoutState> {
    return this.state;
  }

  /** Clear the session. */
  @callable()
  async reset(): Promise<ScoutState> {
    this.history = [];
    this.setState({ ...INITIAL_STATE, updatedAt: Date.now() });
    return this.state;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private push(entry: Omit<ScoutTimelineEntry, "at">): void {
    const timeline = [...this.state.timeline, { ...entry, at: Date.now() }];
    // Bounded: a long drive with many replans must not grow state without
    // limit. The tail is what matters for the UI and for resumption.
    this.setState({
      ...this.state,
      timeline: timeline.slice(-200),
      updatedAt: Date.now(),
    });
  }

  /** Build tools, run the OpenAI agent loop, fold the outcome into state. */
  private async execute(
    instructions: string,
    userMessage: string,
  ): Promise<{ reply: string; state: ScoutState }> {
    const onEvent = (event: ToolEvent) => {
      // Capture the planner's detour options so publish_route can verify they
      // were considered rather than silently dropped.
      if (event.tool === "plan_drive_route" && event.status === "ok" && event.result) {
        this.pendingDetours = extractOfferableDetours(event.result);
      }

      if (event.status === "start") {
        this.push({
          kind: "tool",
          tool: event.tool,
          message: `${event.tool} …${event.detail ? ` ${event.detail}` : ""}`,
        });
        return;
      }
      this.push({
        kind: event.status === "ok" ? "tool" : "error",
        tool: event.tool,
        durationMs: event.durationMs,
        message:
          event.status === "ok"
            ? `${event.tool} ok${event.durationMs ? ` (${event.durationMs}ms)` : ""}`
            : `${event.tool} ${event.status}: ${event.detail ?? "unknown"}`,
      });
    };

    const ctx = {
      env: this.env,
      db: drizzle(this.env.DB),
      // The scout runs as the platform owner; the DO itself is the auth
      // boundary (see routeAgentRequest gating in `_worker.ts`).
      props: { userId: "showroom-scout", scope: "remodel", kind: "worker" } as McpProps,
    };

    // Dynamic import: this class is a Durable Object exported from
    // `src/_worker.ts`, so a static import of the registry would build all 219
    // tool modules' Zod schemas during Worker startup — the 10021 startup-CPU
    // budget. The scout only needs them once it is actually running.
    const { getAllTools } = await import("@backend/mcp/registry");
    const tools = [
      createWebSearchTool(this.env, onEvent),
      ...bridgeTools(getAllTools(), SCOUT_TOOL_ALLOWLIST, { ctx, onEvent }),
      this.publishCandidateTool(onEvent),
      this.publishRunSummaryTool(onEvent),
      this.publishRouteTool(onEvent),
    ];

    const { provider, model } = resolveScoutModelConfig(this.env);
    this.push({ kind: "status", message: `Planning with ${provider}:${model}` });
    this.setState({ ...this.state, status: "running", updatedAt: Date.now() });

    try {
      const agent = new OpenAIAgent({
        name: "Showroom Scout",
        instructions,
        model: await createScoutModel(this.env),
        tools,
        // Without this a single transient 503 from the model discards the whole
        // run — including every search already paid for. Retries are opt-in in
        // the Agents SDK; see retry.ts.
        modelSettings: { retry: SCOUT_RETRY },
      });

      const result = await run(agent, [...this.history, { role: "user", content: userMessage }], {
        // A full discovery sweep is genuinely multi-step: search, enrich,
        // dedupe, vet each candidate, route. The default cap cuts it short.
        maxTurns: 40,
      });

      // Carry history forward so mid-drive replans keep the full route context.
      this.history = result.history as AgentInputItem[];

      const reply = String(result.finalOutput ?? "");
      this.setState({
        ...this.state,
        status: "complete",
        lastError: null,
        updatedAt: Date.now(),
      });
      this.push({ kind: "status", message: "Done" });

      return { reply, state: this.state };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.setState({ ...this.state, status: "error", lastError: detail, updatedAt: Date.now() });
      this.push({ kind: "error", message: detail });
      throw error;
    }
  }

  /**
   * The model's channel for emitting structured results.
   *
   * Deliberately tools rather than the agent's `outputType`: forcing structured
   * output on every turn would break conversational replanning ("skip stop 2"
   * should return prose AND an updated route). This way the agent talks
   * normally and publishes structure when it has some — which works
   * identically on the initial run and on every mid-drive update.
   *
   * Split into two tools after a live failure: with candidates and route in one
   * strict schema, Gemini emitted a corrupted function name
   * (`PublishScoutResultCandidatesHours`) and the publish failed outright.
   * Two smaller schemas also let the agent publish findings before it has a
   * route, which is the common case when it stops to ask a question.
   */
  private publishCandidateTool(onEvent: (e: ToolEvent) => void) {
    return tool({
      name: "publish_candidate",
      description:
        "Publish ONE vetted showroom. Call it once per showroom you are recommending, as soon as " +
        "you have scored that showroom — do not batch them up and do not wait until the end. " +
        "Publishing one at a time makes each showroom appear in the app immediately. Re-publishing " +
        "the same name replaces that entry.",
      parameters: z.object({ candidate: showroomCandidateSchema }),
      strict: true,
      execute: async ({ candidate }) => {
        const existing = this.state.result?.candidates ?? [];
        // ponytail: upsert by name. Names are stable enough within a session,
        // and a replan updating a showroom in place is the desired behavior.
        const candidates = [...existing.filter((c) => c.name !== candidate.name), candidate];
        this.setState({
          ...this.state,
          result: {
            candidates,
            route: this.state.result?.route ?? null,
            excluded: this.state.result?.excluded ?? [],
            degradedTools: this.state.result?.degradedTools ?? [],
          },
          updatedAt: Date.now(),
        });
        onEvent({
          tool: "publish_candidate",
          status: "ok",
          detail: `${candidate.name} (${candidate.aiScore})`,
        });
        this.push({
          kind: "result",
          message: `Published ${candidate.name} [${candidate.aiScore}]`,
        });
        return `Published ${candidate.name}. ${candidates.length} total so far.`;
      },
    });
  }

  /**
   * Route stops the agent itself reported as closed on the trip day.
   *
   * Compares each routed stop against the hours on its own published candidate.
   * Only fires on an explicit "closed" — unknown or unparsed hours are left
   * alone, since a false rejection would block a legitimate route.
   */
  private findClosedStops(route: z.infer<typeof routePlanSchema>): string[] {
    const day = this.state.window?.day;
    if (!day) return [];

    const field =
      day === "saturday" ? "saturday" : day === "sunday" ? "sunday" : ("weekday" as const);

    const byName = new Map(
      (this.state.result?.candidates ?? []).map((c) => [c.name.toLowerCase().trim(), c]),
    );

    const closed: string[] = [];
    for (const stop of route.stops) {
      const candidate = byName.get(stop.name.toLowerCase().trim());
      const hours = candidate?.hours?.[field];
      if (typeof hours === "string" && /\bclosed\b/i.test(hours)) closed.push(stop.name);
    }
    return closed;
  }

  private publishRunSummaryTool(onEvent: (e: ToolEvent) => void) {
    return tool({
      name: "publish_run_summary",
      description:
        "Publish what you EXCLUDED and which tools were unavailable. Call once, near the end, " +
        "after your publish_candidate calls. Exclusion reasons must be truthful — only say a " +
        "showroom is already in the directory if find_known_showrooms reported it.",
      parameters: z.object({
        excluded: z.array(z.object({ name: z.string(), reason: z.string() })),
        degradedTools: z.array(z.string()),
      }),
      strict: true,
      execute: async (payload) => {
        this.setState({
          ...this.state,
          result: {
            candidates: this.state.result?.candidates ?? [],
            route: this.state.result?.route ?? null,
            excluded: payload.excluded,
            degradedTools: payload.degradedTools,
          },
          updatedAt: Date.now(),
        });
        onEvent({
          tool: "publish_run_summary",
          status: "ok",
          detail: `${payload.excluded.length} excluded`,
        });
        return `Recorded ${payload.excluded.length} exclusions.`;
      },
    });
  }

  private publishRouteTool(onEvent: (e: ToolEvent) => void) {
    return tool({
      name: "publish_route",
      description:
        "Publish the planned route so the app can render it. Call after plan_drive_route, and " +
        "again after every replan. Include stop order, ETAs, why each stop sits where it does, " +
        "timing warnings, opening statements, food stops, detours and call-aheads.",
      parameters: z.object({ route: routePlanSchema }),
      strict: true,
      execute: async (payload) => {
        // GUARDRAIL: a live run routed a showroom to 8:24 AM after publishing
        // its own finding that the place is CLOSED on Saturdays. Sending a user
        // to a locked door is the worst failure this product can produce, and
        // instructions alone did not prevent it — plan_drive_route only knows
        // the hours it was handed, so the contradiction has to be caught here,
        // against what the agent already told us about each showroom.
        // Cheap, open detours the planner surfaced but the route ignored.
        const missedDetours = findMissedDetours(
          this.pendingDetours,
          payload.route.detours.map((d) => d.name),
          payload.route.stops.map((s) => s.name),
        );
        if (missedDetours.length > 0) {
          const listed = missedDetours.map((d) => `${d.name} (+${d.extraMinutes} min)`).join(", ");
          onEvent({ tool: "publish_route", status: "error", detail: `missed detours: ${listed}` });
          return (
            `REJECTED — plan_drive_route found near-path showrooms you neither routed nor offered ` +
            `as detours: ${listed}. These cost very little to divert to. Add each to the route's ` +
            `detours with its exact extraMinutes, why it is a detour rather than a main stop, and ` +
            `the unique value it adds — then publish again. If one genuinely is not worth ` +
            `offering, drop it from consideration by explaining that in your reply.`
          );
        }

        const conflicts = this.findClosedStops(payload.route);
        if (conflicts.length > 0) {
          onEvent({
            tool: "publish_route",
            status: "error",
            detail: `closed-on-trip-day stops: ${conflicts.join(", ")}`,
          });
          return (
            `REJECTED — this route sends the user to ${conflicts.length} showroom(s) that you ` +
            `yourself reported as CLOSED on the trip day: ${conflicts.join(", ")}. ` +
            `Remove them, move them to excluded with the reason "closed on the trip day", ` +
            `re-run plan_drive_route without them, and publish the corrected route.`
          );
        }

        this.setState({
          ...this.state,
          result: {
            candidates: this.state.result?.candidates ?? [],
            route: payload.route,
            excluded: this.state.result?.excluded ?? [],
            degradedTools: this.state.result?.degradedTools ?? [],
          },
          updatedAt: Date.now(),
        });
        onEvent({
          tool: "publish_route",
          status: "ok",
          detail: `${payload.route.stops.length} stops`,
        });
        this.push({
          kind: "result",
          message: `Published route: ${payload.route.stops.length} stops`,
        });
        return `Published a ${payload.route.stops.length}-stop route.`;
      },
    });
  }
}
