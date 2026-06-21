import { ImageOff, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { resolveCfImageUrl } from "@/components/render/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tolerant view of a generated mood board record from GET /api/mood-board. */
interface GeneratedMoodBoardRecord {
  id: number | string;
  outputImageUrl?: string | null;
  aiTitle?: string | null;
  aiDescription?: string | null;
  roomName?: string | null;
  roomDisplayName?: string | null;
  floorName?: string | null;
  prompt?: string | null;
  datetimeCreated?: string | number | null;
  isShared?: boolean;
}

interface ListApiResponse {
  success?: boolean;
  error?: string;
  details?: string;
  /** Tolerate the common envelope variants used across this codebase. */
  moodBoards?: GeneratedMoodBoardRecord[];
  items?: GeneratedMoodBoardRecord[];
  results?: GeneratedMoodBoardRecord[];
}

interface GeneratedMoodBoardsProps {
  /** Bumping this value triggers a re-fetch (e.g. after a new generation). */
  refreshKey?: number;
  /** Optional room filter forwarded as ?roomId=. */
  roomId?: number | string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DESCRIPTION_LIMIT = 160;

function extractRecords(payload: ListApiResponse | GeneratedMoodBoardRecord[]): GeneratedMoodBoardRecord[] {
  if (Array.isArray(payload)) return payload;
  return payload.moodBoards ?? payload.items ?? payload.results ?? [];
}

function truncate(value: string, limit = DESCRIPTION_LIMIT): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}…`;
}

function roomCaption(board: GeneratedMoodBoardRecord): string | null {
  const room = board.roomDisplayName?.trim() || board.roomName?.trim() || null;
  const floor = board.floorName?.trim() || null;
  if (room && floor) return `${floor} · ${room}`;
  return room || floor || null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GeneratedMoodBoards({ refreshKey = 0, roomId }: GeneratedMoodBoardsProps) {
  const [boards, setBoards] = useState<GeneratedMoodBoardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");

  // Debounce the keyword so typing doesn't hammer the API.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setActiveQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  // Check admin status
  useEffect(() => {
    fetch("/api/access/status", { credentials: "include" })
      .then((res) => res.json())
      .then((data: any) => {
        if (data.success && data.authenticated) {
          setIsAdmin(true);
        }
      })
      .catch(() => {});
  }, []);

  const handleToggleShare = async (boardId: string | number, currentShared: boolean) => {
    const newShared = !currentShared;
    try {
      const response = await fetch(`/api/mood-board/${boardId}/share`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isShared: newShared }),
      });

      if (!response.ok) {
        throw new Error("Failed to update share status");
      }

      setBoards((prevBoards) =>
        prevBoards.map((board) =>
          board.id === boardId ? { ...board, isShared: newShared } : board
        )
      );

      toast.success(newShared ? "Design board shared with contractors" : "Design board unshared");

      // Notify sidebar to refresh count
      window.dispatchEvent(new CustomEvent("design-boards-updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle share status");
    }
  };

  // Guard against out-of-order responses when the query changes quickly.
  const requestIdRef = useRef(0);

  const fetchBoards = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (activeQuery) params.set("q", activeQuery);
      if (roomId !== undefined && roomId !== null && String(roomId).length > 0) {
        params.set("roomId", String(roomId));
      }
      const queryString = params.toString();
      const response = await fetch(`/api/mood-board${queryString ? `?${queryString}` : ""}`);

      const text = await response.text();
      let payload: ListApiResponse | GeneratedMoodBoardRecord[];
      try {
        payload = JSON.parse(text) as ListApiResponse | GeneratedMoodBoardRecord[];
      } catch {
        throw new Error(
          `Server returned a non-JSON response (${response.status}): ${text.slice(0, 160)}`,
        );
      }

      if (!response.ok || (!Array.isArray(payload) && payload.success === false)) {
        const message = !Array.isArray(payload)
          ? payload.error || payload.details
          : undefined;
        throw new Error(message || `Failed to load mood boards (${response.status}).`);
      }

      // Ignore responses superseded by a newer request.
      if (requestId !== requestIdRef.current) return;
      setBoards(extractRecords(payload));
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      const message =
        caught instanceof Error ? caught.message : "Failed to load mood boards.";
      setError(message);
      toast.error(message);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [activeQuery, roomId]);

  useEffect(() => {
    void fetchBoards();
  }, [fetchBoards, refreshKey]);

  const hasResults = boards.length > 0;
  const isFiltered = activeQuery.length > 0;

  const headerCount = useMemo(() => {
    if (loading && !hasResults) return null;
    return boards.length;
  }, [boards.length, hasResults, loading]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles className="size-5 text-primary" />
            AI-Generated Mood Boards
            {headerCount !== null && (
              <span className="text-sm font-normal text-muted-foreground">
                ({headerCount})
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Browse every board the generator has produced.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by keyword…"
              className="pl-8"
              aria-label="Search generated mood boards"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void fetchBoards()}
            disabled={loading}
            aria-label="Refresh generated mood boards"
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {loading && !hasResults ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-muted/20 py-16 text-sm text-muted-foreground ring-1 ring-border/40">
          <Loader2 className="size-4 animate-spin" />
          Loading generated mood boards…
        </div>
      ) : error && !hasResults ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-muted/20 py-16 text-center ring-1 ring-border/40">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchBoards()}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </div>
      ) : !hasResults ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/20 py-16 text-center ring-1 ring-border/40">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 ring-1 ring-border/30">
            <ImageOff className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">
            {isFiltered ? "No mood boards match your search." : "No generated mood boards yet."}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {isFiltered
              ? "Try a different keyword or clear the search."
              : "Use the generator above to create your first AI mood board."}
          </p>
          {isFiltered && (
            <Button type="button" variant="outline" size="sm" onClick={() => setSearchInput("")}>
              Clear search
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => {
            const imageUrl = board.outputImageUrl ? resolveCfImageUrl(board.outputImageUrl) : "";
            const caption = roomCaption(board);
            const description = board.aiDescription?.trim();
            return (
              <Card key={String(board.id)} className="gap-0 py-0">
                {imageUrl ? (
                  <div className="aspect-[4/3] w-full overflow-hidden bg-muted/40">
                    {/* biome-ignore lint/performance/noImgElement: external delivery url */}
                    <img
                      src={imageUrl}
                      alt={board.aiTitle || "Generated mood board"}
                      className="size-full object-cover transition-transform duration-300 hover:scale-[1.02]"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted/40 text-muted-foreground">
                    <ImageOff className="size-7" />
                  </div>
                )}
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold leading-snug">
                      {board.aiTitle || "Untitled mood board"}
                    </h3>
                    {caption && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {caption}
                      </Badge>
                    )}
                  </div>
                  {description ? (
                    <p className="text-sm text-muted-foreground">{truncate(description)}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground/70 italic">No description.</p>
                  )}
                  {isAdmin && (
                    <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-3">
                      <Label htmlFor={`share-${board.id}`} className="text-xs text-muted-foreground cursor-pointer">
                        Share with Contractors
                      </Label>
                      <Switch
                        id={`share-${board.id}`}
                        checked={Boolean(board.isShared)}
                        onCheckedChange={() => handleToggleShare(board.id, Boolean(board.isShared))}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
