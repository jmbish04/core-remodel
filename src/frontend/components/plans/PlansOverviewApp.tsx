import { ArrowRight, FileText, Loader2, Map } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  api,
  CountChip,
  PlanStatusBadge,
  ProgressBar,
  statusDotClass,
  type PlanSummary,
} from "./shared";

interface PlansResponse {
  success: boolean;
  plans: PlanSummary[];
}

const POLL_MS = 10_000;

export function PlansOverviewApp() {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Track whether the very first fetch resolved so polling never shows a spinner.
  const loadedOnce = useRef(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const payload = await api<PlansResponse>("/api/admin/plans");
        if (!mounted) return;
        setPlans(payload.plans ?? []);
      } catch (error) {
        if (!mounted) return;
        // Only toast the initial failure; silent on background poll errors to
        // avoid a toast storm if the tab sits open through a blip.
        if (!loadedOnce.current) {
          toast.error(error instanceof Error ? error.message : "Failed to load plans");
        }
      } finally {
        if (mounted) {
          loadedOnce.current = true;
          setLoading(false);
        }
      }
    };

    void load();
    const interval = window.setInterval(load, POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const sorted = useMemo(
    () => (plans ? [...plans].sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [plans],
  );

  const overall = useMemo(() => {
    if (!plans || plans.length === 0) return { total: 0, done: 0, percent: 0 };
    const total = plans.reduce((sum, p) => sum + p.progress.total, 0);
    const done = plans.reduce((sum, p) => sum + p.progress.counts.done, 0);
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, percent };
  }, [plans]);

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
              <Map className="size-6 text-muted-foreground" />
              Roadmap Plans
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live progress across every build plan. Auto-refreshes every 10 seconds.
            </p>
          </div>
          {plans && plans.length > 0 ? (
            <div className="text-right">
              <p className="text-3xl font-bold tabular-nums">{overall.percent}%</p>
              <p className="text-xs text-muted-foreground">
                {overall.done} / {overall.total} tasks done
              </p>
            </div>
          ) : null}
        </div>
        {plans && plans.length > 0 ? (
          <ProgressBar percent={overall.percent} tone="success" />
        ) : null}
      </header>

      {loading && !plans ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading plans…
        </div>
      ) : sorted.length === 0 ? (
        <Card className="ring-1 ring-border/40">
          <CardContent className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              No roadmap plans yet. Plans appear here as soon as they are seeded.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((plan) => (
            <a
              key={plan.slug}
              href={`/admin/plans/${plan.slug}`}
              className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Card className="h-full ring-1 ring-border/40 transition-colors group-hover:ring-border/80">
                <CardHeader className="gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base leading-snug">{plan.title}</CardTitle>
                    <PlanStatusBadge status={plan.status} />
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{plan.description}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{plan.progress.percent}% complete</span>
                      <span className="tabular-nums">
                        {plan.progress.counts.done} / {plan.progress.total}
                      </span>
                    </div>
                    <ProgressBar percent={plan.progress.percent} />
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <CountChip
                      label="done"
                      count={plan.progress.counts.done}
                      dotClass={statusDotClass("done")}
                    />
                    <CountChip
                      label="active"
                      count={plan.progress.counts.in_progress}
                      dotClass={statusDotClass("in_progress")}
                    />
                    <CountChip
                      label="pending"
                      count={plan.progress.counts.pending}
                      dotClass={statusDotClass("pending")}
                    />
                    <CountChip
                      label="blocked"
                      count={plan.progress.counts.blocked}
                      dotClass={statusDotClass("blocked")}
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate font-mono">{plan.docPath}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      Open board
                      <ArrowRight className="size-3.5" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
