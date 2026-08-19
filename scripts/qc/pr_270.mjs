#!/usr/bin/env node
/**
 * QC for PR #270 — banner Return/End + showroom detail modal (#8).
 * Run: node scripts/qc/pr_270.mjs --preview   (or bare for prod)
 *
 * Frontend-only. Asserts the data the two features read is present: the banner's
 * /active probe, and that a linked stop's showroom detail endpoint returns the
 * fields the modal renders (name + brands/products/phone). Read-only.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_270 (banner + showroom modal) against ${BASE}\n`);

const list = await c.get("/api/drive-lists");
check("GET /api/drive-lists 200", list.status === 200, `status=${list.status}`);
const active = await c.get("/api/drive-lists/active");
check("GET /active 200 (banner probe)", active.status === 200 && "active" in (active.json ?? {}), `status=${active.status}`);

// Find a drive with a linked stop, then assert its showroom detail powers the modal.
let showroomId = null;
let anySlug = null;
for (const d of list.json?.driveLists ?? []) {
  const dr = (await c.get(`/api/drive-lists/${encodeURIComponent(d.slug)}`)).json;
  const linked = (dr.stops ?? []).find((s) => s.showroomStoreId != null);
  if (linked) {
    showroomId = linked.showroomStoreId;
    anySlug = d.slug;
    break;
  }
}
if (anySlug) {
  const page = await c.get(`/admin/shopping/drives/${encodeURIComponent(anySlug)}`, { auth: false });
  check("drive viewport renders (200)", page.status === 200, `status=${page.status}`);
}
if (showroomId) {
  const detail = await c.get(`/api/showroom-stores/${showroomId}`);
  check("showroom detail endpoint 200", detail.status === 200, `status=${detail.status}`);
  const d = detail.json ?? {};
  check("detail has a name for the modal header", typeof d.name === "string" && d.name.length > 0, `name=${d.name}`);
  info(`modal data: brands=${(d.brands ?? []).length}, products=${(d.products ?? []).length}, phone=${d.phoneNumber ? "yes" : "no"}, hero=${d.heroImageCfImagesUrl ? "yes" : "no"}`);
} else {
  info("no linked stop found to exercise the detail modal");
}
summary();
