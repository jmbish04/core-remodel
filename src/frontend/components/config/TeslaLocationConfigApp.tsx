/**
 * @fileoverview Tesla location & proximity config (0032 C1) — /admin/config/tesla.
 *
 * The settings the source-agnostic park detector (L1) and proximity scan (D1)
 * read: recording master switch, home/work coordinates, proximity + home/work
 * radii, dwell threshold, park/depart radii, and location-stale seconds. Three
 * cards inside ConfigShell.
 *
 * Two config stores, deliberately:
 *  - Recording flag reuses the EXISTING `tesla_telemetry_recording_enabled` key
 *    via PATCH /api/config/tesla (same flag the integrations page toggles — one
 *    source of truth, no split-brain).
 *  - Everything else is KV in project_system_variables via POST /api/admin/config
 *    (batch-safe upsert).
 */
import { CircleCheck, Loader2, MapPinned, Radar, Save, Video } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { ConfigShell } from "@/components/config/ConfigShell";
import { GeocodeAddressField } from "@/components/config/GeocodeAddressField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// ── KV keys (IMPLEMENTATION_PLAN §366) ──────────────────────────────────────
const K = {
  homeAddress: "tesla_primary_residence_address",
  homeLat: "tesla_home_lat",
  homeLng: "tesla_home_lng",
  workAddress: "tesla_work_address",
  workLat: "tesla_work_lat",
  workLng: "tesla_work_lng",
  proximityRadiusM: "tesla_proximity_radius_m",
  homeWorkRadiusM: "tesla_home_work_radius_m",
  scanEnabled: "tesla_proximity_scan_enabled",
  staleSeconds: "tesla_location_stale_seconds",
  dwellMinSeconds: "loc_dwell_min_seconds",
  parkRadiusM: "loc_park_radius_m",
  departRadiusM: "loc_depart_radius_m",
} as const;

const DEFAULTS: Record<string, string> = {
  [K.proximityRadiusM]: "250",
  [K.homeWorkRadiusM]: "150",
  [K.scanEnabled]: "false",
  [K.staleSeconds]: "300",
  [K.dwellMinSeconds]: "300",
  [K.parkRadiusM]: "60",
  [K.departRadiusM]: "120",
};

interface Place {
  address: string;
  lat: number | null;
  lng: number | null;
}

