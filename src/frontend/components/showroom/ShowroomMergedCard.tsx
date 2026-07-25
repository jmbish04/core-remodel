/**
 * @fileoverview ShowroomMergedCard — one canonical showroom card that merges the
 * beste.co Travel11 (horizontal: square hero left, name/location/rating, mono
 * price) and Location6 (open/closed/closing-soon status chip + clever hours line
 * + category dot) reference designs into the Monolith dark aesthetic.
 *
 * Used by BOTH the List tab (full density) and the Directory tab (compact). It is
 * data-driven off the normalized `store.hours` rows via `computeShowroomStatus`.
 *
 * Pure presentational: it takes a minimal `ShowroomCardData` shape (a structural
 * subset of the app's `Store`) plus the current PST snapshot, so it has no
 * dependency on the app module and stays trivially testable.
 */

import {
  Globe,
  Instagram,
  MapPin,
  Phone,
  Star,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import {
  computeShowroomStatus,
  type HourRow,
  type PstNow,
  type ShowroomStatus,
} from "./hours-status";

/** The minimal store shape the card consumes (structural subset of `Store`). */
export interface ShowroomCardData {
  id: number;
  name: string;
  cityName: string | null;
  hubName: string | null;
  pricePoint: "$" | "$$" | "$$$" | "$$$$" | null;
  categories: string[];
  /** Business-model type (joined from showroom_store_type); null = untyped. */
  typeName?: string | null;
  typeColor?: string | null;
  heroImageCfImagesUrl: string | null;
  iconCfImagesUrl: string | null;
  hours: HourRow[];
  googleRating: number | null;
  onlineRating: number | null;
  userRatingCount: number | null;
  onlineRatingCount: number;
  userRating: number | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  isAppointmentOnly: boolean;
  isFlagshipLocation: boolean;
  isLargeSelection: boolean;
  isBespoke: boolean;
  isTradeRepRequired: boolean;
}

// ── status chip styling (Location6 palette, Monolith dark) ──────────────────────
const STATUS_CHIP: Record<ShowroomStatus, string> = {
  open: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  closed: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
  "closing-soon": "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
};

const STATUS_LABEL: Record<ShowroomStatus, string> = {
  open: "Open",
  closed: "Closed",
  "closing-soon": "Closing soon",
};

/** Format a US 10/11-digit number for display, e.g. "(415) 555-1234". */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** tel: href — strip to dialable characters (digits + leading +). */
export function telHrefFor(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, "")}`;
}

/** Format a review count compactly, e.g. 1234 → "1.2k". */
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
}

/** Deterministic initials-avatar tint (JIT-safe class list). */
const AVATAR_TINTS = [
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-sky-500/20 text-sky-300",
  "bg-violet-500/20 text-violet-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-lime-500/20 text-lime-300",
];

function avatarTint(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

/** Hero image, or the icon favicon, or an initials avatar — always object-cover. */
function CardHero({
  store,
  className,
}: {
  store: ShowroomCardData;
  className?: string;
}) {
  const src = store.heroImageCfImagesUrl ?? store.iconCfImagesUrl;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn("size-full object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex size-full items-center justify-center text-base font-semibold",
        avatarTint(store.name),
        className,
      )}
    >
      {store.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

/** One intake-flag pill (ring-based, no hard borders). */
function FlagPill({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
        className,
      )}
    >
      {label}
    </span>
  );
}

function FlagPills({ store }: { store: ShowroomCardData }) {
  const flags: { on: boolean; label: string; className: string }[] = [
    { on: store.isAppointmentOnly, label: "Appt req'd", className: "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30" },
    { on: store.isFlagshipLocation, label: "Flagship", className: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30" },
    { on: store.isLargeSelection, label: "Large collection", className: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30" },
    { on: store.isBespoke, label: "Bespoke", className: "bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-fuchsia-500/30" },
    { on: store.isTradeRepRequired, label: "Trade rep req'd", className: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30" },
  ].filter((f) => f.on);
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <FlagPill key={f.label} label={f.label} className={f.className} />
      ))}
    </div>
  );
}

/** Google rating + review count, then the user's own visit rating. */
function RatingsRow({ store }: { store: ShowroomCardData }) {
  const gRating = store.googleRating ?? store.onlineRating;
  const gCount = store.userRatingCount ?? store.onlineRatingCount ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {gRating !== null && (
        <span className="inline-flex items-center gap-1">
          <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
          <span className="font-semibold text-card-foreground">{gRating.toFixed(1)}</span>
          {gCount > 0 && (
            <span className="text-muted-foreground">({fmtCount(gCount)})</span>
          )}
        </span>
      )}
      {store.userRating !== null ? (
        <span className="inline-flex items-center gap-1">
          <Star className="size-3.5 fill-sky-400 text-sky-400" aria-hidden="true" />
          <span className="font-semibold text-card-foreground">
            {store.userRating.toFixed(1)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Your rating
          </span>
        </span>
      ) : (
        <Badge
          variant="outline"
          className="px-1.5 py-0 text-[9px] font-normal text-muted-foreground"
        >
          Not yet visited
        </Badge>
      )}
    </div>
  );
}

/** Status chip + clever hours label; hidden entirely when no hours exist. */
function StatusRow({
  store,
  pst,
  className,
}: {
  store: ShowroomCardData;
  pst: PstNow;
  className?: string;
}) {
  const status = computeShowroomStatus(store.hours, pst);
  if (!status) return null;
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
          STATUS_CHIP[status.status],
        )}
      >
        {STATUS_LABEL[status.status]}
      </span>
      <span className="truncate text-muted-foreground">{status.label}</span>
    </div>
  );
}

/** Contact links — full spelled-out phone as a tel: link, plus website/instagram. */
function ContactLinks({
  store,
  className,
}: {
  store: ShowroomCardData;
  className?: string;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (!store.phoneNumber && !store.websiteUrl && !store.instagramUrl) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]",
        className,
      )}
    >
      {store.phoneNumber && (
        <a
          href={telHrefFor(store.phoneNumber)}
          onClick={stop}
          className="relative z-10 inline-flex items-center gap-1.5 font-medium text-sky-400 hover:text-sky-300"
        >
          <Phone className="size-3.5" aria-hidden="true" />
          {formatPhoneDisplay(store.phoneNumber)}
        </a>
      )}
      {store.websiteUrl && (
        <a
          href={store.websiteUrl}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          aria-label="Website"
          className="relative z-10 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Globe className="size-3.5" aria-hidden="true" />
        </a>
      )}
      {store.instagramUrl && (
        <a
          href={store.instagramUrl}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          aria-label="Instagram"
          className="relative z-10 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Instagram className="size-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

/**
 * The merged card.
 *
 * `compact` renders the tighter Directory variant (smaller hero, category/flags
 * trimmed) while keeping identical data bindings.
 */
export function ShowroomMergedCard({
  store,
  pst,
  href,
  compact = false,
}: {
  store: ShowroomCardData;
  pst: PstNow;
  href: string;
  compact?: boolean;
}) {
  const location = store.cityName ?? store.hubName;
  const category = store.categories[0] ?? null;

  return (
    <article
      className={cn(
        "group relative flex overflow-hidden rounded-xl bg-card ring-1 ring-border/40 transition-colors hover:bg-muted/40",
      )}
    >
      {/* Hero */}
      <div
        className={cn(
          "relative shrink-0 self-stretch",
          compact ? "w-20" : "w-28 sm:w-32",
        )}
      >
        <CardHero store={store} />
        {store.pricePoint && (
          <span className="absolute bottom-1 right-1 rounded-full bg-background/80 px-1.5 font-mono text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/40 backdrop-blur">
            {store.pricePoint}
          </span>
        )}
      </div>

      {/* Body */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-between gap-2",
          compact ? "p-3" : "p-4",
        )}
      >
        <div className="flex flex-col gap-1">
          {/* Stretched link makes the whole card clickable; inner links opt out via z-10. */}
          <a
            href={href}
            className="line-clamp-1 text-sm font-semibold text-card-foreground after:absolute after:inset-0 after:content-['']"
          >
            {store.name}
          </a>

          {location && (
            <span className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              {location}
            </span>
          )}

          <RatingsRow store={store} />

          {category && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="size-1 rounded-full bg-muted-foreground/40"
                aria-hidden="true"
              />
              {category}
              {store.categories.length > 1 && (
                <span className="text-muted-foreground/60">
                  +{store.categories.length - 1}
                </span>
              )}
            </span>
          )}

          {store.typeName && (
            <span
              className="inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-medium"
              style={
                store.typeColor
                  ? {
                      backgroundColor: `${store.typeColor}1f`,
                      color: store.typeColor,
                      borderColor: `${store.typeColor}55`,
                    }
                  : undefined
              }
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: store.typeColor ?? "currentColor" }}
                aria-hidden="true"
              />
              {store.typeName}
            </span>
          )}

          <StatusRow store={store} pst={pst} className="mt-0.5" />
        </div>

        <div className="flex flex-col gap-2">
          {!compact && <FlagPills store={store} />}
          <ContactLinks store={store} />
        </div>
      </div>
    </article>
  );
}
