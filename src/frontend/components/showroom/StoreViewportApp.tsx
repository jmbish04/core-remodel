import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  ArrowLeft,
  MapPin,
  Phone,
  Globe,
  ExternalLink,
  Package,
  Instagram,
  Store as StoreIcon,
  Pencil,
  Save,
  X,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  OverviewNoteEditor,
  type OverviewNoteEditorValue,
} from "./OverviewNoteEditor";

interface StoreBrand {
  id: number;
  name: string;
  iconCfImagesUrl: string | null;
}

interface StoreDetail {
  id: number;
  name: string;
  description: string | null;
  pricePoint: string | null;
  locationAddress: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  iconCfImagesUrl: string | null;
  overviewNoteHtml: string | null;
  overviewNoteMarkdown: string | null;
  weekdayHours: string | null;
  weekendHours: string | null;
  inventoryFocus: string | null;
  aiHighlightsForUserRenovation: string | null;
  cityName: string | null;
  hubRoute: string | null;
  hubName: string | null;
  products: { id: number; itemName: string; price: string | null }[];
  notes: { id: number; note: string }[];
  research: { id: number; finding: string; findingUrl: string | null; sentiment: string | null }[];
  externalRatings: { id: number; source: string | null; rating: number | null; comment: string | null }[];
  brands: StoreBrand[];
}

