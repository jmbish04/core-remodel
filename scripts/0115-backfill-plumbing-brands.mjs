#!/usr/bin/env node
/**
 * @fileoverview One-off backfill: the decorative-plumbing brand roster.
 *
 * 95 brands (drains, brassware, ceramics, steam, mirrors) with description,
 * website, Instagram, an online rating and a price point.
 *
 * IMPORTANT — this is NOT a plain INSERT. 60 of the 95 already existed in
 * `brands`, most of them ALL-CAPS stubs from an earlier bulk import
 * ("ALAPE", "DORN BRACHT", "WET STYLE") carrying almost no data:
 * 1/60 had a description, 0/60 an Instagram URL, 0/60 a rating. A blind insert
 * would have created 60 duplicate brands and split every product mapping
 * across them.
 *
 * So each row is matched first, then either inserted or enriched:
 *   - match on normalised name (case/punctuation/suffix-insensitive), else on
 *     registrable domain — "DORN BRACHT" only matches via dornbracht.com;
 *   - existing rows are filled BLANKS-ONLY via COALESCE, so the 17 brands that
 *     already have a logo keep it, and any human-entered notes survive;
 *   - the name itself is only rewritten when the stored one is ALL-CAPS, which
 *     is a data-quality artifact rather than a deliberate choice.
 *
 * Idempotent: re-running matches the same rows and COALESCE writes nothing new.
 *
 * Usage:
 *   node scripts/0115-backfill-plumbing-brands.mjs --dry-run
 *   node scripts/0115-backfill-plumbing-brands.mjs --remote --report
 *   node scripts/0115-backfill-plumbing-brands.mjs --remote
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = "core-remodel";

/** [name, description, websiteUrl, instagramUrl, onlineRating, pricePoint] */
const BRANDS = [
  ["ACO Drains", "Architectural trench and shower drainage systems", "https://www.acodrain.us", null, 4.5, "$$"],
  ["Alape", "Glazed steel washbasins and washstands", "https://www.alape.com", "https://www.instagram.com/alape_official", 4.6, "$$$"],
  ["Alno", "Fine decorative hardware and mirrors", "https://www.alnoinc.com", null, 4.2, "$$"],
  ["Americh", "Customizable luxury bathtubs and shower bases", "https://americh.com", "https://www.instagram.com/americhwellness", 4.4, "$$$"],
  ["Amerock", "Cabinet hardware and bath accessories", "https://www.amerock.com", "https://www.instagram.com/amerockhardware", 4.7, "$"],
  ["Aptations", "High-quality magnifying makeup mirrors", "https://www.aptations.com", null, 4.3, "$$"],
  ["Aquabrass", "Innovative bath and kitchen plumbing fixtures", "https://aquabrass.com", "https://www.instagram.com/aquabrass", 4.2, "$$$"],
  ["Artos", "Italian-designed modern plumbing fixtures", "https://artos-westover.com", "https://www.instagram.com/artos_us", 4.5, "$$"],
  ["Axor", "Avant-garde luxury designer collections by Hansgrohe", "https://www.axor-design.com", "https://www.instagram.com/axordesign", 4.8, "$$$$"],
  ["Baci Mirrors", "Luxury lighted makeup and shaving mirrors", "https://bacimirrors.com", null, 4.5, "$$$"],
  ["Bain Ultra", "Therapeutic air jet baths and wellness products", "https://www.bainultra.com", "https://www.instagram.com/bainultra", 4.7, "$$$$"],
  ["Balux", "Concrete architectural baths and basins", "https://balux.ca", "https://www.instagram.com/balux.ca", 4.6, "$$$"],
  ["Barclay", "Classic and contemporary sinks and tubs", "https://barclayproducts.com", "https://www.instagram.com/barclayproducts", 4.3, "$$"],
  ["Blanco", "Premium kitchen sinks, faucets, and accessories", "https://www.blanco.com", "https://www.instagram.com/blancoamerica1", 4.7, "$$$"],
  ["Blu Bathworks", "Modern architectural bathware", "https://www.blubathworks.com", "https://www.instagram.com/blubathworks", 4.5, "$$$"],
  ["Bobrick", "Commercial washroom accessories", "https://www.bobrick.com", null, 4.4, "$$"],
  ["Brasstech", "Parent company of Newport Brass and Ginger", "https://www.brasstech.com", null, 4.5, "$$$"],
  ["Brizo", "Luxury fashion-forward fittings by Delta", "https://www.brizo.com", "https://www.instagram.com/brizofaucet", 4.8, "$$$$"],
  ["California Faucets", "Customizable artisan faucets and shower systems", "https://www.calfaucets.com", "https://www.instagram.com/calfaucets", 4.7, "$$$"],
  ["Cement Elegance", "Architectural concrete sinks and fire pits", "https://cementelegance.com", "https://www.instagram.com/cementelegance", 4.6, "$$$"],
  ["Cheviot", "Cast iron bathtubs and traditional bath fixtures", "https://cheviotproducts.com", "https://www.instagram.com/cheviotproducts", 4.4, "$$$"],
  ["Delta", "Reliable, innovative kitchen and bath fixtures", "https://www.deltafaucet.com", "https://www.instagram.com/deltafaucet", 4.6, "$$"],
  ["Dornbracht", "Ultra-luxury German architectural plumbing", "https://www.dornbracht.com", "https://www.instagram.com/dornbracht", 4.9, "$$$$"],
  ["Duravit", "Designer sanitary ceramics and bathroom furniture", "https://www.duravit.com", "https://www.instagram.com/duravit", 4.6, "$$$"],
  ["Easy Drain", "Barrier-free linear shower drains", "https://www.easydrain.com", "https://www.instagram.com/easydrain", 4.5, "$$"],
  ["Effegibi", "Italian saunas and hammams (Turkish baths)", "https://www.effe.it", "https://www.instagram.com/effe_perfect_wellness", 4.8, "$$$$"],
  ["Electric Mirror", "Lighted mirrors and mirror TVs", "https://www.electricmirror.com", "https://www.instagram.com/electricmirror", 4.7, "$$$"],
  ["Elkay", "Stainless steel sinks and water delivery products", "https://www.elkay.com", "https://www.instagram.com/elkay_usa", 4.5, "$$"],
  ["EWS", "Environmental Water Systems (filtration)", "https://www.ewswater.com", null, 4.6, "$$"],
  ["Fantini", "Premium Italian design faucets", "https://www.fantini.it", "https://www.instagram.com/fantini_official", 4.8, "$$$$"],
  ["Fleurco", "Shower doors, bases, and freestanding tubs", "https://fleurco.com", "https://www.instagram.com/fleurco", 4.4, "$$"],
  ["Franke", "Swiss-made precision kitchen sinks and faucets", "https://www.franke.com", "https://www.instagram.com/franke_group", 4.6, "$$$"],
  ["Franz Viegener", "Precision-crafted luxury faucets from Argentina", "https://franzviegener.com", "https://www.instagram.com/franzviegener", 4.7, "$$$$"],
  ["The Galley", "Highly functional culinary kitchen workstations", "https://thegalley.com", "https://www.instagram.com/thegalley", 4.9, "$$$$"],
  ["Geberit", "Concealed cisterns and sanitary technology", "https://www.geberit.com", "https://www.instagram.com/geberit", 4.8, "$$"],
  ["Gessi", "Private wellness and luxury Italian brassware", "https://www.gessi.com", "https://www.instagram.com/gessi_official", 4.8, "$$$$"],
  ["Graff", "Modern and traditional luxury bathroom fixtures", "https://www.graff-designs.com", "https://www.instagram.com/graff_designs", 4.7, "$$$"],
  ["Grohe", "German engineered premium kitchen/bath fittings", "https://www.grohe.us", "https://www.instagram.com/grohe_us", 4.5, "$$"],
  ["Hansgrohe", "Innovative showers and bathroom faucets", "https://www.hansgrohe-usa.com", "https://www.instagram.com/hansgroheusa", 4.6, "$$$"],
  ["Hastings Tile & Bath", "Contemporary European bath furniture and tile", "https://hastingstilebath.com", "https://www.instagram.com/hastingstilebath", 4.5, "$$$"],
  ["Herbeau", "French artisan crafted vintage plumbing", "https://www.herbeau.com", null, 4.6, "$$$$"],
  ["Huntington Brass", "Quality residential and commercial brass fixtures", "https://huntingtonbrass.com", "https://www.instagram.com/huntingtonbrass", 4.2, "$$"],
  ["Hydrosystems", "Custom bathtubs and hydrotherapy systems", "https://hydrosystem.com", "https://www.instagram.com/hydrosystems", 4.4, "$$$"],
  ["Infinity Drain", "Premium decorative linear and center drains", "https://infinitydrain.com", "https://www.instagram.com/infinitydrain", 4.8, "$$$"],
  ["Insinkerator", "Garbage disposals and instant hot water dispensers", "https://insinkerator.emerson.com", "https://www.instagram.com/insinkerator", 4.7, "$$"],
  ["Jaclo", "Decorative plumbing and shower components", "https://www.jaclo.com", "https://www.instagram.com/jaclo_inc", 4.5, "$$$"],
  ["Jason", "Hydrotherapy baths founded by the Jacuzzi family", "https://jasoninternational.com", null, 4.5, "$$$"],
  ["Julien", "Handcrafted stainless steel kitchen sinks (Home Refinements)", "https://homerefinements.ca", "https://www.instagram.com/homerefinementsbyjulien", 4.7, "$$$"],
  ["Kaldewei", "Steel enamel bathroom solutions and tubs", "https://www.kaldewei.com", "https://www.instagram.com/kaldewei", 4.6, "$$$"],
  ["Kallista", "Luxury designer plumbing fixtures by Kohler", "https://www.kallista.com", "https://www.instagram.com/kallistaplumbing", 4.8, "$$$$"],
  ["Keuco", "High-end bathroom accessories and furnishings", "https://www.keuco.com", "https://www.instagram.com/keuco_official", 4.6, "$$$"],
  ["Kimball & Young", "Luxury magnifying mirrors for hospitality/home", "https://www.kimballandyoung.com", null, 4.3, "$$"],
  ["Kohler", "Global leader in kitchen and bath products", "https://www.kohler.com", "https://www.instagram.com/kohler", 4.6, "$$"],
  ["Kreoo", "Italian marble furniture and washbasins", "https://www.kreoo.com", "https://www.instagram.com/kreoo_official", 4.9, "$$$$"],
  ["Krugg", "Modern LED medicine cabinets and mirrors", "https://www.kruggusa.com", "https://www.instagram.com/krugg_reflections", 4.5, "$$"],
  ["Lacava", "Contemporary bathroom furniture and fixtures", "https://www.lacava.com", "https://www.instagram.com/lacavadesign", 4.4, "$$$"],
  ["Latoscana", "Italian-made fireclay sinks and bathroom fixtures", "https://latoscana-italy.com", null, 4.3, "$$"],
  ["Laufen", "Swiss-designed bathroom ceramics and solutions", "https://www.laufen.com", "https://www.instagram.com/laufenbathrooms", 4.7, "$$$"],
  ["Linkasink", "Artisan crafted metal, concrete, and mosaic sinks", "https://www.linkasink.com", "https://www.instagram.com/linkasink", 4.6, "$$$"],
  ["Luxart", "Exclusive, stylish plumbing fixtures and accessories", "https://luxartcollection.com", null, 4.1, "$$"],
  ["Maidstone Supply", "Classic cast iron bathtubs and vintage fittings", "https://maidstonesupply.com", "https://www.instagram.com/maidstonesupply", 4.2, "$$"],
  ["Moen", "Accessible, innovative residential plumbing", "https://www.moen.com", "https://www.instagram.com/moeninc", 4.6, "$$"],
  ["Mountain Plumbing", "High-end plumbing accessories and water dispensers", "https://www.mountainplumbing.com", "https://www.instagram.com/mountainplumbing", 4.5, "$$$"],
  ["Mr Steam", "Luxury residential steam shower systems", "https://www.mrsteam.com", "https://www.instagram.com/mrsteam", 4.8, "$$$"],
  ["Nameeks", "European bathroom vanity and accessory distributor", "https://nameeks.com", "https://www.instagram.com/nameeks", 4.3, "$$"],
  ["Native Trails", "Sustainable hammered copper and concrete sinks", "https://nativetrailshome.com", "https://www.instagram.com/nativetrails", 4.7, "$$$"],
  ["Nood Co.", "Colorful architectural concrete basins and furniture", "https://noodco.com.au", "https://www.instagram.com/nood_co", 4.8, "$$$"],
  ["Panasonic Ventilation", "High-performance quiet bathroom exhaust fans", "https://na.panasonic.com/us/home-and-building-solutions/ventilation-indoor-air-quality", null, 4.8, "$$"],
  ["Perrin & Rowe", "Traditional handcrafted British brassware", "https://houseofrohl.com/perrin-and-rowe", "https://www.instagram.com/perrinandrowe", 4.8, "$$$$"],
  ["Phylrich", "Luxury custom American-made plumbing fixtures", "https://phylrich.com", "https://www.instagram.com/phylrich", 4.6, "$$$"],
  ["Premier Copper", "Handcrafted copper sinks and lighting", "https://premiercopperproducts.com", "https://www.instagram.com/premiercopperproducts", 4.5, "$$"],
  ["QM Drains", "Stainless steel linear and center shower drains", "https://qmdrain.com", "https://www.instagram.com/qmdrain", 4.6, "$$"],
  ["Riobel", "Canadian modern and transitional brassware", "https://houseofrohl.com/riobel", "https://www.instagram.com/riobel_inc", 4.6, "$$$"],
  ["Robern", "Luxury mirrored cabinets and bathroom vanities", "https://www.robern.com", "https://www.instagram.com/robern", 4.7, "$$$"],
  ["Rohl", "Authentic European luxury brassware and sinks", "https://houseofrohl.com/rohl", "https://www.instagram.com/rohlfaucets", 4.7, "$$$"],
  ["Rubinet", "Customizable colored faucets and brassware", "https://rubinet.com", "https://www.instagram.com/rubinetfaucet", 4.5, "$$$"],
  ["Samuel Heath", "Solid brass English architectural hardware/faucets", "https://www.samuel-heath.com", "https://www.instagram.com/samuelheathofficial", 4.8, "$$$$"],
  ["Santec", "Innovative custom American faucet design", "https://santecfaucet.com", "https://www.instagram.com/santecfaucets", 4.5, "$$$"],
  ["Sherle Wagner", "Ultra-luxury heritage architectural hardware", "https://sherlewagner.com", "https://www.instagram.com/sherlewagnerintl", 4.9, "$$$$"],
  ["Sigma", "Designer and classic American-made plumbing", "https://sigmaplumbing.com", null, 4.4, "$$$"],
  ["Smedbo", "Solid brass Scandinavian bathroom accessories", "https://www.smedbo.com", "https://www.instagram.com/smedbo.se", 4.4, "$$"],
  ["Sophstone", "Resin and stone freestanding tubs and sinks", "https://sophstone.com", "https://www.instagram.com/sophstone_usa", 4.5, "$$$"],
  ["Steamist", "Residential steam shower and sauna systems", "https://steamist.com", "https://www.instagram.com/steamist", 4.6, "$$$"],
  ["Stone Forest", "Carved stone, bronze, and copper bath features", "https://stoneforest.com", "https://www.instagram.com/stoneforestinc", 4.8, "$$$"],
  ["Thermasol", "Smart steam showers and wellness experiences", "https://www.thermasol.com", "https://www.instagram.com/thermasol", 4.7, "$$$"],
  ["THG", "Haute couture French bathroom fittings", "https://www.thg-paris.com", "https://www.instagram.com/thgparis", 4.9, "$$$$"],
  ["Toto", "Advanced washlets and bathroom ceramics", "https://www.totousa.com", "https://www.instagram.com/totousa", 4.8, "$$"],
  ["Trim By Design", "Decorative plumbing trims and accessories", "https://trimbydesign.com", null, 4.2, "$$"],
  ["Victoria & Albert", "Freestanding tubs made from Volcanic Limestone", "https://houseofrohl.com/victoria-and-albert", "https://www.instagram.com/vandabaths", 4.8, "$$$"],
  ["Vitraform", "Pioneers of the original glass sink", "https://vitraform.com", null, 4.4, "$$$"],
  ["Vola", "Minimalist architectural Danish plumbing design", "https://en.vola.com", "https://www.instagram.com/vola.denmark", 4.9, "$$$$"],
  ["Water Inc.", "Water filtration and luxury kitchen accessories", "https://waterinc.com", "https://www.instagram.com/waterinc", 4.6, "$$$"],
  ["Watermark", "Brooklyn-based architectural plumbing fixtures", "https://watermark-designs.com", "https://www.instagram.com/watermarkbrooklyn", 4.7, "$$$"],
  ["Waterstone", "American-made luxury kitchen faucets", "https://waterstoneco.com", "https://www.instagram.com/waterstonefaucets", 4.8, "$$$$"],
  ["Wetstyle", "Award-winning modern bath furnishings and tubs", "https://wetstyle.com", "https://www.instagram.com/wetstyle", 4.7, "$$$"],
];

