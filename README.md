# core-remodel

A moodboard and project management application built with [Astro](https://astro.build/), [Tailwind CSS](https://tailwindcss.com/), and [shadcn/ui](https://ui.shadcn.com/). It is structured as a monorepo that runs on Cloudflare Workers featuring D1 databases, Durable Objects, MCP tools, and AI governance.

---

## Documentation

Full project documentation is available in the [`docs/`](./docs/README.md) directory. Start with the [Index (`docs/README.md`)](./docs/README.md) to explore architecture, routing, setup, and more.

For agentic interactions and autonomous conventions, please refer to [`AGENTS.md`](./AGENTS.md).

## Getting Started

Before you begin, ensure that you have **Node.js** and **pnpm** installed.

### Setup

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

## License

This project is licensed under the [MIT License](LICENSE).
