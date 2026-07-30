#!/usr/bin/env node
/**
 * @fileoverview QC — PR #309, 0041 P2+P3: render session from photos + refs.
 *
 * Exercises the bridge end to end: create a render session seeded from showroom
 * photo ids, read the parsed seedReferences back, list reference-folders, and
 * append both an individual image and a whole folder (deduped). Creates a couple
 * of throwaway render sessions (empty orphan rows — harmless).
 *
 * Routes are new, so on prod (pre-merge/deploy) they 404 → reported pending.
 *
 *   pnpm run test:pr 309 -- --preview
 *   pnpm run test:pr 309
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_309 — render session from photos + refs (0041 P2+P3)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // Probe the new route; on prod it may not exist yet.
  const probe = await client.post("/api/render/sessions/from-images", { name: "QC probe", references: [{ url: "https://example.com/x.jpg" }] });
  if (probe.status === 404 && !isPreview) {
    checks.info("render from-images route not on prod yet (pending merge/deploy; expected pre-merge).");
    checks.finish();
  }

  // Find a store with >= 2 visit photos.
  const list = await client.get("/api/showroom-stores?limit=40");
  let ids = null;
  for (const s of list.json?.stores ?? []) {
    const id = s.id ?? s.storeId;
    if (id == null) continue;
    const photos = await client.get(`/api/showroom-stores/${id}/photos`);
    const arr = photos.json?.photos;
    if (Array.isArray(arr) && arr.length >= 2) {
      ids = arr.slice(0, 2).map((p) => p.id);
      break;
    }
  }
  if (!ids) {
    checks.info("No store with >= 2 visit photos; skipping the round-trip.");
    checks.finish();
  }

  // P2 — create session seeded from a photo.
  const created = await client.post("/api/render/sessions/from-images", { name: "QC pr_309", showroomImageIds: [ids[0]] });
  const sid = created.json?.id;
  checks.ok("P2 — create session from images", [200, 201].includes(created.status) && sid, `→ ${created.status} id=${sid}`);
  checks.ok("P2 — response carries seedReferences", Array.isArray(created.json?.seedReferences) && created.json.seedReferences.length === 1, `n=${created.json?.seedReferences?.length}`);

  // GET returns parsed seedReferences.
  const got = await client.get(`/api/render/sessions/${sid}`);
  checks.ok("P2 — GET /sessions/:id returns seedReferences", Array.isArray(got.json?.seedReferences) && got.json.seedReferences.length === 1, `n=${got.json?.seedReferences?.length}`);

  // P3 — reference-folders shape.
  const folders = await client.get("/api/render/reference-folders");
  const f0 = (folders.json?.folders ?? [])[0];
  checks.ok("P3 — reference-folders responds with folder shape", folders.status === 200 && Array.isArray(folders.json?.folders), `n=${folders.json?.folders?.length}`);

  // P3 — append an individual image id (dedupe: different id → grows to 2).
  const appended = await client.post(`/api/render/sessions/${sid}/references`, { showroomImageIds: [ids[1]] });
  checks.ok("P3 — append image ref grows the set", appended.status === 200 && (appended.json?.seedReferences?.length ?? 0) === 2, `n=${appended.json?.seedReferences?.length}`);

  // P3 — append a whole folder, if one exists.
  if (f0) {
    const before = appended.json?.seedReferences?.length ?? 0;
    const folderAppend = await client.post(`/api/render/sessions/${sid}/references`, { imageGroupId: f0.id });
    const after = folderAppend.json?.seedReferences?.length ?? 0;
    checks.ok("P3 — append folder adds its photos (deduped)", folderAppend.status === 200 && after >= before, `${before} → ${after} (folder ${f0.id}, ${f0.memberCount} photos)`);
  } else {
    checks.info("No reference folders to append; folder-append check skipped.");
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
