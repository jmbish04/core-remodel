#!/usr/bin/env node
/**
 * Unit test for showroom link classification (`services/showroom/social-links.ts`).
 *
 * Pure functions, no network and no bindings — unlike the other script in this
 * directory it costs nothing to run and touches no real data.
 *
 * Usage:
 *   node scripts/tests/test_link_classification.mjs
 *   pnpm run test:links
 *
 * Plain `node` + node:assert, matching the convention of the sibling script.
 * The .ts import works because Node >=22 strips types natively — no vitest, no
 * tsx, no new dependency. (`npx tsx` actually FAILS on this import; use node.)
 */
import assert from "node:assert/strict";

import { extractBrandFacets } from "../../src/backend/services/showroom/brand-facets.ts";
import {
  classifySiteLink,
  classifySocialLink,
  collectSocialLinks,
} from "../../src/backend/services/showroom/social-links.ts";

const SITE = "rubensteinsupply.com";
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("\nfirst-class social types");

check("promotes x/twitter, linkedin, yelp out of OTHER", () => {
  // The exact rows store #132 had sitting as OTHER before the vocabulary grew.
  assert.equal(classifySocialLink("https://x.com/Rubensteinsupp")?.type, "TWITTER_X");
  assert.equal(classifySocialLink("https://twitter.com/Rubensteinsupp")?.type, "TWITTER_X");
  assert.equal(classifySocialLink("https://linkedin.com/company/rubenstein-co")?.type, "LINKEDIN");
  assert.equal(classifySocialLink("https://yelp.com/biz/rubenstein-oakland")?.type, "YELP");
});

check("still types the originals", () => {
  assert.equal(classifySocialLink("https://instagram.com/davincimarble")?.type, "INSTAGRAM");
  assert.equal(classifySocialLink("https://facebook.com/profile.php?id=1")?.type, "FACEBOOK");
});

check("types without a column stay OTHER + note", () => {
  const yt = classifySocialLink("https://youtube.com/@someshowroom");
  assert.equal(yt?.type, "OTHER");
  assert.equal(yt?.urlNotes, "YouTube");
});

console.log("\nMatterport query preservation");

check("KEEPS ?m= — stripping it points at the Matterport homepage", () => {
  const tour = classifySocialLink("https://my.matterport.com/show/?m=abc123XYZ");
  assert.equal(tour?.type, "SHOWROOM_TOUR");
  assert.ok(tour.url.includes("m=abc123XYZ"), `query lost: ${tour.url}`);
});

check("still strips tracking params off ordinary socials", () => {
  assert.equal(
    classifySocialLink("https://instagram.com/foo?utm_source=site&fbclid=x")?.url,
    "https://instagram.com/foo",
  );
});

console.log("\nshare-widget rejection (the pre-existing guard)");

for (const url of [
  "https://facebook.com/sharer/sharer.php?u=x",
  "https://pinterest.com/pin/create/button/?url=x",
  "https://x.com/intent/tweet?text=x",
  "https://www.linkedin.com/shareArticle?url=x",
  "https://instagram.com/",
]) {
  check(`rejects ${url}`, () => assert.equal(classifySocialLink(url), null));
}

console.log("\nown-domain path classification");

check("finds clearance pages", () => {
  for (const p of ["/clearance", "/sale", "/specials/", "/outlet/rugs", "/shop/closeout"]) {
    assert.equal(
      classifySiteLink(`https://${SITE}${p}`, SITE)?.type,
      "WEBSITE_CLEARANCE",
      `missed ${p}`,
    );
  }
});

check("finds showroom photo galleries", () => {
  assert.equal(classifySiteLink(`https://${SITE}/photo-gallery`, SITE)?.type, "SHOWROOM_PHOTOS");
  assert.equal(classifySiteLink(`https://${SITE}/our-showroom`, SITE)?.type, "SHOWROOM_PHOTOS");
});

check("does NOT call a product catalog a showroom gallery", () => {
  assert.equal(classifySiteLink(`https://${SITE}/shop/gallery`, SITE), null);
  assert.equal(classifySiteLink(`https://${SITE}/products/gallery`, SITE), null);
});

