# Feature proposals + preview changelog — design

**Status:** schema landed (migration 0112); API / MCP / frontend still to build.
**Branch:** `claude/showroom-touch-ux` (schema only — the build should get its own branch/PR)

## Problem

An idea gets worked out in conversation with an AI model — often a *non-coding*
chat, mid-discussion, when the idea surfaces. Weeks later a brand-new coding
agent picks it up with zero shared memory.

What survives that gap today is a summary. What dies is everything that made the
idea make sense: the alternatives that were considered and rejected, the "no,
because…", the constraints discovered halfway through, the specific phrasing of a
requirement that a paraphrase quietly changes. The coding agent then rebuilds a
lossy version of the plan from the summary — the telephone game — and the
divergence only shows up once the wrong thing is built.

Second problem: there is no way to submit an idea *as a proposal* from a
non-coding tool. The changelog documents work after the fact. An idea that occurs
during a design chat has nowhere to land.

## The artifact bundle

A **preview changelog entry** is already expressible: a `changelog_entries` row
with `status: "staged"`. What it lacks is the thinking behind it. `0112` adds
`changelog_proposals`, keyed by the entry slug, carrying:

| artifact | where it lives | why |
|---|---|---|
| **PRD.md** | D1 `prd_markdown` | Rendered on the preview page. Small enough to inline, and you want it queryable. |
| **DESIGN_BRIEF.md** | D1 `design_brief_markdown` | Same. Optional. |
| **PROMPT.md** | D1 `prompt_markdown` | The copy-paste prompt that starts a coding agent. Render with a copy button — this is the handoff artifact. |
| **CONTEXT.md** (raw transcript) | **R2** `feature-context/<slug>.md` + pointer in D1 | See below. |
| **TASKS.json** | D1 `plan_tasks`, via `plans.slug` | `plan_tasks` already has `taskKey`, `workstream`, `phase`, `changeType`, `status` — TASKS.json maps onto it directly. Don't invent a second task table. |

### Why the transcript goes to R2 and not D1

An assistant can dump a full transcript essentially for free — `cat` the session
file, no tokens spent re-typing it. That is exactly why this works, and exactly
why the blobs will be large and frequent. A real one measured **~450KB**.

Inlining that in D1 would:

1. **Bloat the database.** Prod D1 is ~27MB total today. A handful of transcripts
   is a measurable fraction of the whole database.
2. **Slow every query touching the table.** SQLite reads the full row; a
   `SELECT slug, status` would drag 450KB off disk per row.
3. **Risk the write path.** Large bound parameters are the fragile part of the
   D1 API.

So: prose that gets *rendered* stays in D1; the raw blob goes to
`ARTIFACTS_BUCKET` and is fetched only when someone opens it. This is the same
split `showroom-scrape-workflow` already uses for page markdown — follow it.

Store `context_bytes` so the UI can warn before fetching, and `context_sha256`
so a re-submitted conversation dedupes instead of piling up.

### Partial transcripts are the norm — say so

The observed dump covered the session only **up to a compaction boundary**; the
rest was summarized elsewhere. A reader who assumes a transcript is complete will
draw confident, wrong conclusions from a gap. `context_coverage_note` is where
the submitter states what the dump does and does not include, and the UI must
render it *next to* the transcript link, not buried.

## Still to build

### 1. API (`src/backend/api/routes/changelog.ts`)

- `POST /api/changelog/proposals` — upsert by slug. Accepts the markdown fields
  inline plus `context` as either a body field or a second multipart part;
  streams the context to R2, hashes it, writes the pointer. Optionally accepts
  `tasks[]` and seeds `plans` + `plan_tasks` in the same call.
- `GET /api/changelog/proposals/:slug` — bundle metadata (never the raw blob).
- `GET /api/changelog/proposals/:slug/context` — streams the R2 object.

### 2. MCP tools (`src/backend/mcp/tools/changelog/`, one file per tool)

- `submit_feature_proposal` — the whole point: a non-coding AI chat can file a
  proposal mid-conversation. Takes PRD / design brief / prompt / tasks / context.
- `get_feature_proposal` — a coding agent pulls the bundle back, including the
  transcript, before it starts.
- `list_feature_proposals` — filter by status.
- Register in the tool registry alongside the existing categories.

### 3. Script parity (`scripts/changelog/`)

Same three operations as `.mjs`, using `scripts/config.mjs` + `scripts/tokens.mjs`,
for coding agents that have no MCP connection. Do not duplicate logic — both
paths should call the same API.

### 4. Frontend (preview changelog)

On `/admin/changelog/preview/:slug`, render: PRD, design brief, PROMPT (with copy
button), linked plan tasks with live status, and the transcript link + coverage
note + size.

### 5. Changelog template additions (the "4.1" requirements)

Extend `PhaseDetail` (`src/frontend/data/changelog-detail.ts`) and the entry view
with a `verification` block, and surface on every entry:

- git **branch** and **PR number** (branch already renders; PR does not)
- **tests run** — the QC script path, its source snippet, and its real output
- **remote migration status** — each migration tag and whether it has been
  applied to the remote DB

`PhaseDetail` is stored in `changelog_entries.detail_json`, so extending the TS
type needs **no migration**.

## Notes for whoever builds this

- Nothing here should re-summarize the transcript on write. The value is the
  unprocessed text; a model paraphrasing it on the way in defeats the purpose.
- `slug` is deliberately not a hard FK to `changelog_entries` — a proposal can
  exist before its changelog entry, branch, or PR do. Upsert the entry alongside.
