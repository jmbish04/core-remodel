/**
 * @fileoverview Changelog → beste-block adapters (shared by /admin/changelog and
 * /admin/changelog/preview).
 *
 * The changelog and the *preview* of not-yet-shipped work are the SAME thing at
 * different lifecycle stages, so they render through the same four blocks and the
 * same mappers here — only the status filter differs:
 *
 *   /admin/changelog          → status "shipped"  (what already landed)
 *   /admin/changelog/preview  → status "staged"   (the drafted presser: what a
 *                                                  PR *will* introduce, reviewable
 *                                                  on the deployed worker first)
 *
 * Block assignment (per the product spec):
 *   LIST     changelog24 → release highlights (the quick summary up top)
 *            changelog3  → release feed (every entry, compact)
 *   VIEWPORT changelog21 → conclusion recap board: Features / Fixes / Improvements
 *
 * The viewport's developer section (API surface, code, migrations, files) is
 * rendered directly by `ChangelogEntryView.astro` rather than through a block:
 * changelog19 accepts one code block per entry while a `PhaseDetail` carries
 * many, so every code card had to become a fake "entry" to fit.
 *
 * Source of truth is D1 (`changelog_branches` + `changelog_entries`); the bundled
 * `data/changelog*.ts` files are the seed + SSR fallback (see AGENTS.md
 * "Changelog discipline"). `loadChangelog` implements that try-D1/fall-back rule
 * once so every page behaves identically.
 */
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { changelogBranches, changelogEntries } from "@backend/db/schema/changelog/changelog";
import { BRANCHES, CHANGELOG, type ChangeKind, type ChangelogBranch, type ChangelogEntry } from "@/data/changelog";
import { CHANGELOG_DETAIL, type PhaseDetail } from "@/data/changelog-detail";

/**
 * Which page is rendering.
 *
 * - `shipped` → /admin/changelog. Shows the **full record** (shipped AND staged,
 *   each status-badged), matching what that page has always shown.
 * - `staged`  → /admin/changelog/preview. Shows **only** staged entries — the
 *   drafted presser for work that hasn't deployed.
 *
 * Why the changelog isn't filtered to `status === "shipped"`: nothing in D1 is
 * currently marked shipped (entries are registered as `staged` and the flip to
 * `shipped` on deploy isn't happening — see AGENTS.md "Changelog discipline"),
 * so a strict filter would render an empty page. Showing the full record is both
 * non-regressive and honest; once statuses are maintained, tightening this to a
 * shipped-only filter is a one-line change here and nowhere else.
 */
export type ChangelogStage = "shipped" | "staged";

export interface LoadedChangelog {
  branches: ChangelogBranch[];
  entries: ChangelogEntry[];
  /** Where the data came from — surfaced as a badge so it's never ambiguous. */
  source: "D1" | "bundled";
}

/**
 * Read branches + entries for one lifecycle stage.
 *
 * D1 is the source of truth; on an empty table or any D1 error we fall back to
 * the bundled seed so the page still renders (same contract the previous
 * hand-rolled pages used).
 *
 * @param env   Worker env (from `Astro.locals.runtime?.env`). Optional: the
 *              Cloudflare runtime isn't present during a static build or some
 *              local-test setups, in which case we fall back to the seed rather
 *              than crash the page.
 * @param stage Which entries to return — `shipped` or `staged`.
 */
export async function loadChangelog(
  env: Env | undefined,
  stage: ChangelogStage,
): Promise<LoadedChangelog> {
  try {
    if (!env?.DB) throw new Error("D1 binding unavailable — using bundled seed");
    const db = drizzle(env.DB);
    const [branchRows, entryRows] = await Promise.all([
      db.select().from(changelogBranches).orderBy(desc(changelogBranches.createdAt)).all(),
      db.select().from(changelogEntries).orderBy(desc(changelogEntries.createdAt)).all(),
    ]);
    if (entryRows.length === 0) throw new Error("empty");

    const entries: ChangelogEntry[] = entryRows
      // Preview = staged only; the changelog = the full record (see ChangelogStage).
      .filter((r) => (stage === "staged" ? r.status === "staged" : true))
      .map((r) => ({
        id: r.slug,
        entryNo: r.id,
        branch: r.branch,
        date: r.date,
        tag: r.tag ?? undefined,
        area: r.area,
        title: r.title,
        summary: r.summary,
        status: r.status as ChangelogEntry["status"],
        changes: (r.changesJson as ChangelogEntry["changes"]) ?? [],
        migrations: (r.migrationsJson as string[]) ?? [],
      }));

    const branches: ChangelogBranch[] = branchRows.map((b) => ({
      branch: b.branch,
      title: b.title,
      summary: b.summary ?? undefined,
      date: b.date,
      status: b.status as ChangelogBranch["status"],
      prNumber: b.prNumber ?? undefined,
      prUrl: b.prUrl ?? undefined,
    }));

    return { branches, entries, source: "D1" };
  } catch {
    return {
      branches: BRANCHES,
      entries: CHANGELOG.filter((e) => (stage === "staged" ? e.status === "staged" : true)),
      source: "bundled",
    };
  }
}

