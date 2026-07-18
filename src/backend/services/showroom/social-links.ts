/**
 * @fileoverview Social-profile link classification for showroom websites.
 *
 * Showroom sites almost always link their own socials from the header/footer, so
 * the most reliable capture is DETERMINISTIC: read the page's `<a href>` set and
 * classify by hostname. That beats asking an LLM to spot a footer icon (which had
 * a 100% miss rate — every scraped page returned instagramUrl: null).
 *
 * The trap this guards: nearly every site also ships SHARE widgets
 * (facebook.com/sharer, pinterest.com/pin/create/button, x.com/intent/tweet).
 * Those are not the business's profile — matching hosts naively would fill
 * `showroom_store_links` with junk that looks plausible.
 *
 * Types map to the `showroom_store_links.type` vocabulary. Anything social but
 * without a first-class type (YouTube/TikTok/Houzz) still lands as OTHER +
 * `urlNotes`.
 *
 * TWO CLASSIFIERS, because the link types split into two shapes:
 *  - {@link classifySocialLink} matches by HOST (instagram.com, matterport.com).
 *    It returns null for any unknown host — including the store's own domain.
 *  - {@link classifySiteLink} matches by PATH on the store's OWN domain
 *    (/clearance, /gallery), which the host matcher structurally cannot see.
 */

import type { ShowroomLinkType } from "@backend/db/schema/showroom/links";

export type { ShowroomLinkType };

export interface ClassifiedLink {
  type: ShowroomLinkType;
  url: string;
  urlNotes: string | null;
}

/** Share / intent / auth endpoints — a "share this page" widget, never a profile. */
const NON_PROFILE_PATH_RE =
  /^\/(sharer|share|share\.php|dialog|intent|pin\/create|shareArticle|submit|login|signup|help|about|policy|privacy|terms|legal|explore|search|hashtag|p|reel|reels|posts|watch|events|marketplace|groups|tr)(\/|$)/i;

/**
 * Hosts are matched with an OPTIONAL subdomain: sites link mobile (`m.facebook.com`)
 * and localized (`fr-fr.facebook.com`, `en-gb.facebook.com`) variants, which an
 * apex-only match would silently drop. Non-profile subdomains that slip through
 * (business.facebook.com, developers.facebook.com) are caught by the path filter.
 */
const SOCIAL_HOSTS: Array<{
  re: RegExp;
  type: ShowroomLinkType;
  notes?: string;
  /**
   * Keep the query string. Default is to strip it (tracking junk), but a
   * Matterport tour is identified BY its query — `my.matterport.com/show/?m=<id>`
   * — so stripping it yields a dead link to the Matterport homepage.
   */
  keepQuery?: boolean;
}> = [
  { re: /^(?:[a-z0-9-]+\.)?instagram\.com$/i, type: "INSTAGRAM" },
  { re: /^(?:[a-z0-9-]+\.)?facebook\.com$/i, type: "FACEBOOK" },
  { re: /^(?:[a-z0-9-]+\.)?fb\.com$/i, type: "FACEBOOK" },
  { re: /^(?:[a-z0-9-]+\.)?pinterest\.(com|[a-z]{2}|co\.[a-z]{2})$/i, type: "PINTEREST" },
  // Promoted out of OTHER now that the vocabulary carries first-class types.
  // Rows already sitting in OTHER (store #132 has all three) are re-typed in
  // place by aggregate(), which keys on url rather than (type,url) precisely so
  // a re-classification updates instead of inserting a duplicate.
  { re: /^(?:[a-z0-9-]+\.)?x\.com$/i, type: "TWITTER_X" },
  { re: /^(?:[a-z0-9-]+\.)?twitter\.com$/i, type: "TWITTER_X" },
  { re: /^(?:[a-z0-9-]+\.)?linkedin\.com$/i, type: "LINKEDIN" },
  { re: /^(?:[a-z0-9-]+\.)?yelp\.com$/i, type: "YELP" },
  // 360° walkthroughs. Matterport is the one Justin named; the others are the
  // same product category and cost one regex each.
  { re: /^(?:[a-z0-9-]+\.)?matterport\.com$/i, type: "SHOWROOM_TOUR", notes: "Matterport", keepQuery: true },
  { re: /^(?:[a-z0-9-]+\.)?kuula\.co$/i, type: "SHOWROOM_TOUR", notes: "Kuula", keepQuery: true },
  // Still no first-class type — keep the label in urlNotes.
  { re: /^(?:[a-z0-9-]+\.)?youtube\.com$/i, type: "OTHER", notes: "YouTube" },
  { re: /^youtu\.be$/i, type: "OTHER", notes: "YouTube" },
  { re: /^(?:[a-z0-9-]+\.)?tiktok\.com$/i, type: "OTHER", notes: "TikTok" },
  { re: /^(?:[a-z0-9-]+\.)?houzz\.com$/i, type: "OTHER", notes: "Houzz" },
];

/** Platform subdomains that are never a business profile. */
const NON_PROFILE_SUBDOMAIN_RE = /^(business|developers?|about|careers|help|support|ads|analytics)\./i;

/**
 * Classify one URL as a social profile link, or null when it is not social / is a
 * share widget / is a bare platform root. Canonicalizes to https, strips `www.`,
 * tracking params, and trailing slashes so repeat scrapes dedupe cleanly.
 */
