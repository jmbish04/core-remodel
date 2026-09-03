# Budget Command Center — API contract

The single coordination artifact for this epic. Backend agents implement these
shapes; frontend agents code against them and nothing else.

**Rule zero: no SQL in frontend code, ever.** A React island calls the typed
client in `src/frontend/lib/budget-api.ts`, which calls these routes. A `.tsx`
or `.astro` file that contains SQL, or that talks to D1, is a defect.

Conventions for every route below:
- Mounted under `/api/budget` unless the path says otherwise. Auth is the
  existing `requireAccessAuth` cookie gate already applied to `/api/budget/*`.
- Hono + `@hono/zod-openapi`, **hand-written Zod v4 schemas**. Never import
  drizzle-zod — it type-checks but breaks `pnpm run build`.
- Money crosses the wire as **integer cents** in a `*Cents` field. Any field the
  user typed also carries its verbatim `*Text`.
- Rich text crosses as a `{ markdown, html }` pair.
- Timestamps are Unix **seconds** (matching the D1 `unixepoch()` columns).
- Ids are numbers; a display name is never sent in place of an id, and a select
  renders the label while submitting the id.
- Every list endpoint paginates in SQL. None returns an unbounded table.

---

## 1. `GET /api/budget/workbench-summary`

Fills the entire shell header in **one D1 round trip** (`db.batch`).

```ts
{
  project: { name: string; addressLine: string };
  kpis: {
    totalBudgetCents: number;        // SUM(budget_funding_accounts.amount_cents)
    fundingAccountCount: number;
    spentToDateCents: number;        // SUM(budget_expense_entries.amount_cents)
    spentPctOfBudget: number;        // 0..1
    remainingCents: number;
    runwayMonths: number | null;     // remaining / trailing monthly burn; null if burn is 0
    varianceVsEstimateCents: number; // signed; positive = over
    varianceDirection: "over" | "under" | "even";
  };
  tabCounts: {
    inbox: number;        // open decisions
    estimates: number;    // unmapped estimate lines
    rooms: number;
    savings: number;
    compliance: number;   // failing gates
  };
  decisionsWaiting: number; // the header pill
}
```

## 2. `GET /api/budget/grid`

Query: `?from=YYYY-MM&to=YYYY-MM&view=estimate|actuals|variance`

Per `D1-DRIZZLE-RULES.md` §6, the monthly rollup is a **flat grouped query in
SQL, pivoted to columns in the Worker**.

```ts
{
  months: Array<{ key: string; label: string }>;   // "2026-02" / "Feb"
  phases: Array<{
    phaseId: number;
    name: string;
    rows: Array<{
      lineItemId: number;
      trackId: string;
      title: string;
      vendorId: number | null;
      vendorLabel: string | null;   // from a JOIN, never a stored column
      phaseId: number;
      note: string | null;          // "CO-12 · joist sistering"
      cells: Record<string, {       // keyed by month key
        plannedCents: number | null;
        actualCents: number | null;
        isEditable: boolean;        // dashed cell in the design
      }>;
      totalCents: number;
      varianceCents: number;
    }>;
    subtotalCents: number;
  }>;
  footer: { availableBudgetCents: number; netBurnCents: number };
}
```

`PATCH /api/budget/plan-schedule` writes one planned cell:
`{ lineItemId: number; month: string; plannedCents: number | null }`.

## 3. `GET /api/budget/inbox`

Ranked by financial exposure **in SQL** (`ORDER BY exposure DESC LIMIT n`), never
sorted in JS.

```ts
{
  items: Array<{
    id: string;
    severity: "block" | "warn" | "info";
    title: string;
    detail: string | null;
    contextKind: "vendor" | "room" | "contract" | "estimate";
    contextId: number | null;
    contextLabel: string | null;   // JOINed
    exposureCents: number;
    actionKind: "review_contract" | "request_change_order" | "reconcile" | "mark_resolved";
    actionHref: string;
  }>;
  total: number;
}
```

## 4. `GET /api/budget/rooms-finance`

One grouped query with LEFT JOINs. No per-room follow-up query.

```ts
{
  rooms: Array<{
    roomId: number;
    name: string;
    committedCents: number;
    spentCents: number;
    remainingCents: number;
    openMaterialsCount: number;
    risk: "ok" | "watch" | "at_risk";
  }>;
  totals: { committedCents: number; spentCents: number; remainingCents: number; openMaterialsCount: number };
  // `totals` minus the sum of the rows. The totals are project-wide on purpose
  // — an item mapped to several rooms would double-count if summed across rows,
  // and money with no room at all would vanish — so the Total row does not
  // always equal the column above it. The UI renders this delta by name instead
  // of leaving a reader to add the column and find a different number.
  unassigned: { committedCents: number; spentCents: number; remainingCents: number; openMaterialsCount: number };
}
```

## 5. Estimate reconciliation

`GET /api/budget/reconciliation-queue?limit=&cursor=`

```ts
{
  items: Array<{
    lineItemId: number;
    description: string;
    estimateCompanyId: number | null;
    estimateCompanyLabel: string | null;  // JOINed
    estimateLineNumber: string | null;    // "estimate line 14"
    lineTotalCents: number | null;
    mappingStatus: string;
    candidates: Array<{
      roomId: number;
      roomName: string;                   // JOINed
      rank: number;
      verdict: "likely" | "possible" | "eliminated";
      reasoning: { markdown: string | null; html: string | null };
      confidence: number | null;
    }>;
  }>;
  nextCursor: string | null;
}
```

