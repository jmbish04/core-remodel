import { BookOpenText, ChevronDown, Home, Menu } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { Icons } from "@/components/Icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UnitToggle } from "@/components/ui/unit-toggle";
import { siteConfig } from "@/lib/config";
import { docsAudienceGroups, getDocsPageByPath } from "@/lib/docs";
import { cn } from "@/lib/utils";

type SidebarItem = {
  href: string;
  label: string;
  badgeCount?: number;
};

/**
 * A collapsible sidebar section. `admin` sections only render for authenticated
 * users; every `admin` section's URLs live under `/admin/*` (the invariant that
 * pairs the sidebar grouping with the route foldering). Non-admin sections hold
 * user-facing root pages.
 */
type NavGroupDef = {
  id: string;
  label: string;
  admin: boolean;
  items: SidebarItem[];
};

/**
 * The information architecture for the sidebar. Ordered top-to-bottom. Each entry
 * renders as a collapsible section; only the section containing the active route
 * is expanded by default (see `SidebarLinks`), keeping the list short on mobile.
 * The full shopping toolset lives on the `/admin/shopping` hub landing — the
 * sidebar surfaces only the high-traffic few.
 */
const NAV_GROUPS: NavGroupDef[] = [
  {
    id: "plan",
    label: "Plan",
    admin: true,
    items: [
      { href: "/admin/measure", label: "Live Floor Plan" },
      { href: "/admin/measurements", label: "Measurements" },
      { href: "/admin/planning/moodboards", label: "Mood Boards" },
      { href: "/admin/planning/decision-room", label: "Decision Room" },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    admin: true,
    items: [
      { href: "/admin/budget-tracker", label: "Budget Tracker" },
      { href: "/admin/budget-dashboard", label: "Budget Triage Matrix" },
      { href: "/admin/truth-table", label: "Labor & Materials Costs" },
    ],
  },
  {
    id: "contractors",
    label: "Contractors",
    admin: true,
    items: [
      { href: "/admin/companies", label: "Companies" },
      { href: "/admin/estimates", label: "Estimates" },
      { href: "/admin/contracts", label: "Contracts" },
      { href: "/admin/bid-portfolios", label: "Bid Portfolios" },
      { href: "/admin/contractor-schedule", label: "Schedule" },
      { href: "/admin/permits", label: "Permits" },
      { href: "/admin/dialer", label: "Prospect Dialer" },
    ],
  },
  {
    id: "shopping",
    label: "Shopping & Sourcing",
    admin: true,
    items: [
      { href: "/admin/shopping", label: "Sourcing & Shopping tools" },
      { href: "/admin/shopping/showrooms", label: "Showrooms" },
      { href: "/admin/shopping/schedule", label: "Materials Schedule" },
      { href: "/admin/shopping/products", label: "Products" },
      { href: "/admin/shopping/journal", label: "Shopping Journal" },
      { href: "/admin/shopping/research", label: "Deep Research" },
    ],
  },
  {
    id: "photos",
    label: "Photos & Renders",
    admin: true,
    items: [
      { href: "/admin/uploads", label: "Uploads" },
      { href: "/admin/review", label: "Review" },
      { href: "/admin/photo-edits", label: "Photo Edits" },
      { href: "/admin/blank-canvas", label: "Blank Canvas" },
      { href: "/admin/builder", label: "Renovation Studio" },
      { href: "/admin/gallery", label: "Render Gallery" },
    ],
  },
  {
    id: "documents",
    label: "Documents & Research",
    admin: true,
    items: [
      { href: "/admin/supporting-docs", label: "Supporting Docs" },
      { href: "/admin/research", label: "Research Library" },
    ],
  },
  {
    id: "system",
    label: "System",
    admin: true,
    items: [
      { href: "/admin", label: "Analytics" },
      { href: "/admin/plans", label: "Plans" },
      { href: "/admin/integrations/usage", label: "Integrations Usage" },
      { href: "/admin/config", label: "Config" },
    ],
  },
  {
    id: "home-tour",
    label: "Home Tour",
    admin: false,
    items: [
      { href: "/floor-plan", label: "Floor Plan" },
      { href: "/kitchen-layout", label: "Kitchen Layout" },
      { href: "/listing-photos", label: "Listing Photos" },
      { href: "/inspiration-photos", label: "Inspiration Photos" },
    ],
  },
  {
    id: "records",
    label: "Records",
    admin: false,
    items: [
      { href: "/supporting-docs", label: "Project Records" },
    ],
  },
];

function isPathActive(currentPath: string, href: string): boolean {
  if (href === "/") return currentPath === "/";
  if (href === "/admin") return currentPath === "/admin";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/** True when any item in the group matches the active route. */
function isGroupActive(currentPath: string, group: NavGroupDef): boolean {
  return group.items.some((item) => isPathActive(currentPath, item.href));
}

interface NavLinkProps {
  href: string;
  label: string;
  active: boolean;
  external?: boolean;
  badgeCount?: number;
  onNavigate?: () => void;
}

function NavLink(props: NavLinkProps) {
  const { href, label, active, external, badgeCount, onNavigate } = props;
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={onNavigate}
      className={cn(
        buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }),
        "w-full justify-between",
      )}
    >
      <span>{label}</span>
      {typeof badgeCount === "number" && badgeCount > 0 ? (
        <Badge variant="destructive" className="ml-2 h-5 min-w-5 justify-center px-1 text-[10px]">
          {badgeCount > 99 ? "99+" : badgeCount}
        </Badge>
      ) : null}
    </a>
  );
}

