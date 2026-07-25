/**
 * @fileoverview Receipt line item → material, with room deduction (0030).
 *
 * A receipt extracts into line items ("2× Kohler Fora Toilet"), but the receipt
 * never says WHICH of the three bathrooms a toilet belongs to. This service
 * promotes a line item to a typed material and then reasons about its room by
 * ELIMINATION — cheap deterministic steps first, an AI model only for the
 * ambiguous remainder — staging the argument for a human rather than guessing
 * silently. A wrong room propagates into budget and takeoffs with nothing
 * downstream able to tell it was a guess, so the bar is "show your work", not
 * "be confident".
 *
 * The public surface:
 *   - promoteLineItem  — line item → material (+ optional taxonomy)
 *   - deduceRoom       — the ordered elimination + AI rank
 *   - stageProposal    — persist the proposal; auto-confirm a single survivor
 *   - resolveProposal  — a human confirms/overrides; the ONE write of roomId
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { drizzle } from "drizzle-orm/d1";
import { Type, type Schema } from "@google/genai";
import type { BatchItem } from "drizzle-orm/batch";

import {
  materialCategories,
  materialRoomProposals,
  materialScheduleItems,
  materialSubcategories,
  type RoomCandidate,
} from "@backend/db/schema/materials/index";
import { subcategories } from "@backend/db/schema/config/subcategories";
import { rooms } from "@backend/db/schema/home/rooms";
import { workerEmailInvoiceLineItems } from "@backend/db/schema/emails/worker_email_invoice_line_items";
import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";

type Db = ReturnType<typeof drizzle>;

/** D1 caps a statement at 100 bound params; inArray binds one per id. */
const CHUNK = 90;

export async function inChunks<T>(ids: number[], fetch: (chunk: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetch(ids.slice(i, i + CHUNK))));
  return out;
}

// ─── Room-type heuristic ──────────────────────────────────────────────────────

/**
 * Which rooms a material of this type can plausibly live in.
 *
 * The vocabulary has no room-type column, so this is a name heuristic: plumbing
 * fixtures belong in bathrooms. Returns a matcher over `roomName`, or null when
 * the type does not constrain the room (candidate = every active room).
 *
 * Deliberately small and readable rather than exhaustive — a wrong include is
 * recoverable (the reviewer drops it), a wrong exclude hides the right answer.
 */
export function roomMatcherForSubcategory(name: string | null): ((roomName: string) => boolean) | null {
  const n = (name ?? "").toLowerCase();
  const bathroomTypes = ["toilet", "faucet", "shower valve", "shower head", "sink", "bathtub", "drain"];
  if (bathroomTypes.includes(n)) {
    return (roomName) => /bath|powder/i.test(roomName);
  }
  return null;
}

// ─── promote ──────────────────────────────────────────────────────────────────

export interface PromoteResult {
  materialId: number;
  title: string;
}

/**
 * Mint a material for a receipt line item, into a KNOWN room.
 *
 * Called only once the room is decided — the single-survivor auto-confirm, or a
 * human resolving a proposal. Never called while the room is ambiguous, because
 * `material_schedule_items.roomId` is NOT NULL and a placeholder room would be
 * the exact lie the FK rule forbids.
 *
 * Creates the material, links the line item back
 * (`material_schedule_item_id`, `match_status="created"`), and tags its type.
 * Sequential with a compensating delete: D1 has no transactions and `batch()`
 * cannot feed the material's generated id into the line-item update, so a failed
 * link removes the orphaned material rather than leaving it dangling.
 */
