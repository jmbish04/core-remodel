// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

import { inkWebPlugin } from "ink-web/vite";
import { defineConfig } from "astro/config";

/**
 * `ink-web` runs Ink (React for terminals) in the browser through xterm.js, which
 * is what lets the termcn components render on a web page at all. Its Vite plugin
 * does that by aliasing Node built-ins — `node:stream`, `node:events`,
 * `node:buffer`, `node:fs`, `node:path`, `process`, `tty` — to browser shims.
 *
 * Those aliases MUST NOT reach the server build. This Worker's SSR bundle and its
 * dependencies genuinely use several of them (Astro's asset utils import
 * `node:fs/promises` and `node:path`; the agents SDK imports `node:async_hooks`
 * and `node:stream`), and swapping them for browser shims would break the
 * deployed Worker in ways that only show up at runtime.
 *
 * So the plugin is delegated to only for the CLIENT build. Astro runs Vite twice
 * and flags the server pass with `isSsrBuild`, which is the seam used here.
 */
function clientOnlyInkWeb() {
  const inner = inkWebPlugin();
  return {
    name: "ink-web-client-only",
    config(config: unknown, env: { isSsrBuild?: boolean }) {
      if (env?.isSsrBuild) return undefined;
      const patched = (
        typeof inner.config === "function"
          ? (inner.config as (c: unknown, e: unknown) => unknown)(config, env)
          : undefined
      ) as { resolve?: { alias?: Record<string, string> } } | undefined;

      /**
       * Override ink-web's own chalk shim.
       *
       * Theirs implements the 16 named ANSI colors and nothing else — no `hex`,
       * `rgb` or `ansi256`. Ink renders a `#rrggbb` color prop by calling
       * `chalk.hex(color)(text)`, so any component with a hex theme (all of
       * termcn's) throws `chalk.hex is not a function` and takes the whole Ink
       * render down with it. Ours adds the truecolor methods.
       */
      if (patched?.resolve?.alias) {
        patched.resolve.alias.chalk = fileURLToPath(
          new URL("./src/frontend/lib/shims/chalk.ts", import.meta.url),
        );
      }
      return patched;
    },
  };
}

const site = process.env.SITE ?? "http://localhost:4321";
const base = process.env.BASE || "/";

// https://astro.build/config
export default defineConfig({
  site,
  srcDir: "./src/frontend",
  base,
  output: "server",
  adapter: cloudflare({
    imageService: "cloudflare",
    platformProxy: {
      enabled: true,
    },
  }),
  integrations: [react()],
  // Prefetch page HTML on link hover/focus so MPA navigation feels instant and
  // the click "hang" (waiting on SSR) is eliminated. `output: "server"` on the
  // Cloudflare adapter serves the prefetched SSR HTML.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  // NOTE: legacy-URL redirects for the showroom→shopping rebrand and the
  // admin-route normalization are handled in `src/_worker.ts` (prefix-based, 301),
  // NOT via Astro's `redirects` config — the Cloudflare adapter mis-generates a
  // self-referential `_redirects` splat rule for dynamic destinations, which
  // wrangler rejects at deploy time ("infinite loop detected").
  vite: {
    plugins: [tailwindcss(), clientOnlyInkWeb()],
  },
});
