/**
 * @fileoverview SocialLinks — icon row for a showroom's social profiles.
 *
 * Driven by the store's `showroom_store_links` rows, NOT by flat columns: one
 * icon per link whose `type` is a social type, in the order declared by
 * `SOCIAL_LINK_TYPES`. A type with no link in the table renders nothing, so the row
 * is built dynamically from whatever the store actually has. Renders nothing at
 * all when the store has no social links.
 *
 * Each icon links out in a new tab and is labelled with the @handle parsed off
 * the URL (falling back to the network name when no handle can be read).
 * Pinterest / X / LinkedIn have no lucide glyphs, so all five are consistent
 * inline SVGs (currentColor, 24-unit viewBox).
 */

import type { ReactElement } from "react";

// ─── Inline brand glyphs (currentColor) ───────────────────────────────────────

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function PinterestIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.24 2.64 7.86 6.36 9.31-.09-.79-.17-2.01.03-2.87.19-.78 1.2-4.97 1.2-4.97s-.31-.61-.31-1.52c0-1.42.83-2.48 1.86-2.48.88 0 1.3.66 1.3 1.44 0 .88-.56 2.2-.85 3.42-.24 1.02.51 1.85 1.52 1.85 1.82 0 3.22-1.92 3.22-4.69 0-2.45-1.76-4.17-4.28-4.17-2.91 0-4.62 2.19-4.62 4.44 0 .88.34 1.83.76 2.34a.3.3 0 0 1 .07.29c-.08.32-.25 1.02-.29 1.16-.04.19-.15.23-.35.14-1.3-.6-2.11-2.5-2.11-4.02 0-3.27 2.38-6.28 6.86-6.28 3.6 0 6.4 2.57 6.4 6 0 3.58-2.26 6.46-5.39 6.46-1.05 0-2.04-.55-2.38-1.19l-.65 2.47c-.23.91-.87 2.04-1.29 2.73.98.3 2.01.46 3.09.46 5.52 0 10-4.48 10-10S17.52 2 12 2z" />
    </svg>
  );
}

/** The post-rebrand X mark (the "bird" is retired branding). */
function TwitterXIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1 0-4.124 2.062 2.062 0 0 1 0 4.124zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

// ─── Types + config ───────────────────────────────────────────────────────────

/**
 * The link types this row renders, in display order. Mirrors the backend's
 * `SOCIAL_LINK_TYPES` (@backend/utils/showroom-links) — deliberately duplicated
 * rather than imported, because that module pulls drizzle + the D1 schema in
 * with it and this is a browser bundle. Display order is a UI concern anyway.
 */
export const SOCIAL_LINK_TYPES = [
  "INSTAGRAM",
  "TWITTER_X",
  "LINKEDIN",
  "FACEBOOK",
  "PINTEREST",
] as const;

export type SocialLinkType = (typeof SOCIAL_LINK_TYPES)[number];

interface SocialConfig {
  network: string;
  Icon: (props: { className?: string }) => ReactElement;
}

export const SOCIAL_CONFIG: Record<SocialLinkType, SocialConfig> = {
  INSTAGRAM: { network: "Instagram", Icon: InstagramIcon },
  TWITTER_X: { network: "X", Icon: TwitterXIcon },
  LINKEDIN: { network: "LinkedIn", Icon: LinkedInIcon },
  FACEBOOK: { network: "Facebook", Icon: FacebookIcon },
  PINTEREST: { network: "Pinterest", Icon: PinterestIcon },
};

function isSocialType(t: string): t is SocialLinkType {
  return (SOCIAL_LINK_TYPES as readonly string[]).includes(t);
}

/** A store link as served by GET /api/showroom-stores/:id. */
export interface StoreLink {
  url: string;
  type: string;
}

// ─── URL → @handle ────────────────────────────────────────────────────────────

/** Normalize a possibly-schemeless URL value into an absolute https URL. */
export function absoluteHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Path segments that are never a handle — LinkedIn and Facebook namespace their
 * profiles behind one of these, so the handle is the segment AFTER it.
 */
const NAMESPACE_SEGMENTS = new Set(["company", "in", "school", "pages", "profile", "people"]);

/**
 * Parse the @handle out of a profile URL, e.g.
 *   https://instagram.com/davincimarble/      → "@davincimarble"
 *   https://www.linkedin.com/company/acme-co  → "@acme-co"
 *   https://x.com/acme?ref=nav                → "@acme"
 *
 * Returns null when there's no usable handle segment (e.g. a bare
 * "https://facebook.com" or a deep permalink), and the caller falls back to the
 * network name.
 */
export function handleFromUrl(url: string): string | null {
  let path: string;
  try {
    path = new URL(absoluteHref(url) as string).pathname;
  } catch {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // Skip a leading namespace segment ("company", "in", …) to reach the handle.
  const first = segments[0].toLowerCase();
  const handle = NAMESPACE_SEGMENTS.has(first) ? segments[1] : segments[0];
  if (!handle) return null;

  const clean = decodeURIComponent(handle).replace(/^@/, "").trim();
  // Reject file-ish / permalink-ish segments rather than showing "@posts.php".
  if (!clean || /\.(php|html?|aspx?)$/i.test(clean)) return null;
  return `@${clean}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface SocialLinksProps {
  /** The store's full link set; non-social types are ignored. */
  links: StoreLink[] | null | undefined;
  /** Icon sizing class (default size-4). */
  iconClassName?: string;
}

/**
 * Icon row for the showroom's social profiles, built from `showroom_store_links`.
 * Only types actually present in the table render; the row disappears entirely
 * when the store has no social links.
 */
export function SocialLinks({ links, iconClassName = "size-4" }: SocialLinksProps) {
  const resolved = SOCIAL_LINK_TYPES.flatMap((type) => {
    const match = (links ?? []).find((l) => isSocialType(l.type) && l.type === type);
    const href = absoluteHref(match?.url);
    if (!href) return [];
    const { network, Icon } = SOCIAL_CONFIG[type];
    const label = handleFromUrl(href) ?? network;
    return [{ type, href, network, label, Icon }];
  });

  if (resolved.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {resolved.map(({ type, href, network, label, Icon }) => (
        <a
          key={type}
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${network}: ${label}`}
          title={`${network} · ${label}`}
          className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon className={`${iconClassName} shrink-0`} />
          <span className="max-w-[12ch] truncate text-[13px]">{label}</span>
        </a>
      ))}
    </div>
  );
}