export async function promoteLineItem(
  db: Db,
  lineItemId: number,
  opts: {
    roomId: number;
    subcategoryId?: number | null;
    categoryId?: number | null;
    /** Units of the same product placed together in this one room (grouped). Null = 1. */
    quantity?: number | null;
  },
): Promise<PromoteResult> {
  const [line] = await db
    .select()
    .from(workerEmailInvoiceLineItems)
    .where(eq(workerEmailInvoiceLineItems.id, lineItemId))
    .limit(1);
  if (!line) throw new Error(`Line item ${lineItemId} not found`);

  const title = (line.description ?? "Material").trim().slice(0, 200) || "Material";
  // Normalize quantity: only store a real group size (>1); 1 or null stay null.
  const quantity = opts.quantity && opts.quantity > 1 ? Math.round(opts.quantity) : null;

  const [material] = await db
    .insert(materialScheduleItems)
    .values({
      title,
      roomId: opts.roomId,
      quantity,
      // Provenance for the many-materials-per-line case: the line's single
      // material FK cannot point at every material a split qty-N line mints.
      sourceLineItemId: lineItemId,
      isPurchased: true,
      notes: `Promoted from receipt line item #${lineItemId}.`,
    })
    .returning();

  try {
    const stmts: BatchItem<"sqlite">[] = [
      db
        .update(workerEmailInvoiceLineItems)
        .set({ materialScheduleItemId: material.id, matchStatus: "created", updatedAt: new Date() })
        .where(eq(workerEmailInvoiceLineItems.id, lineItemId)),
    ];
    if (opts.categoryId) {
      stmts.push(db.insert(materialCategories).values({ materialId: material.id, categoryId: opts.categoryId }));
    }
    if (opts.subcategoryId) {
      stmts.push(
        db.insert(materialSubcategories).values({ materialId: material.id, subcategoryId: opts.subcategoryId }),
      );
    }
    await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (err) {
    try {
      await db.delete(materialScheduleItems).where(eq(materialScheduleItems.id, material.id));
    } catch {
      console.error(`[deduction] orphaned material ${material.id} — link failed and cleanup failed`);
    }
    throw err;
  }

  return { materialId: material.id, title };
}

// ─── deduce ───────────────────────────────────────────────────────────────────

export interface DeductionResult {
  candidates: RoomCandidate[];
  proposedRoomId: number | null;
  confidence: number;
  reasoningMarkdown: string;
  /** True only when exactly one room survives elimination — unambiguous. */
  autoConfirm: boolean;
}

/**
 * Rank the candidate rooms for a material, recording why each was kept or cut.
 *
 * The order is deliberate — every deterministic cut runs before the AI sees
 * anything, so the model can only rank survivors, never invent an elimination:
 *   1. candidate set by type (bathrooms, for a toilet)
 *   2. eliminate rooms that already have this material type sourced
 *   3. eliminate dormant rooms (no materials at all) — skipped if ALL are dormant
 *   4. eliminate rooms a human already confirmed for this type (the learning step)
 *   5. rank survivors: 1 → auto-confirm; >1 → AI; 0 → nothing to propose
 */
export async function deduceRoom(
  db: Db,
  env: Env,
  input: {
    /** What the material will be called — the line item description. */
    title: string;
    subcategoryId: number | null;
    quantity: number | null;
    receiptContext?: string;
  },
): Promise<DeductionResult> {
  const subName = input.subcategoryId
    ? (await db.select().from(subcategories).where(eq(subcategories.id, input.subcategoryId)).limit(1))[0]?.name ?? null
    : null;

  // Step 1 — candidate set by type.
  const activeRooms = await db.select().from(rooms).where(eq(rooms.isActive, true)).all();
  const matcher = roomMatcherForSubcategory(subName);
  let candidates: RoomCandidate[] = activeRooms
    .filter((r) => !matcher || matcher(r.roomName))
    .map((r) => ({ roomId: r.id, roomName: r.roomName, kept: true, score: 50, evidence: "" }));

  const typeLabel = subName ?? "material";
  const trace: string[] = [];
  if (matcher) {
    trace.push(`A ${typeLabel} belongs in a bathroom — ${candidates.length} active bathroom(s) in scope.`);
  } else {
    trace.push(`No room-type constraint for a ${typeLabel} — every active room is a candidate.`);
  }
  if (input.quantity && input.quantity > 1) {
    trace.push(`Quantity ${input.quantity}: expect this material across ${input.quantity} rooms.`);
  }

  const candidateIds = candidates.map((c) => c.roomId);

  // Step 2 — eliminate already-sourced. A room already holding this type is out.
  // (No self to exclude — the material for this line item is not created until
  // the room is resolved.)
  const subId = input.subcategoryId;
  if (subId && candidateIds.length > 0) {
    const sourced = await inChunks(candidateIds, (chunk) =>
      db
        .select({ roomId: materialScheduleItems.roomId })
        .from(materialSubcategories)
        .innerJoin(materialScheduleItems, eq(materialSubcategories.materialId, materialScheduleItems.id))
        .where(
          and(
            eq(materialSubcategories.subcategoryId, subId),
            inArray(materialScheduleItems.roomId, chunk),
          ),
        )
        .all(),
    );
    const sourcedRooms = new Set(sourced.map((s) => s.roomId));
    for (const c of candidates) {
      if (sourcedRooms.has(c.roomId)) {
        c.kept = false;
        c.score = 0;
        c.evidence = `Already has a ${typeLabel} sourced — eliminated.`;
      }
    }
    if (sourcedRooms.size > 0) trace.push(`${sourcedRooms.size} room(s) already have a ${typeLabel}; ruled out.`);
  }

  // Step 3 — eliminate dormant. A room with zero materials is likely not in the
  // remodel. Advisory: skipped when EVERY surviving room is dormant (a fresh
  // project), so it never eliminates the whole field.
  const stillIn = candidates.filter((c) => c.kept).map((c) => c.roomId);
  if (stillIn.length > 1) {
    const withMaterials = await inChunks(stillIn, (chunk) =>
      db
        .select({ roomId: materialScheduleItems.roomId })
        .from(materialScheduleItems)
        .where(inArray(materialScheduleItems.roomId, chunk))
        .all(),
    );
    const active = new Set(withMaterials.map((r) => r.roomId));
    const anyActive = candidates.some((c) => c.kept && active.has(c.roomId));
    if (anyActive) {
      for (const c of candidates) {
        if (c.kept && !active.has(c.roomId)) {
          c.kept = false;
          c.score = 0;
          c.evidence = "No materials sourced for this room yet — likely not part of this remodel.";
        }
      }
      trace.push("Rooms with no materials of any kind ruled out as not-in-scope.");
    }
  }

  // Step 4 — learning: eliminate rooms a human already confirmed for this type.
  if (subId) {
    const confirmedRows = await db
      .select({ roomId: materialRoomProposals.confirmedRoomId })
      .from(materialRoomProposals)
      .where(
        and(
          eq(materialRoomProposals.subcategoryId, subId),
          inArray(materialRoomProposals.status, ["confirmed", "auto_confirmed", "overridden"]),
          isNotNull(materialRoomProposals.confirmedRoomId),
        ),
      )
      .all();
    const taken = new Set(confirmedRows.map((r) => r.roomId).filter((x): x is number => x != null));
    for (const c of candidates) {
      if (c.kept && taken.has(c.roomId)) {
        c.kept = false;
        c.score = 0;
        c.evidence = `A ${typeLabel} was already confirmed for this room previously — ruled out.`;
      }
    }
    if (taken.size > 0) trace.push(`${taken.size} room(s) already confirmed for a ${typeLabel}; ruled out.`);
  }

  // Step 5 — rank survivors.
  const survivors = candidates.filter((c) => c.kept);

  if (survivors.length === 0) {
    return {
      candidates,
      proposedRoomId: null,
      confidence: 0,
      reasoningMarkdown: `${trace.join("\n\n")}\n\nNo room survives elimination — needs a human to place this ${typeLabel}.`,
      autoConfirm: false,
    };
  }

  if (survivors.length === 1) {
    survivors[0].score = 100;
    survivors[0].evidence = "Only room left after elimination.";
    return {
      candidates,
      proposedRoomId: survivors[0].roomId,
      confidence: 95,
      reasoningMarkdown: `${trace.join("\n\n")}\n\nExactly one room remains: **${survivors[0].roomName}**. Auto-confirmed.`,
      autoConfirm: true,
    };
  }

  // >1 survivor — the only step that needs a model.
  const ranked = await rankWithAi(env, {
    typeLabel,
    materialTitle: input.title,
    receiptContext: input.receiptContext ?? "",
    survivors: survivors.map((s) => ({ roomId: s.roomId, roomName: s.roomName })),
  });

  // Apply the AI ranking to the survivors; ids are validated inside rankWithAi.
  const byId = new Map(survivors.map((s) => [s.roomId, s]));
  ranked.order.forEach((roomId, i) => {
    const c = byId.get(roomId);
    if (c) {
      c.score = 100 - i * (100 / Math.max(1, ranked.order.length));
      c.evidence = ranked.rationale[roomId] ?? c.evidence;
    }
  });
  const top = ranked.order[0] != null ? byId.get(ranked.order[0]) : survivors[0];

  return {
    candidates,
    proposedRoomId: top?.roomId ?? survivors[0].roomId,
    confidence: ranked.confident ? 70 : 45,
    reasoningMarkdown: `${trace.join("\n\n")}\n\n${ranked.summary}`,
    autoConfirm: false,
  };
}

// ─── AI ranking ────────────────────────────────────────────────────────────────

const RANK_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    rankedRoomIds: { type: Type.ARRAY, items: { type: Type.NUMBER } },
    rationaleByRoomId: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { roomId: { type: Type.NUMBER }, reason: { type: Type.STRING } },
        required: ["roomId", "reason"],
      },
    },
    summary: { type: Type.STRING },
  },
  required: ["rankedRoomIds", "rationaleByRoomId", "summary"],
};

