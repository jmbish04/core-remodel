import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Plus,
  BookOpen,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Database,
  FileText,
  Sparkles,
  ArrowRight,
  Trash2,
  RefreshCw,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";

import { ResearchPromptEditor } from "@/components/research/ResearchPromptEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResearchSession {
  id: number;
  topic: string;
  status:
    | "pending"
    | "planning"
    | "awaiting_plan_approval"
    | "researching"
    | "embedding"
    | "generating"
    | "complete"
    | "failed";
  r2MarkdownKey: string | null;
  r2WebappKey: string | null;
  vectorNamespace: string | null;
  errorMessage: string | null;
  chunkCount: number | null;
  createdAt: number | string;
  completedAt: number | string | null;
}

// ---------------------------------------------------------------------------
// Status Config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  ResearchSession["status"],
  { label: string; icon: any; variant: "default" | "secondary" | "destructive" | "outline"; colorClass: string }
> = {
  pending: {
    label: "Pending",
    icon: Clock,
    variant: "secondary",
    colorClass: "text-zinc-400",
  },
  planning: {
    label: "Planning",
    icon: Loader2,
    variant: "default",
    colorClass: "text-violet-400",
  },
  awaiting_plan_approval: {
    label: "Plan review",
    icon: FileText,
    variant: "secondary",
    colorClass: "text-violet-300",
  },
  researching: {
    label: "Researching",
    icon: Sparkles,
    variant: "default",
    colorClass: "text-amber-400",
  },
  embedding: {
    label: "Embedding",
    icon: Database,
    variant: "default",
    colorClass: "text-blue-400",
  },
  generating: {
    label: "Generating",
    icon: Loader2,
    variant: "default",
    colorClass: "text-violet-400",
  },
  complete: {
    label: "Complete",
    icon: CheckCircle,
    variant: "outline",
    colorClass: "text-emerald-400",
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    variant: "destructive",
    colorClass: "text-red-400",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResearchLibraryApp() {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [topic, setTopic] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/research");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const data = (await res.json()) as any;
      setSessions(data.sessions ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load research sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Poll for in-progress sessions
  useEffect(() => {
    const hasInProgress = sessions.some((s) =>
      ["pending", "planning", "awaiting_plan_approval", "researching", "embedding", "generating"].includes(
        s.status,
      ),
    );
    if (!hasInProgress) return;

    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [sessions, fetchSessions]);

  // Create new research session
  const handleCreate = async () => {
    const trimmed = topic.trim();
    if (trimmed.length < 5) {
      toast.error("Topic must be at least 5 characters");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      });
      if (!res.ok) {
        const err = (await res.json()) as any;
        throw new Error(err.error ?? "Failed to create session");
      }
      await res.json();
      toast.success(`Research started: "${trimmed}"`);
      setTopic("");
      fetchSessions();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start research",
      );
    } finally {
      setCreating(false);
    }
  };

  // Delete session
  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/research/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Research session deleted");
      fetchSessions();
    } catch {
      toast.error("Failed to delete session");
    }
  };

  // Filter sessions
  const filteredSessions = searchQuery
    ? sessions.filter((s) =>
        s.topic.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sessions;

  // Format date
  const formatDate = (ts: number | string) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4 text-zinc-400">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
        <p className="text-sm font-medium tracking-wide">
          Loading Research Center...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            <BookOpen className="h-7 w-7 shrink-0 text-emerald-500 sm:h-8 sm:w-8" />
            Research Center
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            AI-powered deep research for home renovation intelligence. Start a
            topic, view interactive visualizations, and chat with your findings.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSessions}
          className="self-start md:self-auto"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* New Research Form */}
      <Card className="ring-1 ring-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-emerald-500" />
            Start Deep Research
          </CardTitle>
          <CardDescription>
            Enter a research topic and Gemini will conduct a comprehensive
            analysis with data-driven findings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ResearchPromptEditor value={topic} onTextChange={setTopic} disabled={creating} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {topic.trim().length < 5
                ? "Write at least a sentence describing what to research."
                : "Plan mode is on — you'll review the research plan before it runs."}
            </p>
            <Button
              onClick={handleCreate}
              disabled={creating || topic.trim().length < 5}
            >
              {creating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              {creating ? "Starting..." : "Start research"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search + Filter */}
      {sessions.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search research topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      )}

      {/* Sessions Grid */}
      {filteredSessions.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl ring-1 ring-border/40 p-8 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-zinc-600" />
          <h3 className="mt-3 text-sm font-medium text-zinc-300">
            {searchQuery ? "No matching research" : "No research yet"}
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            {searchQuery
              ? "Try a different search term"
              : "Start a deep research session above to get started."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredSessions.map((session) => {
            const statusCfg = STATUS_CONFIG[session.status];
            const StatusIcon = statusCfg.icon;
            const isActive = [
              "pending",
              "researching",
              "embedding",
              "generating",
            ].includes(session.status);

            const open = () => {
              window.location.href = `/admin/planning/research/${session.id}`;
            };

            return (
              <Card
                key={session.id}
                className="group flex flex-col overflow-hidden p-0 ring-1 ring-border/40 transition hover:ring-border/60"
              >
                <CardContent className="flex flex-1 flex-col p-0">
                  {/* Top bar: status + actions menu */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
                    <Badge variant={statusCfg.variant} className="gap-1">
                      <StatusIcon
                        className={`size-3 ${isActive ? "animate-spin" : ""} ${statusCfg.colorClass}`}
                        aria-hidden="true"
                      />
                      {statusCfg.label}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground"
                            aria-label="Session actions"
                          />
                        }
                      >
                        <MoreVertical className="size-4" aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={open}>Open</DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDelete(session.id)}
                          className="text-rose-400"
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="space-y-1.5">
                      <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                        {session.topic}
                      </h3>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="size-3" aria-hidden="true" />
                        {formatDate(session.createdAt)}
                      </p>
                    </div>

                    {session.status === "failed" && session.errorMessage && (
                      <p className="rounded-md bg-rose-500/5 px-2 py-1.5 text-xs text-rose-400 ring-1 ring-rose-500/20">
                        {session.errorMessage}
                      </p>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {session.chunkCount != null && session.chunkCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Database className="size-3" aria-hidden="true" />
                          {session.chunkCount} chunks
                        </span>
                      )}
                      {session.r2MarkdownKey && (
                        <span className="flex items-center gap-1">
                          <FileText className="size-3" aria-hidden="true" />
                          Report saved
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>

                {/* Footer action */}
                <div className="border-t border-border/40 p-3">
                  <Button
                    variant={session.status === "complete" ? "default" : "outline"}
                    className="w-full"
                    onClick={open}
                  >
                    {session.status === "complete" ? (
                      <>
                        View research
                        <ArrowRight className="ml-1 size-3.5" />
                      </>
                    ) : session.status === "awaiting_plan_approval" ? (
                      "Review plan"
                    ) : isActive ? (
                      "In progress"
                    ) : (
                      "Open"
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
