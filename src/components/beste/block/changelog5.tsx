"use client";

import { Check, Plus, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChangeItem {
  text: string;
  type?: "feature" | "fix" | "improvement";
}

interface TimelineEntry {
  version: string;
  date: string;
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading: string;
  description?: string;
  changes?: ChangeItem[];
  button?: {
    label: string;
    href?: string;
  };
}

interface Changelog5Props {
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading?: string;
  description?: string;
  entries?: TimelineEntry[];
  className?: string;
}

const changeIconMap = {
  feature: Plus,
  fix: Wrench,
  improvement: Check,
};

const changeBadgeMap: Record<string, string> = {
  feature: "bg-primary/10 text-primary",
  fix: "bg-blue-500/10 text-blue-500",
  improvement: "bg-emerald-500/10 text-emerald-500",
};

export const changelog5Demo: Changelog5Props = {
  badge: { label: "Changelog", variant: "secondary" },
  heading: "Product Timeline",
  description:
    "Every milestone on our journey — from small fixes to major releases.",
  entries: [
    {
      version: "v6.0.0",
      date: "March 2025",
      badge: { label: "Major Release", variant: "default" },
      heading: "Next-Gen Platform",
      description:
        "Complete platform rewrite with edge-first architecture, streaming SSR, and a new component model built for server components.",
      changes: [
        { text: "Edge-first deployment model", type: "feature" },
        { text: "Streaming server-side rendering", type: "feature" },
        { text: "New component primitives", type: "feature" },
        { text: "Zero-config TypeScript setup", type: "improvement" },
      ],
      button: { label: "Release notes", href: "https://beste.co" },
    },
    {
      version: "v5.4.0",
      date: "February 2025",
      badge: { label: "Feature", variant: "secondary" },
      heading: "AI-Powered Search",
      description:
        "Semantic search across all content types with natural language queries, instant suggestions, and ranked results.",
      changes: [
        { text: "Natural language query parser", type: "feature" },
        { text: "Vector-based content indexing", type: "feature" },
        { text: "Improved ranking algorithm", type: "improvement" },
      ],
    },
    {
      version: "v5.3.2",
      date: "January 2025",
      badge: { label: "Patch", variant: "outline" },
      heading: "Stability Fixes",
      description:
        "Addressed memory leaks in long-running processes, fixed timezone handling in scheduled tasks, and patched a websocket reconnection edge case.",
      changes: [
        { text: "Fixed memory leak in worker threads", type: "fix" },
        { text: "Timezone-aware scheduler", type: "fix" },
        { text: "Websocket reconnection reliability", type: "fix" },
        { text: "Reduced Docker image size by 30%", type: "improvement" },
      ],
    },
    {
      version: "v5.3.0",
      date: "December 2024",
      badge: { label: "Feature", variant: "secondary" },
      heading: "Audit Logging",
      description:
        "Comprehensive audit trail for all API operations with filterable logs, export capabilities, and compliance-ready reports.",
      changes: [
        { text: "Full API operation audit trail", type: "feature" },
        { text: "Filterable log explorer", type: "feature" },
        { text: "SOC 2 compliance report export", type: "improvement" },
      ],
      button: { label: "Learn more", href: "https://beste.co" },
    },
  ],
};

export function Changelog5({
  badge,
  heading,
  description,
  entries = [],
  className,
}: Changelog5Props) {
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

        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-3 top-2 bottom-0 w-px bg-border md:left-4" />

          <div className="space-y-10">
            {entries.map((entry, index) => (
              <div key={index} className="relative pl-10 md:pl-12">
                {/* Timeline dot */}
                <div className="absolute left-1.5 top-1.5 size-3.5 rounded-full border-2 border-background bg-primary md:left-2.5" />

                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="font-mono text-sm font-semibold">
                    {entry.version}
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-sm text-muted-foreground">
                    {entry.date}
                  </span>
                  {entry.badge && (
                    <Badge variant={entry.badge.variant ?? "secondary"}>
                      {entry.badge.label}
                    </Badge>
                  )}
                </div>

                <h3 className="text-lg font-semibold">{entry.heading}</h3>

                {entry.description && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {entry.description}
                  </p>
                )}

                {entry.changes && entry.changes.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {entry.changes.map((change, i) => {
                      const type = change.type ?? "feature";
                      const Icon = changeIconMap[type];
                      const color = changeBadgeMap[type];
                      return (
                        <span
                          key={i}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                            color
                          )}
                        >
                          <Icon className="size-3" />
                          {change.text}
                        </span>
                      );
                    })}
                  </div>
                )}

                {entry.button && (
                  <div className="mt-4">
                    <Button variant="outline" size="sm" render={<a href={entry.button.href ?? "#"} />} nativeButton={false}>{entry.button.label}</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