/**
 * Rank the surviving rooms with an AI model, from the receipt context.
 *
 * Returns room IDS, validated against the survivor set — a hallucinated id is
 * dropped, never applied. On any failure the survivors keep their input order
 * with `confident: false`, so a bad AI call degrades to "ask the human", never
 * to a silent wrong pick.
 */
async function rankWithAi(
  env: Env,
  input: {
    typeLabel: string;
    materialTitle: string;
    receiptContext: string;
    survivors: { roomId: number; roomName: string }[];
  },
): Promise<{ order: number[]; rationale: Record<number, string>; summary: string; confident: boolean }> {
  const validIds = new Set(input.survivors.map((s) => s.roomId));
  const fallback = {
    order: input.survivors.map((s) => s.roomId),
    rationale: {} as Record<number, string>,
    summary: `Could not rank ${input.survivors.length} candidate rooms automatically — a human should pick.`,
    confident: false,
  };

  const prompt = `You are helping a homeowner place a purchased fixture into the correct room of their remodel.

MATERIAL: ${input.materialTitle} (type: ${input.typeLabel})

RECEIPT CONTEXT:
${input.receiptContext || "(none)"}

CANDIDATE ROOMS (choose among these — use their exact ids, never invent one):
${input.survivors.map((s) => `- id ${s.roomId}: ${s.roomName}`).join("\n")}

Rank the rooms from most to least likely for THIS material, using judgement a
seasoned owner's rep would apply: a pricier or more luxurious unit tends to go in
the primary bath; identical units tend to go in the matching secondary baths.
Return every candidate id exactly once in rankedRoomIds, a one-sentence reason
per room, and a short summary of your reasoning.`;

  try {
    const ai = await createGeminiAiGatewayClient(env, "material_room_deduction");
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", responseSchema: RANK_SCHEMA, temperature: 0.2 },
    });
    const parsed = JSON.parse(res.text || "{}") as {
      rankedRoomIds?: number[];
      rationaleByRoomId?: { roomId: number; reason: string }[];
      summary?: string;
    };

    // Keep only valid ids, dedup, then append any survivor the model omitted so
    // the ranking always covers the full set.
    const seen = new Set<number>();
    const order: number[] = [];
    for (const id of parsed.rankedRoomIds ?? []) {
      if (validIds.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    for (const s of input.survivors) if (!seen.has(s.roomId)) order.push(s.roomId);
    if (order.length === 0) return fallback;

    const rationale: Record<number, string> = {};
    for (const r of parsed.rationaleByRoomId ?? []) {
      if (validIds.has(r.roomId)) rationale[r.roomId] = r.reason;
    }
    return { order, rationale, summary: parsed.summary || fallback.summary, confident: true };
  } catch (err) {
    console.error("[deduction] AI ranking failed:", err);
    return fallback;
  }
}

