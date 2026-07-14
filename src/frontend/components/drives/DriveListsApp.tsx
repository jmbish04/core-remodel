/**
 * @fileoverview Showroom Drives — landing island.
 *
 * Lists drive sheets newest-first (from `GET /api/drive-lists`) with a per-drive
 * completion bar (showrooms visited vs. total). Each card links to the drive
 * viewport at `/admin/shopping/drives/<slug>`. Drives are created via the
 * `create_drive_list` MCP tool, not the UI.
 *
 * Monolith rules: dark theme, theme tokens only, no 1px borders.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, MapPinned, Route } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DriveMapThumb, type LatLng } from "./DriveMapThumb";

type DriveListSummary = {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  stopCount: number;
  visitedCount: number;
  createdAt: string | number | null;
  markers: LatLng[];
};

/** Archived tab = archived or completed drives; Active = everything else. */
function isArchived(status: string): boolean {
  return status === "archived" || status === "completed";
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
        Planned showroom-visit drive sheets — newest first, with each drive's completion progress.
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

  const active = drives.filter((d) => !isArchived(d.status));
  const archived = drives.filter((d) => isArchived(d.status));

  const grid = (list: DriveListSummary[], emptyLabel: string) =>
    list.length === 0 ? (
      <p className="py-12 text-center text-sm text-muted-foreground">{emptyLabel}</p>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((d) => (
          <DriveCard key={d.id} drive={d} />
        ))}
      </div>
    );

  return (
    <div>
      {header}
      <Tabs defaultValue="active">
        <TabsList className="mb-6">
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="archived">Archived ({archived.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active">{grid(active, "No active drives.")}</TabsContent>
        <TabsContent value="archived">
          {grid(archived, "No archived drives yet — a drive archives when every stop is visited.")}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DriveCard({ drive }: { drive: DriveListSummary }) {
  const pct = useMemo(
    () => (drive.stopCount ? Math.round((drive.visitedCount / drive.stopCount) * 100) : 0),
    [drive.stopCount, drive.visitedCount],
  );
  const complete = drive.stopCount > 0 && drive.visitedCount === drive.stopCount;
  const date = fmtDate(drive.createdAt);

  return (
    <a
      href={`/admin/shopping/drives/${drive.slug}`}
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full overflow-hidden transition-colors group-hover:bg-card/80">
        <CardContent className="flex h-full flex-col gap-3 p-5">
          <DriveMapThumb markers={drive.markers} />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold">{drive.title}</h2>
              {date ? <p className="mt-0.5 text-xs text-muted-foreground">Registered {date}</p> : null}
            </div>
            <Badge variant={complete ? "default" : "outline"} className="shrink-0 capitalize">
              {complete ? "Complete" : drive.status}
            </Badge>
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
        </CardContent>
      </Card>
    </a>
  );
}

export default DriveListsApp;
