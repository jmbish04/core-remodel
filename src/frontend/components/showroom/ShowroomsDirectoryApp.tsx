/**
 * @fileoverview ShowroomsDirectoryApp — Bay Area Showroom Directory
 *
 * One canonical showroom card (`ShowroomCard`) is used across all three views:
 *   - Map       → map on top, cards stacked below (mobile-friendly)
 *   - List      → cards grouped by category
 *   - Directory → cards grouped by city / location (quick contact sheet)
 *
 * The card surfaces: a rounded logo placeholder (category-type icon, or a
 * deterministic colored circle with initials when uncategorized), a floating
 * price badge, a flagship badge, category badges, the city name (never the hub
 * letter), online + personal ("your visit") ratings, a three-column hours
 * footer with live "closing soon / closed / open-late" cues, and click-to-call
 * / click-to-email contact links.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  Archive,
  Armchair,
  Blocks,
  CalendarClock,
  ChevronDown,
  Clock,
  DoorOpen,
  Droplets,
  Filter,
  Flame,
  Globe,
  Grid3x3,
  Instagram,
  Layers,
  LayoutList,
  Lightbulb,
  Loader2,
  Mail,
  Map as MapIcon,
  MapPin,
  Moon,
  PaintBucket,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Star,
  Store as StoreIcon,
  Users,
  Utensils,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Map as GeoMap,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
} from "@/components/ui/map";
// ─── Types ────────────────────────────────────────────────────────────────────

interface Store {
  id: number;
  name: string;
  description: string | null;
  pricePoint: "$" | "$$" | "$$$" | "$$$$" | null;
  inventoryFocus: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
  categories: string[];
  /** Aggregated external review-platform rating (Yelp/Google/etc). */
  onlineRating: number | null;
  onlineRatingCount: number;
  /** Homeowner's own visit rating; null → not yet visited. */
  userRating: number | null;
  isAppointmentOnly: boolean;
  isFlagshipLocation: boolean;
  weekdayHours: string | null;
  weekendHours: string | null;
  isOpenWeekends: boolean;
  websiteUrl: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  locationAddress: string | null;
  scale: string | null;
  instagramUrl: string | null;
  iconCfImagesUrl: string | null;
}

interface Category {
  id: number;
  name: string;
}

interface City {
  id: number;
  bayAreaCityName: string;
  hubRoute: string | null;
  hubName: string | null;
}

type ViewMode = "map" | "list" | "directory";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUBS: Record<string, { name: string; lng: number; lat: number }> = {
  A: { name: "SF Design District", lng: -122.4194, lat: 37.7749 },
  B: { name: "Silicon Valley & South Bay", lng: -121.8863, lat: 37.3382 },
  C: { name: "Peninsula / Mid-Market", lng: -122.2603, lat: 37.5072 },
  D: { name: "East Bay", lng: -122.2712, lat: 37.8044 },
  E: { name: "North Bay", lng: -122.545, lat: 37.906 },
};

/** Short region label per hub — filters & markers show this, never the letter. */
const HUB_LABEL: Record<string, string> = {
  A: "SF",
  B: "South Bay",
  C: "Peninsula",
  D: "East Bay",
  E: "North Bay",
};

const PRICE_POINTS = ["$", "$$", "$$$", "$$$$"] as const;

/** Literal Tailwind classes (JIT-safe) for the initials fallback avatar. */
const AVATAR_COLORS = [
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-sky-500/20 text-sky-300",
  "bg-violet-500/20 text-violet-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-lime-500/20 text-lime-300",
];

// Keyword → category icon. First match across categories + inventory focus wins.
const CATEGORY_ICONS: { test: RegExp; Icon: ComponentType<{ className?: string }> }[] = [
  { test: /plumb|bath|faucet|sink|shower|tub|toilet|valve|steam|vanity/i, Icon: Droplets },
  { test: /light|led|lamp|chandelier|sconce/i, Icon: Lightbulb },
  { test: /window|sash|glaz/i, Icon: AppWindow },
  { test: /door|entry|pivot/i, Icon: DoorOpen },
  { test: /closet|wardrobe|storage|pantry|organiz/i, Icon: Archive },
  { test: /tile|porcelain|ceramic|slab|paver|mosaic/i, Icon: Grid3x3 },
  { test: /floor|wood|hardwood|vinyl|plank/i, Icon: Layers },
  { test: /kitchen|appliance|cook|range|oven|refriger|hood|induction|dishwash/i, Icon: Utensils },
  { test: /concrete|microcement|cement|masonry|plaster|stucco/i, Icon: Blocks },
  { test: /paint|color|finish/i, Icon: PaintBucket },
  { test: /fireplace|hearth/i, Icon: Flame },
  { test: /hardware|hinge|lock|handle|knob/i, Icon: Wrench },
];

/**
 * List-tab category-group header icons — colorful, semantic tints (POP, not muted).
 * Keyed by a keyword regex against the category-group label so it matches whatever
 * the backend names its categories (e.g. "Lighting", "Bath & Plumbing", "Tile / Stone").
 */
interface CategoryIconStyle {
  Icon: ComponentType<{ className?: string }>;
  className: string; // tint bg + fg
}

