/**
 * Memory management via DrSai API Gateway.
 *
 * Calls /v1/memory endpoints instead of reading the filesystem directly.
 */

import { getUserName } from "./config";
import http from "http";

// ── API helpers ─────────────────────────────────────

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
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

// ── Read ────────────────────────────────────────────

export function readMemory(_profile?: string): MemoryInfo {
  // Sync fallback — returns empty state
  return {
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
}

export async function readMemoryAsync(
  _profile?: string,
): Promise<MemoryInfo> {
  try {
    const user = getUserName();
    const resp = (await apiGet<{
      memory: { content: string; exists: boolean; charCount: number };
      user: { content: string; exists: boolean; charCount: number };
    }>(`/v1/memory?user_id=${encodeURIComponent(user)}`)) as {
      memory: { content: string; exists: boolean; charCount: number };
      user: { content: string; exists: boolean; charCount: number };
    };

    return {
      memory: {
        content: resp.memory?.content || "",
        exists: resp.memory?.exists || false,
        lastModified: null,
        entries: [],
        charCount: resp.memory?.charCount || 0,
        charLimit: 2200,
      },
      user: {
        content: resp.user?.content || "",
        exists: resp.user?.exists || false,
        lastModified: null,
        charCount: resp.user?.charCount || 0,
        charLimit: 1375,
      },
      stats: { totalSessions: 0, totalMessages: 0 },
    };
  } catch (err) {
    console.error("[memory] readMemoryAsync failed:", err);
    return readMemory(); // fallback to empty
  }
}

// ── Write operations (not yet supported via API) ────

export function addMemoryEntry(
  _content: string,
  _profile?: string,
): { success: boolean; error?: string } {
  return { success: false, error: "Memory write via API not yet implemented" };
}

export function updateMemoryEntry(
  _index: number,
  _content: string,
  _profile?: string,
): { success: boolean; error?: string } {
  return { success: false, error: "Memory write via API not yet implemented" };
}

export function removeMemoryEntry(
  _index: number,
  _profile?: string,
): boolean {
  return false;
}

export function writeUserProfile(
  _content: string,
  _profile?: string,
): { success: boolean; error?: string } {
  return { success: false, error: "Memory write via API not yet implemented" };
}
