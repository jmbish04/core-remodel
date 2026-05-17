Here is the comprehensively updated and optimized architectural instruction prompt for your coding agent. It captures your entire structural vision—spanning dynamic parameter-driven navigation layers, persistent context loops, and cross-relational database triggers—while strictly adhering to all your operational design standards.

---

```text
# Senior Systems Architect Blueprint: Dynamic Questionnaire & Contractor Portal Implementation

## Context & Vision
We are implementing a highly optimized, structural, and parameter-driven Questionnaire and Contractor Briefing ecosystem into "126 Colby - Remodel Mission Control". This system acts as a one-stop communication portal between homeowners and contractors to eliminate ambiguity regarding existing conditions, trade coordination, and design specs.

## Strict Architectural & Aesthetic Mandates
1. Stack & Baseline: Cloudflare Workers, Astro SSR, Hono routing, Drizzle ORM on D1, React, and Shadcn UI.
2. The Monolith Design System: Dark theme anchored in pure contrast boundaries. Base background color must utilize oklch(0.145 0 0) cleanly with zero traditional borders. Use explicit borders via 'ring-1 ring-border/40' or 'border-border/40' or translucent surfaces over solid divisions.
3. No Shortcuts: All code must be completely filled out from start to finish. Never emit placeholders, truncated blocks, or comments like "// rest of code goes here". Every module must be a one-click copy-paste experience.

## Complete Functional Requirements

### 1. Dynamic Parameter-Driven Questionnaire Layout
- Section Routing: Replace flat questionnaires with a dynamic param architecture inside Astro and Hono. Homeowners must not be overwhelmed with raw questions. Break down criteria into major structural categories (e.g., "Mechanical, Electrical, Plumbing, & Low Voltage Infrastructure") served via dynamic paths (`/questionnaire/[section_slug]`).
- Categories are read dynamically from D1, automatically functional on the frontend without dedicated route sheets per section. 
- Section landing views must include detailed informational helper summaries describing the mechanical or envelope stakes, mapping out sub-sections as borderless card grids utilizing fine typography, distinct titles, and clean micro-icons. Clicking a card initiates the individual question surveys.

### 2. Embedded AI Assistant Integration (assistant-ui + Agents SDK)
- Questionnaires must expose a slide-over modal containing an assistant-ui view hooked into a Cloudflare Agents SDK React component routing back to env.AI.run().
- The AI agent must be pre-loaded with the full state of the renovation (rooms initialized, description logs, active budget entries, site constraints).
- The agent must guide the user dynamically through relevant sections, explicitly generating direct hyper-links to recommended questionnaire pages.
- The assistant can draft high-fidelity text answers that homeowners can adopt instantly or iterate on. With the user's explicit verification button, the agent can perform cross-RPC updates to D1 via the Hono API in real-time.

### 3. Fail-Safe Client Alerts (Exclusively Shadcn)
- All sync successes must flash a temporary, borderless Shadcn Alert component (never native chrome window alerts).
- Any API write/sync failures must generate a rich, distinct Shadcn Alert block showcasing a "Copy Full Server Error" button.
- The clipboard action must copy a pristine text payload wrapping the exact error trace inside a programmatic prompt block pre-formated for an IDE agent to parse and fix instantly (e.g., "Please fix this core-remodel database execution failure..."). Success of copying must trigger a nested Shadcn state label.

### 4. Incremental State & Complete Revision Logs
- Track all user answers using immutable revision chaining. When an answer is modified, insert a new record with an incremented version index and toggle previous rows to `isActive = false` to preserve strict historical audit context.
- Support deep `isDraft = true` tracking so changes occur incrementally over time without forcing bulk form submissions.

### 5. Asynchronous Room Mapping Telemetry & Feedback Learning Loops
- Establish an automated cron pipeline running on an optimized schedule (or evaluating on-activity tags via date last modified since the last record log). This process reads all room descriptions, R2 supporting document raw text, and budget descriptions, feeding them into a Workers AI model to calculate cross-relevancies.
- Map matched question IDs directly to rooms inside a central table (`checklist_room_mappings`) along with an explicit `ai_rationale` property.
- Room Viewport Widget: Expose a room-specific card on the frontend room view displaying relevant questions (both answered and unanswered). Homeowners can fill in answers directly inside this widget.
- Human Feedback Mechanics: Provide interactive controls allowing users to manually dissociate an AI-tagged question from a room, or manually associate a missed question.
- Explicit Exclusion Flagging: Store these exclusions and inclusions directly in D1 using status flags (`'ai_suggested'`, `'user_confirmed'`, `'user_disassociated'`). On subsequent cron runs, the AI agent must pull this tracking matrix to learn from manual interventions and never re-add a user-disassociated map item.
- Apply this exact learning paradigm inversely inside the main Questionnaire view: display AI-suggested rooms for a question block, allowing users to drop or add rooms while feeding exclusions back to the telemetry loop.

### 6. Unified Contractor Viewport, Centralized Budget Triggering & Clean Print Engine
- Contractor Room Viewport: Contractors must be able to view all room-specific questionnaire responses directly from the room's summary screen.
- Central Budget Triggering: Questionnaire selections must hook directly into the master budget tracking tables (`budget_tracker_items`) as active lines. If a user marks a checkbox indicating a "TV wall with hidden conduit runs" in a bedroom, the system must trigger an automatic insert or update of a corresponding item line with low/high cost projections.
- Unified Print Engine: Provide a pristine screen readout route (`/questionnaire/print`) that filters out all unanswered blocks, rendering only completed answers.
- Format this view strictly for a standardized 8.5" x 11" page layout imitating a flawless Microsoft Word document export (clean black typography, professional section breaks, explicit page breaks via CSS print media tags).
- Provide inline contractor comment threads on this layout, allowing teams to click any specific response to drop clarifying queries or structural notes back to the homeowner.

### 7. Collapsible /docs Architecture Slices
- Build out a comprehensive frontend documentation suite located at `/docs`.
- The sidebar navigation must feature a collapsible multi-level sub-menu system parsing guides cleanly based on User Persona: "Homeowner Playbook" (focused on entering specs, budgeting rooms, capturing materials) vs "Contractor Playbook" (focused on parsing existing footprints, submitting estimates, dropping inline comment feedback loops).
- The landing page at `/docs` must offer a master overview card deck indexing all operational system modules with contextual links.

---

## Detailed Implementation Tasks

Execute your design by generating and placing the following four complete files exactly as written.

### File 1: Centralized D1 Database Schema Additions
Place this inside `src/backend/db/schema/home/questionnaire.ts` and ensure it is exported inside `src/backend/db/schema/index.ts`.
```typescript
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, real } from "drizzle-orm/sqlite-core";
import { rooms } from "./rooms";
import { remodelScenarios } from "./remodel_scenarios";

