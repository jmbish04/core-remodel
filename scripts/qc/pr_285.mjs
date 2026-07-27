#!/usr/bin/env node
/**
 * QC — PR #285 (auth: accept raw WORKER_API_KEY as a Bearer/header token).
 *
 * Proves an admin-gated API authenticates with the RAW key (how codra/QC hold
 * it), via three credential forms, plus a no-auth negative:
 *   - Authorization: Bearer <key>   → 200 on preview (fix), 401 on prod (pending)
 *   - x-worker-api-key: <key>       → same
 *   - remodel_access cookie (hash)  → 200 both (browser regression guard)
 *   - no credential                 → 401 both (still gated)
 *
 *   pnpm run test:pr 285 -- --preview   # branch preview (fix present)
 *   pnpm run test:pr 285                # production (regression guard)
 */
import { accessCookie, assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";
import { getToken } from "../tokens.mjs";

const isPreview = process.argv.includes("--preview");
const base = resolveBase();
const client = createClient({ base });
const c = createChecks();

// An admin-gated GET that exists on both targets (regression-safe).
const GATED = "/api/admin/plans/shopping-sourcing-refactor";

async function status(headers) {
  const res = await fetch(`${base}${GATED}`, { headers });
  return res.status;
}

async function main() {
  console.log(`\nQC pr_285 — base: ${base}${isPreview ? " (preview)" : " (production)"}\n`);
  await assertReachable(client, c);

  const key = getToken("WORKER_API_KEY").trim();
  c.ok("WORKER_API_KEY resolved locally", key.length > 0);

  const bearer = await status({ authorization: `Bearer ${key}` });
  const headerKey = await status({ "x-worker-api-key": key });
  const noAuth = await status({});
  const cookie = await status({ cookie: accessCookie() });

  // Negatives / regression hold on BOTH targets.
  c.ok("no-credential request is rejected (401)", noAuth === 401, `got ${noAuth}`);
  c.ok("cookie (hash) path still authenticates (200)", cookie === 200, `got ${cookie}`);

  if (isPreview) {
    c.ok("Authorization: Bearer <key> authenticates (200)", bearer === 200, `got ${bearer}`);
    c.ok("x-worker-api-key header authenticates (200)", headerKey === 200, `got ${headerKey}`);
  } else if (bearer === 200 && headerKey === 200) {
    c.ok("raw-key header auth live on prod (merged + deployed)", true);
  } else {
    c.info(`raw-key header auth not on prod yet — Bearer=${bearer}, header=${headerKey} (expected 401 pre-merge)`);
  }

  c.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
