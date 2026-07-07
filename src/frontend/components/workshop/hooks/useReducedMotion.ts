import { useEffect, useState } from "react";

/**
 * Tracks the user's prefers-reduced-motion setting reactively. Every animated
 * surface in the Workshop (gsap piles, motion drawer, ambient texture) gates
 * its motion on this so reduced-motion users get instant, static equivalents.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
