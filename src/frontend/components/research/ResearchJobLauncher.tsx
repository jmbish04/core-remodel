/**
 * @fileoverview ResearchJobLauncher — typed Deep Research job launcher.
 *
 * Lets the homeowner kick off a deep-research session with:
 *   - a TARGET TYPE (showroom / material / product / generic) that frames the
 *     topic for the agent, and
 *   - an ENGINE selector:
 *       • Engine A — Google Gemini Deep Research (default; the existing
 *         /api/admin/research POST → ResearchAgent → sweep/research path)
 *       • Engine B — Self-hosted Deep Research on Cloudflare Agents (Phase 7):
 *         POST /api/admin/research/cf-engine kicks the 6-agent loop on the
 *         DeepResearchAgent DO, writing the SAME research_sessions row + R2
 *         markdown/visualizer + Vectorize as Engine A. The portal's existing
 *         3-tab view consumes the result unchanged; live loop progress is
 *         polled from GET /api/admin/research/cf-engine/:id/status.
 *
 * On a successful launch it calls `onLaunched(sessionId)` so the portal can
 * open the new session's 3-tab view.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TargetType = "showroom" | "material" | "product" | "generic";
type Engine = "gemini" | "self-hosted";

const TARGET_LABELS: Record<TargetType, string> = {
  showroom: "Showroom",
  material: "Material",
  product: "Product",
  generic: "Generic topic",
};

/** Frame the raw topic with target context so the agent plans appropriately. */
function framedTopic(target: TargetType, topic: string): string {
  const t = topic.trim();
  switch (target) {
    case "showroom":
      return `Showroom sourcing research: ${t}`;
    case "material":
      return `Material selection & specification research: ${t}`;
    case "product":
      return `Product comparison & buying research: ${t}`;
    default:
      return t;
  }
}

export function ResearchJobLauncher({
  onLaunched,
}: {
  onLaunched: (sessionId: number) => void;
}) {
  const [target, setTarget] = useState<TargetType>("generic");
  const [engine, setEngine] = useState<Engine>("gemini");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);

  const canLaunch = topic.trim().length >= 5 && !busy;

  async function launch() {
    const finalTopic = framedTopic(target, topic);
    if (finalTopic.length < 5) {
      toast.error("Add a bit more detail to the research topic.");
      return;
    }
    setBusy(true);
    try {
      if (engine === "self-hosted") {
        // Engine B (Phase 7) — self-hosted Cloudflare Agents loop.
        const res = await fetch("/api/admin/research/cf-engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ topic: finalTopic, targetType: target }),
        });
        if (!res.ok) {
          const msg = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(msg?.error || `Engine B failed (${res.status})`);
        }
        const data = (await res.json()) as { sessionId: number };
        toast.success("Self-hosted research launched — the loop is running now.");
        onLaunched(data.sessionId);
        setTopic("");
        return;
      }

      // Engine A — Gemini Deep Research (default path).
      const res = await fetch("/api/admin/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ topic: finalTopic }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg?.error || `Launch failed (${res.status})`);
      }
      const data = (await res.json()) as { sessionId: number };
      toast.success("Deep research launched — review the plan to run it.");
      onLaunched(data.sessionId);
      setTopic("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to launch research");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
      <div className="mb-4 flex items-center gap-2">
        <Rocket className="size-4 text-emerald-400" />
        <h2 className="text-sm font-semibold">Launch deep research</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Target type</span>
          <Select value={target} onValueChange={(v) => setTarget((v as TargetType) ?? "generic")}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TARGET_LABELS) as TargetType[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {TARGET_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Engine</span>
          <Select value={engine} onValueChange={(v) => setEngine((v as Engine) ?? "gemini")}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini">Google Gemini Deep Research (Engine A)</SelectItem>
              <SelectItem value="self-hosted">Self-hosted · Cloudflare Agents (Engine B)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Topic</span>
        <Textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={
            target === "showroom"
              ? "e.g. Bay Area tile & stone showrooms for a modern kitchen backsplash"
              : target === "material"
                ? "e.g. quartz vs. porcelain countertops — durability, cost, fabrication"
                : target === "product"
                  ? "e.g. 36\" induction ranges under $4k with reliable service in SF"
                  : "e.g. permit timeline for a kitchen remodel in San Francisco"
          }
          className="min-h-20 text-sm"
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {engine === "gemini"
            ? "Gemini will draft a plan you review before the run."
            : "Engine B runs the self-hosted 6-agent loop on Cloudflare Agents — live progress streams into the portal."}
        </p>
        <Button size="sm" onClick={launch} disabled={!canLaunch}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
          Launch
        </Button>
      </div>
    </div>
  );
}
