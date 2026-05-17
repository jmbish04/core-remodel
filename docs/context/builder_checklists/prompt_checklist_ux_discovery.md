Here is the updated, highly prescriptive prompt for your coding agent (Stitch/Codex). This blueprint synthesizes the architectural directives from your stack with the user journeys, state loops, and telemetry mechanics detailed in **Jules' Scoping Discovery and Research Logs**.

---

# Senior Systems Architect Blueprint: Remodel Questionnaire & Contractor Briefing Portal

## 1. Context & Operational Vision

We are implementing a structural, parameter-driven Questionnaire and Contractor Briefing ecosystem into **126 Colby - Remodel Mission Control**. This system serves as the single source of truth for existing conditions, trade coordination, and design specs, facilitating clear, asynchronous data exchanges between homeowners and contractors.

All engineering operations must build upon our Cloudflare edge native stack: Cloudflare Workers, Astro SSR, Hono routing, Drizzle ORM on D1, React, and Shadcn UI.

## 2. Monolith Aesthetic & Architectural Mandates

* **Theme Anchor:** Strict premium dark theme using `oklch(0.145 0 0)` for the master document background.
* **Borders & Separation:** Eliminate traditional, harsh line borders. Express surfaces and card containers using subtle translucent canvas differences or layout boundary lines formatted exactly with `ring-1 ring-border/40` or `border-border/40` over solid grid divisions.
* **Code Completeness:** You are a Senior Systems Engineer. You must output every single component, route file, utility, and database schema from start to finish without shortcuts, truncation, or placeholder comments (`// ... rest of code`). Every file must be a zero-modification, one-click copy-paste deployment.

---

## 3. End-to-End User Journey Traces

### Journey A: Homeowner Spec Drill-down & Dynamic Onboarding

1. The homeowner hits `/questionnaire` and sees zero overwhelming forms. Instead, they find a high-level overview summary block card explaining major technical sectors.
2. Sub-categories are mapped below as a clean grid of borderless cards (housing descriptive titles, micro-icons, and contextual sub-headers).
3. Clicking a card cleanly navigates the client via dynamic routing parameter layers to `/questionnaire/[section_slug]`. All configuration metadata, headers, and fields are parsed natively out of D1, ensuring any category injected into the database hydrates dynamically without requiring manual code route sheets.
4. The client toggles checkboxes or updates text values. The system automatically pipes edits asynchronously to the Hono API (`POST /api/construction-checklist/answers`) marked with `isDraft: true`, allowing progressive entries over days without premature validation failures.

### Journey B: Embedded Conversational Copilot & D1 State Modifications

1. While iterating on forms, the user opens a slide-over modal containing an `assistant-ui` panel hooked into the Cloudflare Agents SDK.
2. The copilot pulls a full state summary of the renovation (D1 room dimensions, R2 blueprint text extracts, active estimate logs). The assistant says: *"Justin, based on the scope for the downstairs kitchen, running a mid-wall electrical drop for a TV display here is highly recommended. Should I log that specification?"*
3. The assistant drafts a complete candidate response. The user reviews the copy in-line, edits the text, and hits a distinct "Confirm and Update" interface. The agent makes an RPC update via Hono, committing the answer to D1.
4. The chat response displays a functional, clickable deep-link button pointing directly to the target questionnaire section page for fast client navigation.

### Journey C: Room Viewport Mapping, Exclusions, & Feedback Triggers

1. A background cron worker runs (or evaluates on-activity using last-modified timestamps), running a text scan of room descriptions and R2 document markdown text against questionnaire IDs, storing them in D1 with an explicit `ai_rationale` string.
2. When the homeowner clicks into a room's specific viewport on the frontend, they see an integrated checklist tracking card. This widget shows all questions flagged by the AI as relevant to that specific space.
3. If the AI incorrectly links a question (e.g., flagging "Urinal plumbing" for the primary bathroom), the user clicks a "Remove" button. This transitions the database flag status explicitly to `user_disassociated`.
4. On future cron passes, the background processor reads this exclusion matrix. It respects human feedback loops, learning from manual overrides, and never re-injects a user-disassociated checklist mapping.
5. This inverse interaction loop exists directly inside the master Questionnaire view: users see rooms tagged as relevant by the AI, and can manually drop suggestions or add rooms to train the agent's contextual awareness.

