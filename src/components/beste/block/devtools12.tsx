"use client";

import { Badge } from "src/frontend/components/ui/badge";
import { Gauge } from "lucide-react";
import { cn } from "src/frontend/lib/utils";

interface RateLimitEndpoint {
  path: string;
  current: number;
  limit: number;
  unit?: string;
}

interface Devtools12Props {
  badge?: {
    label: string;
    icon?: React.ReactNode;
    variant?: "default" | "secondary" | "outline";
  };
  heading?: string;
  description?: string;
  endpoints?: RateLimitEndpoint[];
  className?: string;
}

const getBarColor = (current: number, limit: number) => {
  const pct = (current / limit) * 100;
  if (pct >= 90) return "bg-rose-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
};

export const devtools12Demo: Devtools12Props = {
  badge: {
    label: "Rate Limits",
    icon: <Gauge className="size-3" />,
    variant: "outline",
  },
  heading: "API Quotas",
  description: "Monitor request usage and rate limits across your API endpoints in real-time.",
  endpoints: [
    {
      path: "/api/users",
      current: 823,
      limit: 1000,
      unit: "req/min",
    },
    {
      path: "/api/teams",
      current: 156,
      limit: 1000,
      unit: "req/min",
    },
    {
      path: "/api/webhooks",
      current: 945,
      limit: 1000,
      unit: "req/min",
    },
    {
      path: "/api/billing",
      current: 89,
      limit: 500,
      unit: "req/min",
    },
    {
      path: "/api/search",
      current: 412,
      limit: 600,
      unit: "req/min",
    },
  ],
};

export function Devtools12({
  badge,
  heading,
  description,
  endpoints = [],
  className,
}: Devtools12Props) {
  return (
    <section className={cn("py-16 md:py-24 w-full", className)}>
      <div className="mx-auto max-w-3xl px-4 md:px-6">
        {(badge || heading || description) && (
          <div className="mx-auto mb-12 max-w-3xl text-center">
            {badge && (
              <div className="mb-4 flex justify-center">
                <Badge variant={badge.variant ?? "default"}>
                  {badge.icon}
                  {badge.label}
                </Badge>
              </div>
            )}
            {heading && (
              <h2 className="text-2xl md:text-4xl tracking-tight font-semibold">{heading}</h2>
            )}
            {description && (
              <p className="mt-4 text-base md:text-lg text-muted-foreground">{description}</p>
            )}
          </div>
        )}

        <div className="divide-y overflow-hidden rounded-md border bg-card">
          {endpoints.map((endpoint, index) => {
            const percentage = Math.min(100, (endpoint.current / endpoint.limit) * 100);
            const barColor = getBarColor(endpoint.current, endpoint.limit);

            return (
              <div
                key={index}
                className="group/devtools12 space-y-2 px-4 py-4 transition-colors hover:bg-muted/50 md:px-5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">{endpoint.path}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    <span className="font-mono">{endpoint.current.toLocaleString()}</span>
                    {" / "}
                    <span className="font-mono">{endpoint.limit.toLocaleString()}</span>
                    {endpoint.unit && ` ${endpoint.unit}`}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", barColor)}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
