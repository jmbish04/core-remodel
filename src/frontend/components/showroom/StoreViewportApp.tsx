/**
 * @fileoverview StoreViewportApp — single-showroom viewport.
 *
 * Two stacked surfaces:
 *   1. Enriched hero header — favicon + banner, price badge, Google rating
 *      (always shown when Places supplied one), editable category chips, AI
 *      review summary, click-to-call + Globe + social links (IG/FB/Pinterest),
 *      an office-hours mini-card (→ full hours/contact/map modal), the 1–5
 *      visit stars + rating-context note, and the action bar (record visit,
 *      add note, upload photo, associate brands/products).
 *   2. URL-routed bento — three sections (Brands & Products, Notes, Photos).
 *      Photos hosts both the Google Places collection (moved out of the hero)
 *      and the homeowner's visit uploads. Selecting a tile pushes
 *      `/admin/shopping/store/:id/:section` and a popstate listener syncs the
 *      active section back on browser navigation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  Globe,
  ImagePlus,
  Loader2,
  MapPin,
  NotebookPen,
  Package,
  Pencil,
  Phone,
  RefreshCcw,
  ScanSearch,
  Sparkles,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EntityDocumentsPanel } from "@/components/documents";
import { noteEditorHref } from "@/components/notes";

import { ScrapeResultsModal } from "./ScrapeResultsModal";
import { RecordVisitModal } from "./visit/RecordVisitModal";
import { AssociateBrandsModal } from "./associate/AssociateBrandsModal";
import { AssociateProductsModal } from "./associate/AssociateProductsModal";
import { ShowroomPhotoPolaroid, type ShowroomPhoto } from "./photos/ShowroomPhotoPolaroid";
import { ShowroomBento, type ShowroomBentoSection } from "./bento/ShowroomBento";
import { PhotoStack } from "./PhotoStack";
import { ShowroomGalleryModal, type GalleryPhoto } from "./ShowroomGalleryModal";
import { EditStoreModal, type EditableStore } from "./EditStoreModal";
import { ManagePocsSection } from "./ManagePocsSection";
import {
  CategoryChipsEditor,
  HoursContactModal,
  HoursMiniCard,
  SocialLinks,
  type StoreCategoryChip,
} from "./hero";
import type { HoursJson } from "./intake/hours-types";

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
  // Full brands-table row fields (spread into the payload). All optional/nullable
  // because product-derived brands or older payloads may omit them.
  description?: string | null;
  websiteUrl?: string | null;
  onlineRating?: number | null;
  pricePoint?: string | null;
}

/** A brand enriched with its per-showroom product count for the list cards. */
interface BrandWithCount extends StoreBrand {
  productCount: number;
}

/** Store-owned product row (payload carries the full row; we only need brandId). */
interface StoreProduct {
  id: number;
  brandId: number | null;
}

