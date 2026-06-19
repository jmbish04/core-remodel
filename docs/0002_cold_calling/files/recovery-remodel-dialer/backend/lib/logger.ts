import { createDb } from "../db";
import { eventLogs } from "../db/schemas";

type Level = "info" | "warn" | "error";

/**
 * Mirrored logging layer. Writes to console AND the D1 event_logs table.
 * Logging must never throw and break the request, but it must never be
 * swallowed silently either — failures are surfaced to console.error.
 */
export async function logEvent(
  d1: D1Database,
  level: Level,
  scope: string,
  message: string,
  meta?: unknown,
): Promise<void> {
  const metaStr = meta === undefined ? null : safeJson(meta);
  // eslint-disable-next-line no-console
  console[level === "error" ? "error" : "log"](`[${level}] ${scope}: ${message}`, metaStr ?? "");
  try {
    const db = createDb(d1);
    await db.insert(eventLogs).values({ level, scope, message, meta: metaStr });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("event_logs write failed", err);
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
