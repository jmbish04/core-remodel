/**
 * @fileoverview Barrel for the research-console feature.
 *
 * The research console repurposes /admin/shopping/research into a live view over
 * the /api/research-jobs surface: a landing list of ongoing + prior jobs, a
 * template-picker initiate dialog, and a per-job viewport that streams plan →
 * steps → report → sources → discovery-candidate intake.
 */

export { ResearchConsoleApp } from "./ResearchConsoleApp";
export { ResearchJobViewportApp } from "./ResearchJobViewportApp";
export { NewResearchDialog } from "./NewResearchDialog";
export { EntitySearchSelect } from "./EntitySearchSelect";
export type { EntityCatalog, EntityHit } from "./EntitySearchSelect";
export * from "./types";
