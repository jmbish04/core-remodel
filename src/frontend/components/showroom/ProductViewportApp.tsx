import { useCallback, useEffect, useState } from "react";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EntityDocumentsPanel } from "@/components/documents";

interface Product {
  id: number;
  storeId: number;
  itemName: string;
  description: string | null;
  sku: string | null;
  price: string | null;
  leadTime: string | null;
  materialId: number | null;
}
interface Finding {
  id: number;
  finding: string;
  findingUrl: string | null;
  sentiment: "good" | "bad" | "neutral" | null;
}
interface Spec {
  id: number;
  specKey: string;
  specValue: string | null;
  unit: string | null;
  sourceUrl: string | null;
}
interface Image {
  id: number;
  deliveryUrl: string;
  altText: string | null;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function sentimentClass(s: Finding["sentiment"]): string {
  if (s === "good") return "text-emerald-400";
  if (s === "bad") return "text-rose-400";
  return "text-muted-foreground";
}

export function ProductViewportApp({ id }: { id: number }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ product: Product; findings: Finding[]; specs: Spec[]; images: Image[] }>(
        `/api/showroom-stores/products/${id}/research/context`,
      );
      setProduct(data.product);
      setFindings(data.findings);
      setSpecs(data.specs);
      setImages(data.images);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load product");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!product) return <div className="container mx-auto px-4 py-10 text-muted-foreground">Product not found.</div>;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <a href="/admin/shopping/products" className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Products
      </a>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{product.itemName}</h1>
        {product.price ? <span className="font-mono text-lg tabular-nums text-emerald-400">{product.price}</span> : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {product.sku ? <span className="font-mono text-xs">SKU {product.sku}</span> : null}
        {product.leadTime ? <span>Lead time: {product.leadTime}</span> : null}
        <a href={`/admin/shopping/store/${product.storeId}`} className="text-sky-400 hover:underline">View store</a>
      </div>
      {product.description ? <p className="mt-2 text-sm text-muted-foreground">{product.description}</p> : null}

      {images.length > 0 ? (
        <div className="mt-6 grid grid-cols-3 gap-2">
          {images.slice(0, 6).map((img) => (
            <img key={img.id} src={img.deliveryUrl} alt={img.altText ?? product.itemName} className="aspect-square w-full rounded-md object-cover" />
          ))}
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader className="pb-3"><CardTitle className="text-base">Specs</CardTitle></CardHeader>
        <CardContent>
          {specs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No specs captured.</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {specs.map((s) => (
                <li key={s.id} className="flex justify-between py-1.5 text-sm">
                  <span className="text-muted-foreground">{s.specKey}</span>
                  <span className="font-medium">{s.specValue}{s.unit ? ` ${s.unit}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-3"><CardTitle className="text-base">Research findings</CardTitle></CardHeader>
        <CardContent>
          {findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No findings yet.</p>
          ) : (
            <ul className="space-y-2">
              {findings.map((f) => (
                <li key={f.id} className="text-sm">
                  <span className={sentimentClass(f.sentiment)}>●</span>{" "}
                  <span>{f.finding}</span>{" "}
                  {f.findingUrl ? (
                    <a href={f.findingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-sky-400 hover:underline">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-4">
        <EntityDocumentsPanel entityType="product" entityId={String(id)} />
      </div>
    </main>
  );
}