function SidebarLinks({
  currentPath,
  currentHash,
  uploadsPendingCount,
  accessAuthenticated,
  sharedBoardsCount,
  onNavigate,
}: {
  currentPath: string;
  currentHash: string;
  uploadsPendingCount: number;
  accessAuthenticated: boolean;
  sharedBoardsCount: number;
  onNavigate?: () => void;
}) {
  const docsPage = getDocsPageByPath(currentPath);
  const docsActive = currentPath === "/docs" || currentPath.startsWith("/docs/");
  const [docsOpen, setDocsOpen] = useState(docsActive);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      docsAudienceGroups.map((group) => [
        group.id,
        docsPage ? group.id === docsPage.audience : false,
      ]),
    ),
  );

  // Collapsible nav sections: only the section containing the active route is
  // open initially (computed from the SSR-provided currentPath, so the correct
  // section is already expanded in the first paint). Users can toggle; state
  // resets per page load, which is the desired "active section open" behavior.
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NAV_GROUPS.map((group) => [group.id, isGroupActive(currentPath, group)])),
  );
  const toggleNavGroup = (id: string) =>
    setOpenNavGroups((current) => ({ ...current, [id]: !current[id] }));

  useEffect(() => {
    if (!docsActive) return;
    setDocsOpen(true);
    if (!docsPage) return;
    setOpenGroups((current) => ({
      ...current,
      [docsPage.audience]: true,
    }));
  }, [docsActive, docsPage]);

  const renderDocsTree = () => (
    <div className="space-y-1">
      <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        Reference
      </p>
      <button
        type="button"
        onClick={() => setDocsOpen((current) => !current)}
        className={cn(
          buttonVariants({ variant: docsActive ? "secondary" : "ghost", size: "sm" }),
          "w-full justify-between",
        )}
        aria-expanded={docsOpen}
      >
        <span className="inline-flex items-center gap-2">
          <BookOpenText className="size-4" />
          Documentation
        </span>
        <ChevronDown className={cn("size-4 transition-transform", docsOpen ? "rotate-180" : "")} />
      </button>

      {docsOpen ? (
        <div className="ml-3 space-y-2 border-l border-border/50 pl-3">
          <a
            href="/docs"
            onClick={onNavigate}
            className={cn(
              buttonVariants({
                variant: currentPath === "/docs" ? "secondary" : "ghost",
                size: "sm",
              }),
              "w-full justify-start",
            )}
          >
            Overview
          </a>

          {docsAudienceGroups.map((group) => {
            const groupActive = docsPage?.audience === group.id;
            const groupOpen = openGroups[group.id] ?? false;

            return (
              <div key={group.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [group.id]: !groupOpen,
                    }))}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground transition hover:bg-muted/40 hover:text-foreground",
                    groupActive ? "bg-muted/40 text-foreground" : "",
                  )}
                  aria-expanded={groupOpen}
                >
                  <span>{group.title}</span>
                  <ChevronDown className={cn("size-3.5 transition-transform", groupOpen ? "rotate-180" : "")} />
                </button>

                {groupOpen ? (
                  <div className="space-y-1">
                    {group.pages.map((page) => {
                      const pageActive = currentPath === page.href;
                      return (
                        <div key={page.href} className="space-y-1">
                          <a
                            href={page.href}
                            onClick={onNavigate}
                            className={cn(
                              buttonVariants({
                                variant: pageActive ? "secondary" : "ghost",
                                size: "sm",
                              }),
                              "w-full justify-start text-left",
                            )}
                          >
                            {page.shortTitle}
                          </a>

                          {pageActive ? (
                            <div className="ml-3 space-y-1 border-l border-border/40 pl-3">
                              {page.sections.map((section) => {
                                const sectionActive = currentHash === `#${section.id}`;
                                return (
                                  <a
                                    key={section.id}
                                    href={`${page.href}#${section.id}`}
                                    onClick={onNavigate}
                                    className={cn(
                                      "block rounded-md px-2 py-1 text-xs leading-5 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground",
                                      sectionActive ? "bg-muted/50 text-foreground" : "",
                                    )}
                                  >
                                    {section.title}
                                  </a>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  const renderGroup = (group: NavGroupDef) => {
    const groupActive = isGroupActive(currentPath, group);
    const open = openNavGroups[group.id] ?? groupActive;

    // Per-group runtime item tweaks: the Uploads badge, and the conditional
    // shared Mood Boards link under Records.
    let items = group.items;
    if (group.id === "photos") {
      items = items.map((item) =>
        item.href === "/admin/uploads" ? { ...item, badgeCount: uploadsPendingCount } : item,
      );
    } else if (group.id === "records" && sharedBoardsCount >= 1) {
      items = [...items, { href: "/moodboards", label: "Mood Boards" }];
    }
    const collapsedBadge = items.reduce((sum, item) => sum + (item.badgeCount ?? 0), 0);

    return (
      <div key={group.id} className="space-y-1">
        <button
          type="button"
          onClick={() => toggleNavGroup(group.id)}
          aria-expanded={open}
          className={cn(
            "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.24em] transition hover:bg-muted/40 hover:text-foreground",
            groupActive ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="inline-flex items-center gap-2">
            {group.label}
            {!open && collapsedBadge > 0 ? (
              <Badge variant="destructive" className="h-4 min-w-4 justify-center px-1 text-[9px]">
                {collapsedBadge > 99 ? "99+" : collapsedBadge}
              </Badge>
            ) : null}
          </span>
          <ChevronDown className={cn("size-3.5 transition-transform", open ? "rotate-180" : "")} />
        </button>
        {open ? (
          <div className="space-y-1">
            {items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                badgeCount={item.badgeCount}
                active={isPathActive(currentPath, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  };

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

      {accessAuthenticated ? (
        NAV_GROUPS.filter((group) => group.admin).map((group) => renderGroup(group))
      ) : (
        <div className="space-y-1">
          <NavLink
            href="/admin"
            label="Admin"
            active={currentPath === "/admin"}
            onNavigate={onNavigate}
          />
        </div>
      )}

      {NAV_GROUPS.filter((group) => !group.admin).map((group) => renderGroup(group))}

      {renderDocsTree()}
    </nav>
  );
}

function SidebarContent({
  currentPath,
  currentHash,
  uploadsPendingCount,
  accessAuthenticated,
  sharedBoardsCount,
  onNavigate,
}: {
  currentPath: string;
  currentHash: string;
  uploadsPendingCount: number;
  accessAuthenticated: boolean;
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

      <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-3" style={{ WebkitOverflowScrolling: "touch" }}>
        <SidebarLinks
          currentPath={currentPath}
          currentHash={currentHash}
          uploadsPendingCount={uploadsPendingCount}
          accessAuthenticated={accessAuthenticated}
          sharedBoardsCount={sharedBoardsCount}
          onNavigate={onNavigate}
        />
      </div>

      <Separator />

      <div className="space-y-2 px-3 py-3">
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

export function AppSidebar({ currentPath: currentPathProp }: { currentPath?: string } = {}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadsPendingCount, setUploadsPendingCount] = useState(0);
  const [currentHash, setCurrentHash] = useState("");
  const [accessAuthenticated, setAccessAuthenticated] = useState(false);
  const [sharedBoardsCount, setSharedBoardsCount] = useState(0);
  // The active path is supplied by the server (Astro passes `Astro.url.pathname`)
  // so the correct nav item and expanded section are already in the SSR HTML —
  // no client round-trip, no post-hydration highlight flip. Falls back to
  // `window.location` only if the prop is omitted (e.g. a stray client-only mount).
  const currentPath = useMemo(() => {
    const raw =
      currentPathProp ?? (typeof window === "undefined" ? "/" : window.location.pathname);
    return raw.replace(/\/+$/, "") || "/";
  }, [currentPathProp]);

  useEffect(() => {
    const syncHash = () => {
      setCurrentHash(window.location.hash || "");
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchSidebarState = async () => {
      try {
        const [pendingResponse, accessResponse, sharedResponse] = await Promise.all([
          fetch("/api/images/mapping/summary"),
          fetch("/api/access/status", { credentials: "include" }),
          fetch("/api/mood-board?shared=true"),
        ]);
        const pendingPayload = (await pendingResponse.json()) as {
          success?: boolean;
          pending?: { total?: number };
        };
        const accessPayload = (await accessResponse.json()) as {
          success?: boolean;
          authenticated?: boolean;
        };
        const sharedPayload = (await sharedResponse.json()) as {
          moodBoards?: any[];
        };
        if (!mounted) return;
        if (pendingResponse.ok && pendingPayload.success) {
          setUploadsPendingCount(pendingPayload.pending?.total || 0);
        }
        if (accessResponse.ok && accessPayload.success) {
          setAccessAuthenticated(Boolean(accessPayload.authenticated));
        }
        if (sharedResponse.ok && sharedPayload.moodBoards) {
          setSharedBoardsCount(sharedPayload.moodBoards.length);
        }
      } catch {
        // Keep sidebar resilient; no-op on badge fetch failures.
      }
    };

    const onSummaryUpdated = () => {
      void fetchSidebarState();
    };

    void fetchSidebarState();
    window.addEventListener("global-upload-complete", onSummaryUpdated);
    window.addEventListener("image-mapping-summary-updated", onSummaryUpdated);
    window.addEventListener("design-boards-updated", onSummaryUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("global-upload-complete", onSummaryUpdated);
      window.removeEventListener("image-mapping-summary-updated", onSummaryUpdated);
      window.removeEventListener("design-boards-updated", onSummaryUpdated);
    };
  }, []);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border/40 bg-background/90 backdrop-blur md:block">
        <SidebarContent
          currentPath={currentPath}
          currentHash={currentHash}
          uploadsPendingCount={uploadsPendingCount}
          accessAuthenticated={accessAuthenticated}
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
          {/* Backdrop */}
          {/* biome-ignore lint/a11y/useKeyEvents: overlay dismiss */}
          {/* biome-ignore lint/a11y/useAriaRole: overlay dismiss */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer panel */}
          <aside
            className="absolute inset-y-0 left-0 flex w-[88vw] max-w-xs flex-col border-r border-border/40 bg-background shadow-xl"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <SidebarContent
              currentPath={currentPath}
              currentHash={currentHash}
              uploadsPendingCount={uploadsPendingCount}
              accessAuthenticated={accessAuthenticated}
              sharedBoardsCount={sharedBoardsCount}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}
