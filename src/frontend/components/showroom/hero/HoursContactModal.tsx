/**
 * @fileoverview HoursContactModal — full showroom hours + contact + map.
 *
 * Opened from the hero's HoursMiniCard. Four blocks in a roomy dialog:
 *   1. Weekly hours table — one row per day from the structured `hoursJson`
 *      (today highlighted); falls back to the legacy weekday/weekend summary
 *      strings for pre-normalization rows. A live open/closed badge sits in the
 *      header.
 *   2. Contact cards — click-to-call phone (tel:), copy-to-clipboard email +
 *      address, and an open-in-new-tab website. Built for phone / in-car use.
 *   3. Map — keyless Google Maps embed centered on the store's address, plus a
 *      "Open in Google Maps" link (prefers the stored place-id deep link).
 */

import { Clock, ExternalLink, Globe, Mail, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { DayKey, HoursJson } from "../intake/hours-types";
import { DAY_KEYS, DAY_LABELS, to12h } from "../intake/hours-types";
import {
  computeOpenBadge,
  computePst,
  hourRowsFromHoursJson,
  type OpenBadge,
} from "../hours-status";

/** The store fields the modal renders. All nullable — render defensively. */
export interface HoursContactStore {
  name: string;
  hoursJson: HoursJson | null;
  weekdayHours: string | null;
  weekendHours: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  websiteUrl: string | null;
  locationAddress: string | null;
  googleMapsLink: string | null;
  cityName: string | null;
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
  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
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
    "flex w-full items-center gap-3 rounded-lg bg-card p-3 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/40";
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

export function HoursContactModal({
  store,
  open,
  onOpenChange,
}: {
  store: HoursContactStore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    ? computeOpenBadge(hourRowsFromHoursJson(store.hoursJson), computePst())
    : null;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const hasContact =
    store.phoneNumber || store.emailAddress || store.websiteUrl || store.locationAddress;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-hidden">
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
          <DialogDescription>Showroom hours, contact, and location.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-6 overflow-y-auto pr-1">
          {/* ── Weekly hours ── */}
          <section>
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Showroom Hours
            </h3>
            {store.hoursJson ? (
              <div className="rounded-lg bg-card p-2 ring-1 ring-border/40">
                <WeeklyHoursTable hoursJson={store.hoursJson} />
              </div>
            ) : store.weekdayHours || store.weekendHours ? (
              <div className="space-y-1 rounded-lg bg-card p-3 text-sm text-muted-foreground ring-1 ring-border/40">
                {store.weekdayHours ? <p>{store.weekdayHours}</p> : null}
                {store.weekendHours ? <p>{store.weekendHours}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/70">
                No hours on file yet — run a backfill or edit the showroom to add them.
              </p>
            )}
          </section>

          {/* ── Contact ── */}
          <section>
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Contact
            </h3>
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
                  <ContactTile
                    icon={<Globe className="size-4" />}
                    label="Open website"
                    value={store.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
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
