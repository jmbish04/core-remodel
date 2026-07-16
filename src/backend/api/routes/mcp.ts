/**
 * MCP (Model Context Protocol) server for the AI image-editing pipeline.
 *
 * Streamable-HTTP JSON-RPC transport mounted at /api/mcp. Exposes the render +
 * mood-board tools so an MCP client (e.g. Claude) can drive the renderer.
 *
 * Auth: inherits the app's /api/* bearer auth (Authorization: Bearer <WORKER_API_KEY>).
 * That is the "token" an MCP client supplies. NOTE: full claude.ai *connector* OAuth
 * (authorize/token/dynamic-client-registration via @cloudflare/workers-oauth-provider)
 * is a documented follow-up; Claude Code can use this today with a bearer header.
 */
import {
  MEASUREMENT_ELEMENT_TYPES,
  MEASUREMENT_SOURCES,
  listingPhotos,
  moodBoardGenerations,
  renderCanvases,
  renderSessions,
  type MeasurementElementType,
  type MeasurementSource,
} from "@backend/db";
import { researchSessions } from "@backend/db/schema/admin/research_sessions";
import {
  showroomStoreCategory,
  showroomStoreContacts,
  showroomStoreContactBusinessCards,
  showroomStoreProducts,
  showroomStores,
  storeProductResearch,
  storeResearch,
} from "@backend/db/schema/showroom/index";
import { fieldOutContacts } from "@backend/api/routes/showroom-contacts";
import { showroomStoreHours, showroomStoreLinks } from "@backend/db/schema/showroom/index";
import { SHOWROOM_LINK_TYPES, replaceStoreLinks } from "@backend/utils/showroom-links";
import { changelogBranches, changelogEntries } from "@backend/db/schema/changelog/changelog";
import { deriveIsOpenWeekends, hoursJsonToRows, rowsToHoursJson } from "@backend/utils/showroom-hours";
import { loadProductPromptContext } from "@backend/ai/agents/ShowroomResearchAgent/methods/prompt-context";
import {
  researchMcpTokenKey,
  type DeepResearchMcpScope,
  type DeepResearchMcpTokenRecord,
} from "@backend/services/gemini/deep-research";
import {
  createMeasurement,
  getMeasurementCoverage,
  listActiveRooms,
  listMeasurements,
} from "@backend/services/measurements";
import { isRequestAuthenticated } from "@backend/utils/access";
import { and, eq, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { logInvocation, principalLabel } from "../../mcp/logging";
import { generateMoodBoard } from "../../services/render/mood-board";
import { runStage } from "../../services/render/stage-runner";
import type { StageType } from "../../services/render/types";
import { rowToDto } from "./measurements.schemas";

const mcpRouter = new Hono<{ Bindings: Env }>();

const SERVER_INFO = { name: "renovation-studio", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

/**
 * If `text` is a JSON OBJECT (not an array or primitive), parse and return it so
 * it can be surfaced as MCP `structuredContent`. Returns `null` for arrays,
 * primitives, or unparseable prose — callers then fall back to text-only.
 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON — prose result, stays text-only */
  }
  return null;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type McpAuthContext =
  | { kind: "worker" }
  | { kind: "research"; token: string; scope: DeepResearchMcpScope };

const TOOLS: McpTool[] = [
  {
    name: "create_render_session",
    description: "Create a render session for a room. Returns a sessionId used by other tools.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, roomId: { type: "number" } },
      required: ["name"],
    },
  },
  {
    name: "list_room_angles",
    description: "List a room's blank-canvas angle photos (listing photos) available to render.",
    inputSchema: {
      type: "object",
      properties: { roomId: { type: "number" } },
      required: ["roomId"],
    },
  },
  {
    name: "run_render_stage",
    description:
      "Run a render stage. actionType: INITIAL_BASE (floor+paint from a blank canvas; needs listingPhotoId), STRUCTURAL_MOVE (rough-in), MATERIAL_TWEAK or FINISH (from a prior canvasId).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        listingPhotoId: { type: "number" },
        canvasId: { type: "string" },
        actionType: {
          type: "string",
          enum: ["INITIAL_BASE", "STRUCTURAL_MOVE", "MATERIAL_TWEAK", "FINISH"],
        },
        prompt: { type: "string" },
      },
      required: ["sessionId", "actionType", "prompt"],
    },
  },
  {
    name: "generate_mood_board",
    description: "Generate an interior-design mood board from a prompt and/or image URLs.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        imageUrls: { type: "array", items: { type: "string" } },
        roomId: { type: "number" },
      },
    },
  },
  {
    name: "list_mood_boards",
    description: "List generated mood boards, optionally filtered by keyword (q) or roomId.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" }, roomId: { type: "number" } },
    },
  },
  // --- 0006 measurement bridge: live floor-plan "touch" + master measurements ---
  {
    name: "list_rooms",
    description:
      "List the home's ACTIVE rooms (id, roomCode, roomName, floorId, areaSqFt). Use a room's `id` as the `roomId` argument to add_measurement. Only active rooms are valid measurement targets.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "highlight_wall",
    description:
      "Point at a wall segment on the live collaborative floor plan: it flashes amber on every connected screen (the phone at /measure plus any open desktop tab) — i.e. 'Claude is pointing here'. This is how you 'touch' a wall during a measuring session so your human can confirm you mean the right one. `elementId` is the traced SVG segment id, e.g. 'upper_wall_segment_12' or 'lower_wall_segment_3'. `room` defaults to the house room '126-colby'. Returns how many screens it lit up.",
    inputSchema: {
      type: "object",
      properties: {
        elementId: { type: "string" },
        room: { type: "string" },
      },
      required: ["elementId"],
    },
  },
  {
    name: "add_measurement",
    description:
      "Record one measurement in the master measurements table. Dimensions are CANONICAL US units: feet (whole number) + inches (decimal) per side, plus optional areaSqFt — not every element has all sides (a window is width × height). `roomId` (optional) must be an ACTIVE room from list_rooms. Use source='measured' and isApproximate=false for a real tape/laser reading (measure twice, cut once); source defaults to 'estimated' and isApproximate to true.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: { type: "number" },
        elementType: { type: "string", enum: [...MEASUREMENT_ELEMENT_TYPES] },
        label: { type: "string" },
        lengthFeet: { type: "number" },
        lengthInches: { type: "number" },
        widthFeet: { type: "number" },
        widthInches: { type: "number" },
        heightFeet: { type: "number" },
        heightInches: { type: "number" },
        areaSqFt: { type: "number" },
        quantity: { type: "number" },
        source: { type: "string", enum: [...MEASUREMENT_SOURCES] },
        isApproximate: { type: "boolean" },
        accuracyNote: { type: "string" },
        notes: { type: "string" },
      },
      required: ["elementType"],
    },
  },
  {
    name: "list_measurements",
    description:
      "List recorded measurements (newest first), optionally filtered by roomId, elementType (single value or comma-separated list), or free-text q. Use this to see what's already captured before adding more.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: { type: "number" },
        elementType: { type: "string" },
        q: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_measurement_coverage",
    description:
      "Summarize measurement coverage across all active rooms — per-room counts and which element types are recorded — plus the active rooms that still have ZERO measurements. Answers 'what still needs measuring?'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_deep_research_context",
    description:
      "Return the scoped Core Remodel D1 context for this one Deep Research interaction.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "record_deep_research_progress",
    description:
      "Record a short progress note from the Deep Research agent for the scoped target.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        status: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "record_deep_research_source",
    description:
      "Record one scoped source URL or finding discovered by Deep Research.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
        finding: { type: "string" },
        sentiment: { type: "string", enum: ["good", "bad", "neutral"] },
      },
      required: ["url"],
    },
  },
  {
    name: "create_showroom_contact",
    description:
      "Add one or more contacts for a showroom. Send people plus any general office number/email/fax and URLs; the worker files it out into person rows + the store's single GENERAL_CONTACT (fill-missing) + the links table. Provide storeId if known, or match hints (placeId, website, phone, name) for a fuzzy lookup; unmatched contacts are saved as drafts. You do NOT need to know the DB layout.",
    inputSchema: {
      type: "object",
      properties: {
        storeId: { type: "number", description: "Showroom store id, if known." },
        match: {
          type: "object",
          description: "Fuzzy-match hints used when storeId is absent.",
          properties: {
            placeId: { type: "string" },
            website: { type: "string" },
            phone: { type: "string" },
            name: { type: "string" },
          },
        },
        people: {
          type: "array",
          description: "Person contacts to create.",
          items: {
            type: "object",
            properties: {
              firstName: { type: "string" },
              lastName: { type: "string" },
              fullName: { type: "string", description: "Split into first/last when first/last absent." },
              title: { type: "string", description: "Used to infer the contact type." },
              type: { type: "string", enum: ["GENERAL_CONTACT", "SALES", "ESTIMATOR", "MANAGER", "CUSTOMER_SERVICE", "OTHER"] },
              phone: { type: "string", description: "Raw phone string; a labeled office/general number is routed to the store GENERAL_CONTACT." },
              mobilePhoneNumber: { type: "string" },
              officePhoneNumber: { type: "string" },
              officePhoneExtension: { type: "string" },
              faxPhoneNumber: { type: "string" },
              emailAddress: { type: "string" },
              isTextingOk: { type: "boolean" },
              notes: { type: "string" },
            },
          },
        },
        general: {
          type: "object",
          description: "Store-level general contact (office line / email / fax).",
          properties: {
            officePhoneNumber: { type: "string" },
            officePhoneExtension: { type: "string" },
            faxPhoneNumber: { type: "string" },
            emailAddress: { type: "string" },
          },
        },
        urls: {
          type: "array",
          description: "Store URLs → links table.",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              type: { type: "string", enum: [...SHOWROOM_LINK_TYPES] },
              urlNotes: { type: "string" },
            },
            required: ["url", "type"],
          },
        },
        address: { type: "string", description: "Office address → store row when blank." },
        businessCardFront: { type: "string", description: "Optional base64 data: URL of the card FRONT — uploaded + attached to the created contact." },
        businessCardBack: { type: "string", description: "Optional base64 data: URL of the card BACK." },
      },
    },
  },
  {
    name: "create_changelog_entry",
    description:
      "Record a change in the persistent changelog (shown at /admin/changelog, grouped by branch/PR). Upserts the branch and one entry. Every branch/PR of work should call this so the record accumulates in D1 forever. Pass a scorched-earth `detail` object (problem, approach, apiChanges[], mcpChanges[], filesTouched[], migrations[], code[], diagrams[]) for a full detail page.",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Git branch name (grouping key)." },
        branchTitle: { type: "string", description: "Human title for the branch/PR." },
        branchSummary: { type: "string" },
        prNumber: { type: "number" },
        prUrl: { type: "string" },
        status: { type: "string", enum: ["shipped", "staged"], description: "Entry status (branch inherits 'staged'/'shipped')." },
        date: { type: "string", description: "ISO date YYYY-MM-DD." },
        slug: { type: "string", description: "Stable unique slug (detail page URL)." },
        tag: { type: "string", description: "e.g. 'Phase 1'." },
        area: { type: "string", description: "Product area, e.g. 'Showrooms'." },
        title: { type: "string" },
        summary: { type: "string" },
        changes: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["added", "changed", "removed", "migration", "fixed"] }, text: { type: "string" } } } },
        migrations: { type: "array", items: { type: "string" } },
        detail: { type: "object", description: "Scorched-earth PhaseDetail (problem, approach, apiChanges, mcpChanges, filesTouched, migrations, code, diagrams)." },
        diagrams: { type: "array", description: "Branch-level diagrams [{caption, code}].", items: { type: "object" } },
      },
      required: ["branch", "branchTitle", "date", "slug", "area", "title", "summary"],
    },
  },
  {
    name: "set_showroom_address",
    description:
      "Set / correct a showroom's address. For when Google Places got it wrong, the store moved, or intake missed it. Send any of the fields; only those are updated. The two zip fields are kept in sync.",
    inputSchema: {
      type: "object",
      properties: {
        storeId: { type: "number" },
        locationAddress: { type: "string", description: "Full formatted address." },
        locationStreetNumber: { type: "string" },
        locationStreetName: { type: "string" },
        locationCity: { type: "string" },
        locationState: { type: "string", description: "2-letter, e.g. CA." },
        locationZipCode: { type: "string" },
        googleMapsLink: { type: "string" },
      },
      required: ["storeId"],
    },
  },
  {
    name: "set_showroom_links",
    description:
      "Replace ALL of a showroom's links (website + socials + misc). For bulk-filling or correcting URLs. Send the full desired link list — it replaces the existing set.",
    inputSchema: {
      type: "object",
      properties: {
        storeId: { type: "number" },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              type: { type: "string", enum: [...SHOWROOM_LINK_TYPES] },
              urlNotes: { type: "string" },
            },
            required: ["url", "type"],
          },
        },
      },
      required: ["storeId", "links"],
    },
  },
  {
    name: "set_showroom_hours",
    description:
      "Set a showroom's opening hours. Send a structured hoursJson object (7 keys mon..sun, each { open, close } in 24h 'HH:MM' or null when closed). The worker writes the normalized showroom_store_hours rows + derives is_open_weekends — there is no hours blob to manage. Replaces all existing hours for the store.",
    inputSchema: {
      type: "object",
      properties: {
        storeId: { type: "number" },
        hoursJson: {
          type: "object",
          description: "7 day keys mon..sun; each { open: 'HH:MM', close: 'HH:MM' } or null (closed).",
          properties: {
            mon: { type: ["object", "null"] },
            tue: { type: ["object", "null"] },
            wed: { type: ["object", "null"] },
            thu: { type: ["object", "null"] },
            fri: { type: ["object", "null"] },
            sat: { type: ["object", "null"] },
            sun: { type: ["object", "null"] },
          },
        },
      },
      required: ["storeId", "hoursJson"],
    },
  },
  {
    name: "list_showroom_contacts",
    description:
      "List showroom contacts (the phonebook). Filter by storeId, contact type, or a name/email query. Returns each contact with its store name and all phone numbers.",
    inputSchema: {
      type: "object",
      properties: {
        storeId: { type: "number" },
        type: { type: "string", enum: ["GENERAL_CONTACT", "SALES", "ESTIMATOR", "MANAGER", "CUSTOMER_SERVICE", "OTHER"] },
        q: { type: "string", description: "Search name / email." },
        includeDrafts: { type: "boolean" },
      },
    },
  },
  {
    name: "list_failed_business_cards",
    description:
      "List business-card uploads whose vision extraction failed (status=failed) so an external model can re-read the image and resolve them. Returns id, cf_image_url, and draft_notes per card.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "resolve_business_card",
    description:
      "Close the loop on a failed business card: given a cardId and a contact payload (same shape as create_showroom_contact), field it out into a contact and link it back to the card.",
    inputSchema: {
      type: "object",
      properties: {
        cardId: { type: "number" },
        storeId: { type: "number" },
        match: { type: "object" },
        people: { type: "array", items: { type: "object" } },
        general: { type: "object" },
        urls: { type: "array", items: { type: "object" } },
        address: { type: "string" },
      },
      required: ["cardId"],
    },
  },
];

