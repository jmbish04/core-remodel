/**
 * @fileoverview AssociateBrandsModal — attach brands to a showroom store.
 *
 * A two-pane Dialog:
 *   - LEFT SIDEBAR: a running stack of brands added during this session, newest
 *     on top. Purely visual confirmation — closing the modal ends the flow.
 *   - MAIN AREA: a debounced (~250ms) autocomplete over `/api/brands?search=`.
 *     Selecting a match associates it; a search that returns no results reveals
 *     an inline "Create new brand" form which creates the brand, then associates
 *     the freshly-created id.
 *
 * Monolith dark conventions mirrored from ShowroomsDirectoryApp: fetch + useState,
 * sonner toast + console.error on every catch, `{ credentials: "include" }`,
 * `bg-card` + `ring-1 ring-border/40` surfaces (no 1px borders), shadcn Dialog
 * (never window.alert/confirm), lucide icons, disable-while-in-flight.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  Globe,
  Instagram,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Brand {
  id: number;
  name: string;
  iconCfImagesUrl?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  description?: string | null;
}

/** A brand as shown in the session sidebar stack. */
interface AddedBrand {
  id: number;
  name: string;
  iconCfImagesUrl?: string | null;
  alreadyExisted?: boolean;
}

// ─── Small internal helpers (duplicated per-file by design; not shared) ─────────

/** GET JSON with credentials, throwing a useful error on non-2xx. */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** POST JSON with credentials, throwing a useful error on non-2xx. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Deterministic tint for the initials fallback avatar. */
const AVATAR_TINTS = [
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-sky-500/20 text-sky-300",
  "bg-violet-500/20 text-violet-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-lime-500/20 text-lime-300",
];

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

// ─── Brand favicon thumbnail (with graceful fallback) ───────────────────────────

