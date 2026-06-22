/**
 * @fileoverview ResearchAgent types and schemas.
 *
 * Defines the agent state shape, orchestration status enum,
 * and input/output types for @callable methods.
 */

// ---------------------------------------------------------------------------
// Agent State
// ---------------------------------------------------------------------------

export interface ResearchAgentState {
  /** Active session ID (null when idle) */
  currentSessionId: number | null;
  /** Topic being researched */
  currentTopic: string | null;
  /** Orchestration lifecycle status */
  status:
    | "idle"
    | "researching"
    | "embedding"
    | "generating"
    | "complete"
    | "failed";
  /** Human-readable progress message broadcast to clients */
  progress: string;
  /** Number of chunks embedded for the current session */
  chunkCount: number;
  /** Deep Research interaction ID */
  interactionId?: string;
  /** Deep Research stream last event ID */
  lastEventId?: string;
  /** Whether this run attached a scoped remote MCP bridge */
  mcpBridgeEnabled?: boolean;
}

export const DEFAULT_RESEARCH_STATE: ResearchAgentState = {
  currentSessionId: null,
  currentTopic: null,
  status: "idle",
  progress: "Ready",
  chunkCount: 0,
};

// ---------------------------------------------------------------------------
// Research pipeline types
// ---------------------------------------------------------------------------

/** A single text chunk with its embedding vector */
export interface EmbeddedChunk {
  id: string;
  text: string;
  vector: number[];
  metadata: {
    sessionId: number;
    chunkIndex: number;
    sectionTitle?: string;
  };
}

/** Result returned by the chunking pipeline */
export interface ChunkResult {
  chunks: string[];
  totalTokensEstimate: number;
}

/** Vectorize upsert result */
export interface EmbedResult {
  chunkCount: number;
  namespace: string;
}

/** Visualizer generation result */
export interface VisualizerResult {
  r2Key: string;
  sizeBytes: number;
}

export interface StartResearchOptions {
  prompt?: string | null;
  researchPlan?: string | null;
  enableMcpBridge?: boolean;
  mcpServerUrl?: string | null;
  mode?: "standard" | "max";
  visualization?: "auto" | "off";
}

export interface StartResearchInput extends StartResearchOptions {
  topic: string;
  sessionId: number;
}

// ---------------------------------------------------------------------------
// R2 key conventions
// ---------------------------------------------------------------------------

export function r2MarkdownKey(sessionId: number): string {
  return `research/${sessionId}/report.md`;
}

export function r2WebappKey(sessionId: number): string {
  return `research/${sessionId}/visualizer.html`;
}

export function vectorNamespace(sessionId: number): string {
  return `research:${sessionId}`;
}
