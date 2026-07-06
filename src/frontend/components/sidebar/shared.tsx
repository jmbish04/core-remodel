import { BookOpenText, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { docsAudienceGroups, getDocsPageByPath } from "@/lib/docs";
import { cn } from "@/lib/utils";

/**
 * A single navigable link inside a sidebar section. `badgeCount`, when present
 * and > 0, renders a destructive count pill (e.g. pending uploads).
 */
export type SidebarItem = {
  href: string;
  label: string;
  badgeCount?: number;
};

/**
 * A collapsible sidebar section. `admin` sections have URLs under `/admin/*`
 * (the invariant pairing sidebar grouping with route foldering) and are only
 * ever rendered by the AdminSidebar. Non-admin sections hold user-facing root
 * pages and are rendered by the PublicSidebar.
 */
export type NavGroupDef = {
  id: string;
  label: string;
  admin: boolean;
  items: SidebarItem[];
};

/**
 * Active-route test. `/` and `/admin` only match exactly (they are hub roots
 * whose children would otherwise always mark them active); every other href
 * matches itself or any descendant path.
 */
export function isPathActive(currentPath: string, href: string): boolean {
  if (href === "/") return currentPath === "/";
  if (href === "/admin") return currentPath === "/admin";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/** True when any item in the group matches the active route. */
export function isGroupActive(currentPath: string, group: NavGroupDef): boolean {
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

export function NavLink(props: NavLinkProps) {
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

/**
 * SSR-correct collapsible-group state: each group starts open iff it contains
 * the active route (computed from the server-provided `currentPath`, so the
 * right section is already expanded in the first paint — no post-hydration
 * flip). State resets per page load, which is the desired "active section
 * open" behavior. Callers pass the concrete group set they render.
 */
export function useOpenNavGroups(groups: NavGroupDef[], currentPath: string) {
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((group) => [group.id, isGroupActive(currentPath, group)])),
  );
  const toggleNavGroup = (id: string) =>
    setOpenNavGroups((current) => ({ ...current, [id]: !current[id] }));
  return { openNavGroups, toggleNavGroup };
}

interface RenderGroupOptions {
  group: NavGroupDef;
  currentPath: string;
  open: boolean;
  onToggle: (id: string) => void;
  onNavigate?: () => void;
}

/**
 * Renders one collapsible nav section: a header button (with a collapsed
 * roll-up badge summing hidden item badges) and, when open, its items. Item
 * badge tweaks (e.g. the Uploads count, the conditional shared Mood Boards
 * link) are applied by the caller before passing the group in.
 */
export function RenderGroup({ group, currentPath, open, onToggle, onNavigate }: RenderGroupOptions) {
  const groupActive = isGroupActive(currentPath, group);
  const items = group.items;
  const collapsedBadge = items.reduce((sum, item) => sum + (item.badgeCount ?? 0), 0);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => onToggle(group.id)}
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
}

/**
 * The docs "Reference" tree: a collapsible Documentation root that expands the
 * audience group + page + section matching the active `/docs/...` route. All
 * expand state is seeded from the SSR `currentPath`/`currentHash` for a correct
 * first paint. Shared verbatim between the public and admin sidebars.
 */
export function DocsTree({
  currentPath,
  currentHash,
  onNavigate,
}: {
  currentPath: string;
  currentHash: string;
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

  return (
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
}

/**
 * Normalizes the active path exactly like BaseLayout does server-side. Prefers
 * the SSR-provided prop (so the correct active item is in the first paint);
 * falls back to `window.location` only for stray client-only mounts.
 */
export function useCurrentPath(currentPathProp?: string): string {
  const raw = currentPathProp ?? (typeof window === "undefined" ? "/" : window.location.pathname);
  return raw.replace(/\/+$/, "") || "/";
}

/**
 * Tracks `window.location.hash` (for docs section highlighting). Returns "" on
 * the server and until the first client sync.
 */
export function useCurrentHash(): string {
  const [currentHash, setCurrentHash] = useState("");
  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash || "");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);
  return currentHash;
}