/** SQL string literal. wrangler --file takes no bind params, so values inline. */
const q = (v) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const num = (v) => (v === null || v === undefined ? "NULL" : String(v));

/**
 * Registrable domain: strip scheme, `www.` and path, keep the last two labels.
 * "https://www.dornbracht.com/en" and "dornbracht.com" collapse to one key.
 */
function domainOf(url) {
  if (!url) return null;
  const host = String(url)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase();
  const parts = host.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : host;
}

/**
 * Name key: lowercase, drop parentheticals and corporate suffixes, then remove
 * every non-alphanumeric character. This is what makes "WET STYLE" match
 * "Wetstyle", "DORN BRACHT" match "Dornbracht", and "Water, Inc." match
 * "Water Inc.".
 */
function nameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(inc|llc|ltd|co|company|corp|usa|group|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Domains shared by several distinct brands. A domain match here would be
 * ambiguous, so it is never used as a fallback — houseofrohl.com alone covers
 * Perrin & Rowe, Riobel, Rohl and Victoria & Albert, and matching on it would
 * silently enrich whichever row happened to come back first.
 */
function sharedDomains(rows) {
  const counts = new Map();
  for (const d of rows.map((r) => domainOf(r.website_url)).filter(Boolean)) {
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  for (const [, , website] of BRANDS) {
    const d = domainOf(website);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 2).map(([d]) => d));
}

const args = process.argv.slice(2);
const mode = args.includes("--remote") ? "--remote" : "--local";

/** Read the current roster so matching happens here, against real rows. */
function fetchExisting() {
  const out = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DB,
      mode,
      "--json",
      "--command=SELECT id, name, website_url FROM brands;",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const match = out.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!match) throw new Error("could not parse brands from wrangler output");
  return JSON.parse(match[0])[0].results;
}

