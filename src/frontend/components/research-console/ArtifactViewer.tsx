/**
 * @fileoverview ArtifactViewer — renders a step's `artifact` payload, whatever
 * shape it takes.
 *
 * Rendering rules (per the console spec):
 *   - strings → prose/pre with whitespace preserved (whitespace-pre-wrap);
 *   - objects → a pretty key/value list, falling back to a pretty-printed JSON
 *     <pre> for nested/complex values;
 *   - arrays / anything else → pretty-printed JSON.
 *
 * Special-cased by stepKey:
 *   - "engine:plan" / "engine:outline" → force a text block (these are always
 *     long-form prose even when handed to us as a JSON string);
 *   - "extract-structured" → force the key/value grid.
 * (Candidate-list steps are handled by the viewport, not here.)
 */

// ─── Value formatting ───────────────────────────────────────────────────────────

/** True for a plain object we can render as a key/value grid. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Render a scalar cell value; complex values become inline JSON. */
function renderScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Humanize a camelCase / snake_case key for the label column. */
function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Sub-renderers ──────────────────────────────────────────────────────────────

/** Long-form prose / pre — whitespace preserved, wraps on overflow. */
function TextBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-sans text-sm leading-relaxed text-foreground/80 ring-1 ring-border/40">
      {text}
    </pre>
  );
}

/** Pretty-printed JSON fallback for arrays and deep/complex values. */
function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-[12px] leading-relaxed text-foreground/80 ring-1 ring-border/40">
      {text}
    </pre>
  );
}

/** A key/value grid for a flat object; nested values fall back to inline JSON. */
function KeyValueGrid({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return <p className="text-xs italic text-muted-foreground/60">Empty.</p>;
  }
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,10rem)_1fr]">
      {entries.map(([key, value]) => {
        const complex = isPlainObject(value) || Array.isArray(value);
        return (
          <div
            key={key}
            className="grid grid-cols-1 gap-1 sm:col-span-2 sm:grid-cols-subgrid"
          >
            <dt className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              {humanizeKey(key)}
            </dt>
            <dd className="min-w-0 text-sm text-foreground/80">
              {complex ? (
                <JsonBlock value={value} />
              ) : (
                <span className="whitespace-pre-wrap break-words">{renderScalar(value)}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ─── Public component ───────────────────────────────────────────────────────────

const TEXT_STEP_KEYS = new Set(["engine:plan", "engine:outline"]);
const GRID_STEP_KEYS = new Set(["extract-structured"]);

export function ArtifactViewer({
  artifact,
  stepKey,
}: {
  artifact: unknown;
  stepKey: string;
}) {
  if (artifact === null || artifact === undefined || artifact === "") {
    return <p className="text-xs italic text-muted-foreground/60">No artifact.</p>;
  }

  // Special-case: plan/outline steps are always long-form prose.
  if (TEXT_STEP_KEYS.has(stepKey)) {
    return <TextBlock text={typeof artifact === "string" ? artifact : renderScalar(artifact)} />;
  }

  // Special-case: structured-extraction steps render as a key/value grid.
  if (GRID_STEP_KEYS.has(stepKey) && isPlainObject(artifact)) {
    return <KeyValueGrid obj={artifact} />;
  }

  // Strings → prose/pre.
  if (typeof artifact === "string") {
    return <TextBlock text={artifact} />;
  }

  // Plain objects → key/value grid.
  if (isPlainObject(artifact)) {
    return <KeyValueGrid obj={artifact} />;
  }

  // Arrays / anything else → pretty JSON.
  return <JsonBlock value={artifact} />;
}
