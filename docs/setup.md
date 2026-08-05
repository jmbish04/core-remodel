# Setup Guide

[← Back to Index](./README.md)

## Installation

Ensure you have **Node.js** and **pnpm** installed.

Clone the repository and install dependencies:
# Setup

[Return to Index](README.md)

This guide covers how to set up the `core-remodel` project for local development.

## Prerequisites

- **Node.js**: Ensure you have a recent version installed.
- **pnpm**: This repository strictly uses `pnpm`. Do not use `npm` or `yarn`.

## Installation

```bash
git clone https://github.com/jmbish04/core-remodel
cd core-remodel
pnpm install
```

## Running Locally

To start the development server using Astro and wrangler:
Start the development server:

```bash
pnpm dev
```
Open your browser and navigate to [http://localhost:4321](http://localhost:4321).

## Testing and Linting

- **Build:** `pnpm run build`
- **Lint:** `pnpm run lint` (runs oxlint)
- **Format:** `pnpm run fmt` (runs oxfmt - **Warning:** Avoid running globally to prevent massive formatting changes across the codebase. Format only modified files.)
- **Check:** `pnpm run check` (runs linting, formatting, and custom checks like `check-do-alarms.mjs`)
- **Type Checking:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (Manual type check to avoid heap out-of-memory errors).

## Workflow Notes

- Before starting work, ensure your branch is fresh by running `pnpm run worktree:check`.
- Changelog updates must be pushed to D1 prior to creating PRs (refer to the full `AGENTS.md` for specific command usage).

The application will be available at [http://localhost:4321](http://localhost:4321).

## Linting and Formatting

Run the check suite to ensure code quality:

```bash
pnpm run check
```

Type checking must be run manually:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
```
