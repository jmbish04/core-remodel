# Local product intake (BrowserOS)

Scrapes product pages using **BrowserOS** — the local agentic Chromium — instead
of Cloudflare Browser Rendering.

Why local:

- **It gets pages the remote scraper can't.** BrowserOS runs signed in as the
  operator, so dealer and manufacturer sites that serve a challenge page or a
  stripped catalogue to headless/datacenter clients hand over the real thing.
- **It's free**, and it's watchable — tabs open in the real browser.

## Prerequisites

BrowserOS running on `127.0.0.1:9200` (the `com.humuf.browseros` LaunchAgent
starts it; otherwise `~/.browseros/bin/browseros-cli launch`). Check with:

```bash
python3 -c "import sys;sys.path.insert(0,'scripts/product_intake');
from browseros_client import BrowserOS;print(BrowserOS().health())"
```

Secrets resolve from the environment first, then the local `tokens` CLI. Nothing
needs exporting if `tokens` has them.

## Usage

```bash
# One page, no writes anywhere — start here
python3 scripts/product_intake/scrape_product.py --url https://… --dry-run

# One product, writing to Cloudflare Images + D1
python3 scripts/product_intake/scrape_product.py --url https://… --product-id 35

# Work through products that have no images yet
python3 scripts/product_intake/scrape_product.py --all --limit 10
```

Artifacts land in `artifacts/product-intake/<product-id>/` (gitignored):
`page.md`, `images/`, and `manifest.json`.

## What writes where

| Output | Destination |
|---|---|
| Product images | Cloudflare Images + `product_images` (first image = `isPrimary`) |
| Specs | `product_specs` via Workers AI (`gpt-oss-120b`) |
| Links, document links, og/favicon | `manifest.json` only — see below |

`showroom_product_links`, `showroom_product_scraped_pages`, `product_documents`,
`product_ratings` and `product_ai_rating` are specified but **not yet migrated**.
Everything destined for them is written to `manifest.json` in the shape those
tables expect, so loading them later is a straight read rather than a re-scrape.

## Hard-won details

Each of these cost a debugging cycle against the live server:

- **`evaluate` takes a function body, not an expression.** `return document.title`
  works; `(() => document.title)()` evaluates fine but reads back as the literal
  string `"undefined"` — silently yielding zero assets on every page.
- **`wait` takes milliseconds.** Passing seconds gives a ~2ms pause, which looks
  like it worked until you notice pages returning 7 characters. Use
  `BrowserOS.settle()`, which polls until the extracted length stops growing —
  a fixed pause is always either too slow or too short for a JS-rendered page.
- **Extraction output is fenced on both sides** with
  `[UNTRUSTED_PAGE_CONTENT nonce=…]` / `[END_UNTRUSTED_PAGE_CONTENT nonce=…]`.
  Strip both before parsing. Keep them when passing prose to a model: scraped
  text is untrusted and may carry instructions aimed at whatever reads it next.
- **The AI Gateway needs two different credentials.** `Authorization` carries a
  Workers-AI-capable token (`CLOUDFLARE_OPENHUMAN_AIG_TOKEN` here);
  `cf-aig-authorization` carries the gateway's own token. Omitting the second
  gives `AiGatewayError 2009 Unauthorized`; a token without Workers AI gives
  error `10000 Authentication error`. They look alike and mean different things.
- **Set a User-Agent.** urllib's default `Python-urllib/3.x` is blocked by
  Cloudflare's WAF with `403 error 1010` before the request reaches the gateway.
- **`gpt-oss-120b` has a `reasoning` field** and will spend the whole budget
  there on a long prompt, returning `content: ""` with `finish_reason: "length"`.
  Raise `max_tokens`; don't switch to a reasoning model — `kimi-k2.6` does this
  far worse (~59s to return nothing). See the `workers-ai-structured-output-gotchas`
  memory and `src/backend/utils/ai-json.ts`.
- **Models split units across two spec rows** (`Spout projection` / `Spout
  projection unit`) no matter how firmly the prompt forbids it. `merge_unit_rows`
  folds them deterministically instead of prompt-wrangling.

## Tests

```bash
python3 scripts/tests/test_product_intake.py
```

Offline; every case is a regression that actually occurred.
