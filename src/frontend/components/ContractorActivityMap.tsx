import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Home,
  Loader2,
  MapPinned,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
} from "@/components/ui/map";
import {
  MultipleSelector,
  type MultipleSelectorOption,
} from "@/components/ui/multiple-selector";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// API contract (GET /api/admin/permits/contacts) — consumed, never mutated.
// ---------------------------------------------------------------------------

type Relation = "before" | "after" | "concurrent";
type MatchConfidence = "high" | "medium" | "low";
type Busyness = "idle" | "light" | "busy";

type ContactTarget = {
  address: string;
  block: string | null;
  lot: string | null;
  latitude: string | null;
  longitude: string | null;
};

type ContractorPermit = {
  trade: string;
  permitNumber: string | null;
  permitType: string | null;
  permitStatus: string | null;
  statusCategory: string | null;
  filedDate: string | null;
  issuedDate: string | null;
  closedDate: string | null;
  isOpen: boolean;
  isRecentlyClosed: boolean;
  relationToAnchor: Relation | null;
  latitude: string | null;
  longitude: string | null;
  propertyAddress: string | null;
  block: string | null;
  lot: string | null;
  recentActivityType: string | null;
  recentActivityDate: string | null;
  recentActivityDetail: string | null;
  matchStrategy: string | null;
  matchConfidence: MatchConfidence | null;
};

type ContractorInsight = {
  riskLevel: string;
  beforeBusyness: string | null;
  afterBusyness: string | null;
  summary: string;
  highlights: string[];
};

type ContractorSummary = {
  total: number;
  open: number;
  recentlyClosed: number;
  before: number;
  after: number;
};

type Contractor = {
  contactName: string;
  firmName: string | null;
  licenseNumber: string | null;
  role: string | null;
  isMonitored: boolean;
  anchorPermitIdentifiers: string[];
  anchorReferenceFiledDate: string | null;
  summary: ContractorSummary;
  insight: ContractorInsight | null;
  permits: ContractorPermit[];
};

type ContactsPayload = {
  success: boolean;
  target: ContactTarget | null;
  contractors: Contractor[];
  error?: string;
};

// A permit flattened together with its owning contractor, plus a stable id used
// to wire the bidirectional hover linkage between the table and the map.
type FlatPermit = ContractorPermit & {
  id: string;
  contactName: string;
  firmName: string | null;
  lng: number | null;
  lat: number | null;
};

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const TRADE_OPTIONS: MultipleSelectorOption[] = [
  { value: "building", label: "Building" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
];

const RELATION_OPTIONS: MultipleSelectorOption[] = [
  { value: "before", label: "Filed before ours" },
  { value: "after", label: "Filed after ours" },
];

const STATUS_OPTIONS: MultipleSelectorOption[] = [
  { value: "open", label: "Open" },
  { value: "recentlyClosed", label: "Recently closed" },
];

const CONFIDENCE_OPTIONS: MultipleSelectorOption[] = [
  { value: "high", label: "High confidence" },
  { value: "medium", label: "Medium confidence" },
  { value: "low", label: "Low confidence" },
];

// 126 Colby / San Francisco — used as the map default before markers resolve.
const SF_FALLBACK_CENTER: [number, number] = [-122.4194, 37.7749];

function permitId(trade: string, permitNumber: string | null): string {
  return `${trade}:${permitNumber ?? "unknown"}`;
}

function parseCoord(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function normalizeBusyness(value: string | null | undefined): Busyness | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "busy" || normalized === "light" || normalized === "idle") {
    return normalized;
  }
  return null;
}

function busynessBadgeClass(value: Busyness | null): string {
  switch (value) {
    case "busy":
      return "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30";
    case "light":
      return "bg-muted text-muted-foreground ring-1 ring-border/40";
    case "idle":
      return "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30";
    default:
      return "bg-muted text-muted-foreground ring-1 ring-border/40";
  }
}

function busynessLabel(value: Busyness | null): string {
  return value ?? "unknown";
}