/**
 * Resolve each roster entry to an existing brand id, or null for "insert".
 *
 * Matching is done HERE rather than in SQL: the normalisation needed is beyond
 * what nested replace() can express readably, and — more importantly — an
 * ambiguous match must be detectable. Emitting explicit ids also makes the
 * generated SQL auditable before it runs.
 */
function plan(existing) {
  const ambiguous = sharedDomains(existing);
  const byName = new Map();
  const byDomain = new Map();
  for (const row of existing) {
    const key = nameKey(row.name);
    if (!byName.has(key)) byName.set(key, row);
    const dom = domainOf(row.website_url);
    if (dom && !ambiguous.has(dom) && !byDomain.has(dom)) byDomain.set(dom, row);
  }

  return BRANDS.map((brand) => {
    const [name, , website] = brand;
    const dom = domainOf(website);
    const hit = byName.get(nameKey(name)) ?? (dom ? byDomain.get(dom) : null) ?? null;
    return { brand, hit };
  });
}

const existing = fetchExisting();
const planned = plan(existing);
const updates = planned.filter((p) => p.hit);
const inserts = planned.filter((p) => !p.hit);

const stmts = [];

for (const { brand, hit } of updates) {
  const [name, description, website, instagram, rating, pricePoint] = brand;
  // Blanks only. COALESCE keeps every value already present, which is what
  // protects the brands that already carry a logo or hand-written notes.
  stmts.push(`UPDATE brands SET
      description   = COALESCE(description, ${q(description)}),
      website_url   = COALESCE(website_url, ${q(website)}),
      instagram_url = COALESCE(instagram_url, ${q(instagram)}),
      online_rating = COALESCE(online_rating, ${num(rating)}),
      price_point   = COALESCE(price_point, ${q(pricePoint)}),
      name          = CASE WHEN name = upper(name) AND name != ${q(name)}
                          THEN ${q(name)} ELSE name END,
      updated_at    = unixepoch()
    WHERE id = ${hit.id};`);
}

