import { Home, Menu, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { siteConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { PUBLIC_NAV_GROUPS } from "./nav-groups";
import {
  DocsTree,
  type NavGroupDef,
  NavLink,
  RenderGroup,
  useCurrentHash,
  useCurrentPath,
  useOpenNavGroups,
} from "./shared";

function PublicSidebarLinks({
  currentPath,
  currentHash,
  sharedBoardsCount,
  onNavigate,
}: {
  currentPath: string;
  currentHash: string;
  sharedBoardsCount: number;
  onNavigate?: () => void;
}) {
  // Resolve the dynamic groups (Records surfaces the shared Mood Boards link
  // only when boards exist) BEFORE the open-state hook, so the hook — and its
  // re-sync effect — can auto-expand Records when the user is on /moodboards.
  const resolvedGroups = useMemo<NavGroupDef[]>(
    () =>
      PUBLIC_NAV_GROUPS.map((group) =>
        group.id === "records" && sharedBoardsCount >= 1
          ? { ...group, items: [...group.items, { href: "/moodboards", label: "Mood Boards" }] }
          : group,
      ),
    [sharedBoardsCount],
  );
  const { openNavGroups, toggleNavGroup } = useOpenNavGroups(resolvedGroups, currentPath);

  return (
    <nav className="space-y-3" aria-label="Main navigation">
      <div className="space-y-1">
        <NavLink
          href="/"
          label="Mission Control"
          active={currentPath === "/"}
          onNavigate={onNavigate}
        />
      </div>

      {resolvedGroups.map((group) => (
        <RenderGroup
          key={group.id}
          group={group}
          currentPath={currentPath}
          open={openNavGroups[group.id] ?? false}
          onToggle={toggleNavGroup}
          onNavigate={onNavigate}
        />
      ))}

      <DocsTree currentPath={currentPath} currentHash={currentHash} onNavigate={onNavigate} />
    </nav>
  );
}

function PublicSidebarContent({
  currentPath,
  currentHash,
  sharedBoardsCount,
  onNavigate,
}: {
  currentPath: string;
  currentHash: string;
  sharedBoardsCount: number;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-3">
        <Home className="size-4 text-muted-foreground" />
        <a href="/" className="truncate text-sm font-semibold" onClick={onNavigate}>
          {siteConfig.name}
        </a>
      </div>

      <Separator />

      <div
        className="flex-1 overflow-y-auto overscroll-contain px-2 py-3"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <PublicSidebarLinks
          currentPath={currentPath}
          currentHash={currentHash}
          sharedBoardsCount={sharedBoardsCount}
          onNavigate={onNavigate}
        />
      </div>

      <Separator />

      <div className="px-3 py-3">
        {/* The _worker.ts gate sends unauthenticated visitors to
            /access?next=/admin and back after login, so this is just an anchor. */}
        <a
          href="/admin"
          onClick={onNavigate}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "w-full justify-center gap-2")}
        >
          <ShieldCheck className="size-4" />
          Enter Admin Portal
        </a>
      </div>
    </div>
  );
}

export function PublicSidebar({ currentPath: currentPathProp }: { currentPath?: string } = {}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sharedBoardsCount, setSharedBoardsCount] = useState(0);
  const currentPath = useCurrentPath(currentPathProp);
  const currentHash = useCurrentHash();

  useEffect(() => {
    let mounted = true;

    const fetchSharedBoards = async () => {
      try {
        const response = await fetch("/api/mood-board?shared=true");
        const payload = (await response.json()) as { moodBoards?: unknown[] };
        if (!mounted) return;
        if (response.ok && payload.moodBoards) {
          setSharedBoardsCount(payload.moodBoards.length);
        }
      } catch {
        // Keep sidebar resilient; no-op on badge fetch failures.
      }
    };

    const onBoardsUpdated = () => {
      void fetchSharedBoards();
    };

    void fetchSharedBoards();
    window.addEventListener("design-boards-updated", onBoardsUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("design-boards-updated", onBoardsUpdated);
    };
  }, []);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border/40 bg-background/90 backdrop-blur md:block">
        <PublicSidebarContent
          currentPath={currentPath}
          currentHash={currentHash}
          sharedBoardsCount={sharedBoardsCount}
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

        <a href="/" className="truncate text-sm font-semibold">
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
            <PublicSidebarContent
              currentPath={currentPath}
              currentHash={currentHash}
              sharedBoardsCount={sharedBoardsCount}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}
