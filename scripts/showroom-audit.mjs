#!/usr/bin/env node
/**
 * STEP 1 of 2 — audit prod showroom data and write a reviewable backfill plan.
 *
 *   node scripts/showroom-audit.mjs                 # -> showroom-backfill-plan.json
 *   node scripts/showroom-audit.mjs --out other.json
 *   node scripts/showroom-audit.mjs --local         # local D1 instead of --remote
 *
 * Then REVIEW/EDIT the JSON, and apply it with:
 *   node scripts/showroom-backfill.mjs --plan showroom-backfill-plan.json        # dry run
 *   node scripts/showroom-backfill.mjs --plan showroom-backfill-plan.json --apply
 *
 * NO GOOGLE PLACES. Every proposed value is derived from data already in D1:
 * the store name, description, mapped brand names, and scraped page text. The
 * one network call is the brand-logo favicon fetch, and that only happens in the
 * apply step.
 *
 * NOTHING IS INVENTED. Where the data cannot support a fill (e.g. a store whose
 * address is "Bay Area, CA" with no website and no scrape), the store is listed
 * under `needsManual` with the reason. It is never given a guessed address.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inferCategoryLabelsFromTokens } from "../src/backend/utils/showroom-category-rules.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "showroom-backfill-plan.json";
const REMOTE = !args.includes("--local");

// ---------------------------------------------------------------------------
// D1 access
// ---------------------------------------------------------------------------

/**
 * Run one SQL statement against D1 and return the rows.
 *
 * wrangler prints config warnings before the JSON, so the payload is located by
 * scanning for the first `[` that decodes to the expected envelope rather than
 * assuming the output starts with it.
 */
function q(sql) {
  const out = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "core-remodel",
      REMOTE ? "--remote" : "--local",
      "--json",
      "--command",
      sql.replace(/\s+/g, " ").trim(),
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== "[") continue;
    try {
      const parsed = JSON.parse(out.slice(i));
      if (Array.isArray(parsed) && parsed[0]?.results) return parsed[0].results;
    } catch {
      /* keep scanning */
    }
  }
  throw new Error(`no result envelope in wrangler output:\n${out.slice(0, 400)}`);
}

// ---------------------------------------------------------------------------
// Address quality
// ---------------------------------------------------------------------------

/**
 * Classify a street address. A "proper" address needs a street number, a street
 * name, and a city — "Bay Area, CA" and "San Jose, CA" are regions, not places
 * you can drive to.
 *
 * Shared shape with `isProperStreetAddress` in the intake validator so the audit
 * and the intake guard agree on what "proper" means.
 */
