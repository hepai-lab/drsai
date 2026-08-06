import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const evidencePath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-traceability-phase3-live-model-result.json");
const sourceFiles = [
  "apps/desktop/windows/scripts/verify-run-traceability-phase3-live-model.cjs",
  "apps/desktop/windows/scripts/verify-run-traceability-phase3-live-model.mjs",
  "apps/desktop/windows/src/main/index.ts",
  "cores/python/packages/drsai/src/drsai/backend/gateway.py",
  "cores/python/packages/drsai/src/drsai/backend/run_drsai_agent_factory.py",
  "cores/python/packages/drsai/src/drsai/config/model_registry.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/artifacts.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/engine.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/input_resources.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/oaep.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_autogen_ports.py",
  "cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_assistant.py",
];
const runtimeSourceFiles = sourceFiles.filter((path) => path.startsWith("cores/python/"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const currentCommit = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd:repoRoot, encoding:"utf8", windowsHide:true }).trim();
const sourceDigest = () => {
  const hash = createHash("sha256");
  for (const path of [...sourceFiles].sort()) {
    hash.update(path); hash.update("\0"); hash.update(readFileSync(resolve(repoRoot, path))); hash.update("\0");
  }
  return hash.digest("hex");
};
const digestFiles = (paths) => {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path); hash.update("\0"); hash.update(readFileSync(resolve(repoRoot, path))); hash.update("\0");
  }
  return hash.digest("hex");
};
const captureSourceState = () => ({ commit:currentCommit(), source_digest:sourceDigest() });
const completedAssistantMessages = (items) => items.filter((item) =>
  item?.type === "message" && item?.status === "completed" && item?.content?.role === "assistant"
  && (String(item.content.text || "").trim() || (item.content.parts || []).some((part) => String(part?.text || "").trim())),
);
const toolCalls = (items, name) => items.filter((item) => item?.type === "tool_call" && item?.content?.tool_name === name);
const manifestValue = (bundle) => bundle?.manifest && typeof bundle.manifest === "object" ? bundle.manifest : bundle;

function verifyQuestionAnswering({ items }) {
  const messages = completedAssistantMessages(items);
  assert.ok(messages.length > 0, "question_answering: completed non-empty assistant message is missing");
  return { assistant_messages:messages.length };
}
function verifyReadOnlyTool({ items }) {
  const calls = toolCalls(items, "run_glob");
  assert.equal(calls.length, 1, "read_only_tool: run_glob must occur exactly once");
  assert.equal(calls[0].status, "completed", "read_only_tool: run_glob did not complete");
  assert.ok(calls[0].content?.result != null, "read_only_tool: tool result evidence is missing");
  return { tool_name:"run_glob", tool_calls:calls.length, assistant_messages:verifyQuestionAnswering({ items }).assistant_messages };
}
function verifyKnowledge({ items }) {
  const calls = toolCalls(items, "retrieve_from_memory");
  assert.equal(calls.length, 1, "knowledge: configured knowledge search must occur exactly once");
  assert.equal(calls[0].status, "completed", "knowledge: retrieval call did not complete");
  assert.ok(calls[0].content?.result != null, "knowledge: retrieval result evidence is missing");
  const messages = completedAssistantMessages(items);
  const text = messages.map((item) => `${item.content?.text || ""} ${(item.content?.parts || []).map((part) => part?.text || "").join(" ")}`).join(" ");
  assert.match(text, /P3-KB-42/, "knowledge: assistant did not attribute the retrieved source marker");
  return { tool_name:"retrieve_from_memory", knowledge_calls:calls.length, source_attributions:1, assistant_messages:messages.length };
}
function verifyImageInput({ items, inspection, manifest }) {
  const value = manifestValue(manifest);
  const attachments = Array.isArray(value?.attachments) ? value.attachments : [];
  assert.ok(attachments.length > 0, "image_input: Manifest attachment evidence is missing");
  assert.ok(attachments.every((item) => item && (item.sha256 || item.ref_sha256)), "image_input: attachment digest evidence is missing");
  assert.ok(Array.isArray(inspection?.run?.attachment_refs) && inspection.run.attachment_refs.length > 0,
    "image_input: Run attachment reference is missing");
  const messages = completedAssistantMessages(items);
  const text = messages.map((item) => `${item.content?.text || ""} ${(item.content?.parts || []).map((part) => part?.text || "").join(" ")}`).join(" ");
  assert.match(text, /P3-TRACE-42/i, "image_input: assistant did not identify the error code rendered in the image");
  return { attachments:attachments.length, assistant_messages:messages.length, recognized_error_code:true };
}
function verifyImageBytes(bytes, mimeType) {
  assert.ok(bytes.length > 0, "image_output: Artifact is empty");
  const mime = String(mimeType || "").toLowerCase();
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const gif = bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
  const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const bmp = bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM";
  const tiff = bytes.length >= 4 && (["II*\u0000", "MM\u0000*"].includes(bytes.subarray(0, 4).toString("binary")));
  const avif = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && /^(?:avif|avis)$/.test(bytes.subarray(8, 12).toString("ascii"));
  const svg = mime === "image/svg+xml" && /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.toString("utf8", 0, Math.min(bytes.length, 4096)));
  assert.ok(png || jpeg || gif || webp || bmp || tiff || avif || svg, `image_output: Artifact bytes do not match a supported image format (${mime || "unknown"})`);
}

