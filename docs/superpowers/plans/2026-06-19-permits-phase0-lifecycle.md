# Permits Phase 0 — Active Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dead/ancient 126-Colby permits from reading as "active": derive a `SUSPECTED_EXPIRED` state at >365 days, exclude suspected-expired/owner-closed permits from contractor anchoring, and let the homeowner permanently close such a permit with a required note — while keeping all permits in the system.

**Architecture:** Add four additive nullable/defaulted columns to `permits_records` (`owner_closed`, `owner_close_note`, `owner_closed_at`, `owner_closed_by`). A pure `derivePermitLifecycle()` helper in `soda.ts` classifies a permit as `active | suspected_expired | closed`. The sync's anchor selection uses it so only `active` property permits anchor contractor monitoring. A `closePermit()` service + `POST /property/:id/close` route set the owner-close fields. The existing `/admin/permits` Scans/Runs tabs gain a lifecycle badge and a close-with-note modal.

**Tech Stack:** Cloudflare Workers, Hono, Drizzle ORM on D1, drizzle-kit, Astro + React (shadcn ui: Dialog/Textarea/Badge/Button), oxlint.

**Verification model:** No unit-test runner in this repo, and DB/Worker code needs prod to exercise. Each task verifies with `pnpm run build` (expect `[build] Complete!`) and `npx oxlint <files>` (expect `0 warnings and 0 errors`). Final task does the gated prod migration + deploy + a manual D1/UI check.

**Deploy/migration note (critical):** The Drizzle journal is broken — never `pnpm run deploy` / `migrate:remote`. The new columns are additive. The migration SQL must be applied **manually to remote D1 BEFORE deploying the new code** (Drizzle `select()` pulls all columns, so deploying code that selects `owner_closed` before the column exists would error). Sequence in Task 6: apply ALTERs → `wrangler deploy`.

---

## File Structure

- **Modify** `src/backend/db/schema/home/permits_records.ts` — add 4 owner-close columns.
- **Generate** `drizzle/NNNN_*.sql` — the additive migration (applied manually).
- **Modify** `src/backend/services/dbi/soda.ts` — add `PermitLifecycle` type + `derivePermitLifecycle()` (+ small `newestPermitDateMs` helper).
- **Modify** `src/backend/services/dbi/permits-sync.ts` — anchor selection uses lifecycle; `hydratePropertyPermitRows` + `getPermitDetail` surface lifecycle/owner fields; add `closePermit()`; extend the `PermitsDashboard`/`PermitDetail` types.
- **Modify** `src/backend/api/routes/admin-permits.ts` — add `POST /property/:permitIdentifier/close`.
- **Modify** `src/frontend/components/PermitsAdminApp.tsx` — `PropertyPermit`/detail types gain lifecycle fields; list shows a `Suspected Expired` badge; detail gains a "Mark Closed" button + note Dialog.

---

## Task 1: Add owner-close columns to `permits_records`

**Files:**
- Modify: `src/backend/db/schema/home/permits_records.ts`
- Generate: `drizzle/` migration

- [ ] **Step 1: Add the columns to the Drizzle schema**

In `src/backend/db/schema/home/permits_records.ts`, insert these four fields immediately after the `isClosed` field (after line 32, before `changeHash`):

```ts
  ownerClosed: integer("owner_closed", { mode: "boolean" })
    .notNull()
    .default(false),
  ownerCloseNote: text("owner_close_note"),
  ownerClosedAt: integer("owner_closed_at", { mode: "timestamp" }),
  ownerClosedBy: text("owner_closed_by"),
```

- [ ] **Step 2: Generate the migration SQL**

Run: `pnpm run db:generate`
Expected: a new `drizzle/NNNN_*.sql` containing `ALTER TABLE \`permits_records\` ADD \`owner_closed\` ...` (4 ADD COLUMN statements). Note the filename; do NOT run `migrate:remote`.

- [ ] **Step 3: Verify build + lint**

Run: `pnpm run build`
Expected: `[build] Complete!`
Run: `npx oxlint src/backend/db/schema/home/permits_records.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 4: Commit**

```bash
git add src/backend/db/schema/home/permits_records.ts drizzle/
git commit -m "feat(permits): add owner-close columns to permits_records

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `derivePermitLifecycle` helper in `soda.ts`

**Files:**
- Modify: `src/backend/services/dbi/soda.ts`

- [ ] **Step 1: Add the lifecycle type + helpers**

In `src/backend/services/dbi/soda.ts`, immediately after the `isClosedStatus(...)` function (after line 234), add:

