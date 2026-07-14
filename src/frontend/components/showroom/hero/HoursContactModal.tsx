/**
 * @fileoverview HoursContactModal — full business hours + contact info + map.
 *
 * Opened from the hero's HoursMiniCard. Three blocks:
 *   1. Weekly hours table — one row per day from the structured `hoursJson`
 *      (today highlighted); falls back to the legacy weekday/weekend summary
 *      strings for pre-normalization rows.
 *   2. Contact — click-to-call phone, email, website, address.
 *   3. Map — keyless Google Maps embed centered on the store's address, plus a
 *      "Open in Google Maps" link (prefers the stored place-id deep link).
 */

import { Clock, ExternalLink, Globe, Mail, MapPin, Pencil, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { DayKey, HoursJson } from "../intake/hours-types";
import { DAY_KEYS, DAY_LABELS, to12h } from "../intake/hours-types";

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
    <ul className="divide-y divide-border/40">
      {DAY_KEYS.map((key) => {
        const slot = hoursJson[key] ?? null;
        const isToday = key === todayKey;
        return (
          <li
            key={key}
            className={`flex items-center justify-between py-1.5 text-sm ${
              isToday ? "font-medium text-foreground" : "text-muted-foreground"
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

/** Small inline "Edit" affordance rendered beside a section heading. */
function EditLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <Pencil className="size-3" /> {label}
    </Button>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4" /> {store.name}
          </DialogTitle>
          <DialogDescription>Business hours, contact, and location.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {/* ── Weekly hours ── */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Hours
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
              <div className="mt-1.5">
                <WeeklyHoursTable hoursJson={store.hoursJson} />
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground/70">
                No hours on file yet — run a backfill or edit the showroom to add
                them.
              </p>
            )}
          </section>

          {/* ── Contact ── */}
          <section>
            <div className="flex items-center justify-between">
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
            <div className="mt-1.5 space-y-1.5 text-sm">
              {store.phoneNumber ? (
                <a
                  href={`tel:${store.phoneNumber.replace(/[^\d+]/g, "")}`}
                  className="flex items-center gap-2 font-medium text-sky-400 hover:text-sky-300"
                >
                  <Phone className="size-3.5 shrink-0" />
                  {formatPhone(store.phoneNumber)}
                </a>
              ) : null}
              {store.emailAddress ? (
                <a
                  href={`mailto:${store.emailAddress}`}
                  className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Mail className="size-3.5 shrink-0" />
                  {store.emailAddress}
                </a>
              ) : null}
              {store.websiteUrl ? (
                <a
                  href={store.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Globe className="size-3.5 shrink-0" />
                  <span className="truncate">{store.websiteUrl}</span>
                </a>
              ) : null}
              {store.locationAddress ? (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  {store.locationAddress}
                </p>
              ) : null}
              {!store.phoneNumber &&
              !store.emailAddress &&
              !store.websiteUrl &&
              !store.locationAddress ? (
                <p className="text-muted-foreground/70">No contact info on file.</p>
              ) : null}
            </div>
          </section>

          {/* ── Map ── */}
          {mapSrc ? (
            <section>
              <div className="flex items-center justify-between">
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
              <div className="mt-1.5 overflow-hidden rounded-lg ring-1 ring-border/40">
                <iframe
                  src={mapSrc}
                  title={`Map of ${store.name}`}
                  className="h-56 w-full"
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
