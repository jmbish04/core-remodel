/**
 * @fileoverview 0016 — Artifact Studio gallery island.
 *
 * Lists artifacts from `GET /api/studio` in a shadcn Card grid. Supports
 * client-side filtering by `kind` (report | app | dashboard) and a title
 * search. Renders loading / empty / error states, and links each card to its
 * viewer at `/admin/studio/<slug>`.
 *
 * Monolith rules: dark theme, no 1px borders, theme tokens only, mobile grid.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Eye,
  GitCommitHorizontal,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ArtifactKind = "report" | "app" | "dashboard";
type KindFilter = ArtifactKind | "all";

type ArtifactCard = {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  kind: string | null;
  status: string | null;
  openCount: number | null;
  revisionCount: number | null;
  updatedAt: string | number | null;
};

/** Coerce unix-seconds / ISO / null into a friendly local string. */
function fmtDate(t: string | number | null | undefined): string {
  if (t === null || t === undefined || t === "") return "—";
  const d = new Date(typeof t === "number" ? t * 1000 : t);
  if (Number.isNaN(d.getTime())) {
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) {
      const d2 = new Date(n * 1000);
      if (!Number.isNaN(d2.getTime())) return d2.toLocaleDateString();
    }
    return "—";
  }
  return d.toLocaleDateString();
}

type Variant = "default" | "secondary" | "destructive" | "outline";

function statusVariant(status: string | null | undefined): Variant {
  switch ((status ?? "").toLowerCase()) {
    case "published":
    case "active":
      return "default";
    case "draft":
      return "secondary";
    case "archived":
      return "outline";
    default:
      return "outline";
  }
}

/** Icon per artifact kind. */
function kindIcon(kind: string | null | undefined) {
  switch ((kind ?? "").toLowerCase()) {
    case "dashboard":
      return LayoutDashboard;
    case "report":
      return Sparkles;
    default:
      return LayoutDashboard;
  }
}

export function StudioGalleryApp() {
  const [artifacts, setArtifacts] = useState<ArtifactCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio", { credentials: "include" });
      if (res.status === 401) {
        setError("unauthorized");
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as { count: number; artifacts: ArtifactCard[] };
      setArtifacts(data.artifacts ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!artifacts) return [];
    const q = query.trim().toLowerCase();
    return artifacts.filter((a) => {
      const kindOk = kind === "all" || (a.kind ?? "").toLowerCase() === kind;
      const queryOk =
        q === "" || (a.title ?? "").toLowerCase().includes(q);
      return kindOk && queryOk;
    });
  }, [artifacts, kind, query]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    const isAuth = error === "unauthorized";
    return (
      <Alert variant="destructive">
        {isAuth ? <ShieldAlert className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        <AlertTitle>{isAuth ? "Admin sign-in required" : "Failed to load artifacts"}</AlertTitle>
        <AlertDescription>
          {isAuth
            ? "The Artifact Studio is admin-gated. Sign in to the admin portal to view artifacts."
            : error}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Kind</span>
          <Select value={kind} onValueChange={(v) => setKind((v ?? "all") as KindFilter)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="report">Report</SelectItem>
              <SelectItem value="app">App</SelectItem>
              <SelectItem value="dashboard">Dashboard</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Grid / empty */}
      {filtered.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl bg-card px-6 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">
            {artifacts && artifacts.length > 0
              ? "No artifacts match your filters"
              : "No artifacts yet"}
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            {artifacts && artifacts.length > 0
              ? "Try clearing the search or switching the kind filter."
              : "Artifacts are created in chat via MCP tools, then rendered here live."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => {
            const Icon = kindIcon(a.kind);
            return (
              <a
                key={a.id}
                href={`/admin/studio/${a.slug}`}
                className="group block focus-visible:outline-none"
              >
                <Card className="h-full transition-colors ring-1 ring-border/40 group-hover:ring-border/70 group-focus-visible:ring-ring/60">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <CardTitle className="truncate text-base">
                          {a.title ?? a.slug}
                        </CardTitle>
                      </div>
                      {a.status ? (
                        <Badge variant={statusVariant(a.status)} className="shrink-0">
                          {a.status}
                        </Badge>
                      ) : null}
                    </div>
                    <CardDescription className="line-clamp-2">
                      {a.description ?? "No description."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center gap-4 text-xs text-muted-foreground">
                    {a.kind ? (
                      <Badge variant="outline" className="px-1.5 py-0">
                        {a.kind}
                      </Badge>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <GitCommitHorizontal className="h-3.5 w-3.5" />
                      {a.revisionCount ?? 0} rev
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" />
                      {a.openCount ?? 0}
                    </span>
                    <span className="ml-auto">{fmtDate(a.updatedAt)}</span>
                  </CardContent>
                </Card>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
