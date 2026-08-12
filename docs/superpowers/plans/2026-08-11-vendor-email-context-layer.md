# Vendor Email Context Layer (PR 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core-remodel context layer for vendor email — a reusable instructions/boilerplate document, recipient resolution from showroom contacts, and a compose-context tool that assembles a send-ready payload — with the actual Gmail send/attach/schedule living on the separate `google-workspace-mcp` worker.

**Architecture:** One D1 table (`email_instructions`), a new MCP `email` domain (four tools), two admin API routes, and one admin editor page. Nothing here sends email or touches Drive sharing; it produces data and a structured payload the chat agent hands to the Workspace worker. No dependency on that worker's timeline.

**Tech Stack:** Cloudflare Workers, Hono, Drizzle ORM + D1, the repo's MCP `defineTool` registry, PlateJS (existing `OverviewNoteEditor`), `node:assert` self-check tests run with `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-08-11-vendor-email-compose-and-schedule-design.md`.

## Global Constraints

- **Never `db.transaction()`** — D1 rejects SQL `BEGIN` (error 7500). Use `db.batch([...])`. (This PR barely writes, but the rule stands.)
- **No denormalized `*_name` columns** — relate by integer FK, JOIN for display names.
- **Never import `drizzle-zod`** — it breaks `pnpm run build` on the pinned `drizzle-orm@0.33.0`. Hand-write Zod v4.
- **Sanitize HTML on write** with the existing `sanitizeNoteHtml` from `@backend/services/notes/markdown` — do NOT add a new sanitizer dependency.
- **Migrations:** `pnpm run db:generate` then `pnpm run migrate:remote`. Never raw SQL, never hand-edit a migration. Read the generated `.sql` before applying.
- **Typecheck manually:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — grep output for your own filenames; there is a large pre-existing baseline.
- **Format only files you touched:** `npx oxfmt <paths>`. Never repo-wide `pnpm run fmt`.
- **MCP tools:** one file per tool under `src/backend/mcp/tools/email/`, `defineTool` with hand-written Zod `inputShape`/`outputShape`, correct annotation (`READ_ONLY` / `WRITE`), ≥1 `example`. Register in `tools/email/index.ts` and spread into `ALL_TOOL_GROUPS` in `tools/index.ts`. Model on `src/backend/mcp/tools/rooms/list_rooms.ts`.
- **Tests are plain `node:assert/strict`** run with `npx tsx <file>.test.ts`, exit non-zero on first failure. Model on `src/backend/services/gmail/ingest-gate-domains.test.ts`.
- **`.astro` pages use `class`, never `className`**, and follow the mandatory page shell (BaseLayout, `<main class="container mx-auto px-4 py-8 pb-12">`, a header block with a 24px icon). Canonical: `src/frontend/pages/admin/studio.astro`.
- **Contacts table** is `showroom_store_contacts` (drizzle export from `src/backend/db/schema/showroom/contacts.ts`): columns `storeId`, `type` (contact kind enum), `firstName`, `lastName`, `emailAddress`, plus phones. Resolve recipients against it.

---

### Task 1: `email_instructions` schema + migration

**Files:**
- Create: `src/backend/db/schema/email/email_instructions.ts`
- Create: `src/backend/db/schema/email/index.ts`
- Modify: `src/backend/db/schema/index.ts` (add barrel export)

**Interfaces:**
- Produces: drizzle table `emailInstructions` with columns `id`, `instructionsMarkdown`, `instructionsHtml`, `updatedAt`.

- [ ] **Step 1: Create the table**

`src/backend/db/schema/email/email_instructions.ts`:

```ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The reusable vendor-email boilerplate/guidance the composing agent reads and
 * folds into a message. AGENTS.md-style prose, NOT a mail-merge template.
 *
 * Single active row (id = 1 by convention). Stored as markdown (canonical, the
 * portable source) + html (the render cache), matching the repo's rich-text
 * storage rule. This is prose guidance, so markdown is the right canonical form
 * here — unlike a formatted email body, which the Workspace worker owns.
 */
export const emailInstructions = sqliteTable("email_instructions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instructionsMarkdown: text("instructions_markdown").notNull().default(""),
  instructionsHtml: text("instructions_html").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
```

`src/backend/db/schema/email/index.ts`:

