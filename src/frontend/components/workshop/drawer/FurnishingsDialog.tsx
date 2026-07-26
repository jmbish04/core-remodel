// ---------------------------------------------------------------------------
// FurnishingsDialog — the procurement slice (nano-banana recipe 6.1).
//
// Opens against a node image, runs the vision extraction, and lists the
// detected furnishings/materials as cards. Each card links to a showroom-product
// search for that item — the first step of turning a render into a buy list.
// (Wiring items into a materials-todo Decision Room is a later follow-up.)
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { PackageSearch, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { extractFurnishings, type FurnishingItem } from "../api";
import type { BoardNode } from "../types";

interface FurnishingsDialogProps {
  /** The node to extract from; null closes the dialog. */
  node: BoardNode | null;
  onClose: () => void;
}

/** Product-search URL for a detected item (global products page, query-persisted). */
function productSearchUrl(label: string): string {
  return `/admin/products?search=${encodeURIComponent(label)}`;
}

export function FurnishingsDialog({ node, onClose }: FurnishingsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<FurnishingItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Re-run whenever the target node changes (dialog opens on a new node).
  useEffect(() => {
    if (!node) return;
    let cancelled = false;
    setLoading(true);
    setItems(null);
    setFailed(false);
    extractFurnishings(node.id)
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node]);

  return (
    <Dialog open={Boolean(node)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch className="size-5" />
            Furnishings & materials
          </DialogTitle>
          <DialogDescription>
            What we spotted in this image — click any item to find it in your products.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : failed ? (
          <div className="py-10 text-center">
            <p className="font-semibold">That didn’t come through</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The extraction drifted — close and try again.
            </p>
          </div>
        ) : items && items.length > 0 ? (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {items.map((item, i) => (
              <li key={`${item.label}-${i}`}>
                <a
                  href={productSearchUrl(item.label)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg bg-card p-3 ring-1 ring-border/40 transition-colors hover:ring-border"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="uppercase tracking-wide">{item.category}</span>
                      {item.note ? ` · ${item.note}` : ""}
                    </span>
                  </span>
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-10 text-center">
            <PackageSearch className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 font-semibold">Nothing to source here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No distinct furnishings or materials were detected in this image.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default FurnishingsDialog;
