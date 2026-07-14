# 0015 — OAuth-Compliant MCP Server (Remodel Copilot)

**Status:** PLAN — design decisions approved 2026-07-08; awaiting go-ahead to start Phase 0. No code written yet.
**Author:** Claude (cloudflare-jedi + mcp-builder)
**Date:** 2026-07-07 (decisions locked 2026-07-08)
**Scope owner:** `src/backend/api/routes/mcp.ts` → new `src/backend/mcp/*`, `src/_worker.ts`, `wrangler.jsonc`, `AGENTS.md`, `src/frontend/pages/mcp/*`

---

## 0. Approved decisions (Justin, 2026-07-08)

These resolve §11 and override any earlier hedging in this doc:

1. **OAuth library:** ✅ `@cloudflare/workers-oauth-provider`.
2. **MCP layer:** ✅ Official `@modelcontextprotocol/sdk` **via `McpAgent` from `agents/mcp`** — `McpAgent` internally instantiates the SDK's `McpServer`, so this satisfies "use the official SDK **and** leverage the agents-SDK mcp package." Consequence: `McpAgent` is a **Durable Object** → adds **migration tag `v14`** (`new_sqlite_classes: ["RemodelMcpAgent"]`) and a DO binding. This is the Cloudflare-canonical remote-OAuth-MCP shape (OAuthProvider `apiHandler` → `McpAgent.serveSSE`/`.serve`). The tool **registry** (§3.2) still drives everything — `McpAgent.init()` iterates it and calls `this.server.tool(...)`.
3. **Schema migrations §7 A/B/C:** ✅ approved as recommended.
4. **Docs site:** ✅ public `/mcp` + `/mcp/tools`.
5. **Scopes:** ✅ **single `remodel` full-parity scope** — anything doable in the app is doable via the MCP tool. No read/write split at the OAuth layer; `destructiveHint`/`readOnlyHint` annotations still mark tool behavior for the client. (Consent screen grants the one scope.)
6. **Tool naming:** ✅ **no prefix** (fewest tokens; matches the existing unprefixed `list_rooms`/`add_measurement`; the MCP client already namespaces tools by server). Names are bare verbs: `list_rooms`, `create_budget_item`, `link_brand_to_showroom`, `reconcile_purchase`.

---

## 1. Objective

Stand up a **claude.ai-connector-compliant** (OAuth 2.1) MCP server on the existing `core-remodel` Worker, then grow its tool surface incrementally. The first tool release lets an AI agent help Justin **manage the remodel domain end-to-end**:

- Manage **rooms** (read, annotate, dimensions).
- Manage the **budget** — create/adjust line items, record **actual** costs, link items to rooms, pair items with materials, and pull **budget-vs-actual reports** (below / at / over budget) plus reallocation guidance ("I saved $5k on the fridge — where do I apply it?").
- Manage **materials** — create/update the material schedule, tie materials to **rooms** and **budget entries**, mark purchased.
- Manage **showrooms** — add/maintain showrooms, record **visit notes**, record **POCs**, fill in missing details, set hours.
- Manage the global **brand** registry and relate brands to showrooms (brand 1:M showroom).
- Manage the global **product** catalog, relate product → brand, and associate product → showrooms (product 1:M showroom).
- **Reconcile a purchase** across all of the above: ensure the material item, room link, budget link, brand, product, and product↔showroom links all exist — creating or reusing DB rows as needed.

Two standing requirements apply to **every** future increment:

1. **`AGENTS.md`** must document the MCP server and instruct agents to keep the frontend docs current.
2. A **frontend documentation site** must describe how to connect the server and enumerate every exposed tool. It is driven from a single tool registry so it can never silently drift.

---

## 2. Current state (what already exists — do not rebuild)

