/**
 * @fileoverview Visit Logs workspace — new / create island (0032 V2c).
 *
 * A manual visit log (human-entered). Mirrors the MCP create_visit_log exactly:
 * store bind, visit_type, rating, arrival/departure, PlateJS notes. Save as draft
 * or submit straight away. POST /api/showroom-visit-logs.
 */
import { ArrowLeft, Loader2, Save, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { createVisitLog, type VisitLogInput } from "./api";
import { VisitLogEditor, type EditorDraft } from "./VisitLogEditor";

function nowIso(): string {
  return new Date().toISOString();
}

function initialDraft(): EditorDraft {
  return {
    storeId: null,
    visitType: "FULL_SESSION",
    rating: 0,
    notesMarkdown: "",
    notesHtml: "",
    arrivalAt: nowIso(),
    departureAt: null,
  };
}

function toInput(d: EditorDraft): VisitLogInput {
  return {
    storeId: d.storeId,
    visitType: d.visitType,
    rating: d.rating > 0 ? d.rating : null,
    notesMarkdown: d.notesMarkdown || null,
    notesHtml: d.notesHtml || null,
    gpsSource: "manual",
    arrivalAt: d.arrivalAt ?? undefined,
    departureAt: d.departureAt ?? undefined,
  };
}

export function VisitLogNewApp() {
  const [draft, setDraft] = useState<EditorDraft>(initialDraft);
  const [saving, setSaving] = useState(false);

  const patch = useCallback((p: Partial<EditorDraft>) => setDraft((prev) => ({ ...prev, ...p })), []);

  const create = useCallback(
    async (status: "DRAFT" | "SUBMITTED") => {
      if (status === "SUBMITTED" && draft.storeId == null) {
        toast.error("Bind a showroom before submitting");
        return;
      }
      setSaving(true);
      try {
        const id = await createVisitLog({ ...toInput(draft), status });
        toast.success(status === "SUBMITTED" ? "Visit submitted" : "Draft saved");
        window.location.href =
          status === "SUBMITTED"
            ? "/admin/shopping/showrooms/visitlogs"
            : `/admin/shopping/showrooms/visitlogs/${id}`;
      } catch (e) {
        console.error("[visits/new] create", e);
        toast.error(e instanceof Error ? e.message : "Could not create visit");
        setSaving(false);
      }
    },
    [draft],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <a
        href="/admin/shopping/showrooms/visitlogs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All visit logs
      </a>

      <VisitLogEditor draft={draft} onChange={patch} showStore />

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-end gap-2 px-4 py-3">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => create("DRAFT")} disabled={saving}>
            <Save className="size-4" />
            Save draft
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => create("SUBMITTED")} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

export default VisitLogNewApp;
