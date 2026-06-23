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

const WORKSPACE_ITEMS: SidebarItem[] = [
  { href: "/supporting-docs", label: "Project Records" },
];

const GALLERY_ITEMS: SidebarItem[] = [
  { href: "/floor-plan", label: "Floor Plan" },
  { href: "/kitchen-layout", label: "Kitchen Layout" },
  { href: "/listing-photos", label: "Listing Photos" },
  { href: "/inspiration-photos", label: "Inspiration Photos" },
];

function isPathActive(currentPath: string, href: string): boolean {
  if (href === "/") return currentPath === "/";
  if (href === "/admin") return currentPath === "/admin";
  return currentPath === href || currentPath.startsWith(`${href}/`);
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

  const renderSection = (label: string, items: SidebarItem[]) => (
    <div className="space-y-1">
      <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        {label}
      </p>
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
  );

  const workspaceItems = [
    { href: "/supporting-docs", label: "Project Records" },
  ];
  if (sharedBoardsCount >= 1) {
    workspaceItems.push({ href: "/moodboards", label: "Mood Boards" });
  }

  return (
    <nav className="space-y-4" aria-label="Main navigation">
      <div className="space-y-1">
        <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Home
        </p>
        <NavLink
          href="/"
          label="Mission Control"
          active={currentPath === "/"}
          onNavigate={onNavigate}
        />
      </div>

      {renderSection("Workspace", workspaceItems)}
      {renderSection("Gallery", GALLERY_ITEMS)}

      {accessAuthenticated ? (
        <>
          {renderSection("Admin - Planning", [
            { href: "/measure", label: "Live Floor Plan" },
            { href: "/measurements", label: "Measurements" },
            { href: "/admin/planning/decision-room", label: "Decision Room" },
            { href: "/admin/planning/moodboards", label: "Mood Boards" },
          ])}
          {renderSection("Admin - Budget", [
            { href: "/budget-tracker", label: "Budget Tracker" },
            { href: "/budget-dashboard", label: "Budget Triage Matrix" },
            { href: "/admin/forecasting", label: "Budget Forecasting" },
            { href: "/admin/truth-table", label: "Labor & Materials Costs" },
          ])}
          {renderSection("Admin - Contractors", [
            { href: "/admin/permits", label: "House Permits" },
            { href: "/admin/permits/contacts", label: "Contractor Permits" },
            { href: "/admin/contracts", label: "Contracts" },
            { href: "/admin/estimates", label: "Estimates" },
            { href: "/bid-portfolios", label: "Bid Portfolios" },
            { href: "/admin/contractor-schedule", label: "Contractor Schedule" },
            { href: "/admin/dialer", label: "Prospect Dialer" },
          ])}
          {renderSection("Admin - Photos & Docs", [
            { href: "/uploads", label: "Uploads", badgeCount: uploadsPendingCount },
            { href: "/review", label: "Review" },
            { href: "/photo-edits", label: "Photo Edits" },
            { href: "/admin/blank-canvas", label: "Blank Canvas" },
            { href: "/builder", label: "Renovation Studio" },
            { href: "/gallery", label: "Render Gallery" },
            { href: "/admin/supporting-docs", label: "Supporting Docs" },
          ])}
          {renderSection("Admin - Tools", [
            { href: "/admin", label: "Analytics" },
            { href: "/admin/research", label: "Research Center" },
          ])}
          {renderSection("Admin - Shopping", [
            { href: "/admin/showroom", label: "Showroom Dashboard" },
            { href: "/admin/showroom/schedule", label: "Materials Schedule" },
            { href: "/admin/showroom/showrooms", label: "Showrooms" },
            { href: "/admin/showroom/products", label: "Products" },
            { href: "/admin/showroom/research", label: "Deep Research" },
            { href: "/admin/showroom/compare", label: "Compare" },
            { href: "/admin/showroom/scan", label: "Field Scan" },
            { href: "/admin/shopping-journal", label: "Shopping Journal" },
            { href: "/rooms/closets", label: "Closet Research" },
            { href: "/admin/showroom/progress", label: "Build Progress" },
          ])}
        </>
      ) : (
        renderSection("Admin", [{ href: "/admin", label: "Admin" }])
      )}

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

export function AppSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadsPendingCount, setUploadsPendingCount] = useState(0);
  const [currentHash, setCurrentHash] = useState("");
  const [accessAuthenticated, setAccessAuthenticated] = useState(false);
  const [sharedBoardsCount, setSharedBoardsCount] = useState(0);
  const currentPath = useMemo(() => {
    const path = typeof window === "undefined" ? "/" : window.location.pathname;
    return path.replace(/\/+$/, "") || "/";
  }, []);

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
