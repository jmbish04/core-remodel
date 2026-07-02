/**
 * @fileoverview AssociateProductsModal — map products onto a showroom store.
 *
 * Same two-pane shell as AssociateBrandsModal:
 *   - LEFT SIDEBAR: a running stack of products mapped during this session.
 *   - MAIN AREA: a debounced (~250ms) autocomplete over
 *     `/api/showroom-products/search?q=`. Selecting a match maps it. A search
 *     with no results reveals an inline "Create new product" form.
 *
 * The create form embeds a NESTED brand autocomplete: type a brand →
 * `/api/brands?search=` → pick an existing brand (sets brandId), OR if there are
 * no matches, expand a nested "Create brand" sub-form → `POST /api/brands` and
 * use the created id. Once a brand is chosen the product is created via
 * `POST /api/showroom-stores/${showroomId}/products` and then mapped via
 * `POST /api/showroom-stores/${showroomId}/mapped-products`.
 *
 * Monolith dark conventions mirrored from ShowroomsDirectoryApp: fetch + useState,
 * sonner toast + console.error on every catch, `{ credentials: "include" }`,
 * `bg-card` + `ring-1 ring-border/40` (no 1px borders), shadcn Dialog (never
 * window.alert/confirm), lucide icons, disable-while-in-flight.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  Loader2,
  Package,
  Plus,
  Search,
  Tag,
  X,
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

interface ProductMatch {
  id: number;
  itemName: string;
  storeId?: number | null;
  brandId?: number | null;
  brandName?: string | null;
}

interface Brand {
  id: number;
  name: string;
  iconCfImagesUrl?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
}

/** A product as shown in the session sidebar stack. */
interface AddedProduct {
  id: number;
  itemName: string;
  brandName?: string | null;
  alreadyExisted?: boolean;
}

// ─── Small internal helpers (duplicated per-file by design; not shared) ─────────

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

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

// ─── Session sidebar (products mapped this session) ─────────────────────────────

