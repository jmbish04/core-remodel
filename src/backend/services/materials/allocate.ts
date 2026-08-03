/**
 * @fileoverview Joint whole-receipt → room allocation (0030 sharpening).
 *
 * The shipped `deduceRoom` reasons about ONE line at a time. A receipt of
 * 1 TOTO + 2 Kohler toilets therefore proposed all three to the Primary bath —
 * each line, deduced in isolation on a fresh project, ranked Primary first with
 * nothing telling line B that line A already claimed it.
 *
 * This allocator reasons about the WHOLE receipt against the WHOLE house in one
 * pass, the way an owner's rep would, weighing four signals per line:
 *
 *   1. HOMOGENEITY — are the units identical (a matched set → one room, or the
 *      matching secondary rooms) or different (independent items → separate rooms)?
 *      Computed deterministically from product identity BEFORE the model sees it.
 *   2. PRODUCT NATURE → APPLICATIONS — brand/model/style/price imply the SET of
 *      uses a product could serve, and rule out those its nature forbids (a small
 *      or decorative tile is not a floor; a premium fixture leans primary).
 *   3. MEASURE AS A SOFT CLUE — quantity/area weighed against each candidate room's
 *      real dimensions, but never as a fit: over-ordering is customary and tile may
 *      cover only an accent wall. It narrows the guess, it does not gate it.
 *   4. OPEN SLOT — of the rooms that afford a plausible application, prefer one
 *      whose relevant application is still unallocated on the floorplan.
 *
 * The deterministic elimination (already-sourced / dormant / previously-confirmed)
 * runs FIRST as a pre-filter, so the model can only rank the eligible survivors —
 * it can never invent a room or override a hard exclusion. And distinct-room
 * assignment is enforced in CODE after the model returns, never trusted from it.
 *
 * Everything here is an EDUCATED GUESS staged for a human to confirm or swap.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { Type, type Schema } from "@google/genai";

import {
  materialRoomProposals,
  materialScheduleItems,
  materialSubcategories,
  type RoomCandidate,
} from "@backend/db/schema/materials/index";
import { subcategories } from "@backend/db/schema/config/subcategories";
import { rooms } from "@backend/db/schema/home/rooms";
import { floors } from "@backend/db/schema/home/floors";
import { computeRoomAreaSqFt } from "@backend/services/room-geometry";
import { workerEmailInvoiceLineItems } from "@backend/db/schema/emails/worker_email_invoice_line_items";
import { workerEmailInvoices } from "@backend/db/schema/emails/worker_email_invoices";
import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";

import { inChunks, roomMatcherForSubcategory } from "./deduction";

type Db = ReturnType<typeof drizzle>;

// ─── room context (built once per receipt) ──────────────────────────────────

interface RoomInfo {
  id: number;
  roomName: string;
  floorName: string | null;
  areaSqFt: number | null;
  lengthFeet: number | null;
  widthFeet: number | null;
  /** Subcategory ids already materialized in this room — the elimination signal. */
  materializedSubcategoryIds: Set<number>;
  /** What's already sourced here, for the open-slot map handed to the model. */
  materializedApplications: { subcategoryId: number | null; title: string }[];
  hasAnyMaterial: boolean;
}

interface RoomContext {
  active: RoomInfo[];
  byId: Map<number, RoomInfo>;
  /** subcategoryId → room ids a human already confirmed for that type (learning). */
  confirmedBySub: Map<number, Set<number>>;
}

/**
 * Load everything the allocator reasons over, in a handful of batched queries —
 * active rooms with dimensions + floor names, every room's already-materialized
 * applications (the open-slot map), and the confirmed-mapping history.
 */
