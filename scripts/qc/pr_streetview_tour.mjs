#!/usr/bin/env node
/**
 * QC — Showroom 360° Street View tour (browser key endpoint + render guard).
 * Run: node scripts/qc/pr_streetview_tour.mjs --preview   (or bare for prod)
 *
 * Covers the two new surfaces:
 *   1. GET  /api/places/maps-js-key            → serves GOOGLE_MAPS_API to the
 *      authed browser. Asserts the returned key === `tokens show GOOGLE_MAPS_API`.
 *   2. POST /api/showroom-stores/:id/streetview-render → quota-gated render log.
 *      Asserts {allowed:true} under cap (or a well-formed 403 QUOTA_LIMIT).
 *
 * Both endpoints are NEW: on production (main) they 404 until this branch merges
 * + deploys, so a 404 on the prod base is reported as "pending merge/deploy",
 * not a hard failure. Use --preview to exercise the live branch.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";
import { getToken } from "../tokens.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC streetview-tour against ${BASE}${isPreview ? " (preview)" : ""}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

const pending = (label, res) => {
  if (res.status === 404 && !isPreview) {
    info(`${label}: pending merge/deploy (404 on prod base)`);
    return true;
  }
  return false;
};

try {
  // ── 1. maps-js-key endpoint ──────────────────────────────────────────────
  const keyRes = await c.get("/api/places/maps-js-key");
  if (!pending("maps-js-key", keyRes)) {
    check("maps-js-key 200", keyRes.status === 200, `status=${keyRes.status}`);
    const served = keyRes.json?.key;
    check("maps-js-key returns a key", typeof served === "string" && served.length > 0);

    let expected = null;
    try {
      expected = getToken("GOOGLE_MAPS_API", { optional: true });
    } catch {
      /* tokens CLI unavailable in this env — skip the equality assertion */
    }
    if (expected) {
      check("served key === tokens GOOGLE_MAPS_API", served === expected);
    } else {
      info("tokens CLI unavailable — skipped key-equality check");
    }
  }

  // ── 2. streetview-render guard ───────────────────────────────────────────
  const storeId = d1(
    "SELECT id FROM showroom_stores WHERE latitude IS NOT NULL LIMIT 1;",
  )[0]?.id;
  check("found a store with coords", Number.isFinite(storeId), `storeId=${storeId}`);

  if (Number.isFinite(storeId)) {
    const beforeCount = d1(
      "SELECT COUNT(*) AS n FROM google_maps_usage_log WHERE endpoint = 'streetview:render';",
    )[0]?.n;

    const renderRes = await c.post(`/api/showroom-stores/${storeId}/streetview-render`, {
      panoId: "QC_TEST_PANO",
    });
    if (!pending("streetview-render", renderRes)) {
      const allowed = renderRes.status === 200 && renderRes.json?.allowed === true;
      const blocked = renderRes.status === 403 && renderRes.json?.reason === "QUOTA_LIMIT";
      check("render guard responds allowed|QUOTA_LIMIT", allowed || blocked, `status=${renderRes.status}`);

      if (allowed) {
        const afterCount = d1(
          "SELECT COUNT(*) AS n FROM google_maps_usage_log WHERE endpoint = 'streetview:render';",
        )[0]?.n;
        check("render logged one usage row", Number(afterCount) === Number(beforeCount) + 1, `${beforeCount}→${afterCount}`);
      }
    }

    // Invalid id → 400
    const badRes = await c.post(`/api/showroom-stores/0/streetview-render`, {});
    if (!pending("streetview-render bad-id", badRes)) {
      check("invalid store id → 400", badRes.status === 400, `status=${badRes.status}`);
    }
  }
} catch (e) {
  check("QC ran without throwing", false, String(e?.message ?? e));
}

summary();