/** One entry's full detail (D1 `detail_json`, else the bundled `PhaseDetail`). */
export function resolveDetail(slug: string, detailJson: unknown): PhaseDetail | undefined {
  if (detailJson && typeof detailJson === "object") return detailJson as PhaseDetail;
  return CHANGELOG_DETAIL[slug];
}

export interface LoadedEntry {
  entry: ChangelogEntry | undefined;
  detail: PhaseDetail | undefined;
  prNumber?: number;
  prUrl?: string;
}

/**
 * Read ONE entry with its detail and PR metadata — the shape every viewport of a
 * single entry needs (the detail page and the slide deck).
 *
 * PR metadata is read from the BRANCH row rather than the entry, so it renders
 * for every entry ever written instead of only the ones whose author remembered
 * to duplicate it into `detail_json`.
 *
 * @param env  Worker env. Absent during a static build, in which case the
 *             bundled seed answers — same contract as `loadChangelog`.
 */
export async function loadEntry(env: Env | undefined, slug: string): Promise<LoadedEntry> {
  let entry: ChangelogEntry | undefined;
  let detailJson: unknown;
  let branchPr: { prNumber: number | null; prUrl: string | null } | undefined;

  try {
    if (!env?.DB) throw new Error("D1 binding unavailable — using bundled seed");
    const db = drizzle(env.DB);
    const [row] = await db
      .select()
      .from(changelogEntries)
      .where(eq(changelogEntries.slug, slug))
      .limit(1);
    if (row) {
      entry = {
        id: row.slug,
        entryNo: row.id,
        branch: row.branch,
        date: row.date,
        tag: row.tag ?? undefined,
        area: row.area,
        title: row.title,
        summary: row.summary,
        status: row.status as ChangelogEntry["status"],
        changes: (row.changesJson as ChangelogEntry["changes"]) ?? [],
        migrations: (row.migrationsJson as string[]) ?? [],
      };
      detailJson = row.detailJson;
      const [b] = await db
        .select({ prNumber: changelogBranches.prNumber, prUrl: changelogBranches.prUrl })
        .from(changelogBranches)
        .where(eq(changelogBranches.branch, row.branch))
        .limit(1);
      branchPr = b;
    }
  } catch {
    entry = undefined;
  }

  if (!entry) entry = CHANGELOG.find((e) => e.id === slug);
  const detail = entry ? resolveDetail(slug, detailJson) : undefined;
  const seedBranch = BRANCHES.find((b) => b.branch === entry?.branch);

  const prNumber = detail?.prNumber ?? branchPr?.prNumber ?? seedBranch?.prNumber ?? undefined;
  const prUrl =
    detail?.prUrl ??
    branchPr?.prUrl ??
    seedBranch?.prUrl ??
    (prNumber ? `https://github.com/jmbish04/core-remodel/pull/${prNumber}` : undefined);

  return { entry, detail, prNumber: prNumber ?? undefined, prUrl: prUrl ?? undefined };
}

/** The `version` chip an entry shows in every block. */
function versionOf(entry: ChangelogEntry): string {
  return entry.tag ?? entry.area;
}

/**
 * Title with the entry's D1 row number prefixed — `#42 · Some change`.
 *
 * Titles alone are a poor identifier on a list page: several entries describe
 * the same subsystem and read almost identically at a glance. The number is
 * short, unique, and stable, so it is prefixed rather than tucked into a corner.
 *
 * Falls back to the bare title when the bundled seed is serving, since those
 * rows have no id and a made-up number would be worse than none.
 */
export function entryTitle(entry: ChangelogEntry): string {
  return entry.entryNo ? `#${entry.entryNo} · ${entry.title}` : entry.title;
}

/** Status → badge, so a staged (preview) row is never mistaken for shipped. */
function statusBadge(status: ChangelogEntry["status"]): { label: string; variant: "default" | "secondary" | "outline" } {
  return status === "shipped"
    ? { label: "Shipped", variant: "secondary" }
    : { label: "Proposed", variant: "default" };
}

/** Detail link for an entry, scoped to the stage it's being viewed in. */
export function detailHref(slug: string, stage: ChangelogStage): string {
  return stage === "staged" ? `/admin/changelog/preview/${slug}` : `/admin/changelog/${slug}`;
}

// ── LIST: changelog24 — release highlights ──────────────────────────────────

