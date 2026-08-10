# Drive Ingestion Service (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable service that ingests any Google Drive folder into D1 — `ingestDriveFolder(env, { rootId })` — with content hashing, rename/move revision tracking, delete marking, sharing state, per-root exclusions, and a daily cron that records its work in the existing `agent_runs` ledger.

**Architecture:** A Drive v3 REST client (no SDK — Workers-native `fetch`) walks a root recursively, skipping excluded subtrees during descent. The walk produces a flat node list; a pure classifier diffs that list against D1 and emits create/supersede/delete/unchanged actions; a writer applies them in chunked `db.batch()` calls. The cron opens one `agent_runs` run with one step per root. No email or embedding logic — those are PR 2 and PR 3.

**Tech Stack:** Cloudflare Workers, Hono, Drizzle ORM + D1, Google Drive REST v3 via service-account JWT (domain-wide delegation), `node:assert` self-check tests run with `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-08-08-drive-ingestion-and-vendor-email-design.md` (Option B approved).

## Global Constraints

- **Never `db.transaction()`.** D1 rejects SQL `BEGIN` (error 7500) and the drizzle D1 driver throws on the first statement. Use `db.batch([...])`.
- **Chunk every multi-row write at 20 rows.** D1 rejects any statement over 100 bound parameters (`too many SQL variables`). Applies to `inArray()` lists too.
- **No denormalized `*_name` columns.** Relate by integer FK, JOIN for display names.
- **Never import `drizzle-zod`** — it breaks `pnpm run build` on the pinned `drizzle-orm@0.33.0`. Hand-write Zod v4 schemas.
- **Migrations:** `pnpm run db:generate` then `pnpm run migrate:remote`. Never raw SQL, never hand-edit a migration.
- **Typecheck manually:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — the build is esbuild and does not type-check. There is a large pre-existing error baseline; compare before/after, never absolute counts.
- **Format only files you touched:** `npx oxfmt <paths>`. A repo-wide `pnpm run fmt` rewrites thousands of files.
- **Schema folder is `google-drive/`, NOT `drives/`.** `src/backend/db/schema/drives/` already exists and means *driving routes* (Tesla drive lists). Same for the MCP `drives` tool domain. Do not collide.
- **Tests are plain `node:assert` scripts**, no framework: `npx tsx <file>.test.ts`, exits non-zero on first failure. Follow `src/backend/services/gmail/ingest-gate-domains.test.ts`.
- **Drive root ids:** onboarding `1ZUJ_taFjsdWUusVZtng8ZzUAX5BFVMxU` (use case `EMAIL_ONBOARDING_MATERIALS`), research `17R5yV2LnFpsYcjSacIdkHNwZDlpgdjs1` (use case `DEEP_RESEARCH_FINDINGS`).

---

### Task 1: Prove the service account can reach Drive

Nothing else in this plan is safe to build until this passes. `src/backend/services/gmail/auth.ts` requests four Gmail scopes; a scope that is not delegated makes Google reject the **whole** JWT exchange with `unauthorized_client`, so an undelegated Drive scope means *every Gmail call in the repo fails*, not just Drive. This task confirms the delegation on a **preview worker**, where the blast radius is the preview alone.

**Files:**
- Modify: `src/backend/services/gmail/auth.ts` (scope list + a documented export)
- Create: `src/backend/api/routes/admin/drive-auth-probe.ts`
- Modify: `src/backend/api/index.ts` (mount the probe route)

**Interfaces:**
- Consumes: `getGmailAccessToken(env, impersonate = "justin@126colby.com")` from `services/gmail/auth.ts` (existing — note the name is `getGmailAccessToken`, NOT `getAccessToken`, and the impersonation arg has a default; there is no `GMAIL_IMPERSONATE_EMAIL` binding).
- Produces: `GOOGLE_SCOPES: string[]` exported from `auth.ts`; `GET /api/admin/drive-auth-probe` returning `{ ok: boolean, scopeGranted: boolean, folder?: {id,name}, error?: string }`.

- [ ] **Step 1: Add the Drive scope to the requested set**

In `src/backend/services/gmail/auth.ts`, replace the `GMAIL_SCOPES` const with:

```ts
/**
 * Requested scopes. These MUST be a subset of what the service account's client
 * id is granted under Workspace Admin → Security → API controls → Domain-wide
 * delegation. Google rejects the whole JWT-bearer exchange with
 * `unauthorized_client` if even one requested scope is not delegated — there is
 * no partial grant, so an unlisted scope means no token and every Gmail call
 * fails, not just the one needing that scope.
 *
 * `drive.readonly` was added for the Drive ingestion service. It covers file
 * metadata, content download/export, AND the `permissions[]` array the sharing
 * derivation needs. The full `drive` scope is deliberately NOT requested — the
 * organize/rename tools that would need it are out of scope here.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/drive.readonly",
];

const GMAIL_SCOPES = GOOGLE_SCOPES.join(" ");
```

- [ ] **Step 2: Add the probe route**

Create `src/backend/api/routes/admin/drive-auth-probe.ts`:

