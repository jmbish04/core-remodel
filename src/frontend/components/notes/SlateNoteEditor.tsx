/**
 * @fileoverview SlateNoteEditor — a controlled PlateJS editor emitting raw Slate
 * `Descendant[]` for the company (slate-json) note adapter.
 *
 * Mirrors the CompanyNotesTab in-dialog editor (BasicBlocks + BasicMarks) but
 * lifted into a reusable full-height surface for the dedicated note page. The
 * editor is re-created via the `[editorKey]` deps trick so switching notes never
 * leaks the previous document's content.
 *
 * Emits on every value change so the page can (a) persist the Slate JSON and
 * (b) derive plain text for AI title generation.
 */

import { useCallback, useMemo } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import { toggleList } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";
import { Bold, Heading2, Heading3, Italic, List, ListOrdered } from "lucide-react";
import type { Descendant } from "slate";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface SlateNoteEditorProps {
  /** Stable key so the editor rebuilds when the underlying note changes. */
  editorKey: string;
  initialValue: Descendant[];
  onChange: (value: Descendant[]) => void;
  placeholder?: string;
}

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

export function SlateNoteEditor({
  editorKey,
  initialValue,
  onChange,
  placeholder,
}: SlateNoteEditorProps) {
  const editor = usePlateEditor(
    {
      plugins: [BasicBlocksPlugin, BasicMarksPlugin, ListPlugin],
      value: initialValue as any,
    },
    [editorKey],
  );

  const marks = editor.api.marks() ?? {};
  const isBold = Boolean((marks as Record<string, unknown>).bold);
  const isItalic = Boolean((marks as Record<string, unknown>).italic);

  const emit = useCallback(
    (value: Descendant[]) => onChange(value),
    [onChange],
  );

  const toolbar = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg bg-card px-1.5 py-1 ring-1 ring-border/40">
        <ToolbarButton
          label="Bold"
          active={isBold}
          onClick={() => editor.tf.toggleMark("bold")}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={isItalic}
          onClick={() => editor.tf.toggleMark("italic")}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <Separator orientation="vertical" className="mx-1 h-5 bg-border/40" />
        <ToolbarButton label="Heading 2" onClick={() => editor.tf.toggleBlock("h2")}>
          <Heading2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Heading 3" onClick={() => editor.tf.toggleBlock("h3")}>
          <Heading3 className="size-4" />
        </ToolbarButton>
        <Separator orientation="vertical" className="mx-1 h-5 bg-border/40" />
        <ToolbarButton
          label="Bulleted list"
          onClick={() => toggleList(editor, { listStyleType: "disc" })}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          onClick={() => toggleList(editor, { listStyleType: "decimal" })}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
      </div>
    ),
    [editor, isBold, isItalic],
  );

  return (
    <div className="flex min-h-[50vh] flex-1 flex-col overflow-hidden rounded-lg ring-1 ring-border/40">
      <Plate
        editor={editor}
        onValueChange={({ value }) => emit(value as Descendant[])}
      >
        {toolbar}
        <PlateContent
          className="min-h-[50vh] flex-1 overflow-y-auto bg-background/60 px-4 py-3 text-sm leading-relaxed focus-visible:outline-none [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
          placeholder={placeholder ?? "Write your note…"}
        />
      </Plate>
    </div>
  );
}