| Concern | Reality in the repo | Implication |
|---|---|---|
| MCP endpoint | Hand-rolled JSON-RPC-over-HTTP at **`/api/mcp`** — [`src/backend/api/routes/mcp.ts`](src/backend/api/routes/mcp.ts), mounted in [`src/backend/api/index.ts:177`](src/backend/api/index.ts). Protocol `2024-11-05`, `serverInfo = renovation-studio`. | Reuse the transport shape; refactor tool dispatch into a registry; **add OAuth in front**. |
| MCP auth | `Authorization: Bearer <WORKER_API_KEY>` **or** the access cookie, **or** scoped Deep-Research KV tokens. Header comment explicitly names `@cloudflare/workers-oauth-provider` as the documented follow-up. | The connector-OAuth follow-up is exactly this project. Bearer + research-token paths must keep working. |
| Existing tools | `create_render_session`, `list_room_angles`, `run_render_stage`, `generate_mood_board`, `list_mood_boards`, `list_rooms`, `highlight_wall`, `add_measurement`, `list_measurements`, `get_measurement_coverage`, 3 deep-research tools. | Fold into the new registry unchanged (rename-free) so nothing breaks. `list_rooms` overlaps §6 — reconcile. |
| Worker entry | [`src/_worker.ts`](src/_worker.ts) — custom `ExportedHandler`: `routeAgentRequest` → legacy 301s → protected-path cookie gate → Hono `/api/*` → Astro fallthrough. Also exports all DO/Workflow classes. | OAuthProvider will wrap this handler as its `defaultHandler` (see §4). DO/Workflow named exports stay put. |
| App auth | Cookie = SHA-256 hash of `WORKER_API_KEY`; `/access` password page; `WORKER_API_KEY` in Secrets Store. [`src/backend/utils/access.ts`](src/backend/utils/access.ts). | Reuse as the **login step** inside the OAuth approval screen (Justin is the only user). |
| KV | `CACHE`, `SESSIONS` bound. | Add a dedicated `OAUTH_KV` for grants/clients/tokens (isolation > reuse). |
| Installed libs | `agents@0.12.3` (ships `agents/mcp` McpAgent + `agents/mcp/do-oauth-client-provider`), `hono@4`, `@hono/zod-openapi`, `zod@4`, `drizzle-orm@0.33`. | `@modelcontextprotocol/sdk` and `@cloudflare/workers-oauth-provider` are **not** installed — both are new deps. |
| Frontend docs | `/docs` is a **D1-backed** document viewer (`PublicDocsApp`); static Astro pages also exist (`sitemap.astro`, etc.). | The MCP docs site is **static Astro** at a new `/mcp` route (not a D1 document). |

### 2.1 Domain schema map (already in D1 — confirmed)

All under `src/backend/db/schema/`. Exact tables the tools will touch:

- **Rooms** — `rooms` (`home/rooms.ts`): `id`, `roomCode` (unique), `roomName`, `floorId`→`floors`, dimension quads, `areaSqFt`, `isActive` (soft-delete), notes columns. Parent `floors` (`home/floors.ts`).
- **Budget** (`home/budget_tracker_items.ts`):
  - `budgetTrackerItems` — **revisioned** (`trackId` + `revisionNumber` + `isActive`; update = insert new row, mark old inactive), `estimatedLowCents`/`estimatedHighCents`, `status`, `executionClass`, `scenarioId`.
  - `budgetTrackerItemRooms` — join budget item ↔ room (M:M).
  - `budgetExpenseEntries` — **actuals**, revisioned, `amountCents`, `category`, `vendorName`, `dateIncurred`.
  - `budgetFundingAccounts` — funding pools (`amountCents`).
  - `budgetProjectInfo` — key/value project metadata.
- **Materials**:
  - `materialScheduleItems` (`materials/schedule_item.ts`): `title`, `roomName` (**TEXT, not a FK**), `brand`/`model` (text hints), `isPurchased`, `purchasedShowroomProductId` (soft link, plain column).
  - `materialRequiredSpecs` (`materials/required_specs.ts`): `materialId`→material, `key`, `value`.
- **Showrooms** (`showroom/*`):
  - `showroomStores` (`stores.ts`) — the big one: name, contact, `hoursJson`, `rating` + `ratingContext*`, `mainPoc*`, socials, `pricePoint`, `accessLevel`, Google Places fields, `overviewNote*`.
  - `showroomPocs` (`pocs.ts`) — POC records (`showroomId`, name/title/phone/email, business-card URLs, `isActive`).
  - `showroomHours` (`hours.ts`) — normalized per-day hours (unique `(showroomId, day)`).
  - `storeNotes` (`notes.ts`) — freeform/rich-text showroom notes (visit notes), `isActive`, `tagsJson`.
  - `showroomStoreCategory` + `showroomStoreCategoryMapping` (`categories.ts`).
