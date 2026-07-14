"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ReleaseItem {
  version: string;
  date: string;
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading: string;
  summary?: string;
  changes?: string[];
  button?: {
    label: string;
    href?: string;
  };
}

interface Changelog3Props {
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading?: string;
  description?: string;
  releases?: ReleaseItem[];
  className?: string;
}

export const changelog3Demo: Changelog3Props = {
  badge: { label: "Changelog", variant: "secondary" },
  heading: "Release Feed",
  description:
    "Stay up to date with every release, improvement, and bug fix we ship.",
  releases: [
    {
      version: "v4.2.0",
      date: "Feb 28, 2025",
      badge: { label: "Feature", variant: "default" },
      heading: "Collaborative Editing",
      summary:
        "Real-time collaborative editing with cursor presence, inline comments, and conflict-free merging across all document types.",
      changes: [
        "Multi-cursor presence indicators",
        "Inline threaded comments",
        "Automatic conflict resolution",
        "Offline edit queuing",
      ],
      button: { label: "Learn more", href: "https://beste.co" },
    },
    {
      version: "v4.1.2",
      date: "Feb 14, 2025",
      badge: { label: "Fix", variant: "outline" },
      heading: "Authentication Hotfix",
      summary:
        "Resolved a session persistence issue affecting users with third-party SSO providers. Tokens are now refreshed correctly on all identity flows.",
      changes: [
        "Fixed SSO token refresh loop",
        "Improved session cookie handling",
        "Added retry logic for OIDC callbacks",
      ],
    },
    {
      version: "v4.1.0",
      date: "Feb 1, 2025",
      badge: { label: "Improvement", variant: "secondary" },
      heading: "Dashboard Redesign",
      summary:
        "Completely revamped dashboard with customizable widget grid, saved layouts, and new data visualization components.",
      changes: [
        "Drag-and-drop widget grid",
        "Saved layout presets",
        "New chart components",
        "Dark mode optimizations",
      ],
      button: { label: "See what changed", href: "https://beste.co" },
    },
    {
      version: "v4.0.0",
      date: "Jan 15, 2025",
      badge: { label: "Major", variant: "default" },
      heading: "Platform v4",
      summary:
        "A ground-up rebuild with a new plugin architecture, faster build pipeline, and first-class TypeScript support across every API surface.",
      changes: [
        "New plugin system with hot-reload",
        "TypeScript-first API design",
        "50% faster build pipeline",
        "Backwards-compatible migration CLI",
      ],
      button: { label: "Read the announcement", href: "https://beste.co" },
    },
  ],
};

export function Changelog3({
  badge,
  heading,
  description,
  releases = [],
  className,
}: Changelog3Props) {
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
              <h2 className="text-2xl font-semibold tracking-tight md:text-4xl">{heading}</h2>
            )}
            {description && (
              <p className="mt-4 text-base text-muted-foreground md:text-lg">
                {description}
              </p>
            )}
          </div>
        )}

        <div className="space-y-0">
          {releases.map((release, index) => (
            <article
              key={index}
              className={cn(
                "pb-10",
                index > 0 && "border-t pt-10"
              )}
            >
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm font-semibold">
                  {release.version}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-sm text-muted-foreground">
                  {release.date}
                </span>
                {release.badge && (
                  <Badge variant={release.badge.variant ?? "secondary"}>
                    {release.badge.label}
                  </Badge>
                )}
              </div>

              <h3 className="text-lg font-semibold">{release.heading}</h3>

              {release.summary && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {release.summary}
                </p>
              )}

              {release.changes && release.changes.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {release.changes.map((change, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                      {change}
                    </li>
                  ))}
                </ul>
              )}

              {release.button && (
                <div className="mt-5">
                  <Button variant="outline" size="sm" render={<a href={release.button.href ?? "#"} />} nativeButton={false}>{release.button.label}</Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
