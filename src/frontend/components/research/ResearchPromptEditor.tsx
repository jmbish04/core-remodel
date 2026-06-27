/**
 * @fileoverview Rich-text editor for composing a deep-research brief.
 *
 * Built on TipTap (StarterKit) with a small base-ui Button toolbar so it fits
 * the repo's base-ui shadcn primitives + dark Monolith theme. (The kibo-ui
 * editor is a radix component that would clobber the app's base-ui primitives,
 * so this is the compatible equivalent.) Emits the editor's plain text on every
 * change for the create request.
 */

import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ResearchPromptEditorProps {
  /** Controlled plain-text value (lets the parent clear/reset the editor). */
  value: string;
  /** Fired with the editor's plain-text content on each change. */
  onTextChange: (text: string) => void;
  disabled?: boolean;
}

/** A single toolbar toggle backed by the repo's base-ui Button. */
function ToolbarButton({
  editor,
  active,
  onClick,
  label,
  icon: Icon,
  disabled,
}: {
  editor: Editor | null;
  active: boolean;
  onClick: () => void;
  label: string;
  icon: typeof Bold;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || !editor}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "size-7 text-muted-foreground hover:text-foreground",
        active && "bg-muted/60 text-foreground",
      )}
    >
      <Icon className="size-3.5" />
    </Button>
  );
}

export function ResearchPromptEditor({
  value,
  onTextChange,
  disabled,
}: ResearchPromptEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
    ],
    editorProps: {
      attributes: {
        class: cn(
          "min-h-28 max-h-72 overflow-y-auto px-3 py-2.5 text-sm leading-relaxed outline-none",
          // Monolith prose: headings, lists, quotes, inline code.
          "[&_h2]:mt-1 [&_h2]:text-base [&_h2]:font-semibold",
          "[&_h3]:mt-1 [&_h3]:text-sm [&_h3]:font-semibold",
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
          "[&_code]:rounded [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        ),
      },
    },
    onUpdate: ({ editor: e }) => onTextChange(e.getText()),
  });

  // `useEditor`'s `editable` is only read on init — keep it in sync.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Sync external value changes (e.g. parent clears it after submit), guarding
  // against cursor jumps by only resetting when the text actually differs.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value !== editor.getText()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  // Re-render the toolbar on selection/content changes so active states update.
  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor?.isActive(name, attrs) ?? false;

  return (
    <div className="overflow-hidden rounded-lg bg-card ring-1 ring-border/40 focus-within:ring-border">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border/40 px-1.5 py-1">
        <ToolbarButton editor={editor} icon={Bold} label="Bold" active={isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()} disabled={disabled} />
        <ToolbarButton editor={editor} icon={Italic} label="Italic" active={isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()} disabled={disabled} />
        <ToolbarButton editor={editor} icon={Strikethrough} label="Strikethrough" active={isActive("strike")}
          onClick={() => editor?.chain().focus().toggleStrike().run()} disabled={disabled} />
        <span className="mx-1 h-4 w-px bg-border/50" />
        <ToolbarButton editor={editor} icon={Heading2} label="Heading 2" active={isActive("heading", { level: 2 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} disabled={disabled} />
        <ToolbarButton editor={editor} icon={Heading3} label="Heading 3" active={isActive("heading", { level: 3 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} disabled={disabled} />
        <span className="mx-1 h-4 w-px bg-border/50" />
        <ToolbarButton editor={editor} icon={List} label="Bullet list" active={isActive("bulletList")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()} disabled={disabled} />
        <ToolbarButton editor={editor} icon={ListOrdered} label="Ordered list" active={isActive("orderedList")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()} disabled={disabled} />
        <ToolbarButton editor={editor} icon={Quote} label="Quote" active={isActive("blockquote")}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()} disabled={disabled} />
        <ToolbarButton editor={editor} icon={Code} label="Inline code" active={isActive("code")}
          onClick={() => editor?.chain().focus().toggleCode().run()} disabled={disabled} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