function selectVisionModels(payload) {
  const available = new Set((Array.isArray(payload?.data) ? payload.data : [])
    .map((item) => String(item?.id || "").trim()).filter(Boolean));
  // Keep this list restricted to models whose vision capability is declared
  // in the production model registry. The remote catalog proves availability;
  // the local registry proves that the Agent adapter will encode images.
  // Prefer the OpenAI-compatible route because it is shared with the normal
  // Desktop model path. Keep Claude as a fallback for accounts that expose it.
  const selected = [
    "openai/gpt-5.4", "google/gemini-3-flash-preview",
    "gpt-5.4", "gemini-3-flash-preview",
    "anthropic/claude-sonnet-4-6", "claude-sonnet-4-6",
  ].filter((id) => available.has(id));
  assert.ok(selected.length, "The OIDC account exposes no OpenDrSai-verified vision model for image-input acceptance.");
  return selected;
}

if (process.argv.includes("--self-test")) {
  const liveSource = readFileSync(new URL(import.meta.url), "utf8");
  const desktopMainSource = readFileSync(resolve(repoRoot, "apps/desktop/windows/src/main/index.ts"), "utf8");
  for (const suffix of ["GATEWAY_URL", "ACCESS_TOKEN", "WORKSPACE_PATH", "AGENT_DEFINITION", "IMAGE_INPUT_REF"]) {
    assert.ok(!liveSource.includes(["OPENDRSAI", "LIVE", suffix].join("_")), `duplicate live configuration remains: ${suffix}`);
  }
  assert.ok(!liveSource.includes(["safe", "Storage"].join("")), "live verifier must not decrypt the App credential file");
  assert.ok(desktopMainSource.includes('child.stdin.end(auth.accessToken, "utf8")'),
    "Desktop must delegate the current OIDC credential through the child stdin pipe");
  assert.ok(!desktopMainSource.includes(["OPENDRSAI", "LIVE", "ACCESS_TOKEN"].join("_")),
    "Desktop must not copy the OIDC credential into an environment variable");
  const assistant = { id:"m1", type:"message", status:"completed", content:{ role:"assistant", text:"answer", citations:[{ citation_id:"c1" }] } };
  const workspaceCall = { id:"t1", type:"tool_call", status:"completed", content:{ tool_name:"run_glob", result:{ ok:true } } };
  const knowledgeCall = { id:"t2", type:"tool_call", status:"completed", content:{ tool_name:"retrieve_from_memory", result:{ documents:["d1"] } } };
  assert.deepEqual(verifyQuestionAnswering({ items:[assistant] }), { assistant_messages:1 });
  assert.equal(verifyReadOnlyTool({ items:[workspaceCall, assistant] }).tool_calls, 1);
  assert.throws(() => verifyReadOnlyTool({ items:[workspaceCall, { ...workspaceCall, id:"t3" }, assistant] }), /exactly once/);
  assert.equal(verifyKnowledge({ items:[knowledgeCall, { ...assistant, content:{ ...assistant.content, text:"Source P3-KB-42 says Session contains Runs." } }] }).source_attributions, 1);
  assert.throws(() => verifyKnowledge({ items:[knowledgeCall, assistant] }), /source marker/);
  verifyImageInput({ items:[{ ...assistant, content:{ ...assistant.content, text:"The image shows P3-TRACE-42." } }], inspection:{ run:{ attachment_refs:["image.png"] } }, manifest:{ manifest:{ attachments:[{ ref_sha256:"a".repeat(64) }] } } });
  verifyImageBytes(Buffer.from([137,80,78,71,13,10,26,10]), "image/png");
  assert.throws(() => verifyImageBytes(Buffer.from("not an image"), "image/png"), /supported image format/);
  assert.deepEqual(selectVisionModels({ data:[{ id:"gpt-5.4" }, { id:"gemini-3-flash-preview" }] }), ["gpt-5.4", "gemini-3-flash-preview"]);
  assert.deepEqual(selectVisionModels({ data:[{ id:"anthropic/claude-sonnet-4-6" }, { id:"openai/gpt-5.4" }] }), ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"]);
  assert.deepEqual(selectVisionModels({ data:[{ id:"claude-sonnet-4-6" }] }), ["claude-sonnet-4-6"]);
  assert.throws(() => selectVisionModels({ data:[{ id:"deepseek-v4-pro" }] }), /verified vision model/);
  console.log("Phase 3 real-model evidence verifier self-test passed.\n");
  process.exit(0);
}

let liveElectronApp = null;
const delegatedOidc = process.argv.includes("--delegated-oidc");
const invocationNonce = process.argv.find((value) => value.startsWith("--invocation-nonce="))?.slice("--invocation-nonce=".length) || null;
let acceptanceStage = "bootstrap";
let acceptanceDiagnostics = {};
try {
let selectedHome;
let accessToken;
if (delegatedOidc) {
  acceptanceStage = "oidc_pipe";
  assert.match(invocationNonce || "", /^[0-9a-f-]{36}$/i, "The delegated OIDC invocation nonce is invalid.");
  selectedHome = resolve(process.env.DRSAI_HOME || join(process.env.USERPROFILE || "", ".drsai"));
  accessToken = await readDelegatedAccessToken();
} else {
  const { app, shell } = await import("electron");
  liveElectronApp = app;
  await app.whenReady();
  selectedHome = resolve(app.getPath("userData"), "..");
  const nonce = randomUUID();
  const protocol = basename(selectedHome) === ".drsai-dev" ? "opendrsai-dev" : "opendrsai";
  await shell.openExternal(`${protocol}://phase3-live-acceptance?nonce=${encodeURIComponent(nonce)}`);
  const delegatedEvidence = await waitForDelegatedEvidence(nonce);
  assert.equal(delegatedEvidence.schema_version, "opendrsai.agent-runtime-phase3-live-model-result/1",
    `Delegated Phase 3 acceptance failed: ${delegatedEvidence.error_code || "invalid_evidence"}`);
  assert.equal(delegatedEvidence.source_digest, sourceDigest(), "Delegated Phase 3 evidence source digest is stale.");
  assert.equal(delegatedEvidence.cases?.length, 5, "Delegated Phase 3 evidence is incomplete.");
  console.log(`Phase 3 real-model nightly smoke passed: ${evidencePath}\n`);
  app.quit();
  process.exit(0);
}
acceptanceStage = "runtime_discovery";
const discovered = await discoverRunningApp(selectedHome);
acceptanceStage = "runtime_source_identity";
if (discovered.runtimeIdentity.runtime_source_digest !== digestFiles(runtimeSourceFiles)) {
  throw new Error(`The running ${basename(discovered.home)} Gateway has not loaded the current runtime source. Restart OpenDrSai Desktop before live acceptance.`);
}
const oidcClaims = decodeClaims(accessToken);
acceptanceStage = "oidc_claims";
const principal = process.env.OPENDRSAI_LIVE_PRINCIPAL_ID?.trim() || decodeSubject(accessToken);
assert.match(String(oidcClaims.iss || ""), /^https:\/\//, "The App OIDC token has no HTTPS issuer identity.");
const baseUrl = discovered.baseUrl;
const gatewayToken = discovered.gatewayToken;
const backendId = process.env.OPENDRSAI_LIVE_BACKEND_ID?.trim() || "opendrsai";
const model = process.env.OPENDRSAI_LIVE_MODEL?.trim();
assert.ok(!/(?:controlled|deterministic|fixture|mock)/i.test(`${backendId} ${model || ""}`),
  "P3 nightly smoke requires a real account-backed Backend/model, not a controlled or fixture implementation");
const headers = { Authorization:`Bearer ${accessToken}`, "X-OpenDrSai-Auth-Mode":"oidc", "X-OpenDrSai-Principal":principal, ...(gatewayToken ? { "X-OpenDrSai-Gateway-Token":gatewayToken } : {}) };

function oidcModelBaseUrl(issuer) {
  if (issuer === "https://ai-dev.ihep.ac.cn/api") return "https://ai-dev.ihep.ac.cn/apiv2/v1";
  if (issuer === "https://ai.ihep.ac.cn/api") return "https://ai.ihep.ac.cn/apiv2/v1";
  throw new Error("The OIDC issuer has no trusted model endpoint mapping.");
}

function safeDiagnosticText(value) {
  const text = String(value || "").trim().slice(0, 200);
  return /^[\w\s.,:;()/_-]{1,200}$/.test(text) ? text : null;
}

async function probeVisionTransport(modelId, imageDataUri) {
  if (modelId.startsWith("anthropic/")) {
    const endpoint = `${oidcModelBaseUrl(String(oidcClaims.iss)).replace(/\/v1$/, "")}/anthropic/v1/messages`;
    const base64 = imageDataUri.replace(/^data:image\/png;base64,/, "");
    const variants = [
      { id:"text", content:"Reply with OK." },
      { id:"image", content:[{ type:"text", text:"Read the error code." }, { type:"image", source:{ type:"base64", media_type:"image/png", data:base64 } }] },
    ];
    const results = [];
    for (const variant of variants) {
      const response = await fetch(endpoint, {
        method:"POST", redirect:"error", signal:AbortSignal.timeout(45_000),
        headers:{ "x-api-key":accessToken, "anthropic-version":"2023-06-01", "Content-Type":"application/json" },
        body:JSON.stringify({ model:modelId, messages:[{ role:"user", content:variant.content }], max_tokens:32, stream:false }),
      });
      const payload = await response.json().catch(() => ({}));
      const detail = payload?.error && typeof payload.error === "object" ? payload.error
        : payload?.detail && typeof payload.detail === "object" ? payload.detail : {};
      const errorMessage = safeDiagnosticText(detail.message);
      results.push({ id:variant.id, status:response.status, ok:response.ok,
        error_code:String(detail.code || detail.type || (response.ok ? "none" : `http_${response.status}`)).slice(0, 80),
        ...(errorMessage ? { error_message:errorMessage } : {}) });
    }
    return { model:modelId, wire_api:"anthropic", variants:results };
  }
  const endpoint = `${oidcModelBaseUrl(String(oidcClaims.iss))}/chat/completions`;
  const variants = [
    { id:"text", content:"Reply with OK." },
    { id:"image", content:[{ type:"text", text:"Read the error code." }, { type:"image_url", image_url:{ url:imageDataUri } }] },
  ];
  const results = [];
  for (const variant of variants) {
    const response = await fetch(endpoint, {
      method:"POST", redirect:"error", signal:AbortSignal.timeout(45_000),
      headers:{ Authorization:`Bearer ${accessToken}`, "Content-Type":"application/json" },
      body:JSON.stringify({ model:modelId, messages:[{ role:"user", content:variant.content }], max_tokens:32, stream:false }),
    });
    const payload = await response.json().catch(() => ({}));
    const detail = payload?.error && typeof payload.error === "object" ? payload.error
      : payload?.detail && typeof payload.detail === "object" ? payload.detail : {};
    const errorMessage = safeDiagnosticText(
      detail.message || payload?.message || (typeof payload?.detail === "string" ? payload.detail : ""),
    );
    results.push({ id:variant.id, status:response.status, ok:response.ok,
      error_code:String(detail.code || detail.type || (response.ok ? "none" : `http_${response.status}`)).slice(0, 80),
      ...(errorMessage ? { error_message:errorMessage } : {}) });
  }
  return { model:modelId, wire_api:"openai", variants:results };
}
const request = async (method, path, body, idempotencyKey) => {
  const response = await fetch(`${baseUrl}${path}`, { method, headers:{ ...headers, "Content-Type":"application/json", ...(idempotencyKey ? { "Idempotency-Key":idempotencyKey } : {}) }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = value?.detail || value?.error || {};
    throw Object.assign(new Error(`${path} failed (${response.status}): ${detail?.code || "request_failed"}`), {
      code:String(detail?.code || "request_failed"), retryable:detail?.retryable === true,
    });
  }
  return value;
};
const get = (path) => request("GET", path);
const post = (path, body, key) => request("POST", path, body, key);

async function discoverRunningApp(selectedHome) {
  const homes = [resolve(selectedHome)];
  const ports = [...new Set([
    process.env.OPENDRSAI_GATEWAY_PORT, process.env.OPENDRSAI_DEV_GATEWAY_PORT,
    process.env.DRSAI_API_PORT, "28642", "18642",
  ].filter((value) => /^\d{1,5}$/.test(String(value))).map(Number).filter((value) => value > 0 && value < 65536))];
  const matches = [];
  for (const home of homes) {
    const tokenPath = join(home, "runtime", "instance-token");
    if (!existsSync(tokenPath)) continue;
    const storedToken = readFileSync(tokenPath, "utf8").trim();
    const gatewayToken = storedToken;
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(gatewayToken)) continue;
    const urls = ports.map((port) => `http://127.0.0.1:${port}`);
    for (const baseUrl of urls) {
      try {
        const response = await fetch(`${baseUrl}/v1/runtime`, {
          headers:{ "X-OpenDrSai-Gateway-Token":gatewayToken }, redirect:"error", signal:AbortSignal.timeout(2500),
        });
        if (response.ok) matches.push({ home, baseUrl, gatewayToken, runtimeIdentity:await response.json() });
      } catch { /* try the next App-owned profile/port */ }
    }
  }
  const unique = [...new Map(matches.map((item) => [`${item.home}\0${item.baseUrl}`, item])).values()];
  assert.ok(unique.length > 0,
    "No running App-owned Gateway was found. Start OpenDrSai Desktop; development uses ~/.drsai-dev:28642 and production uses ~/.drsai:18642.");
  assert.equal(unique.length, 1,
    "Multiple App-owned Gateways are running. Set DRSAI_HOME to select the existing development or production profile.");
  return unique[0];
}

function selectWorkspacePath(home) {
  const statePath = join(home, "desktop", "workspaces.json");
  assert.ok(existsSync(statePath), `The active ${basename(home)} App profile has no Workspace state.`);
  const rows = JSON.parse(readFileSync(statePath, "utf8"));
  assert.ok(Array.isArray(rows), "Desktop Workspace state is invalid.");
  const candidates = rows.filter((item) => item?.trusted === true && typeof item.path === "string" && existsSync(item.path))
    .sort((left, right) => Date.parse(right.lastOpenedAt || right.updatedAt || 0) - Date.parse(left.lastOpenedAt || left.updatedAt || 0));
  const currentRepository = candidates.find((item) => resolve(item.path) === repoRoot);
  const selected = currentRepository || candidates[0];
  assert.ok(selected, "Desktop has no trusted, available Workspace. Open a Workspace in the App first.");
  return resolve(selected.path);
}

function selectAgentDefinition(payload, backend) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const candidates = items.filter((item) => item?.backend_id === backend && item?.backend_health === "healthy");
  const selected = candidates.find((item) => item.definition_id === "opendrsai") || candidates[0];
  assert.ok(selected, `The running App exposes no healthy ${backend} Agent Definition.`);
  const id = String(selected.definition_id || ""); const version = String(selected.version || "");
  assert.ok(id && version, "The selected App Agent Definition has no immutable id/version.");
  return id.includes("@") ? id : `${id}@${version}`;
}

async function prepareImageInput(workspacePath) {
  const root = resolve(workspacePath); const folder = join(root, ".opendrsai", "attachments", "p3-live");
  mkdirSync(folder, { recursive:true });
  const target = join(folder, "p3-trace-error.png");
  const { PNG } = await import("pngjs");
  const png = new PNG({ width:600, height:140 });
  png.data.fill(255);
  for (let x = 8; x < 592; x += 1) for (const y of [8,9,130,131]) setPixel(png, x, y, 190, 20, 20);
  for (let y = 8; y < 132; y += 1) for (const x of [8,9,590,591]) setPixel(png, x, y, 190, 20, 20);
  drawText(png, 28, 52, "ERROR P3-TRACE-42", 5);
  const bytes = PNG.sync.write(png); writeFileSync(target, bytes, { mode:0o600 });
  const reference = relative(root, target).replace(/\\/g, "/");
  return { reference, data_uri:`data:image/png;base64,${bytes.toString("base64")}`, resource:{ protocol:"oaep.input/1", resource_id:"p3-live-image", kind:"file",
    name:"p3-trace-error.png", permission:"read", status:"encoded", reference, mime:"image/png",
    size_bytes:bytes.length, sha256:sha256(bytes) } };
}

function setPixel(png, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const offset = (y * png.width + x) * 4; png.data[offset] = r; png.data[offset + 1] = g; png.data[offset + 2] = b; png.data[offset + 3] = 255;
}
const FONT = {
  "A":["01110","10001","10001","11111","10001","10001","10001"], "C":["01111","10000","10000","10000","10000","10000","01111"],
  "E":["11111","10000","10000","11110","10000","10000","11111"], "O":["01110","10001","10001","10001","10001","10001","01110"],
  "P":["11110","10001","10001","11110","10000","10000","10000"], "R":["11110","10001","10001","11110","10100","10010","10001"],
  "T":["11111","00100","00100","00100","00100","00100","00100"], "2":["01110","10001","00001","00010","00100","01000","11111"],
  "3":["11110","00001","00001","01110","00001","00001","11110"], "4":["00010","00110","01010","10010","11111","00010","00010"],
  "-":["00000","00000","00000","11111","00000","00000","00000"], " ":["00000","00000","00000","00000","00000","00000","00000"],
};
function drawText(png, startX, startY, text, scale) {
  let cursor = startX;
  for (const character of text) {
    const glyph = FONT[character]; assert.ok(glyph, `Missing fixture glyph ${character}`);
    for (let row = 0; row < glyph.length; row += 1) for (let column = 0; column < glyph[row].length; column += 1) {
      if (glyph[row][column] !== "1") continue;
      for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) setPixel(png, cursor + column * scale + dx, startY + row * scale + dy, 15, 15, 15);
    }
    cursor += 6 * scale;
  }
}

async function collectInspection(runId) {
  let merged = null; let cursor = null; const seen = new Set();
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
    const query = new URLSearchParams({ limit:"500", ...(cursor ? { timeline_cursor:cursor } : {}) });
    const page = await get(`/v1/runs/${runId}/inspection?${query}`);
    assert.ok(Array.isArray(page.timeline), `${runId}: Inspection page has no timeline`);
    if (!merged) merged = { ...page, timeline:[] };
    for (const item of page.timeline) {
      assert.ok(typeof item?.id === "string" && item.id, `${runId}: Inspection Item id is missing`);
      assert.ok(!seen.has(item.id), `${runId}: Inspection pagination returned duplicate Item ${item.id}`);
      seen.add(item.id); merged.timeline.push(item);
    }
    const window = page.page || {}; const next = window.next_cursor;
    if (!window.has_more) { merged.page = { ...window, has_more:false, next_cursor:null, complete:true }; return merged; }
    assert.ok(typeof next === "string" && next && next !== cursor, `${runId}: Inspection pagination did not advance`);
    cursor = next;
  }
  throw new Error(`${runId}: Inspection exceeded pagination safety limit`);
}
async function readArtifact(workspaceId, artifact) {
  const owop = (operation, params) => post("/v1/owop", {
    version:"1.0", request_id:randomUUID(), correlation_id:randomUUID(), workspace_id:workspaceId, operation, params,
  });
  const artifactId = artifact?.content?.artifact_id;
  assert.ok(artifactId, "image_output: Artifact id is missing");
  const metadataResponse = await owop("artifact.metadata", { artifact_id:artifactId });
  assert.equal(metadataResponse.ok, true, "image_output: Artifact metadata is unavailable");
  const metadata = metadataResponse.result;
  assert.ok(Number.isInteger(metadata?.size) && metadata.size > 0 && metadata.size <= 25 * 1024 * 1024,
    "image_output: Artifact size is invalid or exceeds the 25 MB nightly bound");
  assert.match(metadata.sha256 || "", /^[0-9a-f]{64}$/, "image_output: Artifact digest is missing");
  assert.ok(/^image\//.test(metadata.mime_type || ""), "image_output: Artifact MIME type is not image/*");
  const chunks = []; let offset = 0;
  while (offset < metadata.size) {
    const chunkResponse = await owop("artifact.chunk", { artifact_id:artifactId, offset, length:Math.min(1024 * 1024, metadata.size - offset) });
    assert.equal(chunkResponse.ok, true, "image_output: Artifact content is unavailable");
    const chunk = chunkResponse.result; const bytes = Buffer.from(chunk.content_base64 || "", "base64");
    assert.equal(bytes.length, chunk.length, "image_output: Artifact chunk length is inconsistent");
    assert.ok(bytes.length > 0, "image_output: Artifact chunk is empty");
    chunks.push(bytes); offset += bytes.length;
    if (chunk.eof) break;
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, metadata.size, "image_output: Artifact content is incomplete");
  assert.equal(sha256(bytes), metadata.sha256, "image_output: Artifact content digest is inconsistent");
  assert.equal(artifact.content?.sha256, metadata.sha256, "image_output: OAEP and Artifact metadata digests differ");
  verifyImageBytes(bytes, metadata.mime_type);
  return { artifact_id:artifactId, mime_type:metadata.mime_type, size:metadata.size, sha256:metadata.sha256 };
}

acceptanceStage = "scenario_setup";
const workspacePath = selectWorkspacePath(discovered.home);
const imageInput = await prepareImageInput(workspacePath);
const definitions = await get("/v1/agent-definitions");
const agentDefinition = selectAgentDefinition(definitions, backendId);
const visionCandidates = selectVisionModels(await get("/v1/models"));
acceptanceStage = "vision_transport_probe";
const visionTransports = [];
let visionModel = null;
for (const candidate of visionCandidates) {
  const transport = await probeVisionTransport(candidate, imageInput.data_uri);
  visionTransports.push(transport);
  const textOk = transport.variants.some((item) => item.ok && /text$/.test(item.id));
  const imageOk = transport.variants.some((item) => item.ok && /image$/.test(item.id));
  if (textOk && imageOk) { visionModel = candidate; break; }
}
acceptanceDiagnostics = { vision_transports:visionTransports };
assert.ok(visionModel, "No OIDC vision model passed both minimal text and image transport probes.");
const cases = [
  { id:"question_answering", prompt:"Reply briefly to: hello.", verify:verifyQuestionAnswering },
  { id:"read_only_tool", prompt:"Call run_glob exactly once with pattern README.md and the default workspace root, then briefly report whether README.md was found. Do not call any other tool.", verify:verifyReadOnlyTool },
  { id:"knowledge", prompt:"Source record P3-KB-42 states: an OpenDrSai Session groups a conversation, while each execution attempt is a distinct Run. Call retrieve_from_memory exactly once with question P3-KB-42. Using its result, explain the relationship and explicitly attribute source marker P3-KB-42. Do not call another tool.", verify:verifyKnowledge },
  { id:"image_input", model:visionModel, prompt:"Describe the attached image and identify the exact visible error code.", attachments:[imageInput.reference], resources:[imageInput.resource], verify:verifyImageInput },
  { id:"image_output", prompt:"Generate one small image illustrating an observable Agent Runtime, save it under .opendrsai/p3-live, and publish it as an Artifact.", verify:async ({ items, workspaceId }) => {
    const artifacts = items.filter((item) => item?.type === "artifact" && /^image\//.test(item?.content?.mime_type || ""));
    assert.equal(artifacts.length, 1, "image_output: exactly one image Artifact is required");
    return { artifact:await readArtifact(workspaceId, artifacts[0]), assistant_messages:verifyQuestionAnswering({ items }).assistant_messages };
  } },
];

const startedAt = new Date().toISOString(); const initialSourceState = captureSourceState();
if (backendId === "codex") {
  const account = await get(`/v1/agent-backends/${encodeURIComponent(backendId)}/account?refresh=true`);
  assert.equal(account.logged_in, true, `real ${backendId} account is not logged in`);
}
const workspace = await post("/v1/workspaces", { path:workspacePath, display_name:"P3 live model nightly" });
const results = [];
for (const testCase of cases) {
  let completed = false;
  for (let attempt = 1; attempt <= 2 && !completed; attempt += 1) {
    try {
      acceptanceStage = `case:${testCase.id}:attempt:${attempt}`;
      const executionModel = testCase.model || model;
      const session = await post("/v1/sessions", { workspace_id:workspace.workspace_id, title:`P3 nightly: ${testCase.id}`, agent_definition:agentDefinition, backend_id:backendId });
      if (testCase.seedPrompt) {
        const seed = await post(`/v1/sessions/${session.session_id}/runs`, { agent_definition:agentDefinition }, `p3-live:${testCase.id}:seed:${randomUUID()}`);
        const seeded = await post(`/v1/runs/${seed.run_id}/execute`, { prompt:testCase.seedPrompt, user_id:principal, ...(executionModel ? { model:executionModel } : {}), metadata:{ source_client:"windows", acceptance_scenario:`M39-04:${testCase.id}:seed` } });
        assert.equal(seeded.run?.status, "completed", `${testCase.id}: knowledge seed Run did not complete`);
      }
      const run = await post(`/v1/sessions/${session.session_id}/runs`, { agent_definition:agentDefinition }, `p3-live:${testCase.id}:${randomUUID()}`);
      const execution = await post(`/v1/runs/${run.run_id}/execute`, { prompt:testCase.prompt, user_id:principal, ...(executionModel ? { model:executionModel } : {}), metadata:{ source_client:"windows", attachment_refs:testCase.attachments || [], input_resources:testCase.resources || [], acceptance_scenario:`M39-04:${testCase.id}` } });
      const terminalRun = execution.run?.status ? execution.run : await get(`/v1/runs/${run.run_id}`);
      assert.equal(terminalRun.status, "completed", `${testCase.id}: Run did not complete`);
      const inspection = await collectInspection(run.run_id);
      assert.equal(inspection.run?.status, "completed", `${testCase.id}: Inspection is not terminal`);
      assert.equal(inspection.page?.complete, true, `${testCase.id}: Inspection evidence is incomplete`);
      const manifest = await get(`/v1/runs/${run.run_id}/reproduction-manifest`);
      const manifestDigest = manifest.manifest_digest || manifest.safe_manifest_digest;
      assert.match(manifestDigest || "", /^[0-9a-f]{64}$/, `${testCase.id}: Manifest digest is missing`);
      const behavior = await testCase.verify({ items:inspection.timeline, inspection, manifest, workspaceId:workspace.workspace_id });
      results.push({ id:testCase.id, run_id:run.run_id, session_id:session.session_id, status:terminalRun.status, model:executionModel || null, manifest_digest:manifestDigest, inspection_digest:sha256(JSON.stringify(inspection)), timeline_item_count:inspection.timeline.length, behavior, attempt });
      completed = true;
    } catch (error) {
      if (attempt < 2 && error?.code === "upstream_unavailable" && error?.retryable === true) continue;
      throw error;
    }
  }
}
assert.deepEqual(results.map((item) => item.id), ["question_answering", "read_only_tool", "knowledge", "image_input", "image_output"]);
acceptanceStage = "source_integrity";
assert.deepEqual(captureSourceState(), initialSourceState, "live-model source state changed while the nightly smoke was running");
const evidence = { schema_version:"opendrsai.agent-runtime-phase3-live-model-result/1", generated_at:new Date().toISOString(), started_at:startedAt, invocation_nonce:invocationNonce, ...initialSourceState, source_files:sourceFiles, runtime_source_digest:discovered.runtimeIdentity.runtime_source_digest, account_backed:true, auth_mode:"oidc", oidc_issuer:String(oidcClaims.iss), controlled_model:false, simulated_external_service:false, app_profile:basename(discovered.home), gateway_origin:baseUrl, workspace_id:workspace.workspace_id, agent_definition:agentDefinition, backend_id:backendId, model:model || null, cases:results, proof_scope:["real_backend_account","real_model_execute","complete_oaep_inspection","manifest","exact_tool_count","knowledge_result_and_source_attribution","capability_matched_vision_model","image_input_and_response","readable_image_artifact"] };
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Phase 3 real-model nightly smoke passed: ${evidencePath}\n`);
if (liveElectronApp) liveElectronApp.quit();

async function readDelegatedAccessToken() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    assert.ok(length <= 32_768, "The delegated OIDC credential exceeds the bounded input size.");
    chunks.push(bytes);
  }
  const token = Buffer.concat(chunks).toString("utf8").trim();
  assert.ok(token && token.split(".").length === 3, "The Desktop did not provide a valid delegated OIDC credential.");
  return token;
}

async function waitForDelegatedEvidence(nonce) {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    if (existsSync(evidencePath)) {
      try {
        const value = JSON.parse(readFileSync(evidencePath, "utf8"));
        if (value?.invocation_nonce === nonce) return value;
      } catch { /* wait for the atomic-enough complete write */ }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error("The running Desktop did not complete delegated Phase 3 live acceptance within 12 minutes.");
}

function decodeSubject(token) {
  try { const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); assert.equal(typeof payload.sub, "string"); return payload.sub; }
  catch { throw new Error("OPENDRSAI_LIVE_PRINCIPAL_ID is required when the access token subject cannot be decoded"); }
}
function decodeClaims(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { throw new Error("The stored App OIDC access token is not a valid JWT"); }
}
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (delegatedOidc && invocationNonce) {
    writeFileSync(evidencePath, `${JSON.stringify({
      schema_version:"opendrsai.agent-runtime-phase3-live-model-failure/1",
      generated_at:new Date().toISOString(), invocation_nonce:invocationNonce,
      failure_stage:acceptanceStage,
      error_code:error?.code || error?.name || "live_acceptance_failed",
      ...(Object.keys(acceptanceDiagnostics).length ? { diagnostics:acceptanceDiagnostics } : {}),
      ...(error?.code === "ERR_ASSERTION" ? { failure_reason:String(error.message || "assertion_failed").slice(0, 240) } : {}),
    }, null, 2)}\n`, "utf8");
  }
  console.error(`Phase 3 real-model nightly smoke blocked: ${message}`);
  if (liveElectronApp) liveElectronApp.exit(1);
  else process.exit(1);
}