function numOrNull(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function TeslaLocationConfigApp() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Recording (existing flag, separate endpoint).
  const [recording, setRecording] = useState<{ configured: boolean; on: boolean } | null>(null);
  const [savingRec, setSavingRec] = useState(false);

  const [home, setHome] = useState<Place>({ address: "", lat: null, lng: null });
  const [work, setWork] = useState<Place>({ address: "", lat: null, lng: null });
  const [nums, setNums] = useState<Record<string, string>>({ ...DEFAULTS });
  const [scanEnabled, setScanEnabled] = useState(false);
  const [lastFix, setLastFix] = useState<{ source: string | null; at: string | null } | null>(null);
  const [propertyCoords, setPropertyCoords] = useState<{ address: string; lat: number; lng: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, teslaRes, propRes, fixRes] = await Promise.all([
        fetch("/api/admin/config", { credentials: "include" }),
        fetch("/api/config/tesla", { credentials: "include" }),
        fetch("/api/admin/properties", { credentials: "include" }),
        fetch("/api/showroom-visit-logs?limit=1", { credentials: "include" }),
      ]);

      if (cfgRes.ok) {
        const data = (await cfgRes.json()) as { variables?: { variableKey: string; valueText: string }[] };
        const byKey = new Map((data.variables ?? []).map((v) => [v.variableKey, v.valueText]));
        setHome({
          address: byKey.get(K.homeAddress) ?? "",
          lat: numOrNull(byKey.get(K.homeLat)),
          lng: numOrNull(byKey.get(K.homeLng)),
        });
        setWork({
          address: byKey.get(K.workAddress) ?? "",
          lat: numOrNull(byKey.get(K.workLat)),
          lng: numOrNull(byKey.get(K.workLng)),
        });
        setNums({
          [K.proximityRadiusM]: byKey.get(K.proximityRadiusM) ?? DEFAULTS[K.proximityRadiusM],
          [K.homeWorkRadiusM]: byKey.get(K.homeWorkRadiusM) ?? DEFAULTS[K.homeWorkRadiusM],
          [K.staleSeconds]: byKey.get(K.staleSeconds) ?? DEFAULTS[K.staleSeconds],
          [K.dwellMinSeconds]: byKey.get(K.dwellMinSeconds) ?? DEFAULTS[K.dwellMinSeconds],
          [K.parkRadiusM]: byKey.get(K.parkRadiusM) ?? DEFAULTS[K.parkRadiusM],
          [K.departRadiusM]: byKey.get(K.departRadiusM) ?? DEFAULTS[K.departRadiusM],
        });
        setScanEnabled((byKey.get(K.scanEnabled) ?? DEFAULTS[K.scanEnabled]) === "true");
      }

      if (teslaRes.ok) {
        const t = (await teslaRes.json()) as { configured?: boolean; telemetryRecordingSetting?: boolean };
        setRecording({ configured: Boolean(t.configured), on: Boolean(t.telemetryRecordingSetting) });
      }

      if (propRes.ok) {
        const p = (await propRes.json()) as {
          property?: { latitude?: number | null; longitude?: number | null; formattedAddress?: string | null };
        };
        const lat = p.property?.latitude;
        const lng = p.property?.longitude;
        if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
          setPropertyCoords({ address: p.property?.formattedAddress ?? "", lat, lng });
        }
      }

      if (fixRes.ok) {
        const f = (await fixRes.json()) as { visits?: { gpsSource: string | null; arrivalAt: string | null; createdAt: string | null }[] };
        const v = f.visits?.[0];
        if (v) setLastFix({ source: v.gpsSource, at: v.arrivalAt ?? v.createdAt });
      }
    } catch (e) {
      console.error("[config/tesla] load", e);
      toast.error(e instanceof Error ? e.message : "Could not load Tesla config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRecording = useCallback(
    async (next: boolean) => {
      setSavingRec(true);
      setRecording((prev) => (prev ? { ...prev, on: next } : prev)); // optimistic
      try {
        const res = await fetch("/api/config/tesla", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telemetryRecording: next }),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        const t = (await res.json()) as { configured?: boolean; telemetryRecordingSetting?: boolean };
        setRecording({ configured: Boolean(t.configured), on: Boolean(t.telemetryRecordingSetting) });
        toast.success(next ? "Telemetry recording enabled." : "Telemetry recording disabled.");
      } catch (e) {
        await load(); // rollback to truth
        toast.error(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSavingRec(false);
      }
    },
    [load],
  );

  const useProjectAddress = useCallback(() => {
    if (!propertyCoords) return;
    setHome({ address: propertyCoords.address, lat: propertyCoords.lat, lng: propertyCoords.lng });
    toast.success("Home set to the project address.");
  }, [propertyCoords]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const variables = [
        { variableKey: K.homeAddress, valueText: home.address, category: "tesla_location", description: "Primary residence address" },
        { variableKey: K.homeLat, valueText: home.lat == null ? "" : String(home.lat), category: "tesla_location", description: "Home latitude" },
        { variableKey: K.homeLng, valueText: home.lng == null ? "" : String(home.lng), category: "tesla_location", description: "Home longitude" },
        { variableKey: K.workAddress, valueText: work.address, category: "tesla_location", description: "Work address" },
        { variableKey: K.workLat, valueText: work.lat == null ? "" : String(work.lat), category: "tesla_location", description: "Work latitude" },
        { variableKey: K.workLng, valueText: work.lng == null ? "" : String(work.lng), category: "tesla_location", description: "Work longitude" },
        { variableKey: K.proximityRadiusM, valueText: nums[K.proximityRadiusM] ?? "", category: "tesla_location", description: "Showroom proximity radius (m)" },
        { variableKey: K.homeWorkRadiusM, valueText: nums[K.homeWorkRadiusM] ?? "", category: "tesla_location", description: "Home/work radius (m)" },
        { variableKey: K.staleSeconds, valueText: nums[K.staleSeconds] ?? "", category: "tesla_location", description: "Location stale threshold (s)" },
        { variableKey: K.dwellMinSeconds, valueText: nums[K.dwellMinSeconds] ?? "", category: "tesla_location", description: "Dwell threshold to register a park (s)" },
        { variableKey: K.parkRadiusM, valueText: nums[K.parkRadiusM] ?? "", category: "tesla_location", description: "Park-cluster radius (m)" },
        { variableKey: K.departRadiusM, valueText: nums[K.departRadiusM] ?? "", category: "tesla_location", description: "Drive-away radius (m)" },
        { variableKey: K.scanEnabled, valueText: scanEnabled ? "true" : "false", category: "tesla_location", description: "Enable park-time proximity discovery scan" },
      ];
      const res = await fetch("/api/admin/config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toast.success("Location settings saved.");
    } catch (e) {
      console.error("[config/tesla] save", e);
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [home, work, nums, scanEnabled]);

  const body = () => {
    if (loading) {
      return (
        <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {/* Recording */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="size-5 text-muted-foreground" />
              Recording
            </CardTitle>
            <CardDescription>
              Master switch for writing vehicle telemetry to the database. This is the same flag as the
              Tesla / Tessie integration page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-lg ring-1 ring-border/40 px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Record telemetry</p>
                <p className="text-xs text-muted-foreground">
                  {recording?.configured === false
                    ? "Integration not configured — connect Tessie first."
                    : recording?.on
                      ? "Location fixes are being recorded."
                      : "Recording is off — no fixes are stored."}
                </p>
              </div>
              <Switch
                checked={Boolean(recording?.on)}
                disabled={savingRec || recording?.configured === false}
                onCheckedChange={(next) => void toggleRecording(next)}
                aria-label="Record Tesla telemetry"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {lastFix?.at
                ? `Last recorded fix: ${lastFix.source ?? "unknown source"} · ${relTime(lastFix.at)}`
                : "No location fixes recorded yet."}
            </p>
          </CardContent>
        </Card>

        {/* Home & Work */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPinned className="size-5 text-muted-foreground" />
              Home &amp; Work
            </CardTitle>
            <CardDescription>
              Parking at home or work pauses an active drive instead of staging a showroom visit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Home address</Label>
                {propertyCoords && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={useProjectAddress}>
                    <CircleCheck className="size-3.5" />
                    Use project address
                  </Button>
                )}
              </div>
              <GeocodeAddressField
                value={home.address}
                latitude={home.lat}
                longitude={home.lng}
                onTextChange={(address) => setHome((p) => ({ ...p, address }))}
                onResolved={(r) => setHome({ address: r.address, lat: r.latitude, lng: r.longitude })}
                placeholder="Home address…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Work address</Label>
              <GeocodeAddressField
                value={work.address}
                latitude={work.lat}
                longitude={work.lng}
                onTextChange={(address) => setWork((p) => ({ ...p, address }))}
                onResolved={(r) => setWork({ address: r.address, lat: r.latitude, lng: r.longitude })}
                placeholder="Work address…"
              />
            </div>
          </CardContent>
        </Card>

        {/* Proximity & dwell */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radar className="size-5 text-muted-foreground" />
              Proximity &amp; dwell
            </CardTitle>
            <CardDescription>
              How close counts as &ldquo;at&rdquo; a place, how long a stop must last to register, and whether
              to scan for undiscovered showrooms on an unexpected park.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-lg ring-1 ring-border/40 px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Park-time discovery scan</p>
                <p className="text-xs text-muted-foreground">
                  On an unexpected park, search Google Places for a nearby showroom (uses quota — off by default).
                </p>
              </div>
              <Switch
                checked={scanEnabled}
                onCheckedChange={setScanEnabled}
                aria-label="Enable park-time proximity discovery scan"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField label="Showroom proximity radius" unit="m" value={nums[K.proximityRadiusM]} onChange={(v) => setNums((n) => ({ ...n, [K.proximityRadiusM]: v }))} />
              <NumField label="Home / work radius" unit="m" value={nums[K.homeWorkRadiusM]} onChange={(v) => setNums((n) => ({ ...n, [K.homeWorkRadiusM]: v }))} />
              <NumField label="Dwell to register a park" unit="s" value={nums[K.dwellMinSeconds]} onChange={(v) => setNums((n) => ({ ...n, [K.dwellMinSeconds]: v }))} />
              <NumField label="Location stale after" unit="s" value={nums[K.staleSeconds]} onChange={(v) => setNums((n) => ({ ...n, [K.staleSeconds]: v }))} />
              <NumField label="Park-cluster radius" unit="m" value={nums[K.parkRadiusM]} onChange={(v) => setNums((n) => ({ ...n, [K.parkRadiusM]: v }))} />
              <NumField label="Drive-away radius" unit="m" value={nums[K.departRadiusM]} onChange={(v) => setNums((n) => ({ ...n, [K.departRadiusM]: v }))} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button className="gap-1.5" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save location settings
          </Button>
        </div>
      </div>
    );
  };

  return (
    <ConfigShell
      activeHref="/admin/config/tesla"
      title="Tesla Location"
      description="Home/work, proximity radii, and dwell — the settings the park detector and proximity scan read."
    >
      {body()}
    </ConfigShell>
  );
}

function NumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label} <span className="text-muted-foreground">({unit})</span>
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        maxLength={9}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 9))}
      />
    </div>
  );
}

/** ISO → "3 min ago" / "2 h ago" / "just now". */
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "unknown";
  const diff = Date.now() - t;
  // Clamp a future timestamp (clock skew) to "just now" rather than "-5 min ago".
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export default TeslaLocationConfigApp;
