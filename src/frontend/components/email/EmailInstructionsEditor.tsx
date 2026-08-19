/**
 * @fileoverview EmailInstructionsEditor — admin island editing the single
 * vendor-email context/instructions doc (`GET`/`PUT /api/email/instructions`,
 * Task 3). Loads the stored markdown, seeds `OverviewNoteEditor` (`variant="page"`,
 * `initialMarkdown`), tracks `{ markdown, html }` from its `onChange`, and PUTs
 * on Save. Fetch/save wiring modeled on
 * `src/frontend/components/notes/NoteEditorPage.tsx` (the other full-page
 * OverviewNoteEditor round-trip in this repo), trimmed down: this doc has no
 * title, no tags, and always edits the one row — there is no create/edit mode.
 */

import { AlertCircle, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  OverviewNoteEditor,
  type OverviewNoteEditorValue,
} from "@/components/showroom/OverviewNoteEditor";
import { Button } from "@/components/ui/button";

type LoadState = "loading" | "ready" | "error";

interface InstructionsResponse {
  markdown: string;
  html: string;
  updatedAt: string | null;
}

export function EmailInstructionsEditor() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seedMarkdown, setSeedMarkdown] = useState<string | null>(null);
  const [value, setValue] = useState<OverviewNoteEditorValue>({ markdown: "", html: "" });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadState("loading");
      try {
        const res = await fetch("/api/email/instructions", { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to load instructions (${res.status})`);
        const data = (await res.json()) as InstructionsResponse;
        if (cancelled) return;
        setSeedMarkdown(data.markdown);
        setValue({ markdown: data.markdown, html: data.html });
        setSavedAt(data.updatedAt ? new Date(data.updatedAt) : null);
        setLoadState("ready");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load instructions";
        setLoadError(msg);
        setLoadState("error");
        toast.error(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/email/instructions", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to save instructions (${res.status})`);
      }
      setSavedAt(new Date());
      toast.success("Instructions saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save instructions");
    } finally {
      setSaving(false);
    }
  }, [value]);

  if (loadState === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
        <AlertCircle className="size-6 text-destructive" />
        <p className="text-sm text-destructive">{loadError ?? "Failed to load instructions."}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (loadState === "loading") {
    return <div className="min-h-[50vh] animate-pulse rounded-lg bg-card ring-1 ring-border/40" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {savedAt ? `Last saved ${savedAt.toLocaleString()}` : "Not saved yet"}
        </p>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 size-4" />
          )}
          Save
        </Button>
      </div>

      <OverviewNoteEditor variant="page" initialMarkdown={seedMarkdown} onChange={setValue} />
    </div>
  );
}
