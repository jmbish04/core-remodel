/**
 * @fileoverview Self-healing re-scrape for showrooms whose website scrape never
 * ran or failed.
 *
 * Why this exists: `scrapeUrl` read `result.html` while Browser Rendering returns
 * the page under `result.content`, so every scrape captured an EMPTY page —
 * silently. 57 stores were marked "complete" having stored nothing but a
 * screenshot (no brands, no socials, no hours text, empty RAG corpus,
 * accessLevel stuck UNKNOWN), and 73 more were never scraped at all.
 *
 * With the scraper fixed, this cron drains the backlog: any store that has a
 * WEBSITE link and an `idle`/`failed` scrape gets its workflow kicked. Kicking
 * flips the store to `pending`, so a store is never picked twice — that also
 * means a genuinely content-free site can't put us in a re-scrape loop (it ends
 * at complete/failed and stays there).
 *
 * Paced by DRAIN, not by clock: see {@link MAX_IN_FLIGHT}. The first version
 * kicked 3/min unconditionally, which was fine while every scrape no-op'd on a
 * blank page in milliseconds — and fell over the moment the scraper started doing
 * real work, piling up instances until `create()` threw `internal error` and
 * stranding stores in `pending`.
 *
 * To replay the "complete but captured nothing" victims, reset them once:
 *   UPDATE showroom_stores SET scrape_status='idle' WHERE id IN (...)
 * and this drains them on the next ticks.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { showroomStoreLinks, showroomStores } from "@backend/db/schema/showroom/index";

import { kickShowroomScrape } from "./onboarding";

/** Stores kicked per tick. */
const BATCH = 3;

/**
 * Hard ceiling on scrapes in flight (pending + running). Once the scraper started
 * actually rendering pages (waitUntil=networkidle2, up to MAX_PAGES each), a store
 * takes MINUTES rather than seconds — so kicking 3/min unconditionally piled up
 * instances until `SHOWROOM_SCRAPE_WORKFLOW.create()` started throwing
 * `internal error`. Drain-based pacing instead of blind pacing: only top up when
 * the pipe has room, which self-tunes to however slow the renders actually are.
 */
const MAX_IN_FLIGHT = 6;

export async function reScrapeStaleShowrooms(
  env: Env,
): Promise<{ kicked: number; remaining: number; inFlight: number }> {
  const db = drizzle(env.DB);

  // Back off while the pipe is full rather than queueing more doomed creates.
  const [flight] = await db
    .select({ n: count() })
    .from(showroomStores)
    .where(inArray(showroomStores.scrapeStatus, ["pending", "running"]))
    .all();
  const inFlight = flight?.n ?? 0;
  if (inFlight >= MAX_IN_FLIGHT) return { kicked: 0, remaining: -1, inFlight };

  const room = Math.min(BATCH, MAX_IN_FLIGHT - inFlight);

  // Candidates: a WEBSITE link to crawl + a scrape that never ran or failed.
  const candidates = await db
    .select({ id: showroomStores.id, url: showroomStoreLinks.url })
    .from(showroomStores)
    .innerJoin(
      showroomStoreLinks,
      and(
        eq(showroomStoreLinks.storeId, showroomStores.id),
        eq(showroomStoreLinks.type, "WEBSITE"),
      ),
    )
    .where(inArray(showroomStores.scrapeStatus, ["idle", "failed"]))
    .limit(room + 1)
    .all();

  const batch = candidates.slice(0, room);
  if (batch.length === 0) return { kicked: 0, remaining: 0, inFlight };

  let kicked = 0;
  for (const store of batch) {
    try {
      // kickShowroomScrape flips the store to 'pending' + a fresh ragUuid, which
      // is what removes it from this query's candidate set on the next tick.
      await kickShowroomScrape(env, store.id, store.url);
      kicked++;
    } catch (err) {
      // kickShowroomScrape writes 'pending' BEFORE creating the workflow, so a
      // failed create strands the store in 'pending' — invisible to this query
      // (idle/failed only) and therefore never retried. Put it back to 'failed'
      // so the next tick can pick it up. Without this, 34 stores silently
      // orphaned themselves the first time create() started erroring.
      console.error(`[scrape-backfill] kick failed for showroom ${store.id}:`, err);
      try {
        await db
          .update(showroomStores)
          .set({ scrapeStatus: "failed", updatedAt: new Date() })
          .where(eq(showroomStores.id, store.id));
      } catch (resetErr) {
        console.error(`[scrape-backfill] could not un-strand showroom ${store.id}:`, resetErr);
      }
    }
  }

  return { kicked, remaining: Math.max(0, candidates.length - batch.length), inFlight };
}
