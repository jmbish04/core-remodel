/**
 * @fileoverview Dialer API — cold-calling machine for hiring independent drafters.
 *
 * Ported from the standalone recovery-remodel-dialer Worker into core-remodel.
 * All routes are auth-gated behind /api/admin/dialer/* via requireAccessAuth middleware.
 */

import { dialerProspects, dialerProspectState, dialerCallAttempts } from "@backend/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { fetchSodaRows, normalizeText, type SodaRow } from "@backend/services/dbi/soda";
import { CONTACT_DATASETS } from "@backend/services/dbi/datasets";

const dialerRouter = new Hono<{ Bindings: Env }>();

// ─── GET /prospects ──────────────────────────────────────────────────────
dialerRouter.get("/prospects", async (c) => {
  const db = drizzle(c.env.DB);
  const status = c.req.query("status") || "all";
  const hideUnavailable = c.req.query("hideUnavailable") === "true";
  const q = c.req.query("q") || "";

  const rows = await db
    .select({
      id: dialerProspects.id,
      rank: dialerProspects.rank,
      fullName: dialerProspects.fullName,
      firstName: dialerProspects.firstName,
      lastName: dialerProspects.lastName,
      firm: dialerProspects.firm,
      roles: dialerProspects.roles,
      permitCount: dialerProspects.permitCount,
      avgCost: dialerProspects.avgCost,
      medianCost: dialerProspects.medianCost,
      scopeKeywords: dialerProspects.scopeKeywords,
      isUnbundledCandidate: dialerProspects.isUnbundledCandidate,
      collisionRisk: dialerProspects.collisionRisk,
      licenseNo: dialerProspects.licenseNo,
      agentAddress: dialerProspects.agentAddress,
      agentCity: dialerProspects.agentCity,
      agentState: dialerProspects.agentState,
      agentZip: dialerProspects.agentZip,
      phone: dialerProspects.phone,
      phoneSource: dialerProspects.phoneSource,
      email: dialerProspects.email,
      emailSource: dialerProspects.emailSource,
      website: dialerProspects.website,
      contactStatus: dialerProspects.contactStatus,
      licenseNote: dialerProspects.licenseNote,
      callScript: dialerProspects.callScript,
      disposition: sql<string>`coalesce(${dialerProspectState.disposition}, 'not_called')`,
      rating: dialerProspectState.rating,
      favorite: sql<boolean>`coalesce(${dialerProspectState.favorite}, 0)`,
      leftVoicemail: sql<boolean>`coalesce(${dialerProspectState.leftVoicemail}, 0)`,
      availableToHire: dialerProspectState.availableToHire,
      goodFeeling: dialerProspectState.goodFeeling,
      notes: dialerProspectState.notes,
      callCount: sql<number>`coalesce(${dialerProspectState.callCount}, 0)`,
      emailedAt: dialerProspectState.emailedAt,
      lastContactedAt: dialerProspectState.lastContactedAt,
    })
    .from(dialerProspects)
    .leftJoin(dialerProspectState, eq(dialerProspects.id, dialerProspectState.prospectId))
    .orderBy(dialerProspects.rank);

  let out = rows;
  if (status === "not_called") out = out.filter((r) => (r.callCount ?? 0) === 0);
  if (status === "called") out = out.filter((r) => (r.callCount ?? 0) > 0);
  if (status === "favorites") out = out.filter((r) => !!r.favorite);
  if (hideUnavailable) out = out.filter((r) => r.availableToHire !== false);
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter(
      (r) =>
        r.fullName.toLowerCase().includes(needle) ||
        (r.firm ?? "").toLowerCase().includes(needle) ||
        r.roles.toLowerCase().includes(needle),
    );
  }

  return c.json({ prospects: out });
});

