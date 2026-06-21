"use client";

import {
  GanttFeatureItem,
  GanttFeatureList,
  GanttFeatureListGroup,
  GanttHeader,
  GanttMarker,
  GanttProvider,
  GanttSidebar,
  GanttSidebarGroup,
  GanttSidebarItem,
  GanttTimeline,
  GanttToday,
} from "@/components/kibo-ui/gantt";
import type { GanttFeature, GanttStatus } from "@/components/kibo-ui/gantt";

// ─── Statuses & Colors ──────────────────────────────────────────────────
const STATUS_ADMIN: GanttStatus = {
  id: "status-admin",
  name: "Administrative / Waiting",
  color: "#9CA3AF",
};
const STATUS_SKETCHING: GanttStatus = {
  id: "status-sketching",
  name: "High-Cost Sketching / Redraws",
  color: "#EF4444",
};
const STATUS_PERMITTING: GanttStatus = {
  id: "status-permitting",
  name: "Permitting / City Review",
  color: "#F59E0B",
};
const STATUS_CONSTRUCTION: GanttStatus = {
  id: "status-construction",
  name: "Active Construction",
  color: "#10B981",
};

const ALL_STATUSES = [STATUS_ADMIN, STATUS_SKETCHING, STATUS_PERMITTING, STATUS_CONSTRUCTION];

// ─── Helper ─────────────────────────────────────────────────────────────
const d = (iso: string) => new Date(`${iso}T00:00:00`);

// ─── Hardcoded Scenario Data ────────────────────────────────────────────

type ScenarioFeature = GanttFeature & { group: string };

const features: ScenarioFeature[] = [
  // ── Scenario A: George ──
  {
    id: "a1",
    name: "Whole-House Measurement & Over-Design",
    startAt: d("2026-06-17"),
    endAt: d("2026-08-15"),
    status: STATUS_SKETCHING,
    group: 'Scenario A: George (The "Whole House" Trap)',
  },
  {
    id: "a2",
    name: "Blind Bidding to GCs (Stall Tactic)",
    startAt: d("2026-08-16"),
    endAt: d("2026-09-15"),
    status: STATUS_ADMIN,
    group: 'Scenario A: George (The "Whole House" Trap)',
  },
  {
    id: "a3",
    name: 'Bids High: Hourly "Trimming" Redraws',
    startAt: d("2026-09-16"),
    endAt: d("2026-10-31"),
    status: STATUS_SKETCHING,
    group: 'Scenario A: George (The "Whole House" Trap)',
  },
  {
    id: "a4",
    name: "DBI Full Plan Review",
    startAt: d("2026-11-01"),
    endAt: d("2027-01-15"),
    status: STATUS_PERMITTING,
    group: 'Scenario A: George (The "Whole House" Trap)',
  },
  {
    id: "a5",
    name: "Paul Starts Construction (Delayed)",
    startAt: d("2027-01-16"),
    endAt: d("2027-03-15"),
    status: STATUS_CONSTRUCTION,
    group: 'Scenario A: George (The "Whole House" Trap)',
  },

  // ── Scenario B: Aaron ──
  {
    id: "b1",
    name: "Waiting for Aaron's Availability",
    startAt: d("2026-06-17"),
    endAt: d("2026-07-15"),
    status: STATUS_ADMIN,
    group: 'Scenario B: Aaron (The "Hourly Purgatory")',
  },
  {
    id: "b2",
    name: "Endless Sketching & Junior Revisions",
    startAt: d("2026-07-16"),
    endAt: d("2026-10-01"),
    status: STATUS_SKETCHING,
    group: 'Scenario B: Aaron (The "Hourly Purgatory")',
  },
  {
    id: "b3",
    name: "Budget Exhausted / Design Paused",
    startAt: d("2026-10-02"),
    endAt: d("2026-11-01"),
    status: STATUS_ADMIN,
    group: 'Scenario B: Aaron (The "Hourly Purgatory")',
  },
  {
    id: "b4",
    name: "Rushed Permit Submission",
    startAt: d("2026-11-02"),
    endAt: d("2026-12-15"),
    status: STATUS_PERMITTING,
    group: 'Scenario B: Aaron (The "Hourly Purgatory")',
  },
  {
    id: "b5",
    name: "Paul Starts Construction",
    startAt: d("2026-12-16"),
    endAt: d("2027-02-15"),
    status: STATUS_CONSTRUCTION,
    group: 'Scenario B: Aaron (The "Hourly Purgatory")',
  },

  // ── Scenario C: Unbundled ──
  {
    id: "c1",
    name: "Flat-Fee Designer Layout & S.E. Feasibility",
    startAt: d("2026-06-17"),
    endAt: d("2026-07-05"),
    status: STATUS_CONSTRUCTION,
    group: "Scenario C: Unbundled (The Winning Path)",
  },
  {
    id: "c2",
    name: "Drafter Translates to Permit Set",
    startAt: d("2026-07-06"),
    endAt: d("2026-07-20"),
    status: STATUS_CONSTRUCTION,
    group: "Scenario C: Unbundled (The Winning Path)",
  },
  {
    id: "c3",
    name: "Targeted DBI Review (Kitchen Phase 1)",
    startAt: d("2026-07-21"),
    endAt: d("2026-08-15"),
    status: STATUS_PERMITTING,
    group: "Scenario C: Unbundled (The Winning Path)",
  },
  {
    id: "c4",
    name: "Paul Starts Phase 1 Construction NOW",
    startAt: d("2026-08-16"),
    endAt: d("2026-10-15"),
    status: STATUS_CONSTRUCTION,
    group: "Scenario C: Unbundled (The Winning Path)",
  },
];

