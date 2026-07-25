#!/usr/bin/env node
/**
 * QC for Phase D1 — candidate reactions + confirm/reject.
 * Run: node scripts/qc/pr_candidate_reaction.mjs --preview   (or bare for prod)
 *
 * Seeds a bucket + two candidate rows directly in D1 (fast, deterministic — no
 * workflow), then exercises PATCH reaction, POST reject, POST confirm (which
 * mints a real brand + product), and the already-confirmed 409. Cleans up the
 * product/brand/mappings it created plus the seeded rows.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC candidate-reaction against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

const BRAND = "__QC_D1_Brand__";
const PRODUCT = "__QC_D1_Product__";
let bucketId = null;
let productId = null;

try {
  const showroomId = d1("SELECT id FROM showroom_stores LIMIT 1;")[0]?.id;
  check("have a showroom", Number.isFinite(showroomId), `showroom=${showroomId}`);

  d1(`INSERT INTO product_photo_buckets (showroom_id, kind, status, label) VALUES (${showroomId}, 'single', 'processed', 'QC D1 bucket');`);
  bucketId = d1(`SELECT id FROM product_photo_buckets WHERE label = 'QC D1 bucket' ORDER BY id DESC LIMIT 1;`)[0]?.id;
  check("seeded bucket", Number.isFinite(bucketId), `bucketId=${bucketId}`);

  // Two candidates: rank 0 (to confirm), rank 1 (to reject).
  d1(
    `INSERT INTO bucket_product_candidates (bucket_id, rank, brand_name_raw, product_name, model_number, status) VALUES ` +
      `(${bucketId}, 0, '${BRAND}', '${PRODUCT}', 'QCD1-1', 'pending'), ` +
      `(${bucketId}, 1, '${BRAND}', '${PRODUCT} Two', 'QCD1-2', 'pending');`,
  );
  const cands = d1(`SELECT id, rank FROM bucket_product_candidates WHERE bucket_id = ${bucketId} ORDER BY rank;`);
  check("seeded two candidates", cands.length === 2, `count=${cands.length}`);
  const c0 = cands.find((x) => x.rank === 0).id;
  const c1 = cands.find((x) => x.rank === 1).id;

  // Reaction.
  const react = await c.req("PATCH", `/api/intake/candidates/${c0}/reaction`, { body: { isMatch: true, liked: true, stars: 5 } });
  check("PATCH reaction 200", react.status === 200, `status=${react.status} ${react.text?.slice(0, 140)}`);
  const rc = react.json?.candidate;
  check("reaction persisted (match/like/stars)", rc?.isMatch === true && rc?.liked === true && rc?.stars === 5, JSON.stringify(rc));

  const badStars = await c.req("PATCH", `/api/intake/candidates/${c0}/reaction`, { body: { stars: 9 } });
  check("stars out of range → 400", badStars.status === 400, `status=${badStars.status}`);

  // Reject c1 — kept, not deleted.
  const rej = await c.post(`/api/intake/candidates/${c1}/reject`, {});
  check("reject 200 + status rejected", rej.status === 200 && rej.json?.candidate?.status === "rejected", JSON.stringify(rej.json?.candidate));
  const c1Still = d1(`SELECT status FROM bucket_product_candidates WHERE id = ${c1};`)[0];
  check("rejected candidate kept (not deleted)", c1Still?.status === "rejected", JSON.stringify(c1Still));

  // Confirm c0 — mints brand + product.
  const conf = await c.post(`/api/intake/candidates/${c0}/confirm`, {});
  check("confirm 200", conf.status === 200, `status=${conf.status} ${conf.text?.slice(0, 160)}`);
  productId = conf.json?.productId;
  check("confirm returns a productId", Number.isFinite(productId), `productId=${productId}`);
  check("candidate now confirmed + linked", conf.json?.candidate?.status === "confirmed" && conf.json?.candidate?.confirmedProductId === productId, JSON.stringify(conf.json?.candidate));

  const prodRow = d1(`SELECT item_name FROM products WHERE id = ${productId};`)[0];
  check("real product row created", prodRow?.item_name === PRODUCT, JSON.stringify(prodRow));
  const mapRow = d1(`SELECT COUNT(*) n FROM showroom_product_mappings WHERE product_id = ${productId} AND showroom_id = ${showroomId};`)[0]?.n;
  check("product mapped to showroom", mapRow === 1, `mappings=${mapRow}`);
  const bkt = d1(`SELECT product_id, status FROM product_photo_buckets WHERE id = ${bucketId};`)[0];
  check("bucket linked + reviewed", bkt?.product_id === productId && bkt?.status === "reviewed", JSON.stringify(bkt));

  // Idempotency guard.
  const conf2 = await c.post(`/api/intake/candidates/${c0}/confirm`, {});
  check("second confirm → 409", conf2.status === 409, `status=${conf2.status}`);
} finally {
  if (Number.isFinite(productId)) {
    d1(`DELETE FROM showroom_product_mappings WHERE product_id = ${productId};`);
    d1(`DELETE FROM products WHERE id = ${productId};`);
  }
  d1(`DELETE FROM brands WHERE name = '${BRAND}';`);
  if (Number.isFinite(bucketId)) {
    d1(`DELETE FROM bucket_product_candidates WHERE bucket_id = ${bucketId};`);
    d1(`DELETE FROM product_photo_buckets WHERE id = ${bucketId};`);
  }
  info(`cleaned up product ${productId ?? "(none)"}, brand ${BRAND}, bucket ${bucketId ?? "(none)"}`);
}

process.exit(summary().failed === 0 ? 0 : 1);