const ACTION_TO_STAGE: Record<string, StageType> = {
  INITIAL_BASE: "stage_1_LP_base",
  STRUCTURAL_MOVE: "stage_2_LP_rough_in",
  MATERIAL_TWEAK: "stage_3_LP_finish",
  FINISH: "stage_3_LP_finish",
};

function deliveryUrlFromToken(token: string): string {
  return token.startsWith("http") ? token : `https://imagedelivery.net/${token}/public`;
}

function metaDeliveryUrl(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { deliveryUrl?: unknown };
    return typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : null;
  } catch {
    return null;
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim();
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return header.slice("bearer ".length).trim();
}

async function authenticateMcpRequest(request: Request, env: Env): Promise<McpAuthContext | null> {
  const token = bearerToken(request);
  if (token) {
    const workerKey = (await env.WORKER_API_KEY.get())?.trim();
    if (workerKey && token === workerKey) {
      return { kind: "worker" };
    }

    if (env.CACHE) {
      const rawRecord = await env.CACHE.get(researchMcpTokenKey(token));
      if (rawRecord) {
        try {
          const record = JSON.parse(rawRecord) as DeepResearchMcpTokenRecord;
          if (new Date(record.expiresAt).getTime() > Date.now()) {
            return { kind: "research", token, scope: record.scope };
          }
        } catch {
          return null;
        }
      }
    }
  }

  if (await isRequestAuthenticated(request, env)) {
    return { kind: "worker" };
  }

  return null;
}

