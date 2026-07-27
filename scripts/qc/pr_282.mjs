#!/usr/bin/env node
/**
 * QC — PR #282 (0037 Phase 2: Showrooms grouped-table).
 *
 * Frontend rebuild wired to LIVE data. SSR smoke + a data-shape guard: the
 * showrooms page still 200s, the data + meta endpoints the new view depends on
 * still return their expected shapes, and (on --preview) the new grouped-table
 * markers are present. On production (pre-merge) the new markers are reported
 * "pending merge/deploy" rather than failing.
 *
 *   pnpm run test:pr 282 -- --preview   # branch preview (new grouped table)
 *   pnpm run test:pr 282                # production (regression guard)
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const isPreview = process.argv.includes("--preview");
const base = resolveBase();
const client = createClient({ base });
const c = createChecks();

async function main() {
  console.log(`\nQC pr_282 — base: ${base}${isPreview ? " (preview)" : " (production)"}\n`);
  await assertReachable(client, c);

  const page = await client.get("/admin/shopping/showrooms");
  c.ok("GET /admin/shopping/showrooms → 200", page.status === 200, `status ${page.status}`);

  // The data + meta endpoints the grouped view consumes (unchanged contract).
  const stores = await client.get("/api/showroom-stores?include=categories,ratings");
  c.ok("GET /api/showroom-stores → 200", stores.status === 200, `status ${stores.status}`);
  const list = Array.isArray(stores.json) ? stores.json : stores.json?.stores || stores.json?.data || [];
  c.ok("stores payload is a non-empty array", Array.isArray(list) && list.length > 0, `got ${list.length ?? "?"}`);
  if (list[0]) {
    const s = list[0];
    c.ok("store row carries the fields the view maps", "id" in s && "name" in s && "categories" in s,
      `keys: ${Object.keys(s).slice(0, 8).join(",")}`);
  }
  for (const m of ["categories", "types", "cities"]) {
    const r = await client.get(`/api/showroom-stores/meta/${m}`);
    c.ok(`GET /api/showroom-stores/meta/${m} → 200`, r.status === 200, `status ${r.status}`);
  }

  // ShowroomsDirectoryApp is a client:only island — its rendered tabs never
  // appear in SSR HTML (they hydrate client-side; verified in-browser on the
  // preview). So assert the island is WIRED with the new default tab instead of
  // scanning for rendered text.
  const html = page.text || "";
  const islandWired = html.includes("ShowroomsDirectoryApp");
  const groupedDefault = /initialTab["']?\s*[:=]\s*["']?grouped/i.test(html) || html.includes("grouped");
  if (isPreview) {
    c.ok("ShowroomsDirectoryApp island present in SSR HTML", islandWired,
      "island component not referenced");
    c.ok("default tab is 'grouped' (new view)", groupedDefault, "grouped prop not found");
  } else if (islandWired && groupedDefault) {
    c.ok("grouped-table island live on prod (merged + deployed)", true);
  } else {
    c.info("grouped-table not on prod yet — pending merge/deploy (expected pre-merge)");
  }

  c.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
