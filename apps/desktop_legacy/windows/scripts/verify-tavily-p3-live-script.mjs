import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const secretCanary = "oidc-secret-live-script-canary";
const temporary = mkdtempSync(join(tmpdir(), "opendrsai-tavily-p3-live-"));
const tokenFile = join(temporary, "token");
const evidenceFile = join(temporary, "evidence.json");
writeFileSync(tokenFile, secretCanary, { encoding: "utf8", mode: 0o600 });

let sequence = 0;
const requests = [];
const server = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, idempotency: request.headers["idempotency-key"], body });
  response.setHeader("content-type", "application/json");
  if (request.url === "/apiv2/v1/tools/web-search/capabilities") {
    response.end(JSON.stringify({ object: "list", status: "available", data: [{ id: "hepai/tavily-web-search-v1", functions: ["extract", "search"], available: true, enabled: true }] }));
    return;
  }
  sequence += 1;
  const functionName = request.url.endsWith("/extract") ? "extract" : "search";
  const data = functionName === "extract"
    ? { results: [{ url: "https://example.test/hepix", raw_content: "fixture document" }] }
    : { results: [{ title: "HEPiX", url: "https://example.test/hepix", content: "fixture", score: 0.9 }] };
  response.end(JSON.stringify({ object: "web_search.response", request_id: `req-${sequence}`, trace_id: `trace-${sequence}`, model: "hepai/tavily-web-search-v1", function: functionName, data }));
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
try {
  const port = server.address().port;
  const script = resolve(import.meta.dirname, "verify-live-tavily-p3.ps1");
  const result = await new Promise((resolvePromise, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
      "-BaseUrl", `http://127.0.0.1:${port}/apiv2/v1`, "-AccessTokenFile", tokenFile,
      "-IncludeExtract", "-StabilityRuns", "2", "-AllowBillableTests", "-EvidencePath", evidenceFile,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal((result.stdout + result.stderr).includes(secretCanary), false);
  const evidenceText = readFileSync(evidenceFile, "utf8");
  assert.equal(evidenceText.includes(secretCanary), false);
  const evidence = JSON.parse(evidenceText);
  assert.equal(evidence.schema, "opendrsai.tavily-p3-live-acceptance/1");
  assert.equal(evidence.capability_status, "available");
  assert.equal(evidence.extract_completed, true);
  assert.equal(evidence.stability_runs, 2);
  assert.equal(evidence.request_count, 4);
  assert.equal(evidence.unique_request_ids, 4);
  assert.equal(requests.length, 5);
  assert(requests.every((item) => item.authorization === `Bearer ${secretCanary}`));
  const searchRequests = requests.filter((item) => item.url.endsWith("/search"));
  assert.equal(searchRequests.length, 3);
  assert(searchRequests.every((item) => item.idempotency && item.body.model === "hepai/tavily-web-search-v1"));
  assert(searchRequests.every((item) => item.body.arguments.search_depth === "basic" && item.body.arguments.include_raw_content === false && item.body.arguments.include_answer === false));
  assert.equal(JSON.stringify(requests.map((item) => item.body)).includes("api_key"), false);
  console.log("Tavily P3 live acceptance script passed against fake DDF (capability + search + extract + stability + redaction)." );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(temporary, { recursive: true, force: true });
}
