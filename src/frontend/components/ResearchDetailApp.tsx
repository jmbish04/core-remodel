import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  AssistantModalPrimitive,
} from "@assistant-ui/react";
import { useAgent } from "agents/react";
// CRITICAL: import from @cloudflare/ai-chat/react — never from ai/react (zodv3 breakage)
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Monitor,
  MessageSquare,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Database,
  Sparkles,
  Send,
  Bot,
  User,
  ExternalLink,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
      !["pending", "researching", "embedding", "generating"].includes(
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
  const isInProgress = ["pending", "researching", "embedding", "generating"].includes(session.status);
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
          <h1 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
            {session.topic}
          </h1>
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

      {/* Layout — Tabs and Chat */}
      {(isComplete || markdown) && (
        <div className="flex flex-col lg:flex-row gap-6 lg:h-[calc(100vh-220px)] lg:min-h-[600px]">
          {/* Main Content Area (Tabs) */}
          <div className="flex-1 flex flex-col min-w-0">
            <Tabs defaultValue="document" className="flex-1 flex flex-col min-h-0 h-full">
              <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-transparent p-0 mb-4 h-auto overflow-x-auto shrink-0">
                <TabsTrigger 
                  value="document"
                  className="relative rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-zinc-400 shadow-none hover:text-zinc-200 data-[state=active]:border-emerald-500 data-[state=active]:text-zinc-100 data-[state=active]:shadow-none"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Research Document
                </TabsTrigger>
                <TabsTrigger 
                  value="visualizer"
                  className="relative rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-2 font-semibold text-zinc-400 shadow-none hover:text-zinc-200 data-[state=active]:border-emerald-500 data-[state=active]:text-zinc-100 data-[state=active]:shadow-none"
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  Interactive Web App
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="document" className="flex-1 min-h-[500px] lg:min-h-0 m-0 data-[state=active]:flex flex-col">
                <DocumentPanel
                  markdown={markdown}
                  loading={markdownLoading}
                  topic={session.topic}
                />
              </TabsContent>
              
              <TabsContent value="visualizer" className="flex-1 min-h-[500px] lg:min-h-0 m-0 data-[state=active]:flex flex-col">
                <VisualizerPanel
                  sessionId={id}
                  hasVisualizer={!!session.r2WebappKey}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Chat Panel (Right Sidebar) */}
          <div className="w-full lg:w-[380px] xl:w-[420px] shrink-0 flex flex-col h-[500px] lg:h-full">
            <ChatPanel sessionId={id} topic={session.topic} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
    pending: { label: "Pending", variant: "secondary", icon: Clock },
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
          <article
            className="prose prose-sm prose-invert max-w-none
              prose-headings:text-zinc-100 prose-headings:font-bold
              prose-p:text-zinc-300 prose-p:leading-relaxed
              prose-strong:text-zinc-100
              prose-li:text-zinc-300
              prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline
              prose-code:text-emerald-300 prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
              prose-pre:bg-zinc-900 prose-pre:ring-1 prose-pre:ring-border/40 prose-pre:text-emerald-300
              prose-table:text-zinc-300
              prose-th:text-zinc-100 prose-th:border-zinc-700
              prose-td:border-zinc-800"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {markdown}
            </ReactMarkdown>
          </article>
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

// ---------------------------------------------------------------------------
// Panel 3: Research Chat (assistant-ui + @cloudflare/ai-chat)
// ---------------------------------------------------------------------------

function ChatPanel({
  sessionId,
  topic,
}: {
  sessionId: number;
  topic: string;
}) {
  const agent = useAgent({
    agent: "ResearchAgent",
    name: `research-${sessionId}`,
  });

  const chat = useAgentChat({
    agent,
  });

  const runtime = useExternalStoreRuntime({
    isRunning: chat.status === "streaming" || chat.status === "submitted",
    messages: chat.messages,
    convertMessage: (message: any) => ({
      id: message.id,
      role: message.role,
      content: [{ type: "text" as const, text: message.content }],
    }),
    onNew: async (message) => {
      if (message.content[0]?.type === "text") {
        chat.sendMessage({
          role: "user",
          parts: [{ type: "text", text: message.content[0].text }],
        });
      }
    },
  });

  return (
    <Card className="flex h-full min-h-[400px] flex-col ring-1 ring-border/40">
      <CardHeader className="flex-row items-center gap-2 pb-3">
        <MessageSquare className="h-4 w-4 text-emerald-500" />
        <CardTitle className="text-sm">Research Chat</CardTitle>
        <Badge variant="outline" className="ml-auto text-xs">
          RAG-powered
        </Badge>
      </CardHeader>
      <Separator className="opacity-40" />
      <CardContent className="flex-1 overflow-hidden p-0">
        <AssistantRuntimeProvider runtime={runtime}>
          <div className="flex h-full flex-col">
            {/* Messages */}
            <ThreadPrimitive.Root className="flex-1 overflow-y-auto">
              <ThreadPrimitive.Viewport className="flex flex-col gap-3 p-4">
                {/* Welcome message */}
                <ThreadPrimitive.Empty>
                  <div className="flex flex-col items-center justify-center py-8 text-center text-zinc-500">
                    <Bot className="h-8 w-8 text-emerald-500/50" />
                    <p className="mt-3 text-sm font-medium text-zinc-400">
                      Ask about your research
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-zinc-600">
                      I have context from the deep research on &ldquo;
                      {topic.slice(0, 60)}
                      {topic.length > 60 ? "..." : ""}&rdquo;
                    </p>
                  </div>
                </ThreadPrimitive.Empty>

                <ThreadPrimitive.Messages
                  components={{
                    UserMessage: ChatUserMessage,
                    AssistantMessage: ChatAssistantMessage,
                  }}
                />
              </ThreadPrimitive.Viewport>
            </ThreadPrimitive.Root>

            {/* Composer */}
            <div className="border-t border-zinc-800/60 p-3">
              <ComposerPrimitive.Root className="flex items-center gap-2">
                <ComposerPrimitive.Input
                  placeholder="Ask a question about the research..."
                  className="flex-1 resize-none rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-100 ring-1 ring-border/40 placeholder:text-zinc-600 focus:outline-none focus:ring-emerald-500/50"
                />
                <ComposerPrimitive.Send asChild>
                  <Button size="sm" className="shrink-0">
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </ComposerPrimitive.Send>
              </ComposerPrimitive.Root>
            </div>
          </div>
        </AssistantRuntimeProvider>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chat Message Components
// ---------------------------------------------------------------------------

function ChatUserMessage() {
  return (
    <div className="flex gap-2 justify-end">
      <div className="max-w-[80%] rounded-xl bg-emerald-600/20 px-3 py-2 text-sm text-zinc-100 ring-1 ring-emerald-500/20">
        <MessagePrimitive.Content />
      </div>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-border/40">
        <User className="h-3.5 w-3.5 text-zinc-400" />
      </div>
    </div>
  );
}

function ChatAssistantMessage() {
  return (
    <div className="flex gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-950 ring-1 ring-emerald-500/30">
        <Bot className="h-3.5 w-3.5 text-emerald-400" />
      </div>
      <div className="max-w-[80%] rounded-xl bg-zinc-900 px-3 py-2 text-sm text-zinc-300 ring-1 ring-border/40">
        <MessagePrimitive.Content />
      </div>
    </div>
  );
}

