/**
 * @fileoverview Tesla telemetry DB schema barrel.
 *
 * These tables live in the dedicated `TESLA_DB` D1 (see wrangler.jsonc), NOT the
 * app DB — so this barrel is intentionally NOT re-exported from the main schema
 * index (`src/backend/db/schema/index.ts`). It is the `schema` entrypoint for
 * `drizzle.tesla.config.ts`, whose migrations land in `drizzle-tesla/`.
 */
export * from "./telemetry_events";
export * from "./webhook_events";
