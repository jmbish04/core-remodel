/**
 * @fileoverview ClickUp API v2 Client
 *
 * Thin, typed wrapper around the ClickUp REST API. Handles:
 * - Authentication via Personal API Token (from Secrets Store)
 * - Automatic retry on 429 with Retry-After header
 * - Response typing matching ClickUp v2 schemas
 * - Rate-limit-aware request pacing
 *
 * Attachment strategy: files are stored in R2, only links
 * are appended to ClickUp task descriptions (60 MB Free Tier cap).
 */

const BASE_URL = "https://api.clickup.com/api/v2";
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClickUpSpace {
  id: string;
  name: string;
  private: boolean;
  statuses: ClickUpStatus[];
}

export interface ClickUpList {
  id: string;
  name: string;
  content: string;
  status: { status: string; type: string; orderindex: number }[];
  folder: { id: string; name: string } | null;
  space: { id: string; name: string };
}

export interface ClickUpStatus {
  status: string;
  type: string;
  orderindex: number;
  color: string;
}

export interface ClickUpTag {
  name: string;
  tag_fg: string;
  tag_bg: string;
}

export interface ClickUpTask {
  id: string;
  custom_id: string | null;
  name: string;
  text_content: string | null;
  description: string | null;
  status: ClickUpStatus;
  orderindex: string;
  date_created: string;
  date_updated: string;
  date_closed: string | null;
  date_done: string | null;
  creator: { id: number; username: string; color: string; email: string };
  assignees: { id: number; username: string; color: string; email: string }[];
  tags: ClickUpTag[];
  parent: string | null;
  priority: { id: string; priority: string; color: string; orderindex: string } | null;
  due_date: string | null;
  start_date: string | null;
  time_estimate: number | null;
  time_spent: number | null;
  list: { id: string; name: string };
  folder: { id: string; name: string };
  space: { id: string };
  url: string;
  dependencies?: { task_id: string; depends_on: string; type: number }[];
}

export interface GetTasksOpts {
  page?: number;
  statuses?: string[];
  include_closed?: boolean;
  order_by?: "id" | "created" | "updated" | "due_date";
  subtasks?: boolean;
}

export interface CreateTaskPayload {
  name: string;
  description?: string;
  status?: string;
  priority?: number; // 1=urgent, 2=high, 3=normal, 4=low
  due_date?: number; // Unix ms
  start_date?: number; // Unix ms
  time_estimate?: number; // ms
  assignees?: number[];
  tags?: string[];
  notify_all?: boolean;
  parent?: string | null;
  links_to?: string | null;
}

export type UpdateTaskPayload = Partial<
  Omit<CreateTaskPayload, "notify_all"> & {
    archived?: boolean;
  }
>;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ClickUpClient {
  private token: string;
  private teamId: string;

  constructor(token: string, teamId: string) {
    this.token = token;
    this.teamId = teamId;
  }

  // ── Spaces & Lists ──────────────────────────────────────────────

  async getSpaces(): Promise<ClickUpSpace[]> {
    const data = await this.request<{ spaces: ClickUpSpace[] }>(
      `${BASE_URL}/team/${this.teamId}/space?archived=false`,
    );
    return data.spaces;
  }

  async getLists(folderId: string): Promise<ClickUpList[]> {
    const data = await this.request<{ lists: ClickUpList[] }>(
      `${BASE_URL}/folder/${folderId}/list?archived=false`,
    );
    return data.lists;
  }

  async getFolderlessLists(spaceId: string): Promise<ClickUpList[]> {
    const data = await this.request<{ lists: ClickUpList[] }>(
      `${BASE_URL}/space/${spaceId}/list?archived=false`,
    );
    return data.lists;
  }

  // ── Tasks (core CRUD) ──────────────────────────────────────────

  async getTasks(listId: string, opts?: GetTasksOpts): Promise<ClickUpTask[]> {
    const params = new URLSearchParams();
    if (opts?.page !== undefined) params.set("page", String(opts.page));
    if (opts?.include_closed) params.set("include_closed", "true");
    if (opts?.order_by) params.set("order_by", opts.order_by);
    if (opts?.subtasks) params.set("subtasks", "true");
    if (opts?.statuses) {
      for (const status of opts.statuses) {
        params.append("statuses[]", status);
      }
    }

    const url = `${BASE_URL}/list/${listId}/task?${params.toString()}`;
    const data = await this.request<{ tasks: ClickUpTask[] }>(url);
    return data.tasks;
  }

  async getAllTasks(listId: string, opts?: Omit<GetTasksOpts, "page">): Promise<ClickUpTask[]> {
    const allTasks: ClickUpTask[] = [];
    let page = 0;

    while (true) {
      const tasks = await this.getTasks(listId, { ...opts, page });
      allTasks.push(...tasks);
      // ClickUp returns max 100 per page; if less, we've reached the end
      if (tasks.length < 100) break;
      page++;
    }

    return allTasks;
  }

  async getTask(taskId: string): Promise<ClickUpTask> {
    return this.request<ClickUpTask>(
      `${BASE_URL}/task/${taskId}?include_subtasks=true`,
    );
  }

  async createTask(
    listId: string,
    payload: CreateTaskPayload,
  ): Promise<ClickUpTask> {
    return this.request<ClickUpTask>(
      `${BASE_URL}/list/${listId}/task`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  }

  async updateTask(
    taskId: string,
    payload: UpdateTaskPayload,
  ): Promise<ClickUpTask> {
    return this.request<ClickUpTask>(
      `${BASE_URL}/task/${taskId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request(`${BASE_URL}/task/${taskId}`, { method: "DELETE" });
  }

  // ── Attachments (link-only strategy) ───────────────────────────
  // Instead of uploading binary files (60 MB cap), we append a
  // markdown link into the task description.

  async appendLinkToDescription(
    taskId: string,
    label: string,
    url: string,
  ): Promise<ClickUpTask> {
    const task = await this.getTask(taskId);
    const existingDesc = task.description || "";
    const linkLine = `\n\n📎 [${label}](${url})`;
    const newDesc = existingDesc + linkLine;
    return this.updateTask(taskId, { description: newDesc });
  }

  // ── Internal: HTTP with auth + retry ───────────────────────────

  private async request<T>(
    url: string,
    init?: RequestInit,
    attempt = 0,
  ): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    // Rate limited — wait and retry
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("Retry-After") || "5");
      const waitMs = retryAfter * 1000;
      console.warn(
        `ClickUp 429 rate limit — retrying in ${retryAfter}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.request<T>(url, init, attempt + 1);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new ClickUpApiError(
        `ClickUp API ${response.status}: ${response.statusText}`,
        response.status,
        errorBody,
      );
    }

    // DELETE returns empty body
    if (response.status === 204 || init?.method === "DELETE") {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ClickUpApiError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ClickUpApiError";
    this.status = status;
    this.body = body;
  }
}