```ts
export * from "./email_instructions";
```

Append to `src/backend/db/schema/index.ts` (match the existing `export * from "./<domain>/index";` style):

```ts
// Vendor-email context layer (2026-08-11): the reusable instructions doc.
export * from "./email/index";
```

- [ ] **Step 2: Generate the migration and read it**

```bash
pnpm run db:generate
git status --short drizzle/
```
Open the generated `.sql` and confirm it contains ONLY `CREATE TABLE email_instructions`. If it re-emits other tables the meta snapshot is behind — strip the non-delta statements before applying; do not hand-edit otherwise.

- [ ] **Step 3: Apply to remote and verify**

```bash
pnpm run migrate:remote
npx wrangler d1 execute core-remodel --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name='email_instructions'"
```
Expected: one row, `email_instructions`.

- [ ] **Step 4: Typecheck and commit**

```bash
npx oxfmt src/backend/db/schema/email/*.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep "schema/email"
git add src/backend/db/schema/email src/backend/db/schema/index.ts drizzle/
git commit -m "feat(email): email_instructions table — the reusable boilerplate doc"
```

---

### Task 2: Recipient resolution — service + MCP tool + API

**Files:**
- Create: `src/backend/services/email/resolve-recipient.ts`
- Create: `src/backend/services/email/resolve-recipient.test.ts`
- Create: `src/backend/mcp/tools/email/resolve_recipient.ts`
- Create: `src/backend/mcp/tools/email/index.ts`
- Modify: `src/backend/mcp/tools/index.ts` (import `emailTools`, spread into `ALL_TOOL_GROUPS`)
- Create: `src/backend/api/routes/email.ts`
- Modify: `src/backend/api/index.ts` (mount `/api/email`)

**Interfaces:**
- Consumes: `showroomStoreContacts` (drizzle) from `@backend/db`; `showroomStores` for the store name.
- Produces:
  - `type ResolvedRecipient = { email: string; name: string | null; storeId: number | null; storeName: string | null; contactType: string | null }`
  - `type ResolveResult = { ok: true; recipients: ResolvedRecipient[] } | { ok: false; reason: "no_match" | "ambiguous" | "invalid"; message: string; candidates: ResolvedRecipient[] }`
  - `isValidEmail(s: string): boolean`
  - `resolveRecipient(db, input: { email?: string; store?: string; contact?: string }): Promise<ResolveResult>`
  - MCP tool `resolveRecipient` exported from `tools/email/resolve_recipient.ts`; domain array `emailTools` from `tools/email/index.ts`.

- [ ] **Step 1: Write the failing test (pure `isValidEmail` only)**

The DB resolve needs a live D1, so the unit test covers the pure email validator; the DB path is covered by QC (Task 6). Create `src/backend/services/email/resolve-recipient.test.ts`:

```ts
/**
 * Runnable self-check for the pure recipient helpers. No framework:
 *   npx tsx src/backend/services/email/resolve-recipient.test.ts
 */
import assert from "node:assert/strict";

import { isValidEmail } from "./resolve-recipient";

assert.equal(isValidEmail("nancy@pietrafina.com"), true);
assert.equal(isValidEmail("a.b-c+tag@sub.example.co.uk"), true);
assert.equal(isValidEmail("no-at-sign"), false);
assert.equal(isValidEmail("two@@at.com"), false);
assert.equal(isValidEmail("trailing@dot."), false);
assert.equal(isValidEmail(" leading-space@x.com"), false);
assert.equal(isValidEmail(""), false);

console.log("resolve-recipient.test.ts: all assertions passed");
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx tsx src/backend/services/email/resolve-recipient.test.ts
```
Expected: FAIL — `Cannot find module './resolve-recipient'`.

- [ ] **Step 3: Implement the service**

Create `src/backend/services/email/resolve-recipient.ts`:

