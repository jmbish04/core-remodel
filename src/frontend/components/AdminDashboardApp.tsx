import { Activity, Clock3, Eye, Loader2, MousePointerClick, Route } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AdminOverview {
  success: boolean;
  summary: {
    visitors: number;
    pageViews: number;
    clicks: number;
    avgTimeSeconds: number;
    messageCount: number;
    uploadCount: number;
  };
  topPaths: Array<{ path: string; views: number }>;
  sessions: Array<{
    id: string;
    firstPath: string | null;
    lastPath: string | null;
    country: string | null;
    city: string | null;
    lastSeenAt: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    eventType: string;
    path: string;
    element: string | null;
    durationMs: number | null;
    datetimeCreated: string | null;
  }>;
  recentUploads: Array<{
    id: string;
    name: string | null;
    category: string;
    roomType: string | null;
    createdAt: string | null;
  }>;
}

function formatDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export function AdminDashboardApp() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<AdminOverview | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/overview", { credentials: "include" });
        const result = (await response.json()) as AdminOverview & { error?: string };

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Failed to load admin analytics");
        }

        setPayload(result);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load admin data");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const summary = useMemo(() => payload?.summary, [payload?.summary]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading visitor analytics...
      </div>
    );
  }

  if (!payload || !summary) {
    return (
      <p className="py-12 text-sm text-muted-foreground">
        No admin data is currently available.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="size-4 text-muted-foreground" />
              Visitors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.visitors}</p>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-muted-foreground" />
              Page Views
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.pageViews}</p>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MousePointerClick className="size-4 text-muted-foreground" />
              Clicks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.clicks}</p>
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="size-4 text-muted-foreground" />
              Avg Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{summary.avgTimeSeconds}s</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="size-4 text-muted-foreground" />
              Top Paths
            </CardTitle>
            <CardDescription>Most viewed pages by contractors and collaborators.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {payload.topPaths.length === 0 ? (
              <p className="text-sm text-muted-foreground">No page-view data yet.</p>
            ) : (
              payload.topPaths.map((item) => (
                <div key={item.path} className="flex items-center justify-between rounded-md bg-muted/20 px-3 py-2 ring-1 ring-border/30">
                  <p className="truncate text-sm">{item.path}</p>
                  <p className="text-xs text-muted-foreground">{item.views} views</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Recent Uploads</CardTitle>
            <CardDescription>Newest photos recorded in D1 + Cloudflare Images.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {payload.recentUploads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No uploads recorded yet.</p>
            ) : (
              payload.recentUploads.map((upload) => (
                <div key={upload.id} className="rounded-md bg-muted/20 px-3 py-2 ring-1 ring-border/30">
                  <p className="text-sm font-medium">{upload.name?.trim() || "Untitled photo"}</p>
                  <p className="text-xs text-muted-foreground">
                    {upload.category} · {upload.roomType || "unassigned"}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(upload.createdAt)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Recent Visitor Activity</CardTitle>
          <CardDescription>Latest interaction events and dwell-time pings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {payload.recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No visitor events yet.</p>
          ) : (
            payload.recentEvents.slice(0, 80).map((event) => (
              <div key={event.id} className="rounded-md bg-muted/20 px-3 py-2 ring-1 ring-border/30">
                <p className="text-sm font-medium">{event.eventType} · {event.path}</p>
                <p className="text-xs text-muted-foreground">
                  {event.element ? `${event.element} · ` : ""}
                  {event.durationMs ? `${Math.round(event.durationMs / 1000)}s` : ""}
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(event.datetimeCreated)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
