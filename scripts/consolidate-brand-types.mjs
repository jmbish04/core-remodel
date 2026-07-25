#!/usr/bin/env node
/**
 * @fileoverview Trigger the brand-type taxonomy consolidation (0025 P4 pt.1).
 *
 * Calls `POST /api/brands/types/consolidate`, which merges duplicate/synonym
 * brand types (Cabinets→Cabinetry, Textiles→Fabrics, …), flags the primary type
 * on single-type brands, and backfills each type's description + AI rationale.
 * Idempotent — safe to re-run.
 *
 * AUTH. Gated `/api/*` routes accept exactly one credential: the `remodel_access`
 * cookie, whose value is the **lowercase hex SHA-256 of WORKER_API_KEY**. The
 * worker TRIMS the key before hashing (see src/backend/utils/access.ts →
 * getAccessCookieHash), so we trim here too or the digest won't match. There is
 * no raw-bearer path — sending the key itself will 401.
 *
 * The key is read from the local `tokens` CLI (override with $WORKER_API_KEY).
 *
 * Usage:
 *   node scripts/consolidate-brand-types.mjs                 # against production
 *   node scripts/consolidate-brand-types.mjs --base http://localhost:8787
 *   WORKER_API_KEY=... node scripts/consolidate-brand-types.mjs   # skip the CLI
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const DEFAULT_BASE = "https://core-remodel.hacolby.workers.dev";

/** Resolve the base URL: --base <url> → $BASE_URL → production. */
function resolveBase() {
  const i = process.argv.indexOf("--base");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.BASE_URL || DEFAULT_BASE;
}

/** Read WORKER_API_KEY from $WORKER_API_KEY or the local `tokens` CLI. */
function resolveWorkerApiKey() {
  if (process.env.WORKER_API_KEY?.trim()) return process.env.WORKER_API_KEY.trim();
  try {
    const out = execFileSync("tokens", ["show", "WORKER_API_KEY", "--value-only"], {
      encoding: "utf8",
    });
    return out.trim();
  } catch (err) {
    console.error(
      "Could not read WORKER_API_KEY.\n" +
        "  • Ensure the `tokens` CLI is installed and `tokens show WORKER_API_KEY --value-only` works, or\n" +
        "  • pass it inline:  WORKER_API_KEY=... node scripts/consolidate-brand-types.mjs\n",
    );
    console.error(String(err?.stderr || err?.message || err));
    process.exit(1);
  }
}

/** The access-cookie value the worker expects: lowercase hex SHA-256 of the key. */
function accessCookieValue(workerApiKey) {
  return createHash("sha256").update(workerApiKey).digest("hex");
}

async function main() {
  const base = resolveBase().replace(/\/$/, "");
  const key = resolveWorkerApiKey();
  if (!key) {
    console.error("WORKER_API_KEY resolved empty — aborting.");
    process.exit(1);
  }
  const cookie = `remodel_access=${accessCookieValue(key)}`;
  const url = `${base}/api/brands/types/consolidate`;

  console.log(`POST ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!res.ok) {
    console.error(`\n✗ HTTP ${res.status}`);
    console.error(typeof body === "string" ? body : JSON.stringify(body, null, 2));
    if (res.status === 401) {
      console.error(
        "\n401 Unauthorized — the SHA-256(WORKER_API_KEY) cookie didn't match.\n" +
          "Confirm you're pulling the SAME key the worker uses (remote secrets store),\n" +
          "and that it isn't wrapped in quotes/whitespace.",
      );
    }
    process.exit(1);
  }

  // Success — pretty-print the consolidation report.
  const report = body?.report ?? body;
  console.log("\n✓ Consolidation complete\n");
  if (report && typeof report === "object") {
    console.log(`  types: ${report.typesBefore} → ${report.typesAfter}`);
    console.log(`  primaries set: ${report.primariesSet}`);
    console.log(`  descriptions written: ${report.described}`);
    if (Array.isArray(report.merges) && report.merges.length > 0) {
      console.log("  merges:");
      for (const m of report.merges) {
        console.log(
          `    ${m.absorbed} → ${m.survivor}  (remapped ${m.remapped}, dropped ${m.collisionsDropped})`,
        );
      }
    }
  }
  console.log("\n" + JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
