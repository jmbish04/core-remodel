export function fmtCents(
  c: number | null | undefined,
  { decimals = 0, sign = false }: { decimals?: number; sign?: boolean } = {},
): string {
  if (c === null || c === undefined || Number.isNaN(c)) return "—";
  const v = c / 100;
  const abs = Math.abs(v);
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = sign ? (v < 0 ? "−" : "+") : v < 0 ? "−" : "";
  return `${prefix}$${s}`;
}

export function fmtPct(
  p: number | null | undefined,
  { decimals = 0, sign = false }: { decimals?: number; sign?: boolean } = {},
): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  const v = p * 100;
  const s = Math.abs(v).toFixed(decimals);
  const prefix = sign ? (v < 0 ? "−" : "+") : v < 0 ? "−" : "";
  return `${prefix}${s}%`;
}

export function fmtNum(
  n: number | null | undefined,
  opts: Intl.NumberFormatOptions = {},
): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", opts);
}

export function dollarsToCents(s: string | number): number {
  if (typeof s === "number") return Math.round(s * 100);
  const cleaned = s.replace(/[$,\s]/g, "");
  const v = Number.parseFloat(cleaned);
  return Number.isNaN(v) ? 0 : Math.round(v * 100);
}

export const TRADE_LABEL: Record<string, string> = {
  demo: "Demo",
  framing: "Framing",
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "HVAC",
  flooring: "Flooring",
  finish_carpentry: "Finish carp.",
  tile: "Tile",
  paint: "Paint",
  drywall: "Drywall",
  cabinetry: "Cabinetry",
  counters: "Counters",
  appliances: "Appliances",
  exterior: "Exterior",
  sitework: "Sitework",
  permits: "Permits",
};

export const TRADE_TONE: Record<string, string> = {
  demo: "zinc",
  framing: "amber",
  plumbing: "sky",
  electrical: "violet",
  hvac: "emerald",
  flooring: "rose",
  finish_carpentry: "amber",
  tile: "sky",
  paint: "violet",
  drywall: "zinc",
  cabinetry: "amber",
  counters: "rose",
  appliances: "zinc",
  exterior: "emerald",
  sitework: "zinc",
  permits: "sky",
};

export const PHASE_LABEL: Record<string, string> = {
  pre_construction: "Pre-con",
  rough: "Rough",
  finish: "Finish",
  punch: "Punch",
};

export const UNIT_LABEL: Record<string, string> = {
  sf: "/sf",
  lf: "/lf",
  ea: "/ea",
  hr: "/hr",
  ls: "/ls",
  day: "/day",
};

export const SOURCE_LABEL: Record<string, { label: string; icon: string }> = {
  manual: { label: "Manual", icon: "pencil" },
  insurance: { label: "Insurance", icon: "scale" },
  rsmeans: { label: "RSMeans", icon: "database" },
  ai_inferred: { label: "AI inferred", icon: "sparkles" },
  bid_observed: { label: "Bid obs.", icon: "file-text" },
};
