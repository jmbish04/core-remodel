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
 * Types map to the `showroom_store_links.type` enum; anything social but outside
 * the enum (YouTube/TikTok/LinkedIn/Houzz/Yelp/X) lands as OTHER + `urlNotes`.
 */

export type ShowroomLinkType = "WEBSITE" | "INSTAGRAM" | "PINTEREST" | "FACEBOOK" | "OTHER";

export interface ClassifiedLink {
  type: ShowroomLinkType;
  url: string;
  urlNotes: string | null;
}

/** Share / intent / auth endpoints — a "share this page" widget, never a profile. */
const NON_PROFILE_PATH_RE =
  /^\/(sharer|share|share\.php|dialog|intent|pin\/create|shareArticle|submit|login|signup|help|about|policy|privacy|terms|legal|explore|search|hashtag|p|reel|reels|posts|watch|events|marketplace|groups|tr)(\/|$)/i;

const SOCIAL_HOSTS: Array<{ re: RegExp; type: ShowroomLinkType; notes?: string }> = [
  { re: /^instagram\.com$/i, type: "INSTAGRAM" },
  { re: /^facebook\.com$/i, type: "FACEBOOK" },
  { re: /^fb\.com$/i, type: "FACEBOOK" },
  { re: /^pinterest\.(com|[a-z]{2}|co\.[a-z]{2})$/i, type: "PINTEREST" },
  { re: /^youtube\.com$/i, type: "OTHER", notes: "YouTube" },
  { re: /^youtu\.be$/i, type: "OTHER", notes: "YouTube" },
  { re: /^tiktok\.com$/i, type: "OTHER", notes: "TikTok" },
  { re: /^linkedin\.com$/i, type: "OTHER", notes: "LinkedIn" },
  { re: /^houzz\.com$/i, type: "OTHER", notes: "Houzz" },
  { re: /^yelp\.com$/i, type: "OTHER", notes: "Yelp" },
  { re: /^x\.com$/i, type: "OTHER", notes: "X" },
  { re: /^twitter\.com$/i, type: "OTHER", notes: "X" },
];

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

  const path = u.pathname.replace(/\/+$/, "");
  // Bare platform root (instagram.com/) — a logo link, not a profile.
  if (!path) return null;
  if (NON_PROFILE_PATH_RE.test(path)) return null;

  u.protocol = "https:";
  u.hostname = host;
  u.hash = "";
  u.search = "";
  const url = u.toString().replace(/\/+$/, "");

  return { type: entry.type, url, urlNotes: entry.notes ?? null };
}

/**
 * Classify + de-duplicate a set of hrefs into social profile links.
 * Dedupes on (type, url) case-insensitively.
 */
export function collectSocialLinks(hrefs: Iterable<string | null | undefined>): ClassifiedLink[] {
  const byKey = new Map<string, ClassifiedLink>();
  for (const href of hrefs) {
    if (!href) continue;
    const classified = classifySocialLink(href);
    if (!classified) continue;
    const key = `${classified.type}:${classified.url.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, classified);
  }
  return [...byKey.values()];
}
