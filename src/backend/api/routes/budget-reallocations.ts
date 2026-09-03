/**
 * @fileoverview Budget savings-and-reallocation ledger — read + write API.
 *
 * Mounted at `/api/budget` in `src/backend/api/index.ts` (this file is NOT
 * registered there yet — a separate integration pass wires every new router
 * in one edit). Behind the same `requireAccessAuth` gate already applied to
 * `/api/budget/*`.
 *
 *   GET  /reallocations   Keyset-paginated ledger, newest first.
 *   POST /reallocations   Record one transfer. Ids in, never labels.
 *   GET  /contingency     Opening reserve + running balance, computed in SQL.
 *
 * Shapes are the contract in `docs/plans/budget-command-center/API-CONTRACT.md`
 * §7. D1 rules (no `db.transaction()`, keyset pagination, SQL aggregation,
 * 100-bound-param cap) are `docs/plans/budget-command-center/D1-DRIZZLE-RULES.md`.
 *
 * --- The from/to "kind" derivation (read this before touching the file) ---
 * CORRECTED 2026-09-03 (was inflow-only null/null special-casing; the
 * approved design's first ledger row is "Contingency → Primary Bath", which
 * that model could not represent — see `docs/plans/budget-command-center/
 * screens/4-funding-savings.html`). Contingency is now a normal row in
 * `budget_funding_accounts` (accountKey = "contingency_reserve"), referenced
 * by `fromAccountId`/`toAccountId` exactly like any other funding account —
 * "cash_amount", "financed_amount", etc. No special case anywhere in the
 * write path or the join logic; it is just an account id.
 *
 * `budget_reallocation_ledger` still has four nullable FK columns
 * (fromAccountId, fromRoomId, toAccountId, toRoomId) and no dedicated
 * "external" column. Both sides use the SAME derivation, symmetrically: both
 * columns on that side null -> kind "external" — money crossing the
 * boundary of the tracked budget (an owner top-up/insurance check coming
 * in on `from`; money sent back out and no longer tracked, on `to`). This
 * is a deliberate widening of the API contract's `to.kind` enum from
 * `"account" | "room" | "contingency"` to `"account" | "room" | "external"`
 * (dropping the now-redundant "contingency" value, since contingency is
 * reachable via `kind: "account"` like every other pool) — flag this to
 * downstream contract consumers.
 *
 * `GET /contingency` resolves the contingency account's row once
 * (id + its `amountCents`, which is the opening/allotted reserve — a value
 * set via the `set_funding_account` MCP tool, not mutated by this ledger)
 * and reuses that id for one combined SQL SUM computing inflow (`to_account_
 * id = id`) and outflow (`from_account_id = id`) together. If the row does
 * not exist yet (reserve never allotted), the endpoint returns all zeros —
 * NOT an error, and NOT to be read as "reserve fully spent"; see the
 * handler's comment.
 */
import { budgetFundingAccounts, budgetReallocationLedger, rooms } from "@backend/db";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";

export const budgetReallocationsRouter = new OpenAPIHono<{ Bindings: Env }>();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** The one funding-account row that represents the contingency reserve. */
const CONTINGENCY_ACCOUNT_KEY = "contingency_reserve";

// ─── Shared shapes ─────────────────────────────────────────────────────────

const errorSchema = z.object({ error: z.string() });

/**
 * `from` and `to` share one shape now that contingency is a plain account:
 * "account" | "room" | "external" on both sides (see file header — this
 * widens `to.kind` from the original contract's "contingency" value).
 */
const refSchema = z.object({
  kind: z.enum(["account", "room", "external"]),
  id: z.number().int().nullable(),
  label: z.string(),
});

const reallocationEntrySchema = z.object({
  id: z.number().int(),
  occurredAt: z.number().int(),
  eventTitle: z.string(),
  eventDetail: z.string().nullable(),
  from: refSchema.nullable(),
  to: refSchema.nullable(),
  amountCents: z.number().int(),
  amountText: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
});

const reallocationsListSchema = z.object({
  entries: z.array(reallocationEntrySchema),
  nextCursor: z.string().nullable(),
});

const contingencySchema = z.object({
  openingReserveCents: z.number().int(),
  currentBalanceCents: z.number().int(),
  pctRemaining: z.number(),
});

// ─── Row -> DTO helpers ────────────────────────────────────────────────────

