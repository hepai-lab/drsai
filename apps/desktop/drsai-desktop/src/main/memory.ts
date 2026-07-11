/**
 * Memory management via DrSai API Gateway.
 *
 * Hermes-style curated memory: MEMORY.md (§-delimited agent notes) and
 * USER.md (free-form user profile blob), both bounded.  All operations go
 * through /v1/memory* endpoints — the gateway is the single source of truth
 * so concurrent writes from the LLM (memory tool) and the desktop UI stay
 * consistent.
 */

import http from "http";
import { getUserName } from "./config";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "18642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

// ── Types ───────────────────────────────────────────

export interface MemoryEntry {
  index: number;
  content: string;
}

export interface MemoryInfo {
  memory: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    entries: MemoryEntry[];
    charCount: number;
    charLimit: number;
  };
  user: {
    content: string;
    exists: boolean;
    lastModified: number | null;
    charCount: number;
    charLimit: number;
  };
  stats: { totalSessions: number; totalMessages: number };
}

// ── HTTP helpers ────────────────────────────────────

function userQuery(): string {
  const u = getUserName();
  return u ? `?user_id=${encodeURIComponent(u)}` : "";
}

function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${DRSAI_API_URL}${path}`;
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        timeout: 10000,
        headers: bodyStr
          ? {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(bodyStr)),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (d: Buffer) => (data += d.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            let detail = data;
            try {
              detail = JSON.parse(data).detail || data;
            } catch {
              /* keep raw */
            }
            reject(new Error(detail));
            return;
          }
          try {
            resolve(data ? (JSON.parse(data) as T) : ({} as T));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Memory API request timed out"));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Read ────────────────────────────────────────────

const EMPTY_INFO: MemoryInfo = {
  memory: {
    content: "",
    exists: false,
    lastModified: null,
    entries: [],
    charCount: 0,
    charLimit: 2200,
  },
  user: {
    content: "",
    exists: false,
    lastModified: null,
    charCount: 0,
    charLimit: 1375,
  },
  stats: { totalSessions: 0, totalMessages: 0 },
};

export function readMemory(_profile?: string): MemoryInfo {
  // Sync fallback (IPC handler returns the cached empty state when the
  // gateway isn't reachable). UI should call readMemoryAsync.
  return { ...EMPTY_INFO };
}

export async function readMemoryAsync(
  _profile?: string,
): Promise<MemoryInfo> {
  try {
    return await apiRequest<MemoryInfo>("GET", `/v1/memory${userQuery()}`);
  } catch (err) {
    console.error("[memory] readMemoryAsync failed:", err);
    return { ...EMPTY_INFO };
  }
}

// ── Write operations ────────────────────────────────

export async function addMemoryEntry(
  content: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest<MemoryInfo>(
      "POST",
      `/v1/memory/entries${userQuery()}`,
      { content },
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function updateMemoryEntry(
  index: number,
  content: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest<MemoryInfo>(
      "PUT",
      `/v1/memory/entries/${index}${userQuery()}`,
      { content },
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function removeMemoryEntry(
  index: number,
  _profile?: string,
): Promise<boolean> {
  try {
    await apiRequest<MemoryInfo>(
      "DELETE",
      `/v1/memory/entries/${index}${userQuery()}`,
    );
    return true;
  } catch (err) {
    console.error("[memory] removeMemoryEntry failed:", err);
    return false;
  }
}

export async function writeUserProfile(
  content: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest<MemoryInfo>(
      "PUT",
      `/v1/memory/user${userQuery()}`,
      { content },
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
