/**
 * @fileoverview Detect chain-branch groups and stage them as merge candidates (0047).
 *
 * 0046's `dedup_showroom_stores` already knows how to group store rows by shared identity
 * signals (`groupBySignals`) and how to tell a redundant STUB (auto-mergeable) from a real
 * BRANCH of one business (`isReal` — two or more rows each with their own zip/place_id, which
 * it deliberately refuses to merge). This module does the BRANCH half: find those groups over
 * the ACTIVE directory, drop any pair a human has excluded, and upsert one reviewable
 * `showroom_merge_candidates` row per group.
 *
 * It reuses `groupBySignals` and the normalizers wholesale — detection is NOT reimplemented
 * here. What lives here is the D1 read that assembles a `StoreIdentity` per store (from the
 * store row + its locations + its POCs + its WEBSITE links) and the candidate upsert.
 */
import {
  showroomMergeCandidateMembers,
  showroomMergeCandidates,
  showroomMergeExclusions,
  showroomPocs,
  showroomStoreLinks,
  showroomStoreLocations,
  showroomStores,
} from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";

import type { RemodelDb } from "../../mcp/types";
import {
  emptyIdentity,
  groupBySignals,
  normAddress,
  normHost,
  normName,
  normPhone,
  type SignalGroup,
  type StoreIdentity,
} from "./duplicate-signals";

