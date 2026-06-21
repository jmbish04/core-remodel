import { useState } from "react";
import {
  Ruler,
  Maximize2,
  LayoutGrid,
  ArrowLeft,
  ArrowRight,
  MoveDown,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Layout Data ───────────────────────────────────────────────────────────────

interface LayoutRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke?: string;
  label: string;
}

interface DimLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

interface LayoutOption {
  id: string;
  title: string;
  tagline: string;
  description: string;
  stats: {
    counter: string;
    island: string;
    aisle: string;
    clearance: string;
  };
  rects: LayoutRect[];
  dims: DimLine[];
}

const OPTIONS: Record<string, LayoutOption> = {
  balanced: {
    id: "balanced",
    title: "Option 1: Balanced Linear",
    tagline: "The Luxury Standard",
    description:
      "A beautifully proportioned layout featuring a single, massive 11-foot island. This offers excellent circulation on all four sides while maintaining standard luxury depths.",
    stats: {
      counter: '25.5" Standard Depth',
      island: "11' 0\" W × 48\" D",
      aisle: '48" Work Aisle',
      clearance: '58.5" Living Room Buffer',
    },
    rects: [
      { id: "wall", x: 0, y: 0, w: 204, h: 6, fill: "hsl(var(--muted))", label: "" },
      {
        id: "counter",
        x: 0,
        y: 6,
        w: 204,
        h: 25.5,
        fill: "hsl(217 91% 60% / 0.08)",
        stroke: "hsl(217 91% 60% / 0.4)",
        label: 'Back Counter (25.5" D)',
      },
      {
        id: "island",
        x: 36,
        y: 79.5,
        w: 132,
        h: 48,
        fill: "hsl(263 70% 50% / 0.08)",
        stroke: "hsl(263 70% 50% / 0.4)",
        label: "Primary Island (11' × 48\")",
      },
    ],
    dims: [
      { x1: 102, y1: 31.5, x2: 102, y2: 79.5, label: '48" Work Aisle' },
      { x1: 0, y1: 103.5, x2: 36, y2: 103.5, label: '36" Walkway' },
      { x1: 168, y1: 103.5, x2: 204, y2: 103.5, label: '36" Walkway' },
      { x1: 102, y1: 127.5, x2: 102, y2: 180, label: '58.5" to Living Area' },
    ],
  },
  deepPrep: {
    id: "deepPrep",
    title: "Option 2: Deep-Prep 'Pro'",
    tagline: "Heavy & Structural",
    description:
      "Pulls the back cabinets forward for ultra-deep drawer storage and expands the island to 54 inches deep, ideal for massive workstation sinks and professional appliances.",
    stats: {
      counter: '30" Deep Pro Depth',
      island: "11' 0\" W × 54\" D",
      aisle: '45" Pivot Aisle',
      clearance: '51" Living Room Buffer',
    },
    rects: [
      { id: "wall", x: 0, y: 0, w: 204, h: 6, fill: "hsl(var(--muted))", label: "" },
      {
        id: "counter",
        x: 0,
        y: 6,
        w: 204,
        h: 30,
        fill: "hsl(217 91% 60% / 0.08)",
        stroke: "hsl(217 91% 60% / 0.4)",
        label: 'Deep Pro Counter (30" D)',
      },
      {
        id: "island",
        x: 36,
        y: 81,
        w: 132,
        h: 54,
        fill: "hsl(263 70% 50% / 0.08)",
        stroke: "hsl(263 70% 50% / 0.4)",
        label: "Massive Prep Island (11' × 54\")",
      },
    ],
    dims: [
      { x1: 102, y1: 36, x2: 102, y2: 81, label: '45" Aisle' },
      { x1: 0, y1: 108, x2: 36, y2: 108, label: '36" Walkway' },
      { x1: 168, y1: 108, x2: 204, y2: 108, label: '36" Walkway' },
      { x1: 102, y1: 135, x2: 102, y2: 180, label: '51" to Living Area' },
    ],
  },
  perpendicular: {
    id: "perpendicular",
    title: "Option 3: Perpendicular",
    tagline: "The Architect's Choice",
    description:
      "Rotates the massing 90 degrees. Creates a U-shaped central work zone with an isolated prep island and a dedicated entertaining island that shields the mess from the dining room.",
    stats: {
      counter: '25.5" Standard Depth',
      island: "Two 3' × 9' Islands",
      aisle: '48" Center & Work Aisles',
      clearance: '42" Flanking Walkways',
    },
    rects: [
      { id: "wall", x: 0, y: 0, w: 204, h: 6, fill: "hsl(var(--muted))", label: "" },
      {
        id: "counter",
        x: 0,
        y: 6,
        w: 204,
        h: 25.5,
        fill: "hsl(217 91% 60% / 0.08)",
        stroke: "hsl(217 91% 60% / 0.4)",
        label: 'Back Counter (25.5" D)',
      },
      {
        id: "island1",
        x: 42,
        y: 79.5,
        w: 36,
        h: 100.5,
        fill: "hsl(263 70% 50% / 0.08)",
        stroke: "hsl(263 70% 50% / 0.4)",
        label: "Prep Island",
      },
      {
        id: "island2",
        x: 126,
        y: 79.5,
        w: 36,
        h: 100.5,
        fill: "hsl(160 60% 45% / 0.08)",
        stroke: "hsl(160 60% 45% / 0.4)",
        label: "Entertain Island",
      },
    ],
    dims: [
      { x1: 102, y1: 31.5, x2: 102, y2: 79.5, label: '48" Main Work Aisle' },
      { x1: 78, y1: 129.75, x2: 126, y2: 129.75, label: '48" Center Aisle' },
      { x1: 0, y1: 129.75, x2: 42, y2: 129.75, label: '42" Walkway' },
      { x1: 162, y1: 129.75, x2: 204, y2: 129.75, label: '42" Walkway' },
    ],
  },
};

