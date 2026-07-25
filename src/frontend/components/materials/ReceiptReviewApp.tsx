/**
 * @fileoverview Receipt → room review queue (0030).
 *
 * The deduction engine places a receipt's materials into rooms as a best guess
 * (premium toilet → primary, the identical pair → the two secondary baths) and
 * stages each as a proposal. This is where the owner reviews a receipt as a
 * WHOLE — sees the reasoning, swaps any room the engine got wrong, and confirms.
 * Confirming mints the material into the room and feeds the learning loop.
 *
 * Mirrors the ProductPhotoHitlApp HITL pattern: toast on every action, a
 * refetch after a mutation, all data from real endpoints (no mocks).
 *
 * Room swaps have two tiers, matching how the engine reasons: the dropdown lists
 * the ELIGIBLE candidate rooms (bathrooms, for a toilet) as the fast path, and an
 * "Other room…" entry opens a modal over EVERY active room — the escape hatch for
 * when the engine got it materially wrong. The resolve endpoint accepts any
 * active room, so the modal only widens what the UI offers; no server rule is
 * bypassed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, MapPin } from "lucide-react";

import { api } from "@/components/products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RoomSelect } from "@/components/ui/room-select";

// ── types (mirror RoomProposalView + RoomCandidate on the server) ────────────

interface RoomCandidate {
  roomId: number;
  roomName: string;
  kept: boolean;
  score: number;
  evidence: string;
}

interface Proposal {
  id: number;
  title: string;
  invoiceId: number | null;
  lineItemId: number | null;
  unitIndex: number;
  subcategoryName: string | null;
  application: string | null;
  status: string;
  confidence: number | null;
  proposedRoomId: number | null;
  proposedRoomName: string | null;
  candidates: RoomCandidate[];
  reasoningMarkdown: string | null;
}

interface RoomLite {
  id: number;
  name: string;
  floor: string | null;
}

/** A receipt = one invoice's worth of proposals, reviewed together. */
interface ReceiptGroup {
  invoiceId: number | null;
  key: string;
  proposals: Proposal[];
}

// ── data helpers ─────────────────────────────────────────────────────────────

function groupByReceipt(proposals: Proposal[]): ReceiptGroup[] {
  const byKey = new Map<string, ReceiptGroup>();
  for (const p of proposals) {
    const key = p.invoiceId != null ? `inv-${p.invoiceId}` : "no-receipt";
    if (!byKey.has(key)) byKey.set(key, { invoiceId: p.invoiceId, key, proposals: [] });
    byKey.get(key)!.proposals.push(p);
  }
  for (const g of byKey.values()) {
    g.proposals.sort((a, b) => (a.lineItemId ?? 0) - (b.lineItemId ?? 0) || a.unitIndex - b.unitIndex);
  }
  return [...byKey.values()];
}

// ── the app ──────────────────────────────────────────────────────────────────