// ─── GET /prospects/:id ──────────────────────────────────────────────────
dialerRouter.get("/prospects/:id", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const row = (
    await db
      .select()
      .from(dialerProspects)
      .leftJoin(dialerProspectState, eq(dialerProspects.id, dialerProspectState.prospectId))
      .where(eq(dialerProspects.id, id))
  )[0];
  if (!row) return c.json({ error: "not found" }, 404);

  const p = row.dialer_prospects;
  const s = row.dialer_prospect_state;
  return c.json({
    ...p,
    disposition: s?.disposition ?? "not_called",
    rating: s?.rating ?? null,
    favorite: s?.favorite ?? false,
    leftVoicemail: s?.leftVoicemail ?? false,
    availableToHire: s?.availableToHire ?? null,
    goodFeeling: s?.goodFeeling ?? null,
    notes: s?.notes ?? null,
    callCount: s?.callCount ?? 0,
    emailedAt: s?.emailedAt ?? null,
    lastContactedAt: s?.lastContactedAt ?? null,
  });
});

// ─── PATCH /prospects/:id/state ──────────────────────────────────────────
dialerRouter.patch("/prospects/:id/state", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const db = drizzle(c.env.DB);

  const set: Record<string, unknown> = { prospectId: id, updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) set[k] = v;

  await db
    .insert(dialerProspectState)
    .values(set as typeof dialerProspectState.$inferInsert)
    .onConflictDoUpdate({ target: dialerProspectState.prospectId, set });

  return c.json({ ok: true });
});

// ─── POST /prospects/:id/call ────────────────────────────────────────────
dialerRouter.post("/prospects/:id/call", async (c) => {
  const id = c.req.param("id");
  const { outcome, note } = await c.req.json();
  const db = drizzle(c.env.DB);

  await db.insert(dialerCallAttempts).values({ prospectId: id, outcome, note: note ?? null });

  const disposition = outcome === "callback" ? "attempted" : outcome;
  const leftVoicemail = outcome === "voicemail";

  const existing = (await db.select().from(dialerProspectState).where(eq(dialerProspectState.prospectId, id)))[0];
  const callCount = (existing?.callCount ?? 0) + 1;
  const now = new Date().toISOString();

  const set: typeof dialerProspectState.$inferInsert = {
    prospectId: id,
    disposition,
    callCount,
    leftVoicemail: leftVoicemail || (existing?.leftVoicemail ?? false),
    lastContactedAt: now,
    updatedAt: now,
  };

  await db.insert(dialerProspectState).values(set).onConflictDoUpdate({ target: dialerProspectState.prospectId, set });

  return c.json({ ok: true, callCount });
});

// ─── POST /prospects/:id/emailed ─────────────────────────────────────────
dialerRouter.post("/prospects/:id/emailed", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const now = new Date().toISOString();
  const set: typeof dialerProspectState.$inferInsert = {
    prospectId: id,
    emailedAt: now,
    updatedAt: now,
  };
  await db.insert(dialerProspectState).values(set).onConflictDoUpdate({ target: dialerProspectState.prospectId, set });
  return c.json({ ok: true });
});

