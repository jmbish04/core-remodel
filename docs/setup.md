# Setup Guide

[← Back to Index](README.md)

This guide covers how to set up the `core-remodel` project for local development.

## Prerequisites

- **Node.js**: Ensure you have a recent version installed.
- **pnpm**: This repository strictly uses `pnpm`. Do not use `npm` or `yarn`.

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/jmbish04/core-remodel
cd core-remodel
pnpm install
```

## Running Locally

To start the local development server (which runs Astro via Wrangler):

```bash
pnpm dev
```

Open your browser and navigate to [http://localhost:4321](http://localhost:4321).

## Testing and Linting

- **Build:** `pnpm run build`
- **Lint:** `pnpm run lint` (runs `oxlint`)
- **Format:** `pnpm run fmt` (runs `oxfmt` - **Warning:** Avoid running this globally. Target specific files you modified to prevent massive unintended formatting changes across the codebase.)
- **Check All:** `pnpm run check` (runs linting, formatting checks, and custom enforcement checks like `check-do-alarms.mjs`)
- **Type Checking:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`
  - Type checking must be run manually to avoid heap out-of-memory errors. The standard build process does not perform strict type checking on its own.

## Agent Workflow Notes

- Before starting work, ensure your branch is fresh by running `pnpm run worktree:check`.
- Changelog updates must be pushed to D1 prior to creating PRs.
- Refer to `AGENTS.md` in the repository root for detailed autonomous agent guidelines.

[← Back to Index](README.md)
