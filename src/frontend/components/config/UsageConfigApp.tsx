/**
 * @fileoverview Usage metering + circuit breaker — config page (`/admin/config/usage`).
 *
 * One row per metered provider: what it has spent this cycle, the ceiling it is
 * measured against, and the three levers — set the threshold, break the glass
 * manually, or snooze by a dollar amount.
 *
 * The spend bar is the point of the page. A number alone does not communicate
 * "you are two thirds of the way to a hard stop"; a bar that turns amber then
 * red does, at a glance, which is what a cost ceiling is for.
 *
 * Wrapped in ConfigShell for the config sidebar. Monolith rules: dark theme,
 * `ring-1 ring-border/40` rather than 1px borders, no window.confirm.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfigShell } from "./ConfigShell";

interface ProviderRow {
  provider: string;
  thresholdUsd: number;
  snoozeToUsd: number | null;
  manualBreak: boolean;
  spendUsd: number;
  ceilingUsd: number;
  allowed: boolean;
  reason: "ok" | "manual_break" | "over_threshold" | "read_error";
}

interface UsagePayload {
  cycleAnchorDay: number;
  cycleStart: string;
  providers: ProviderRow[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Human label for why a provider is blocked. */
function reasonLabel(r: ProviderRow): string | null {
  switch (r.reason) {
    case "manual_break":
      return "Broken manually";
    case "over_threshold":
      return "Over ceiling";
    case "read_error":
      // Fail-closed: the ledger could not be read, so spending is denied.
      return "Ledger unreadable — denying";
    default:
      return null;
  }
}

export function UsageConfigApp() {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<ProviderRow | null>(null);
  const [snoozeAmount, setSnoozeAmount] = useState("10");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/usage", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as UsagePayload);
    } catch (err) {
      toast.error(`Could not load usage: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setBusy(label);
      try {
        const res = await fetch("/api/config/usage", {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success("Saved");
        await load();
      } catch (err) {
        toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  return (
    <ConfigShell
      activeHref="/admin/config/usage"
      title="Usage & Cost Ceilings"
      description="What each provider has spent this billing cycle, and the brake that stops it."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading usage…
        </div>
      ) : !data ? (
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" /> Usage unavailable.
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Billing cycle ─────────────────────────────────────────────── */}
          <Card className="ring-1 ring-border/40">
            <CardHeader>
              <CardTitle className="text-base">Billing cycle</CardTitle>
              <CardDescription>
                Spend is summed from the anchor day, not the calendar month — a real cycle
                rarely starts on the 1st. Clamped to 1–28 so the anchor exists every month.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="anchor">Cycle starts on day</Label>
                <Input
                  id="anchor"
                  type="number"
                  min={1}
                  max={28}
                  className="w-28 bg-background"
                  defaultValue={data.cycleAnchorDay}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== data.cycleAnchorDay && v >= 1 && v <= 28) {
                      void patch({ cycleAnchorDay: v }, "anchor");
                    }
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Current cycle began{" "}
                <span className="text-foreground">
                  {new Date(data.cycleStart).toLocaleDateString()}
                </span>
              </p>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => void load()}
                disabled={busy !== null}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
            </CardContent>
          </Card>

          {/* ── Per-provider ──────────────────────────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-2">
            {data.providers.map((p) => {
              const pct =
                p.ceilingUsd > 0 ? Math.min(100, (p.spendUsd / p.ceilingUsd) * 100) : 0;
              const bar =
                !p.allowed ? "bg-destructive" : pct >= 75 ? "bg-amber-500" : "bg-primary";
              const blocked = reasonLabel(p);

              return (
                <Card key={p.provider} className="ring-1 ring-border/40">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-medium">{p.provider}</CardTitle>
                      {p.allowed ? (
                        <Badge variant="outline" className="gap-1">
                          <ShieldCheck className="h-3 w-3" /> Allowed
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <ShieldAlert className="h-3 w-3" /> {blocked}
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      {usd(p.spendUsd)} of {p.ceilingUsd > 0 ? usd(p.ceilingUsd) : "no ceiling"}
                      {p.snoozeToUsd !== null && (
                        <span className="ml-1 text-amber-500">(snoozed)</span>
                      )}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full transition-all ${bar}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`t-${p.provider}`} className="text-xs">
                          Threshold (USD)
                        </Label>
                        <Input
                          id={`t-${p.provider}`}
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-32 bg-background"
                          defaultValue={p.thresholdUsd}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== p.thresholdUsd && v >= 0) {
                              void patch(
                                { provider: p.provider, thresholdUsd: v },
                                p.provider,
                              );
                            }
                          }}
                        />
                      </div>

                      <div className="ml-auto flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => {
                            setSnoozeFor(p);
                            setSnoozeAmount("10");
                          }}
                        >
                          <Timer className="mr-1.5 h-3.5 w-3.5" /> Snooze
                        </Button>

                        {p.manualBreak || p.snoozeToUsd !== null ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                              void patch({ provider: p.provider, reset: true }, p.provider)
                            }
                          >
                            Reset
                          </Button>
                        ) : (
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                              void patch(
                                { provider: p.provider, manualBreak: true },
                                p.provider,
                              )
                            }
                          >
                            Break glass
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Snooze dialog — a dollar amount above CURRENT spend, so "snooze $10"
          always buys exactly $10 more regardless of how far over it already is. */}
      <Dialog open={snoozeFor !== null} onOpenChange={(o) => !o && setSnoozeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Snooze {snoozeFor?.provider}</DialogTitle>
            <DialogDescription>
              Raises the ceiling by this amount above current spend
              {snoozeFor && ` (${usd(snoozeFor.spendUsd)})`}, then breaks again at the new
              number.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="snooze-amt">Additional budget (USD)</Label>
            <Input
              id="snooze-amt"
              type="number"
              min="0.01"
              step="0.01"
              className="bg-background"
              value={snoozeAmount}
              onChange={(e) => setSnoozeAmount(e.target.value)}
            />
            {snoozeFor && Number(snoozeAmount) > 0 && (
              <p className="text-sm text-muted-foreground">
                New ceiling:{" "}
                <span className="text-foreground">
                  {usd(snoozeFor.spendUsd + Number(snoozeAmount))}
                </span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnoozeFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!(Number(snoozeAmount) > 0) || busy !== null}
              onClick={() => {
                const p = snoozeFor;
                setSnoozeFor(null);
                if (p) void patch({ provider: p.provider, snoozeUsd: Number(snoozeAmount) }, p.provider);
              }}
            >
              Snooze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfigShell>
  );
}
