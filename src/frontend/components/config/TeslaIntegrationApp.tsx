/**
 * @fileoverview Tesla / Tessie integration — config page
 * (`/admin/config/integrations/tesla`).
 *
 * Three panels, in the order the questions actually get asked:
 *
 *   1. **Credentials** — read-only masked fields. The values live in the
 *      Secrets Store and are never sent to the browser; the dots plus a
 *      character count are enough to tell "set" from "set to the wrong thing".
 *      The fields are rendered as real disabled inputs (rather than a list of
 *      badges) so this page already looks like the self-serve token form it
 *      will become.
 *   2. **Telemetry recording** — a switch. Off, or unconfigured, means NOTHING
 *      is written to D1; the copy says which of the two is stopping it.
 *   3. **Health** — an on-demand screening. A green "configured" badge over a
 *      table of unusable rows is exactly the failure this catches, so the
 *      checks read the historical events, not just the credentials.
 *
 * Monolith rules: dark theme, theme tokens, `ring-1 ring-border/40` over 1px
 * borders, no window.confirm.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  CarFront,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ConfigShell } from "./ConfigShell";

interface MaskedSecret {
  binding: string;
  label: string;
  description: string;
  configured: boolean;
  masked: string;
  length: number;
}

interface IntegrationStatus {
  configured: boolean;
  telemetryRecording: boolean;
  telemetryRecordingSetting: boolean;
  secrets: MaskedSecret[];
}

interface HealthCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

interface HealthReport {
  overall: "ok" | "warn" | "fail";
  checks: HealthCheck[];
  stats: {
    webhookEvents: number;
    webhookEventsWithCoords: number;
    lastWebhookAt: string | null;
    telemetryFrames: number;
    telemetryWithCoords: number;
    telemetryWithShiftState: number;
    lastTelemetryAt: string | null;
  };
}

const STATUS_STYLES: Record<HealthCheck["status"], string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  fail: "text-destructive",
};

function StatusIcon({ status }: { status: HealthCheck["status"] }) {
  const Icon = status === "ok" ? CheckCircle2 : status === "warn" ? TriangleAlert : ShieldAlert;
  return <Icon className={cn("mt-0.5 size-4 shrink-0", STATUS_STYLES[status])} aria-hidden />;
}

export function TeslaIntegrationApp() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/tesla", { credentials: "include" });
      if (res.status === 401) return setError("unauthorized");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setStatus((await res.json()) as IntegrationStatus);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleTelemetry = async (next: boolean) => {
    setSaving(true);
    // Optimistic: the switch should move under the finger, not after a round-trip.
    setStatus((prev) => (prev ? { ...prev, telemetryRecordingSetting: next } : prev));
    try {
      const res = await fetch("/api/config/tesla", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ telemetryRecording: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setStatus((await res.json()) as IntegrationStatus);
      toast.success(next ? "Telemetry recording enabled." : "Telemetry recording disabled.");
    } catch (e) {
      await load();
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runHealth = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/config/tesla/health", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Health check failed (${res.status})`);
      setHealth((await res.json()) as HealthReport);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const body = () => {
    if (error === "unauthorized") {
      return <p className="text-sm text-muted-foreground">Sign in to the admin portal to manage integrations.</p>;
    }
    if (error) return <p className="text-sm text-destructive">{error}</p>;
    if (!status) {
      return (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-6">
        {/* ── Credentials ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="size-4 text-muted-foreground" aria-hidden />
                  Credentials
                </CardTitle>
                <CardDescription>
                  Held in the Cloudflare Secrets Store and read by the Worker at request time. Values
                  are never sent to this page — editing them here is not wired up yet.
                </CardDescription>
              </div>
              <Badge variant={status.configured ? "default" : "outline"} className="shrink-0">
                {status.configured ? "Connected" : "Not configured"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {status.secrets.map((s) => (
              <div key={s.binding} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={s.binding} className="text-sm">
                    {s.label}
                  </Label>
                  <span className="font-mono text-xs text-muted-foreground">{s.binding}</span>
                </div>
                <Input
                  id={s.binding}
                  readOnly
                  disabled
                  value={s.configured ? s.masked : ""}
                  placeholder="Not set"
                  className="font-mono tracking-widest"
                />
                <p className="text-xs text-muted-foreground">
                  {s.description}{" "}
                  {s.configured ? (
                    <span className="text-emerald-400">Set · {s.length} characters.</span>
                  ) : (
                    <span className="text-destructive">Missing.</span>
                  )}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Telemetry recording ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" aria-hidden />
              Fleet Telemetry recording
            </CardTitle>
            <CardDescription>
              Tessie does not push telemetry — it exposes a WebSocket
              (<code>streaming.tessie.com/{"{VIN}"}</code>) that a client has to dial. This switch
              governs whether frames POSTed to <code>/api/tesla/telemetry</code> are stored at all;
              at ~500ms a frame that is real write volume, so leave it off until something is
              actually piping the stream.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-lg px-3 py-3 ring-1 ring-border/40">
              <div className="min-w-0">
                <p className="text-sm font-medium">Record telemetry frames to D1</p>
                <p className="text-xs text-muted-foreground">
                  {!status.configured
                    ? "Nothing can be recorded while the integration is unconfigured — there is no vehicle to attribute frames to."
                    : status.telemetryRecordingSetting
                      ? "Frames would be written if something posted them. Position polling is unaffected — it runs regardless."
                      : "Frames are accepted and discarded. Position polling is unaffected — it runs regardless."}
                </p>
              </div>
              <Switch
                checked={status.telemetryRecordingSetting}
                disabled={saving || !status.configured}
                onCheckedChange={(next) => void toggleTelemetry(next)}
                aria-label="Record Tesla telemetry frames to D1"
              />
            </div>
          </CardContent>
        </Card>

        {/* ── Health ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-4 text-muted-foreground" aria-hidden />
                  Health screening
                </CardTitle>
                <CardDescription>
                  Reads a live position from Tessie and checks the events already collected still
                  carry what the automation needs — coordinates and a gear — plus how position
                  updates actually reach the Worker.
                </CardDescription>
              </div>
              <Button onClick={() => void runHealth()} disabled={checking} className="shrink-0">
                {checking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Run check
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!health ? (
              <p className="text-sm text-muted-foreground">
                Not run yet. The check makes one live call to the vehicle.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={health.overall === "ok" ? "default" : "outline"}
                    className={cn("capitalize", health.overall !== "ok" && STATUS_STYLES[health.overall])}
                  >
                    {health.overall === "ok" ? "Healthy" : health.overall === "warn" ? "Degraded" : "Failing"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {health.stats.webhookEvents} webhook events · {health.stats.telemetryFrames} telemetry frames
                  </span>
                </div>
                <ul className="flex flex-col gap-3">
                  {health.checks.map((c) => (
                    <li key={c.id} className="flex gap-2.5">
                      <StatusIcon status={c.status} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <ConfigShell
      activeHref="/admin/config/integrations/tesla"
      title="Tesla / Tessie"
      description="Vehicle integration: credentials, telemetry recording, and whether the data already collected is usable."
    >
      <div className="mb-6 flex items-start gap-2 text-sm text-muted-foreground">
        <CarFront className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          While a drive list is active, the Worker polls the car's cached position every two minutes
          — checking off stops as you park at them, and ending the drive when you get home. Cached
          reads never wake the car, and nothing is polled when no drive is active.
        </span>
      </div>
      {body()}
    </ConfigShell>
  );
}

export default TeslaIntegrationApp;