- **Brands** (`brands/*`):
  - `brands` (`brands.ts`) — global registry: `name`, socials, `iconCfImagesUrl`, `onlineRating`/`userRating`, `pricePoint`.
  - `showroomBrandMappings` (`showroom_brand_mappings.ts`) — **brand ↔ showroom M:M** (unique `(showroomId, brandId)`). ✅ already exists.
- **Products** (`showroom/store_products.ts`):
  - `showroomStoreProducts` — catalog rows: `storeId`→showroom, `brandId`→brand, `materialId`→material (M:1), `itemName`, `sku`, `price`, `jsonDetails`, `productType`.
  - `showroomProductMappings` (`product_mappings.ts`) — **product ↔ showroom M:M** (unique `(showroomId, productId)`). ✅ already exists.

**Cardinality reality vs. the request:**

| Requested relationship | Exists today | Status |
|---|---|---|
| brand → showroom (1:M) | `showroomBrandMappings` (M:M) | ✅ ready |
| product → showroom (1:M) | `showroomProductMappings` (M:M) | ✅ ready |
| product → brand | `showroomStoreProducts.brandId` FK | ✅ ready |
| budget item → room | `budgetTrackerItemRooms` (M:M) | ✅ ready |
| **product → material** | `showroomStoreProducts.materialId` (M:1 only) | ⚠️ see §7 decision A |
| **material → room** | `roomName` TEXT only, no FK | ⚠️ see §7 decision B |
| **material → budget item** | *nothing* | ⚠️ see §7 decision C |

The three ⚠️ gaps are the schema decisions in §7 — they are the crux of the "pair budget items with materials / link materials to rooms" ask and need Justin's sign-off before migration.

---

## 3. Target architecture

```
claude.ai / Claude Code (MCP client)
        │  OAuth 2.1 (DCR + PKCE)
        ▼
┌─────────────────────────────────────────────────────────────┐
│ export default new OAuthProvider({ ... })   (src/_worker.ts) │
│  ├─ /.well-known/oauth-authorization-server  ── library      │
│  ├─ /.well-known/oauth-protected-resource   ── library       │
│  ├─ /oauth/authorize  → approval UI (reuses WORKER_API_KEY)  │
│  ├─ /oauth/token  /oauth/register (DCR)      ── library       │
│  ├─ apiHandlers:  /api/mcp , /mcp/sse  → MCP handler          │
│  └─ defaultHandler: existing worker fetch (Astro+Hono+agents)│
└─────────────────────────────────────────────────────────────┘
        │ ctx.props = { userId, scope }
        ▼
┌─────────────────────────────────────────────────────────────┐
│ MCP server (Streamable HTTP, stateless JSON)                 │
│  src/backend/mcp/server.ts                                   │
│   └─ iterates the TOOL REGISTRY                              │
│        src/backend/mcp/registry.ts  ← single source of truth │
│         ├─ tools/rooms.ts     ├─ tools/showrooms.ts          │
│         ├─ tools/budget.ts    ├─ tools/brands.ts             │
│         ├─ tools/materials.ts ├─ tools/products.ts           │
│         ├─ tools/links.ts     └─ tools/legacy.ts (render/…)  │
└─────────────────────────────────────────────────────────────┘
        │ registry metadata (name/desc/schema/annotations)
        ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ /mcp  (Astro) connect guide  │   │ /context , /api/mcp GET   │
│ /mcp/tools  auto tool catalog│   │  discovery — same registry│
└──────────────────────────────┘   └──────────────────────────┘
```

### 3.1 Two load-bearing decisions

**D1 — OAuth library: `@cloudflare/workers-oauth-provider`.**
It is the Cloudflare-blessed, claude.ai-tested implementation of the full connector handshake (Dynamic Client Registration `/register`, `/authorize`, `/token`, PKCE, both `.well-known` metadata docs, RFC 9728 `WWW-Authenticate` on 401, token issue/rotate/store in KV). Hand-rolling OAuth 2.1 + DCR + PKCE is a large, security-sensitive surface we should not own. The provider becomes the Worker's `export default` and delegates everything non-OAuth to our current handler via `defaultHandler`, so the Astro/Hono/agents stack is untouched.

