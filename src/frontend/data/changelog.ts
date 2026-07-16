/**
 * Project changelog — the bundled seed/fallback for the persistent D1 store.
 *
 * The source of truth is D1 (`changelog_branches` + `changelog_entries`), which
 * accumulates across every branch/PR and is never overwritten. This file is
 * (1) the one-time seed for a fresh DB (POST /api/changelog/seed) and (2) the
 * SSR fallback the overview renders when D1 is empty. Each new branch appends a
 * `ChangelogBranch` + its `ChangelogEntry` rows here, then registers them into
 * D1 (POST /api/changelog/branches + /entries) so the record persists forever.
 */

export type ChangeKind = "added" | "changed" | "removed" | "migration" | "fixed";

export interface ChangelogChange {
  kind: ChangeKind;
  text: string;
}

export interface ChangelogBranch {
  branch: string;
  title: string;
  summary?: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  status: "shipped" | "staged" | "open";
  prNumber?: number;
  prUrl?: string;
}

export interface ChangelogEntry {
  id: string;
  branch: string;
  date: string;
  tag?: string;
  area: string;
  title: string;
  summary: string;
  changes: ChangelogChange[];
  migrations?: string[];
  status: "shipped" | "staged";
}

/** Branches / PRs, newest first. */
export const BRANCHES: ChangelogBranch[] = [
  {
    branch: "claude/changelog-preview",
    title: "Changelog preview — the presser, drafted in advance",
    summary:
      "The changelog list + viewport now render through the four beste blocks they were always meant to use, and gain a /preview twin: every proposed change, reviewable on the deployed worker before it lands. Diagrams render with the shadcn-registry mermaid (zoom/pan).",
    date: "2026-07-16",
    status: "staged",
  },
  {
    branch: "claude/showroom-stores-cleanup-775bb5",
    title: "Showroom stores cleanup (Phases 1–6) + persistent changelog",
    summary:
      "Untangled the overgrown showroom_stores table into normalized child tables and a single-payload write model — hours, address, links, contacts + business-card vision, and email auto-population. One additive migration (0108); the legacy flat columns are retained as deprecated so the one-time backfill can read them, and are dropped in a follow-up migration once that backfill is confirmed on prod.",
    date: "2026-07-14",
    status: "staged",
    prNumber: 128,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/128",
  },
  {
    branch: "claude/email-structured-extraction",
    title: "Structured email extraction (fix the phantom 'total not stated')",
    summary:
      "Inbound-email classification now uses a native Gemini responseSchema instead of a prompt-embedded schema, so receipts/invoices extract every printed field and the model stops hallucinating 'the total is not stated — check your payment method' on receipts whose total is printed.",
    date: "2026-07-14",
    status: "staged",
    prNumber: 129,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/129",
  },
  {
    branch: "claude/worker-inbox-hitl-v2",
    title: "Persistent append-only changelog",
    summary:
      "A durable, D1-backed changelog that accumulates across every branch/PR and is never overwritten by a static file — with a full detail page per entry and an agent-facing standard for keeping it current.",
    date: "2026-07-14",
    status: "staged",
    prNumber: 127,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/127",
  },
];

