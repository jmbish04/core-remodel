#!/usr/bin/env node
/**
 * QC for PR #337 — 0042 P5: map quote line items to products.
 * Run: node scripts/qc/pr_337.mjs --preview   or bare (prod, regression)
 *
 * Two checks: (1) the pending-quotes line shape now carries the P5 mapping
 * fields (productId/brandId/productName/matchStatus); (2) a self-check of the
 * junk-line heuristic that decides which lines never mint a product.
 */
import { accessCookie, createChecks, createClient, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, finish } = createChecks();
const cookie = accessCookie();
console.log(`QC 0042 P5 product mapping against ${BASE}\n`);

// ── Heuristic self-check — MIRROR of NON_PRODUCT_LINE in map-invoice-products.ts.
// (Kept in sync by hand; the backend module can't be imported here through its
// @backend path aliases.) A product line must map; a charge line must not.
const NON_PRODUCT_LINE =
  /^(tax|sales\s*tax|delivery|shipping|freight|handling|labor|labour|installation|install|subtotal|sub-total|total|discount|deposit|credit|surcharge|fee|gratuity|tip)\b/i;
const SKIP = ["Tax", "Sales Tax 8.5%", "Delivery fee", "Freight", "Installation labor", "Subtotal", "Discount"];
const KEEP = ["Calacatta Viola slab", "Dornbracht Tara faucet", "Octo 4240 pendant", "24in vanity"];
check("junk lines are skipped", SKIP.every((s) => NON_PRODUCT_LINE.test(s)), SKIP.filter((s) => !NON_PRODUCT_LINE.test(s)).join(","));
check("product lines are kept", KEEP.every((s) => !NON_PRODUCT_LINE.test(s)), KEEP.filter((s) => NON_PRODUCT_LINE.test(s)).join(","));

try {
  const stores = await c.req("GET", "/api/showroom-stores", { headers: { cookie } });
  const list = stores.json?.stores ?? stores.json?.data ?? (Array.isArray(stores.json) ? stores.json : []);
  // Fall back to a known store id (shared prod D1) if the list shape surprises us.
  const storeId = list[0]?.id ?? 285;
  info(`probing pending-quotes for store ${storeId} (list returned ${list.length})`);

  const pq = await c.req("GET", `/api/showroom-stores/${storeId}/pending-quotes`, { headers: { cookie } });
  if (pq.status === 404) {
    console.log(`\n⚠️  /pending-quotes 404 on ${BASE} — endpoint pending merge/deploy.\n`);
    finish();
  }
  check(`GET /:id/pending-quotes 200 (store ${storeId})`, pq.status === 200, `status=${pq.status}`);
  const quotes = pq.json?.quotes;
  check("response is { quotes: [...] }", Array.isArray(quotes), typeof quotes);

  // Shape check: whenever any line exists, it must expose the P5 fields (even if null).
  const line = (quotes ?? []).flatMap((q) => q.lineItems ?? [])[0];
  if (line) {
    check(
      "line exposes P5 fields (productId/brandId/productName/matchStatus)",
      "productId" in line && "brandId" in line && "productName" in line && "matchStatus" in line,
      JSON.stringify(Object.keys(line)),
    );
    // A mapped line (created/matched) must carry a productId + name.
    const mapped = (quotes ?? []).flatMap((q) => q.lineItems ?? []).filter((l) => l.matchStatus === "created" || l.matchStatus === "matched");
    check(
      "mapped lines carry productId + productName",
      mapped.every((l) => typeof l.productId === "number" && !!l.productName),
      `mapped=${mapped.length}`,
    );
    info(`lines: ${(quotes ?? []).flatMap((q) => q.lineItems ?? []).length}, mapped: ${mapped.length}`);
  } else {
    info("no pending-quote lines to shape-check — empty is a healthy state.");
  }
} catch (err) {
  check("QC ran without throwing", false, String(err?.stack || err));
}

finish();
