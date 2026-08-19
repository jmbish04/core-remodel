#!/usr/bin/env node
/**
 * QC — PR #277 (0037 Phase 0: nested collapsible shopping sidebar + IA).
 *
 * Pure-frontend nav change, so this is an SSR smoke: every shopping page still
 * renders (200) with the sidebar in the HTML, and the new IA markers are
 * present. Against the branch PREVIEW it proves the new nav ships; against
 * PRODUCTION (pre-merge) it's a regression guard — the new-IA markers are
 * reported as "pending merge/deploy" rather than failing, since prod still runs
 * the old flat sidebar until this merges + deploys.
 *
 *   pnpm run test:pr 277 -- --preview   # branch preview (new nav)
 *   pnpm run test:pr 277                # production (regression guard)
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const isPreview = process.argv.includes("--preview");
const base = resolveBase();
const client = createClient({ base });
const c = createChecks();

// New-IA markers the SSR sidebar/hub emit only after this PR ships.
const IA_MARKERS = ["Purchase Ops", "Sourcing Tools", "data-sidebar-collapsed"];

const PAGES = [
  "/admin/shopping",
  "/admin/shopping/schedule",
  "/admin/shopping/showrooms",
  "/admin/shopping/wishlist",
];

async function main() {
  console.log(`\nQC pr_277 — base: ${base}${isPreview ? " (preview)" : " (production)"}\n`);
  await assertReachable(client, c);

  for (const path of PAGES) {
    const res = await client.get(path);
    // Admin pages are gated; the access cookie should yield the real page, not a redirect.
    c.ok(`GET ${path} → 200`, res.status === 200, `status ${res.status}`);
  }

  // The hub landing carries the regrouped IA + the standard page shell.
  const hub = await client.get("/admin/shopping");
  const html = hub.text || "";
  c.ok("hub renders the shopping shell", /Sourcing and Shopping tools/.test(html), "title missing");

  const foundMarkers = IA_MARKERS.filter((m) => html.includes(m) || false);
  // data-sidebar-collapsed lives on <html> in every admin page; check the schedule page too.
  const sched = await client.get("/admin/shopping/schedule");
  const collapseSeed = (sched.text || "").includes("data-sidebar-collapsed");

  if (isPreview) {
    c.ok("new IA markers present (Purchase Ops + Sourcing Tools)",
      html.includes("Purchase Ops") && html.includes("Sourcing Tools"),
      `found: ${foundMarkers.join(", ") || "none"}`);
    c.ok("collapse-to-rail seed on <html> (data-sidebar-collapsed)", collapseSeed);
  } else {
    // Production regression guard: pages must still 200; new markers are informational
    // until this PR merges + deploys.
    if (html.includes("Purchase Ops")) {
      c.ok("new IA live on prod (merged + deployed)", true);
    } else {
      c.info("new IA markers not on prod yet — pending merge/deploy (expected pre-merge)");
    }
  }

  c.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
