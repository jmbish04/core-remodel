#!/usr/bin/env node
/**
 * QC for PR #267 — live per-stop timing (GET /:slug/plan).
 * Run: node scripts/qc/pr_267.mjs --preview   (or bare for prod)
 *
 * Anchors a throwaway drive's start (time + location) directly in D1 so the
 * timing is deterministic regardless of when QC runs: a Friday 1:00 PM start at
 * a stop open 9-5 is FEASIBLE; a Friday 5:30 PM start at the same stop WON'T
 * MAKE IT. Cleans up. Gated to non-prod (endpoint is new pre-deploy).
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const IS_PROD = BASE.replace(/\/$/, "") === "https://core-remodel.hacolby.workers.dev";
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_267 (live timing) against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

const list = await c.get("/api/drive-lists");
check("GET /api/drive-lists 200", list.status === 200, `status=${list.status}`);

if (IS_PROD) {
  const anySlug = list.json?.driveLists?.[0]?.slug;
  const plan = anySlug ? await c.get(`/api/drive-lists/${anySlug}/plan`) : { status: 0 };
  info(`prod /plan status=${plan.status} (endpoint pending deploy → 404 expected pre-merge)`);
  summary();
} else {
  const LAT = 37.66;
  const LNG = -122.09;
  const FRI_1PM = Math.floor(Date.UTC(2026, 6, 24, 20, 0, 0) / 1000); // Fri 1:00 PM PDT
  const FRI_530PM = Math.floor(Date.UTC(2026, 6, 25, 0, 30, 0) / 1000); // Fri 5:30 PM PDT
  let slug = null;
  let storeId = null;
  try {
    d1("INSERT INTO showroom_stores (name, latitude, longitude) VALUES ('QC267 Timing Store', 37.66, -122.09);");
    storeId = d1("SELECT id FROM showroom_stores WHERE name='QC267 Timing Store' ORDER BY id DESC LIMIT 1;")[0]?.id;
    d1(`INSERT INTO showroom_store_hours (showroom_id, day, open_hour, open_minute, close_hour, close_minute) VALUES (${storeId}, 'FRIDAY', 9, 0, 17, 0);`);

    const cr = await c.post("/api/drive-lists", {
      title: "QC267 Timing",
      status: "draft",
      stops: [{ name: "Timed stop", showroomStoreId: storeId, latitude: LAT, longitude: LNG }],
    });
    slug = cr.json?.slug;
    const stopId = (await c.get(`/api/drive-lists/${slug}`)).json.stops[0].id;

    // Feasible: Friday 1 PM start at the same coords → arrive ~1 PM, open till 5.
    d1(`UPDATE drive_lists SET started_at=${FRI_1PM}, start_latitude=${LAT}, start_longitude=${LNG} WHERE slug='${slug}';`);
    let plan = (await c.get(`/api/drive-lists/${slug}/plan`)).json;
    let t = (plan.stops ?? []).find((x) => x.stopId === stopId);
    check("plan 200 + timing for the stop", !!t && t.etaLocal != null, JSON.stringify(t));
    check("1 PM start is feasible with a real stay", t?.feasible === true && t?.stayMinutes > 0, JSON.stringify({ feasible: t?.feasible, stay: t?.stayMinutes, eta: t?.etaLocal }));
    check("close time surfaced (5:00 PM)", t?.closesAt === "5:00 PM", `closesAt=${t?.closesAt}`);

    // Won't-make-it: Friday 5:30 PM start → after the 5 PM close.
    d1(`UPDATE drive_lists SET started_at=${FRI_530PM} WHERE slug='${slug}';`);
    plan = (await c.get(`/api/drive-lists/${slug}/plan`)).json;
    t = (plan.stops ?? []).find((x) => x.stopId === stopId);
    check("5:30 PM start → won't make it", t?.feasible === false && /won't make it/i.test(t?.reason ?? ""), JSON.stringify({ feasible: t?.feasible, reason: t?.reason }));
  } finally {
    if (slug) d1(`DELETE FROM drive_lists WHERE slug='${slug.replace(/'/g, "''")}';`);
    if (storeId) d1(`DELETE FROM showroom_stores WHERE id=${storeId};`);
    info(`cleaned up drive + throwaway store`);
  }
  summary();
}
