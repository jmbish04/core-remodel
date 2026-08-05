# core-remodel

A complex monorepo running on Cloudflare Workers featuring Astro, Tailwind CSS, shadcn/ui, D1 databases, MCP tools, and AI governance. It acts as the mission control and shared source of truth for contractors, designers, and homeowners to review existing conditions, inspiration, and in-progress remodel decisions.

---

## Documentation

Full project documentation is available in the [`docs/`](docs/) directory. Start with the [Index (`docs/README.md`)](docs/README.md) to explore architecture, routing, setup, and API details.

For agentic interactions and autonomous conventions, please refer to [`AGENTS.md`](AGENTS.md).

## Getting Started

Before you begin, ensure that you have **Node.js** and **pnpm** installed.

### Installation

Clone the repository and install the dependencies using `pnpm`. Do not use `npm` or `yarn`.

```bash
git clone https://github.com/jmbish04/core-remodel
cd core-remodel
pnpm install
```

### Running Locally

```bash
pnpm dev
```
Open your browser and go to [http://localhost:4321](http://localhost:4321) to see the app running.

### Testing and Linting

The project uses `oxlint` for linting and `oxfmt` for formatting.

- `pnpm run build` - Build the project (Cloudflare Workers output).
- `pnpm run check` - Run `oxlint`, `oxfmt`, and check for DO alarms.
- `pnpm run lint` - Run `oxlint`.
- `pnpm run fmt` - Run code formatting via `oxfmt`. Be cautious using globally, target only specific modified files.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` - Type checking must be run manually using this command to prevent heap out of memory errors.
- `pnpm run test:pr <n>` - To run PR tests locally before pushing, where `<n>` is the PR number.

---

## Agent Guidelines

Autonomous agents working on this repository must consult [`AGENTS.md`](AGENTS.md) for mandatory workflows, branch management, CI/CD previews, and changelog discipline.

## License

This project is licensed under the [MIT License](LICENSE).