export function classifySocialLink(rawUrl: string): ClassifiedLink | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  const entry = SOCIAL_HOSTS.find((s) => s.re.test(host));
  if (!entry) return null;
  if (NON_PROFILE_SUBDOMAIN_RE.test(host)) return null;

  const path = u.pathname.replace(/\/+$/, "");
  // Bare platform root (instagram.com/) — a logo link, not a profile.
  if (!path) return null;
  if (NON_PROFILE_PATH_RE.test(path)) return null;

  u.protocol = "https:";
  u.hostname = host;
  u.hash = "";
  if (!entry.keepQuery) u.search = "";
  // Only trim a trailing slash off the PATH. Blindly trimming the whole string
  // would corrupt a kept query (…/show/?m=abc has no trailing slash to cut, but
  // a future ?m=abc/ would lose a byte of the id).
  u.pathname = u.pathname.replace(/\/+$/, "");
  const url = u.toString();

  return { type: entry.type, url, urlNotes: entry.notes ?? null };
}

// ---------------------------------------------------------------------------
// Own-site path classification (WEBSITE_CLEARANCE / SHOWROOM_PHOTOS)
// ---------------------------------------------------------------------------

/**
 * Sale / clearance pages. Deliberately NARROW: a false positive here feeds the
 * sale-tracking pipeline a page that has no sale on it, and every retail site
 * has a "/specials" that is really a financing ad. Requires a whole path
 * segment, so `/personalise` cannot match `sale` — and, for the same reason,
 * `/wholesale`, `/salem-store` and `/sales-team` are all structurally excluded.
 *
 * The second line is the showroom-specific vocabulary: a stone/tile/fixture
 * showroom's clearance is usually the ex-display piece or the offcut, and it is
 * almost never filed under the word "sale" — "floor model", "remnant" and
 * "scratch and dent" are the terms of art.
 */
const CLEARANCE_PATH_RE =
  /(^|\/)(clearance|sale|sales|on-sale|specials|closeout|close-out|outlet|discontinued|overstock|deals|promotions?|markdowns?|liquidation|floor-?models?|floor-?samples?|ex-?display|remnants?|last-?chance|final-?sale|scratch-?(and|&)-?dent)(\/|$)/i;

/**
 * Photo galleries OF the showroom. Also narrow — "gallery" on these sites is
 * ambiguous (product gallery vs. showroom gallery), so it is included but the
 * product-portal words below veto it.
 */
const SHOWROOM_PHOTOS_PATH_RE =
  /(^|\/)(showroom-photos|showroom-gallery|our-showroom|photo-gallery|photos|gallery|galleries|virtual-tour|tour)(\/|$)/i;

/**
 * Vetoes a SHOWROOM_PHOTOS match: a product/shop gallery is a catalog, not
 * pictures of the room. `/shop/gallery` is the catalog; `/about/gallery` is not.
 */
const PRODUCT_CONTEXT_RE = /(^|\/)(shop|store|product|products|catalog|collections?|browse)(\/|$)/i;

/**
 * Infrastructure / bot-challenge paths that are never real site content, vetoed
 * before any classification.
 *
 * Found in prod, not in review: a scrape of decorativeplumbingsupply.com stored
 * `/cloudflare-challenges/concepts/clearance` as WEBSITE_CLEARANCE — the bot
 * interstitial's OWN url happens to end in "clearance", so the path matcher was
 * structurally right and the result was still junk. Left alone it would have
 * been re-scraped (Browser Rendering + an AI extraction) every week forever.
 */
const INFRA_PATH_RE =
  /(^|\/)(cloudflare-challenges?|cdn-cgi|__cf[a-z_]*|\.well-known|wp-admin|wp-login|xmlrpc\.php)(\/|$)/i;

/**
 * Classify a link ON THE STORE'S OWN DOMAIN by its path. Returns null for
 * off-domain links (those are {@link classifySocialLink}'s job) and for paths
 * that match nothing.
 *
 * `siteHost` is the store's WEBSITE host — pass the scrape's seed URL host.
 */
export function classifySiteLink(rawUrl: string, siteHost: string): ClassifiedLink | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  const base = siteHost.replace(/^www\./i, "").toLowerCase();
  // Same registrable site only — accept subdomains (shop.foo.com) of the store's
  // own domain, reject everything else so a linked-to vendor's /sale never lands
  // on this store.
  if (host !== base && !host.endsWith(`.${base}`)) return null;

  const path = u.pathname.replace(/\/+$/, "");
  if (!path) return null; // the homepage is the WEBSITE link, not a sub-page
  if (INFRA_PATH_RE.test(path)) return null;

  let type: ShowroomLinkType | null = null;
  if (CLEARANCE_PATH_RE.test(path)) type = "WEBSITE_CLEARANCE";
  else if (SHOWROOM_PHOTOS_PATH_RE.test(path) && !PRODUCT_CONTEXT_RE.test(path)) {
    type = "SHOWROOM_PHOTOS";
  }
  if (!type) return null;

  u.protocol = "https:";
  u.hash = "";
  u.search = "";
  u.pathname = path;
  return { type, url: u.toString(), urlNotes: null };
}

/**
 * Classify + de-duplicate a set of hrefs into social profile links.
 * Dedupes on (type, url) case-insensitively.
 *
 * Pass `siteHost` (the store's website host) to ALSO pick up own-site
 * clearance/photo pages via {@link classifySiteLink}. Omit it to get social-only
 * behaviour.
 */
export function collectSocialLinks(
  hrefs: Iterable<string | null | undefined>,
  siteHost?: string,
): ClassifiedLink[] {
  const byKey = new Map<string, ClassifiedLink>();
  for (const href of hrefs) {
    if (!href) continue;
    const classified =
      classifySocialLink(href) ?? (siteHost ? classifySiteLink(href, siteHost) : null);
    if (!classified) continue;
    const key = `${classified.type}:${classified.url.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, classified);
  }
  return [...byKey.values()];
}