/** Entries, newest first within a branch. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "changelog-preview",
    branch: "claude/changelog-preview",
    date: "2026-07-16",
    tag: "Changelog",
    area: "Changelog",
    title: "Changelog preview — review the release notes before they ship",
    summary:
      "A /admin/changelog/preview twin that lists every proposed (staged) change and renders it through the exact same template the shipped changelog uses — so the presser you sign off on is literally what deploys. The changelog itself now uses the four beste blocks it was specced for, and diagrams render with the shadcn-registry mermaid (zoom/pan).",
    status: "staged",
    changes: [
      { kind: "added", text: "/admin/changelog/preview — every proposed change, drafted as release notes before deploy" },
      { kind: "added", text: "/admin/changelog/preview/[slug] — full proposal viewport: diagrams, developer changelog, recap" },
      { kind: "added", text: "Sidebar: Changelog Preview under System" },
      { kind: "changed", text: "Changelog list now renders changelog24 (release highlights) + changelog3 (release feed)" },
      { kind: "changed", text: "Changelog viewport now renders changelog19 (developer changelog + code) + changelog21 (Features/Fixes/Improvements recap)" },
      { kind: "changed", text: "Diagrams switched to the shadcn-registry mermaid (mermaidcn) with zoom/pan" },
      { kind: "changed", text: "Changelog + preview share one view + one mapper, so the two can never drift" },
      { kind: "fixed", text: "Sidebar no longer lights up Changelog and Changelog Preview at the same time" },
    ],
  },
  {
    id: "showroom-editing",
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-14",
    tag: "Phase 6",
    area: "Showrooms",
    title: "Edit hours, address & links — and smarter contact intake",
    summary:
      "Everything the cleanup normalized can now be corrected after intake — hours, address, and links — from the API, an MCP tool, or the showroom page. And a business card that carries store details now fills the showroom in automatically.",
    status: "staged",
    changes: [
      { kind: "added", text: "Correct a showroom's hours / address / links after intake — PUT /:id/hours, PUT /:id/address, /:id/links CRUD, plus a Contacts-style editor on the showroom page." },
      { kind: "added", text: "MCP tools set_showroom_address + set_showroom_links (with set_showroom_hours) so an AI or a script can bulk-fill or fix these." },
      { kind: "changed", text: "Creating a contact now requires a name and optionally accepts the generic showroom details a business card carries (name/address/website/socials/phone/email) — the worker matches the store and fills any missing store info." },
      { kind: "added", text: "The intake form collects links; the store viewport lets you add/edit/delete them." },
      { kind: "fixed", text: "The email-to-contacts flow diagram was malformed — rewritten + validated." },
    ],
  },
  {
    id: "showroom-email-contacts",
    branch: "claude/showroom-stores-cleanup-775bb5",
    date: "2026-07-14",
    tag: "Phase 5",
    area: "Showrooms",
    title: "Emails become contacts automatically",
    summary:
      "When a showroom emails you, the platform reads the signature and files the sender into the phonebook — mapped to the right showroom by email domain or name. Senders it can’t place are saved as drafts for a quick one-tap map.",
    status: "staged",
    changes: [
      { kind: "added", text: "Inbound worker email (remodel@hacolby.app) auto-registers a showroom contact from the sender’s signature (name, email, phone, website), wired into the email pipeline." },
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
    migrations: ["0108"],
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
    migrations: ["0108"],
    changes: [
      { kind: "added", text: "showroom_store_links table: one row per link, typed WEBSITE / INSTAGRAM / PINTEREST / FACEBOOK / OTHER with url_notes." },
      { kind: "added", text: "Send a links[] payload on create/update (replace-all), or manage them one at a time via /:id/links CRUD." },
      { kind: "changed", text: "Favicon + website scrape now source the site from the WEBSITE link; the scrape writes any Instagram it finds as an INSTAGRAM link." },
      { kind: "changed", text: "Flat website_url / instagram_url / facebook_url / pinterest_url columns are now DEPRECATED (superseded by the links table); kept for the one-time backfill and dropped in a follow-up migration." },
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
    migrations: ["0108"],
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
    migrations: ["0108"],
    changes: [
      { kind: "changed", text: "showroom_store_hours rows are now the SOLE source of truth; the hours_json blob is superseded (kept as deprecated for the one-time backfill, dropped in a follow-up migration)." },
      { kind: "changed", text: "Renamed the normalized table showroom_hours → showroom_store_hours." },
      { kind: "changed", text: "Redundant free-text weekday_hours / weekend_hours columns are deprecated (backfill source only)." },
      { kind: "added", text: "API create/update accept a hoursJson payload → rows; GET responses derive hoursJson from the rows. New MCP tool set_showroom_hours." },
      { kind: "fixed", text: "Deduplicated the hours parser (two copies) onto one shared util." },
    ],
  },
  {
    id: "email-structured-extraction",
    branch: "claude/email-structured-extraction",
    date: "2026-07-14",
    area: "Inbox",
    title: "Structured email extraction via responseSchema",
    summary:
      "Gemini email analysis now emits structured output against a native responseSchema, capturing merchant type, order number, delivery date, discount, shipping, and per-item brand/model/variant — and a guard drops the phantom 'total not stated' payment flag when a total was actually extracted.",
    changes: [
      { kind: "fixed", text: "Phantom 'total is not stated — check your payment method' flag on receipts whose total is printed (e.g. the Costco order)." },
      { kind: "changed", text: "classify.ts now passes config.responseSchema (native structured output) instead of a prompt-embedded JSON schema." },
      { kind: "added", text: "Richer extraction: merchantType, orderNumber, estimatedDeliveryDate, discount, shipping, currency + per-line brand/modelNumber/variant (persisted in extracted_raw_json)." },
      { kind: "added", text: "extraction-schema.ts — the native @google/genai Schema for the full analysis." },
    ],
    status: "staged",
  },
  {
    id: "changelog-persistent-d1",
    branch: "claude/worker-inbox-hitl-v2",
    date: "2026-07-14",
    area: "Platform",
    title: "Persistent append-only changelog",
    summary:
      "D1-backed changelog (changelog_branches + changelog_entries) surfaced at /admin/changelog, with a full detail page per entry and a mandatory agent workflow in AGENTS.md.",
    changes: [
      { kind: "added", text: "changelog_branches + changelog_entries tables (upsert by branch / slug — append-only, never overwritten)." },
      { kind: "added", text: "/api/changelog write API (POST /branches, /entries, /seed) + read (GET /, /:slug)." },
      { kind: "added", text: "/admin/changelog reads D1 at SSR, falls back to bundled seed data when empty; /admin/changelog/:slug detail pages." },
      { kind: "added", text: "AGENTS.md 'Changelog discipline (MANDATORY)': agents log entries every code turn + before every PR." },
    ],
    migrations: ["0107_ordinary_hawkeye"],
    status: "staged",
  },
];
