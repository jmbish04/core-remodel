import { ChevronDownIcon, FilterIcon } from "lucide-react";
import { Button } from "src/frontend/components/ui/button";

type Health = "healthy" | "degraded" | "down" | "deploying";

interface Service {
  name: string;
  region: string;
  health: Health;
  rps: number;
  p99Ms: number;
  errorRate: number;
  errorSeries: number[];
  latencySeries: number[];
  sloBudget: number;
  uptime30d: number;
  owner: string;
}

const SERVICES: Service[] = [
  {
    name: "api-gateway",
    region: "iad1",
    health: "healthy",
    rps: 12_400,
    p99Ms: 142,
    errorRate: 0.04,
    errorSeries: [0.02, 0.03, 0.02, 0.04, 0.03, 0.02, 0.04, 0.05, 0.03, 0.04, 0.04, 0.04],
    latencySeries: [120, 124, 132, 128, 130, 138, 142, 134, 140, 138, 144, 142],
    sloBudget: 0.86,
    uptime30d: 99.96,
    owner: "platform",
  },
  {
    name: "billing-svc",
    region: "iad1",
    health: "degraded",
    rps: 380,
    p99Ms: 814,
    errorRate: 1.4,
    errorSeries: [0.2, 0.3, 0.4, 0.6, 0.7, 0.9, 1.1, 1.2, 1.3, 1.4, 1.4, 1.4],
    latencySeries: [210, 240, 280, 320, 410, 520, 612, 700, 740, 780, 800, 814],
    sloBudget: 0.21,
    uptime30d: 99.42,
    owner: "payments",
  },
  {
    name: "audit-log",
    region: "iad1",
    health: "deploying",
    rps: 4_200,
    p99Ms: 96,
    errorRate: 0.02,
    errorSeries: [0.01, 0.01, 0.02, 0.01, 0.02, 0.02, 0.02, 0.02, 0.01, 0.02, 0.02, 0.02],
    latencySeries: [82, 84, 88, 86, 92, 90, 94, 96, 92, 96, 96, 96],
    sloBudget: 0.94,
    uptime30d: 99.99,
    owner: "platform",
  },
  {
    name: "search",
    region: "fra1",
    health: "healthy",
    rps: 6_800,
    p99Ms: 218,
    errorRate: 0.08,
    errorSeries: [0.06, 0.07, 0.08, 0.09, 0.07, 0.08, 0.08, 0.09, 0.08, 0.08, 0.08, 0.08],
    latencySeries: [180, 192, 200, 208, 212, 220, 218, 216, 220, 222, 218, 218],
    sloBudget: 0.78,
    uptime30d: 99.91,
    owner: "search",
  },
  {
    name: "notifications",
    region: "iad1",
    health: "healthy",
    rps: 920,
    p99Ms: 312,
    errorRate: 0.12,
    errorSeries: [0.1, 0.11, 0.13, 0.12, 0.14, 0.12, 0.11, 0.13, 0.12, 0.12, 0.12, 0.12],
    latencySeries: [280, 290, 300, 310, 308, 312, 314, 312, 310, 312, 312, 312],
    sloBudget: 0.66,
    uptime30d: 99.88,
    owner: "growth",
  },
  {
    name: "ingest",
    region: "syd1",
    health: "down",
    rps: 0,
    p99Ms: 0,
    errorRate: 100,
    errorSeries: [0.1, 0.2, 0.4, 1.2, 8, 22, 64, 92, 100, 100, 100, 100],
    latencySeries: [120, 130, 160, 240, 480, 0, 0, 0, 0, 0, 0, 0],
    sloBudget: 0.0,
    uptime30d: 98.21,
    owner: "data",
  },
];

const HEALTH_TONE: Record<Health, { dot: string; label: string }> = {
  healthy: { dot: "bg-emerald-500", label: "text-emerald-600 dark:text-emerald-400" },
  degraded: { dot: "bg-amber-500", label: "text-amber-600 dark:text-amber-400" },
  down: { dot: "bg-rose-500", label: "text-rose-600 dark:text-rose-400" },
  deploying: { dot: "bg-sky-500 animate-pulse", label: "text-sky-600 dark:text-sky-400" },
};

