/**
 * @fileoverview ShowroomResearchPortalApp — the Phase 6 Deep Research portal.
 *
 * Built ON the existing sourcing console. Three zones:
 *   1. Launcher (typed job + engine selector) + a session list.
 *   2. The 3-tab portal for a selected research session:
 *        Tab A — Findings (markdown from R2 via /api/admin/research/:id/markdown)
 *        Tab B — Visualizer (R2 web app via LOADER sandbox iframe) + Mind map
 *                (mindmapcn / mind-elixir generated from the findings markdown)
 *        Tab C — Assistant-UI chat modal (ResearchPortalChat) — suggestions,
 *                generative UI, tools over D1 + Vectorize RAG.
 *   3. The well-lit-path sourcing triggers (existing SourcingResearchApp).
 *
 * Mirrors ResearchDetailApp's R2/visualizer/polling pattern. No mock data.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Monitor,
  Network,
  Radar,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { MarkdownProse } from "@/components/research/MarkdownProse";
import { ResearchJobLauncher } from "@/components/research/ResearchJobLauncher";
import { ResearchPortalChat } from "@/components/research/ResearchPortalChat";
import { markdownToMindmap } from "@/components/research/markdown-to-mindmap";
import { SourcingResearchApp } from "@/components/showroom/sourcing";

// mind-elixir touches the DOM on mount — load it lazily, client-only.
const MindMap = lazy(() =>
  import("@/components/research/MindMap").then((m) => ({ default: m.MindMap })),
);

interface ResearchSession {
  id: number;
  topic: string;
  status: string;
  r2MarkdownKey: string | null;
  r2WebappKey: string | null;
  chunkCount: number | null;
  createdAt: number | string;
  completedAt: number | string | null;
}

const IN_PROGRESS = ["pending", "planning", "awaiting_plan_approval", "researching", "embedding", "generating"];

export function ShowroomResearchPortalApp() {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/research", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sessions");
      const data = (await res.json()) as { sessions: ResearchSession[] };
      setSessions(data.sessions ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load research sessions");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8">
      <header className="mb-6 space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-violet-400">
          Deep research portal · Engine A
        </p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Deep Research</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Launch typed deep-research jobs, then explore each result as findings, an interactive
          visualizer + mind map, and a data-grounded assistant chat.
        </p>
      </header>

      {selected ? (
        <SessionPortal
          session={selected}
          onBack={() => setSelectedId(null)}
          onRefresh={fetchSessions}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <ResearchJobLauncher
              onLaunched={(id) => {
                void fetchSessions();
                setSelectedId(id);
              }}
            />

            {/* Well-lit-path sourcing triggers (existing console). */}
            <details className="rounded-xl bg-card/60 ring-1 ring-border/40">
              <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold text-foreground/90">
                <span className="inline-flex items-center gap-2">
                  <Radar className="size-4 text-emerald-400" />
                  Showroom &amp; product sourcing triggers
                </span>
              </summary>
              <Separator className="opacity-40" />
              <div className="p-1">
                <SourcingResearchApp />
              </div>
            </details>
          </div>

          <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start">
            <SessionList
              sessions={sessions}
              loading={loadingList}
              onSelect={setSelectedId}
              onRefresh={fetchSessions}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session list
// ---------------------------------------------------------------------------

