/**
 * Live smoke test for Showroom Scout — runs the REAL OpenAI Agents SDK loop
 * against the REAL Gemini API, outside the Worker.
 *
 * Why outside the Worker: the DO adds a migration tag, and deploying a branch
 * advances the production DO migration tag. This exercises the risky
 * integration surface (aisdk bridge, non-strict JSON-schema tool calling,
 * grounded search, graceful degradation, structured publish) with no deploy.
 *
 * COSTS REAL MONEY — a handful of Gemini calls per run. Not part of CI.
 *
 * Usage:
 *   node scripts/tests/scout_smoke.mjs            # bundled output
 *   SCOUT_GOAL="..." node scripts/tests/scout_smoke.mjs
 */
import { Agent as OpenAIAgent, run, setTracingDisabled } from "@openai/agents";
import { z } from "zod";

// Import the two tools directly rather than the whole registry — the registry
// barrel pulls in every domain (render, budget, workflows) and their deps.
import { findKnownShowrooms } from "@backend/mcp/tools/showrooms/find_known_showrooms";
import { planDriveRoute } from "@backend/mcp/tools/drives/plan_drive_route";
import { bridgeTools, type ToolEvent } from "@backend/ai/agents/showroom-scout/mcp-bridge";
import { buildInstructions } from "@backend/ai/agents/showroom-scout/instructions";
import { createScoutModel, resolveScoutModelConfig } from "@backend/ai/agents/showroom-scout/model";
import { routePlanSchema, showroomCandidateSchema } from "@backend/ai/agents/showroom-scout/schemas";
import { SCOUT_RETRY } from "@backend/ai/agents/showroom-scout/retry";
import { formatMinute, resolveWindow } from "@backend/ai/agents/showroom-scout/time";
import { createWebSearchTool } from "@backend/ai/agents/showroom-scout/tools/web-search";
import { tool } from "@openai/agents";

setTracingDisabled(true);

// Secrets are injected by `run_scout_smoke.mjs`, which reads them from the
// `tokens` CLI (the same values the deployed worker's secrets-store bindings
// resolve). Not read here directly: bundling tokens.mjs trips its CLI guard.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Run this via: node scripts/tests/run_scout_smoke.mjs");
  process.exit(1);
}

/**
 * Minimal Env stand-in. Secrets Store bindings expose `.get()`; D1 is absent on
 * purpose so we observe the real degradation path rather than a mocked one.
 */
const env = {
  GEMINI_API_KEY: { get: async () => GEMINI_API_KEY },
  // Plain string is fine — getGoogleMapsApiKey accepts string or .get().
  // Present => plan_drive_route exercises the REAL traffic-aware Routes API.
  GOOGLE_MAPS_API: process.env.GOOGLE_MAPS_API,
  SHOWROOM_SCOUT_PROVIDER: process.env.SHOWROOM_SCOUT_PROVIDER ?? "gemini",
  SHOWROOM_SCOUT_MODEL: process.env.SHOWROOM_SCOUT_MODEL ?? "gemini-2.5-flash",
  SHOWROOM_SCOUT_SEARCH_MODEL: process.env.SHOWROOM_SCOUT_SEARCH_MODEL ?? "gemini-2.5-flash",
  WORKER_URL: "https://core-remodel.hacolby.workers.dev",
  AI_GATEWAY_ID: "core-remodel",
  DB: undefined,
} as unknown as Env;

/**
 * Fake directory for `find_known_showrooms`, standing in for D1.
 * Deliberately seeded with a real Bay Area stone yard so we can watch the agent
 * actually exclude a known entry rather than just claiming it did.
 */
const FAKE_DIRECTORY = [
  { id: 41, name: "Da Vinci Marble", placeId: null, city: "Redwood City" },
  { id: 42, name: "Cactus Stone & Tile", placeId: null, city: "San Jose" },
];

const fakeDb = {
  select() {
    return {
      from() {
        return Promise.resolve(FAKE_DIRECTORY);
      },
    };
  },
} as never;

