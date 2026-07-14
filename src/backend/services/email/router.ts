/**
 * @fileoverview Inbound-email routing entry point.
 *
 * This is what the Worker's `email()` handler calls. It applies the guardrails
 * recommended by the Cloudflare Agents SDK email docs, resolves the routing
 * decision, and hands the work to the processing pipeline. Guardrails run in a
 * deliberate order — cheapest + most protective first:
 *
 *   1. Auto-reply / mail-loop protection (`isAutoReplyEmail`, RFC 3834) — drop
 *      before doing any work, so an auto-responder (or a future outbound reply)
 *      can never trigger a processing loop.
 *   2. Route resolution (address tier → catch-all tier).
 *   3. `onNoRoute` rejection — unknown recipients are rejected at SMTP time via
 *      `message.setReject`, not silently blackholed.
 *   4. Dispatch — read the raw body + hand to the pipeline in `ctx.waitUntil`,
 *      keeping the SMTP transaction fast.
 *
 * We intentionally do NOT convert this into a full Agents SDK `EmailAgent`
 * Durable Object: there is no per-email conversation state to keep, the
 * pipeline is fire-and-forget background work, and a new DO class would advance
 * this worker's DO migration tag (a known operational hazard here). Instead we
 * reuse the SDK's genuinely-applicable primitives (`isAutoReplyEmail`) and
 * mirror its address-based-resolver + `onNoRoute` philosophy in `routes.ts`.
 */

import { isAutoReplyEmail } from "agents/email";
import { buildMatchContext, resolveRoute } from "./routes";
import { processEmail } from "./pipeline";

/**
 * Route + process a single inbound email.
 *
 * @param message Cloudflare `ForwardableEmailMessage` from the `email()` handler.
 * @param env     Worker environment bindings.
 * @param ctx     Execution context (used for `waitUntil` background processing).
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const to = message.to || "";
  const from = message.from || "";
  const subject = message.headers.get("subject") || "";

  // ── Guard 1: auto-reply / mail-loop protection ───────────────────────────
  // Vacation responders, "do-not-reply" bounces, and our own future outbound
  // replies carry RFC 3834 headers. Drop them silently — processing them (or,
  // worse, replying) risks an infinite mail loop.
  //
  // `isAutoReplyEmail` expects postal-mime-style `{ key, value }[]` (lowercase
  // keys). The web `Headers` on the message already lowercases keys and
  // iterates as `[name, value]`, so we can adapt it here without a full-body
  // parse — keeping this guard cheap and ahead of the raw read.
  const headerPairs: Array<{ key: string; value: string }> = [];
  message.headers.forEach((value, key) => headerPairs.push({ key, value }));
  if (isAutoReplyEmail(headerPairs)) {
    console.log(
      `[email-router] dropping auto-reply from="${from}" to="${to}" subject="${subject}"`,
    );
    return;
  }

  // ── Guard 2 + 3: resolve route, reject unknown recipients ────────────────
  const matchCtx = buildMatchContext(to, from, subject);
  const decision = resolveRoute(matchCtx);

  if (!decision) {
    // No route → reject at SMTP time rather than accept-and-drop. This mirrors
    // the Agents SDK `onNoRoute` → `email.setReject(...)` recommendation and
    // gives the sender a bounce instead of a black hole.
    console.warn(
      `[email-router] no route for recipient="${matchCtx.to || "(none)"}" ` +
        `from="${from}" — rejecting`,
    );
    message.setReject("Unknown recipient");
    return;
  }

  console.log(
    `[email-router] routed to="${matchCtx.to}" from="${from}" ` +
      `→ route=${decision.routeId} depth=${decision.profile.analysisDepth} ` +
      `(${decision.reason})`,
  );

  // ── Guard 4: dispatch ────────────────────────────────────────────────────
  // Read the raw body now (before the SMTP transaction closes) but do the
  // heavy parse/AI/persist work in the background so we don't hold the
  // connection open.
  const rawEmail = await new Response(message.raw).arrayBuffer();
  const messageId = message.headers.get("message-id") || crypto.randomUUID();

  ctx.waitUntil(
    processEmail({
      messageId,
      rawEmail,
      from,
      to,
      decision,
      env,
    }).catch((err) =>
      console.error("[email-router] processEmail failed:", err),
    ),
  );
}
