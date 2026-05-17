import { BookOpenText, ChevronDown, Home, Menu } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { Icons } from "@/components/Icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { siteConfig } from "@/lib/config";
import { docsAudienceGroups, getDocsPageByPath } from "@/lib/docs";
import { cn } from "@/lib/utils";

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
  onNavigate,
}: {
  currentPath: string;
  currentHash: string;
  uploadsPendingCount: number;
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

  return (
    <nav className="space-y-1" aria-label="Main navigation">
      <NavLink
        href="/"
        label="Home"
        active={currentPath === "/"}
        onNavigate={onNavigate}
      />
      {siteConfig.navItems.map((item) =>
        item.href === "/docs" ? (
          <React.Fragment key={item.href}>{renderDocsTree()}</React.Fragment>
        ) : (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            external={item.external}
            badgeCount={item.href === "/uploads" ? uploadsPendingCount : undefined}
            active={!item.external && currentPath.startsWith(item.href)}
            onNavigate={onNavigate}
          />
        ),
      )}
    </nav>
  );
}

function SidebarContent({
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
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-3">
        <Home className="size-4 text-muted-foreground" />
        <a href="/" className="truncate text-sm font-semibold" onClick={onNavigate}>
          {siteConfig.name}
        </a>
      </div>

      <Separator />

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <SidebarLinks
          currentPath={currentPath}
          currentHash={currentHash}
          uploadsPendingCount={uploadsPendingCount}
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
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [uploadsPendingCount, setUploadsPendingCount] = useState(0);
  const [currentHash, setCurrentHash] = useState("");
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

    const fetchPendingCount = async () => {
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
      void fetchPendingCount();
    };

    void fetchPendingCount();
    window.addEventListener("global-upload-complete", onSummaryUpdated);
    window.addEventListener("image-mapping-summary-updated", onSummaryUpdated);

    return () => {
      mounted = false;
      window.removeEventListener("global-upload-complete", onSummaryUpdated);
      window.removeEventListener("image-mapping-summary-updated", onSummaryUpdated);
    };
  }, []);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border/40 bg-background/90 backdrop-blur md:block">
        <SidebarContent
          currentPath={currentPath}
          currentHash={currentHash}
          uploadsPendingCount={uploadsPendingCount}
        />
      </aside>

      <div className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-border/40 bg-background/90 px-3 backdrop-blur md:hidden">
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Open navigation menu" />}>
            <Menu className="size-4" />
          </DialogTrigger>
          <DialogContent className="left-0 top-0 h-svh w-[88vw] max-w-xs translate-x-0 translate-y-0 rounded-none border-r border-border/40 p-0">
            <DialogHeader className="px-3 py-3">
              <DialogTitle className="text-sm font-semibold">Navigation</DialogTitle>
            </DialogHeader>
            <SidebarContent
              currentPath={currentPath}
              currentHash={currentHash}
              uploadsPendingCount={uploadsPendingCount}
              onNavigate={() => setMobileOpen(false)}
            />
          </DialogContent>
        </Dialog>

        <a href="/" className="truncate text-sm font-semibold">
          {siteConfig.name}
        </a>
      </div>
    </>
  );
}