**D2 — MCP layer: `McpAgent` (`agents/mcp`) wrapping the official `@modelcontextprotocol/sdk` `McpServer`.** *(approved — §0.2)*
`McpAgent` is Cloudflare's Durable-Object host for a remote MCP server; it instantiates the SDK's `McpServer` internally, so we register tools with Zod v4 schemas + `outputSchema`/`structuredContent` + annotations through the official API while getting the agents-SDK plumbing (OAuth `props` on `this.props`, SSE **and** Streamable HTTP transports, per-session state if ever needed). `OAuthProvider` routes `/api/mcp` → `RemodelMcpAgent.serve("/api/mcp")` and `/mcp/sse` → `.serveSSE("/mcp/sse")`. **Cost:** one new DO + **migration tag `v14`** — a coordinated migration (mind the DO-tag-desync memory: land it on `main` cleanly). The **registry** stays the single source of truth: `McpAgent.init()` loops the registry and calls `this.server.tool(name, schema, annotations, handler)` for each entry.

### 3.2 The tool registry (the anti-drift keystone)

One module defines each tool **once**:

```ts
// src/backend/mcp/types.ts
export interface RemodelTool<I = unknown, O = unknown> {
  name: string;                     // remodel_* snake_case
  category: ToolCategory;           // "rooms" | "budget" | ... (drives docs grouping)
  title: string;                    // human label for docs
  description: string;              // agent-facing, precise, action-oriented
  inputSchema: z.ZodType<I>;        // Zod v4 (hand-written — drizzle-zod is banned, see memory)
  outputSchema?: z.ZodType<O>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  examples?: { title: string; args: unknown }[];   // rendered in /mcp/tools
  handler: (ctx: ToolCtx, input: I) => Promise<O>;  // ctx = { env, db, props }
}
```

`registry.ts` imports every `tools/*.ts` array and concatenates them. Consumers:

1. **MCP server** — `tools/list` maps registry → MCP tool defs (Zod→JSON Schema via the SDK or `zod-to-json-schema`, already a dep); `tools/call` looks up by name, validates input with the Zod schema, runs the handler.
2. **`/mcp/tools` Astro page** — imports the registry metadata (names/descriptions/schemas/examples/annotations) and renders the catalog. Adding a tool file automatically adds a docs card. **This is what makes "keep the docs updated" structurally enforced rather than a manual chore.**
3. **`/context` + `GET /api/mcp`** — list tool names from the same array.

Modular per cloudflare-jedi rules: one file per domain, each well under the size budget, each exporting a typed `RemodelTool[]`.

---

## 4. OAuth implementation detail

### 4.1 Wrangler / bindings
- Add KV namespace `OAUTH_KV` (create via wrangler; do **not** hand-edit `worker-configuration.d.ts` — run `pnpm run cf-typegen` after).
- Add the **`RemodelMcpAgent` Durable Object** binding + **migration tag `v14`** (`{ "tag": "v14", "new_sqlite_classes": ["RemodelMcpAgent"] }`); export the class from `src/_worker.ts` alongside the other DOs.
- `OAuthProvider` config in `src/_worker.ts` (apiHandlers dispatch into the `McpAgent`):
  ```ts
  export default new OAuthProvider({
    apiHandlers: {
      "/api/mcp": RemodelMcpAgent.serve("/api/mcp"),      // Streamable HTTP
      "/mcp/sse": RemodelMcpAgent.serveSSE("/mcp/sse"),   // SSE fallback
    },
    defaultHandler: legacyWorkerHandler,   // = today's `handler`
    authorizeEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["remodel"],          // single full-parity scope (§0.5)
  });
  ```
  DO/Workflow classes (incl. `RemodelMcpAgent`) remain **named exports** in the same file.
- `routeAgentRequest`, legacy 301s, and the protected-path cookie gate stay inside `legacyWorkerHandler` and keep working (OAuthProvider only claims the OAuth + api routes).

### 4.2 Authorization UI (`/oauth/authorize`)
A minimal, dark-Monolith Astro/Hono page:
1. If the request lacks a valid access cookie → show the existing `/access` password field (validates against `WORKER_API_KEY` via `validatePasswordAgainstWorkerKey`).
2. Once authenticated → show a **consent screen** ("Claude wants to connect to the 126 Colby Remodel MCP — grant read/write?") with Approve/Deny.
3. On approve → `oauthProvider.completeAuthorization({ userId: "justin", scope, props: { userId, scope } })` → redirect back to Claude with the auth code.

Because Justin is the sole operator, `userId` is a constant; scope is the only real variable. `props` flow to the MCP handler as `ctx.props`.

