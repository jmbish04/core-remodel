#!/usr/bin/env node
/**
 * QC — 0046 dedupe identity signals (place_id / phone / address / website / name).
 * Run: node scripts/qc/pr_348.mjs --preview   (or bare for prod)
 *
 * The interesting failure mode here is a FALSE POSITIVE, not a miss: grouping on a
 * shared street address or a social-profile host fuses unrelated businesses into one
 * component, and an `apply:true` on that would soft-delete real stores. Both happened
 * during development on live data — 2 Henry Adams St (the SF Design Center) fused its
 * tenants, and linkedin/youtube/houzz/x fused 36 stores. So the assertions below are
 * mostly upper bounds and never-auto-merge invariants.
 *
 * Covers:
 *   1. The registry catalog advertises the new grouping + branchCandidates.
 *   2. A live `dedup_showroom_stores` DRY RUN over the real directory (writes nothing),
 *      asserting: no runaway component, every tier-1 group carries a STRONG signal, and
 *      known co-located-but-unrelated pairs stay out of the auto-merge plan.
 *   3. The pure normalizer/grouping self-check.
 *   4. No NUL bytes in the tool source — one was committed, which made git and every
 *      review tool treat the file as binary so its contents never appeared in a diff.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { accessCookie, createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC 0046 dedupe signals against ${BASE}${isPreview ? " (preview)" : ""}\n`);

/** Registry tools are OAuth-gated; drive the flow with the worker key. */
async function mcpToken() {
  const reg = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "qc-0046",
      redirect_uris: ["http://localhost/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }).then((r) => r.json());

  const q = new URLSearchParams({
    client_id: reg.client_id,
    redirect_uri: "http://localhost/callback",
    response_type: "code",
    scope: "remodel",
    state: "qc",
  });
  const authed = await fetch(`${BASE}/oauth/authorize?${q}`, {
    method: "POST",
    headers: { cookie: accessCookie(), "content-type": "application/x-www-form-urlencoded" },
    body: "decision=approve",
    redirect: "manual",
  });
  const code = new URL(authed.headers.get("location")).searchParams.get("code");

  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: reg.client_id,
      redirect_uri: "http://localhost/callback",
    }),
  }).then((r) => r.json());
  return tok.access_token;
}

/**
 * Calls an MCP tool with the given token, tool name, and arguments.
 * It manages the MCP session ID across RPC requests.
 * @param {string} token
 * @param {string} name
 * @param {object} args
 */
async function callTool(token, name, args) {
  const url = `${BASE}/mcp`;
  let sid = null;
  let id = 0;

  /**
   * Constructs the headers for the RPC request, including the session ID if available.
   * @returns {object}
   */
  const headers = () => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    ...(sid ? { "mcp-session-id": sid } : {}),
  });

  /**
   * Executes a JSON-RPC method over HTTP, parsing the event-stream response and
   * extracting the mcp-session-id for subsequent requests.
   * @param {string} method
   * @param {object} params
   */
  const rpc = async (method, params) => {
    const r = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const got = r.headers.get("mcp-session-id");
    if (got) sid = got;
    const text = await r.text();
    const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
    return JSON.parse(line.replace(/^data: /, ""));
  };
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "qc", version: "1" },
  });
  await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const res = await rpc("tools/call", { name, arguments: args });
  if (res.error) throw new Error(res.error.message);
  return res.result?.structuredContent ?? JSON.parse(res.result?.content?.[0]?.text ?? "{}");
}

/** Rows that share a building but are plainly different companies. */
const CO_LOCATED_NOT_DUPES = [
  [82, 85], // Walker Zanger / New Century Kitchen & Bath
  [304, 305], // DEGREE HVAC / CB Showers
  [2, 3], // Argonaut Window & Door / Pacific Sash & Design
  // Same industrial park, different suites: Marblus Granite is #40C, Leandro
  // Quintal is #64A. The locations table has no unit column, so its street data
  // read identically for both and 241 rode into the Marblus group on that edge.
  [92, 241],
  [267, 241],
];

