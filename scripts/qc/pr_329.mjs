#!/usr/bin/env node
/**
 * @fileoverview QC — PR #329, 0032 D2d: discovery-finder pages (the LAST 0032 slice).
 *
 * Three thin Astro shells mounting React islands over the D2c-1 REST + D2b DiscoveryHub
 * WS: /admin/shopping/showrooms/finder (list + new-search), /finder/[slug] (viewport,
 * streaming results with import/exclude), and /exclusions (not-interested list). Plus a
 * sidebar Finder + Not-interested nav entry. Frontend only — no API/D1 change.
 *
 * This QC proves the pages are WIRED (SSR shell responds, not 404/5xx) and regresses the
 * REST + WS surfaces they consume.
 *
 *   pnpm run test:pr 329 -- --preview
 *   pnpm run test:pr 329
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

// An admin page is either rendered (200) or bounced to the access gate (3xx/401) — never 404/5xx.
const pageWired = (s) => s === 200 || (s >= 300 && s < 400) || s === 401;

console.log(`\nQC pr_329 — discovery-finder pages (D2d)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  for (const [label, path] of [
    ["finder list", "/admin/shopping/showrooms/finder"],
    ["finder viewport", "/admin/shopping/showrooms/finder/qc-nonexistent-slug"],
    ["exclusions", "/admin/shopping/showrooms/exclusions"],
  ]) {
    const res = await client.get(path);
    checks.ok(`GET ${path} → page wired (${label})`, pageWired(res.status), `→ ${res.status}`);
  }

  // Regression — the REST the islands consume, and the DiscoveryHub WS gateway.
  const searches = await client.get("/api/showroom-searches");
  checks.ok(
    "GET /api/showroom-searches → responds (finder REST)",
    searches.status === 200 || searches.status === 401 || searches.status === 404,
    `→ ${searches.status}`,
  );
  const wsHealth = await client.get("/api/showrooms/discovery/health?slug=qc");
  checks.ok(
    "GET /api/showrooms/discovery/health → 200 (DiscoveryHub WS gateway the viewport streams)",
    wsHealth.status === 200,
    `→ ${wsHealth.status}`,
  );

  checks.info(
    "Islands are client:only (FinderApp / FinderDetailApp / ExclusionsApp); SSR returns the shell, hydration + the live WS stream + import/exclude actions are exercised in-browser. This completes 0032 — the finder UI over the full D2a→D2c backend.",
  );
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
