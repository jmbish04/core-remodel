import { useEffect, useRef, useState } from "react";

export function AnimatedNumber({
  value,
  format = (v: number) => v.toLocaleString("en-US"),
  duration = 420,
  className = "",
}: {
  value: number;
  format?: (v: number) => string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);
    const tick = (t: number) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {format(Math.round(display))}
    </span>
  );
}
