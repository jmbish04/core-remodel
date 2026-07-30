#!/usr/bin/env node
/**
 * QC for PR #315 — vendor-facing public room gallery.
 * Run: node scripts/qc/pr_315.mjs --preview   (or bare for prod)
 *
 * Model: `/rooms/{code}` splits server-side by auth. The homeowner gets the full
 * `GET /api/rooms/code/:roomCode/detail` (gated). An unauthenticated visitor gets
 * a photos-only view backed by `GET /api/rooms/code/:roomCode/public`, which must
 * expose ONLY room name/dimensions + listing/inspiration photos — never budget,
 * estimates, options, docs, or AI metadata.
 *
 * Asserts (unauthenticated unless noted):
 *   1. catalog is public and yields a roomCode,
 *   2. the FULL detail read is LOCKED (401 unauth) and still works authed,
 *   3. the PUBLIC read is 200, photos-only, and leaks no private keys,
 *   4. a WRITE on the same router is still 401 unauth (gate intact).
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_315 (public room gallery) against ${BASE}\n`);

// 1. Catalog is public and gives us a real room to test.
const catalog = await c.get("/api/rooms/catalog", { auth: false });
check("catalog public (200)", catalog.status === 200, `status=${catalog.status}`);
const rooms = (catalog.json?.floors || []).flatMap((f) => f.rooms || []);
const roomCode = rooms.find((r) => r.roomCode)?.roomCode;
check("catalog yields a roomCode", !!roomCode, `roomCode=${roomCode}`);
if (!roomCode) {
  info("no roomCode in catalog — cannot exercise the fix, aborting");
  process.exit(1);
}

// 2. Full detail read is LOCKED for the public, unchanged for the homeowner.
const detailPub = await c.get(`/api/rooms/code/${roomCode}/detail`, { auth: false });
check("full detail LOCKED for public (401)", detailPub.status === 401, `status=${detailPub.status}`);
const detailAuthed = await c.get(`/api/rooms/code/${roomCode}/detail`);
check("full detail works authed (200) — regression", detailAuthed.status === 200, `status=${detailAuthed.status}`);

// 3. Public photos-only read.
const pub = await c.get(`/api/rooms/code/${roomCode}/public`, { auth: false });
check("public read (200)", pub.status === 200, `status=${pub.status} ${pub.text?.slice(0, 140)}`);
check(
  "public payload has room + listing/inspiration image arrays",
  pub.json?.success === true &&
    !!pub.json?.room?.displayName &&
    Array.isArray(pub.json?.listingImages) &&
    Array.isArray(pub.json?.inspirationImages),
  `room=${pub.json?.room?.displayName} listing=${pub.json?.listingImages?.length} inspiration=${pub.json?.inspirationImages?.length}`,
);
// The whole point: no private surface may appear on the public payload.
const PRIVATE_KEYS = ["budget", "estimates", "scenarioPlans", "visionNodes", "supportingDocuments", "actionItems", "summary"];
const leaked = PRIVATE_KEYS.filter((k) => k in (pub.json || {}));
check("public payload leaks no private keys", leaked.length === 0, `leaked=${leaked.join(",") || "none"}`);
// Images carry only delivery ids, not internal columns.
const sample = pub.json?.listingImages?.[0] || pub.json?.inspirationImages?.[0];
if (sample) {
  const allowed = new Set(["id", "displayName", "cfImageIdOriginal", "cfImageIdOptimized"]);
  const extra = Object.keys(sample).filter((k) => !allowed.has(k));
  check("public image objects expose only delivery fields", extra.length === 0, `extra=${extra.join(",") || "none"}`);
} else {
  info("no images on this room — image-shape check skipped");
}

// 4. Writes on the same router stay gated unauthenticated. Non-existent room +
// empty body so a broken gate can never mutate a real record.
const write = await c.patch(`/api/rooms/code/__qc-nonexistent-room__/profile`, {}, { auth: false });
check("write still 401 unauthenticated — gate intact", write.status === 401, `status=${write.status}`);
info(`tested roomCode=${roomCode}`);

process.exit(summary().failed === 0 ? 0 : 1);
