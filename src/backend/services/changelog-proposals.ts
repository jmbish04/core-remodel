/**
 * @fileoverview Feature-proposal bundles — the shared logic behind BOTH the HTTP
 * API (`/api/changelog/proposals`) and the MCP tools (`tools/changelog/`).
 *
 * There is exactly one implementation here on purpose. The MCP transport runs
 * in-process and calls these functions directly; `scripts/changelog/*.mjs` calls
 * the HTTP routes, which call these same functions. A second copy of the R2 +
 * hash + upsert dance would drift.
 *
 * THE POINT (see docs/superpowers/specs/2026-07-18-feature-proposals-preview-changelog.md):
 * an idea is worked out in conversation with a non-coding AI chat; weeks later a
 * brand-new coding agent picks it up with zero shared memory. A summary is what
 * survives that gap, and a summary is exactly what loses the rejected
 * alternatives and the mid-conversation constraints. So the RAW transcript
 * travels with the proposal.
 *
 * TWO INVARIANTS THAT MUST NOT BE UNDONE:
 *  1. The transcript goes to R2 (`ARTIFACTS_BUCKET`, `feature-context/<slug>.md`),
 *     never into D1. A real dump measured ~450KB and an assistant can produce one
 *     for free with `cat`, so they are large AND frequent. Prod D1 is ~27MB total,
 *     SQLite reads whole rows (a `SELECT slug, status` would drag every byte off
 *     disk), and large bound params are the fragile part of the D1 write path.
 *  2. Nothing here summarizes the transcript. The value IS the unprocessed text.
 */
import { desc, eq, inArray } from "drizzle-orm";

import { changelogEntries, changelogProposals, plans, planTasks } from "@backend/db";
import type { ChangelogProposal } from "@backend/db/schema/changelog/proposals";
import type { PlanTask } from "@backend/db/schema/plans/plan_tasks";
import type { RemodelDb } from "@backend/mcp/types";

/** R2 prefix for raw transcripts. One object per proposal slug. */
const CONTEXT_PREFIX = "feature-context";

/** D1 statements per `db.batch()` — keeps us clear of the bound-param ceiling. */
const BATCH = 50;

export type ProposalStatus = ChangelogProposal["status"];
export type ProposalSourceKind = ChangelogProposal["sourceKind"];

/** One TASKS.json row. Maps 1:1 onto `plan_tasks` — there is no second task table. */
export interface ProposalTaskInput {
  taskKey: string;
  title: string;
  description?: string | null;
  workstream?: string;
  phase?: number;
  targetRoute?: string | null;
  changeType?: PlanTask["changeType"];
  status?: PlanTask["status"];
  dependsOn?: string[] | null;
  sortOrder?: number;
  notes?: string | null;
}

export interface UpsertProposalInput {
  slug: string;
  /** Seeds/updates the staged `changelog_entries` row so the preview page renders. */
  title?: string | null;
  summary?: string | null;
  area?: string | null;
  branch?: string | null;
  prNumber?: number | null;
  planSlug?: string | null;
  prdMarkdown?: string | null;
  designBriefMarkdown?: string | null;
  promptMarkdown?: string | null;
  /** RAW transcript. Streamed to R2 verbatim — never summarized, never inlined in D1. */
  context?: string | null;
  contextCoverageNote?: string | null;
  sourceKind?: ProposalSourceKind;
  sourceModel?: string | null;
  status?: ProposalStatus;
  tasks?: ProposalTaskInput[];
}

export interface UpsertProposalResult {
  slug: string;
  created: boolean;
  contextR2Key: string | null;
  contextBytes: number | null;
  contextSha256: string | null;
  /** True when the submitted transcript hashed identically to the stored one. */
  contextUnchanged: boolean;
  planSlug: string | null;
  tasksSeeded: number;
  entryUpserted: boolean;
}

/** SHA-256 hex of a UTF-8 string, via Web Crypto (no node:crypto on Workers). */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `feature-context/<slug>.md` — deterministic, so a re-submit overwrites in place. */
export function contextKeyFor(slug: string): string {
  return `${CONTEXT_PREFIX}/${slug}.md`;
}

/** Today as `YYYY-MM-DD`, the format `changelog_entries.date` already uses. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create or update a proposal bundle.
 *
 * Every field is optional past `slug`: a proposal is often filed in pieces (the
 * PRD lands during the chat, the branch and PR number only once work starts), and
 * an omitted field must never blank out what a previous submit stored. So this
 * builds a sparse patch rather than writing the whole row.
 */
