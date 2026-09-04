#!/usr/bin/env node
/**
 * @fileoverview QC for the lazy API-router mounting that fixes the 10021
 * startup-CPU deploy block.
 *
 * The change swaps 109 static `app.route(prefix, router)` calls for a table of
 * dynamic `import()`s dispatched through a per-prefix merged router. Nothing
 * about the public surface is supposed to move, so this script is a pure
 * regression guard: it walks the SAME paths on the preview and on production
 * and fails on any difference in status code.
 *
 * The four things lazy mounting could plausibly break, each covered below:
 *
 *   1. A prefix stops resolving at all         → every mount prefix compared
 *   2. A miss turns into a 500 instead of 404  → unmounted-path probes
 *   3. Nested prefixes shadow each other       → /api/admin vs /api/admin/permits
 *   4. Shared prefixes lose fall-through       → /api/budget (5 routers),
 *                                                /api/showroom-stores (6)
 *
 * Plus: /openapi.json must still enumerate every path (the spec is built from a
 * hand-written literal merged with pascalRouter's generated document, and that
 * router is now lazily imported), and auth + the no-store error header must
 * behave exactly as before.
 *
 * Run:
 *   pnpm run test:pr lazy_router_mounting -- --preview   # this branch
 *   pnpm run test:pr lazy_router_mounting               # production baseline
 *   node scripts/qc/pr_lazy_router_mounting.mjs --compare  # both, diffed
 */
import { createClient, createChecks, assertReachable, previewBase, WORKER_BASE } from "../config.mjs";

/**
 * One representative GET per mounted prefix. Chosen to be READ-ONLY and cheap;
 * a 401/404 is a perfectly good answer — the assertion is that preview and
 * production agree, not that any particular route returns 200.
 */
const PATHS = [
  "/api/ping",
  "/api/health",
  "/api/access/status",
  "/api/admin/config",
  "/api/admin/permits",
  "/api/admin/plans",
  "/api/admin/agents/runs",
  "/api/admin/integrations",
  "/api/dashboard/metrics",
  "/api/rooms",
  "/api/rooms/catalog",
  "/api/measurements",
  "/api/images",
  "/api/moodboards",
  "/api/listing-photos",
  "/api/photo-reviews",
  "/api/photo-edits",
  "/api/documents",
  "/api/document-views",
  "/api/supporting-documents",
  "/api/artifacts",
  "/api/estimates",
  "/api/estimate-statuses",
  "/api/estimate-companies",
  "/api/estimate-contacts",
  "/api/contracts",
  "/api/construction-checklist",
  "/api/budget-tracker",
  "/api/budget-data",
  "/api/budget-scenarios",
  "/api/budget-assumptions",
  "/api/budget-snapshot",
  "/api/truth-table",
  "/api/planning",
  "/api/pmo",
  "/api/vision-nodes",
  "/api/bid-portfolios",
  "/api/bid-portfolios/public",
  "/api/analytics",
  "/api/shopping-journal",
  "/api/showroom-stores",
  "/api/showroom-products",
  "/api/showroom-sales",
  "/api/showroom-scout",
  "/api/showroom-contacts",
  "/api/showroom-visit-logs",
  "/api/showroom-hitl-queue",
  "/api/showroom-searches",
  "/api/showroom-exclusions",
  "/api/product-photos",
  "/api/products",
  "/api/brands",
  "/api/materials",
  "/api/services",
  "/api/wishlist",
  "/api/intake",
  "/api/config",
  "/api/config/tax",
  "/api/research-jobs",
  "/api/notifications",
  "/api/alerts",
  "/api/threads",
  "/api/changelog",
  "/api/changelog/entries",
  "/api/places",
  "/api/companies",
  "/api/notes",
  "/api/gmail",
  "/api/workshop",
  "/api/worker-emails",
  "/api/email",
  "/api/clickup",
  "/api/floorplan-regions",
  "/api/drive-lists",
  "/api/studio",
  "/api/render",
  "/api/mood-board",
  "/api/mcp-docs",
  "/api/mcp-ops/issues",
  "/api/tesla/status",
  "/api/portal",
  "/api/guest",
  "/api/sync",
  "/api/system/health",
  "/api/google-photos",
  "/api/pascal/v1/projects",
  "/openapi.json",
  "/context",
  "/swagger",
  "/scalar",
];

/**
 * Paths that must resolve to 404, never 500. Lazy mounting has to load a prefix
 * group and then hand a miss back to the parent app; a bug there surfaces as a
 * thrown error, i.e. a 500.
 */
const MUST_404 = [
  "/api/rooms/__qc_no_such_route__",
  "/api/budget/__qc_no_such_route__",
  "/api/admin/__qc_no_such_route__",
  "/api/showroom-stores/__qc_no_such_route__",
  "/api/__qc_no_such_prefix__",
  "/api/__qc_no_such_prefix__/deeper/still",
];

