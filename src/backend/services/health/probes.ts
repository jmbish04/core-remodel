/**
 * @fileoverview The health-PROBE registry — the single source of truth for
 * WHICH infrastructure checks exist.
 *
 * Every backend module owns a `health.ts` exporting `HEALTH_PROBES`. This file
 * concatenates them, in dashboard order. Adding a check is: write it in your
 * module's `health.ts`, add the module here. Nothing else — the catalogue table
 * (`health_test_def`), the binding-type vocabulary, the API and the dashboard
 * are all generated from this array. Mirrors how `src/backend/mcp/registry.ts`
 * owns the MCP tool surface.
 *
 * TWO REGISTRIES, ONE PAGE — read this before adding anything:
 *  - `registry.ts` (`HEALTH_CHECKS`, shipped in #169) holds **data-quality**
 *    checks. They grade a vertical's DATA (duplicate brands, orphaned mappings)
 *    on a 0-100 score and deep-link into the audit trail and logs. They are
 *    self-registering: importing `checks/*` is what registers them.
 *  - this file holds **infrastructure** probes: is the binding attached, is the
 *    credential readable, is the table there, is spend spiking.
 *
 * They are not the same question, so they keep their own shapes. The last group
 * below BRIDGES the data-quality checks into the probe pipeline, so one run
 * covers both and every result — quality or infrastructure — lands in the same
 * `health_results` ledger under one `session_uuid`.
 */

import { HEALTH_PROBES as apiProbes } from "@backend/api/health";
import { HEALTH_PROBES as aiProbes } from "@backend/ai/health";
import { HEALTH_PROBES as dbProbes } from "@backend/db/health";
import { HEALTH_PROBES as mcpProbes } from "@backend/mcp/health";
import { HEALTH_PROBES as realtimeProbes } from "@backend/realtime/health";
import { HEALTH_PROBES as aiGatewayProbes } from "@backend/services/ai-gateway/health";
import { HEALTH_PROBES as documentsProbes } from "@backend/services/documents/health";
import { HEALTH_PROBES as emailProbes } from "@backend/services/email/health";
import { HEALTH_PROBES as gmailProbes } from "@backend/services/gmail/health";
import { HEALTH_PROBES as googleProbes } from "@backend/services/google/health";
import { HEALTH_PROBES as googlePhotosProbes } from "@backend/services/google-photos/health";
import { HEALTH_PROBES as imageProcessorProbes } from "@backend/services/image-processor/health";
import { HEALTH_PROBES as renderProbes } from "@backend/services/render/health";
import { HEALTH_PROBES as showroomProbes } from "@backend/services/showroom/health";
import { HEALTH_PROBES as teslaProbes } from "@backend/services/tesla/health";
import { HEALTH_PROBES as usageProbes } from "@backend/services/usage/health";
import { HEALTH_PROBES as workflowsProbes } from "@backend/services/workflows/health";

// Importing the barrel is what REGISTERS the data-quality checks (see index.ts).
import { HEALTH_CHECKS } from "./index";
import { defineProbe, degraded, failure, ok, type HealthProbe } from "./types";

/**
 * A module's probes plus the label the dashboard groups them under. Order here
 * is the order sections appear on the health page: platform first (if D1 is
 * down nothing else matters), then AI/cost, then integrations, then data.
 */
export interface HealthModuleGroup {
  /** snake_case id, stable — used as the group key in the API response. */
  id: string;
  label: string;
  /** One line explaining what this slice of the system is. */
  blurb: string;
  probes: HealthProbe[];
}

/**
 * Wrap the self-registering data-quality checks as probes.
 *
 * The mapping is deliberate, not mechanical:
 *  - `unknown` (the check itself threw) becomes FAILURE, never SUCCESS — a check
 *    that cannot answer must not read as an all-clear;
 *  - `unhealthy` → FAILURE, `degraded` → DEGRADED;
 *  - the score and every stat go into the details string, so the number that
 *    justified the status survives into the ledger rather than only the verdict.
 */
