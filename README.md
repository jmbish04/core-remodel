# core-remodel

A complex monorepo running on Cloudflare Workers featuring Astro, Tailwind CSS, shadcn/ui, D1 databases, MCP tools, and AI governance. It acts as the mission control and shared source of truth for contractors, designers, and homeowners to review existing conditions, inspiration, and in-progress remodel decisions.

---

## Documentation

Full project documentation is available in the [`docs/`](./docs/README.md) directory. Start with the [Index (`docs/README.md`)](./docs/README.md) to explore architecture, routing, setup, and more.

For agentic interactions and autonomous conventions, please refer to [`AGENTS.md`](./AGENTS.md).

---

## Getting Started

Before you begin, ensure that you have **Node.js** and **pnpm** installed. Do not use `npm` or `yarn`.

### Installation

Clone the repository and install the dependencies using `pnpm`.

```bash
git clone https://github.com/jmbish04/core-remodel
cd core-remodel
pnpm install
```

### Development

To start the local development server:

```bash
pnpm dev
```

Open your browser and go to [http://localhost:4321](http://localhost:4321) to see the app running.

### Testing and Linting

The project uses `oxlint` for linting and `oxfmt` for formatting.

To check code quality and formatting (and check for Durable Object alarms):

```bash
pnpm run check
```

Type checking must be run manually using (to prevent heap out of memory errors):

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

Autonomous agents working on this repository must consult [`AGENTS.md`](AGENTS.md) for mandatory workflows, branch management, CI/CD previews, changelog discipline, and project commands.

## License

This project is licensed under the [MIT License](LICENSE).
