#!/usr/bin/env node
/**
 * QC — 0047 P2: chain-branch merge-candidate DETECTION (non-destructive half).
 * Run: node scripts/qc/pr_363.mjs --preview   (or bare for prod)
 *
 * This slice adds the schema (3 tables + a `unit` column) and the read/scan tools —
 * scan_showroom_merge_candidates, list_merge_candidates, get_merge_candidate. NO collapse
 * yet, so the scan only writes to the merge-candidate tables, never to showroom_stores.
 *
 * The failure mode to guard is the same as 0046's: staging a co-located-but-different
 * business as if it were a branch. A branch group must be held together by a STRONG signal
 * (website / name / place_id); a shared address or phone alone is a building, not a business.
 * So the assertions are: the tools exist, a live scan stages real chains, and known
 * co-located-different pairs are NEVER staged together in one candidate.
 */
import { readFileSync } from "node:fs";

import { accessCookie, createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC 0047 branch-detection against ${BASE}${isPreview ? " (preview)" : ""}\n`);

async function mcpToken() {
  const reg = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "qc-0047",
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
  const location = authed.headers.get("location");
  if (!location) {
    throw new Error(`oauth/authorize did not redirect (status ${authed.status}) — bad access cookie?`);
  }
  const code = new URL(location).searchParams.get("code");
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

function makeCaller(token) {
  const url = `${BASE}/mcp`;
  let sid = null;
  let id = 0;
  const headers = () => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    ...(sid ? { "mcp-session-id": sid } : {}),
  });
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
  let ready = null;
  const init = async () => {
    if (ready) return ready;
    ready = (async () => {
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
    })();
    return ready;
  };
  return async (name, args) => {
    await init();
    const res = await rpc("tools/call", { name, arguments: args });
    if (res.error) throw new Error(res.error.message);
    return res.result?.structuredContent ?? JSON.parse(res.result?.content?.[0]?.text ?? "{}");
  };
}

/** Same building, different companies — must never be one candidate. */
const CO_LOCATED_NOT_ONE_BUSINESS = [
  [82, 85], // Walker Zanger / New Century Kitchen & Bath
  [304, 305], // DEGREE HVAC / CB Showers
  [2, 3], // Argonaut Window & Door / Pacific Sash & Design
  [92, 241], // Marblus / Leandro Quintal (suite collision)
];

try {
  const docs = await c.get("/api/mcp-docs");
  check("/api/mcp-docs 200", docs.status === 200, `status=${docs.status}`);
  const names = new Set((docs.json?.tools ?? []).map((t) => t.name));
  const registered =
    names.has("scan_showroom_merge_candidates") &&
    names.has("list_merge_candidates") &&
    names.has("get_merge_candidate");

  if (!registered && !isPreview) {
    info("merge-candidate tools: pending merge/deploy");
  } else {
    check("scan/list/get tools registered", registered);

    const call = makeCaller(await mcpToken());

    const scan = await call("scan_showroom_merge_candidates", {});
    check("scan returns a detected count", Number.isInteger(scan.detected), `detected=${scan.detected}`);
    check("scan wrote candidates (idempotent)", Number.isInteger(scan.created), JSON.stringify(scan));

    const list = await call("list_merge_candidates", {});
    const cands = list.candidates ?? [];
    check("list returns TBD candidates", cands.length > 0, `count=${cands.length}`);

    // Every staged candidate must carry a STRONG signal — never address/phone alone.
    const STRONG = ["place_id", "website", "name"];
    const weakOnly = cands.filter((x) => !(x.signals ?? []).some((s) => STRONG.includes(s)));
    check(
      "no candidate linked only by address/phone",
      weakOnly.length === 0,
      `offenders: ${weakOnly.map((x) => x.id).join(",") || "none"}`,
    );

    // Known co-located-different pairs must not share a candidate. Coerce ids to Number —
    // D1's --json can hand back a numeric id as a string, which would make s.has(82) miss.
    const memberSets = cands.map((x) => new Set((x.members ?? []).map((m) => Number(m.storeId))));
    for (const [a, b] of CO_LOCATED_NOT_ONE_BUSINESS) {
      const staged = memberSets.some((s) => s.has(a) && s.has(b));
      check(`co-located ${a}/${b} not staged as one business`, !staged);
    }

    // get returns members with addresses.
    const first = cands[0];
    if (first) {
      const detail = await call("get_merge_candidate", { id: first.id });
      check("get returns candidate + members", Array.isArray(detail.members) && detail.members.length >= 2);
      check("get exposes evidence", Array.isArray(detail.candidate?.evidence));
    }

    // Re-scan is idempotent: nothing new created on an immediate second run.
    const rescan = await call("scan_showroom_merge_candidates", {});
    check("re-scan creates nothing new", rescan.created === 0, `created=${rescan.created}`);

    info(`candidates: ${cands.length} · detected this run: ${scan.detected}`);
  }

  // Regression: 0046 tier-1 still sane, directory reads still 200.
  const stores = await c.get("/api/showroom-stores");
  check("/api/showroom-stores still 200", stores.status === 200, `status=${stores.status}`);

  // Source hygiene — no NUL bytes in the new service (the #348 lesson).
  const src = readFileSync("src/backend/services/showroom/branch-detection.ts");
  check("branch-detection source has no NUL bytes", !src.includes(0));
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
}

summary();
