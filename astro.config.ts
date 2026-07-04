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
  // Preserve old URLs after the showroom→shopping rebrand and the admin-route
  // normalization (pages moved under /admin/*). `output: "server"` runs these on
  // the Worker, so bookmarks / QR codes / prod links keep resolving.
  redirects: {
    "/admin/showroom": "/admin/shopping",
    "/admin/showroom/[...rest]": "/admin/shopping/[...rest]",
    "/admin/shopping-journal": "/admin/shopping/journal",
    "/rooms/closets": "/admin/shopping/closets",
    "/uploads": "/admin/uploads",
    "/review": "/admin/review",
    "/photo-edits": "/admin/photo-edits",
    "/builder": "/admin/builder",
    "/gallery": "/admin/gallery",
    "/budget-tracker": "/admin/budget-tracker",
    "/budget-dashboard": "/admin/budget-dashboard",
    "/bid-portfolios": "/admin/bid-portfolios",
    "/measure": "/admin/measure",
    "/measurements": "/admin/measurements",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
