/**
 * @fileoverview Shared helpers for the ad-hoc agent-memory tools.
 *
 * Entries live in `AGENT_ADHOC_MEMORY_KV` under `mem:<memoryUuid>:<entryId>`, so
 * all entries in one group share the `mem:<memoryUuid>:` prefix (KV list target).
 */

/** KV key prefix covering every entry in a memory group. */
export function memPrefix(memoryUuid: string): string {
  return `mem:${memoryUuid}:`;
}

/** Full KV key for one entry. */
export function memKey(memoryUuid: string, entryId: string): string {
  return `mem:${memoryUuid}:${entryId}`;
}

export interface MemoryEnvelope {
  entryId: string;
  label: string | null;
  content: string;
  createdAt: string;
}

/**
 * Parse a stored envelope. Tolerates a raw (non-JSON) value by wrapping it as
 * content, so a hand-written KV entry is never lost.
 */
export function parseEnvelope(entryId: string, raw: string | null): MemoryEnvelope | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MemoryEnvelope>;
    return {
      entryId: parsed.entryId ?? entryId,
      label: parsed.label ?? null,
      content: typeof parsed.content === "string" ? parsed.content : raw,
      createdAt: parsed.createdAt ?? "",
    };
  } catch {
    return { entryId, label: null, content: raw, createdAt: "" };
  }
}
