type RoomSummaryInput = {
  room: {
    displayName: string;
    roomCode: string;
    floorName: string;
    asIsUse?: string | null;
    dimensionLabel?: string | null;
    problemAreas?: string | null;
    generalNotes?: string | null;
    plumbingNotes?: string | null;
    electricalNotes?: string | null;
    structuralNotes?: string | null;
    hvacNotes?: string | null;
  };
  listingImages: Array<{
    displayName?: string | null;
    roomType?: string | null;
    metadata?: string | null;
  }>;
  inspirationalImages: Array<{
    displayName?: string | null;
    roomType?: string | null;
    metadata?: string | null;
  }>;
  supportingDocuments: Array<{
    title: string;
    sourceType: string;
    description?: string | null;
  }>;
  actionItems: Array<{
    title: string;
    details?: string | null;
    status: string;
    priority: number;
  }>;
  scenarioPlans: Array<{
    scenarioName: string;
    proposedUse: string;
    stage: string;
    estimatedCostCents?: number | null;
    notes?: string | null;
  }>;
  budgetItems: Array<{
    title: string;
    status: string;
    estimatedLowCents?: number | null;
    estimatedHighCents?: number | null;
    executionClass: string;
  }>;
  estimates: Array<{
    companyName?: string | null;
    totalAmountCents?: number | null;
    statusName?: string | null;
    sourceSummary?: string | null;
  }>;
  visionNodes: Array<{
    title: string;
    summary?: string | null;
    status: string;
    nodeType: string;
    estimatedCostCents?: number | null;
  }>;
  userPrompt?: string | null;
  voiceTranscript?: string | null;
};

export type RoomSummaryStructured = {
  overview: string;
  renovationStory: string;
  budgetSnapshot: string;
  taskFocus: string[];
  decisionPoints: string[];
  supportingSignals: string[];
};

export type GeneratedRoomSummary = {
  model: string;
  summaryMarkdown: string;
  summaryObject: RoomSummaryStructured;
};

const ROOM_SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct";

function formatCurrency(valueCents: number | null | undefined): string {
  if (typeof valueCents !== "number" || !Number.isFinite(valueCents)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(valueCents / 100);
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function compactStrings(values: Array<string | null | undefined>, limit = values.length): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
    if (next.length >= limit) break;
  }
  return next;
}