```ts
export type PermitLifecycle = "active" | "suspected_expired" | "closed";

/** A non-terminal permit older than this (newest of filed/issued) is treated
 *  as suspected-expired and surfaced to the homeowner for review. */
export const SUSPECTED_EXPIRED_AFTER_DAYS = 365;

function newestPermitDateMs(
  ...dates: Array<string | null | undefined>
): number | null {
  let newest: number | null = null;
  for (const value of dates) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

/**
 * Classify a property permit. `closed` = terminal (SODA completed/cancelled,
 * a closed date, or homeowner-closed). `suspected_expired` = not closed but its
 * newest filed/issued date is older than SUSPECTED_EXPIRED_AFTER_DAYS — likely
 * dead (e.g. a long-stale `issued`/`filed` permit) and excluded from anchoring.
 * `active` = everything else.
 */
export function derivePermitLifecycle(input: {
  statusCategory: string | null;
  closedDate: string | null;
  ownerClosed: boolean;
  filedDate: string | null;
  issuedDate: string | null;
  now?: number;
}): PermitLifecycle {
  if (
    input.ownerClosed ||
    isClosedStatus(input.statusCategory, input.closedDate)
  ) {
    return "closed";
  }
  const now = input.now ?? Date.now();
  const newest = newestPermitDateMs(input.filedDate, input.issuedDate);
  if (
    newest !== null &&
    now - newest > SUSPECTED_EXPIRED_AFTER_DAYS * 24 * 60 * 60 * 1000
  ) {
    return "suspected_expired";
  }
  return "active";
}
```

- [ ] **Step 2: Verify build + lint**

Run: `pnpm run build`
Expected: `[build] Complete!`
Run: `npx oxlint src/backend/services/dbi/soda.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 3: Commit**

```bash
git add src/backend/services/dbi/soda.ts
git commit -m "feat(permits): add derivePermitLifecycle helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Use lifecycle in sync anchors, dashboard, detail + add `closePermit`

**Files:**
- Modify: `src/backend/services/dbi/permits-sync.ts`

- [ ] **Step 1: Import the helper**

Add `derivePermitLifecycle` to the existing import from `./soda` (which already imports `isClosedStatus` — see line 33 region). The import list should include `derivePermitLifecycle` and `type PermitLifecycle`.

- [ ] **Step 2: Exclude non-active permits from contractor anchoring**

In `runPermitSync`, replace the anchor condition (currently `if (!row.isClosed && TRADES.includes(row.dataset as Trade)) {` at ~line 584) with:

```ts
    const lifecycle = derivePermitLifecycle({
      statusCategory: row.statusCategory,
      closedDate: row.closedDate,
      ownerClosed: Boolean(row.ownerClosed),
      filedDate: row.filedDate,
      issuedDate: row.issuedDate,
    });
    if (lifecycle === "active" && TRADES.includes(row.dataset as Trade)) {
      anchors.push({
        trade: row.dataset as Trade,
        permitNumber,
        filedDate: row.filedDate ?? null,
      });
    }
```

(Only `active` permits anchor; `suspected_expired` and `closed`/owner-closed do not.)

- [ ] **Step 3: Surface lifecycle + owner fields in the dashboard rows**

In `hydratePropertyPermitRows`, in the object returned from the `.map(...)` (the `return { permitIdentifier, ... isClosed: Boolean(first.isClosed) };` block ending ~line 684), add these fields before the closing `};`:

```ts
      ownerClosed: Boolean(first.ownerClosed),
      ownerCloseNote: first.ownerCloseNote ?? null,
      ownerClosedAt: first.ownerClosedAt ?? null,
      lifecycleStatus: derivePermitLifecycle({
        statusCategory: first.statusCategory,
        closedDate: first.closedDate,
        ownerClosed: Boolean(first.ownerClosed),
        filedDate: first.filedDate,
        issuedDate: first.issuedDate,
      }),
```

- [ ] **Step 4: Extend the `PermitsDashboard` propertyPermits type**

Find the `PermitsDashboard` type (its `propertyPermits` array element shape, defined in this file near the top types section). Add to that element type:

```ts
  ownerClosed: boolean;
  ownerCloseNote: string | null;
  ownerClosedAt: Date | null;
  lifecycleStatus: PermitLifecycle;
```

