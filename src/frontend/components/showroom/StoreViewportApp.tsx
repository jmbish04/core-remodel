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
  BadgePercent,
  CalendarPlus,
  CheckCircle2,
  ExternalLink,
  Globe,
  ImagePlus,
  Loader2,
  Mail,
  MapPin,
  NotebookPen,
  Package,
  Printer,
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
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NavigateTeslaButton } from "@/components/tesla/NavigateTeslaButton";
import { StoreVisitsSection } from "@/components/visits/StoreVisitsSection";
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
import { NoteBody } from "./NoteBody";

import { ScrapeResultsModal } from "./ScrapeResultsModal";
import { RecordVisitModal } from "./visit/RecordVisitModal";
import { AssociateBrandsModal } from "./associate/AssociateBrandsModal";
import { AssociateProductsModal } from "./associate/AssociateProductsModal";
import { type ShowroomPhoto } from "./photos/ShowroomPhotoPolaroid";
import { VisitPhotosManager } from "./photos/VisitPhotosManager";
import { GooglePhotosButton } from "@/components/google-photos/GooglePhotosButton";
import { ShowroomBento, type ShowroomBentoSection } from "./bento/ShowroomBento";
import { ShowroomGmailPanel } from "@/components/gmail/ShowroomGmailPanel";
import { PhotoStack } from "./PhotoStack";
import { ShowroomGalleryModal, type GalleryPhoto } from "./ShowroomGalleryModal";
import { EditStoreModal, type EditableStore } from "./EditStoreModal";
import { ContactCard, formatPhone as fmtPhone, telHref, type ContactRow } from "./contacts/ContactCard";
import {
  CategoryChipsEditor,
  EditAddressModal,
  EditHoursModal,
  HeroLinkButtons,
  HoursContactModal,
  HoursMiniCard,
  ManageLinksModal,
  SocialLinks,
  SOCIAL_LINK_TYPES,
  TypeEditor,
  UploadPhotoModal,
  type StoreCategoryChip,
} from "./hero";
import type { HoursJson } from "./intake/hours-types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SectionKey = "brands-products" | "contacts" | "notes" | "photos" | "visits";

const VALID_SECTIONS: SectionKey[] = ["brands-products", "contacts", "notes", "photos", "visits"];

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
  /**
   * CF Images delivery URLs for this brand's product/lifestyle photography,
   * newest first (from `brand_images`). Drives the Brands & Products bento
   * slideshow. Absent/empty when the brand research scrape hasn't captured any.
   */
  images?: string[];
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
  // Business-model type (joined from showroom_store_type on GET /:id).
  typeId: number | null;
  typeName: string | null;
  typeColor: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
  /**
   * Derived server-side from the store's first WEBSITE link. The socials the
   * API also derives (instagramUrl / facebookUrl / pinterestUrl) are
   * intentionally NOT modelled here — those columns are gone and the hero reads
   * `links` directly, which is the only shape that can carry X / LinkedIn.
   */
  websiteUrl: string | null;
  iconCfImagesUrl: string | null;
  heroImageCfImagesUrl: string | null;
  scrapeStatus: ScrapeStatus;
  ragUuid: string | null;
  rating: number | null;
  ratingContextHtml: string | null;
  ratingContextMarkdown: string | null;
  hoursJson: HoursJson | null;
  locationAddress: string | null;
  locationStreetNumber: string | null;
  locationStreetName: string | null;
  locationCity: string | null;
  locationState: string | null;
  locationZipCode: string | null;
  googleMapsLink: string | null;
  /** Places coordinates — preferred over the address text for Tesla navigation. */
  latitude: number | null;
  longitude: number | null;
  googleRating: number | null;
  userRatingCount: number | null;
  reviewSummary: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
  categories: StoreCategoryChip[];
  brands: StoreBrand[];
  products: StoreProduct[];
  /** Store web/social links (GET /:id now returns these). */
  links: Array<{ id: number; url: string; type: string; urlNotes: string | null }>;
}

interface MappedProduct {
  mappingId: number;
  product: { id: number; itemName: string; brandId: number | null };
  brandName: string | null;
}

