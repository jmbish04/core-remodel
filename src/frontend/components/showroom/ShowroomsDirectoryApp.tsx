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
  Award,
  Blocks,
  CalendarClock,
  ChevronDown,
  Clock,
  DoorOpen,
  Droplets,
  ExternalLink,
  Flame,
  Globe,
  Grid3x3,
  Instagram,
  Layers,
  LayoutGrid,
  LayoutList,
  Lightbulb,
  Loader2,
  Mail,
  Map as MapIcon,
  MapPin,
  Moon,
  Navigation,
  PaintBucket,
  Phone,
  Plus,
  Rows3,
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
import {
  DEFAULT_HOURS,
  type DayKey,
  type HoursJson,
  weekdayWeekendLines,
} from "./intake/hours-types";
import {
  computeShowroomStatus,
  fmtHm,
  isOpenNow as isOpenNowStructured,
  pstNow,
  type HourRow,
  type PstNow,
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
  /** Multi-location summary (0045/0047) — count + unique cities sorted asc, from the list API. */
  locationCount?: number;
  locationCities?: string[];
  hubRoute: string | null;
  hubName: string | null;
  /** Captured coordinates — power the individual map markers when zoomed in. */
  latitude: number | null;
  longitude: number | null;
  categories: string[];
  /** Business-model type (joined from showroom_store_type); null = untyped. */
  typeId: number | null;
  typeName: string | null;
  typeColor: string | null;
  /** Aggregated external review-platform rating (Yelp/Google/etc). */
  onlineRating: number | null;
  onlineRatingCount: number;
  /** Homeowner's own visit rating; null → not yet visited. */
  userRating: number | null;
  isAppointmentOnly: boolean;
  isFlagshipLocation: boolean;
  /** Structured weekly hours (7-key {open,close}|null); source of truth for hours display. */
  hoursJson: HoursJson | null;
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

interface StoreType {
  id: number;
  key: string;
  displayName: string;
  htmlColor: string | null;
}

interface City {
  id: number;
  bayAreaCityName: string;
  hubRoute: string | null;
  hubName: string | null;
}

type ViewMode = "grouped" | "map";

/** How the grouped experience buckets the active region's stores. */
type GroupBy = "category" | "rating" | "flagship" | "closing";

/** Cards vs compact table within a group. */
type Layout = "cards" | "rows";

// ─── Constants ────────────────────────────────────────────────────────────────

const HUBS: Record<string, { name: string; lng: number; lat: number }> = {
  // Bay Area hubs (fine-grained).
  A: { name: "SF Design District", lng: -122.4194, lat: 37.7749 },
  B: { name: "Silicon Valley & South Bay", lng: -121.8863, lat: 37.3382 },
  C: { name: "Peninsula / Mid-Market", lng: -122.2603, lat: 37.5072 },
  D: { name: "East Bay", lng: -122.2712, lat: 37.8044 },
  E: { name: "North Bay", lng: -122.545, lat: 37.906 },
  // Rest of California (metro-grained). Keep keys + centroids in sync with
  // CA_REGIONS in src/backend/lib/bay-area-region.ts.
  SAC: { name: "Sacramento / Capital", lng: -121.4944, lat: 38.5816 },
  CCST: { name: "Central Coast", lng: -121.4, lat: 36.3 },
  CVAL: { name: "Central Valley", lng: -119.78, lat: 36.74 },
  LA: { name: "Los Angeles / SoCal", lng: -118.2437, lat: 34.0522 },
  SD: { name: "San Diego", lng: -117.1611, lat: 32.7157 },
  NST: { name: "North State", lng: -122.0, lat: 39.8 },
};

/** Bucket key for stores with no recognized California region (e.g. out of state). */
const OTHER_HUB = "OTHER";

/**
 * Generous California bounding box — mirrors `isInCalifornia` in the backend
 * region lib. Keeps the map's auto-frame focused on California so an
 * out-of-state showroom (a Texas Costco, a Florida vendor) can't zoom the map
 * out to the whole country. Out-of-state pins are still drawn; they just don't
 * drive the default framing.
 */
function isInCaliforniaView(lat: number, lng: number): boolean {
  return lat >= 32.3 && lat <= 42.2 && lng >= -124.6 && lng <= -114.0;
}

/** Short region label per hub — filters & markers show this, never the code. */
const HUB_LABEL: Record<string, string> = {
  A: "SF",
  B: "South Bay",
  C: "Peninsula",
  D: "East Bay",
  E: "North Bay",
  SAC: "Sacramento",
  CCST: "Central Coast",
  CVAL: "Central Valley",
  LA: "Los Angeles",
  SD: "San Diego",
  NST: "North State",
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

const WEEKDAY_DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri"];
const WEEKEND_DAY_KEYS: DayKey[] = ["sat", "sun"];

/** Live open/closed chip for a column: derived from computeShowroomStatus. */
type ColumnState = "open" | "closing" | "closed" | null;

/** A single hours column (weekday / weekend). */
function HoursColumn({
  label,
  text,
  openLate,
  state,
  emptyBadge,
}: {
  label: string;
  text: string | null;
  openLate: boolean;
  state: ColumnState;
  emptyBadge?: string;
}) {
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
              aria-label="Open past 6 PM"
            />
          )}
        </div>
      )}
      {text && state === "closing" && (
        <span className="mt-0.5 inline-block rounded bg-amber-500/15 px-1 text-[8px] font-medium text-amber-300">
          Closing soon
        </span>
      )}
      {text && state === "closed" && (
        <span className="mt-0.5 inline-block rounded bg-rose-500/15 px-1 text-[8px] font-medium text-rose-300">
          Closed
        </span>
      )}
      {text && state === "open" && (
        <span className="mt-0.5 inline-block rounded bg-emerald-500/15 px-1 text-[8px] font-medium text-emerald-300">
          Open
        </span>
      )}
    </div>
  );
}

