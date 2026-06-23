import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  FileText,
  Monitor,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Database,
  Sparkles,
  Send,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { MarkdownProse } from "@/components/research/MarkdownProse";
import { ResearchChatModal } from "@/components/research/ResearchChatModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanAnnotation {
  kind: "scope" | "gap" | "redundancy" | "constraint" | "risk";
  note: string;
}

interface ResearchSession {
  id: number;
  topic: string;
  status: string;
  r2MarkdownKey: string | null;
  r2WebappKey: string | null;
  vectorNamespace: string | null;
  errorMessage: string | null;
  chunkCount: number | null;
  createdAt: number | string;
  completedAt: number | string | null;
  /** Plan-review fields (HITL gate). */
  researchPlan?: string | null;
  planStatus?: string | null;
  planAnnotations?: string | null;
  planRevision?: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResearchDetailApp({ sessionId }: { sessionId?: string }) {
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [markdownLoading, setMarkdownLoading] = useState(false);

  const id = sessionId ? parseInt(sessionId, 10) : NaN;

  // Fetch session detail
  const fetchSession = useCallback(async () => {
    if (isNaN(id)) return;
    try {
      const res = await fetch(`/api/admin/research/${id}`);
      if (!res.ok) throw new Error("Failed to fetch session");
      const data = (await res.json()) as any;
      setSession(data.session);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load research session");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Fetch markdown content
  const fetchMarkdown = useCallback(async () => {
    if (isNaN(id)) return;
    setMarkdownLoading(true);
    try {
      const res = await fetch(`/api/admin/research/${id}/markdown`);
      if (!res.ok) return;
      const data = (await res.json()) as any;
      setMarkdown(data.markdown);
    } catch {
      // Markdown may not be available yet
    } finally {
      setMarkdownLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Fetch markdown when session is available
  useEffect(() => {
    if (session?.r2MarkdownKey) {
      fetchMarkdown();
    }
  }, [session?.r2MarkdownKey, fetchMarkdown]);

  // Poll while in-progress
  useEffect(() => {
    if (
      !session ||
      !["pending", "planning", "awaiting_plan_approval", "researching", "embedding", "generating"].includes(
        session.status,
      )
    )
      return;

    const interval = setInterval(async () => {
      await fetchSession();
      if (session?.r2MarkdownKey && !markdown) {
        await fetchMarkdown();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [session, markdown, fetchSession, fetchMarkdown]);

  if (isNaN(id)) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-zinc-400">
        Invalid session ID
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4 text-zinc-400">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
        <p className="text-sm font-medium">Loading research...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4 text-zinc-400">
        <AlertCircle className="h-10 w-10 text-red-500" />
        <p className="text-sm font-medium">Session not found</p>
        <Button variant="outline" size="sm" onClick={() => history.back()}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Go Back
        </Button>
      </div>
    );
  }

  const isComplete = session.status === "complete";
  const isAwaitingPlan = session.status === "awaiting_plan_approval";
  const isInProgress = ["pending", "planning", "researching", "embedding", "generating"].includes(session.status);
  const isFailed = session.status === "failed";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                window.location.href = "/admin/research";
              }}
              className="text-zinc-500"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Library
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <StatusBadge status={session.status} />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-500">
            Deep research
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Deep Research Report
          </h1>
          <p className="mt-1 line-clamp-1 max-w-3xl text-sm text-muted-foreground" title={session.topic}>
            {session.topic}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(session.createdAt).toLocaleString()}
            </span>
            {session.chunkCount != null && session.chunkCount > 0 && (
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                {session.chunkCount} chunks embedded
              </span>
            )}
            {session.completedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-emerald-500" />
                Completed{" "}
                {new Date(session.completedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* In-progress status */}
      {isInProgress && (
        <Card className="ring-1 ring-amber-800/40 bg-amber-950/20">
          <CardContent className="flex items-center gap-3 py-4">
            <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-300">
                Research in progress...
              </p>
              <p className="text-xs text-amber-500/80">
                Status: {session.status}. This page will auto-refresh.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan-review gate */}
      {isAwaitingPlan && (
        <PlanReviewPanel
          sessionId={session.id}
          planMarkdown={session.researchPlan ?? ""}
          annotations={parseAnnotations(session.planAnnotations)}
          revision={session.planRevision ?? 0}
          onChanged={fetchSession}
        />
      )}

      {/* Failed status */}
      {isFailed && session.errorMessage && (
        <Card className="ring-1 ring-red-800/40 bg-red-950/20">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-300">
                Research failed
              </p>
              <p className="text-xs text-red-500/80">
                {session.errorMessage}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document + interactive web app (full width). Chat is the floating modal below. */}
      {(isComplete || markdown) && (
        <div className="flex flex-col lg:h-[calc(100vh-240px)] lg:min-h-[600px]">
          <Tabs defaultValue="document" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mb-4 h-auto w-full shrink-0 justify-start overflow-x-auto rounded-none border-b border-zinc-800 bg-transparent p-0">
              <TabsTrigger
                value="document"
                className="relative rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-zinc-400 shadow-none hover:text-zinc-200 data-[state=active]:border-emerald-500 data-[state=active]:text-zinc-100 data-[state=active]:shadow-none"
              >
                <FileText className="mr-2 h-4 w-4" />
                Research Document
              </TabsTrigger>
              <TabsTrigger
                value="visualizer"
                className="relative rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-zinc-400 shadow-none hover:text-zinc-200 data-[state=active]:border-emerald-500 data-[state=active]:text-zinc-100 data-[state=active]:shadow-none"
              >
                <Monitor className="mr-2 h-4 w-4" />
                Interactive Web App
              </TabsTrigger>
            </TabsList>

            <TabsContent value="document" className="m-0 flex min-h-[500px] flex-col lg:min-h-0 lg:flex-1 data-[state=active]:flex">
              <DocumentPanel
                markdown={markdown}
                loading={markdownLoading}
                topic={session.topic}
              />
            </TabsContent>

            <TabsContent value="visualizer" className="m-0 flex min-h-[500px] flex-col lg:min-h-0 lg:flex-1 data-[state=active]:flex">
              <VisualizerPanel sessionId={id} hasVisualizer={!!session.r2WebappKey} />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Strict assistant-ui floating chat modal — available once findings exist */}
      {isComplete && <ResearchChatModal sessionId={id} topic={session.topic} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
    pending: { label: "Pending", variant: "secondary", icon: Clock },
    planning: { label: "Planning", variant: "default", icon: Loader2 },
    awaiting_plan_approval: { label: "Plan review", variant: "secondary", icon: FileText },
    researching: { label: "Researching", variant: "default", icon: Sparkles },
    embedding: { label: "Embedding", variant: "default", icon: Database },
    generating: { label: "Generating", variant: "default", icon: Loader2 },
    complete: { label: "Complete", variant: "outline", icon: CheckCircle },
    failed: { label: "Failed", variant: "destructive", icon: AlertCircle },
  };
  const cfg = configs[status] ?? configs.pending;
  const Icon = cfg.icon;

  return (
    <Badge variant={cfg.variant}>
      <Icon className="mr-1 h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Plan-review gate (a)+(b)+(c): plan markdown + agent annotations + actions
// ---------------------------------------------------------------------------

function parseAnnotations(raw: string | null | undefined): PlanAnnotation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlanAnnotation[]) : [];
  } catch {
    return [];
  }
}

const ANNOTATION_TONE: Record<PlanAnnotation["kind"], string> = {
  scope: "text-sky-400",
  gap: "text-amber-400",
  redundancy: "text-zinc-400",
  constraint: "text-rose-400",
  risk: "text-rose-400",
};

function PlanReviewPanel({
  sessionId,
  planMarkdown,
  annotations,
  revision,
  onChanged,
}: {
  sessionId: number;
  planMarkdown: string;
  annotations: PlanAnnotation[];
  revision: number;
  onChanged: () => void | Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "revise">(null);

  async function approve() {
    setBusy("approve");
    try {
      const res = await fetch(`/api/admin/research/${sessionId}/approve-plan`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || payload?.success === false) throw new Error(payload?.error || "Approve failed");
      toast.success("Plan approved — research is running.");
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(null);
    }
  }

  async function requestChanges() {
    const trimmed = feedback.trim();
    if (!trimmed) {
      toast.error("Add feedback so the plan can be revised.");
      return;
    }
    setBusy("revise");
    try {
      const res = await fetch(`/api/admin/research/${sessionId}/request-changes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: trimmed }),
      });
      const payload = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || payload?.success === false) throw new Error(payload?.error || "Request failed");
      toast.success("Re-planning with your feedback…");
      setFeedback("");
      setShowFeedback(false);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="ring-1 ring-violet-800/40 bg-violet-950/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-violet-400" />
          Research plan — review &amp; approve
        </CardTitle>
        <CardDescription>
          Gemini drafted this plan{revision > 0 ? ` (revision ${revision})` : ""}. Review the
          onboard agent's notes, then approve to run or request changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {annotations.length > 0 && (
          <div className="rounded-lg bg-card p-3 ring-1 ring-border/40">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Onboard agent review · {annotations.length}
            </p>
            <ul className="space-y-1.5">
              {annotations.map((a, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed">
                  <span className={`shrink-0 font-mono uppercase ${ANNOTATION_TONE[a.kind] ?? "text-zinc-400"}`}>
                    {a.kind}
                  </span>
                  <span className="text-foreground/80">{a.note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto rounded-lg bg-muted/10 p-4 ring-1 ring-border/40">
          <MarkdownProse>{planMarkdown || "_No plan content yet._"}</MarkdownProse>
        </div>

        {showFeedback && (
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should change? e.g. also cover lighting showrooms; exclude anything north of the bridge."
            className="min-h-20 text-sm"
          />
        )}

        <div className="flex items-center justify-end gap-2">
          {showFeedback ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowFeedback(false);
                  setFeedback("");
                }}
                disabled={busy !== null}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={requestChanges} disabled={busy !== null}>
                {busy === "revise" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send changes
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowFeedback(true)} disabled={busy !== null}>
                Request changes
              </Button>
              <Button
                size="sm"
                onClick={approve}
                disabled={busy !== null}
                className="bg-emerald-500 text-emerald-950 hover:bg-emerald-500/90"
              >
                {busy === "approve" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Approve &amp; run
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Panel 1: Document Viewer
// ---------------------------------------------------------------------------

function DocumentPanel({
  markdown,
  loading,
  topic,
}: {
  markdown: string | null;
  loading: boolean;
  topic: string;
}) {
  const handleDownload = () => {
    if (!markdown) return;
    // Download as .md file (PDF via @react-pdf/renderer can be added as a follow-up)
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-${topic.slice(0, 30).replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Research downloaded");
  };

  return (
    <Card className="flex h-full flex-col ring-1 ring-border/40">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-emerald-500" />
          <CardTitle className="text-sm">Research Document</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          {markdown && (
            <Button variant="ghost" size="sm" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <Separator className="opacity-40" />
      <CardContent className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        ) : markdown ? (
          <MarkdownProse className="mx-auto max-w-3xl">{markdown}</MarkdownProse>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <FileText className="h-8 w-8" />
            <p className="mt-2 text-sm">Document not available yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Panel 2: Visualizer
// ---------------------------------------------------------------------------

function VisualizerPanel({
  sessionId,
  hasVisualizer,
}: {
  sessionId: number;
  hasVisualizer: boolean;
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false);

  return (
    <Card className="flex h-full min-h-[400px] flex-col ring-1 ring-border/40">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-emerald-500" />
          <CardTitle className="text-sm">Interactive Visualizer</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          {hasVisualizer && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                window.open(
                  `/api/admin/research/${sessionId}/visualizer`,
                  "_blank",
                )
              }
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <Separator className="opacity-40" />
      <CardContent className="relative flex-1 p-0">
        {hasVisualizer ? (
          <>
            {!iframeLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
              </div>
            )}
            <iframe
              src={`/api/admin/research/${sessionId}/visualizer`}
              className="h-full w-full min-h-[350px] border-0 rounded-b-xl"
              sandbox="allow-scripts allow-same-origin"
              onLoad={() => setIframeLoaded(true)}
              title="Research Visualizer"
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <Monitor className="h-8 w-8" />
            <p className="mt-2 text-sm">
              Visualizer not yet generated
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