check("requires a whole path segment — no substring matches", () => {
  // "/personalise" and "/wholesale" both contain "sale".
  assert.equal(classifySiteLink(`https://${SITE}/personalise`, SITE), null);
  assert.equal(classifySiteLink(`https://${SITE}/wholesale`, SITE), null);
});

check("rejects another company's sale page", () => {
  // The most damaging false positive: attributing a vendor's clearance to this store.
  assert.equal(classifySiteLink("https://kohler.com/sale", SITE), null);
});

check("accepts the store's own subdomain", () => {
  assert.equal(classifySiteLink(`https://shop.${SITE}/clearance`, SITE)?.type, "WEBSITE_CLEARANCE");
});

check("ignores the homepage", () => {
  assert.equal(classifySiteLink(`https://${SITE}/`, SITE), null);
});

console.log("\ncollectSocialLinks");

check("picks up socials AND own-site pages when given a siteHost", () => {
  const types = collectSocialLinks(
    [
      "https://instagram.com/rubenstein",
      "https://x.com/rubenstein",
      `https://${SITE}/clearance`,
      `https://${SITE}/about`,
      "https://facebook.com/sharer/sharer.php?u=x",
    ],
    SITE,
  )
    .map((l) => l.type)
    .sort();
  assert.deepEqual(types, ["INSTAGRAM", "TWITTER_X", "WEBSITE_CLEARANCE"]);
});

check("is social-only when siteHost is omitted (back-compat)", () => {
  const out = collectSocialLinks([`https://${SITE}/clearance`, "https://instagram.com/foo"]);
  assert.deepEqual(out.map((l) => l.type), ["INSTAGRAM"]);
});

check("dedupes on (type, url)", () => {
  const out = collectSocialLinks([
    "https://instagram.com/foo",
    "https://www.instagram.com/foo/",
    "https://instagram.com/foo?utm_source=x",
  ]);
  assert.equal(out.length, 1);
});

console.log("\nbrand facets — pattern 1 (same-domain shop sidebar)");

const SHOP = `https://${SITE}/shop/`;
const names = (page, links) =>
  extractBrandFacets(page, links, SITE)
    .map((b) => b.name)
    .filter(Boolean)
    .sort();

check("reads brands off facet links across platform shapes", () => {
  assert.deepEqual(
    names(SHOP, [
      { href: `https://${SITE}/shop?brand=thg-paris`, text: "THG Paris" }, // Magento/BigCommerce
      { href: `https://${SITE}/shop?filter_brand=kohler`, text: "Kohler" }, // WooCommerce
      { href: `https://${SITE}/c?filter.p.vendor=grohe`, text: "GROHE" }, // Shopify
      { href: `https://${SITE}/brands/waterworks`, text: "Waterworks" }, // brand landing
      { href: `https://${SITE}/manufacturer/toto`, text: "TOTO" },
    ]),
    ["GROHE", "Kohler", "THG Paris", "TOTO", "Waterworks"],
  );
});

check("uses the anchor TEXT, not the slug", () => {
  // "grohe-usa" would de-slugify to "Grohe Usa", which does NOT match the real
  // "GROHE" and would mint a junk brand + a paid enrichNewBrand call.
  assert.deepEqual(names(SHOP, [{ href: `https://${SITE}/shop?brand=grohe-usa`, text: "GROHE" }]), [
    "GROHE",
  ]);
});

check("strips the facet count off the label", () => {
  assert.deepEqual(names(SHOP, [{ href: `https://${SITE}/shop?brand=k`, text: "Kohler (12)" }]), [
    "Kohler",
  ]);
  assert.deepEqual(names(SHOP, [{ href: `https://${SITE}/shop?brand=t`, text: "TOTO 7" }]), ["TOTO"]);
});

check("rejects sidebar UI chrome", () => {
  assert.deepEqual(
    names(SHOP, [
      { href: `https://${SITE}/shop?brand=a`, text: "All Brands" },
      { href: `https://${SITE}/shop?brand=b`, text: "View All" },
      { href: `https://${SITE}/shop?brand=c`, text: "Clear" },
      { href: `https://${SITE}/shop?brand=kohler`, text: "Kohler" },
    ]),
    ["Kohler"],
  );
});

