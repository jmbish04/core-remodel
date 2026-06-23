/**
 * @fileoverview MindMap — a thin, dark-Monolith React wrapper around Mind Elixir.
 *
 * This mirrors the mindmapcn approach (https://github.com/SSShooter/mindmapcn),
 * which is a shadcn-style copy-in component over the `mind-elixir` engine. We
 * vendor a minimal wrapper here instead of pulling the shadcn registry so the
 * component lives in our codebase, uses our theme tokens, and ships no extra
 * peer deps beyond `mind-elixir`.
 *
 * Render-only: pass a Mind Elixir `nodeData` tree (root + children) and it
 * mounts a read-friendly, draggable mind map. Generate the tree from research
 * markdown via `markdownToMindmap` (./markdown-to-mindmap).
 */

import { useEffect, useRef } from "react";
import MindElixir, { type MindElixirData, type MindElixirInstance } from "mind-elixir";
import "mind-elixir/style.css";

export function MindMap({ data }: { data: MindElixirData }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<MindElixirInstance | null>(null);

  useEffect(() => {
    if (!elRef.current) return;

    const mind = new MindElixir({
      el: elRef.current,
      direction: MindElixir.SIDE,
      draggable: true,
      contextMenu: false,
      toolBar: true,
      keypress: true,
      // read-leaning: editing a generated map isn't the goal, exploration is
      editable: false,
      theme: {
        name: "monolith-dark",
        type: "dark",
        palette: [
          "#34d399", // emerald-400
          "#38bdf8", // sky-400
          "#a78bfa", // violet-400
          "#fbbf24", // amber-400
          "#fb7185", // rose-400
          "#22d3ee", // cyan-400
        ],
        cssVar: {
          "--main-color": "#e4e4e7",
          "--main-bgcolor": "#09090b",
          "--color": "#d4d4d8",
          "--bgcolor": "#18181b",
          "--panel-color": "#e4e4e7",
          "--panel-bgcolor": "#18181b",
          "--panel-border-color": "rgba(63,63,70,0.5)",
        },
      },
    });

    mind.init(data);
    instanceRef.current = mind;

    return () => {
      // Mind Elixir attaches DOM + listeners to el; clear it on unmount.
      if (elRef.current) elRef.current.innerHTML = "";
      instanceRef.current = null;
    };
  }, [data]);

  return <div ref={elRef} className="h-full w-full" />;
}
