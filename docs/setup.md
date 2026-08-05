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

Start the development server:

```bash
pnpm dev
```

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