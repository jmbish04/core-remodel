import { Check, ImageOff, Loader2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  type CardBusyState,
  INSPIRATION_CATEGORIES,
  type ScopedInspirationImage,
  resolveScopedImageUrl,
} from "./inspiration-categories";

interface CategorizerCardProps {
  image: ScopedInspirationImage;
  /** The currently-chosen (unsaved) category for this card, or "" for none. */
  draft: string;
  /** Per-card busy flags so spinners stay scoped to a single image. */
  busy: CardBusyState;
  /** Called when the reviewer changes the category dropdown. */
  onDraftChange: (value: string) => void;
  /** Called when the reviewer clicks the AI-suggest sparkle. */
  onSuggest: () => void;
  /** Called when the reviewer confirms/saves the chosen category. */
  onSave: () => void;
}

/**
 * One inspiration photo with an AI-suggest button, a 12-category picker, and a
 * Save button. Uncategorized cards get an amber ring + badge so the reviewer can
 * see what still needs attention at a glance.
 *
 * Extracted from `ScopedInspirationCategorizer` to keep both files focused and
 * under the project's per-file size budget.
 */
export function CategorizerCard({
  image,
  draft,
  busy,
  onDraftChange,
  onSuggest,
  onSave,
}: CategorizerCardProps) {
  const url = resolveScopedImageUrl(image);
  const persisted = image.inspirationCategory;
  const isUncategorized = !persisted;
  // Save is meaningful only when a category is chosen and it differs from what
  // is already persisted (avoids redundant PATCHes that do nothing).
  const canSave = Boolean(draft) && draft !== (persisted ?? "");
  const label = image.displayName?.trim() || "Inspiration photo";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg p-2 ring-1 transition-colors",
        isUncategorized
          ? "bg-amber-500/5 ring-amber-500/40"
          : "bg-card ring-border/40",
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-muted/30 ring-1 ring-border/30">
        {url ? (
          // biome-ignore lint/performance/noImgElement: external Cloudflare delivery urls
          <img
            src={url}
            alt={label}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff className="size-5" />
            <span className="text-[10px]">No preview</span>
          </div>
        )}
        {persisted ? (
          <Badge
            variant="secondary"
            className="absolute left-1.5 top-1.5 text-[10px]"
          >
            {persisted}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="absolute left-1.5 top-1.5 border-amber-500/50 bg-background/80 text-[10px] text-amber-400"
          >
            Uncategorized
          </Badge>
        )}
      </div>

      <p className="truncate text-xs font-medium" title={label}>
        {label}
      </p>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onSuggest}
          disabled={busy.suggesting || busy.saving}
          aria-label="Suggest category with AI"
          title="Suggest category with AI"
          className="shrink-0 border-primary/30 text-primary hover:bg-primary/10"
        >
          {busy.suggesting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
        </Button>
        <Select value={draft} onValueChange={(next) => onDraftChange(next ?? "")}>
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue
              items={INSPIRATION_CATEGORIES.map((category) => ({
                value: category,
                label: category,
              }))}
              placeholder="Pick a category"
            />
          </SelectTrigger>
          <SelectContent>
            {INSPIRATION_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={onSave}
          disabled={!canSave || busy.saving || busy.suggesting}
          className="shrink-0"
        >
          {busy.saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          <span className="ml-1 hidden sm:inline">Save</span>
        </Button>
      </div>
    </div>
  );
}
