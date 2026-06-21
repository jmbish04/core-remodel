import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import {
  AlertCircle,
  Bot,
  Building2,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  FileText,
  Home,
  Layers,
  Loader2,
  MessageSquare,
  Printer,
  Ruler,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortfolioPhoto {
  id: number;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  displayName?: string | null;
  roomType?: string | null;
}

interface InspirationImage {
  id: number;
  cfImageIdOriginal: string;
  cfImageIdOptimized?: string | null;
  sourceUrl?: string | null;
  caption?: string | null;
}

interface RoomConfig {
  id: number;
  includePhotos: boolean;
  includeDimensions: boolean;
  includeConditionNotes: boolean;
  includeScopeItems: boolean;
  includeInspiration: boolean;
  room: {
    id: number;
    roomName: string;
    roomType: string;
    sqft?: number | null;
    dimensionLabel?: string | null;
    generalNotes?: string | null;
    problemAreas?: string | null;
    conditionNotes?: string | null;
    scopeItems?: string | null;
  };
  photos: PortfolioPhoto[];
  inspirationImages: InspirationImage[];
}

interface BudgetTrackerItem {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  executionClass: string;
  estimatedLowCents?: number | null;
  estimatedHighCents?: number | null;
  roomName?: string | null;
}

interface BudgetAssumptionItem {
  id: string;
  sectionName: string;
  itemDescription: string;
  minCost: number;
  avgCost: number;
  maxCost: number;
  phaseTag: string;
}

interface BudgetData {
  trackerItems: BudgetTrackerItem[];
  assumptionItems: BudgetAssumptionItem[];
}

interface PortfolioData {
  portfolio: {
    id: number;
    title: string;
    welcomeMessage?: string | null;
    overviewStatement?: string | null;
    showBudgetRanges: boolean;
    status: string;
    datetimeCreated: string | number;
  };
  contact: {
    companyName: string;
    contactName: string;
    businessType: string;
  };
  roomConfigs: RoomConfig[];
  budgetData: BudgetData | null;
  scenarios: unknown[];
}

interface PortfolioComment {
  id: number;
  authorName: string;
  authorEmail?: string | null;
  content: string;
  section?: string | null;
  datetimeCreated: string | number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveImageUrl(image: {
  cfImageIdOptimized?: string | null;
  cfImageIdOriginal: string;
}): string {
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) return "";
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  return `https://imagedelivery.net/${candidate}/public`;
}

function formatCurrency(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(value: string | number | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function businessTypeBadgeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("contractor") || t.includes("gc"))
    return "bg-amber-950/60 text-amber-400 border-amber-800/60";
  if (t.includes("architect"))
    return "bg-blue-950/60 text-blue-400 border-blue-800/60";
  if (t.includes("engineer"))
    return "bg-purple-950/60 text-indigo-400 border-indigo-800/60";
  if (t.includes("designer"))
    return "bg-pink-950/60 text-pink-400 border-pink-800/60";
  return "bg-zinc-800 text-zinc-300 border-zinc-700";
}

// ---------------------------------------------------------------------------
// Role-based content configuration
// ---------------------------------------------------------------------------

interface RoleConfig {
  /** Role-specific label for the portfolio */
  roleLabel: string;
  /** What to emphasize in overview */
  overviewEmphasis: string;
  /** Room detail sections to highlight (show first / with emphasis) */
  primarySections: ('photos' | 'dimensions' | 'conditionNotes' | 'scopeItems' | 'inspiration')[];
  /** Role-specific language for scope items */
  scopeLabel: string;
  /** Role-specific language for condition notes */
  conditionLabel: string;
  /** Budget section title adaptation */
  budgetTitle: string;
  /** Budget section description */
  budgetDescription: string;
}

function getRoleConfig(businessType: string): RoleConfig {
  switch (businessType) {
    case 'contractor':
      return {
        roleLabel: 'Construction Bid Package',
        overviewEmphasis: 'Review the scope of work, material requirements, and sequencing for each space. Dimensions and condition assessments are provided to support accurate estimating.',
        primarySections: ['scopeItems', 'dimensions', 'conditionNotes', 'photos', 'inspiration'],
        scopeLabel: 'Scope of Work',
        conditionLabel: 'Site Conditions & Assessment',
        budgetTitle: 'Budget Framework',
        budgetDescription: 'Preliminary cost ranges for bid alignment. All figures are estimates pending site verification.',
      };
    case 'architect':
      return {
        roleLabel: 'Design Brief Portfolio',
        overviewEmphasis: 'Explore the design vision, spatial relationships, and aesthetic goals for each room. Inspiration imagery and current conditions inform the design direction.',
        primarySections: ['inspiration', 'photos', 'conditionNotes', 'dimensions', 'scopeItems'],
        scopeLabel: 'Design Requirements',
        conditionLabel: 'Current Conditions & Context',
        budgetTitle: 'Budget Parameters',
        budgetDescription: 'Budget envelopes to guide design decisions and material selections.',
      };
    case 'civil_engineer':
      return {
        roleLabel: 'Engineering Assessment Package',
        overviewEmphasis: 'Review structural considerations, dimensional data, and existing conditions. Focus on load-bearing elements, utility routing, and code compliance requirements.',
        primarySections: ['dimensions', 'conditionNotes', 'scopeItems', 'photos', 'inspiration'],
        scopeLabel: 'Engineering Specifications',
        conditionLabel: 'Structural Assessment & Conditions',
        budgetTitle: 'Project Cost Parameters',
        budgetDescription: 'Preliminary cost parameters for engineering scope validation.',
      };
    default:
      return {
        roleLabel: 'Bid Portfolio',
        overviewEmphasis: 'Review the project scope, room details, and specifications below.',
        primarySections: ['photos', 'dimensions', 'conditionNotes', 'scopeItems', 'inspiration'],
        scopeLabel: 'Scope Items',
        conditionLabel: 'Condition Notes',
        budgetTitle: 'Budget Estimates (Ranges)',
        budgetDescription: 'All figures are preliminary estimates and subject to refinement.',
      };
  }
}

// ---------------------------------------------------------------------------
// Section ids for navigation
// ---------------------------------------------------------------------------

function buildSectionIds(data: PortfolioData): { id: string; label: string }[] {
  const sections: { id: string; label: string }[] = [
    { id: "cover", label: "Cover" },
    { id: "overview", label: "Overview" },
  ];
  data.roomConfigs.forEach((rc, i) => {
    sections.push({ id: `room-${i}`, label: rc.room.roomName });
  });
  if (data.portfolio.showBudgetRanges && data.budgetData) {
    sections.push({ id: "budget", label: "Budget" });
  }
  sections.push({ id: "comments", label: "Comments" });
  return sections;
}

// ---------------------------------------------------------------------------
// Photo Gallery component
// ---------------------------------------------------------------------------

function PhotoGallery({
  photos,
  title,
}: {
  photos: { url: string; alt: string }[];
  title: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (photos.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">
        {title}
      </p>
      {/* Main image */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        {/* biome-ignore lint/performance/noImgElement: external delivery urls */}
        <img
          src={photos[activeIndex].url}
          alt={photos[activeIndex].alt}
          className="aspect-[16/10] w-full object-cover"
        />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() =>
                setActiveIndex((p) =>
                  p === 0 ? photos.length - 1 : p - 1
                )
              }
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-zinc-700 bg-zinc-950/80 p-2 text-zinc-300 backdrop-blur-sm transition hover:bg-zinc-900 hover:text-white"
              aria-label="Previous photo"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                setActiveIndex((p) =>
                  p === photos.length - 1 ? 0 : p + 1
                )
              }
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-zinc-700 bg-zinc-950/80 p-2 text-zinc-300 backdrop-blur-sm transition hover:bg-zinc-900 hover:text-white"
              aria-label="Next photo"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-950/80 px-3 py-1 text-xs font-semibold text-zinc-300 backdrop-blur-sm">
              {activeIndex + 1} / {photos.length}
            </div>
          </>
        )}
      </div>
      {/* Thumbnails */}
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {photos.map((photo, i) => (
            <button
              key={`thumb-${photo.url}-${i}`}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={cn(
                "shrink-0 overflow-hidden rounded-lg border-2 transition",
                i === activeIndex
                  ? "border-emerald-500"
                  : "border-zinc-800 opacity-60 hover:opacity-100"
              )}
            >
              {/* biome-ignore lint/performance/noImgElement: external delivery urls */}
              <img
                src={photo.url}
                alt={photo.alt}
                className="h-16 w-24 object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Cover Slide
// ---------------------------------------------------------------------------

function CoverSlide({ data, roleConfig }: { data: PortfolioData; roleConfig: RoleConfig }) {
  const { portfolio, contact } = data;
  return (
    <section
      id="cover"
      className="relative flex min-h-screen flex-col items-center justify-center px-6 py-20 text-center"
    >
      {/* Decorative gradient bg */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-emerald-950/20 via-zinc-950 to-zinc-950" />

      <div className="relative z-10 max-w-3xl space-y-8">
        <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs font-semibold text-zinc-400">
          <FileText className="h-3.5 w-3.5" />
          {roleConfig.roleLabel}
        </div>

        <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
          {portfolio.title}
        </h1>

        {portfolio.welcomeMessage && (
          <p className="mx-auto max-w-2xl text-lg leading-8 text-zinc-400">
            {portfolio.welcomeMessage}
          </p>
        )}

        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-zinc-500">
            Prepared for{" "}
            <span className="font-semibold text-zinc-300">
              {contact.contactName}
            </span>{" "}
            at{" "}
            <span className="font-semibold text-zinc-300">
              {contact.companyName}
            </span>
          </p>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider",
              businessTypeBadgeColor(contact.businessType)
            )}
          >
            <Building2 className="h-3 w-3" />
            {contact.businessType}
          </span>
        </div>

        {portfolio.datetimeCreated && (
          <p className="text-xs text-zinc-600">
            Created {formatDate(portfolio.datetimeCreated as string)}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Overview Slide
// ---------------------------------------------------------------------------

function OverviewSlide({ data, roleConfig }: { data: PortfolioData; roleConfig: RoleConfig }) {
  const { portfolio, roomConfigs } = data;
  const totalSqft = roomConfigs.reduce(
    (sum, rc) => sum + (rc.room.sqft || 0),
    0
  );

  return (
    <section
      id="overview"
      className="flex min-h-screen flex-col items-center justify-center px-6 py-20"
    >
      <div className="mx-auto w-full max-w-4xl space-y-10">
        <div className="text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-emerald-500">
            Project Overview
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Scope &amp; Summary
          </h2>
        </div>

        {portfolio.overviewStatement && (
          <p className="mx-auto max-w-3xl text-center text-base leading-8 text-zinc-400">
            {portfolio.overviewStatement}
          </p>
        )}

        <p className="mx-auto max-w-3xl text-center text-sm italic leading-7 text-zinc-500">
          {roleConfig.overviewEmphasis}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
            <Home className="mx-auto mb-3 h-6 w-6 text-emerald-500" />
            <p className="text-3xl font-black text-white">
              {roomConfigs.length}
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Rooms Included
            </p>
          </div>

          {totalSqft > 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
              <Ruler className="mx-auto mb-3 h-6 w-6 text-emerald-500" />
              <p className="text-3xl font-black text-white">
                {totalSqft.toLocaleString()}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Total Sq Ft
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
            <Camera className="mx-auto mb-3 h-6 w-6 text-emerald-500" />
            <p className="text-3xl font-black text-white">
              {roomConfigs.reduce((sum, rc) => sum + rc.photos.length, 0)}
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Photos
            </p>
          </div>
        </div>

        {/* Room list */}
        <div className="space-y-3">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-zinc-500">
            Rooms
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {roomConfigs.map((rc) => (
              <a
                key={rc.id}
                href={`#room-${roomConfigs.indexOf(rc)}`}
                className="rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-emerald-700 hover:text-white"
              >
                {rc.room.roomName}
                {rc.room.sqft ? (
                  <span className="ml-1.5 text-xs text-zinc-500">
                    {rc.room.sqft} sqft
                  </span>
                ) : null}
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Room Slide
// ---------------------------------------------------------------------------

function RoomSlide({
  config,
  index,
  roleConfig,
}: {
  config: RoomConfig;
  index: number;
  roleConfig: RoleConfig;
}) {
  const { room, photos, inspirationImages } = config;

  const roomPhotos = useMemo(
    () =>
      config.includePhotos
        ? photos.map((p) => ({
            url: resolveImageUrl(p),
            alt: p.displayName || room.roomName,
          }))
        : [],
    [config.includePhotos, photos, room.roomName]
  );

  const inspoPhotos = useMemo(
    () =>
      config.includeInspiration
        ? inspirationImages.map((img) => ({
            url: resolveImageUrl(img),
            alt: img.caption || "Inspiration",
          }))
        : [],
    [config.includeInspiration, inspirationImages]
  );

  return (
    <section
      id={`room-${index}`}
      className="flex min-h-screen flex-col justify-center px-6 py-20"
    >
      <div className="mx-auto w-full max-w-6xl space-y-10">
        {/* Header */}
        <div className="text-center">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-500">
            Room {index + 1}
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {room.roomName}
          </h2>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Badge
              variant="secondary"
              className="border border-zinc-700 bg-zinc-900 text-zinc-300"
            >
              {room.roomType}
            </Badge>
            {config.includeDimensions && room.sqft && (
              <Badge
                variant="secondary"
                className="border border-zinc-700 bg-zinc-900 text-zinc-300"
              >
                {room.sqft} sqft
              </Badge>
            )}
            {config.includeDimensions && room.dimensionLabel && (
              <Badge
                variant="secondary"
                className="border border-zinc-700 bg-zinc-900 text-zinc-300"
              >
                {room.dimensionLabel}
              </Badge>
            )}
          </div>
        </div>

        {/* Content grid: photos left, details right */}
        <div
          className={cn(
            "grid gap-8",
            roomPhotos.length > 0 || inspoPhotos.length > 0
              ? "lg:grid-cols-[1.2fr_1fr]"
              : "lg:grid-cols-1"
          )}
        >
          {/* Photos column */}
          {(roomPhotos.length > 0 || inspoPhotos.length > 0) && (
            <div className="space-y-8">
              {roomPhotos.length > 0 && (
                <PhotoGallery photos={roomPhotos} title="Room Photos" />
              )}
              {inspoPhotos.length > 0 && (
                <PhotoGallery
                  photos={inspoPhotos}
                  title="Inspiration Gallery"
                />
              )}
            </div>
          )}

          {/* Details column — ordered by roleConfig.primarySections */}
          <div className="space-y-6">
            {roleConfig.primarySections.map((sectionKey) => {
              switch (sectionKey) {
                case 'conditionNotes':
                  return (
                    <React.Fragment key="conditionNotes">
                      {config.includeConditionNotes && room.conditionNotes && (
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
                            {roleConfig.conditionLabel}
                          </p>
                          <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">
                            {room.conditionNotes}
                          </p>
                        </div>
                      )}
                      {config.includeConditionNotes && room.problemAreas && (
                        <div className="rounded-2xl border border-amber-900/40 bg-amber-950/20 p-5">
                          <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-amber-500">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Problem Areas
                          </p>
                          <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">
                            {room.problemAreas}
                          </p>
                        </div>
                      )}
                    </React.Fragment>
                  );
                case 'scopeItems':
                  return (
                    <React.Fragment key="scopeItems">
                      {config.includeScopeItems && room.scopeItems && (
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
                            {roleConfig.scopeLabel}
                          </p>
                          <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">
                            {room.scopeItems}
                          </p>
                        </div>
                      )}
                    </React.Fragment>
                  );
                default:
                  return null;
              }
            })}

            {room.generalNotes && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                <p className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
                  Notes
                </p>
                <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">
                  {room.generalNotes}
                </p>
              </div>
            )}

            {/* Empty state if nothing to show in details column */}
            {!config.includeConditionNotes &&
              !config.includeScopeItems &&
              !room.generalNotes && (
                <div className="flex items-center justify-center rounded-2xl border border-dashed border-zinc-800 px-6 py-16 text-center">
                  <p className="text-sm text-zinc-500">
                    Room overview included in portfolio scope.
                  </p>
                </div>
              )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Budget Overview
// ---------------------------------------------------------------------------

function BudgetSlide({ data, roleConfig }: { data: PortfolioData; roleConfig: RoleConfig }) {
  const budgetData = data.budgetData;
  if (!budgetData) return null;

  const { trackerItems, assumptionItems } = budgetData;

  // Group tracker items by room
  const groupedTracker = trackerItems.reduce<
    Record<string, BudgetTrackerItem[]>
  >((acc, item) => {
    const key = item.roomName || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // Group assumption items by section
  const groupedAssumptions = assumptionItems.reduce<
    Record<string, BudgetAssumptionItem[]>
  >((acc, item) => {
    const key = item.sectionName || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const hasTracker = trackerItems.length > 0;
  const hasAssumptions = assumptionItems.length > 0;

  return (
    <section
      id="budget"
      className="flex min-h-screen flex-col justify-center px-6 py-20"
    >
      <div className="mx-auto w-full max-w-5xl space-y-10">
        <div className="text-center">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-500">
            Financial Overview
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {roleConfig.budgetTitle}
          </h2>
          <p className="mt-3 text-sm text-zinc-400">
            {roleConfig.budgetDescription}
          </p>
        </div>

        {/* Tracker Items Table */}
        {hasTracker && (
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
            <div className="border-b border-zinc-800 px-5 py-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <Layers className="h-4 w-4 text-emerald-500" />
                Budget Line Items
              </h3>
            </div>
            {Object.entries(groupedTracker).map(([groupName, items]) => (
              <div key={groupName}>
                <div className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-2.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    {groupName}
                  </p>
                </div>
                <div className="divide-y divide-zinc-900/80">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 px-5 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-semibold text-white">{item.title}</p>
                        {item.description && (
                          <p className="text-xs text-zinc-500">
                            {item.description}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge
                          variant="secondary"
                          className="border border-zinc-700 bg-zinc-900 text-zinc-400"
                        >
                          {item.status}
                        </Badge>
                        <span className="text-right text-xs font-semibold text-zinc-300">
                          {formatCurrency(item.estimatedLowCents)} –{" "}
                          {formatCurrency(item.estimatedHighCents)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Assumption Items Table */}
        {hasAssumptions && (
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
            <div className="border-b border-zinc-800 px-5 py-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                Detailed Assumptions
              </h3>
            </div>
            {Object.entries(groupedAssumptions).map(
              ([sectionName, items]) => (
                <div key={sectionName}>
                  <div className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-2.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      {sectionName}
                    </p>
                  </div>
                  <div className="divide-y divide-zinc-900/80">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col gap-2 px-5 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="font-semibold text-white">
                          {item.itemDescription}
                        </p>
                        <div className="flex shrink-0 items-center gap-4">
                          <span
                            className={cn(
                              "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border",
                              item.phaseTag.includes("Critical")
                                ? "bg-red-950/40 border-red-900/40 text-red-400"
                                : item.phaseTag.includes("Defer")
                                  ? "bg-zinc-800 border-zinc-700 text-zinc-400"
                                  : "bg-amber-950/40 border-amber-900/40 text-amber-400"
                            )}
                          >
                            {item.phaseTag
                              .replace("Phase 1: ", "")
                              .replace("Phase 2: ", "")}
                          </span>
                          <span className="text-right text-xs text-zinc-300">
                            <span className="font-bold">
                              {formatCurrency(item.avgCost * 100)}
                            </span>
                            <span className="ml-1 text-zinc-500">
                              [{formatCurrency(item.minCost * 100)} –{" "}
                              {formatCurrency(item.maxCost * 100)}]
                            </span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Comments & Chat
// ---------------------------------------------------------------------------

function CommentCard({ comment }: { comment: PortfolioComment }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
          <User className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">
              {comment.authorName}
            </p>
            {comment.section && (
              <Badge
                variant="secondary"
                className="border border-zinc-700 bg-zinc-900 text-zinc-400"
              >
                {comment.section}
              </Badge>
            )}
            <span className="text-xs text-zinc-600">
              {formatDate(comment.datetimeCreated as string)}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">
            {comment.content}
          </p>
        </div>
      </div>
    </div>
  );
}

function CommentsSection({
  token,
  sections,
}: {
  token: string;
  sections: { id: string; label: string }[];
}) {
  const [comments, setComments] = useState<PortfolioComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [content, setContent] = useState("");
  const [section, setSection] = useState("");

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/bid-portfolios/public/${token}/comments`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          comments?: PortfolioComment[];
        };
        setComments(data.comments || []);
      }
    } catch {
      // Non-critical — silently ignore
    } finally {
      setLoadingComments(false);
    }
  }, [token]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/bid-portfolios/public/${token}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authorName: name.trim(),
            authorEmail: email.trim() || null,
            content: content.trim(),
            section: section || null,
          }),
        }
      );
      if (res.ok) {
        setContent("");
        await fetchComments();
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Existing comments */}
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <MessageSquare className="h-4 w-4 text-emerald-500" />
          Comments ({comments.length})
        </h3>
        {loadingComments ? (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading comments...
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-500">
            No comments yet. Be the first to share feedback.
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <CommentCard key={c.id} comment={c} />
            ))}
          </div>
        )}
      </div>

      {/* Comment form */}
      <form
        onSubmit={submitComment}
        className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5"
      >
        <p className="text-sm font-bold text-white">Leave a Comment</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            placeholder="Your name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="border-zinc-800 bg-zinc-950 text-white placeholder:text-zinc-500"
          />
          <Input
            placeholder="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-zinc-800 bg-zinc-950 text-white placeholder:text-zinc-500"
          />
        </div>
        <div>
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 outline-none focus:border-emerald-700"
          >
            <option value="">General comment</option>
            {sections.map((s) => (
              <option key={s.id} value={s.label}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <Textarea
          placeholder="Share your feedback, questions, or notes..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          rows={4}
          className="border-zinc-800 bg-zinc-950 text-white placeholder:text-zinc-500"
        />
        <Button
          type="submit"
          disabled={submitting || !name.trim() || !content.trim()}
          className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Submit Comment
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat Panel (assistant-ui)
// ---------------------------------------------------------------------------

function ChatPanel({ token }: { token: string }) {
  const [chatError, setChatError] = useState(false);

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: `/api/bid-portfolios/public/${token}/chat`,
    }),
  });

  // If the chat API returns 501, show the coming soon message
  useEffect(() => {
    const checkChatAvailability = async () => {
      try {
        const res = await fetch(
          `/api/bid-portfolios/public/${token}/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [] }),
          }
        );
        if (res.status === 501 || res.status === 404) {
          setChatError(true);
        }
      } catch {
        setChatError(true);
      }
    };
    checkChatAvailability();
  }, [token]);

  if (chatError) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/40 p-2 text-emerald-300">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">
              AI Portfolio Assistant
            </h3>
            <p className="text-xs text-zinc-400">
              Ask questions about this portfolio
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Sparkles className="h-8 w-8 text-emerald-500/60" />
          <p className="text-sm font-semibold text-zinc-300">
            AI Assistant Coming Soon
          </p>
          <p className="max-w-sm text-xs leading-5 text-zinc-500">
            An AI-powered assistant will be available here to answer questions
            about this portfolio, explain scope items, and provide project
            insights.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/45 shadow-lg shadow-black/20">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/40 p-2 text-emerald-300">
          <Bot className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">
            AI Portfolio Assistant
          </h3>
          <p className="text-xs text-zinc-400">
            Ask questions about this portfolio
          </p>
        </div>
      </div>

      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="grid min-h-[360px] grid-rows-[1fr_auto]">
          <ThreadPrimitive.Viewport className="max-h-[480px] min-h-[200px] overflow-y-auto px-3 py-4 sm:px-4">
            <ThreadPrimitive.Empty>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  "What rooms are included?",
                  "Summarize the scope",
                  "What's the timeline?",
                  "Explain budget ranges",
                ].map((suggestion) => (
                  <ThreadPrimitive.Suggestion
                    key={suggestion}
                    prompt={suggestion}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs font-semibold text-zinc-300 transition hover:border-emerald-700 hover:text-white"
                  >
                    {suggestion}
                  </ThreadPrimitive.Suggestion>
                ))}
              </div>
            </ThreadPrimitive.Empty>

            <ThreadPrimitive.Messages
              components={{
                UserMessage: ChatUserMessage,
                AssistantMessage: ChatAssistantMessage,
              }}
            />
          </ThreadPrimitive.Viewport>

          <ThreadPrimitive.ViewportFooter className="border-t border-zinc-800 bg-zinc-950/80 p-3">
            <ComposerPrimitive.Root className="flex items-end gap-2">
              <ComposerPrimitive.Input
                placeholder="Ask about this portfolio..."
                className="min-h-11 flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-700"
              />
              <ComposerPrimitive.Send className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
                <Send className="h-4 w-4" />
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}

function ChatUserMessage() {
  return (
    <MessagePrimitive.Root className="mb-4 flex justify-end">
      <div className="max-w-[92%] rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium leading-6 text-zinc-950 sm:max-w-[78%]">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function ChatAssistantMessage() {
  return (
    <MessagePrimitive.Root className="mb-4">
      <div className="max-w-[96%] rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-6 text-zinc-200 sm:max-w-[82%]">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Navigation dots (sticky sidebar)
// ---------------------------------------------------------------------------

function NavigationDots({
  sections,
  activeSection,
}: {
  sections: { id: string; label: string }[];
  activeSection: string;
}) {
  return (
    <nav className="fixed right-4 top-1/2 z-50 hidden -translate-y-1/2 lg:block">
      <div className="flex flex-col items-end gap-3">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="group flex items-center gap-2"
            title={s.label}
          >
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold opacity-0 transition-opacity group-hover:opacity-100",
                activeSection === s.id
                  ? "border-emerald-700 bg-emerald-950 text-emerald-400 opacity-100"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400"
              )}
            >
              {s.label}
            </span>
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full border-2 transition-all",
                activeSection === s.id
                  ? "border-emerald-500 bg-emerald-500"
                  : "border-zinc-600 bg-zinc-950 group-hover:border-zinc-400"
              )}
            />
          </a>
        ))}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main Viewer App
// ---------------------------------------------------------------------------

export function BidPortfolioViewerApp({ token }: { token: string }) {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{
    status: number;
    message: string;
  } | null>(null);
  const [activeSection, setActiveSection] = useState("cover");

  const roleConfig = useMemo(
    () => getRoleConfig(data?.contact?.businessType || ""),
    [data?.contact?.businessType]
  );

  // Sort room configs based on businessType for role-appropriate ordering
  const sortedRoomConfigs = useMemo(() => {
    if (!data) return [];
    const configs = [...data.roomConfigs];
    switch (data.contact?.businessType) {
      case 'contractor':
        // Rooms with scope items first
        return configs.sort((a, b) => {
          const aHasScope = a.includeScopeItems && a.room.scopeItems ? 1 : 0;
          const bHasScope = b.includeScopeItems && b.room.scopeItems ? 1 : 0;
          return bHasScope - aHasScope;
        });
      case 'architect':
        // Rooms with more inspiration images first
        return configs.sort((a, b) => b.inspirationImages.length - a.inspirationImages.length);
      case 'civil_engineer':
        // Largest rooms first by sqft
        return configs.sort((a, b) => (b.room.sqft || 0) - (a.room.sqft || 0));
      default:
        // Keep original order
        return configs;
    }
  }, [data?.roomConfigs, data?.contact?.businessType]);

  // Fetch portfolio data
  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        const res = await fetch(
          `/api/bid-portfolios/public/${token}`
        );
        if (res.status === 404) {
          setError({
            status: 404,
            message: "This portfolio was not found.",
          });
          return;
        }
        if (res.status === 410) {
          setError({
            status: 410,
            message:
              "This portfolio link has expired. Please request a new link from the homeowner.",
          });
          return;
        }
        if (!res.ok) {
          setError({
            status: res.status,
            message:
              "Something went wrong loading this portfolio. Please try again later.",
          });
          return;
        }
        const payload = await res.json();
        setData(payload as PortfolioData);
      } catch {
        setError({
          status: 500,
          message:
            "Unable to connect. Please check your connection and try again.",
        });
      } finally {
        setLoading(false);
      }
    };
    fetchPortfolio();
  }, [token]);

  // Track page view
  useEffect(() => {
    if (!token) return;
    const trackVisit = async () => {
      try {
        await fetch(`/api/bid-portfolios/public/${token}/track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "page_view",
            path: window.location.pathname,
            metadata: {
              userAgent: navigator.userAgent,
              referrer: document.referrer || null,
              screenWidth: window.screen.width,
              screenHeight: window.screen.height,
            },
          }),
        });
      } catch {
        // Non-critical — silently ignore
      }
    };
    trackVisit();
  }, [token]);

  // Track active section via Intersection Observer
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!data) return;

    const sections = buildSectionIds(data);
    const sectionElements = sections
      .map((s) => document.getElementById(s.id))
      .filter(Boolean) as HTMLElement[];

    if (sectionElements.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: 0 }
    );

    for (const el of sectionElements) {
      observerRef.current.observe(el);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [data]);

  // ---------------------------------------------------------------------------
  // Loading State
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-400">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
        <p className="text-sm font-medium tracking-wide">
          Loading portfolio...
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error States
  // ---------------------------------------------------------------------------

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-center">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-zinc-600" />
          <h1 className="text-2xl font-extrabold text-white">
            {error.status === 404
              ? "Portfolio Not Found"
              : error.status === 410
                ? "Link Expired"
                : "Error"}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-zinc-400">
            {error.message}
          </p>
          {error.status === 410 && (
            <p className="mt-4 text-xs text-zinc-600">
              <Clock className="mr-1 inline h-3 w-3" />
              Portfolio links may expire for security purposes.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const sections = buildSectionIds(data);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="relative min-h-screen bg-zinc-950">
      {/* Print styles */}
      <style>{`
        @media print {
          @page {
            size: 8.5in 11in;
            margin: 0.5in;
          }
          
          /* White background for print */
          body, html {
            background: white !important;
            color: black !important;
          }
          
          /* Hide interactive elements */
          .print\:hidden,
          nav,
          button:not([data-print-show]),
          [class*="NavigationDots"],
          [class*="ChatPanel"],
          footer {
            display: none !important;
          }
          
          /* Page breaks between slides */
          section {
            page-break-before: always;
            page-break-inside: avoid;
            min-height: auto !important;
            padding-top: 0.5in !important;
            padding-bottom: 0.5in !important;
          }
          
          section:first-of-type {
            page-break-before: avoid;
          }
          
          /* Override dark theme colors for print */
          * {
            background: transparent !important;
            color: #1a1a1a !important;
            border-color: #e5e5e5 !important;
          }
          
          /* Ensure images print */
          img {
            max-width: 100% !important;
            page-break-inside: avoid;
          }
          
          /* Badge styling for print */
          .inline-flex, [class*="Badge"] {
            border: 1px solid #ccc !important;
            padding: 2px 8px !important;
          }
          
          /* Override gradients */
          [class*="gradient"] {
            background: transparent !important;
          }
        }
      `}</style>

      {/* Navigation dots */}
      <NavigationDots sections={sections} activeSection={activeSection} />

      {/* Print / Download PDF button */}
      <button
        type="button"
        onClick={() => window.print()}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/90 px-4 py-2.5 text-sm font-semibold text-zinc-300 shadow-2xl backdrop-blur-sm transition hover:bg-zinc-800 hover:text-white print:hidden"
        aria-label="Print or download as PDF"
      >
        <Printer className="h-4 w-4" />
        Print / PDF
      </button>

      {/* Slide sections */}
      <div className="scroll-smooth">
        <CoverSlide data={data} roleConfig={roleConfig} />

        <Separator className="mx-auto max-w-5xl border-zinc-800/60" />

        <OverviewSlide data={data} roleConfig={roleConfig} />

        {sortedRoomConfigs.map((config, i) => (
          <React.Fragment key={config.id}>
            <Separator className="mx-auto max-w-5xl border-zinc-800/60" />
            <RoomSlide config={config} index={i} roleConfig={roleConfig} />
          </React.Fragment>
        ))}

        {data.portfolio.showBudgetRanges && data.budgetData && (
          <>
            <Separator className="mx-auto max-w-5xl border-zinc-800/60" />
            <BudgetSlide data={data} roleConfig={roleConfig} />
          </>
        )}

        <Separator className="mx-auto max-w-5xl border-zinc-800/60" />

        {/* Comments & Chat section */}
        <section
          id="comments"
          className="flex min-h-screen flex-col justify-center px-6 py-20"
        >
          <div className="mx-auto w-full max-w-5xl space-y-10">
            <div className="text-center">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-500">
                Feedback
              </p>
              <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Comments &amp; Questions
              </h2>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              <CommentsSection token={token} sections={sections} />
              <ChatPanel token={token} />
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-800/60 py-8 text-center">
          <p className="text-xs text-zinc-600">
            Powered by 126 Colby Remodel Mission Control
          </p>
        </footer>
      </div>
    </div>
  );
}