### 4.3 Backward-compatibility (must-keep auth paths)
The MCP handler accepts a request as authenticated if **any** of:
- OAuthProvider validated an OAuth access token (primary, claude.ai path) → `this.props`.
- `Authorization: Bearer <WORKER_API_KEY>` (Claude Code / curl today).
- Scoped Deep-Research KV token (existing research tools).
- Access cookie (same-origin browser).

All four are full-parity (single `remodel` scope, §0.5) — every non-research tool is available on each path. Research tools keep their scoped-token gate. Destructive tools are still flagged via annotations so the client can prompt, but the OAuth layer does not gate them separately.

### 4.4 claude.ai connection flow (what Justin will do — becomes the `/mcp` doc)
1. claude.ai → Settings → Connectors → Add custom connector → URL `https://<worker-domain>/api/mcp`.
2. claude.ai fetches `/.well-known/oauth-protected-resource` → discovers the auth server → `/register` (DCR) → opens `/oauth/authorize`.
3. Justin enters the access password, approves → claude.ai stores the token → tools appear.

---

## 5. Tool naming & conventions
- **No prefix** *(approved — §0.6; fewest tokens, matches existing unprefixed `list_rooms`/`add_measurement`; client namespaces by server).*
- snake_case, verb-first: `list_rooms`, `create_budget_item`, `link_brand_to_showroom`, `reconcile_purchase`.
- Every tool: precise description, Zod input, `outputSchema` where structured, correct annotations, ≥1 example.
- List tools: `limit`/`offset`, return `{ items, total, count, offset, has_more, next_offset }`.
- Money is **cents** end-to-end (matches `*Cents` columns); tools accept/return cents and echo a formatted dollar string in structured output for readability.
- Errors: throw with actionable messages ("Room 42 is not active — call remodel_list_rooms to see valid ids"); surfaced as `isError` tool results, never protocol errors.

---

## 6. Tool catalog (first release)

> **Naming:** the tables below keep the `remodel_` prefix for readability, but the **shipped names drop it** per §0.6 — e.g. `remodel_list_rooms` ships as `list_rooms`, `remodel_reconcile_purchase` ships as `reconcile_purchase`.

Legend — annotations shown as `[R]` readOnly, `[W]` write/non-destructive, `[D]` destructive.

### 6.1 Rooms
| Tool | Ann | Purpose / tables |
|---|---|---|
| `remodel_list_rooms` | R | Active rooms (id, roomCode, roomName, floor, dims, areaSqFt). *Supersedes/aliases existing `list_rooms`.* |
| `remodel_get_room` | R | Full room incl. notes + linked budget items + linked materials. |
| `remodel_update_room` | W | Patch dimensions / notes (problem/plumbing/electrical/structural/hvac/general). |

### 6.2 Budget
| Tool | Ann | Purpose / tables |
|---|---|---|
| `remodel_list_budget_items` | R | Filter by room / status / executionClass; active revisions only. |
| `remodel_get_budget_item` | R | One item + linked rooms + linked materials + actuals to date. |
| `remodel_create_budget_item` | W | New `budgetTrackerItems` (new `trackId`), estimate low/high cents. |
| `remodel_update_budget_item` | W | Revision-aware edit (insert new revision, mark prior inactive). |
| `remodel_link_budget_item_to_room` | W | Upsert `budgetTrackerItemRooms`. |
| `remodel_unlink_budget_item_from_room` | D | Remove a room link. |
| `remodel_record_expense` | W | New `budgetExpenseEntries` actual (amountCents, vendor, category, dateIncurred). |
| `remodel_list_expenses` | R | Actuals, filter by category/vendor/date. |
| `remodel_list_funding_accounts` | R | Funding pools + balances. |
| `remodel_set_funding_account` | W | Upsert a funding pool amount. |
| `remodel_get_budget_report` | R | **The report tool.** Per-room & per-category **estimated vs actual**, variance, and **below/at/over** flag; totals vs funding; identifies rooms/categories with no materials or no actuals yet. |
| `remodel_get_reallocation_options` | R | Given a stated saving (e.g. `{savedCents, fromItemId}`), returns candidate over-budget or under-funded targets ranked, so the agent can advise where to apply it. (Analysis only — the actual move is `remodel_update_budget_item`.) |

