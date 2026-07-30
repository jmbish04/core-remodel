/**
 * @fileoverview Gmail Comms Hub — minimal Gmail REST client (fetch-based).
 *
 * No `googleapis` SDK (Node-only assumptions break on Workers) — just typed
 * fetch wrappers around the subset of the Gmail v1 REST API this hub needs:
 * search, full-message fetch (+ header/body extraction), and send.
 */

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Hard cap on how many message ids a single `searchMessages` call will page through. */
const MAX_SEARCH_RESULTS = 200;
const SEARCH_PAGE_SIZE = 100;

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function gmailFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    throw new Error(`gmail/client: ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res;
}

// ─── base64url decode (Gmail uses the URL-safe alphabet, no padding) ────────

function base64UrlDecodeToString(data: string): string {
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (err) {
    console.error("gmail/client: failed to decode base64url message part:", err);
    return "";
  }
}

function base64UrlEncodeFromString(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Very small HTML-tag stripper for text/html fallback bodies (best-effort, not a full parser). */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface GmailSearchResult {
  id: string;
  threadId: string;
}

interface GmailListMessagesResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * GET /messages?q=... — pages through `nextPageToken` until either Gmail
 * stops returning one or the `maxResults` cap (default `MAX_SEARCH_RESULTS`)
 * is hit.
 */
export async function searchMessages(
  token: string,
  q: string,
  maxResults: number = MAX_SEARCH_RESULTS,
): Promise<GmailSearchResult[]> {
  const results: GmailSearchResult[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q,
      maxResults: String(Math.min(SEARCH_PAGE_SIZE, maxResults - results.length)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await gmailFetch(token, `/messages?${params.toString()}`);
    const data = (await res.json()) as GmailListMessagesResponse;

    for (const m of data.messages ?? []) {
      results.push({ id: m.id, threadId: m.threadId });
    }

    pageToken = data.nextPageToken;
  } while (pageToken && results.length < maxResults);

  return results.slice(0, maxResults);
}

// ─── Get message (full) ───────────────────────────────────────────────────────

export interface GmailMessagePart {
  /** Set on attachment parts (empty/absent on inline body parts). */
  filename?: string;
  mimeType?: string;
  /** Part-level MIME headers (Content-ID / Content-Disposition live here). */
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessagePayload {
  headers?: { name: string; value: string }[];
  filename?: string;
  mimeType?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessageFull {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePayload;
}

export async function getMessage(token: string, id: string): Promise<GmailMessageFull> {
  const res = await gmailFetch(token, `/messages/${id}?format=full`);
  return (await res.json()) as GmailMessageFull;
}

export interface ExtractedMessage {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  messageIdHeader: string | null;
  /** Best-effort plaintext body (text/plain, else stripped HTML, else snippet). */
  body: string;
  /** Raw text/html body when present (0041). Sanitized on render, not here. */
  html: string | null;
}

function getHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
  if (!headers) return "";
  const match = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return match?.value ?? "";
}

function splitAddressList(value: string): string[] {
  if (!value) return [];
  // Naive split on commas outside of quoted display-name segments — Gmail
  // headers are well-formed enough that this is safe for our purposes.
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Recursively walk `payload.parts`, preferring text/plain, falling back to stripped text/html. */
function extractBodyFromPart(part: GmailMessagePart | GmailMessagePayload | undefined): {
  plain?: string;
  html?: string;
} {
  if (!part) return {};

  let plain: string | undefined;
  let html: string | undefined;

  if (part.mimeType === "text/plain" && part.body?.data) {
    plain = base64UrlDecodeToString(part.body.data);
  } else if (part.mimeType === "text/html" && part.body?.data) {
    html = base64UrlDecodeToString(part.body.data);
  }

  if (part.parts) {
    for (const child of part.parts) {
      const childResult = extractBodyFromPart(child);
      plain = plain ?? childResult.plain;
      html = html ?? childResult.html;
    }
  }

  return { plain, html };
}

/** Extract headers (From/To/Cc/Subject/Date/Message-Id) + best-effort text body. */
export function extractMessage(message: GmailMessageFull): ExtractedMessage {
  const headers = message.payload?.headers;
  const from = getHeader(headers, "From");
  const to = splitAddressList(getHeader(headers, "To"));
  const cc = splitAddressList(getHeader(headers, "Cc"));
  const subject = getHeader(headers, "Subject");
  const date = getHeader(headers, "Date");
  const messageIdHeader = getHeader(headers, "Message-Id") || getHeader(headers, "Message-ID") || null;

  const { plain, html } = extractBodyFromPart(message.payload);
  const body = plain ?? (html ? stripHtmlTags(html) : message.snippet ?? "");

  return { from, to, cc, subject, date, messageIdHeader, body, html: html ?? null };
}

export interface InlineImagePart {
  /** Content-ID with angle brackets stripped — matches `src="cid:<this>"`. */
  contentId: string;
  mimeType: string;
  /** Gmail attachment id (fetch bytes via getAttachmentBytes) when not inline. */
  attachmentId?: string;
  /** base64url image bytes when Gmail inlined them directly on the part. */
  inlineData?: string;
}

/**
 * Walk a message payload for EMBEDDED (inline) images — image/* parts carrying a
 * `Content-ID` header, which the HTML body references as `src="cid:...">`. These
 * are distinct from downloadable attachments (handled elsewhere). Returns one
 * entry per inline image with either an `attachmentId` (fetch separately) or
 * `inlineData` (bytes already present).
 */
export function collectInlineImageParts(
  part: GmailMessagePart | GmailMessagePayload | undefined,
): InlineImagePart[] {
  if (!part) return [];
  const out: InlineImagePart[] = [];

  const mime = part.mimeType ?? "";
  if (mime.startsWith("image/")) {
    const cidHeader = (part.headers ?? []).find((h) => h.name.toLowerCase() === "content-id");
    if (cidHeader?.value) {
      const contentId = cidHeader.value.trim().replace(/^<|>$/g, "");
      if (contentId) {
        out.push({
          contentId,
          mimeType: mime,
          attachmentId: part.body?.attachmentId,
          inlineData: part.body?.attachmentId ? undefined : part.body?.data,
        });
      }
    }
  }

  for (const child of part.parts ?? []) out.push(...collectInlineImageParts(child));
  return out;
}

/** Fetch one attachment's raw bytes (Gmail returns base64url in `data`). */
export async function getAttachmentBytes(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const res = await gmailFetch(token, `/messages/${messageId}/attachments/${attachmentId}`);
  const data = (await res.json()) as { data?: string; size?: number };
  return base64UrlToBytes(data.data ?? "");
}

/** Decode a base64url string to raw bytes. */
export function base64UrlToBytes(b64url: string): Uint8Array {
  if (!b64url) return new Uint8Array(0);
  const normalized = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export interface SendMessageResult {
  id: string;
  threadId: string;
}

export async function sendMessage(
  token: string,
  rawRfc822Base64url: string,
  threadId?: string,
): Promise<SendMessageResult> {
  const res = await gmailFetch(token, "/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw: rawRfc822Base64url,
      ...(threadId ? { threadId } : {}),
    }),
  });
  return (await res.json()) as SendMessageResult;
}

/** Fetch a message as raw RFC-822 bytes (Gmail `format=raw`, base64url). */
export async function getRawMessage(token: string, id: string): Promise<ArrayBuffer> {
  const res = await gmailFetch(token, `/messages/${id}?format=raw`);
  const data = (await res.json()) as { raw?: string };
  if (!data.raw) throw new Error(`gmail/client: message ${id} returned no raw body`);
  const normalized = data.raw.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

/** GET /labels — every label (system + user) on the mailbox. */
export async function listLabels(token: string): Promise<GmailLabel[]> {
  const res = await gmailFetch(token, "/labels");
  const data = (await res.json()) as { labels?: GmailLabel[] };
  return data.labels ?? [];
}

/**
 * Return the id of the label named `name`, creating it if absent. Nested labels
 * use "/" in the name (Gmail renders them as a hierarchy), e.g.
 * `core-remodel/unit-testing`. Idempotent: a name clash on create (race) falls
 * back to a re-list.
 */
export async function ensureLabel(token: string, name: string): Promise<string> {
  const existing = (await listLabels(token)).find((l) => l.name === name);
  if (existing) return existing.id;
  try {
    const res = await gmailFetch(token, "/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
    });
    return ((await res.json()) as GmailLabel).id;
  } catch (err) {
    // 409 (label already exists) can happen if two runs race — re-read.
    const retry = (await listLabels(token)).find((l) => l.name === name);
    if (retry) return retry.id;
    throw err;
  }
}

/** POST /messages/{id}/modify — add and/or remove label ids on one message. */
export async function modifyMessageLabels(
  token: string,
  messageId: string,
  add: string[] = [],
  remove: string[] = [],
): Promise<void> {
  await gmailFetch(token, `/messages/${messageId}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
}

