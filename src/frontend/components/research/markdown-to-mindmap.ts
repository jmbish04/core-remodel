/**
 * @fileoverview Convert research markdown into a Mind Elixir node tree.
 *
 * The deep-research findings are headed markdown. We derive the mind map from
 * the heading hierarchy (h1..h4), and attach the first bullet/sentence under a
 * leaf heading as child leaves so the map carries real content, not just titles.
 *
 * No markdown-parser dependency — a light line scan is sufficient and keeps the
 * bundle small. Output is `{ nodeData }` ready for <MindMap data={...} />.
 */

import type { MindElixirData, NodeObj } from "mind-elixir";

let counter = 0;
function nid(): string {
  counter += 1;
  return `me-${Date.now().toString(36)}-${counter}`;
}

interface HeadingNode extends NodeObj {
  _level: number;
}

/**
 * Parse headed markdown into a Mind Elixir data object. The given `rootTopic`
 * (usually the research topic) becomes the root; headings nest beneath it.
 */
export function markdownToMindmap(markdown: string, rootTopic: string): MindElixirData {
  counter = 0;
  const root: HeadingNode = {
    id: nid(),
    topic: truncate(rootTopic, 80) || "Research",
    _level: 0,
    children: [],
  };

  // Stack of currently-open heading nodes by level for nesting.
  const stack: HeadingNode[] = [root];
  // Buffer of bullet/paragraph leaves to attach to the nearest heading.
  let pendingLeaves: NodeObj[] = [];

  const flushLeaves = () => {
    if (pendingLeaves.length === 0) return;
    const parent = stack[stack.length - 1];
    parent.children = parent.children ?? [];
    // Cap leaves per heading so the map stays legible.
    parent.children.push(...pendingLeaves.slice(0, 6));
    pendingLeaves = [];
  };

  const lines = markdown.split("\n");
  let inFence = false;

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushLeaves();
      const level = heading[1].length;
      const topic = stripInline(heading[2]).trim();
      if (!topic) continue;

      // Pop the stack to the parent of this level.
      while (stack.length > 1 && stack[stack.length - 1]._level >= level) {
        stack.pop();
      }
      const node: HeadingNode = { id: nid(), topic: truncate(topic, 90), _level: level, children: [] };
      const parent = stack[stack.length - 1];
      parent.children = parent.children ?? [];
      parent.children.push(node);
      stack.push(node);
      continue;
    }

    // Top-level bullet under the current heading → leaf.
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const text = stripInline(bullet[1]).trim();
      if (text && pendingLeaves.length < 6) {
        pendingLeaves.push({ id: nid(), topic: truncate(text, 90) });
      }
    }
  }
  flushLeaves();

  // Strip the bookkeeping field before handing to Mind Elixir.
  stripLevels(root);

  return { nodeData: root, direction: 2 };
}

function stripLevels(node: NodeObj): void {
  delete (node as Partial<HeadingNode>)._level;
  for (const c of node.children ?? []) stripLevels(c);
}

/** Remove markdown emphasis/link syntax for clean node labels. */
function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/[*_`~]+/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
