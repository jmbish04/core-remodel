/**
 * @fileoverview AddToWishlistButton — shared per-card "add to wishlist" affordance.
 *
 * Opens a popover with an optional room picker, then POSTs
 * `/api/wishlist/from-product/:productId` with `{ roomId? }`. The wishlist API
 * denormalizes the product's title/price/thumbnail server-side, so no product
 * data is passed here.
 *
 * The trigger + popover stop event propagation / prevent default so interacting
 * with them never navigates an enclosing product-detail `<a>`.
 *
 * Extracted from showroom/ProductsCatalogApp.tsx so the products browse page and
 * the showroom catalog share one implementation.
 */

import { useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { RoomSelect } from "@/components/ui/room-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function AddToWishlistButton({ productId }: { productId: number }) {
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function add() {
    setSaving(true);
    try {
      const res = await fetch(`/api/wishlist/from-product/${productId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roomId != null ? { roomId } : {}),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
      }
      toast.success("Added to wishlist");
      setOpen(false);
      setRoomId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add to wishlist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            aria-label="Add to wishlist"
            onClick={(e) => {
              // Keep the click inside the popover, not the product-detail link.
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <Heart className="mr-1 h-3.5 w-3.5" /> Wishlist
          </Button>
        }
      />
      <PopoverContent
        className="w-64 p-3"
        side="bottom"
        align="end"
        // Prevent the wrapping <a> from navigating on any interaction inside.
        onClick={(e) => e.preventDefault()}
      >
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Add to wishlist for a room (optional)
        </p>
        <RoomSelect
          value={roomId}
          onChange={setRoomId}
          includeAllOption
          allOptionLabel="All rooms"
          aria-label="Wishlist room"
        />
        <Button
          size="sm"
          className="mt-3 w-full"
          disabled={saving}
          onClick={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Heart className="mr-1.5 h-4 w-4" />}
          Add to wishlist
        </Button>
      </PopoverContent>
    </Popover>
  );
}
