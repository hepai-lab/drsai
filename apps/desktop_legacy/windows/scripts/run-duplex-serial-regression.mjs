import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const output = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../release/duplex-voice/serial-regression-report.json")); const logPath = resolve(process.argv[3] ?? resolve(import.meta.dirname, "../release/duplex-voice/serial-regression-output.log"));
const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm"; const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run test:voice:serial"] : ["run", "test:voice:serial"]; const startedAt = new Date().toISOString(); const result = spawnSync(command, args, { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
const raw = `${result.stdout ?? ""}${result.stderr ?? ""}`; const safe = raw.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_-]{8,}/gi, "[redacted]").replace(/((?:api[_-]?key|authorization|token)\s*[:=]\s*)\S+/gi, "$1[redacted]");
mkdirSync(dirname(output), { recursive: true }); writeFileSync(logPath, safe, "utf8"); const logBytes = Buffer.from(safe); const digest = createHash("sha256").update(logBytes).digest("hex");
const report = { schemaVersion: 1, kind: "duplex-serial-regression", suite: "npm run test:voice:serial", passed: result.status === 0, startedAt, completedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal ?? null, ...(result.error ? { launchError: result.error.name } : {}), output: { uri: pathToFileURL(logPath).toString(), sha256: digest }, privacy: { credentialsPersisted: false, transcriptTextPersisted: false } };
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"); console.log(`Serial regression report written to ${output} (passed=${report.passed}).`); process.exitCode = report.passed ? 0 : 1;
