#!/usr/bin/env node
/**
 * QC for Phase A′ — per-stack brand/product hints on intake buckets.
 * Run: node scripts/qc/pr_intake_hints.mjs --preview   (or bare for prod)
 *
 * Photo UPLOAD (Cloudflare Images) is out of scope for this change, so the
 * harness seeds two `product_showroom_photos` rows straight into D1, exercises
 * the bucket endpoints (POST / GET / PATCH) it actually changed over HTTP, and
 * removes the seeded rows + bucket via D1 afterward. Self-contained and
 * repeatable — leaves no residue in the table.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC intake-hints against ${BASE}\n`);

/** Run one SQL statement against remote D1, return result rows. */
function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

const TAG = "__qc_intake_hints__"; // marks our seeded rows for exact cleanup
let showroomId = null;
let bucketId = null;

try {
  showroomId = d1("SELECT id FROM showroom_stores LIMIT 1;")[0]?.id;
  check("have a showroom to test against", Number.isFinite(showroomId), `showroomId=${showroomId}`);
  if (!Number.isFinite(showroomId)) throw new Error("no showroom");

  // Seed two staged photos. rag_uuid is NOT NULL — give each a unique tagged id.
  d1(
    `INSERT INTO product_showroom_photos (rag_uuid, showroom_id, file_name, image_url, status) VALUES ` +
      `('${TAG}-r1', ${showroomId}, '${TAG}-1.png', 'https://example.com/${TAG}-1.png', 'uploaded'), ` +
      `('${TAG}-r2', ${showroomId}, '${TAG}-2.png', 'https://example.com/${TAG}-2.png', 'uploaded');`,
  );
  const seeded = d1(`SELECT id FROM product_showroom_photos WHERE file_name LIKE '${TAG}%';`).map((r) => r.id);
  check("seeded two QC photos", seeded.length === 2, `got ${seeded.length}`);

  // POST /buckets with hints (free-typed brand + URL → should be ready).
  const created = await c.post("/api/intake/buckets", {
    showroomId, kind: "multi", label: "QC hints stack", photoIds: seeded,
    brandNameRaw: "QC Test Brand", productName: "QC Faucet", modelNumber: "QC-123", sku: "QC-SKU", productUrl: "https://example.com/qc",
  });
  check("POST /buckets returns 200", created.status === 200, `status=${created.status} ${created.text?.slice(0, 160)}`);
  const b = created.json?.bucket;
  bucketId = b?.id;
  check("create echoes brandNameRaw", b?.brandNameRaw === "QC Test Brand", JSON.stringify(b));
  check(
    "create echoes productName/model/sku/url",
    b?.productName === "QC Faucet" && b?.modelNumber === "QC-123" && b?.sku === "QC-SKU" && b?.productUrl === "https://example.com/qc",
    JSON.stringify(b),
  );
  check("create → readyForWorkflow true (brand + url present)", b?.readyForWorkflow === true, `ready=${b?.readyForWorkflow}`);

  // GET /buckets round-trips the hints + flag.
  const listed = await c.get(`/api/intake/buckets?showroomId=${showroomId}`);
  const fromList = (listed.json?.buckets ?? []).find((x) => x.id === bucketId);
  check(
    "GET /buckets includes the hint fields + flag",
    fromList?.brandNameRaw === "QC Test Brand" && fromList?.readyForWorkflow === true,
    JSON.stringify(fromList),
  );

  // PATCH clears brand + url → readyForWorkflow flips false.
  const cleared = await c.req("PATCH", `/api/intake/buckets/${bucketId}`, { body: { brandNameRaw: "", productUrl: "" } });
  check("PATCH returns 200", cleared.status === 200, `status=${cleared.status}`);
  check("clearing brand + url flips readyForWorkflow false", cleared.json?.bucket?.readyForWorkflow === false, JSON.stringify(cleared.json?.bucket));

  // A product URL ALONE is enough → ready true again.
  const urlOnly = await c.req("PATCH", `/api/intake/buckets/${bucketId}`, { body: { productUrl: "https://example.com/qc2" } });
  check("product URL alone → readyForWorkflow true", urlOnly.json?.bucket?.readyForWorkflow === true, JSON.stringify(urlOnly.json?.bucket));

  // A matched brandId ALONE is enough → ready true (clear url, set a real brand).
  const brandRow = d1("SELECT id FROM brands WHERE is_active = 1 LIMIT 1;")[0];
  if (brandRow) {
    const brandOnly = await c.req("PATCH", `/api/intake/buckets/${bucketId}`, { body: { productUrl: "", brandId: brandRow.id } });
    check("brandId alone → readyForWorkflow true", brandOnly.json?.bucket?.readyForWorkflow === true, JSON.stringify(brandOnly.json?.bucket));
  }
} finally {
  // Cleanup: release + delete the bucket and seeded photos via D1.
  if (bucketId) {
    d1(`UPDATE product_showroom_photos SET bucket_id = NULL WHERE bucket_id = ${bucketId};`);
    d1(`DELETE FROM product_photo_buckets WHERE id = ${bucketId};`);
  }
  d1(`DELETE FROM product_showroom_photos WHERE file_name LIKE '${TAG}%';`);
  info(`cleaned up bucket ${bucketId ?? "(none)"} and seeded QC photos`);
}

process.exit(summary().failed === 0 ? 0 : 1);
