# Core Cloudflare Isolate Runtime Requirements
- Always provide a wrangler.jsonc file (never .toml or .json).
- Set compatibility_date to today's processing date and compatibility_flags to ["nodejs_compat"].
- Include [observability] with enabled: true and head_sampling_rate: 1.
- All routing maps must use Zod validation serving /openapi.json, /swagger, and /scalar endpoints.
- D1 migrations must reside inside ./drizzle and be invoked strictly via 'migrate:db' script.
- AI invocations must explicitly pipe through Cloudflare AI Gateway for fallback orchestration.
- Component layouts must use default Shadcn Dark Theme specs, avoiding explicit borders.
