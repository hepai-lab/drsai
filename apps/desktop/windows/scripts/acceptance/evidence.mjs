import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SECRET_KEYS = /token|authorization|cookie|password|secret|api[-_]?key/i;
const WINDOWS_USER_PATH = /[A-Za-z]:\\Users\\[^\\\s"']+/g;

export function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? "[REDACTED]" : redactEvidence(item),
    ]));
  }
  return typeof value === "string" ? value.replace(WINDOWS_USER_PATH, "C:\\Users\\[REDACTED]") : value;
}

export function evaluateAcceptance(results) {
  const failed = results.filter((result) => result.required && result.status !== "passed");
  return { passed: failed.length === 0, failedScenarioIds: failed.map((item) => item.id) };
}

export async function writeAcceptanceEvidence(reportDirectory, report) {
  await mkdir(reportDirectory, { recursive: true });
  const safe = redactEvidence(report);
  const jsonPath = path.join(reportDirectory, "acceptance-report.json");
  const markdownPath = path.join(reportDirectory, "acceptance-report.md");
  await writeFile(jsonPath, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  const lines = [
    "# OpenDrSai automated acceptance report",
    "",
    `- Run: ${safe.runId}`,
    `- Level: ${safe.level}`,
    `- Result: ${safe.gate.passed ? "PASS" : "FAIL"}`,
    "",
    "| Scenario | Status | Duration |",
    "| --- | --- | ---: |",
    ...safe.results.map((item) => `| ${item.title} | ${item.status.toUpperCase()} | ${item.durationMs} ms |`),
    "",
  ];
  await writeFile(markdownPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonPath, markdownPath };
}

