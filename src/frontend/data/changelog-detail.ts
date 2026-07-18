/**
 * Full developer record behind each changelog entry on /admin/changelog.
 * Keyed by the entry `id` (= the detail page slug at /admin/changelog/:id).
 *
 * Standard (see AGENTS.md): every non-trivial change ships a detail entry with
 * the problem, the approach, the exact API surface touched, the files, the
 * migration SQL, representative code, and (where useful) a Mermaid diagram.
 * Seeded/fallback here, then persisted to D1 (changelog_entries.detail_json).
 */

export interface CodeCard {
  title: string;
  lang: "ts" | "tsx" | "sql" | "json" | "bash";
  code: string;
}

export interface DiagramCard {
  caption: string;
  code: string; // Mermaid source
}

/**
 * What was actually run to prove the change works (AGENTS.md § Changelog
 * discipline). `output` is pasted verbatim from the run — never paraphrased —
 * so a reader can answer "is this actually live and actually verified?" without
 * leaving the page. `migrationsApplied` records remote-DB state per tag, since
 * migrations do NOT ride the branch build.
 */
export interface VerificationBlock {
  /** Repo path of the QC script, e.g. "scripts/qc/pr_152.mjs". */
  script: string;
  /** The command that was run, e.g. "pnpm run test:pr 152". */
  command: string;
  /** Real stdout from that command. */
  output: string;
  /** Per-migration remote-apply state; empty when the PR changed no schema. */
  migrationsApplied?: { tag: string; appliedToRemote: boolean }[];
}

export interface PhaseDetail {
  slug: string;
  problem: string;
  approach: string;
  apiChanges: string[];
  filesTouched: string[];
  migrations: { tag: string; sql: string }[];
  code: CodeCard[];
  diagrams: DiagramCard[];
  verification?: VerificationBlock;
}