type LedgerRow = {
  id: number;
  occurredAt: Date;
  eventTitle: string;
  eventDetail: string | null;
  amountCents: number;
  amountText: string | null;
  referenceType: string | null;
  referenceId: string | null;
  fromAccountId: number | null;
  fromAccountLabel: string | null;
  fromRoomId: number | null;
  fromRoomName: string | null;
  toAccountId: number | null;
  toAccountLabel: string | null;
  toRoomId: number | null;
  toRoomName: string | null;
};

/** Same derivation for both `from` and `to`: account id set -> "account",
 * room id set -> "room", both null -> "external" (a boundary event; see
 * file header). `externalLabel` lets the two directions read naturally
 * ("External funds" coming in vs. "External" going out). */
function resolveRef(
  accountId: number | null,
  accountLabel: string | null,
  roomId: number | null,
  roomName: string | null,
  externalLabel: string,
): z.infer<typeof refSchema> {
  if (accountId != null) {
    return { kind: "account", id: accountId, label: accountLabel ?? `Account #${accountId}` };
  }
  if (roomId != null) {
    return { kind: "room", id: roomId, label: roomName ?? `Room #${roomId}` };
  }
  return { kind: "external", id: null, label: externalLabel };
}

function toEntryDto(row: LedgerRow): z.infer<typeof reallocationEntrySchema> {
  return {
    id: row.id,
    occurredAt: Math.floor(row.occurredAt.getTime() / 1000),
    eventTitle: row.eventTitle,
    eventDetail: row.eventDetail,
    from: resolveRef(
      row.fromAccountId,
      row.fromAccountLabel,
      row.fromRoomId,
      row.fromRoomName,
      "External funds",
    ),
    to: resolveRef(row.toAccountId, row.toAccountLabel, row.toRoomId, row.toRoomName, "External"),
    amountCents: row.amountCents,
    amountText: row.amountText,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
  };
}

/** Keyset cursor: `"<occurredAtUnixSeconds>_<id>"`. Opaque enough for a URL param. */
function decodeCursor(raw: string): { occurredAt: Date; id: number } | null {
  const match = /^(\d+)_(\d+)$/.exec(raw);
  if (!match) return null;
  return { occurredAt: new Date(Number(match[1]) * 1000), id: Number(match[2]) };
}

function encodeCursor(occurredAt: Date, id: number): string {
  return `${Math.floor(occurredAt.getTime() / 1000)}_${id}`;
}

// ─── GET /reallocations ─────────────────────────────────────────────────────

const listQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

budgetReallocationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/reallocations",
    operationId: "listBudgetReallocations",
    tags: ["Budget"],
    summary: "Savings-and-reallocation ledger, newest first (keyset paginated)",
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: "Ledger page",
        content: { "application/json": { schema: reallocationsListSchema } },
      },
      400: {
        description: "Bad limit/cursor",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { limit: limitRaw, cursor: cursorRaw } = c.req.valid("query");

    const limit = limitRaw === undefined ? DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return c.json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, 400);
    }

    let cursor: { occurredAt: Date; id: number } | null = null;
    if (cursorRaw !== undefined) {
      cursor = decodeCursor(cursorRaw);
      if (!cursor) return c.json({ error: "cursor is malformed" }, 400);
    }

    const db = drizzle(c.env.DB);
    // No special-casing for the contingency account here — it is a normal
    // budget_funding_accounts row, so the generic fromAccount/toAccount
    // joins below pick up its label like any other account.
    const fromAccount = alias(budgetFundingAccounts, "realloc_from_account");
    const toAccount = alias(budgetFundingAccounts, "realloc_to_account");
    const fromRoom = alias(rooms, "realloc_from_room");
    const toRoom = alias(rooms, "realloc_to_room");

    const keysetWhere = cursor
      ? or(
          lt(budgetReallocationLedger.occurredAt, cursor.occurredAt),
          and(
            eq(budgetReallocationLedger.occurredAt, cursor.occurredAt),
            lt(budgetReallocationLedger.id, cursor.id),
          ),
        )
      : undefined;

    const rows = await db
      .select({
        id: budgetReallocationLedger.id,
        occurredAt: budgetReallocationLedger.occurredAt,
        eventTitle: budgetReallocationLedger.eventTitle,
        eventDetail: budgetReallocationLedger.eventDetail,
        amountCents: budgetReallocationLedger.amountCents,
        amountText: budgetReallocationLedger.amountText,
        referenceType: budgetReallocationLedger.referenceType,
        referenceId: budgetReallocationLedger.referenceId,
        fromAccountId: budgetReallocationLedger.fromAccountId,
        fromAccountLabel: fromAccount.accountLabel,
        fromRoomId: budgetReallocationLedger.fromRoomId,
        fromRoomName: fromRoom.roomName,
        toAccountId: budgetReallocationLedger.toAccountId,
        toAccountLabel: toAccount.accountLabel,
        toRoomId: budgetReallocationLedger.toRoomId,
        toRoomName: toRoom.roomName,
      })
      .from(budgetReallocationLedger)
      .leftJoin(fromAccount, eq(budgetReallocationLedger.fromAccountId, fromAccount.id))
      .leftJoin(toAccount, eq(budgetReallocationLedger.toAccountId, toAccount.id))
      .leftJoin(fromRoom, eq(budgetReallocationLedger.fromRoomId, fromRoom.id))
      .leftJoin(toRoom, eq(budgetReallocationLedger.toRoomId, toRoom.id))
      .where(keysetWhere)
      .orderBy(desc(budgetReallocationLedger.occurredAt), desc(budgetReallocationLedger.id))
      .limit(limit + 1);

    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasNext && last ? encodeCursor(last.occurredAt, last.id) : null;

    return c.json({ entries: page.map(toEntryDto), nextCursor }, 200);
  },
);

