/**
 * @fileoverview Budget Command Center — compliance surface, read API.
 *
 * `GET /api/budget/compliance` (mounted at `/api/budget` — see
 * `src/backend/api/index.ts`, which a separate integration pass wires up).
 * Every active contract joined to its four payment-compliance gates, per
 * `docs/plans/budget-command-center/API-CONTRACT.md` §8:
 * `down_payment_cap`, `signed_change_order`, `lien_release`, `license_active`.
 *
 * Two of the four gates are pure arithmetic over data this Worker already
 * has, so they are computed live, every request, instead of trusted from a
 * background job:
 *   - `down_payment_cap` — the CA CSLB down-payment cap (see
 *     `capForContractCents` below).
 *   - `license_active` — derived from `estimate_companies.license_expires_at`.
 *
 * The other two (`signed_change_order`, `lien_release`) require document
 * judgment this route cannot derive on its own, so they are read from
 * `contract_compliance_gates` (owned by a separate evaluation pipeline, not
 * built yet). A contract with no row for a gate type reads as `na` — never
 * fabricated as `pass`.
 *
 * D1 shape: `GET /compliance?limit=&cursor=` keyset-paginates ACTIVE
 * contracts (never an unbounded table scan), then fetches compliance-gate
 * rows scoped to exactly that page's contract ids — chunked at 90 ids and
 * `db.batch()`'d per D1's 100-bound-parameter cap — and stitches them
 * together in the Worker by `contractId`. No per-contract follow-up query.
 */
import {
  contractComplianceGates,
  contracts,
  estimateCompanies,
  estimateRevisions,
  estimates,
} from "@backend/db";
import {
  capForContractCents,
  downPaymentCapVerdict,
  licenseActiveVerdict,
  LICENSE_WARN_WINDOW_SECONDS,
} from "@backend/services/budget/compliance-gates";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const budgetComplianceRouter = new Hono<{ Bindings: Env }>();

// --- Types -------------------------------------------------------------

type GateType = "down_payment_cap" | "signed_change_order" | "lien_release" | "license_active";
type GateState = "pass" | "fail" | "warn" | "na";

interface Gate {
  gateType: GateType;
  label: string;
  state: GateState;
  evidence: { markdown: string | null; html: string | null };
  expiresAt: number | null;
}

const GATE_LABELS: Record<GateType, string> = {
  down_payment_cap: "Down-payment cap",
  signed_change_order: "Signed change-order",
  lien_release: "Lien release on file",
  license_active: "License active",
};

// Block > warn > ok/na — used both to combine the gates table's stored rows
// (any number of rows, one contract) and to fold in the two live-computed
// gates. Always exactly 4 gates per contract, so this is a fixed-size max,
// not a reduce over an unbounded row set — the D1-DRIZZLE-RULES ban on
// "reducing rows in JS" targets aggregating many DB rows (money, counts),
// which the gates-table half of this already avoids via db.batch fetching
// every row in one shot rather than N+1.
//
// `na` is NOT folded into "ok". `na` means "nothing has evaluated this gate
// yet" — an absence of evidence, not a pass. Two of the four gates
// (signed_change_order, lien_release) are always `na` until the evaluation
// pipeline referenced in the file header exists, so treating `na` as `ok`
// would render a green "ok" badge for a contract nothing has actually
// checked. `na` therefore carries the same severity as `warn`: it can never
// win over a real `fail`, but it can never silently present as `ok` either.
// Kept inside the existing "ok" | "block" | "warn" response enum (no schema
// change) rather than adding a fourth overall state — see the report for
// why that's the call.
const SEVERITY: Record<GateState, number> = { na: 1, pass: 0, warn: 1, fail: 2 };

