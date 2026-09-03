#!/usr/bin/env node
/**
 * QC — PR #411: location-centric viewport promotion + directory/category overhaul.
 * Run: node scripts/qc/pr_411.mjs --preview   (or bare for prod)
 *
 * The promotion (canonical routes serve the V2 app, /v2 retired, location URLs)
 * is live on the branch preview until merge+deploy. So:
 *   - Routes/behaviour NEW to this branch → checked on --preview; on prod they
 *     reflect pre-merge state and are reported as "pending merge/deploy".
 *   - The backend contract fields (primaryCategory, hubRoutes, per-location
 *     locations[]) shipped separately and are live on BOTH bases (regression).
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const isPreview = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_411 against ${BASE}${isPreview ? " (preview)" : ""}\n`);

const STORE = 116; // Jack London — 5 locations, categorized.

try {
  // ── Backend contract fields (live on both bases) ──────────────────────────
  const list = await c.get("/api/showroom-stores?include=categories,ratings");
  check("list 200", list.status === 200, `status=${list.status}`);
  const stores = list.json?.stores ?? [];
  check("list returns stores", stores.length > 0, `n=${stores.length}`);
  const withPrimary = stores.filter((s) => s.primaryCategory != null).length;
  check("stores carry primaryCategory", withPrimary > 0, `${withPrimary}/${stores.length}`);
  check(
    "stores carry hubRoutes[]",
    stores.some((s) => Array.isArray(s.hubRoutes) && s.hubRoutes.length > 0),
  );
  check(
    "list carries per-location coords array",
    stores.some((s) => Array.isArray(s.locations) && s.locations.some((l) => l.latitude != null)),
  );

  // Per-location detail: hours + rating roll-up.
  const locs = await c.get(`/api/showroom-stores/${STORE}/locations`);
  check("locations 200", locs.status === 200, `status=${locs.status}`);
  const L = locs.json?.locations ?? [];
  check("store has multiple locations", L.length > 1, `n=${L.length}`);
  check("exactly one primary location", L.filter((l) => l.isPrimary).length === 1);
  check("locations carry hoursJson", L.some((l) => l.hoursJson != null));

  // ── Promoted routes (NEW behaviour → preview) ─────────────────────────────
  const routes = [
    ["viewport (canonical)", `/admin/shopping/store/${STORE}`, true],
    ["section deep-link", `/admin/shopping/store/${STORE}/contacts`, true],
    ["legacy notes → visits-notes alias", `/admin/shopping/store/${STORE}/notes`, true],
    ["inbox", `/admin/shopping/store/${STORE}/inbox`, true],
    ["directory", `/admin/shopping/showrooms`, true],
  ];
  const primaryLoc = L.find((l) => l.isPrimary) ?? L[0];
  const otherLoc = L.find((l) => !l.isPrimary);
  if (otherLoc) {
    routes.push(["per-location route", `/admin/shopping/store/${STORE}/${otherLoc.id}`, false]);
  }
  for (const [label, path, bothBases] of routes) {
    const r = await c.get(path);
    if (!bothBases && r.status === 404 && !isPreview) {
      info(`${label}: pending merge/deploy (404 on prod base)`);
      continue;
    }
    check(`${label} 200`, r.status === 200, `${path} status=${r.status}`);
  }

  // Retired temp route: /v2 nested no longer resolves (only meaningful on preview).
  if (isPreview && primaryLoc) {
    const oldNested = await c.get(`/admin/shopping/store/${STORE}/v2/${primaryLoc.id}`);
    check("retired /v2/:loc no longer a route", oldNested.status === 404, `status=${oldNested.status}`);
  }
} catch (e) {
  check("QC ran without throwing", false, String(e?.message ?? e));
}

summary();
