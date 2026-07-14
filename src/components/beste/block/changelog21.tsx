"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ChangeCard {
  heading: string;
  description?: string;
  version?: string;
}

interface ChangeColumn {
  label: string;
  color?: string;
  items: ChangeCard[];
}

interface Changelog21Props {
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "outline";
  };
  heading?: string;
  description?: string;
  columns?: ChangeColumn[];
  className?: string;
}

const defaultColors: Record<string, string> = {
  Features: "bg-emerald-500",
  Fixes: "bg-blue-500",
  Improvements: "bg-amber-500",
};

export const changelog21Demo: Changelog21Props = {
  badge: { label: "March 2025", variant: "secondary" },
  heading: "This Month's Changes",
  description: "Everything we shipped, organized by type.",
  columns: [
    {
      label: "Features",
      items: [
        {
          heading: "Visual workflow builder",
          description:
            "Drag-and-drop canvas for creating multi-step automations with conditional logic.",
          version: "v5.2.0",
        },
        {
          heading: "Embeddable analytics widgets",
          description:
            "Drop-in iframe widgets for charts, tables, and KPI cards.",
          version: "v5.2.0",
        },
        {
          heading: "Webhook event filtering",
          description:
            "Granular event type selection for webhook subscriptions.",
          version: "v5.1.0",
        },
        {
          heading: "Batch API operations",
          description:
            "Process up to 1,000 operations in a single atomic request.",
          version: "v5.2.0",
        },
      ],
    },
    {
      label: "Fixes",
      items: [
        {
          heading: "SSO token refresh loop",
          description:
            "Resolved session drops for OIDC and SAML providers during token refresh.",
          version: "v5.1.3",
        },
        {
          heading: "Cursor pagination on nested resources",
          description:
            "Fixed incorrect offset calculation for deeply nested collections.",
          version: "v5.1.2",
        },
        {
          heading: "CSV export encoding",
          description:
            "Corrected multibyte character handling in exported files.",
          version: "v5.1.1",
        },
      ],
    },
    {
      label: "Improvements",
      items: [
        {
          heading: "Search ranking algorithm",
          description:
            "Tuned relevance scoring to prioritize exact matches and recent content.",
          version: "v5.1.4",
        },
        {
          heading: "Dashboard load performance",
          description: "Reduced initial dashboard load time by 45%.",
          version: "v5.1.0",
        },
        {
          heading: "Rate limit response headers",
          description:
            "Added retry-after and remaining quota to all limit responses.",
          version: "v5.1.2",
        },
      ],
    },
  ],
};

export function Changelog21({
  badge,
  heading,
  description,
  columns = [],
  className,
}: Changelog21Props) {
  return (
    <section className={cn("py-16 md:py-24 w-full", className)}>
      <div className="mx-auto max-w-6xl px-4 md:px-6">
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

        <div className="grid gap-6 md:grid-cols-3">
          {columns.map((column, ci) => (
            <div key={ci}>
              <div className="mb-4 flex items-center gap-2">
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    column.color ?? defaultColors[column.label] ?? "bg-primary"
                  )}
                />
                <h3 className="text-sm font-semibold">{column.label}</h3>
                <span className="text-xs text-muted-foreground">
                  {column.items.length}
                </span>
              </div>
              <div className="space-y-3">
                {column.items.map((item, ii) => (
                  <div key={ii} className="rounded-md border p-4">
                    <p className="text-sm font-medium">{item.heading}</p>
                    {item.description && (
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                    {item.version && (
                      <p className="mt-2 font-mono text-[10px] text-muted-foreground/50">
                        {item.version}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
