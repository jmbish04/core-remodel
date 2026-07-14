"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ReleaseEntry {
  version: string;
  date: string;
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading: string;
  description?: string;
  callout?: {
    title: string;
    text: string;
  };
  changes?: string[];
  button?: {
    label: string;
    href?: string;
  };
}

interface Changelog24Props {
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading?: string;
  description?: string;
  entries?: ReleaseEntry[];
  className?: string;
}

export const changelog24Demo: Changelog24Props = {
  badge: { label: "Changelog", variant: "secondary" },
  heading: "Release Highlights",
  description: "Each release with its most impactful change front and center.",
  entries: [
    {
      version: "v6.0.0",
      date: "March 2025",
      badge: { label: "Major", variant: "default" },
      heading: "Platform v6 — Edge-First Architecture",
      description:
        "A ground-up rebuild that moves every workload to the edge. Streaming SSR, new component model, and a plugin system designed for the modern web.",
      callout: {
        title: "60% faster Time to First Byte",
        text: "Our new streaming SSR pipeline delivers HTML from the nearest edge node as it is generated, eliminating the round-trip to origin servers. Users on slow connections see content appear in under 200ms.",
      },
      changes: [
        "Edge deployment at 40+ global locations",
        "Plugin marketplace with one-click installs",
        "Zero-config TypeScript with path aliases",
        "Automated migration CLI for v5 projects",
      ],
      button: { label: "Read the full announcement", href: "https://beste.co" },
    },
    {
      version: "v5.4.0",
      date: "February 2025",
      badge: { label: "Feature", variant: "secondary" },
      heading: "AI-Powered Semantic Search",
      description:
        "Natural language search across all content types with vector-based indexing and contextual result ranking.",
      callout: {
        title: "Search in plain English",
        text: "Type questions like \"which users signed up last week from Europe\" and get instant, accurate results. Our vector index understands intent, not just keywords.",
      },
      changes: [
        "Natural language query parser",
        "Vector-based content indexing",
        "Contextual search suggestions",
        "Highlighted result snippets",
      ],
      button: { label: "Try semantic search", href: "https://beste.co" },
    },
    {
      version: "v5.3.0",
      date: "January 2025",
      badge: { label: "Feature", variant: "secondary" },
      heading: "Visual Workflow Builder",
      description:
        "Design multi-step automations with a drag-and-drop canvas, conditional branching, and webhook integrations.",
      callout: {
        title: "Replace your entire automation stack",
        text: "One canvas replaces Zapier, Make, and custom cron scripts. Build flows visually, test them in-place, and deploy with version history and instant rollback.",
      },
      changes: [
        "Drag-and-drop flow canvas",
        "Conditional branches with AND/OR logic",
        "Cron and event-driven triggers",
        "Workflow version history and rollback",
      ],
    },
  ],
};

export function Changelog24({
  badge,
  heading,
  description,
  entries = [],
  className,
}: Changelog24Props) {
  return (
    <section className={cn("py-16 md:py-24 w-full", className)}>
      <div className="mx-auto max-w-3xl px-4 md:px-6">
        {(badge || heading || description) && (
          <div className="mb-12">
            {badge && (
              <div className="mb-4">
                <Badge variant={badge.variant ?? "secondary"}>
                  {badge.label}
                </Badge>
              </div>
            )}
            {heading && (
              <h2 className="text-2xl font-semibold tracking-tight md:text-4xl">
                {heading}
              </h2>
            )}
            {description && (
              <p className="mt-4 text-base text-muted-foreground md:text-lg">
                {description}
              </p>
            )}
          </div>
        )}

        <div className="space-y-0">
          {entries.map((entry, index) => (
            <article
              key={index}
              className={cn("pb-12", index > 0 && "border-t pt-12")}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  {entry.version}
                </span>
                {entry.badge && (
                  <Badge variant={entry.badge.variant ?? "secondary"}>
                    {entry.badge.label}
                  </Badge>
                )}
              </div>
              <p className="mb-3 text-xs text-muted-foreground/60">
                {entry.date}
              </p>

              <h3 className="text-lg font-semibold">{entry.heading}</h3>

              {entry.description && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {entry.description}
                </p>
              )}

              {entry.callout && (
                <div className="mt-5 rounded-md border-l-2 border-primary bg-primary/5 py-4 pr-5 pl-5">
                  <p className="text-sm font-semibold">{entry.callout.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {entry.callout.text}
                  </p>
                </div>
              )}

              {entry.changes && entry.changes.length > 0 && (
                <ul className="mt-5 space-y-1.5">
                  {entry.changes.map((change, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-foreground/80"
                    >
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                      {change}
                    </li>
                  ))}
                </ul>
              )}

              {entry.button && (
                <div className="mt-6">
                  <a
                    href={entry.button.href ?? "#"}
                    target={entry.button.href?.startsWith("http") ? "_blank" : undefined}
                    rel="noreferrer"
                    className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium ring-1 ring-border transition-colors hover:bg-muted/50"
                  >
                    {entry.button.label}
                  </a>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
