/**
 * @fileoverview Reusable "Import from Google Photos" button.
 *
 * Wraps `useGooglePhotosPicker` and surfaces its progress via the button label
 * + a spinner. On success it calls `onFiles` with the picked photos as `File[]`;
 * the host component is responsible for feeding those files into its existing
 * upload path. Errors are surfaced via a sonner toast.
 *
 * Styling follows the Monolith system (shadcn Button, dark theme, no ad-hoc
 * borders). Pass `variant`/`size`/`className` to match the host surface.
 */

import { Images, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useGooglePhotosPicker, type PickerPhase } from "./useGooglePhotosPicker";

type ButtonVariant = React.ComponentProps<typeof Button>["variant"];
type ButtonSize = React.ComponentProps<typeof Button>["size"];

interface GooglePhotosButtonProps {
  /** Receives the picked photos as real File objects. */
  onFiles: (files: File[]) => void | Promise<void>;
  /** Overrides the idle label (default: "Google Photos"). */
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
}

/** Human-readable label for each in-flight phase. */
function phaseLabel(phase: PickerPhase, idle: string): string {
  switch (phase) {
    case "connecting":
      return "Connecting…";
    case "opening":
      return "Opening picker…";
    case "waiting":
      return "Waiting for selection…";
    case "downloading":
      return "Importing…";
    default:
      return idle;
  }
}

export function GooglePhotosButton({
  onFiles,
  label = "Google Photos",
  variant = "outline",
  size = "sm",
  className,
  disabled,
}: GooglePhotosButtonProps) {
  const { phase, isBusy, start } = useGooglePhotosPicker(onFiles, (message) => toast.error(message));

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("gap-2", className)}
      disabled={disabled || isBusy}
      onClick={() => void start()}
      title="Import photos from Google Photos"
    >
      {isBusy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Images className="h-4 w-4" aria-hidden />
      )}
      {phaseLabel(phase, label)}
    </Button>
  );
}