const CATEGORY_ICON_RULES: { test: RegExp; style: CategoryIconStyle }[] = [
  { test: /light|led|lamp|chandelier|sconce|illumin/i, style: { Icon: Lightbulb, className: "bg-amber-500/15 text-amber-400" } },
  { test: /plumb|bath|faucet|sink|shower|tub|toilet|valve|steam|vanity/i, style: { Icon: Droplets, className: "bg-sky-500/15 text-sky-400" } },
  { test: /tile|stone|porcelain|ceramic|slab|paver|mosaic|marble|quartz|granite/i, style: { Icon: Grid3x3, className: "bg-stone-400/15 text-stone-300" } },
  { test: /kitchen|appliance|cook|range|oven|refriger|hood|induction|dishwash/i, style: { Icon: Utensils, className: "bg-emerald-500/15 text-emerald-400" } },
  { test: /hardware|hinge|lock|handle|knob/i, style: { Icon: Wrench, className: "bg-orange-500/15 text-orange-400" } },
  { test: /door|entry|pivot/i, style: { Icon: DoorOpen, className: "bg-rose-500/15 text-rose-400" } },
  { test: /floor|wood|hardwood|vinyl|plank|laminate/i, style: { Icon: Layers, className: "bg-yellow-600/15 text-yellow-500" } },
  { test: /furnitur|sofa|seat|chair|cabinet|millwork/i, style: { Icon: Armchair, className: "bg-fuchsia-500/15 text-fuchsia-400" } },
  { test: /paint|color|finish/i, style: { Icon: PaintBucket, className: "bg-violet-500/15 text-violet-400" } },
  { test: /window|sash|glaz/i, style: { Icon: AppWindow, className: "bg-cyan-500/15 text-cyan-400" } },
  { test: /closet|wardrobe|storage|pantry|organiz/i, style: { Icon: Archive, className: "bg-lime-500/15 text-lime-400" } },
  { test: /concrete|microcement|cement|masonry|plaster|stucco/i, style: { Icon: Blocks, className: "bg-zinc-400/15 text-zinc-300" } },
  { test: /fireplace|hearth/i, style: { Icon: Flame, className: "bg-red-500/15 text-red-400" } },
];

const DEFAULT_CATEGORY_ICON: CategoryIconStyle = {
  Icon: StoreIcon,
  className: "bg-muted text-muted-foreground",
};

function categoryIconStyleFor(label: string): CategoryIconStyle {
  for (const { test, style } of CATEGORY_ICON_RULES) {
    if (test.test(label)) return style;
  }
  return DEFAULT_CATEGORY_ICON;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a US 10-digit phone as "(###) ### - ####". Any string that doesn't
 * reduce to exactly 10 digits is returned unchanged (still valid for a tel: link).
 */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)} - ${ten.slice(6)}`;
}

/** tel: href — strip to dialable characters (digits + leading +). */
function telHref(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, "")}`;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function categoryIconFor(store: Store): ComponentType<{ className?: string }> | null {
  const haystack = [...store.categories, store.inventoryFocus ?? ""].join(" ");
  for (const { test, Icon } of CATEGORY_ICONS) {
    if (test.test(haystack)) return Icon;
  }
  return store.categories.length > 0 ? StoreIcon : null;
}

// ── Hours parsing (free-text like "M-F 9AM-5PM", "Sat 10AM-4PM") ───────────────

const DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const STANDARD_CLOSE_MIN = 17 * 60; // 5:00 PM — anything later counts as "open late".

function parseTimeToMinutes(tok: string): number | null {
  const m = tok.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3].toLowerCase();
  if (mer === "p" && h !== 12) h += 12;
  if (mer === "a" && h === 12) h = 0;
  return h * 60 + min;
}

function parseHoursRange(text: string | null): { open: number; close: number } | null {
  if (!text) return null;
  const matches = text.match(/\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi);
  if (!matches || matches.length < 2) return null;
  const open = parseTimeToMinutes(matches[0]);
  const close = parseTimeToMinutes(matches[matches.length - 1]);
  if (open === null || close === null) return null;
  return { open, close };
}

type HoursState = "open" | "closing" | "closed" | "unknown";

function hoursColumnStatus(
  text: string | null,
  appliesToday: boolean,
  nowMin: number,
): { range: { open: number; close: number } | null; openLate: boolean; state: HoursState } {
  const range = parseHoursRange(text);
  const openLate = range ? range.close > STANDARD_CLOSE_MIN : false;
  let state: HoursState = "unknown";
  if (range && appliesToday) {
    if (nowMin >= range.close) state = "closed";
    else if (nowMin >= range.close - 60) state = "closing";
    else if (nowMin >= range.open) state = "open";
    else state = "unknown"; // before opening — no live badge
  }
  return { range, openLate, state };
}

interface PstNow {
  day: number; // 0 = Sun … 6 = Sat
  minutes: number; // minutes since midnight, PST
  label: string; // "2:45 PM"
}

