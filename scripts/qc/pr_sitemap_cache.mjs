#!/usr/bin/env node
/**
 * QC for Phase B — scraping_sitemap persistence + reuse.
 * Run: node scripts/qc/pr_sitemap_cache.mjs --preview   (or bare for prod)
 *
 * Uses example.com (no sitemap → fast homepage-fallback discovery) so the test
 * exercises the CACHE mechanics deterministically without depending on a real
 * brand site's sitemap contents: first discover persists a row (cached:false),
 * the second reuses it (cached:true), and GET lists it. Cleans up its row.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC sitemap-cache against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

const QC_URL = "https://example.com/__qc_sitemap__";
let brandId = null;

try {
  brandId = d1("SELECT id FROM brands WHERE is_active = 1 LIMIT 1;")[0]?.id;
  check("have a brand to test against", Number.isFinite(brandId), `brandId=${brandId}`);
  if (!Number.isFinite(brandId)) throw new Error("no brand");

  // Clean any residue from a prior aborted run so counts are exact.
  d1(`DELETE FROM scraping_sitemap WHERE website_url = '${QC_URL}';`);

  // 400 guards.
  const bad1 = await c.post("/api/intake/sitemaps/discover", { scrapeJobType: "brand", websiteUrl: QC_URL });
  check("discover without brandId → 400", bad1.status === 400, `status=${bad1.status}`);
  const bad2 = await c.post("/api/intake/sitemaps/discover", { scrapeJobType: "brand", brandId, websiteUrl: "" });
  check("discover without websiteUrl → 400", bad2.status === 400, `status=${bad2.status}`);

  // First discover — miss, persists a row.
  const first = await c.post("/api/intake/sitemaps/discover", { scrapeJobType: "brand", brandId, websiteUrl: QC_URL });
  check("first discover 200", first.status === 200, `status=${first.status} ${first.text?.slice(0, 160)}`);
  check("first discover cached:false", first.json?.cached === false, JSON.stringify(first.json));
  check("first discover returns pageUrls array", Array.isArray(first.json?.pageUrls), JSON.stringify(first.json));

  const afterFirst = d1(`SELECT COUNT(*) n FROM scraping_sitemap WHERE website_url = '${QC_URL}' AND brand_id = ${brandId};`)[0]?.n;
  check("row persisted after first discover", afterFirst === 1, `rows=${afterFirst}`);

  // Second discover — hit, reuses the row (no new insert).
  const second = await c.post("/api/intake/sitemaps/discover", { scrapeJobType: "brand", brandId, websiteUrl: QC_URL });
  check("second discover cached:true", second.json?.cached === true, JSON.stringify(second.json));
  const afterSecond = d1(`SELECT COUNT(*) n FROM scraping_sitemap WHERE website_url = '${QC_URL}' AND brand_id = ${brandId};`)[0]?.n;
  check("no duplicate row on cache hit", afterSecond === 1, `rows=${afterSecond}`);

  // GET lists it.
  const listed = await c.get(`/api/intake/sitemaps?scrapeJobType=brand&brandId=${brandId}`);
  check("GET /sitemaps 200", listed.status === 200, `status=${listed.status}`);
  const mine = (listed.json?.sitemaps ?? []).find((s) => s.websiteUrl === QC_URL);
  check("GET returns the cached row with parsed pageUrls", !!mine && Array.isArray(mine.pageUrls), JSON.stringify(mine));
} finally {
  if (Number.isFinite(brandId)) d1(`DELETE FROM scraping_sitemap WHERE website_url = '${QC_URL}';`);
  info(`cleaned up QC sitemap rows for ${QC_URL}`);
}

process.exit(summary().failed === 0 ? 0 : 1);
