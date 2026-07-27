/**
 * @fileoverview Visit Logs workspace — detail / finalize island (0032 V2c).
 *
 * Loads one visit, shows the GPS evidence, the editor, and the store's other
 * visits. Sticky bar: Save draft (status→DRAFT) · Submit (status→SUBMITTED) ·
 * Delete. Never blocks — a staged row can be saved as a draft.
 */
import { ArrowLeft, Compass, Loader2, Save, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { deleteVisitLog, getVisitLog, listVisitLogs, updateVisitLog, type VisitLogInput } from "./api";
import { GpsEvidence } from "./GpsEvidence";
import { SourceBadge, VisitStatusBadge } from "./Badges";
import { VisitCard } from "./VisitCard";
import { VisitLogEditor, type EditorDraft } from "./VisitLogEditor";
import type { VisitLog } from "./types";

function draftFrom(v: VisitLog): EditorDraft {
  return {
    storeId: v.storeId,
    visitType: v.visitType,
    rating: v.rating ?? 0,
    notesMarkdown: v.notesMarkdown ?? "",
    notesHtml: v.notesHtml ?? "",
    arrivalAt: v.arrivalAt,
    departureAt: v.departureAt,
  };
}

function toInput(d: EditorDraft): VisitLogInput {
  return {
    storeId: d.storeId,
    visitType: d.visitType,
    rating: d.rating > 0 ? d.rating : null,
    notesMarkdown: d.notesMarkdown || null,
    notesHtml: d.notesHtml || null,
    arrivalAt: d.arrivalAt ?? undefined,
    departureAt: d.departureAt ?? undefined,
  };
}

export function VisitLogDetailApp({ id }: { id: number }) {
  const [visit, setVisit] = useState<VisitLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [others, setOthers] = useState<VisitLog[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const v = await getVisitLog(id);
      setVisit(v);
      setDraft(draftFrom(v));
      if (v.storeId != null) {
        const list = await listVisitLogs({ storeId: v.storeId });
        setOthers(list.filter((o) => o.id !== v.id));
      } else {
        setOthers([]);
      }
    } catch (e) {
      console.error("[visits/detail] load", e);
      toast.error(e instanceof Error ? e.message : "Could not load visit");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback((p: Partial<EditorDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
  }, []);

  const save = useCallback(
    async (status: "DRAFT" | "SUBMITTED") => {
      if (!draft) return;
      if (status === "SUBMITTED" && draft.storeId == null) {
        toast.error("Bind a showroom before submitting");
        return;
      }
      setSaving(true);
      try {
        await updateVisitLog(id, { ...toInput(draft), status });
        toast.success(status === "SUBMITTED" ? "Visit submitted" : "Draft saved");
        if (status === "SUBMITTED") {
          window.location.href = "/admin/shopping/showrooms/visitlogs";
          return;
        }
        await load();
      } catch (e) {
        console.error("[visits/detail] save", e);
        toast.error(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [draft, id, load],
  );

  const remove = useCallback(async () => {
    if (!window.confirm("Delete this visit log? This cannot be undone.")) return;
    setSaving(true);
    try {
      await deleteVisitLog(id);
      toast.success("Visit deleted");
      window.location.href = "/admin/shopping/showrooms/visitlogs";
    } catch (e) {
      console.error("[visits/detail] delete", e);
      toast.error(e instanceof Error ? e.message : "Delete failed");
      setSaving(false);
    }
  }, [id]);

  const title = useMemo(
    () => visit?.storeName ?? (visit?.storeId == null ? "Unbound showroom" : `Store #${visit?.storeId}`),
    [visit],
  );

  if (loading || !visit || !draft) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <a
        href="/admin/shopping/showrooms/visitlogs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All visit logs
      </a>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <VisitStatusBadge status={visit.status} />
          <SourceBadge source={visit.gpsSource} />
        </div>
      </div>

      {visit.hitlQueueId != null && (
        <a
          href="/admin/shopping/showrooms/hitl"
          className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-4 py-3 text-sm text-violet-300 ring-1 ring-violet-500/30 hover:bg-violet-500/15"
        >
          <Compass className="size-4" />
          This visit came from a park-time discovery — review it in Park-Finds.
        </a>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="order-2 lg:order-1">
          <VisitLogEditor draft={draft} onChange={patch} showStore />
        </div>
        <div className="order-1 space-y-4 lg:order-2">
          <GpsEvidence
            latitude={visit.latitude}
            longitude={visit.longitude}
            matchDistanceM={visit.matchDistanceM}
            capturedAt={visit.arrivalAt}
            source={visit.gpsSource}
          />
          {others.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Other visits to this store
              </p>
              {others.slice(0, 5).map((o) => (
                <VisitCard key={o.id} visit={o} hideStore />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-2 px-4 py-3">
          <Button variant="ghost" size="sm" className="gap-1.5 text-destructive" onClick={remove} disabled={saving}>
            <Trash2 className="size-4" />
            Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => save("DRAFT")} disabled={saving}>
              <Save className="size-4" />
              Save draft
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => save("SUBMITTED")} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Submit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VisitLogDetailApp;
