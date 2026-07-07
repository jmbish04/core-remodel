/**
 * @fileoverview Shared types + fetch helpers for the research console.
 *
 * The research console is a live view over the `/api/research-jobs` surface:
 *   - a LANDING list of ongoing + prior jobs (polled while any is in-flight),
 *   - an INITIATE dialog (template picker → POST a new job),
 *   - a per-job VIEWPORT that streams plan → steps → report → sources → an
 *     optional discovery-candidate intake table.
 *
 * These types mirror the backend contract exactly; the backend is built in
 * parallel, so we trust the shapes documented here rather than reading routes.
 */

// ─── Job kinds ──────────────────────────────────────────────────────────────────

/**
 * The seven research kinds. The first three are *targeted* (research an existing
 * entity); the next three are *discovery* (find new entities matching criteria);
 * `custom` is a free-prompt research run.
 */
export type ResearchKind =
  | "showroom"
  | "brand"
  | "product"
  | "discovery_showrooms"
  | "discovery_brands"
  | "discovery_products"
  | "custom";

/** Job lifecycle status. `pending`/`running` are non-terminal (keep polling). */
export type JobStatus = "pending" | "running" | "complete" | "failed";

/** Per-step lifecycle status. `skipped` is terminal-but-benign. */
export type StepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

/** The entity a targeted job is bound to (for the deep-link back to its viewport). */
export type EntityType = "showroom" | "brand" | "product" | null;

// ─── List row ───────────────────────────────────────────────────────────────────

/** A job as it appears in the LANDING list (GET /api/research-jobs). */
export interface JobListRow {
  id: number;
  kind: ResearchKind;
  title: string;
  status: JobStatus;
  /** 0–100. Present for pending/running; usually 100 on complete. */
  progress: number;
  /** Human narration of the active step (e.g. "Reading store hours…"). */
  currentStep: string | null;
  entityType: EntityType;
  entityId: number | null;
  entityName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

// ─── Viewport detail ────────────────────────────────────────────────────────────

/** One reference source cited across the report (job.sources map value). */
export interface JobSource {
  shortId: string;
  title: string;
  url: string;
  domain: string;
  supportedClaims: { textSegment: string; confidence: number }[];
}

/** A single research step (GET /api/research-jobs/:id → steps[]). */
export interface JobStep {
  id: number;
  stepKey: string;
  label: string;
  status: StepStatus;
  detail: string | null;
  /** Arbitrary artifact — string prose, a structured object, or a candidate list. */
  artifact: unknown;
  sortOrder: number;
  startedAt: string | null;
  completedAt: string | null;
}

/** A discovery candidate (job.result.candidates[]). */
export interface DiscoveryCandidate {
  name: string;
  websiteUrl: string | null;
  address: string | null;
  category: string | null;
  pricePoint: string | null;
  summary: string | null;
  /** Intake lifecycle: new (addable) / existing (already registered) / registered (just added) / failed. */
  intakeStatus: "new" | "existing" | "registered" | "failed";
  /** For "existing" — the entity already in the system it matched. */
  matchedEntityId: number | null;
  matchedEntityName: string | null;
  /** For "registered" — the entity we just created via intake. */
  intakeEntityId: number | null;
}

/** The full job detail (GET /api/research-jobs/:id → job). */
export interface JobDetail extends JobListRow {
  topic: string | null;
  criteria: string | null;
  plan: string | null;
  outline: string | null;
  report: string | null;
  sources: Record<string, JobSource> | null;
  result: { candidates?: DiscoveryCandidate[] } | null;
}

/** GET /api/research-jobs/:id response envelope. */
export interface JobDetailResponse {
  job: JobDetail;
  steps: JobStep[];
}

// ─── Kind metadata (labels, icons handled at the render site) ────────────────────

/** Short badge label per kind. */
export const KIND_LABEL: Record<ResearchKind, string> = {
  showroom: "Showroom",
  brand: "Brand",
  product: "Product",
  discovery_showrooms: "Discover showrooms",
  discovery_brands: "Discover brands",
  discovery_products: "Discover products",
  custom: "Custom",
};

/** The three discovery kinds surface a candidate-intake table. */
export const DISCOVERY_KINDS: ResearchKind[] = [
  "discovery_showrooms",
  "discovery_brands",
  "discovery_products",
];

export function isDiscoveryKind(kind: ResearchKind): boolean {
  return DISCOVERY_KINDS.includes(kind);
}

/** Non-terminal statuses — keep polling while a job sits in one of these. */
export function isActiveStatus(status: JobStatus): boolean {
  return status === "pending" || status === "running";
}

/**
 * Deep-link to a targeted job's entity viewport, or `null` when the job isn't
 * entity-bound (discovery/custom, or entity not yet linked).
 */
export function entityHref(row: {
  entityType: EntityType;
  entityId: number | null;
}): string | null {
  if (row.entityId == null || !row.entityType) return null;
  switch (row.entityType) {
    case "showroom":
      return `/admin/shopping/store/${row.entityId}`;
    case "brand":
      return `/admin/shopping/brands/${row.entityId}`;
    case "product":
      return `/admin/shopping/product/${row.entityId}`;
    default:
      return null;
  }
}

// ─── Fetch helpers (duplicated per-feature by design; mirrors the repo idiom) ────

/** GET JSON with credentials, throwing a useful error on non-2xx. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** POST JSON with credentials, throwing a useful error on non-2xx. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ─── Time formatting ────────────────────────────────────────────────────────────

/** Format an ISO/epoch timestamp as a locale date-time, or "—" when absent. */
export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Human "elapsed" between two timestamps (or from `from` to now when `to` is
 * absent). Returns compact forms like "4s", "3m 12s", "1h 5m".
 */
export function formatElapsed(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  if (!from) return "—";
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return remSecs ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hrs}h ${remMins}m` : `${hrs}h`;
}
