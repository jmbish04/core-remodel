/**
 * @fileoverview EstimateReconcileApp — HITL queue for mapping estimate line
 * items to rooms. A line item can plausibly belong to any room in the house
 * (the "ambiguous parent" case in AGENTS.md): the AI only ever STAGES a
 * ranked guess with its reasoning via `POST .../ai-suggest`; a human reviews
 * that reasoning and writes the real mapping via `PATCH .../reconcile`. Never
 * silently auto-confirms an AI guess.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/components/products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RoomSelect } from "@/components/ui/room-select";
import { Spinner } from "@/components/ui/spinner";

type MappingStatus = "unmapped" | "ai_suggested" | "confirmed" | "rejected";

interface QueueItem {
  lineItemId: number;
  description: string | null;
  lineTotalCents: number | null;
  mappingStatus: MappingStatus;
  roomId: number | null;
  aiSuggestedRoomId: number | null;
  aiSuggestedRoomName: string | null;
  aiSuggestedCategory: string | null;
  mappingConfidence: number | null;
  estimateId: number | null;
  company: { id: number; name: string | null } | null;
  revision: { id: number; revisionNumber: number | null } | null;
}

interface QueueResponse {
  items: QueueItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface AiCandidate {
  roomId: number;
  roomName: string | null;
  confidence: number;
  reasoning: string;
}

interface AiSuggestResponse {
  lineItemId: number;
  candidates: AiCandidate[];
  suggestedCategory: string | null;
}

const LIMIT = 50;

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

function statusVariant(status: MappingStatus): "outline" | "secondary" {
  return status === "ai_suggested" ? "secondary" : "outline";
}

export function EstimateReconcileApp() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [selectedRoom, setSelectedRoom] = useState<Record<number, number | null>>({});
  const [candidates, setCandidates] = useState<Record<number, AiCandidate[]>>({});
  const [suggestingId, setSuggestingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadQueue = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<QueueResponse>(
        `/api/estimates/reconcile/queue?limit=${LIMIT}&offset=${nextOffset}`,
      );
      setItems(data.items);
      setHasMore(data.hasMore);
      setOffset(nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue(0);
  }, [loadQueue]);

  async function handleAiSuggest(lineItemId: number) {
    setSuggestingId(lineItemId);
    try {
      const data = await api<AiSuggestResponse>(
        `/api/estimates/line-items/${lineItemId}/ai-suggest`,
        { method: "POST" },
      );
      setCandidates((prev) => ({ ...prev, [lineItemId]: data.candidates }));
      const top = data.candidates[0];
      if (top) {
        setSelectedRoom((prev) => ({ ...prev, [lineItemId]: top.roomId }));
      } else {
        toast.info("AI found no confident room match for this line.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI suggestion failed");
    } finally {
      setSuggestingId(null);
    }
  }

  async function handleConfirm(lineItemId: number) {
    const item = items.find((it) => it.lineItemId === lineItemId);
    const roomId = selectedRoom[lineItemId] ?? item?.roomId ?? item?.aiSuggestedRoomId ?? null;
    if (roomId == null) {
      toast.error("Pick a room before confirming.");
      return;
    }
    setSavingId(lineItemId);
    try {
      await api(`/api/estimates/line-items/${lineItemId}/reconcile`, {
        method: "PATCH",
        body: JSON.stringify({ roomId, mappingStatus: "confirmed" }),
      });
      toast.success("Mapping confirmed.");
      void loadQueue(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to confirm mapping");
    } finally {
      setSavingId(null);
    }
  }

  async function handleReject(lineItemId: number) {
    setSavingId(lineItemId);
    try {
      await api(`/api/estimates/line-items/${lineItemId}/reconcile`, {
        method: "PATCH",
        body: JSON.stringify({ mappingStatus: "rejected" }),
      });
      toast.success("Mapping rejected.");
      void loadQueue(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject mapping");
    } finally {
      setSavingId(null);
    }
  }

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Spinner className="mr-2 size-5" />
        Loading reconciliation queue…
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          Nothing to reconcile.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => {
        const rowCandidates = candidates[item.lineItemId];
        const roomId =
          selectedRoom[item.lineItemId] ?? item.roomId ?? item.aiSuggestedRoomId ?? null;
        const busy = savingId === item.lineItemId;

        return (
          <Card key={item.lineItemId}>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.description ?? "(no description)"}</p>
                <p className="text-xs text-muted-foreground">
                  {item.company?.name ?? "Unknown company"}
                  {item.revision?.revisionNumber != null
                    ? ` · rev ${item.revision.revisionNumber}`
                    : ""}
                  {item.estimateId != null ? ` · estimate #${item.estimateId}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={statusVariant(item.mappingStatus)}>{item.mappingStatus}</Badge>
                <span className="font-semibold">{formatCents(item.lineTotalCents)}</span>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              {item.aiSuggestedRoomName && !rowCandidates ? (
                <p className="text-sm text-muted-foreground">
                  Previously staged: <span className="font-medium">{item.aiSuggestedRoomName}</span>
                  {item.mappingConfidence != null
                    ? ` (${Math.round(item.mappingConfidence * 100)}%)`
                    : ""}
                </p>
              ) : null}

              {rowCandidates && rowCandidates.length > 0 ? (
                <ul className="flex flex-col gap-2" aria-label="AI room candidates">
                  {rowCandidates.map((cand) => (
                    <li key={cand.roomId}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedRoom((prev) => ({ ...prev, [item.lineItemId]: cand.roomId }))
                        }
                        aria-pressed={roomId === cand.roomId}
                        className="flex w-full flex-col gap-1 rounded-lg border border-border/60 p-3 text-left text-sm transition-colors hover:bg-muted aria-[pressed=true]:border-ring aria-[pressed=true]:bg-muted"
                      >
                        <span className="flex items-center justify-between gap-2 font-medium">
                          {cand.roomName ?? `Room ${cand.roomId}`}
                          <span className="text-xs font-normal text-muted-foreground">
                            {Math.round(cand.confidence * 100)}% confidence
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">{cand.reasoning}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleAiSuggest(item.lineItemId)}
                  disabled={suggestingId === item.lineItemId}
                >
                  {suggestingId === item.lineItemId ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  AI suggest
                </Button>

                <RoomSelect
                  className="max-w-64"
                  value={roomId}
                  onChange={(next) =>
                    setSelectedRoom((prev) => ({ ...prev, [item.lineItemId]: next }))
                  }
                  aria-label={`Room for line item ${item.lineItemId}`}
                />

                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleConfirm(item.lineItemId)}
                  disabled={busy || !roomId}
                >
                  <Check className="size-4" />
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleReject(item.lineItemId)}
                  disabled={busy}
                >
                  <X className="size-4" />
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {items.length} item{items.length === 1 ? "" : "s"} from offset {offset}.
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => void loadQueue(Math.max(0, offset - LIMIT))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasMore || loading}
            onClick={() => void loadQueue(offset + LIMIT)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

export default EstimateReconcileApp;
