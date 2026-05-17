/**
 * DrSai backend connector — replaces hermes.ts.
 *
 * Manages the DrSai API server lifecycle and provides a streaming chat
 * interface via HTTP SSE. Keeps the same public API surface as hermes.ts
 * so that index.ts (IPC handler registration) needs minimal changes.
 *
 * Architecture:
 *   Electron main  ──HTTP SSE──▶  DrSai API Server (FastAPI, port 8642)
 *                                  └── DrSai Assistant (autogen_agentchat)
 *
 * SSE format (DrSai API):
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   event: tool.progress
 *   data: {"tool":"...","arguments":{...}}
 *   event: tool.result
 *   data: {"tool":"...","result":"..."}
 *   data: {"choices":[{"delta":{},"usage":{"total_tokens":42}}]}
 *   data: [DONE]
 *
 * Session: X-Drsai-Session-Id response header.
 */

import { ChildProcess, spawn } from "child_process";
import { join } from "path";
import { homedir } from "os";
import http from "http";
import { stripAnsi } from "./utils";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

// ────────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────────

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

/** Path to the DrSai API server script, relative to the project root. */
const DRSAI_API_SCRIPT = join(
  homedir(),
  "drsai_dev",
  "desktop",
  "drsai_api_server.py",
);

// ────────────────────────────────────────────────────
//  Public API (same signatures as hermes.ts)
// ────────────────────────────────────────────────────

export function getApiUrl(): string {
  return DRSAI_API_URL;
}

/** DrSai Desktop does not support remote/SSH mode (yet). */
export function isRemoteMode(): boolean {
  return false;
}

export function isRemoteOnlyMode(): boolean {
  return false;
}

export function setSshRemoteApiKey(_key: string): void {
  /* no-op */
}

export function getRemoteAuthHeader(): Record<string, string> {
  return {};
}

export async function ensureSshTunnelIfNeeded(): Promise<void> {
  /* no-op */
}

// ────────────────────────────────────────────────────
//  Chat callbacks
// ────────────────────────────────────────────────────

export interface ChatCallbacks {
  onChunk: (text: string) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
  }) => void;
}

interface ChatHandle {
  abort: () => void;
}

// ────────────────────────────────────────────────────
//  Health check
// ────────────────────────────────────────────────────

function isApiServerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `${DRSAI_API_URL}/health`;
    const req = http.request(
      url,
      { method: "GET", timeout: 1500 },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// ────────────────────────────────────────────────────
//  HTTP SSE streaming (primary path)
// ────────────────────────────────────────────────────

function sendMessageViaApi(
  message: string,
  cb: ChatCallbacks,
  _profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
): ChatHandle {
  const controller = new AbortController();

  // Build full conversation history + current message
  const messages: Array<{ role: string; content: string }> = [];
  if (history && history.length > 0) {
    for (const msg of history) {
      messages.push({
        role: msg.role === "agent" ? "assistant" : msg.role,
        content: msg.content,
      });
    }
  }
  messages.push({ role: "user", content: message });

  const body = JSON.stringify({
    model: "drsai",
    messages,
    stream: true,
    ...(resumeSessionId ? { thread_id: resumeSessionId } : {}),
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  let sessionId = resumeSessionId || "";
  let hasContent = false;
  let finished = false;

  function finish(error?: string): void {
    if (finished) return;
    finished = true;
    if (error) {
      cb.onError(error);
    } else {
      cb.onDone(sessionId || undefined);
    }
  }

  function processSseData(data: string): boolean {
    if (data === "[DONE]") {
      if (!hasContent) {
        finish("No response received. Check your API configuration.");
      } else {
        finish();
      }
      return true;
    }
    try {
      const parsed = JSON.parse(data);
      if (parsed.error) {
        finish(parsed.error.message || JSON.stringify(parsed.error));
        return true;
      }
      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      // Usage info (final chunk)
      if (parsed.usage && cb.onUsage) {
        cb.onUsage({
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0,
          cost: parsed.usage.cost,
          rateLimitRemaining: parsed.usage.rate_limit_remaining,
          rateLimitReset: parsed.usage.rate_limit_reset,
        });
      }

      if (delta?.content) {
        hasContent = true;
        cb.onChunk(delta.content);
      }
    } catch {
      /* malformed chunk — skip */
    }
    return false;
  }

  function processCustomEvent(eventType: string, data: string): void {
    if ((eventType === "tool.progress" || eventType === "drsai.tool.progress") && cb.onToolProgress) {
      try {
        const payload = JSON.parse(data);
        const tool = payload.tool || "";
        const label = tool ? `\`${tool}\` ${payload.arguments ? JSON.stringify(payload.arguments) : ""}` : "";
        cb.onToolProgress(label || tool);
      } catch {
        /* malformed — skip */
      }
    }
  }

  const chatUrl = `${DRSAI_API_URL}/v1/chat/completions`;
  const req = http.request(
    chatUrl,
    {
      method: "POST",
      headers,
      signal: controller.signal,
      timeout: 120000,
    },
    (res) => {
      const sid = res.headers["x-drsai-session-id"];
      if (sid && typeof sid === "string") sessionId = sid;

      if (res.statusCode !== 200) {
        let errBody = "";
        res.on("data", (d) => {
          errBody += d.toString();
        });
        res.on("end", () => {
          try {
            const err = JSON.parse(errBody);
            finish(err.detail || err.error?.message || `API error ${res.statusCode}`);
          } catch {
            finish(`API server returned ${res.statusCode}: ${errBody.slice(0, 200)}`);
          }
        });
        return;
      }

      let buffer = "";

      function processSseBlock(block: string): boolean {
        let eventType = "";
        let dataLine = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6);
          }
        }
        if (!dataLine) return false;
        if (eventType) {
          processCustomEvent(eventType, dataLine);
          return false;
        }
        return processSseData(dataLine);
      }

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || ""; // keep incomplete block
        for (const block of blocks) {
          if (!block.trim()) continue;
          if (processSseBlock(block)) break; // done
        }
      });

      res.on("end", () => {
        if (buffer.trim()) {
          const blocks = buffer.split("\n\n");
          for (const block of blocks) {
            if (!block.trim()) continue;
            if (processSseBlock(block)) break;
          }
        }
        if (!finished) finish();
      });

      res.on("error", (err) => {
        finish(err.message);
      });
    },
  );

  req.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      finish("DrSai API server is not running. Start it with: python drsai_api_server.py");
    } else {
      finish(err.message);
    }
  });

  req.on("timeout", () => {
    req.destroy();
    finish("Request timed out after 120s");
  });

  req.write(body);
  req.end();

  return {
    abort: () => controller.abort(),
  };
}

// ────────────────────────────────────────────────────
//  CLI fallback (spawn drsai chat process)
// ────────────────────────────────────────────────────

function sendMessageViaCli(
  message: string,
  cb: ChatCallbacks,
  _profile?: string,
  resumeSessionId?: string,
): ChatHandle {
  const args = ["-m", "drsai.backend.run_cli", "chat", "-q", message];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PYTHONUNBUFFERED: "1",
  };

  const proc = spawn("python", args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    ...HIDDEN_SUBPROCESS_OPTIONS,
  });

  let hasOutput = false;
  let capturedSessionId = "";
  let outputBuffer = "";

  function processOutput(raw: Buffer): void {
    const text = stripAnsi(raw.toString());
    outputBuffer += text;

    const sidMatch = outputBuffer.match(/session_id:\s*(\S+)/);
    if (sidMatch) capturedSessionId = sidMatch[1];

    if (text.trim()) {
      hasOutput = true;
      cb.onChunk(text);
    }
  }

  proc.stdout?.on("data", processOutput);

  let stderrBuffer = "";
  proc.stderr?.on("data", (data: Buffer) => {
    const text = stripAnsi(data.toString());
    if (!text.trim() || text.includes("UserWarning") || text.includes("FutureWarning")) {
      return;
    }
    if (/Error|Traceback|failed|denied|unauthorized/i.test(text)) {
      hasOutput = true;
      cb.onChunk(text);
    } else {
      stderrBuffer += text;
    }
  });

  proc.on("close", (code) => {
    if (code === 0 || hasOutput) {
      cb.onDone(capturedSessionId || undefined);
    } else {
      const detail = stderrBuffer.trim();
      cb.onError(
        detail
          ? `DrSai exited with code ${code}: ${detail}`
          : `DrSai exited with code ${code}. Check your configuration.`,
      );
    }
  });

  proc.on("error", (err) => {
    cb.onError(`Failed to start DrSai CLI: ${err.message}`);
  });

  return {
    abort: () => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 3000);
    },
  };
}

