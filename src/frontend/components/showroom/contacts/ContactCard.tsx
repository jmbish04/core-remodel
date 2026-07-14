/**
 * @fileoverview ContactCard — one showroom contact row, tuned for touch dialing.
 *
 * Shared by the Contacts phonebook (`/admin/shopping/contacts`) and the single
 * showroom viewport's Contacts section. Every phone number is a `tel:` link that
 * shows the FULL formatted number (with "ext. NNN" appended) so a tap on a phone
 * or the Tesla browser dials straight out; email is a `mailto:`.
 *
 * A GENERAL_CONTACT row represents the store's front-desk line, so it uses the
 * STORE name as its title + a "General" badge. A person uses "First Last" + a
 * colour-coded type badge.
 */

import {
  Mail,
  MessageSquare,
  Phone,
  Printer,
  Smartphone,
  Store,
} from "lucide-react";

// ─── Types (shared) ───────────────────────────────────────────────────────────

export const CONTACT_TYPES = [
  "GENERAL_CONTACT",
  "SALES",
  "ESTIMATOR",
  "MANAGER",
  "CUSTOMER_SERVICE",
  "OTHER",
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

export interface ContactRow {
  id: number;
  storeId: number | null;
  storeName: string | null;
  type: ContactType;
  firstName: string | null;
  lastName: string | null;
  notes: string | null;
  officePhoneNumber: string | null;
  officePhoneExtension: string | null;
  mobilePhoneNumber: string | null;
  faxPhoneNumber: string | null;
  emailAddress: string | null;
  isTextingOk: boolean;
  bestContactTimesJson: string | null;
  isDraft: boolean;
  draftNotes: string | null;
  timestamp: string | null;
}

// ─── Formatting helpers (shared) ──────────────────────────────────────────────

/** Format a US 10-digit phone as "(###) ### - ####"; pass anything else through. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)} - ${ten.slice(6)}`;
}

/**
 * Build a dialable `tel:` URI. Normalizes to +1XXXXXXXXXX for 10/11-digit US
 * numbers, otherwise passes the raw digits through with a leading +. When an
 * extension is present it's appended after a comma so the dialer pauses then
 * sends the ext.
 */
export function telHref(
  raw: string | null | undefined,
  ext?: string | null,
): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const base = ten.length === 10 ? `+1${ten}` : `+${digits}`;
  const e = (ext ?? "").replace(/\D/g, "");
  // ponytail: comma = dialer pause-then-send-ext; works on iOS/Android/Tesla.
  return e ? `${base},${e}` : base;
}

/** Best display name for a person; empty string for general/nameless rows. */
export function contactPersonName(c: ContactRow): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
}

/** The heading a card/section shows for a contact. */
export function contactTitle(c: ContactRow): string {
  if (c.type === "GENERAL_CONTACT") return c.storeName?.trim() || "General contact";
  return contactPersonName(c) || c.storeName?.trim() || "Unnamed contact";
}

const TYPE_LABEL: Record<ContactType, string> = {
  GENERAL_CONTACT: "General",
  SALES: "Sales",
  ESTIMATOR: "Estimator",
  MANAGER: "Manager",
  CUSTOMER_SERVICE: "Customer Service",
  OTHER: "Other",
};

/** Per-type badge palette (Monolith ring-tinted chips, one hue per type). */
const TYPE_BADGE: Record<ContactType, string> = {
  GENERAL_CONTACT: "bg-muted/60 text-muted-foreground ring-border/40",
  SALES: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  ESTIMATOR: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  MANAGER: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  CUSTOMER_SERVICE: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  OTHER: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};

export function ContactTypeBadge({ type }: { type: ContactType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ${TYPE_BADGE[type]}`}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

// ─── Phone / email lines ──────────────────────────────────────────────────────

function PhoneLine({
  icon,
  label,
  raw,
  ext,
}: {
  icon: React.ReactNode;
  label: string;
  raw: string | null;
  ext?: string | null;
}) {
  const href = telHref(raw, ext);
  if (!href) return null;
  const display = `${formatPhone(raw)}${ext ? ` ext. ${ext}` : ""}`;
  return (
    <a
      href={`tel:${href}`}
      className="inline-flex items-center gap-1.5 font-medium text-sky-400 hover:text-sky-300"
    >
      {icon}
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="tabular-nums">{display}</span>
    </a>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function ContactCard({
  contact,
  className,
  showStoreLink = true,
}: {
  contact: ContactRow;
  className?: string;
  /** Show the "at {store}" link for people (hidden inside a store's own tab). */
  showStoreLink?: boolean;
}) {
  const c = contact;
  const isGeneral = c.type === "GENERAL_CONTACT";
  const title = contactTitle(c);
  const bestTimes = c.bestContactTimesJson?.trim();

  return (
    <div className={`rounded-xl bg-card p-4 ring-1 ring-border/40 ${className ?? ""}`}>
      {/* Heading + type + draft badges */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-card-foreground">{title}</h3>
        {isGeneral ? <ContactTypeBadge type="GENERAL_CONTACT" /> : <ContactTypeBadge type={c.type} />}
        {c.isTextingOk ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
            <MessageSquare className="size-2.5" /> Texts OK
          </span>
        ) : null}
        {c.isDraft ? (
          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30">
            Draft
          </span>
        ) : null}
      </div>

      {/* "at {store}" link — for people, when they belong to a store. */}
      {showStoreLink && !isGeneral && c.storeId != null && c.storeName ? (
        <a
          href={`/admin/shopping/store/${c.storeId}`}
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Store className="size-3" /> {c.storeName}
        </a>
      ) : null}

      {/* Contact lines */}
      <div className="mt-2.5 flex flex-col gap-1.5 text-[13px]">
        <PhoneLine
          icon={<Phone className="size-3.5" />}
          label="Office"
          raw={c.officePhoneNumber}
          ext={c.officePhoneExtension}
        />
        <PhoneLine
          icon={<Smartphone className="size-3.5" />}
          label="Mobile"
          raw={c.mobilePhoneNumber}
        />
        <PhoneLine
          icon={<Printer className="size-3.5" />}
          label="Fax"
          raw={c.faxPhoneNumber}
        />
        {c.emailAddress ? (
          <a
            href={`mailto:${c.emailAddress}`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Mail className="size-3.5" />
            <span className="truncate">{c.emailAddress}</span>
          </a>
        ) : null}
      </div>

      {/* Best times + notes + draft notes */}
      {bestTimes ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-widest text-muted-foreground/70">
            Best times:{" "}
          </span>
          {bestTimes}
        </p>
      ) : null}
      {c.notes?.trim() ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{c.notes}</p>
      ) : null}
      {c.isDraft && c.draftNotes?.trim() ? (
        <p className="mt-1.5 text-xs italic text-amber-300/80">{c.draftNotes}</p>
      ) : null}
    </div>
  );
}
