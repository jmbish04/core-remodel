import { ImagePlus, Loader2, Sparkles, Upload, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { resolveCfImageUrl } from "@/components/render/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RoomSelect } from "@/components/ui/room-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by POST /api/mood-board/generate on success. */
export interface GeneratedMoodBoardResult {
  id: number | string;
  outputImageUrl?: string | null;
  aiTitle?: string | null;
  aiDescription?: string | null;
}

interface GenerateApiResponse extends Partial<GeneratedMoodBoardResult> {
  success?: boolean;
  error?: string;
  details?: string;
  /** Some endpoints nest the record; tolerate both shapes. */
  moodBoard?: Partial<GeneratedMoodBoardResult> | null;
}

interface MoodBoardGeneratorProps {
  /** Fired after a successful generation so a sibling list can refresh. */
  onGenerated?: (result: GeneratedMoodBoardResult) => void;
}

interface StagedImage {
  /** Stable key so previews don't remount while the list mutates. */
  key: string;
  file: File;
  previewUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
const MAX_FILES = 12;

function makeStagedImage(file: File): StagedImage {
  return {
    key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function normalizeResult(payload: GenerateApiResponse): GeneratedMoodBoardResult | null {
  const source = payload.moodBoard ?? payload;
  if (source.id === undefined || source.id === null) {
    return null;
  }
  return {
    id: source.id,
    outputImageUrl: source.outputImageUrl ?? null,
    aiTitle: source.aiTitle ?? null,
    aiDescription: source.aiDescription ?? null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MoodBoardGenerator({ onGenerated }: MoodBoardGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedMoodBoardResult | null>(null);

  // Room selection (optional) — the shared <RoomSelect> resolves against the
  // canonical ACTIVE catalog only. The old free-text fallback was removed: it was
  // the source of snake_case "ghost" rooms (0005 §C2 — never create a room from a
  // free-text name). When no room is chosen we send nothing.
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Track object URLs so we can revoke them on unmount without re-running on
  // every staged-list change.
  const stagedRef = useRef<StagedImage[]>([]);
  stagedRef.current = staged;

  // Revoke any outstanding object URLs only when the island unmounts.
  useEffect(() => {
    return () => {
      for (const image of stagedRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
  }, []);

  // ----- staging files -----

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const candidates = Array.from(incoming).filter((file) =>
      file.type.startsWith("image/") || ACCEPTED_TYPES.includes(file.type),
    );
    if (candidates.length === 0) {
      toast.error("Only image files can be added to a mood board.");
      return;
    }
    setStaged((current) => {
      const existingKeys = new Set(
        current.map((image) => `${image.file.name}-${image.file.size}-${image.file.lastModified}`),
      );
      const additions: StagedImage[] = [];
      for (const file of candidates) {
        const dedupeKey = `${file.name}-${file.size}-${file.lastModified}`;
        if (existingKeys.has(dedupeKey)) continue;
        existingKeys.add(dedupeKey);
        additions.push(makeStagedImage(file));
      }
      const next = [...current, ...additions];
      if (next.length > MAX_FILES) {
        toast.error(`You can add up to ${MAX_FILES} images per mood board.`);
        // Revoke the previews we are about to drop.
        for (const dropped of next.slice(MAX_FILES)) {
          URL.revokeObjectURL(dropped.previewUrl);
        }
        return next.slice(0, MAX_FILES);
      }
      return next;
    });
  }, []);

  const removeStaged = useCallback((key: string) => {
    setStaged((current) => {
      const target = current.find((image) => image.key === key);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((image) => image.key !== key);
    });
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        addFiles(event.target.files);
      }
      // Allow re-selecting the same file again later.
      event.target.value = "";
    },
    [addFiles],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        addFiles(event.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  // ----- submit -----

  const canGenerate = useMemo(() => {
    if (generating) return false;
    return prompt.trim().length > 0 || staged.length > 0;
  }, [generating, prompt, staged.length]);

  const handleGenerate = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && staged.length === 0) {
      toast.error("Add a prompt, some images, or both to generate a mood board.");
      return;
    }

    setGenerating(true);
    try {
      const formData = new FormData();
      if (trimmedPrompt) {
        formData.append("prompt", trimmedPrompt);
      }
      // Only ever send a canonical room id — never a free-text room name (§C2).
      if (selectedRoomId != null) {
        formData.append("roomId", String(selectedRoomId));
      }
      for (const image of staged) {
        formData.append("file", image.file);
      }

      const response = await fetch("/api/mood-board/generate", {
        method: "POST",
        body: formData,
      });

      const text = await response.text();
      let payload: GenerateApiResponse;
      try {
        payload = JSON.parse(text) as GenerateApiResponse;
      } catch {
        throw new Error(
          `Server returned a non-JSON response (${response.status}): ${text.slice(0, 160)}`,
        );
      }

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || payload.details || "Mood board generation failed.");
      }

      const normalized = normalizeResult(payload);
      if (!normalized) {
        throw new Error("Generation succeeded but the server response was missing an id.");
      }

      setResult(normalized);
      toast.success(normalized.aiTitle ? `Generated “${normalized.aiTitle}”` : "Mood board generated.");

      // Clear the staged inputs for the next run.
      for (const image of staged) {
        URL.revokeObjectURL(image.previewUrl);
      }
      setStaged([]);
      setPrompt("");

      onGenerated?.(normalized);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to generate mood board.",
      );
    } finally {
      setGenerating(false);
    }
  }, [onGenerated, prompt, selectedRoomId, staged]);

  // ----- render -----

  const resultImageUrl = result?.outputImageUrl
    ? resolveCfImageUrl(result.outputImageUrl)
    : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="size-5 text-primary" />
          AI Mood Board Generator
        </CardTitle>
        <CardDescription>
          Describe the vibe, drop in reference photos, or both — and let AI compose a mood board.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Prompt */}
          <div className="space-y-1.5">
            <Label htmlFor="mood-board-prompt">Prompt (optional)</Label>
            <Textarea
              id="mood-board-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              disabled={generating}
              placeholder="Warm minimalist kitchen with white oak, matte black fixtures, and soft natural light…"
            />
            <p className="text-xs text-muted-foreground">
              Prompt only → generate from description. Images only → mood board from those images.
              Both → prompt guides the images.
            </p>
          </div>

          {/* Image picker */}
          <div className="space-y-1.5">
            <Label>Reference images (optional)</Label>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: drop zone delegates to a hidden file input */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => !generating && fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (generating) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                "flex min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-muted/30 px-4 py-6 text-center ring-1 ring-border/40 transition-colors",
                isDragging && "bg-primary/5 ring-2 ring-primary/50",
                generating && "pointer-events-none opacity-60",
              )}
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-muted/60 ring-1 ring-border/30">
                <Upload className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Drag &amp; drop images here</p>
              <p className="text-xs text-muted-foreground">
                or click to browse · up to {MAX_FILES} images
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              multiple
              className="hidden"
              onChange={handleInputChange}
            />

            {staged.length > 0 && (
              <div className="grid grid-cols-3 gap-2 pt-1 sm:grid-cols-4">
                {staged.map((image) => (
                  <div
                    key={image.key}
                    className="group/thumb relative aspect-square overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border/30"
                  >
                    {/* biome-ignore lint/performance/noImgElement: local object-url preview */}
                    <img
                      src={image.previewUrl}
                      alt={image.file.name}
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeStaged(image.key)}
                      disabled={generating}
                      aria-label={`Remove ${image.file.name}`}
                      className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-background/80 text-foreground opacity-0 ring-1 ring-border/40 backdrop-blur-sm transition-opacity group-hover/thumb:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Room selector — shared <RoomSelect> (§C4): floor-grouped, searchable,
            active-only, no default selection, display name in the trigger. */}
        <div className="space-y-1.5">
          <Label htmlFor="mood-board-room">Room (optional)</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <RoomSelect
              id="mood-board-room"
              value={selectedRoomId}
              onChange={setSelectedRoomId}
              disabled={generating}
              placeholder="Select a room (optional)"
              aria-label="Room"
              className="w-full sm:max-w-xs"
            />
            {selectedRoomId != null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={generating}
                onClick={() => setSelectedRoomId(null)}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Action */}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handleGenerate} disabled={!canGenerate}>
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Generate Mood Board
              </>
            )}
          </Button>
          {!generating && staged.length === 0 && prompt.trim().length === 0 && (
            <span className="text-xs text-muted-foreground">
              Add a prompt or at least one image to begin.
            </span>
          )}
        </div>

        {/* Result */}
        {result && (
          <div className="space-y-3 rounded-xl bg-muted/20 p-4 ring-1 ring-border/40">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImagePlus className="size-4 text-primary" />
              Latest generation
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-start">
              {resultImageUrl ? (
                <div className="overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border/30">
                  {/* biome-ignore lint/performance/noImgElement: external delivery url */}
                  <img
                    src={resultImageUrl}
                    alt={result.aiTitle || "Generated mood board"}
                    className="aspect-[4/3] w-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-muted/40 text-muted-foreground ring-1 ring-border/30">
                  <ImagePlus className="size-6" />
                </div>
              )}
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold">
                  {result.aiTitle || "Untitled mood board"}
                </h3>
                {result.aiDescription ? (
                  <p className="text-sm text-muted-foreground">{result.aiDescription}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No description was returned for this mood board.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