interface BrandOption {
  id: number;
  name: string;
  iconCfImagesUrl: string | null;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Small store/brand favicon with a graceful placeholder on load error. */
function FaviconImg({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className={`flex items-center justify-center bg-card text-muted-foreground ring-1 ring-border/40 ${className ?? ""}`}
        aria-hidden
      >
        <StoreIcon className="h-1/2 w-1/2" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className={`bg-card object-contain ring-1 ring-border/40 ${className ?? ""}`}
      loading="lazy"
    />
  );
}

export function StoreViewportApp({ id }: { id: number }) {
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Overview note edit state
  const [editingOverview, setEditingOverview] = useState(false);
  const [draftOverview, setDraftOverview] = useState<OverviewNoteEditorValue>({
    html: "",
    markdown: "",
  });
  const [savingOverview, setSavingOverview] = useState(false);

  // Brand management state
  const [brandOptions, setBrandOptions] = useState<BrandOption[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [mutatingBrand, setMutatingBrand] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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

  useEffect(() => {
    load();
  }, [load]);

  // Load the brand catalog lazily (first time the add control is used).
  const loadBrandOptions = useCallback(async () => {
    if (brandOptions.length > 0 || brandsLoading) return;
    setBrandsLoading(true);
    try {
      const data = await api<{ brands?: BrandOption[] }>("/api/brands");
      setBrandOptions(data.brands ?? []);
    } catch (e) {
      console.error("[store/brands-list]", e);
      toast.error(e instanceof Error ? e.message : "Failed to load brands");
    } finally {
      setBrandsLoading(false);
    }
  }, [brandOptions.length, brandsLoading]);

  const attachedBrandIds = useMemo(
    () => new Set((store?.brands ?? []).map((b) => b.id)),
    [store?.brands],
  );
  const availableBrands = useMemo(
    () => brandOptions.filter((b) => !attachedBrandIds.has(b.id)),
    [brandOptions, attachedBrandIds],
  );

  const saveOverview = useCallback(async () => {
    if (!store) return;
    setSavingOverview(true);
    try {
      const res = await fetch(`/api/showroom-stores/${store.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overviewNoteHtml: draftOverview.html,
          overviewNoteMarkdown: draftOverview.markdown,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Save failed (${res.status})`);
      }
      toast.success("Overview updated");
      setEditingOverview(false);
      await load();
    } catch (e) {
      console.error("[store/overview-save]", e);
      toast.error(e instanceof Error ? e.message : "Failed to save overview");
    } finally {
      setSavingOverview(false);
    }
  }, [store, draftOverview, load]);

  const attachBrand = useCallback(
    async (brandId: number) => {
      if (!store || mutatingBrand) return;
      setMutatingBrand(true);
      try {
        const res = await fetch(`/api/showroom-stores/${store.id}/brands`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Attach failed (${res.status})`);
        }
        const payload = (await res.json().catch(() => ({}))) as { alreadyExists?: boolean };
        toast.success(payload.alreadyExists ? "Brand already attached" : "Brand added");
        await load();
      } catch (e) {
        console.error("[store/brand-attach]", e);
        toast.error(e instanceof Error ? e.message : "Failed to add brand");
      } finally {
        setMutatingBrand(false);
      }
    },
    [store, mutatingBrand, load],
  );

  const removeBrand = useCallback(
    async (brandId: number) => {
      if (!store || mutatingBrand) return;
      setMutatingBrand(true);
      try {
        const res = await fetch(`/api/showroom-stores/${store.id}/brands/${brandId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Remove failed (${res.status})`);
        }
        toast.success("Brand removed");
        await load();
      } catch (e) {
        console.error("[store/brand-remove]", e);
        toast.error(e instanceof Error ? e.message : "Failed to remove brand");
      } finally {
        setMutatingBrand(false);
      }
    },
    [store, mutatingBrand, load],
  );

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!store) return <div className="container mx-auto px-4 py-10 text-muted-foreground">Showroom not found.</div>;

  const instagramHref = store.instagramUrl
    ? store.instagramUrl.startsWith("http")
      ? store.instagramUrl
      : `https://${store.instagramUrl}`
    : null;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <a href="/admin/showroom/showrooms" className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Showrooms
      </a>

      <div className="mt-4 flex items-start gap-4">
        <FaviconImg
          src={store.iconCfImagesUrl}
          alt={`${store.name} icon`}
          className="h-14 w-14 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{store.name}</h1>
            {store.hubRoute ? <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Hub {store.hubRoute}</Badge> : null}
            {store.pricePoint ? <Badge variant="outline" className="font-mono text-[10px] text-emerald-400">{store.pricePoint}</Badge> : null}
          </div>
          {store.description ? <p className="mt-2 text-sm text-muted-foreground">{store.description}</p> : null}
        </div>
      </div>

      <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
        {(store.locationAddress || store.cityName) ? <div className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {[store.locationAddress, store.cityName].filter(Boolean).join(", ")}</div> : null}
        {store.phoneNumber ? <div className="flex items-center gap-2"><Phone className="h-4 w-4" /> {store.phoneNumber}</div> : null}
        {store.websiteUrl ? <div className="flex items-center gap-2"><Globe className="h-4 w-4" /> <a href={store.websiteUrl} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{store.websiteUrl}</a></div> : null}
        {instagramHref ? (
          <div className="flex items-center gap-2">
            <Instagram className="h-4 w-4" />
            <a href={instagramHref} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
              Instagram
            </a>
          </div>
        ) : null}
        {(store.weekdayHours || store.weekendHours) ? <div>Hours: {[store.weekdayHours, store.weekendHours].filter(Boolean).join(" · ")}</div> : null}
      </div>

      {store.aiHighlightsForUserRenovation ? (
        <Card className="mt-6 border-amber-500/20">
          <CardContent className="p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-amber-400">AI highlights for your renovation</p>
            <p className="mt-1 text-sm">{store.aiHighlightsForUserRenovation}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Overview note */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Overview</CardTitle>
          {!editingOverview ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setDraftOverview({
                  html: store.overviewNoteHtml ?? "",
                  markdown: store.overviewNoteMarkdown ?? "",
                });
                setEditingOverview(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {editingOverview ? (
            <div className="space-y-3">
              <OverviewNoteEditor
                initialHtml={store.overviewNoteHtml}
                initialMarkdown={store.overviewNoteMarkdown}
                onChange={setDraftOverview}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingOverview(false)}
                  disabled={savingOverview}
                >
                  Cancel
                </Button>
                <Button size="sm" className="gap-1.5" onClick={saveOverview} disabled={savingOverview}>
                  {savingOverview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </div>
          ) : store.overviewNoteHtml ? (
            <div
              className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed [&_a]:text-sky-400 [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5"
              // Single trusted homeowner's own authored content, escaped at write time.
              dangerouslySetInnerHTML={{ __html: store.overviewNoteHtml }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No overview yet. Click <span className="font-medium">Edit</span> to add one.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Brands offered */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Brands offered ({store.brands.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {store.brands.length === 0 ? (
            <p className="text-sm text-muted-foreground">No brands linked to this showroom yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {store.brands.map((brand) => (
                <span
                  key={brand.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 pl-1.5 pr-1 text-sm ring-1 ring-border/40"
                >
                  <FaviconImg
                    src={brand.iconCfImagesUrl}
                    alt={`${brand.name} icon`}
                    className="h-5 w-5 rounded-full"
                  />
                  <a href="/admin/brands" className="hover:underline">
                    {brand.name}
                  </a>
                  <button
                    type="button"
                    onClick={() => removeBrand(brand.id)}
                    disabled={mutatingBrand}
                    aria-label={`Remove ${brand.name}`}
                    className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="pt-1">
            <Select
              value=""
              onOpenChange={(open) => {
                if (open) void loadBrandOptions();
              }}
              onValueChange={(v) => {
                const brandId = Number(v);
                if (Number.isFinite(brandId) && brandId > 0) void attachBrand(brandId);
              }}
              disabled={mutatingBrand}
            >
              <SelectTrigger className="w-full sm:w-64">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" /> Add brand
                </span>
              </SelectTrigger>
              <SelectContent>
                {brandsLoading ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : availableBrands.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground">
                    {brandOptions.length === 0 ? "No brands available." : "All brands already added."}
                  </div>
                ) : (
                  availableBrands.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      <span className="flex items-center gap-2">
                        <FaviconImg
                          src={b.iconCfImagesUrl}
                          alt=""
                          className="h-4 w-4 rounded"
                        />
                        {b.name}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-3"><CardTitle className="text-base">Products carried ({store.products.length})</CardTitle></CardHeader>
        <CardContent>
          {store.products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products tracked at this showroom yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {store.products.map((p) => (
                <li key={p.id}>
                  <a href={`/admin/showroom/product/${p.id}`} className="flex items-center justify-between rounded-md bg-muted/40 p-2.5 text-sm transition-colors hover:bg-muted/70">
                    <span className="flex items-center gap-1.5"><Package className="h-4 w-4 text-muted-foreground" /> {p.itemName}</span>
                    {p.price ? <span className="font-mono text-xs tabular-nums text-emerald-400">{p.price}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {store.research.length > 0 ? (
        <Card className="mt-4">
          <CardHeader className="pb-3"><CardTitle className="text-base">Research findings</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {store.research.map((f) => (
                <li key={f.id} className="text-sm">
                  {f.finding}{" "}
                  {f.findingUrl ? <a href={f.findingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-sky-400"><ExternalLink className="h-3 w-3" /></a> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