### 6.3 Materials
| Tool | Ann | Purpose / tables |
|---|---|---|
| `remodel_list_materials` | R | Filter by room, purchased state, brand. |
| `remodel_get_material` | R | Material + specs + room + budget link + purchased product. |
| `remodel_create_material` | W | New `materialScheduleItems` (title, roomName/roomId, brand/model hints). |
| `remodel_update_material` | W | Patch fields. |
| `remodel_set_material_specs` | W | Upsert `materialRequiredSpecs` rows. |
| `remodel_link_material_to_room` | W | Set room (per §7-B). |
| `remodel_link_material_to_budget_item` | W | Pair with a budget line (per §7-C). |
| `remodel_mark_material_purchased` | W | `isPurchased=true` + `purchasedShowroomProductId` + optional `remodel_record_expense` for the actual. |

### 6.4 Showrooms
| Tool | Ann | Purpose / tables |
|---|---|---|
| `remodel_list_showrooms` | R | Filter by city / category / pricePoint / brand; pagination. |
| `remodel_get_showroom` | R | Store + POCs + hours + notes + brands + products. |
| `remodel_create_showroom` | W | New `showroomStores` (name + whatever is known). |
| `remodel_update_showroom` | W | **Fill missing details** — any store column (address, phone, website, hours summary, socials, access level, notes). |
| `remodel_add_showroom_note` | W | New `storeNotes` (visit note; title + markdown + tags). |
| `remodel_add_showroom_poc` | W | New `showroomPocs` (record POC). |
| `remodel_set_showroom_hours` | W | Upsert `showroomHours` per day. |
| `remodel_record_showroom_visit` | W | Set `rating` + `ratingContext*` and attach a visit note in one call. |

### 6.5 Brands
| Tool | Ann | Purpose / tables |
|---|---|---|
| `remodel_list_brands` | R | Global registry, search by name. |
| `remodel_get_brand` | R | Brand + showrooms carrying it + products. |
| `remodel_create_brand` | W | New global `brands` row. |
| `remodel_update_brand` | W | Patch. |
| `remodel_ensure_brand` | W (idempotent) | **Find-or-create** by name — the reuse-or-create primitive. |
| `remodel_link_brand_to_showroom` | W | Upsert `showroomBrandMappings`. |
| `remodel_unlink_brand_from_showroom` | D | Remove mapping. |

### 6.6 Products
| Tool | Ann | Purpose / tables |
|---|---|---|
| `remodel_list_products` | R | Filter by brand / material / showroom / type. |
| `remodel_get_product` | R | Product + brand + material + showrooms. |
| `remodel_create_product` | W | New `showroomStoreProducts` (brandId, itemName, sku, price, jsonDetails). |
| `remodel_update_product` | W | Patch. |
| `remodel_ensure_product` | W (idempotent) | **Find-or-create** by (brandId + name/sku). |
| `remodel_link_product_to_showroom` | W | Upsert `showroomProductMappings`. |
| `remodel_link_product_to_material` | W | Tie product↔material (per §7-A). |

### 6.7 Cross-domain workflow tool
| Tool | Ann | Purpose |
|---|---|---|
| `remodel_reconcile_purchase` | W | The composite the user described. Input: e.g. `{ productName:"Toto Aquia", brand:"Toto", sku, showroom:"…", materials:[{title:"Toilet — Primary Bath", room:"primary_bath", budgetItem:"Primary Bath Fixtures", priceCents}] }`. Steps, each reuse-or-create: ensure brand → ensure product (link to brand) → link product↔showroom → for each material: ensure material row, link material↔room, link material↔budget item, mark purchased with this product, record the actual expense. Returns a structured report of every row created vs reused. Built **on top of** the atomic tools above (so it is optional / Phase 3). |

### 6.8 Legacy tools (carried over unchanged)
`create_render_session`, `list_room_angles`, `run_render_stage`, `generate_mood_board`, `list_mood_boards`, `highlight_wall`, `add_measurement`, `list_measurements`, `get_measurement_coverage`, `get_deep_research_context`, `record_deep_research_progress`, `record_deep_research_source`. Moved into `tools/legacy.ts`, same names, same behavior, now with annotations + docs cards.

---

## 7. Schema gaps → migrations (decisions required)

These three are the only real modeling questions. Each has a recommendation; Justin confirms before any `db:generate`. **Migrations are generated with `pnpm run db:generate` and applied only via `pnpm run migrate:remote` — never raw SQL, never hand-edited migration files** (per repo memory).