function HoursFooter({ store, pst, className }: { store: Store; pst: PstNow; className?: string }) {
  const hj = store.hoursJson;
  const lines = hj ? weekdayWeekendLines(hj) : null;

  // Text lines come from structured hours; an empty column (no open days that
  // group) shows the em-dash / emptyBadge instead of a summary.
  const hasWeekday = WEEKDAY_DAY_KEYS.some((k) => hj?.[k] != null);
  const hasWeekend = WEEKEND_DAY_KEYS.some((k) => hj?.[k] != null);
  const weekdayText = hasWeekday ? lines?.weekday ?? null : null;
  const weekendText = hasWeekend ? lines?.weekend ?? null : null;

  // "Open late" (Moon): any day in the column closes at/after 6 PM.
  const weekdayLate = WEEKDAY_DAY_KEYS.some((k) => (hj?.[k]?.close ?? "") >= "18:00");
  const weekendLate = WEEKEND_DAY_KEYS.some((k) => (hj?.[k]?.close ?? "") >= "18:00");

  // Live status for TODAY's actual row; shown only on the applicable column.
  const isWeekday = pst.day >= 1 && pst.day <= 5;
  const isWeekend = pst.day === 0 || pst.day === 6;
  const status = computeShowroomStatus(store.hours, pst)?.status ?? null;
  const chip: ColumnState = status === "closing-soon" ? "closing" : status;

  return (
    <div className={`grid grid-cols-3 gap-2 ${className ?? ""}`}>
      <HoursColumn
        label="Mon–Fri"
        text={weekdayText}
        openLate={weekdayLate}
        state={isWeekday ? chip : null}
      />
      <HoursColumn
        label="Weekend"
        text={weekendText}
        openLate={weekendLate}
        state={isWeekend ? chip : null}
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

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface Filters {
  search: string;
  categories: string[];
  /** Business-model type filter — a showroom_store_type id, or null for all. */
  type: number | null;
  openNow: boolean;
  visited: "all" | "visited" | "unvisited";
}

const EMPTY_FILTERS: Filters = {
  search: "",
  categories: [],
  type: null,
  openNow: false,
  visited: "all",
};

/**
 * The lean filter bar for the grouped experience. Region is a top-level tab
 * strip (not a filter here); grouping is a separate switcher. This bar carries
 * search, business-model type, an Open-Now toggle (live PST), a visit-status
 * segment, and the category multi-select.
 */
function FilterBar({
  filters,
  onChange,
  allCategories,
  allTypes,
  pst,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  allCategories: Category[];
  allTypes: StoreType[];
  pst: PstNow;
}) {
  const hasActiveFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or category…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="pl-8"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
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
              { id: "unvisited", label: "Unvisited" },
              { id: "visited", label: "Visited" },
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

        {allTypes.length > 0 ? (
          <>
            <div className="mx-1 h-5 w-px bg-border/40" />
            {/* Business-model type chips — color-dotted, single-select toggle. */}
            {allTypes.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={filters.type === t.id ? "default" : "outline"}
                onClick={() =>
                  onChange({ ...filters, type: filters.type === t.id ? null : t.id })
                }
                className="h-7 gap-1.5 text-[11px]"
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full ring-1 ring-border/60"
                  style={{ backgroundColor: t.htmlColor ?? "transparent" }}
                />
                {t.displayName}
              </Button>
            ))}
          </>
        ) : null}

        <div className="mx-1 h-5 w-px bg-border/40" />

        {/* Category multi-select */}
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

// ─── View Toggle (Grouped / Map) ────────────────────────────────────────────────

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const views: { id: ViewMode; label: string; Icon: ComponentType<{ className?: string }> }[] = [
    { id: "grouped", label: "Grouped", Icon: LayoutList },
    { id: "map", label: "Map", Icon: MapIcon },
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

/**
 * Marker colour by showroom TYPE (its first registered category). Specific
 * specialties get a hand-picked hue; anything else hashes deterministically into
 * a palette so the same category always draws the same colour. Inline hex (not
 * Tailwind classes) keeps the colour JIT-safe for arbitrary category names.
 * No legend by design — the colour is an at-a-glance grouping cue on the map.
 */
const CATEGORY_COLOR_RULES: { test: RegExp; color: string }[] = [
  { test: /plumb|bath|faucet|sink|shower|tub|vanity/i, color: "#38bdf8" },
  { test: /light/i, color: "#f59e0b" },
  { test: /floor|hardwood|wood|vinyl|carpet/i, color: "#b45309" },
  { test: /tile|stone|slab|porcelain|mosaic|backsplash/i, color: "#14b8a6" },
  { test: /counter|granite|quartz|marble/i, color: "#8b5cf6" },
  { test: /kitchen|cabinet|appliance|range|oven|refriger/i, color: "#ef4444" },
  { test: /window/i, color: "#0ea5e9" },
  { test: /door|hardware|hinge|lock/i, color: "#eab308" },
  { test: /closet|storage|organiz/i, color: "#ec4899" },
  { test: /paint|finish/i, color: "#f97316" },
  { test: /rug|textile|fabric|drapery/i, color: "#d946ef" },
  { test: /wall.?cover|wallpaper/i, color: "#22c55e" },
  { test: /furniture|decor|art/i, color: "#f43f5e" },
  { test: /outdoor|landscape|garden|patio/i, color: "#84cc16" },
  { test: /water|filtration/i, color: "#06b6d4" },
  { test: /smart|automation/i, color: "#6366f1" },
];
const CATEGORY_PALETTE = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#34d399",
  "#22d3ee",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#e879f9",
];
/** Default (no category) — emerald, matching the app's neutral pin colour. */
const DEFAULT_MARKER_COLOR = "#10b981";

function colorForCategory(category: string | null | undefined): string {
  if (!category) return DEFAULT_MARKER_COLOR;
  for (const rule of CATEGORY_COLOR_RULES) if (rule.test.test(category)) return rule.color;
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

/** A pin for a single showroom, positioned by its captured coordinates. */
function ShowroomMarker({ store }: { store: Store }) {
  // Colour by the FIRST registered category (the store's primary type).
  const color = colorForCategory(store.categories[0]);
  return (
    <MapMarker longitude={store.longitude as number} latitude={store.latitude as number}>
      <MarkerContent className="z-10">
        <div
          className="flex size-6 items-center justify-center rounded-full ring-2 ring-white/80 shadow-lg transition-transform hover:scale-110"
          style={{ backgroundColor: color }}
        >
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

/** Region display order for map groups: HUBS order first, "Other" always last. */
const HUB_ROUTE_ORDER = Object.keys(HUBS);
function hubRouteRank(route: string): number {
  if (route === OTHER_HUB) return Number.MAX_SAFE_INTEGER;
  const i = HUB_ROUTE_ORDER.indexOf(route);
  return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
}

function MapView({ stores, pst }: { stores: Store[]; pst: PstNow }) {
  const byHub = useMemo(() => {
    const map = new Map<string, Store[]>();
    for (const s of stores) {
      // Unrecognized / out-of-state stores fall into an "Other" bucket so they
      // stay listed (and their pins still render) — they just don't get a
      // dedicated California region group.
      const route = s.hubRoute && HUBS[s.hubRoute] ? s.hubRoute : OTHER_HUB;
      map.set(route, [...(map.get(route) ?? []), s]);
    }
    return map;
  }, [stores]);

  const hubEntries = useMemo(
    () => Array.from(byHub.entries()).sort((a, b) => hubRouteRank(a[0]) - hubRouteRank(b[0])),
    [byHub],
  );
  const hubKeys = useMemo(() => hubEntries.map(([route]) => route), [hubEntries]);

  // Stores with captured coordinates get an individual pin.
  const geoStores = useMemo(
    () => stores.filter((s) => s.latitude != null && s.longitude != null),
    [stores],
  );
  const noGeoCount = stores.length - geoStores.length;

  // The device's geolocation ("you are here"), when granted. Works on phones
  // and the in-car (Tesla) browser via the standard Geolocation API. Reported
  // to the server so the getUserLocation MCP tool can answer "showrooms near me".
  const [userLoc, setUserLoc] = useState<{ lng: number; lat: number } | null>(null);

  const reportLocation = useCallback((lat: number, lng: number) => {
    // Best-effort — a failure here never affects the map.
    void fetch("/api/showroom-stores/device-location", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng, source: "browser" }),
    }).catch(() => {});
  }, []);

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lng: pos.coords.longitude, lat: pos.coords.latitude });
        reportLocation(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        /* denied / unavailable — the map simply won't show a location dot */
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, [reportLocation]);

  // Best-effort location on mount (a permission prompt the first time). The
  // locate button in MapControls re-requests + flies to the dot on demand.
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // Auto-expand the region group NEAREST the user's location (others collapse):
  // open Oakland's group when the user is in Oakland at open time, etc. Chosen
  // among the regions that actually have showrooms so it never opens an empty
  // group. Null (no location yet / denied) → the accordion keeps its default.
  const preferredHub = useMemo(() => {
    if (!userLoc || hubKeys.length === 0) return null;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const route of hubKeys) {
      const hub = HUBS[route];
      if (!hub) continue;
      const dLat = hub.lat - userLoc.lat;
      const dLng = hub.lng - userLoc.lng;
      const dist = dLat * dLat + dLng * dLng;
      if (dist < bestDist) {
        bestDist = dist;
        best = route;
      }
    }
    return best;
  }, [userLoc, hubKeys]);

  const { openKey, toggle } = useAccordionGroup(hubKeys, preferredHub);

  // Frame the map around the showrooms currently in view, so markers are
  // visible without hunting. Recomputes when the filtered set changes; free
  // pan/zoom in between via onViewportChange.
  //
  // Deliberately excludes the user's location: the "find my location" control
  // already flies to the user's dot on demand, and folding a possibly-distant
  // location into the bounding box would either over-zoom the map out or fight
  // that flyTo animation the moment it updates userLoc.
  //
  // Also EXCLUDES out-of-state showrooms: a store logged in Texas or Florida is
  // still drawn as a pin, but must not drag the auto-frame out to span the whole
  // country. Framing to California keeps the map useful for the local directory;
  // if no in-state showrooms exist, viewportForPoints falls back to the Bay Area.
  const framePoints = useMemo<Array<[number, number]>>(
    () =>
      geoStores
        .filter((s) => isInCaliforniaView(s.latitude as number, s.longitude as number))
        .map((s) => [s.longitude as number, s.latitude as number]),
    [geoStores],
  );

  const frameKey = useMemo(
    () => framePoints.map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`).join("|"),
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
                    {HUB_LABEL[route] ?? "Other / Out of State"}
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

// ─── Grouped Experience ─────────────────────────────────────────────────────────

/** Enum weekday → JS getDay() index — for pulling today's row out of `hours`. */
const DAY_ENUM_INDEX: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

/** Best rating we have for a store: prefer Google, else the aggregate online one. */
function bestRating(s: Store): number | null {
  return s.googleRating ?? s.onlineRating ?? null;
}

/** Minutes-since-midnight the store closes TODAY, or null if closed today. */
function closeMinutesToday(s: Store, pst: PstNow): number | null {
  const row = s.hours.find((h) => DAY_ENUM_INDEX[h.day] === pst.day);
  return row ? row.closeHour * 60 + row.closeMinute : null;
}

/** Average best-rating over a group (1-decimal), or null if none are rated. */
function avgRatingOf(stores: Store[]): number | null {
  let sum = 0;
  let n = 0;
  for (const s of stores) {
    const r = bestRating(s);
    if (r != null) {
      sum += r;
      n++;
    }
  }
  return n > 0 ? Math.round((sum / n) * 10) / 10 : null;
}

/** Nearest region (by squared-degree distance) among those that have stores. */
function nearestRegion(loc: { lat: number; lng: number }, available: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const r of available) {
    const hub = HUBS[r];
    if (!hub) continue;
    const d = (hub.lat - loc.lat) ** 2 + (hub.lng - loc.lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best;
}

/**
 * Bucket the active region's stores by the chosen dimension. A category store
 * appears under EACH of its categories. Groups come back in display order.
 */
function groupStores(stores: Store[], groupBy: GroupBy, pst: PstNow): [string, Store[]][] {
  const map = new Map<string, Store[]>();
  const push = (k: string, s: Store) => map.set(k, [...(map.get(k) ?? []), s]);

  if (groupBy === "category") {
    for (const s of stores) {
      if (s.categories.length === 0) push("Uncategorized", s);
      else for (const c of s.categories) push(c, s);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if ((a[0] === "Uncategorized") !== (b[0] === "Uncategorized"))
        return a[0] === "Uncategorized" ? 1 : -1;
      return b[1].length - a[1].length;
    });
  }

  if (groupBy === "rating") {
    for (const s of stores) {
      const r = bestRating(s);
      push(r == null ? "Unrated" : `${Math.floor(r)}★`, s);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const av = a[0] === "Unrated" ? -1 : parseInt(a[0], 10);
      const bv = b[0] === "Unrated" ? -1 : parseInt(b[0], 10);
      return bv - av; // highest rating first, "Unrated" last
    });
  }

  if (groupBy === "flagship") {
    for (const s of stores)
      push(s.isFlagshipLocation ? "Flagship locations" : "Other locations", s);
    return Array.from(map.entries()).sort((a, b) =>
      a[0] === "Flagship locations" ? -1 : b[0] === "Flagship locations" ? 1 : 0,
    );
  }

  // closing time — open stores bucketed by close time; closed → one bucket.
  for (const s of stores) {
    const cm = isOpenNowStructured(s.hours, pst) ? closeMinutesToday(s, pst) : null;
    push(cm == null ? "Currently Closed" : `Closes ${fmtHm(Math.floor(cm / 60), cm % 60)}`, s);
  }
  return Array.from(map.entries()).sort((a, b) => {
    const closedA = a[0] === "Currently Closed";
    const closedB = b[0] === "Currently Closed";
    if (closedA !== closedB) return closedA ? 1 : -1;
    return (closeMinutesToday(a[1][0], pst) ?? 0) - (closeMinutesToday(b[1][0], pst) ?? 0);
  });
}

/** Split a group into open-now (earliest close first) and closed-now stores. */
function partitionGroup(stores: Store[], pst: PstNow): { open: Store[]; closed: Store[] } {
  const open: Store[] = [];
  const closed: Store[] = [];
  for (const s of stores) (isOpenNowStructured(s.hours, pst) ? open : closed).push(s);
  open.sort(
    (a, b) => (closeMinutesToday(a, pst) ?? Infinity) - (closeMinutesToday(b, pst) ?? Infinity),
  );
  return { open, closed };
}

// ── detail-modal helpers ─────────────────────────────────────────────────────

/** Weekly-hours render order (Mon→Sun) with each day's JS index for "today". */
const WEEK_ROWS: { key: DayKey; label: string; idx: number }[] = [
  { key: "mon", label: "Monday", idx: 1 },
  { key: "tue", label: "Tuesday", idx: 2 },
  { key: "wed", label: "Wednesday", idx: 3 },
  { key: "thu", label: "Thursday", idx: 4 },
  { key: "fri", label: "Friday", idx: 5 },
  { key: "sat", label: "Saturday", idx: 6 },
  { key: "sun", label: "Sunday", idx: 0 },
];

/** "HH:MM" 24-hour string → "5:00 PM"; passes odd input through unchanged. */
function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? fmtHm(h, m) : hhmm;
}

/** Google Maps directions URL — Tesla's browser offers one-tap Navigate on these. */
function mapsNavUrl(s: Store): string {
  const dest =
    s.latitude != null && s.longitude != null
      ? `${s.latitude},${s.longitude}`
      : `${s.name} ${s.locationAddress ?? ""}`.trim();
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

/** POST the destination to the real Tessie bridge; toast on success/failure. */
async function sendToTesla(s: Store) {
  try {
    const label = [s.name, s.locationAddress].filter(Boolean).join(", ");
    const body =
      s.latitude != null && s.longitude != null
        ? { lat: s.latitude, lng: s.longitude, destination: label }
        : { destination: label };
    const res = await fetch("/api/tesla/navigate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.ok === false) throw new Error(data.error ?? `Failed (${res.status})`);
    toast.success("Destination sent to your Tesla");
  } catch (e) {
    console.error("[showrooms/tesla-nav]", e);
    toast.error(e instanceof Error ? e.message : "Tesla navigation failed");
  }
}

/** Tesla "T" wordmark glyph (same path as the drives viewport). */
function TeslaGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 4.6c2.3 0 4.2.5 5.1 1.3l1.1-1.9C16.9 3.3 14.6 2.9 12 2.9s-4.9.4-6.2 1.1l1.1 1.9c.9-.8 2.8-1.3 5.1-1.3zM12 6.2c-2 0-3.6.3-4.4.8l1.5 2.4c.6-.3 1.6-.5 2.9-.5s2.3.2 2.9.5l1.5-2.4c-.8-.5-2.4-.8-4.4-.8zM10.9 10.2v9.9h2.2v-9.9c-.4 0-.7-.1-1.1-.1s-.7.1-1.1.1z" />
    </svg>
  );
}

const DETAIL_STATUS_CHIP: Record<string, string> = {
  open: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  "closing-soon": "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  closed: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30",
};
const DETAIL_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  "closing-soon": "Closing soon",
  closed: "Closed",
};

/** Full-detail quick-look modal opened from a card or row click. */
function StoreDetailModal({
  store,
  pst,
  onClose,
}: {
  store: Store | null;
  pst: PstNow;
  onClose: () => void;
}) {
  const s = store;
  const status = s ? computeShowroomStatus(s.hours, pst) : null;
  const rating = s ? bestRating(s) : null;
  const heroSrc = s ? (s.heroImageCfImagesUrl ?? s.iconCfImagesUrl) : null;
  const reviewCount = s ? (s.userRatingCount ?? s.onlineRatingCount) : 0;

  return (
    <Dialog open={s != null} onOpenChange={(next) => !next && onClose()}>
      {s && (
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {s.name}
              {s.pricePoint && (
                <span className="font-mono text-sm text-emerald-300">{s.pricePoint}</span>
              )}
            </DialogTitle>
            <DialogDescription>
              {[s.cityName ?? s.hubName, s.typeName].filter(Boolean).join(" · ") ||
                "Showroom details"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Photo */}
            <div className="relative aspect-video overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
              {heroSrc ? (
                <img src={heroSrc} alt="" className="size-full object-cover" />
              ) : (
                <div
                  className={`flex size-full items-center justify-center text-3xl font-semibold ${avatarColor(s.name)}`}
                >
                  {s.name.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            {/* Facts */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {rating != null && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-4 fill-amber-400 text-amber-400" />
                    <span className="font-semibold">{rating.toFixed(1)}</span>
                    {reviewCount ? (
                      <span className="text-muted-foreground">({reviewCount})</span>
                    ) : null}
                  </span>
                )}
                {s.userRating != null && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-4 fill-sky-400 text-sky-400" />
                    <span className="font-semibold">{s.userRating.toFixed(1)}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      your rating
                    </span>
                  </span>
                )}
              </div>
              {status && (
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${DETAIL_STATUS_CHIP[status.status]}`}
                  >
                    {DETAIL_STATUS_LABEL[status.status]}
                  </span>
                  <span className="text-muted-foreground">{status.label}</span>
                </div>
              )}
              {s.categories.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.categories.map((c) => (
                    <Badge
                      key={c}
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px] font-normal"
                    >
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
              {s.locationAddress && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 size-4 shrink-0" />
                  {s.locationAddress}
                </p>
              )}
            </div>
          </div>

          {/* Weekly hours */}
          <div className="mt-2">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Weekly hours
            </h3>
            {s.hoursJson ? (
              <div className="divide-y divide-border/40 overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
                {WEEK_ROWS.map(({ key, label, idx }) => {
                  const w = s.hoursJson?.[key];
                  const today = idx === pst.day;
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between px-3 py-1.5 text-sm ${today ? "bg-primary/5" : ""}`}
                    >
                      <span
                        className={today ? "font-semibold text-foreground" : "text-muted-foreground"}
                      >
                        {label}
                        {today ? " · Today" : ""}
                      </span>
                      <span className={w ? "text-foreground" : "text-muted-foreground/60"}>
                        {w ? `${fmtClock(w.open)} – ${fmtClock(w.close)}` : "Closed"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Hours not available yet.</p>
            )}
            {s.isAppointmentOnly && (
              <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-violet-300">
                <CalendarClock className="size-3" /> By appointment
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {s.phoneNumber && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                render={<a href={telHref(s.phoneNumber)} />}
              >
                <Phone className="size-3.5" /> Call
              </Button>
            )}
            {s.websiteUrl && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                render={<a href={s.websiteUrl} target="_blank" rel="noreferrer" />}
              >
                <Globe className="size-3.5" /> Website
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              render={<a href={mapsNavUrl(s)} target="_blank" rel="noreferrer" />}
            >
              <Navigation className="size-3.5" /> Google Maps
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => sendToTesla(s)}>
              <TeslaGlyph className="size-3.5" /> Tesla Nav
            </Button>
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              render={<a href={`/admin/shopping/store/${s.id}`} />}
            >
              <ExternalLink className="size-3.5" /> View full details
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** One compact table row — the whole row opens the detail modal. */
function StoreRow({ store, pst, onOpen }: { store: Store; pst: PstNow; onOpen: () => void }) {
  const status = computeShowroomStatus(store.hours, pst);
  const rating = bestRating(store);
  const heroSrc = store.heroImageCfImagesUrl ?? store.iconCfImagesUrl;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40"
    >
      <div className="size-9 shrink-0 overflow-hidden rounded-md bg-card ring-1 ring-border/40">
        {heroSrc ? (
          <img src={heroSrc} alt="" className="size-full object-cover" />
        ) : (
          <div
            className={`flex size-full items-center justify-center text-[10px] font-semibold ${avatarColor(store.name)}`}
          >
            {store.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{store.name}</span>
          {store.pricePoint && (
            <span className="font-mono text-[10px] text-emerald-300">{store.pricePoint}</span>
          )}
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {store.cityName ?? store.hubName ?? ""}
        </span>
      </div>
      {store.typeName && (
        <span
          className="hidden shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex"
          style={
            store.typeColor
              ? { backgroundColor: `${store.typeColor}1f`, color: store.typeColor }
              : undefined
          }
        >
          {store.typeName}
        </span>
      )}
      <span className="hidden w-14 shrink-0 items-center gap-1 text-xs sm:flex">
        {rating != null ? (
          <>
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            {rating.toFixed(1)}
          </>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </span>
      <span className="hidden w-44 shrink-0 sm:block">
        {status ? (
          <span className="flex items-center gap-1.5 text-[11px]">
            <span
              className={`size-2 shrink-0 rounded-full ${status.status === "open" ? "bg-emerald-400" : status.status === "closing-soon" ? "bg-amber-400" : "bg-rose-400"}`}
            />
            <span className="truncate text-muted-foreground">{status.label}</span>
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">Hours unknown</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2" onClick={stop}>
        {store.phoneNumber && (
          <a
            href={telHref(store.phoneNumber)}
            aria-label="Call"
            className="text-sky-400 hover:text-sky-300"
          >
            <Phone className="size-4" />
          </a>
        )}
        {store.websiteUrl && (
          <a
            href={store.websiteUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Website"
            className="text-muted-foreground hover:text-foreground"
          >
            <Globe className="size-4" />
          </a>
        )}
      </span>
    </div>
  );
}

/**
 * One group's body: open stores first (earliest close first), closed stores
 * folded into a single expandable banner. Cards or rows per the layout toggle.
 */
function GroupSection({
  stores,
  pst,
  layout,
  onOpenDetail,
}: {
  stores: Store[];
  pst: PstNow;
  layout: Layout;
  onOpenDetail: (s: Store) => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const { open, closed } = useMemo(() => partitionGroup(stores, pst), [stores, pst]);

  const renderStores = (list: Store[], dimmed: boolean) =>
    layout === "cards" ? (
      <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 ${dimmed ? "opacity-60" : ""}`}>
        {list.map((s) => (
          <div
            key={s.id}
            className="cursor-pointer"
            onClick={(e) => {
              // The card's stretched <a> bubbles here; cancel its navigation and
              // open the modal instead. Inner tel/website links stopPropagation.
              e.preventDefault();
              onOpenDetail(s);
            }}
          >
            <ShowroomMergedCard store={s} pst={pst} href={`/admin/shopping/store/${s.id}`} />
          </div>
        ))}
      </div>
    ) : (
      <div
        className={`divide-y divide-border/40 overflow-hidden rounded-lg bg-card ring-1 ring-border/40 ${dimmed ? "opacity-60" : ""}`}
      >
        {list.map((s) => (
          <StoreRow key={s.id} store={s} pst={pst} onOpen={() => onOpenDetail(s)} />
        ))}
      </div>
    );

  return (
    <div className="space-y-3">
      {open.length > 0 ? renderStores(open, false) : closed.length === 0 ? <EmptyState /> : null}
      {closed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
            className="flex w-full items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <ChevronDown
              className={`size-3.5 shrink-0 transition-transform ${showClosed ? "" : "-rotate-90"}`}
            />
            <span className="shrink-0 font-medium text-foreground">{closed.length} closed now</span>
            <span className="truncate">— {closed.map((s) => s.name).join(", ")}</span>
          </button>
          {showClosed && <div className="mt-3">{renderStores(closed, true)}</div>}
        </div>
      )}
    </div>
  );
}

/** Non-category group-header icon chip. */
function GroupIcon({ groupBy }: { groupBy: GroupBy }) {
  const Icon = groupBy === "rating" ? Star : groupBy === "flagship" ? Award : Clock;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  );
}

/** The grouped accordion + shared detail modal for the active region's stores. */
function GroupedExperience({
  stores,
  pst,
  groupBy,
  layout,
}: {
  stores: Store[];
  pst: PstNow;
  groupBy: GroupBy;
  layout: Layout;
}) {
  const groups = useMemo(() => groupStores(stores, groupBy, pst), [stores, groupBy, pst]);
  const orderedKeys = useMemo(() => groups.map(([label]) => label), [groups]);
  const { openKey, toggle } = useAccordionGroup(orderedKeys);
  const [detail, setDetail] = useState<Store | null>(null);

  if (groups.length === 0) return <EmptyState />;

  return (
    <div>
      {groups.map(([label, groupStores]) => {
        const openN = groupStores.filter((s) => isOpenNowStructured(s.hours, pst)).length;
        const avg = avgRatingOf(groupStores);
        const style = groupBy === "category" ? categoryIconStyleFor(label) : null;
        return (
          <CollapsibleGroup
            key={label}
            open={openKey === label}
            onToggle={() => toggle(label)}
            className="mt-8 first:mt-0"
            header={
              <>
                {style ? (
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${style.className}`}
                  >
                    <style.Icon className="size-4" />
                  </span>
                ) : (
                  <GroupIcon groupBy={groupBy} />
                )}
                <h2 className="text-base font-semibold">{label}</h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  {groupStores.length}
                </span>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {avg != null && (
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="size-3 fill-amber-400 text-amber-400" />
                      {avg.toFixed(1)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    {openN} open
                  </span>
                </span>
                <span className="ml-auto h-px flex-1 bg-border/40" />
              </>
            }
          >
            <GroupSection
              stores={groupStores}
              pst={pst}
              layout={layout}
              onOpenDetail={setDetail}
            />
          </CollapsibleGroup>
        );
      })}
      <StoreDetailModal store={detail} pst={pst} onClose={() => setDetail(null)} />
    </div>
  );
}

// ─── Region tabs, switchers, locator strip ──────────────────────────────────────

/** Region tab strip with live badge counts + an "All" tab. */
function RegionTabs({
  counts,
  total,
  active,
  onSelect,
}: {
  counts: Map<string, number>;
  total: number;
  active: string | null;
  onSelect: (r: string | null) => void;
}) {
  const regions = Object.keys(HUBS).filter((r) => (counts.get(r) ?? 0) > 0);
  const chip = (key: string, label: string, count: number, isActive: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
        isActive
          ? "bg-primary/15 text-primary ring-1 ring-primary/40"
          : "bg-card text-muted-foreground ring-1 ring-border/40 hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-[10px] font-semibold ${isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}
      >
        {count}
      </span>
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {chip("all", "All", total, active === null, () => onSelect(null))}
      {regions.map((r) =>
        chip(r, HUB_LABEL[r] ?? r, counts.get(r) ?? 0, active === r, () => onSelect(r)),
      )}
    </div>
  );
}

const GROUP_OPTIONS: { id: GroupBy; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "category", label: "Category", Icon: Grid3x3 },
  { id: "rating", label: "Rating", Icon: Star },
  { id: "flagship", label: "Flagship", Icon: Award },
  { id: "closing", label: "Closing time", Icon: Clock },
];

function GroupBySwitcher({ value, onChange }: { value: GroupBy; onChange: (g: GroupBy) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Group by</span>
      <div className="flex gap-1 rounded-lg bg-card p-0.5 ring-1 ring-border/40">
        {GROUP_OPTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition ${
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
    </div>
  );
}

function LayoutToggle({ value, onChange }: { value: Layout; onChange: (l: Layout) => void }) {
  const opts: { id: Layout; label: string; Icon: ComponentType<{ className?: string }> }[] = [
    { id: "cards", label: "Cards", Icon: LayoutGrid },
    { id: "rows", label: "Rows", Icon: Rows3 },
  ];
  return (
    <div className="flex gap-1 rounded-lg bg-card p-0.5 ring-1 ring-border/40">
      {opts.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition ${
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

/**
 * Compact header locator strip — a framed bar with a pulsing "you are here" dot
 * (respects prefers-reduced-motion), the active region label, and a live count.
 * The maplibre map lives in the Map view; this is the cheap always-on locator.
 */
function HeaderLocatorStrip({
  userLoc,
  regionLabel,
  count,
}: {
  userLoc: { lng: number; lat: number } | null;
  regionLabel: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-card px-3 py-2 ring-1 ring-border/40">
      <span className="relative flex size-3 items-center justify-center">
        {userLoc ? (
          <>
            <span className="absolute inline-flex size-3 rounded-full bg-sky-400/50 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
          </>
        ) : (
          <span className="inline-flex size-2 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <MapPin className="size-4 text-sky-400" aria-hidden />
      <span className="text-sm font-medium">{regionLabel}</span>
      <span className="text-xs text-muted-foreground">
        {count} showroom{count === 1 ? "" : "s"}
      </span>
      <span className="ml-auto text-[11px] text-muted-foreground/70">
        {userLoc ? "Your location is on" : "Location off"}
      </span>
    </div>
  );
}

/** Best-effort device geolocation + a fire-and-forget report to the server. */
function useDeviceLocation(): { lng: number; lat: number } | null {
  const [loc, setLoc] = useState<{ lng: number; lat: number } | null>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ lng: pos.coords.longitude, lat: pos.coords.latitude });
        void fetch("/api/showroom-stores/device-location", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            source: "browser",
          }),
        }).catch(() => {});
      },
      () => {
        /* denied / unavailable — region falls back to SF */
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, []);
  return loc;
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
  // the freshly mapped AI summary copy.
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

const VALID_TABS: ViewMode[] = ["grouped", "map"];

function isViewMode(v: string | undefined | null): v is ViewMode {
  return v != null && (VALID_TABS as string[]).includes(v);
}

export function ShowroomsDirectoryApp({ initialTab = "grouped" }: { initialTab?: ViewMode }) {
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [types, setTypes] = useState<StoreType[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [viewMode, setViewMode] = useState<ViewMode>(initialTab);
  const [pst, setPst] = useState<PstNow>(() => pstNow());
  // Grouped-experience controls.
  const [region, setRegion] = useState<string | null>(null);
  const [regionSource, setRegionSource] = useState<"none" | "default" | "geo" | "user">("none");
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [layout, setLayout] = useState<Layout>("cards");
  const userLoc = useDeviceLocation();

  const selectRegion = useCallback((r: string | null) => {
    setRegionSource("user");
    setRegion(r);
  }, []);

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
      setViewMode(isViewMode(seg) ? seg : "grouped");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Keep the PST clock (Open Now filter + live hours cues) fresh each minute.
  useEffect(() => {
    const id = setInterval(() => setPst(pstNow()), 60_000);
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
          typeId: s.typeId ?? null,
          typeName: s.typeName ?? null,
          typeColor: s.typeColor ?? null,
          onlineRating: s.onlineRating ?? null,
          onlineRatingCount: s.onlineRatingCount ?? 0,
          userRating: s.userRating ?? null,
          isAppointmentOnly: s.isAppointmentOnly ?? false,
          isFlagshipLocation: s.isFlagshipLocation ?? false,
          isOpenWeekends: s.isOpenWeekends ?? false,
          hoursJson: s.hoursJson ?? null,
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
      const [catData, typeData, cityData] = await Promise.all([
        api<{ categories: Category[] }>("/api/showroom-stores/meta/categories"),
        api<{ types: StoreType[] }>("/api/showroom-stores/meta/types"),
        api<{ cities: City[] }>("/api/showroom-stores/meta/cities"),
      ]);
      setCategories(catData.categories);
      setTypes(typeData.types);
      setCities(cityData.cities);
    } catch {
      // Non-critical — filters just won't show all options
    }
  }, []);

  useEffect(() => {
    fetchStores();
    fetchMeta();
  }, [fetchStores, fetchMeta]);

  // Everything EXCEPT region — so region tab counts stay live as filters change.
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return allStores.filter((s) => {
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.categories.some((c) => c.toLowerCase().includes(q)) &&
        !(s.cityName ?? "").toLowerCase().includes(q) &&
        !(s.inventoryFocus ?? "").toLowerCase().includes(q)
      )
        return false;
      if (filters.type != null && s.typeId !== filters.type) return false;
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

  // Live per-region counts (only California hubs we recognize) from `filtered`.
  const regionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of filtered) {
      if (s.hubRoute && HUBS[s.hubRoute]) m.set(s.hubRoute, (m.get(s.hubRoute) ?? 0) + 1);
    }
    return m;
  }, [filtered]);

  // Region-narrowed set fed to both the grouped experience and the map.
  const regionStores = useMemo(
    () => (region == null ? filtered : filtered.filter((s) => s.hubRoute === region)),
    [filtered, region],
  );

  // First load with no location yet → default to SF (or the first region that
  // has stores). Runs once, then yields to geolocation / the user's own pick.
  useEffect(() => {
    if (loading || regionSource !== "none") return;
    const avail = Object.keys(HUBS).filter((r) => (regionCounts.get(r) ?? 0) > 0);
    if (avail.length === 0) return;
    setRegionSource("default");
    setRegion(avail.includes("A") ? "A" : avail[0]);
  }, [loading, regionCounts, regionSource]);

  // Geolocation resolved → auto-select the NEAREST region with stores, unless
  // the user has already picked one manually.
  useEffect(() => {
    if (!userLoc || regionSource === "user") return;
    const avail = Object.keys(HUBS).filter((r) => (regionCounts.get(r) ?? 0) > 0);
    const nearest = nearestRegion(userLoc, avail);
    if (nearest) {
      setRegionSource("geo");
      setRegion(nearest);
    }
  }, [userLoc, regionCounts, regionSource]);

  const regionLabel = region == null ? "All regions" : (HUB_LABEL[region] ?? region);

  return (
    <main className="w-full px-4 py-10 md:px-8">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Showrooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bay Area sourcing hubs, grouped and live. Pick a region, group how you like, and see
            what's open right now.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={viewMode} onChange={selectTab} />
          <ManageShowroomsModal onDone={fetchStores} />
          <AddShowroomModal cities={cities} onCreated={fetchStores} />
        </div>
      </div>

      {/* Header locator strip (cheap always-on locator; the map lives in Map view) */}
      <div className="mb-4">
        <HeaderLocatorStrip userLoc={userLoc} regionLabel={regionLabel} count={regionStores.length} />
      </div>

      {/* Region tabs with live counts */}
      <div className="space-y-1">
        <RegionTabs
          counts={regionCounts}
          total={filtered.length}
          active={region}
          onSelect={selectRegion}
        />
        {regionSource === "geo" && region != null && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
            <Navigation className="size-3" />
            Auto-selected by your location
          </p>
        )}
      </div>

      {/* Grouping + layout controls (grouped view only) */}
      {viewMode === "grouped" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <GroupBySwitcher value={groupBy} onChange={setGroupBy} />
          <LayoutToggle value={layout} onChange={setLayout} />
        </div>
      )}

      {/* Filter Bar */}
      <div className="mb-5 mt-4">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          allCategories={categories}
          allTypes={types}
          pst={pst}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : viewMode === "map" ? (
        <MapView stores={regionStores} pst={pst} />
      ) : (
        <GroupedExperience stores={regionStores} pst={pst} groupBy={groupBy} layout={layout} />
      )}
    </main>
  );
}
