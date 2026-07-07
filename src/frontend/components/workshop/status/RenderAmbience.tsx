// ---------------------------------------------------------------------------
// RenderAmbience — the calm waiting-state texture for a rendering placeholder
// node. NEVER a spinner. A pure-CSS, dark, low-opacity ambient drift (a
// Monolith-tamed take on the §8 "ambient" family — chosen the CSS/canvas-free
// variant over the WebGL Light Rays / Circuit Board so it's cheap and stays out
// of the calm mood). Reduced-motion → a static shimmer skeleton, no drift.
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";

import { useReducedMotion } from "../hooks/useReducedMotion";

interface RenderAmbienceProps {
  className?: string;
}

// Self-contained keyframes so the component drops in without touching global
// CSS. transform/opacity only (Monolith motion rule). Reduced-motion variants
// carry no animation, so these never run for those users.
const AMBIENT_CSS = `
@keyframes workshop-ambient-drift-a {
  0% { transform: rotate(0deg) scale(1); }
  100% { transform: rotate(360deg) scale(1); }
}
@keyframes workshop-ambient-drift-b {
  0% { transform: rotate(360deg) scale(1.05); }
  100% { transform: rotate(0deg) scale(1.05); }
}
@keyframes workshop-ambient-sweep {
  0% { transform: translateX(0); opacity: 0; }
  40% { opacity: 1; }
  100% { transform: translateX(500%); opacity: 0; }
}
.workshop-ambient-drift-a { animation: workshop-ambient-drift-a 32s linear infinite; }
.workshop-ambient-drift-b { animation: workshop-ambient-drift-b 44s linear infinite; }
.workshop-ambient-sweep { animation: workshop-ambient-sweep 3.6s ease-in-out infinite; }
.workshop-ambient-static { transform: rotate(24deg); }
`;

export function RenderAmbience({ className }: RenderAmbienceProps) {
  const reduced = useReducedMotion();

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]",
        className,
      )}
    >
      <style>{AMBIENT_CSS}</style>
      {/* Base wash — a hair above pure black so the surface reads as "alive". */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_30%_20%,color-mix(in_oklab,var(--color-primary)_8%,transparent),transparent_60%)]" />

      {/* Two slow, offset conic drifts. Motion is transform/opacity only. */}
      <div
        className={cn(
          "absolute -inset-[40%] opacity-[0.10]",
          reduced ? "workshop-ambient-static" : "workshop-ambient-drift-a",
        )}
        style={{
          background:
            "conic-gradient(from 0deg at 50% 50%, transparent, color-mix(in oklab, var(--color-primary) 40%, transparent), transparent 40%)",
        }}
      />
      <div
        className={cn(
          "absolute -inset-[40%] opacity-[0.06]",
          reduced ? "workshop-ambient-static" : "workshop-ambient-drift-b",
        )}
        style={{
          background:
            "conic-gradient(from 180deg at 50% 50%, transparent, color-mix(in oklab, var(--color-foreground) 30%, transparent), transparent 45%)",
        }}
      />

      {/* A faint sweeping shimmer band; static (no translate) under reduced-motion. */}
      <div
        className={cn(
          "absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent",
          reduced ? "opacity-40" : "workshop-ambient-sweep",
        )}
      />
    </div>
  );
}

export default RenderAmbience;
