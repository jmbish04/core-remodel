#!/usr/bin/env node
/**
 * STEP 2 of 2 — apply a reviewed plan from `scripts/showroom-audit.mjs`.
 *
 *   node scripts/showroom-backfill.mjs                          # DRY RUN, all sections
 *   node scripts/showroom-backfill.mjs --only categories        # one section
 *   node scripts/showroom-backfill.mjs --only categories --apply
 *   node scripts/showroom-backfill.mjs --only brandLogos --apply --batch 50
 *
 * Sections: categories | addresses | storeLogos | brandLogos | scrapeKicks
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without `--apply`.
 *
 * COST, in ascending order — run them in this order, checking results between:
 *   categories   free (D1 writes only)
 *   addresses    free (D1 writes only; applies ONLY explicitly proposed values)
 *   storeLogos   cheap (one favicon fetch + CF Images upload each)
 *   brandLogos   cheap but BULKY (~280 favicon fetches)
 *   scrapeKicks  EXPENSIVE — each is a full Browser Run crawl against a
 *                10 req/s, 120-concurrent-browser account-wide ceiling shared
 *                with brand/product research. Defaults to a batch of 5.
 *
 * Auth: the API uses the `remodel_access` cookie = sha256(WORKER_API_KEY).
 * Supply the key via WORKER_API_KEY env var, or it is read from the tokens CLI.
 * The key itself is never printed.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d = null) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

const PLAN_PATH = flag("--plan", "showroom-backfill-plan.json");
const APPLY = args.includes("--apply");
const ONLY = flag("--only");
const BASE = flag("--base", "https://core-remodel.hacolby.workers.dev");

const ALL_SECTIONS = ["categories", "addresses", "storeLogos", "brandLogos", "scrapeKicks"];
/** Per-request batch sizes. scrapeKicks is small on purpose — it spends money. */
const DEFAULT_BATCH = { categories: 40, addresses: 40, storeLogos: 20, brandLogos: 40, scrapeKicks: 5 };
const BATCH_OVERRIDE = flag("--batch") ? parseInt(flag("--batch"), 10) : null;

const sections = ONLY ? ONLY.split(",").map((s) => s.trim()) : ALL_SECTIONS;
for (const s of sections) {
  if (!ALL_SECTIONS.includes(s)) {
    console.error(`unknown section "${s}" — valid: ${ALL_SECTIONS.join(", ")}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Auth — hash in-process; never print or log the key
// ---------------------------------------------------------------------------

function accessCookie() {
  let key = process.env.WORKER_API_KEY;
  if (!key) {
    try {
      key = execFileSync("tokens", ["show", "WORKER_API_KEY", "--value-only"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      console.error("No WORKER_API_KEY. Set the env var or install the tokens CLI.");
      process.exit(1);
    }
  }
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const planFile = path.isAbsolute(PLAN_PATH) ? PLAN_PATH : path.join(ROOT, PLAN_PATH);
if (!fs.existsSync(planFile)) {
  console.error(`plan not found: ${planFile}\nRun: node scripts/showroom-audit.mjs`);
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));

console.log(`\nplan     ${path.relative(ROOT, planFile)}  (generated ${plan.generatedAt})`);
console.log(`target   ${BASE}`);
console.log(`mode     ${APPLY ? "APPLY — WILL WRITE" : "DRY RUN"}`);
console.log(`sections ${sections.join(", ")}\n`);

const cookie = accessCookie();

/** Shape each plan section into the endpoint's payload. */
function payloadFor(section, items) {
  switch (section) {
    case "categories":
      return items.map((r) => ({
        storeId: r.storeId,
        categoryIds: r.categoryIds,
        rationale: r.rationale,
      }));
    case "addresses":
      // Only rows the audit could actually propose a value for. A null proposal
      // means "a human must supply this" — never fabricate an address.
      return items.filter((r) => r.proposed).map((r) => ({ storeId: r.storeId, proposed: r.proposed }));
    case "storeLogos":
      return items.map((r) => ({ storeId: r.storeId, websiteUrl: r.websiteUrl }));
    case "brandLogos":
      return items.map((r) => ({ brandId: r.brandId, websiteUrl: r.websiteUrl }));
    case "scrapeKicks":
      return items.map((r) => ({ storeId: r.storeId, websiteUrl: r.websiteUrl }));
    default:
      return [];
  }
}

const totals = {};

for (const section of sections) {
  const items = payloadFor(section, plan[section] ?? []);
  if (items.length === 0) {
    console.log(`${section.padEnd(12)} nothing to do`);
    continue;
  }
  const batch = BATCH_OVERRIDE ?? DEFAULT_BATCH[section];
  const agg = {};

  for (let i = 0; i < items.length; i += batch) {
    const slice = items.slice(i, i + batch);
    const body = { apply: APPLY, [section]: slice };
    const res = await fetch(`${BASE}/api/showroom-stores/backfill/apply-plan`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `remodel_access=${cookie}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`  ${section}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
      process.exitCode = 1;
      break;
    }
    const json = await res.json();
    const r = json[section] ?? {};
    for (const [k, v] of Object.entries(r)) agg[k] = (agg[k] ?? 0) + v;
    const done = Math.min(i + batch, items.length);
    process.stdout.write(`\r${section.padEnd(12)} ${done}/${items.length}   `);
  }
  totals[section] = agg;
  console.log(`\r${section.padEnd(12)} ${items.length}/${items.length}  ${JSON.stringify(agg)}`);
}

console.log("");
if (!APPLY) {
  console.log("DRY RUN — nothing was written. Re-run with --apply to commit.\n");
} else {
  console.log("Applied. Re-run scripts/showroom-audit.mjs to confirm the gaps closed.\n");
}
