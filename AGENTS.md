# AGENTS.md

## Repository Overview
This repository (`jmbish04/core-remodel`) is an Astro shadcn/ui template. It uses Astro for the web framework, Tailwind CSS for styling, and shadcn/ui for frontend components.
The default branch is `main`.

## Build, Test, and Lint Commands
The project uses `pnpm` as the package manager. Use the following exact scripts defined in `package.json`:

* **Development Server:** `pnpm dev` (or `pnpm start`)
* **Build:** `pnpm run build`
* **Linting:** `pnpm run lint`
* **Formatting:** `pnpm run fmt`
* **Checks:** `pnpm run check` (runs `oxlint`, `oxfmt` and `check-do-alarms.mjs`)
* **Database generation:** `pnpm run db:generate`
* **Type Checking:** Type checking must be run manually using `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` because the project's build process does not perform type checking.

## Guidelines for Autonomous Agents
* **Do not assume conventions:** Do not assume or invent repository conventions or testing scripts. Explicitly verify and use the exact scripts defined in `package.json`.
* **Formatting rules:** Running `pnpm run fmt` globally can cause massive unintended formatting changes across thousands of files. When formatting, target only the specific files you have modified.
* **Documentation:** Never overwrite or delete any existing docstrings in the codebase; only add missing ones.
* **Branch check:** As the first action of every session, verify the branch is fresh by running `pnpm run worktree:check` (or `node scripts/worktree-check.mjs`) before reading any source files, dispatching explore agents, or answering analytical questions.
* **Changelog:** Always update the changelog before opening a PR. The changelog is driven by D1 data, not a static file, and entries must be added via D1 upsert scripts.
* **Durable Objects alarms:** The repository explicitly bans the use of the append-only `this.schedule()` in Cloudflare Durable Objects to prevent runaway billing. Use native `ctx.storage.setAlarm()` instead. This is enforced by `scripts/check-do-alarms.mjs` during `pnpm run check`.
