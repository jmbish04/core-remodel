/**
 * @fileoverview Deterministic brand extraction from a showroom's own pages.
 *
 * WHY THIS EXISTS — measured, not theorised. Rubenstein Supply (store #132) has
 * a /manufacturers/ page listing ~130 brands. The Workers-AI per-page extraction
 * captured SIX of them. That is a ~95% miss on the single most valuable list on
 * the site, and it is the same failure mode that motivated social-links.ts: the
 * model under-reads long, repetitive lists, while the data sits in structured
 * HTML we have already fetched and thrown away.
 *
 * TWO PATTERNS, because showrooms publish brands two different ways:
 *
 *  1. SHOP FACET (same-domain). A catalog sidebar filter:
 *         <a href="/shop?brand=thg-paris">THG Paris</a>
 *     Self-identifying via the query param, so it is safe to harvest from ANY
 *     page — the `?brand=` IS the proof.
 *
 *  2. BRAND DIRECTORY (off-domain). A "Manufacturers"/"Brands" page listing each
 *     brand linked to the manufacturer's OWN site:
 *         <a href="https://bobrick.com">Bobrick</a>
 *     This is Rubenstein's shape, and it carries a bonus: the href IS the
 *     brand's website, which `brands.website_url` currently stores as null.
 *
 * THE SAFETY HINGE. Pattern 2 has no marker on the link itself — an off-domain
 * link is only a brand BECAUSE of the page it sits on. So pattern 2 is gated on
 * the PAGE path matching {@link BRAND_DIRECTORY_RE}. On /manufacturers, an
 * off-domain link is a brand; on /blog it is a citation. Without that gate this
 * would turn every outbound link on the site into a fake brand — and each fake
 * brand costs a junk row plus a paid `enrichNewBrand` AI call.
 *
 * USE THE LINK TEXT, NEVER THE SLUG. "grohe-usa" de-slugifies to "Grohe Usa",
 * which does not match the real "GROHE" under upsertBrandMapping's
 * `lower(name) = lower(name)` compare, so it would mint a near-duplicate brand.
 * The anchor text is the name the store itself uses.
 */

/**
 * A brand recovered from a page.
 *
 * ANY SUBSET OF THE THREE DATA FIELDS IS A VALID CAPTURE. A logo wall yields a
 * logo + a website but often no readable name; a shop filter bar yields a name
 * and nothing else. Requiring a name — as this type used to — is exactly why a
 * wall of brand logos produced zero rows.
 */
export interface BrandCandidate {
  /** Null when the anchor was a bare logo with no text and no alt. */
  name: string | null;
  /** The manufacturer's own site, when the link revealed one. */
  websiteUrl: string | null;
  /** The logo image as found on the SOURCE page. */
  logoUrl: string | null;
  /** Provenance — which page this came from. */
  sourceUrl: string;
  extractionMethod: "text_list" | "logo_link" | "filter_bar" | "directory_link";
}

/** @deprecated Use {@link BrandCandidate}. Kept so existing imports compile. */
export type FacetBrand = BrandCandidate;

/**
 * Query params carrying a brand facet across the common platforms:
 * Shopify (`filter.p.vendor`), WooCommerce (`filter_brand`, `pa_brand`),
 * Magento (`brand`, `manufacturer`), BigCommerce (`brand`).
 */
const BRAND_PARAM_RE =
  /^(brand|brands|brand_name|manufacturer|vendor|filter_brand|filter\.p\.vendor|pa_brand)$/i;

/** Same-domain path shapes that denote a brand landing page. */
const BRAND_PATH_RE = /(^|\/)(brands?|manufacturers?|vendors?|shop-by-brand)\/([^/]+)/i;

/**
 * Pages whose outbound links are brands (pattern 2). Deliberately tight — this
 * is the only thing standing between "brand list" and "every link on the site".
 */