// ─── stage + resolve ──────────────────────────────────────────────────────────

/**
 * Persist a deduction as a proposal.
 *
 * Single-survivor case (`autoConfirm`): the room is unambiguous, so the material
 * is minted into it immediately and the proposal is recorded `auto_confirmed`
 * with its `materialId` set. Ambiguous case: NO material yet — the proposal
 * holds the line item + type + ranked candidates, `staged`, and the material is
 * minted when a human resolves it.
 */
export async function stageProposal(
  db: Db,
  input: {
    lineItemId: number;
    subcategoryId: number | null;
    categoryId?: number | null;
    deduction: DeductionResult;
  },
): Promise<{ proposalId: number; status: string; materialId: number | null }> {
  const d = input.deduction;

  let materialId: number | null = null;
  if (d.autoConfirm && d.proposedRoomId) {
    const promoted = await promoteLineItem(db, input.lineItemId, {
      roomId: d.proposedRoomId,
      subcategoryId: input.subcategoryId,
      categoryId: input.categoryId,
    });
    materialId = promoted.materialId;
  }

  const [proposal] = await db
    .insert(materialRoomProposals)
    .values({
      materialId,
      lineItemId: input.lineItemId,
      subcategoryId: input.subcategoryId,
      status: d.autoConfirm ? "auto_confirmed" : "staged",
      proposedRoomId: d.proposedRoomId,
      confirmedRoomId: d.autoConfirm ? d.proposedRoomId : null,
      candidatesJson: JSON.stringify(d.candidates),
      confidence: d.confidence,
      reasoningMarkdown: d.reasoningMarkdown,
      resolvedAt: d.autoConfirm ? new Date() : null,
    })
    .returning();

  return { proposalId: proposal.id, status: proposal.status, materialId };
}

