/**
 * budget-table.tsx — the live, paginated, searchable, filterable budget-items
 * table extracted out of `BudgetSignals.tsx` so each file stays comfortably
 * under the cloudflare-jedi per-file budget.
 *
 * WHY A SEPARATE FILE: `BudgetSignals` owns the section anchors, the stat-card
 * row, and the estimates list. The interactive table — with its own fetch
 * lifecycle, debounce, pagination, and status filter — is a self-contained unit
 * with no shared state, so it lives here and is mounted by `BudgetSignals`.
 *
 * DATA SOURCE (Round 1 endpoint, no mock data):
 *   GET /api/rooms/:roomId/budget-items?search=&status=&page=&pageSize=
 *   → { success, items, pagination: { page, pageSize, total, totalPages }, room }
 * Each item carries `rangeFormatted` (server-formatted "$low – $high") plus the
 * raw `estimatedLowCents` / `estimatedHighCents` so we never re-derive currency.
 *
 * The table is built with plain React state (no @tanstack/react-table, no new
 * dependency) and Monolith styling: ring/divide/bg-card separation, never a 1px
 * border for structure.
 */

import { Loader2, Search, SlidersHorizontal } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "./types";

/**
 * The valid `status` values a budget tracker item can hold, mirrored from
 * `budget_tracker_items.status` (open | researching | blocked | approved | done).
 * "all" is the synthetic sentinel for "no status filter".
 */
const BUDGET_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "researching", label: "Researching" },
  { value: "blocked", label: "Blocked" },
  { value: "approved", label: "Approved" },
  { value: "done", label: "Done" },
] as const;

/** Page size requested from the API. Kept modest so the table never paints a wall. */
const PAGE_SIZE = 10;

/** Debounce window (ms) for the free-text search box before it hits the API. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * A single budget item row as returned by the budget-items endpoint. The server
 * spreads the full `budget_tracker_items` row and appends `rangeFormatted`, so
 * this is a permissive superset of the fields we actually render.
 */
export interface BudgetTableItem {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  executionClass: string;
  estimatedLowCents?: number | null;
  estimatedHighCents?: number | null;
  rangeFormatted?: string | null;
}

/** The pagination block the endpoint returns alongside `items`. */
interface BudgetPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Successful response envelope from GET /api/rooms/:roomId/budget-items. */
interface BudgetItemsResponse {
  success: boolean;
  items?: BudgetTableItem[];
  pagination?: BudgetPagination;
  error?: { message?: string } | string;
}

/**
 * Maps a budget status to a Monolith-friendly `Badge` variant. We avoid raw
 * colors and lean on the theme's semantic variants so the table reads correctly
 * in dark mode without hand-tuned hex values.
 */
function statusBadgeVariant(
  status: string,
): React.ComponentProps<typeof Badge>["variant"] {
  switch (status) {
    case "approved":
      return "default";
    case "done":
      return "secondary";
    case "blocked":
      return "destructive";
    case "researching":
      return "outline";
    case "open":
    default:
      return "ghost";
  }
}

