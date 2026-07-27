import { BookOpenText, ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { docsAudienceGroups, getDocsPageByPath } from "@/lib/docs";
import { cn } from "@/lib/utils";

/**
 * A navigable node inside a sidebar section. Nodes nest via `children`, so a
 * section can hold a submenu (e.g. Showrooms → Drive Lists / Contacts / Sales).
 *
 * - `href` is optional: a pure grouping node (e.g. "Purchase Ops") has children
 *   but nowhere of its own to go, so it only toggles.
 * - `navigateOnExpand` (only meaningful with both `href` and `children`) makes
 *   the parent label a link: clicking it navigates AND expands the submenu. On
 *   an MPA the destination page reseeds the open state from the active route.
 * - `icon` renders before the label and, for top-level items, in the collapsed
 *   rail. `badgeCount` > 0 renders a destructive count pill and rolls up into a
 *   collapsed parent's summary badge.
 */
export type SidebarItem = {
  href?: string;
  label: string;
  icon?: LucideIcon;
  badgeCount?: number;
  children?: SidebarItem[];
  navigateOnExpand?: boolean;
};

/**
 * A collapsible sidebar section. `admin` sections have URLs under `/admin/*`
 * (the invariant pairing sidebar grouping with route foldering) and are only
 * ever rendered by the AdminSidebar. Non-admin sections hold user-facing root
 * pages and are rendered by the PublicSidebar. `icon` is shown next to the
 * section header and standing in for the whole section in the collapsed rail.
 */
export type NavGroupDef = {
  id: string;
  label: string;
  admin: boolean;
  icon?: LucideIcon;
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
  // The Shopping hub has its own sub-pages listed in the sidebar; exact-match so
  // a sub-page (e.g. /admin/shopping/showrooms) doesn't also light up the hub.
  if (href === "/admin/shopping") return currentPath === "/admin/shopping";
  // Changelog and its Preview twin are both sidebar items, and Preview lives
  // UNDER /admin/changelog — so prefix-matching would light up both. Scope
  // Changelog to itself + its own [slug] pages, never the /preview subtree.
  if (href === "/admin/changelog") {
    return (
      (currentPath === href || currentPath.startsWith(`${href}/`)) &&
      !currentPath.startsWith("/admin/changelog/preview")
    );
  }
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/** True when an item OR any of its descendants matches the active route. */
export function isItemActive(currentPath: string, item: SidebarItem): boolean {
  if (item.href && isPathActive(currentPath, item.href)) return true;
  return (item.children ?? []).some((child) => isItemActive(currentPath, child));
}

/** Recursively sums badge counts across an item subtree (for collapsed roll-ups). */
function sumBadges(items: SidebarItem[]): number {
  return items.reduce(
    (total, item) => total + (item.badgeCount ?? 0) + sumBadges(item.children ?? []),
    0,
  );
}

/** True when any item (or descendant) in the group matches the active route. */
export function isGroupActive(currentPath: string, group: NavGroupDef): boolean {
  return group.items.some((item) => isItemActive(currentPath, item));
}

interface NavLinkProps {
  href: string;
  label: string;
  active: boolean;
  external?: boolean;
  badgeCount?: number;
  icon?: LucideIcon;
  onNavigate?: () => void;
}

export function NavLink(props: NavLinkProps) {
  const { href, label, active, external, badgeCount, icon: Icon, onNavigate } = props;
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
      <span className="inline-flex min-w-0 items-center gap-2">
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
        <span className="truncate">{label}</span>
      </span>
      {typeof badgeCount === "number" && badgeCount > 0 ? (
        <Badge variant="destructive" className="ml-2 h-5 min-w-5 justify-center px-1 text-[10px]">
          {badgeCount > 99 ? "99+" : badgeCount}
        </Badge>
      ) : null}
    </a>
  );
}

interface NavNodeProps {
  item: SidebarItem;
  currentPath: string;
  onNavigate?: () => void;
}

/**
 * One navigable node inside a section. A leaf renders a NavLink; a node with
 * `children` renders a collapsible submenu (chevron toggle + indented children),
 * seeded open when a descendant matches the active route. When the node is both
 * a link and a parent (`href` + `navigateOnExpand`), the label navigates while a
 * separate chevron button expands in place without leaving the page.
 */
export function NavNode({ item, currentPath, onNavigate }: NavNodeProps) {
  const hasChildren = (item.children?.length ?? 0) > 0;
  const active = item.href ? isPathActive(currentPath, item.href) : false;
  const descendantActive = isItemActive(currentPath, item);
  // Hooks run unconditionally (before the leaf early-return) to satisfy the
  // rules of hooks; a leaf simply never uses `open`.
  const [open, setOpen] = useState(hasChildren && descendantActive);
  useEffect(() => {
    if (hasChildren && descendantActive) setOpen(true);
  }, [hasChildren, descendantActive]);

  if (!hasChildren) {
    return (
      <NavLink
        href={item.href ?? "#"}
        label={item.label}
        icon={item.icon}
        badgeCount={item.badgeCount}
        active={active}
        onNavigate={onNavigate}
      />
    );
  }

  const Icon = item.icon;
  const parentActive = active || descendantActive;
  const rollupBadge = open ? 0 : sumBadges(item.children ?? []);

  return (
    <div className="space-y-1">
      <div className="flex items-stretch gap-1">
        {item.href && item.navigateOnExpand ? (
          <a
            href={item.href}
            onClick={() => {
              setOpen(true);
              onNavigate?.();
            }}
            className={cn(
              buttonVariants({ variant: parentActive ? "secondary" : "ghost", size: "sm" }),
              "min-w-0 flex-1 justify-start gap-2",
            )}
          >
            {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
            <span className="truncate">{item.label}</span>
            {rollupBadge > 0 ? (
              <Badge variant="destructive" className="ml-auto h-5 min-w-5 justify-center px-1 text-[10px]">
                {rollupBadge > 99 ? "99+" : rollupBadge}
              </Badge>
            ) : null}
          </a>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className={cn(
              buttonVariants({ variant: parentActive ? "secondary" : "ghost", size: "sm" }),
              "min-w-0 flex-1 justify-start gap-2",
            )}
          >
            {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
            <span className="truncate">{item.label}</span>
            {rollupBadge > 0 ? (
              <Badge variant="destructive" className="ml-auto h-5 min-w-5 justify-center px-1 text-[10px]">
                {rollupBadge > 99 ? "99+" : rollupBadge}
              </Badge>
            ) : null}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
          aria-expanded={open}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "shrink-0")}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", open ? "rotate-180" : "")} />
        </button>
      </div>
      {open ? (
        <div className="ml-3 space-y-1 border-l border-border/50 pl-2">
          {item.children?.map((child) => (
            <NavNode
              key={`${child.label}:${child.href ?? ""}`}
              item={child}
              currentPath={currentPath}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
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
  // Re-sync when the resolved groups or path change (e.g. an async fetch adds a
  // conditional item like the shared Mood Boards link): expand any group that now
  // contains the active route, without collapsing the user's manual toggles.
  useEffect(() => {
    setOpenNavGroups((current) => {
      let changed = false;
      const next = { ...current };
      for (const group of groups) {
        if (isGroupActive(currentPath, group) && !next[group.id]) {
          next[group.id] = true;
          changed = true;
        }
      }
      // Return the SAME reference when nothing changed so an unstable `groups`
      // array can't trigger a re-render loop.
      return changed ? next : current;
    });
  }, [groups, currentPath]);
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
  const collapsedBadge = sumBadges(items);
  const GroupIcon = group.icon;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => onToggle(group.id)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.18em] transition hover:bg-muted/40 hover:text-foreground",
          groupActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="inline-flex items-center gap-2">
          {GroupIcon ? <GroupIcon className="size-4" /> : null}
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
            <NavNode
              key={`${item.label}:${item.href ?? ""}`}
              item={item}
              currentPath={currentPath}
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
