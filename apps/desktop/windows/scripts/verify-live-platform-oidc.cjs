const { app, safeStorage } = require("electron");
const { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

if (process.env.APPDATA) {
  app.setPath("userData", join(process.env.APPDATA, "opendrsai-windows-desktop"));
}

function decodeClaims(token) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Stored access token is not a JWT.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedTimeoutFromEnv(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function agentItems(payload) {
  const root = record(payload);
  if (Array.isArray(root.data)) return root.data;
  const data = record(root.data);
  if (Array.isArray(data.agents)) return data.agents;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(root.agents)) return root.agents;
  return [];
}

function secretLikeFieldNames(value, result = new Set()) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) secretLikeFieldNames(item, result);
    return result;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (/(api[_-]?key|token|secret|password|credential|authorization)/i.test(key)) result.add(key);
    secretLikeFieldNames(nested, result);
  }
  return result;
}

async function main() {
  await app.whenReady();
  const authPath = join(process.env.DRSAI_HOME || join(homedir(), ".drsai"), "auth", "auth.json");
  const stored = JSON.parse(readFileSync(authPath, "utf8"));
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Electron safeStorage is unavailable.");
  if (!stored.encryptedAccessToken) throw new Error("Stored OIDC access token is missing.");
  let accessToken = safeStorage.decryptString(Buffer.from(stored.encryptedAccessToken, "base64"));
  let claims = decodeClaims(accessToken);
  const expectedIssuer = "https://ai-dev.ihep.ac.cn/api";
  let refreshed = false;
  if (
    process.env.OPENDRSAI_LIVE_REFRESH === "1" &&
    (!(Number(claims.exp) * 1000 > Date.now()) || typeof claims.umt_id !== "string")
  ) {
    if (!stored.encryptedRefreshToken) throw new Error("Stored OIDC refresh token is missing.");
    const refreshToken = safeStorage.decryptString(Buffer.from(stored.encryptedRefreshToken, "base64"));
    const response = await fetch(`${expectedIssuer}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: stored.clientId || "opendrsai-desktop",
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const token = await response.json();
    if (!response.ok || typeof token.access_token !== "string" || typeof token.id_token !== "string") {
      throw new Error(`OIDC refresh failed with HTTP ${response.status}.`);
    }
    accessToken = token.access_token;
    claims = decodeClaims(accessToken);
    stored.encryptedAccessToken = safeStorage.encryptString(accessToken).toString("base64");
    stored.encryptedIdToken = safeStorage.encryptString(token.id_token).toString("base64");
    if (typeof token.refresh_token === "string") {
      stored.encryptedRefreshToken = safeStorage.encryptString(token.refresh_token).toString("base64");
    }
    stored.accessTokenExpiresAt = new Date(Number(claims.exp) * 1000).toISOString();
    const temporary = `${authPath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, authPath);
      try { chmodSync(authPath, 0o600); } catch {}
    } finally {
      rmSync(temporary, { force: true });
    }
    refreshed = true;
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const report = {
    refreshed,
    claimKeys: Object.keys(claims).sort(),
    issuerMatches: claims.iss === expectedIssuer,
    audienceMatches: audience.includes("hai-api"),
    hasUmtId: (typeof claims.umt_id === "string" && claims.umt_id.length > 0) ||
      (typeof claims.umt_id === "number" && Number.isInteger(claims.umt_id)),
    tokenActive: Number(claims.exp) * 1000 > Date.now(),
    catalogStatus: null,
    catalogAuthorized: false,
    catalogApiVersion: null,
    catalogCapabilities: [],
    catalogAgentCount: 0,
    catalogTopLevelKeys: [],
    catalogAgentFieldKeys: [],
    catalogSecretLikeFieldNames: [],
    modelsStatus: null,
    modelsAuthorized: false,
    availableModelIds: [],
    chatStatus: null,
    chatAgentId: null,
    chatAgentMode: null,
    chatAgentCapabilities: [],
    selectedModel: null,
    chatContentType: null,
    chatDurationMs: null,
    chatErrorCode: null,
    chatErrorKeys: [],
    chatErrorDetail: null,
    chatDetailKeys: [],
    chatSawContent: false,
    chatSawTextDelta: false,
    chatSawDone: false,
  };
  if (report.issuerMatches && report.audienceMatches && report.hasUmtId && report.tokenActive) {
    const catalog = await fetch("https://ai-dev.ihep.ac.cn/api/native/v1/agents?refresh=false", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    report.catalogStatus = catalog.status;
    report.catalogAuthorized = catalog.ok;
    report.catalogApiVersion = catalog.headers.get("x-opendrsai-api-version");
    const catalogBody = await catalog.json().catch(() => null);
    const catalogRoot = record(catalogBody);
    const catalogData = record(catalogRoot.data);
    const agents = agentItems(catalogBody);
    report.catalogApiVersion = report.catalogApiVersion || catalogRoot.api_version ||
      catalogRoot.version || catalogData.api_version || catalogData.version || null;
    const capabilities = catalogRoot.capabilities || catalogData.capabilities;
    report.catalogCapabilities = Array.isArray(capabilities)
      ? capabilities.filter((item) => typeof item === "string").slice(0, 32)
      : Object.keys(record(capabilities)).slice(0, 32);
    report.catalogAgentCount = agents.length;
    report.catalogTopLevelKeys = Object.keys(catalogRoot).sort();
    report.catalogAgentFieldKeys = agents.length > 0 ? Object.keys(record(agents[0])).sort() : [];
    report.catalogSecretLikeFieldNames = [...secretLikeFieldNames(catalogBody)].sort();

    const response = await fetch("https://ai-dev.ihep.ac.cn/apiv2/v1/models", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    report.modelsStatus = response.status;
    report.modelsAuthorized = response.ok;
    const models = response.ok ? await response.json() : null;
    if (response.ok && process.env.OPENDRSAI_LIVE_CHAT === "1") {
      const ids = Array.isArray(models?.data)
        ? models.data.map((item) => item?.id).filter((id) => typeof id === "string")
        : [];
      report.availableModelIds = ids.slice(0, 12);
      const preferredModels = [
        process.env.OPENDRSAI_LIVE_MODEL,
        "deepseek-ai/deepseek-v4-pro",
        "hepai/minimax-m2.7-highspeed",
        "minimax-m2.7-highspeed",
        "glm-5.1",
        "gemini-3-flash-preview",
        "deepseek-v4-flash",
      ].filter(Boolean);
      const ddfAgent = agents.find((item) => {
        const agent = record(item);
        const config = record(agent.config);
        const mode = String(agent.mode || agent.type || config.mode || "").toLowerCase();
        const capabilities = Array.isArray(agent.capabilities)
          ? agent.capabilities
          : Object.keys(record(agent.capabilities)).filter((key) => record(agent.capabilities)[key] === true);
        return mode === "ddf" && capabilities.includes("chat") && capabilities.includes("streaming");
      });
      if (!ddfAgent) throw new Error("No visible DDF agent advertises chat and streaming capabilities.");
      const ddf = record(ddfAgent);
      const ddfConfig = record(ddf.config);
      const agentId = ddf.id || ddf.agent_id || ddfConfig.id;
      if (typeof agentId !== "string" || !agentId) throw new Error("The selected DDF agent has no stable id.");
      const capabilities = Array.isArray(ddf.capabilities)
        ? ddf.capabilities.filter((item) => typeof item === "string")
        : Object.keys(record(ddf.capabilities)).filter((key) => record(ddf.capabilities)[key] === true);
      report.chatAgentId = agentId;
      report.chatAgentMode = "ddf";
      report.chatAgentCapabilities = capabilities.slice(0, 32);
      const model = preferredModels.find((candidate) => ids.includes(candidate)) || ids[0] || null;
      report.selectedModel = model;
      const threadId = `desktop-live-ddf-${Date.now()}`;
      const chatStartedAt = Date.now();
      const liveChatTimeoutMs = boundedTimeoutFromEnv(
        "OPENDRSAI_LIVE_CHAT_TIMEOUT_MS",
        120_000,
        10_000,
        180_000,
      );
      report.chatTimeoutMs = liveChatTimeoutMs;
      const chat = await fetch(`https://ai-dev.ihep.ac.cn/api/native/v1/agents/${encodeURIComponent(agentId)}/chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with OK." }],
          stream: true,
          thread_id: threadId,
          run_id: threadId,
          attachments: [],
          metadata: { source: "windows-native-ddf-smoke" },
        }),
        signal: AbortSignal.timeout(liveChatTimeoutMs),
      });
      report.chatDurationMs = Date.now() - chatStartedAt;
      report.chatStatus = chat.status;
      report.chatContentType = chat.headers.get("content-type");
      if (!chat.ok) {
        const errorBody = await chat.json().catch(() => null);
        report.chatErrorKeys = errorBody && typeof errorBody === "object"
          ? Object.keys(errorBody).sort()
          : [];
        if (typeof errorBody?.detail === "string") {
          report.chatErrorDetail = errorBody.detail.slice(0, 160);
        } else if (Array.isArray(errorBody?.detail)) {
          report.chatErrorDetail = errorBody.detail
            .map((item) => item?.msg)
            .filter((message) => typeof message === "string")
            .join("; ")
            .slice(0, 160);
        } else if (errorBody?.detail && typeof errorBody.detail === "object") {
          report.chatDetailKeys = Object.keys(errorBody.detail).sort();
          const detailMessage = errorBody.detail.message || errorBody.detail.error;
          if (typeof errorBody.detail.error_code === "string") {
            report.chatErrorCode = errorBody.detail.error_code;
          }
          if (typeof detailMessage === "string") report.chatErrorDetail = detailMessage.slice(0, 160);
        }
        const candidate = errorBody?.error;
        report.chatErrorCode = typeof candidate === "string"
          ? candidate
          : typeof candidate?.code === "string"
            ? candidate.code
            : typeof errorBody?.detail === "string"
              ? errorBody.detail.slice(0, 80)
              : "unknown_error";
      }
      if (chat.ok && chat.body) {
        const reader = chat.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          if (/data:\s*\[DONE\]/.test(buffered)) report.chatSawDone = true;
          if (/data:\s*\{/.test(buffered)) report.chatSawContent = true;
          if (/"(?:content|text)"\s*:\s*"(?:[^"\\]|\\.)+"/.test(buffered)) report.chatSawTextDelta = true;
          if (buffered.length > 256_000) buffered = buffered.slice(-128_000);
        }
        report.chatDurationMs = Date.now() - chatStartedAt;
      }
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const chatPassed = process.env.OPENDRSAI_LIVE_CHAT !== "1" ||
    (report.chatStatus === 200 && /^text\/event-stream\b/i.test(report.chatContentType || "") &&
      report.chatSawContent && report.chatSawTextDelta && report.chatSawDone);
  return report.issuerMatches && report.audienceMatches && report.hasUmtId &&
    report.tokenActive && report.catalogAuthorized &&
    report.catalogSecretLikeFieldNames.length === 0 && report.modelsAuthorized && chatPassed;
}

let exitCode = 1;
main()
  .then((passed) => { exitCode = passed ? 0 : 1; })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    exitCode = 1;
  })
  .finally(() => app.exit(exitCode));