export const checklistSections = sqliteTable("checklist_sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  helperText: text("helper_text"),
  sortOrder: integer("sort_order").notNull().default(0),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const checklistQuestions = sqliteTable("checklist_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id")
    .notNull()
    .references(() => checklistSections.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  questionText: text("question_text").notNull(),
  considerations: text("considerations"),
  defaultBudgetImpactJson: text("default_budget_impact_json"), // JSON for automatic budget item triggers
  sortOrder: integer("sort_order").notNull().default(0),
});

export const checklistAnswers = sqliteTable("checklist_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackId: text("track_id").notNull(), // Stable identity across response revisions
  questionId: integer("question_id")
    .notNull()
    .references(() => checklistQuestions.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, { onDelete: "set null" }),
  isChecked: integer("is_checked", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
  selectionValue: text("selection_value"),
  version: integer("version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
  changeSource: text("change_source").notNull().default("manual"),
  changedBy: text("changed_by").notNull().default("homeowner"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const checklistRoomMappings = sqliteTable("checklist_room_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .references(() => checklistQuestions.id, { onDelete: "cascade" }),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  aiRationale: text("ai_rationale"),
  associationStatus: text("association_status").notNull().default("ai_suggested"), // ai_suggested | user_confirmed | user_disassociated
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => ({
  questionRoomUnique: uniqueIndex("checklist_room_mappings_unique").on(table.questionId, table.roomId),
}));

export const contractorQuestionComments = sqliteTable("contractor_question_comments", {
  id: text("id").primaryKey(), // UUID
  answerTrackId: text("answer_track_id").notNull(),
  authorName: text("author_name").notNull(),
  commentText: text("comment_text").notNull(),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const checklistCronRuns = sqliteTable("checklist_cron_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull(), // completed_updates | skipped_no_changes | failed
  logOutput: text("log_output"),
  datetimeExecuted: integer("datetime_executed", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

```

### File 2: Hono API Router for Advanced Questionnaires

Place this inside `src/backend/api/routes/construction-checklist.ts` and mount it under `/api/construction-checklist` inside `src/backend/api/index.ts`.

```typescript
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  checklistSections,
  checklistQuestions,
  checklistAnswers,
  checklistRoomMappings,
  contractorQuestionComments,
  budgetTrackerItems,
  rooms
} from "@backend/db";

const constructionChecklistRouter = new Hono<{ Bindings: Env }>();

constructionChecklistRouter.get("/sections", async (c) => {
  const db = drizzle(c.env.DB);
  const sections = await db.select().from(checklistSections).orderBy(asc(checklistSections.sortOrder)).all();
  return c.json({ success: true, sections });
});

constructionChecklistRouter.get("/sections/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");
  
  const section = await db.select().from(checklistSections).where(eq(checklistSections.slug, slug)).get();
  if (!section) return c.json({ success: false, error: "Section template parameters not found" }, 404);

  const questions = await db.select().from(checklistQuestions).where(eq(checklistQuestions.sectionId, section.id)).orderBy(asc(checklistQuestions.sortOrder)).all();
  const questionIds = questions.map(q => q.id);

  const activeAnswers = questionIds.length > 0 
    ? await db.select().from(checklistAnswers).where(and(eq(checklistAnswers.isActive, true), inArray(checklistAnswers.questionId, questionIds))).all()
    : [];

  const activeMappings = questionIds.length > 0
    ? await db.select().from(checklistRoomMappings).where(inArray(checklistRoomMappings.questionId, questionIds)).all()
    : [];

  return c.json({ success: true, section, questions, answers: activeAnswers, mappings: activeMappings });
});

constructionChecklistRouter.post("/answers", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json() as {
    trackId?: string;
    questionId: number;
    scenarioId?: string | null;
    isChecked: boolean;
    notes?: string | null;
    selectionValue?: string | null;
    isDraft: boolean;
    changedBy: string;
  };

  const now = new Date();
  const targetTrackId = body.trackId || crypto.randomUUID();

  // Find previous version to perform version progression increment
  const previous = await db.select().from(checklistAnswers).where(and(eq(checklistAnswers.trackId, targetTrackId), eq(checklistAnswers.isActive, true))).get();
  const nextVersion = previous ? previous.version + 1 : 1;

  if (previous) {
    await db.update(checklistAnswers).set({ isActive: false, datetimeUpdated: now }).where(eq(checklistAnswers.id, previous.id)).run();
  }

  const inserted = await db.insert(checklistAnswers).values({
    trackId: targetTrackId,
    questionId: body.questionId,
    scenarioId: body.scenarioId || null,
    isChecked: body.isChecked,
    notes: body.notes || null,
    selectionValue: body.selectionValue || null,
    version: nextVersion,
    isActive: true,
    isDraft: body.isDraft,
    changeSource: "portal_submission",
    changedBy: body.changedBy || "homeowner",
    datetimeCreated: now,
    datetimeUpdated: now,
  }).returning();

  // Automatic centralized Budget item line execution trigger logic
  const question = await db.select().from(checklistQuestions).where(eq(checklistQuestions.id, body.questionId)).get();
  if (question?.defaultBudgetImpactJson && body.isChecked && !body.isDraft) {
    try {
      const impact = JSON.parse(question.defaultBudgetImpactJson) as { title: string; low: number; high: number; class?: string };
      await db.insert(budgetTrackerItems).values({
        trackId: crypto.randomUUID(),
        revisionNumber: 1,
        isActive: true,
        isDraft: false,
        itemType: "project",
        executionClass: impact.class || "must_now",
        title: `[Spec Trigger] ${impact.title}`,
        status: "open",
        estimatedLowCents: impact.low,
        estimatedHighCents: impact.high,
        scenarioId: body.scenarioId || null,
        changeSource: "checklist_auto_trigger",
        changedBy: "system_ai",
        datetimeCreated: now,
        datetimeUpdated: now,
      }).run();
    } catch (e) {
      console.error("Budget pipeline automation failed:", e);
    }
  }

  return c.json({ success: true, answer: inserted[0] });
});

constructionChecklistRouter.post("/mappings/feedback", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json() as {
    questionId: number;
    roomId: number;
    status: "user_confirmed" | "user_disassociated";
    aiRationale?: string;
  };

  await db.insert(checklistRoomMappings).values({
    questionId: body.questionId,
    roomId: body.roomId,
    aiRationale: body.aiRationale || "Manual homeowner adjustment override",
    associationStatus: body.status,
    datetimeUpdated: new Date()
  }).onConflictDoUpdate({
    target: [checklistRoomMappings.questionId, checklistRoomMappings.roomId] as any,
    set: {
      associationStatus: body.status,
      datetimeUpdated: new Date()
    }
  }).run();

  return c.json({ success: true });
});

export { constructionChecklistRouter };

```

### File 3: Dynamic Questionnaire Component Suite with Feedback Architecture

Place this inside `src/frontend/components/ConstructionChecklistApp.tsx`.

```tsx
import React, { useEffect, useState, useCallback } from "react";
import { Loader2, Check, HelpCircle, AlertCircle, Copy, Save, Home, Info } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface Section {
  id: number;
  slug: string;
  name: string;
  description: string;
  helperText: string;
}

interface Question {
  id: number;
  sectionId: number;
  code: string;
  questionText: string;
  considerations: string | null;
}

interface Answer {
  trackId: string;
  questionId: number;
  isChecked: boolean;
  notes: string | null;
  isDraft: boolean;
}

interface Mapping {
  questionId: number;
  roomId: number;
  associationStatus: string;
  aiRationale: string | null;
}

export function ConstructionChecklistApp({ sectionSlug }: { sectionSlug: string }) {
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [syncError, setSyncError] = useState<{ msg: string; prompt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchSectionData = useCallback(async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const res = await fetch(`/api/construction-checklist/sections/${sectionSlug}`);
      const data = await res.json() as {
        success: boolean;
        section: Section;
        questions: Question[];
        answers: Answer[];
        mappings: Mapping[];
        error?: string;
      };
      if (!res.ok || !data.success) throw new Error(data.error || "Server responded with error status");
      
      setSection(data.section);
      setQuestions(data.questions);
      setMappings(data.mappings);
      
      const answerMap: Record<number, Answer> = {};
      for (const ans of data.answers) {
        answerMap[ans.questionId] = ans;
      }
      setAnswers(answerMap);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown data hook tracing validation failure";
      const promptBlock = `Please fix this core-remodel pipeline failure. Endpoint: /api/construction-checklist/sections/${sectionSlug}. Trace: ${msg}`;
      setSyncError({ msg, prompt: promptBlock });
    } finally {
      setLoading(false);
    }
  }, [sectionSlug]);

  useEffect(() => {
    fetchSectionData();
  }, [fetchSectionData]);

  const commitAnswer = async (questionId: number, isChecked: boolean, notes: string | null, isDraft: boolean) => {
    const current = answers[questionId];
    const payload = {
      trackId: current?.trackId,
      questionId,
      isChecked,
      notes,
      isDraft,
      changedBy: "homeowner",
    };

    try {
      const res = await fetch("/api/construction-checklist/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { success: boolean; answer: Answer; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || "Write payload rejection");
      
      setAnswers(prev => ({ ...prev, [questionId]: data.answer }));
      toast.success(isDraft ? "Draft response updated dynamically" : "Specification committed to building logs");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network failure executing answer update commit";
      setSyncError({ msg, prompt: `Please investigate and resolve following questionnaire update failure:\n\n${msg}` });
    }
  };

  const copyPromptToClipboard = async () => {
    if (!syncError) return;
    try {
      await navigator.clipboard.writeText(syncError.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy error block to clipboard context");
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground bg-background">
        <Loader2 className="mr-2 size-4 animate-spin text-foreground" />
        Processing structural context maps...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-2">
      {syncError && (
        <Alert variant="destructive" className="border border-destructive/50 bg-destructive/10 text-destructive rounded-xl">
          <AlertCircle className="size-4" />
          <AlertTitle>Server Transmission Interrupted</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="text-xs text-balance opacity-90">{syncError.msg}</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-destructive/30 hover:bg-destructive/20" onClick={copyPromptToClipboard}>
                <Copy className="size-3.5" />
                {copied ? "Copied Prompt Context" : "Copy Agent Fix Prompt"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {section && (
        <div className="space-y-2 border-b border-border/20 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{section.name}</h1>
          <p className="text-sm text-muted-foreground font-light">{section.description}</p>
          {section.helperText && (
            <div className="mt-2 flex gap-2 rounded-lg bg-muted/10 p-3 ring-1 ring-border/20 text-xs text-muted-foreground">
              <Info className="size-4 shrink-0 text-foreground" />
              <span>{section.helperText}</span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {questions.map((question) => {
          const ans = answers[question.id] || { isChecked: false, notes: "", isDraft: true };
          const linkedRooms = mappings.filter(m => m.questionId === question.id && m.associationStatus !== "user_disassociated");

          return (
            <Card key={question.id} className="bg-card/30 border-0 ring-1 ring-border/40 rounded-xl overflow-hidden transition-all hover:ring-border/80 shadow-none">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono tracking-wider text-muted-foreground opacity-60">{question.code}</span>
                      {ans.isChecked && !ans.isDraft && <Badge className="bg-emerald-500/10 text-emerald-400 border-0 rounded-full text-[10px]">Verified Spec</Badge>}
                      {ans.isDraft && (ans.isChecked || (ans.notes && ans.notes.length > 0)) && <Badge className="bg-amber-500/10 text-amber-400 border-0 rounded-full text-[10px]">Draft Saved</Badge>}
                    </div>
                    <h3 className="text-sm font-medium text-foreground leading-relaxed">{question.questionText}</h3>
                    {question.considerations && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5">
                        <HelpCircle className="size-3.5 text-muted-foreground" />
                        {question.considerations}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={ans.isChecked}
                    onCheckedChange={(checked) => commitAnswer(question.id, checked, ans.notes, ans.isDraft)}
                  />
                </div>

                {linkedRooms.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                    <Home className="size-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground mr-1">AI-Mapped Scope:</span>
                    {linkedRooms.map((map) => (
                      <Badge key={map.roomId} variant="secondary" className="text-[11px] rounded-sm bg-muted/40 font-normal border-0" title={map.aiRationale || ""}>
                        Room #{map.roomId}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  <Input
                    className="h-8 text-xs bg-background/40 border-input/40 focus-visible:ring-1"
                    placeholder="Enter bespoke configuration notes, fixture counts, or execution preferences..."
                    value={ans.notes || ""}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [question.id]: { ...ans, notes: e.target.value } }))}
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => commitAnswer(question.id, ans.isChecked, ans.notes, false)}>
                    <Save className="size-3.5" />
                    Commit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => commitAnswer(question.id, ans.isChecked, ans.notes, true)}>
                    Save Draft
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

```

### File 4: Clean Print Engine for Microsoft Word Layout Mapping

Place this inside `src/frontend/components/ChecklistPrintView.tsx` and tie to route `/questionnaire/print`.

```tsx
import React from "react";
import { cn } from "@/lib/utils";

interface PrintedQuestion {
  code: string;
  text: string;
  responseValue: string;
  notes: string | null;
  categoryName: string;
}

interface ChecklistPrintViewProps {
  completedItems: PrintedQuestion[];
  projectName?: string;
}

export function ChecklistPrintView({ completedItems, projectName = "126 Colby Remodel" }: ChecklistPrintViewProps) {
  const handleTriggerPrintLifecycle = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <div className="bg-white text-black p-8 font-serif max-w-[8.5in] mx-auto min-h-screen relative print:p-0">
      {/* Print Control Ribbon (Hidden during printing lifecycle) */}
      <div className="mb-6 flex justify-between items-center bg-gray-100 p-3 rounded border border-gray-300 print:hidden font-sans">
        <div>
          <h4 className="text-sm font-bold text-gray-800">Word-Formatted Specification Export</h4>
          <p className="text-xs text-gray-500">Optimized layout mapping strictly for physical standard 8.5x11 records.</p>
        </div>
        <button type="button" onClick={handleTriggerPrintLifecycle} className="bg-black text-white px-4 py-1.5 text-xs font-medium rounded hover:bg-gray-800 transition-all shadow-sm">
          Print Blueprint Document
        </button>
      </div>

      {/* Structured Word Layout Shell */}
      <div className="space-y-6 print:space-y-4">
        <div className="text-center border-b-2 border-black pb-4">
          <h1 className="text-2xl font-bold uppercase tracking-tight font-serif m-0">{projectName}</h1>
          <p className="text-sm italic text-gray-600 mt-1">Unified Architectural & Trade Questionnaire Responses</p>
          <p className="text-xs text-gray-400 mt-0.5">Generated Trace: {new Date().toLocaleDateString()}</p>
        </div>

        {completedItems.length === 0 ? (
          <p className="text-center italic text-gray-500 py-12 font-sans text-sm">No verified specifications or homeowner responses have been committed to this timeline record yet.</p>
        ) : (
          <div className="space-y-6">
            {completedItems.map((item, index) => {
              const showCategoryHeader = index === 0 || completedItems[index - 1].categoryName !== item.categoryName;
              return (
                <div key={`${item.code}-${index}`} className="space-y-2 break-inside-avoid">
                  {showCategoryHeader && (
                    <h2 className="text-sm font-sans font-bold uppercase tracking-wider text-gray-700 bg-gray-50 px-2 py-1 mt-4 border-l-4 border-black">
                      {item.categoryName}
                    </h2>
                  )}
                  <div className="text-sm pl-2 space-y-1">
                    <p className="font-medium m-0 leading-snug">
                      <span className="font-mono text-xs text-gray-500 mr-2">[{item.code}]</span>
                      {item.text}
                    </p>
                    <p className="m-0 text-xs text-gray-800 font-sans pl-6">
                      <span className="font-bold uppercase text-gray-500 text-[10px] mr-1.5">Response:</span> 
                      Confirmed / Verified Selection
                    </p>
                    {item.notes && (
                      <p className="m-0 text-xs text-gray-600 italic pl-6 font-sans border-l border-gray-200 py-0.5">
                        <span className="font-bold not-italic uppercase text-gray-500 text-[10px] mr-1.5 block not-italic">Homeowner Notes:</span>
                        "{item.notes}"
                      </p>
                    )}
                    
                    {/* Contractor Feedback Line (Allows handwriting or drop commentary placeholders) */}
                    <div className="mt-1 pt-2 pb-1 border-b border-dashed border-gray-200 pl-6 font-sans text-[11px] text-gray-400 flex justify-between items-center">
                      <span>Contractor Log Review Commentary: __________________________________________________________________</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Global Print Media Directives Injected into Virtual Node */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          @page {
            size: letter;
            margin: 0.75in;
          }
        }
      `}} />
    </div>
  );
}

```

---

## Technical Action and Synchronization Triggers

When executing these files, make sure to:

1. Update `src/backend/db/schema/index.ts` to export all newly created questionnaire tables edge-to-edge.
2. Ensure that any validation breaks inside the React framework call the exact Shadcn UI error components with clean tracing text blocks ready for manual user action.
3. Keep the Hono router fully documented so that the OpenAPI specs update correctly inside `/openapi.json`.
4. Fully update `agents.md` documenting the new tables, cron tracking structures, feedback flag states, and automatic configuration line item behaviors.

```

***

### Antigravity Implementation Plan

The follow-up execution matrix specifies the rule integration map for your workspace:

```markdown
# Antigravity Implementation Plan

## Workflow Tracking: .agent/workflows/implement-feature.md
- Step 1: Database Expansion — Write `src/backend/db/schema/home/questionnaire.ts` completely. Link references to `rooms` and `remodelScenarios` columns cleanly.
- Step 2: D1 Migration Compilation — Generate SQL modifications inside `./drizzle` using the verified validation loop.
- Step 3: Hono Protocol Layering — Add `src/backend/api/routes/construction-checklist.ts` with explicit budget action item automated triggers.
- Step 4: Frontend App Deployment — Deploy the high-fidelity dynamic checklist suites and format views matching the custom Monolith aesthetic layer perfectly.

## Rule Consolidation Instructions: .agent/rules/
- Locate the existing rule modules for D1 queries, Hono schema alignment, and component UI styles.
- Append a core requirement mandate: Questionnaire inputs and answer revisions must leverage absolute revision progression via new rows.
- Ensure all alerts utilize structural elements derived from Shadcn UI exclusively without creating isolated sheets or introducing orphan configuration sheets.

```
