/**
 * @fileoverview Visit Logs status/type/source chips (0032 V2c).
 *
 * Monolith status-pill convention (mirrors research-console JobBadges): a bare
 * <span> with a color-family /15 fill + /30 ring + a lucide icon. PENDING reads
 * amber, SUBMITTED emerald (design §9). SourceBadge maps the REAL gps_source
 * enum (tesla-* → "Tesla", device/phone → "Phone"), making provenance visible —
 * the point of running off many location sources.
 */
import {
  Calendar,
  CarFront,
  CircleDashed,
  Eye,
  Footprints,
  Hand,
  MapPin,
  Send,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

import {
  VISIT_STATUS_LABEL,
  VISIT_TYPE_LABEL,
  type GpsSource,
  type VisitStatus,
  type VisitType,
} from "./types";

type IconType = ComponentType<{ className?: string }>;

function Pill({
  icon: Icon,
  label,
  tone,
}: {
  icon: IconType;
  label: string;
  tone: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${tone}`}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

const STATUS_TONE: Record<VisitStatus, { icon: IconType; tone: string }> = {
  SUBMITTED: { icon: MapPin, tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  DRAFT: { icon: CircleDashed, tone: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  AI_STAGED: { icon: Sparkles, tone: "bg-violet-500/15 text-violet-300 ring-violet-500/30" },
  TESLA_SOFT_ARRIVAL: {
    icon: CarFront,
    tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  },
  TESLA_STAGED: { icon: CarFront, tone: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
};

/** Lifecycle chip: which stage of finalization the visit is at. */
export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  const s = STATUS_TONE[status] ?? STATUS_TONE.DRAFT;
  return <Pill icon={s.icon} label={VISIT_STATUS_LABEL[status] ?? status} tone={s.tone} />;
}

const TYPE_ICON: Record<VisitType, IconType> = {
  SOFT_ARRIVAL: MapPin,
  BROWSED_NO_CONTACT: Eye,
  BRIEF_NO_HELP: Footprints,
  FULL_SESSION: Users,
  APPOINTMENT: Calendar,
};

/** Engagement-depth chip (muted outline so it doesn't compete with status). */
export function VisitTypeChip({ visitType }: { visitType: VisitType }) {
  const Icon = TYPE_ICON[visitType] ?? MapPin;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-border/40">
      <Icon className="size-3" />
      {VISIT_TYPE_LABEL[visitType] ?? visitType}
    </span>
  );
}

function sourceMeta(source: GpsSource): { icon: IconType; label: string } {
  switch (source) {
    case "tesla-telemetry":
      return { icon: CarFront, label: "Tesla · telemetry" };
    case "tesla-poll":
      return { icon: CarFront, label: "Tesla · poll" };
    case "tesla-webhook":
      return { icon: CarFront, label: "Tesla · webhook" };
    case "device":
    case "phone":
      return { icon: Smartphone, label: "Phone" };
    case "ai":
      return { icon: Sparkles, label: "AI" };
    case "manual":
      return { icon: Hand, label: "Manual" };
    default:
      return { icon: Send, label: source };
  }
}

/** Provenance chip: which location source staged the fix. */
export function SourceBadge({ source }: { source: GpsSource | null | undefined }) {
  if (!source) return null;
  const { icon: Icon, label } = sourceMeta(source);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3" />
      {label}
    </span>
  );
}
