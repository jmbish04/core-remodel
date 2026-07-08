import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";
import { ContractReviewPanel } from "./ContractReviewPanel";

// ── Types ────────────────────────────────────────────────────────────────

interface ReviewerFlag {
  level: "info" | "warning" | "critical";
  category: string;
  message: string;
}

interface EmailDetail {
  email: any;
  attachments: any[];
  invoices: any[];
  contracts: any[];
  stagedCompany: any | null;
  matchedCompany: any | null;
  reviewerFlags: ReviewerFlag[];
}

// ── Component ────────────────────────────────────────────────────────────

export function InboxApp() {
  const [emails, setEmails] = useState<any[]>([]);
  const [selected, setSelected] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEmails();
  }, []);

  async function fetchEmails() {
    setLoading(true);
    try {
      const res = await fetch("/api/worker-emails");
      if (res.ok) {
        const data = (await res.json()) as any;
        setEmails(data.emails || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchEmailDetail(id: number) {
    try {
      const res = await fetch(`/api/worker-emails/${id}`);
      if (res.ok) {
        const data = (await res.json()) as EmailDetail;
        setSelected(data);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function updateStatus(id: number, status: string) {
    try {
      await fetch(`/api/worker-emails/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      fetchEmails();
      if (selected?.email.id === id) fetchEmailDetail(id);
    } catch (e) {
      console.error(e);
    }
  }

  async function confirmStagedCompany(emailId: number) {
    try {
      await fetch(`/api/worker-emails/${emailId}/staged-company/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      fetchEmailDetail(emailId);
    } catch (e) {
      console.error(e);
    }
  }

  async function rejectStagedCompany(emailId: number) {
    try {
      await fetch(`/api/worker-emails/${emailId}/staged-company/reject`, {
        method: "POST",
      });
      fetchEmailDetail(emailId);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      {/* ── Email List ──────────────────────────────────────────── */}
      <Card className="col-span-1 flex flex-col h-full">
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>Emails to remodel@hacolby.app</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col">
              {emails.map((e) => (
                <div
                  key={e.id}
                  onClick={() => fetchEmailDetail(e.id)}
                  className={`p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors ${
                    selected?.email.id === e.id ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="font-semibold text-sm truncate pr-2">
                      {e.originalFromName || e.originalFromAddress || e.fromAddress}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm truncate mb-2">{e.subject}</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {e.isForwarded && (
                      <Badge variant="outline" className="text-xs">
                        Fwd
                      </Badge>
                    )}
                    <Badge
                      variant={
                        e.classification === "invoice"
                          ? "default"
                          : e.classification === "contract" || e.classification === "change_order"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {e.classification || "pending"}
                    </Badge>
                    <Badge variant="outline">{e.status}</Badge>
                  </div>
                </div>
              ))}
              {emails.length === 0 && !loading && (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No emails found.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ── Detail Panel ────────────────────────────────────────── */}
      <div className="col-span-1 md:col-span-2 h-full overflow-hidden flex flex-col">
        {selected ? (
          <ScrollArea className="h-full w-full">
            {/* Reviewer Flags Banner */}
            {selected.reviewerFlags.length > 0 && (
              <div className="space-y-2 mb-4">
                {selected.reviewerFlags.map((flag, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg text-sm flex items-start gap-2 ${
                      flag.level === "critical"
                        ? "bg-red-500/10 border border-red-500/30 text-red-200"
                        : flag.level === "warning"
                          ? "bg-yellow-500/10 border border-yellow-500/30 text-yellow-200"
                          : "bg-blue-500/10 border border-blue-500/30 text-blue-200"
                    }`}
                  >
                    <span className="mt-0.5">
                      {flag.level === "critical"
                        ? "🔴"
                        : flag.level === "warning"
                          ? "🟡"
                          : "🟢"}
                    </span>
                    <div>
                      <span className="font-medium capitalize">{flag.category.replace(/_/g, " ")}</span>
                      <span className="mx-1">—</span>
                      {flag.message}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Email Header */}
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-xl mb-1 flex items-center gap-2">
                      {selected.email.subject}
                      {selected.email.isForwarded && (
                        <Badge variant="outline">Forwarded</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {selected.email.isForwarded && selected.email.originalFromAddress ? (
                        <>
                          <span className="font-medium">Original sender:</span>{" "}
                          {selected.email.originalFromName && (
                            <span>{selected.email.originalFromName} </span>
                          )}
                          &lt;{selected.email.originalFromAddress}&gt;
                          {selected.email.originalDate && (
                            <span className="ml-2 text-xs">({selected.email.originalDate})</span>
                          )}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            Forwarded by: {selected.email.fromAddress}
                          </span>
                        </>
                      ) : (
                        <>From: {selected.email.fromAddress}</>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {selected.email.status !== "reviewed" &&
                      selected.email.status !== "rejected" && (
                        <>
                          <button
                            onClick={() => updateStatus(selected.email.id, "rejected")}
                            className="px-3 py-1 bg-destructive/10 text-destructive hover:bg-destructive/20 text-sm font-medium rounded-md transition-colors"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => updateStatus(selected.email.id, "reviewed")}
                            className="px-3 py-1 bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium rounded-md transition-colors"
                          >
                            Mark Reviewed
                          </button>
                        </>
                      )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Company Match / Staged Company */}
                {selected.matchedCompany && (
                  <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-3">
                    <span className="text-lg">🏢</span>
                    <div>
                      <div className="font-medium text-sm">{selected.matchedCompany.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Matched via {selected.email.companyMatchMethod} (
                        {((selected.email.companyMatchConfidence || 0) * 100).toFixed(0)}% confidence)
                      </div>
                    </div>
                  </div>
                )}

                {selected.stagedCompany && selected.stagedCompany.status === "staged" && (
                  <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">🏗️</span>
                      <span className="font-medium text-sm">New Company Detected</span>
                      <Badge variant="outline">Needs Review</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                      <div>
                        <span className="text-muted-foreground">Name:</span>{" "}
                        {selected.stagedCompany.suggestedName}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Email:</span>{" "}
                        {selected.stagedCompany.suggestedEmail}
                      </div>
                      {selected.stagedCompany.suggestedBusinessType && (
                        <div>
                          <span className="text-muted-foreground">Type:</span>{" "}
                          {selected.stagedCompany.suggestedBusinessType}
                        </div>
                      )}
                      {selected.stagedCompany.suggestedPhone && (
                        <div>
                          <span className="text-muted-foreground">Phone:</span>{" "}
                          {selected.stagedCompany.suggestedPhone}
                        </div>
                      )}
                      {selected.stagedCompany.suggestedLicenseNumber && (
                        <div>
                          <span className="text-muted-foreground">License:</span>{" "}
                          {selected.stagedCompany.suggestedLicenseNumber}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => confirmStagedCompany(selected.email.id)}
                        className="px-3 py-1 bg-green-600 text-white hover:bg-green-700 text-sm font-medium rounded-md transition-colors"
                      >
                        Add to Directory
                      </button>
                      <button
                        onClick={() => rejectStagedCompany(selected.email.id)}
                        className="px-3 py-1 border text-destructive border-destructive/30 bg-destructive/5 hover:bg-destructive/10 text-sm font-medium rounded-md transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Email Body */}
                <div className="bg-muted p-4 rounded-md mb-4 whitespace-pre-wrap text-sm font-mono max-h-[300px] overflow-y-auto">
                  {selected.email.bodyText || "No text content"}
                </div>

                {/* Attachments */}
                {selected.attachments?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">
                      Attachments ({selected.attachments.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {selected.attachments.map((a: any) => (
                        <a
                          key={a.id}
                          href={`/api/worker-emails/${selected.email.id}/attachments/${a.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center p-2.5 border rounded-md hover:bg-muted transition-colors text-sm"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mr-2 text-muted-foreground"
                          >
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span className="truncate max-w-[200px]">{a.filename}</span>
                          <span className="ml-2 text-muted-foreground text-xs">
                            {(a.sizeBytes / 1024).toFixed(1)} KB
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Invoices */}
            {selected.invoices?.length > 0 && (
              <div className="space-y-4 mb-4">
                <h3 className="text-lg font-semibold px-1">Extracted Invoices</h3>
                {selected.invoices.map((inv: any) => (
                  <InvoiceReviewPanel
                    key={inv.id}
                    emailId={selected.email.id}
                    invoice={inv}
                    onUpdate={() => fetchEmailDetail(selected.email.id)}
                  />
                ))}
              </div>
            )}

            {/* Contracts */}
            {selected.contracts?.length > 0 && (
              <div className="space-y-4 mb-4">
                <h3 className="text-lg font-semibold px-1">Extracted Contracts</h3>
                {selected.contracts.map((contract: any) => (
                  <ContractReviewPanel
                    key={contract.id}
                    emailId={selected.email.id}
                    contract={contract}
                    onUpdate={() => fetchEmailDetail(selected.email.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select an email to view details
          </div>
        )}
      </div>
    </div>
  );
}