// ────────────────────────────────────────────────────
//  Public API: auto-routes HTTP API or CLI fallback
// ────────────────────────────────────────────────────

let apiServerAvailable: boolean | null = null;

export async function sendMessage(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
): Promise<ChatHandle> {
  ensureInitialized();

  // Check API server availability (cached, re-check if previously false)
  if (apiServerAvailable === null || apiServerAvailable === false) {
    apiServerAvailable = await isApiServerReady();
  }

  if (apiServerAvailable) {
    return sendMessageViaApi(message, cb, profile, resumeSessionId, history);
  }

  // Fallback to CLI
  return sendMessageViaCli(message, cb, profile, resumeSessionId);
}

// ────────────────────────────────────────────────────
//  Lazy init + health polling
// ────────────────────────────────────────────────────

let _initialized = false;
let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function ensureInitialized(): void {
  if (_initialized) return;
  _initialized = true;
  startHealthPolling();
}

function startHealthPolling(): void {
  if (_healthCheckInterval) return;
  _healthCheckInterval = setInterval(async () => {
    apiServerAvailable = await isApiServerReady();
    if (apiServerAvailable && _healthCheckInterval) {
      clearInterval(_healthCheckInterval);
      _healthCheckInterval = null;
    }
  }, 15000);
}

export function stopHealthPolling(): void {
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}

// ────────────────────────────────────────────────────
//  Gateway management (DrSai API server lifecycle)
// ────────────────────────────────────────────────────

let apiProcess: ChildProcess | null = null;
let apiStartedByApp = false;

export function startGateway(_profile?: string): boolean {
  ensureInitialized();
  if (isGatewayRunning()) return false;

  console.log("[drsai] Starting DrSai API server...");

  apiProcess = spawn("python", [DRSAI_API_SCRIPT], {
    env: {
      ...(process.env as Record<string, string>),
      DRSAI_API_PORT: String(DRSAI_API_PORT),
    },
    stdio: "pipe",
    detached: false,
    ...HIDDEN_SUBPROCESS_OPTIONS,
  });

  // Log API server output for debugging
  apiProcess.stdout?.on("data", (d: Buffer) => {
    console.log("[drsai-api]", d.toString().trim());
  });
  apiProcess.stderr?.on("data", (d: Buffer) => {
    console.error("[drsai-api:err]", d.toString().trim());
  });

  apiProcess.on("close", () => {
    apiProcess = null;
    apiStartedByApp = false;
    apiServerAvailable = false;
    startHealthPolling();
  });

  apiStartedByApp = true;

  // Wait a bit then check if API server came up
  setTimeout(async () => {
    apiServerAvailable = await isApiServerReady();
    if (apiServerAvailable) {
      console.log("[drsai] API server is ready");
    }
  }, 3000);

  return true;
}

export function stopGateway(force = false): void {
  if (!force && !apiStartedByApp) return;

  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill("SIGTERM");
    apiProcess = null;
  }
  apiStartedByApp = false;
  apiServerAvailable = false;
}

export function isGatewayRunning(): boolean {
  return apiProcess !== null && !apiProcess.killed;
}

export function isApiReady(): boolean {
  return apiServerAvailable === true;
}

export function restartGateway(profile?: string): void {
  if (!apiStartedByApp && !isGatewayRunning()) return;
  stopGateway(true);
  setTimeout(() => {
    startGateway(profile);
  }, 500);
}

// ────────────────────────────────────────────────────
//  Remote connection test
// ────────────────────────────────────────────────────

export function testRemoteConnection(
  url: string,
  _apiKey?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const target = `${url.replace(/\/+$/, "")}/health`;
    const req = http.request(
      target,
      { method: "GET", timeout: 5000 },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
