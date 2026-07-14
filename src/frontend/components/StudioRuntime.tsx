/**
 * @fileoverview 0016 — Studio runtime island (the sandboxed renderer).
 *
 * Renders a chat-built TSX artifact live, INSIDE an iframe served by
 * `studio-runtime.astro`. The source TSX is delivered as a PROP (SSR-inlined by
 * the page — see that file for why it can't be client-fetched from a sandboxed
 * iframe). The pipeline:
 *
 *   1. Receive `sourceTsx` (or a `loadError`) as a prop.
 *   2. Transpile TSX -> CJS JS in the browser with **sucrase**:
 *        transform: ["typescript", "jsx", "imports"], production: true
 *      The "imports" transform lowers ESM `import`/`export` to
 *      `require(...)` / `exports.*`, which lets us intercept every module.
 *   3. Execute the transpiled code with `new Function("require","exports",
 *      "module", code)` against a SCOPED `require` that maps ONLY the
 *      allow-listed specifiers (see `src/backend/mcp/artifacts/scope.ts`) to
 *      the real bundled modules. Any other specifier throws
 *      `Import not allowed: <specifier>`.
 *   4. Render `module.exports.default` inside a React error boundary. Any
 *      transpile / execution / render failure is shown as a Monolith
 *      destructive <Alert> — never a blank frame.
 *
 * SECURITY: this runs same-origin inside a `sandbox="allow-scripts"` iframe, so
 * the artifact can execute JS but has no access to the parent page. The scoped
 * `require` is the second gate: the artifact can only touch the sanctioned
 * shadcn/ui components, recharts, lucide-react, `cn`, and a READ-ONLY `/api/*`
 * GET helper — never arbitrary modules, never network writes.
 */

import * as React from "react";
import { useMemo } from "react";
import { transform } from "sucrase";

// ---- Allow-listed real modules (must mirror ALLOWED_SPECIFIERS in scope.ts) --
// The JSX runtimes are injected by sucrase's automatic transform (not by user
// imports), so artifacts don't need to `import React` for JSX to work.
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime";
import * as recharts from "recharts";
import * as lucideReact from "lucide-react";

import { cn } from "@/lib/utils";

import * as UiButton from "@/components/ui/button";
import * as UiCard from "@/components/ui/card";
import * as UiBadge from "@/components/ui/badge";
import * as UiInput from "@/components/ui/input";
import * as UiTextarea from "@/components/ui/textarea";
import * as UiLabel from "@/components/ui/label";
import * as UiSelect from "@/components/ui/select";
import * as UiCheckbox from "@/components/ui/checkbox";
import * as UiSwitch from "@/components/ui/switch";
import * as UiSlider from "@/components/ui/slider";
import * as UiTabs from "@/components/ui/tabs";
import * as UiDialog from "@/components/ui/dialog";
import * as UiAlertDialog from "@/components/ui/alert-dialog";
import * as UiPopover from "@/components/ui/popover";
import * as UiTooltip from "@/components/ui/tooltip";
import * as UiSeparator from "@/components/ui/separator";
import * as UiScrollArea from "@/components/ui/scroll-area";
import * as UiAvatar from "@/components/ui/avatar";
import * as UiAlert from "@/components/ui/alert";
import * as UiAspectRatio from "@/components/ui/aspect-ratio";
import * as UiChart from "@/components/ui/chart";

import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Read-only data helper exposed to artifacts as `@/studio/data`.
 *
 * This code runs INSIDE a `sandbox="allow-scripts"` iframe whose document has an
 * OPAQUE origin, so a direct `fetch("/api/…", { credentials })` is cross-origin
 * and the SameSite=Lax admin cookie is NOT sent → it would 401. Instead we ask
 * the parent Studio viewer (which holds the cookie) to perform the GET via
 * `postMessage` and relay the JSON back. Only same-origin `/api/*` GETs are
 * permitted (no writes in v1), matching the scope-catalog hint.
 */
let studioReqSeq = 0;

const studioData = {
  get: (path: string): Promise<unknown> => {
    if (typeof path !== "string" || !path.startsWith("/api/")) {
      return Promise.reject(
        new Error(`studioData.get: only /api/* paths are allowed (got "${path}")`),
      );
    }
    if (typeof window === "undefined" || window.parent === window) {
      return Promise.reject(
        new Error("studioData.get is only available inside the Studio viewer host."),
      );
    }
    return new Promise<unknown>((resolve, reject) => {
      // Correlate request/response by a per-frame sequence id so parallel gets
      // don't collide.
      const id = `sd-${(studioReqSeq += 1)}`;
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error(`studioData.get timed out for ${path}`));
      }, 15_000);
      function onMessage(e: MessageEvent) {
        const d = e.data as {
          __studio?: boolean;
          kind?: string;
          id?: string;
          ok?: boolean;
          data?: unknown;
          error?: string;
        };
        if (!d || d.__studio !== true || d.kind !== "fetch:result" || d.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (d.ok) resolve(d.data);
        else reject(new Error(d.error ?? `GET ${path} failed`));
      }
      window.addEventListener("message", onMessage);
      window.parent.postMessage({ __studio: true, kind: "fetch", id, path }, "*");
    });
  },
};

