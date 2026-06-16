import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ConfigVariable = {
  id?: number;
  variableKey: string;
  valueText: string;
  description: string;
};

export function AdminConfigApp() {
  const [configs, setConfigs] = useState<Record<string, ConfigVariable>>({
    permits_target_address: { variableKey: "permits_target_address", valueText: "126 Colby Street", description: "Target address for permit search" },
    permits_target_zip: { variableKey: "permits_target_zip", valueText: "94134", description: "Target zip code for permit search" },
    permits_block_variants: { variableKey: "permits_block_variants", valueText: "5934", description: "Comma-separated block variants" },
    permits_lot_variants: { variableKey: "permits_lot_variants", valueText: "005,5", description: "Comma-separated lot variants" },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/config");
      if (!res.ok) throw new Error("Failed to fetch config");
      const data = await res.json();
      
      if (data.variables && Array.isArray(data.variables)) {
        const updated = { ...configs };
        data.variables.forEach((v: any) => {
          if (updated[v.variableKey]) {
            updated[v.variableKey] = { ...updated[v.variableKey], ...v };
          }
        });
        setConfigs(updated);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load configurations");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = Object.values(configs).map(c => ({
        variableKey: c.variableKey,
        valueText: c.valueText,
        description: c.description,
        category: "permits",
      }));

      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: payload }),
      });

      if (!res.ok) throw new Error("Failed to save config");
      toast.success("Configurations saved successfully!");
      fetchConfigs();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save configurations");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Permits Intelligence Configuration</CardTitle>
              <CardDescription>
                Define the address, block, and lot parameters used by the background permit pipeline to synchronize active house permits.
              </CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={fetchConfigs} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="address">Target Address</Label>
              <Input
                id="address"
                value={configs.permits_target_address.valueText}
                onChange={(e) => setConfigs({
                  ...configs,
                  permits_target_address: { ...configs.permits_target_address, valueText: e.target.value }
                })}
              />
              <p className="text-xs text-muted-foreground">Main property address (e.g. 126 Colby Street)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip">Target Zip Code</Label>
              <Input
                id="zip"
                value={configs.permits_target_zip.valueText}
                onChange={(e) => setConfigs({
                  ...configs,
                  permits_target_zip: { ...configs.permits_target_zip, valueText: e.target.value }
                })}
              />
              <p className="text-xs text-muted-foreground">Property Zip Code</p>
            </div>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="block">Block Variants (Comma-separated)</Label>
              <Input
                id="block"
                value={configs.permits_block_variants.valueText}
                onChange={(e) => setConfigs({
                  ...configs,
                  permits_block_variants: { ...configs.permits_block_variants, valueText: e.target.value }
                })}
              />
              <p className="text-xs text-muted-foreground">SF DBI block numbers can vary in formatting</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lot">Lot Variants (Comma-separated)</Label>
              <Input
                id="lot"
                value={configs.permits_lot_variants.valueText}
                onChange={(e) => setConfigs({
                  ...configs,
                  permits_lot_variants: { ...configs.permits_lot_variants, valueText: e.target.value }
                })}
              />
              <p className="text-xs text-muted-foreground">SF DBI lot numbers can vary</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-2 bg-muted/20 border-t py-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Configurations
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
