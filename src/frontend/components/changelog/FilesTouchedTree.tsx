"use client";

/**
 * @fileoverview "Files touched" rendered as a real terminal tree.
 *
 * This is termcn's `Tree` — the actual Ink component from the registry, not a
 * lookalike — running in the browser through `ink-web`, which drives an xterm.js
 * terminal with Ink's renderer. Same thing termcn's own docs site does for its
 * component previews.
 *
 * The flat chip list this replaced was unreadable past about a dozen entries:
 * every path repeated `src/backend/api/routes/` and the eye had to diff long
 * strings to see what actually changed. A tree collapses the shared prefixes so
 * the shape of a change — which subsystems it reaches into — is visible at a
 * glance. Only filenames are shown; an entry stores paths and no contents, so
 * there would be nothing to put in a code pane beside it.
 *
 * ## What using a terminal emulator costs
 *
 * Text inside xterm is drawn into a terminal grid, not laid out as HTML. Copy
 * works (xterm has its own selection), but browser find-in-page does not reach
 * it and screen-reader support is xterm's accessibility layer rather than
 * semantic markup. That is the trade for a real terminal surface, and it is why
 * the tree is loaded lazily and only on this one section.
 *
 * `rows` is derived from the node count rather than fixed: a terminal is a fixed
 * grid, so too few rows silently scrolls the tail of the file list out of view.
 */

import { useEffect, useMemo, useState } from "react";

import type { TreeNode } from "@/components/termcn/tree";

// Both stylesheets, and both are needed. `ink-web/css` styles the terminal
// content; xterm's OWN stylesheet styles its chrome — without it the scrollbar
// element paints its glyphs as literal characters, which showed up as a row of
// "]]]]]]tttttt" pinned above the tree.
//
// Imported STATICALLY: as a dynamic `import("ink-web/css")` it sat in a
// Promise.all with the JS modules and rejected, silently dropping the whole
// terminal to the fallback list. Vite extracts a static CSS import into this
// island's chunk, so it still loads exactly when the island does.
import "@xterm/xterm/css/xterm.css";
import "ink-web/css";

interface Building {
  key: string;
  label: string;
  children: Map<string, Building>;
}

/** Build a nested map from flat paths. Directories are inferred from segments. */
function buildTree(paths: string[]): Map<string, Building> {
  const root = new Map<string, Building>();
  for (const raw of paths) {
    const path = raw.trim().replace(/^\.?\//, "");
    if (!path) continue;
    let level = root;
    let prefix = "";
    for (const segment of path.split("/").filter(Boolean)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let node = level.get(segment);
      if (!node) {
        node = { key: prefix, label: segment, children: new Map() };
        level.set(segment, node);
      }
      level = node.children;
    }
  }
  return root;
}

/** Directories first, then files, each alphabetical — standard explorer order. */
function toNodes(level: Map<string, Building>): TreeNode[] {
  return [...level.values()]
    .sort((a, b) => {
      const aDir = a.children.size > 0;
      const bDir = b.children.size > 0;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.label.localeCompare(b.label);
    })
    .map((entry) =>
      entry.children.size > 0
        ? { key: entry.key, label: entry.label, children: toNodes(entry.children) }
        : { key: entry.key, label: entry.label },
    );
}

/** Every directory key, so the tree opens fully expanded rather than as one closed root. */
function dirKeys(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children?.length) {
      acc.push(n.key);
      dirKeys(n.children, acc);
    }
  }
  return acc;
}

/** Total rows the fully-expanded tree occupies. */
function countRows(nodes: TreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + (n.children ? countRows(n.children) : 0), 0);
}

type TerminalModule = {
  InkTerminalBox: React.ComponentType<{
    children: React.ReactElement;
    rows?: number;
    padding?: number;
    loading?: unknown;
    className?: string;
  }>;
  Tree: React.ComponentType<{ nodes: TreeNode[]; defaultExpanded?: string[] }>;
  ThemeProvider: React.ComponentType<{ children: React.ReactNode }>;
};

export function FilesTouchedTree({ files }: { files: string[] }) {
  const nodes = useMemo(() => toNodes(buildTree(files)), [files]);
  const expanded = useMemo(() => dirKeys(nodes), [nodes]);
  const rows = useMemo(() => Math.min(40, countRows(nodes) + 1), [nodes]);

  /**
   * Loaded on the client only, and lazily.
   *
   * Ink and xterm together are a large payload for one section of one admin
   * page, and Ink's module graph reaches for Node built-ins that only exist
   * once the ink-web shims are aliased in — which happens in the CLIENT Vite
   * pass. A static import would pull all of that into the server bundle too.
   */
  const [mod, setMod] = useState<TerminalModule | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("ink-web"),
      import("@/components/termcn/tree"),
      import("@/components/termcn/theme-provider"),
    ])
      .then(([inkWeb, tree, themeProvider]) => {
        if (cancelled) return;
        setMod({
          InkTerminalBox: (inkWeb as unknown as { InkTerminalBox: TerminalModule["InkTerminalBox"] })
            .InkTerminalBox,
          Tree: (tree as unknown as { Tree: TerminalModule["Tree"] }).Tree,
          ThemeProvider: (themeProvider as unknown as { ThemeProvider: TerminalModule["ThemeProvider"] })
            .ThemeProvider,
        });
      })
      .catch((err) => {
        // Logged, not swallowed. The fallback renders either way, but a silent
        // catch here cost an hour of guessing which of the imports was failing.
        console.error("[FilesTouchedTree] terminal renderer failed to load", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (nodes.length === 0) return null;

  // Plain-list fallback. A terminal that fails to load must not take the file
  // list with it — the paths are the point, the terminal is the presentation.
  if (failed || !mod) {
    return (
      <div className="rounded-xl bg-card p-3 ring-1 ring-border/40">
        <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
          {files.map((f) => (
            <li key={f} className="truncate">
              {f}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { InkTerminalBox, Tree, ThemeProvider } = mod;

  return (
    <div className="overflow-hidden rounded-xl bg-card p-3 ring-1 ring-border/40">
      <InkTerminalBox rows={rows} padding={8}>
        <ThemeProvider>
          <Tree nodes={nodes} defaultExpanded={expanded} />
        </ThemeProvider>
      </InkTerminalBox>
    </div>
  );
}