function isResearchTool(name: string): boolean {
  return (
    name === "get_deep_research_context" ||
    name === "record_deep_research_progress" ||
    name === "record_deep_research_source"
  );
}

function requireWorkerAuth(auth: McpAuthContext, name: string) {
  if (auth.kind !== "worker" && !isResearchTool(name)) {
    throw new Error(`Tool ${name} is not allowed for scoped Deep Research MCP tokens`);
  }
}

function scopedKey(scope: DeepResearchMcpScope, suffix: string): string {
  return `research-mcp:${scope.type}:${scope.id}:${suffix}`;
}

async function appendScopedCacheEvent(
  env: Env,
  scope: DeepResearchMcpScope,
  suffix: string,
  event: Record<string, unknown>,
) {
  if (!env.CACHE) return;
  const key = scopedKey(scope, suffix);
  const existing = await env.CACHE.get(key);
  let events: Array<Record<string, unknown>> = [];
  if (existing) {
    try {
      events = JSON.parse(existing) as Array<Record<string, unknown>>;
    } catch {
      events = [];
    }
  }
  events.push({ ...event, at: new Date().toISOString() });
  await env.CACHE.put(key, JSON.stringify(events.slice(-50)), {
    expirationTtl: 6 * 60 * 60,
  });
}

function normalizeSentiment(value: unknown): "good" | "bad" | "neutral" {
  return value === "good" || value === "bad" || value === "neutral"
    ? value
    : "neutral";
}

