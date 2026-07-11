/**
 * @fileoverview Shared service-linking control for every "tie a row to a
 * service" surface in the app (invoice line items, contracts, estimate line
 * items).
 *
 * It is intentionally dumb about *where* the tie is persisted: the parent owns
 * the endpoint and passes an `onPick(serviceId | null)` callback. This control
 * only handles:
 *   - debounced search of the services catalog (`GET /api/services?search=`)
 *   - picking a service (fires `onPick(id)`)
 *   - clearing the link (fires `onPick(null)`)
 *   - showing the currently-linked service name + an inline edit/clear affordance
 *
 * The search is race-guarded (an `active` flag) so a slow earlier request can't
 * clobber the results of a faster later one, and so we never setState after
 * unmount. `onPick` may be async; while it's in flight the control shows a
 * spinner and disables its buttons so a double-click can't fire two writes.
 *
 * Display name handling: the parent may or may not know the linked service's
 * name (e.g. an estimate line item row may only carry `serviceId`). We seed the
 * display from `serviceName` when given, otherwise fall back to `Service #<id>`,
 * and we hold onto the optimistic name we picked locally so the label stays
 * correct across a parent refetch that doesn't echo the name back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Loader2, SearchIcon, Tag, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Shape returned by `GET /api/services`. */
interface ServiceOption {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  defaultUnitCost: number | null;
  isArchived: boolean;
}

export function ServicePicker({
  serviceId,
  serviceName,
  onPick,
  disabled = false,
  className,
}: {
  /** Currently-linked service id, or `null` when unlinked. */
  serviceId: number | null;
  /** Display name for the linked service when the parent knows it. */
  serviceName?: string | null;
  /** Persist the pick. Return a promise to drive the busy spinner. */
  onPick: (serviceId: number | null) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ServiceOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<{ id: number; name: string } | null>(
    serviceId != null ? { id: serviceId, name: serviceName ?? `Service #${serviceId}` } : null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the displayed link in sync with the parent, but preserve the optimistic
  // name we set locally when the id hasn't changed (parent refetch may omit it).
  useEffect(() => {
    setCurrent((prev) => {
      if (serviceId == null) return null;
      if (prev?.id === serviceId) return prev;
      return { id: serviceId, name: serviceName ?? `Service #${serviceId}` };
    });
  }, [serviceId, serviceName]);

  // Debounced, race-guarded search of the services catalog (active only).
  useEffect(() => {
    if (!open) return;
    let active = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Show the searching state immediately (not after the 250ms debounce) so the
    // empty-list message can't flash before the request starts.
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = query.trim()
          ? `/api/services?search=${encodeURIComponent(query.trim())}`
          : "/api/services";
        const res = await fetch(url, { credentials: "include" });
        const json = (await res.json()) as { services?: ServiceOption[] };
        if (active) setResults((json.services ?? []).slice(0, 8));
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => {
      active = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  const commit = useCallback(
    async (next: ServiceOption | null) => {
      setBusy(true);
      try {
        await onPick(next ? next.id : null);
        setCurrent(next ? { id: next.id, name: next.name } : null);
        setOpen(false);
        setQuery("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to link service");
      } finally {
        setBusy(false);
      }
    },
    [onPick],
  );

  // ── Closed: show the current link (or a link trigger) ──────────────────────
  if (!open) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        {current ? (
          <>
            <Badge className="gap-1 bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30">
              <Tag className="size-3" />
              {current.name}
            </Badge>
            {!disabled && (
              <>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setOpen(true)}
                >
                  change
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => void commit(null)}
                  aria-label="Clear service link"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                </button>
              </>
            )}
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            <Link2 className="size-3.5" />
            Link service
          </Button>
        )}
      </div>
    );
  }

  // ── Open: inline search picker ─────────────────────────────────────────────
  return (
    <div className={`rounded-md bg-muted/30 p-2.5 ring-1 ring-border/40 ${className ?? ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          Link to a service
        </span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
          aria-label="Close service picker"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search services catalog…"
          className="h-8 pl-8 text-sm"
        />
      </div>

      <div className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto">
        {searching ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Searching…
          </div>
        ) : results.length > 0 ? (
          results.map((svc) => (
            <button
              key={svc.id}
              type="button"
              disabled={busy}
              onClick={() => void commit(svc)}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-foreground/5 disabled:opacity-50"
            >
              <span className="min-w-0 truncate">
                <span className="text-foreground">{svc.name}</span>
                {svc.category ? (
                  <span className="ml-2 text-xs text-muted-foreground">{svc.category}</span>
                ) : null}
              </span>
              {svc.isArchived ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">archived</span>
              ) : null}
            </button>
          ))
        ) : (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No matching services. Add one in the Services catalog.
          </div>
        )}
      </div>
    </div>
  );
}
