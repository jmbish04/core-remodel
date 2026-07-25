/**
 * @fileoverview Shared types for the slidecn slide components.
 *
 * The registry's `list-slide` imports `FragmentAnimation` from here, but the
 * module itself is not published as a registry item — installing any slide that
 * uses fragments leaves a dangling import. Defining it here rather than dropping
 * the import keeps the component's public API identical to upstream, so a future
 * `shadcn add` of another fragment-aware slide still type-checks.
 *
 * Values are reveal.js fragment animation names, used verbatim as the
 * `data-fragment` class on the element.
 * @see https://revealjs.com/fragments/
 */
export type FragmentAnimation =
  | "fade-in"
  | "fade-out"
  | "fade-up"
  | "fade-down"
  | "fade-left"
  | "fade-right"
  | "fade-in-then-out"
  | "fade-in-then-semi-out"
  | "grow"
  | "shrink"
  | "strike"
  | "highlight-red"
  | "highlight-green"
  | "highlight-blue"
  | "highlight-current-red"
  | "highlight-current-green"
  | "highlight-current-blue";
