# Deployment Guide

[← Back to Index](README.md)

This project is deployed as a server-side rendered application to **Cloudflare Workers**.

## Production Deployment

Production builds are typically handled by automated CI/CD pipelines (e.g., GitHub Actions) upon merging into the default branch (`main`).

To build the Worker output locally:

```bash
pnpm run build
```

## Preview Environments (Agent-Owned)

Because CI cannot effectively manage dynamic per-branch worker previews without risking binding collisions, **you must deploy your own preview** from your session for any branch you are working on.

The worker will be named `wcrp-<branch-slug>`.

- `pnpm run deploy:preview` - Deploys the preview worker for your branch and prints the URL.
- `pnpm run test:pr <n> -- --preview` - Runs quality control against YOUR branch's preview, not main. **Never point QC at production while your PR is open.**
- `pnpm run preview:list` - Lists active previews from the local ledger.
- `pnpm run preview:delete` - Tears down the preview worker for your current branch.
- `pnpm run preview:cleanup -- --apply` - Sweeps orphan previews (where the branch is gone from origin).

**Crucial:** These preview workers share production's D1 Database but have isolated Durable Object namespaces. If your branch requires a migration, you must run it against the remote DB (`pnpm run migrate:remote`) making sure the migration is strictly additive.

Always clean up your preview using `pnpm run preview:delete` when you are finished.

For a deep dive into the reasoning and mechanics of preview deployments, refer to `AGENTS.md`.

[← Back to Index](README.md)