function SessionList({
  sessions,
  loading,
  onSelect,
  onRefresh,
}: {
  sessions: ResearchSession[];
  loading: boolean;
  onSelect: (id: number) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-xl bg-card ring-1 ring-border/40">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold">Research sessions</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={onRefresh}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </div>
      <Separator className="opacity-40" />
      <div className="max-h-[60vh] divide-y divide-border/40 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No research yet. Launch one above.
          </p>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-muted/20"
            >
              <span className="line-clamp-2 text-sm font-medium text-foreground/90">{s.topic}</span>
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <SessionStatusDot status={s.status} />
                {s.status}
                <span className="ml-auto">{new Date(s.createdAt).toLocaleDateString()}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function SessionStatusDot({ status }: { status: string }) {
  const tone =
    status === "complete"
      ? "bg-emerald-400"
      : status === "failed"
        ? "bg-rose-400"
        : IN_PROGRESS.includes(status)
          ? "bg-amber-400"
          : "bg-zinc-500";
  return <span className={cn("size-1.5 rounded-full", tone)} />;
}

// ---------------------------------------------------------------------------
// Session portal — the 3-tab view for a selected session
// ---------------------------------------------------------------------------

function SessionPortal({
  session,
  onBack,
  onRefresh,
}: {
  session: ResearchSession;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const id = session.id;
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [mdLoading, setMdLoading] = useState(false);

  const fetchMarkdown = useCallback(async () => {
    setMdLoading(true);
    try {
      const res = await fetch(`/api/admin/research/${id}/markdown`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { markdown: string };
      setMarkdown(data.markdown);
    } catch {
      /* not ready yet */
    } finally {
      setMdLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (session.r2MarkdownKey) void fetchMarkdown();
  }, [session.r2MarkdownKey, fetchMarkdown]);

  // Poll while in-progress so the portal fills in as the agent finishes.
  useEffect(() => {
    if (!IN_PROGRESS.includes(session.status)) return;
    const t = setInterval(() => {
      void onRefresh();
      if (session.r2MarkdownKey && !markdown) void fetchMarkdown();
    }, 4000);
    return () => clearInterval(t);
  }, [session.status, session.r2MarkdownKey, markdown, onRefresh, fetchMarkdown]);

  const isComplete = session.status === "complete";
  const inProgress = IN_PROGRESS.includes(session.status);
  const isFailed = session.status === "failed";

  const mindmapData = useMemo(
    () => (markdown ? markdownToMindmap(markdown, session.topic) : null),
    [markdown, session.topic],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-border/40 pb-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 text-muted-foreground">
            <ArrowLeft className="mr-1 size-3.5" />
            All sessions
          </Button>
          <h2 className="text-xl font-semibold tracking-tight">Research portal</h2>
          <p className="mt-1 line-clamp-1 max-w-3xl text-sm text-muted-foreground" title={session.topic}>
            {session.topic}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {new Date(session.createdAt).toLocaleString()}
            </span>
            {isComplete && (
              <span className="flex items-center gap-1 text-emerald-400">
                <CheckCircle className="size-3" /> Complete
              </span>
            )}
          </div>
        </div>
      </div>

      {inProgress && (
        <Card className="bg-amber-950/20 ring-1 ring-amber-800/40">
          <CardContent className="flex items-center gap-3 py-4">
            <Loader2 className="size-5 animate-spin text-amber-400" />
            <p className="text-sm text-amber-300">
              Research in progress (status: {session.status}). This view auto-refreshes.
            </p>
          </CardContent>
        </Card>
      )}

      {isFailed && (
        <Card className="bg-rose-950/20 ring-1 ring-rose-800/40">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="size-5 text-rose-400" />
            <p className="text-sm text-rose-300">This research run failed.</p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="findings" className="flex min-h-0 flex-col">
        <TabsList className="mb-4 h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border/40 bg-transparent p-0">
          {[
            { v: "findings", icon: FileText, label: "Findings" },
            { v: "visualizer", icon: Monitor, label: "Visualizer + Mind map" },
          ].map((t) => (
            <TabsTrigger
              key={t.v}
              value={t.v}
              className="relative rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-muted-foreground shadow-none hover:text-foreground/80 data-[state=active]:border-emerald-500 data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              <t.icon className="mr-2 size-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Tab A — Findings */}
        <TabsContent value="findings" className="m-0">
          <Card className="ring-1 ring-border/40">
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="size-4 text-emerald-400" /> Findings
              </CardTitle>
              {markdown && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const blob = new Blob([markdown], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `research-${session.topic.slice(0, 30).replace(/\s+/g, "-")}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="size-3.5" />
                </Button>
              )}
            </CardHeader>
            <Separator className="opacity-40" />
            <CardContent className="max-h-[70vh] overflow-auto p-4">
              {mdLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : markdown ? (
                <MarkdownProse className="mx-auto max-w-3xl">{markdown}</MarkdownProse>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="size-8" />
                  <p className="mt-2 text-sm">Findings not available yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab B — Visualizer + Mind map */}
        <TabsContent value="visualizer" className="m-0 space-y-5">
          <Card className="flex min-h-[420px] flex-col ring-1 ring-border/40">
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Monitor className="size-4 text-emerald-400" /> Interactive visualizer
              </CardTitle>
              {session.r2WebappKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(`/api/admin/research/${id}/visualizer`, "_blank")}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              )}
            </CardHeader>
            <Separator className="opacity-40" />
            <CardContent className="relative flex-1 p-0">
              {session.r2WebappKey ? (
                <iframe
                  src={`/api/admin/research/${id}/visualizer`}
                  className="h-[480px] w-full rounded-b-xl border-0"
                  sandbox="allow-scripts allow-same-origin"
                  title="Research visualizer"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Monitor className="size-8" />
                  <p className="mt-2 text-sm">Visualizer not yet generated</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-[460px] flex-col ring-1 ring-border/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Network className="size-4 text-emerald-400" /> Mind map
              </CardTitle>
            </CardHeader>
            <Separator className="opacity-40" />
            <CardContent className="relative flex-1 p-0">
              {mindmapData ? (
                <div className="h-[460px] w-full overflow-hidden rounded-b-xl">
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="size-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                  >
                    <MindMap data={mindmapData} />
                  </Suspense>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Network className="size-8" />
                  <p className="mt-2 text-sm">Mind map builds once findings are ready</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Tab C — assistant-ui chat modal (always mounted; floating trigger). */}
      {isComplete && <ResearchPortalChat sessionId={id} topic={session.topic} />}
    </div>
  );
}
