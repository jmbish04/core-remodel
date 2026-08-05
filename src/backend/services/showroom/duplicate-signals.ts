/**
 * @fileoverview Identity signals for grouping duplicate `showroom_stores` rows.
 *
 * `duplicate-check.ts` answers "does this INCOMING store already exist?" at create
 * time, using place_id / phone / address / website. This module answers the other
 * half — "which EXISTING rows are the same thing?" — for the bulk dedupe pass,
 * which until now grouped on normalized name alone and therefore missed every
 * duplicate whose two rows were named even slightly differently.
 *
 * ## The signals do not all mean the same thing
 *
 * | Signal | A match proves |
 * |---|---|
 * | `place_id` | the same PHYSICAL SITE |
 * | phone (digits) | the same site — branches carry their own numbers |
 * | street address | the same site |
 * | website host | the same BUSINESS — a chain shares one domain across branches |
 * | normalized name | the same business (weakly — names collide) |
 *
 * That distinction is the whole point now that a business can own many locations.
 * Rows linked by a SITE signal are redundant and can be merged outright. Rows
 * linked only by a BUSINESS signal are branches: they belong under one store as
 * separate location rows, which is a different (and human-confirmed) operation.
 * This module reports which kind of link it found; it never decides to merge.
 *
 * ## Signals are collected across three tables, not just the store row
 *
 * A chain whose branches were filed under a second domain is invisible from the
 * parent columns alone. The real case: two `Jack London Kitchen & Bath` rows on
 * different hosts (`jacklondonkitchenandbath.com` vs `jlkbg.com`) were only
 * identifiable because a POC on one row carried the street address and phone of a
 * location on the other. So identity values are gathered from `showroom_stores`,
 * `showroom_store_locations` AND `showroom_pocs`.
 */

/** How two rows came to be linked. SITE ⇒ redundant row; BUSINESS ⇒ branches. */
export type SignalKind = "place_id" | "phone" | "address" | "website" | "name";

/** SITE signals mean one physical location; BUSINESS signals mean one company. */
export const SITE_SIGNALS: readonly SignalKind[] = ["place_id", "phone", "address"];
export const BUSINESS_SIGNALS: readonly SignalKind[] = ["website", "name"];

export const isSiteSignal = (s: SignalKind): boolean => SITE_SIGNALS.includes(s);

/**
 * STRONG signals identify a business or an exact site and are safe to merge on.
 * WEAK ones (phone, street address) identify a *place* that businesses share.
 *
 * This distinction is not theoretical. Grouping on address alone fused 37
 * unrelated stores into one component on the live directory — every tenant of
 * 2 Henry Adams St (the San Francisco Design Center) plus everything that then
 * chained off them: Cole Hardware, Cushman & Wakefield, SiteOne Landscape
 * Supply. Walker Zanger and New Century Kitchen & Bath share a street address
 * and are simply different companies at one building; DEGREE HVAC and CB
 * Showers likewise.
 *
 * So a weak signal may SURFACE a group for review, but may never be the sole
 * reason a group is auto-merged.
 */
export const STRONG_SIGNALS: readonly SignalKind[] = ["place_id", "website", "name"];
export const isStrongSignal = (s: SignalKind): boolean => STRONG_SIGNALS.includes(s);

/**
 * A phone or street address carried by more than this many stores is a shared
 * facility — a design centre, a business park, a parent company's switchboard —
 * not an identity. Two is the largest count that can still mean "one business
 * filed twice"; beyond that it is a building.
 */
export const MAX_WEAK_FANOUT = 2;

/** Digits only, so "(650) 363-7333" and "650-363-7333" compare equal. */
export function normPhone(value: string | null | undefined): string {
  const d = (value ?? "").replace(/\D/g, "");
  // Drop a US country prefix so +1 650… matches 650….
  const local = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  // Below 10 digits it is an extension fragment or junk — not an identity.
  return local.length === 10 ? local : "";
}

