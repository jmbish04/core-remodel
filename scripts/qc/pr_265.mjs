#!/usr/bin/env node
/**
 * QC for PR #265 — Phase B UI (notes-as-alerts, rating modal, skip).
 * Run: node scripts/qc/pr_265.mjs --preview   (or bare for prod)
 *
 * Frontend-only PR — no new endpoints. Asserts the drive viewport shell renders
 * and that the notes round-trip the UI drives (create → list → delete) works;
 * the endpoints themselves shipped in #261. Cleans up.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_265 (Phase B UI) against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

const list = await c.get("/api/drive-lists");
check("GET /api/drive-lists 200", list.status === 200, `status=${list.status}`);
const anySlug = list.json?.driveLists?.[0]?.slug;
if (anySlug) {
  const page = await c.get(`/admin/shopping/drives/${encodeURIComponent(anySlug)}`, { auth: false });
  check("drive viewport shell renders (200)", page.status === 200, `status=${page.status}`);
}

let slug = null;
try {
  const cr = await c.post("/api/drive-lists", { title: "QC265 UI", status: "draft", stops: [{ name: "s" }] });
  slug = cr.json?.slug;
  const stopId = (await c.get(`/api/drive-lists/${slug}`)).json.stops[0].id;
  await c.post(`/api/drive-lists/${slug}/notes`, { body: "note one" });
  await c.post(`/api/drive-lists/${slug}/notes`, { body: "stop note", stopId });
  const notes = (await c.get(`/api/drive-lists/${slug}/notes`)).json;
  check("notes list drives the UI (1 drive + 1 stop note)", notes.drive?.length === 1 && (notes.byStop?.[stopId]?.length ?? 0) === 1, JSON.stringify({ d: notes.drive?.length, s: notes.byStop?.[stopId]?.length }));
} finally {
  if (slug) d1(`DELETE FROM drive_lists WHERE slug='${slug.replace(/'/g, "''")}';`);
  info(`cleaned up ${slug ?? "(none)"}`);
}
summary();
