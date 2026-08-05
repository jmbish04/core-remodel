# 0043 · Schema & interaction diagrams

> Visual companion to [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
> ✅ = built and applied to remote. Everything else is proposed.

---

## 1 · The physical model — rooms, walls, surfaces

```mermaid
erDiagram
  projects ||--o{ rooms : contains
  projects ||--o{ walls : bounds
  floors ||--o{ rooms : locates
  rooms ||--o{ room_measurements : measured_by
  rooms ||--o{ ceiling_features : has
  rooms ||--o{ room_existing_items : holds
  walls ||--o{ wall_face_segments : divides_into
  walls ||--o{ wall_openings : carries
  walls ||--o{ wall_planned_changes : planned
  rooms ||--o{ wall_face_segments : adjacent_across
  ceiling_features ||--o{ ceiling_feature_distances : located_by
  walls ||--o{ ceiling_feature_distances : referenced_by
  remodel_scenarios ||--o{ wall_planned_changes : scopes
  remodel_scenarios ||--o{ room_measurements : scopes_proposed

  projects {
    int id PK
    int property_id FK
    string title
    string project_type
  }
  floors {
    int id PK
    string key
    string name
    int is_physical "NEW"
  }
  rooms {
    int id PK
    int floor_id FK
    string room_code "stable join key"
    string room_name
    string line_color_hex "tint"
    int line_order
    real floorplan_x_pct
    real floorplan_y_pct
    string DEPRECATED_length_feet
    string DEPRECATED_notes_columns
  }
  room_measurements {
    int id PK
    int room_id FK
    string kind "EXISTING | PROPOSED"
    int scenario_id FK "required when PROPOSED"
    int length_inches
    int width_inches
    int ceiling_height_inches
    int perimeter_inches "unlocks paint + baseboard"
    string confidence
    string measured_by
  }
  walls {
    int id PK
    int project_id FK "NOT room - one wall, two spaces"
    int length_inches
    int height_inches
    string wall_kind "full|pony|partial|column|knee"
    string load_bearing "yes|no|unknown"
    string load_bearing_confidence
    string load_bearing_source
  }
  wall_face_segments {
    int id PK
    int wall_id FK
    string side "a|b"
    int from_inches "inches, NOT percent"
    int to_inches
    string adjacent_kind
    int adjacent_room_id FK
    string exterior_compass
    string exterior_relation
    string insulation_status
  }
  wall_openings {
    int id PK
    int wall_id FK
    string opening_kind
    int offset_from_left_inches
    int width_inches
    int height_inches
    int sill_height_inches
    int product_id FK
  }
  wall_planned_changes {
    int id PK
    int wall_id FK
    int scenario_id FK
    string change_kind "keep|resize|reposition|remove|add"
  }
  ceiling_features {
    int id PK
    int room_id FK
    string feature_kind
    int width_inches
    int length_inches
  }
  ceiling_feature_distances {
    int id PK
    int feature_id FK
    string feature_edge "N|E|S|W"
    int wall_id FK "real FK, not spanJson"
    int distance_inches
  }
  room_existing_items {
    int id PK
    int room_id FK
    string item_kind
    int width_inches
    int height_inches
    int depth_inches
    string disposition "keep|replace|remove|relocate"
    int product_id FK
  }
```

---

## 2 · Surfaces — assemblies, fixtures, requirements

The three primitives that replace eight would-be subsystems.

```mermaid
erDiagram
  surface_assemblies ||--o{ assembly_layers : ordered_stack
  surface_assemblies ||--o{ surface_fixtures : attached
  fixture_type_def ||--o{ surface_fixtures : types
  fixture_type_def ||--o{ fixture_requirements : demands
  assembly_layer_kind_def ||--o{ assembly_layers : types
  products ||--o{ assembly_layers : specified_as
  products ||--o{ surface_fixtures : specified_as
  remodel_scenarios ||--o{ surface_assemblies : scopes

  surface_assemblies {
    int id PK
    string surface_kind "wall_face|ceiling|floor"
    int surface_id
    int scenario_id FK
    string label
  }
  assembly_layers {
    int id PK
    int assembly_id FK
    int position "ordered"
    int layer_kind_id FK
    int product_id FK
    real thickness_inches
    string spec_json
  }
  assembly_layer_kind_def {
    int id PK
    string key "stud|insulation|mlv|drywall|membrane|finish"
    string display_name
    string takeoff_unit
    real default_waste_factor
  }
  surface_fixtures {
    int id PK
    string surface_kind
    int surface_id
    int fixture_type_id FK
    int offset_x_inches
    int offset_y_inches
    int product_id FK
    int scenario_id FK
  }
  fixture_type_def {
    int id PK
    string key "tv_mount|floating_vanity|rainfall_head"
    string display_name
    string applies_to_surface_kinds
  }
  fixture_requirements {
    int id PK
    int fixture_type_id FK
    string requirement_kind "blocking|electrical|plumbing|clearance|finish_coord"
    string spec
    int blocks_assembly_close "HARD sequencing constraint"
  }
```

**`blocks_assembly_close` is the highest-value column here.** A requirement that must be met before a wall or ceiling closes is a sequencing constraint, and missing it means opening a finished wall.

---

## 3 · Notes, problems, intent

```mermaid
erDiagram
  rooms ||--o{ room_notes : has
  room_notes ||--o{ room_note_type_mapping : typed_by
  room_note_type_def ||--o{ room_note_type_mapping : types
  rooms ||--o{ room_problems : has
  room_problems ||--o{ room_problem_type_mapping : typed_by
  room_problem_type_def ||--o{ room_problem_type_mapping : types
  room_problems ||--o{ room_problem_fix_mapping : addressed_by
  room_problem_fix_def ||--o{ room_problem_fix_mapping : fixes
  room_problems ||--o{ room_problem_photos : shown_by
  room_problems ||--o{ room_problem_documents : evidenced_by
  images ||--o{ room_problem_photos : stores
  impacts ||--o| room_problems : raised_as
  rooms ||--o{ room_intents : has
  room_intent_type_def ||--o{ room_intents : types
  impacts ||--o{ room_intents : caused

  room_notes {
    int id PK
    int room_id FK "the correction"
    string note_markdown
    string note_html
    string note_plaintext
    string author
  }
  room_note_type_mapping {
    int id PK
    int room_note_id FK "note, NOT room"
    int room_note_type_id FK
  }
  room_problems {
    int id PK
    int room_id FK
    string overview_markdown
    string severity
    int is_safety_hazard
    string status "suspected..wont_fix"
    int impact_id FK "links to 0041 graph"
    string discovered_during
    string resolved_at
  }
  room_problem_photos {
    int id PK
    int room_problem_id FK
    string photo_type "PROBLEM|SOLUTION_TO_BE|SOLUTION_AS_BUILT"
    string image_id FK "images.id, not a URL"
    int is_primary
    int is_active
  }
  room_problem_documents {
    int id PK
    int room_problem_id FK
    string rag_uuid
    string r2_key
    string sha_hash "UNIQUE - dedupe"
    string doc_text
    string ai_summary
    string ocr_status "null text vs no text"
  }
  room_intents {
    int id PK
    int project_id FK
    int room_id FK
    int intent_type_id FK
    int caused_by_impact_id FK "not a boolean"
    string status
  }
  room_intent_type_def {
    int id PK
    string key
    string scope_level "lives HERE, cannot drift"
    int requires_full_spec
  }
```

---

## 4 · The 0041 spine this hangs from ✅

```mermaid
erDiagram
  projects ||--o{ decisions : holds
  decisions ||--o{ decision_reopenings : reopened_by
  projects ||--o{ impacts : disrupted_by
  impact_definitions ||--o{ impacts : types
  impacts ||--o{ impact_targets : reaches
  impacts ||--o{ impact_blocks : blocks
  impacts ||--o{ impact_evidence : evidenced_by
  rooms ||--o{ room_stop_state : progresses
  rooms ||--o{ room_spec_fields : specifies
  spec_definitions ||--o{ room_spec_fields : defines

  impacts {
    int id PK
    int definition_id FK
    string status
    string source "rule|agent|conversation|contractor|homeowner|integration"
    string actor_party_kind
    int actor_company_id FK
    int confidence
    int cost_exposure_cents
    int days_exposure
  }
  impact_targets {
    int id PK
    int impact_id FK
    string target_kind "room|decision|budget_line|permit|delivery|contractor"
    int target_id
    string effect "reopens|delays|inflates|blocks|informs"
  }
  impact_blocks {
    int id PK
    int blocking_impact_id FK
    int blocked_impact_id FK
  }
  room_stop_state {
    int id PK
    int room_id FK
    string stop "HIGH-WATER, never retreats"
    string entered_by
  }
  room_spec_fields {
    int id PK
    int room_id FK
    int spec_definition_id FK
    int product_id FK
    int material_id FK
    string value_text
    int value_cents
    string confidence
    string waived_reason
  }
```

---

## 5 · Service interactions

The resolvers and engines, and what each is allowed to touch. **There is exactly one of each.**

```mermaid
classDiagram
  class ScopeResolver {
    +resolveRoomScope(scope, scopeRefId, roomIds) Room[]
    +applyToRooms(entityKind, entityId, rooms) MappingRow[]
    -chunkAt20() void
    -activeRoomsOnly() void
    note "one helper, six consumers"
  }
  class ReadinessResolver {
    +roomReadiness(roomId) RoomReadiness
    +evaluateRoomReadiness(required, fields) RoomReadiness
    -gatedByIntent() SpecDefinition[]
    note "assumed and range never satisfy"
  }
  class HealthResolver {
    +nodeHealth(kind, id) NodeHealth
    +blastRadius(origin) NodeHealth[]
    +canResolveImpact(id) Verdict
    +wouldCreateCycle(a, b) bool
    note "derived, never stored"
  }
  class StopGuard {
    +canAdvanceStop(current, next) Verdict
    note "refuses every backward move"
  }
  class RuleEngine {
    +match(trigger, context) Rule[]
    +resolve(rule) Resolution
    note "ripples + applicability + scoping"
  }
  class TakeoffEngine {
    +flooringSqft(roomId) Quantity
    +paintSqft(surfaceId) Quantity
    +baseboardLinearFt(roomId) Quantity
    +openingCounts(scope) Quantity
    -applyWasteFactor() void
    -reportConfidence() void
    note "computed, never stored"
  }

  ScopeResolver ..> RuleEngine : triggers applicability
  RuleEngine ..> HealthResolver : creates impacts
  HealthResolver ..> ReadinessResolver : blocks readiness
  ReadinessResolver ..> StopGuard : gates advancement
  TakeoffEngine ..> ScopeResolver : quantities per room
  TakeoffEngine ..> ReadinessResolver : confidence propagates
```

**Why one of each matters:** two readiness implementations would drift, and a drifting readiness guarantee tells a homeowner they are ready to face the trade when they are not.

---

## 6 · The chain — measurement to trade

```mermaid
flowchart LR
  M["MEASUREMENT<br/>walls, openings,<br/>perimeter, ceiling"] --> D["DISTINCTION<br/>load-bearing? tile or wood?<br/>wall-hung vanity?"]
  D --> R["RULE<br/>ripple_rules matches"]
  R --> I["IMPACT<br/>+ REQUIREMENT"]
  I --> MAT["MATERIAL<br/>assembly layers,<br/>fixtures"]
  MAT --> Q["QUANTITY<br/>area x layers x waste"]
  Q --> B["BUDGET<br/>per room, per line"]
  B --> S["SOURCING<br/>showroom, vendor,<br/>package quote"]
  S --> T["TRADE<br/>priceable scope,<br/>no site visit"]
  classDef start fill:#1f3a4d,stroke:#60a5fa,color:#fff
  classDef mid fill:#4d3d1f,stroke:#fbbf24,color:#fff
  classDef end fill:#1f4d2e,stroke:#4ade80,color:#fff
  class M,D start
  class R,I,MAT,Q mid
  class B,S,T end
```

**A distinction that does not move something along this chain was not worth capturing.**

---

## 7 · Ripple — remove the wall between kitchen and living room

```mermaid
flowchart TD
  A["wall_planned_changes<br/>wall 7 remove"] --> B["ripple_rules:<br/>wall_relocation"]
  B --> C["wall_face_segments:<br/>separates Kitchen and Living"]
  C --> D["impacts targeting BOTH<br/>effect reopens"]
  A --> E{"walls.load_bearing"}
  E -->|unknown| F["must_specify<br/>BLOCKS pending engineer"]
  A --> G["wall_openings:<br/>interior door removed"]
  G --> H["door takeoff minus 1"]
  A --> I["assembly_layers:<br/>drywall and paint drop"]
  F --> J["beam required<br/>ceiling assembly plus blocking"]
  C --> K["flooring continuous<br/>transition removed<br/>sqft recalculated"]
  H --> L["BUDGET<br/>demo, beam, patch, delta"]
  I --> L
  J --> L
  K --> L
  L --> M["SOURCING<br/>match existing flooring<br/>needs exact product_id"]
  M --> N["TRADE SCOPE<br/>remove wall 7, LB pending,<br/>patch and match product X"]
  classDef block fill:#4d1f1f,stroke:#f87171,color:#fff
  classDef money fill:#1f3a4d,stroke:#60a5fa,color:#fff
  class E,F block
  class L,M,N money
```

**Every arrow is data, not inference.** The system knows both rooms are affected because `wall_face_segments` says so; knows a door disappears because `wall_openings` says so; knows the flooring needs matching because `assembly_layers` holds the existing product id.

---

## 8 · Materials, rooms, budget — the relationship

```mermaid
flowchart TB
  subgraph PHYS["PHYSICAL"]
    RM["rooms"]
    WL["walls"]
    SA["surface_assemblies"]
    AL["assembly_layers"]
  end
  subgraph CAT["CATALOGUE"]
    MTD["material_type_def<br/>granularity, unit,<br/>waste factor"]
    MSI["material_schedule_items"]
    PR["products"]
    BR["brands"]
  end
  subgraph MONEY["MONEY"]
    TK["takeoff (computed)"]
    BI["budget_tracker_items"]
    PO["price observations"]
  end
  subgraph SRC["SOURCING"]
    SR["showrooms"]
    VQ["vendor package quote"]
  end
  RM --> SA
  WL --> SA
  SA --> AL
  MTD --> MSI
  MSI --> AL
  PR --> AL
  BR --> PR
  AL --> TK
  RM --> TK
  MTD --> TK
  TK --> BI
  PR --> PO
  PO --> BI
  MSI --> SR
  SR --> VQ
  VQ --> BI
  classDef p fill:#12263a,stroke:#60a5fa,color:#fff
  classDef c fill:#3a2a1f,stroke:#e0b080,color:#fff
  classDef m fill:#1f4d2e,stroke:#4ade80,color:#fff
  classDef s fill:#3a1f2a,stroke:#f87171,color:#fff
  class RM,WL,SA,AL p
  class MTD,MSI,PR,BR c
  class TK,BI,PO m
  class SR,VQ s
```

**The takeoff is the join.** It is the only thing that turns a physical fact into a number a budget can hold, and it is computed on read — never stored, because a stored quantity is wrong the first time a wall moves and nobody notices.

---

## 9 · Applicability — which branches are questions

```mermaid
flowchart TD
  A["Flooring applied<br/>whole house"] --> B{"Multiple levels?"}
  B -->|yes| C["CONFIRM<br/>whole house or one level"]
  C -->|one level| D["MUST SPECIFY<br/>stair strategy"]
  B -->|no| E{"Material family"}
  C -->|whole house| E
  E -->|tile| F["CONFIRM<br/>continue into bathrooms"]
  E -->|hardwood or carpet| G["AUTO EXCLUDE<br/>bathrooms differ<br/>do not ask"]
  classDef ask fill:#4d3d1f,stroke:#fbbf24,color:#fff
  classDef auto fill:#1f4d2e,stroke:#4ade80,color:#fff
  class C,D,F ask
  class G auto
```

**An app that asks both is a nag; one that asks neither is wrong.** Encoding which is which is the product.

---

## 10 · Scope fan-out

```mermaid
sequenceDiagram
  actor U as Homeowner
  participant UI as Stepper
  participant API
  participant DB
  U->>UI: pick material, tick "entire Upper Level"
  UI->>API: materialId, scope floor, scopeRefId 2
  API->>DB: resolve to 23 ACTIVE rooms on floor 2
  API->>DB: upsert 23 mapping rows, chunked at 20
  API->>DB: write room_scope_applications (the intent)
  DB-->>API: rows created, duplicates ignored
  API-->>UI: applied to 23 rooms on Upper Level
  Note over DB: consumers still join WHERE room_id = ?
```

---

## 11 · Voice capture on the floorplan

```mermaid
sequenceDiagram
  actor U as Homeowner
  participant FP as Floorplan canvas
  participant AG as Agent
  participant DB
  AG->>FP: plot the wall needing a measurement
  FP-->>U: dot appears on the plan
  U->>AG: "forty and a half inches"
  AG->>FP: draw it against that wall
  FP-->>U: is this the wall I mean
  U->>AG: confirm
  AG->>DB: write wall.length_inches with provenance
  Note over U,AG: the restatement IS the safety<br/>wrong wall would poison the dataset
```

---

## 12 · Lifecycles

```mermaid
stateDiagram-v2
  [*] --> suspected
  suspected --> confirmed
  confirmed --> fixing
  fixing --> resolved
  resolved --> accepted
  fixing --> reneged
  reneged --> escalated
  confirmed --> wont_fix
  accepted --> [*]
  escalated --> [*]
  wont_fix --> [*]
  note right of wont_fix
    deliberate and recorded,
    not silence
  end note
```

```mermaid
stateDiagram-v2
  [*] --> SOURCING
  SOURCING --> FIXTURES_LOCKED
  FIXTURES_LOCKED --> ROUGH_IN
  ROUGH_IN --> FINISH_SPEC
  FINISH_SPEC --> SIGNED_OFF
  SIGNED_OFF --> [*]
  note right of FINISH_SPEC
    HIGH-WATER: never retreats.
    A reopening is recorded
    beside it, not by moving it.
  end note
```

---

## 13 · How the three plans interlock

```mermaid
flowchart TB
  subgraph P43["0043 PHYSICAL"]
    W["walls, measurements,<br/>assemblies, fixtures"]
    RP["problems, notes,<br/>intents"]
  end
  subgraph P41["0041 DECISION"]
    IM["impacts, targets,<br/>blocks, evidence"]
    DC["decisions,<br/>reopenings"]
    RD["readiness, health"]
  end
  subgraph P42["0042 OBLIGATION"]
    CT["contract clauses,<br/>payment QC"]
    DS["disputes,<br/>contested items"]
  end
  W --> IM
  RP --> IM
  IM --> DC
  DC --> RD
  W --> RD
  RD --> CT
  IM --> DS
  CT --> DS
  classDef a fill:#12263a,stroke:#60a5fa,color:#fff
  classDef b fill:#1f3d2f,stroke:#4ade80,color:#fff
  classDef c fill:#3a1f2a,stroke:#f87171,color:#fff
  class W,RP a
  class IM,DC,RD b
  class CT,DS c
```

Each plan references the others **by id**, never by duplication. A room problem raises an impact; an impact blocks readiness; readiness gates what a contract may be asked to price.