export const CHANGELOG_DETAIL: Record<string, PhaseDetail> = {
  "showroom-soft-delete": {
    slug: "showroom-soft-delete",
    problem:
      "DELETE /api/showroom-stores/:id destroyed the row. A showroom is the parent of notes, photos, ratings, price observations, brand/product mappings and drive stops, and on D1 that delete cascades — so removing a store you no longer care about also erased every visit you ever logged there, irreversibly. There was no way to take a showroom out of the directory without losing its history.",
    approach:
      "Add `is_active` (default true) and make DELETE a flag flip, with POST /:id/restore to undo it. The column is the easy half — a flag nothing reads changes nothing, so the substance of this change is an audit of every query that lists or searches showrooms. 34 of them now filter `is_active = 1`, across routes, MCP tools, both research agents and the cron sweeps. Three classes deliberately do NOT filter, because filtering them would itself be a bug: fetch-by-explicit-id (or a deleted store could never be inspected or restored), the placeId dedupe checks (an inactive row still holds the unique index, so skipping it turns a clean 409 into a raw UNIQUE-constraint failure), and joins that read a showroom only for a coordinate or label on a child row (drive stops, historical prices — the child is the entity). Two joins needed more than a WHERE: the catalog filters in its ON clause, because a WHERE on an outer join would have dropped every unmapped product from the catalog entirely; and the phonebook keeps contacts with a null storeId, since a leftJoin yields NULL and NULL never equals true.",
    apiChanges: [
      "DELETE /api/showroom-stores/:id — now a SOFT delete (is_active = 0); returns { success, id, isActive: false }",
      "POST /api/showroom-stores/:id/restore — NEW; flips is_active back to 1",
      "GET /api/showroom-stores — now excludes inactive stores (the filter also applies under search/price/city/hub filters)",
      "GET /api/showroom-stores/:id — unchanged; still resolves an inactive store so it can be inspected and restored",
      "GET /api/showroom-stores/meta/place-exists — unchanged BY DESIGN; still sees inactive rows, because they still hold the unique placeId index",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/stores.ts",
      "drizzle/0113_dapper_white_queen.sql",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/api/routes/showroom-catalog.ts",
      "src/backend/api/routes/showroom-products.ts",
      "src/backend/api/routes/showroom-sales.ts",
      "src/backend/api/routes/showroom-backfill.ts",
      "src/backend/api/routes/showroom-contacts.ts",
      "src/backend/api/routes/brands.ts",
      "src/backend/api/routes/mcp.ts",
      "src/backend/mcp/tools/showrooms/list_showrooms.ts",
      "src/backend/mcp/tools/showrooms/backfill_showroom_geo.ts",
      "src/backend/mcp/tools/drives/analyze_drive_coverage.ts",
      "src/backend/mcp/tools/products/get_product.ts",
      "src/backend/mcp/tools/brands/get_brand.ts",
      "src/backend/ai/agents/ResearchAgent/methods/chat-tools.ts",
      "src/backend/ai/agents/ShowroomResearchAgent/methods/prompt-context.ts",
      "src/backend/services/product-research-workflow.ts",
      "src/backend/services/showroom-sourcing-monitor.ts",
      "src/backend/services/showroom/sales.ts",
      "src/backend/services/showroom/places-backfill.ts",
      "src/backend/services/deep-research-job-workflow.ts",
      "src/backend/services/email/showroom-contact-autopopulate.ts",
      "src/frontend/components/showroom/EditStoreModal.tsx",
      "src/frontend/components/showroom/StoreViewportApp.tsx",
    ],
    migrations: [
      {
        tag: "0113_dapper_white_queen",
        sql: "ALTER TABLE `showroom_stores` ADD `is_active` integer DEFAULT true NOT NULL;",
      },
    ],
    verification: {
      script: "scripts/qc/pr_154.mjs",
      command: "pnpm run test:pr 154",
      output: `PR #154 QC → https://core-remodel.hacolby.workers.dev

  ✓ target reachable (https://core-remodel.hacolby.workers.dev)
  ✓ GET /api/showroom-stores → 200 (migration 0113 applied)
  ✓ directory returned real rows to assert against
  ✓ POST /:id/restore exists (this PR is deployed — safe to exercise DELETE)
  ✓ restore reports isActive: true

  … soft-deleting "Excel Plumbing Supply Showroom" (id 141) — will be restored

  ✓ DELETE /api/showroom-stores/141 → 200
  ✓ delete reports isActive: false (soft, not hard)
  ✓ the row survives: GET /:id still returns it (soft delete, nothing erased)
  ✓ …and it reports isActive: false
  ✓ directory no longer lists it
  ✓ directory count dropped by exactly one
  ✓ a FILTERED directory query hides it too (predicate survives and(...))
    (MCP list_showrooms probe returned 404 — skipped)
  ✓ sales/clearance feed hides its rows
  ✓ placeId dedupe STILL sees it (else a re-add hits a UNIQUE constraint)
  ✓ restored "Excel Plumbing Supply Showroom" (id 141)
  ✓ directory count is back to where it started

16 passed, 0 failed`,
      migrationsApplied: [{ tag: "0113_dapper_white_queen", appliedToRemote: true }],
    },
    code: [
      {
        title: "Soft delete, and its undo",
        lang: "ts",
        code: `showroomStoresRouter.delete("/:id", async (c) => {
  // NOT db.delete(): the row parents notes, photos, ratings, price
  // observations and drive stops, and on D1 that cascade is irreversible.
  await db.update(showroomStores)
    .set({ isActive: false })
    .where(eq(showroomStores.id, storeId));
  return c.json({ success: true, id: storeId, isActive: false });
});`,
      },
      {
        title: "The catalog filters in the ON clause, not the WHERE",
        lang: "ts",
        code: `// A WHERE here would drop every UNMAPPED product from the catalog:
// the outer join yields NULL for them, and NULL never equals true.
.leftJoin(
  showroomStores,
  and(
    eq(showroomProductMappings.showroomId, showroomStores.id),
    eq(showroomStores.isActive, true),
  ),
)`,
      },
      {
        title: "The phonebook keeps contacts that belong to no store",
        lang: "ts",
        code: `conds.push(
  or(
    isNull(showroomStoreContacts.storeId),   // unattached contact — keep
    eq(showroomStores.isActive, true),       // attached — only if live
  ),
);`,
      },
    ],
    diagrams: [
      {
        caption: "What a soft delete does and does not reach",
        code: `flowchart LR
  Del["DELETE /:id — is_active = 0"] --> Hidden
  Del --> Kept
  Del --> Unaffected
  subgraph Hidden["Hidden (34 queries filter)"]
    D1["Directory + map"]
    D2["Catalog / product / brand"]
    D3["Clearance feed + cron"]
    D4["Field scan + backfills"]
    D5["MCP tools + agents"]
  end
  subgraph Kept["Kept on disk"]
    K1["Notes, photos, ratings"]
    K2["Price observations"]
    K3["Brand / product mappings"]
  end
  subgraph Unaffected["Still resolves by design"]
    U1["GET /:id (inspect + restore)"]
    U2["placeId dedupe (holds the unique index)"]
    U3["Drive stops (child is the entity)"]
  end
  Kept --> R["POST /:id/restore — is_active = 1"]`,
      },
    ],
  },
  "showroom-touch-ux": {
    slug: "showroom-touch-ux",
    problem:
      "The showroom viewport is used from a Tesla touchscreen, standing next to the car outside the showroom — and every control on it was sized for a mouse. The website and socials were 13px text hyperlinks; the open/closed badge was a 10px pill; 'Edit hours' and 'Edit address' were 28px-tall buttons crammed under the hours card; the hours modal capped at `max-w-lg` and buried tap-to-call under a scroll; 'Upload photo' fired a hidden file input with no target and no feedback; the categories checkboxes were 16px squares in a two-column grid. Nothing on the page was reliably hittable with a thumb.",
    approach:
      "Push tap targets to 48px+ and give the modals room. The hero's link text row becomes `HeroLinkButtons`: a wide Website button, then one same-size icon button per link type actually present in `showroom_store_links` (absent types render nothing, so the row is built from real data rather than a fixed grid), then the Links button — moved up from under the hours card. The four touch modals (hours, links, upload, categories) share one `TOUCH_DIALOG_CLASS` constant at ~80% of the viewport so 'same size as the hours modal' cannot drift. The hours modal leads with the three things you actually want while parked — Call / Copy address / Send to Tesla — reporting result INSIDE the button (green check, red X + reason), because a toast is easy to miss on a car screen. The open/closed badge goes full-width and picks up a fourth 'Opening Soon' state, retrofitted from the closed PR #135's `computeOpenBadge` (its `computePst`/`hourRowsFromHoursJson` duplicates were dropped in favour of the already-merged `pstNow`/`hoursJsonToRows`).",
    apiChanges: [
      "No new endpoints — the Navigate button reuses the existing POST /api/tesla/navigate ({lat,lng} preferred, {destination} fallback)",
      "GET /api/showroom-stores/:id — no shape change; the client type now models the latitude/longitude the payload already carried",
    ],
    filesTouched: [
      "src/frontend/components/showroom/hours-status.ts",
      "src/frontend/components/showroom/hero/HeroLinkButtons.tsx",
      "src/frontend/components/showroom/hero/UploadPhotoModal.tsx",
      "src/frontend/components/showroom/hero/touch-dialog.ts",
      "src/frontend/components/showroom/hero/HoursContactModal.tsx",
      "src/frontend/components/showroom/hero/HoursMiniCard.tsx",
      "src/frontend/components/showroom/hero/CategoryChipsEditor.tsx",
      "src/frontend/components/showroom/hero/StoreEditModals.tsx",
      "src/frontend/components/showroom/hero/SocialLinks.tsx",
      "src/frontend/components/showroom/hero/index.ts",
      "src/frontend/components/showroom/StoreViewportApp.tsx",
    ],
    migrations: [],
    verification: {
      script: "scripts/qc/pr_153.mjs",
      command: "pnpm run test:pr 153",
      output: `PR #153 QC → https://core-remodel.hacolby.workers.dev

  ── computeOpenBadge (pure) ──
  ✓ open: Wed 12:00 inside 9–17
  ✓ closing-soon: Wed 16:30 is within 60m of the 17:00 close
  ✓ opening-soon: Wed 07:00 is before the 9:00 open (NOT closed)
  ✓ closed: Wed 18:00 is after the 17:00 close
  ✓ closed: Sunday has no window at all
  ✓ open at exactly 9:00 (open is inclusive)
  ✓ closed at exactly 17:00 (close is exclusive)
  ✓ closing-soon at exactly 16:00 (the 60m boundary)
  ✓ null badge when there are no hours
  ✓ hoursJsonToRows drops closed days
  ✓ hoursJsonToRows round-trips into an 'open' badge

  ── deployed API contract ──
  ✓ target reachable (https://core-remodel.hacolby.workers.dev)
  ✓ showroom API rejects an unauthenticated read (401)
  ✓ GET /api/showroom-stores → 200
  ✓ directory returned real rows to assert against
  ✓ at least one store detail carries a non-empty links[] (hero icon row has data)
  ✓ every link row carries { url, type } (the icon row keys off type)
    store 141 links: WEBSITE
  ✓ store detail exposes latitude/longitude (Tesla Navigate payload)
  ✓ POST /api/tesla/navigate rejects an empty body (400)
  ✓ POST /api/tesla/navigate is admin-gated (401 unauthenticated)
    (a real navigate is NOT sent — it would start routing in the car)
  ✓ GET /api/showroom-stores/meta/categories → 200
  ✓ category vocabulary is non-empty (the checkbox grid has rows)

22 passed, 0 failed`,
    },
    code: [
      {
        title: "The fourth state — closed now, but open again later today",
        lang: "ts",
        code: `export function computeOpenBadge(hours: HourRow[], now: PstNow): OpenBadge | null {
  if (!hours || hours.length === 0) return null;
  const row = rowForDay(hours, now.day);
  if (row) {
    const open = openMinutes(row);
    const close = closeMinutes(row);
    if (now.minutes >= open && now.minutes < close) {
      return close - now.minutes <= 60 ? "closing-soon" : "open";
    }
    if (now.minutes < open) return "opening-soon";
  }
  return "closed";
}`,
      },
      {
        title: "One size constant for every touch modal",
        lang: "ts",
        code: `// max-w-none beats DialogContent's sm:max-w-sm (which would clamp w-[80vw]);
// flex flex-col beats its \`grid\` so the body can flex-1 into the height.
export const TOUCH_DIALOG_CLASS =
  "flex h-[80vh] max-h-[80vh] w-[80vw] max-w-none flex-col gap-4 overflow-hidden p-5 sm:max-w-none";`,
      },
      {
        title: "The link row is built from what the store actually has",
        lang: "tsx",
        code: `const iconLinks = ICON_ORDER.flatMap((type) => {
  const href = firstOfType(type);
  const Icon = LINK_ICONS[type];
  if (!href || !Icon) return [];       // absent type → renders nothing
  return [{ type, href, Icon, label: LINK_TYPE_LABELS[type] }];
});`,
      },
    ],
    diagrams: [
      {
        caption: "Hero → modal routing after the rework",
        code: `flowchart TD
  Hero["Showroom hero"] --> Web["Website button (new tab)"]
  Hero --> Icons["Icon button per registered link type"]
  Hero --> LinksBtn["Links"]
  Hero --> Card["Hours card (full-width badge)"]
  LinksBtn --> LinksModal["Links modal — list view"]
  LinksModal -->|pencil| LinksEdit["Add / edit form"]
  Card --> HoursModal["Hours + contact modal"]
  HoursModal --> Call["Call (tel:)"]
  HoursModal --> Copy["Copy address (clipboard)"]
  HoursModal --> Nav["Navigate — POST /api/tesla/navigate"]
  HoursModal --> EditHours["Edit hours"]
  HoursModal --> EditAddr["Edit address"]`,
      },
    ],
  },
  "changelog-preview": {
    slug: "changelog-preview",
    problem:
      "Two gaps. (1) The changelog pages were hand-rolled markup — the four installed `beste` blocks were only ever wired into a throwaway chooser page, so the spec'd layout (highlights + feed on the list; developer changelog + recap on the viewport) was never actually live. (2) There was no way to see what a PR WILL say before it deploys: the changelog only documents work after the fact, so stakeholders had no artifact to sign off on while a change was still proposed.",
    approach:
      "Treat the changelog and its preview as the same thing at two lifecycle stages, and render both through one shared view + one shared mapper — so what you approve in preview is literally the code that renders once it ships. `/admin/changelog` shows the full record; `/admin/changelog/preview` filters to `status: staged` (the drafted presser). The list renders changelog24 (highlights) + changelog3 (feed); the viewport renders diagrams, changelog19 (developer changelog + code), then changelog21 as the conclusion recap bucketed into Features / Fixes / Improvements. Diagrams use the shadcn-registry mermaid (mermaidcn) for zoom/pan, since a full architecture diagram is unreadable at fixed size.",
    apiChanges: [
      "No API change — reads the existing changelog_branches + changelog_entries tables",
      "GET /admin/changelog — full record (status-badged)",
      "GET /admin/changelog/[slug] — shipped viewport",
      "GET /admin/changelog/preview — proposed (staged) entries only",
      "GET /admin/changelog/preview/[slug] — proposal viewport",
      "GET /admin/changelog/blocks — the block chooser, moved off /preview",
    ],
    filesTouched: [
      "src/frontend/lib/changelog-blocks.ts",
      "src/frontend/components/changelog/ChangelogListView.astro",
      "src/frontend/components/changelog/ChangelogEntryView.astro",
      "src/frontend/pages/admin/changelog.astro",
      "src/frontend/pages/admin/changelog/[slug].astro",
      "src/frontend/pages/admin/changelog/preview/index.astro",
      "src/frontend/pages/admin/changelog/preview/[slug].astro",
      "src/frontend/pages/admin/changelog/blocks.astro",
      "src/frontend/components/sidebar/nav-groups.ts",
      "src/frontend/components/sidebar/shared.tsx",
    ],
    migrations: [],
    code: [
      {
        title: "One stage flag drives both pages",
        lang: "ts",
        code: `/**
 * - shipped -> /admin/changelog          (full record, status-badged)
 * - staged  -> /admin/changelog/preview  (the drafted presser)
 */
export type ChangelogStage = "shipped" | "staged";

const entries = entryRows
  // Preview = staged only; the changelog = the full record.
  .filter((r) => (stage === "staged" ? r.status === "staged" : true))
  .map(toEntry);`,
      },
      {
        title: "Recap columns — Features / Fixes / Improvements",
        lang: "ts",
        code: `// changelog21's conclusion board. \`removed\` + \`migration\` still exist in the
// data, so they get their own columns rather than being silently dropped;
// empty columns are not rendered.
const RECAP_COLUMNS = [
  { label: "Features",     color: "bg-emerald-500", kinds: ["added"] },
  { label: "Fixes",        color: "bg-blue-500",    kinds: ["fixed"] },
  { label: "Improvements", color: "bg-amber-500",   kinds: ["changed"] },
  { label: "Removed",      color: "bg-rose-500",    kinds: ["removed"] },
  { label: "Migrations",   color: "bg-violet-500",  kinds: ["migration"] },
];`,
      },
      {
        title: "Sidebar: stop Changelog lighting up on its own child",
        lang: "tsx",
        code: `// Changelog and its Preview twin are BOTH sidebar items, and Preview lives
// under /admin/changelog — so prefix-matching lit up both.
if (href === "/admin/changelog") {
  return (
    (currentPath === href || currentPath.startsWith(\`\${href}/\`)) &&
    !currentPath.startsWith("/admin/changelog/preview")
  );
}`,
      },
    ],
    diagrams: [
      {
        caption: "One template, two lifecycle stages — the preview IS the changelog, pre-deploy",
        code: `flowchart LR
    D1[("changelog_entries<br/>status: staged / shipped")]
    D1 --> L{stage}
    L -- "staged" --> P["/admin/changelog/preview<br/>the drafted presser"]
    L -- "shipped" --> C["/admin/changelog<br/>the full record"]
    P --> V["ChangelogListView<br/>SHARED"]
    C --> V
    V --> B24[changelog24<br/>release highlights]
    V --> B3[changelog3<br/>release feed]
    P2["/preview/[slug]"] --> EV["ChangelogEntryView<br/>SHARED"]
    C2["/changelog/[slug]"] --> EV
    EV --> MM[mermaidcn<br/>zoom + pan]
    EV --> B19[changelog19<br/>developer changelog + code]
    EV --> B21[changelog21<br/>Features / Fixes / Improvements]`,
      },
      {
        caption: "An entry's lifecycle — reviewed as a proposal, then kept as the record",
        code: `stateDiagram-v2
    [*] --> staged : branch registers its changelog rows
    staged --> staged : refine the presser (review loop)
    staged --> shipped : PR deploys to prod
    shipped --> [*] : permanent record

    note right of staged
      Visible at /admin/changelog/preview
      Sign off BEFORE it lands.
    end note
    note right of shipped
      Visible at /admin/changelog
      Same template, so the notes you
      approved are the notes that ship.
    end note`,
      },
    ],
  },
  "showroom-editing": {
    slug: "showroom-editing",
    problem:
      "Once normalized, the hours / address / links still needed to be CORRECTABLE — intake misses fields, Google Places is sometimes wrong, and a store can move. And a business card often carries generic store details (name, address, website, socials, phone, email) that belong to the showroom, not the person.",
    approach:
      "Dedicated correction endpoints + MCP tools for each (hours, address, links) so a human, a looping script, or an AI chat can fix them. The contact-create path additionally accepts optional `showroom` details: when present they fuzzy-match the store (id / placeId / website-domain / phone / email-domain / address / name) and FILL-BLANKS the store — address/phone/email onto the store row + GENERAL_CONTACT, website/socials into the links table. Never overwrites existing data.",
    apiChanges: [
      "PUT /api/showroom-stores/:id/hours — hoursJson → rows + is_open_weekends",
      "PUT /api/showroom-stores/:id/address — granular parts + formatted + maps link (zip columns synced)",
      "GET/POST /api/showroom-stores/:id/links + PUT/DELETE /:id/links/:linkId",
      "POST /api/showroom-contacts — person requires a name; accepts optional showroom{name,address,website,phone,email,instagram,facebook,pinterest} → match + fill store",
      "MCP: set_showroom_address (NEW), set_showroom_links (NEW, replace-all), set_showroom_hours; create_showroom_contact takes the same showroom-details field-out",
    ],
    filesTouched: [
      "src/backend/api/routes/showroom-stores.ts (/:id/hours, /:id/address)",
      "src/backend/api/routes/showroom-contacts.ts (matchStore + showroom fill)",
      "src/backend/api/routes/mcp.ts",
      "src/frontend/components/showroom/StoreViewportApp.tsx + intake",
    ],
    migrations: [],
    code: [
      {
        title: "Contact create with a business card's showroom details",
        lang: "json",
        code: `{
  "people": [{ "firstName": "Peter", "lastName": "Huynh", "emailAddress": "peter@davincimarble.com" }],
  "showroom": {
    "name": "DaVinci Marble", "website": "https://davincimarble.com",
    "phone": "(510) 895-4900", "email": "info@davincimarble.com",
    "address": "2000 Marina Blvd, San Leandro, CA", "instagram": "https://instagram.com/davincimarble"
  }
}
// → matches the store, fills its blank address/phone/email + GENERAL_CONTACT,
//   and adds the website + instagram to the links table.`,
      },
    ],
    diagrams: [
      {
        caption: "A business card's showroom details match the store and fill any blanks.",
        code: `flowchart TD
  A["create contact + showroom{...}"] --> B["matchStore (name / website / email / phone / address)"]
  B -- matched --> C["fill-blanks store row (address / phone / email)"]
  B -- matched --> D["upsert GENERAL_CONTACT (office / email)"]
  B -- matched --> E["website + socials to links table"]
  B -- no match --> F["contact saved as draft"]`,
      },
    ],
  },

  "showroom-hours": {
    slug: "showroom-hours",
    problem:
      "Opening hours were stored THREE ways: a `hours_json` blob column, free-text `weekday_hours` / `weekend_hours` columns, and the normalized `showroom_hours` table. They drifted, the hours parser was duplicated in two files, and it was unclear which was authoritative.",
    approach:
      "Collapse to ONE source of truth: the normalized per-day rows, renamed `showroom_store_hours`. The API/MCP accept a structured `hoursJson` PAYLOAD on write and the worker derives the rows + `is_open_weekends`; responses rebuild `hoursJson` from the rows so the frontend keeps a single model. The `hours_json` blob and the free-text columns are superseded — retained as @deprecated so the one-time backfill can read them, and dropped in a follow-up migration once confirmed on prod. The parser is deduped onto one shared util.",
    apiChanges: [
      "POST /api/showroom-stores — accepts hoursJson payload → writes showroom_store_hours rows + is_open_weekends (no blob persisted)",
      "PUT /api/showroom-stores/:id — replace-all hours rows from hoursJson payload",
      "GET /api/showroom-stores + /:id — responses derive hoursJson from the rows (rowsToHoursJson)",
      "POST /api/showroom-stores/backfill/submit — hours fill-blanks now writes rows only",
      "MCP: set_showroom_hours (NEW) — { storeId, hoursJson } → replaces the store's hours rows + derives is_open_weekends",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/hours.ts (rename → showroom_store_hours)",
      "src/backend/db/schema/showroom/stores.ts (hours_json / weekday_hours / weekend_hours → @deprecated)",
      "src/backend/utils/showroom-hours.ts (dedup + parseLegacyHoursText + rowsToHoursJson)",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/api/routes/mcp.ts",
      "src/frontend/components/showroom/hero/*, ShowroomsDirectoryApp.tsx",
    ],
    migrations: [
      {
        tag: "0108",
        sql: "CREATE TABLE `showroom_store_hours` ( ... showroom_id, day, open_hour, open_minute, close_hour, close_minute );\nCREATE UNIQUE INDEX `showroom_hours_showroom_day_unique` ON `showroom_store_hours` (`showroom_id`,`day`);\nDROP TABLE `showroom_hours`;\n-- hours_json / weekday_hours / weekend_hours retained (@deprecated) for the backfill; dropped in a follow-up migration.",
      },
    ],
    code: [
      {
        title: "Derive hoursJson from the rows (response back-compat)",
        lang: "ts",
        code: `export function rowsToHoursJson(rows): HoursJsonColumn {
  const out = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  for (const r of rows) {
    const key = ENUM_TO_DAY_KEY[r.day];
    if (!key) continue;
    out[key] = {
      open: \`\${pad2(r.openHour)}:\${pad2(r.openMinute)}\`,
      close: \`\${pad2(r.closeHour)}:\${pad2(r.closeMinute)}\`,
    };
  }
  return out;
}`,
      },
      {
        title: "hoursJson payload shape (write)",
        lang: "json",
        code: `{
  "mon": { "open": "09:00", "close": "17:00" },
  "sat": { "open": "10:00", "close": "15:00" },
  "sun": null
}`,
      },
    ],
    diagrams: [
      {
        caption: "showroom_store_hours is now the sole store of truth (one row per open day).",
        code: `erDiagram
  showroom_stores ||--o{ showroom_store_hours : "has (showroom_id->id)"
  showroom_stores {
    integer id PK
    text name
    integer is_open_weekends
  }
  showroom_store_hours {
    integer id PK
    integer showroom_id FK
    text day
    integer open_hour
    integer open_minute
    integer close_hour
    integer close_minute
  }`,
      },
    ],
  },

  "showroom-address": {
    slug: "showroom-address",
    problem:
      "`location_address` held city-only stubs like “San Carlos, CA”; `zip_code` was set on only 85 of 120 stores, and `google_maps_link` was empty everywhere. Nothing was queryable by city/state/street.",
    approach:
      "Add granular `location_*` columns and refresh them (plus the formatted address + maps link) from Google Places `addressComponents` for every place-linked store. Places is authoritative and overwrites the stubs.",
    apiChanges: [
      "POST /api/showroom-stores/backfill/addresses (NEW) — dry-run by default (?apply=true); refreshes granular parts + formatted address + google_maps_link from Places",
      "createStoreSchema accepts location_street_number/_street_name/_city/_state/_zip_code",
      "MCP: (none — address is filled by the backfill route / place-import)",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/stores.ts (add location_* columns)",
      "src/backend/services/google/maps.ts (placeAddressComponents + parseGoogleAddressComponents)",
      "src/backend/api/routes/showroom-backfill.ts",
    ],
    migrations: [
      {
        tag: "0108",
        sql: "ALTER TABLE `showroom_stores` ADD `location_street_number` text;\nALTER TABLE `showroom_stores` ADD `location_street_name` text;\nALTER TABLE `showroom_stores` ADD `location_city` text;\nALTER TABLE `showroom_stores` ADD `location_state` text;\nALTER TABLE `showroom_stores` ADD `location_zip_code` text;",
      },
    ],
    code: [
      {
        title: "Parse Google addressComponents → granular parts",
        lang: "ts",
        code: `export function parseGoogleAddressComponents(data): ParsedAddress {
  const comps = data.addressComponents ?? [];
  const pick = (type, short = false) => {
    const c = comps.find((x) => x.types?.includes(type));
    return c ? (short ? c.shortText : c.longText) : null;
  };
  return {
    formattedAddress: data.formattedAddress ?? null,
    streetNumber: pick("street_number"),
    streetName: pick("route"),
    city: pick("locality") ?? pick("postal_town"),
    state: pick("administrative_area_level_1", true),
    zipCode: pick("postal_code"),
    googleMapsUri: data.googleMapsUri ?? null,
  };
}`,
      },
    ],
    diagrams: [
      {
        caption: "Granular address columns on showroom_stores (blob address kept as the formatted display value).",
        code: `erDiagram
  showroom_stores {
    integer id PK
    text location_address
    text location_street_number
    text location_street_name
    text location_city
    text location_state
    text location_zip_code
    text google_maps_link
  }`,
      },
    ],
  },

  "showroom-links": {
    slug: "showroom-links",
    problem:
      "Website + social URLs lived as flat `website_url` / `instagram_url` / `facebook_url` / `pinterest_url` columns — no room for multiple links, no typing, and the scrape/research/favicon pipeline read the column directly from ~11 files.",
    approach:
      "Introduce `showroom_store_links` (one typed row per URL) as the source of truth. API responses DERIVE the old flat fields from the links so read-side consumers are untouched; the pipeline reads the website via `getStoreWebsiteUrl`. The four flat columns are retained as @deprecated for the one-time backfill and dropped in a follow-up migration.",
    apiChanges: [
      "POST/PUT /api/showroom-stores — accept a links[] payload (replace-all)",
      "GET/POST /api/showroom-stores/:id/links + PUT/DELETE /:id/links/:linkId (NEW) — granular link CRUD",
      "GET responses derive websiteUrl/instagramUrl/facebookUrl/pinterestUrl from links",
      "MCP: create_showroom_contact accepts a urls[] payload → routed to showroom_store_links",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/links.ts (new)",
      "src/backend/utils/showroom-links.ts (getStoreWebsiteUrl, getStoreLinksMap, linksToLegacyUrls, replaceStoreLinks)",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/services/showroom-scrape-workflow.ts + ShowroomResearchAgent/*",
    ],
    migrations: [
      {
        tag: "0108",
        sql: "CREATE TABLE `showroom_store_links` (\n  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n  `store_id` integer NOT NULL,\n  `url` text NOT NULL,\n  `type` text NOT NULL,\n  `url_notes` text,\n  `created_at` integer DEFAULT (unixepoch()) NOT NULL,\n  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,\n  FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON DELETE cascade\n);\n-- website_url / instagram_url / facebook_url / pinterest_url retained (@deprecated); dropped in a follow-up migration.",
      },
    ],
    code: [
      {
        title: "Responses derive the legacy flat fields from links",
        lang: "ts",
        code: `export function linksToLegacyUrls(links: StoreLinkRow[]): LegacyStoreUrls {
  return {
    websiteUrl: firstOfType(links, "WEBSITE"),
    instagramUrl: firstOfType(links, "INSTAGRAM"),
    facebookUrl: firstOfType(links, "FACEBOOK"),
    pinterestUrl: firstOfType(links, "PINTEREST"),
  };
}`,
      },
    ],
    diagrams: [
      {
        caption: "showroom_store_links — the URL source of truth (WEBSITE / INSTAGRAM / PINTEREST / FACEBOOK / OTHER).",
        code: `erDiagram
  showroom_stores ||--o{ showroom_store_links : "has (store_id->id)"
  showroom_stores {
    integer id PK
    text name
  }
  showroom_store_links {
    integer id PK
    integer store_id FK
    text url
    text type
    text url_notes
  }`,
      },
    ],
  },

  "showroom-contacts": {
    slug: "showroom-contacts",
    problem:
      "Contacts were a thin `showroom_pocs` table plus 3 denormalized `main_poc_*` columns. No contact types, no split first/last, no per-store general line, mixed phone strings (“… cell · … direct · … office”), and no interaction history or card scanning.",
    approach:
      "Three new tables. The API/MCP accept a structured payload and “field it out”: people → person rows, an office number/email/fax → the store's single GENERAL_CONTACT (fill-missing), URLs → links, address → the store row. A store is resolved explicitly or by fuzzy match (id/placeId/website-domain/phone/name); unmatched → draft. Business cards (front + back) upload to CF Images, run a vision extractor, and field into a contact; failed cards surface for a closed-loop resolve.",
    apiChanges: [
      "POST /api/showroom-contacts — smart create (people[], general{}, urls[], address, match{}, businessCardFront/Back base64)",
      "GET /api/showroom-contacts?q=&type=&storeId= — phonebook list (+ business card image)",
      "GET/PUT/DELETE /api/showroom-contacts/:id",
      "GET/POST/PUT/DELETE /api/showroom-contacts/contact-log[/:id] — interaction log CRUD",
      "POST /api/showroom-contacts/business-cards — bulk upload → vision → contact (background)",
      "GET /api/showroom-contacts/business-cards?status=failed + POST /:id/resolve — closed loop",
      "POST /api/showroom-contacts/backfill/from-pocs — migrate showroom_pocs + main_poc_*",
      "MCP: create_showroom_contact (field-out payload incl. businessCardFront/Back base64), list_showroom_contacts, list_failed_business_cards, resolve_business_card",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/contacts.ts (new)",
      "src/backend/utils/contact-intake.ts (splitFullName, parsePhoneField, inferContactType)",
      "src/backend/api/routes/showroom-contacts.ts (new)",
      "src/backend/api/routes/mcp.ts",
      "src/frontend/components/showroom/contacts/* + StoreViewportApp.tsx",
    ],
    migrations: [
      {
        tag: "0108",
        sql: "CREATE TABLE `showroom_store_contacts` ( ... type, first_name, last_name, office_phone_number, office_phone_extension, mobile_phone_number, fax_phone_number, email_address, is_texting_ok, best_contact_times_json, is_draft, draft_notes );\nCREATE TABLE `showroom_store_contact_log` ( ... store_contact_id, timestamp_contact_start/end, transcript_json, outcome_of_conversation, is_followup_needed );\nCREATE TABLE `showroom_store_contact_business_cards` ( ... store_id, contact_id, status, cf_image_url, cf_image_url_back, image_json );",
      },
    ],
    code: [
      {
        title: "Split a mixed phone string into labeled numbers",
        lang: "ts",
        code: `// "(510) 809-5741 cell · (510) 447-5016 direct · (510) 236-7960 office"
export function parsePhoneField(raw): LabeledPhones {
  // → mobile: cell/mobile, office: direct/desk, general: office/main (store line), fax
  //   The general number is routed to the store's GENERAL_CONTACT, not the person.
}`,
      },
      {
        title: "Smart create payload (API + MCP)",
        lang: "json",
        code: `{
  "match": { "website": "davincimarble.com", "name": "DaVinci Marble" },
  "people": [{ "fullName": "Peter Huynh", "title": "Sales",
    "phone": "(510) 809-5741 cell · (510) 236-7960 office", "emailAddress": "peter@..." }],
  "general": { "officePhoneNumber": "(510) 236-7960" },
  "urls": [{ "url": "https://davincimarble.com", "type": "WEBSITE" }],
  "businessCardFront": "data:image/jpeg;base64,...",
  "businessCardBack": "data:image/jpeg;base64,..."
}`,
      },
    ],
    diagrams: [
      {
        caption:
          "Contacts, their interaction log, and scanned business cards — generated from the migrations via `pnpm run mermaid:erd` and validated.",
        code: `erDiagram
    showroom_stores ||--o{ showroom_store_contacts : "has (store_id->id)"
    showroom_store_contacts ||--o{ showroom_store_contact_business_cards : "has (contact_id->id)"
    showroom_store_contacts ||--o{ showroom_store_contact_log : "has (store_contact_id->id)"
    showroom_store_contacts {
        integer id PK
        integer store_id
        text type
        text first_name
        text last_name
        text office_phone_number
        text mobile_phone_number
        text email_address
        integer is_draft
    }
    showroom_store_contact_log {
        integer id PK
        integer store_contact_id
        text outcome_of_conversation
        integer is_followup_needed
    }
    showroom_store_contact_business_cards {
        integer id PK
        integer store_id
        integer contact_id
        text status
        text cf_image_url
        text cf_image_url_back
        text image_json
    }`,
      },
    ],
  },

  "showroom-email-contacts": {
    slug: "showroom-email-contacts",
    problem:
      "Inbound email from a showroom went nowhere useful — no contact was created, and there was no way to tie a sender to a showroom.",
    approach:
      "When an inbound worker email does NOT match a directory company, match the sender to a showroom (website-domain / store-email / name) and register a contact from the Gemini-extracted signature; unmatched senders become draft contacts for the phonebook. De-dupes on sender email and never breaks classification. The hook lives in a dedicated module wired into the refactored email pipeline.",
    apiChanges: [
      "email pipeline processEmail → registerShowroomContactFromEmail (reuses the POST /api/showroom-contacts field-out)",
      "MCP: (reuses create_showroom_contact via the shared fieldOutContacts)",
    ],
    filesTouched: [
      "src/backend/services/email/showroom-contact-autopopulate.ts (new)",
      "src/backend/services/email/pipeline.ts (wire-in, company-miss branch)",
    ],
    migrations: [],
    code: [
      {
        title: "Match a sender to a showroom by domain / name",
        lang: "ts",
        code: `async function matchShowroomStore(senderEmail, senderName, env) {
  const domain = senderEmail.split("@")[1]?.toLowerCase();
  if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
    const [link] = await db.select({ storeId: showroomStoreLinks.storeId })
      .from(showroomStoreLinks)
      .where(and(eq(showroomStoreLinks.type, "WEBSITE"),
                 like(showroomStoreLinks.url, \`%\${domain}%\`))).limit(1);
    if (link) return link.storeId;
  }
  // …store email domain, then fuzzy name match
}`,
      },
    ],
    diagrams: [
      {
        caption: "Inbound email → signature extraction → fielded showroom contact (mapped or draft).",
        code: `flowchart TD
  A["Inbound email (worker email)"] --> B{"Matches a directory company?"}
  B -- yes --> C["Company CRM"]
  B -- no --> D["matchShowroomStore (domain / email / name)"]
  D -- matched --> E["showroom_store_contacts (mapped)"]
  D -- no match --> F["showroom_store_contacts (is_draft = true)"]
  F --> G["Phonebook triage"]`,
      },
    ],
  },

  "email-structured-extraction": {
    slug: "email-structured-extraction",
    problem:
      "The inbound-email classifier called Gemini with responseMimeType=application/json but the schema lived only in the prompt text, so the model free-wrote its JSON. On a Costco order that printed the total ($5,105.33), tax, shipping, and discount, it still flagged 'The email does not explicitly state the total… check your payment method for the final charge.' It also captured only description/qty/unitPrice/total per line — no brand, model, discount, shipping, or merchant metadata.",
    approach:
      "Pass a native @google/genai responseSchema (config.responseSchema) so the model must emit exactly the shape we ask for — every total/tax/shipping/discount and per-item brand/model/variant is a first-class property. Enrich the prompt + AiAnalysis interface to match. Add a guard that drops any 'amount unknown / check your payment method' payment flag once a total was actually extracted. The richer fields persist in extracted_raw_json (no migration), ready to surface in the HITL panel later.",
    apiChanges: [
      "No HTTP surface change — internal to the email pipeline (services/email/classify.ts).",
    ],
    filesTouched: [
      "src/backend/services/email/extraction-schema.ts (NEW — native responseSchema)",
      "src/backend/services/email/classify.ts (responseSchema + enriched interface/prompt + flag guard)",
    ],
    migrations: [],
    code: [
      {
        title: "Structured output, not prompt-embedded JSON",
        lang: "ts",
        code: `const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  config: {
    responseMimeType: "application/json",
    responseSchema: ANALYSIS_RESPONSE_SCHEMA, // <- forces every field
    temperature: 0.1,
  },
});
const analysis = JSON.parse(stripJsonFence(response.text || "")) as AiAnalysis;
dropContradictoryPaymentFlags(analysis); // no phantom "total unknown"`,
      },
    ],
    diagrams: [],
  },
  "changelog-persistent-d1": {
    slug: "changelog-persistent-d1",
    problem:
      "A per-branch markdown CHANGELOG.md gets overwritten and merge-conflicts, and there was no durable, shared record of what shipped across branches. Parallel branches would clobber each other's notes.",
    approach:
      "Move the changelog into D1: changelog_branches + changelog_entries, upserted by branch name / entry slug so it accumulates forever and is never clobbered. The overview reads D1 at SSR and falls back to bundled seed data when empty. Each entry carries a full detail_json record surfaced at /admin/changelog/:slug. AGENTS.md makes updating it mandatory every code turn and before every PR.",
    apiChanges: [
      "GET /api/changelog — branches with nested entries",
      "GET /api/changelog/:slug — one entry",
      "POST /api/changelog/branches — upsert branch",
      "POST /api/changelog/entries — upsert entry (append-only across branches)",
      "POST /api/changelog/seed — idempotent seed from bundled data",
    ],
    filesTouched: [
      "src/backend/db/schema/changelog/changelog.ts (NEW)",
      "src/backend/api/routes/changelog.ts (NEW) + api/index.ts mount",
      "src/frontend/data/changelog.ts + changelog-detail.ts (NEW)",
      "src/frontend/pages/admin/changelog.astro + changelog/[slug].astro",
      "AGENTS.md (Changelog discipline)",
    ],
    migrations: [
      {
        tag: "0107_ordinary_hawkeye",
        sql: `CREATE TABLE changelog_branches ( id integer PK, branch text UNIQUE, title, summary, date, status, pr_number, pr_url, created_at, updated_at );
CREATE TABLE changelog_entries ( id integer PK, slug text UNIQUE, branch, tag, area, title, summary, status, date, changes_json, migrations_json, detail_json, created_at, updated_at );`,
      },
    ],
    code: [
      {
        title: "Append-only upsert — a branch never overwrites another's rows",
        lang: "ts",
        code: `await db.insert(changelogEntries)
  .values({ slug: d.slug, branch: d.branch, /* … */ })
  .onConflictDoUpdate({ target: changelogEntries.slug, set: { /* … */ } });`,
      },
    ],
    diagrams: [
      {
        caption: "Branches accumulate in D1; entries append by slug and never overwrite.",
        code: `erDiagram
  changelog_branches ||--o{ changelog_entries : "branch"
  changelog_branches {
    string branch PK
    string title
    string status
  }
  changelog_entries {
    string slug PK
    string branch FK
    string title
    json   detail_json
  }`,
      },
    ],
  },
};
