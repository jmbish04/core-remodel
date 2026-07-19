/**
 * @fileoverview HeroLinkButtons — the hero's large, tappable link row.
 *
 * Sized for a Tesla touchscreen: every control is a 48px-tall target, which is
 * the whole point of this row existing rather than the old text hyperlinks.
 *
 *   [ 🌐 Website ] [ ig ] [ x ] [ in ] [ f ] [ p ] [ yelp ] [ 360 ] [ 📷 ] [ 🔗 Links ]
 *
 * Layout:
 *   1. Website — a wide primary button, opens in a new tab. Omitted entirely
 *      when the store has no WEBSITE link.
 *   2. One same-size icon button per link type ACTUALLY present in
 *      `showroom_store_links`. A type with no row renders nothing, so the row
 *      is built from what the store really has rather than a fixed grid.
 *   3. "Links" — opens the link list modal (view every URL, or switch to the
 *      add/edit form).
 *
 * Icon set: the five social glyphs are reused from SocialLinks (single source
 * of truth); the non-social types get lucide glyphs.
 */

import type { ComponentType } from "react";
import { Camera, Globe, Link2, Star, Tag, View } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "src/frontend/lib/utils";

import { LINK_TYPE_LABELS, asLinkType, type LinkType } from "../intake/LinksField";
import { SOCIAL_CONFIG, SOCIAL_LINK_TYPES, absoluteHref, type StoreLink } from "./SocialLinks";

/** Shared tap-target sizing — 48px square/tall, per the in-car touch target. */
const TAP = "h-12 min-w-12";

/**
 * Icon per link type, in the order the row renders them. `WEBSITE` is absent
 * on purpose — it gets its own wide button ahead of this row. Socials come from
 * SOCIAL_CONFIG so the two rows can never disagree on a glyph.
 */
const LINK_ICONS: Partial<Record<LinkType, ComponentType<{ className?: string }>>> = {
  INSTAGRAM: SOCIAL_CONFIG.INSTAGRAM.Icon,
  TWITTER_X: SOCIAL_CONFIG.TWITTER_X.Icon,
  LINKEDIN: SOCIAL_CONFIG.LINKEDIN.Icon,
  FACEBOOK: SOCIAL_CONFIG.FACEBOOK.Icon,
  PINTEREST: SOCIAL_CONFIG.PINTEREST.Icon,
  YELP: Star,
  SHOWROOM_TOUR: View,
  SHOWROOM_PHOTOS: Camera,
  WEBSITE_CLEARANCE: Tag,
};

/** Display order: socials first (matching SocialLinks), then the rest. */
const ICON_ORDER: LinkType[] = [
  ...SOCIAL_LINK_TYPES,
  "YELP",
  "SHOWROOM_TOUR",
  "SHOWROOM_PHOTOS",
  "WEBSITE_CLEARANCE",
];

export function HeroLinkButtons({
  links,
  onOpenLinks,
}: {
  links: StoreLink[] | null | undefined;
  /** Opens the links modal (list view, with a pencil into the edit form). */
  onOpenLinks: () => void;
}) {
  const rows = links ?? [];
  const firstOfType = (type: LinkType) =>
    absoluteHref(rows.find((l) => asLinkType(l.type) === type)?.url);

  const websiteHref = firstOfType("WEBSITE");

  const iconLinks = ICON_ORDER.flatMap((type) => {
    const href = firstOfType(type);
    const Icon = LINK_ICONS[type];
    if (!href || !Icon) return [];
    return [{ type, href, Icon, label: LINK_TYPE_LABELS[type] }];
  });

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {websiteHref ? (
        <a
          href={websiteHref}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ size: "lg" }), TAP, "gap-2 px-5 text-base")}
        >
          <Globe className="size-5" /> Website
        </a>
      ) : null}

      {iconLinks.map(({ type, href, Icon, label }) => (
        <a
          key={type}
          href={href}
          target="_blank"
          rel="noreferrer"
          title={label}
          aria-label={label}
          className={cn(buttonVariants({ variant: "outline", size: "icon" }), TAP)}
        >
          <Icon className="size-5" />
        </a>
      ))}

      <Button
        variant="outline"
        size="icon"
        className={TAP}
        onClick={onOpenLinks}
        title="All links"
        aria-label="All links"
      >
        <Link2 className="size-5" />
      </Button>
    </div>
  );
}