for (const { brand } of inserts) {
  const [name, description, website, instagram, rating, pricePoint] = brand;
  // Guard on name anyway: makes a re-run after a partial failure a no-op.
  stmts.push(`INSERT INTO brands
      (name, description, website_url, instagram_url, online_rating, price_point)
    SELECT ${q(name)}, ${q(description)}, ${q(website)}, ${q(instagram)},
           ${num(rating)}, ${q(pricePoint)}
     WHERE NOT EXISTS (SELECT 1 FROM brands WHERE name = ${q(name)});`);
}

if (args.includes("--plan")) {
  console.log(
    `${BRANDS.length} roster brands vs ${existing.length} existing\n` +
      `  ${updates.length} matched -> enrich blanks only\n` +
      `  ${inserts.length} unmatched -> insert\n`,
  );
  console.log("MATCHED:");
  for (const { brand, hit } of updates) {
    const flag = hit.name === hit.name.toUpperCase() ? " (renaming ALL-CAPS)" : "";
    console.log(`  ${brand[0].padEnd(24)} -> #${hit.id} ${hit.name}${flag}`);
  }
  console.log("\nNEW:");
  for (const { brand } of inserts) console.log(`  ${brand[0]}`);
  process.exit(0);
}

if (args.includes("--dry-run")) {
  console.log(stmts.join("\n\n"));
  process.exit(0);
}

