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

console.log(
  `\n${process.exitCode ? "FAILED" : "PASSED"} — ${passed} checks\n`,
);