export function DashboardsServicesShowcasePage() {
  const total = SERVICES.length;
  const healthy = SERVICES.filter((s) => s.health === "healthy").length;
  const degraded = SERVICES.filter((s) => s.health === "degraded").length;
  const down = SERVICES.filter((s) => s.health === "down").length;
  const totalRps = SERVICES.reduce((acc, s) => acc + s.rps, 0);

  return (
    <div className="min-h-svh bg-background px-10 py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
              acme/platform · 6 services
            </div>
            <h1 className="mt-1 font-heading text-2xl">Service health</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5">
              <FilterIcon className="size-3.5" />
              All envs
              <ChevronDownIcon className="size-3" />
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5">
              Last 1h
              <ChevronDownIcon className="size-3" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryTile label="Healthy" value={`${healthy}/${total}`} dot="bg-emerald-500" />
          <SummaryTile label="Degraded" value={`${degraded}`} dot="bg-amber-500" />
          <SummaryTile label="Down" value={`${down}`} dot="bg-rose-500" />
          <SummaryTile
            label="Total RPS"
            value={`${(totalRps / 1000).toFixed(1)}k`}
            dot="bg-sky-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {SERVICES.map((s) => (
            <ServiceCard key={s.name} service={s} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  dot,
}: {
  label: string;
  value: string;
  dot: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
      <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
        <span className={`size-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl tabular-nums">{value}</div>
    </div>
  );
}

function ServiceCard({ service: s }: { service: Service }) {
  const tone = HEALTH_TONE[s.health];
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-background/40">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${tone.dot}`} />
            <span className="font-mono text-sm">{s.name}</span>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
              {s.region}
            </span>
          </div>
          <div
            className={`mt-0.5 font-mono text-[10px] uppercase tracking-[0.25em] ${tone.label}`}
          >
            {s.health}
          </div>
        </div>
        <div className="text-right font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
          owner
          <div className="mt-0.5 text-foreground">{s.owner}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 px-4 pt-4">
        <Metric
          label="rps"
          value={s.rps === 0 ? "—" : s.rps >= 1000 ? `${(s.rps / 1000).toFixed(1)}k` : String(s.rps)}
        />
        <Metric
          label="p99"
          value={s.p99Ms === 0 ? "—" : `${s.p99Ms}ms`}
          tone={s.p99Ms > 500 ? "warn" : undefined}
        />
        <Metric
          label="errors"
          value={`${s.errorRate.toFixed(2)}%`}
          tone={s.errorRate > 1 ? "fail" : s.errorRate > 0.2 ? "warn" : undefined}
        />
      </div>

      <div className="mt-3 px-4">
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
          error rate · last 1h
        </div>
        <div className="mt-1 h-10">
          <Spark
            values={s.errorSeries}
            color={
              s.errorRate > 1
                ? "rgb(244 63 94)"
                : s.errorRate > 0.2
                  ? "rgb(245 158 11)"
                  : "rgb(16 185 129)"
            }
          />
        </div>
      </div>

      <div className="mt-3 border-border/40 border-t px-4 py-3">
        <div className="flex items-baseline justify-between font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
          <span>SLO budget</span>
          <span className="tabular-nums text-foreground">
            {(s.sloBudget * 100).toFixed(0)}%
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
          <div
            className={`h-full ${
              s.sloBudget > 0.5
                ? "bg-emerald-500"
                : s.sloBudget > 0.2
                  ? "bg-amber-500"
                  : "bg-rose-500"
            }`}
            style={{ width: `${s.sloBudget * 100}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
          <span>30d uptime</span>
          <span className="text-foreground tabular-nums">
            {s.uptime30d.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "fail";
}) {
  const t =
    tone === "fail"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-md bg-foreground/[0.03] px-2 py-1.5">
      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.25em]">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-sm tabular-nums ${t}`}>
        {value}
      </div>
    </div>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  const w = 200;
  const h = 40;
  const max = Math.max(...values, 0.01);
  const min = Math.min(...values);
  const range = Math.max(0.001, max - min);
  const stepX = w / (values.length - 1);
  const points = values
    .map((v, i) => `${i * stepX},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(" L ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-full w-full"
      preserveAspectRatio="none"
    >
      <path
        d={`M 0,${h} L ${points} L ${w},${h} Z`}
        fill={color}
        fillOpacity="0.12"
      />
      <path d={`M ${points}`} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
