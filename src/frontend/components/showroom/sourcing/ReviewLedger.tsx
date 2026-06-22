/**
 * @fileoverview Workflow 2 (part A) — Review Ledger of showroom candidates.
 *
 * Lists sourced showrooms as an approvable ledger: each row shows a new-vs-
 * existing badge (derived from createdAt) with per-item Approve / Rule-out, plus
 * multi-select bulk "Approve all". Approve writes a positive homeowner rating
 * (`POST /:id/rate` rating 5); Rule-out is delegated to the parent's
 * RuleOutDialog (rating 1 + reason). Bulk approve runs a sequential loop so a
 * single failure never aborts the batch — mirroring MovePhotosModal.
 *
 * Selecting a row drives the detail panel (FindingsLedger + MediaGallery).
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  CheckCheck,
  Loader2,
  Search,
  Sparkle,
  Store as StoreIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { rateStore, type StoreListRow } from "./api";
import { isNewlySourced } from "./types";

interface ReviewLedgerProps {
  stores: StoreListRow[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  selectedStoreId: number | null;
  onSelect: (storeId: number) => void;
  onRuleOut: (store: { id: number; name: string }) => void;
  onApproved: (storeId: number) => void;
}

export function ReviewLedger(props: ReviewLedgerProps) {
  const { stores, loading, search, onSearch, selectedStoreId, onSelect, onRuleOut, onApproved } = props;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<Set<number>>(new Set());

  const newCount = useMemo(
    () => stores.filter((s) => isNewlySourced(s.createdAt)).length,
    [stores],
  );

  function toggle(storeId: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  }

  function markRow(storeId: number, busy: boolean) {
    setRowBusy((cur) => {
      const next = new Set(cur);
      if (busy) next.add(storeId);
      else next.delete(storeId);
      return next;
    });
  }

  async function approveOne(store: StoreListRow) {
    markRow(store.id, true);
    const result = await rateStore(store.id, 5, "Approved from sourcing review ledger");
    markRow(store.id, false);
    if (!result.ok) {
      toast.error(`Approve failed: ${result.error}`);
      return;
    }
    toast.success(`Approved “${store.name}”.`);
    onApproved(store.id);
  }

  /** Bulk approve — sequential loop, never aborts on a single failure. */
  async function approveAll() {
    const targets = stores.filter((s) => selected.has(s.id));
    if (targets.length === 0) return;
    setBulkBusy(true);
    let moved = 0;
    let failed = 0;
    for (const store of targets) {
      const result = await rateStore(store.id, 5, "Bulk-approved from sourcing review ledger");
      if (result.ok) {
        moved += 1;
        onApproved(store.id);
      } else {
        failed += 1;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failed === 0) toast.success(`Approved ${moved} showroom${moved === 1 ? "" : "s"}.`);
    else toast.warning(`Approved ${moved}, ${failed} failed.`);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header + search */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CheckCheck className="size-4 text-emerald-400" />
            Review ledger
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {stores.length} · {newCount} new
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Filter showrooms…"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/5 px-3 py-2 ring-1 ring-emerald-500/20">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>
              Clear
            </Button>
            <Button
              size="xs"
              onClick={approveAll}
              disabled={bulkBusy}
              className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90"
            >
              {bulkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
              Approve all ({selected.size})
            </Button>
          </div>
        </div>
      ) : null}

      {/* List */}
      <div className="flex-1 space-y-2 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading showrooms…
          </div>
        ) : stores.length === 0 ? (
          <div className="rounded-lg bg-muted/10 px-4 py-12 text-center text-sm text-muted-foreground ring-1 ring-border/40">
            No showrooms match. Launch a category sweep to discover new ones.
          </div>
        ) : (
          stores.map((store) => {
            const isNew = isNewlySourced(store.createdAt);
            const isSelected = selectedStoreId === store.id;
            const checked = selected.has(store.id);
            const busy = rowBusy.has(store.id);
            return (
              <div
                key={store.id}
                className={cn(
                  "rounded-lg p-3 transition ring-1",
                  isSelected ? "bg-card ring-violet-500/40" : "bg-card ring-border/40 hover:ring-border",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <button
                    type="button"
                    aria-label={checked ? "Deselect" : "Select for bulk approve"}
                    onClick={() => toggle(store.id)}
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded transition ring-1",
                      checked
                        ? "bg-emerald-500 text-emerald-950 ring-emerald-500"
                        : "bg-transparent ring-border/60 hover:ring-border",
                    )}
                  >
                    {checked ? <Check className="size-3" /> : null}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelect(store.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <StoreIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">{store.name}</span>
                      {isNew ? (
                        <Badge variant="outline" className="shrink-0 border-violet-500/30 bg-violet-500/10 text-[9px] text-violet-300">
                          <Sparkle className="mr-0.5 size-2.5" /> New
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 text-[9px] text-muted-foreground">
                          Existing
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {[store.cityName, store.inventoryFocus, store.pricePoint].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </button>
                </div>

                <div className="mt-2.5 flex items-center justify-end gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onRuleOut({ id: store.id, name: store.name })}
                    disabled={busy}
                    className="text-muted-foreground"
                  >
                    Rule out
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => approveOne(store)}
                    disabled={busy}
                    className="bg-foreground text-background hover:bg-foreground/90"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    Approve
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
