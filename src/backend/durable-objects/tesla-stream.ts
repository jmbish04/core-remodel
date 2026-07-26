/**
 * @fileoverview TeslaStreamDO — the outbound Fleet-Telemetry connector (0023 ING-02).
 *
 * WHY A DO, AND WHY IT'S DANGEROUS: Tessie's real-time telemetry is an OUTBOUND
 * WebSocket the client dials (`streaming.tessie.com/<vin>`), and an outbound socket
 * the worker holds is DURATION-BILLED the whole time — unlike an inbound hibernatable
 * socket. So this DO must only hold the socket when it earns its keep, and must be
 * incapable of running away. Both are enforced here:
 *
 *   1. LIFECYCLE — every alarm re-checks `shouldStreamNow(env)` (active drive ∧
 *      07:00–20:00 Pacific ∧ recording ∧ toggle). The moment that goes false —
 *      window close, car home, toggle off, drive ended — the socket closes, the
 *      alarm is deleted, and the DO goes dormant (~$0). It is re-armed only by the
 *      start route when a drive is activated.
 *   2. CIRCUIT BREAKER — every alarm fire runs the shared kill-switch + a native
 *      fire-rate window (reconnect-storm guard) + a per-day TESLA_DB write budget +
 *      a max-continuous-connected ceiling. Any trip hard-stops the DO (downtime is
 *      acceptable over billing — the $700 lesson).
 *
 * ALARMS ARE NATIVE (`ctx.storage.setAlarm`) — never the Agents-SDK `this.schedule()`,
 * which is append-only and caused the $700 `cf_agents_schedules` runaway. A DO has
 * exactly one alarm slot; `setAlarm` replaces, it cannot grow a table.
 *
 * FRAME PARSING is the shared `extractTelemetryFields` (services/tesla/frames.ts),
 * so this and the compat webhook/telemetry routes never diverge.
 *
 * ⚠️ WIRE-PROTOCOL ASSUMPTION (verify against a live car): the connect URL, the
 * `Upgrade: websocket` + bearer handshake, and the frame JSON shape follow the 0023
 * plan. Every path degrades to a logged no-op rather than throwing, and the whole
 * connector is start/stop-controllable, so a protocol mismatch is tunable without
 * risk of an always-on socket.
 */
import { teslaTelemetryEvents } from "@backend/db/schema/tesla";
import { maybeEndActiveDriveOnHomeArrival } from "@backend/services/drive-home-arrival";
import { matchAndMarkVisited } from "@backend/services/drive-geo-match";
import {
  evaluateFireWindow,
  readCircuitBreaker,
  tripCircuitBreaker,
  type FireWindow,
} from "@backend/services/safety/do-circuit-breaker";
import { getTessieConfig, sendNavigation } from "@backend/services/tesla";
import { extractTelemetryFields } from "@backend/services/tesla/frames";
import { finalizeSoftArrivals, stageSoftArrival } from "@backend/services/tesla/visit-sessions";
import {
  heartbeatStream,
  isAutoNavigateEnabled,
  setStreamConnected,
  shouldStreamNow,
} from "@backend/services/tesla/gating";
import { telemetryRecordingAllowed } from "@backend/services/tesla-integration";
import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

const DO_NAME = "TeslaStreamDO";

/** Reconnect backoff (native alarm), capped. */
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
/** Lifecycle/heartbeat cadence while connected. */
const HEARTBEAT_MS = 90_000;

/** Cost bounds — the circuit breaker trips past any of these. */
const FIRE_WINDOW_MS = 60_000;
/** Alarm fires per minute ceiling — a reconnect storm blows past this. */
const MAX_FIRES_PER_MIN = 20;
/** Per-UTC-day TESLA_DB write ceiling; a stuck-open firehose blows past this. */
const MAX_WRITES_PER_DAY = 150_000;
/** Max continuous connected time — longer than any daytime window, so only a
 *  failed lifecycle check reaches it. Backstop, not the primary bound. */
const MAX_CONNECTED_MS = 15 * 60 * 60 * 1000;

/** Persist at most this often per frame stream, EXCEPT always persist a shift change. */
const PERSIST_MIN_INTERVAL_MS = 5_000;

interface WriteBudget {
  /** UTC day key "YYYY-MM-DD". */
  day: string;
  count: number;
}