/** ponytail: D1 caps a statement at 100 bound params; these id lists are unbounded. */
function chunk<T>(xs: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Assemble a `StoreIdentity` for every ACTIVE store, gathering signals from the store row,
 * its location rows, its POCs and its WEBSITE links.
 *
 * Location street is now UNIT-qualified (the 0047 `unit` column) so two suites of one
 * building no longer collapse — the exact hole that nearly merged Leandro Quintal into
 * Marblus (#356). A location contributes its place_id and its full unit-qualified address;
 * a POC contributes phone + address; a WEBSITE link contributes its host.
 */
export async function loadActiveStoreIdentities(db: RemodelDb): Promise<StoreIdentity[]> {
  const stores = await db
    .select({
      id: showroomStores.id,
      name: showroomStores.name,
      placeId: showroomStores.placeId,
      phoneNumber: showroomStores.phoneNumber,
      locationAddress: showroomStores.locationAddress,
    })
    .from(showroomStores)
    .where(eq(showroomStores.isActive, true))
    .all();

  const identities = new Map<number, StoreIdentity>();
  const activeIds: number[] = [];
  for (const s of stores) {
    const i = emptyIdentity(s.id);
    i.name = normName(s.name);
    if (s.placeId) i.placeIds.add(s.placeId);
    const phone = normPhone(s.phoneNumber);
    if (phone) i.phones.add(phone);
    // The STORE address carries its suite (Places formats it in), so it is safe here.
    const addr = normAddress(s.locationAddress);
    if (addr) i.addresses.add(addr);
    identities.set(s.id, i);
    activeIds.push(s.id);
  }
  if (activeIds.length === 0) return [];

  const has = (id: number) => identities.get(id);

  for (const part of chunk(activeIds)) {
    const locs = await db
      .select({
        storeId: showroomStoreLocations.storeId,
        placeId: showroomStoreLocations.placeId,
        streetNumber: showroomStoreLocations.streetNumber,
        streetName: showroomStoreLocations.streetName,
        unit: showroomStoreLocations.unit,
        city: showroomStoreLocations.city,
        zipCode: showroomStoreLocations.zipCode,
      })
      .from(showroomStoreLocations)
      .where(inArray(showroomStoreLocations.storeId, part))
      .all();
    for (const l of locs) {
      const i = has(l.storeId);
      if (!i) continue;
      if (l.placeId) i.placeIds.add(l.placeId);
      // UNIT-qualified: a suite-less street is building-level and must not group tenants.
      const addr = normAddress(
        [l.streetNumber, l.streetName, l.unit, l.city, l.zipCode].filter(Boolean).join(" "),
      );
      if (addr) i.addresses.add(addr);
    }

    const pocs = await db
      .select({
        showroomId: showroomPocs.showroomId,
        phone: showroomPocs.phone,
        address: showroomPocs.address,
      })
      .from(showroomPocs)
      .where(and(inArray(showroomPocs.showroomId, part), eq(showroomPocs.isActive, true)))
      .all();
    for (const p of pocs) {
      const i = has(p.showroomId);
      if (!i) continue;
      const phone = normPhone(p.phone);
      if (phone) i.phones.add(phone);
      const addr = normAddress(p.address);
      if (addr) i.addresses.add(addr);
    }

    const links = await db
      .select({ storeId: showroomStoreLinks.storeId, url: showroomStoreLinks.url })
      .from(showroomStoreLinks)
      .where(
        and(inArray(showroomStoreLinks.storeId, part), eq(showroomStoreLinks.type, "WEBSITE")),
      )
      .all();
    for (const l of links) {
      const i = has(l.storeId);
      if (!i) continue;
      const host = normHost(l.url);
      if (host) i.hosts.add(host);
    }
  }

  return Array.from(identities.values());
}

/** An ordered `(lo, hi)` key for a store pair, matching the exclusions unique index. */
export const pairKey = (a: number, b: number): string =>
  a < b ? `${a}-${b}` : `${b}-${a}`;

/** Load every excluded pair as a `min-max` key set. */
export async function loadExclusionKeys(db: RemodelDb): Promise<Set<string>> {
  const rows = await db
    .select({ lo: showroomMergeExclusions.storeIdLo, hi: showroomMergeExclusions.storeIdHi })
    .from(showroomMergeExclusions)
    .all();
  return new Set(rows.map((r) => pairKey(r.lo, r.hi)));
}

export interface BranchGroup {
  /** Sorted member store ids — also the candidate `group_key` (joined by "-"). */
  storeIds: number[];
  groupKey: string;
  signals: SignalGroup["signals"];
  evidence: SignalGroup["evidence"];
}

/**
 * Find the branch groups over the active directory: groups that `groupBySignals` links and
 * that carry two or more REAL rows (their own zip/place_id) — i.e. distinct SITES of one
 * business — minus any group that collapses to fewer than two members once excluded pairs
 * are removed.
 *
 * A group is dropped when EVERY internal edge between its members is an excluded pair (the
 * human already said "not the same business"); a group that still has ≥2 members after that
 * survives, because at least one live edge remains.
 */
export async function findBranchGroups(db: RemodelDb): Promise<BranchGroup[]> {
  const identities = await loadActiveStoreIdentities(db);
  const excluded = await loadExclusionKeys(db);
  const byId = new Map(identities.map((i) => [i.storeId, i]));

  // A store is a distinct SITE if it carries its own zip or place_id.
  const isReal = (storeId: number) => {
    const i = byId.get(storeId);
    return Boolean(i && (i.placeIds.size > 0 || i.addresses.size > 0));
  };

  const groups: BranchGroup[] = [];
  for (const g of groupBySignals(identities)) {
    // A branch group must be held together by a STRONG signal — a shared website, name or
    // place_id, i.e. evidence of one BUSINESS. A group linked only by a weak signal (a shared
    // street address or phone) is co-located DIFFERENT companies, not branches: Walker Zanger
    // and New Century Kitchen & Bath share a building; DEGREE HVAC and CB Showers share one
    // too. Staging those as collapse candidates would only make a human reject each. Same rule
    // the tier-1 dedup applies (STRONG vs WEAK).
    if (!g.hasStrongSignal) continue;

    // Keep only members not fully severed from the rest by exclusions: a member survives
    // if it still shares at least one non-excluded edge with another member of the group.
    const members = g.storeIds.filter((id) =>
      g.storeIds.some((other) => other !== id && !excluded.has(pairKey(id, other))),
    );
    if (members.length < 2) continue;

    // Branch tier only: 2+ members that are each a real, distinct site.
    const reals = members.filter(isReal);
    if (reals.length < 2) continue;

    const sorted = [...members].sort((a, b) => a - b);
    groups.push({
      storeIds: sorted,
      groupKey: sorted.join("-"),
      signals: g.signals,
      evidence: g.evidence.filter((e) => e.storeIds.some((id) => sorted.includes(id))).slice(0, 12),
    });
  }
  return groups;
}

export interface ScanResult {
  detected: number;
  created: number;
  updated: number;
  staled: number;
  groups: Array<{ groupKey: string; storeIds: number[]; status: string }>;
}

/**
 * Upsert one `showroom_merge_candidates` row per branch group, keyed by `group_key`.
 *
 * - A group_key not seen before → a new `TBD` candidate + its member rows (the
 *   most-enriched-by-id keeper proposed; a human can switch it).
 * - A group_key already present and still `TBD`/`APPROVED` → refresh its signals/evidence.
 * - A previously-detected candidate whose group_key is NO LONGER produced (its membership
 *   changed, e.g. a member was merged away) and which is still open → marked `STALE`, never
 *   mutated, so a pending human decision is not silently rewritten.
 * - `APPLIED`/`REJECTED` candidates are left alone.
 */
export async function scanMergeCandidates(db: RemodelDb): Promise<ScanResult> {
  const groups = await findBranchGroups(db);
  const liveKeys = new Set(groups.map((g) => g.groupKey));

  const existing = await db
    .select({
      id: showroomMergeCandidates.id,
      groupKey: showroomMergeCandidates.groupKey,
      status: showroomMergeCandidates.status,
    })
    .from(showroomMergeCandidates)
    .all();
  const byKey = new Map(existing.map((e) => [e.groupKey, e]));

  let created = 0;
  let updated = 0;
  let staled = 0;
  const out: ScanResult["groups"] = [];

  for (const g of groups) {
    const signalsJson = JSON.stringify(g.signals);
    const evidenceJson = JSON.stringify(g.evidence);
    const prior = byKey.get(g.groupKey);

    if (!prior) {
      // Propose the highest store id? No — enrichment is unknown here; the keeper is the
      // lowest id by convention (oldest row), and the human/UI can switch it before apply.
      const keeperStoreId = g.storeIds[0];
      const [row] = await db
        .insert(showroomMergeCandidates)
        .values({
          groupKey: g.groupKey,
          proposedKeeperStoreId: keeperStoreId,
          status: "TBD",
          signalsJson,
          evidenceJson,
        })
        .returning({ id: showroomMergeCandidates.id });

      const memberRows = g.storeIds.map((storeId) => ({
        candidateId: row.id,
        storeId,
        role: storeId === keeperStoreId ? ("KEEPER" as const) : ("BRANCH" as const),
      }));
      for (const part of chunk(memberRows, 20)) {
        await db.insert(showroomMergeCandidateMembers).values(part).run();
      }
      created += 1;
      out.push({ groupKey: g.groupKey, storeIds: g.storeIds, status: "TBD" });
      continue;
    }

    if (prior.status === "TBD" || prior.status === "APPROVED") {
      await db
        .update(showroomMergeCandidates)
        .set({ signalsJson, evidenceJson })
        .where(eq(showroomMergeCandidates.id, prior.id))
        .run();
      updated += 1;
    }
    out.push({ groupKey: g.groupKey, storeIds: g.storeIds, status: prior.status });
  }

  // Stale out open candidates whose group no longer appears.
  for (const e of existing) {
    if (liveKeys.has(e.groupKey)) continue;
    if (e.status === "TBD" || e.status === "APPROVED") {
      await db
        .update(showroomMergeCandidates)
        .set({ status: "STALE" })
        .where(eq(showroomMergeCandidates.id, e.id))
        .run();
      staled += 1;
    }
  }

  return { detected: groups.length, created, updated, staled, groups: out };
}
