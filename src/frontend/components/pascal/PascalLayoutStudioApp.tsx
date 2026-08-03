/**
 * @fileoverview 0043 Phase 4 — Core Remodel's Pascal Layout Studio.
 *
 * Core Remodel owns projects, studies, evidence, and durable scene state. Pascal
 * remains the external rendering/editor client; this island never renders 3D.
 */
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  ChevronDown,
  ExternalLink,
  GitCompareArrows,
  ImageIcon,
  Layers3,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Ruler,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  OverviewNoteEditor,
  type OverviewNoteEditorValue,
} from "@/components/showroom/OverviewNoteEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ScopeType = "floor" | "room" | "whole_home";
type VariantStatus = "draft" | "active" | "archived";

interface ScopeOption {
  id: number;
  name: string;
  floorId?: number;
}

interface ProjectSummary {
  id: string;
  coreRemodelProjectId: string;
  name: string;
  scopeType: ScopeType;
  floorId: number | null;
  roomId: number | null;
  scopeName: string | null;
  studyCount: number;
  variantCount: number;
  latestThumbnailUrl: string | null;
  updatedAt: string;
}

interface Study {
  id: string;
  projectId: string;
  title: string;
  descriptionMarkdown: string | null;
  descriptionHtml: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MeasurementEvidence {
  measurementId?: number | string;
  kind?: string;
  value?: number;
  unit?: string;
  confidence?: number;
  sourceRevision?: string | null;
}

interface Variant {
  id: string;
  projectId: string;
  studyId: string | null;
  name: string;
  descriptionMarkdown: string | null;
  descriptionHtml: string | null;
  version: number;
  nodeCount: number;
  status: VariantStatus;
  parentSceneId: string | null;
  confidence: number | null;
  measurements: MeasurementEvidence[];
  thumbnailUrl: string | null;
  editorUrl: string;
  updatedAt: string;
}

interface ProjectIndexPayload {
  projects: ProjectSummary[];
  scopes: { floors: ScopeOption[]; rooms: ScopeOption[] };
}

interface ProjectDetailPayload {
  project: ProjectSummary;
  studies: Study[];
  variants: Variant[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}

function statusVariant(status: VariantStatus): "secondary" | "outline" | "destructive" {
  if (status === "archived") return "destructive";
  return status === "active" ? "outline" : "secondary";
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>Layout Studio could not load</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading layout projects">
      {[0, 1, 2].map((key) => (
        <Card key={key}>
          <CardContent className="space-y-4">
            <Skeleton className="aspect-[16/9] w-full rounded-lg" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PascalLayoutStudioApp({ projectId }: { projectId?: string }) {
  return projectId ? <ProjectDetail projectId={projectId} /> : <ProjectIndex />;
}

function ProjectIndex() {
  const [data, setData] = useState<ProjectIndexPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<ProjectIndexPayload>("/api/pascal/v1/projects"));
    } catch (cause) {
      console.error("[PascalLayoutStudio] project index failed", cause);
      setError(cause instanceof Error ? cause.message : "Could not load layout projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  if (loading && !data) return <LoadingCards />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {data.projects.length} {data.projects.length === 1 ? "project" : "projects"}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus /> New layout project
        </Button>
      </div>

      {data.projects.length === 0 ? (
        <Card>
          <Empty className="min-h-64">
            <EmptyMedia>
              <Layers3 className="size-7 text-muted-foreground" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No layout projects yet</EmptyTitle>
              <EmptyDescription>Create one from a floor, room, or the whole home.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> New layout project
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.projects.map((project) => (
            <Card key={project.id} className="transition-shadow hover:shadow-md">
              {project.latestThumbnailUrl ? (
                <img
                  src={project.latestThumbnailUrl}
                  alt={`Latest layout for ${project.name}`}
                  className="aspect-[16/9] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[16/9] items-center justify-center bg-muted/35">
                  <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden="true" />
                </div>
              )}
              <CardHeader>
                <CardTitle>{project.name}</CardTitle>
                <CardDescription>{project.scopeName ?? "Unscoped"}</CardDescription>
                <CardAction>
                  <Badge variant="secondary">{project.scopeType.replace("_", " ")}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex gap-4 text-xs text-muted-foreground">
                <span>{project.studyCount} studies</span>
                <span>{project.variantCount} variants</span>
                <span>Updated {formatDate(project.updatedAt)}</span>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  render={
                    <a
                      href={`/admin/pascal/${encodeURIComponent(project.id)}`}
                      aria-label={`Open ${project.name}`}
                    />
                  }
                >
                  Open project
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} scopes={data.scopes} />
    </div>
  );
}

function CreateProjectDialog({
  open,
  onOpenChange,
  scopes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopes: ProjectIndexPayload["scopes"];
}) {
  const [name, setName] = useState("");
  const [coreProjectId, setCoreProjectId] = useState("126-colby");
  const [scopeType, setScopeType] = useState<ScopeType>("floor");
  const [scopeId, setScopeId] = useState("");
  const [saving, setSaving] = useState(false);
  const options = scopeType === "floor" ? scopes.floors : scopeType === "room" ? scopes.rooms : [];

  const submit = async () => {
    if (!name.trim() || !coreProjectId.trim() || (scopeType !== "whole_home" && !scopeId)) return;
    setSaving(true);
    try {
      const created = await api<{ id: string }>("/api/pascal/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          coreRemodelProjectId: coreProjectId.trim(),
          scopeType,
          floorId: scopeType === "floor" ? Number(scopeId) : null,
          roomId: scopeType === "room" ? Number(scopeId) : null,
        }),
      });
      toast.success("Layout project created");
      window.location.assign(`/admin/pascal/${encodeURIComponent(created.id)}`);
    } catch (cause) {
      console.error("[PascalLayoutStudio] create project failed", cause);
      toast.error(cause instanceof Error ? cause.message : "Could not create project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New layout project</DialogTitle>
          <DialogDescription>Choose the Core Remodel scope Pascal will render.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pascal-project-name">Project name</Label>
            <Input
              id="pascal-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Upstairs layouts"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pascal-core-project-id">Core Remodel project ID</Label>
            <Input
              id="pascal-core-project-id"
              value={coreProjectId}
              onChange={(event) => setCoreProjectId(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Scope</Label>
            <Select
              value={scopeType}
              onValueChange={(value) => value && (setScopeType(value as ScopeType), setScopeId(""))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="floor">Floor</SelectItem>
                <SelectItem value="room">Room</SelectItem>
                <SelectItem value="whole_home">Whole home</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scopeType !== "whole_home" ? (
            <div className="space-y-2">
              <Label>{scopeType === "floor" ? "Floor" : "Room"}</Label>
              <Select value={scopeId} onValueChange={(value) => setScopeId(value ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder={`Choose a ${scopeType}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={String(option.id)}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <DialogFooter showCloseButton>
          <Button
            disabled={
              saving ||
              !name.trim() ||
              !coreProjectId.trim() ||
              (scopeType !== "whole_home" && !scopeId)
            }
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />} Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProjectDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [studyOpen, setStudyOpen] = useState(false);
  const [variantStudy, setVariantStudy] = useState<Study | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<Variant[] | null>(null);
  const [comparing, setComparing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(
        await api<ProjectDetailPayload>(
          `/api/pascal/v1/projects/${encodeURIComponent(projectId)}/studies`,
        ),
      );
    } catch (cause) {
      console.error("[PascalLayoutStudio] project detail failed", cause);
      setError(cause instanceof Error ? cause.message : "Could not load the layout project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const variantsByStudy = useMemo(() => {
    const map = new Map<string, Variant[]>();
    for (const variant of data?.variants ?? []) {
      if (!variant.studyId) continue;
      map.set(variant.studyId, [...(map.get(variant.studyId) ?? []), variant]);
    }
    return map;
  }, [data?.variants]);

  const toggleSelected = (variant: Variant, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        const otherStudy = data?.variants.find(
          (item) => next.has(item.id) && item.studyId !== variant.studyId,
        );
        if (otherStudy) next.clear();
        next.add(variant.id);
      } else next.delete(variant.id);
      return next;
    });
  };

  const runCompare = async () => {
    if (selected.size < 2) return;
    setComparing(true);
    try {
      const result = await api<{ variants: Variant[] }>("/api/pascal/v1/variants/compare", {
        method: "POST",
        body: JSON.stringify({ variantIds: [...selected] }),
      });
      setCompare(result.variants);
    } catch (cause) {
      console.error("[PascalLayoutStudio] compare failed", cause);
      toast.error(cause instanceof Error ? cause.message : "Could not compare variants");
    } finally {
      setComparing(false);
    }
  };

  if (loading && !data) return <LoadingCards />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <a
        href="/admin/pascal"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All layout projects
      </a>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{data.project.name}</h2>
            <Badge variant="secondary">{data.project.scopeName ?? data.project.scopeType}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.studies.length} studies · {data.variants.length} variants · Core Remodel remains
            the source of truth.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size >= 2 ? (
            <Button variant="outline" onClick={() => void runCompare()} disabled={comparing}>
              {comparing ? <Loader2 className="animate-spin" /> : <GitCompareArrows />} Compare{" "}
              {selected.size}
            </Button>
          ) : null}
          <Button onClick={() => setStudyOpen(true)}>
            <Plus /> New study
          </Button>
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {data.studies.length === 0 ? (
        <Card>
          <Empty className="min-h-64">
            <EmptyMedia>
              <Sparkles className="size-7 text-muted-foreground" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Start the first layout study</EmptyTitle>
              <EmptyDescription>
                Group related ideas, then generate measured or AI-assisted variants.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setStudyOpen(true)}>
                <Plus /> New study
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <div className="space-y-6">
          {data.studies.map((study) => {
            const variants = variantsByStudy.get(study.id) ?? [];
            return (
              <section key={study.id} className="space-y-3 [--inset:1rem]">
                <div className="flex flex-wrap items-start justify-between gap-3 px-[var(--inset)]">
                  <div>
                    <h3 className="text-lg font-semibold">{study.title}</h3>
                    {study.descriptionMarkdown ? (
                      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                        {study.descriptionMarkdown}
                      </p>
                    ) : null}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setVariantStudy(study)}>
                    <Plus /> New variant
                  </Button>
                </div>
                {variants.length === 0 ? (
                  <Card size="sm">
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      No variants yet. Generate a measured base to begin.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {variants.map((variant) => (
                      <VariantCard
                        key={variant.id}
                        variant={variant}
                        selected={selected.has(variant.id)}
                        onSelected={(checked) => toggleSelected(variant, checked)}
                        onChanged={load}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <CreateStudyDialog
        open={studyOpen}
        onOpenChange={setStudyOpen}
        projectId={projectId}
        onCreated={load}
      />
      <CreateVariantDialog
        study={variantStudy}
        onOpenChange={(open) => !open && setVariantStudy(null)}
        variants={data.variants}
        onCreated={load}
      />
      <ComparisonDialog variants={compare} onOpenChange={(open) => !open && setCompare(null)} />
    </div>
  );
}

function CreateStudyDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState<OverviewNoteEditorValue>({
    markdown: "",
    html: "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api(`/api/pascal/v1/projects/${encodeURIComponent(projectId)}/studies`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          descriptionMarkdown: description.markdown || null,
          descriptionHtml: description.html || null,
        }),
      });
      toast.success("Study created");
      onOpenChange(false);
      setTitle("");
      setDescription({ markdown: "", html: "" });
      await onCreated();
    } catch (cause) {
      console.error("[PascalLayoutStudio] create study failed", cause);
      toast.error(cause instanceof Error ? cause.message : "Could not create study");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New layout study</DialogTitle>
          <DialogDescription>Group variants that answer one layout question.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pascal-study-title">Study title</Label>
            <Input
              id="pascal-study-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Island placement"
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <OverviewNoteEditor onChange={setDescription} />
          </div>
        </div>
        <DialogFooter showCloseButton>
          <Button disabled={saving || !title.trim()} onClick={() => void submit()}>
            {saving ? <Loader2 className="animate-spin" /> : <Plus />} Create study
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateVariantDialog({
  study,
  onOpenChange,
  variants,
  onCreated,
}: {
  study: Study | null;
  onOpenChange: (open: boolean) => void;
  variants: Variant[];
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"base" | "branch">("base");
  const [parentId, setParentId] = useState("");
  const [intent, setIntent] = useState("");
  const [saving, setSaving] = useState(false);
  const choices = variants.filter(
    (variant) => variant.studyId === study?.id && variant.status !== "archived",
  );
  const submit = async () => {
    if (!study || !name.trim() || (mode === "branch" && !parentId)) return;
    setSaving(true);
    try {
      const result = await api<{ generation: { intentApplied?: number } }>(
        `/api/pascal/v1/studies/${encodeURIComponent(study.id)}/variants`,
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            fromVariantId: mode === "branch" ? parentId : undefined,
            intent: intent.trim() || undefined,
          }),
        },
      );
      toast.success(
        result.generation.intentApplied
          ? `Variant created with ${result.generation.intentApplied} AI edits`
          : "Variant created",
      );
      onOpenChange(false);
      setName("");
      setMode("base");
      setParentId("");
      setIntent("");
      await onCreated();
    } catch (cause) {
      console.error("[PascalLayoutStudio] generate variant failed", cause);
      toast.error(cause instanceof Error ? cause.message : "Could not generate variant");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={Boolean(study)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New variant</DialogTitle>
          <DialogDescription>
            Measured dimensions stay authoritative; the generated shape remains editable.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pascal-variant-name">Variant name</Label>
            <Input
              id="pascal-variant-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Island centered"
            />
          </div>
          <div className="space-y-2">
            <Label>Starting point</Label>
            <Select
              value={mode}
              onValueChange={(value) => value && setMode(value as "base" | "branch")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base">Measured base</SelectItem>
                <SelectItem value="branch">Existing variant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "branch" ? (
            <div className="space-y-2">
              <Label>Source variant</Label>
              <Select value={parentId} onValueChange={(value) => setParentId(value ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a variant" />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((variant) => (
                    <SelectItem key={variant.id} value={variant.id}>
                      {variant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="pascal-variant-intent">
              Design intent <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="pascal-variant-intent"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              placeholder="Move the island toward the windows while preserving measured clearances."
              rows={4}
            />
          </div>
          <Alert variant="info">
            <Ruler />
            <AlertTitle>Measured starting point</AlertTitle>
            <AlertDescription>
              Rooms are placed at measured sizes. Refine walls and openings in Pascal.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter showCloseButton>
          <Button
            disabled={saving || !name.trim() || (mode === "branch" && !parentId)}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VariantCard({
  variant,
  selected,
  onSelected,
  onChanged,
}: {
  variant: Variant;
  selected: boolean;
  onSelected: (checked: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [capturing, setCapturing] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(variant.name);
  const [renaming, setRenaming] = useState(false);
  const capture = async () => {
    setCapturing(true);
    try {
      await api(`/api/pascal/v1/scenes/${encodeURIComponent(variant.id)}/capture`, {
        method: "POST",
        body: JSON.stringify({ setAsThumbnail: true }),
      });
      toast.success("Snapshot captured");
      await onChanged();
    } catch (cause) {
      console.error("[PascalLayoutStudio] capture failed", cause);
      toast.error(cause instanceof Error ? cause.message : "Could not capture the scene");
    } finally {
      setCapturing(false);
    }
  };
  const setStatus = async (status: VariantStatus) => {
    setStatusBusy(true);
    try {
      await api(`/api/pascal/v1/scenes/${encodeURIComponent(variant.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      toast.success(status === "archived" ? "Variant archived" : "Variant restored");
      await onChanged();
    } catch (cause) {
      console.error("[PascalLayoutStudio] status update failed", cause);
      toast.error(cause instanceof Error ? cause.message : "Could not update the variant");
    } finally {
      setStatusBusy(false);
    }
  };
  const rename = async () => {
    const name = renameValue.trim();
    if (!name || name === variant.name) {
      setRenameOpen(false);
      return;
    }
    setRenaming(true);
    try {
      await api(`/api/pascal/v1/scenes/${encodeURIComponent(variant.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name, expectedVersion: variant.version }),
      });
      toast.success("Variant renamed");
      setRenameOpen(false);
      await onChanged();
    } catch (cause) {
      console.error("[PascalLayoutStudio] rename failed", cause);
      toast.error(cause instanceof Error ? cause.message : "Could not rename the variant");
    } finally {
      setRenaming(false);
    }
  };
  const dimensionSummary = variant.measurements.slice(0, 3);
  return (
    <Card className={cn("relative", selected && "ring-2 ring-primary/60")}>
      <label className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs shadow-sm backdrop-blur">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelected(Boolean(checked))}
          aria-label={`Select ${variant.name} for comparison`}
        />{" "}
        Compare
      </label>
      {variant.thumbnailUrl ? (
        <img
          src={variant.thumbnailUrl}
          alt={`Snapshot of ${variant.name}`}
          className="aspect-[16/9] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[16/9] items-center justify-center bg-muted/35">
          <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden="true" />
        </div>
      )}
      <CardHeader>
        <CardTitle>{variant.name}</CardTitle>
        <CardDescription>
          Version {variant.version} · {variant.nodeCount} nodes
        </CardDescription>
        <CardAction>
          <Badge variant={statusVariant(variant.status)}>{variant.status}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {dimensionSummary.length ? (
          <div className="flex flex-wrap gap-1.5">
            {dimensionSummary.map((measurement, index) => (
              <Badge key={`${measurement.measurementId ?? index}`} variant="outline">
                {measurement.kind ?? "measurement"}: {measurement.value ?? "—"}
                {measurement.unit ?? ""}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No measurement evidence attached.</p>
        )}
        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md py-1 text-left text-xs text-muted-foreground hover:text-foreground">
            Provenance <ChevronDown className="size-3.5" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2 text-xs text-muted-foreground">
            <p>
              Confidence:{" "}
              {variant.confidence == null
                ? "Not recorded"
                : `${Math.round(variant.confidence * 100)}%`}
            </p>
            <p>Parent: {variant.parentSceneId ?? "Measured base"}</p>
            <p>Updated {formatDate(variant.updatedAt)}</p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          size="sm"
          render={
            <a
              href={variant.editorUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${variant.name} in Pascal`}
            />
          }
        >
          <ExternalLink /> Open editor
        </Button>
        <Button size="sm" variant="outline" disabled={capturing} onClick={() => void capture()}>
          {capturing ? <Loader2 className="animate-spin" /> : <Camera />} Snapshot
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
            <MoreHorizontal /> More
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setRenameValue(variant.name);
                setRenameOpen(true);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={statusBusy}
              variant={variant.status === "archived" ? "default" : "destructive"}
              onClick={() =>
                void setStatus(variant.status === "archived" ? "active" : "archived")
              }
            >
              {statusBusy ? <Loader2 className="animate-spin" /> : null}
              {variant.status === "archived" ? "Restore" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename layout variant</DialogTitle>
            <DialogDescription>
              The scene data and Pascal editor link stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`pascal-rename-${variant.id}`}>Variant name</Label>
            <Input
              id={`pascal-rename-${variant.id}`}
              value={renameValue}
              maxLength={160}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void rename();
              }}
            />
          </div>
          <DialogFooter showCloseButton>
            <Button
              disabled={renaming || !renameValue.trim() || renameValue.trim() === variant.name}
              onClick={() => void rename()}
            >
              {renaming ? <Loader2 className="animate-spin" /> : null} Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ComparisonDialog({
  variants,
  onOpenChange,
}: {
  variants: Variant[] | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(variants)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Compare layout variants</DialogTitle>
          <DialogDescription>
            Review the latest image, dimensions, lineage, and confidence together.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(variants ?? []).map((variant) => (
            <Card key={variant.id} size="sm">
              {variant.thumbnailUrl ? (
                <img
                  src={variant.thumbnailUrl}
                  alt={`Snapshot of ${variant.name}`}
                  className="aspect-[16/9] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[16/9] items-center justify-center bg-muted/35">
                  <ImageIcon className="size-7 text-muted-foreground" />
                </div>
              )}
              <CardHeader>
                <CardTitle>{variant.name}</CardTitle>
                <CardDescription>
                  Version {variant.version} · {variant.nodeCount} nodes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>
                  Confidence:{" "}
                  {variant.confidence == null
                    ? "Not recorded"
                    : `${Math.round(variant.confidence * 100)}%`}
                </p>
                <p>Lineage: {variant.parentSceneId ?? "Measured base"}</p>
                {variant.measurements.slice(0, 5).map((measurement, index) => (
                  <p key={`${measurement.measurementId ?? index}`}>
                    {measurement.kind ?? "Measurement"}: {measurement.value ?? "—"}
                    {measurement.unit ?? ""}
                  </p>
                ))}
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant="outline"
                  render={
                    <a
                      href={variant.editorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${variant.name} in Pascal`}
                    />
                  }
                >
                  <ExternalLink /> Open editor
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
