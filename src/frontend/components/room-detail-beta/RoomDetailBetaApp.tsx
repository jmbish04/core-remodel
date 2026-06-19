/**
 * RoomDetailBetaApp — beta room viewport inspired by the @bundui/property-detail-01
 * real-estate listing layout, retrofitted for a single room in the 126 Colby remodel.
 *
 * Maps real-estate concepts → remodel concepts:
 *   property.name      → room display name
 *   property.location  → floor + zone (Upper Level · Back of house)
 *   property.price     → room budget goal (mid-point of low–high range)
 *   property.rating    → task completion %
 *   property.images[]  → room listing photos from Cloudflare Images
 *   property.description → AI-generated room overview
 *   Key Features       → DELETED
 *   Areas & Lot        → Remodel Scope (scenario plans + vision nodes)
 *   Agent sidebar      → Room Intelligence card
 *   Schedule Tour      → Quick Actions card
 *
 * Carries forward the entire existing room viewport feature surface by reusing
 * the same API (`GET /api/rooms/code/:roomCode/detail`) and mounting the same
 * section components (`BudgetSignals`, `SupportingMaterials`, `RoomOptions`,
 * `RoomMediaModal`) from `@/components/room-view`.
 */

import {
  ArrowLeft,
  Camera,
  ClipboardList,
  DollarSign,
  Eye,
  FileText,
  ImageIcon,
  Images,
  Layers,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollProgress, type ScrollProgressItem } from "@/components/ui/scroll-progress";
import {
  BudgetSignals,
  RoomMediaModal,
  RoomOptions,
  SupportingMaterials,
  formatCurrency,
  resolveImageUrl,
  type MediaKind,
  type RoomDetailPayload,
  type RoomSummaryRecord,
  type TaskStats,
} from "@/components/room-view";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Shape of the project-budget overview slice we consume. */
interface BudgetOverviewResponse {
  funds?: { totalAllottedCents?: number };
}

