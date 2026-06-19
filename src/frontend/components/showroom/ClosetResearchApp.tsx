import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// ─── Layout Scenario Data ─────────────────────────────────────────────────────

interface LayoutScenario {
  id: number;
  name: string;
  desc: string;
  flow: string;
  config: {
    groomingPos: string;
    rightWall: string;
    island: string;
    leftWall: string;
    topWall: string;
  };
}

const LAYOUT_SCENARIOS: LayoutScenario[] = [
  {
    id: 1, name: "The Natural Glow",
    desc: "Grooming station placed directly under the window to maximize natural light for evening routines.",
    flow: "Entry path is kept entirely clear. The island is shifted 12\" to the right to prevent bottlenecking.",
    config: { groomingPos: "window", rightWall: "full", island: "center", leftWall: "none", topWall: "none" },
  },
  {
    id: 2, name: "The Boutique Recess",
    desc: "Integrated grooming station carved into the 13'7\" right wall cabinetry run. Mimics the Avera style.",
    flow: "Creates a seamless architectural line. Left wall remains a gallery for art or the future door.",
    config: { groomingPos: "right_center", rightWall: "split", island: "center", leftWall: "none", topWall: "none" },
  },
  {
    id: 3, name: "The Peninsula Pivot",
    desc: "A separate peninsula for the grooming station, creating a physical divide from the main wardrobe.",
    flow: "Excellent separation. Keeps movement focused on the bathroom axis without disturbing storage.",
    config: { groomingPos: "peninsula", rightWall: "full", island: "offset", leftWall: "none", topWall: "none" },
  },
  {
    id: 4, name: "Island Grooming End-Cap",
    desc: "Grooming station built into the head of the island facing the new bedroom door location.",
    flow: "Maximizes walking clearance on all sides. The island becomes the primary grooming hub.",
    config: { groomingPos: "island_end", rightWall: "full", island: "large", leftWall: "none", topWall: "none" },
  },
  {
    id: 5, name: "The Symmetric L-Gallery",
    desc: "Wraps the top wall and right wall. Grooming station anchored in the top-right corner.",
    flow: "Traditional walk-in feel. Entry is airy since the door doesn't face cabinetry.",
    config: { groomingPos: "corner", rightWall: "full", island: "none", leftWall: "none", topWall: "full" },
  },
  {
    id: 6, name: "The Floating Hub",
    desc: "Standalone grooming vanity unit floating near the window, separate from built-in runs.",
    flow: "Furniture-like feel. High-end look that doesn't feel like a 'closet' upon hallway entry.",
    config: { groomingPos: "float", rightWall: "full", island: "center", leftWall: "none", topWall: "none" },
  },
  {
    id: 7, name: "Entry-Access Station",
    desc: "Grooming station positioned for quick access immediately near the bathroom hallway entry.",
    flow: "Optimized for speed. Minimal travel distance from bathroom to prep station.",
    config: { groomingPos: "entry_prox", rightWall: "full", island: "center", leftWall: "none", topWall: "none" },
  },
  {
    id: 8, name: "The Double Island",
    desc: "Two smaller islands instead of one large block. One island is dedicated purely to skincare.",
    flow: "Boutique luxury feel. Allows for individual zones for both partners.",
    config: { groomingPos: "island_dual", rightWall: "full", island: "split", leftWall: "none", topWall: "none" },
  },
];

// ─── Vendor Data ──────────────────────────────────────────────────────────────

interface VendorTier {
  tier: string;
  tierLabel: string;
  tierColor: string;
  name: string;
  subtitle: string;
  description: string;
  priceRange: string;
}

const VENDOR_TIERS: VendorTier[] = [
  {
    tier: "luxury",
    tierLabel: "Luxury / Bespoke",
    tierColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    name: "Poliform & Lema",
    subtitle: "Italian Craftsmanship",
    description: "Ultimate luxury with integrated leather-lined drawers and glass cabinetry. Includes specific modularity for integrated skincare refrigeration.",
    priceRange: "$25k – $45k+",
  },
  {
    tier: "premium",
    tierLabel: "Premium Turnkey",
    tierColor: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    name: "Avera by TCS",
    subtitle: "The Container Store",
    description: "Floor-to-ceiling look with specialized shoe storage and integrated LED lighting kits. Turnkey solution without bespoke lead times.",
    priceRange: "$8k – $18k",
  },
  {
    tier: "budget",
    tierLabel: "Hacked DIY",
    tierColor: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    name: "IKEA PAX",
    subtitle: "Modular Strategy",
    description: "Standard 13'7\" wall fitment using 29\" and 19\" frames. Pair with a local SF finish carpenter for crown molding to hide top gaps.",
    priceRange: "$2k – $5k",
  },
];