### Journey D: Centralized Budget Synchronization

1. When a user finalizes a questionnaire specification (e.g., checking "TV wall support, electrical mid-drop, and hidden low-voltage conduit channels in Bedroom 1"), moving it from draft to committed status, a D1 database trigger executes.
2. The backend handles a cross-table execution insert, adding a shadow project item inside `budget_tracker_items` automatically pre-loaded with conservative low/high cost projections based on pre-compiled default JSON impact blocks mapped to that question ID.

### Journey E: Contractor Briefing, Comments, & Flawless Word Print Engine

1. A contractor logs in and enters a specific Room Viewport. They are greeted by a clear layout section indexing every confirmed questionnaire answer mapped to that specific footprint.
2. The contractor opens the master specification readout route (`/questionnaire/print`). This screen completely suppresses all empty or unanswered questions, rendering only active, committed selections.
3. The layout applies specific print-media CSS directives to match a standard 8.5" x 11" page layout, rendering exactly like a crisp, professional Microsoft Word document (clean typography, clear line spacing, and strong section breaks).
4. Next to each response line on the print layout, an interactive comment loop node is present. Contractors can click directly inline to add detailed questions or trade notes back to the homeowner (e.g., *"Justin, specify if this hidden low-voltage conduit needs to support HDMI 2.1 runs or pure fiber"*).

---

## 4. Complete Unified Database Schema (D1)

Implement and merge this design into `src/backend/db/schema/home/questionnaire.ts` and ensure all objects are cleanly exported via `src/backend/db/schema/index.ts`.

```typescript
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, real } from "drizzle-orm/sqlite-core";
import { rooms } from "./rooms";
import { remodelScenarios } from "./remodel_scenarios";

export const checklistSections = sqliteTable("checklist_sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(), // e.g. 'mep-low-voltage'
  name: text("name").notNull(), // Section Header Title
  description: text("description"), // Stakeholder explanation text
  helperText: text("helper_text"), // Dynamic contextual notes
  iconIdentifier: text("icon_identifier"), // Lucide icon lookup string
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
  code: text("code").notNull().unique(), // e.g. 'ELEC-TV-CONDUIT'
  questionText: text("question_text").notNull(),
  considerations: text("considerations"), // Subtext helper descriptions
  defaultBudgetImpactJson: text("default_budget_impact_json"), // e.g. '{"title":"TV Framing & Conduit Pack","low":45000,"high":120000,"class":"must_now"}'
  sortOrder: integer("sort_order").notNull().default(0),
});

export const checklistAnswers = sqliteTable("checklist_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackId: text("track_id").notNull(), // Immutable progression identity across versions
  questionId: integer("question_id")
    .notNull()
    .references(() => checklistQuestions.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, { onDelete: "set null" }),
  isChecked: integer("is_checked", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"), // Bespoke structural requirements written by user
  selectionValue: text("selection_value"), // Multi-choice raw payload responses
  version: integer("version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true), // Filters head revision
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false), // Allows incremental saves
  changeSource: text("change_source").notNull().default("manual"), // portal_submission | ai_copilot
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
  id: text("id").primaryKey(), // UUID string
  answerTrackId: text("answer_track_id").notNull(),
  authorName: text("author_name").notNull().default("Contractor"),
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

---

## 5. Hono Server Infrastructure (Cloudflare Endpoints)

Implement this logic completely inside `src/backend/api/routes/construction-checklist.ts` and mount it cleanly in `src/backend/api/index.ts`. Handle strict param parsing schemas, Zod validations, and relational mapping fetches.

```typescript
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
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

