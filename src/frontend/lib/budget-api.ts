/**
 * @fileoverview Budget Command Center — typed HTTP client.
 *
 * One client for every endpoint in
 * `docs/plans/budget-command-center/API-CONTRACT.md`. ZERO SQL here — this
 * file speaks HTTP only. Every island imports from here; no island builds a
 * URL by hand.
 *
 * Conventions (see API-CONTRACT.md):
 * - Same-origin fetch, `credentials: "include"`, JSON in/out.
 * - Money crosses the wire as integer cents in a `*Cents` field.
 * - Rich text crosses as a `{ markdown, html }` pair.
 * - Timestamps are Unix seconds.
 * - Ids are numbers; a display name is never sent in place of an id.
 */

import { useCallback, useEffect, useState, type DependencyList } from "react";

// ────────────────────────────────────────────────────────────────────────
// Error type
// ────────────────────────────────────────────────────────────────────────

/** Thrown on any non-2xx response. Carries the HTTP status + server message. */
export class BudgetApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BudgetApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    let message = res.statusText || `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; details?: string };
      message = body.error ?? body.details ?? message;
    } catch {
      // response had no JSON body — keep the statusText message
    }
    throw new BudgetApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Generic over the param object: a TS `interface` has no implicit index
// signature, so it is not assignable to `Record<string, …>`.
function qs<T extends object>(params: T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// ────────────────────────────────────────────────────────────────────────
// Shared shapes
// ────────────────────────────────────────────────────────────────────────

export interface RichText {
  markdown: string | null;
  html: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// 1. GET /api/budget/workbench-summary
// ────────────────────────────────────────────────────────────────────────

export interface WorkbenchSummary {
  project: { name: string; addressLine: string };
  kpis: {
    totalBudgetCents: number;
    fundingAccountCount: number;
    spentToDateCents: number;
    spentPctOfBudget: number;
    remainingCents: number;
    runwayMonths: number | null;
    varianceVsEstimateCents: number;
    varianceDirection: "over" | "under" | "even";
  };
  tabCounts: {
    inbox: number;
    estimates: number;
    rooms: number;
    savings: number;
    compliance: number;
  };
  decisionsWaiting: number;
}

export function getWorkbenchSummary(signal?: AbortSignal): Promise<WorkbenchSummary> {
  return request<WorkbenchSummary>("/api/budget/workbench-summary", { signal });
}

// ────────────────────────────────────────────────────────────────────────
// 2. GET /api/budget/grid, PATCH /api/budget/plan-schedule
// ────────────────────────────────────────────────────────────────────────

export type BudgetGridView = "estimate" | "actuals" | "variance";

export interface BudgetGridCell {
  plannedCents: number | null;
  actualCents: number | null;
  isEditable: boolean;
}

export interface BudgetGridRow {
  lineItemId: number;
  trackId: string;
  title: string;
  vendorId: number | null;
  vendorLabel: string | null;
  phaseId: number;
  note: string | null;
  cells: Record<string, BudgetGridCell>;
  totalCents: number;
  varianceCents: number;
}

export interface BudgetGridPhase {
  phaseId: number;
  name: string;
  rows: BudgetGridRow[];
  subtotalCents: number;
}

export interface BudgetGrid {
  months: Array<{ key: string; label: string }>;
  phases: BudgetGridPhase[];
  footer: { availableBudgetCents: number; netBurnCents: number };
}

export interface GetGridParams {
  from: string; // "YYYY-MM"
  to: string; // "YYYY-MM"
  view: BudgetGridView;
}

export function getGrid(params: GetGridParams, signal?: AbortSignal): Promise<BudgetGrid> {
  return request<BudgetGrid>(`/api/budget/grid${qs(params)}`, { signal });
}

export interface PlanScheduleUpdate {
  lineItemId: number;
  month: string;
  plannedCents: number | null;
  /** Verbatim text the user typed (e.g. "1,299.00"). Optional, NOT nullable —
   * clearing a cell (plannedCents: null) deletes the row, so omit this
   * field entirely rather than sending null. */
  plannedText?: string;
}

export function patchPlanSchedule(body: PlanScheduleUpdate): Promise<void> {
  return request<void>("/api/budget/plan-schedule", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ────────────────────────────────────────────────────────────────────────
// 3. GET /api/budget/inbox
// ────────────────────────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  severity: "block" | "warn" | "info";
  title: string;
  detail: string | null;
  contextKind: "vendor" | "room" | "contract" | "estimate";
  contextId: number | null;
  contextLabel: string | null;
  exposureCents: number;
  actionKind: "review_contract" | "request_change_order" | "reconcile" | "mark_resolved";
  actionHref: string;
}

export interface InboxResponse {
  items: InboxItem[];
  total: number;
}

export function getInbox(signal?: AbortSignal): Promise<InboxResponse> {
  return request<InboxResponse>("/api/budget/inbox", { signal });
}

// ────────────────────────────────────────────────────────────────────────
// 4. GET /api/budget/rooms-finance
// ────────────────────────────────────────────────────────────────────────

export interface RoomFinanceRow {
  roomId: number;
  name: string;
  committedCents: number;
  spentCents: number;
  remainingCents: number;
  openMaterialsCount: number;
  risk: "ok" | "watch" | "at_risk";
}

export interface RoomFinanceTotals {
  committedCents: number;
  spentCents: number;
  remainingCents: number;
  openMaterialsCount: number;
}

export interface RoomsFinanceResponse {
  rooms: RoomFinanceRow[];
  /**
   * `totals` minus the sum of the rows. The totals are project-wide on purpose
   * (an item mapped to several rooms would double-count if summed across rows,
   * and money with no room at all would vanish), so the Total row will not
   * always equal the column above it. Render this delta rather than letting a
   * reader add the column and find a different number.
   */
  unassigned: RoomFinanceTotals;
  totals: {
    committedCents: number;
    spentCents: number;
    remainingCents: number;
    openMaterialsCount: number;
  };
}

export function getRoomsFinance(signal?: AbortSignal): Promise<RoomsFinanceResponse> {
  return request<RoomsFinanceResponse>("/api/budget/rooms-finance", { signal });
}

// ────────────────────────────────────────────────────────────────────────
// 5. Estimate reconciliation
// ────────────────────────────────────────────────────────────────────────

export interface ReconciliationCandidate {
  roomId: number;
  roomName: string;
  rank: number;
  verdict: "likely" | "possible" | "eliminated";
  reasoning: RichText;
  confidence: number | null;
}

export interface ReconciliationQueueItem {
  lineItemId: number;
  description: string;
  estimateCompanyId: number | null;
  estimateCompanyLabel: string | null;
  estimateLineNumber: string | null;
  lineTotalCents: number | null;
  mappingStatus: string;
  candidates: ReconciliationCandidate[];
}

export interface ReconciliationQueueResponse {
  items: ReconciliationQueueItem[];
  nextCursor: string | null;
}

export function getReconciliationQueue(
  params?: { limit?: number; cursor?: string },
  signal?: AbortSignal,
): Promise<ReconciliationQueueResponse> {
  return request<ReconciliationQueueResponse>(
    `/api/budget/reconciliation-queue${qs({ limit: params?.limit, cursor: params?.cursor })}`,
    { signal },
  );
}

export function confirmReconciliation(lineItemId: number, body: { roomId: number }): Promise<void> {
  return request<void>(`/api/budget/reconciliation/${lineItemId}/confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function rejectReconciliation(lineItemId: number, body: { reason?: string }): Promise<void> {
  return request<void>(`/api/budget/reconciliation/${lineItemId}/reject`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ────────────────────────────────────────────────────────────────────────
// 6. Funding accounts
// ────────────────────────────────────────────────────────────────────────

export interface FundingAccount {
  id: number;
  accountKey: string;
  accountLabel: string;
  amountCents: number;
  amountText: string | null;
  notes: string | null;
}

export interface FundingAccountsResponse {
  accounts: FundingAccount[];
  totalCents: number;
}

export function getFundingAccounts(signal?: AbortSignal): Promise<FundingAccountsResponse> {
  return request<FundingAccountsResponse>("/api/budget-tracker/financial-accounts", { signal });
}

export interface FundingAccountUpdate {
  accountKey: string;
  accountLabel?: string;
  amountCents: number | string | null;
  notes?: string | null;
}

export function putFundingAccounts(
  accounts: FundingAccountUpdate[],
): Promise<{ success: boolean; updated: number }> {
  return request<{ success: boolean; updated: number }>("/api/budget-tracker/financial-accounts", {
    method: "PUT",
    body: JSON.stringify({ accounts }),
  });
}

// ────────────────────────────────────────────────────────────────────────
// 7. Reallocation ledger + contingency
// ────────────────────────────────────────────────────────────────────────

export interface ReallocationParty {
  // Both sides use one enum. Contingency is an ordinary funding account
  // (accountKey "contingency_reserve"), not a distinct kind.
  kind: "account" | "room" | "external";
  id: number | null;
  label: string;
}

export interface ReallocationEntry {
  id: number;
  occurredAt: number;
  eventTitle: string;
  eventDetail: string | null;
  from: ReallocationParty | null;
  to: ReallocationParty | null;
  amountCents: number;
  amountText: string | null;
  referenceType: string | null;
  referenceId: string | null;
}

export interface ReallocationLedgerPage {
  entries: ReallocationEntry[];
  nextCursor: string | null;
}

export function getReallocations(
  params?: { limit?: number; cursor?: string },
  signal?: AbortSignal,
): Promise<ReallocationLedgerPage> {
  return request<ReallocationLedgerPage>(
    `/api/budget/reallocations${qs({ limit: params?.limit, cursor: params?.cursor })}`,
    { signal },
  );
}

export type ReallocationCreateRequest = Omit<ReallocationEntry, "id">;

export function createReallocation(body: ReallocationCreateRequest): Promise<ReallocationEntry> {
  return request<ReallocationEntry>("/api/budget/reallocations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface ContingencyStatus {
  openingReserveCents: number;
  currentBalanceCents: number;
  pctRemaining: number;
}

export function getContingency(signal?: AbortSignal): Promise<ContingencyStatus> {
  return request<ContingencyStatus>("/api/budget/contingency", { signal });
}

// ────────────────────────────────────────────────────────────────────────
// 8. GET /api/budget/compliance
// ────────────────────────────────────────────────────────────────────────

export interface ComplianceGate {
  gateType: "down_payment_cap" | "signed_change_order" | "lien_release" | "license_active";
  label: string;
  state: "pass" | "fail" | "warn" | "na";
  evidence: RichText;
  expiresAt: number | null;
}

export interface ComplianceContract {
  contractId: number;
  vendorLabel: string;
  tradeLabel: string | null;
  cslbLicenseNumber: string | null;
  contractValueCents: number | null;
  overallState: "ok" | "block" | "warn";
  gates: ComplianceGate[];
}

export interface ComplianceResponse {
  contracts: ComplianceContract[];
  /** Keyset cursor; null when this is the last page. */
  nextCursor: string | null;
}

export interface GetComplianceParams {
  limit?: number;
  cursor?: string;
}

export function getCompliance(
  params: GetComplianceParams = {},
  signal?: AbortSignal,
): Promise<ComplianceResponse> {
  return request<ComplianceResponse>(`/api/budget/compliance${qs(params)}`, { signal });
}

// ────────────────────────────────────────────────────────────────────────
// 9. POST /api/budget-tracker/expenses
// ────────────────────────────────────────────────────────────────────────

/**
 * Mirrors what `POST /api/budget-tracker/expenses` actually accepts, which is
 * narrower than the design implies:
 *
 * - `category` is REQUIRED by the route (it 400s without one) and defaults to
 *   the column's own `"general"`.
 * - The vendor is free text. `budget_expense_entries` has no vendor foreign
 *   key, only a `vendor_name` column, so there is no `vendorId` to send —
 *   see docs/decisions/2026-09-03-budget-command-center-schema-gaps.md.
 * - There is no `phase_id` column on an expense at all, so no phase is sent.
 * - `dateIncurred` is Unix SECONDS, matching the D1 timestamp columns.
 */
export interface ExpenseCreateRequest {
  item: string;
  category: string;
  amountText: string;
  amountCents: number;
  vendorName?: string;
  roomId?: number;
  dateIncurred: number;
  notes?: string;
}

export interface ExpenseCreateResponse {
  expense: { id: number; trackId: string } & Record<string, unknown>;
}

export function createExpense(body: ExpenseCreateRequest): Promise<ExpenseCreateResponse> {
  return request<ExpenseCreateResponse>("/api/budget-tracker/expenses", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ────────────────────────────────────────────────────────────────────────
// React hook
// ────────────────────────────────────────────────────────────────────────

export interface UseBudgetQueryResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Fetches `fn(signal)` on mount and whenever `deps` changes. Creates a fresh
 * AbortController per run and aborts the in-flight request on unmount or dep
 * change — so switching tabs cancels whatever the previous tab was loading.
 */
export function useBudgetQuery<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): UseBudgetQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    fn(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, isLoading, refetch };
}

// ────────────────────────────────────────────────────────────────────────
// Money formatting
// ────────────────────────────────────────────────────────────────────────

// Built on first use, not at module scope. This module is pulled into the SSR
// worker bundle, and constructing an Intl.NumberFormat is real work at startup
// — this Worker sits close to Cloudflare's startup-CPU ceiling (error 10021),
// so eager top-level construction is a cost paid on every cold start whether or
// not a page formats any money.
let exactCurrencyFormatter: Intl.NumberFormat | undefined;
let wholeDollarCurrencyFormatter: Intl.NumberFormat | undefined;

function exactFormatter(): Intl.NumberFormat {
  exactCurrencyFormatter ??= new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });
  return exactCurrencyFormatter;
}

function wholeDollarFormatter(): Intl.NumberFormat {
  wholeDollarCurrencyFormatter ??= new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return wholeDollarCurrencyFormatter;
}

/**
 * The one place every tab formats money. Integer cents in, exact currency
 * string out (e.g. "$1,234.56") — the stored data is exact cents, so the
 * display must be too, or rows stop summing to their subtotal.
 *
 * Pass `{ whole: true }` only for a large KPI figure that is deliberately
 * shown rounded to the dollar; never for a value a user will sum by eye.
 */
/**
 * Format integer cents as currency.
 *
 * Decimals are shown only when the amount actually has them. Whole-dollar
 * figures render as "$248,500" — matching the design comps, where every figure
 * is a round dollar — while $1,299.40 keeps its cents.
 *
 * The alternative, rounding everything to whole dollars, is what a review
 * caught: three rows of $0.50 render as "$1, $1, $1" under a subtotal of "$2",
 * so a column visibly fails to add up. The stored data is exact integer cents;
 * the display must not be the thing that loses money.
 *
 * `{ whole: true }` forces rounding, for a headline figure where the reader is
 * scanning magnitude rather than reconciling a column. Use it deliberately.
 */
export function formatCents(cents: number, opts?: { whole?: boolean }): string {
  if (opts?.whole) return wholeDollarFormatter().format(cents / 100);
  const formatter = cents % 100 === 0 ? wholeDollarFormatter() : exactFormatter();
  return formatter.format(cents / 100);
}
