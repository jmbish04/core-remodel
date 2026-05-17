import { Clock3, FilePenLine, Loader2, PlusCircle, RefreshCw } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface EstimateCompany {
  id: number;
  name: string;
  businessType: string;
}

interface EstimateRevision {
  id: number;
  estimateId: number;
  revisionNumber: number;
  isDraft: boolean;
  isLatest: boolean;
  estimateStatusId: number | null;
  totalAmountCents: number | null;
  datetimeUpdated: string | null;
}

interface EstimateRecord {
  id: number;
  scenarioId: string | null;
  estimateCompanyId: number | null;
  company: EstimateCompany | null;
  currentRevision: EstimateRevision | null;
  datetimeUpdated: string | null;
}

interface RevisionDetail {
  revision: EstimateRevision & {
    statusNotes?: string | null;
    aiRationale?: string | null;
    warrantyDetails?: string | null;
    cancellationDetails?: string | null;
  };
  lineItems: Array<{
    id: number;
    description: string;
    lineTotalCents: number | null;
    unitCostCents: number | null;
    qty: number | null;
    uom: string | null;
  }>;
  documents: Array<{
    id: number;
    sourceType: string;
    r2Url: string | null;
    sourceUrl: string | null;
    datetimeCreated: string | null;
  }>;
  roomMappings: Array<{ roomId: number }>;
}

interface EstimatesPayload {
  estimates: EstimateRecord[];
  drafts: EstimateRevision[];
  recentlyUpdated: EstimateRevision[];
}