const AnswerSubmissionSchema = z.object({
  trackId: z.string().optional(),
  questionId: z.number().int(),
  scenarioId: z.string().nullable().optional(),
  isChecked: z.boolean(),
  notes: z.string().nullable().optional(),
  selectionValue: z.string().nullable().optional(),
  isDraft: z.boolean().default(false),
  changedBy: z.string().default("homeowner")
});

const FeedbackMappingSchema = z.object({
  questionId: z.number().int(),
  roomId: z.number().int(),
  status: z.enum(["user_confirmed", "user_disassociated"]),
  aiRationale: z.string().optional()
});

constructionChecklistRouter.get("/sections", async (c) => {
  const db = drizzle(c.env.DB);
  const sections = await db.select().from(checklistSections).orderBy(asc(checklistSections.sortOrder)).all();
  return c.json({ success: true, sections });
});

constructionChecklistRouter.get("/sections/:slug", async (c) => {
  const db = drizzle(c.env.DB);
  const slug = c.req.param("slug");

  const section = await db.select().from(checklistSections).where(eq(checklistSections.slug, slug)).get();
  if (!section) return c.json({ success: false, error: "Target checklist section not found" }, 404);

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
  const payload = await c.req.json();
  const parsed = AnswerSubmissionSchema.safeParse(payload);

  if (!parsed.success) {
    return c.json({ success: false, error: "Validation layout break", details: parsed.error.format() }, 400);
  }

  const body = parsed.data;
  const now = new Date();
  const targetTrackId = body.trackId || crypto.randomUUID();

  const previous = await db.select().from(checklistAnswers).where(and(eq(checklistAnswers.trackId, targetTrackId), eq(checklistAnswers.isActive, true))).get();
  const nextVersion = previous ? previous.version + 1 : 1;

  if (previous) {
    await db.update(checklistAnswers).set({ isActive: false, datetimeUpdated: now }).where(eq(checklistAnswers.id, previous.id)).run();
  }

  const [inserted] = await db.insert(checklistAnswers).values({
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
    changedBy: body.changedBy,
    datetimeCreated: now,
    datetimeUpdated: now,
  }).returning();

  // Automatic entry tracking into budget tables when checkbox is cleanly committed
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
        title: `[Checklist Spec] ${impact.title}`,
        status: "open",
        estimatedLowCents: impact.low,
        estimatedHighCents: impact.high,
        scenarioId: body.scenarioId || null,
        changeSource: "checklist_sync",
        changedBy: "system_ai",
        datetimeCreated: now,
        datetimeUpdated: now,
      }).run();
    } catch (e) {
      console.error("Failed executing automated checklist budget cascade:", e);
    }
  }

  return c.json({ success: true, answer: inserted });
});