interface StoreDetail {
  id: number;
  name: string;
  description: string | null;
  pricePoint: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  pinterestUrl: string | null;
  iconCfImagesUrl: string | null;
  heroImageCfImagesUrl: string | null;
  scrapeStatus: ScrapeStatus;
  ragUuid: string | null;
  rating: number | null;
  ratingContextHtml: string | null;
  ratingContextMarkdown: string | null;
  hoursJson: HoursJson | null;
  locationAddress: string | null;
  googleMapsLink: string | null;
  googleRating: number | null;
  userRatingCount: number | null;
  reviewSummary: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
  categories: StoreCategoryChip[];
  brands: StoreBrand[];
  products: StoreProduct[];
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
  tags?: string[];
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
 * Google aggregate stars — same visual language as VisitStars but driven by the
 * fractional Places rating (filled when the star index ≤ rounded rating).
 */
function GoogleStars({ rating }: { rating: number }) {
  return (
    <span className="flex" aria-label={`${rating.toFixed(1)} of 5 on Google`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`size-3.5 ${i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
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

  // Google Places gallery photos (hero banner source + the Photos section's
  // "From Google Places" collection + theater lightbox). Distinct from the
  // homeowner's uploaded `photos` above.
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryStartIndex, setGalleryStartIndex] = useState(0);

  // Modal state.
  const [visitOpen, setVisitOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [scrapeResultsOpen, setScrapeResultsOpen] = useState(false);
  const [hoursModalOpen, setHoursModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Note delete (inline; create/edit now navigate to the full-page editor).
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<NoteRow | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);

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
      // Tab title = the showroom's actual name (the Astro page can only know
      // the numeric id at render time).
      if (data?.name) document.title = data.name;
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

  const deleteGalleryPhoto = useCallback(async (photoId: number) => {
    try {
      const res = await fetch(`/api/showroom-stores/${id}/photos-gallery/${photoId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success("Gallery photo deleted.");
      void loadGalleryPhotos();
      void loadStore(); // hero may have changed
    } catch (e) {
      console.error("[store/delete-gallery-photo]", e);
      toast.error("Failed to delete photo.");
    }
  }, [id, loadGalleryPhotos, loadStore]);

  const deleteVisitPhoto = useCallback(async (imageId: number) => {
    try {
      const res = await fetch(`/api/showroom-stores/${id}/photos/${imageId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success("Visit photo deleted.");
      void loadPhotos();
    } catch (e) {
      console.error("[store/delete-visit-photo]", e);
      toast.error("Failed to delete photo.");
    }
  }, [id, loadPhotos]);

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

  // Notes now open a dedicated full-page editor (modals are too cramped for long
  // notes). We navigate the current tab and return to the Notes section here.
  const noteReturnPath = useCallback(
    () => `/admin/shopping/store/${id}/notes`,
    [id],
  );

  const openCreateNote = useCallback(() => {
    window.location.assign(
      noteEditorHref({
        type: "showroom",
        entityId: id,
        returnTo: noteReturnPath(),
      }),
    );
  }, [id, noteReturnPath]);

  const openEditNote = useCallback(
    (note: NoteRow) => {
      window.location.assign(
        noteEditorHref({
          type: "showroom",
          entityId: id,
          noteId: note.id,
          returnTo: noteReturnPath(),
        }),
      );
    },
    [id, noteReturnPath],
  );

  const confirmDeleteNote = useCallback(async () => {
    if (!deleteNoteTarget) return;
    setDeletingNote(true);
    try {
      const res = await fetch(
        `/api/showroom-stores/notes/${deleteNoteTarget.id}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Delete failed (${res.status})`);
      }
      toast.success("Note deleted");
      setDeleteNoteTarget(null);
      await loadNotes();
    } catch (e) {
      console.error("[store/note-delete]", e);
      toast.error(e instanceof Error ? e.message : "Failed to delete note");
    } finally {
      setDeletingNote(false);
    }
  }, [deleteNoteTarget, loadNotes]);

  // ── Per-brand product counts ──────────────────────────────────────────────────
  //
  // Reuses the store payload already in state: `brands` (the DISTINCT union of
  // direct + product-derived brands) plus `products` (the store's own product
  // rows, each with a brandId) to compute a per-brand product count client-side.
  // No extra network call — the GET /:id response carries both arrays. The result
  // feeds both the bento tile's mini logo preview and the Brands list cards.

  const brandsWithCounts: BrandWithCount[] = useMemo(() => {
    if (!store) return [];
    const countByBrand = new Map<number, number>();
    for (const p of store.products ?? []) {
      if (p.brandId != null) {
        countByBrand.set(p.brandId, (countByBrand.get(p.brandId) ?? 0) + 1);
      }
    }
    return (store.brands ?? []).map((b) => ({
      ...b,
      productCount: countByBrand.get(b.id) ?? 0,
    }));
  }, [store]);

  // ── Bento sections ──────────────────────────────────────────────────────────

  const bentoSections: ShowroomBentoSection[] = useMemo(
    () => [
      {
        key: "brands-products",
        title: "Brands & Products",
        description: `${store?.brands.length ?? 0} brands · ${mappedProducts.length} products`,
        icon: <Tag className="size-5" />,
        preview: <BrandsTilePreview brands={brandsWithCounts} />,
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
        description: `${galleryPhotos.length + photos.length} photo${
          galleryPhotos.length + photos.length === 1 ? "" : "s"
        } · Places + your visits`,
        icon: <ImagePlus className="size-5" />,
        preview:
          galleryPhotos.length > 0 || photos.length > 0 ? (
            <PhotoStack
              images={[
                ...galleryPhotos.map((p) => p.cfImagesPhotoUrl),
                ...photos.map((p) => p.deliveryUrl),
              ].slice(0, 3)}
              count={`${galleryPhotos.length + photos.length} photo${
                galleryPhotos.length + photos.length === 1 ? "" : "s"
              }`}
            />
          ) : undefined,
      },
    ],
    [
      store?.brands.length,
      mappedProducts.length,
      notes.length,
      photos,
      galleryPhotos,
      brandsWithCounts,
    ],
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
        />

        <div className="p-5 pt-8 sm:p-6 sm:pt-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{store.name}</h1>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={() => setEditOpen(true)}
                title="Edit showroom"
              >
                <Pencil className="size-3.5" />
              </Button>
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

            {/* Google rating — always shown when Places supplied one, regardless
                of whether the homeowner has visited/rated the showroom. */}
            {store.googleRating != null ? (
              <div className="mt-2 flex items-center gap-1.5 text-sm">
                <GoogleStars rating={store.googleRating} />
                <span className="font-medium tabular-nums">
                  {store.googleRating.toFixed(1)}
                </span>
                {store.userRatingCount != null ? (
                  <span className="text-muted-foreground">
                    ({store.userRatingCount} Google review
                    {store.userRatingCount === 1 ? "" : "s"})
                  </span>
                ) : null}
              </div>
            ) : null}

            {/* Dedicated category section — AI-assigned, user-correctable. */}
            <CategoryChipsEditor
              storeId={id}
              categories={store.categories}
              onChanged={() => void loadStore()}
            />

            {store.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{store.description}</p>
            ) : null}

            {/* AI-summarized read of the Google reviews. */}
            {store.reviewSummary ? (
              <div className="mt-3 rounded-lg bg-muted/40 p-3">
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <Sparkles className="size-3" /> AI review summary
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {store.reviewSummary}
                </p>
              </div>
            ) : null}

            {/* Contact row — click-to-call + Globe + social profiles from D1. */}
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
              <SocialLinks
                instagramUrl={store.instagramUrl}
                facebookUrl={store.facebookUrl}
                pinterestUrl={store.pinterestUrl}
              />
            </div>
          </div>

          {/* Office-hours mini-card — click for full hours + contact + map. */}
          <div className="shrink-0 sm:w-60">
            <HoursMiniCard
              hoursJson={store.hoursJson}
              onClick={() => setHoursModalOpen(true)}
            />
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

        {/* ── Points of Contact ─────────────────────────────────────────────── */}
        <div className="mt-5 border-t border-border/30 pt-5">
          <ManagePocsSection storeId={store.id} />
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
            brands={brandsWithCounts}
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
            onDeleteNote={setDeleteNoteTarget}
          />
        ) : (
          <PhotosSection
            galleryPhotos={galleryPhotos}
            photos={photos}
            uploading={uploading}
            onUploadClick={() => fileInputRef.current?.click()}
            onPhotoSaved={loadPhotos}
            onOpenGallery={(index) => {
              setGalleryStartIndex(index);
              setGalleryOpen(true);
            }}
            onDeleteGalleryPhoto={deleteGalleryPhoto}
            onDeleteVisitPhoto={deleteVisitPhoto}
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
      <AlertDialog
        open={deleteNoteTarget !== null}
        onOpenChange={(next) => {
          if (deletingNote) return;
          if (!next) setDeleteNoteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteNoteTarget?.title?.trim()
                ? `"${deleteNoteTarget.title.trim()}" will be removed from this showroom.`
                : "This note will be removed from this showroom."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 gap-2">
            <AlertDialogCancel disabled={deletingNote}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteNote();
              }}
              disabled={deletingNote}
              className="bg-rose-500 text-white hover:bg-rose-600"
            >
              {deletingNote && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ScrapeResultsModal
        showroomId={id}
        open={scrapeResultsOpen}
        onOpenChange={setScrapeResultsOpen}
      />
      <ShowroomGalleryModal
        photos={galleryPhotos}
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        startIndex={galleryStartIndex}
      />
      <HoursContactModal
        store={{
          name: store.name,
          hoursJson: store.hoursJson,
          phoneNumber: store.phoneNumber,
          emailAddress: store.emailAddress,
          websiteUrl: store.websiteUrl,
          locationAddress: store.locationAddress,
          googleMapsLink: store.googleMapsLink,
          cityName: store.cityName,
        }}
        open={hoursModalOpen}
        onOpenChange={setHoursModalOpen}
      />
      <EditStoreModal
        store={store as unknown as EditableStore}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={loadStore}
      />
    </main>
  );
}

// ─── Brand collage (bento tile preview) ──────────────────────────────────────────

/**
 * Per-index tilt for the angled collage: alternating rotations + slight
 * vertical drift so the row reads as a hand-fanned spread of logo cards.
 */
const COLLAGE_TILTS = [
  "-rotate-6 translate-y-1",
  "rotate-4 -translate-y-1",
  "-rotate-3 translate-y-0.5",
  "rotate-6 -translate-y-0.5",
  "-rotate-2 translate-y-1",
] as const;

/** One tilted, zoomed logo card in the collage, with a lettermark fallback. */
function AngledBrandCard({
  image,
  name,
  tilt,
}: {
  image: string | null;
  name: string;
  tilt: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(image) && !broken;
  const letter = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={`flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-card shadow-lg ring-1 ring-border/40 transition-transform duration-500 ease-out motion-safe:group-hover/tile:rotate-0 motion-safe:group-hover/tile:translate-y-0 motion-safe:group-hover/tile:scale-105 ${tilt}`}
      title={name}
    >
      {showImage ? (
        <img
          src={image ?? undefined}
          alt=""
          aria-hidden
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full scale-110 object-contain p-1.5"
        />
      ) : (
        <span className="text-lg font-semibold text-muted-foreground" aria-hidden>
          {letter}
        </span>
      )}
    </span>
  );
}

/**
 * Angled, zoomed brand-logo collage — a hand-fanned spread of oversized logo
 * cards that straightens and breathes apart on tile hover, with a right-edge
 * fade + "+N" chip for overflow. Purely decorative preview for the Brands &
 * Products bento tile — no interactive children (the tile itself is the button).
 */
function BrandsTilePreview({ brands }: { brands: BrandWithCount[] }) {
  const MAX = 5;
  const shown = brands.slice(0, MAX);
  const overflow = brands.length - shown.length;

  if (shown.length === 0) {
    // No brands linked yet — an inviting ghost fan instead of a bare tile.
    // Decorative only; the tile button is the interactive element.
    return (
      <div className="space-y-2" aria-hidden>
        <div className="flex -space-x-3 py-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`flex size-12 items-center justify-center rounded-xl bg-muted/70 ring-1 ring-border/40 motion-safe:animate-pulse ${COLLAGE_TILTS[i]}`}
              style={{ animationDelay: `${i * 220}ms`, animationDuration: "2.6s" }}
            >
              <Sparkles className="size-3.5 text-muted-foreground/60" />
            </span>
          ))}
        </div>
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover/tile:text-foreground">
          Discover what they carry
          <ArrowRight className="size-3.5 transition-transform group-hover/tile:translate-x-0.5" />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-hidden>
      <div className="relative flex items-center overflow-hidden py-1.5 pl-1 [mask-image:linear-gradient(to_right,black_82%,transparent)]">
        {/* The fan breathes apart + straightens on tile hover — a "come on in" cue. */}
        <div className="flex -space-x-4 group-hover/tile:-space-x-2 [&>*]:transition-[margin,transform] [&>*]:duration-500 motion-reduce:[&>*]:transition-none">
          {shown.map((b, i) => (
            <AngledBrandCard
              key={b.id}
              image={b.iconCfImagesUrl}
              name={b.name}
              tilt={COLLAGE_TILTS[i % COLLAGE_TILTS.length]}
            />
          ))}
        </div>
        {overflow > 0 ? (
          <span className="z-10 ml-3 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground ring-1 ring-border/40">
            +{overflow}
          </span>
        ) : null}
      </div>
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover/tile:text-foreground">
        Shop by brand
        <ArrowRight className="size-3.5 transition-transform group-hover/tile:translate-x-0.5" />
      </p>
    </div>
  );
}

// ─── Brand list card ────────────────────────────────────────────────────────────

/** Leading brand icon tile for a list card, with a lettermark fallback. */
function BrandCardIcon({ image, name }: { image: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(image) && !broken;
  const letter = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-border/40">
      {showImage ? (
        <img
          src={image ?? undefined}
          alt={`${name} logo`}
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-contain p-1.5"
        />
      ) : (
        <span className="text-base font-semibold text-muted-foreground">{letter}</span>
      )}
    </span>
  );
}

/**
 * Horizontal brand card: the whole card is a link to the brand viewport at
 * `/admin/shopping/brands/:id` (in-tab). The remove affordance (direct brands
 * only) is layered on top and calls preventDefault/stopPropagation so removing a
 * brand never navigates; product-derived brands show a "via product" badge
 * instead.
 */
function BrandListCard({
  brand,
  removing,
  removeDisabled,
  onRemove,
}: {
  brand: BrandWithCount;
  removing: boolean;
  removeDisabled: boolean;
  onRemove: (brandId: number) => void;
}) {
  return (
    <div className="group relative">
      <a
        href={`/admin/shopping/brands/${brand.id}`}
        aria-label={`View ${brand.name}`}
        className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-border/40 transition-all hover:ring-primary/40"
      >
        <BrandCardIcon image={brand.iconCfImagesUrl} name={brand.name} />
        <div className="min-w-0 flex-1">
          {/* Leave room on the right for the overlaid remove button / badge. */}
          <h3 className="truncate pr-8 text-sm font-semibold tracking-tight text-card-foreground">
            {brand.name}
          </h3>
          {brand.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {brand.description}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-muted-foreground/60">
              No description yet.
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-normal"
            >
              {brand.productCount} product{brand.productCount === 1 ? "" : "s"}
            </Badge>
            {typeof brand.onlineRating === "number" && brand.onlineRating > 0 ? (
              <Badge
                variant="outline"
                className="gap-1 px-1.5 py-0 text-[10px] font-normal text-amber-300"
              >
                <Star className="size-2.5 fill-amber-400 text-amber-400" />
                {brand.onlineRating.toFixed(1)}
              </Badge>
            ) : null}
            {brand.pricePoint ? (
              <Badge
                variant="outline"
                className="px-1.5 py-0 font-mono text-[10px] font-normal text-emerald-400"
              >
                {brand.pricePoint}
              </Badge>
            ) : null}
          </div>
        </div>
      </a>

      {/* Overlaid affordance — outside the anchor's activation semantics via
          preventDefault/stopPropagation so it never triggers navigation. */}
      {brand.source === "direct" ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(brand.id);
          }}
          disabled={removeDisabled}
          aria-label={`Remove ${brand.name}`}
          className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
        >
          {removing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <Badge
          variant="outline"
          className="pointer-events-none absolute right-3 top-3 px-1 py-0 text-[8px] uppercase tracking-wider text-muted-foreground"
        >
          via product
        </Badge>
      )}
    </div>
  );
}

// ─── Section: Brands & Products ─────────────────────────────────────────────────

function BrandsProductsSection({
  brands,
  products,
  removingBrandId,
  removingProductId,
  onRemoveBrand,
  onRemoveProduct,
  onAssociateBrands,
  onAssociateProducts,
}: {
  brands: BrandWithCount[];
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
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {brands.map((brand) => (
              <BrandListCard
                key={brand.id}
                brand={brand}
                removing={removingBrandId === brand.id}
                removeDisabled={removingBrandId !== null}
                onRemove={onRemoveBrand}
              />
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
  onDeleteNote,
}: {
  notes: NoteRow[];
  onAddNote: () => void;
  onEditNote: (note: NoteRow) => void;
  onDeleteNote: (note: NoteRow) => void;
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
            <li key={note.id} className="group relative">
              <button
                type="button"
                onClick={() => onEditNote(note)}
                className="w-full rounded-lg bg-muted/40 p-4 pr-10 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/70"
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
                {note.tags && note.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {note.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="px-1.5 py-0 text-[10px] font-normal"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </button>

              {/* Inline delete — outside the edit button's activation. */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDeleteNote(note);
                }}
                aria-label={`Delete ${note.title?.trim() || "note"}`}
                className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-foreground/10 hover:text-rose-300 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Section: Photos ────────────────────────────────────────────────────────────

/** A Places-gallery thumbnail that opens the theater lightbox at its index. */
function GalleryThumb({
  photo,
  index,
  onOpen,
}: {
  photo: GalleryPhoto;
  index: number;
  onOpen: (index: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      aria-label={`Open photo ${index + 1} in gallery`}
      className="group/thumb relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-border/40 transition-shadow hover:ring-2 hover:ring-primary/50"
    >
      <img
        src={photo.cfImagesPhotoUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
      />
    </button>
  );
}

/**
 * Photos section — two collections:
 *   1. "From Google Places" — the stock photos pulled at intake/backfill time
 *      (previously stacked in the hero). Thumbs open the theater lightbox.
 *   2. "Your visit photos" — homeowner uploads as flip-polaroids, with the
 *      upload affordance right in the collection.
 */
function PhotosSection({
  galleryPhotos,
  photos,
  uploading,
  onUploadClick,
  onPhotoSaved,
  onOpenGallery,
  onDeleteGalleryPhoto,
  onDeleteVisitPhoto,
}: {
  galleryPhotos: GalleryPhoto[];
  photos: ShowroomPhoto[];
  uploading: boolean;
  onUploadClick: () => void;
  onPhotoSaved: () => void;
  onOpenGallery: (index: number) => void;
  onDeleteGalleryPhoto: (photoId: number) => void;
  onDeleteVisitPhoto: (imageId: number) => void;
}) {
  return (
    <div className="space-y-6">
      {/* ── Collection: Google Places stock photos ── */}
      <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            From Google Places ({galleryPhotos.length})
          </h2>
          {galleryPhotos.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onOpenGallery(0)}
            >
              <ImagePlus className="size-3.5" /> Open gallery
            </Button>
          ) : null}
        </div>
        {galleryPhotos.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No Google Places photos yet — link this showroom to its Google
            listing (Manage → backfill) to pull them in.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {galleryPhotos.map((p, i) => (
                <div key={p.id} className="group/gthumb relative">
                  <GalleryThumb photo={p} index={i} onOpen={onOpenGallery} />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteGalleryPhoto(p.id); }}
                    className="absolute right-1 top-1 z-10 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-destructive group-hover/gthumb:opacity-100"
                    title="Delete photo"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground/60">
              Photos courtesy of the business &amp; Google Maps contributors.
            </p>
          </>
        )}
      </div>

      {/* ── Collection: homeowner visit photos ── */}
      <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Your visit photos ({photos.length})</h2>
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
              <div key={photo.id} className="group/vphoto relative">
                <ShowroomPhotoPolaroid photo={photo} onSaved={onPhotoSaved} />
                <button
                  type="button"
                  onClick={() => onDeleteVisitPhoto(photo.id)}
                  className="absolute right-1 top-1 z-10 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-destructive group-hover/vphoto:opacity-100"
                  title="Delete photo"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
