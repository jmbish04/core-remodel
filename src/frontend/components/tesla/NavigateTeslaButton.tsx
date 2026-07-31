/**
 * @fileoverview NavigateTeslaButton (0032 N1) — reusable "send to the car" button.
 *
 * Two modes, picked by the props you pass:
 *   • Single destination — pass `latitude`+`longitude`, a `destination` string, or a
 *     `stopId` (+`slug`). POSTs /api/tesla/navigate.
 *   • Whole drive — pass `driveListId`. POSTs /api/tesla/navigate-drive, which sends
 *     every stop as a multi-waypoint route.
 *
 * Admin-gated endpoints (cookie auth). Optimistic busy state + toast; the button is
 * self-contained so it can drop onto a showroom hero, a drive viewport, or anywhere.
 */
import { Loader2, Navigation } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type ButtonSize = "default" | "xs" | "sm" | "lg";
type ButtonVariant = "default" | "secondary" | "outline" | "ghost";

export interface NavigateTeslaButtonProps {
  // Single-destination inputs (any one):
  latitude?: number | null;
  longitude?: number | null;
  destination?: string | null;
  stopId?: number;
  slug?: string;
  // Whole-drive input:
  driveListId?: number;
  // Presentation:
  label?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}

export function NavigateTeslaButton({
  latitude,
  longitude,
  destination,
  stopId,
  slug,
  driveListId,
  label,
  size = "sm",
  variant = "default",
  className,
}: NavigateTeslaButtonProps) {
  const [busy, setBusy] = useState(false);
  const isDrive = driveListId != null;

  async function go() {
    setBusy(true);
    try {
      const path = isDrive ? "/api/tesla/navigate-drive" : "/api/tesla/navigate";
      const body = isDrive
        ? { driveListId, slug }
        : { lat: latitude ?? undefined, lng: longitude ?? undefined, destination, stopId, slug };
      const res = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        count?: number;
      };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `Failed (${res.status})`);
      toast.success(
        isDrive
          ? `Sent ${data.count ?? ""} stop${data.count === 1 ? "" : "s"} to the car`.replace("  ", " ")
          : "Sent to the car",
      );
    } catch (e) {
      console.error("[NavigateTeslaButton]", e);
      toast.error(e instanceof Error ? e.message : "Could not send to the car");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={busy}
      onClick={go}
      title="Send to the Tesla's navigation"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Navigation className="size-4" />
      )}
      {label ?? (isDrive ? "Send drive to car" : "Navigate")}
    </Button>
  );
}

export default NavigateTeslaButton;
