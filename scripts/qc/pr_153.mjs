#!/usr/bin/env node
/**
 * @fileoverview QC for PR #153 — showroom viewport touch UX.
 *
 * Branch: claude/showroom-touch-ux
 * Migrations: none (UI-only; soft-delete `isActive` ships separately)
 *
 * Run:  pnpm run test:pr 153
 *
 * This PR is mostly frontend, so QC splits in two:
 *
 *   1. A pure unit check of `computeOpenBadge` — the one piece of NEW logic
 *      (the 4th "opening-soon" state), imported straight from the TSX bundle's
 *      source module under Node's native type stripping. It has no DOM/fetch
 *      dependency, so it is directly testable and the assertions below are the
 *      real behavioural guard on this PR.
 *
 *   2. API contract checks against the DEPLOYED worker for the data the new UI
 *      reads: store `links[]` (drives the hero icon-button row), `latitude`/
 *      `longitude` (the Tesla Navigate payload), and the Tesla navigate route
 *      itself. These are regression guards — the UI silently renders nothing if
 *      `links[]` regresses, which is exactly the failure a green-on-empty suite
 *      would miss, so each one asserts against real row counts.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";
import {
  computeOpenBadge,
  hoursJsonToRows,
} from "../../src/frontend/components/showroom/hours-status.ts";

const client = createClient();
const checks = createChecks();

/** A PstNow at a given day/hour:minute (label is unused by computeOpenBadge). */
const at = (day, hour, minute = 0) => ({ day, minutes: hour * 60 + minute, label: "" });

/** Mon–Fri 9:00–17:00. */
const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"].map((day) => ({
  day,
  openHour: 9,
  openMinute: 0,
  closeHour: 17,
  closeMinute: 0,
}));

function unitChecks() {
  // ── The four states, on a Wednesday (day index 3) ────────────────────────
  checks.ok("open: Wed 12:00 inside 9–17", computeOpenBadge(WEEKDAYS, at(3, 12)) === "open");
  checks.ok(
    "closing-soon: Wed 16:30 is within 60m of the 17:00 close",
    computeOpenBadge(WEEKDAYS, at(3, 16, 30)) === "closing-soon",
  );
  // The whole point of this PR's badge work — a store you can still catch today
  // must NOT read as "closed".
  checks.ok(
    "opening-soon: Wed 07:00 is before the 9:00 open (NOT closed)",
    computeOpenBadge(WEEKDAYS, at(3, 7)) === "opening-soon",
  );
  checks.ok(
    "closed: Wed 18:00 is after the 17:00 close",
    computeOpenBadge(WEEKDAYS, at(3, 18)) === "closed",
  );
  checks.ok(
    "closed: Sunday has no window at all",
    computeOpenBadge(WEEKDAYS, at(0, 12)) === "closed",
  );

  // ── Boundaries ────────────────────────────────────────────────────────────
  checks.ok("open at exactly 9:00 (open is inclusive)", computeOpenBadge(WEEKDAYS, at(3, 9)) === "open");
  checks.ok(
    "closed at exactly 17:00 (close is exclusive)",
    computeOpenBadge(WEEKDAYS, at(3, 17)) === "closed",
  );
  checks.ok(
    "closing-soon at exactly 16:00 (the 60m boundary)",
    computeOpenBadge(WEEKDAYS, at(3, 16)) === "closing-soon",
  );

  // ── No hours → no badge (the caller hides it rather than showing "Closed") ─
  checks.ok("null badge when there are no hours", computeOpenBadge([], at(3, 12)) === null);

  // ── The hoursJson → rows bridge the modal + card both go through ──────────
  const rows = hoursJsonToRows({ wed: { open: "09:00", close: "17:00" }, sun: null });
  checks.ok("hoursJsonToRows drops closed days", rows.length === 1, `got ${rows.length} rows`);
  checks.ok(
    "hoursJsonToRows round-trips into an 'open' badge",
    computeOpenBadge(rows, at(3, 12)) === "open",
  );
}

async function main() {
  console.log(`\nPR #153 QC → ${client.base}\n`);

  console.log("  ── computeOpenBadge (pure) ──");
  unitChecks();

  console.log("\n  ── deployed API contract ──");
  await assertReachable(client, checks);

  const noAuth = await client.get("/api/showroom-stores", { auth: false });
  checks.ok("showroom API rejects an unauthenticated read (401)", noAuth.status === 401, `got ${noAuth.status}`);

  const stores = await client.get("/api/showroom-stores");
  const list = Array.isArray(stores.json) ? stores.json : (stores.json?.stores ?? []);
  checks.ok("GET /api/showroom-stores → 200", stores.status === 200, `got ${stores.status}`);
  // Guard the "green over an empty table" trap: every assertion below is
  // meaningless if the list is empty, so fail loudly rather than pass vacuously.
  checks.ok("directory returned real rows to assert against", list.length > 0, `got ${list.length} stores`);

  // The hero icon row renders one button per link type present on the store, so
  // find a store that actually HAS links — asserting on a store with none would
  // pass while the field was broken repo-wide.
  let withLinks = null;
  let withCoords = null;
  for (const s of list.slice(0, 25)) {
    const detail = await client.get(`/api/showroom-stores/${s.id}`);
    if (detail.status !== 200) continue;
    if (!withLinks && (detail.json?.links ?? []).length > 0) withLinks = detail.json;
    if (!withCoords && detail.json?.latitude != null && detail.json?.longitude != null) {
      withCoords = detail.json;
    }
    if (withLinks && withCoords) break;
  }

  checks.ok(
    "at least one store detail carries a non-empty links[] (hero icon row has data)",
    withLinks !== null,
    "no store in the first 25 returned any links",
  );
  if (withLinks) {
    checks.ok(
      "every link row carries { url, type } (the icon row keys off type)",
      withLinks.links.every((l) => typeof l.url === "string" && typeof l.type === "string"),
      JSON.stringify(withLinks.links[0]),
    );
    checks.info(
      `store ${withLinks.id} links: ${withLinks.links.map((l) => l.type).join(", ")}`,
    );
  }

  // Tesla Navigate prefers {lat,lng}; without coords on the payload the button
  // silently degrades to the address-text fallback.
  checks.ok(
    "store detail exposes latitude/longitude (Tesla Navigate payload)",
    withCoords !== null,
    "no store in the first 25 returned coordinates",
  );

  // The Navigate button's endpoint. Assert the CONTRACT, not the car: a bad
  // request must be rejected 400 rather than silently accepted.
  const badNav = await client.post("/api/tesla/navigate", {});
  checks.ok(
    "POST /api/tesla/navigate rejects an empty body (400)",
    badNav.status === 400,
    `got ${badNav.status}`,
  );
  const navNoAuth = await client.post("/api/tesla/navigate", {}, { auth: false });
  checks.ok(
    "POST /api/tesla/navigate is admin-gated (401 unauthenticated)",
    navNoAuth.status === 401,
    `got ${navNoAuth.status}`,
  );
  checks.info("(a real navigate is NOT sent — it would start routing in the car)");

  // Categories modal source.
  const cats = await client.get("/api/showroom-stores/meta/categories");
  checks.ok("GET /api/showroom-stores/meta/categories → 200", cats.status === 200, `got ${cats.status}`);
  checks.ok(
    "category vocabulary is non-empty (the checkbox grid has rows)",
    (cats.json?.categories ?? []).length > 0,
    `got ${(cats.json?.categories ?? []).length}`,
  );

  checks.finish();
}

main().catch((err) => {
  console.error("\nUnexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