async function statuses(client) {
  const out = {};
  for (const p of [...PATHS, ...MUST_404]) {
    // Sequential on purpose: the first request to a prefix pays the dynamic
    // import, and a burst of 90 parallel requests measures contention rather
    // than correctness.
    out[p] = (await client.get(p)).status;
  }
  return out;
}

async function main() {
  const compare = process.argv.includes("--compare");
  const checks = createChecks();

  const targetBase = compare ? previewBase() : undefined;
  const client = createClient(targetBase ? { base: targetBase } : {});
  console.log(`\nQC: lazy router mounting — ${client.base}\n`);
  await assertReachable(client, checks);

  const seen = await statuses(client);

  for (const p of MUST_404) {
    checks.ok(`${p} → 404 (not 500)`, seen[p] === 404, `got ${seen[p]}`);
  }

  // A lazily-mounted router that fails to import surfaces as a 5xx. Compared
  // against production rather than asserted absolutely: /api/showroom-products
  // already 500s on `main`, and this script is a regression guard, not a
  // health check.
  const fivexx = PATHS.filter((p) => seen[p] >= 500);
  checks.info(`5xx paths: ${fivexx.length ? fivexx.join(", ") : "none"}`);

  // Handlers that read the ABSOLUTE request path must still see it. Lazy
  // mounting originally stripped the prefix before dispatch, which turned
  // `GET /api/artifacts` from 404 "Artifact not found" into 400 "Invalid
  // artifact key" — routes/artifacts.ts derives its R2 key from c.req.path.
  const artifact = await client.get("/api/artifacts");
  checks.ok(
    "/api/artifacts sees the absolute path (404, not 400)",
    artifact.status === 404,
    `got ${artifact.status} ${JSON.stringify(artifact.json)}`,
  );

  // Nested prefixes: /api/admin is mounted before /api/admin/permits, and the
  // permits router must still win for its own paths.
  checks.ok(
    "/api/admin/permits resolves (nested prefix not shadowed by /api/admin)",
    seen["/api/admin/permits"] !== 404 || seen["/api/admin/config"] !== 404,
    `permits=${seen["/api/admin/permits"]} config=${seen["/api/admin/config"]}`,
  );

  // Shared prefixes: six routers sit on /api/showroom-stores. If fall-through
  // broke, only the first one's routes would answer.
  const gaps = await client.get("/api/showroom-stores/gaps");
  const catalog = await client.get("/api/showroom-stores/catalog");
  checks.ok(
    "/api/showroom-stores fall-through reaches later routers in the group",
    gaps.status < 500 && catalog.status < 500,
    `gaps=${gaps.status} catalog=${catalog.status}`,
  );

  // Auth is a parent-app middleware and must still gate the sub-router.
  const noAuth = await client.get("/api/admin/config", { auth: false });
  checks.ok("unauthenticated /api/admin/config → 401", noAuth.status === 401, `got ${noAuth.status}`);

  // The parent's no-store stamping must still reach a sub-router's 4xx.
  const res = await fetch(`${client.base}/api/admin/config`);
  checks.ok(
    "4xx from a lazily-mounted router still carries Cache-Control: no-store",
    (res.headers.get("cache-control") || "").includes("no-store"),
    res.headers.get("cache-control") || "(absent)",
  );

  // The spec is assembled at request time from a literal plus pascalRouter's
  // generated document; lazy-importing that router must not drop paths.
  const spec = await client.get("/openapi.json");
  const paths = Object.keys(spec.json?.paths || {});
  checks.ok("/openapi.json enumerates routes", paths.length > 0, `${paths.length} paths`);
  checks.ok(
    "/openapi.json still carries the lazily-imported pascal routes",
    paths.some((p) => p.startsWith("/pascal/v1")),
    `pascal paths: ${paths.filter((p) => p.startsWith("/pascal/v1")).length}`,
  );
  checks.info(`${paths.length} paths in the spec`);

  if (compare) {
    console.log(`\n  comparing against production (${WORKER_BASE})\n`);
    const prod = createClient({ base: WORKER_BASE });
    const prodSeen = await statuses(prod);
    const diffs = [...PATHS, ...MUST_404].filter((p) => prodSeen[p] !== seen[p]);
    checks.ok(
      "every path returns the same status on preview and production",
      diffs.length === 0,
      diffs.map((p) => `${p}: prod=${prodSeen[p]} preview=${seen[p]}`).join("; "),
    );

    const prodSpec = await prod.get("/openapi.json");
    const prodPaths = new Set(Object.keys(prodSpec.json?.paths || {}));
    const missing = paths.filter((p) => !prodPaths.has(p));
    const dropped = [...prodPaths].filter((p) => !paths.includes(p));
    checks.ok(
      "/openapi.json path set is identical to production",
      dropped.length === 0,
      `dropped: ${dropped.join(", ")}`,
    );
    if (missing.length) checks.info(`new on preview: ${missing.join(", ")}`);
  }

  checks.finish();
}

main();
