/**
 * @fileoverview Wire contract for the real-time floor-plan session (0006 Phase 2C).
 *
 * Two participants share a room over a WebSocket brokered by `FloorplanSessionDO`:
 *   - the phone/desktop app (the Worker frontend), and
 *   - Claude (via the measurement MCP bridge).
 *
 * Either side can "touch" a wall/space on the traced floor-plan SVG (elements carry
 * ids like `upper_wall_segment_12` / `lower_wall_segment_3`).  A touch is broadcast
 * to every OTHER client in the room so the location lights up on their screen — the
 * "I touch a wall and Claude sees it / Claude touches a wall and I see it flash" loop.
 *
 * Zod guarantees message integrity at the Durable Object boundary.  Inbound is a
 * discriminated union so new message types (e.g. PROPOSE_MEASUREMENT) can be added
 * without weakening validation.  Kept dependency-light (only `zod`) so the DO bundle
 * stays small; the frontend mirrors these shapes with its own lightweight types
 * rather than importing this module (avoids bundling zod into the client).
 */

import { z } from "zod";

/** Max length for an SVG element id we will accept/echo (defensive bound). */
const ELEMENT_ID = z.string().min(1).max(128);

/**
 * A client touched a wall/space on the floor plan.
 * `elementId` is the SVG element id of the touched segment (e.g. `upper_wall_segment_12`).
 */
export const wallTouchMessageSchema = z.object({
  type: z.literal("WALL_TOUCH"),
  elementId: ELEMENT_ID,
});

/**
 * Inbound (client → DO) message union. Add new members here as the protocol grows.
 */
export const inboundMessageSchema = z.discriminatedUnion("type", [wallTouchMessageSchema]);

export type InboundMessage = z.infer<typeof inboundMessageSchema>;

/**
 * Outbound (DO → other clients) envelope. The DO re-broadcasts a validated inbound
 * message enriched with who sent it and a server timestamp, so receivers can label
 * the source ("phone" vs "claude") and ignore stale events.
 */
export interface OutboundMessage {
  type: InboundMessage["type"];
  elementId: string;
  /** Opaque per-connection id of the sender (assigned by the DO on connect). */
  senderId: string;
  /** Sender role from the `?source=` connect param (e.g. "phone" | "claude"). */
  source: string;
  /** Server send time (epoch ms). */
  ts: number;
}

/** Error frame the DO sends back to a client that submitted a bad message. */
export interface ErrorMessage {
  type: "ERROR";
  error: string;
}
