# showroom_stores cleanup — D1 ER diagrams

Validated with `pnpm run mermaid:validate docs/0015_showroom_stores_cleanup/diagrams.md`.
These are the focused per-phase diagrams embedded on the changelog detail pages
(`src/frontend/data/changelog-detail.ts`).

## Architecture overview (after)

The whole point of the cleanup: `showroom_stores` shed its inline columns into
typed child tables.

```mermaid
erDiagram
  showroom_stores ||--o{ showroom_store_hours : "hours"
  showroom_stores ||--o{ showroom_store_links : "urls"
  showroom_stores ||--o{ showroom_store_contacts : "people"
  showroom_store_contacts ||--o{ showroom_store_contact_log : "interactions"
  showroom_store_contacts ||--o{ showroom_store_contact_business_cards : "cards"
  showroom_stores {
    integer id PK
    text name
    text location_address
    text location_city
    text location_state
    integer is_open_weekends
  }
  showroom_store_hours {
    integer id PK
    integer showroom_id FK
    text day
    integer open_hour
    integer close_hour
  }
  showroom_store_links {
    integer id PK
    integer store_id FK
    text url
    text type
  }
  showroom_store_contacts {
    integer id PK
    integer store_id FK
    text type
    text first_name
    text last_name
    text email_address
    integer is_draft
  }
  showroom_store_contact_log {
    integer id PK
    integer store_contact_id FK
    text outcome_of_conversation
  }
  showroom_store_contact_business_cards {
    integer id PK
    integer contact_id FK
    text status
    text cf_image_url
  }
```

## Build timeline

```mermaid
gitGraph
  commit id: "Phase 1 hours"
  commit id: "Phase 2 address"
  commit id: "Phase 3 links"
  commit id: "Phase 4 contacts"
  commit id: "Phase 5 email"
  commit id: "changelog + docs"
```

## Phase 1 — Hours

```mermaid
erDiagram
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
  }
```

## Phase 2 — Address

```mermaid
erDiagram
  showroom_stores {
    integer id PK
    text location_address
    text location_street_number
    text location_street_name
    text location_city
    text location_state
    text location_zip_code
    text google_maps_link
  }
```

## Phase 3 — Links

```mermaid
erDiagram
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
  }
```

## Phase 4 — Contacts

Generated from the migrations via `pnpm run mermaid:erd -- --tables 'showroom_store_contact*'`.

```mermaid
erDiagram
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
        text transcript_json
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
        integer is_draft
    }
```

## Phase 5 — Email auto-populate

```mermaid
flowchart TD
  A["Inbound email (worker email)"] --> B{Matches a directory company?}
  B -- yes --> C[Company CRM]
  B -- no --> D[matchShowroomStore domain / email / name]
  D -- matched --> E[showroom_store_contacts mapped]
  D -- no match --> F[showroom_store_contacts is_draft = true]
  F --> G[Phonebook triage]
```
