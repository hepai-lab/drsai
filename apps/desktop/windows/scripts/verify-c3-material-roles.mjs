import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CRC_TABLE=Array.from({length:256},(_,value)=>{let crc=value; for(let bit=0;bit<8;bit+=1) crc=(crc&1)?(0xedb88320^(crc>>>1)):(crc>>>1); return crc>>>0;});

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const runId = process.env.OPENDRSAI_C3_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_C3_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf]) if (!existsSync(path)) throw new Error(`C3 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf); const sourceHash = sha256(source);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-c3-"));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 应用数据");
const workspace = join(testRoot, "中文 用户", "C3 D4 材料角色黄金集");
const userData = join(testRoot, "electron user data");
const evidenceDir = join(root, "release", "product-evidence", "c3-material-roles", runId);
const resultPath = join(evidenceDir, "packaged-c3-material-roles-result.json");
for (const path of [appHome, workspace, userData, evidenceDir]) mkdirSync(path, { recursive: true });
const fixturePaths = [
  join(workspace, "旧报告-2024.docx"), join(workspace, "历史总结-2025.md"), join(workspace, "baseline-review.txt"),
  join(workspace, "latest-data-2026.csv"), join(workspace, "最新实验数据.xlsx"), join(workspace, "current-results.tsv"),
  join(workspace, "result-chart.png"), join(workspace, "结果图片.png"), join(workspace, "trend-output.png"),
  join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"), join(workspace, "研究方法参考.md"), join(workspace, "实验协议.pdf"),
];
writeFileSync(fixturePaths[0], createDocx("2024 旧报告：样本量 100，平均值 42，等待最新数据更新。"));
writeFileSync(fixturePaths[1], "# 2025 历史总结\n\n这是上一版报告，样本量 100。\n", "utf8");
writeFileSync(fixturePaths[2], "Previous baseline report and review: sample size 100, mean 42.\n", "utf8");
writeFileSync(fixturePaths[3], "metric,previous,current\nsample_size,100,160\nmean,42,47\n", "utf8");
writeFileSync(fixturePaths[4], createXlsx());
writeFileSync(fixturePaths[5], "metric\tcurrent\nsample_size\t160\nmean\t47\n", "utf8");
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
for (const path of fixturePaths.slice(6, 9)) writeFileSync(path, pixel);
copyFileSync(sourcePdf, fixturePaths[9]);
writeFileSync(fixturePaths[10], "# 研究方法参考\n\n测量协议、术语定义和引用来源，仅作为背景依据。\n", "utf8");
writeFileSync(fixturePaths[11], "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "ascii");

try {
  await runPackagedApp();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `C3 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 18 && checks.every(([, passed]) => passed === true), `C3 expected at least 18 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  assert(result.details?.accuracy >= 0.9, `C3 accuracy below 90%: ${result.details?.accuracy}`);
  assert(sha256(readFileSync(fixturePaths[9])) === sourceHash, "CERN PDF changed during C3 analysis.");
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify({ runId, checks: checks.length, accuracy: result.details.accuracy, cernPdf: { sizeBytes: source.length, sha256: sourceHash }, fixtureRoles: { previousReport: 3, latestData: 3, resultImage: 3, referenceMaterial: 3 } }, null, 2)}\n`);
  console.log(`C3 material-role recognition passed (${checks.length}/${checks.length}); golden accuracy ${(result.details.accuracy * 100).toFixed(1)}%.`);
} finally { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); }

function runPackagedApp() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], { cwd: root, env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_C3_MATERIAL_ROLES: "1", OPENDRSAI_E2E_C3_IMPORT_PATHS: fixturePaths.join("|"), OPENDRSAI_E2E_C3_CERN_PDF: fixturePaths[9], OPENDRSAI_E2E_C3_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "90000", OPENDRSAI_PDF_PYTHON: resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"), OPENDRSAI_PDF_SCRIPT: resolve(root, "../../../cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py") }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("C3 packaged acceptance timed out.")); } }, 105_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`C3 app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function createDocx(text) { return createZip([["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'], ["_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'], ["word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`]]); }
function createXlsx() { return createZip([["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'], ["_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'], ["xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="最新实验数据 2026" sheetId="1"/></sheets></workbook>'], ["xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c><v>160</v></c><c><v>47</v></c></row></sheetData></worksheet>']]); }
function createZip(entries) { const records=[]; const chunks=[]; let offset=0; for(const [entryName,contents] of entries){const name=Buffer.from(entryName,"utf8"); const data=Buffer.from(contents,"utf8"); const crc=crc32(data); const header=Buffer.alloc(30); header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(0x0800,6); header.writeUInt32LE(crc,14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(name.length,26); chunks.push(header,name,data); records.push({name,data,crc,offset}); offset+=30+name.length+data.length;} const centralOffset=offset; for(const record of records){const header=Buffer.alloc(46); header.writeUInt32LE(0x02014b50,0); header.writeUInt16LE(20,4); header.writeUInt16LE(20,6); header.writeUInt16LE(0x0800,8); header.writeUInt32LE(record.crc,16); header.writeUInt32LE(record.data.length,20); header.writeUInt32LE(record.data.length,24); header.writeUInt16LE(record.name.length,28); header.writeUInt32LE(record.offset,42); chunks.push(header,record.name); offset+=46+record.name.length;} const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(records.length,8); end.writeUInt16LE(records.length,10); end.writeUInt32LE(offset-centralOffset,12); end.writeUInt32LE(centralOffset,16); chunks.push(end); return Buffer.concat(chunks); }
function crc32(buffer){let crc=0xffffffff; for(const byte of buffer) crc=(crc>>>8)^CRC_TABLE[(crc^byte)&0xff]; return (crc^0xffffffff)>>>0;}
function sha256(value){return createHash("sha256").update(value).digest("hex").toUpperCase();}
function killTree(pid){if(pid) spawnSync("taskkill.exe",["/PID",String(pid),"/T","/F"],{stdio:"ignore",windowsHide:true});}
function assert(condition,message){if(!condition) throw new Error(message);}