const BRAND_DIRECTORY_RE =
  /(^|\/)(manufacturers?|brands?|our-brands|shop-by-brand|lines|product-lines|vendors?|partners|suppliers)(\/|$)/i;

/**
 * Hosts that are never a brand: our own socials, maps, CDNs, and the platform
 * plumbing that shows up in every footer.
 */
const NON_BRAND_HOST_RE =
  /(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|youtu|pinterest|yelp|tiktok|google|goo|maps|apple|bing|houzz|wordpress|elementor|wixstatic|cloudflare|gstatic|googleapis|gravatar|w3|schema|adobe|paypal)\.[a-z.]+$/i;

/**
 * Link text that is a UI control, not a brand. Covers facet chrome ("All
 * Brands", "Clear") and the call-to-action links that share a brand directory
 * page ("Visit Our Showroom Site", "View Showroom Hours" — both real hits on
 * Rubenstein's /manufacturers).
 */
const NON_BRAND_TEXT_RE =
  /^(all|all brands?|shop all|view all|see all|see more|show more|load more|clear|clear all|reset|filter|filters|brands?|manufacturers?|vendors?|more|less|none|other|misc|new|sale|home|next|prev|previous|back|top)$/i;

/** Leading verbs that mark a call-to-action rather than a brand name. */
const CTA_TEXT_RE =
  /^(visit|view|shop|browse|learn|read|click|see|contact|call|email|download|explore|discover|find|get|request|schedule|book|order|buy|start|sign|log|subscribe|follow|share|watch|open|close|search|go)\b/i;

/** Trailing facet counts the sidebar renders: "Kohler (12)" / "Kohler 12". */
const TRAILING_COUNT_RE = /\s*[([]?\s*\d+\s*[)\]]?\s*$/;

const MIN_LEN = 2;
const MAX_LEN = 60;

/** True when this URL is a same-domain brand facet / brand landing link. */
function isBrandFacetUrl(u: URL): boolean {
  for (const [key, value] of u.searchParams) {
    if (BRAND_PARAM_RE.test(key) && value.trim()) return true;
  }
  return BRAND_PATH_RE.test(u.pathname);
}

/**
 * Clean a label into a brand name, or null when it is not one. Strips the facet
 * count, decodes the HTML entities the raw regex extractor leaves behind
 * (`AB&amp;A` -> `AB&A`), and rejects chrome/CTAs/numerics.
 */
function cleanBrandText(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw)
    .replace(TRAILING_COUNT_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < MIN_LEN || text.length > MAX_LEN) return null;
  if (NON_BRAND_TEXT_RE.test(text)) return null;
  if (CTA_TEXT_RE.test(text)) return null;
  // No letters at all — a phone number, a count, punctuation.
  if (!/[a-z]/i.test(text)) return null;
  return text;
}

/**
 * The link extractor strips tags but not entities, so brand names arrive as
 * `AB&amp;A` / `Alson&#8217;s`. Named entities cover the handful that show up;
 * the numeric branch handles BOTH decimal (`&#8217;`) and hex (`&#x2019;`) —
 * hex is what many CMS templates emit, and decimal-only would leave the raw
 * `&#x2019;` sitting inside a brand name.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex: string, dec: string) => {
      const code = hex ? parseInt(hex, 16) : Number(dec);
      // Guard fromCodePoint: a malformed entity (&#1114112;) would throw
      // RangeError and take the whole scrape's brand extraction with it.
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
}

/** The brand's homepage — origin only; the deep path is this store's affiliate link. */
function brandHomepage(u: URL): string {
  return `${u.protocol}//${u.hostname}`;
}