// ─── Sub-Components ────────────────────────────────────────────────────────────

function DimensionLine({ x1, y1, x2, y2, label }: DimLine) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  return (
    <g className="transition-all duration-500 ease-out">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="hsl(0 84% 60%)"
        strokeWidth="0.8"
        strokeDasharray="2,1"
        markerStart="url(#arrow)"
        markerEnd="url(#arrow)"
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="4"
        fontWeight="600"
        fill="hsl(0 84% 80%)"
        paintOrder="stroke"
        stroke="hsl(var(--background))"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ fontFamily: "ui-monospace, monospace" }}
      >
        {label}
      </text>
    </g>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function KitchenLayoutApp() {
  const [activeTab, setActiveTab] = useState<string>("balanced");
  const data = OPTIONS[activeTab];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
      {/* ── Canvas Area ── */}
      <Card>
        {/* Context ribbon */}
        <CardContent className="flex items-center justify-between border-b border-border/50 pb-3">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <ArrowLeft className="size-2.5" />
            Bay Windows (15' 5")
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Back Wall (22' 6")
          </span>
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Dining (5' 6" Reserved)
            <ArrowRight className="size-2.5" />
          </span>
        </CardContent>

        {/* SVG Canvas */}
        <CardContent className="flex items-center justify-center py-6">
          <div className="relative aspect-[204/180] w-full max-w-[720px] overflow-hidden rounded border-2 border-foreground/15 bg-background/50">
            <svg viewBox="0 0 204 180" className="block size-full">
              <defs>
                <pattern
                  id="grid"
                  width="12"
                  height="12"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 12 0 L 0 0 0 12"
                    fill="none"
                    stroke="hsl(var(--foreground) / 0.06)"
                    strokeWidth="0.5"
                  />
                </pattern>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="5"
                  refY="5"
                  markerWidth="4"
                  markerHeight="4"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 2 L 10 5 L 0 8 z" fill="hsl(0 84% 60%)" />
                </marker>
              </defs>

              {/* Grid */}
              <rect width="204" height="180" fill="url(#grid)" />

              {/* Layout elements */}
              {data.rects.map((rect) => (
                <g
                  key={rect.id}
                  className="transition-all duration-500 ease-out"
                >
                  <rect
                    x={rect.x}
                    y={rect.y}
                    width={rect.w}
                    height={rect.h}
                    fill={rect.fill}
                    stroke={rect.stroke}
                    strokeWidth={rect.stroke ? 0.8 : 0}
                    rx="1"
                  />
                  {rect.label && (
                    <text
                      x={rect.x + rect.w / 2}
                      y={rect.y + rect.h / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="4.5"
                      fill="hsl(var(--foreground) / 0.6)"
                      fontWeight="500"
                      style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
                    >
                      {rect.label}
                    </text>
                  )}
                </g>
              ))}

              {/* Dimension lines */}
              {data.dims.map((dim, i) => (
                <DimensionLine key={`${activeTab}-${i}`} {...dim} />
              ))}
            </svg>
          </div>
        </CardContent>

        {/* Flow label */}
        <CardContent className="flex items-center justify-center gap-2 border-t border-border/50 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <MoveDown className="size-3" />
          Flow towards Living Space
          <MoveDown className="size-3" />
        </CardContent>
      </Card>

      {/* ── Sidebar ── */}
      <div className="flex flex-col gap-4">
        {/* Option Toggle Buttons */}
        <div className="flex flex-col gap-2">
          {Object.keys(OPTIONS).map((key) => {
            const opt = OPTIONS[key];
            const isActive = key === activeTab;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  "group relative rounded-xl p-4 text-left ring-1 transition-all duration-200",
                  isActive
                    ? "bg-primary/5 ring-primary shadow-sm shadow-primary/10"
                    : "bg-card ring-foreground/10 hover:bg-muted/50 hover:ring-foreground/15"
                )}
              >
                {/* Active bar */}
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 w-[3px] rounded-l-xl transition-colors",
                    isActive ? "bg-primary" : "bg-transparent"
                  )}
                />

                <h3
                  className={cn(
                    "text-sm font-semibold",
                    isActive ? "text-primary" : "text-foreground"
                  )}
                >
                  {opt.title}
                </h3>
                <p
                  className={cn(
                    "mt-0.5 text-xs",
                    isActive
                      ? "text-primary/70"
                      : "text-muted-foreground"
                  )}
                >
                  {opt.tagline}
                </p>
              </button>
            );
          })}
        </div>

        {/* Specs Panel */}
        <Card className="flex-1">
          <CardHeader className="border-b bg-muted/30">
            <CardTitle className="flex items-center gap-2 text-sm">
              <LayoutGrid className="size-3.5 text-primary" />
              Dimension Breakdown
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-5 pt-4">
            <p className="border-b border-border/40 pb-4 text-sm leading-relaxed text-muted-foreground">
              {data.description}
            </p>

            {/* Back Counter */}
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-foreground/5">
                <Maximize2 className="size-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Back Counter
                </p>
                <p className="font-mono text-sm font-medium">
                  {data.stats.counter}
                </p>
              </div>
            </div>

            {/* Island Massing */}
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-foreground/5">
                <LayoutGrid className="size-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Island Massing
                </p>
                <p className="font-mono text-sm font-medium">
                  {data.stats.island}
                </p>
              </div>
            </div>

            {/* Clearances */}
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-foreground/5">
                <Ruler className="size-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Clearances
                </p>
                <p className="font-mono text-sm font-medium">
                  {data.stats.aisle}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {data.stats.clearance}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scale badge */}
        <Badge
          variant="outline"
          className="mx-auto w-fit gap-1.5 px-3 py-1 font-mono text-[10px]"
        >
          <Ruler className="size-2.5" />
          1 square = 12" (1 ft) · Canvas: 17' 0"
        </Badge>
      </div>
    </div>
  );
}
