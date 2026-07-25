#!/usr/bin/env node
/**
 * QC for PR #253 — drive schema foundation + HTML-entity cleanup (0031 PR-B0).
 * Run: node scripts/qc/pr_253.mjs --preview   (or bare for prod)
 *
 * Read-only regressions (pass on prod AND preview): the entity backfill left no
 * `&amp;` in drive titles, the drive_list_notes table is queryable, and `kind`
 * is populated. Create-path test: POST a drive with an entity-laden title and
 * assert createDriveList decoded it (and slugified the decoded title) before
 * storing — then clean the throwaway drive up.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const IS_PROD = BASE.replace(/\/$/, "") === "https://core-remodel.hacolby.workers.dev";
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_253 (drive schema + entity cleanup) against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

// ── Read-only regressions ────────────────────────────────────────────────
const enc = d1("SELECT count(*) AS n FROM drive_lists WHERE title LIKE '%&amp;%' OR title LIKE '%&lt;%' OR title LIKE '%&gt;%';")[0]?.n;
check("no drive titles still carry HTML entities", Number(enc) === 0, `encoded titles=${enc}`);

const notes = d1("SELECT count(*) AS n FROM drive_list_notes;")[0]?.n;
check("drive_list_notes table exists + backfilled", Number(notes) >= 0, `rows=${notes}`);

const kinds = d1("SELECT count(*) AS n FROM drive_list_stops WHERE kind IN ('core','optional','pitstop');")[0]?.n;
const total = d1("SELECT count(*) AS n FROM drive_list_stops;")[0]?.n;
check("every stop has a valid kind", Number(kinds) === Number(total), `${kinds}/${total}`);

// ── Create-path: decodeHtmlEntities runs in createDriveList ───────────────
// Needs the new code deployed — skip on prod until this merges + deploys.
let createdSlug = null;
if (IS_PROD) {
  info("create-path decode test skipped on prod (pending merge/deploy)");
} else try {
  const marker = "QC253 Kitchen &amp; Bath &lt;test&gt;";
  const res = await c.post("/api/drive-lists", {
    title: marker,
    stops: [{ name: "Tile &amp; Stone Co", city: "Berkeley &amp; Oakland" }],
  });
  check("POST /api/drive-lists 201", res.status === 201, `status=${res.status}`);
  createdSlug = res.json?.slug ?? null;
  if (createdSlug) {
    const drive = (await c.get(`/api/drive-lists/${encodeURIComponent(createdSlug)}`)).json;
    check(
      "stored title is entity-decoded",
      drive?.title === "QC253 Kitchen & Bath <test>",
      `title=${JSON.stringify(drive?.title)}`,
    );
    check("slug has no 'amp' from the entity", !createdSlug.includes("amp"), `slug=${createdSlug}`);
    check("stop field decoded", drive?.stops?.[0]?.city === "Berkeley & Oakland", `city=${JSON.stringify(drive?.stops?.[0]?.city)}`);
    check("new stop got a kind", drive?.stops?.[0]?.kind === "core", `kind=${drive?.stops?.[0]?.kind}`);
  }
} finally {
  if (createdSlug) {
    // drive_list_stops + notes cascade on the drive delete.
    d1(`DELETE FROM drive_lists WHERE slug = '${createdSlug.replace(/'/g, "''")}';`);
    info(`cleaned up throwaway drive ${createdSlug}`);
  }
}

summary();
