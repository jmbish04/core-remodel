#!/usr/bin/env node
/**
 * QC for Phase C1 — bucket candidate table + intake workflow.
 * Run: node scripts/qc/pr_bucket_candidates.mjs --preview   (or bare for prod)
 *
 * Seeds one bucket (with strong brand/product hints) over a REAL image URL
 * already stored in D1 — so `describeImage` has something fetchable — kicks
 * `POST /buckets/:id/intake`, polls the research job to completion, then
 * asserts `GET /buckets/:id/candidates` returns ≥1 ranked candidate carrying a
 * raw extraction. Cleans up the bucket (candidates cascade) + seeded photo.
 *
 * Hints make the AI candidate pass deterministic enough for CI: the extraction
 * prompt is told to trust supplied hints, so a real product photo + a brand
 * hint yields at least one candidate regardless of vision noise.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC bucket-candidates against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = "__qc_bucket_cand__";
let showroomId = null;
let bucketId = null;

try {
  showroomId = d1("SELECT id FROM showroom_stores LIMIT 1;")[0]?.id;
  check("have a showroom", Number.isFinite(showroomId), `showroomId=${showroomId}`);

  // A real, fetchable product image already in D1 — the vision model needs bytes.
  const realImg = d1(
    "SELECT image_url FROM product_showroom_photos WHERE image_url LIKE 'http%' LIMIT 1;",
  )[0]?.image_url;
  check("found a real image URL to seed", !!realImg, realImg ?? "(none)");
  if (!realImg || !Number.isFinite(showroomId)) throw new Error("missing prerequisites");

  d1(
    `INSERT INTO product_showroom_photos (rag_uuid, showroom_id, file_name, image_url, status) VALUES ` +
      `('${TAG}-r1', ${showroomId}, '${TAG}-1.png', '${realImg}', 'uploaded');`,
  );
  const seeded = d1(`SELECT id FROM product_showroom_photos WHERE file_name LIKE '${TAG}%';`).map((r) => r.id);
  check("seeded one QC photo", seeded.length === 1, `got ${seeded.length}`);

  // Bucket with strong hints so at least one candidate is guaranteed.
  const created = await c.post("/api/intake/buckets", {
    showroomId, kind: "single", label: "QC candidate stack", photoIds: seeded,
    brandNameRaw: "Kohler", productName: "Purist Faucet", modelNumber: "K-7505",
  });
  check("POST /buckets 200", created.status === 200, `status=${created.status} ${created.text?.slice(0, 160)}`);
  bucketId = created.json?.bucket?.id;
  check("got bucketId", Number.isFinite(bucketId), `bucketId=${bucketId}`);

  // Kick the workflow.
  const kicked = await c.post(`/api/intake/buckets/${bucketId}/intake`, {});
  check("POST /buckets/:id/intake 200", kicked.status === 200, `status=${kicked.status} ${kicked.text?.slice(0, 200)}`);
  const jobId = kicked.json?.researchJobId;
  check("intake returned a researchJobId", Number.isFinite(jobId), `jobId=${jobId}`);

  // The candidates endpoint is always shaped correctly (empty list pre-run).
  const empty = await c.get(`/api/intake/buckets/${bucketId}/candidates`);
  check("GET candidates 200 + array shape", empty.status === 200 && Array.isArray(empty.json?.candidates), `status=${empty.status}`);

  // Poll the research job to a terminal state (≤120s).
  let status = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const jr = await c.get(`/api/research-jobs/${jobId}`);
    status = jr.json?.job?.status;
    if (status === "complete" || status === "failed") break;
    if (i % 5 === 0) info(`job ${jobId} status=${status} (${i * 2}s)`);
  }
  check("workflow completed (not failed/timeout)", status === "complete", `final status=${status}`);

  const cand = await c.get(`/api/intake/buckets/${bucketId}/candidates`);
  const list = cand.json?.candidates ?? [];
  check("≥1 candidate produced", list.length >= 1, `count=${list.length}`);
  if (list.length) {
    const top = list.find((x) => x.rank === 0) ?? list[0];
    check("top candidate has rank 0", top.rank === 0, `rank=${top.rank}`);
    check("top candidate carries a raw extraction", top.rawExtraction != null, JSON.stringify(top).slice(0, 200));
    check("top candidate status is pending", top.status === "pending", `status=${top.status}`);
  }

  const bstatus = d1(`SELECT status FROM product_photo_buckets WHERE id = ${bucketId};`)[0]?.status;
  check("bucket status = processed", bstatus === "processed", `status=${bstatus}`);
} finally {
  if (bucketId) {
    d1(`UPDATE product_showroom_photos SET bucket_id = NULL WHERE bucket_id = ${bucketId};`);
    d1(`DELETE FROM bucket_product_candidates WHERE bucket_id = ${bucketId};`);
    d1(`DELETE FROM product_photo_buckets WHERE id = ${bucketId};`);
  }
  d1(`DELETE FROM product_showroom_photos WHERE file_name LIKE '${TAG}%';`);
  info(`cleaned up bucket ${bucketId ?? "(none)"} + seeded QC photo`);
}

process.exit(summary().failed === 0 ? 0 : 1);
