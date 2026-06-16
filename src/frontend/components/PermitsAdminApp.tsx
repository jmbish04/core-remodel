import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ContractorActivityMap } from "@/components/ContractorActivityMap";

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
    return <ContractorActivityMap />;
  }
  return <HousePermitsSection />;
}
