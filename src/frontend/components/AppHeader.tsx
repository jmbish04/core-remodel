/**
 * @fileoverview Global top header (desktop).
 *
 * A horizontal bar across every page's content column: the full app name on the
 * left (so it's never truncated the way the narrow sidebar label was) and, on
 * the far right, the config cog — the single entry point to the configuration
 * area, opened in its own tab (`/admin/config`, which renders its own dedicated
 * config sidebar via ConfigShell).
 *
 * Desktop-only (`hidden md:flex`); on mobile the sidebar's slim top bar carries
 * the menu trigger and the cog. Monolith rules: dark theme, tokens only.
 */
import { Settings } from "lucide-react";

import { HealthStatusBadge } from "@/components/health/HealthStatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 hidden h-14 items-center justify-between gap-4 border-b border-border/40 bg-background/90 px-4 backdrop-blur md:flex">
      <a
        href="/admin"
        className="truncate text-sm font-semibold tracking-tight text-foreground"
      >
        {siteConfig.name}
      </a>
      <div className="flex items-center gap-1">
        {/* Last known health, one pip wide — click to the full dashboard. */}
        <HealthStatusBadge />
        <a
          href="/admin/config"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Configuration"
          title="Configuration"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "shrink-0")}
        >
          <Settings className="size-5" />
        </a>
      </div>
    </header>
  );
}

export default AppHeader;
