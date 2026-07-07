/**
 * @fileoverview StoreViewportApp — single-showroom viewport.
 *
 * Two stacked surfaces:
 *   1. Enriched hero header — mirrors the directory card's contact/rating
 *      patterns (favicon logo, price badge, categories, click-to-call, Globe +
 *      Instagram links, 1–5 visit stars + rating-context note) plus an action
 *      bar (record visit, add note, upload photo, associate brands/products).
 *   2. URL-routed bento — three sections (Brands & Products, Notes, Photos).
 *      Selecting a tile pushes `/admin/shopping/store/:id/:section` and a
 *      popstate listener syncs the active section back on browser navigation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  Globe,
  ImagePlus,
  Instagram,
  Loader2,
  MapPin,
  NotebookPen,
  Package,
  Phone,
  RefreshCcw,
  ScanSearch,
  Star,
  StickyNote,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityDocumentsPanel } from "@/components/documents";

import { ScrapeResultsModal } from "./ScrapeResultsModal";
import { RecordVisitModal } from "./visit/RecordVisitModal";
import { AssociateBrandsModal } from "./associate/AssociateBrandsModal";
import { AssociateProductsModal } from "./associate/AssociateProductsModal";
import { ShowroomNoteModal, type ShowroomNote } from "./notes/ShowroomNoteModal";
import { ShowroomPhotoPolaroid, type ShowroomPhoto } from "./photos/ShowroomPhotoPolaroid";
import { ShowroomBento, type ShowroomBentoSection } from "./bento/ShowroomBento";
import { BrandLogo } from "./brands/BrandLogo";
import { PhotoStack } from "./PhotoStack";
import { ShowroomGalleryModal, type GalleryPhoto } from "./ShowroomGalleryModal";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SectionKey = "brands-products" | "notes" | "photos";

const VALID_SECTIONS: SectionKey[] = ["brands-products", "notes", "photos"];

function isSectionKey(v: string | undefined | null): v is SectionKey {
  return v != null && (VALID_SECTIONS as string[]).includes(v);
}

type ScrapeStatus = "idle" | "pending" | "running" | "complete" | "failed";

const TERMINAL_SCRAPE_STATUSES: ScrapeStatus[] = ["complete", "failed", "idle"];
const SCRAPE_POLL_MS = 10_000;

interface StoreBrand {
  id: number;
  name: string;
  iconCfImagesUrl: string | null;
  instagramUrl: string | null;
  source: "direct" | "product";
}

interface StoreCategory {
  categoryName: string;
}

interface StoreDetail {
  id: number;
  name: string;
  description: string | null;
  pricePoint: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  iconCfImagesUrl: string | null;
  heroImageCfImagesUrl: string | null;
  scrapeStatus: ScrapeStatus;
  ragUuid: string | null;
  rating: number | null;
  ratingContextHtml: string | null;
  ratingContextMarkdown: string | null;
  weekdayHours: string | null;
  weekendHours: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
  categories: StoreCategory[];
  brands: StoreBrand[];
}

interface MappedProduct {
  mappingId: number;
  product: { id: number; itemName: string; brandId: number | null };
  brandName: string | null;
}

interface NoteRow {
  id: number;
  title: string | null;
  contentHtml: string | null;
  contentMarkdown: string | null;
  isActive?: boolean;
  timestamp?: string | null;
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────────

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Read a File as a data URL for JSON photo upload. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Normalize a possibly-schemeless Instagram value into an absolute URL. */
function instagramHref(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

// ─── Hero favicon + banner ──────────────────────────────────────────────────────

/** Circular favicon that floats over the hero banner, with an initials/icon fallback. */
function HeroFavicon({ src, name }: { src: string | null | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.trim().slice(0, 2).toUpperCase() || "?";
  const base =
    "absolute left-5 bottom-0 z-10 flex size-16 translate-y-1/2 items-center justify-center overflow-hidden rounded-full bg-card ring-2 ring-background sm:left-6";

  if (!src || failed) {
    return (
      <span className={`${base} text-sm font-semibold text-muted-foreground ring-1`} aria-hidden>
        {initials}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={`${name} icon`}
      onError={() => setFailed(true)}
      loading="lazy"
      className={`${base} object-contain`}
    />
  );
}

/**
 * Hero banner: renders `src` as a cover background image behind a dark gradient
 * overlay (so overlaid text stays legible), with the favicon floating as a
 * circle on the middle-left overlapping the bottom edge. On image load error we
 * fall back to a short plain band; when there's no image at all the band still
 * hosts the favicon so the header composition stays consistent.
 */
function HeroBanner({
  src,
  iconSrc,
  name,
  overlay,
}: {
  src: string | null | undefined;
  iconSrc: string | null | undefined;
  name: string;
  /** Optional floating overlay (e.g. the PhotoStack) pinned bottom-right. */
  overlay?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div className={`relative ${showImage ? "h-40 sm:h-48" : "h-16 sm:h-20"}`}>
      {showImage ? (
        <>
          <img
            src={src as string}
            alt={`${name} hero`}
            onError={() => setFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
          {/* Dark gradient overlay keeps the header text legible over any image. */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/30" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-muted/40 to-card" />
      )}
      <HeroFavicon src={iconSrc} name={name} />
      {overlay ? (
        <div className="absolute bottom-3 right-3 z-10 sm:bottom-4 sm:right-4">
          {overlay}
        </div>
      ) : null}
    </div>
  );
}

/** 1–5 filled visit stars (mirrors the directory card's Stars). */
function VisitStars({ rating }: { rating: number }) {
  return (
    <span className="flex" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`size-4 ${i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

/**
 * Scrape-status badge: reflects the background website-scan Workflow.
 *  - pending/running → amber, spinner, not clickable
 *  - complete        → emerald, clickable → opens the results modal
 *  - failed          → rose, clickable → re-triggers the scan
 *  - idle            → subtle "Run website scan" (only when a websiteUrl exists)
 */
function ScrapeBadge({
  status,
  hasWebsite,
  busy,
  onOpenResults,
  onTrigger,
}: {
  status: ScrapeStatus;
  hasWebsite: boolean;
  busy: boolean;
  onOpenResults: () => void;
  onTrigger: () => void;
}) {
  if (status === "pending" || status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30">
        <Loader2 className="size-3 animate-spin" />
        Scraping website…
      </span>
    );
  }

  if (status === "complete") {
    return (
      <button
        type="button"
        onClick={onOpenResults}
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30 transition-colors hover:bg-emerald-500/25"
      >
        <CheckCircle2 className="size-3" />
        Scraping complete
      </button>
    );
  }

  if (status === "failed") {
    return (
      <button
        type="button"
        onClick={onTrigger}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-300 ring-1 ring-rose-500/30 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCcw className="size-3" />}
        Scrape failed — retry
      </button>
    );
  }

  // idle
  if (!hasWebsite) return null;
  return (
    <button
      type="button"
      onClick={onTrigger}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-border/40 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <ScanSearch className="size-3" />}
      Run website scan
    </button>
  );
}

/** Author-trusted PlateJS HTML block (rating context / note snippets). */
const PROSE_CLASS =
  "prose prose-sm prose-invert max-w-none text-sm leading-relaxed [&_a]:text-sky-400 [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5";

// ─── Main component ─────────────────────────────────────────────────────────────

export function StoreViewportApp({
  id,
  initialSection = "brands-products",
}: {
  id: number;
  initialSection?: SectionKey;
}) {
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Active bento section (URL-routed).
  const [section, setSection] = useState<SectionKey>(initialSection);

  // Section data.
  const [mappedProducts, setMappedProducts] = useState<MappedProduct[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [photos, setPhotos] = useState<ShowroomPhoto[]>([]);

  // Google Places gallery photos (hero source + theater lightbox). Distinct
  // from the homeowner's uploaded `photos` above.
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Modal state.
  const [visitOpen, setVisitOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ShowroomNote | null>(null);
  const [scrapeResultsOpen, setScrapeResultsOpen] = useState(false);

  // Scrape lifecycle. `scrapeStatus` mirrors the store row but is polled
  // independently via GET /:id/scrape while pending/running.
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus | null>(null);
  const [triggeringScrape, setTriggeringScrape] = useState(false);
  const scrapePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mutation flags.
  const [removingBrandId, setRemovingBrandId] = useState<number | null>(null);
  const [removingProductId, setRemovingProductId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Data loaders ──────────────────────────────────────────────────────────────

  const loadStore = useCallback(async () => {
    try {
      const data = await api<StoreDetail>(`/api/showroom-stores/${id}`);
      setStore(data);
    } catch (e) {
      console.error("[store/load]", e);
      toast.error(e instanceof Error ? e.message : "Failed to load showroom");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadMappedProducts = useCallback(async () => {
    try {
      const data = await api<{ mappings: MappedProduct[] }>(
        `/api/showroom-stores/${id}/mapped-products`,
      );
      setMappedProducts(data.mappings ?? []);
    } catch (e) {
      console.error("[store/mapped-products]", e);
      toast.error(e instanceof Error ? e.message : "Failed to load mapped products");
    }
  }, [id]);

  const loadNotes = useCallback(async () => {
    try {
      const data = await api<{ notes: NoteRow[] }>(`/api/showroom-stores/${id}/notes`);
      setNotes(data.notes ?? []);
    } catch (e) {
      console.error("[store/notes]", e);
      toast.error(e instanceof Error ? e.message : "Failed to load notes");
    }
  }, [id]);

  const loadPhotos = useCallback(async () => {
    try {
      const data = await api<{ photos: ShowroomPhoto[] }>(`/api/showroom-stores/${id}/photos`);
      setPhotos(data.photos ?? []);
    } catch (e) {
      console.error("[store/photos]", e);
      toast.error(e instanceof Error ? e.message : "Failed to load photos");
    }
  }, [id]);

  const loadGalleryPhotos = useCallback(async () => {
    try {
      const data = await api<{ photos: GalleryPhoto[] }>(
        `/api/showroom-stores/${id}/photos-gallery`,
      );
      setGalleryPhotos(data.photos ?? []);
    } catch (e) {
      // Non-fatal: the hero simply falls back to heroImageCfImagesUrl and the
      // stack is hidden. Surface for observability without blocking the page.
      console.error("[store/photos-gallery]", e);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    void loadStore();
    void loadMappedProducts();
    void loadNotes();
    void loadPhotos();
    void loadGalleryPhotos();
  }, [loadStore, loadMappedProducts, loadNotes, loadPhotos, loadGalleryPhotos]);

  // ── Scrape status: mount fetch + poll while in-flight ─────────────────────
  //
  // On mount (and whenever `id` changes) we read GET /:id/scrape once; if the
  // status is pending/running we poll every ~10s until it reaches a terminal
  // state. The interval is torn down on unmount, on terminal status, and before
  // starting a fresh one so we never leak timers.

  const clearScrapePoll = useCallback(() => {
    if (scrapePollRef.current !== null) {
      clearInterval(scrapePollRef.current);
      scrapePollRef.current = null;
    }
  }, []);

  const fetchScrapeStatus = useCallback(async (): Promise<ScrapeStatus | null> => {
    try {
      const data = await api<{ scrapeStatus: ScrapeStatus }>(
        `/api/showroom-stores/${id}/scrape`,
      );
      setScrapeStatus(data.scrapeStatus);
      if (TERMINAL_SCRAPE_STATUSES.includes(data.scrapeStatus)) {
        clearScrapePoll();
      }
      return data.scrapeStatus;
    } catch (e) {
      console.error("[store/scrape-status]", e);
      // A transient poll failure shouldn't nuke the badge; stop polling to
      // avoid hammering a failing endpoint.
      clearScrapePoll();
      return null;
    }
  }, [id, clearScrapePoll]);

  const startScrapePoll = useCallback(() => {
    clearScrapePoll();
    scrapePollRef.current = setInterval(() => {
      void fetchScrapeStatus();
    }, SCRAPE_POLL_MS);
  }, [clearScrapePoll, fetchScrapeStatus]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await fetchScrapeStatus();
      if (cancelled) return;
      if (status === "pending" || status === "running") startScrapePoll();
    })();
    return () => {
      cancelled = true;
      clearScrapePoll();
    };
  }, [fetchScrapeStatus, startScrapePoll, clearScrapePoll]);

  const triggerScrape = useCallback(async () => {
    if (triggeringScrape) return;
    setTriggeringScrape(true);
    try {
      const res = await fetch(`/api/showroom-stores/${id}/scrape`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Scan failed (${res.status})`);
      }
      const payload = (await res.json().catch(() => ({}))) as {
        scrapeStatus?: ScrapeStatus;
      };
      setScrapeStatus(payload.scrapeStatus ?? "pending");
      toast.success("Website scan started");
      startScrapePoll();
    } catch (e) {
      console.error("[store/scrape-trigger]", e);
      toast.error(e instanceof Error ? e.message : "Failed to start website scan");
    } finally {
      setTriggeringScrape(false);
    }
  }, [id, triggeringScrape, startScrapePoll]);

  // ── Section ↔ URL sync ──────────────────────────────────────────────────────
  //
  // Selecting a tile updates the active section AND pushes the canonical path
  // `/admin/shopping/store/:id/:section`; browser back/forward restores the
  // section from the last path segment via `popstate`.

  const selectSection = useCallback(
    (key: string) => {
      if (!isSectionKey(key)) return;
      setSection(key);
      if (typeof window !== "undefined") {
        const next = `/admin/shopping/store/${id}/${key}`;
        if (window.location.pathname !== next) {
          window.history.pushState(null, "", next);
        }
      }
    },
    [id],
  );

  useEffect(() => {
    const onPop = () => {
      const seg = window.location.pathname.split("/").filter(Boolean).pop();
      setSection(isSectionKey(seg) ? seg : "brands-products");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const removeBrand = useCallback(
    async (brandId: number) => {
      if (removingBrandId !== null) return;
      setRemovingBrandId(brandId);
      try {
        const res = await fetch(`/api/showroom-stores/${id}/brands/${brandId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Remove failed (${res.status})`);
        }
        toast.success("Brand removed");
        await loadStore();
      } catch (e) {
        console.error("[store/brand-remove]", e);
        toast.error(e instanceof Error ? e.message : "Failed to remove brand");
      } finally {
        setRemovingBrandId(null);
      }
    },
    [id, removingBrandId, loadStore],
  );

  const removeMappedProduct = useCallback(
    async (productId: number) => {
      if (removingProductId !== null) return;
      setRemovingProductId(productId);
      try {
        const res = await fetch(
          `/api/showroom-stores/${id}/mapped-products/${productId}`,
          { method: "DELETE", credentials: "include" },
        );
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Remove failed (${res.status})`);
        }
        toast.success("Product unmapped");
        await Promise.all([loadMappedProducts(), loadStore()]);
      } catch (e) {
        console.error("[store/product-unmap]", e);
        toast.error(e instanceof Error ? e.message : "Failed to unmap product");
      } finally {
        setRemovingProductId(null);
      }
    },
    [id, removingProductId, loadMappedProducts, loadStore],
  );

  const uploadPhoto = useCallback(
    async (file: File) => {
      if (uploading) return;
      setUploading(true);
      try {
        const dataUrl = await fileToDataUrl(file);
        const res = await fetch(`/api/showroom-stores/${id}/photos`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl, altText: file.name }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Upload failed (${res.status})`);
        }
        toast.success("Photo uploaded");
        await loadPhotos();
      } catch (e) {
        console.error("[store/photo-upload]", e);
        toast.error(e instanceof Error ? e.message : "Failed to upload photo");
      } finally {
        setUploading(false);
      }
    },
    [id, uploading, loadPhotos],
  );

  const onFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-picking the same file
      if (file) void uploadPhoto(file);
    },
    [uploadPhoto],
  );

  const openCreateNote = useCallback(() => {
    setEditingNote(null);
    setNoteModalOpen(true);
  }, []);

  const openEditNote = useCallback((note: NoteRow) => {
    setEditingNote({
      id: note.id,
      title: note.title,
      contentHtml: note.contentHtml,
      contentMarkdown: note.contentMarkdown,
    });
    setNoteModalOpen(true);
  }, []);

  // ── Bento sections ──────────────────────────────────────────────────────────

  const bentoSections: ShowroomBentoSection[] = useMemo(
    () => [
      {
        key: "brands-products",
        title: "Brands & Products",
        description: `${store?.brands.length ?? 0} brands · ${mappedProducts.length} products`,
        icon: <Tag className="size-5" />,
      },
      {
        key: "notes",
        title: "Showroom notes",
        description: `${notes.length} note${notes.length === 1 ? "" : "s"}`,
        icon: <StickyNote className="size-5" />,
      },
      {
        key: "photos",
        title: "Showroom photos",
        description: `${photos.length} photo${photos.length === 1 ? "" : "s"}`,
        icon: <ImagePlus className="size-5" />,
      },
    ],
    [store?.brands.length, mappedProducts.length, notes.length, photos.length],
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!store) {
    return (
      <div className="container mx-auto px-4 py-10 text-muted-foreground">
        Showroom not found.
      </div>
    );
  }

  const igHref = instagramHref(store.instagramUrl);
  const categoryNames = store.categories.map((c) => c.categoryName).filter(Boolean);
  // Prefer the polled status; fall back to the store row's value on first paint.
  const effectiveScrapeStatus: ScrapeStatus = scrapeStatus ?? store.scrapeStatus ?? "idle";

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <a
        href="/admin/shopping/showrooms"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Showrooms
      </a>

      {/* ── Enriched hero header ──────────────────────────────────────────────── */}
      <section className="mt-4 overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
        {/* Hero banner: heroImageCfImagesUrl as a cover background with a dark
            gradient so overlaid text stays legible; the favicon floats as a
            circle on the middle-left, overlapping the banner's bottom edge.
            When there's no hero image the banner collapses and we fall back to
            the plain padded header below. */}
        <HeroBanner
          src={galleryPhotos[0]?.cfImagesPhotoUrl ?? store.heroImageCfImagesUrl}
          iconSrc={store.iconCfImagesUrl}
          name={store.name}
          overlay={
            galleryPhotos.length > 0 ? (
              <PhotoStack
                images={galleryPhotos.slice(0, 3).map((p) => p.cfImagesPhotoUrl)}
                count={`${galleryPhotos.length} photo${galleryPhotos.length === 1 ? "" : "s"}`}
                onClick={() => setGalleryOpen(true)}
              />
            ) : null
          }
        />

        <div className="p-5 pt-8 sm:p-6 sm:pt-9">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{store.name}</h1>
              {store.pricePoint ? (
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] text-emerald-400"
                >
                  {store.pricePoint}
                </Badge>
              ) : null}
              <ScrapeBadge
                status={effectiveScrapeStatus}
                hasWebsite={Boolean(store.websiteUrl)}
                busy={triggeringScrape}
                onOpenResults={() => setScrapeResultsOpen(true)}
                onTrigger={() => void triggerScrape()}
              />
            </div>

            {(store.cityName || store.hubName) ? (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-3.5" />
                {[store.cityName, store.hubName].filter(Boolean).join(" · ")}
              </div>
            ) : null}

            {categoryNames.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {categoryNames.map((c) => (
                  <Badge
                    key={c}
                    variant="secondary"
                    className="px-1.5 py-0 text-[10px] font-normal"
                  >
                    {c}
                  </Badge>
                ))}
              </div>
            ) : null}

            {store.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{store.description}</p>
            ) : null}

            {/* Contact row — click-to-call + Globe + Instagram (card patterns). */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
              {store.phoneNumber ? (
                <a
                  href={`tel:${store.phoneNumber.replace(/[^\d+]/g, "")}`}
                  className="inline-flex items-center gap-1.5 font-medium text-sky-400 hover:text-sky-300"
                >
                  <Phone className="size-3.5" />
                  {formatPhone(store.phoneNumber)}
                </a>
              ) : null}
              {store.websiteUrl ? (
                <a
                  href={store.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Globe className="size-3.5" />
                  Website
                </a>
              ) : null}
              {igHref ? (
                <a
                  href={igHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Instagram className="size-3.5" />
                  Instagram
                </a>
              ) : null}
              {(store.weekdayHours || store.weekendHours) ? (
                <span className="text-muted-foreground/80">
                  {[store.weekdayHours, store.weekendHours].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </div>
          </div>

        {/* Visit rating + context note. */}
        {store.rating !== null || store.ratingContextHtml ? (
          <div className="mt-5 rounded-lg bg-muted/40 p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Visit notes
              </span>
              {store.rating !== null ? <VisitStars rating={store.rating} /> : null}
            </div>
            {store.ratingContextHtml ? (
              <div
                className={`mt-2 ${PROSE_CLASS}`}
                // Single trusted homeowner's own authored content, escaped at write time.
                dangerouslySetInnerHTML={{ __html: store.ratingContextHtml }}
              />
            ) : null}
          </div>
        ) : null}

        {/* Action bar. */}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => setVisitOpen(true)}>
            <CalendarPlus className="size-3.5" /> Record visit
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={openCreateNote}>
            <NotebookPen className="size-3.5" /> Add note
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImagePlus className="size-3.5" />
            )}
            Upload photo
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setBrandsOpen(true)}
          >
            <Tag className="size-3.5" /> Associate brands
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setProductsOpen(true)}
          >
            <Package className="size-3.5" /> Associate products
          </Button>
        </div>
        </div>
      </section>

      {/* ── URL-routed bento ──────────────────────────────────────────────────── */}
      <div className="mt-8">
        <ShowroomBento
          sections={bentoSections}
          activeKey={section}
          onSelect={selectSection}
        />
      </div>

      {/* ── Active section content ────────────────────────────────────────────── */}
      <div className="mt-6">
        {section === "brands-products" ? (
          <BrandsProductsSection
            storeId={id}
            brands={store.brands}
            products={mappedProducts}
            removingBrandId={removingBrandId}
            removingProductId={removingProductId}
            onRemoveBrand={removeBrand}
            onRemoveProduct={removeMappedProduct}
            onAssociateBrands={() => setBrandsOpen(true)}
            onAssociateProducts={() => setProductsOpen(true)}
          />
        ) : section === "notes" ? (
          <NotesSection
            notes={notes}
            onAddNote={openCreateNote}
            onEditNote={openEditNote}
          />
        ) : (
          <PhotosSection
            photos={photos}
            uploading={uploading}
            onUploadClick={() => fileInputRef.current?.click()}
            onPhotoSaved={loadPhotos}
          />
        )}
      </div>

      {/* Documents linked to this showroom */}
      <div className="mt-8">
        <EntityDocumentsPanel entityType="showroom" entityId={String(id)} />
      </div>

      {/* Shared hidden file input for photo upload (hero + photos section). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFilePicked}
      />

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      <RecordVisitModal
        showroomId={id}
        open={visitOpen}
        onOpenChange={setVisitOpen}
        onSaved={() => {
          void loadStore();
        }}
      />
      <AssociateBrandsModal
        showroomId={id}
        open={brandsOpen}
        onOpenChange={setBrandsOpen}
        onChanged={() => {
          void loadStore();
        }}
      />
      <AssociateProductsModal
        showroomId={id}
        open={productsOpen}
        onOpenChange={setProductsOpen}
        onChanged={() => {
          void loadMappedProducts();
          void loadStore();
        }}
      />
      <ShowroomNoteModal
        showroomId={id}
        note={editingNote}
        open={noteModalOpen}
        onOpenChange={setNoteModalOpen}
        onSaved={() => {
          void loadNotes();
        }}
      />
      <ScrapeResultsModal
        showroomId={id}
        open={scrapeResultsOpen}
        onOpenChange={setScrapeResultsOpen}
      />
      <ShowroomGalleryModal
        photos={galleryPhotos}
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
      />
    </main>
  );
}

// ─── Section: Brands & Products ─────────────────────────────────────────────────

function BrandsProductsSection({
  storeId,
  brands,
  products,
  removingBrandId,
  removingProductId,
  onRemoveBrand,
  onRemoveProduct,
  onAssociateBrands,
  onAssociateProducts,
}: {
  storeId: number;
  brands: StoreBrand[];
  products: MappedProduct[];
  removingBrandId: number | null;
  removingProductId: number | null;
  onRemoveBrand: (brandId: number) => void;
  onRemoveProduct: (productId: number) => void;
  onAssociateBrands: () => void;
  onAssociateProducts: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Brands */}
      <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Brands ({brands.length})</h2>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onAssociateBrands}>
            <Tag className="size-3.5" /> Associate brands
          </Button>
        </div>
        {brands.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No brands linked to this showroom yet.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {brands.map((brand) => (
              <span
                key={brand.id}
                className="inline-flex items-center gap-1.5 rounded-xl bg-muted/40 py-1.5 pl-1.5 pr-2 text-sm ring-1 ring-border/40 transition-colors hover:bg-muted/70"
              >
                {/* Icon + name links into the brand↔showroom split viewport; the
                    remove-× / "via product" affordances stay OUTSIDE the anchor so
                    removing a brand never navigates. */}
                <a
                  href={`/admin/showrooms/${storeId}/brands/${brand.id}`}
                  className="inline-flex items-center rounded-lg hover:opacity-90"
                  aria-label={`View ${brand.name} products at this showroom`}
                >
                  <BrandLogo image={brand.iconCfImagesUrl} alt={brand.name} />
                </a>
                {brand.source === "direct" ? (
                  <button
                    type="button"
                    onClick={() => onRemoveBrand(brand.id)}
                    disabled={removingBrandId !== null}
                    aria-label={`Remove ${brand.name}`}
                    className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
                  >
                    {removingBrandId === brand.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </button>
                ) : (
                  <Badge
                    variant="outline"
                    className="ml-0.5 px-1 py-0 text-[8px] uppercase tracking-wider text-muted-foreground"
                  >
                    via product
                  </Badge>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Products */}
      <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Products ({products.length})</h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={onAssociateProducts}
          >
            <Package className="size-3.5" /> Associate products
          </Button>
        </div>
        {products.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No products mapped to this showroom yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/40">
            {products.map((m) => (
              <li
                key={m.mappingId}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <a
                  href={`/admin/shopping/product/${m.product.id}`}
                  className="flex min-w-0 items-center gap-2 text-sm hover:underline"
                >
                  <Package className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{m.product.itemName}</span>
                  {m.brandName ? (
                    <Badge
                      variant="secondary"
                      className="shrink-0 px-1.5 py-0 text-[9px] font-normal"
                    >
                      {m.brandName}
                    </Badge>
                  ) : null}
                </a>
                <button
                  type="button"
                  onClick={() => onRemoveProduct(m.product.id)}
                  disabled={removingProductId !== null}
                  aria-label={`Unmap ${m.product.itemName}`}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
                >
                  {removingProductId === m.product.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Section: Notes ─────────────────────────────────────────────────────────────

function NotesSection({
  notes,
  onAddNote,
  onEditNote,
}: {
  notes: NoteRow[];
  onAddNote: () => void;
  onEditNote: (note: NoteRow) => void;
}) {
  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Showroom notes ({notes.length})</h2>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onAddNote}>
          <NotebookPen className="size-3.5" /> Add note
        </Button>
      </div>

      {notes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No notes yet. Add one to capture what you learned on a visit.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => onEditNote(note)}
                className="w-full rounded-lg bg-muted/40 p-4 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/70"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {note.title?.trim() || "Untitled note"}
                  </span>
                  {note.timestamp ? (
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {new Date(note.timestamp).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
                {note.contentHtml ? (
                  <div
                    className={`mt-1.5 line-clamp-3 ${PROSE_CLASS}`}
                    // Single trusted homeowner's own authored content, escaped at write time.
                    dangerouslySetInnerHTML={{ __html: note.contentHtml }}
                  />
                ) : (
                  <p className="mt-1.5 text-xs text-muted-foreground/70">No content.</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Section: Photos ────────────────────────────────────────────────────────────

function PhotosSection({
  photos,
  uploading,
  onUploadClick,
  onPhotoSaved,
}: {
  photos: ShowroomPhoto[];
  uploading: boolean;
  onUploadClick: () => void;
  onPhotoSaved: () => void;
}) {
  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Showroom photos ({photos.length})</h2>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onUploadClick}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          Upload photo
        </Button>
      </div>

      {photos.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No photos yet. Upload a shot from your visit.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <ShowroomPhotoPolaroid key={photo.id} photo={photo} onSaved={onPhotoSaved} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Format a US 10-digit phone as "(###) ### - ####" (mirrors the directory
 * card). Any string that doesn't reduce to exactly 10 digits is returned
 * unchanged (still valid for a tel: link).
 */
function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)} - ${ten.slice(6)}`;
}
