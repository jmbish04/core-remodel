import type { AgentCard, JSONRPCResponse, Message, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  JsonRpcTransportHandler,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
  type TaskStore,
} from "@a2a-js/sdk/server";
import { Agent } from "agents";

import { A2A_V2_URL } from "./constants";
import { wrapExistingFunctionToGrid } from "./v2-helpers";

const A2A_SYSTEM_PROMPT = [
  "You are A2A Compliance Agent V2 running on Cloudflare Workers.",
  "Operating constraints:",
  "- You serve a Google Sheets A2UI sidebar.",
  "- You must return plain conversational text for normal chat.",
  "- When the user asks for reports, analytics, tabular exports, or data dumps, return a CSV matrix wrapped in <sheet-grid>...</sheet-grid>.",
  "- Do not invent schema fields. Use explicit, stable column names.",
].join("\n");

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const A2A_V2_CARD: AgentCard = {
  name: "A2A Compliance Agent V2",
  description:
    "Isolated A2A research endpoint for Google Sheets sidebar orchestration with optional <sheet-grid> output.",
  url: A2A_V2_URL,
  version: "2.0.0",
  protocolVersion: "0.3.0",
  preferredTransport: "JSONRPC",
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "text/csv", "application/json"],
  skills: [
    {
      id: "sheet-sync",
      name: "Sheet Grid Sync",
      description: "Returns tabular data wrapped in <sheet-grid> tags for Apps Script grid writes.",
      tags: ["google-sheets", "a2a", "grid", "csv", "reporting"],
      examples: [
        "Show permit dashboard as a table",
        "Return contractor insights as grid data",
      ],
    },
    {
      id: "chat",
      name: "General Chat",
      description: "Answers non-tabular prompts with concise conversational text.",
      tags: ["chat", "guidance", "assistant"],
    },
  ],
};

const DATA_REQUEST_PATTERNS: Array<{ pattern: RegExp; functionName: string }> = [
  {
    pattern: /(permit\s+dashboard|existing\s+d1\s+data|permit\s+records)/i,
    functionName: "getExistingD1Data",
  },
  {
    pattern: /(metrics\s+report|contact\s+insight|contractor\s+insight)/i,
    functionName: "fetchMetricsReport",
  },
  {
    pattern: /(home\s+catalog|room\s+catalog|floor\s+rooms)/i,
    functionName: "getHomeCatalog",
  },
  {
    pattern: /(google\s+sheets\s+workbook|sheet\s+template|workbook\s+dump)/i,
    functionName: "buildGoogleSheetsWorkbook",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => {
      const obj = asRecord(part);
      if (!obj) {
        return "";
      }
      return typeof obj.text === "string" ? obj.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractTextFromMessage(message: Message): string {
  return extractTextFromParts(message.parts);
}

function resolveWrapperFunctionName(input: string): string | null {
  for (const entry of DATA_REQUEST_PATTERNS) {
    if (entry.pattern.test(input)) {
      return entry.functionName;
    }
  }
  return null;
}

function coerceAssistantText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  const asObj = asRecord(result);
  if (!asObj) {
    return "";
  }

  const direct = [asObj.response, asObj.text, asObj.output_text].find((value) => typeof value === "string");
  if (typeof direct === "string") {
    return direct;
  }

  if (Array.isArray(asObj.choices) && asObj.choices.length > 0) {
    const firstChoice = asRecord(asObj.choices[0]);
    const message = asRecord(firstChoice?.message);
    if (typeof message?.content === "string") {
      return message.content;
    }
    if (typeof firstChoice?.text === "string") {
      return firstChoice.text;
    }
  }

  if (Array.isArray(asObj.output)) {
    const textParts: string[] = [];
    for (const item of asObj.output) {
      const outputItem = asRecord(item);
      if (!outputItem) continue;
      if (typeof outputItem.text === "string") {
        textParts.push(outputItem.text);
      }
      if (Array.isArray(outputItem.content)) {
        for (const part of outputItem.content) {
          const contentPart = asRecord(part);
          if (typeof contentPart?.text === "string") {
            textParts.push(contentPart.text);
          }
        }
      }
    }
    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }

  return "";
}

function buildStatusUpdate(
  taskId: string,
  contextId: string,
  state: TaskStatusUpdateEvent["status"]["state"],
  final: boolean,
  messageText?: string,
): TaskStatusUpdateEvent {
  const message =
    messageText && messageText.trim().length > 0
      ? {
          kind: "message" as const,
          role: "agent" as const,
          messageId: crypto.randomUUID(),
          taskId,
          contextId,
          parts: [{ kind: "text" as const, text: messageText }],
        }
      : undefined;

  return {
    kind: "status-update",
    taskId,
    contextId,
    status: {
      state,
      timestamp: nowIso(),
      message,
    },
    final,
  };
}

function withCors(headers: HeadersInit = {}): Headers {
  const merged = new Headers(headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    merged.set(key, value);
  }
  return merged;
}

class DurableObjectTaskStore implements TaskStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  private key(taskId: string): string {
    return `a2a:v2:task:${taskId}`;
  }

  async save(task: Parameters<TaskStore["save"]>[0]): Promise<void> {
    await this.storage.put(this.key(task.id), task);
  }

  async load(taskId: string): Promise<Awaited<ReturnType<TaskStore["load"]>>> {
    const stored = await this.storage.get(this.key(taskId));
    return (stored as Awaited<ReturnType<TaskStore["load"]>>) || undefined;
  }
}

class AIAgentExecutor implements AgentExecutor {
  private readonly cancelledTasks = new Set<string>();

  constructor(private readonly env: Env) {}

  cancelTask = async (taskId: string): Promise<void> => {
    this.cancelledTasks.add(taskId);
  };

  execute = async (requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> => {
    const { taskId, contextId, userMessage } = requestContext;

    eventBus.publish(buildStatusUpdate(taskId, contextId, "submitted", false, "Task submitted."));

    if (this.cancelledTasks.has(taskId)) {
      eventBus.publish(buildStatusUpdate(taskId, contextId, "canceled", true, "Task canceled."));
      eventBus.finished();
      this.cancelledTasks.delete(taskId);
      return;
    }

    eventBus.publish(buildStatusUpdate(taskId, contextId, "working", false, "Task is running."));

    try {
      const userText = extractTextFromMessage(userMessage);
      const wrappedFunction = resolveWrapperFunctionName(userText);

      let finalText: string;
      if (wrappedFunction) {
        finalText = await wrapExistingFunctionToGrid(wrappedFunction, [], this.env);
      } else {
        finalText = await this.runModel(userText);
      }

      if (this.cancelledTasks.has(taskId)) {
        eventBus.publish(buildStatusUpdate(taskId, contextId, "canceled", true, "Task canceled."));
      } else {
        eventBus.publish(buildStatusUpdate(taskId, contextId, "completed", true, finalText));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventBus.publish(buildStatusUpdate(taskId, contextId, "failed", true, `A2A V2 execution failed: ${message}`));
    } finally {
      eventBus.finished();
      this.cancelledTasks.delete(taskId);
    }
  };

  private async runModel(userText: string): Promise<string> {
    const model = "@cf/openai/gpt-oss-120b";
    const response = await this.env.AI.run(model, {
      messages: [
        { role: "system", content: A2A_SYSTEM_PROMPT },
        { role: "user", content: userText || "Provide a short status update." },
      ],
      stream: false,
    });

    const text = coerceAssistantText(response).trim();
    if (text) {
      return text;
    }

    return "No response text was produced by the model.";
  }
}

function normalizeExecuteTaskRequest(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.method !== "execute_task") {
    return payload;
  }

  const params = asRecord(payload.params) || {};
  const userMessage = asRecord(params.userMessage) || {};

  const messageId =
    typeof userMessage.messageId === "string" && userMessage.messageId.trim().length > 0
      ? userMessage.messageId
      : `msg-${crypto.randomUUID()}`;

  const contextId =
    typeof params.contextId === "string" && params.contextId.trim().length > 0
      ? params.contextId
      : typeof userMessage.contextId === "string" && userMessage.contextId.trim().length > 0
        ? userMessage.contextId
        : `ctx-${crypto.randomUUID()}`;

  const userText = extractTextFromParts(userMessage.parts);

  return {
    jsonrpc: "2.0",
    id: payload.id ?? crypto.randomUUID(),
    method: "message/stream",
    params: {
      message: {
        kind: "message",
        messageId,
        role: "user",
        contextId,
        parts: [{ kind: "text", text: userText }],
      },
    },
  };
}

function isAsyncJsonRpcGenerator(value: unknown): value is AsyncGenerator<JSONRPCResponse, void, undefined> {
  return Boolean(value) && typeof (value as AsyncGenerator<JSONRPCResponse>)[Symbol.asyncIterator] === "function";
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ "Content-Type": "application/json" }),
  });
}

