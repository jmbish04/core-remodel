/**
 * @fileoverview System health API — every registered check, one response.
 *
 * Mounts at /api/system/health. Backs /admin/system/health and the global
 * monitoring badge, so both read the SAME numbers: a badge that disagrees with
 * the page it links to is worse than no badge.
 */

import { OpenAPIHono } from "@hono/zod-openapi";

import { aggregateHealth, HEALTH_CHECKS, runAllHealthChecks } from "@backend/services/health";

export const systemHealthRouter = new OpenAPIHono<{ Bindings: Env }>();

/**
 * GET / — run every registered check.
 *
 * `?vertical=brands` narrows to one product area, which is how the brands page
 * gets its own figure without a second endpoint or a second definition of
 * "healthy".
 */
systemHealthRouter.get("/", async (c) => {
  const vertical = c.req.query("vertical");

  const all = await runAllHealthChecks(c.env);
  const results = vertical ? all.filter((r) => r.vertical === vertical) : all;

  return c.json({
    checkedAt: new Date().toISOString(),
    overall: aggregateHealth(results),
    services: results,
    // Verticals present in THIS response, so the UI can group without knowing
    // the registry up front.
    verticals: [...new Set(results.map((r) => r.vertical))].sort(),
  });
});

/** GET /checks — registry listing without running anything. Cheap, for nav. */
systemHealthRouter.get("/checks", (c) =>
  c.json({
    checks: HEALTH_CHECKS.map(({ slug, name, vertical, description }) => ({
      slug,
      name,
      vertical,
      description,
    })),
  }),
);

/** GET /:slug — one check, for a focused re-run after a fix. */
systemHealthRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const check = HEALTH_CHECKS.find((x) => x.slug === slug);
  if (!check) return c.json({ error: `unknown health check: ${slug}` }, 404);

  const [result] = await runAllHealthChecks(c.env).then((all) =>
    all.filter((r) => r.slug === slug),
  );
  return c.json({ checkedAt: new Date().toISOString(), service: result });
});
