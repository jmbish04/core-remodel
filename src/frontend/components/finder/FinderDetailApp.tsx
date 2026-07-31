/**
 * @fileoverview FinderDetailApp (0032 D2d) — the search viewport. Reads
 * /api/showroom-searches/:slug, renders result cards with import/exclude, and streams
 * live updates from the DiscoveryHub WS (/api/showrooms/discovery/ws?slug=…) with a poll
 * fallback. Mirrors the useRenderRealtime socket idiom + ParkFindsApp refetch pattern.
 */
import { CheckCircle2, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { finalizeSearch, getSearch, runSearch } from "./api";
import { ResultCard } from "./ResultCard";
import { STATUS_LABEL, type SearchDetail } from "./types";

const POLL_MS = 20_000;
const PING_MS = 15_000;

export function FinderDetailApp({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<SearchDetail | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<null | "finalize" | "refine">(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await getSearch(slug);
      if (mounted.current) setDetail(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the search");
    }
  }, [slug]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Realtime: DiscoveryHub WS + a poll fallback (survives a dropped socket).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let closedByUs = false;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/showrooms/discovery/ws?slug=${encodeURIComponent(slug)}`;
      try {
        socket = new WebSocket(url);
      } catch {
        reconnect = setTimeout(connect, 4000);
        return;
      }
      socket.onopen = () => {
        if (mounted.current) setLive(true);
        ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), PING_MS);
      };
      socket.onmessage = (event) => {
        if (event.data === "pong") return;
        // Any realtime_event (search_status / results_ready / imported) → refetch.
        void load();
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (ping) clearInterval(ping);
        if (mounted.current) setLive(false);
        if (!closedByUs) reconnect = setTimeout(connect, 4000);
      };
    };
    connect();

    const poll = setInterval(() => void load(), POLL_MS);
    return () => {
      closedByUs = true;
      if (reconnect) clearTimeout(reconnect);
      if (ping) clearInterval(ping);
      clearInterval(poll);
      socket?.close();
    };
  }, [slug, load]);

  async function onFinalize() {
    setBusy("finalize");
    try {
      await finalizeSearch(slug);
      toast.success("Marked final");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not finalize");
    } finally {
      setBusy(null);
    }
  }

  async function onRefine() {
    setBusy("refine");
    try {
      const res = await runSearch({ slug });
      toast.success(`Refined — revision ${res.revision}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refine");
    } finally {
      setBusy(null);
    }
  }

  if (detail == null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const { search, results } = detail;
  const visible = results.filter((r) => !r.isExcluded);
  const excluded = results.filter((r) => r.isExcluded);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={search.status === "final" ? "default" : "secondary"}>{STATUS_LABEL[search.status]}</Badge>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={live ? "Live" : "Reconnecting…"}>
          {live ? <Wifi className="size-3.5 text-emerald-500" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
          {live ? "Live" : "Polling"}
        </span>
        <span className="text-xs text-muted-foreground">revision {search.currentRevision}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onRefine} disabled={busy != null}>
            {busy === "refine" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refine
          </Button>
          {search.status !== "final" && (
            <Button size="sm" variant="outline" onClick={onFinalize} disabled={busy != null}>
              {busy === "finalize" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Finalize
            </Button>
          )}
        </div>
      </div>

      {search.summary && <p className="text-sm text-muted-foreground">{search.summary}</p>}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 py-12 text-center text-muted-foreground">
          No results yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((r) => (
            <ResultCard key={r.id} slug={slug} result={r} onChanged={load} />
          ))}
        </div>
      )}

      {excluded.length > 0 && (
        <details className="rounded-lg border border-border/40 bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {excluded.length} on your not-interested list (hidden)
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            {excluded.map((r) => (
              <li key={r.id} className="truncate">
                {r.name ?? "Unknown"} {r.fullAddress ? `· ${r.fullAddress}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default FinderDetailApp;
