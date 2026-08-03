<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. -->

---
name: Core Remodel
description: A homeowner vision-to-reality operating system — wayfinding grammar for orientation, atelier surfaces for the vision itself.
---

# Design System: Core Remodel

## Overview

**Creative North Star: "Diagram Outside, Atelier Inside"**

Two grammars, deliberately unblended, each doing a job the other cannot. **The Diagram** is a wayfinding system in the Beck–Vignelli lineage: it throws away literal truth to answer the only questions a person under stress actually has — where am I, what connects, what comes next. It carries orientation, state, movement, dependency, and blockage, and it carries nothing else. **The Atelier** is where material becomes material: imagery at real scale, samples shown as samples, comparison as a first-class layout, the felt picture of a life that does not exist yet.

The split is not decorative. A remodel is simultaneously a logistics problem and a dream, and a product that renders the dream as a database has failed at the thing it exists for. So the shell, the queue, and the money are diagrammatic; the vision and the finds are atelier; and the room screen — the hinge — is both at once. That screen is where this system either works or does not.

The register throughout is calm, exact, and unhurried. The domain supplies plenty of volatility; steadiness is the product's contribution. Nothing here celebrates, gamifies, or performs urgency. Nothing here is soft in a way that costs precision.

**Key Characteristics:**

- Wayfinding grammar for orientation; material grammar for meaning. Never a blend, never a compromise between them.
- Color means a room. It is functional identity, never decoration.
- Geometry only where geometry encodes a relationship.
- Legibility is set by a touchscreen in a moving vehicle, not by a desktop monitor.
- Ambiguity renders as itself. False precision is the failure mode.

**Confirmed anti-references:** the SaaS project-management dashboard — KPI tiles, progress rings, indigo/teal accent, card-wrapped everything — which is what this category ships and what this product refuses. And its predictable opposite, the cream-and-serif "artisanal home" editorial look.

## Colors

Neutral ground, functional color. The only saturated color on any screen belongs to a room, and it is carrying meaning when it appears.

### Primary

- **Room line colors** `[set to be resolved during implementation]`: Each room is assigned one permanent, saturated line color at creation. That color follows the room everywhere it is ever mentioned — budget rows, photo groups, receipts, bids, notifications, the in-car screen — for the life of the project. It is identity, not styling. The set must hold up to ~20 simultaneous rooms while remaining mutually distinguishable at arm's length, and must survive both light and dark ground.

### Neutral

- **Ground** `[to be resolved during implementation]`: The page field. Quiet, near-achromatic, and deliberately unremarkable so that line color and imagery carry all the signal.
- **Hairline** `[to be resolved during implementation]`: Grid, rule, and separator weight. Structural, thin, never a border-for-decoration.
- **Ink** `[to be resolved during implementation]`: Body and label text.

### Named Rules

**The Color Means a Room Rule.** Saturated color is reserved for room identity. If something on screen is colored and it is not a room, it is wrong. Status, severity, and emphasis are carried by weight, position, and state — not by introducing a second color language that competes with the lines.

**The Both Grounds Rule.** Dark and light are co-primary, authored together from day one. A car screen at night with a bright field is blinding; a phone in a sunlit showroom with a dark field is unreadable. Both scenes are real and both are primary, so neither is the default and neither is an afterthought. Room line colors must be selected to survive both.

**The Not-An-Emergency Rule.** A project carrying three problems must not look like a catastrophe. Severity reads through weight and state, never through flooding the screen with alarm color.

## Typography

**Display / Label Font:** A wayfinding grotesk with genuine signage lineage — the Johnston / Frutiger / Helvetica-for-transit family of solutions. `[exact family to be resolved during implementation]`

**Body Font:** `[to be resolved during implementation]` — a workhorse UI face that stays legible at length and does not fight the grotesk.

**Character:** Signage, not branding. The type's job is to be read instantly at arm's length by someone who is tired, in a car, or standing in a showroom aisle. It has authority because it is exact, not because it is expressive.

