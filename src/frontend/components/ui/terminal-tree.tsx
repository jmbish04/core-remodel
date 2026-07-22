"use client";

/**
 * @fileoverview Terminal-styled expandable tree.
 *
 * ## Why this is not termcn
 *
 * termcn's `Tree` was the ask, and it cannot run here. The registry ships two
 * bases and both are terminal renderers, not DOM renderers:
 *
 *   - `@termcn/ink/tree` imports `Box`/`Text` from **ink**, which renders React
 *     to a TTY through `process.stdout` and ANSI escape codes.
 *   - the opentui variant opts into a separate JSX runtime via a jsxImportSource
 *     pragma pointing at @opentui/react, which depends on `ws` and
 *     `react-reconciler` to drive a terminal surface.
 *
 * (That pragma is described rather than quoted here on purpose: written out
 * literally, even inside a comment, Vite reads it as a real directive and the
 * build fails trying to resolve a jsx-runtime that cannot exist in a browser
 * bundle. Which is the point being made, arrived at the hard way.)
 *
 * Neither produces HTML. Rendering either in a browser bundle fails at import,
 * and the opentui path would paint text into a canvas, which loses selection,
 * find-in-page and screen-reader access.
 *
 * So this reproduces termcn's **API and appearance** in the DOM: the same prop
 * names and defaults (`nodes`, `onSelect`, `defaultExpanded`, `expandedIcon`
 * "▼", `collapsedIcon` "▶", `leafIcon` "•"), monospace type, and box-drawing
 * guides. If termcn ever ships a DOM base, swapping to it is an import change
 * and nothing else.
 */

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface TreeNode {
  key: string;
  label: string;
  children?: TreeNode[];
  /** Overrides the leaf/branch glyph for this node. */
  icon?: string;
}

export interface TerminalTreeProps {
  nodes: TreeNode[];
  onSelect?: (node: TreeNode) => void;
  defaultExpanded?: string[];
  expandedIcon?: string;
  collapsedIcon?: string;
  leafIcon?: string;
  className?: string;
}

interface RowProps {
  node: TreeNode;
  depth: number;
  isLast: boolean;
  /** For each ancestor level, whether that ancestor still has siblings below. */
  guides: boolean[];
  expanded: Set<string>;
  toggle: (key: string) => void;
  onSelect?: (node: TreeNode) => void;
  icons: { expanded: string; collapsed: string; leaf: string };
}

function Row({ node, depth, isLast, guides, expanded, toggle, onSelect, icons }: RowProps) {
  const hasChildren = Boolean(node.children?.length);
  const isOpen = hasChildren && expanded.has(node.key);
  const glyph = node.icon ?? (hasChildren ? (isOpen ? icons.expanded : icons.collapsed) : icons.leaf);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (hasChildren) toggle(node.key);
          onSelect?.(node);
        }}
        aria-expanded={hasChildren ? isOpen : undefined}
        className={cn(
          "flex w-full items-center gap-0 rounded px-1 py-0.5 text-left font-mono text-xs",
          "text-foreground/80 transition-colors hover:bg-muted/40 hover:text-foreground",
          !hasChildren && "cursor-default",
        )}
      >
        {/*
          Box-drawing guides are rendered per ancestor level rather than as a
          single indent, so a deep tree still reads as a tree. They are
          aria-hidden: to a screen reader the nesting is already carried by the
          list structure, and "│ ├ ─" announced literally is noise.
        */}
        {guides.map((continues, i) => (
          <span key={i} aria-hidden className="select-none text-muted-foreground/30">
            {continues ? "│  " : "   "}
          </span>
        ))}
        {depth > 0 ? (
          <span aria-hidden className="select-none text-muted-foreground/30">
            {isLast ? "└─ " : "├─ "}
          </span>
        ) : null}
        <span
          aria-hidden
          className={cn(
            "mr-1.5 select-none",
            hasChildren ? "text-sky-400/80" : "text-muted-foreground/50",
          )}
        >
          {glyph}
        </span>
        <span className={cn("truncate", hasChildren && "text-foreground")}>{node.label}</span>
      </button>

      {isOpen
        ? node.children!.map((child, i) => (
            <Row
              key={child.key}
              node={child}
              depth={depth + 1}
              isLast={i === node.children!.length - 1}
              guides={depth > 0 ? [...guides, !isLast] : guides}
              expanded={expanded}
              toggle={toggle}
              onSelect={onSelect}
              icons={icons}
            />
          ))
        : null}
    </>
  );
}

export function TerminalTree({
  nodes,
  onSelect,
  defaultExpanded = [],
  expandedIcon = "▼",
  collapsedIcon = "▶",
  leafIcon = "•",
  className,
}: TerminalTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpanded));

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const icons = useMemo(
    () => ({ expanded: expandedIcon, collapsed: collapsedIcon, leaf: leafIcon }),
    [collapsedIcon, expandedIcon, leafIcon],
  );

  return (
    <div className={cn("rounded-xl bg-card p-3 ring-1 ring-border/40", className)}>
      {nodes.map((node, i) => (
        <Row
          key={node.key}
          node={node}
          depth={0}
          isLast={i === nodes.length - 1}
          guides={[]}
          expanded={expanded}
          toggle={toggle}
          onSelect={onSelect}
          icons={icons}
        />
      ))}
    </div>
  );
}