/** Formats integer cents as a dollar string with no decimals. */
function formatBudgetGoal(lowCents: number, highCents: number): string {
  const mid = Math.round((lowCents + highCents) / 2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(mid / 100);
}

/** Maps the floor key to a human-readable zone label. */
function floorZoneLabel(floorName: string, floorKey?: string): string {
  const parts: string[] = [floorName];
  // Floor key gives us the level grouping for "area of the home" context.
  if (floorKey === "lower_level") parts.push("Street level");
  else if (floorKey === "upper_level") parts.push("Main living level");
  else if (floorKey === "outside") parts.push("Exterior");
  return parts.join(" · ");
}

/** Stable section anchor ids for the scroll-progress TOC. */
const SECTION_IDS = {
  gallery: "beta-gallery",
  identity: "beta-identity",
  overview: "beta-overview",
  scope: "beta-scope",
  options: "beta-options",
  budget: "beta-budget",
  supporting: "beta-supporting",
} as const;

// ─── Main Component ─────────────────────────────────────────────────────────

export function RoomDetailBetaApp({ roomCode }: { roomCode: string }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<RoomDetailPayload | null>(null);
  const [accessAuthenticated, setAccessAuthenticated] = useState(false);
  const [projectBudgetTotalCents, setProjectBudgetTotalCents] = useState<number | null>(null);

  // Task stats for completion %.
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);

  // Room Media modal state.
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaKind, setMediaKind] = useState<MediaKind>("listing");

  const loadData = useCallback(
    async (initial: boolean) => {
      if (initial) setLoading(true);
      else setRefreshing(true);

      try {
        const [detailRes, accessRes] = await Promise.all([
          fetch(`/api/rooms/code/${roomCode}/detail`, { credentials: "include" }),
          fetch("/api/access/status", { credentials: "include" }),
        ]);

        const detailPayload = (await detailRes.json()) as
          | ({ success?: boolean } & RoomDetailPayload)
          | { error?: string };
        const accessPayload = (await accessRes.json()) as {
          success?: boolean;
          authenticated?: boolean;
        };

        if (!detailRes.ok || !("success" in detailPayload) || !detailPayload.success) {
          throw new Error(("error" in detailPayload && detailPayload.error) || "Failed to load room");
        }

        setDetail(detailPayload);

        const authed = accessRes.ok && accessPayload.success ? Boolean(accessPayload.authenticated) : false;
        setAccessAuthenticated(authed);

        // Task stats for the completion badge.
        try {
          const statsRes = await fetch(
            `/api/planning/tasks/stats?roomId=${encodeURIComponent(String(detailPayload.room.id))}`,
            { credentials: "include" },
          );
          const statsPayload = (await statsRes.json()) as { success?: boolean; stats?: TaskStats };
          if (statsRes.ok && statsPayload.success && statsPayload.stats) {
            setTaskStats(statsPayload.stats);
          }
        } catch {
          /* non-fatal */
        }

        // Project budget total (homeowner-gated).
        if (authed) {
          try {
            const overviewRes = await fetch("/api/budget-tracker/overview", { credentials: "include" });
            if (overviewRes.ok) {
              const overview = (await overviewRes.json()) as BudgetOverviewResponse;
              const total = overview.funds?.totalAllottedCents;
              setProjectBudgetTotalCents(typeof total === "number" && total > 0 ? total : null);
            }
          } catch {
            /* non-fatal */
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load room");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [roomCode],
  );

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  const handleSummaryPatched = useCallback((summary: RoomSummaryRecord | null) => {
    setDetail((current) => (current ? { ...current, summary: summary ?? current.summary } : current));
  }, []);

  const openMedia = useCallback((kind: MediaKind) => {
    setMediaKind(kind);
    setMediaOpen(true);
  }, []);

  // ─── Derived values ─────────────────────────────────────────────────────

  const galleryImages = useMemo(() => {
    if (!detail) return [];
    const images = detail.listingImages.slice(0, 3);
    // Pad with inspiration images if listing is sparse.
    if (images.length < 3) {
      for (const img of detail.inspirationalImages) {
        if (images.length >= 3) break;
        images.push(img);
      }
    }
    return images;
  }, [detail]);

  const totalPhotos = detail
    ? detail.roomStats.listingPhotoCount + detail.roomStats.inspirationPhotoCount
    : 0;
  const extraPhotos = totalPhotos - 3;

  const hasBudget = detail ? detail.budget.items.length > 0 : false;
  const budgetGoalLabel = detail && hasBudget
    ? formatBudgetGoal(detail.budget.totalBudgetLowCents, detail.budget.totalBudgetHighCents)
    : "Budget pending";
  const budgetRangeLabel = detail && hasBudget
    ? `${formatCurrency(detail.budget.totalBudgetLowCents)} – ${formatCurrency(detail.budget.totalBudgetHighCents)}`
    : "No range set";

  const completionPct = useMemo(() => {
    if (taskStats && taskStats.total > 0) {
      return Math.round((taskStats.done / taskStats.total) * 100);
    }
    if (detail) {
      const items = detail.actionItems;
      const total = items.length;
      if (total === 0) return 0;
      const done = items.filter(
        (i) => i.status?.toLowerCase() === "done" || i.status?.toLowerCase() === "complete",
      ).length;
      return Math.round((done / total) * 100);
    }
    return 0;
  }, [detail, taskStats]);

  const summaryOverview = detail?.summary?.summaryObject?.overview || null;
  const summaryStory = detail?.summary?.summaryObject?.renovationStory || null;

  // TOC items.
  const tocItems: ScrollProgressItem[] = detail
    ? [
        { id: SECTION_IDS.gallery, title: detail.room.displayName, level: 1 },
        { id: SECTION_IDS.overview, title: "Overview", level: 1 },
        { id: SECTION_IDS.scope, title: "Remodel scope", level: 1 },
        { id: SECTION_IDS.options, title: "Room options", level: 1 },
        { id: SECTION_IDS.budget, title: "Budget signals", level: 1 },
        { id: SECTION_IDS.supporting, title: "Supporting materials", level: 1 },
      ]
    : [];

  // ─── Loading / error states ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" />
        Loading room detail…
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
        <p className="text-lg font-semibold">Room not found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The requested room slug does not match the current floorplan catalog.
        </p>
      </div>
    );
  }

  const heroImage = detail.representativeImage || detail.listingImages[0] || null;

  return (
    <div className="flex gap-8">
      {/* Main content column. */}
      <div className="min-w-0 flex-1">
        {/* Back link + refresh. */}
        <div className="mb-4 flex items-center justify-between">
          <a
            href="/floor-plan"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to floor plan
          </a>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              Beta viewport
            </Badge>
            <Button variant="outline" size="sm" onClick={() => void loadData(false)} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>

        <div className="mx-auto max-w-6xl space-y-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* ─── Left column (2/3) ─────────────────────────────── */}
            <div className="space-y-6 lg:col-span-2">
              {/* Image Gallery — @bundui/property-detail-01 pattern. */}
              <section id={SECTION_IDS.gallery} className="scroll-mt-24">
                <div className="grid grid-cols-3 gap-3">
                  {/* Hero image — large. */}
                  <div className="relative col-span-3 aspect-[4/3] overflow-hidden rounded-2xl ring-1 ring-foreground/10 md:col-span-2">
                    {galleryImages[0] ? (
                      <img
                        src={resolveImageUrl(galleryImages[0])}
                        alt={galleryImages[0].displayName || detail.room.displayName}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-2 bg-muted/20 text-muted-foreground">
                        <Camera className="size-8" />
                        <p className="text-sm">No photos yet</p>
                      </div>
                    )}
                  </div>
                  {/* Secondary images — stacked. */}
                  <div className="col-span-3 grid grid-cols-2 gap-3 md:col-span-1 md:grid-cols-1">
                    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl ring-1 ring-foreground/10">
                      {galleryImages[1] ? (
                        <img
                          src={resolveImageUrl(galleryImages[1])}
                          alt={galleryImages[1].displayName || `${detail.room.displayName} view 2`}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-muted/20">
                          <ImageIcon className="size-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => openMedia("listing")}
                      className="relative aspect-[4/3] overflow-hidden rounded-2xl ring-1 ring-foreground/10 transition-opacity hover:opacity-90"
                    >
                      {galleryImages[2] ? (
                        <img
                          src={resolveImageUrl(galleryImages[2])}
                          alt={galleryImages[2].displayName || `${detail.room.displayName} view 3`}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-muted/20">
                          <ImageIcon className="size-6 text-muted-foreground" />
                        </div>
                      )}
                      {extraPhotos > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <span className="text-3xl font-bold text-white">{extraPhotos}+</span>
                        </div>
                      )}
                    </button>
                  </div>
                </div>
              </section>

              {/* Room Identity — retrofitted Property Info. */}
              <section id={SECTION_IDS.identity} className="scroll-mt-24 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">
                    {detail.room.displayName}
                  </h1>
                  <div className="text-3xl font-semibold tabular-nums whitespace-nowrap text-foreground">
                    {budgetGoalLabel}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="size-4" />
                    <span className="text-sm">
                      {floorZoneLabel(detail.room.floorName, detail.room.floorKey)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <ClipboardList className="size-4 text-chart-1" />
                    <span className="tabular-nums">{completionPct}% complete</span>
                  </div>
                  {detail.room.dimensionLabel && (
                    <Badge variant="secondary">{detail.room.dimensionLabel}</Badge>
                  )}
                  {detail.room.asIsUse && (
                    <Badge variant="outline">{detail.room.asIsUse}</Badge>
                  )}
                </div>
              </section>

              {/* Room Overview — retrofitted Description. */}
              <section id={SECTION_IDS.overview} className="scroll-mt-24 space-y-3">
                {summaryOverview ? (
                  <p className="text-muted-foreground leading-relaxed">{summaryOverview}</p>
                ) : detail.summary?.summaryMarkdown ? (
                  <pre className="whitespace-pre-wrap rounded-2xl bg-muted/20 p-4 text-sm leading-7 text-muted-foreground ring-1 ring-foreground/10">
                    {detail.summary.summaryMarkdown}
                  </pre>
                ) : (
                  <div className="rounded-2xl bg-muted/10 px-4 py-8 text-center ring-1 ring-foreground/10">
                    <Sparkles className="mx-auto mb-2 size-5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No room summary generated yet — use the Quick Actions panel to create one.
                    </p>
                  </div>
                )}
                {summaryStory && (
                  <div className="rounded-xl bg-muted/10 p-4 ring-1 ring-foreground/10">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Renovation Story
                    </p>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">{summaryStory}</p>
                  </div>
                )}
                {/* General notes / problem areas from the room record. */}
                {(detail.room.generalNotes || detail.room.problemAreas) && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {detail.room.generalNotes && (
                      <div className="rounded-xl bg-muted/15 px-4 py-3 ring-1 ring-foreground/10">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Notes
                        </p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {detail.room.generalNotes}
                        </p>
                      </div>
                    )}
                    {detail.room.problemAreas && (
                      <div className="rounded-xl bg-muted/15 px-4 py-3 ring-1 ring-foreground/10">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Problem Areas
                        </p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {detail.room.problemAreas}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Remodel Scope — retrofitted "Areas & Lot". */}
              <section id={SECTION_IDS.scope} className="scroll-mt-24 space-y-4">
                <h2 className="text-base font-semibold">Remodel Scope</h2>
                <Card className="ring-1 ring-foreground/10">
                  <CardContent className="divide-y divide-foreground/10 text-sm [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:py-4 first:[&>div]:pt-0 last:[&>div]:pb-0">
                    <div>
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium">
                        {detail.scenarioPlans.length > 0
                          ? detail.scenarioPlans[0].stage
                          : "Planning"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Location</span>
                      <span className="font-medium">
                        {floorZoneLabel(detail.room.floorName, detail.room.floorKey)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Budget range</span>
                      <span className="font-medium tabular-nums">{budgetRangeLabel}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Budget items</span>
                      <span className="font-medium tabular-nums">{detail.budget.items.length}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Scenario plans</span>
                      <span className="font-medium tabular-nums">{detail.scenarioPlans.length}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Vision nodes</span>
                      <span className="font-medium tabular-nums">{detail.visionNodes.length}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Estimate revisions</span>
                      <span className="font-medium tabular-nums">{detail.estimates.length}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Vision node details — each gets a row. */}
                {detail.visionNodes.length > 0 && (
                  <Card className="ring-1 ring-foreground/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">What's happening in this room</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {detail.visionNodes.map((node) => (
                        <div
                          key={node.id}
                          className="flex items-center justify-between rounded-lg bg-muted/10 px-3 py-2 ring-1 ring-foreground/5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{node.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {node.nodeType} · {node.status}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {typeof node.estimatedCostCents === "number" && (
                              <Badge variant="outline" className="tabular-nums">
                                {formatCurrency(node.estimatedCostCents)}
                              </Badge>
                            )}
                            <Badge variant="secondary">{node.childCount} children</Badge>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </section>
            </div>

            {/* ─── Sidebar (1/3) ──────────────────────────────── */}
            <div className="space-y-4">
              {/* Room Intelligence card (retrofitted Agent card). */}
              <Card className="bg-muted/50 ring-1 ring-foreground/10">
                <CardContent className="space-y-5 pt-6">
                  {/* Hero thumbnail + room code. */}
                  <div className="flex items-start gap-4">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-foreground/10">
                      {heroImage ? (
                        <img
                          src={resolveImageUrl(heroImage)}
                          alt={detail.room.displayName}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-muted/30">
                          <Camera className="size-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-bold">{detail.room.displayName}</h3>
                      <p className="text-sm text-muted-foreground">{detail.room.floorName}</p>
                    </div>
                  </div>

                  {/* Key stats as label–value pairs. */}
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Room code</span>
                      <span className="font-mono font-medium text-xs">{detail.room.roomCode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Listing photos</span>
                      <span className="font-medium tabular-nums">
                        {detail.roomStats.listingPhotoCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inspiration photos</span>
                      <span className="font-medium tabular-nums">
                        {detail.roomStats.inspirationPhotoCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Supporting docs</span>
                      <span className="font-medium tabular-nums">
                        {detail.roomStats.supportingDocumentCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Vision nodes</span>
                      <span className="font-medium tabular-nums">
                        {detail.roomStats.visionNodeCount}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Completion</span>
                      <span className="font-medium tabular-nums">{completionPct}%</span>
                    </div>
                  </div>

                  <a href={`/rooms/${roomCode}`}>
                    <Button className="w-full" variant="outline">
                      <Eye className="mr-2 size-4" />
                      View full room page
                    </Button>
                  </a>
                </CardContent>
              </Card>

              {/* Quick Actions card (retrofitted Schedule Tour). */}
              <Card className="bg-muted/50 ring-1 ring-foreground/10">
                <CardHeader>
                  <CardTitle className="text-base">Quick Actions</CardTitle>
                  <CardDescription>
                    Manage this room's photos, documents, and AI-generated summary directly from here.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label className="text-muted-foreground text-sm">Room Code</Label>
                      <Input value={detail.room.roomCode} readOnly className="bg-muted font-mono" />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-muted-foreground text-sm">Room Name</Label>
                      <Input value={detail.room.displayName} readOnly className="bg-muted" />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        onClick={() => openMedia("listing")}
                      >
                        <Images className="mr-2 size-4" />
                        Listing
                        <Badge variant="secondary" className="ml-auto">
                          {detail.roomStats.listingPhotoCount}
                        </Badge>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start"
                        onClick={() => openMedia("inspiration")}
                      >
                        <Sparkles className="mr-2 size-4" />
                        Inspiration
                        <Badge variant="secondary" className="ml-auto">
                          {detail.roomStats.inspirationPhotoCount}
                        </Badge>
                      </Button>
                    </div>

                    <Button
                      className="w-full"
                      onClick={() => openMedia("listing")}
                    >
                      <Camera className="mr-2 size-4" />
                      View all photos
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ─── Full-width sections below the fold ──────────── */}

          <section id={SECTION_IDS.options} className="scroll-mt-24">
            <RoomOptions roomCode={roomCode} detail={detail} />
          </section>

          <section id={SECTION_IDS.budget} className="scroll-mt-24">
            <BudgetSignals roomCode={roomCode} detail={detail} />
          </section>

          <section id={SECTION_IDS.supporting} className="scroll-mt-24">
            <SupportingMaterials roomCode={roomCode} detail={detail} />
          </section>
        </div>
      </div>

      {/* Sticky scroll-progress TOC — hidden on small screens. */}
      <aside className="hidden w-56 shrink-0 xl:block">
        <div className="sticky top-24">
          <ScrollProgress items={tocItems} />
        </div>
      </aside>

      {/* Shared media modal — same as the current room viewport. */}
      <RoomMediaModal
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        kind={mediaKind}
        onKindChange={setMediaKind}
        detail={detail}
        accessAuthenticated={accessAuthenticated}
        onRefresh={() => void loadData(false)}
      />
    </div>
  );
}

export default RoomDetailBetaApp;