/** Humanizes the snake_case execution class for display (must_now → Must now). */
function formatExecutionClass(executionClass: string): string {
  if (!executionClass) return "—";
  return executionClass
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export interface BudgetTableProps {
  /** Numeric room id used to scope the budget-items query. */
  roomId: number;
}

/**
 * BudgetTable — fetches and renders the room's budget items with live search,
 * status filtering, and pagination. Every control (search, status, page) feeds
 * back into a single fetch so the server stays the source of truth — there is no
 * client-side mock list and no stale snapshot.
 */
export function BudgetTable({ roomId }: BudgetTableProps) {
  // The raw text in the search box, and its debounced mirror that actually
  // drives the query. Splitting them keeps typing snappy while limiting fetches.
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<BudgetTableItem[]>([]);
  const [pagination, setPagination] = useState<BudgetPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // An incrementing token guards against out-of-order responses: a slow earlier
  // request must not overwrite the result of a newer one (classic race fix).
  const requestTokenRef = useRef(0);

  // Debounce the search box → debouncedSearch, and reset to page 1 on any new
  // search term so the user never lands on an out-of-range page.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const loadItems = useCallback(async () => {
    const token = ++requestTokenRef.current;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status && status !== "all") params.set("status", status);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));

      const response = await fetch(
        `/api/rooms/${roomId}/budget-items?${params.toString()}`,
        { credentials: "include" },
      );
      const payload = (await response.json()) as BudgetItemsResponse;

      // Ignore stale responses (a newer request has since been issued).
      if (token !== requestTokenRef.current) return;

      if (!response.ok || !payload.success) {
        const message =
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message || "Failed to load budget items";
        throw new Error(message);
      }

      setItems(payload.items ?? []);
      setPagination(payload.pagination ?? null);
    } catch (caught) {
      if (token !== requestTokenRef.current) return;
      setError(caught instanceof Error ? caught.message : "Failed to load budget items");
      setItems([]);
      setPagination(null);
    } finally {
      if (token === requestTokenRef.current) setLoading(false);
    }
  }, [roomId, debouncedSearch, status, page]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Derived label for the "showing X–Y of N" footer; memoized to avoid noise.
  const rangeLabel = useMemo(() => {
    if (!pagination || pagination.total === 0) return "No budget items";
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
    return `Showing ${start}–${end} of ${pagination.total}`;
  }, [pagination]);

  const totalPages = pagination?.totalPages ?? 0;
  const canPrev = page > 1;
  const canNext = totalPages > 0 && page < totalPages;

  const handleStatusChange = useCallback((next: string | null) => {
    setStatus(next ?? "all");
    setPage(1);
  }, []);

  return (
    <div className="space-y-4">
      {/* Controls: free-text search + status filter. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search budget items…"
            className="h-8 pl-8"
            aria-label="Search budget items"
          />
        </div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger size="sm" className="w-40" aria-label="Filter by status">
              <SelectValue
                items={BUDGET_STATUS_OPTIONS as unknown as { value: string; label: string }[]}
                placeholder="All statuses"
              />
            </SelectTrigger>
            <SelectContent>
              {BUDGET_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* The table surface — ring + divide for separation, never 1px borders. */}
      <div className="overflow-hidden rounded-xl bg-card/40 ring-1 ring-foreground/10">
        {/* Desktop / tablet: a real table. Hidden on the smallest screens. */}
        <div className="hidden sm:block">
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="divide-x divide-foreground/5 border-b border-foreground/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">
                  Item
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Class
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Estimated range
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                    <span className="mt-2 block text-sm">Loading budget items…</span>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-destructive">
                    {error}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No budget items match the current filters.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="align-top transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <p className="font-medium leading-5">{item.title}</p>
                      {item.description ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {item.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatExecutionClass(item.executionClass)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeVariant(item.status)} className="capitalize">
                        {item.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.rangeFormatted ||
                        `${formatCurrency(item.estimatedLowCents)} – ${formatCurrency(item.estimatedHighCents)}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: stacked cards instead of a horizontally-scrolling table. */}
        <div className="divide-y divide-foreground/5 sm:hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-muted-foreground">
              <Loader2 className="mx-auto size-5 animate-spin" />
              <span className="mt-2 block text-sm">Loading budget items…</span>
            </div>
          ) : error ? (
            <div className="px-4 py-10 text-center text-sm text-destructive">{error}</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No budget items match the current filters.
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 font-medium leading-5">{item.title}</p>
                  <Badge variant={statusBadgeVariant(item.status)} className="shrink-0 capitalize">
                    {item.status}
                  </Badge>
                </div>
                {item.description ? (
                  <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatExecutionClass(item.executionClass)}</span>
                  <span className="tabular-nums text-foreground">
                    {item.rangeFormatted ||
                      `${formatCurrency(item.estimatedLowCents)} – ${formatCurrency(item.estimatedHighCents)}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer: range label + pager. Pager hidden when there is one page or less. */}
      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        {totalPages > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={!canPrev || loading}
            >
              Previous
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              Page {pagination?.page ?? page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={!canNext || loading}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default BudgetTable;
