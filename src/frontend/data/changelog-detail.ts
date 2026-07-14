/**
 * Full developer record behind each changelog entry on /admin/changelog.
 * Keyed by the entry `id` (= the detail page slug at /admin/changelog/:id).
 *
 * Standard (see AGENTS.md): every non-trivial change ships a detail entry with
 * the problem, the approach, the exact API surface touched, the files, the
 * migration SQL, representative code, and (where useful) a Mermaid diagram.
 * Seeded/fallback here, then persisted to D1 (changelog_entries.detail_json).
 */

export interface CodeCard {
  title: string;
  lang: "ts" | "tsx" | "sql" | "json" | "bash";
  code: string;
}

export interface DiagramCard {
  caption: string;
  code: string; // Mermaid source
}

export interface PhaseDetail {
  slug: string;
  problem: string;
  approach: string;
  apiChanges: string[];
  filesTouched: string[];
  migrations: { tag: string; sql: string }[];
  code: CodeCard[];
  diagrams: DiagramCard[];
}

export const CHANGELOG_DETAIL: Record<string, PhaseDetail> = {
  "changelog-persistent-d1": {
    slug: "changelog-persistent-d1",
    problem:
      "A per-branch markdown CHANGELOG.md gets overwritten and merge-conflicts, and there was no durable, shared record of what shipped across branches. Parallel branches would clobber each other's notes.",
    approach:
      "Move the changelog into D1: changelog_branches + changelog_entries, upserted by branch name / entry slug so it accumulates forever and is never clobbered. The overview reads D1 at SSR and falls back to bundled seed data when empty. Each entry carries a full detail_json record surfaced at /admin/changelog/:slug. AGENTS.md makes updating it mandatory every code turn and before every PR.",
    apiChanges: [
      "GET /api/changelog — branches with nested entries",
      "GET /api/changelog/:slug — one entry",
      "POST /api/changelog/branches — upsert branch",
      "POST /api/changelog/entries — upsert entry (append-only across branches)",
      "POST /api/changelog/seed — idempotent seed from bundled data",
    ],
    filesTouched: [
      "src/backend/db/schema/changelog/changelog.ts (NEW)",
      "src/backend/api/routes/changelog.ts (NEW) + api/index.ts mount",
      "src/frontend/data/changelog.ts + changelog-detail.ts (NEW)",
      "src/frontend/pages/admin/changelog.astro + changelog/[slug].astro",
      "AGENTS.md (Changelog discipline)",
    ],
    migrations: [
      {
        tag: "0107_ordinary_hawkeye",
        sql: `CREATE TABLE changelog_branches ( id integer PK, branch text UNIQUE, title, summary, date, status, pr_number, pr_url, created_at, updated_at );
CREATE TABLE changelog_entries ( id integer PK, slug text UNIQUE, branch, tag, area, title, summary, status, date, changes_json, migrations_json, detail_json, created_at, updated_at );`,
      },
    ],
    code: [
      {
        title: "Append-only upsert — a branch never overwrites another's rows",
        lang: "ts",
        code: `await db.insert(changelogEntries)
  .values({ slug: d.slug, branch: d.branch, /* … */ })
  .onConflictDoUpdate({ target: changelogEntries.slug, set: { /* … */ } });`,
      },
    ],
    diagrams: [
      {
        caption: "Branches accumulate in D1; entries append by slug and never overwrite.",
        code: `erDiagram
  changelog_branches ||--o{ changelog_entries : "branch"
  changelog_branches {
    string branch PK
    string title
    string status
  }
  changelog_entries {
    string slug PK
    string branch FK
    string title
    json   detail_json
  }`,
      },
    ],
  },
};
