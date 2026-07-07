import { ArrowLeft, Home, LogOut, Menu } from "lucide-react";
import { useEffect, useState } from "react";
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
  type NavGroupDef,
  NavLink,
  RenderGroup,
  useCurrentHash,
  useCurrentPath,
  useOpenNavGroups,
} from "./shared";

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
}: {
  currentPath: string;
  currentHash: string;
  uploadsPendingCount: number;
  loggingOut: boolean;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-3">
        <Home className="size-4 text-muted-foreground" />
        <a href="/admin" className="truncate text-sm font-semibold" onClick={onNavigate}>
          {siteConfig.name}
        </a>
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

export function AdminSidebar({ currentPath: currentPathProp }: { currentPath?: string } = {}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadsPendingCount, setUploadsPendingCount] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const currentPath = useCurrentPath(currentPathProp);
  const currentHash = useCurrentHash();

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
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border/40 bg-background/90 backdrop-blur md:block">
        <AdminSidebarContent
          currentPath={currentPath}
          currentHash={currentHash}
          uploadsPendingCount={uploadsPendingCount}
          loggingOut={loggingOut}
          onLogout={handleLogout}
        />
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
