/**
 * Material applicability resolution (0043 §5c).
 *
 * The same `ripple_rules` engine serves physical ripples, material
 * applicability, AND scoping questions. This module is the applicability half:
 * given the rules that matched a material-application context, decide what the
 * system DOES — apply silently, exclude silently, ask, or block.
 *
 * The value is not the branching. It is knowing which branches are questions.
 * Tile continuing into a bathroom is genuinely ambiguous → ask. Hardwood
 * continuing into a bathroom almost never is → assume, do not ask. An app that
 * asks both is a nag; one that asks neither is wrong.
 *
 * Pure, no database — the caller fetches matched rules and passes them in.
 */

export type Resolution = "auto_apply" | "auto_exclude" | "must_confirm" | "must_specify";

/** Ordered most-blocking first. When several rules match, the strongest wins. */
export const RESOLUTION_PRECEDENCE: Resolution[] = [
  "must_specify", // cannot proceed
  "must_confirm", // must ask
  "auto_exclude", // do not extend
  "auto_apply", // extend
];

export interface MatchedRule {
  key: string;
  resolution: Resolution;
  /** The reason shown to the homeowner when this rule drives a question. */
  rationale: string | null;
  strength: "always" | "usually" | "sometimes" | string;
}

export interface ApplicabilityOutcome {
  /** The single resolution the system acts on. */
  resolution: Resolution;
  /** True when the homeowner must be asked (must_confirm | must_specify). */
  needsHomeowner: boolean;
  /** True when work cannot continue until answered (must_specify only). */
  blocks: boolean;
  /** The rule that decided the outcome. */
  decidedBy: string | null;
  /** What to show the homeowner, when a question is raised. */
  prompt: string | null;
  /** Every rule that matched, for transparency. */
  matched: MatchedRule[];
}

function rank(r: Resolution): number {
  const i = RESOLUTION_PRECEDENCE.indexOf(r);
  return i === -1 ? RESOLUTION_PRECEDENCE.length : i;
}

/**
 * Resolve a set of matched applicability rules into one outcome.
 *
 * PRECEDENCE, NOT LAST-WINS: when tile-into-bathroom (`must_confirm`) and a
 * whole-floor auto_apply both match, the question wins — silently applying past
 * a real ambiguity is the failure this feature exists to prevent. The strongest
 * (most-blocking) resolution decides.
 *
 * No rules matched is a real answer: `auto_apply`. Absence of a reason to ask is
 * permission to proceed, not a question.
 */
export function resolveApplicability(matched: MatchedRule[]): ApplicabilityOutcome {
  if (matched.length === 0) {
    return {
      resolution: "auto_apply",
      needsHomeowner: false,
      blocks: false,
      decidedBy: null,
      prompt: null,
      matched: [],
    };
  }

  let winner = matched[0];
  for (const r of matched) {
    if (rank(r.resolution) < rank(winner.resolution)) winner = r;
  }

  const needsHomeowner = winner.resolution === "must_confirm" || winner.resolution === "must_specify";
  const blocks = winner.resolution === "must_specify";

  return {
    resolution: winner.resolution,
    needsHomeowner,
    blocks,
    decidedBy: winner.key,
    // A question with no reason shown is a nag; the rationale is required copy.
    prompt: needsHomeowner ? winner.rationale : null,
    matched,
  };
}