export async function upsertProposal(
  env: Env,
  db: RemodelDb,
  input: UpsertProposalInput,
): Promise<UpsertProposalResult> {
  const slug = input.slug.trim();
  if (!slug) throw new Error("`slug` is required and cannot be empty.");

  const [existing] = await db
    .select()
    .from(changelogProposals)
    .where(eq(changelogProposals.slug, slug))
    .limit(1);

  // ── Transcript → R2 ───────────────────────────────────────────────────────
  // Hash first and compare: a re-submitted conversation is the common case (an
  // agent dumps the whole session again after a few more turns), and re-putting
  // an identical 450KB blob is pure waste.
  let contextR2Key = existing?.contextR2Key ?? null;
  let contextBytes = existing?.contextBytes ?? null;
  let contextSha256 = existing?.contextSha256 ?? null;
  let contextUnchanged = false;

  const context = input.context;
  if (context != null && context.length > 0) {
    const sha = await sha256Hex(context);
    const key = contextKeyFor(slug);
    if (existing?.contextSha256 === sha && existing.contextR2Key === key) {
      contextUnchanged = true;
    } else {
      await env.ARTIFACTS_BUCKET.put(key, context, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        customMetadata: { slug, sha256: sha },
      });
    }
    contextR2Key = key;
    contextBytes = new TextEncoder().encode(context).length;
    contextSha256 = sha;
  }

  // ── Proposal row ──────────────────────────────────────────────────────────
  // `=== undefined`, not `??`: every other field here treats an explicit `null`
  // as "clear this", and `??` would silently swallow that for planSlug alone —
  // making it the one field you cannot detach from its plan.
  const planSlug =
    input.planSlug === undefined
      ? (input.tasks?.length ? slug : existing?.planSlug ?? null)
      : input.planSlug;

  // `undefined` = "not supplied, leave alone"; an explicit `null` clears.
  const patch = {
    planSlug,
    branch: input.branch === undefined ? existing?.branch ?? null : input.branch,
    prNumber: input.prNumber === undefined ? existing?.prNumber ?? null : input.prNumber,
    prdMarkdown: input.prdMarkdown === undefined ? existing?.prdMarkdown ?? null : input.prdMarkdown,
    designBriefMarkdown:
      input.designBriefMarkdown === undefined
        ? existing?.designBriefMarkdown ?? null
        : input.designBriefMarkdown,
    promptMarkdown:
      input.promptMarkdown === undefined ? existing?.promptMarkdown ?? null : input.promptMarkdown,
    contextR2Key,
    contextBytes,
    contextSha256,
    contextCoverageNote:
      input.contextCoverageNote === undefined
        ? existing?.contextCoverageNote ?? null
        : input.contextCoverageNote,
    sourceKind: input.sourceKind ?? existing?.sourceKind ?? ("ai_chat" as const),
    sourceModel: input.sourceModel === undefined ? existing?.sourceModel ?? null : input.sourceModel,
    status: input.status ?? existing?.status ?? ("proposed" as const),
  };

  await db
    .insert(changelogProposals)
    .values({ slug, ...patch })
    .onConflictDoUpdate({
      target: changelogProposals.slug,
      set: { ...patch, updatedAt: new Date() },
    });

  // ── Staged changelog entry ────────────────────────────────────────────────
  // `slug` is deliberately not a hard FK — a proposal can exist before its entry,
  // branch, or PR. We upsert the entry alongside so /admin/changelog/preview/<slug>
  // resolves the moment the proposal is filed.
  let entryUpserted = false;
  if (input.title && input.summary) {
    const [existingEntry] = await db
      .select({ branch: changelogEntries.branch, area: changelogEntries.area, date: changelogEntries.date })
      .from(changelogEntries)
      .where(eq(changelogEntries.slug, slug))
      .limit(1);

    const entry = {
      branch: input.branch ?? existingEntry?.branch ?? "unassigned",
      area: input.area ?? existingEntry?.area ?? "proposal",
      title: input.title,
      summary: input.summary,
      status: "staged" as const,
      date: existingEntry?.date ?? today(),
    };
    await db
      .insert(changelogEntries)
      .values({ slug, ...entry })
      .onConflictDoUpdate({
        target: changelogEntries.slug,
        set: { ...entry, updatedAt: new Date() },
      });
    entryUpserted = true;
  }

  // ── TASKS.json → plans + plan_tasks ───────────────────────────────────────
  let tasksSeeded = 0;
  if (input.tasks?.length && planSlug) {
    await db
      .insert(plans)
      .values({
        slug: planSlug,
        title: input.title ?? planSlug,
        description: input.summary ?? null,
        status: "planning",
      })
      .onConflictDoNothing();

    const stmts = input.tasks.map((t) => {
      const row = {
        taskKey: t.taskKey,
        workstream: t.workstream ?? "general",
        phase: t.phase ?? 0,
        title: t.title,
        description: t.description ?? null,
        targetRoute: t.targetRoute ?? null,
        changeType: t.changeType ?? ("new" as const),
        status: t.status ?? ("pending" as const),
        dependsOn: t.dependsOn ?? null,
        sortOrder: t.sortOrder ?? 0,
        notes: t.notes ?? null,
      };
      return db
        .insert(planTasks)
        .values({ planSlug, ...row })
        .onConflictDoUpdate({
          // Re-submitting a proposal must not reset progress a coding session
          // already made, so `status` is intentionally NOT in the update set —
          // plan_tasks.status is owned by whoever is doing the work.
          target: [planTasks.planSlug, planTasks.taskKey],
          set: {
            workstream: row.workstream,
            phase: row.phase,
            title: row.title,
            description: row.description,
            targetRoute: row.targetRoute,
            changeType: row.changeType,
            dependsOn: row.dependsOn,
            sortOrder: row.sortOrder,
            updatedAt: new Date(),
          },
        });
    });

    for (let i = 0; i < stmts.length; i += BATCH) {
      const chunk = stmts.slice(i, i + BATCH) as [(typeof stmts)[number], ...(typeof stmts)[number][]];
      await db.batch(chunk);
    }
    tasksSeeded = input.tasks.length;
  }

  return {
    slug,
    created: !existing,
    contextR2Key,
    contextBytes,
    contextSha256,
    contextUnchanged,
    planSlug,
    tasksSeeded,
    entryUpserted,
  };
}

