import { defineConfig } from "drizzle-kit";

/**
 * Drizzle config for the dedicated Tesla telemetry D1 (`TESLA_DB`).
 *
 * Kept separate from `drizzle.config.ts` (the app DB) so telemetry/webhook
 * tables generate into their own migrations dir and never mix with the app DB's
 * journal. Generate with:
 *   pnpm exec drizzle-kit generate --config drizzle.tesla.config.ts
 * Apply with `pnpm run migrate:tesla:remote` (wired into `deploy`).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/backend/db/schema/tesla/index.ts",
  out: "./drizzle-tesla",
});
