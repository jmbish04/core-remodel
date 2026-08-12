/**
 * @fileoverview Jules REST client — a thin `fetch` wrapper over the Jules API
 * (`https://jules.googleapis.com/v1alpha`).
 *
 * WHY NOT `@google/jules-sdk`: the published SDK's single ESM bundle statically
 * imports `node:fs`, `node:os`, `path`, and `readline` at module top (config from
 * `~/.jules`, changeset-to-disk helpers). Cloudflare `nodejs_compat` polyfills
 * `crypto`/`buffer`/`timers` but NOT `fs`/`os`/`readline`, so importing any symbol
 * from the SDK fails to load on Workers — the same trap that made liteparse
 * undeployable. The SDK is only a wrapper over these REST endpoints, so we hit
 * them directly. `@google/jules-sdk` stays a DEV dependency for its types.
 *
 * Wire contract (extracted from the SDK dist, v0.2.0):
 *   - Auth: `X-Goog-Api-Key: <JULES_API_KEY>` header.
 *   - Create (repoless): `POST /sessions` `{ prompt, title }` — no `sourceContext`.
 *   - Get:               `GET  /sessions/{id}` → `{ id, name, state, url }`.
 *   - Send:              `POST /sessions/{id}:sendMessage` `{ prompt }`.
 *   - Approve plan:      `POST /sessions/{id}:approvePlan` `{}`.
 *   - Activities:        `GET  /sessions/{id}/activities?pageSize=&pageToken=`
 *                        → `{ activities: [{ type, message, createTime, ... }], nextPageToken }`.
 */

const BASE_URL = "https://jules.googleapis.com/v1alpha";

/**
 * Session lifecycle states as returned on the wire (UPPER_SNAKE). The SDK maps
 * these to camelCase internally; we keep the raw enum so callers gate on the
 * real values.
 */
export type JulesSessionState =
  | "STATE_UNSPECIFIED"
  | "QUEUED"
  | "IN_PROGRESS"
  | "PAUSED"
  | "AWAITING_PLAN_APPROVAL"
  | "AWAITING_USER_FEEDBACK"
  | "COMPLETED"
  | "FAILED";

export interface JulesSession {
  /** Bare session id (the tail of `name`, e.g. `sessions/<id>`). */
  id: string;
  /** Full resource name `sessions/<id>`. */
  name: string;
  state: JulesSessionState;
  /** Human console URL, when the API returns one. */
  url?: string;
}

export interface JulesActivity {
  /** Activity resource name / id. */
  name?: string;
  id?: string;
  /** `agentMessaged` | `userMessaged` | `planGenerated` | `progressUpdated` | … */
  type?: string;
  /** Present on `agentMessaged` / `userMessaged`. */
  message?: string;
  /** RFC-3339 timestamp. */
  createTime?: string;
}

/** The session VM has booted and can accept a `:sendMessage`. */
export function isSessionReady(state: JulesSessionState): boolean {
  return state === "IN_PROGRESS" || state === "AWAITING_USER_FEEDBACK";
}

/** Terminal states — no further work will happen on this session. */
export function isSessionTerminal(state: JulesSessionState): boolean {
  return state === "COMPLETED" || state === "FAILED";
}

/** Thrown on any non-2xx Jules response; carries the HTTP status for gating. */
export class JulesApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "JulesApiError";
  }
}

export class JulesClient {
  constructor(private readonly apiKey: string) {}

  /** Resolve the API key from the secrets-store binding, or null if unset. */
  static async fromEnv(env: Env): Promise<JulesClient | null> {
    const key = await env.JULES_API_KEY?.get().catch(() => undefined);
    if (!key) return null;
    return new JulesClient(key);
  }

  private async request<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
  ): Promise<T> {
    const res = await fetch(`${BASE_URL}/${path}`, {
      method: init.method,
      headers: {
        "X-Goog-Api-Key": this.apiKey,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new JulesApiError(
        res.status,
        `Jules ${init.method} ${path} → ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    // Some endpoints (sendMessage/approvePlan) return an empty body.
    const raw = await res.text();
    return (raw ? JSON.parse(raw) : {}) as T;
  }

  /** Normalize an API session object to our {@link JulesSession}. */
  private normalize(raw: {
    id?: string;
    name?: string;
    state?: string;
    url?: string;
  }): JulesSession {
    const name = raw.name ?? (raw.id ? `sessions/${raw.id}` : "");
    const id = raw.id ?? name.replace(/^sessions\//, "");
    return {
      id,
      name,
      state: (raw.state as JulesSessionState) ?? "STATE_UNSPECIFIED",
      url: raw.url,
    };
  }

  /**
   * Create a REPOLESS session — no `sourceContext`, so Jules boots a bare VM we
   * drive purely as an analysis worker.
   */
  async createRepolessSession(prompt: string, title?: string): Promise<JulesSession> {
    const raw = await this.request<{ id?: string; name?: string; state?: string; url?: string }>(
      "sessions",
      {
        method: "POST",
        body: { prompt, ...(title ? { title } : {}) },
      },
    );
    return this.normalize(raw);
  }

  async getSession(id: string): Promise<JulesSession> {
    const raw = await this.request<{ id?: string; name?: string; state?: string; url?: string }>(
      `sessions/${id}`,
    );
    return this.normalize(raw);
  }

  /** Fire-and-forget: append a user message. Poll {@link listActivities} for the reply. */
  async sendMessage(id: string, prompt: string): Promise<void> {
    await this.request(`sessions/${id}:sendMessage`, { method: "POST", body: { prompt } });
  }

  /** Approve a generated plan so a stalled session resumes. */
  async approvePlan(id: string): Promise<void> {
    await this.request(`sessions/${id}:approvePlan`, { method: "POST", body: {} });
  }

  async listActivities(
    id: string,
    opts: { pageSize?: number; pageToken?: string } = {},
  ): Promise<{
    activities: JulesActivity[];
    nextPageToken?: string;
  }> {
    const qs = new URLSearchParams();
    if (opts.pageSize) qs.set("pageSize", String(opts.pageSize));
    if (opts.pageToken) qs.set("pageToken", opts.pageToken);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request(`sessions/${id}/activities${suffix}`);
  }

  /**
   * Return the newest `agentMessaged` reply strictly after `afterMs`, or null if
   * none yet. Reads the first page only — activities come back newest-first, and
   * a single batch reply lands within the first page.
   *
   * ponytail: first-page scan, no pagination. A batch never produces >pageSize
   * agent messages before we read it; widen pageSize before adding paging.
   */
  async latestAgentReplyAfter(
    id: string,
    afterMs: number,
    pageSize = 30,
  ): Promise<JulesActivity | null> {
    const { activities } = await this.listActivities(id, { pageSize });
    let best: JulesActivity | null = null;
    let bestMs = afterMs;
    for (const a of activities) {
      if (a.type !== "agentMessaged" || !a.message || !a.createTime) continue;
      const t = new Date(a.createTime).getTime();
      if (Number.isFinite(t) && t > bestMs) {
        best = a;
        bestMs = t;
      }
    }
    return best;
  }
}
