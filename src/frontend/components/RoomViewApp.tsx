import { Loader2, RefreshCw } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollProgress, type ScrollProgressItem } from "@/components/ui/scroll-progress";
import {
  BudgetSignals,
  HeroHeader,
  RoomMediaModal,
  RoomOptions,
  RoomOverview,
  RoomStatsRow,
  ROOM_SECTION_IDS,
  SupportingMaterials,
  type MediaKind,
  type RoomDetailPayload,
  type RoomSummaryRecord,
} from "@/components/room-view";

/**
 * RoomViewApp — the room viewport orchestrator.
 *
 * After the Round 3a decomposition this file is intentionally THIN: it owns
 *   1. data fetching (`GET /api/rooms/code/:roomCode/detail`),
 *   2. access status (`GET /api/access/status`),
 *   3. the total-project-budget denominator for the stats-row % sub-stat
 *      (`GET /api/budget-tracker/overview`, homeowner-gated),
 *   4. the shared Room Media modal open/kind state (the hero buttons drive it),
 *   5. page layout + the sticky scroll-progress TOC,
 * and delegates every section to a component under `components/room-view/`.
 *
 * Section order (each wrapped in a stable anchor id for the TOC + stat-card
 * deep links): Hero → Stats → Overview → Options → Budget Signals (hosts the
 * Estimates anchor) → Supporting Materials. The Room Media modal is mounted
 * once and toggled by the hero's Listing/Inspiration buttons.
 *
 * Stub sections (`BudgetSignals`, `SupportingMaterials`, `RoomMediaModal`) are
 * already mounted with their final prop contracts so Round 3b can flesh them
 * out WITHOUT touching this orchestrator.
 */

/** Shape of the slice of `GET /api/budget-tracker/overview` we consume. */
interface BudgetOverviewResponse {
  funds?: {
    totalAllottedCents?: number;
  };
}

export function RoomViewApp(props: { roomCode: string }) {
  const { roomCode } = props;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<RoomDetailPayload | null>(null);
  const [accessAuthenticated, setAccessAuthenticated] = useState(false);
  const [projectBudgetTotalCents, setProjectBudgetTotalCents] = useState<number | null>(null);

  // Room Media modal state lives here because two different hero buttons open
  // it pre-filtered to a bucket; the modal itself is otherwise self-contained.
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaKind, setMediaKind] = useState<MediaKind>("listing");

  const loadData = useCallback(
    async (setLoadingState: boolean) => {
      if (setLoadingState) setLoading(true);
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

        // The project-budget total powers the "% of project budget" sub-stat.
        // It is homeowner-gated, so only attempt it when authenticated; any
        // failure is non-fatal (the % badge simply does not render).
        if (authed) {
          try {
            const overviewRes = await fetch("/api/budget-tracker/overview", { credentials: "include" });
            if (overviewRes.ok) {
              const overview = (await overviewRes.json()) as BudgetOverviewResponse;
              const total = overview.funds?.totalAllottedCents;
              setProjectBudgetTotalCents(typeof total === "number" && total > 0 ? total : null);
            }
          } catch {
            // Non-fatal — leave the denominator null.
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

  // Merge a freshly-saved/regenerated summary into the held detail so hero +
  // overview changes reflect immediately without a full reload.
  const handleSummaryPatched = useCallback((summary: RoomSummaryRecord | null) => {
    setDetail((current) => (current ? { ...current, summary: summary ?? current.summary } : current));
  }, []);

  const openMedia = useCallback((kind: MediaKind) => {
    setMediaKind(kind);
    setMediaOpen(true);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-3 size-5 animate-spin" />
        Loading room view...
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

  // TOC entries — ordered, mirroring the on-page section anchors.
  const tocItems: ScrollProgressItem[] = [
    { id: ROOM_SECTION_IDS.hero, title: detail.room.displayName, level: 1 },
    { id: ROOM_SECTION_IDS.stats, title: "At a glance", level: 1 },
    { id: ROOM_SECTION_IDS.overview, title: "Overview", level: 1 },
    { id: ROOM_SECTION_IDS.options, title: "Room options", level: 1 },
    { id: ROOM_SECTION_IDS.budget, title: "Budget signals", level: 1 },
    { id: ROOM_SECTION_IDS.estimates, title: "Estimate revisions", level: 2 },
    { id: ROOM_SECTION_IDS.supporting, title: "Supporting materials", level: 1 },
  ];

  return (
    <div className="flex gap-8">
      {/* Main column. */}
      <div className="min-w-0 flex-1 space-y-8">
        <div className="flex items-start justify-end">
          <Button variant="outline" size="sm" onClick={() => void loadData(false)} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Refresh
          </Button>
        </div>

        <section id={ROOM_SECTION_IDS.hero} className="scroll-mt-24">
          <HeroHeader
            roomCode={roomCode}
            detail={detail}
            accessAuthenticated={accessAuthenticated}
            onOpenMedia={openMedia}
            onSummaryPatched={handleSummaryPatched}
            onRequestRefresh={() => void loadData(false)}
          />
        </section>

        <section id={ROOM_SECTION_IDS.stats} className="scroll-mt-24">
          <RoomStatsRow detail={detail} projectBudgetMidCents={projectBudgetTotalCents} />
        </section>

        <section id={ROOM_SECTION_IDS.overview} className="scroll-mt-24">
          <RoomOverview
            roomCode={roomCode}
            detail={detail}
            accessAuthenticated={accessAuthenticated}
            onSummaryPatched={handleSummaryPatched}
          />
        </section>

        <section id={ROOM_SECTION_IDS.options} className="scroll-mt-24">
          <RoomOptions roomCode={roomCode} detail={detail} />
        </section>

        {/* BudgetSignals owns both the budget-signals and estimates anchors. */}
        <section className="scroll-mt-24">
          <BudgetSignals roomCode={roomCode} detail={detail} />
        </section>

        {/* SupportingMaterials owns the supporting-materials anchor. */}
        <section className="scroll-mt-24">
          <SupportingMaterials roomCode={roomCode} detail={detail} />
        </section>
      </div>

      {/* Sticky scroll-progress TOC — hidden on small screens. */}
      <aside className="hidden w-56 shrink-0 xl:block">
        <div className="sticky top-24">
          <ScrollProgress items={tocItems} />
        </div>
      </aside>

      {/* Single shared media modal, toggled by the hero buttons. */}
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

export default RoomViewApp;
