/**
 * @fileoverview Configuration home — the `/admin/config` landing.
 *
 * Outlines every configuration area available in the system as a grid of cards
 * (grouped exactly like the config sidebar / CONFIG_NAV), each linking to its
 * page. Wrapped in ConfigShell so it shares the dedicated config sidebar.
 *
 * Monolith rules: dark theme, tokens only, no 1px borders.
 */
import { ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { ConfigShell } from "./ConfigShell";
import { CONFIG_NAV } from "./config-nav";

/** One-line description per config page (keyed by href). */
const DESCRIPTIONS: Record<string, string> = {
  "/admin/config/address": "Property address, ZIP, block & lot used by the permit pipeline.",
  "/admin/config/device": "This device's default landing page when you open the app root.",
  "/admin/config/photo/categories": "Top-level categories for products and price-card photos.",
  "/admin/config/photo/subcategories": "Sub-categories nested under each category.",
  "/admin/config/photo/colors": "Named colors (with hex swatch) for tagging photos and products.",
};

export function ConfigHomeApp() {
  return (
    <ConfigShell
      activeHref="/admin/config"
      title="Configuration"
      description="Every configuration area in the system. Pick one from the sidebar or a card below."
    >
      <div className="space-y-8">
        {CONFIG_NAV.map((group) => (
          <section key={group.id}>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.items.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="h-full transition-colors group-hover:bg-card/80">
                    <CardContent className="flex h-full items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{item.label}</p>
                        {DESCRIPTIONS[item.href] ? (
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {DESCRIPTIONS[item.href]}
                          </p>
                        ) : null}
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </CardContent>
                  </Card>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </ConfigShell>
  );
}

export default ConfigHomeApp;