```ts
/**
 * @fileoverview One-shot check that domain-wide delegation actually covers
 * Drive. Deliberately hits BOTH a token mint and a real Drive read, because a
 * token can be issued and the API still refuse.
 *
 * Run this on a PREVIEW worker before trusting the scope change in production:
 * if Drive is not delegated, the token exchange fails and every Gmail call on
 * that worker fails with it.
 */
import { Hono } from "hono";

import { getGmailAccessToken } from "../../../services/gmail/auth";

const ONBOARDING_ROOT = "1ZUJ_taFjsdWUusVZtng8ZzUAX5BFVMxU";

export const driveAuthProbeRouter = new Hono<{ Bindings: Env }>();

driveAuthProbeRouter.get("/", async (c) => {
  try {
    // getGmailAccessToken defaults to justin@126colby.com; the SA impersonates
    // that user via domain-wide delegation.
    const token = await getGmailAccessToken(c.env);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${ONBOARDING_ROOT}` +
        `?fields=id,name,mimeType&supportsAllDrives=true`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = await res.text();
    if (!res.ok) {
      return c.json({ ok: false, scopeGranted: true, error: `drive ${res.status}: ${body}` });
    }
    return c.json({ ok: true, scopeGranted: true, folder: JSON.parse(body) });
  } catch (err) {
    return c.json({
      ok: false,
      scopeGranted: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
```

Mount it in `src/backend/api/index.ts` alongside the other admin routers:

```ts
import { driveAuthProbeRouter } from "./routes/admin/drive-auth-probe";
// ...
app.route("/api/admin/drive-auth-probe", driveAuthProbeRouter);
```

- [ ] **Step 3: Typecheck**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep -E "auth\.ts|drive-auth-probe"
```
Expected: no output.

- [ ] **Step 4: Deploy a preview and probe it**

```bash
pnpm run deploy:preview
# wait for propagation — a fresh preview 404s for ~30s before it serves
BASE=$(pnpm run preview:list 2>/dev/null | grep -o 'https://wcrp-[a-z0-9-]*\.hacolby\.workers\.dev' | head -1)
until [ "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/health)" = "200" ]; do sleep 15; done
curl -s "$BASE/api/admin/drive-auth-probe" \
  -H "cookie: $(node -e 'import("./scripts/config.mjs").then(m=>console.log(m.accessCookie()))')"
```

Expected on success:
```json
{"ok":true,"scopeGranted":true,"folder":{"id":"1ZUJ_taFjsdWUusVZtng8ZzUAX5BFVMxU","name":"...","mimeType":"application/vnd.google-apps.folder"}}
```

**STOP if `scopeGranted` is false.** That means `drive.readonly` is not in the domain-wide delegation list. Do not proceed and do not deploy to production — revert the scope change, report to the user, and wait. The fix is either a Workspace Admin change (add the scope to the SA's client id) or a second Drive-only service account. Also confirm `/api/gmail/...` still works on the preview before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/gmail/auth.ts src/backend/api/routes/admin/drive-auth-probe.ts src/backend/api/index.ts
git commit -m "feat(drive): request drive.readonly and add a delegation probe

A non-delegated scope makes Google reject the entire JWT exchange, so an
unlisted Drive scope would break every Gmail call in the repo, not just
Drive. The probe mints a token AND performs a real Drive read, and is
meant to be run against a preview worker before production sees this."
```

---

### Task 2: Drive REST client — recursive walk + sharing derivation

**Files:**
- Create: `src/backend/services/google/drive.ts`
- Create: `src/backend/services/google/drive.test.ts`

**Interfaces:**
- Consumes: `getGmailAccessToken(env)` from `services/gmail/auth.ts`.
- Produces:
  - `type DriveSharing = "ANYONE" | "ANYONE_WITH_LINK" | "DOMAIN" | "DOMAIN_WITH_LINK" | "PRIVATE"`
  - `deriveSharing(permissions: DrivePermission[] | undefined): DriveSharing`
  - `interface DriveNode { driveId, name, mimeType, parentDriveId, sizeBytes, md5Checksum, webViewUrl, sharing, modifiedAt, createdAt, isFolder }`
  - `listFolderRecursive(env, rootDriveId, opts: { excludedFolderIds: Set<string>; excludedMimePatterns: string[] }): Promise<DriveNode[]>`
  - `exportFileText(env, driveId, mimeType): Promise<string | null>` (used by PR 3; defined here so the client owns all Drive I/O)

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/google/drive.test.ts`:

```ts
/**
 * Runnable self-check for the Drive client's pure helpers. No framework:
 *   npx tsx src/backend/services/google/drive.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import { deriveSharing, isExcluded } from "./drive";

// ── deriveSharing: the Apps Script Access enum is NOT returned by Drive v3.
// It has to be derived from permissions[] + allowFileDiscovery. ──────────────
assert.equal(deriveSharing(undefined), "PRIVATE");
assert.equal(deriveSharing([]), "PRIVATE");
assert.equal(deriveSharing([{ type: "user", role: "owner" }]), "PRIVATE");

assert.equal(deriveSharing([{ type: "anyone", role: "reader", allowFileDiscovery: true }]), "ANYONE");
assert.equal(
  deriveSharing([{ type: "anyone", role: "reader", allowFileDiscovery: false }]),
  "ANYONE_WITH_LINK",
);
// Drive omits allowFileDiscovery when it is false — absent must NOT read as true.
assert.equal(deriveSharing([{ type: "anyone", role: "reader" }]), "ANYONE_WITH_LINK");

assert.equal(deriveSharing([{ type: "domain", role: "reader", allowFileDiscovery: true }]), "DOMAIN");
assert.equal(
  deriveSharing([{ type: "domain", role: "reader", allowFileDiscovery: false }]),
  "DOMAIN_WITH_LINK",
);

// anyone outranks domain when both are present — it is strictly more open.
assert.equal(
  deriveSharing([
    { type: "domain", role: "reader", allowFileDiscovery: true },
    { type: "anyone", role: "reader", allowFileDiscovery: false },
  ]),
  "ANYONE_WITH_LINK",
);

// ── isExcluded ──────────────────────────────────────────────────────────────
const opts = {
  excludedFolderIds: new Set(["FOLDER_A"]),
  excludedMimePatterns: ["application/vnd.google-apps.script", "video/*"],
};
assert.equal(isExcluded({ driveId: "FOLDER_A", mimeType: "application/vnd.google-apps.folder" }, opts), true);
assert.equal(isExcluded({ driveId: "FOLDER_B", mimeType: "application/vnd.google-apps.folder" }, opts), false);
assert.equal(isExcluded({ driveId: "X", mimeType: "application/vnd.google-apps.script" }, opts), true);
assert.equal(isExcluded({ driveId: "X", mimeType: "video/mp4" }, opts), true);
assert.equal(isExcluded({ driveId: "X", mimeType: "image/jpeg" }, opts), false);

console.log("drive.test.ts: all assertions passed");
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx tsx src/backend/services/google/drive.test.ts
```
Expected: FAIL — `Cannot find module './drive'`.

- [ ] **Step 3: Implement the client**

Create `src/backend/services/google/drive.ts`:

```ts
/**
 * @fileoverview Google Drive v3 client — the only place this repo talks to
 * Drive. Plain `fetch`; no SDK (googleapis does not run on Workers).
 *
 * Auth reuses the Gmail service-account JWT with domain-wide delegation, so the
 * `drive.readonly` scope must be delegated to the SA's client id — see
 * `services/gmail/auth.ts` and the delegation probe route.
 */
import { getGmailAccessToken } from "../gmail/auth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** Mirrors the Apps Script `Access` enum, derived from Drive v3 permissions. */
export type DriveSharing =
  | "ANYONE"
  | "ANYONE_WITH_LINK"
  | "DOMAIN"
  | "DOMAIN_WITH_LINK"
  | "PRIVATE";

export interface DrivePermission {
  type: string;
  role?: string;
  /** Drive OMITS this key when it is false — treat absent as false. */
  allowFileDiscovery?: boolean;
}

export interface DriveNode {
  driveId: string;
  name: string;
  mimeType: string;
  /** Drive id of the containing folder; null only for the scanned root. */
  parentDriveId: string | null;
  /** Absent for Google-native files (Docs/Sheets/Slides) — they have no size. */
  sizeBytes: number | null;
  /** Absent for Google-native files — they have no md5. See the hash fallback. */
  md5Checksum: string | null;
  webViewUrl: string;
  sharing: DriveSharing;
  modifiedAt: Date | null;
  createdAt: Date | null;
  isFolder: boolean;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Derive the sharing level from Drive's `permissions[]`.
 *
 * Drive v3 has no single "access level" field — it returns the permission list
 * and leaves the interpretation to the caller. `anyone` outranks `domain`
 * because it is strictly more open, and a MISSING `allowFileDiscovery` means
 * false (Drive omits false), so it must not be read as discoverable.
 */
export function deriveSharing(permissions: DrivePermission[] | undefined): DriveSharing {
  if (!permissions?.length) return "PRIVATE";
  const anyone = permissions.find((p) => p.type === "anyone");
  if (anyone) return anyone.allowFileDiscovery === true ? "ANYONE" : "ANYONE_WITH_LINK";
  const domain = permissions.find((p) => p.type === "domain");
  if (domain) return domain.allowFileDiscovery === true ? "DOMAIN" : "DOMAIN_WITH_LINK";
  return "PRIVATE";
}

export interface ExclusionOpts {
  excludedFolderIds: Set<string>;
  excludedMimePatterns: string[];
}

/** True when a node is excluded by folder id or by a `type/*`-style mime pattern. */
export function isExcluded(
  node: { driveId: string; mimeType: string },
  opts: ExclusionOpts,
): boolean {
  if (opts.excludedFolderIds.has(node.driveId)) return true;
  return opts.excludedMimePatterns.some((pattern) =>
    pattern.endsWith("/*")
      ? node.mimeType.startsWith(pattern.slice(0, -1))
      : node.mimeType === pattern,
  );
}

const FIELDS =
  "nextPageToken,files(id,name,mimeType,parents,size,md5Checksum," +
  "modifiedTime,createdTime,webViewLink,trashed,permissions(type,role,allowFileDiscovery))";

async function driveFetch(env: Env, path: string): Promise<Response> {
  const token = await getGmailAccessToken(env);
  const res = await fetch(`${DRIVE_API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`drive: ${res.status} ${path} — ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

function toNode(raw: Record<string, any>, parentDriveId: string | null): DriveNode {
  return {
    driveId: raw.id,
    name: raw.name,
    mimeType: raw.mimeType,
    parentDriveId,
    sizeBytes: raw.size != null ? Number(raw.size) : null,
    md5Checksum: raw.md5Checksum ?? null,
    webViewUrl: raw.webViewLink ?? "",
    sharing: deriveSharing(raw.permissions),
    modifiedAt: raw.modifiedTime ? new Date(raw.modifiedTime) : null,
    createdAt: raw.createdTime ? new Date(raw.createdTime) : null,
    isFolder: raw.mimeType === FOLDER_MIME,
  };
}

/** One page-through of a folder's direct children. */
async function listChildren(env: Env, folderId: string): Promise<DriveNode[]> {
  const out: DriveNode[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: FIELDS,
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const body = (await (await driveFetch(env, `/files?${params}`)).json()) as {
      files?: Record<string, any>[];
      nextPageToken?: string;
    };
    for (const raw of body.files ?? []) out.push(toNode(raw, folderId));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Walk a root recursively, breadth-first.
 *
 * Exclusions are applied DURING descent, so an excluded subtree costs one
 * membership check rather than a full traversal. That is the difference
 * between one check and thousands of API reads on a log folder.
 */
export async function listFolderRecursive(
  env: Env,
  rootDriveId: string,
  opts: ExclusionOpts,
): Promise<DriveNode[]> {
  const all: DriveNode[] = [];
  const queue: string[] = [rootDriveId];
  const seenFolders = new Set<string>([rootDriveId]);

  while (queue.length > 0) {
    const folderId = queue.shift() as string;
    for (const node of await listChildren(env, folderId)) {
      if (isExcluded(node, opts)) continue;
      all.push(node);
      if (node.isFolder && !seenFolders.has(node.driveId)) {
        seenFolders.add(node.driveId);
        queue.push(node.driveId);
      }
    }
  }
  return all;
}

/** Google-native export mime for text extraction. Null = not exportable. */
function exportMimeFor(mimeType: string): string | null {
  if (mimeType === "application/vnd.google-apps.document") return "text/plain";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "text/csv";
  if (mimeType === "application/vnd.google-apps.presentation") return "text/plain";
  return null;
}

/**
 * Text for a file: exported for Google-native types, downloaded for text/html.
 * Returns null for anything binary — PDFs go through `env.AI.toMarkdown()` in
 * PR 3, not here (`@llamaindex/liteparse` is native-only and cannot run on
 * Workers).
 */
export async function exportFileText(
  env: Env,
  driveId: string,
  mimeType: string,
): Promise<string | null> {
  const exportMime = exportMimeFor(mimeType);
  if (exportMime) {
    const res = await driveFetch(
      env,
      `/files/${driveId}/export?mimeType=${encodeURIComponent(exportMime)}`,
    );
    return res.text();
  }
  if (mimeType.startsWith("text/")) {
    return (await driveFetch(env, `/files/${driveId}?alt=media&supportsAllDrives=true`)).text();
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx src/backend/services/google/drive.test.ts
```
Expected: `drive.test.ts: all assertions passed`, exit 0.

- [ ] **Step 5: Format, typecheck, commit**

```bash
npx oxfmt src/backend/services/google/drive.ts src/backend/services/google/drive.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep "google/drive"
git add src/backend/services/google/drive.ts src/backend/services/google/drive.test.ts
git commit -m "feat(drive): Drive v3 client with recursive walk and sharing derivation

Drive v3 returns no access-level field, so ANYONE / ANYONE_WITH_LINK /
DOMAIN / DOMAIN_WITH_LINK / PRIVATE are derived from permissions[].
allowFileDiscovery is OMITTED when false, so absent must read as false —
that asymmetry is the whole reason this has a unit test.

Exclusions are applied during descent so an excluded subtree costs one
membership check instead of thousands of API reads."
```

---

### Task 3: Schema + migration

**Files:**
- Create: `src/backend/db/schema/google-drive/drive_use_cases.ts`
- Create: `src/backend/db/schema/google-drive/drive_roots.ts`
- Create: `src/backend/db/schema/google-drive/drive_root_exclusions.ts`
- Create: `src/backend/db/schema/google-drive/drive_folders.ts`
- Create: `src/backend/db/schema/google-drive/drive_documents.ts`
- Create: `src/backend/db/schema/google-drive/drive_document_links.ts`
- Create: `src/backend/db/schema/google-drive/index.ts`
- Modify: `src/backend/db/schema/index.ts` (add the barrel export)

**Interfaces:**
- Consumes: `supportingDocuments` from `../documents/supporting_documents` (bridge FK only).
- Produces: drizzle tables `driveUseCases`, `driveRoots`, `driveRootExclusions`, `driveFolders`, `driveDocuments`, `driveDocumentLinks`, and the type `DriveSharing` re-exported from the service.

- [ ] **Step 1: Create the definition + root tables**

`src/backend/db/schema/google-drive/drive_use_cases.ts`:

```ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * What an ingested Drive root is FOR. Config-driven definition table per
 * AGENTS.md, so the UI and API can list and describe use cases without a
 * deploy.
 *
 * `key` is the stable join to a CODE-side processor registry: a use case
 * selects which downstream pipeline runs, and a database row alone cannot add
 * a code path. Adding a use case = one row here + one registry entry.
 */
export const driveUseCases = sqliteTable("drive_use_cases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** EMAIL_ONBOARDING_MATERIALS | DEEP_RESEARCH_FINDINGS */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
```

`src/backend/db/schema/google-drive/drive_roots.ts`:

```ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { driveUseCases } from "./drive_use_cases";

/** One scanned Drive folder tree. Add a root = insert a row; no code change. */
export const driveRoots = sqliteTable("drive_roots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Google's own folder id for the root of the tree. */
  driveFolderId: text("drive_folder_id").notNull().unique(),
  label: text("label").notNull(),
  useCaseId: integer("use_case_id")
    .notNull()
    .references(() => driveUseCases.id),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastScannedAt: integer("last_scanned_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
```

`src/backend/db/schema/google-drive/drive_root_exclusions.ts`:

```ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { driveRoots } from "./drive_roots";

/**
 * Subtrees and mime types a root's scan must skip.
 *
 * This is load-bearing, not a nicety: a sibling of the research root holds
 * ~5,000 machine-generated processing logs in one subfolder. Ingesting that
 * would fill D1 with debug output and, in PR 3, embed all of it. Exclusions
 * are applied during descent so an excluded subtree is never traversed.
 */
export const driveRootExclusions = sqliteTable(
  "drive_root_exclusions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    rootId: integer("root_id")
      .notNull()
      .references(() => driveRoots.id, { onDelete: "cascade" }),
    /** 'folder' (value = a Drive folder id) | 'mime' (value = 'video/*' etc). */
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    /** Why this is excluded — for the next reader, not for the code. */
    reason: text("reason"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    exclusionUnique: uniqueIndex("drive_root_exclusion_unique").on(t.rootId, t.kind, t.value),
  }),
);
```

- [ ] **Step 2: Create the folder + document tables**

`src/backend/db/schema/google-drive/drive_folders.ts`:

```ts
import { sql } from "drizzle-orm";
import { AnySQLiteColumn, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { driveRoots } from "./drive_roots";

/**
 * One folder in an ingested tree — ONE table for every use case.
 *
 * Two independent flags, deliberately not merged:
 *   isActive=false  → superseded by a rename or move; a NEW row carries the
 *                     current state and `supersededById` links them.
 *   isDeleted=true  → gone from Drive. Rows are never hard-deleted.
 * A folder can be superseded without being deleted, and deleted without ever
 * having been superseded. Conflating them loses "this moved" vs "this is gone".
 *
 * The display name lives here and NOWHERE else — children reference this row by
 * id and JOIN for the name.
 */
export const driveFolders = sqliteTable(
  "drive_folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    driveId: text("drive_id").notNull(),
    rootId: integer("root_id")
      .notNull()
      .references(() => driveRoots.id, { onDelete: "cascade" }),
    /** Self-FK. NULL only for the scanned root itself. */
    parentFolderId: integer("parent_folder_id").references((): AnySQLiteColumn => driveFolders.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    webViewUrl: text("web_view_url").notNull(),
    /** ANYONE | ANYONE_WITH_LINK | DOMAIN | DOMAIN_WITH_LINK | PRIVATE */
    sharing: text("sharing").notNull().default("PRIVATE"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    supersededById: integer("superseded_by_id").references(
      (): AnySQLiteColumn => driveFolders.id,
      { onDelete: "set null" },
    ),
    driveModifiedAt: integer("drive_modified_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byRootActive: index("drive_folders_root_active_idx").on(t.rootId, t.isActive),
    byDriveId: index("drive_folders_drive_id_idx").on(t.driveId),
  }),
);
```

`src/backend/db/schema/google-drive/drive_documents.ts`:

```ts
import { sql } from "drizzle-orm";
import { AnySQLiteColumn, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { driveFolders } from "./drive_folders";
import { driveRoots } from "./drive_roots";

/**
 * One file in an ingested tree — ONE table for every use case.
 *
 * DELIBERATELY SEPARATE from `supporting_documents`. That table means records
 * about specific purchased things (owner's manuals, tech sheets, signed
 * contracts, drawings) tied to a product, room or scenario. Drive material is
 * high-level and changes on a different clock. Keeping the boundary in the
 * schema beats a `tier` column every future query has to remember to filter.
 * The rare Drive file that IS such a record is linked via
 * `drive_document_links`.
 *
 * Extraction columns are populated by PR 3, not by the ingestion service.
 */
export const driveDocuments = sqliteTable(
  "drive_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    driveId: text("drive_id").notNull(),
    rootId: integer("root_id")
      .notNull()
      .references(() => driveRoots.id, { onDelete: "cascade" }),
    folderId: integer("folder_id")
      .notNull()
      .references(() => driveFolders.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    /** NULL for Google-native files — Drive reports no size for them. */
    sizeBytes: integer("size_bytes"),

    /**
     * Change-detection hash. Drive's md5 for binaries; for Google-native files
     * Drive returns NO md5Checksum, so this is a sha-256 of the exported text.
     * `hashSource` records which, so a hash is never compared across kinds.
     */
    contentHash: text("content_hash").notNull(),
    /** 'drive_md5' | 'exported_text' | 'metadata' */
    hashSource: text("hash_source").notNull(),

    webViewUrl: text("web_view_url").notNull(),
    sharing: text("sharing").notNull().default("PRIVATE"),
    driveModifiedAt: integer("drive_modified_at", { mode: "timestamp" }),
    driveCreatedAt: integer("drive_created_at", { mode: "timestamp" }),

    /** ── PR 3 (research indexing) populates these. ── */
    extractedText: text("extracted_text"),
    /** pending | processing | complete | failed | skipped */
    extractionStatus: text("extraction_status").notNull().default("pending"),
    extractionError: text("extraction_error"),
    /** Vectorize id. Vectorize caps ids at 64 bytes. */
    ragUuid: text("rag_uuid"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    supersededById: integer("superseded_by_id").references(
      (): AnySQLiteColumn => driveDocuments.id,
      { onDelete: "set null" },
    ),
    revisionNumber: integer("revision_number").notNull().default(1),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byRootActive: index("drive_documents_root_active_idx").on(t.rootId, t.isActive),
    byFolder: index("drive_documents_folder_idx").on(t.folderId),
    byDriveId: index("drive_documents_drive_id_idx").on(t.driveId),
    byHash: index("drive_documents_content_hash_idx").on(t.contentHash),
  }),
);
```

`src/backend/db/schema/google-drive/drive_document_links.ts`:

```ts
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { supportingDocuments } from "../documents/supporting_documents";
import { driveDocuments } from "./drive_documents";

/**
 * Bridge for the rare Drive file that IS a micro-level record — a signed
 * contract or tech sheet that happens to live in Drive. Keeps `drive_documents`
 * from being a silo without collapsing the two libraries into one table.
 */
export const driveDocumentLinks = sqliteTable(
  "drive_document_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    driveDocumentId: integer("drive_document_id")
      .notNull()
      .references(() => driveDocuments.id, { onDelete: "cascade" }),
    supportingDocumentId: text("supporting_document_id")
      .notNull()
      .references(() => supportingDocuments.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    linkUnique: uniqueIndex("drive_document_link_unique").on(
      t.driveDocumentId,
      t.supportingDocumentId,
    ),
  }),
);
```

- [ ] **Step 2b: Barrels**

`src/backend/db/schema/google-drive/index.ts`:

```ts
export * from "./drive_use_cases";
export * from "./drive_roots";
export * from "./drive_root_exclusions";
export * from "./drive_folders";
export * from "./drive_documents";
export * from "./drive_document_links";
```

Append to `src/backend/db/schema/index.ts`:

```ts
// Google Drive ingestion (PR 1) — roots, folders, documents. NOTE: distinct
// from ./drives/index, which is DRIVING routes (Tesla drive lists).
export * from "./google-drive/index";
```

- [ ] **Step 3: Generate the migration and read it**

```bash
pnpm run db:generate
git status --short drizzle/
```

Open the generated `.sql` and confirm it contains **only** `CREATE TABLE` for the six new tables plus their indexes. If it re-emits tables that already exist, the drizzle meta snapshot is behind — strip the non-delta statements before applying. Do not hand-edit anything else.

- [ ] **Step 4: Apply to remote and verify**

```bash
pnpm run migrate:remote
npx wrangler d1 execute core-remodel --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'drive_%' ORDER BY name"
```
Expected rows include: `drive_document_links`, `drive_documents`, `drive_folders`, `drive_root_exclusions`, `drive_roots`, `drive_use_cases` (plus the pre-existing `drive_lists`, `drive_list_notes`, `drive_list_stops` from the driving-routes feature — those are unrelated and must be untouched).

- [ ] **Step 5: Typecheck and commit**

```bash
npx oxfmt src/backend/db/schema/google-drive/*.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep "google-drive"
git add src/backend/db/schema/google-drive src/backend/db/schema/index.ts drizzle/
git commit -m "feat(drive): schema for Drive roots, folders and documents

drive_documents is deliberately separate from supporting_documents:
that table means records about specific purchased things, tied to a
product/room/scenario. Drive material is high-level and changes on a
different clock. drive_document_links bridges the rare file that is both.

isActive (superseded by rename/move) and isDeleted (gone from Drive) are
separate flags on purpose — conflating them loses 'this moved' vs
'this is gone'."
```

---

### Task 4: Change classifier (pure function)

The riskiest logic in the PR, and the only part that can be tested without network or D1. Written as a pure function over two plain lists so it can be.

**Files:**
- Create: `src/backend/services/google/drive-diff.ts`
- Create: `src/backend/services/google/drive-diff.test.ts`

**Interfaces:**
- Consumes: `DriveNode` from `./drive`.
- Produces:
  - `interface ExistingRow { id: number; driveId: string; folderDriveId: string | null; name: string; contentHash: string }`
  - `type DiffAction = { kind: "create"; node: DriveNode } | { kind: "supersede"; existingId: number; node: DriveNode } | { kind: "delete"; existingId: number } | { kind: "unchanged"; existingId: number }`
  - `diffNodes(live: DriveNode[], existing: ExistingRow[], hashOf: (n: DriveNode) => string): DiffAction[]`

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/google/drive-diff.test.ts`:

```ts
/**
 * Runnable self-check for the Drive diff classifier. No framework:
 *   npx tsx src/backend/services/google/drive-diff.test.ts
 */
import assert from "node:assert/strict";

import { diffNodes, type ExistingRow } from "./drive-diff";
import type { DriveNode } from "./drive";

function node(over: Partial<DriveNode> & { driveId: string }): DriveNode {
  return {
    name: "file.pdf",
    mimeType: "application/pdf",
    parentDriveId: "FOLDER_1",
    sizeBytes: 100,
    md5Checksum: "abc",
    webViewUrl: "https://drive/x",
    sharing: "PRIVATE",
    modifiedAt: null,
    createdAt: null,
    isFolder: false,
    ...over,
  };
}
const hashOf = (n: DriveNode) => n.md5Checksum ?? "nohash";
const row = (o: Partial<ExistingRow> & { id: number; driveId: string }): ExistingRow => ({
  folderDriveId: "FOLDER_1",
  name: "file.pdf",
  contentHash: "abc",
  ...o,
});

// New file → create
assert.deepEqual(diffNodes([node({ driveId: "A" })], [], hashOf), [
  { kind: "create", node: node({ driveId: "A" }) },
]);

// Identical → unchanged
assert.deepEqual(
  diffNodes([node({ driveId: "A" })], [row({ id: 1, driveId: "A" })], hashOf),
  [{ kind: "unchanged", existingId: 1 }],
);

// Renamed → supersede
{
  const live = node({ driveId: "A", name: "renamed.pdf" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A" })], hashOf), [
    { kind: "supersede", existingId: 1, node: live },
  ]);
}

// Moved to another folder → supersede
{
  const live = node({ driveId: "A", parentDriveId: "FOLDER_2" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A" })], hashOf), [
    { kind: "supersede", existingId: 1, node: live },
  ]);
}

// Content changed → supersede
{
  const live = node({ driveId: "A", md5Checksum: "zzz" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A" })], hashOf), [
    { kind: "supersede", existingId: 1, node: live },
  ]);
}

// Gone from Drive → delete
assert.deepEqual(diffNodes([], [row({ id: 1, driveId: "A" })], hashOf), [
  { kind: "delete", existingId: 1 },
]);

// Two files with identical content are NOT deduped — they are distinct rows.
// (The 6 duplicate "Luxury Workstation Sink Market Analysis" Docs are real
// separate files; equal hashes must not collapse them.)
{
  const actions = diffNodes(
    [node({ driveId: "A" }), node({ driveId: "B" })],
    [],
    hashOf,
  );
  assert.equal(actions.length, 2);
  assert.equal(actions.every((a) => a.kind === "create"), true);
}

console.log("drive-diff.test.ts: all assertions passed");
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx tsx src/backend/services/google/drive-diff.test.ts
```
Expected: FAIL — `Cannot find module './drive-diff'`.

- [ ] **Step 3: Implement**

Create `src/backend/services/google/drive-diff.ts`:

```ts
/**
 * @fileoverview Pure classifier: what changed between Drive and D1.
 *
 * Kept free of network and database access so the interesting cases — rename,
 * move, content change, delete — are unit-testable. The writer applies these
 * actions; it does not decide them.
 *
 * Identity is the Drive file id. Equal content hashes do NOT merge two files:
 * the research corpus genuinely contains six separate Docs with the same title
 * and near-identical content, and collapsing them would lose real rows.
 */
import type { DriveNode } from "./drive";

export interface ExistingRow {
  id: number;
  driveId: string;
  /** Drive id of the row's current parent folder; null for a root. */
  folderDriveId: string | null;
  name: string;
  contentHash: string;
}

export type DiffAction =
  | { kind: "create"; node: DriveNode }
  | { kind: "supersede"; existingId: number; node: DriveNode }
  | { kind: "delete"; existingId: number }
  | { kind: "unchanged"; existingId: number };

/**
 * @param live      every node currently in Drive under the root (post-exclusion)
 * @param existing  every ACTIVE, non-deleted row currently in D1 for that root
 * @param hashOf    content hash for a node — md5 for binaries, exported-text
 *                  sha-256 for Google-native files (Drive gives them no md5)
 */
export function diffNodes(
  live: DriveNode[],
  existing: ExistingRow[],
  hashOf: (node: DriveNode) => string,
): DiffAction[] {
  const byDriveId = new Map(existing.map((row) => [row.driveId, row]));
  const actions: DiffAction[] = [];
  const seen = new Set<string>();

  for (const node of live) {
    seen.add(node.driveId);
    const row = byDriveId.get(node.driveId);
    if (!row) {
      actions.push({ kind: "create", node });
      continue;
    }
    const changed =
      row.name !== node.name ||
      row.folderDriveId !== node.parentDriveId ||
      row.contentHash !== hashOf(node);
    actions.push(
      changed ? { kind: "supersede", existingId: row.id, node } : { kind: "unchanged", existingId: row.id },
    );
  }

  for (const row of existing) {
    if (!seen.has(row.driveId)) actions.push({ kind: "delete", existingId: row.id });
  }

  return actions;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx tsx src/backend/services/google/drive-diff.test.ts
```
Expected: `drive-diff.test.ts: all assertions passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
npx oxfmt src/backend/services/google/drive-diff.ts src/backend/services/google/drive-diff.test.ts
git add src/backend/services/google/drive-diff.ts src/backend/services/google/drive-diff.test.ts
git commit -m "feat(drive): pure change classifier for the ingestion diff

Rename, move, content change, delete and unchanged are decided by a pure
function over two lists so every case is unit-testable without network or
D1. Equal content hashes deliberately do NOT merge files — the research
corpus has six separate Docs with the same title."
```

---

### Task 5: The ingestion service

**Files:**
- Create: `src/backend/services/google/drive-ingest.ts`
- Modify: `src/backend/services/google/drive.ts` (export `contentHashFor`)

**Interfaces:**
- Consumes: `listFolderRecursive`, `exportFileText`, `DriveNode`, `FOLDER_MIME` from `./drive`; `diffNodes`, `ExistingRow` from `./drive-diff`; the tables from `db/schema/google-drive`.
- Produces:
  - `interface IngestSummary { rootId: number; label: string; seen: number; created: number; superseded: number; deleted: number; unchanged: number; errors: string[] }`
  - `ingestDriveFolder(env: Env, rootId: number): Promise<IngestSummary>`
  - `ingestAllActiveRoots(env: Env): Promise<IngestSummary[]>`

- [ ] **Step 1: Add the content-hash helper to the client**

Append to `src/backend/services/google/drive.ts`:

```ts
/**
 * Content hash for change detection, with its provenance.
 *
 * Binary files carry Drive's own md5. Google-native files (Docs/Sheets/Slides)
 * carry NO md5Checksum at all, so they are hashed over their exported text —
 * which is also what makes a pure-formatting edit a no-op. A file we can
 * neither checksum nor export falls back to metadata, which is weaker but
 * still detects the common case.
 */
export async function contentHashFor(
  env: Env,
  node: DriveNode,
): Promise<{ hash: string; source: "drive_md5" | "exported_text" | "metadata" }> {
  if (node.md5Checksum) return { hash: node.md5Checksum, source: "drive_md5" };

  const text = await exportFileText(env, node.driveId, node.mimeType).catch(() => null);
  if (text != null) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { hash: hex, source: "exported_text" };
  }

  return {
    hash: `${node.name}:${node.modifiedAt?.toISOString() ?? "?"}:${node.sizeBytes ?? "?"}`,
    source: "metadata",
  };
}
```

- [ ] **Step 2: Implement the service**

Create `src/backend/services/google/drive-ingest.ts`:

```ts
/**
 * @fileoverview Ingest one Drive root into D1.
 *
 * Generic on purpose: `ingestDriveFolder(env, rootId)` works for any root row,
 * so adding a folder is an INSERT, not a code change. The root's use case
 * decides which downstream pipeline (PR 2 email, PR 3 embeddings) consumes the
 * rows; this service is only responsible for the catalogue.
 *
 * D1 constraints shape every write here:
 *   - `db.transaction()` does not work on D1 (error 7500) — `db.batch()` only.
 *   - a statement caps at 100 bound parameters, so writes chunk at 20 rows.
 */
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  driveDocuments,
  driveFolders,
  driveRootExclusions,
  driveRoots,
} from "../../db/schema/google-drive/index";
import { contentHashFor, FOLDER_MIME, listFolderRecursive, type DriveNode } from "./drive";
import { diffNodes, type ExistingRow } from "./drive-diff";

/** D1 rejects a statement with >100 bound params; 20 rows is safe for these widths. */
const CHUNK = 20;

function chunk<T>(values: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export interface IngestSummary {
  rootId: number;
  label: string;
  seen: number;
  created: number;
  superseded: number;
  deleted: number;
  unchanged: number;
  errors: string[];
}

export async function ingestDriveFolder(env: Env, rootId: number): Promise<IngestSummary> {
  const db = drizzle(env.DB);

  const [root] = await db.select().from(driveRoots).where(eq(driveRoots.id, rootId)).limit(1);
  if (!root) throw new Error(`drive-ingest: no root ${rootId}`);

  const summary: IngestSummary = {
    rootId,
    label: root.label,
    seen: 0,
    created: 0,
    superseded: 0,
    deleted: 0,
    unchanged: 0,
    errors: [],
  };

  const exclusions = await db
    .select()
    .from(driveRootExclusions)
    .where(eq(driveRootExclusions.rootId, rootId));

  const nodes = await listFolderRecursive(env, root.driveFolderId, {
    excludedFolderIds: new Set(
      exclusions.filter((e) => e.kind === "folder").map((e) => e.value),
    ),
    excludedMimePatterns: exclusions.filter((e) => e.kind === "mime").map((e) => e.value),
  });
  summary.seen = nodes.length;

  // ── Folders first: documents need their folder row id as an FK. ───────────
  const liveFolders = nodes.filter((n) => n.isFolder);
  await syncFolders(db, root, liveFolders, summary);

  // Drive id -> D1 folder row id, for the document FKs. Includes the root.
  const folderRows = await db
    .select({ id: driveFolders.id, driveId: driveFolders.driveId })
    .from(driveFolders)
    .where(and(eq(driveFolders.rootId, rootId), eq(driveFolders.isActive, true)));
  const folderIdByDriveId = new Map(folderRows.map((f) => [f.driveId, f.id]));

  await syncDocuments(db, env, root, nodes.filter((n) => !n.isFolder), folderIdByDriveId, summary);

  await db
    .update(driveRoots)
    .set({ lastScannedAt: new Date(), updatedAt: new Date() })
    .where(eq(driveRoots.id, rootId));

  return summary;
}

async function syncFolders(
  db: ReturnType<typeof drizzle>,
  root: typeof driveRoots.$inferSelect,
  live: DriveNode[],
  summary: IngestSummary,
): Promise<void> {
  const existing = await db
    .select({
      id: driveFolders.id,
      driveId: driveFolders.driveId,
      name: driveFolders.name,
      parentFolderId: driveFolders.parentFolderId,
    })
    .from(driveFolders)
    .where(
      and(
        eq(driveFolders.rootId, root.id),
        eq(driveFolders.isActive, true),
        eq(driveFolders.isDeleted, false),
      ),
    );

  // Ensure the root itself has a row — documents directly under it need an FK.
  if (!existing.some((f) => f.driveId === root.driveFolderId)) {
    await db.insert(driveFolders).values({
      driveId: root.driveFolderId,
      rootId: root.id,
      parentFolderId: null,
      name: root.label,
      webViewUrl: `https://drive.google.com/drive/folders/${root.driveFolderId}`,
      sharing: "PRIVATE",
    });
  }

  const byDriveId = new Map(existing.map((f) => [f.driveId, f]));

  for (const part of chunk(live)) {
    const inserts: (typeof driveFolders.$inferInsert)[] = [];
    for (const node of part) {
      const row = byDriveId.get(node.driveId);
      if (!row) {
        inserts.push({
          driveId: node.driveId,
          rootId: root.id,
          parentFolderId: null, // linked in the reparent pass below
          name: node.name,
          webViewUrl: node.webViewUrl,
          sharing: node.sharing,
          driveModifiedAt: node.modifiedAt,
        });
        summary.created++;
      } else if (row.name !== node.name) {
        await db
          .update(driveFolders)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(driveFolders.id, row.id));
        inserts.push({
          driveId: node.driveId,
          rootId: root.id,
          parentFolderId: null,
          name: node.name,
          webViewUrl: node.webViewUrl,
          sharing: node.sharing,
          driveModifiedAt: node.modifiedAt,
        });
        summary.superseded++;
      } else {
        summary.unchanged++;
      }
    }
    if (inserts.length > 0) {
      const stmts = inserts.map((v) => db.insert(driveFolders).values(v));
      await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    }
  }

  // Reparent pass: parents are only resolvable once every folder row exists.
  const all = await db
    .select({ id: driveFolders.id, driveId: driveFolders.driveId })
    .from(driveFolders)
    .where(and(eq(driveFolders.rootId, root.id), eq(driveFolders.isActive, true)));
  const idByDriveId = new Map(all.map((f) => [f.driveId, f.id]));

  for (const node of live) {
    const selfId = idByDriveId.get(node.driveId);
    const parentId = node.parentDriveId ? idByDriveId.get(node.parentDriveId) : undefined;
    if (selfId && parentId) {
      await db
        .update(driveFolders)
        .set({ parentFolderId: parentId })
        .where(eq(driveFolders.id, selfId));
    }
  }

  // Folders gone from Drive.
  const liveIds = new Set(live.map((n) => n.driveId));
  const goneIds = existing.filter((f) => !liveIds.has(f.driveId) && f.driveId !== root.driveFolderId).map((f) => f.id);
  for (const part of chunk(goneIds)) {
    if (part.length === 0) continue;
    await db
      .update(driveFolders)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(inArray(driveFolders.id, part));
    summary.deleted += part.length;
  }
}

async function syncDocuments(
  db: ReturnType<typeof drizzle>,
  env: Env,
  root: typeof driveRoots.$inferSelect,
  live: DriveNode[],
  folderIdByDriveId: Map<string, number>,
  summary: IngestSummary,
): Promise<void> {
  const existingRows = await db
    .select({
      id: driveDocuments.id,
      driveId: driveDocuments.driveId,
      name: driveDocuments.name,
      contentHash: driveDocuments.contentHash,
      folderId: driveDocuments.folderId,
    })
    .from(driveDocuments)
    .where(
      and(
        eq(driveDocuments.rootId, root.id),
        eq(driveDocuments.isActive, true),
        eq(driveDocuments.isDeleted, false),
      ),
    );

  const folderDriveIdById = new Map([...folderIdByDriveId].map(([d, i]) => [i, d]));
  const existing: ExistingRow[] = existingRows.map((r) => ({
    id: r.id,
    driveId: r.driveId,
    name: r.name,
    contentHash: r.contentHash,
    folderDriveId: folderDriveIdById.get(r.folderId) ?? null,
  }));

  // Hash every live node up front so the diff stays pure. Failures are recorded
  // and the node is skipped — one bad export must not abort the whole scan.
  const hashes = new Map<string, { hash: string; source: string }>();
  for (const node of live) {
    try {
      hashes.set(node.driveId, await contentHashFor(env, node));
    } catch (err) {
      summary.errors.push(
        `hash ${node.name} (${node.driveId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const hashable = live.filter((n) => hashes.has(n.driveId));

  const actions = diffNodes(hashable, existing, (n) => hashes.get(n.driveId)?.hash ?? "");

  const rowFor = (node: DriveNode): typeof driveDocuments.$inferInsert => ({
    driveId: node.driveId,
    rootId: root.id,
    folderId: folderIdByDriveId.get(node.parentDriveId ?? root.driveFolderId) as number,
    name: node.name,
    mimeType: node.mimeType,
    sizeBytes: node.sizeBytes,
    contentHash: hashes.get(node.driveId)?.hash as string,
    hashSource: hashes.get(node.driveId)?.source as string,
    webViewUrl: node.webViewUrl,
    sharing: node.sharing,
    driveModifiedAt: node.modifiedAt,
    driveCreatedAt: node.createdAt,
  });

  const creates = actions.filter((a) => a.kind === "create");
  for (const part of chunk(creates)) {
    const stmts = part.map((a) =>
      db.insert(driveDocuments).values(rowFor((a as { node: DriveNode }).node)),
    );
    if (stmts.length === 0) continue;
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    summary.created += part.length;
  }

  // Supersede: deactivate the old row, then insert the replacement. These
  // cannot be one batch — the new row's id is not known until it is written —
  // so on insert failure the deactivation is rolled back by hand. A read
  // between the two writes is outside any atomic unit; that gap is real.
  for (const action of actions) {
    if (action.kind !== "supersede") continue;
    await db
      .update(driveDocuments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(driveDocuments.id, action.existingId));
    try {
      const [inserted] = await db
        .insert(driveDocuments)
        .values({ ...rowFor(action.node), revisionNumber: 1 })
        .returning({ id: driveDocuments.id });
      if (inserted) {
        await db
          .update(driveDocuments)
          .set({ supersededById: inserted.id })
          .where(eq(driveDocuments.id, action.existingId));
      }
      summary.superseded++;
    } catch (err) {
      // Compensating write: never leave a row deactivated with no replacement.
      await db
        .update(driveDocuments)
        .set({ isActive: true })
        .where(eq(driveDocuments.id, action.existingId));
      summary.errors.push(
        `supersede ${action.node.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const deletes = actions.filter((a) => a.kind === "delete").map((a) => (a as { existingId: number }).existingId);
  for (const part of chunk(deletes)) {
    if (part.length === 0) continue;
    await db
      .update(driveDocuments)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(inArray(driveDocuments.id, part));
    summary.deleted += part.length;
  }

  summary.unchanged += actions.filter((a) => a.kind === "unchanged").length;
}

/** Every active root, sequentially. One root's failure must not stop the rest. */
export async function ingestAllActiveRoots(env: Env): Promise<IngestSummary[]> {
  const db = drizzle(env.DB);
  const roots = await db.select().from(driveRoots).where(eq(driveRoots.isActive, true));
  const out: IngestSummary[] = [];
  for (const root of roots) {
    try {
      out.push(await ingestDriveFolder(env, root.id));
    } catch (err) {
      out.push({
        rootId: root.id,
        label: root.label,
        seen: 0,
        created: 0,
        superseded: 0,
        deleted: 0,
        unchanged: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  return out;
}
```

- [ ] **Step 3: Typecheck**

```bash
npx oxfmt src/backend/services/google/drive-ingest.ts src/backend/services/google/drive.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep "google/drive"
```
Expected: no output.

- [ ] **Step 4: Re-run both unit tests (regression guard)**

```bash
npx tsx src/backend/services/google/drive.test.ts && npx tsx src/backend/services/google/drive-diff.test.ts
```
Expected: both print `all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/google/drive-ingest.ts src/backend/services/google/drive.ts
git commit -m "feat(drive): ingestion service — walk, diff, write

ingestDriveFolder(env, rootId) works for any root row, so adding a folder
is an INSERT rather than a code change.

Writes obey the two D1 constraints that bite here: no transaction()
(error 7500 — batch() only) and 20 rows per statement (100 bound-param
cap). Supersede cannot be one batch because the new row's id is unknown
until written, so it carries a compensating re-activation on failure and
the residual read-between-writes gap is documented rather than papered
over."
```

---

### Task 6: Seed rows, cron wiring, admin API

**Files:**
- Create: `src/backend/api/routes/admin/drive-ingest.ts`
- Modify: `src/backend/api/index.ts` (mount)
- Modify: `src/_worker.ts` (cron branch)
- Modify: `wrangler.jsonc` (cron expression)

**Interfaces:**
- Consumes: `ingestAllActiveRoots`, `ingestDriveFolder`, `IngestSummary` from `services/google/drive-ingest`; `startRun` from `services/agent-runs`.
- Produces: `GET /api/admin/drive/roots`, `POST /api/admin/drive/roots`, `POST /api/admin/drive/ingest` (`{ rootId? }`), `GET /api/admin/drive/documents?rootId=&folderId=`.

- [ ] **Step 1: Seed the two use cases and two roots**

```bash
npx wrangler d1 execute core-remodel --remote --command "
INSERT OR IGNORE INTO drive_use_cases (key, name, description) VALUES
 ('EMAIL_ONBOARDING_MATERIALS','Email onboarding materials','High-level project material sent to vendors and contractors.'),
 ('DEEP_RESEARCH_FINDINGS','Deep research findings','Research documents indexed for retrieval.');"

npx wrangler d1 execute core-remodel --remote --command "
INSERT OR IGNORE INTO drive_roots (drive_folder_id, label, use_case_id) VALUES
 ('1ZUJ_taFjsdWUusVZtng8ZzUAX5BFVMxU','Onboarding materials',(SELECT id FROM drive_use_cases WHERE key='EMAIL_ONBOARDING_MATERIALS')),
 ('17R5yV2LnFpsYcjSacIdkHNwZDlpgdjs1','Deep research findings',(SELECT id FROM drive_use_cases WHERE key='DEEP_RESEARCH_FINDINGS'));"
```

- [ ] **Step 2: Add the admin routes**

Create `src/backend/api/routes/admin/drive-ingest.ts`:

```ts
/**
 * @fileoverview Admin surface for the Drive ingestion service: list/add roots,
 * trigger a scan by hand, and read the catalogue.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import {
  driveDocuments,
  driveFolders,
  driveRoots,
  driveUseCases,
} from "../../../db/schema/google-drive/index";
import { ingestAllActiveRoots, ingestDriveFolder } from "../../../services/google/drive-ingest";

export const driveIngestRouter = new Hono<{ Bindings: Env }>();

/** Hand-written Zod (never drizzle-zod — it breaks the esbuild build). */
const createRootSchema = z.object({
  driveFolderId: z.string().min(10),
  label: z.string().min(1),
  useCaseKey: z.enum(["EMAIL_ONBOARDING_MATERIALS", "DEEP_RESEARCH_FINDINGS"]),
});

driveIngestRouter.get("/roots", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: driveRoots.id,
      driveFolderId: driveRoots.driveFolderId,
      label: driveRoots.label,
      isActive: driveRoots.isActive,
      lastScannedAt: driveRoots.lastScannedAt,
      useCase: driveUseCases.key,
    })
    .from(driveRoots)
    .innerJoin(driveUseCases, eq(driveRoots.useCaseId, driveUseCases.id));
  return c.json({ roots: rows });
});

driveIngestRouter.post("/roots", async (c) => {
  const parsed = createRootSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const db = drizzle(c.env.DB);
  const [useCase] = await db
    .select()
    .from(driveUseCases)
    .where(eq(driveUseCases.key, parsed.data.useCaseKey))
    .limit(1);
  if (!useCase) return c.json({ error: `unknown use case ${parsed.data.useCaseKey}` }, 400);
  const [row] = await db
    .insert(driveRoots)
    .values({
      driveFolderId: parsed.data.driveFolderId,
      label: parsed.data.label,
      useCaseId: useCase.id,
    })
    .returning({ id: driveRoots.id });
  return c.json({ id: row?.id }, 201);
});

driveIngestRouter.post("/ingest", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { rootId?: number };
  const summaries = body.rootId
    ? [await ingestDriveFolder(c.env, body.rootId)]
    : await ingestAllActiveRoots(c.env);
  return c.json({ summaries });
});

driveIngestRouter.get("/documents", async (c) => {
  const db = drizzle(c.env.DB);
  const rootId = Number(c.req.query("rootId"));
  if (!Number.isFinite(rootId)) return c.json({ error: "rootId is required" }, 400);
  // Folder NAME comes from a join — it is never denormalized onto the doc row.
  const rows = await db
    .select({
      id: driveDocuments.id,
      name: driveDocuments.name,
      mimeType: driveDocuments.mimeType,
      sizeBytes: driveDocuments.sizeBytes,
      webViewUrl: driveDocuments.webViewUrl,
      sharing: driveDocuments.sharing,
      folderName: driveFolders.name,
    })
    .from(driveDocuments)
    .innerJoin(driveFolders, eq(driveDocuments.folderId, driveFolders.id))
    .where(
      and(
        eq(driveDocuments.rootId, rootId),
        eq(driveDocuments.isActive, true),
        eq(driveDocuments.isDeleted, false),
      ),
    );
  return c.json({ documents: rows });
});
```

Mount in `src/backend/api/index.ts`:

```ts
import { driveIngestRouter } from "./routes/admin/drive-ingest";
// ...
app.route("/api/admin/drive", driveIngestRouter);
```

- [ ] **Step 3: Wire the cron**

In `wrangler.jsonc`, add `"0 11 * * *"` to `triggers.crons` (11:00 UTC ≈ 04:00 Pacific, off-peak and clear of the existing 14:00 job):

```jsonc
"crons": ["0 14 * * *", "* * * * *", "15 */4 * * *", "30 13 * * 1", "0 9 * * 1", "0 11 * * *"],
```

In `src/_worker.ts`, inside `legacyHandler.scheduled`, add a branch alongside the existing ones:

```ts
if (event.cron === "0 11 * * *") {
  ctx.waitUntil(
    (async () => {
      // Reuses the shared agent-run ledger rather than a bespoke scan-run
      // table, so the nightly scan shows up at /admin/system/agents for free.
      const run = await startRun(env, {
        agent: "drive-ingest",
        operation: "daily-scan",
        triggeredBy: "cron",
      });
      try {
        const summaries: IngestSummary[] = [];
        for (const root of await listActiveRootsForCron(env)) {
          summaries.push(
            await run.step(`root:${root.label}`, () => ingestDriveFolder(env, root.id)),
          );
        }
        await run.succeed({ summaries });
      } catch (err) {
        await run.fail(err);
      }
    })(),
  );
  return;
}
```

Add to the imports at the top of `src/_worker.ts`:

```ts
import { startRun } from "./backend/services/agent-runs";
import {
  ingestDriveFolder,
  listActiveRootsForCron,
  type IngestSummary,
} from "./backend/services/google/drive-ingest";
```

And add this export to `src/backend/services/google/drive-ingest.ts` (the cron needs the root list without running them):

```ts
/** Active roots, for a caller that wants to wrap each scan in its own step. */
export async function listActiveRootsForCron(
  env: Env,
): Promise<{ id: number; label: string }[]> {
  const db = drizzle(env.DB);
  return db
    .select({ id: driveRoots.id, label: driveRoots.label })
    .from(driveRoots)
    .where(eq(driveRoots.isActive, true));
}
```

- [ ] **Step 4: Typecheck and deploy the preview**

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit 2>&1 | grep -E "_worker\.ts|drive-ingest"
pnpm run deploy:preview
```
Expected: no type errors. Note previews strip crons on purpose — the scheduled path is exercised via `POST /api/admin/drive/ingest`, not by waiting for a tick.

- [ ] **Step 5: Commit**

```bash
git add src/backend/api/routes/admin/drive-ingest.ts src/backend/api/index.ts src/_worker.ts src/backend/services/google/drive-ingest.ts wrangler.jsonc
git commit -m "feat(drive): admin routes + daily cron on the agent-run ledger

The nightly scan opens one agent_runs run with a step per root, so it
appears at /admin/system/agents with timing and errors without a bespoke
scan-run table. Previews strip crons by design, so the scan is triggered
in QC via POST /api/admin/drive/ingest."
```

---

### Task 7: QC script

**Files:**
- Create: `scripts/qc/pr_<N>.mjs` (replace `<N>` with the real PR number once opened)

**Interfaces:**
- Consumes: `resolveBase`, `createClient`, `createChecks`, `assertReachable` from `scripts/config.mjs`.

- [ ] **Step 1: Write the QC script**

```js
#!/usr/bin/env node
/**
 * @fileoverview QC for the Drive ingestion service.
 *
 * Asserts against the two REAL roots, whose contents were walked by hand when
 * the spec was written — so the expected shapes below are measurements, not
 * guesses:
 *   onboarding 1ZUJ… → 71 nodes, 12 folders, ~55 images, 4 PDFs, 0 Google Docs
 *   research   17R5… → 87 nodes, 12 folders, ~46 Google Docs, 26 HTML
 *
 * The second-run idempotency check is the important one: a scan that creates
 * rows every night would silently multiply the catalogue.
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const ONBOARDING = "1ZUJ_taFjsdWUusVZtng8ZzUAX5BFVMxU";
const RESEARCH = "17R5yV2LnFpsYcjSacIdkHNwZDlpgdjs1";

async function main() {
  const client = createClient({ base: resolveBase() });
  const checks = createChecks();
  console.log(`\nDrive ingestion QC\n  target: ${client.base}\n`);
  await assertReachable(client, checks);

  const roots = await client.get("/api/admin/drive/roots");
  checks.ok("both roots are seeded", roots.status === 200 && roots.json?.roots?.length >= 2,
    `status ${roots.status}`);
  const onboarding = roots.json?.roots?.find((r) => r.driveFolderId === ONBOARDING);
  const research = roots.json?.roots?.find((r) => r.driveFolderId === RESEARCH);
  checks.ok("onboarding root maps to EMAIL_ONBOARDING_MATERIALS",
    onboarding?.useCase === "EMAIL_ONBOARDING_MATERIALS", JSON.stringify(onboarding));
  checks.ok("research root maps to DEEP_RESEARCH_FINDINGS",
    research?.useCase === "DEEP_RESEARCH_FINDINGS", JSON.stringify(research));

  const first = await client.post("/api/admin/drive/ingest", { rootId: onboarding?.id });
  const s1 = first.json?.summaries?.[0];
  checks.ok("first scan ingests the onboarding folder",
    first.status === 200 && s1?.seen >= 60, `seen ${s1?.seen}, errors ${JSON.stringify(s1?.errors)}`);
  checks.info(`seen=${s1?.seen} created=${s1?.created} superseded=${s1?.superseded} deleted=${s1?.deleted}`);

  const second = await client.post("/api/admin/drive/ingest", { rootId: onboarding?.id });
  const s2 = second.json?.summaries?.[0];
  checks.ok("second scan is a no-op (idempotent)",
    s2?.created === 0 && s2?.superseded === 0 && s2?.deleted === 0,
    `created ${s2?.created}, superseded ${s2?.superseded}, deleted ${s2?.deleted}`);

  const docs = await client.get(`/api/admin/drive/documents?rootId=${onboarding?.id}`);
  const list = docs.json?.documents ?? [];
  checks.ok("documents are listed with a joined folder name",
    list.length > 0 && typeof list[0]?.folderName === "string", `count ${list.length}`);
  checks.ok("the 1971 blueprints PDF is catalogued with a size",
    list.some((d) => d.name.includes("1971 Blueprints") && d.sizeBytes > 0),
    JSON.stringify(list.find((d) => d.name.includes("1971 Blueprints"))));
  checks.ok("sharing is recorded on every document",
    list.every((d) => ["ANYONE","ANYONE_WITH_LINK","DOMAIN","DOMAIN_WITH_LINK","PRIVATE"].includes(d.sharing)),
    `distinct: ${[...new Set(list.map((d) => d.sharing))].join(", ")}`);

  checks.finish();
}

await main();
```

- [ ] **Step 2: Run against the preview**

```bash
node scripts/qc/pr_<N>.mjs --preview
```
Expected: all checks pass; the second scan reports `created 0, superseded 0, deleted 0`.

- [ ] **Step 3: Run against production (regression guard)**

```bash
node scripts/qc/pr_<N>.mjs
```
Expected: reachable + no 5xx. New endpoints 404 until merge — report that as pending, not as failure, matching the repo's QC contract.

- [ ] **Step 4: Changelog + PR**

Add the branch row, entry, and `PhaseDetail` (with the `verification` block holding the real QC output) to `src/frontend/data/changelog.ts` and `changelog-detail.ts`, push the rows to D1 via `POST /api/changelog/branches` and `/entries`, then open the PR with `Changelog: https://core-remodel.hacolby.workers.dev/admin/changelog/<slug>` in the description.

- [ ] **Step 5: Commit**

```bash
git add scripts/qc/pr_<N>.mjs src/frontend/data/
git commit -m "test(drive): QC for the ingestion service

Asserts against both real roots using shapes measured by hand when the
spec was written. The idempotency check is the load-bearing one: a scan
that created rows every night would silently multiply the catalogue."
```

---

## Self-review

**Spec coverage:** §3.1 ingestion service → Tasks 2, 4, 5. §8.0/§8.2 schema → Task 3. §2.4 is_active vs is_deleted → Task 3 (columns) + Task 5 (writes) + Task 4 (classifier). §2.6 sharing → Task 2 (derivation, tested) + Task 3 (column) + Task 7 (asserted). §2.7 auth risk → Task 1. §2.2 agent_runs → Task 6. §2.3 use-case registry → Task 3 + Task 6 seed. Exclusions → Task 2 (descent) + Task 3 (table). Cron → Task 6. Testing §5 → Tasks 2, 4, 7.

**Deferred by design, not missed:** text extraction, embeddings and `ragUuid` population are PR 3 — the columns exist here but are written by that PR. `exportFileText` ships in Task 2 because the client owns all Drive I/O; PR 3 consumes it. Email, templates and attach-vs-link are PR 2.

**Naming consistency:** `ingestDriveFolder`, `ingestAllActiveRoots`, `listActiveRootsForCron`, `diffNodes`, `deriveSharing`, `isExcluded`, `contentHashFor`, `listFolderRecursive`, `exportFileText` — each defined once and referenced with the same name and signature everywhere.

**Known accepted gap:** the supersede path is two writes with a compensating rollback rather than one atomic unit, because D1 has no transactions and a batch cannot feed a generated id forward. Documented in the code comment rather than implied away.
