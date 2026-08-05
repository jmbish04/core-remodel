/**
 * nodeHealth — the single derived-health resolver (0041 Phase 0).
 *
 * HEALTH IS DERIVED, NEVER STORED. A room, budget line, permit, delivery or
 * contractor is unhealthy as a function of the impacts currently open against it
 * and everything blocking those impacts. A cached health column would drift, and
 * a drifting health signal is worse than no signal — it would show a green room
 * that is actually blocked.
 *
 * Every badge, every blast-radius highlight, and every forecast reads from here.
 * Same one-implementation discipline as roomReadiness.
 *
 * SEVERITY READS THROUGH STATE, NOT ALARM COLOUR. A project carrying three
 * problems must not look like a catastrophe, so the levels are ordinal and
 * deliberately few.
 */

export type HealthLevel = "ok" | "watch" | "at_risk" | "blocked";

export const HEALTH_ORDER: HealthLevel[] = ["ok", "watch", "at_risk", "blocked"];

export type ImpactStatus =
  | "forecast"
  | "active"
  | "mitigating"
  | "resolved"
  | "dismissed";

export type TargetEffect = "reopens" | "delays" | "inflates" | "blocks" | "informs";

export interface ImpactRow {
  id: number;
  status: ImpactStatus | string;
}

export interface TargetRow {
  impactId: number;
  targetKind: string;
  targetId: number;
  effect: TargetEffect | string;
}

export interface BlockRow {
  blockingImpactId: number;
  blockedImpactId: number;
}

export interface NodeRef {
  kind: string;
  id: number;
}

export interface NodeHealth {
  node: NodeRef;
  level: HealthLevel;
  /** Ids of the open impacts reaching this node. */
  openImpactIds: number[];
  /** Effects present on this node, deduped — what is actually happening to it. */
  effects: TargetEffect[];
}

/**
 * An impact counts toward health while it is unresolved and real.
 *
 * `forecast` deliberately does NOT count. A forecast is a prediction, and
 * letting predictions colour a node would make the diagram cry wolf — the exact
 * failure the two-tier forecasting rule exists to prevent. A forecast becomes an
 * alarm by becoming `active`, and only then does it touch health.
 */
export function isOpenImpact(status: string): boolean {
  return status === "active" || status === "mitigating";
}

function worst(a: HealthLevel, b: HealthLevel): HealthLevel {
  return HEALTH_ORDER.indexOf(a) >= HEALTH_ORDER.indexOf(b) ? a : b;
}

function levelForEffect(effect: string): HealthLevel {
  switch (effect) {
    case "blocks":
      return "blocked";
    case "reopens":
    case "delays":
    case "inflates":
      return "at_risk";
    case "informs":
      return "watch";
    default:
      return "watch";
  }
}

/**
 * The pure computation, over rows already fetched. Kept free of the database so
 * the blocking invariant can be tested directly.
 */
export function computeNodeHealth(
  node: NodeRef,
  impacts: ImpactRow[],
  targets: TargetRow[],
): NodeHealth {
  const openById = new Map<number, ImpactRow>();
  for (const i of impacts) {
    if (isOpenImpact(String(i.status))) openById.set(i.id, i);
  }

  const openImpactIds: number[] = [];
  const effects = new Set<TargetEffect>();
  let level: HealthLevel = "ok";

  for (const t of targets) {
    if (t.targetKind !== node.kind || t.targetId !== node.id) continue;
    if (!openById.has(t.impactId)) continue;

    if (!openImpactIds.includes(t.impactId)) openImpactIds.push(t.impactId);
    effects.add(t.effect as TargetEffect);
    level = worst(level, levelForEffect(String(t.effect)));
  }

  return { node, level, openImpactIds, effects: [...effects] };
}

/**
 * Blast radius: every node an open impact reaches, plus the nodes reached by
 * impacts that are blocked by those impacts.
 *
 * This is what makes the lens worth opening — a homeowner sees the reach of a
 * problem before it lands on them, in the same view, never in a separate report.
 */
export function blastRadius(
  origin: NodeRef,
  impacts: ImpactRow[],
  targets: TargetRow[],
  blocks: BlockRow[],
): NodeHealth[] {
  const openById = new Map<number, ImpactRow>();
  for (const i of impacts) {
    if (isOpenImpact(String(i.status))) openById.set(i.id, i);
  }

  // Impacts that touch the origin node.
  const seedImpacts = new Set<number>();
  for (const t of targets) {
    if (t.targetKind === origin.kind && t.targetId === origin.id && openById.has(t.impactId)) {
      seedImpacts.add(t.impactId);
    }
  }

  // Walk blocking edges forward: anything held up by a seed impact is also in
  // the radius. Guarded against cycles — writes reject them, but a traversal
  // that hangs on bad data is not an acceptable failure mode.
  const reached = new Set<number>(seedImpacts);
  const queue = [...seedImpacts];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const b of blocks) {
      if (b.blockingImpactId === current && !reached.has(b.blockedImpactId)) {
        reached.add(b.blockedImpactId);
        queue.push(b.blockedImpactId);
      }
    }
  }

  // Collect every node those impacts touch, and score each.
  const nodes = new Map<string, NodeRef>();
  for (const t of targets) {
    if (!reached.has(t.impactId)) continue;
    nodes.set(`${t.targetKind}:${t.targetId}`, { kind: t.targetKind, id: t.targetId });
  }

  return [...nodes.values()].map((n) => computeNodeHealth(n, impacts, targets));
}

/**
 * The blocking invariant: an impact cannot be resolved while anything blocking
 * it is still open.
 *
 * Enforced here rather than in a constraint because it is a graph property, not
 * a row property.
 */
export function canResolveImpact(
  impactId: number,
  impacts: ImpactRow[],
  blocks: BlockRow[],
): { ok: boolean; blockedBy: number[] } {
  const statusById = new Map<number, string>();
  for (const i of impacts) statusById.set(i.id, String(i.status));

  const blockedBy = blocks
    .filter((b) => b.blockedImpactId === impactId)
    .map((b) => b.blockingImpactId)
    .filter((id) => isOpenImpact(statusById.get(id) ?? ""));

  return { ok: blockedBy.length === 0, blockedBy };
}

/**
 * Cycle guard for writes. A block that would close a loop is rejected, because a
 * cycle makes the resolve rule unsatisfiable — every impact in the loop would
 * wait forever on another member.
 */
export function wouldCreateCycle(
  blockingImpactId: number,
  blockedImpactId: number,
  blocks: BlockRow[],
): boolean {
  if (blockingImpactId === blockedImpactId) return true;
  // Walk forward from the proposed blocked impact; if we reach the blocker, the
  // new edge closes a loop.
  const seen = new Set<number>([blockedImpactId]);
  const queue = [blockedImpactId];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const b of blocks) {
      if (b.blockingImpactId !== current) continue;
      if (b.blockedImpactId === blockingImpactId) return true;
      if (!seen.has(b.blockedImpactId)) {
        seen.add(b.blockedImpactId);
        queue.push(b.blockedImpactId);
      }
    }
  }
  return false;
}