function riskBadgeVariant(
  riskLevel: string | null | undefined,
): "default" | "secondary" | "destructive" | "outline" {
  const normalized = (riskLevel ?? "").trim().toLowerCase();
  if (normalized === "high") return "destructive";
  if (normalized === "low") return "secondary";
  return "outline";
}

// Marker dot color encodes the permit's relation to the 126 Colby filing date.
function relationDotClass(relation: Relation | null): string {
  switch (relation) {
    case "before":
      return "bg-amber-500";
    case "after":
      return "bg-sky-500";
    case "concurrent":
      return "bg-violet-500";
    default:
      return "bg-zinc-400";
  }
}

function relationTextClass(relation: Relation | null): string {
  switch (relation) {
    case "before":
      return "text-amber-400";
    case "after":
      return "text-sky-400";
    case "concurrent":
      return "text-violet-400";
    default:
      return "text-muted-foreground";
  }
}

function relationLabel(relation: Relation | null): string {
  switch (relation) {
    case "before":
      return "Filed BEFORE yours";
    case "after":
      return "Filed AFTER yours";
    case "concurrent":
      return "Filed concurrently";
    default:
      return "Unknown timing";
  }
}

function statusLabel(value: string | null | undefined): string {
  if (!value) return "Status n/a";
  return value.replace(/_/g, " ");
}

function activitySummary(permit: ContractorPermit): string {
  if (
    permit.recentActivityType &&
    permit.recentActivityType.toLowerCase() !== "none"
  ) {
    const label = permit.recentActivityType.replace(/_/g, " ");
    const detail = permit.recentActivityDetail
      ? ` — ${permit.recentActivityDetail}`
      : "";
    const date = permit.recentActivityDate
      ? ` (${formatDate(permit.recentActivityDate)})`
      : "";
    return `${label}${date}${detail}`;
  }
  return "No recent activity";
}

// ---------------------------------------------------------------------------
// Loading / empty / error states
// ---------------------------------------------------------------------------

function CenteredState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[50svh] flex-col items-center justify-center gap-3 rounded-xl bg-card/40 px-6 py-12 text-center ring-1 ring-border/40">
      <div className="text-muted-foreground">{icon}</div>
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI busyness card
// ---------------------------------------------------------------------------

function BusynessBadge({ phase, value }: { phase: string; value: Busyness | null }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        busynessBadgeClass(value),
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
        {phase}
      </span>
      <span className="capitalize">{busynessLabel(value)}</span>
    </span>
  );
}