/**
 * The scoped module registry. Every key is a specifier an artifact may
 * `import`; the value is the real module namespace. Anything not present here
 * is rejected by the scoped `require`.
 */
const MODULE_REGISTRY: Record<string, unknown> = {
  react: React,
  // Injected by sucrase's automatic JSX transform — not user-facing imports.
  "react/jsx-runtime": ReactJsxRuntime,
  "react/jsx-dev-runtime": ReactJsxDevRuntime,
  recharts,
  "lucide-react": lucideReact,
  "@/lib/utils": { cn },
  "@/studio/data": studioData,
  "@/components/ui/button": UiButton,
  "@/components/ui/card": UiCard,
  "@/components/ui/badge": UiBadge,
  "@/components/ui/input": UiInput,
  "@/components/ui/textarea": UiTextarea,
  "@/components/ui/label": UiLabel,
  "@/components/ui/select": UiSelect,
  "@/components/ui/checkbox": UiCheckbox,
  "@/components/ui/switch": UiSwitch,
  "@/components/ui/slider": UiSlider,
  "@/components/ui/tabs": UiTabs,
  "@/components/ui/dialog": UiDialog,
  "@/components/ui/alert-dialog": UiAlertDialog,
  "@/components/ui/popover": UiPopover,
  "@/components/ui/tooltip": UiTooltip,
  "@/components/ui/separator": UiSeparator,
  "@/components/ui/scroll-area": UiScrollArea,
  "@/components/ui/avatar": UiAvatar,
  "@/components/ui/alert": UiAlert,
  "@/components/ui/aspect-ratio": UiAspectRatio,
  "@/components/ui/chart": UiChart,
};

/**
 * Build the scoped `require` closure passed into the transpiled artifact.
 * sucrase's "imports" transform calls `require(specifier)` (and sometimes wraps
 * with an interop helper), so we return the raw namespace object here.
 */
function makeScopedRequire(): (specifier: string) => unknown {
  return (specifier: string) => {
    if (Object.prototype.hasOwnProperty.call(MODULE_REGISTRY, specifier)) {
      return MODULE_REGISTRY[specifier];
    }
    throw new Error(`Import not allowed: ${specifier}`);
  };
}

/**
 * Transpile + execute the source TSX, returning the default-exported React
 * component. Throws with a readable message on transpile or execution failure.
 */
function compileArtifact(sourceTsx: string): React.ComponentType {
  // 1. Transpile TSX -> CJS.
  let code: string;
  try {
    const out = transform(sourceTsx, {
      transforms: ["typescript", "jsx", "imports"],
      jsxRuntime: "automatic",
      production: true,
    });
    code = out.code;
  } catch (e) {
    throw new Error(`Transpile error: ${(e as Error).message}`);
  }

  // 2. Execute against the scoped require.
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  const scopedRequire = makeScopedRequire();
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function("require", "exports", "module", code) as (
      req: (s: string) => unknown,
      exp: Record<string, unknown>,
      mod: { exports: Record<string, unknown> },
    ) => void;
    factory(scopedRequire, moduleObj.exports, moduleObj);
  } catch (e) {
    throw new Error(`Execution error: ${(e as Error).message}`);
  }

  // 3. Resolve the default export.
  const exported = moduleObj.exports as Record<string, unknown>;
  const Component = (exported.default ?? exported) as unknown;
  if (typeof Component !== "function") {
    throw new Error(
      "Artifact has no default-exported React component. Add `export default function ...`.",
    );
  }
  return Component as React.ComponentType;
}

/** Monolith destructive-alert error surface. */
function RuntimeError({ title, message }: { title: string; message: string }) {
  return (
    <div className="p-4">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs">
            {message}
          </pre>
        </AlertDescription>
      </Alert>
    </div>
  );
}

/**
 * Error boundary wrapping the rendered artifact so a render-time throw becomes
 * a Monolith alert rather than a blank frame or a crashed iframe.
 */
class ArtifactErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <RuntimeError
          title="Artifact render error"
          message={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}

export function StudioRuntime({
  sourceTsx,
  loadError,
}: {
  /** SSR-inlined artifact source, or null when it couldn't be resolved. */
  sourceTsx: string | null;
  /** Server-side load/auth error to surface instead of rendering. */
  loadError: string | null;
}) {
  // Compile once per source change. Compilation errors are captured here so
  // they render as an alert (render errors are caught by the boundary).
  const compiled = useMemo(() => {
    if (sourceTsx == null) {
      return { Component: null as React.ComponentType | null, error: null as string | null };
    }
    try {
      return { Component: compileArtifact(sourceTsx), error: null };
    } catch (e) {
      return { Component: null, error: (e as Error).message };
    }
  }, [sourceTsx]);

  if (loadError) {
    return <RuntimeError title="Could not load artifact" message={loadError} />;
  }

  if (compiled.error) {
    return <RuntimeError title="Artifact compile error" message={compiled.error} />;
  }

  if (!compiled.Component) {
    return <RuntimeError title="Nothing to render" message="No artifact component was produced." />;
  }

  const Component = compiled.Component;
  return (
    <ArtifactErrorBoundary>
      <div className="min-h-svh p-4">
        <Component />
      </div>
    </ArtifactErrorBoundary>
  );
}
