/**
 * @fileoverview Showroom-scoped Gmail panel (0040 P4). Fetches
 * `GET /api/gmail/showrooms/:storeId/threads-by-domain`, shows the matched
 * domains/addresses as chips, and renders the same GmailThreadList +
 * GmailThreadView two-pane layout as the company panel — plus per-message unread:
 * opening a thread marks it read and decrements the hero badge via onUnreadChange.
 */
import { useEffect, useState } from "react";
import { Mail, RefreshCw, Store } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GmailThreadList } from "./GmailThreadList";
import { GmailThreadView } from "./GmailThreadView";
import { gmailApi, type GmailInboxThreadItemWithUnread } from "./types";

export function ShowroomGmailPanel({
  storeId,
  storeName,
  onUnreadChange,
}: {
  storeId: number;
  storeName: string;
  /** Fired with the latest total unread count so the hero badge stays in sync. */
  onUnreadChange?: (unread: number) => void;
}) {
  const [domains, setDomains] = useState<string[]>([]);
  const [emails, setEmails] = useState<string[]>([]);
  const [threads, setThreads] = useState<GmailInboxThreadItemWithUnread[]>([]);
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
      .listShowroomThreadsByDomain(storeId, controller.signal)
      .then((data) => {
        if (!active) return;
        setDomains(data.domains);
        setEmails(data.emails);
        setThreads(data.threads);
        onUnreadChange?.(data.unreadCount);
        setSelectedThreadId((prev) =>
          prev && data.threads.some((t) => t.threadId === prev) ? prev : null,
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || !active) return;
        const message = err instanceof Error ? err.message : "Failed to load showroom mail";
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
  }, [storeId, reloadKey, onUnreadChange]);

  const selectThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    const t = threads.find((x) => x.threadId === threadId);
    if (t && t.unread > 0) {
      // Optimistically clear this thread's unread + decrement the badge.
      setThreads((prev) => prev.map((x) => (x.threadId === threadId ? { ...x, unread: 0 } : x)));
      setThreads((prev) => {
        onUnreadChange?.(prev.reduce((n, x) => n + x.unread, 0));
        return prev;
      });
      void gmailApi.markThreadRead(threadId).catch(() => {
        /* non-fatal; the next reload reconciles */
      });
    }
  };

  const selected = threads.find((t) => t.threadId === selectedThreadId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {domains.length > 0 || emails.length > 0 ? (
          <>
            <span className="text-xs text-muted-foreground">Matching</span>
            {domains.map((d) => (
              <Badge key={`d-${d}`} variant="secondary" className="gap-1 text-[11px]">
                <Store className="size-3" />@{d}
              </Badge>
            ))}
            {emails.map((e) => (
              <Badge key={`e-${e}`} variant="secondary" className="gap-1 text-[11px]">
                <Mail className="size-3" />
                {e}
              </Badge>
            ))}
          </>
        ) : (
          !loading &&
          !error && (
            <span className="text-xs text-muted-foreground">
              No contact emails on this showroom yet — add a store or POC email to match mail.
            </span>
          )
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label="Refresh showroom mail"
          disabled={loading}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-card px-8 py-16 text-center ring-1 ring-border/40">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="mr-2 size-4" /> Retry
          </Button>
        </div>
      ) : !loading && threads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-card px-8 py-16 text-center ring-1 ring-border/40">
          <div className="rounded-full bg-muted/60 p-3">
            <Mail className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No conversations yet</p>
          <p className="text-xs text-muted-foreground">
            Emails to or from {storeName}
            {domains.length > 0 ? "’s domain" : ""} will appear here once ingested.
          </p>
        </div>
      ) : (
        <div className="flex h-[560px] overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
          <div
            className={`flex min-h-0 w-full flex-col md:w-[320px] md:shrink-0 md:border-r md:border-border/40 ${
              selectedThreadId ? "hidden md:flex" : "flex"
            }`}
          >
            <GmailThreadList
              threads={threads}
              selectedThreadId={selectedThreadId}
              onSelect={selectThread}
              loading={loading}
              emptyLabel="No conversations for this showroom."
            />
          </div>
          <div className={`min-h-0 flex-1 ${selectedThreadId ? "flex" : "hidden md:flex"}`}>
            <div className="min-h-0 w-full">
              <GmailThreadView
                threadId={selectedThreadId}
                companyName={selected?.companyName ?? storeName}
                onBack={() => setSelectedThreadId(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
