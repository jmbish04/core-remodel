/**
 * @fileoverview 0017 — MCP Ops observability island.
 *
 * A tabbed operator console for the MCP server. Fetches everything from the
 * admin-gated, same-origin `/api/mcp-ops/*` JSON endpoints (credentials sent so
 * the session cookie rides along). Nothing here is mocked — every value comes
 * from the API, and every fetch handles loading / empty / error / 401 states.
 *
 * Layout:
 *   - KPI cards (overview) above the tabs.
 *   - Tab 1 "Sessions": session list -> click loads a transcript of tool
 *     invocations (expandable args/result JSON).
 *   - Tab 2 "Conversations": conversation list -> click loads the full row and
 *     renders its markdown/json content in a scroll area.
 *   - Tab 3 "Bugs": filterable + sortable issue table with severity/status
 *     badges and a fixed-by-PR link.
 *   - Tab 4 "Features": filterable + sortable feature-request table with a
 *     PR link.
 *
 * Monolith rules: dark theme, no 1px borders (ring/divide/bg-card only), no
 * window.confirm/alert, theme tokens only, mobile-responsive.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpDown,
  Bug,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Terminal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MarkdownProse } from "@/components/research/MarkdownProse";
import { cn } from "@/lib/utils";

const REPO_PR_BASE = "https://github.com/jmbish04/core-remodel/pull/";

/* ------------------------------------------------------------------ types */

type Overview = {
  sessions: number;
  toolCalls: number;
  errors: number;
  openBugs: number;
  openFeatures: number;
  conversations: number;
};

type SessionRow = {
  id: string;
  transport: string | null;
  principal: string | null;
  toolCallCount: number;
  firstSeenAt: string | number | null;
  lastSeenAt: string | number | null;
};