(If the type is inferred rather than explicit, add the same fields to the inferred shape's definition so callers typecheck.)

- [ ] **Step 5: Surface lifecycle in `getPermitDetail`**

In `getPermitDetail`, after computing `needsReview` (~line 741), compute and include `lifecycleStatus` from `records[0]`:

```ts
  const lifecycleStatus = derivePermitLifecycle({
    statusCategory: records[0].statusCategory,
    closedDate: records[0].closedDate,
    ownerClosed: Boolean(records[0].ownerClosed),
    filedDate: records[0].filedDate,
    issuedDate: records[0].issuedDate,
  });
  return {
    permitIdentifier: normalized,
    needsReview,
    lifecycleStatus,
    records,
    revisions,
    viewed: viewed || null,
  };
```

Add `lifecycleStatus: PermitLifecycle;` to the `PermitDetail` type.

- [ ] **Step 6: Add the `closePermit` service**

Add this exported function next to `markPermitViewed` (after it, ~line 780):

```ts
export async function closePermit(
  env: Env,
  permitIdentifier: string,
  note: string,
  closedBy: string,
): Promise<PermitDetail | null> {
  const db = drizzle(env.DB);
  const normalized = permitIdentifier.trim();
  const trimmedNote = note.trim();
  if (!normalized) throw new Error("permitIdentifier is required");
  if (!trimmedNote) throw new Error("A closing note is required");

  await db
    .update(permitsRecords)
    .set({
      ownerClosed: true,
      ownerCloseNote: trimmedNote,
      ownerClosedAt: new Date(),
      ownerClosedBy: closedBy,
      datetimeUpdated: new Date(),
    })
    .where(eq(permitsRecords.permitIdentifier, normalized))
    .run();

  return getPermitDetail(env, normalized);
}
```

(`eq` and `permitsRecords` are already imported in this file.)

- [ ] **Step 7: Verify build + lint**

Run: `pnpm run build`
Expected: `[build] Complete!`
Run: `npx oxlint src/backend/services/dbi/permits-sync.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 8: Commit**

```bash
git add src/backend/services/dbi/permits-sync.ts
git commit -m "feat(permits): lifecycle-gated anchors + closePermit + surface lifecycle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `POST /property/:permitIdentifier/close` route

**Files:**
- Modify: `src/backend/api/routes/admin-permits.ts`

- [ ] **Step 1: Import `closePermit`**

Add `closePermit` to the import from `@/services/dbi/permits-sync` (the existing import block at the top, lines 2-8).

- [ ] **Step 2: Add the route**

Insert after the `/property/:permitIdentifier/viewed` route (after line 82), before the `/contacts` route:

```ts
adminPermitsRouter.post("/property/:permitIdentifier/close", async (c) => {
  try {
    const permitIdentifier = decodeURIComponent(
      c.req.param("permitIdentifier"),
    );
    const body = (await c.req.json().catch(() => ({}))) as { note?: string };
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) {
      return c.json({ error: "A closing note is required" }, 400);
    }
    const detail = await closePermit(c.env, permitIdentifier, note, "homeowner");
    if (!detail) {
      return c.json({ error: "Permit not found" }, 404);
    }
    return c.json({ success: true, detail });
  } catch (error) {
    return c.json(
      {
        error: "Failed to close permit",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});
```

- [ ] **Step 3: Verify build + lint**

Run: `pnpm run build`
Expected: `[build] Complete!`
Run: `npx oxlint src/backend/api/routes/admin-permits.ts`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 4: Commit**

```bash
git add src/backend/api/routes/admin-permits.ts
git commit -m "feat(permits): add close-with-note endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — lifecycle badge + close-with-note modal

**Files:**
- Modify: `src/frontend/components/PermitsAdminApp.tsx`

- [ ] **Step 1: Add imports**

Add to the imports at the top of the file:

```ts
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
```

- [ ] **Step 2: Extend the `PropertyPermit` and detail types**

In the `PropertyPermit` type (ends with `isClosed: boolean;` ~line 76-77), add:

```ts
  ownerClosed: boolean;
  ownerCloseNote?: string | null;
  ownerClosedAt?: string | number | Date | null;
  lifecycleStatus: "active" | "suspected_expired" | "closed";
```

In `PermitDetailPayload.detail` (the object with `needsReview: boolean;` ~line 98), add:

```ts
    lifecycleStatus: "active" | "suspected_expired" | "closed";
```

- [ ] **Step 3: Add a Suspected-Expired badge to the permits list**

In the property-permit list item, the badge row currently is (~lines 331-336):

```tsx
                        {permit.needsReview ? (
                          <Badge variant="destructive">Needs Review</Badge>
                        ) : (
                          <Badge variant="secondary">Reviewed</Badge>
                        )}
                        {permit.isClosed ? <Badge variant="outline">Closed</Badge> : null}
```

Add, immediately after the `isClosed` badge line:

```tsx
                        {permit.lifecycleStatus === "suspected_expired" ? (
                          <Badge className="border-amber-500/60 bg-amber-500/15 text-amber-300">
                            Suspected Expired
                          </Badge>
                        ) : null}
```

- [ ] **Step 4: Add close state + handler to `PermitDetailApp`**

Inside `PermitDetailApp`, after the existing `useState` hooks (after `const [autoMarked, setAutoMarked] = useState(false);` ~line 396), add:

```ts
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [closing, setClosing] = useState(false);

  const closePermit = useCallback(async () => {
    if (!closeNote.trim()) {
      toast.error("A closing note is required");
      return;
    }
    setClosing(true);
    try {
      const response = await fetch(
        `/api/admin/permits/property/${encodeURIComponent(permitIdentifier)}/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ note: closeNote.trim() }),
        },
      );
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to close permit");
      }
      toast.success("Permit marked closed");
      setCloseOpen(false);
      setCloseNote("");
      await loadDetail();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to close permit");
    } finally {
      setClosing(false);
    }
  }, [closeNote, loadDetail, permitIdentifier]);
```

- [ ] **Step 5: Render the badge + close button + Dialog in the detail header**

In the detail header action area (the `<div className="flex items-center gap-2">` that holds the `needsReview` badge, ~line 487), add — after that badge group — a lifecycle badge and a close button shown only when not already closed:

```tsx
              {detail.lifecycleStatus === "suspected_expired" ? (
                <Badge className="border-amber-500/60 bg-amber-500/15 text-amber-300">
                  Suspected Expired
                </Badge>
              ) : null}
              {detail.lifecycleStatus === "closed" ? (
                <Badge variant="outline">Closed</Badge>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setCloseOpen(true)}>
                  Mark Closed
                </Button>
              )}
```

Then add this Dialog once, just before the final closing `</div>` of the component's returned tree (right before the last `</div>` that wraps `space-y-6`):

```tsx
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close permit {detail.permitIdentifier}</DialogTitle>
            <DialogDescription>
              Mark this permit closed (e.g. expired/re-filed). A note is required and
              kept for your records. This stops contractor tracking for this permit.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
            placeholder="Why are you closing this permit? (e.g. expired, re-filed as 202409241521)"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)} disabled={closing}>
              Cancel
            </Button>
            <Button onClick={() => void closePermit()} disabled={closing || !closeNote.trim()}>
              {closing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Close permit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: Verify build + lint**

Run: `pnpm run build`
Expected: `[build] Complete!`
Run: `npx oxlint src/frontend/components/PermitsAdminApp.tsx`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 7: Commit**

```bash
git add src/frontend/components/PermitsAdminApp.tsx
git commit -m "feat(permits): suspected-expired badge + close-with-note modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Migrate (manual), deploy, verify in prod

**Files:** none (ops + verification)

- [ ] **Step 1: Full build + lint**

Run: `pnpm run build` → `[build] Complete!`
Run: `npx oxlint src/backend/services/dbi/permits-sync.ts src/backend/services/dbi/soda.ts src/backend/api/routes/admin-permits.ts src/frontend/components/PermitsAdminApp.tsx src/backend/db/schema/home/permits_records.ts` → `0 warnings and 0 errors`.

- [ ] **Step 2: Apply the migration to remote D1 FIRST (manual — not migrate:remote)**

Run (these are additive; safe):
```bash
npx wrangler@latest d1 execute core-remodel --remote --command "ALTER TABLE permits_records ADD COLUMN owner_closed integer DEFAULT 0 NOT NULL; ALTER TABLE permits_records ADD COLUMN owner_close_note text; ALTER TABLE permits_records ADD COLUMN owner_closed_at integer; ALTER TABLE permits_records ADD COLUMN owner_closed_by text;"
```
Expected: 4 statements succeed. Verify: `npx wrangler@latest d1 execute core-remodel --remote --command "SELECT owner_closed FROM permits_records LIMIT 1;"` returns a row (column exists).

- [ ] **Step 3: Deploy (gated — confirm with user before running)**

Run: `pnpm run build && cp .assetsignore dist/.assetsignore && npx wrangler@latest deploy`
Expected: deploy succeeds. (NOT `pnpm run deploy`.)

- [ ] **Step 4: Manual verification**

1. `GET https://core-remodel.hacolby.workers.dev/api/admin/permits` → `propertyPermits[]` items include `lifecycleStatus`; `202307172359` shows `suspected_expired` (filed 2023, >365d, not closed).
2. In the UI `/admin/permits`, open `202307172359`, click **Mark Closed**, enter a note, submit → returns success; reload shows `Closed`.
3. Confirm it dropped from anchoring: after the next sync (or `POST /api/admin/permits/sync`), `SELECT contact_name, is_monitored, anchor_permit_identifiers FROM permits_contacts` no longer anchors a contractor solely to `202307172359`, and a `SELECT owner_closed, owner_close_note FROM permits_records WHERE permit_identifier='202307172359'` shows `owner_closed=1` + the note.

---

## Notes for the executor

- Tabs (Scans/Runs) already exist in `PermitsAdminApp.tsx` — do NOT rebuild them; only add the badge + close modal.
- Migration MUST be applied before deploy (Drizzle `select()` reads all columns).
- `owner_closed_by` is the literal `"homeowner"` — the admin gate has no per-user identity.
- This is Phase 0 of the larger permits epic (see the design spec). Monitoring/enrichment/benchmark phases come next, each with its own plan.