// ─── Compose helpers ──────────────────────────────────────────────────────────

export interface ReplyAllInput {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  inReplyTo?: string | null;
  references?: string | null;
  /** Plaintext body (always sent — the text/plain fallback part). */
  body: string;
  /** Optional rich HTML body (0041). When present the message is sent as
   *  multipart/alternative (text + html). */
  html?: string | null;
}

function escapeHeaderValue(value: string): string {
  // Basic CRLF-injection guard — headers are single-line.
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Build an RFC-822 message (plain text) and return it base64url-encoded, as
 * required by the Gmail `messages.send` `raw` field. Adds "Re: " to the
 * subject if not already present, and includes In-Reply-To/References for
 * proper threading when available.
 */
export function buildReplyAllRaw(input: ReplyAllInput): string {
  const subject = /^re:/i.test(input.subject.trim())
    ? input.subject.trim()
    : `Re: ${input.subject.trim()}`;

  const headers = [
    `From: ${escapeHeaderValue(input.from)}`,
    `To: ${escapeHeaderValue(input.to.join(", "))}`,
  ];

  if (input.cc && input.cc.length > 0) {
    headers.push(`Cc: ${escapeHeaderValue(input.cc.join(", "))}`);
  }

  headers.push(`Subject: ${escapeHeaderValue(subject)}`);
  headers.push("MIME-Version: 1.0");
  if (input.inReplyTo) headers.push(`In-Reply-To: ${escapeHeaderValue(input.inReplyTo)}`);
  if (input.references) headers.push(`References: ${escapeHeaderValue(input.references)}`);

  const raw = buildMimeBody(headers, input.body, input.html);
  return base64UrlEncodeFromString(raw);
}

/**
 * Assemble the RFC-822 message from headers + a plaintext body and an optional
 * HTML body. With HTML, emits `multipart/alternative` (text/plain + text/html)
 * so clients that can't render HTML fall back to the plaintext part.
 */
function buildMimeBody(headers: string[], text: string, html?: string | null): string {
  if (!html || !html.trim()) {
    return `${[...headers, 'Content-Type: text/plain; charset="UTF-8"'].join("\r\n")}\r\n\r\n${text}`;
  }
  // Fixed boundary is fine — content is not attacker-controlled here, and the
  // parts never contain the boundary token.
  const boundary = "----=_remodel_alt_boundary";
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${boundary}--`,
  ].join("\r\n");
  return `${[...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`].join("\r\n")}\r\n\r\n${parts}`;
}

/** Plain (non-reply) compose — same MIME construction, no threading headers, no "Re:" prefix. */
export function buildComposeRaw(input: {
  from: string;
  to: string[];
  subject: string;
  body: string;
}): string {
  const subject = input.subject.trim().length > 0 ? input.subject.trim() : "(no subject)";
  const lines = [
    `From: ${escapeHeaderValue(input.from)}`,
    `To: ${escapeHeaderValue(input.to.join(", "))}`,
    `Subject: ${escapeHeaderValue(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  const raw = `${lines.join("\r\n")}\r\n\r\n${input.body}`;
  return base64UrlEncodeFromString(raw);
}