function extractImageHints(
  images: Array<{ displayName?: string | null; roomType?: string | null; metadata?: string | null }>,
  limit: number,
): string[] {
  const hints: string[] = [];
  for (const image of images) {
    const metadata = parseJsonObject(image.metadata);
    const tags = Array.isArray(metadata?.tags)
      ? metadata?.tags
          .map((tag) => String(tag).trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const note = typeof metadata?.note === "string" ? metadata.note.trim() : "";
    const labelParts = compactStrings(
      [
        image.displayName || null,
        image.roomType || null,
        tags.length > 0 ? `tags: ${tags.join(", ")}` : null,
        note ? `note: ${note}` : null,
      ],
      4,
    );
    if (labelParts.length > 0) {
      hints.push(labelParts.join(" | "));
    }
    if (hints.length >= limit) break;
  }
  return hints;
}

function fallbackSummary(input: RoomSummaryInput): RoomSummaryStructured {
  const overviewBits = compactStrings([
    `${input.room.displayName} is being tracked as a ${input.room.asIsUse || "room"} on the ${input.room.floorName}.`,
    input.room.generalNotes || null,
    input.room.problemAreas ? `Known issues: ${input.room.problemAreas}` : null,
  ]);

  return {
    overview: overviewBits.join(" "),
    renovationStory:
      input.scenarioPlans.length > 0
        ? `Current room options are driven by ${input.scenarioPlans.length} scenario plan(s) and ${input.visionNodes.length} vision node(s).`
        : `Current room context is being assembled from listing photos, inspiration, and supporting records.`,
    budgetSnapshot:
      input.budgetItems.length > 0
        ? `Budget tracker currently has ${input.budgetItems.length} linked item(s) for this room.`
        : "No room-specific budget range is stored yet.",
    taskFocus: input.actionItems.slice(0, 3).map((item) => item.title),
    decisionPoints: input.visionNodes.slice(0, 3).map((node) => node.title),
    supportingSignals: input.supportingDocuments.slice(0, 3).map((doc) => doc.title),
  };
}

function extractStructuredSummary(raw: string, input: RoomSummaryInput): RoomSummaryStructured {
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallbackSummary(input);
  }

  const candidates = [trimmed];
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch?.[0] && jsonMatch[0] !== trimmed) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      return {
        overview:
          typeof parsed.overview === "string" && parsed.overview.trim()
            ? parsed.overview.trim()
            : fallbackSummary(input).overview,
        renovationStory:
          typeof parsed.renovationStory === "string" && parsed.renovationStory.trim()
            ? parsed.renovationStory.trim()
            : fallbackSummary(input).renovationStory,
        budgetSnapshot:
          typeof parsed.budgetSnapshot === "string" && parsed.budgetSnapshot.trim()
            ? parsed.budgetSnapshot.trim()
            : fallbackSummary(input).budgetSnapshot,
        taskFocus: Array.isArray(parsed.taskFocus)
          ? parsed.taskFocus.map((value) => String(value).trim()).filter(Boolean).slice(0, 6)
          : fallbackSummary(input).taskFocus,
        decisionPoints: Array.isArray(parsed.decisionPoints)
          ? parsed.decisionPoints.map((value) => String(value).trim()).filter(Boolean).slice(0, 6)
          : fallbackSummary(input).decisionPoints,
        supportingSignals: Array.isArray(parsed.supportingSignals)
          ? parsed.supportingSignals
              .map((value) => String(value).trim())
              .filter(Boolean)
              .slice(0, 6)
          : fallbackSummary(input).supportingSignals,
      };
    } catch {
      // fall through to raw-text fallback
    }
  }

  return {
    ...fallbackSummary(input),
    overview: trimmed,
  };
}

