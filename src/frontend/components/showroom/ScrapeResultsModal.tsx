/**
 * @fileoverview ScrapeResultsModal — surfaces the output of the background
 * website-scrape Cloudflare Workflow for a single showroom.
 *
 * On open it fetches `GET /api/showroom-stores/:id/scrape` and lists every
 * scraped page: the source URL (external link), a full-page screenshot
 * thumbnail (hidden on error), the capture timestamp, and the structured info
 * Workers AI extracted per page — brand chips, an Instagram link, an
 * "Appointment only" badge, and free-text hours.
 *
 * Monolith dark: `ring-1 ring-border/40` + `bg-card` separation, no 1px borders.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  Globe,
  ImageOff,
  Instagram,
  Loader2,
  Tag,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types (mirror GET /:id/scrape) ─────────────────────────────────────────

interface ScrapeStructured {
  brandNames?: string[];
  instagramUrl?: string | null;
  appointmentOnly?: boolean | null;
  hoursText?: string | null;
  heroImageUrl?: string | null;
}

interface ScrapePage {
  id: number | string;
  pageUrl: string;
  timestamp: string | null;
  markdownR2Url: string | null;
  fullpageScreenshotCfImagesUrl: string | null;
  workersAiStructuredResponse: ScrapeStructured | null;
}

interface ScrapeResponse {
  scrapeStatus: "idle" | "pending" | "running" | "complete" | "failed";
  ragUuid: string | null;
  heroImageCfImagesUrl: string | null;
  pages: ScrapePage[];
}

interface ScrapeResultsModalProps {
  showroomId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize a possibly-schemeless Instagram value into an absolute URL. */
function instagramHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

/** Short hostname label for an external link. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatTimestamp(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

// ─── Screenshot thumbnail (hidden on error) ─────────────────────────────────

function ScreenshotThumb({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className="flex h-32 w-full items-center justify-center rounded-lg bg-muted/40 text-muted-foreground/50 ring-1 ring-border/40 sm:w-48"
        aria-hidden
      >
        <ImageOff className="size-5" />
      </div>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="block shrink-0 overflow-hidden rounded-lg ring-1 ring-border/40 transition-opacity hover:opacity-90"
    >
      <img
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        loading="lazy"
        className="h-32 w-full bg-card object-cover object-top sm:w-48"
      />
    </a>
  );
}

// ─── Per-page card ───────────────────────────────────────────────────────────

function PageCard({ page }: { page: ScrapePage }) {
  const s = page.workersAiStructuredResponse;
  const brands = s?.brandNames?.filter(Boolean) ?? [];
  const ig = instagramHref(s?.instagramUrl);
  const when = formatTimestamp(page.timestamp);

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border/40">
      <div className="flex flex-col gap-4 sm:flex-row">
        <ScreenshotThumb
          src={page.fullpageScreenshotCfImagesUrl}
          alt={`Screenshot of ${page.pageUrl}`}
        />

        <div className="min-w-0 flex-1">
          <a
            href={page.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-sky-400 hover:text-sky-300"
          >
            <Globe className="size-3.5 shrink-0" />
            <span className="truncate">{hostLabel(page.pageUrl)}</span>
            <ExternalLink className="size-3 shrink-0 opacity-70" />
          </a>

          {when ? (
            <div className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <CalendarClock className="size-3" />
              {when}
            </div>
          ) : null}

          {/* Structured Workers AI info. */}
          {brands.length > 0 ? (
            <div className="mt-3">
              <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Tag className="size-3" /> Brands
              </div>
              <div className="flex flex-wrap gap-1">
                {brands.map((b) => (
                  <Badge
                    key={b}
                    variant="secondary"
                    className="px-1.5 py-0 text-[10px] font-normal"
                  >
                    {b}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
            {ig ? (
              <a
                href={ig}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Instagram className="size-3.5" />
                Instagram
              </a>
            ) : null}
            {s?.appointmentOnly === true ? (
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-[10px] font-normal text-amber-400"
              >
                Appointment only
              </Badge>
            ) : null}
          </div>

          {s?.hoursText ? (
            <p className="mt-2 text-[13px] text-muted-foreground/90">{s.hoursText}</p>
          ) : null}

          {brands.length === 0 && !ig && s?.appointmentOnly !== true && !s?.hoursText ? (
            <p className="mt-3 text-xs text-muted-foreground/60">
              No structured details captured from this page.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function ScrapeResultsModal({
  showroomId,
  open,
  onOpenChange,
}: ScrapeResultsModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScrapeResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/showroom-stores/${showroomId}/scrape`, {
        credentials: "include",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      const json = (await res.json()) as ScrapeResponse;
      setData(json);
    } catch (e) {
      console.error("[scrape-results/load]", e);
      setError(e instanceof Error ? e.message : "Failed to load scrape results");
    } finally {
      setLoading(false);
    }
  }, [showroomId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const pages = data?.pages ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="p-5 pb-3">
          <DialogTitle>Website scan results</DialogTitle>
          <DialogDescription>
            Pages captured by the background scrape, with the details Workers AI
            extracted from each.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <AlertTriangle className="size-6 text-rose-400" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : pages.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <Globe className="size-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No scraped pages yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pages.map((page) => (
                <PageCard key={String(page.id)} page={page} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