```ts
/**
 * @fileoverview Resolve a vendor-email recipient — an explicit address passes
 * through (validated); a store + optional contact reference is looked up in
 * showroom_store_contacts. An unresolvable or ambiguous reference returns a
 * structured result with candidates; it NEVER guesses or silently drops one.
 */
import { showroomStores, showroomStoreContacts } from "@backend/db";
import { and, eq, like } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

export interface ResolvedRecipient {
  email: string;
  name: string | null;
  storeId: number | null;
  storeName: string | null;
  contactType: string | null;
}

export type ResolveResult =
  | { ok: true; recipients: ResolvedRecipient[] }
  | {
      ok: false;
      reason: "no_match" | "ambiguous" | "invalid";
      message: string;
      candidates: ResolvedRecipient[];
    };

/** Pragmatic RFC-ish check: one @, no spaces, a dotted domain with a TLD. */
export function isValidEmail(s: string): boolean {
  if (s !== s.trim() || s.length === 0) return false;
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s);
}

function fullName(first: string | null, last: string | null): string | null {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n.length > 0 ? n : null;
}

export async function resolveRecipient(
  db: ReturnType<typeof drizzle>,
  input: { email?: string; store?: string; contact?: string },
): Promise<ResolveResult> {
  // 1. Explicit address wins.
  if (input.email) {
    if (!isValidEmail(input.email)) {
      return { ok: false, reason: "invalid", message: `not a valid email: ${input.email}`, candidates: [] };
    }
    return { ok: true, recipients: [{ email: input.email, name: null, storeId: null, storeName: null, contactType: null }] };
  }

  if (!input.store) {
    return { ok: false, reason: "invalid", message: "provide an email, or a store (+ optional contact)", candidates: [] };
  }

  // 2. Match the store by exact id or name substring.
  const storeIdNum = Number(input.store);
  const storeRows = await db
    .select({ id: showroomStores.id, name: showroomStores.name })
    .from(showroomStores)
    .where(Number.isFinite(storeIdNum) ? eq(showroomStores.id, storeIdNum) : like(showroomStores.name, `%${input.store}%`))
    .limit(10);

  if (storeRows.length === 0) {
    return { ok: false, reason: "no_match", message: `no store matched "${input.store}"`, candidates: [] };
  }
  if (storeRows.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      message: `"${input.store}" matched ${storeRows.length} stores; be specific`,
      candidates: storeRows.map((s) => ({ email: "", name: s.name, storeId: s.id, storeName: s.name, contactType: null })),
    };
  }

  const store = storeRows[0];

  // 3. Contacts on that store WITH an email address.
  const contacts = await db
    .select({
      email: showroomStoreContacts.emailAddress,
      firstName: showroomStoreContacts.firstName,
      lastName: showroomStoreContacts.lastName,
      type: showroomStoreContacts.type,
    })
    .from(showroomStoreContacts)
    .where(eq(showroomStoreContacts.storeId, store.id));

  let withEmail = contacts.filter((c) => c.email && isValidEmail(c.email));

  // Narrow by contact name/type substring if given.
  if (input.contact) {
    const needle = input.contact.toLowerCase();
    withEmail = withEmail.filter((c) =>
      [c.firstName, c.lastName, c.type].some((v) => v?.toLowerCase().includes(needle)),
    );
  }

  const toResolved = (c: (typeof withEmail)[number]): ResolvedRecipient => ({
    email: c.email as string,
    name: fullName(c.firstName, c.lastName),
    storeId: store.id,
    storeName: store.name,
    contactType: c.type ?? null,
  });

  if (withEmail.length === 0) {
    return {
      ok: false,
      reason: "no_match",
      message: input.contact
        ? `no contact matching "${input.contact}" with an email at ${store.name}`
        : `no contact with an email at ${store.name}`,
      candidates: [],
    };
  }
  if (withEmail.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      message: `${withEmail.length} contacts at ${store.name} match; name the person`,
      candidates: withEmail.map(toResolved),
    };
  }
  return { ok: true, recipients: [toResolved(withEmail[0])] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx src/backend/services/email/resolve-recipient.test.ts
```
Expected: `resolve-recipient.test.ts: all assertions passed`.

- [ ] **Step 5: Add the MCP tool + domain registration**

Create `src/backend/mcp/tools/email/resolve_recipient.ts`:

