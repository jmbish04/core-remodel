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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { CollapsibleGroup, useAccordionGroup } from "@/components/CollapsibleGroup";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategorySelector } from "@/components/ui/category-selector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Map as GeoMap,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  type MapViewport,
} from "@/components/ui/map";
import {
  mapPlaceToHoursJson,
  mapPlaceToIntake,
  type FieldDiag,
  type GooglePlaceDetails,
  type GooglePlacePhoto,
  type IntakeDiagnostics,
} from "./intake/places-mapper";
import { HoursEditor } from "./intake/HoursEditor";
import { FlagsEditor } from "./intake/FlagsEditor";
import { OverviewNoteEditor } from "./OverviewNoteEditor";
import { DEFAULT_HOURS, type HoursJson } from "./intake/hours-types";
import {
  isOpenNow as isOpenNowStructured,
  type HourRow,
} from "./hours-status";
import { ShowroomMergedCard } from "./ShowroomMergedCard";
import { ManageShowroomsModal } from "./ManageShowroomsModal";
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
  /** Captured coordinates — power the individual map markers when zoomed in. */
  latitude: number | null;
  longitude: number | null;
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
  /** Scraped hero image (Cloudflare Images delivery URL); null → fall back to logo/initials. */
  heroImageCfImagesUrl: string | null;
  /** Normalized open-hours rows (one per open day). Empty → hours unknown/closed. */
  hours: HourRow[];
  /** Google Places aggregate rating + review count (distinct from onlineRating). */
  googleRating: number | null;
  userRatingCount: number | null;
  /** Intake flags. */
  isLargeSelection: boolean;
  isBespoke: boolean;
  isTradeRepRequired: boolean;
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
function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
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
    <ShowroomMergedCard
      store={store}
      pst={pst}
      href={`/admin/shopping/store/${store.id}`}
    />
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
  visited: "all" | "visited" | "unvisited";
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
  visited: "all",
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

        {/* Visited segmented toggle */}
        <div className="inline-flex overflow-hidden rounded-md ring-1 ring-border/40">
          {(
            [
              { id: "all", label: "All" },
              { id: "visited", label: "Visited" },
              { id: "unvisited", label: "Unvisited" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange({ ...filters, visited: opt.id })}
              className={`px-2.5 py-1 text-[11px] font-medium transition ${
                filters.visited === opt.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

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
        <CategorySelector
          allCategories={allCategories}
          selected={filters.categories}
          onToggle={(name) => {
            const next = filters.categories.includes(name)
              ? filters.categories.filter((n) => n !== name)
              : [...filters.categories, name];
            onChange({ ...filters, categories: next });
          }}
          onClear={() => onChange({ ...filters, categories: [] })}
        />

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

/** A pin for a single showroom, positioned by its captured coordinates. */
function ShowroomMarker({ store }: { store: Store }) {
  return (
    <MapMarker longitude={store.longitude as number} latitude={store.latitude as number}>
      <MarkerContent className="z-10">
        <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500/90 ring-2 ring-white/80 shadow-lg transition-transform hover:scale-110">
          <MapPin className="size-3.5 text-white" />
        </div>
      </MarkerContent>
      <MarkerPopup closeButton className="max-w-64">
        <a href={`/admin/shopping/store/${store.id}`} className="block space-y-1">
          <p className="text-sm font-semibold leading-tight">{store.name}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {store.cityName && <span>{store.cityName}</span>}
            {store.pricePoint && <span className="font-mono">{store.pricePoint}</span>}
            {store.onlineRating !== null && (
              <span className="text-amber-400">{store.onlineRating}★</span>
            )}
          </div>
          {store.locationAddress && (
            <p className="text-[10px] text-muted-foreground/70">{store.locationAddress}</p>
          )}
        </a>
      </MarkerPopup>
    </MapMarker>
  );
}

/** "You are here" marker — a pulsing blue dot from the device's geolocation. */
function UserLocationMarker({ lng, lat }: { lng: number; lat: number }) {
  return (
    <MapMarker longitude={lng} latitude={lat}>
      <MarkerContent className="z-20">
        <span className="relative flex size-4 items-center justify-center">
          <span className="absolute inline-flex size-4 animate-ping rounded-full bg-sky-400/60" />
          <span className="relative inline-flex size-3 rounded-full bg-sky-500 ring-2 ring-white shadow" />
        </span>
      </MarkerContent>
      <MarkerPopup closeButton className="max-w-48">
        <p className="text-xs font-medium">Your location</p>
      </MarkerPopup>
    </MapMarker>
  );
}

const BAY_AREA_DEFAULT_VIEW: { center: [number, number]; zoom: number } = {
  center: [-122.27, 37.72],
  zoom: 8.2,
};

/**
 * Frame a set of lng/lat points: centroid + a zoom derived from the bounding-box
 * span. Keeps every showroom marker (and the user's dot, when present) on screen
 * without needing an imperative fitBounds against the controlled viewport.
 */
function viewportForPoints(pts: Array<[number, number]>): {
  center: [number, number];
  zoom: number;
} {
  if (pts.length === 0) return BAY_AREA_DEFAULT_VIEW;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const center: [number, number] = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  if (pts.length === 1) return { center, zoom: 12 };
  // Weight latitude span (narrower per-degree at this latitude) so tall, thin
  // spreads still fit. Clamp so a single-cluster area doesn't over-zoom.
  const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.4, 1e-4);
  const zoom = Math.max(3, Math.min(12.5, Math.log2(360 / span) - 0.65));
  return { center, zoom };
}

function MapView({ stores, pst }: { stores: Store[]; pst: PstNow }) {
  const byHub = useMemo(() => {
    const map = new Map<string, Store[]>();
    for (const s of stores) {
      if (!s.hubRoute || !HUBS[s.hubRoute]) continue;
      map.set(s.hubRoute, [...(map.get(s.hubRoute) ?? []), s]);
    }
    return map;
  }, [stores]);

  const hubEntries = useMemo(() => [...byHub.entries()], [byHub]);
  const hubKeys = useMemo(() => hubEntries.map(([route]) => route), [hubEntries]);
  const { openKey, toggle } = useAccordionGroup(hubKeys);

  // Stores with captured coordinates get an individual pin.
  const geoStores = useMemo(
    () => stores.filter((s) => s.latitude != null && s.longitude != null),
    [stores],
  );
  const noGeoCount = stores.length - geoStores.length;

  // The device's geolocation ("you are here"), when granted. Works on phones
  // and the in-car (Tesla) browser via the standard Geolocation API.
  const [userLoc, setUserLoc] = useState<{ lng: number; lat: number } | null>(null);

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
      () => {
        /* denied / unavailable — the map simply won't show a location dot */
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  // Best-effort location on mount (a permission prompt the first time). The
  // locate button in MapControls re-requests + flies to the dot on demand.
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // Frame the map around the showrooms currently in view (plus the user's dot),
  // so markers are visible without hunting. Recomputes when the filtered set or
  // the user's location changes; free pan/zoom in between via onViewportChange.
  const framePoints = useMemo<Array<[number, number]>>(() => {
    const pts: Array<[number, number]> = geoStores.map((s) => [
      s.longitude as number,
      s.latitude as number,
    ]);
    if (userLoc) pts.push([userLoc.lng, userLoc.lat]);
    return pts;
  }, [geoStores, userLoc]);

  const frameKey = useMemo(
    () =>
      framePoints
        .map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`)
        .join("|"),
    [framePoints],
  );

  const [viewport, setViewport] = useState<Partial<MapViewport>>(() =>
    viewportForPoints(framePoints),
  );

  useEffect(() => {
    setViewport(viewportForPoints(framePoints));
    // frameKey is the stable identity of framePoints — reframe only when it
    // actually changes, not on every render (avoids fighting user pan/zoom).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden">
        <GeoMap
          className="h-[320px] w-full sm:h-[460px]"
          theme="dark"
          viewport={viewport}
          onViewportChange={setViewport}
        >
          <MapControls
            showZoom
            showLocate
            onLocate={(c) => setUserLoc({ lng: c.longitude, lat: c.latitude })}
          />

          {/* One marker per showroom that has captured coordinates. */}
          {geoStores.map((s) => (
            <ShowroomMarker key={s.id} store={s} />
          ))}

          {/* The device's own location, when granted. */}
          {userLoc && <UserLocationMarker lng={userLoc.lng} lat={userLoc.lat} />}
        </GeoMap>

        {/* Overlay when nothing can be plotted — the coordinates are missing,
            not the showrooms. Keeps the map honest instead of showing an empty
            ocean with no explanation. */}
        {geoStores.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background/95 to-transparent p-4 text-center">
            <p className="text-xs text-muted-foreground">
              {stores.length === 0
                ? "No showrooms match your filters."
                : `None of these ${stores.length} showroom${stores.length === 1 ? "" : "s"} have mapped coordinates yet — see the list below.`}
            </p>
          </div>
        )}
      </Card>

      {/* Count of in-view showrooms still missing coordinates (can't be pinned). */}
      {geoStores.length > 0 && noGeoCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {geoStores.length} of {stores.length} shown on the map · {noGeoCount} without
          coordinates yet (listed below).
        </p>
      )}

      {stores.length === 0 ? (
        <EmptyState />
      ) : (
        <div>
          {hubEntries.map(([route, hubStores]) => (
            <CollapsibleGroup
              key={route}
              open={openKey === route}
              onToggle={() => toggle(route)}
              className="mt-8 first:mt-0"
              header={
                <>
                  <MapPin className="size-4 text-sky-400" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide">
                    {HUB_LABEL[route]}
                  </h2>
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    {hubStores.length}
                  </span>
                  <span className="ml-auto h-px flex-1 bg-border/40" />
                </>
              }
            >
              <CardGrid stores={hubStores} pst={pst} />
            </CollapsibleGroup>
          ))}
        </div>
      )}
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
  const orderedKeys = useMemo(() => groups.map(([label]) => label), [groups]);
  const { openKey, toggle } = useAccordionGroup(orderedKeys);

  if (groups.length === 0) return <EmptyState />;
  return (
    <div>
      {groups.map(([label, groupStores]) => {
        const style = withCategoryIcon ? categoryIconStyleFor(label) : null;
        return (
          <CollapsibleGroup
            key={label}
            open={openKey === label}
            onToggle={() => toggle(label)}
            className="mt-10 first:mt-0"
            header={
              <>
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
              </>
            }
          >
            <CardGrid stores={groupStores} pst={pst} />
          </CollapsibleGroup>
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

/** Dense contact card — the compact variant of the canonical merged card. */
function DirectoryCard({ store, pst }: { store: Store; pst: PstNow }) {
  return (
    <ShowroomMergedCard
      store={store}
      pst={pst}
      href={`/admin/shopping/store/${store.id}`}
      compact
    />
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

  const orderedKeys = useMemo(() => groups.map(([hub]) => hub), [groups]);
  const { openKey, toggle } = useAccordionGroup(orderedKeys);

  if (groups.length === 0) return <EmptyState />;

  return (
    <div>
      {groups.map(([hub, hubStores]) => (
        <CollapsibleGroup
          key={hub}
          open={openKey === hub}
          onToggle={() => toggle(hub)}
          className="mt-8 first:mt-0"
          header={
            <>
              <MapPin className="size-4 text-sky-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wide">{hub}</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {hubStores.length}
              </span>
              <span className="ml-auto h-px flex-1 bg-border/40" />
            </>
          }
        >
          <div className="flex flex-col gap-2">
            {hubStores.map((s) => (
              <DirectoryCard key={s.id} store={s} pst={pst} />
            ))}
          </div>
        </CollapsibleGroup>
      ))}
    </div>
  );
}

// ─── Add Showroom Modal ───────────────────────────────────────────────────────

/**
 * Google Places (New) autocomplete typeahead for the showroom NAME field.
 *
 * Mirrors `PlaceSearch` from ShowroomIntakeApp: a controlled `<Input>` that
 * still drives `form.name` (so the user can just type a name manually) plus a
 * debounced (~300ms) suggestions dropdown fed by
 * `GET /api/places/autocomplete?q=&sessionToken=`. Selecting a suggestion hands
 * the `placeId` back to the parent, which fetches Place Details and autofills.
 *
 * Session token: one `crypto.randomUUID()` per search session is held in
 * `sessionTokenRef` and sent with every keystroke's autocomplete call AND the
 * terminal details call — grouping them into ONE Google billing session. The
 * parent regenerates it (via `sessionTokenRef`, shared by ref) after a
 * successful selection.
 */
function ShowroomNameSearch({
  value,
  onChange,
  onSelect,
  sessionTokenRef,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (placeId: string) => void;
  sessionTokenRef: React.MutableRefObject<string>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{ placeId: string; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the dropdown when clicking outside the search container.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // On unmount, clear any pending debounce timer and abort any in-flight fetch.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const runSearch = useCallback(
    async (text: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const url = `/api/places/autocomplete?q=${encodeURIComponent(text)}&sessionToken=${sessionTokenRef.current}`;
        const res = await fetch(url, { credentials: "include", signal: controller.signal });
        if (res.status === 429) {
          toast.error("Google Maps monthly quota reached. Try again later.");
          setSuggestions([]);
          return;
        }
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Autocomplete failed (${res.status})`);
        }
        const data = (await res.json()) as {
          suggestions?: { placeId: string; text: string }[];
        };
        setSuggestions(data.suggestions ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[directory/autocomplete]", err);
        toast.error(err instanceof Error ? err.message : "Autocomplete failed");
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionTokenRef],
  );

  const handleChange = (next: string) => {
    onChange(next);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = next.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(trimmed), 300);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="name"
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        placeholder="e.g. Ferguson Bath, Kitchen & Lighting"
        className="pl-9"
        aria-label="Search Google Places by showroom name"
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg bg-popover p-1 shadow-md ring-1 ring-border/40">
          {loading && suggestions.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              {value.trim().length < 2
                ? "Type at least 2 characters to search Google, or enter a name manually."
                : "No matches — you can still type a name manually."}
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setSuggestions([]);
                      onSelect(s.placeId);
                    }}
                    className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="line-clamp-2">{s.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Small inline "why this field didn't autofill" note. Renders only when a
 * diagnostic exists AND its autofill failed (`ok === false`): a red warning line
 * with the human reason, plus a muted line echoing the exact Google source path
 * and the raw value that was inspected.
 */
function DiagNote({ diag }: { diag?: FieldDiag }) {
  if (!diag || diag.ok) return null;
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[11px] font-medium text-rose-400">
        ⚠ Not autofilled — {diag.reason}
      </p>
      <p className="text-[10px] text-muted-foreground/70">
        Places {diag.source}: {String(diag.raw ?? "—")}
      </p>
    </div>
  );
}

/** Human-friendly labels for the AI attribute-flag rationale notes. */
const ATTR_RATIONALE_LABELS: { key: string; label: string }[] = [
  { key: "isAppointmentOnly", label: "Appointment only" },
  { key: "isFlagshipLocation", label: "Flagship location" },
  { key: "isLargeSelection", label: "Large selection" },
  { key: "isBespoke", label: "Bespoke / curated" },
  { key: "isTradeRepRequired", label: "Trade rep required" },
];

/** Color-coded styling per review-authenticity assessment. */
function authenticityStyle(assessment: string | undefined): {
  className: string;
  label: string;
} {
  switch (assessment) {
    case "AUTHENTIC":
      return { className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30", label: "Authentic" };
    case "MOSTLY_AUTHENTIC":
      return { className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30", label: "Mostly authentic" };
    case "MIXED":
      return { className: "bg-amber-500/15 text-amber-300 ring-amber-500/30", label: "Mixed" };
    case "SUSPICIOUS":
      return { className: "bg-rose-500/15 text-rose-300 ring-rose-500/30", label: "Suspicious" };
    case "UNVERIFIED":
    default:
      return { className: "bg-muted text-muted-foreground ring-border/40", label: "Unverified" };
  }
}

function AddShowroomModal({ cities, onCreated }: { cities: City[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const emptyForm = {
    name: "",
    placeId: null as string | null,
    description: "",
    pricePoint: "",
    websiteUrl: "",
    phoneNumber: "",
    bayAreaCityId: "",
    locationAddress: "",
    zipCode: "",
    googleMapsLink: "",
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined,
    hoursJson: DEFAULT_HOURS as HoursJson,
    googleRating: undefined as number | undefined,
    userRatingCount: undefined as number | undefined,
    reviewSummary: "",
    isAppointmentOnly: false,
    isFlagshipLocation: false,
    isLargeSelection: false,
    isBespoke: false,
    isTradeRepRequired: false,
  };
  const [form, setForm] = useState({ ...emptyForm });
  const [loadingPlace, setLoadingPlace] = useState(false);
  // Two-phase intake: after a Place is picked we prefill the Google fields
  // (phase 1) and then run Gemini (phase 2). While "running", the modal cannot
  // be closed or submitted — the user must let the AI analysis finish (or fail).
  // "idle" = no place selected yet / manual entry (no gating).
  const [geminiPhase, setGeminiPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  // Set when the selected Google Place is already in the directory (from the
  // pre-check on select, or defensively from a 409 on submit). Drives the
  // prominent "already added" banner AND blocks the Create button.
  const [dupWarning, setDupWarning] = useState<{ showroomId: number; name: string } | null>(null);
  // Per-field autofill diagnostics from the mapper — powers the red DiagNote
  // labels next to each field explaining why Google didn't fill it.
  const [diagnostics, setDiagnostics] = useState<IntakeDiagnostics>({});
  // Raw Google photo references (first 5) forwarded verbatim to the create body.
  const [placePhotos, setPlacePhotos] = useState<GooglePlacePhoto[]>([]);
  // True when the price level shown was INFERRED from reviews by AI (Gemini)
  // because Google returned no structured priceLevel — drives the amber note.
  const [priceInferred, setPriceInferred] = useState(false);
  const [priceReasoning, setPriceReasoning] = useState<string | null>(null);
  // Note shown when the AI reviewed the reviews but found no pricing signal at
  // all (Google returned no priceLevel AND the AI returned the "unspecified"
  // enum). Rendered on the Details tab beside the price picker.
  const [priceNoSignal, setPriceNoSignal] = useState<string | null>(null);
  // AI rationales keyed by flag name (e.g. "isLargeSelection") — an amber
  // "AI: {rationale}" note is rendered beneath each flag the AI set.
  const [attrRationales, setAttrRationales] = useState<Record<string, string>>({});
  // Review-authenticity assessment + brand list surfaced from the AI insight.
  const [reviewAuthenticity, setReviewAuthenticity] = useState<
    NonNullable<GooglePlaceDetails["aiInference"]>["reviewAuthenticity"] | null
  >(null);
  const [detectedBrands, setDetectedBrands] = useState<
    NonNullable<GooglePlaceDetails["aiInference"]>["brands"] | null
  >(null);
  // The full AI-inference object — forwarded verbatim on the create body so the
  // backend persists it and auto-creates the detected brands.
  const [reviewAiInsight, setReviewAiInsight] = useState<
    GooglePlaceDetails["aiInference"] | null
  >(null);
  // Bumped whenever an autofill lands so the (seed-once) rich-text description
  // editor remounts and re-seeds from the freshly mapped description.
  const [descSeedKey, setDescSeedKey] = useState(0);
  // Bumped on autofill so the (seed-once) review-summary editor re-seeds from
  // the freshly mapped `[gemini summarized] …` copy.
  const [reviewSeedKey, setReviewSeedKey] = useState(0);
  // One session token per search session: shared with the child typeahead by ref
  // so every autocomplete keystroke + the terminal details call bill as ONE
  // Google session. Regenerated after a successful selection.
  const sessionTokenRef = useRef<string>(crypto.randomUUID());

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Resolve a Bay Area city ID from a mapped address/city string by matching
   * (case-insensitive, contains) against the `cities` prop's `bayAreaCityName`.
   * Prefers the longest matching city name so "South San Francisco" wins over
   * "San Francisco" when both are substrings of the address.
   */
  const resolveBayAreaCityId = useCallback(
    (address: string | undefined): string => {
      if (!address) return "";
      const hay = address.toLowerCase();
      let best: { id: number; len: number } | null = null;
      for (const c of cities) {
        const name = c.bayAreaCityName?.trim().toLowerCase();
        if (!name) continue;
        if (hay.includes(name) && (!best || name.length > best.len)) {
          best = { id: c.id, len: name.length };
        }
      }
      return best ? String(best.id) : "";
    },
    [cities],
  );

  // Fetch Place Details for the selected suggestion, map it, and autofill the
  // form. Rating / review-count / review-summary come straight from Google and
  // are read-only in the UI.
  const handleSelectPlace = useCallback(
    async (placeId: string) => {
      setLoadingPlace(true);
      setGeminiPhase("idle");

      // ── PHASE 1 — Google Places fields only (fast) → prefill immediately ──
      // We request `skipAi=1` so the Places fields land right away; the Gemini
      // pass happens in phase 2 below for visible progress.
      let place: GooglePlaceDetails | null = null;
      let mapped: ReturnType<typeof mapPlaceToIntake> | null = null;
      try {
        const url = `/api/places/details/${encodeURIComponent(placeId)}?sessionToken=${sessionTokenRef.current}&skipAi=1`;
        const res = await fetch(url, { credentials: "include" });
        if (res.status === 429) {
          toast.error("Google Maps monthly quota reached. Try again later.");
          return;
        }
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Details failed (${res.status})`);
        }
        place = (await res.json()) as GooglePlaceDetails;
        mapped = mapPlaceToIntake(place);
        const cityId = resolveBayAreaCityId(mapped.locationAddress);

        // Per-field diagnostics + raw photos forwarded from the mapper.
        setDiagnostics(mapped._diagnostics ?? {});
        setPlacePhotos(mapped._photos ?? []);

        // Reset AI-derived UI to a clean "pending" state — phase 2 fills it in.
        setReviewAiInsight(null);
        setReviewAuthenticity(null);
        setDetectedBrands(null);
        setAttrRationales({});
        setPriceInferred(false);
        setPriceReasoning(null);
        setPriceNoSignal(null);

        // The Google Place ID drives duplicate prevention (pre-check below + a
        // 409 guard on submit). May be absent on rare Details responses.
        const selectedPlaceId = place.id ?? null;

        update({
          name: mapped.name ?? form.name,
          placeId: selectedPlaceId,
          description: mapped.description ?? "",
          // Google's structured price for now; Gemini may refine it in phase 2.
          pricePoint: mapped.pricePoint ?? "",
          websiteUrl: mapped.websiteUrl ?? "",
          locationAddress: mapped.locationAddress ?? "",
          zipCode: mapped.zipCode ?? "",
          googleMapsLink: mapped.googleMapsLink ?? "",
          phoneNumber: mapped.phoneNumber ?? "",
          latitude: typeof place.location?.latitude === "number" ? place.location.latitude : undefined,
          longitude: typeof place.location?.longitude === "number" ? place.location.longitude : undefined,
          googleRating: mapped.googleRating,
          userRatingCount: mapped.userRatingCount,
          reviewSummary: mapped.reviewSummary ?? "",
          hoursJson: mapPlaceToHoursJson(place.regularOpeningHours) ?? DEFAULT_HOURS,
          // Attribute flags are AI-derived — clear until phase 2 sets them.
          isAppointmentOnly: false,
          isFlagshipLocation: false,
          isLargeSelection: false,
          isBespoke: false,
          isTradeRepRequired: false,
          ...(cityId ? { bayAreaCityId: cityId } : {}),
        });

        // Re-seed the (seed-once) rich-text description + review-summary editors.
        setDescSeedKey((k) => k + 1);
        setReviewSeedKey((k) => k + 1);

        // Successful details call closes the billing session → new token next search.
        sessionTokenRef.current = crypto.randomUUID();
        toast.success("Details pulled from Google — analyzing reviews with AI…");

        // Duplicate pre-check: block re-intaking a Place that's already in the
        // directory. Clears any stale warning first, then flags a dup if found.
        setDupWarning(null);
        if (selectedPlaceId) {
          try {
            const exRes = await fetch(
              `/api/showroom-stores/meta/place-exists?placeId=${encodeURIComponent(selectedPlaceId)}`,
              { credentials: "include" },
            );
            if (exRes.ok) {
              const ex = (await exRes.json()) as {
                exists: boolean;
                showroomId: number | null;
                name: string | null;
              };
              if (ex.exists && ex.showroomId != null) {
                setDupWarning({ showroomId: ex.showroomId, name: ex.name ?? mapped.name ?? "this showroom" });
              }
            }
          } catch (exErr) {
            // Non-fatal: the 409 guard on submit is the backstop.
            console.error("[directory/place-exists]", exErr);
          }
        }
      } catch (e) {
        console.error("[directory/details]", e);
        toast.error(e instanceof Error ? e.message : "Failed to load place details");
        return;
      } finally {
        setLoadingPlace(false);
      }

      // ── PHASE 2 — Gemini review analysis (slower) → fills the AI fields ───
      // Runs on the payload we already fetched, so NO extra Places billing.
      // While "running", the modal blocks close + submit (see geminiPhase).
      if (!place) return;
      setGeminiPhase("running");
      try {
        const aiRes = await fetch("/api/places/details/ai-insight", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(place),
        });
        if (!aiRes.ok) throw new Error(`AI insight failed (${aiRes.status})`);
        const { aiInference: ai, reviewSummary: aiReviewSummary } = (await aiRes.json()) as {
          aiInference: GooglePlaceDetails["aiInference"] | null;
          reviewSummary: string | null;
        };

        // Full AI object → create body (backend persists + auto-creates brands).
        setReviewAiInsight(ai);
        setReviewAuthenticity(ai?.reviewAuthenticity ?? null);
        setDetectedBrands(ai?.brands ?? null);

        // Price: PREFER Gemini's informed read (same policy as before).
        //  1. Gemini REAL tier → use it, mark inferred + reasoning.
        //  2. Gemini UNSPECIFIED → fall back to Google's mapped priceLevel
        //     (noted), else blank + no-signal note.
        const REAL_TIERS = new Set(["$", "$$", "$$$", "$$$$"]);
        const aiTier = ai?.inferredPricePoint ?? null;
        let resolvedPrice = mapped?.pricePoint ?? "";
        let priceIsInferred = false;
        let priceReason: string | null = null;
        let noSignalNote: string | null = null;
        if (aiTier && REAL_TIERS.has(aiTier)) {
          resolvedPrice = aiTier;
          priceIsInferred = true;
          priceReason = ai?.priceReasoning ?? null;
        } else if (aiTier === "PRICE_LEVEL_UNSPECIFIED") {
          if (mapped?.pricePoint) {
            resolvedPrice = mapped.pricePoint;
            noSignalNote = "Google priceLevel; Gemini found no clear signal.";
          } else {
            resolvedPrice = "";
            noSignalNote =
              "AI reviewed the reviews and found no pricing signal (PRICE_LEVEL_UNSPECIFIED).";
          }
        }
        setPriceInferred(priceIsInferred);
        setPriceReasoning(priceReason);
        setPriceNoSignal(noSignalNote);

        // AI attributes → boolean flags, plus per-flag rationales for display.
        const attrs = ai?.attributes ?? null;
        const flagPatch: Partial<typeof form> = attrs
          ? {
              isAppointmentOnly: !!attrs.appointmentOnly?.value,
              isFlagshipLocation: !!attrs.flagshipLocation?.value,
              isLargeSelection: !!attrs.largeSelection?.value,
              isBespoke: !!attrs.bespokeCurated?.value,
              isTradeRepRequired: !!attrs.tradeRepRequired?.value,
            }
          : {};
        if (attrs) {
          const rationales: Record<string, string> = {};
          const addRationale = (key: string, set?: { value?: boolean; rationale?: string }) => {
            if (set?.value && set.rationale) rationales[key] = set.rationale;
          };
          addRationale("isAppointmentOnly", attrs.appointmentOnly);
          addRationale("isFlagshipLocation", attrs.flagshipLocation);
          addRationale("isLargeSelection", attrs.largeSelection);
          addRationale("isBespoke", attrs.bespokeCurated);
          addRationale("isTradeRepRequired", attrs.tradeRepRequired);
          setAttrRationales(rationales);
        }

        update({
          pricePoint: resolvedPrice,
          // Gemini's homeowner-framed summary replaces Google's (often empty) one.
          ...(aiReviewSummary ? { reviewSummary: aiReviewSummary } : {}),
          ...flagPatch,
        });
        if (aiReviewSummary) setReviewSeedKey((k) => k + 1);

        setGeminiPhase("done");
        toast.success("AI review analysis complete.");
      } catch (e) {
        console.error("[directory/ai-insight]", e);
        setGeminiPhase("failed");
        toast.error("AI review analysis failed — you can still save the showroom.");
      }
    },
    [form.name, resolveBayAreaCityId],
  );

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Store name is required");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name: form.name.trim() };
      // Google Places place_id — enables backend duplicate prevention.
      if (form.placeId) body.placeId = form.placeId;
      if (form.description) body.description = form.description;
      if (form.pricePoint) body.pricePoint = form.pricePoint;
      if (form.websiteUrl) body.websiteUrl = form.websiteUrl;
      if (form.phoneNumber) body.phoneNumber = form.phoneNumber;
      if (form.bayAreaCityId) body.bayAreaCityId = Number(form.bayAreaCityId);
      if (form.locationAddress) body.locationAddress = form.locationAddress;
      if (form.zipCode) body.zipCode = form.zipCode;
      if (form.googleMapsLink) body.googleMapsLink = form.googleMapsLink;
      // Captured coordinates — enable the individual map marker + region capture.
      if (typeof form.latitude === "number") body.latitude = form.latitude;
      if (typeof form.longitude === "number") body.longitude = form.longitude;
      // Google-sourced review signals (read-only in the UI).
      if (typeof form.googleRating === "number") body.googleRating = form.googleRating;
      if (typeof form.userRatingCount === "number") body.userRatingCount = form.userRatingCount;
      // Review summary is now hand-editable (PlateJS) — always send the current
      // form value so manual corrections/fallbacks persist.
      body.reviewSummary = form.reviewSummary;
      // Raw Google photo references (first 5) — server fetches + persists media.
      body.photos = placePhotos;
      // Server derives isOpenWeekends / weekdayHours / weekendHours from hoursJson.
      body.hoursJson = form.hoursJson;
      body.isAppointmentOnly = form.isAppointmentOnly;
      body.isFlagshipLocation = form.isFlagshipLocation;
      body.isLargeSelection = form.isLargeSelection;
      body.isBespoke = form.isBespoke;
      body.isTradeRepRequired = form.isTradeRepRequired;
      // Full AI-inference object — backend persists it + auto-creates the brands.
      if (reviewAiInsight) body.reviewAiInsight = reviewAiInsight;

      const res = await fetch("/api/showroom-stores", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        // Defensive dup handling: a 409 means this Place is already in the
        // directory (pre-check may have been skipped). Surface the banner +
        // toast rather than a generic error, and don't reset the form.
        if (res.status === 409) {
          const existingId = err.existingId as number | null | undefined;
          const existingName = (err.existingName as string | null | undefined) ?? form.name.trim();
          if (typeof existingId === "number") {
            setDupWarning({ showroomId: existingId, name: existingName });
            setStep(0);
          }
          toast.error(
            (err.error as string) ?? "This showroom has already been added.",
          );
          return;
        }
        throw new Error((err.error as string) ?? `Failed (${res.status})`);
      }

      toast.success(`${form.name} added! AI research will run in the background.`);
      setOpen(false);
      setStep(0);
      setForm({ ...emptyForm });
      setDupWarning(null);
      setDiagnostics({});
      setPlacePhotos([]);
      setPriceInferred(false);
      setPriceReasoning(null);
      setPriceNoSignal(null);
      setAttrRationales({});
      setReviewAuthenticity(null);
      setDetectedBrands(null);
      setReviewAiInsight(null);
      setGeminiPhase("idle");
      setDescSeedKey((k) => k + 1);
      setReviewSeedKey((k) => k + 1);
      sessionTokenRef.current = crypto.randomUUID();
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create showroom");
    } finally {
      setSubmitting(false);
    }
  };

  const steps = ["Search", "Location", "Hours", "Details"];

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        Add Showroom
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Controlled dialog: while Gemini is running, ignore every close
          // request (Escape, outside-click, and the X button all route here)
          // so it stays open until the AI analysis replies.
          if (!next && geminiPhase === "running") {
            toast.info("Hang on — finishing the AI review analysis…");
            return;
          }
          setOpen(next);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg [&_label]:mb-1.5">
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
                {dupWarning && (
                  <div className="rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-500/30">
                    <p className="text-sm font-medium text-amber-300">
                      ⚠ Already added: {dupWarning.name}
                    </p>
                    <p className="mt-1 text-[11px] text-amber-200/70">
                      This Google Place is already in the directory. You can't add it
                      twice.
                    </p>
                    <a
                      href={`/admin/shopping/store/${dupWarning.showroomId}`}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300"
                    >
                      <StoreIcon className="size-3" />
                      View existing
                    </a>
                  </div>
                )}
                <div>
                  <Label htmlFor="name">Name *</Label>
                  <ShowroomNameSearch
                    value={form.name}
                    onChange={(v) => {
                      // Typing/clearing the name breaks the tie to the selected
                      // Place → drop the placeId and any dup warning so the
                      // banner + submit-block don't linger on manual edits.
                      update({ name: v, placeId: null });
                      if (dupWarning) setDupWarning(null);
                    }}
                    onSelect={handleSelectPlace}
                    sessionTokenRef={sessionTokenRef}
                    disabled={loadingPlace}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Start typing to search Google — pick a result to auto-fill the
                    rest, or just type a name manually.
                  </p>
                  {loadingPlace && (
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Fetching details from
                      Google…
                    </div>
                  )}
                  <DiagNote diag={diagnostics.name} />
                </div>
                <div>
                  <Label>Description</Label>
                  {/* Roomier editor: force the contenteditable surface taller so
                      there's comfortable space to write the overview. */}
                  <div className="mt-1 w-full [&_[contenteditable]]:!min-h-[220px]">
                    <OverviewNoteEditor
                      key={descSeedKey}
                      initialMarkdown={form.description}
                      onChange={({ markdown }) => update({ description: markdown })}
                    />
                  </div>
                  <DiagNote diag={diagnostics.description} />
                </div>
                {/* Can't find it on Google? Skip the Place selection entirely and
                    proceed to fill everything in by hand. The typed name persists
                    (the search input is bound to form.name). Nothing here requires
                    a Place to have been selected. */}
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground ring-1 ring-border/40 transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  Can't find it? Enter the showroom manually
                </button>
              </>
            )}

            {step === 1 && (
              <>
                <div>
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" value={form.locationAddress} onChange={(e) => update({ locationAddress: e.target.value })} placeholder="123 Design St" />
                  <DiagNote diag={diagnostics.locationAddress} />
                </div>
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
                  <Label htmlFor="zip">Zip Code</Label>
                  <Input id="zip" value={form.zipCode} onChange={(e) => update({ zipCode: e.target.value })} placeholder="94103" />
                  <DiagNote diag={diagnostics.zipCode} />
                </div>
                <div>
                  <Label htmlFor="maps">Google Maps Link</Label>
                  <Input id="maps" value={form.googleMapsLink} onChange={(e) => update({ googleMapsLink: e.target.value })} placeholder="https://maps.google.com/..." />
                </div>
                <div>
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input id="phone" value={form.phoneNumber} onChange={(e) => update({ phoneNumber: e.target.value })} placeholder="(415) 555-0100" />
                  <DiagNote diag={diagnostics.phoneNumber} />
                </div>
                <div>
                  <Label htmlFor="website">Website URL</Label>
                  <Input id="website" value={form.websiteUrl} onChange={(e) => update({ websiteUrl: e.target.value })} placeholder="https://..." />
                  <DiagNote diag={diagnostics.websiteUrl} />
                </div>
              </>
            )}

            {step === 2 && (
              <div>
                <Label>Hours</Label>
                <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">
                  Toggle open days and set times. Weekend + weekday summaries are
                  derived automatically.
                </p>
                <HoursEditor value={form.hoursJson} onChange={(h) => update({ hoursJson: h })} />
                <DiagNote diag={diagnostics.hoursJson} />
              </div>
            )}

            {step === 3 && (
              <>
                <div>
                  <Label>Rating</Label>
                  <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-card px-3 py-2 ring-1 ring-border/40">
                    {typeof form.googleRating === "number" ? (
                      <>
                        <Stars rating={form.googleRating} />
                        <span className="text-xs text-muted-foreground">
                          {form.googleRating.toFixed(1)}
                          {typeof form.userRatingCount === "number"
                            ? ` (${form.userRatingCount} review${form.userRatingCount === 1 ? "" : "s"})`
                            : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">
                        No rating yet — autofilled from Google when available.
                      </span>
                    )}
                  </div>
                  <DiagNote diag={diagnostics.googleRating} />
                </div>
                <div>
                  <Label>Review summary</Label>
                  <p className="mb-1 mt-0.5 text-[11px] text-muted-foreground">
                    Autofilled from Google/AI when available — edit or hand-write it
                    as a fallback.
                  </p>
                  <OverviewNoteEditor
                    key={reviewSeedKey}
                    initialMarkdown={form.reviewSummary}
                    onChange={({ markdown }) => update({ reviewSummary: markdown })}
                  />
                  <DiagNote diag={diagnostics.reviewSummary} />
                </div>
                <div>
                  <Label>Price level</Label>
                  <div className="mt-1.5 flex gap-1.5">
                    {PRICE_POINTS.map((pp) => (
                      <Button
                        key={pp}
                        size="sm"
                        type="button"
                        variant={form.pricePoint === pp ? "default" : "outline"}
                        onClick={() => {
                          // Manually overriding clears the AI-inferred marker.
                          setPriceInferred(false);
                          update({ pricePoint: form.pricePoint === pp ? "" : pp });
                        }}
                        className="font-mono"
                      >
                        {pp}
                      </Button>
                    ))}
                  </div>
                  {priceInferred ? (
                    <p className="mt-1 text-[11px] font-medium text-amber-400">
                      Inferred from reviews (AI): {priceReasoning ?? "—"}
                    </p>
                  ) : (
                    <DiagNote diag={diagnostics.pricePoint} />
                  )}
                  {priceNoSignal && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{priceNoSignal}</p>
                  )}
                </div>
                <div>
                  <Label>Attributes</Label>
                  <div className="mt-2">
                    <FlagsEditor
                      value={{
                        isAppointmentOnly: form.isAppointmentOnly,
                        isFlagshipLocation: form.isFlagshipLocation,
                        isLargeSelection: form.isLargeSelection,
                        isBespoke: form.isBespoke,
                        isTradeRepRequired: form.isTradeRepRequired,
                      }}
                      onChange={(v) => update(v)}
                    />
                  </div>
                  {/* AI rationale for each attribute the AI set. */}
                  {Object.keys(attrRationales).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {ATTR_RATIONALE_LABELS.filter(({ key }) => attrRationales[key]).map(
                        ({ key, label }) => (
                          <p key={key} className="text-[11px] text-amber-400">
                            <span className="font-medium">AI · {label}:</span>{" "}
                            {attrRationales[key]}
                          </p>
                        ),
                      )}
                    </div>
                  )}
                </div>

                {/* Review authenticity — color-coded assessment + sources. */}
                {reviewAuthenticity && (
                  <div>
                    <Label>Review authenticity</Label>
                    {(() => {
                      const style = authenticityStyle(reviewAuthenticity.assessment);
                      return (
                        <div className="mt-1.5 rounded-lg bg-card p-3 ring-1 ring-border/40">
                          <span
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ${style.className}`}
                          >
                            {style.label}
                          </span>
                          {reviewAuthenticity.rationale && (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              {reviewAuthenticity.rationale}
                            </p>
                          )}
                          {reviewAuthenticity.sources &&
                            reviewAuthenticity.sources.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                {reviewAuthenticity.sources.map((src, i) => (
                                  <a
                                    key={`${src}-${i}`}
                                    href={src}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
                                  >
                                    <Globe className="size-3 shrink-0" />
                                    <span className="max-w-[220px] truncate">{src}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Detected brands — created on save. */}
                {detectedBrands && detectedBrands.length > 0 && (
                  <div>
                    <Label>Detected brands</Label>
                    <div className="mt-1.5 rounded-lg bg-card p-3 ring-1 ring-border/40">
                      <div className="flex flex-wrap gap-1.5">
                        {detectedBrands
                          .filter((b) => b?.name)
                          .map((b, i) => (
                            <Badge
                              key={`${b.name}-${i}`}
                              variant="secondary"
                              className="px-1.5 py-0.5 text-[10px] font-normal"
                            >
                              {b.name}
                              {b.type ? (
                                <span className="ml-1 text-muted-foreground/70">· {b.type}</span>
                              ) : null}
                            </Badge>
                          ))}
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        These will be added to this showroom on save.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Dup banner near the submit control — mirrors the Search-tab warning
              so the reason for the disabled Create button is always visible. */}
          {dupWarning && step === steps.length - 1 && (
            <div className="mt-4 rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-500/30">
              <p className="text-sm font-medium text-amber-300">
                ⚠ Already added: {dupWarning.name}
              </p>
              <a
                href={`/admin/shopping/store/${dupWarning.showroomId}`}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300"
              >
                <StoreIcon className="size-3" />
                View existing
              </a>
            </div>
          )}

          {/* AI-analysis progress — while running, the modal can't be closed or
              submitted; the user waits for Gemini to reply (or fail). */}
          {geminiPhase === "running" && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-sky-500/10 p-3 text-xs text-sky-300 ring-1 ring-sky-500/30">
              <Loader2 className="size-3.5 animate-spin" />
              Analyzing reviews with AI — please wait. You can't close or save until
              this finishes.
            </div>
          )}

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
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={
                    submitting ||
                    !form.name.trim() ||
                    dupWarning !== null ||
                    geminiPhase === "running"
                  }
                >
                  {(submitting || geminiPhase === "running") && (
                    <Loader2 className="mr-1.5 size-3 animate-spin" />
                  )}
                  {geminiPhase === "running" ? "Analyzing…" : "Create Showroom"}
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

  // Tab ↔ URL sync. Clicking a tab pushes /admin/shopping/showrooms/<tab>;
  // browser back/forward (popstate) restores the tab from the path.
  const selectTab = useCallback((tab: ViewMode) => {
    setViewMode(tab);
    if (typeof window !== "undefined") {
      const next = `/admin/shopping/showrooms/${tab}`;
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
          hours: s.hours ?? [],
          heroImageCfImagesUrl: s.heroImageCfImagesUrl ?? null,
          latitude: s.latitude ?? null,
          longitude: s.longitude ?? null,
          googleRating: s.googleRating ?? null,
          userRatingCount: s.userRatingCount ?? null,
          isLargeSelection: s.isLargeSelection ?? false,
          isBespoke: s.isBespoke ?? false,
          isTradeRepRequired: s.isTradeRepRequired ?? false,
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
      if (filters.openNow && !isOpenNowStructured(s.hours, pst)) return false;
      if (filters.visited === "visited" && s.userRating == null) return false;
      if (filters.visited === "unvisited" && s.userRating != null) return false;
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
          <ManageShowroomsModal onDone={fetchStores} />
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
