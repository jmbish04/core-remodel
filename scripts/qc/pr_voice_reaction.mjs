#!/usr/bin/env node
/**
 * QC for Phase D2 — voice/text reaction → transcript + AI style summary.
 * Run: node scripts/qc/pr_voice_reaction.mjs --preview   (or bare for prod)
 *
 * Uses the `transcript` path (deterministic — Whisper on real audio is
 * non-deterministic and needs a fixture; the audio→transcript step is the
 * already-battle-tested transcribeAudioBase64). Asserts the endpoint stores the
 * transcript and a parseable, non-empty AI style summary on the candidate.
 */
import { execFileSync } from "node:child_process";
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC voice-reaction against ${BASE}\n`);

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "core-remodel", "--remote", "--json", `--command=${sql}`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const m = out.match(/\[\s*{[\s\S]*}\s*\]/);
  return m ? JSON.parse(m[0])[0].results : [];
}

let bucketId = null;
const TRANSCRIPT = "I really love the matte black finish and the clean modern shape, but the price feels too high for this faucet.";

try {
  const showroomId = d1("SELECT id FROM showroom_stores LIMIT 1;")[0]?.id;
  d1(`INSERT INTO product_photo_buckets (showroom_id, kind, status, label) VALUES (${showroomId}, 'single', 'processed', 'QC D2 bucket');`);
  bucketId = d1(`SELECT id FROM product_photo_buckets WHERE label = 'QC D2 bucket' ORDER BY id DESC LIMIT 1;`)[0]?.id;
  d1(`INSERT INTO bucket_product_candidates (bucket_id, rank, brand_name_raw, product_name, status) VALUES (${bucketId}, 0, 'Kohler', 'Purist Faucet', 'pending');`);
  const candId = d1(`SELECT id FROM bucket_product_candidates WHERE bucket_id = ${bucketId} LIMIT 1;`)[0]?.id;
  check("seeded candidate", Number.isFinite(candId), `candId=${candId}`);

  // Missing body → 400.
  const bad = await c.post(`/api/intake/candidates/${candId}/voice-reaction`, {});
  check("no audio/transcript → 400", bad.status === 400, `status=${bad.status}`);

  // Transcript path.
  const res = await c.post(`/api/intake/candidates/${candId}/voice-reaction`, { transcript: TRANSCRIPT });
  check("voice-reaction 200", res.status === 200, `status=${res.status} ${res.text?.slice(0, 160)}`);
  check("transcript echoed", res.json?.transcript === TRANSCRIPT, JSON.stringify(res.json?.transcript)?.slice(0, 120));
  const sum = res.json?.summary;
  check("AI summary returned with a non-empty summary string", !!sum && typeof sum.summary === "string" && sum.summary.length > 0, JSON.stringify(sum)?.slice(0, 200));

  // Persisted + parseable via GET candidates.
  const cand = (await c.get(`/api/intake/buckets/${bucketId}/candidates`)).json?.candidates?.[0];
  check("transcript persisted on candidate", cand?.reactionTranscript === TRANSCRIPT, `stored=${cand?.reactionTranscript?.slice(0, 60)}`);
  check("reactionSummary persisted + parsed to object", cand?.reactionSummary && typeof cand.reactionSummary === "object" && typeof cand.reactionSummary.summary === "string", JSON.stringify(cand?.reactionSummary)?.slice(0, 200));
  info(`summary: ${JSON.stringify(sum)?.slice(0, 200)}`);
} finally {
  if (Number.isFinite(bucketId)) {
    d1(`DELETE FROM bucket_product_candidates WHERE bucket_id = ${bucketId};`);
    d1(`DELETE FROM product_photo_buckets WHERE id = ${bucketId};`);
  }
  info(`cleaned up bucket ${bucketId ?? "(none)"}`);
}

process.exit(summary().failed === 0 ? 0 : 1);