/**
 * A human resolves a staged proposal onto a room — the ONE place an ambiguous
 * deduction becomes a real material in a real room.
 *
 * Mints the material into the chosen room (via promoteLineItem) and records the
 * proposal `confirmed` when the room matches the proposal, `overridden` when it
 * differs. An override still feeds the learning step — that room is now "taken"
 * for this type. `roomId` must be a real active room.
 *
 * Idempotent-ish: a proposal already resolved (has a materialId) is not
 * re-promoted; the call returns its existing placement.
 */
export async function resolveProposal(
  db: Db,
  proposalId: number,
  roomId: number,
): Promise<{ materialId: number; roomId: number; status: string } | null> {
  const [proposal] = await db
    .select()
    .from(materialRoomProposals)
    .where(eq(materialRoomProposals.id, proposalId))
    .limit(1);
  if (!proposal) return null;

  const [room] = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(eq(rooms.id, roomId), eq(rooms.isActive, true)))
    .limit(1);
  if (!room) throw new Error(`Room ${roomId} not found or inactive`);

  // Already resolved — do not mint a second material.
  if (proposal.materialId) {
    return { materialId: proposal.materialId, roomId: proposal.confirmedRoomId ?? roomId, status: proposal.status };
  }
  if (!proposal.lineItemId) {
    throw new Error(`Proposal ${proposalId} has no line item to promote`);
  }

  const status = roomId === proposal.proposedRoomId ? "confirmed" : "overridden";

  // Preserve a GROUPED placement's quantity through a manual resolve. A split
  // qty-N line stages N proposals sharing a lineItemId (one unit each, qty 1); a
  // grouped line stages exactly ONE. So if this is the only staged proposal for
  // its line, carry the line's full quantity onto the material — otherwise it is
  // one unit of a split. Derived from the proposal set rather than a stored flag.
  let quantity: number | null = null;
  const siblings = await db
    .select({ id: materialRoomProposals.id })
    .from(materialRoomProposals)
    .where(eq(materialRoomProposals.lineItemId, proposal.lineItemId))
    .all();
  if (siblings.length === 1) {
    const [line] = await db
      .select({ quantity: workerEmailInvoiceLineItems.quantity })
      .from(workerEmailInvoiceLineItems)
      .where(eq(workerEmailInvoiceLineItems.id, proposal.lineItemId))
      .limit(1);
    quantity = line?.quantity && line.quantity > 1 ? Math.round(line.quantity) : null;
  }

  const promoted = await promoteLineItem(db, proposal.lineItemId, {
    roomId,
    subcategoryId: proposal.subcategoryId,
    quantity,
  });

  await db
    .update(materialRoomProposals)
    .set({
      materialId: promoted.materialId,
      confirmedRoomId: roomId,
      status,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(materialRoomProposals.id, proposalId));

  return { materialId: promoted.materialId, roomId, status };
}