**Timestamp convention (applies to every new column below).** All `createdAt`/timestamp columns use `integer("created_at", { mode: "timestamp" }).notNull().default(sql\`(unixepoch())\`)` — **`(unixepoch())` is seconds**, matching every existing table (e.g. `materials/schedule_item.ts`, `brands/showroom_brand_mappings.ts`). Do **not** use millisecond defaults (no `* 1000`, no `unixepoch() * 1000`, no `CURRENT_TIMESTAMP` text) — a ms value would misread as a far-future date against the rest of the schema. *(Resolves Gemini review comments on lines 317 & 325.)*

**A. product ↔ material.**
Today: `showroomStoreProducts.materialId` (a product belongs to at most one material). The "2 Kohler toilets for hall + lower bath" case = one product model satisfying two materials → M:M.
→ **Recommendation:** add `product_material_mappings` join `(productId, materialId, isPrimary, createdAt)` unique `(productId, materialId)`. `createdAt` = `(unixepoch())` seconds (see convention above). Keep the existing `materialId` column as a denormalized "primary" pointer for back-compat.

**B. material ↔ room.**
Today: `materialScheduleItems.roomName` is free text. Each material item is per-room ("Toilet — Primary Bath"), so this is **M:1**, not M:M.
→ **Recommendation:** add nullable `roomId` FK → `rooms.id` on `materialScheduleItems`; keep `roomName` as a display fallback and backfill it from `rooms.roomName`. Simpler than a join and matches the per-room material model. *(Alt: a `material_room_mappings` join if a single material can ever span rooms — not seen in the data.)*

**C. material ↔ budget item.**
Today: nothing links a material to a budget line.
→ **Recommendation:** add `budget_item_material_mappings` join. Reference the budget item by **`budgetItemTrackId`** (the stable revision-independent id), not the row `id`, because budget items revision in place — a row-id FK would dangle on every edit. Columns: `(budgetItemTrackId, materialId, createdAt)` unique `(budgetItemTrackId, materialId)`; `createdAt` = `(unixepoch())` seconds (see convention above).

New schema files (if approved): `home/budget_item_material_mappings.ts`, `showroom/product_material_mappings.ts`, plus a column add to `materials/schedule_item.ts` — each re-exported from its domain barrel. `worker-configuration.d.ts` is regenerated, never hand-edited.

---

## 8. Frontend documentation site

Static Astro, dark Monolith, `<Navbar/>`, mobile-responsive — new route group `src/frontend/pages/mcp/`:

- **`/mcp` — Connect guide.** What the server is; the claude.ai custom-connector walkthrough (§4.4) with the connector URL; Claude Code / curl bearer-token usage; scopes; auth model; troubleshooting. Hand-written prose (updated when the *connection flow* changes).
- **`/mcp/tools` — Tool catalog (auto-generated).** Imports the registry metadata at SSR time and renders one card per tool grouped by category: name, description, annotations (read-only / writes / destructive badges), input fields (from the Zod schema), and examples. **Because it reads the registry, new tools appear with zero extra doc work** — the only manual step is prose for genuinely new *concepts*.
- Linked from the Navbar/docs nav so it is discoverable.
- Also surface the tool list on `/context` (LLM-ingestible) from the same registry.

Optional (nice-to-have, Phase 3): a "Copy connector URL" button and a live "test connection" panel gated behind the access cookie.

---

## 9. `AGENTS.md` maintenance contract

Add an **"MCP Server"** section to root `AGENTS.md` stating:
- The server lives at `/api/mcp`, is OAuth-gated (`@cloudflare/workers-oauth-provider`), and the tool source of truth is `src/backend/mcp/registry.ts`.
- **To add a tool:** create/extend a `src/backend/mcp/tools/<domain>.ts` entry (name `remodel_*`, Zod input, annotations, ≥1 example, handler). It is picked up by the server, `/mcp/tools`, and `/context` automatically.
- **Mandatory:** if the tool introduces a new concept or changes the connection flow, update the prose on `/mcp` (and `/mcp/tools` cards render automatically — verify them). A tool without a registry entry or with a stale description is a defect.
- Auth rules: read tools → `remodel:read`; write tools → `remodel:write`; destructive tools flagged and require `remodel:write`.
- Migration discipline reminder: `db:generate` → `migrate:remote`; never raw SQL.

This section is the durable instruction so every future increment keeps the docs current.

---

## 10. Phased implementation plan