function overallStateOf(states: GateState[]): "ok" | "block" | "warn" {
  const worst = Math.max(...states.map((s) => SEVERITY[s]));
  if (worst >= 2) return "block";
  if (worst === 1) return "warn";
  return "ok";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function evidenceOf(markdown: string): { markdown: string; html: string } {
  return { markdown, html: `<p>${escapeHtml(markdown)}</p>` };
}

function formatMonthYear(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

// --- down_payment_cap ----------------------------------------------------

// California Business & Professions Code §7159.5 — a home improvement
// contract's down payment may not exceed the LESSER of $1,000 or 10% of the
// contract price (finance charges excluded). The verdict itself
// (capForContractCents + the pass/fail call) is SHARED math imported from
// `@backend/services/budget/compliance-gates` — budget-workbench.ts's header
// badge and decision inbox count/rank on the exact same function, so the two
// surfaces cannot disagree about which contracts are over the cap. This file
// only adds the human-readable evidence text on top of that shared verdict.
export function downPaymentGate(
  contractValueCents: number | null,
  depositAmountCents: number | null,
): Gate {
  if (contractValueCents == null || depositAmountCents == null) {
    // Say which value is actually missing — "no down payment" when the
    // contract price is the thing that's absent is misleading.
    const missing =
      contractValueCents == null && depositAmountCents == null
        ? "No contract price or down payment recorded for this contract yet."
        : contractValueCents == null
          ? "No contract price recorded for this contract yet."
          : "No down payment recorded for this contract yet.";
    return {
      gateType: "down_payment_cap",
      label: GATE_LABELS.down_payment_cap,
      state: "na",
      evidence: evidenceOf(missing),
      expiresAt: null,
    };
  }
  const state = downPaymentCapVerdict(contractValueCents, depositAmountCents);
  const capCents = capForContractCents(contractValueCents);
  const verb = state === "fail" ? "requested" : "collected";
  const comparison = state === "fail" ? "exceeds" : "under";
  const markdown =
    `$${(depositAmountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${verb} · ` +
    `${comparison} the $${(capCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} cap ` +
    `(lesser of $1,000 or 10% of a $${(contractValueCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} contract)`;
  return {
    gateType: "down_payment_cap",
    label: GATE_LABELS.down_payment_cap,
    state,
    evidence: evidenceOf(markdown),
    expiresAt: null,
  };
}

// --- license_active --------------------------------------------------------

// The pass/warn/fail verdict is shared math (see the down_payment_cap note
// above) — LICENSE_WARN_WINDOW_SECONDS from compliance-gates.ts is the same
// 60-day window budget-workbench.ts counts/ranks against.

function licenseGate(licenseExpiresAt: Date | null, nowMs: number): Gate {
  if (!licenseExpiresAt) {
    return {
      gateType: "license_active",
      label: GATE_LABELS.license_active,
      state: "na",
      evidence: evidenceOf("No license expiration on file for this vendor."),
      expiresAt: null,
    };
  }
  const expiresAtMs = licenseExpiresAt.getTime();
  const state = licenseActiveVerdict(licenseExpiresAt, nowMs);
  const warnWindowDays = Math.round(LICENSE_WARN_WINDOW_SECONDS / (24 * 60 * 60));
  let markdown: string;
  if (state === "fail") {
    markdown = `License expired ${formatDate(expiresAtMs)}.`;
  } else if (state === "warn") {
    markdown = `License expires ${formatDate(expiresAtMs)} — renew within ${warnWindowDays} days.`;
  } else {
    markdown = `Verified with CSLB · expires ${formatMonthYear(expiresAtMs)}.`;
  }
  return {
    gateType: "license_active",
    label: GATE_LABELS.license_active,
    state,
    evidence: evidenceOf(markdown),
    expiresAt: Math.floor(expiresAtMs / 1000),
  };
}

// --- signed_change_order / lien_release (from contract_compliance_gates) ---

function gateFromRow(
  gateType: GateType,
  row: {
    state: string;
    evidenceMarkdown: string | null;
    evidenceHtml: string | null;
    expiresAt: Date | null;
  } | null,
): Gate {
  if (!row) {
    return {
      gateType,
      label: GATE_LABELS[gateType],
      state: "na",
      evidence: evidenceOf("Not yet evaluated."),
      expiresAt: null,
    };
  }
  const state = (["pass", "fail", "warn", "na"] as const).includes(row.state as GateState)
    ? (row.state as GateState)
    : "na";
  const hasEvidence = row.evidenceMarkdown != null || row.evidenceHtml != null;
  return {
    gateType,
    label: GATE_LABELS[gateType],
    state,
    // markdown and html are different formats — never cross them. If only
    // one was stored, the other stays null rather than being filled from
    // the wrong format (raw HTML is not valid markdown, and vice versa).
    evidence: hasEvidence
      ? {
          markdown: row.evidenceMarkdown,
          html:
            row.evidenceHtml ??
            (row.evidenceMarkdown ? `<p>${escapeHtml(row.evidenceMarkdown)}</p>` : null),
        }
      : { markdown: null, html: null },
    expiresAt: row.expiresAt ? Math.floor(row.expiresAt.getTime() / 1000) : null,
  };
}

// --- pagination --------------------------------------------------------

// API-CONTRACT.md §8 originally shipped `{ contracts: [...] }` with no
// pagination — but D1-DRIZZLE-RULES.md's own pre-merge checklist bans an
// unbounded list endpoint, and this query had neither a WHERE-scoped gates
// join nor a LIMIT. Adding keyset pagination here widens the response with
// `nextCursor` (see the report — flagging for the frontend client + the
// contract doc to catch up).
const PAGE_LIMIT_DEFAULT = 50;
const PAGE_LIMIT_MAX = 100;
// D1 caps a statement at 100 bound parameters (D1-DRIZZLE-RULES.md §4); the
// gates follow-up query binds one parameter per contract id via inArray, so
// chunk at 90 and db.batch() the chunks rather than risk one query at the
// boundary.
const GATE_ID_CHUNK_SIZE = 90;

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

// --- GET /api/budget/compliance ---------------------------------------------

budgetComplianceRouter.get("/compliance", async (c) => {
  try {
    const db = drizzle(c.env.DB);

    const rawLimit = c.req.query("limit");
    let limit = PAGE_LIMIT_DEFAULT;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > PAGE_LIMIT_MAX) {
        return c.json({ error: `limit must be an integer between 1 and ${PAGE_LIMIT_MAX}` }, 400);
      }
      limit = parsed;
    }

    const rawCursor = c.req.query("cursor");
    let cursorId: number | undefined;
    if (rawCursor !== undefined) {
      if (!/^\d+$/.test(rawCursor)) {
        return c.json({ error: "cursor must be a numeric contract id" }, 400);
      }
      cursorId = Number(rawCursor);
    }

    // Page the ACTIVE contracts only — never every row in the table. Gates
    // are then scoped to exactly this page's contract ids below, so the
    // gates query never reads gates belonging to inactive contracts either.
    const contractRowsPlusOne = await db
      .select({
        contractId: contracts.id,
        vendorName: estimateCompanies.name,
        tradeRaw: estimateCompanies.businessType,
        cslbLicenseNumber: estimateCompanies.cslbLicenseNumber,
        licenseExpiresAt: estimateCompanies.licenseExpiresAt,
        contractValueCents: estimateRevisions.totalAmountCents,
        depositAmountCents: estimateRevisions.depositAmountCents,
      })
      .from(contracts)
      .leftJoin(estimateCompanies, eq(contracts.estimateCompanyId, estimateCompanies.id))
      .leftJoin(estimates, eq(contracts.linkedEstimateId, estimates.id))
      .leftJoin(estimateRevisions, eq(estimates.currentRevisionId, estimateRevisions.id))
      .where(
        and(
          eq(contracts.isActive, true),
          cursorId !== undefined ? gt(contracts.id, cursorId) : undefined,
        ),
      )
      .orderBy(asc(contracts.id))
      .limit(limit + 1);

    const hasMore = contractRowsPlusOne.length > limit;
    const contractRows = contractRowsPlusOne.slice(0, limit);
    const contractIds = contractRows.map((row) => row.contractId);

    // Gates for exactly this page's contracts, chunked at the D1 bound-
    // parameter cap and batched into one round trip per chunk.
    const idChunks = chunk(contractIds, GATE_ID_CHUNK_SIZE);
    const gateQueries = idChunks.map((ids) =>
      db
        .select({
          contractId: contractComplianceGates.contractId,
          gateType: contractComplianceGates.gateType,
          state: contractComplianceGates.state,
          evidenceMarkdown: contractComplianceGates.evidenceMarkdown,
          evidenceHtml: contractComplianceGates.evidenceHtml,
          expiresAt: contractComplianceGates.expiresAt,
        })
        .from(contractComplianceGates)
        .where(inArray(contractComplianceGates.contractId, ids)),
    );
    const gateRowChunks = gateQueries.length
      ? await db.batch(
          gateQueries as [(typeof gateQueries)[number], ...(typeof gateQueries)[number][]],
        )
      : [];
    const gateRows = gateRowChunks.flat();

    const gatesByContract = new Map<number, Map<string, (typeof gateRows)[number]>>();
    for (const row of gateRows) {
      let byType = gatesByContract.get(row.contractId);
      if (!byType) {
        byType = new Map();
        gatesByContract.set(row.contractId, byType);
      }
      byType.set(row.gateType, row);
    }

    const nowMs = Date.now();

    const responseContracts = contractRows.map((row) => {
      const byType = gatesByContract.get(row.contractId);
      const gates: Gate[] = [
        downPaymentGate(row.contractValueCents, row.depositAmountCents),
        gateFromRow("signed_change_order", byType?.get("signed_change_order") ?? null),
        gateFromRow("lien_release", byType?.get("lien_release") ?? null),
        licenseGate(row.licenseExpiresAt, nowMs),
      ];

      const trade =
        row.tradeRaw && row.tradeRaw !== "unknown" ? row.tradeRaw.replace(/_/g, " ") : null;

      return {
        contractId: row.contractId,
        vendorLabel: row.vendorName ?? "Unknown vendor",
        tradeLabel: trade ? trade.charAt(0).toUpperCase() + trade.slice(1) : null,
        cslbLicenseNumber: row.cslbLicenseNumber ?? null,
        contractValueCents: row.contractValueCents ?? null,
        overallState: overallStateOf(gates.map((g) => g.state)),
        gates,
      };
    });

    const nextCursor = hasMore ? String(contractIds[contractIds.length - 1]) : null;

    return c.json({ contracts: responseContracts, nextCursor });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load budget compliance",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { budgetComplianceRouter };

// Self-check deliberately NOT here: this file is the route module itself,
// reachable from the Worker's entry point, so anything in it (including a
// console.assert self-test) ships in the deployed Worker bundle — this repo
// has hit Cloudflare's 10 MiB Worker script-size cap once already (see
// worker-10mb-liteparse-blocker in project memory / budget-grid-math.ts's
// identical note). The self-check lives instead in
// `scripts/tests/test_budget_compliance.mjs`, a standalone Node script that
// dynamically imports `capForContractCents` (from the shared
// services/budget/compliance-gates module) and this file's local
// `downPaymentGate`, and is never part of the Worker bundle. Run it with:
//   npx tsx scripts/tests/test_budget_compliance.mjs
