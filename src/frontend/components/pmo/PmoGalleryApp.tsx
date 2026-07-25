"use client";

/**
 * @fileoverview The PMO component gallery — 0028 P1 (P1-CMP-12, first slice).
 *
 * Renders every PMO component built so far against fixture data, so a change can
 * be eyeballed without hunting for a consuming page. Grows as the phase lands
 * more components (grid, backlog, Gantt, velocity).
 */
import { useState } from "react";
import { toast } from "sonner";

import type { WorkItem, WorkStatus } from "@/shared/pmo/types";
import {
  AssigneeGroup,
  DependencyChips,
  Eyebrow,
  HealthBadge,
  KpiTile,
  PriorityBadge,
  ProgressBar,
  ProgressRing,
  StatusBadge,
} from "./atoms";
import { FIXTURE_ITEMS } from "./fixtures";
import { REMODEL_COLUMNS, SOFTWARE_COLUMNS, WorkBoard } from "./WorkBoard";
import { WorkItemCard } from "./WorkItemCard";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <Eyebrow>{title}</Eyebrow>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function PmoGalleryApp() {
  // The board is stateful so drag actually reassigns a card's column — the whole
  // point of a gallery is that the interactions work, not just that they render.
  const [items, setItems] = useState<WorkItem[]>(FIXTURE_ITEMS);
  const [remodel, setRemodel] = useState(false);

  function move(item: WorkItem, status: WorkStatus) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
    toast.success(`Moved “${item.title}” → ${status}`);
  }

  return (
    <div className="space-y-2">
      <Section title="Status badges (quiet — outline + dot)">
        <div className="flex flex-wrap gap-2">
          {(["backlog", "todo", "in_progress", "in_review", "blocked", "deferred", "done"] as WorkStatus[]).map(
            (s) => (
              <StatusBadge key={s} status={s} />
            ),
          )}
        </div>
      </Section>

      <Section title="Priority + health badges (loud — filled tonal)">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority="urgent" />
          <PriorityBadge priority="high" />
          <PriorityBadge priority="medium" />
          <PriorityBadge priority="low" />
          <span className="mx-2 h-4 w-px bg-border" />
          <HealthBadge health="on_track" />
          <HealthBadge health="at_risk" />
          <HealthBadge health="blocked" />
          <HealthBadge health="unknown" />
        </div>
      </Section>

      <Section title="Progress (ring is threshold-colored; null renders a dash)">
        <div className="flex flex-wrap items-center gap-6">
          <ProgressRing pct={22} />
          <ProgressRing pct={55} />
          <ProgressRing pct={92} />
          <ProgressRing pct={null} />
          <div className="w-48 space-y-2">
            <ProgressBar pct={22} />
            <ProgressBar pct={55} />
            <ProgressBar pct={92} />
            <ProgressBar pct={null} />
          </div>
        </div>
      </Section>

      <Section title="Assignee group + dependency chips">
        <div className="flex flex-wrap items-center gap-6">
          <AssigneeGroup people={FIXTURE_ITEMS[5].people} />
          <AssigneeGroup people={FIXTURE_ITEMS[6].people} />
          <AssigneeGroup people={[]} />
          <DependencyChips dependsOn={["P1-CMP-01", "P0-FND-05", "DEMO-98"]} />
        </div>
      </Section>

      <Section title="KPI tiles">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile label="Tasks" value="61" />
          <KpiTile label="In progress" value="7" />
          <KpiTile label="Blocked" value="3" trailing={<HealthBadge health="blocked" />} />
          <KpiTile label="Done" value="11" trailing={<HealthBadge health="on_track" />} />
        </div>
      </Section>

      <Section title="WorkItemCard">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIXTURE_ITEMS.slice(0, 3).map((item) => (
            <WorkItemCard key={item.id} item={item} onClick={() => toast(item.title)} />
          ))}
        </div>
      </Section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <Eyebrow>WorkBoard — drag a card between columns</Eyebrow>
          <button
            type="button"
            onClick={() => setRemodel((v) => !v)}
            className="rounded-md border border-border/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {remodel ? "Software columns" : "Remodel columns"}
          </button>
        </div>
        <div className="mt-3">
          <WorkBoard
            items={items}
            columns={remodel ? REMODEL_COLUMNS : SOFTWARE_COLUMNS}
            onStatusChange={move}
            onCardClick={(i) => toast(i.title)}
          />
        </div>
      </section>
    </div>
  );
}
