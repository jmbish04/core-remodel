/**
 * Project changelog — release notes rendered at /admin/changelog.
 *
 * Newest entry first. Each phase of a build appends one entry. `status` is
 * "shipped" once live on prod, "staged" while the code is merged/committed but
 * the prod migrations + backfills have not been applied yet.
 */

export type ChangeKind = "added" | "changed" | "removed" | "migration" | "fixed";

export interface ChangelogChange {
  kind: ChangeKind;
  text: string;
}

export interface ChangelogEntry {
  id: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Optional phase/version tag, e.g. "Phase 1". */
  tag?: string;
  /** Product area, e.g. "Showrooms". */
  area: string;
  title: string;
  summary: string;
  changes: ChangelogChange[];
  /** drizzle migration tags applied by this entry. */
  migrations?: string[];
  status: "shipped" | "staged";
  /** GitHub PR number this entry shipped in (once opened). */
  prNumber?: number;
  /** Full URL to the PR. */
  prUrl?: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "showroom-email-contacts",
    date: "2026-07-13",
    tag: "Phase 5",
    area: "Showrooms",
    title: "Emails become contacts automatically",
    summary:
      "When a showroom emails you, the platform reads the signature and files the sender into the phonebook — mapped to the right showroom by email domain or name. Senders it can’t place are saved as drafts for a quick one-tap map.",
    status: "staged",
    changes: [
      { kind: "added", text: "Inbound worker email (remodel@hacolby.app) auto-registers a showroom contact from the sender’s signature (name, email, phone, website)." },
      { kind: "added", text: "Domain/name matching maps the contact to the right showroom; unmatched senders are saved as draft contacts for triage in the phonebook." },
      { kind: "changed", text: "Only runs when the sender isn’t already a known contractor company (those stay in the CRM), and de-duplicates on the sender email." },
    ],
  },
  {
    id: "showroom-contacts",
    date: "2026-07-13",
    tag: "Phase 4",
    area: "Showrooms",
    title: "Contacts phonebook + business-card scanning",
    summary:
      "A real contact system for showroom reps: a searchable phonebook you can tap to call or email, a store-level general line, and bulk business-card import that reads the card with vision and files the details into the right place.",
    status: "staged",
    migrations: ["0087"],
    changes: [
      { kind: "added", text: "Contacts phonebook at Shopping → Contacts: search, type filter, A–Z quick-jump rail, and tap-to-dial / tap-to-email numbers for phone and Tesla screens." },
      { kind: "added", text: "A Contacts tab on each showroom, showing that store’s general line + people." },
      { kind: "added", text: "Bulk business-card import: drop in photos, a vision model extracts each card and creates the contact; cards it can’t read are flagged for a quick manual entry." },
      { kind: "added", text: "Smart intake splits a person’s cell/direct/office numbers, promotes the office line to the store’s general contact, and routes the website + address to the right tables — you just send the raw details." },
      { kind: "added", text: "Interaction log per contact (what was said, when, follow-ups) + MCP tools so an AI can add contacts and resolve failed cards." },
    ],
  },
  {
    id: "showroom-links",
    date: "2026-07-13",
    tag: "Phase 3",
    area: "Showrooms",
    title: "Links table — one home for every showroom URL",
    summary:
      "Website + social URLs moved off the store row into a typed showroom_store_links table. The store viewport, directory, and API keep working unchanged — responses derive the old flat fields from the links.",
    status: "staged",
    migrations: ["0085", "0086"],
    changes: [
      { kind: "added", text: "showroom_store_links table: one row per link, typed WEBSITE / INSTAGRAM / PINTEREST / FACEBOOK / OTHER with url_notes." },
      { kind: "added", text: "Send a links[] payload on create/update (replace-all), or manage them one at a time via /:id/links CRUD." },
      { kind: "changed", text: "Favicon + website scrape now source the site from the WEBSITE link; the scrape writes any Instagram it finds as an INSTAGRAM link." },
      { kind: "removed", text: "Flat website_url / instagram_url / facebook_url / pinterest_url columns on showroom_stores." },
    ],
  },
  {
    id: "showroom-address",
    date: "2026-07-13",
    tag: "Phase 2",
    area: "Showrooms",
    title: "Addresses split into real parts",
    summary:
      "City-only stubs like “San Carlos, CA” are replaced with full Google-verified addresses, broken into street number, street, city, state, and ZIP — plus a filled-in Google Maps link.",
    status: "staged",
    migrations: ["0084"],
    changes: [
      { kind: "added", text: "Granular location_street_number / _street_name / _city / _state / _zip_code columns." },
      { kind: "added", text: "Address backfill from Google Places (dry-run by default) that overwrites city-only stubs with the full formatted address + maps link." },
    ],
  },
  {
    id: "showroom-hours",
    date: "2026-07-13",
    tag: "Phase 1",
    area: "Showrooms",
    title: "Hours untangled to a single source",
    summary:
      "Opening hours were stored three different ways. Now there is one: a structured hours_json you write, from which the queryable per-day rows and the open-weekends flag are derived automatically.",
    status: "staged",
    migrations: ["0082", "0083"],
    changes: [
      { kind: "changed", text: "hours_json is the single write source of truth; the worker derives the per-day rows + is_open_weekends." },
      { kind: "changed", text: "Renamed the normalized table showroom_hours → showroom_store_hours." },
      { kind: "removed", text: "Redundant free-text weekday_hours / weekend_hours columns (backfilled into hours_json first)." },
      { kind: "fixed", text: "Deduplicated the hours parser (two copies) onto one shared util." },
    ],
  },
];
