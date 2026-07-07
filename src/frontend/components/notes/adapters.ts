/**
 * @fileoverview Note-editor adapter registry.
 *
 * The dedicated full-page note editor (`NoteEditorPage`) is note-type-agnostic:
 * it drives a title + PlateJS body + optional tags, and delegates ALL wire
 * concerns (which API to hit, how content is serialized, where tag options come
 * from) to a per-type adapter looked up from this registry.
 *
 * Adding a new note-bearing surface = add one entry here (+ its content mode),
 * with zero changes to the page component.
 *
 * Content modes:
 *   - `html-markdown` — the showroom editor (`OverviewNoteEditor`) authoring a
 *     `{ html, markdown }` pair; both are persisted (contentHtml/contentMarkdown).
 *   - `slate-json`    — the companies CRM editor round-tripping a JSON string of
 *     Slate nodes via the shared slateToJson/jsonToSlate helpers.
 *
 * Tag paths are hoisted into small consts so that if the API agent lands a
 * different literal distinct-tags route, it is a one-line fix here.
 */

import { jsonToSlate, slateToJson } from "@/components/companies/crm/shared";
import type { Descendant } from "slate";

// ─── Distinct-tags endpoints (single source of truth; one-line fix if renamed) ──

export const SHOWROOM_TAGS_URL = "/api/showroom-stores/notes/tags";
export const COMPANY_TAGS_URL = "/api/companies/notes/tags";

// ─── Shared wire helpers (cookie-auth, readable errors) ─────────────────────────

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

async function apiSend<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Normalize a distinct-tags response into a plain string[] (defensive). */
function normalizeTagList(payload: unknown): string[] {
  const tags = (payload as { tags?: unknown })?.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t): t is string => t.length > 0);
}

// ─── Editor value shapes ────────────────────────────────────────────────────────

/** The showroom editor's `{ html, markdown }` pair. */
export interface HtmlMarkdownValue {
  html: string;
  markdown: string;
}

/** The unified value a loaded note hands the page (before mode-specific auth). */
export interface LoadedNote {
  title: string;
  tags: string[];
  /** Present for `html-markdown` adapters. */
  htmlMarkdown?: HtmlMarkdownValue;
  /** Present for `slate-json` adapters. */
  slate?: Descendant[];
}

/** What the page hands back to the adapter to persist. */
export interface SavePayload {
  title: string;
  tags: string[];
  htmlMarkdown?: HtmlMarkdownValue;
  slate?: Descendant[];
}

export type ContentMode = "html-markdown" | "slate-json";
export type NoteType = "showroom" | "company";

export interface NoteAdapter {
  type: NoteType;
  /** Human label for the header context line ("Showroom note", "Company note"). */
  label: string;
  contentMode: ContentMode;
  tagsEnabled: boolean;
  /** Default return path when the caller supplies no (safe) `return` param. */
  defaultReturn: (entityId: string) => string;
  /** Load an existing note for edit. `noteId` is guaranteed present here. */
  load: (entityId: string, noteId: string) => Promise<LoadedNote>;
  /** Create a new note; resolves to the new note id when the API returns one. */
  create: (entityId: string, payload: SavePayload) => Promise<void>;
  /** Update an existing note in place. */
  update: (entityId: string, noteId: string, payload: SavePayload) => Promise<void>;
  /** Distinct tag options for the multi-select. */
  fetchTagOptions: () => Promise<string[]>;
}

// ─── Showroom adapter ({ html, markdown }) ──────────────────────────────────────

interface ShowroomNoteRow {
  id: number;
  title: string | null;
  contentHtml: string | null;
  contentMarkdown: string | null;
  tags?: string[];
}

const showroomAdapter: NoteAdapter = {
  type: "showroom",
  label: "Showroom note",
  contentMode: "html-markdown",
  tagsEnabled: true,
  defaultReturn: (entityId) => `/admin/shopping/store/${entityId}/notes`,

  async load(entityId, noteId) {
    // The showroom API has no single-note GET; read the list and pick the row.
    const data = await apiGet<{ notes: ShowroomNoteRow[] }>(
      `/api/showroom-stores/${entityId}/notes`,
    );
    const row = (data.notes ?? []).find((n) => String(n.id) === String(noteId));
    if (!row) throw new Error("Note not found");
    return {
      title: row.title ?? "",
      tags: Array.isArray(row.tags) ? row.tags : [],
      htmlMarkdown: {
        html: row.contentHtml ?? "",
        markdown: row.contentMarkdown ?? "",
      },
    };
  },

  async create(entityId, payload) {
    await apiSend(`/api/showroom-stores/${entityId}/notes`, "POST", {
      title: payload.title || null,
      contentHtml: payload.htmlMarkdown?.html ?? "",
      contentMarkdown: payload.htmlMarkdown?.markdown ?? "",
      tags: payload.tags,
    });
  },

  async update(_entityId, noteId, payload) {
    await apiSend(`/api/showroom-stores/notes/${noteId}`, "PUT", {
      title: payload.title || null,
      contentHtml: payload.htmlMarkdown?.html ?? "",
      contentMarkdown: payload.htmlMarkdown?.markdown ?? "",
      tags: payload.tags,
    });
  },

  async fetchTagOptions() {
    const payload = await apiGet<unknown>(SHOWROOM_TAGS_URL);
    return normalizeTagList(payload);
  },
};

// ─── Company adapter (Slate JSON) ───────────────────────────────────────────────

interface CompanyNoteRow {
  id: number;
  title: string;
  content: string;
  tags?: string[];
}

const companyAdapter: NoteAdapter = {
  type: "company",
  label: "Company note",
  contentMode: "slate-json",
  tagsEnabled: true,
  defaultReturn: (entityId) => `/admin/companies/${entityId}?tab=notes`,

  async load(entityId, noteId) {
    const data = await apiGet<{ note?: CompanyNoteRow }>(
      `/api/companies/${entityId}/notes/${noteId}`,
    );
    const note = data?.note;
    if (!note) throw new Error("Note not found in response");
    return {
      title: note.title ?? "",
      tags: Array.isArray(note.tags) ? note.tags : [],
      slate: jsonToSlate(note.content ?? null),
    };
  },

  async create(entityId, payload) {
    await apiSend(`/api/companies/${entityId}/notes`, "POST", {
      title: payload.title,
      content: slateToJson(payload.slate ?? []),
      tags: payload.tags,
    });
  },

  async update(entityId, noteId, payload) {
    await apiSend(`/api/companies/${entityId}/notes/${noteId}`, "PATCH", {
      title: payload.title,
      content: slateToJson(payload.slate ?? []),
      tags: payload.tags,
    });
  },

  async fetchTagOptions() {
    const payload = await apiGet<unknown>(COMPANY_TAGS_URL);
    return normalizeTagList(payload);
  },
};

// ─── Registry ───────────────────────────────────────────────────────────────────

const ADAPTERS: Record<NoteType, NoteAdapter> = {
  showroom: showroomAdapter,
  company: companyAdapter,
};

export function isNoteType(v: string | null | undefined): v is NoteType {
  return v === "showroom" || v === "company";
}

export function getAdapter(type: NoteType): NoteAdapter {
  return ADAPTERS[type];
}
