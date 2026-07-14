/**
 * Scorched-earth changelog detail — the full developer record behind each phase
 * on /admin/changelog. Keyed by the entry `id` (= the detail page slug).
 *
 * Standard (see AGENTS.md): every non-trivial change ships a detail entry with
 * the problem, the approach, the exact API + MCP surface touched, the files, the
 * migration SQL, representative code, and a Mermaid ER diagram of the D1 tables
 * involved.
 */

export interface CodeCard {
  title: string;
  lang: "ts" | "tsx" | "sql" | "json" | "bash";
  code: string;
}

export interface DiagramCard {
  caption: string;
  /** Mermaid source (erDiagram / flowchart). */
  code: string;
}

export interface PhaseDetail {
  slug: string;
  problem: string;
  approach: string;
  /** API endpoints added/changed by this phase. */
  apiChanges: string[];
  /** MCP tools added/changed by this phase. */
  mcpChanges: string[];
  /** Key source files touched. */
  filesTouched: string[];
  migrations: { tag: string; sql: string }[];
  code: CodeCard[];
  diagrams: DiagramCard[];
}

export const CHANGELOG_DETAIL: Record<string, PhaseDetail> = {
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
    ],
    mcpChanges: [
      "set_showroom_address (NEW), set_showroom_links (NEW, replace-all), set_showroom_hours",
      "create_showroom_contact — same showroom-details field-out",
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
      "Collapse to ONE source of truth: the normalized per-day rows, renamed `showroom_store_hours`. The API/MCP accept a structured `hoursJson` PAYLOAD on write and the worker derives the rows + `is_open_weekends`; responses rebuild `hoursJson` from the rows so the frontend keeps a single model. The `hours_json` blob and the free-text columns are dropped; the parser is deduped onto one shared util.",
    apiChanges: [
      "POST /api/showroom-stores — accepts hoursJson payload → writes showroom_store_hours rows + is_open_weekends (no blob persisted)",
      "PUT /api/showroom-stores/:id — replace-all hours rows from hoursJson payload",
      "GET /api/showroom-stores + /:id — responses derive hoursJson from the rows (rowsToHoursJson)",
      "POST /api/showroom-stores/backfill/submit — hours fill-blanks now writes rows only",
    ],
    mcpChanges: [
      "set_showroom_hours (NEW) — { storeId, hoursJson } → replaces the store's hours rows + derives is_open_weekends",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/hours.ts (rename)",
      "src/backend/db/schema/showroom/stores.ts (drop hours_json / weekday_hours / weekend_hours)",
      "src/backend/utils/showroom-hours.ts (dedup + parseLegacyHoursText + rowsToHoursJson)",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/api/routes/mcp.ts",
      "src/frontend/components/showroom/hero/*, ShowroomsDirectoryApp.tsx",
    ],
    migrations: [
      { tag: "0082", sql: "ALTER TABLE `showroom_hours` RENAME TO `showroom_store_hours`;" },
      {
        tag: "0083",
        sql: "ALTER TABLE `showroom_stores` DROP COLUMN `weekday_hours`;\nALTER TABLE `showroom_stores` DROP COLUMN `weekend_hours`;",
      },
      { tag: "0089", sql: "ALTER TABLE `showroom_stores` DROP COLUMN `hours_json`;" },
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
    ],
    mcpChanges: ["(none — address is filled by the backfill route / place-import)"],
    filesTouched: [
      "src/backend/db/schema/showroom/stores.ts (add location_* columns)",
      "src/backend/services/google/maps.ts (placeAddressComponents + parseGoogleAddressComponents)",
      "src/backend/api/routes/showroom-backfill.ts",
    ],
    migrations: [
      {
        tag: "0084",
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
      "Introduce `showroom_store_links` (one typed row per URL) as the source of truth. API responses DERIVE the old flat fields from the links so read-side consumers are untouched; the pipeline reads the website via `getStoreWebsiteUrl`. Then drop the four columns.",
    apiChanges: [
      "POST/PUT /api/showroom-stores — accept a links[] payload (replace-all)",
      "GET/POST /api/showroom-stores/:id/links + PUT/DELETE /:id/links/:linkId (NEW) — granular link CRUD",
      "GET responses derive websiteUrl/instagramUrl/facebookUrl/pinterestUrl from links",
    ],
    mcpChanges: [
      "create_showroom_contact accepts a urls[] payload → routed to showroom_store_links",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/links.ts (new)",
      "src/backend/utils/showroom-links.ts (getStoreWebsiteUrl, getStoreLinksMap, linksToLegacyUrls, replaceStoreLinks)",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/services/showroom-scrape-workflow.ts + ShowroomResearchAgent/*",
    ],
    migrations: [
      {
        tag: "0085",
        sql: "CREATE TABLE `showroom_store_links` (\n  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n  `store_id` integer NOT NULL,\n  `url` text NOT NULL,\n  `type` text NOT NULL,\n  `url_notes` text,\n  `created_at` integer DEFAULT (unixepoch()) NOT NULL,\n  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,\n  FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON DELETE cascade\n);",
      },
      {
        tag: "0086",
        sql: "ALTER TABLE `showroom_stores` DROP COLUMN `website_url`;\nALTER TABLE `showroom_stores` DROP COLUMN `instagram_url`;\nALTER TABLE `showroom_stores` DROP COLUMN `facebook_url`;\nALTER TABLE `showroom_stores` DROP COLUMN `pinterest_url`;",
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
    ],
    mcpChanges: [
      "create_showroom_contact — same field-out payload, incl. businessCardFront/Back base64",
      "list_showroom_contacts",
      "list_failed_business_cards",
      "resolve_business_card",
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
        tag: "0087",
        sql: "CREATE TABLE `showroom_store_contacts` ( ... type text, first_name, last_name, office_phone_number, office_phone_extension, mobile_phone_number, fax_phone_number, email_address, is_texting_ok, best_contact_times_json, is_draft, draft_notes );\nCREATE TABLE `showroom_store_contact_log` ( ... store_contact_id, timestamp_contact_start/end, transcript_json, outcome_of_conversation, is_followup_needed );\nCREATE TABLE `showroom_store_contact_business_cards` ( ... store_id, contact_id, status, cf_image_url, image_json );",
      },
      { tag: "0088", sql: "ALTER TABLE `showroom_store_contact_business_cards` ADD `cf_image_url_back` text;" },
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
        text notes
        text first_name
        text last_name
        text office_phone_number
        text office_phone_extension
        text mobile_phone_number
        text fax_phone_number
        text email_address
        integer is_texting_ok
        text best_contact_times_json
        integer is_draft
        text draft_notes
    }
    showroom_store_contact_log {
        integer id PK
        integer store_id
        integer store_contact_id
        integer timestamp_contact_start
        integer timestamp_contact_end
        integer estimated_call_duration
        text transcript_json
        text context_of_conversation
        text outcome_of_conversation
        integer is_followup_needed
        text followup_notes
    }
    showroom_store_contact_business_cards {
        integer id PK
        integer store_id
        integer contact_id
        text status
        integer is_draft
        text draft_notes
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
      "When an inbound worker email does NOT match a directory company, match the sender to a showroom (website-domain / store-email / name) and register a contact from the Gemini-extracted signature; unmatched senders become draft contacts for the phonebook. De-dupes on sender email and never breaks classification.",
    apiChanges: [
      "email-handler processEmail → registerShowroomContactFromEmail (reuses POST /api/showroom-contacts field-out)",
    ],
    mcpChanges: ["(reuses create_showroom_contact via the shared fieldOutContacts)"],
    filesTouched: ["src/backend/services/email/email-handler.ts"],
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
};