**Phase 0 — OAuth spine (no new tools).**
1. `pnpm add @cloudflare/workers-oauth-provider @modelcontextprotocol/sdk` (`agents` already installed for `agents/mcp`).
2. Create `OAUTH_KV`; add KV + `RemodelMcpAgent` DO binding + **migration `v14`** to `wrangler.jsonc`; `pnpm run cf-typegen`.
3. Wrap `src/_worker.ts` default export in `OAuthProvider`; move current handler to `defaultHandler`; add `RemodelMcpAgent` to the DO exports.
4. Build `/oauth/authorize` approval UI (reuses `WORKER_API_KEY`).
5. Scaffold `src/backend/mcp/{types,registry}.ts` + `RemodelMcpAgent` (`agents/mcp`, registers tools from the registry via the SDK `McpServer`) + `tools/legacy.ts`; port the **existing** tools unchanged; preserve bearer/cookie/research-token back-compat.
6. Verify: `.well-known` docs resolve; MCP Inspector connects via OAuth; existing bearer path still works; claude.ai custom-connector handshake succeeds end-to-end; every top-level route (Astro pages, `/api/*`, agent WS, legacy 301s) still serves through `defaultHandler`.

**Phase 1 — Read tools + docs site.**
7. `tools/rooms.ts`, `budget.ts`, `materials.ts`, `showrooms.ts`, `brands.ts`, `products.ts` — the **read** (`R`) tools from §6.
8. `/mcp` connect guide + `/mcp/tools` auto-catalog; wire `/context`.
9. `AGENTS.md` MCP section.

**Phase 2 — Write & link tools.**
10. Confirm §7 decisions → `db:generate` the migrations (A/B/C) → `migrate:remote`.
11. Create/update/link/note/POC tools across all domains, incl. `ensure_*` primitives.

**Phase 3 — Budget analytics + reconciliation + polish.**
12. `remodel_get_budget_report`, `remodel_get_reallocation_options`, `remodel_reconcile_purchase`.
13. Evaluations (§12); docs polish.

Each phase ends with `pnpm run build` + `tsc --noEmit` (filtered to changed files — build doesn't type-check, per memory) + MCP Inspector smoke.

---

## 11. Open questions — RESOLVED (see §0)

All six answered and locked on 2026-07-08: (1) ✅ workers-oauth-provider · (2) ✅ MCP SDK via `McpAgent` (`agents/mcp`) · (3) ✅ migrations A/B/C · (4) ✅ public docs · (5) ✅ single `remodel` full-parity scope · (6) ✅ no prefix. Nothing outstanding — cleared to start Phase 0 on Justin's go-ahead.

---

## 12. Testing & evaluation

- **MCP Inspector** (`npx @modelcontextprotocol/inspector`) against the deployed OAuth flow each phase.
- **10 eval questions** (mcp-builder Phase 4) once read tools land — read-only, verifiable, e.g. "Which room has the largest gap between estimated-high and recorded actuals?", "How many showrooms carry the brand X?", "Which materials for the primary bath are not yet purchased?" — stored as `docs/0015_mcp_server/evaluations.xml`.
- **Health:** extend `/health` with an MCP subcheck (registry loads, OAUTH_KV reachable).
- **Back-compat regression:** existing bearer-token render/measurement/deep-research calls must pass unchanged.

---

## 13. Risks & mitigations
- **Wrapping the worker default export** — highest-blast-radius change. Mitigate: `defaultHandler` is the verbatim current handler; OAuthProvider only claims `/oauth/*`, `/.well-known/*`, and the two api routes; smoke every top-level path (Astro pages, `/api/*`, agent WS, legacy 301s) in Phase 0.
- **DO migration tag `v14`** — `McpAgent` adds a Durable Object, extending the migration-tag chain (currently ends at v13). Per the DO-tag-desync memory, branch deploys advance the prod worker's tag: land `v14` on `main` cleanly and rebase siblings, or an unmerged branch will block other deploys (error 10074). Sequence the merge accordingly.
- **Budget revisioning** — link tools must target `trackId`, not row `id`, or links dangle on edits (§7-C).
- **drizzle-zod build break** — tool schemas are **hand-written Zod v4**; never import drizzle-zod (repo memory).
- **Secrets** — no new secret needed; OAuth tokens are minted by the provider into `OAUTH_KV`; login reuses `WORKER_API_KEY`.
