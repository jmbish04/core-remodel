/**
 * @fileoverview NoteEditorPage — the dedicated full-page note editor.
 *
 * A single note-type-agnostic surface for creating/editing a note: a large
 * borderless title (with an in-field Sparkles button that auto-generates the
 * title from the document via Workers AI), a full-height PlateJS body, an
 * optional searchable tag multi-select, and a sticky Save/Cancel action bar with
 * an unsaved-changes guard.
 *
 * All wire concerns are delegated to a per-type adapter (`adapters.ts`) selected
 * from the URL `type` param, so this component never knows which API it hits.
 *
 * URL params (read from `window.location.search`):
 *   - type      'showroom' | 'company'   (required; invalid → error state)
 *   - entityId  string                   (required)
 *   - noteId    string?                  (absent → create mode)
 *   - return    string?                  (path to return to; must start with '/'
 *                                         to avoid open redirects; else adapter
 *                                         default)
 *   - showTags  '0' | '1'?               (override the adapter's tagsEnabled)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Save,
  Sparkles,
  Tag as TagIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Descendant } from "slate";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OverviewNoteEditor } from "@/components/showroom/OverviewNoteEditor";
import { slateToText } from "@/components/companies/crm/shared";
import { cn } from "@/lib/utils";

import {
  getAdapter,
  isNoteType,
  type HtmlMarkdownValue,
  type NoteAdapter,
  type SavePayload,
} from "./adapters";
import { SlateNoteEditor } from "./SlateNoteEditor";
import { TagMultiSelect } from "./TagMultiSelect";

// ─── URL param parsing ──────────────────────────────────────────────────────────

interface ParsedParams {
  type: string | null;
  entityId: string | null;
  noteId: string | null;
  returnTo: string | null;
  showTagsOverride: boolean | null;
}

function parseParams(): ParsedParams {
  if (typeof window === "undefined") {
    return { type: null, entityId: null, noteId: null, returnTo: null, showTagsOverride: null };
  }
  const q = new URLSearchParams(window.location.search);
  const rawReturn = q.get("return");
  // Open-redirect guard: only accept same-origin absolute PATHS ("/…"), never
  // protocol-relative ("//evil") or absolute URLs.
  const returnTo =
    rawReturn && rawReturn.startsWith("/") && !rawReturn.startsWith("//")
      ? rawReturn
      : null;
  const showTagsRaw = q.get("showTags");
  const showTagsOverride =
    showTagsRaw === "1" ? true : showTagsRaw === "0" ? false : null;
  return {
    type: q.get("type"),
    entityId: q.get("entityId"),
    noteId: q.get("noteId"),
    returnTo,
    showTagsOverride,
  };
}

// ─── Title generation ───────────────────────────────────────────────────────────

async function generateTitle(content: string): Promise<string> {
  const res = await fetch("/api/notes/generate-title", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Title generation failed (${res.status})`);
  }
  const payload = (await res.json()) as { title?: string };
  const title = (payload.title ?? "").trim();
  if (!title) throw new Error("The model returned an empty title");
  return title;
}

// ─── Component ──────────────────────────────────────────────────────────────────

type LoadState = "loading" | "ready" | "error";

export function NoteEditorPage() {
  const params = useMemo(parseParams, []);
  const adapter: NoteAdapter | null =
    isNoteType(params.type) ? getAdapter(params.type) : null;
  const isEdit = Boolean(params.noteId);
  const showTags =
    adapter != null &&
    (params.showTagsOverride ?? adapter.tagsEnabled);

  const returnTo = useMemo(() => {
    if (!adapter) return "/admin";
    if (params.returnTo) return params.returnTo;
    return adapter.defaultReturn(params.entityId ?? "");
  }, [adapter, params.returnTo, params.entityId]);

  // ── Field state ───────────────────────────────────────────────────────────────
  const [loadState, setLoadState] = useState<LoadState>(
    adapter && params.entityId ? "loading" : "error",
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  // Content state — one branch per content mode. The plain-text mirror feeds the
  // title generator regardless of mode.
  const [htmlMd, setHtmlMd] = useState<HtmlMarkdownValue>({ html: "", markdown: "" });
  const [slate, setSlate] = useState<Descendant[]>([]);
  const [plainText, setPlainText] = useState("");

  // Seed values for the editors (only known after load). `editorKey` gates the
  // Plate editor rebuild so we mount editors with the loaded content.
  const [seed, setSeed] = useState<{
    html: string | null;
    markdown: string | null;
    slate: Descendant[];
  }>({ html: null, markdown: null, slate: [] });

  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Dirty tracking + navigation guard.
  const dirtyRef = useRef(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  // ── Load existing note (edit) or initialize (create) ───────────────────────────
  useEffect(() => {
    if (!adapter || !params.entityId) return;
    const entityId = params.entityId;
    const noteId = params.noteId;
    let cancelled = false;
    void (async () => {
      setLoadState("loading");
      try {
        if (isEdit && noteId) {
          const loaded = await adapter.load(entityId, noteId);
          if (cancelled) return;
          setTitle(loaded.title);
          setTags(loaded.tags);
          if (adapter.contentMode === "html-markdown") {
            const hm = loaded.htmlMarkdown ?? { html: "", markdown: "" };
            setHtmlMd(hm);
            setSeed({ html: hm.html, markdown: hm.markdown, slate: [] });
          } else {
            const s = loaded.slate ?? [];
            setSlate(s);
            setPlainText(slateToText(s));
            setSeed({ html: null, markdown: null, slate: s });
          }
        } else {
          // Create mode — blank editors.
          setSeed({ html: null, markdown: null, slate: [] });
        }
        if (!cancelled) setLoadState("ready");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load note";
        setLoadError(msg);
        setLoadState("error");
        toast.error(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, params.entityId, params.noteId, isEdit]);

  // ── Load tag options (once, when tags are shown) ───────────────────────────────
  useEffect(() => {
    if (!adapter || !showTags) return;
    let cancelled = false;
    void (async () => {
      setTagsLoading(true);
      try {
        const opts = await adapter.fetchTagOptions();
        if (!cancelled) setTagOptions(opts);
      } catch (e) {
        // Non-fatal: the widget still allows create-on-the-fly.
        console.error("[notes/tag-options]", e);
      } finally {
        if (!cancelled) setTagsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, showTags]);

  // ── beforeunload guard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── Editor change handlers ──────────────────────────────────────────────────────
  const onHtmlMdChange = useCallback(
    (v: HtmlMarkdownValue) => {
      setHtmlMd(v);
      setPlainText(v.markdown);
      markDirty();
    },
    [markDirty],
  );

  const onSlateChange = useCallback(
    (v: Descendant[]) => {
      setSlate(v);
      setPlainText(slateToText(v));
      markDirty();
    },
    [markDirty],
  );

  const onTitleChange = useCallback(
    (v: string) => {
      setTitle(v);
      markDirty();
    },
    [markDirty],
  );

  const onTagsChange = useCallback(
    (next: string[]) => {
      setTags(next);
      markDirty();
    },
    [markDirty],
  );

  // ── Sparkles: generate title from content ──────────────────────────────────────
  const contentEmpty = plainText.trim().length === 0;

  const handleGenerateTitle = useCallback(async () => {
    if (contentEmpty || generating) return;
    setGenerating(true);
    try {
      const next = await generateTitle(plainText.trim());
      setTitle(next);
      markDirty();
      toast.success("Title generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate title");
    } finally {
      setGenerating(false);
    }
  }, [contentEmpty, generating, plainText, markDirty]);

  // ── Save ────────────────────────────────────────────────────────────────────────
  const navigateBack = useCallback(() => {
    dirtyRef.current = false;
    window.location.assign(returnTo);
  }, [returnTo]);

  const handleSave = useCallback(async () => {
    if (!adapter || !params.entityId) return;
    const trimmedTitle = title.trim();
    // Company notes require a title; showroom notes accept title OR content.
    if (adapter.contentMode === "slate-json" && !trimmedTitle) {
      toast.error("Note title is required");
      return;
    }
    if (!trimmedTitle && contentEmpty) {
      toast.error("Add a title or some content before saving");
      return;
    }

    setSaving(true);
    try {
      const payload: SavePayload = {
        title: trimmedTitle,
        tags,
        ...(adapter.contentMode === "html-markdown"
          ? { htmlMarkdown: htmlMd }
          : { slate }),
      };
      if (isEdit && params.noteId) {
        await adapter.update(params.entityId, params.noteId, payload);
      } else {
        await adapter.create(params.entityId, payload);
      }
      toast.success(isEdit ? "Note updated" : "Note saved");
      navigateBack();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save note");
      setSaving(false);
    }
  }, [
    adapter,
    params.entityId,
    params.noteId,
    isEdit,
    title,
    tags,
    htmlMd,
    slate,
    contentEmpty,
    navigateBack,
  ]);

  // ── Cancel / back (guarded) ─────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (dirtyRef.current) {
      setConfirmLeaveOpen(true);
      return;
    }
    navigateBack();
  }, [navigateBack]);

  // ── Invalid config / error ──────────────────────────────────────────────────────
  if (!adapter || !params.entityId) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-16">
        <div className="rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
          <h1 className="text-lg font-semibold tracking-tight">Can’t open this note</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This note editor was opened without a valid note type or record. Head
            back and try again.
          </p>
          <Button className="mt-4" render={<a href="/admin" />}>
            Back to admin
          </Button>
        </div>
      </main>
    );
  }

  const entityContext = `${adapter.label} · ${
    isEdit ? "editing" : "new"
  }`;

  return (
    <main className="container mx-auto flex min-h-[calc(100svh-3.5rem)] max-w-4xl flex-col px-4 py-8 pb-28">
      {/* Header */}
      <header className="mb-6">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Back
        </button>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {isEdit ? "Edit note" : "New note"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{entityContext}</p>
      </header>

      {loadState === "loading" ? (
        <NoteEditorSkeleton />
      ) : loadState === "error" ? (
        <div className="rounded-xl bg-card p-8 text-center ring-1 ring-border/40">
          <p className="text-sm text-destructive">
            {loadError ?? "Failed to load this note."}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-5">
          {/* Title with in-field Sparkles generate button */}
          <div className="space-y-2">
            <InputGroup className="h-auto rounded-lg border-0 bg-card px-1 ring-1 ring-border/40 focus-within:ring-2 focus-within:ring-ring/50">
              <InputGroupInput
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Untitled note"
                aria-label="Note title"
                className="h-12 px-3 text-xl font-semibold tracking-tight placeholder:font-normal placeholder:text-muted-foreground/60"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={handleGenerateTitle}
                  disabled={contentEmpty || generating}
                  aria-label="Generate title from content"
                  title={
                    contentEmpty
                      ? "Add some content first"
                      : "Generate a title from the note content"
                  }
                >
                  {generating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>

          {/* Tags */}
          {showTags && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="size-3.5" /> Tags
              </label>
              <TagMultiSelect
                value={tags}
                onValueChange={onTagsChange}
                options={tagOptions}
                loading={tagsLoading}
              />
            </div>
          )}

          {/* Body editor */}
          <div className="flex flex-1 flex-col">
            {adapter.contentMode === "html-markdown" ? (
              <OverviewNoteEditor
                variant="page"
                initialHtml={seed.html}
                initialMarkdown={seed.markdown}
                onChange={onHtmlMdChange}
              />
            ) : (
              <SlateNoteEditor
                editorKey={`${params.type}:${params.noteId ?? "create"}`}
                initialValue={seed.slate}
                onChange={onSlateChange}
                placeholder="Write context, decisions, follow-ups…"
              />
            )}
          </div>
        </div>
      )}

      {/* Sticky action bar */}
      {loadState === "ready" && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/40 bg-background/95 backdrop-blur md:pl-64">
          <div className="container mx-auto flex max-w-4xl items-center justify-end gap-2 px-4 py-3">
            <Button variant="outline" onClick={handleBack} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-4" />
              )}
              {isEdit ? "Save changes" : "Save note"}
            </Button>
          </div>
        </div>
      )}

      {/* Unsaved-changes guard (Base UI Dialog — never window.confirm) */}
      <Dialog
        open={confirmLeaveOpen}
        onOpenChange={(next) => {
          if (saving) return;
          setConfirmLeaveOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>
              You have unsaved changes to this note. Leaving now will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLeaveOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmLeaveOpen(false);
                navigateBack();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────────

function NoteEditorSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="h-14 animate-pulse rounded-lg bg-card ring-1 ring-border/40" />
      <div className="h-9 w-full max-w-sm animate-pulse rounded-lg bg-card ring-1 ring-border/40" />
      <div
        className={cn(
          "min-h-[50vh] flex-1 animate-pulse rounded-lg bg-card ring-1 ring-border/40",
        )}
      />
    </div>
  );
}
