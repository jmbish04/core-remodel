import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PermitRun = {
  id: string;
  runType: string;
  queryLabel: string;
  sourceDataset: string;
  status: string;
  resultCount: number;
  aiSummary?: string | null;
  errorText?: string | null;
  datetimeCreated: string | number | Date;
};

type PermitRecord = {
  id: string;
  dataset: string;
  permitIdentifier?: string | null;
  applicationNumber?: string | null;
  permitNumber?: string | null;
  permitType?: string | null;
  permitStatus?: string | null;
  statusCategory?: string | null;
  propertyAddress?: string | null;
  block?: string | null;
  lot?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  issuedDate?: string | null;
  expiresDate?: string | null;
  closedDate?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  rawData?: string | null;
  changeHash?: string | null;
  datetimeUpdated: string | number | Date;
};

type PermitRevision = {
  id: string;
  runId: string;
  dataset: string;
  recordKey: string;
  permitNumber?: string | null;
  permitStatus?: string | null;
  rawData: string;
  datetimeCreated: string | number | Date;
};

type PropertyPermit = {
  permitIdentifier: string;
  applicationNumber?: string | null;
  permitNumber?: string | null;
  permitType?: string | null;
  permitStatus?: string | null;
  statusCategory?: string | null;
  propertyAddress?: string | null;
  block?: string | null;
  lot?: string | null;
  issuedDate?: string | null;
  closedDate?: string | null;
  contactNames: string[];
  datasets: string[];
  changeHash?: string | null;
  lastChangedAt?: string | number | Date | null;
  lastViewedHash?: string | null;
  needsReview: boolean;
  isClosed: boolean;
};

type ContactCard = {
  contactName: string;
  isMonitored: boolean;
  activePropertyPermitCount: number;
  closedPropertyPermitCount: number;
  workload: {
    open: number;
    inProgress: number;
    pending: number;
    completed: number;
  };
  averageCloseDays: number | null;
  averageCloseDaysByType: Array<{
    permitType: string;
    averageCloseDays: number | null;
    count: number;
  }>;
  mapPoints: Array<{
    latitude: number;
    longitude: number;
    statusCategory: string;
    propertyAddress: string | null;
  }>;
  insight: {
    riskLevel: string;
    summary: string;
    highlights: string[];
    metrics: Record<string, unknown> | null;
  } | null;
};

type PermitDashboardPayload = {
  success: boolean;
  summary: {
    runCount: number;
    recordCount: number;
    contactCount: number;
    contactActivityCount: number;
    propertyPermitCount: number;
    needsReviewCount: number;
  };
  latestRuns: PermitRun[];
  latestRecords: PermitRecord[];
  propertyPermits: PropertyPermit[];
};

type PermitDetailPayload = {
  success: boolean;
  detail: {
    permitIdentifier: string;
    needsReview: boolean;
    records: PermitRecord[];
    revisions: PermitRevision[];
    viewed: {
      permitIdentifier: string;
      lastViewedHash?: string | null;
      lastViewedAt?: string | number | Date | null;
      viewCount: number;
    } | null;
  };
};

type ContactsPayload = {
  success: boolean;
  contractorCards: ContactCard[];
};

function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function riskBadgeVariant(riskLevel: string): "default" | "secondary" | "destructive" | "outline" {
  const normalized = riskLevel.trim().toLowerCase();
  if (normalized === "high") return "destructive";
  if (normalized === "low") return "secondary";
  return "outline";
}

function statusColor(statusCategory: string): string {
  const status = statusCategory.trim().toLowerCase();
  if (status === "completed") return "bg-emerald-500";
  if (status === "in_progress") return "bg-blue-500";
  if (status === "pending") return "bg-amber-500";
  if (status === "cancelled") return "bg-zinc-500";
  return "bg-fuchsia-500";
}

function statusLabel(statusCategory: string | null | undefined): string {
  if (!statusCategory) return "other";
  return statusCategory.replace(/_/g, " ");
}

