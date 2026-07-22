import { useEffect, useState } from "react";
import { ArrowLeft, Filter, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ObservabilityTable } from "@/components/system/ObservabilityTable";

/**
 * Audit / logs viewport, optionally scoped to one health service.
 *
 * FILTERS ARE PRESET, NOT STICKY. Arriving with a `serviceSlug` seeds the
 * filter from the health row that linked here, and nothing is persisted — no
 * localStorage, no query-string round-trip. Going back to /admin/system/health
 * and picking a service (the same one or a different one) therefore always
 * lands on a clean, predictable view. The user can still tinker freely; the
 * tinkering just does not survive the trip.
 *
 * `key={serviceSlug}` on the table is what enforces that: a new slug remounts
 * the table rather than merging into whatever state the user left behind.
 */
export function SystemTablePage({
  kind,
  serviceSlug,
}: {
  kind: "audit" | "logs";
  serviceSlug?: string;
}) {
  const [service, setService] = useState<{ slug: string; name: string } | null>(null);

  useEffect(() => {
    if (!serviceSlug) {
      setService(null);
      return;
    }
    let cancelled = false;
    // Resolve the slug to a display name so the scope banner reads like the
    // health row the user just clicked, not like a URL fragment.
    fetch("/api/system/health/checks", { credentials: "include" })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ checks?: Array<{ slug: string; name: string }> }>) : null,
      )
      .then((json) => {
        if (cancelled) return;
        const match = json?.checks?.find((c) => c.slug === serviceSlug);
        setService(match ?? { slug: serviceSlug, name: serviceSlug });
      })
      .catch(() => {
        if (!cancelled) setService({ slug: serviceSlug, name: serviceSlug });
      });
    return () => {
      cancelled = true;
    };
  }, [serviceSlug]);

  return (
    <div className="space-y-4">
      {serviceSlug && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2 text-sm">
              <Filter className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Filtered to</span>
              <Badge variant="secondary" className="font-mono text-[11px]">
                {service?.name ?? serviceSlug}
              </Badge>
              <span className="text-xs text-muted-foreground">
                — preset from System Health, not saved between visits
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" render={<a href={`/admin/system/${kind}`} />}>
                <X className="mr-1.5 size-3.5" /> Clear filter
              </Button>
              <Button size="sm" variant="outline" render={<a href="/admin/system/health" />}><ArrowLeft className="mr-1.5 size-3.5" /> Back to health</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Remount on slug change so no filter state leaks between services. */}
      <ObservabilityTable key={serviceSlug ?? "all"} kind={kind} serviceSlug={serviceSlug} />
    </div>
  );
}