// ─── Marker ─────────────────────────────────────────────────────────────
const paulMarker = {
  id: "marker-paul-gc",
  date: d("2026-06-30"),
  label: "Paul (GC) Available for Work",
  className: "bg-blue-100 text-blue-900 border-blue-500 font-bold",
};

// ─── Group by scenario ──────────────────────────────────────────────────
function groupByScenario(items: ScenarioFeature[]) {
  const groups: Record<string, ScenarioFeature[]> = {};
  for (const f of items) {
    if (!groups[f.group]) groups[f.group] = [];
    groups[f.group].push(f);
  }
  return groups;
}

// ─── Component ──────────────────────────────────────────────────────────
export function ContractorScheduleApp() {
  const grouped = groupByScenario(features);
  const scenarioOrder = [
    'Scenario A: George (The "Whole House" Trap)',
    'Scenario B: Aaron (The "Hourly Purgatory")',
    "Scenario C: Unbundled (The Winning Path)",
  ];

  return (
    <div className="space-y-6">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border/50 bg-card/60 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Status Legend
        </span>
        {ALL_STATUSES.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-xs text-foreground/80">{s.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
          <span className="text-xs text-foreground/80">
            Milestone Marker
          </span>
        </div>
      </div>

      {/* Gantt Chart */}
      <GanttProvider className="rounded-lg border border-border/50" range="monthly" zoom={100}>
        <GanttSidebar>
          {scenarioOrder.map((scenario) => {
            const items = grouped[scenario];
            if (!items) return null;
            return (
              <GanttSidebarGroup key={scenario} name={scenario}>
                {items.map((feature) => (
                  <GanttSidebarItem feature={feature} key={feature.id} />
                ))}
              </GanttSidebarGroup>
            );
          })}
        </GanttSidebar>
        <GanttTimeline>
          <GanttHeader />
          <GanttFeatureList>
            {scenarioOrder.map((scenario) => {
              const items = grouped[scenario];
              if (!items) return null;
              return (
                <GanttFeatureListGroup key={scenario}>
                  {items.map((feature) => (
                    <div className="flex" key={feature.id}>
                      <GanttFeatureItem {...feature}>
                        <p className="flex-1 truncate text-xs font-medium">
                          {feature.name}
                        </p>
                      </GanttFeatureItem>
                    </div>
                  ))}
                </GanttFeatureListGroup>
              );
            })}
          </GanttFeatureList>
          <GanttMarker
            id={paulMarker.id}
            date={paulMarker.date}
            label={paulMarker.label}
            className={paulMarker.className}
          />
          <GanttToday />
        </GanttTimeline>
      </GanttProvider>

      {/* Analysis callout */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4">
          <h3 className="text-sm font-semibold text-red-400">Scenario A: George</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Construction starts <span className="font-semibold text-red-300">Jan 2027</span> — 7 months of burning cash on whole-house over-design and hourly trimming redraws before a single hammer swings.
          </p>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4">
          <h3 className="text-sm font-semibold text-amber-400">Scenario B: Aaron</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Construction starts <span className="font-semibold text-amber-300">Dec 2026</span> — 6 months of hourly purgatory, junior revisions, and a budget-exhaustion pause before permitting.
          </p>
        </div>
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-4">
          <h3 className="text-sm font-semibold text-emerald-400">Scenario C: Unbundled ✓</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Construction starts <span className="font-semibold text-emerald-300">Aug 2026</span> — flat-fee designer + drafter gets to permit in 5 weeks. Paul starts Phase 1 while other scenarios are still sketching.
          </p>
        </div>
      </div>
    </div>
  );
}
