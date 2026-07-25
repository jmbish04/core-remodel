#!/usr/bin/env node
/**
 * QC for Phase C2 — candidate asset enrichment (staged image/PDF source URLs).
 * Run: node scripts/qc/pr_candidate_enrich.mjs --preview   (or bare for prod)
 *
 * Seeds a bucket whose hint productUrl points at a stable, image-rich public
 * page (a Wikipedia article). The intake workflow's enrich step scrapes that
 * page for <img> source URLs and stages them on the top candidate WITHOUT
 * downloading. Asserts the top candidate comes back with a non-empty
 * imageSourceUrls array. Cleans up the bucket (candidates cascade) + photo.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC candidate-enrich against ${BASE}\n`);

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
const TAG = "__qc_enrich__";
const ASSET_PAGE = "https://en.wikipedia.org/wiki/Faucet"; // stable, image-rich
let bucketId = null;

try {
  const showroomId = d1("SELECT id FROM showroom_stores LIMIT 1;")[0]?.id;
  const realImg =
    d1("SELECT image_url FROM product_showroom_photos WHERE image_url LIKE 'http%' LIMIT 1;")[0]?.image_url ??
    d1("SELECT COALESCE(delivery_url, source_url) u FROM showroom_images WHERE COALESCE(delivery_url, source_url) LIKE 'http%' LIMIT 1;")[0]?.u;
  check("have showroom + a real image", Number.isFinite(showroomId) && !!realImg, `showroom=${showroomId}`);
  if (!Number.isFinite(showroomId) || !realImg) throw new Error("prereqs");

  d1(
    `INSERT INTO product_showroom_photos (rag_uuid, showroom_id, file_name, image_url, status) VALUES ` +
      `('${TAG}-r1', ${showroomId}, '${TAG}-1.png', '${realImg}', 'uploaded');`,
  );
  const pid = d1(`SELECT id FROM product_showroom_photos WHERE file_name = '${TAG}-1.png';`)[0]?.id;

  // Bucket with a productUrl hint → the enrich step scrapes it for assets.
  const created = await c.post("/api/intake/buckets", {
    showroomId, kind: "single", label: "QC enrich stack", photoIds: [pid],
    brandNameRaw: "Kohler", productName: "Purist Faucet", productUrl: ASSET_PAGE,
  });
  bucketId = created.json?.bucket?.id;
  check("bucket created with productUrl hint", Number.isFinite(bucketId), `bucketId=${bucketId}`);

  const kicked = await c.post(`/api/intake/buckets/${bucketId}/intake`, {});
  const jobId = kicked.json?.researchJobId;
  check("intake kicked", kicked.status === 200 && Number.isFinite(jobId), `status=${kicked.status}`);

  let status = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    status = (await c.get(`/api/research-jobs/${jobId}`)).json?.job?.status;
    if (status === "complete" || status === "failed") break;
    if (i % 5 === 0) info(`job ${jobId} status=${status} (${i * 2}s)`);
  }
  check("workflow completed", status === "complete", `final=${status}`);

  const list = (await c.get(`/api/intake/buckets/${bucketId}/candidates`)).json?.candidates ?? [];
  check("≥1 candidate produced", list.length >= 1, `count=${list.length}`);
  const top = list.find((x) => x.rank === 0) ?? list[0];
  check(
    "top candidate has staged imageSourceUrls (parsed array, non-empty)",
    Array.isArray(top?.imageSourceUrls) && top.imageSourceUrls.length > 0,
    `imageSourceUrls=${JSON.stringify(top?.imageSourceUrls)?.slice(0, 160)}`,
  );
  check(
    "staged URLs are http source links (not downloaded)",
    (top?.imageSourceUrls ?? []).every((u) => typeof u === "string" && u.startsWith("http")),
    JSON.stringify(top?.imageSourceUrls)?.slice(0, 160),
  );
  check("productUrl recorded on candidate", !!top?.productUrl, `productUrl=${top?.productUrl}`);
} finally {
  if (bucketId) {
    d1(`UPDATE product_showroom_photos SET bucket_id = NULL WHERE bucket_id = ${bucketId};`);
    d1(`DELETE FROM bucket_product_candidates WHERE bucket_id = ${bucketId};`);
    d1(`DELETE FROM product_photo_buckets WHERE id = ${bucketId};`);
  }
  d1(`DELETE FROM product_showroom_photos WHERE file_name LIKE '${TAG}%';`);
  info(`cleaned up bucket ${bucketId ?? "(none)"} + QC photo`);
}

process.exit(summary().failed === 0 ? 0 : 1);
