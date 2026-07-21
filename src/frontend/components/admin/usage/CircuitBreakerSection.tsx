/**
 * @fileoverview Circuit-breaker section — status + clear for the global Durable
 * Object circuit breaker (services/safety/do-circuit-breaker.ts). When an
 * alarm-bearing DO detects a runaway (the #162 signature), it trips this breaker
 * and hard-stops; this panel shows the tripped reason and lets an admin clear it
 * once the cause is understood. Self-fetches GET /api/admin/integrations/circuit-breaker.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchJson,
  RefreshButton,
  SectionError,
  SectionHeader,
  SectionLoading,
} from "./shared";

interface BreakerState {
  tripped: boolean;
  reason?: string;
  doName?: string;
  at?: number;
}

function formatWhen(at?: number): string | null {
  if (!at) return null;
  try {
    return new Date(at).toLocaleString();
  } catch {
    return null;
  }
}

export function CircuitBreakerSection() {
  const [data, setData] = useState<BreakerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchJson<BreakerState>("/api/admin/integrations/circuit-breaker"));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load breaker state";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clear = useCallback(async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/admin/integrations/circuit-breaker/clear", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((payload.error as string) ?? `Clear failed (${res.status})`);
      }
      toast.success("Circuit breaker cleared — alarm DOs may resume.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear breaker");
    } finally {
      setClearing(false);
    }
  }, [load]);

  const when = formatWhen(data?.at);

  return (
    <div>
      <SectionHeader
        title="Durable Object safety"
        description="Runaway-alarm circuit breaker. Trips to a hard stop before billing runs away."
        actions={<RefreshButton loading={loading} onClick={load} />}
      />

      {loading ? (
        <SectionLoading />
      ) : error ? (
        <SectionError title="Couldn't load breaker state" message={error} onRetry={load} />
      ) : data ? (
        <Card className={data.tripped ? "ring-1 ring-destructive/40" : "ring-1 ring-emerald-500/30"}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-sm">Circuit breaker</CardTitle>
              {data.tripped ? (
                <Badge className="gap-1 bg-destructive/15 text-destructive ring-1 ring-destructive/30">
                  <ShieldAlert className="size-3" />
                  Tripped
                </Badge>
              ) : (
                <Badge className="gap-1 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">
                  <ShieldCheck className="size-3" />
                  Healthy
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.tripped ? (
              <>
                <p className="text-sm text-foreground">
                  Alarm-bearing Durable Objects are <span className="font-medium">halted</span>. They
                  deleted their alarm and will refuse to run until this is cleared — deliberate
                  downtime to stop runaway billing.
                </p>
                <dl className="space-y-1 text-xs">
                  {data.doName ? (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Tripped by</dt>
                      <dd className="font-mono text-foreground">{data.doName}</dd>
                    </div>
                  ) : null}
                  {data.reason ? (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Reason</dt>
                      <dd className="text-foreground">{data.reason}</dd>
                    </div>
                  ) : null}
                  {when ? (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">When</dt>
                      <dd className="text-foreground">{when}</dd>
                    </div>
                  ) : null}
                </dl>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={clear}
                  disabled={clearing}
                  className="gap-1.5"
                >
                  <ShieldCheck className="size-3.5" />
                  {clearing ? "Clearing…" : "Clear breaker & resume"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No runaway detected. Alarm-bearing DOs run normally.
                {when ? ` Last change ${when}.` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
