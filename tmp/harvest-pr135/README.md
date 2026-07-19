# Harvest — PR #135 (`claude/showroom-listing-500-map-6kvtm9`)

Snapshot of PR #135's files, taken before closing it, so its work is **retrofitted
rather than rewritten**. Not part of the build — `tmp/` is scratch. Delete this
directory once everything below is either landed or explicitly dropped.

PR #135 was opened 2026-07-14 and went stale: 19 commits landed on `main` under it,
and `src/backend/mcp/tools/showrooms.ts` (its main target) was split into
one-file-per-tool at `src/backend/mcp/tools/showrooms/*.ts`, so its MCP half could
never merge as written.

## Files

| file | what to take from it |
|---|---|
| `showrooms.ts` | The `backfill_showroom_media` MCP tool (~219 new lines in the patch). Needs porting into the per-tool layout as `src/backend/mcp/tools/showrooms/backfill_showroom_media.ts`. |
| `HoursContactModal.tsx` | The roomier modal + tap-to-call / tap-to-copy tiles. **No conflict** — PR #151 never touched this file. |
| `hours-status.ts` | `computeOpenBadge()` and its 4th state, `opening-soon`. Its `computePst()` / `hourRowsFromHoursJson()` are the same functions #151 landed as `pstNow()` / `hoursJsonToRows()` — take the badge logic only, not the duplicates. |
| `HoursMiniCard.tsx` | Superseded by #151's per-day line layout. Reference only. |
| `onboarding.ts` | One-line change: exports `runPhotoPipeline` so the backfill tool and intake enrichment share one implementation. |
| `pr135.patch` | Full diff vs its merge-base, for anything the table misses. |

## Already shipped elsewhere — do NOT re-port

- **Coordinate/region backfill** → `backfill_showroom_geo` is on `main` today.
  It covers stores that already have a `placeId`.

## The real gap #135 still fills

`backfill_showroom_geo` only helps stores that **have** a `placeId`. #135 adds a
Places **text search by name + address** to recover a placeId for the manual
entries that have none (~9 stores with no map pin), plus icon (favicon scrape,
no Google quota) and hero (Places photos → CF Images) backfill.