/**
 * Highlights (changelog24): the newest few entries, each with its single most
 * important line pulled up as the callout. `limit` keeps the top of the page a
 * summary rather than a second full feed.
 */
export function toHighlights(
  entries: ChangelogEntry[],
  stage: ChangelogStage,
  limit = 3,
): Record<string, unknown> {
  const staged = stage === "staged";
  return {
    badge: { label: staged ? "Preview" : "Changelog", variant: "secondary" as const },
    heading: staged ? "Proposed Release Highlights" : "Release Highlights",
    description: staged
      ? "Drafted in advance — what these branches will introduce once deployed. Nothing here has shipped yet."
      : "Each release with its most impactful change front and center.",
    entries: entries.slice(0, limit).map((e) => ({
      version: versionOf(e),
      date: e.date,
      badge: statusBadge(e.status),
      heading: entryTitle(e),
      description: e.summary,
      // The first `added` change is the headline; fall back to the first change.
      callout: pickCallout(e),
      changes: e.changes.map((c) => c.text),
      button: { label: staged ? "Review the proposal" : "Read the detail", href: detailHref(e.id, stage) },
    })),
  };
}

/** Headline change for the callout — prefer a feature, else whatever's first. */
function pickCallout(entry: ChangelogEntry): { title: string; text: string } | undefined {
  const headline = entry.changes.find((c) => c.kind === "added") ?? entry.changes[0];
  if (!headline) return undefined;
  return { title: KIND_LABEL[headline.kind], text: headline.text };
}

// ── LIST: changelog3 — release feed ─────────────────────────────────────────

/** The full feed (changelog3): every entry for the stage, compact. */
export function toFeed(entries: ChangelogEntry[], stage: ChangelogStage): Record<string, unknown> {
  const staged = stage === "staged";
  return {
    badge: { label: staged ? "Pending" : "Changelog", variant: "secondary" as const },
    heading: staged ? "Proposed Changes" : "Release Feed",
    description: staged
      ? "Every change waiting to deploy, newest first. Review before it lands."
      : "Every release, improvement, and bug fix we shipped.",
    releases: entries.map((e) => ({
      version: versionOf(e),
      date: e.date,
      badge: statusBadge(e.status),
      heading: entryTitle(e),
      summary: e.summary,
      changes: e.changes.map((c) => `${KIND_LABEL[c.kind]}: ${c.text}`),
      button: { label: "Details", href: detailHref(e.id, stage) },
    })),
  };
}

// ── VIEWPORT: changelog21 — conclusion recap board ──────────────────────────

const KIND_LABEL: Record<ChangeKind, string> = {
  added: "Added",
  changed: "Changed",
  removed: "Removed",
  migration: "Migration",
  fixed: "Fixed",
};

const LANG_LABEL: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  sql: "SQL",
  json: "JSON",
  bash: "Shell",
};

/**
 * Column mapping for the recap. The product ask is "features, fixes and
 * improvements"; `removed` and `migration` still exist in the data, so they get
 * their own columns rather than being silently dropped. Empty columns are not
 * rendered.
 */
const RECAP_COLUMNS: Array<{ label: string; color: string; kinds: ChangeKind[] }> = [
  { label: "Features", color: "bg-emerald-500", kinds: ["added"] },
  { label: "Fixes", color: "bg-blue-500", kinds: ["fixed"] },
  { label: "Improvements", color: "bg-amber-500", kinds: ["changed"] },
  { label: "Removed", color: "bg-rose-500", kinds: ["removed"] },
  { label: "Migrations", color: "bg-violet-500", kinds: ["migration"] },
];

/**
 * Conclusion recap (changelog21): what this change introduced, bucketed into
 * Features / Fixes / Improvements (+ Removed / Migrations when present).
 */
export function toRecap(entry: ChangelogEntry, stage: ChangelogStage): Record<string, unknown> {
  const columns = RECAP_COLUMNS.map((col) => ({
    label: col.label,
    color: col.color,
    items: entry.changes
      .filter((c) => col.kinds.includes(c.kind))
      .map((c) => ({ heading: c.text, version: versionOf(entry) })),
  })).filter((col) => col.items.length > 0);

  return {
    badge: { label: entry.date, variant: "secondary" as const },
    heading: stage === "staged" ? "What this will introduce" : "What this introduced",
    description:
      stage === "staged"
        ? "Recap of the proposed change, by type. This is the shape of the release once it deploys."
        : "Everything this change shipped, organized by type.",
    columns,
  };
}

/** Diagrams for the viewport (mermaid source + caption), or []. */
export function toDiagrams(detail: PhaseDetail | undefined): Array<{ caption: string; code: string }> {
  return detail?.diagrams ?? [];
}