// ─── orchestration ─────────────────────────────────────────────────────────────

/**
 * Best-effort match of a line-item description to a subcategory, by name.
 *
 * Deterministic substring match against active subcategory names — a receipt
 * that says "TOTO Washlet G5A Integrated Smart Toilet" contains "Toilet". Cheap
 * and good enough for staging; a human corrects the type on the proposal if it
 * misses. Returns the LONGEST matching name so "Shower Valve" beats "Shower".
 */
export async function classifyLineItemSubcategory(
  db: Db,
  description: string | null,
): Promise<{ subcategoryId: number; categoryId: number } | null> {
  const text = (description ?? "").toLowerCase();
  if (!text) return null;
  const subs = await db
    .select({ id: subcategories.id, name: subcategories.name, categoryId: subcategories.categoryId })
    .from(subcategories)
    .where(eq(subcategories.isActive, true))
    .all();
  const hits = subs
    .filter((s) => s.name && text.includes(s.name.toLowerCase()))
    .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
  const best = hits[0];
  return best ? { subcategoryId: best.id, categoryId: best.categoryId } : null;
}

/**
 * For every UNMATCHED line item on an email's invoices, classify its type,
 * deduce a room, and stage a proposal. This is the ingest hook — call it after
 * a receipt's line items are persisted.
 *
 * Safe to re-run: a line item already linked to a material (`match_status` not
 * "unmatched") is skipped, so it never double-promotes. Per-line failures are
 * logged and swallowed so one bad line does not strand the rest.
 */
