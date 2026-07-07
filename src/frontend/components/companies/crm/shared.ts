/**
 * @fileoverview Shared wire types + fetch helpers + Plate/Slate JSON round-trip
 * utilities for the Phase-3 CRM Notes + Todos UI.
 *
 * Mirrors the `documents/shared.tsx` apiGet/apiSend idiom locally (do NOT import
 * documents/shared for CRM types). All CRM responses envelope as
 * `{ success: true, ... }`; errors as `{ error: string }`. Auth rides the
 * `remodel_access` cookie, so every request uses `credentials: "include"`.
 */

import type { Descendant } from "slate";

// ---------------------------------------------------------------------------
// Wire types — mirror the Phase-3 CRM API (companies notes + todos routes).
// ---------------------------------------------------------------------------

export type TodoStatus = "open" | "in_progress" | "blocked" | "done";

export interface Note {
  id: number;
  companyId: number;
  title: string;
  /** JSON string that parses to an array of PlateJS Slate nodes. */
  content: string;
  isDeleted: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface Todo {
  id: number;
  companyId: number;
  title: string;
  /** JSON string of Slate nodes, or null when no rich content. */
  content: string | null;
  status: TodoStatus;
  dueDate: number | null;
  owner: string | null;
  tags: string[];
  isDeleted: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface NotesListResponse {
  success: true;
  notes: Note[];
}
export interface NoteResponse {
  success: true;
  note: Note;
}
export interface TodosListResponse {
  success: true;
  todos: Todo[];
}
export interface TodoResponse {
  success: true;
  todo: Todo;
}
export interface DeleteResponse {
  success: true;
}

export interface NoteWritePayload {
  title?: string;
  content?: string;
}

export interface TodoWritePayload {
  title?: string;
  content?: string;
  status?: TodoStatus;
  dueDate?: number | null;
  owner?: string | null;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Fetch helpers — forward the access cookie, throw readable errors.
// ---------------------------------------------------------------------------

interface ApiEnvelope {
  success?: boolean;
  error?: string;
}

function envelopeError(payload: ApiEnvelope, status: number): string {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  return `Request failed (${status})`;
}

/** GET helper. Throws on non-2xx / `success:false`. */
export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as T & ApiEnvelope;
  if (!response.ok || payload.success === false) {
    const error = new Error(envelopeError(payload, response.status)) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

/** JSON-body helper for POST/PATCH/DELETE. Throws on non-2xx / `success:false`. */
export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & ApiEnvelope;
  if (!response.ok || payload.success === false) {
    const error = new Error(envelopeError(payload, response.status)) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

// ---------------------------------------------------------------------------
// Plate / Slate JSON round-trip.
//
// The API stores `content` as a JSON string that parses to an array of Slate
// nodes (PlateJS descendants). We serialize with JSON.stringify(descendants)
// and hydrate with JSON.parse — NOT plain text. Both paths have safe fallbacks
// so a malformed/legacy plain-text value never crashes the editor: it gets
// wrapped in a single paragraph node instead.
// ---------------------------------------------------------------------------

/** A single empty paragraph — the canonical "blank document" value. */
export function emptySlate(): Descendant[] {
  return [{ type: "p", children: [{ text: "" }] } as unknown as Descendant];
}

/** Wrap plain text into Slate paragraph nodes (one per line). */
export function textToSlate(text: string): Descendant[] {
  if (!text || !text.trim()) return emptySlate();
  return text
    .split("\n")
    .map((line) => ({ type: "p", children: [{ text: line }] }) as unknown as Descendant);
}

/**
 * Parse a stored `content` JSON string into Slate nodes.
 * Falls back to wrapping non-JSON / non-array content as plain text so legacy
 * or malformed rows still render.
 */
export function jsonToSlate(content: string | null | undefined): Descendant[] {
  if (content === null || content === undefined || content === "") return emptySlate();
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Descendant[];
    // Parsed but empty (e.g. "[]") → blank document.
    if (Array.isArray(parsed)) return emptySlate();
    // Parsed to a non-array (e.g. a bare string/number) → treat as plain text.
    return textToSlate(String(parsed));
  } catch {
    // Not valid JSON at all → legacy plain text.
    return textToSlate(content);
  }
}

/** Serialize Slate nodes into the JSON string the API expects. */
export function slateToJson(nodes: Descendant[]): string {
  const value = Array.isArray(nodes) && nodes.length > 0 ? nodes : emptySlate();
  return JSON.stringify(value);
}

/** Extract a plain-text preview from Slate nodes (for card previews). */
export function slateToText(nodes: Descendant[]): string {
  return nodes
    .map((node: any) => {
      if (Array.isArray(node?.children)) {
        return node.children.map((child: any) => child?.text ?? "").join("");
      }
      return node?.text ?? "";
    })
    .join("\n");
}

/** Text preview straight from a stored JSON content string (list cards). */
export function contentPreview(content: string | null | undefined, maxLines = 3): string {
  const text = slateToText(jsonToSlate(content)).trim();
  if (!text) return "";
  return text.split("\n").filter(Boolean).slice(0, maxLines).join("\n");
}

/** True when the Slate value has no visible text. */
export function isSlateEmpty(nodes: Descendant[]): boolean {
  return slateToText(nodes).trim().length === 0;
}

// ---------------------------------------------------------------------------
// Presentation helpers.
// ---------------------------------------------------------------------------

/** Format an epoch-ms timestamp as a short date, "—" when null. */
export function formatDate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Format an epoch-ms timestamp as a short date + time. */
export function formatDateTime(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Convert an epoch-ms timestamp to a yyyy-mm-dd value for <input type="date">. */
export function epochToDateInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * Convert a yyyy-mm-dd date-input string to an epoch-ms timestamp (local
 * midnight). Returns null for an empty input.
 */
export function dateInputToEpoch(value: string): number | null {
  if (!value) return null;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Whether a todo is overdue: has a past due date and is not done. */
export function isOverdue(todo: Pick<Todo, "dueDate" | "status">): boolean {
  if (todo.dueDate === null || todo.status === "done") return false;
  // Overdue once the due day has fully passed (compare to today's local start).
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return todo.dueDate < startOfToday.getTime();
}

export const TODO_STATUS_META: Record<
  TodoStatus,
  { label: string; className: string; dot: string }
> = {
  open: {
    label: "Open",
    className: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
    dot: "bg-zinc-400",
  },
  in_progress: {
    label: "In progress",
    className: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
    dot: "bg-sky-400",
  },
  blocked: {
    label: "Blocked",
    className: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
    dot: "bg-rose-400",
  },
  done: {
    label: "Done",
    className: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
    dot: "bg-emerald-400",
  },
};

export const TODO_STATUSES: TodoStatus[] = ["open", "in_progress", "blocked", "done"];
