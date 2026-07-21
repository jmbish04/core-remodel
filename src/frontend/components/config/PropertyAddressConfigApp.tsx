/**
 * @fileoverview Property Address — config page (`/admin/config/address`).
 *
 * The permit pipeline's target: address, ZIP, and a SINGLE block + lot. The
 * backend derives the SF-DBI formatting variants (zero-padding etc.) from each
 * single value — no comma lists here. "Test SODA" runs the property query
 * read-only and reports how many records match, so the config can be verified.
 *
 * Wrapped in ConfigShell for the dedicated config sidebar. Monolith rules.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Save, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfigShell } from "./ConfigShell";

const FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "permits_target_address", label: "Target Address", hint: "Main property address (e.g. 126 Colby Street)" },
  // City is required by the CDTFA sales-tax lookup (/admin/config/tax), which
  // rejects an address without all three of street, city and ZIP.
  { key: "permits_target_city", label: "City", hint: "Property city — also used to resolve the sales tax rate" },
  { key: "permits_target_zip", label: "Target ZIP Code", hint: "Property ZIP code" },
  { key: "permits_block", label: "Block", hint: "Single SF assessor block — variants are handled automatically" },
  { key: "permits_lot", label: "Lot", hint: "Single lot number — zero-padding variants are handled automatically" },
];

const DEFAULTS: Record<string, string> = {
  permits_target_address: "126 Colby Street",
  permits_target_city: "San Francisco",
  permits_target_zip: "94134",
  permits_block: "5934",
  permits_lot: "5",
};

type ProbeResult = {
  totalMatched: number;
  datasets: { label: string; matched: number }[];
  block: string[];
  lot: string[];
};

export function PropertyAddressConfigApp() {
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/config", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load config (${res.status})`);
      const data = (await res.json()) as {
        variables?: { variableKey: string; valueText: string }[];
      };
      const next = { ...DEFAULTS };
      const byKey = new Map((data.variables ?? []).map((v) => [v.variableKey, v.valueText]));
      for (const f of FIELDS) {
        const stored = byKey.get(f.key);
        if (stored != null) next[f.key] = stored;
      }
      // Legacy comma `*_variants` keys → first value, so an un-migrated config still shows.
      if (!byKey.has("permits_block") && byKey.get("permits_block_variants"))
        next.permits_block = byKey.get("permits_block_variants")!.split(",")[0]?.trim() || next.permits_block;
      if (!byKey.has("permits_lot") && byKey.get("permits_lot_variants"))
        next.permits_lot = byKey.get("permits_lot_variants")!.split(",")[0]?.trim() || next.permits_lot;
      setValues(next);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = FIELDS.map((f) => ({
        variableKey: f.key,
        valueText: values[f.key]?.trim() ?? "",
        category: "permits",
        description: f.label,
      }));
      const res = await fetch("/api/admin/config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: payload }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast.success("Property configuration saved.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const testSoda = async () => {
    setTesting(true);
    setProbe(null);
    try {
      const res = await fetch("/api/admin/config/soda-test", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as ProbeResult & { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || `Probe failed (${res.status})`);
      setProbe(data);
      toast[data.totalMatched > 0 ? "success" : "warning"](
        `SODA: ${data.totalMatched} matching record${data.totalMatched === 1 ? "" : "s"} found.`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <ConfigShell
      activeHref="/admin/config/address"
      title="Property Address"
      description="The target property the permit pipeline syncs against."
    >
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Permit target</CardTitle>
                  <CardDescription>
                    Used by the background permit pipeline to sync this property's permits.
                  </CardDescription>
                </div>
                <Button variant="outline" size="icon" onClick={load} aria-label="Reload">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-2">
                  <Label htmlFor={f.key}>{f.label}</Label>
                  <Input
                    id={f.key}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                </div>
              ))}
            </CardContent>
            <CardFooter className="flex flex-wrap justify-end gap-2 border-t bg-muted/20 py-4">
              <Button variant="outline" onClick={testSoda} disabled={testing}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Test SODA
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
            </CardFooter>
          </Card>

          {probe ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  SODA probe — {probe.totalMatched} record{probe.totalMatched === 1 ? "" : "s"} matched
                </CardTitle>
                <CardDescription>
                  Block variants tried: {probe.block.join(", ") || "—"} · Lot variants: {probe.lot.join(", ") || "—"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {probe.datasets.map((d) => (
                  <div key={d.label} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{d.label}</span>
                    <span className="font-semibold">{d.matched}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </ConfigShell>
  );
}

export default PropertyAddressConfigApp;
