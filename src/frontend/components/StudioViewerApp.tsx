/**
 * @fileoverview 0016 — Artifact Studio viewer island.
 *
 * Renders a single artifact:
 *   - The running artifact lives in a sandboxed <iframe> pointing at
 *     `/studio-runtime?slug=…&revision=…` (sandbox="allow-scripts"), so the
 *     executed TSX cannot touch this page's DOM or cookies beyond same-origin
 *     script execution.
 *   - A side panel shows title/description/kind, a revision <Select> (reloading
 *     the iframe on change), a read-only "View source" dialog, and admin
 *     actions: rename + set-status (PATCH) and delete (DELETE via AlertDialog).
 *   - On mount, fire-and-forget POST `/api/studio/:slug/open` to bump the
 *     open counter.
 *
 * Data comes from `GET /api/studio/:slug?revision=<n?>`. Monolith rules apply:
 * dark theme, no 1px borders, no window.confirm (AlertDialog instead), theme
 * tokens only, mobile-responsive (side panel stacks under the frame).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Code2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type RevisionSummary = {
  id: string;
  revisionNumber: number;
  changeNote: string | null;
  createdAt: string | number | null;
};

type FullRevision = RevisionSummary & {
  sourceTsx: string;
  entryExport: string | null;
  importsJson: string | null;
};

type Artifact = {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  kind: string | null;
  status: string | null;
  openCount: number | null;
  revisionCount: number | null;
  createdAt: string | number | null;
  updatedAt: string | number | null;
  revision: FullRevision | null;
  revisions: RevisionSummary[];
};

const STATUS_OPTIONS = ["draft", "published", "archived"];

function fmtDate(t: string | number | null | undefined): string {
  if (t === null || t === undefined || t === "") return "—";
  const d = new Date(typeof t === "number" ? t * 1000 : t);
  if (Number.isNaN(d.getTime())) {
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) {
      const d2 = new Date(n * 1000);
      if (!Number.isNaN(d2.getTime())) return d2.toLocaleString();
    }
    return "—";
  }
  return d.toLocaleString();
}

export function StudioViewerApp({ slug }: { slug: string }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected revision number, drives both the fetch and the iframe src.
  const [revisionNumber, setRevisionNumber] = useState<number | null>(null);

  // Rename/status form state.
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  // The sandboxed runtime iframe. It has an OPAQUE origin, so the artifact
  // inside it cannot fetch our cookie-gated `/api/*` directly. Instead it posts
  // a `studio:fetch` message here; this host (which HAS the admin cookie)
  // proxies the read-only GET and posts the result back. See StudioRuntime.tsx.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { __studio?: boolean; kind?: string; id?: string; path?: string };
      if (!d || d.__studio !== true || d.kind !== "fetch") return;
      // Only honor messages coming from OUR runtime iframe.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;

      const target = iframeRef.current.contentWindow;
      const reply = (payload: Record<string, unknown>) =>
        target?.postMessage({ __studio: true, kind: "fetch:result", id: d.id, ...payload }, "*");

      // Read-only allowlist: same-origin `/api/*` GETs only (no writes in v1).
      if (typeof d.path !== "string" || !d.path.startsWith("/api/")) {
        reply({ ok: false, error: "studioData.get: only /api/* paths are allowed." });
        return;
      }
      fetch(d.path, { credentials: "include" })
        .then(async (r) => {
          if (!r.ok) {
            reply({ ok: false, error: `GET ${d.path} failed (${r.status})` });
            return;
          }
          reply({ ok: true, data: await r.json() });
        })
        .catch((err: unknown) =>
          reply({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const load = useCallback(
    async (revision: number | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = revision != null ? `?revision=${revision}` : "";
        const res = await fetch(
          `/api/studio/${encodeURIComponent(slug)}${qs}`,
          { credentials: "include" },
        );
        if (res.status === 401) {
          setError("unauthorized");
          return;
        }
        if (res.status === 404) {
          setError("not-found");
          return;
        }
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as Artifact;
        setArtifact(data);
        setTitleDraft(data.title ?? "");
        setDescDraft(data.description ?? "");
        setStatusDraft((data.status ?? "draft").toLowerCase());
        if (revision == null && data.revision) {
          setRevisionNumber(data.revision.revisionNumber);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [slug],
  );

  // Initial load + bump the open counter (fire-and-forget).
  useEffect(() => {
    load(null);
    void fetch(`/api/studio/${encodeURIComponent(slug)}/open`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {
      /* usage stat only — never surface to the user */
    });
  }, [load, slug]);

  const iframeSrc = useMemo(() => {
    const params = new URLSearchParams({ slug });
    if (revisionNumber != null) params.set("revision", String(revisionNumber));
    return `/studio-runtime?${params.toString()}`;
  }, [slug, revisionNumber]);

  const onRevisionChange = (value: string | null) => {
    if (value == null) return;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      setRevisionNumber(n);
      // Reload metadata for the selected revision (source + notes).
      load(n);
    }
  };

  const handleSave = async () => {
    if (!artifact) return;
    setSaving(true);
    try {
      const patch: { title?: string; description?: string; status?: string } = {};
      if (titleDraft !== (artifact.title ?? "")) patch.title = titleDraft;
      if (descDraft !== (artifact.description ?? "")) patch.description = descDraft;
      if (statusDraft !== (artifact.status ?? "draft").toLowerCase())
        patch.status = statusDraft;

      if (Object.keys(patch).length === 0) {
        toast.info("No changes to save.");
        return;
      }

      const res = await fetch(`/api/studio/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast.success("Artifact updated.");
      load(revisionNumber);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/studio/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast.success("Artifact deleted.");
      window.location.href = "/admin/studio";
    } catch (e) {
      toast.error((e as Error).message);
      setDeleting(false);
    }
  };

  if (loading && !artifact) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    const isAuth = error === "unauthorized";
    const isMissing = error === "not-found";
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" render={<a href="/admin/studio" />}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to gallery
        </Button>
        <Alert variant="destructive">
          {isAuth ? <ShieldAlert className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertTitle>
            {isAuth
              ? "Admin sign-in required"
              : isMissing
                ? "Artifact not found"
                : "Failed to load artifact"}
          </AlertTitle>
          <AlertDescription>
            {isAuth
              ? "This artifact is admin-gated. Sign in to the admin portal to view it."
              : isMissing
                ? "No artifact exists at this slug — it may have been deleted."
                : error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!artifact) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" render={<a href="/admin/studio" />}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to gallery
        </Button>
        <div className="flex items-center gap-2">
          {/* Open the artifact standalone — chrome-free full page (no sidebar,
              no viewer panel), the same runtime the iframe embeds. */}
          <Button
            variant="outline"
            size="sm"
            render={<a href={iframeSrc} target="_blank" rel="noopener noreferrer" />}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open full page
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => load(revisionNumber)}
            disabled={loading}
            aria-label="Reload"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Running artifact — sandboxed iframe */}
        <Card className="overflow-hidden py-0">
          <iframe
            key={iframeSrc}
            ref={iframeRef}
            src={iframeSrc}
            sandbox="allow-scripts"
            title={artifact.title ?? artifact.slug}
            className="h-[70vh] min-h-[32rem] w-full border-0 bg-background"
          />
        </Card>

        {/* Side panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="gap-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-lg">
                  {artifact.title ?? artifact.slug}
                </CardTitle>
                {artifact.status ? (
                  <Badge variant="outline" className="shrink-0">
                    {artifact.status}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {artifact.description ?? "No description."}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {artifact.kind ? (
                  <Badge variant="secondary" className="px-1.5 py-0">
                    {artifact.kind}
                  </Badge>
                ) : null}
                <span>{artifact.revisionCount ?? artifact.revisions.length} revisions</span>
                <span>·</span>
                <span>{artifact.openCount ?? 0} opens</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Revision selector */}
              <div className="space-y-2">
                <Label>Revision</Label>
                <Select
                  value={revisionNumber != null ? String(revisionNumber) : undefined}
                  onValueChange={onRevisionChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select revision" />
                  </SelectTrigger>
                  <SelectContent>
                    {artifact.revisions.map((r) => (
                      <SelectItem key={r.id} value={String(r.revisionNumber)}>
                        v{r.revisionNumber}
                        {r.changeNote ? ` — ${r.changeNote}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {artifact.revision ? (
                  <p className="text-xs text-muted-foreground">
                    {artifact.revision.changeNote ?? "No change note."} ·{" "}
                    {fmtDate(artifact.revision.createdAt)}
                  </p>
                ) : null}
              </div>

              {/* View source */}
              <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
                <DialogTrigger
                  render={
                    <Button variant="outline" className="w-full" disabled={!artifact.revision}>
                      <Code2 className="mr-2 h-4 w-4" />
                      View source
                    </Button>
                  }
                />
                <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>
                      Source — {artifact.title ?? artifact.slug}
                      {artifact.revision ? ` (v${artifact.revision.revisionNumber})` : ""}
                    </DialogTitle>
                    <DialogDescription>
                      Read-only TSX for the selected revision.
                    </DialogDescription>
                  </DialogHeader>
                  <ScrollArea className="h-[60vh] rounded-lg bg-muted/40 ring-1 ring-border/40">
                    <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground/90">
                      {artifact.revision?.sourceTsx ?? "No source."}
                    </pre>
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Admin actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Admin</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="artifact-title">Title</Label>
                <Input
                  id="artifact-title"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="artifact-desc">Description</Label>
                <Input
                  id="artifact-desc"
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={statusDraft}
                  onValueChange={(v) => setStatusDraft(v ?? "draft")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save changes
              </Button>

              <Separator />

              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="destructive" className="w-full" disabled={deleting}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete artifact
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this artifact?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes "{artifact.title ?? artifact.slug}" and
                      all of its revisions. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={handleDelete}>
                      {deleting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