// ─── Cost Data ────────────────────────────────────────────────────────────────

const COST_DATA = {
  labels: ["Budget", "Premium", "Luxury"],
  low: [2000, 8000, 25000],
  high: [5000, 18000, 45000],
};

// ─── Canvas Renderer ──────────────────────────────────────────────────────────

function renderLayout(canvas: HTMLCanvasElement, scenario: LayoutScenario) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const CW = 500;
  const CH = 550;
  ctx.clearRect(0, 0, CW, CH);

  // Exterior Walls (zinc-700 for dark theme)
  ctx.strokeStyle = "#a1a1aa";
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.strokeRect(40, 40, 420, 470);

  // Left Wall — dashed to indicate clear path
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(40, 40);
  ctx.lineTo(40, 510);
  ctx.stroke();
  ctx.setLineDash([]);

  // Window
  ctx.fillStyle = "#164e63";
  ctx.fillRect(180, 36, 140, 8);
  ctx.fillStyle = "#22d3ee";
  ctx.font = "bold 10px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("WINDOW", 250, 28);

  // Right Wall Cabinetry
  ctx.fillStyle = "#27272a";
  ctx.strokeStyle = "#52525b";
  ctx.lineWidth = 1;
  const { config } = scenario;
  if (config.rightWall === "full") {
    ctx.fillRect(400, 40, 60, 470);
    ctx.strokeRect(400, 40, 60, 470);
  } else if (config.rightWall === "split") {
    ctx.fillRect(400, 40, 60, 160);
    ctx.fillRect(400, 310, 60, 200);
    ctx.strokeRect(400, 40, 60, 160);
    ctx.strokeRect(400, 310, 60, 200);
  }

  // Top Wall Cabinetry
  if (config.topWall === "full") {
    ctx.fillRect(40, 40, 420, 60);
    ctx.strokeRect(40, 40, 420, 60);
  }

  // Island (zinc-600)
  ctx.fillStyle = "#52525b";
  if (config.island === "center") ctx.fillRect(190, 180, 120, 240);
  if (config.island === "offset") ctx.fillRect(240, 180, 120, 240);
  if (config.island === "large") ctx.fillRect(170, 150, 160, 300);
  if (config.island === "split") {
    ctx.fillRect(210, 150, 80, 120);
    ctx.fillStyle = "#d97706";
    ctx.fillRect(210, 320, 80, 120);
  }

  // Grooming Station Marker (amber)
  ctx.fillStyle = "#d97706";
  if (config.groomingPos === "window") ctx.fillRect(180, 40, 140, 45);
  if (config.groomingPos === "right_center") ctx.fillRect(395, 200, 65, 110);
  if (config.groomingPos === "peninsula") ctx.fillRect(320, 240, 80, 55);
  if (config.groomingPos === "island_end") ctx.fillRect(170, 150, 160, 45);
  if (config.groomingPos === "corner") ctx.fillRect(380, 40, 80, 80);
  if (config.groomingPos === "float") ctx.fillRect(100, 80, 65, 85);
  if (config.groomingPos === "entry_prox") ctx.fillRect(380, 440, 80, 70);

  // Labels
  ctx.fillStyle = "#71717a";
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("KEEP CLEAR FOR BEDROOM DOOR", 55, 250);
}

// ─── Cost Chart (simple bar chart via canvas) ─────────────────────────────────