export class GAS_A2A extends Agent<Env> {
  private requestHandler: DefaultRequestHandler | null = null;
  private transportHandler: JsonRpcTransportHandler | null = null;

  private getRequestHandler(): DefaultRequestHandler {
    if (!this.requestHandler) {
      const taskStore = new DurableObjectTaskStore(this.ctx.storage);
      const executor = new AIAgentExecutor(this.env);
      this.requestHandler = new DefaultRequestHandler(A2A_V2_CARD, taskStore, executor);
    }
    return this.requestHandler;
  }

  private getTransportHandler(): JsonRpcTransportHandler {
    if (!this.transportHandler) {
      this.transportHandler = new JsonRpcTransportHandler(this.getRequestHandler());
    }
    return this.transportHandler;
  }

  private async streamJsonRpcResponse(
    payload: JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>,
  ): Promise<Response> {
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (isAsyncJsonRpcGenerator(payload)) {
            for await (const event of payload) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message } })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: withCors({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      }),
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCors(),
      });
    }

    if (request.method === "GET" && url.pathname.endsWith("/.well-known/agent-card.json")) {
      return jsonResponse(A2A_V2_CARD);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Invalid JSON payload.",
          },
        },
        400,
      );
    }

    const parsedPayload = asRecord(payload);
    if (!parsedPayload) {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32600,
            message: "Invalid JSON-RPC request object.",
          },
        },
        400,
      );
    }

    const normalizedPayload = normalizeExecuteTaskRequest(parsedPayload);
    const responsePayload = await this.getTransportHandler().handle(normalizedPayload);

    const requestMethod = String(normalizedPayload.method || "");
    const isStreamRequest = requestMethod === "message/stream" || requestMethod === "tasks/resubscribe";

    if (isStreamRequest) {
      return this.streamJsonRpcResponse(responsePayload);
    }

    return jsonResponse(responsePayload);
  }
}
