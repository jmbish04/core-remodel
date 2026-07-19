import { z } from "zod";

import { upsertProposal } from "@backend/services/changelog-proposals";
import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { siteUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { formatBytes, PROPOSAL_STATUSES, taskShape } from "./_shared";

export const submitFeatureProposal = defineTool({
  name: "submit_feature_proposal",
  category: "changelog",
  title: "File a feature proposal (with the conversation behind it)",
  description:
    "File an idea worked out in THIS conversation as a proposal, so a coding agent picking it up weeks from now " +
    "inherits the reasoning instead of a summary. Pass the PRD, an optional design brief, the PROMPT a human will " +
    "hand a coding agent, an optional TASKS list, and — this is the important part — `context`: the RAW, " +
    "UNSUMMARIZED transcript of the conversation that produced the idea. Dump it verbatim; do NOT condense, " +
    "paraphrase, or 'clean it up'. The rejected alternatives, the 'no, because…', and the constraints discovered " +
    "mid-discussion are exactly what a summary loses and exactly what makes the proposal usable later. The " +
    "transcript is stored in R2 (not the database), so length is not a concern. If your dump is PARTIAL — e.g. it " +
    "only reaches a compaction boundary — say so in `contextCoverageNote`; a reader who assumes it is complete " +
    "will draw confident wrong conclusions from the gap. Upserts by `slug`, so call it again as the idea develops.",
  inputShape: {
    slug: z
      .string()
      .min(1)
      .describe("Stable kebab-case id, e.g. 'feature-proposals-api'. Upserts by this."),
    title: z.string().optional().describe("Title for the staged changelog entry this bundle backs"),
    summary: z.string().optional().describe("One-or-two sentence summary for the changelog entry"),
    area: z.string().optional().describe("Subsystem label, e.g. 'changelog', 'showrooms'"),
    prdMarkdown: z.string().optional().describe("PRD.md — the product requirements, in markdown"),
    designBriefMarkdown: z.string().optional().describe("DESIGN_BRIEF.md — UX/interface intent"),
    promptMarkdown: z
      .string()
      .optional()
      .describe("PROMPT.md — the copy-paste prompt that starts a coding agent. The handoff artifact."),
    context: z
      .string()
      .optional()
      .describe(
        "The RAW conversation transcript, verbatim and unsummarized. Goes to R2, so size is fine. " +
          "Summarizing this defeats the entire purpose of the tool.",
      ),
    contextCoverageNote: z
      .string()
      .optional()
      .describe(
        "What the transcript does and does NOT cover (e.g. 'only up to the compaction boundary; " +
          "the earlier scoping discussion is not included'). Rendered next to the link.",
      ),
    tasks: z
      .array(taskShape)
      .optional()
      .describe("TASKS.json — seeded into plan_tasks and rendered at /admin/plans"),
    planSlug: z.string().optional().describe("Plan to seed tasks into (defaults to `slug`)"),
    branch: z.string().optional().describe("Git branch, once work starts"),
    prNumber: z.number().int().optional().describe("PR number, once one exists"),
    status: z.enum(PROPOSAL_STATUSES).optional().describe("Lifecycle status (default 'proposed')"),
    sourceKind: z
      .enum(["ai_chat", "coding_agent", "human"])
      .optional()
      .describe("Who filed this (default 'ai_chat')"),
    sourceModel: z.string().optional().describe("Model that produced it, e.g. 'claude-opus-4-8'"),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: {
    slug: z.string(),
    created: z.boolean().describe("True when this filed a new proposal rather than updating one"),
    contextBytes: z.number().int().nullable().describe("Stored transcript size in bytes"),
    contextUnchanged: z
      .boolean()
      .describe("True when the transcript hashed identically to the stored one (no re-upload)"),
    tasksSeeded: z.number().int().describe("plan_tasks rows written"),
    transcript: z.string().describe("Human-readable note on what was stored"),
    url: urlField,
  },
  examples: [
    {
      title: "File an idea mid-conversation, transcript and all",
      args: {
        slug: "voice-measurement-capture",
        title: "Voice measurement capture",
        summary: "Speak measurements while walking the house; they land in D1 and light up a live floorplan.",
        area: "measurements",
        prdMarkdown: "# Voice measurement capture\n\n## Problem\nA tape measure needs both hands…",
        promptMarkdown: "Build voice measurement capture. Read the transcript first…",
        contextCoverageNote: "Full session from the first message through the decision to defer LiDAR.",
        context: "## User\nwhat if I could just say the measurements out loud…\n\n## Assistant\n…",
        tasks: [
          { taskKey: "P1-MCP-01", title: "add_measurement voice variant", workstream: "mcp", phase: 1 },
        ],
      },
    },
  ],
  handler: async ({ env, db }, input) => {
    const slug = input.slug?.trim();
    if (!slug) toolError("`slug` is required and cannot be empty.");

    const result = await upsertProposal(env, db, { ...input, slug });

    return {
      slug: result.slug,
      created: result.created,
      contextBytes: result.contextBytes,
      contextUnchanged: result.contextUnchanged,
      tasksSeeded: result.tasksSeeded,
      transcript: result.contextR2Key
        ? `stored (${formatBytes(result.contextBytes)})${result.contextUnchanged ? ", unchanged" : ""}`
        : "none supplied",
      url: siteUrl(env, `/admin/changelog/preview/${slug}`),
    };
  },
});
