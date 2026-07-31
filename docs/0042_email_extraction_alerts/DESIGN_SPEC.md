# 0042 — DESIGN_SPEC: Alerts center + showroom pending items

Two new UI surfaces + one small affordance. Base-UI shadcn, dark Monolith, live
via the existing `publishRealtimeEvent` WebSocket. Full-width per 0041.

## A. Global alerts center

- **Header bell** (in the app shell, next to the cog): unread count = sum of open
  alerts. Click → `/admin/alerts`. Live: subscribes to the `global` realtime room;
  re-fetches on a `mail_received` / `alert_changed` poke.
- **`/admin/alerts`** — a single live feed (aggregator, read-only), grouped:
  ```mermaid
  flowchart TD
    A["/admin/alerts (bell → count)"] --> G1["📥 Email received (N) — 2 pending your OK to AI-process"]
    A --> G2["🧾 Extracted quotes/invoices to map (N)"]
    A --> G3["🏠 Room proposals to confirm (N)"]
    A --> G4["🔎 Park-Finds / product-photo review (N)"]
    G1 --> R1["→ store inbox / approve-AI"]
    G2 --> R2["→ showroom viewport pending item"]
    G3 --> R3["→ receipt-review / proposals"]
  ```
- Each alert row: icon · title · one-line context · relative time · a primary action
  (Approve AI / Map / Confirm) that deep-links to the item's existing review surface.
  No new review UIs — the center is a router over what exists.
- Source: `GET /api/alerts` unions the domain tables (see plan §4). Never a second
  copy of the data; each row references its row id + route.

## B. Showroom viewport — pending items panel

- Inside `StoreViewportApp`, a **"Pending from email"** section (collapsible, badge
  count) listing extracted quotes/invoices matched to this store's domain.
- Each pending item shows the extraction **as captured** (vendor, date, line items:
  description · qty · unit · total) with an AI-confidence chip, and per line:
  - **matched** to a tracked product → shows the product + a "price applied" note.
  - **created** (no match) → "New from quote — confirm/map" with the new brand/product
    and a confirm button (post-approval creation already happened; confirm = accept).
- Price shows as a `product_price_observation` on the product card (source chip:
  "from quote", confidence: extracted). The existing "needs a price" product card
  gains a filled price once the observation lands.

## C. "Approve AI processing" affordance

- On a `pending_approval` email (store inbox + alerts center): a clear
  **"Approve AI extraction"** button. Copy states what will happen: "Runs AI to read
  this attachment and extract line items. Only do this for mail you trust."
- Image-only attachments show "Needs AI OCR" — same approval gate.

## States / copy

- Alerts empty → "You're all caught up."
- Pending email → amber "Pending your approval to AI-process."
- Extracted item → green "Extracted — map to a product."
- Never auto-run AI on Gmail content; the button is the only trigger.