try {
  // ── 1. catalog ────────────────────────────────────────────────────────────
  const docs = await c.get("/api/mcp-docs");
  check("/api/mcp-docs 200", docs.status === 200, `status=${docs.status}`);
  const tool = (docs.json?.tools ?? []).find((t) => t.name === "dedup_showroom_stores");
  check("dedup_showroom_stores registered", Boolean(tool));

  const desc = tool?.description ?? "";
  const advertised = desc.includes("place_id") && desc.includes("branchCandidates");
  if (!advertised && !isPreview) {
    info("dedup description: pending merge/deploy (still the name-only copy)");
  } else {
    check("advertises multi-signal grouping", advertised);
    check("advertises the generic-host guard", desc.toLowerCase().includes("generic host"));
  }

  // ── 2. live dry run ───────────────────────────────────────────────────────
  if (!advertised && !isPreview) {
    info("dry-run assertions: pending merge/deploy");
  } else {
    const token = await mcpToken();
    check("obtained an MCP token", Boolean(token));
    const r = await callTool(token, "dedup_showroom_stores", {});

    check("dry run wrote nothing", r.mode === "dry-run", `mode=${r.mode}`);
    check("returns branchCandidates", Array.isArray(r.branchCandidates));

    // THE regression guard. A shared building address or social host previously
    // produced a single 36-37 store component; real Bay Area chains top out ~5.
    const groups = [
      ...(r.plan ?? []).map((p) => [p.keepId, ...p.deleteIds]),
      ...(r.branchCandidates ?? []).map((b) => b.ids),
    ];
    const biggest = groups.reduce((m, g) => Math.max(m, g.length), 0);
    check("no runaway component (<=8 stores)", biggest <= 8, `largest group = ${biggest}`);

    // Never auto-merge on a weak-only link: a shared address/phone is a building
    // or a switchboard, not a business.
    const STRONG = ["place_id", "website", "name"];
    const weakOnlyPlans = (r.plan ?? []).filter(
      (p) => !(p.linkedBy ?? []).some((s) => STRONG.includes(s)),
    );
    check(
      "no tier-1 group linked only by address/phone",
      weakOnlyPlans.length === 0,
      `offenders: ${weakOnlyPlans.map((p) => p.keepId).join(",") || "none"}`,
    );

    // Known co-located pairs must never appear together in the auto-merge plan.
    const planPairs = (r.plan ?? []).map((p) => new Set([p.keepId, ...p.deleteIds]));
    for (const [a, b] of CO_LOCATED_NOT_DUPES) {
      const fused = planPairs.some((s) => s.has(a) && s.has(b));
      check(`co-located ${a}/${b} not auto-merged`, !fused);
    }

    // Every tier-1 group must explain itself.
    const unexplained = (r.plan ?? []).filter((p) => !(p.linkedBy ?? []).length);
    check("every tier-1 group reports linkedBy", unexplained.length === 0);
    info(
      `tier-1 groups: ${r.plan?.length ?? 0} · branchCandidates: ${r.branchCandidates?.length ?? 0}`,
    );
  }

  // ── 3. pure self-check ────────────────────────────────────────────────────
  let selfCheckOk = true;
  try {
    execFileSync(
      "npx",
      [
        "--yes",
        "tsx",
        "-e",
        "import { __selfCheck } from './src/backend/services/showroom/duplicate-signals.ts'; __selfCheck();",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    selfCheckOk = false;
    console.error(String(err?.stderr ?? err?.message).slice(0, 400));
  }
  check("duplicate-signals __selfCheck passes", selfCheckOk);

  // ── 4. source hygiene ─────────────────────────────────────────────────────
  const src = readFileSync("src/backend/mcp/tools/showrooms/dedup_showroom_stores.ts");
  check(
    "dedup tool source has no NUL bytes",
    !src.includes(0),
    "a NUL makes git treat it as binary",
  );

  // ── regression guard ──────────────────────────────────────────────────────
  const stores = await c.get("/api/showroom-stores");
  check("/api/showroom-stores still 200", stores.status === 200, `status=${stores.status}`);
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