function formatCurrency(cents?: number | null): string {
  if (typeof cents !== "number") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function EstimatesApp() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payload, setPayload] = useState<EstimatesPayload | null>(null);
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [activeEstimateId, setActiveEstimateId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<EstimateRevision[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [revisionDetail, setRevisionDetail] = useState<RevisionDetail | null>(null);
  const [loadingRevisionDetail, setLoadingRevisionDetail] = useState(false);
  const [flashedEstimateIds, setFlashedEstimateIds] = useState<number[]>([]);

  const loadEstimates = useCallback(async () => {
    const response = await fetch("/api/estimates");
    const data = (await response.json()) as EstimatesPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Failed to load estimates");
    }
    setPayload(data);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await loadEstimates();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load estimates");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [loadEstimates]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadEstimates();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh estimates");
    } finally {
      setRefreshing(false);
    }
  }, [loadEstimates]);

  const openRevisions = useCallback(async (estimateId: number) => {
    try {
      setActiveEstimateId(estimateId);
      setRevisionModalOpen(true);
      const response = await fetch(`/api/estimates/${estimateId}/revisions`);
      const data = (await response.json()) as { revisions: EstimateRevision[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to load revisions");
      }
      setRevisions(data.revisions || []);
      const firstRevision = data.revisions[0];
      setSelectedRevisionId(firstRevision?.id || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open revisions");
    }
  }, []);

  useEffect(() => {
    if (!activeEstimateId || !selectedRevisionId) {
      setRevisionDetail(null);
      return;
    }
    const loadDetail = async () => {
      setLoadingRevisionDetail(true);
      try {
        const response = await fetch(`/api/estimates/${activeEstimateId}/revisions/${selectedRevisionId}`);
        const data = (await response.json()) as RevisionDetail & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Failed to load revision detail");
        }
        setRevisionDetail(data);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load revision detail");
      } finally {
        setLoadingRevisionDetail(false);
      }
    };
    loadDetail();
  }, [activeEstimateId, selectedRevisionId]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/realtime/estimates?room=home`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data || "{}")) as {
          payload?: { event?: string; estimateId?: number };
        };
        if (data.payload?.event) {
          if (typeof data.payload.estimateId === "number") {
            setFlashedEstimateIds((current) =>
              Array.from(new Set([...current, data.payload!.estimateId as number])),
            );
            window.setTimeout(() => {
              setFlashedEstimateIds((current) =>
                current.filter((value) => value !== data.payload!.estimateId),
              );
            }, 2200);
          }
          void loadEstimates();
        }
      } catch {
        // noop
      }
    };
    ws.onerror = () => {
      // noop
    };
    return () => {
      ws.close();
    };
  }, [loadEstimates]);

  const estimates = useMemo(() => payload?.estimates || [], [payload?.estimates]);
  const drafts = useMemo(() => payload?.drafts || [], [payload?.drafts]);
  const recentlyUpdated = useMemo(() => payload?.recentlyUpdated || [], [payload?.recentlyUpdated]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-14 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading estimates...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-2xl">Estimates Workspace</CardTitle>
            <CardDescription>
              Track incoming estimates, draft intakes, revisions, and extracted source intelligence.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              {refreshing ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Refreshing
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 size-4" />
                  Refresh
                </>
              )}
            </Button>
            <a href="/estimates/new">
              <Button size="sm">
                <PlusCircle className="mr-2 size-4" />
                Record New Estimate
              </Button>
            </a>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="ring-1 ring-border/40 lg:col-span-2">
          <CardHeader>
            <CardTitle>Latest Estimates</CardTitle>
            <CardDescription>Primary list with current revision head and totals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {estimates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No estimates recorded yet.</p>
            ) : (
              estimates.map((estimate) => (
                <div
                  key={estimate.id}
                  className={`rounded-lg p-3 ring-1 ${
                    flashedEstimateIds.includes(estimate.id)
                      ? "bg-amber-400/20 ring-amber-300/60 transition-colors duration-500"
                      : "bg-muted/20 ring-border/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {estimate.company?.name || "Unassigned company"} · Estimate #{estimate.id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Revision {estimate.currentRevision?.revisionNumber || "—"} ·
                        {" "}
                        {estimate.currentRevision?.isDraft ? "Draft" : "Submitted"} · Updated{" "}
                        {formatDate(estimate.currentRevision?.datetimeUpdated || estimate.datetimeUpdated)}
                      </p>
                    </div>
                    <p className="text-sm font-medium">
                      {formatCurrency(estimate.currentRevision?.totalAmountCents)}
                    </p>
                  </div>
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openRevisions(estimate.id)}
                    >
                      <FilePenLine className="mr-2 size-4" />
                      View Revisions
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Draft Intakes</CardTitle>
              <CardDescription>Autosaved drafts pending submission.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {drafts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active drafts.</p>
              ) : (
                drafts.slice(0, 12).map((draft) => (
                  <div key={draft.id} className="rounded-md bg-amber-500/10 p-2 ring-1 ring-amber-500/30">
                    <p className="text-xs font-medium">Estimate #{draft.estimateId}</p>
                    <p className="text-xs text-muted-foreground">
                      Rev {draft.revisionNumber} · {formatDate(draft.datetimeUpdated)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Recently Updated</CardTitle>
              <CardDescription>Latest estimate revision activity stream.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentlyUpdated.length === 0 ? (
                <p className="text-xs text-muted-foreground">No recent updates yet.</p>
              ) : (
                recentlyUpdated.slice(0, 12).map((row) => (
                  <div key={row.id} className="rounded-md bg-muted/20 p-2 ring-1 ring-border/30">
                    <p className="text-xs font-medium">Estimate #{row.estimateId} · Rev {row.revisionNumber}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(row.datetimeUpdated)}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={revisionModalOpen} onOpenChange={setRevisionModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Estimate Revisions</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-2 rounded-md border border-border/50 bg-card/50 p-2">
              {revisions.map((revision) => (
                <button
                  key={revision.id}
                  type="button"
                  onClick={() => setSelectedRevisionId(revision.id)}
                  className={`w-full rounded-md px-2 py-2 text-left text-xs ${
                    selectedRevisionId === revision.id
                      ? "bg-primary/20 ring-1 ring-primary/40"
                      : "bg-muted/20 hover:bg-muted/30"
                  }`}
                >
                  <p className="font-medium">Rev {revision.revisionNumber}</p>
                  <p className="text-muted-foreground">
                    {revision.isDraft ? "Draft" : "Submitted"}
                  </p>
                </button>
              ))}
            </div>
            <div className="rounded-md border border-border/50 bg-card/50 p-3">
              {loadingRevisionDetail ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading revision details...
                </div>
              ) : revisionDetail ? (
                <div className="space-y-4 text-sm">
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="font-medium">{formatCurrency(revisionDetail.revision.totalAmountCents)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Tax</p>
                      <p className="font-medium">{formatCurrency(revisionDetail.revision.totalTaxCents)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Status notes</p>
                    <p>{revisionDetail.revision.statusNotes || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">AI rationale</p>
                    <p>{revisionDetail.revision.aiRationale || "—"}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Line items</p>
                    <div className="mt-1 space-y-2">
                      {revisionDetail.lineItems.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No line items.</p>
                      ) : (
                        revisionDetail.lineItems.map((lineItem) => (
                          <div key={lineItem.id} className="rounded border border-border/40 bg-muted/20 p-2">
                            <p className="font-medium">{lineItem.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {lineItem.qty || "—"} {lineItem.uom || ""} · {formatCurrency(lineItem.lineTotalCents)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Source Documents</p>
                    <div className="mt-1 space-y-2">
                      {revisionDetail.documents.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No documents.</p>
                      ) : (
                        revisionDetail.documents.map((document) => (
                          <div key={document.id} className="rounded border border-border/40 bg-muted/20 p-2">
                            <p className="text-xs font-medium">{document.sourceType}</p>
                            {document.r2Url ? (
                              <a href={document.r2Url} className="text-xs text-primary underline">
                                Open artifact
                              </a>
                            ) : document.sourceUrl ? (
                              <a href={document.sourceUrl} className="text-xs text-primary underline" target="_blank" rel="noreferrer">
                                Open source URL
                              </a>
                            ) : (
                              <p className="text-xs text-muted-foreground">No linked file.</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="size-4" />
                  Select a revision to inspect details.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