async function getResearchContext(env: Env, scope: DeepResearchMcpScope): Promise<string> {
  const db = drizzle(env.DB);

  if (scope.type === "product") {
    const context = await loadProductPromptContext(env, scope.productId ?? scope.id);
    return JSON.stringify(context, null, 2);
  }

  if (scope.type === "store") {
    const [store] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.id, scope.storeId ?? scope.id))
      .limit(1);
    return JSON.stringify({ store }, null, 2);
  }

  if (scope.type === "category") {
    const [category] = await db
      .select()
      .from(showroomStoreCategory)
      .where(eq(showroomStoreCategory.id, scope.categoryId ?? scope.id))
      .limit(1);
    return JSON.stringify({ category }, null, 2);
  }

  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, scope.sessionId ?? scope.id))
    .limit(1);

  return JSON.stringify({ session }, null, 2);
}

async function recordResearchSource(
  env: Env,
  scope: DeepResearchMcpScope,
  args: Record<string, any>,
): Promise<string> {
  const db = drizzle(env.DB);
  const url = String(args.url ?? "").trim();
  if (!url) throw new Error("url is required");
  new URL(url);

  const finding = String(args.finding ?? args.summary ?? args.title ?? url).trim();
  if (!finding) throw new Error("finding, summary, or title is required");

  await appendScopedCacheEvent(env, scope, "sources", {
    url,
    title: args.title ?? null,
    summary: args.summary ?? null,
    finding,
    sentiment: normalizeSentiment(args.sentiment),
  });

  if (scope.type === "product") {
    const productId = scope.productId ?? scope.id;
    const [product] = await db
      .select({ id: showroomStoreProducts.id })
      .from(showroomStoreProducts)
      .where(eq(showroomStoreProducts.id, productId))
      .limit(1);
    if (!product) throw new Error(`Product ${productId} not found`);

    const [existing] = await db
      .select({ id: storeProductResearch.id })
      .from(storeProductResearch)
      .where(
        and(
          eq(storeProductResearch.storeProductId, productId),
          eq(storeProductResearch.finding, finding),
          eq(storeProductResearch.findingUrl, url),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(storeProductResearch).values({
        storeProductId: productId,
        finding,
        findingUrl: url,
        sentiment: normalizeSentiment(args.sentiment),
      });
    }
  }

  if (scope.type === "store") {
    const storeId = scope.storeId ?? scope.id;
    const [store] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, storeId))
      .limit(1);
    if (!store) throw new Error(`Store ${storeId} not found`);

    const [existing] = await db
      .select({ id: storeResearch.id })
      .from(storeResearch)
      .where(
        and(
          eq(storeResearch.storeId, storeId),
          eq(storeResearch.finding, finding),
          eq(storeResearch.findingUrl, url),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(storeResearch).values({
        storeId,
        finding,
        findingUrl: url,
        sentiment: normalizeSentiment(args.sentiment),
      });
    }
  }

  return JSON.stringify({ recorded: true, scope, url });
}

