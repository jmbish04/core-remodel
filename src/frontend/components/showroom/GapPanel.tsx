import { useCallback, useEffect, useState } from "react";
import { Sparkles, Loader2, X, FlaskConical, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type GapContext = "material" | "product" | "showroom";

interface Gap {
  id: number;
  context: GapContext;
  name: string;
  roomName: string | null;
  description: string | null;
  suggestedAction: string | null;
  status: string;
  identifiedAt: string | number | null;
}

const COPY: Record<GapContext, { title: string; blurb: string }> = {
  material: {
    title: "Material gaps",
    blurb: "Implied-but-missing materials based on what you've logged.",
  },
  product: {
    title: "Product gaps",
    blurb: "Materials with no sourced products yet.",
  },
  showroom: {
    title: "Showroom coverage gaps",
    blurb: "Product areas no tracked showroom covers.",
  },
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  return payload as T;
}

function ageDays(identifiedAt: string | number | null): number | null {
  if (identifiedAt == null) return null;
  const t = typeof identifiedAt === "number" ? identifiedAt * (identifiedAt < 1e12 ? 1000 : 1) : Date.parse(identifiedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function AgeBadge({ identifiedAt }: { identifiedAt: string | number | null }) {
  const days = ageDays(identifiedAt);
  if (days === null) return null;
  const isNew = days < 1;
  return (
    <Badge
      variant="outline"
      className={
        isNew
          ? "border-emerald-500/30 text-emerald-400 font-mono text-[10px] uppercase tracking-widest"
          : "font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
      }
    >
      {isNew ? "New" : `${days}d old`}
    </Badge>
  );
}

export function GapPanel({ context, onChanged }: { context: GapContext; onChanged?: () => void }) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [acting, setActing] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ gaps: Gap[] }>(`/api/showroom-stores/meta/gaps/list?context=${context}`);
      setGaps(data.gaps);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load gaps");
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    load();
  }, [load]);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const data = await api<{ inserted: number; gaps: Gap[] }>(
        `/api/showroom-stores/meta/gaps/analyze?context=${context}`,
        { method: "POST" },
      );
      setGaps(data.gaps);
      setSelected(new Set());
      toast.success(data.inserted > 0 ? `Found ${data.inserted} new gap${data.inserted === 1 ? "" : "s"}` : "No new gaps found");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gap analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = async (action: "dismiss" | "research") => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setActing(true);
    try {
      await api(`/api/showroom-stores/meta/gaps/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      toast.success(action === "dismiss" ? `Dismissed ${ids.length}` : `Queued ${ids.length} for research`);
      setSelected(new Set());
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to ${action}`);
    } finally {
      setActing(false);
    }
  };

  const copy = COPY[context];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> {copy.title}
              {gaps.length > 0 ? <span className="text-sm font-normal text-muted-foreground">{gaps.length}</span> : null}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{copy.blurb}</p>
          </div>
          <Button size="sm" variant="outline" onClick={analyze} disabled={analyzing}>
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Analyze gaps
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {selected.size > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2">
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => bulk("research")} disabled={acting}>
              <FlaskConical className="h-3.5 w-3.5" /> Run deep research
            </Button>
            <Button size="sm" variant="ghost" onClick={() => bulk("dismiss")} disabled={acting}>
              <X className="h-3.5 w-3.5" /> Dismiss
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-[80px] items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : gaps.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No open gaps. Click <span className="font-medium">Analyze gaps</span> to scan.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {gaps.map((g) => (
              <li key={g.id} className="flex items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(g.id)}
                  onChange={() => toggle(g.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-sky-500"
                  aria-label={`Select gap ${g.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{g.name}</span>
                    {g.roomName ? (
                      <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {g.roomName}
                      </Badge>
                    ) : null}
                    <AgeBadge identifiedAt={g.identifiedAt} />
                    {g.status === "researching" ? (
                      <Badge variant="secondary" className="bg-sky-500/10 text-sky-400 font-mono text-[10px] uppercase tracking-widest">
                        Researching
                      </Badge>
                    ) : null}
                  </div>
                  {g.description ? <p className="mt-0.5 text-xs text-muted-foreground">{g.description}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
