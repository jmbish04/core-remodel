import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  serif = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  serif?: boolean;
}) {
  return (
    <div className="pt-10 pb-6">
      <div className="flex items-end justify-between gap-8 flex-wrap">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && (
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500 mb-3">
              {eyebrow}
            </div>
          )}
          <h1
            className={`text-3xl md:text-4xl font-semibold tracking-tight text-zinc-50 ${serif ? "font-serif" : ""}`}
            style={
              serif
                ? {
                    fontFamily: '"Newsreader", ui-serif, Georgia, serif',
                    fontWeight: 500,
                  }
                : undefined
            }
          >
            {title}
          </h1>
          {description && (
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}

const CHIP_TONES = {
  zinc: "bg-zinc-800/60 text-zinc-300",
  emerald: "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20",
  amber: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/20",
  rose: "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/20",
  sky: "bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20",
  violet: "bg-violet-400/10 text-violet-300 ring-1 ring-violet-400/20",
  outline: "ring-1 ring-zinc-800 text-zinc-400",
} as const;

export type ChipTone = keyof typeof CHIP_TONES;

export function Chip({
  tone = "zinc",
  children,
  className = "",
  icon: Icon,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide ${CHIP_TONES[tone]} ${className}`}
    >
      {Icon && <Icon size={11} />}
      {children}
    </span>
  );
}

export function SectionTitle({
  children,
  className = "",
  trailing,
}: {
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">
        {children}
      </h3>
      {trailing}
    </div>
  );
}

export function MonolithCard({
  children,
  className = "",
  padding = "p-6",
}: {
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 ${padding} transition-all duration-300 hover:ring-zinc-700/80 ${className}`}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-zinc-900/80 rounded-md animate-pulse ${className}`} />
  );
}

export function ErrorBanner({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl bg-rose-950/40 ring-1 ring-rose-500/30 text-rose-200 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-rose-300 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-rose-100">{title}</div>
          {message && (
            <div className="mt-1 text-sm text-rose-300/90">{message}</div>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-medium uppercase tracking-wider text-rose-200 hover:text-rose-100 px-3 py-1.5 rounded-md ring-1 ring-rose-500/40 hover:bg-rose-500/10 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 py-20 px-8 grid place-items-center">
      <div className="max-w-sm text-center flex flex-col items-center">
        <Icon size={48} className="text-zinc-700 mb-6" strokeWidth={1.25} />
        <div className="text-base font-medium text-zinc-200">{title}</div>
        {description && (
          <div className="mt-2 text-sm text-zinc-500 leading-relaxed">
            {description}
          </div>
        )}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}

export function ConfidenceBar({
  value,
  className = "",
  showLabel = true,
}: {
  value: number;
  className?: string;
  showLabel?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tone =
    value >= 0.8
      ? "bg-emerald-400"
      : value >= 0.6
        ? "bg-amber-400"
        : "bg-rose-400";
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${tone}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="font-mono tabular-nums text-[11px] text-zinc-500">
          {Math.round(pct)}
        </span>
      )}
    </div>
  );
}

export function KPI({
  label,
  value,
  hint,
  delta,
  sparkline,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: number;
  sparkline?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-5 transition-all duration-300 hover:ring-zinc-700/80">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-2xl font-mono tabular-nums text-zinc-50 font-medium">
          {value}
        </div>
        {sparkline && <div className="opacity-80">{sparkline}</div>}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta !== undefined && (
          <span
            className={`font-mono tabular-nums ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-zinc-500"}`}
          >
            {delta > 0 ? "+" : ""}
            {delta}
          </span>
        )}
        {hint && <span className="text-zinc-500">{hint}</span>}
      </div>
    </div>
  );
}

export function Sparkline({
  data,
  color = "#a1a1aa",
  width = 80,
  height = 28,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data || !data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1 || 1);
  const points = data
    .map((v, i) => `${i * step},${height - ((v - min) / span) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
