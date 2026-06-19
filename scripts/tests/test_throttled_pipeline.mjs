#!/usr/bin/env node
/**
 * Smoke test for the throttled two-phase photo pipeline.
 *
 * It reprocesses a few already-`processed` inspirational images through the
 * coordinator-backed `POST /api/images/mapping/reprocess` endpoint, then polls
 * `GET /api/images` and asserts the per-upload throttle holds:
 *   1. at most WAVE_SIZE (default 3) images are ever `processing` at once, and
 *   2. every reprocessed image returns to `processed`.
 *
 * Uses only the public HTTP API (no auth, no D1 access), so it can run from CI
 * or a laptop against any deployment.
 *
 * Usage:
 *   node scripts/tests/test_throttled_pipeline.mjs
 *   BASE_URL=https://core-remodel.hacolby.workers.dev COUNT=6 node scripts/tests/test_throttled_pipeline.mjs
 *
 * Env knobs: BASE_URL, COUNT, WAVE_SIZE, POLL_MS, TIMEOUT_MS.
 *
 * NOTE: this reprocesses REAL images (re-runs AI on already-good photos and
 * overwrites their AI metadata). Safe and idempotent-ish, but it does consume
 * Workers AI quota and briefly flips those rows to queued/processing.
 */

const BASE_URL = (
  process.env.BASE_URL || "https://core-remodel.hacolby.workers.dev"
).replace(/\/$/, "");
const COUNT = Number(process.env.COUNT || 6);
const WAVE_SIZE = Number(process.env.WAVE_SIZE || 3);
const POLL_MS = Number(process.env.POLL_MS || 3000);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 8 * 60 * 1000);
const PHOTO_CATEGORY = "inspirational";
const TERMINAL = new Set(["processed", "failed"]);

function log(...args) {
  console.log("[throttle-test]", ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function listInspirational() {
  const json = await getJson(
    `${BASE_URL}/api/images?photoCategory=${PHOTO_CATEGORY}`,
  );
  if (!json || !Array.isArray(json.images)) {
    throw new Error("Unexpected /api/images response shape (no images array)");
  }
  return json.images;
}

async function statusFor(ids) {
  const json = await getJson(
    `${BASE_URL}/api/images?photoCategory=${PHOTO_CATEGORY}&ids=${ids.join(",")}`,
  );
  const byId = new Map();
  for (const img of json.images || []) {
    byId.set(img.id, img.processingStatus);
  }
  return byId;
}

async function reprocess(ids) {
  const json = await getJson(`${BASE_URL}/api/images/mapping/reprocess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageIds: ids }),
  });
  if (!json || json.success !== true) {
    throw new Error(`reprocess did not succeed: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  log(`base=${BASE_URL} count=${COUNT} waveSize=${WAVE_SIZE}`);

  const all = await listInspirational();
  const candidates = all
    .filter((img) => img.processingStatus === "processed")
    .map((img) => img.id);
  if (candidates.length === 0) {
    throw new Error(
      "No 'processed' inspirational images available to reprocess. Upload some first.",
    );
  }
  const ids = candidates.slice(0, Math.min(COUNT, candidates.length));
  log(`reprocessing ${ids.length} image(s):`, ids.join(", "));

  await reprocess(ids);
  log(
    `queued; polling every ${POLL_MS}ms (timeout ${Math.round(TIMEOUT_MS / 1000)}s)`,
  );

  const start = Date.now();
  let maxConcurrent = 0;
  let sawProcessing = false;

  while (Date.now() - start < TIMEOUT_MS) {
    await sleep(POLL_MS);
    let byId;
    try {
      byId = await statusFor(ids);
    } catch (err) {
      log("poll error (continuing):", err.message);
      continue;
    }
    const states = ids.map((id) => byId.get(id) ?? "missing");
    const processing = states.filter((s) => s === "processing").length;
    const queued = states.filter((s) => s === "queued").length;
    const processed = states.filter((s) => s === "processed").length;
    const failed = states.filter((s) => s === "failed").length;
    maxConcurrent = Math.max(maxConcurrent, processing);
    if (processing > 0) sawProcessing = true;
    const t = Math.round((Date.now() - start) / 1000);
    log(
      `t+${t}s  processing=${processing} queued=${queued} processed=${processed} failed=${failed}`,
    );
    if (states.every((s) => TERMINAL.has(s))) break;
  }

  const finalById = await statusFor(ids);
  const finalStates = ids.map((id) => finalById.get(id) ?? "missing");
  const processedCount = finalStates.filter((s) => s === "processed").length;
  const failedCount = finalStates.filter((s) => s === "failed").length;

  log("-".repeat(56));
  log(`max concurrent 'processing' observed: ${maxConcurrent} (cap = ${WAVE_SIZE})`);
  log(`final: processed=${processedCount} failed=${failedCount} of ${ids.length}`);

  const problems = [];
  if (maxConcurrent > WAVE_SIZE) {
    problems.push(
      `THROTTLE VIOLATED: observed ${maxConcurrent} images processing at once (> ${WAVE_SIZE})`,
    );
  }
  if (!finalStates.every((s) => s === "processed")) {
    problems.push(
      `Not all images returned to 'processed' (failed=${failedCount}, states=[${finalStates.join(", ")}])`,
    );
  }
  if (!sawProcessing) {
    log(
      "WARN: never observed a 'processing' state — poll cadence may have missed the windows (not treated as failure if all reached 'processed').",
    );
  }

  if (problems.length > 0) {
    log("RESULT: FAIL");
    for (const p of problems) log("  -", p);
    process.exit(1);
  }
  log(
    `RESULT: PASS — throttle held (<=${WAVE_SIZE} concurrent) and all ${ids.length} image(s) reprocessed`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[throttle-test] ERROR:", err.message);
  process.exit(1);
});
