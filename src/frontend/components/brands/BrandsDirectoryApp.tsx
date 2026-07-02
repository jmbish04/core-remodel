/**
 * @fileoverview BrandsDirectoryApp — brand listing + full CRUD.
 *
 * A card grid over `/api/brands?include=types`, grouped into sections by brand
 * TYPE (a multi-typed brand appears under each; untyped brands fall under
 * "Uncategorized"). Each card surfaces:
 *   - the auto-scraped favicon (iconCfImagesUrl) with an initials fallback,
 *   - name, website (Globe) + Instagram links,
 *   - metric badges: productCount (PackageSearch) + online/user rating stars,
 *   - type badges with inline add / remove chip management,
 *   - a "View Details" link to /admin/brands/:id,
 *   - edit (dialog → PUT) and delete (AlertDialog confirm → DELETE).
 *
 * Filters: search + category (brand type) Select + min-rating Select, plus
 * name/newest sort. Create dialog collects name/description/website/instagram +
 * a multi-select of brand types (from `/api/brands/types?activeOnly=true`) and
 * POSTs typeIds. The favicon fills in asynchronously after create (favicon
 * scrape), so we refetch on a short delay and surface an "icon pending" state.
 *
 * Monolith dark: no 1px borders (ring-1 ring-border/40, bg-card,
 * divide-y divide-border/40), sort + filter, loading/empty/error states,
 * sonner toasts, no mock data, mobile responsive.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpRight,
  Building2,
  ChevronDown,
  Globe,
  ImageOff,
  Instagram,
  Loader2,
  PackageSearch,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MultipleSelector } from "@/components/ui/multiple-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface BrandTypeRef {
  typeId: number;
  name: string;
}

interface Brand {
  id: number;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  iconCfImagesUrl: string | null;
  personalNotes?: string | null;
  onlineRating?: number | null;
  userRating?: number | null;
  productCount?: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  types?: BrandTypeRef[];
}

interface BrandTypeDef {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string | null;
}

type SortKey = "name" | "createdAt";
type SortDir = "asc" | "desc";

// Sentinel section id for brands with no assigned type.
const UNCATEGORIZED = "uncategorized";
// Sentinel value for "no filter" in the Select controls (Radix disallows "").
const FILTER_ALL = "__all__";
const MIN_RATING_OPTIONS = [
  { value: FILTER_ALL, label: "Any rating" },
  { value: "3", label: "3★ & up" },
  { value: "4", label: "4★ & up" },
  { value: "4.5", label: "4.5★ & up" },
];

// Deterministic initials-avatar palette (JIT-safe literal classes).
const AVATAR_COLORS = [
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-sky-500/20 text-sky-300",
  "bg-violet-500/20 text-violet-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-lime-500/20 text-lime-300",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function brandTypes(b: Brand): BrandTypeRef[] {
  return b.types ?? [];
}

// The higher of the two ratings — used for the min-rating filter.
function bestRating(b: Brand): number {
  return Math.max(b.onlineRating ?? 0, b.userRating ?? 0);
}

// ─── Rating star pill ─────────────────────────────────────────────────────────

function RatingPill({
  value,
  variant,
  label,
}: {
  value: number;
  variant: "online" | "user";
  label: string;
}) {
  const tint =
    variant === "online"
      ? "bg-amber-500/15 text-amber-300"
      : "bg-primary/15 text-primary";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tint}`}
      title={`${label}: ${value.toFixed(1)} / 5`}
    >
      <Star className="size-2.5 fill-current" />
      {value.toFixed(1)}
    </span>
  );
}

// ─── Favicon / initials avatar ────────────────────────────────────────────────

function BrandIcon({ brand }: { brand: Brand }) {
  const [broken, setBroken] = useState(false);
  const showFavicon = Boolean(brand.iconCfImagesUrl) && !broken;

  if (showFavicon) {
    return (
      <img
        src={brand.iconCfImagesUrl as string}
        alt=""
        onError={() => setBroken(true)}
        className="size-11 shrink-0 rounded-lg bg-card object-contain p-1 ring-1 ring-border/40"
      />
    );
  }
  // Icon may still be scraping (present in list right after create) — show a
  // subtle pending affordance instead of the initials when we know it's new.
  if (!brand.iconCfImagesUrl && brand.websiteUrl) {
    return (
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border/40">
        <ImageOff className="size-4" aria-label="Icon pending" />
      </div>
    );
  }
  return (
    <div
      className={`flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${avatarColor(brand.name)}`}
    >
      {brand.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ─── Type chips w/ inline add + remove ────────────────────────────────────────

function TypeChips({
  brand,
  allTypes,
  onChanged,
}: {
  brand: Brand;
  allTypes: BrandTypeDef[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyTypeId, setBusyTypeId] = useState<number | null>(null);
  const assigned = brandTypes(brand);
  const assignedIds = new Set(assigned.map((t) => t.typeId));
  const available = allTypes.filter((t) => !assignedIds.has(t.id));

  const addType = async (typeId: number) => {
    setBusyTypeId(typeId);
    try {
      await apiJson<{ mapping: unknown }>(`/api/brands/${brand.id}/types`, {
        method: "POST",
        body: JSON.stringify({ typeId }),
      });
      toast.success("Type added");
      setOpen(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add type");
    } finally {
      setBusyTypeId(null);
    }
  };

  const removeType = async (typeId: number) => {
    setBusyTypeId(typeId);
    try {
      await apiJson<{ success: true }>(`/api/brands/${brand.id}/types/${typeId}`, {
        method: "DELETE",
      });
      toast.success("Type removed");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove type");
    } finally {
      setBusyTypeId(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {assigned.map((t) => (
        <span
          key={t.typeId}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
        >
          {t.name}
          <button
            type="button"
            onClick={() => void removeType(t.typeId)}
            disabled={busyTypeId === t.typeId}
            className="text-muted-foreground transition hover:text-rose-400 disabled:opacity-50"
            aria-label={`Remove ${t.name}`}
          >
            {busyTypeId === t.typeId ? (
              <Loader2 className="size-2.5 animate-spin" />
            ) : (
              <X className="size-2.5" />
            )}
          </button>
        </span>
      ))}

      {/* Add-type dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Add type"
        >
          <Plus className="size-2.5" />
          Type
          <ChevronDown className="size-2.5" />
        </button>
        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-56 min-w-[180px] overflow-y-auto rounded-md bg-popover p-1 shadow-lg ring-1 ring-border/40">
            {available.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
                All types assigned
              </div>
            ) : (
              available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void addType(t.id)}
                  disabled={busyTypeId === t.id}
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs text-foreground/80 transition hover:bg-muted/60 disabled:opacity-50"
                >
                  {busyTypeId === t.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Plus className="size-3 text-muted-foreground" />
                  )}
                  {t.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Brand card ────────────────────────────────────────────────────────────────

function BrandCard({
  brand,
  allTypes,
  onEdit,
  onDelete,
  onTypesChanged,
}: {
  brand: Brand;
  allTypes: BrandTypeDef[];
  onEdit: (b: Brand) => void;
  onDelete: (b: Brand) => void;
  onTypesChanged: () => void;
}) {
  const productCount = brand.productCount ?? 0;
  return (
    <article className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border/40 transition-colors hover:bg-muted/20">
      <div className="flex items-start gap-3">
        <BrandIcon brand={brand} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-1 text-sm font-medium">{brand.name}</h3>
          {brand.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {brand.description}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {brand.websiteUrl && (
              <a
                href={brand.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Globe className="size-3" />
                Website
              </a>
            )}
            {brand.instagramUrl && (
              <a
                href={brand.instagramUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Instagram className="size-3" />
                Instagram
              </a>
            )}
            {!brand.iconCfImagesUrl && brand.websiteUrl && (
              <span className="inline-flex items-center gap-1 text-amber-300/80">
                <Loader2 className="size-3 animate-spin" />
                icon pending
              </span>
            )}
          </div>

          {/* Metric badges: product count + ratings */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <PackageSearch className="size-2.5" />
              {productCount} {productCount === 1 ? "Product" : "Products"}
            </span>
            {typeof brand.onlineRating === "number" && brand.onlineRating > 0 && (
              <RatingPill value={brand.onlineRating} variant="online" label="Online rating" />
            )}
            {typeof brand.userRating === "number" && brand.userRating > 0 && (
              <RatingPill value={brand.userRating} variant="user" label="Your rating" />
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(brand)}
            aria-label={`Edit ${brand.name}`}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:text-rose-400"
            onClick={() => onDelete(brand)}
            aria-label={`Delete ${brand.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
        <TypeChips brand={brand} allTypes={allTypes} onChanged={onTypesChanged} />
        <a
          href={`/admin/brands/${brand.id}`}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary transition hover:bg-primary/20"
          aria-label={`View details for ${brand.name}`}
        >
          View Details
          <ArrowUpRight className="size-2.5" />
        </a>
      </div>
    </article>
  );
}

// ─── Create / Edit dialog ──────────────────────────────────────────────────────

interface BrandForm {
  name: string;
  description: string;
  websiteUrl: string;
  instagramUrl: string;
  typeIds: string[]; // MultipleSelector works on string values
}

const EMPTY_FORM: BrandForm = {
  name: "",
  description: "",
  websiteUrl: "",
  instagramUrl: "",
  typeIds: [],
};

function BrandEditorDialog({
  open,
  onOpenChange,
  editing,
  allTypes,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Brand | null;
  allTypes: BrandTypeDef[];
  onSaved: (createdBrandId?: number) => void;
}) {
  const [form, setForm] = useState<BrandForm>({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              name: editing.name,
              description: editing.description ?? "",
              websiteUrl: editing.websiteUrl ?? "",
              instagramUrl: editing.instagramUrl ?? "",
              // typeIds aren't editable via PUT — hide the picker when editing.
              typeIds: [],
            }
          : { ...EMPTY_FORM },
      );
    }
  }, [open, editing]);

  const update = (patch: Partial<BrandForm>) => setForm((f) => ({ ...f, ...patch }));

  const typeOptions = useMemo(
    () => allTypes.map((t) => ({ value: String(t.id), label: t.name })),
    [allTypes],
  );

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Brand name is required");
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await apiJson<{ brand: Brand }>(`/api/brands/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            websiteUrl: form.websiteUrl.trim() || null,
            instagramUrl: form.instagramUrl.trim() || null,
          }),
        });
        toast.success(`"${form.name.trim()}" updated`);
        onOpenChange(false);
        onSaved();
      } else {
        const body: Record<string, unknown> = { name: form.name.trim() };
        if (form.description.trim()) body.description = form.description.trim();
        if (form.websiteUrl.trim()) body.websiteUrl = form.websiteUrl.trim();
        if (form.instagramUrl.trim()) body.instagramUrl = form.instagramUrl.trim();
        if (form.typeIds.length > 0) body.typeIds = form.typeIds.map((id) => Number(id));

        const data = await apiJson<{ brand: Brand }>("/api/brands", {
          method: "POST",
          body: JSON.stringify(body),
        });
        toast.success(
          form.websiteUrl.trim()
            ? `"${form.name.trim()}" added — scraping icon in the background.`
            : `"${form.name.trim()}" added.`,
        );
        onOpenChange(false);
        onSaved(data.brand?.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save brand");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Brand" : "New Brand"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this brand's details. Manage its types from its card."
              : "Add a brand. Its favicon is scraped automatically from the website."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="b-name">Name *</Label>
            <Input
              id="b-name"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Kohler"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="b-desc">Description</Label>
            <Textarea
              id="b-desc"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Optional — what this brand supplies."
              rows={2}
            />
          </div>
          <div>
            <Label htmlFor="b-web">Website</Label>
            <Input
              id="b-web"
              value={form.websiteUrl}
              onChange={(e) => update({ websiteUrl: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div>
            <Label htmlFor="b-ig">Instagram</Label>
            <Input
              id="b-ig"
              value={form.instagramUrl}
              onChange={(e) => update({ instagramUrl: e.target.value })}
              placeholder="https://instagram.com/…"
            />
          </div>
          {!editing && (
            <div>
              <Label>Types</Label>
              <MultipleSelector
                options={typeOptions}
                value={form.typeIds}
                onValueChange={(next) => update({ typeIds: next })}
                placeholder="Select brand types…"
                title="Brand types"
                searchPlaceholder="Search types…"
                emptyMessage="No active brand types. Create some first."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.name.trim()}>
            {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {editing ? "Save Changes" : "Create Brand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirm ─────────────────────────────────────────────────────────────

function DeleteBrandDialog({
  target,
  onOpenChange,
  onDeleted,
}: {
  target: Brand | null;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      await apiJson<{ success: true }>(`/api/brands/${target.id}`, { method: "DELETE" });
      toast.success(`"${target.name}" deleted`);
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete brand");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{target?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the brand and its type mappings. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              void handleDelete();
            }}
            disabled={deleting}
          >
            {deleting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function BrandsDirectoryApp() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [allTypes, setAllTypes] = useState<BrandTypeDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<number | null>(null);
  const [minRating, setMinRating] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);

  const fetchBrands = useCallback(async () => {
    setError(null);
    try {
      const data = await apiJson<{ brands: Brand[] }>("/api/brands?include=types");
      setBrands(data.brands ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load brands";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTypes = useCallback(async () => {
    try {
      const data = await apiJson<{ types: BrandTypeDef[] }>("/api/brands/types?activeOnly=true");
      setAllTypes(data.types ?? []);
    } catch {
      // Non-critical — type filter + picker just won't populate.
    }
  }, []);

  useEffect(() => {
    void fetchBrands();
    void fetchTypes();
  }, [fetchBrands, fetchTypes]);

  // After a create with a website, the favicon scrape resolves async — refetch
  // once on a short delay so the icon lands without a manual reload.
  const handleSaved = useCallback(
    (createdBrandId?: number) => {
      void fetchBrands();
      if (createdBrandId) {
        window.setTimeout(() => void fetchBrands(), 3500);
      }
    },
    [fetchBrands],
  );

  // Search + type + min-rating filter, then sort.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = brands.filter((b) => {
      if (
        q &&
        !b.name.toLowerCase().includes(q) &&
        !(b.description ?? "").toLowerCase().includes(q)
      )
        return false;
      if (typeFilter !== null && !brandTypes(b).some((t) => t.typeId === typeFilter)) return false;
      if (minRating > 0 && bestRating(b) < minRating) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [brands, search, typeFilter, minRating, sortKey, sortDir]);

  // Group the filtered brands under one section per brand TYPE. A brand with
  // multiple types appears under each; a brand with no type falls under
  // "Uncategorized". When a type filter is active, only that section shows.
  const groups = useMemo(() => {
    // Preserve loaded type order for stable section ordering.
    const orderedTypes =
      typeFilter !== null ? allTypes.filter((t) => t.id === typeFilter) : allTypes;

    const sections: { key: string; label: string; brands: Brand[] }[] = orderedTypes
      .map((t) => ({
        key: String(t.id),
        label: t.name,
        brands: visible.filter((b) => brandTypes(b).some((r) => r.typeId === t.id)),
      }))
      .filter((s) => s.brands.length > 0);

    // Uncategorized only when no explicit type filter is applied.
    if (typeFilter === null) {
      const uncategorized = visible.filter((b) => brandTypes(b).length === 0);
      if (uncategorized.length > 0) {
        sections.push({ key: UNCATEGORIZED, label: "Uncategorized", brands: uncategorized });
      }
    }
    return sections;
  }, [visible, allTypes, typeFilter]);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (b: Brand) => {
    setEditing(b);
    setEditorOpen(true);
  };

  const hasFilters = Boolean(search) || typeFilter !== null || minRating > 0;

  const resetFilters = () => {
    setSearch("");
    setTypeFilter(null);
    setMinRating(0);
  };

  const typeFilterValue = typeFilter === null ? FILTER_ALL : String(typeFilter);
  const typeSelectItems = [
    { value: FILTER_ALL, label: "All categories" },
    ...allTypes.map((t) => ({ value: String(t.id), label: t.name })),
  ];
  const minRatingValue = minRating === 0 ? FILTER_ALL : String(minRating);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Building2 className="size-5 text-muted-foreground" />
            Brands
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Brand directory grouped by category, with auto-scraped icons, ratings, and product counts.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="size-3.5" />
          New Brand
        </Button>
      </div>

      {/* Controls */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search brands…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Category (type) filter */}
        <Select
          value={typeFilterValue}
          onValueChange={(v) => setTypeFilter(!v || v === FILTER_ALL ? null : Number(v))}
        >
          <SelectTrigger
            className="h-9 w-full shrink-0 text-xs sm:w-44"
            aria-label="Filter by category"
          >
            <SelectValue items={typeSelectItems} placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {typeSelectItems.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Min-rating filter */}
        <Select
          value={minRatingValue}
          onValueChange={(v) => setMinRating(!v || v === FILTER_ALL ? 0 : Number(v))}
        >
          <SelectTrigger
            className="h-9 w-full shrink-0 text-xs sm:w-36"
            aria-label="Filter by minimum rating"
          >
            <SelectValue items={MIN_RATING_OPTIONS} placeholder="Rating" />
          </SelectTrigger>
          <SelectContent>
            {MIN_RATING_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant={sortKey === "name" ? "default" : "outline"}
            onClick={() => {
              if (sortKey === "name") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              else {
                setSortKey("name");
                setSortDir("asc");
              }
            }}
            className="h-9 gap-1 text-xs"
          >
            Name
            {sortKey === "name" &&
              (sortDir === "asc" ? (
                <ArrowUpAZ className="size-3.5" />
              ) : (
                <ArrowDownAZ className="size-3.5" />
              ))}
          </Button>
          <Button
            size="sm"
            variant={sortKey === "createdAt" ? "default" : "outline"}
            onClick={() => {
              if (sortKey === "createdAt") setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              else {
                setSortKey("createdAt");
                setSortDir("desc");
              }
            }}
            className="h-9 gap-1 text-xs"
          >
            Newest
          </Button>
        </div>

        {hasFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={resetFilters}
            className="h-9 shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            Reset
          </Button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg bg-card p-6 text-center ring-1 ring-border/40">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void fetchBrands()}>
            <RotateCcw className="mr-1.5 size-3.5" />
            Retry
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg bg-card p-6 text-center ring-1 ring-border/40">
          <p className="text-sm text-muted-foreground">
            {brands.length === 0
              ? "No brands yet. Add your first one."
              : "No brands match your filters."}
          </p>
          {brands.length === 0 && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 size-3.5" />
              New Brand
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((section) => (
            <section key={section.key}>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-foreground/90">
                  {section.label}
                </h2>
                <Badge
                  variant="secondary"
                  className="rounded-full px-1.5 py-0 text-[10px] font-medium"
                >
                  {section.brands.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {section.brands.map((b) => (
                  <BrandCard
                    key={`${section.key}-${b.id}`}
                    brand={b}
                    allTypes={allTypes}
                    onEdit={openEdit}
                    onDelete={setDeleteTarget}
                    onTypesChanged={fetchBrands}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <BrandEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        allTypes={allTypes}
        onSaved={handleSaved}
      />
      <DeleteBrandDialog
        target={deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        onDeleted={fetchBrands}
      />
    </main>
  );
}
