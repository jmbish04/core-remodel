// Shared UI primitives for The Monolith.
// Strict adherence to the no-borders rule + zinc dark palette.

const { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;

// ---------- Money / number formatting ----------
function fmtCents(c, { decimals = 0, sign = false } = {}) {
  if (c === null || c === undefined || Number.isNaN(c)) return "—";
  const v = c / 100;
  const abs = Math.abs(v);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const prefix = sign ? (v < 0 ? "−" : "+") : (v < 0 ? "−" : "");
  return `${prefix}$${s}`;
}
function fmtPct(p, { decimals = 0, sign = false } = {}) {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  const v = p * 100;
  const s = Math.abs(v).toFixed(decimals);
  const prefix = sign ? (v < 0 ? "−" : "+") : (v < 0 ? "−" : "");
  return `${prefix}${s}%`;
}
function fmtNum(n, opts = {}) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", opts);
}

// ---------- AnimatedNumber: roll-up digit animation ----------
function AnimatedNumber({ value, format = fmtNum, duration = 420, className = "" }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);
    const tick = (t) => {
      const elapsed = t - startRef.current;
      const k = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplay(next);
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <span className={`font-mono tabular-nums ${className}`}>{format(Math.round(display))}</span>;
}

// ---------- Navbar ----------
function Navbar({ active, surface }) {
  const links = [
    { id: "truth-table", label: "Truth Table", href: "01-truth-table.html" },
    { id: "bid-analyzer", label: "Bid Analyzer", href: "02-bid-analyzer.html" },
    { id: "materials", label: "Materials", href: "03-material-cart.html" },
    { id: "scenarios", label: "Scenarios", href: "04-scenario-builder.html" },
    { id: "portal", label: "Portal", href: "05-contractor-portal.html" },
  ];
  return (
    <header className="sticky top-0 z-30 bg-zinc-950 border-b border-zinc-800">
      <div className="mx-auto max-w-[1400px] flex items-center justify-between px-6 h-14">
        <div className="flex items-center gap-8">
          <a href="index.html" className="font-mono text-[15px] tracking-tighter text-zinc-100 hover:text-white">
            <span className="text-zinc-500">/</span>the_monolith
          </a>
          {surface && (
            <div className="hidden md:flex items-center gap-2 text-xs text-zinc-500">
              <Icon name="chevron-right" size={12} className="text-zinc-700"/>
              <span className="uppercase tracking-[0.18em]">{surface}</span>
            </div>
          )}
        </div>
        <nav className="hidden md:flex items-center gap-1">
          {links.map(l => (
            <a key={l.id} href={l.href}
               className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                 active === l.id
                   ? "text-zinc-100 bg-zinc-900"
                   : "text-zinc-400 hover:text-zinc-100"
               }`}>{l.label}</a>
          ))}
          <div className="w-px h-5 bg-zinc-800 mx-2"></div>
          <button className="size-8 grid place-items-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <Icon name="bell" size={16}/>
          </button>
          <button className="size-8 grid place-items-center rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <Icon name="user" size={16}/>
          </button>
        </nav>
        <button className="md:hidden size-8 grid place-items-center rounded-md text-zinc-300">
          <Icon name="menu" size={18}/>
        </button>
      </div>
    </header>
  );
}

// ---------- PageHeader ----------
function PageHeader({ eyebrow, title, description, actions, serif }) {
  return (
    <div className="pt-10 pb-6">
      <div className="flex items-end justify-between gap-8 flex-wrap">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && (
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500 mb-3">{eyebrow}</div>
          )}
          <h1 className={`text-3xl md:text-4xl font-semibold tracking-tight text-zinc-50 ${serif ? "font-serif" : ""}`}
              style={serif ? { fontFamily: '"Newsreader", ui-serif, Georgia, serif', fontWeight: 500 } : undefined}>
            {title}
          </h1>
          {description && (
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

// ---------- Buttons ----------
function Button({ variant = "primary", size = "md", icon, iconRight, children, className = "", ...props }) {
  const sizes = {
    sm: "h-8 px-3 text-xs gap-1.5",
    md: "h-9 px-3.5 text-sm gap-2",
    lg: "h-10 px-4 text-sm gap-2",
    icon: "size-9 grid place-items-center",
  };
  const variants = {
    primary: "bg-zinc-100 text-zinc-950 hover:bg-white",
    secondary: "bg-zinc-900 text-zinc-100 ring-1 ring-zinc-800 hover:ring-zinc-700 hover:bg-zinc-850",
    ghost: "text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900",
    danger: "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/15",
    accent: "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-400/15",
  };
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 15}/>}
      <span>{children}</span>
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 14 : 15}/>}
    </button>
  );
}

// ---------- Card ----------
function Card({ children, className = "", padding = "p-6" }) {
  return (
    <div className={`rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 ${padding} transition-all duration-300 hover:ring-zinc-700/80 ${className}`}>
      {children}
    </div>
  );
}

// ---------- Input ----------
function Input({ icon, className = "", ...props }) {
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {icon && <Icon name={icon} size={14} className="absolute left-3 text-zinc-500 pointer-events-none"/>}
      <input
        className={`h-9 ${icon ? "pl-9" : "pl-3"} pr-3 text-sm bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 rounded-md ring-1 ring-zinc-800 focus:ring-zinc-600 focus:outline-none w-full transition-all`}
        {...props}
      />
    </div>
  );
}

// ---------- Chip / Badge ----------
function Chip({ tone = "zinc", children, className = "", icon }) {
  const tones = {
    zinc: "bg-zinc-800/60 text-zinc-300",
    emerald: "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20",
    amber: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/20",
    rose: "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/20",
    sky: "bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20",
    violet: "bg-violet-400/10 text-violet-300 ring-1 ring-violet-400/20",
    outline: "ring-1 ring-zinc-800 text-zinc-400",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-wide ${tones[tone]} ${className}`}>
      {icon && <Icon name={icon} size={11}/>}
      {children}
    </span>
  );
}

// ---------- Section title (small uppercase eyebrow) ----------
function SectionTitle({ children, className = "", trailing }) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">{children}</h3>
      {trailing}
    </div>
  );
}

