import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const script = readFileSync(resolve("scripts/run-p3-desktop-e2e.ps1"), "utf8");
const packagedScript = readFileSync(resolve("scripts/run-p3-packaged-desktop-e2e.ps1"), "utf8");
const smoke = readFileSync(resolve("src/main/e2eSmoke.ts"), "utf8");
for (const required of [
  "OPENDRSAI_E2E_P3_DESKTOP", "OPENDRSAI_P3_INPUT", "OPENDRSAI_E2E_RESULT",
  "OPENDRSAI_E2E_SCREENSHOT", "OPENDRSAI_E2E_P3_VERIFY_MODEL", "VerifyModelConnection", "-WithGateway", "desktop_ui_electron_e2e_result_missing",
]) {
  if (!script.includes(required)) throw new Error(`P3 launcher is missing ${required}`);
}
for (const required of [
  "$env:ProgramFiles \"OpenDrSai\"", "OPENDRSAI_E2E_P3_DESKTOP", "OPENDRSAI_P3_INPUT",
  "OPENDRSAI_E2E_RESULT", "OPENDRSAI_E2E_SCREENSHOT", "OPENDRSAI_E2E_RUNTIME_EVIDENCE", "C:\\P3\\profile", "p3-e2e-user-data-",
  "DeveloperBypass", "OPENDRSAI_E2E_P3_DEVELOPER_LOGIN", "OPENDRSAI_DEV_AUTH_BYPASS",
]) {
  if (!packagedScript.includes(required)) throw new Error(`P3 packaged launcher is missing ${required}`);
}
for (const required of [
  "OPENDRSAI_E2E_P3_DESKTOP", "structured-result-layer", "normalized(node.textContent)",
  "data-run-id", "capturePage()", "OPENDRSAI_E2E_RUNTIME_EVIDENCE", "writeP3RuntimeEvidence",
  "p3CollectInspection", "p3CollectSnapshot", "_pagination_required", "modelConnectionVerified",
  "developer-workspace-login", "developer_bypass",
]) {
  if (!smoke.includes(required)) throw new Error(`P3 Electron UI probe is missing ${required}`);
}
console.log("P3 Desktop launcher contract verified.");