export async function buildRoomContext(db: Db): Promise<RoomContext> {
  const roomRows = await db
    .select({
      id: rooms.id,
      roomName: rooms.roomName,
      floorName: floors.name,
      lengthFeet: rooms.lengthFeet,
      lengthInches: rooms.lengthInches,
      widthFeet: rooms.widthFeet,
      widthInches: rooms.widthInches,
    })
    .from(rooms)
    .leftJoin(floors, eq(rooms.floorId, floors.id))
    .where(eq(rooms.isActive, true))
    .all();

  const byId = new Map<number, RoomInfo>();
  const active: RoomInfo[] = roomRows.map((r) => {
    const info: RoomInfo = {
      id: r.id,
      roomName: r.roomName,
      floorName: r.floorName ?? null,
      areaSqFt: computeRoomAreaSqFt(r),
      lengthFeet: r.lengthFeet ?? null,
      widthFeet: r.widthFeet ?? null,
      materializedSubcategoryIds: new Set<number>(),
      materializedApplications: [],
      hasAnyMaterial: false,
    };
    byId.set(r.id, info);
    return info;
  });

  const roomIds = active.map((r) => r.id);
  if (roomIds.length > 0) {
    // Every material in these rooms + its subcategory (if tagged). One left join,
    // chunked. Populates hasAnyMaterial, materializedSubcategoryIds, and the
    // open-slot application list.
    const mats = await inChunks(roomIds, (chunk) =>
      db
        .select({
          roomId: materialScheduleItems.roomId,
          title: materialScheduleItems.title,
          subcategoryId: materialSubcategories.subcategoryId,
        })
        .from(materialScheduleItems)
        .leftJoin(
          materialSubcategories,
          eq(materialSubcategories.materialId, materialScheduleItems.id),
        )
        .where(inArray(materialScheduleItems.roomId, chunk))
        .all(),
    );
    for (const m of mats) {
      const room = byId.get(m.roomId);
      if (!room) continue;
      room.hasAnyMaterial = true;
      room.materializedApplications.push({ subcategoryId: m.subcategoryId ?? null, title: m.title });
      if (m.subcategoryId != null) room.materializedSubcategoryIds.add(m.subcategoryId);
    }
  }

  const confirmedRows = await db
    .select({
      subcategoryId: materialRoomProposals.subcategoryId,
      roomId: materialRoomProposals.confirmedRoomId,
    })
    .from(materialRoomProposals)
    .where(
      and(
        inArray(materialRoomProposals.status, ["confirmed", "auto_confirmed", "overridden"]),
        isNotNull(materialRoomProposals.confirmedRoomId),
        isNotNull(materialRoomProposals.subcategoryId),
      ),
    )
    .all();
  const confirmedBySub = new Map<number, Set<number>>();
  for (const c of confirmedRows) {
    if (c.subcategoryId == null || c.roomId == null) continue;
    if (!confirmedBySub.has(c.subcategoryId)) confirmedBySub.set(c.subcategoryId, new Set());
    confirmedBySub.get(c.subcategoryId)!.add(c.roomId);
  }

  return { active, byId, confirmedBySub };
}

// ─── eligibility pre-filter (pure, over the context) ─────────────────────────

/**
 * The deterministic elimination for ONE line, as a pure function over the loaded
 * context — the same Steps 1–4 the single-line `deduceRoom` runs, but sharing the
 * batched context so a whole receipt costs one load, not N.
 *
 * Returns the surviving candidate rooms (kept=true) plus a trace of what was cut
 * and why. Dormant elimination is intentionally skipped here for the joint pass:
 * with multiple lines placing into distinct rooms, a room that is empty *now* may
 * be exactly where a sibling line belongs, so we let the model weigh it rather
 * than cutting it. Already-sourced and previously-confirmed cuts still apply —
 * those are hard facts, not heuristics.
 */
