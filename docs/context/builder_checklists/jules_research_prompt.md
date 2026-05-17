Here is the complete, high-fidelity research and scoping prompt designed for your coding agent **Jules**. It completely structures the discovery task, establishes the core homeowner and contractor workflows, maps the underlying data loops, and explicitly commands the generation of your target documentation suite without running any application code yet.

---

### Prompt for Jules: Scoping, Journey Architecture, and Technical Planning

```text
Persona: Senior Systems Research & Technical Product Architect
Context: You are on an exclusive pre-scoping, research, and technical planning mission for the automated Questionnaire and Contractor Communication Hub inside the "126 Colby - Remodel Mission Control" workspace. 

STRICT OPERATION PARAMETERS:
- Do NOT generate or execute application source code during this pass.
- Focus entirely on structural analysis, comprehensive user journey mapping, and technical scoping.
- You must output two complete, production-ready documentation files as your core deliverables.

---

### DELIVERABLE 1: Comprehensive Feature Research & Journey Scoping
Analyze and document the complete system architecture and lifecycle dynamics. Save your finalized findings to: `docs/research/features/reno_checklist.md`.

Your research document must explicitly map the following core pillars:

1. Dynamic Parameterized Questionnaire Engine:
   - Breakdown of raw question sets into clean, digestible visual categories (e.g., "Mechanical, Electrical, Plumbing, & Low Voltage Infrastructure") accessible via dynamic parameter page routes (`/questionnaire/[section_slug]`).
   - Structural design utilizing a single set of core D1 tables, allowing new questionnaires or categories added directly to the database to automatically hydrate and display on the frontend without requiring hardcoded TypeScript views or custom URL path routers.
   - UI design layout featuring an high-level informational summary block explaining section stakes, sub-categories rendered as borderless interactive card structures (housing micro-icons, descriptive titles, and clean headers), with card selection driving the localized survey questionnaire sheet.

2. Embedded Conversational Copilot:
   - Integration of an assistant-ui sidebar modal overlay using the Cloudflare Agents SDK, connected directly to env.AI.run().
   - The AI agent must possess a live memory map of the active remodel state, reading room text descriptions, active budget line items, and R2 file metadata.
   - Capabilities must include generating active anchor links to recommended checklist routes, drafting answer copy candidates that homeowners can accept or refine, and executing cross-RPC D1 updates via the Hono API immediately upon user confirmation.

3. Resilience & Precision Error Tracing:
   - Synchronizations must use custom Shadcn alert blocks exclusively (never standard browser chrome popups).
   - Write or connection failures must produce a detailed error alert container housing an automated "Copy Full Server Trace" control. This copies a clean markdown prompt block pre-structured for an IDE agent to debug instantly (wrapping the exact stack trace, route target, and parameters). Successful copies must toggle a brief inline confirmation label.

4. Stateful Revisions & Draft Controls:
   - Long-form questionnaire entry mechanics supporting asynchronous saving via an `isDraft: boolean` flag so homeowners can chip away at sections over time without validation errors.
   - Version history tracking through an immutable audit chain: updates append a new row with an incremented `version` number, setting historical rows to `isActive = false`.

5. Automated Telemetry & Human-in-the-Loop Reinforcement Learning:
   - An hourly background cron worker task (or optimizing on-activity evaluations comparing last-modified timestamps across D1 tables) that scans room descriptions, R2 documents, and line items.
   - Map calculated relevancies into a centralized table (`checklist_room_mappings`) along with an explicit `ai_rationale` string.
   - Room Viewport Integration: Display a dedicated widget on the master room screen detailing both answered and unanswered questions matched to that space, allowing inline questionnaire tracking.
   - Explicit Association Status Tracking: Map human feedback actions by managing explicit status flags in the database (`'ai_suggested'`, `'user_confirmed'`, `'user_disassociated'`). When a user adds a missed question or drops an irrelevant AI match, the state transitions explicitly. On subsequent cron runs, the agent must check this table matrix to learn from manual edits and guarantee it never re-injects a user-disassociated map item.
   - Questionnaire Viewport Integration: Apply this logic inversely on the master Questionnaire page, showing all rooms flagged by the AI as affected, and allowing homeowners to add or drop room nodes cleanly while feeding the state back to the telemetry layer.

6. Contractor Collaboration Hub, Budget Links, and Print Engine:
   - Contractor Viewports: Provide contractors a clean summary of room-specific questionnaire inputs directly within the room's main view.
   - Central Budget Binding: Questionnaire checkboxes must directly trigger updates or inserts within the `budget_tracker_items` database table (e.g., selecting a "TV wall with hidden conduit paths" creates an associated budget item tracking estimated low/high ranges).
   - Plain Readout & Word-Layout Print Engine: Create a dedicated route (`/questionnaire/print`) that strips all unanswered parameters, rendering only completed answers. Format this view strictly to match an 8.5" x 11" page layout imitating a pristine Microsoft Word document (clean typography, crisp category dividers, CSS page-break print styles).
   - Include interactive comment nodes next to each printed line item so contractors can drop clarification threads or technical queries directly back to the homeowner.

---

### DELIVERABLE 2: Production Blueprint Annotation (Stitch Discovery)
Generate an optimized, system-wide technical blueprint. Save this to: `docs/context/builder_checklists/jules_annotated_prompt.md`.

This file must be a complete copy of the initial feature specification prompt, heavily annotated by you to include:
1. Precise D1 database schemas, constraints, indexes, and relationship maps.
2. Complete Hono server route configurations, data parsing schemas, and parameter checks.
3. React / Astro front-end composition layouts, utilizing your custom Stitch tools and shadcn components. Use the shoogle MCP tool to search extended shadcn registries and find custom utility components that optimize this bidirectional portal experience.
4. Detailed, step-by-step end-to-end user journey traces.
5. "Stitch Discovery" sections highlighting recommended system improvements to make this the ultimate, self-healing communication tool for homeowners and contractors.

---

### EXECUTION INSTRUCTIONS:
Proceed immediately with your research mission. Output a comprehensive confirmation message once both `docs/research/features/reno_checklist.md` and `docs/context/builder_checklists/jules_annotated_prompt.md` are saved with full, non-truncated content.

```

