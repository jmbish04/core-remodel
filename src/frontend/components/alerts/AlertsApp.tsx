/**
 * @fileoverview Global alerts center (0042 P3) — /admin/alerts.
 *
 * A live, read-only aggregator feed over the domain staged/unread tables
 * (GET /api/alerts). Each row deep-links to its existing review surface; the
 * only inline action is "Approve AI" on a pending-AI email (POST the 0042 P2
 * approve-ai route). Subscribes to the realtime `global` room so it refreshes
 * when ingestion/approval pokes land.
 */
import * as React from "react";
import { Inbox, Sparkles, Receipt, Home, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type AlertKind = "email_received" | "pending_ai" | "invoice_review" | "room_proposal";

interface Alert {
  id: string;
  kind: AlertKind;
  title: string;
  context: string;
  timestamp: number | null;
  route: string;
}

interface AlertsResponse {
  success: true;
  counts: Record<string, number>;
  alerts: Alert[];
}

const KIND_META: Record<AlertKind, { icon: React.ComponentType<{ className?: string }>; label: string; tint: string }> = {
  pending_ai: { icon: Sparkles, label: "Pending your approval", tint: "text-amber-500" },
  invoice_review: { icon: Receipt, label: "To review / map", tint: "text-emerald-500" },
  email_received: { icon: Inbox, label: "Email received", tint: "text-sky-500" },
  room_proposal: { icon: Home, label: "Room proposal", tint: "text-violet-500" },
};

const ORDER: AlertKind[] = ["pending_ai", "invoice_review", "room_proposal", "email_received"];

function relTime(ts: number | null): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function AlertsApp() {
  const [data, setData] = React.useState<AlertsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [approving, setApproving] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch("/api/alerts", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<AlertsResponse>) : null))
      .then((d) => d && setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    load();
    // Live refresh: subscribe to the shared realtime room; re-load on any poke.
    let ws: WebSocket | null = null;
    try {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/api/realtime/estimates?room=global`);
      ws.onmessage = () => load();
    } catch {
      /* realtime is best-effort; polling below covers it */
    }
    const poll = window.setInterval(load, 60_000);
    return () => {
      ws?.close();
      window.clearInterval(poll);
    };
  }, [load]);

  const approveAi = async (alert: Alert) => {
    const emailId = alert.id.split(":")[1];
    setApproving(alert.id);
    try {
      const res = await fetch(`/api/worker-emails/${emailId}/approve-ai`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed");
      }
      toast.success("AI processing complete — extracted item ready to map.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApproving(null);
    }
  };

  const grouped = ORDER.map((kind) => ({
    kind,
    items: (data?.alerts ?? []).filter((a) => a.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {data ? `${data.counts.total ?? 0} open` : ""}
        </span>
        <Button size="icon" variant="ghost" className="ml-auto size-8" onClick={load} aria-label="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
          <CheckCircle2 className="size-6 text-emerald-500" />
          You're all caught up.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ kind, items }) => {
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            return (
              <section key={kind}>
                <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon className={`size-4 ${meta.tint}`} /> {meta.label} ({items.length})
                </h2>
                <div className="divide-y rounded-lg border">
                  {items.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{a.context}</div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{relTime(a.timestamp)}</span>
                      {a.kind === "pending_ai" ? (
                        <Button
                          size="sm"
                          className="shrink-0 gap-1.5"
                          onClick={() => approveAi(a)}
                          disabled={approving === a.id}
                        >
                          {approving === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                          Approve AI
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="shrink-0" render={<a href={a.route} />}>
                          Open
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
