"use client";

import { AlertTriangle, Check, Server, X } from "lucide-react";

import { Badge } from "src/frontend/components/ui/badge";
import { cn } from "src/frontend/lib/utils";

type ServiceStatus = "operational" | "degraded" | "down";

interface ServiceItem {
  title: string;
  status?: ServiceStatus;
  uptime?: string;
  latency?: string;
}

interface Devtools17Props {
  badge?: {
    label: string;
    icon?: React.ReactNode;
    variant?: "default" | "secondary" | "outline";
  };
  heading?: string;
  description?: string;
  services?: ServiceItem[];
  labels?: {
    operational?: string;
    degraded?: string;
    down?: string;
    uptime?: string;
    latency?: string;
  };
  className?: string;
}

const statusConfig: Record<
  ServiceStatus,
  { color: string; bg: string; border: string; icon: typeof Check }
> = {
  operational: {
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    icon: Check,
  },
  degraded: {
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    icon: AlertTriangle,
  },
  down: {
    color: "text-rose-500",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    icon: X,
  },
};

export const devtools17Demo: Devtools17Props = {
  badge: {
    label: "Status",
    icon: <Server className="size-3" />,
    variant: "outline",
  },
  heading: "Service Health",
  description:
    "Monitor infrastructure health, uptime, and latency across all services in real-time.",
  services: [
    {
      title: "API Gateway",
      status: "operational",
      uptime: "99.98%",
      latency: "12ms",
    },
    {
      title: "Database Primary",
      status: "operational",
      uptime: "99.95%",
      latency: "3ms",
    },
    {
      title: "Redis Cache",
      status: "degraded",
      uptime: "98.50%",
      latency: "45ms",
    },
    {
      title: "Object Storage",
      status: "operational",
      uptime: "99.99%",
      latency: "8ms",
    },
    {
      title: "Worker Cluster",
      status: "down",
      uptime: "95.20%",
      latency: "\u2014",
    },
    {
      title: "CDN Edge",
      status: "operational",
      uptime: "99.99%",
      latency: "2ms",
    },
  ],
  labels: {
    operational: "Operational",
    degraded: "Degraded",
    down: "Down",
    uptime: "Uptime",
    latency: "Latency",
  },
};

export function Devtools17({
  badge,
  heading,
  description,
  services = [],
  labels = {},
  className,
}: Devtools17Props) {
  const {
    operational: operationalLabel,
    degraded: degradedLabel,
    down: downLabel,
    uptime: uptimeLabel,
    latency: latencyLabel,
  } = labels;

  const statusLabels: Record<ServiceStatus, string | undefined> = {
    operational: operationalLabel,
    degraded: degradedLabel,
    down: downLabel,
  };

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
              <h2 className="text-2xl md:text-4xl tracking-tight font-semibold">
                {heading}
              </h2>
            )}
            {description && (
              <p className="mt-4 text-base md:text-lg text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        )}

        <div className="divide-y overflow-hidden rounded-md border bg-card">
          {services.map((service, index) => {
            const status = service.status ?? "operational";
            const config = statusConfig[status];
            const StatusIcon = config.icon;

            return (
              <div
                key={index}
                className="group/devtools17 flex items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/50 md:px-5"
              >
                <div
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                    config.bg
                  )}
                >
                  <StatusIcon
                    className={cn("size-4", config.color)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {service.title}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0",
                        config.color,
                        config.border
                      )}
                    >
                      {statusLabels[status]}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                    {service.uptime && (
                      <span>
                        {uptimeLabel}{" "}
                        <span className="font-mono font-medium">
                          {service.uptime}
                        </span>
                      </span>
                    )}
                    {service.latency && (
                      <span>
                        {latencyLabel}{" "}
                        <span className="font-mono font-medium">
                          {service.latency}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