function renderCostChart(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const CW = canvas.width;
  const CH = canvas.height;
  ctx.clearRect(0, 0, CW, CH);

  const padding = { top: 30, right: 20, bottom: 40, left: 60 };
  const chartW = CW - padding.left - padding.right;
  const chartH = CH - padding.top - padding.bottom;
  const maxVal = 50000;
  const barGroupWidth = chartW / 3;
  const barWidth = barGroupWidth * 0.3;
  const gap = barGroupWidth * 0.1;

  // Y-axis gridlines
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#71717a";
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + chartH - (i / 5) * chartH;
    const val = (i / 5) * maxVal;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(CW - padding.right, y);
    ctx.stroke();
    ctx.fillText(`$${(val / 1000).toFixed(0)}k`, padding.left - 8, y + 3);
  }

  // X-axis labels
  ctx.textAlign = "center";
  COST_DATA.labels.forEach((label, i) => {
    const x = padding.left + barGroupWidth * i + barGroupWidth / 2;
    ctx.fillText(label, x, CH - 10);
  });

  // Bars
  COST_DATA.low.forEach((low, i) => {
    const high = COST_DATA.high[i];
    const x = padding.left + barGroupWidth * i + gap;

    // Low bar (zinc-700)
    const lowH = (low / maxVal) * chartH;
    ctx.fillStyle = "#3f3f46";
    ctx.beginPath();
    ctx.roundRect(x, padding.top + chartH - lowH, barWidth, lowH, 4);
    ctx.fill();

    // High bar (amber-600)
    const highH = (high / maxVal) * chartH;
    ctx.fillStyle = "#d97706";
    ctx.beginPath();
    ctx.roundRect(x + barWidth + gap, padding.top + chartH - highH, barWidth, highH, 4);
    ctx.fill();
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ClosetResearchApp() {
  const [selectedScenario, setSelectedScenario] = useState(LAYOUT_SCENARIOS[0]);
  const layoutCanvasRef = useRef<HTMLCanvasElement>(null);
  const costCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (layoutCanvasRef.current) {
      renderLayout(layoutCanvasRef.current, selectedScenario);
    }
  }, [selectedScenario]);

  useEffect(() => {
    if (costCanvasRef.current) {
      renderCostChart(costCanvasRef.current);
    }
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-16 px-4 py-8 sm:px-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold italic text-white ring-1 ring-zinc-700">
            S
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            SF Remodel <span className="font-light text-zinc-600">Intell</span>
          </span>
        </div>
        <nav className="flex gap-6 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          <a href="#vision" className="transition-colors hover:text-foreground">The Vision</a>
          <a href="#layouts" className="transition-colors hover:text-foreground">Layouts</a>
          <a href="#vendors" className="transition-colors hover:text-foreground">Vendors</a>
          <a href="#roi" className="transition-colors hover:text-foreground">ROI & Rebates</a>
        </nav>
      </div>

      {/* ── Section: The Vision ─────────────────────────────────────────── */}
      <section id="vision" className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div className="space-y-6">
          <h1 className="text-4xl font-light leading-[1.1] tracking-tight md:text-6xl">
            Spatial{" "}
            <span className="italic text-zinc-500">Transformation</span>
          </h1>
          <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              Converting the <strong className="text-foreground">11'11" × 13'7"</strong> footprint
              into a primary sanctuary. Our primary architectural constraint is the{" "}
              <strong className="text-foreground">Left Wall Preservation</strong>—keeping it clear
              for the future bedroom entry door.
            </p>
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
                  ✦
                </div>
                <p className="text-xs italic text-zinc-300">
                  "Grooming Priority: A dedicated zone for evening skincare routines."
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
        <Card className="overflow-hidden border-zinc-800 bg-zinc-900/30">
          <CardContent className="p-4">
            <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-zinc-800/50 text-xs text-muted-foreground">
              <div className="text-center">
                <div className="mb-2 text-2xl">📐</div>
                <p className="font-medium">Floorplan Reference</p>
                <p className="text-[10px] uppercase tracking-widest text-zinc-600">
                  11'11" × 13'7" Primary Suite
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator className="bg-zinc-800" />

      {/* ── Section: Layout Explorer ────────────────────────────────────── */}
      <section id="layouts" className="space-y-8">
        <div>
          <h2 className="text-3xl font-light tracking-tight">Architectural Explorer</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Interactive scenarios showing how to maximize the remaining three walls while integrating
            the grooming station.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Scenario menu */}
          <div className="max-h-[500px] space-y-2 overflow-y-auto pr-2 lg:col-span-4">
            {LAYOUT_SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedScenario(s)}
                className={`w-full rounded-xl border p-4 text-left transition-all ${
                  selectedScenario.id === s.id
                    ? "border-amber-500/50 bg-zinc-800/80 ring-1 ring-amber-500/30"
                    : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800/50"
                }`}
              >
                <div className="text-[9px] uppercase tracking-widest text-zinc-500">
                  Scenario {s.id}
                </div>
                <div className="mt-1 text-sm font-medium">{s.name}</div>
              </button>
            ))}
          </div>

          {/* Canvas */}
          <div className="flex items-start justify-center lg:col-span-5">
            <div className="w-full max-w-[500px] rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <canvas
                ref={layoutCanvasRef}
                width={500}
                height={550}
                className="w-full"
              />
            </div>
          </div>

          {/* Detail panel */}
          <div className="space-y-4 lg:col-span-3">
            <Card className="border-zinc-800 bg-zinc-900">
              <CardContent className="space-y-4 p-6">
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-500">
                    Grooming Station Logic
                  </div>
                  <p className="text-sm italic leading-relaxed text-zinc-400">
                    {selectedScenario.desc}
                  </p>
                </div>
                <Separator className="bg-zinc-800" />
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    Traffic Flow
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-500">
                    {selectedScenario.flow}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardContent className="p-4">
                <p className="text-xs italic leading-relaxed text-zinc-500">
                  Constraint: The left wall remains unused to prevent "clash" with the hallway door
                  and to prepare for the Bedroom-to-Closet pocket door.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <Separator className="bg-zinc-800" />

      {/* ── Section: Vendor Boutique ────────────────────────────────────── */}
      <section id="vendors" className="space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-light tracking-tight">The Boutique Gallery</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Material quality across Luxury, Premium, and Budget tiers for the SF market.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {VENDOR_TIERS.map((vendor) => (
            <Card
              key={vendor.tier}
              className={`overflow-hidden border-zinc-800 bg-zinc-900/60 transition-all hover:border-zinc-700 ${
                vendor.tier === "premium" ? "ring-1 ring-amber-500/20" : ""
              }`}
            >
              {/* Image placeholder */}
              <div className="relative flex h-56 items-center justify-center bg-zinc-800/50">
                <div className="text-center">
                  <div className="mb-2 text-4xl">
                    {vendor.tier === "luxury" ? "🪞" : vendor.tier === "premium" ? "✨" : "🔧"}
                  </div>
                  <p className="text-xs text-zinc-500">{vendor.name}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`absolute left-4 top-4 ${vendor.tierColor}`}
                >
                  {vendor.tierLabel}
                </Badge>
              </div>
              <CardContent className="space-y-4 p-6">
                <div>
                  <h3 className="text-xl font-medium">{vendor.name}</h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">
                    {vendor.subtitle}
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">
                  {vendor.description}
                </p>
                <Separator className="bg-zinc-800" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{vendor.priceRange}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Separator className="bg-zinc-800" />

      {/* ── Section: ROI & Chart ────────────────────────────────────────── */}
      <section id="roi">
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardContent className="grid grid-cols-1 gap-12 p-8 md:p-12 lg:grid-cols-2">
            <div className="space-y-6">
              <h2 className="text-3xl font-light tracking-tight">
                Investment <span className="italic text-zinc-500">Analysis</span>
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Cost projections for the 11'×13' conversion. In SF, primary suite upgrades yield high
                appraisal value due to density and demand for storage.
              </p>
              <div className="aspect-[2/1] w-full max-w-[600px]">
                <canvas ref={costCanvasRef} width={600} height={300} className="w-full" />
              </div>
              <div className="flex gap-4 text-xs text-zinc-500">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded bg-zinc-700" />
                  Low Range
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded bg-amber-600" />
                  High Range
                </div>
              </div>
            </div>
            <Card className="border-zinc-700 bg-zinc-900">
              <CardContent className="space-y-6 p-8">
                <div className="flex items-center gap-3">
                  <div className="h-1 w-8 bg-amber-500" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
                    The Costco Benefit
                  </span>
                </div>
                <h3 className="text-2xl font-light">10% Shop Card Rebate</h3>
                <p className="text-sm leading-relaxed text-zinc-400">
                  Utilizing the <strong className="text-foreground">Closet Factory</strong> program
                  through Costco provides a 10% Shop Card back. On a $15,000 installation, the $1,500
                  rebate covers upgraded hardware or custom island stone.
                </p>
                <Separator className="bg-zinc-800" />
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <span className="text-xs uppercase tracking-widest text-zinc-500">
                    Member Incentive
                  </span>
                  <span className="text-xs font-bold text-amber-500">10% Shop Card</span>
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="pb-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600">
          SF Architectural Analysis
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          Visual data referencing 11'11" × 13'7" footprint
        </p>
      </div>
    </div>
  );
}
