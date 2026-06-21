import { GitBranch, GitFork } from "lucide-react";
import React, { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  STAGE_BUCKET_LABEL,
  type RenderCanvas,
  stageBucketForType,
} from "./types";

/** Minimal node shape this tree needs. */
export type BranchNode = Pick<
  RenderCanvas,
  "id" | "type" | "branchLabel" | "parentCanvasId" | "aiTitle" | "status"
>;

interface BranchNavigatorProps {
  nodes: BranchNode[];
  selectedCanvasId?: string | null;
  onSelect: (canvasId: string) => void;
  className?: string;
}

interface TreeNode extends BranchNode {
  children: TreeNode[];
}

function buildTree(nodes: BranchNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentCanvasId && byId.has(node.parentCanvasId)) {
      byId.get(node.parentCanvasId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function statusDotClass(status: RenderCanvas["status"]): string {
  switch (status) {
    case "done":
      return "bg-emerald-400";
    case "failed":
      return "bg-destructive";
    default:
      return "bg-amber-400";
  }
}

/**
 * BranchNavigator — a simple tree view of canvas nodes (id, type, branchLabel,
 * parentCanvasId). Renders baselines and their variation branches; selecting a
 * node calls onSelect so the studio can branch from it.
 */
export function BranchNavigator({
  nodes,
  selectedCanvasId,
  onSelect,
  className,
}: BranchNavigatorProps) {
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const bucket = stageBucketForType(node.type);
    const isSelected = selectedCanvasId === node.id;
    return (
      <li key={node.id} className="space-y-1">
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
          className={cn(
            "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition",
            isSelected
              ? "bg-primary/10 text-foreground ring-1 ring-primary/50"
              : "text-muted-foreground hover:bg-muted/30",
          )}
        >
          {depth > 0 ? (
            <GitFork className="size-3.5 shrink-0 text-muted-foreground/60" />
          ) : (
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground/60" />
          )}
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              statusDotClass(node.status),
            )}
          />
          <span className="min-w-0 flex-1 truncate text-foreground">
            {node.aiTitle || (bucket ? STAGE_BUCKET_LABEL[bucket] : node.type)}
          </span>
          {node.branchLabel && (
            <Badge variant="secondary" className="text-[9px]">
              {node.branchLabel}
            </Badge>
          )}
        </button>
        {node.children.length > 0 && (
          <ul className="space-y-1 border-l border-border/30 pl-1">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl bg-card p-3 ring-1 ring-border/40",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-1">
        <GitBranch className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Branch Tree</h3>
        <Badge variant="outline" className="ml-auto text-[10px] tabular-nums">
          {nodes.length}
        </Badge>
      </div>
      {tree.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">
          No canvas nodes yet. Run a stage to start the tree.
        </p>
      ) : (
        <ul className="space-y-1">
          {tree.map((node) => renderNode(node, 0))}
        </ul>
      )}
    </div>
  );
}

export default BranchNavigator;
