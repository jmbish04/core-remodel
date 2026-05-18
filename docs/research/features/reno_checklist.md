# Comprehensive Feature Research & Journey Scoping: Remodel Questionnaire and Contractor Communication Hub

## Overview

This document scopes the automated Questionnaire and Contractor Communication Hub inside the "126 Colby - Remodel Mission Control" workspace. It details the structural analysis, comprehensive user journey mapping, and technical scoping for the remodeling platform.

## 1. Dynamic Parameterized Questionnaire Engine

### Database Architecture (D1)

- **Core D1 Tables**: A single set of dynamic parameter tables will house the questionnaire categories, questions, options, and associated logic.
- **Dynamic Hydration**: Adding new questionnaires or categories directly to the D1 database will automatically hydrate the frontend, eliminating the need for hardcoded TypeScript views or custom URL path routers.
- **Routing**: Utilize dynamic parameter page routes (`/questionnaire/[section_slug]`) for localized rendering of survey sections.

### UI / UX Layout

- **High-Level Informational Summary**: Each dynamic route begins with a summary block explaining the stakes of the section (e.g., "Mechanical, Electrical, Plumbing, & Low Voltage Infrastructure").
- **Sub-Categories**: Rendered as borderless interactive card structures housing micro-icons, descriptive titles, and clean headers.
- **Interaction**: Selecting a card drives the rendering of the localized survey questionnaire sheet.

## 2. Embedded Conversational Copilot

### Architecture & Integration

- **assistant-ui Integration**: Utilize an `assistant-ui` sidebar modal overlay connected directly to `env.AI.run()` using the Cloudflare Agents SDK.
- **Live Memory Map**: The AI agent will maintain a live context map of the active remodel state. This includes parsing room text descriptions, active budget line items, and R2 file metadata.

### Capabilities

- **Smart Navigation**: Generate active anchor links to recommended checklist routes.
- **Drafting Answers**: Draft answer copy candidates for homeowners to accept or refine.
- **Execution**: Execute cross-RPC D1 updates via the Hono API immediately upon user confirmation of drafted answers.

## 3. Resilience & Precision Error Tracing

### UI Alert System

- **Custom Shadcn Alerts**: Synchronizations and error states must exclusively use custom Shadcn alert blocks, strictly avoiding standard browser chrome popups.

### Error Handling & Debugging

- **Trace Outputs**: Write or connection failures must trigger a detailed error alert container.
- **One-Click Debugging**: Include an automated "Copy Full Server Trace" control that copies a clean markdown prompt block pre-structured for an IDE agent. The prompt will wrap the exact stack trace, route target, and parameters.
- **User Feedback**: Successful trace copies must toggle a brief inline confirmation label.

## 4. Stateful Revisions & Draft Controls

### Draft Mechanics

- **Asynchronous Saving**: Long-form questionnaire entry supports an `isDraft: boolean` flag, allowing homeowners to progressively complete sections over time without triggering validation errors.

### Version History

- **Immutable Audit Chain**: Version history tracking appends a new row with an incremented `version` number upon updates, setting historical rows to `isActive = false`. This guarantees full rollback capability and historical context for contractor review.

## 5. Automated Telemetry & Human-in-the-Loop Reinforcement Learning

### Telemetry Pipeline

- **Background Workers**: An hourly cron worker task (or an on-activity evaluator comparing last-modified timestamps across D1 tables) scans room descriptions, R2 documents, and line items.
- **Relevancy Mapping**: Calculated relevancies are mapped into a centralized table (`checklist_room_mappings`) with an explicit `ai_rationale` string.

### Human-in-the-Loop Mechanics

- **State Transitions**: Human feedback manages explicit status flags (`'ai_suggested'`, `'user_confirmed'`, `'user_disassociated'`).
- **Learning Cycle**: When a user adds a missed question or drops an irrelevant AI match, the state transitions explicitly. Subsequent cron runs check this matrix to learn from manual edits, ensuring user-disassociated items are never re-injected.

### Viewport Integrations

- **Room Viewport**: Display a dedicated widget on the master room screen detailing answered and unanswered questions matched to that space.
- **Questionnaire Viewport**: The master Questionnaire page shows all rooms flagged by the AI as affected, allowing homeowners to add or drop room nodes cleanly, feeding state back to the telemetry layer.

## 6. Contractor Collaboration Hub, Budget Links, and Print Engine

### Contractor Viewports

- **Localized Context**: Provide contractors a clean summary of room-specific questionnaire inputs directly within the room's main view.
- **Interactive Commenting**: Include interactive comment nodes next to line items for contractors to drop clarification threads or technical queries directly back to the homeowner.

### Central Budget Binding

- **Automated Line Items**: Questionnaire checkboxes trigger direct updates or inserts within the `budget_tracker_items` D1 table (e.g., selecting a "TV wall with hidden conduit paths" creates an associated budget item tracking estimated low/high ranges).

### Plain Readout & Word-Layout Print Engine

- **Dedicated Print Route**: Implement `/questionnaire/print` that strips all unanswered parameters, rendering only completed answers.
- **Formatting**: Format strictly to match an 8.5" x 11" page layout imitating a pristine Microsoft Word document (clean typography, crisp category dividers, CSS page-break print styles).