export async function stageProposalsForReceipt(
  db: Db,
  env: Env,
  emailId: number,
): Promise<{ staged: number; autoConfirmed: number; skipped: number }> {
  const { workerEmailInvoices } = await import("@backend/db/schema/emails/worker_email_invoices");
  const { allocateReceipt, buildRoomContext, computeLineFacts } = await import("./allocate");

  const invoices = await db
    .select({
      id: workerEmailInvoices.id,
      vendor: workerEmailInvoices.vendorName,
      lineItemsJson: workerEmailInvoices.lineItemsJson,
    })
    .from(workerEmailInvoices)
    .where(eq(workerEmailInvoices.emailId, emailId))
    .all();
  if (invoices.length === 0) return { staged: 0, autoConfirmed: 0, skipped: 0 };

  const invoiceIds = invoices.map((i) => i.id);
  const lines = await inChunks(invoiceIds, (chunk) =>
    db
      .select()
      .from(workerEmailInvoiceLineItems)
      .where(inArray(workerEmailInvoiceLineItems.invoiceId, chunk))
      .all(),
  );

  // Idempotency: clear prior UNRESOLVED proposals (staged, no material yet) for
  // these line items, so a re-run replaces rather than piling up duplicates.
  // Resolved proposals minted a real material and are LEFT — decisions, not
  // noise, and they feed the learning step. Also sweeps staged proposals
  // orphaned by a prior reprocess (line item cascade-deleted → lineItemId null).
  const lineIds = lines.map((l) => l.id);
  if (lineIds.length > 0) {
    await inChunks(lineIds, async (chunk) => {
      await db
        .delete(materialRoomProposals)
        .where(
          and(
            eq(materialRoomProposals.status, "staged"),
            isNull(materialRoomProposals.materialId),
            inArray(materialRoomProposals.lineItemId, chunk),
          ),
        );
      return [];
    });
  }
  await db
    .delete(materialRoomProposals)
    .where(
      and(
        eq(materialRoomProposals.status, "staged"),
        isNull(materialRoomProposals.materialId),
        isNull(materialRoomProposals.lineItemId),
      ),
    );

  const unmatched = lines.filter((l) => !l.matchStatus || l.matchStatus === "unmatched");
  const skipped = lines.length - unmatched.length;
  if (unmatched.length === 0) return { staged: 0, autoConfirmed: 0, skipped };

  // Classify every unmatched line's type up front, and resolve its display name.
  const taxonomyByLine = new Map<number, { subcategoryId: number | null; categoryId: number | null }>();
  for (const line of unmatched) {
    const type = await classifyLineItemSubcategory(db, line.description);
    taxonomyByLine.set(line.id, {
      subcategoryId: type?.subcategoryId ?? null,
      categoryId: type?.categoryId ?? null,
    });
  }
  const subIds = [...new Set([...taxonomyByLine.values()].map((t) => t.subcategoryId).filter((x): x is number => x != null))];
  const subNameById = new Map<number, string>();
  if (subIds.length > 0) {
    const subRows = await inChunks(subIds, (chunk) =>
      db.select({ id: subcategories.id, name: subcategories.name }).from(subcategories).where(inArray(subcategories.id, chunk)).all(),
    );
    for (const s of subRows) if (s.name) subNameById.set(s.id, s.name);
  }

  // Product attributes (brand/model/variant) live on the invoice's extracted
  // lineItemsJson, not on the line-item table — merge them all for enrichment.
  const extractedItems: { description?: string; brand?: string; modelNumber?: string; variant?: string }[] = [];
  for (const inv of invoices) {
    if (!inv.lineItemsJson) continue;
    try {
      const arr = JSON.parse(inv.lineItemsJson);
      if (Array.isArray(arr)) extractedItems.push(...arr);
    } catch {
      /* malformed extraction json — skip enrichment for this invoice */
    }
  }

  const facts = computeLineFacts(
    unmatched.map((l) => {
      const t = taxonomyByLine.get(l.id)!;
      return {
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subcategoryId: t.subcategoryId,
        subName: t.subcategoryId != null ? subNameById.get(t.subcategoryId) ?? null : null,
      };
    }),
    extractedItems,
  );

  const ctx = await buildRoomContext(db);
  const plan = await allocateReceipt(db, env, facts, ctx, taxonomyByLine);

  let staged = 0;
  let autoConfirmed = 0;

  for (const a of plan.assignments) {
    try {
      // Auto-confirm ONLY a truly unambiguous placement: exactly one eligible
      // room for the line. Anything the allocator had to CHOOSE among stays
      // staged for the owner — nothing auto-commits an ambiguous multi-unit
      // receipt (a hard requirement of the design).
      const unambiguous = a.candidates.length === 1 && a.proposedRoomId != null;

      let materialId: number | null = null;
      if (unambiguous && a.proposedRoomId != null) {
        const promoted = await promoteLineItem(db, a.lineItemId, {
          roomId: a.proposedRoomId,
          subcategoryId: a.subcategoryId,
          categoryId: a.categoryId,
          quantity: a.grouped ? a.quantity : null,
        });
        materialId = promoted.materialId;
      }

      await db.insert(materialRoomProposals).values({
        materialId,
        lineItemId: a.lineItemId,
        subcategoryId: a.subcategoryId,
        unitIndex: a.unitIndex,
        application: a.application,
        status: unambiguous ? "auto_confirmed" : "staged",
        proposedRoomId: a.proposedRoomId,
        confirmedRoomId: unambiguous ? a.proposedRoomId : null,
        candidatesJson: JSON.stringify(a.candidates),
        confidence: a.confidence,
        reasoningMarkdown: a.reasoning,
        resolvedAt: unambiguous ? new Date() : null,
      });

      if (unambiguous) autoConfirmed++;
      else staged++;
    } catch (err) {
      console.error(`[deduction] failed to stage allocation for line item ${a.lineItemId} unit ${a.unitIndex}:`, err);
    }
  }

  return { staged, autoConfirmed, skipped };
}