```ts
import { showroomStoreContacts } from "@backend/db";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { resolveRecipient } from "@backend/services/email/resolve-recipient";

export const resolveRecipientTool = defineTool({
  name: "resolve_recipient",
  category: "email",
  title: "Resolve an email recipient",
  description:
    "Turn a recipient reference into an email address. Pass `email` for an explicit address (validated, passed through), or `store` (id or name substring) plus optional `contact` (name/role substring) to look up a showroom store's contact. Returns the resolved recipient(s), or — when nothing matches or several do — `ok:false` with the reason and candidates. NEVER guesses; if it returns ok:false, ask the user rather than picking one.",
  inputShape: {
    email: z.string().optional().describe("Explicit recipient email address"),
    store: z.string().optional().describe("Showroom store id or name substring"),
    contact: z.string().optional().describe("Contact name or role substring at that store"),
  },
  annotations: READ_ONLY,
  outputShape: {
    ok: z.boolean(),
    reason: z.string().optional(),
    message: z.string().optional(),
    recipients: z
      .array(
        looseObject({
          email: z.string(),
          name: z.string().nullable(),
          storeId: z.number().int().nullable(),
          storeName: z.string().nullable(),
          contactType: z.string().nullable(),
        }),
      )
      .optional(),
    candidates: z.array(looseObject({})).optional(),
  },
  examples: [
    { input: { store: "Pietra Fina", contact: "Nancy" }, note: "resolve a named contact at a store" },
    { input: { email: "nancy@pietrafina.com" }, note: "explicit address passes through" },
  ],
  handler: async (ctx) => {
    const db = drizzle(ctx.env.DB);
    const result = await resolveRecipient(db, ctx.input);
    return result.ok
      ? { ok: true, recipients: result.recipients }
      : { ok: false, reason: result.reason, message: result.message, candidates: result.candidates };
  },
});
```

> NOTE: confirm the exact `defineTool` shape (field names `inputShape`/`outputShape`/`annotations`/`examples`/`handler`, and the `ctx` signature — `ctx.env`, `ctx.input`) against a existing tool such as `src/backend/mcp/tools/rooms/list_rooms.ts` and `src/backend/mcp/tools/rooms/update_room.ts` before finalizing; match them exactly. The `showroomStoreContacts` import above is only needed if you reference it directly — drop it if unused.

Create `src/backend/mcp/tools/email/index.ts`:

```ts
import type { RemodelTool } from "../../types";

import { resolveRecipientTool } from "./resolve_recipient";

export const emailTools: RemodelTool[] = [resolveRecipientTool];
```

In `src/backend/mcp/tools/index.ts`: add `import { emailTools } from "./email";` with the other domain imports, and spread `...emailTools,` into `ALL_TOOL_GROUPS` (append at the end — docs order).

- [ ] **Step 6: Add the API route**

Create `src/backend/api/routes/email.ts`:

```ts
/**
 * @fileoverview Vendor-email context layer HTTP surface (admin-gated by the
 * /api/admin-style mount, see index.ts). Sends nothing — resolves recipients
 * and reads/writes the instructions doc.
 */
import { resolveRecipient } from "@backend/services/email/resolve-recipient";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

export const emailRouter = new Hono<{ Bindings: Env }>();

emailRouter.get("/resolve-recipient", async (c) => {
  const db = drizzle(c.env.DB);
  const result = await resolveRecipient(db, {
    email: c.req.query("email"),
    store: c.req.query("store"),
    contact: c.req.query("contact"),
  });
  return c.json(result, result.ok ? 200 : 200); // ok:false is a valid result, not an HTTP error
});
```

Mount in `src/backend/api/index.ts` behind the admin auth middleware, matching how other admin routers mount (e.g. `admin-drive-ingest`). Use `app.route("/api/email", emailRouter);` placed AFTER the `app.use("/api/admin/*", requireAccessAuth)` line only if `/api/email` should be admin-gated — check how the existing gmail routes gate themselves and follow the same access pattern (the email routes are operator-only, so they must be gated; if the admin middleware is `/api/admin/*` specifically, mount under `/api/admin/email` instead to inherit it, and update the route paths in QC accordingly).

- [ ] **Step 7: Typecheck, format, commit**

```bash
npx oxfmt src/backend/services/email/*.ts src/backend/mcp/tools/email/*.ts src/backend/api/routes/email.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep -E "services/email|tools/email|routes/email"
git add src/backend/services/email src/backend/mcp/tools/email src/backend/mcp/tools/index.ts src/backend/api/routes/email.ts src/backend/api/index.ts
git commit -m "feat(email): recipient resolution — service, resolve_recipient MCP tool, API

Resolves an explicit address (validated) or a showroom store+contact
reference against showroom_store_contacts. An unresolvable or ambiguous
reference returns a structured result with candidates — never a guess."
```

