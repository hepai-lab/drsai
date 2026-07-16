import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..", "..");
const pythonSrc = join(repoRoot, "cores", "python", "packages", "drsai", "src");
const port = Number(process.env.OPENDRSAI_GATEWAY_SMOKE_PORT || String(20_000 + (process.pid % 20_000)));
const baseUrl = `http://127.0.0.1:${port}`;
const tempHome = mkdtempSync(join(tmpdir(), "opendrsai-gateway-smoke-"));
const tempUserProfile = join(tempHome, "user-profile");
const gatewayInstanceToken = "gateway-smoke-instance-token";
const temporaryOidcSecret = "temporary-gateway-smoke-oidc-secret";

let gatewayProcess = null;

try {
  const python = resolvePython();
  gatewayProcess = spawn(python, ["-m", "drsai.backend.gateway"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DRSAI_API_HOST: "127.0.0.1",
      DRSAI_API_PORT: String(port),
      DRSAI_GATEWAY_FAKE_AGENT: "1",
      OPENDRSAI_GATEWAY_INSTANCE_TOKEN: gatewayInstanceToken,
      OPENDRSAI_OIDC_HS256_SECRET: temporaryOidcSecret,
      DRSAI_HOME: tempHome,
      USERNAME: "opendrsai-smoke",
      USERPROFILE: tempUserProfile,
      PYTHONPATH: [pythonSrc, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const logs = collectLogs(gatewayProcess);
  await waitForJson("/health", 25_000, logs);

  const health = await requestJson("/health");
  assert(health.statusCode === 200, `/health returned ${health.statusCode}`);
  assert(health.body && health.body.status === "ok", `/health body was ${JSON.stringify(health.body)}`);

  const models = await requestJson("/v1/models");
  assert(models.statusCode === 200, `/v1/models returned ${models.statusCode}`);
  assert(models.body?.object === "list" && Array.isArray(models.body.data), `/v1/models body was ${JSON.stringify(models.body)}`);

  const chat = await requestText("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "drsai",
      stream: true,
      user_id: "gateway-smoke",
      thread_id: "gateway-smoke-thread",
      messages: [{ role: "user", content: "hello gateway smoke" }],
    }),
  });
  assert(chat.statusCode === 200, `/v1/chat/completions returned ${chat.statusCode}: ${chat.text.slice(0, 300)}`);
  assert(chat.headers.get("x-drsai-session-id"), "chat response did not include X-Drsai-Session-Id");
  assert(chat.text.includes("fake-agent: hello gateway smoke"), "chat SSE did not include fake agent content chunk");
  assert(chat.text.includes("data: [DONE]"), "chat SSE did not include data: [DONE]");

  const oidcUser = "d30fc87e-f83d-4f3c-a145-bd1b77b7fde3";
  const oidcChat = await requestText("/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fakeOidcToken(oidcUser)}`,
      "X-OpenDrSai-Auth-Mode": "oidc",
    },
    body: JSON.stringify({
      model: "drsai",
      stream: true,
      user_id: oidcUser,
      thread_id: "gateway-smoke-oidc-thread",
      messages: [{ role: "user", content: "hello oidc gateway smoke" }],
    }),
  });
  assert(oidcChat.statusCode === 200, `OIDC chat returned ${oidcChat.statusCode}: ${oidcChat.text.slice(0, 300)}`);
  assert(oidcChat.text.includes("fake-agent: hello oidc gateway smoke"), "OIDC chat did not reach the request-scoped agent context");

  const wrongSubject = await requestText("/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fakeOidcToken("d0b66156-3680-4405-8c87-01b186b92a8c")}`,
      "X-OpenDrSai-Auth-Mode": "oidc",
    },
    body: JSON.stringify({
      model: "drsai",
      stream: true,
      user_id: oidcUser,
      messages: [{ role: "user", content: "must be rejected" }],
    }),
  });
  assert(wrongSubject.statusCode === 403, `OIDC subject mismatch returned ${wrongSubject.statusCode}`);

  console.log("Gateway smoke passed: /health, /v1/models, and chat SSE returned chunk + [DONE].");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (gatewayProcess) {
    await stopGatewayProcess(gatewayProcess);
  }
  await cleanupTempDir(tempHome);
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}
process.exitCode ??= 0;

async function cleanupTempDir(path) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw new Error(`Could not remove temporary Gateway directory ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function resolvePython() {
  const candidates = [
    process.env.OPENDRSAI_GATEWAY_SMOKE_PYTHON,
    join(repoRoot, "venv", "Scripts", "python.exe"),
    join(repoRoot, ".venv", "Scripts", "python.exe"),
    join(repoRoot, "venv", "bin", "python"),
    join(repoRoot, ".venv", "bin", "python"),
    process.platform === "win32" ? "python.exe" : "python",
  ].filter(Boolean);
  const python = candidates.find((candidate) => candidate.includes("\\") || candidate.includes("/") ? existsSync(candidate) : true);
  if (!python) {
    throw new Error(`Could not find Python for gateway smoke. Set OPENDRSAI_GATEWAY_SMOKE_PYTHON or create ${join(repoRoot, "venv")}.`);
  }
  return python;
}

function collectLogs(child) {
  const chunks = [];
  const append = (chunk) => {
    chunks.push(chunk.toString());
    while (chunks.join("").length > 12_000) chunks.shift();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return {
    tail: () => chunks.join("").slice(-12_000),
  };
}

async function waitForJson(path, timeoutMs, logs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(path);
      if (response.statusCode === 200) return;
    } catch {
      // Keep polling until the gateway is ready or the deadline expires.
    }
    if (gatewayProcess?.exitCode !== null) {
      throw new Error(`Gateway exited early with code ${gatewayProcess.exitCode}.\n${logs.tail()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Gateway did not become ready at ${baseUrl}${path} within ${timeoutMs}ms.\n${logs.tail()}`);
}

async function requestJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "X-OpenDrSai-Gateway-Token": gatewayInstanceToken },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { statusCode: response.status, body };
}

async function requestText(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "X-OpenDrSai-Gateway-Token": gatewayInstanceToken,
      ...(init?.headers || {}),
    },
  });
  return { statusCode: response.status, headers: response.headers, text: await response.text() };
}

function fakeOidcToken(subject) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "https://ai-dev.ihep.ac.cn/api",
    sub: subject,
    aud: "hai-api",
    exp: Math.floor(Date.now() / 1000) + 600,
    typ: "access_token",
    scope: "openid hai_api",
    org_id: "gateway-smoke-org",
    sid: "gateway-smoke-session",
  });
  const signature = createHmac("sha256", temporaryOidcSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopGatewayProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill("SIGTERM"); } catch {}
  await waitForProcessExit(child, 5_000);
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    try { child.kill("SIGKILL"); } catch {}
  }
  await waitForProcessExit(child, 5_000);
  if (child.exitCode === null && child.signalCode === null) throw new Error(`Gateway smoke process ${child.pid || "<unknown>"} did not exit.`);
}
