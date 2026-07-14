/**
 * @fileoverview Artifact source validator (0016 §5) — the mechanical + soft
 * guardrails that keep artifacts "always shadcn, never bespoke."
 *
 * Runs at submit time in `create_artifact` / `update_artifact`. Two layers:
 *   - HARD: every `import` specifier must be in the {@link ALLOWED_SPECIFIERS}
 *     allow-list; a default export must exist; dangerous constructs
 *     (`eval`, `new Function`, dynamic `import()`, `<script>`,
 *     `dangerouslySetInnerHTML`) are banned.
 *   - SOFT (style contract): inline `style={{…}}`/`<style>` blocks, hardcoded
 *     color utilities / arbitrary color values, and raw interactive elements
 *     (`<button>`/`<input>`/`<select>`/`<textarea>`) are rejected with an
 *     actionable message so Claude fixes it and resubmits.
 *
 * This is a pragmatic static check (regex over source), NOT a full parser — it
 * is defense against footguns for a single trusted operator, and it is paired
 * with a sandboxed iframe + scoped module loader at render time (the real
 * isolation). Keep the messages specific: they are the agent's fix instructions.
 */
import { ALLOWED_SPECIFIERS } from "./scope";

/** Result of validating one artifact source module. */
export interface ArtifactValidation {
  ok: boolean;
  /** Actionable rejection messages (empty when ok). */
  errors: string[];
  /** Distinct import specifiers found (for storage + docs). */
  imports: string[];
}

/** Matches `import … from "specifier"` and bare `import "specifier"`. */
const IMPORT_RE = /import\s+(?:[^"';]+?\s+from\s+)?["']([^"']+)["']/g;

/** Tailwind named color scales that are banned (must use theme tokens). */
const NAMED_COLOR_UTIL_RE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|decoration|outline|shadow|accent|caret|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b/;

/** Arbitrary color values in a utility, e.g. `bg-[#fff]`, `text-[rgb(...)]`. */
const ARBITRARY_COLOR_RE = /-\[\s*(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\()/;

/** Raw interactive elements that should be shadcn components instead. */
const RAW_INTERACTIVE_RE = /<(button|input|select|textarea)\b/i;

/**
 * Validate an artifact TSX module. Returns `ok:false` with specific messages
 * rather than throwing, so the tool can hand the errors back to the agent.
 */
export function validateArtifactSource(source: string): ArtifactValidation {
  const errors: string[] = [];
  const imports = new Set<string>();

  if (!source || source.trim().length === 0) {
    return { ok: false, errors: ["Source is empty."], imports: [] };
  }

  // ── HARD: import allow-list ────────────────────────────────────────────
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    const specifier = m[1];
    imports.add(specifier);
    if (!ALLOWED_SPECIFIERS.has(specifier)) {
      errors.push(
        `Import "${specifier}" is not allowed. Artifacts may only import shadcn/ui components ` +
          `(@/components/ui/*), react, recharts, lucide-react, @/lib/utils, or @/studio/data. ` +
          `Call list_allowed_components for the full catalog.`,
      );
    }
  }

  // ── HARD: must default-export a component ──────────────────────────────
  if (!/export\s+default\b/.test(source)) {
    errors.push("Artifact must `export default` a React component.");
  }

  // ── HARD: dangerous constructs ─────────────────────────────────────────
  if (/\beval\s*\(/.test(source)) errors.push("`eval(` is not allowed.");
  if (/\bnew\s+Function\s*\(/.test(source)) errors.push("`new Function(` is not allowed.");
  if (/\bimport\s*\(/.test(source)) {
    errors.push("Dynamic `import()` is not allowed — use a static top-level import.");
  }
  if (/<\s*script\b/i.test(source)) errors.push("`<script>` tags are not allowed.");
  if (/dangerouslySetInnerHTML/.test(source)) {
    errors.push("`dangerouslySetInnerHTML` is not allowed — render content with components.");
  }

  // ── SOFT: style contract ───────────────────────────────────────────────
  if (/style\s*=\s*\{\{/.test(source)) {
    errors.push(
      "Inline `style={{…}}` is not allowed — use Tailwind layout utilities + theme tokens.",
    );
  }
  if (/<\s*style\b/i.test(source)) {
    errors.push("`<style>` blocks are not allowed — use Tailwind utilities + theme tokens.");
  }
  if (NAMED_COLOR_UTIL_RE.test(source)) {
    errors.push(
      "Hardcoded color utilities (e.g. `text-red-500`, `bg-blue-600`) are not allowed. Use Monolith " +
        "theme tokens: `bg-card`, `bg-primary`, `text-foreground`, `text-muted-foreground`, " +
        "`border-border`, `ring-ring`, and the chart palette via <ChartContainer>.",
    );
  }
  if (ARBITRARY_COLOR_RE.test(source)) {
    errors.push(
      "Arbitrary color values (e.g. `bg-[#fff]`, `text-[rgb(...)]`) are not allowed. Use theme tokens.",
    );
  }
  const rawEl = source.match(RAW_INTERACTIVE_RE);
  if (rawEl) {
    errors.push(
      `Raw <${rawEl[1].toLowerCase()}> element found — use the shadcn component instead ` +
        `(<Button>/<Input>/<Select>/<Textarea>). Plain <div>/<span> for layout is fine.`,
    );
  }

  return { ok: errors.length === 0, errors, imports: [...imports] };
}
