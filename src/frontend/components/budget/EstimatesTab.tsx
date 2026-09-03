/**
 * @fileoverview Budget Command Center — estimate-to-room reconciliation queue.
 * Candidates are arguments for human review, not automatic assignments.
 */
import { AlertCircle, CheckCircle2, FileCheck2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { NoteBody } from "@/components/showroom/NoteBody";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RoomSelect } from "@/components/ui/room-select";
import {
  BudgetApiError,
  confirmReconciliation,
  formatCents,
  getReconciliationQueue,
  rejectReconciliation,
  useBudgetQuery,
  type ReconciliationCandidate,
  type ReconciliationQueueItem,
} from "@/lib/budget-api";
import { cn } from "@/lib/utils";

const VERDICT_META: Record<
  ReconciliationCandidate["verdict"],
  { label: string; className: string }
> = {
  likely: {
    label: "Likely",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  },
  possible: {
    label: "Possible",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  },
  eliminated: { label: "Eliminated", className: "text-muted-foreground" },
};

function confidenceLabel(confidence: number | null): string | null {
  if (confidence == null) return null;
  return `${Math.round(confidence <= 1 ? confidence * 100 : confidence)}%`;
}

function candidateDefault(item: ReconciliationQueueItem): number | null {
  const top = [...item.candidates].sort((a, b) => a.rank - b.rank)[0];
  return top?.verdict === "likely" ? top.roomId : null;
}

