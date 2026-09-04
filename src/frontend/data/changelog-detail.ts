/**
 * Full developer record behind each changelog entry on /admin/changelog.
 * Keyed by the entry `id` (= the detail page slug at /admin/changelog/:id).
 *
 * Standard (see AGENTS.md): every non-trivial change ships a detail entry with
 * the problem, the approach, the exact API surface touched, the files, the
 * migration SQL, representative code, and (where useful) a Mermaid diagram.
 * Seeded/fallback here, then persisted to D1 (changelog_entries.detail_json).
 *
 * Long-form fields are typed `Prose` and hold MARKDOWN — headings, lists,
 * tables, `code`, and ```mermaid fences all render. Author them as one string;
 * single newlines between prose lines are expanded into paragraph breaks by the
 * renderer, so dense model output does not arrive as a wall of text. A few rows
 * store an array of paragraphs from a brief earlier iteration and are folded
 * back into markdown on read.
 */
import type { Prose } from "@/lib/markdown-normalize";

export type { Prose };

export interface CodeCard {
  title: string;
  lang: "ts" | "tsx" | "sql" | "json" | "bash";
  code: string;
}

export interface DiagramCard {
  /**
   * Short label under the diagram. Retained as the required field because every
   * pre-existing entry sets it; `title` supersedes it for new entries.
   */
  caption: string;
  /** Heading above the diagram. Falls back to `caption` when absent. */
  title?: string;
  /** What the diagram shows and what to look for in it. */
  description?: Prose;
  code: string; // Mermaid source
}

/**
 * One migration's REMOTE state. The deploy topology makes this the question a
 * reader actually has: every branch push builds and deploys the worker, but
 * migrations do NOT ride the build. So code can be live in production while its
 * table does not exist — and the endpoints that query it return 500. "Merged"
 * therefore does not imply "applied"; this says which it is.
 */
export interface MigrationStatus {
  tag: string;
  /** Whether `pnpm run migrate:remote` has actually applied this to the remote DB. */
  appliedRemote: boolean;
  /** How that was confirmed, or what is still outstanding. */
  note?: string;
}

/**
 * What was actually run to verify the change — never a paraphrase of it.
 *
 * `output` is pasted verbatim from the QC run. A summarized or reconstructed
 * result is worse than none: it reads as evidence while carrying none, and a
 * reader has no way to tell the difference.
 */
export interface Verification {
  /** Path to the QC harness, e.g. "scripts/qc/pr_162.mjs". */
  qcScript: string;
  /** The exact command that produced `output`, e.g. "pnpm run test:pr 162". */
  command: string;
  /** Representative source from the QC script, so the assertions are visible. */
  source?: string;
  /** REAL output of `command`, pasted verbatim. */
  output: string;
  /** When it ran (YYYY-MM-DD), so stale evidence is recognizable as stale. */
  ranAt?: string;
  /** Remote state of each migration this change introduced. */
  migrations?: MigrationStatus[];
  /**
   * The per-branch preview worker this PR deployed, and whether it has been
   * torn down.
   *
   * WHY THIS IS ON THE PAGE. One preview worker is created per branch, nothing
   * reaps them, and the account carries ~190 Workers — so "is there a stale
   * preview out there?" was a question only answerable by listing every Worker
   * on the account and reasoning about branch names. Recording it beside the QC
   * output makes the answer readable: a `deployed` badge on a merged entry is
   * litter somebody still has to remove.
   *
   * `none` is a real, distinct state. A change that never needed a preview and a
   * change whose author forgot to record one must not look identical.
   */
  previewWorker?: PreviewWorkerStatus;
}

/** One PR's preview worker and its teardown state. */
export interface PreviewWorkerStatus {
  /** Worker name as deployed, e.g. `wcrp-claude-my-branch`. */
  name: string;
  /**
   * `deployed` — still live on Cloudflare, still costing clutter.
   * `deleted`  — torn down; the PR is genuinely finished.
   * `none`     — this change never deployed a preview (docs-only, say).
   */
  status: "deployed" | "deleted" | "none";
  /** Anything a reader needs: why it is still up, or when it went away. */
  note?: string;
}

export interface PhaseDetail {
  slug: string;

  /**
   * One-line qualifier under the title, set in smaller italic type. The title
   * says what changed; the subtitle says which surface or which phase.
   */
  subtitle?: string;
  /**
   * Opening orientation, before the problem statement — who this is for, why
   * they are reading it, what changes for them. Markdown.
   */
  introduction?: Prose;

  /** Why this change had to happen. Markdown. */
  problem: Prose;
  /** How it was solved. Markdown. */
  approach: Prose;

  apiChanges: string[];
  filesTouched: string[];
  migrations: { tag: string; sql: string }[];
  code: CodeCard[];
  diagrams: DiagramCard[];

  // ── Provenance + evidence (optional: pre-existing entries predate these) ────
  // Stored inside `changelog_entries.detail_json`, so extending this type needs
  // no migration.

  /** Git branch the work landed on. Falls back to the entry's own `branch`. */
  branch?: string;
  /** PR number. Falls back to the `changelog_branches` row for this branch. */
  prNumber?: number;
  prUrl?: string;
  /** What was run to verify this, and what it printed. */
  verification?: Verification;
}

export const CHANGELOG_DETAIL: Record<string, PhaseDetail> = {
  "lazy-router-mounting-review-followup": {
    slug: "lazy-router-mounting-review-followup",
    subtitle: "Review follow-up to #416 — what lazy mounting broke that nothing was watching",
    branch: "orca/startup-cpu-followup",

    introduction: `#416 cut Worker startup CPU by 61% and its own QC proved the API surface was
unchanged: 90 paths, identical statuses on preview and production. Two reviews
after it merged found **eight** things it missed, and the first one is the
interesting one — because it is not a routing bug at all. It is a **monitoring**
bug, and the QC could never have caught it.`,

    problem: `**A HIGH-severity health probe was quietly defeated by the change it was
watching.**

\`api_route_registry\` exists to answer two questions. Both of its answers became
worthless.

*Question one: is admin auth registered?* The check was:

    routes.some(r => r.path.startsWith("/api/admin") && r.method === "ALL")

Under eager mounting the only thing matching that was
\`app.use("/api/admin/*", requireAccessAuth)\`. Lazy mounting registers
\`app.all("/api/admin", dispatch)\` and \`app.all("/api/admin/*", dispatch)\` — both
start with \`/api/admin\`, both have method \`ALL\`. **The dispatcher satisfies the
check by itself.** Delete the \`requireAccessAuth\` line entirely and the probe
whose \`whatFailureMeans\` says *"admin routes are being served UNGATED"* stays
green. Nothing was ungated — but the alarm had been disconnected from the thing
it alarms on.

*Question two: did every router load?* The check was \`routes.length >= 50\`, and
\`app.routes\` no longer contains a single sub-router route. Measured on the two
live workers:

| | \`app.routes\` | distinct paths |
| --- | --- | --- |
| production (eager mounting) | **1064** | 729 |
| this branch (lazy mounting) | **276** | 206 |

Still over 50, so still green. But a router module that throws at import now
500s only its own prefix, only when a request reaches it — and 276 is what you
get whether every router is healthy or every single one is broken. The floor was
measuring the parent app's middleware list and nothing else.

**Five smaller ones, same review round:**

- The QC's nested-prefix check was \`permits !== 404 || config !== 404\`. With
  \`||\` it passes the moment either resolves — so \`/api/admin\` shadowing
  \`/api/admin/permits\`, the exact failure it exists for, would pass silently.
- The QC's POST-body probe upserted a real \`changelog_branches\` row, and the
  house rule is that QC runs against production too. A \`qc/lazy-router-mounting-probe\`
  branch was sitting in the human-facing changelog.
- \`scheduled()\` imported all fifteen cron services in one \`Promise.all\` before
  the cron gate. The master tick runs **every minute**; it was paying, on every
  cold isolate, for the weekly price refresh and the daily ledger sweep.
- The pasted \`verification.output\` on #416's entry was a stale 16-check run.
  \`CLAUDE.md\`: *"Never fabricate or paraphrase results; paste what ran."*
- \`showroom-scout/index.ts\`'s \`@fileoverview\` docblock ended up below the
  imports when the registry import was removed, so it documented an import
  statement; and a \`// biome-ignore\` in \`api/index.ts\` is a no-op in a repo
  that lints with oxlint.`,

    approach: `**The probe now asserts things a dispatcher cannot accidentally satisfy.**

For auth, compare the handler **reference**:

    routes.some(r => r.path === "/api/admin/*" && r.handler === requireAccessAuth)

There is exactly one registration that can make this true. A path-and-method
test can be satisfied by anything mounted nearby; an identity test cannot.

For "did everything load", stop counting and **actually load them**.
\`src/backend/api/index.ts\` now exports \`MOUNT_PREFIXES\` and \`loadAllMounts()\`;
the probe calls the latter, which imports and merges every lazily-mounted router
and returns the ones that threw, by prefix. That restores the guarantee the
count used to give — and improves on it, because it names the offender instead
of reporting a low number.

\`loadAllMounts()\` is deliberately never called on the request path. Doing that
would undo #416 entirely.

**The rest, briefly.** The nested-prefix assertion asserts each prefix
separately. Both POST probes are now non-durable — a well-formed body aimed at a
row that does not exist proves the body was received and parsed just as well as
a write does, without leaving anything behind; the stray production row was
deleted and the table re-checked (zero \`qc/%\` rows). Each cron branch imports
only the services it runs. The stale verification output was replaced with the
real run. And the \`LAZY_MISS_HEADER\` docblock now records the **second** way to
break lazy mounting: a handler must return its own 404 and never call
\`c.notFound()\`, which would stamp the fall-through sentinel and hand the request
to the next matching prefix instead of ending it. Nothing under \`routes/\` does
this today, which is why it is a comment and not a fix.

**On the review itself.** Both reviewers were right about everything they
raised, and neither finding was reachable from the QC — the routing was correct,
which is all the QC was ever asking. The probe defect in particular is the shape
worth remembering: a change can be behaviourally perfect and still break the
thing that watches it.`,

    apiChanges: [
      "No change to any HTTP route. `src/backend/api/index.ts` gains two exports — `MOUNT_PREFIXES` and `loadAllMounts()` — consumed only by the api_route_registry health probe.",
    ],

    filesTouched: [
      "src/backend/api/health.ts — api_route_registry: handler-identity auth check, loadAllMounts(), prefix floor replacing the route-count floor",
      "src/backend/api/index.ts — export MOUNT_PREFIXES + loadAllMounts; document the c.notFound() trap; drop a no-op biome-ignore",
      "src/_worker.ts — cron imports scoped to the branch that runs them, instead of all fifteen up front",
      "src/backend/ai/agents/showroom-scout/index.ts — @fileoverview docblock restored to the top of the file",
      "scripts/qc/pr_416.mjs — per-prefix nested assertions; non-durable POST probes",
      "src/frontend/data/changelog.ts, src/frontend/data/changelog-detail.ts — this entry, and #416's stale verification output replaced with the real run",
    ],

    migrations: [],

    code: [
      {
        title: "src/backend/api/health.ts — an identity check, not a path-and-method one",
        lang: "ts",
        code: `// Identity check on the MIDDLEWARE ITSELF, not on "something is registered
// under /api/admin". Since routers are mounted lazily, the dispatcher
// registers \`app.all("/api/admin/*", …)\` — which satisfies any
// path-and-method test, so a path/method check would stay green even if
// \`app.use("/api/admin/*", requireAccessAuth)\` were deleted outright.
const guardsAdmin = routes.some(
  (r) => r.path === "/api/admin/*" && r.handler === requireAccessAuth,
);

// Every prefix must have a dispatcher, and every router behind it must
// actually import. This is the part that replaces counting app.routes.
const failures = await loadAllMounts();
if (failures.length > 0) {
  problems.push(
    \\\`router import failed for \\\${failures.length} prefix(es): \\\` +
      failures.map((f) => \\\`\\\${f.prefix} (\\\${f.error})\\\`).join("; "),
  );
}`,
      },
      {
        title: "src/backend/api/index.ts — what the probe needs, and nothing the request path uses",
        lang: "ts",
        code: `export const MOUNT_PREFIXES: readonly string[] = orderedPrefixes(MOUNTS);

/**
 * Forces every lazily-mounted router to import and merge, and reports which
 * ones failed. Deliberately NOT called on the request path — it defeats the
 * entire point of lazy mounting.
 */
export async function loadAllMounts(): Promise<{ prefix: string; error: string }[]> {
  const failures: { prefix: string; error: string }[] = [];
  for (const prefix of MOUNT_PREFIXES) {
    try {
      await loadPrefix(prefix, MOUNTS);
    } catch (err) {
      failures.push({ prefix, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return failures;
}`,
      },
      {
        title: "src/_worker.ts — the per-minute tick stops paying for the weekly job",
        lang: "ts",
        code: `// Before: all fifteen, ahead of the gate, on every tick.
// After: each branch imports only what it runs.
if (event.cron === "* * * * *") {
  const [
    { dispatchDueWorkflows },
    { autoHealImageUploads },
    { monitorShowroomSourcingCoverage },
    { enforceStreamWindow },
    { pollVehicleForActiveDrive },
    { backfillShowroomPlacesData },
  ] = await Promise.all([
    import("./backend/services/workflow-dispatcher"),
    import("./backend/services/image-processor/auto-heal"),
    import("./backend/services/showroom-sourcing-monitor"),
    import("./backend/services/tesla/gating"),
    import("./backend/services/tesla-poller"),
    import("./backend/services/showroom/places-backfill"),
  ]);
  // …
}`,
      },
    ],

    diagrams: [
      {
        caption: "Why the old probe went blind",
        title: "What app.routes can see, before and after",
        description: `The probe read \`app.routes\`. Under eager mounting that list contained every
sub-router's routes, so counting it meant something. Under lazy mounting the
sub-routers are not in the parent app at all until a request arrives — so the
probe has to go and load them itself.`,
        code: `flowchart TB
  subgraph B["eager — app.routes = 1064 entries / 729 paths"]
    PA["parent app"] --> MW1["~78 use() middleware"]
    PA --> RT1["every route of all 109 routers"]
    P1["api_route_registry<br/>counts app.routes >= 50"] -.reads.-> PA
    P1 -.->|"sees a broken router<br/>as a low count"| OK1["meaningful"]
  end

  subgraph A["lazy — app.routes = 276 entries / 206 paths"]
    PA2["parent app"] --> MW2["~78 use() middleware"]
    PA2 --> D2["2 dispatchers x 96 prefixes"]
    D2 -. "import() on first request" .-> R2["the routers"]
    P2["api_route_registry"] -.reads.-> PA2
    P2 ==>|"loadAllMounts()<br/>forces every import"| R2
  end`,
      },
    ],

    verification: {
      qcScript: "scripts/qc/pr_416.mjs",
      command:
        "node scripts/qc/pr_416.mjs --compare   +   POST /api/health/session on both workers",
      ranAt: "2026-09-04",
      source: `// The probe fix is not observable from the QC — it is a monitoring change — so
// it was verified by running the real health session on both workers and reading
// the api_route_registry line out of each.
curl -s -X POST -H "cookie: $COOKIE" "$BASE/api/health/session" \\
  | jq -r '.runs[] | select(.name=="api_route_registry") | "\\(.result) — \\(.details)"'`,
      output: `QC: lazy router mounting — https://wcrp-orca-startup-cpu-followup.hacolby.workers.dev

  ✓ target reachable (https://wcrp-orca-startup-cpu-followup.hacolby.workers.dev)
  ✓ /api/rooms/__qc_no_such_route__ → 404 (not 500)
  ✓ /api/budget/__qc_no_such_route__ → 404 (not 500)
  ✓ /api/admin/__qc_no_such_route__ → 404 (not 500)
  ✓ /api/showroom-stores/__qc_no_such_route__ → 404 (not 500)
  ✓ /api/__qc_no_such_prefix__ → 404 (not 500)
  ✓ /api/__qc_no_such_prefix__/deeper/still → 404 (not 500)
    5xx paths: /api/showroom-products
  ✓ /api/artifacts sees the absolute path (404, not 400)
  ✓ /api/admin/permits resolves (nested prefix not shadowed by /api/admin)
  ✓ /api/admin/config resolves (nested prefix not shadowed by /api/admin)
  ✓ /api/admin/plans resolves (nested prefix not shadowed by /api/admin)
  ✓ /api/showroom-stores fall-through reaches later routers in the group
  ✓ unauthenticated /api/admin/config → 401
  ✓ 4xx from a lazily-mounted router still carries Cache-Control: no-store
  ✓ well-formed POST body reaches a lazily-mounted router (404 on a missing row, so it parsed)
  ✓ malformed POST body is still validated (400, not 500)
  ✓ /openapi.json enumerates routes
  ✓ /openapi.json still carries the lazily-imported pascal routes
    63 paths in the spec

  comparing against production (https://core-remodel.hacolby.workers.dev)

  ✓ every path returns the same status on preview and production
  ✓ /openapi.json path set is identical to production

20 passed, 0 failed

--- api_route_registry, POST /api/health/session on both workers ---

preview (this branch, fixed probe):
  SUCCESS — 96 mount prefix(es), 96 dispatched; 276 route(s)/middleware on the
  parent app across 206 distinct paths. Every router imported cleanly.
  session counts: {success: 76, degraded: 10, failure: 5}

  (Review caught that the first version of this string was SHARED with the
  failure branch, so a failing run would have read "all imported cleanly"
  immediately before listing the imports that failed. Split: the counts are
  shared, "Every router imported cleanly" is said only where it is true. The
  line above is the re-run after that change.)

production (eager mounting, original probe):
  SUCCESS — 1064 route(s)/middleware registered on the Hono app across 729 distinct paths.
  session counts: {success: 75, degraded: 10, failure: 5}

1064 -> 276 is the finding in one line: the old floor of 50 was still cleared, so
the check stayed green while measuring nothing but the parent app's middleware.
Identical degraded/failure counts on both, so no health regression; the extra
success on the preview is this probe now doing its job.

--- stray QC row removed from production D1 ---
  DELETE FROM changelog_branches WHERE branch = 'qc/lazy-router-mounting-probe';
  rows_written: 1
  SELECT count(*) WHERE branch LIKE 'qc/%'  ->  0`,
      previewWorker: {
        name: "wcrp-orca-startup-cpu-followup",
        status: "deployed",
        note: "Live for review. Tear down with `pnpm run preview:delete` in the same turn as the merge.",
      },
    },
  },
  "lazy-router-mounting-startup-cpu": {
    slug: "lazy-router-mounting-startup-cpu",
    subtitle: "Worker startup CPU — the 10021 deploy block",
    branch: "orca/fix-cpu-load-time",
    prNumber: 416,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/416",

    introduction: `For a stretch of 2026-09-03 **nobody could deploy this Worker** — production
or preview, any branch, every attempt rejected before it ever served a request:

    Error: Script startup exceeded CPU time limit. [code: 10021]

This is the account of where that CPU was actually going, the two plausible
fixes that were measured and thrown away, one real regression the fix
introduced and how it was caught, and an honest note about what the evidence
does and does not prove.`,

    problem: `**It is not a size problem.** The bundle is 6.15 MB gzipped against a 10 MB
cap and 31 MB raw against 64 MB. The limit being hit is a different one: a
Worker must parse and execute its **global scope inside 1 second of CPU**.

Startup was profiled with \`npx wrangler check startup\` and every CPU sample
mapped back to the module that owns it **through the bundle's sourcemap**:

| share of samples | where |
| --- | --- |
| 46.5% | \`src/backend/api/index.ts\` (inclusive) — 109 eagerly imported routers |
| 13.1% | \`src/backend/mcp/registry.ts\` (inclusive) — 219 tool modules |
| 30.6% | garbage collection, downstream of allocating all those schema objects |
| 12.6% | \`src/backend/db/schema/index.ts\` — 359 Drizzle tables behind one barrel |

What ran before a single request was served: **231 module-scope \`z.object()\`
schemas**, **116 \`createRoute()\` calls**, 359 table definitions, and 219 MCP
tool modules. This is exactly the failure Cloudflare's own docs name —
*"generating or consuming a large schema at the top level is a common cause of
exceeding this limit."*

There is an irony worth recording: \`CLAUDE.md\` mandates hand-written Zod v4
everywhere, because drizzle-zod breaks the build. That rule is correct, and it
is also what put 231 schema constructions on the startup path.

**Two fixes were measured and rejected.**

1. *Split the frontend into its own Worker.* The frontend is **1.4%** of
   startup. Worth doing on its own merits; the backend Worker would keep
   essentially all of the cost and still fail.
2. *Finish the code-mode MCP work first.* Rejected in the original diagnosis on
   the grounds that the MCP registry was 0.0% of startup — see the correction
   below. It is still the wrong lever: Code Mode changes what a client is told
   about, not what the Worker builds at startup.

Shiki was the obvious suspect (8 TextMate grammars, ~0.5 MB of \`JSON.parse\`
literals) and has **zero frames** in the profile. Bundle weight, not startup CPU.`,

    approach: `**Everything expensive moves behind a dynamic \`import()\`.** esbuild wraps a
module that is *only* dynamically imported in a lazy \`__esm()\` initialiser, so
its top-level code runs on first use instead of at startup. The constraint that
makes this work is also the one that makes it fragile: a single static import
anywhere drags the module back onto the startup path.

**1. The API routers.** \`src/backend/api/index.ts\` swaps 109
\`app.route(prefix, router)\` calls for a \`MOUNTS\` table of loaders. Routing has
to come out identical, which takes two details:

- *Shared and nested prefixes.* Five routers sit on \`/api/budget\`, six on
  \`/api/showroom-stores\`, and \`/api/admin\` is declared before
  \`/api/admin/permits\`. Each prefix's routers are merged into one Hono in the
  original declaration order, and a **404 sentinel** on that merged router falls
  through to the next matching handler — so a path no router claims still ends
  at the parent app's 404 rather than the group's, and a handler that
  deliberately returns 404 with a body is returned untouched.
- *The absolute path.* Hono's own \`mount()\` strips the prefix. Copying that was
  the one real regression this change introduced; see below.

**2. The MCP tool registry.** \`RemodelMcpAgent\` is exported from
\`src/_worker.ts\` as a Durable Object, so its module — and all 219 tool modules
behind it — evaluated at startup. \`getAllTools()\` is now imported inside
\`init()\`, which runs per MCP session. \`ShowroomScout\` had the same shape.

**3. The cron services.** \`src/_worker.ts\` statically imported 15 modules only
\`scheduled()\` ever calls, and their reach was enormous: \`gmail/inbox-label\`
pulls the email pipeline, showroom contacts and business-card OCR;
\`showroom/places-backfill\` pulls the whole Drizzle schema barrel through
\`google/maps\`. They move into one \`Promise.all\` of dynamic imports at the top
of the handler. Cron ticks are not latency-sensitive and modules stay cached for
the life of the isolate.

**The Drizzle barrel stays.** 359 tables across 161 files behind one export is
real startup cost, but the barrel is reached from the Durable Object and
Workflow classes that \`src/_worker.ts\` *must* export by name — a runtime
requirement, not a choice. Deferring the cron imports took it off the entry
point's own path; taking it off the DOs' would mean rewriting 161 files' import
style, which is not worth it at 12.6%.

**Correcting the diagnosis on one number.** The original write-up attributed
samples by counting bytes between esbuild's \`// <path>\` banners and reported the
MCP registry at **0.0%** of startup. esbuild does not emit one banner per
module, so a region is credited to whichever banner preceded it. Re-attributing
through the sourcemap puts the registry at **13.1%** — the second-largest single
cost. \`scripts/perf/attribute-startup.py\` is that tool, committed so the next
person does not repeat the mistake.

**The regression, and how it was caught.** Stripping the mount prefix changed
two routes' behaviour, both invisible to a type checker:

- \`routes/artifacts.ts\` builds its R2 key with
  \`c.req.path.replace(/^\\/api\\/artifacts\\//, "")\`. Stripped, the replace matched
  nothing: \`GET /api/artifacts\` answered **400 "Invalid artifact key"** instead
  of **404 "Artifact not found"**.
- \`routes/tesla.ts\` gates auth on
  \`SECRET_GATED_PATHS.has(c.req.path)\` for \`/api/tesla/webhook\` and
  \`/api/tesla/telemetry\`. A stripped path misses that Set, which would have put
  the secret-verified Tessie webhooks behind the admin cookie they cannot send.

Only the first showed up as a failing check — the QC script diffs **every**
route's status against production, and that one path disagreed. Reading why led
to the second, which nothing was testing. The fix removes the class rather than
the two instances: each router is mounted at its own absolute prefix inside the
merged Hono and the request is dispatched untouched.

**What the evidence proves, and what it does not.** The preview deploys
cleanly. But a control deploy of clean \`origin/main\` — a scratch worktree at
\`0929384e\`, its own preview worker — **also passed**, then passed five more
\`versions upload\` startup validations in a row. So the 10021 failure is not
reproducing on Cloudflare's side right now, and this change cannot be credited
with flipping a failing deploy to a passing one *today*. What is measured is
headroom: startup CPU samples 314 to 124 on the same machine and the same
wrangler. Given that the same Worker failed five consecutive deploys yesterday
and passes six today, "sitting right at the 1-second limit, where the outcome
depends on which machine validates" is the reading that fits both days — and
headroom is exactly the fix for that.`,

    apiChanges: [
      "No change. Every path keeps its method, shape and auth — verified by diffing the status of 90 paths on the preview against production.",
      "GET /openapi.json — unchanged output, but now assembles from a lazily imported openapi router; the QC asserts the path set is identical to production, pascal routes included.",
    ],

    filesTouched: [
      "src/backend/api/index.ts — 109 static router imports replaced by a MOUNTS table of dynamic imports, plus loadPrefix/lazyDispatcher and the shared apiOnError handler",
      "src/backend/mcp/agent.ts — registry imported inside init(); getAllTools becomes a type-only import",
      "src/backend/ai/agents/showroom-scout/index.ts — registry imported inside execute()",
      "src/_worker.ts — 15 cron-only service imports moved into scheduled()",
      "scripts/perf/attribute-startup.py — new; sourcemap-based startup profile attribution",
      "scripts/qc/pr_416.mjs — new; routing regression guard (named for the PR so `pnpm run test:pr 416` and `--all` pick it up)",
      "src/frontend/data/changelog.ts, src/frontend/data/changelog-detail.ts",
    ],

    migrations: [],

    code: [
      {
        title: "src/backend/api/index.ts — the mount table (109 entries, three shown)",
        lang: "ts",
        code: `const MOUNTS: ReadonlyArray<readonly [string, RouterLoader]> = [
  ["/api/auth", async () => (await import("./routes/auth")).authRouter],
  ["/api/admin", async () => (await import("./routes/admin")).adminRouter],
  ["/api/admin/permits", async () => (await import("./routes/admin-permits")).adminPermitsRouter],
  // … 106 more, in the original app.route() order
];

for (const prefix of orderedPrefixes(MOUNTS)) {
  const dispatch = lazyDispatcher(prefix, MOUNTS);
  // Both forms are needed: \`/api/clickup/*\` does not match the bare
  // \`/api/clickup\`, which several routers serve as their \`/\` route.
  app.all(prefix, dispatch);
  app.all(\\\`\\\${prefix}/*\\\`, dispatch);
}`,
      },
      {
        title: "Merged per-prefix router + the 404 sentinel that preserves fall-through",
        lang: "ts",
        code: `const LAZY_MISS_HEADER = "x-lazy-mount-miss";

function loadPrefix(prefix: string, mounts: Mounts): Promise<MountableRouter> {
  let pending = loaded.get(prefix);
  if (pending) return pending;

  pending = (async () => {
    const routers = await Promise.all(
      mounts.filter(([p]) => p === prefix).map(([, load]) => load()),
    );
    const merged = new Hono<{ Bindings: Env; Variables: Variables }>();
    merged.onError(apiOnError);
    merged.notFound(() => new Response(null, { status: 404, headers: { [LAZY_MISS_HEADER]: "1" } }));
    // Mounted at the ABSOLUTE prefix, and the request is dispatched untouched —
    // routes/artifacts.ts and routes/tesla.ts both read c.req.path.
    for (const router of routers) merged.route(prefix, router);
    return merged;
  })();

  loaded.set(prefix, pending);
  return pending;
}

function lazyDispatcher(prefix: string, mounts: Mounts) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: () => Promise<void>) => {
    const router = await loadPrefix(prefix, mounts);
    const res = await router.fetch(c.req.raw, c.env, executionCtxOf(c));
    if (res.status === 404 && res.headers.get(LAZY_MISS_HEADER)) {
      await next();
      return;
    }
    return res;
  };
}`,
      },
      {
        title: "src/backend/mcp/agent.ts — the registry leaves the startup path",
        lang: "ts",
        code: `// TYPE-ONLY on purpose. This class is exported from src/_worker.ts as a Durable
// Object, so a value import would build all 219 tool modules' Zod schemas during
// Worker startup.
import type { getAllTools } from "./registry";

async init(): Promise<void> {
  const server = new McpServer({ name: "core-remodel", version: "1.0.0" });
  const { getAllTools } = await import("./registry");
  const tools = getAllTools();
  if (this.props?.codeMode) this.registerCodeTool(server, tools);
  else this.registerRegistryTools(server, tools);
  this.server = server;
}`,
      },
      {
        title: "Measuring it — the profile, and attribution through the sourcemap",
        lang: "bash",
        code: `npx wrangler deploy --outdir /tmp/bundled --dry-run   # bundle size + sourcemap
npx wrangler check startup --outfile /tmp/startup.cpuprofile

python3 scripts/perf/attribute-startup.py \\
  /tmp/startup.cpuprofile /tmp/bundled/_worker.js.map

# before                             after
# total samples: 314                 total samples: 124
#   28.9%  garbage collection          19.4%  garbage collection
#   25.2%  zod                         17.7%  zod
#   15.6%  backend routes               0.0%  backend routes
#   12.7%  mcp registry                 0.0%  mcp registry
#    7.0%  db schema                    2.4%  db schema

# HOW PRECISE IS THIS? Five runs of the fixed code on the same machine spanned
# 110-131 samples, so read the "after" figure as ~125 with a +/-10 band, not as
# a constant. The pre-fix number is a single run of 314. The gap is many times
# the run-to-run variance, so the direction is solid; the exact percentage is
# not worth quoting to two significant figures.`,
      },
    ],

    diagrams: [
      {
        caption: "What evaluates at startup, before and after",
        title: "Startup module graph",
        description: `Left: every box evaluated before the Worker could serve a request. Right: the
same graph after three dynamic-import boundaries. The Durable Object and
Workflow classes stay eager because the runtime resolves them as named exports —
which is also why the Drizzle barrel is still on the startup path.`,
        code: `flowchart LR
  subgraph BEFORE["before — 941 modules eager, 314 CPU samples"]
    W1["_worker.ts"] --> A1["api/index.ts"]
    A1 --> R1["109 routers<br/>231 z.object()"]
    R1 --> Z1["zod"]
    W1 --> M1["mcp/agent.ts (DO)"]
    M1 --> G1["registry<br/>219 tool modules"]
    G1 --> Z1
    W1 --> C1["15 cron services"]
    C1 --> D1["db barrel<br/>359 tables"]
    W1 --> X1["30 DO + Workflow exports"]
    X1 --> D1
  end

  subgraph AFTER["after — 452 modules eager, 124 CPU samples"]
    W2["_worker.ts"] --> A2["api/index.ts<br/>MOUNTS table only"]
    A2 -. "import() on first request" .-> R2["109 routers"]
    W2 --> M2["mcp/agent.ts (DO)"]
    M2 -. "import() in init()" .-> G2["registry"]
    W2 -. "import() in scheduled()" .-> C2["15 cron services"]
    W2 --> X2["30 DO + Workflow exports"]
    X2 --> D2["db barrel<br/>359 tables"]
  end`,
      },
      {
        caption: "One request through a lazily mounted prefix",
        title: "Request path",
        description: `The sentinel is the whole trick: it is how a group that has no route for the
path hands the request onward instead of ending it with its own 404, which is
what eager \`app.route()\` mounting did implicitly.`,
        code: `sequenceDiagram
  participant C as Client
  participant A as Hono app
  participant L as lazyDispatcher("/api/admin")
  participant M as merged router (cached)
  participant R as adminRouter

  C->>A: GET /api/admin/permits/foo
  A->>A: cors, logger, requireAccessAuth
  A->>L: first handler whose prefix matches
  L->>M: loadPrefix — dynamic import, once per isolate
  M->>R: dispatch, absolute path unchanged
  R-->>M: no route
  M-->>L: 404 + x-lazy-mount-miss
  L->>A: next()
  A->>A: /api/admin/permits dispatcher
  A-->>C: adminPermitsRouter's response`,
      },
    ],

    verification: {
      qcScript: "scripts/qc/pr_416.mjs",
      command: "node scripts/qc/pr_416.mjs --compare",
      ranAt: "2026-09-04",
      source: `// One representative GET per mounted prefix — 90 in all. A 401/404 is a fine
// answer; the assertion is that preview and production AGREE.
const diffs = [...PATHS, ...MUST_404].filter((p) => prodSeen[p] !== seen[p]);
checks.ok(
  "every path returns the same status on preview and production",
  diffs.length === 0,
  diffs.map((p) => \\\`\\\${p}: prod=\\\${prodSeen[p]} preview=\\\${seen[p]}\\\`).join("; "),
);

// Handlers that read the ABSOLUTE request path must still see it.
const artifact = await client.get("/api/artifacts");
checks.ok("/api/artifacts sees the absolute path (404, not 400)", artifact.status === 404);`,
      output: `QC: lazy router mounting — https://wcrp-orca-fix-cpu-load-time.hacolby.workers.dev

  ✓ target reachable (https://wcrp-orca-fix-cpu-load-time.hacolby.workers.dev)
  ✓ /api/rooms/__qc_no_such_route__ → 404 (not 500)
  ✓ /api/budget/__qc_no_such_route__ → 404 (not 500)
  ✓ /api/admin/__qc_no_such_route__ → 404 (not 500)
  ✓ /api/showroom-stores/__qc_no_such_route__ → 404 (not 500)
  ✓ /api/__qc_no_such_prefix__ → 404 (not 500)
  ✓ /api/__qc_no_such_prefix__/deeper/still → 404 (not 500)
    5xx paths: /api/showroom-products
  ✓ /api/artifacts sees the absolute path (404, not 400)
  ✓ /api/admin/permits resolves (nested prefix not shadowed by /api/admin)
  ✓ /api/showroom-stores fall-through reaches later routers in the group
  ✓ unauthenticated /api/admin/config → 401
  ✓ 4xx from a lazily-mounted router still carries Cache-Control: no-store
  ✓ POST body reaches a lazily-mounted router
  ✓ malformed POST body is still validated (400, not 500)
  ✓ /openapi.json enumerates routes
  ✓ /openapi.json still carries the lazily-imported pascal routes
    63 paths in the spec

  comparing against production (https://core-remodel.hacolby.workers.dev)

  ✓ every path returns the same status on preview and production
  ✓ /openapi.json path set is identical to production

18 passed, 0 failed
`,
      previewWorker: {
        name: "wcrp-orca-fix-cpu-load-time",
        status: "deleted",
        note: "Torn down 2026-09-04 once the review was addressed and the QC was green, in the same turn as the merge. Verified gone: GET /api/ping on its URL returns 404.",
      },
    },
  },
  "mcp-tool-list-auth-and-code-mode": {
    slug: "mcp-tool-list-auth-and-code-mode",
    subtitle: "The MCP connector — /mcp, /mcp/direct, and the OAuth + API-key doors",
    branch: "claude/mcp-tools-auth-availability-2efca8",
    prNumber: 413,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/413",

    introduction: `The connector logged in fine and offered **nothing to do**. Claude could
complete the OAuth flow, the handshake succeeded, \`/api/mcp-docs\` cheerfully
reported 173 tools — and the tool list came back empty in every client.

This is the account of what actually broke, why the existing health probe could
not have caught it, and the two things fixed alongside it: signing in with the
shared API key instead of OAuth, and cutting what the connector costs in context
before it does any work.`,

    problem: `**One field took down 173 tools.**

\`get_email_instructions\` declared its response like this:

    outputShape: {
      markdown: z.string(),
      html: z.string(),
      updatedAt: z.date().nullable(),   // <-- this
    }

Zod has no JSON Schema representation for a \`Date\`. That would be a small
problem if the MCP SDK serialised tools one at a time. It does not — it
serialises **every** registered tool's schema in a single pass to answer
\`tools/list\`. So the failure is not scoped to the offending tool:

    tools/list  ->  -32603 "Date cannot be represented in JSON Schema"

Not 172 of 173. **Zero**, for every connected client, permanently. And every
signal a person would check looked healthy — the OAuth flow issued tokens, the
handshake returned server capabilities, the public catalog endpoint listed all
173 tools, and \`mcp_tool_registry_integrity\` was green. It was *right* to be
green: the registry was valid. Nothing in the system was looking at whether those
valid Zod shapes could survive the trip to JSON Schema.

**Two adjacent gaps, found while in here.**

\`OAuthProvider\` owns the entire \`/mcp\` prefix and rejects any bearer that is
not one of its own minted tokens. A script holding the shared \`WORKER_API_KEY\`
got a flat \`401 invalid_token\` and had no way onto the full tool surface — only
the 21-tool legacy \`/api/mcp\` shim.

And the registry has grown to 173 tools. Advertising all of their JSON schemas
costs an enormous amount of context on every single connection, before the model
has done anything at all.`,

    approach: `**1. Fix the date, then remove the cliff.**

The timestamp is now an ISO-8601 string, serialised in the handler
(\`updatedAt ? updatedAt.toISOString() : null\`). But fixing the one field leaves
the shape of the failure intact, so \`RemodelMcpAgent\` now probes each shape with
\`z.toJSONSchema\` **before** registering it. A bad \`inputShape\` costs that one
tool; a bad \`outputShape\` costs only its structured output. One field can never
blank the list again.

**2. Make it visible.** A new \`mcp_tool_schema_serializable\` health probe runs
the same conversion over the whole registry and fails loudly at
\`/admin/system/health\`, with the offending tool and shape named in the details.

**3. API-key auth, ahead of OAuth.** \`handleApiKeyMcpRequest\` runs before
\`oauthProvider.fetch\` and accepts exactly the identities the rest of the app
already trusts. OAuth is untouched: an OAuth bearer is not the worker key, so
those requests fail the check and fall through unchanged.

**4. Code Mode on \`/mcp\`, raw tools on \`/mcp/direct\`.** \`/mcp\` now serves a
\`code\` tool that runs model-written JavaScript against \`codemode.<tool>\` inside
an isolated Worker with no outbound network, returning only the final value — so
a chain of dependent calls costs one round trip. The full 173-tool surface stays
at \`/mcp/direct\` as the fallback while Code Mode is experimental. Both are built
from the same registry pass and both route every call through the same
\`callTool()\`, so the invocation ledger cannot tell them apart.

**Two things that did not work, and why.**

\`codeMcpServer()\` from \`@cloudflare/codemode\` is the documented way to do this,
and it cannot run on Workers as shipped. It builds its internal MCP \`Client\`
without a \`jsonSchemaValidator\`, so the SDK falls back to \`AjvJsonSchemaValidator\`,
which compiles validators with \`new Function\`:

    Code generation from strings disallowed for this context

(The package imports the Workers-safe \`CfWorkerJsonSchemaValidator\` but only
passes it in \`openApiMcpServer\`.) Building the \`code\` tool straight from the
registry skips the client, the Ajv compile and the in-memory transport entirely.

Then the first working version inlined generated TypeScript for all 173 tools and
produced a **197,747-byte** tool description — about 49k tokens spent on every
connection, which is most of the problem Code Mode exists to solve. Most of that
weight was the tools' own prose. Replacing it with a one-line-per-tool catalog
plus a \`describe_tools\` lookup for the handful actually needed brought it to
**20,000 bytes (~5k tokens)**.`,

    apiChanges: [
      "POST /mcp — now also accepts `Authorization: Bearer <WORKER_API_KEY>`, `x-worker-api-key`, or the `remodel_access` cookie, in addition to an OAuth grant.",
      "POST /mcp — serves Code Mode: tools `code` (run JavaScript against `codemode.<tool>`) and `describe_tools` (exact TypeScript types for named methods).",
      "GET/POST /mcp/sse — Code Mode over the SSE transport. Previously shadowed by the bare `/mcp` apiHandler entry.",
      "POST /mcp/direct — NEW. The classic surface: all 173 registry tools advertised individually. Same two auth paths.",
      "GET/POST /mcp/direct/sse — NEW. SSE transport for the raw surface.",
      "No change to /api/mcp (the 21-tool legacy bearer shim) or /api/mcp-docs.",
    ],
    filesTouched: [
      "src/backend/mcp/agent.ts",
      "src/backend/mcp/types.ts",
      "src/backend/mcp/health.ts",
      "src/backend/mcp/tools/email/get_email_instructions.ts",
      "src/_worker.ts",
      "scripts/qc/pr_413.mjs",
      "scripts/qc/_mcp_surface.mjs",
      "package.json",
    ],
    migrations: [],
    code: [
      {
        title: "The bug: one field, the whole catalog",
        lang: "ts",
        code: `// src/backend/mcp/tools/email/get_email_instructions.ts — BEFORE
outputShape: {
  markdown: z.string(),
  html: z.string(),
  updatedAt: z.date().nullable(),   // no JSON Schema representation
},

// AFTER — serialise at the boundary
outputShape: {
  markdown: z.string(),
  html: z.string(),
  updatedAt: z.string().nullable().describe("ISO-8601 timestamp of the last edit, or null"),
},
handler: async ({ db }) => {
  const { markdown, html, updatedAt } = await getInstructions(db);
  return { markdown, html, updatedAt: updatedAt ? updatedAt.toISOString() : null };
},`,
      },
      {
        title: "The guard: probe before registering",
        lang: "ts",
        code: `// src/backend/mcp/agent.ts
function isSerializableShape(shape: Record<string, unknown>): boolean {
  try {
    z.toJSONSchema(z.object(shape as Record<string, z.ZodType>));
    return true;
  } catch {
    return false;
  }
}

// A bad inputShape costs that one tool...
if (!isSerializableShape(tool.inputShape)) {
  console.error(\`mcp: skipping tool "\${tool.name}" — inputShape is not serialisable\`);
  continue;
}
// ...a bad outputShape costs only its structured output.
const outputOk = outputSchema ? isSerializableShape(outputSchema) : false;`,
      },
      {
        title: "API-key auth, checked ahead of OAuthProvider",
        lang: "ts",
        code: `// src/_worker.ts
async function handleApiKeyMcpRequest(request, env, ctx) {
  const handler = MCP_HANDLERS[new URL(request.url).pathname];
  if (!handler) return null;
  if (!(await isRequestAuthenticated(request, env))) return null;
  // Stamp the key principal so the ledger records "worker:justin".
  ctx.props = { userId: "justin", scope: "remodel", kind: "worker" };
  return handler.fetch(request, env, ctx);
}

fetch: withAbsoluteRegistrationUri(async (request, env, ctx) => {
  const direct = await handleApiKeyMcpRequest(request, env, ctx);
  return direct ?? oauthProvider.fetch(request, env, ctx);
}),`,
      },
      {
        title: "Route order is load-bearing",
        lang: "ts",
        code: `// OAuthProvider matches with pathname.startsWith(route) and takes the FIRST
// hit in insertion order, so a bare "/mcp" listed first swallows everything
// under it — which it was already doing to "/mcp/sse".
const MCP_HANDLERS: Record<string, FetchHandler> = {
  "/mcp/direct/sse": withCodeMode(/* raw  */ ..., false),
  "/mcp/direct":     withCodeMode(/* raw  */ ..., false),
  "/mcp/sse":        withCodeMode(/* code */ ..., true),
  "/mcp":            withCodeMode(/* code */ ..., true),
};`,
      },
      {
        title: "Code Mode, exercised against live data",
        lang: "bash",
        code: `# tools/call code
async () => {
  const r = await codemode.list_rooms({ limit: 5 });
  return r.items.map((x) => x.roomName);
}
-> ["Family Room","Laundry", ...]

# the sandbox has no way out
async () => { const r = await fetch('https://example.com'); return r.status; }
-> isError: "This worker is not permitted to access the internet via global
   functions like fetch(). It must use capabilities (such as bindings in 'env')
   to talk to the outside world."`,
      },
    ],
    diagrams: [
      {
        caption: "One field, the whole list",
        title: "Why zero tools and not 172",
        description: `\`tools/list\` is answered by serialising every registered schema in one pass.
There is no per-tool boundary to contain a failure, which is why a single
\`z.date()\` presented to the user as "the connector has no tools" rather than
"one tool is broken".`,
        code: `flowchart TD
  A["Client: tools/list"] --> B["MCP SDK serialises ALL 173 schemas<br/>in ONE pass"]
  B --> C{"every shape representable<br/>in JSON Schema?"}
  C -- "yes" --> D["173 tools returned"]
  C -- "no (one z.date)" --> E["-32603 whole response fails"]
  E --> F["Client shows ZERO tools"]
  F --> G["OAuth fine · handshake fine<br/>/api/mcp-docs says 173<br/>registry probe GREEN"]
  style E fill:#3a1417,stroke:#fca5a5,color:#fca5a5
  style F fill:#3a1417,stroke:#fca5a5,color:#fca5a5`,
      },
      {
        caption: "Two auth doors, two surfaces",
        title: "How a request reaches the tools now",
        description: `The API-key check runs ahead of \`OAuthProvider\` and only claims requests
carrying the shared operator credential; everything else falls through to the
OAuth path untouched. Whichever door a request comes through, the path chooses
the surface, and both surfaces run every call through the same \`callTool()\` — so
the invocation ledger sees Code Mode and direct calls identically.`,
        code: `flowchart LR
  R["Request to /mcp*"] --> K{"WORKER_API_KEY bearer<br/>or access cookie?"}
  K -- "yes" --> P["props.kind = worker"]
  K -- "no" --> O["OAuthProvider<br/>(1-year access token)"]
  O --> P2["props from the grant"]
  P --> S{"which path?"}
  P2 --> S
  S -- "/mcp · /mcp/sse" --> C["CODE MODE<br/>code + describe_tools"]
  S -- "/mcp/direct(/sse)" --> D["RAW<br/>173 tools"]
  C --> X["isolated Worker<br/>no outbound network"]
  X --> T["callTool()"]
  D --> T
  T --> L["mcp_tool_invocations"]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_413.mjs",
      command: "pnpm run test:pr 413 -- --preview   AND   pnpm run test:pr 413",
      ranAt: "2026-09-03",
      source: `// The assertion that matters is a NON-NULL tool array — the defect was the
// whole list vanishing, not any one tool going missing.
for (const [path, kind, token] of surfaces) {
  const res = await listTools(BASE, path, { authorization: \`Bearer \${token}\` });
  expect(
    \`\${path} (\${kind}) returns a tool list\`,
    Array.isArray(res.tools) && res.tools.length > 0,
    \`status=\${res.status} \${res.error ?? "tools=null"}\`,
  );
}

check(
  "OAuth access token lives a full year",
  expiresIn === ONE_YEAR_SECONDS,
  \`expires_in=\${expiresIn} (\${(expiresIn / 86400).toFixed(1)} days)\`,
);

check(
  "the code sandbox cannot reach the internet",
  escaped?.result?.isError === true &&
    escapedText.includes("not permitted to access the internet"),
  escapedText.slice(0, 200),
);`,
      output: `$ pnpm run test:pr 413 -- --preview
QC pr_413 (MCP tools + auth + Code Mode) against https://wcrp-claude-mcp-tools-auth-availability-2efca8.hacolby.workers.dev

  ✓ /api/mcp-docs reports a populated registry
  ✓ OAuth authorization-code flow yields an access token
  ✓ OAuth issues a refresh token
  ✓ OAuth access token lives a full year
  ✓ /mcp (oauth) returns a tool list
  ✓ /mcp (api key) returns a tool list
  ✓ /mcp/direct (oauth) returns a tool list
  ✓ /mcp/direct (api key) returns a tool list
  ✓ /mcp is Code Mode — exactly \`code\` + \`describe_tools\`
  ✓ /mcp/direct advertises the whole registry
  ✓ the API-key path sees the same surface as OAuth
  ✓ describe_tools returns TypeScript for a named method
  ✓ code executes JavaScript against live remodel data
  ✓ the code sandbox cannot reach the internet
  ✓ legacy /api/mcp bearer shim still lists its tools

15 passed, 0 failed

$ pnpm run test:pr 413        # production, before merge
QC pr_413 (MCP tools + auth + Code Mode) against https://core-remodel.hacolby.workers.dev

  ✓ /api/mcp-docs reports a populated registry
  ✓ OAuth authorization-code flow yields an access token
  ✓ OAuth issues a refresh token
  ✓ OAuth access token lives a full year
    ~ /mcp (oauth) returns a tool list — pending merge/deploy on production (status=200 {"code":-32603,"message":"Date cannot be represented in JSON Schema"})
    ~ /mcp (api key) returns a tool list — pending merge/deploy on production (status=401 {"error":"invalid_token","error_description":"Invalid access token"})
    ~ /mcp/direct (oauth) returns a tool list — pending merge/deploy on production (status=404 {"error":{"code":-32000,"message":"Not found"},"id":null,"jsonrpc":"2.0"})
    ~ /mcp/direct (api key) returns a tool list — pending merge/deploy on production (status=401 {"error":"invalid_token","error_description":"Invalid access token"})
    ~ /mcp is Code Mode — exactly \`code\` + \`describe_tools\` — pending merge/deploy on production (tools=null)
    ~ /mcp/direct advertises the whole registry — pending merge/deploy on production (direct=undefined catalog=173)
    ~ the API-key path sees the same surface as OAuth — pending merge/deploy on production (oauth=null apikey=null)
    ~ code-tool execution — pending merge/deploy on production
  ✓ legacy /api/mcp bearer shim still lists its tools

5 passed, 0 failed`,
      migrations: [],
      previewWorker: {
        name: "wcrp-claude-mcp-tools-auth-availability-2efca8",
        status: "deployed",
        note: "Live while PR #413 is open. Torn down with `pnpm run preview:delete` in the same turn as the merge.",
      },
    },
  },
  "budget-command-center": {
    slug: "budget-command-center",
    subtitle: "/admin/budget rebuilt as one workbench, every tab on a real API",
    branch: "orca/budget-ux-overhaul",
    prNumber: 412,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/412",
    problem: `The budget lived across four unrelated admin pages, each with its own island and
its own idea of what a number meant. The grid could not show a month-phased plan against
actuals, there was nowhere to see which decision was costing the most money, estimate lines
had no reviewable path to a room, and there was no compliance surface at all — so nothing
checked that a payment was legal before it moved.

Underneath, several endpoints did the expensive thing: pulling rows out of D1 and reducing,
sorting or paginating them in JavaScript. On D1 that is not a style problem. **Row reads are
the billed and limited unit**, and they count rows *scanned*, not rows returned — so a
sort-in-JS over a growing table is a bill and a latency cliff waiting to arrive.`,
    approach: `The design canvas was split per screen so each agent read only its own screen,
and **two documents were written before any code**, because a dozen agents working in parallel
need one standard rather than a dozen judgement calls.

**\`D1-DRIZZLE-RULES.md\`** was researched against the live Cloudflare and Drizzle docs, every
claim carrying the URL it came from. Its rules: index every WHERE / JOIN ON / ORDER BY column;
one \`db.batch\` round trip per screen; aggregate with SUM and CASE WHEN in SQL, never in JS;
paginate in SQL, never \`.slice()\`; chunk anything that could exceed D1's 100 bound-parameter
cap; \`db.transaction()\` is dead on D1 — it rejects SQL BEGIN with error 7500 and drizzle's
driver throws on the first statement, so the callback body never runs; money as integer cents.

**\`API-CONTRACT.md\`** pinned every endpoint shape up front, which is what let the backend
routes and the frontend tabs be built at the same time instead of one waiting on the other.
Its rule zero: **no SQL in frontend code, ever** — an island calls the typed client, the client
calls Hono, Hono runs the Drizzle query.

One modelling decision was got wrong and corrected mid-build. The reallocation ledger
originally reserved a null/null pair to mean "contingency", which made it structurally
incapable of recording money *leaving* contingency — so it could not render the design's own
first ledger row, "Contingency to Primary Bath". Contingency is now an ordinary funding
account, and money flows both ways through it like any other.`,
    apiChanges: [
      "GET /api/budget/workbench-summary — new; the whole shell header in one db.batch of 12 SELECTs",
      "GET /api/budget/inbox — reshaped; ranked by financial exposure in SQL, not sorted in JS",
      "GET /api/budget/rooms-finance — reshaped; one grouped query with JOINed aggregates plus separate totals",
      "GET /api/budget/grid — reshaped; month-phased cells, flat grouped query pivoted in the Worker",
      "PATCH /api/budget/plan-schedule — single-cell shape added alongside the existing bulk shape",
      "GET /api/budget/reconciliation-queue — new; unmapped estimate lines with ranked candidate rooms and reasoning",
      "POST /api/budget/reconciliation/:lineItemId/confirm and /reject — new",
      "GET and POST /api/budget/reallocations — new; keyset-paginated ledger",
      "GET /api/budget/contingency — new; opening reserve, current balance, percent remaining",
      "GET /api/budget/compliance — new; contracts joined to their payment gates, CSLB cap evaluated server-side",
      "GET /api/budget-tracker/financial-accounts — new; accounts plus their SUM computed in SQL",
      "PUT /api/budget-tracker/financial-accounts — fixed; one db.batch instead of a round trip per account",
    ],
    filesTouched: [
      "src/backend/api/routes/budget-workbench.ts",
      "src/backend/api/routes/budget-grid.ts",
      "src/backend/api/routes/budget-grid-math.ts",
      "src/backend/api/routes/budget-tracker.ts",
      "src/backend/api/routes/budget-reconciliation.ts",
      "src/backend/api/routes/budget-reallocations.ts",
      "src/backend/api/routes/budget-compliance.ts",
      "src/backend/api/index.ts",
      "src/backend/db/schema/estimates/estimate_line_room_candidates.ts",
      "src/backend/db/schema/home/budget_reallocation_ledger.ts",
      "src/backend/db/schema/contracts/contract_compliance_gates.ts",
      "src/frontend/lib/budget-api.ts",
      "src/frontend/components/budget/BudgetWorkbench.tsx",
      "src/frontend/components/budget/GridTab.tsx",
      "src/frontend/components/budget/InboxTab.tsx",
      "src/frontend/components/budget/EstimatesTab.tsx",
      "src/frontend/components/budget/RoomsTab.tsx",
      "src/frontend/components/budget/SavingsTab.tsx",
      "src/frontend/components/budget/ComplianceTab.tsx",
      "src/frontend/components/budget/LogExpenseDialog.tsx",
      "src/frontend/pages/admin/budget/index.astro",
      "src/frontend/pages/admin/budget/grid.astro",
      "src/frontend/pages/admin/budget/inbox.astro",
      "docs/plans/budget-command-center/D1-DRIZZLE-RULES.md",
      "docs/plans/budget-command-center/API-CONTRACT.md",
      "docs/decisions/2026-09-03-budget-command-center-schema-gaps.md",
      "scripts/qc/pr_budget_command_center.mjs",
      "scripts/tests/test_budget_grid_pivot.mjs",
    ],
    migrations: [
      {
        tag: "0184_talented_wendell_vaughn",
        sql: `CREATE TABLE estimate_line_room_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  estimate_line_item_id INTEGER NOT NULL REFERENCES estimate_line_items(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  verdict TEXT NOT NULL,               -- likely | possible | eliminated
  reasoning_markdown TEXT, reasoning_html TEXT,
  evidence_json TEXT, confidence REAL,
  datetime_created INTEGER DEFAULT (unixepoch()) NOT NULL
);
CREATE TABLE contract_compliance_gates (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  gate_type TEXT NOT NULL,             -- down_payment_cap | signed_change_order | lien_release | license_active
  state TEXT NOT NULL,                 -- pass | fail | warn | na
  evidence_markdown TEXT, evidence_html TEXT,
  evaluated_at INTEGER, expires_at INTEGER, source_ref TEXT,
  datetime_created INTEGER DEFAULT (unixepoch()) NOT NULL,
  datetime_updated INTEGER DEFAULT (unixepoch()) NOT NULL
);
CREATE TABLE budget_reallocation_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  occurred_at INTEGER NOT NULL,
  event_title TEXT NOT NULL, event_detail TEXT,
  from_account_id INTEGER REFERENCES budget_funding_accounts(id) ON DELETE SET NULL,
  to_account_id   INTEGER REFERENCES budget_funding_accounts(id) ON DELETE SET NULL,
  from_room_id    INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  to_room_id      INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL, amount_text TEXT,
  reference_type TEXT, reference_id TEXT, created_by TEXT,
  datetime_created INTEGER DEFAULT (unixepoch()) NOT NULL
);
ALTER TABLE estimate_companies ADD license_expires_at INTEGER;
-- plus 7 indexes on the three new tables (2 UNIQUE, 5 non-unique):
CREATE UNIQUE INDEX uidx_estimate_line_room_candidates_line_room ON estimate_line_room_candidates (estimate_line_item_id, room_id);
CREATE INDEX idx_estimate_line_room_candidates_line_rank ON estimate_line_room_candidates (estimate_line_item_id, rank);
CREATE UNIQUE INDEX uidx_contract_compliance_gates_contract_type ON contract_compliance_gates (contract_id, gate_type);
CREATE INDEX idx_contract_compliance_gates_contract_state ON contract_compliance_gates (contract_id, state);
CREATE INDEX idx_budget_reallocation_ledger_occurred_at ON budget_reallocation_ledger (occurred_at);
CREATE INDEX idx_budget_reallocation_ledger_from_account ON budget_reallocation_ledger (from_account_id);
CREATE INDEX idx_budget_reallocation_ledger_to_account ON budget_reallocation_ledger (to_account_id);`,
      },
      {
        tag: "0185_magical_rage",
        sql: `-- 11 more covering indexes, on pre-existing tables the new queries hit:
CREATE INDEX idx_estimate_line_items_mapping_status_id ON estimate_line_items (mapping_status, id);
CREATE INDEX idx_contracts_is_active ON contracts (is_active);
CREATE INDEX idx_contracts_estimate_company_id ON contracts (estimate_company_id);
CREATE INDEX idx_contracts_linked_estimate_id ON contracts (linked_estimate_id);
CREATE INDEX idx_bee_active_track_date ON budget_expense_entries (is_active, budget_item_track_id, date_incurred);
CREATE INDEX idx_bee_active_room ON budget_expense_entries (is_active, room_id);
CREATE INDEX idx_btir_room ON budget_tracker_item_rooms (room_id);
CREATE INDEX idx_bti_active_phase ON budget_tracker_items (is_active, phase_id);
CREATE INDEX idx_budget_reallocation_ledger_occurred_at_id ON budget_reallocation_ledger (occurred_at, id);
CREATE INDEX idx_budget_phases_active_sort ON budget_phases (is_active, sort_order);
CREATE INDEX idx_budget_plan_schedule_period ON budget_plan_schedule (period);`,
      },
      {
        tag: "0186_acoustic_rictor",
        sql: `-- 2 more indexes a later query needed:
CREATE INDEX idx_contract_compliance_gates_state ON contract_compliance_gates (state);
CREATE INDEX idx_bee_active_date ON budget_expense_entries (is_active, date_incurred);`,
      },
    ],
    code: [
      {
        title: "The whole shell header in one D1 round trip",
        lang: "ts",
        code: `// 12 independent SELECTs, one batch, one round trip. Pulling the rows and
// totalling them in JS would scan the same tables, bill the same reads, and
// add a network hop per query on top.
const [funding, spent, burn, committed, project, ...counts] = await db.batch([
  fundingSumQuery, spentSumQuery, trailingBurnQuery, committedQuery,
  projectInfoQuery, ...tabCountQueries,
]);

// Never Infinity: a project with no trailing burn has no runway to state.
const runwayMonths = burnPerMonth > 0 ? remainingCents / burnPerMonth : null;`,
      },
      {
        title: "The monthly pivot happens in the Worker, deliberately",
        lang: "ts",
        code: `// A conditional-SUM pivot in SQL scans EXACTLY the same rows as a flat
// GROUP BY, so it buys zero row reads — and costs dynamic SQL that breaks
// whenever the month range changes. Group flat, reshape here.
const flat = await db
  .select({
    trackId: items.trackId,
    yearMonth: sql\`strftime('%Y-%m', datetime(date_incurred, 'unixepoch'))\`,
    totalCents: sql\`sum(amount_cents)\`,
  })
  .from(entries)
  .groupBy(items.trackId, sql\`strftime('%Y-%m', datetime(date_incurred, 'unixepoch'))\`);

return pivotBudgetGrid(flat, months); // self-checked in budget-grid-math.ts`,
      },
      {
        title: "The bug that made an expense look saved",
        lang: "ts",
        code: `// Before: anything that was not a string returned null, so the numeric
// dateIncurred the contract sends was dropped. The insert succeeded with
// date_incurred unset, and the UI showed a saved expense with no date.
//
//   if (typeof input !== "string") return null;
//
// After: seconds, milliseconds, a numeric string, or a date string.
if (typeof input === "number") {
  if (!Number.isFinite(input) || input <= 0) return null;
  const ms = input > 1e11 ? input : input * 1000; // magnitude, not a guess
  const parsed = new Date(ms);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
// An all-digit string is a timestamp, not a date: new Date("0") is the year 2000.
if (/^[0-9]+$/.test(trimmed)) return parseTimestamp(Number(trimmed));`,
      },
      {
        title: "An unknown is not a pass",
        lang: "ts",
        code: `// Bus. & Prof. Code section 7159.5 — California's down-payment cap is the
// LESSER of $1,000 or 10% of the contract price. Integer cents, floored, so
// the cap only ever rounds down.
export function capForContractCents(contractValueCents: number): number {
  return Math.min(100_000, Math.floor(contractValueCents / 10));
}

// A contract with no recorded down payment is "na", never "pass". And all four
// gates are always returned — an omitted gate row reads as all-clear, which is
// the worst possible failure mode on a compliance surface.`,
      },
    ],
    diagrams: [
      {
        caption: "One workbench, one client, one query layer",
        title: "Where the data comes from — and where SQL is not allowed",
        description: `The dashed boundary is the rule the whole rebuild is organised around.
Nothing to the left of it may contain SQL or touch D1; every tab reaches its data through
the typed client and a Hono route.`,
        code: `flowchart LR
  subgraph FE["Frontend - no SQL, ever"]
    SHELL["BudgetWorkbench<br/>KPI header + 6 tabs"]
    TABS["GridTab · InboxTab · EstimatesTab<br/>RoomsTab · SavingsTab · ComplianceTab"]
    API["budget-api.ts<br/>typed client · AbortController per query"]
    SHELL --> API
    TABS --> API
  end
  API -.HTTP.-> HONO["Hono routes<br/>hand-written Zod v4"]
  subgraph BE["Backend"]
    HONO --> DRIZZLE["Drizzle<br/>SUM / CASE WHEN / JOIN in SQL"]
    DRIZZLE --> BATCH["db.batch - one round trip per screen"]
  end
  BATCH --> D1[("D1")]`,
      },
      {
        caption: "The three new tables and what they hang off",
        title: "Schema added by migration 0184",
        description: `Foreign keys only. No denormalized name columns — a display label is
obtained by JOIN, so it cannot drift when the parent is renamed.`,
        code: `erDiagram
  estimate_line_items ||--o{ estimate_line_room_candidates : "ranked candidates"
  rooms ||--o{ estimate_line_room_candidates : "candidate room"
  contracts ||--o{ contract_compliance_gates : "payment gates"
  budget_funding_accounts ||--o{ budget_reallocation_ledger : "from / to account"
  rooms ||--o{ budget_reallocation_ledger : "from / to room"
  estimate_line_room_candidates {
    int rank
    text verdict
    text reasoning_markdown
    real confidence
  }
  contract_compliance_gates {
    text gate_type
    text state
    text evidence_markdown
    int expires_at
  }
  budget_reallocation_ledger {
    int occurred_at
    text event_title
    int amount_cents
    text reference_id
  }`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_budget_command_center.mjs",
      command:
        "node scripts/qc/pr_budget_command_center.mjs --preview   # then again bare, against production",
      ranAt: "2026-09-03",
      output: `$ node scripts/qc/pr_budget_command_center.mjs --preview
QC · Budget Command Center -> https://wcrp-orca-budget-ux-overhaul.hacolby.workers.dev (preview)
  ok workbench-summary   runwayMonths finite-or-null, tabCounts complete
  ok grid                months/phases/footer, per-cell planned/actual/isEditable
  ok inbox               items arrive sorted by exposure descending
  ok rooms-finance       19 rooms, committed 69725000 cents, spent 510533 cents
  ok reconciliation-queue  limit honoured by SQL, not sliced in JS
  ok financial-accounts  totalCents equals the sum of the rows
  ok reallocations       limit honoured by SQL
  ok contingency         pctRemaining finite (never NaN/Infinity)
  ok compliance          all four gates present, {markdown, html} evidence
  ok regression guard    7 pre-existing budget endpoints still 200
  ok pages               workbench renders; legacy /grid and /inbox land on it

82 passed, 0 failed

$ node scripts/qc/pr_budget_command_center.mjs        # production
17 passed, 0 failed
12 endpoint(s) PENDING merge/deploy on this target
  (6 new routes 404 here; 3 reshaped routes correctly still serve the
   pre-merge shape; 3 pages not deployed yet)

$ NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
186 errors repo-wide - all pre-existing. Zero in any file this PR touches.

$ npx wrangler d1 execute DB --remote --command "EXPLAIN QUERY PLAN ..."
# Every driving query for the new endpoints, measured against production D1.
# None falls back to SCAN TABLE.
  rooms-finance, expenses by room
    SEARCH budget_expense_entries USING INDEX idx_bee_active_room (is_active=?)
  rooms-finance, item-to-room mapping
    SEARCH budget_tracker_item_rooms USING INDEX idx_btir_room (room_id=?)
  reconciliation queue, unmapped lines
    SEARCH estimate_line_items USING COVERING INDEX
      idx_estimate_line_items_mapping_status_id (mapping_status=?)
    USE TEMP B-TREE FOR ORDER BY
      <- the IN(...) on mapping_status stops SQLite using the index's own id
         order, so it sorts. Fine at queue size; noted rather than glossed.
  reallocations, newest-first keyset
    SCAN budget_reallocation_ledger USING COVERING INDEX
      idx_budget_reallocation_ledger_occurred_at
      <- scanning the INDEX, not the table, which is the right plan for an
         ORDER BY + LIMIT. This makes the sibling ..._occurred_at_id index
         redundant in practice; harmless, left rather than spend a migration.
  compliance, gates for a contract
    SEARCH contract_compliance_gates USING INDEX
      idx_contract_compliance_gates_contract_state (contract_id=?)
  compliance, active contracts
    SEARCH contracts USING COVERING INDEX idx_contracts_is_active (is_active=?)

Not verified: the six tabs have not been looked at in a browser (the Chrome
extension was not connected). The API contract is proven and the page shells
render; visual parity against the comps still wants a human pass.`,
      migrations: [
        {
          tag: "0184_talented_wendell_vaughn",
          appliedRemote: true,
          note: "Applied via pnpm run migrate:remote. Verified on production D1: all 3 tables present, plus their 7 indexes (2 unique, 5 non-unique). Purely additive — 3 CREATE TABLE plus 1 ADD COLUMN plus 7 CREATE INDEX/UNIQUE INDEX, no drops and no table rebuilds, so no data was at risk.",
        },
        {
          tag: "0185_magical_rage",
          appliedRemote: true,
          note: "Applied via pnpm run migrate:remote. Verified on production D1: all 11 indexes present.",
        },
        {
          tag: "0186_acoustic_rictor",
          appliedRemote: true,
          note: "Applied via pnpm run migrate:remote. Verified on production D1: both indexes present — idx_contract_compliance_gates_state and idx_bee_active_date.",
        },
      ],
      previewWorker: {
        name: "wcrp-orca-budget-ux-overhaul",
        status: "deployed",
        note: "Live at https://wcrp-orca-budget-ux-overhaul.hacolby.workers.dev for review. Torn down with `pnpm run preview:delete` in the same turn as the merge.",
      },
    },
  },
  "health-probe-truth-and-spend-breaker": {
    slug: "health-probe-truth-and-spend-breaker",
    subtitle:
      "System health audit — /admin/system/health, the agent run ledger, and the spend breaker",
    branch: "worktree-bridge-cse_016Rp7EJTqbFmvTpUX2cUvWw",
    prNumber: 382,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/382",

    introduction: `System health was reporting **degraded**. This is the audit of what was
actually wrong, and the fixes for the parts that were fixable in one PR.

The short version: of the five failing probes, **two were measuring the wrong
thing**. They were not reporting a broken system — they were the broken part.
And because both counted rows without any upper bound on age, one bad day pinned
them red permanently, so every genuinely new problem would have arrived behind an
alarm nobody could distinguish from the stale one.`,

    problem: `**Failing probe 1 — "the email pipeline is not completing".**

The probe counted \`worker_emails.status = 'pending'\` and called more than 25%
of a week's mail being pending a pipeline failure. But the 0042 AI trust gate
deliberately *parks* Gmail-sourced mail: \`pipeline.ts\` returns early on
\`deferAiUntilApproval\` and leaves the row \`pending\` with
\`ai_status = 'pending_approval'\`, waiting for a human to approve the AI step.

Pulling the actual rows off production settled it — **22 of 26 pending rows were
parked, not stuck**, every one of them \`source = 'gmail'\`. Mail waiting on you
is not mail the pipeline dropped.

**Failing probe 2 — "a Durable Object is likely awake and billing".**

Worse, because it is a *billing* alarm and it was crying wolf. It counted
\`running\`/\`queued\` rows older than an hour, with no upper bound. The 31 rows on
production were **6 to 16 days old** — and the probe's own message said
\`Last hour started=0\`. Nothing had started. Nothing was awake.

They were corpses. A run row is opened by \`startRun\` and closed by the caller,
so when an isolate dies mid-run the row is never closed. Two real crash modes
produced these, both visible in the ledger: \`Worker exceeded memory limit\` (15
showroom scrape runs) and a Browser Rendering 422 navigation timeout (8 more).

**And the budget that could never trip.**

\`DURABLE_OBJECT\` has been a declared metered provider since the metering system
shipped. It has a config page, a ceiling, a breaker. It also had **no writer
anywhere in the codebase**, so \`getCycleSpend\` summed to \`$0\` for ever and the
ceiling was unreachable by construction. Meanwhile \`generateStructuredOutput\`,
which 15 call sites funnel through, spent on the Workers AI path *and* its Gemini
fallback while checking no ceiling and writing no usage row at all.`,

    approach: `**1. Teach the probes what they are looking at.** The email probe excludes
parked rows from *both* sides of its ratio — excluding them from only the
numerator silently diluted the signal. The DO watcher splits stuck runs by age;
only runs younger than 24h can raise a billing FAILURE.

**2. Close the runs that will never close themselves.** \`sweepAbandonedRuns\`
marks runs stuck past 24h as \`failed\` / \`ABANDONED\` on the daily cron. Using
\`failed\` + an error code rather than a new status is what the probe's own
\`devOpsPlaybook\` prescribed: no migration, no enum change, and it inherits the
90-day failed-run retention.

**3. Measure Durable Object spend once, at the choke point.** Every Agent, DO and
Workflow already opens a run through \`startRun\`, and a run's duration *is* the
billable quantity, so its close prices the wall-clock — one writer for 26
classes. Enforcement deliberately does **not** live there: \`startRun\` is
contractually non-throwing, so the check sits in \`dispatchDueWorkflows\`, where
declining skips the tick and leaves the schedule untouched.

**4. Make the brake cheap enough to use.** \`canSpend\` is two D1 queries, one a
\`SUM\` over an append-only table — fine on an admin page, far too expensive in
front of every AI call. \`breaker-cache.ts\` caches the **decision** in KV: D1
stays authoritative, nothing is incremented in KV (Workers KV has no atomic
increment, and a lost increment under-reports spend), TTL is asymmetric (allow
30s, deny 300s), a miss falls through to the fail-closed D1 path, and every
config write invalidates so break-glass controls bite immediately.

**5. Do not let a budget stop look like an empty answer.** A spend block now
propagates instead of degrading to a zero-op result or a silent per-batch skip.`,

    apiChanges: [
      "POST /api/health/session — `email_pipeline_processing_liveness` and `do_agent_run_volume_watcher` change verdict on the same data. No shape change.",
      "GET /api/config/usage — unchanged shape; DURABLE_OBJECT `spendUsd` is now a real number instead of a structural $0.",
      "GET /api/admin/agents/failures — gains an `ABANDONED` error-code group once the daily sweep fires.",
      "canSpend(env, provider, { fresh?: boolean }) — new optional third argument so admin surfaces never render a cached spend figure.",
    ],

    filesTouched: [
      "src/backend/services/usage/breaker-cache.ts (new)",
      "src/backend/services/usage/metering.ts",
      "src/backend/services/agent-runs.ts",
      "src/backend/services/agent-run-retention.ts",
      "src/backend/services/workflow-dispatcher.ts",
      "src/backend/ai/providers/index.ts",
      "src/backend/services/pascal/ai-edit.ts",
      "src/backend/services/brands/{assign-primary-type,assign-brand-categories,type-consolidation}.ts",
      "src/backend/realtime/health.ts",
      "src/backend/services/email/health.ts",
      "src/_worker.ts",
      "AGENTS.md, package.json (preview cleanup on merge)",
      "scripts/qc/pr_382.mjs (new)",
    ],

    migrations: [],

    code: [
      {
        title: "The email probe — parked is not stuck, on BOTH sides of the ratio",
        lang: "ts",
        code: `const NOT_PARKED = "status = 'pending' AND ai_status <> 'pending_approval'";

// The denominator must exclude parked mail too, or the ratio silently dilutes:
// 90 parked Gmail messages + 10 genuinely stuck worker emails scores 10% and
// reports healthy, when 100% of the mail the pipeline owned is stuck.
const week = await scalar(env.DB,
  "SELECT COUNT(*) FROM worker_emails WHERE created_at >= ? AND ai_status <> 'pending_approval'",
  now - 7 * DAY);`,
      },
      {
        title: "Splitting live spend from dead ledger rows",
        lang: "ts",
        code: `// Past this age a \`running\` row cannot be live spend — the isolate that
// owned it is long gone.
const RESIDUE_AFTER_HOURS = 24;

// Only \`live\` can raise a billing FAILURE. \`residue\` is always reported.
if (live >= 25) return failure(\`\${live} agent runs stuck ... \${residueNote}\`);
if (live > 0 || residue > 0) return degraded(\`...\${residueNote}\`);`,
      },
      {
        title: "Closing an abandoned run without destroying its diagnosis",
        lang: "ts",
        code: `// An earlier version put \`isNull(errorCode)\` in the WHERE clause to avoid
// clobbering a manual annotation. That did the opposite of the intent: it
// EXCLUDED those rows from the sweep, so a run that logged a non-fatal error and
// then died stayed \`running\` for ever — the most informative row, permanently
// stranded. Select the value instead of filtering on it.
.set({
  status: "failed",
  errorCode: sql\`COALESCE(\${agentRuns.errorCode}, \${ABANDONED_ERROR_CODE})\`,
})
.where(and(inArray(agentRuns.status, ["running", "queued"]), lt(agentRuns.createdAt, cutoff)));`,
      },
      {
        title: "Asymmetric TTL — a stale allow costs money, a stale deny does not",
        lang: "ts",
        code: `const ALLOW_TTL_SECONDS = 30;
const DENY_TTL_SECONDS = 300;

// \`read_error\` means D1 was unreadable. Pinning a deny for five minutes over one
// blip would turn a momentary hiccup into an outage of every metered feature.
if (decision.reason === "read_error") return;
await env.CACHE.put(cacheKey(decision.provider), JSON.stringify(decision), {
  expirationTtl: decision.allowed ? ALLOW_TTL_SECONDS : DENY_TTL_SECONDS,
});`,
      },
    ],

    diagrams: [
      {
        caption: "Where the breaker sits, and what is authoritative",
        title: "Spend decision path — KV caches the answer, D1 owns the truth",
        description: `The only thing written to KV is a **decision**, and it is only ever
replaced, never incremented. A KV miss is not an answer — it falls through to D1,
which fails closed. That is what stops a cache outage from quietly becoming an
unlimited spending permit.`,
        code: `flowchart TD
  CALL["AI call / workflow dispatch"] --> CS["canSpend(provider)"]
  CS --> KV{"KV: cached decision?"}
  KV -->|hit| RET["allow / deny"]
  KV -->|miss, error, or fresh:true| D1CFG["D1 project_system_variables"]
  D1CFG --> D1SUM["D1 gemini_usage_log<br/>SUM(estimated_cost_usd) this cycle"]
  D1SUM --> DEC["decideSpend()"]
  DEC --> WRITE["cache decision<br/>allow 30s / deny 300s"]
  WRITE --> RET
  D1SUM -.->|read fails| CLOSED["FAIL CLOSED: deny<br/>(never cached)"]
  CONFIG["admin edits a budget"] --> INV["invalidateBreakerCache()"]
  INV --> KV
  RUN["startRun close"] --> LEDGER["recordUsage DURABLE_OBJECT<br/>wall-clock priced"]
  LEDGER --> D1SUM`,
      },
      {
        caption: "Why a crashed run looked like a live Durable Object",
        title: "Agent run lifecycle — the gap the sweep closes",
        code: `stateDiagram-v2
  [*] --> running: startRun()
  running --> succeeded: run.succeed()
  running --> failed: run.fail()
  running --> orphaned: isolate dies<br/>(memory limit, evicted step)
  orphaned --> orphaned: nothing closes it — stays 'running' for ever
  orphaned --> failed: sweepAbandonedRuns()<br/>error_code = ABANDONED
  succeeded --> [*]: pruned after 30d
  failed --> [*]: pruned after 90d`,
      },
    ],

    verification: {
      qcScript: "scripts/qc/pr_382.mjs",
      command: "pnpm run test:pr 382 -- --preview   /   pnpm run test:pr 382",
      ranAt: "2026-08-12",
      source: `// The two probe fixes are assertions about CLASSIFICATION, not about the app
// doing more work, so "does the endpoint 200" would pass either way. The
// meaningful check is: given the same prod data, does the probe still call it a
// FAILURE?
check("parked (pending_approval) mail no longer reads as FAILURE",
  email.result !== "FAILURE", \`result=\${email.result} — \${email.details}\`);
check("aged residue does not raise a billing FAILURE",
  doWatcher.result !== "FAILURE", \`result=\${doWatcher.result} — \${doWatcher.details}\`);`,
      output: `PREVIEW: 21 passed, 0 failed — counts={"success":77,"degraded":10,"failure":3}
  email probe: DEGRADED — 4 email(s) older than 6h are still status='pending'
               (7d volume excl. parked: 0). 23 awaiting your approval (not stuck).
  DO watcher:  DEGRADED — 0 agent run(s) running/queued for 1-24h (last hour started=0).
               (plus 31 run(s) older than 24h — dead ledger rows, not live spend)

PRODUCTION regression run (pre-merge): 16 passed, 0 failed
  Still the pre-fix probes (FAILURE) — pending merge/deploy.

DURABLE_OBJECT writer proven live on the preview by triggering one real agent run
(pricing catalog refresh; no model spend):
  DURABLE_OBJECT spendUsd = 0.000044925   (was structurally $0 — no writer existed)

NET EFFECT: failing probes 5 → 3. The 3 that remain are real and are NOT fixed by
this PR: Tesla telemetry stale, 6 duplicate brand groups, 9 mappings pointing at
retired brands.

REVIEW: the Gemini/codra bot was offline and the Cursor CLI could not run (see the
PR thread). An adversarial pass via the local orchestrator found two real defects,
both fixed here; two more were found by reviewing this PR's own diff.

Typecheck: npx tsc --noEmit — pre-existing baseline only, zero introduced
(diffed before/after with git stash).
Migrations: none.`,
      migrations: [],
      previewWorker: {
        name: "wcrp-worktree-bridge-cse-016rp7ejtqbfmvtpux2cuvww",
        status: "deleted",
        note: "Torn down. This entry is also the first user of the previewWorker field it introduces.",
      },
    },
  },

  "budget-grid-usability": {
    slug: "budget-grid-usability",
    branch: "claude/budget-grid-followups",
    prNumber: 400,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/400",
    subtitle: "0035 follow-up · make the shipped grid usable",
    code: [],
    problem:
      "The grid shipped correct but degenerate: no UI assigned a line to a phase (everything sat under 'Unphased') and no UI set funding accounts (Total Budget $0, Remaining meaningless). Worse, phaseId existed on the item but the PATCH revision insert didn't carry it — so even an MCP/API phase assignment would be wiped by the next unrelated edit.",
    approach:
      "Two small grid controls + one backend fix. A ghost per-line phase-select PATCHes /api/budget-tracker/items/{id} {phaseId} (the grid line already carries the active item id) then refetches. A 'Set budget' dialog on the Total-budget scorecard loads /financial-status and saves via PUT /financial-accounts (upsert by key; new keys slugified). The backend fix adds phaseId to BudgetTrackerPatch and carries phaseId + variance-note md/html forward in the revision insert (undefined=keep, null=unassign) so edits no longer wipe them.",
    apiChanges: [
      "USES existing PATCH /api/budget-tracker/items/{id} (now honors + persists phaseId), GET /api/config/budget-phases, GET /api/budget-tracker/financial-status, PUT /api/budget-tracker/financial-accounts.",
      "No new routes, no schema/migration — phaseId + variance columns shipped in #360.",
    ],
    filesTouched: [
      "src/backend/api/routes/budget-tracker.ts (phaseId in patch + carry phaseId/variance across revisions)",
      "src/frontend/components/BudgetGridApp.tsx (PhaseSelect per line + FundingDialog)",
      "src/frontend/components/budget-grid-view.ts (slugifyAccountKey helper)",
      "scripts/tests/test_budget_grid_view.mjs, scripts/qc/pr_400.mjs",
    ],
    migrations: [],
    diagrams: [],
    verification: {
      qcScript: "scripts/qc/pr_400.mjs",
      command:
        "node scripts/qc/pr_400.mjs --preview  (11/11)  &&  node scripts/qc/pr_400.mjs  (prod 8/8)",
      ranAt: "2026-08-12",
      output:
        "QC 11/11 preview: phases list, funding round-trip (write current values back), phase assign → line moves into the phase group, phase RETAINED after an unrelated edit (carry-forward fix), restored to Unphased, grid regression. Prod 8/8: funding + regression green; phase-assign persistence correctly reports pending merge/deploy (old prod code ignores phaseId). Funding dialog also browser-verified on preview (load → edit → save → refetch, no console errors). Build green; tsc no new errors in touched files; view self-check incl. slugifyAccountKey passes.",
      migrations: [],
    },
  },
  "vendor-email-context-layer": {
    slug: "vendor-email-context-layer",
    branch: "feat/vendor-email-context-layer",
    prNumber: 379,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/379",
    subtitle: "PR 2a of 3 · the context layer a vendor email is composed from — sends nothing",
    introduction:
      "This is the second PR in the vendor-email arc (PR 1 was Drive ingestion, #374). It builds the layer a vendor email is COMPOSED from — a reusable boilerplate/guidance doc, and a recipient lookup that resolves an address or a showroom store+contact reference without ever guessing. The actual send (Gmail draft/attach/schedule mechanics) is explicitly out of scope and lives on the separate google-workspace-mcp worker; this PR assembles the payload that worker would send.",
    problem:
      "Composing a vendor email today means re-deriving the same three things by hand every time: what boilerplate/etiquette guidance applies (how to address a trade contact, what to always mention), who the actual recipient address is (a showroom store row does not carry one address — it carries zero-or-more contacts, and picking the wrong one sends the email to the wrong person), and which Drive files to attach vs link (Gmail caps a message at 25 MiB and there is no single place that already knows a file's size and share state together).\n" +
      "The showroom_store_contacts table already holds contacts, but nothing resolves 'a store name' or 'a store + a role like billing' down to one address — an ambiguous or unmatched reference has no defined behavior, so the natural failure mode is a caller guessing or falling through to whatever came back first.",
    approach:
      "Four pieces, each doing one thing, composed by the tool that actually gets called in a chat:\n" +
      "1. **email_instructions** (migration 0176) — a single row (id=1) holding the boilerplate doc as markdown (canonical) + html (sanitized render cache), following the repo's existing rich-text storage rule. `getInstructions`/`upsertInstructions` in one service so the API route and the MCP tools cannot diverge, and `sanitizeNoteHtml` runs on every write — raw html is never persisted.\n" +
      "2. **resolveRecipient** — an explicit `email` wins outright (after a pragmatic format check). Otherwise a `store` reference is matched by numeric id or a `LIKE %needle%` name substring against `showroom_stores`, then narrowed to that store's contacts that actually HAVE an email address, optionally narrowed again by a `contact` name/role substring. Every branch that cannot resolve to exactly one recipient returns a structured `{ ok:false, reason: no_match|ambiguous|invalid, candidates }` — this mirrors the repo's ambiguous-parent doctrine (rooms, receipts): stage/report, never guess.\n" +
      "3. **compose_vendor_email** (MCP, read-only) — calls resolveRecipient, loads the instructions doc, loads the requested Drive documents (from PR #374's catalogue) chunked at 20 ids to stay under D1's 100-bound-param cap, and runs `suggestDispositions` (a 18 MiB running-budget bin-pack — Gmail's 25 MiB cap minus ~1.33x base64 inflation) to mark each file attach vs link. If the recipient does not resolve, this tool returns the SAME ok:false/candidates shape as resolve_recipient rather than swallowing it, so the calling agent surfaces the ambiguity to the human instead of picking a candidate.\n" +
      "4. **/admin/email/instructions** — an admin-gated editor page for the boilerplate doc, using the same PlateJS-backed rich-text pattern (`{ markdown, html }` via `onChange`) the repo already uses for store/visit notes, rather than a bare textarea.\n" +
      "Everything sits behind `requireAccessAuth` on `/api/email/*` (worker bearer / admin cookie), matching every other admin-only surface in the repo.",
    apiChanges: [
      "GET /api/email/instructions -> { markdown, html, updatedAt }.",
      "PUT /api/email/instructions accepts { markdown, html }, sanitizes html on write, returns { markdown, html }.",
      "GET /api/email/resolve-recipient?email=|store=&contact= -> ResolveResult. Always HTTP 200 — ok:false with a reason (no_match | ambiguous | invalid) and candidates[] is a valid resolved result, not an error status.",
      'MCP tools (category "email"): get_email_instructions, update_email_instructions, resolve_recipient, compose_vendor_email (all registered in src/backend/mcp/tools/email/index.ts).',
      "No send endpoint exists or is planned here — compose_vendor_email's payload is handed to the google-workspace-mcp worker's gmail_send / schedule_email.",
    ],
    filesTouched: [
      "drizzle/0181_new_sunset_bain.sql, src/backend/db/schema/email/email_instructions.ts",
      "src/backend/services/email/instructions.ts, resolve-recipient.ts (+ .test.ts), disposition.ts (+ .test.ts)",
      "src/backend/api/routes/email.ts, src/backend/api/index.ts (requireAccessAuth gate + app.route mount)",
      "src/backend/mcp/tools/email/{get_email_instructions,update_email_instructions,resolve_recipient,compose_vendor_email,index}.ts",
      "src/frontend/components/email/EmailInstructionsEditor.tsx, src/frontend/pages/admin/email/instructions.astro",
      "scripts/qc/pr_379.mjs",
    ],
    migrations: [
      {
        tag: "0181_new_sunset_bain",
        sql: `CREATE TABLE \`email_instructions\` (
\t\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\t\`instructions_markdown\` text DEFAULT '' NOT NULL,
\t\`instructions_html\` text DEFAULT '' NOT NULL,
\t\`updated_at\` integer DEFAULT (unixepoch()) NOT NULL
);`,
      },
    ],
    code: [
      {
        title: "resolveRecipient — never guesses (src/backend/services/email/resolve-recipient.ts)",
        lang: "ts",
        code: `export type ResolveResult =
  | { ok: true; recipients: ResolvedRecipient[] }
  | {
      ok: false;
      reason: "no_match" | "ambiguous" | "invalid";
      message: string;
      candidates: ResolvedRecipient[];
    };

// An explicit address wins outright (after a format check); otherwise the
// store match must land on exactly one row, and that store's matching
// contacts must land on exactly one email — anything else is reported, not
// guessed.
if (storeRows.length > 1) {
  return {
    ok: false,
    reason: "ambiguous",
    message: \`"\${input.store}" matched \${storeRows.length} stores; be specific\`,
    candidates: storeRows.map((s) => ({ email: "", name: s.name, storeId: s.id, storeName: s.name, contactType: null })),
  };
}`,
      },
      {
        title: "suggestDispositions — attach vs link against the Gmail budget (disposition.ts)",
        lang: "ts",
        code: `export const GMAIL_ATTACH_BUDGET_BYTES = 18 * 1024 * 1024; // 25 MiB cap, minus ~1.33x base64 inflation

export function suggestDispositions(files, budgetBytes = GMAIL_ATTACH_BUDGET_BYTES) {
  let used = 0;
  return files.map((f) => {
    if (f.sizeBytes == null || used + f.sizeBytes > budgetBytes) {
      return { driveDocumentId: f.driveDocumentId, suggestedDisposition: "link" as const };
    }
    used += f.sizeBytes;
    return { driveDocumentId: f.driveDocumentId, suggestedDisposition: "attach" as const };
  });
}`,
      },
    ],
    diagrams: [
      {
        caption: "how a vendor email gets composed",
        title: "compose_vendor_email assembles, it never sends",
        description:
          "Every arrow into compose_vendor_email is a read. The only thing that leaves this worker is the assembled payload, handed to a different worker that owns the actual Gmail send.",
        code: `flowchart TD
  A[compose_vendor_email input: email/store/contact, subject, driveDocumentIds] --> B[resolveRecipient]
  B -->|ok:false| C[return ok:false + candidates - ask the human]
  B -->|ok:true| D[getInstructions - the boilerplate doc]
  A --> E[load driveDocuments by id, chunked 20]
  E --> F[suggestDispositions vs 18 MiB budget]
  D --> G[assemble payload: to, subject, instructionsMarkdown, attachments]
  F --> G
  G --> H["google-workspace-mcp worker\ngmail_send / schedule_email (OUT OF SCOPE HERE)"]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_379.mjs",
      command: "node scripts/qc/pr_379.mjs --preview   (and without --preview for production)",
      ranAt: "2026-08-11",
      source: `// The capability gate + the load-bearing sanitize assertion.
const probe = await client.get("/api/email/instructions");
if (probe.status === 404) {
  checks.info("pending merge/deploy — GET /api/email/instructions returned 404 ...");
  checks.finish();
  return;
}
// PUT then GET: markdown round-trips exactly, html has the <script> stripped.
checks.ok(
  "GET after PUT: html is sanitized — <script> tag stripped",
  typeof after.json?.html === "string" && !after.json.html.includes("<script"),
  \`got \${JSON.stringify(after.json?.html)}\`,
);
// Always restore the shared row afterward — PUT overwrites the single row.
const restore = await client.req("PUT", "/api/email/instructions", {
  body: { markdown: original.markdown, html: original.html },
});`,
      output: `$ node scripts/qc/pr_379.mjs --preview

PR #379 QC — vendor-email context layer
  target: https://wcrp-feat-vendor-email-context-layer.hacolby.workers.dev

  ✓ target reachable (https://wcrp-feat-vendor-email-context-layer.hacolby.workers.dev)
  ✓ GET /api/email/instructions returns 200 (the surface is expected to exist on this target)
  ✓ PUT /api/email/instructions accepts { markdown, html } -> 200
  ✓ GET after PUT: markdown round-trips exactly
  ✓ GET after PUT: html is sanitized — <script> tag stripped
  ✓ GET after PUT: sanitized html still keeps the safe markup
  ✓ restored the original instructions row (shared state left clean)
  ✓ resolve-recipient?email=<valid address> -> ok:true, recipients[0].email matches
  ✓ resolve-recipient?email=<malformed> -> ok:false, reason:invalid
  ✓ resolve-recipient?store=<unknown> -> ok:false, reason:no_match
    store lookup for "Pietrafina" -> status 200, body {"ok":false,"reason":"no_match","message":"no store matched \\"Pietrafina\\"","candidates":[]}

10 passed, 0 failed


$ node scripts/qc/pr_379.mjs      # production regression guard, pre-merge

PR #379 QC — vendor-email context layer
  target: https://core-remodel.hacolby.workers.dev

  ✓ target reachable (https://core-remodel.hacolby.workers.dev)
    pending merge/deploy — GET /api/email/instructions returned 404. Expected on production pre-merge; every assertion below is skipped rather than failed.

1 passed, 0 failed`,
      migrations: [
        {
          tag: "0181_new_sunset_bain",
          appliedRemote: true,
          note: "Applied via pnpm run migrate:remote and verified: email_instructions present on the remote DB.",
        },
      ],
    },
  },
  "showroom-stores-normalization": {
    slug: "showroom-stores-normalization",
    branch: "claude/database-schema-audit-cleanup-271ac6",
    subtitle: "Audit + migration plan · no schema shipped",
    introduction:
      "This is a plan, not a merge. It answers one question with live prod numbers: can the 16 flat location/contact columns on showroom_stores be dropped, and if not, what has to happen first.",
    problem:
      "showroom_stores is a 58-column table still carrying flat location columns (location_*, latitude, longitude, place_id, google_maps_link, zip_code) and contact columns (phone_number, email_address, main_poc_*) even though dedicated child tables — showroom_store_locations and showroom_store_contacts — already exist for them.\n" +
      "The instinct to move that data out is correct, but the real state is subtler than 'the table is hoarding columns': the LOCATION side is already 100% mirrored (all 233 active stores have >=1 location row; the flat columns are redundant copies that were never cleared), while the CONTACT side is barely started (0 GENERAL_CONTACT rows; 72 legacy showroom_pocs + 5 flat main_poc stores unmigrated). The blocker is not schema — it is that intake writes ZERO child rows and ~35 placeId sites plus every geo/drive/dedup reader still read the flat columns via whole-row selects, so a DROP COLUMN is a silent undefined at the boundary, not a compile error.",
    approach:
      "A 6-agent audit workflow (schema readiness, backend + frontend blast-radius, intake readiness, live-data quantification, synthesis) measured the surface against origin/main and live prod, then produced a staged expand→contract plan.\n" +
      "Verdict: readyToDrop = PARTIAL. Sequence: Phase 0 guardrails (partial-unique indexes for one GENERAL_CONTACT and one is_primary contact per store; zip reconcile; cross-table place_id guard) → Phase 1 contacts backfill + name Title-Casing + domain consolidation → Phase 2 rewire intake to dual-write child rows and add the place_id-new-location path → Phase 3 migrate readers to JOINs (placeId → geo → contacts → address-derived) → Phase 4 stop dual-writing, repoint the place_id unique index, retire showroom_pocs → Phase 5 DROP in a separate backup→rebuild→restore migration after prod is verified.\n" +
      "Also folds in the requested intake-normalization + 50-mile sibling-discovery feature, mapped onto the real stack and correcting a Gemini reference snippet (no UUID-PK tables, no isSibling flag — isPrimary is DERIVED per PR #375 — no OpenAI-via-gateway path, extend the existing bulk-intake workflow).",
    apiChanges: [
      "(planned) POST /api/showroom-contacts/backfill/from-pocs?apply=true — migrate 72 pocs + 5 flat main_poc into showroom_store_contacts (GENERAL_CONTACT + is_primary person rows).",
      "(planned) intake write paths (_shared.ts persistPlaceShowroom / adoptPlaceLocation, create_showroom.ts) dual-write showroom_store_locations + showroom_store_contacts; server-side 50-mile Places sibling discovery gated by website-host signal.",
      "(planned) LIST/DETAIL showroom-stores routes swap whole-row `store: showroomStores` selects for JOINs re-aliased to identical output keys.",
      "No endpoints changed in this entry — plan + changelog only.",
    ],
    filesTouched: [
      "docs/plans/2026-08-09-showroom-stores-normalization.md (the plan)",
      "docs/plans/2026-08-09-showroom-stores-normalization/data/*.json (live prod query exports)",
      "src/frontend/data/changelog.ts (this entry)",
      "src/frontend/data/changelog-detail.ts (this detail)",
    ],
    migrations: [],
    code: [
      {
        title: "Hard facts computed from the live prod pull (summary.json)",
        lang: "json",
        code: `{
  "activeStores": 233,
  "flatColumnPopulation": {
    "placeId": 184, "locationAddress": 207, "latitude": 184, "longitude": 184,
    "phoneNumber": 219, "emailAddress": 39,
    "mainPocFullname": 5, "mainPocPhoneNumber": 5, "mainPocEmailAddress": 4
  },
  "contacts": { "rows": 12, "generalContactRows": 0, "byType": { "OTHER": 10, "MANAGER": 2 } },
  "legacyPocsBackfillDryRun": { "pocs": 72, "mainPocs": 5, "apply": false }
}`,
      },
    ],
    diagrams: [
      {
        caption: "before / after — column moves",
        title: "Before / After: the store row splits",
        description:
          "Red = removed from showroom_stores. Green = added / now canonical on the child tables. showroom_pocs retires into contacts.",
        code: `flowchart TB
  subgraph BEFORE["Before — everything on the store row"]
    direction TB
    Bs["showroom_stores<br/>58 cols · incl 16 flat location + contact"]:::del
    Bp["showroom_pocs · 72 rows"]:::del
  end
  subgraph AFTER["After — brand vs site split"]
    direction TB
    As["showroom_stores<br/>brand-level only · name, notes, mappings"]:::keep
    Al["showroom_store_locations<br/>+ place_id + lat/lng + address parts + unit"]:::add
    Ac["showroom_store_contacts<br/>+ is_primary + location_id"]:::add
  end
  Bs -->|"9 location cols move"| Al
  Bs -->|"phone / email / main_poc move"| Ac
  Bs -->|"drop location_address, legacy zip_code"| As
  Bp -->|"retired -> merged into"| Ac
  classDef del fill:#fbeaea,stroke:#d83a3f,color:#b02a2e;
  classDef add fill:#e7f6ec,stroke:#1f9d57,color:#166b3d;
  classDef keep fill:#eef1f6,stroke:#8a93a3,color:#444;`,
      },
      {
        caption: "after-model ER diagram",
        title: "Entity model after normalization",
        description:
          "Attribute comments mark REMOVED (moves off the store) vs ADDED. Content tables reference a physical location, not the brand.",
        code: `erDiagram
  showroom_stores ||--o{ showroom_store_locations : "1:N sites"
  showroom_stores ||--o{ showroom_store_contacts : "anchor"
  showroom_store_locations ||--o{ showroom_store_contacts : "location_id"
  showroom_stores ||--o{ showroom_store_category_mapping : "N:M"
  showroom_store_category ||--o{ showroom_store_category_mapping : "N:M"
  showroom_stores ||--o{ showroom_image_groups : "user stacks"
  showroom_image_groups ||--o{ showroom_images : "group_id"
  showroom_store_locations ||--o{ showroom_images : "location_id"
  showroom_store_locations ||--o{ showroom_photos_mapping : "location_id"
  showroom_store_locations ||--o{ showroom_store_ratings : "location_id"
  showroom_store_locations ||--o{ store_notes : "location_id"
  showroom_stores ||--o{ showroom_store_links : "brand"
  showroom_store_locations ||--o{ showroom_store_hours : "location_id"
  showroom_stores ||--o{ showroom_store_sales : "brand"
  showroom_store_contacts ||--o{ showroom_store_contact_log : "who was contacted"
  showroom_stores {
    int id PK
    text name "brand"
    int type_id FK "EXISTS to store_type"
    bool is_active "EXISTS soft-delete"
    text soft_delete_reason "ADD"
    text overview_note_markdown "brand"
    text overview_note_html "brand"
    text rating_context_markdown "brand"
    text place_id "REMOVED to location"
    real latitude "REMOVED to location"
    text phone_number "REMOVED to contact"
    text main_poc_fullname "REMOVED to contact"
  }
  showroom_store_locations {
    int id PK
    int store_id FK
    text place_id "canonical uniq"
    real latitude
    real longitude
    text unit
    text city
    text zip_code
    text notes_markdown
    text notes_html
  }
  showroom_store_contacts {
    int id PK
    int store_id FK
    int location_id FK "ADD"
    bool is_primary "ADD"
    text type "GENERAL_CONTACT etc"
    text first_name
    text last_name
    text office_phone_number
    text mobile_phone_number
    text email_address
  }
  showroom_store_contact_log {
    int id PK
    int store_id FK
    int store_contact_id FK
    text outcome
  }
  showroom_store_category {
    int id PK
    text name "cleaned canonical"
    text description
    bool is_active "merged-away = false"
  }
  showroom_store_category_mapping {
    int id PK
    int store_id FK
    int category_id FK
    bool is_primary "ADD one per store"
    bool is_bread_butter "specialist 1-2"
    int ai_rationale_confidence_score
  }
  showroom_images {
    int id PK
    int store_id FK
    int location_id FK "ADD"
    int group_id FK "to image_groups"
    text image_kind "visit or discovered"
    text delivery_url
    text note_markdown "polaroid"
    text note_html
  }
  showroom_image_groups {
    int id PK
    int store_id FK
    text name
    text description_markdown
    text description_html
    int price_cents
    int cover_image_id "to images"
  }
  showroom_photos_mapping {
    int id PK
    int store_id FK "showroom_id"
    int location_id FK "ADD exact place"
    text cf_images_photo_url
    text author_attributes "Google attribution"
    int sort_order "Places rank"
  }
  showroom_store_ratings {
    int id PK
    int store_id FK
    int location_id FK "ADD"
    text source "SYSTEM_USER GOOGLE YELP HOUZZ"
    int rating "1-5"
    text comment "external plain"
    text rating_context_markdown "ADD user note"
    text rating_context_html "ADD"
    bool is_active "ADD revision"
    int replaced_by_id "ADD revision"
  }
  store_notes {
    int id PK
    int store_id FK
    int location_id FK "ADD nullable=brand"
    text content_markdown
    text content_html
    bool is_active
  }
  showroom_store_links {
    int id PK
    int store_id FK
    text type "WEBSITE INSTAGRAM etc"
    text url
  }
  showroom_store_hours {
    int id PK
    int store_id FK
    int location_id FK "EXISTS nullable=brand"
    text day
    text open_close
  }
  showroom_store_sales {
    int id PK
    int store_id FK
    text title
    int price_cents
  }`,
      },
      {
        caption: "content re-parents to a location",
        title: "Site content attaches to a location, not the store",
        description:
          "8 tables gain a nullable location_id (green); 5 stay brand/store-level (grey).",
        code: `flowchart LR
  LOC["showroom_store_locations<br/>one physical site"]:::hub
  subgraph MOVED["gains location_id — site content"]
    direction TB
    pm["showroom_photos_mapping · 479"]:::add
    rt["showroom_store_ratings · 32<br/>+ SYSTEM_USER user rating"]:::add
    ct["showroom_store_contacts · 12"]:::add
    im["showroom_images · 242"]:::add
    nt["store_notes · 65"]:::add
    pp["product_showroom_photos"]:::add
    pr["product_price_observations"]:::add
    sr["store_rating · 0 rows<br/>RETIRED into ratings"]:::del
  end
  subgraph STAY["stays brand / store-level"]
    direction TB
    ss["scraping_sitemap"]:::keep
    br["browser_run_pages · 649"]:::keep
    pb["product_photo_buckets"]:::keep
    sl["showroom_scan_log"]:::keep
  end
  pm --> LOC
  rt --> LOC
  ct --> LOC
  im --> LOC
  nt --> LOC
  pp --> LOC
  pr --> LOC
  sr --> rt
  classDef add fill:#e7f6ec,stroke:#1f9d57,color:#166b3d;
  classDef keep fill:#eef1f6,stroke:#8a93a3,color:#555;
  classDef hub fill:#eaecfb,stroke:#4f5bd5,color:#2f3a9e;`,
      },
    ],
    verification: {
      qcScript: "docs/plans/2026-08-09-showroom-stores-normalization/data/ (live prod exports)",
      command:
        'curl -H "cookie: remodel_access=$(sha256 WORKER_API_KEY)" $BASE/api/showroom-stores?limit=500 | (compute populations)',
      source:
        "GET /api/showroom-stores?limit=500 ; GET /api/showroom-stores/meta/incomplete ; GET /api/showroom-contacts ; POST /api/showroom-contacts/backfill/from-pocs (no apply)",
      output:
        '233 active stores. flat place_id=184, address=207, lat+long=184, phone=219, email=39, main_poc=5. contacts: 12 rows / 11 stores / 0 GENERAL_CONTACT. from-pocs dry-run: {"pocs":72,"mainPocs":5,"apply":false}. list endpoint returns FLAT columns with NO locations[] join.',
      ranAt: "2026-08-09",
      migrations: [],
    },
  },
  "drive-ingestion-review-followups": {
    slug: "drive-ingestion-review-followups",
    branch: "fix/drive-ingestion-review-followups",
    prNumber: 377,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/377",
    subtitle: "Three review fixes on the Drive ingestion service (PR #374)",
    introduction:
      "An independent reviewer (Cursor, gpt-5.6-sol-high) run over the *merged* PR #374 caught three real defects the build's own multi-agent review chain missed. Two of them are interactions BETWEEN fixes from the same wave — a class a diff-scoped review structurally cannot see, because each change looks correct in isolation.",
    problem:
      "The Drive ingestion service (PR #374) shipped with three latent defects, only visible once the fixes in that wave were considered together:\n\n" +
      "1. **Scan lease released unconditionally.** A scan that ran past the 30-minute staleness window and had its lease legitimately stolen by another scan would still clear the lease on exit — clearing the THIEF's newer lease, not its own — letting a third scan run concurrently against the same root.\n\n" +
      "2. **The supersede compensating write could never run.** The partial `UNIQUE (root_id, drive_id) WHERE is_active = 1` index, added in the SAME fix wave as the insert-then-link compensation, rejects the reactivation once the replacement row is already active. So a transient failure of the `supersededById` link threw out of the catch block and aborted the entire scan — the compensation it was supposed to be was dead on arrival.\n\n" +
      "3. **Sharing changes were invisible.** The change-detection diff compared name, parent and content hash but NOT sharing state. A Drive permission change with no rename/move/edit was classified `unchanged`, so D1 kept the stale sharing value forever — and that value is what decides whether a Drive link may be emailed to an outside vendor.",
    approach:
      "### 1. Lease ownership token\n`acquireScanLease` now returns the lease token it wrote (the `scanStartedAt` timestamp, read back so it matches D1's second granularity), and release is conditional: `WHERE scanStartedAt = <token>`. A scan can only clear the lease it actually holds, so a stolen-then-released lease no longer opens a concurrency window.\n\n" +
      "### 2. Split insert-failure from link-failure\nThe two failure modes are now handled apart, on both the document and folder supersede paths: an **insert** failure reactivates the prior row (safe); a **link** failure leaves it (the replacement is already live), instead of letting the partial-unique index turn a compensating write into a scan-aborting throw.\n\n" +
      "### 3. Metadata-update action\nSharing is now part of the diff. A change to sharing alone triggers a new **metadata-update** action that updates the row IN PLACE — no bogus revision, no re-embed — for both documents and folders, and a `metadataUpdated` counter surfaces it in the ingest summary. A subtle asymmetry, because Drive omits `allowFileDiscovery` when false, is covered by the unit tests.",
    apiChanges: [
      "GET /api/admin/drive/documents — now paginated (limit default 200, max 500; offset) instead of an unbounded read.",
      "No new endpoints; no migration. Behavior fixes to the existing ingest + documents routes.",
    ],
    filesTouched: [
      "src/backend/services/google/drive-ingest.ts (lease token, split compensation, metadata-update action)",
      "src/backend/services/google/drive-diff.ts (sharing added to the change diff)",
      "src/backend/services/google/drive-diff.test.ts (unit tests: sharing-omit asymmetry, multi-parent dedup)",
      "src/backend/api/routes/admin-drive-ingest.ts (documents route pagination)",
      "scripts/qc/pr_374.mjs (QC harness, reused)",
      "src/frontend/data/changelog.ts (this entry)",
    ],
    migrations: [],
    code: [
      {
        title: "Lease release is now conditional on the token the scan wrote",
        lang: "ts",
        code: `// acquire returns the token; release only clears the lease we actually hold\nconst token = await acquireScanLease(db, rootId); // = the scanStartedAt it wrote\ntry {\n  // …scan…\n} finally {\n  await db.update(driveRoots)\n    .set({ scanStartedAt: null })\n    .where(and(eq(driveRoots.id, rootId), eq(driveRoots.scanStartedAt, token)));\n  // a stolen-then-released lease no longer clears the thief's newer lease\n}`,
      },
    ],
    diagrams: [],
    verification: {
      qcScript: "scripts/qc/pr_374.mjs + src/backend/services/google/drive-diff.test.ts",
      command: "pnpm run test:pr 374 (QC) · drive-diff unit tests (custom harness)",
      output:
        "Backfilled detail for an already-merged + deployed PR (#377, 2026-08-10). Not re-run in this backfill session; the fixes shipped to prod and are covered by the drive-diff unit tests (sharing-omit asymmetry, multi-parent dedup) added in the same PR, plus the pr_374 QC harness. No migration.",
      ranAt: "2026-08-10",
      migrations: [],
    },
  },
  "drive-ingestion-service": {
    slug: "drive-ingestion-service",
    branch: "feat/drive-ingestion-service",
    prNumber: 374,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/374",
    subtitle:
      "PR 1 of 3 · the catalogue the vendor-email and research-indexing features both sit on",
    introduction:
      "Point this service at a Google Drive folder, tell it what the folder is FOR, and it keeps D1 in step with Drive every night. Adding another folder later is a row insert rather than a code change.",
    problem:
      "Two things happen constantly and the platform supported neither.\n\nEmailing a vendor project material went through the generic claude.ai Gmail connector, which knows nothing about the project, the boilerplate, or the files — this repo's MCP registry had **126 tools and not one of them could send email**. And a research corpus sitting in Drive was entirely invisible to the app.\n\nBoth need the same thing underneath: a service that ingests a Drive folder into D1, keyed by what the content is for.\n\n### What the folders actually contain\n\nBoth were walked in full before any code was written, and the measurements changed the design:\n\n| Root | Reality |\n| --- | --- |\n| Onboarding materials | 72 nodes — ~55 images, 4 PDFs, 1 `.skp`, **zero** Google Docs |\n| Deep research findings | 87 nodes — ~46 Google Docs, 26 generated HTML, 12 topic folders |\n\nThe onboarding folder is a photo library, not a document library, so its value is sending files — which needs **sizes and links**, not a text-extraction pipeline. That inverted the original plan.\n\nA near-miss worth recording: an earlier draft pointed at a different folder that turned out to be **~99% machine-generated processing logs** — 4,972 of 5,000 nodes in one subfolder. Ingesting that would have put thousands of debug files in D1 and, in PR 3, embedded all of them. The root was corrected, but per-root exclusions stayed in the schema, because the hazard is real and the guard is cheap.",
    approach:
      '### The service\n\n`ingestDriveFolder(env, rootId)` walks a root recursively, applying that root\'s exclusions **during descent** so an excluded subtree costs one membership check rather than thousands of API reads. The flat node list then goes through a **pure** classifier — no network, no database — that emits create / supersede / delete / unchanged, which is what makes the interesting cases unit-testable at all.\n\n### Change detection, and the asymmetry in it\n\nBinary files carry Drive\'s own md5. **Google-native files (Docs, Sheets, Slides) carry no `md5Checksum` at all**, so they are hashed over their exported text, and `hashSource` records which method was used so a hash is never compared across kinds. This is not academic: the research corpus contains six separate Docs sharing a title and near-identical content.\n\nEqual hashes deliberately do **not** merge two files. Identity is the Drive id. Collapsing those six would destroy real rows, and there is a test asserting it does not happen.\n\n### Two flags, not one\n\n`isActive = false` means superseded by a rename or move — a new row carries the current state and `supersededById` links them into a revision chain. `isDeleted = true` means gone from Drive. Nothing is ever hard-deleted. A file can be superseded without being deleted, and deleted without ever having been superseded; one flag would lose the difference between "this moved" and "this is gone".\n\n### Sharing state, and why it earns a column\n\nDrive v3 has no access-level field — it returns a `permissions[]` array and leaves the interpretation to you. The five Apps Script values are derived from it, and the derivation has one trap that has its own test: **Drive omits `allowFileDiscovery` when it is false**, so an absent key must read as false. Reading it as true would label a link-shared file as publicly discoverable, and that value decides whether a Drive link gets emailed to an outside vendor.\n\n### Reuse instead of new tables\n\nThe nightly scan records itself in the existing **`agent_runs`** ledger — one run, one step per root — so it appears at `/admin/system/agents` with timing and errors and no bespoke scan-run table. `drive_documents` is deliberately its own table rather than folded into `supporting_documents`: that table means records about specific purchased things, Drive material is high-level, and a schema boundary beats a `tier` column every future query has to remember to filter.',
    apiChanges: [
      "GET /api/admin/drive/roots — every configured root with its use-case key, active flag and last-scanned timestamp.",
      "POST /api/admin/drive/roots — register a new root against a use case.",
      "POST /api/admin/drive/ingest — { rootId? }. Omitted ingests every active root (200); a malformed rootId is 400; a well-shaped id matching no row is 404.",
      "GET /api/admin/drive/documents?rootId=&folderId= — catalogue rows with the folder name resolved by JOIN, never stored.",
      "GET /api/admin/drive-auth-probe — delegation retest: mints a token AND does a real Drive read, distinguishing a rejected mint from a failed call.",
      "New cron 0 11 * * * — the nightly scan. No existing cron expression was changed.",
    ],
    filesTouched: [
      "src/backend/services/google/drive.ts (+ drive.test.ts) — Drive v3 client, recursive walk, sharing derivation, content hashing",
      "src/backend/services/google/drive-diff.ts (+ drive-diff.test.ts) — the pure change classifier",
      "src/backend/services/google/drive-ingest.ts — the ingestion service",
      "src/backend/db/schema/google-drive/ (6 tables) + schema/index.ts; drizzle/0174_nifty_miek.sql",
      "src/backend/api/routes/admin-drive-ingest.ts, admin-drive-auth-probe.ts, api/index.ts",
      "src/backend/services/gmail/auth.ts (drive.readonly scope), src/_worker.ts (cron branch), wrangler.jsonc (one line)",
      "scripts/qc/pr_374.mjs",
    ],
    migrations: [
      {
        tag: "0174_nifty_miek",
        sql: "CREATE TABLE drive_use_cases ( id INTEGER PRIMARY KEY AUTOINCREMENT, key text NOT NULL UNIQUE, name text NOT NULL, description text, is_active integer DEFAULT true NOT NULL, created_at integer DEFAULT (unixepoch()) NOT NULL );\nCREATE TABLE drive_roots ( id INTEGER PRIMARY KEY AUTOINCREMENT, drive_folder_id text NOT NULL UNIQUE, label text NOT NULL, use_case_id integer NOT NULL REFERENCES drive_use_cases(id), is_active integer DEFAULT true NOT NULL, last_scanned_at integer, created_at integer DEFAULT (unixepoch()) NOT NULL, updated_at integer DEFAULT (unixepoch()) NOT NULL );\nCREATE TABLE drive_root_exclusions ( id INTEGER PRIMARY KEY AUTOINCREMENT, root_id integer NOT NULL REFERENCES drive_roots(id) ON DELETE cascade, kind text NOT NULL, value text NOT NULL, reason text, created_at integer DEFAULT (unixepoch()) NOT NULL );\nCREATE TABLE drive_folders ( id INTEGER PRIMARY KEY AUTOINCREMENT, drive_id text NOT NULL, root_id integer NOT NULL REFERENCES drive_roots(id) ON DELETE cascade, parent_folder_id integer REFERENCES drive_folders(id) ON DELETE set null, name text NOT NULL, web_view_url text NOT NULL, sharing text DEFAULT 'PRIVATE' NOT NULL, is_active integer DEFAULT true NOT NULL, is_deleted integer DEFAULT false NOT NULL, superseded_by_id integer REFERENCES drive_folders(id) ON DELETE set null, drive_modified_at integer, created_at integer DEFAULT (unixepoch()) NOT NULL, updated_at integer DEFAULT (unixepoch()) NOT NULL );\nCREATE TABLE drive_documents ( id INTEGER PRIMARY KEY AUTOINCREMENT, drive_id text NOT NULL, root_id integer NOT NULL REFERENCES drive_roots(id) ON DELETE cascade, folder_id integer NOT NULL REFERENCES drive_folders(id) ON DELETE cascade, name text NOT NULL, mime_type text NOT NULL, size_bytes integer, content_hash text NOT NULL, hash_source text NOT NULL, web_view_url text NOT NULL, sharing text DEFAULT 'PRIVATE' NOT NULL, drive_modified_at integer, drive_created_at integer, extracted_text text, extraction_status text DEFAULT 'pending' NOT NULL, extraction_error text, rag_uuid text, is_active integer DEFAULT true NOT NULL, is_deleted integer DEFAULT false NOT NULL, superseded_by_id integer REFERENCES drive_documents(id) ON DELETE set null, revision_number integer DEFAULT 1 NOT NULL, created_at integer DEFAULT (unixepoch()) NOT NULL, updated_at integer DEFAULT (unixepoch()) NOT NULL );\nCREATE TABLE drive_document_links ( id INTEGER PRIMARY KEY AUTOINCREMENT, drive_document_id integer NOT NULL REFERENCES drive_documents(id) ON DELETE cascade, supporting_document_id text NOT NULL REFERENCES supporting_documents(id) ON DELETE cascade, created_at integer DEFAULT (unixepoch()) NOT NULL );",
      },
    ],
    code: [
      {
        title: "The trap in Drive's permissions — an omitted key is not a missing value",
        lang: "ts",
        code: `/**
 * Drive v3 has no single "access level" field \u2014 it returns the permission list
 * and leaves the interpretation to the caller. \`anyone\` outranks \`domain\`
 * because it is strictly more open, and a MISSING \`allowFileDiscovery\` means
 * false (Drive omits false), so it must not be read as discoverable.
 */
export function deriveSharing(permissions: DrivePermission[] | undefined): DriveSharing {
  if (!permissions?.length) return "PRIVATE";
  const anyone = permissions.find((p) => p.type === "anyone");
  if (anyone) return anyone.allowFileDiscovery === true ? "ANYONE" : "ANYONE_WITH_LINK";
  const domain = permissions.find((p) => p.type === "domain");
  if (domain) return domain.allowFileDiscovery === true ? "DOMAIN" : "DOMAIN_WITH_LINK";
  return "PRIVATE";
}`,
      },
      {
        title: "Google-native files have no checksum — hash their exported text instead",
        lang: "ts",
        code: `/**
 * Binary files carry Drive's own md5. Google-native files (Docs/Sheets/Slides)
 * carry NO md5Checksum at all, so they are hashed over their exported text \u2014
 * which is also what makes a pure-formatting edit a no-op.
 */
export async function contentHashFor(env: Env, node: DriveNode) {
  if (node.md5Checksum) return { hash: node.md5Checksum, source: "drive_md5" };
  const text = await exportFileText(env, node.driveId, node.mimeType).catch(() => null);
  if (text != null) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { hash: hex, source: "exported_text" };
  }
  return { hash: \`\${node.name}:\${node.modifiedAt?.toISOString() ?? "?"}\`, source: "metadata" };
}`,
      },
    ],
    diagrams: [
      {
        caption: "What a nightly scan does to each node",
        title: "Create, supersede, delete — the three writes",
        description:
          "Identity is the Drive file id, never the content hash. A rename or move retires the old row and links it forward, so the history of a file surviving three renames is still walkable. Nothing is hard-deleted.",
        code: `flowchart TD
    A[Walk root recursively] --> B{Excluded?}
    B -- yes --> Z[Never traversed]
    B -- no --> C[Collect node]
    C --> D{driveId in D1?}
    D -- no --> E[create: new row]
    D -- yes --> F{name, parent or hash changed?}
    F -- no --> G[unchanged]
    F -- yes --> H[supersede: old row isActive=false<br/>new row inserted<br/>supersededById links them]
    I[Row in D1, absent from Drive] --> J[delete: isDeleted=true<br/>row is kept]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_374.mjs",
      command: "node scripts/qc/pr_374.mjs --preview   (and without --preview for production)",
      ranAt: "2026-08-08",
      source: `// The load-bearing assertion, now with the duplicate-row invariant the
// final review round added: a delete-marked row used to be invisible to the
// next diff, so anything that came back was re-CREATED as a SECOND active row
// for one Drive id — silently, because the drive_id indexes are non-unique.
const second = await client.post("/api/admin/drive/ingest", { rootId });
const s2 = second.json?.summaries?.[0];
checks.ok(
  "second scan is a no-op (idempotent) — the load-bearing assertion",
  s2?.created === 0 && s2?.superseded === 0 && s2?.deleted === 0 && s2?.undeleted === 0,
  \`created \${s2?.created}, superseded \${s2?.superseded}, deleted \${s2?.deleted}\`,
);
const driveIds = list.map((d) => d.driveId);
const dupes = driveIds.filter((id, i) => driveIds.indexOf(id) !== i);
checks.ok(
  "every live document row has a distinct Drive id (no duplicate active rows)",
  driveIds.length > 0 && driveIds.every(Boolean) && dupes.length === 0,
  \`rows \${driveIds.length}, duplicated ids: \${[...new Set(dupes)].join(", ") || "none"}\`,
);

// And the scan lease, fired concurrently: exactly one of the two may take it.
const [a, b] = await Promise.all([
  client.post("/api/admin/drive/ingest", { rootId }),
  client.post("/api/admin/drive/ingest", { rootId }),
]);`,
      output: `$ node scripts/qc/pr_374.mjs --preview

  \u2713 target reachable (https://wcrp-feat-drive-ingestion-service.hacolby.workers.dev)
  \u2713 GET /api/admin/drive/roots returns 200 (the surface is expected to exist on this target)
  \u2713 both roots are seeded
  \u2713 onboarding root maps to EMAIL_ONBOARDING_MATERIALS
  \u2713 research root maps to DEEP_RESEARCH_FINDINGS
  \u2713 POST /ingest with a wrong-typed rootId returns 400 (Zod), not a 500
  \u2713 POST /ingest with a well-shaped but nonexistent rootId returns 404
  \u2713 POST /ingest with an empty body ingests ALL active roots
  \u2713 scan by real rootId ingests the onboarding folder: 72 nodes (61 docs + 11 folders)
  \u2713 second scan is a no-op (idempotent) \u2014 the load-bearing assertion
  \u2713 re-ingest does not grow the catalogue (no duplicate rows from a second scan)
  \u2713 every live document row has a distinct Drive id (no duplicate active rows)
  \u2713 documents are listed with a joined folder name, count == 61
  \u2713 the 1971 Blueprints PDF is catalogued with a non-zero size
  \u2713 the Floor Plans with Measurements PDF is catalogued with a non-zero size
  \u2713 sharing is recorded on every document from the allowed vocabulary
  \u2713 GET /documents?folderId= returns only that folder's rows, and fewer than the unfiltered total
  \u2713 GET /documents rejects a non-numeric folderId with 400
  \u2713 POST /roots rejects a driveFolderId with an illegal charset (400, no row created)
  \u2713 two concurrent scans of one root: one 200, one 409 (the scan lease holds)
  \u2713 the lease is released when a scan finishes (the next scan runs, not 409)

21 passed, 0 failed


$ node scripts/qc/pr_374.mjs      # production regression guard, pre-merge

  \u2713 target reachable (https://core-remodel.hacolby.workers.dev)
    new routes 404 on production \u2014 pending merge/deploy, reported rather than failed
    (the gate matches 404 specifically; any other non-200 fails loudly)

1 passed, 0 failed`,
      migrations: [
        {
          tag: "0174_nifty_miek",
          appliedRemote: true,
          note: "Applied via pnpm run migrate:remote and verified: all six drive_* tables present on the remote DB, and the pre-existing drive_list* tables (driving routes, an unrelated feature) untouched.",
        },
        {
          tag: "0175_curved_anthem",
          appliedRemote: true,
          note: "Applied and verified. Adds drive_roots.scan_started_at (the scan lease), an index on superseded_by_id for both tables, and a partial UNIQUE (root_id, drive_id) WHERE is_active = 1 on drive_folders and drive_documents. The unique index was preflighted against production first — zero duplicate active rows existed (26 folders / 137 documents), so no cleanup was needed before applying it.",
        },
        {
          tag: "0175_curved_anthem",
          appliedRemote: true,
          note: "Review fixes: drive_roots.scan_started_at, a partial UNIQUE index on (root_id, drive_id) WHERE is_active = 1, and a superseded_by_id index — the last two on BOTH drive_folders and drive_documents. Production was checked for duplicate active rows FIRST, because the unique index cannot apply over one: there were none (26 folder rows, 137 document rows, 0 duplicated active drive_ids), so the migration needed no cleanup step. Applied via pnpm run migrate:remote; all four indexes confirmed present in sqlite_master on the remote DB.",
        },
      ],
    },
  },
  "mcp-oauth-one-year-ttls": {
    slug: "mcp-oauth-one-year-ttls",
    branch: "fix/mcp-oauth-one-year-ttls",
    prNumber: 372,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/372",
    subtitle: "0015 · a relative registration_client_uri, plus lifetimes at 1h/30d/90d → 365d",
    introduction:
      "The claude.ai MCP connector kept going offline, could not be brought back by re-authorizing, and then could not be re-added either. Two separate defects, found in that order — one about how long credentials live, one about a single malformed field in the registration response. Both are fixed here.",
    problem:
      '## Defect 2 (found second, blocks everything): dynamic client registration\n\nRe-adding the connector failed outright:\n\n> Couldn\'t register with core-remodel\'s sign-in service. You can try again, or add an OAuth Client ID in the connector settings.\n\nThat message is claude.ai saying **dynamic client registration failed**, so it is offering the fallback of a manually pre-registered client id. It never reaches a login screen.\n\nWhat makes this one nasty is that the server is not failing. `POST /oauth/register` returns **201**, writes `client:<id>` into `OAUTH_KV`, and a `curl` probe of it looks perfectly healthy — which is exactly why it survived every server-side check. The failure is in the client\'s *parse* of a valid-looking response.\n\n`workers-oauth-provider@0.8.1` builds one field by concatenating the configured option verbatim:\n\n```ts\nregistration_client_uri: `${this.options.clientRegistrationEndpoint}/${clientId}`\n```\n\nWe pass that option as the **path** `/oauth/register`, so the provider serves the endpoint correctly at any hostname (production, and every branch preview). But it means the field ships as:\n\n```json\n"registration_client_uri": "/oauth/register/JE9ecrEFq84lZUgV"\n```\n\nRFC 7591 §3.2.1 requires a fully qualified URL there. A client that does `new URL(registration_client_uri)` throws, and registration is abandoned.\n\nConfirmed by differential against a connector on the same account that *does* connect — `codra` omits the field entirely; core-remodel was the only one emitting a relative value.\n\n## Defect 1 (found first): every lifetime on a library default\n\nBefore that, the connector would simply report itself as needing authorization, and re-authorizing did not reliably fix it.\n\nThe `OAuthProvider` in `src/_worker.ts` passed no TTL options, so every default from `@cloudflare/workers-oauth-provider@0.8.1` applied:\n\n| Option | Default in use | Consequence |\n| --- | --- | --- |\n| `accessTokenTTL` | 3600s (1 hour) | the access token dies hourly; the client must refresh to keep working |\n| `refreshTokenTTL` | 30 days | the grant dies after 30 days without a refresh |\n| `clientRegistrationTTL` | 90 days | **the `client:<id>` record is deleted from `OAUTH_KV`** |\n\nThe third one is the connector-killer, and it is not obvious from the symptom. It does not expire a token — it deletes the client registration itself. A connector still holding that `client_id` then gets `invalid_client` on refresh *and* on a fresh authorization attempt, because the client it is identifying as no longer exists. Re-authorizing cannot help; only deleting and re-adding the connector can, because that triggers a new dynamic client registration.\n\n`OAUTH_KV` carried the fingerprint of exactly this loop — 77 `client:` records and 70 `grant:` records for a single operator, the debris of repeated reconnects. The same namespace also holds grants from another worker that runs year-long lifetimes, and those stay connected:\n\n```\n364.58d  grant:mcp-user-a706e218-…    ← other worker, still connected\n 27.5d   grant:justin:…               ← core-remodel, 30d default\n```\n\nBefore changing anything, the whole flow was driven against production to establish that the server was healthy and this really was only about lifetimes — register → authorize → approve → code exchange → MCP `initialize` → refresh → MCP `initialize`, every step 200.',
    approach:
      "## The registration fix\n\n`withAbsoluteRegistrationUri` (`src/backend/mcp/absolute-registration-uri.ts`) wraps the worker's `fetch`. On a successful `POST /oauth/register` it resolves `registration_client_uri` against **the origin the request actually arrived on**, and leaves an already-absolute value untouched.\n\nThe obvious alternative — passing absolute URLs as the provider's endpoint options — was rejected: it would bake the production origin into the config, so every branch preview would advertise the production host and its own OAuth would break. Deriving per request is host-agnostic, and the no-op-when-absolute guard means the wrapper simply stops doing anything if the library is fixed upstream.\n\n## The lifetime fix\n\nThree options on the existing `OAuthProvider`, plus a shared `ONE_YEAR_SECONDS` constant. No behavioural code changed and no schema moved — that part of the diff is 12 lines.\n\nWhy a year for all three rather than only the client registration:\n\n- **`clientRegistrationTTL: 365d`** is the actual fix for the unrepairable state described above.\n- **`refreshTokenTTL: 365d`** stops a connector that sits unused for a month from silently losing its grant. The TTL is rolled forward on every refresh, so in practice this only matters for idle periods — which is exactly when the failure was landing.\n- **`accessTokenTTL: 365d`** removes the hourly refresh entirely. Refresh works correctly (the QC run proves rotation still issues a new pair), but every refresh is one more chance for a client to end up wedged, and this connector has no reason to churn tokens hourly.\n\nThe security trade is deliberate and worth stating plainly: a year-long bearer token with the full `remodel` scope is a long-lived credential. This is a single-operator connector whose consent screen is gated on `WORKER_API_KEY`, and revocation is still available two ways — delete the `grant:` record from `OAUTH_KV`, or use the revocation endpoint the provider already serves at `/oauth/token`. For a multi-user surface these numbers would be wrong.\n\n**One thing this does not do:** it cannot resurrect a connector that is already broken. An existing claude.ai connector whose `client:` record was already reaped still has to be removed and re-added once after this deploys; from then on the registration lives a year.\n\nOne thing worth following up separately — `OAUTH_KV` (namespace `859ea6b9…`) appears to be shared with at least one other worker, judging by the `mcp-user-*` grants sitting alongside the `justin` ones. Two OAuth issuers sharing one token store is not something this PR touches, but it deserves its own look.",
    apiChanges: [
      "No route added, removed or renamed.",
      "`POST /oauth/register` — `registration_client_uri` is now an absolute URL resolved against the request origin (was the relative `/oauth/register/<id>`). The issued `client:<id>` record in OAUTH_KV also carries a 365-day expiration instead of 90 days.",
      "`POST /oauth/token` — returns `expires_in: 31536000` instead of `3600`, for both the authorization_code and refresh_token grants.",
      "`/mcp` and `/mcp/sse` transports, `/oauth/authorize`, and the `.well-known` metadata documents are unchanged.",
    ],
    filesTouched: [
      "src/backend/mcp/absolute-registration-uri.ts (new) — withAbsoluteRegistrationUri fetch wrapper",
      "src/_worker.ts — wraps fetch with it; ONE_YEAR_SECONDS + accessTokenTTL / refreshTokenTTL / clientRegistrationTTL on the OAuthProvider",
      "scripts/qc/pr_372.mjs (new) — end-to-end OAuth + MCP transport harness",
      "src/frontend/data/changelog.ts, src/frontend/data/changelog-detail.ts",
    ],
    migrations: [],
    code: [
      {
        title: "src/_worker.ts — the whole change",
        lang: "ts",
        code: `/** Every MCP OAuth lifetime (access, refresh, client registration). */
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

const oauthProvider = new OAuthProvider({
  apiHandlers: { /* …unchanged… */ },
  defaultHandler: legacyHandler,
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["remodel"],
  // Single-operator connector: every lifetime is one year. The library
  // defaults (1h access / 30d refresh / 90d client registration) forced a
  // reconnect roughly hourly-to-quarterly and left 77 dead \`client:\` records
  // in OAUTH_KV. The 90d clientRegistrationTTL was the worst of them — it
  // deletes the client_id itself, so a stale claude.ai connector cannot even
  // refresh its way back and has to be removed and re-added by hand.
  accessTokenTTL: ONE_YEAR_SECONDS,
  refreshTokenTTL: ONE_YEAR_SECONDS,
  clientRegistrationTTL: ONE_YEAR_SECONDS,
});`,
      },
      {
        title: "src/backend/mcp/absolute-registration-uri.ts — the DCR fix",
        lang: "ts",
        code: `const response = await fetchHandler(request, env, ctx);
if (!isRegistration || !response.ok) return response;

// …JSON guard elided…
const current = body.registration_client_uri;
if (typeof current !== "string" || isAbsolute(current)) return response;

body.registration_client_uri = new URL(current, url.origin).toString();

// Preserve the provider's status (201) and headers (it sets no-cache).
return new Response(JSON.stringify(body), {
  status: response.status,
  statusText: response.statusText,
  headers: response.headers,
});`,
      },
      {
        title: "Before / after — the field claude.ai threw on",
        lang: "json",
        code: `// production today
{
  "client_id": "JE9ecrEFq84lZUgV",
  "registration_client_uri": "/oauth/register/JE9ecrEFq84lZUgV",   // ← relative, RFC 7591 §3.2.1 violation
  "client_id_issued_at": 1786150000
}

// branch preview, after the fix
{
  "client_id": "WY-NBd4ZBJy7XeZY",
  "registration_client_uri": "https://wcrp-fix-mcp-oauth-one-year-ttls.hacolby.workers.dev/oauth/register/WY-NBd4ZBJy7XeZY",
  "client_id_issued_at": 1786150300
}

// codra — a connector on this account that DOES connect — omits the field entirely
{
  "client_id": "mcp_d14467e28243452d9896256283388d84",
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code"]
}`,
      },
      {
        title: "The KV evidence — one operator, 77 client registrations",
        lang: "bash",
        code: `npx wrangler kv key list --namespace-id 859ea6b96deb4140831a1d09a70ffcd4 --remote

# grouped by prefix, expirations relative to now:
#   client  77   soonest +56.4d  latest +87.6d     (90d default, constantly re-minted)
#   grant   70   soonest  +0.1d  latest +364.6d    (30d default … except another worker's)
#   token    4

# after the change, on the branch preview:
#   client:bpX-Yzh6YpgABvmG   365.0d`,
      },
    ],
    diagrams: [
      {
        caption: "Why a reaped client registration cannot be repaired by re-authorizing",
        title: "The 90-day clientRegistrationTTL failure",
        description:
          "The connector stores its `client_id` once, at first connect. When the registration record behind that id is deleted, every subsequent path — refresh and fresh authorization alike — identifies as a client the server no longer knows. Only deleting and re-adding the connector escapes it, because only that performs a new dynamic client registration.",
        code: `sequenceDiagram
    participant C as claude.ai connector
    participant P as OAuthProvider
    participant K as OAUTH_KV

    Note over C,K: day 0 — first connect
    C->>P: POST /oauth/register
    P->>K: PUT client:abc (expirationTtl 90d)
    P-->>C: client_id=abc
    C->>P: authorize + token
    P-->>C: access (1h) + refresh (30d)

    Note over K: day 90 — KV evicts client:abc

    Note over C,K: day 91 — connector still holds client_id=abc
    C->>P: POST /oauth/token (refresh, client_id=abc)
    P->>K: GET client:abc
    K-->>P: (gone)
    P-->>C: invalid_client
    C->>P: retry: GET /oauth/authorize?client_id=abc
    P->>K: GET client:abc
    K-->>P: (gone)
    P-->>C: invalid_client — re-auth cannot help
    Note over C: only delete + re-add the connector recovers`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_372.mjs",
      command: "node scripts/qc/pr_372.mjs --preview   (and without --preview for production)",
      ranAt: "2026-08-08",
      source: `// \`expires_in\` doubles as the "is this PR deployed here?" signal, so both new
// behaviours are gated on it. On a target that has not shipped #372 yet they
// are reported as pending rather than failed — otherwise the production run,
// whose job is to prove nothing ALREADY LIVE regressed, could never be green
// while the PR is open.
const prDeployed = expiresIn !== LIBRARY_DEFAULT_ACCESS_TOKEN_TTL;
if (!prDeployed) {
  checks.info("pending merge/deploy — this target still runs the library defaults …");
  checks.info(
    \`would fail here today: registration_client_uri = \${JSON.stringify(regClientUri)} \` +
      \`(\${regUriAbsolute ? "absolute" : "RELATIVE — the DCR bug claude.ai chokes on"})\`,
  );
} else {
  checks.ok("access token lifetime is one year", expiresIn === ONE_YEAR_SECONDS, …);
  checks.ok(
    "registration_client_uri is an absolute URL (RFC 7591 §3.2.1)",
    regUriAbsolute,
    \`registration_client_uri = \${JSON.stringify(regClientUri)}\`,
  );
}`,
      output: `$ node scripts/qc/pr_372.mjs --preview

PR #372 QC — MCP OAuth one-year lifetimes
  target: https://wcrp-fix-mcp-oauth-one-year-ttls.hacolby.workers.dev

  ✓ target reachable (https://wcrp-fix-mcp-oauth-one-year-ttls.hacolby.workers.dev)
  ✓ authorization-server metadata advertises refresh_token
  ✓ /mcp rejects an unauthenticated call with 401
  ✓ DCR issues a client_id
    client_id krFMMPv6nm6bpSv3
    registration_client_uri https://wcrp-fix-mcp-oauth-one-year-ttls.hacolby.workers.dev/oauth/register/krFMMPv6nm6bpSv3
  ✓ consent screen accepts the access password
  ✓ approve redirects back to the client with an authorization code
  ✓ authorization_code exchange returns an access + refresh token
    expires_in = 31536000s (365.0 days)
  ✓ access token lifetime is one year
  ✓ registration_client_uri is an absolute URL (RFC 7591 §3.2.1)
  ✓ MCP initialize succeeds with the access token
  ✓ refresh_token grant issues a rotated pair
  ✓ MCP initialize succeeds with the refreshed access token

12 passed, 0 failed


$ node scripts/qc/pr_372.mjs      # production regression guard, pre-merge

PR #372 QC — MCP OAuth one-year lifetimes
  target: https://core-remodel.hacolby.workers.dev

  ✓ target reachable (https://core-remodel.hacolby.workers.dev)
  ✓ authorization-server metadata advertises refresh_token
  ✓ /mcp rejects an unauthenticated call with 401
  ✓ DCR issues a client_id
    client_id QKmrxcWdu8kcKgvp
    registration_client_uri /oauth/register/QKmrxcWdu8kcKgvp
  ✓ consent screen accepts the access password
  ✓ approve redirects back to the client with an authorization code
  ✓ authorization_code exchange returns an access + refresh token
    expires_in = 3600s (0.0 days)
    pending merge/deploy — this target still runs the library defaults, which is exactly what PR #372 replaces. Expected on production pre-merge. Both the one-year lifetime and the absolute registration_client_uri are reported below as pending rather than asserted.
    would fail here today: registration_client_uri = "/oauth/register/QKmrxcWdu8kcKgvp" (RELATIVE — the DCR bug claude.ai chokes on)
  ✓ MCP initialize succeeds with the access token
  ✓ refresh_token grant issues a rotated pair
  ✓ MCP initialize succeeds with the refreshed access token

10 passed, 0 failed


$ # KV confirmation of the other two lifetimes on the preview:
client:bpX-Yzh6YpgABvmG 365.0d
justin grants with >300d TTL: 1`,
      migrations: [],
    },
  },
  "multi-room-render": {
    slug: "multi-room-render",
    branch: "claude/multi-room-render",
    subtitle:
      "Render one design brief across every angle of every room, durably, with MCP code-mode tools",
    introduction:
      "For remodelers, a design is not one room — it is a whole floor. This change lets an agent or user create a render campaign that applies one brief across multiple rooms and angles, tracks progress, and exposes the operation through the canonical OAuth MCP registry so it is callable from Code Mode.",
    problem:
      "The render pipeline was room-scoped. `/api/render/looks` could only render the angles of a single room in one request, and there was no durable, trackable way to render a whole-house design consistently. The local kitchen proofs showed the desired behavior but were not wired into the deployed Worker, and the new OAuth MCP server had no render tools at all.",
    approach:
      "Add a `render_campaigns` abstraction. A campaign enrolls (room, listing-photo) angles, creates one render session per room, and triggers a Cloudflare Workflow. The Workflow renders the hero angle first, then passes the hero canvas as a ReferenceImage to every remaining angle so the model keeps materials and layout consistent across rooms. Each angle is its own Workflow step, so the campaign survives isolate churn and redeploys. The canonical MCP registry gains create/list/get/cancel/run_room_looks tools, and an admin UI lists campaigns with realtime per-angle progress.",
    apiChanges: [
      "POST /api/render/campaigns — create a campaign and start the Workflow",
      "GET /api/render/campaigns — list campaigns",
      "GET /api/render/campaigns/:id — full detail with enriched canvas delivery URLs",
      "POST /api/render/campaigns/:id/cancel — skip pending angles and pause",
      "MCP create_render_campaign, list_render_campaigns, get_render_campaign, cancel_render_campaign, run_room_looks (canonical OAuth registry)",
    ],
    filesTouched: [
      "src/backend/db/schema/images/render_campaigns.ts, render_campaign_angles.ts, render_campaign_sessions.ts",
      "src/backend/services/render/campaign.ts, render-campaign-workflow.ts",
      "src/backend/api/routes/render.ts",
      "src/backend/mcp/tools/render/*.ts",
      "src/backend/mcp/tools/index.ts",
      "src/frontend/pages/admin/render/campaigns.astro, campaigns/[id].astro",
      "src/frontend/components/render/CampaignListApp.tsx, CampaignDetailApp.tsx",
      "scripts/qc/pr_0048.mjs",
      "wrangler.jsonc, src/_worker.ts, worker-configuration.d.ts",
    ],
    migrations: [
      {
        tag: "0173_wet_nicolaos",
        sql: "CREATE render_campaigns, render_campaign_angles, render_campaign_sessions",
      },
    ],
    code: [
      {
        title: "Hero-first sequential rendering with reference propagation",
        lang: "ts",
        code: `const hero = angles[0];
const heroResult = await step.do(\`render-hero:\${hero.listingPhotoId}\`, async () => {
  return runStage({ env: this.env, sessionId: hero.sessionId, type: "stage_3_LP_finish", inputImageUrl: hero.url, prompt: campaign.prompt });
});

for (const angle of angles.slice(1)) {
  await step.do(\`render-angle:\${angle.listingPhotoId}\`, async () => {
    return runStage({
      env: this.env, sessionId: angle.sessionId, type: "stage_3_LP_finish",
      inputImageUrl: angle.url,
      prompt: campaign.prompt,
      references: heroDeliveryUrl ? [{ url: heroDeliveryUrl, label: "match the hero design exactly" }] : undefined,
    });
  });
}`,
      },
    ],
    diagrams: [
      {
        caption:
          "Campaign orchestration: hero first, then every other angle with the hero as reference.",
        title: "Render campaign flow",
        code: `sequenceDiagram
    participant API as POST /api/render/campaigns
    participant DB as D1
    participant WF as RenderCampaignWorkflow
    participant RS as runStage

    API->>DB: insert campaign + angles + sessions
    API->>WF: create({ campaignId })
    WF->>DB: load angles
    WF->>RS: render hero angle
    RS-->>WF: hero canvas + deliveryUrl
    loop each remaining angle
        WF->>RS: render angle with hero reference
        RS-->>WF: canvas
    end
    WF->>DB: finalize campaign status`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_0048.mjs",
      command: "node scripts/qc/pr_0048.mjs --preview",
      source:
        "// Verifies /api/mcp-docs lists the five new render tools, GET /api/render/campaigns returns 200, unknown campaign returns 404, and invalid angles return 400.",
      output:
        "Preview (wcrp-claude-multi-room-render): 11 passed, 0 failed — mcp-docs 200; all 5 render tools registered; GET /api/render/campaigns 200; unknown campaign 404; invalid angles 400 with error. Production regression: 1 passed, 0 failed — mcp-docs 200; new tools + routes reported pending (not on prod pre-merge). Migration 0173 applied + verified on remote D1 (render_campaigns, render_campaign_angles, render_campaign_sessions present).",
    },
  },
  "showroom-branch-collapse": {
    slug: "showroom-branch-collapse",
    branch: "claude/0047-p1-schema",
    prNumber: 363,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/363",
    subtitle:
      "Detect real chain branches, then let a human fold them into one business with many locations",
    introduction:
      "The Tier-2 counterpart to the 0046 dedup: where dedup MERGES same-site duplicate stubs, this COLLAPSES real branches of one business into a single store with many locations — proposing every collapse for human confirmation, never auto-merging.",
    problem:
      "After 0045 gave a business many locations and 0046 learned to tell a duplicate STUB from a real BRANCH, 12 branch groups (~30 store rows) sat re-detected every scan with no way to act on one. `dedup_showroom_stores` deliberately refuses to touch them because it DISCARDS the loser's address — right for a stub, catastrophic for a real branch whose address must be carried across.",
    approach:
      "A staging + confirm + collapse path. `scan_showroom_merge_candidates` stages each branch group as a reviewable row (STRONG-signal-gated — website/name/place_id — so co-located different businesses like Walker Zanger / New Century are NOT staged). `resolve_merge_candidate` records the human decision (approve / reject / set_keeper / exclude_member), persisting exclusion pairs so the scan never re-proposes them. `apply_merge_candidate` collapses an APPROVED candidate. Collapse is idempotent and resumable via a per-member `collapse_state` machine, and each branch's location row is REPOINTED to the keeper (it already holds the address) rather than recreated — so a mid-collapse crash never loses an address; the branch store is soft-deleted only at the final step. The child-remap that both dedup and collapse need was extracted into one shared module, so neither re-lists the ~25 FK tables.",
    apiChanges: [
      "mcp scan_showroom_merge_candidates (WRITE_IDEMPOTENT) — stage / refresh / STALE branch candidates",
      "mcp list_merge_candidates / get_merge_candidate (READ_ONLY) — the review queue + full evidence",
      "mcp resolve_merge_candidate (WRITE) — approve / reject / set_keeper / exclude_member",
      "mcp apply_merge_candidate (DESTRUCTIVE) — collapse an APPROVED candidate; refuses otherwise; STALEs on drift",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/merge_candidates.ts, merge_exclusions.ts, store_location.ts (unit column)",
      "src/backend/services/showroom/branch-detection.ts, branch-collapse.ts, store-child-remap.ts (new)",
      "src/backend/mcp/tools/showrooms/{scan,list,get,resolve,apply}_merge_candidate(s).ts (new)",
      "src/backend/mcp/tools/showrooms/dedup_showroom_stores.ts (refactored to share the remap)",
      "scripts/qc/pr_363.mjs, scripts/qc/pr_364.mjs (new)",
    ],
    migrations: [
      {
        tag: "0171_tense_mac_gargan",
        sql: "CREATE showroom_merge_candidates + _members + _exclusions; ALTER showroom_store_locations ADD unit",
      },
    ],
    code: [
      {
        title: "The location is repointed, not recreated — so a crash never loses the address",
        lang: "ts",
        code: '// PENDING → repoint the branch\'s location rows onto the keeper (they hold the address).\nfor (const loc of branchLocs) {\n  // Skip a site the keeper already has (same place_id) — avoid the unique-index trip.\n  if (loc.placeId && keeperPlaceIds.has(loc.placeId)) continue;\n  await db.update(showroomStoreLocations)\n    .set({ storeId: keeper.storeId, updatedAt: new Date() })\n    .where(eq(showroomStoreLocations.id, loc.id)).run();\n  if (loc.placeId) keeperPlaceIds.add(loc.placeId);\n  movedLocationId ??= loc.id;\n}\nawait setMemberState(b.id, "LOCATION_CREATED", movedLocationId);',
      },
    ],
    diagrams: [
      {
        caption:
          "Two tiers: dedup merges stubs, collapse folds branches — sharing one child-remap.",
        title: "Tier 1 vs Tier 2",
        code: "flowchart TD\n  G[groupBySignals over active stores] --> S{2+ real sites?}\n  S -->|no| T1[TIER 1 dedup_showroom_stores<br/>merge stub, DISCARD address]\n  S -->|yes, STRONG signal| T2[TIER 2 scan_merge_candidates<br/>stage for human review]\n  T2 --> R[resolve: approve / exclude / reject]\n  R --> A[apply_merge_candidate]\n  A --> C[carry each branch site across as a LOCATION<br/>then soft-delete the branch store]\n  T1 -.shared.-> RM[remapStoreChildren]\n  C -.shared.-> RM\n  classDef ok fill:#1f4d2e,stroke:#4ade80\n  class T2,R,A,C ok",
      },
      {
        caption: "Per-member state machine — a crash resumes from the last committed state.",
        title: "Collapse state machine",
        code: "stateDiagram-v2\n  [*] --> PENDING\n  PENDING --> LOCATION_CREATED: repoint branch location to keeper\n  PENDING --> SKIPPED_NO_ADDRESS: no location\n  LOCATION_CREATED --> CHILDREN_REMAPPED: remapStoreChildren\n  CHILDREN_REMAPPED --> RETIRED: soft-delete branch store\n  RETIRED --> [*]\n  SKIPPED_NO_ADDRESS --> [*]",
      },
      {
        caption: "One store row is the business; each branch becomes a location on it.",
        title: "Data model",
        code: 'erDiagram\n    showroom_merge_candidates ||--o{ showroom_merge_candidate_members : candidate_id\n    showroom_merge_candidate_members }o--|| showroom_stores : store_id\n    showroom_merge_exclusions }o--|| showroom_stores : store_id_lo_hi\n    showroom_merge_candidate_members {\n        text role "KEEPER|BRANCH|EXCLUDED"\n        text collapse_state "PENDING..RETIRED"\n        int resulting_location_id\n    }\n    showroom_merge_exclusions {\n        int store_id_lo\n        int store_id_hi\n    }',
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_364.mjs",
      command:
        "node scripts/qc/pr_364.mjs --base https://core-remodel.hacolby.workers.dev --preview   # a real collapse on the LIVE prod worker",
      source:
        "// Creates two sentinel stores (ZZ_QC_COLLAPSE_*) sharing a website, stages the candidate,\n// approves, applies, then asserts the keeper gained the branch's location, the branch is\n// soft-deleted, there are no orphans, a second apply is a no-op, and a re-scan is clean.\n// A finally-block hard-deletes every sentinel row regardless of outcome.",
      output:
        "PRODUCTION (version 30655efa):\n  pr_364 collapse — a real collapse on the LIVE worker — 12 passed, 0 failed\n  pr_363 detection — 15 passed, 0 failed\n  pr_348 dedup regression (shared-remap refactor) — 18 passed, 0 failed\n  D1 residue: 0 ZZ_QC rows.\n\nHONEST NOTE: #365 (the destructive P3/P4 PR) was absorbed into the #363 squash by a\nstacked-branch mixup, and codra cancelled its in-flight review of #365 as a result — so the\ndestructive half shipped under #363's review rather than its own. The production pr_364 run\n(a real collapse against the live worker, with cleanup) is the definitive verification in its\nplace. Migration 0171 applied to remote and verified; #360's budget schema renumbered to 0172\nafter mine, no collision — its tables confirmed present on prod.",
      migrations: [
        {
          tag: "0171_tense_mac_gargan",
          appliedRemote: true,
          note: "3 tables + unit column verified on remote",
        },
      ],
    },
  },
  "budget-grid": {
    slug: "budget-grid",
    branch: "claude/budget-backend-frontend-09f91d",
    prNumber: 360,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/360",
    subtitle: "0035 P1–P2 · the time-phased budget grid, end to end",
    code: [],
    problem:
      "Phase 0 gave the schema (phases, monthly plan schedule, the actuals→line link). The grid itself — the phase→line-item, month-bucketed view with Estimate/Actuals/Variance — still had to be built, exposed to both HTTP and MCP without the two drifting, and rendered as a real island matching the design comp.",
    approach:
      "One shared aggregation: services/budget/grid.ts loadBudgetGrid() reads active budget lines, buckets plan[] from budget_plan_schedule and actual[] from expenses (linked by stable trackId, bucketed by dateIncurred month), computes variance/tone/flags/progress/scorecards, and derives the month window from the data (one-sided bounds extend to the data extreme, capped 12mo). GET /api/budget/grid and the get_budget_grid MCP tool BOTH call it — verified single-source in review. PATCH /api/budget/plan-schedule upserts a cell (trackId+period); POST /api/budget/grid/seed spreads real estimate midpoints and attributes expenses only on a confident single title match. The BudgetGridApp island computes the three views client-side from raw plan[]/actual[], edits plan inline via CurrencyInput, and logs line-linked expenses. A latent bug surfaced and was root-caused: the expenses POST dropped budget_item_track_id, so actuals never reached a line — fixed additively.",
    apiChanges: [
      "NEW GET /api/budget/grid?from=&to=&phase=&q= → { grid: { months, phases[{plan[],actual[],progressPct,tone,lines[{plan[],actual[],flag}]}], footer, scorecards } }.",
      "NEW PATCH /api/budget/plan-schedule {trackId,period,plannedCents,plannedText}; NEW POST /api/budget/grid/seed.",
      "NEW MCP tool get_budget_grid (READ_ONLY, shared service).",
      "FIXED POST /api/budget-tracker/expenses persists budgetItemTrackId.",
    ],
    filesTouched: [
      "src/backend/services/budget/grid.ts (new — shared aggregation)",
      "src/backend/api/routes/budget-grid.ts, budget-grid-math.ts (new)",
      "src/backend/api/routes/budget-tracker.ts (expenses POST: persist budgetItemTrackId)",
      "src/backend/api/index.ts (mount /api/budget)",
      "src/backend/mcp/tools/budget/get_budget_grid.ts (new) + index.ts",
      "src/frontend/components/BudgetGridApp.tsx, budget-grid-view.ts (new)",
      "src/frontend/pages/admin/budget/grid.astro (new)",
      "scripts/qc/pr_360.mjs, scripts/tests/test_budget_grid_{math,service,view}.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "One aggregation, three surfaces — route and MCP never diverge",
        code: `flowchart TD
  SVC["services/budget/grid.ts · loadBudgetGrid()"]
  R["GET /api/budget/grid"] --> SVC
  M["MCP get_budget_grid"] --> SVC
  SVC --> DATA["plan from budget_plan_schedule[month]\\nactual from expenses WHERE budget_item_track_id\\nbucketed by dateIncurred[month]"]
  UI["/admin/budget/grid · BudgetGridApp"] --> R
  UI --> EDIT["PATCH /api/budget/plan-schedule (inline)"]
  UI --> LOG["POST /api/budget-tracker/expenses (line-linked)"]
  classDef n fill:#1f4d2e,stroke:#4ade80,color:#eaffea;
  class SVC,DATA n;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_360.mjs",
      command:
        "node scripts/qc/pr_360.mjs --base <preview> --preview  (28/28)  &&  node scripts/qc/pr_360.mjs  (prod regression)",
      ranAt: "2026-08-05",
      output:
        "QC 28/28 on preview: grid shape (months/phases/footer/scorecards), scorecard identity remaining=totalBudget-spent, per-phase plan[]/actual[] length == months, seed idempotent (2nd run 0 new), plan-schedule PATCH 404 on unknown + 200 non-polluting round-trip, MCP get_budget_grid registered, config regression. Prod: regression green, new endpoints correctly pending merge/deploy. Browser-verified on preview: grid renders 32 real line items, Estimate↔Variance client recompute, Remaining shows signed −$5,105 with 'No funding set' when no funding accounts exist, window May–Jul 2026. Three self-checks (math/service/view) pass; build green; tsc no new errors in touched files.",
      migrations: [],
    },
  },
  "budget-grid-foundations": {
    slug: "budget-grid-foundations",
    branch: "claude/budget-backend-frontend-09f91d",
    prNumber: 360,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/360",
    subtitle: "0035 P0 · time-phasing schema for the budget grid",
    code: [],
    problem:
      "The RemodelBudgetGrid design is a phase → line-item grid with monthly columns and three views — Estimate, Actuals, Variance. The live budget model could back none of it. There was no phase concept on a budget line, so nothing to group rows under. There was no monthly plan anywhere, so the Estimate axis had no source. And critically, actual expenses attached to a budget line only by a free-text `category` — never to the line itself — so 'what did we actually spend on THIS item, in THIS month' was unanswerable, which is the whole Actuals column. The revision-chaining of budget_tracker_items made the obvious fix (an FK to the item) a trap: every edit inserts a new row/id, so an FK to the id dangles on the next edit.",
    approach:
      "Three additive pieces, each keyed correctly for the revision model. (1) budget_phases — a definition vocabulary in the established `*_def` style (stable `key`, soft-delete, config page), exposed through the generic ConfigDefinitionPage at /admin/config/budget/phases in the bare-array panel dialect store-types already uses; budget_tracker_items gains a nullable phase_id FK (set null). (2) budget_plan_schedule — one planned figure per (line, month): budget_item_track_id + period 'YYYY-MM' + planned_cents/planned_text, UNIQUE on (track_id, period) so inline edits upsert. (3) budget_expense_entries.budget_item_track_id — the actuals→line link, TEXT with NO FK, keyed on the stable trackId exactly like budget_item_material_mappings, so an actual survives its item's revisions and the grid can bucket it by dateIncurred. Everything is nullable/additive: migration 0171 is 2 CREATE TABLE + 6 ADD COLUMN + 2 unique indexes, no table rebuild, so there is zero data-loss surface on the revision-chained expense table. No grid UI in this PR — this is the substrate phases 1–2 build on.",
    apiChanges: [
      "NEW GET /api/config/budget-phases → bare array of {id,name,description,isActive}; POST creates (derives a unique `key` from name); PATCH /:id edits or soft-deactivates (isActive:false). Behind requireAccessAuth, on the shared config router.",
      "NEW page /admin/config/budget/phases (ConfigDefinitionPage island, new Budget config-nav group).",
      "No budget-item/expense HTTP surface changed yet — the new columns are written by phases 1+ (grid API, seed job).",
    ],
    filesTouched: [
      "src/backend/db/schema/home/budget_phases.ts (new — def table)",
      "src/backend/db/schema/home/budget_plan_schedule.ts (new — monthly plan)",
      "src/backend/db/schema/home/budget_tracker_items.ts (phase_id + variance note on items; track-id/room/invoice links on expenses)",
      "src/backend/db/schema/index.ts (barrel exports)",
      "src/backend/api/routes/config.ts (budget-phases CRUD block)",
      "src/frontend/pages/admin/config/budget/phases.astro (new config page)",
      "src/frontend/components/config/config-nav.ts (Budget nav group)",
      "drizzle/0171_whole_anthem.sql (new, additive)",
      "scripts/qc/pr_360.mjs (new)",
    ],
    migrations: [
      {
        tag: "0172_famous_the_santerians",
        sql: "CREATE TABLE `budget_phases` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `key` text NOT NULL, `name` text NOT NULL, `description_markdown` text, `description_html` text, `description_plaintext` text, `tone` text, `sort_order` integer DEFAULT 0 NOT NULL, `is_active` integer DEFAULT true NOT NULL, `datetime_created` integer DEFAULT (unixepoch()) NOT NULL, `datetime_updated` integer DEFAULT (unixepoch()) NOT NULL);\nCREATE TABLE `budget_plan_schedule` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `budget_item_track_id` text NOT NULL, `period` text NOT NULL, `planned_cents` integer DEFAULT 0 NOT NULL, `planned_text` text, `source` text DEFAULT 'manual' NOT NULL, `datetime_created` integer DEFAULT (unixepoch()) NOT NULL, `datetime_updated` integer DEFAULT (unixepoch()) NOT NULL);\nALTER TABLE `budget_expense_entries` ADD `budget_item_track_id` text;\nALTER TABLE `budget_expense_entries` ADD `room_id` integer REFERENCES rooms(id);\nALTER TABLE `budget_expense_entries` ADD `invoice_id` integer REFERENCES worker_email_invoices(id);\nALTER TABLE `budget_tracker_items` ADD `phase_id` integer REFERENCES budget_phases(id);\nALTER TABLE `budget_tracker_items` ADD `variance_note_markdown` text;\nALTER TABLE `budget_tracker_items` ADD `variance_note_html` text;\nCREATE UNIQUE INDEX `budget_phases_key_unique` ON `budget_phases` (`key`);\nCREATE UNIQUE INDEX `ux_budget_plan_line_period` ON `budget_plan_schedule` (`budget_item_track_id`,`period`);",
      },
    ],
    diagrams: [
      {
        caption:
          "Schema delta — phase grouping, a monthly plan axis, and the actuals→line link (all on the stable trackId, never the revisioned id)",
        code: `erDiagram
  budget_phases ||--o{ budget_tracker_items : "phase_id (FK, set null)"
  budget_tracker_items ||..o{ budget_plan_schedule : "track_id (TEXT, no FK)"
  budget_tracker_items ||..o{ budget_expense_entries : "budget_item_track_id (TEXT, no FK)"
  budget_phases {
    int id PK
    text key UK "NEW"
    text name "NEW"
    int sort_order "NEW"
  }
  budget_plan_schedule {
    int id PK
    text budget_item_track_id "NEW · stable, no FK"
    text period "NEW · YYYY-MM"
    int planned_cents "NEW"
    text planned_text "NEW · currency rule"
  }
  budget_expense_entries {
    int id PK
    text track_id
    text budget_item_track_id "NEW · actuals→line, no FK"
    int room_id "NEW · nullable FK"
    int invoice_id "NEW · nullable FK"
  }`,
      },
      {
        caption: "How the three views resolve at grid read-time (phases 1–2 consume this schema)",
        code: `flowchart LR
  PH["budget_phases"] --> G["grid grouping"]
  SCH["budget_plan_schedule[month]"] --> EST["Estimate view"]
  EXP["expenses WHERE budget_item_track_id\\nbucketed by dateIncurred[month]"] --> ACT["Actuals view"]
  EST --> VAR["Variance = plan − actual"]
  ACT --> VAR
  classDef new fill:#1f4d2e,stroke:#4ade80,color:#eaffea;
  class PH,SCH,EXP new;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_360.mjs",
      command:
        "pnpm run build  &&  npx tsc --noEmit (touched files)  &&  pnpm run migrate:remote  &&  node scripts/qc/pr_360.mjs --base <preview> --preview  &&  node scripts/qc/pr_360.mjs",
      ranAt: "2026-08-05",
      output:
        "build: green (vite ✓ ~71s, server built). tsc --noEmit: NO ERRORS in touched files (budget_phases, budget_plan_schedule, budget_tracker_items, routes/config.ts, config-nav, budget/phases.astro). migrate:remote: applied 0171; verified on remote — budget_phases + budget_plan_schedule tables exist, budget_expense_entries has all 3 new columns, budget_tracker_items has all 3, 4 default phases seeded.\n\nQC preview (17/17): GET /api/config/budget-phases 200 + BARE array; all 4 seeded phases present; CRUD round-trip (POST 201 → appears → PATCH edit → PATCH isActive:false → drops from list); PATCH unknown id → 404; config page /admin/config/budget/phases 200 + island present; regression /api/config/store-types 200.\nQC prod (1/1): store-types regression 200; new endpoint correctly reports 'pending merge/deploy' (404 until shipped).",
      migrations: [
        {
          tag: "0172_famous_the_santerians",
          appliedRemote: true,
          note: "Additive only (2 CREATE TABLE + 6 ADD COLUMN + 2 unique indexes, no rebuild). PRAGMA-verified on remote; 4 default phases seeded via INSERT OR IGNORE.",
        },
      ],
    },
  },
  "pascal-layout-studio": {
    slug: "pascal-layout-studio",
    branch: "codex/pascal-core-remodel-continuation",
    prNumber: 342,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/342",
    subtitle: "0043 Phase 4 · Core Remodel manages evidence; Pascal edits the scene",
    introduction:
      "This closes the last planned Core Remodel phase of the Pascal integration. The editor remains the authority for visual node editing, while Core Remodel owns the durable projects, studies, variants, measurement evidence, snapshots, and lifecycle around those scenes.",
    problem:
      "Phases 1–3 delivered the durable wire, measured generator, full-fidelity MCP editing, comparison, and screenshot paths, but those capabilities were only reachable through the editor or Claude. A homeowner/admin had no place to browse the hierarchy, understand which dimensions grounded a scene, compare alternatives, capture a thumbnail, or retire an obsolete option. The MCP generation and comparison implementations were also at risk of drifting from any new browser endpoints, and the repository's hand-maintained OpenAPI document omitted the entire Pascal router.",
    approach:
      "A shared product workflow now owns measured-base generation, branched generation with optional structured AI edits, and enriched comparison. Both the existing MCP tools and the new product REST routes call that workflow. The canonical /admin/plan/3d Astro shell mounts one Shadcn React island; project detail state lives in the URL query, while legacy /admin/pascal links permanently redirect. Cards keep evidence visible but progressive: thumbnail, state and top dimensions first; lineage/confidence inside provenance; rename/archive inside More. Pascal is always opened by deep link in a new tab—Core Remodel never renders Three.js. Finally, /openapi.json merges Pascal's OpenAPIHono document at the actual /pascal/v1 mount prefix, making route declarations the documentation source of truth.",
    apiChanges: [
      "NEW GET /api/pascal/v1/projects — project summaries plus canonical floor and room scope choices.",
      "NEW GET/POST /api/pascal/v1/projects/:projectId/studies — enriched hierarchy and rich-text study creation.",
      "NEW POST /api/pascal/v1/studies/:studyId/variants — measured base or branched/intent variant via the shared workflow.",
      "NEW POST /api/pascal/v1/variants/compare — enriched comparison used by the browser UI.",
      "NEW POST /api/pascal/v1/scenes/:sceneId/capture and PATCH /status — snapshot and lifecycle actions.",
      "CHANGED GET /openapi.json — merges all Pascal OpenAPIHono operations at /pascal/v1/*.",
    ],
    filesTouched: [
      "src/frontend/pages/admin/plan/3d.astro",
      "src/frontend/pages/admin/pascal/index.astro (redirect)",
      "src/frontend/pages/admin/pascal/[projectId].astro (redirect)",
      "src/frontend/components/pascal/PascalLayoutStudioApp.tsx",
      "src/frontend/components/sidebar/nav-groups.ts",
      "src/backend/api/routes/pascal.ts",
      "src/backend/api/routes/openapi.ts",
      "src/backend/services/pascal/workflow.ts",
      "src/backend/services/pascal/store.ts",
      "src/backend/mcp/tools/pascal/generate_floorplan_variant.ts",
      "src/backend/mcp/tools/pascal/compare_layout_variants.ts",
      "docs/0043_pascal_render_integration/TASKS.json",
      "scripts/qc/pr_342.mjs",
      "worker-configuration.d.ts",
    ],
    migrations: [],
    code: [],
    diagrams: [
      {
        caption: "Ownership boundary and the shared workflow",
        code: `flowchart LR
  UI["Core Remodel Layout Studio"] --> REST["Pascal product REST"]
  MCP["Claude via Pascal MCP tools"] --> WF["Shared product workflow"]
  REST --> WF
  WF --> D1["D1 projects, studies, scenes, evidence"]
  UI --> LINK["Open editor deep-link"]
  LINK --> EDITOR["Pascal editor: node semantics + 2D/3D"]
  EDITOR --> WIRE["Frozen scene wire"]
  WIRE --> D1`,
      },
      {
        caption: "Measured or branched variant creation",
        code: `sequenceDiagram
  actor U as User
  participant UI as Layout Studio
  participant WF as Shared workflow
  participant AI as Structured AI edit
  participant DB as D1 scene store
  U->>UI: Generate variant
  alt Measured base
    UI->>WF: studyId + name
    WF->>DB: Read floor, rooms, measurements
    WF->>WF: Deterministic rectangular seed
  else Branch
    UI->>WF: parent scene + optional intent
    WF->>DB: Load graph + measurement evidence
    opt Intent supplied
      WF->>AI: Propose validated node operations
      AI-->>WF: Structured operations
    end
  end
  WF->>DB: Save child graph + lineage + provenance
  DB-->>UI: Variant + editor URL`,
      },
      {
        caption: "Layout Studio navigation and lifecycle",
        code: `stateDiagram-v2
  [*] --> Projects
  Projects --> Project: Open project via ?project=id
  Project --> Study: Create or choose study
  Study --> Variant: Generate measured or branch
  Variant --> Compared: Select 2 or more
  Variant --> Captured: Capture snapshot
  Variant --> Editing: Open Pascal editor
  Variant --> Archived: Archive
  Archived --> Variant: Restore
  Editing --> Variant: Save through frozen wire`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_342.mjs",
      command: "pnpm run test:pr 342 -- --preview",
      output: `QC pr_342 — Pascal Layout Studio
target: https://wcrp-codex-pascal-core-remodel-continuation.hacolby.workers.dev
18 passed, 0 failed`,
      ranAt: "2026-08-02",
      migrations: [],
    },
  },
  "store-quote-product-map": {
    slug: "store-quote-product-map",
    branch: "claude/0042-p5-product-map",
    prNumber: 337,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/337",
    subtitle: "0042 P5 · quote lines → products (match or auto-create) — and 0042 complete",
    code: [],
    problem:
      "P4 pinned an extracted quote to the showroom it came from, but the line items still dead-ended: they linked only to materials/services, never to the products catalog, and a quote from a showroom the user is actively tracking did nothing to that store's product list. The original ask was explicit — 'match that data up to the products the user is tracking in the showroom if any, and if none yet, create the brand/products.' That match/create step, plus recording the quoted price, is P5 and the last of 0042.",
    approach:
      "A small service, map-invoice-products.ts, runs after line-item insert (post-extraction = post-approval for Gmail, so a human already gated it). For each unmatched line it reuses the SHARED ensureProductFromExtraction — the same brand+item dedup the photo-intake pipeline uses, so a quote and a price-card photo converge on one product rather than forking the catalog — passing the invoice vendor as the brand and the line description as the item name. The returned product is linked to the showroom via showroom_product_mappings (idempotent on its uniq index) and the line's unit price is written as a dated product_price_observation (sourceType 'showroom', deduped on product+store+cents so a reprocess doesn't pile up dups). The line is stamped product_id / brand_id / match_status ('created' vs 'matched'), and the viewport panel renders the product under each line with a 'new from quote' or 'matched' badge. Guardrails keep the catalog clean: only quotes that resolved to a store are mapped (an unattributed quote is left for a human), a prefix heuristic skips charge lines (tax/delivery/labor/fee/total), and everything is best-effort per line so one bad row never fails the email. FK discipline throughout — the line stores product_id/brand_id, and the display name JOINs from products.",
    apiChanges: [
      "CHANGED GET /api/showroom-stores/:id/pending-quotes: each line now carries productId, brandId, productName (LEFT JOIN products) + matchStatus.",
      "NEW services/email/map-invoice-products.ts: mapInvoiceLinesToProducts(db, invoiceId) → { matched, created, skipped }; fired from the email pipeline.",
      "No new HTTP route — mapping is a pipeline side-effect; the viewport reads it through the existing pending-quotes endpoint.",
    ],
    filesTouched: [
      "src/backend/db/schema/emails/worker_email_invoice_line_items.ts (product_id + brand_id FKs + index)",
      "drizzle/0167_abandoned_bromley.sql (new, additive)",
      "src/backend/services/email/map-invoice-products.ts (new — the mapping service)",
      "src/backend/services/email/pipeline.ts (fire mapping post-line-insert)",
      "src/backend/api/routes/showroom-stores.ts (pending-quotes JOINs product name)",
      "src/frontend/components/showroom/StoreViewportApp.tsx (per-line product badge)",
      "scripts/qc/pr_337.mjs",
    ],
    migrations: [
      {
        tag: "0167",
        sql: "ALTER TABLE `worker_email_invoice_line_items` ADD `product_id` integer REFERENCES products(id);\nCREATE INDEX `worker_email_invoice_line_items_product_idx` ON `worker_email_invoice_line_items` (`product_id`);\n-- (0167 also added brand_id; dropped in 0168 per review — see below)",
      },
      {
        tag: "0168",
        sql: "-- Review: brand_id was denormalized (products.brandId owns it). Native\n-- DROP COLUMN — no table rebuild, so the material_room_proposals FK is safe.\nALTER TABLE `worker_email_invoice_line_items` DROP COLUMN `brand_id`;",
      },
    ],
    diagrams: [
      {
        caption: "Schema delta — a quote line now relates to a product + brand (FKs, nullable)",
        code: `erDiagram
  products ||--o{ worker_email_invoice_line_items : "matched/created as"
  brands ||--o{ worker_email_invoice_line_items : "brand of"
  worker_email_invoices ||--o{ worker_email_invoice_line_items : "lines"
  products ||--o{ showroom_product_mappings : "carried by showroom"
  products ||--o{ product_price_observations : "priced at"
  worker_email_invoice_line_items {
    int id PK
    int invoice_id FK
    int product_id FK "NEW · nullable · brand derives via products.brandId"
    string match_status "unmatched|matched|created|skipped"
  }`,
      },
      {
        caption: "Per line: skip a charge, match a product, or create one — then link + price",
        code: `flowchart TD
  L["unmatched line (desc + unitPrice)"] --> J{charge line?<br/>tax/delivery/labor/fee}
  J -->|yes| SK["match_status = skipped"]
  J -->|no| E["ensureProductFromExtraction(vendor, desc)"]
  E --> F{existing product?}
  F -->|yes| MT["match_status = matched"]
  F -->|no| CR["create brand+product · match_status = created"]
  MT --> LK["showroom_product_mappings (idempotent)"]
  CR --> LK
  LK --> PO["product_price_observations<br/>(dedup product+store+cents)"]
  PO --> ST["stamp line product_id / brand_id"]
  classDef new fill:#1f4d2e,stroke:#4ade80,color:#eaffea;
  class CR,LK,PO,ST new;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_337.mjs",
      command:
        "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run migrate:remote  &&  pnpm run test:pr 337 -- --preview  &&  pnpm run test:pr 337",
      ranAt: "2026-08-02",
      output:
        "tsc --noEmit clean on all touched files. pnpm run build green (exit 0, ~67s). migrate:remote applied 0167; PRAGMA confirms product_id + brand_id on worker_email_invoice_line_items on remote. QC pr_337: the junk-line heuristic self-check passes (tax/delivery/labor/subtotal skipped; slab/faucet/pendant kept), and the pending-quotes line shape exposes productId/brandId/productName/matchStatus. Mapping on live data fires when the next real showroom quote arrives — the only existing prod draft is store-less (gmail.com sender), which the service correctly no-ops.",
      migrations: [
        { tag: "0167", appliedRemote: true },
        { tag: "0168", appliedRemote: true },
      ],
    },
  },
  "store-quote-viewport": {
    slug: "store-quote-viewport",
    branch: "claude/0042-showroom-quote-map",
    prNumber: 336,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/336",
    subtitle: "0042 P4 · extracted quotes surface in the showroom viewport",
    code: [],
    problem:
      "0042 P0–P3 shipped: attachments get non-AI OCR + embeddings, the trust gate defers AI on Gmail-sourced mail, and a global alerts bell aggregates everything. But the original request had one more beat — the extracted quote/invoice should appear 'within that showroom viewport as a pending item,' matched to the store it came from. Until now an extracted quote landed only in worker_email_invoices and the global receipt-review queue; nothing tied it to the Pietra Fina viewport where the user staged the slabs it prices. There was no FK from an invoice to a showroom at all.",
    approach:
      "Give the invoice a home. A nullable worker_email_invoices.showroom_store_id FK (migration 0166, additive) records which showroom a quote is FROM. The email pipeline already runs matchShowroomStore() to auto-populate showroom contacts from a sender's domain/name — the same resolver now stamps the invoice at extraction time, inside analyzeAndPersist so both the fresh-receipt and reprocess paths get it for free. A new GET /api/showroom-stores/:id/pending-quotes returns that store's draft quotes with their line items; StoreViewportApp loads it and renders a PendingQuotesPanel atop the brands-products section — vendor, total, confidence, line items, and Confirm/Dismiss that reuse the existing worker-emails confirm/reject endpoints, plus a Review & map link into the full HITL. The alerts aggregator's invoice_review rows now deep-link into the store viewport when the quote resolved to a showroom, else the global receipt-review queue. The FK is nullable on purpose: a quote from a public domain (a gmail.com sender) resolves to no store and shows only in the global feed — verified against the one existing prod draft (Costco / gmail.com), which correctly stays null. It's a real relation, not a denormalized name: vendorName stays the as-extracted snapshot; the store is the FK. Product match/auto-create per line is P5, which builds directly on showroom_store_id.",
    apiChanges: [
      "NEW GET /api/showroom-stores/:id/pending-quotes → { quotes: [{ id, kind, vendorName, invoiceNumber, invoiceDate, dueDate, subtotal, tax, total, currency, confidence, status, emailId, createdAt, lineItems[] }] } — draft quotes resolved to this store.",
      "CHANGED GET /api/alerts: invoice_review rows deep-link to /admin/shopping/store/:id/brands-products when showroom_store_id is set, else /admin/shopping/receipt-review.",
      "matchShowroomStore() exported from services/email/showroom-contact-autopopulate.ts; pipeline stamps showroom_store_id on the invoice at extraction (fresh + reprocess).",
    ],
    filesTouched: [
      "src/backend/db/schema/emails/worker_email_invoices.ts (showroom_store_id FK + index)",
      "drizzle/0166_many_joseph.sql (new, additive)",
      "src/backend/services/email/showroom-contact-autopopulate.ts (export matchShowroomStore)",
      "src/backend/services/email/pipeline.ts (resolve + stamp store at extraction)",
      "src/backend/api/routes/showroom-stores.ts (GET /:id/pending-quotes)",
      "src/backend/api/routes/alerts.ts (store-scoped invoice_review deep-link)",
      "src/frontend/components/showroom/StoreViewportApp.tsx (PendingQuotesPanel)",
      "scripts/qc/pr_336.mjs",
    ],
    migrations: [
      {
        tag: "0166",
        sql: "ALTER TABLE `worker_email_invoices` ADD `showroom_store_id` integer REFERENCES showroom_stores(id);\nCREATE INDEX `worker_email_invoices_showroom_idx` ON `worker_email_invoices` (`showroom_store_id`);",
      },
    ],
    diagrams: [
      {
        caption:
          "Schema delta — an invoice now relates to the showroom it came from (FK, nullable)",
        code: `erDiagram
  showroom_stores ||--o{ worker_email_invoices : "quotes from"
  worker_emails ||--o{ worker_email_invoices : "extracted from"
  worker_email_invoices ||--o{ worker_email_invoice_line_items : "lines"
  worker_email_invoices {
    int id PK
    int email_id FK
    int showroom_store_id FK "NEW · nullable · SET NULL"
    string vendor_name "as-extracted snapshot"
    real total
    string status "draft|confirmed|rejected"
  }`,
      },
      {
        caption: "Extraction → resolve → the quote appears in that store's viewport",
        code: `sequenceDiagram
  participant P as email pipeline (analyzeAndPersist)
  participant M as matchShowroomStore(sender)
  participant I as worker_email_invoices
  participant V as StoreViewportApp
  participant A as alerts bell
  P->>M: sender domain / vendor name
  M-->>P: storeId (or null for a public domain)
  P->>I: insert invoice + showroom_store_id
  V->>I: GET /:id/pending-quotes
  I-->>V: draft quotes + line items → PendingQuotesPanel
  A->>I: invoice_review alert
  Note over A: deep-links to /store/:id when scoped, else receipt-review`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_336.mjs",
      command:
        "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run migrate:remote  &&  pnpm run test:pr 336 -- --preview  &&  pnpm run test:pr 336",
      ranAt: "2026-08-02",
      output:
        "tsc --noEmit clean on all touched files. pnpm run build green (exit 0, ~130s). migrate:remote applied 0166; PRAGMA confirms worker_email_invoices.showroom_store_id exists on remote. QC pr_336 against the preview: 6/6 — GET /:id/pending-quotes 200 with { quotes: [...] } shape, invalid id → 400, alerts regression intact. QC against prod (main): 3/3 regression green, /pending-quotes correctly reports 'pending merge/deploy' (endpoint not on main yet). The one existing prod draft (Costco / gmail.com) stays showroom_store_id=null as designed.",
      migrations: [{ tag: "0166", appliedRemote: true }],
    },
  },
  "0032-discovery-finder-pages": {
    slug: "0032-discovery-finder-pages",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 D2d · the finder UI — and 0032 complete",
    code: [],
    problem:
      "The discovery finder had a full backend — tables (D2a), a realtime hub (D2b), the find_showrooms engine + REST (D2c-1), and MCP tools (D2c-2) — but no UI. A voice session could run a search, but a human had no page to see it, watch results land live, or import/exclude them. This is the finder UI, and the last slice of 0032.",
    approach:
      "Three thin Astro shells (per studio.astro — `class` not `className`, 24px header icon) mounting client:only React islands over the D2c-1 REST + D2b DiscoveryHub, modelled on the D1b Park-Finds page. (1) /admin/shopping/showrooms/finder — FinderApp: a one-box 'search near… for…' form that POSTs /api/showroom-searches and redirects to the new slug, plus a list of recent searches with status + result-count chips. (2) /finder/[slug] — FinderDetailApp: reads GET /api/showroom-searches/:slug, renders each result via ResultCard (a DriveMapThumb mini-map + type/rating/distance/relevance badges + tel:/website links + 'Add to directory'/'Not interested' actions that call the import/exclude REST and refetch), and STREAMS live updates from the DiscoveryHub WS — it derives the wss:// URL from window.location, sends a 15s `ping` keepalive, refetches on any realtime_event frame, reconnects on close, and runs a 20s poll as a fallback if the socket drops. Refine adds a revision in place; Finalize marks the slug final. (3) /exclusions — ExclusionsApp: the not-interested list with un-exclude. A Finder + Not-interested nav entry lands under Showrooms. Frontend only — no API/D1 change; every action goes through the D2c-1 REST that the MCP tools also call, so the page and a voice session stay in lockstep.",
    apiChanges: [
      "None — frontend only. Consumes the D2c-1 REST (/api/showroom-searches*, /api/showroom-exclusions*) + the D2b WS (/api/showrooms/discovery/ws).",
    ],
    filesTouched: [
      "src/frontend/pages/admin/shopping/showrooms/finder.astro (new)",
      "src/frontend/pages/admin/shopping/showrooms/finder/[slug].astro (new)",
      "src/frontend/pages/admin/shopping/showrooms/exclusions.astro (new)",
      "src/frontend/components/finder/{FinderApp,FinderDetailApp,ResultCard,ExclusionsApp,api,types}.tsx/ts (new)",
      "src/frontend/components/sidebar/nav-groups.ts (Finder + Not-interested entries)",
      "scripts/qc/pr_329.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption:
          "The finder viewport streams the DiscoveryHub — a voice search lands live in the browser",
        code: `sequenceDiagram
  actor U as Finder viewport /finder/&lt;slug&gt;
  participant W as Worker
  participant DO as DiscoveryHub (search:&lt;slug&gt;)
  participant E as find_showrooms engine
  U->>W: GET /api/showroom-searches/&lt;slug&gt; (initial)
  U->>DO: WS /api/showrooms/discovery/ws?slug=&lt;slug&gt;
  Note over U,DO: + 15s "ping" keepalive, 20s poll fallback
  E->>DO: publishDiscoveryEvent(results_ready)
  DO-->>U: realtime_event
  U->>W: refetch GET /:slug → new results render
  U->>W: POST /:slug/import {resultIds} → "Add to directory"
  U->>W: POST /:slug/exclude {resultId} → "Not interested"`,
      },
      {
        caption: "0032 complete — the discovery finder, end to end",
        code: `flowchart LR
  A["D2a schema<br/>showroom_search/_revision/_result"] --> C["D2c-1 engine + REST"]
  B["D2b DiscoveryHub<br/>realtime WS"] --> C
  C --> D["D2c-2 MCP tools<br/>(voice/chat parity)"]
  C --> E["D2d finder pages<br/>(this)"]
  B --> E
  classDef done fill:#1f4d2e,stroke:#4ade80,color:#eaffea;
  class A,B,C,D,E done;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_329.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 329 -- --preview",
      ranAt: "2026-07-31",
      output:
        "tsc --noEmit clean on all finder components + nav-groups. pnpm run build green (exit 0, ~108s; the 3 new pages prerender + the islands bundle). No API/D1 change. QC pr_329 proves the 3 pages are wired (SSR shell responds, not 404/5xx) + regresses the REST the islands consume and the DiscoveryHub /health gateway the viewport streams; hydration + the live WS + import/exclude are exercised in-browser.",
      migrations: [],
    },
  },
  "0032-discovery-mcp-tools": {
    slug: "0032-discovery-mcp-tools",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 D2c-2 · discovery finder over MCP (voice/chat parity)",
    code: [],
    problem:
      "D2c-1 shipped the finder engine + REST, but a Claude voice/chat session can't call REST — it needs MCP tools. 0022 §14.2 requires REST/MCP parity: the finder page and a voice session must run and manage a discovery search through the exact same logic, never a divergent second implementation.",
    approach:
      "10 MCP tools, each a thin `defineTool` wrapper that calls the identical `services/showroom/discovery-search.ts` function its REST twin uses — the parity seam, exactly how `list_park_finds`/`decide_park_find` wrap `hitl-queue.ts`. `find_showrooms` (WRITE) → `findShowrooms`; the reads `list_showroom_searches`/`get_showroom_search`/`get_search_revisions` (READ_ONLY) → `listSearches`/`getSearch`/`getSearchRevisions`; `finalize_showroom_search` (WRITE_IDEMPOTENT) → `finalizeSearch`; `import_search_results` (WRITE) → `importSearchResults`; `exclude_search_result` (WRITE) → `excludeSearchResult`; and exclusions CRUD `add_showroom_exclusion` (WRITE_IDEMPOTENT) / `list_showroom_exclusions` (READ_ONLY) / `remove_showroom_exclusion` (DESTRUCTIVE) → `addExclusion`/`listExclusions`/`removeExclusion`. Each has a hand-written Zod v4 input shape, ≥1 example, and the correct annotation; they register in `tools/showrooms/index.ts` and auto-render on the `/connect/tools` catalog via the registry (`/api/mcp-docs`). No D1 schema, no new REST — pure MCP surface over the D2c-1 engine, so the finder page (D2d) and the voice loop share one brain.",
    apiChanges: [
      "10 MCP tools (Showrooms domain): find_showrooms, list_showroom_searches, get_showroom_search, get_search_revisions, finalize_showroom_search, import_search_results, exclude_search_result, add_showroom_exclusion, list_showroom_exclusions, remove_showroom_exclusion.",
      "No REST or D1 change — the tools call the D2c-1 discovery-search.ts service.",
    ],
    filesTouched: [
      "src/backend/mcp/tools/showrooms/{find_showrooms,list_showroom_searches,get_showroom_search,get_search_revisions,finalize_showroom_search,import_search_results,exclude_search_result,add_showroom_exclusion,list_showroom_exclusions,remove_showroom_exclusion}.ts (new)",
      "src/backend/mcp/tools/showrooms/index.ts (register all 10)",
      "scripts/qc/pr_327.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption:
          "REST and MCP both call the one discovery-search service — never a second implementation",
        code: `flowchart LR
  UI["Finder UI (D2d)"] --> REST["/api/showroom-searches* (D2c-1)"]
  VOICE["Claude voice/chat"] --> MCP["MCP find_showrooms + slug + exclusion tools (D2c-2)"]
  REST --> SVC["discovery-search.ts"]
  MCP --> SVC
  SVC --> DB[(showroom_search / _revision / _result)]
  SVC --> HUB[DiscoveryHub realtime]
  SVC --> EXC[(showroom_exclusions)]
  classDef new fill:#3a2a3f,stroke:#c084fc,color:#f5e8ff;
  class MCP new;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_327.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 327 -- --preview",
      ranAt: "2026-07-31",
      output:
        "tsc --noEmit clean on all 10 tool files + the registry barrel. pnpm run build green (exit 0, ~116s). Registry tool count went up by 10. No D1 schema, no new REST. QC pr_327 asserts all 10 tool names appear in GET /api/mcp-docs (the registry catalog that backs /connect/tools) — invoking them needs an OAuth grant not mintable in QC, so catalog presence is the wired-in proof.",
      migrations: [],
    },
  },
  "0032-discovery-search-engine": {
    slug: "0032-discovery-search-engine",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 D2c-1 · find_showrooms engine + discovery REST",
    code: [],
    problem:
      "D2a gave the finder its tables and D2b its realtime channel, but nothing fills them. 0022 §14.2 asks for a worker-orchestrated find_showrooms: the model (or the finder UI) asks 'what remodel showrooms are near here?', and the WORKER does the Places scrape, dedupes against what's already known, ranks with AI, and owns the persisted, shareable result — the model only orchestrates. It must be cost-safe (Places is billed) and must never drift between the finder page and a voice session.",
    approach:
      "One service, services/showroom/discovery-search.ts, backs both REST (this slice) and MCP (D2c-2) — the parity seam, exactly like hitl-queue.ts backs the park-find REST + tools. findShowrooms: (1) resolve the search row — mint a new unique slug, or bump an existing slug's revision; (2) gather candidates — the model's aiResults (source 'ai') plus a placesTextSearchMany sweep (source 'places') when usePlaces is set; (3) dedupe by place_id (else name+address); (4) flag in_directory (join showroom_stores by place_id) + is_excluded (join showroom_exclusions) via inArray over the candidate ids; (5) rank/classify with ONE Gemini structured call that returns a verdict per place_id — validated against the live candidate set so a hallucinated id is dropped, best-effort with a 12s timeout and a deterministic Places-type heuristic fallback; (6) drop confident 'not relevant' + excludeCategories, sort by relevance, and persist a numbered showroom_search_revision + its showroom_search_result rows (chunked ≤3/statement for D1's 100-param cap, replacing the slug's prior results); (7) update the search (status ready, current_revision, result_count, summary) and publish results_ready to the slug's DiscoveryHub. Cost safety mirrors proximityScan: the Places sweep is the only billed call and placesTextSearchMany throws MAPS_QUOTA_EXCEEDED when the SKU is spent — caught, degrading to AI-only with used_places=false rather than failing. Slug actions do NOT re-search: list/get/revisions/finalize, import (promote selected results into showroom_stores — reuse-by-place_id-else-create, exactly the HITL PROCESS path, stamping imported_at), and exclude (add a permanent showroom_exclusions row off the slug so the place never resurfaces). Plus exclusions CRUD (add idempotent-by-place_id / list / remove). FK rule honored throughout: a result relates to its store by existing_store_id and its hiding exclusion by matched_exclusion_id — names are JOINed, never copied.",
    apiChanges: [
      "NEW POST /api/showroom-searches (create/refine) · GET / (list) · GET /:slug · GET /:slug/revisions · POST /:slug/finalize · POST /:slug/import {resultIds} · POST /:slug/exclude {resultId,reason}.",
      "NEW GET/POST /api/showroom-exclusions · DELETE /api/showroom-exclusions/:id.",
      "services/showroom/discovery-search.ts: findShowrooms + listSearches/getSearch/getSearchRevisions/finalizeSearch/importSearchResults/excludeSearchResult + addExclusion/listExclusions/removeExclusion.",
    ],
    filesTouched: [
      "src/backend/services/showroom/discovery-search.ts (new — the engine)",
      "src/backend/api/routes/showroom-searches.ts (new)",
      "src/backend/api/routes/showroom-exclusions.ts (new)",
      "src/backend/api/index.ts (mount both routers)",
      "scripts/qc/pr_326.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "find_showrooms — one revision: gather → dedupe → flag → rank → persist → publish",
        code: `flowchart TD
  A["find_showrooms(near, query?, aiResults?, usePlaces)"] --> B{new slug or refine?}
  B -->|new| C[mint unique slug · revision 1]
  B -->|refine| C2[bump slug revision]
  C --> D[gather candidates]
  C2 --> D
  D --> D1["aiResults (source ai)"]
  D --> D2{usePlaces &amp; quota ok?}
  D2 -->|yes| P["placesTextSearchMany (source places)"]
  D2 -->|no / MAPS_QUOTA_EXCEEDED| AO["AI-only · used_places=false"]
  D1 --> M[dedupe by place_id / name+address]
  P --> M
  AO --> M
  M --> F["flag in_directory + is_excluded (inArray)"]
  F --> R["Gemini rank — validated place_ids · heuristic fallback"]
  R --> S["persist revision + result rows (chunk ≤3/stmt)"]
  S --> U["update search: ready, current_revision, summary"]
  U --> PUB["publishDiscoveryEvent → DiscoveryHub (results_ready)"]
  classDef ai fill:#3a2a3f,stroke:#c084fc,color:#f5e8ff;
  class R,AO ai;
  classDef safe fill:#1f4d2e,stroke:#4ade80,color:#eaffea;
  class D2,S safe;`,
      },
      {
        caption: "One service, two callers (parity) — REST now, MCP in D2c-2",
        code: `flowchart LR
  UI[Finder UI] --> REST["/api/showroom-searches*"]
  MCP["MCP find_showrooms + slug actions (D2c-2)"] --> SVC
  REST --> SVC["discovery-search.ts (the one service)"]
  SVC --> DB[(showroom_search / _revision / _result)]
  SVC --> HUB[DiscoveryHub realtime]
  SVC --> STORES[(showroom_stores · import)]
  SVC --> EXC[(showroom_exclusions)]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_326.mjs",
      command:
        "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 326 -- --preview --sweep",
      ranAt: "2026-07-31",
      output:
        "tsc --noEmit clean on discovery-search.ts + both route files + api/index.ts. pnpm run build green (exit 0, ~120s). No D1 schema (tables shipped in D2a/0163). QC pr_326 proves the two new endpoints are wired + a regression on the shared park-find sink; the full write path (create→get→revisions) runs with --sweep AI-only (usePlaces:false + a synthetic aiResult) to avoid live Places billing + prod row-pollution. The live Places+Gemini path is exercised on a real finder search.",
      migrations: [],
    },
  },
  "0032-discovery-realtime-hub": {
    slug: "0032-discovery-realtime-hub",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 D2b · DiscoveryHub realtime fan-out DO",
    code: [],
    problem:
      "The discovery finder (0022 §14.5) runs a Places sweep + Gemini rank that takes several seconds and can be refined into new revisions. A user who opened the shareable /finder/<slug> page — or who is watching it while still talking to the voice assistant that kicked off the search — should see the search go running → ready and each revision's results appear live, not have to refresh. The finder needs a realtime channel keyed per search slug; there was none.",
    approach:
      "Stand up DiscoveryHub, a Hibernatable-WebSocket Durable Object cloned from the proven EstimateCollabHub: one instance per room 'search:<slug>' via getByName, ctx.acceptWebSocket(server) to hand the socket to the runtime (so the DO can hibernate while idle sockets stay open and there is no in-memory socket set to lose on eviction), the webSocket* handlers, a private broadcast() over ctx.getWebSockets(), a POST /emit producer entrypoint, a /health socket count, and an app-level ping→pong keepalive. It is wired the same way the existing realtime gateways are: exported from _worker.ts, bound as DISCOVERY_HUB in wrangler.jsonc with a v17 new_sqlite_classes migration (a fresh DO migration tag — the sanctioned way to add a DO here, since production deploys are agent-owned; the branch CI that would collide on tags is disconnected), and given a WS gateway route /api/showrooms/discovery/ws|health?slug= placed BEFORE the Hono block so the upgrade is offloaded to the DO. A publishDiscoveryEvent(env, slug, payload) helper (mirroring publishRealtimeEvent) is the seam the D2c finder engine will call after each write. Crucially, DiscoveryHub carries NO alarm and no growing storage — it is entirely outside the DO-alarm cost-safety surface that the $700 incident hardened. This PR ships the transport only; the events that flow through it arrive with the D2c engine.",
    apiChanges: [
      "NEW WS gateway GET /api/showrooms/discovery/ws?slug=<slug> (WebSocket upgrade → DiscoveryHub) + GET /api/showrooms/discovery/health?slug=<slug>.",
      "NEW realtime/publish.ts publishDiscoveryEvent(env, slug, payload) — POSTs to the slug's DiscoveryHub /emit.",
      "wrangler.jsonc: DISCOVERY_HUB DO binding + migration tag v17. No REST/D1 change.",
    ],
    filesTouched: [
      "src/backend/realtime/DiscoveryHub.ts (new)",
      "src/backend/realtime/publish.ts (publishDiscoveryEvent)",
      "src/_worker.ts (export + WS gateway route)",
      "wrangler.jsonc (DISCOVERY_HUB binding + v17 migration)",
      "worker-configuration.d.ts (regenerated)",
      "scripts/qc/pr_323.mjs",
    ],
    migrations: [
      { tag: "v17", sql: '-- DO migration only: new_sqlite_classes ["DiscoveryHub"] (no D1 DDL)' },
    ],
    diagrams: [
      {
        caption:
          "One DiscoveryHub per search slug — the engine publishes, open finder pages stream",
        code: `sequenceDiagram
  actor U as Finder page /finder/&lt;slug&gt;
  participant W as Worker (_worker.ts gateway)
  participant DO as DiscoveryHub (room search:&lt;slug&gt;)
  participant E as find_showrooms engine (D2c)
  U->>W: GET /api/showrooms/discovery/ws?slug=&lt;slug&gt;
  W->>DO: route by slug → acceptWebSocket
  DO-->>U: 101 Switching Protocols
  loop while searching
    E->>DO: publishDiscoveryEvent(slug, {status|revision|results})
    Note over DO: POST /emit → broadcast()
    DO-->>U: realtime_event (live, no poll)
  end
  U->>DO: "ping"
  DO-->>U: "pong"`,
      },
      {
        caption: "Where DiscoveryHub sits among the realtime gateways (all before the Hono block)",
        code: `flowchart TD
  R["incoming /api/* request"] --> G1{"/api/realtime/estimates|plans?"}
  G1 -- yes --> E["ESTIMATE_COLLAB.getByName(room)"]
  G1 -- no --> G2{"/api/room/:name/ws|health?"}
  G2 -- yes --> F["FLOORPLAN_SESSION.getByName(name)"]
  G2 -- no --> G3{"/api/showrooms/discovery/ws|health?"}
  G3 -- yes --> D["DISCOVERY_HUB.getByName(search:slug)"]
  G3 -- no --> H["Hono API (auth-gated)"]
  classDef new fill:#1f3a4d,stroke:#38bdf8,color:#e0f2fe;
  class D,G3 new;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_323.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 323 -- --preview",
      ranAt: "2026-07-31",
      output:
        "tsc --noEmit clean on DiscoveryHub.ts + publish.ts + _worker.ts. worker-configuration.d.ts regenerated via wrangler types (DISCOVERY_HUB added to Env). pnpm run build green (exit 0). No D1 schema — DO migration tag v17 only. QC pr_323 proves the DO is wired + reachable (GET /api/showrooms/discovery/health → 200) and regresses the sibling FloorplanSessionDO gateway; the live broadcast needs an open socket + the D2c engine publishing.",
      migrations: [
        {
          tag: "v17",
          appliedRemote: false,
          note: "DO migration applies on the next Deploy (manual) run; no D1 DDL to verify.",
        },
      ],
    },
  },
  "showroom-360-tour": {
    slug: "showroom-360-tour",
    branch: "claude/showroom-360-tour-links-0fd2ac",
    subtitle: "Showrooms · 360° tour in the Photos bento + Street View auto-tour",
    prNumber: 322,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/322",
    problem:
      "The SHOWROOM_TOUR link type already existed in the link vocabulary and was addable in the intake form, but a showroom's 360° walkthrough was never surfaced anywhere the user actually looks — it sat in the links modal, not in the Photos section. The original ask also wanted the tour auto-detected from Google (Places API or a scraped Matterport URL). Places (New) Details has no virtual-tour field, so it cannot return one; the only automatic path is Google Street View, which is billed — so it had to be wired without risking the $200/5,000-free-event ceiling.",
    approach:
      "Two surfaces in the Photos bento. (1) A TourCard renders a store's manual SHOWROOM_TOUR link: a Matterport host embeds inline in an <iframe>; any other tour URL opens in a new tab. The Photos tile description gains a '· 360° tour' badge. (2) When no manual link exists, StreetViewTour probes the store's lat/lng with the FREE StreetViewService.getPanorama() — Google's docs are explicit that only a rendered StreetViewPanorama object is billed, not the service check — so detection is free and runs on mount, rendering nothing when there is no coverage. The billable render is deferred behind an 'Open tour' click that FIRST calls POST /api/showroom-stores/:id/streetview-render; that endpoint runs the count-based isUnderApiQuota('street_view') guard (a new SKU capped at 4,500/mo, below Google's 5,000 free Pro events) and logs the event into the existing google_maps_usage_log — no new tracker, no dollar hardcoding, no schema change. The browser needs a Maps JS key, but the repo keeps every Maps key server-side; rather than bake a public key into the client bundle at build time, GET /api/places/maps-js-key serves it at runtime from the existing GOOGLE_MAPS_API secrets-store binding, behind the same requireAccessAuth gate as the rest of /api/places, so only authenticated sessions receive it.",
    apiChanges: [
      "POST /api/showroom-stores/:id/streetview-render — quota gate (isUnderApiQuota('street_view'), 403 QUOTA_LIMIT over cap) + logUsage into google_maps_usage_log with endpoint 'streetview:render'. Called by the client immediately before it instantiates a billable StreetViewPanorama.",
      "GET /api/places/maps-js-key — returns { key } from the GOOGLE_MAPS_API secrets-store binding (via getGoogleMapsApiKey), 503 when unset. Auth-gated by the existing /api/places/* middleware.",
      "GET /api/showroom-stores/:id — now exposes placeId (already spread from the row) for render-log context; latitude/longitude were already present.",
    ],
    filesTouched: [
      "src/backend/services/google/maps.ts (street_view SKU in MAPS_API_QUOTAS + getUsageBySku + skuForUsageBucket)",
      "src/backend/api/routes/showroom-stores.ts (POST /:id/streetview-render)",
      "src/backend/api/routes/places.ts (GET /maps-js-key)",
      "src/frontend/components/showroom/photos/StreetViewTour.tsx (new: SDK loader + free probe + gated render)",
      "src/frontend/components/showroom/StoreViewportApp.tsx (TourCard, tourUrl derivation, Photos-tile badge, StreetViewTour wiring, placeId in StoreDetail)",
      "scripts/qc/pr_streetview_tour.mjs",
    ],
    migrations: [],
    code: [],
    diagrams: [
      {
        caption:
          "Free detection on mount, billed render deferred behind a click + server quota gate",
        code: `sequenceDiagram
  participant U as User
  participant C as StreetViewTour (browser)
  participant K as GET /api/places/maps-js-key
  participant G as Google Maps JS
  participant R as POST /:id/streetview-render
  C->>K: fetch key (auth-gated, from GOOGLE_MAPS_API binding)
  K-->>C: { key }
  C->>G: getPanorama(location, radius 50)  [FREE]
  G-->>C: pano id | ZERO_RESULTS
  Note over C: no pano → render nothing
  U->>C: click "Open tour"
  C->>R: POST (panoId)
  R->>R: isUnderApiQuota('street_view')?
  R-->>C: 403 QUOTA_LIMIT → toast, no render
  R-->>C: { allowed:true } + logUsage(streetview:render)
  C->>G: new StreetViewPanorama(...)  [BILLED once]`,
      },
      {
        caption:
          "Where the 360° tour resolves from — manual link wins, Street View is the fallback",
        code: `flowchart TD
  A[Photos bento] --> B{SHOWROOM_TOUR link?}
  B -- yes --> C[TourCard]
  C --> C1{Matterport host?}
  C1 -- yes --> C2[inline iframe embed]
  C1 -- no --> C3[open in new tab]
  B -- no --> D[StreetViewTour probe]
  D --> D1{getPanorama finds coverage?}
  D1 -- no --> D2[render nothing]
  D1 -- yes --> D3[Open tour → quota gate → StreetViewPanorama]
  classDef free fill:#1f4d2e,stroke:#4ade80
  classDef paid fill:#4d1f1f,stroke:#f87171
  class D,D1,D2 free
  class D3 paid`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_streetview_tour.mjs",
      command:
        "pnpm run deploy:preview  &&  node scripts/qc/pr_streetview_tour.mjs --base <preview> --preview",
      ranAt: "2026-07-31",
      output: `QC streetview-tour against https://wcrp-claude-showroom-360-tour-links-0fd2ac.hacolby.workers.dev (preview)

  ✓ maps-js-key 200
  ✓ maps-js-key returns a key
  ✓ served key === tokens GOOGLE_MAPS_API
  ✓ found a store with coords
  ✓ render guard responds allowed|QUOTA_LIMIT
  ✓ render logged one usage row
  ✓ invalid store id → 400

7 passed, 0 failed

tsc --noEmit clean (176 = baseline, 0 new in the touched files). No schema change → no migration.`,
      migrations: [],
    },
  },
  "0032-discovery-search-schema": {
    slug: "0032-discovery-search-schema",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 D2a · discovery-finder schema foundation",
    code: [],
    problem:
      "0032 D2 is the on-demand 'find me showrooms near here' finder (0022 §5.7): a user or the voice assistant asks, the worker runs a Places sweep + Gemini rank, and persists the result as a shareable slug the user can open mid-conversation. That whole flow — the find_showrooms engine, the realtime hub that streams a running search, the finder pages — needs a data spine that does not exist yet: showroom_search / _revision / _result are absent, and showroom_exclusions (shipped in D1a) lacks the §5.7 normalized-address + category columns needed to match a not-interested place that arrives without a Google place_id.",
    approach:
      "Land the schema FIRST, as an additive migration, so every later D2 slice builds on live tables (and every other branch's preview keeps working against the shared D1). Three new tables mirror §5.7 exactly: showroom_search (one orchestrated search = a slug; status running→ready→refining→final→error, where a fresh slug is PENDING = ready-but-not-final; params_json carries near/radius/query/broad/excludes; origin mcp|ui), showroom_search_revision (every change is a 1-based numbered revision, UNIQUE(search_id, revision_number), source places|ai|mixed, used_places bool for the quota-hard-disable case — mirrors the artifact-revision pattern so the model can cite 'revision N'), and showroom_search_result (the rows a revision produced — place_id, normalized address + full_address, lat/lng, category_guess/primary_type + google_rating + opening_hours_json for the badges, source places|ai, ai_relevance/ai_reasoning, distance_m, and the two dedupe flags in_directory + is_excluded with FKs existing_store_id → showroom_stores and matched_exclusion_id → showroom_exclusions so a hidden result can name WHY it was hidden). Per the FK rule, a result relates to its store/exclusion by id and JOINs for the name — never a denormalized copy. showroom_exclusions gains location_street_number/_street_name/_city/_state/_zip_code + category + a zip index. name stays nullable: the PRD wants notNull, but retrofitting NOT NULL onto the D1a-populated column violates the additive-migration law, so it's documented and deferred. Generated via drizzle-kit (never hand-authored); the result is 3 CREATE TABLE + 6 ADD COLUMN + indexes, no table rebuilds.",
    apiChanges: [
      "None. Schema-only foundation; the /api/showroom-searches* endpoints + MCP find_showrooms that read these tables are D2c.",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/search.ts (new — showroom_search/_revision/_result)",
      "src/backend/db/schema/showroom/exclusions.ts (add address×5 + category + zip index)",
      "src/backend/db/schema/showroom/index.ts (export ./search)",
      "drizzle/0163_warm_ravenous.sql (generated)",
      "scripts/qc/pr_321.mjs",
    ],
    migrations: [
      {
        tag: "0163_warm_ravenous",
        sql: "CREATE TABLE showroom_search / showroom_search_revision / showroom_search_result (+FKs, unique(search_id,revision_number), slug-unique, status/search/revision/place indexes); ALTER showroom_exclusions ADD location_street_number/_street_name/_city/_state/_zip_code + category; CREATE INDEX showroom_exclusions_zip_idx. Additive only — no rebuilds.",
      },
    ],
    diagrams: [
      {
        caption:
          "§5.7 discovery-search data model — a slug, its numbered revisions, and the result rows a revision produced",
        code: `erDiagram
  showroom_search ||--o{ showroom_search_revision : "numbered revisions"
  showroom_search ||--o{ showroom_search_result : "current results"
  showroom_search_revision ||--o{ showroom_search_result : "produced these"
  showroom_exclusions |o--o{ showroom_search_result : "match hides a result"
  showroom_stores |o--o{ showroom_search_result : "already in directory"
  showroom_search {
    int id PK
    text slug UK
    text status "running|ready|refining|final|error"
    int current_revision
    text params_json
    text origin "mcp|ui"
  }
  showroom_search_revision {
    int id PK
    int search_id FK
    int revision_number "UNIQUE per search"
    text source "places|ai|mixed"
    int used_places "false when quota hard-disabled"
  }
  showroom_search_result {
    int id PK
    int search_id FK
    int revision_id FK
    text place_id
    real ai_relevance
    real distance_m
    int in_directory
    int existing_store_id FK
    int is_excluded
    int matched_exclusion_id FK
  }
  showroom_exclusions {
    int id PK
    text place_id "preferred match key"
    text location_zip_code "NEW"
    text category "NEW"
    text source "manual|ai"
  }`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_321.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 321 -- --preview",
      ranAt: "2026-07-31",
      output:
        "tsc --noEmit clean on search.ts + exclusions.ts. pnpm run build green (exit 0, ~109s server build). Migration 0163 generated via drizzle-kit — inspected: 3 CREATE TABLE + 6 additive ADD COLUMN + indexes, no drops/rebuilds. QC pr_321 is a regression guard (the new tables have no consumer endpoint until D2c): asserts /api/showroom-hitl-queue (which reads/writes the ALTERed showroom_exclusions) and /api/showrooms still respond, so the additive migration didn't break the live surface.",
      migrations: [
        {
          tag: "0163_warm_ravenous",
          appliedRemote: false,
          note: "Applies on the post-merge Deploy (manual) run with run_migrations:true; additive (3 CREATE TABLE + 6 ADD COLUMN).",
        },
      ],
    },
  },
  "0041-store-inbox": {
    slug: "0041-store-inbox",
    branch: "claude/showroom-inbox-filtering-0294ec",
    subtitle: "0041 · store inbox + deterministic ingestion gating + full-width pages",
    introduction:
      "The per-showroom inbox got its own full page, real folders, and rich replies — and a no-AI classifier that keeps marketing blasts out of the main list while routing receipts to the existing parser. Plus a layout fix that lets viewport/data pages use the full page width.",
    problem:
      "The inbox was a cramped h-560 inline panel inside the store viewport that got cut off, showed a flood of other companies' mail (it domain-matched every POC/contact email — usually reps at OTHER companies), had no delete/mark-unread, plaintext-only replies, an AI-draft button that silently 500'd, and no place for marketing blasts. Separately, viewport/data pages were pinned to container mx-auto max-w-Nxl, wasting the page.",
    approach:
      "Three workstreams. (1) Layout: drop the width cap on the viewport/data islands (w-full px-4 py-10 md:px-8); modals + reading/form pages stay narrow. (2) A standalone StoreInboxApp at /admin/shopping/store/[id]/inbox — a full-height two-pane mail surface with a folders rail (Inbox/Receipts/Spam/Trash) whose counts + filtering are server-side via ?folder=. Reading pane renders body as PLAINTEXT (quoted tail collapsed behind a toggle) + a gallery of embedded images served from our own Cloudflare Images URLs — never raw email HTML (XSS). Reply is the repo's PlateJS editor, sent as multipart/alternative. draft-assist reads choices[0].message.content (the envelope bug) and surfaces the real error. (3) Ingestion: classifyMessage is a pure, deterministic matcher — spam by phrase AND sender (an exact flagged-address list incl. rejuvenation@e.rejuvenation.com, plus e./email./mktg. bulk subdomains) recording the matched phrase in spam_rationale; receipt|invoice|quote + ($|attachment) sets a receipt classification (the Path-B ingest gate already bridges every gated message into processEmail for the actual line-item extraction). trimQuotedReply collapses reply tails. Both ingest insert sites and a new idempotent POST /backfill-classification route share it. Also carries buildShowroomMatchSpec: the showroom inbox matches its OWN domain (website links + store email) domain-wide and POC/contact emails by EXACT address — the root-cause fix for the cross-company flood.",
    apiChanges: [
      "GET /api/gmail/showrooms/:id/threads-by-domain?folder=inbox|receipts|spam|trash — per-folder filtering + counts + isSpam/isReceipt/spamRationale tags.",
      "DELETE /api/gmail/threads/:threadId — soft-delete (deleted_at) → Trash.",
      "POST /api/gmail/threads/:threadId/mark-unread — inverse of mark-read.",
      "GET /api/gmail/threads/:threadId — now returns attachments[] + images[] + per-message bodyHtml/bodyVisible/bodyQuoted/classification/isSpam.",
      "POST /api/gmail/threads/:threadId/reply — accepts { body?, markdown?, html? }; HTML sent as multipart/alternative.",
      "POST /api/gmail/backfill-classification — cursor-paged, idempotent re-classify of existing mail.",
    ],
    filesTouched: [
      "src/backend/services/gmail/classify-message.ts (+ .test.ts) — new deterministic classifier + trimQuotedReply",
      "src/backend/services/gmail/participants.ts (buildShowroomMatchSpec, + showroom-match-spec.test.ts)",
      "src/backend/services/gmail/client.ts (extractMessage returns html; buildReplyAllRaw multipart), ingestion.ts, ingest-gate.ts (wire classifier)",
      "src/backend/api/routes/gmail.ts (delete/mark-unread/folder+counts/attachments/html-reply/draft-fix/backfill)",
      "src/backend/db/schema/gmail/gmail_messages.ts (+4 cols), gmail_message_images.ts (new), schema/index.ts",
      "src/frontend/components/gmail/StoreInboxApp.tsx (new), types.ts; src/frontend/pages/admin/shopping/store/[id]/inbox.astro (new)",
      "6 viewport/data islands widened; drizzle/0158_famous_warpath.sql; scripts/qc/pr_310.mjs; docs/0041_store_inbox/",
    ],
    migrations: [
      {
        tag: "0158_famous_warpath",
        sql: "ALTER TABLE gmail_messages ADD classification text DEFAULT 'normal' NOT NULL;\nALTER TABLE gmail_messages ADD is_spam integer DEFAULT false NOT NULL;\nALTER TABLE gmail_messages ADD spam_rationale text;\nALTER TABLE gmail_messages ADD deleted_at integer;\nCREATE TABLE gmail_message_images ( id INTEGER PRIMARY KEY AUTOINCREMENT, gmail_message_id INTEGER NOT NULL REFERENCES gmail_messages(id) ON DELETE cascade, content_id text, cf_image_id text, delivery_url text NOT NULL, mime_type text, created_at integer DEFAULT (unixepoch()) NOT NULL );",
      },
    ],
    code: [
      {
        title:
          "Deterministic spam gating — sender rules win the rationale, phrases fall back (classify-message.ts)",
        lang: "ts",
        code: 'const sender = parseEmailAddress(input.from ?? "");\nif (sender) {\n  if (SPAM_SENDER_ADDRESSES.has(sender.email)) {\n    isSpam = true; spamRationale = `sender: ${sender.email}`;\n  } else if (BULK_SENDER_SUBDOMAINS.some((p) => sender.domain.startsWith(p))) {\n    isSpam = true; spamRationale = `bulk sender: ${sender.domain}`;\n  }\n}\nif (!isSpam) {\n  for (const phrase of SPAM_PHRASES) {\n    if (body.includes(phrase)) { isSpam = true; spamRationale = phrase; break; }\n  }\n}',
      },
    ],
    diagrams: [
      {
        caption:
          "Ingestion gating — deterministic, no AI. Spam foldered, receipts routed to the existing parser.",
        code: 'flowchart TD\n  msg["raw Gmail message"] --> ext["extractMessage (+html, +trimQuotedReply)"]\n  ext --> gate["classifyMessage — pure text match"]\n  gate -->|"sender/phrase spam"| spam["is_spam=1<br/>spam_rationale"]\n  gate -->|"receipt|invoice|quote + ($|attachment)"| rc["classification=receipt<br/>→ Path-B processEmail parser"]\n  gate -->|"else"| norm["normal"]\n  spam --> GM[(gmail_messages)]\n  rc --> GM\n  norm --> GM\n  GM --> folder["?folder= inbox|receipts|spam|trash"]\n  folder --> page["/admin/shopping/store/:id/inbox"]\n  classDef new fill:#1f4d2e,stroke:#4ade80\n  class spam,rc,folder,page new',
      },
      {
        caption: "Schema delta — 0158 (additive).",
        code: 'erDiagram\n  gmail_messages ||--o{ gmail_message_images : has\n  gmail_messages {\n    string classification "NEW: normal|promotional|receipt|invoice|quote"\n    int is_spam "NEW"\n    string spam_rationale "NEW — matched phrase, no AI"\n    datetime deleted_at "NEW — soft delete (Trash)"\n    string body_html "now populated"\n  }\n  gmail_message_images {\n    string content_id "cid ref"\n    string cf_image_id\n    string delivery_url\n  }',
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_310.mjs",
      command:
        "node scripts/qc/pr_310.mjs --preview   # branch preview — full new surface\nnode scripts/qc/pr_310.mjs             # production (regression guard)",
      ranAt: "2026-07-30",
      source:
        "// preview: all 4 folders 200 with counts + folder echo; getThread returns attachments[]/images[]\n// + bodyVisible/bodyQuoted/classification/isSpam; Rejuvenation foldered Spam with rationale;\n// backfill idempotent; reply-without-body → 400; draft-assist-without-threadId → 400.\n// prod: new folder/counts shape absent (main) → reported 'pending merge', legacy route still 200.",
      output:
        "PREVIEW (wcrp-claude-showroom-inbox-filtering-0294ec):\n  ✓ target reachable\n  ✓ folder=inbox → 200 with counts + folder echo\n  ✓ folder=receipts → 200 with counts + folder echo\n  ✓ folder=spam → 200 with counts + folder echo\n  ✓ folder=trash → 200 with counts + folder echo\n  ✓ getThread returns attachments[] + images[] arrays\n  ✓ message carries bodyVisible/bodyQuoted/classification/isSpam\n  ✓ rejuvenation@e.rejuvenation.com foldered as Spam with rationale\n  ✓ POST /backfill-classification → 200 (idempotent)\n  ✓ reply with no body/markdown/html → 400\n  ✓ draft-assist without threadId → 400\n  11 passed, 0 failed\n\n  backfill (whole mailbox): 1 page, processed=62, spamFlagged=28\n\nPRODUCTION (regression guard, pre-merge):\n  ✓ target reachable\n    folder/counts shape absent → running against main (pre-merge). Pending deploy; regression-only.\n  ✓ legacy showroom inbox still returns 200 (regression)\n  2 passed, 0 failed\n\nAlso: classify-message.test.ts + showroom-match-spec.test.ts pass; tsc --noEmit clean on all touched files; pnpm run build ✓; migration 0158 applied via pnpm run migrate:remote (6 idempotent statements tolerated) + columns/table verified on remote D1.",
      migrations: [
        {
          tag: "0158_famous_warpath",
          appliedRemote: true,
          note: "Applied via pnpm run migrate:remote; classification/is_spam/spam_rationale/deleted_at + gmail_message_images verified on remote D1.",
        },
      ],
    },
  },
  "0032-voice-mcp-keepalive": {
    slug: "0032-voice-mcp-keepalive",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 K1 · 15s SSE heartbeat on the MCP connector",
    code: [],
    problem:
      "MCP tools intermittently report 'down' during Claude real-time VOICE sessions while working fine in normal text chat. A voice session holds a long-lived SSE / streamable-HTTP socket to /mcp(/sse), but tool calls in voice are sparse — there can be tens of seconds of silence between them. A cellular-carrier NAT or iOS aggressively idle-kills a TCP socket that goes quiet, so the connection is dead by the time the next tool call needs it and the connector reads as 'down'. The connector's only keepalive is the `agents` library's ~30s SSE ping, which is slow enough to lose the race — the same class of failure PR #313 fixed for the a2a-v2 stream with a 15s heartbeat.",
    approach:
      "withSseHeartbeat wraps an MCP api-handler: it awaits the inner response and, ONLY when the response is text/event-stream, tees the body through a ReadableStream that splices a `: ping\\n\\n` SSE comment frame in every 15s (INTERVAL_MS, matching #313 and comfortably under the ~30s idle window). Comment lines (`:`-prefixed) are ignored by every SSE client per the spec, so the frame is invisible to the MCP protocol but resets the carrier/OS idle timer and keeps the socket warm through the quiet gaps. A non-SSE response (a normal JSON request/response tool call — the text-chat path) is returned verbatim, so the wrapper cannot regress normal-chat MCP. The splice uses a single ReadableStream controller for both the upstream pump and the setInterval tick — controller.enqueue() is synchronous and just appends to the internal queue, so there is no pending-write race the way a second WritableStream writer would have; the timer is cleared in the pump's finally and in cancel(). Both OAuthProvider apiHandlers (/mcp via serve, /mcp/sse via serveSSE) are wrapped in src/_worker.ts. It rules out transport idle-kill as the cause; if voice still drops, the remaining suspects (DO hibernation between calls, OAuth token expiry) are the next documented spike — not yet needed.",
    apiChanges: [
      "None. Transparent transport wrapper on the existing /mcp + /mcp/sse OAuth handlers; no new route, schema, or tool.",
    ],
    filesTouched: [
      "src/backend/mcp/sse-heartbeat.ts (new — withSseHeartbeat + FetchHandler)",
      "src/_worker.ts (wrap both OAuthProvider apiHandlers)",
      "src/frontend/data/changelog.ts + changelog-detail.ts, scripts/qc/pr_319.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "Why the socket dies in voice — and what the 15s heartbeat changes",
        code: `sequenceDiagram
  actor V as Claude voice session
  participant N as Carrier NAT / iOS
  participant W as /mcp/sse (connector)
  Note over V,W: WITHOUT heartbeat
  V->>W: open SSE stream
  W-->>V: tool result
  Note over N: 30s+ silence between calls
  N--xW: idle-kill the quiet socket
  V->>W: next tool call → "MCP down"
  Note over V,W: WITH withSseHeartbeat (15s)
  V->>W: open SSE stream
  loop every 15s
    W-->>V: ": ping" comment frame (ignored by client)
    Note over N: timer reset — socket stays warm
  end
  V->>W: next tool call → OK`,
      },
      {
        caption: "The wrapper is scoped to SSE — JSON tool calls pass through untouched",
        code: `flowchart TD
  R["MCP request → apiHandler"] --> I["inner.fetch()"]
  I --> C{"content-type<br/>text/event-stream?"}
  C -- "no (JSON tool call)" --> P["return response verbatim<br/>(text-chat path, no change)"]
  C -- "yes (SSE stream)" --> S["ReadableStream splice"]
  S --> T["setInterval 15s → enqueue ': ping'"]
  S --> U["pump: read upstream → enqueue chunks"]
  T --> O["heartbeat-spliced body"]
  U --> O
  classDef hb fill:#1f3a4d,stroke:#38bdf8,color:#e0f2fe;
  class S,T,U,O hb;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_319.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 319 -- --preview",
      ranAt: "2026-07-31",
      output:
        "tsc --noEmit clean on sse-heartbeat.ts + _worker.ts. pnpm run build green (exit 0, ~106s server build). No schema → no migration. QC pr_319 proves the wrapper didn't regress the surface: /mcp/sse + /mcp still respond through it (401 gated, not 404/5xx), the non-SSE OAuth metadata + token endpoints pass through untouched, and the legacy /api/mcp-docs catalog is unaffected. The 15s `: ping` itself fires only on an authenticated text/event-stream session (an OAuth grant not mintable in QC) and is verified live in a Claude voice session.",
      migrations: [],
    },
  },
  "0032-nav-multiwaypoint": {
    slug: "0032-nav-multiwaypoint",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 N1 · multi-waypoint send-to-car + reusable NavigateTeslaButton",
    code: [],
    problem:
      "The only way to route the car was the single-destination send_vehicle_navigation MCP tool + POST /api/tesla/navigate — no UI button anywhere, and no way to hand a whole planned drive (a multi-stop route) to the car at once. 0022 P5 asked for a reusable NavigateTeslaButton and a multi-waypoint 'send drive to car'.",
    approach:
      "Tessie's `share` command takes a single value and the Tesla Fleet `navigation_waypoints_request` (a signed command) isn't exposed through it — so sendMultiWaypointNavigation builds a Google Maps DIRECTIONS URL (destination + ordered waypoints, travelmode=driving) from the drive's stops and shares that one URL, which the car opens as a routed multi-stop trip; one waypoint degrades to the existing single-destination sendNavigation. The drive stops are resolved in sort order, skipping `skipped` stops and un-promoted `suggested` pitstops and any stop with no usable coordinates (its own, else its showroom's). REST POST /api/tesla/navigate-drive and MCP send_drive_to_tesla both call the one service (human + voice parity). The reusable NavigateTeslaButton picks its mode from props — single (lat/lng/destination/stopId) → /navigate, or driveListId → /navigate-drive — with an optimistic busy state + toast, and is wired onto the showroom hero (the store's coords) and the drive viewport header (the whole drive). Backend-only nav service, no schema. A native Fleet-API waypoints request is a documented follow-up.",
    apiChanges: [
      "NEW POST /api/tesla/navigate-drive { driveListId | slug } (admin-gated) → multi-waypoint send.",
      "NEW MCP send_drive_to_tesla (Tesla domain) — voice/chat twin.",
      "services/tesla.ts += sendMultiWaypointNavigation(env, waypoints).",
    ],
    filesTouched: [
      "src/backend/services/tesla.ts (sendMultiWaypointNavigation)",
      "src/backend/api/routes/tesla.ts (POST /navigate-drive)",
      "src/backend/mcp/tools/tesla/send_drive_to_tesla.ts (new) + tesla/index.ts",
      "src/frontend/components/tesla/NavigateTeslaButton.tsx (new)",
      "src/frontend/components/drives/DriveViewportApp.tsx + showroom/StoreViewportApp.tsx (wire the button)",
      "scripts/qc/pr_318.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "One button, two modes → one nav service",
        code: `flowchart TD
  B["NavigateTeslaButton"] -->|"lat/lng or stopId"| S["POST /api/tesla/navigate"]
  B -->|"driveListId"| D["POST /api/tesla/navigate-drive"]
  MCP1["send_vehicle_navigation"] --> S
  MCP2["send_drive_to_tesla"] --> D
  S --> N1["sendNavigation<br/>(Tessie share, single)"]
  D --> R["resolve ordered stops<br/>(skip skipped/suggested/no-coord)"]
  R --> M["sendMultiWaypointNavigation"]
  M -->|"1 stop"| N1
  M -->|"2+ stops"| N2["Google Maps directions URL<br/>→ Tessie share (maps-route)"]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_318.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 318 -- --preview",
      ranAt: "2026-07-31",
      output:
        "tsc --noEmit clean on all N1 files. pnpm run build green (exit 0, ~113s). No schema → no migration. QC pr_318 asserts the new /api/tesla/navigate-drive route is wired + send_drive_to_tesla in the MCP catalog + a regression on the single-destination /navigate route. The actual in-car multi-stop route (a Tessie share of the maps directions URL) needs live Tessie creds + a car and is exercised on a real drive.",
      migrations: [],
    },
  },
  "0032-park-finds-gemini": {
    slug: "0032-park-finds-gemini",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 D1 follow-up · Gemini relevance pass in the proximity scan",
    code: [],
    problem:
      "D1a's proximity scan gated remodel-relevance (decision D0) purely on the Google Places `includedTypes` filter — the deterministic, $0 stand-in the plan flagged for a Gemini upgrade. That filter is coarse: a mattress outlet or a generic big-box tagged `furniture_store` passes it, so a park there would stage a low-value park-find, and the card's category/one-liner were mechanical (a template off the Places type).",
    approach:
      "A best-effort Gemini pass (`assessRemodelRelevance`) via the shared `generateStructured` service — Gemini-2.5-flash first, Kimi fallback, auto-logged to `gemini_usage_log` under feature `proximity_scan_relevance`. It takes the chosen candidate (name, Places types, address, rating) and returns a typed `{ isRemodelRelevant, category, oneLiner }` (JSON response schema). A confident `isRemodelRelevant=false` skips staging (new reason `not-relevant`) — the precision the type filter can't give; otherwise the AI `category` + `oneLiner` replace the Places-type guess on the candidate, and the full verdict is stored in `proximity_scan_json.aiRelevance` for the receipts. It is strictly additive to cost-safety: the call is wrapped in a 10s `Promise.race` timeout and a catch that returns null, on which the scan falls back to the original deterministic Places heuristic — so a Gemini outage, timeout, or bad parse never blocks a park-find, and the whole scan still runs off `waitUntil` and never throws.",
    apiChanges: [
      "None. Internal to proximityScan; the AI category/one-liner surface on the existing Park-Finds card with no frontend change.",
    ],
    filesTouched: [
      "src/backend/services/tesla/proximity-scan.ts (assessRemodelRelevance + RELEVANCE_SCHEMA + wiring)",
      "src/frontend/data/changelog.ts + changelog-detail.ts, scripts/qc/pr_314.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "Two-stage relevance — coarse Places filter, then the Gemini precision gate",
        code: `flowchart TD
  A[PARK · 1.a-1.c missed] --> B[Places searchNearby<br/>includedTypes = remodel types]
  B --> C{candidate not known /<br/>excluded / queued?}
  C -- no --> Z[stop]
  C -- yes --> D[Gemini assessRemodelRelevance<br/>10s timeout · best-effort]
  D -- "null (timeout/err)" --> E[fall back to Places-type heuristic]
  D -- "isRemodelRelevant = false" --> Z2[skip · reason not-relevant]
  D -- "true (+category, oneLiner)" --> F[stage hitl candidate<br/>AI category + one-liner]
  E --> F
  classDef ai fill:#3a2a3f,stroke:#c084fc,color:#f5e8ff;
  class D,E ai;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_314.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 314 -- --preview",
      ranAt: "2026-07-30",
      output:
        "tsc --noEmit clean on proximity-scan.ts. pnpm run build green (exit 0, ~100s). Backend-only — no schema, no migration, no new endpoint. QC pr_314 is a regression on the D1a /api/showroom-hitl-queue sink the scan writes into; the Gemini pass itself fires only on a live park at an unregistered place (not synthesizable in QC) and is fail-safe (null → Places heuristic).",
      migrations: [],
    },
  },
  "0032-park-finds-page": {
    slug: "0032-park-finds-page",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 D1b · Park-Finds workspace (discovery review inbox)",
    code: [],
    problem:
      "D1a shipped the proximity-scan HITL queue (showroom_store_hitl_queue) + the REST/MCP surface to decide candidates, but the only way to review a park-find was over MCP or raw API. The user needs a workspace — see what the car discovered, and approve or reject each in one place.",
    approach:
      "A thin Astro shell (/admin/shopping/showrooms/hitl.astro, mirroring the Visit Logs page — class not className, container mx-auto px-4 py-8 pb-12, header with a 24px inline Telescope glyph) mounts a ParkFindsApp React island that reads GET /api/showroom-hitl-queue and splits candidates into two tabs: Awaiting review (TBD) and Decided. Each card shows the guessed name, a category chip, the AI one-liner, the drive it was found on (JOINed title, never denormalized), a one-marker mini-map (reusing the lazy DriveMapThumb), and the scan distance parsed from proximity_scan_json. TBD cards carry three actions built on the ProductPhotoHitl busy→POST→toast→refetch pattern: Add to directory (decide PROCESS → promotes to a real showroom_stores row), Not relevant (decide DO_NOT_PROCESS + addExclusion), and Decide later (local dismiss, no server call). The sidebar gains a Park-Finds entry under Showrooms with a live TBD-count badge — AdminSidebar fetches the count, threads parkFindsPendingCount down through the nested nav group, and refreshes it on a 'park-finds-updated' window event fired after each decision. Frontend only: no schema, API, or MCP change — it's the human surface over D1a's shared hitl-queue service, so it and decide_park_find stay in lockstep.",
    apiChanges: [
      "None. Consumes the existing D1a endpoints: GET /api/showroom-hitl-queue (+ ?decision=TBD) and POST /api/showroom-hitl-queue/:id/decide.",
    ],
    filesTouched: [
      "src/frontend/pages/admin/shopping/showrooms/hitl.astro (new)",
      "src/frontend/components/park-finds/ParkFindsApp.tsx + ParkFindCard.tsx + api.ts + types.ts (new)",
      "src/frontend/components/sidebar/nav-groups.ts (Park-Finds entry) + AdminSidebar.tsx (TBD-count badge wiring)",
      "src/frontend/data/changelog.ts + changelog-detail.ts, scripts/qc/pr_302.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "The review loop — read the queue, decide a card, refetch + poke the badge",
        code: `sequenceDiagram
  participant U as User
  participant P as ParkFindsApp
  participant R as /api/showroom-hitl-queue
  participant S as hitl-queue service
  U->>P: open /admin/shopping/showrooms/hitl
  P->>R: GET (list candidates + pending count)
  R-->>P: { candidates, pending }
  U->>P: Add to directory / Not relevant
  P->>R: POST /:id/decide
  R->>S: PROCESS → showroom_stores (+re-point visit/detour)<br/>DO_NOT_PROCESS → exclusion
  S-->>P: { ok, storeId? / exclusionId? }
  P->>R: refetch list
  P->>P: dispatch 'park-finds-updated' → sidebar badge updates`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_302.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 302 -- --preview",
      ranAt: "2026-07-29",
      output:
        "tsc --noEmit clean on all new park-finds files + the AdminSidebar/nav-groups changes. pnpm run build green (exit 0, Server built in ~92s). Frontend-only — no schema/API/MCP change, so no migration. QC pr_302 checks the /admin/shopping/showrooms/hitl page route + a regression on the D1a /api/showroom-hitl-queue endpoint it consumes (the authed run needs the tokens CLI / a real cookie, so from an unauthenticated sandbox it asserts route existence, not the gated body).",
      migrations: [],
    },
  },
  "0032-park-finds-discovery": {
    slug: "0032-park-finds-discovery",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 D1a · proximity scan + Park-Finds HITL discovery queue",
    code: [],
    problem:
      "The park pipeline could only stage a visit when a park matched a registered showroom (decision 1.c) or a stop on the active drive (1.b). Park somewhere new — a tile yard you'd never logged — and nothing happened: no capture, no prompt, no discovery. The 0022 plan's decision 1.d closes that, but doing it safely is the hard part: you must NOT invent a showroom_stores row from a Places guess (that poisons the directory, budget takeoffs, and comparisons, and nothing downstream can tell it was a guess — the AGENTS.md 'resolve an ambiguous parent' rule). It has to be staged for a human, and the spend has to be bounded so a park can't run up a Places bill.",
    approach:
      "On a confirmed PARK where 1.a–1.c all miss, ingestViaDetector runs proximityScan (services/tesla/proximity-scan.ts): a single Google Places searchNearby restricted to remodel-relevant includedTypes (furniture/home-goods/hardware/home-improvement — so a gas station never surfaces; this is the deterministic, $0 stand-in for the plan's Gemini relevance gate, which is a documented follow-up), then dedupe the best candidate against registered stores (by place_id), the exclusion set, and the open TBD queue. A survivor is STAGED as three linked writes — a showroom_store_hitl_queue candidate (TBD), a detour stop on the active drive (is_detour → the candidate), and a discovery soft arrival (showroom_visit_log with hitl_queue_id and no store_id, XOR-ok while unconfirmed) — and the park_sessions row is linked to the find. A human (Park-Finds page, D1b) or a chat (MCP) then decides: PROCESS promotes the candidate to a real showroom_stores row (flagged is_identified_by_proximity_scan, or links an existing store by place_id) and re-points the visit + detour stop at it; DO_NOT_PROCESS rejects it and can drop a showroom_exclusions row so it never re-surfaces. Cost is bounded structurally: the detector emits 'park' exactly once per park, so the scan runs once; it's gated by tesla_proximity_scan_enabled AND placesNearby's own per-SKU quota hard-disable (returns [] when the Places bucket is spent). REST (/api/showroom-hitl-queue) and MCP (list_park_finds/decide_park_find) both go through the one hitl-queue service, so the page and the voice loop decide identically.",
    apiChanges: [
      "NEW REST /api/showroom-hitl-queue (admin-gated): GET / (list + ?decision=TBD|PROCESS|DO_NOT_PROCESS + pending count), GET /:id, POST /:id/decide { decision, addExclusion?, reasonMarkdown? }.",
      "NEW MCP list_park_finds (READ_ONLY) + decide_park_find (WRITE) in the showrooms domain — 2 tools added to the registry.",
      "No change to existing routes; the proximity scan is internal (runs off waitUntil on the detector's PARK).",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/store_hitl_queue.ts + exclusions.ts (new) + showroom/index.ts (barrel)",
      "src/backend/db/schema/showroom/visit_log.ts, showroom/stores.ts, drives/drive_lists.ts, drives/drive_list_stops.ts, system/park-sessions.ts (column adds)",
      "src/backend/services/tesla/proximity-scan.ts (new — decision 1.d)",
      "src/backend/services/showroom/hitl-queue.ts (new — shared list/decide service)",
      "src/backend/services/location/ingest.ts (wire 1.d into ingestViaDetector)",
      "src/backend/api/routes/showroom-hitl-queue.ts (new) + api/index.ts (mount)",
      "src/backend/mcp/tools/showrooms/list_park_finds.ts + decide_park_find.ts (new) + showrooms/index.ts",
      "drizzle/0153_wealthy_mephistopheles.sql, scripts/qc/pr_301.mjs",
    ],
    migrations: [
      {
        tag: "0153_wealthy_mephistopheles",
        sql: "CREATE TABLE showroom_store_hitl_queue ( id INTEGER PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text, latitude real, longitude real, place_id text, store_id integer REFERENCES showroom_stores(id) ON DELETE set null, user_decision text DEFAULT 'TBD' NOT NULL, drive_list_id integer REFERENCES drive_lists(id) ON DELETE set null, proximity_scan_json text, category_guess text, created_at integer DEFAULT (unixepoch()) NOT NULL, updated_at integer DEFAULT (unixepoch()) NOT NULL );\nCREATE TABLE showroom_exclusions ( id INTEGER PRIMARY KEY AUTOINCREMENT, place_id text, name text, latitude real, longitude real, reason_markdown text, reason_html text, source text DEFAULT 'manual' NOT NULL, created_at integer DEFAULT (unixepoch()) NOT NULL, updated_at integer DEFAULT (unixepoch()) NOT NULL );\nALTER TABLE park_sessions ADD hitl_queue_id integer REFERENCES showroom_store_hitl_queue(id);\nALTER TABLE showroom_stores ADD is_identified_by_proximity_scan integer DEFAULT false NOT NULL;\nALTER TABLE showroom_stores ADD proximity_scan_json text;\nALTER TABLE showroom_visit_log ADD hitl_queue_id integer REFERENCES showroom_store_hitl_queue(id);\nALTER TABLE drive_list_stops ADD is_detour integer DEFAULT false NOT NULL;\nALTER TABLE drive_list_stops ADD hitl_queue_id integer REFERENCES showroom_store_hitl_queue(id);\nCREATE UNIQUE INDEX showroom_exclusions_place_uniq ON showroom_exclusions (place_id) WHERE \"showroom_exclusions\".\"place_id\" IS NOT NULL;\n-- + supporting indexes on decision/place/drive/hitl_queue.",
      },
    ],
    diagrams: [
      {
        caption: "The park decision tree — 1.d is the new branch (parked near nothing known)",
        code: `flowchart TD
  P[PARK EVENT<br/>from any source] --> A{1.a home/work?}
  A -- yes --> AP[pause active drives] --> Z[stop]
  A -- no --> B{1.b stop on<br/>active drive?}
  B -- yes --> BS[soft arrival · store_id] --> W[await DRIVE-AWAY]
  B -- no --> C{1.c near a<br/>registered showroom?}
  C -- yes --> CS[soft arrival · store_id] --> W
  C -- no --> D[["1.d proximityScan (NEW)"]]
  D --> D0{remodel-relevant<br/>Places hit, not known/excluded?}
  D0 -- no --> Z
  D0 -- yes --> D1[hitl_queue candidate · TBD]
  D1 --> D2[detour stop · is_detour]
  D2 --> D3[discovery soft arrival · hitl_queue_id]
  D3 --> W
  classDef n fill:#3b2f0b,stroke:#fbbf24,color:#fff7e0;
  class D,D0,D1,D2,D3 n;`,
      },
      {
        caption: "New tables + the columns that point at a park-find candidate",
        code: `erDiagram
  showroom_store_hitl_queue {
    int id PK
    text name
    text description "AI one-liner"
    real latitude
    real longitude
    text place_id "dedupe key"
    int store_id FK "on approve"
    text user_decision "TBD|PROCESS|DO_NOT_PROCESS"
    int drive_list_id FK
    text proximity_scan_json
    text category_guess
  }
  showroom_exclusions {
    int id PK
    text place_id "match key (partial-unique)"
    text name
    text reason_markdown
    text source "manual|ai"
  }
  showroom_store_hitl_queue |o--o| showroom_stores : "approve → store"
  showroom_store_hitl_queue ||--o{ showroom_visit_log : "discovery visit (hitl_queue_id)"
  showroom_store_hitl_queue |o--o{ drive_list_stops : "detour (is_detour)"
  showroom_store_hitl_queue |o--o| park_sessions : "park resolved to find"`,
      },
      {
        caption:
          "Scan → stage → decide (one Places call per park; the decision promotes or excludes)",
        code: `sequenceDiagram
  participant DET as park-detector
  participant ING as ingestViaDetector
  participant PS as proximityScan
  participant GP as Google Places
  participant DB as D1
  DET->>ING: PARK event
  ING->>ING: stageSoftArrival → no-showroom-nearby
  ING->>PS: proximityScan(lat,lng)
  PS->>GP: searchNearby (remodel types, quota-gated)
  GP-->>PS: candidates
  PS->>DB: dedupe vs stores / exclusions / open queue
  PS->>DB: hitl_queue (TBD) + detour stop + discovery visit
  Note over DB: later — human or MCP decides
  DB->>DB: PROCESS → showroom_stores + re-point visit/detour
  DB->>DB: DO_NOT_PROCESS → optional exclusion`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_301.mjs",
      command:
        "npx tsc --noEmit  &&  pnpm run build  &&  node <scratch>/d1test  &&  pnpm run test:pr 301 -- --preview",
      ranAt: "2026-07-29",
      output:
        "tsc --noEmit clean on all touched D1a files (the only tsc errors are the pre-existing 'visits' ToolCategory baseline from #290, untouched here). pnpm run build green (exit 0, Server built in ~94s). " +
        "db:generate produced 0153_wealthy_mephistopheles.sql — 2 CREATE TABLE + 6 additive ADD COLUMN + indexes incl. the partial-unique showroom_exclusions_place_uniq; the drive_lists.status 'paused' widen correctly emits NO SQL (TEXT column). " +
        "The migration's risky statements (inline-REFERENCES ADD COLUMN, the table-qualified partial-unique WHERE) were validated on a scratch SQLite via node:sqlite — all applied, and the partial index correctly allowed 1 place_id row + 2 NULLs. QC pr_301 asserts the new /api/showroom-hitl-queue surface + the two MCP tools in the catalog + a visit-logs/tesla regression (a live proximity scan needs a real park at an unregistered place, exercised on a drive, not synthesizable in QC). " +
        "Codra approved (no blocking issues); applied its substantive off-diff findings: dedup queries now filter by candidate place_ids (was full-scanning three tables per park — dead-variable bug), decideHitlCandidate is now truly idempotent (early short-circuit on an already-decided candidate), countPending uses count(*), and FK indexes were added on hitl_queue.store_id + park_sessions.hitl_queue_id (migration 0154). Re-ran tsc + build green after the fixes.",
      migrations: [
        {
          tag: "0153_wealthy_mephistopheles",
          appliedRemote: false,
          note: "Applies on the D1a deploy's migrate:remote step (run_migrations:true) — additive/nullable, so concurrent branch previews keep working against the shared D1. A failed CREATE TABLE fails the deploy.",
        },
        {
          tag: "0154_closed_centennial",
          appliedRemote: false,
          note: "FK indexes on park_sessions.hitl_queue_id + showroom_store_hitl_queue.store_id (codra follow-up). Additive; applies on the same deploy.",
        },
      ],
    },
  },
  "0032-park-dwell-detector": {
    slug: "0032-park-dwell-detector",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 L1 · source-agnostic park/dwell detector + park_sessions",
    code: [],
    problem:
      "L0 let any source stage a visit, but only the 500ms streaming DO could detect a PARK (a shift-into-P edge) and a DRIVE-AWAY (P→moving) to open and close a visit automatically. The 120s poller only checked off stops — it never staged a soft arrival and had no way to fire a drive-away, so a poll-only drive (the whole point of turning the billable stream off) couldn't capture a visit's dwell.",
    approach:
      "A source-agnostic detector (services/location/park-detector.ts) turns a per-subject fix stream into PARK / DRIVE-AWAY events two ways: when a gear is present (Tesla) it's edge-triggered on the shiftState transition (instant, precise); when it isn't (phone/AI) it falls back to a dwell heuristic — successive fixes within PARK_RADIUS_M for ≥ DWELL_MIN is a park, and moving > DEPART_RADIUS_M from the park anchor is a drive-away. Hot state lives in KV (loc:detector:<subjectId>) — self-replacing, never a growing table (the $700-runaway lesson) — and a confirmed park also writes a park_sessions row so an in-flight visit survives a worker eviction (the KV state can be rebuilt from the open row). Thresholds read from the C1 config keys with defaults. The poller is wired ADDITIVELY: its proven matchAndMarkVisited + home-arrival logic is untouched, and a new best-effort ingestViaDetector call gives it detector-driven staging + finalize. The streaming DO keeps its in-memory shift detection — rewiring it onto the shared detector is a documented follow-up (it already works, so no reason to risk the live socket path in this PR). Concurrency: state is per-subject and a single car/phone doesn't emit concurrent fixes (the poller stands down while the stream carries), so the KV read-modify-write needs no locking — documented per plan §11.",
    apiChanges: [
      "None external. New internal services: park-detector (processFix / open+settle park_sessions / linkVisitToParkSession) and ingest.ingestViaDetector.",
    ],
    filesTouched: [
      "src/backend/db/schema/system/park-sessions.ts (new) + schema/index.ts (barrel)",
      "src/backend/services/location/park-detector.ts (new — the FSM + KV state + park_sessions lifecycle)",
      "src/backend/services/location/ingest.ts (+ingestViaDetector)",
      "src/backend/services/tesla-poller.ts (additive detector feed)",
      "drizzle/0149_eager_bishop.sql, scripts/qc/pr_297.mjs",
    ],
    migrations: [
      {
        tag: "0149_eager_bishop",
        sql: "CREATE TABLE park_sessions ( id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id text NOT NULL, drive_list_id integer REFERENCES drive_lists(id) ON DELETE set null, stop_id integer REFERENCES drive_list_stops(id) ON DELETE set null, store_id integer REFERENCES showroom_stores(id) ON DELETE set null, latitude real, longitude real, source text NOT NULL, parked_at integer DEFAULT (unixepoch()) NOT NULL, departed_at integer, dwell_seconds integer, status text DEFAULT 'parked' NOT NULL, visit_log_id integer REFERENCES showroom_visit_log(id) ON DELETE set null, created_at integer DEFAULT (unixepoch()) NOT NULL, updated_at integer DEFAULT (unixepoch()) NOT NULL );\nCREATE INDEX park_sessions_subject_idx ON park_sessions (subject_id);\nCREATE INDEX park_sessions_status_idx ON park_sessions (status);\nCREATE UNIQUE INDEX park_sessions_one_open_uniq ON park_sessions (subject_id) WHERE \"park_sessions\".\"status\" = 'parked';",
      },
    ],
    diagrams: [
      {
        caption: "The detector state machine — one path with a gear, one without",
        code: `stateDiagram-v2
  direction LR
  [*] --> MOVING
  MOVING --> SETTLING : stopped (speed≈0)
  SETTLING --> MOVING : moved > PARK_RADIUS_M<br/>(discarded)
  SETTLING --> PARKED : dwell ≥ DWELL_MIN<br/>→ PARK EVENT
  MOVING --> PARKED : shiftState → P<br/>→ PARK EVENT (instant)
  PARKED --> MOVING : shiftState P→drive<br/>OR moved > DEPART_RADIUS_M<br/>→ DRIVE-AWAY EVENT
  PARKED --> PARKED : still parked (no event)`,
      },
      {
        caption: "park_sessions — the durable anchor, keyed on subject (vin | phone | ai)",
        code: `erDiagram
  park_sessions {
    int id PK
    text subject_id "vin | phone | ai"
    int drive_list_id FK
    int store_id FK
    real latitude
    real longitude
    text source
    int parked_at
    int departed_at "null while open"
    int dwell_seconds
    text status "parked|settled|discarded"
    int visit_log_id FK "the staged visit"
  }
  park_sessions ||--o| showroom_visit_log : "stages"
  park_sessions }o--o| drive_lists : "during"
  park_sessions }o--o| showroom_stores : "at"`,
      },
      {
        caption: "The poller gains the full lifecycle — additively",
        code: `flowchart LR
  POLL["tesla-poller (120s)"] --> M["matchAndMarkVisited<br/>(existing, untouched)"]
  POLL --> H["home/work check<br/>(existing, untouched)"]
  POLL --> D[["ingestViaDetector (NEW)"]]
  D --> DET["park-detector<br/>KV state + park_sessions"]
  DET -->|PARK| S["stageSoftArrival"]
  DET -->|DRIVE-AWAY| F["finalizeSoftArrivals"]
  classDef n fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_297.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 297 -- --preview",
      ranAt: "2026-07-29",
      output:
        "tsc --noEmit clean on the new detector + schema + ingest + poller. pnpm run build green (exit 0). " +
        "db:generate produced 0149_eager_bishop.sql — exactly one CREATE TABLE park_sessions + the partial-unique " +
        "index (WHERE status='parked'), verified. QC pr_297: regression on tesla status + visit-logs and that the " +
        "poll path still self-gates after the additive detector wiring (a real park/drive-away is exercised on a live " +
        "poll-only drive, not synthesizable in QC). The dwell FSM is unit-reasoned in the detector.",
      migrations: [
        {
          tag: "0149_eager_bishop",
          appliedRemote: true,
          note: "Applied via the deploy's migrate:remote step (run_migrations:true); a failed CREATE TABLE fails the deploy.",
        },
      ],
    },
  },
  "0032-locationfix-ingress": {
    slug: "0032-locationfix-ingress",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 L0 · the source-agnostic location ingress",
    code: [],
    problem:
      "Visit capture was welded to the Tesla streaming DO: only a 500ms telemetry frame that transitioned into Park could stage a soft arrival. A phone GPS ping, an AI-supplied coordinate, or a manual 'I'm here' had no way to drive the same pipeline — so the whole feature depended on a billable always-on socket, exactly the coupling the user asked to remove ('make it work off Tessie poll / phone / AI').",
    approach:
      "One seam: a source-agnostic LocationFix ({lat,lng,when,source,shiftState?,…}) and one ingestLocationFix(env, fix) that records provenance then runs the SAME park pipeline the DO already runs — matchAndMarkVisited (check off a drive stop) → maybeEndActiveDriveOnHomeArrival (home/work ends the drive) → stageSoftArrival (near a registered showroom on the active drive). It never auto-navigates, so a stray phone ping can't command the car. Wired the NEW discrete sources through it: POST /api/tesla/manual-here (manual), MCP report_location (ai → persisted to device_location source=ai for auditability), and the existing /device-location route now additively runs the pipeline in the background (waitUntil; record:false + skipHomeArrival:true so nothing double-writes or double-ends). Deliberately did NOT rewire the live streaming DO or the 120s poller — safely unifying them needs the dwell/park DETECTOR (L1) that tracks prior state to fire a drive-away; doing it here would risk the live park pipeline with no detector to close the dwell. No new table, no migration — provenance reuses device_location (free-text source column).",
    apiChanges: [
      "NEW POST /api/tesla/manual-here — a manual location fix runs the park pipeline; returns the IngestResult.",
      "NEW MCP report_location (ai source) — reports a coordinate, stages a visit, records device_location source=ai. 122 tools.",
      "CHANGED POST /api/showroom-stores/device-location — same response, now also runs the pipeline in the background.",
    ],
    filesTouched: [
      "src/backend/services/location/ingest.ts (new — LocationFix + ingestLocationFix)",
      "src/backend/services/tesla/visit-sessions.ts (widen GpsSource union to the full enum)",
      "src/backend/api/routes/tesla.ts (+POST /manual-here)",
      "src/backend/api/routes/showroom-stores.ts (device-location → additive background ingest)",
      "src/backend/mcp/tools/tesla/report_location.ts (new) + tesla/index.ts (register)",
      "scripts/qc/pr_295.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "Every source normalizes to one LocationFix and calls one ingress",
        code: `flowchart LR
  P["phone · /device-location"] --> ING[[ingestLocationFix]]
  A["ai · report_location MCP"] --> ING
  M["manual · /api/tesla/manual-here"] --> ING
  ST["tesla-stream DO"] -.->|rewired in L1| ING
  PO["tesla-poll 120s"] -.->|rewired in L1| ING
  ING --> REC["record provenance<br/>device_location (phone/ai/manual)"]
  ING --> MAT["matchAndMarkVisited<br/>(check off stop, no auto-nav)"]
  ING --> HOME["home/work → end drive"]
  ING --> STG["stageSoftArrival<br/>near a showroom on the active drive"]
  classDef dim fill:#1e293b,stroke:#475569,color:#94a3b8;
  class ST,PO dim`,
      },
      {
        caption:
          "L0 lands the ingress + discrete sources; L1 adds the detector then rewires the live paths",
        code: `flowchart TD
  L0["L0 · ingress + phone/ai/manual<br/>(this PR — no migration)"] --> L1["L1 · park/dwell detector<br/>+ park_sessions (migration)<br/>+ rewire DO & poller"]
  L1 --> DONE["all sources unified<br/>+ automatic drive-away from any source"]
  classDef done fill:#1f4d2e,stroke:#4ade80,color:#e2e8f0;
  class L0 done`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_295.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 295 -- --preview",
      ranAt: "2026-07-27",
      output:
        "tsc --noEmit clean on the new ingress + visit-sessions + tesla route + showroom-stores route + the report_location tool. " +
        "pnpm run build green (exit 0). Tool count → 122 (+report_location). No schema change → no migration. " +
        "QC pr_295 (committed): regression on tesla status + visit-logs, the new /api/tesla/manual-here (200 + IngestResult; an " +
        "offshore fix records but matches/stages nothing), and that the additive ingest left /device-location's response shape intact. " +
        "Writes gated preview-only (each records a device_location fix). Runs against preview then prod after deploy.",
      migrations: [],
    },
  },
  "0032-tesla-location-config": {
    slug: "0032-tesla-location-config",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 C1 · Tesla location & proximity config",
    code: [],
    problem:
      "The source-agnostic park detector (L1) and the proximity scan (D1) both need configuration the user can set: where home and work are (so a park there pauses a drive instead of staging a visit), how close counts as 'at' a showroom, how long a stop must last to register, and whether to spend Places quota scanning for undiscovered showrooms on an unexpected park. None of it was settable — the keys existed only in the plan.",
    approach:
      "A /admin/config/tesla page in ConfigShell, three cards, over existing endpoints (no schema, no new API). Recording reuses the EXISTING tesla_telemetry_recording_enabled flag via PATCH /api/config/tesla — the same flag the integrations page toggles, so there is one source of truth and no split-brain (the spec's tesla_record_telemetry key was never implemented; reusing the real one is the right call). Home & Work use a new GeocodeAddressField that resolves a typed address to coordinates through the /api/places autocomplete+details proxy; 'use project address as home' pulls the primary property's already-geocoded coords from /api/admin/properties. Proximity & dwell writes the tesla_* / loc_* numeric + boolean keys as KV into project_system_variables through the batch-safe POST /api/admin/config (the route that was once broken by db.transaction() and is now db.batch()).",
    apiChanges: [
      "None — frontend only. Reads/writes GET+POST /api/admin/config, GET+PATCH /api/config/tesla, GET /api/admin/properties, GET /api/places/autocomplete + /details.",
    ],
    filesTouched: [
      "src/frontend/components/config/TeslaLocationConfigApp.tsx (new — the 3-card island)",
      "src/frontend/components/config/GeocodeAddressField.tsx (new — Places address→coords)",
      "src/frontend/pages/admin/config/tesla.astro (new)",
      "src/frontend/components/config/config-nav.ts (+Tesla Location under Integrations)",
      "scripts/qc/pr_293.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption:
          "Two config stores, one page — recording reuses the existing flag; location is new KV",
        code: `flowchart TD
  PAGE["/admin/config/tesla (3 cards)"] --> REC[Recording card]
  PAGE --> HW[Home & Work card]
  PAGE --> PX[Proximity & dwell card]
  REC -->|PATCH| CT["/api/config/tesla<br/>tesla_telemetry_recording_enabled"]
  HW -->|autocomplete+details| PL["/api/places proxy → coords"]
  HW -->|use project address| PR["/api/admin/properties"]
  HW -->|POST| AC["/api/admin/config (KV, db.batch)"]
  PX -->|POST| AC
  AC --> DB[(project_system_variables)]
  classDef n fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;`,
      },
      {
        caption: "The config keys and what reads them (L1/D1, next passes)",
        code: `flowchart LR
  subgraph KEYS["tesla_* / loc_* KV"]
    A[tesla_home_lat/lng<br/>tesla_work_lat/lng]
    B[tesla_home_work_radius_m 150]
    C[tesla_proximity_radius_m 250]
    D[loc_dwell_min_seconds 300]
    E[loc_park_radius_m 60<br/>loc_depart_radius_m 120]
    F[tesla_location_stale_seconds 300]
    G[tesla_proximity_scan_enabled]
  end
  A --> L1[park detector · L1]
  B --> L1
  D --> L1
  E --> L1
  F --> L1
  C --> D1[proximity scan · D1]
  G --> D1`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_293.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 293 -- --preview",
      ranAt: "2026-07-27",
      output:
        "tsc --noEmit clean on the new config components + page + config-nav (filtered from the pre-existing baseline). " +
        "pnpm run build green (exit 0) — the deploy gate for a frontend PR. No schema change → no migration. " +
        "QC pr_293 (committed): regression on the endpoints the page reads (config KV, /api/config/tesla, primary property), " +
        "the new SSR page render (200 on preview; 404-on-prod = pending), and a PREVIEW-ONLY config KV write round-trip " +
        "(scratch key written, read back, blanked — prod config never polluted). Runs against preview then prod after deploy.",
      migrations: [],
    },
  },
  "0032-visit-logs-workspace": {
    slug: "0032-visit-logs-workspace",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 V2c · the Visit Logs workspace (frontend)",
    code: [],
    problem:
      "V1 shipped the schema, V2a the REST CRUD, V2b the MCP twins through one shared service. There was still no human surface: staged visits (a Tesla soft-arrival, an AI-staged note) had nowhere to be reviewed or finalized, and a store's visit history wasn't visible in its viewport. The point of running off many location sources — knowing HOW each visit was captured and how far the fix was — was invisible.",
    approach:
      "Build the workspace on the existing REST + service (no new API, no schema). Shared components first (src/frontend/components/visits/): status/type/source chips (SourceBadge maps the REAL gps_source enum, so provenance is legible), a shared StarRating, a ShowroomAutocomplete (ComboboxWithOther; OTHER creates a bare store), a controlled VisitLogEditor (PlateJS notes → md+html, segmented engagement control, arrival/departure), and a GpsEvidence panel reusing DriveMapThumb for the one-marker fix map. Then the pages: a list with Pending (anything not SUBMITTED) vs Completed tabs, a detail/finalize view (evidence + editor + this-store timeline + sticky Save-draft/Submit/Delete bar), and a manual create page (gps_source=manual). The store viewport gains a 'visits' SectionKey + bento tile whose section floats pending visits to the top with a finalize nudge, then history — reading the admin-gated ?storeId= filter (not a new ungated store sub-route). Sidebar 'Visit Logs' entry. Fixed a latent drift found along the way: the store [section].astro allow-list omitted 'contacts', so /store/:id/contacts silently fell back.",
    apiChanges: [
      "None — frontend only. Reads GET /api/showroom-visit-logs (+ ?status, ?storeId) and GET/POST /api/showroom-stores, all live since V2a/V2b.",
    ],
    filesTouched: [
      "src/frontend/components/visits/* (new — types, api, Badges, StarRating, ShowroomAutocomplete, VisitLogEditor, GpsEvidence, VisitCard, VisitLogsListApp, VisitLogDetailApp, VisitLogNewApp, StoreVisitsSection)",
      "src/frontend/pages/admin/shopping/showrooms/visitlogs.astro, visitlogs/[id].astro, visitlogs/new.astro (new)",
      "src/frontend/components/showroom/StoreViewportApp.tsx (+visits SectionKey, bento tile, render branch)",
      "src/frontend/pages/admin/shopping/store/[id]/[section].astro (allow-list: +contacts +visits)",
      "src/frontend/components/sidebar/nav-groups.ts (+Visit Logs entry), scripts/qc/pr_292.mjs",
    ],
    migrations: [],
    diagrams: [
      {
        caption:
          "Workspace IA — one service, three pages + the store section, all reading the V2a/V2b surface",
        code: `flowchart TD
  NAV[Sidebar · Visit Logs] --> LIST["/visitlogs (list)<br/>Pending | Completed"]
  LIST --> DET["/visitlogs/:id<br/>evidence + finalize"]
  LIST --> NEW["/visitlogs/new<br/>manual create"]
  STORE[Store viewport] --> SEC["visits section<br/>?storeId= filter"]
  DET --> API[[/api/showroom-visit-logs]]
  NEW --> API
  SEC --> API
  LIST --> API
  API --> S[[shared visit-log service]]
  S --> DB[(showroom_visit_log)]
  classDef n fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;`,
      },
      {
        caption: "A staged visit's lifecycle through the finalize UI",
        code: `stateDiagram-v2
  [*] --> PENDING: TESLA_SOFT_ARRIVAL / AI_STAGED / TESLA_STAGED / DRAFT
  PENDING --> PENDING: Save draft (status DRAFT)
  PENDING --> SUBMITTED: Submit (rating + notes + store bound)
  SUBMITTED --> [*]
  PENDING --> [*]: Delete`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_292.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 292 -- --preview",
      ranAt: "2026-07-27",
      output:
        "tsc --noEmit clean on the new visits/ surface + StoreViewportApp + nav-groups (filtered from the pre-existing baseline). " +
        "pnpm run build green (server 113s, client + prerender ✓, exit 0) — the deploy gate for a frontend PR. " +
        "No schema change → no migration. QC pr_292 (committed) exercises: regression on the data endpoints the workspace consumes (visit-logs pending/completed + store directory + ?storeId=), the new SSR pages (200 on preview; 404-on-prod reported as pending merge/deploy), and a full create→get→submit→delete round-trip through the same REST the pages drive. Runs against preview then prod after deploy.",
      migrations: [],
    },
  },
  "0032-visit-log-mcp-crud": {
    slug: "0032-visit-log-mcp-crud",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 V2b · MCP CRUD twins + the one shared service",
    code: [],
    problem:
      "V2a shipped the visit-log REST routes with their DB logic inline. The voice loop needs the same operations as MCP tools — and if MCP re-implemented the queries, the two surfaces would drift (different defaults, different rating guards, the classic split-brain).",
    approach:
      "Extract services/showroom/visit-log.ts as the single path: list (pending/completed/by-store), get, create, update, delete — with the rating 1–5 guard (the API-layer replacement for the DB CHECK SQLite can't add) and dwell computation, store name JOINed on read. Refactor the REST route to delegate to it, then add a new MCP 'visits' domain whose 7 tools are thin wrappers over the SAME service: list/get/create/update/delete_visit_log, stage_showroom_visit (forces AI_STAGED — a draft from a voice note), finalize_visit_log (forces SUBMITTED). Registered in ALL_TOOL_GROUPS (121 tools; auto-renders on /connect/tools).",
    apiChanges: [
      "MCP: list/get/create/update/delete_visit_log, stage_showroom_visit, finalize_visit_log (category 'visits').",
      "REST /api/showroom-visit-logs unchanged externally — now delegates to the shared service.",
    ],
    filesTouched: [
      "src/backend/services/showroom/visit-log.ts (new — shared service)",
      "src/backend/api/routes/showroom-visit-logs.ts (delegate to service)",
      "src/backend/mcp/tools/visits/* (7 tools + _shared + index)",
      "src/backend/mcp/tools/index.ts (register visitTools)",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "REST + MCP through one service — no drift",
        code: `flowchart LR
  UI[Admin UI / REST client] --> R[/api/showroom-visit-logs]
  VOICE[Claude voice + MCP] --> M[visits domain: 7 tools]
  R --> S[[shared visit-log service: rating guard, dwell, JOIN]]
  M --> S
  S --> DB[(showroom_visit_log)]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_290.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 290 -- --preview",
      ranAt: "2026-07-27",
      output:
        "tsc --noEmit clean on the visits domain + service + route + tools/index.ts. " +
        "pnpm run build green. Tool count 114 → 121 (+7 visits). No schema change → no migration. " +
        "QC pr_290 runs the CRUD round-trip (create DRAFT → get → finalize → rating-999 rejected → delete).",
      migrations: [],
    },
  },
  "0038-sales-schema-phase-a": {
    slug: "0038-sales-schema-phase-a",
    branch: "claude/sales-clearance-page-b0c752",
    subtitle: "Sales & Clearance · Phase A of the 0038 overhaul (data spine)",
    introduction:
      "First slice of the /admin/shopping/sales rebuild. Additive-only: it lands the whole data model the later phases (scrape upgrade, cost-aware shopping triage, weekly PDF ad, frontend) hang off, and backfills existing data — but nothing reads the new rows yet, so it is safe to ship alone.",
    problem:
      "Clearance items were stored as a JSON blob: one showroom_store_sales row per page, with an items[] array of ClearanceItem inside clearanceDetailsJson. Because items were not rows, the page could not filter by color/size, attach per-item images, watch a single listing, diff a listing across weeks, or hang a deal score + agent insight off it. Every capability the overhaul wants is blocked on the same thing: the item needs to be a row.",
    approach:
      "Promote ClearanceItem to a real sale_items table and land the mapping/support tables around it, all additive (migration 0148, applied + verified on remote D1). Compliance is built in rather than retrofitted: prices are text+cents pairs, colors go through the shared colors definition + a sale_item_colors mapping (never a comma-joined string), category/type are FKs into the shared config categories/subcategories vocab with verbatim *_text kept only as a fallback when no id could be matched (FK-not-name), and rich text (damage notes, deal insight) is stored as markdown+html. Support tables: sale_cycles (anchors a sweep), sale_scrape_runs (per-source health, incl. failed/low_quality for the Scan Health page), sale_watch, sale_research_clusters (for the cost-aware triage), weekly_sale_ad. Two columns added to existing tables: showroom_stores.is_online_only (web-only clearance sources) and showroom_store_sales.page_markdown. Backfill: backfillSaleItems() reads every isCurrent snapshot, explodes items[] into sale_items with single-row inserts batched — sale_items is ~40 columns, so a multi-row insert would exceed D1's 100 bound-param cap — and is idempotent (skips fully-backfilled snapshots; wipes + re-inserts partial ones). It is invoked once via POST /api/showroom-sales/backfill (access-gated).",
    apiChanges: [
      "POST /api/showroom-sales/backfill (access-gated) — one-shot: explode isCurrent clearanceDetailsJson.items[] into sale_items rows. Idempotent; returns snapshotsSeen/backfilled/skipped + itemsInserted/itemsExpected.",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/sale_cycles.ts, sale_items.ts, sale_item_images.ts, sale_item_colors.ts, sale_watch.ts, sale_scrape_runs.ts, sale_research_clusters.ts, weekly_sale_ad.ts (new)",
      "src/backend/db/schema/showroom/sales.ts (+page_markdown), stores.ts (+is_online_only), index.ts (barrel)",
      "src/backend/services/showroom/sales-backfill.ts (new — backfillSaleItems)",
      "src/backend/api/routes/showroom-sales.ts (+POST /backfill)",
      "drizzle/0148_keen_vance_astro.sql, scripts/qc/pr_284.mjs, docs/0038_sales_clearance_overhaul/",
    ],
    migrations: [
      {
        tag: "0148_keen_vance_astro",
        sql: "CREATE TABLE sale_items ( id INTEGER PRIMARY KEY AUTOINCREMENT, sale_snapshot_id INTEGER NOT NULL REFERENCES showroom_store_sales(id) ON DELETE cascade, store_id INTEGER NOT NULL REFERENCES showroom_stores(id) ON DELETE cascade, ... brand_id INTEGER REFERENCES brands(id) ON DELETE set null, category_id INTEGER REFERENCES categories(id) ON DELETE set null, subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE set null, original_price text, original_price_cents integer, sale_price text, sale_price_cents integer, change_status text NOT NULL DEFAULT 'new', deal_score integer, research_tier text, ... );\n-- + sale_cycles, sale_item_images, sale_item_colors (UNIQUE color_id+sale_item_id), sale_watch, sale_scrape_runs, sale_research_clusters, weekly_sale_ad\n-- + ALTER showroom_stores ADD is_online_only; ALTER showroom_store_sales ADD page_markdown;",
      },
    ],
    code: [
      {
        title:
          "Wide-table backfill: single-row inserts batched under D1's 100-param cap (sales-backfill.ts)",
        lang: "ts",
        code: "// sale_items is ~40 cols, so a multi-row insert would exceed D1's 100\n// bound-param cap. One row per statement stays well under it, and db.batch\n// runs each chunk atomically.\nfor (let i = 0; i < pending.length; i += BATCH_STATEMENTS) {\n  const chunk = pending.slice(i, i + BATCH_STATEMENTS);\n  const stmts = chunk.map((row) => db.insert(saleItems).values(row));\n  if (stmts.length === 0) continue;\n  await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);\n  result.itemsInserted += stmts.length;\n}",
      },
    ],
    diagrams: [
      {
        caption:
          "Phase A data spine — the JSON blob becomes real rows, with FK-not-name into the shared config vocabularies.",
        code: 'erDiagram\n    showroom_store_sales ||--o{ sale_items : "exploded into"\n    showroom_stores ||--o{ sale_items : "sells"\n    sale_cycles ||--o{ sale_items : "observed in"\n    sale_items ||--o{ sale_item_images : "raw src urls"\n    sale_items ||--o{ sale_item_colors : "colors mapping"\n    colors ||--o{ sale_item_colors : "definition"\n    brands ||--o{ sale_items : "brand_id"\n    categories ||--o{ sale_items : "category_id"\n    subcategories ||--o{ sale_items : "subcategory_id"\n    sale_items ||--o| sale_watch : "watched"\n    sale_research_clusters ||--o{ sale_items : "scored together"\n    sale_cycles ||--o{ sale_scrape_runs : "per-source health"\n    sale_cycles ||--o| weekly_sale_ad : "produces"',
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_284.mjs",
      command:
        "pnpm run test:pr 284 -- --preview   # branch preview — runs the backfill\npnpm run test:pr 284                # production (regression guard)",
      ranAt: "2026-07-27",
      source:
        "// preview: POST /backfill, assert ok + count parity (itemsInserted === itemsExpected),\n// then a second run must insert 0 (idempotent). prod: existing sales endpoints still 200;\n// /backfill 404 is 'pending merge/deploy'. Preview shares prod D1, so the backfill writes real rows.",
      output:
        'PREVIEW (wcrp-claude-sales-clearance-page-b0c752):\n  ✓ GET /api/showroom-sales → 200 (regression)\n  ✓ GET /api/showroom-sales/facets → 200 (regression)\n  ✓ POST /backfill → 200\n  backfill: {"snapshotsSeen":14,"snapshotsBackfilled":3,"snapshotsSkipped":0,"itemsInserted":29,"itemsExpected":29}\n  ✓ count parity: itemsInserted === itemsExpected on first run\n  re-run: {"itemsInserted":0,"snapshotsBackfilled":0,"snapshotsSkipped":3}\n  ✓ idempotent: second run inserts 0 items\n  8 passed, 0 failed\n\nPRODUCTION (regression guard, pre-merge):\n  ✓ GET /api/showroom-sales → 200 (regression)\n  ✓ GET /api/showroom-sales/facets → 200 (regression)\n    POST /backfill → 404 on prod (pending merge/deploy) — expected\n  3 passed, 0 failed\n\nAlso: tsc --noEmit clean on all new/edited files; pnpm run build ✓; migration applied via pnpm run migrate:remote and all 8 tables + is_online_only + page_markdown confirmed present on remote D1 via wrangler d1 execute.',
      migrations: [
        {
          tag: "0148_keen_vance_astro",
          appliedRemote: true,
          note: "Applied via pnpm run migrate:remote; 8 tables + 2 columns verified on remote D1.",
        },
      ],
    },
  },
  "api-auth-bearer": {
    slug: "api-auth-bearer",
    branch: "claude/api-auth-bearer",
    subtitle: "Auth · raw-key Bearer path so codra + QC can hit admin-gated APIs",
    prNumber: 285,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/285",
    problem:
      "The single auth gate `isRequestAuthenticated` (used by both the `_worker.ts` SSR admin gate and the `requireAccessAuth` API middleware) accepted ONLY the `remodel_access` cookie, and that cookie's value is `SHA-256(WORKER_API_KEY)`. A browser gets it by logging in; a server-to-server client only has the RAW key and no way to present the hash. So the codra review bot — which holds `WORKER_API_KEY` and tries to exercise the APIs a PR touches — and the QC scripts both failed every admin-gated call with 401.",
    approach:
      "Widen the gate to accept the same secret over a second CHANNEL — a header — without weakening the cookie. A new `getBearerKeyFromRequest` reads `Authorization: Bearer <key>` (case-insensitive) or the `x-worker-api-key` header; if it equals `WORKER_API_KEY` (constant-time compare) the request is authed. The cookie path is unchanged: it still matches ONLY `SHA-256(key)`, never the raw key — so a stolen/exfiltrated cookie still can't be turned back into the reusable secret. (An earlier revision also accepted the raw key in the cookie for 'robustness'; the codra security review correctly flagged that as defeating the hashed-cookie design, so it was removed — raw key is header-only.) `===` on the secret was replaced with a constant-time compare on both paths to avoid an early-exit timing leak. Everything funnels through this one function, so no per-route changes were needed.",
    apiChanges: [
      "isRequestAuthenticated (shared gate) — now also accepts Authorization: Bearer <WORKER_API_KEY> and x-worker-api-key: <WORKER_API_KEY>. No new routes; every admin-gated endpoint gains the header auth path.",
    ],
    filesTouched: [
      "src/backend/utils/access.ts (getBearerKeyFromRequest + timingSafeEqual; isRequestAuthenticated rewritten)",
    ],
    migrations: [],
    code: [
      {
        title: "The widened gate (access.ts)",
        lang: "ts",
        code: `/**
 * Determines if a request is authenticated by checking for a valid cookie or API key header.
 *
 * @param request The incoming HTTP request.
 * @param env The environment bindings.
 * @returns True if the request is authenticated, false otherwise.
 */
export async function isRequestAuthenticated(request: Request, env: Env): Promise<boolean> {
  const apiKey = (await env.WORKER_API_KEY.get())?.trim() || "";
  if (!apiKey) return false;
  // 1) raw key via header (codra / QC)
  const bearer = getBearerKeyFromRequest(request);
  if (bearer && timingSafeEqual(bearer, apiKey)) return true;
  // 2) remodel_access cookie = SHA-256(key) ONLY (browser); never the raw key
  const cookie = getAccessCookieFromRequest(request);
  if (cookie && timingSafeEqual(cookie, await hashString(apiKey))) return true;
  return false;
}`,
      },
    ],
    diagrams: [
      {
        caption: "Who authenticates, and how",
        title: "Two credential forms, one gate",
        code: `flowchart LR
  B[Browser]:::b -->|remodel_access cookie<br/>= SHA-256 key| G{isRequestAuthenticated}:::d
  C[codra / QC<br/>holds raw key]:::b -->|Authorization: Bearer key<br/>or x-worker-api-key| G
  G -->|match, constant-time| OK[authed]:::ok
  G -->|no match| NO[401]:::no
  classDef b fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;
  classDef d fill:#3f1e5f,stroke:#c084fc,color:#e2e8f0;
  classDef ok fill:#1f4d2e,stroke:#4ade80,color:#e2e8f0;
  classDef no fill:#4d1f1f,stroke:#f87171,color:#e2e8f0;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_285.mjs",
      command:
        "pnpm run test:pr 285 -- --preview   # branch preview (fix present)\npnpm run test:pr 285                # production (regression guard)",
      ranAt: "2026-07-27",
      output:
        "PREVIEW (wcrp-claude-api-auth-bearer):\n  ✓ target reachable\n  ✓ WORKER_API_KEY resolved locally\n  ✓ no-credential request is rejected (401)\n  ✓ cookie (hash) path still authenticates (200)\n  ✓ Authorization: Bearer <key> authenticates (200)\n  ✓ x-worker-api-key header authenticates (200)\n  6 passed, 0 failed\n\nPRODUCTION (regression guard, pre-merge):\n  ✓ target reachable\n  ✓ WORKER_API_KEY resolved locally\n  ✓ no-credential request is rejected (401)\n  ✓ cookie (hash) path still authenticates (200)\n    raw-key header auth not on prod yet — Bearer=401, header=401 (expected 401 pre-merge)\n  4 passed, 0 failed\n\nThe prod Bearer=401/header=401 confirms the bug this PR fixes (prod rejects the raw key today); the preview 200s confirm the fix. tsc --noEmit clean on access.ts.",
      migrations: [],
    },
  },
  "0032-visit-log-rest-crud": {
    slug: "0032-visit-log-rest-crud",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 V2a · REST CRUD over showroom_visit_log",
    problem:
      "V1 reconciled the schema, but there was no way to read, create, finalize, or delete a visit log except the telemetry pipeline's internal writes. The Visit Logs workspace and the voice loop both need a real CRUD surface, and the parity rule says REST and MCP go through one service to the same table.",
    approach:
      "A plain-Hono admin-gated router at /api/showroom-visit-logs (matching drive-lists.ts): list with ?status=pending|completed (pending = anything not SUBMITTED) + ?storeId, get, create, patch/finalize, delete. The store name is JOINed from showroom_stores on every read — never denormalized. Rating is validated 1-5 with Zod at the boundary (the API-layer guard that stands in for the CHECK SQLite can't ALTER-ADD). A new DRAFT status supports the human 'save draft' flow; because status is a TEXT column, adding the enum value is TS-only and db:generate emits no migration. MCP twins + the workspace UI follow as V2b/V2c.",
    apiChanges: [
      "GET /api/showroom-visit-logs?status=&storeId=&limit= — list, store name JOINed.",
      "GET /api/showroom-visit-logs/:id — one.",
      "POST /api/showroom-visit-logs — create (defaults DRAFT).",
      "PATCH /api/showroom-visit-logs/:id — update/finalize (recomputes dwell).",
      "DELETE /api/showroom-visit-logs/:id.",
    ],
    filesTouched: [
      "src/backend/api/routes/showroom-visit-logs.ts (new)",
      "src/backend/api/index.ts (mount)",
      "src/backend/db/schema/showroom/visit_log.ts (status += DRAFT, TS-only)",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "One service, two clients (parity)",
        code: `flowchart LR
  UI[Visit Logs workspace - V2b] --> REST["/api/showroom-visit-logs"]
  VOICE[Claude voice/chat - V2b MCP] --> MCP[visit-log MCP tools]
  REST --> T[(showroom_visit_log)]
  MCP --> T
  REST -. JOIN .-> S[(showroom_stores name)]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_288.mjs",
      command: "pnpm run db:generate  &&  pnpm run build  &&  pnpm run test:pr 288 -- --preview",
      ranAt: "2026-07-27",
      output:
        "db:generate → 'No schema changes' (DRAFT enum add is TS-only, no migration).\n" +
        "tsc --noEmit clean on the new route + index.ts + visit_log.ts. pnpm run build\n" +
        "green (exit 0). QC pr_288 exercises list + create→get→patch(finalize)→delete\n" +
        "round-trip incl. the rating=99 → 400 guard; run against preview + prod.",
      migrations: [],
    },
  },
  "0032-visit-log-reconcile": {
    slug: "0032-visit-log-reconcile",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0032 V1 · reconcile showroom_visit_log toward 0022 §5.1",
    problem:
      "The shipped showroom_visit_log is a subset of the 0022 §5.1 spec: its `type` column holds a CONTACT axis (PHONE/EMAIL/SHOWROOM_IN_PERSON), there's no engagement-depth signal, and no GPS-attestation fields. The Visit Logs workspace (V2) and the future GPS-attested review moat need the visit graded by how deep the visit actually went and how strong the location match was.",
    approach:
      "Add visit_type as the engagement axis — SOFT_ARRIVAL (auto-staged, unclassified), BROWSED_NO_CONTACT (walked through, spoke to no one), BRIEF_NO_HELP (asked, got pointed), FULL_SESSION (on the floor pulling samples), APPOINTMENT — separate from the deprecated contact-axis `type` (which belongs on showroom_store_contact_log). Add match_distance_m (how far the park was from the matched store = attestation strength) and provenance_json (raw fix + active-drive id). Widen gps_source (+ tesla-poll, phone, ai) for the coming multi-source ingress. stageSoftArrival/finalizeSoftArrivals populate the provenance fields. Rating stays 1-5 but is enforced in the API/service layer — SQLite can't ALTER-ADD a CHECK to an existing table without a full rebuild, which drizzle-kit won't auto-generate, so a schema check() would drift from the migration. hitl_queue_id + the store/hitl XOR rule are deferred to D1 (they need the showroom_store_hitl_queue table).",
    apiChanges: ["No new route in V1 (GET /api/tesla/visits gains the columns for V2)."],
    filesTouched: [
      "src/backend/db/schema/showroom/visit_log.ts (visit_type, match_distance_m, provenance_json; widened gps_source)",
      "src/backend/services/tesla/visit-sessions.ts (populate provenance on stage + finalize)",
      "drizzle/0147_lovely_silver_sable.sql",
    ],
    migrations: [
      {
        tag: "0147",
        sql: "ALTER TABLE showroom_visit_log ADD visit_type text DEFAULT 'SOFT_ARRIVAL' NOT NULL; ADD match_distance_m real; ADD provenance_json text;",
      },
    ],
    diagrams: [
      {
        caption: "Two axes: engagement (visit) vs channel (contact)",
        code: `erDiagram
  showroom_visit_log {
    text visit_type "ADD — engagement depth"
    text type "DEPRECATED — contact axis moves out"
    real match_distance_m "ADD — attestation"
    text provenance_json "ADD — raw fix"
  }
  showroom_store_contact_log {
    text type "PHONE|EMAIL|SHOWROOM_IN_PERSON"
    int showroom_visit_log_id "links a contact to a visit (D1)"
  }
  showroom_visit_log ||--o{ showroom_store_contact_log : "in-person contact during a visit"`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_286.mjs",
      command: "pnpm run db:generate  &&  pnpm run build  &&  pnpm run test:pr 286 -- --preview",
      ranAt: "2026-07-26",
      output:
        "db:generate → 0147_lovely_silver_sable.sql (3 ADD COLUMNs; no CHECK emitted —\n" +
        "SQLite ALTER limitation, rating enforced in the API layer). tsc --noEmit clean on\n" +
        "visit_log.ts + visit-sessions.ts. pnpm run build green (server built ~132s).\n" +
        "migrate:local full-chain replay against fresh local D1 run before merge. Remote\n" +
        "migration applied via the Deploy (manual) action (run_migrations:true).",
      migrations: [{ tag: "0147", applied: false }],
    },
  },
  "0037-shopping-sidebar-ia": {
    slug: "0037-shopping-sidebar-ia",
    branch: "claude/shopping-sourcing-sidebar-41f368",
    subtitle: "Shopping & Sourcing · Phase 0 of the 0037 refactor (nav + IA foundation)",
    introduction:
      "For anyone touching the admin sidebar: the nav item model is no longer flat. This is the foundation the rest of the 0037 Shopping refactor (grouped tables, ecommerce, concierge agent) builds on, so it ships alone and additive.",
    problem:
      "The Shopping & Sourcing sidebar had grown into a flat list of 15 links in 10px text, with no grouping, no icons, and no way to tuck it away. The nav data model (`SidebarItem` in shared.tsx) was strictly `{ href, label, badgeCount? }` — one level only — so the desired structure (Showrooms / Brands & Products / Purchase Ops, with Review nested a third level down) was not even expressible. And no sidebar anywhere in the app could collapse: `AdminSidebar` was a hardcoded `w-64` and `BaseLayout` offset the content by a hardcoded `md:pl-64`.",
    approach:
      "Additive, pure-frontend. `SidebarItem` becomes a recursive tree — `href`, `icon`, `children[]`, `navigateOnExpand` all optional — so existing flat groups keep working untouched while shopping gets arbitrary-depth submenus. A new `NavNode` renders each node: a leaf is a `NavLink`; a node with children is a collapsible submenu, seeded open from the SSR path when a descendant is active (no post-hydration flip), collapsed otherwise. A `navigateOnExpand` parent is a link that navigates to its section landing AND expands; a separate chevron button peeks in place without navigating. Collapse-to-rail: `AdminSidebar` gains a toggle between `w-64` and a `w-14` icon rail (one icon per admin section + expand/home/config), persisted in a `remodel_sidebar_collapsed` cookie. The reflow is done without React owning the layout: `BaseLayout` reads the cookie server-side, stamps `data-sidebar-collapsed` on `<html>`, and both the fixed aside width and the content padding read a single `--sidebar-w` CSS var keyed on that attribute — so one client toggle reflows the whole page and the SSR HTML already has the right width (no flash). Icons added per section and per shopping item; group-header text bumped 10px→xs.",
    apiChanges: ["None — pure frontend. No routes, no schema, no migration."],
    filesTouched: [
      "src/frontend/components/sidebar/shared.tsx (recursive SidebarItem/NavGroupDef; isItemActive + sumBadges; NavLink icon; new NavNode; RenderGroup renders NavNodes + group icon + xs header)",
      "src/frontend/components/sidebar/nav-groups.ts (per-section icons; shopping group re-authored into the nested tree)",
      "src/frontend/components/sidebar/AdminSidebar.tsx (collapsed prop + state + cookie; AdminRail; collapse toggle in header; aside width via --sidebar-w)",
      "src/frontend/layouts/BaseLayout.astro (cookie seed → data-sidebar-collapsed on <html>; --sidebar-w CSS var; content padding + aside width off the var)",
      "src/frontend/pages/admin/shopping.astro (hub landing regrouped to the three sections; standard page shell with icon header)",
      "docs/0037_shopping_sourcing_refactor/ (planning bundle; renamed from 0032 to avoid an ordinal collision)",
    ],
    migrations: [],
    code: [
      {
        title: "Recursive item model + active-branch test (shared.tsx)",
        lang: "tsx",
        code: `export type SidebarItem = {
  href?: string;              // optional: a pure grouping node just toggles
  label: string;
  icon?: LucideIcon;
  badgeCount?: number;
  children?: SidebarItem[];   // nesting
  navigateOnExpand?: boolean; // parent link that navigates AND expands
};

/**
 * Checks if a sidebar item or any of its children are currently active based on the path.
 *
 * @param currentPath The current application path.
 * @param item The sidebar item to check.
 * @returns True if the item or a child is active, false otherwise.
 */
export function isItemActive(currentPath: string, item: SidebarItem): boolean {
  if (item.href && isPathActive(currentPath, item.href)) return true;
  return (item.children ?? []).some((c) => isItemActive(currentPath, c));
}`,
      },
      {
        title: "One CSS var drives both the aside and the content padding (BaseLayout.astro)",
        lang: "tsx",
        code: `const sidebarCollapsed =
  isAdmin && Astro.cookies.get("remodel_sidebar_collapsed")?.value === "1";
// <html ... data-sidebar-collapsed={sidebarCollapsed ? "1" : "0"}>
// :root { --sidebar-w: 16rem; }
// :root[data-sidebar-collapsed="1"] { --sidebar-w: 3.5rem; }
// aside:    md:[width:var(--sidebar-w)]
// content:  md:[padding-left:var(--sidebar-w)]  → reflows together, no flash`,
      },
    ],
    diagrams: [
      {
        caption: "Target shopping IA — three nested submenus",
        title: "Information architecture",
        code: `flowchart TD
  S[Shopping & Sourcing]:::grp
  S --> SR[Showrooms<br/>label → /shopping/showrooms]:::sub
  SR --> SR1[Drive Lists]
  SR --> SR2[Contacts]
  SR --> SR3[Sales & Clearance]
  SR --> SR4[Showroom Intake]
  S --> BP[Brands & Products<br/>label → /shopping/brands]:::sub
  BP --> BP1[Materials]
  BP --> BP2[Products]
  BP --> BP3[Wishlist]
  BP --> BP4[Deep Research]
  BP --> BP5[Shopping Journal]
  S --> PO[Purchase Ops]:::sub
  PO --> RV[Review]:::sub
  RV --> RV1[Price Cards]
  RV --> RV2[Product Photos]
  PO --> PO1[Receipt Review]
  classDef grp fill:#1e293b,stroke:#38bdf8,color:#e2e8f0;
  classDef sub fill:#0f172a,stroke:#64748b,color:#e2e8f0;`,
      },
      {
        caption: "Collapse-to-rail state (cookie-persisted, SSR-seeded)",
        title: "Sidebar collapse",
        code: `stateDiagram-v2
  [*] --> Expanded
  Expanded --> Rail: click collapse (cookie=1, --sidebar-w=3.5rem)
  Rail --> Expanded: click expand (cookie=0, --sidebar-w=16rem)
  note right of Rail
    aside + content padding
    both read --sidebar-w,
    so they reflow together
  end note`,
      },
    ],
    prNumber: 277,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/277",
    verification: {
      qcScript: "scripts/qc/pr_277.mjs",
      command:
        "pnpm run test:pr 277 -- --preview   # branch preview\npnpm run test:pr 277                # production (regression guard)",
      ranAt: "2026-07-26",
      source:
        "// SSR smoke: every shopping page still 200s with the sidebar in the HTML;\n// on --preview the new-IA markers (Purchase Ops, Sourcing Tools, data-sidebar-collapsed)\n// must be present; on prod (pre-merge) they're reported 'pending merge/deploy', not failed.",
      output:
        "PREVIEW (wcrp-claude-shopping-sourcing-sidebar-41f368):\n  ✓ target reachable\n  ✓ GET /admin/shopping → 200\n  ✓ GET /admin/shopping/schedule → 200\n  ✓ GET /admin/shopping/showrooms → 200\n  ✓ GET /admin/shopping/wishlist → 200\n  ✓ hub renders the shopping shell\n  ✓ new IA markers present (Purchase Ops + Sourcing Tools)\n  ✓ collapse-to-rail seed on <html> (data-sidebar-collapsed)\n  8 passed, 0 failed\n\nPRODUCTION (regression guard, pre-merge):\n  ✓ target reachable\n  ✓ GET /admin/shopping → 200\n  ✓ GET /admin/shopping/schedule → 200\n  ✓ GET /admin/shopping/showrooms → 200\n  ✓ GET /admin/shopping/wishlist → 200\n  ✓ hub renders the shopping shell\n    new IA markers not on prod yet — pending merge/deploy (expected pre-merge)\n  6 passed, 0 failed\n\nAlso: tsc --noEmit clean on touched files; pnpm run build '✓ built in 42.40s'; browser preview confirmed nested tree, auto-expand, collapse-to-rail reflow + expand round-trip.",
      migrations: [],
    },
  },
  "0037-showrooms-grouped-table": {
    slug: "0037-showrooms-grouped-table",
    branch: "claude/showrooms-grouped-table",
    subtitle: "Shopping & Sourcing · Phase 2 of the 0037 refactor (Showrooms grouped-table)",
    prNumber: 282,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/282",
    problem:
      "The Showrooms directory was a dense card UI with three overlapping views (map / list-by-category / directory-by-city) grouped behind an accordion. It wasted vertical space, buried the region picker in a chip row, and had no way to regroup or scan stores as a table. The homeowner wanted a single grouped experience: pick a region (tabbed, with counts), group how they like, see what's open right now, and one-tap navigate the car to a store.",
    approach:
      "Reworked `ShowroomsDirectoryApp` in place, wired to the SAME live fetch (`/api/showroom-stores?include=categories,ratings` + the three `meta/*` endpoints) — no mock data, no new endpoints. Region tabs come from the existing `HUB_LABEL` map; a `useDeviceLocation` hook reuses the existing device-location report to auto-select the nearest region (SF fallback). A group-by switcher buckets the active region's stores (Sales Category default / Rating / Flagship / Closing Time), open stores sorted by earliest close via the existing `hours-status` helpers, closed stores folded into one expandable banner. Cards reuse `ShowroomMergedCard`; rows are a new compact accessible table. The detail modal reads `hoursJson` for a full weekly schedule and posts to the real `POST /api/tesla/navigate` for Tesla nav (Google Maps uses the standard dir URL). The map view is preserved behind a Grouped/Map toggle; the retired list/directory tabs redirect to grouped.",
    apiChanges: [
      "None — pure frontend. Reuses existing /api/showroom-stores + meta/* and POST /api/tesla/navigate. No schema, no migration.",
    ],
    filesTouched: [
      "src/frontend/components/showroom/ShowroomsDirectoryApp.tsx (region tabs, group-by switcher, closed-collapse, cards/rows, detail modal + Tesla nav; downlevel-iteration spreads → Array.from)",
      "src/frontend/pages/admin/shopping/showrooms.astro (default tab map → grouped)",
      "src/frontend/pages/admin/shopping/showrooms/[tab].astro (valid tabs grouped|map; retired list/directory redirect to grouped)",
    ],
    migrations: [],
    code: [],
    diagrams: [
      {
        caption: "Region tab → group → render pipeline",
        title: "Grouped-table data flow",
        code: `flowchart LR
  F[fetch /api/showroom-stores + meta/*]:::b --> R{active region tab}:::d
  R --> FL[filters: search / type / open-now / visit]:::b
  FL --> G{group by}:::d
  G --> GC[Sales Category default]
  G --> GR[Rating]
  G --> GF[Flagship]
  G --> GT[Closing Time]
  GC --> S[open first, earliest close;<br/>closed → collapse banner]:::b
  S --> V{cards / rows}:::d
  V --> MODAL[detail modal:<br/>hours · Maps · Tesla nav]:::b
  classDef b fill:#0f172a,stroke:#38bdf8,color:#e2e8f0;
  classDef d fill:#3f1e5f,stroke:#c084fc,color:#e2e8f0;`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_282.mjs",
      command:
        "pnpm run test:pr 282 -- --preview   # branch preview\npnpm run test:pr 282                # production (regression guard)",
      ranAt: "2026-07-26",
      output:
        "tsc --noEmit: 0 errors in ShowroomsDirectoryApp.tsx. pnpm run build: ✓ Complete. Preview deploy verified against production D1 (wcrp-claude-showrooms-grouped-table): region tabs with live counts (All 158 / SF 30 / South Bay 24 / Peninsula 19 / East Bay 75 / North Bay 8 / Central Valley 1), Sales-Category grouping with per-group avg rating + open-now, and closed-collapse banners ('12 closed now — SCIC SAN FRANCISCO, …') all render; no console errors on mount. QC harness pr_282 runs preview + prod (see PR).",
      migrations: [],
    },
  },
  "changelog-live-phases": {
    slug: "changelog-live-phases",
    branch: "claude/changelist-phases-live-updates-6cfa61",
    subtitle: "Changelog · phase-grouped, live-updating preview tasks (websocket + poll)",
    problem:
      "The preview changelog (/admin/changelog/preview/<slug>) is where the user reviews a proposed change and then follows it being built. But its plan-task list rendered as one flat, ungrouped <ul> — a long feature's tasks were an unreadable wall — and it was a one-time SSR snapshot: the only way to see progress was to reload the whole page. There was also no clean, low-friction way for a working agent to tick a single task's status or attach the PR it shipped in, so the board rotted between sessions and the user had no live view of where things stood.",
    approach:
      "Two halves. FRONTEND: the task list now groups by phase into collapsible sections (the exact pattern already proven on /admin/plans PlanBoardApp — lifted, not reinvented), each with a per-phase progress bar, a PR-count, per-task PR chips, and a 'pending PR' badge when every task in a phase has landed (done/in_review) but nothing merged. It stays LIVE by seeding from the SSR snapshot, then polling GET /api/changelog/proposals/:slug every 10s AND holding a websocket to plan:<slug>; any socket message pokes an immediate refetch, with the poll as the fallback (a Live/Polling pill shows which). BACKEND: a shared updatePlanTask() service writes one plan_task (by id or by planSlug+taskKey) and fans a poke out of the existing EstimateCollabHub DO — best-effort, so a downed hub never fails the write. A new update_plan_task MCP tool gives agents the per-task tick (in_progress → in_review+PR → done+PR), and PATCH /api/admin/plans/tasks/:id gains prNumber/changelogSlug/progressPct + the in_review status and routes through the same service so it publishes too. in_review was already in the plan_tasks DB enum (0028) but missing from rollup(), validation, the proposal schema and the frontend — now consistent everywhere. No migration: plan_tasks.prNumber/changelogSlug already existed.",
    apiChanges: [
      "update_plan_task (MCP, changelog domain) — set one task's status/prNumber/changelogSlug/progressPct/notes by planSlug+taskKey; fans a realtime poke.",
      "PATCH /api/admin/plans/tasks/:id — now accepts prNumber/changelogSlug/progressPct and the in_review status; publishes on write.",
      "GET/WS /api/realtime/plans?room=plan:<slug> — gateway to EstimateCollabHub (the preview page subscribes here).",
    ],
    filesTouched: [
      "src/backend/services/plan-tasks.ts (new — updatePlanTask + realtime poke)",
      "src/backend/mcp/tools/changelog/update_plan_task.ts (new MCP tool) + index.ts",
      "src/backend/api/routes/admin-plans.ts (PATCH fields + in_review + publish via service)",
      "src/_worker.ts (/api/realtime/plans gateway)",
      "src/frontend/components/changelog/ProposalBundle.tsx (phase groups, collapse, poll + WS)",
      "src/frontend/components/plans/shared.tsx (in_review across types/badges/rollup)",
      "src/frontend/pages/admin/changelog/preview/[slug].astro (carry prNumber/sortOrder/changelogSlug)",
    ],
    migrations: [],
    code: [],
    diagrams: [
      {
        caption: "An agent ticks a task → the user's open page updates with no refresh",
        code: `sequenceDiagram
  participant A as Agent
  participant W as Worker (update_plan_task / PATCH)
  participant DB as D1 plan_tasks
  participant DO as EstimateCollabHub (room plan:slug)
  participant U as Preview page (open)
  U->>DO: ws connect (room plan:slug)
  A->>W: update_plan_task(status in_review, prNumber)
  W->>DB: update row
  W-->>DO: publish poke (best-effort)
  DO-->>U: message
  U->>W: refetch GET /proposals/slug
  W-->>U: live tasks
  Note over U: 10s poll is the fallback if the socket drops`,
      },
      {
        caption: "Phase grouping + the 'pending PR' state",
        code: `stateDiagram-v2
  [*] --> pending
  pending --> in_progress: pick up
  in_progress --> in_review: open PR (+prNumber)
  in_review --> done: merge (+prNumber)
  note right of in_review
    phase shows "pending PR"
    when every task is done/in_review
    but not all merged
  end note`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_269.mjs",
      command:
        "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 269 -- --preview   # and prod (regression)",
      ranAt: "2026-07-26",
      output:
        "`npx tsc --noEmit` — zero new errors vs the parent commit (baseline diff clean).\n" +
        "`pnpm run build` — Complete (vite + server built, prerender OK, ~54s).\n" +
        "No schema change → no migration.\n" +
        "PREVIEW QC (pr_269, against wcrp-…-6cfa61): 15 passed, 0 failed — proposal seeds\n" +
        "4 tasks carrying phase+sortOrder+prNumber; PATCH accepts in_review + prNumber 269;\n" +
        "the re-read reflects it (the follow-along path); a websocket client received the\n" +
        "realtime poke after the PATCH; /api/realtime/plans DO health reachable.\n" +
        "PROD QC (regression): 9 passed, 6 failed — the 9 are the pre-existing proposal\n" +
        "round-trip (no regression; prod already returns prNumber/sortOrder). The 6 failures\n" +
        "are the new surface (in_review, PR write, /api/realtime/plans, WS poke), which is\n" +
        "old code on prod — they flip green after merge + `pnpm run deploy`.",
      migrations: [],
    },
  },
  "tesla-live-ticker": {
    slug: "tesla-live-ticker",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · drive-scoped matching, opt-in auto-nav, live ticker",
    problem:
      "On a real drive the operator caught two wrong behaviours. The stop matcher matched against EVERY status='active' drive list, and a week-old list had never been archived — so when the car parked on the Fourth-St-Berkeley shopping strip, the nearest unvisited stop across all lists was Farrow & Ball (190 m, a stop on the stale list, same block). It false-checked that stop AND auto-sent the car a navigation command to that list's next stop (Luxury Flooring) — a place the driver never chose. Separately, there was no way to watch the live telemetry as it arrived.",
    approach:
      "Three changes. (1) loadActiveStops is scoped to is_active=true — THE one active drive (single-active invariant) — not status='active', which many stale lists share; no active drive now means no candidates and no false match. (2) Auto-navigation is gated behind a new tesla_auto_navigate config flag (default false) in BOTH the poller and the stream DO, so the vehicle is never commanded to a stop the driver didn't ask for. (3) A GET /api/tesla/stream/events endpoint returns the newest parsed telemetry frames (gear/speed/battery/coords) pre-formatted for display, and AdminTeslaAlert — while telemetry is live — polls it every 5 s and rotates through the frames (~3 s each) across the top of every admin page. Root-cause note on the earlier 0-frames: shouldStreamNow requires an ACTIVE drive (is_active) + window + toggle; the drive was status:active but never is_active, so the stream was never armed — the Tessie handshake (Authorization: Bearer header) was never the issue.",
    apiChanges: [
      "GET /api/tesla/stream/events?limit= — newest parsed telemetry frames, pre-formatted.",
      "POST /api/tesla/stream/control now accepts + returns autoNavigate.",
    ],
    filesTouched: [
      "src/backend/services/drive-geo-match.ts (loadActiveStops → is_active scope)",
      "src/backend/services/tesla/gating.ts (isAutoNavigateEnabled/setAutoNavigate)",
      "src/backend/services/tesla-poller.ts + durable-objects/tesla-stream.ts (auto-nav gated)",
      "src/backend/api/routes/tesla.ts (stream/events + control autoNavigate)",
      "src/frontend/components/AdminTeslaAlert.tsx (live parsed-event ticker)",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "Parsed frames stream to the ticker",
        code: `flowchart LR
  car[Tesla] -->|wss| DO[TeslaStreamDO]
  DO -->|insert parsed frame| TDB[(TESLA_DB)]
  TDB -->|GET /stream/events| Bar[AdminTeslaAlert]
  Bar -->|rotate ~3s| Screen[top of every /admin page]`,
      },
      {
        caption: "Matcher scope: the one active drive, not every active-status list",
        code: `flowchart TD
  park[Park fix] --> q{is_active drive?}
  q -->|no| none[no candidates → no match]
  q -->|yes| stops[stops of THAT drive only]
  stops --> near{within 250m?}
  near -->|yes| mark[mark visited]
  near -->|no| none`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_263.mjs",
      command: "npx tsc --noEmit  &&  pnpm run build  &&  pnpm run test:pr 263 -- --preview",
      ranAt: "2026-07-26",
      output:
        "`npx tsc --noEmit` — clean on all six touched files (no additions to the\n" +
        "pre-existing baseline). `pnpm run build` — Complete (vite + server built,\n" +
        "prerender OK in ~96s). No schema change, so no migration. Preview/prod QC\n" +
        "(pr_263: /stream/events shape + /stream/control autoNavigate round-trip)\n" +
        "pending merge + deploy; /stream/events reads TESLA_DB which is empty until a\n" +
        "live in-window drive streams.",
      migrations: [],
    },
  },
  "tesla-visit-sessions": {
    slug: "tesla-visit-sessions",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · the IFTTT core (park → soft arrival → finalize)",
    problem:
      "The whole point of the telemetry stream was to capture visits without any manual logging: when the car parks at a showroom on an active drive, record that a visit started; when it drives away, close it with the real start/stop times. The stream DO already detected the shift-into-P, but there was nowhere to write a visit and no drive-away handling.",
    approach:
      "A new showroom_visit_log table holds visits as a two-row model. On park, stageSoftArrival finds the nearest registered showroom within 250 m (haversine over showroom_stores, behind one module so the anticipated locations move is a one-file change) and, if a drive is active, inserts a TESLA_SOFT_ARRIVAL draft with arrivalAt — deduped, so a repeated frame or a re-park can't stack drafts. On drive-away (shift P → moving), finalizeSoftArrivals closes every still-open soft arrival into a TESLA_STAGED row that copies the arrival, adds departureAt + dwellSeconds, and points softArrivalId back at the draft. That column is a partial UNIQUE, so a second finalize (onConflictDoNothing) inserts nothing — idempotent. Both entry points live in the DO's frame handler and are safe for the poller to reuse. A GET /api/tesla/visits endpoint lists the log with the store name JOINed (never denormalized).",
    apiChanges: [
      "GET /api/tesla/visits?status=&limit= — visit-log rows, newest first, store name JOINed.",
    ],
    filesTouched: [
      "src/backend/db/schema/showroom/visit_log.ts (new) + migration drizzle/0140",
      "src/backend/services/tesla/visit-sessions.ts (new)",
      "src/backend/durable-objects/tesla-stream.ts (onPark stage + drive-away finalize; connect→connectStream)",
      "src/backend/api/routes/tesla.ts (GET /visits)",
      "worker-configuration.d.ts (regenerated — TESLA_STREAM in Env)",
    ],
    migrations: [
      {
        tag: "0140",
        sql: "CREATE TABLE showroom_visit_log ( id ..., store_id integer, drive_list_id integer, stop_id integer, arrival_at integer, departure_at integer, dwell_seconds integer, status text DEFAULT 'TESLA_SOFT_ARRIVAL' NOT NULL, type text DEFAULT 'SHOWROOM_IN_PERSON' NOT NULL, rating integer, notes_markdown text, notes_html text, gps_source text, latitude real, longitude real, soft_arrival_id integer, created_at ..., updated_at ..., FKs → showroom_stores/drive_lists/drive_list_stops/self ); CREATE UNIQUE INDEX showroom_visit_log_soft_arrival_uniq ON showroom_visit_log(soft_arrival_id) WHERE soft_arrival_id IS NOT NULL;",
      },
    ],
    diagrams: [
      {
        caption: "Two-row model over a drive",
        code: `stateDiagram-v2
  [*] --> Driving
  Driving --> SoftArrival: park at showroom (active drive)
  SoftArrival --> Staged: drive-away (+ departure + dwell)
  Staged --> Driving
  SoftArrival --> Driving: home (drive ends)`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_258.mjs",
      command: "pnpm run migrate:remote  &&  pnpm run test:pr 258 -- --preview",
      ranAt: "2026-07-25",
      output:
        "Migration 0140 applied to LOCAL D1 (wrangler d1 execute --local): table + 4\n" +
        "indexes created; two-row soft→staged insert succeeded; a duplicate soft_arrival_id\n" +
        "was rejected by the partial UNIQUE index while multiple NULL-soft_arrival_id soft\n" +
        "rows were allowed. `npx tsc --noEmit` — touched files clean (DO connect collision\n" +
        "fixed; no additions to the pre-existing baseline). `pnpm run build` — Complete\n" +
        "(server built in ~130s, prerender OK). REMOTE migration + preview QC pending a\n" +
        "toolchain env / deploy.",
      migrations: [{ tag: "0140", applied: false }],
    },
  },
  "tesla-admin-alert": {
    slug: "tesla-admin-alert",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · the telemetry state, on every admin page",
    problem:
      "Telemetry is only meaningful under two conditions — a drive list is active AND it's inside 7 AM–8 PM — but nothing surfaced that state outside the drives page. The operator wanted a single global alert (alongside the active-drive alert) that says whether a drive is active and whether telemetry is live, offers a one-click enable when it should be on but isn't, and — when live — shows the actual car.",
    approach:
      "One aggregate endpoint, GET /api/tesla/stream/banner, returns everything the alert needs from D1/KV only (no DO round-trip, so it's cheap on every page): the active drive, whether telemetry is live (the DO's heartbeat-backed connected flag), the window state with a 12-hour label, whether an Enable button applies (active ∧ in-window ∧ toggle off), and — only when live — the vehicle image URL. That URL is Tesla's public compositor render of the actual car, built from Tessie's vehicle_config with the car/paint/wheel option-code maps ported from the operator's iOS app (Model 3/Y only; S/X need a longer option string) and cached in KV for a day. The alert is a React island mounted in BaseLayout after AppHeader, admin-only, that renders nothing unless a drive is active, polls every 20s (paused while the tab is hidden), and self-hides if the routes 404.",
    apiChanges: [
      "GET /api/tesla/stream/banner — { activeDrive, telemetryActive, telemetryEnabled, withinWindow, canEnable, windowLabel (12h), vehicleImageUrl }.",
    ],
    filesTouched: [
      "src/backend/services/tesla/vehicle-image.ts (new)",
      "src/backend/api/routes/tesla.ts (banner route + 12h label)",
      "src/frontend/components/AdminTeslaAlert.tsx (new)",
      "src/frontend/layouts/BaseLayout.astro (admin-only mount)",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "What the global alert shows",
        code: `flowchart TD
  A{"drive active?"} -->|no| H["nothing"]
  A -->|yes| T{"telemetry live?"}
  T -->|yes| L["'Telemetry active' + car image"]
  T -->|no| W{"in 7 AM-8 PM?"}
  W -->|yes| E["'Enable telemetry' button"]
  W -->|no| P["'paused - window is 7 AM-8 PM'"]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_251.mjs",
      command: "pnpm run test:pr 251 -- --preview   # and prod (regression)",
      ranAt: undefined,
      output:
        "AUTHORED, NOT YET RUN. Read-only: asserts the banner contract (all fields +\n" +
        "12-hour label), the canEnable and vehicle-image invariants, and that an admin\n" +
        "page still serves the layout the banner mounts in. New route reports PENDING\n" +
        "against prod until merge+deploy.",
      migrations: [],
    },
  },
  "showroom-dedup-merge-and-guards": {
    slug: "showroom-dedup-merge-and-guards",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    subtitle: "Showrooms · merge dedup + creation guards + config",
    problem:
      "Two gaps remained after the bootstrap-only seed guard. (1) The dedup tool DELETED duplicates and dropped/reparented children inconsistently; the ask was a true MERGE — keep one canonical row and move the duplicate's support data onto it, soft-deleting (not hard-deleting) the loser so it stays restorable and every is_active-filtered read path hides it. (2) Nothing stopped a NEW duplicate being created: the create endpoint only checked place_id, and the MCP create/import tools could add a store that already existed under a different place_id but the same phone/website/address. Separately, newer wrangler rejects a `remote` field on secrets_store_secrets, which broke every wrangler command (d1 execute, deploy).",
    approach:
      "dedup_showroom_stores is now a merge: per (name, city) group it picks the most-enriched keeper, remaps every child row from the duplicates onto it, and soft-deletes the duplicate store (is_active = 0). Tables with a (store, key) identity — links (url+type), hours (day), and the tag/category/product-area/product/brand mappings — are dedup-merged: a duplicate's row moves only if the keeper lacks that key, else it is dropped, so the merge never creates a second website link or trips a unique index. A shared findDuplicateStore(db, {placeId, phoneNumber, websiteUrl, locationAddress}) matches an active store by place_id, phone (digits-only), website hostname, or normalized address; it is wired into POST /api/showroom-stores (409) and the create_showroom + import_showroom_from_place MCP tools (return the existing row). And the unsupported `remote` field was stripped from the 24 secret-store bindings, with wrangler bumped to 4.114.0.",
    apiChanges: [
      "MCP dedup_showroom_stores — now MERGE + soft-delete (was delete). Dry-run reports rowsToMerge + per-table child counts.",
      "POST /api/showroom-stores — 409 now fires on place_id / phone / website / address match (was place_id only), with matchedOn.",
      "MCP create_showroom / import_showroom_from_place — return the existing store (created:false, 'exists (matched by …)') instead of creating a duplicate.",
    ],
    filesTouched: [
      "src/backend/mcp/tools/showrooms/dedup_showroom_stores.ts",
      "src/backend/services/showroom/duplicate-check.ts",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/mcp/tools/showrooms/create_showroom.ts",
      "src/backend/mcp/tools/showrooms/import_showroom_from_place.ts",
      "wrangler.jsonc",
      "package.json",
      "scripts/0119-soft-delete-showroom-duplicates.sql",
    ],
    migrations: [],
    code: [
      {
        title: "Merge: move a duplicate's rows onto the keeper, then soft-delete",
        lang: "ts",
        code: `// DEDUP MOVE — move only rows the keeper lacks (by url+type / day / mapping id);
// drop the rest so the merge never duplicates the keeper's data.
if (keeperKeys.has(keyOf(row, t.keyCols))) toDrop.push(id);
else { toMove.push(id); keeperKeys.add(keyOf(row, t.keyCols)); }
// SIMPLE MOVE — repoint per-event child rows (notes, ratings, sales…) to keeper.
await db.update(t.table).set({ [t.key]: keepId }).where(inArray(t.col, dupeIds));
// then SOFT-DELETE the emptied duplicate store — never a hard delete.
await db.update(showroomStores).set({ isActive: false, updatedAt: new Date() })
  .where(inArray(showroomStores.id, dupeIds));`,
      },
      {
        title: "Creation guard shared by the endpoint + MCP tools",
        lang: "ts",
        code: `const dup = await findDuplicateStore(db, {
  placeId, phoneNumber, websiteUrl, locationAddress,
});           // matches active store by place_id | phone-digits | website host | normalized address
if (dup) return existing row (409 on the endpoint; created:false on MCP);`,
      },
    ],
    diagrams: [
      {
        caption: "Create → duplicate guard → insert",
        code: `flowchart TD
  A[create store — endpoint or MCP] --> B[findDuplicateStore]
  B --> C{active match?}
  C -- "place_id / phone / website / address" --> R[reject: return existing row]
  C -- none --> I[insert new store]
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  classDef ok fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  class R stop
  class I ok`,
      },
    ],
    verification: {
      qcScript: "MCP dedup_showroom_stores (dry-run) + tsc/build",
      command: "npx tsc --noEmit; pnpm run build; dedup_showroom_stores {}",
      ranAt: "2026-07-25",
      output:
        "npx tsc --noEmit — 0 errors in the changed files. Dry-run (pre-merge) reported 33\n" +
        "groups / 54 rows, childRowCounts { showroom_store_links: 26 } — confirming the\n" +
        "duplicates only carry seeded links, which the merge dedups. Apply is human-gated.",
    },
  },
  "drives-map-fix-card-actions": {
    slug: "drives-map-fix-card-actions",
    branch: "claude/drive-list-ui-improvements-b58ece",
    prNumber: 244,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/244",
    subtitle: "Drives · PR-A quick fixes (map render + card action strip)",
    problem:
      "The drive viewport's route map (DriveRouteMap — MapLibre GL with a free CartoCDN basemap, no API key) plots only the stops that carry lat/lng, and renders a single empty MapPinned icon on a muted panel when NONE do. Drive stops are denormalized: a stop can be created with just a showroomStoreId and no coords of its own. The landing list already worked around this — it coalesces each marker's coords from the linked showroom — but GET /api/drive-lists/:slug returned stops verbatim, so any drive whose stops lacked their own lat/lng showed a blank pin even though the linked showrooms are geocoded. In production that was 14 of 23 drives. Two cosmetic issues rode along: the Tesla button sat as a separate raised secondary button OUTSIDE the address+Navigate background, and the hours/phone were small badges — hard to hit on a Tesla or phone screen.",
    approach:
      "A new service helper, fillMissingStopCoords(db, stops), backfills each stop's null lat/lng from its linked showroom in one bounded query (drives cap at 24 stops, so no chunking), mutating in place; the :slug handler calls it before responding. It lives in the service layer, not the route, deliberately — drizzle-orm 0.33's .set() type inference is fragile and degrades from added type-load in a file, so keeping the extra showroom query out of the route file leaves its unrelated PATCH handlers' inference intact. On the frontend, the address+Navigate <a> and the Tesla <button> now share one rounded bg-muted container at matched min-h-14 height (a thin divider between them), reading as a single control strip; the hours badge is enlarged to text-base and the phone becomes a large min-h-12 tap-to-dial button.",
    apiChanges: [
      "GET /api/drive-lists/:slug — unchanged contract; each returned stop's latitude/longitude is now backfilled from its linked showroom when the stop's own value is null.",
    ],
    filesTouched: [
      "src/backend/services/drive-lists.ts (new fillMissingStopCoords helper)",
      "src/backend/api/routes/drive-lists.ts (:slug calls the helper)",
      "src/frontend/components/drives/DriveViewportApp.tsx (action strip + hours/phone)",
      "scripts/qc/pr_244.mjs (new)",
    ],
    migrations: [],
    code: [
      {
        title: "Backfill stop coords from the linked showroom (service)",
        lang: "ts",
        code: `// A stop can be created without lat/lng yet still link a geocoded showroom;
// the map + per-stop navigation key off the stop's OWN coords, so without this
// the whole map falls back to an empty pin. Bounded (<=24 stops) — no chunking.
const need = stops.filter(
  (s) => (s.latitude == null || s.longitude == null) && s.showroomStoreId != null,
);
if (need.length === 0) return stops;
const ids = Array.from(new Set(need.map((s) => s.showroomStoreId)));
const coords = await db
  .select({ id: showroomStores.id, latitude: showroomStores.latitude, longitude: showroomStores.longitude })
  .from(showroomStores)
  .where(inArray(showroomStores.id, ids));
const byId = new Map(coords.map((r) => [r.id, r]));
for (const s of stops) {
  const sr = s.showroomStoreId == null ? null : byId.get(s.showroomStoreId);
  if (!sr) continue;
  if (s.latitude == null) s.latitude = sr.latitude;
  if (s.longitude == null) s.longitude = sr.longitude;
}`,
      },
    ],
    diagrams: [
      {
        caption: "Why the map went blank, and where the fix sits",
        code: `flowchart TD
  A[GET /api/drive-lists/:slug] --> B[load drive_list_stops]
  B --> C{stop has own lat/lng?}
  C -- yes --> P[plot marker]
  C -- "no, but links showroom" --> F[fillMissingStopCoords: coalesce from showroom]
  C -- "no, no showroom" --> N[stop omitted from map]
  F --> P
  P --> M{any plotted stop?}
  M -- yes --> MAP[render MapLibre route map]
  M -- no --> ICON[empty pin fallback — the reported bug]
  classDef fix fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef bug fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class F,MAP fix
  class ICON bug`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_244.mjs",
      command: "pnpm run test:pr 244 -- --preview   # and bare against prod (regression)",
      ranAt: "2026-07-25",
      output:
        "PREVIEW (fix):  4 passed, 0 failed — 23/23 drives render a map, 94/94 linked stops carry coords,\n" +
        "  'no drive links showrooms yet renders an empty map' assertion PASSES.\n" +
        "PROD (old code): 3 passed, 0 failed — list + detail 200/shape regression guards pass;\n" +
        "  9/23 drives map, 28/94 linked stops with coords; coord-backfill assertion reported\n" +
        "  PENDING merge/deploy (14 offending drives on prod, the bug).\n" +
        "pnpm run build (astro/esbuild — the deploy path) passes. tsc adds two spurious .set()\n" +
        "inference errors on byte-identical unchanged code — the known drizzle-0.33 instability\n" +
        "that already blankets ~50 baseline files; runtime unaffected.",
      migrations: [],
    },
  },
  "tesla-stream-ui": {
    slug: "tesla-stream-ui",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · the operator's on/off switch + live mode",
    problem:
      "The streaming lifecycle (#241) and the DO (#242) are entirely backend — the operator had no way to turn live streaming on/off, and no way to see whether ingest was streaming, polling, or idle at a glance. The spec called for a toggle on the drive-list UI, with polling as the explicit fallback when the toggle is off.",
    approach:
      "A small header card on the Showroom Drives page. A Switch writes the toggle through POST /api/tesla/stream/control; a status pill reads /control + /status every 15s and derives the mode — Streaming when the DO reports connected, Polling when a drive is active but the stream isn't carrying (toggle off / outside window / socket down), Idle otherwise, and Tripped when the circuit breaker is set. Every state carries a one-line reason (the 07:00–20:00 window, the fallback cadence, or 'no active drive') so the mode is self-explanatory. The widget removes itself when the routes 404, so a worker that predates the ingest deploy shows nothing rather than a broken card.",
    apiChanges: ["(none — consumes /api/tesla/stream/control + /status from #241/#242)"],
    filesTouched: [
      "src/frontend/components/drives/TeslaStreamControl.tsx (new)",
      "src/frontend/components/drives/DriveListsApp.tsx",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "The pill's three (plus one) states",
        code: `stateDiagram-v2
  [*] --> Idle
  Idle --> Streaming: toggle ON · drive active · 07-20 · connected
  Streaming --> Polling: toggle OFF (drive active)
  Polling --> Streaming: toggle ON (in window)
  Streaming --> Idle: drive ended / window closed
  Streaming --> Tripped: circuit breaker`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_247.mjs",
      command: "pnpm run test:pr 247 -- --preview   # and prod (regression)",
      ranAt: undefined,
      output:
        "AUTHORED, NOT YET RUN. Regression guard: the drives page serves (200) and the\n" +
        "two endpoints the widget reads are reachable and shaped as the component expects.\n" +
        "Read-only; runs against preview and prod.",
      migrations: [],
    },
  },
  "tesla-stream-do": {
    slug: "tesla-stream-do",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · the outbound socket, built cost-safe",
    problem:
      "TESLA_DB is empty because nothing holds Tessie's real-time telemetry — it's an OUTBOUND WebSocket the client dials, not a webhook. But an outbound socket the worker holds is DURATION-BILLED the whole time, and the $700 DO runaway proved an unbounded alarm loop can bill into the thousands. So the connector can't just 'open a socket' — it has to be incapable of running away and incapable of staying open when it isn't earning its keep.",
    approach:
      "A singleton Durable Object whose every native-alarm tick re-checks shouldStreamNow (active drive ∧ 07:00–20:00 Pacific ∧ recording ∧ toggle) and drops the socket + goes dormant the moment that's false. Alarms are native ctx.storage.setAlarm (single slot, replaces — never the append-only Agents-SDK schedule that caused #162). Every fire also runs the shared circuit breaker: the global kill-switch, a native fire-rate window (reconnect-storm guard), a per-UTC-day TESLA_DB write budget, and a max-continuous-connected backstop — any trip hard-stops with no reschedule. Frames parse through the shared extractTelemetryFields; persistence is throttled (always on a shift change, otherwise ≤ every 5s) so a ~500ms firehose can't become an unbounded D1 write cost; on the shift→P transition it mirrors the poller (match+mark the nearest stop, auto-nav the next, and close the drive on home arrival — which also drops the socket). Drive activation signals the DO start/stop so ingest is event-driven, but the DO's own guard stays the source of truth.",
    apiChanges: [
      "POST /api/tesla/stream/start — arm the DO lifecycle (safe no-op outside the window).",
      "POST /api/tesla/stream/stop — disconnect + stop now.",
      "GET /api/tesla/stream/status — connected, connectedSinceMs, writesToday, breaker, nextAlarmMs.",
    ],
    filesTouched: [
      "src/backend/durable-objects/tesla-stream.ts (new)",
      "wrangler.jsonc (TESLA_STREAM binding + migration v16)",
      "src/_worker.ts (export TeslaStreamDO)",
      "src/backend/api/routes/tesla.ts (stream start/stop/status)",
      "src/backend/api/routes/drive-lists.ts (activation → DO signal)",
      "src/backend/services/tesla/gating.ts + tesla-poller.ts (KV floor + heartbeat)",
    ],
    migrations: [
      { tag: "v16", sql: '-- DO migration: new_sqlite_classes ["TeslaStreamDO"] (no D1 DDL)' },
    ],
    diagrams: [
      {
        caption: "Every alarm: circuit breaker → lifecycle → connect/heartbeat/dormant",
        code: `flowchart TD
  A["native alarm"] --> CB{"breaker ok?"}
  CB -->|trip| STOP["close · deleteAlarm · dormant"]
  CB -->|ok| LC{"shouldStreamNow?"}
  LC -->|no| STOP
  LC -->|yes| C["connect / heartbeat · re-arm 90s"]
  F["frame → P"] --> H{"home?"}
  H -->|yes| STOP`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_242.mjs",
      command: "pnpm run test:pr 242 -- --preview   # and prod (regression)",
      ranAt: undefined,
      output:
        "AUTHORED, NOT YET RUN. Read-only QC (status contract + control regression + the\n" +
        "60s cadence floor); it never calls /start, which would open a real Tessie socket.\n" +
        "Live connect/disconnect is smoke-tested manually against the preview worker with\n" +
        "Tessie configured. New routes report PENDING against prod until merge+deploy.",
      migrations: [{ tag: "v16", applied: false }],
    },
  },
  "receipt-review-hitl": {
    slug: "receipt-review-hitl",
    branch: "claude/receipt-review-hitl-4808",
    subtitle: "Shopping · 0030 receipt→room deduction, the review surface",
    problem:
      "The 0030 engine (shipped #229/#236) reads an emailed receipt, and for each line item deduces which room the material belongs to — a receipt of three toilets is split across three bathrooms by homogeneity, product-nature, and open-slot signals. But a deduction is an educated guess, and nothing should enter the materials schedule on a guess. Until this PR the proposals sat staged in D1 with no way for the owner to review them: the MCP tools could resolve one conversationally, but there was no visual queue to see a whole receipt at once, read the reasoning, and correct the rooms the engine placed wrong.",
    approach:
      'A receipt-grouped HITL queue at /admin/shopping/receipt-review. Staged room_proposals are fetched and grouped by invoiceId — one card per receipt — and each line item shows the proposed room, the confidence, and the engine\'s reasoning. The room is editable from a dropdown of the ELIGIBLE candidate rooms the engine considered; for the cases it gets way wrong, the dropdown also carries an "Other room…" entry that opens a modal with RoomSelect over ALL rooms (floor-grouped, searchable). "Confirm all" walks the receipt\'s proposals and resolves each via the #236 endpoint, which mints the material against the chosen roomId FK. Frontend-only — no schema change, no new endpoint. The page is the standard thin Astro shell (BaseLayout, icon header, `class` not `className`) mounting one React island.',
    apiChanges: [
      "No new endpoints. Reuses GET /api/materials/room-proposals?status=staged and POST /api/materials/room-proposals/:id/resolve from #236, and GET /api/rooms/catalog for the Other-room modal.",
    ],
    filesTouched: [
      "src/frontend/components/materials/ReceiptReviewApp.tsx (new)",
      "src/frontend/pages/admin/shopping/receipt-review.astro (new)",
      "src/frontend/components/sidebar/nav-groups.ts (+1 link)",
    ],
    migrations: [],
    code: [
      {
        title: "Per-line room picker — eligible candidates + an Other-room escape hatch",
        lang: "tsx",
        code: `<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="outline" />}>
    {chosenRoomName ?? proposal.proposedRoomName ?? "Pick a room"}
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    {proposal.candidates.map((c) => (
      <DropdownMenuItem key={c.roomId} onClick={() => setRoom(proposal.id, c.roomId)}>
        {c.roomName}
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    {/* way-wrong escape hatch → modal over ALL rooms */}
    <DropdownMenuItem onClick={() => setOtherOpen(proposal.id)}>Other room…</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

// Confirm resolves each staged proposal against a roomId FK (never a name).
await api.post(\`/api/materials/room-proposals/\${p.id}/resolve\`, { roomId });`,
      },
    ],
    diagrams: [
      {
        caption: "Review flow — one receipt, per-line room correction",
        code: `flowchart TD
  Q[staged room_proposals] --> G[group by invoiceId]
  G --> C[receipt card: line items + reasoning]
  C --> R{room correct?}
  R -- yes --> K[keep proposed room]
  R -- "wrong, but a candidate" --> D[pick from eligible dropdown]
  R -- "way wrong" --> O["Other room… → RoomSelect over ALL rooms"]
  K --> F[Confirm all]
  D --> F
  O --> F
  F --> P["POST resolve :id {roomId} → mint material vs FK"]
  classDef keep fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  class K,F keep`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_246.mjs",
      command: "pnpm run test:pr 246 -- --preview   # and against prod (regression)",
      ranAt: "2026-07-25",
      output:
        "Preview wcrp-claude-receipt-review-hitl-4808:\n" +
        "  GET /admin/shopping/receipt-review → 200, shell + astro-island present.\n" +
        "  GET /api/materials/room-proposals?status=staged → 3 Toilet proposals under invoiceId 28\n" +
        "    (TOTO→Primary, 2 Kohler→Guest/Hall), each with candidates[] + a numeric proposedRoomId.\n" +
        "  POST /room-proposals/46/resolve {roomId:3284744} → 200, minted material #10\n" +
        '    "TOTO Washlet G5A" room=Primary Bathroom; reprocess email 3 re-stages clean.\n' +
        "  pnpm run build green; tsc --noEmit no net-new errors.",
    },
  },
  "showroom-dedup-hardening": {
    slug: "showroom-dedup-hardening",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    subtitle: "Showrooms · dedup tool v2 (bug fix + review fixes)",
    problem:
      "The dedup tool (PR #227) reparented EVERY child FK from a duplicate to the keeper. That is wrong for showroom_store_links: the seed inserts a WEBSITE link per store, and showroom_store_links has NO unique index — so reparenting a shell's seeded link would leave the kept store with two website links. The v1 leaned on `UPDATE OR IGNORE` to skip collisions, but with no unique index there is no collision to skip, so the duplicate link would simply be created. Codra's review also flagged raw sql.raw usage, sequential (non-batched) writes, loading the whole table into memory, brittle result casts, and a missing docstring.",
    approach:
      "A per-table policy replaces the blanket reparent. REPARENT (move loser→keeper) only user data worth keeping — notes, ratings, pocs, contacts, sales, images, price observations, drive stops, journal. DROP everything else — the seeded WEBSITE link, hours, scrape logs, and unique-index join mappings — by leaving it for the loser's ON DELETE CASCADE; four non-cascade artifact tables (photo buckets, product photos, scan log, sitemap) are explicitly deleted first so the store delete isn't blocked by a NO-ACTION FK. The rewrite is fully-typed Drizzle builders (no raw SQL), writes go through db.batch() (D1 has no transactions) in ≤90-param chunks, the store load selects only the 11 columns needed, a single changesOf() helper replaces the ad-hoc casts, and the export carries a JSDoc. The dry-run still prints per-table child counts, so any unexpected data on a shell (e.g. a mapping) is visible before apply.",
    apiChanges: [
      "MCP dedup_showroom_stores — same contract; corrected apply semantics + typed/batched internals.",
    ],
    filesTouched: ["src/backend/mcp/tools/showrooms/dedup_showroom_stores.ts"],
    migrations: [],
    code: [
      {
        title: "Per-table policy — reparent user data, drop the rest",
        lang: "ts",
        code: `// REPARENT (typed, batched) — user data moved to the keeper
db.update(storeRating).set({ storeId: keepId }).where(inArray(storeRating.storeId, ids)),
db.update(showroomPocs).set({ showroomId: keepId }).where(inArray(showroomPocs.showroomId, ids)),
// ...ratings, contacts, sales, images, price, drive-stops, journal

// DROP — links/hours/scrape/mappings are NOT moved. showroom_store_links has no
// unique index, so moving the seeded WEBSITE link would duplicate the keeper's.
// The loser's ON DELETE CASCADE removes them; 4 non-cascade tables deleted first.
const batch = [...reparentStmts, ...dropStmts, db.delete(showroomStores).where(inArray(showroomStores.id, ids))];
await db.batch(batch); // D1 runs a batch as one all-or-nothing unit`,
      },
    ],
    diagrams: [
      {
        caption: "Child-row disposition on apply",
        code: `flowchart TD
  L[loser row + its children] --> R{child table kind?}
  R -- "user data" --> M[reparent -> keeper]
  R -- "seeded link / hours / scrape / mapping (cascade)" --> C[leave — cascade deletes on loser delete]
  R -- "artifact, non-cascade" --> X[explicit delete first]
  M --> D[delete loser store]
  C --> D
  X --> D
  classDef keep fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class M keep
  class C,X,D stop`,
      },
    ],
    verification: {
      qcScript: "MCP dedup_showroom_stores (dry-run)",
      command: "dedup_showroom_stores {}  (dry-run, via the MCP connector)",
      ranAt: "2026-07-25",
      output:
        "npx tsc --noEmit — 0 errors in the rewritten tool. Dry-run runs server-side via the\n" +
        "connector; its per-table child counts are reviewed before any apply. No rows deleted\n" +
        "without approval.",
    },
  },
  "tesla-stream-lifecycle-control": {
    slug: "tesla-stream-lifecycle-control",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    subtitle: "0023 Ingest · lifecycle gating before the socket exists",
    problem:
      "The next PR adds TeslaStreamDO, which holds an OUTBOUND WebSocket to streaming.tessie.com. Unlike an inbound hibernatable socket, an outbound one the worker dials is DURATION-BILLED the whole time it's held — a DO left connected 24/7 is exactly the always-on cost the $700 incident taught us to fear. So before the DO exists, the lifecycle rules that keep it from running unnecessarily have to be in place and testable, and the poller that #178 shipped (a cron fallback) has to know when to stand down so the two paths never double-process one drive.",
    approach:
      "One decision surface — services/tesla/gating.ts — answers 'should the stream be connected now?' and 'should the poller run instead?' so the DO, the control routes, and the scheduled tick all agree. The stream is alive only when ALL hold: a drive is active, local time is inside the daytime window (default 07:00–20:00 Pacific, computed with Intl so DST is correct on a UTC worker), telemetry recording is on, and the UI toggle is on. shouldStreamNow / shouldPollNow are complementary — exactly one covers an active drive, so there's no gap and no overlap. The frame extractors were lifted verbatim out of routes/tesla.ts into services/tesla/frames.ts so the DO and the compat webhook parse identically. Config lives in project_system_variables (one batched read), the poller stands down on a DO-set connected flag and throttles on a configurable cadence, drive activation is 409'd outside the window, and enforceStreamWindow (run each scheduled minute) deactivates a drive once the window closes.",
    apiChanges: [
      "GET /api/tesla/stream/control — { control, shouldStream, shouldPoll } (admin).",
      "POST /api/tesla/stream/control — set { enabled?, windowStartHour?, windowEndHour?, pollFallbackSeconds? }; inverted window → 400.",
      "PATCH /api/drive-lists/:slug { isActive:true } now → 409 outside the 07:00–20:00 window.",
    ],
    filesTouched: [
      "src/backend/services/tesla/frames.ts (new)",
      "src/backend/services/tesla/gating.ts (new)",
      "src/backend/services/tesla-poller.ts",
      "src/backend/api/routes/tesla.ts",
      "src/backend/api/routes/drive-lists.ts",
      "src/_worker.ts",
    ],
    migrations: [],
    diagrams: [
      {
        caption: "When the streaming DO is alive vs when the poller takes over",
        code: `stateDiagram-v2
  [*] --> Idle
  Idle --> Streaming: drive active AND 07:00-20:00 AND recording AND toggle ON
  Streaming --> Polling: toggle OFF (drive still active)
  Polling --> Streaming: toggle ON (inside window)
  Streaming --> Idle: car home OR 20:00 close
  Polling --> Idle: car home OR 20:00 close`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_241.mjs",
      command: "pnpm run test:pr 241 -- --preview   # and against prod (regression)",
      ranAt: undefined,
      output:
        "AUTHORED, NOT YET RUN. This container has no node_modules / tokens CLI and\n" +
        "cannot reach the deployed worker, so QC runs in a toolchain env against the\n" +
        "branch preview AND prod. The control routes are new, so the prod run reports\n" +
        "them PENDING until this merges and the manual Deploy action runs.",
      migrations: [],
    },
  },
  "showroom-store-dedup-tool": {
    slug: "showroom-store-dedup-tool",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    subtitle: "Showrooms · destructive cleanup, dry-run first",
    problem:
      "The non-idempotent seed ran three times, leaving showroom_stores with 219 rows where ~159 are unique — ~60 city-only duplicate shells, with the earliest stores (Whole Wood = ids 1, 154, 188) tripled. PR #221's guard stops NEW duplication but does nothing about the rows already there. Cleaning them is genuinely dangerous: ~28 child columns across 27 tables carry a FK to showroom_stores, almost all ON DELETE CASCADE, so a blind delete silently cascades away any visit/note/rating a user attached to a duplicate. And a naive 'delete the high ids' would destroy 8 stores that exist ONLY as later-seed rows (Italdoors ×2, Craftex, Tile Tech Pavers, Topcret ×2, The Container Store, IKEA PAX).",
    approach:
      "An admin-gated MCP tool, dry-run by default. It groups rows by (normalized name + city), so distinct chain branches in different cities never share a group. Within a group it keeps the most-enriched row (zip/placeId » coords » icon/hero » phone » lowest id) and marks the rest duplicates. A hard anti-merge guard: if a group has ≥2 'real' rows (each with its own zip or placeId) it is treated as distinct locations and SKIPPED — 'All Natural Stone' in four cities is left untouched. The dry run writes nothing and returns the full keep/delete map plus, per duplicate, the count of child rows in every FK table — the 'is real data attached?' signal a human approves before anything is deleted. apply:true reparents each child FK from loser to keeper (UPDATE OR IGNORE for unique-mapping join tables, whose skipped rows are then swept by ON DELETE CASCADE; plain UPDATE elsewhere so the row definitely moves before its loser is deleted), then deletes the losers — chunked under D1's 100-bound-param cap.",
    apiChanges: [
      "MCP dedup_showroom_stores — DESTRUCTIVE. Dry-run (default) returns {duplicateGroups, rowsToDelete, rowsAfter, ambiguousGroupsSkipped, childRowsToReparent, plan[]}. apply:true performs reparent + delete.",
    ],
    filesTouched: [
      "src/backend/mcp/tools/showrooms/dedup_showroom_stores.ts",
      "src/backend/mcp/tools/showrooms/index.ts",
    ],
    migrations: [],
    code: [
      {
        title: "Anti-merge guard — never collapse two genuine locations",
        lang: "ts",
        code: `const reals = rows.filter(isReal); // isReal = has zip OR placeId
if (reals.length >= 2) {
  // Two distinct genuine locations sharing (name, city). Do NOT merge —
  // that would destroy a real store. Leave the whole group for a human.
  ambiguous.push({ key, ids: rows.map(r => r.id), reason: "distinct locations" });
  continue;
}
// 0 or 1 real row: the rest are city-only shells → safe to collapse.
const sorted = [...rows].sort((a, b) => score(b) - score(a) || a.id - b.id);
const keep = sorted[0];
const deleteIds = sorted.slice(1).map(r => r.id);`,
      },
    ],
    diagrams: [
      {
        caption: "Per-group decision — keep the enriched row, skip ambiguous groups",
        code: `flowchart TD
  A[group rows by name + city] --> B{group size > 1?}
  B -- no --> K[keep single row]
  B -- yes --> C{>= 2 rows have zip/placeId?}
  C -- "yes (distinct branches)" --> S[SKIP group — report ambiguous]
  C -- no --> D[keep highest-scored row]
  D --> E[reparent child FKs loser -> keeper]
  E --> F[delete losers]
  classDef keep fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class K,D,E keep
  class F,S stop`,
      },
      {
        caption: "Reparent-then-delete across the child FK tables",
        code: `sequenceDiagram
  participant T as dedup tool
  participant D as D1
  T->>D: UPDATE (OR IGNORE) child.fk = keepId WHERE fk IN losers
  Note over T,D: plain UPDATE for logs/observations;\\nOR IGNORE for unique-mapping join tables
  T->>D: DELETE FROM showroom_stores WHERE id IN losers
  D-->>T: ON DELETE CASCADE sweeps any OR-IGNORE-skipped rows`,
      },
    ],
    prNumber: 227,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/227",
    verification: {
      qcScript: "MCP dedup_showroom_stores (dry-run)",
      command: "dedup_showroom_stores {}  (dry-run, via the MCP connector)",
      ranAt: "2026-07-25",
      output:
        "npx tsc --noEmit — 0 errors in the new tool + barrel.\n" +
        "Dry-run executes server-side via the MCP connector (this container has no prod DB\n" +
        "access). The keep/delete map + per-table child-row counts are produced by the\n" +
        "dry-run for human approval BEFORE any apply:true call. No rows deleted without that\n" +
        "approval.",
    },
  },
  "brands-name-key-dedup": {
    slug: "brands-name-key-dedup",
    branch: "claude/showroom-location-tagging-ex2ik5",
    subtitle: "Brands · dedup + integrity guard (ops #4)",
    problem:
      "A bulk import forked the brand roster: it inserted ALL-CAPS / respaced restatements of brands that already existed, so a single company appeared as two `brands` rows, each holding half its showroom and type mappings. Nine such pairs were logged in ops issue #4 (e.g. `#188 Newport Brass` / `#302 NEWPORTBRASS`, `#18 Dornbracht` / `#315 DORN BRACHT`, `#184 Visual Comfort` / `#221 Visual Comfort & Co.`). The two mapping tables each carry a UNIQUE pair — `brand_type_mappings(brand_id, type_id)` and `showroom_brand_mappings(showroom_id, brand_id)` — so naively repointing a loser's rows to the survivor hits a unique violation on the pairs that overlap, aborting a merge half-applied. Nothing at the schema level stopped the next import from forking the roster again.",
    approach:
      "Merge in the 0118 order that cannot lose data, then add a schema-level guard. For the last live pair (Visual Comfort): delete the loser's colliding `brand_type_mappings` row (survivor already holds that type), repoint the remaining FK rows to the survivor, carry the loser's spelling across as a demoted (`is_primary=0`) alias, COALESCE any scalar the survivor was missing, and finally soft-retire the loser (`is_active=0`, never DELETE — every brand FK is ON DELETE cascade). Then a PARTIAL unique index enforces the invariant going forward. The normalization strips case + spaces + dots + commas so restatements collapse; `WHERE is_active = 1` is mandatory because dedup keeps losers as soft-deleted rows and 6 active/retired pairs share a name key — a full index would refuse to create. Suffix variants (`& Co.`) still differ after stripping and stay the intake layer's job.",
    apiChanges: [
      "No API surface change. Schema-only: new partial unique index brands_name_key_uniq.",
      "Future create_brand / ensure_brand inserts that would fork an active brand by case/spacing now fail loudly at the DB instead of silently duplicating.",
    ],
    filesTouched: [
      "src/backend/db/schema/brands/brands.ts",
      "drizzle/0138_white_hedge_knight.sql",
      "drizzle/meta/0138_snapshot.json",
    ],
    migrations: [
      {
        tag: "0138",
        sql: `CREATE UNIQUE INDEX \`brands_name_key_uniq\` ON \`brands\` (replace(replace(replace(lower(trim("name")),' ',''),'.',''),',','')) WHERE "brands"."is_active" = 1;`,
      },
    ],
    code: [
      {
        title: "Partial unique index — brands.ts",
        lang: "ts",
        code: `export const brands = sqliteTable("brands", {
  // …columns…
}, (table) => ({
  // Two ACTIVE brands may not share a normalized name key. Strips case + spaces
  // + dots + commas so bulk-import restatements ("Newport Brass" / "NEWPORTBRASS")
  // collapse to one. PARTIAL on is_active=1 — dedup soft-deletes losers, and 6
  // active/retired pairs share a name key, so a full index would refuse to create.
  nameKeyUniq: uniqueIndex("brands_name_key_uniq")
    .on(sql\`replace(replace(replace(lower(trim(\${table.name})),' ',''),'.',''),',','')\`)
    .where(sql\`\${table.isActive} = 1\`),
}));`,
      },
    ],
    diagrams: [
      {
        caption:
          "The merge — loser's rows repoint to the survivor, then the loser is retired (never deleted)",
        code: `flowchart TD
  L["#221 Visual Comfort & Co.<br/>(loser)"] -->|"drop colliding<br/>type_id=21 row"| T[brand_type_mappings]
  L -->|"repoint showroom 136"| S[showroom_brand_mappings]
  L -->|"carry spelling as<br/>is_primary=0 alias"| V[brand_name_variations]
  L -->|"COALESCE blank scalars"| K["#184 Visual Comfort<br/>(survivor · showrooms 121+136)"]
  L -->|"is_active = 0<br/>(soft-retire, keep FKs)"| R[(retired)]
  classDef keep fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class K keep
  class R stop`,
      },
      {
        caption:
          "The guard — a partial unique index over the normalized name key of ACTIVE brands only",
        code: `erDiagram
  brands {
    int id PK
    text name
    int is_active "soft-delete flag"
  }
  brands ||--o| brands_name_key_uniq : "UNIQUE(norm(name)) WHERE is_active=1"
  brands_name_key_uniq {
    expr key "replace(...lower(trim(name))...) — strips case/space/dot/comma"
    partial where "is_active = 1 — retired losers exempt"
  }`,
      },
    ],
    prNumber: 223,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/223",
    verification: {
      qcScript: "n/a — data + index change verified directly against remote D1",
      command: "cloudflare D1 /query (read-back after merge)",
      source:
        "SELECT id,name,is_active FROM brands WHERE id IN (184,221);\n" +
        "SELECT showroom_id FROM showroom_brand_mappings WHERE brand_id=184;\n" +
        "SELECT replace(replace(replace(lower(trim(name)),' ',''),'.',''),',','') k, count(*) c\n" +
        "  FROM brands WHERE is_active=1 GROUP BY k HAVING c>1;",
      ranAt: "2026-07-25",
      output:
        "Merge (applied to remote): #184 Visual Comfort active; #221 retired (is_active=0);\n" +
        "#184 now carries showrooms [121, 136]; 0 residual rows point at #221;\n" +
        "active brands 385 -> 384; 0 mechanical name-key collisions remain.\n" +
        "Index migration 0138: `pnpm run db:generate` is a clean no-op (schema <-> snapshot\n" +
        "<-> .sql consistent). NOT yet on remote D1 — applies via `pnpm run migrate:remote`\n" +
        "(schema changes don't ride the build); verify brands_name_key_uniq exists after deploy.",
    },
  },
  "showroom-seed-bootstrap-only": {
    slug: "showroom-seed-bootstrap-only",
    branch: "claude/showroom-listing-500-map-6kvtm9",
    subtitle: "Showrooms · seed hygiene",
    problem:
      "`seedShowroomStores` inserts a FIXED list of ~146 stores straight into `showroom_stores`. The seed rows carry no natural key — no `placeId`, no unique slug — and the function had no guard, so it inserted unconditionally every time it ran. `POST /api/showroom-stores/seed` is meant as a one-shot bootstrap for an empty database, but nothing stopped it being called twice. It was, and production ended up with 213 store rows where there should be 146: 'Whole Wood' appeared three times, dozens of others twice. Because the duplicates are byte-identical to the originals, the directory list and map silently doubled up, and every downstream join (links, hours, visits, ratings) fanned out across the clones.",
    approach:
      "The seed's contract is 'populate an EMPTY directory', so it now enforces that contract. Before inserting anything it does a `SELECT id ... LIMIT 1`; if any store already exists it logs and returns `{ inserted: 0, skipped }` without writing a row. Re-running the seed against a populated table is now a safe no-op instead of a duplication event. This is deliberately the smallest possible change — it stops the bleeding. Removing the rows already duplicated is a destructive operation (choose the best row per store, reparent every child FK, delete the rest) and is held as a separate, sign-off-gated step rather than bundled into this fix.",
    apiChanges: [
      "UNCHANGED surface: POST /api/showroom-stores/seed still returns 200, but on a populated DB it now inserts nothing (was: cloned every store).",
    ],
    filesTouched: ["src/backend/db/seeds/seed-showroom-stores.ts"],
    migrations: [],
    code: [
      {
        title: "Bootstrap-only guard — seed-showroom-stores.ts",
        lang: "ts",
        code: `/**
 * Seeds the showroom stores table with initial data if it is empty.
 *
 * @param db The Drizzle database instance.
 */
export async function seedShowroomStores(db: DrizzleD1Database) {
  const stores = getStoreData();

  // Bootstrap-only + idempotent. This seed inserts a FIXED list with no natural
  // key (seed rows carry no placeId), so re-running it on a populated table just
  // clones every store — a repeat POST /api/showroom-stores/seed did exactly
  // that, producing a second and third "Whole Wood" etc. The seed exists only to
  // bootstrap an EMPTY directory, so bail the moment any store already exists.
  const [existing] = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .limit(1);
  if (existing) {
    console.log(
      "Showroom stores already present — skipping seed (bootstrap-only; re-seeding would duplicate rows).",
    );
    return { inserted: 0, skipped: stores.length };
  }
  // …unchanged insert loop below…
}`,
      },
    ],
    diagrams: [
      {
        caption: "Seed decision — the guard turns a re-run into a no-op",
        code: `flowchart TD
  A[POST /api/showroom-stores/seed] --> B{any showroom_stores row exists?}
  B -- "no (empty DB)" --> C[insert fixed list<br/>~146 stores + WEBSITE links]
  C --> D[return inserted: 146]
  B -- "yes (populated)" --> E[skip — return inserted: 0, skipped]
  classDef ok fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef stop fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  class C,D ok
  class E stop`,
      },
    ],
    prNumber: 221,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/221",
    verification: {
      qcScript: "scripts/qc/pr_221.mjs",
      command: "pnpm run test:pr 221",
      source:
        "const before = d1('SELECT COUNT(*) n FROM showroom_stores;')[0]?.n;\n" +
        "const res = await c.post('/api/showroom-stores/seed', {});\n" +
        "const after = d1('SELECT COUNT(*) n FROM showroom_stores;')[0]?.n;\n" +
        "check('re-seed did NOT add rows (bootstrap-only guard held)', after === before);",
      ranAt: "2026-07-25",
      output:
        "npx tsc --noEmit — 0 new errors in seed-showroom-stores.ts.\n" +
        "pnpm run build — Complete (server built, prerender OK).\n" +
        "pnpm run test:pr 221 — AUTHORED, NOT YET RUN. This session runs in a remote\n" +
        "container with no `tokens` CLI and no CLOUDFLARE_API_TOKEN, so it cannot reach\n" +
        "the deployed worker or remote D1. The idempotency regression guard must be run\n" +
        "against prod from a toolchain-equipped environment before merge; result pending.",
    },
  },
  "tesla-location-ai-p6": {
    slug: "tesla-location-ai-p6",
    subtitle: "0023 Phase P6 — the in-car assistant's location tools",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    prNumber: 220,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/220",
    introduction:
      "For an AI riding along in the car. These are the two MCP tools it calls to know where the driver is and what's worth a stop — enriched by the worker so the model gets a heading, a street address and a freshness stamp rather than bare coordinates, and gated so a 'what's near me?' can never quietly spend past Google's free tier.",
    problem:
      "`get_vehicle_location` returned four fields — latitude, longitude, a raw Tessie address, and a map URL. An in-car assistant can't say 'you're heading north-west on El Camino' from that: there was no heading (Tessie reports it, but `getLocation` never parsed it), no way to fill an address when Tessie omitted one, and no freshness signal, so a minutes-old fix read exactly like a live one. And there was no tool at all for the core on-the-road question — 'which showrooms are near me right now, and which way?' — even though the coordinates to answer it already sit on `showroom_stores` and the quota-safe Places/Geocoding methods shipped in #185.",
    approach:
      "get_vehicle_location is enriched in place rather than forked into a second tool. `getLocation` now parses Tessie's `heading` and fix `timestamp` (fail-soft, normalizing the seconds-or-ms the firmware varies on); the tool converts heading to a 16-point compass, fills a missing address via the quota-gated `reverseGeocode` (Geocoding SKU, degrades to null — never bills past free tier, never fails the call), derives the Bay Area region, and stamps serverTime + ageSeconds + isStale, treating an unknown age as stale so a possibly-old fix is never narrated as live. whats_near_me is new: it resolves the origin the same way get_user_location does (explicit coords → live Tesla GPS → last phone fix), then ranks registered showrooms by haversine distance with a bearing + compass to each, and on request sweeps quota-gated placesNearby for undiscovered nearby spots (de-duped against known showrooms by proximity). Crucially, every showroom coordinate is read through ONE helper, loadShowroomCoords — the single seam that survives the anticipated move of location data off showroom_stores. A prior audit confirmed that move is not yet in flight (no such table in any schema, PR, or branch), so reading showroom_stores today is correct, and isolating it means the future move is a one-line change.",
    apiChanges: [
      "MCP get_vehicle_location — enriched output: heading, headingCompass, address (reverse-geocoded fallback), region, serverTime, ageSeconds, isStale, note (was: latitude, longitude, address, mapUrl)",
      "MCP whats_near_me (NEW) — inputs latitude?/longitude?/radiusMeters?/limit?/includeUndiscovered?; returns origin, showrooms[{distance, bearing, compass}], undiscovered[], note",
      "No REST or schema change; both Google paths are the already-shipped quota-gated reverseGeocode/placesNearby",
    ],
    filesTouched: [
      "src/backend/mcp/tools/tesla/get_vehicle_location.ts",
      "src/backend/mcp/tools/showrooms/whats_near_me.ts",
      "src/backend/mcp/tools/showrooms/_shared.ts",
      "src/backend/mcp/tools/showrooms/index.ts",
      "src/backend/services/tesla.ts",
      "src/backend/services/drive-geo-match.ts",
      "scripts/qc/pr_220.mjs",
    ],
    migrations: [],
    code: [
      {
        title: "The single coordinate-source seam (survives the showroom_stores_locations move)",
        lang: "ts",
        code: `// _shared.ts — THE only place showroom coordinates are read for proximity.
// When location data moves off showroom_stores, change this query and every
// proximity caller (whats_near_me, the P4 park-scan) follows automatically.
/**
 * Loads the coordinates for all active showrooms for proximity calculations.
 *
 * @param db The database instance.
 * @returns A promise that resolves to an array of showroom coordinates.
 */
export async function loadShowroomCoords(db: RemodelDb): Promise<ShowroomCoord[]> {
  const rows = await db
    .select({
      id: showroomStores.id,
      name: showroomStores.name,
      latitude: showroomStores.latitude,
      longitude: showroomStores.longitude,
      address: showroomStores.locationAddress,
      hubName: showroomStores.hubName,
    })
    .from(showroomStores)
    .where(and(isNotNull(showroomStores.latitude), isNotNull(showroomStores.longitude)))
    .all();
  return rows.filter((r): r is ShowroomCoord => r.latitude != null && r.longitude != null);
}`,
      },
      {
        title: "Freshness: an unknown age is treated as stale, never narrated as live",
        lang: "ts",
        code: `const ageSeconds =
  loc.timestampMs != null ? Math.max(0, Math.round((nowMs - loc.timestampMs) / 1000)) : null;
// Unknown age ⇒ stale — better to under-promise freshness than to imply a live fix.
const isStale = ageSeconds == null || ageSeconds > STALE_AFTER_SECONDS;`,
      },
    ],
    diagrams: [
      {
        caption: "Enrichment round-trip",
        title: "get_vehicle_location — enrich, quota-safe, freshness-stamped",
        description:
          "The reverse-geocode only fires when Tessie omitted an address, and it is on the Geocoding SKU so a blown quota degrades to a null address instead of failing the call.",
        code: `sequenceDiagram
  participant AI as In-car AI
  participant V as get_vehicle_location
  participant Tess as Tessie /location
  participant G as GoogleMaps (geocoding SKU)
  AI->>V: where am I / which way?
  V->>Tess: getLocation (fresh)
  Tess-->>V: lat/lng, heading, fix-time
  alt no address on the fix
    V->>G: reverseGeocode (quota-gated)
    G-->>V: address | null (fail-soft)
  end
  V-->>AI: coords + compass + address + region + serverTime/ageSeconds/isStale`,
      },
      {
        caption: "whats_near_me flow",
        title: "whats_near_me — origin resolution, ranking, and the coordinate seam",
        description:
          "Origin falls back explicit → Tesla → phone. Registered showrooms are read through loadShowroomCoords (the one seam); the optional Places sweep is quota-gated and de-duped against known showrooms.",
        code: `flowchart TD
  A(["whats_near_me"]) --> O{"explicit coords?"}
  O -->|yes| ORIG["origin = explicit"]
  O -->|no| T{"live Tesla GPS?"}
  T -->|yes| ORIG2["origin = tesla (+heading)"]
  T -->|no| P{"last phone fix?"}
  P -->|yes| ORIG3["origin = phone"]
  P -->|no| ERR["clean tool error"]:::bad
  ORIG --> LC["loadShowroomCoords(db)<br/>THE coordinate seam"]:::seam
  ORIG2 --> LC
  ORIG3 --> LC
  LC --> RANK["haversine + bearing → sort → limit"]:::ok
  RANK --> U{"includeUndiscovered?"}
  U -->|yes| PLACES["placesNearby (quota-gated)<br/>dedupe vs known"]:::ok
  U -->|no| OUT["showrooms + note"]:::ok
  PLACES --> OUT
  classDef ok fill:#1f4d2e,stroke:#4ade80,color:#e6ffe6
  classDef bad fill:#4d1f1f,stroke:#f87171,color:#ffe6e6
  classDef seam fill:#1f2f4d,stroke:#60a5fa,color:#e6f0ff`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_220.mjs",
      command: "pnpm run test:pr 220 -- --preview  &&  pnpm run test:pr 220",
      source: `// Registry-catalog integrity (the tools are OAuth-gated MCP; the public
// /api/mcp-docs catalog is the honest wire check per AGENTS.md).
const wnm = byName("whats_near_me");
checks.ok("whats_near_me outputs origin/showrooms/undiscovered/note",
  has(fieldNames(wnm), "origin", "showrooms", "undiscovered", "note"));
const gvl = byName("get_vehicle_location");
checks.ok("get_vehicle_location exposes the enriched output fields",
  has(fieldNames(gvl), "heading","headingCompass","address","region","serverTime","ageSeconds","isStale"));`,
      output:
        "NOT YET RUN in this environment — the session container has no node_modules/toolchain (WORKER_API_KEY is a remote-only secrets-store binding with no local fallback). QC must run in a toolchain env against --preview AND prod; the whats_near_me + enriched-field checks report PENDING against prod until this merges and `pnpm run deploy` runs. Real output will be pasted here once executed.",
      ranAt: undefined,
      migrations: [],
    },
  },
  "0029-health-platform": {
    slug: "0029-health-platform",
    branch: "claude/backend-health-checks-d1-d6df78",
    prNumber: 195,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/195",
    problem:
      "The health surface shipped in 0027 was five hardcoded binding pings written into one file: D1, TESLA_DB, KV, R2, and a presence check on the AI binding. Everything else this Worker depends on was unwatched — three Vectorize indexes, nine Workflows, fourteen Durable Object namespaces, roughly thirty Secrets Store credentials, Cloudflare Images, the MCP tool registry, the inbound email pipeline, the Tesla telemetry database, and every relational invariant in the sourcing data. Nothing watched cost at all, on an account that had already burned about $50/day for weeks on a Durable Object doing full table scans and only found out from an invoice. And the output was undiagnosable: a row reading `kv_cache: down` told a reader nothing about what that meant, where the code lived, or what to do next — that knowledge existed only in somebody's head. There was also no notion of a session, so `health_checks` could not answer what the system looked like at a particular moment, and the whole thing was served publicly while being, in substance, a map of internal infrastructure.",
    approach:
      "Ownership moved to the modules. Each backend module now exports HEALTH_PROBES from its own health.ts, and a probe is BOTH the executable check and its own documentation — whatSuccessMeans, whatFailureMeans, troubleshootingSteps, devOpsPlaybook, the bindings it touches, its severity, and whether it watches spend are literal fields on the object. The runner upserts those literals into health_test_def on every run, so the runbook a human reads is generated from the code that ran; there is no seed SQL and no second copy to drift. Cost discipline is a hard rule rather than a preference: a probe may read a binding, read a secret, run a D1 aggregate, do one tiny KV round trip, or head an R2 key — it may never invoke a model, call a paid API, create a Workflow instance, or enumerate a bucket. The whole 88-probe screen costs nothing and finishes in about two seconds, which is what makes it clickable rather than ceremonial. Reconciling with #169, which landed a competing health surface mid-flight, was done by bridging rather than replacing: its data-quality registry keeps its own shape and endpoint, and its checks are wrapped as probes so one run covers both and everything lands in one ledger.",
    apiChanges: [
      "POST /api/health/session — run every registered probe, persist one row per probe under a shared session_uuid (admin)",
      "GET  /api/health/session/latest — the last persisted session, for first paint and the header pip (admin)",
      "GET  /api/health/sessions — recent sessions, newest first, rolled up (admin)",
      "GET  /api/health/catalogue — every test with its full runbook, grouped for the dashboard (admin)",
      "GET  /api/health/badge — status + counts only; returns null rather than 401 for an unauthed request (admin-aware)",
      "MCP run_health_session — the third trigger, with failuresOnly and billingOnly filters",
      "UNCHANGED: GET /api/health and POST /api/health/run stay public — external uptime monitors read them",
    ],
    filesTouched: [
      "src/backend/services/health/types.ts",
      "src/backend/services/health/probes.ts",
      "src/backend/services/health/run.ts",
      "src/backend/db/schema/health/health_tests.ts",
      "src/backend/{db,api,ai,mcp,realtime}/health.ts",
      "src/backend/services/{workflows,ai-gateway,usage,render,email,gmail,google,google-photos,tesla,showroom,documents,image-processor}/health.ts",
      "src/backend/api/routes/health.ts",
      "src/backend/mcp/tools/ops/run_health_session.ts",
      "src/frontend/components/health/HealthDashboardApp.tsx",
      "src/frontend/components/health/HealthStatusBadge.tsx",
      "src/frontend/pages/admin/system/health.astro",
      "src/frontend/components/AppHeader.tsx",
      "src/frontend/components/sidebar/AdminSidebar.tsx",
      "src/frontend/components/sidebar/nav-groups.ts",
      "src/_worker.ts",
      "scripts/qc/pr_195.mjs",
    ],
    migrations: [
      {
        tag: "0125_supreme_dust",
        sql: `CREATE TABLE \`health_test_def\` (
\tid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\tname text NOT NULL,
\tdisplay_name text NOT NULL,
\tdescription text NOT NULL,
\thealth_ts_filepath text NOT NULL,
\twhat_success_means text NOT NULL,
\twhat_failure_means text NOT NULL,
\ttroubleshooting_steps text NOT NULL,
\tdev_ops_playbook text NOT NULL,
\tis_billing_risk integer DEFAULT false NOT NULL,
\tseverity text DEFAULT 'MEDIUM' NOT NULL,
\tis_active integer DEFAULT true NOT NULL,
\tcreated_at integer DEFAULT (unixepoch()) NOT NULL,
\tupdated_at integer DEFAULT (unixepoch()) NOT NULL
);
CREATE UNIQUE INDEX \`health_test_def_name_idx\` ON \`health_test_def\` (\`name\`);

CREATE TABLE \`health_results\` (
\tid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\ttimestamp integer DEFAULT (unixepoch()) NOT NULL,
\tsession_uuid text NOT NULL,
\thealth_test_def_id integer NOT NULL,
\thealth_test_result text NOT NULL,
\thealth_test_result_details text,
\tduration_ms integer,
\ttriggered_by text DEFAULT 'api' NOT NULL,
\tFOREIGN KEY (health_test_def_id) REFERENCES health_test_def(id)
);
CREATE INDEX \`health_results_session_idx\` ON \`health_results\` (\`session_uuid\`);

-- The binding-type vocabulary is a definition + mapping pair, never a
-- comma-separated column: the dashboard filters by it.
CREATE TABLE \`health_binding_types\` (
\tid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\tname text NOT NULL,
\tdescription text,
\tis_active integer DEFAULT true NOT NULL
);
CREATE TABLE \`health_test_binding_types\` (
\tid integer PRIMARY KEY AUTOINCREMENT NOT NULL,
\thealth_test_def_id integer NOT NULL,
\thealth_binding_type_id integer NOT NULL,
\tFOREIGN KEY (health_test_def_id) REFERENCES health_test_def(id) ON DELETE cascade,
\tFOREIGN KEY (health_binding_type_id) REFERENCES health_binding_types(id) ON DELETE cascade
);
CREATE UNIQUE INDEX \`health_test_binding_types_pair_idx\` ON \`health_test_binding_types\` (\`health_test_def_id\`,\`health_binding_type_id\`);`,
      },
    ],
    code: [
      {
        title: "The probe is the runbook — services/health/types.ts",
        lang: "ts",
        code: `export interface HealthProbe {
  /** Stable snake_case id. Also the natural key of \`health_test_def\`. */
  name: string;
  displayName: string;
  description: string;
  /** Repo path of the health.ts that owns this probe — "where do I fix it". */
  healthTsFilepath: string;
  bindingTypesTested: string[];
  whatSuccessMeans: string;
  whatFailureMeans: string;
  troubleshootingSteps: string;
  devOpsPlaybook: string;
  /** True when the probe exists to catch a sudden jump in spend. */
  isBillingRisk: boolean;
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** May throw — the runner turns a throw into FAILURE, so one probe
      can never sink the session. */
  run: (env: Env) => Promise<HealthProbeOutcome>;
}`,
      },
      {
        title: "A spend watcher — last 24h vs the 7 days BEFORE it",
        lang: "ts",
        code: `// The baseline deliberately EXCLUDES the last 24h. Including it would let a
// spike inflate its own baseline and hide itself.
const recent = await scalar(env.DB,
  "SELECT COALESCE(SUM(estimated_cost_usd),0) FROM gemini_usage_log WHERE timestamp >= ?",
  now - 86400);
const baseline = await scalar(env.DB,
  "SELECT COALESCE(SUM(estimated_cost_usd),0)/7 FROM gemini_usage_log WHERE timestamp >= ? AND timestamp < ?",
  now - 8 * 86400, now - 86400);

const ratio = baseline > 0 ? recent / baseline : null;
if (ratio === null) return degraded("NO BASELINE — cannot judge this as normal or not");
if (ratio >= 5) return failure(\`AI spend \${recent.toFixed(2)} USD is \${ratio.toFixed(1)}x the 7-day average\`);
if (ratio >= 2) return degraded(\`AI spend \${recent.toFixed(2)} USD is \${ratio.toFixed(1)}x the 7-day average\`);
return ok(\`AI spend \${recent.toFixed(2)} USD, within \${ratio.toFixed(1)}x of baseline\`);`,
      },
      {
        title: "Persisting a session — db.batch(), never db.transaction()",
        lang: "ts",
        code: `const runs = await Promise.all(ALL_HEALTH_PROBES.map((p) => runProbe(p, env)));

// D1 rejects BEGIN (error 7500), so a batch is the only atomic unit available.
// A persistence failure is logged, never thrown: a broken audit trail must not
// hide a working — or broken — system.
const stmts = runs.map((r) =>
  db.insert(healthResults).values({
    timestamp, sessionUuid,
    healthTestDefId: defIdByName.get(r.name) as number,
    healthTestResult: r.result,
    healthTestResultDetails: r.details.slice(0, 4000),
    durationMs: r.durationMs,
    triggeredBy,
  }),
);
if (stmts.length > 0) {
  await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
}`,
      },
      {
        title: "Bridging the #169 data-quality checks into the same ledger",
        lang: "ts",
        code: `const dataQualityProbes: HealthProbe[] = HEALTH_CHECKS.map((check) =>
  defineProbe({
    name: \`data_quality_\${check.slug.replace(/-/g, "_")}\`,
    // …
    run: async (env: Env) => {
      const r = await check.run(env);
      const stats = r.stats.map((s) => \`\${s.label}=\${s.value}\`).join(", ");
      const details = \`\${r.summary} — score \${r.score}/100; \${stats}\`;
      if (r.status === "healthy") return ok(details);
      if (r.status === "degraded") return degraded(details);
      // "unhealthy" AND "unknown" both fail. A check that THREW must never be
      // mistaken for an all-clear.
      return failure(details);
    },
  }),
);`,
      },
    ],
    diagrams: [
      {
        caption:
          "Ownership: each module declares its own probes; one registry, one runner, one ledger.",
        code: `flowchart LR
  subgraph modules["17 backend modules — each owns a health.ts"]
    db["db"]
    api["api"]
    ai["ai"]
    rt["realtime"]
    wf["workflows"]
    usage["usage (cost)"]
    integ["email · gmail · google · photos · tesla"]
    media["images · render · documents"]
    mcp["mcp"]
    show["showroom"]
  end
  quality["registry.ts — #169 data-quality checks"]
  modules --> reg["probes.ts<br/>ALL_HEALTH_PROBES (88)"]
  quality -->|bridged as a group| reg
  reg --> run["run.ts — runHealthSession()"]
  run --> d1[("health_test_def<br/>health_results")]
  run --> apis["/api/health/*"]
  apis --> ui["/admin/system/health"]
  apis --> pip["header pip"]
  classDef done fill:#1f4d2e,stroke:#4ade80,color:#e8ffe8
  class reg,run done`,
      },
      {
        caption:
          "The catalogue: definitions, a binding-type vocabulary, and one result row per probe per session.",
        code: `erDiagram
  health_test_def ||--o{ health_results : "records"
  health_test_def ||--o{ health_test_binding_types : "touches"
  health_binding_types ||--o{ health_test_binding_types : "is used by"

  health_test_def {
    int id PK
    text name UK "snake_case, natural key"
    text health_ts_filepath
    text what_success_means
    text what_failure_means
    text troubleshooting_steps
    text dev_ops_playbook
    bool is_billing_risk
    text severity "HIGH|MEDIUM|LOW"
    bool is_active "soft delete"
  }
  health_binding_types {
    int id PK
    text name UK "d1, kv, r2, workflow, ..."
  }
  health_test_binding_types {
    int id PK
    int health_test_def_id FK
    int health_binding_type_id FK
  }
  health_results {
    int id PK
    int timestamp "session start, shared"
    text session_uuid "shared by one run"
    int health_test_def_id FK
    text health_test_result "SUCCESS|FAILURE|DEGRADED"
    text health_test_result_details
    int duration_ms
    text triggered_by "ui|api|mcp|cron"
  }`,
      },
      {
        caption: "One session, end to end.",
        code: `sequenceDiagram
  actor U as Admin
  participant UI as /admin/system/health
  participant API as POST /api/health/session
  participant R as runHealthSession()
  participant D1 as D1
  U->>UI: click "Run health checks"
  UI->>UI: every row becomes a skeleton, button spins
  UI->>API: POST (admin cookie required)
  API->>R: runHealthSession(env, "ui")
  R->>D1: syncHealthCatalogue() — upsert 88 defs + binding vocab (db.batch)
  par 88 probes, concurrent, each time-boxed at 10s
    R->>R: probe.run(env)
  end
  R->>D1: 88 health_results rows, one session_uuid (db.batch)
  R-->>UI: {overall, counts, runs[]}
  UI->>U: timeline repaints, grouped by module`,
      },
      {
        caption: "Outcome states — DEGRADED is a real state, not a soft failure.",
        code: `stateDiagram-v2
  [*] --> Running
  Running --> SUCCESS: within envelope
  Running --> DEGRADED: up but outside its envelope<br/>(stale data, backlog, 2x spend, optional credential missing)
  Running --> FAILURE: unreachable, throws, required credential absent, 5x spend
  Running --> FAILURE: timed out after 10s
  SUCCESS --> [*]
  DEGRADED --> [*]
  FAILURE --> [*]`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_195.mjs",
      command: "pnpm run test:pr 195 -- --preview",
      ranAt: "2026-07-22",
      source: `// The runbook fields are the whole point — an empty one is a defect, not a nit.
const FIELDS = ["description", "whatSuccessMeans", "whatFailureMeans",
  "troubleshootingSteps", "devOpsPlaybook", "healthTsFilepath"];
const bare = catalogueTests.filter((t) => FIELDS.some((f) => !t[f] || String(t[f]).length < 20));
checks.ok("every test has a populated runbook", bare.length === 0, bare.map((t) => t.name).join(", "));

// The session must be PERSISTED, not just returned.
checks.ok("the run we just made is the latest persisted session",
  r.json?.session?.sessionUuid === session.sessionUuid);

// The badge must never leak the system map to an unauthed reader.
checks.ok("badge is null for an unauthed request",
  anon.status === 200 && anon.json?.status === null);`,
      output: `QC pr_195 — health platform
target: https://wcrp-claude-backend-health-checks-d1-d6df78.hacolby.workers.dev

  ✓ target reachable (…) 

Regression — public health endpoints (uptime monitors read these)
  ✓ GET /api/health is public and 200
  ✓ GET /api/health still returns status + services
  ✓ POST /api/health/run (0027 screen) still works
  ✓ …and still returns per-binding checks

Regression — #169 data-quality registry (bridged, must still stand alone)
  ✓ GET /api/system/health/checks → 200
  ✓ …registry is non-empty

Auth — the catalogue is a map of internal infrastructure, so it is gated
  ✓ POST /api/health/session unauthed → 401
  ✓ GET /api/health/catalogue unauthed → 401

Catalogue — every test carries its own runbook
  ✓ GET /api/health/catalogue → 200
  ✓ catalogue is grouped
  ✓ catalogue is substantial
    storage:10 api:5 compute:10 ai:9 cost:7 media:14 integrations:20 connector:5 domain:5 quality:3
  ✓ every test has a populated runbook
  ✓ severity is always a valid enum value
  ✓ test names are unique
  ✓ cost watchers exist
  ✓ the #169 data-quality checks are bridged in

Session — run every probe for real
  ✓ POST /api/health/session → 200 even when probes fail
  ✓ session returns a uuid
  ✓ every catalogued test ran
  ✓ overall is a valid roll-up
  ✓ counts sum to the run count
  ✓ every run carries details
  ✓ the screen is fast (< 20s wall)
    overall=FAILURE counts={"success":74,"degraded":12,"failure":2} wall=2424ms
    FAILURE tesla_telemetry_freshness :: tesla_telemetry_events is empty — no telemetry frame has EVER been recorded.
    FAILURE mcp_tool_registry_integrity :: 100 tools registered, but — no examples[]: create_render_session, list_room_angles, run_render_stage, …
    DEGRADED showroom_scrape_failures :: scrape_status — failed: 49, running: 0, pending: 10, complete: 25.
    DEGRADED showroom_geo_coverage :: 72 of 215 active stores (33.5%) have no latitude/longitude; 72 of those DO have an address.
    DEGRADED image_processor_staging_errors :: 7 staging row(s) with processing_status='failed'; most recent: D1_ERROR: too many SQL variables
    (…8 more DEGRADED)

Ledger — the session must be persisted, not just returned
  ✓ GET /api/health/session/latest → 200
  ✓ the run we just made is the latest persisted session
  ✓ …with every row persisted
  ✓ GET /api/health/sessions → 200
  ✓ history is grouped by session
  ✓ sessions are distinct

Badge — cheap, and never triggers a probe
  ✓ GET /api/health/badge → 200
  ✓ badge reports the latest session's status
  ✓ badge is null for an unauthed request (renders nothing, never leaks)

Pages — the dashboard moved behind the admin gate
  ✓ /admin/system/health renders for an admin
  ✓ …and mounts the dashboard island
  ✓ /health → /admin/system/health
  ✓ /admin/health → /admin/system/health

37 passed, 0 failed

--- production run (pnpm run test:pr 195), pre-merge regression guard ---
  ✓ GET /api/health is public and 200
  ✓ POST /api/health/run (0027 screen) still works
  ✓ GET /api/system/health/checks → 200
  ✓ /admin/system/health renders for an admin
    ⏳ POST /api/health/session — pending merge/deploy (HTTP 404 on production)
    ⏳ /health redirect — pending merge/deploy (HTTP 200)
9 passed, 0 failed`,
      migrations: [
        {
          tag: "0125_supreme_dust",
          appliedRemote: true,
          note: "Applied with `pnpm run migrate:remote` and verified: SELECT name FROM sqlite_master WHERE name LIKE 'health%' returns health_binding_types, health_checks, health_results, health_test_binding_types, health_test_def. First real session then wrote 88 health_results rows under one session_uuid and 88 health_test_def rows with 12 binding types and 91 mappings. Renumbered from 0124 to 0125 after #169 took 0124 — re-applying is safe, the migrate script tolerates \"already exists\".",
        },
      ],
    },
  },
  "0026-agent-ops-transparency": {
    slug: "0026-agent-ops-transparency",
    problem:
      "This Worker runs 27 things that can start work on their own — 9 Workflows, 10 Durable Object agents, 7 cron jobs and MCP — and none of them could be watched. The agent_runs ledger already existed on main with exactly ONE writer and ZERO readers. The cost of that silence is documented: 49 of 145 showroom scrapes sat in `failed` with no reason; RemodelOrchestrator burned roughly $50/day for weeks and was found on a billing invoice; Workers AI 3040 capacity errors land in image_upload_staging.processing_error and are read by nothing. Every failure was discovered by its bill or by a user, days late.",
    approach:
      "A wire-up, not a new monitoring system. P0 closed the writer gap by WRAPPING call sites rather than rewriting them — `startRun` is best-effort by contract and returns a no-op recorder instead of throwing, so instrumentation can never break the work it measures. A `ledgerSteps(step, run)` bridge made instrumenting a Workflow a 3-line change instead of hand-wrapping ~60 `step.do` calls. P1 added one additive nullable column (gemini_usage_log.agent_run_id) plus a read-only query service and a Hono router under the existing /api/admin/* auth gate. Spend attribution uses AsyncLocalStorage rather than a module-level variable, because the image batch coordinator interleaves runs with Promise.all in one isolate and a shared mutable would have misattributed a whole batch's cost to one arbitrary image. P2-P5 retrofitted four shadcn templates onto real columns, cutting every invented field (owner avatars, environment badges, fictional model providers, an editable settings form with nowhere to persist) and adding three things the templates lacked: retry lineage, a runaway detector, and an uninstrumented-surface banner so an empty queue can never read as a healthy one.",
    apiChanges: [
      "GET  /api/admin/agents/overview — counts, cycle spend, breaker state, runaway flags, coverage",
      "GET  /api/admin/agents/runs — status/agent/since/limit, with steps_done + steps_total",
      "GET  /api/admin/agents/runs/:id — run + steps + tool calls + retry lineage + attributed cost",
      "POST /api/admin/agents/runs/:id/retry — inserts a NEW run with parent_run_id; never mutates the failed row",
      "POST /api/admin/agents/runs/:id/cancel — refused (409) for an already-settled run",
      "POST /api/admin/agents/runs/:id/approve — needs_approval → running (HITL)",
      "GET  /api/admin/agents/failures — grouped by (error_code, agent, operation)",
      "GET  /api/admin/agents/usage — spend by agent/provider/model + AI Gateway reconciliation",
      "GET  /api/admin/agents/coverage — which of the 27 declared surfaces are wired",
    ],
    filesTouched: [
      "src/backend/services/agent-registry.ts (new — 27 surfaces)",
      "src/backend/services/agent-run-workflow.ts (new — ledgerSteps bridge)",
      "src/backend/services/agent-run-context.ts (new — AsyncLocalStorage run context)",
      "src/backend/services/agent-runs-query.ts (new — read-only queries)",
      "src/backend/services/agent-run-retention.ts (new — 30d/90d prune)",
      "src/backend/api/routes/admin-agents.ts (new — 9 endpoints)",
      "src/frontend/components/system/agents/{shared,AgentQueueApp,AgentRunDetailApp,AgentFailuresApp,AgentUsageApp}.tsx (new)",
      "src/frontend/pages/admin/system/agents/{queue,failed,usage}.astro + queue/[id].astro (new)",
      "src/frontend/components/ui/{table,progress,collapsible,skeleton}.tsx (shadcn CLI)",
      "instrumented: brand-research, product-research, deep-research-job, image-processor/workflow, image-processor/batch-workflow, checklist-rationale, showroom-onboarding, render/blank-canvas-batch, RemodelOrchestrator, ShowroomResearchAgent",
      "src/backend/db/schema/system/gemini-usage.ts, src/backend/services/usage/metering.ts, src/backend/services/agent-runs.ts, src/_worker.ts, src/frontend/components/sidebar/nav-groups.ts",
      "scripts/qc/pr_193.mjs (new)",
    ],
    migrations: [
      {
        tag: "0123_stormy_sersi",
        sql: "ALTER TABLE `gemini_usage_log` ADD `agent_run_id` integer;--> statement-breakpoint\nCREATE INDEX `gemini_usage_log_agent_run_idx` ON `gemini_usage_log` (`agent_run_id`);",
      },
    ],
    code: [
      {
        title: "The instrumentation contract — wrap, never rewrite",
        lang: "ts",
        code: `const run = await startRun(env, {
  agent: "brand-research",
  operation: "research_brand",
  targetType: "brand",
  targetId: String(brandId),
  triggeredBy: "cron",
});
// Every step.do below now also writes an agent_run_steps row.
const step = ledgerSteps(rawStep, run);

// Do NOT wrap startRun in try/catch. It never throws — on a ledger failure it
// returns a no-op recorder and the real work proceeds unrecorded. Losing real
// work to a telemetry bug is unacceptable; that asymmetry is deliberate.`,
      },
      {
        title: "Why AsyncLocalStorage, not a module-level run id",
        lang: "ts",
        code: `// image-processor/batch-workflow.ts runs a wave of images under Promise.all —
// several runs interleaved in ONE isolate. A shared mutable \`currentRunId\`
// would hand every AI call the id of whichever image started last, and the cost
// page would confidently attribute the whole batch to one arbitrary image.
//
// A wrong number on a cost page is worse than no number, because nobody
// double-checks a number that looks plausible.
/**
 * Retrieves the current agent run ID from async local storage.
 *
 * @returns The current agent run ID, or null if not in an agent run context.
 */
export function currentAgentRunId(): number | null {
  return storage.getStore()?.runId ?? null;
}`,
      },
    ],
    diagrams: [
      {
        caption: "Data model — the existing ledger plus one additive column",
        code: `erDiagram
    agent_runs ||--o{ agent_run_steps : "run_id cascade"
    agent_runs ||--o{ agent_run_tool_calls : "run_id cascade"
    agent_runs ||--o{ agent_runs : "parent_run_id retry chain"
    agent_runs ||--o{ gemini_usage_log : "agent_run_id NEW"

    agent_runs {
        integer id PK
        text    agent "showroom-research, remodel-orchestrator"
        text    operation
        text    status "queued running needs_approval succeeded failed cancelled"
        integer attempt
        integer parent_run_id
        text    error_code "groupable: MAPS_QUOTA_EXCEEDED 3040 503"
        text    error_message
        integer duration_ms
    }
    gemini_usage_log {
        integer id PK
        integer agent_run_id "NEW nullable, not a FK"
        text    provider
        integer total_tokens
        real    estimated_cost_usd
    }`,
      },
      {
        caption: "An instrumented run, end to end",
        code: `sequenceDiagram
    autonumber
    participant CR as Cron / User / MCP
    participant WF as Workflow or DO Agent
    participant RR as startRun recorder
    participant D1 as D1 agent_runs
    participant AI as Workers AI / Gemini
    participant UI as /admin/system/agents

    CR->>WF: trigger
    WF->>RR: startRun(...)
    RR->>D1: INSERT agent_runs status=running
    Note over RR: insert fails then nullRecorder,<br/>real work proceeds unrecorded
    WF->>RR: run.step("scrape site")
    RR->>AI: env.AI.run(...)
    AI-->>RR: result + usage
    RR->>D1: INSERT agent_run_tool_calls + gemini_usage_log(agent_run_id)
    WF->>RR: run.succeed(digest) or run.fail(err)
    UI->>D1: GET /api/admin/agents/runs (poll 10s)`,
      },
    ],
    branch: "claude/agent-ops-monitoring-plan-957a42",
    prNumber: 193,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/193",
    verification: {
      qcScript: "scripts/qc/pr_193.mjs",
      command: "pnpm run test:pr 193",
      source:
        "49 assertions across reads, input validation, the auth gate, the retry/cancel/approve state machine, all four pages and a regression guard on plans / mcp-ops / integrations.",
      ranAt: "2026-07-22T14:40:00Z",
      output:
        "49 passed, 0 failed — against production (https://core-remodel.hacolby.workers.dev). Full transcript on the D1-backed entry, which is the source of truth; this bundled copy is the SSR fallback and carries an abridged diagram set.",
      migrations: [
        {
          tag: "0123_stormy_sersi",
          appliedRemote: true,
          note: "Applied with pnpm run migrate:remote and verified on the remote DB — pragma_table_info returned [{'name': 'agent_run_id'}].",
        },
      ],
    },
  },
  "markdown-mermaid-render": {
    slug: "markdown-mermaid-render",
    branch: "claude/markdown-mermaid",
    prNumber: 187,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/187",
    problem:
      "AGENTS.md now mandates that planning artifacts be dense with Mermaid diagrams, and the preview-changelog PRD is authored with ```mermaid fences. But the renderer behind it — MarkdownProse (react-markdown) — mapped fenced code blocks to a plain styled <pre><code>, so every diagram showed as its raw source text. The changelog DETAIL page already rendered diagrams (via MermaidCn), but the proposal/preview PRD did not.",
    approach:
      "Override MarkdownProse's `pre` renderer: when the fenced block's <code> carries class `language-mermaid`, flatten its text and render <MermaidCn code={…} /> — the same client renderer the changelog detail page uses — instead of the code block. Non-mermaid fences render unchanged. Both mermaid components dynamic-import `mermaid`, so importing MermaidCn stays SSR-safe; the SVG paints on the client wherever MarkdownProse is hydrated (the preview mounts ProposalBundle with client:load). One change fixes every MarkdownProse surface (research, brands, products, changelog, mcp-ops).",
    apiChanges: [],
    filesTouched: ["src/frontend/components/research/MarkdownProse.tsx"],
    migrations: [],
    code: [],
    diagrams: [
      {
        caption: "Where a fenced mermaid block gets turned into a diagram",
        code: 'flowchart LR\n    MD["prdMarkdown / any markdown"] --> RM["ReactMarkdown"]\n    RM --> PRE{"pre block:\\nlanguage-mermaid?"}\n    PRE -->|no| CODE["styled pre/code block"]\n    PRE -->|yes| MC["MermaidCn -> import(\'mermaid\') -> SVG"]',
      },
    ],
    verification: {
      qcScript: "(none — client-only render change)",
      command: "open /admin/changelog/preview/tesla-telemetry-webhooks",
      output:
        "tsc --noEmit clean on the touched file (4 pre-existing repo-wide env/config errors only). Visual: the diagram-dense 0023 preview changelog renders diagrams instead of raw ```mermaid code. Pure client-render change; no API/QC-script surface.",
    },
  },
  "maps-per-api-quota-hardblock": {
    slug: "maps-per-api-quota-hardblock",
    branch: "claude/tesla-google-quota",
    prNumber: 185,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/185",
    problem:
      "Google Maps billing was guarded as one combined total, not per API. Two divergent guards disagreed: isUnderMonthlyQuota() (limit 10,000, seconds-correct) and canUseGoogleMaps() (limit 8,000, but computing the month window with .getTime() MILLISECONDS against a Unix-SECONDS column — a ~1000× boundary error). Worse, several billed calls bypassed the counter entirely: the Places-Photo media fetches in showroom onboarding + the ShowroomResearchAgent backfill fetched a Places SKU with no quota check and no usage log, so they spent real money invisibly. There was also no reverse-geocode or nearby-search method for the location tools.",
    approach:
      "Bucket the already-logged google_maps_usage_log rows into billed SKUs (places / geocoding / routes) via skuForUsageBucket(), sum them with getUsageBySku(), and gate each call with isUnderApiQuota(sku) — an exhausted SKU blocks ONLY itself, and the caps are conservative proxies for the shared $200 free tier so the sum stays under it. canUseGoogleMaps() now delegates to the SARGABLE seconds-correct count (killing the ms bug and the divergent cap). New reverseGeocode + placesNearby methods are gated on their SKU, logged, and fail soft (null/[]) so the location tools degrade instead of throwing. The photo-fetch bypasses now gate + log. The admin usage endpoint + tab surface per-SKU counts and caps.",
    apiChanges: [
      "GET /api/admin/integrations/usage — response gains by_sku { places, geocoding, routes } + quotas (the per-API caps).",
      "GoogleMapsService.isUnderApiQuota(sku) / getUsageBySku() — NEW per-API guard + rollup.",
      "GoogleMapsService.reverseGeocode(lat,lng) / placesNearby(lat,lng,radiusM) — NEW, gated + logged, fail-soft.",
      "canUseGoogleMaps() — reimplemented to delegate to isUnderMonthlyQuota() (bug fix; same signature).",
    ],
    filesTouched: [
      "src/backend/services/google/maps.ts",
      "src/backend/api/routes/admin-integrations.ts",
      "src/frontend/components/admin/usage/MapsUsageSection.tsx",
      "src/backend/services/showroom/onboarding.ts",
      "src/backend/ai/agents/ShowroomResearchAgent/methods/backfill.ts",
      "src/backend/api/routes/shopping-journal.ts",
    ],
    migrations: [],
    code: [],
    diagrams: [],
    verification: {
      qcScript: "scripts/qc/pr_185.mjs",
      command: "pnpm run test:pr 185 -- --preview",
      output:
        "Not yet executed — the authoring sandbox has no toolchain (no node_modules) and the proxy blocks direct HTTP to the worker. Run in a toolchain env against the preview, then production after deploy. tsc --noEmit is clean on all touched files (4 pre-existing repo-wide env/config errors only).",
    },
  },
  "do-alarm-circuit-breaker": {
    slug: "do-alarm-circuit-breaker",
    branch: "claude/tesla-telemetry-webhooks-2jnnj9",
    prNumber: 181,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/181",
    problem:
      "RemodelOrchestrator used the @cloudflare/agents SDK this.schedule(), which is append-only — every call inserts a row into the SDK's internal cf_agents_schedules table. Re-armed unconditionally from onStart() (fires on every DO wake) and audit()'s finally, pending schedules compounded to ~1M rows; every alarm then full-scanned the table, billing 537 BILLION Durable Object row reads in 30 days (~$512+). #162 fixed that code path, but nothing in the running system would catch a recurrence — on that DO or any future alarm DO — until the next invoice.",
    approach:
      "A reusable runtime circuit breaker checked on every alarm fire, before any work: a D1-backed global kill-switch (project_system_variables.do_circuit_breaker_tripped), a schedule-table-bound check (the exact #162 signature), and a fire-rate window. On any runaway signal it TRIPS — deletes the alarm, flips the kill-switch, and hard-stops with no reschedule (deliberate downtime over billing). All checks are cheap (single-row read, SARGABLE count, O(1) compare) so the guard never becomes the cost. New alarm DOs are required to use native ctx.storage.setAlarm() (one self-replacing slot — cannot grow a table); a CI guard bans this.schedule() in DOs.",
    apiChanges: [
      "GET /api/admin/integrations/circuit-breaker — NEW. Current kill-switch state (tripped, reason, doName, at).",
      "POST /api/admin/integrations/circuit-breaker/clear — NEW. Admin clears the breaker.",
      "services/safety/do-circuit-breaker.ts — NEW reusable module (readCircuitBreaker / tripCircuitBreaker / clearCircuitBreaker / evaluateFireWindow / scheduleTableExceeded).",
    ],
    filesTouched: [
      "src/backend/services/safety/do-circuit-breaker.ts",
      "src/backend/ai/agents/RemodelOrchestrator/index.ts",
      "src/backend/api/routes/admin-integrations.ts",
      "src/frontend/components/admin/usage/CircuitBreakerSection.tsx",
      "src/frontend/components/admin/AdminIntegrationsUsageApp.tsx",
      "scripts/check-do-alarms.mjs",
      "package.json",
    ],
    migrations: [],
    code: [],
    diagrams: [],
    verification: {
      qcScript: "scripts/qc/pr_181.mjs",
      command: "pnpm run test:pr 181 -- --preview",
      output:
        "Local checks passed: node scripts/check-do-alarms.mjs → OK (RemodelOrchestrator allowlisted, comment-mentions ignored); fire-window trip logic verified (6 fires in-window ok → 7th trips → resets after window). tsc --noEmit clean on touched files. HTTP QC pending a toolchain env (no node_modules / proxy blocks the worker here).",
    },
  },
  "public-health-page": {
    slug: "public-health-page",
    branch: "claude/health-status-page",
    prNumber: 182,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/182",
    problem:
      "https://core-remodel.hacolby.workers.dev/health returned 404, and the only health surface (GET /api/health) merely pinged D1 and re-read the health_checks table — it never exercised the other bindings, and there was no human-facing page to run a check on demand.",
    approach:
      "A runHealthScreen(env) service that probes each core binding with a real, bounded, free op — D1 + the Tesla telemetry DB (SELECT 1), KV (put/get a short-TTL probe), R2 (head a sentinel), Workers AI (binding presence only; running a model costs) — times each, writes one health_checks row per service via db.batch (D1 has no transactions), and rolls up overall. No probe throws out (a failure is a down result); a persistence failure is logged, not fatal. A public POST /api/health/run triggers it, and a public /health page + island shows per-service cards + latency with an overall roll-up.",
    apiChanges: [
      "POST /api/health/run — NEW. On-demand health screen; 200 even when a service is down (read status from the body).",
      "services/health/screen.ts runHealthScreen(env) — NEW.",
    ],
    filesTouched: [
      "src/backend/services/health/screen.ts",
      "src/backend/api/routes/health.ts",
      "src/frontend/pages/health.astro",
      "src/frontend/components/health/HealthCheckApp.tsx",
    ],
    migrations: [],
    code: [],
    diagrams: [],
    verification: {
      qcScript: "scripts/qc/pr_182.mjs",
      command: "pnpm run test:pr 182 -- --preview",
      output:
        "Not yet executed in a toolchain env (no node_modules / proxy blocks the worker in the authoring sandbox). tsc --noEmit clean on touched files. QC asserts GET /api/health regression, POST /run shape + service coverage, history, and /health HTML.",
    },
  },
  "drive-lists-single-active": {
    slug: "drive-lists-single-active",
    branch: "claude/drive-lists-activation-ui-6f6e47",
    prNumber: 178,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/178",
    problem:
      "\"The active drive\" is a single slot: it is what an admin device auto-lands on (src/_worker.ts → getActiveDriveLandingPath). But it was stored as one value of the drive_lists.status enum — the same column carrying the lifecycle label, and the column's DEFAULT. Nothing in D1 stopped two rows from holding it, and the app-side guard only ran on two paths (create, and un-archiving via a stop check-off), so six drives were active on production at once. The landing page then bucketed its Active/Archived tabs on that same overloaded field, so a drive that had never been touched, one half-driven, and one demoted by an activation all landed in the same tab — while the auto-archive on read quietly rewrote status behind the user's back.",
    approach:
      "Split the pointer from the label. `is_active` is its own boolean column under a PARTIAL unique index (`WHERE is_active = 1`), so a second active row is a database error rather than a bug that shows up six drives later. Writes go through one service function, setActiveDrive(db, id | null), which clears and sets inside a single db.batch() — D1 never observes two active rows, and D1 has no transactions to fall back on. `status` stays as a plain lifecycle label that nothing infers from anymore: the read path and the check-off no longer rewrite it, and the tabs bucket on stops visited (0 → Pending, some → In progress, all → Finished), which is what the user actually asked the page to show.",
    apiChanges: [
      "POST /api/tesla/poll — NEW. Forces one vehicle poll (admin); self-gates on an active drive and the 120s throttle.",
      "GET /api/config/tesla — NEW. Masked credentials + the telemetry-recording flag. Secret values are never returned.",
      "PATCH /api/config/tesla { telemetryRecording } — NEW. The recording consent switch.",
      "POST /api/config/tesla/health — NEW. Integration screening: credentials, a live Tessie position, and whether historical events still carry the fields the automation reads. `?live=0` skips the vehicle call.",
      "POST /api/tesla/telemetry — records only when configured AND recording is on; otherwise returns { recorded: false, reason }.",
      "MCP: new `tesla` domain — get_tesla_status, get_vehicle_location, list_tesla_events, send_vehicle_navigation (the only write).",
      "GET /api/drive-lists/home-location — NEW. The project's coordinates as the home-arrival rule sees them, plus the radius and cutoff. Geocoded once from the configured permit address, cached in project_system_variables.",
      "POST /api/showroom-stores/device-location — response gains `homeArrival` (the rule's verdict for this fix).",
      "PATCH /api/drive-lists/:slug — NEW. Body { isActive: boolean }. true makes this THE active drive (clearing the previous one in the same batch); false leaves none active. 400 without the flag, 404 on an unknown slug.",
      "GET /api/drive-lists — now returns `isActive` per drive, and no longer auto-archives fully-visited drives (progress buckets the tabs, so nothing needs the status rewrite).",
      "PATCH /api/drive-lists/:slug/stops/:stopId — no longer rewrites the drive's status or touches the active slot; returns { ok, visited, stopCount, visitedCount }.",
      "MCP list_drive_lists — output gains `isActive`.",
    ],
    filesTouched: [
      "src/backend/db/schema/drives/drive_lists.ts",
      "src/backend/services/drive-home-arrival.ts",
      "src/backend/services/tesla-integration.ts",
      "src/backend/services/tesla-poller.ts",
      "src/_worker.ts",
      "src/backend/mcp/tools/tesla/*.ts",
      "src/frontend/components/config/TeslaIntegrationApp.tsx",
      "src/frontend/pages/admin/config/integrations/tesla.astro",
      "src/backend/services/drive-home-arrival-rules.ts",
      "src/backend/api/routes/tesla.ts",
      "src/backend/api/routes/showroom-stores.ts",
      "src/backend/services/google/maps.ts",
      "scripts/tests/test_home_arrival.mjs",
      "src/backend/services/drive-lists.ts",
      "src/backend/api/routes/drive-lists.ts",
      "src/backend/mcp/tools/drives/list_drive_lists.ts",
      "src/frontend/components/drives/DriveListsApp.tsx",
      "scripts/config.mjs",
      "scripts/qc/pr_178.mjs",
      "drizzle/0119_yellow_micromax.sql",
    ],
    migrations: [
      {
        tag: "0119_yellow_micromax",
        sql: `ALTER TABLE \`drive_lists\` ADD \`is_active\` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX \`drive_lists_single_active_uniq\` ON \`drive_lists\` (\`is_active\`) WHERE "drive_lists"."is_active" = 1;`,
      },
    ],
    code: [
      {
        title: "The invariant, enforced by the database",
        lang: "ts",
        code: `singleActive: uniqueIndex("drive_lists_single_active_uniq")
  .on(table.isActive)
  .where(sql\`\${table.isActive} = 1\`),`,
      },
      {
        title: "One write path — clear + set in a single D1 batch",
        lang: "ts",
        code: `/**
 * Sets the active drive by clearing the current active drive and setting the new one.
 *
 * @param db The database instance.
 * @param id The ID of the drive to set as active, or null to clear the active drive.
 */
export async function setActiveDrive(db: RemodelDb, id: number | null): Promise<void> {
  const clear = db
    .update(driveLists)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(driveLists.isActive, true), id == null ? undefined : ne(driveLists.id, id)));
  if (id == null) {
    await db.batch([clear]);
    return;
  }
  const set = db
    .update(driveLists)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(driveLists.id, id));
  await db.batch([clear, set]);
}`,
      },
      {
        title: "Tessie does not push — so poll, but only while a drive is running",
        lang: "ts",
        code: `// Gate 1: is a drive even running? This is the cheap one, so it goes first.
const activeSlug = await getActiveDriveSlug(db);
if (!activeSlug) return { polled: false, reason: "no-active-drive" };
if (!(await tessieConfigured(env))) return { polled: false, reason: "unconfigured" };

// Gate 2: throttle. KV TTL is the clock — a present key means "polled
// recently", so no timestamp arithmetic and no clock skew to reason about.
if (await env.CACHE.get(THROTTLE_KEY)) return { polled: false, reason: "throttled" };
await env.CACHE.put(THROTTLE_KEY, "1", { expirationTtl: POLL_INTERVAL_SECONDS });

const state = await getVehicleState(env);   // GET /{vin}/state?use_cache=true`,
      },
      {
        title: "Getting home ends the drive — every gate, cheapest first",
        lang: "ts",
        code: `/**
 * Determines the reason for home arrival based on current facts.
 *
 * @param facts The facts about the current state.
 * @returns The reason for home arrival, or null if not arrived.
 */
export function homeArrivalReason(facts: {
  hasActiveDrive: boolean;
  stopped: boolean;
  at: Date;
  distanceM: number | null;
}): HomeArrivalReason {
  if (!facts.hasActiveDrive) return "no-active-drive";
  if (!facts.stopped) return "not-stopped";          // driving PAST the house
  if (localMinutesInLA(facts.at) < HOME_ARRIVAL_AFTER_MINUTES) return "before-cutoff";
  if (facts.distanceM == null) return "home-unconfigured";  // never guess
  return facts.distanceM <= HOME_RADIUS_M ? "ended" : "not-home";
}`,
      },
      {
        title: "Tabs bucket on progress, never on status",
        lang: "tsx",
        code: `/**
 * Determines the progress bucket for a drive list.
 *
 * @param d The drive list summary.
 * @returns The progress bucket (pending, partial, or finished).
 */
function bucketOf(d: DriveListSummary): Bucket {
  if (d.stopCount > 0 && d.visitedCount >= d.stopCount) return "finished";
  return d.visitedCount > 0 ? "partial" : "pending";
}`,
      },
    ],
    diagrams: [
      {
        caption: "Ending the drive when the driver gets home",
        code: `flowchart TD
    A[Tesla park webhook] --> C{Active drive?}
    B[Phone / browser location fix] --> C
    C -- no --> X[no-active-drive]
    C -- yes --> D{Stopped fix?<br/>park event, P gear, or a phone fix}
    D -- no --> Y[not-stopped — driving past the house]
    D -- yes --> E{Local time >= 15:30<br/>America/Los_Angeles, any day}
    E -- no --> Z[before-cutoff — this is a lunch break]
    E -- yes --> F{Home coords known?<br/>geocoded from the permit address}
    F -- no --> W[home-unconfigured — never guess]
    F -- yes --> G{Within 150m of the house?}
    G -- no --> V[not-home]
    G -- yes --> H[setActiveDrive null — drive over]`,
      },
      {
        caption: "Activating a drive — the previous holder is cleared in the same batch",
        code: `sequenceDiagram
    participant UI as Drives page (toggle)
    participant API as PATCH /api/drive-lists/:slug
    participant SVC as setActiveDrive()
    participant D1 as D1 (drive_lists)
    UI->>API: { isActive: true }
    API->>SVC: setActiveDrive(db, id)
    SVC->>D1: batch[ clear is_active where id <> keep, set is_active on keep ]
    D1-->>SVC: one row active (partial UNIQUE index holds)
    SVC-->>API: ok
    API-->>UI: { ok: true, isActive: true }`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_178.mjs + scripts/tests/test_home_arrival.mjs",
      command: "pnpm run test:pr 178 -- --preview  &&  pnpm run test:home-arrival",
      ranAt: "2026-07-21",
      source: `const on = await client.patch(\`/api/drive-lists/\${newest.slug}\`, { isActive: true });
checks.ok(\`PATCH \${newest.slug} {isActive:true} → 200\`, on.status === 200, \`got \${on.status}\`);

if (other) {
  const swap = await client.patch(\`/api/drive-lists/\${other.slug}\`, { isActive: true });
  after = await listDrives();
  checks.ok(
    "activating a second drive left exactly one active (no unique-index 500)",
    activeOnes(after.drives).length === 1 && activeOnes(after.drives)[0].id === other.id,
    activeOnes(after.drives).map((d) => d.slug).join(", "),
  );
}`,
      output: `PR #178 QC → https://wcrp-claude-drive-lists-activation-ui-6f6e47.hacolby.workers.dev

  ✓ target reachable (https://wcrp-claude-drive-lists-activation-ui-6f6e47.hacolby.workers.dev)
  ✓ drive-lists rejects an unauthenticated read (401)
  ✓ GET /api/drive-lists → 200
  ✓ at least one drive exists to test with
  ✓ every row exposes isActive (migration 0119 applied to remote)
  ✓ at most ONE drive is active (was 6 before this PR) — now 1
    tabs → pending=14 partial=0 finished=0
  ✓ every drive falls in exactly one progress bucket
  ✓ PATCH concord-corridor-sat-jul-18-sf-1pm {isActive:true} → 200
  ✓ the newest drive is now THE active one
  ✓ PATCH saturday-east-bay-slabs-showroom-sweep-jul-18 {isActive:true} → 200
  ✓ activating a second drive left exactly one active (no unique-index 500)
  ✓ PATCH saturday-east-bay-slabs-showroom-sweep-jul-18 {isActive:false} → 200
  ✓ no drive is active after toggling off
  ✓ PATCH without \`isActive\` → 400
  ✓ PATCH on an unknown slug → 404
  ✓ GET /api/drive-lists/:slug → 200
  ✓ stop check-off still 200
  ✓ check-off returns live progress counts
  ✓ stop restored to its original state
  ✓ checking a stop off never activates a drive
  ✓ GET /api/drive-lists/home-location → 200
  ✓ the project address geocoded to real coordinates (cached in project_system_variables)
      home: 37.728496799999995, -122.41406099999999 (±150m after 930 local minutes)
  ✓ the coordinates are in the Bay Area, not a null-island fallback
  ✓ POST device-location → 200
  ✓ the fix is evaluated against the home-arrival rule
      reason: before-cutoff
  ✓ a fix 120km from the house never ends the drive
  ✓ the active drive survived a far-away fix
  ✓ final state — concord-corridor-sat-jul-18-sf-1pm is the active drive
  ✓ exactly one active drive at rest
  ✓ GET /api/config/tesla → 200
  ✓ all three credentials are described
  ✓ credential VALUES never leave the Worker — masks are dots only
  ✓ the mask still reports a length, so a truncated secret is visible
      configured=true telemetryRecording=true
  ✓ PATCH /api/config/tesla {telemetryRecording:false} → 200
  ✓ recording reads back as off
  ✓ the off state persisted
  ✓ recording restored to on
  ✓ PATCH without \`telemetryRecording\` → 400
  ✓ POST /api/config/tesla/health → 200
  ✓ every probe reports a verdict
      [ok] Credentials present in the Secrets Store — TESSIE_API_TOKEN, TESLA_BETSY_VIN and WORKER_API_KEY are all set.
      [ok] Live position read from Tessie — Vehicle reported 37.5715, -122.3148.
      [ok] Recorded vehicle events carry coordinates — 1 of 1 events have a position. Coordinates are what the auto-visit and home-arrival rules read.
      [warn] Historical telemetry carries position + shift state — Recording is enabled but no frames have arrived. Tessie does not PUSH telemetry — it exposes a WebSocket (streaming.tessie.com/{VIN}) that a client must dial — so nothing will arrive until something pipes that stream into POST /api/tesla/telemetry.
      [ok] Events are still arriving — Last event 0 day(s) ago (2026-07-21T17:23:47.000Z).
      [ok] Position updates reach the Worker — Polled from Tessie's cached state every 120s while a drive is active (cached reads never wake the car). Tessie has no webhook product, so nothing is pushed to us.
  ✓ the screening reads the historical event tables
  ✓ GET /api/mcp-docs → 200
  ✓ the tesla tool domain is registered (status, location, events, navigate)
  ✓ every tesla tool documents an example (registry contract)
  ✓ only the navigation tool is a write — the rest are read-only
  ✓ POST /api/tesla/poll → 200
      polled=false reason=throttled shift=- home=-
  ✓ the poll ran, or said exactly why it didn't
  ✓ a second immediate poll is throttled (or there is no active drive)
  ✓ GET /api/tesla/status → 200
      tessie configured: true

49 passed, 0 failed

$ pnpm run test:home-arrival

(node:49682) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Volumes/Projects/workers/core-remodel/.claude/worktrees/showroom-scout-agent-be625a/src/backend/services/drive-home-arrival-rules.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Volumes/Projects/workers/core-remodel/.claude/worktrees/showroom-scout-agent-be625a/package.json.
(Use \`node --trace-warnings ...\` to show where the warning was created)

distanceMeters

  ✓ zero distance to itself
  ✓ ~111m per 0.001° of latitude
  ✓ a next-door fix is inside the home radius
  ✓ a showroom across town is not

localMinutesInLA (must be a real timezone conversion, not an offset)

  ✓ 16:00 PDT (summer, UTC-7) reads as 960
  ✓ 16:00 PST (winter, UTC-8) also reads as 960
  ✓ midnight local is 0, not 1440

homeArrivalReason

  ✓ parked at home after the cutoff ends the drive
  ✓ no active drive short-circuits first
  ✓ driving PAST the house does not end it
  ✓ home at lunchtime does not end it
  ✓ parked somewhere else does not end it
  ✓ exactly on the radius still counts as home
  ✓ one metre past the radius does not
  ✓ an unknown home position never reads as 'home'
  ✓ the cutoff minute itself qualifies (15:30 exactly)
  ✓ one minute before the cutoff does not
  ✓ the rule applies seven days a week (Sunday)

18 passed`,
      migrations: [
        {
          tag: "0119_yellow_micromax",
          appliedRemote: true,
          note: "Applied 2026-07-21 via pnpm run migrate:remote. Verified on the remote DB: is_active present on all 14 rows; the newest drive (id 14, concord-corridor-sat-jul-18-sf-1pm) holds the slot after the QC run, every other row 0.",
        },
      ],
    },
  },
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
      qcScript: "scripts/qc/pr_154.mjs",
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
      migrations: [{ tag: "0113_dapper_white_queen", appliedRemote: true }],
    },
    code: [
      {
        title: "Soft delete, and its undo",
        lang: "ts",
        code: `showroomStoresRouter.delete("/:id", async (c) => {
  // NOT db.delete(): the row parents notes, photos, ratings, price
  // observations and drive stops, and on D1 that cascade is irreversible.
  await db.update(showroomStores)
    .set({ isActive: false, updatedAt: new Date() })
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
      qcScript: "scripts/qc/pr_153.mjs",
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
        code: `/**
 * Computes the open badge state based on store hours and the current time.
 *
 * @param hours The store's operating hours.
 * @param now The current time in PST.
 * @returns The open badge state, or null if hours are unavailable.
 */
export function computeOpenBadge(hours: HourRow[], now: PstNow): OpenBadge | null {
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
  "feature-proposals": {
    slug: "feature-proposals",
    branch: "claude/feature-proposals-api-tools-ea0c5c",
    prNumber: 152,
    prUrl: "https://github.com/jmbish04/core-remodel/pull/152",
    problem:
      "An idea gets worked out in conversation with an AI model — often a non-coding chat, mid-discussion. Weeks later a brand-new coding agent picks it up with zero shared memory. What survives that gap is a summary, and a summary is exactly what loses the alternatives that were considered and rejected, the 'no, because…', the constraints discovered halfway through, and the specific phrasing of a requirement that a paraphrase quietly changes. The coding agent rebuilds a lossy version of the plan from it — the telephone game — and the divergence only surfaces once the wrong thing is built. Second gap: there was no way to submit an idea AS a proposal from a non-coding tool at all; the changelog only documents work after the fact.",
    approach:
      "Let the whole conversation travel with the proposal. A proposal bundle keyed by changelog slug carries the PRD, design brief, and PROMPT in D1 (they get rendered), while the RAW transcript goes to R2 under feature-context/<slug>.md with only its key, size, and SHA-256 in the row. Prod D1 measured 28.3MB during this work; a ~450KB dump per proposal is a real fraction of that, and SQLite reads whole rows, so inlining it would make even `SELECT slug, status` drag every byte off disk. Nothing summarizes the transcript on the way in — the unprocessed text IS the value, so both the MCP tool description and the CLI header say so explicitly, because 'helpfully' condensing it is the one change that would quietly destroy the feature. Three entry points (MCP tool, CLI script, HTTP) all route through one service module, so the R2 + hash + upsert dance exists once. TASKS map onto the EXISTING plan_tasks rather than a second task table, and a re-submit deliberately does not reset task status — progress belongs to whoever is doing the work.",
    apiChanges: [
      "POST /api/changelog/proposals — upsert by slug; context streamed to R2, hashed, size recorded; optionally seeds plans + plan_tasks",
      "GET /api/changelog/proposals — list, ?status= filter",
      "GET /api/changelog/proposals/:slug — bundle metadata + live plan tasks (never the raw blob)",
      "GET /api/changelog/proposals/:slug/context — streams the R2 object",
      "MCP: submit_feature_proposal, get_feature_proposal, list_feature_proposals (new `changelog` category)",
      "All four routes gated behind requireAccessAuth; the rest of /api/changelog stays open",
    ],
    filesTouched: [
      "src/backend/services/changelog-proposals.ts",
      "src/backend/api/routes/changelog.ts",
      "src/backend/api/index.ts",
      "src/backend/mcp/tools/changelog/submit_feature_proposal.ts",
      "src/backend/mcp/tools/changelog/get_feature_proposal.ts",
      "src/backend/mcp/tools/changelog/list_feature_proposals.ts",
      "src/backend/mcp/tools/changelog/_shared.ts",
      "src/backend/mcp/tools/changelog/index.ts",
      "src/backend/mcp/tools/index.ts",
      "src/backend/mcp/types.ts",
      "src/frontend/components/changelog/ProposalBundle.tsx",
      "src/frontend/components/changelog/ChangelogEntryView.astro",
      "src/frontend/pages/admin/changelog/preview/[slug].astro",
      "src/frontend/data/changelog-detail.ts",
      "scripts/changelog/submit-proposal.mjs",
      "scripts/changelog/get-proposal.mjs",
      "scripts/changelog/list-proposals.mjs",
      "scripts/qc/pr_152.mjs",
    ],
    migrations: [
      {
        tag: "0112_careful_gambit",
        sql: `CREATE TABLE \`changelog_proposals\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`slug\` text NOT NULL,
	\`plan_slug\` text,
	\`branch\` text,
	\`pr_number\` integer,
	\`prd_markdown\` text,
	\`design_brief_markdown\` text,
	\`prompt_markdown\` text,
	\`context_r2_key\` text,
	\`context_bytes\` integer,
	\`context_sha256\` text,
	\`context_coverage_note\` text,
	\`source_kind\` text DEFAULT 'ai_chat' NOT NULL,
	\`source_model\` text,
	\`status\` text DEFAULT 'proposed' NOT NULL,
	\`created_at\` integer DEFAULT (unixepoch()) NOT NULL,
	\`updated_at\` integer DEFAULT (unixepoch()) NOT NULL
);
CREATE UNIQUE INDEX \`changelog_proposals_slug_unique\` ON \`changelog_proposals\` (\`slug\`);
CREATE INDEX \`changelog_proposals_plan_idx\` ON \`changelog_proposals\` (\`plan_slug\`);
CREATE INDEX \`changelog_proposals_status_idx\` ON \`changelog_proposals\` (\`status\`,\`created_at\`);
CREATE INDEX \`changelog_proposals_branch_idx\` ON \`changelog_proposals\` (\`branch\`);`,
      },
    ],
    code: [
      {
        title: "Hash before writing — a re-submitted transcript skips the R2 put",
        lang: "ts",
        code: `// Hash first and compare: a re-submitted conversation is the common case (an
// agent dumps the whole session again after a few more turns), and re-putting
// an identical 450KB blob is pure waste.
const context = input.context;
if (context != null && context.length > 0) {
  const sha = await sha256Hex(context);
  const key = contextKeyFor(slug);
  if (existing?.contextSha256 === sha && existing.contextR2Key === key) {
    contextUnchanged = true;
  } else {
    await env.ARTIFACTS_BUCKET.put(key, context, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { slug, sha256: sha },
    });
  }
  contextR2Key = key;
  contextBytes = new TextEncoder().encode(context).length;
  contextSha256 = sha;
}`,
      },
      {
        title: "Route order is load-bearing — /proposals must beat /:slug",
        lang: "ts",
        code: `// Registered BEFORE \`GET /:slug\` on purpose: Hono matches in registration
// order, so a \`/:slug\` handler declared first would swallow \`GET /proposals\`.
// Before the fix, GET /api/changelog/proposals returned the entry handler's
// {"error":"Not found"} — a 404 that looks like a missing deploy, not a
// shadowed route.
changelogRouter.get("/proposals", ...);
changelogRouter.post("/proposals", ...);
changelogRouter.get("/proposals/:slug", ...);
changelogRouter.get("/proposals/:slug/context", ...);
changelogRouter.get("/:slug", ...);   // <- pre-existing, must stay last`,
      },
      {
        title: "A re-submit must not reset progress someone already made",
        lang: "ts",
        code: `.onConflictDoUpdate({
  // Re-submitting a proposal must not reset progress a coding session
  // already made, so \`status\` is intentionally NOT in the update set —
  // plan_tasks.status is owned by whoever is doing the work.
  target: [planTasks.planSlug, planTasks.taskKey],
  set: { workstream, phase, title, description, targetRoute,
         changeType, dependsOn, sortOrder, updatedAt: new Date() },
})`,
      },
      {
        title: "An absent coverage note is itself the risk — render it as one",
        lang: "tsx",
        code: `<div className={cn(
  "rounded-lg px-3 py-2 text-xs leading-relaxed ring-1",
  context.coverageNote
    ? "bg-amber-500/8 text-amber-200/90 ring-amber-500/25"
    : "bg-rose-500/8 text-rose-200/90 ring-rose-500/25",
)}>
  <span className="font-semibold uppercase tracking-wide">Coverage — </span>
  {context.coverageNote ??
    "Not recorded. Treat this transcript's completeness as UNKNOWN: it may stop at a compaction boundary or omit earlier discussion."}
</div>`,
      },
    ],
    diagrams: [
      {
        caption: "One service, three entry points — and the D1/R2 split",
        code: `flowchart TD
  chat["Non-coding AI chat"] -->|MCP| tool["submit_feature_proposal"]
  agent["Coding agent (no MCP)"] -->|shell| cli["scripts/changelog/*.mjs"]
  cli -->|HTTP| api["POST /api/changelog/proposals"]
  tool --> svc["services/changelog-proposals.ts<br/>(the only implementation)"]
  api --> svc
  svc -->|"PRD / brief / PROMPT<br/>(rendered, so queryable)"| d1["D1 changelog_proposals"]
  svc -->|"RAW transcript ~450KB<br/>verbatim, never summarized"| r2["R2 feature-context/&lt;slug&gt;.md"]
  svc -->|"TASKS[]"| tasks["D1 plan_tasks<br/>(existing table)"]
  d1 --> page["/admin/changelog/preview/:slug"]
  r2 -.->|"fetched only on click"| page
  tasks -->|"live status"| page`,
      },
    ],
    verification: {
      qcScript: "scripts/qc/pr_152.mjs",
      command:
        "pnpm run test:pr 152 -- --sweep --base https://core-remodel-preview.hacolby.workers.dev",
      ranAt: "2026-07-18",
      source: `// The sweep is where the interesting failures are. A 2KB fixture exercises
// none of what actually makes this feature risky — the payload size on the
// write path, the R2 round-trip, and the hash-based dedupe.
const big = makeTranscript(450_000);
const bigPost = await client.post("/api/changelog/proposals", {
  slug: \`\${SLUG}-large\`, context: big, ...
});
checks.ok("a ~450KB transcript is accepted",
  bigPost.status === 200 || bigPost.status === 201, \`got \${bigPost.status}\`);

const bigCtx = await fetch(\`\${resolveBase()}/api/changelog/proposals/\${SLUG}-large/context\`,
  { headers: { cookie: accessCookie() } });
checks.ok("the large transcript streams back intact", (await bigCtx.text()) === big);`,
      output: `PR #152 QC → https://core-remodel-preview.hacolby.workers.dev

  ✓ target reachable (https://core-remodel-preview.hacolby.workers.dev)
  ✓ unauthenticated GET /api/changelog/proposals is rejected
  ✓ unauthenticated POST /api/changelog/proposals is rejected
  ✓ GET /api/changelog/proposals → 200 (migration 0112 applied)
  ✓ regression: GET /api/changelog/:slug still resolves an entry
  ✓ regression: GET /api/changelog still lists branches
  ✓ POST /api/changelog/proposals accepts a full bundle
  ✓ upsert reports the tasks it seeded
  ✓ upsert stored a context hash
  ✓ GET /api/changelog/proposals/:slug → 200
  ✓ bundle carries the markdown artifacts
  ✓ bundle NEVER inlines the raw transcript
  ✓ coverage note round-trips (it is what stops a reader assuming completeness)
  ✓ TASKS seeded into the EXISTING plan_tasks, with live status
  ✓ the staged changelog entry was upserted alongside the proposal
  ✓ GET …/context streams the R2 object
  ✓ transcript round-trips VERBATIM (nothing summarized it on the way in)
  ✓ re-submitting an identical transcript is detected as unchanged
  ✓ re-submit updates rather than duplicates
  ✓ status-only patch accepted
  ✓ a field omitted from the patch is NOT blanked
  ✓ ?status= filters the list
  ✓ an unknown ?status= is rejected with 400
  ✓ unknown slug → 404
  ✓ preview page renders
  ✓ preview page surfaces the coverage note next to the transcript
  ✓ MCP catalog exposes submit_feature_proposal
  ✓ MCP catalog exposes get_feature_proposal
  ✓ MCP catalog exposes list_feature_proposals

  --sweep: pushing a ~450KB transcript (the size a real dump measured)

    generated 439.5 KB
  ✓ a ~450KB transcript is accepted
    stored 450081 bytes in 246ms
  ✓ stored byte count matches what was sent
  ✓ the large transcript streams back intact
  ✓ listing stays fast with a large transcript stored

33 passed, 0 failed`,
      migrations: [
        {
          tag: "0112_careful_gambit",
          appliedRemote: true,
          note: "pnpm run migrate:remote → 'applied 0112_careful_gambit.sql'; verified with pragma_table_info('changelog_proposals') → 17 columns",
        },
      ],
    },
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
        code: `/**
 * Rebuilds the legacy hours JSON structure from normalized hour rows.
 *
 * @param rows The normalized hour rows.
 * @returns The legacy hours JSON object.
 */
export function rowsToHoursJson(rows): HoursJsonColumn {
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
        code: `/**
 * Parses Google Maps address components into a granular address structure.
 *
 * @param data The Google Maps place data containing address components.
 * @returns The parsed granular address.
 */
export function parseGoogleAddressComponents(data): ParsedAddress {
  const comps = data.addressComponents ?? [];
  /**
   * Helper to pick a specific address component type.
   *
   * @param type The component type to find.
   * @param short Whether to return the short text instead of long text.
   * @returns The component text, or null if not found.
   */
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
        caption:
          "Granular address columns on showroom_stores (blob address kept as the formatted display value).",
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
        code: `/**
 * Derives legacy flat URL fields from the new normalized links table.
 *
 * @param links The store's normalized links.
 * @returns An object containing the legacy flat URL fields.
 */
export function linksToLegacyUrls(links: StoreLinkRow[]): LegacyStoreUrls {
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
        caption:
          "showroom_store_links — the URL source of truth (WEBSITE / INSTAGRAM / PINTEREST / FACEBOOK / OTHER).",
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
/**
 * Parses a raw phone string into labeled phone numbers.
 *
 * @param raw The raw phone string to parse.
 * @returns An object containing the parsed labeled phone numbers.
 */
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
        code: `/**
 * Matches an email sender to a showroom store by domain or name.
 *
 * @param senderEmail The email address of the sender.
 * @param senderName The name of the sender.
 * @param env The environment bindings.
 * @returns The matched showroom store ID, or undefined if no match is found.
 */
async function matchShowroomStore(senderEmail, senderName, env) {
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
        caption:
          "Inbound email → signature extraction → fielded showroom contact (mapped or draft).",
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
