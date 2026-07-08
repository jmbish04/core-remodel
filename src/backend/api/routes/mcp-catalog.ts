/**
 * @fileoverview Public MCP tool catalog endpoint.
 *
 * `GET /api/mcp-docs` returns the tool registry metadata (names, descriptions,
 * input fields, annotations, examples) as JSON. It is intentionally PUBLIC
 * (no auth) — it only describes what the connector can do, never any data —
 * so the `/mcp/tools` documentation page can SSR-render the catalog and stay
 * in lockstep with the registry. Adding a tool to the registry updates this
 * response (and therefore the docs page) automatically.
 */
import { describeTools, getAllTools } from "@backend/mcp/registry";
import { Hono } from "hono";

const mcpCatalogRouter = new Hono<{ Bindings: Env }>();

mcpCatalogRouter.get("/", (c) => {
  return c.json({
    server: { name: "core-remodel", version: "1.0.0" },
    transport: {
      streamableHttp: "/mcp",
      sse: "/mcp/sse",
      legacyJsonRpc: "/api/mcp",
    },
    toolCount: getAllTools().length,
    tools: describeTools(),
  });
});

export default mcpCatalogRouter;