const events: ToolEvent[] = [];
const onEvent = (e: ToolEvent) => {
  events.push(e);
  const tag = e.status === "ok" ? "ok " : e.status === "start" ? "..." : "!! ";
  console.log(`  ${tag} ${e.tool}${e.detail ? ` — ${String(e.detail).slice(0, 110)}` : ""}`);
  // Diagnostics: show what the router actually computed, so a missing detour
  // list can be traced to the tool vs. the model ignoring it.
  if (e.tool === "plan_drive_route" && e.result) {
    try {
      const r = JSON.parse(e.result);
      pendingDetours = (r.detourOptions ?? [])
        .filter((d: any) => d.extraMinutes <= 15 && d.openAtArrival !== "no")
        .map((d: any) => ({ name: d.name, extraMinutes: d.extraMinutes }));
      console.log(`      → routed ${r.stops?.length ?? 0}, dropped ${r.dropped?.length ?? 0}, detourOptions ${r.detourOptions?.length ?? 0}, traffic=${r.trafficDataAvailable}`);
      for (const d of r.detourOptions ?? []) {
        console.log(`        detourOption: ${d.name} +${d.extraMinutes}m after ${d.insertAfter ?? "START"} open=${d.openAtArrival}`);
      }
      for (const d of r.dropped ?? []) console.log(`        dropped: ${d.name} — ${d.reason}`);
    } catch {}
  }
};

const publishCandidateTool = tool({
  name: "publish_candidate",
  description:
    "Publish ONE vetted showroom. Call once per showroom, as soon as you finish scoring it. " +
    "Do not batch. Re-publishing the same name replaces that entry.",
  parameters: z.object({ candidate: showroomCandidateSchema }),
  strict: true,
  execute: async ({ candidate }) => {
    publishedCandidates = [...publishedCandidates.filter((c: any) => c.name !== candidate.name), candidate];
    console.log(`  ok  publish_candidate — ${candidate.name} [${candidate.aiScore}]`);
    return `Published ${candidate.name}. ${publishedCandidates.length} total so far.`;
  },
});

const publishRunSummaryTool = tool({
  name: "publish_run_summary",
  description: "Publish exclusions and unavailable tools. Call once, near the end.",
  parameters: z.object({
    excluded: z.array(z.object({ name: z.string(), reason: z.string() })),
    degradedTools: z.array(z.string()),
  }),
  strict: true,
  execute: async (payload) => {
    publishedSummary = payload;
    console.log(`  ok  publish_run_summary — ${payload.excluded.length} excluded`);
    return `Recorded ${payload.excluded.length} exclusions.`;
  },
});

const publishRouteTool = tool({
  name: "publish_route",
  description: "Publish the planned route so the app can render it. Call after plan_drive_route.",
  parameters: z.object({ route: routePlanSchema }),
  strict: true,
  execute: async (payload) => {
    const offered = new Set(payload.route.detours.map((d: any) => d.name.toLowerCase().trim()));
    const routed = new Set(payload.route.stops.map((s2: any) => s2.name.toLowerCase().trim()));
    const missed = pendingDetours.filter(
      (d) => !offered.has(d.name.toLowerCase().trim()) && !routed.has(d.name.toLowerCase().trim()),
    );
    if (missed.length > 0) {
      const listed = missed.map((d) => `${d.name} (+${d.extraMinutes} min)`).join(", ");
      console.log(`  !!  publish_route REJECTED — missed detours: ${listed}`);
      return (
        `REJECTED — plan_drive_route found near-path showrooms you neither routed nor offered ` +
        `as detours: ${listed}. Add each to the route's detours with its exact extraMinutes, why ` +
        `it is a detour rather than a main stop, and the unique value it adds — then publish again.`
      );
    }
    publishedRoute = payload.route;
    console.log(`  ok  publish_route — ${payload.route.stops.length} stops`);
    return `Published a ${payload.route.stops.length}-stop route.`;
  },
});

let publishedCandidates: any[] = [];
let publishedSummary: any = null;
let publishedRoute: any = null;
let pendingDetours: Array<{ name: string; extraMinutes: number }> = [];

const ALLOWLIST = ["find_known_showrooms", "plan_drive_route"] as const;