check("ignores non-brand facets", () => {
  assert.deepEqual(
    names(SHOP, [
      { href: `https://${SITE}/about`, text: "About Us" },
      { href: `https://${SITE}/shop?color=blue`, text: "Blue" },
      { href: `https://${SITE}/shop?brand=rohl`, text: "ROHL" },
    ]),
    ["ROHL"],
  );
});

check("pattern 1 carries no website (the facet is our own site)", () => {
  const [b] = extractBrandFacets(SHOP, [{ href: `https://${SITE}/shop?brand=k`, text: "Kohler" }], SITE);
  assert.equal(b.websiteUrl, null);
});

console.log("\nbrand facets — pattern 2 (off-domain directory page)");

const DIR = `https://${SITE}/manufacturers/`;

check("harvests off-domain brand links ON a directory page", () => {
  // Rubenstein's real shape: each brand links to the manufacturer's own site.
  const out = extractBrandFacets(
    DIR,
    [
      { href: "https://www.bobrick.com", text: "Bobrick" },
      { href: "https://ipsplumbingproducts.com/brands/aba/", text: "AB&amp;A" },
      { href: "http://www.bellgossett.com", text: "Bell &amp; Gossett" },
    ],
    SITE,
  );
  assert.deepEqual(out.map((b) => b.name).sort(), ["AB&A", "Bell & Gossett", "Bobrick"]);
});

check("captures the brand's website — origin only, not our affiliate path", () => {
  const [b] = extractBrandFacets(
    DIR,
    [{ href: "https://ipsplumbingproducts.com/brands/aba/", text: "AB&amp;A" }],
    SITE,
  );
  assert.equal(b.websiteUrl, "https://ipsplumbingproducts.com");
});

check("THE GATE: the same links on a non-directory page yield nothing", () => {
  // Without this, every outbound link on the site becomes a fake brand — and
  // each fake brand costs a junk row plus a paid enrichment call.
  assert.deepEqual(
    extractBrandFacets(`https://${SITE}/blog/`, [{ href: "https://bobrick.com", text: "Bobrick" }], SITE),
    [],
  );
});

check("rejects socials, tel: links and CTAs on the directory page", () => {
  assert.deepEqual(
    names(DIR, [
      { href: "https://facebook.com/profile.php?id=1", text: "Facebook" },
      { href: "https://x.com/rubenstein", text: "Follow us" },
      { href: "tel:+15104446614", text: "(510) 444-6614" },
      { href: "https://theshowroomatrubenstein.com/", text: "Visit Our Showroom Site" },
      { href: "https://www.bobrick.com", text: "Bobrick" },
    ]),
    ["Bobrick"],
  );
});

check("decodes HTML entities in brand names \u2014 named + decimal + hex", () => {
  // Gemini review on #150: decimal-only would leave a raw "&#x2019;" sitting
  // inside the brand name. Many CMS templates emit hex.
  assert.deepEqual(names(DIR, [{ href: "https://alsons.com", text: "Alson&#8217;s" }]), ["Alson\u2019s"]);
  assert.deepEqual(names(DIR, [{ href: "https://alsons.com", text: "Alson&#x2019;s" }]), ["Alson\u2019s"]);
  assert.deepEqual(names(DIR, [{ href: "https://alsons.com", text: "Alson&#X2019;S" }]), ["Alson\u2019S"]);
  assert.deepEqual(names(DIR, [{ href: "https://bg.com", text: "Bell &amp; Gossett" }]), ["Bell & Gossett"]);
  assert.deepEqual(names(DIR, [{ href: "https://x1.com", text: "A&#x26;B Supply" }]), ["A&B Supply"]);
});

check("a malformed numeric entity can't throw and kill the extraction", () => {
  // String.fromCodePoint(1114112) is a RangeError \u2014 unguarded it would take the
  // whole page's brand extraction down.
  assert.deepEqual(names(DIR, [{ href: "https://x2.com", text: "Acme&#1114112; Co" }]), ["Acme Co"]);
});

