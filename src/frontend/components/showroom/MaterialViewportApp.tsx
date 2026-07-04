import { useCallback, useEffect, useState } from "react";
import { Loader2, Package, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Material {
  id: number;
  title: string;
  roomName: string | null;
  brand: string | null;
  model: string | null;
  notes: string | null;
  isPurchased: boolean | null;
}
interface Spec {
  id: number;
  key: string;
  value: string;
}
interface ProductRow {
  id: number;
  itemName: string;
  sku: string | null;
  price: string | null;
}
interface Match {
  product: ProductRow;
  matchedSpecKeys: string[];
  matchCount: number;
}

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error((payload.error as string) ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function MaterialViewportApp({ id }: { id: number }) {
  const [material, setMaterial] = useState<Material | null>(null);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [purchased, setPurchased] = useState<ProductRow | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, match] = await Promise.all([
        api<{ material: Material; specs: Spec[]; purchasedProduct: ProductRow | null }>(`/api/materials/${id}`),
        api<{ matches: Match[] }>(`/api/materials/${id}/match`),
      ]);
      setMaterial(detail.material);
      setSpecs(detail.specs);
      setPurchased(detail.purchasedProduct);
      setMatches(match.matches);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load material");
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
  if (!material) return <div className="container mx-auto px-4 py-10 text-muted-foreground">Material not found.</div>;

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <a href="/admin/shopping/schedule" className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Materials Schedule
      </a>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{material.title}</h1>
        {material.roomName ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{material.roomName}</Badge>
        ) : null}
        {material.isPurchased ? <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400">Purchased</Badge> : null}
      </div>
      {(material.brand || material.model) && (
        <p className="mt-1 text-sm text-muted-foreground">{[material.brand, material.model].filter(Boolean).join(" · ")}</p>
      )}
      {material.notes ? <p className="mt-2 text-sm text-muted-foreground">{material.notes}</p> : null}

      <Card className="mt-6">
        <CardHeader className="pb-3"><CardTitle className="text-base">Required specs</CardTitle></CardHeader>
        <CardContent>
          {specs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No required specs.</p>
          ) : (
            <ul className="divide-y divide-border/40">
              {specs.map((s) => (
                <li key={s.id} className="flex justify-between py-1.5 text-sm">
                  <span className="text-muted-foreground">{s.key}</span>
                  <span className="font-medium">{s.value}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-3"><CardTitle className="text-base">Matching products</CardTitle></CardHeader>
        <CardContent>
          {matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products match the required specs yet.</p>
          ) : (
            <ul className="space-y-2">
              {matches.map((m) => (
                <li key={m.product.id}>
                  <a href={`/admin/shopping/product/${m.product.id}`} className="flex items-center justify-between rounded-md bg-muted/40 p-3 transition-colors hover:bg-muted/70">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Package className="h-4 w-4 text-muted-foreground" /> {m.product.itemName}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px] text-emerald-400">{m.matchCount} spec match</Badge>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {purchased ? (
        <Card className="mt-4">
          <CardHeader className="pb-3"><CardTitle className="text-base">Purchased as</CardTitle></CardHeader>
          <CardContent>
            <a href={`/admin/shopping/product/${purchased.id}`} className="text-sm font-medium text-sky-400 hover:underline">
              {purchased.itemName}
            </a>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
