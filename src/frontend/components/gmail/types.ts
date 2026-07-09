/**
 * @fileoverview Types + a credentialed fetch client for the Gmail Comms Hub UI.
 *
 * Every shape here is derived directly from `src/backend/api/routes/gmail.ts`
 * (mounted at `/api/gmail`, gated by `requireAccessAuth`). Dates cross the wire
 * as JSON — Drizzle date columns serialize to either a number (epoch ms) or an
 * ISO string, so every date field is typed `number | string | null` and passed
 * straight to `new Date(...)` for formatting.
 *
 * The client always sends `credentials: "include"` so the Access session cookie
 * rides along — these endpoints are admin-only and 401 without it.
 */

// ─── Wire shapes (mirror gmail.ts response schemas) ──────────────────────────

/** A date as it arrives over JSON: epoch-ms number, ISO string, or null. */
export type WireDate = number | string | null;

/** The most-recent message on a thread, as summarized in list views. */
export interface GmailLastMessage {
  from: string;
  subject: string | null;
  snippet: string;
  date: WireDate;
}

/**
 * Shared list-item shape for `GET /threads` (global inbox) and
 * `GET /companies/:companyId/threads-by-domain` (domain-matched). Matches
 * `inboxThreadItemSchema` in gmail.ts.
 */
export interface GmailInboxThreadItem {
  threadId: string;
  subject: string | null;
  companyId: number | null;
  companyName: string | null;
  lastMessage: GmailLastMessage | null;
  messageCount: number;
}

/** A single message within a thread. Matches `messageSchema` in gmail.ts. */
export interface GmailMessage {
  id: number;
  threadId: string;
  messageId: string;
  timestamp: WireDate;
  fromRecipient: string;
  toRecipients: string[];
  subject: string | null;
  body: string | null;
  aiSummary: string | null;
  ragUuid: string;
}

/** Thread header. Matches `threadDetailSchema` in gmail.ts. */
export interface GmailThreadDetail {
  id: number;
  threadId: string;
  subject: string | null;
  timestampSent: WireDate;
  companyId: number | null;
}

// ─── Response envelopes ──────────────────────────────────────────────────────

export interface ListInboxResponse {
  success: true;
  threads: GmailInboxThreadItem[];
  limit: number;
  offset: number;
}

export interface ThreadsByDomainResponse {
  success: true;
  domains: string[];
  threads: GmailInboxThreadItem[];
}

export interface ThreadDetailResponse {
  success: true;
  thread: GmailThreadDetail;
  messages: GmailMessage[];
}

export interface ReplyResponse {
  success: true;
  messageId: string;
}

export interface DraftAssistResponse {
  success: true;
  draft: string;
}

interface ErrorResponse {
  error: string;
}

// ─── Fetch client ────────────────────────────────────────────────────────────

const BASE = "/api/gmail";

/**
 * Thin, typed wrapper over `fetch` for the Gmail routes. Always credentialed.
 * On a non-2xx it parses the `{ error }` envelope and throws an `Error` whose
 * message is safe to surface in a toast.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    // Merge headers last so a body's default Content-Type survives even when
    // the caller passes its own headers in `init`.
    headers: {
      ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as ErrorResponse;
      if (data?.error) message = data.error;
    } catch {
      // non-JSON error body — keep the status-code fallback
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

/** Build a `?limit=&offset=&q=` query string, omitting empty values. */
function inboxQuery(params: { limit?: number; offset?: number; q?: string }): string {
  const sp = new URLSearchParams();
  if (params.limit != null) sp.set("limit", String(params.limit));
  if (params.offset != null) sp.set("offset", String(params.offset));
  if (params.q != null && params.q.trim() !== "") sp.set("q", params.q.trim());
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const gmailApi = {
  /** `GET /api/gmail/threads` — global inbox, paginated, optional search. */
  listInbox(params: { limit?: number; offset?: number; q?: string } = {}, signal?: AbortSignal) {
    return request<ListInboxResponse>(`/threads${inboxQuery(params)}`, { signal });
  },

  /** `GET /api/gmail/companies/:companyId/threads-by-domain`. */
  listCompanyThreadsByDomain(companyId: number, signal?: AbortSignal) {
    return request<ThreadsByDomainResponse>(
      `/companies/${companyId}/threads-by-domain`,
      { signal },
    );
  },

  /** `GET /api/gmail/threads/:threadId` — thread header + messages. */
  getThread(threadId: string, signal?: AbortSignal) {
    return request<ThreadDetailResponse>(
      `/threads/${encodeURIComponent(threadId)}`,
      { signal },
    );
  },

  /** `POST /api/gmail/threads/:threadId/reply` — reply-all + send. */
  reply(threadId: string, body: string) {
    return request<ReplyResponse>(
      `/threads/${encodeURIComponent(threadId)}/reply`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
  },

  /**
   * `POST /api/gmail/draft-assist` — Workers-AI reply draft for a thread.
   * Note: draft-assist is a top-level route (takes `threadId` in the body),
   * not nested under `/threads/:threadId`.
   */
  draftAssist(threadId: string, instruction?: string) {
    return request<DraftAssistResponse>(`/draft-assist`, {
      method: "POST",
      body: JSON.stringify(
        instruction ? { threadId, instruction } : { threadId },
      ),
    });
  },
};

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Extract a display name from a `Name <addr@host>` or bare-address string. */
export function displayNameFromAddress(raw: string): string {
  if (!raw) return "";
  const angle = raw.indexOf("<");
  if (angle > 0) {
    const name = raw.slice(0, angle).trim().replace(/^"|"$/g, "");
    if (name) return name;
  }
  const at = raw.indexOf("@");
  return at > 0 ? raw.slice(0, at) : raw;
}

/** A stable two-letter avatar fallback from an address/name. */
export function initialsFromAddress(raw: string): string {
  const name = displayNameFromAddress(raw).trim();
  if (!name) return "?";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Short, relative-ish date for list rows. Empty string on null/invalid. */
export function formatListDate(value: WireDate): string {
  if (value == null) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/** Full date+time for the reading pane. Empty string on null/invalid. */
export function formatFullDate(value: WireDate): string {
  if (value == null) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