// ─── POST /prospects/enrich ──────────────────────────────────────────────
// Backfill agent_address/city/state/zip + license_no from the SF DBI
// Building Permit Contacts dataset (3pee-9qhc). Idempotent and safe to re-run.
dialerRouter.post("/prospects/enrich", async (c) => {
  const db = drizzle(c.env.DB);
  const prospects = await db.select().from(dialerProspects).all();

  if (prospects.length === 0) {
    return c.json({ ok: true, enriched: 0, skipped: 0, collisions: 0, message: "No prospects to enrich." });
  }

  // Fetch design-role contacts from 3pee-9qhc
  const datasetId = CONTACT_DATASETS.building.id; // 3pee-9qhc
  const designRoles = ["designer", "architect", "pmt consultant/expediter"];
  const roleFilter = designRoles.map((r) => `role='${r}'`).join(" OR ");
  const sodaRows = await fetchSodaRows(datasetId, {
    $where: roleFilter,
    $select: "first_name,last_name,role,license1,firm_address,city,state,agent_zipcode,data_loaded_at",
    $order: "data_loaded_at DESC",
  }, 10000);

  // Group by normalized name key, keeping latest record per person.
  // If a person has multiple conflicting addresses, mark as collision.
  type ContactRecord = {
    license: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    loadedAt: string;
  };

  const contactsByKey = new Map<string, ContactRecord[]>();

  for (const row of sodaRows) {
    const firstName = normalizeText(String(row.first_name ?? ""));
    const lastName = normalizeText(String(row.last_name ?? ""));
    if (!firstName || !lastName) continue;

    const key = `${firstName}|${lastName}`;
    const record: ContactRecord = {
      license: String(row.license1 ?? "").trim() || null,
      address: String(row.firm_address ?? "").trim() || null,
      city: String(row.city ?? "").trim() || null,
      state: String(row.state ?? "").trim() || null,
      zip: String(row.agent_zipcode ?? "").trim() || null,
      loadedAt: String(row.data_loaded_at ?? ""),
    };

    const existing = contactsByKey.get(key) || [];
    existing.push(record);
    contactsByKey.set(key, existing);
  }

  // Dedupe: pick latest per person, detect address collisions
  type ResolvedContact = {
    license: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    hasCollision: boolean;
  };

  const resolvedByKey = new Map<string, ResolvedContact>();

  for (const [key, records] of contactsByKey.entries()) {
    // Sort by loadedAt DESC — latest first
    records.sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));

    // Collect distinct non-null addresses
    const distinctAddresses = new Set<string>();
    for (const r of records) {
      if (r.address) distinctAddresses.add(normalizeText(r.address));
    }

    const latest = records[0];
    const hasCollision = distinctAddresses.size > 1;

    resolvedByKey.set(key, {
      license: latest.license,
      address: hasCollision ? null : latest.address,
      city: hasCollision ? null : latest.city,
      state: hasCollision ? null : latest.state,
      zip: hasCollision ? null : (latest.zip || null),
      hasCollision,
    });
  }

  // Match prospects to contacts and update
  let enriched = 0;
  let skipped = 0;
  let collisions = 0;

  for (const prospect of prospects) {
    const prospectKey = `${normalizeText(prospect.firstName)}|${normalizeText(prospect.lastName)}`;

    // Try exact name match first; prefer license-matched record
    let match = resolvedByKey.get(prospectKey) ?? null;

    // If prospect has a license and we have contacts with that key, prefer
    // the contact record whose license matches
    if (match && prospect.licenseNo && match.license && match.license !== prospect.licenseNo) {
      // Check if any raw record for this name key has the matching license
      const rawRecords = contactsByKey.get(prospectKey) || [];
      const licenseMatch = rawRecords.find((r) => r.license === prospect.licenseNo);
      if (licenseMatch) {
        match = {
          license: licenseMatch.license,
          address: licenseMatch.address,
          city: licenseMatch.city,
          state: licenseMatch.state,
          zip: licenseMatch.zip,
          hasCollision: false,
        };
      }
    }

    if (!match) {
      skipped++;
      continue;
    }

    if (match.hasCollision) {
      collisions++;
      // Set collision_risk but don't fill address
      await db
        .update(dialerProspects)
        .set({ collisionRisk: true })
        .where(eq(dialerProspects.id, prospect.id))
        .run();
      continue;
    }

    // Fill address + license if still null
    const updates: Partial<typeof dialerProspects.$inferInsert> = {};
    if (match.address && !prospect.agentAddress) updates.agentAddress = match.address;
    if (match.city && !prospect.agentCity) updates.agentCity = match.city;
    if (match.state && !prospect.agentState) updates.agentState = match.state;
    if (match.zip && !prospect.agentZip) updates.agentZip = match.zip;
    if (match.license && !prospect.licenseNo) updates.licenseNo = match.license;

    if (Object.keys(updates).length > 0) {
      await db
        .update(dialerProspects)
        .set(updates)
        .where(eq(dialerProspects.id, prospect.id))
        .run();
      enriched++;
    } else {
      skipped++;
    }
  }

  console.log(`[Dialer Enrich] enriched=${enriched} skipped=${skipped} collisions=${collisions} sodaRows=${sodaRows.length}`);

  return c.json({
    ok: true,
    enriched,
    skipped,
    collisions,
    sodaRowsFetched: sodaRows.length,
    message: `Enriched ${enriched} prospects, ${skipped} skipped (already filled or no match), ${collisions} collision(s).`,
  });
});

export { dialerRouter };
