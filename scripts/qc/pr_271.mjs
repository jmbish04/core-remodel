#!/usr/bin/env node
/**
 * QC for PR #271 — proximity pitstops (#9).
 * Run: node scripts/qc/pr_271.mjs --preview   (or bare for prod)
 *
 * Creates a throwaway drive with one core stop in the Bay Area cluster, asserts
 * proximity pitstops were suggested (minimized, kind='pitstop', suggested), and
 * that promoting one flips `suggested` off (which is what pulls it into timing).
 * Gated to non-prod (generation only runs on the new code). Cleans up.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const IS_PROD = BASE.replace(/\/$/, "") === "https://core-remodel.hacolby.workers.dev";
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_271 (proximity pitstops) against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

check("GET /api/drive-lists 200", (await c.get("/api/drive-lists")).status === 200, "");

if (IS_PROD) {
  info("generation runs on the new code only — gated to non-prod");
  summary();
} else {
  let slug = null;
  try {
    // Berkeley — dense with registered showrooms within 10 mi.
    const cr = await c.post("/api/drive-lists", {
      title: "QC271 Pitstops",
      status: "draft",
      stops: [{ name: "Anchor", latitude: 37.8715, longitude: -122.273 }],
    });
    slug = cr.json?.slug;
    const drive = (await c.get(`/api/drive-lists/${slug}`)).json;
    const pitstops = (drive.stops ?? []).filter((s) => s.kind === "pitstop" && s.suggested);
    check("proximity pitstops were suggested", pitstops.length > 0, `count=${pitstops.length}`);
    check("pitstops are minimized (suggested + optional + labeled)", pitstops.every((s) => s.suggested && s.isOptional && s.pick === "Proximity pitstop"), JSON.stringify(pitstops[0] && { suggested: pitstops[0].suggested, opt: pitstops[0].isOptional, pick: pitstops[0].pick }));

    if (pitstops[0]) {
      const promote = await c.patch(`/api/drive-lists/${slug}/stops/${pitstops[0].id}`, { suggested: false });
      check("promote (PATCH suggested:false) 200", promote.status === 200, `status=${promote.status}`);
      const after = (await c.get(`/api/drive-lists/${slug}`)).json;
      const p = after.stops.find((s) => s.id === pitstops[0].id);
      check("promoted pitstop is no longer suggested", p && p.suggested === false, JSON.stringify({ suggested: p?.suggested }));
    }
  } finally {
    if (slug) d1(`DELETE FROM drive_lists WHERE slug='${slug.replace(/'/g, "''")}';`);
    info(`cleaned up ${slug ?? "(none)"}`);
  }
  summary();
}
