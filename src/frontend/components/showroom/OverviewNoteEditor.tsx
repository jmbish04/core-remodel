/**
 * @fileoverview OverviewNoteEditor — a controlled PlateJS rich-text editor for
 * the showroom "overview note".
 *
 * Mirrors the editor setup used by ShoppingJournalApp / ProjectLogApp
 * (`usePlateEditor` from `platejs/react`) but adds the block/mark/list and
 * markdown plugins so the note supports headings, bold/italic and lists — and,
 * critically, so we can emit BOTH Markdown and HTML on every change.
 *
 * Serialization (Plate v53):
 *   - Markdown: `editor.api.markdown.serialize()` — provided by `MarkdownPlugin`
 *     from `@platejs/markdown`. This is the canonical v53 markdown API.
 *   - HTML: derived deterministically from that same Markdown string via a small
 *     scoped converter (`markdownToHtml`) covering exactly the marks/blocks this
 *     toolbar can produce (h1–h3, bold, italic, ordered/unordered lists, links,
 *     paragraphs). We deliberately do NOT pull in Plate's static `serializeHtml`
 *     renderer — it requires a parallel static-component registry and an async
 *     React render, which is heavyweight for the Cloudflare Worker bundle. The
 *     author here is the single trusted homeowner and the toolbar surface is
 *     fixed, so the scoped converter is both safe (it HTML-escapes text) and
 *     deterministic.
 *
 * Seeding: when `initialMarkdown` is provided we deserialize it to a Plate value
 * via the canonical v53 initial-content pattern — a `value` function on
 * `usePlateEditor` that calls `editor.api.markdown.deserialize(...)`.
 */

import { useCallback, useMemo } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { MarkdownPlugin } from "@platejs/markdown";
import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import { toggleList } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";
import { Bold, Heading2, Heading3, Italic, List, ListOrdered } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface OverviewNoteEditorValue {
  html: string;
  markdown: string;
}

interface OverviewNoteEditorProps {
  initialHtml?: string | null;
  initialMarkdown?: string | null;
  onChange: (value: OverviewNoteEditorValue) => void;
  editable?: boolean;
}

// ─── Markdown → HTML (scoped to this toolbar's feature set) ───────────────────

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline marks: bold (`**x**`/`__x__`), italic (`*x*`/`_x_`), links. */
function renderInline(raw: string): string {
  let out = escapeHtml(raw);
  // Links: [text](url). The url has already been entity-escaped by escapeHtml.
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );
  // Bold before italic so `**x**` isn't consumed by the single-char italic rule.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return out;
}

/**
 * Convert the Markdown emitted by Plate's serializer into a small, safe subset
 * of HTML. Supports h1–h3, unordered/ordered lists, and paragraphs; everything
 * else falls through as a paragraph. Text is HTML-escaped before inline marks
 * are applied.
 */
function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const listItems: string[] = [];

  const flushList = () => {
    if (listType && listItems.length) {
      blocks.push(`<${listType}>${listItems.join("")}</${listType}>`);
    }
    listType = null;
    listItems.length = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (unordered) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ordered) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    flushList();
    blocks.push(`<p>${renderInline(trimmed)}</p>`);
  }
  flushList();

  return blocks.join("\n");
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "size-8 text-muted-foreground hover:text-foreground",
        active && "bg-foreground/10 text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

// ─── Editor ─────────────────────────────────────────────────────────────────

export function OverviewNoteEditor({
  initialHtml: _initialHtml,
  initialMarkdown,
  onChange,
  editable = true,
}: OverviewNoteEditorProps) {
  const editor = usePlateEditor({
    plugins: [BasicBlocksPlugin, BasicMarksPlugin, ListPlugin, MarkdownPlugin],
    // Canonical v53 initial-content pattern: seed from markdown when present.
    // HTML is not a reliable Plate round-trip source, so markdown is the seed of
    // record; `initialHtml` is accepted for API symmetry only.
    value: (ed) => {
      const md = initialMarkdown?.trim();
      if (md) {
        try {
          const deserialized = ed.getApi(MarkdownPlugin).markdown.deserialize(md);
          if (Array.isArray(deserialized) && deserialized.length > 0) {
            return deserialized;
          }
        } catch (err) {
          console.error("[OverviewNoteEditor] markdown deserialize failed", err);
        }
      }
      return [{ type: "p", children: [{ text: "" }] }];
    },
  });

  const emit = useCallback(() => {
    try {
      const markdown = editor.api.markdown.serialize().trim();
      const html = markdownToHtml(markdown);
      onChange({ html, markdown });
    } catch (err) {
      console.error("[OverviewNoteEditor] serialize failed", err);
    }
  }, [editor, onChange]);

  const marks = editor.api.marks() ?? {};
  const isBold = Boolean((marks as Record<string, unknown>).bold);
  const isItalic = Boolean((marks as Record<string, unknown>).italic);

  const toolbar = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg bg-card px-1.5 py-1 ring-1 ring-border/40">
        <ToolbarButton
          label="Bold"
          active={isBold}
          onClick={() => {
            editor.tf.toggleMark("bold");
            emit();
          }}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={isItalic}
          onClick={() => {
            editor.tf.toggleMark("italic");
            emit();
          }}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <Separator orientation="vertical" className="mx-1 h-5 bg-border/40" />
        <ToolbarButton
          label="Heading 2"
          onClick={() => {
            editor.tf.toggleBlock("h2");
            emit();
          }}
        >
          <Heading2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 3"
          onClick={() => {
            editor.tf.toggleBlock("h3");
            emit();
          }}
        >
          <Heading3 className="size-4" />
        </ToolbarButton>
        <Separator orientation="vertical" className="mx-1 h-5 bg-border/40" />
        <ToolbarButton
          label="Bulleted list"
          onClick={() => {
            toggleList(editor, { listStyleType: "disc" });
            emit();
          }}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          onClick={() => {
            toggleList(editor, { listStyleType: "decimal" });
            emit();
          }}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
      </div>
    ),
    [editor, emit, isBold, isItalic],
  );

  if (editable === false) {
    return (
      <div className="rounded-lg bg-card p-2 ring-1 ring-border/40">
        <Plate editor={editor}>
          <PlateContent
            readOnly
            className="min-h-[80px] rounded-md bg-background/60 px-3 py-2 text-sm focus-visible:outline-none [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          />
        </Plate>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-border/40">
      <Plate editor={editor} onValueChange={emit}>
        {toolbar}
        <PlateContent
          className="min-h-[160px] max-h-[360px] overflow-y-auto bg-background/60 px-3 py-2.5 text-sm leading-relaxed focus-visible:outline-none [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          placeholder="Write your overview of this showroom — what they're known for, who to ask for, standout products…"
        />
      </Plate>
    </div>
  );
}
