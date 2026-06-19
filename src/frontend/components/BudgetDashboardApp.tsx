import React, { useState, useEffect, useCallback } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  AssistantModalPrimitive,
} from "@assistant-ui/react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { BudgetChart } from "@/components/ui/BudgetChart";
import {
  Pie,
  PieChart,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Settings, 
  Layers, 
  Database, 
  Info, 
  CheckCircle, 
  AlertCircle, 
  Search, 
  Sliders, 
  Activity, 
  ToggleLeft, 
  CheckSquare, 
  Plus, 
  ArrowRight,
  Flame,
  Wifi,
  Bot,
  Send,
  Check,
  X,
  BarChart3,
  Radar as RadarIcon,
  Gauge,
  Sparkles,
  Triangle,
  Circle,
  Zap,
  ShieldAlert,
  Target,
  ArrowDown,
  ArrowUp
} from "lucide-react";
import { toast } from "sonner";

// High-fidelity map and analytics chart imports
import { Map, MapClusterLayer, MapControls } from "@/components/ui/map";
import { LiveLineChart } from "@/components/charts/live-line-chart";
import { LiveLine } from "@/components/charts/live-line";
import { LiveXAxis } from "@/components/charts/live-x-axis";
import { LiveYAxis } from "@/components/charts/live-y-axis";
import { ChartTooltip as LiveChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { SankeyChart } from "@/components/charts/sankey/sankey-chart";
import { SankeyNode } from "@/components/charts/sankey/sankey-node";
import { SankeyLink } from "@/components/charts/sankey/sankey-link";
import { SankeyTooltip } from "@/components/charts/sankey/sankey-tooltip";


interface BudgetRollups {
  min: number;
  avg: number;
  max: number;
  cap: number;
  difference: number;
  isOverCap: boolean;
}

interface KitchenScenario {
  id: number;
  scenarioKey: string;
  label: string;
  kitchenLocation: string;
  subLocation: string;
  layoutType: string;
  plumbingStrategy: string;
  deviationTotal: number;
}

interface GridItem {
  label: string;
  costs: Record<string, number | null>;
  notes: string;
}

interface ShowerScenario {
  id: string;
  scenarioLetter: string;
  variantNumber: number;
  wallPosition: string;
  floorType: string;
  plumbingType: string;
  isAddon: boolean;
  addonCategory: string | null;
  itemDescription: string;
  minCost: number;
  avgCost: number;
  maxCost: number;
  phaseTag: string;
  variantRiskNotes: string;
}

interface AssumptionLineItem {
  id: string;
  sectionName: string;
  itemDescription: string;
  minCost: number;
  avgCost: number;
  maxCost: number;
  phaseTag: string;
  variantRiskNotes: string;
}

interface TradeItem {
  id: string;
  workItem: string;
  description: string;
  category: string;
  measurementType: string;
  maxUnitPrice: number;
  sfUnitPrice: number;
  sfMultiplier: number;
  rationale: string;
}

type BudgetProposal =
  | {
      id: string;
      kind: "select_kitchen";
      label: string;
      description: string;
      scenarioKey: "a" | "b" | "c" | "d";
      valueText: string;
      estimatedImpact: string;
    }
  | {
      id: string;
      kind: "set_variable";
      label: string;
      description: string;
      key: "ACTIVE_SHOWER_SCENARIO" | "ENABLE_STEAM_SHOWER" | "ENABLE_SMART_SHOWER" | "SYS_BUDGET_CAP";
      value: string;
      estimatedImpact: string;
    };

export function BudgetDashboardApp() {
  const [activeTab, setActiveTab] = useState<"summary" | "kitchen" | "shower" | "assumptions" | "trades" | "insights" | "analytics">("summary");
  const [zoomedRoom, setZoomedRoom] = useState<string | null>(null);
  
  // Data State
  const [snapshot, setSnapshot] = useState<any>(null);
  const [scenarios, setScenarios] = useState<KitchenScenario[]>([]);
  const [comparisonGrid, setComparisonGrid] = useState<GridItem[]>([]);

  // Analytics Pipeline & Market Intel State
  const [mapData, setMapData] = useState<any>(null);
  const [liveData, setLiveData] = useState<any[]>([]);
  const [sankeyData, setSankeyData] = useState<any>(null);
  const [selectedMapPoint, setSelectedMapPoint] = useState<any>(null);
  const [mapFilter, setMapFilter] = useState<string>("All");
  const [showerMatrix, setShowerMatrix] = useState<{ baseScenarios: ShowerScenario[]; addons: ShowerScenario[] }>({ baseScenarios: [], addons: [] });
  const [assumptions, setAssumptions] = useState<Record<string, AssumptionLineItem[]>>({});
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter State
  const [tradeSearch, setTradeSearch] = useState("");
  const [tradeCategory, setTradeCategory] = useState("");
  const [useSfPricing, setUseSfPricing] = useState(true);

  // Config State
  const [activeKitchen, setActiveKitchen] = useState("Scenario C");
  const [activeShowerScenario, setActiveShowerScenario] = useState("A1");
  const [enableSteam, setEnableSteam] = useState(false);
  const [enableSmart, setEnableSmart] = useState(false);

  // Fetch Snapshot & Config
  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch("/api/budget-snapshot");
      if (!res.ok) throw new Error("Failed to load budget snapshot");
      const data = await res.json();
      setSnapshot(data);
      
      // Sync variables to local state
      setActiveKitchen(data.configuration.activeKitchenText);
      setActiveShowerScenario(data.configuration.activeShower);
      setEnableSteam(data.configuration.enableSteam);
      setEnableSmart(data.configuration.enableSmart);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load budget calculator data");
    }
  }, []);

  // Fetch Data lists
  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    try {
      await fetchSnapshot();
      
      const [scenariosRes, assumptionsRes, showerRes, tradesRes] = await Promise.all([
        fetch("/api/budget-scenarios/comparison"),
        fetch("/api/budget-assumptions/summary"),
        fetch("/api/budget-assumptions/shower-matrix"),
        fetch("/api/budget-data/trades")
      ]);

      if (scenariosRes.ok) {
        const data = await scenariosRes.json();
        setScenarios(data.scenarios);
        setComparisonGrid(data.comparisonGrid);
      }

      if (assumptionsRes.ok) {
        const data = await assumptionsRes.json();
        setAssumptions(data.sections);
      }

      if (showerRes.ok) {
        const data = await showerRes.json();
        setShowerMatrix(data);
      }

      if (tradesRes.ok) {
        const data = await tradesRes.json();
        setTrades(data.trades);
      }

    } catch (e) {
      console.error(e);
      toast.error("Failed to fetch detailed budget sheets");
    } finally {
      setLoading(false);
    }
  }, [fetchSnapshot]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Fetch Analytics & Manage Streaming Interval
  useEffect(() => {
    if (activeTab !== "analytics") return;

    const fetchAnalytics = async () => {
      try {
        const [mapRes, sankeyRes, liveHistRes] = await Promise.all([
          fetch("/api/analytics/map"),
          fetch("/api/analytics/sankey"),
          fetch("/api/analytics/live")
        ]);

        if (mapRes.ok) setMapData(await mapRes.json());
        if (sankeyRes.ok) setSankeyData(await sankeyRes.json());
        if (liveHistRes.ok) {
          const hist = await liveHistRes.json();
          setLiveData(hist.slice(-30));
        }
      } catch (err) {
        console.error("Failed to load pipeline analytics:", err);
      }
    };

    fetchAnalytics();

    // Set up polling interval for real-time bid streams
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch("/api/analytics/live?latest=true");
        if (res.ok) {
          const point = await res.json();
          setLiveData((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].time === point.time) {
              return prev;
            }
            const next = [...prev, point];
            return next.slice(-30);
          });
        }
      } catch (err) {
        console.warn("Live stream fetch failed:", err);
      }
    }, 2500);

    return () => clearInterval(intervalId);
  }, [activeTab]);

  // Handle Kitchen Scenario Change
  const selectKitchenScenario = async (key: string, textLabel: string) => {
    try {
      const res = await fetch("/api/budget-scenarios/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioKey: key })
      });
      if (!res.ok) throw new Error("Failed to select scenario");
      
      toast.success(`Activated ${textLabel}`);
      setActiveKitchen(textLabel);
      fetchSnapshot();
    } catch (e) {
      toast.error("Failed to update active scenario");
    }
  };

  // Handle Shower Selection or Addon Toggle
  const updateVariable = async (key: string, value: string) => {
    try {
      const res = await fetch("/api/budget-assumptions/variables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value })
      });
      if (!res.ok) throw new Error("Failed to save selection");
      
      if (key === "ACTIVE_SHOWER_SCENARIO") {
        setActiveShowerScenario(value);
        toast.success(`Selected Shower Scenario ${value}`);
      } else if (key === "ENABLE_STEAM_SHOWER") {
        setEnableSteam(value === "true");
        toast.success(value === "true" ? "Enabled Steam Shower add-on" : "Disabled Steam Shower add-on");
      } else if (key === "ENABLE_SMART_SHOWER") {
        setEnableSmart(value === "true");
        toast.success(value === "true" ? "Enabled Smart Shower add-on" : "Disabled Smart Shower add-on");
      }
      
      fetchSnapshot();
    } catch (e) {
      toast.error("Failed to save selection");
    }
  };

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
  };

  const uniqueCategories = Array.from(new Set(trades.map(t => t.category))).sort();

  const filteredTrades = trades.filter(t => {
    const matchesSearch = t.workItem.toLowerCase().includes(tradeSearch.toLowerCase()) || 
                          t.description?.toLowerCase().includes(tradeSearch.toLowerCase());
    const matchesCategory = tradeCategory ? t.category === tradeCategory : true;
    return matchesSearch && matchesCategory;
  });

  if (loading || !snapshot) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4 bg-zinc-950 px-4 text-zinc-400">
        <Activity className="h-10 w-10 animate-spin text-emerald-500" />
        <p className="text-sm font-medium tracking-wide">Synthesizing full budget model...</p>
      </div>
    );
  }

  const rollups: BudgetRollups = snapshot.rollups;
  const config = snapshot.configuration;

  const pieChartConfig = {
    value: {
      label: "Cost",
    },
    structural: {
      label: "Structural",
      color: "var(--chart-1)",
    },
    framing: {
      label: "Framing",
      color: "var(--chart-2)",
    },
    mechanical: {
      label: "Mechanical",
      color: "var(--chart-3)",
    },
    finishes: {
      label: "Finishes",
      color: "var(--chart-4)",
    },
    kitchen: {
      label: "Kitchen",
      color: "var(--chart-5)",
    },
    bathroom: {
      label: "Bathroom",
      color: "var(--chart-1)",
    },
    addons: {
      label: "Add-ons",
      color: "var(--chart-2)",
    },
    remaining: {
      label: "Remaining Cap",
      color: "var(--chart-5)",
    }
  } satisfies ChartConfig;

  // Zoomed-in Room drill-down data builder
  const getPieData = () => {
    if (!zoomedRoom) {
      // Rooms only to start
      return [
        ...snapshot.breakdown.baseAssumptions.sections.map((sec: any, idx: number) => {
          const name = sec.name.replace("Phase 1: ", "");
          const key = name.toLowerCase().replace(/[^a-z]/g, "");
          return {
            name,
            key,
            value: sec.avg,
            fill: `var(--chart-${(idx % 5) + 1})`,
          };
        }),
        {
          name: "Kitchen Layout",
          key: "kitchen",
          value: snapshot.breakdown.kitchenScenario.cost,
          fill: "var(--chart-5)",
        },
        {
          name: "Bathroom Shower",
          key: "bathroom",
          value: snapshot.breakdown.showerScenario.avg,
          fill: "var(--chart-1)",
        },
        ...((snapshot.breakdown.addOns.steamShower.avg > 0 || snapshot.breakdown.addOns.smartShower.avg > 0) ? [{
          name: "Add-ons",
          key: "addons",
          value: (snapshot.breakdown.addOns.steamShower.avg || 0) + (snapshot.breakdown.addOns.smartShower.avg || 0),
          fill: "var(--chart-2)",
        }] : [])
      ].filter(item => item.value > 0);
    }

    // Zoomed room details showing specific deviations/variations
    if (zoomedRoom === "Kitchen Layout") {
      return scenarios.map((sc: any, idx: number) => ({
        name: sc.label,
        key: `kitchen-${sc.scenarioKey}`,
        value: sc.deviationTotal,
        fill: `var(--chart-${(idx % 5) + 1})`,
      }));
    }

    if (zoomedRoom === "Bathroom Shower" || zoomedRoom === "Add-ons") {
      return [
        {
          name: `Shower Base (${activeShowerScenario})`,
          key: "bathroom-base",
          value: snapshot.breakdown.showerScenario.avg,
          fill: "var(--chart-1)",
        },
        ...(snapshot.breakdown.addOns.steamShower.avg > 0 ? [{
          name: "Steam System",
          key: "bathroom-steam",
          value: snapshot.breakdown.addOns.steamShower.avg,
          fill: "var(--chart-2)",
        }] : []),
        ...(snapshot.breakdown.addOns.smartShower.avg > 0 ? [{
          name: "Smart Controller",
          key: "bathroom-smart",
          value: snapshot.breakdown.addOns.smartShower.avg,
          fill: "var(--chart-3)",
        }] : []),
      ].filter(item => item.value > 0);
    }

    // Assumptions section drill-down
    const section = snapshot.breakdown.baseAssumptions.sections.find(
      (sec: any) => sec.name.replace("Phase 1: ", "") === zoomedRoom
    );
    if (section) {
      const matchingSectionKey = Object.keys(assumptions).find(
        (key) => key.toLowerCase().includes(zoomedRoom.toLowerCase())
      );
      const lineItems = matchingSectionKey ? assumptions[matchingSectionKey] : [];
      if (lineItems && lineItems.length > 0) {
        return lineItems.map((item: any, idx: number) => ({
          name: item.itemDescription.split("(")[0].trim().slice(0, 20),
          key: `line-item-${idx}`,
          value: item.avgCost,
          fill: `var(--chart-${(idx % 5) + 1})`,
        }));
      }
    }

    return [{
      name: zoomedRoom,
      key: "fallback",
      value: 1000,
      fill: "var(--chart-1)",
    }];
  };

  const rawPieData = getPieData();
  const totalPieAvg = rawPieData.reduce((acc, item) => acc + item.value, 0);

  // Remaining budget slice is added ONLY when in rooms-only top level
  const pieData = [...rawPieData];
  if (!zoomedRoom) {
    const remainingCap = Math.max(0, rollups.cap - totalPieAvg);
    if (remainingCap > 0) {
      pieData.push({
        name: "Remaining Cap",
        key: "remaining",
        value: remainingCap,
        fill: "oklch(0.205 0 0)",
      });
    }
  }

  const renderCustomPieLabel = ({ name, value, cx, x, y, percent }: any) => {
    if (value === 0) return null;
    const valInK = (value / 1000).toFixed(1);
    
    // Percentage calculated relative to total cap if top-level, or total room spend if zoomed in
    const denominator = zoomedRoom ? totalPieAvg : rollups.cap;
    const pct = Math.round((value / denominator) * 100);
    
    if (value < 500) return null;

    return (
      <text
        x={x}
        y={y}
        fill="oklch(0.985 0 0)"
        textAnchor={x > cx ? "start" : "end"}
        dominantBaseline="central"
        className="text-[10px] sm:text-xs font-semibold fill-foreground"
      >
        <tspan x={x} dy="-0.6em" className="font-bold block text-white">{name}</tspan>
        <tspan x={x} dy="1.2em" className="text-zinc-400 fill-zinc-400 font-normal">${valInK}k / {pct}%</tspan>
      </text>
    );
  };

  const getAIInsights = () => {
    const isOver = rollups.isOverCap;
    const diff = Math.abs(rollups.difference);
    
    if (isOver) {
      return {
        title: "Contingency Override Warning",
        status: "critical",
        icon: AlertCircle,
        colorClass: "text-red-500",
        message: `The realistic average cost is currently ${formatCurrency(diff)} over the $300k cap ceiling.`,
        bullets: [
          enableSteam ? "De-activating the Steam Shower add-on will immediately recover $8,000 in budget headroom." : null,
          enableSmart ? "De-activating the Smart Shower Controller add-on will recover $2,450." : null,
          config.activeKitchenText !== "Scenario D" ? "Switching the kitchen location to Scenario D (baseline in-kind) will eliminate high layout plumbing variances." : null,
          "Consider moving mechanical labor hour allocations to Phase 2 to utilize additional framing credits."
        ].filter(Boolean) as string[],
      };
    } else {
      return {
        title: "Financial Matrix Clean",
        status: "optimized",
        icon: CheckCircle,
        colorClass: "text-emerald-500",
        message: `Looking good! The current realistic average is ${formatCurrency(diff)} under the $300,000 Phase 1 cap ceiling.`,
        bullets: [
          !enableSteam ? "You have enough margin to toggle the premium Steam Shower upgrade (+$8,000) if desired." : null,
          !enableSmart ? "Adding the Smart Shower digital controller (+$2,450) is fully covered within the current headroom." : null,
          "D1 ledger is currently in healthy synchronization. Asset class allocation velocity is stable."
        ].filter(Boolean) as string[],
      };
    }
  };

  const aiInsight = getAIInsights();

  const baseChartData = snapshot.breakdown?.baseAssumptions?.sections?.map((sec: any) => ({
    label: sec.name.replace("Phase 1: ", "").slice(0, 12),
    min: sec.min,
    avg: sec.avg,
    max: sec.max,
  })) || [];

  const chartData = [
    ...baseChartData,
    {
      label: "Kitchen",
      min: snapshot.breakdown.kitchenScenario.cost,
      avg: snapshot.breakdown.kitchenScenario.cost,
      max: snapshot.breakdown.kitchenScenario.cost,
    },
    {
      label: "Shower Base",
      min: snapshot.breakdown.showerScenario.min,
      avg: snapshot.breakdown.showerScenario.avg,
      max: snapshot.breakdown.showerScenario.max,
    },
    ...((snapshot.breakdown.addOns.steamShower.avg > 0 || snapshot.breakdown.addOns.smartShower.avg > 0) ? [{
      label: "Add-ons",
      min: (snapshot.breakdown.addOns.steamShower.min || 0) + (snapshot.breakdown.addOns.smartShower.min || 0),
      avg: (snapshot.breakdown.addOns.steamShower.avg || 0) + (snapshot.breakdown.addOns.smartShower.avg || 0),
      max: (snapshot.breakdown.addOns.steamShower.max || 0) + (snapshot.breakdown.addOns.smartShower.max || 0),
    }] : [])
  ];

  return (
    <div className="min-h-svh w-full max-w-full overflow-x-hidden bg-zinc-950 px-3 py-4 text-zinc-100 sm:px-4 sm:py-6 lg:px-8">
    <div className="mx-auto w-full min-w-0 max-w-[1800px] space-y-6 sm:space-y-8">
      
      {/* Top Header */}
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            <Sliders className="h-7 w-7 shrink-0 text-emerald-500 sm:h-8 sm:w-8" />
            Budget Triage Matrix
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
            Compare layout scenarios, toggle bathroom additions, and play out the cost delta in real-time.
          </p>
        </div>
        
        {/* Connection status */}
        <div className="flex items-center gap-2 self-start rounded-full border border-emerald-800/60 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-400 md:self-auto">
          <Wifi className="h-3.5 w-3.5" />
          D1 Live Sync Connected
        </div>
      </div>

      {/* KPI Highlight Strip */}
      <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">

        {/* KPI: Cap */}
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Baseline Cap</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {formatCurrency(rollups.cap)}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <TrendingUp />
                Target Ceiling
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Phase 1 absolute max ceiling <TrendingUp className="size-4" />
            </div>
            <div className="text-muted-foreground">
              Dynamic ceiling synced with system vars
            </div>
          </CardFooter>
        </Card>

        {/* KPI: Min Cost */}
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Optimistic Cost (Min)</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {formatCurrency(rollups.min)}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <TrendingUp />
                Optimized
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Optimized baseline footprint <TrendingUp className="size-4" />
            </div>
            <div className="text-muted-foreground">
              Select curbless drop-box layout to reduce variance
            </div>
          </CardFooter>
        </Card>

        {/* KPI: Avg Cost */}
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Realistic Target (Avg)</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {formatCurrency(rollups.avg)}
            </CardTitle>
            <CardAction>
              {rollups.isOverCap ? (
                <Badge variant="destructive">
                  <TrendingDown />
                  Over Cap
                </Badge>
              ) : (
                <Badge variant="outline">
                  <TrendingUp />
                  On Target
                </Badge>
              )}
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {rollups.difference >= 0
                ? <>{formatCurrency(rollups.difference)} under cap <TrendingUp className="size-4" /></>
                : <>{formatCurrency(Math.abs(rollups.difference))} over cap <TrendingDown className="size-4" /></>
              }
            </div>
            <div className="text-muted-foreground">
              {rollups.isOverCap
                ? "Exclude Steam Shower to save $8,000 immediately"
                : "Budget is clean — margin allows Steam Shower upgrade"
              }
            </div>
          </CardFooter>
        </Card>

        {/* KPI: Max Cost */}
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Risk Ceiling (Max)</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {formatCurrency(rollups.max)}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <TrendingDown />
                Risk Ceiling
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Worst-case contingency scenario <TrendingDown className="size-4" />
            </div>
            <div className="text-muted-foreground">
              High plumbing layout represents $40k risk variance
            </div>
          </CardFooter>
        </Card>

      </div>

      {/* Real-time Budget Progress Bar */}
      <div className="bg-zinc-900/40 border border-zinc-800 p-5 rounded-2xl space-y-3">
        <div className="flex justify-between text-xs font-bold tracking-wide uppercase text-zinc-400">
          <span>Realistic Target cost progress</span>
          <span className={rollups.isOverCap ? 'text-red-400' : 'text-emerald-400'}>
            {((rollups.avg / rollups.cap) * 100).toFixed(1)}% of Budget Cap
          </span>
        </div>
        <div className="w-full bg-zinc-800 h-3.5 rounded-full overflow-hidden flex">
          <div 
            className={`h-full transition-all duration-500 rounded-full ${rollups.isOverCap ? 'bg-red-500' : 'bg-emerald-500'}`} 
            style={{ width: `${Math.min((rollups.avg / rollups.cap) * 100, 100)}%` }}
          />
        </div>
        <div className="flex flex-col gap-1 pt-1 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 break-words">Active Config: Kitchen [{activeKitchen}] • Shower [{activeShowerScenario}] {enableSteam && "• [Steam]"} {enableSmart && "• [Smart]"}</span>
          <span>$300,000 Cap</span>
        </div>
      </div>

      <BudgetAssistantPanel onApplied={fetchSnapshot} />

      {/* Tabs Navigation (Glassmorphic dark design) */}
      <div className="flex gap-2 overflow-x-auto border-b border-zinc-800 pb-px [scrollbar-width:none]">
        {[
          { id: "summary", label: "Model Summary", icon: Layers },
          { id: "insights", label: "Data Story", icon: Sparkles },
          { id: "analytics", label: "Pipeline Analytics", icon: BarChart3 },
          { id: "kitchen", label: "Kitchen Scenarios", icon: Sliders },
          { id: "shower", label: "Bathroom Shower Picker", icon: Sliders },
          { id: "assumptions", label: "Budget Assumptions", icon: CheckSquare },
          { id: "trades", label: "Trades Catalog", icon: Database }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-5 py-3.5 border-b-2 font-semibold text-sm tracking-wide transition-all whitespace-nowrap ${isActive ? 'border-emerald-500 text-white bg-zinc-900/30' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
            >
              <Icon className={`h-4.5 w-4.5 ${isActive ? 'text-emerald-400' : 'text-zinc-500'}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ==========================================
          TAB 1: MODEL SUMMARY
          ========================================== */}
      {activeTab === "summary" && (
        <div className="space-y-8 animate-fadeIn">
          
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
            
            {/* Active Selections Card */}
            <div className="lg:col-span-1 bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 space-y-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 pb-3 border-b border-zinc-800">
                <Settings className="h-5 w-5 text-emerald-500" />
                Active Configuration
              </h3>
              
              <div className="space-y-4">
                <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-2">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Active Kitchen Scenario</span>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white text-sm">{activeKitchen}</span>
                    <button 
                      onClick={() => setActiveTab("kitchen")}
                      className="text-xs font-bold text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      Compare <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-2">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Shower Scenario</span>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white text-sm">Scenario {activeShowerScenario}</span>
                    <button 
                      onClick={() => setActiveTab("shower")}
                      className="text-xs font-bold text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      Pick <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-3">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Bathroom Add-ons</span>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-300 font-semibold flex items-center gap-1.5">
                      <Flame className="h-3.5 w-3.5 text-amber-500" />
                      Steam Shower upgrade
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${enableSteam ? 'bg-amber-950/60 text-amber-400 border border-amber-800/60' : 'bg-zinc-800 text-zinc-400'}`}>
                      {enableSteam ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-300 font-semibold flex items-center gap-1.5">
                      <Settings className="h-3.5 w-3.5 text-blue-400" />
                      Digital Smart controller
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${enableSmart ? 'bg-blue-950/60 text-blue-400 border border-blue-800/60' : 'bg-zinc-800 text-zinc-400'}`}>
                      {enableSmart ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-2">
                  <div className="flex justify-between text-xs text-zinc-500 font-bold uppercase tracking-wider">
                    <span>HVAC Framing Credit</span>
                    <span>{snapshot.configuration.framingCreditText}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500">Applied automatically to mechanical labor hour allocations</p>
                </div>
              </div>

            </div>

            {/* Room Breakdown Rollup Card */}
            <Card className="flex flex-col lg:col-span-2 border border-zinc-800 bg-zinc-950/50 backdrop-blur-md rounded-2xl overflow-hidden">
              <CardHeader className="pb-3 border-b border-zinc-800/80">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
                      <Layers className="h-5 w-5 text-emerald-500" />
                      {zoomedRoom ? `Zoomed Room: ${zoomedRoom}` : "Budget Breakdown by Room / Area"}
                    </CardTitle>
                    <CardDescription className="text-zinc-400 text-xs mt-1">
                      {zoomedRoom 
                        ? "Showing detailed deviation/variation breakdown within this room. Click the chart to zoom out." 
                        : "Top-level rooms breakdown. Click any room slice to drill into deviations."
                      }
                    </CardDescription>
                  </div>
                  {zoomedRoom && (
                    <button 
                      onClick={() => setZoomedRoom(null)}
                      className="text-xs font-bold text-emerald-400 hover:underline px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg transition-all"
                    >
                      Back to Rooms
                    </button>
                  )}
                </div>
              </CardHeader>
              
              <CardContent className="flex-1 space-y-6 pt-4">
                <BudgetChart data={chartData} cap={rollups.cap} />
                
                <ChartContainer
                  config={pieChartConfig}
                  className="mx-auto aspect-square max-h-[300px] pb-0 [&_.recharts-pie-label-text]:fill-foreground"
                >
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      label={renderCustomPieLabel}
                      outerRadius={75}
                      stroke="oklch(0.145 0 0)"
                      strokeWidth={2}
                      labelLine={{ stroke: "oklch(0.708 0 0)", strokeWidth: 1, strokeDasharray: "2 2" }}
                      onClick={(data) => {
                        if (data && data.name) {
                          if (zoomedRoom) {
                            setZoomedRoom(null);
                          } else if (data.name !== "Remaining Cap") {
                            setZoomedRoom(data.name);
                          }
                        }
                      }}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} className="cursor-pointer hover:opacity-85 transition-opacity" />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </CardContent>

              <CardFooter className="flex-col gap-2 text-sm border-t border-zinc-850 p-4 items-start">
                <div className={`flex items-center gap-2 leading-none font-bold ${aiInsight.colorClass}`}>
                  {aiInsight.title} <TrendingUp className="h-4 w-4" />
                </div>
                <div className="leading-none text-muted-foreground text-xs sm:text-sm">
                  {aiInsight.message}
                </div>
                {aiInsight.bullets.length > 0 && (
                  <div className="mt-2 space-y-1.5 text-[11px] text-zinc-400">
                    {aiInsight.bullets.map((b, i) => (
                      <div key={i} className="flex items-start gap-1">
                        <span className="text-zinc-500 font-bold mr-1">•</span>
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardFooter>
            </Card>

          </div>

        </div>
      )}

      {/* ==========================================
          TAB 2: KITCHEN SCENARIOS COMPARATOR
          ========================================== */}
      {activeTab === "kitchen" && (
        <div className="space-y-8 animate-fadeIn">
          <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-2xl flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div>
              <h3 className="text-md font-bold text-white">Interactive Kitchen Comparator</h3>
              <p className="text-xs text-zinc-400">
                Play out the deviations between building downstairs vs upstairs. Upstairs Scenario D is the baseline in-kind option.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="text-xs font-semibold px-3 py-1 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-full">
                Active Selection: <span className="text-emerald-400 font-bold ml-1">{activeKitchen}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {scenarios.map(sc => {
              const isActive = activeKitchen === sc.label;
              return (
                <div 
                  key={sc.id} 
                  className={`flex flex-col bg-zinc-900/50 backdrop-blur-sm border rounded-2xl p-6 transition-all duration-300 shadow-md relative overflow-hidden group ${isActive ? 'border-emerald-500 bg-zinc-900/80 shadow-emerald-950/20' : 'border-zinc-800 hover:border-zinc-700'}`}
                >
                  {isActive && (
                    <div className="absolute top-0 right-0 px-3 py-1 bg-emerald-500 text-zinc-950 text-[10px] font-bold uppercase tracking-wider rounded-bl-lg">
                      Active choice
                    </div>
                  )}
                  <h4 className="text-lg font-bold text-white">{sc.label}</h4>
                  <span className="text-xs font-semibold text-zinc-400 mt-1 uppercase tracking-wider">{sc.kitchenLocation}</span>
                  
                  <div className="mt-4 space-y-2.5 flex-1">
                    <div className="flex flex-col p-2 bg-zinc-950/50 rounded-lg border border-zinc-800/40">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">Sub Location</span>
                      <span className="text-xs font-semibold text-zinc-300">{sc.subLocation}</span>
                    </div>

                    <div className="flex flex-col p-2 bg-zinc-950/50 rounded-lg border border-zinc-800/40">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">Layout Type</span>
                      <span className="text-xs font-semibold text-zinc-300">{sc.layoutType}</span>
                    </div>

                    <div className="flex flex-col p-2 bg-zinc-950/50 rounded-lg border border-zinc-800/40">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">Plumbing Strategy</span>
                      <span className="text-xs font-semibold text-zinc-300">{sc.plumbingStrategy}</span>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-zinc-800/60 mt-6 space-y-4">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-zinc-400 font-semibold">Deviation Total:</span>
                      <span className="text-xl font-black text-white">{formatCurrency(sc.deviationTotal)}</span>
                    </div>

                    <button
                      onClick={() => selectKitchenScenario(sc.scenarioKey, sc.label)}
                      disabled={isActive}
                      className={`w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all ${isActive ? 'bg-emerald-950/40 border border-emerald-800/40 text-emerald-400' : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 hover:scale-[1.02]'}`}
                    >
                      {isActive ? 'Currently Active' : 'Activate layout'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Comparison Grid Table */}
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 pb-4 border-b border-zinc-800">
              <Database className="h-5 w-5 text-emerald-500" />
              Line-Item Cost Comparison Grid
            </h3>
            
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-400 font-bold uppercase tracking-wider">
                    <th className="py-4 px-4">Line Item / Construction Scope</th>
                    <th className="py-4 px-4 text-right">Scenario A</th>
                    <th className="py-4 px-4 text-right">Scenario B</th>
                    <th className="py-4 px-4 text-right">Scenario C</th>
                    <th className="py-4 px-4 text-right">Scenario D</th>
                    <th className="py-4 px-4 pl-8">Scope notes / triggers</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonGrid.map((row, idx) => (
                    <tr key={idx} className="border-b border-zinc-900 hover:bg-zinc-900/20 text-xs text-zinc-300 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-white">{row.label}</td>
                      <td className="py-3.5 px-4 text-right font-semibold">{formatCurrency(row.costs.a)}</td>
                      <td className="py-3.5 px-4 text-right font-semibold">{formatCurrency(row.costs.b)}</td>
                      <td className="py-3.5 px-4 text-right font-semibold">{formatCurrency(row.costs.c)}</td>
                      <td className="py-3.5 px-4 text-right font-semibold">{formatCurrency(row.costs.d)}</td>
                      <td className="py-3.5 px-4 pl-8 text-zinc-500 max-w-[280px] truncate" title={row.notes}>{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          TAB 3: BATHROOM SHOWER PICKER
          ========================================== */}
      {activeTab === "shower" && (
        <div className="space-y-8 animate-fadeIn">
          
          <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-2xl flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div>
              <h3 className="text-md font-bold text-white">Primary Bathroom Shower Matrix</h3>
              <p className="text-xs text-zinc-400">
                Choose structural × plumbing configurations (A-F × 1-2) and togglable hardware add-ons. 
              </p>
            </div>
            <span className="text-xs font-semibold px-3 py-1 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-full">
              Selected: <span className="text-emerald-400 font-bold ml-1">Scenario {activeShowerScenario}</span>
            </span>
          </div>

          {/* Matrix Picker Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
            
            {/* Base Shower Grid */}
            <div className="lg:col-span-2 space-y-6">
              <h4 className="text-md font-bold text-white flex items-center gap-2">
                <Sliders className="h-4.5 w-4.5 text-emerald-500" />
                Structural Approach × Plumbing Configuration
              </h4>
              
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Group scenarios A-F */}
                {[
                  { letter: "A", name: "Scenario A", wall: "center (Reclaimed Tub)", floor: "Curbless Drop Box", range: "A1/A2" },
                  { letter: "B", name: "Scenario B", wall: "center (Reclaimed Tub)", floor: "Sloped Mud Bed", range: "B1/B2" },
                  { letter: "C", name: "Scenario C", wall: "center (Reclaimed Tub)", floor: "Standard Step Curb", range: "C1/C2" },
                  { letter: "D", name: "Scenario D", wall: "side (No Relocation)", floor: "Curbless Drop Box", range: "D1/D2" },
                  { letter: "E", name: "Scenario E", wall: "side (No Relocation)", floor: "Sloped Mud Bed", range: "E1/E2" },
                  { letter: "F", name: "Scenario F", wall: "side (No Relocation)", floor: "Standard Step Curb", range: "F1/F2" }
                ].map(group => {
                  const item1 = showerMatrix.baseScenarios.find(s => s.scenarioLetter === group.letter && s.variantNumber === 1);
                  const item2 = showerMatrix.baseScenarios.find(s => s.scenarioLetter === group.letter && s.variantNumber === 2);
                  
                  const is1Active = activeShowerScenario === `${group.letter}1`;
                  const is2Active = activeShowerScenario === `${group.letter}2`;

                  return (
                    <div key={group.letter} className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl space-y-4 hover:border-zinc-700 transition-all">
                      <div>
                        <h5 className="font-bold text-white text-sm">{group.name}</h5>
                        <p className="text-[11px] text-zinc-500 font-semibold">{group.floor} • Wall: {group.wall}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => updateVariable("ACTIVE_SHOWER_SCENARIO", `${group.letter}1`)}
                          className={`flex flex-col p-3 rounded-xl border text-left transition-all ${is1Active ? 'border-emerald-500 bg-emerald-950/20 text-emerald-400' : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950'}`}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wider">Variant 1</span>
                          <span className="text-[11px] font-semibold text-zinc-300 mt-1">Dual Rainhead</span>
                          <span className="text-xs font-bold text-white mt-2">{formatCurrency(item1?.avgCost)}</span>
                        </button>
                        
                        <button
                          onClick={() => updateVariable("ACTIVE_SHOWER_SCENARIO", `${group.letter}2`)}
                          className={`flex flex-col p-3 rounded-xl border text-left transition-all ${is2Active ? 'border-emerald-500 bg-emerald-950/20 text-emerald-400' : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950'}`}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wider">Variant 2</span>
                          <span className="text-[11px] font-semibold text-zinc-300 mt-1">Single Head</span>
                          <span className="text-xs font-bold text-white mt-2">{formatCurrency(item2?.avgCost)}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Shower Add-ons Sidecard */}
            <div className="space-y-6">
              <h4 className="text-md font-bold text-white flex items-center gap-2">
                <Plus className="h-4.5 w-4.5 text-emerald-500" />
                Specialist Upgrade Add-Ons
              </h4>
              
              <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl space-y-6">
                
                {/* Steam Shower */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Flame className="h-5 w-5 text-amber-500" />
                      <div>
                        <h5 className="font-bold text-white text-sm">Steam Shower System</h5>
                        <p className="text-[10px] text-zinc-500">generator, ceiling vapor tanking</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-zinc-400">
                        {enableSteam ? 'Included' : 'Excluded'}
                      </span>
                      <Switch
                        id="steam-shower"
                        checked={enableSteam}
                        onCheckedChange={(checked) => updateVariable("ENABLE_STEAM_SHOWER", checked ? "true" : "false")}
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-zinc-950 rounded-xl text-[11px] text-zinc-400 border border-zinc-850 space-y-1">
                    <span className="font-semibold text-zinc-300">Cost impact (Avg): +$8,000</span>
                    <p className="text-zinc-500">Includes air-tight glass enclosure, sloped ceiling framing and dedicated 240V whip run.</p>
                  </div>
                </div>

                <div className="border-t border-zinc-800/80 my-4" />

                {/* Smart Shower */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Settings className="h-5 w-5 text-blue-400" />
                      <div>
                        <h5 className="font-bold text-white text-sm">Smart Digital Controller</h5>
                        <p className="text-[10px] text-zinc-500">3-port programmable valve box</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-zinc-400">
                        {enableSmart ? 'Included' : 'Excluded'}
                      </span>
                      <Switch
                        id="smart-shower"
                        checked={enableSmart}
                        onCheckedChange={(checked) => updateVariable("ENABLE_SMART_SHOWER", checked ? "true" : "false")}
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-zinc-950 rounded-xl text-[11px] text-zinc-400 border border-zinc-850 space-y-1">
                    <span className="font-semibold text-zinc-300">Cost impact (Avg): +$2,450</span>
                    <p className="text-zinc-500">Digital 3-port kit + dedicated 120V GFCI outlet and data cabling.</p>
                  </div>
                </div>

              </div>
            </div>

          </div>

        </div>
      )}

      {/* ==========================================
          TAB 4: BUDGET ASSUMPTIONS VIEW
          ========================================== */}
      {activeTab === "assumptions" && (
        <div className="space-y-8 animate-fadeIn">
          <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-2xl flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div>
              <h3 className="text-md font-bold text-white">Core Remodel Assumptions Ledger</h3>
              <p className="text-xs text-zinc-400">
                Authoritative budget revisions listed by room section. Note Phase tags.
              </p>
            </div>
            <span className="text-xs font-semibold px-3 py-1 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-full">
              Phase 1 critical path vs Phase 2 deferrals
            </span>
          </div>

          <div className="space-y-6">
            {Object.entries(assumptions).map(([sectionName, items]) => (
              <div key={sectionName} className="bg-zinc-900/30 border border-zinc-800/80 rounded-2xl overflow-hidden shadow">
                <div className="bg-zinc-900/60 py-3.5 px-5 border-b border-zinc-800 flex justify-between items-center">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">{sectionName}</h4>
                  <span className="text-[10px] font-bold text-zinc-400 px-2 py-0.5 bg-zinc-800 rounded">
                    {items.length} Line Items
                  </span>
                </div>
                
                <div className="divide-y divide-zinc-900/80">
                  {items.map((item, idx) => (
                    <div key={idx} className="p-4 flex flex-col md:flex-row md:items-center md:justify-between hover:bg-zinc-900/10 transition-colors gap-4 text-xs">
                      <div className="space-y-1.5 md:max-w-2xl">
                        <span className="font-bold text-white">{item.itemDescription}</span>
                        {item.variantRiskNotes && (
                          <p className="text-zinc-500 text-[11px] leading-relaxed flex items-start gap-1">
                            <Info className="h-3 w-3 mt-0.5 text-zinc-400 shrink-0" />
                            {item.variantRiskNotes}
                          </p>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-6 self-start md:self-auto shrink-0">
                        {/* Phase tag badge */}
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${item.phaseTag.includes("Critical") ? 'bg-red-950/40 border-red-900/40 text-red-400' : item.phaseTag.includes("Defer") ? 'bg-zinc-850 border-zinc-750 text-zinc-400' : 'bg-amber-950/40 border-amber-900/40 text-amber-400'}`}>
                          {item.phaseTag.replace("Phase 1: ", "").replace("Phase 2: ", "")}
                        </span>

                        {/* Cost rollups */}
                        <div className="text-right space-y-0.5 min-w-[80px]">
                          <span className="font-bold text-white block">{formatCurrency(item.avgCost)}</span>
                          <span className="text-[10px] text-zinc-500 block">[{formatCurrency(item.minCost)} - {formatCurrency(item.maxCost)}]</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* ==========================================
          TAB 5: TRADES REFERENCE BROWSER
          ========================================== */}
      {activeTab === "trades" && (
        <div className="space-y-8 animate-fadeIn">
          
          {/* Search bar and SF toggle */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            
            <div className="md:col-span-4 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                type="text"
                value={tradeSearch}
                onChange={e => setTradeSearch(e.target.value)}
                placeholder="Search atomic construction tasks..."
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700/80 focus:border-emerald-500 text-xs text-white placeholder-zinc-500 rounded-xl transition-all focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="md:col-span-3">
              <select
                value={tradeCategory}
                onChange={e => setTradeCategory(e.target.value)}
                className="w-full py-2.5 px-4 bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">All Categories</option>
                {uniqueCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Pricing toggle */}
            <div className="flex md:col-span-5 md:justify-end">
              <button
                onClick={() => setUseSfPricing(!useSfPricing)}
                className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all md:w-auto ${useSfPricing ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
              >
                <DollarSign className="h-4 w-4" />
                {useSfPricing ? "Showing SF Bay Adjusted Pricing" : "Showing Insurance Max Unit Price"}
              </button>
            </div>

          </div>

          {/* Trades table */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-zinc-800 text-[10px] text-zinc-500 font-bold uppercase tracking-widest bg-zinc-900/20">
                    <th className="py-4 px-5">Construction Work Item</th>
                    <th className="py-4 px-5">Category</th>
                    <th className="py-4 px-5">Unit</th>
                    <th className="py-4 px-5 text-right">Max Unit Price</th>
                    <th className="py-4 px-5 text-right">SF Bay Unit Price</th>
                    <th className="py-4 px-5 text-right">Multiplier</th>
                    <th className="py-4 px-5 pl-8">Rationale / Analysis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {filteredTrades.slice(0, 100).map(t => (
                    <tr key={t.id} className="hover:bg-zinc-900/20 text-xs text-zinc-300 transition-colors">
                      <td className="py-4 px-5 font-semibold text-white max-w-[300px] truncate" title={t.workItem}>{t.workItem}</td>
                      <td className="py-4 px-5">
                        <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] font-semibold rounded">
                          {t.category}
                        </span>
                      </td>
                      <td className="py-4 px-5 font-mono uppercase text-zinc-400">{t.measurementType}</td>
                      <td className="py-4 px-5 text-right font-mono">${t.maxUnitPrice.toFixed(2)}</td>
                      <td className="py-4 px-5 text-right font-mono font-bold text-emerald-400">${t.sfUnitPrice.toFixed(2)}</td>
                      <td className="py-4 px-5 text-right font-mono text-zinc-500">{t.sfMultiplier}x</td>
                      <td className="py-4 px-5 pl-8 text-zinc-500 max-w-[280px] truncate" title={t.rationale}>{t.rationale}</td>
                    </tr>
                  ))}
                  {filteredTrades.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-zinc-500 font-medium">
                        No trade items found matching your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredTrades.length > 100 && (
              <div className="py-3 px-5 border-t border-zinc-800 text-center text-[10px] text-zinc-500 font-semibold uppercase tracking-wider bg-zinc-900/15">
                Showing top 100 matches of {filteredTrades.length} total rows
              </div>
            )}
          </div>

        </div>
      )}

      {activeTab === "insights" && (() => {
        const baseSections = snapshot.breakdown?.baseAssumptions?.sections || [];
        
        // 1. Radar chart data
        const radarData = baseSections.map((sec: any) => {
          const min = sec.min || 0;
          const max = sec.max || 0;
          const avg = sec.avg || 1;
          const volatility = avg > 0 ? Math.round(((max - min) / avg) * 100) : 0;
          return {
            name: sec.name.replace("Phase 1: ", "").slice(0, 15),
            volatility,
            min,
            max,
            avg
          };
        });
        
        const sortedVolatility = [...radarData].sort((a, b) => b.volatility - a.volatility);
        const highestVolatilitySection = sortedVolatility[0] || { name: "N/A", volatility: 0 };

        // 2. Waterfall Cost Build-up data
        const phases = [
          ...baseSections.map((sec: any) => ({
            label: sec.name.replace("Phase 1: ", ""),
            avg: sec.avg,
          })),
          {
            label: "Kitchen Layout",
            avg: snapshot.breakdown?.kitchenScenario?.cost || 0,
          },
          {
            label: "Bathroom Shower",
            avg: snapshot.breakdown?.showerScenario?.avg || 0,
          },
          ...(((snapshot.breakdown?.addOns?.steamShower?.avg || 0) > 0 || (snapshot.breakdown?.addOns?.smartShower?.avg || 0) > 0) ? [{
            label: "Add-ons Selection",
            avg: (snapshot.breakdown?.addOns?.steamShower?.avg || 0) + (snapshot.breakdown?.addOns?.smartShower?.avg || 0),
          }] : [])
        ];

        let waterfallAccumulator = 0;
        const waterfallData = phases.map((phase: any) => {
          const start = waterfallAccumulator;
          waterfallAccumulator += phase.avg;
          return {
            name: phase.label,
            start,
            value: phase.avg,
            cumulative: waterfallAccumulator,
            color: waterfallAccumulator <= 300000 ? "var(--color-emerald-500, #10b981)" : "var(--color-amber-500, #f59e0b)",
          };
        });

        // 3. Scenario comparative data
        const scenarioData = (scenarios || []).map((sc: any) => {
          return {
            name: sc.label,
            deviation: sc.deviationTotal,
            active: activeKitchen === sc.label,
            location: sc.kitchenLocation,
          };
        });
        
        const activeDeviation = scenarios.find((sc: any) => sc.label === activeKitchen)?.deviationTotal || 0;
        const mostEconomicalScenario = [...scenarios].sort((a: any, b: any) => a.deviationTotal - b.deviationTotal)[0];
        const possibleSavings = mostEconomicalScenario ? activeDeviation - mostEconomicalScenario.deviationTotal : 0;

        // 4. Confidence / Risk band computation
        const totalMin = rollups.min || 0;
        const totalAvg = rollups.avg || 0;
        const totalMax = rollups.max || 0;
        const totalCap = rollups.cap || 300000;
        
        const riskSpread = totalMax - totalMin;
        const confidenceScore = Math.max(0, Math.min(100, Math.round((1 - (riskSpread / totalCap)) * 100)));
        
        let confidenceRating = "High";
        let confidenceColor = "text-emerald-400";
        let confidenceBorder = "border-emerald-500/35";
        let confidenceBg = "bg-emerald-950/20";
        if (confidenceScore < 60) {
          confidenceRating = "High Risk";
          confidenceColor = "text-rose-400";
          confidenceBorder = "border-rose-500/35";
          confidenceBg = "bg-rose-950/20";
        } else if (confidenceScore < 80) {
          confidenceRating = "Moderate";
          confidenceColor = "text-amber-400";
          confidenceBorder = "border-amber-500/35";
          confidenceBg = "bg-amber-950/20";
        }

        const maxScaleVal = Math.max(totalMax, totalCap * 1.1);
        const getPercent = (val: number) => {
          return Math.max(0, Math.min(100, (val / maxScaleVal) * 100));
        };
        
        const pctMin = getPercent(totalMin);
        const pctMax = getPercent(totalMax);
        const pctAvg = getPercent(totalAvg);
        const pctCap = getPercent(totalCap);

        // 5. Anomaly timeline events
        const timelineEvents: any[] = [];
        
        baseSections.forEach((sec: any) => {
          const spread = sec.max - sec.min;
          const variancePct = sec.avg > 0 ? (spread / sec.avg) * 100 : 0;
          if (variancePct > 50) {
            timelineEvents.push({
              id: `var-${sec.name}`,
              type: "danger",
              title: `High Cost Volatility in ${sec.name.replace("Phase 1: ", "")}`,
              description: `This section has a ${Math.round(variancePct)}% cost spread ($${formatCurrency(sec.min)} to $${formatCurrency(sec.max)}). Enforce fixed-price bids to lock in the $${formatCurrency(sec.avg)} average estimate.`,
              icon: ShieldAlert,
              badge: `${Math.round(variancePct)}% spread`
            });
          }
        });

        phases.forEach((phase: any) => {
          const concentration = totalAvg > 0 ? (phase.avg / totalAvg) * 100 : 0;
          if (concentration > 15) {
            timelineEvents.push({
              id: `conc-${phase.label}`,
              type: "warning",
              title: `High Budget Concentration: ${phase.label}`,
              description: `${phase.label} represents ${Math.round(concentration)}% of your overall remodel average spend ($${formatCurrency(phase.avg)}). Any minor deviation here will heavily sway the bottom line.`,
              icon: Target,
              badge: `${Math.round(concentration)}% of total`
            });
          }
        });

        if (totalAvg > totalCap * 0.95 && totalAvg <= totalCap) {
          timelineEvents.push({
            id: "cap-warning",
            type: "warning",
            title: "Approaching Budget Ceiling",
            description: `Your active configuration average ($${formatCurrency(totalAvg)}) is within 5% of the $300,000 Phase 1 cap. You have only $${formatCurrency(totalCap - totalAvg)} in remaining buffer.`,
            icon: Flame,
            badge: "Critical Margin"
          });
        } else if (totalAvg > totalCap) {
          timelineEvents.push({
            id: "cap-danger",
            type: "danger",
            title: "Budget Ceiling Breached",
            description: `Current average remodel cost of $${formatCurrency(totalAvg)} exceeds the $300,000 Phase 1 cap by $${formatCurrency(totalAvg - totalCap)}. Action is required to prune add-ons or downscale layout options.`,
            icon: Flame,
            badge: "Over Cap"
          });
        }

        if (possibleSavings > 0 && mostEconomicalScenario) {
          timelineEvents.push({
            id: "opt-scenario",
            type: "success",
            title: "Optimized Kitchen Layout Available",
            description: `Switching to ${mostEconomicalScenario.label} (${mostEconomicalScenario.kitchenLocation}) would yield an immediate savings of $${formatCurrency(possibleSavings)} without any direct scope reduction.`,
            icon: Zap,
            badge: `Save $${Math.round(possibleSavings / 1000)}k`
          });
        }

        timelineEvents.push({
          id: "system-ok",
          type: "success",
          title: "Dynamic Variance Computations Synchronized",
          description: "Ledger intelligence is processing active selections via Cloudflare D1. Risk tolerances and volatility metrics are in high-fidelity synchronization.",
          icon: CheckCircle,
          badge: "Active"
        });

        const insightsChartConfig = {
          volatility: {
            label: "Volatility Score",
            color: "var(--color-emerald-500, #10b981)",
          },
          value: {
            label: "Cost Amount",
            color: "var(--color-emerald-500, #10b981)",
          },
          deviation: {
            label: "Deviation",
            color: "var(--color-emerald-500, #10b981)",
          }
        } satisfies ChartConfig;

        return (
          <div className="space-y-8 animate-fadeIn">
            {/* Row 1: KPI Overview Cards */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              
              {/* Card D — Risk Band Confidence Gauge */}
              <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Gauge className="h-5 w-5 text-emerald-500" />
                        Risk Band & Confidence Score
                      </h3>
                      <p className="text-xs text-zinc-400 mt-1">
                        Statistical confidence score based on the width of your min-max cost spread relative to the budget cap.
                      </p>
                    </div>
                    <div className={`px-4 py-2 border rounded-xl font-black text-center ${confidenceBg} ${confidenceBorder}`}>
                      <div className={`text-2xl ${confidenceColor}`}>{confidenceScore}%</div>
                      <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider mt-0.5">{confidenceRating}</div>
                    </div>
                  </div>

                  {/* SVG Bar Visual */}
                  <div className="mt-8 space-y-6">
                    <div className="relative pt-4 pb-2">
                      {/* Cap Line */}
                      <div 
                        className="absolute top-0 bottom-0 border-l border-dashed border-rose-500 z-10" 
                        style={{ left: `${pctCap}%` }}
                      >
                        <span className="absolute -top-4 -translate-x-1/2 text-[9px] font-bold text-rose-400 whitespace-nowrap bg-zinc-950 px-1.5 py-0.5 border border-rose-900/30 rounded">
                          Cap: $300k
                        </span>
                      </div>

                      {/* Bar Track */}
                      <div className="h-3.5 bg-zinc-800/80 rounded-full w-full relative overflow-hidden border border-zinc-700/50">
                        {/* Shaded Min-Max range bar */}
                        <div 
                          className="absolute top-0 bottom-0 bg-gradient-to-r from-emerald-500/20 to-emerald-400/40 rounded-full"
                          style={{ left: `${pctMin}%`, width: `${Math.max(2, pctMax - pctMin)}%` }}
                        />
                      </div>

                      {/* Min Marker */}
                      <div className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${pctMin}%` }}>
                        <div className="h-4 w-1 bg-zinc-300 rounded" />
                        <span className="text-[10px] font-extrabold text-zinc-400 mt-1 whitespace-nowrap">
                          Min: ${Math.round(totalMin / 1000)}k
                        </span>
                      </div>

                      {/* Max Marker */}
                      <div className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${pctMax}%` }}>
                        <div className="h-4 w-1 bg-zinc-350 rounded" />
                        <span className="text-[10px] font-extrabold text-zinc-400 mt-1 whitespace-nowrap">
                          Max: ${Math.round(totalMax / 1000)}k
                        </span>
                      </div>

                      {/* Avg Marker (Highlight) */}
                      <div className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center z-20" style={{ left: `${pctAvg}%` }}>
                        <div className="h-5 w-5 bg-emerald-500 border-2 border-white rounded-full flex items-center justify-center shadow-lg -translate-y-0.5 transform -translate-x-1/2">
                          <DollarSign className="h-3 w-3 text-zinc-950 stroke-[3]" />
                        </div>
                        <span className="text-[11px] font-black text-white mt-1 whitespace-nowrap bg-zinc-900 border border-zinc-700 px-1 rounded transform -translate-x-1/2">
                          Avg: ${Math.round(totalAvg / 1000)}k
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-zinc-800/60 mt-8 flex gap-3 items-start">
                  <Info className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Your remodel estimate band spans <strong className="text-white">${Math.round(riskSpread / 1000)}k</strong>. 
                    {confidenceScore >= 80 
                      ? " Your active configuration exhibits high cost certainty, minimizing variance exposure." 
                      : " Tightening layout specifications or opting for fixed bids could reduce this risk band by up to $15,000."
                    }
                  </p>
                </div>
              </div>

              {/* Card A — Cost Volatility Radar */}
              <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <RadarIcon className="h-5 w-5 text-emerald-500" />
                    Highest Volatility Risk Radar
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Visual fingerprinting of which rooms and phases carry the highest cost uncertainty.
                  </p>

                  <div className="mt-4 flex items-center justify-center">
                    <ChartContainer
                      config={insightsChartConfig}
                      className="w-full aspect-square max-h-[220px]"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                          <PolarGrid stroke="oklch(0.274 0 0)" />
                          <PolarAngleAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 9, fontWeight: 'semibold' }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 8 }} />
                          <Radar name="Volatility Score" dataKey="volatility" stroke="#10b981" fill="#10b981" fillOpacity={0.25} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                return (
                                  <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded-lg shadow-xl text-xs space-y-1">
                                    <p className="font-bold text-white">{data.name}</p>
                                    <p className="text-emerald-400 font-bold">Volatility: {data.volatility}%</p>
                                    <p className="text-zinc-400">Spread: ${formatCurrency(data.min)} - ${formatCurrency(data.max)}</p>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800/60 mt-4 flex gap-3 items-start">
                  <Info className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Highest cost uncertainty resides in <strong className="text-white">{highestVolatilitySection.name}</strong> with a <strong className="text-emerald-400">{highestVolatilitySection.volatility}%</strong> variance spread. Prioritize fixed labor quotes in this sector.
                  </p>
                </div>
              </div>

            </div>

            {/* Row 2: Deep Dives (Waterfall & What-If) */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              
              {/* Card B — Waterfall Cost Build-up */}
              <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-emerald-500" />
                    Waterfall Cost Build-up
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Cumulative cost build-up showing exactly how each construction phase stacks toward the overall remodel total.
                  </p>

                  <div className="mt-6 aspect-video max-h-[250px] w-full">
                    <ChartContainer
                      config={insightsChartConfig}
                      className="w-full h-full"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={waterfallData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.2 0 0)" />
                          <XAxis dataKey="name" stroke="#a1a1aa" fontSize={8} tickLine={false} tickFormatter={(val) => val.slice(0, 10)} />
                          <YAxis stroke="#a1a1aa" fontSize={9} tickLine={false} tickFormatter={(val) => `$${Math.round(val / 1000)}k`} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                return (
                                  <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg shadow-xl space-y-1">
                                    <p className="text-xs font-bold text-white">{data.name}</p>
                                    <p className="text-xs text-zinc-400">
                                      Phase Cost: <span className="font-bold text-emerald-400">{formatCurrency(data.value)}</span>
                                    </p>
                                    <p className="text-xs text-zinc-400">
                                      Running Total: <span className="font-bold text-white">{formatCurrency(data.cumulative)}</span>
                                    </p>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <ReferenceLine y={300000} stroke="#f43f5e" strokeDasharray="3 3" label={{ value: 'Cap $300k', position: 'top', fill: '#f43f5e', fontSize: 9, fontWeight: 'bold' }} />
                          {/* Invisible bar to shift value bar off baseline (waterfall effect) */}
                          <Bar dataKey="start" stackId="a" fill="transparent" />
                          <Bar dataKey="value" stackId="a" radius={[3, 3, 0, 0]}>
                            {waterfallData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800/60 mt-4 flex gap-3 items-start">
                  <Info className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Waterfall builds to a final cumulative realistic average of <strong className="text-white">${Math.round(totalAvg / 1000)}k</strong>. Color changes to <span className="text-amber-400 font-bold">Amber</span> on phases that cross the $300k threshold.
                  </p>
                </div>
              </div>

              {/* Card C — Scenario What-If Comparison */}
              <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Sliders className="h-5 w-5 text-emerald-500" />
                    Scenario What-If Comparator
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Compare kitchen layout cost deviations side-by-side. The active scenario is highlighted in emerald.
                  </p>

                  <div className="mt-6 aspect-video max-h-[250px] w-full">
                    <ChartContainer
                      config={insightsChartConfig}
                      className="w-full h-full"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={scenarioData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.2 0 0)" />
                          <XAxis dataKey="name" stroke="#a1a1aa" fontSize={9} tickLine={false} />
                          <YAxis stroke="#a1a1aa" fontSize={9} tickLine={false} tickFormatter={(val) => `$${Math.round(val / 1000)}k`} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                return (
                                  <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg shadow-xl text-xs space-y-1">
                                    <p className="font-bold text-white">{data.name}</p>
                                    <p className="text-zinc-400">Location: {data.location}</p>
                                    <p className="text-emerald-400 font-bold">Deviation Cost: {formatCurrency(data.deviation)}</p>
                                    {data.active && <p className="text-[10px] text-emerald-500 font-extrabold uppercase mt-1">★ Active Layout</p>}
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Bar dataKey="deviation" radius={[3, 3, 0, 0]}>
                            {scenarioData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.active ? '#10b981' : '#52525b'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800/60 mt-4 flex gap-3 items-start">
                  <Info className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {possibleSavings > 0 
                      ? `Switching to the most economical option (${mostEconomicalScenario.label}) could save up to `
                      : "You have currently activated the most economical option. "
                    }
                    {possibleSavings > 0 && <strong className="text-emerald-400">{formatCurrency(possibleSavings)}</strong>} 
                    {possibleSavings > 0 && " compared to your current selection."}
                  </p>
                </div>
              </div>

            </div>

            {/* Row 3: AI Narrative Timeline */}
            <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-500" />
                AI Anomaly & Cost Narrative Timeline
              </h3>
              <p className="text-xs text-zinc-400 mt-1 pb-6 border-b border-zinc-850">
                Real-time anomaly scanner highlighting budget risks, cost concentrations, and actionable savings opportunities.
              </p>

              <div className="mt-8 relative border-l border-zinc-800 ml-4 pl-6 space-y-6">
                {timelineEvents.map((event) => {
                  const Icon = event.icon;
                  let badgeColor = "bg-zinc-800 text-zinc-300 border-zinc-700";
                  let dotColor = "bg-zinc-900 border-zinc-800 text-zinc-400";
                  if (event.type === "danger") {
                    badgeColor = "bg-rose-950/40 text-rose-400 border-rose-900/30";
                    dotColor = "bg-rose-950 border-rose-500 text-rose-400";
                  } else if (event.type === "warning") {
                    badgeColor = "bg-amber-950/40 text-amber-400 border-amber-900/30";
                    dotColor = "bg-amber-950 border-amber-500 text-amber-400";
                  } else if (event.type === "success") {
                    badgeColor = "bg-emerald-950/40 text-emerald-400 border-emerald-900/30";
                    dotColor = "bg-emerald-950 border-emerald-500 text-emerald-400";
                  }
                  
                  return (
                    <div key={event.id} className="relative group transition-all">
                      {/* Dot */}
                      <div className={`absolute -left-10 top-1.5 h-7 w-7 rounded-full border flex items-center justify-center ${dotColor} transition-transform group-hover:scale-110 shadow-lg`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h4 className="text-sm font-bold text-white leading-none">{event.title}</h4>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${badgeColor}`}>
                            {event.badge}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed pt-1.5">
                          {event.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        );
      })()}

      {activeTab === "analytics" && (
        <div className="space-y-8 animate-fadeIn">
          {/* Header Description */}
          <div className="flex flex-col gap-2 bg-zinc-950/20 p-6 rounded-2xl border border-zinc-800/40">
            <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
              <BarChart3 className="h-5.5 w-5.5 text-emerald-500" />
              Regional Market Intelligence & Budget Flow
            </h2>
            <p className="text-xs text-zinc-400 max-w-3xl leading-relaxed">
              Analyze real-time bid events, project densities, and budget flow mechanics across the San Francisco Bay Area. 
              Use the geographic clusters to identify competitive pricing or hover over flow lines to see materials configurations.
            </p>
          </div>

          {/* Grid Layout: Map & Stats */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* MapCN section - 2 columns */}
            <div className="lg:col-span-2 bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col h-[520px]">
              <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                <div>
                  <h3 className="text-base font-bold text-white">Geographic Construction Clusters</h3>
                  <p className="text-[11px] text-zinc-500">Bay Area competitive bidding densities</p>
                </div>
                
                {/* Map Filter Controls */}
                <div className="flex gap-1.5 flex-wrap">
                  {["All", "Kitchen", "Bathroom", "Drywall", "HVAC"].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setMapFilter(cat)}
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${
                        mapFilter === cat
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-zinc-900/30 text-zinc-400 border-zinc-800 hover:text-zinc-200"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Map Canvas */}
              <div className="flex-1 w-full min-h-[350px] relative rounded-xl overflow-hidden border border-zinc-850">
                {mapData ? (
                  <Map
                    initialViewState={{
                      longitude: -122.25,
                      latitude: 37.75,
                      zoom: 9.2,
                    }}
                    className="w-full h-full"
                    theme="dark"
                  >
                    <MapClusterLayer
                      data={{
                        type: "FeatureCollection",
                        features: mapData.features.filter((f: any) => 
                          mapFilter === "All" || f.properties.category === mapFilter
                        )
                      }}
                      pointColor="#10b981"
                      clusterColors={["#059669", "#047857", "#065f46"]}
                      onPointClick={(prop: any) => {
                        if (prop && prop.properties) {
                          setSelectedMapPoint(prop.properties);
                        }
                      }}
                    />
                    <MapControls showZoom={true} />
                  </Map>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/40 backdrop-blur-xs">
                    <div className="flex flex-col items-center gap-2.5">
                      <span className="h-6 w-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                      <span className="text-xs text-zinc-500 font-medium">Resolving Map Clusters...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Selected Job Card & Metrics - 1 column */}
            <div className="flex flex-col gap-6">
              {/* Selected Job Card */}
              <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex-1 flex flex-col justify-between min-h-[220px]">
                {selectedMapPoint ? (
                  <div className="space-y-4 h-full flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex justify-between items-start gap-3">
                        <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                          {selectedMapPoint.category}
                        </span>
                        <button 
                          onClick={() => setSelectedMapPoint(null)}
                          className="text-zinc-500 hover:text-zinc-300 text-xs"
                        >
                          ✕ Clear
                        </button>
                      </div>
                      <h4 className="text-base font-bold text-white leading-snug">{selectedMapPoint.title}</h4>
                      <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                        📍 Region: <span className="text-zinc-300 font-semibold">{selectedMapPoint.region}</span>
                      </p>
                      <div className="pt-2">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Keywords & Tags</div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {Array.isArray(selectedMapPoint.keywords) && selectedMapPoint.keywords.map((kw: string) => (
                            <span key={kw} className="text-[9px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-zinc-700">
                              #{kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-zinc-850 mt-auto">
                      <div className="text-[10px] text-zinc-500 font-bold uppercase">Estimated Bid Amount</div>
                      <div className="text-2xl font-bold text-emerald-400 tracking-tight mt-0.5">
                        ${selectedMapPoint.bidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4">
                    <Database className="h-8 w-8 text-zinc-600 mb-2.5 animate-pulse" />
                    <h4 className="text-sm font-bold text-zinc-400">No Job Selected</h4>
                    <p className="text-[11px] text-zinc-500 max-w-[200px] leading-relaxed mt-1">
                      Click any point or cluster on the map to inspect project specifications and cost estimates.
                    </p>
                  </div>
                )}
              </div>

              {/* Dynamic Variance Stats Card */}
              <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Activity className="h-4.5 w-4.5 text-emerald-500" />
                    Market Competitiveness
                  </h3>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Bay Area construction density index
                  </p>
                  
                  <div className="mt-4 space-y-3">
                    <div className="flex justify-between items-center border-b border-zinc-850 pb-2">
                      <span className="text-[11px] text-zinc-400">Total Bids Analyzed</span>
                      <span className="text-xs font-bold text-white">{mapData?.features?.length || 0}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-zinc-850 pb-2">
                      <span className="text-[11px] text-zinc-400">Average Bid Price</span>
                      <span className="text-xs font-bold text-emerald-400">
                        ${mapData?.features?.length 
                          ? Math.round(mapData.features.reduce((acc: number, f: any) => acc + f.properties.bidAmount, 0) / mapData.features.length).toLocaleString()
                          : "0"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-zinc-400">Highest Bid Value</span>
                      <span className="text-xs font-bold text-white">
                        ${mapData?.features?.length 
                          ? Math.max(...mapData.features.map((f: any) => f.properties.bidAmount)).toLocaleString()
                          : "0"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Real-time streaming line chart & Sankey Flow Row */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Live streaming Line Chart */}
            <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col h-[380px]">
              <div>
                <div className="flex justify-between items-center gap-3">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Wifi className="h-4.5 w-4.5 text-emerald-500 animate-pulse" />
                    Live Bidding Feed
                  </h3>
                  <span className="text-[9px] bg-red-950/40 text-rose-400 border border-rose-900/30 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
                    Streaming
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Real-time incoming Bay Area residential remodeling estimates
                </p>
              </div>

              {/* Chart container */}
              <div className="flex-1 w-full mt-4 min-h-[220px]">
                {liveData.length > 0 ? (
                  <LiveLineChart
                    data={liveData}
                    xKey="time"
                    yKey="value"
                    className="w-full h-full min-h-[220px]"
                  >
                    <LiveXAxis 
                      stroke="oklch(0.4 0 0)"
                      fontSize={9}
                      tickFormatter={(val: number) => {
                        const date = new Date(val * 1000);
                        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                      }}
                    />
                    <LiveYAxis 
                      stroke="oklch(0.4 0 0)"
                      fontSize={9}
                      tickFormatter={(val: number) => `$${Math.round(val / 1000)}k`}
                    />
                    <LiveLine
                      dataKey="value"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dotColor="#10b981"
                    />
                    <LiveChartTooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          const formattedTime = new Date(data.time * 1000).toLocaleTimeString();
                          return (
                            <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg shadow-xl text-xs space-y-1">
                              <p className="text-zinc-500 font-semibold">{formattedTime}</p>
                              <p className="text-white font-bold">
                                Bid: <span className="text-emerald-400">${data.value.toLocaleString()}</span>
                              </p>
                              <p className="text-zinc-400 text-[10px]">
                                Region: {data.region || "N/A"}
                              </p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </LiveLineChart>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-xs text-zinc-500">Connecting to Pipeline Feed...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Sankey Flow Chart */}
            <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 flex flex-col h-[380px]">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers className="h-4.5 w-4.5 text-emerald-500" />
                  Budget Distribution Flow
                </h3>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Volume mapping: Remodel Category → Bay Area Region → Scope Keyword
                </p>
              </div>

              {/* Chart container */}
              <div className="flex-1 w-full mt-4 min-h-[220px] overflow-hidden">
                {sankeyData ? (
                  <SankeyChart
                    data={sankeyData}
                    className="w-full h-full min-h-[220px]"
                    nodePadding={12}
                    nodeWidth={10}
                  >
                    <SankeyNode 
                      fill="#10b981"
                      textColor="#ffffff"
                      fontSize={8}
                    />
                    <SankeyLink 
                      fill="rgba(16, 185, 129, 0.15)"
                      stroke="rgba(16, 185, 129, 0.25)"
                    />
                    <SankeyTooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          if (data.source !== undefined && data.target !== undefined) {
                            return (
                              <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded shadow-lg text-[10px]">
                                <span className="text-zinc-500 font-bold uppercase block">Flow Path</span>
                                <span className="text-white block font-semibold">
                                  {sankeyData.nodes[data.source].name} ➜ {sankeyData.nodes[data.target].name}
                                </span>
                                <span className="text-emerald-400 block font-bold mt-1">
                                  Volume: ${data.value.toLocaleString()}
                                </span>
                              </div>
                            );
                          } else {
                            return (
                              <div className="bg-zinc-950 border border-zinc-800 p-2.5 rounded shadow-lg text-[10px]">
                                <span className="text-zinc-500 font-bold uppercase block">Sankey Node</span>
                                <span className="text-white block font-semibold">{data.name}</span>
                                <span className="text-emerald-400 block font-bold mt-1">
                                  Total: ${data.value.toLocaleString()}
                                </span>
                              </div>
                            );
                          }
                        }
                        return null;
                      }}
                    />
                  </SankeyChart>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-xs text-zinc-500">Mapping Budget Flow Nodes...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
    </div>
  );
}

function BudgetAssistantPanel({ onApplied }: { onApplied: () => void | Promise<void> }) {
  const agent = useAgent({
    agent: "BudgetAgent",
    name: "budget-dashboard",
  });

  const chat = useAgentChat({
    agent,
  });

  const runtime = useExternalStoreRuntime({
    isRunning: chat.status === "streaming" || chat.status === "submitted",
    messages: chat.messages,
    convertMessage: (message: any) => ({
      id: message.id,
      role: message.role,
      content: [{ type: "text", text: message.content }],
    }),
    onNew: async (message) => {
      if (message.content[0]?.type === "text") {
        await chat.append({
          role: "user",
          content: message.content[0].text,
        });
      }
    },
  });

  return (
    <div className="fixed right-6 bottom-6 z-50">
      <AssistantRuntimeProvider runtime={runtime}>
        <AssistantModalPrimitive.Root>
          <AssistantModalPrimitive.Anchor />
          <AssistantModalPrimitive.Trigger asChild>
            <button className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-950 text-emerald-400 border border-zinc-800 shadow-2xl hover:scale-105 hover:bg-zinc-900 transition-all duration-300 cursor-pointer">
              <Bot className="h-6 w-6" />
            </button>
          </AssistantModalPrimitive.Trigger>
          <AssistantModalPrimitive.Content
            side="top"
            align="end"
            sideOffset={16}
            className="w-[380px] sm:w-[420px] rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-50 shadow-2xl p-0 overflow-hidden flex flex-col"
          >
            <div className="flex flex-col gap-3 border-b border-zinc-800 px-4 py-3 bg-zinc-950">
              <div className="flex min-w-0 items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/40 p-2 text-emerald-300">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-white">Budget Agent</h2>
                    <p className="truncate text-xs text-zinc-400">Ask for scenario changes, savings levers, and cap checks.</p>
                  </div>
                </div>
                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                  approval gated
                </span>
              </div>
            </div>
            <BudgetAssistantThread onApplied={onApplied} />
          </AssistantModalPrimitive.Content>
        </AssistantModalPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}

function BudgetAssistantThread({ onApplied }: { onApplied: () => void | Promise<void> }) {
  return (
    <ThreadPrimitive.Root className="grid min-h-[420px] grid-rows-[1fr_auto]">
      <ThreadPrimitive.Viewport className="max-h-[70vh] sm:max-h-[500px] min-h-[200px] overflow-y-auto px-3 py-4 sm:px-4">
        <ThreadPrimitive.Empty>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              "Can we get under cap?",
              "Switch kitchen Scenario D",
              "Add steam shower",
            ].map((suggestion) => (
              <ThreadPrimitive.Suggestion
                key={suggestion}
                prompt={suggestion}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs font-semibold text-zinc-300 transition hover:border-emerald-700 hover:text-white"
              >
                {suggestion}
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages
          components={{
            UserMessage: BudgetUserMessage,
            AssistantMessage: () => <BudgetAssistantMessage onApplied={onApplied} />,
          }}
        />
      </ThreadPrimitive.Viewport>

      <ThreadPrimitive.ViewportFooter className="border-t border-zinc-800 bg-zinc-950/80 p-3">
        <ComposerPrimitive.Root className="flex items-end gap-2">
          <ComposerPrimitive.Input
            placeholder="Ask the agent to analyze or propose a budget change..."
            className="min-h-11 flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-700"
          />
          <ComposerPrimitive.Send className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
            <Send className="h-4 w-4" />
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Root>
  );
}

function BudgetUserMessage() {
  return (
    <MessagePrimitive.Root className="mb-4 flex justify-end">
      <div className="max-w-[92%] rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium leading-6 text-zinc-950 sm:max-w-[78%]">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function BudgetAssistantMessage({ onApplied }: { onApplied: () => void | Promise<void> }) {
  const content = useAuiState((s) => s.message.content ?? []);
  const proposals = content
    .filter((part: any) => part?.type === "data" && part.name === "budget_proposals")
    .map((part: any) => part.data as BudgetProposal);

  return (
    <MessagePrimitive.Root className="mb-4">
      <div className="max-w-[96%] rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-6 text-zinc-200 sm:max-w-[82%]">
        <MessagePrimitive.Content
          components={{
            data: {
              by_name: {
                budget_proposals: () => null,
              },
            },
          }}
        />
        {proposals.length > 0 && <BudgetProposalActions proposals={proposals} onApplied={onApplied} />}
      </div>
    </MessagePrimitive.Root>
  );
}

function BudgetProposalActions({
  proposals,
  onApplied,
}: {
  proposals: BudgetProposal[];
  onApplied: () => void | Promise<void>;
}) {
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const visibleProposals = proposals.filter((proposal) => !dismissed[proposal.id]);

  if (visibleProposals.length === 0) return null;

  const approve = async (proposal: BudgetProposal) => {
    setApplyingId(proposal.id);
    try {
      const response = await fetch("/api/budget-agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ proposal }),
      });

      if (!response.ok) throw new Error("Approval failed");
      const result = await response.json() as { message?: string };
      toast.success(result.message || "Budget updated");
      await onApplied();
      setDismissed((current) => ({ ...current, [proposal.id]: true }));
    } catch (error) {
      console.error(error);
      toast.error("Failed to apply budget approval");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
      {visibleProposals.map((proposal) => (
        <div key={proposal.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-bold text-white">{proposal.label}</p>
              <p className="text-xs leading-5 text-zinc-400">{proposal.description}</p>
              <p className="text-[11px] leading-5 text-emerald-300">{proposal.estimatedImpact}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => approve(proposal)}
                disabled={applyingId === proposal.id}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => setDismissed((current) => ({ ...current, [proposal.id]: true }))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 transition hover:text-white"
                aria-label="Dismiss proposal"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
