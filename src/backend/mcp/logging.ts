/**
 * @fileoverview MCP tool-call logging middleware (0017 §3A / §6).
 *
 * A single cross-cutting writer used by BOTH transports (the OAuth
 * `RemodelMcpAgent` at `/mcp` and the legacy JSON-RPC `/api/mcp`) to persist
 * one row per `tools/call`. The caller times the handler, then hands the
 * outcome here and wraps the returned promise in `ctx.waitUntil(...)` so
 * logging NEVER adds latency to the tool response.
 *
 * What it records:
 *   - upserts an `mcp_sessions` row (bumping `lastSeenAt` + `toolCallCount`)
 *     so tool calls group into a per-session transcript, and
 *   - inserts an `mcp_tool_invocations` row (name, capped args, ok/result or
 *     error, duration).
 *
 * Discipline:
 *   - Args + results are serialized and size-capped ({@link CAP} bytes) with a
 *     "…[truncated]" marker so a giant blob can't bloat D1.
 *   - Obvious secret-ish keys are redacted defensively; the transport auth
 *     token / `WORKER_API_KEY` are never passed into a handler so they don't
 *     reach here, but redaction is belt-and-suspenders.
 *   - Every write is best-effort: a logging failure is swallowed (console.error
 *     only) so observability can never break a working tool.
 */
import { mcpSessions, mcpToolInvocations } from "@backend/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** Max serialized length (chars) stored for args / result blobs. */
const CAP = 8_192;

/** Keys whose values are redacted before logging (defense-in-depth). */
const SECRET_KEY_RE = /token|secret|password|api[_-]?key|authorization|bearer/i;

/** The transports that can open an MCP session. */
export type McpTransport = "streamable" | "sse" | "legacy";

/** Everything the logger needs about one completed tool call. */
export interface InvocationLog {
  /** MCP session id (or a synthesized id for the legacy transport). */
  sessionId: string;
  transport: McpTransport;
  /** `<kind>:<userId>` caller identity, when known. */
  principal?: string;
  toolName: string;
  /** Raw call arguments (redacted + capped before storage). */
  args: unknown;
  /** True when the handler returned without throwing. */
  ok: boolean;
  /** Successful result (redacted + capped); omit on error. */
  result?: unknown;
  /** Error message; omit on success. */
  error?: string;
  durationMs: number;
}

/**
 * Shallow-redact obvious secret-ish top-level keys, then JSON-serialize and cap
 * to {@link CAP} chars. Returns `null` for `undefined` so a missing result
 * stores as SQL NULL rather than the string "undefined".
 */
function capJson(value: unknown): string | null {
  if (value === undefined) return null;

  let redacted = value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    redacted = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY_RE.test(k) ? "[redacted]" : v,
      ]),
    );
  }

  let serialized: string;
  try {
    serialized = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
  } catch {
    serialized = String(redacted);
  }
  if (serialized == null) return null;
  return serialized.length > CAP ? `${serialized.slice(0, CAP)}…[truncated]` : serialized;
}

/**
 * Persist one tool-call transcript row + bump its session. Best-effort: any
 * failure is logged and swallowed. Call as `ctx.waitUntil(logInvocation(...))`.
 */
export async function logInvocation(env: Env, log: InvocationLog): Promise<void> {
  try {
    const db = drizzle(env.DB);
    const now = new Date();

    // Upsert the session: create on first sight, else bump activity + count.
    await db
      .insert(mcpSessions)
      .values({
        id: log.sessionId,
        transport: log.transport,
        principal: log.principal,
        toolCallCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: mcpSessions.id,
        set: {
          lastSeenAt: now,
          toolCallCount: sql`${mcpSessions.toolCallCount} + 1`,
          // Keep the latest known principal (may resolve later in a session).
          ...(log.principal !== undefined ? { principal: log.principal } : {}),
        },
      });

    await db.insert(mcpToolInvocations).values({
      sessionId: log.sessionId,
      toolName: log.toolName,
      argsJson: capJson(log.args),
      ok: log.ok,
      resultJson: log.ok ? capJson(log.result) : null,
      errorText: log.ok ? null : (log.error ?? "unknown error"),
      durationMs: log.durationMs,
      createdAt: now,
    });
  } catch (err) {
    console.error("[mcp/logging] failed to log invocation (non-fatal):", err);
  }
}

/** Build a `<kind>:<userId>` principal label from resolved MCP props. */
export function principalLabel(props: {
  kind?: string;
  userId?: string;
} | null | undefined): string | undefined {
  if (!props) return undefined;
  const kind = props.kind ?? "unknown";
  const userId = props.userId ?? "unknown";
  return `${kind}:${userId}`;
}
