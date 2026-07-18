/**
 * @fileoverview HoursContactModal — full showroom hours + contact + map.
 *
 * Opened from the hero's HoursMiniCard, at ~80% of the viewport (see
 * `touch-dialog`) because this is the screen you actually use standing at the
 * car. Blocks, in order:
 *   0. Action row — Call / Copy address / Send to Tesla. Large, and FIRST,
 *      because these are the three things you want while parked and they were
 *      previously buried under a scroll as small text links.
 *   1. Weekly hours table — one row per day from the structured `hoursJson`
 *      (today highlighted, PST), with a live open/closed badge in the header
 *      and an optional inline "Edit hours" affordance.
 *   2. Contact cards — click-to-call phone (tel:), copy-to-clipboard email +
 *      address, and an open-in-new-tab website.
 *   3. Map — keyless Google Maps embed centered on the store's address, plus a
 *      "Open in Google Maps" link (prefers the stored place-id deep link).
 */

import { useState } from "react";
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Navigation,
  Pencil,
  Phone,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "src/frontend/lib/utils";

import type { DayKey, HoursJson } from "../intake/hours-types";
import { DAY_KEYS, DAY_LABELS, to12h } from "../intake/hours-types";
import {
  computeOpenBadge,
  hoursJsonToRows,
  pstNow,
  type OpenBadge,
} from "../hours-status";
import { TOUCH_DIALOG_BODY_CLASS, TOUCH_DIALOG_CLASS } from "./touch-dialog";

/** The store fields the modal renders. All nullable — render defensively. */
export interface HoursContactStore {
  name: string;
  hoursJson: HoursJson | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  websiteUrl: string | null;
  locationAddress: string | null;
  googleMapsLink: string | null;
  cityName: string | null;
  /** Precise coords when known — preferred over the address text for Tesla nav. */
  latitude?: number | null;
  longitude?: number | null;
}

/** Format one day's window as "9:00 AM – 5:00 PM". */
function windowLabel(open: string, close: string): string {
  const o = to12h(open);
  const c = to12h(close);
  return `${o.time} ${o.period} – ${c.time} ${c.period}`;
}