async function main() {
  const goal =
    process.env.SCOUT_GOAL ??
    "I want bespoke stone yards and tile showrooms in the South Bay for a kitchen island and " +
      "primary bath. No big box stores.";

  const window = resolveWindow(process.env.SCOUT_WHEN ?? "saturday morning", new Date());
  const { provider, model } = resolveScoutModelConfig(env);

  console.log(`\nmodel:  ${provider}:${model}`);
  console.log(`goal:   ${goal}`);
  console.log(
    `window: ${window.date} (${window.day}) ${formatMinute(window.startMinute)}–${formatMinute(
      window.endMinute,
    )}  rolledForward=${window.rolledForward}  "${window.label}"`,
  );
  if (window.startMinute >= window.endMinute) {
    console.error("BUG: inverted window (start >= end) — the agent will invent a plausible time.");
  }
  console.log();

  const ctx = {
    env,
    db: fakeDb,
    props: { userId: "smoke", scope: "remodel", kind: "worker" as const },
  };

  const tools = [
    createWebSearchTool(env, onEvent),
    ...bridgeTools([findKnownShowrooms, planDriveRoute], ALLOWLIST, { ctx, onEvent }),
    publishCandidateTool,
    publishRunSummaryTool,
    publishRouteTool,
  ];

  console.log(`tools:  ${tools.map((t) => t.name).join(", ")}\n`);

  const agent = new OpenAIAgent({
    name: "Showroom Scout",
    instructions: buildInstructions({
      window,
      goal,
      geography: "South Bay / Peninsula, California",
      homeBase: "126 Colby St, San Francisco, CA",
      includeKnown: false,
      includeBigBox: false,
    }),
    model: await createScoutModel(env),
    tools,
    modelSettings: { retry: SCOUT_RETRY },
  });

  const started = Date.now();
  const result = await run(agent, goal, { maxTurns: Number(process.env.SCOUT_MAX_TURNS ?? 40) });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n─── reply (${elapsed}s) ───\n`);
  console.log(String(result.finalOutput ?? "(no final output)").slice(0, 3000));

  console.log(`\n─── audit ───`);
  const calls = events.filter((e) => e.status !== "start");
  console.log(`tool calls: ${calls.length}`);
  for (const [name, count] of tally(calls.map((c) => c.tool))) console.log(`  ${name}: ${count}`);
  const failures = calls.filter((c) => c.status !== "ok");
  console.log(`failures: ${failures.length}`);
  for (const f of failures) console.log(`  ${f.tool} [${f.status}] ${String(f.detail).slice(0, 200)}`);

  if (publishedCandidates.length === 0) {
    console.log("\nPROBLEM: agent never called publish_candidate — no structured output.");
  } else {
    const pub = { candidates: publishedCandidates, excluded: publishedSummary?.excluded ?? [], degradedTools: publishedSummary?.degradedTools ?? [] };
    console.log(`\npublished: ${pub.candidates.length} candidates`);
    for (const c of pub.candidates) {
      console.log(
        `  [${c.aiScore}] ${c.name} (${c.showroomType}) — known=${c.knownInDirectory} worth=${c.review?.worthTheDrive}`,
      );
      console.log(`        ${String(c.aiRationale).slice(0, 170)}`);
      console.log(`        hours sat=${c.hours?.saturday} verified=${c.hours?.verified} contractorTie=${c.contractorTie?.tie}`);
    }
    console.log(`excluded: ${pub.excluded.length}`);
    for (const e of pub.excluded) console.log(`  ${e.name} — ${e.reason}`);
    console.log(`degradedTools: ${JSON.stringify(pub.degradedTools)}`);
  }

  if (!publishedRoute) {
    console.log("\nNOTE: no route published.");
  } else {
    console.log(`\nroute: ${publishedRoute.stops.length} stops (${publishedRoute.windowLabel})`);
    for (const s2 of publishedRoute.stops) {
      console.log(`  ${s2.order}. ${s2.name} ETA ${s2.eta} → depart ${s2.depart} (${s2.recommendedMinutes}m)`);
      if (s2.timingWarnings?.length) console.log(`     warn: ${s2.timingWarnings.join("; ")}`);
      console.log(`     open: ${String(s2.openingStatement).slice(0, 170)}`);
    }
    console.log(`  food stops: ${publishedRoute.foodStops?.length ?? 0}, detours: ${publishedRoute.detours?.length ?? 0}, call-aheads: ${publishedRoute.callAheads?.length ?? 0}`);
    for (const f of publishedRoute.foodStops ?? []) console.log(`     food: ${f.name} after ${f.afterStop} (+${f.addedMinutes}m, onRoute=${f.onRoute})`);
    for (const ca of publishedRoute.callAheads ?? []) console.log(`     call: ${ca.stopName} — ${String(ca.askExactly).slice(0,110)}`);
  }
}

function tally(items: (string | undefined)[]): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(i ?? "?", (m.get(i ?? "?") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

main().catch((e) => {
  console.error("\nSMOKE RUN FAILED:", e);
  process.exit(1);
});
