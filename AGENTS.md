# AGENTS.md

## Repository Overview
This repository (`jmbish04/core-remodel`) is an Astro shadcn/ui template. It uses Astro for the web framework, Tailwind CSS for styling, and shadcn/ui for frontend components.
The default branch is `main`.

## Build, Test, and Lint Commands
The project uses `pnpm` as the package manager. Use the following exact scripts defined in `package.json`:

* **Development Server:** `pnpm dev` (or `pnpm start`)
* **Build:** `pnpm run build`
* **Linting:** `pnpm run lint`
* **Formatting:** `pnpm run fmt` - **WARNING:** Running `pnpm run fmt` globally can cause massive unintended formatting changes across thousands of files. Target only specific modified files!
* **Checks:** `pnpm run check` (runs `oxlint`, `oxfmt` and `check-do-alarms.mjs`)
* **Database generation:** `pnpm run db:generate`
* **Type Checking:** Type checking must be run manually using `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` because the project's build process does not perform type checking.

## Guidelines for Autonomous Agents
* **Do not assume conventions:** Do not assume or invent repository conventions or testing scripts. Explicitly verify and use the exact scripts defined in `package.json`.
* **Documentation:** Never overwrite or delete any existing docstrings in the codebase; only add missing ones.
* **Durable Objects:** Never use `this.schedule()` in Cloudflare Durable Objects to prevent runaway billing. Use native `ctx.storage.setAlarm()` instead. This is enforced by `scripts/check-do-alarms.mjs` during `pnpm run check`.
