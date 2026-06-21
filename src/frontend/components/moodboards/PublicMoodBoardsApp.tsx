import { Calendar, Eye, ImageOff, Info, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { resolveCfImageUrl } from "@/components/render/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeneratedMoodBoardRecord {
  id: number | string;
  outputImageUrl?: string | null;
  aiTitle?: string | null;
  aiDescription?: string | null;
  roomName?: string | null;
  roomDisplayName?: string | null;
  floorName?: string | null;
  prompt?: string | null;
  sourceImages?: string | null; // JSON string of [{url}]
  datetimeCreated?: string | number | null;
  isShared?: boolean;
}

interface ReferenceImage {
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roomCaption(board: GeneratedMoodBoardRecord): string | null {
  const room = board.roomDisplayName?.trim() || board.roomName?.trim() || null;
  const floor = board.floorName?.trim() || null;
  if (room && floor) return `${floor} · ${room}`;
  return room || floor || null;
}

function formatDate(value: unknown): string {
  if (!value) return "Unknown";
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PublicMoodBoardsApp() {
  const [boards, setBoards] = useState<GeneratedMoodBoardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<GeneratedMoodBoardRecord | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchSharedBoards() {
      try {
        const response = await fetch("/api/mood-board?shared=true");
        if (!response.ok) {
          throw new Error(`Failed to load shared design boards (${response.status})`);
        }
        const data = await response.json() as { moodBoards?: GeneratedMoodBoardRecord[] };
        if (!mounted) return;
        setBoards(data.moodBoards || []);
      } catch (err) {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : "Failed to load shared design boards.";
        setError(msg);
        toast.error(msg);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void fetchSharedBoards();

    return () => {
      mounted = false;
    };
  }, []);

  const parsedReferenceImages = useMemo<ReferenceImage[]>(() => {
    if (!selectedBoard?.sourceImages) return [];
    try {
      return JSON.parse(selectedBoard.sourceImages) as ReferenceImage[];
    } catch {
      return [];
    }
  }, [selectedBoard]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        <span>Loading shared design boards…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 text-center">
        <p className="text-destructive font-medium">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (boards.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl bg-muted/10 py-16 text-center ring-1 ring-border/40">
        <ImageOff className="size-10 text-muted-foreground/60" />
        <p className="text-sm font-medium">No shared design boards available.</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Check back later once the design team shares new concepts.
        </p>
      </div>
    );
  }

  return (
    <section className="py-8">
      <div className="mx-auto max-w-7xl px-2">
        <header className="mx-auto mb-10 max-w-2xl space-y-2 text-center">
          <h2 className="font-heading text-3xl sm:text-4xl text-foreground">Project Design Boards</h2>
          <p className="text-muted-foreground text-balance lg:text-lg">
            Explore AI-rendered visual guidelines and design boards shared for our renovation project.
          </p>
        </header>

        {/* Retrofitted Product List Layout */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {boards.map((board) => {
            const imageUrl = board.outputImageUrl ? resolveCfImageUrl(board.outputImageUrl) : "";
            const caption = roomCaption(board) || "General Design";

            return (
              // biome-ignore lint/a11y/useButtonElement: click handler to trigger detailed modal
              <div
                key={String(board.id)}
                onClick={() => setSelectedBoard(board)}
                className="group cursor-pointer rounded-xl border border-border/40 bg-card p-3 shadow-sm transition-all hover:bg-muted/40 hover:ring-1 hover:ring-border/80"
              >
                <figure className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted/40">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={board.aiTitle || "Shared design board"}
                      className="object-cover size-full transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex items-center justify-center size-full text-muted-foreground">
                      <ImageOff className="size-10" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100 flex items-center justify-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
                      <Eye className="size-3.5" />
                      View Board Details
                    </span>
                  </div>
                </figure>
                <div className="mt-4 space-y-1">
                  <p className="font-semibold text-foreground tracking-tight line-clamp-1">
                    {board.aiTitle || "Untitled Concept"}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{caption}</span>
                    <span className="text-[10px] text-muted-foreground/80 font-mono">
                      {formatDate(board.datetimeCreated)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed Lightbox / Dialog Modal */}
      <Dialog open={!!selectedBoard} onOpenChange={(open) => !open && setSelectedBoard(null)}>
        <DialogContent className="max-w-3xl overflow-y-auto max-h-[90vh] ring-1 ring-border/80 rounded-xl bg-card border-none p-6 shadow-2xl focus-visible:outline-none">
          {selectedBoard && (
            <div className="space-y-6">
              <DialogHeader className="space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <DialogTitle className="text-2xl font-bold tracking-tight text-foreground">
                    {selectedBoard.aiTitle || "Design Board Concept"}
                  </DialogTitle>
                  {roomCaption(selectedBoard) && (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {roomCaption(selectedBoard)}
                    </Badge>
                  )}
                </div>
                <DialogDescription className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="size-3.5" />
                  Generated on {formatDate(selectedBoard.datetimeCreated)}
                </DialogDescription>
              </DialogHeader>

              {/* Main Generated Board Image */}
              <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted/20 ring-1 ring-border/40">
                {selectedBoard.outputImageUrl ? (
                  <img
                    src={resolveCfImageUrl(selectedBoard.outputImageUrl)}
                    alt={selectedBoard.aiTitle || "Generated Mood Board"}
                    className="size-full object-contain"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-12" />
                  </div>
                )}
              </div>

              {/* Layout Info / Vision Summary */}
              {selectedBoard.aiDescription && (
                <div className="rounded-lg bg-muted/20 p-4 ring-1 ring-border/20">
                  <h4 className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 mb-1.5">
                    <Info className="size-3.5" />
                    AI Description
                  </h4>
                  <p className="text-sm text-foreground leading-relaxed">
                    {selectedBoard.aiDescription}
                  </p>
                </div>
              )}

              {/* User Prompt / Original Request Context */}
              {selectedBoard.prompt && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Original Request Prompt</h4>
                  <blockquote className="rounded-lg border-l-4 border-primary/55 bg-muted/10 p-3 italic text-muted-foreground text-sm leading-relaxed">
                    "{selectedBoard.prompt}"
                  </blockquote>
                </div>
              )}

              {/* Reference Images Grid */}
              {parsedReferenceImages.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-border/40">
                  <h4 className="text-sm font-semibold text-foreground">
                    Reference Materials ({parsedReferenceImages.length})
                  </h4>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                    {parsedReferenceImages.map((ref, idx) => (
                      <a
                        key={idx}
                        href={resolveCfImageUrl(ref.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative aspect-square overflow-hidden rounded-md bg-muted/40 ring-1 ring-border/30 hover:ring-border/80 transition-all block"
                        title="Click to view full reference image"
                      >
                        <img
                          src={resolveCfImageUrl(ref.url)}
                          alt={`Reference ${idx + 1}`}
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
