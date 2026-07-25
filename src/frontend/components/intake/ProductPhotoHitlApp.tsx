/**
 * @fileoverview ProductPhotoHitlApp — Phase E HITL walkthrough, mounted at
 * /admin/shopping/product-photo-hitl. "Compare then confirm": a bucket picker,
 * a grid of that bucket's candidate product matches to compare, and a full-card
 * dialog per candidate for reaction (match / like / stars / voice or typed) and
 * confirm / reject. Monolith dark; every failure → sonner toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ImageOff, Mic, Square, Star, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/components/products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

interface QueueBucket {
  bucketId: number;
  total: number;
  pending: number;
  confirmed: number;
  label: string | null;
  bucketStatus: string;
  showroomId: number | null;
  showroomName: string | null;
}

interface ReactionSummary {
  summary?: string | null;
  likes?: string[] | null;
  dislikes?: string[] | null;
  sentiment?: string | null;
}

interface Candidate {
  id: number;
  bucketId: number;
  rank: number;
  confidence: number | null;
  brandNameRaw: string | null;
  productName: string | null;
  modelNumber: string | null;
  productUrl: string | null;
  category: string | null;
  style: string | null;
  priceText: string | null;
  salePriceText: string | null;
  imageSourceUrls: string[] | null;
  pdfSourceUrls: string[] | null;
  rationale: string | null;
  isMatch: boolean | null;
  liked: boolean | null;
  stars: number | null;
  reactionTranscript: string | null;
  reactionSummary: ReactionSummary | null;
  status: "pending" | "confirmed" | "rejected";
  confirmedProductId: number | null;
}

const statusTone: Record<Candidate["status"], string> = {
  pending: "border-amber-500/40 text-amber-300",
  confirmed: "border-emerald-500/40 text-emerald-300",
  rejected: "border-rose-500/40 text-rose-300",
};

export function ProductPhotoHitlApp() {
  const [buckets, setBuckets] = useState<QueueBucket[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [active, setActive] = useState<Candidate | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const res = await api<{ buckets: QueueBucket[] }>("/api/intake/candidate-queue");
      setBuckets(res.buckets ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load review queue");
      setBuckets([]);
    }
  }, []);

  const loadCandidates = useCallback(async (bucketId: number) => {
    setCandidates(null);
    try {
      const res = await api<{ candidates: Candidate[] }>(`/api/intake/buckets/${bucketId}/candidates`);
      setCandidates(res.candidates ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load candidates");
      setCandidates([]);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const openBucket = useCallback(
    (bucketId: number) => {
      setSelected(bucketId);
      void loadCandidates(bucketId);
    },
    [loadCandidates],
  );

  // After a mutation, refresh the open candidate list + the queue counts, and
  // keep the dialog in sync with the freshest row.
  const refresh = useCallback(
    async (bucketId: number, keepActiveId?: number) => {
      const res = await api<{ candidates: Candidate[] }>(`/api/intake/buckets/${bucketId}/candidates`).catch(() => null);
      if (res) {
        setCandidates(res.candidates ?? []);
        if (keepActiveId != null) setActive(res.candidates?.find((x) => x.id === keepActiveId) ?? null);
      }
      void loadQueue();
    },
    [loadQueue],
  );

  const selectedBucket = useMemo(
    () => buckets?.find((b) => b.bucketId === selected) ?? null,
    [buckets, selected],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 text-zinc-100">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Product-Photo Review</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Compare each photo bucket&rsquo;s candidate matches, react, and confirm the right one.
        </p>
      </header>

      {selected == null ? (
        <QueueList buckets={buckets} onOpen={openBucket} />
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setCandidates(null);
            }}
            className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
          >
            <ChevronLeft className="size-4" /> All buckets
          </button>
          <h2 className="mb-4 text-lg font-medium">
            {selectedBucket?.label ?? `Bucket #${selected}`}
            {selectedBucket?.showroomName ? (
              <span className="ml-2 text-sm font-normal text-zinc-500">{selectedBucket.showroomName}</span>
            ) : null}
          </h2>
          <CandidateGrid candidates={candidates} onOpen={setActive} />
        </>
      )}

      {active ? (
        <CandidateDialog
          candidate={active}
          onClose={() => setActive(null)}
          onChanged={(id) => selected != null && refresh(selected, id)}
        />
      ) : null}
    </div>
  );
}

function QueueList({ buckets, onOpen }: { buckets: QueueBucket[] | null; onOpen: (id: number) => void }) {
  if (buckets == null) return <p className="text-sm text-zinc-500">Loading review queue…</p>;
  if (buckets.length === 0)
    return (
      <Card className="border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-400">
        No buckets with candidates yet. Process a photo bucket to generate matches.
      </Card>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {buckets.map((b) => (
        <button
          key={b.bucketId}
          type="button"
          onClick={() => onOpen(b.bucketId)}
          className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-zinc-100">{b.label ?? `Bucket #${b.bucketId}`}</span>
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              {b.total} match{b.total === 1 ? "" : "es"}
            </Badge>
          </div>
          {b.showroomName ? <p className="mt-1 text-xs text-zinc-500">{b.showroomName}</p> : null}
          <div className="mt-3 flex gap-2 text-xs text-zinc-400">
            {b.pending > 0 ? <span className="text-amber-300">{b.pending} pending</span> : null}
            {b.confirmed > 0 ? <span className="text-emerald-300">{b.confirmed} confirmed</span> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

function CandidateGrid({
  candidates,
  onOpen,
}: {
  candidates: Candidate[] | null;
  onOpen: (c: Candidate) => void;
}) {
  if (candidates == null) return <p className="text-sm text-zinc-500">Loading candidates…</p>;
  if (candidates.length === 0)
    return <p className="text-sm text-zinc-500">This bucket produced no candidates.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {candidates.map((cand) => {
        const img = cand.imageSourceUrls?.[0] ?? null;
        return (
          <button
            key={cand.id}
            type="button"
            onClick={() => onOpen(cand)}
            className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 text-left transition hover:border-zinc-600"
          >
            <div className="flex aspect-video items-center justify-center bg-zinc-950">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <ImageOff className="size-8 text-zinc-700" />
              )}
            </div>
            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-zinc-100">
                  {cand.productName ?? "Unnamed product"}
                </span>
                <Badge variant="outline" className={statusTone[cand.status]}>
                  {cand.status}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {[cand.brandNameRaw, cand.modelNumber].filter(Boolean).join(" · ") || "—"}
              </p>
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                <span>{cand.priceText ?? "price unknown"}</span>
                {cand.stars ? <StarRow value={cand.stars} readOnly /> : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function StarRow({
  value,
  onChange,
  readOnly,
}: {
  value: number | null;
  onChange?: (n: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(n)}
          className={readOnly ? "" : "cursor-pointer"}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
        >
          <Star
            className={`size-4 ${value != null && n <= value ? "fill-amber-400 text-amber-400" : "text-zinc-600"}`}
          />
        </button>
      ))}
    </div>
  );
}

function CandidateDialog({
  candidate,
  onClose,
  onChanged,
}: {
  candidate: Candidate;
  onClose: () => void;
  onChanged: (id: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [reactionText, setReactionText] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const images = candidate.imageSourceUrls ?? [];
  const locked = candidate.status !== "pending";

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        await api(`/api/intake/candidates/${candidate.id}/reaction`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        onChanged(candidate.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save reaction");
      } finally {
        setBusy(false);
      }
    },
    [candidate.id, onChanged],
  );

  const sendText = useCallback(async () => {
    const transcript = reactionText.trim();
    if (!transcript) return;
    setBusy(true);
    try {
      await api(`/api/intake/candidates/${candidate.id}/voice-reaction`, {
        method: "POST",
        body: JSON.stringify({ transcript }),
      });
      setReactionText("");
      toast.success("Reaction saved & summarized");
      onChanged(candidate.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save reaction");
    } finally {
      setBusy(false);
    }
  }, [candidate.id, onChanged, reactionText]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size > 0 && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const dataUrl: string = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onloadend = () => resolve(String(fr.result));
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        const audioBase64 = dataUrl.split(",")[1] ?? "";
        setBusy(true);
        try {
          await api(`/api/intake/candidates/${candidate.id}/voice-reaction`, {
            method: "POST",
            body: JSON.stringify({ audioBase64 }),
          });
          toast.success("Voice reaction transcribed & summarized");
          onChanged(candidate.id);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Transcription failed");
        } finally {
          setBusy(false);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Microphone unavailable — type your reaction instead");
    }
  }, [candidate.id, onChanged, recording]);

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api<{ productId: number }>(`/api/intake/candidates/${candidate.id}/confirm`, { method: "POST" });
      toast.success(`Confirmed → product #${res.productId}`);
      onChanged(candidate.id);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  }, [candidate.id, onChanged, onClose]);

  const reject = useCallback(async () => {
    setBusy(true);
    try {
      await api(`/api/intake/candidates/${candidate.id}/reject`, { method: "POST" });
      toast.success("Rejected (kept for style signal)");
      onChanged(candidate.id);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  }, [candidate.id, onChanged, onClose]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="pr-8">
            {candidate.productName ?? "Unnamed product"}
            <Badge variant="outline" className={`ml-2 align-middle ${statusTone[candidate.status]}`}>
              {candidate.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Image carousel over staged source URLs */}
        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-zinc-900">
          {images.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={images[imgIdx]} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-zinc-600">
              <ImageOff className="size-8" />
              <span className="text-xs">No staged product photos</span>
            </div>
          )}
        </div>
        {images.length > 1 ? (
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-400">
            <Button variant="outline" size="sm" onClick={() => setImgIdx((i) => (i - 1 + images.length) % images.length)}>
              Prev
            </Button>
            <span>
              {imgIdx + 1} / {images.length}
            </span>
            <Button variant="outline" size="sm" onClick={() => setImgIdx((i) => (i + 1) % images.length)}>
              Next
            </Button>
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Detail label="Brand" value={candidate.brandNameRaw} />
          <Detail label="Model" value={candidate.modelNumber} />
          <Detail label="Price" value={candidate.priceText} />
          <Detail label="Sale" value={candidate.salePriceText} />
          <Detail label="Category" value={candidate.category} />
          <Detail label="Style" value={candidate.style} />
        </dl>
        {candidate.rationale ? <p className="text-sm text-zinc-400">{candidate.rationale}</p> : null}
        {candidate.productUrl ? (
          <a href={candidate.productUrl} target="_blank" rel="noreferrer" className="text-sm text-sky-400 hover:underline">
            View source page ↗
          </a>
        ) : null}

        <Separator className="bg-zinc-800" />

        {/* Reaction */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={candidate.isMatch === true ? "default" : "outline"}
              size="sm"
              disabled={busy}
              onClick={() => patch({ isMatch: !(candidate.isMatch === true) })}
            >
              <Check className="mr-1 size-4" /> Match
            </Button>
            <Button
              variant={candidate.liked === true ? "default" : "outline"}
              size="sm"
              disabled={busy}
              onClick={() => patch({ liked: true })}
            >
              <ThumbsUp className="mr-1 size-4" /> Like
            </Button>
            <Button
              variant={candidate.liked === false ? "default" : "outline"}
              size="sm"
              disabled={busy}
              onClick={() => patch({ liked: false })}
            >
              <ThumbsDown className="mr-1 size-4" /> Dislike
            </Button>
            <StarRow value={candidate.stars} onChange={(n) => patch({ stars: n })} />
          </div>

          <div className="flex items-start gap-2">
            <Textarea
              value={reactionText}
              onChange={(e) => setReactionText(e.target.value)}
              placeholder="Say (or type) what you think — finish, shape, price…"
              className="min-h-16 border-zinc-800 bg-zinc-900 text-sm"
            />
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={toggleRecording}>
                {recording ? <Square className="size-4 text-rose-400" /> : <Mic className="size-4" />}
              </Button>
              <Button size="sm" disabled={busy || !reactionText.trim()} onClick={sendText}>
                Save
              </Button>
            </div>
          </div>

          {candidate.reactionSummary?.summary ? (
            <p className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-xs text-zinc-300">
              <span className="text-zinc-500">Style read: </span>
              {candidate.reactionSummary.summary}
            </p>
          ) : null}
        </div>

        <Separator className="bg-zinc-800" />

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={busy || locked} onClick={reject}>
            <X className="mr-1 size-4" /> Reject
          </Button>
          <Button size="sm" disabled={busy || locked} onClick={confirm}>
            <Check className="mr-1 size-4" /> Confirm as product
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-200">{value ?? "—"}</dd>
    </>
  );
}
