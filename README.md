# core-remodel

A moodboard and project management application built with [Astro](https://astro.build/), [Tailwind CSS](https://tailwindcss.com/), and [shadcn/ui](https://ui.shadcn.com/). It is structured as a monorepo that runs on Cloudflare Workers featuring D1 databases, Durable Objects, MCP tools, and AI governance.
A complex monorepo running on Cloudflare Workers featuring Astro, Tailwind CSS, shadcn/ui, D1 databases, MCP tools, and AI governance. It acts as the mission control and shared source of truth for contractors, designers, and homeowners to review existing conditions, inspiration, and in-progress remodel decisions.

---

## Documentation

Comprehensive documentation for this project is available in the [`docs/`](docs/) directory. Start at the [Docs Index](docs/README.md) to navigate through the architecture, setup, deployment, routing, and API details.

---

## Documentation

Full project documentation is available in the [`docs/`](./docs/README.md) directory. Start with the [Index (`docs/README.md`)](./docs/README.md) to explore architecture, routing, setup, and more.

For agentic interactions and autonomous conventions, please refer to [`AGENTS.md`](./AGENTS.md).

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

- `pnpm run build` - Build the project (Cloudflare Workers output).
- `pnpm run lint` - Run `oxlint`.
- `pnpm run fmt` - Run code formatting via `oxfmt` (be cautious using globally).
- `pnpm run check` - Run `oxlint`, `oxfmt`, and check for DO alarms.
```

### Development

To start the local development server:

```bash
pnpm dev
```

Open your browser and go to [http://localhost:4321](http://localhost:4321) to see the app running.

### Testing and Linting

The project uses `oxlint` for linting and `oxfmt` for formatting.

To check code quality and formatting:

```bash
pnpm run check
```

Type checking must be run manually using:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
```

To run PR tests locally before pushing:

```bash
pnpm run test:pr <n>
```

### Build

To build the project for production:

```bash
pnpm run build
```

---

## Agent Guidelines

Autonomous agents working on this repository must consult [`AGENTS.md`](AGENTS.md) for mandatory workflows, branch management, CI/CD previews, and changelog discipline.

## License

This project is licensed under the [MIT License](LICENSE).