function CandidateArgument({ candidate }: { candidate: ReconciliationCandidate }) {
  const verdict = VERDICT_META[candidate.verdict];
  const confidence = confidenceLabel(candidate.confidence);

  return (
    <li
      className={cn(
        "grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(7rem,auto)_1fr] sm:gap-4",
        candidate.verdict === "likely" && "border-emerald-500/30 bg-emerald-500/5",
        candidate.verdict === "possible" && "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 self-start">
        <span className="font-medium text-foreground">{candidate.roomName}</span>
        <Badge variant="outline" className={verdict.className}>
          {verdict.label}
        </Badge>
        {confidence ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{confidence}</span>
        ) : null}
      </div>
      <div className="min-w-0 text-muted-foreground">
        {candidate.reasoning.markdown || candidate.reasoning.html ? (
          <NoteBody
            markdown={candidate.reasoning.markdown}
            html={candidate.reasoning.html}
            className="text-xs text-muted-foreground prose-p:my-0 prose-p:leading-5"
          />
        ) : (
          <p className="text-xs leading-5">No supporting reasoning was provided.</p>
        )}
      </div>
    </li>
  );
}

interface EstimateCardProps {
  item: ReconciliationQueueItem;
  selectedRoomId: number | null;
  mutationError: string | null;
  isSubmitting: boolean;
  onRoomChange: (roomId: number | null) => void;
  onConfirm: () => void;
  onReject: () => void;
}

function EstimateCard({
  item,
  selectedRoomId,
  mutationError,
  isSubmitting,
  onRoomChange,
  onConfirm,
  onReject,
}: EstimateCardProps) {
  const candidates = useMemo(
    () => [...item.candidates].sort((a, b) => a.rank - b.rank),
    [item.candidates],
  );
  const source = [item.estimateCompanyLabel, item.estimateLineNumber].filter(Boolean).join(" · ");

  return (
    <li>
      <Card size="sm" className="bg-muted/30">
        <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-x-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug text-foreground">
              {item.description}
            </h3>
            {source ? <p className="mt-1 text-xs text-muted-foreground">{source}</p> : null}
          </div>
          {item.lineTotalCents != null ? (
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {formatCents(item.lineTotalCents)}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {candidates.length > 0 ? (
            <ol className="space-y-2" aria-label={`Candidate rooms for ${item.description}`}>
              {candidates.map((candidate) => (
                <CandidateArgument key={candidate.roomId} candidate={candidate} />
              ))}
            </ol>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              No room candidates were found. Choose an existing room or create one first.
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <RoomSelect
              value={selectedRoomId}
              onChange={onRoomChange}
              placeholder="Choose room…"
              aria-label={`Room for ${item.description}`}
              disabled={isSubmitting}
              className="sm:w-64"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={onConfirm}
                disabled={isSubmitting || selectedRoomId == null}
              >
                {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Confirm
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={isSubmitting}>
                Reject
              </Button>
            </div>
            {selectedRoomId == null ? (
              <Button
                size="sm"
                variant="link"
                render={
                  <a
                    href="/admin/planning/measure"
                    aria-label="Create a new room in the floor plan"
                  />
                }
                className="justify-start px-0 text-xs text-muted-foreground sm:ml-1"
              >
                Create a new room
              </Button>
            ) : null}
          </div>

          {mutationError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>{mutationError} The estimate line was restored to the queue.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

export function EstimatesTab() {
  const { data, error, isLoading, refetch } = useBudgetQuery(
    (signal) => getReconciliationQueue(undefined, signal),
    [],
  );
  const [removedIds, setRemovedIds] = useState<Set<number>>(() => new Set());
  const [selectedRooms, setSelectedRooms] = useState<Record<number, number | null>>({});
  const [submittingIds, setSubmittingIds] = useState<Set<number>>(() => new Set());
  const [mutationErrors, setMutationErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!data) return;
    setSelectedRooms((current) => {
      const next = { ...current };
      for (const item of data.items) {
        if (!(item.lineItemId in next)) next[item.lineItemId] = candidateDefault(item);
      }
      return next;
    });
  }, [data]);

  const visibleItems = (data?.items ?? []).filter((item) => !removedIds.has(item.lineItemId));
  const visibleTotalCents = visibleItems.reduce(
    (total, item) => total + (item.lineTotalCents ?? 0),
    0,
  );

  async function submit(item: ReconciliationQueueItem, action: "confirm" | "reject") {
    const roomId = selectedRooms[item.lineItemId] ?? null;
    if (action === "confirm" && roomId == null) return;

    setMutationErrors((current) => {
      const next = { ...current };
      delete next[item.lineItemId];
      return next;
    });
    setSubmittingIds((current) => new Set(current).add(item.lineItemId));
    setRemovedIds((current) => new Set(current).add(item.lineItemId));

    try {
      if (action === "confirm") {
        await confirmReconciliation(item.lineItemId, { roomId: roomId as number });
      } else {
        await rejectReconciliation(item.lineItemId, {});
      }
    } catch (requestError) {
      setRemovedIds((current) => {
        const next = new Set(current);
        next.delete(item.lineItemId);
        return next;
      });
      setMutationErrors((current) => ({
        ...current,
        [item.lineItemId]:
          requestError instanceof Error ? requestError.message : "The request failed.",
      }));
    } finally {
      setSubmittingIds((current) => {
        const next = new Set(current);
        next.delete(item.lineItemId);
        return next;
      });
    }
  }

  return (
    <Card>
      <CardHeader className="sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 className="size-5 text-muted-foreground" aria-hidden />
            <h2 className="text-base font-semibold leading-snug text-foreground">
              Estimate reconciliation
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Review the evidence, then confirm a room or reject the suggestion.
          </p>
        </div>
        {!isLoading && !error && visibleItems.length > 0 ? (
          <p className="font-mono text-xs tabular-nums text-muted-foreground sm:text-right">
            {visibleItems.length} {visibleItems.length === 1 ? "line" : "lines"} unassigned ·{" "}
            {formatCents(visibleTotalCents)}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div
            className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading estimate lines…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertCircle className="size-6 text-destructive" aria-hidden />
            <div>
              <p className="text-sm font-medium text-foreground">
                Couldn't load estimate reconciliation
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error instanceof BudgetApiError ? `HTTP ${error.status} — ` : ""}
                {error.message}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={refetch}>
              Try again
            </Button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center" role="status">
            <CheckCircle2 className="size-6 text-emerald-500" aria-hidden />
            <p className="text-sm font-medium text-foreground">Everything is mapped</p>
            <p className="text-xs text-muted-foreground">
              There are no estimate lines waiting for room assignment.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleItems.map((item) => (
              <EstimateCard
                key={item.lineItemId}
                item={item}
                selectedRoomId={selectedRooms[item.lineItemId] ?? null}
                mutationError={mutationErrors[item.lineItemId] ?? null}
                isSubmitting={submittingIds.has(item.lineItemId)}
                onRoomChange={(roomId) =>
                  setSelectedRooms((current) => ({ ...current, [item.lineItemId]: roomId }))
                }
                onConfirm={() => void submit(item, "confirm")}
                onReject={() => void submit(item, "reject")}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default EstimatesTab;