---

### Task 3: Email instructions — MCP get/update + API

**Files:**
- Create: `src/backend/mcp/tools/email/get_email_instructions.ts`
- Create: `src/backend/mcp/tools/email/update_email_instructions.ts`
- Modify: `src/backend/mcp/tools/email/index.ts` (add both to `emailTools`)
- Modify: `src/backend/api/routes/email.ts` (add GET + PUT `/instructions`)
- Create: `src/backend/services/email/instructions.ts` (shared get/upsert used by both MCP and API)

**Interfaces:**
- Consumes: `emailInstructions` (Task 1); `sanitizeNoteHtml` from `@backend/services/notes/markdown`.
- Produces:
  - `getInstructions(db): Promise<{ markdown: string; html: string; updatedAt: Date | null }>`
  - `upsertInstructions(db, { markdown, html }): Promise<{ markdown: string; html: string }>` — sanitizes html, writes the single row (id=1), returns the stored values.
  - MCP tools `getEmailInstructionsTool`, `updateEmailInstructionsTool`.

- [ ] **Step 1: Implement the shared service**

Create `src/backend/services/email/instructions.ts`:

```ts
/**
 * @fileoverview Read/write the single email_instructions row. HTML is
 * sanitized with the repo's existing sanitizeNoteHtml on every write — never
 * store raw html. Both the MCP tools and the API route go through here so the
 * two surfaces cannot diverge.
 */
import { emailInstructions } from "@backend/db";
import { sanitizeNoteHtml } from "@backend/services/notes/markdown";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

const ROW_ID = 1;

export async function getInstructions(
  db: ReturnType<typeof drizzle>,
): Promise<{ markdown: string; html: string; updatedAt: Date | null }> {
  const [row] = await db.select().from(emailInstructions).where(eq(emailInstructions.id, ROW_ID)).limit(1);
  return {
    markdown: row?.instructionsMarkdown ?? "",
    html: row?.instructionsHtml ?? "",
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function upsertInstructions(
  db: ReturnType<typeof drizzle>,
  input: { markdown: string; html: string },
): Promise<{ markdown: string; html: string }> {
  const html = sanitizeNoteHtml(input.html);
  const markdown = input.markdown;
  await db
    .insert(emailInstructions)
    .values({ id: ROW_ID, instructionsMarkdown: markdown, instructionsHtml: html, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: emailInstructions.id,
      set: { instructionsMarkdown: markdown, instructionsHtml: html, updatedAt: new Date() },
    });
  return { markdown, html };
}
```

- [ ] **Step 2: Add the two MCP tools**

`src/backend/mcp/tools/email/get_email_instructions.ts` (`READ_ONLY`) calls `getInstructions`; `src/backend/mcp/tools/email/update_email_instructions.ts` (`WRITE`) calls `upsertInstructions`. Model the `defineTool` shape on `list_rooms.ts` / `update_room.ts`. `update_email_instructions` `inputShape`: `{ markdown: z.string(), html: z.string() }`; describe that html is sanitized on write and markdown is the canonical source. Add both to `emailTools` in `tools/email/index.ts`.

```ts
// get_email_instructions.ts handler
handler: async (ctx) => {
  const db = drizzle(ctx.env.DB);
  return getInstructions(db);
},
// update_email_instructions.ts handler
handler: async (ctx) => {
  const db = drizzle(ctx.env.DB);
  return upsertInstructions(db, { markdown: ctx.input.markdown, html: ctx.input.html });
},
```

- [ ] **Step 3: Add the API routes**

In `src/backend/api/routes/email.ts` add:

```ts
import { getInstructions, upsertInstructions } from "@backend/services/email/instructions";
import { z } from "zod";

emailRouter.get("/instructions", async (c) => {
  return c.json(await getInstructions(drizzle(c.env.DB)));
});

const instructionsBody = z.object({ markdown: z.string(), html: z.string() });
emailRouter.put("/instructions", async (c) => {
  const parsed = instructionsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  return c.json(await upsertInstructions(drizzle(c.env.DB), parsed.data));
});
```

- [ ] **Step 4: Typecheck, format, commit**