export function eligibleRoomsForLine(
  ctx: RoomContext,
  subcategoryId: number | null,
  subName: string | null,
): { eligible: RoomCandidate[]; trace: string[] } {
  const matcher = roomMatcherForSubcategory(subName);
  const typeLabel = subName ?? "material";
  const trace: string[] = [];

  const candidates: RoomCandidate[] = ctx.active
    .filter((r) => !matcher || matcher(r.roomName))
    .map((r) => ({ roomId: r.id, roomName: r.roomName, kept: true, score: 50, evidence: "" }));

  trace.push(
    matcher
      ? `A ${typeLabel} belongs in a bathroom — ${candidates.length} active bathroom(s) in scope.`
      : `No room-type constraint for a ${typeLabel} — every active room is a candidate.`,
  );

  if (subcategoryId != null) {
    const takenSourced = new Set<number>();
    for (const c of candidates) {
      if (ctx.byId.get(c.roomId)?.materializedSubcategoryIds.has(subcategoryId)) {
        c.kept = false;
        c.score = 0;
        c.evidence = `Already has a ${typeLabel} sourced — eliminated.`;
        takenSourced.add(c.roomId);
      }
    }
    if (takenSourced.size > 0) trace.push(`${takenSourced.size} room(s) already have a ${typeLabel}; ruled out.`);

    const confirmed = ctx.confirmedBySub.get(subcategoryId);
    if (confirmed) {
      let n = 0;
      for (const c of candidates) {
        if (c.kept && confirmed.has(c.roomId)) {
          c.kept = false;
          c.score = 0;
          c.evidence = `A ${typeLabel} was already confirmed for this room previously — ruled out.`;
          n++;
        }
      }
      if (n > 0) trace.push(`${n} room(s) already confirmed for a ${typeLabel}; ruled out.`);
    }
  }

  return { eligible: candidates.filter((c) => c.kept), trace };
}

// ─── line facts (homogeneity + attributes, deterministic) ────────────────────

export interface LineFact {
  lineItemId: number;
  description: string;
  quantity: number;
  unitPriceCents: number | null;
  subcategoryId: number | null;
  subName: string | null;
  brand: string | null;
  model: string | null;
  variant: string | null;
  /** Units within THIS line are always the same product, so identical whenever qty>1. */
  identicalWithinLine: boolean;
  /** Stable cluster key: lines sharing it are the same product bought separately. */
  matchGroupId: string;
}

/** Normalize a product identity into a comparison key. */
function identityKey(f: { brand?: string | null; model?: string | null; description: string }): string {
  const bm = `${f.brand ?? ""} ${f.model ?? ""}`.trim().toLowerCase();
  const base = bm || f.description.toLowerCase();
  return base.replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Build per-line facts, enriching brand/model/variant from the invoice's
 * `lineItemsJson` (the receipt extraction keeps them there even though the
 * line-item TABLE only stores description/qty/price), and clustering lines that
 * are the same product into a shared `matchGroupId`.
 */
export function computeLineFacts(
  lines: {
    id: number;
    description: string | null;
    quantity: number | null;
    unitPrice: number | null;
    subcategoryId: number | null;
    subName: string | null;
  }[],
  extractedLineItems: { description?: string; brand?: string; modelNumber?: string; variant?: string }[],
): LineFact[] {
  // Match an extracted item to a persisted line by description (best-effort).
  const findExtracted = (desc: string) =>
    extractedLineItems.find(
      (e) => (e.description ?? "").trim().toLowerCase() === desc.trim().toLowerCase(),
    ) ?? null;

  const facts = lines.map((l) => {
    const description = (l.description ?? "").trim();
    const ext = findExtracted(description);
    const brand = ext?.brand?.trim() || null;
    const model = ext?.modelNumber?.trim() || null;
    const variant = ext?.variant?.trim() || null;
    const quantity = l.quantity && l.quantity > 0 ? Math.round(l.quantity) : 1;
    return {
      lineItemId: l.id,
      description: description || "Material",
      quantity,
      unitPriceCents:
        l.unitPrice != null ? Math.round(l.unitPrice * 100) : null,
      subcategoryId: l.subcategoryId,
      subName: l.subName,
      brand,
      model,
      variant,
      identicalWithinLine: quantity > 1,
      matchGroupId: identityKey({ brand, model, description }),
    } satisfies LineFact;
  });

  return facts;
}

// ─── the joint allocation pass ───────────────────────────────────────────────

export interface Assignment {
  lineItemId: number;
  unitIndex: number;
  proposedRoomId: number | null;
  /** True = this line's quantity stays together in one room (one material carrying qty). */
  grouped: boolean;
  quantity: number;
  subcategoryId: number | null;
  categoryId: number | null;
  application: string | null;
  reasoning: string;
  confidence: number;
  /** The eligible candidate set at allocation time — frozen onto the proposal. */
  candidates: RoomCandidate[];
}

export interface AllocationPlan {
  assignments: Assignment[];
  summary: string;
}

const ALLOC_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          lineItemId: { type: Type.NUMBER },
          /** "group" = keep the quantity in ONE room; "split" = one unit per room. */
          disposition: { type: Type.STRING, enum: ["group", "split"] },
          application: { type: Type.STRING },
          /** Room ids in priority order — for "split", the first N are the N units. */
          roomIdsInPriority: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          reasoning: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ["lineItemId", "disposition", "roomIdsInPriority", "reasoning", "confidence"],
      },
    },
    summary: { type: Type.STRING },
  },
  required: ["lines", "summary"],
};