export function ReceiptReviewApp() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [roomsById, setRoomsById] = useState<Map<number, RoomLite>>(new Map());
  const [loading, setLoading] = useState(true);
  // The owner's current choice per proposal (starts at the engine's proposal).
  const [chosen, setChosen] = useState<Map<number, number | null>>(new Map());
  const [otherFor, setOtherFor] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const loadRooms = useCallback(async () => {
    try {
      const data = await api<{
        floors?: { name?: string; rooms?: { id: number; roomName?: string; displayName?: string }[] }[];
      }>("/api/rooms/catalog");
      const map = new Map<number, RoomLite>();
      for (const f of data.floors ?? []) {
        for (const r of f.rooms ?? []) {
          map.set(r.id, { id: r.id, name: r.displayName ?? r.roomName ?? `Room ${r.id}`, floor: f.name ?? null });
        }
      }
      setRoomsById(map);
    } catch (err) {
      console.error("[receipt-review] room catalog load failed:", err);
    }
  }, []);

  const loadProposals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ proposals: Proposal[] }>("/api/materials/room-proposals?status=staged");
      setProposals(data.proposals ?? []);
      setChosen((prev) => {
        const next = new Map(prev);
        for (const p of data.proposals ?? []) {
          if (!next.has(p.id)) next.set(p.id, p.proposedRoomId);
        }
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load the review queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRooms();
    void loadProposals();
  }, [loadRooms, loadProposals]);

  const receipts = useMemo(() => groupByReceipt(proposals), [proposals]);

  const chosenRoomLabel = useCallback(
    (p: Proposal): { name: string; floor: string | null } | null => {
      const roomId = chosen.get(p.id) ?? p.proposedRoomId;
      if (roomId == null) return null;
      const fromCatalog = roomsById.get(roomId);
      if (fromCatalog) return { name: fromCatalog.name, floor: fromCatalog.floor };
      const cand = p.candidates.find((c) => c.roomId === roomId);
      if (cand) return { name: cand.roomName, floor: null };
      if (roomId === p.proposedRoomId && p.proposedRoomName) return { name: p.proposedRoomName, floor: null };
      return { name: `Room ${roomId}`, floor: null };
    },
    [chosen, roomsById],
  );

  const setRoom = (proposalId: number, roomId: number | null) =>
    setChosen((prev) => new Map(prev).set(proposalId, roomId));

  const confirmReceipt = async (group: ReceiptGroup) => {
    const unplaced = group.proposals.filter((p) => (chosen.get(p.id) ?? p.proposedRoomId) == null);
    if (unplaced.length > 0) {
      toast.error(`Pick a room for ${unplaced.length} unplaced item(s) first.`);
      return;
    }
    setBusy((b) => new Set(b).add(group.key));
    let ok = 0;
    try {
      for (const p of group.proposals) {
        const roomId = chosen.get(p.id) ?? p.proposedRoomId;
        if (roomId == null) continue;
        await api(`/api/materials/room-proposals/${p.id}/resolve`, {
          method: "POST",
          body: JSON.stringify({ roomId }),
        });
        ok++;
      }
      toast.success(`Placed ${ok} material${ok === 1 ? "" : "s"} from this receipt.`);
      await loadProposals();
    } catch (err) {
      toast.error(
        `${err instanceof Error ? err.message : "Confirm failed"}${ok > 0 ? ` (${ok} placed before it failed)` : ""}`,
      );
      await loadProposals();
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(group.key);
        return n;
      });
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading the review queue…</p>;
  }

  if (receipts.length === 0) {
    return (
      <Card className="p-8 text-center">
        <MapPin className="mx-auto mb-3 size-6 text-muted-foreground" />
        <p className="font-medium">Nothing to review</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When a receipt arrives, the materials it places into rooms show up here for you to confirm.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {receipts.map((group) => (
        <Card key={group.key} className="overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
            <div>
              <div className="font-semibold">
                Receipt{" "}
                {group.invoiceId != null ? (
                  <span className="font-mono text-xs text-muted-foreground">invoice #{group.invoiceId}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">(no invoice)</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {group.proposals.length} item{group.proposals.length === 1 ? "" : "s"} to place
              </div>
            </div>
            <span className="flex-1" />
            <Badge variant="secondary">{group.proposals.length} to review</Badge>
          </div>

          {group.proposals.map((p) => (
            <ProposalRow
              key={p.id}
              proposal={p}
              chosen={chosenRoomLabel(p)}
              onPickCandidate={(roomId) => setRoom(p.id, roomId)}
              onOther={() => setOtherFor(p)}
              edited={(chosen.get(p.id) ?? p.proposedRoomId) !== p.proposedRoomId}
            />
          ))}

          <div className="flex items-center gap-2 bg-muted/30 px-5 py-3">
            <span className="flex-1" />
            <Button className="gap-1.5" disabled={busy.has(group.key)} onClick={() => void confirmReceipt(group)}>
              <Check className="size-4" />
              Confirm all {group.proposals.length}
            </Button>
          </div>
        </Card>
      ))}

      <p className="border-l-2 border-border/60 pl-3 text-sm text-muted-foreground">
        Confirming places each material in its room and teaches the system — the next receipt won&rsquo;t propose a
        room you&rsquo;ve already filled.
      </p>

      {/* Other-room modal — every active room, unfiltered. */}
      <Dialog open={otherFor != null} onOpenChange={(open) => !open && setOtherFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose any room</DialogTitle>
            <DialogDescription>
              The suggestions are just the likely rooms for a {otherFor?.subcategoryName?.toLowerCase() ?? "material"}.
              Pick any room in the house — use this when the system got it wrong.
            </DialogDescription>
          </DialogHeader>
          {otherFor && (
            <RoomSelect
              value={chosen.get(otherFor.id) ?? otherFor.proposedRoomId}
              onChange={(roomId) => {
                setRoom(otherFor.id, roomId);
                setOtherFor(null);
              }}
              placeholder="Search all rooms…"
              aria-label="Choose any room"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── one proposal row ─────────────────────────────────────────────────────────

function ProposalRow({
  proposal: p,
  chosen,
  onPickCandidate,
  onOther,
  edited,
}: {
  proposal: Proposal;
  chosen: { name: string; floor: string | null } | null;
  onPickCandidate: (roomId: number) => void;
  onOther: () => void;
  edited: boolean;
}) {
  const eligible = p.candidates.filter((c) => c.kept);
  const eliminated = p.candidates.filter((c) => !c.kept);

  return (
    <div className="border-b border-border/60 px-5 py-4 last:border-b-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{p.title}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {[p.subcategoryName, `unit ${p.unitIndex + 1}`].filter(Boolean).join(" · ")}
          </div>
          {p.application && (
            <div className="mt-1.5 inline-block rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.7rem] text-amber-500">
              {p.application}
            </div>
          )}
        </div>

        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <span className="text-xs text-muted-foreground">proposed room</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className={`min-w-52 justify-between gap-2 ${edited ? "border-amber-500/45" : ""}`}
                />
              }
            >
              <span className="truncate">
                {chosen ? (
                  <>
                    {chosen.name}
                    {chosen.floor && <span className="ml-1 text-xs text-muted-foreground">· {chosen.floor}</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">Pick a room</span>
                )}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Eligible rooms</DropdownMenuLabel>
              {eligible.length > 0 ? (
                eligible.map((c) => (
                  <DropdownMenuItem key={c.roomId} onSelect={() => onPickCandidate(c.roomId)}>
                    {c.roomName}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>No eligible rooms — use Other</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOther} className="text-amber-500 focus:text-amber-500">
                Other room…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {edited ? (
            <span className="text-xs text-amber-500">changed from the suggestion</span>
          ) : (
            p.confidence != null && (
              <span className="font-mono text-xs text-muted-foreground">
                confidence <span className="text-emerald-500">{p.confidence}%</span>
              </span>
            )
          )}
        </div>
      </div>

      {(p.reasoningMarkdown || p.candidates.length > 0) && (
        <Collapsible className="mt-3">
          <CollapsibleTrigger className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            ▸ Why this room
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {p.reasoningMarkdown && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm leading-relaxed">{p.reasoningMarkdown}</div>
            )}
            {(eligible.length > 0 || eliminated.length > 0) && (
              <div className="space-y-1 text-[0.8rem]">
                {eligible.map((c) => (
                  <div key={c.roomId} className="flex gap-2">
                    <span className="w-2 shrink-0 text-emerald-500">●</span>
                    <span className="w-36 shrink-0">{c.roomName}</span>
                    <span className="text-muted-foreground">{c.evidence || "eligible"}</span>
                  </div>
                ))}
                {eliminated.map((c) => (
                  <div key={c.roomId} className="flex gap-2 text-muted-foreground">
                    <span className="w-2 shrink-0">○</span>
                    <span className="w-36 shrink-0">{c.roomName}</span>
                    <span>{c.evidence || "eliminated"}</span>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
