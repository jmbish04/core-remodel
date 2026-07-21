# Drive visit state machine — park, dwell, depart

Status: **proposed** (not built). Written 2026-07-21, alongside PR #178.

## The idea

A drive list is a day of showroom stops. Today a stop is checked off when the
car parks near it, and that's the whole story. But the interesting fact isn't
*that* you stopped — it's **how long you were inside**. Ten seconds at a light
next to a tile shop is not a visit. Forty minutes is a visit worth a note.

Duration cannot be known at park time. It is only knowable on **departure** —
`departedAt − parkedAt`. So the vehicle feed drives a small state machine whose
whole job is to hold an open "you are parked here" fact until the car moves
again, then settle it.

## States

```
        no active drive
              │
              ▼
  ┌────────► IDLE ◄──────────────┐  (drive list deactivated / went home)
  │           │ car moving        │
  │           ▼                   │
  │        DRIVING ───────────────┤
  │           │ speed 0 / gear P  │
  │           ▼                   │
  │        PARKED ────────────────┘
  │           │ ≥ DWELL_MIN and a drive stop within MATCH_RADIUS
  │           ▼
  └──── VISIT PENDING ── car moves ──► VISIT SETTLED
```

- **PARKED** opens a park session row. The badge immediately reads
  `Arrived at {showroom}` when the position matches a stop on the active drive,
  or just `Parked` when it doesn't.
- **VISIT PENDING** survives the app being closed, the phone sleeping, and the
  driver walking away — it is a D1 row, not memory. This is the requirement that
  rules out doing any of this in the browser.
- **VISIT SETTLED** happens on the *next* movement: dwell is computed, the stop
  is marked visited, a store note is written, and the badge flips to
  `Navigating to {next showroom}, arriving in {n} min`.

## Why a short stop must not settle

`DWELL_MIN` (proposed: **10 minutes**) is the difference between a visit and a
red light. A stop under the threshold closes the session as `discarded` — no
check-off, no note, no rating prompt. Without this, a drive down a commercial
street auto-visits every showroom on it.

## Schema (proposed)

`tesla_park_sessions` — one row per park, in the APP db (it references drive
stops and showrooms, which live there; the raw event stream stays in TESLA_DB).

| column | type | note |
|---|---|---|
| `id` | INTEGER PK | |
| `drive_list_id` | FK → `drive_lists.id` | the drive that was active at park time |
| `drive_list_stop_id` | FK → `drive_list_stops.id`, nullable | matched stop, when within radius |
| `showroom_store_id` | FK → `showroom_stores.id`, nullable | resolved from the stop |
| `latitude` / `longitude` | REAL | where the car actually stopped |
| `parked_at` | timestamp | |
| `departed_at` | timestamp, nullable | null while VISIT PENDING |
| `dwell_seconds` | INTEGER, nullable | set on settle — stored, not recomputed |
| `status` | TEXT | `parked` \| `settled` \| `discarded` |
| `store_note_id` | FK → `store_notes.id`, nullable | the note this visit produced |

No denormalized names — the showroom name comes from a join, per AGENTS.md.

Open index: one partial unique index on `(drive_list_id)` where
`status = 'parked'`, so two concurrent open sessions are a database error rather
than a bug discovered later. Same lesson as `drive_lists.is_active`.

## Accuracy: this does NOT need the WebSocket

Polling is every 120s (see `services/tesla-poller.ts`). Against a 10-minute
threshold that is ±2 minutes on a dwell measurement — under 20% error on the
shortest qualifying visit, and proportionally less on a real one. **The state
machine can ship on the existing poller.** The WebSocket improves it to ~30s and
is worth doing, but is not a prerequisite; treating it as one would block a
useful feature behind a Durable Object with standing cost.

What the poller genuinely cannot supply is the badge's **ETA**. Fleet Telemetry
carries `MinutesToArrival` / `MilesToArrival` directly; `GET /{vin}/state` does
not. Until the stream lands, the badge says `Navigating to {showroom}` without a
time, or computes a rough ETA from the routes API — an extra billable call per
transition, which argues for just waiting.

## Badge states

| Vehicle | Badge |
|---|---|
| No active drive, or home | hidden |
| Moving | `{City}` + weather, live |
| Parked, no stop nearby | `Parked · {City}` |
| Parked, stop matched | `Arrived at {showroom}` |
| Moving after a settled visit | `Navigating to {next stop}, arriving in {n} min` |

The `Arrived at …` state persists across app restarts because it is read from
the open park session, not from a client-side timer.

## Ordering

1. **Park sessions + dwell + auto-check-off on the poller.** No new infra, no
   standing cost, works the next time a drive runs. Ships alone.
2. **Telemetry stream toggle + DO consumer.** Improves granularity to ~30s and
   unlocks `MinutesToArrival`; also fills `tesla_telemetry_events`, which is
   what the existing recording switch was built for.
3. **The badge**, fed by (2)'s fan-out. Needs a weather source — the vehicle
   stream carries no weather field, so this adds an external dependency and a
   new usage line.
4. **Sonar scan mode.** Its own project; the Places spend model is the design,
   not a detail (~$3.84/hour of scanning at 30s intervals with a strict field
   mask, ~$6.84/hour without). It must register as a metered provider in
   `services/usage/metering.ts` and inherit the existing circuit breaker rather
   than growing its own accounting.

## Decisions needed

- `DWELL_MIN` = 10 minutes? (Below this, nothing is recorded.)
- `MATCH_RADIUS` for "this park belongs to that stop" — 150m, as with home?
  Big-box parking lots argue for more; dense retail streets argue for less.
- Does settling a visit auto-write a store note, or stage a draft for review?
  Auto-writing means unreviewed prose in the record; staging means the note is
  only as good as the follow-up.
- Should a park at an unlisted showroom (no matching stop) surface as a
  "discovered a stop you didn't plan" prompt, or be ignored?
