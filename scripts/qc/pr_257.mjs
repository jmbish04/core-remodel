#!/usr/bin/env node
/**
 * QC for PR #257 — drive-list + stop editing (MCP tools + HTTP twins).
 * Run: node scripts/qc/pr_257.mjs --preview   (or bare for prod)
 *
 * The MCP tools and the admin API share the same service functions, so testing
 * the HTTP twins exercises the exact code the MCP tools call. Full lifecycle:
 * create → edit drive fields → add stop → edit stop → delete stop → cleanup.
 * The edit endpoints are new, so on prod (pre-deploy) they 400/404 — the whole
 * lifecycle is gated to non-prod; prod only runs the read-only regression.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const IS_PROD = BASE.replace(/\/$/, "") === "https://core-remodel.hacolby.workers.dev";
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_257 (drive-list editing) against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

// Read-only regression (prod + preview): the list endpoint still answers.
const list = await c.get("/api/drive-lists");
check("GET /api/drive-lists 200", list.status === 200, `status=${list.status}`);

if (IS_PROD) {
  info("edit lifecycle skipped on prod (new endpoints pending merge/deploy)");
  summary();
} else {
  let slug = null;
  try {
    const created = await c.post("/api/drive-lists", {
      title: "QC257 Edit Run",
      stops: [{ name: "Stop A", city: "Berkeley" }],
    });
    check("create 201", created.status === 201, `status=${created.status}`);
    slug = created.json?.slug ?? null;

    // Edit drive-level fields (entity decode on the way in).
    const up = await c.req("PATCH", `/api/drive-lists/${slug}`, {
      body: { title: "QC257 Renamed &amp; Done", status: "completed", notes: ["note one", "note two"] },
    });
    check("PATCH drive fields 200", up.status === 200, `status=${up.status}`);
    let drive = (await c.get(`/api/drive-lists/${slug}`)).json;
    check("title edited + entity-decoded", drive?.title === "QC257 Renamed & Done", `title=${JSON.stringify(drive?.title)}`);
    check("status edited", drive?.status === "completed", `status=${drive?.status}`);
    check("notes replaced (2)", Array.isArray(drive?.notes) && drive.notes.length === 2, `notes=${JSON.stringify(drive?.notes)}`);

    // status→completed clears the active pointer (deactivation is ungated); a
    // field edit never ACTIVATES, so the 07:00-20:00 window can't be bypassed.
    check("completed edit is not left active", drive?.isActive !== true, `isActive=${drive?.isActive}`);

    // Add a stop.
    const add = await c.post(`/api/drive-lists/${slug}/stops`, {
      stops: [{ name: "Stop B &amp; Co", city: "Oakland", isOptional: true }],
    });
    check("add stop 201", add.status === 201, `status=${add.status}`);
    check("stopCount now 2", add.json?.stopCount === 2, `stopCount=${add.json?.stopCount}`);
    drive = (await c.get(`/api/drive-lists/${slug}`)).json;
    const added = drive.stops.find((s) => s.name === "Stop B & Co");
    check("added stop is entity-decoded + optional(kind)", added && added.kind === "optional", `added=${JSON.stringify(added?.kind)}`);

    // Edit that stop — skip it.
    const es = await c.req("PATCH", `/api/drive-lists/${slug}/stops/${added.id}`, { body: { skipped: true, hours: "Fri 9–5" } });
    check("edit stop 200", es.status === 200, `status=${es.status}`);
    drive = (await c.get(`/api/drive-lists/${slug}`)).json;
    const edited = drive.stops.find((s) => s.id === added.id);
    check("stop skipped + hours set", edited?.skipped === true && edited?.hours === "Fri 9–5", JSON.stringify({ skipped: edited?.skipped, hours: edited?.hours }));

    // Delete the stop.
    const del = await c.req("DELETE", `/api/drive-lists/${slug}/stops/${added.id}`);
    check("delete stop 200", del.status === 200, `status=${del.status}`);
    drive = (await c.get(`/api/drive-lists/${slug}`)).json;
    check("stop removed", !drive.stops.some((s) => s.id === added.id), `remaining=${drive.stops.length}`);
  } finally {
    if (slug) {
      d1(`DELETE FROM drive_lists WHERE slug = '${slug.replace(/'/g, "''")}';`);
      info(`cleaned up ${slug}`);
    }
  }
  summary();
}