```bash
npx oxfmt src/backend/services/email/instructions.ts src/backend/mcp/tools/email/*.ts src/backend/api/routes/email.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep -E "services/email|tools/email|routes/email"
git add src/backend/services/email src/backend/mcp/tools/email src/backend/api/routes/email.ts
git commit -m "feat(email): instructions doc — get/update MCP tools + GET/PUT API

Single-row email_instructions read/written through one shared service so
MCP and API cannot diverge; html sanitized with sanitizeNoteHtml on write."
```

---

### Task 4: `compose_vendor_email` — the aggregator + disposition logic

**Files:**
- Create: `src/backend/services/email/disposition.ts`
- Create: `src/backend/services/email/disposition.test.ts`
- Create: `src/backend/mcp/tools/email/compose_vendor_email.ts`
- Modify: `src/backend/mcp/tools/email/index.ts` (add to `emailTools`)

**Interfaces:**
- Consumes: `resolveRecipient` (Task 2); `getInstructions` (Task 3); `driveDocuments` (PR 1) from `@backend/db`.
- Produces:
  - `type Disposition = "attach" | "link"`
  - `suggestDispositions(files: { driveDocumentId: number; sizeBytes: number | null }[], budgetBytes?: number): { driveDocumentId: number; suggestedDisposition: Disposition }[]`
  - MCP tool `composeVendorEmailTool`.

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/email/disposition.test.ts`:

```ts
/**
 * Runnable self-check for the attach-vs-link size logic. No framework:
 *   npx tsx src/backend/services/email/disposition.test.ts
 */
import assert from "node:assert/strict";

import { GMAIL_ATTACH_BUDGET_BYTES, suggestDispositions } from "./disposition";

const MB = 1024 * 1024;

// Small files all attach.
assert.deepEqual(
  suggestDispositions([
    { driveDocumentId: 1, sizeBytes: 2 * MB },
    { driveDocumentId: 2, sizeBytes: 3 * MB },
  ]),
  [
    { driveDocumentId: 1, suggestedDisposition: "attach" },
    { driveDocumentId: 2, suggestedDisposition: "attach" },
  ],
);

// The file that would cross the ~18 MiB budget flips to link; a later small one
// still fits and attaches.
{
  const out = suggestDispositions([
    { driveDocumentId: 1, sizeBytes: 15 * MB },
    { driveDocumentId: 2, sizeBytes: 10 * MB }, // 15+10 > 18 → link
    { driveDocumentId: 3, sizeBytes: 1 * MB }, // 15+1 ≤ 18 → attach
  ]);
  assert.deepEqual(out, [
    { driveDocumentId: 1, suggestedDisposition: "attach" },
    { driveDocumentId: 2, suggestedDisposition: "link" },
    { driveDocumentId: 3, suggestedDisposition: "attach" },
  ]);
}

// A file with unknown size (null) is linked — we cannot promise it fits.
assert.deepEqual(suggestDispositions([{ driveDocumentId: 9, sizeBytes: null }]), [
  { driveDocumentId: 9, suggestedDisposition: "link" },
]);

// A single file larger than the budget links.
assert.deepEqual(suggestDispositions([{ driveDocumentId: 5, sizeBytes: 50 * MB }]), [
  { driveDocumentId: 5, suggestedDisposition: "link" },
]);

assert.equal(GMAIL_ATTACH_BUDGET_BYTES, 18 * MB);
console.log("disposition.test.ts: all assertions passed");
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx tsx src/backend/services/email/disposition.test.ts
```
Expected: FAIL — `Cannot find module './disposition'`.

- [ ] **Step 3: Implement**

Create `src/backend/services/email/disposition.ts`:

```ts
/**
 * @fileoverview Suggest attach-vs-link for a set of Drive files.
 *
 * Gmail caps a whole message at 25 MiB and base64 transfer-encoding inflates
 * bytes by ~1.33x, so the real usable budget for raw attachment bytes is about
 * 18 MiB. This is only a RECOMMENDATION — the google-workspace-mcp worker makes
 * the final call and does the actual attaching/sharing. A file is suggested for
 * `link` when its size is unknown or when attaching it would cross the running
 * budget; the running total only counts files actually kept as `attach`.
 */
export type Disposition = "attach" | "link";