function roomDims(r: RoomInfo): string {
  const bits: string[] = [];
  if (r.areaSqFt != null) bits.push(`~${Math.round(r.areaSqFt)} sqft`);
  if (r.lengthFeet != null && r.widthFeet != null) bits.push(`${r.lengthFeet}×${r.widthFeet} ft`);
  return bits.length ? ` (${bits.join(", ")})` : "";
}

/**
 * Build the allocation prompt — the encoded judgement. Hands the model every
 * line's facts, its eligible rooms with dimensions, and the open-slot map, and
 * asks for a per-line disposition (group vs split) + room ranking with reasoning.
 */
function buildAllocationPrompt(
  facts: LineFact[],
  eligibleByLine: Map<number, RoomCandidate[]>,
  ctx: RoomContext,
): string {
  const roomLine = (roomId: number) => {
    const r = ctx.byId.get(roomId);
    if (!r) return `- id ${roomId}`;
    const floor = r.floorName ? ` [${r.floorName}]` : "";
    const already = r.materializedApplications.length
      ? ` — already sourced: ${r.materializedApplications.map((a) => a.title).slice(0, 6).join(", ")}`
      : " — nothing sourced here yet";
    return `- id ${r.id}: ${r.roomName}${floor}${roomDims(r)}${already}`;
  };

  const lineBlocks = facts.map((f) => {
    const eligible = eligibleByLine.get(f.lineItemId) ?? [];
    const attrs = [
      f.brand && `brand ${f.brand}`,
      f.model && `model ${f.model}`,
      f.variant && `variant ${f.variant}`,
      f.unitPriceCents != null && `unit price $${(f.unitPriceCents / 100).toFixed(2)}`,
    ]
      .filter(Boolean)
      .join(", ");
    return `LINE ${f.lineItemId} — "${f.description}"
  quantity: ${f.quantity}${f.quantity > 1 ? " (identical units — same product)" : ""}
  type: ${f.subName ?? "unclassified"}${attrs ? `\n  attributes: ${attrs}` : ""}
  matchGroup: ${f.matchGroupId}
  eligible rooms:
${eligible.length ? eligible.map((c) => `    ${roomLine(c.roomId)}`).join("\n") : "    (none survived elimination — leave unassigned)"}`;
  });

  return `You are an experienced owner's representative placing the items from ONE purchase
receipt into the rooms of a home renovation. Reason about the WHOLE receipt at
once so identical items spread across matching rooms and no two identical fixtures
land in the same room while other suitable rooms are open.

For EACH line decide two things:

1. DISPOSITION — "group" or "split":
   - "group": the quantity belongs together in ONE room. Choose this when the
     units form a set for a single space — a matched pair of sinks for a
     double-vanity (which in most homes means the PRIMARY suite bathroom), three
     identical pendants over one kitchen island, bulk tile/flooring for one floor.
   - "split": the quantity is one-per-room. Choose this for discrete per-room
     fixtures bought in multiples — three toilets across three bathrooms, matching
     vanity lights for several rooms.
   Decide from the product's NATURE and the room list, never from a fixed rule.

2. roomIdsInPriority — room ids from the line's eligible list, most to least
   likely. For "split", the first N ids (N = quantity) are the chosen rooms, one
   unit each; keep them DISTINCT. For "group", the first id is the chosen room.

Apply real judgement:
  - HOMOGENEITY: identical units (same model) → a matched set (group into the
    room that uses a set, e.g. a double vanity → primary bath) OR the matching
    secondary rooms (split identical toilets → the non-primary baths, the premium
    one → primary). Different items → independent, separate rooms.
  - PRODUCT NATURE → APPLICATION: infer the SET of uses the product could serve
    from its type/brand/model/price and RULE OUT what its nature forbids — a small
    or decorative/textured tile is not a room floor; a large matte porcelain
    plausibly is; a premium integrated fixture leans toward the primary suite.
  - MEASURE AS A CLUE, NOT A FIT: weigh a line's quantity/area against each room's
    dimensions shown above, but over-ordering is customary and an application can
    be partial (an accent wall, a niche). Let measure NARROW the guess; never
    require an exact fit.
  - OPEN SLOT: prefer a room whose relevant application is still unsourced (see
    "already sourced" per room). A kitchen island with no lighting yet is the
    natural home for a set of identical pendants.

Return "application" as a short phrase for the inferred use (e.g. "primary bath
floor", "island lighting", "guest bath toilet"), a one-to-two sentence "reasoning"
naming the homogeneity call + application + why that room, and a 0–100 confidence.
Use ONLY the eligible room ids listed per line; never invent an id. Everything is
an educated guess a human will confirm.

RECEIPT LINES:
${lineBlocks.join("\n\n")}

Return your allocation as JSON.`;
}

