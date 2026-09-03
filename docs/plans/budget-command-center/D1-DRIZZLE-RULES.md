# D1 + Drizzle rules for the Budget Command Center

**Every agent working this epic follows this file.** Researched against the live
Cloudflare D1 and Drizzle docs (Antigravity/Gemini, 2026-09-03). Claims carry
their source URL; anything unverified is marked as such.

**Rule zero: there is no SQL in frontend code, ever.** A React island fetches
`/api/...`. A Hono route runs the Drizzle query. No exceptions, no "just this
once", no raw SQL string built in a `.tsx`.

---

## 0. D1 platform limits (source: https://developers.cloudflare.com/d1/platform/limits/)

| Constraint | Limit |
| --- | --- |
| Bound parameters per statement | **100** |
| SQL statement length | 100,000 bytes |
| Database size | 10 GB paid / 500 MB free |
| Row / string / BLOB size | 2,000,000 bytes |
| Columns per table | 100 |
| Query duration | 30 s |
| Queries per Worker invocation | 1,000 paid / 50 free |
| Simultaneous open D1 connections per Worker | 6 |

`https://orm.drizzle.team/docs/get-started-d1` 404s — the current pages are
`https://orm.drizzle.team/docs/connect-cloudflare-d1` and
`https://orm.drizzle.team/docs/get-started/d1-new`.

---

## 1. Row reads are the billed and limited unit

Source: https://developers.cloudflare.com/d1/best-practices/use-indexes/

- D1 bills **rows scanned**, not rows returned. `SELECT * FROM items WHERE
  status = 'pending'` over 500k unindexed rows costs 500k row reads even when it
  returns one row.
- Every D1 database is one Durable Object processing queries sequentially
  (https://developers.cloudflare.com/d1/platform/limits/). Full scans starve it
  and surface as `D1 DB is overloaded` / `D1 DB exceeded its CPU time limit`
  (https://developers.cloudflare.com/d1/observability/debug-d1/).
- Every column combination used in `WHERE`, `JOIN ... ON`, and `ORDER BY` needs a
  composite index, so the plan is `SEARCH TABLE ... USING INDEX`, not `SCAN TABLE`.

Check the cost of a query you are unsure about:

```ts
const raw = await env.DB.prepare(sqlText).bind(...args).all();
console.log(`rows_read=${raw.meta.rows_read} duration=${raw.meta.duration}ms`);
```

Declare the covering index in the Drizzle schema, not by hand in a migration:

```ts
export const budgetTrackerItems = sqliteTable(
  "budget_tracker_items",
  { /* … */ },
  (t) => ({
    phaseIdx: index("idx_bti_phase_amount").on(t.phaseId, t.amountCents),
    roomStatusIdx: index("idx_bti_room_status_date").on(t.roomId, t.status, t.incurredAt),
  }),
);
```

## 2. One round trip per screen

- Aggregate in SQL (`SUM`, `COUNT`, `CASE WHEN`). Never pull rows to total them in JS.
- Join or `GROUP BY`. Never `for (const room of rooms) await db.select(...)`.
- Independent SELECTs for one screen go in a single `db.batch([...])` — one D1
  round trip (https://developers.cloudflare.com/d1/worker-api/d1-database/).

```ts
const [kpiRows, phaseRows, recent] = await db.batch([kpiQuery, phaseQuery, recentQuery]);
```

## 3. Never paginate in JavaScript

`db.select()` then `.slice()` is forbidden. `LIMIT`/`OFFSET`, or keyset
pagination on the sort key, in SQL. Fetch `pageSize + 1` to know whether a next
page exists.

## 4. The 100 bound-parameter cap

Exceeding it throws `D1_ERROR: too many SQL variables at offset <n>:
SQLITE_ERROR` (https://developers.cloudflare.com/d1/observability/debug-d1/).
Two shapes hit it: `inArray(col, list)` with a long list, and a multi-row insert
where `rows × columns > 100`.

```ts
export function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
```

Chunk at **20 rows** for inserts (repo convention, safe for wide rows) and **90
ids** for `inArray`, then `db.batch()` the chunks.

## 5. No transactions on D1

`db.transaction()` is dead. D1 rejects SQL `BEGIN` with error 7500
(https://developers.cloudflare.com/d1/best-practices/import-export-data/), and
drizzle's D1 driver implements `.transaction()` by issuing raw `begin`/`commit`,
so the callback body never runs. Use `db.batch([...])`, which D1 applies
all-or-nothing.

`batch()` cannot feed a generated id from one statement into the next. Either
generate ids in the Worker (`crypto.randomUUID()`) so parent and child ids are
known up front, or write sequentially with a **compensating delete** on failure —
and say in a comment that the gap exists rather than implying atomicity.

## 6. Aggregation patterns for this dashboard

**Per-phase / per-room estimate-vs-actual, one query:**

```ts
db.select({
  phaseId: items.phaseId,
  phaseName: phases.name,
  estimatedCents: sql<number>`coalesce(sum(case when ${items.status} in ('draft','approved') then ${items.amountCents} else 0 end), 0)`,
  actualCents:    sql<number>`coalesce(sum(case when ${items.status} in ('invoiced','paid')  then ${items.amountCents} else 0 end), 0)`,
})
 .from(items)
 .leftJoin(phases, eq(items.phaseId, phases.id))
 .groupBy(items.phaseId, phases.name);
```

**Monthly time-phased pivot (the grid):** group flat in SQL by
`(line_item, strftime('%Y-%m', …))`, pivot to columns in the Worker. A
conditional-SUM pivot scans exactly the same rows, so it buys no row reads — it
only buys brittle dynamic SQL that breaks when the month range changes. Flat
group + JS reshape returns ~`lines × months` rows, which is small.

**Top-N by variance:** compute the variance expression in SQL, `ORDER BY` it,
`LIMIT n`. Never sort the whole table in JS.

## 7. Money

Integer cents in an `integer("..._cents")` column. Never `real()`. `SUM` over
INTEGER is exact in SQLite. Where the repo convention applies, store **both**
`<field>_text` (verbatim, e.g. `"$1,299.00"`) and `<field>_cents`, and use
`<CurrencyInput>` on the frontend — never a bare `<Input>` for money.

## 8. Anti-patterns and the symptom each produces

| Anti-pattern | Symptom |
| --- | --- |
| `db.transaction()` | 500; D1 error 7500, callback body never ran |
| Unbounded `inArray` / multi-row insert | `too many SQL variables at offset <n>` |
| `select()` then `.slice()` | Row-read blowout, latency, Worker OOM |
| Unindexed `WHERE` / `JOIN ON` | Latency grows with table size, `D1 DB is overloaded` |
| Money as `real()` | Off-by-a-cent reconciliation errors |
| `await` in a loop | >500 ms responses, connection saturation |
| `ORDER BY RANDOM() LIMIT 1` | CPU-time limit exceeded |
| `LIKE '%x%'` | Index unusable, full scan |

## Pre-merge checklist for every route added in this epic

1. Are all `WHERE` / `JOIN` / `ORDER BY` columns indexed in the schema file?
2. Does any statement exceed 100 bound parameters?
3. Is every aggregation done in SQL, not JS?
4. Are the screen's independent SELECTs in one `db.batch()`?
5. Is `db.transaction()` absent?
6. Is every money column `integer(..._cents)`?
7. Is there zero SQL in any `.tsx` / `.astro` file?
