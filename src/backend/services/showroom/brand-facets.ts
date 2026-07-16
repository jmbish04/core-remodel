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

/** A brand recovered from a page, with its website when the link revealed one. */
export interface FacetBrand {
  name: string;
  /** The manufacturer's own site (pattern 2), else null (pattern 1). */
  websiteUrl: string | null;
}

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
 * `AB&amp;A` / `Alson&#8217;s`. Only the handful that actually show up.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "’")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
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
  links: Iterable<{ href: string; text?: string }>,
  siteHost: string,
): FacetBrand[] {
  const base = siteHost.replace(/^www\./i, "").toLowerCase();

  let isDirectory = false;
  try {
    isDirectory = BRAND_DIRECTORY_RE.test(new URL(pageUrl).pathname);
  } catch {
    /* unparseable page url — pattern 1 only */
  }

  const byLower = new Map<string, FacetBrand>();

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

    let candidate: FacetBrand | null = null;

    if (sameSite) {
      // Pattern 1 — the ?brand= param is its own proof, any page.
      if (isBrandFacetUrl(u)) {
        const name = cleanBrandText(link.text);
        if (name) candidate = { name, websiteUrl: null };
      }
    } else if (isDirectory) {
      // Pattern 2 — off-domain link ON a brand-directory page.
      if (NON_BRAND_HOST_RE.test(host)) continue;
      const name = cleanBrandText(link.text);
      if (name) candidate = { name, websiteUrl: brandHomepage(u) };
    }

    if (!candidate) continue;
    const key = candidate.name.toLowerCase();
    const prior = byLower.get(key);
    if (!prior) byLower.set(key, candidate);
    // Prefer the entry that carries a website over one that doesn't.
    else if (!prior.websiteUrl && candidate.websiteUrl) byLower.set(key, candidate);
  }

  return [...byLower.values()];
}
