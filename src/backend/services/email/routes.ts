/**
 * @fileoverview Declarative routing-rule registry + resolver for inbound email.
 *
 * This is the single place to add or change how the worker routes inbound
 * mail. The user's stated model — "invoices are handled one way, contracts
 * another, and in the future we may have additional routing rules" — maps
 * directly onto the ordered `ROUTE_RULES` array below: each rule is a small,
 * self-contained object. To add a future rule (e.g. an `estimates@` mailbox),
 * add a `RouteId` to `types.ts` and append a rule here — nothing else changes.
 *
 * Routing philosophy (mirrors the Agents SDK `createAddressBasedEmailResolver`
 * `agent+id@domain` sub-address convention):
 *   1. Address tier (deterministic, cheap): a dedicated mailbox or `+label`
 *      sub-address carries explicit intent → pick the matching rule directly.
 *   2. Content tier (AI fallback): the catch-all base mailbox has no address
 *      hint → route to `general`, where the AI classifier decides the type.
 *
 * Recipient addresses are matched case-insensitively, because email
 * infrastructure routinely lowercases addresses (same caveat the SDK docs call
 * out for agent class names in recipient addresses).
 */

import type {
  HandlingProfile,
  RouteDecision,
  RouteId,
  RouteMatchContext,
} from "./types";

/**
 * Base mailbox local-parts this worker owns. Mail addressed to one of these
 * (optionally with a `+label` sub-address) is accepted; anything else has no
 * route and is rejected at SMTP time by the router's `onNoRoute` guard.
 *
 * Cloudflare Email Routing only delivers configured destination addresses to
 * the worker in the first place, so this is defense-in-depth — but it also
 * lets us safely enable a catch-all routing rule at the domain without
 * silently swallowing typo'd or probing recipients.
 */
export const KNOWN_BASE_LOCAL_PARTS: readonly string[] = ["remodel"];

/**
 * Below this AI classification confidence, a route with `trustRouteOverAi`
 * overrides the AI's guess with the route's `expectedType`. Kept here (not in
 * the pipeline) so the routing contract lives in one file.
 */
export const ROUTE_OVERRIDE_CONFIDENCE_FLOOR = 0.5;

/** A single routing rule: a predicate over cheap signals + a handling profile. */
interface RouteRule {
  id: RouteId;
  /** Human-readable description, surfaced in logs + the persisted route reason. */
  description: string;
  /** Returns true when this rule claims the email. Evaluated in array order. */
  match(ctx: RouteMatchContext): boolean;
  profile: HandlingProfile;
}

/**
 * Ordered, address-tier rules. First match wins. The catch-all is intentionally
 * NOT in this array — it is applied separately so an unknown recipient (no rule
 * match, unknown base mailbox) can be rejected rather than silently absorbed.
 */
const ROUTE_RULES: readonly RouteRule[] = [
  {
    id: "invoices",
    description: "Invoices mailbox (remodel+invoices@ or invoices@)",
    match: (c) => c.subAddress === "invoices" || c.baseLocalPart === "invoices",
    profile: {
      expectedType: "invoice",
      analysisDepth: "lean",
      trustRouteOverAi: true,
    },
  },
  {
    id: "contracts",
    description:
      "Contracts mailbox (remodel+contracts@ or contracts@) — deep clause review",
    match: (c) =>
      c.subAddress === "contracts" ||
      c.subAddress === "contract" ||
      c.baseLocalPart === "contracts",
    profile: {
      expectedType: "contract",
      analysisDepth: "deep",
      trustRouteOverAi: true,
    },
  },
  // ── Future routing rules go here ─────────────────────────────────────────
  // Example — an estimates mailbox with lean extraction:
  //   {
  //     id: "estimates",
  //     description: "Estimates mailbox (remodel+estimates@)",
  //     match: (c) => c.subAddress === "estimates",
  //     profile: { expectedType: "estimate", analysisDepth: "lean", trustRouteOverAi: true },
  //   },
];

/**
 * The catch-all rule for the base mailbox. No address intent, so the AI
 * classifier drives downstream handling (invoice/contract/estimate/…).
 */
const CATCH_ALL_PROFILE: HandlingProfile = {
  expectedType: null,
  analysisDepth: "full",
  trustRouteOverAi: false,
};

/**
 * Parse a recipient address into the cheap signals routing rules match on.
 *
 * @param to  Raw recipient address (any case). May be empty if absent.
 * @param from Raw envelope sender (any case).
 * @param subject Subject header (may be empty).
 */
export function buildMatchContext(
  to: string,
  from: string,
  subject: string,
): RouteMatchContext {
  const normalizedTo = (to || "").trim().toLowerCase();
  const localPart = normalizedTo.split("@")[0] ?? "";
  const plusIdx = localPart.indexOf("+");
  const baseLocalPart = plusIdx >= 0 ? localPart.slice(0, plusIdx) : localPart;
  const subAddress =
    plusIdx >= 0 ? localPart.slice(plusIdx + 1) || null : null;

  return {
    to: normalizedTo,
    localPart,
    baseLocalPart,
    subAddress,
    from: (from || "").trim().toLowerCase(),
    subject: subject || "",
  };
}

/**
 * Resolve an inbound email to a routing decision.
 *
 * @returns the {@link RouteDecision}, or `null` when the recipient is unknown
 *   (no address-tier rule matched and the base mailbox is not one we own). A
 *   `null` result signals the router to reject the message (`onNoRoute`).
 */
export function resolveRoute(ctx: RouteMatchContext): RouteDecision | null {
  // Address tier — first matching dedicated/sub-addressed rule wins.
  for (const rule of ROUTE_RULES) {
    if (rule.match(ctx)) {
      return {
        routeId: rule.id,
        reason: `address:${ctx.to || "(none)"} → ${rule.description}`,
        profile: rule.profile,
      };
    }
  }

  // Catch-all tier — only for base mailboxes we actually own.
  if (KNOWN_BASE_LOCAL_PARTS.includes(ctx.baseLocalPart)) {
    return {
      routeId: "general",
      reason: `catch-all:${ctx.to || "(none)"} → AI content classification`,
      profile: CATCH_ALL_PROFILE,
    };
  }

  // Unknown recipient — no route.
  return null;
}
