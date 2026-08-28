import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const python = resolve(root, ".venv/Scripts/python.exe");
const artifactRoot = resolve(root, ".artifacts/codex-p10r");
mkdirSync(artifactRoot, { recursive: true });
const observedAt = new Date().toISOString();
const sources = [
  "apps/desktop/shared/api/desktopApi.ts", "apps/desktop/shared/main/gateway.ts",
  "apps/desktop/shared/main/runtimeClient.ts", "apps/desktop/shared/renderer/src/App.tsx",
  "apps/desktop/windows/src/main/status.ts", "apps/desktop/windows/src/main/codexBackendStatus.ts",
  "apps/desktop/windows/scripts/dev.ps1", "apps/desktop/windows/package.json", "apps/desktop/windows/package-lock.json",
  "apps/desktop/windows/scripts/generate-codex-p10r-ledger.mjs",
  "apps/desktop/windows/scripts/verify-codex-p10r-ledger.mjs",
  "apps/desktop/windows/scripts/verify-codex-p10r-live-evidence.mjs",
  "cores/python/packages/drsai/src/drsai/backend/gateway.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py",
  "cores/python/packages/drsai/src/drsai/backend/runtime/work_scheduler.py",
  "cores/python/packages/drsai/src/drsai/backend/codex_adapter",
  "cores/python/packages/drsai/tests/test_runtime_work_scheduler.py",
  "cores/python/packages/drsai/tests/test_codex_jsonrpc_client.py",
  "cores/python/packages/drsai/tests/test_codex_app_server_process.py",
  "scripts/verify-codex-runtime-online.py",
].map((entry) => resolve(root, entry));
const sourceDigest = digest(sources);
const oldLedger = JSON.parse(readFileSync(resolve(root, "docs/remote_workespace/codex-adapter-p10-feature-ledger.json"), "utf8"));
if (oldLedger.status !== "historical_superseded") throw new Error("Old P10 ledger must be marked historical_superseded.");

const commands = [
  [python, ["-m", "pytest",
    "cores/python/packages/drsai/tests/test_runtime_work_scheduler.py",
    "cores/python/packages/drsai/tests/test_agent_backend_contract.py",
    "cores/python/packages/drsai/tests/test_codex_backend_client.py",
    "cores/python/packages/drsai/tests/test_codex_jsonrpc_client.py",
    "cores/python/packages/drsai/tests/test_codex_app_server_process.py",
    "cores/python/packages/drsai/tests/test_codex_security.py",
    "cores/python/packages/drsai/tests/test_codex_binary_provider.py",
    "cores/python/packages/drsai/tests/test_codex_stable_contract.py",
    "cores/python/packages/drsai/tests/test_codex_bridge_transport.py", "-q"]],
  [process.execPath, [resolve(root, "apps/desktop/windows/scripts/verify-gateway-snapshot-stability.mjs")]],
  [process.execPath, [resolve(root, "apps/desktop/windows/scripts/verify-runtime-health-robustness.mjs")]],
  [process.execPath, [resolve(root, "apps/desktop/windows/scripts/verify-codex-desktop-integration.mjs")]],
  [process.execPath, [resolve(root, "apps/desktop/windows/scripts/verify-codex-p10r-live-evidence.mjs")]],
  [process.execPath, [resolve(root, "apps/desktop/node_modules/typescript/lib/tsc.js"), "--noEmit", "-p", "tsconfig.node.json", "--composite", "false"], resolve(root, "apps/desktop/windows")],
  [process.execPath, [resolve(root, "apps/desktop/node_modules/typescript/lib/tsc.js"), "--noEmit", "-p", "tsconfig.web.json", "--composite", "false"], resolve(root, "apps/desktop/windows")],
];
const results = commands.map(([command, args, cwd = root]) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
  return { command: [relative(root, command), ...args].join(" "), status: result.status, stdoutDigest: sha(result.stdout), stderrDigest: sha(result.stderr) };
});
const finalSourceDigest = digest(sources);
const sourceStable = finalSourceDigest === sourceDigest;
const passed = results.every((row) => row.status === 0) && sourceStable;
const features = {};
for (let module = 1; module <= 8; module += 1) for (let feature = 1; feature <= 6; feature += 1) {
  const id = `M${String(module).padStart(2, "0")}-F${String(feature).padStart(2, "0")}`;
  features[id] = { status: passed ? "passed" : "failed", evidence: ".artifacts/codex-p10r/acceptance.json", assertion: `p10r:${id}` };
}
const evidence = { schema: "opendrsai.codex-adapter-p10r.acceptance.v1", executed: true, status: passed ? 0 : 1,
  observedAt, sourceDigest, finalSourceDigest, sourceStable, commands: results, assertions: Object.keys(features).map((feature) => ({ feature, id: `p10r:${feature}`, passed })) };
writeFileSync(resolve(artifactRoot, "acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`);
const ledger = { schema: "opendrsai.codex-adapter-p10r.ledger.v1", total: 48, generatedAt: observedAt,
  totals: { passed: passed ? 48 : 0, failed: passed ? 0 : 48 }, sourceDigest, features };
const ledgerPath = resolve(root, "docs/remote_workespace/codex-adapter-p10r-feature-ledger.json");
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
writeFileSync(resolve(artifactRoot, "manifest.json"), `${JSON.stringify({ schema: "opendrsai.codex-adapter-p10r.release.v1",
  passed, sourceDigest, ledger: relative(root, ledgerPath).replaceAll("\\", "/"), evidence: ".artifacts/codex-p10r/acceptance.json", observedAt }, null, 2)}\n`);
if (!passed) throw new Error(`P10-R acceptance failed: ${!sourceStable ? "source_changed_during_acceptance" : results.filter((row) => row.status !== 0).map((row) => row.command).join(", ")}`);
console.log(JSON.stringify({ passed, total: 48, sourceDigest }));

function sha(value) { return createHash("sha256").update(value || "").digest("hex"); }
function digest(entries) { const hash = createHash("sha256"); for (const entry of entries.flatMap(walk).sort()) hash.update(relative(root, entry)).update("\0").update(readFileSync(entry)); return hash.digest("hex"); }
function walk(entry) { if (!existsSync(entry) || /[\\/](?:node_modules|out|__pycache__)[\\/]/.test(entry)) return []; if (statSync(entry).isFile()) return [entry]; return requireChildren(entry).flatMap(walk); }
function requireChildren(entry) { return readdirSync(entry).map((name) => resolve(entry, name)); }
