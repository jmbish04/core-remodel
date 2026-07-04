// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

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
    plugins: [tailwindcss()],
  },
});
