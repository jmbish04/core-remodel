import { AlertTriangle, Loader2, PlusCircle, RefreshCw, ShieldCheck } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface ContractRecord {
  id: number;
  scenarioId: string | null;
  contractRequired: boolean;
  company: { id: number; name: string; businessType: string } | null;
  currentRevision: {
    id: number;
    revisionNumber: number;
    isDraft: boolean;
    contractStatusId: number | null;
    statusNotes: string | null;
    datetimeUpdated: string | null;
  } | null;
}

interface ContractsPayload {
  contracts: ContractRecord[];
  drafts: Array<{
    id: number;
    contractId: number;
    revisionNumber: number;
    datetimeUpdated: string | null;
  }>;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function ContractsApp() {
  const [payload, setPayload] = useState<ContractsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [analysisLoadingByContractId, setAnalysisLoadingByContractId] = useState<
    Record<number, boolean>
  >({});
  const [ingestDialogOpen, setIngestDialogOpen] = useState(false);
  const [activeContract, setActiveContract] = useState<ContractRecord | null>(null);
  const [ingestSourceType, setIngestSourceType] = useState<"pdf" | "photo" | "url" | "free_text">(
    "pdf",
  );
  const [ingestSourceUrl, setIngestSourceUrl] = useState("");
  const [ingestSourceText, setIngestSourceText] = useState("");
  const [ingestFile, setIngestFile] = useState<File | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const loadContracts = useCallback(async () => {
    const response = await fetch("/api/contracts");
    const data = (await response.json()) as ContractsPayload & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Failed to load contracts");
    }
    setPayload(data);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await loadContracts();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load contracts");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [loadContracts]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadContracts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh contracts");
    } finally {
      setRefreshing(false);
    }
  }, [loadContracts]);

  const createDraft = useCallback(async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/contracts/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractRequired: true,
          createdBy: "homeowner",
        }),
      });
      const data = (await response.json()) as { contract?: ContractRecord; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to create contract draft");
      }
      toast.success("Contract draft created");
      await loadContracts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create contract draft");
    } finally {
      setCreating(false);
    }
  }, [loadContracts]);

  const runRiskAnalysis = useCallback(async (contract: ContractRecord) => {
    const revisionId = contract.currentRevision?.id;
    if (!revisionId) {
      toast.error("No revision found to analyze");
      return;
    }
    setAnalysisLoadingByContractId((current) => ({ ...current, [contract.id]: true }));
    try {
      const response = await fetch(
        `/api/contracts/${contract.id}/revisions/${revisionId}/analyze`,
        {
          method: "POST",
        },
      );
      const data = (await response.json()) as { findingsCount?: number; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to run contract analysis");
      }
      toast.success(`Contract analysis complete (${data.findingsCount || 0} findings)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run contract analysis");
    } finally {
      setAnalysisLoadingByContractId((current) => ({ ...current, [contract.id]: false }));
    }
  }, []);

  const openIngestDialog = useCallback((contract: ContractRecord) => {
    setActiveContract(contract);
    setIngestSourceType("pdf");
    setIngestSourceUrl("");
    setIngestSourceText("");
    setIngestFile(null);
    setIngestDialogOpen(true);
  }, []);

  const submitIngest = useCallback(async () => {
    if (!activeContract || !activeContract.currentRevision?.id) {
      toast.error("No active contract revision selected");
      return;
    }
    if ((ingestSourceType === "pdf" || ingestSourceType === "photo") && !ingestFile) {
      toast.error("Upload a contract source file");
      return;
    }
    if (ingestSourceType === "url" && !ingestSourceUrl.trim()) {
      toast.error("Enter a source URL");
      return;
    }
    if (ingestSourceType === "free_text" && !ingestSourceText.trim()) {
      toast.error("Enter source text");
      return;
    }

    setIngesting(true);
    try {
      let response: Response;
      if ((ingestSourceType === "pdf" || ingestSourceType === "photo") && ingestFile) {
        const form = new FormData();
        form.append("sourceType", ingestSourceType);
        form.append("file", ingestFile);
        response = await fetch(
          `/api/contracts/${activeContract.id}/revisions/${activeContract.currentRevision.id}/documents`,
          {
            method: "POST",
            body: form,
          },
        );
      } else {
        response = await fetch(
          `/api/contracts/${activeContract.id}/revisions/${activeContract.currentRevision.id}/documents`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceType: ingestSourceType,
              sourceUrl: ingestSourceType === "url" ? ingestSourceUrl.trim() : null,
              freeText: ingestSourceType === "free_text" ? ingestSourceText.trim() : null,
            }),
          },
        );
      }
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to ingest contract source");
      }
      toast.success("Contract source ingested and extracted");
      setIngestDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to ingest contract source");
    } finally {
      setIngesting(false);
    }
  }, [activeContract, ingestFile, ingestSourceText, ingestSourceType, ingestSourceUrl]);

  const contracts = useMemo(() => payload?.contracts || [], [payload?.contracts]);
  const drafts = useMemo(() => payload?.drafts || [], [payload?.drafts]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-14 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading contracts...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="ring-1 ring-border/40">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-2xl">Contracts Workspace</CardTitle>
            <CardDescription>
              Track contractor/subcontractor contracts, revisions, risk findings, and payment
              controls.
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
            <Button size="sm" onClick={createDraft} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating
                </>
              ) : (
                <>
                  <PlusCircle className="mr-2 size-4" />
                  New Contract Draft
                </>
              )}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="ring-1 ring-border/40 lg:col-span-2">
          <CardHeader>
            <CardTitle>Contracts</CardTitle>
            <CardDescription>Current revision head per contract.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contracts recorded yet.</p>
            ) : (
              contracts.map((contract) => (
                <div key={contract.id} className="rounded-lg bg-muted/20 p-3 ring-1 ring-border/30">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        Contract #{contract.id} · {contract.company?.name || "Unassigned company"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Revision {contract.currentRevision?.revisionNumber || "—"} ·{" "}
                        {contract.currentRevision?.isDraft ? "Draft" : "Submitted"} · Updated{" "}
                        {formatDate(contract.currentRevision?.datetimeUpdated)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {contract.contractRequired ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-1 text-xs text-emerald-200">
                          <ShieldCheck className="size-3" />
                          Strict
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-200">
                          <AlertTriangle className="size-3" />
                          Advisory
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openIngestDialog(contract)}
                      >
                        Ingest Contract Source
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runRiskAnalysis(contract)}
                        disabled={analysisLoadingByContractId[contract.id]}
                      >
                        {analysisLoadingByContractId[contract.id] ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Analyzing
                          </>
                        ) : (
                          "Run Risk Analysis"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="ring-1 ring-border/40">
          <CardHeader>
            <CardTitle className="text-base">Draft Revisions</CardTitle>
            <CardDescription>Contracts still pending final submission.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {drafts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No draft revisions.</p>
            ) : (
              drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="rounded-md bg-amber-500/10 p-2 ring-1 ring-amber-500/30"
                >
                  <p className="text-xs font-medium">
                    Contract #{draft.contractId} · Rev {draft.revisionNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(draft.datetimeUpdated)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={ingestDialogOpen} onOpenChange={setIngestDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ingest Contract Source</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              <label className="rounded-md border border-border/40 bg-muted/20 p-2 text-xs">
                <input
                  type="radio"
                  name="contractSourceType"
                  checked={ingestSourceType === "pdf"}
                  onChange={() => setIngestSourceType("pdf")}
                  className="mr-2"
                />
                Contract PDF
              </label>
              <label className="rounded-md border border-border/40 bg-muted/20 p-2 text-xs">
                <input
                  type="radio"
                  name="contractSourceType"
                  checked={ingestSourceType === "photo"}
                  onChange={() => setIngestSourceType("photo")}
                  className="mr-2"
                />
                Contract Photo
              </label>
              <label className="rounded-md border border-border/40 bg-muted/20 p-2 text-xs">
                <input
                  type="radio"
                  name="contractSourceType"
                  checked={ingestSourceType === "url"}
                  onChange={() => setIngestSourceType("url")}
                  className="mr-2"
                />
                Contract URL
              </label>
              <label className="rounded-md border border-border/40 bg-muted/20 p-2 text-xs">
                <input
                  type="radio"
                  name="contractSourceType"
                  checked={ingestSourceType === "free_text"}
                  onChange={() => setIngestSourceType("free_text")}
                  className="mr-2"
                />
                Free text / notes
              </label>
            </div>

            {(ingestSourceType === "pdf" || ingestSourceType === "photo") && (
              <Input
                type="file"
                accept={ingestSourceType === "pdf" ? "application/pdf" : "image/*,application/pdf"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setIngestFile(file || null);
                }}
              />
            )}
            {ingestSourceType === "url" && (
              <Input
                placeholder="https://contract-source.example.com"
                value={ingestSourceUrl}
                onChange={(event) => setIngestSourceUrl(event.target.value)}
              />
            )}
            {ingestSourceType === "free_text" && (
              <Textarea
                rows={7}
                placeholder="Paste contract terms or notes for extraction..."
                value={ingestSourceText}
                onChange={(event) => setIngestSourceText(event.target.value)}
              />
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIngestDialogOpen(false)}
                disabled={ingesting}
              >
                Cancel
              </Button>
              <Button onClick={submitIngest} disabled={ingesting}>
                {ingesting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Ingesting
                  </>
                ) : (
                  "Ingest and Extract"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
