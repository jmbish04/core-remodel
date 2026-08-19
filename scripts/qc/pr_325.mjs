#!/usr/bin/env node
/**
 * QC for PR #325 — Pascal scene store (0043 Phase 1), the /api/pascal/v1/* wire.
 * Run: node scripts/qc/pr_325.mjs --preview   (branch)   or bare (prod, regression)
 *
 * Exercises the full CRUD + version + events contract the Vercel editor consumes.
 * On prod the routes don't exist until merge+deploy, so the script detects that and
 * reports "pending merge/deploy" instead of hard-failing.
 */
import { createChecks, createClient, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, finish } = createChecks();
console.log(`QC pascal scene store against ${BASE}\n`);

const rid = crypto.randomUUID().slice(0, 8);
const projectId = `qc-proj-${rid}`;
const sceneId = `qc-scene-${rid}`;
const CRPID = `qc-core-${rid}`;
const graph = (extra = {}) => ({
  nodes: { site: { id: "site", type: "site" }, ...extra },
  rootNodeIds: ["site"],
});

try {
  // Is the wire deployed on this target?
  const probe = await c.get(`/api/pascal/v1/scenes?projectId=${projectId}`);
  if (probe.status === 404) {
    console.log(
      `\n⚠️  /api/pascal/v1 not present on ${BASE} — pending merge/deploy. ` +
        `Run against --preview to exercise the new surface.\n`,
    );
    process.exit(0);
  }

  // Auth guard — unauthenticated call must be rejected.
  const unauth = await c.get(`/api/pascal/v1/scenes?projectId=${projectId}`, {
    auth: false,
  });
  check("unauthenticated → 401", unauth.status === 401, `status=${unauth.status}`);

  // Create project.
  const proj = await c.post("/api/pascal/v1/projects", {
    id: projectId,
    name: "QC Upstairs",
    coreRemodelProjectId: CRPID,
    scopeType: "whole_home",
  });
  check("create project 200", proj.status === 200, `status=${proj.status} ${proj.text?.slice(0, 120)}`);
  check("project id echoed", proj.json?.id === projectId, JSON.stringify(proj.json?.id));
  check("project isEmpty", proj.json?.isEmpty === true, `isEmpty=${proj.json?.isEmpty}`);

  // Create a scene (draft).
  const put1 = await c.req("PUT", `/api/pascal/v1/scenes/${sceneId}`, {
    body: { name: "Island A", projectId, graph: graph(), saveMode: "draft" },
  });
  check("create scene 200", put1.status === 200, `status=${put1.status} ${put1.text?.slice(0, 120)}`);
  check("scene version 1", put1.json?.version === 1, `version=${put1.json?.version}`);
  check("scene nodeCount 1", put1.json?.nodeCount === 1, `nodeCount=${put1.json?.nodeCount}`);
  check("editorUrl points at /scene/:id", (put1.json?.editorUrl || "").endsWith(`/scene/${sceneId}`), put1.json?.editorUrl);
  check("graphHash present", typeof put1.json?.graphHash === "string" && put1.json.graphHash.length === 64, put1.json?.graphHash?.slice(0, 12));

  // Load full graph back.
  const get1 = await c.get(`/api/pascal/v1/scenes/${sceneId}`);
  check("load scene 200", get1.status === 200, `status=${get1.status}`);
  check("full graph returned", get1.json?.graph?.nodes?.site?.type === "site", JSON.stringify(get1.json?.graph)?.slice(0, 120));

  // Stale expectedVersion → 409.
  const conflict = await c.req("PUT", `/api/pascal/v1/scenes/${sceneId}`, {
    body: { name: "Island A", projectId, graph: graph({ w1: { id: "w1", type: "wall" } }), expectedVersion: 99 },
  });
  check("stale expectedVersion → 409", conflict.status === 409, `status=${conflict.status}`);

  // Checkpoint save → version bumps + event appended.
  const put2 = await c.req("PUT", `/api/pascal/v1/scenes/${sceneId}`, {
    body: {
      name: "Island A",
      projectId,
      graph: graph({ w1: { id: "w1", type: "wall" } }),
      saveMode: "checkpoint",
      publish: true,
      expectedVersion: 1,
    },
  });
  check("checkpoint save 200", put2.status === 200, `status=${put2.status} ${put2.text?.slice(0, 120)}`);
  check("checkpoint version 2", put2.json?.version === 2, `version=${put2.json?.version}`);
  check("published true", put2.json?.published === true, `published=${put2.json?.published}`);

  // Events reflect the checkpoint.
  const events = await c.get(`/api/pascal/v1/scenes/${sceneId}/events`);
  check("events 200 + non-empty", events.status === 200 && Array.isArray(events.json) && events.json.length >= 1, `n=${events.json?.length}`);
  check("event carries full graph snapshot", events.json?.[events.json.length - 1]?.graph?.nodes?.w1?.type === "wall", JSON.stringify(events.json?.[0]?.graph)?.slice(0, 100));

  // List scenes for the project.
  const list = await c.get(`/api/pascal/v1/scenes?projectId=${projectId}`);
  check("list includes scene", Array.isArray(list.json) && list.json.some((s) => s.id === sceneId), `n=${list.json?.length}`);

  // Rename (PATCH).
  const patch = await c.patch(`/api/pascal/v1/scenes/${sceneId}`, { name: "Island A — renamed" });
  check("rename 200 + name changed", patch.status === 200 && patch.json?.name === "Island A — renamed", `name=${patch.json?.name}`);

  // Oversize graph → 413.
  const big = await c.req("PUT", `/api/pascal/v1/scenes/${sceneId}-big`, {
    body: { name: "Too big", projectId, graph: { nodes: { blob: "x".repeat(600_000) } } },
  });
  check("oversize graph → 413", big.status === 413, `status=${big.status}`);

  // Delete → 204, then 404.
  const del = await c.req("DELETE", `/api/pascal/v1/scenes/${sceneId}`);
  check("delete → 204", del.status === 204, `status=${del.status}`);
  const gone = await c.get(`/api/pascal/v1/scenes/${sceneId}`);
  check("deleted scene → 404", gone.status === 404, `status=${gone.status}`);

  info(`test project left in place: ${projectId} (harmless; no delete-project endpoint yet)`);
} catch (err) {
  check("QC ran without throwing", false, String(err?.stack || err));
}

finish();
