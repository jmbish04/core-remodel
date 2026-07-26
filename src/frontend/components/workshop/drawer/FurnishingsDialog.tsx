// ---------------------------------------------------------------------------
// FurnishingsDialog — the procurement slice (nano-banana recipe 6.1).
//
// Opens against a node. Loads that node's ALREADY-saved furnishings (persisted
// server-side) so we don't re-run the vision pass on every open; a "Scan this
// image" button runs (or re-runs) the extraction on demand. Each item can be
// dismissed (curate) and links to a showroom-product search — the first step of
// turning a render into a buy list.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { PackageSearch, Search, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import {
  extractFurnishings,
  getNodeFurnishings,
  patchFurnishing,
  type FurnishingItem,
} from "../api";
import type { BoardNode } from "../types";

interface FurnishingsDialogProps {
  node: BoardNode | null;
  onClose: () => void;
}

/** Product-search URL for a detected item (global products page, query-persisted). */
function productSearchUrl(label: string): string {
  return `/admin/products?search=${encodeURIComponent(label)}`;
}

export function FurnishingsDialog({ node, onClose }: FurnishingsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [items, setItems] = useState<FurnishingItem[]>([]);
  const [failed, setFailed] = useState(false);

  // On open, load this node's already-saved items (no vision call).
  useEffect(() => {
    if (!node) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setItems([]);
    getNodeFurnishings(node.id)
      .then((saved) => {
        if (!cancelled) setItems(saved.filter((it) => it.status !== "dismissed"));
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

  const scan = async () => {
    if (!node) return;
    setScanning(true);
    setFailed(false);
    try {
      const fresh = await extractFurnishings(node.id);
      setItems(fresh.filter((it) => it.status !== "dismissed"));
    } catch {
      setFailed(true);
    } finally {
      setScanning(false);
    }
  };

  const dismiss = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id)); // optimistic
    void patchFurnishing(id, { status: "dismissed" }).catch(() => {
      /* best-effort; a reload re-syncs */
    });
  };

  return (
    <Dialog open={Boolean(node)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch className="size-5" />
            Furnishings & materials
          </DialogTitle>
          <DialogDescription>
            What we spotted in this image — dismiss what you don’t want, click to shop the rest.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length > 0 ? (
          <ul className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg bg-card p-3 ring-1 ring-border/40"
              >
                <a
                  href={productSearchUrl(item.label)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 transition-colors hover:text-primary"
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
                <button
                  type="button"
                  aria-label={`Dismiss ${item.label}`}
                  onClick={() => dismiss(item.id)}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : failed ? (
          <div className="py-8 text-center">
            <p className="font-semibold">That didn’t come through</p>
            <p className="mt-1 text-sm text-muted-foreground">The scan drifted — try again.</p>
          </div>
        ) : (
          <div className="py-8 text-center">
            <PackageSearch className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 font-semibold">No furnishings saved yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Scan this image to pull out a shopping list.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={() => void scan()} disabled={loading || scanning} className="gap-2">
            <Sparkles className="size-4" />
            {scanning ? "Scanning…" : items.length > 0 ? "Re-scan this image" : "Scan this image"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default FurnishingsDialog;
