import { Badge } from "@/components/ui/badge";

interface Brand {
  id: number;
  name: string;
  slug: string;
  logoCfDeliveryUrl: string | null;
  websiteUrl: string | null;
  pricePoint: string | null;
  avgRating: number | null;
  productCount: number;
}

interface BrandShowcaseProps {
  storeName: string;
  brands: Brand[];
}

/**
 * Brand showcase grid for the bottom of the store viewport page.
 *
 * Shows all brands mapped to a store. Product counts are global (total
 * unique products for a brand across all stores). Clicking a brand
 * navigates to `/admin/brands/[id]`.
 */
export function BrandShowcase({ storeName, brands }: BrandShowcaseProps) {
  if (brands.length === 0) return null;

  return (
    <section className="py-10 md:py-14 w-full" id="partner-brands">
      <div className="mx-auto mb-8 max-w-3xl text-center">
        <div className="mb-3 flex justify-center">
          <Badge
            variant="secondary"
            className="font-mono text-[10px] uppercase tracking-widest"
          >
            Partner Brands
          </Badge>
        </div>
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">
          Brands at {storeName}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Browse products by the brands this showroom carries
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {brands.map((brand) => (
          <a
            key={brand.id}
            href={`/admin/brands/${brand.id}`}
            className="group/brand flex w-[calc(50%-0.375rem)] flex-col items-center justify-center rounded-xl ring-1 ring-border/40 bg-card/60 p-5 transition-all hover:ring-primary/50 hover:bg-card/80 md:w-[calc(33.333%-0.5rem)] lg:w-[calc(16.666%-0.625rem)]"
          >
            <div className="relative mb-2.5 flex h-10 w-full items-center justify-center grayscale transition-all group-hover/brand:grayscale-0">
              {brand.logoCfDeliveryUrl ? (
                <img
                  src={brand.logoCfDeliveryUrl}
                  alt={brand.name}
                  width={80}
                  height={40}
                  className="max-h-full object-contain opacity-50 transition-all duration-300 group-hover/brand:opacity-100"
                />
              ) : (
                <span className="text-xs font-semibold tracking-tight text-muted-foreground/60 transition-colors group-hover/brand:text-foreground">
                  {brand.name}
                </span>
              )}
            </div>
            <p className="text-center text-sm font-medium">{brand.name}</p>
            {brand.productCount > 0 && (
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {brand.productCount} {brand.productCount === 1 ? "product" : "products"}
              </p>
            )}
            {brand.avgRating != null && (
              <p className="mt-0.5 text-[10px] font-mono tabular-nums text-amber-400">
                ★ {brand.avgRating.toFixed(1)}
              </p>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}