// ---------- Skeleton ----------
function Skeleton({ className = "" }) {
  return <div className={`bg-zinc-900/80 rounded-md animate-pulse ${className}`}></div>;
}

// ---------- ErrorBanner ----------
function ErrorBanner({ title = "Something went wrong", message, onRetry }) {
  return (
    <div className="rounded-xl bg-rose-950/40 ring-1 ring-rose-500/30 text-rose-200 p-4">
      <div className="flex items-start gap-3">
        <Icon name="alert-triangle" size={18} className="text-rose-300 mt-0.5"/>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-rose-100">{title}</div>
          {message && <div className="mt-1 text-sm text-rose-300/90">{message}</div>}
        </div>
        {onRetry && (
          <button onClick={onRetry} className="text-xs font-medium uppercase tracking-wider text-rose-200 hover:text-rose-100 px-3 py-1.5 rounded-md ring-1 ring-rose-500/40 hover:bg-rose-500/10 transition-colors flex items-center gap-1.5">
            <Icon name="refresh" size={12}/>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- EmptyState ----------
function EmptyState({ icon = "inbox", title, description, action }) {
  return (
    <div className="rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800/40 py-20 px-8 grid place-items-center">
      <div className="max-w-sm text-center flex flex-col items-center">
        <Icon name={icon} size={48} className="text-zinc-700 mb-6" strokeWidth={1.25}/>
        <div className="text-base font-medium text-zinc-200">{title}</div>
        {description && <div className="mt-2 text-sm text-zinc-500 leading-relaxed">{description}</div>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}

// ---------- StateLabel (the big separator between states) ----------
function StateLabel({ state, hint }) {
  const tones = {
    DATA: "text-emerald-400",
    EMPTY: "text-zinc-500",
    LOADING: "text-sky-400",
    ERROR: "text-rose-400",
    MOBILE: "text-violet-400",
  };
  return (
    <div className="mt-20 mb-6 flex items-baseline gap-3">
      <div className={`text-[10px] uppercase tracking-[0.32em] ${tones[state] || "text-zinc-500"}`}>State</div>
      <h2 className="text-xs uppercase tracking-[0.18em] text-zinc-300 font-medium">{state}</h2>
      {hint && <div className="text-xs text-zinc-600 ml-2">— {hint}</div>}
      <div className="flex-1 h-px bg-zinc-800/60 ml-4"></div>
    </div>
  );
}

// ---------- ConfidenceBar ----------
function ConfidenceBar({ value, className = "", showLabel = true }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tone = value >= 0.8 ? "bg-emerald-400" : value >= 0.6 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${pct}%` }}></div>
      </div>
      {showLabel && <span className="font-mono tabular-nums text-[11px] text-zinc-500">{Math.round(pct)}</span>}
    </div>
  );
}

// ---------- Tabs (with layoutId-style sliding indicator) ----------
function Tabs({ value, onChange, tabs, className = "" }) {
  const refs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0, opacity: 0 });
  useEffect(() => {
    const el = refs.current[value];
    if (el) {
      const r = el.getBoundingClientRect();
      const p = el.parentElement.getBoundingClientRect();
      setIndicator({ left: r.left - p.left, width: r.width, opacity: 1 });
    }
  }, [value]);
  return (
    <div className={`relative inline-flex items-center gap-1 ${className}`}>
      {tabs.map(t => (
        <button key={t.id}
          ref={el => refs.current[t.id] = el}
          onClick={() => onChange(t.id)}
          className={`relative z-10 px-3 py-1.5 text-sm rounded-md transition-colors ${value === t.id ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
          <span>{t.label}</span>
          {t.badge !== undefined && (
            <span className={`ml-2 font-mono tabular-nums text-[10px] ${value === t.id ? "text-zinc-400" : "text-zinc-600"}`}>{t.badge}</span>
          )}
        </button>
      ))}
      <div
        className="absolute top-0 h-full bg-zinc-900 rounded-md transition-all duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width, opacity: indicator.opacity }}
      />
    </div>
  );
}

// ---------- KPI ----------
function KPI({ label, value, delta, format = (v) => v, sparkline, hint }) {
  return (
    <div className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800/60 p-5 transition-all duration-300 hover:ring-zinc-700/80">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-2xl font-mono tabular-nums text-zinc-50 font-medium">{format(value)}</div>
        {sparkline && <div className="opacity-80">{sparkline}</div>}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta !== undefined && (
          <span className={`font-mono tabular-nums ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-zinc-500"}`}>
            {delta > 0 ? "+" : ""}{delta}
          </span>
        )}
        {hint && <span className="text-zinc-500">{hint}</span>}
      </div>
    </div>
  );
}

// ---------- Sparkline (mini) ----------
function Sparkline({ data, color = "#a1a1aa", width = 80, height = 28 }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1 || 1);
  const points = data.map((v, i) => `${i * step},${height - ((v - min) / span) * height}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ---------- Mobile frame (375px) ----------
function MobileFrame({ children, label = "iPhone 15 · 375" }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-600 mb-3 font-mono">{label}</div>
      <div className="w-[375px] bg-zinc-950 rounded-[28px] ring-1 ring-zinc-800/80 overflow-hidden">
        <div className="h-7 flex items-center justify-between px-6 text-[11px] font-medium text-zinc-300">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm bg-zinc-400"></div>
            <div className="w-3.5 h-2 rounded-sm bg-zinc-400"></div>
            <div className="w-5 h-2 rounded-sm ring-1 ring-zinc-400">
              <div className="h-full w-3/4 bg-zinc-400 rounded-sm"></div>
            </div>
          </div>
        </div>
        <div className="min-h-[700px] max-h-[820px] overflow-hidden bg-zinc-950">
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------- Tooltip-on-hover (simple) ----------
function HoverHint({ children, hint }) {
  return (
    <span className="relative inline-block group">
      {children}
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 whitespace-pre w-max max-w-xs text-[11px] text-zinc-300 bg-zinc-900 ring-1 ring-zinc-800 rounded-md px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {hint}
      </span>
    </span>
  );
}

// ---------- Trade colors (consistent across surfaces) ----------
const TRADE_TONE = {
  demo: "zinc",
  framing: "amber",
  plumbing: "sky",
  electrical: "violet",
  hvac: "emerald",
  flooring: "rose",
  finish_carpentry: "amber",
  tile: "sky",
  paint: "violet",
};
const TRADE_LABEL = {
  demo: "Demo", framing: "Framing", plumbing: "Plumbing", electrical: "Electrical",
  hvac: "HVAC", flooring: "Flooring", finish_carpentry: "Finish carp.", tile: "Tile", paint: "Paint",
};
const TRADE_HEX = {
  demo: "#a1a1aa", framing: "#fbbf24", plumbing: "#38bdf8", electrical: "#a78bfa",
  hvac: "#34d399", flooring: "#fb7185", finish_carpentry: "#fbbf24", tile: "#38bdf8", paint: "#a78bfa",
};

// ---------- Chart palette ----------
const CHART_COLORS = {
  c1: "oklch(0.72 0.18 145)", // emerald
  c2: "oklch(0.70 0.18 50)",  // amber
  c3: "oklch(0.68 0.20 25)",  // rose
  c4: "oklch(0.70 0.16 230)", // sky
  c5: "oklch(0.75 0.14 290)", // violet
};

// Expose
Object.assign(window, {
  fmtCents, fmtPct, fmtNum,
  AnimatedNumber, Navbar, PageHeader, Button, Card, Input, Chip, SectionTitle,
  Skeleton, ErrorBanner, EmptyState, StateLabel, ConfidenceBar, Tabs, KPI, Sparkline,
  MobileFrame, HoverHint,
  TRADE_TONE, TRADE_LABEL, TRADE_HEX, CHART_COLORS,
});