function PermitMap({
  cards,
  selectedContractor,
}: {
  cards: ContactCard[];
  selectedContractor: string;
}) {
  const filteredCards = useMemo(() => {
    if (!selectedContractor) return cards;
    return cards.filter((card) => card.contactName === selectedContractor);
  }, [cards, selectedContractor]);

  const points = useMemo(
    () =>
      filteredCards.flatMap((card) =>
        card.mapPoints.map((point) => ({
          ...point,
          contactName: card.contactName,
        })),
      ),
    [filteredCards],
  );

  const bounds = useMemo(() => {
    const latitudes = points.map((row) => row.latitude).filter(Number.isFinite);
    const longitudes = points.map((row) => row.longitude).filter(Number.isFinite);
    if (latitudes.length === 0 || longitudes.length === 0) {
      return {
        minLat: 37.62,
        maxLat: 37.95,
        minLng: -122.58,
        maxLng: -121.95,
      };
    }
    const minLat = Math.min(...latitudes) - 0.02;
    const maxLat = Math.max(...latitudes) + 0.02;
    const minLng = Math.min(...longitudes) - 0.02;
    const maxLng = Math.max(...longitudes) + 0.02;
    return { minLat, maxLat, minLng, maxLng };
  }, [points]);

  const projected = useMemo(
    () =>
      points.map((point) => {
        const lngSpan = Math.max(0.0001, bounds.maxLng - bounds.minLng);
        const latSpan = Math.max(0.0001, bounds.maxLat - bounds.minLat);
        const x = ((point.longitude - bounds.minLng) / lngSpan) * 100;
        const y = 100 - ((point.latitude - bounds.minLat) / latSpan) * 100;
        return {
          ...point,
          x: Math.min(98, Math.max(2, x)),
          y: Math.min(98, Math.max(2, y)),
        };
      }),
    [bounds.maxLat, bounds.maxLng, bounds.minLat, bounds.minLng, points],
  );

  return (
    <div className="space-y-2">
      <div className="relative h-[320px] overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-slate-900 via-slate-850 to-slate-800">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.08),transparent_40%),radial-gradient(circle_at_75%_80%,rgba(34,211,238,0.12),transparent_35%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:40px_40px]" />

        {projected.map((point, index) => (
          <div
            key={`${point.contactName}-${index}`}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            title={`${point.contactName} · ${statusLabel(point.statusCategory)} · ${point.propertyAddress || "Address unavailable"}`}
          >
            <span
              className={cn(
                "block size-3 rounded-full ring-2 ring-background/80 transition group-hover:scale-125",
                statusColor(point.statusCategory),
              )}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Marker colors: blue in progress, amber pending, green completed, gray cancelled.
      </p>
    </div>
  );
}

function ContractorInsightsSection() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState<ContactsPayload | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedContractor, setSelectedContractor] = useState("");

  const loadData = useCallback(async (withLoading: boolean) => {
    if (withLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const response = await fetch("/api/admin/permits/contacts", { credentials: "include" });
      const result = (await response.json()) as ContactsPayload & { error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to load contractor intelligence");
      }
      setPayload(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load contractor intelligence");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  const cards = payload?.contractorCards || [];
  const filteredCards = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    if (!term) return cards;
    return cards.filter((card) => card.contactName.toLowerCase().includes(term));
  }, [cards, deferredSearch]);

  const totals = useMemo(
    () => ({
      contractors: cards.length,
      monitored: cards.filter((card) => card.isMonitored).length,
      openPermits: cards.reduce((sum, card) => sum + card.workload.open, 0),
      highRisk: cards.filter((card) => card.insight?.riskLevel?.toLowerCase() === "high").length,
    }),
    [cards],
  );

  if (loading) {
    return (
      <div className="flex min-h-[40svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading contractor permit intelligence...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-xl">Contractor Permit Intelligence</CardTitle>
              <CardDescription>
                Cross-property permit activity for contacts attached to 126 Colby permits (last 365 days + YTD).
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadData(false)} disabled={refreshing}>
              {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Contacts</p>
            <p className="mt-1 text-lg font-semibold">{totals.contractors}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Monitored</p>
            <p className="mt-1 text-lg font-semibold">{totals.monitored}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Open Permits</p>
            <p className="mt-1 text-lg font-semibold">{totals.openPermits}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">High Risk</p>
            <p className="mt-1 text-lg font-semibold">{totals.highRisk}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Bay Area Activity Map</CardTitle>
          <CardDescription>
            Status-coded permit markers for selected contractor activity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <Input
              placeholder="Filter contractors..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={selectedContractor}
              onChange={(event) => setSelectedContractor(event.target.value)}
            >
              <option value="">All contractors</option>
              {filteredCards.map((card) => (
                <option key={card.contactName} value={card.contactName}>
                  {card.contactName}
                </option>
              ))}
            </select>
          </div>
          <PermitMap cards={filteredCards} selectedContractor={selectedContractor} />
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {filteredCards.map((card) => {
          const total = Math.max(
            1,
            card.workload.open + card.workload.completed + card.workload.pending + card.workload.inProgress,
          );
          const inProgressWidth = `${(card.workload.inProgress / total) * 100}%`;
          const pendingWidth = `${(card.workload.pending / total) * 100}%`;
          const completedWidth = `${(card.workload.completed / total) * 100}%`;

          return (
            <Card key={card.contactName} className="ring-1 ring-border/40">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{card.contactName}</CardTitle>
                    <CardDescription>
                      Active on property permits: {card.activePropertyPermitCount} · Closed: {card.closedPropertyPermitCount}
                    </CardDescription>
                  </div>
                  <Badge variant={riskBadgeVariant(card.insight?.riskLevel || "medium")}>
                    Risk: {card.insight?.riskLevel || "unknown"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="flex h-full w-full">
                    <div className="bg-blue-500" style={{ width: inProgressWidth }} />
                    <div className="bg-amber-500" style={{ width: pendingWidth }} />
                    <div className="bg-emerald-500" style={{ width: completedWidth }} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  In progress: {card.workload.inProgress} · Pending: {card.workload.pending} · Completed: {card.workload.completed}
                </p>
                <p className="text-sm">{card.insight?.summary || "No AI summary available yet."}</p>
                {card.insight?.highlights?.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {card.insight.highlights.map((item, index) => (
                      <li key={`${card.contactName}-highlight-${index}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>
                    Avg close: {card.averageCloseDays ? `${card.averageCloseDays} days` : "n/a"}
                  </span>
                  <span>·</span>
                  <span>Open workload: {card.workload.open}</span>
                  <span>·</span>
                  <span>Map points: {card.mapPoints.length}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function HousePermitsSection() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [payload, setPayload] = useState<PermitDashboardPayload | null>(null);

  const loadData = useCallback(async (withLoading: boolean) => {
    if (withLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const response = await fetch("/api/admin/permits", { credentials: "include" });
      const result = (await response.json()) as PermitDashboardPayload & { error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to load permits data");
      }
      setPayload(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load permits");
    } finally {
      setLoading(false);
      setRefreshing(false);
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

  if (loading) {
    return (
      <div className="flex min-h-[40svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading permits dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-xl">Permits Intelligence</CardTitle>
              <CardDescription>
                Track SF permit updates for 126 Colby and identify changed records needing review.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void loadData(false)} disabled={refreshing}>
                {refreshing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
                Refresh
              </Button>
              <Button size="sm" onClick={() => void runSync()} disabled={syncing}>
                {syncing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldAlert className="mr-2 size-4" />}
                Run Sync
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Runs</p>
            <p className="mt-1 text-lg font-semibold">{payload?.summary.runCount || 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">House Permits</p>
            <p className="mt-1 text-lg font-semibold">{payload?.summary.propertyPermitCount || 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Needs Review</p>
            <p className="mt-1 text-lg font-semibold text-red-400">{payload?.summary.needsReviewCount || 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Contacts</p>
            <p className="mt-1 text-lg font-semibold">{payload?.summary.contactCount || 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Contact Activity</p>
            <p className="mt-1 text-lg font-semibold">{payload?.summary.contactActivityCount || 0}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">126 Colby Permits</CardTitle>
              <CardDescription>
                Click any permit to open full detail and revision history.
              </CardDescription>
            </div>
            <a href="/admin/permits/contacts">
              <Button variant="outline" size="sm">
                Contractor Intelligence
                <ExternalLink className="ml-2 size-4" />
              </Button>
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {(payload?.propertyPermits || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No house permits are stored yet. Run sync to hydrate.</p>
          ) : (
            (payload?.propertyPermits || []).map((permit) => (
              <a
                key={permit.permitIdentifier}
                href={`/admin/permits/${encodeURIComponent(permit.permitIdentifier)}`}
                className={cn(
                  "block rounded-lg border px-3 py-3 transition",
                  permit.needsReview
                    ? "border-red-500/60 bg-red-500/10 hover:bg-red-500/15"
                    : "border-border/60 bg-card/40 hover:bg-card/60",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{permit.permitIdentifier}</p>
                    {permit.needsReview ? (
                      <Badge variant="destructive">Needs Review</Badge>
                    ) : (
                      <Badge variant="secondary">Reviewed</Badge>
                    )}
                    {permit.isClosed ? <Badge variant="outline">Closed</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Updated {formatDate(permit.lastChangedAt)}
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {permit.permitType || "Type n/a"} · {permit.permitStatus || "Status n/a"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {permit.propertyAddress || "Address n/a"} · Block {permit.block || "n/a"} / Lot {permit.lot || "n/a"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Contacts: {permit.contactNames.join(", ") || "n/a"}
                </p>
              </a>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Latest Sync Runs</CardTitle>
          <CardDescription>Recent ingestion jobs across SF open-data datasets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(payload?.latestRuns || []).slice(0, 20).map((run) => (
            <div key={run.id} className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={run.status === "error" ? "destructive" : "secondary"}>{run.status}</Badge>
                  <Badge variant="outline">{run.sourceDataset}</Badge>
                  <Badge variant="outline">{run.runType}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{formatDate(run.datetimeCreated)}</p>
              </div>
              <p className="mt-1 text-sm font-medium">{run.queryLabel}</p>
              <p className="text-xs text-muted-foreground">
                {run.resultCount} records · {run.aiSummary || "No summary"}
              </p>
              {run.errorText ? (
                <p className="mt-1 text-xs text-red-400">{run.errorText}</p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function PermitDetailApp({ permitIdentifier }: { permitIdentifier: string }) {
  const [loading, setLoading] = useState(true);
  const [markingViewed, setMarkingViewed] = useState(false);
  const [payload, setPayload] = useState<PermitDetailPayload | null>(null);
  const [autoMarked, setAutoMarked] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/permits/property/${encodeURIComponent(permitIdentifier)}`, {
        credentials: "include",
      });
      const result = (await response.json()) as PermitDetailPayload & { error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to load permit detail");
      }
      setPayload(result);
      setAutoMarked(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load permit detail");
    } finally {
      setLoading(false);
    }
  }, [permitIdentifier]);

  const markViewed = useCallback(async () => {
    setMarkingViewed(true);
    try {
      const response = await fetch(
        `/api/admin/permits/property/${encodeURIComponent(permitIdentifier)}/viewed`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to mark permit as viewed");
      }
      toast.success("Permit marked as reviewed");
      await loadDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update review state");
    } finally {
      setMarkingViewed(false);
    }
  }, [loadDetail, permitIdentifier]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const detail = payload?.detail;
    if (!detail || !detail.needsReview || markingViewed || autoMarked) {
      return;
    }
    setAutoMarked(true);
    void markViewed();
  }, [autoMarked, markingViewed, markViewed, payload?.detail]);

  if (loading) {
    return (
      <div className="flex min-h-[40svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading permit detail...
      </div>
    );
  }

  const detail = payload?.detail;
  const latestRecord = detail?.records?.[0] || null;

  if (!detail || !latestRecord) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-8 text-sm text-muted-foreground">
        Permit detail is not available.
      </div>
    );
  }

  const rawData = parseJson(latestRecord.rawData);
  const rawEntries = rawData && typeof rawData === "object" ? Object.entries(rawData as Record<string, unknown>) : [];

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl">{detail.permitIdentifier}</CardTitle>
              <CardDescription>
                Full permit record, addenda/support snapshots, and revision history.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {detail.needsReview ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="size-3" />
                  Needs Review
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="size-3" />
                  Reviewed
                </Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => void markViewed()} disabled={markingViewed}>
                {markingViewed ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Mark Reviewed
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Type</p>
            <p className="mt-1 text-sm font-semibold">{latestRecord.permitType || "n/a"}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
            <p className="mt-1 text-sm font-semibold">{latestRecord.permitStatus || "n/a"}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Address</p>
            <p className="mt-1 text-sm font-semibold">{latestRecord.propertyAddress || "n/a"}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Block/Lot</p>
            <p className="mt-1 text-sm font-semibold">
              {latestRecord.block || "n/a"} / {latestRecord.lot || "n/a"}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Issued</p>
            <p className="mt-1 text-sm font-semibold">{latestRecord.issuedDate || "n/a"}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Closed</p>
            <p className="mt-1 text-sm font-semibold">{latestRecord.closedDate || "open"}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Dataset Records</CardTitle>
          <CardDescription>All records tied to this permit/application identifier.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {detail.records.map((record) => (
            <div key={record.id} className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="outline">{record.dataset}</Badge>
                <p className="text-xs text-muted-foreground">
                  Updated {formatDate(record.datetimeUpdated)}
                </p>
              </div>
              <p className="mt-1 text-sm">
                {record.permitType || "Type n/a"} · {record.permitStatus || "Status n/a"}
              </p>
              <p className="text-xs text-muted-foreground">
                Contact: {record.contactName || "n/a"} ({record.contactRole || "role n/a"})
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Raw Permit Payload (Latest Snapshot)</CardTitle>
          <CardDescription>
            Full field list from SODA for this permit snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rawEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No raw payload available.</p>
          ) : (
            rawEntries.map(([key, value]) => (
              <div key={key} className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                <p className="text-xs font-medium">{key}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="text-base">Revision History</CardTitle>
          <CardDescription>
            Immutable per-run snapshots so field-level change reviews are traceable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {detail.revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revision records are stored yet.</p>
          ) : (
            detail.revisions.slice(0, 40).map((revision) => (
              <div key={revision.id} className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline">{revision.dataset}</Badge>
                  <p className="text-xs text-muted-foreground">{formatDate(revision.datetimeCreated)}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Status: {revision.permitStatus || "n/a"} · Permit: {revision.permitNumber || "n/a"}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PermitsAdminApp({ section = "house" }: { section?: "house" | "contacts" }) {
  if (section === "contacts") {
    return <ContractorInsightsSection />;
  }
  return <HousePermitsSection />;
}