function ContractorCard({ contractor }: { contractor: Contractor }) {
  const insight = contractor.insight;
  const before = normalizeBusyness(insight?.beforeBusyness);
  const after = normalizeBusyness(insight?.afterBusyness);
  const summary = contractor.summary;

  return (
    <Card className="flex flex-col bg-card ring-1 ring-border/40">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{contractor.contactName}</CardTitle>
            <CardDescription className="truncate">
              {contractor.firmName || "Independent / firm n/a"}
              {contractor.licenseNumber ? ` · Lic ${contractor.licenseNumber}` : ""}
              {contractor.role ? ` · ${contractor.role}` : ""}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {contractor.isMonitored ? (
              <Badge variant="outline" className="gap-1">
                <ShieldAlert className="size-3" />
                Monitored
              </Badge>
            ) : null}
            <Badge variant={riskBadgeVariant(insight?.riskLevel)}>
              Risk: {insight?.riskLevel || "n/a"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <BusynessBadge phase="Before our filing" value={before} />
          <BusynessBadge phase="After our filing" value={after} />
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg bg-muted/40 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Before
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-amber-400">
              {summary.before}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              After
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-sky-400">
              {summary.after}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Open
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {summary.open}
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 px-2 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Closed
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {summary.recentlyClosed}
            </p>
          </div>
        </div>

        <p className="text-sm text-foreground/90">
          {insight?.summary || "No AI busyness summary available yet."}
        </p>

        {insight?.highlights?.length ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {insight.highlights.map((item, index) => (
              <li key={`${contractor.contactName}-hl-${index}`}>{item}</li>
            ))}
          </ul>
        ) : null}

        <p className="mt-auto text-[11px] text-muted-foreground">
          On your permits: {contractor.anchorPermitIdentifiers.join(", ") || "n/a"}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function TargetMarker({ target }: { target: ContactTarget }) {
  const lng = parseCoord(target.longitude);
  const lat = parseCoord(target.latitude);
  if (lng === null || lat === null) return null;

  return (
    <MapMarker longitude={lng} latitude={lat}>
      <MarkerContent className="z-20">
        <span className="relative flex size-7 items-center justify-center">
          <span className="absolute inline-flex size-7 animate-ping rounded-full bg-emerald-500/40" />
          <span className="relative inline-flex size-7 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow-lg ring-2 ring-emerald-200/70">
            <Home className="size-4" />
          </span>
        </span>
      </MarkerContent>
      <MarkerTooltip>126 Colby (your home)</MarkerTooltip>
      <MarkerPopup closeButton className="max-w-72">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Home className="size-3.5 text-emerald-400" />
            126 Colby — your project
          </p>
          <p className="text-xs text-muted-foreground">{target.address}</p>
          <p className="text-xs text-muted-foreground">
            Block {target.block || "n/a"} · Lot {target.lot || "n/a"}
          </p>
        </div>
      </MarkerPopup>
    </MapMarker>
  );
}

function PermitMarker({
  permit,
  highlighted,
  onHighlight,
}: {
  permit: FlatPermit;
  highlighted: boolean;
  onHighlight: (id: string | null) => void;
}) {
  if (permit.lng === null || permit.lat === null) return null;

  return (
    <MapMarker
      longitude={permit.lng}
      latitude={permit.lat}
      onMouseEnter={() => onHighlight(permit.id)}
      onMouseLeave={() => onHighlight(null)}
    >
      <MarkerContent className={highlighted ? "z-30" : undefined}>
        <span
          className={cn(
            "block rounded-full ring-2 ring-background shadow transition-all duration-150",
            relationDotClass(permit.relationToAnchor),
            highlighted ? "size-5 ring-4 ring-foreground/70" : "size-3.5",
          )}
        />
      </MarkerContent>
      <MarkerTooltip>
        {permit.permitNumber || "Permit"} · {permit.trade}
      </MarkerTooltip>
      <MarkerPopup closeButton className="max-w-72">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              {permit.permitNumber || "Permit n/a"}
            </p>
            <Badge variant="outline" className="capitalize">
              {permit.trade}
            </Badge>
          </div>
          <p className="text-xs capitalize text-muted-foreground">
            {statusLabel(permit.permitStatus)}
          </p>
          <p className="text-sm font-medium text-foreground">
            Filed: {formatDate(permit.filedDate)}
          </p>
          <p
            className={cn(
              "text-xs font-semibold",
              relationTextClass(permit.relationToAnchor),
            )}
          >
            {relationLabel(permit.relationToAnchor)}
          </p>
          {permit.propertyAddress ? (
            <p className="text-xs text-muted-foreground">{permit.propertyAddress}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">{activitySummary(permit)}</p>
          {permit.matchConfidence === "low" ? (
            <p className="flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="size-3" />
              Loosely matched to this contractor
            </p>
          ) : null}
        </div>
      </MarkerPopup>
    </MapMarker>
  );
}

function ActivityMapPanel({
  target,
  permits,
  highlightedId,
  onHighlight,
}: {
  target: ContactTarget | null;
  permits: FlatPermit[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
}) {
  const mappable = useMemo(
    () => permits.filter((permit) => permit.lng !== null && permit.lat !== null),
    [permits],
  );

  // Center on the 126 Colby target when known, otherwise the marker centroid.
  const center = useMemo<[number, number]>(() => {
    const targetLng = parseCoord(target?.longitude);
    const targetLat = parseCoord(target?.latitude);
    if (targetLng !== null && targetLat !== null) {
      return [targetLng, targetLat];
    }
    if (mappable.length > 0) {
      const sum = mappable.reduce(
        (acc, permit) => {
          acc.lng += permit.lng as number;
          acc.lat += permit.lat as number;
          return acc;
        },
        { lng: 0, lat: 0 },
      );
      return [sum.lng / mappable.length, sum.lat / mappable.length];
    }
    return SF_FALLBACK_CENTER;
  }, [target, mappable]);

  return (
    <Card className="bg-card ring-1 ring-border/40">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPinned className="size-4 text-primary" />
              Bay Area Activity Map
            </CardTitle>
            <CardDescription>
              {mappable.length} mapped permit{mappable.length === 1 ? "" : "s"} ·
              hover a marker to highlight its table row.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex size-3 items-center justify-center rounded-full bg-emerald-500 text-emerald-950">
                <Home className="size-2" />
              </span>
              126 Colby
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-amber-500" />
              Before
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-sky-500" />
              After
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-violet-500" />
              Concurrent
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Map
          className="h-[480px] w-full overflow-hidden rounded-lg"
          theme="dark"
          viewport={{ center, zoom: 11 }}
        >
          <MapControls showZoom />
          {target ? <TargetMarker target={target} /> : null}
          {mappable.map((permit) => (
            <PermitMarker
              key={permit.id}
              permit={permit}
              highlighted={highlightedId === permit.id}
              onHighlight={onHighlight}
            />
          ))}
        </Map>
        {mappable.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No permits in the current filter have coordinates. They still appear in
            the table below.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Table (sortable + hover-linked)
// ---------------------------------------------------------------------------

type SortKey =
  | "contactName"
  | "trade"
  | "permitNumber"
  | "propertyAddress"
  | "filedDate"
  | "permitStatus"
  | "relationToAnchor"
  | "recentActivityDate"
  | "matchConfidence";

type SortDirection = "asc" | "desc";

const CONFIDENCE_RANK: Record<MatchConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const RELATION_RANK: Record<string, number> = {
  before: 1,
  concurrent: 2,
  after: 3,
};

function sortValue(permit: FlatPermit, key: SortKey): string | number {
  switch (key) {
    case "filedDate": {
      const time = permit.filedDate ? new Date(permit.filedDate).getTime() : NaN;
      return Number.isNaN(time) ? -Infinity : time;
    }
    case "recentActivityDate": {
      const time = permit.recentActivityDate
        ? new Date(permit.recentActivityDate).getTime()
        : NaN;
      return Number.isNaN(time) ? -Infinity : time;
    }
    case "matchConfidence":
      return permit.matchConfidence ? CONFIDENCE_RANK[permit.matchConfidence] : 0;
    case "relationToAnchor":
      return permit.relationToAnchor
        ? RELATION_RANK[permit.relationToAnchor] ?? 0
        : 0;
    case "contactName":
      return permit.contactName.toLowerCase();
    case "trade":
      return permit.trade.toLowerCase();
    case "permitNumber":
      return (permit.permitNumber || "").toLowerCase();
    case "propertyAddress":
      return (permit.propertyAddress || "").toLowerCase();
    case "permitStatus":
      return (permit.permitStatus || "").toLowerCase();
    default:
      return "";
  }
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className={cn("px-3 py-2.5 text-left font-medium", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
      >
        {label}
        {isActive ? (
          direction === "asc" ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </th>
  );
}

function RelationBadge({ relation }: { relation: Relation | null }) {
  if (relation === "before") {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-400">
        <ArrowDownToLine className="size-3" />
        Before
      </Badge>
    );
  }
  if (relation === "after") {
    return (
      <Badge className="gap-1 bg-sky-500/15 text-sky-400">
        <ArrowUpFromLine className="size-3" />
        After
      </Badge>
    );
  }
  if (relation === "concurrent") {
    return (
      <Badge className="bg-violet-500/15 text-violet-400">Concurrent</Badge>
    );
  }
  return <Badge variant="outline">n/a</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence: MatchConfidence | null }) {
  if (confidence === "high") {
    return <Badge className="bg-emerald-500/15 text-emerald-400">High</Badge>;
  }
  if (confidence === "medium") {
    return <Badge variant="outline">Medium</Badge>;
  }
  if (confidence === "low") {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-400">
        <AlertTriangle className="size-3" />
        Low
      </Badge>
    );
  }
  return <Badge variant="outline">n/a</Badge>;
}

function ActivityTablePanel({
  permits,
  highlightedId,
  onHighlight,
}: {
  permits: FlatPermit[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("filedDate");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setDirection("asc");
    },
    [sortKey],
  );

  const sorted = useMemo(() => {
    const factor = direction === "asc" ? 1 : -1;
    return [...permits].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [permits, sortKey, direction]);

  return (
    <Card className="bg-card ring-1 ring-border/40">
      <CardHeader>
        <CardTitle className="text-base">Permit Activity Table</CardTitle>
        <CardDescription>
          {permits.length} permit{permits.length === 1 ? "" : "s"} across the
          filtered contractors. Hover a row to highlight it on the map.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg ring-1 ring-border/40">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead className="bg-muted/30">
              <tr>
                <SortHeader
                  label="Contractor"
                  sortKey="contactName"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Trade"
                  sortKey="trade"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Permit #"
                  sortKey="permitNumber"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Address"
                  sortKey="propertyAddress"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Filed"
                  sortKey="filedDate"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Status"
                  sortKey="permitStatus"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Relation"
                  sortKey="relationToAnchor"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Recent activity"
                  sortKey="recentActivityDate"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Confidence"
                  sortKey="matchConfidence"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {sorted.map((permit) => {
                const isHighlighted = highlightedId === permit.id;
                const hasCoords = permit.lng !== null && permit.lat !== null;
                return (
                  <tr
                    key={permit.id}
                    onMouseEnter={() => onHighlight(permit.id)}
                    onMouseLeave={() => onHighlight(null)}
                    className={cn(
                      "transition-colors",
                      isHighlighted ? "bg-primary/10" : "hover:bg-muted/30",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground">
                        {permit.contactName}
                      </p>
                      {permit.firmName ? (
                        <p className="text-xs text-muted-foreground">
                          {permit.firmName}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="capitalize">
                        {permit.trade}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {permit.permitNumber || "—"}
                        {!hasCoords ? (
                          <span
                            title="No coordinates — not shown on map"
                            className="size-1.5 rounded-full bg-muted-foreground/50"
                          />
                        ) : null}
                      </span>
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5">
                      <p className="truncate text-muted-foreground">
                        {permit.propertyAddress || "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-foreground">
                      {formatDate(permit.filedDate)}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-muted-foreground">
                      {statusLabel(permit.permitStatus)}
                    </td>
                    <td className="px-3 py-2.5">
                      <RelationBadge relation={permit.relationToAnchor} />
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5">
                      <p className="truncate text-xs text-muted-foreground">
                        {activitySummary(permit)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <ConfidenceBadge confidence={permit.matchConfidence} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Filters bar
// ---------------------------------------------------------------------------

type Filters = {
  contractors: string[];
  trades: string[];
  relations: string[];
  statuses: string[];
  confidences: string[];
};

const EMPTY_FILTERS: Filters = {
  contractors: [],
  trades: [],
  relations: [],
  statuses: [],
  confidences: [],
};

function FiltersBar({
  contractorOptions,
  filters,
  onChange,
  onReset,
}: {
  contractorOptions: MultipleSelectorOption[];
  filters: Filters;
  onChange: (next: Filters) => void;
  onReset: () => void;
}) {
  const hasActive =
    filters.contractors.length > 0 ||
    filters.trades.length > 0 ||
    filters.relations.length > 0 ||
    filters.statuses.length > 0 ||
    filters.confidences.length > 0;

  return (
    <div className="sticky top-0 z-30 -mx-3 rounded-xl bg-card/90 px-3 py-3 ring-1 ring-border/40 backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:mx-0 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Filters
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!hasActive}
        >
          Reset all
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Contractor</p>
          <MultipleSelector
            options={contractorOptions}
            value={filters.contractors}
            onValueChange={(contractors) => onChange({ ...filters, contractors })}
            placeholder="All contractors"
            title="Contractors"
            searchPlaceholder="Search contractors..."
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Trade</p>
          <MultipleSelector
            options={TRADE_OPTIONS}
            value={filters.trades}
            onValueChange={(trades) => onChange({ ...filters, trades })}
            placeholder="All trades"
            title="Trades"
            searchPlaceholder="Search trades..."
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Relation</p>
          <MultipleSelector
            options={RELATION_OPTIONS}
            value={filters.relations}
            onValueChange={(relations) => onChange({ ...filters, relations })}
            placeholder="Before & after"
            title="Relation to your filing"
            searchPlaceholder="Search..."
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Status</p>
          <MultipleSelector
            options={STATUS_OPTIONS}
            value={filters.statuses}
            onValueChange={(statuses) => onChange({ ...filters, statuses })}
            placeholder="Any status"
            title="Status"
            searchPlaceholder="Search..."
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Match confidence</p>
          <MultipleSelector
            options={CONFIDENCE_OPTIONS}
            value={filters.confidences}
            onValueChange={(confidences) => onChange({ ...filters, confidences })}
            placeholder="Any confidence"
            title="Match confidence"
            searchPlaceholder="Search..."
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtering logic
// ---------------------------------------------------------------------------

function permitMatchesFilters(permit: ContractorPermit, filters: Filters): boolean {
  if (
    filters.trades.length > 0 &&
    !filters.trades.includes(permit.trade.toLowerCase())
  ) {
    return false;
  }

  if (filters.relations.length > 0) {
    if (
      !permit.relationToAnchor ||
      !filters.relations.includes(permit.relationToAnchor)
    ) {
      return false;
    }
  }

  if (filters.statuses.length > 0) {
    const matchesStatus = filters.statuses.some((status) => {
      if (status === "open") return permit.isOpen;
      if (status === "recentlyClosed") return permit.isRecentlyClosed;
      return false;
    });
    if (!matchesStatus) return false;
  }

  if (filters.confidences.length > 0) {
    if (
      !permit.matchConfidence ||
      !filters.confidences.includes(permit.matchConfidence)
    ) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function ContractorActivityMap() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [errored, setErrored] = useState(false);
  const [payload, setPayload] = useState<ContactsPayload | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const loadData = useCallback(async (withSpinner: boolean) => {
    if (withSpinner) setLoading(true);
    try {
      const response = await fetch("/api/admin/permits/contacts", {
        credentials: "include",
      });
      const result = (await response.json()) as ContactsPayload;
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to load contractor activity");
      }
      setPayload(result);
      setErrored(false);
    } catch (error) {
      setErrored(true);
      toast.error(
        error instanceof Error ? error.message : "Failed to load contractor activity",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/admin/permits/sync", {
        method: "POST",
        credentials: "include",
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to sync permits");
      }
      toast.success("Permit sync complete");
      await loadData(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sync permits");
    } finally {
      setSyncing(false);
    }
  }, [loadData]);

  const contractors = useMemo(() => payload?.contractors ?? [], [payload]);
  const target = payload?.target ?? null;

  // Baseline filing date — pull the first non-null anchor across contractors.
  const anchorDate = useMemo(() => {
    for (const contractor of contractors) {
      if (contractor.anchorReferenceFiledDate) {
        return contractor.anchorReferenceFiledDate;
      }
    }
    return null;
  }, [contractors]);

  const contractorOptions = useMemo<MultipleSelectorOption[]>(
    () =>
      contractors.map((contractor) => ({
        value: contractor.contactName,
        label: contractor.contactName,
        description: contractor.firmName || undefined,
      })),
    [contractors],
  );

  // Contractors surviving the contractor + permit-level filters (drives cards).
  const filteredContractors = useMemo(() => {
    const contractorSet = new Set(filters.contractors);
    return contractors.filter((contractor) => {
      if (contractorSet.size > 0 && !contractorSet.has(contractor.contactName)) {
        return false;
      }
      const permitFilterActive =
        filters.trades.length > 0 ||
        filters.relations.length > 0 ||
        filters.statuses.length > 0 ||
        filters.confidences.length > 0;
      if (!permitFilterActive) return true;
      return contractor.permits.some((permit) =>
        permitMatchesFilters(permit, filters),
      );
    });
  }, [contractors, filters]);

  // Flattened, filtered permits (drives both map and table).
  const filteredPermits = useMemo<FlatPermit[]>(() => {
    const contractorSet = new Set(filters.contractors);
    const rows: FlatPermit[] = [];
    for (const contractor of contractors) {
      if (contractorSet.size > 0 && !contractorSet.has(contractor.contactName)) {
        continue;
      }
      for (let index = 0; index < contractor.permits.length; index += 1) {
        const permit = contractor.permits[index];
        if (!permitMatchesFilters(permit, filters)) continue;
        const baseId = permitId(permit.trade, permit.permitNumber);
        rows.push({
          ...permit,
          // Disambiguate when several rows share trade + permit number.
          id: `${contractor.contactName}::${baseId}::${index}`,
          contactName: contractor.contactName,
          firmName: contractor.firmName,
          lng: parseCoord(permit.longitude),
          lat: parseCoord(permit.latitude),
        });
      }
    }
    return rows;
  }, [contractors, filters]);

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const header = (
    <Card className="bg-card ring-1 ring-border/40">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">Contractor Activity Map</CardTitle>
            <CardDescription>
              Cross-property permit activity for every contractor attached to 126
              Colby, scored against your filing baseline.
            </CardDescription>
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">
                Your 126 Colby filing date:{" "}
              </span>
              <span className="font-semibold text-foreground">
                {anchorDate ? formatDate(anchorDate) : "—"}
              </span>
            </p>
          </div>
          <Button onClick={() => void runSync()} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            {syncing ? "Syncing..." : "Sync"}
          </Button>
        </div>
      </CardHeader>
    </Card>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <CenteredState
          icon={<Loader2 className="size-6 animate-spin" />}
          title="Loading contractor activity"
          description="Fetching cross-property permit intelligence for contacts tied to 126 Colby."
        />
      </div>
    );
  }

  if (errored && !payload) {
    return (
      <div className="space-y-6">
        {header}
        <CenteredState
          icon={<AlertTriangle className="size-6 text-destructive" />}
          title="Could not load contractor activity"
          description="The contractor intelligence endpoint returned an error. Retry, or run a sync to rebuild the dataset."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void loadData(true)}>
                <RefreshCw className="mr-2 size-4" />
                Retry
              </Button>
              <Button onClick={() => void runSync()} disabled={syncing}>
                {syncing ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ShieldAlert className="mr-2 size-4" />
                )}
                Run sync
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (contractors.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <CenteredState
          icon={<MapPinned className="size-6" />}
          title="No contractor activity yet"
          description="Run a sync to populate cross-property permit activity for the contacts on your 126 Colby permits."
          action={
            <Button onClick={() => void runSync()} disabled={syncing}>
              {syncing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Run a sync to populate
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <FiltersBar
        contractorOptions={contractorOptions}
        filters={filters}
        onChange={setFilters}
        onReset={resetFilters}
      />

      {filteredContractors.length === 0 ? (
        <CenteredState
          icon={<MapPinned className="size-6" />}
          title="No contractors match these filters"
          description="Loosen or reset the filters above to see contractor busyness, the activity map, and the permit table."
          action={
            <Button variant="outline" onClick={resetFilters}>
              Reset filters
            </Button>
          }
        />
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Contractor busyness ({filteredContractors.length})
              </h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredContractors.map((contractor) => (
                <ContractorCard
                  key={contractor.contactName}
                  contractor={contractor}
                />
              ))}
            </div>
          </section>

          <ActivityMapPanel
            target={target}
            permits={filteredPermits}
            highlightedId={highlightedId}
            onHighlight={setHighlightedId}
          />

          <ActivityTablePanel
            permits={filteredPermits}
            highlightedId={highlightedId}
            onHighlight={setHighlightedId}
          />
        </>
      )}
    </div>
  );
}

export default ContractorActivityMap;
