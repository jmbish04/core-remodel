/**
 * @fileoverview Left pane of the Gmail two-pane layout — a scrollable thread
 * list. Fully controlled: the parent owns `threads`, `selectedThreadId`, and
 * `onSelect`.
 *
 * Search is OPTIONAL (`onSearch` prop). When provided, the input is shown and
 * debounced; the actual refetch is done by the parent via `onSearch(q)` so the
 * list stays a pure presentational component. The debounce + race-guard for the
 * global inbox lives in `GmailInboxApp`; the company-scoped view omits
 * `onSearch` entirely (no input rendered).
 */

import { useEffect, useRef, useState } from "react";
import { Building2, Search } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  displayNameFromAddress,
  formatListDate,
  initialsFromAddress,
  type GmailInboxThreadItem,
} from "./types";

interface GmailThreadListProps {
  threads: GmailInboxThreadItem[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  loading?: boolean;
  /** When set, renders a debounced search input that calls this on change. */
  onSearch?: (q: string) => void;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Message shown when the list is empty (and not loading). */
  emptyLabel?: string;
  /** Optional footer slot (e.g. a "Load more" button in the global inbox). */
  footer?: React.ReactNode;
}

const DEBOUNCE_MS = 300;

function ThreadRowSkeleton() {
  return (
    <div className="flex gap-3 px-4 py-3">
      <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

export function GmailThreadList({
  threads,
  selectedThreadId,
  onSelect,
  loading = false,
  onSearch,
  searchPlaceholder = "Search mail",
  emptyLabel = "No conversations found.",
  footer,
}: GmailThreadListProps) {
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the search input. The parent's `onSearch` is expected to be stable
  // enough (it is, in both call sites) that we don't re-arm on every render;
  // we intentionally key the effect on `query` only.
  useEffect(() => {
    if (!onSearch) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      {onSearch && (
        <div className="shrink-0 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9"
              aria-label={searchPlaceholder}
            />
          </div>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="divide-y divide-border/40">
            {Array.from({ length: 6 }).map((_, i) => (
              <ThreadRowSkeleton key={i} />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <div className="rounded-full bg-muted/60 p-3">
              <Search className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {threads.map((t) => {
              const selected = t.threadId === selectedThreadId;
              const from = t.lastMessage?.from ?? "";
              const senderName = from ? displayNameFromAddress(from) : "Unknown sender";
              const subject = t.subject || t.lastMessage?.subject || "(no subject)";
              const snippet = t.lastMessage?.snippet ?? "";
              const date = formatListDate(t.lastMessage?.date ?? null);

              return (
                <li key={t.threadId}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.threadId)}
                    aria-current={selected ? "true" : undefined}
                    className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                      selected ? "bg-muted" : ""
                    }`}
                  >
                    <Avatar className="size-9 shrink-0 bg-primary/10 text-primary">
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {from ? initialsFromAddress(from) : "?"}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {senderName}
                        </span>
                        {date && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {date}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-foreground/90">
                          {subject}
                        </span>
                        {t.messageCount > 1 && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {t.messageCount}
                          </span>
                        )}
                      </div>

                      {snippet && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {snippet}
                        </p>
                      )}

                      {t.companyName && (
                        <Badge
                          variant="secondary"
                          className="mt-1.5 gap-1 text-[10px] font-medium"
                        >
                          <Building2 className="size-3" />
                          {t.companyName}
                        </Badge>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {footer && <div className="p-3">{footer}</div>}
      </ScrollArea>
    </div>
  );
}
