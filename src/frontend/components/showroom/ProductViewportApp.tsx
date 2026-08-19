/**
 * @fileoverview ProductViewportApp — ecommerce-style single-product viewport.
 *
 * Client island mounted at /admin/products/:id and /admin/shopping/product/:id
 * (route mounting + `id` prop contract unchanged). Fetches
 * `GET /api/showroom-stores/products/:id/research/context` → { product,
 * findings, specs, images, intel } and lays it out as a sourcing tool modeled
 * on an ecommerce PDP but rebuilt for Monolith dark (no 1px borders; amber
 * stars/warnings; Inter):
 *
 *   TOP  (Ecommerce26): two-column grid — ProductGallery on the left, product
 *        identity (name, brand chip → /admin/shopping/brands/:brandId, type
 *        badge, store chip → /admin/shopping/store/:storeId) + PricingIntelBlock
 *        on the right.
 *   BELOW (Ecommerce43): ProductTabs (Details | Specs | Pricing intel |
 *        Savings & regulations | Research) + EntityDocumentsPanel.
 *
 * A manual "Run research" affordance POSTs
 * `/api/showroom-stores/products/:id/research` (409 while running is surfaced as
 * a toast) and polls the context until the workflow settles.
 *
 * No mock data, no window.alert/confirm, every empty/loading/error state
 * handled, errors routed through sonner toasts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, RotateCcw, Store, Tag } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityDocumentsPanel } from "@/components/documents";
import {
  api,
  isResearchInFlight,
  PricingIntelBlock,
  ProductGallery,
  ProductTabs,
  type ProductResearchContext,
} from "@/components/products";

// ─── Component ───────────────────────────────────────────────────────────────

export function ProductViewportApp({ id }: { id: number }) {
  const [data, setData] = useState<ProductResearchContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<ProductResearchContext | null> => {
    setError(null);
    try {
      const res = await api<ProductResearchContext>(
        `/api/showroom-stores/products/${id}/research/context`,
      );
      setData(res);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load product";
      setError(msg);
      toast.error(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [load]);

  // Poll the context every 4s while research is in flight, then stop.
  useEffect(() => {
    const status = data?.intel?.researchStatus;
    if (!isResearchInFlight(status)) {
      setRunning(false);
      return;
    }
    pollRef.current = setTimeout(() => {
      void load();
    }, 4000);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [data, load]);

  const runResearch = useCallback(async () => {
    setRunning(true);
    try {
      await api(`/api/showroom-stores/products/${id}/research`, { method: "POST" });
      toast.success("Research queued");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to queue research";
      // 409 = already running; keep the in-flight UI rather than reverting.
      if (/409|already|running/i.test(msg)) {
        toast.message("Research is already running");
      } else {
        toast.error(msg);
        setRunning(false);
      }
    }
  }, [id, load]);

  if (loading) {
    return (
      <main className="w-full px-4 py-10 md:px-8">
        <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="w-full px-4 py-10 md:px-8">
        <BackLink />
        <div className="mt-6 flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border/40">
          <p className="text-sm text-muted-foreground">{error ?? "Product not found."}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RotateCcw className="mr-1.5 size-3.5" />
            Retry
          </Button>
        </div>
      </main>
    );
  }

  const { product, findings, specs, images, intel } = data;

  return (
    <main className="w-full px-4 py-10 md:px-8">
      <BackLink />

      {/* TOP — gallery + identity + pricing intel */}
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <ProductGallery images={images} productName={product.itemName} />

        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {product.itemName}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {product.brandId && product.brandName && (
                <a
                  href={`/admin/shopping/brands/${product.brandId}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground/80 ring-1 ring-border/40 transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  {product.brandName}
                </a>
              )}
              {product.productType && (
                <Badge variant="secondary" className="gap-1 rounded-full text-[10px]">
                  <Tag className="size-3" />
                  {product.productType}
                </Badge>
              )}
              {product.storeId && (
                <a
                  href={`/admin/shopping/store/${product.storeId}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground ring-1 ring-border/40 transition-colors hover:text-foreground"
                >
                  <Store className="size-3" />
                  {product.storeName ?? "View store"}
                </a>
              )}
            </div>

            {product.description && (
              <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {product.description}
              </p>
            )}
          </div>

          <PricingIntelBlock
            product={product}
            intel={intel}
            running={running}
            onRunResearch={() => void runResearch()}
          />
        </div>
      </div>

      {/* BELOW — tabbed detail */}
      <section className="mt-10">
        <ProductTabs product={product} specs={specs} findings={findings} intel={intel} />
      </section>

      {/* Documents linked to this product */}
      <div className="mt-8">
        <EntityDocumentsPanel entityType="product" entityId={String(id)} />
      </div>

      {/* Visually-similar products (Vectorize) — hidden when none */}
      <SimilarProducts productId={id} />
    </main>
  );
}

interface SimilarProduct {
  id: number;
  itemName: string | null;
  brandName: string | null;
  imageUrl: string | null;
}

/**
 * Fetches `GET /api/product-photos/:productId/similar` and renders a horizontal
 * row of product cards. Renders nothing while loading, on error, or when empty
 * so it never disturbs the PDP layout.
 */
function SimilarProducts({ productId }: { productId: number }) {
  const [items, setItems] = useState<SimilarProduct[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<{ products: SimilarProduct[] }>(`/api/product-photos/${productId}/similar`)
      .then((res) => {
        if (!cancelled) setItems(res.products ?? []);
      })
      .catch((e) => {
        // Non-critical enrichment — surface but don't disrupt the page.
        toast.error(e instanceof Error ? e.message : "Failed to load similar products");
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (items.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-sm font-medium text-muted-foreground">Similar products</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {items.map((p) => (
          <a
            key={p.id}
            href={`/admin/products/${p.id}`}
            className="flex w-40 shrink-0 flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-border/40 transition-colors hover:ring-border/70"
          >
            {p.imageUrl ? (
              <img
                src={p.imageUrl}
                alt={p.itemName ?? "Product"}
                className="aspect-square w-full rounded-lg object-cover ring-1 ring-border/40"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground">
                No image
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.itemName ?? `Product #${p.id}`}</p>
              {p.brandName && (
                <p className="truncate text-xs text-muted-foreground">{p.brandName}</p>
              )}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function BackLink() {
  return (
    <a
      href="/admin/shopping/products"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Products
    </a>
  );
}
