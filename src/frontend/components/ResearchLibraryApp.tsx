import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResearchSession {
  id: number;
  topic: string;
  status:
    | "pending"
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
      ["pending", "researching", "embedding", "generating"].includes(s.status),
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
      const data = await res.json();
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
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="e.g. Cost analysis for second-floor bathroom remodel in San Francisco..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creating) handleCreate();
              }}
              className="flex-1"
            />
            <Button
              onClick={handleCreate}
              disabled={creating || topic.trim().length < 5}
            >
              {creating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              {creating ? "Starting..." : "Research"}
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

            return (
              <Card
                key={session.id}
                className="group relative ring-1 ring-border/40 transition-all duration-200 hover:ring-border/60"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-2 text-base leading-snug">
                      {session.topic}
                    </CardTitle>
                    <Badge
                      variant={statusCfg.variant}
                      className="shrink-0"
                    >
                      <StatusIcon
                        className={`mr-1 h-3 w-3 ${isActive ? "animate-spin" : ""} ${statusCfg.colorClass}`}
                      />
                      {statusCfg.label}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    {formatDate(session.createdAt)}
                  </CardDescription>
                </CardHeader>

                <CardContent className="pb-3">
                  {session.status === "failed" && session.errorMessage && (
                    <p className="mb-2 rounded bg-red-950/40 px-2 py-1.5 text-xs text-red-400 ring-1 ring-red-800/40">
                      {session.errorMessage}
                    </p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-zinc-500">
                    {session.chunkCount != null && session.chunkCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Database className="h-3 w-3" />
                        {session.chunkCount} chunks
                      </span>
                    )}
                    {session.r2MarkdownKey && (
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        Report saved
                      </span>
                    )}
                  </div>
                </CardContent>

                <CardFooter className="gap-2 pt-0">
                  {session.status === "complete" && (
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        window.location.href = `/admin/research/${session.id}`;
                      }}
                    >
                      View Research
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(session.id)}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
