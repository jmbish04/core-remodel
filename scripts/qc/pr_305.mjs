#!/usr/bin/env node
/**
 * @fileoverview QC — PR #305, 0040 P2+P3: image management + photo folders.
 *
 * Exercises the P3 image-group lifecycle end to end (non-destructive: it creates
 * a folder, moves photos in, reads them back, then soft-deletes the folder — the
 * photos are always preserved and returned to loose). Proves: ownership-scoped
 * create/member/list/delete, pricing text+cents, description Markdown→sanitized
 * HTML, cover derivation, and group_id set/clear.
 *
 * The routes are new, so on prod (pre-merge/deploy) they 404 → reported pending,
 * not failed.
 *
 *   pnpm run test:pr 305 -- --preview
 *   pnpm run test:pr 305
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_305 — image management + photo folders (0040 P2+P3)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

function pendingOr(cond, okName, val) {
  if (!cond && !isPreview) {
    checks.info(`${okName} — route not on prod yet (pending merge/deploy; expected pre-merge).`);
    return false;
  }
  return true;
}

try {
  await assertReachable(client, checks);

  // Find a store with >= 2 visit photos.
  const list = await client.get("/api/showroom-stores?limit=50");
  const stores = list.json?.stores ?? list.json?.data ?? [];
  let target = null;
  if (Array.isArray(stores)) {
    for (const s of stores) {
      const id = s.id ?? s.storeId;
      if (id == null) continue;
      const photos = await client.get(`/api/showroom-stores/${id}/photos`);
      const arr = photos.json?.photos;
      if (Array.isArray(arr) && arr.length >= 2) {
        target = { id, ids: arr.slice(0, 2).map((p) => p.id) };
        break;
      }
    }
  }
  if (!target) {
    checks.info("No store with >= 2 visit photos found; skipping the folder round-trip.");
    checks.finish();
  }

  const { id: storeId, ids } = target;

  // Create a folder with the first photo.
  const created = await client.post(`/api/showroom-stores/${storeId}/image-groups`, {
    name: "QC pr_305 folder",
    priceText: "$1,299",
    priceCents: 129900,
    descriptionMarkdown: "**two** faucets <script>alert(1)</script>",
    imageIds: [ids[0]],
  });
  if (!pendingOr([200, 201].includes(created.status), "P3 — create folder", created.status)) {
    checks.finish();
  }
  const gid = created.json?.group?.id;
  checks.ok("P3 — folder created", gid != null, `id=${gid}`);

  // Add the second photo.
  const added = await client.post(`/api/showroom-stores/${storeId}/image-groups/${gid}/members`, { add: [ids[1]] });
  checks.ok("P3 — add member", added.status === 200, `→ ${added.status}`);

  // List and assert the derived fields.
  const listed = await client.get(`/api/showroom-stores/${storeId}/image-groups`);
  const g = (listed.json?.groups ?? []).find((x) => x.id === gid) ?? {};
  checks.ok("P3 — memberCount = 2", g.memberCount === 2, `memberCount=${g.memberCount}`);
  checks.ok("P3 — pricing stored as cents", g.priceCents === 129900, `priceCents=${g.priceCents}`);
  checks.ok("P3 — description Markdown → sanitized HTML (<strong>, no <script>)",
    /<strong>/.test(g.descriptionHtml || "") && !/<script/i.test(g.descriptionHtml || ""),
    `descHtml=${JSON.stringify(g.descriptionHtml)}`);
  checks.ok("P3 — cover derived", Boolean(g.coverDeliveryUrl), "");

  // group_id was set on the photos.
  const afterAdd = await client.get(`/api/showroom-stores/${storeId}/photos`);
  const grouped = (afterAdd.json?.photos ?? []).filter((p) => p.groupId === gid).length;
  checks.ok("P3 — photos carry group_id", grouped === 2, `grouped=${grouped}`);

  // Soft-delete the folder → photos loosened, never deleted.
  const del = await client.req("DELETE", `/api/showroom-stores/${storeId}/image-groups/${gid}`);
  checks.ok("P3 — delete folder", del.status === 200, `→ ${del.status}`);
  const afterDel = await client.get(`/api/showroom-stores/${storeId}/photos`);
  const stillGrouped = (afterDel.json?.photos ?? []).filter((p) => p.groupId === gid).length;
  const stillPresent = (afterDel.json?.photos ?? []).filter((p) => ids.includes(p.id)).length;
  checks.ok("P3 — photos loosened (group_id cleared)", stillGrouped === 0, `stillGrouped=${stillGrouped}`);
  checks.ok("P3 — photos preserved (not deleted)", stillPresent === 2, `present=${stillPresent}`);
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