/** JS getDay() (0=Sun) → our DayKey. */
const JS_DAY_TO_KEY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function WeeklyHoursTable({ hoursJson }: { hoursJson: HoursJson }) {
  // Highlight the PST "today" so it matches the PST-based status badge (a
  // browser in another timezone would otherwise highlight the wrong row).
  const todayKey = JS_DAY_TO_KEY[pstNow().day];
  return (
    <ul className="space-y-0.5">
      {DAY_KEYS.map((key) => {
        const slot = hoursJson[key] ?? null;
        const isToday = key === todayKey;
        return (
          <li
            key={key}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
              isToday ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground"
            }`}
          >
            <span className="flex items-center gap-2">
              {DAY_LABELS[key].full}
              {isToday ? (
                <span className="rounded-full bg-primary/15 px-1.5 py-0 text-[10px] font-medium text-primary">
                  Today
                </span>
              ) : null}
            </span>
            <span className={slot ? "" : "text-muted-foreground/60"}>
              {slot ? windowLabel(slot.open, slot.close) : "Closed"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Format a US 10-digit phone as "(###) ### - ####"; pass through otherwise. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)} - ${ten.slice(6)}`;
}

/** Header open/closed badge → label + tint (mirrors the hero mini-card). */
const BADGE_STYLES: Record<OpenBadge, { label: string; className: string }> = {
  open: { label: "Open Now", className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  "closing-soon": {
    label: "Closing Soon",
    className: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  },
  "opening-soon": { label: "Opening Soon", className: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  closed: { label: "Closed Today", className: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
};

/** Small inline "Edit" affordance rendered beside a section heading. */
function EditLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="h-9 gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground"
    >
      <Pencil className="size-3.5" /> {label}
    </Button>
  );
}

/** Shared shell for a tappable contact tile (link or copy-button). */
function ContactTile({
  icon,
  label,
  value,
  onClick,
  href,
  target,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
  href?: string;
  target?: string;
}) {
  const inner = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground/70">
          {label}
        </span>
        <span className="block truncate text-sm font-medium text-foreground">{value}</span>
      </span>
    </>
  );
  const cls =
    "flex min-h-14 w-full items-center gap-3 rounded-lg bg-card p-3 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/40";
  if (href) {
    return (
      <a
        href={href}
        target={target}
        rel={target === "_blank" ? "noreferrer" : undefined}
        className={cls}
      >
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/**
 * Copy `text`, with a fallback for embedded webviews.
 *
 * `navigator.clipboard` is undefined in a non-secure context and in some
 * in-car/embedded browsers — which is exactly the environment this modal is
 * built for, so a bare `navigator.clipboard.writeText` would TypeError there.
 * Falls back to the legacy `execCommand("copy")` over an offscreen textarea,
 * which those webviews do still support. Returns whether the copy landed.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or unavailable — fall through to the legacy path.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
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

// ─── Action row ───────────────────────────────────────────────────────────────

/** Big-button sizing for the action row — the in-car tap targets. */
const ACTION_BTN = "h-14 flex-1 basis-40 gap-2 text-base";

/**
 * Call / Copy address / Send to Tesla, at the top of the modal.
 *
 * Copy and Navigate report their result INSIDE the button (green check / red X)
 * rather than only via a toast, because a toast is easy to miss on a car screen;
 * a failed navigate additionally prints the reason underneath, since "did the
 * car get it?" is the only question that matters here.
 */
function ActionRow({ store }: { store: HoursContactStore }) {
  const [copied, setCopied] = useState(false);
  const [navState, setNavState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [navError, setNavError] = useState<string | null>(null);

  const tel = store.phoneNumber ? `tel:${store.phoneNumber.replace(/[^\d+]/g, "")}` : null;

  const copyAddress = async () => {
    if (!store.locationAddress) return;
    if (await copyText(store.locationAddress)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const sendToTesla = async () => {
    setNavState("sending");
    setNavError(null);
    // Coords are exact; the address text is the fallback the car geocodes itself.
    const body =
      store.latitude != null && store.longitude != null
        ? { lat: store.latitude, lng: store.longitude }
        : { destination: store.locationAddress ?? "" };
    try {
      const res = await fetch("/api/tesla/navigate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok === true) {
        setNavState("ok");
        setTimeout(() => setNavState("idle"), 4000);
      } else {
        setNavState("error");
        setNavError(data.error ?? `Failed to send to Tesla (${res.status})`);
      }
    } catch (e) {
      setNavState("error");
      setNavError((e as Error).message || "Failed to send to Tesla");
    }
  };

  const canNavigate = Boolean(
    (store.latitude != null && store.longitude != null) || store.locationAddress,
  );

  if (!tel && !store.locationAddress && !canNavigate) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {tel ? (
          <a href={tel} className={cn(buttonVariants({ size: "lg" }), ACTION_BTN)}>
            <Phone className="size-5" /> Call
          </a>
        ) : null}

        {store.locationAddress ? (
          <Button
            variant="outline"
            size="lg"
            className={ACTION_BTN}
            onClick={() => void copyAddress()}
          >
            {copied ? (
              <Check className="size-5 text-emerald-400" />
            ) : (
              <Copy className="size-5" />
            )}
            Copy address
          </Button>
        ) : null}

        {canNavigate ? (
          <Button
            variant="outline"
            size="lg"
            className={ACTION_BTN}
            disabled={navState === "sending"}
            onClick={() => void sendToTesla()}
          >
            {navState === "sending" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : navState === "ok" ? (
              <Check className="size-5 text-emerald-400" />
            ) : navState === "error" ? (
              <X className="size-5 text-rose-400" />
            ) : (
              <Navigation className="size-5" />
            )}
            Navigate
          </Button>
        ) : null}
      </div>

      {navState === "error" && navError ? (
        <p className="mt-1.5 text-sm text-rose-400">{navError}</p>
      ) : null}
    </div>
  );
}

export function HoursContactModal({
  store,
  open,
  onOpenChange,
  onEditHours,
  onEditAddress,
}: {
  store: HoursContactStore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, an "Edit" affordance appears by the Hours heading (closes this modal first). */
  onEditHours?: () => void;
  /** When set, an "Edit" affordance appears by the Contact/address block. */
  onEditAddress?: () => void;
}) {
  // Keyless Maps embed: query by address (or name + city as a fallback).
  const mapQuery =
    store.locationAddress ??
    [store.name, store.cityName].filter(Boolean).join(", ");
  const mapSrc = mapQuery
    ? `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=14&output=embed`
    : null;
  const mapsHref =
    store.googleMapsLink ??
    (mapQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
      : null);

  const badge = store.hoursJson
    ? computeOpenBadge(hoursJsonToRows(store.hoursJson), pstNow())
    : null;

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`${what} copied`);
    else toast.error("Couldn't copy to clipboard");
  };

  const hasContact =
    store.phoneNumber || store.emailAddress || store.websiteUrl || store.locationAddress;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={TOUCH_DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Clock className="size-4" /> {store.name}
            {badge ? (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${BADGE_STYLES[badge].className}`}
              >
                {BADGE_STYLES[badge].label}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>Business hours, contact, and location.</DialogDescription>
        </DialogHeader>

        {/* Fixed above the scroll area — the reason the modal was opened. */}
        <ActionRow store={store} />

        <div className={`${TOUCH_DIALOG_BODY_CLASS} space-y-6`}>
          {/* ── Weekly hours ── */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Showroom Hours
              </h3>
              {onEditHours ? (
                <EditLink
                  label="Edit hours"
                  onClick={() => {
                    onOpenChange(false);
                    onEditHours();
                  }}
                />
              ) : null}
            </div>
            {store.hoursJson ? (
              <div className="rounded-lg bg-card p-2 ring-1 ring-border/40">
                <WeeklyHoursTable hoursJson={store.hoursJson} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/70">
                No hours on file yet — run a backfill or edit the showroom to add them.
              </p>
            )}
          </section>

          {/* ── Contact ── */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Contact
              </h3>
              {onEditAddress ? (
                <EditLink
                  label="Edit address"
                  onClick={() => {
                    onOpenChange(false);
                    onEditAddress();
                  }}
                />
              ) : null}
            </div>
            {hasContact ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {store.phoneNumber ? (
                  <ContactTile
                    icon={<Phone className="size-4" />}
                    label="Tap to call"
                    value={formatPhone(store.phoneNumber)}
                    href={`tel:${store.phoneNumber.replace(/[^\d+]/g, "")}`}
                  />
                ) : null}
                {store.emailAddress ? (
                  <ContactTile
                    icon={<Mail className="size-4" />}
                    label="Tap to copy email"
                    value={store.emailAddress}
                    onClick={() => copy(store.emailAddress as string, "Email")}
                  />
                ) : null}
                {store.websiteUrl ? (
                  // Labelled, not the raw URL — a long URL is unreadable at a
                  // glance and this is a button you press, not text you read.
                  <ContactTile
                    icon={<Globe className="size-4" />}
                    label="Website"
                    value="[Open website]"
                    href={store.websiteUrl}
                    target="_blank"
                  />
                ) : null}
                {store.locationAddress ? (
                  <ContactTile
                    icon={<MapPin className="size-4" />}
                    label="Tap to copy address"
                    value={store.locationAddress}
                    onClick={() => copy(store.locationAddress as string, "Address")}
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/70">No contact info on file.</p>
            )}
          </section>

          {/* ── Map ── */}
          {mapSrc ? (
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Location
                </h3>
                {mapsHref ? (
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Open in Google Maps <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
              <div className="overflow-hidden rounded-lg ring-1 ring-border/40">
                <iframe
                  src={mapSrc}
                  title={`Map of ${store.name}`}
                  className="h-72 w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              </div>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
