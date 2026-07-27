// ---------------------------------------------------------------------------
// FurnishingsRoomApp — a room's shopping list (docs/0014 procurement).
//
// Pick a room → see every furnishing/material extracted from its renders
// (persisted furnishing_items), grouped by category. Curate: mark an item
// "got it" (adopted) or dismiss it; click through to product search. This is
// the room-wide roll-up of the per-node FurnishingsDialog in the Workshop.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, PackageSearch, Search, X } from "lucide-react";

import { RoomSelect } from "@/components/ui/room-select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  getRoomFurnishings,
  patchFurnishing,
  type FurnishingItem,
} from "@/components/workshop/api";

function productSearchUrl(label: string): string {
  return `/admin/products?search=${encodeURIComponent(label)}`;
}

export function FurnishingsRoomApp() {
  const [roomId, setRoomId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<FurnishingItem[]>([]);

  const load = useCallback((id: number) => {
    setLoading(true);
    getRoomFurnishings(id)
      .then((rows) => setItems(rows.filter((it) => it.status !== "dismissed")))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (roomId != null) load(roomId);
    else setItems([]);
  }, [roomId, load]);

  const dismiss = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    void patchFurnishing(id, { status: "dismissed" }).catch(() => {});
  };

  const toggleAdopted = (item: FurnishingItem) => {
    const next = item.status === "adopted" ? "detected" : "adopted";
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: next } : it)));
    void patchFurnishing(item.id, { status: next }).catch(() => {});
  };

  // Group by category, categories sorted, items stable within.
  const groups = useMemo(() => {
    const byCat = new Map<string, FurnishingItem[]>();
    for (const it of items) {
      const cat = it.category || "other";
      byCat.set(cat, [...(byCat.get(cat) ?? []), it]);
    }
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <RoomSelect
          value={roomId}
          onChange={setRoomId}
          placeholder="Pick a room…"
          aria-label="Room"
          className="w-64"
        />
        {roomId != null ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {roomId == null ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-card py-16 text-center ring-1 ring-border/40">
          <PackageSearch className="size-6 text-muted-foreground" />
          <p className="font-semibold">Pick a room</p>
          <p className="text-sm text-muted-foreground">
            Its shopping list — everything extracted from that room’s renders — shows up here.
          </p>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-card py-16 text-center ring-1 ring-border/40">
          <PackageSearch className="size-6 text-muted-foreground" />
          <p className="font-semibold">Nothing saved for this room yet</p>
          <p className="text-sm text-muted-foreground">
            In the Workshop, right-click a render → “List the furnishings” to build this list.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([category, catItems]) => (
            <section key={category} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {category}
              </h2>
              <ul className="divide-y divide-border/40 rounded-lg bg-card ring-1 ring-border/40">
                {catItems.map((item) => {
                  const adopted = item.status === "adopted";
                  return (
                    <li key={item.id} className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button"
                        aria-label={adopted ? `Un-mark ${item.label}` : `Mark ${item.label} as got it`}
                        onClick={() => toggleAdopted(item)}
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          adopted
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                        )}
                      >
                        <Check className="size-4" />
                      </button>
                      <a
                        href={productSearchUrl(item.label)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "flex min-w-0 flex-1 items-center justify-between gap-3 transition-colors hover:text-primary",
                          adopted && "text-muted-foreground line-through",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{item.label}</span>
                          {item.note ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.note}
                            </span>
                          ) : null}
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
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default FurnishingsRoomApp;