if (args.includes("--report")) {
  const sql = `SELECT count(*) AS total,
      sum(CASE WHEN description IS NOT NULL THEN 1 ELSE 0 END) AS with_description,
      sum(CASE WHEN instagram_url IS NOT NULL THEN 1 ELSE 0 END) AS with_instagram,
      sum(CASE WHEN online_rating IS NOT NULL THEN 1 ELSE 0 END) AS with_rating,
      sum(CASE WHEN icon_cf_images_url IS NOT NULL THEN 1 ELSE 0 END) AS with_logo
    FROM brands;`;
  execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, `--command=${sql}`], {
    encoding: "utf8",
    stdio: "inherit",
  });
  process.exit(0);
}

const file = join(tmpdir(), `backfill-plumbing-brands-${process.pid}.sql`);
writeFileSync(file, stmts.join("\n") + "\n");
console.log(
  `reconciling ${BRANDS.length} brands via ${stmts.length} statements (${mode})\n` +
    `  UPDATE fills blanks only; INSERT runs only when nothing matched\n  ${file}`,
);
execFileSync("npx", ["wrangler", "d1", "execute", DB, mode, "--file", file, "--yes"], {
  encoding: "utf8",
  stdio: "inherit",
  maxBuffer: 64 * 1024 * 1024,
});
console.log("done — re-run with --report to see coverage");
