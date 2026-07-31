# 0043 — Vendor Guest Portal · Design Spec

The portal is the **vendor's whole world**: it must feel like a small, focused app about 126 Colby — not a slice of the admin tool. No admin sidebar, no config cog, no "Enter Admin Portal".

## Surfaces

```mermaid
flowchart LR
  WEL[/welcome?t= (email prefilled)/] --> RW
  RW[Registration wall] --> FP[Floor plan]
  FP --> RG[Room gallery + lightbox]
  RG --> FP
  subgraph Shell
    RW & FP & RG
  end
  classDef s fill:#1e293b,stroke:#64748b
  class RW,FP,RG s
```

### 1. `GuestLayout` (shell)

- Full-width, dark, calm. Top bar: **"126 Colby"** wordmark left; nothing else (no nav, no login button).
- Footer: one muted line ("A private preview shared by Justin — 126 Colby").
- No links out to `/admin/*`. The homeowner uses the workers.dev app for that.

### 2. Registration wall (the gate)

- Centered card on the floor-plan backdrop (blurred/dimmed) so they see there's something worth unlocking.
- Copy: **"See the plans & photos"** → *"126 Colby is a full remodel. Drop your digital business card and step inside."*
- Fields (all required except noted): First name · Last name · Email · Phone · Company website URL.
- One primary button: **"Enter"**. No password, no confirm step.
- On the `/welcome?t=` path, **email is pre-filled** from the signed token as an **editable default** — the field stays editable so they can correct a typo; it is not locked.
- Returning guest (cookie or matched email) never sees this — straight to the floor plan.
- Uses the reusable inputs; website via a URL input; no multi-selects, no currency.

### 3. Floor plan (portal)

- The existing public floor plan (catalog dots + hover cards), re-hosted in `GuestLayout`.
- Clicking a room → the room gallery (PR #315 `PublicRoomGalleryApp`), also in the portal shell.

### 4. Room gallery

- Reuse `PublicRoomGalleryApp` (large tiles, full-screen lightbox, "Back to floor plan"). Only the surrounding shell changes.

### 5. Admin: `/admin/guests` (homeowner side)

- Table of guests: name, company (website / resolved showroom), email, phone, first seen, last seen, # pages viewed.
- Row → drawer with the **page-view trail** (path + time), and a **"Send invite"** button (email prefilled) with an optional intro-message box.
- Follows the standard admin page shell (BaseLayout + header icon + `container mx-auto`).

### 6. Admin config: `/admin/config/portal/onboarding`

- `ConfigShell` page to edit the **intro boilerplate** and the **house-summary blurb** (PlateJS rich-text → markdown+html). This is what every invite email embeds.

## Tokens / parity

- Dark Monolith theme, existing shadcn/Base UI primitives. `Button` uses `render={<a/>}`, `Badge` has no `size`. No new primitives.
