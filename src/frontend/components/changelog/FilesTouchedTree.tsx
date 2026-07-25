"use client";

/**
 * @fileoverview "Files touched" rendered as a terminal-style directory tree.
 *
 * The flat chip list this replaces was unreadable past about a dozen entries:
 * every path repeated `src/backend/api/routes/` and the eye had to diff long
 * strings to see what actually changed. A tree collapses the shared prefixes so
 * the shape of the change — which subsystems it reaches into — is visible at a
 * glance.
 *
 * Only filenames are shown; a changelog entry stores paths and no contents, so
 * there is nothing to put in a code pane beside it. That is why this is a bare
 * tree rather than an explorer-plus-viewer.
 */

import { TerminalTree, type TreeNode } from "@/components/ui/terminal-tree";
import { useMemo } from "react";

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

export function FilesTouchedTree({ files }: { files: string[] }) {
  const nodes = useMemo(() => toNodes(buildTree(files)), [files]);
  const expanded = useMemo(() => dirKeys(nodes), [nodes]);

  if (nodes.length === 0) return null;

  return <TerminalTree nodes={nodes} defaultExpanded={expanded} />;
}
