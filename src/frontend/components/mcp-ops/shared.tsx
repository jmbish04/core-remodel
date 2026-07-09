/**
 * @fileoverview 0017 — MCP Ops shared kernel.
 *
 * Home for the row/detail TYPES, the timestamp / JSON / status helpers, and the
 * reusable presentational atoms (PanelLoading / EmptyState / ErrorState /
 * SortButton) that every MCP-Ops tab leans on.
 *
 * This file is deliberately dependency-light and side-effect-free: it exports
 * plain functions and stateless components so the individual tab modules can
 * import exactly what they need without dragging in sibling tabs. Nothing here
 * fetches — the tab modules own their own data lifecycles.
 *
 * Monolith rules apply to the atoms below: dark theme, no 1px borders (ring /
 * divide / bg-card only), theme tokens only, mobile-responsive.
 */

import type { ComponentType } from "react";
import { AlertCircle, ArrowUpDown, Loader2, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/** Base URL for linking an issue/feature to its GitHub pull request. */
export const REPO_PR_BASE = "https://github.com/jmbish04/core-remodel/pull/";

/* ------------------------------------------------------------------ types */

export type Overview = {
  sessions: number;
  toolCalls: number;
  errors: number;
  openBugs: number;
  openFeatures: number;
  conversations: number;
};

export type SessionRow = {
  id: string;
  transport: string | null;
  principal: string | null;
  toolCallCount: number;
  firstSeenAt: string | number | null;
  lastSeenAt: string | number | null;
};

export type Invocation = {
  id: string;
  sessionId: string;
  toolName: string;
  argsJson: string | null;
  ok: boolean | number | null;
  resultJson: string | null;
  errorText: string | null;
  durationMs: number | null;
  createdAt: string | number | null;
};

export type ConversationRow = {
  id: string;
  sessionId: string | null;
  title: string | null;
  summary: string | null;
  format: string | null;
  messageCount: number | null;
  createdAt: string | number | null;
  updatedAt: string | number | null;
};

export type ConversationDetail = ConversationRow & {
  content: string | null;
};

export type IssueRow = {
  id: string;
  toolName: string | null;
  summary: string | null;
  details: string | null;
  severity: string | null;
  reproSteps: string | null;
  status: string | null;
  fixedByPr: number | string | null;
  createdAt: string | number | null;
  updatedAt: string | number | null;
};

export type FeatureRow = {
  id: string;
  title: string | null;
  description: string | null;
  useCase: string | null;
  status: string | null;
  planRef: string | null;
  prNumber: number | string | null;
  createdAt: string | number | null;
  updatedAt: string | number | null;
};

export type IssueStatus = "open" | "in_progress" | "fixed" | "wontfix" | "all";
export type FeatureStatus =
  | "requested"
  | "planned"
  | "building"
  | "shipped"
  | "declined"
  | "all";

/* -------------------------------------------------------------- utilities */

/**
 * Coerce a timestamp that may arrive as unix SECONDS (number), an ISO string,
 * or null into a formatted local string. Guards invalid dates so the table
 * never renders "Invalid Date".
 */
export function fmtDate(t: string | number | null | undefined): string {
  if (t === null || t === undefined || t === "") return "—";
  const d = new Date(typeof t === "number" ? t * 1000 : t);
  if (Number.isNaN(d.getTime())) {
    // Numeric-looking string? Try seconds.
    const asNum = Number(t);
    if (Number.isFinite(asNum) && asNum > 0) {
      const d2 = new Date(asNum * 1000);
      if (!Number.isNaN(d2.getTime())) return d2.toLocaleString();
    }
    return "—";
  }
  return d.toLocaleString();
}

/** Normalize a timestamp to a millisecond epoch for sorting (0 when invalid). */
export function toEpoch(t: string | number | null | undefined): number {
  if (t === null || t === undefined || t === "") return 0;
  const d = new Date(typeof t === "number" ? t * 1000 : t);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  const asNum = Number(t);
  if (Number.isFinite(asNum) && asNum > 0) return asNum * 1000;
  return 0;
}

/** Pretty-print a JSON string; fall through to the raw text if unparseable. */
export function prettyJson(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Truthy across the boolean/number/null shapes the ok flag may take. */
export function isOk(ok: boolean | number | null | undefined): boolean {
  return ok === true || ok === 1;
}

export type Variant = "default" | "secondary" | "destructive" | "outline";

/** Map a severity to a badge variant (Monolith palette via tokens). */
export function severityVariant(sev: string | null | undefined): Variant {
  switch ((sev ?? "").toLowerCase()) {
    case "critical":
    case "high":
      return "destructive";
    case "medium":
      return "secondary";
    default:
      return "outline";
  }
}

/** Map an issue/feature status to a badge variant. */
export function statusVariant(status: string | null | undefined): Variant {
  switch ((status ?? "").toLowerCase()) {
    case "open":
    case "requested":
      return "secondary";
    case "in_progress":
    case "planned":
    case "building":
      return "default";
    case "fixed":
    case "shipped":
      return "outline";
    case "wontfix":
    case "declined":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Shared fetch helper. Sends credentials, distinguishes 401 (admin sign-in)
 * from other failures, and returns the parsed JSON body.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (res.status === 401) {
    const err = new Error("unauthorized");
    (err as Error & { code?: string }).code = "unauthorized";
    throw err;
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

/* -------------------------------------------------- shared UI sub-elements */

/** Full-panel centered spinner. */
export function PanelLoading() {
  return (
    <div className="flex h-56 items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Empty-state block for a tab or list. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-xl bg-card px-6 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/60" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Destructive alert, distinguishing 401 from generic errors. */
export function ErrorState({ message }: { message: string }) {
  const isAuth = message === "unauthorized";
  return (
    <Alert variant="destructive">
      {isAuth ? (
        <ShieldAlert className="h-4 w-4" />
      ) : (
        <AlertCircle className="h-4 w-4" />
      )}
      <AlertTitle>
        {isAuth ? "Admin sign-in required" : "Something went wrong"}
      </AlertTitle>
      <AlertDescription>
        {isAuth
          ? "This view is admin-gated. Sign in to the admin portal to load MCP operations data."
          : message}
      </AlertDescription>
    </Alert>
  );
}

/** A sortable table-header button. */
export function SortButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}
