# 0048 — Design Spec: Render Campaign Admin

## Pages

### `/admin/render/campaigns`

- **Layout:** full-width admin shell, page title "Render Campaigns", primary CTA "New Campaign".
- **Table columns:** Name, Status, Rooms, Angles, Progress, Created, Actions.
- **Status chips:** pending, running, done, failed, paused.
- **Progress:** linear progress bar (`completed / total`).
- **Actions:** View, Cancel (when running).
- **Empty state:** "No campaigns yet. Start one from the API or MCP."

### `/admin/render/campaigns/:id`

- **Header:** campaign name, status chip, progress bar, cancel button.
- **Angles grid:** card per angle with thumbnail, room name, source photo, status, canvas link.
- **Hero angle:** highlighted with a "Hero" badge.
- **Realtime:** `useRenderRealtime` subscription to update statuses as the Workflow progresses.
- **Error panel:** list failed angles with error messages.

## Components

- `CampaignListApp.tsx` — data table + pagination.
- `CampaignDetailApp.tsx` — header + angles grid + error panel.
- Reuse `AngleGallery`, `StageExplorer`, `PipelineStatusLoader`, `StatusBadge`.

## Design tokens

- Monolith profile: dark theme, zinc base, OKLCH chart palette.
- No traditional 1px borders; use rings and dividers.
- Status colors:
  - pending: `text-muted-foreground`
  - running: `text-blue-400`
  - done: `text-green-400`
  - failed: `text-red-400`
  - paused: `text-amber-400`
