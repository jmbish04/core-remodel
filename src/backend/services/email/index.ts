/**
 * @fileoverview Public entrypoint for the inbound-email service.
 *
 * Consumers (the Worker `email()` handler) import from this folder, never from
 * individual modules. The routing layer (`router` → `routes`) is the front
 * door; the pipeline + classifier are internal but re-exported for testing.
 */

export { handleInboundEmail } from "./router";
export { resolveRoute, buildMatchContext } from "./routes";
export { processEmail } from "./pipeline";
export type {
  RouteId,
  RouteDecision,
  HandlingProfile,
  RouteMatchContext,
  AnalysisDepth,
} from "./types";