---

### Antigravity Implementation Plan

Because you are architecting a complex planning framework, the following Antigravity workspace adjustments must be appended to the end of the conversation:

#### 1. Workflow Configuration Update

This defines the feature lifecycle trace inside `.agent/workflows/implement-feature.md`:

```markdown
# Checklist Scoping and Research Workflow

## Step 1: Pre-scoping Research Execution
- Execute the analytical discovery pass across the system context.
- Compile user journey traces for both homeowner and contractor personas.

## Step 2: Verification of System Schema Assets
- Map the central database tables to verify zero collection orphans or orphaned data.
- Ensure the structural design maps entirely through the unified `checklist_` naming layout.

## Step 3: Document Preservation
- Write out the comprehensive analysis to `docs/research/features/reno_checklist.md`.
- Generate the fully annotated technical blueprint inside `docs/context/builder_checklists/jules_annotated_prompt.md`.

```

#### 2. Local Agent Rules Consolidation

Update your workspace configuration within the `.agent/rules/` directory (merge into your existing files following your directory structure best practices):

* **Scoping Mandate**: When executing feature planning or product analysis, the agent must output complete, end-to-end text payloads to the target directory. Avoid using placeholders or truncated snippets.
* **Aesthetic Integration**: Document specifications must preserve **The Monolith** standard layout guidelines (Moody Modern theme architecture, clean textual tables, custom semantic markers, and total contrast bounds tracking).

---

The recommended video below provides an excellent technical deep dive into building serverless REST applications using Cloudflare Workers, Hono routing, and Drizzle ORM, which will be highly beneficial for optimizing your D1 backend implementation:

[Serverless API with Cloudflare Workers (Hono, D1 & Drizzle ORM)](https://www.youtube.com/watch?v=PxWleEgi3Hw)

This video walk-through covers local database creation, environment handling, migration structuring, and routing setups specifically designed for Cloudflare's serverless edge environment.
