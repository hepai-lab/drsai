import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { DesktopAnomalyDecisionApplyRequest, DesktopAnomalyDecisionApplyResult } from "../api/desktopApi";
import { previewWorkspaceFile } from "./workspaceContext";
import { replaceFileSafely } from "./atomicFileReplace";

export async function applyAnomalyDecision(request: DesktopAnomalyDecisionApplyRequest): Promise<DesktopAnomalyDecisionApplyResult> {
  validateRequest(request);
  const preview = await previewWorkspaceFile({ workspacePath: request.workspacePath, path: request.sourcePath, maxBytes: 1_000_000 });
  if (extname(preview.path).toLowerCase() !== ".csv") throw new Error("Anomaly-data decisions currently require a CSV source.");
  const sourceContent = await readFile(preview.path, "utf8");
  const rows = parseDecisionCsv(sourceContent);
  if (rows.length < 2) throw new Error("The source CSV does not contain any data rows.");
  const headers = rows[0].map((value) => value.trim());
  const anomalyIndex = headers.findIndex((value) => value.toLowerCase() === request.anomalyColumn.trim().toLowerCase());
  if (anomalyIndex < 0) throw new Error(`The anomaly column “${request.anomalyColumn}” was not found.`);
  const dataRows = rows.slice(1);
  const anomalyRows = dataRows.filter((row) => isDecisionAnomaly(row[anomalyIndex] || ""));
  const normalRows = dataRows.filter((row) => !isDecisionAnomaly(row[anomalyIndex] || ""));
  const sourceSha256 = `sha256:${createHash("sha256").update(sourceContent).digest("hex")}`;
  const base = basename(preview.path, extname(preview.path));
  const outputDirectory = dirname(preview.path);
  const outputSpecs = request.decision === "keep"
    ? [{ role: "kept_all" as const, path: join(outputDirectory, `${base}-保留全部.csv`), rows: dataRows }]
    : request.decision === "exclude"
      ? [{ role: "excluded_anomalies" as const, path: join(outputDirectory, `${base}-排除异常.csv`), rows: normalRows }]
      : [
          { role: "kept_all" as const, path: join(outputDirectory, `${base}-保留全部.csv`), rows: dataRows },
          { role: "excluded_anomalies" as const, path: join(outputDirectory, `${base}-排除异常.csv`), rows: normalRows },
        ];
  const outputs: DesktopAnomalyDecisionApplyResult["outputs"] = [];
  for (const output of outputSpecs) {
    const content = serializeDecisionCsv([rows[0], ...output.rows]);
    await writeAtomically(output.path, content);
    outputs.push({ role: output.role, path: output.path, rowCount: output.rows.length, anomalyCount: output.rows.filter((row) => isDecisionAnomaly(row[anomalyIndex] || "")).length, sha256: `sha256:${createHash("sha256").update(content).digest("hex")}` });
  }
  const decidedAt = new Date().toISOString();
  const resultSummary = request.decision === "keep"
    ? `已按“保留异常”生成结果：保留全部 ${dataRows.length} 行，其中异常 ${anomalyRows.length} 行。`
    : request.decision === "exclude"
      ? `已按“排除异常”生成结果：输出 ${normalRows.length} 行；原始数据未改动。`
      : `已按“两种都做”生成结果：保留版 ${dataRows.length} 行，排除版 ${normalRows.length} 行；原始数据未改动。`;
  const receiptPath = join(outputDirectory, `${base}-异常处理决定.json`);
  const result: DesktopAnomalyDecisionApplyResult = { sourcePath: preview.path, anomalyColumn: request.anomalyColumn.trim(), totalRows: dataRows.length, anomalyRows: anomalyRows.length, normalRows: normalRows.length, decision: request.decision, decidedAt, resultSummary, sourceSha256, receiptPath, outputs };
  await writeAtomically(receiptPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function validateRequest(request: DesktopAnomalyDecisionApplyRequest): void {
  if (!request || typeof request !== "object") throw new Error("An anomaly-data decision request is required.");
  if (typeof request.workspacePath !== "string" || !request.workspacePath.trim()) throw new Error("A workspace is required.");
  if (typeof request.sourcePath !== "string" || !request.sourcePath.trim()) throw new Error("A source CSV is required.");
  if (typeof request.anomalyColumn !== "string" || !request.anomalyColumn.trim() || request.anomalyColumn.length > 240 || /[\r\n\0]/.test(request.anomalyColumn)) throw new Error("An anomaly column is required.");
  if (!(["keep", "exclude", "both"] as const).includes(request.decision)) throw new Error("Choose keep, exclude, or both.");
}

function parseDecisionCsv(content: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) { if (character === '"' && content[index + 1] === '"') { field += '"'; index += 1; } else if (character === '"') quoted = false; else field += character; continue; }
    if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (quoted) throw new Error("The source CSV contains an unterminated quoted field.");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((candidate) => candidate.some((value) => value.length > 0));
}

function serializeDecisionCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map((cell) => /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(",")).join("\r\n")}\r\n`;
}

function isDecisionAnomaly(value: string): boolean { return /^(?:true|1|yes|y|anomaly|异常)$/i.test(value.trim()); }

async function writeAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 }); await replaceFileSafely(temporaryPath, path); }
  finally { await rm(temporaryPath, { force: true }).catch(() => undefined); }
}
