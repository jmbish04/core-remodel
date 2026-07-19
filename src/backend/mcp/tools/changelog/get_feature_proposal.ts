import { z } from "zod";

import { getProposal, getProposalContext } from "@backend/services/changelog-proposals";
import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { siteUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";
import { formatBytes } from "./_shared";

/**
 * Guard on the inlined transcript. Well past a real ~450KB dump, but finite —
 * an unbounded inline return would blow the model's context window rather than
 * fail cleanly, and a truncated-with-a-warning read is far better than that.
 */
const CONTEXT_INLINE_CAP = 700_000;

export const getFeatureProposal = defineTool({
  name: "get_feature_proposal",
  category: "changelog",
  title: "Read a feature proposal, including the original conversation",
  description:
    "Pull back a filed proposal BEFORE starting work on it: the PRD, the design brief, the PROMPT, the live status " +
    "of its plan tasks, and — with `includeContext: true` — the FULL raw transcript of the conversation the idea " +
    "came out of. Read the transcript. It is the whole reason this record exists: it holds the alternatives that " +
    "were considered and rejected, the constraints found mid-discussion, and the exact phrasing of requirements " +
    "that a summary quietly rounds off. Check `contextCoverageNote` before drawing conclusions — transcripts are " +
    "frequently partial, and a gap you did not notice reads exactly like a decision nobody made.",
  inputShape: {
    slug: z.string().min(1).describe("The proposal slug"),
    includeContext: z
      .boolean()
      .optional()
      .describe(
        "Inline the raw transcript in the response (default false). Set true when you are about to " +
          "implement the proposal — it is typically a few hundred KB.",
      ),
  },
  annotations: READ_ONLY,
  // Every top-level key is enumerated: the SDK validates structuredContent
  // against z.object(outputShape) and STRIPS anything unlisted.
  outputShape: {
    slug: z.string(),
    status: z.string().describe("Proposal lifecycle status"),
    branch: z.string().nullable(),
    prNumber: z.number().int().nullable(),
    planSlug: z.string().nullable(),
    sourceKind: z.string(),
    sourceModel: z.string().nullable(),
    title: z.string().nullable(),
    summary: z.string().nullable(),
    prdMarkdown: z.string().nullable(),
    designBriefMarkdown: z.string().nullable(),
    promptMarkdown: z.string().nullable(),
    tasks: z
      .array(
        looseObject({
          taskKey: z.string(),
          title: z.string(),
          status: z.string(),
          workstream: z.string(),
          phase: z.number().int(),
          changeType: z.string(),
          notes: z.string().nullable(),
        }),
      )
      .describe("Live plan_tasks with their CURRENT status — not the status that was proposed"),
    context: looseObject({
      available: z.boolean(),
      size: z.string(),
      coverageNote: z.string().nullable(),
      url: urlField,
      text: z.string().nullable().optional().describe("The raw transcript, when includeContext=true"),
    }).describe("Transcript metadata — plus the verbatim text when requested"),
    url: urlField,
  },
  examples: [
    { title: "Read the bundle before implementing", args: { slug: "voice-measurement-capture", includeContext: true } },
    { title: "Just the metadata", args: { slug: "voice-measurement-capture" } },
  ],
  handler: async ({ env, db }, input) => {
    const slug = input.slug?.trim();
    if (!slug) toolError("`slug` is required and cannot be empty.");

    const bundle = await getProposal(db, slug);
    if (!bundle) toolError(`No feature proposal with slug "${slug}".`);

    const context: Record<string, unknown> = {
      available: bundle.context.available,
      bytes: bundle.context.bytes,
      size: formatBytes(bundle.context.bytes),
      sha256: bundle.context.sha256,
      coverageNote:
        bundle.context.coverageNote ??
        (bundle.context.available
          ? "No coverage note was recorded — treat completeness as UNKNOWN, not assumed."
          : null),
      url: siteUrl(env, bundle.context.href),
    };

    if (input.includeContext && bundle.context.available) {
      const object = await getProposalContext(env, db, slug);
      if (!object) {
        context.text = null;
        context.warning = "The proposal points at an R2 object that no longer exists.";
      } else {
        const text = await object.text();
        if (text.length > CONTEXT_INLINE_CAP) {
          context.text = text.slice(0, CONTEXT_INLINE_CAP);
          context.truncated = true;
          context.warning =
            `Transcript exceeded ${CONTEXT_INLINE_CAP} chars and was truncated. ` +
            `Fetch ${context.url} for the complete text.`;
        } else {
          context.text = text;
          context.truncated = false;
        }
      }
    }

    return {
      slug: bundle.proposal.slug,
      status: bundle.proposal.status,
      branch: bundle.proposal.branch,
      prNumber: bundle.proposal.prNumber,
      planSlug: bundle.proposal.planSlug,
      sourceKind: bundle.proposal.sourceKind,
      sourceModel: bundle.proposal.sourceModel,
      title: bundle.entry?.title ?? null,
      summary: bundle.entry?.summary ?? null,
      prdMarkdown: bundle.proposal.prdMarkdown,
      designBriefMarkdown: bundle.proposal.designBriefMarkdown,
      promptMarkdown: bundle.proposal.promptMarkdown,
      tasks: bundle.tasks.map((t) => ({
        taskKey: t.taskKey,
        title: t.title,
        workstream: t.workstream,
        phase: t.phase,
        changeType: t.changeType,
        status: t.status,
        notes: t.notes,
      })),
      context,
      url: siteUrl(env, `/admin/changelog/preview/${slug}`),
    };
  },
});