function formatSummaryMarkdown(summary: RoomSummaryStructured): string {
  const sections = [
    `Overview\n${summary.overview}`,
    `Renovation Story\n${summary.renovationStory}`,
    `Budget Snapshot\n${summary.budgetSnapshot}`,
    summary.taskFocus.length > 0 ? `Task Focus\n- ${summary.taskFocus.join("\n- ")}` : "",
    summary.decisionPoints.length > 0
      ? `Decision Points\n- ${summary.decisionPoints.join("\n- ")}`
      : "",
    summary.supportingSignals.length > 0
      ? `Supporting Signals\n- ${summary.supportingSignals.join("\n- ")}`
      : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}

function buildRoomContext(input: RoomSummaryInput): string {
  const room = input.room;
  const roomNotes = compactStrings([
    room.problemAreas ? `Problem areas: ${room.problemAreas}` : null,
    room.generalNotes ? `General notes: ${room.generalNotes}` : null,
    room.plumbingNotes ? `Plumbing notes: ${room.plumbingNotes}` : null,
    room.electricalNotes ? `Electrical notes: ${room.electricalNotes}` : null,
    room.structuralNotes ? `Structural notes: ${room.structuralNotes}` : null,
    room.hvacNotes ? `HVAC notes: ${room.hvacNotes}` : null,
  ]);

  const scenarioLines = input.scenarioPlans.slice(0, 8).map((plan) =>
    `${plan.scenarioName}: ${plan.proposedUse} (${plan.stage})${
      typeof plan.estimatedCostCents === "number"
        ? `, cost ${formatCurrency(plan.estimatedCostCents)}`
        : ""
    }${plan.notes ? `, notes ${plan.notes}` : ""}`,
  );
  const budgetLines = input.budgetItems.slice(0, 8).map((item) =>
    `${item.title} [${item.status}, ${item.executionClass}] ${
      item.estimatedLowCents || item.estimatedHighCents
        ? `${formatCurrency(item.estimatedLowCents)}-${formatCurrency(item.estimatedHighCents)}`
        : "no range"
    }`,
  );
  const estimateLines = input.estimates.slice(0, 6).map((estimate) =>
    compactStrings([
      estimate.companyName || "Unknown company",
      estimate.statusName || null,
      typeof estimate.totalAmountCents === "number"
        ? formatCurrency(estimate.totalAmountCents)
        : null,
      estimate.sourceSummary || null,
    ]).join(" | "),
  );
  const nodeLines = input.visionNodes.slice(0, 8).map((node) =>
    `${node.title} [${node.nodeType}, ${node.status}]${
      typeof node.estimatedCostCents === "number"
        ? ` ${formatCurrency(node.estimatedCostCents)}`
        : ""
    }${node.summary ? ` - ${node.summary}` : ""}`,
  );
  const documentLines = input.supportingDocuments.slice(0, 8).map((doc) =>
    compactStrings([doc.title, doc.sourceType, doc.description || null]).join(" | "),
  );
  const actionLines = input.actionItems.slice(0, 8).map((item) =>
    compactStrings([
      `${item.title} [${item.status}, priority ${item.priority}]`,
      item.details || null,
    ]).join(" | "),
  );

  const listingHints = extractImageHints(input.listingImages, 8);
  const inspirationHints = extractImageHints(input.inspirationalImages, 8);

  return [
    `Room: ${room.displayName}`,
    `Slug: ${room.roomCode}`,
    `Floor: ${room.floorName}`,
    `Current use: ${room.asIsUse || "unknown"}`,
    room.dimensionLabel ? `Dimensions: ${room.dimensionLabel}` : "",
    roomNotes.length > 0 ? `Room notes:\n- ${roomNotes.join("\n- ")}` : "",
    listingHints.length > 0 ? `Listing photo cues:\n- ${listingHints.join("\n- ")}` : "",
    inspirationHints.length > 0 ? `Inspiration photo cues:\n- ${inspirationHints.join("\n- ")}` : "",
    actionLines.length > 0 ? `Action items:\n- ${actionLines.join("\n- ")}` : "",
    scenarioLines.length > 0 ? `Scenario plans:\n- ${scenarioLines.join("\n- ")}` : "",
    budgetLines.length > 0 ? `Budget tracker items:\n- ${budgetLines.join("\n- ")}` : "",
    estimateLines.length > 0 ? `Estimate signals:\n- ${estimateLines.join("\n- ")}` : "",
    nodeLines.length > 0 ? `Vision nodes:\n- ${nodeLines.join("\n- ")}` : "",
    documentLines.length > 0 ? `Supporting documents:\n- ${documentLines.join("\n- ")}` : "",
    input.userPrompt?.trim() ? `Homeowner correction prompt: ${input.userPrompt.trim()}` : "",
    input.voiceTranscript?.trim()
      ? `Voice correction transcript: ${input.voiceTranscript.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateRoomSummary(
  env: Env,
  input: RoomSummaryInput,
): Promise<GeneratedRoomSummary> {
  const response = (await env.AI.run(ROOM_SUMMARY_MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You summarize renovation-room context for a homeowner and contractor. Return strict JSON with keys overview, renovationStory, budgetSnapshot, taskFocus, decisionPoints, supportingSignals. Keep overview and renovationStory to 2-4 sentences each, budgetSnapshot to 1-3 sentences, and each array to at most 6 concise bullets. Focus on what would happen in this room, active options, money signals, and what needs to be decided next.",
      },
      {
        role: "user",
        content: buildRoomContext(input),
      },
    ],
    max_tokens: 1400,
    gateway: { id: env.AI_GATEWAY_ID },
  } as Parameters<typeof env.AI.run>[1])) as { response?: string };

  const structured = extractStructuredSummary(response.response || "", input);
  return {
    model: ROOM_SUMMARY_MODEL,
    summaryObject: structured,
    summaryMarkdown: formatSummaryMarkdown(structured),
  };
}