function AddedSidebar({ added }: { added: AddedProduct[] }) {
  return (
    <aside className="flex min-h-0 flex-col rounded-lg bg-card ring-1 ring-border/40 sm:w-56">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Package className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Mapped this session
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
            Products you map will stack here. Close the dialog when you're done.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {added.map((p, i) => (
              <li
                key={`${p.id}-${i}`}
                className="flex items-start gap-2 rounded-md bg-muted/40 px-2 py-1.5"
              >
                <Package className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-xs font-medium">{p.itemName}</div>
                  {p.brandName && (
                    <div className="line-clamp-1 text-[10px] text-muted-foreground">
                      {p.brandName}
                    </div>
                  )}
                </div>
                {p.alreadyExisted ? (
                  <span className="mt-0.5 shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-medium text-amber-300">
                    Mapped
                  </span>
                ) : (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ─── Nested brand picker (autocomplete + inline create sub-form) ────────────────

interface ChosenBrand {
  id: number;
  name: string;
}

function BrandPicker({
  value,
  onChange,
  disabled,
}: {
  value: ChosenBrand | null;
  onChange: (b: ChosenBrand | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Brand[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Sub-form fields.
  const [newName, setNewName] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [newInstagram, setNewInstagram] = useState("");

  const seq = useRef(0);

  // Debounced (~250ms) brand search — only while unselected & no create form.
  useEffect(() => {
    if (value || showCreate) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const s = ++seq.current;
    const handle = setTimeout(async () => {
      try {
        const data = await getJson<{ brands: Brand[] }>(
          `/api/brands?search=${encodeURIComponent(q)}`,
        );
        if (s !== seq.current) return;
        setResults(data.brands ?? []);
        setSearched(true);
      } catch (e) {
        if (s !== seq.current) return;
        console.error("Nested brand search failed", e);
        toast.error(e instanceof Error ? e.message : "Brand search failed");
        setResults([]);
        setSearched(true);
      } finally {
        if (s === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, value, showCreate]);

  const openCreate = () => {
    setNewName(query.trim());
    setNewWebsite("");
    setNewInstagram("");
    setShowCreate(true);
  };

  const createBrand = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      // POST /api/brands returns the created row WRAPPED as { brand: {...} }.
      const created = (
        await postJson<{ brand: Brand }>("/api/brands", {
          name,
          websiteUrl: newWebsite.trim() || undefined,
          instagramUrl: newInstagram.trim() || undefined,
        })
      ).brand;
      onChange({ id: created.id, name: created.name ?? name });
      toast.success(`Created brand ${created.name ?? name}`);
      setShowCreate(false);
      setQuery("");
      setResults([]);
      setSearched(false);
    } catch (e) {
      console.error("Nested create brand failed", e);
      toast.error(e instanceof Error ? e.message : "Failed to create brand");
    } finally {
      setCreating(false);
    }
  };

  // Selected state — compact chip with a clear button.
  if (value) {
    return (
      <div className="space-y-1">
        <Label>Brand *</Label>
        <div className="flex items-center gap-2 rounded-md bg-card px-3 py-2 ring-1 ring-border/40">
          <Building2 className="size-3.5 text-primary" />
          <span className="line-clamp-1 flex-1 text-sm">{value.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Clear brand"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Create sub-form.
  if (showCreate) {
    return (
      <div className="space-y-3 rounded-md bg-muted/30 p-3 ring-1 ring-border/40">
        <div className="flex items-center gap-2">
          <Plus className="size-3.5 text-primary" />
          <span className="text-xs font-medium">Create new brand</span>
        </div>
        <div className="space-y-1">
          <Label htmlFor="np-brand-name">Name *</Label>
          <Input
            id="np-brand-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Kohler"
            autoFocus
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="np-brand-website">Website</Label>
            <Input
              id="np-brand-website"
              value={newWebsite}
              onChange={(e) => setNewWebsite(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="np-brand-instagram">Instagram</Label>
            <Input
              id="np-brand-instagram"
              value={newInstagram}
              onChange={(e) => setNewInstagram(e.target.value)}
              placeholder="https://instagram.com/…"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowCreate(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={createBrand} disabled={creating || !newName.trim()}>
            {creating && <Loader2 className="mr-1.5 size-3 animate-spin" />}
            Create brand
          </Button>
        </div>
      </div>
    );
  }

  // Autocomplete state.
  return (
    <div className="space-y-1">
      <Label htmlFor="np-brand-search">Brand *</Label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="np-brand-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brands…"
          className="pl-8"
          disabled={disabled}
        />
        {searching && (
          <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {query.trim() !== "" && (
        <div className="mt-1 max-h-44 overflow-y-auto rounded-md bg-card p-1 ring-1 ring-border/40">
          {results.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {results.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange({ id: b.id, name: b.name });
                      setQuery("");
                      setResults([]);
                      setSearched(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
                  >
                    <Building2 className="size-3.5 text-muted-foreground" />
                    <span className="line-clamp-1 flex-1">{b.name}</span>
                    <Plus className="size-3.5 text-primary" />
                  </button>
                </li>
              ))}
            </ul>
          ) : searching ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">Searching…</div>
          ) : searched ? (
            <button
              type="button"
              onClick={openCreate}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm text-primary hover:bg-muted/60"
            >
              <Plus className="size-3.5" />
              Create brand “{query.trim()}”
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Inline "create new product" form (with nested brand picker) ────────────────

function CreateProductForm({
  initialName,
  submitting,
  onCancel,
  onCreate,
}: {
  initialName: string;
  submitting: boolean;
  onCancel: () => void;
  onCreate: (fields: {
    itemName: string;
    description?: string;
    colors?: string;
    preferredColor?: string;
    sku?: string;
    price?: string;
    leadTime?: string;
    notes?: string;
    brandId: number;
    brandName: string;
  }) => void;
}) {
  const [itemName, setItemName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [colors, setColors] = useState("");
  const [preferredColor, setPreferredColor] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [notes, setNotes] = useState("");
  const [brand, setBrand] = useState<ChosenBrand | null>(null);

  useEffect(() => {
    setItemName(initialName);
  }, [initialName]);

  const submit = () => {
    const name = itemName.trim();
    if (!name) {
      toast.error("Product name is required");
      return;
    }
    if (!brand) {
      toast.error("Select or create a brand first");
      return;
    }
    onCreate({
      itemName: name,
      description: description.trim() || undefined,
      colors: colors.trim() || undefined,
      preferredColor: preferredColor.trim() || undefined,
      sku: sku.trim() || undefined,
      price: price.trim() || undefined,
      leadTime: leadTime.trim() || undefined,
      notes: notes.trim() || undefined,
      brandId: brand.id,
      brandName: brand.name,
    });
  };

  return (
    <div className="space-y-3 rounded-lg bg-card p-3 ring-1 ring-border/40">
      <div className="flex items-center gap-2">
        <Plus className="size-3.5 text-primary" />
        <span className="text-xs font-medium">Create new product</span>
      </div>

      <div className="space-y-1">
        <Label htmlFor="np-item-name">Product name *</Label>
        <Input
          id="np-item-name"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder="e.g. Purist Single-Handle Faucet"
          autoFocus
        />
      </div>

      {/* Nested brand picker */}
      <BrandPicker value={brand} onChange={setBrand} disabled={submitting} />

      <div className="space-y-1">
        <Label htmlFor="np-description">Description</Label>
        <Textarea
          id="np-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (optional)"
          rows={2}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="np-colors">Colors</Label>
          <Input
            id="np-colors"
            value={colors}
            onChange={(e) => setColors(e.target.value)}
            placeholder="e.g. Matte Black, Brass"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="np-preferred-color">Preferred color</Label>
          <Input
            id="np-preferred-color"
            value={preferredColor}
            onChange={(e) => setPreferredColor(e.target.value)}
            placeholder="e.g. Matte Black"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="np-sku">SKU</Label>
          <Input
            id="np-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="e.g. K-14402-4A"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="np-price">Price</Label>
          <Input
            id="np-price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. $499"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="np-lead-time">Lead time</Label>
          <Input
            id="np-lead-time"
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            placeholder="e.g. 4–6 weeks"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="np-notes">Notes</Label>
        <Textarea
          id="np-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else worth remembering"
          rows={2}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={submitting || !itemName.trim() || !brand}
        >
          {submitting && <Loader2 className="mr-1.5 size-3 animate-spin" />}
          Create &amp; map
        </Button>
      </div>
    </div>
  );
}

// ─── Main modal ─────────────────────────────────────────────────────────────────

export function AssociateProductsModal({
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
  const [results, setResults] = useState<ProductMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [added, setAdded] = useState<AddedProduct[]>([]);

  const searchSeq = useRef(0);

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

  // Debounced (~250ms) product search.
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
        const data = await getJson<{ products: ProductMatch[] }>(
          `/api/showroom-products/search?q=${encodeURIComponent(q)}`,
        );
        if (seq !== searchSeq.current) return;
        setResults(data.products ?? []);
        setSearched(true);
        setShowCreate((data.products ?? []).length === 0);
      } catch (e) {
        if (seq !== searchSeq.current) return;
        console.error("Product search failed", e);
        toast.error(e instanceof Error ? e.message : "Product search failed");
        setResults([]);
        setSearched(true);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open]);

  const pushAdded = useCallback(
    (p: AddedProduct) => {
      setAdded((prev) => [p, ...prev]);
      onChanged?.();
    },
    [onChanged],
  );

  const resetSearch = useCallback(() => {
    setQuery("");
    setResults([]);
    setSearched(false);
    setShowCreate(false);
  }, []);

  /** Map an existing product id onto this showroom. */
  const mapProduct = useCallback(
    async (product: ProductMatch) => {
      setSubmitting(true);
      try {
        const resp = await postJson<{ alreadyExists?: boolean }>(
          `/api/showroom-stores/${showroomId}/mapped-products`,
          { productId: product.id },
        );
        pushAdded({
          id: product.id,
          itemName: product.itemName,
          brandName: product.brandName,
          alreadyExisted: resp.alreadyExists === true,
        });
        toast.success(
          resp.alreadyExists
            ? `${product.itemName} was already mapped`
            : `Mapped ${product.itemName}`,
        );
        resetSearch();
      } catch (e) {
        console.error("Map product failed", e);
        toast.error(e instanceof Error ? e.message : "Failed to map product");
      } finally {
        setSubmitting(false);
      }
    },
    [showroomId, pushAdded, resetSearch],
  );

  /** Create a product (with its brand), then map it. */
  const createAndMap = useCallback(
    async (fields: {
      itemName: string;
      description?: string;
      colors?: string;
      preferredColor?: string;
      sku?: string;
      price?: string;
      leadTime?: string;
      notes?: string;
      brandId: number;
      brandName: string;
    }) => {
      setSubmitting(true);
      try {
        const { brandName, ...productFields } = fields;
        // POST .../products returns the created row WRAPPED as { product: {...} }.
        const created = (
          await postJson<{ product: { id: number; itemName?: string } }>(
            `/api/showroom-stores/${showroomId}/products`,
            productFields,
          )
        ).product;
        const resp = await postJson<{ alreadyExists?: boolean }>(
          `/api/showroom-stores/${showroomId}/mapped-products`,
          { productId: created.id },
        );
        pushAdded({
          id: created.id,
          itemName: created.itemName ?? fields.itemName,
          brandName,
          alreadyExisted: resp.alreadyExists === true,
        });
        toast.success(`Created & mapped ${created.itemName ?? fields.itemName}`);
        resetSearch();
      } catch (e) {
        console.error("Create product failed", e);
        toast.error(e instanceof Error ? e.message : "Failed to create product");
      } finally {
        setSubmitting(false);
      }
    },
    [showroomId, pushAdded, resetSearch],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Map products</DialogTitle>
          <DialogDescription>
            Search products and map matches to this showroom. Not listed? Create one inline —
            including its brand.
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
                placeholder="Search products…"
                className="pl-8"
                autoFocus
              />
              {searching && (
                <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {results.length > 0 && !showCreate && (
                <ul className="flex flex-col gap-1">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => mapProduct(p)}
                        className="flex w-full items-center gap-3 rounded-lg bg-card px-3 py-2 text-left ring-1 ring-border/40 transition-colors hover:bg-muted/40 disabled:opacity-50"
                      >
                        <div
                          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tintFor(p.itemName)}`}
                        >
                          <Package className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-sm font-medium">{p.itemName}</div>
                          {p.brandName && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Tag className="size-3" />
                              {p.brandName}
                            </div>
                          )}
                        </div>
                        <Plus className="size-4 shrink-0 text-primary" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {showCreate && (
                <CreateProductForm
                  initialName={query.trim()}
                  submitting={submitting}
                  onCancel={() => {
                    setShowCreate(false);
                    setQuery("");
                    setSearched(false);
                  }}
                  onCreate={createAndMap}
                />
              )}

              {!showCreate && results.length === 0 && (
                <div className="flex min-h-[120px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  {searching
                    ? "Searching…"
                    : query.trim() === ""
                      ? "Start typing to search products."
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
