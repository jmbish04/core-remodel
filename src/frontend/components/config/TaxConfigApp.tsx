/**
 * @fileoverview Sales Tax — config page (`/admin/config/tax`).
 *
 * One number: the rate applying to goods delivered to the property. Resolved
 * automatically from CDTFA using the address configured in Property Address, so
 * there is nothing to enter here in the normal case — the page exists to show
 * the rate, where it came from, and to let a human override it when CDTFA
 * cannot resolve the address.
 *
 * Rate history is kept and shown rather than overwritten, so a quote issued last
 * quarter still reconciles against the rate that was live when it was written.
 *
 * Wrapped in ConfigShell for the config sidebar. Monolith rules.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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

interface Rate {
  id: number;
  ratePpm: number;
  ratePercent: number;
  jurisdiction: string | null;
  county: string | null;
  tac: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
  resolvedAddress: string | null;
  notes: string | null;
}

interface TaxConfig {
  rate: Rate | null;
  address: { address: string; city: string; zip: string; formatted: string } | null;
  history: Rate[];
  warning: string | null;
}

/** Always three decimals — CDTFA publishes rates to that precision. */
const fmt = (pct: number) => `${pct.toFixed(3)}%`;

export function TaxConfigApp() {
  const [cfg, setCfg] = useState<TaxConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRate, setManualRate] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config/tax", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load tax config (${res.status})`);
      setCfg((await res.json()) as TaxConfig);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const refresh = async (overrideManual = false) => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/config/tax/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideManual }),
      });
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      const next = (await res.json()) as TaxConfig;
      setCfg(next);
      if (next.warning) toast.warning(next.warning);
      else toast.success(`Rate confirmed at ${fmt(next.rate?.ratePercent ?? 0)}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const saveManual = async () => {
    const pct = Number(manualRate);
    if (!Number.isFinite(pct) || pct < 0 || pct > 20) {
      toast.error("Enter a rate between 0 and 20 percent.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/config/tax", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratePercent: pct, notes: manualNote || undefined }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setCfg((await res.json()) as TaxConfig);
      setManualOpen(false);
      setManualRate("");
      setManualNote("");
      toast.success(`Rate set to ${fmt(pct)}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const rate = cfg?.rate ?? null;
  const earlier = (cfg?.history ?? []).filter((r) => r.effectiveTo !== null);

  return (
    <ConfigShell
      activeHref="/admin/config/tax"
      title="Sales Tax"
      description="The rate your deliveries are taxed at. Quotes charging anything else get flagged."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Delivery rate</CardTitle>
              <CardDescription>
                Resolved from your property address. This is what a quote should bill.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {rate ? (
                <div className="flex flex-wrap items-end gap-5">
                  <div className="font-mono text-5xl font-semibold tracking-tight tabular-nums">
                    {fmt(rate.ratePercent)}
                  </div>
                  <div className="flex flex-col gap-1 pb-1 text-sm text-muted-foreground">
                    <div>
                      <Badge variant={rate.source === "manual" ? "outline" : "secondary"}>
                        {rate.source === "manual" ? "Set manually" : "CDTFA lookup"}
                      </Badge>
                    </div>
                    {rate.jurisdiction && (
                      <span>
                        Jurisdiction <span className="text-foreground">{rate.jurisdiction}</span>
                        {rate.tac && (
                          <>
                            {" · "}Tax area <span className="text-foreground">{rate.tac}</span>
                          </>
                        )}
                      </span>
                    )}
                    <span>
                      In effect since{" "}
                      <span className="text-foreground">{rate.effectiveFrom}</span>
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No rate resolved yet. Check your property address, then re-check.
                </p>
              )}

              {cfg?.warning && (
                <div className="mt-4 flex gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{cfg.warning}</span>
                </div>
              )}
            </CardContent>

            <Separator />

            <CardFooter className="flex flex-wrap items-center gap-2 pt-4">
              <span className="text-sm text-muted-foreground">
                {cfg?.address?.formatted ?? "Address not set"}
                {" · "}
                <a href="/admin/config/address" className="underline underline-offset-2">
                  Change in Property Address
                </a>
              </span>
              <span className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                disabled={refreshing}
                onClick={() => void refresh(rate?.source === "manual")}
              >
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Re-check
              </Button>
              <Button variant="outline" size="sm" onClick={() => setManualOpen(true)}>
                Set manually
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rate history</CardTitle>
              <CardDescription>
                Old rates are kept so a quote from March still reconciles against March&rsquo;s rate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {earlier.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No earlier rates yet — this is the first one on record.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowHistory((v) => !v)}
                  >
                    {showHistory ? "▾" : "▸"} {earlier.length} earlier rate
                    {earlier.length === 1 ? "" : "s"}
                  </button>

                  {showHistory && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full tabular-nums">
                        <thead>
                          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">Rate</th>
                            <th className="py-2 pr-3 font-medium">In effect</th>
                            <th className="py-2 pr-3 font-medium">Jurisdiction</th>
                            <th className="py-2 font-medium">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {(cfg?.history ?? []).map((h) => (
                            <tr
                              key={h.id}
                              className={h.effectiveTo ? "text-muted-foreground" : undefined}
                            >
                              <td className="py-2 pr-3 font-mono text-sm">
                                {fmt(h.ratePercent)}
                                {!h.effectiveTo && (
                                  <Badge variant="secondary" className="ml-2">
                                    current
                                  </Badge>
                                )}
                              </td>
                              <td className="py-2 pr-3 font-mono text-sm">
                                {h.effectiveFrom} → {h.effectiveTo ?? "now"}
                              </td>
                              <td className="py-2 pr-3 text-sm">{h.jurisdiction ?? "—"}</td>
                              <td className="py-2 text-sm">
                                {h.source === "manual" ? "Manual" : "CDTFA lookup"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <p className="border-l-2 border-border/60 pl-3 text-sm text-muted-foreground">
            A rate change never overwrites the old one — it ends it and starts a new one.
          </p>
        </div>
      )}

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set the rate manually</DialogTitle>
            <DialogDescription>
              Use this when CDTFA can&rsquo;t resolve the address — for example when it sits on a
              jurisdiction boundary and returns more than one candidate rate.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-rate">Rate</Label>
              <Input
                id="manual-rate"
                inputMode="decimal"
                placeholder="8.625"
                value={manualRate}
                onChange={(e) => setManualRate(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">Percent, up to three decimals.</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-note">Why (optional)</Label>
              <Input
                id="manual-note"
                placeholder="Confirmed with CDTFA by phone"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void saveManual()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Set rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfigShell>
  );
}