### Hierarchy

- **Display:** Reserved and rare. Atelier surfaces only, where a room or a vision deserves scale.
- **Headline / Title:** Section and room identification.
- **Body:** Plain language, always. Every professional term appears with its plain-language explanation alongside it.
- **Label:** Small, set in caps, letterspaced. The diagram's native voice — stop names, line names, node annotations. This is the most characteristic type in the system and the most disciplined.

### Named Rules

**The Signage Rule.** Diagram type is set at the size and spacing a signage system would use, and the in-car case sets the floor. If a label is comfortable on a desktop but not readable at arm's length in a vehicle, the desktop is wrong.

**The Plain Language Rule.** A first-time remodeler must be able to act without domain vocabulary. Trade terms are used where they improve accuracy — never to sound authoritative — and always carry their translation.

## Layout

Generous quiet ground with a hairline structural grid. Density is earned: the diagram is sparse because sparseness is what makes it readable, and atelier surfaces are spacious because material needs room to be judged.

Three contexts, and they are not one layout scaled:

- **Desktop** — the full network. All lines, all stops, the threshold rule crossing everything.
- **Phone** — lines become weighted rows, the threshold still crossing all of them. Capture is one-handed and thumb-reachable, because the real capture moment is standing in an aisle.
- **In-car** — the legibility floor for the entire system. Fewest nodes, largest labels, glanceable state. Capture and confirm only; no specification work happens in a moving vehicle.

Exact grid, container, and spacing values `[to be resolved during implementation]`.

## Elevation & Depth

**Flat.** No shadows, no cards, no raised surfaces. Depth is conveyed by hairline rules, tonal separation of the ground, and the diagram's own layering of lines over field.

This is not minimalism for its own sake — a wayfinding system that renders its lines on floating cards has stopped being a wayfinding system. The diagram lies flat on the ground the way a map lies flat on a wall.

### Named Rules

**The No-Card Rule.** Content is not wrapped in a card to give it presence. Presence comes from position, weight, and space. A card wrapper anywhere in the diagram layer is a defect.

## Shapes

Orthogonal and diagrammatic. Corners are square or near-square; the form language comes from line, node, and rule rather than from radius.

The vocabulary is small and fixed: uniform solid dots for stops, ringed double-circles for interchanges, thick strokes for room lines, hairlines for structure, and a single drawn rule for the translation-ready threshold. Strokes run at 45° and 90° only.

### Named Rules

**The Geometry Means Something Rule.** A 45° turn must encode a relationship. Where nothing is being encoded, use ordinary layout. Decorative diagonals are a defect, and they are the most likely way this world degrades.

**The Never Color Alone Rule.** Every line carries a label and every stop carries a shape. Color is never the sole carrier of meaning — required for accessibility, and required again by the in-car case.

## Do's and Don'ts

### Do:

- **Do** assign each room one permanent line color at creation and carry it everywhere that room is ever referenced.
- **Do** let the diagram lead on Home, Needs You, and Money; let the atelier lead on Vision and Out There; and give Rooms both.
- **Do** set legibility from the in-car case and work back to the desktop.
- **Do** render ambiguity as itself — `known`, `assumed`, `range`, and `unknown` are all valid, visible states.
- **Do** keep motion to a single orchestrated behavior. This system has one: a find drawing into an interchange when it is committed to a room.
- **Do** pair every professional term with plain language.

### Don't:

- **Don't** wrap diagram content in cards, or add shadows to create hierarchy.
- **Don't** use saturated color for anything that is not a room.
- **Don't** draw a diagonal that does not encode a relationship.
- **Don't** let the wayfinding grammar into Vision or the entry of a Room. If the whole product feels like infrastructure, the world has been misapplied.
- **Don't** render a single project-wide progress bar. Rooms at different stages simultaneously is the honest picture and the system must show it.
- **Don't** let a room's stop marker move backward. Work reached is never erased.
- **Don't** introduce alarm color to convey severity.
