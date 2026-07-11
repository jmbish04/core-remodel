import * as React from "react";

import { cn } from "@/lib/utils";
import { CONFIG_NAV } from "./config-nav";

export interface ConfigShellProps {
  /** Current pathname (e.g. "/config/photo/colors") — highlights the active item. */
  activeHref: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Reusable shell for every `/config/*` page: a grouped config sidebar (from
 * CONFIG_NAV) on the left and the page's definition-CRUD panel on the right.
 * The config area is its own tab/surface, distinct from the main admin sidebar.
 * Build each config page as `<ConfigShell ...><DefinitionTablePanel .../></ConfigShell>`.
 */
export function ConfigShell({ activeHref, title, description, children }: ConfigShellProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl gap-6 px-4 py-8 lg:gap-10">
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-8">
          <a href="/config" className="mb-4 block text-sm font-semibold tracking-tight text-foreground">
            Configuration
          </a>
          <nav className="flex flex-col gap-5">
            {CONFIG_NAV.map((group) => (
              <div key={group.id}>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className={cn(
                          "block rounded-md px-2 py-1.5 text-sm transition-colors",
                          item.href === activeHref
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </header>
        {children}
      </main>
    </div>
  );
}