const dataQualityProbes: HealthProbe[] = HEALTH_CHECKS.map((check) =>
  defineProbe({
    name: `data_quality_${check.slug.replace(/-/g, "_")}`,
    displayName: check.name,
    description: check.description,
    healthTsFilepath: `src/backend/services/health/checks/${check.vertical}.ts`,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The check scored 95 or above: no meaningful data defects in this vertical. Nothing to do.",
    whatFailureMeans:
      "Below 70 the check reports unhealthy — the data this vertical depends on is wrong or " +
      "incomplete enough that features reading it will misbehave. A FAILURE here can also mean the " +
      "check itself threw, which is reported as a failure on purpose: a check that cannot answer " +
      "must never be mistaken for an all-clear.",
    troubleshootingSteps:
      `1. Open /admin/system/health and find "${check.name}" for the full stat breakdown. ` +
      `2. Follow its action link (typically the ${check.vertical} admin page) to the rows at fault. ` +
      `3. Check /admin/system/audit/${check.slug} for what changed recently, and ` +
      `/admin/system/logs/${check.slug} for errors from the job that maintains this data. ` +
      "4. Fix the flagged rows, then re-run the screen — the score is recomputed live.",
    devOpsPlaybook:
      "Data-quality defects are almost never fixed by a deploy — they are fixed by correcting rows " +
      "or by fixing the ingestion that produced them. If the count jumps suddenly, look at what ran: " +
      "a bulk import, a scrape, or a backfill script is the usual cause. If the check throws " +
      "(reported as FAILURE with an error message), that IS a code bug — check whether a migration " +
      "renamed or dropped a column the check reads, and confirm with `pnpm run migrate:remote`.",
    isBillingRisk: false,
    severity: "MEDIUM",
    run: async (env: Env) => {
      const r = await check.run(env);
      const stats = r.stats.map((s) => `${s.label}=${s.value}${s.problem ? " (!)" : ""}`).join(", ");
      const details = `${r.summary} — score ${r.score}/100${stats ? `; ${stats}` : ""}`;
      if (r.status === "healthy") return ok(details);
      if (r.status === "degraded") return degraded(details);
      return failure(details);
    },
  }),
);

export const HEALTH_MODULE_GROUPS: HealthModuleGroup[] = [
  {
    id: "storage",
    label: "Storage & Data",
    blurb: "D1, KV and the schema everything else reads through.",
    probes: dbProbes,
  },
  {
    id: "api",
    label: "API & Edge",
    blurb: "The Hono surface, its auth credential, and the static asset binding.",
    probes: apiProbes,
  },
  {
    id: "compute",
    label: "Durable Objects & Workflows",
    blurb: "Stateful agents, realtime sessions, and the nine background Workflows.",
    probes: [...realtimeProbes, ...workflowsProbes],
  },
  {
    id: "ai",
    label: "AI & Inference",
    blurb: "Workers AI, Vectorize, model config and provider credentials.",
    probes: [...aiProbes, ...aiGatewayProbes],
  },
  {
    id: "cost",
    label: "Cost & Usage",
    blurb: "Spend watchers — sudden jumps in AI, Maps, agent and Durable Object usage.",
    probes: usageProbes,
  },
  {
    id: "media",
    label: "Media & Documents",
    blurb: "R2, Cloudflare Images, the render pipeline and the document store.",
    probes: [...imageProcessorProbes, ...renderProbes, ...documentsProbes],
  },
  {
    id: "integrations",
    label: "External Integrations",
    blurb: "Email, Gmail, Google APIs, Google Photos and Tesla telemetry.",
    probes: [
      ...emailProbes,
      ...gmailProbes,
      ...googleProbes,
      ...googlePhotosProbes,
      ...teslaProbes,
    ],
  },
  {
    id: "connector",
    label: "MCP Connector",
    blurb: "The tool registry Claude talks to, its OAuth store and its op logs.",
    probes: mcpProbes,
  },
  {
    id: "domain",
    label: "Domain Data Integrity",
    blurb: "Relational invariants in the showroom/sourcing data.",
    probes: showroomProbes,
  },
  {
    id: "quality",
    label: "Data Quality",
    blurb: "The scored data-quality checks, with deep links into the audit trail and logs.",
    probes: dataQualityProbes,
  },
];

/**
 * Every probe, flattened, de-duplicated by `name`.
 *
 * A duplicate name would silently overwrite another probe's catalogue row, so we
 * drop the later one and log loudly rather than throwing — a naming mistake in
 * one module must not take the whole Worker's module graph down at import time.
 */
export const ALL_HEALTH_PROBES: HealthProbe[] = (() => {
  const seen = new Set<string>();
  const out: HealthProbe[] = [];
  for (const group of HEALTH_MODULE_GROUPS) {
    for (const probe of group.probes) {
      if (seen.has(probe.name)) {
        console.error(
          `[health/probes] duplicate probe name "${probe.name}" (${probe.healthTsFilepath}) — ignoring the later one`,
        );
        continue;
      }
      seen.add(probe.name);
      out.push(probe);
    }
  }
  return out;
})();

/** Which dashboard group a probe belongs to, by probe name. */
export const PROBE_GROUP_BY_NAME: Record<string, string> = Object.fromEntries(
  HEALTH_MODULE_GROUPS.flatMap((g) => g.probes.map((p) => [p.name, g.id] as const)),
);
