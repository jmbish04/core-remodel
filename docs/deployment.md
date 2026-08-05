# Deployment

[Return to Index](README.md)

This project is deployed to Cloudflare Workers.

## Production Deployment

Production builds are typically handled by CI/CD pipelines (e.g., GitHub Actions) or deployed via Wrangler commands.

```bash
pnpm run build
```

## Preview Environments

Because CI cannot do it, **you** must deploy your own preview from your session. The worker is named `wcrp-<branch-slug>`.

- `pnpm run deploy:preview` - Deploy `wcrp-<branch-slug>` and print the URL.
- `pnpm run test:pr <n> -- --preview` - QC against YOUR branch, not main.
- `pnpm run preview:list` - See what previews exist.
- `pnpm run preview:delete` - Tear down THIS branch's preview.

Please refer to `AGENTS.md` for detailed rules regarding CI/CD and preview deployments.