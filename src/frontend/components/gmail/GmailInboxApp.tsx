/**
 * @fileoverview Global Gmail inbox island. Fetches `GET /api/gmail/threads`
 * (paginated via limit/offset, with a "Load more" button), renders the
 * `GmailThreadList` (with search) + `GmailThreadView` two-pane layout.
 *
 * Search is debounced inside `GmailThreadList`; here we own the race-guard: an
 * `active` flag + a monotonically increasing request token so only the newest
 * in-flight request may commit its results. A new search resets pagination
 * (offset back to 0) and replaces the list; "Load more" appends.
 *
 * Mobile: below `md` the layout is single-column — the list is shown until a
 * thread is picked, then the reading pane takes over with a back button. On
 * `md+` both panes are visible side-by-side.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GmailThreadList } from "./GmailThreadList";
import { GmailThreadView } from "./GmailThreadView";
import { gmailApi, type GmailInboxThreadItem } from "./types";

const PAGE_SIZE = 50;

export function GmailInboxApp() {
  const [threads, setThreads] = useState<GmailInboxThreadItem[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(true); // initial / search load
  const [loadingMore, setLoadingMore] = useState(false);

  // Monotonic request token: only the newest request may commit. Guards the
  // search + initial-load path against out-of-order responses.
  const reqTokenRef = useRef(0);

  const fetchPage = useCallback(
    async (opts: { q: string; offset: number; append: boolean }) => {
      const token = ++reqTokenRef.current;
      const controller = new AbortController();

      if (opts.append) setLoadingMore(true);
      else setLoading(true);

      try {
        const data = await gmailApi.listInbox(
          { q: opts.q || undefined, limit: PAGE_SIZE, offset: opts.offset },
          controller.signal,
        );
        // Stale-response guard: a newer request has superseded this one.
        if (token !== reqTokenRef.current) return;

        setThreads((prev) => (opts.append ? [...prev, ...data.threads] : data.threads));
        setOffset(opts.offset + data.threads.length);
        setHasMore(data.threads.length === PAGE_SIZE);
      } catch (err) {
        if (controller.signal.aborted || token !== reqTokenRef.current) return;
        toast.error(err instanceof Error ? err.message : "Failed to load inbox");
        if (!opts.append) setThreads([]);
      } finally {
        if (token === reqTokenRef.current) {
          if (opts.append) setLoadingMore(false);
          else setLoading(false);
        }
      }
    },
    [],
  );

  // Initial load.
  useEffect(() => {
    void fetchPage({ q: "", offset: 0, append: false });
  }, [fetchPage]);

  // Debounced search handler passed to the list. Resets pagination + selection.
  const handleSearch = useCallback(
    (q: string) => {
      // Skip redundant re-fetch when the debounced value hasn't actually changed
      // from the current query (e.g. focus/blur churn).
      setQuery((prev) => {
        if (prev === q) return prev;
        return q;
      });
      setSelectedThreadId(null);
      void fetchPage({ q, offset: 0, append: false });
    },
    [fetchPage],
  );

  const loadMore = useCallback(() => {
    void fetchPage({ q: query, offset, append: true });
  }, [fetchPage, query, offset]);

  const selected = threads.find((t) => t.threadId === selectedThreadId) ?? null;

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/40 px-4 py-3 md:px-6">
        <div className="rounded-lg bg-primary/10 p-2">
          <Mail className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Gmail Inbox</h1>
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Loading conversations…"
              : `${threads.length} conversation${threads.length === 1 ? "" : "s"}${
                  hasMore ? "+" : ""
                }${query ? ` matching “${query}”` : ""}`}
          </p>
        </div>
      </div>

      {/* Two-pane body */}
      <div className="flex min-h-0 flex-1">
        {/* Left: thread list. Hidden on mobile once a thread is selected. */}
        <div
          className={`flex min-h-0 w-full flex-col md:w-[380px] md:shrink-0 md:border-r md:border-border/40 ${
            selectedThreadId ? "hidden md:flex" : "flex"
          }`}
        >
          <GmailThreadList
            threads={threads}
            selectedThreadId={selectedThreadId}
            onSelect={setSelectedThreadId}
            loading={loading}
            onSearch={handleSearch}
            searchPlaceholder="Search mail"
            emptyLabel={
              query
                ? `No conversations match “${query}”.`
                : "No conversations yet."
            }
            footer={
              hasMore ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              ) : null
            }
          />
        </div>

        {/* Right: reading pane. Hidden on mobile until a thread is selected. */}
        <div
          className={`min-h-0 flex-1 ${selectedThreadId ? "flex" : "hidden md:flex"}`}
        >
          <div className="min-h-0 w-full">
            <GmailThreadView
              threadId={selectedThreadId}
              companyName={selected?.companyName ?? null}
              onBack={() => setSelectedThreadId(null)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