type Invocation = {
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

type ConversationRow = {
  id: string;
  sessionId: string | null;
  title: string | null;
  summary: string | null;
  format: string | null;
  messageCount: number | null;
  createdAt: string | number | null;
  updatedAt: string | number | null;
};

type ConversationDetail = ConversationRow & {
  content: string | null;
};

type IssueRow = {
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

type FeatureRow = {
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

type IssueStatus = "open" | "in_progress" | "fixed" | "wontfix" | "all";
type FeatureStatus =
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
function fmtDate(t: string | number | null | undefined): string {
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
function toEpoch(t: string | number | null | undefined): number {
  if (t === null || t === undefined || t === "") return 0;
  const d = new Date(typeof t === "number" ? t * 1000 : t);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  const asNum = Number(t);
  if (Number.isFinite(asNum) && asNum > 0) return asNum * 1000;
  return 0;
}

/** Pretty-print a JSON string; fall through to the raw text if unparseable. */
function prettyJson(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Truthy across the boolean/number/null shapes the ok flag may take. */
function isOk(ok: boolean | number | null | undefined): boolean {
  return ok === true || ok === 1;
}

type Variant = "default" | "secondary" | "destructive" | "outline";

/** Map a severity to a badge variant (Monolith palette via tokens). */
function severityVariant(sev: string | null | undefined): Variant {
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
function statusVariant(status: string | null | undefined): Variant {
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
async function apiGet<T>(path: string): Promise<T> {
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
function PanelLoading() {
  return (
    <div className="flex h-56 items-center justify-center">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Empty-state block for a tab or list. */
function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
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
function ErrorState({ message }: { message: string }) {
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
function SortButton({
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

/* ============================================================ OVERVIEW KPIs */

function OverviewCards() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<Overview>("/api/mcp-ops/overview"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kpis: { label: string; value: number | undefined }[] = [
    { label: "Sessions", value: data?.sessions },
    { label: "Tool calls", value: data?.toolCalls },
    { label: "Errors", value: data?.errors },
    { label: "Open bugs", value: data?.openBugs },
    { label: "Open features", value: data?.openFeatures },
    { label: "Conversations", value: data?.conversations },
  ];

  if (error) {
    return (
      <div className="mb-6">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {kpis.map((k) => (
        <Card key={k.label} className="gap-1 py-4">
          <CardHeader className="px-4">
            <CardDescription className="text-xs">{k.label}</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {(k.value ?? 0).toLocaleString()}
              </span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ============================================================ SESSIONS TAB */

function SessionsTab() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ count: number; sessions: SessionRow[] }>(
        "/api/mcp-ops/sessions",
      );
      setRows(data.sessions ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PanelLoading />;
  if (error) return <ErrorState message={error} />;
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={Terminal}
        title="No MCP sessions yet"
        hint="Sessions appear here once a client connects to the MCP server and issues tool calls."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* Session list */}
      <Card className="overflow-hidden py-0">
        <ScrollArea className="h-[28rem]">
          <div className="divide-y divide-border/40">
            {rows.map((s) => {
              const active = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                    active ? "bg-muted/60" : "hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-foreground">
                      {s.principal ?? s.id}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {s.toolCallCount} calls
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {s.transport ? (
                      <Badge variant="secondary" className="px-1.5 py-0">
                        {s.transport}
                      </Badge>
                    ) : null}
                    <span className="truncate">{fmtDate(s.lastSeenAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </Card>

      {/* Transcript */}
      <div>
        {selectedId ? (
          <TranscriptPanel sessionId={selectedId} />
        ) : (
          <EmptyState
            icon={Terminal}
            title="Select a session"
            hint="Pick a session on the left to view its tool-call transcript."
          />
        )}
      </div>
    </div>
  );
}

function TranscriptPanel({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [invocations, setInvocations] = useState<Invocation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await apiGet<{
          session: SessionRow;
          invocations: Invocation[];
        }>(`/api/mcp-ops/sessions/${encodeURIComponent(sessionId)}`);
        if (cancelled) return;
        setSession(data.session);
        setInvocations(data.invocations ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) return <PanelLoading />;
  if (error) return <ErrorState message={error} />;

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="gap-1 bg-muted/30 px-4 py-3">
        <CardTitle className="font-mono text-sm">
          {session?.principal ?? session?.id ?? sessionId}
        </CardTitle>
        <CardDescription className="text-xs">
          {session?.transport ? `${session.transport} · ` : ""}
          {invocations?.length ?? 0} invocations ·{" "}
          {fmtDate(session?.firstSeenAt)} → {fmtDate(session?.lastSeenAt)}
        </CardDescription>
      </CardHeader>
      <ScrollArea className="h-[24rem]">
        {invocations && invocations.length > 0 ? (
          <div className="divide-y divide-border/40">
            {invocations.map((inv) => (
              <InvocationRow key={inv.id} inv={inv} />
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No tool invocations recorded for this session.
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}

function InvocationRow({ inv }: { inv: Invocation }) {
  const [open, setOpen] = useState(false);
  const ok = isOk(inv.ok);
  const args = prettyJson(inv.argsJson);
  const result = prettyJson(inv.resultJson);
  const hasDetail = Boolean(args || result || inv.errorText);

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {hasDetail ? (
          open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="font-mono text-sm text-foreground">{inv.toolName}</span>
        <Badge variant={ok ? "outline" : "destructive"} className="shrink-0">
          {ok ? "ok" : "error"}
        </Badge>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {inv.durationMs != null ? `${inv.durationMs} ms` : ""}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {fmtDate(inv.createdAt)}
        </span>
      </button>

      {open && hasDetail ? (
        <div className="mt-3 space-y-3 pl-6">
          {inv.errorText ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">
                Error
              </p>
              <pre className="overflow-x-auto rounded-lg bg-destructive/10 p-3 font-mono text-xs text-destructive">
                {inv.errorText}
              </pre>
            </div>
          ) : null}
          {args ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Arguments
              </p>
              <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground/90 ring-1 ring-border/40">
                {args}
              </pre>
            </div>
          ) : null}
          {result ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Result
              </p>
              <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground/90 ring-1 ring-border/40">
                {result}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ======================================================= CONVERSATIONS TAB */

function ConversationsTab() {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ conversations: ConversationRow[] }>(
        "/api/mcp-ops/conversations",
      );
      setRows(data.conversations ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PanelLoading />;
  if (error) return <ErrorState message={error} />;
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No saved conversations"
        hint="Conversations captured by the MCP server will appear here."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="overflow-hidden py-0">
        <ScrollArea className="h-[28rem]">
          <div className="divide-y divide-border/40">
            {rows.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                    active ? "bg-muted/60" : "hover:bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {c.title ?? "Untitled conversation"}
                    </span>
                    {c.format ? (
                      <Badge variant="secondary" className="shrink-0 px-1.5 py-0">
                        {c.format}
                      </Badge>
                    ) : null}
                  </div>
                  {c.summary ? (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {c.summary}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {c.messageCount != null ? `${c.messageCount} messages · ` : ""}
                    {fmtDate(c.updatedAt ?? c.createdAt)}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </Card>

      <div>
        {selectedId ? (
          <ConversationPanel conversationId={selectedId} />
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="Select a conversation"
            hint="Pick a conversation on the left to read its full content."
          />
        )}
      </div>
    </div>
  );
}

function ConversationPanel({ conversationId }: { conversationId: string }) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await apiGet<ConversationDetail>(
          `/api/mcp-ops/conversations/${encodeURIComponent(conversationId)}`,
        );
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (loading) return <PanelLoading />;
  if (error) return <ErrorState message={error} />;
  if (!detail) return null;

  const isJson = (detail.format ?? "").toLowerCase() === "json";
  const content = detail.content ?? "";

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="gap-1 bg-muted/30 px-4 py-3">
        <CardTitle className="text-sm">
          {detail.title ?? "Untitled conversation"}
        </CardTitle>
        <CardDescription className="text-xs">
          {detail.messageCount != null ? `${detail.messageCount} messages · ` : ""}
          {fmtDate(detail.updatedAt ?? detail.createdAt)}
        </CardDescription>
      </CardHeader>
      <ScrollArea className="h-[26rem]">
        <div className="px-4 py-4">
          {content === "" ? (
            <p className="text-sm text-muted-foreground">
              This conversation has no content.
            </p>
          ) : isJson ? (
            <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground/90 ring-1 ring-border/40">
              {prettyJson(content)}
            </pre>
          ) : (
            <MarkdownProse>{content}</MarkdownProse>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}

/* ============================================================== BUGS TAB */

type IssueSortKey = "createdAt" | "updatedAt" | "severity" | "status";

function BugsTab() {
  const [status, setStatus] = useState<IssueStatus>("open");
  const [rows, setRows] = useState<IssueRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<IssueSortKey>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);

  const load = useCallback(async (s: IssueStatus) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ issues: IssueRow[] }>(
        `/api/mcp-ops/issues?status=${encodeURIComponent(s)}`,
      );
      setRows(data.issues ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(status);
  }, [load, status]);

  const toggleSort = (key: IssueSortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sorted = useMemo(() => {
    if (!rows) return [];
    const sevRank: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "severity") {
        cmp =
          (sevRank[(a.severity ?? "").toLowerCase()] ?? 0) -
          (sevRank[(b.severity ?? "").toLowerCase()] ?? 0);
      } else if (sortKey === "status") {
        cmp = (a.status ?? "").localeCompare(b.status ?? "");
      } else {
        cmp = toEpoch(a[sortKey]) - toEpoch(b[sortKey]);
      }
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status</span>
          <Select
            value={status}
            onValueChange={(v) => setStatus((v ?? "open") as IssueStatus)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="fixed">Fixed</SelectItem>
              <SelectItem value="wontfix">Won't fix</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(status)}
          disabled={loading}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <PanelLoading />
      ) : error ? (
        <ErrorState message={error} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Bug}
          title="No bug reports"
          hint="Bug reports filed via MCP tools will appear here."
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-2.5 text-left">
                    <SortButton
                      label="Severity"
                      active={sortKey === "severity"}
                      onClick={() => toggleSort("severity")}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Summary
                  </th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground md:table-cell">
                    Tool
                  </th>
                  <th className="px-4 py-2.5 text-left">
                    <SortButton
                      label="Status"
                      active={sortKey === "status"}
                      onClick={() => toggleSort("status")}
                    />
                  </th>
                  <th className="hidden px-4 py-2.5 text-left md:table-cell">
                    <SortButton
                      label="Created"
                      active={sortKey === "createdAt"}
                      onClick={() => toggleSort("createdAt")}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fix
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sorted.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="px-4 py-3">
                      <Badge variant={severityVariant(i.severity)}>
                        {i.severity ?? "—"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {i.summary ?? "—"}
                      </p>
                      {i.details ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {i.details}
                        </p>
                      ) : null}
                      {i.reproSteps ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">
                          Repro: {i.reproSteps}
                        </p>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span className="font-mono text-xs text-muted-foreground">
                        {i.toolName ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(i.status)}>
                        {i.status ?? "—"}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
                      {fmtDate(i.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {i.fixedByPr != null && i.fixedByPr !== "" ? (
                        <a
                          href={`${REPO_PR_BASE}${i.fixedByPr}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:underline"
                        >
                          PR #{i.fixedByPr}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ============================================================ FEATURES TAB */

type FeatureSortKey = "createdAt" | "updatedAt" | "status" | "title";

function FeaturesTab() {
  const [status, setStatus] = useState<FeatureStatus>("requested");
  const [rows, setRows] = useState<FeatureRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<FeatureSortKey>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);

  const load = useCallback(async (s: FeatureStatus) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ features: FeatureRow[] }>(
        `/api/mcp-ops/features?status=${encodeURIComponent(s)}`,
      );
      setRows(data.features ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(status);
  }, [load, status]);

  const toggleSort = (key: FeatureSortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sorted = useMemo(() => {
    if (!rows) return [];
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "status") cmp = (a.status ?? "").localeCompare(b.status ?? "");
      else if (sortKey === "title") cmp = (a.title ?? "").localeCompare(b.title ?? "");
      else cmp = toEpoch(a[sortKey]) - toEpoch(b[sortKey]);
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status</span>
          <Select
            value={status}
            onValueChange={(v) => setStatus((v ?? "requested") as FeatureStatus)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="requested">Requested</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="building">Building</SelectItem>
              <SelectItem value="shipped">Shipped</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(status)}
          disabled={loading}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <PanelLoading />
      ) : error ? (
        <ErrorState message={error} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No feature requests"
          hint="Feature requests filed via MCP tools will appear here."
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-2.5 text-left">
                    <SortButton
                      label="Title"
                      active={sortKey === "title"}
                      onClick={() => toggleSort("title")}
                    />
                  </th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:table-cell">
                    Use case
                  </th>
                  <th className="px-4 py-2.5 text-left">
                    <SortButton
                      label="Status"
                      active={sortKey === "status"}
                      onClick={() => toggleSort("status")}
                    />
                  </th>
                  <th className="hidden px-4 py-2.5 text-left md:table-cell">
                    <SortButton
                      label="Created"
                      active={sortKey === "createdAt"}
                      onClick={() => toggleSort("createdAt")}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    PR
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sorted.map((f) => (
                  <tr key={f.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {f.title ?? "—"}
                      </p>
                      {f.description ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {f.description}
                        </p>
                      ) : null}
                      {f.planRef ? (
                        <p className="mt-0.5 text-xs text-muted-foreground/80">
                          Plan: {f.planRef}
                        </p>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell">
                      <span className="line-clamp-3">{f.useCase ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant(f.status)}>
                        {f.status ?? "—"}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell">
                      {fmtDate(f.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {f.prNumber != null && f.prNumber !== "" ? (
                        <a
                          href={`${REPO_PR_BASE}${f.prNumber}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:underline"
                        >
                          PR #{f.prNumber}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ================================================================== ROOT */

export function McpOpsApp() {
  return (
    <div className="space-y-2">
      <OverviewCards />

      <Tabs defaultValue="sessions">
        <TabsList className="flex-wrap">
          <TabsTrigger value="sessions">
            <Terminal className="h-4 w-4" />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="conversations">
            <MessageSquare className="h-4 w-4" />
            Conversations
          </TabsTrigger>
          <TabsTrigger value="bugs">
            <Bug className="h-4 w-4" />
            Bugs
          </TabsTrigger>
          <TabsTrigger value="features">
            <Lightbulb className="h-4 w-4" />
            Features
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="mt-4">
          <SessionsTab />
        </TabsContent>
        <TabsContent value="conversations" className="mt-4">
          <ConversationsTab />
        </TabsContent>
        <TabsContent value="bugs" className="mt-4">
          <BugsTab />
        </TabsContent>
        <TabsContent value="features" className="mt-4">
          <FeaturesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