function isSameSite(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

/**
 * Extract brands from one page's links.
 *
 * @param pageUrl  the page these links came from — gates pattern 2
 * @param links    the page's `<a>` set, href + anchor text
 * @param siteHost the store's own website host
 */
export function extractBrandFacets(
  pageUrl: string,
  links: Iterable<{ href: string; text?: string; imageUrl?: string; imageAlt?: string }>,
  siteHost: string,
): BrandCandidate[] {
  const base = siteHost.replace(/^www\./i, "").toLowerCase();

  let isDirectory = false;
  try {
    isDirectory = BRAND_DIRECTORY_RE.test(new URL(pageUrl).pathname);
  } catch {
    /* unparseable page url — pattern 1 only */
  }

  const byLower = new Map<string, BrandCandidate>();
  /** name OR domain -> the key under which that brand is stored in `byLower`. */
  const aliasToKey = new Map<string, string>();

  for (const link of links) {
    if (!link?.href) continue;

    let u: URL;
    try {
      u = new URL(link.href);
    } catch {
      continue;
    }
    // Kills tel:/mailto: — Rubenstein's directory is littered with phone links.
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;

    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const sameSite = isSameSite(host, base);

    let candidate: BrandCandidate | null = null;

    // Anchor text first, then the image's alt. On a logo wall the alt IS the
    // brand name and costs nothing — it was being thrown away with the <img>.
    const label = cleanBrandText(link.text) ?? cleanBrandText(link.imageAlt);
    const logoUrl = link.imageUrl ?? null;

    if (sameSite) {
      // Pattern 1 — the ?brand= param is its own proof, on any page.
      if (isBrandFacetUrl(u)) {
        if (label) {
          candidate = {
            name: label,
            websiteUrl: null,
            logoUrl,
            sourceUrl: pageUrl,
            extractionMethod: "filter_bar",
          };
        }
      }
    } else if (isDirectory) {
      // Pattern 2 — off-domain link ON a brand-directory page.
      if (NON_BRAND_HOST_RE.test(host)) continue;
      // A logo with no label is STILL a capture: the href is the brand's site
      // and the img is its logo. Naming it later is cheap; re-finding it is not.
      if (label || logoUrl) {
        candidate = {
          name: label,
          websiteUrl: brandHomepage(u),
          logoUrl,
          sourceUrl: pageUrl,
          extractionMethod: label ? "directory_link" : "logo_link",
        };
      }
    }

    if (!candidate) continue;

    // A brand can be seen twice with DIFFERENT fields — once as a bare logo
    // (site + logo, no name) and once as a text link (name, no logo). Keying on
    // only one of those means the two never merge and the brand lands twice.
    // So index under BOTH identities and resolve through an alias map.
    const nameKey = candidate.name?.toLowerCase() ?? null;
    const domainKey = candidate.websiteUrl
      ? new URL(candidate.websiteUrl).hostname.replace(/^www\./i, "").toLowerCase()
      : null;
    if (!nameKey && !domainKey) continue;

    const existingKey =
      (nameKey && aliasToKey.get(nameKey)) || (domainKey && aliasToKey.get(domainKey)) || null;

    if (!existingKey) {
      const key = nameKey ?? domainKey!;
      byLower.set(key, candidate);
      if (nameKey) aliasToKey.set(nameKey, key);
      if (domainKey) aliasToKey.set(domainKey, key);
      continue;
    }

    // Merge rather than replace: different pages reveal different fields, and
    // dropping one loses data we already paid to fetch.
    const prior = byLower.get(existingKey)!;
    const merged: BrandCandidate = {
      ...prior,
      name: prior.name ?? candidate.name,
      websiteUrl: prior.websiteUrl ?? candidate.websiteUrl,
      logoUrl: prior.logoUrl ?? candidate.logoUrl,
      // A named capture is a better provenance record than a bare logo.
      extractionMethod: prior.name ? prior.extractionMethod : candidate.extractionMethod,
    };
    byLower.set(existingKey, merged);
    // Newly-learned aliases point at the same record.
    if (nameKey) aliasToKey.set(nameKey, existingKey);
    if (domainKey) aliasToKey.set(domainKey, existingKey);
  }

  return [...byLower.values()];
}
