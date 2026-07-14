/**
 * @fileoverview 0017 — MCP Ops overview KPI strip.
 *
 * A row of six count cards (sessions / tool calls / errors / open bugs / open
 * features / conversations) pulled from `/api/mcp-ops/overview`. Owns its own
 * loading + error lifecycle and renders above the tab strip so operators get an
 * at-a-glance health read regardless of which tab is active.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { apiGet, ErrorState, type Overview } from "./shared";

export function OverviewCards() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<Overview>("/api/mcp-ops/overview"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kpis: { label: string; value: number | undefined }[] = [
    { label: "Sessions", value: data?.sessions },
    { label: "Tool calls", value: data?.toolCalls },
    { label: "Errors", value: data?.errors },
    { label: "Open bugs", value: data?.openBugs },
    { label: "Open features", value: data?.openFeatures },
    { label: "Conversations", value: data?.conversations },
  ];

  if (error) {
    return (
      <div className="mb-6">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {kpis.map((k) => (
        <Card key={k.label} className="gap-1 py-4">
          <CardHeader className="px-4">
            <CardDescription className="text-xs">{k.label}</CardDescription>
          </CardHeader>
          <CardContent className="px-4">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {(k.value ?? 0).toLocaleString()}
              </span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
