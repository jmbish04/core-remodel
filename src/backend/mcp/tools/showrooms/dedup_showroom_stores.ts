// Only the tables this tool reads directly for identity signals remain here — the ~25 FK
// child tables moved with the remap logic into services/showroom/store-child-remap.ts.
import {
  showroomPocs,
  showroomStoreLinks,
  showroomStoreLocations,
  showroomStores,
} from "@backend/db";
import {
  countStoreChildren,
  remapStoreChildren,
} from "@backend/services/showroom/store-child-remap";
import {
  emptyIdentity,
  groupBySignals,
  normAddress,
  normHost,
  normName,
  normPhone,
  type SignalKind,
  type StoreIdentity,
} from "@backend/services/showroom/duplicate-signals";
import { count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { defineTool, DESTRUCTIVE } from "../../types";

type StoreRow = {
  id: number;
  name: string;
  locationCity: string | null;
  locationAddress: string | null;
  zipCode: string | null;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  iconCfImagesUrl: string | null;
  heroImageCfImagesUrl: string | null;
  phoneNumber: string | null;
  isActive: boolean;
};


/**
 * Calculates a completeness score for a store row based on its enriched fields.
 */
function score(r: StoreRow): number {
  let s = 0;
  if (r.zipCode) s += 100;
  if (r.placeId) s += 40;
  if (r.latitude != null && r.longitude != null) s += 20;
  if (r.iconCfImagesUrl) s += 10;
  if (r.heroImageCfImagesUrl) s += 10;
  if (r.phoneNumber) s += 5;
  if (r.locationAddress && /\d/.test(r.locationAddress)) s += 3;
  return s;
}

/**
 * Determines if a store is considered a distinct physical site (requires zip or placeId).
 */
const isReal = (r: StoreRow) => Boolean(r.zipCode) || Boolean(r.placeId);

const D1_IN_CHUNK = 90;

/**
 * Splits an array into smaller arrays of a specified size (defaults to D1_IN_CHUNK) to stay under D1's parameter limit.
 */
function chunk<T>(xs: T[], size = D1_IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Extracts the number of changed rows from a D1 result meta object.
 */
const changesOf = (r: unknown) => Number((r as { meta?: { changes?: number } })?.meta?.changes ?? 0);

/**
 * dedup_showroom_stores — MERGE duplicate showroom_stores rows into one canonical
 * row. For each normalized-NAME group it picks the most-enriched row as
 * the KEEPER, remaps every child/support row from the duplicates onto the keeper
 * (deduping rows the keeper already has — links, hours, category/tag/brand/
 * product/area mappings — so a merge never creates a second website link or trips
 * a unique index), and then SOFT-DELETES the duplicate store (is_active = 0, never
 * a hard delete — every showroom read path filters is_active = 1, and the row
 * stays restorable).
 *
 * GROUPING (0046): rows are linked by ANY shared identity signal — Google
 * `place_id`, phone, street address, website host, or normalized name — collected
 * across `showroom_stores`, `showroom_store_locations` AND `showroom_pocs`, and
 * unioned transitively (see `services/showroom/duplicate-signals.ts`). Name-only
 * grouping missed every pair named even slightly differently: two real
 * `Jack London Kitchen & Bath` / `…and Bath -Walnut Creek` rows never grouped at
 * all, and were only identifiable because a POC on one carried the phone and
 * street address of a location on the other.
 *
 * SAFETY: a group with >=2 "real" rows (each with its own zip/placeId) is treated
 * as distinct chain BRANCHES and SKIPPED, never merged — widening detection must
 * not widen what auto-merges. Those groups are reported as `branchCandidates`:
 * under the multi-location model they should collapse into ONE store with many
 * location rows, but that is a human-confirmed operation, not this tool's job.
 * DRY-RUN by default: it reports the keep/delete map, the signal evidence behind
 * every group, and per-table child-row counts so the merge is reviewable.
 */
export const dedupShowroomStores = defineTool({
  name: "dedup_showroom_stores",
  category: "showrooms",
  title: "Merge & dedup showroom stores (dry-run by default)",
  description:
    "MERGE duplicate `showroom_stores` rows into one canonical row. Rows are grouped by ANY shared identity signal — " +
    "Google `place_id`, phone (digits-only), street address, website host, or normalized name — gathered from the " +
    "store row, its LOCATIONS and its POCs, then unioned transitively (A~B by phone + B~C by place_id = one group). " +
    "Name normalization folds '&'/'and', strips a trailing '- City' branch suffix and legal suffixes, so " +
    "'Jack London Kitchen & Bath' and 'Jack London Kitchen and Bath -Walnut Creek' finally match. Generic hosts " +
    "(squarespace, wix, facebook…) are ignored so they cannot fuse unrelated stores. " +
    "It picks the most-enriched row as the KEEPER, remaps every child/support row from the duplicates onto it " +
    "(deduping rows the keeper already has — links, hours, category/tag/brand/product/area mappings — so the merge " +
    "never creates a second website link or trips a unique index), then SOFT-DELETES the duplicate store " +
    "(is_active = 0, never a hard delete; restorable). " +
    "SAFETY: a group with TWO+ 'real' rows (each with its own zip/placeId) is distinct chain BRANCHES and is SKIPPED, " +
    "never merged — returned as `branchCandidates` instead. Under the multi-location model those should become ONE " +
    "store with many location rows (use add_showroom_location), but that is a human-confirmed call, not an " +
    "auto-merge. DRY-RUN by default (writes nothing): returns the keep/delete map, the signal EVIDENCE behind every " +
    "group, and per-table child-row counts so the merge is reviewable. Pass apply:true ONLY after a human approves " +
    "the dry-run. Use limitGroups to pace. All writes are chunked under D1's 100-bound-param cap.",
  inputShape: {
    apply: z
      .boolean()
      .optional()
      .describe("false/omitted = dry run (writes nothing). true = perform the merge + soft-delete."),
    limitGroups: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Cap the number of duplicate groups processed this call (for pacing). Default: all."),
  },
  annotations: DESTRUCTIVE,
  examples: [
    { title: "Dry run — keep/delete map + child counts", args: {} },
    { title: "Apply after approval", args: { apply: true } },
  ],
  handler: async ({ db }, input) => {
    const apply = input.apply === true;

    const all: StoreRow[] = await db
      .select({
        id: showroomStores.id,
        name: showroomStores.name,
        locationCity: showroomStores.locationCity,
        locationAddress: showroomStores.locationAddress,
        zipCode: showroomStores.zipCode,
        placeId: showroomStores.placeId,
        latitude: showroomStores.latitude,
        longitude: showroomStores.longitude,
        iconCfImagesUrl: showroomStores.iconCfImagesUrl,
        heroImageCfImagesUrl: showroomStores.heroImageCfImagesUrl,
        phoneNumber: showroomStores.phoneNumber,
        isActive: showroomStores.isActive,
      })
      .from(showroomStores)
      .all();

    // ── Identity signals, gathered from the store row + its locations + its POCs ──
    // A store's own columns are not enough: the two real Jack London rows sat on
    // different domains and were only linked because a POC on one carried the
    // phone + street address of a location on the other.
    const byId = new Map<number, StoreRow>(all.map((r) => [r.id, r]));
    const identities = new Map<number, StoreIdentity>();

    /**
     * Retrieves or initializes the identity tracker for a given store ID.
     */
    const identityFor = (storeId: number) => {
      let i = identities.get(storeId);
      if (!i) identities.set(storeId, (i = emptyIdentity(storeId)));
      return i;
    };

    for (const r of all) {
      const i = identityFor(r.id);
      i.name = normName(r.name);
      if (r.placeId) i.placeIds.add(r.placeId);
      const phone = normPhone(r.phoneNumber);
      if (phone) i.phones.add(phone);
      const addr = normAddress(r.locationAddress);
      if (addr) i.addresses.add(addr);
    }

    // place_id ONLY — deliberately NOT the street parts.
    //
    // showroom_store_locations has no suite/unit column, so its street data is
    // BUILDING-level: every tenant of one address normalizes identically. On live
    // data that pulled "Leandro Quintal" (1775 Monterey Rd #64A) into the Marblus
    // Granite group (#40C) — a different company in the same industrial park —
    // because both location rows read plainly "1775 Monterey Rd". The MAX_WEAK_FANOUT
    // cap did not catch it: only two rows shared the value, and the group already
    // carried a strong `name` link between the two genuine Marblus rows, so the
    // weak-only guard never fired either. The bad edge simply rode in on transitivity.
    //
    // The store's own `location_address` DOES carry the suite (Places formats it in),
    // so unit-level address matching is preserved above; a location's place_id is the
    // reliable per-site identity. Its suite-less street adds only false positives.
    const locRows = await db
      .select({
        storeId: showroomStoreLocations.storeId,
        placeId: showroomStoreLocations.placeId,
      })
      .from(showroomStoreLocations)
      .all();
    for (const l of locRows) {
      if (!byId.has(l.storeId)) continue;
      if (l.placeId) identityFor(l.storeId).placeIds.add(l.placeId);
    }

    const pocRows = await db
      .select({
        showroomId: showroomPocs.showroomId,
        phone: showroomPocs.phone,
        address: showroomPocs.address,
      })
      .from(showroomPocs)
      .all();
    for (const p of pocRows) {
      if (!byId.has(p.showroomId)) continue;
      const i = identityFor(p.showroomId);
      const phone = normPhone(p.phone);
      if (phone) i.phones.add(phone);
      const addr = normAddress(p.address);
      if (addr) i.addresses.add(addr);
    }

    // ONLY type = WEBSITE. showroom_store_links also holds social/profile links,
    // and those are shared by definition — linkedin.com, youtube.com, houzz.com
    // and x.com alone fused 36 unrelated stores into a single component on the
    // live directory. A store's own domain identifies the business; its Houzz
    // profile identifies Houzz.
    const linkRows = await db
      .select({ storeId: showroomStoreLinks.storeId, url: showroomStoreLinks.url })
      .from(showroomStoreLinks)
      .where(eq(showroomStoreLinks.type, "WEBSITE"))
      .all();
    for (const l of linkRows) {
      if (!byId.has(l.storeId)) continue;
      const host = normHost(l.url);
      if (host) identityFor(l.storeId).hosts.add(host);
    }

    const signalGroups = groupBySignals(Array.from(identities.values()));

    type Plan = {
      keepId: number;
      keepName: string;
      deleteIds: number[];
      linkedBy: SignalKind[];
    };
    const plans: Plan[] = [];
    /** Chain branches — real, distinct sites. Never auto-merged; a 0046 backlog. */
    const branchCandidates: Array<{
      key: string;
      ids: number[];
      names: string[];
      linkedBy: SignalKind[];
      evidence: Array<{ signal: SignalKind; value: string; storeIds: number[] }>;
      reason: string;
    }> = [];

    for (const g of signalGroups) {
      const rows = g.storeIds.map((id) => byId.get(id)).filter((r): r is StoreRow => Boolean(r));
      if (rows.length < 2) continue;

      const reals = rows.filter(isReal);

      // Two guards, both routing to human review rather than auto-merge:
      //  1. >=2 "real" rows are distinct SITES — chain branches, not duplicates.
      //  2. a group held together only by a shared address/phone is co-located
      //     businesses (Walker Zanger and New Century Kitchen & Bath share a
      //     street; DEGREE HVAC and CB Showers share one too). Never merge on
      //     that alone, however few rows it involves.
      const weakOnly = !g.hasStrongSignal;
      if (reals.length >= 2 || weakOnly) {
        branchCandidates.push({
          key: normName(rows[0].name),
          ids: rows.map((r) => r.id).sort((a, b) => a - b),
          names: rows.map((r) => r.name),
          linkedBy: g.signals,
          // Trim the evidence to what a reviewer needs; place ids/addresses are long.
          evidence: g.evidence.slice(0, 8),
          reason: weakOnly
            ? `Linked only by ${g.signals.join(", ")} — a shared address or phone means a shared BUILDING ` +
              `or switchboard, not one business. Review by hand; never auto-merged.`
            : `${reals.length} rows have their own zip/placeId — distinct SITES of what looks like one ` +
              `business (linked by ${g.signals.join(", ")}). Under the multi-location model these should ` +
              `become ONE store with ${reals.length} location rows. Not auto-merged — confirm, then use ` +
              `add_showroom_location.`,
        });
        continue;
      }

      // Merge ONLY among the active rows. Two rules ride on this:
      //   - The keeper is the highest-scoring ACTIVE row, never an inactive one.
      //     Scoring alone could put a soft-deleted row first, and keeping a dead
      //     row while retiring live duplicates behind it hides real data.
      //   - Already-soft-deleted losers are done — their children were remapped by
      //     the run that retired them. Excluding them lets the dry run report
      //     "clean" after an apply instead of re-listing every retired group.
      // With fewer than two active rows there is nothing to merge. (`is_active` is
      // NOT NULL in the schema; the explicit `=== true` states the intent anyway.)
      const active = [...rows]
        .filter((r) => r.isActive === true)
        .sort((a, b) => score(b) - score(a) || a.id - b.id);
      if (active.length < 2) continue;

      const [keeper, ...losers] = active;
      plans.push({
        keepId: keeper.id,
        keepName: keeper.name,
        deleteIds: losers.map((r) => r.id),
        linkedBy: g.signals,
      });
    }

    plans.sort((a, b) => a.keepId - b.keepId);
    const scoped = input.limitGroups ? plans.slice(0, input.limitGroups) : plans;
    const allDeleteIds = scoped.flatMap((p) => p.deleteIds);

    // Per-table child-row counts on the delete set (the review signal).
    const childCounts = await countStoreChildren(db, allDeleteIds);

    if (!apply) {
      return {
        mode: "dry-run",
        totalStores: all.length,
        duplicateGroups: scoped.length,
        rowsToMerge: allDeleteIds.length,
        rowsAfter: all.length - allDeleteIds.length,
        branchCandidates,
        childRowCounts: childCounts,
        plan: scoped,
        note:
          "Nothing was written. Review the plan + childRowCounts, then re-run with apply:true. Each plan entry " +
          "carries `linkedBy` — the signals that grouped it (place_id/phone/address/website/name) — so you can see " +
          "WHY rows were matched. Child rows are remapped to the keeper (deduped where the keeper already has " +
          "them); each duplicate store is then soft-deleted (is_active = 0), not hard-deleted. " +
          "`branchCandidates` are NEVER touched by apply:true: they are two or more REAL sites of what looks like " +
          "one business, and under the multi-location model they should become one store with several location " +
          "rows. Confirm each, then fold them in with add_showroom_location.",
      };
    }

    // ── APPLY: merge children into the keeper, then soft-delete the duplicates.
    let childRowsMoved = 0;
    let storesMerged = 0;
    for (const p of scoped) {
      if (p.deleteIds.length === 0) continue;

      // Move every child/support row onto the keeper (shared with the 0047 collapse path).
      childRowsMoved += await remapStoreChildren(db, p.keepId, p.deleteIds);

      // SOFT-DELETE the now-emptied duplicate store rows.
      for (const ids of chunk(p.deleteIds)) {
        const res = await db
          .update(showroomStores)
          .set({ isActive: false, keeperStoreId: p.keepId, updatedAt: new Date() })
          .where(inArray(showroomStores.id, ids))
          .run();
        storesMerged += changesOf(res);
      }
    }

    // Authoritative active count from the live table — never derive it by
    // arithmetic (a prior version conflated store deletes with dropped child
    // rows and mis-reported the total). storesSoftDeleted counts only the
    // is_active=0 updates; childRowsMoved counts only child remaps — kept
    // separate so neither inflates the other.
    const [{ n: totalActiveAfter } = { n: 0 }] = await db
      .select({ n: count() })
      .from(showroomStores)
      .where(eq(showroomStores.isActive, true));

    return {
      mode: "apply",
      totalStoresBefore: all.length,
      duplicateGroups: scoped.length,
      childRowsMoved,
      storesSoftDeleted: storesMerged,
      totalActiveAfter,
      branchCandidates,
    };
  },
});
