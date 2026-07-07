/**
 * @fileoverview CandidatesSection — the discovery-intake table.
 *
 * For discovery kinds (discovery_showrooms / _brands / _products) the job result
 * carries a `candidates[]` list. Each row surfaces name, category, price point,
 * website, and a summary, plus a status column that drives intake:
 *   - "existing"   → an "Already registered" badge linking to the matched entity;
 *   - "new"        → an "Add to system" button → POST /:id/intake { candidateIndex };
 *   - "registered" → a "Registered" badge linking to the freshly-created entity;
 *   - "failed"     → the prior error, inline, with a retry.
 *
 * For discovery_products the intake needs a target showroom: the "Add" button
 * opens a small dialog with the reused showroom search-select, then POSTs
 * { candidateIndex, storeId }.
 *
 * Intake results are optimistically flipped in local state so the row updates
 * without waiting for the next poll; the parent is also notified so it can refetch.
 *
 * Monolith dark conventions: shadcn Dialog (never window.confirm), bg-card +
 * ring-1 ring-border/40, sonner + console on catch, disable-while-in-flight.
 */

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Plus, Store, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { EntitySearchSelect, type EntityHit } from "./EntitySearchSelect";
import {
  entityHref,
  postJson,
  type DiscoveryCandidate,
  type EntityType,
  type ResearchKind,
} from "./types";

// ─── Local view state ───────────────────────────────────────────────────────────

/** A candidate augmented with any optimistic post-intake overrides. */
type Row = DiscoveryCandidate & { _index: number };

// The entity type a given discovery kind produces (for the deep-link builder).
const KIND_ENTITY_TYPE: Record<string, EntityType> = {
  discovery_showrooms: "showroom",
  discovery_brands: "brand",
  discovery_products: "product",
};

// ─── Status cell ────────────────────────────────────────────────────────────────

