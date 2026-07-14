/**
 * @fileoverview AI Gateway usage section — request analytics for everything
 * routed THROUGH the gateway (Workers AI, Replicate, Fal, …), from
 * GET /api/admin/integrations/ai-gateway. Gemini is NOT here (it bypasses the
 * gateway — see the Gemini tab).
 *
 * The backend is best-effort: when analytics is unauthorized/unreachable it
 * returns { available: false, reason }. This section renders that reason in an
 * informative panel rather than an error, so the page never looks broken.
 */

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  fetchJson,
  formatMonth,
  nf,
  RefreshButton,
  SectionError,
  SectionHeader,
  SectionLoading,
  StatCard,
} from "./shared";

interface AiGatewayModel {
  model: string;
  provider: string | null;
  requests: number;
}

interface AiGatewayUsageResponse {
  available: boolean;
  reason?: string;
  gatewayId: string;
  month: string;
  totalRequests: number;
  cachedRequests: number;
  erroredRequests: number;
  byModel: AiGatewayModel[];
}

export function AiGatewayUsageSection() {
  const [data, setData] = useState<AiGatewayUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchJson<AiGatewayUsageResponse>("/api/admin/integrations/ai-gateway"));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load AI Gateway usage";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cacheRate =
    data && data.totalRequests > 0
      ? (data.cachedRequests / data.totalRequests) * 100
      : 0;
  const errorRate =
    data && data.totalRequests > 0
      ? (data.erroredRequests / data.totalRequests) * 100
      : 0;

  return (
    <div>
      <SectionHeader
        title="AI Gateway"
        description="Requests routed through the gateway — Workers AI, Replicate, Fal (not Gemini)."
        actions={
          <>
            {data?.gatewayId && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {data.gatewayId}
              </Badge>
            )}
            <RefreshButton loading={loading} onClick={load} />
          </>
        }
      />

      {loading ? (
        <SectionLoading />
      ) : error ? (
        <SectionError title="Couldn't load AI Gateway usage" message={error} onRetry={load} />
      ) : data && !data.available ? (
        // Graceful "unavailable" panel — surfaces the real reason so it's actionable.
        <Card className="ring-1 ring-amber-500/30">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-amber-500/10 text-amber-300">
              <Info className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                AI Gateway analytics unavailable
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {data.reason ?? "The analytics API could not be reached."}
              </p>
              <p className="mx-auto mt-2 max-w-md text-[11px] text-muted-foreground/70">
                Requires a Cloudflare API token with <span className="font-mono">Account Analytics: Read</span>.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Requests" value={nf.format(data.totalRequests)} sub={formatMonth(data.month)} />
            <StatCard
              label="Cache hits"
              value={`${cacheRate.toFixed(0)}%`}
              sub={`${nf.format(data.cachedRequests)} cached`}
            />
            <StatCard
              label="Errors"
              value={`${errorRate.toFixed(1)}%`}
              sub={`${nf.format(data.erroredRequests)} failed`}
              tone={errorRate > 5 ? "warn" : "default"}
            />
            <StatCard label="Models" value={nf.format(data.byModel.length)} sub="distinct this month" />
          </div>

          {/* Partial-data note when only totals came back */}
          {data.reason && (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              {data.reason}
            </p>
          )}

          {data.byModel.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Requests by model</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border/40">
                  {data.byModel.map((m) => (
                    <li
                      key={`${m.provider ?? ""}:${m.model}`}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-mono text-xs text-foreground">{m.model}</span>
                        {m.provider ? (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                            {m.provider}
                          </span>
                        ) : null}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {nf.format(m.requests)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : (
            <div className="flex min-h-[100px] items-center justify-center text-sm text-muted-foreground">
              No gateway requests recorded this month.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