// ─── read: proposals for review ─────────────────────────────────────────────────

/** Parse the frozen `candidatesJson` snapshot; a bad blob reads as no candidates. */
function parseCandidates(json: string | null): RoomCandidate[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as RoomCandidate[]) : [];
  } catch {
    return [];
  }
}

/** One proposal shaped for review — names JOINed, never stored (AGENTS.md FK rule). */
export interface RoomProposalView {
  id: number;
  /** Line-item description, falling back to the material title. */
  title: string;
  /** The receipt (invoice) this came from — lets a client group by receipt. */
  invoiceId: number | null;
  lineItemId: number | null;
  /** Which unit of a split multi-unit line this proposal places. */
  unitIndex: number;
  subcategoryId: number | null;
  subcategoryName: string | null;
  /** The inferred use the allocator reasoned toward, e.g. "island lighting". */
  application: string | null;
  status: string;
  confidence: number | null;
  proposedRoomId: number | null;
  proposedRoomName: string | null;
  /** The room a human actually chose — the #203 read view omitted this. */
  confirmedRoomId: number | null;
  confirmedRoomName: string | null;
  candidates: RoomCandidate[];
  reasoningMarkdown: string | null;
}

type ProposalStatus = "staged" | "auto_confirmed" | "confirmed" | "overridden" | "dismissed";

/**
 * Pending (or otherwise filtered) proposals for the review surfaces — one query
 * behind both the MCP `list_room_proposals` tool and the REST endpoint, so the
 * two can never drift. Display names are joined at read time; `candidatesJson`
 * is parsed back into the ranked candidate list.
 */
export async function listRoomProposals(
  db: Db,
  status: ProposalStatus = "staged",
): Promise<RoomProposalView[]> {
  // Two rooms joins — one for the engine's proposed room, one for the room a
  // human confirmed — both by display name, never stored (AGENTS.md FK rule).
  const proposedRoom = alias(rooms, "proposed_room");
  const confirmedRoom = alias(rooms, "confirmed_room");

  const rows = await db
    .select({
      p: materialRoomProposals,
      invoiceId: workerEmailInvoiceLineItems.invoiceId,
      lineDesc: workerEmailInvoiceLineItems.description,
      matTitle: materialScheduleItems.title,
      subName: subcategories.name,
      proposedRoomName: proposedRoom.roomName,
      confirmedRoomName: confirmedRoom.roomName,
    })
    .from(materialRoomProposals)
    .leftJoin(
      workerEmailInvoiceLineItems,
      eq(materialRoomProposals.lineItemId, workerEmailInvoiceLineItems.id),
    )
    .leftJoin(materialScheduleItems, eq(materialRoomProposals.materialId, materialScheduleItems.id))
    .leftJoin(subcategories, eq(materialRoomProposals.subcategoryId, subcategories.id))
    .leftJoin(proposedRoom, eq(materialRoomProposals.proposedRoomId, proposedRoom.id))
    .leftJoin(confirmedRoom, eq(materialRoomProposals.confirmedRoomId, confirmedRoom.id))
    .where(eq(materialRoomProposals.status, status))
    .orderBy(desc(materialRoomProposals.createdAt))
    .all();

  return rows.map((r) => ({
    id: r.p.id,
    title: (r.lineDesc ?? r.matTitle ?? "Material").trim() || "Material",
    invoiceId: r.invoiceId ?? null,
    lineItemId: r.p.lineItemId,
    unitIndex: r.p.unitIndex,
    subcategoryId: r.p.subcategoryId,
    subcategoryName: r.subName ?? null,
    application: r.p.application ?? null,
    status: r.p.status,
    confidence: r.p.confidence,
    proposedRoomId: r.p.proposedRoomId,
    proposedRoomName: r.proposedRoomName ?? null,
    confirmedRoomId: r.p.confirmedRoomId,
    confirmedRoomName: r.confirmedRoomName ?? null,
    candidates: parseCandidates(r.p.candidatesJson),
    reasoningMarkdown: r.p.reasoningMarkdown,
  }));
}