function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export class TeslaStreamDO extends DurableObject<Env> {
  /** The live outbound socket, held in memory only. */
  private ws: WebSocket | null = null;
  /** Last shift state seen, to detect transitions (park / drive-away). */
  private lastShift: string | null = null;
  /** Wall-clock of the last persisted frame, for the persist throttle. */
  private lastPersistMs = 0;
  /** Cached drizzle instances — the frame path is high-frequency. */
  private readonly teslaDb: ReturnType<typeof drizzle>;
  private readonly appDb: ReturnType<typeof drizzle>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.teslaDb = drizzle(env.TESLA_DB);
    this.appDb = drizzle(env.DB);
  }

  // ── Control API (called by the /api/tesla/stream routes via the DO stub) ──────
  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.split("/").pop();
    switch (action) {
      case "start":
        // Arm the lifecycle — the alarm does the actual connect after the guard.
        await this.ctx.storage.setAlarm(Date.now() + 100);
        return Response.json({ ok: true, ...(await this.statusPayload()) });
      case "stop":
        await this.disconnect("stopped via control route");
        await this.ctx.storage.deleteAlarm();
        return Response.json({ ok: true, ...(await this.statusPayload()) });
      case "status":
        return Response.json(await this.statusPayload());
      default:
        return Response.json({ error: "unknown action" }, { status: 404 });
    }
  }

  private async statusPayload() {
    const breaker = await readCircuitBreaker(this.env.DB).catch(() => ({ tripped: false }));
    const budget = (await this.ctx.storage.get<WriteBudget>("writeBudget")) ?? null;
    const connectedSince = (await this.ctx.storage.get<number>("connectedSinceMs")) ?? null;
    const nextAlarm = await this.ctx.storage.getAlarm();
    return {
      connected: this.ws != null,
      connectedSinceMs: connectedSince,
      writesToday: budget?.count ?? 0,
      breaker,
      nextAlarmMs: nextAlarm,
    };
  }

  // ── The lifecycle tick ────────────────────────────────────────────────────────
  async alarm(): Promise<void> {
    // 1) CIRCUIT BREAKER — refuse to run on a tripped kill-switch, and self-trip on
    //    a reconnect storm. Any trip hard-stops with NO reschedule.
    if (!(await this.guardOrTrip())) return;

    // 2) LIFECYCLE — should the stream be alive at all right now?
    let stream = false;
    try {
      stream = await shouldStreamNow(this.env);
    } catch (err) {
      console.error(`[${DO_NAME}] shouldStreamNow failed; standing down:`, err);
    }
    if (!stream) {
      // Window closed / car home / toggle off / drive ended → dormant, no re-arm.
      await this.disconnect("lifecycle says stream should be off");
      await this.ctx.storage.deleteAlarm();
      return;
    }

    // 3) MAX-CONNECTED backstop — if we've somehow held the socket past the ceiling,
    //    drop it and let the next tick re-evaluate (bounds duration cost).
    const connectedSince = (await this.ctx.storage.get<number>("connectedSinceMs")) ?? null;
    if (this.ws && connectedSince && Date.now() - connectedSince > MAX_CONNECTED_MS) {
      await this.disconnect("max continuous connected time exceeded");
    }

    // 4) CONNECT if needed; heartbeat if already connected.
    if (!this.ws) {
      await this.connectStream();
    } else {
      await heartbeatStream(this.env).catch(() => {});
    }

    // 5) Re-arm: fast heartbeat while connected, backoff while reconnecting.
    const attempts = (await this.ctx.storage.get<number>("reconnectAttempts")) ?? 0;
    const delay = this.ws
      ? HEARTBEAT_MS
      : Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempts, 4), RECONNECT_MAX_MS);
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  /**
   * Kill-switch + fire-rate guard. Returns false (and hard-stops) when the DO must
   * not run. Uses a native fire-rate window in `ctx.storage` — no growing table.
   */
  private async guardOrTrip(): Promise<boolean> {
    // FAIL CLOSED: the file header's contract is "downtime is acceptable over
    // billing". If we can't even read the kill-switch, assume the worst and
    // hard-stop rather than keep an outbound socket open on faith.
    let breaker;
    try {
      breaker = await readCircuitBreaker(this.env.DB);
    } catch (err) {
      console.error(`[${DO_NAME}] breaker read failed — failing closed:`, err);
      await this.disconnect("circuit breaker unreadable (failing closed)");
      await this.ctx.storage.deleteAlarm();
      return false;
    }
    if (breaker.tripped) {
      await this.disconnect("circuit breaker tripped");
      await this.ctx.storage.deleteAlarm();
      return false;
    }
    const prev = (await this.ctx.storage.get<FireWindow>("fireWindow")) ?? null;
    const { window, tripped } = evaluateFireWindow(prev, Date.now(), {
      windowMs: FIRE_WINDOW_MS,
      maxFires: MAX_FIRES_PER_MIN,
    });
    await this.ctx.storage.put("fireWindow", window);
    if (tripped) {
      await tripCircuitBreaker(
        this.env.DB,
        DO_NAME,
        `alarm fire-rate ${window.count}/${FIRE_WINDOW_MS}ms exceeded ${MAX_FIRES_PER_MIN}`,
      ).catch((e) => console.error(`[${DO_NAME}] trip failed:`, e));
      await this.disconnect("fire-rate runaway");
      await this.ctx.storage.deleteAlarm();
      return false;
    }
    return true;
  }

  // ── Connection ────────────────────────────────────────────────────────────────
  private async connectStream(): Promise<void> {
    const cfg = await getTessieConfig(this.env);
    if (!cfg) {
      console.warn(`[${DO_NAME}] Tessie not configured; cannot connect.`);
      return;
    }
    try {
      // ⚠️ Wire-protocol assumption — see the file header.
      const resp = await fetch(`https://streaming.tessie.com/${encodeURIComponent(cfg.vin)}`, {
        headers: { Upgrade: "websocket", Authorization: `Bearer ${cfg.token}` },
      });
      const ws = resp.webSocket;
      if (!ws) {
        console.error(`[${DO_NAME}] no webSocket in upgrade response (status ${resp.status}).`);
        await this.bumpReconnect();
        return;
      }
      ws.accept();
      this.ws = ws;
      this.lastShift = null;
      this.lastPersistMs = 0;
      await this.ctx.storage.put("connectedSinceMs", Date.now());
      await this.ctx.storage.put("reconnectAttempts", 0);
      await setStreamConnected(this.env, true).catch(() => {});

      ws.addEventListener("message", (ev: MessageEvent) => {
        // Each frame is handled in the background; a bad frame must not kill the socket.
        this.ctx.waitUntil(this.onFrame(ev.data).catch((e) => console.error(`[${DO_NAME}] frame:`, e)));
      });
      ws.addEventListener("close", () => {
        this.ctx.waitUntil(this.onSocketDown("close"));
      });
      ws.addEventListener("error", () => {
        this.ctx.waitUntil(this.onSocketDown("error"));
      });
      console.log(`[${DO_NAME}] connected to Tessie stream for ${cfg.vin}.`);
    } catch (err) {
      console.error(`[${DO_NAME}] connect failed:`, err);
      await this.bumpReconnect();
    }
  }

  private async bumpReconnect(): Promise<void> {
    const attempts = (await this.ctx.storage.get<number>("reconnectAttempts")) ?? 0;
    await this.ctx.storage.put("reconnectAttempts", attempts + 1);
  }

  private async onSocketDown(why: string): Promise<void> {
    if (!this.ws) return;
    console.warn(`[${DO_NAME}] socket ${why}; will reconnect via alarm.`);
    this.ws = null;
    await this.ctx.storage.put("connectedSinceMs", 0);
    await setStreamConnected(this.env, false).catch(() => {});
    // Nudge the alarm soon so the lifecycle re-evaluates and reconnects if it should.
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null) await this.ctx.storage.setAlarm(Date.now() + RECONNECT_BASE_MS);
  }

  private async disconnect(reason: string): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close(1000, reason);
      } catch {
        /* already closing */
      }
      this.ws = null;
      console.log(`[${DO_NAME}] disconnected: ${reason}`);
    }
    await this.ctx.storage.put("connectedSinceMs", 0);
    await setStreamConnected(this.env, false).catch(() => {});
  }

  // ── Per-frame handling ──────────────────────────────────────────────────────────
  private async onFrame(raw: unknown): Promise<void> {
    if (!(await telemetryRecordingAllowed(this.env))) return;

    let payload: Record<string, unknown>;
    try {
      payload = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);
      // Arrays are typeof "object" too — reject them so a list frame can't reach
      // extractTelemetryFields with an unexpected shape.
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    } catch {
      return; // non-JSON frame — ignore, never throw on the socket path.
    }

    const f = extractTelemetryFields(payload);
    const shiftChanged = f.shiftState !== this.lastShift;
    const now = Date.now();

    // Persist: always on a shift change, otherwise throttled — a ~500ms firehose
    // would otherwise be an unbounded D1 write cost.
    if (shiftChanged || now - this.lastPersistMs >= PERSIST_MIN_INTERVAL_MS) {
      if (!(await this.underWriteBudget())) {
        // Budget exhausted → trip (a stuck-open firehose is a cost runaway).
        await tripCircuitBreaker(this.env.DB, DO_NAME, `TESLA_DB write budget ${MAX_WRITES_PER_DAY}/day exceeded`).catch(
          () => {},
        );
        await this.disconnect("write budget exhausted");
        await this.ctx.storage.deleteAlarm();
        return;
      }
      await this.teslaDb
        .insert(teslaTelemetryEvents)
        .values({
          vin: f.vin,
          eventTs: f.eventTs,
          latitude: f.latitude,
          longitude: f.longitude,
          speed: f.speed,
          shiftState: f.shiftState,
          batteryLevel: f.batteryLevel,
          odometer: f.odometer,
          data: JSON.stringify({ source: "stream", payload }),
        })
        .run();
      this.lastPersistMs = now;
    }

    // Park pipeline — only on the shift-INTO-P transition (mirrors the poller's
    // parked handling: mark the nearest stop visited, auto-nav next, close on home).
    if (shiftChanged && f.shiftState === "P" && f.latitude != null && f.longitude != null) {
      await this.onPark(f.latitude, f.longitude).catch((e) => console.error(`[${DO_NAME}] onPark:`, e));
    }
    // Drive-away (P → moving) → finalize any open soft arrivals into staged visits.
    if (shiftChanged && this.lastShift === "P" && f.shiftState != null && f.shiftState !== "P") {
      await finalizeSoftArrivals(this.env).catch((e) => console.error(`[${DO_NAME}] finalize:`, e));
    }
    this.lastShift = f.shiftState;
  }

  private async onPark(lat: number, lng: number): Promise<void> {
    const match = await matchAndMarkVisited(this.appDb, { lat, lng });
    // Auto-navigation is OPT-IN (see gating.isAutoNavigateEnabled) — never command
    // the vehicle to a next stop the driver didn't ask for.
    if (match.matched && match.next && (await isAutoNavigateEnabled(this.env))) {
      await sendNavigation(this.env, `${match.next.lat},${match.next.lng}`).catch(() => {});
    }
    const home = await maybeEndActiveDriveOnHomeArrival(this.env, {
      latitude: lat,
      longitude: lng,
      // This is the real-time telemetry stream, not the webhook path.
      source: "tesla-telemetry",
      stopped: true,
    });
    if (home.ended) {
      // The drive is over at home → the socket has no reason to stay open.
      await this.disconnect("car reached home, drive ended");
      await this.ctx.storage.deleteAlarm();
      return;
    }
    // Not home → if we're at a registered showroom, stage a soft-arrival draft.
    await stageSoftArrival(this.env, {
      latitude: lat,
      longitude: lng,
      gpsSource: "tesla-telemetry",
    }).catch((e) => console.error(`[${DO_NAME}] stageSoftArrival:`, e));
  }

  /** Increment (and roll over daily) the TESLA_DB write budget. Returns false when spent. */
  private async underWriteBudget(): Promise<boolean> {
    const day = utcDayKey(Date.now());
    const budget = (await this.ctx.storage.get<WriteBudget>("writeBudget")) ?? { day, count: 0 };
    const current = budget.day === day ? budget : { day, count: 0 };
    if (current.count >= MAX_WRITES_PER_DAY) return false;
    await this.ctx.storage.put("writeBudget", { day, count: current.count + 1 });
    return true;
  }
}
