/**
 * @fileoverview Workflow 1 — Prompt Staging Card.
 *
 * Drafts an AI research prompt for a product (via the draft-prompt endpoint),
 * lets the homeowner edit it, choose quick vs deep mode + source budget + the
 * MCP bridge, then launches a deep sweep against the selected target (product
 * or whole showroom). On completion it bubbles the sweep result counts up so
 * the parent can refresh the ledger and galleries.
 *
 * Wired to:
 *   POST /api/showroom-stores/products/:pid/research/draft-prompt   (draft)
 *   POST /api/showroom-stores/products/:pid/research/deep-sweep     (product)
 *   POST /api/showroom-stores/:id/research/deep-sweep               (store)
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  Radar,
  Sparkles,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { draftProductPrompt, sweepProduct, sweepStore } from "./api";
import type { ResearchMode, SweepResult, SweepTarget } from "./types";

interface PromptStagingCardProps {
  target: SweepTarget;
  targetLabel: string;
  /** Called with the sweep result so the parent can refresh context. */
  onSwept: (result: SweepResult) => void;
  /** Mirrors the in-flight state up so galleries can show "Scraping…". */
  onSweepingChange: (sweeping: boolean) => void;
}

const MODE_OPTIONS: { value: ResearchMode; label: string; hint: string; icon: typeof Zap }[] = [
  { value: "quick", label: "Quick", hint: "Citation sweep · ~30s", icon: Zap },
  { value: "deep", label: "Deep", hint: "Gemini deep research · up to 4m", icon: Radar },
];

export function PromptStagingCard(props: PromptStagingCardProps) {
  const { target, targetLabel, onSwept, onSweepingChange } = props;

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ResearchMode>("quick");
  const [maxSources, setMaxSources] = useState(5);
  const [enableMcpBridge, setEnableMcpBridge] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [lastResult, setLastResult] = useState<SweepResult | null>(null);

  const isProduct = target.kind === "product";

  async function handleDraft() {
    if (!isProduct) return;
    setDrafting(true);
    const result = await draftProductPrompt(target.productId);
    setDrafting(false);
    if (!result.ok) {
      toast.error(`Draft failed: ${result.error}`);
      return;
    }
    setPrompt(result.data);
    toast.success("Draft prompt staged — review and edit before launching.");
  }

  async function handleLaunch() {
    setSweeping(true);
    onSweepingChange(true);
    const opts = {
      prompt,
      maxSources,
      researchMode: mode,
      enableMcpBridge: mode === "deep" ? enableMcpBridge : false,
      deepResearchWaitMs: mode === "deep" ? 120_000 : undefined,
    };
    const result = isProduct
      ? await sweepProduct(target.productId, opts)
      : await sweepStore(target.storeId, opts);
    setSweeping(false);
    onSweepingChange(false);

    if (!result.ok) {
      toast.error(`Sweep failed: ${result.error}`);
      return;
    }
    setLastResult(result.data);
    onSwept(result.data);
    const r = result.data;
    toast.success(
      `Sweep complete · ${r.findingsWritten} findings · ${r.imagesWritten} images · ${r.specsWritten} specs`,
    );
  }

  return (
    <Card className="ring-1 ring-border/40">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-violet-400" />
              Prompt staging
            </CardTitle>
            <CardDescription>
              Stage a research brief for{" "}
              <span className="text-foreground">{targetLabel}</span>, then launch a sweep.
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase tracking-wider">
            {isProduct ? "Product" : "Showroom"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Draft + textarea */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="sourcing-prompt" className="text-xs uppercase tracking-wider text-muted-foreground">
              Research prompt
            </Label>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={handleDraft}
              disabled={!isProduct || drafting || sweeping}
              title={isProduct ? "Generate a draft from live product data" : "Draft prompt is product-scoped"}
            >
              {drafting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileText className="size-3.5" />
              )}
              {isProduct ? "Draft from data" : "Product only"}
            </Button>
          </div>
          <Textarea
            id="sourcing-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              isProduct
                ? "Click “Draft from data”, or write your own brief — e.g. warranty terms, lead times, and comparable Bay Area sources for this product."
                : "Optional brief for this showroom sweep — e.g. reputation, return policy, delivery reliability, current storefront imagery."
            }
            className="min-h-28 resize-y text-sm leading-relaxed"
          />
        </div>

        {/* Mode toggle */}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Research mode</Label>
          <div className="grid grid-cols-2 gap-2">
            {MODE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  disabled={sweeping}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-lg p-3 text-left transition ring-1",
                    active
                      ? "bg-violet-500/10 ring-violet-500/40"
                      : "bg-card ring-border/40 hover:ring-border",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className={cn("size-3.5", active ? "text-violet-300" : "text-muted-foreground")} />
                    {opt.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Source budget + MCP bridge */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="sourcing-maxsources" className="text-xs text-muted-foreground">
              Max sources
            </Label>
            <Input
              id="sourcing-maxsources"
              type="number"
              min={1}
              max={10}
              value={maxSources}
              onChange={(e) =>
                setMaxSources(Math.min(10, Math.max(1, Number(e.target.value) || 1)))
              }
              className="h-8 w-16"
              disabled={sweeping}
            />
          </div>
          <div
            className={cn(
              "flex items-center gap-2 text-xs",
              mode === "deep" ? "text-foreground" : "text-muted-foreground/60",
            )}
          >
            <Switch
              id="sourcing-mcp-bridge"
              checked={enableMcpBridge}
              onCheckedChange={setEnableMcpBridge}
              disabled={mode !== "deep" || sweeping}
            />
            <Label htmlFor="sourcing-mcp-bridge" className="text-xs font-normal">
              MCP bridge <span className="text-muted-foreground">(deep only)</span>
            </Label>
          </div>
        </div>

        {lastResult ? (
          <div className="rounded-lg bg-muted/20 p-3 text-xs ring-1 ring-border/40">
            <span className="font-mono uppercase tracking-wider text-muted-foreground">Last sweep</span>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>{lastResult.citationsFound} citations</span>
              <span>{lastResult.sourcesProcessed} sources</span>
              <span className="text-foreground">{lastResult.findingsWritten} findings</span>
              <span className="text-foreground">{lastResult.imagesWritten} images</span>
              <span className="text-foreground">{lastResult.specsWritten} specs</span>
              <span>{lastResult.vectorsWritten} vectors</span>
            </div>
            {lastResult.warnings.length > 0 ? (
              <p className="mt-1.5 text-amber-400/90">{lastResult.warnings.join(" · ")}</p>
            ) : null}
          </div>
        ) : null}

        <Button
          type="button"
          onClick={handleLaunch}
          disabled={sweeping}
          className="w-full bg-violet-500 text-violet-50 hover:bg-violet-500/90"
        >
          {sweeping ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {mode === "deep" ? "Running deep sweep…" : "Sweeping…"}
            </>
          ) : (
            <>
              <Radar className="size-4" />
              Launch {mode === "deep" ? "deep" : "quick"} sweep
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
