/**
 * @fileoverview Showroom Drives — landing island.
 *
 * Lists drive sheets newest-first (from `GET /api/drive-lists`) bucketed by what
 * actually happened on them: Pending (no stop visited yet), In progress (some),
 * Finished (all). Exactly one drive can be THE active drive — the one admin
 * devices auto-land on — shown as a badge and flipped with the per-card toggle
 * (`PATCH /api/drive-lists/<slug>` with `{isActive}`).
 *
 * Monolith rules: dark theme, theme tokens only, no 1px borders.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, MapPinned, Route, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DriveMapThumb, type LatLng } from "./DriveMapThumb";
import { TeslaStreamControl } from "./TeslaStreamControl";

type DriveListSummary = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  isActive: boolean;
  stopCount: number;
  visitedCount: number;
  createdAt: string | number | null;
  markers: LatLng[];
};

type Bucket = "pending" | "partial" | "finished";

/** Which tab a drive belongs in — decided by progress, never by `status`. */
function bucketOf(d: DriveListSummary): Bucket {
  if (d.stopCount > 0 && d.visitedCount >= d.stopCount) return "finished";
  return d.visitedCount > 0 ? "partial" : "pending";
}

function fmtDate(t: string | number | null): string {
  if (t === null || t === "") return "";
  const d = new Date(typeof t === "number" ? t * 1000 : t);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Showroom Drives landing island: the stream-ingest control, then drive sheets
 * bucketed into Pending / In progress / Finished with a per-card active toggle.
 * @returns The drives dashboard (no props).
 */
export function DriveListsApp() {
  const [drives, setDrives] = useState<DriveListSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/drive-lists", { credentials: "include" });
        if (res.status === 401) {
          if (active) setError("unauthorized");
          return;
        }
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as { driveLists: DriveListSummary[] };
        if (active) setDrives(data.driveLists ?? []);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const header = (
    <header className="mb-8">
      <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold tracking-tight">
        <Route className="size-6 text-muted-foreground" />
        Showroom Drives
      </h1>
      <p className="text-muted-foreground">
        Planned showroom-visit drive sheets, bucketed by progress. Exactly one drive can be active —
        the one this device auto-lands on — set with the toggle on its card.
      </p>
    </header>
  );

  if (error === "unauthorized") {
    return (
      <div>
        {header}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Admin sign-in required</AlertTitle>
          <AlertDescription>Sign in to the admin portal to view drive lists.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {header}
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load drives</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!drives) {
    return (
      <div>
        {header}
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (drives.length === 0) {
    return (
      <div>
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <MapPinned className="size-8 text-muted-foreground" />
            <p className="text-lg font-semibold">No drive lists yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask the assistant to build one — the <code>create_drive_list</code> MCP tool adds a
              drive sheet here that you can open and check off as you visit.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Activating one drive deactivates whichever was active — mirror that locally
  // so the badge/toggle can't show two active drives while the PATCH is in flight.
  const setActive = async (slug: string, isActive: boolean) => {
    // Functional updates throughout: two toggles in quick succession must not
    // let the second one write a snapshot taken before the first landed.
    const wasActive = drives.find((d) => d.isActive)?.slug ?? null;
    setDrives((prev) => prev?.map((d) => ({ ...d, isActive: isActive && d.slug === slug })) ?? prev);
    try {
      const res = await fetch(`/api/drive-lists/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (e) {
      // Roll back only the active slot — never a whole-list snapshot, which
      // would clobber whatever a concurrent toggle already committed.
      setDrives((prev) => prev?.map((d) => ({ ...d, isActive: d.slug === wasActive })) ?? prev);
      setError((e as Error).message);
    }
  };

  const grid = (list: DriveListSummary[], emptyLabel: string) =>
    list.length === 0 ? (
      <p className="py-12 text-center text-sm text-muted-foreground">{emptyLabel}</p>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((d) => (
          <DriveCard key={d.id} drive={d} onSetActive={setActive} />
        ))}
      </div>
    );

  const pending = drives.filter((d) => bucketOf(d) === "pending");
  const partial = drives.filter((d) => bucketOf(d) === "partial");
  const finished = drives.filter((d) => bucketOf(d) === "finished");

  return (
    <div>
      {header}
      <TeslaStreamControl />
      <Tabs defaultValue={partial.length ? "partial" : "pending"}>
        <TabsList className="mb-6">
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="partial">In progress ({partial.length})</TabsTrigger>
          <TabsTrigger value="finished">Finished ({finished.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          {grid(pending, "No pending drives — every planned drive has been started.")}
        </TabsContent>
        <TabsContent value="partial">
          {grid(partial, "No drives part-way through.")}
        </TabsContent>
        <TabsContent value="finished">
          {grid(finished, "No finished drives yet — a drive finishes when every stop is visited.")}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DriveCard({
  drive,
  onSetActive,
}: {
  drive: DriveListSummary;
  onSetActive: (slug: string, isActive: boolean) => void;
}) {
  const pct = useMemo(
    () => (drive.stopCount ? Math.round((drive.visitedCount / drive.stopCount) * 100) : 0),
    [drive.stopCount, drive.visitedCount],
  );
  const complete = drive.stopCount > 0 && drive.visitedCount === drive.stopCount;
  const date = fmtDate(drive.createdAt);

  return (
    <Card
      className={cn(
        "h-full overflow-hidden",
        drive.isActive && "ring-2 ring-primary/60",
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 p-5">
        {/* The link covers the card body only — the toggle below sits outside it
            so flipping the active drive never navigates away. */}
        <a
          href={`/admin/shopping/drives/${drive.slug}`}
          className="group flex flex-1 flex-col gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DriveMapThumb markers={drive.markers} />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold">{drive.title}</h2>
              {date ? <p className="mt-0.5 text-xs text-muted-foreground">Registered {date}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {drive.isActive ? (
                <Badge className="gap-1">
                  <Zap className="size-3" aria-hidden /> Active
                </Badge>
              ) : null}
              <Badge variant={complete ? "default" : "outline"} className="capitalize">
                {complete ? "Complete" : drive.visitedCount > 0 ? "In progress" : "Pending"}
              </Badge>
            </div>
          </div>

          {drive.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{drive.description}</p>
          ) : null}

          <div className="mt-auto space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{drive.visitedCount}</span> of{" "}
                {drive.stopCount} visited
              </span>
              <span className="font-semibold">{pct}%</span>
            </div>
            <ProgressBar pct={pct} />
          </div>

          <div className="flex items-center justify-end text-sm font-medium text-primary">
            Open drive
            <ChevronRight className={cn("size-4 transition-transform group-hover:translate-x-0.5")} />
          </div>
        </a>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-muted-foreground">
            {drive.isActive ? "This is the active drive" : "Make this the active drive"}
          </span>
          <Switch
            checked={drive.isActive}
            onCheckedChange={(next) => onSetActive(drive.slug, next)}
            aria-label={`Set "${drive.title}" as the active drive`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default DriveListsApp;