/** Lowercased alphanumerics. Short values are rejected as non-identifying. */
export function normAddress(value: string | null | undefined): string {
  const a = (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Must carry a street number, or "Suite F" style fragments collide wildly.
  return a.length >= 8 && /\d/.test(a) ? a : "";
}

/** Registrable hostname, `www.` stripped. */
export function normHost(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Hosts that identify a marketplace or platform rather than a business. A shared
 * `squarespace.com` proves nothing, and grouping on it would fuse unrelated stores
 * into one giant blob.
 */
const GENERIC_HOSTS = new Set([
  // Site builders / storefront platforms.
  "squarespace.com",
  "wixsite.com",
  "wix.com",
  "shopify.com",
  "myshopify.com",
  "business.site",
  "godaddysites.com",
  "weebly.com",
  "sites.google.com",
  "google.com",
  // Social / directory profiles. Callers should already be filtering to the
  // WEBSITE link type, but a social URL mis-filed as a website must not group:
  // linkedin/youtube/houzz/x alone fused 36 unrelated stores on the live data.
  "facebook.com",
  "instagram.com",
  "yelp.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "houzz.com",
  "x.com",
  "twitter.com",
  "pinterest.com",
  "linktr.ee",
  "tiktok.com",
]);

export const isGenericHost = (host: string): boolean =>
  !host || GENERIC_HOSTS.has(host) || host.split(".").length < 2;

/**
 * Normalize a store name for comparison.
 *
 * Beyond lowercasing this has to undo how branch rows were historically named,
 * because those conventions are exactly what defeated name matching:
 *
 *  - `&` ⇄ `and` — "Kitchen and Bath" vs "Kitchen & Bath" never grouped, which is
 *    why the two real Jack London rows were never even considered.
 *  - a trailing branch/city suffix — "Jack London Kitchen and Bath **-Walnut
 *    Creek**", "All Natural Stone **- San Jose**" — is a location, not a name.
 *  - legal suffixes (inc, llc, corp…) and punctuation are noise.
 */
export function normName(value: string | null | undefined): string {
  let s = (value ?? "").toLowerCase();

  s = s.replace(/&/g, " and ");
  // Strip a trailing "- City" / "– City" / ", City" branch suffix (one level).
  s = s.replace(/\s*[-–—,]\s*[a-z][a-z .']{2,24}$/, "");
  s = s.replace(/\b(inc|llc|l\.l\.c|corp|corporation|co|ltd|company)\b\.?/g, " ");
  s = s.replace(/[^a-z0-9]+/g, " ");

  return s.replace(/\s+/g, " ").trim();
}

/** One store's identity values, gathered from the store row + locations + POCs. */
export interface StoreIdentity {
  storeId: number;
  placeIds: Set<string>;
  phones: Set<string>;
  addresses: Set<string>;
  hosts: Set<string>;
  name: string;
}

export function emptyIdentity(storeId: number): StoreIdentity {
  return {
    storeId,
    placeIds: new Set(),
    phones: new Set(),
    addresses: new Set(),
    hosts: new Set(),
    name: "",
  };
}

/** Minimal union-find — groups stores that share ANY identity value. */
class UnionFind {
  private parent = new Map<number, number>();

  find(x: number): number {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface SignalGroup {
  storeIds: number[];
  /** Every signal kind that contributed a link, for the dry-run review. */
  signals: SignalKind[];
  /** True when at least one SITE signal linked the group (⇒ redundant rows). */
  hasSiteSignal: boolean;
  /**
   * True when a STRONG signal (place_id / website / name) linked the group.
   * A group held together only by a shared address or phone is a co-located
   * business, not a duplicate — callers must not auto-merge it.
   */
  hasStrongSignal: boolean;
  /** The specific values that linked them — the evidence a human reviews. */
  evidence: Array<{ signal: SignalKind; value: string; storeIds: number[] }>;
}

/**
 * Group store identities by every shared signal.
 *
 * Union-find rather than a single key, because identity is transitive across
 * DIFFERENT signals: A and B can share a phone while B and C share a place id,
 * making all three one store. Keying on any one field would split that.
 *
 * Generic hosts and non-identifying values are dropped before linking, so a
 * shared Squarespace domain or a 7-digit phone fragment never fuses a group.
 */
export function groupBySignals(identities: StoreIdentity[]): SignalGroup[] {
  const uf = new UnionFind();
  for (const i of identities) uf.find(i.storeId);

  // value -> the stores carrying it, per signal kind.
  const buckets = new Map<SignalKind, Map<string, number[]>>();
  const put = (kind: SignalKind, value: string, storeId: number) => {
    if (!value) return;
    let byValue = buckets.get(kind);
    if (!byValue) buckets.set(kind, (byValue = new Map()));
    const ids = byValue.get(value);
    if (ids) {
      if (!ids.includes(storeId)) ids.push(storeId);
    } else {
      byValue.set(value, [storeId]);
    }
  };

  for (const i of identities) {
    for (const v of i.placeIds) put("place_id", v, i.storeId);
    for (const v of i.phones) put("phone", v, i.storeId);
    for (const v of i.addresses) put("address", v, i.storeId);
    for (const v of i.hosts) if (!isGenericHost(v)) put("website", v, i.storeId);
    put("name", i.name, i.storeId);
  }

  const evidenceAll: Array<{ signal: SignalKind; value: string; storeIds: number[] }> = [];
  for (const [kind, byValue] of Array.from(buckets.entries())) {
    for (const [value, ids] of Array.from(byValue.entries())) {
      if (ids.length < 2) continue;

      // A weak value shared by a crowd is a building, not a business. Skip it
      // entirely — including as evidence — so it cannot chain a component open.
      if (!isStrongSignal(kind) && ids.length > MAX_WEAK_FANOUT) continue;

      evidenceAll.push({ signal: kind, value, storeIds: [...ids].sort((a, b) => a - b) });
      for (let n = 1; n < ids.length; n++) uf.union(ids[0], ids[n]);
    }
  }

  const byRoot = new Map<number, number[]>();
  for (const i of identities) {
    const root = uf.find(i.storeId);
    const arr = byRoot.get(root);
    if (arr) arr.push(i.storeId);
    else byRoot.set(root, [i.storeId]);
  }

  const groups: SignalGroup[] = [];
  for (const ids of Array.from(byRoot.values())) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort((a, b) => a - b);
    const idSet = new Set(sorted);
    const evidence = evidenceAll.filter((e) => e.storeIds.some((id) => idSet.has(id)));
    const signals = Array.from(new Set(evidence.map((e) => e.signal)));
    groups.push({
      storeIds: sorted,
      signals,
      hasSiteSignal: signals.some(isSiteSignal),
      hasStrongSignal: signals.some(isStrongSignal),
      evidence,
    });
  }

  return groups.sort((a, b) => a.storeIds[0] - b.storeIds[0]);
}

/** ponytail: self-check for the normalizers + the transitive grouping. */
export function __selfCheck(): void {
  console.assert(
    normName("Jack London Kitchen and Bath") === normName("Jack London Kitchen & Bath"),
    "& should fold to and",
  );
  console.assert(
    normName("Jack London Kitchen and Bath -Walnut Creek") ===
      normName("Jack London Kitchen & Bath"),
    "branch suffix should be stripped",
  );
  console.assert(normName("Bedrosians Tile & Stone, Inc.") === "bedrosians tile and stone", "legal suffix");
  console.assert(normPhone("(650) 363-7333") === "6503637333", "phone digits");
  console.assert(normPhone("+1 650-363-7333") === "6503637333", "country prefix");
  console.assert(normPhone("363-7333") === "", "short phone rejected");
  console.assert(normAddress("1620 Industrial Way") === "1620industrialway", "address");
  console.assert(normAddress("Suite F") === "", "fragment rejected");
  console.assert(normHost("https://www.JLKBG.com/x") === "jlkbg.com", "host");
  console.assert(isGenericHost("squarespace.com"), "generic host rejected");

  // Transitivity: A~B by phone, B~C by place_id ⇒ one group of three.
  const a = emptyIdentity(1);
  a.phones.add("6503637333");
  a.name = "alpha";
  const b = emptyIdentity(2);
  b.phones.add("6503637333");
  b.placeIds.add("PID");
  b.name = "beta";
  const c = emptyIdentity(3);
  c.placeIds.add("PID");
  c.name = "gamma";
  const groups = groupBySignals([a, b, c]);
  console.assert(groups.length === 1, `expected 1 group, got ${groups.length}`);
  console.assert(groups[0].storeIds.join(",") === "1,2,3", `got ${groups[0]?.storeIds}`);
  console.assert(groups[0].hasSiteSignal, "phone/place_id are SITE signals");

  // A shared generic host must NOT fuse two otherwise-unrelated stores.
  const d = emptyIdentity(10);
  d.hosts.add("squarespace.com");
  d.name = "delta";
  const e = emptyIdentity(11);
  e.hosts.add("squarespace.com");
  e.name = "epsilon";
  console.assert(groupBySignals([d, e]).length === 0, "generic host must not group");

  // REGRESSION — the San Francisco Design Center blob. A street address carried
  // by a crowd of tenants is a building, and must not fuse them into one
  // component (this produced a single 37-store group on the live directory).
  const tenants = ["whole wood", "de gournay", "ann sacks", "cole hardware"].map((n, idx) => {
    const t = emptyIdentity(100 + idx);
    t.addresses.add("2henryadamsst");
    t.name = n;
    return t;
  });
  console.assert(
    groupBySignals(tenants).length === 0,
    `shared building address must not group ${tenants.length} tenants`,
  );

  // …but exactly two rows at one address still surface for review.
  const p = emptyIdentity(200);
  p.addresses.add("1620industrialway");
  p.name = "one";
  const q = emptyIdentity(201);
  q.addresses.add("1620industrialway");
  q.name = "two";
  const pair = groupBySignals([p, q]);
  console.assert(pair.length === 1, "a 2-store address match should still group");
  console.assert(
    pair[0] && !pair[0].hasStrongSignal,
    "address-only groups must be flagged weak, never auto-merged",
  );
}