/** One discounted item from a clearance snapshot (see ClearanceItem in D1). */
interface ClearanceItem {
  title: string;
  brand: string | null;
  category: string | null;
  originalPrice: number | null;
  salePrice: number | null;
  discountPercent: number | null;
  dealLabel: string | null;
  url: string | null;
  notes: string | null;
}

/** A current clearance snapshot for this store, from GET /api/showroom-sales/store/:id. */
interface StoreSale {
  id: number;
  sourceUrl: string;
  capturedAt: string | null;
  details: {
    items: ClearanceItem[];
    saleHeadline: string | null;
    saleEndsText: string | null;
    summary: string;
  };
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

/**
 * Clearance alert — the loud, hard-to-miss banner for a showroom that currently
 * has something marked down. Only rendered when the weekly sweep found actual
 * discounted items (a sale page that exists but lists nothing produces an empty
 * snapshot, which deliberately clears this instead of showing a stale sale).
 *
 * Shows the top few items inline so the alert is actionable at a glance rather
 * than just "there's a sale" — with a deep link to the store's own sale page and
 * a way through to the full /admin/shopping/sales board.
 */
function ClearanceAlert({ sales }: { sales: StoreSale[] }) {
  const items = sales.flatMap((s) => s.details.items);
  if (items.length === 0) return null;

  const headline = sales.find((s) => s.details.saleHeadline)?.details.saleHeadline ?? null;
  const endsText = sales.find((s) => s.details.saleEndsText)?.details.saleEndsText ?? null;
  const primaryUrl = sales[0]?.sourceUrl ?? null;
  // Lead with the deepest discounts — that's what makes the alert worth reading.
  const top = [...items]
    .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0))
    .slice(0, 3);

  return (
    <div className="mt-4 rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-500/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
          <BadgePercent className="size-3" />
          On sale now
        </span>
        <span className="text-sm font-medium text-amber-200">
          {headline ?? `${items.length} item${items.length === 1 ? "" : "s"} marked down`}
        </span>
        {endsText ? (
          <span className="text-xs text-amber-400/80">· {endsText}</span>
        ) : null}
      </div>

      <ul className="mt-2 space-y-1">
        {top.map((item, i) => (
          <li
            key={`${item.title}-${i}`}
            className="flex items-baseline justify-between gap-3 text-xs"
          >
            <span className="min-w-0 truncate text-muted-foreground">
              {item.brand ? <span className="text-foreground">{item.brand} </span> : null}
              {item.title}
            </span>
            <span className="shrink-0 tabular-nums text-amber-300">
              {item.discountPercent != null
                ? `${Math.round(item.discountPercent)}% off`
                : item.dealLabel ?? ""}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {primaryUrl ? (
          <a
            href={primaryUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-amber-300 hover:text-amber-200"
          >
            View their sale page <ExternalLink className="size-3" />
          </a>
        ) : null}
        <a
          href="/admin/shopping/sales"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          All clearance <ArrowRight className="size-3" />
        </a>
        {items.length > top.length ? (
          <span className="text-muted-foreground/70">
            +{items.length - top.length} more
          </span>
        ) : null}
      </div>
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
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  // Current clearance for this store (empty when nothing is on sale).
  const [sales, setSales] = useState<StoreSale[]>([]);

  // Google Places gallery photos (hero banner source + the Photos section's
  // "From Google Places" collection + theater lightbox). Distinct from the
  // homeowner's uploaded `photos` above.
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryStartIndex, setGalleryStartIndex] = useState(0);

  // Inbox unread badge (0040 P4). The button now opens the full-page inbox (0041);
  // the hidden panel below stays mounted only to keep this count fresh.
  const [inboxUnread, setInboxUnread] = useState(0);

  // Modal state.
  const [visitOpen, setVisitOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [scrapeResultsOpen, setScrapeResultsOpen] = useState(false);
  const [hoursModalOpen, setHoursModalOpen] = useState(false);
  const [editHoursOpen, setEditHoursOpen] = useState(false);
  const [editAddressOpen, setEditAddressOpen] = useState(false);
  const [manageLinksOpen, setManageLinksOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
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

  const loadContacts = useCallback(async () => {
    try {
      const data = await api<{ contacts: ContactRow[] }>(
        `/api/showroom-contacts?storeId=${id}&includeDrafts=true`,
      );
      setContacts(data.contacts ?? []);
    } catch (e) {
      console.error("[store/contacts]", e);
      toast.error(e instanceof Error ? e.message : "Failed to load contacts");
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

  const loadSales = useCallback(async () => {
    try {
      const data = await api<{ sales: StoreSale[] }>(`/api/showroom-sales/store/${id}`);
      setSales(data.sales);
    } catch (e) {
      // Non-fatal: no clearance alert is a fine degraded state for the page.
      console.error("[store/sales]", e);
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

  useEffect(() => {
    setLoading(true);
    void loadStore();
    void loadMappedProducts();
    void loadNotes();
    void loadPhotos();
    void loadContacts();
    void loadGalleryPhotos();
    void loadSales();
  }, [
    loadStore,
    loadMappedProducts,
    loadNotes,
    loadPhotos,
    loadContacts,
    loadGalleryPhotos,
    loadSales,
  ]);

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

  /**
   * Upload a batch of visit photos (used by the Google Photos import) through
   * the same `/api/showroom-stores/:id/photos` endpoint the single-file picker
   * uses. Sequential so we never hammer the endpoint; per-file errors are
   * reported without aborting the rest.
   */
  const uploadPhotos = useCallback(
    async (incoming: File[]) => {
      if (uploading || incoming.length === 0) return;
      setUploading(true);
      let ok = 0;
      try {
        for (const file of incoming) {
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
            ok += 1;
          } catch (e) {
            console.error("[store/photo-upload]", e);
            toast.error(e instanceof Error ? e.message : `Failed to upload ${file.name}`);
          }
        }
        if (ok > 0) {
          toast.success(ok === 1 ? "Photo uploaded" : `${ok} photos uploaded`);
          await loadPhotos();
        }
      } finally {
        setUploading(false);
      }
    },
    [id, uploading, loadPhotos],
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
        key: "contacts",
        title: "Contacts",
        description: `${contacts.length} contact${contacts.length === 1 ? "" : "s"} · call or email`,
        icon: <Users className="size-5" />,
      },
      {
        key: "notes",
        title: "Showroom notes",
        description: `${notes.length} note${notes.length === 1 ? "" : "s"}`,
        icon: <StickyNote className="size-5" />,
      },
      {
        key: "visits",
        title: "Visits",
        description: "Arrivals, dwell & your visit notes",
        icon: <MapPin className="size-5" />,
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
      contacts.length,
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
    <main className="w-full px-4 py-10 md:px-8">
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

            {/* Business-model type — single FK, edited via the yellow-highlight modal. */}
            <TypeEditor
              storeId={id}
              typeId={store.typeId}
              typeName={store.typeName}
              typeColor={store.typeColor}
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

            {/* Clearance alert — only when the sweep found live discounts. */}
            <ClearanceAlert sales={sales} />

            {/* Contact row — click-to-call. */}
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
            </div>

            {/* Large tap targets for the website + every registered link type,
                then the "Links" modal. Replaces the old text hyperlinks, which
                were unhittable from a car touchscreen. */}
            <HeroLinkButtons
              links={store.links}
              onOpenLinks={() => setManageLinksOpen(true)}
            />
            {store.latitude != null && store.longitude != null ? (
              <div className="mt-2">
                <NavigateTeslaButton
                  latitude={store.latitude}
                  longitude={store.longitude}
                  className="h-12 gap-2"
                />
              </div>
            ) : null}
          </div>

          {/* Office-hours mini-card — click for full hours + contact + map, plus
              the Call / Copy address / Navigate actions and the hours + address
              edit affordances (all now live inside that modal). */}
          <div className="shrink-0 space-y-2 sm:w-60">
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
            <NoteBody
              className="mt-2"
              markdown={store.ratingContextMarkdown}
              html={store.ratingContextHtml}
            />
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
            onClick={() => setUploadOpen(true)}
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
          <Button
            size="sm"
            variant="outline"
            className="relative gap-1.5"
            aria-label={`Inbox${inboxUnread > 0 ? ` (${inboxUnread} unread)` : ""}`}
            render={<a href={`/admin/shopping/store/${id}/inbox`} />}
          >
            <Mail className="size-3.5" /> Inbox
            {inboxUnread > 0 ? (
              <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-sky-500 px-1.5 text-[11px] font-semibold text-white">
                {inboxUnread}
              </span>
            ) : null}
          </Button>
        </div>

        {/* Hidden inbox panel — kept mounted only so the unread badge above
            populates on load; the Inbox button now opens the full-page inbox. */}
        <div className="hidden">
          <ShowroomGmailPanel
            storeId={id}
            storeName={store.name}
            onUnreadChange={setInboxUnread}
          />
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
        ) : section === "contacts" ? (
          <ContactsSection
            contacts={contacts}
            websiteUrl={store.websiteUrl}
            links={store.links ?? []}
          />
        ) : section === "notes" ? (
          <NotesSection
            notes={notes}
            onAddNote={openCreateNote}
            onEditNote={openEditNote}
            onDeleteNote={setDeleteNoteTarget}
          />
        ) : section === "visits" ? (
          <StoreVisitsSection storeId={id} />
        ) : (
          <PhotosSection
            storeId={id}
            galleryPhotos={galleryPhotos}
            photos={photos}
            uploading={uploading}
            onUploadClick={() => setUploadOpen(true)}
            onImportFiles={uploadPhotos}
            onPhotoSaved={loadPhotos}
            onChanged={loadPhotos}
            onOpenGallery={(index) => {
              setGalleryStartIndex(index);
              setGalleryOpen(true);
            }}
            onDeleteGalleryPhoto={deleteGalleryPhoto}
          />
        )}
      </div>

      {/* Documents linked to this showroom */}
      <div className="mt-8">
        <EntityDocumentsPanel entityType="showroom" entityId={String(id)} />
      </div>

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
          latitude: store.latitude,
          longitude: store.longitude,
        }}
        open={hoursModalOpen}
        onOpenChange={setHoursModalOpen}
        onEditHours={() => setEditHoursOpen(true)}
        onEditAddress={() => setEditAddressOpen(true)}
      />
      <EditHoursModal
        storeId={id}
        hoursJson={store.hoursJson}
        open={editHoursOpen}
        onOpenChange={setEditHoursOpen}
        onSaved={loadStore}
      />
      <EditAddressModal
        storeId={id}
        address={{
          locationStreetNumber: store.locationStreetNumber,
          locationStreetName: store.locationStreetName,
          locationCity: store.locationCity,
          locationState: store.locationState,
          locationZipCode: store.locationZipCode,
          locationAddress: store.locationAddress,
          googleMapsLink: store.googleMapsLink,
        }}
        open={editAddressOpen}
        onOpenChange={setEditAddressOpen}
        onSaved={loadStore}
      />
      <UploadPhotoModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        uploading={uploading}
        onUpload={uploadPhotos}
      />
      <ManageLinksModal
        storeId={id}
        open={manageLinksOpen}
        onOpenChange={setManageLinksOpen}
        onChanged={loadStore}
      />
      <EditStoreModal
        store={store as unknown as EditableStore}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={loadStore}
        // Soft-deleted: this viewport still resolves by id, but the store is
        // gone from every list — send the user back to the directory.
        onDeleted={() => {
          window.location.href = "/admin/shopping/showrooms";
        }}
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

/** How long each brand photo holds before the slideshow advances. */
const SLIDESHOW_INTERVAL_MS = 3_500;

/** One slide: a brand photo plus the brand it belongs to. */
interface BrandSlide {
  brandId: number;
  brandName: string;
  icon: string | null;
  image: string;
}

/**
 * Flatten the brands into a slide list, INTERLEAVED by photo index so the
 * slideshow alternates brands (A1, B1, C1, A2, B2 …) rather than showing six
 * photos of one brand before moving on.
 */
function buildBrandSlides(brands: BrandWithCount[]): BrandSlide[] {
  const withImages = brands.filter((b) => (b.images?.length ?? 0) > 0);
  const deepest = Math.max(0, ...withImages.map((b) => b.images?.length ?? 0));
  const slides: BrandSlide[] = [];
  for (let i = 0; i < deepest; i++) {
    for (const b of withImages) {
      const image = b.images?.[i];
      if (image) {
        slides.push({ brandId: b.id, brandName: b.name, icon: b.iconCfImagesUrl, image });
      }
    }
  }
  return slides;
}

/**
 * Cross-fading slideshow of real brand photography for the Brands & Products
 * bento tile — the tile used to be a large, static wall of lettermarks, which
 * read as empty. Photos come from `brand_images` (captured by the brand
 * research scrape, served off CF Images); each slide is captioned with the
 * owning brand's icon + name so the cycling doubles as brand discovery.
 *
 * Purely decorative — no interactive children, because the bento tile itself is
 * the button. Pauses when the tab is hidden and respects prefers-reduced-motion
 * (which pins it to the first slide rather than cycling).
 */
function BrandsPhotoSlideshow({ slides }: { slides: BrandSlide[] }) {
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());

  // Drop slides whose image 404s so a dead CF Images URL can't freeze the show.
  const usable = useMemo(
    () => slides.filter((s) => !broken.has(s.image)),
    [slides, broken],
  );

  useEffect(() => {
    if (usable.length <= 1) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      // Don't advance in a background tab — otherwise returning to the page
      // shows a burst of catch-up transitions.
      if (document.hidden) return;
      setIndex((i) => (i + 1) % usable.length);
    }, SLIDESHOW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [usable.length]);

  // The active index must stay in range as slides drop out.
  const active = usable.length > 0 ? index % usable.length : 0;
  const current = usable[active];
  if (!current) return null;

  return (
    <div className="space-y-2" aria-hidden>
      <div className="relative h-24 overflow-hidden rounded-lg bg-muted/50 ring-1 ring-border/40">
        {usable.map((s, i) => (
          <img
            key={s.image}
            src={s.image}
            alt=""
            loading="lazy"
            onError={() => setBroken((prev) => new Set(prev).add(s.image))}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-1000 ease-out motion-reduce:transition-none ${
              i === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        {/* Bottom scrim keeps the brand caption legible over any photo. */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background/95 to-transparent" />
        <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-1.5">
          <BrandCardIcon image={current.icon} name={current.brandName} size="xs" />
          <span className="truncate text-[11px] font-medium text-foreground">
            {current.brandName}
          </span>
          {usable.length > 1 ? (
            <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              {active + 1}/{usable.length}
            </span>
          ) : null}
        </div>
      </div>
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover/tile:text-foreground">
        Shop by brand
        <ArrowRight className="size-3.5 transition-transform group-hover/tile:translate-x-0.5" />
      </p>
    </div>
  );
}

/**
 * Preview for the Brands & Products bento tile. Prefers a cycling slideshow of
 * real brand photography; falls back to the angled logo fan when no brand has
 * usable images yet, and to a ghost fan when the store has no brands at all.
 */
function BrandsTilePreview({ brands }: { brands: BrandWithCount[] }) {
  const slides = useMemo(() => buildBrandSlides(brands), [brands]);
  const MAX = 5;
  const shown = brands.slice(0, MAX);
  const overflow = brands.length - shown.length;

  if (slides.length > 0) return <BrandsPhotoSlideshow slides={slides} />;

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
function BrandCardIcon({
  image,
  name,
  size = "md",
}: {
  image: string | null;
  name: string;
  /** `xs` is the slideshow caption chip; `md` the brand list card. */
  size?: "xs" | "md";
}) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(image) && !broken;
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  const box = size === "xs" ? "size-5 rounded" : "size-12 rounded-lg";
  const pad = size === "xs" ? "p-0.5" : "p-1.5";
  const text = size === "xs" ? "text-[9px]" : "text-base";

  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center overflow-hidden bg-muted ring-1 ring-border/40`}
    >
      {showImage ? (
        <img
          src={image ?? undefined}
          alt={`${name} logo`}
          loading="lazy"
          onError={() => setBroken(true)}
          className={`size-full object-contain ${pad}`}
        />
      ) : (
        <span className={`${text} font-semibold text-muted-foreground`}>{letter}</span>
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

// ─── Section: Contacts ──────────────────────────────────────────────────────────

/**
 * Contacts tab — the store's GENERAL_CONTACT front-desk line up top (office /
 * email / fax as tel:/mailto:), then each person via the shared ContactCard,
 * then the store's website + any other links. Replaces the old inline
 * ManagePocsSection.
 */
function ContactsSection({
  contacts,
  websiteUrl,
  links,
}: {
  contacts: ContactRow[];
  websiteUrl: string | null;
  links: Array<{ id: number; url: string; type: string; urlNotes: string | null }>;
}) {
  const general = contacts.find((c) => c.type === "GENERAL_CONTACT") ?? null;
  const people = contacts.filter((c) => c.type !== "GENERAL_CONTACT");
  // Socials render as branded @handle icons via SocialLinks; the website gets
  // its own row. Everything left (OTHER, sale pages) falls through to the
  // generic Globe list below.
  const extraLinks = links.filter(
    (l) =>
      l.url &&
      l.url !== websiteUrl &&
      !(SOCIAL_LINK_TYPES as readonly string[]).includes(l.type),
  );

  return (
    <div className="space-y-6">
      {/* General store contact — prominent. */}
      <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
        <h2 className="text-base font-semibold">Store contact</h2>
        {general ? (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {general.officePhoneNumber ? (
              <a
                href={`tel:${telHref(general.officePhoneNumber, general.officePhoneExtension)}`}
                className="inline-flex items-center gap-2 font-medium text-sky-400 hover:text-sky-300"
              >
                <Phone className="size-4" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Office
                </span>
                <span className="tabular-nums">
                  {fmtPhone(general.officePhoneNumber)}
                  {general.officePhoneExtension ? ` ext. ${general.officePhoneExtension}` : ""}
                </span>
              </a>
            ) : null}
            {general.faxPhoneNumber ? (
              <a
                href={`tel:${telHref(general.faxPhoneNumber)}`}
                className="inline-flex items-center gap-2 font-medium text-sky-400 hover:text-sky-300"
              >
                <Printer className="size-4" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Fax
                </span>
                <span className="tabular-nums">{fmtPhone(general.faxPhoneNumber)}</span>
              </a>
            ) : null}
            {general.emailAddress ? (
              <a
                href={`mailto:${general.emailAddress}`}
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <Mail className="size-4" />
                {general.emailAddress}
              </a>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No general store line recorded yet.
          </p>
        )}

        {/* Website + social profiles + any other links. */}
        {(websiteUrl || links.length > 0) ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/30 pt-3 text-[13px]">
            {websiteUrl ? (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Globe className="size-3.5" /> Website
              </a>
            ) : null}
            <SocialLinks links={links} iconClassName="size-3.5" />
            {extraLinks.map((l) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                title={l.urlNotes ?? undefined}
              >
                <Globe className="size-3.5" /> {l.urlNotes?.trim() || l.type || "Link"}
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {/* People. */}
      <div className="rounded-xl bg-card p-5 ring-1 ring-border/40">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Reps &amp; people ({people.length})</h2>
        </div>
        {people.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No named contacts yet. Add reps from the{" "}
            <a href="/admin/shopping/contacts" className="text-sky-400 hover:text-sky-300">
              Contacts phonebook
            </a>
            .
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {people.map((c) => (
              <ContactCard key={c.id} contact={c} showStoreLink={false} />
            ))}
          </div>
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
                {note.contentMarkdown?.trim() || note.contentHtml?.trim() ? (
                  <NoteBody
                    className="mt-1.5 line-clamp-3"
                    markdown={note.contentMarkdown}
                    html={note.contentHtml}
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
  storeId,
  galleryPhotos,
  photos,
  uploading,
  onUploadClick,
  onImportFiles,
  onPhotoSaved,
  onChanged,
  onOpenGallery,
  onDeleteGalleryPhoto,
}: {
  storeId: number;
  galleryPhotos: GalleryPhoto[];
  photos: ShowroomPhoto[];
  uploading: boolean;
  onUploadClick: () => void;
  onImportFiles: (files: File[]) => void | Promise<void>;
  onPhotoSaved: () => void;
  onChanged: () => void;
  onOpenGallery: (index: number) => void;
  onDeleteGalleryPhoto: (photoId: number) => void;
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
          <div className="flex items-center gap-2">
            <GooglePhotosButton
              variant="outline"
              disabled={uploading}
              onFiles={onImportFiles}
            />
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
        </div>

        <VisitPhotosManager
          storeId={storeId}
          photos={photos}
          onChanged={onChanged}
          onPhotoSaved={onPhotoSaved}
        />
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