function addressQuality(addr) {
  const raw = (addr ?? "").trim();
  if (!raw) return { ok: false, reason: "empty", cleaned: null };

  // Strip a leading annotation before the street number. Real prod case (#27):
  // "*BY APPOINTMENT ONLY*, 1998 Republic Ave, San Leandro, CA 94577, USA" is a
  // perfectly good address wearing a note. Auto-fixable, so propose the cleaned
  // form rather than flagging it for a human.
  let s = raw;
  let cleaned = null;
  const annotated = /^[^\d,]*[*(].*?[*)]\s*,\s*(.+)$/.exec(raw);
  if (annotated && /^\s*\d/.test(annotated[1])) {
    s = annotated[1].trim();
    cleaned = s;
  }

  if (!/\d/.test(s)) return { ok: false, reason: "no_street_number", cleaned: null };
  if (!/^\s*\d+[\w-]*\s+\S/.test(s)) {
    return { ok: false, reason: "does_not_start_with_street_number", cleaned: null };
  }
  if (!s.includes(",")) return { ok: false, reason: "no_comma_separator", cleaned: null };
  if (!/\b\d{5}(-\d{4})?\b/.test(s)) return { ok: false, reason: "no_zip", cleaned: null };
  // Valid — but if we had to strip an annotation, that IS a proposed fix.
  return { ok: cleaned === null, reason: cleaned ? "leading_annotation" : null, cleaned };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

console.log(`\nAuditing ${REMOTE ? "REMOTE (prod)" : "LOCAL"} D1 …\n`);

const stores = q(`
  SELECT s.id, s.name, s.description, s.location_address, s.location_city,
         s.location_zip_code, s.latitude, s.icon_cf_images_url, s.scrape_status,
         s.rag_uuid,
         (SELECT url FROM showroom_store_links l
           WHERE l.store_id = s.id AND l.type = 'WEBSITE' LIMIT 1) AS website_url,
         (SELECT COUNT(*) FROM showroom_store_category_mapping m WHERE m.store_id = s.id) AS n_cats,
         (SELECT COUNT(*) FROM showroom_brand_mappings b WHERE b.showroom_id = s.id) AS n_brands,
         (SELECT COUNT(*) FROM browser_run_pages p WHERE p.showroom_id = s.id) AS n_pages
  FROM showroom_stores s ORDER BY s.id
`);

const categories = q(`SELECT id, name FROM showroom_store_category WHERE is_active = 1`);
const catIdByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

// Brand names per store — a signal token source for category inference.
const brandRows = q(`
  SELECT m.showroom_id AS store_id, b.name
  FROM showroom_brand_mappings m JOIN brands b ON b.id = m.brand_id
`);
const brandsByStore = new Map();
for (const r of brandRows) {
  if (!brandsByStore.has(r.store_id)) brandsByStore.set(r.store_id, []);
  brandsByStore.get(r.store_id).push(r.name);
}

// Brands missing a logo but carrying a website — favicon-derivable, no AI cost.
const brandLogoTargets = q(`
  SELECT DISTINCT b.id, b.name, b.website_url
  FROM brands b JOIN showroom_brand_mappings m ON m.brand_id = b.id
  WHERE b.icon_cf_images_url IS NULL AND b.website_url IS NOT NULL
  ORDER BY b.id
`);
const brandsNoLogoNoSite = q(`
  SELECT DISTINCT b.id, b.name
  FROM brands b JOIN showroom_brand_mappings m ON m.brand_id = b.id
  WHERE b.icon_cf_images_url IS NULL AND b.website_url IS NULL
  ORDER BY b.id
`);

const plan = {
  generatedAt: new Date().toISOString(),
  source: REMOTE ? "remote" : "local",
  note: "Derived from existing D1 data only — no Google Places. Review before applying.",
  summary: {},
  categories: [],
  storeLogos: [],
  brandLogos: [],
  addresses: [],
  scrapeKicks: [],
  needsManual: [],
};

for (const s of stores) {
  const brandNames = brandsByStore.get(s.id) ?? [];

  // ── Categories: infer from name + description + brand names.
  // The NAME is the strongest signal and needs no network call.
  if (s.n_cats === 0) {
    const tokens = [s.name, s.description, ...brandNames];
    const labels = inferCategoryLabelsFromTokens(tokens);
    const ids = labels.map((l) => catIdByName.get(l.toLowerCase())).filter(Boolean);
    if (ids.length > 0) {
      plan.categories.push({
        storeId: s.id,
        storeName: s.name,
        categoryIds: ids,
        categoryNames: labels,
        // Provenance, so a human reviewing the JSON can judge the call.
        derivedFrom: brandNames.length ? "name+description+brands" : "name+description",
        rationale: `Inferred from store name/description${brandNames.length ? " and mapped brands" : ""} (no Places)`,
      });
    } else {
      plan.needsManual.push({
        storeId: s.id,
        storeName: s.name,
        field: "categories",
        reason: "no category rule matched name, description, or brands",
      });
    }
  }

  // ── Store logo (favicon) — needs a website to derive from.
  if (!s.icon_cf_images_url) {
    if (s.website_url) {
      plan.storeLogos.push({ storeId: s.id, storeName: s.name, websiteUrl: s.website_url });
    } else {
      plan.needsManual.push({
        storeId: s.id,
        storeName: s.name,
        field: "logo",
        reason: "no WEBSITE link to derive a favicon from",
      });
    }
  }

  // ── Address quality.
  const aq = addressQuality(s.location_address);
  if (!aq.ok && aq.cleaned) {
    // Auto-fixable: the address is real, it just carries a prefix note.
    plan.addresses.push({
      storeId: s.id,
      storeName: s.name,
      current: s.location_address,
      problem: aq.reason,
      proposed: aq.cleaned,
    });
  } else if (!aq.ok) {
    // We will NOT invent an address. Record the gap and where a human could look.
    plan.needsManual.push({
      storeId: s.id,
      storeName: s.name,
      field: "address",
      reason: aq.reason,
      current: s.location_address,
      hint: s.website_url
        ? `scrape ${s.website_url} /contact or /locations for the street address`
        : "no website — needs manual entry or a search-grounded lookup",
    });
    plan.addresses.push({
      storeId: s.id,
      storeName: s.name,
      current: s.location_address,
      problem: aq.reason,
      proposed: null, // deliberately null — filled by a human or a search pass
    });
  }

  // ── Stranded scrapes: has a website, never kicked.
  if (s.website_url && s.scrape_status === "idle" && !s.rag_uuid) {
    plan.scrapeKicks.push({
      storeId: s.id,
      storeName: s.name,
      websiteUrl: s.website_url,
      reason: "has website, scrape_status=idle, rag_uuid=NULL — never kicked",
    });
  }
}

for (const b of brandLogoTargets) {
  plan.brandLogos.push({ brandId: b.id, brandName: b.name, websiteUrl: b.website_url });
}
for (const b of brandsNoLogoNoSite) {
  plan.needsManual.push({
    brandId: b.id,
    brandName: b.name,
    field: "brand_logo",
    reason: "no website_url to derive a favicon from",
  });
}

plan.summary = {
  storesTotal: stores.length,
  categoriesToFill: plan.categories.length,
  storeLogosToFetch: plan.storeLogos.length,
  brandLogosToFetch: plan.brandLogos.length,
  addressesBroken: plan.addresses.length,
  scrapesStranded: plan.scrapeKicks.length,
  needsManual: plan.needsManual.length,
};

fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(plan, null, 2) + "\n");

console.log("  stores audited        ", plan.summary.storesTotal);
console.log("  categories to fill    ", plan.summary.categoriesToFill);
console.log("  store logos to fetch  ", plan.summary.storeLogosToFetch);
console.log("  brand logos to fetch  ", plan.summary.brandLogosToFetch);
console.log("  addresses broken      ", plan.summary.addressesBroken, "(never auto-filled)");
console.log("  scrapes stranded      ", plan.summary.scrapesStranded);
console.log("  needs manual review   ", plan.summary.needsManual);
console.log(`\nwrote ${OUT}\n`);
console.log("Review it, then:  node scripts/showroom-backfill.mjs --plan " + OUT + "\n");
