#!/usr/bin/env node
/**
 * QC for PR #312 — public room-detail read.
 * Run: node scripts/qc/pr_312.mjs --preview   (or bare for prod)
 *
 * The bug: the public floor plan links each room to `/rooms/{code}`, which loads
 * `GET /api/rooms/code/:roomCode/detail`. That read was gated by ensureAccess and
 * returned 401 to logged-out visitors. This PR makes the read public.
 *
 * Asserts, using an UNAUTHENTICATED client ({ auth: false }):
 *   1. the catalog is public (unchanged) and yields a real roomCode,
 *   2. the room-detail read is now public (200 + full payload) — the fix,
 *   3. the authenticated read still works (regression),
 *   4. a WRITE on the same router is STILL 401 unauthenticated — the gate that
 *      matters did not get removed by accident (security regression guard).
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_312 (public room-detail) against ${BASE}\n`);

// 1. Catalog is public and gives us a real room to test.
const catalog = await c.get("/api/rooms/catalog", { auth: false });
check("catalog public (200)", catalog.status === 200, `status=${catalog.status}`);
const rooms = (catalog.json?.floors || []).flatMap((f) => f.rooms || []);
const roomCode = rooms.find((r) => r.roomCode)?.roomCode;
check("catalog yields a roomCode", !!roomCode, `roomCode=${roomCode}`);

if (roomCode) {
  // 2. THE FIX: detail read is public.
  const pub = await c.get(`/api/rooms/code/${roomCode}/detail`, { auth: false });
  check("detail read public (200) — the fix", pub.status === 200, `status=${pub.status} ${pub.text?.slice(0, 140)}`);
  check(
    "public detail returns full payload",
    pub.json?.success === true && !!pub.json?.room && Array.isArray(pub.json?.listingImages),
    `success=${pub.json?.success} room=${pub.json?.room?.displayName} listing=${pub.json?.listingImages?.length}`,
  );

  // 3. Authenticated read unchanged.
  const authed = await c.get(`/api/rooms/code/${roomCode}/detail`);
  check("detail read authenticated (200) — regression", authed.status === 200, `status=${authed.status}`);

  // 4. Writes on the same router stay gated unauthenticated.
  const write = await c.patch(`/api/rooms/code/${roomCode}/profile`, { asIsUse: "qc-should-never-persist" }, { auth: false });
  check("write still 401 unauthenticated — gate intact", write.status === 401, `status=${write.status}`);
  info(`tested roomCode=${roomCode}`);
}

process.exit(summary().failed === 0 ? 0 : 1);
