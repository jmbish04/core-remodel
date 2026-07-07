/**
 * @fileoverview SocialLinks — icon row for a showroom's social profiles.
 *
 * Renders one icon link per configured social URL (Instagram, Facebook,
 * Pinterest — the columns on `showroom_stores`), muted-to-foreground on hover.
 * Renders nothing when no social URL is set. Pinterest has no lucide glyph, so
 * all three are consistent inline SVGs (currentColor, 24-unit viewBox).
 */

// ─── Inline brand glyphs (fill: currentColor) ─────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

/** Normalize a possibly-schemeless URL value into an absolute https URL. */
function absoluteHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

export interface SocialLinksProps {
  instagramUrl: string | null | undefined;
  facebookUrl: string | null | undefined;
  pinterestUrl: string | null | undefined;
  /** Icon sizing class (default size-4). */
  iconClassName?: string;
}

/**
 * Icon row for the showroom's social profiles. Only renders links whose URL is
 * present in D1; renders nothing at all when every social column is empty.
 */
export function SocialLinks({
  instagramUrl,
  facebookUrl,
  pinterestUrl,
  iconClassName = "size-4",
}: SocialLinksProps) {
  const links = [
    { label: "Instagram", href: absoluteHref(instagramUrl), Icon: InstagramIcon },
    { label: "Facebook", href: absoluteHref(facebookUrl), Icon: FacebookIcon },
    { label: "Pinterest", href: absoluteHref(pinterestUrl), Icon: PinterestIcon },
  ].filter((l): l is typeof l & { href: string } => Boolean(l.href));

  if (links.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      {links.map(({ label, href, Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={label}
          title={label}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon className={iconClassName} />
        </a>
      ))}
    </div>
  );
}
