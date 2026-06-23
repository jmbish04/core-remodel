import { CheckCircle2, Circle, Loader2, GitPullRequest, ExternalLink } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownProse } from "@/components/research/MarkdownProse";
// Single source of truth: the canonical implementation plan markdown.
import planMarkdown from "../../../../docs/0008_design_ai_implementation/showroom-planner-implementation-plan.md?raw";

type PhaseStatus = "done" | "active" | "queued";

interface PhaseTask {
  label: string;
  done: boolean;
}

interface Phase {
  id: string;
  title: string;
  status: PhaseStatus;
  prUrl?: string;
  tasks: PhaseTask[];
}

// Kept current as each phase lands (status + per-task done + merged PR link).
const PHASES: Phase[] = [
  {
    id: "0",
    title: "Phase 0 — Scaffolding, progress tracker, deep-research restore",
    status: "done",
    prUrl: "https://github.com/jmbish04/core-remodel/pull/35",
    tasks: [
      { label: "Restore the deep-research route to render SourcingResearchApp", done: true },
      { label: "Per-page TASK placeholders (phase badge + tasks)", done: true },
      { label: "Live Build Progress page (checklist + plan markdown)", done: true },
      { label: "Save canonical plan markdown under docs/0008", done: true },
    ],
  },
  {
    id: "1",
    title: "Phase 1 — Materials Schedule (backend + frontend)",
    status: "done",
    prUrl: "https://github.com/jmbish04/core-remodel/pull/36",
    tasks: [
      { label: "Drizzle material_schedule_items + material_required_specs", done: true },
      { label: "Nullable materialId FK on showroom_store_products", done: true },
      { label: "/api/materials routes (CRUD, specs, /match)", done: true },
      { label: "MaterialsScheduleApp dashboard + schedule.astro", done: true },
    ],
  },
  {
    id: "2",
    title: "Phase 2 — Gap-intelligence engine (keystone)",
    status: "done",
    prUrl: "https://github.com/jmbish04/core-remodel/pull/37",
    tasks: [
      { label: "showroom_gaps schema + lifecycle", done: true },
      { label: "Workers-AI gap detection (analyze, upsert by gapKey)", done: true },
      { label: "Dismiss (never resurface) + research hand-off endpoints", done: true },
      { label: "Shared GapPanel (on Materials now; Products/Showrooms in Phase 3)", done: true },
    ],
  },
  {
    id: "3",
    title: "Phase 3 — Showrooms directory + Products catalog",
    status: "active",
    tasks: [
      { label: "Showrooms directory + Bay-Area hub map + GapPanel", done: true },
      { label: "discover-from-materials via showroom GapPanel", done: true },
      { label: "Products catalog grid + /catalog/products endpoint", done: true },
      { label: "Retire ShowroomDashboard (thin launcher at /admin/showroom)", done: true },
    ],
  },
  {
    id: "4",
    title: "Phase 4 — Detail viewports (store / product / material)",
    status: "queued",
    tasks: [
      { label: "Store + product viewports (reuse research context)", done: false },
      { label: "Material viewport (/api/materials/:id)", done: false },
    ],
  },
  {
    id: "5",
    title: "Phase 5 — Compare",
    status: "queued",
    tasks: [
      { label: "Compare endpoints over similar-map tables", done: false },
      { label: "Side-by-side matrix + shareable link + decide", done: false },
    ],
  },
  {
    id: "6",
    title: "Phase 6 — Deep Research portal + Engine A",
    status: "queued",
    tasks: [
      { label: "Typed launcher + engine selector", done: false },
      { label: "Findings markdown tab (R2)", done: false },
      { label: "Interactive visualizer (R2) + mindmap", done: false },
      { label: "Assistant-UI chat (D1 + Vectorize tools, suggestions)", done: false },
    ],
  },
  {
    id: "7",
    title: "Phase 7 — Engine B: self-hosted Deep Research on Cloudflare Agents",
    status: "queued",
    tasks: [
      { label: "DeepResearchAgent 6-agent loop", done: false },
      { label: "Config (tone, depth, iterations, breadth, model)", done: false },
      { label: "Same parse path → D1 / Vectorize / R2 as Engine A", done: false },
    ],
  },
  {
    id: "8",
    title: "Phase 8 — Field Scan bulk capture",
    status: "queued",
    tasks: [
      { label: "Offline-first per-product photo-group capture", done: false },
      { label: "Bulk research → Workers-AI parse → HITL populate", done: false },
      { label: "scan/batch-sync endpoint", done: false },
    ],
  },
];

function StatusBadge({ status }: { status: PhaseStatus }) {
  if (status === "done") {
    return (
      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 font-mono uppercase tracking-widest">
        Done
      </Badge>
    );
  }
  if (status === "active") {
    return (
      <Badge variant="secondary" className="bg-amber-500/10 text-amber-400 font-mono uppercase tracking-widest">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> In progress
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-mono uppercase tracking-widest text-muted-foreground">
      Queued
    </Badge>
  );
}

export function PlannerProgressApp() {
  const doneCount = PHASES.filter((p) => p.status === "done").length;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Showroom Planner — Build Progress</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live tracker for the phased build-out. {doneCount} of {PHASES.length} phases complete.
        </p>
      </div>

      <Tabs defaultValue="phases">
        <TabsList>
          <TabsTrigger value="phases">Phases</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
        </TabsList>

        <TabsContent value="phases" className="mt-4 space-y-3">
          {PHASES.map((phase) => (
            <Card key={phase.id} className={phase.status === "active" ? "ring-1 ring-amber-500/30" : undefined}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{phase.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    {phase.prUrl ? (
                      <a
                        href={phase.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
                      >
                        <GitPullRequest className="h-3.5 w-3.5" /> PR <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                    <StatusBadge status={phase.status} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {phase.tasks.map((task, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {task.done ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
                      )}
                      <span className={task.done ? "text-foreground" : "text-muted-foreground"}>{task.label}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="plan" className="mt-4">
          <Card>
            <CardContent className="py-6">
              <MarkdownProse>{planMarkdown}</MarkdownProse>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