function BrandThumb({
  name,
  iconUrl,
  size = "md",
}: {
  name: string;
  iconUrl?: string | null;
  size?: "sm" | "md";
}) {
  const [broken, setBroken] = useState(false);
  const dim = size === "sm" ? "size-7" : "size-9";
  const text = size === "sm" ? "text-[10px]" : "text-xs";
  const showImg = Boolean(iconUrl) && !broken;
  if (showImg) {
    return (
      <img
        src={iconUrl as string}
        alt=""
        onError={() => setBroken(true)}
        className={`${dim} shrink-0 rounded-full bg-card object-contain ring-1 ring-border/40`}
      />
    );
  }
  return (
    <div
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full font-semibold ${text} ${tintFor(name)}`}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ─── Session sidebar (brands added this session) ────────────────────────────────

function AddedSidebar({ added }: { added: AddedBrand[] }) {
  return (
    <aside className="flex min-h-0 flex-col rounded-lg bg-card ring-1 ring-border/40 sm:w-56">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Building2 className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Added this session
        </span>
        {added.length > 0 && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
            {added.length}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {added.length === 0 ? (
          <p className="px-1.5 py-2 text-[11px] leading-relaxed text-muted-foreground/60">
            Brands you attach will stack here. Close the dialog when you're done.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {added.map((b, i) => (
              <li
                key={`${b.id}-${i}`}
                className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5"
              >
                <BrandThumb name={b.name} iconUrl={b.iconCfImagesUrl} size="sm" />
                <span className="line-clamp-1 flex-1 text-xs">{b.name}</span>
                {b.alreadyExisted ? (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-medium text-amber-300">
                    Existing
                  </span>
                ) : (
                  <Check className="size-3.5 shrink-0 text-emerald-400" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ─── Inline "create new brand" form ─────────────────────────────────────────────

function CreateBrandForm({
  initialName,
  submitting,
  onCancel,
  onCreate,
}: {
  initialName: string;
  submitting: boolean;
  onCancel: () => void;
  onCreate: (fields: {
    name: string;
    websiteUrl?: string;
    instagramUrl?: string;
    description?: string;
  }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({
      name: trimmed,
      websiteUrl: websiteUrl.trim() || undefined,
      instagramUrl: instagramUrl.trim() || undefined,
      description: description.trim() || undefined,
    });
  };

  return (
    <div className="space-y-3 rounded-lg bg-card p-3 ring-1 ring-border/40">
      <div className="flex items-center gap-2">
        <Plus className="size-3.5 text-primary" />
        <span className="text-xs font-medium">Create new brand</span>
      </div>
      <div className="space-y-1">
        <Label htmlFor="brand-name">Name *</Label>
        <Input
          id="brand-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Kohler"
          autoFocus
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="brand-website">Website</Label>
          <Input
            id="brand-website"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="brand-instagram">Instagram</Label>
          <Input
            id="brand-instagram"
            value={instagramUrl}
            onChange={(e) => setInstagramUrl(e.target.value)}
            placeholder="https://instagram.com/…"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="brand-description">Description</Label>
        <Textarea
          id="brand-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (optional)"
          rows={2}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        The brand favicon is scraped server-side and may appear shortly after creation.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={submitting || !name.trim()}>
          {submitting && <Loader2 className="mr-1.5 size-3 animate-spin" />}
          Create &amp; attach
        </Button>
      </div>
    </div>
  );
}

// ─── Main modal ─────────────────────────────────────────────────────────────────

export function AssociateBrandsModal({
  showroomId,
  open,
  onOpenChange,
  onChanged,
}: {
  showroomId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Brand[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [added, setAdded] = useState<AddedBrand[]>([]);

  // A monotonically increasing token so a slow in-flight search can't clobber a
  // newer one's results.
  const searchSeq = useRef(0);

  // Reset transient state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSearching(false);
      setSearched(false);
      setShowCreate(false);
      setAdded([]);
    }
  }, [open]);

  // Debounced (~250ms) search over the brand catalog.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      setShowCreate(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const handle = setTimeout(async () => {
      try {
        const data = await getJson<{ brands: Brand[] }>(
          `/api/brands?search=${encodeURIComponent(q)}`,
        );
        if (seq !== searchSeq.current) return; // stale
        setResults(data.brands ?? []);
        setSearched(true);
        setShowCreate((data.brands ?? []).length === 0);
      } catch (e) {
        if (seq !== searchSeq.current) return;
        console.error("Brand search failed", e);
        toast.error(e instanceof Error ? e.message : "Brand search failed");
        setResults([]);
        setSearched(true);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open]);

  const pushAdded = useCallback(
    (b: AddedBrand) => {
      setAdded((prev) => [b, ...prev]);
      onChanged?.();
    },
    [onChanged],
  );

  /** Associate an existing brand id with this showroom. */
  const attachBrand = useCallback(
    async (brand: Brand) => {
      setSubmitting(true);
      try {
        const resp = await postJson<{ alreadyExists?: boolean }>(
          `/api/showroom-stores/${showroomId}/brands`,
          { brandId: brand.id },
        );
        pushAdded({
          id: brand.id,
          name: brand.name,
          iconCfImagesUrl: brand.iconCfImagesUrl,
          alreadyExisted: resp.alreadyExists === true,
        });
        toast.success(
          resp.alreadyExists ? `${brand.name} was already attached` : `Attached ${brand.name}`,
        );
        // Reset the search so the user can add another.
        setQuery("");
        setResults([]);
        setSearched(false);
        setShowCreate(false);
      } catch (e) {
        console.error("Attach brand failed", e);
        toast.error(e instanceof Error ? e.message : "Failed to attach brand");
      } finally {
        setSubmitting(false);
      }
    },
    [showroomId, pushAdded],
  );

  /** Create a brand, then attach it. */
  const createAndAttach = useCallback(
    async (fields: {
      name: string;
      websiteUrl?: string;
      instagramUrl?: string;
      description?: string;
    }) => {
      setSubmitting(true);
      try {
        // POST /api/brands returns the created row WRAPPED as { brand: {...} }.
        const created = (await postJson<{ brand: Brand }>("/api/brands", fields))
          .brand;
        const resp = await postJson<{ alreadyExists?: boolean }>(
          `/api/showroom-stores/${showroomId}/brands`,
          { brandId: created.id },
        );
        pushAdded({
          id: created.id,
          name: created.name ?? fields.name,
          iconCfImagesUrl: created.iconCfImagesUrl,
          alreadyExisted: resp.alreadyExists === true,
        });
        toast.success(`Created & attached ${created.name ?? fields.name}`);
        setQuery("");
        setResults([]);
        setSearched(false);
        setShowCreate(false);
      } catch (e) {
        console.error("Create brand failed", e);
        toast.error(e instanceof Error ? e.message : "Failed to create brand");
      } finally {
        setSubmitting(false);
      }
    },
    [showroomId, pushAdded],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attach brands</DialogTitle>
          <DialogDescription>
            Search the brand catalog and attach matches to this showroom. Not listed? Create it
            inline.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex max-h-[64vh] min-h-0 flex-col gap-4 sm:flex-row">
          <AddedSidebar added={added} />

          {/* Main area */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search brands…"
                className="pl-8"
                autoFocus
              />
              {searching && (
                <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {/* Results list */}
              {results.length > 0 && !showCreate && (
                <ul className="flex flex-col gap-1">
                  {results.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => attachBrand(b)}
                        className="flex w-full items-center gap-3 rounded-lg bg-card px-3 py-2 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/40 disabled:opacity-50"
                      >
                        <BrandThumb name={b.name} iconUrl={b.iconCfImagesUrl} />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-sm font-medium">{b.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                            {b.websiteUrl && (
                              <span className="inline-flex items-center gap-1">
                                <Globe className="size-3" />
                                Site
                              </span>
                            )}
                            {b.instagramUrl && (
                              <span className="inline-flex items-center gap-1">
                                <Instagram className="size-3" />
                                IG
                              </span>
                            )}
                            {b.description && (
                              <span className="line-clamp-1">{b.description}</span>
                            )}
                          </div>
                        </div>
                        <Plus className="size-4 shrink-0 text-primary" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* No-results → create form */}
              {showCreate && (
                <CreateBrandForm
                  initialName={query.trim()}
                  submitting={submitting}
                  onCancel={() => {
                    setShowCreate(false);
                    setQuery("");
                    setSearched(false);
                  }}
                  onCreate={createAndAttach}
                />
              )}

              {/* Empty / idle states */}
              {!showCreate && results.length === 0 && (
                <div className="flex min-h-[120px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  {searching
                    ? "Searching…"
                    : query.trim() === ""
                      ? "Start typing to search the brand catalog."
                      : searched
                        ? "No matches."
                        : ""}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
