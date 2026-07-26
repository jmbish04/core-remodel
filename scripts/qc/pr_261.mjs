#!/usr/bin/env node
/**
 * QC for PR #261 — drive notes API + stop rating + active-drive controls.
 * Run: node scripts/qc/pr_261.mjs --preview   (or bare for prod)
 *
 * Read-only regressions run on prod (list + /active answer). The write lifecycle
 * (notes CRUD, rating→showroom visit log, and the single-active invariant) is
 * gated to non-prod since the endpoints are new pre-deploy. Everything created
 * is cleaned up.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const IS_PROD = BASE.replace(/\/$/, "") === "https://core-remodel.hacolby.workers.dev";
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_261 (notes + rating + active-drive) against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}
function d1Throws(sql) {
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return false;
  } catch {
    return true;
  }
}

// Read-only regressions (prod + preview).
const list = await c.get("/api/drive-lists");
check("GET /api/drive-lists 200", list.status === 200, `status=${list.status}`);
const active = await c.get("/api/drive-lists/active");
check("GET /api/drive-lists/active 200 + shape", active.status === 200 && "active" in (active.json ?? {}), `status=${active.status}`);

if (IS_PROD) {
  info("write lifecycle skipped on prod (new endpoints pending merge/deploy)");
  summary();
} else {
  let slugA = null;
  let slugB = null;
  let storeId = null;
  try {
    d1("INSERT INTO showroom_stores (name) VALUES ('QC261 Rating Store');");
    storeId = d1("SELECT id FROM showroom_stores WHERE name='QC261 Rating Store' ORDER BY id DESC LIMIT 1;")[0]?.id;

    const a = await c.post("/api/drive-lists", {
      title: "QC261 A",
      status: "draft",
      stops: [{ name: "Linked stop", showroomStoreId: storeId }, { name: "Unlinked stop" }],
    });
    slugA = a.json?.slug;
    const driveA = (await c.get(`/api/drive-lists/${slugA}`)).json;
    const linked = driveA.stops.find((s) => s.showroomStoreId === storeId);
    const unlinked = driveA.stops.find((s) => s.showroomStoreId == null);

    // Notes: drive-global + per-stop.
    await c.post(`/api/drive-lists/${slugA}/notes`, { body: "Drive note &amp; more" });
    const sn = await c.post(`/api/drive-lists/${slugA}/notes`, { body: "Stop note", stopId: linked.id });
    const noteId = sn.json?.note?.id;
    const notes = (await c.get(`/api/drive-lists/${slugA}/notes`)).json;
    check("notes grouped (1 drive, 1 byStop)", notes.drive?.length === 1 && (notes.byStop?.[linked.id]?.length ?? 0) === 1, JSON.stringify({ drive: notes.drive?.length, stop: notes.byStop?.[linked.id]?.length }));
    check("note body entity-decoded", notes.drive?.[0]?.body === "Drive note & more", `body=${JSON.stringify(notes.drive?.[0]?.body)}`);
    const rd = await c.patch(`/api/drive-lists/${slugA}/notes/${noteId}`, { read: true });
    check("mark note read 200", rd.status === 200, `status=${rd.status}`);
    const after = (await c.get(`/api/drive-lists/${slugA}/notes`)).json;
    check("read_at persisted", after.byStop?.[linked.id]?.[0]?.readAt != null, `readAt=${after.byStop?.[linked.id]?.[0]?.readAt}`);
    const del = await c.req("DELETE", `/api/drive-lists/${slugA}/notes/${noteId}`);
    check("delete note 200", del.status === 200, `status=${del.status}`);

    // Rating → showroom visit log.
    const rate = await c.post(`/api/drive-lists/${slugA}/stops/${linked.id}/rating`, { rating: 4, contextMarkdown: "Great slabs" });
    check("rate linked stop 200", rate.status === 200, `status=${rate.status}`);
    const storeRating = d1(`SELECT rating FROM showroom_stores WHERE id=${storeId};`)[0]?.rating;
    check("showroom rating updated to 4", Number(storeRating) === 4, `rating=${storeRating}`);
    const noteCount = d1(`SELECT count(*) AS n FROM store_notes WHERE store_id=${storeId};`)[0]?.n;
    check("store visit note created", Number(noteCount) >= 1, `notes=${noteCount}`);

    // deferFeedback creates an AI follow-up note on the stop.
    const defer = await c.post(`/api/drive-lists/${slugA}/stops/${linked.id}/rating`, { rating: 3, deferFeedback: true });
    check("deferFeedback filed an ai note", defer.json?.followUpNote?.source === "ai" && /follow up on feedback/.test(defer.json?.followUpNote?.body ?? ""), JSON.stringify(defer.json?.followUpNote?.source));

    // Unlinked stop can't be rated.
    const bad = await c.post(`/api/drive-lists/${slugA}/stops/${unlinked.id}/rating`, { rating: 5 });
    check("rating an unlinked stop → 400", bad.status === 400, `status=${bad.status}`);

    // Active-drive: single-active invariant + /active endpoint.
    const b = await c.post("/api/drive-lists", { title: "QC261 B", status: "draft", stops: [{ name: "x" }] });
    slugB = b.json?.slug;
    d1(`UPDATE drive_lists SET is_active=1 WHERE slug='${slugA}';`);
    const act1 = (await c.get("/api/drive-lists/active")).json;
    check("/active returns the active drive", act1.active?.slug === slugA, `active=${act1.active?.slug}`);
    // The partial unique index must forbid a second active row.
    const rejected = d1Throws(`UPDATE drive_lists SET is_active=1 WHERE slug='${slugB}';`);
    check("DB rejects a second active drive (single-active index)", rejected, `rejected=${rejected}`);
  } finally {
    for (const s of [slugA, slugB]) if (s) d1(`DELETE FROM drive_lists WHERE slug='${s.replace(/'/g, "''")}';`);
    if (storeId) d1(`DELETE FROM showroom_stores WHERE id=${storeId};`);
    info(`cleaned up drives + throwaway store`);
  }
  summary();
}
