import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Feature proposals — the artifact bundle behind a PREVIEW changelog entry.
 *
 * A preview changelog entry is just a `changelog_entries` row with
 * `status: "staged"`. What it lacks is the thinking that produced it. This table
 * carries that: the PRD, the design brief, the copy-paste PROMPT for a coding
 * agent, and a pointer to the FULL conversation transcript.
 *
 * THE POINT: an idea is discussed with a (non-coding) AI model at one moment in
 * time, and a brand-new coding agent picks it up much later with zero shared
 * memory. Everything that made the idea make sense — the rejected alternatives,
 * the "no, because…", the constraints discovered mid-conversation — normally
 * evaporates into a summary, and the coding agent rebuilds a lossy version of
 * the plan from it. Storing the raw transcript alongside the PRD means the agent
 * can go read what was actually said instead of playing telephone.
 *
 * WHY THE TRANSCRIPT LIVES IN R2, NOT HERE:
 * A real dump is ~450KB (an assistant can produce one for free with `cat` — no
 * tokens spent re-typing it, so they will be dumped often and in full). Inlining
 * that would (a) bloat a D1 whose whole database is ~27MB today, (b) slow every
 * query that touches this table, since SQLite reads the full row, and (c) risk
 * the payload limits on the write path. So: prose that gets RENDERED stays in
 * D1; the raw blob goes to `ARTIFACTS_BUCKET` under `feature-context/<slug>.md`
 * and is fetched only when someone actually opens it. Same split the showroom
 * scrape already uses for page markdown.
 */
export const changelogProposals = sqliteTable(
  "changelog_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * Matches `changelog_entries.slug` — the preview entry this bundle backs.
     * Unique: one bundle per entry. Not a hard FK because a proposal can be
     * submitted BEFORE its changelog entry exists (an AI chat drafting an idea
     * has no branch or PR yet); the entry is upserted alongside it.
     */
    slug: text("slug").notNull().unique(),

    /** Optional plan this proposal's TASKS were seeded into (→ plans.slug). */
    planSlug: text("plan_slug"),

    /** Git branch, once work starts. Null while the idea is still just an idea. */
    branch: text("branch"),

    /** PR number, once one exists. */
    prNumber: integer("pr_number"),

    /** PRD.md — the product requirements, rendered on the preview page. */
    prdMarkdown: text("prd_markdown"),

    /** DESIGN_BRIEF.md — UX/interface intent, when the proposal has one. */
    designBriefMarkdown: text("design_brief_markdown"),

    /**
     * PROMPT.md — the prompt a human copy-pastes to a coding agent to start the
     * build. Rendered with a copy button; this is the handoff artifact.
     */
    promptMarkdown: text("prompt_markdown"),

    /** R2 key for the raw transcript, e.g. "feature-context/<slug>.md". */
    contextR2Key: text("context_r2_key"),

    /** Size of the stored transcript, so the UI can warn before fetching. */
    contextBytes: integer("context_bytes"),

    /** SHA-256 of the transcript — dedupes re-submits of the same conversation. */
    contextSha256: text("context_sha256"),

    /**
     * What the transcript does and does NOT cover. Real dumps are frequently
     * partial (e.g. only up to a compaction boundary), and a reader who assumes
     * completeness will draw wrong conclusions from a gap.
     */
    contextCoverageNote: text("context_coverage_note"),

    /** Who produced this bundle — an AI chat, a coding agent, or a human. */
    sourceKind: text("source_kind", {
      enum: ["ai_chat", "coding_agent", "human"],
    })
      .notNull()
      .default("ai_chat"),

    /** Model/tool that produced it, free text (e.g. "claude-opus-4-8"). */
    sourceModel: text("source_model"),

    /** Lifecycle: an idea, accepted for build, built, or dropped. */
    status: text("status", {
      enum: ["proposed", "accepted", "in_progress", "shipped", "rejected"],
    })
      .notNull()
      .default("proposed"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    planIdx: index("changelog_proposals_plan_idx").on(t.planSlug),
    statusIdx: index("changelog_proposals_status_idx").on(t.status, t.createdAt),
    branchIdx: index("changelog_proposals_branch_idx").on(t.branch),
  }),
);

export type ChangelogProposal = typeof changelogProposals.$inferSelect;
export type ChangelogProposalInsert = typeof changelogProposals.$inferInsert;
