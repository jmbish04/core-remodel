import { ArrowUpRight, Loader2, Sparkles, ThumbsUp } from "lucide-react";
import React, { useCallback, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, type RoomDetailPayload } from "./types";

/**
 * RoomOptions (T3.4) — full-width section listing the room's known variations.
 *
 * Source: `scenarioPlans` + `visionNodes` from the detail payload.
 *   - When BOTH are empty → a friendly thumbs-up empty state (per the spec's
 *     "easy peezy" copy) so the user knows there is no scope creep here.
 *   - When at least one exists → shadcn `Tabs`:
 *       Tab 1 "Details" (default) = the raw scenario plans + vision nodes.
 *       Tab 2 "✨ AI Quick Summary" = a lazily-fetched simplified summary from
 *       `POST /api/rooms/code/:roomCode/options-summary` → `{ summary }`.
 *
 * The AI summary is fetched on first tab activation and cached in component
 * state for the session (the endpoint does not cache server-side).
 */
export interface RoomOptionsProps {
  roomCode: string;
  detail: RoomDetailPayload;
}

export function RoomOptions({ roomCode, detail }: RoomOptionsProps) {
  const hasScenarioPlans = detail.scenarioPlans.length > 0;
  const hasVisionNodes = detail.visionNodes.length > 0;
  const hasOptions = hasScenarioPlans || hasVisionNodes;

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRequested, setAiRequested] = useState(false);

  const fetchAiSummary = useCallback(async () => {
    if (aiLoading) return;
    setAiRequested(true);
    setAiLoading(true);
    try {
      const response = await fetch(`/api/rooms/code/${roomCode}/options-summary`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        summary?: string;
        error?: { message?: string } | string;
      };
      if (!response.ok || !payload.success || typeof payload.summary !== "string") {
        const message =
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message || "Failed to summarize room options";
        throw new Error(message);
      }
      setAiSummary(payload.summary);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to summarize room options");
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, roomCode]);

  // Lazy-load when the AI tab is first activated.
  const handleTabChange = useCallback(
    (value: unknown) => {
      if (value === "ai" && !aiRequested) {
        void fetchAiSummary();
      }
    },
    [aiRequested, fetchAiSummary],
  );

  return (
    <Card className="ring-1 ring-foreground/10">
      <CardHeader>
        <CardTitle className="text-base">Room Options</CardTitle>
        <CardDescription>
          Scenario plans and vision-node batches that change what happens in this room
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasOptions ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/10 px-6 py-12 text-center ring-1 ring-foreground/10">
            <ThumbsUp className="size-8 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              There are no known variations, scope creep, or potential deviations for this room —
              easy peezy?! 😄
            </p>
          </div>
        ) : (
          <Tabs defaultValue="details" onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="ai">
                <Sparkles className="size-4" />
                AI Quick Summary
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4 pt-4">
              {hasScenarioPlans ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Scenario Plans
                  </p>
                  {detail.scenarioPlans.map((plan) => (
                    <div key={plan.id} className="rounded-xl bg-card/40 p-4 ring-1 ring-foreground/10">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{plan.proposedUse}</p>
                          <p className="text-xs text-muted-foreground">{plan.scenarioName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{plan.stage}</Badge>
                          {typeof plan.estimatedCostCents === "number" ? (
                            <Badge variant="outline">{formatCurrency(plan.estimatedCostCents)}</Badge>
                          ) : null}
                        </div>
                      </div>
                      {plan.notes ? (
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{plan.notes}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {hasVisionNodes ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Vision Nodes
                  </p>
                  {detail.visionNodes.map((node) => (
                    <div key={node.id} className="rounded-xl bg-card/40 p-4 ring-1 ring-foreground/10">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">{node.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {node.nodeType} • {node.status}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{node.childCount} children</Badge>
                          <Badge variant="secondary">{node.supportingDocumentIds.length} docs</Badge>
                          {typeof node.estimatedCostCents === "number" ? (
                            <Badge variant="outline">{formatCurrency(node.estimatedCostCents)}</Badge>
                          ) : null}
                        </div>
                      </div>
                      {node.summary ? (
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{node.summary}</p>
                      ) : null}
                      <a
                        href={`/supporting-docs?roomId=${detail.room.id}&visionNodeId=${node.id}`}
                        className="mt-3 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        View branch in project records
                        <ArrowUpRight className="size-4" />
                      </a>
                    </div>
                  ))}
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="ai" className="pt-4">
              {aiLoading ? (
                <div className="flex items-center gap-3 rounded-2xl bg-muted/10 px-6 py-10 text-sm text-muted-foreground ring-1 ring-foreground/10">
                  <Loader2 className="size-5 animate-spin" />
                  Summarizing this room&apos;s options with Workers AI…
                </div>
              ) : aiSummary ? (
                <div className="space-y-4 rounded-2xl bg-muted/10 p-5 ring-1 ring-foreground/10">
                  <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{aiSummary}</p>
                  <Button variant="ghost" size="sm" onClick={() => void fetchAiSummary()}>
                    <Sparkles className="mr-2 size-4" />
                    Regenerate summary
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/10 px-6 py-10 text-center ring-1 ring-foreground/10">
                  <Sparkles className="size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Generate a simplified, plain-language summary of the options above.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void fetchAiSummary()}>
                    Generate AI summary
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

export default RoomOptions;
