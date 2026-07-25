#!/usr/bin/env node
/**
 * QC for Phase E — HITL candidate-queue endpoint + page load.
 * Run: node scripts/qc/pr_hitl_queue.mjs --preview   (or bare for prod)
 *
 * The reaction/confirm/reject/voice endpoints the UI calls are covered by the
 * D1/D2 QCs; this covers the new candidate-queue aggregation + that the page
 * shell renders. Seeds a bucket + 2 candidates, asserts the queue lists it with
 * the right counts, and that the page returns 200. Cleans up.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC hitl-queue against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

let bucketId = null;
try {
  const showroomId = d1("SELECT id FROM showroom_stores LIMIT 1;")[0]?.id;
  d1(`INSERT INTO product_photo_buckets (showroom_id, kind, status, label) VALUES (${showroomId}, 'single', 'processed', 'QC E bucket');`);
  bucketId = d1(`SELECT id FROM product_photo_buckets WHERE label = 'QC E bucket' ORDER BY id DESC LIMIT 1;`)[0]?.id;
  d1(
    `INSERT INTO bucket_product_candidates (bucket_id, rank, brand_name_raw, product_name, status) VALUES ` +
      `(${bucketId}, 0, 'Kohler', 'QC E Product A', 'pending'), (${bucketId}, 1, 'Kohler', 'QC E Product B', 'confirmed');`,
  );
  check("seeded bucket + candidates", Number.isFinite(bucketId), `bucketId=${bucketId}`);

  const queue = await c.get("/api/intake/candidate-queue");
  check("candidate-queue 200", queue.status === 200, `status=${queue.status}`);
  const mine = (queue.json?.buckets ?? []).find((b) => b.bucketId === bucketId);
  check("queue lists the seeded bucket", !!mine, JSON.stringify(mine));
  check("queue counts correct (2 total, 1 pending, 1 confirmed)", mine?.total === 2 && mine?.pending === 1 && mine?.confirmed === 1, JSON.stringify(mine));
  check("queue includes showroom name", "showroomName" in (mine ?? {}), JSON.stringify(mine));

  const page = await c.get("/admin/shopping/product-photo-hitl");
  check("HITL page returns 200", page.status === 200, `status=${page.status}`);
} finally {
  if (Number.isFinite(bucketId)) {
    d1(`DELETE FROM bucket_product_candidates WHERE bucket_id = ${bucketId};`);
    d1(`DELETE FROM product_photo_buckets WHERE id = ${bucketId};`);
  }
  info(`cleaned up bucket ${bucketId ?? "(none)"}`);
}

process.exit(summary().failed === 0 ? 0 : 1);
