const { app, safeStorage } = require("electron");
const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

if (process.env.APPDATA) {
  app.setPath("userData", join(process.env.APPDATA, "opendrsai-windows-desktop"));
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function catalogItems(value) {
  const root = record(value);
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.agents)) return root.agents;
  return [];
}

function containsSensitiveKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  return Object.entries(value).some(([key, nested]) =>
    /(worker[_-]?url|address|endpoint|api[_-]?key|token|secret|password|credential|config|system[_-]?prompt|instruction)/i.test(key)
    || containsSensitiveKey(nested));
}

async function main() {
  await app.whenReady();
  const authPath = join(process.env.DRSAI_HOME || join(homedir(), ".drsai"), "auth", "auth.json");
  const stored = JSON.parse(readFileSync(authPath, "utf8"));
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Electron safeStorage is unavailable.");
  if (!stored.encryptedAccessToken) throw new Error("Stored OIDC access token is missing.");
  const accessToken = safeStorage.decryptString(Buffer.from(stored.encryptedAccessToken, "base64"));
  const baseUrl = process.env.OPENDRSAI_LIVE_BASE_URL || "https://ai-dev.ihep.ac.cn/apiv2";
  const agentId = process.env.OPENDRSAI_LIVE_AGENT || "drsai_v3_test";
  const iterations = Math.max(1, Math.min(20, Number(process.env.OPENDRSAI_LIVE_ITERATIONS) || 1));
  const requestedScenario = process.env.OPENDRSAI_LIVE_SCENARIO;
  const scenario = requestedScenario === "tool" || requestedScenario === "hil" ? requestedScenario : "analysis";
  const prompt = scenario === "hil"
    ? "Run the harmless remote-agent human-input contract test."
    : scenario === "tool"
    ? "请运行只读 Worker 健康检查工具。"
    : "请给出 J/psi -> mu+mu- 的最小分析计划，不运行代码、不提交任务。";

  const catalogResponse = await fetch(`${baseUrl}/agents/list_agents?refresh=true`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const catalogBody = await catalogResponse.json().catch(() => null);
  const agent = catalogItems(catalogBody).find((item) => record(item).id === agentId);
  if (!catalogResponse.ok) throw new Error(`Catalog failed with HTTP ${catalogResponse.status}.`);
  if (!agent) throw new Error(`Catalog does not contain ${agentId}.`);
  if (containsSensitiveKey(agent)) throw new Error("Catalog public DTO contains a sensitive field.");
  const publicAgent = record(agent);
  const examples = record(publicAgent.examples);
  if (publicAgent.available !== true) throw new Error(`${agentId} is not available.`);
  if (!Array.isArray(examples.zh) || !Array.isArray(examples.en) || examples.zh.length === 0 || examples.en.length === 0) {
    throw new Error(`${agentId} does not expose localized examples.`);
  }
  const catalogReport = {
    status: catalogResponse.status,
    id: publicAgent.id,
    available: publicAgent.available,
    capabilities: publicAgent.capabilities,
    examplesZh: examples.zh.length,
    examplesEn: examples.en.length,
    publicKeys: Object.keys(publicAgent).sort(),
    sensitive: false,
  };
  console.log(JSON.stringify({ phase: "catalog", catalog: catalogReport }));

  const runs = [];
  for (let index = 0; index < iterations; index += 1) {
    const id = `desktop-live-${Date.now()}-${index}`;
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Idempotency-Key": id,
      },
      body: JSON.stringify({
        model: agentId,
        stream: true,
        thread_id: id,
        run_id: id,
        messages: [{
          role: "user",
          content: prompt,
        }],
        metadata: {
          desktop_request_id: id,
          source: "windows-live-remote-agent-smoke",
          ...(scenario === "hil" ? { hil_contract_test: true } : {}),
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(`Chat ${index + 1} failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let firstEventMs = null;
    let inputRequest = null;
    let inputResponseStatus = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstEventMs === null) firstEventMs = Date.now() - startedAt;
      raw += decoder.decode(value, { stream: true });
      if (raw.length > 2_000_000) throw new Error("Live stream exceeded 2 MB.");
      if (!inputRequest) {
        inputRequest = findInputRequest(raw);
        if (inputRequest) {
          const inputResponse = await fetch(`${baseUrl}/agents/input`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "Idempotency-Key": inputRequest.request_id,
            },
            body: JSON.stringify({
              model: agentId,
              chat_id: inputRequest.chat_id,
              run_id: inputRequest.run_id,
              request_id: inputRequest.request_id,
              response: {
                option_id: inputRequest.options?.find((option) => option.id === "accept")?.id
                  || inputRequest.options?.[0]?.id
                  || "accept",
                value: inputRequest.options?.find((option) => option.id === "accept")?.value
                  || inputRequest.options?.[0]?.value
                  || inputRequest.options?.[0]?.id
                  || "accept",
              },
            }),
            signal: AbortSignal.timeout(20_000),
          });
          inputResponseStatus = inputResponse.status;
          if (!inputResponse.ok) {
            throw new Error(`HIL response failed with HTTP ${inputResponse.status}: ${(await inputResponse.text()).slice(0, 300)}`);
          }
        }
      }
    }
    raw += decoder.decode();
    const sawDone = /data:\s*\[DONE\]/.test(raw);
    const sawTerminal = /"event_type"\s*:\s*"terminal"/.test(raw) || /"finish_reason"\s*:\s*"[^"]+"/.test(raw);
    const sawText = /"content"\s*:\s*"[^"]+/.test(raw);
    const sawError = /"error"\s*:/.test(raw);
    const structured = analyzeWorkerEvents(raw);
    if (
      !sawText
      || (!sawDone && !sawTerminal)
      || sawError
      || structured.statusEvents < 1
      || (scenario === "analysis" && structured.completedStepIds.length < 2)
      || (scenario === "tool" && !structured.completedToolIds.includes("tool-worker-health-0001"))
      || (scenario === "hil" && (!inputRequest || inputResponseStatus !== 200))
    ) {
      throw new Error(
        `Chat ${index + 1} failed contract: text=${sawText}, done=${sawDone}, `
        + `terminal=${sawTerminal}, error=${sawError}, statusEvents=${structured.statusEvents}, `
        + `completedSteps=${structured.completedStepIds.length}, completedTools=${JSON.stringify(structured.completedToolIds)}, `
        + `steps=${JSON.stringify(structured.steps)}, tools=${JSON.stringify(structured.tools)}.`,
      );
    }
    runs.push({
      index: index + 1,
      status: response.status,
      contentType: response.headers.get("content-type"),
      firstEventMs,
      totalMs: Date.now() - startedAt,
      bytes: Buffer.byteLength(raw),
      sawDone,
      sawTerminal,
      statusEvents: structured.statusEvents,
      completedStepIds: structured.completedStepIds,
      completedToolIds: structured.completedToolIds,
      inputRequestId: inputRequest?.request_id || null,
      inputResponseStatus,
    });
  }

  console.log(JSON.stringify({
    catalog: catalogReport,
    iterations,
    passed: runs.length,
    firstEventP95Ms: percentile(runs.map((run) => run.firstEventMs || 0), 0.95),
    totalP95Ms: percentile(runs.map((run) => run.totalMs), 0.95),
    runs,
  }, null, 2));
}

function findInputRequest(raw) {
  for (const frame of raw.split(/\r?\n\r?\n/)) {
    if (!/^event:\s*agent\.input_request\s*$/m.test(frame)) continue;
    const payload = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    try {
      const parsed = JSON.parse(payload);
      if (parsed && parsed.version === 1 && parsed.request_id && parsed.chat_id && parsed.run_id) return parsed;
    } catch {
      // The final frame may still be arriving.
    }
  }
  return null;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

function analyzeWorkerEvents(raw) {
  let statusEvents = 0;
  const steps = new Map();
  const tools = new Map();
  for (const frame of raw.split(/\r?\n\r?\n/)) {
    const payload = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!payload || payload === "[DONE]") continue;
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const metadata = record(parsed.metadata);
    if (metadata.event_type === "status") statusEvents += 1;
    if (metadata.event_type === "tool") {
      const tool = record(metadata.tool);
      if (typeof tool.id === "string" && typeof tool.phase === "string") {
        const lifecycle = tools.get(tool.id) || new Set();
        lifecycle.add(`${tool.phase}:${String(metadata.status || "")}`);
        tools.set(tool.id, lifecycle);
      }
    }
    const stepId = typeof metadata.id === "string"
      ? metadata.id
      : typeof metadata.step_id === "string"
        ? metadata.step_id
        : "";
    if (metadata.event_type !== "step" || !stepId) continue;
    const lifecycle = steps.get(stepId) || new Set();
    if (typeof metadata.status === "string") lifecycle.add(metadata.status);
    steps.set(stepId, lifecycle);
  }
  const completedStepIds = [...steps.entries()]
    .filter(([, lifecycle]) =>
      lifecycle.has("queued")
      && lifecycle.has("in_progress")
      && lifecycle.has("completed"))
    .map(([id]) => id);
  const completedToolIds = [...tools.entries()]
    .filter(([, lifecycle]) =>
      lifecycle.has("start:in_progress")
      && lifecycle.has("result:completed"))
    .map(([id]) => id);
  return {
    statusEvents,
    completedStepIds,
    completedToolIds,
    steps: [...steps.entries()].map(([id, lifecycle]) => ({
      id,
      statuses: [...lifecycle],
    })),
    tools: [...tools.entries()].map(([id, lifecycle]) => ({
      id,
      lifecycle: [...lifecycle],
    })),
  };
}

main().then(
  () => {
    app.quit();
    process.exit(0);
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    app.quit();
    process.exit(1);
  },
);
