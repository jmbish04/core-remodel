import {
  ArrowLeft,
  Home,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { HealthStatusBadge } from "@/components/health/HealthStatusBadge";
import { Icons } from "@/components/Icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UnitToggle } from "@/components/ui/unit-toggle";
import { siteConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { ADMIN_NAV_GROUPS } from "./nav-groups";
import {
  DocsTree,
  isGroupActive,
  type NavGroupDef,
  NavLink,
  RenderGroup,
  type SidebarItem,
  useCurrentHash,
  useCurrentPath,
  useOpenNavGroups,
} from "./shared";

/** First reachable href in an item subtree — the rail's per-section landing. */
function firstHref(items: SidebarItem[]): string | undefined {
  for (const item of items) {
    if (item.href) return item.href;
    const nested = firstHref(item.children ?? []);
    if (nested) return nested;
  }
  return undefined;
}

/** Writes the collapse cookie + the `<html>` data attribute that drives the
 * `--sidebar-w` CSS var (so the fixed aside AND the content padding reflow
 * together, matching the SSR value BaseLayout seeded from the same cookie). */
function persistCollapsed(collapsed: boolean) {
  document.cookie = `remodel_sidebar_collapsed=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.dataset.sidebarCollapsed = collapsed ? "1" : "0";
}

/** The collapsed icon rail: one button per admin section (navigates to its
 * landing + re-expands), plus expand / home / config affordances. */
function AdminRail({ currentPath, onExpand }: { currentPath: string; onExpand: () => void }) {
  return (
    <div className="flex h-full flex-col items-center gap-1 py-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Expand sidebar"
        title="Expand sidebar"
        onClick={onExpand}
      >
        <PanelLeftOpen className="size-4" />
      </Button>
      <a
        href="/admin"
        title="Mission Control"
        aria-label="Mission Control"
        className={cn(buttonVariants({ variant: currentPath === "/" ? "secondary" : "ghost", size: "icon-sm" }))}
      >
        <Home className="size-4" />
      </a>
      <Separator className="my-1 w-8" />
      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto overscroll-contain">
        {ADMIN_NAV_GROUPS.map((group) => {
          const Icon = group.icon ?? Home;
          const href = firstHref(group.items) ?? "/admin";
          const active = isGroupActive(currentPath, group);
          return (
            <a
              key={group.id}
              href={href}
              title={group.label}
              aria-label={group.label}
              onClick={onExpand}
              className={cn(
                buttonVariants({ variant: active ? "secondary" : "ghost", size: "icon-sm" }),
              )}
            >
              <Icon className="size-4" />
            </a>
          );
        })}
      </div>
      <Separator className="my-1 w-8" />
      <a
        href="/admin/config"
        target="_blank"
        rel="noopener noreferrer"
        title="Configuration"
        aria-label="Configuration"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
      >
        <Settings className="size-4" />
      </a>
    </div>
  );
}

function AdminSidebarLinks({
  currentPath,
  currentHash,
  uploadsPendingCount,
  onNavigate,
}: {
  currentPath: string;
  currentHash: string;
  uploadsPendingCount: number;
  onNavigate?: () => void;
}) {
  const { openNavGroups, toggleNavGroup } = useOpenNavGroups(ADMIN_NAV_GROUPS, currentPath);

  return (
    <nav className="space-y-3" aria-label="Admin navigation">
      <div className="space-y-1">
        <NavLink
          href="/"
          label="Mission Control"
          active={currentPath === "/"}
          onNavigate={onNavigate}
        />
      </div>

      {ADMIN_NAV_GROUPS.map((group) => {
        // Photos surfaces the pending-uploads badge on the Uploads item.
        const resolved: NavGroupDef =
          group.id === "photos"
            ? {
                ...group,
                items: group.items.map((item) =>
                  item.href === "/admin/prepare/uploads"
                    ? { ...item, badgeCount: uploadsPendingCount }
                    : item,
                ),
              }
            : group;
        return (
          <RenderGroup
            key={resolved.id}
            group={resolved}
            currentPath={currentPath}
            open={openNavGroups[resolved.id] ?? false}
            onToggle={toggleNavGroup}
            onNavigate={onNavigate}
          />
        );
      })}

      <DocsTree currentPath={currentPath} currentHash={currentHash} onNavigate={onNavigate} />
    </nav>
  );
}

function AdminSidebarContent({
  currentPath,
  currentHash,
  uploadsPendingCount,
  loggingOut,
  onLogout,
  onNavigate,
  onCollapse,
}: {
  currentPath: string;
  currentHash: string;
  uploadsPendingCount: number;
  loggingOut: boolean;
  onLogout: () => void;
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-3">
        <Home className="size-4 shrink-0 text-muted-foreground" />
        <a href="/admin" className="truncate text-sm font-semibold" onClick={onNavigate}>
          {siteConfig.name}
        </a>
        {onCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onClick={onCollapse}
            className="ml-auto shrink-0"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        ) : null}
      </div>

      <Separator />

      <div
        className="flex-1 overflow-y-auto overscroll-contain px-2 py-3"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <AdminSidebarLinks
          currentPath={currentPath}
          currentHash={currentHash}
          uploadsPendingCount={uploadsPendingCount}
          onNavigate={onNavigate}
        />
      </div>

      <Separator />

      <div className="space-y-2 px-3 py-3">
        <a
          href="/"
          onClick={onNavigate}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-full justify-start gap-2",
          )}
        >
          <ArrowLeft className="size-4" />
          Exit to public site
        </a>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loggingOut}
          onClick={onLogout}
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-4" />
          {loggingOut ? "Logging out…" : "Log out"}
        </Button>

        <Separator className="my-1" />

        <a
          href={siteConfig.links.github}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-full justify-start gap-2",
          )}
          onClick={onNavigate}
        >
          <Icons.gitHub />
          Source
        </a>
        <div className="flex items-center justify-between rounded-md border border-border/50 bg-card/60 px-2 py-1">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border/50 bg-card/60 px-2 py-1">
          <span className="text-xs text-muted-foreground">Units</span>
          <UnitToggle />
        </div>
      </div>
    </div>
  );
}

export function AdminSidebar({
  currentPath: currentPathProp,
  collapsed: collapsedProp = false,
}: { currentPath?: string; collapsed?: boolean } = {}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(collapsedProp);
  const [uploadsPendingCount, setUploadsPendingCount] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const currentPath = useCurrentPath(currentPathProp);
  const currentHash = useCurrentHash();

  const setCollapsedPersisted = (next: boolean) => {
    setCollapsed(next);
    persistCollapsed(next);
  };

  useEffect(() => {
    let mounted = true;

    const fetchPending = async () => {
      try {
        const response = await fetch("/api/images/mapping/summary");
        const payload = (await response.json()) as {
          success?: boolean;
          pending?: { total?: number };
        };
        if (!mounted) return;
        if (response.ok && payload.success) {
          setUploadsPendingCount(payload.pending?.total || 0);
        }
      } catch {
        // Keep sidebar resilient; no-op on badge fetch failures.
      }
    };

    const onSummaryUpdated = () => {
      void fetchPending();
    };

    void fetchPending();
    window.addEventListener("global-upload-complete", onSummaryUpdated);
    window.addEventListener("image-mapping-summary-updated", onSummaryUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("global-upload-complete", onSummaryUpdated);
      window.removeEventListener("image-mapping-summary-updated", onSummaryUpdated);
    };
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/access/logout", { method: "POST", credentials: "include" });
    } catch {
      // Even if the request fails, drop the user back to the public site; the
      // _worker.ts gate will re-challenge on the next /admin visit.
    } finally {
      window.location.assign("/");
    }
  };

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border/40 bg-background/90 backdrop-blur transition-[width] duration-200 md:block md:[width:var(--sidebar-w)]">
        {collapsed ? (
          <AdminRail currentPath={currentPath} onExpand={() => setCollapsedPersisted(false)} />
        ) : (
          <AdminSidebarContent
            currentPath={currentPath}
            currentHash={currentHash}
            uploadsPendingCount={uploadsPendingCount}
            loggingOut={loggingOut}
            onLogout={handleLogout}
            onCollapse={() => setCollapsedPersisted(true)}
          />
        )}
      </aside>

      <div className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-border/40 bg-background/90 px-3 backdrop-blur md:hidden">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Open navigation menu"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-4" />
        </Button>

        <a href="/admin" className="truncate text-sm font-semibold">
          {siteConfig.name}
        </a>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Same health pip as the desktop header — mobile gets it too. */}
          <HealthStatusBadge />
          <a
            href="/admin/config"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Configuration"
            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "shrink-0")}
          >
            <Settings className="size-4" />
          </a>
        </div>
      </div>

      {/* iOS-safe mobile nav slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* biome-ignore lint/a11y/useKeyEvents: overlay dismiss */}
          {/* biome-ignore lint/a11y/useAriaRole: overlay dismiss */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[88vw] max-w-xs flex-col border-r border-border/40 bg-background shadow-xl"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <AdminSidebarContent
              currentPath={currentPath}
              currentHash={currentHash}
              uploadsPendingCount={uploadsPendingCount}
              loggingOut={loggingOut}
              onLogout={handleLogout}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}
