/**
 * @fileoverview ContactEmailMenu — the clickable-email action menu (V2 item 3).
 *
 * A contact's email is no longer a bare `mailto:` — clicking it opens a small
 * menu with three ways to act on the address:
 *   1. Open in the default mail client (`mailto:`)
 *   2. Compose inside core-remodel — routes to the store's full-page inbox with a
 *      `?compose=<email>` intent (the inbox owns the composer + threading)
 *   3. Copy the address to the clipboard
 *
 * Temporary V2 component; folds into the promoted ContactsSection on sign-off.
 */
import { useState } from "react";
import { Mail, ExternalLink, Send, Copy, Check } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** Copy text with an execCommand fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ContactEmailMenu({
  email,
  storeId,
  className,
}: {
  email: string;
  /** Store id — the "compose in core-remodel" action targets its inbox. */
  storeId: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  // The V2 inbox page owns the composer; a ?compose= intent pre-fills To:.
  const composeHref = `/admin/shopping/store/${storeId}/inbox?compose=${encodeURIComponent(email)}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={
          className ??
          "inline-flex items-center gap-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
        }
        aria-label={`Email ${email}`}
      >
        <Mail className="size-4 shrink-0" />
        <span className="truncate">{email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href={`mailto:${email}`} aria-label="Open in email app" />}>
          <ExternalLink className="size-4" /> Open in email app
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={composeHref} aria-label="Send from core-remodel" />}>
          <Send className="size-4" /> Send from core-remodel
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async (e) => {
            // Keep the menu's default close, but run the copy first.
            e.preventDefault();
            const ok = await copyText(email);
            if (ok) {
              setCopied(true);
              toast.success("Email copied");
              setTimeout(() => setCopied(false), 1500);
            } else {
              toast.error("Could not copy");
            }
          }}
        >
          {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy address"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
