/**
 * @fileoverview NewResearchDialog — the INITIATE surface of the research console.
 *
 * A template picker fronting `POST /api/research-jobs`. Seven templates in three
 * families:
 *   TARGETED  (showroom / brand / product) → search-select an existing entity →
 *             POST { kind, entityId }.
 *   DISCOVERY (discovery_showrooms / _brands / _products) → a criteria textarea →
 *             POST { kind, criteria }.
 *   CUSTOM    → a free prompt textarea → POST { kind: "custom", criteria }.
 *
 * On 202 the backend returns `{ jobId }` → we navigate to the job viewport.
 * The showroom-targeted path instead returns `{ queued: true }` with no jobId
 * (it fans out through a queue); there we toast "Research started" and let the
 * new row surface on the list via polling.
 *
 * Monolith dark conventions: shadcn Dialog (never window.confirm), bg-card +
 * ring-1 ring-border/40, sonner + console on catch, disable-while-in-flight.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Compass,
  Loader2,
  Package,
  Sparkles,
  Store,
  Tag,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { EntitySearchSelect, type EntityCatalog, type EntityHit } from "./EntitySearchSelect";
import { postJson, type ResearchKind } from "./types";

// ─── Template catalog ───────────────────────────────────────────────────────────

type TemplateFamily = "targeted" | "discovery" | "custom";

interface Template {
  kind: ResearchKind;
  family: TemplateFamily;
  title: string;
  blurb: string;
  icon: React.ReactNode;
  /** For targeted templates — which entity catalog to search. */
  catalog?: EntityCatalog;
  /** For discovery/custom templates — the criteria placeholder. */
  placeholder?: string;
}

const TEMPLATES: Template[] = [
  {
    kind: "showroom",
    family: "targeted",
    title: "Research a showroom",
    blurb: "Deep-research an existing showroom — hours, brands carried, reputation.",
    icon: <Store className="size-4" />,
    catalog: "showroom",
  },
  {
    kind: "brand",
    family: "targeted",
    title: "Research a brand",
    blurb: "Profile a brand — catalog, positioning, where to buy locally.",
    icon: <Tag className="size-4" />,
    catalog: "brand",
  },
  {
    kind: "product",
    family: "targeted",
    title: "Research a product",
    blurb: "Dig into a product — specs, alternatives, pricing, availability.",
    icon: <Package className="size-4" />,
    catalog: "product",
  },
  {
    kind: "discovery_showrooms",
    family: "discovery",
    title: "Discover showrooms",
    blurb: "Find new showrooms matching your criteria.",
    icon: <Compass className="size-4" />,
    placeholder:
      "e.g. tile showrooms on the Peninsula that carry Zellige and are open weekends",
  },
  {
    kind: "discovery_brands",
    family: "discovery",
    title: "Discover brands",
    blurb: "Surface brands matching a style, price point, or category.",
    icon: <Compass className="size-4" />,
    placeholder: "e.g. mid-priced unlacquered-brass faucet brands with a warm finish",
  },
  {
    kind: "discovery_products",
    family: "discovery",
    title: "Discover products",
    blurb: "Find products matching a spec — you'll pick the showroom on intake.",
    icon: <Compass className="size-4" />,
    placeholder: "e.g. 30-inch integrated panel-ready refrigerators under $4k",
  },
  {
    kind: "custom",
    family: "custom",
    title: "Custom research",
    blurb: "Free-form — describe exactly what you want researched.",
    icon: <Wand2 className="size-4" />,
    placeholder: "Describe the research question in your own words…",
  },
];

// ─── Template card ──────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onPick,
}: {
  template: Template;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex items-start gap-3 rounded-xl bg-card p-4 text-left ring-1 ring-border/40 transition-all hover:ring-primary/40"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors group-hover:text-foreground">
        {template.icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight">{template.title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{template.blurb}</p>
      </div>
    </button>
  );
}

// ─── Dialog ─────────────────────────────────────────────────────────────────────

export function NewResearchDialog({
  open,
  onOpenChange,
  onQueued,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Fired after a showroom-targeted job is queued (no jobId) so the list refreshes. */
  onQueued?: () => void;
}) {
  const [picked, setPicked] = useState<Template | null>(null);
  const [entity, setEntity] = useState<EntityHit | null>(null);
  const [criteria, setCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset the whole flow whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setPicked(null);
      setEntity(null);
      setCriteria("");
      setSubmitting(false);
    }
  }, [open]);

  const back = useCallback(() => {
    setPicked(null);
    setEntity(null);
    setCriteria("");
  }, []);

  const canSubmit = useMemo(() => {
    if (!picked || submitting) return false;
    if (picked.family === "targeted") return entity != null;
    return criteria.trim().length > 0;
  }, [picked, submitting, entity, criteria]);

  const submit = useCallback(async () => {
    if (!picked || !canSubmit) return;
    setSubmitting(true);
    try {
      const body: {
        kind: ResearchKind;
        entityId?: number;
        criteria?: string;
      } =
        picked.family === "targeted"
          ? { kind: picked.kind, entityId: entity!.id }
          : { kind: picked.kind, criteria: criteria.trim() };

      const resp = await postJson<{ jobId?: number; queued?: boolean }>(
        "/api/research-jobs",
        body,
      );

      if (resp.jobId != null) {
        // Navigate straight into the live viewport for the new job.
        window.location.assign(`/admin/shopping/research/${resp.jobId}`);
        return;
      }

      // Showroom-targeted fan-out returns { queued: true } with no jobId — the
      // row appears on the list within seconds via polling.
      toast.success("Research started");
      onOpenChange(false);
      onQueued?.();
    } catch (e) {
      console.error("[research/create]", e);
      toast.error(e instanceof Error ? e.message : "Failed to start research");
    } finally {
      setSubmitting(false);
    }
  }, [picked, canSubmit, entity, criteria, onOpenChange, onQueued]);

  return (
    <Dialog open={open} onOpenChange={(o) => (submitting ? undefined : onOpenChange(o))}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {picked ? picked.title : "New research"}
          </DialogTitle>
          <DialogDescription>
            {picked
              ? picked.blurb
              : "Pick a template to launch a research job. It runs in the background and streams progress live."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: template grid ── */}
        {!picked ? (
          <div className="mt-2 grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <TemplateCard
                key={t.kind}
                template={t}
                onPick={() => {
                  setPicked(t);
                  setEntity(null);
                  setCriteria("");
                }}
              />
            ))}
          </div>
        ) : (
          // ── Step 2: template-specific form ──
          <div className="mt-2 space-y-4">
            {picked.family === "targeted" ? (
              <EntitySearchSelect
                catalog={picked.catalog!}
                value={entity}
                onChange={setEntity}
                label="Target"
                disabled={submitting}
                autoFocus
              />
            ) : (
              <div className="space-y-1">
                <Label htmlFor="research-criteria">
                  {picked.family === "custom" ? "Prompt" : "Criteria"}
                </Label>
                <Textarea
                  id="research-criteria"
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  placeholder={picked.placeholder}
                  rows={5}
                  disabled={submitting}
                  autoFocus
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={back} disabled={submitting}>
                Back
              </Button>
              <Button size="sm" onClick={() => void submit()} disabled={!canSubmit}>
                {submitting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                Start research
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
