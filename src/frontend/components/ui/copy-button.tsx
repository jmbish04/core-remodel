/**
 * @fileoverview CopyButton — the shared copy-to-clipboard control (0041).
 *
 * The repo had only inline `navigator.clipboard.writeText` calls; this is the one
 * reusable copy affordance. Guards against a blocked/insecure clipboard (falls
 * back to `window.prompt` so the value is still selectable), shows a transient
 * "Copied" state, and stops click propagation so it works as an overlay on a
 * clickable card.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label,
  title = "Copy to clipboard",
  className,
  size = "sm",
}: {
  /** The text placed on the clipboard. */
  value: string;
  /** Optional visible label next to the icon (icon-only when omitted). */
  label?: string;
  title?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  // Clear any pending reset on unmount so we never setState on an unmounted node.
  useEffect(() => {
    return () => {
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  const copy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          // Insecure context / clipboard blocked — surface the value to copy by hand.
          window.prompt("Copy this value:", value);
        }
        setCopied(true);
        // Restart the reset timer so rapid re-clicks don't clear "Copied" early.
        if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
        resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
      } catch {
        window.prompt("Copy this value:", value);
      }
    },
    [value],
  );

  const icon = size === "md" ? "size-4" : "size-3.5";
  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm ring-1 ring-white/15 transition hover:bg-black/75",
        className,
      )}
    >
      {copied ? <Check className={cn(icon, "text-emerald-400")} /> : <Copy className={icon} />}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}