/**
 * Allocate every unmatched line of a receipt to rooms in one joint reasoning pass.
 *
 * Loads the room context once, computes deterministic line facts + per-line
 * eligibility, asks the model for a disposition + ranked rooms, then in CODE:
 * validates every room id against that line's eligible set, expands a "split"
 * into one assignment per unit, and enforces distinctness — no two units of the
 * same SUBCATEGORY (two toilets, whatever the brand) may claim the same room, so
 * each takes the next unclaimed room from its ranked pool, leaving a unit
 * unassigned rather than doubling up when the distinct rooms run out.
 */
export async function allocateReceipt(
  db: Db,
  env: Env,
  facts: LineFact[],
  ctx: RoomContext,
  taxonomyByLine: Map<number, { subcategoryId: number | null; categoryId: number | null }>,
): Promise<AllocationPlan> {
  if (facts.length === 0) return { assignments: [], summary: "No lines to allocate." };

  const eligibleByLine = new Map<number, RoomCandidate[]>();
  for (const f of facts) {
    eligibleByLine.set(f.lineItemId, eligibleRoomsForLine(ctx, f.subcategoryId, f.subName).eligible);
  }

  const prompt = buildAllocationPrompt(facts, eligibleByLine, ctx);
  let modelLines: {
    lineItemId: number;
    disposition: "group" | "split";
    application?: string;
    roomIdsInPriority: number[];
    reasoning: string;
    confidence: number;
  }[] = [];
  let summary = "";
  try {
    const ai = await createGeminiAiGatewayClient(env, "material_receipt_allocation");
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", responseSchema: ALLOC_SCHEMA, temperature: 0.2 },
    });
    const parsed = JSON.parse(res.text || "{}") as {
      lines?: typeof modelLines;
      summary?: string;
    };
    modelLines = parsed.lines ?? [];
    summary = parsed.summary ?? "";
  } catch (err) {
    console.error("[allocate] joint allocation failed; falling back to per-line eligible order:", err);
  }

  const modelByLine = new Map(modelLines.map((m) => [m.lineItemId, m]));

  const assignments: Assignment[] = [];
  // Track claimed rooms per DISTINCTNESS KEY so no two units that cannot share a
  // room land in the same one. The key is the SUBCATEGORY, not the match group:
  // two toilets cannot share a bathroom regardless of brand, so a TOTO and a
  // different-brand toilet on one receipt must still take distinct rooms. Only
  // when a line has no subcategory do we fall back to its match group (identical
  // unclassified items) so at least the truly-identical ones don't collide.
  const claimedByKey = new Map<string, Set<number>>();
  const distinctnessKey = (f: LineFact) =>
    f.subcategoryId != null ? `sub:${f.subcategoryId}` : `grp:${f.matchGroupId}`;

  for (const f of facts) {
    const eligible = eligibleByLine.get(f.lineItemId) ?? [];
    const eligibleIds = new Set(eligible.map((c) => c.roomId));
    const tax = taxonomyByLine.get(f.lineItemId) ?? { subcategoryId: f.subcategoryId, categoryId: null };
    const m = modelByLine.get(f.lineItemId);

    // Validate the model's room ids against this line's eligible set; fall back to
    // the eligible order when the model gave nothing usable.
    const ranked = (m?.roomIdsInPriority ?? [])
      .filter((id) => eligibleIds.has(id))
      .filter((id, i, a) => a.indexOf(id) === i);
    const pool = ranked.length ? ranked : eligible.map((c) => c.roomId);
    const grouped = (m?.disposition ?? (f.quantity > 1 ? "split" : "group")) === "group" || f.quantity <= 1;
    const application = m?.application?.trim() || null;
    const reasoning = m?.reasoning?.trim() || "Placed by eligible-room order (model gave no ranking).";
    const confidence = Math.max(0, Math.min(100, Math.round(m?.confidence ?? 40)));

    const key = distinctnessKey(f);
    if (!claimedByKey.has(key)) claimedByKey.set(key, new Set());
    const claimed = claimedByKey.get(key)!;

    if (grouped) {
      // The whole quantity in one room — one material carrying qty.
      const roomId = pool.find((id) => !claimed.has(id)) ?? pool[0] ?? null;
      if (roomId != null) claimed.add(roomId);
      assignments.push({
        lineItemId: f.lineItemId,
        unitIndex: 0,
        proposedRoomId: roomId,
        grouped: true,
        quantity: f.quantity,
        subcategoryId: tax.subcategoryId,
        categoryId: tax.categoryId,
        application,
        reasoning,
        confidence,
        candidates: eligible,
      });
      continue;
    }

    // Split: one unit per DISTINCT room, greedily, while distinct rooms remain.
    for (let unit = 0; unit < f.quantity; unit++) {
      const roomId = pool.find((id) => !claimed.has(id)) ?? null;
      if (roomId != null) claimed.add(roomId);
      assignments.push({
        lineItemId: f.lineItemId,
        unitIndex: unit,
        proposedRoomId: roomId, // null when the distinct pool is exhausted — stays staged, no room
        grouped: false,
        quantity: 1,
        subcategoryId: tax.subcategoryId,
        categoryId: tax.categoryId,
        application,
        reasoning:
          roomId != null
            ? reasoning
            : `${reasoning} No distinct eligible room left for this unit — left unplaced for you to assign.`,
        confidence: roomId != null ? confidence : Math.min(confidence, 30),
        candidates: eligible,
      });
    }
  }

  return {
    assignments,
    summary: summary || `Allocated ${assignments.length} unit(s) across the receipt.`,
  };
}
