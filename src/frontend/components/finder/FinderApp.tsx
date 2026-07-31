/**
 * @fileoverview FinderApp (0032 D2d) — the discovery-finder list page. Runs a new search
 * (POST /api/showroom-searches → navigates to the slug viewport) and lists recent
 * searches. Mirrors the ParkFindsApp list-island structure.
 */
import { Loader2, MapPin, Search, Telescope } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { listSearches, runSearch } from "./api";
import { STATUS_LABEL, type SearchSummary } from "./types";

export function FinderApp() {
  const [searches, setSearches] = useState<SearchSummary[] | null>(null);
  const [near, setNear] = useState("");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listSearches();
      setSearches(data.searches);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load searches");
      setSearches([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRun() {
    if (!near.trim() && !query.trim()) {
      toast.error("Enter a location or a query");
      return;
    }
    setRunning(true);
    try {
      const res = await runSearch({
        near: near.trim() || null,
        query: query.trim() || null,
        broad: !query.trim(),
      });
      toast.success(`Found ${res.count} — opening the search`);
      window.location.href = `/admin/shopping/showrooms/finder/${res.slug}`;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* New search */}
      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          New discovery search
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="flex items-center gap-2 rounded-md border border-input px-2">
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              value={near}
              onChange={(e) => setNear(e.target.value)}
              placeholder="Near… (city, area, or lat,lng)"
              className="border-0 px-1 focus-visible:ring-0"
              onKeyDown={(e) => e.key === "Enter" && onRun()}
            />
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you after? (tile, plumbing…) — optional"
            onKeyDown={(e) => e.key === "Enter" && onRun()}
          />
          <Button onClick={onRun} disabled={running}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {running ? "Searching…" : "Search"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Leave the query blank for a broad remodel-showroom sweep. Results are ranked with AI and saved as a
          shareable page.
        </p>
      </div>

      {/* Recent searches */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Recent searches</h2>
        {searches == null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : searches.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-12 text-center text-muted-foreground">
            <Telescope className="size-8" aria-hidden />
            <p>No searches yet — run one above.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {searches.map((s) => (
              <li key={s.id}>
                <a
                  href={`/admin/shopping/showrooms/finder/${s.slug}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{s.title ?? s.slug}</span>
                  <Badge variant={s.status === "final" ? "default" : "secondary"}>{STATUS_LABEL[s.status]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {s.resultCount} result{s.resultCount === 1 ? "" : "s"} · rev {s.currentRevision}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default FinderApp;
