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
 * D1 shape: one `db.batch([...])` with two independent SELECTs — contracts
 * (joined to vendor + linked-estimate money) and ALL compliance-gate rows
 * (this table is small: at most 4 rows per contract, capped by the unique
 * index in `contract_compliance_gates.ts`) — stitched together in the
 * Worker by `contractId`. No per-contract follow-up query.
 */
import {
  contractComplianceGates,
  contracts,
  estimateCompanies,
  estimateRevisions,
  estimates,
} from "@backend/db";
import { eq } from "drizzle-orm";
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
const SEVERITY: Record<GateState, number> = { na: 0, pass: 0, warn: 1, fail: 2 };

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
    .replace(/"/g, "&quot;");
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

/**
 * California Business & Professions Code §7159.5 — a home improvement
 * contract's down payment may not exceed the LESSER of $1,000 or 10% of the
 * contract price (finance charges excluded). Integer-cents arithmetic only:
 * 10% via floor(contractValueCents / 10), never a float multiply — flooring
 * rounds the cap DOWN, which is the conservative (more strict) direction.
 */
export function capForContractCents(contractValueCents: number): number {
  return Math.min(100_000, Math.floor(contractValueCents / 10));
}

function downPaymentGate(
  contractValueCents: number | null,
  depositAmountCents: number | null,
): Gate {
  if (contractValueCents == null || depositAmountCents == null) {
    return {
      gateType: "down_payment_cap",
      label: GATE_LABELS.down_payment_cap,
      state: "na",
      evidence: evidenceOf("No down payment recorded for this contract yet."),
      expiresAt: null,
    };
  }
  const capCents = capForContractCents(contractValueCents);
  const state: GateState = depositAmountCents > capCents ? "fail" : "pass";
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

const WARN_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

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
  const msLeft = expiresAtMs - nowMs;
  let state: GateState;
  let markdown: string;
  if (msLeft < 0) {
    state = "fail";
    markdown = `License expired ${formatDate(expiresAtMs)}.`;
  } else if (msLeft <= WARN_WINDOW_MS) {
    state = "warn";
    markdown = `License expires ${formatDate(expiresAtMs)} — renew within 60 days.`;
  } else {
    state = "pass";
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
    evidence: hasEvidence
      ? {
          markdown: row.evidenceMarkdown ?? (row.evidenceHtml ? row.evidenceHtml : null),
          html:
            row.evidenceHtml ??
            (row.evidenceMarkdown ? `<p>${escapeHtml(row.evidenceMarkdown)}</p>` : null),
        }
      : { markdown: null, html: null },
    expiresAt: row.expiresAt ? Math.floor(row.expiresAt.getTime() / 1000) : null,
  };
}

// --- GET /api/budget/compliance ---------------------------------------------

budgetComplianceRouter.get("/compliance", async (c) => {
  try {
    const db = drizzle(c.env.DB);

    const contractsQuery = db
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
      .where(eq(contracts.isActive, true));

    const gatesQuery = db
      .select({
        contractId: contractComplianceGates.contractId,
        gateType: contractComplianceGates.gateType,
        state: contractComplianceGates.state,
        evidenceMarkdown: contractComplianceGates.evidenceMarkdown,
        evidenceHtml: contractComplianceGates.evidenceHtml,
        expiresAt: contractComplianceGates.expiresAt,
      })
      .from(contractComplianceGates);

    const [contractRows, gateRows] = await db.batch([contractsQuery, gatesQuery]);

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

    return c.json({ contracts: responseContracts });
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

// --- self-check ------------------------------------------------------------

/** ponytail: self-check for the CSLB down-payment-cap math — money/compliance logic. */
export function __selfCheck(): void {
  // $118,400 contract → 10% = $11,840, cap = lesser of $1,000 or $11,840 = $1,000.
  console.assert(capForContractCents(118_400_00) === 100_000, "large contract caps at $1,000");
  // $9,500 contract → 10% = $950, which is under $1,000, so cap = $950.
  console.assert(capForContractCents(9_500_00) === 95_000, "small contract caps at 10%");
  // Exact boundary: $10,000 contract → 10% = $1,000 = the flat cap either way.
  console.assert(capForContractCents(10_000_00) === 100_000, "boundary contract caps at $1,000");
  // Non-round cents: floor(9_995_00 / 10) = 99_950 — never a float multiply artifact.
  console.assert(capForContractCents(9_995_00) === 99_950, "10% floors exactly, no float drift");

  console.assert(
    downPaymentGate(118_400_00, 400_000).state === "fail",
    "$4,000 down payment on a $118,400 contract must fail (cap is $1,000)",
  );
  console.assert(
    downPaymentGate(31_600_00, 95_000).state === "pass",
    "$950 down payment on a $31,600 contract must pass (cap is $1,000)",
  );
  console.assert(
    downPaymentGate(null, 100_000).state === "na",
    "no contract value on file must be na, never pass",
  );
  console.assert(
    downPaymentGate(118_400_00, null).state === "na",
    "no recorded down payment must be na, never pass",
  );
}
