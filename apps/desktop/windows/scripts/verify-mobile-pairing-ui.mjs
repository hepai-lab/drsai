import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("../shared/renderer/src/App.tsx");
const component = read("../shared/renderer/src/components/MobilePairingDialog.tsx");
const styles = read("../shared/renderer/src/styles.css");
const preload = read("../shared/main/preload.ts");
const main = read("src/main/index.ts");

const checks = [
  ["settings integration entry", app.includes('data-testid="android-pairing-entry"') && app.includes("onOpenMobilePairing")],
  ["semantic modal and localized title", component.includes('role="dialog"') && component.includes('aria-modal="true"') && component.includes("连接 Android") && component.includes("Connect Android")],
  ["local QR generation", component.includes("QRCode.toDataURL") && !component.includes("fetch(")],
  ["countdown and expiration", component.includes("secondsLeft") && component.includes('status: "expired"') && component.includes("二维码已过期")],
  ["visible-only two second polling", component.includes('document.visibilityState !== "visible"') && component.includes("}, 2_000)")],
  ["consumed state stops polling", component.includes('grant.status !== "pending"') && component.includes('grant?.status === "consumed"')],
  ["refresh and close revoke", component.includes("await revokeActive()") && component.includes("void revokeActive()")],
  ["manual code copy", component.includes("copyTextSafely(code)") && component.includes("手工配对码")],
  ["keyboard focus containment", component.includes('event.key === "Escape"') && component.includes('event.key !== "Tab"') && component.includes("focusable")],
  ["minimum IPC exposure", preload.includes("desktop:mobile-pairing-readiness") && preload.includes("desktop:mobile-pairing-create") && preload.includes("desktop:mobile-pairing-read") && preload.includes("desktop:mobile-pairing-revoke")],
  ["trusted IPC handlers", main.includes('secureHandle("desktop:mobile-pairing-create"') && main.includes("mobilePairingControllerFor(event.sender)")],
  ["association and device revocation", component.includes("listMobileAssociations") && component.includes("revokeMobileAssociation") && component.includes("revokeMobileRuntimeEnrollment") && preload.includes("desktop:mobile-association-revoke") && main.includes('secureHandle("desktop:mobile-enrollment-revoke"')],
  ["responsive and reduced-motion CSS", styles.includes(".mobile-pairing-dialog") && styles.includes("prefers-reduced-motion") && styles.includes("max-width: 520px")],
  ["opaque theme-aware modal tokens", styles.includes("--surface-raised: var(--app-card-bg)") && styles.includes("--app-panel: var(--app-card-bg)") && styles.includes("--text-primary: var(--app-text-primary)")],
  ["automatic stale Runtime repair", main.includes("repairMobilePairingRuntime") && main.includes("await stopGateway()") && main.includes("await startInstall(sender") && main.includes("await client.getMobilePairingReadiness()")],
  ["localized IPC error presentation", component.includes("mobilePairingErrorText") && component.includes("mobile_pairing_runtime_repair_failed") && component.includes("Error invoking remote method")],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
assert.deepEqual(failures, [], `Mobile pairing UI checks failed: ${failures.join(", ")}`);

const payload = "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=ABCDEFGHJKLMNPQR";
const png = PNG.sync.read(await QRCode.toBuffer(payload, { type: "png", width: 320, margin: 2, errorCorrectionLevel: "M" }));
const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
assert.equal(decoded?.data, payload, "independent QR decoder must restore the canonical payload exactly");

console.log(`Mobile pairing UI verification passed (${checks.length} checks + independent QR decode).`);
