import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./backend/db/schemas/index.ts",
  out: "./backend/db/migrations",
});
