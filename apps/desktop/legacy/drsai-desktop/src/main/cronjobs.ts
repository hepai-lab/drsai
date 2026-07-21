/**
 * Cron jobs via DrSai API Gateway (/v1/cronjobs*).
 *
 * The gateway wraps drsai's ScheduledTaskManager; each cron task fires through
 * the same AgentManager.run_stream() pipeline as interactive chat, so jobs
 * share Thread state and tooling with the rest of the agent.
 */

import http from "http";
import { getUserName } from "./config";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "18642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  state: "active" | "paused" | "completed";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  repeat: { times: number | null; completed: number } | null;
  deliver: string[];
  skills: string[];
  script: string | null;
}

function userQuery(): string {
  const u = getUserName();
  return u ? `&user_id=${encodeURIComponent(u)}` : "";
}

function userQueryFirst(): string {
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
        timeout: 8000,
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
            try { detail = JSON.parse(data).detail || data; } catch { /* keep */ }
            reject(new Error(detail));
            return;
          }
          try { resolve(data ? (JSON.parse(data) as T) : ({} as T)); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Cron API request timed out"));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export async function listCronJobs(
  includeDisabled: boolean = true,
  _profile?: string,
): Promise<CronJob[]> {
  try {
    return await apiRequest<CronJob[]>(
      "GET",
      `/v1/cronjobs?include_disabled=${includeDisabled}${userQuery()}`,
    );
  } catch (err) {
    console.warn("[cronjobs] listCronJobs failed:", (err as Error).message);
    return [];
  }
}

export async function createCronJob(
  schedule: string,
  prompt?: string,
  name?: string,
  deliver?: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!schedule || !prompt) {
    return { success: false, error: "schedule and prompt are required" };
  }
  try {
    await apiRequest<CronJob>("POST", `/v1/cronjobs${userQueryFirst()}`, {
      schedule,
      prompt,
      name,
      deliver,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function removeCronJob(
  jobId: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest<{ ok: boolean }>(
      "DELETE",
      `/v1/cronjobs/${encodeURIComponent(jobId)}${userQueryFirst()}`,
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function pauseCronJob(
  jobId: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest<CronJob>(
      "POST",
      `/v1/cronjobs/${encodeURIComponent(jobId)}/pause${userQueryFirst()}`,
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function resumeCronJob(
  jobId: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest<CronJob>(
      "POST",
      `/v1/cronjobs/${encodeURIComponent(jobId)}/resume${userQueryFirst()}`,
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function triggerCronJob(
  jobId: string,
  _profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest<CronJob>(
      "POST",
      `/v1/cronjobs/${encodeURIComponent(jobId)}/trigger${userQueryFirst()}`,
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
