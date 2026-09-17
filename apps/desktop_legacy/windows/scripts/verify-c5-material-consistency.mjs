import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => { let crc = value; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1); return crc >>> 0; });
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const runId = process.env.OPENDRSAI_C5_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_C5_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf]) if (!existsSync(path)) throw new Error(`C5 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
assert(source.length === 7_664_262 && sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF fixture changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-c5-"));
const evidenceRoot = join(root, "release", "product-evidence", "c5-material-consistency", runId);
mkdirSync(evidenceRoot, { recursive: true });
const scenarios = {
  d3: {
    workspace: join(testRoot, "D3 多材料共识与争议"),
    files: ["study-a.md", "study-b.md", "study-c.md"],
  },
  d4: {
    workspace: join(testRoot, "D4 旧报告与最新结果"),
    files: ["旧报告-2024.docx", "latest-data-2026.csv", "result-chart.svg", "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"],
  },
};
for (const fixture of Object.values(scenarios)) mkdirSync(fixture.workspace, { recursive: true });
writeFileSync(join(scenarios.d3.workspace, scenarios.d3.files[0]), "# Study A\n\n短期记忆效果：改善\n实施成本：低\n", "utf8");
writeFileSync(join(scenarios.d3.workspace, scenarios.d3.files[1]), "# Study B\n\n短期记忆效果：改善\n实施成本：高\n", "utf8");
writeFileSync(join(scenarios.d3.workspace, scenarios.d3.files[2]), "# Study C\n\n长期稳定性：证据不足\n", "utf8");
writeFileSync(join(scenarios.d4.workspace, scenarios.d4.files[0]), createDocx("样本量：100\n平均值：47"));
writeFileSync(join(scenarios.d4.workspace, scenarios.d4.files[1]), "metric,current\nsample_size,160\nmean,47\n", "utf8");
writeFileSync(join(scenarios.d4.workspace, scenarios.d4.files[2]), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><title>结果图</title><desc>样本量：150</desc><text x="20" y="40">平均值：47</text></svg>', "utf8");
copyFileSync(sourcePdf, join(scenarios.d4.workspace, scenarios.d4.files[3]));

try {
  const results = [];
  for (const [scenario, fixture] of Object.entries(scenarios)) {
    const evidenceDir = join(evidenceRoot, scenario);
    const resultPath = join(evidenceDir, `packaged-c5-${scenario}-result.json`);
    const appHome = join(testRoot, `应用数据-${scenario}`);
    const userData = join(testRoot, `用户数据-${scenario}`);
    for (const path of [evidenceDir, appHome, userData]) mkdirSync(path, { recursive: true });
    const fixturePaths = fixture.files.map((name) => join(fixture.workspace, name));
    await runPackagedApp({ scenario, fixturePaths, workspace: fixture.workspace, evidenceDir, resultPath, appHome, userData });
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    assert(result.ok === true, `C5 ${scenario} packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
    const checks = Object.entries(result.checks || {});
    assert(checks.length >= 18 && checks.every(([, passed]) => passed === true), `C5 ${scenario} has failing checks.`);
    const findings = result.details?.findings || [];
    const expectedKinds = scenario === "d3" ? ["consensus", "source_conflict", "evidence_gap"] : ["consensus", "outdated_number", "chart_mismatch"];
    assert(expectedKinds.every((kind) => findings.some((finding) => finding.kind === kind)), `C5 ${scenario} missed a golden finding kind.`);
    results.push({ scenario, checks: checks.length, findingCount: findings.length, expectedKinds, screenshotPath: result.details.screenshotPath, resultPath });
  }
  assert(sha256(readFileSync(join(scenarios.d4.workspace, scenarios.d4.files[3]))) === sourceHash, "CERN PDF changed during C5 analysis.");
  const summary = { ok: true, runId, scenarios: results, goldenFindingKinds: 6, cernPdf: { sizeBytes: source.length, sha256: sourceHash } };
  writeFileSync(join(evidenceRoot, "packaged-c5-material-consistency-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(evidenceRoot, "evidence-integrity.json"), `${JSON.stringify({ runId, scenarioCount: 2, totalChecks: results.reduce((sum, item) => sum + item.checks, 0), goldenFindingKinds: 6, cernPdf: summary.cernPdf }, null, 2)}\n`);
  console.log(`C5 material consistency passed 2/2 scenarios with ${results.reduce((sum, item) => sum + item.checks, 0)} packaged checks and all 6 golden finding kinds.`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function runPackagedApp({ scenario, fixturePaths, workspace, evidenceDir, resultPath, appHome, userData }) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: {
        ...process.env,
        DRSAI_HOME: appHome,
        DRSAI_REPO: workspace,
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_C5_MATERIAL_CONSISTENCY: "1",
        OPENDRSAI_E2E_C5_SCENARIO: scenario,
        OPENDRSAI_E2E_C5_IMPORT_PATHS: fixturePaths.join("|"),
        OPENDRSAI_E2E_C5_EVIDENCE_DIR: evidenceDir,
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1",
        OPENDRSAI_E2E_DISABLE_GPU: "1",
        OPENDRSAI_E2E_TIMEOUT_MS: "90000",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error(`C5 ${scenario} timed out.`)); } }, 105_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0 ? resolveRun() : reject(new Error(`C5 ${scenario} exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON."}`));
    });
  });
}

function createDocx(text) { return createZip([["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'], ["_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'], ["word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`]]); }
function createZip(entries) { const records=[]; const chunks=[]; let offset=0; for(const [entryName,contents] of entries){const name=Buffer.from(entryName,"utf8"); const data=Buffer.from(contents,"utf8"); const crc=crc32(data); const header=Buffer.alloc(30); header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(0x0800,6); header.writeUInt32LE(crc,14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(name.length,26); chunks.push(header,name,data); records.push({name,data,crc,offset}); offset+=30+name.length+data.length;} const centralOffset=offset; for(const record of records){const header=Buffer.alloc(46); header.writeUInt32LE(0x02014b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(20,6); header.writeUInt16LE(0x0800,8); header.writeUInt32LE(record.crc,16); header.writeUInt32LE(record.data.length,20); header.writeUInt32LE(record.data.length,24); header.writeUInt16LE(record.name.length,28); header.writeUInt32LE(record.offset,42); chunks.push(header,record.name); offset+=46+record.name.length;} const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(records.length,8); end.writeUInt16LE(records.length,10); end.writeUInt32LE(offset-centralOffset,12); end.writeUInt32LE(centralOffset,16); chunks.push(end); return Buffer.concat(chunks); }
function crc32(buffer) { let crc=0xffffffff; for(const byte of buffer) crc=(crc>>>8)^CRC_TABLE[(crc^byte)&0xff]; return (crc^0xffffffff)>>>0; }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