export const GMAIL_ATTACH_BUDGET_BYTES = 18 * 1024 * 1024;

export function suggestDispositions(
  files: { driveDocumentId: number; sizeBytes: number | null }[],
  budgetBytes: number = GMAIL_ATTACH_BUDGET_BYTES,
): { driveDocumentId: number; suggestedDisposition: Disposition }[] {
  let used = 0;
  return files.map((f) => {
    if (f.sizeBytes == null || used + f.sizeBytes > budgetBytes) {
      return { driveDocumentId: f.driveDocumentId, suggestedDisposition: "link" as const };
    }
    used += f.sizeBytes;
    return { driveDocumentId: f.driveDocumentId, suggestedDisposition: "attach" as const };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx src/backend/services/email/disposition.test.ts
```
Expected: `disposition.test.ts: all assertions passed`.

- [ ] **Step 5: Add the compose tool**

Create `src/backend/mcp/tools/email/compose_vendor_email.ts` — `READ_ONLY` (it reads and assembles, writes nothing). It:
1. resolves recipients via `resolveRecipient` (if `ok:false`, return that verbatim so the agent asks the user),
2. loads instructions via `getInstructions`,
3. loads the chosen files from `driveDocuments` by id (only `isActive && !isDeleted`), selecting `id, name, mimeType, sizeBytes, webViewUrl, sharing`,
4. runs `suggestDispositions` over them,
5. returns `{ to, subject, instructionsMarkdown, attachments: [{ driveDocumentId, name, mimeType, sizeBytes, webViewUrl, sharing, suggestedDisposition }] }`.

`inputShape`: `{ email: z.string().optional(), store: z.string().optional(), contact: z.string().optional(), subject: z.string(), intent: z.string().optional(), driveDocumentIds: z.array(z.number().int()).optional() }`. Chunk the id lookup with `inArray` at 20 (D1 100-param cap) if `driveDocumentIds` can be long. Description must state plainly: **assembles context only — sends nothing, changes no Drive sharing; hand the result to the Workspace worker's gmail_send / schedule_email to actually send**. Add to `emailTools`.

- [ ] **Step 6: Typecheck, format, commit**

```bash
npx oxfmt src/backend/services/email/disposition.ts src/backend/services/email/disposition.test.ts src/backend/mcp/tools/email/compose_vendor_email.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep -E "services/email|tools/email"
git add src/backend/services/email/disposition.ts src/backend/services/email/disposition.test.ts src/backend/mcp/tools/email/compose_vendor_email.ts src/backend/mcp/tools/email/index.ts
git commit -m "feat(email): compose_vendor_email — assemble a send-ready payload

Resolves recipients, loads the instructions, loads the chosen Drive files
with their share state, and suggests attach-vs-link per Gmail's ~18 MiB
usable budget. Sends nothing and changes no sharing — the payload goes to
the Workspace worker, which performs the actual send."
```

---

### Task 5: Instructions editor page (frontend)

**Files:**
- Create: `src/frontend/pages/admin/email/instructions.astro`
- Create: `src/frontend/components/email/EmailInstructionsEditor.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/email/instructions` (Task 3); the existing `OverviewNoteEditor` (`@/components/showroom/OverviewNoteEditor`) which emits `{ markdown, html }` via `onChange`.

- [ ] **Step 1: Build the island**

`EmailInstructionsEditor.tsx`: on mount `GET /api/email/instructions`, seed `OverviewNoteEditor` with the returned markdown, and on save `PUT` the current `{ markdown, html }`. A save button with a saved/at timestamp. Model the fetch + editor wiring on an existing island that uses `OverviewNoteEditor` (e.g. the showroom overview note surface) so the props match exactly.

- [ ] **Step 2: Build the Astro shell**

`instructions.astro` follows the mandatory shell exactly (see `src/frontend/pages/admin/studio.astro`): `<BaseLayout>`, `<main class="container mx-auto px-4 py-8 pb-12">`, a header block with an `h1` carrying a 24px mail/settings icon (`class="size-6 text-muted-foreground"`) and a one-line description, then `<EmailInstructionsEditor client:only="react" />`. Use `class`, never `className`, in the `.astro` file.

- [ ] **Step 3: Typecheck (frontend), format, commit**

```bash
npx oxfmt src/frontend/components/email/EmailInstructionsEditor.tsx
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep -E "email/instructions|EmailInstructionsEditor"
git add src/frontend/pages/admin/email src/frontend/components/email
git commit -m "feat(email): admin editor page for the vendor-email instructions doc"
```

---

### Task 6: QC script + changelog + PR

**Files:**
- Create: `scripts/qc/pr_<N>.mjs` (real PR number once opened)
- Modify: `src/frontend/data/changelog.ts`, `src/frontend/data/changelog-detail.ts`

**Interfaces:**
- Consumes: `resolveBase`, `createClient`, `createChecks`, `assertReachable` from `scripts/config.mjs`.

- [ ] **Step 1: Write the QC script**

Cover, against the deployed worker (gate the whole email surface on a 404 capability probe of `GET /api/email/instructions` — or `/api/admin/email/instructions` if mounted there — so the production pre-merge run reports pending rather than failing):
- `PUT /api/email/instructions` with `{ markdown, html }` then `GET` returns the same markdown and a sanitized html (assert a `<script>` in the input html is gone from the output — proves sanitize).
- `resolve_recipient` (via `GET /resolve-recipient?email=nancy@pietrafina.com`) returns `ok:true` with that address; an unknown `?store=NoSuchStore` returns `ok:false, reason:"no_match"`.
- If a known showroom store with an email contact exists, `?store=<name>` resolves it; report pending if the fixture is absent rather than failing.

Model structure on an existing QC script (e.g. `scripts/qc/pr_374.mjs`): `createChecks`, `assertReachable`, the 404 capability gate, `checks.finish()`.

- [ ] **Step 2: Run against preview and production**

```bash
pnpm run deploy:preview
# poll /api/health to 200, then:
node scripts/qc/pr_<N>.mjs --preview
node scripts/qc/pr_<N>.mjs            # production regression guard (email surface pending pre-merge)
```

- [ ] **Step 3: Changelog**

Add the branch row + entry + `PhaseDetail` (with the `verification` block holding the real QC output) to `changelog.ts` / `changelog-detail.ts` keyed `vendor-email-context-layer`, and push the rows to D1 (`POST /api/changelog/branches` + `/entries`). Open the PR with `Changelog: https://core-remodel.hacolby.workers.dev/admin/changelog/vendor-email-context-layer` in the body, and a note that the Gmail send/attach/schedule mechanics live on the google-workspace-mcp worker (out of scope here).

- [ ] **Step 4: Commit**

```bash
git add scripts/qc/pr_<N>.mjs src/frontend/data/
git commit -m "test(email): QC for the vendor-email context layer + changelog"
```

---

## Self-review

**Spec coverage:** §3.1 instructions → Tasks 1, 3, 5. §3.2 recipient resolution → Task 2. §3.3 compose-context tool → Task 4. §3.4 MCP email domain → Tasks 2-4 (registration in Task 2). §4 schema → Task 1. §6 testing → Tasks 2, 4 (unit) + Task 6 (QC). No send path is built — correct, it is out of scope (spec §2).

**Placeholder scan:** the one intentional `<N>` in Task 6 is the PR number, filled when the PR is opened (documented). No TBD/TODO. The `defineTool` shape carries a "confirm against list_rooms.ts" note because the exact field names must match the repo's real `defineTool` signature, which the implementer verifies rather than trusting the plan's sketch.

**Type consistency:** `resolveRecipient` / `ResolveResult` / `ResolvedRecipient` (Task 2) used by Task 4; `getInstructions` / `upsertInstructions` (Task 3) used by Tasks 4 (get) and 5 (via API); `suggestDispositions` / `GMAIL_ATTACH_BUDGET_BYTES` (Task 4) match their test. `emailTools` grows across Tasks 2-4; each task appends to the same `tools/email/index.ts` array.

**Known correction for the implementer:** if the real `defineTool` / `ctx` shape (field names, the handler's `ctx.env` / `ctx.input` access) differs from the sketches here, the existing tools (`list_rooms.ts`, `update_room.ts`) are the source of truth — match them, not the sketch. Likewise confirm the exact drizzle export names (`showroomStores`, `showroomStoreContacts`, `driveDocuments`, `emailInstructions`) against `@backend/db` before importing.
