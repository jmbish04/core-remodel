"use client";

/**
 * @fileoverview "Files touched" rendered as a directory tree.
 *
 * The flat chip list this replaces was unreadable past about a dozen entries:
 * every path repeated `src/backend/api/routes/` and the eye had to diff long
 * strings to see what actually changed. A tree collapses the shared prefixes so
 * the shape of the change — which subsystems it reaches into — is visible at a
 * glance.
 *
 * Only the tree half of kibo-ui's codebase pattern is used. The other half is a
 * code pane, and a changelog entry stores file PATHS with no contents, so there
 * would be nothing to show in it.
 */

import {
  TreeExpander,
  TreeIcon,
  TreeLabel,
  TreeNode,
  TreeNodeContent,
  TreeNodeTrigger,
  TreeProvider,
  TreeView,
} from "@/components/kibo-ui/tree";
import {
  FileCode,
  FileCog,
  FileJson,
  FileText,
  FileType,
  Braces,
} from "lucide-react";
import { useMemo } from "react";

interface TreeEntry {
  /** Full path from the root, used as the node id (unique by construction). */
  id: string;
  name: string;
  children: Map<string, TreeEntry>;
}

/** Build a nested map from flat paths. Directories are inferred from segments. */
function buildTree(paths: string[]): Map<string, TreeEntry> {
  const root = new Map<string, TreeEntry>();
  for (const raw of paths) {
    const path = raw.trim().replace(/^\.?\//, "");
    if (!path) continue;
    const segments = path.split("/").filter(Boolean);
    let level = root;
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let node = level.get(segment);
      if (!node) {
        node = { id: prefix, name: segment, children: new Map() };
        level.set(segment, node);
      }
      level = node.children;
    }
  }
  return root;
}

/** Directories first, then files, each alphabetical — standard explorer order. */
function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.children.size > 0;
    const bDir = b.children.size > 0;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function iconFor(name: string) {
  if (name.endsWith(".tsx") || name.endsWith(".jsx")) return <FileCode className="size-4" />;
  if (name.endsWith(".ts") || name.endsWith(".js") || name.endsWith(".mjs"))
    return <FileType className="size-4" />;
  if (name.endsWith(".json")) return <FileJson className="size-4" />;
  if (name.endsWith(".sql")) return <Braces className="size-4" />;
  if (name.endsWith(".astro") || name.endsWith(".css")) return <FileCog className="size-4" />;
  return <FileText className="size-4" />;
}

/** Every directory id, so the tree opens fully expanded rather than as one closed root. */
function collectDirIds(entries: Map<string, TreeEntry>, acc: string[] = []): string[] {
  for (const entry of entries.values()) {
    if (entry.children.size > 0) {
      acc.push(entry.id);
      collectDirIds(entry.children, acc);
    }
  }
  return acc;
}

function renderNodes(entries: Map<string, TreeEntry>, level: number) {
  const sorted = sortEntries([...entries.values()]);
  return sorted.map((entry, index) => {
    const isDir = entry.children.size > 0;
    const isLast = index === sorted.length - 1;
    return (
      <TreeNode key={entry.id} nodeId={entry.id} level={level} isLast={isLast}>
        <TreeNodeTrigger>
          <TreeExpander hasChildren={isDir} />
          <TreeIcon hasChildren={isDir} icon={isDir ? undefined : iconFor(entry.name)} />
          <TreeLabel>{entry.name}</TreeLabel>
        </TreeNodeTrigger>
        {isDir ? (
          <TreeNodeContent hasChildren>{renderNodes(entry.children, level + 1)}</TreeNodeContent>
        ) : null}
      </TreeNode>
    );
  });
}

export function FilesTouchedTree({ files }: { files: string[] }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const expanded = useMemo(() => collectDirIds(tree), [tree]);

  if (tree.size === 0) return null;

  return (
    <div className="rounded-xl bg-card p-2 ring-1 ring-border/40">
      <TreeProvider defaultExpandedIds={expanded} selectable={false} showLines>
        <TreeView>{renderNodes(tree, 0)}</TreeView>
      </TreeProvider>
    </div>
  );
}