`POST /api/budget/reconciliation/:lineItemId/confirm` → `{ roomId: number }`
`POST /api/budget/reconciliation/:lineItemId/reject` → `{ reason?: string }`

Confirm sets `estimate_line_items.room_id` and `mapping_status` in a
`db.batch`. **Never `db.transaction()`** — it is dead on D1. Nothing is written
without an explicit human confirm.

## 6. Funding accounts

`GET /api/budget-tracker/financial-accounts`

```ts
{
  accounts: Array<{ id: number; accountKey: string; accountLabel: string; amountCents: number; amountText: string | null; notes: string | null }>;
  totalCents: number;
}
```

`PUT /api/budget-tracker/financial-accounts` — existing route. **Fix its
per-account `await db.insert(...)` loop** into a single `db.batch([...])`,
chunked at 20 rows (D1 caps a statement at 100 bound parameters).

## 7. Reallocation ledger + contingency

`GET /api/budget/reallocations?limit=&cursor=` — keyset paginated in SQL.

```ts
{
  entries: Array<{
    id: number;
    occurredAt: number;
    eventTitle: string;
    eventDetail: string | null;
    // One enum for both sides. Contingency is an ordinary funding account
    // (accountKey "contingency_reserve"), so money can flow both into and out
    // of it; both ids null means external.
    from: { kind: "account" | "room" | "external"; id: number | null; label: string } | null;
    to:   { kind: "account" | "room" | "external"; id: number | null; label: string } | null;
    amountCents: number;
    amountText: string | null;
    referenceType: string | null;
    referenceId: string | null;   // "CO-14"
  }>;
  nextCursor: string | null;
}
```

`POST /api/budget/reallocations` — same shape minus `id`, ids not labels.

`GET /api/budget/contingency`

```ts
{ openingReserveCents: number; currentBalanceCents: number; pctRemaining: number }
```

## 8. `GET /api/budget/compliance?limit=&cursor=`

Contracts joined to their gates in one batch; the block/ok rollup computed in
SQL. Keyset-paginated on `contracts.id`, and the gate query is scoped to the
page's contract ids (chunked at 90 for D1's bound-parameter cap) rather than
reading the whole table.

`overallState` never reports `ok` for a contract whose gates are all `na`. An
absence of evidence is not a pass on a compliance surface, so unevaluated
gates carry the same weight as a warning.

```ts
{
  contracts: Array<{
    contractId: number;
    vendorLabel: string;          // JOINed
    tradeLabel: string | null;    // "General contractor", "C-10 electrical"
    cslbLicenseNumber: string | null;
    contractValueCents: number | null;
    overallState: "ok" | "block" | "warn";
    gates: Array<{
      gateType: "down_payment_cap" | "signed_change_order" | "lien_release" | "license_active";
      label: string;
      state: "pass" | "fail" | "warn" | "na";
      evidence: { markdown: string | null; html: string | null };
      expiresAt: number | null;
    }>;
  }>;
  nextCursor: string | null;
}
```

The California CSLB down-payment cap — the **lesser of $1,000 or 10% of the
contract price** — is evaluated server-side and cited in a code comment. The
frontend renders the verdict; it never re-derives the rule.

## 9. `POST /api/budget-tracker/expenses`

Existing route. The Log-expense dialog submits:

```ts
{
  item: string;
  amountText: string;     // verbatim, from <CurrencyInput>
  amountCents: number;
  vendorId?: number;
  phaseId?: number;
  roomId?: number;
  dateIncurred: number;
  notes?: string;
}
```

Extend the route only if a field is genuinely missing — read the schema before
adding anything, and never pass a value into a column that does not exist.

---

## Frontend client

`src/frontend/lib/budget-api.ts` exports one typed function per route above plus
the request/response interfaces, and a `useBudgetQuery` hook that cancels
in-flight requests on tab switch (`AbortController`). Same-origin,
`credentials: "include"`. Every island imports from here; no island builds a URL
by hand.

## File ownership (so parallel agents do not collide)

| Agent | Owns |
| --- | --- |
| S1 schema | `src/backend/db/schema/**` + the generated migration |
| A1 | `routes/budget-workbench.ts` (summary) |
| A2 | `routes/budget-reconciliation.ts` (new) |
| A3 | `routes/budget-reallocations.ts` (new) |
| A4 | `routes/budget-compliance.ts` (new) |
| A5 | `routes/budget-tracker.ts` (accounts only) |
| A6 | `routes/budget-grid.ts`, `budget-grid-math.ts` |
| A7/A8 | `routes/budget-workbench.ts` (inbox, rooms-finance) |
| B0 | `src/frontend/lib/budget-api.ts` |
| B1 | `components/budget/BudgetWorkbench.tsx`, `pages/admin/budget/index.astro` |
| F1–F7 | one file each under `src/frontend/components/budget/` |

New routers are registered in `src/backend/api/index.ts`. **Only one agent edits
that file at a time** — the integration pass wires them all in one edit.
