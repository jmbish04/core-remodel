/**
 * @fileoverview Shared types for the inbound-email routing layer.
 *
 * The routing layer sits in front of the processing pipeline and decides, from
 * cheap-to-compute signals (recipient address, sub-address label, sender,
 * subject), HOW an email should be handled. It mirrors the Cloudflare Agents
 * SDK address-based-resolver philosophy (`createAddressBasedEmailResolver`,
 * `agent+id@domain` sub-addressing) but resolves to a domain-specific handling
 * profile instead of an Agent Durable Object instance — this worker processes
 * inbound mail as a fire-and-forget background service, not a per-email agent.
 */

/**
 * Stable identifier for a routing destination. Extend this union (and add a
 * matching rule in `routes.ts`) to introduce a new routing rule in the future
 * — e.g. `"estimates"`, `"permits"`, `"receipts"`.
 */
export type RouteId = "invoices" | "contracts" | "general";

/**
 * How deeply the AI analysis stage should engage for a given route.
 *  - `lean` — extract the essentials only (e.g. invoice fields); skip the
 *    expensive adversarial contract-clause analysis.
 *  - `full` — run the complete classifier + extractor (catch-all default).
 *  - `deep` — full analysis PLUS adversarial, homeowner-protective contract
 *    clause + recommendation generation.
 */
export type AnalysisDepth = "lean" | "full" | "deep";

/**
 * The handling contract a route imposes on the pipeline. Deterministic,
 * address-derived knowledge (`expectedType`) lets the pipeline trust the route
 * over a hesitant AI classifier, while `analysisDepth` tunes cost vs. rigor.
 */
export interface HandlingProfile {
  /**
   * The classification the route deterministically implies, when the address
   * itself carries intent (e.g. `remodel+invoices@` ⇒ `"invoice"`). `null`
   * for the catch-all mailbox, where content classification drives handling.
   */
  expectedType: string | null;
  /** Controls how much of the AI analysis prompt is engaged. */
  analysisDepth: AnalysisDepth;
  /**
   * When true, an AI classification below the confidence floor is overridden
   * by `expectedType`. Only meaningful when `expectedType` is set. This is the
   * value of address-based routing: the recipient address is a strong,
   * attacker-visible-but-not-forgeable-for-delivery signal of intent.
   */
  trustRouteOverAi: boolean;
}

/**
 * The resolved routing decision handed to the pipeline. Persisted (route +
 * reason) on `worker_emails` so the HITL inbox can show why each email was
 * handled the way it was — routing you cannot observe is routing you cannot
 * trust.
 */
export interface RouteDecision {
  routeId: RouteId;
  /** Human-readable reason the route was chosen (persisted for audit). */
  reason: string;
  profile: HandlingProfile;
}

/**
 * Minimal, cheap inputs a routing rule matches against. Built once per inbound
 * email before the (relatively expensive) raw-body read + parse, so routing
 * and rejection stay fast.
 */
export interface RouteMatchContext {
  /** Full recipient address, lowercased (e.g. `"remodel+invoices@hacolby.app"`). */
  to: string;
  /** Local part before `@`, lowercased (e.g. `"remodel+invoices"`). */
  localPart: string;
  /** Base local part with any `+label` stripped (e.g. `"remodel"`). */
  baseLocalPart: string;
  /** Sub-address label after `+` if present (e.g. `"invoices"`), else `null`. */
  subAddress: string | null;
  /** Envelope sender, lowercased. */
  from: string;
  /** Subject header (may be empty). */
  subject: string;
}
