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
    branch: "claude/email-structured-extraction",
    title: "Structured email extraction (fix the phantom 'total not stated')",
    summary:
      "Inbound-email classification now uses a native Gemini responseSchema instead of a prompt-embedded schema, so receipts/invoices extract every printed field and the model stops hallucinating 'the total is not stated — check your payment method' on receipts whose total is printed.",
    date: "2026-07-14",
    status: "staged",
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