function fmt12(min: number): string {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const mer = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${mer}`;
}

function computePst(): PstNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday").toLowerCase().slice(0, 3);
  let hour = parseInt(get("hour"), 10);
  if (hour === 24 || Number.isNaN(hour)) hour = 0;
  const minute = parseInt(get("minute"), 10) || 0;
  const minutes = hour * 60 + minute;
  return { day: DAY_INDEX[wd] ?? 0, minutes, label: fmt12(minutes) };
}

/**
 * Whether a weekend-hours string applies on the given PST day. "Sat 10AM-4PM"
 * applies only Saturday, "Sun …" only Sunday; a range naming both days, saying
 * "weekend"/"wknd", or naming no day at all applies to both. (Weekday hours are
 * assumed to apply on all weekdays — this guard is weekend-only.)
 */
function weekendHoursApplyToday(text: string | null, day: number): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const sat = t.includes("sat");
  const sun = t.includes("sun");
  if (t.includes("weekend") || t.includes("wknd") || (sat && sun) || (!sat && !sun)) return true;
  if (day === 6) return sat; // Saturday
  if (day === 0) return sun; // Sunday
  return false;
}

function isOpenNow(store: Store, pst: PstNow): boolean {
  if (store.isAppointmentOnly) return false;
  const isWeekday = pst.day >= 1 && pst.day <= 5;
  const text = isWeekday ? store.weekdayHours : store.weekendHours;
  if (!isWeekday && !weekendHoursApplyToday(text, pst.day)) return false;
  const range = parseHoursRange(text);
  if (!range) return false;
  return pst.minutes >= range.open && pst.minutes < range.close;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Rounded logo placeholder + floating price badge. */
function LogoBadge({ store }: { store: Store }) {
  const Icon = categoryIconFor(store);
  const [iconBroken, setIconBroken] = useState(false);
  const showFavicon = Boolean(store.iconCfImagesUrl) && !iconBroken;
  return (
    <div className="relative shrink-0">
      {showFavicon ? (
        <img
          src={store.iconCfImagesUrl as string}
          alt=""
          onError={() => setIconBroken(true)}
          className="size-11 rounded-full bg-card object-contain ring-1 ring-border/40"
        />
      ) : Icon ? (
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/60">
          <Icon className="size-5" />
        </div>
      ) : (
        <div
          className={`flex size-11 items-center justify-center rounded-full text-sm font-semibold ${avatarColor(store.name)}`}
        >
          {store.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      {store.pricePoint && (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-emerald-500/20 px-1 font-mono text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40">
          {store.pricePoint}
        </span>
      )}
    </div>
  );
}

function FlagshipBadge() {
  return (
    <Badge className="shrink-0 bg-amber-500/15 px-1.5 py-0 text-[9px] font-normal uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30">
      Flagship
    </Badge>
  );
}

function CategoryTags({ categories, max = 3 }: { categories: string[]; max?: number }) {
  if (!categories.length) return null;
  const shown = categories.slice(0, max);
  const overflow = categories.length - max;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <Badge key={c} variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
          {c}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-normal text-muted-foreground">
          +{overflow}
        </Badge>
      )}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`size-3 ${i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

/** Online avg rating placeholder + personal ("your visit") rating placeholder. */
function RatingRow({ store }: { store: Store }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">Online</span>
        {store.onlineRating !== null ? (
          <span className="flex items-center gap-1">
            <Stars rating={store.onlineRating} />
            <span className="text-[10px] text-muted-foreground">
              {store.onlineRating.toFixed(1)}
              {store.onlineRatingCount > 0 ? ` (${store.onlineRatingCount})` : ""}
            </span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/60">No reviews yet</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">You</span>
        {store.userRating !== null ? (
          <span className="flex items-center gap-1">
            <Stars rating={store.userRating} />
            <span className="text-[10px] text-muted-foreground">{store.userRating.toFixed(1)}</span>
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
    </div>
  );
}

/** A single hours column (weekday / weekend). */
function HoursColumn({
  label,
  text,
  appliesToday,
  nowMin,
  emptyBadge,
}: {
  label: string;
  text: string | null;
  appliesToday: boolean;
  nowMin: number;
  emptyBadge?: string;
}) {
  const { range, openLate, state } = hoursColumnStatus(text, appliesToday, nowMin);
  return (
    <div className="min-w-0">
      <div className="text-[8px] uppercase tracking-wider text-muted-foreground/60">{label}</div>
      {!text ? (
        emptyBadge ? (
          <span className="text-[10px] text-muted-foreground/70">{emptyBadge}</span>
        ) : (
          <span className="text-[10px] text-muted-foreground/40">—</span>
        )
      ) : (
        <div className="flex items-center gap-1">
          <span className="truncate text-[10px] text-muted-foreground">{text}</span>
          {openLate && (
            <Moon
              className="size-2.5 shrink-0 text-sky-400"
              aria-label="Open past 5 PM"
            />
          )}
        </div>
      )}
      {state === "closing" && (
        <span className="mt-0.5 inline-block rounded bg-amber-500/15 px-1 text-[8px] font-medium text-amber-300">
          Closing soon
        </span>
      )}
      {state === "closed" && (
        <span className="mt-0.5 inline-block rounded bg-rose-500/15 px-1 text-[8px] font-medium text-rose-300">
          Closed
        </span>
      )}
      {state === "open" && (
        <span className="mt-0.5 inline-block rounded bg-emerald-500/15 px-1 text-[8px] font-medium text-emerald-300">
          Open
        </span>
      )}
    </div>
  );
}

function HoursFooter({ store, pst, className }: { store: Store; pst: PstNow; className?: string }) {
  const isWeekday = pst.day >= 1 && pst.day <= 5;
  const weekendAppliesToday = !isWeekday && weekendHoursApplyToday(store.weekendHours, pst.day);
  return (
    <div className={`grid grid-cols-3 gap-2 ${className ?? ""}`}>
      <HoursColumn
        label="Mon–Fri"
        text={store.weekdayHours}
        appliesToday={isWeekday}
        nowMin={pst.minutes}
      />
      <HoursColumn
        label="Weekend"
        text={store.weekendHours}
        appliesToday={weekendAppliesToday}
        nowMin={pst.minutes}
        emptyBadge="No weekend hours"
      />
      <div className="flex items-start justify-end">
        {store.isAppointmentOnly ? (
          <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-medium text-violet-300">
            <CalendarClock className="size-3" />
            By appt
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Click-to-call / click-to-email / website links (stop card navigation). */
function ContactRow({ store, className }: { store: Store; className?: string }) {
  if (
    !store.phoneNumber &&
    !store.emailAddress &&
    !store.websiteUrl &&
    !store.instagramUrl
  )
    return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${className ?? ""}`}
    >
      {store.phoneNumber && (
        <a
          href={`tel:${store.phoneNumber.replace(/[^\d+]/g, "")}`}
          onClick={stop}
          className="relative z-10 inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
        >
          <Phone className="size-3" />
          {store.phoneNumber}
        </a>
      )}
      {store.emailAddress && (
        <a
          href={`mailto:${store.emailAddress}`}
          onClick={stop}
          className="relative z-10 inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
        >
          <Mail className="size-3" />
          Email
        </a>
      )}
      {store.websiteUrl && (
        <a
          href={store.websiteUrl}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          className="relative z-10 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Globe className="size-3" />
          Website
        </a>
      )}
      {store.instagramUrl && (
        <a
          href={store.instagramUrl}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          className="relative z-10 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Instagram className="size-3" />
          Instagram
        </a>
      )}
    </div>
  );
}

// ─── Canonical Showroom Card ───────────────────────────────────────────────────

function ShowroomCard({ store, pst }: { store: Store; pst: PstNow }) {
  return (
    <article className="group relative flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-border/40 transition-colors hover:bg-muted/40 sm:flex-row sm:items-stretch">
      {/* Left: identity + focus */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <LogoBadge store={store} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {/* Stretched link makes the whole card clickable; inner links opt out via z-10. */}
              <a
                href={`/admin/showroom/store/${store.id}`}
                className="line-clamp-1 text-sm font-medium after:absolute after:inset-0 after:content-['']"
              >
                {store.name}
              </a>
              {store.isFlagshipLocation && <FlagshipBadge />}
            </div>
            {store.cityName && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" />
                {store.cityName}
              </div>
            )}
            {store.categories.length > 0 && (
              <div className="mt-1.5">
                <CategoryTags categories={store.categories} max={5} />
              </div>
            )}
          </div>
        </div>

        <div className="mt-3">
          <RatingRow store={store} />
        </div>

        {store.inventoryFocus && (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{store.inventoryFocus}</p>
        )}

        <ContactRow store={store} className="mt-3" />
      </div>

      {/* Right: hours (fixed-ish width on desktop, full-width stacked on mobile) */}
      <div className="shrink-0 border-t border-border/40 pt-3 sm:w-64 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
        <HoursFooter store={store} pst={pst} />
      </div>
    </article>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stores }: { stores: Store[] }) {
  const stats = useMemo(() => {
    const hubCounts = new Map<string, number>();
    let ratedCount = 0;
    let ratingSum = 0;
    let flagshipCount = 0;

    for (const s of stores) {
      if (s.hubRoute) hubCounts.set(s.hubRoute, (hubCounts.get(s.hubRoute) ?? 0) + 1);
      if (s.onlineRating !== null) {
        ratedCount++;
        ratingSum += s.onlineRating;
      }
      if (s.isFlagshipLocation) flagshipCount++;
    }

    return {
      total: stores.length,
      hubCounts,
      avgRating: ratedCount > 0 ? Math.round((ratingSum / ratedCount) * 10) / 10 : null,
      flagshipCount,
    };
  }, [stores]);

  return (
    <div className="flex flex-wrap gap-4 rounded-lg bg-card p-3 text-xs ring-1 ring-border/40">
      <div>
        <span className="text-muted-foreground">Total</span>
        <span className="ml-1.5 font-semibold text-foreground">{stats.total}</span>
      </div>
      {Object.keys(HUBS).map((h) => (
        <div key={h}>
          <span className="text-muted-foreground">{HUB_LABEL[h]}</span>
          <span className="ml-1 font-semibold text-foreground">{stats.hubCounts.get(h) ?? 0}</span>
        </div>
      ))}
      <div>
        <span className="text-muted-foreground">Avg Online</span>
        <span className="ml-1.5 font-semibold text-foreground">
          {stats.avgRating !== null ? `${stats.avgRating}★` : "—"}
        </span>
      </div>
      <div>
        <span className="text-muted-foreground">Flagship</span>
        <span className="ml-1.5 font-semibold text-amber-400">{stats.flagshipCount}</span>
      </div>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface Filters {
  search: string;
  hub: string | null;
  categories: string[];
  pricePoint: string | null;
  minRating: number | null;
  appointmentOnly: boolean;
  flagship: boolean;
  openNow: boolean;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  hub: null,
  categories: [],
  pricePoint: null,
  minRating: null,
  appointmentOnly: false,
  flagship: false,
  openNow: false,
};

function FilterBar({
  filters,
  onChange,
  allCategories,
  pst,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  allCategories: Category[];
  pst: PstNow;
}) {
  const [catOpen, setCatOpen] = useState(false);
  const hasActiveFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search showrooms…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="pl-8"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Hub chips — city/region labels only, no hub letter */}
        <Button
          size="sm"
          variant={filters.hub === null ? "default" : "outline"}
          onClick={() => onChange({ ...filters, hub: null })}
          className="h-7 text-[11px]"
        >
          All
        </Button>
        {Object.keys(HUBS).map((route) => (
          <Button
            key={route}
            size="sm"
            variant={filters.hub === route ? "default" : "outline"}
            onClick={() => onChange({ ...filters, hub: filters.hub === route ? null : route })}
            className="h-7 text-[11px]"
          >
            {HUB_LABEL[route]}
          </Button>
        ))}

        <div className="mx-1 h-5 w-px bg-border/40" />

        {/* Open Now — shows the current PST time */}
        <Button
          size="sm"
          variant={filters.openNow ? "default" : "outline"}
          onClick={() => onChange({ ...filters, openNow: !filters.openNow })}
          className="h-7 gap-1 text-[11px]"
        >
          <Clock className="size-3" />
          Open Now ({pst.label} PST)
        </Button>

        <div className="mx-1 h-5 w-px bg-border/40" />

        {/* Price chips */}
        {PRICE_POINTS.map((pp) => (
          <Button
            key={pp}
            size="sm"
            variant={filters.pricePoint === pp ? "default" : "outline"}
            onClick={() => onChange({ ...filters, pricePoint: filters.pricePoint === pp ? null : pp })}
            className="h-7 font-mono text-[11px]"
          >
            {pp}
          </Button>
        ))}

        <div className="mx-1 h-5 w-px bg-border/40" />

        {/* Rating chips */}
        {[3, 4, 5].map((r) => (
          <Button
            key={r}
            size="sm"
            variant={filters.minRating === r ? "default" : "outline"}
            onClick={() => onChange({ ...filters, minRating: filters.minRating === r ? null : r })}
            className="h-7 gap-0.5 text-[11px]"
          >
            {r}+ <Star className="size-3 fill-amber-400 text-amber-400" />
          </Button>
        ))}

        <div className="mx-1 h-5 w-px bg-border/40" />

        {/* Toggle chips */}
        <Button
          size="sm"
          variant={filters.appointmentOnly ? "default" : "outline"}
          onClick={() => onChange({ ...filters, appointmentOnly: !filters.appointmentOnly })}
          className="h-7 text-[11px]"
        >
          Appt Only
        </Button>
        <Button
          size="sm"
          variant={filters.flagship ? "default" : "outline"}
          onClick={() => onChange({ ...filters, flagship: !filters.flagship })}
          className="h-7 text-[11px]"
        >
          Flagship
        </Button>

        {/* Category dropdown */}
        <div className="relative">
          <Button
            size="sm"
            variant={filters.categories.length > 0 ? "default" : "outline"}
            onClick={() => setCatOpen(!catOpen)}
            className="h-7 gap-1 text-[11px]"
          >
            <Filter className="size-3" />
            Category
            {filters.categories.length > 0 && (
              <Badge className="ml-0.5 h-4 px-1 text-[9px]">{filters.categories.length}</Badge>
            )}
            <ChevronDown className="size-3" />
          </Button>
          {catOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-[240px] min-w-[200px] overflow-y-auto rounded-md bg-popover p-1 shadow-lg ring-1 ring-border/40">
              {allCategories.map((c) => {
                const active = filters.categories.includes(c.name);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? filters.categories.filter((n) => n !== c.name)
                        : [...filters.categories, c.name];
                      onChange({ ...filters, categories: next });
                    }}
                    className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs transition ${
                      active ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted/60"
                    }`}
                  >
                    <div
                      className={`size-3.5 rounded border transition ${
                        active ? "border-primary bg-primary" : "border-border"
                      }`}
                    />
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Reset */}
        {hasActiveFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── View Toggle ──────────────────────────────────────────────────────────────

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const views: { id: ViewMode; label: string; Icon: ComponentType<{ className?: string }> }[] = [
    { id: "map", label: "Map", Icon: MapIcon },
    { id: "list", label: "List", Icon: LayoutList },
    { id: "directory", label: "Directory", Icon: Users },
  ];

  return (
    <div className="flex gap-1 rounded-lg bg-card p-0.5 ring-1 ring-border/40">
      {views.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
            value === id
              ? "bg-primary/10 text-primary ring-1 ring-primary/30"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex min-h-[140px] items-center justify-center text-sm text-muted-foreground">
      No showrooms match. Try adjusting your filters.
    </div>
  );
}

function CardGrid({ stores, pst }: { stores: Store[]; pst: PstNow }) {
  return (
    <div className="flex flex-col gap-3">
      {stores.map((s) => (
        <ShowroomCard key={s.id} store={s} pst={pst} />
      ))}
    </div>
  );
}

// ─── Map View (map on top, cards stacked below — mobile friendly) ──────────────

function MapView({ stores, pst }: { stores: Store[]; pst: PstNow }) {
  const byHub = useMemo(() => {
    const map = new Map<string, Store[]>();
    for (const s of stores) {
      if (!s.hubRoute || !HUBS[s.hubRoute]) continue;
      map.set(s.hubRoute, [...(map.get(s.hubRoute) ?? []), s]);
    }
    return map;
  }, [stores]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <GeoMap
          className="h-[320px] w-full sm:h-[420px]"
          theme="dark"
          viewport={{ center: [-122.27, 37.72], zoom: 8.2 }}
        >
          <MapControls showZoom />
          {[...byHub.entries()].map(([route, hubStores]) => {
            const hub = HUBS[route];
            return (
              <MapMarker key={route} longitude={hub.lng} latitude={hub.lat}>
                <MarkerContent className="z-20">
                  <div className="flex items-center gap-1.5 rounded-full bg-sky-500/90 px-2.5 py-1 text-xs font-semibold text-white shadow-lg">
                    <MapPin className="size-3.5" /> {HUB_LABEL[route]} · {hubStores.length}
                  </div>
                </MarkerContent>
                <MarkerPopup closeButton className="max-w-72">
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold">{HUB_LABEL[route]}</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {hubStores.slice(0, 8).map((s) => (
                        <li key={s.id} className="flex items-center gap-1 truncate">
                          <span className="truncate">{s.name}</span>
                          {s.onlineRating !== null && (
                            <span className="ml-auto shrink-0 text-[10px] text-amber-400">
                              {s.onlineRating}★
                            </span>
                          )}
                        </li>
                      ))}
                      {hubStores.length > 8 && <li>+{hubStores.length - 8} more</li>}
                    </ul>
                  </div>
                </MarkerPopup>
              </MapMarker>
            );
          })}
        </GeoMap>
      </Card>

      {stores.length === 0 ? <EmptyState /> : <CardGrid stores={stores} pst={pst} />}
    </div>
  );
}

// ─── List View (grouped by category) ───────────────────────────────────────────

function GroupedView({
  groups,
  pst,
  withCategoryIcon = false,
}: {
  groups: [string, Store[]][];
  pst: PstNow;
  /** List tab: render a colorful lucide icon chip in each group header. */
  withCategoryIcon?: boolean;
}) {
  if (groups.length === 0) return <EmptyState />;
  return (
    <div>
      {groups.map(([label, groupStores]) => {
        const style = withCategoryIcon ? categoryIconStyleFor(label) : null;
        return (
          <section key={label} className="mt-10 first:mt-0">
            <div className="mb-3 flex items-center gap-3">
              {style && (
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${style.className}`}
                >
                  <style.Icon className="size-4" />
                </span>
              )}
              <h2 className="text-base font-semibold">{label}</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {groupStores.length}
              </span>
              <span className="ml-auto h-px flex-1 bg-border/40" />
            </div>
            <CardGrid stores={groupStores} pst={pst} />
          </section>
        );
      })}
    </div>
  );
}

function ListView({ stores, pst }: { stores: Store[]; pst: PstNow }) {
  const groups = useMemo(() => {
    const map = new Map<string, Store[]>();
    for (const s of stores) {
      if (s.categories.length === 0) {
        map.set("Uncategorized", [...(map.get("Uncategorized") ?? []), s]);
      } else {
        for (const cat of s.categories) {
          map.set(cat, [...(map.get(cat) ?? []), s]);
        }
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [stores]);

  return <GroupedView groups={groups} pst={pst} withCategoryIcon />;
}

// ─── Directory View (condensed field sheet, grouped by hub city) ────────────────

/** A short "open now / closes …" cue for the condensed directory card. */
function hoursCue(store: Store, pst: PstNow): { text: string; className: string } {
  if (store.isAppointmentOnly)
    return { text: "By appt", className: "bg-violet-500/15 text-violet-300" };
  if (isOpenNow(store, pst)) {
    const isWeekday = pst.day >= 1 && pst.day <= 5;
    const range = parseHoursRange(isWeekday ? store.weekdayHours : store.weekendHours);
    if (range && pst.minutes >= range.close - 60)
      return { text: `Closing ${fmt12(range.close)}`, className: "bg-amber-500/15 text-amber-300" };
    return {
      text: range ? `Open · ${fmt12(range.close)}` : "Open now",
      className: "bg-emerald-500/15 text-emerald-300",
    };
  }
  return { text: "Closed now", className: "bg-rose-500/15 text-rose-300" };
}

/** Dense contact card — favors phone-first density over imagery. */
function DirectoryCard({ store, pst }: { store: Store; pst: PstNow }) {
  const cue = hoursCue(store, pst);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <article className="group relative flex items-center gap-3 rounded-lg bg-card px-3 py-2.5 ring-1 ring-border/40 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/admin/showroom/store/${store.id}`}
            className="line-clamp-1 text-sm font-medium after:absolute after:inset-0 after:content-['']"
          >
            {store.name}
          </a>
          {store.isFlagshipLocation && <FlagshipBadge />}
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${cue.className}`}
          >
            <Clock className="size-2.5" />
            {cue.text}
          </span>
        </div>

        {/* Phone-first contact row */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          {store.phoneNumber && (
            <a
              href={telHref(store.phoneNumber)}
              onClick={stop}
              className="relative z-10 inline-flex items-center gap-1.5 font-medium text-sky-400 hover:text-sky-300"
            >
              <Phone className="size-3.5" />
              {formatPhone(store.phoneNumber)}
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
              <Globe className="size-3.5" />
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
              <Instagram className="size-3.5" />
            </a>
          )}
          {store.cityName && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <MapPin className="size-3" />
              {store.cityName}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** Sort hub groups: known hubs in geographic order, then alpha, "Other" last. */
const HUB_GROUP_ORDER: Record<string, number> = {
  "SF Design District": 0,
  "Silicon Valley & South Bay": 1,
  "Peninsula / Mid-Market": 2,
  "East Bay": 3,
  "North Bay": 4,
};

function DirectoryView({ stores, pst }: { stores: Store[]; pst: PstNow }) {
  const groups = useMemo(() => {
    const map = new Map<string, Store[]>();
    for (const s of stores) {
      // Group by the map-hub city name so Alameda/Emeryville/Hayward → "East Bay".
      const hub = s.hubName ?? "Other";
      map.set(hub, [...(map.get(hub) ?? []), s]);
    }
    return [...map.entries()].sort((a, b) => {
      const aOther = a[0] === "Other";
      const bOther = b[0] === "Other";
      if (aOther !== bOther) return aOther ? 1 : -1; // Other last
      const ao = HUB_GROUP_ORDER[a[0]];
      const bo = HUB_GROUP_ORDER[b[0]];
      if (ao !== undefined && bo !== undefined) return ao - bo;
      if (ao !== undefined) return -1;
      if (bo !== undefined) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [stores]);

  if (groups.length === 0) return <EmptyState />;

  return (
    <div>
      {groups.map(([hub, hubStores]) => (
        <section key={hub} className="mt-8 first:mt-0">
          <div className="mb-2 flex items-center gap-2">
            <MapPin className="size-4 text-sky-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">{hub}</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              {hubStores.length}
            </span>
            <span className="ml-auto h-px flex-1 bg-border/40" />
          </div>
          <div className="flex flex-col gap-2">
            {hubStores.map((s) => (
              <DirectoryCard key={s.id} store={s} pst={pst} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── Add Showroom Modal ───────────────────────────────────────────────────────

function AddShowroomModal({ cities, onCreated }: { cities: City[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const emptyForm = {
    name: "",
    description: "",
    pricePoint: "",
    websiteUrl: "",
    phoneNumber: "",
    emailAddress: "",
    bayAreaCityId: "",
    locationAddress: "",
    zipCode: "",
    googleMapsLink: "",
    weekdayHours: "",
    weekendHours: "",
    isOpenWeekends: false,
    isAppointmentOnly: false,
    isFlagshipLocation: false,
    scale: "",
    inventoryFocus: "",
    targetDemographic: "",
    mainPocFullname: "",
    mainPocPhoneNumber: "",
    mainPocEmailAddress: "",
  };
  const [form, setForm] = useState({ ...emptyForm });

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Store name is required");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      if (form.description) body.description = form.description;
      if (form.pricePoint) body.pricePoint = form.pricePoint;
      if (form.websiteUrl) body.websiteUrl = form.websiteUrl;
      if (form.phoneNumber) body.phoneNumber = form.phoneNumber;
      if (form.emailAddress) body.emailAddress = form.emailAddress;
      if (form.bayAreaCityId) body.bayAreaCityId = Number(form.bayAreaCityId);
      if (form.locationAddress) body.locationAddress = form.locationAddress;
      if (form.zipCode) body.zipCode = form.zipCode;
      if (form.googleMapsLink) body.googleMapsLink = form.googleMapsLink;
      if (form.weekdayHours) body.weekdayHours = form.weekdayHours;
      if (form.weekendHours) body.weekendHours = form.weekendHours;
      body.isOpenWeekends = form.isOpenWeekends;
      body.isAppointmentOnly = form.isAppointmentOnly;
      body.isFlagshipLocation = form.isFlagshipLocation;
      if (form.scale) body.scale = form.scale;
      if (form.inventoryFocus) body.inventoryFocus = form.inventoryFocus;
      if (form.targetDemographic) body.targetDemographic = form.targetDemographic;
      if (form.mainPocFullname) body.mainPocFullname = form.mainPocFullname;
      if (form.mainPocPhoneNumber) body.mainPocPhoneNumber = form.mainPocPhoneNumber;
      if (form.mainPocEmailAddress) body.mainPocEmailAddress = form.mainPocEmailAddress;

      const res = await fetch("/api/showroom-stores", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((err.error as string) ?? `Failed (${res.status})`);
      }

      toast.success(`${form.name} added! AI research will run in the background.`);
      setOpen(false);
      setStep(0);
      setForm({ ...emptyForm });
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create showroom");
    } finally {
      setSubmitting(false);
    }
  };

  const steps = ["Identity", "Location", "Details", "Contact"];

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        Add Showroom
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Showroom</DialogTitle>
            <DialogDescription>
              Add a Bay Area showroom. The AI research agent will automatically run after creation.
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex gap-1">
            {steps.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(i)}
                className={`flex-1 rounded-sm py-1 text-center text-[10px] font-medium uppercase tracking-wider transition ${
                  step === i
                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-2 space-y-3">
            {step === 0 && (
              <>
                <div>
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Ferguson Bath, Kitchen & Lighting" />
                </div>
                <div>
                  <Label htmlFor="desc">Description</Label>
                  <Input id="desc" value={form.description} onChange={(e) => update({ description: e.target.value })} placeholder="Brief description" />
                </div>
                <div>
                  <Label htmlFor="price">Price Point</Label>
                  <div className="flex gap-1.5">
                    {PRICE_POINTS.map((pp) => (
                      <Button
                        key={pp}
                        size="sm"
                        type="button"
                        variant={form.pricePoint === pp ? "default" : "outline"}
                        onClick={() => update({ pricePoint: form.pricePoint === pp ? "" : pp })}
                        className="font-mono"
                      >
                        {pp}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input id="website" value={form.websiteUrl} onChange={(e) => update({ websiteUrl: e.target.value })} placeholder="https://..." />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div>
                  <Label htmlFor="city">Bay Area City</Label>
                  <select
                    id="city"
                    value={form.bayAreaCityId}
                    onChange={(e) => update({ bayAreaCityId: e.target.value })}
                    className="w-full rounded-md bg-card px-3 py-2 text-sm text-foreground ring-1 ring-border/40 focus:ring-primary/40"
                  >
                    <option value="">Select a city…</option>
                    {cities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.bayAreaCityName} {c.hubRoute ? `(${HUB_LABEL[c.hubRoute] ?? c.hubRoute})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" value={form.locationAddress} onChange={(e) => update({ locationAddress: e.target.value })} placeholder="123 Design St" />
                </div>
                <div>
                  <Label htmlFor="zip">Zip Code</Label>
                  <Input id="zip" value={form.zipCode} onChange={(e) => update({ zipCode: e.target.value })} placeholder="94103" />
                </div>
                <div>
                  <Label htmlFor="maps">Google Maps Link</Label>
                  <Input id="maps" value={form.googleMapsLink} onChange={(e) => update({ googleMapsLink: e.target.value })} placeholder="https://maps.google.com/..." />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="weekday">Weekday Hours</Label>
                    <Input id="weekday" value={form.weekdayHours} onChange={(e) => update({ weekdayHours: e.target.value })} placeholder="M-F 9AM-5PM" />
                  </div>
                  <div>
                    <Label htmlFor="weekend">Weekend Hours</Label>
                    <Input id="weekend" value={form.weekendHours} onChange={(e) => update({ weekendHours: e.target.value })} placeholder="Sat 10AM-4PM" />
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="isOpenWeekends">Open Weekends</Label>
                    <Switch id="isOpenWeekends" checked={form.isOpenWeekends} onCheckedChange={(v) => update({ isOpenWeekends: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="isAppointmentOnly">Appointment Only</Label>
                    <Switch id="isAppointmentOnly" checked={form.isAppointmentOnly} onCheckedChange={(v) => update({ isAppointmentOnly: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="isFlagshipLocation">Flagship Location</Label>
                    <Switch id="isFlagshipLocation" checked={form.isFlagshipLocation} onCheckedChange={(v) => update({ isFlagshipLocation: v })} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="scale">Scale</Label>
                  <Input id="scale" value={form.scale} onChange={(e) => update({ scale: e.target.value })} placeholder="e.g. Massive, dual-wing facility" />
                </div>
                <div>
                  <Label htmlFor="focus">Inventory Focus</Label>
                  <Input id="focus" value={form.inventoryFocus} onChange={(e) => update({ inventoryFocus: e.target.value })} placeholder="What this location specializes in" />
                </div>
                <div>
                  <Label htmlFor="demo">Target Demographic</Label>
                  <Input id="demo" value={form.targetDemographic} onChange={(e) => update({ targetDemographic: e.target.value })} placeholder="e.g. Urban architects, tech executives" />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phoneNumber} onChange={(e) => update({ phoneNumber: e.target.value })} placeholder="(415) 555-0100" />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={form.emailAddress} onChange={(e) => update({ emailAddress: e.target.value })} placeholder="hello@showroom.com" />
                </div>
                <div>
                  <Label htmlFor="pocName">POC Name</Label>
                  <Input id="pocName" value={form.mainPocFullname} onChange={(e) => update({ mainPocFullname: e.target.value })} placeholder="Full name" />
                </div>
                <div>
                  <Label htmlFor="pocPhone">POC Phone</Label>
                  <Input id="pocPhone" value={form.mainPocPhoneNumber} onChange={(e) => update({ mainPocPhoneNumber: e.target.value })} placeholder="(415) 555-0100" />
                </div>
                <div>
                  <Label htmlFor="pocEmail">POC Email</Label>
                  <Input id="pocEmail" value={form.mainPocEmailAddress} onChange={(e) => update({ mainPocEmailAddress: e.target.value })} placeholder="name@showroom.com" />
                </div>
              </>
            )}
          </div>

          {/* Navigation */}
          <div className="mt-4 flex justify-between">
            <Button size="sm" variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
              Back
            </Button>
            <div className="flex gap-2">
              {step < steps.length - 1 ? (
                <Button size="sm" onClick={() => setStep(step + 1)}>
                  Next
                </Button>
              ) : (
                <Button size="sm" onClick={handleSubmit} disabled={submitting || !form.name.trim()}>
                  {submitting && <Loader2 className="mr-1.5 size-3 animate-spin" />}
                  Create Showroom
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const VALID_TABS: ViewMode[] = ["map", "list", "directory"];

function isViewMode(v: string | undefined | null): v is ViewMode {
  return v != null && (VALID_TABS as string[]).includes(v);
}

export function ShowroomsDirectoryApp({ initialTab = "map" }: { initialTab?: ViewMode }) {
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [viewMode, setViewMode] = useState<ViewMode>(initialTab);
  const [pst, setPst] = useState<PstNow>(() => computePst());

  // Tab ↔ URL sync. Clicking a tab pushes /admin/showroom/showrooms/<tab>;
  // browser back/forward (popstate) restores the tab from the path.
  const selectTab = useCallback((tab: ViewMode) => {
    setViewMode(tab);
    if (typeof window !== "undefined") {
      const next = `/admin/showroom/showrooms/${tab}`;
      if (window.location.pathname !== next) {
        window.history.pushState(null, "", next);
      }
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const seg = window.location.pathname.split("/").filter(Boolean).pop();
      setViewMode(isViewMode(seg) ? seg : "map");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Keep the PST clock (Open Now filter + live hours cues) fresh each minute.
  useEffect(() => {
    const id = setInterval(() => setPst(computePst()), 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ stores: Store[] }>(
        "/api/showroom-stores?include=categories,ratings",
      );
      setAllStores(
        data.stores.map((s) => ({
          ...s,
          categories: s.categories ?? [],
          onlineRating: s.onlineRating ?? null,
          onlineRatingCount: s.onlineRatingCount ?? 0,
          userRating: s.userRating ?? null,
          isAppointmentOnly: s.isAppointmentOnly ?? false,
          isFlagshipLocation: s.isFlagshipLocation ?? false,
          isOpenWeekends: s.isOpenWeekends ?? false,
        })),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load showrooms");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMeta = useCallback(async () => {
    try {
      const [catData, cityData] = await Promise.all([
        api<{ categories: Category[] }>("/api/showroom-stores/meta/categories"),
        api<{ cities: City[] }>("/api/showroom-stores/meta/cities"),
      ]);
      setCategories(catData.categories);
      setCities(cityData.cities);
    } catch {
      // Non-critical — filters just won't show all options
    }
  }, []);

  useEffect(() => {
    fetchStores();
    fetchMeta();
  }, [fetchStores, fetchMeta]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return allStores.filter((s) => {
      if (filters.hub && s.hubRoute !== filters.hub) return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !(s.cityName ?? "").toLowerCase().includes(q) &&
        !(s.inventoryFocus ?? "").toLowerCase().includes(q)
      )
        return false;
      if (filters.pricePoint && s.pricePoint !== filters.pricePoint) return false;
      if (filters.minRating !== null && (s.onlineRating === null || s.onlineRating < filters.minRating))
        return false;
      if (filters.appointmentOnly && !s.isAppointmentOnly) return false;
      if (filters.flagship && !s.isFlagshipLocation) return false;
      if (filters.openNow && !isOpenNow(s, pst)) return false;
      if (
        filters.categories.length > 0 &&
        !filters.categories.some((c) => s.categories.includes(c))
      )
        return false;
      return true;
    });
  }, [allStores, filters, pst]);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Showrooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bay Area sourcing hubs. Filter, browse, and add showrooms for your renovation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={viewMode} onChange={selectTab} />
          <AddShowroomModal cities={cities} onCreated={fetchStores} />
        </div>
      </div>

      {/* Stats Bar */}
      {!loading && <StatsBar stores={allStores} />}

      {/* Filter Bar */}
      <div className="mb-5 mt-4">
        <FilterBar filters={filters} onChange={setFilters} allCategories={categories} pst={pst} />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : viewMode === "map" ? (
        <MapView stores={filtered} pst={pst} />
      ) : viewMode === "list" ? (
        <ListView stores={filtered} pst={pst} />
      ) : (
        <DirectoryView stores={filtered} pst={pst} />
      )}
    </main>
  );
}