export interface ProposalBundle {
  proposal: ChangelogProposal;
  /** The staged changelog entry this bundle backs, when one exists yet. */
  entry: { slug: string; branch: string; title: string; summary: string; status: string; date: string } | null;
  /** Live plan_tasks for `planSlug` — status reflects real progress, not the submitted value. */
  tasks: PlanTask[];
  /** Where to fetch the raw transcript, and how big it is before you do. */
  context: {
    available: boolean;
    key: string | null;
    bytes: number | null;
    sha256: string | null;
    /**
     * What the transcript does and does NOT cover. Dumps are frequently partial
     * (e.g. only up to a compaction boundary) — a reader who assumes completeness
     * draws confident wrong conclusions from the gap, so this travels WITH the
     * link, never buried elsewhere.
     */
    coverageNote: string | null;
    href: string;
  };
}

/** Read one bundle's metadata. NEVER returns the raw blob — that is a separate fetch. */
export async function getProposal(db: RemodelDb, slug: string): Promise<ProposalBundle | null> {
  const [proposal] = await db
    .select()
    .from(changelogProposals)
    .where(eq(changelogProposals.slug, slug))
    .limit(1);
  if (!proposal) return null;

  const [entryRows, taskRows] = await Promise.all([
    db
      .select()
      .from(changelogEntries)
      .where(eq(changelogEntries.slug, slug))
      .limit(1),
    proposal.planSlug
      ? db.select().from(planTasks).where(eq(planTasks.planSlug, proposal.planSlug))
      : Promise.resolve([] as PlanTask[]),
  ]);

  const entry = entryRows[0]
    ? {
        slug: entryRows[0].slug,
        branch: entryRows[0].branch,
        title: entryRows[0].title,
        summary: entryRows[0].summary,
        status: entryRows[0].status,
        date: entryRows[0].date,
      }
    : null;

  const tasks = [...taskRows].sort(
    (a, b) => a.phase - b.phase || a.sortOrder - b.sortOrder || a.taskKey.localeCompare(b.taskKey),
  );

  return {
    proposal,
    entry,
    tasks,
    context: {
      available: Boolean(proposal.contextR2Key),
      key: proposal.contextR2Key,
      bytes: proposal.contextBytes,
      sha256: proposal.contextSha256,
      coverageNote: proposal.contextCoverageNote,
      href: `/api/changelog/proposals/${encodeURIComponent(slug)}/context`,
    },
  };
}

/** List bundles, newest first, optionally filtered by lifecycle status. */
export async function listProposals(
  db: RemodelDb,
  opts: { status?: ProposalStatus | ProposalStatus[]; limit?: number } = {},
): Promise<ChangelogProposal[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const statuses = opts.status
    ? Array.isArray(opts.status)
      ? opts.status
      : [opts.status]
    : null;
  const where = statuses?.length
    ? statuses.length === 1
      ? eq(changelogProposals.status, statuses[0])
      : inArray(changelogProposals.status, statuses)
    : undefined;

  return db
    .select()
    .from(changelogProposals)
    .where(where)
    .orderBy(desc(changelogProposals.createdAt))
    .limit(limit);
}

/**
 * Fetch the raw transcript from R2.
 *
 * Returns the R2 object so callers can stream it (`.body`) rather than buffer
 * 450KB in the isolate. Null when the proposal has no transcript.
 */
export async function getProposalContext(
  env: Env,
  db: RemodelDb,
  slug: string,
): Promise<R2ObjectBody | null> {
  const [row] = await db
    .select({ key: changelogProposals.contextR2Key })
    .from(changelogProposals)
    .where(eq(changelogProposals.slug, slug))
    .limit(1);
  if (!row?.key) return null;
  return env.ARTIFACTS_BUCKET.get(row.key);
}
