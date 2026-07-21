# DESIGN_SPEC — /health page

Public page (BaseLayout picks PublicSidebar for non-`/admin` paths). Follows the page-shell rule:
the island owns `<main className="container mx-auto max-w-4xl px-4 py-8 pb-12">` with a header block
(Activity icon, title, one-line description), mirroring the usage dashboard.

## Layout
- **Header** — "System Health" + a 24px `Activity` icon + a one-line description.
- **Overall bar** — "Overall" label + a status badge (healthy = emerald, degraded = amber, down =
  destructive) + "as of &lt;time&gt;" + the **Run health checks** button (spinner + "Running checks…"
  while in flight).
- **Per-service grid** (`sm:grid-cols-2`) — one `Card` per service: **Database (D1)**, **Tesla
  telemetry DB (D1)**, **KV cache**, **R2 artifacts**, **Workers AI**. Each shows the service label,
  a status badge, latency in ms (or "—"), and an error line (destructive) when down.
- **States** — loading skeletons on first load; an inline destructive error card on fetch failure;
  an empty state prompting "Run health checks" when there are no rows yet.

## Components / tokens
shadcn `Card` / `Badge` / `Button`; lucide `Activity`, `CheckCircle2`, `AlertTriangle`, `XCircle`,
`RefreshCw`, `Loader2`. Status colors reuse the emerald/amber/destructive ring+badge treatment used
by the integrations usage cards. No admin coupling; public `fetch` (no credentials).
