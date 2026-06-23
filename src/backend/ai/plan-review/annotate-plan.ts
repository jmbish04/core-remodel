/**
 * @fileoverview Onboard-agent plan annotation — gate (b) of the plan-review loop.
 *
 * After Gemini drafts a research plan, the onboard worker agent reviews it and
 * appends structured notes BEFORE the homeowner sees it: scope concerns, missing
 * angles, redundancy with prior findings, and reminders of the negative
 * constraints the homeowner's past rejections imply. The homeowner then reviews
 * the plan and these annotations together.
 *
 * Implemented as a shared service (decision D2) rather than a dedicated Durable
 * Object, so it adds no DO binding and leaves the DO migration tag at v10. It is
 * surfaced on the existing agents via a thin `reviewPlan` method.
 *
 * Model: Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` routed through the
 * AI Gateway (matches the draft-prompt model in the showroom agent).
 */

const ANNOTATE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

/** A single structured note the onboard agent attaches to a plan. */
export interface PlanAnnotation {
  /** Category of the note, used by the UI to group/icon annotations. */
  kind: "scope" | "gap" | "redundancy" | "constraint" | "risk";
  /** The note itself — one concise, actionable sentence. */
  note: string;
}

export interface AnnotatePlanInput {
  /** The plan markdown produced by Gemini collaborative planning. */
  planMarkdown: string;
  /** The research topic / target this plan is for. */
  topic: string;
  /**
   * Negative constraints implied by the homeowner's prior rejections (low
   * ratings, rejected findings). Built by the existing prompt-context helpers
   * and passed in so the annotation reminds the planner of them.
   */
  priorRejections?: string[];
}

/**
 * The system prompt is intentionally strict about output shape so the result is
 * parseable. Built as an ES6 template literal (real newlines) per repo rules.
 */
function annotateSystemPrompt(): string {
  return `You are a meticulous research planning reviewer embedded in a home-renovation sourcing system.

You are given a DRAFT research plan and context. Critique the plan as a senior researcher would, BEFORE it runs, so the homeowner can review your notes alongside the plan.

Return ONLY a JSON object of the form:
{"annotations": [{"kind": "scope|gap|redundancy|constraint|risk", "note": "<one concise, actionable sentence>"}]}

Guidance:
- "scope": the plan is too broad/narrow or drifts off the target.
- "gap": an important angle, source type, or question is missing.
- "redundancy": the plan repeats work that prior findings already cover.
- "constraint": the plan risks violating a known homeowner rejection/constraint.
- "risk": a step is likely to waste budget, return junk, or stall.

Return at most 6 high-signal annotations. If the plan is solid, return fewer. Do not restate the plan. Output JSON only — no prose, no code fences.`;
}

function annotateUserPrompt(input: AnnotatePlanInput): string {
  const rejections =
    input.priorRejections && input.priorRejections.length > 0
      ? input.priorRejections.map((r) => `- ${r}`).join("\n")
      : "- none on record";

  return `Research target: ${input.topic}

Known negative constraints (from homeowner rejections):
${rejections}

Draft research plan to review:
${input.planMarkdown}`;
}

/** Strip markdown code fences a model may wrap JSON in. */
function stripFences(raw: string): string {
  return raw
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();
}

/**
 * Produce structured annotations for a draft plan. Never throws — annotation is
 * advisory, so on any model/parse failure it returns a single "risk" note
 * flagging that automated review was unavailable, and the plan still proceeds to
 * homeowner review.
 */
export async function annotatePlan(
  env: Env,
  input: AnnotatePlanInput,
): Promise<PlanAnnotation[]> {
  try {
    const response = await env.AI.run(
      ANNOTATE_MODEL,
      {
        messages: [
          { role: "system", content: annotateSystemPrompt() },
          { role: "user", content: annotateUserPrompt(input) },
        ],
      },
      { gateway: { id: env.AI_GATEWAY_ID } },
    );

    const raw =
      typeof response === "string"
        ? response
        : ((response as { response?: string })?.response ?? "");

    const parsed = JSON.parse(stripFences(raw)) as { annotations?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.annotations)) return [];

    const allowed: PlanAnnotation["kind"][] = ["scope", "gap", "redundancy", "constraint", "risk"];
    return parsed.annotations
      .filter((a): a is Partial<PlanAnnotation> => typeof a === "object" && a !== null)
      .filter((a) => typeof a.note === "string" && a.note.trim().length > 0)
      .map((a) => ({
        kind: allowed.includes(a.kind as PlanAnnotation["kind"]) ? (a.kind as PlanAnnotation["kind"]) : "scope",
        note: String(a.note).trim(),
      }))
      .slice(0, 6);
  } catch (error) {
    console.error("annotatePlan failed:", error);
    return [
      {
        kind: "risk",
        note: "Automated plan review was unavailable — review the plan manually before approving.",
      },
    ];
  }
}