check("dedupes case-insensitively, prefers the entry with a website", () => {
  const out = extractBrandFacets(
    DIR,
    [
      { href: `https://${SITE}/shop?brand=kohler`, text: "Kohler" }, // no website
      { href: "https://www.kohler.com", text: "KOHLER" }, // has website
    ],
    SITE,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].websiteUrl, "https://www.kohler.com");
});

check("skips links with no usable label", () => {
  assert.deepEqual(
    names(DIR, [
      { href: "https://bobrick.com" },
      { href: "https://x.example.com", text: "  " },
      { href: "https://y.example.com", text: "12" },
    ]),
    [],
  );
});

console.log("\nTHE REGRESSION: logo walls used to yield ZERO brands");

check("a logo-only anchor is captured, not dropped", () => {
  // <a href="kohler.com"><img src="k.svg" alt="Kohler"></a> flattened to text ""
  // and was dropped entirely — discarding the logo URL, the brand's own site AND
  // the alt text, all of which were sitting in the HTML.
  const [b] = extractBrandFacets(
    DIR,
    [{ href: "https://www.kohler.com", imageUrl: "https://site.com/logos/k.svg", imageAlt: "Kohler" }],
    SITE,
  );
  assert.ok(b, "logo-only anchor was dropped");
  assert.equal(b.name, "Kohler", "alt should become the name");
  assert.equal(b.logoUrl, "https://site.com/logos/k.svg");
  assert.equal(b.websiteUrl, "https://www.kohler.com");
  assert.equal(b.extractionMethod, "directory_link");
});

check("a logo with NO alt is still a capture (site + logo survive)", () => {
  const [b] = extractBrandFacets(
    DIR,
    [{ href: "https://www.grohe.com", imageUrl: "https://site.com/logos/g.png" }],
    SITE,
  );
  assert.ok(b, "nameless logo anchor was dropped");
  assert.equal(b.name, null, "no name is honest, not a guess");
  assert.equal(b.logoUrl, "https://site.com/logos/g.png");
  assert.equal(b.extractionMethod, "logo_link");
});

check("anchor text still wins over alt when both exist", () => {
  const [b] = extractBrandFacets(
    DIR,
    [{ href: "https://thgparis.com", text: "THG Paris", imageUrl: "https://s.com/l.png", imageAlt: "logo" }],
    SITE,
  );
  assert.equal(b.name, "THG Paris");
});

check("entity-encoded alt decodes", () => {
  const [b] = extractBrandFacets(
    DIR,
    [{ href: "https://bg.com", imageUrl: "https://s.com/bg.png", imageAlt: "Bell &amp; Gossett" }],
    SITE,
  );
  assert.equal(b.name, "Bell & Gossett");
});

check("merging across pages fills gaps rather than overwriting", () => {
  // Page A gives the logo, page B gives the name. Losing either wastes a fetch.
  const out = extractBrandFacets(
    DIR,
    [
      { href: "https://www.rohl.com", imageUrl: "https://s.com/rohl.png" },
      { href: "https://www.rohl.com/", text: "ROHL" },
    ],
    SITE,
  );
  assert.equal(out.length, 1, "same brand should collapse to one candidate");
  assert.equal(out[0].logoUrl, "https://s.com/rohl.png");
});

check("a logo-only anchor still respects the directory page gate", () => {
  // On /blog an outbound logo link is a citation, not a brand.
  assert.deepEqual(
    extractBrandFacets(
      `https://${SITE}/blog/`,
      [{ href: "https://kohler.com", imageUrl: "https://s.com/k.png", imageAlt: "Kohler" }],
      SITE,
    ),
    [],
  );
});

check("sourceUrl provenance is recorded", () => {
  const [b] = extractBrandFacets(DIR, [{ href: "https://bobrick.com", text: "Bobrick" }], SITE);
  assert.equal(b.sourceUrl, DIR);
});

console.log(
  `\n${process.exitCode ? "FAILED" : "PASSED"} — ${passed} checks\n`,
);
