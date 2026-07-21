import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CRC_TABLE=Array.from({length:256},(_,value)=>{let crc=value; for(let bit=0;bit<8;bit+=1) crc=(crc&1)?(0xedb88320^(crc>>>1)):(crc>>>1); return crc>>>0;});
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const runId = process.env.OPENDRSAI_C4_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_C4_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf]) if (!existsSync(path)) throw new Error(`C4 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf); const sourceHash = sha256(source);
assert(source.length === 7_664_262 && sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF fixture changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-c4-"));
const evidenceRoot = join(root, "release", "product-evidence", "c4-material-suggestions", runId);
mkdirSync(evidenceRoot, { recursive: true });
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const scenarios = {
  d2: { workspace: join(testRoot, "D2 最新数据"), files: ["latest-data-2026.csv", "最新测量.xlsx"] },
  d1: { workspace: join(testRoot, "D1 CERN 演示材料"), files: ["WLCG-20260715-WLCG-talk-IHEP-visit.pdf"] },
  d4: { workspace: join(testRoot, "D4 报告更新材料"), files: ["旧报告-2024.docx", "latest-data-2026.csv", "结果图.png", "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"] },
};
for (const value of Object.values(scenarios)) mkdirSync(value.workspace, { recursive: true });
copyFileSync(sourcePdf, join(scenarios.d1.workspace, scenarios.d1.files[0]));
writeFileSync(join(scenarios.d2.workspace, scenarios.d2.files[0]), "metric,previous,current\nsample_size,100,160\nmean,42,47\n", "utf8");
writeFileSync(join(scenarios.d2.workspace, scenarios.d2.files[1]), createXlsx());
writeFileSync(join(scenarios.d4.workspace, scenarios.d4.files[0]), createDocx("2024 旧报告：样本量 100，平均值 42。"));
writeFileSync(join(scenarios.d4.workspace, scenarios.d4.files[1]), "metric,previous,current\nsample_size,100,160\nmean,42,47\n", "utf8");
writeFileSync(join(scenarios.d4.workspace, scenarios.d4.files[2]), pixel);
copyFileSync(sourcePdf, join(scenarios.d4.workspace, scenarios.d4.files[3]));

const requests = [];
const httpCalls = [];
const port = 19000 + (process.pid % 1000);
const server = createServer(async (req, res) => {
  httpCalls.push({ method: req.method, url: req.url, at: Date.now() });
  if (req.url === "/health") return json(res, { status: "ok" });
  if (req.url === "/v1/models") return json(res, { object: "list", data: [{ id: "drsai", object: "model" }] });
  if (req.url === "/v1/config/cli" || req.url === "/v1/models/config") return json(res, {});
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    const body = await readJsonBody(req); requests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "C4 真实任务已创建：材料、用户修改和任务要求均已收到。" }, index: 0 }] })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end(); return;
  }
  res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "not found" }));
});

try {
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveListen); });
  const results = [];
  for (const [scenario, fixture] of Object.entries(scenarios)) {
    const before = requests.length;
    const evidenceDir = join(evidenceRoot, scenario); const resultPath = join(evidenceDir, `packaged-c4-${scenario}-result.json`);
    const appHome = join(testRoot, `app-home-${scenario}`); const userData = join(testRoot, `user-data-${scenario}`);
    mkdirSync(evidenceDir, { recursive: true }); mkdirSync(appHome, { recursive: true }); mkdirSync(userData, { recursive: true });
    const diagnosticPath = join(evidenceDir, "chat-diagnostic.log");
    rmSync(diagnosticPath, { force: true });
    const fixturePaths = fixture.files.map((name) => join(fixture.workspace, name));
    await runPackagedApp({ scenario, fixturePaths, workspace: fixture.workspace, appHome, userData, evidenceDir, resultPath });
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    assert(result.ok === true, `C4 ${scenario} packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
    const checks = Object.entries(result.checks || {});
    assert(checks.length >= 16 && checks.every(([, passed]) => passed === true), `C4 ${scenario} has failing checks.`);
    assert(requests.length === before + 1, `C4 ${scenario} expected exactly one real provider request.`);
    const serialized = JSON.stringify(requests.at(-1));
    writeFileSync(join(evidenceDir, "provider-request.json"), `${JSON.stringify(requests.at(-1), null, 2)}\n`);
    assert(serialized.includes("请使用中文，并在结尾列出材料来源"), `C4 ${scenario} provider missed the user's edit.`);
    assert(fixture.files.every((name) => serialized.includes(name)), `C4 ${scenario} provider missed material context.`);
    assert(serialized.includes("Material role:") && serialized.includes("Suggested use:"), `C4 ${scenario} provider missed role context.`);
    results.push({ scenario, checks: checks.length, requestBytes: Buffer.byteLength(serialized), suggestions: result.details.suggestions, resultPath, screenshotPath: result.details.screenshotPath });
  }
  assert(sha256(readFileSync(join(scenarios.d1.workspace, scenarios.d1.files[0]))) === sourceHash, "D1 CERN PDF changed.");
  assert(sha256(readFileSync(join(scenarios.d4.workspace, scenarios.d4.files[3]))) === sourceHash, "D4 CERN PDF changed.");
  const summary = { ok: true, runId, scenarios: results, providerRequests: requests.length, cernPdf: { sizeBytes: source.length, sha256: sourceHash } };
  writeFileSync(join(evidenceRoot, "packaged-c4-material-suggestions-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(evidenceRoot, "evidence-integrity.json"), `${JSON.stringify({ runId, scenarioCount: results.length, totalChecks: results.reduce((sum, item) => sum + item.checks, 0), providerRequests: requests.length, cernPdf: summary.cernPdf }, null, 2)}\n`);
  console.log(`C4 material suggestions passed ${results.length}/3 scenarios with ${results.reduce((sum, item) => sum + item.checks, 0)} packaged checks and ${requests.length} real task submissions.`);
} finally {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function runPackagedApp({ scenario, fixturePaths, workspace, appHome, userData, evidenceDir, resultPath }) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], { cwd: root, env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", NO_PROXY: "127.0.0.1,localhost", http_proxy: "", https_proxy: "", all_proxy: "", no_proxy: "127.0.0.1,localhost", DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_C4_MATERIAL_SUGGESTIONS: "1", OPENDRSAI_E2E_C4_SCENARIO: scenario, OPENDRSAI_E2E_C4_IMPORT_PATHS: fixturePaths.join("|"), OPENDRSAI_E2E_C4_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_DIAGNOSTIC_LOG_PATH: join(evidenceDir, "chat-diagnostic.log"), OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "90000", OPENDRSAI_PDF_PYTHON: resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"), OPENDRSAI_PDF_SCRIPT: resolve(root, "../../../cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py") }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error(`C4 ${scenario} timed out.`)); } }, 105_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); const diagnosticPath = join(evidenceDir, "chat-diagnostic.log"); code === 0 ? resolveRun() : reject(new Error(`C4 ${scenario} exited ${code}. HTTP calls: ${JSON.stringify(httpCalls)}${existsSync(diagnosticPath) ? ` Diagnostic: ${readFileSync(diagnosticPath, "utf8")}` : ""}${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON."}`)); });
  });
}
function json(res, value){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(value));}
function readJsonBody(req){return new Promise((resolveBody,reject)=>{let body="";req.setEncoding("utf8");req.on("data",chunk=>{body+=chunk;});req.on("end",()=>{try{resolveBody(JSON.parse(body||"{}"));}catch(error){reject(error);}});req.on("error",reject);});}
function createDocx(text){return createZip([["[Content_Types].xml",'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],["_rels/.rels",'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],["word/document.xml",`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`]]);}
function createXlsx(){return createZip([["[Content_Types].xml",'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],["_rels/.rels",'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],["xl/workbook.xml",'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="最新测量 2026" sheetId="1"/></sheets></workbook>']]);}
function createZip(entries){const records=[];const chunks=[];let offset=0;for(const [entryName,contents]of entries){const name=Buffer.from(entryName,"utf8");const data=Buffer.from(contents,"utf8");const crc=crc32(data);const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);chunks.push(header,name,data);records.push({name,data,crc,offset});offset+=30+name.length+data.length;}const centralOffset=offset;for(const record of records){const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x0800,8);header.writeUInt32LE(record.crc,16);header.writeUInt32LE(record.data.length,20);header.writeUInt32LE(record.data.length,24);header.writeUInt16LE(record.name.length,28);header.writeUInt32LE(record.offset,42);chunks.push(header,record.name);offset+=46+record.name.length;}const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(records.length,8);end.writeUInt16LE(records.length,10);end.writeUInt32LE(offset-centralOffset,12);end.writeUInt32LE(centralOffset,16);chunks.push(end);return Buffer.concat(chunks);}
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer)crc=(crc>>>8)^CRC_TABLE[(crc^byte)&0xff];return(crc^0xffffffff)>>>0;}
function sha256(value){return createHash("sha256").update(value).digest("hex").toUpperCase();}
function killTree(pid){if(pid)spawnSync("taskkill.exe",["/PID",String(pid),"/T","/F"],{stdio:"ignore",windowsHide:true});}
function assert(condition,message){if(!condition)throw new Error(message);}
