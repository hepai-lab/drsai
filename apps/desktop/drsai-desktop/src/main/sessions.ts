/**
 * Session listing via DrSai API Gateway.
 *
 * Instead of reading SQLite directly (which doesn't match DrSai's Thread
 * schema), we call the API server's /v1/threads endpoints.
 */

import { join } from "path";
import http from "http";
import { DRSAI_HOME } from "./installer";
import { getUserName } from "./config";

// ── API helpers ─────────────────────────────────────

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "18642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

function apiGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${DRSAI_API_URL}${path}`;
    http
      .request(url, { method: "GET", timeout: 10000 }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Invalid JSON from API: ${body.slice(0, 200)}`));
          }
        });
      })
      .on("error", reject)
      .on("timeout", function (this: http.ClientRequest) {
        this.destroy();
        reject(new Error("API request timed out"));
      })
      .end();
  });
}

function buildPath(base: string, params: Record<string, string | number | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join("&");
  return qs ? `${base}?${qs}` : base;
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

// ── Types ───────────────────────────────────────────

export interface SessionSummary {
  id: string;
  source: string;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
  model: string;
  title: string | null;
  preview: string;
}

export interface SessionMessage {
  id: number;
  /** Normalized role from backend: "user" | "assistant" | "tool" | "tool_request" | "thinking" */
  role: string;
  content: string;
  timestamp: number;
  /** Original autogen message type (e.g. "TextMessage", "ToolCallExecutionEvent"). */
  msgType?: string;
  /** Tool name for tool events. */
  toolName?: string;
}

export interface SearchResult {
  sessionId: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
}

// ── List ────────────────────────────────────────────

export function listSessions(limit = 30, offset = 0): SessionSummary[] {
  // Synchronous fallback — the IPC handler calls this synchronously
  // so we return empty and let the async path populate
  return [];
}

export async function listSessionsAsync(
  limit = 30,
  offset = 0,
): Promise<SessionSummary[]> {
  try {
    const user = getUserName();
    const path = buildPath("/v1/threads", { user_id: user, limit, offset });
    const resp = (await apiGet<{ data: Array<Record<string, unknown>> }>(path)) as {
      data: Array<Record<string, unknown>>;
    };
    if (!resp.data) return [];
    return resp.data
      .map(
      (r: Record<string, unknown>) =>
        ({
          id: r.thread_id as string,
          source: "desktop",
          startedAt:
            typeof r.updated_at === "number"
              ? r.updated_at
              : Date.now(),
          endedAt: null,
          messageCount: (r.message_count as number) || 0,
          model: "",
          title: (r.name as string) || null,
          preview: (r.preview as string) || "",
        }) as SessionSummary,
    );
  } catch (err) {
    console.error("[sessions] listSessionsAsync failed:", err);
    return [];
  }
}

// ── Messages ────────────────────────────────────────

export function getSessionMessages(sessionId: string): SessionMessage[] {
  return []; // Sync fallback
}

export async function getSessionMessagesAsync(
  sessionId: string,
): Promise<SessionMessage[]> {
  try {
    const user = getUserName();
    const path = buildPath(`/v1/threads/${encodeURIComponent(sessionId)}`, {
      user_id: user,
    });
    const resp = (await apiGet<{ messages: Array<Record<string, unknown>> }>(path)) as {
      messages: Array<Record<string, unknown>>;
    };
    if (!resp.messages) return [];
    return resp.messages.map(
      (m: Record<string, unknown>, idx: number) =>
        ({
          id: idx,
          role: (m.role as string) || "assistant",
          content: normalizeMessageContent(m.content),
          timestamp:
            typeof m.timestamp === "number" ? m.timestamp : Date.now(),
          msgType: (m.type as string) || undefined,
          toolName: (m.toolName as string) || undefined,
        }) as SessionMessage,
    );
  } catch (err) {
    console.error("[sessions] getSessionMessagesAsync failed:", err);
    return [];
  }
}

// ── Search ──────────────────────────────────────────

export function searchSessions(
  query: string,
  limit = 20,
): SearchResult[] {
  return []; // Sync fallback
}

export async function searchSessionsAsync(
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  try {
    const user = getUserName();
    const path = buildPath("/v1/threads/search", {
      query,
      user_id: user,
      limit,
    });
    const resp = (await apiGet<{ data: Array<Record<string, unknown>> }>(path)) as {
      data: Array<Record<string, unknown>>;
    };
    if (!resp.data) return [];
    return resp.data.map(
      (r: Record<string, unknown>) =>
        ({
          sessionId: r.thread_id as string,
          title: (r.name as string) || null,
          startedAt:
            typeof r.updated_at === "number"
              ? r.updated_at
              : Date.now(),
          source: "desktop",
          messageCount: (r.message_count as number) || 0,
          model: "",
          snippet: (r.preview as string) || "",
        }) as SearchResult,
    );
  } catch (err) {
    console.error("[sessions] searchSessionsAsync failed:", err);
    return [];
  }
}
