import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { swaggerUI } from "@hono/swagger-ui";
import { prospectsRouter } from "./routes/prospects";
import { stateRouter } from "./routes/state";

export const app = new OpenAPIHono<{ Bindings: Env }>();

app.route("/api/prospects", prospectsRouter);
app.route("/api/prospects", stateRouter);

// Dynamic OpenAPI spec — never hardcode schemas here.
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "Recovery Remodel Dialer API", version: "1.0.0" },
});

app.get("/scalar", apiReference({ url: "/openapi.json" }));
app.get("/swagger", swaggerUI({ url: "/openapi.json" }));
