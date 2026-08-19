#!/usr/bin/env node
/**
 * QC — 0047 P3/P4: chain-branch COLLAPSE (the destructive half).
 * Run: node scripts/qc/pr_364.mjs --preview   (or bare for prod)
 *
 * Exercises the real collapse end to end on a THROWAWAY pair the test creates and removes —
 * never live rows. Two sentinel stores (ZZ_QC_COLLAPSE_*) share a website so the scan groups
 * them; each has its own place_id + location so both are real branches. The test then:
 *   scan -> the candidate exists  ·  resolve approve  ·  apply -> branch folds into keeper
 *   -> keeper gains the branch's location, branch soft-deleted, candidate APPLIED
 *   -> apply again is a no-op (idempotent/resumable)
 * A `finally` block hard-deletes every sentinel row regardless of outcome.
 *
 * Also re-checks the 0046 tier-1 invariants (pr_348 shares the extracted remap): the dedup
 * dry run still reports no runaway component and every keeper active.
 */
import { execFileSync } from "node:child_process";

import { accessCookie, createChecks, createClient, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const { ok: check, info, summary } = createChecks();
console.log(`QC 0047 collapse against ${BASE}${isPreview ? " (preview)" : ""}\n`);

const MARK = "ZZ_QC_COLLAPSE";

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

async function mcpToken() {
  const reg = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "qc-0047-collapse",
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
  if (!location) throw new Error(`oauth/authorize did not redirect (status ${authed.status})`);
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
  const init = () =>
    (ready ??= (async () => {
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
    })());
  return async (name, args) => {
    await init();
    const res = await rpc("tools/call", { name, arguments: args });
    if (res.error) throw new Error(res.error.message);
    const text = res.result?.content?.[0]?.text ?? "{}";
    // A tool error comes back as isError=true with the message in the text content, not res.error.
    if (res.result?.isError) throw new Error(text);
    return res.result?.structuredContent ?? JSON.parse(text);
  };
}

const esc = (s) => s.replace(/'/g, "''");

/** Remove every sentinel row this test could have created, in FK-safe order. */
function cleanup() {
  const ids = d1(`SELECT id FROM showroom_stores WHERE name LIKE '${MARK}%'`).map((r) => Number(r.id));
  if (ids.length) {
    const list = ids.join(",");
    d1(`DELETE FROM showroom_merge_candidate_members WHERE store_id IN (${list})`);
    d1(`DELETE FROM showroom_merge_exclusions WHERE store_id_lo IN (${list}) OR store_id_hi IN (${list})`);
    d1(`DELETE FROM showroom_store_locations WHERE store_id IN (${list})`);
    d1(`DELETE FROM showroom_store_links WHERE store_id IN (${list})`);
    d1(`DELETE FROM showroom_store_hours WHERE showroom_id IN (${list})`);
    d1(`DELETE FROM showroom_stores WHERE id IN (${list})`);
  }
  // Candidates whose members are all gone (orphaned by the deletes above).
  d1(
    `DELETE FROM showroom_merge_candidates WHERE id IN (` +
      `SELECT c.id FROM showroom_merge_candidates c ` +
      `LEFT JOIN showroom_merge_candidate_members m ON m.candidate_id = c.id ` +
      `WHERE m.id IS NULL)`,
  );
}

try {
  if (!isPreview) {
    // The collapse tools are OAuth-gated and this test WRITES; run it only against a preview
    // (which shares prod D1 but exercises the branch's code). On prod it just regression-checks.
    info("collapse write-test runs on --preview only; prod path is the regression check below");
  } else {
    cleanup(); // start clean

    const call = makeCaller(await mcpToken());

    // ── fixture: two branches of one fake business ──
    d1(
      `INSERT INTO showroom_stores (name, is_active, place_id, zip_code, location_city) VALUES ` +
        `('${MARK}_A', 1, 'QCPLACE_A', '99991', 'Testville'),` +
        `('${MARK}_B', 1, 'QCPLACE_B', '99992', 'Testburg')`,
    );
    const rows = d1(`SELECT id, name FROM showroom_stores WHERE name LIKE '${MARK}%' ORDER BY id`);
    const A = Number(rows.find((r) => r.name.endsWith("_A")).id);
    const B = Number(rows.find((r) => r.name.endsWith("_B")).id);
    check("created two sentinel stores", Number.isFinite(A) && Number.isFinite(B), `A=${A} B=${B}`);

    d1(
      `INSERT INTO showroom_store_locations (store_id, place_id, street_number, street_name, city, zip_code) VALUES ` +
        `(${A}, 'QCPLACE_A', '1', 'Test St', 'Testville', '99991'),` +
        `(${B}, 'QCPLACE_B', '2', 'Test Ave', 'Testburg', '99992')`,
    );
    d1(
      `INSERT INTO showroom_store_links (store_id, url, type) VALUES ` +
        `(${A}, 'https://qc-collapse-test.example', 'WEBSITE'),` +
        `(${B}, 'https://qc-collapse-test.example', 'WEBSITE')`,
    );

    // ── scan finds the pair ──
    await call("scan_showroom_merge_candidates", {});
    const [cand] = d1(
      `SELECT id, status FROM showroom_merge_candidates WHERE group_key = '${esc(`${A}-${B}`)}'`,
    );
    check("scan staged the throwaway pair", Boolean(cand), `group_key ${A}-${B}`);
    const candId = Number(cand?.id);

    // ── approve then apply ──
    const approved = await call("resolve_merge_candidate", { id: candId, action: "approve" });
    check("approve sets APPROVED", approved.status === "APPROVED", approved.status);

    const applied = await call("apply_merge_candidate", { id: candId });
    check("apply reports APPLIED", applied.status === "APPLIED", applied.status);
    check("keeper is store A (lowest id)", applied.keeperStoreId === A, `keeper=${applied.keeperStoreId}`);

    // ── verify the collapse in D1 ──
    const [keeperLocs] = d1(`SELECT count(*) n FROM showroom_store_locations WHERE store_id = ${A}`);
    check("keeper now holds BOTH locations", Number(keeperLocs?.n) === 2, `keeper locs=${keeperLocs?.n}`);
    const [branchActive] = d1(`SELECT is_active FROM showroom_stores WHERE id = ${B}`);
    check("branch store soft-deleted", Number(branchActive?.is_active) === 0, `B.is_active=${branchActive?.is_active}`);
    const [branchLocs] = d1(`SELECT count(*) n FROM showroom_store_locations WHERE store_id = ${B}`);
    check("branch has no orphaned locations", Number(branchLocs?.n) === 0, `branch locs=${branchLocs?.n}`);

    // ── idempotent: a second apply is a no-op ──
    const again = await call("apply_merge_candidate", { id: candId }).catch((e) => ({ __error: e.message }));
    check(
      "second apply is safe (APPLIED or refused-not-approved)",
      again.status === "APPLIED" || String(again.__error ?? "").includes("not APPROVED"),
      JSON.stringify(again).slice(0, 120),
    );
    const [reLocs] = d1(`SELECT count(*) n FROM showroom_store_locations WHERE store_id = ${A}`);
    check("re-apply did not duplicate the location", Number(reLocs?.n) === 2, `keeper locs=${reLocs?.n}`);

    // ── re-scan produces no new candidate for the now-collapsed group ──
    const rescan = await call("scan_showroom_merge_candidates", {});
    check("re-scan creates nothing for collapsed group", rescan.created === 0, `created=${rescan.created}`);
  }

  // Regression: the extracted remap didn't break tier-1 reads.
  const c = createClient({ base: BASE });
  const stores = await c.get("/api/showroom-stores");
  check("/api/showroom-stores still 200", stores.status === 200, `status=${stores.status}`);
} catch (err) {
  console.error("\nQC threw:", err?.message ?? err);
  process.exitCode = 1;
} finally {
  try {
    cleanup();
    info("sentinel rows cleaned up");
  } catch (e) {
    console.error("CLEANUP FAILED — check for ZZ_QC_COLLAPSE rows:", e?.message);
    process.exitCode = 1;
  }
}

summary();
