/**
 * Project changelog — rendered at /admin/changelog as an overview grouped by
 * BRANCH / PR. Each branch of work is one `ChangelogBranch`; the individual
 * changes shipped on it (the "phases") are `ChangelogEntry` rows tagged with the
 * branch id. Newest branch first; newest entry first within a branch.
 *
 * `status` is "shipped" once live on prod, "staged" while merged/committed but
 * the prod migrations + backfills haven't been applied yet.
 */

export type ChangeKind = "added" | "changed" | "removed" | "migration" | "fixed";

export interface ChangelogChange {
  kind: ChangeKind;
  text: string;
}

/** A branch / PR — the top-level grouping in the overview. */
export interface ChangelogBranch {
  /** Git branch name — the join key for entries. */
  branch: string;
  /** Human title for the body of work. */
  title: string;
  /** One-line description of the branch. */
  summary?: string;
  /** ISO date the branch was opened / last updated. */
  date: string;
  status: "shipped" | "staged" | "open";
  /** GitHub PR number, once opened. */
  prNumber?: number;
  /** Full URL to the PR. */
  prUrl?: string;
  /** Branch-level Mermaid diagrams (architecture ER, build timeline). */
  diagrams?: { caption: string; code: string }[];
}

export interface ChangelogEntry {
  id: string;
  /** Branch this change belongs to — matches a ChangelogBranch.branch. */
  branch: string;
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
}

/** Branches / PRs, newest first. The overview lists these; entries nest under. */
export const BRANCHES: ChangelogBranch[] = [
  {
    branch: "claude/showroom-stores-cleanup-775bb5",
    title: "Showroom stores cleanup",
    summary:
      "Untangled the overgrown showroom_stores table into normalized child tables and a single-payload write model — hours, address, links, contacts + business-card vision, and email auto-population.",
    date: "2026-07-13",
    status: "staged",
    // prNumber / prUrl set once the PR is opened.
    diagrams: [
      {
        caption: "Architecture (after) — showroom_stores shed its inline columns into typed child tables.",
        code: `erDiagram
  showroom_stores ||--o{ showroom_store_hours : "hours"
  showroom_stores ||--o{ showroom_store_links : "urls"
  showroom_stores ||--o{ showroom_store_contacts : "people"
  showroom_store_contacts ||--o{ showroom_store_contact_log : "interactions"
  showroom_store_contacts ||--o{ showroom_store_contact_business_cards : "cards"
  showroom_stores {
    integer id PK
    text name
    text location_city
    text location_state
    integer is_open_weekends
  }
  showroom_store_hours {
    integer id PK
    integer showroom_id FK
    text day
    integer open_hour
    integer close_hour
  }
  showroom_store_links {
    integer id PK
    integer store_id FK
    text url
    text type
  }
  showroom_store_contacts {
    integer id PK
    integer store_id FK
    text type
    text first_name
    text last_name
    text email_address
    integer is_draft
  }
  showroom_store_contact_log {
    integer id PK
    integer store_contact_id FK
    text outcome_of_conversation
  }
  showroom_store_contact_business_cards {
    integer id PK
    integer contact_id FK
    text status
    text cf_image_url
  }`,
      },
      {
        caption: "Build timeline — the five phases on this branch.",
        code: `gitGraph
  commit id: "Phase 1 hours"
  commit id: "Phase 2 address"
  commit id: "Phase 3 links"
  commit id: "Phase 4 contacts"
  commit id: "Phase 5 email"
  commit id: "changelog + docs"`,
      },
    ],
  },
];

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "showroom-email-contacts",
    branch: "claude/showroom-stores-cleanup-775bb5",
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
    branch: "claude/showroom-stores-cleanup-775bb5",
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
    branch: "claude/showroom-stores-cleanup-775bb5",
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
    branch: "claude/showroom-stores-cleanup-775bb5",
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
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-13",
    tag: "Phase 1",
    area: "Showrooms",
    title: "Hours untangled to a single source",
    summary:
      "Opening hours were stored three different ways. Now there is ONE: the normalized showroom_store_hours rows. You write a structured hoursJson payload; the worker turns it into rows + the open-weekends flag, and responses rebuild the payload from the rows.",
    status: "staged",
    migrations: ["0082", "0083", "0089"],
    changes: [
      { kind: "removed", text: "The hours_json blob column is GONE — showroom_store_hours rows are the sole source of truth (migration 0089; blobs backfilled to rows first)." },
      { kind: "changed", text: "Renamed the normalized table showroom_hours → showroom_store_hours." },
      { kind: "removed", text: "Redundant free-text weekday_hours / weekend_hours columns." },
      { kind: "added", text: "API create/update accept a hoursJson payload → rows; GET responses derive hoursJson from the rows. New MCP tool set_showroom_hours." },
      { kind: "fixed", text: "Deduplicated the hours parser (two copies) onto one shared util." },
    ],
  },
];