constructionChecklistRouter.post("/mappings/feedback", async (c) => {
  const db = drizzle(c.env.DB);
  const payload = await c.req.json();
  const parsed = FeedbackMappingSchema.safeParse(payload);

  if (!parsed.success) {
    return c.json({ success: false, error: "Feedback parameters rejected", details: parsed.error.format() }, 400);
  }

  const body = parsed.data;
  await db.insert(checklistRoomMappings).values({
    questionId: body.questionId,
    roomId: body.roomId,
    aiRationale: body.aiRationale || "Manual layout change via user override",
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

---

## 6. Frontend Client Dashboard UI Components

Design the dynamic workspace client layout inside `src/frontend/components/ConstructionChecklistApp.tsx`. Use extended `assistant-ui` registries to ensure the slide-over conversational copilot handles inline Shadcn forms and diagnostic code catcher layouts gracefully.

```tsx
import React, { useEffect, useState, useCallback } from "react";
import { Loader2, Check, HelpCircle, AlertCircle, Copy, Save, Home, Info, MessageSquare } from "lucide-react";
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
      if (!res.ok || !data.success) throw new Error(data.error || "Server connection error");
      
      setSection(data.section);
      setQuestions(data.questions);
      setMappings(data.mappings);
      
      const answerMap: Record<number, Answer> = {};
      for (const ans of data.answers) {
        answerMap[ans.questionId] = ans;
      }
      setAnswers(answerMap);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Data loading tracing error";
      const promptBlock = `Please fix this core-remodel pipeline failure.\nEndpoint: /api/construction-checklist/sections/${sectionSlug}.\nTrace: ${msg}`;
      setSyncError({ msg, prompt: promptBlock });
    } finally {
      setLoading(false);
    }
  }, [sectionSlug]);

  useEffect(() => {
    fetchSectionData();
  }, [fetchSectionData]);

  const handleUpdateResponse = async (questionId: number, isChecked: boolean, notes: string | null, isDraft: boolean) => {
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
      if (!res.ok || !data.success) throw new Error(data.error || "Edge sync execution error");
      
      setAnswers(prev => ({ ...prev, [questionId]: data.answer }));
      toast.success(isDraft ? "Draft state logged successfully" : "Specification final verification saved");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checklist state save exception";
      setSyncError({ msg, prompt: `Please investigate and resolve following questionnaire update failure:\n\n${msg}` });
    }
  };

  const handleManualMappingOverride = async (questionId: number, roomId: number, disassociate: boolean) => {
    const nextStatus = disassociate ? "user_disassociated" : "user_confirmed";
    try {
      const res = await fetch("/api/construction-checklist/mappings/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, roomId, status: nextStatus }),
      });
      const data = await res.json() as { success: boolean };
      if (res.ok && data.success) {
        setMappings(prev => prev.map(m => m.questionId === questionId && m.roomId === roomId ? { ...m, associationStatus: nextStatus } : m));
        toast.success("AI room feedback telemetry logged");
      }
    } catch {
      toast.error("Failed to commit reinforcement feedback data");
    }
  };

  const copyPromptToClipboard = async () => {
    if (!syncError) return;
    try {
      await navigator.clipboard.writeText(syncError.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to write to native clipboard context");
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground bg-background">
        <Loader2 className="mr-2 size-4 animate-spin text-foreground" />
        Synchronizing Monolith spec modules...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-4">
      {syncError && (
        <Alert variant="destructive" className="border border-destructive/50 bg-destructive/10 text-destructive rounded-xl">
          <AlertCircle className="size-4" />
          <AlertTitle>Specification Pipeline Interrupted</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="text-xs font-light opacity-90">{syncError.msg}</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-destructive/30 hover:bg-destructive/20" onClick={copyPromptToClipboard}>
                <Copy className="size-3.5" />
                {copied ? "Copied Prompt" : "Copy Agent Instruction Prompt"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {section && (
        <div className="space-y-2 border-b border-border/10 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{section.name}</h1>
          <p className="text-sm text-muted-foreground font-light leading-relaxed">{section.description}</p>
          {section.helperText && (
            <div className="mt-3 flex gap-2.5 rounded-lg bg-card/60 p-3 ring-1 ring-border/20 text-xs text-muted-foreground leading-normal">
              <Info className="size-4 shrink-0 text-foreground mt-0.5" />
              <span>{section.helperText}</span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {questions.map((question) => {
          const ans = answers[question.id] || { isChecked: false, notes: "", isDraft: true };
          const activeRooms = mappings.filter(m => m.questionId === question.id && m.associationStatus !== "user_disassociated");

          return (
            <Card key={question.id} className="bg-card/20 border-0 ring-1 ring-border/40 rounded-xl overflow-hidden transition-all hover:ring-border/80 shadow-none">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono tracking-wider text-muted-foreground/60">{question.code}</span>
                      {ans.isChecked && !ans.isDraft && <Badge className="bg-emerald-500/10 text-emerald-400 border-0 rounded-full text-[10px]">Verified Head Spec</Badge>}
                      {ans.isDraft && (ans.isChecked || (ans.notes && ans.notes.length > 0)) && <Badge className="bg-amber-500/10 text-amber-400 border-0 rounded-full text-[10px]">Draft Saved</Badge>}
                    </div>
                    <h3 className="text-sm font-medium text-foreground leading-relaxed">{question.questionText}</h3>
                    {question.considerations && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5 font-light">
                        <HelpCircle className="size-3.5 text-muted-foreground/80" />
                        {question.considerations}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={ans.isChecked}
                    onCheckedChange={(checked) => handleUpdateResponse(question.id, checked, ans.notes, ans.isDraft)}
                  />
                </div>

                {activeRooms.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs border-t border-border/10 pt-3">
                    <Home className="size-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground font-light">Linked Space Boundaries:</span>
                    {activeRooms.map((map) => (
                      <div key={map.roomId} className="inline-flex items-center gap-1 rounded bg-muted/30 pl-2 pr-1 py-0.5 text-[11px] text-foreground">
                        <span>Room #{map.roomId}</span>
                        <button type="button" className="text-muted-foreground hover:text-destructive rounded px-0.5" onClick={() => handleManualMappingOverride(question.id, map.roomId, true)}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  <Input
                    className="h-8 text-xs bg-background/30 border-input/40 focus-visible:ring-1"
                    placeholder="Provide detailed construction parameters, brand keys, or trade installation notes..."
                    value={ans.notes || ""}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [question.id]: { ...ans, notes: e.target.value } }))}
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1 shadow-none" onClick={() => handleUpdateResponse(question.id, ans.isChecked, ans.notes, false)}>
                    <Save className="size-3.5" />
                    Commit Verification
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-foreground" onClick={() => handleUpdateResponse(question.id, ans.isChecked, ans.notes, true)}>
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

---

## 7. Collapsible Playbook Documentation Slices (`/docs`)

Implement the collapsible documentation view inside `src/frontend/pages/docs/index.astro`. This ensures your navigation guides segment user experiences cleanly by reader role while rendering your collapsible layout perfectly.

```html
---
import BaseLayout from "@/layouts/BaseLayout.astro";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
---

<BaseLayout title="System Playbooks - Documentation Workspace">
  <div class="grid gap-6 lg:grid-cols-[18rem_1fr] max-w-7xl mx-auto px-4 py-8 bg-background">
    
    <aside class="space-y-4">
      <div className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground opacity-60 px-2">Project Playbooks</div>
      <div class="space-y-1">
        <a href="#overview" class="block rounded-md px-3 py-1.5 text-xs font-semibold uppercase text-foreground bg-secondary/40">Overview</a>
        
        <div class="pt-2 border-t border-border/10 space-y-1">
          <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 px-3">Homeowner Manual</p>
          <a href="#homeowner-specs" class="block rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30">Entering Specifications</a>
          <a href="#homeowner-budget" class="block rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30">Budget Allocations</a>
          <a href="#homeowner-inspiration" class="block rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30">Inspiration Architecture</a>
        </div>

        <div class="pt-2 border-t border-border/10 space-y-1">
          <p class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 px-3">Contractor Guide</p>
          <a href="#contractor-footprint" class="block rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30">Evaluating Existing Footprints</a>
          <a href="#contractor-estimates" class="block rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30">Submitting Estimates</a>
          <a href="#contractor-feedback" class="block rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30">Inline Blueprint Notes</a>
        </div>
      </div>
    </aside>

    <main class="space-y-8 min-w-0" id="overview">
      <div class="space-y-2 border-b border-border/10 pb-4">
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Mission Control Knowledge Base</h1>
        <p class="text-sm text-muted-foreground font-light">Central portal facilitating clean collaboration, immutable record keeping, and trade execution tracking between homeowners and field crews.</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <Card class="bg-card/20 border-0 ring-1 ring-border/40 rounded-xl overflow-hidden shadow-none">
          <CardHeader>
            <CardTitle class="text-sm uppercase font-bold text-foreground tracking-wider">Homeowner Playbook</CardTitle>
            <CardDescription class="text-xs font-light">Learn how to declare specifications, model budget options, and map visual materials cleanly.</CardDescription>
          </CardHeader>
          <CardContent>
            <a href="#homeowner-specs" class="text-xs text-primary font-medium underline-offset-4 hover:underline">Open Homeowner Section →</a>
          </CardContent>
        </Card>

        <Card class="bg-card/20 border-0 ring-1 ring-border/40 rounded-xl overflow-hidden shadow-none">
          <CardHeader>
            <CardTitle class="text-sm uppercase font-bold text-foreground tracking-wider">Contractor Playbook</CardTitle>
            <CardDescription class="text-xs font-light">Learn how to analyze current room conditions, manage payment claims, and leave contextual feedback on plans.</CardDescription>
          </CardHeader>
          <CardContent>
            <a href="#contractor-footprint" class="text-xs text-primary font-medium underline-offset-4 hover:underline">Open Contractor Section →</a>
          </CardContent>
        </Card>
      </div>

      <section id="homeowner-specs" class="space-y-3 pt-6 border-t border-border/10 scroll-mt-6">
        <h2 class="text-lg font-bold text-foreground">Homeowner Manual: Building Specifications & Criteria</h2>
        <p class="text-xs text-muted-foreground leading-relaxed font-light">The questionnaire enables you to specify layout selections progressively. Use the embedded conversational co-pilot to translate broad stylistic goals into granular execution instructions for your crew. Save items as drafts to work incrementally without pressure.</p>
      </section>

      <section id="contractor-footprint" class="space-y-3 pt-6 border-t border-border/10 scroll-mt-6">
        <h2 class="text-lg font-bold text-foreground">Contractor Playbook: Existing Footprints & Feedback Review</h2>
        <p class="text-xs text-muted-foreground leading-relaxed font-light">Field crews can access targeted questionnaire selections directly from any specific Room Viewport. When analyzing bids or performing field layout checks, leverage the clean print engine to generate distraction-free 8.5x11 reference sheets. Drop inline commentary points to coordinate specifications instantly with the client.</p>
      </section>
    </div>
  </div>
</BaseLayout>

```

---

## 8. Antigravity IDE Implementation Plan

At the very end of your build cycle, you must update the core Antigravity configurations inside the project shell.

```markdown
# Antigravity Implementation Plan

## Workflow Specifications: .agent/workflows/implement-feature.md
- Step 1: Database Migration — Run a full code compilation verification of `src/backend/db/schema/home/questionnaire.ts` to log all relations and schema indexes edge-to-edge.
- Step 2: D1 Active Sync — Run the migration pipeline to append newly introduced tables safely.
- Step 3: Server Routing Architecture — Establish and layer the new questionnaire parameter routing handlers in Hono.
- Step 4: Frontend Assembly — Construct the dynamic Astro page layout shells and the React client apps matching the pure Monolith design layer guidelines.

## Rule Updates: .agent/rules/
- BEFORE writing any code or updating variables, the agent must review the existing file assets within `.agent/rules/` first.
- Merge and consolidate the following rule expansions directly inside the existing rule layers (do not generate orphan rule sheets):
  * *Relational Check Restriction:* All questionnaire interactions must operate strictly within the single `checklist_` naming schema bounds to eliminate duplicate or orphaned tracking structures.
  * *Alert & Trace Enforcement:* For client confirmations or background sync fail traces, leverage components extracted from the Shadcn UI library exclusively. Standard web window/chrome notification blocks are fundamentally forbidden.

```