// ─── POST /reallocations ────────────────────────────────────────────────────

/** Same "account" | "room" | "external" shape as the response `refSchema` —
 * see file header. Contingency is submitted as `{ kind: "account", id:
 * <contingency_reserve's account id> }`, no special case. */
const refInputSchema = z.object({
  kind: z.enum(["account", "room", "external"]),
  id: z.number().int().positive().nullable(),
});

const createReallocationSchema = z.object({
  occurredAt: z.number().int(),
  eventTitle: z.string().min(1),
  eventDetail: z.string().nullable().optional(),
  from: refInputSchema,
  to: refInputSchema,
  amountCents: z.number().int().positive(),
  amountText: z.string().nullable().optional(),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
});

type ResolvedRef = {
  accountId: number | null;
  accountLabel: string | null;
  roomId: number | null;
  roomName: string | null;
};

/**
 * Validates + resolves one side of the transfer. `side` is only used to
 * name the bad field in a 400. Identical logic for `from` and `to` now that
 * both use the same "account" | "room" | "external" vocabulary (contingency
 * included — it's just an account id) — one helper instead of the two
 * near-duplicate blocks this file had before the contingency-account fix.
 */
async function resolveRefInput(
  db: ReturnType<typeof drizzle>,
  ref: z.infer<typeof refInputSchema>,
  side: "from" | "to",
): Promise<ResolvedRef | { error: string }> {
  if (ref.kind === "external") {
    if (ref.id !== null)
      return { error: `${side}.id must be null when ${side}.kind is 'external'` };
    return { accountId: null, accountLabel: null, roomId: null, roomName: null };
  }
  if (ref.id === null)
    return { error: `${side}.id is required when ${side}.kind is '${ref.kind}'` };

  if (ref.kind === "account") {
    const [account] = await db
      .select({ id: budgetFundingAccounts.id, label: budgetFundingAccounts.accountLabel })
      .from(budgetFundingAccounts)
      .where(eq(budgetFundingAccounts.id, ref.id))
      .limit(1);
    if (!account)
      return { error: `${side}.id ${ref.id} does not reference an existing funding account` };
    return { accountId: account.id, accountLabel: account.label, roomId: null, roomName: null };
  }

  const [room] = await db
    .select({ id: rooms.id, name: rooms.roomName })
    .from(rooms)
    .where(and(eq(rooms.id, ref.id), eq(rooms.isActive, true)))
    .limit(1);
  if (!room) return { error: `${side}.id ${ref.id} does not reference an existing active room` };
  return { accountId: null, accountLabel: null, roomId: room.id, roomName: room.name };
}

budgetReallocationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/reallocations",
    operationId: "createBudgetReallocation",
    tags: ["Budget"],
    summary: "Record one reallocation/savings ledger entry",
    description:
      "Accepts ids, never labels. A referenced account or room that does not exist 400s naming the bad id — nothing is inserted with a dangling reference. The contingency reserve is just a funding account (kind: 'account'); there is no special case for it.",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: createReallocationSchema } },
      },
    },
    responses: {
      201: {
        description: "Created entry",
        content: { "application/json": { schema: reallocationEntrySchema } },
      },
      400: {
        description: "Bad reference",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const db = drizzle(c.env.DB);

    // ponytail: two independent single-row PK lookups on a low-traffic write
    // path — not the N+1/screen-load case D1-DRIZZLE-RULES §2 targets, so
    // plain sequential awaits rather than a batch() shaped for a fixed
    // 2-query set. Each lookup also grabs the display label in the same
    // round trip, so the response DTO below needs no follow-up read.
    const fromResolved = await resolveRefInput(db, body.from, "from");
    if ("error" in fromResolved) return c.json({ error: fromResolved.error }, 400);
    const toResolved = await resolveRefInput(db, body.to, "to");
    if ("error" in toResolved) return c.json({ error: toResolved.error }, 400);

    const [inserted] = await db
      .insert(budgetReallocationLedger)
      .values({
        occurredAt: new Date(body.occurredAt * 1000),
        eventTitle: body.eventTitle,
        eventDetail: body.eventDetail ?? null,
        fromAccountId: fromResolved.accountId,
        fromRoomId: fromResolved.roomId,
        toAccountId: toResolved.accountId,
        toRoomId: toResolved.roomId,
        amountCents: body.amountCents,
        amountText: body.amountText ?? null,
        referenceType: body.referenceType ?? null,
        referenceId: body.referenceId ?? null,
      })
      .returning();

    if (!inserted) {
      return c.json({ error: "Insert failed" }, 400);
    }

    return c.json(
      toEntryDto({
        id: inserted.id,
        occurredAt: inserted.occurredAt,
        eventTitle: inserted.eventTitle,
        eventDetail: inserted.eventDetail,
        amountCents: inserted.amountCents,
        amountText: inserted.amountText,
        referenceType: inserted.referenceType,
        referenceId: inserted.referenceId,
        fromAccountId: fromResolved.accountId,
        fromAccountLabel: fromResolved.accountLabel,
        fromRoomId: fromResolved.roomId,
        fromRoomName: fromResolved.roomName,
        toAccountId: toResolved.accountId,
        toAccountLabel: toResolved.accountLabel,
        toRoomId: toResolved.roomId,
        toRoomName: toResolved.roomName,
      }),
      201,
    );
  },
);

// ─── GET /contingency ────────────────────────────────────────────────────────

budgetReallocationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/contingency",
    operationId: "getBudgetContingency",
    tags: ["Budget"],
    summary: "Contingency reserve opening balance + running balance",
    description:
      "openingReserveCents is budget_funding_accounts.amountCents for the 'contingency_reserve' account — the allotted reserve, not mutated by the ledger. currentBalanceCents = opening + inflows (ledger rows where to_account_id = that account) − outflows (rows where from_account_id = that account), both summed in one SQL statement. If the 'contingency_reserve' account row does not exist yet, every field is 0 — that means no reserve has been allotted, NOT that it has been fully spent.",
    responses: {
      200: {
        description: "Contingency snapshot",
        content: { "application/json": { schema: contingencySchema } },
      },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);

    // Resolve the contingency account's id + opening amount once; the SUM
    // query below depends on that id, so it cannot be pre-batched with this
    // lookup (db.batch() issues all statements before any result is known).
    const [reserveAccount] = await db
      .select({ id: budgetFundingAccounts.id, amountCents: budgetFundingAccounts.amountCents })
      .from(budgetFundingAccounts)
      .where(eq(budgetFundingAccounts.accountKey, CONTINGENCY_ACCOUNT_KEY))
      .limit(1);

    if (!reserveAccount) {
      // No reserve has ever been allotted (set_funding_account never called
      // for this key) — zeros, not an error, and not "fully spent".
      return c.json({ openingReserveCents: 0, currentBalanceCents: 0, pctRemaining: 0 });
    }

    const contingencyAccountId = reserveAccount.id;
    const [flowRow] = await db
      .select({
        inflowCents: sql<number>`coalesce(sum(case when ${budgetReallocationLedger.toAccountId} = ${contingencyAccountId} then ${budgetReallocationLedger.amountCents} else 0 end), 0)`,
        outflowCents: sql<number>`coalesce(sum(case when ${budgetReallocationLedger.fromAccountId} = ${contingencyAccountId} then ${budgetReallocationLedger.amountCents} else 0 end), 0)`,
      })
      .from(budgetReallocationLedger)
      .where(
        or(
          eq(budgetReallocationLedger.toAccountId, contingencyAccountId),
          eq(budgetReallocationLedger.fromAccountId, contingencyAccountId),
        ),
      );

    const openingReserveCents = reserveAccount.amountCents;
    const inflowCents = flowRow?.inflowCents ?? 0;
    const outflowCents = flowRow?.outflowCents ?? 0;
    const currentBalanceCents = openingReserveCents + inflowCents - outflowCents;
    const pctRemaining = openingReserveCents > 0 ? currentBalanceCents / openingReserveCents : 0;

    return c.json({ openingReserveCents, currentBalanceCents, pctRemaining });
  },
);
