import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const runId = process.env.OPENDRSAI_C1_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_C1_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf]) if (!existsSync(path)) throw new Error(`C1 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-c1-"));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 应用数据");
const workspace = join(testRoot, "中文 用户", "CERN 标准材料包");
const userData = join(testRoot, "electron user data");
const evidenceDir = join(root, "release", "product-evidence", "c1-material-import", runId);
const resultPath = join(evidenceDir, "packaged-c1-material-import-result.json");
for (const path of [appHome, workspace, userData, evidenceDir]) mkdirSync(path, { recursive: true });

const fixturePaths = [
  join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"),
  join(workspace, "CERN 研究说明.docx"),
  join(workspace, "CERN 数据.xlsx"),
  join(workspace, "CERN 指标.csv"),
  join(workspace, "CERN 架构图.png"),
  join(workspace, "CERN 补充说明.md"),
  join(workspace, "已移动的材料.pdf"),
];
copyFileSync(sourcePdf, fixturePaths[0]);
writeFileSync(fixturePaths[1], createDocx());
writeFileSync(fixturePaths[2], createXlsx());
writeFileSync(fixturePaths[3], "metric,value,unit\nHL-LHC growth,10,x\nAsian link requirement,9.6,Tbps\n", "utf8");
writeFileSync(fixturePaths[4], Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
writeFileSync(fixturePaths[5], "# CERN 补充说明\n\nData Challenge 路线用于验证材料组合导入。\n", "utf8");

try {
  await runPackagedApp();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `C1 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 22 && checks.every(([, passed]) => passed === true), `C1 expected at least 22 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  assert(existsSync(fixturePaths[0]) && sha256(readFileSync(fixturePaths[0])) === sourceHash, "CERN PDF changed during import.");
  const integrity = { runId, checks: checks.length, cernPdf: { sizeBytes: source.length, sha256: sourceHash }, importedFiles: fixturePaths.slice(0, 6).map((path) => ({ name: path.split(/[\\/]/).at(-1), sizeBytes: readFileSync(path).length, sha256: sha256(readFileSync(path)) })), failedFixtureExists: existsSync(fixturePaths[6]) };
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify(integrity, null, 2)}\n`);
  console.log(`C1 material import passed (${checks.length}/${checks.length}); six formats ready and one failed file isolated.`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function runPackagedApp() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], { cwd: root, env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_C1_MATERIAL_IMPORT: "1", OPENDRSAI_E2E_C1_IMPORT_PATHS: fixturePaths.join("|"), OPENDRSAI_E2E_C1_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "90000", OPENDRSAI_PDF_PYTHON: resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"), OPENDRSAI_PDF_SCRIPT: resolve(root, "../../../cores/python/packages/drsai/src/drsai/content/pdf/presentation.py") }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("C1 packaged acceptance timed out.")); } }, 105_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`C1 app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function createDocx() {
  return createZip([
    ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ["word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CERN DOCX material: WLCG capacity and Data Challenge notes.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'],
  ]);
}

function createXlsx() {
  return createZip([
    ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CERN throughput" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
    ["xl/sharedStrings.xml", '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>CERN throughput</t></si><si><t>Tbps</t></si></sst>'],
    ["xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>9.6</v></c><c r="B2"><v>2029</v></c></row></sheetData></worksheet>'],
  ]);
}

function createZip(entries) {
  const records = []; const chunks = []; let offset = 0;
  for (const [entryName, contents] of entries) { const name = Buffer.from(entryName, "utf8"); const data = Buffer.from(contents, "utf8"); const crc = crc32(data); const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(0, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26); chunks.push(header, name, data); records.push({ name, data, crc, offset }); offset += 30 + name.length + data.length; }
  const centralOffset = offset;
  for (const record of records) { const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8); header.writeUInt32LE(record.crc, 16); header.writeUInt32LE(record.data.length, 20); header.writeUInt32LE(record.data.length, 24); header.writeUInt16LE(record.name.length, 28); header.writeUInt32LE(record.offset, 42); chunks.push(header, record.name); offset += 46 + record.name.length; }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(records.length, 8); end.writeUInt16LE(records.length, 10); end.writeUInt32LE(offset - centralOffset, 12); end.writeUInt32LE(centralOffset, 16); chunks.push(end); return Buffer.concat(chunks);
}

function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]; return (crc ^ 0xffffffff) >>> 0; }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