function EntityLinkBadge({
  entityType,
  entityId,
  name,
  tone,
}: {
  entityType: EntityType;
  entityId: number | null;
  name: string;
  tone: "amber" | "emerald";
}) {
  const href = entityHref({ entityType, entityId });
  const cls =
    tone === "emerald"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  const Inner = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${cls}`}
    >
      <CheckCircle2 className="size-3" />
      {name}
      {href ? <ExternalLink className="size-3" /> : null}
    </span>
  );
  return href ? (
    <a href={href} className="hover:opacity-80">
      {Inner}
    </a>
  ) : (
    Inner
  );
}

// ─── One candidate row ──────────────────────────────────────────────────────────

function CandidateRow({
  row,
  entityType,
  busy,
  onAdd,
}: {
  row: Row;
  entityType: EntityType;
  busy: boolean;
  onAdd: (row: Row) => void;
}) {
  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <div className="text-sm font-medium text-card-foreground">{row.name}</div>
        {row.address ? (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{row.address}</div>
        ) : null}
        {row.summary ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.summary}</p>
        ) : null}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground">{row.category || "—"}</td>
      <td className="px-3 py-3 font-mono text-xs text-emerald-400">
        {row.pricePoint || "—"}
      </td>
      <td className="px-3 py-3">
        {row.websiteUrl ? (
          <a
            href={row.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
          >
            <ExternalLink className="size-3" /> Site
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-3">
        {row.intakeStatus === "existing" ? (
          <EntityLinkBadge
            entityType={entityType}
            entityId={row.matchedEntityId}
            name={row.matchedEntityName || "Already registered"}
            tone="amber"
          />
        ) : row.intakeStatus === "registered" ? (
          <EntityLinkBadge
            entityType={entityType}
            entityId={row.intakeEntityId}
            name="Registered"
            tone="emerald"
          />
        ) : row.intakeStatus === "failed" ? (
          <div className="space-y-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300 ring-1 ring-rose-500/30">
              <XCircle className="size-3" /> Failed
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              disabled={busy}
              onClick={() => onAdd(row)}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
              Retry
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="h-7 gap-1.5"
            disabled={busy}
            onClick={() => onAdd(row)}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
            Add to system
          </Button>
        )}
      </td>
    </tr>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────────

export function CandidatesSection({
  jobId,
  kind,
  candidates,
  onIntake,
}: {
  jobId: number;
  kind: ResearchKind;
  candidates: DiscoveryCandidate[];
  /** Notify the parent after a successful intake so it can refetch the job. */
  onIntake?: () => void;
}) {
  const entityType = KIND_ENTITY_TYPE[kind] ?? null;
  const needsShowroom = kind === "discovery_products";

  // Optimistic overrides keyed by candidate index (so a flip survives until the
  // next poll delivers the same status from the server).
  const [overrides, setOverrides] = useState<Record<number, Partial<DiscoveryCandidate>>>({});
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  // Showroom-picker dialog state (discovery_products only).
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [pickedStore, setPickedStore] = useState<EntityHit | null>(null);

  const rows: Row[] = useMemo(
    () =>
      candidates.map((c, i) => ({
        ...c,
        ...overrides[i],
        _index: i,
      })),
    [candidates, overrides],
  );

  const runIntake = useCallback(
    async (index: number, storeId?: number) => {
      setBusyIndex(index);
      try {
        const body: { candidateIndex: number; storeId?: number } = {
          candidateIndex: index,
        };
        if (storeId != null) body.storeId = storeId;
        const resp = await postJson<{
          success: boolean;
          entityId: number;
          entityType: EntityType;
        }>(`/api/research-jobs/${jobId}/intake`, body);
        setOverrides((prev) => ({
          ...prev,
          [index]: {
            intakeStatus: "registered",
            intakeEntityId: resp.entityId,
          },
        }));
        toast.success("Added to system");
        onIntake?.();
      } catch (e) {
        console.error("[research/intake]", e);
        setOverrides((prev) => ({ ...prev, [index]: { intakeStatus: "failed" } }));
        toast.error(e instanceof Error ? e.message : "Failed to add candidate");
      } finally {
        setBusyIndex(null);
      }
    },
    [jobId, onIntake],
  );

  const handleAdd = useCallback(
    (row: Row) => {
      if (needsShowroom) {
        // Products need a target showroom — open the picker first.
        setPickedStore(null);
        setPickerFor(row._index);
        return;
      }
      void runIntake(row._index);
    },
    [needsShowroom, runIntake],
  );

  const confirmPicker = useCallback(() => {
    if (pickerFor == null || !pickedStore) return;
    const idx = pickerFor;
    setPickerFor(null);
    void runIntake(idx, pickedStore.id);
  }, [pickerFor, pickedStore, runIntake]);

  if (candidates.length === 0) {
    return (
      <section className="rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
        <Store className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">No candidates yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Discovery results will appear here as the research completes.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
        <div className="flex items-center justify-between gap-2 px-5 py-4">
          <h2 className="text-base font-semibold">Candidates ({candidates.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="bg-muted/40">
              <tr>
                {["Name", "Category", "Price", "Website", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {rows.map((row) => (
                <CandidateRow
                  key={row._index}
                  row={row}
                  entityType={entityType}
                  busy={busyIndex === row._index}
                  onAdd={handleAdd}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Showroom picker (discovery_products intake). */}
      <Dialog
        open={pickerFor !== null}
        onOpenChange={(o) => {
          if (busyIndex !== null) return;
          if (!o) setPickerFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add product to a showroom</DialogTitle>
            <DialogDescription>
              Pick the showroom this product belongs to. It'll be created and mapped there.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <EntitySearchSelect
              catalog="showroom"
              value={pickedStore}
              onChange={setPickedStore}
              label="Showroom"
              autoFocus
            />
          </div>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPickerFor(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmPicker} disabled={!pickedStore}>
              Add product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