async function callResearchTool(
  env: Env,
  auth: McpAuthContext,
  name: string,
  args: Record<string, any>,
): Promise<string> {
  const scope = auth.kind === "research"
    ? auth.scope
    : {
        type: "session" as const,
        id: Number(args.sessionId ?? 0),
        sessionId: Number(args.sessionId ?? 0),
      };

  if (!scope.id) {
    throw new Error("Research scope is required");
  }

  if (name === "get_deep_research_context") {
    return getResearchContext(env, scope);
  }

  if (name === "record_deep_research_progress") {
    const message = String(args.message ?? "").trim();
    if (!message) throw new Error("message is required");
    await appendScopedCacheEvent(env, scope, "progress", {
      message,
      status: args.status ?? null,
    });
    return JSON.stringify({ recorded: true, scope, message });
  }

  if (name === "record_deep_research_source") {
    return recordResearchSource(env, scope, args);
  }

  throw new Error(`Unknown research tool: ${name}`);
}

async function callTool(env: Env, auth: McpAuthContext, name: string, args: Record<string, any>): Promise<string> {
  requireWorkerAuth(auth, name);

  if (isResearchTool(name)) {
    return callResearchTool(env, auth, name, args);
  }

  const db = drizzle(env.DB);
  switch (name) {
    case "create_render_session": {
      const id = crypto.randomUUID();
      await db
        .insert(renderSessions)
        .values({ id, name: String(args.name), roomId: args.roomId ?? null })
        .run();
      return JSON.stringify({ sessionId: id });
    }
    case "list_room_angles": {
      const rows = await db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.roomId, Number(args.roomId)))
        .all();
      return JSON.stringify(
        rows.map((r) => ({
          listingPhotoId: r.id,
          roomName: r.roomName,
          hasBlankCanvas: !!r.blankCanvasCfImageId,
        })),
      );
    }
    case "run_render_stage": {
      const type = ACTION_TO_STAGE[String(args.actionType)];
      if (!type) throw new Error("Invalid actionType");
      let inputImageUrl: string | null = null;
      let parentCanvasId: string | null = null;
      let listingPhotoId: number | null = args.listingPhotoId ?? null;
      let roomId: number | null = null;

      if (args.canvasId) {
        const parent = await db
          .select()
          .from(renderCanvases)
          .where(eq(renderCanvases.id, String(args.canvasId)))
          .get();
        if (!parent) throw new Error("Parent canvas not found");
        inputImageUrl =
          metaDeliveryUrl(parent.metadata) ??
          (parent.outputCfImageId ? deliveryUrlFromToken(parent.outputCfImageId) : null);
        parentCanvasId = parent.id;
        listingPhotoId = parent.listingPhotoId ?? listingPhotoId;
        roomId = parent.roomId ?? null;
      } else if (listingPhotoId != null) {
        const lp = await db
          .select()
          .from(listingPhotos)
          .where(eq(listingPhotos.id, listingPhotoId))
          .get();
        if (!lp) throw new Error("Listing photo not found");
        const token = lp.blankCanvasCfImageId ?? lp.cfImageId;
        if (!token) throw new Error("No blank canvas for this listing photo");
        inputImageUrl = deliveryUrlFromToken(token);
        roomId = lp.roomId ?? null;
      }
      if (!inputImageUrl) throw new Error("Provide canvasId or listingPhotoId");

      const result = await runStage({
        env,
        sessionId: String(args.sessionId),
        type,
        inputImageUrl,
        prompt: String(args.prompt),
        parentCanvasId,
        listingPhotoId,
        roomId,
      });
      return JSON.stringify(result);
    }
    case "generate_mood_board": {
      const mb = await generateMoodBoard({
        env,
        prompt: args.prompt ? String(args.prompt) : undefined,
        imageUrls: Array.isArray(args.imageUrls) ? args.imageUrls.map(String) : undefined,
        roomId: args.roomId ?? null,
        source: "api",
      });
      return JSON.stringify(mb);
    }
    case "list_mood_boards": {
      const rows = await db.select().from(moodBoardGenerations).all();
      let filtered = rows;
      if (args.roomId != null) filtered = filtered.filter((r) => r.roomId === Number(args.roomId));
      if (args.q) {
        const q = String(args.q).toLowerCase();
        filtered = filtered.filter(
          (r) =>
            (r.aiTitle ?? "").toLowerCase().includes(q) ||
            (r.aiDescription ?? "").toLowerCase().includes(q),
        );
      }
      return JSON.stringify(
        filtered.map((r) => ({ id: r.id, aiTitle: r.aiTitle, outputImageUrl: r.outputImageUrl })),
      );
    }
    case "list_rooms": {
      const activeRooms = await listActiveRooms(db);
      return JSON.stringify(activeRooms);
    }
    case "highlight_wall": {
      const elementId = String(args.elementId ?? "").trim();
      if (!elementId) throw new Error("elementId is required");
      const room = (args.room ? String(args.room) : "126-colby").trim() || "126-colby";
      // Server-side RPC into the room's DurableObject — broadcasts a WALL_TOUCH to every
      // connected screen without Claude having to hold a WebSocket. See FloorplanSessionDO.
      const delivered = await env.FLOORPLAN_SESSION.getByName(room).injectTouch(elementId, "claude");
      return JSON.stringify({ room, elementId, delivered });
    }
    case "add_measurement": {
      const elementType = String(args.elementType ?? "");
      if (!(MEASUREMENT_ELEMENT_TYPES as readonly string[]).includes(elementType)) {
        throw new Error(
          `invalid elementType "${elementType}". Valid: ${MEASUREMENT_ELEMENT_TYPES.join(", ")}`,
        );
      }
      let source: MeasurementSource | undefined;
      if (args.source != null) {
        const candidate = String(args.source);
        if (!(MEASUREMENT_SOURCES as readonly string[]).includes(candidate)) {
          throw new Error(
            `invalid source "${candidate}". Valid: ${MEASUREMENT_SOURCES.join(", ")}`,
          );
        }
        source = candidate as MeasurementSource;
      }

      // Coerce optional numerics defensively (the MCP path has no Zod gate): a stray
      // non-numeric becomes null rather than poisoning the row with NaN.
      const num = (v: unknown): number | null => {
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const quantity =
        args.quantity != null && Number.isFinite(Number(args.quantity))
          ? Number(args.quantity)
          : undefined;
      const result = await createMeasurement(db, {
        roomId: num(args.roomId),
        elementType: elementType as MeasurementElementType,
        label: args.label != null ? String(args.label) : null,
        lengthFeet: num(args.lengthFeet),
        lengthInches: num(args.lengthInches),
        widthFeet: num(args.widthFeet),
        widthInches: num(args.widthInches),
        heightFeet: num(args.heightFeet),
        heightInches: num(args.heightInches),
        areaSqFt: num(args.areaSqFt),
        quantity,
        source,
        isApproximate: args.isApproximate != null ? Boolean(args.isApproximate) : undefined,
        accuracyNote: args.accuracyNote != null ? String(args.accuracyNote) : null,
        notes: args.notes != null ? String(args.notes) : null,
      });
      if (!result.ok) throw new Error(result.error);
      return JSON.stringify(rowToDto(result.row));
    }
    case "list_measurements": {
      const elementTypes = args.elementType
        ? String(args.elementType)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const num = (v: unknown): number | undefined => {
        if (v == null) return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      const rows = await listMeasurements(db, {
        roomId: num(args.roomId),
        elementTypes: elementTypes as MeasurementElementType[] | undefined,
        q: args.q != null ? String(args.q) : undefined,
        limit: num(args.limit),
      });
      return JSON.stringify(rows.map(rowToDto));
    }
    case "get_measurement_coverage": {
      const coverage = await getMeasurementCoverage(db);
      return JSON.stringify(coverage);
    }
    case "create_changelog_entry": {
      const status = (args.status === "shipped" ? "shipped" : "staged") as "shipped" | "staged";
      await db
        .insert(changelogBranches)
        .values({
          branch: String(args.branch),
          title: String(args.branchTitle),
          summary: args.branchSummary ? String(args.branchSummary) : null,
          date: String(args.date),
          status,
          prNumber: typeof args.prNumber === "number" ? args.prNumber : null,
          prUrl: args.prUrl ? String(args.prUrl) : null,
          diagramsJson: Array.isArray(args.diagrams) ? (args.diagrams as any) : null,
        })
        .onConflictDoUpdate({
          target: changelogBranches.branch,
          set: {
            title: String(args.branchTitle),
            ...(args.branchSummary ? { summary: String(args.branchSummary) } : {}),
            date: String(args.date),
            ...(typeof args.prNumber === "number" ? { prNumber: args.prNumber } : {}),
            ...(args.prUrl ? { prUrl: String(args.prUrl) } : {}),
            ...(Array.isArray(args.diagrams) ? { diagramsJson: args.diagrams as any } : {}),
            updatedAt: new Date(),
          },
        });
      await db
        .insert(changelogEntries)
        .values({
          slug: String(args.slug),
          branch: String(args.branch),
          tag: args.tag ? String(args.tag) : null,
          area: String(args.area),
          title: String(args.title),
          summary: String(args.summary),
          status,
          date: String(args.date),
          changesJson: Array.isArray(args.changes) ? (args.changes as any) : [],
          migrationsJson: Array.isArray(args.migrations) ? (args.migrations as string[]) : [],
          detailJson: args.detail ? (args.detail as Record<string, unknown>) : null,
        })
        .onConflictDoUpdate({
          target: changelogEntries.slug,
          set: {
            branch: String(args.branch),
            tag: args.tag ? String(args.tag) : null,
            area: String(args.area),
            title: String(args.title),
            summary: String(args.summary),
            status,
            date: String(args.date),
            changesJson: Array.isArray(args.changes) ? (args.changes as any) : [],
            migrationsJson: Array.isArray(args.migrations) ? (args.migrations as string[]) : [],
            ...(args.detail ? { detailJson: args.detail as Record<string, unknown> } : {}),
            updatedAt: new Date(),
          },
        });
      return JSON.stringify({ ok: true, branch: args.branch, slug: args.slug });
    }
    case "set_showroom_address": {
      const storeId = Number(args.storeId);
      const zip = (args.locationZipCode ?? args.zipCode) as string | undefined;
      const [row] = await db
        .update(showroomStores)
        .set({
          ...(args.locationAddress !== undefined ? { locationAddress: args.locationAddress } : {}),
          ...(args.locationStreetNumber !== undefined ? { locationStreetNumber: args.locationStreetNumber } : {}),
          ...(args.locationStreetName !== undefined ? { locationStreetName: args.locationStreetName } : {}),
          ...(args.locationCity !== undefined ? { locationCity: args.locationCity } : {}),
          ...(args.locationState !== undefined ? { locationState: args.locationState } : {}),
          ...(zip !== undefined ? { locationZipCode: zip, zipCode: zip } : {}),
          ...(args.googleMapsLink !== undefined ? { googleMapsLink: args.googleMapsLink } : {}),
          updatedAt: new Date(),
        })
        .where(eq(showroomStores.id, storeId))
        .returning({ id: showroomStores.id });
      return JSON.stringify({ ok: Boolean(row), storeId });
    }
    case "set_showroom_links": {
      const storeId = Number(args.storeId);
      await replaceStoreLinks(db, storeId, (args.links as any[]) ?? []);
      const links = await db
        .select({ id: showroomStoreLinks.id, url: showroomStoreLinks.url, type: showroomStoreLinks.type })
        .from(showroomStoreLinks)
        .where(eq(showroomStoreLinks.storeId, storeId));
      return JSON.stringify({ ok: true, storeId, links });
    }
    case "set_showroom_hours": {
      const storeId = Number(args.storeId);
      const hoursJson = args.hoursJson as any;
      await db.delete(showroomStoreHours).where(eq(showroomStoreHours.showroomId, storeId));
      const rows = hoursJsonToRows(storeId, hoursJson);
      if (rows.length > 0) {
        await db.insert(showroomStoreHours).values(rows as [(typeof rows)[number], ...(typeof rows)[number][]]);
      }
      await db
        .update(showroomStores)
        .set({ isOpenWeekends: deriveIsOpenWeekends(hoursJson), updatedAt: new Date() })
        .where(eq(showroomStores.id, storeId));
      const written = await db
        .select({
          day: showroomStoreHours.day,
          openHour: showroomStoreHours.openHour,
          openMinute: showroomStoreHours.openMinute,
          closeHour: showroomStoreHours.closeHour,
          closeMinute: showroomStoreHours.closeMinute,
        })
        .from(showroomStoreHours)
        .where(eq(showroomStoreHours.showroomId, storeId));
      return JSON.stringify({ storeId, hoursJson: rowsToHoursJson(written), dayCount: written.length });
    }
    case "create_showroom_contact": {
      const res = await fieldOutContacts(db, args as any, env);
      return JSON.stringify(res);
    }
    case "list_showroom_contacts": {
      const conds = [] as any[];
      if (args.storeId != null) conds.push(eq(showroomStoreContacts.storeId, Number(args.storeId)));
      if (typeof args.type === "string") conds.push(eq(showroomStoreContacts.type, args.type as any));
      if (!args.includeDrafts) conds.push(eq(showroomStoreContacts.isDraft, false));
      if (typeof args.q === "string" && args.q.trim()) {
        const q = `%${args.q.trim()}%`;
        conds.push(or(like(showroomStoreContacts.firstName, q), like(showroomStoreContacts.lastName, q), like(showroomStoreContacts.emailAddress, q)));
      }
      const rows = await db
        .select({ contact: showroomStoreContacts, storeName: showroomStores.name })
        .from(showroomStoreContacts)
        .leftJoin(showroomStores, eq(showroomStoreContacts.storeId, showroomStores.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(showroomStoreContacts.lastName, showroomStoreContacts.firstName);
      return JSON.stringify(rows.map((r) => ({ ...r.contact, storeName: r.storeName })));
    }
    case "list_failed_business_cards": {
      const rows = await db
        .select({
          id: showroomStoreContactBusinessCards.id,
          cfImageUrl: showroomStoreContactBusinessCards.cfImageUrl,
          draftNotes: showroomStoreContactBusinessCards.draftNotes,
          storeId: showroomStoreContactBusinessCards.storeId,
        })
        .from(showroomStoreContactBusinessCards)
        .where(eq(showroomStoreContactBusinessCards.status, "failed"));
      return JSON.stringify(rows);
    }
    case "resolve_business_card": {
      const cardId = Number(args.cardId);
      const res = await fieldOutContacts(db, args as any, env);
      await db
        .update(showroomStoreContactBusinessCards)
        .set({
          status: "done",
          storeId: res.storeId,
          contactId: res.contactIds[0] ?? null,
          isDraft: res.isDraft,
          updatedAt: new Date(),
        })
        .where(eq(showroomStoreContactBusinessCards.id, cardId));
      return JSON.stringify({ cardId, ...res });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC over HTTP (the MCP streamable-HTTP transport).
mcpRouter.post("/", async (c) => {
  const auth = await authenticateMcpRequest(c.req.raw, c.env);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = (await c.req.json().catch(() => null)) as any;

  // The legacy transport has no MCP session concept, so synthesize one id per
  // HTTP request (a JSON-RPC batch shares it) tagged "legacy" for grouping in
  // the ops transcript. See 0017 §3A / open-question #5.
  const legacySessionId = `legacy:${crypto.randomUUID()}`;
  const legacyPrincipal = principalLabel({
    kind: auth.kind,
    userId: auth.kind === "research" ? "research-token" : "worker",
  });

  const handle = async (msg: any) => {
    const id = msg?.id ?? null;
    const method = msg?.method;
    const params = msg?.params;
    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };
      }
      if (method === "tools/list") {
        const tools = TOOLS.filter((tool) => auth.kind === "worker" || isResearchTool(tool.name));
        return { jsonrpc: "2.0", id, result: { tools } };
      }
      if (method === "tools/call") {
        const toolName = String(params?.name ?? "unknown");
        const toolArgs = params?.arguments ?? {};
        const startedAt = Date.now();
        try {
          const text = await callTool(c.env, auth, params?.name, toolArgs);
          c.executionCtx.waitUntil(
            logInvocation(c.env, {
              sessionId: legacySessionId,
              transport: "legacy",
              principal: legacyPrincipal,
              toolName,
              args: toolArgs,
              ok: true,
              result: text,
              durationMs: Date.now() - startedAt,
            }),
          );
          // When a tool's text result is itself a JSON object, also hand it
          // back as `structuredContent` so JSON-RPC clients get a parsed shape
          // without re-parsing the text block (mirrors the registry transport).
          // Prose results stay text-only.
          const structuredContent = parseJsonObject(text);
          const result = structuredContent
            ? { content: [{ type: "text", text }], structuredContent }
            : { content: [{ type: "text", text }] };
          return { jsonrpc: "2.0", id, result };
        } catch (err) {
          c.executionCtx.waitUntil(
            logInvocation(c.env, {
              sessionId: legacySessionId,
              transport: "legacy",
              principal: legacyPrincipal,
              toolName,
              args: toolArgs,
              ok: false,
              error: String((err as Error)?.message ?? err),
              durationMs: Date.now() - startedAt,
            }),
          );
          throw err;
        }
      }
      if (method === "ping") {
        return { jsonrpc: "2.0", id, result: {} };
      }
      if (typeof method === "string" && method.startsWith("notifications/")) {
        return null; // notifications get no response
      }
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: String((err as Error)?.message ?? err) },
      };
    }
  };

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter((r) => r !== null);
    return c.json(out);
  }
  const res = await handle(body);
  if (res === null) return c.body(null, 202);
  return c.json(res);
});

// Discovery / health (handy for sanity-checking the server)
mcpRouter.get("/", async (c) => {
  const auth = await authenticateMcpRequest(c.req.raw, c.env);
  if (!auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocol: "mcp",
    transport: "http",
    tools: TOOLS
      .filter((tool) => auth.kind === "worker" || isResearchTool(tool.name))
      .map((t) => t.name),
  });
});

export default mcpRouter;
