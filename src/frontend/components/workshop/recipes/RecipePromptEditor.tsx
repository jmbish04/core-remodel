// ---------------------------------------------------------------------------
// RecipePromptEditor — the PlateJS (markdown) prompt editor, mirroring the
// repo's editor pattern from clickup/ClickUpTaskModal.tsx (usePlateEditor +
// Plate + PlateContent with basic block/mark plugins). Emits plain text so the
// recipe params carry a simple prompt string. Optional — never required.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import type { Descendant } from "slate";

function textToDescendants(text: string): Descendant[] {
  if (!text || !text.trim()) {
    return [{ type: "p", children: [{ text: "" }] } as unknown as Descendant];
  }
  return text.split("\n").map(
    (line) =>
      ({ type: "p", children: [{ text: line }] }) as unknown as Descendant,
  );
}

function descendantsToText(nodes: Descendant[]): string {
  return nodes
    .map((node: unknown) => {
      const n = node as { children?: { text?: string }[]; text?: string };
      if (n.children) {
        return n.children.map((child) => child.text || "").join("");
      }
      return n.text || "";
    })
    .join("\n");
}

interface RecipePromptEditorProps {
  onChange: (text: string) => void;
  placeholder?: string;
}

export function RecipePromptEditor({
  onChange,
  placeholder,
}: RecipePromptEditorProps) {
  const editor = usePlateEditor({
    plugins: [BasicBlocksPlugin, BasicMarksPlugin],
    value: textToDescendants("") as unknown as never,
  });

  const handleChange = useCallback(
    ({ value }: { value: Descendant[] }) => {
      onChange(descendantsToText(value));
    },
    [onChange],
  );

  return (
    <div className="rounded-lg bg-background p-2 ring-1 ring-border/40 focus-within:ring-2 focus-within:ring-ring">
      <Plate editor={editor} onValueChange={handleChange}>
        <PlateContent
          className="max-h-[140px] min-h-[72px] overflow-y-auto rounded px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={placeholder ?? "Add a note (optional)…"}
        />
      </Plate>
    </div>
  );
}

export default RecipePromptEditor;
