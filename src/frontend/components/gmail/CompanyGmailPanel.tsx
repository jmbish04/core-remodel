/**
 * @fileoverview Company-scoped Gmail panel, embedded in the company detail
 * viewport (a tab). Fetches `GET /api/gmail/companies/:companyId/threads-by-domain`,
 * shows the matched PRIVATE `domains` as small chips ("matching @company.com"),
 * and renders the SAME `GmailThreadList` + `GmailThreadView` two-pane layout,
 * scoped to this company (no global search).
 *
 * The list here is passed threads directly (search prop omitted). Empty state
 * covers both "no matched domains" and "no threads". Mobile stacks to a single
 * column with a back button, mirroring the global inbox.
 */

import { useEffect, useState } from "react";
import { Building2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GmailThreadList } from "./GmailThreadList";
import { GmailThreadView } from "./GmailThreadView";
import { gmailApi, type GmailInboxThreadItem } from "./types";

interface CompanyGmailPanelProps {
  companyId: number;
  companyName: string;
}

export function CompanyGmailPanel({ companyId, companyName }: CompanyGmailPanelProps) {
  const [domains, setDomains] = useState<string[]>([]);
  const [threads, setThreads] = useState<GmailInboxThreadItem[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    gmailApi
      .listCompanyThreadsByDomain(companyId, controller.signal)
      .then((data) => {
        if (!active) return;
        setDomains(data.domains);
        setThreads(data.threads);
        // Reset selection if it no longer exists in the fresh list.
        setSelectedThreadId((prev) =>
          prev && data.threads.some((t) => t.threadId === prev) ? prev : null,
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || !active) return;
        const message =
          err instanceof Error ? err.message : "Failed to load company mail";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [companyId, reloadKey]);

  const selected = threads.find((t) => t.threadId === selectedThreadId) ?? null;

  return (
    <div className="space-y-4">
      {/* Domain chips */}
      <div className="flex flex-wrap items-center gap-2">
        {domains.length > 0 ? (
          <>
            <span className="text-xs text-muted-foreground">Matching</span>
            {domains.map((d) => (
              <Badge key={d} variant="secondary" className="gap-1 text-[11px]">
                <Building2 className="size-3" />@{d}
              </Badge>
            ))}
          </>
        ) : (
          !loading &&
          !error && (
            <span className="text-xs text-muted-foreground">
              No private email domains derived for this company yet — showing any
              threads tagged to it.
            </span>
          )
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label="Refresh company mail"
          disabled={loading}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-card px-8 py-16 text-center ring-1 ring-border/40">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw className="mr-2 size-4" />
            Retry
          </Button>
        </div>
      ) : !loading && threads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-card px-8 py-16 text-center ring-1 ring-border/40">
          <div className="rounded-full bg-muted/60 p-3">
            <Mail className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No conversations yet</p>
          <p className="text-xs text-muted-foreground">
            Emails to or from {companyName}
            {domains.length > 0 ? "’s domains" : ""} will appear here once ingested.
          </p>
        </div>
      ) : (
        <div className="flex h-[560px] overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
          {/* Left: list. Hidden on mobile once a thread is selected. */}
          <div
            className={`flex min-h-0 w-full flex-col md:w-[320px] md:shrink-0 md:border-r md:border-border/40 ${
              selectedThreadId ? "hidden md:flex" : "flex"
            }`}
          >
            <GmailThreadList
              threads={threads}
              selectedThreadId={selectedThreadId}
              onSelect={setSelectedThreadId}
              loading={loading}
              emptyLabel="No conversations for this company."
            />
          </div>

          {/* Right: reading pane. Hidden on mobile until a thread is selected. */}
          <div
            className={`min-h-0 flex-1 ${
              selectedThreadId ? "flex" : "hidden md:flex"
            }`}
          >
            <div className="min-h-0 w-full">
              <GmailThreadView
                threadId={selectedThreadId}
                companyName={selected?.companyName ?? companyName}
                onBack={() => setSelectedThreadId(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
