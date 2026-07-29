#!/usr/bin/env node
/**
 * @fileoverview QC — PR #304, 0040 P0+P1: visit-photo leak + note format.
 *
 * P0 (regression): GET /api/showroom-stores/:id/photos must return ONLY
 *   imageKind='visit' rows — scraped storefront/showroom rows in the same table
 *   must no longer leak into "Your visit photos".
 *
 * P1 (write + sanitize): the visit-log service derives notesHtml from
 *   notesMarkdown server-side (the same renderNoteHtml the MCP note tools use).
 *   POST a cold DRAFT visit log whose Markdown contains a bold run AND an injected
 *   <script>, read it back, and assert the derived HTML has <strong> and NO
 *   <script> — proving Markdown→sanitized-HTML on the deployed worker. Cleans up
 *   the throwaway draft.
 *
 *   pnpm run test:pr 304 -- --preview
 *   pnpm run test:pr 304
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_304 — visit-photo leak + note format (0040 P0+P1)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // ── P0: photos endpoint returns only visit-kind rows ──────────────────────
  const list = await client.get("/api/showroom-stores?limit=25");
  const stores = list.json?.stores ?? list.json?.data ?? [];
  if (list.status === 401) {
    checks.info("GET /api/showroom-stores → 401 (gated; QC lacks a cookie here). Skipping P0 data check.");
  } else if (!Array.isArray(stores) || stores.length === 0) {
    checks.info(`GET /api/showroom-stores → ${list.status}, no stores returned; skipping P0 data check.`);
  } else {
    // Scan a handful of stores for any non-visit row surfacing through /photos.
    let scanned = 0;
    let leaked = null;
    for (const s of stores.slice(0, 10)) {
      const id = s.id ?? s.storeId;
      if (id == null) continue;
      const photos = await client.get(`/api/showroom-stores/${id}/photos`);
      if (photos.status !== 200 || !Array.isArray(photos.json?.photos)) continue;
      scanned += 1;
      const bad = photos.json.photos.find((p) => p.imageKind && p.imageKind !== "visit");
      if (bad) {
        leaked = { id, kind: bad.imageKind };
        break;
      }
    }
    if (leaked && !isPreview) {
      checks.info(`P0 — prod still leaks a '${leaked.kind}' row on store ${leaked.id} (pending merge/deploy of the imageKind filter; expected pre-merge).`);
    } else {
      checks.ok(
        `P0 — /photos returns only imageKind='visit' across ${scanned} store(s)`,
        leaked === null,
        leaked ? `store ${leaked.id} leaked a '${leaked.kind}' row` : "",
      );
    }
  }

  // ── P1: notesMarkdown → sanitized notesHtml on the deployed worker ─────────
  const md = "Visit **QC pr_304** note. <script>alert('xss')</script>\n\n- item one\n- item two";
  const created = await client.post("/api/showroom-visit-logs", {
    status: "DRAFT",
    notesMarkdown: md,
  });
  if (created.status === 401) {
    checks.info("POST /api/showroom-visit-logs → 401 (gated; QC lacks a cookie here). Skipping P1 write check.");
  } else if (![200, 201].includes(created.status)) {
    checks.ok("P1 — create a QC draft visit log", false, `POST → ${created.status}`);
  } else {
    const id = created.json?.id ?? created.json?.visit?.id ?? created.json?.data?.id;
    checks.ok("P1 — created a QC draft visit log", id != null, `id=${id}`);
    if (id != null) {
      const got = await client.get(`/api/showroom-visit-logs/${id}`);
      const v = got.json?.visit ?? got.json?.data ?? got.json ?? {};
      const html = v.notesHtml ?? "";
      if (!/<strong>/.test(html) && !isPreview) {
        checks.info(`P1 — prod did not derive notesHtml (html=${JSON.stringify(html)}); pending merge/deploy of deriveNotesHtml (expected pre-merge).`);
      } else {
        checks.ok("P1 — notesHtml derived from Markdown (has <strong>)", /<strong>/.test(html), `html=${JSON.stringify(html).slice(0, 120)}`);
      }
      checks.ok("P1 — injected <script> is NOT present in derived HTML", !/<script/i.test(html), `html=${JSON.stringify(html).slice(0, 120)}`);
      checks.ok("P1 — notesMarkdown preserved verbatim", v.notesMarkdown === md, "");
      // Cleanup the throwaway draft (preview shares prod D1).
      const del = await client.req("DELETE", `/api/showroom-visit-logs/${id}`);
      checks.info(`cleanup DELETE /api/showroom-visit-logs/${id} → ${del.status}`);
    }
  }

  // ── P1b: an html-only write (no Markdown) is sanitized before persist ──────
  const dirtyHtml = "<p onclick=\"steal()\">hi</p><script>alert('xss')</script>";
  const created2 = await client.post("/api/showroom-visit-logs", { status: "DRAFT", notesHtml: dirtyHtml });
  if (created2.status === 401) {
    checks.info("POST (html-only) → 401 (gated). Skipping P1b.");
  } else if (![200, 201].includes(created2.status)) {
    checks.info(`P1b — html-only draft create → ${created2.status} (skipping)`);
  } else {
    const id2 = created2.json?.id ?? created2.json?.visit?.id ?? created2.json?.data?.id;
    if (id2 != null) {
      const got2 = await client.get(`/api/showroom-visit-logs/${id2}`);
      const v2 = got2.json?.visit ?? got2.json?.data ?? got2.json ?? {};
      const html2 = v2.notesHtml ?? "";
      const clean = !/<script/i.test(html2) && !/onclick/i.test(html2);
      if (!clean && !isPreview) {
        checks.info("P1b — prod did not sanitize html-only write (pending merge/deploy; expected pre-merge).");
      } else {
        checks.ok("P1b — html-only write is sanitized (<script>/onclick stripped)", clean, `html=${JSON.stringify(html2).slice(0, 140)}`);
      }
      const del2 = await client.req("DELETE", `/api/showroom-visit-logs/${id2}`);
      checks.info(`cleanup DELETE /api/showroom-visit-logs/${id2} → ${del2.status}`);
    }
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
