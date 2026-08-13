import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

for (const key of ["NO_PROXY", "no_proxy"]) {
  const entries = String(process.env[key] || "").split(",").map((value) => value.trim()).filter(Boolean);
  for (const host of ["127.0.0.1", "localhost"]) if (!entries.includes(host)) entries.push(host);
  process.env[key] = entries.join(",");
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..", "..");
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const pythonSrc = join(repoRoot, "cores", "python", "packages", "drsai", "src");
const port = Number(process.env.OPENDRSAI_E2E_CHAT_PORT || "18643");
const baseUrl = `http://127.0.0.1:${port}`;
const oidcSigningSecret = createHash("sha256").update(`opendrsai-e2e-chat:${port}`).digest("hex");

function e2ePlatformUserId(label = "developer-local") {
  const hex = createHash("sha256").update(`opendrsai-e2e-user:${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex >= 0 ? process.argv[scenarioIndex + 1] : "default";
if (!["default", "network-recovery", "j1-user-preferences", "j2-memory-safety", "j3-memory-management", "j4-memory-scopes", "j5-reusable-task", "j6-reusable-task-adjustments", "k1-natural-language-schedule", "k2-scheduled-trigger-stability", "k7-scheduled-task-management", "l1-result-sharing", "l2-final-result-isolation", "l3-sensitive-share-review", "l4-collaboration-permissions", "l5-comment-task", "l6-share-revocation", "l7-version-consistency"].includes(scenario)) throw new Error(`Unknown chat scenario: ${scenario}`);
const outageMs = Number(process.env.OPENDRSAI_E2E_NETWORK_OUTAGE_MS || "60000");
const completionRequests = [];
let outageStartedAt = 0;
const evidenceDir = join(root, "release", "product-evidence", "chat-network-recovery");
const evidenceResult = join(evidenceDir, "packaged-chat-network-recovery-result.json");
const j1EvidenceDir = join(root, "release", "product-evidence", "j1-user-preferences");
const j1EvidenceResult = join(j1EvidenceDir, "packaged-j1-user-preferences-result.json");
const j1EvidenceScreenshot = join(j1EvidenceDir, "packaged-j1-user-preferences.png");
const j2EvidenceDir = join(root, "release", "product-evidence", "j2-memory-safety");
const j2EvidenceResult = join(j2EvidenceDir, "packaged-j2-memory-safety-result.json");
const j2EvidenceScreenshot = join(j2EvidenceDir, "packaged-j2-memory-safety.png");
const j3EvidenceDir = join(root, "release", "product-evidence", "j3-memory-management");
const j3EvidenceResult = join(j3EvidenceDir, "packaged-j3-memory-management-result.json");
const j3EvidenceScreenshot = join(j3EvidenceDir, "packaged-j3-memory-management.png");
const j4EvidenceDir = join(root, "release", "product-evidence", "j4-memory-scopes");
const j4EvidenceResult = join(j4EvidenceDir, "packaged-j4-memory-scopes-result.json");
const j4EvidenceScreenshot = join(j4EvidenceDir, "packaged-j4-memory-scopes.png");
const j5EvidenceDir = join(root, "release", "product-evidence", "j5-reusable-task");
const j5EvidenceResult = join(j5EvidenceDir, "packaged-j5-reusable-task-result.json");
const j5EvidenceScreenshot = join(j5EvidenceDir, "packaged-j5-reusable-task.png");
const j6EvidenceDir = join(root, "release", "product-evidence", "j6-reusable-task-adjustments");
const j6EvidenceResult = join(j6EvidenceDir, "packaged-j6-reusable-task-adjustments-result.json");
const j6EvidenceScreenshot = join(j6EvidenceDir, "packaged-j6-reusable-task-adjustments.png");
const k1EvidenceDir = join(root, "release", "product-evidence", "k1-natural-language-schedule");
const k1EvidenceResult = join(k1EvidenceDir, "packaged-k1-natural-language-schedule-result.json");
const k1EvidenceScreenshot = join(k1EvidenceDir, "packaged-k1-natural-language-schedule.png");
const k2EvidenceDir = join(root, "release", "product-evidence", "k2-scheduled-trigger-stability");
const k2EvidenceResult = join(k2EvidenceDir, "packaged-k2-scheduled-trigger-stability-result.json");
const k2EvidenceScreenshot = join(k2EvidenceDir, "packaged-k2-scheduled-trigger-stability.png");
const k7EvidenceDir = join(root, "release", "product-evidence", "k7-scheduled-task-management");
const k7EvidenceResult = join(k7EvidenceDir, "packaged-k7-scheduled-task-management-result.json");
const k7EvidenceScreenshot = join(k7EvidenceDir, "packaged-k7-scheduled-task-management.png");
const l1EvidenceDir = join(root, "release", "product-evidence", "l1-result-sharing");
const l1EvidenceResult = join(l1EvidenceDir, "packaged-l1-result-sharing-result.json");
const l1OwnerScreenshot = join(l1EvidenceDir, "packaged-l1-owner-confirmation.png");
const l1RecipientScreenshot = join(l1EvidenceDir, "packaged-l1-recipient-inbox.png");
const l2EvidenceDir = join(root, "release", "product-evidence", "l2-final-result-isolation");
const l2EvidenceResult = join(l2EvidenceDir, "packaged-l2-final-result-isolation-result.json");
const l2OwnerScreenshot = join(l2EvidenceDir, "packaged-l2-owner-manifest.png");
const l2RecipientScreenshot = join(l2EvidenceDir, "packaged-l2-recipient-isolation.png");
const l3EvidenceDir = join(root, "release", "product-evidence", "l3-sensitive-share-review");
const l3EvidenceResult = join(l3EvidenceDir, "packaged-l3-sensitive-share-review-result.json");
const l3OwnerScreenshot = join(l3EvidenceDir, "packaged-l3-owner-review.png");
const l3RecipientScreenshot = join(l3EvidenceDir, "packaged-l3-recipient-safe-result.png");
const l4EvidenceDir = join(root, "release", "product-evidence", "l4-collaboration-permissions");
const l4EvidenceResult = join(l4EvidenceDir, "packaged-l4-collaboration-permissions-result.json");
const l4OwnerScreenshot = join(l4EvidenceDir, "packaged-l4-owner-permissions.png");
const l4ViewScreenshot = join(l4EvidenceDir, "packaged-l4-view-recipient.png");
const l4ContinueScreenshot = join(l4EvidenceDir, "packaged-l4-continue-recipient.png");
const l5EvidenceDir = join(root, "release", "product-evidence", "l5-comment-task");
const l5EvidenceResult = join(l5EvidenceDir, "packaged-l5-comment-task-result.json");
const l5RecipientScreenshot = join(l5EvidenceDir, "packaged-l5-recipient-chart-comment.png");
const l5OwnerScreenshot = join(l5EvidenceDir, "packaged-l5-owner-completed-task.png");
const l6EvidenceDir = join(root, "release", "product-evidence", "l6-share-revocation");
const l6EvidenceResult = join(l6EvidenceDir, "packaged-l6-share-revocation-result.json");
const l6OwnerScreenshot = join(l6EvidenceDir, "packaged-l6-owner-revocation.png");
const l6RecipientScreenshot = join(l6EvidenceDir, "packaged-l6-recipient-after-revocation.png");
const l7EvidenceDir = join(root, "release", "product-evidence", "l7-version-consistency");
const l7EvidenceResult = join(l7EvidenceDir, "packaged-l7-version-consistency-result.json");
const l7OwnerScreenshot = join(l7EvidenceDir, "packaged-l7-owner-version-history.png");
const l7RecipientScreenshot = join(l7EvidenceDir, "packaged-l7-recipient-current-and-stale.png");
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E chat smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:e2e-chat.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-e2e-chat-"));
const appHome = join(tempDir, "drsai-home");
const pythonUserProfile = join(tempDir, "python-user");
const resultPath = join(tempDir, "result.json");
const workspacePath = join(tempDir, "cern-preference-workspace");
const workspaceBPath = join(tempDir, "isolated-project-b");
const userData = join(tempDir, "electron-user-data");
mkdirSync(appHome, { recursive: true });
mkdirSync(userData, { recursive: true });
mkdirSync(workspacePath, { recursive: true });
if (["j1-user-preferences", "j2-memory-safety", "j3-memory-management", "j4-memory-scopes"].includes(scenario)) seedPreferenceWorkspace();
if (["j5-reusable-task", "j6-reusable-task-adjustments", "k1-natural-language-schedule", "k2-scheduled-trigger-stability", "k7-scheduled-task-management", "l1-result-sharing", "l2-final-result-isolation", "l3-sensitive-share-review", "l4-collaboration-permissions", "l5-comment-task", "l6-share-revocation", "l7-version-consistency"].includes(scenario)) seedReusableTaskWorkspace();
if (scenario === "k1-natural-language-schedule") mkdirSync(k1EvidenceDir, { recursive: true });
if (scenario === "k2-scheduled-trigger-stability") mkdirSync(k2EvidenceDir, { recursive: true });
if (scenario === "k7-scheduled-task-management") mkdirSync(k7EvidenceDir, { recursive: true });
if (scenario === "l1-result-sharing") mkdirSync(l1EvidenceDir, { recursive: true });
if (scenario === "l2-final-result-isolation") mkdirSync(l2EvidenceDir, { recursive: true });
if (scenario === "l3-sensitive-share-review") mkdirSync(l3EvidenceDir, { recursive: true });
if (scenario === "l4-collaboration-permissions") mkdirSync(l4EvidenceDir, { recursive: true });
if (scenario === "l5-comment-task") mkdirSync(l5EvidenceDir, { recursive: true });
if (scenario === "l6-share-revocation") mkdirSync(l6EvidenceDir, { recursive: true });
if (scenario === "l7-version-consistency") mkdirSync(l7EvidenceDir, { recursive: true });

let gatewayProcess = null;
let shuttingDownGateway = false;

try {
  await assertPortFree();
  gatewayProcess = scenario === "network-recovery"
    ? await startNetworkRecoveryGateway()
    : ["j1-user-preferences", "j2-memory-safety", "j3-memory-management", "j4-memory-scopes", "j5-reusable-task", "j6-reusable-task-adjustments", "l2-final-result-isolation", "l3-sensitive-share-review", "l4-collaboration-permissions", "l5-comment-task", "l6-share-revocation", "l7-version-consistency"].includes(scenario)
      ? await startUserPreferenceGateway()
      : await startPythonGateway();
  await waitForJson("/health", 25_000);
  let result;
  if (scenario === "l7-version-consistency") {
    const phaseResults = {};
    const runL7 = async (phase, authUserId, authEmail, screenshotPath, share) => {
      const phaseResultPath = join(tempDir, `l7-${phase}-result.json`);
      await runPackagedApp({ resultPath: phaseResultPath, l7Phase: phase, authUserId, authEmail, screenshotPath, l7ShareId: share?.id, l7ObjectId: share?.objects?.[0]?.objectId, l7V1Sha: share?.objects?.[0]?.sha256 });
      phaseResults[phase] = JSON.parse(readFileSync(phaseResultPath, "utf8"));
      return phaseResults[phase];
    };
    const owner = await runL7("owner", "l7-owner", "owner@cern.example");
    const share = owner?.details?.share;
    if (!share?.id || !share.objects?.[0]?.sha256) throw new Error(`L7 owner phase did not produce a versioned share: ${JSON.stringify(owner)}`);
    await runL7("recipient-before", "l7-recipient", "version-reviewer@cern.example", undefined, share);
    const sourcePath = join(workspacePath, "cern-wlcg-manager-versioned.pptx");
    const originalSource = readFileSync(sourcePath);
    writeFileSync(sourcePath, Buffer.concat([originalSource, Buffer.from("\nL7-CERN-V2-OWNER-EDIT-20260715\n", "utf8")]));
    const modifiedSourceSha = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    if (modifiedSourceSha === share.objects[0].sha256) throw new Error("L7 source edit did not change the artifact fingerprint.");
    await runL7("recipient-during", "l7-recipient", "version-reviewer@cern.example", undefined, share);
    const published = await runL7("owner-publish", "l7-owner", "owner@cern.example", undefined, share);
    await runL7("conflict", "l7-owner", "owner@cern.example", undefined, share);
    await runL7("recipient-after", "l7-recipient", "version-reviewer@cern.example", l7RecipientScreenshot, share);
    await runL7("owner-audit", "l7-owner", "owner@cern.example", l7OwnerScreenshot, share);
    const shareRoot = join(appHome, "desktop", "sanitized-shares", share.id.slice("share:".length));
    const versionDirectories = existsSync(shareRoot) ? readdirSync(shareRoot).filter((name) => /^v\d/.test(name)).sort() : [];
    const snapshotHash = (directory) => { const files = readdirSync(join(shareRoot, directory)); return files.length === 1 ? createHash("sha256").update(readFileSync(join(shareRoot, directory, files[0]))).digest("hex") : ""; };
    const v1Directory = versionDirectories.find((name) => name === "v1");
    const v2Directory = versionDirectories.find((name) => name.startsWith("v2-"));
    const immutableSnapshotsPreserved = Boolean(v1Directory && v2Directory && snapshotHash(v1Directory) === share.objects[0].sha256 && snapshotHash(v2Directory) === modifiedSourceSha);
    const stored = JSON.parse(readFileSync(join(appHome, "desktop", "shares.json"), "utf8"));
    const storedShare = stored.shares?.find((item) => item.id === share.id);
    const storeRevisioned = Number.isInteger(stored.revision) && stored.revision >= 6 && storedShare?.version === 2 && storedShare.objects?.[0]?.sha256 === modifiedSourceSha;
    result = {
      ok: Object.values(phaseResults).every((item) => item.ok === true) && immutableSnapshotsPreserved && storeRevisioned && completionRequests.length === 0,
      checks: { ...Object.fromEntries(Object.entries(phaseResults).flatMap(([phase, value]) => Object.entries(value.checks || {}).map(([key, passed]) => [`${phase}.${key}`, passed]))), "storage.immutableV1AndV2Snapshots": immutableSnapshotsPreserved, "storage.revisionedNoOverwrite": storeRevisioned, "network.noModelRequests": completionRequests.length === 0 },
      details: { phases: Object.fromEntries(Object.entries(phaseResults).map(([phase, value]) => [phase, value.details])), source: { v1Sha256: share.objects[0].sha256, v2Sha256: modifiedSourceSha }, versionDirectories, published: published?.details?.share, storeRevision: stored.revision, modelRequestCount: completionRequests.length },
    };
  } else if (scenario === "l6-share-revocation") {
    const ownerResultPath = join(tempDir, "l6-owner-result.json");
    await runPackagedApp({ resultPath: ownerResultPath, l6Phase: "owner", authUserId: "l6-owner", authEmail: "owner@cern.example" });
    const owner = JSON.parse(readFileSync(ownerResultPath, "utf8"));
    const share = owner?.details?.share;
    if (!share?.id || !share.objects?.[0]?.objectId) throw new Error(`L6 owner phase did not produce a share: ${JSON.stringify(owner)}`);
    const phases = [
      ["recipient-before", "l6-recipient", "revoked@cern.example"],
      ["owner-revoke", "l6-owner", "owner@cern.example", l6OwnerScreenshot],
      ["recipient-after", "l6-recipient", "revoked@cern.example", l6RecipientScreenshot],
      ["owner-restart", "l6-owner", "owner@cern.example"],
    ];
    const phaseResults = { owner };
    for (const [phase, authUserId, authEmail, screenshotPath] of phases) {
      const phaseResultPath = join(tempDir, `l6-${phase}-result.json`);
      await runPackagedApp({ resultPath: phaseResultPath, l6Phase: phase, authUserId, authEmail, screenshotPath, l6ShareId: share.id, l6ObjectId: share.objects[0].objectId });
      phaseResults[phase] = JSON.parse(readFileSync(phaseResultPath, "utf8"));
    }
    result = {
      ok: Object.values(phaseResults).every((item) => item.ok === true) && completionRequests.length === 0,
      checks: { ...Object.fromEntries(Object.entries(phaseResults).flatMap(([phase, value]) => Object.entries(value.checks || {}).map(([key, passed]) => [`${phase}.${key}`, passed]))), "network.noModelRequests": completionRequests.length === 0 },
      details: { phases: Object.fromEntries(Object.entries(phaseResults).map(([phase, value]) => [phase, value.details])), modelRequestCount: completionRequests.length },
    };
  } else if (scenario === "l5-comment-task") {
    const phases = [
      ["owner", "l5-owner", "owner@cern.example"],
      ["recipient", "l5-recipient", "reviewer@cern.example", l5RecipientScreenshot],
      ["owner-task", "l5-owner", "owner@cern.example", l5OwnerScreenshot],
    ];
    const phaseResults = {};
    for (const [phase, authUserId, authEmail, screenshotPath] of phases) {
      const phaseResultPath = join(tempDir, `l5-${phase}-result.json`);
      await runPackagedApp({ resultPath: phaseResultPath, l5Phase: phase, authUserId, authEmail, screenshotPath });
      phaseResults[phase] = JSON.parse(readFileSync(phaseResultPath, "utf8"));
    }
    result = {
      ok: Object.values(phaseResults).every((item) => item.ok === true) && completionRequests.length === 0,
      checks: { ...Object.fromEntries(Object.entries(phaseResults).flatMap(([phase, value]) => Object.entries(value.checks || {}).map(([key, passed]) => [`${phase}.${key}`, passed]))), "network.noModelRequests": completionRequests.length === 0 },
      details: { phases: Object.fromEntries(Object.entries(phaseResults).map(([phase, value]) => [phase, value.details])), modelRequestCount: completionRequests.length },
    };
  } else if (scenario === "l4-collaboration-permissions") {
    const phases = [
      ["owner", "l4-owner", "owner@cern.example", l4OwnerScreenshot],
      ["view", "l4-view", "view@cern.example", l4ViewScreenshot],
      ["comment", "l4-comment", "comment@cern.example"],
      ["continue", "l4-continue", "continue@cern.example", l4ContinueScreenshot],
      ["owner-update", "l4-owner", "owner@cern.example"],
      ["downgraded", "l4-comment", "comment@cern.example"],
      ["audit", "l4-owner", "owner@cern.example"],
    ];
    const phaseResults = {};
    for (const [phase, authUserId, authEmail, screenshotPath] of phases) {
      const phaseResultPath = join(tempDir, `l4-${phase}-result.json`);
      await runPackagedApp({ resultPath: phaseResultPath, l4Phase: phase, authUserId, authEmail, screenshotPath });
      phaseResults[phase] = JSON.parse(readFileSync(phaseResultPath, "utf8"));
    }
    result = {
      ok: Object.values(phaseResults).every((item) => item.ok === true) && completionRequests.length === 0,
      checks: {
        ...Object.fromEntries(Object.entries(phaseResults).flatMap(([phase, value]) => Object.entries(value.checks || {}).map(([key, passed]) => [`${phase}.${key}`, passed]))),
        "network.noModelRequests": completionRequests.length === 0,
      },
      details: { phases: Object.fromEntries(Object.entries(phaseResults).map(([phase, value]) => [phase, value.details])), modelRequestCount: completionRequests.length },
    };
  } else if (scenario === "l3-sensitive-share-review") {
    const ownerResultPath = join(tempDir, "l3-owner-result.json");
    const recipientResultPath = join(tempDir, "l3-recipient-result.json");
    await runPackagedApp({ resultPath: ownerResultPath, l3Phase: "owner", authUserId: "l3-owner", authEmail: "owner@cern.example", screenshotPath: l3OwnerScreenshot });
    await runPackagedApp({ resultPath: recipientResultPath, l3Phase: "recipient", authUserId: "l3-recipient", authEmail: "recipient@cern.example", screenshotPath: l3RecipientScreenshot });
    const owner = JSON.parse(readFileSync(ownerResultPath, "utf8"));
    const recipient = JSON.parse(readFileSync(recipientResultPath, "utf8"));
    const secretValues = ["sk-L3CERNSecretKey1234567890", "L3BearerTokenABCDEFGHIJKLMN", "alice.sensitive@cern.example", "13800138000", "L3UserDefinedSecret987654321"];
    const sharesFile = join(appHome, "desktop", "shares.json");
    const storedText = `${existsSync(sharesFile) ? readFileSync(sharesFile, "utf8") : ""}\n${collectTextStorage(join(appHome, "desktop", "sanitized-shares"))}`;
    const persistentSecretsAbsent = secretValues.every((value) => !storedText.includes(value));
    result = {
      ok: owner.ok === true && recipient.ok === true && persistentSecretsAbsent && completionRequests.length === 0,
      checks: {
        ...Object.fromEntries(Object.entries(owner.checks || {}).map(([key, value]) => [`owner.${key}`, value])),
        ...Object.fromEntries(Object.entries(recipient.checks || {}).map(([key, value]) => [`recipient.${key}`, value])),
        "storage.noRawSecrets": persistentSecretsAbsent,
        "network.noModelRequests": completionRequests.length === 0,
      },
      details: { owner: owner.details, recipient: recipient.details, persistentSecretMatches: secretValues.filter((value) => storedText.includes(value)), modelRequestCount: completionRequests.length },
    };
  } else if (scenario === "l2-final-result-isolation") {
    const ownerResultPath = join(tempDir, "l2-owner-result.json");
    const recipientResultPath = join(tempDir, "l2-recipient-result.json");
    await runPackagedApp({ resultPath: ownerResultPath, l2Phase: "owner", authUserId: "l2-owner", authEmail: "owner@cern.example", screenshotPath: l2OwnerScreenshot });
    await runPackagedApp({ resultPath: recipientResultPath, l2Phase: "recipient", authUserId: "l2-recipient", authEmail: "recipient@cern.example", screenshotPath: l2RecipientScreenshot });
    const owner = JSON.parse(readFileSync(ownerResultPath, "utf8"));
    const recipient = JSON.parse(readFileSync(recipientResultPath, "utf8"));
    result = {
      ok: owner.ok === true && recipient.ok === true && completionRequests.length === 0,
      checks: {
        ...Object.fromEntries(Object.entries(owner.checks || {}).map(([key, value]) => [`owner.${key}`, value])),
        ...Object.fromEntries(Object.entries(recipient.checks || {}).map(([key, value]) => [`recipient.${key}`, value])),
        "network.noModelRequests": completionRequests.length === 0,
      },
      details: { owner: owner.details, recipient: recipient.details, modelRequestCount: completionRequests.length },
    };
  } else if (scenario === "l1-result-sharing") {
    const ownerResultPath = join(tempDir, "l1-owner-result.json");
    const recipientResultPath = join(tempDir, "l1-recipient-result.json");
    const outsiderResultPath = join(tempDir, "l1-outsider-result.json");
    await runPackagedApp({ resultPath: ownerResultPath, l1Phase: "owner", authUserId: "l1-owner", authEmail: "owner@cern.example", screenshotPath: l1OwnerScreenshot });
    const owner = JSON.parse(readFileSync(ownerResultPath, "utf8"));
    const outgoing = owner?.details?.outgoing || [];
    const shareAttempts = outgoing.map((share) => ({ shareId: share.id, objectType: share.objects[0].objectType, objectId: share.objects[0].objectId }));
    await runPackagedApp({ resultPath: recipientResultPath, l1Phase: "recipient", authUserId: "l1-recipient", authEmail: "recipient@cern.example", screenshotPath: l1RecipientScreenshot });
    await runPackagedApp({ resultPath: outsiderResultPath, l1Phase: "outsider", authUserId: "l1-outsider", authEmail: "outsider@cern.example", l1ShareIds: JSON.stringify(shareAttempts) });
    const recipient = JSON.parse(readFileSync(recipientResultPath, "utf8"));
    const outsider = JSON.parse(readFileSync(outsiderResultPath, "utf8"));
    result = {
      ok: owner.ok === true && recipient.ok === true && outsider.ok === true,
      checks: {
        ...Object.fromEntries(Object.entries(owner.checks || {}).map(([key, value]) => [`owner.${key}`, value])),
        ...Object.fromEntries(Object.entries(recipient.checks || {}).map(([key, value]) => [`recipient.${key}`, value])),
        ...Object.fromEntries(Object.entries(outsider.checks || {}).map(([key, value]) => [`outsider.${key}`, value])),
      },
      details: { owner: owner.details, recipient: recipient.details, outsider: outsider.details },
    };
  } else if (scenario === "k2-scheduled-trigger-stability") {
    const triggerResultPath = join(tempDir, "k2-trigger-result.json");
    const restartResultPath = join(tempDir, "k2-restart-result.json");
    await runPackagedApp({ resultPath: triggerResultPath, phase: "trigger", screenshotPath: k2EvidenceScreenshot });
    await runPackagedApp({ resultPath: restartResultPath, phase: "restart" });
    const trigger = JSON.parse(readFileSync(triggerResultPath, "utf8"));
    const restart = JSON.parse(readFileSync(restartResultPath, "utf8"));
    result = {
      ok: trigger.ok === true && restart.ok === true,
      checks: { ...Object.fromEntries(Object.entries(trigger.checks || {}).map(([key, value]) => [`trigger.${key}`, value])), ...Object.fromEntries(Object.entries(restart.checks || {}).map(([key, value]) => [`restart.${key}`, value])) },
      details: { trigger: trigger.details, restart: restart.details },
    };
  } else {
    await runPackagedApp();
    if (!existsSync(resultPath)) throw new Error("E2E chat did not write a smoke result.");
    result = JSON.parse(readFileSync(resultPath, "utf8"));
  }
  if (scenario === "network-recovery") {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(evidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "j1-user-preferences") {
    mkdirSync(j1EvidenceDir, { recursive: true });
    writeFileSync(j1EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "j2-memory-safety") {
    mkdirSync(j2EvidenceDir, { recursive: true });
    writeFileSync(j2EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "j3-memory-management") {
    mkdirSync(j3EvidenceDir, { recursive: true });
    writeFileSync(j3EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "j4-memory-scopes") {
    mkdirSync(j4EvidenceDir, { recursive: true });
    writeFileSync(j4EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "j5-reusable-task") {
    mkdirSync(j5EvidenceDir, { recursive: true });
    writeFileSync(j5EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "j6-reusable-task-adjustments") {
    mkdirSync(j6EvidenceDir, { recursive: true });
    writeFileSync(j6EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "k1-natural-language-schedule") {
    mkdirSync(k1EvidenceDir, { recursive: true });
    writeFileSync(k1EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "k2-scheduled-trigger-stability") {
    writeFileSync(k2EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "k7-scheduled-task-management") {
    writeFileSync(k7EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "l1-result-sharing") {
    writeFileSync(l1EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "l2-final-result-isolation") {
    writeFileSync(l2EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "l3-sensitive-share-review") {
    writeFileSync(l3EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "l4-collaboration-permissions") {
    writeFileSync(l4EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "l5-comment-task") {
    writeFileSync(l5EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "l6-share-revocation") {
    writeFileSync(l6EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (scenario === "l7-version-consistency") {
    writeFileSync(l7EvidenceResult, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (!result.ok && !isSuccessfulChatRoundTrip(result)) {
    throw new Error(`E2E chat failed:\n${JSON.stringify(result, null, 2)}`);
  }
  if (!["j1-user-preferences", "j2-memory-safety", "j3-memory-management", "j4-memory-scopes", "j5-reusable-task", "j6-reusable-task-adjustments", "k1-natural-language-schedule", "k2-scheduled-trigger-stability", "k7-scheduled-task-management", "l1-result-sharing", "l2-final-result-isolation", "l3-sensitive-share-review", "l4-collaboration-permissions", "l5-comment-task", "l6-share-revocation", "l7-version-consistency"].includes(scenario)) assertChatDiagnostics(result);
  if (scenario === "network-recovery") assertNetworkRecoveryDiagnostics(result);
  if (scenario === "j1-user-preferences") assertJ1UserPreferenceDiagnostics(result);
  if (scenario === "j2-memory-safety") assertJ2MemorySafetyDiagnostics(result);
  if (scenario === "j3-memory-management") assertJ3MemoryManagementDiagnostics(result);
  if (scenario === "j4-memory-scopes") assertJ4MemoryScopeDiagnostics(result);
  if (scenario === "j5-reusable-task") assertJ5ReusableTaskDiagnostics(result);
  if (scenario === "j6-reusable-task-adjustments") assertJ6ReusableTaskAdjustmentDiagnostics(result);
  console.log("E2E chat passed with packaged Electron + real Python fake gateway.");
} finally {
  if (gatewayProcess) await stopGateway(gatewayProcess);
  await cleanupTempDir(tempDir);
}

function isSuccessfulChatRoundTrip(result) {
  const checks = result?.checks;
  if (!checks || typeof checks !== "object") return false;
  return Object.entries(checks).every(([name, passed]) => name === "gatewayReady" || passed === true) &&
    checks.chatStartEvent === true && checks.chatChunk === true && checks.chatDone === true && checks.noChatError === true;
}
process.exitCode ??= 0;

async function cleanupTempDir(path) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  }
  throw new Error(`Could not remove temporary E2E chat directory ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function assertPortFree() {
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) });
    throw new Error(`${baseUrl} is already serving HTTP. Stop the existing gateway before running verify:e2e-chat.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
}

function assertChatDiagnostics(result) {
  const thread = result?.details?.thread;
  if (!thread || typeof thread.id !== "string" || !thread.id.startsWith("thread-") || thread.kind !== "chat") {
    throw new Error(`E2E chat did not create a real chat thread:\n${JSON.stringify(thread, null, 2)}`);
  }
  if (thread.id === "e2e-chat-request-0001" || thread.id === "e2e-chat-run-0001") {
    throw new Error(`E2E chat thread id collapsed into request/run id:\n${JSON.stringify(thread, null, 2)}`);
  }
  const summary = result?.details?.chatSummary;
  if (!summary || !["start", "oaep", "structured"].includes(summary.firstEventType) || summary.terminalEventType !== "done" || !["done", "structured"].includes(summary.lastEventType)) {
    throw new Error(`E2E chat did not record a completed chat event summary:\n${JSON.stringify(result, null, 2)}`);
  }
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0) {
    throw new Error(`E2E chat durationMs is invalid:\n${JSON.stringify(summary, null, 2)}`);
  }
  const events = result?.details?.events;
  if (!Array.isArray(events) || !events.every((event) => Number.isFinite(event.at))) {
    throw new Error(`E2E chat events did not include relative timestamps:\n${JSON.stringify(events, null, 2)}`);
  }
  if (!events.every((event) => !event.sessionId || event.sessionId === thread.id)) {
    throw new Error(`E2E chat emitted events for the wrong thread:\n${JSON.stringify(events, null, 2)}`);
  }
  const authoritativeRunIds = [...new Set(events.map((event) => event.runId).filter(Boolean))];
  if (authoritativeRunIds.length !== 1 || authoritativeRunIds[0] === "e2e-chat-request-0001") {
    throw new Error(`E2E chat emitted events for the wrong run:\n${JSON.stringify(events, null, 2)}`);
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].at < events[index - 1].at) {
      throw new Error(`E2E chat event timestamps are not monotonic:\n${JSON.stringify(events, null, 2)}`);
    }
  }
  const threads = result?.details?.threads;
  if (!Array.isArray(threads) || !threads.some((item) =>
    item.id === thread.id &&
    item.status === "idle" &&
    item.lastRequestId === "e2e-chat-request-0001" &&
    item.lastRunId === authoritativeRunIds[0] &&
    String(item.title || "").includes("hello e2e chat")
  )) {
    throw new Error(`E2E chat did not return its thread to idle after completion:\n${JSON.stringify(threads, null, 2)}`);
  }
  if (!result?.checks?.chatThreadEvents || !result?.checks?.chatRunEvents || !result?.checks?.chatDistinctIds || !result?.checks?.chatThreadIdle) {
    throw new Error(`E2E chat did not enable the thread/run idle invariants:\n${JSON.stringify(result?.checks, null, 2)}`);
  }
}

function assertNetworkRecoveryDiagnostics(result) {
  const events = result?.details?.events || [];
  const chunks = events.filter((event) => event.type === "chunk").map((event) => event.content || "").join("");
  const statuses = events.filter((event) => event.type === "status").map((event) => event.content || "").join("\n");
  const keys = new Set(completionRequests.map((item) => item.idempotencyKey));
  if (chunks !== "streaming reply before outage and after recovery") throw new Error(`Recovered chat output duplicated or missing: ${chunks}`);
  if (!statuses.includes("网络连接中断") || !statuses.includes("网络已恢复")) throw new Error(`Chat recovery statuses missing: ${statuses}`);
  if (keys.size !== 1 || !completionRequests[0]?.idempotencyKey) throw new Error("Chat idempotency key changed across retries.");
  if (!completionRequests.some((item) => Number(item.body?.metadata?.resume_from_chars) > 0)) throw new Error("Chat resume offset was not sent.");
  if (Date.now() - outageStartedAt < outageMs) throw new Error("Chat outage duration was not exercised.");
}

function assertJ1UserPreferenceDiagnostics(result) {
  const required = [
    "bridge", "login", "gatewayReady", "workspaceSelected", "cernPdfAvailable", "preferenceSubmitEnabled", "explicitConfirmationVisible",
    "onlyExplicitValuesStored", "newConversationAppliesVisiblePreferences", "realNewConversationCreated",
    "taskSubmitEnabled", "newConversationTaskCompleted", "ordinaryTaskDidNotCreateMemory", "cernPdfUnchanged",
  ];
  for (const check of required) {
    if (!result?.checks?.[check]) throw new Error(`J1 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (completionRequests.length !== 1) throw new Error(`J1 expected exactly one provider request after the local preference save, received ${completionRequests.length}.`);
  const body = completionRequests[0].body;
  const system = (body?.messages || []).filter((message) => message.role === "system").map((message) => message.content).join("\n");
  if (!system.includes("Explicit user preferences") || !system.includes("output_language: zh") || !system.includes("chart_gridlines: hidden")) {
    throw new Error(`J1 provider request omitted remembered preferences:\n${system}`);
  }
  const metadata = body?.metadata?.user_preferences;
  if (!Array.isArray(metadata) || metadata.length !== 2 || !metadata.some((item) => item.category === "output_language" && item.value === "zh") || !metadata.some((item) => item.category === "chart_gridlines" && item.value === "hidden")) {
    throw new Error(`J1 structured preference metadata is incomplete: ${JSON.stringify(metadata)}`);
  }
  const userMessages = (body?.messages || []).filter((message) => message.role === "user").map((message) => String(message.content || ""));
  if (!userMessages.some((content) => content.includes("CERN WLCG PDF p.42")) || userMessages.some((content) => content.includes("以后默认用中文"))) {
    throw new Error(`J1 new-conversation task did not prove automatic application without repetition: ${JSON.stringify(userMessages)}`);
  }
  const storedRaw = readFileSync(join(appHome, "desktop", "user-preferences.json"), "utf8");
  if (storedRaw.includes("CERN WLCG") || storedRaw.includes("p.42") || storedRaw.includes("以后默认用中文")) {
    throw new Error("J1 preference storage retained raw conversation or task text instead of typed values.");
  }
}

function assertJ2MemorySafetyDiagnostics(result) {
  const required = [
    "bridge", "login", "gatewayReady", "workspaceSelected", "cernPdfAvailable", "secretSubmitEnabled",
    "sensitiveMemoryExplicitlyRejected", "visibleSecretRedacted", "secretNotInPreferenceStore",
    "secretNotInThreadPersistence", "secretNotInMemoryIndex", "safePreferenceSubmitEnabled", "safeBaselineStored",
    "temporarySubmitEnabled", "temporaryRequirementExplicitlyScoped", "temporaryRequirementNotPersisted",
    "nextConversationUsesSafeBaseline", "realNewConversationCreated", "taskSubmitEnabled", "nextTaskCompleted",
    "nextTaskDidNotMutateMemory", "allRuntimeMemorySurfacesClean", "cernPdfUnchanged",
  ];
  for (const check of required) {
    if (!result?.checks?.[check]) throw new Error(`J2 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (completionRequests.length !== 1) throw new Error(`J2 expected only the final CERN task to reach the provider, received ${completionRequests.length} requests.`);
  const forbidden = [
    "sk-proj-J2NeverPersistABC123456789",
    "xoxb-J2NeverPersist-123456789012",
    "C:\\Users\\win11\\AppData\\Local\\Temp\\j2-private\\token.txt",
  ];
  const providerBody = JSON.stringify(completionRequests[0].body);
  for (const value of forbidden) {
    if (providerBody.includes(value)) throw new Error(`J2 secret leaked to provider context: ${value}`);
  }
  if (providerBody.includes("这次用英文") || providerBody.includes("图表显示网格线")) {
    throw new Error("J2 one-time instruction leaked into the next conversation provider context.");
  }
  const body = completionRequests[0].body;
  const system = (body?.messages || []).filter((message) => message.role === "system").map((message) => message.content).join("\n");
  if (!system.includes("output_language: zh") || !system.includes("chart_gridlines: hidden") || system.includes("output_language: en") || system.includes("chart_gridlines: visible")) {
    throw new Error(`J2 next-task preference context was polluted by the one-time instruction:\n${system}`);
  }
  const storedText = collectTextStorage(appHome);
  for (const value of forbidden) {
    if (storedText.includes(value)) throw new Error(`J2 secret leaked to persistent App storage: ${value}`);
  }
}

function assertJ3MemoryManagementDiagnostics(result) {
  const required = [
    "bridge", "login", "gatewayReady", "workspaceSelected", "cernPdfAvailable", "seededPreferencesAvailable",
    "mainNavigationEntryVisible", "mainNavigationKeyboardReachable", "myAssistantVisible", "myAssistantKeyboardReachable",
    "memoryEntryKeyboardReachable", "memoryManagerVisible", "allSeededRowsVisible", "editConfirmed",
    "editPersistedImmediately", "deleteConfirmed", "deletedRowRemoved", "deletePersistedImmediately",
    "newConversationReflectsEditAndDelete", "realNewConversationCreated", "taskSubmitEnabled", "nextTaskCompleted",
    "nextTaskPreservedManagedState", "cernPdfUnchanged",
  ];
  for (const check of required) {
    if (!result?.checks?.[check]) throw new Error(`J3 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (completionRequests.length !== 1) throw new Error(`J3 expected exactly one provider request for the final CERN task, received ${completionRequests.length}.`);
  const body = completionRequests[0].body;
  const system = (body?.messages || []).filter((message) => message.role === "system").map((message) => String(message.content || "")).join("\n");
  if (!system.includes("output_language: en") || !system.includes("report_format: presentation") || system.includes("chart_gridlines")) {
    throw new Error(`J3 provider system context did not reflect the edit and deletion:\n${system}`);
  }
  const metadata = body?.metadata?.user_preferences;
  if (!Array.isArray(metadata) || metadata.length !== 2 || !metadata.some((item) => item.category === "output_language" && item.value === "en") || !metadata.some((item) => item.category === "report_format" && item.value === "presentation") || metadata.some((item) => item.category === "chart_gridlines")) {
    throw new Error(`J3 structured metadata retained stale or deleted memory: ${JSON.stringify(metadata)}`);
  }
  const userMessages = (body?.messages || []).filter((message) => message.role === "user").map((message) => String(message.content || ""));
  if (!userMessages.some((content) => content.includes("CERN WLCG PDF p.42")) || userMessages.some((content) => /修改记忆|删除记忆|网格线/.test(content))) {
    throw new Error(`J3 next task did not use managed memory without repeating management instructions: ${JSON.stringify(userMessages)}`);
  }
  const stored = JSON.parse(readFileSync(join(appHome, "desktop", "user-preferences.json"), "utf8"));
  if (!Array.isArray(stored.preferences) || stored.preferences.length !== 2 || stored.preferences.some((item) => item.category === "chart_gridlines")) {
    throw new Error(`J3 deleted preference remained in persistent storage: ${JSON.stringify(stored)}`);
  }
}

function assertJ4MemoryScopeDiagnostics(result) {
  const required = [
    "bridge", "login", "authorizedIdentityLoaded", "gatewayReady", "workspaceASelected", "cernPdfAvailable",
    "projectAStored", "projectBIsolatedAtRest", "authorizedTeamReadable", "unauthorizedTeamReadRejected",
    "unauthorizedTeamWriteRejected", "scopeManagerVisible", "personalScopeVisible", "projectScopeVisible",
    "teamScopeVisible", "teamSelectorRestricted", "projectANewChat", "projectATaskCompleted", "workspaceBSelected",
    "projectBNewChat", "projectBTaskCompleted", "cernPdfUnchanged",
  ];
  for (const check of required) {
    if (!result?.checks?.[check]) throw new Error(`J4 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (completionRequests.length !== 2) throw new Error(`J4 expected one provider request per project, received ${completionRequests.length}.`);
  const contexts = completionRequests.map(({ body }) => ({
    system: (body?.messages || []).filter((message) => message.role === "system").map((message) => String(message.content || "")).join("\n"),
    users: (body?.messages || []).filter((message) => message.role === "user").map((message) => String(message.content || "")).join("\n"),
    metadata: body?.metadata,
  }));
  const projectA = contexts.find((item) => item.users.includes("J4 PROJECT A"));
  const projectB = contexts.find((item) => item.users.includes("J4 PROJECT B"));
  if (!projectA || !projectB) throw new Error(`J4 could not distinguish the two project requests: ${JSON.stringify(contexts)}`);
  for (const context of [projectA, projectB]) {
    if (!context.system.includes("output_language: zh") || !context.system.includes("Authorized team memory") || !context.system.includes("cite the exact CERN PDF page")) {
      throw new Error(`J4 global or authorized team memory was missing: ${context.system}`);
    }
    if (!Array.isArray(context.metadata?.team_memory) || !context.metadata.team_memory.some((item) => item.teamId === "cern-research")) {
      throw new Error(`J4 structured team metadata was missing: ${JSON.stringify(context.metadata)}`);
    }
  }
  if (!projectA.system.includes("WLCG-CAPACITY") || !projectA.system.includes("Project memory for this workspace")) {
    throw new Error(`J4 project A memory was not applied: ${JSON.stringify(projectA, null, 2)}`);
  }
  if (projectB.system.includes("WLCG-CAPACITY") || (projectB.metadata?.project_memory || []).some((item) => String(item.content).includes("WLCG-CAPACITY"))) {
    throw new Error(`J4 project A memory leaked into project B: ${JSON.stringify(projectB)}`);
  }
  const persistedTeams = JSON.parse(readFileSync(join(appHome, "desktop", "team-memory.json"), "utf8"));
  if (persistedTeams.teams?.["unowned-team"]) throw new Error("J4 unauthorized team write reached persistent storage.");
}

function assertJ5ReusableTaskDiagnostics(result) {
  const required = [
    "bridge", "login", "gatewayReady", "cernPdfAvailable", "completedSourceTaskAvailable", "resultsCenterVisible",
    "saveEntryVisible", "savedTaskVisible", "replacementInputsExplained", "fixedRulesExplained", "typedTemplatePersisted",
    "crossSessionDiscovery", "runEntryVisible", "reusableRunCompleted", "runHistoryUpdated", "newResultRegistered",
    "newResultUsesCernMaterial", "sameInputCacheReuseRejected", "cernPdfUnchanged",
  ];
  for (const check of required) {
    if (!result?.checks?.[check]) throw new Error(`J5 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (completionRequests.length !== 1) throw new Error(`J5 expected only the reusable rerun to reach the provider, received ${completionRequests.length}.`);
  const body = completionRequests[0].body;
  const text = JSON.stringify(body);
  if (!text.includes("Run reusable task: 每周数据检查") || !text.includes("force_fresh_input_read") || !text.includes("WLCG-20260715-WLCG-talk-IHEP-visit.pdf")) {
    throw new Error(`J5 provider request omitted reusable-task identity, freshness policy, or replacement CERN input: ${text}`);
  }
  if (text.includes("weekly-baseline.csv") || text.includes("throughput,100") || !text.includes("f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e")) {
    throw new Error(`J5 provider request reused old input/cache or omitted the new input hash: ${text}`);
  }
  const stored = JSON.parse(readFileSync(join(appHome, "desktop", "reusable-tasks.json"), "utf8"));
  const all = Object.values(stored.users ?? {}).flat();
  if (all.length !== 1 || all[0].name !== "每周数据检查" || all[0].runCount !== 1 || !all[0].lastInputFingerprint) {
    throw new Error(`J5 reusable task persistence is incomplete: ${JSON.stringify(stored)}`);
  }
}

function assertJ6ReusableTaskAdjustmentDiagnostics(result) {
  const required = [
    "bridge", "login", "gatewayReady", "cernPdfAvailable", "completedSourceTaskAvailable",
    "adjustmentEntryVisible", "threeAdjustmentTypesVisible", "twoScopesExplained", "initialTemplateHasNoAdjustments",
    "thisRunCompleted", "thisRunDidNotChangeTemplate", "templateUpdateRunCompleted", "templateUpdatedPersistently",
    "updatedTemplateRediscovered", "futureRunCompletedWithoutRedescription", "futureRunKeptTemplate",
    "threeUniqueRunsRegistered", "threeOutputsRegistered", "cernPdfUnchanged",
  ];
  for (const check of required) {
    if (!result?.checks?.[check]) throw new Error(`J6 packaged check failed: ${check}\n${JSON.stringify(result, null, 2)}`);
  }
  if (completionRequests.length !== 3) throw new Error(`J6 expected three reusable runs, received ${completionRequests.length}.`);
  const texts = completionRequests.map((item) => JSON.stringify(item.body));
  if (!texts[0].includes("this run only") || !texts[0].includes("Output language: English") || !texts[0].includes("2026-07-20 18:00") || !texts[0].includes("Verify CERN page 42 capacity")) {
    throw new Error(`J6 this-run adjustments were not applied: ${texts[0]}`);
  }
  if (!texts[1].includes("update the saved template") || !texts[1].includes("Output language: Chinese") || !texts[1].includes("2026-07-27 18:00") || !texts[1].includes("核对 2029 暂定目标")) {
    throw new Error(`J6 template-update adjustments were not applied: ${texts[1]}`);
  }
  if (!texts[2].includes("Output language: Chinese") || !texts[2].includes("2026-07-27 18:00") || !texts[2].includes("核对 2029 暂定目标") || texts[2].includes("2026-07-20 18:00")) {
    throw new Error(`J6 future run did not inherit only the saved template adjustments: ${texts[2]}`);
  }
  if (!texts.every((text) => text.includes("force_fresh_input_read")) || !texts[0].includes("WLCG-20260715-WLCG-talk-IHEP-visit.pdf") || !texts[1].includes("cern-week-2.md") || !texts[2].includes("cern-week-3.md")) {
    throw new Error(`J6 fresh-input sequence is incomplete: ${JSON.stringify(texts)}`);
  }
  const stored = JSON.parse(readFileSync(join(appHome, "desktop", "reusable-tasks.json"), "utf8"));
  const task = Object.values(stored.users ?? {}).flat()[0];
  if (!task || task.runCount !== 3 || task.savedAdjustments?.outputLanguage !== "zh" || task.savedAdjustments?.deadline !== "2026-07-27 18:00" || task.savedAdjustments?.checkItems?.length !== 2) {
    throw new Error(`J6 saved template adjustments are incomplete: ${JSON.stringify(stored)}`);
  }
}

function startUserPreferenceGateway() {
  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "drsai", object: "model" }] }));
      return;
    }
    if (req.url === "/v1/config/cli" || req.url === "/v1/models/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({}));
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      const body = await readJsonBody(req);
      completionRequests.push({ body, idempotencyKey: req.headers["idempotency-key"] });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const content = scenario === "j2-memory-safety"
        ? "CERN 安全记忆验收通过：仅应用已保存的中文和隐藏网格线偏好。"
        : ["j5-reusable-task", "j6-reusable-task-adjustments"].includes(scenario)
          ? "J5 reusable task completed from the fresh CERN PDF input"
        : scenario === "j4-memory-scopes"
          ? "J4 scope verified"
        : scenario === "j3-memory-management"
          ? "CERN 记忆管理验收通过：已应用修改后的英文和演示文稿偏好，已删除的网格线偏好未进入任务。"
          : "CERN 偏好已应用：使用中文，并生成不显示网格线的图表。";
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, index: 0 }] })}\n\n`);
      if (scenario === "j5-reusable-task") {
        writeFileSync(join(workspacePath, "weekly-cern-report.md"), [
          "# CERN weekly report",
          "",
          "## Summary",
          "This weekly report was regenerated from WLCG-20260715-WLCG-talk-IHEP-visit.pdf instead of the earlier baseline CSV. It records only conclusions derived from the replacement material.",
          "",
          "## Methods",
          "OpenDrSai read the current PDF bytes, verified the supplied fingerprint, disabled earlier output caches, and rebuilt the report under the saved task rules.",
          "",
          "## Results",
          "Fresh input SHA-256: F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E. The reusable run completed with the new CERN material.",
          "",
          "## Limitations",
          "This acceptance report verifies input freshness and workflow reuse; detailed scientific interpretation remains outside this focused J5 test.",
          "",
          "## Sources",
          "WLCG-20260715-WLCG-talk-IHEP-visit.pdf (verified replacement input).",
          "",
        ].join("\n"), "utf8");
        res.write('data: {"file_event":{"action":"artifact","path":"weekly-cern-report.md","name":"weekly-cern-report.md"}}\n\n');
      }
      if (scenario === "j6-reusable-task-adjustments") {
        const runNumber = completionRequests.length;
        const sourceName = runNumber === 1 ? "WLCG-20260715-WLCG-talk-IHEP-visit.pdf" : `cern-week-${runNumber}.md`;
        const outputName = `j6-run-${runNumber}.md`;
        writeFileSync(join(workspacePath, outputName), [
          `# J6 reusable run ${runNumber}`,
          "",
          "## Summary",
          `This result was regenerated from ${sourceName} with the explicit adjustments selected before this run. No prior result text or cached values were reused.`,
          "",
          "## Methods",
          "OpenDrSai verified the current input fingerprint, applied the selected output language, deadline, and check items, then ran the saved workflow.",
          "",
          "## Results",
          `Run ${runNumber} completed from ${sourceName}. The adjustment scope and structured settings were included in the Agent request metadata.`,
          "",
          "## Limitations",
          "This focused acceptance result verifies adjustment scope and persistence behavior rather than full scientific interpretation.",
          "",
          "## Sources",
          `${sourceName} (fresh replacement input for run ${runNumber}).`,
          "",
        ].join("\n"), "utf8");
        res.write(`data: ${JSON.stringify({ file_event: { action: "artifact", path: outputName, name: outputName } })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "J1 fake gateway" }));
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveListen(server));
  });
}

function seedPreferenceWorkspace() {
  const sourcePdf = "C:\\tmp\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
  if (!existsSync(sourcePdf)) throw new Error(`CERN preference fixture is missing: ${sourcePdf}`);
  const pdf = readFileSync(sourcePdf);
  const hash = createHash("sha256").update(pdf).digest("hex").toUpperCase();
  if (hash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("CERN preference fixture SHA-256 changed.");
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(workspaceBPath, { recursive: true });
  copyFileSync(sourcePdf, join(workspacePath, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"));
  writeFileSync(join(workspacePath, "README.md"), "# CERN preference acceptance workspace\n\nUse p.42 capacity data for the chart task.\n", "utf8");
  writeFileSync(join(workspaceBPath, "README.md"), "# Isolated project B\n\nProject A terminology must not leak here.\n", "utf8");
  const desktopDir = join(appHome, "desktop");
  mkdirSync(desktopDir, { recursive: true });
  const seededAt = "2026-07-15T00:00:00.000Z";
  const seededWorkspaces = [{
    id: `workspace-${scenario}-cern-preferences`, name: scenario === "j2-memory-safety" ? "CERN 记忆安全测试" : "CERN 偏好测试", path: workspacePath, type: "local",
    createdAt: seededAt, updatedAt: seededAt, lastOpenedAt: seededAt, trusted: true, pinned: true,
  }];
  if (scenario === "j4-memory-scopes") seededWorkspaces.push({
    id: "workspace-j4-isolated-b", name: "J4 Isolated Project B", path: workspaceBPath, type: "local",
    createdAt: seededAt, updatedAt: seededAt, lastOpenedAt: seededAt, trusted: true, pinned: true,
  });
  writeFileSync(join(desktopDir, "workspaces.json"), `${JSON.stringify(seededWorkspaces, null, 2)}\n`, "utf8");
  if (scenario === "j3-memory-management") {
    writeFileSync(join(desktopDir, "user-preferences.json"), `${JSON.stringify({ preferences: [
      { category: "output_language", value: "zh", source: "explicit_user_request", createdAt: seededAt, updatedAt: seededAt },
      { category: "chart_gridlines", value: "hidden", source: "explicit_user_request", createdAt: seededAt, updatedAt: seededAt },
      { category: "report_format", value: "presentation", source: "explicit_user_request", createdAt: seededAt, updatedAt: seededAt },
    ] }, null, 2)}\n`, "utf8");
  }
  if (scenario === "j4-memory-scopes") {
    writeFileSync(join(desktopDir, "user-preferences.json"), `${JSON.stringify({ preferences: [
      { category: "output_language", value: "zh", source: "explicit_user_request", createdAt: seededAt, updatedAt: seededAt },
    ] }, null, 2)}\n`, "utf8");
  }
}

function seedReusableTaskWorkspace() {
  const sourcePdf = "C:\\tmp\\WLCG-20260715-WLCG-talk-IHEP-visit.pdf";
  if (!existsSync(sourcePdf)) throw new Error(`CERN reusable-task fixture is missing: ${sourcePdf}`);
  const pdf = readFileSync(sourcePdf);
  const hash = createHash("sha256").update(pdf).digest("hex").toUpperCase();
  if (hash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("CERN reusable-task fixture SHA-256 changed.");
  mkdirSync(workspacePath, { recursive: true });
  copyFileSync(sourcePdf, join(workspacePath, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"));
  if (["l1-result-sharing", "l2-final-result-isolation", "l4-collaboration-permissions", "l5-comment-task", "l6-share-revocation", "l7-version-consistency"].includes(scenario)) {
    const sourcePpt = join(root, "release", "product-evidence", "cern-manager-deck", "packaged-generated-manager-zh-cancel-planning-retry.pptx");
    const sourceManifest = join(root, "release", "product-evidence", "cern-manager-deck", "packaged-generated-manager-zh-cancel-planning-retry.provenance.json");
    if (!existsSync(sourcePpt) || !existsSync(sourceManifest)) throw new Error("L1 CERN manager deck evidence is missing. Run the CERN presentation verifier first.");
    copyFileSync(sourcePpt, join(workspacePath, "cern-wlcg-manager-zh.pptx"));
    copyFileSync(sourceManifest, join(workspacePath, "cern-wlcg-manager-zh.provenance.json"));
    if (scenario === "l4-collaboration-permissions") copyFileSync(sourcePpt, join(workspacePath, "cern-wlcg-manager-collaboration.pptx"));
    if (scenario === "l5-comment-task") copyFileSync(sourcePpt, join(workspacePath, "cern-wlcg-manager-comment-task.pptx"));
    if (scenario === "l6-share-revocation") copyFileSync(sourcePpt, join(workspacePath, "cern-wlcg-manager-revocation.pptx"));
    if (scenario === "l7-version-consistency") copyFileSync(sourcePpt, join(workspacePath, "cern-wlcg-manager-versioned.pptx"));
    if (scenario === "l2-final-result-isolation") {
      copyFileSync(sourcePpt, join(workspacePath, "cern-wlcg-manager-final.pptx"));
      writeFileSync(join(workspacePath, "cern-wlcg-private.provenance.json"), JSON.stringify({ sourcePath: join(workspacePath, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"), conversation: "PRIVATE-CONVERSATION-SECRET", internalWorkspacePath: workspacePath }, null, 2), "utf8");
      writeFileSync(join(workspacePath, "hidden-review-notes.txt"), "HIDDEN-ATTACHMENT-SECRET: internal review only.\n", "utf8");
    }
  }
  if (scenario === "l3-sensitive-share-review") {
    writeFileSync(join(workspacePath, "cern-sensitive-share-report.md"), [
      "# CERN WLCG manager follow-up",
      "",
      "This D7 privacy fixture is derived from the verified CERN WLCG presentation source.",
      "api_key=sk-L3CERNSecretKey1234567890",
      "Authorization: Bearer L3BearerTokenABCDEFGHIJKLMN",
      "Contact: alice.sensitive@cern.example",
      "Phone: 13800138000",
      "user_secret=L3UserDefinedSecret987654321",
      "",
      "Public conclusion: capacity planning remains the only shareable conclusion.",
    ].join("\n"), "utf8");
  }
  writeFileSync(join(workspacePath, "weekly-baseline.csv"), "metric,value\nthroughput,100\n", "utf8");
  writeFileSync(join(workspacePath, "cern-week-2.md"), "# CERN week 2\n\nNew weekly material: review the 2029 tentative target and list evidence gaps.\n", "utf8");
  writeFileSync(join(workspacePath, "cern-week-3.md"), "# CERN week 3\n\nNew weekly material: repeat the saved checks without restating the workflow.\n", "utf8");
  writeFileSync(join(workspacePath, "weekly-baseline-report.md"), "# Baseline weekly report\n\nBaseline throughput is 100.\n", "utf8");
  const desktopDir = join(appHome, "desktop");
  mkdirSync(desktopDir, { recursive: true });
  const seededAt = "2026-07-15T00:00:00.000Z";
  writeFileSync(join(desktopDir, "workspaces.json"), `${JSON.stringify([{ id: "workspace-j5-cern-reusable", name: "CERN reusable task", path: workspacePath, type: "local", createdAt: seededAt, updatedAt: seededAt, lastOpenedAt: seededAt, trusted: true, pinned: true }], null, 2)}\n`, "utf8");
}

function collectTextStorage(rootPath) {
  const chunks = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    if (!current || !existsSync(current)) continue;
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const name of readdirSync(current)) pending.push(join(current, name));
      continue;
    }
    if (stat.size > 5_000_000 || !/\.(?:json|jsonl|txt|md|log)$/i.test(current)) continue;
    chunks.push(readFileSync(current, "utf8"));
  }
  return chunks.join("\n");
}

function startNetworkRecoveryGateway() {
  let requestCount = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "drsai", object: "model" }] }));
      return;
    }
    if (req.url === "/v1/config/cli" || req.url === "/v1/models/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({}));
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      const body = await readJsonBody(req);
      requestCount += 1;
      completionRequests.push({ body, idempotencyKey: req.headers["idempotency-key"] });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write('data: {"choices":[{"delta":{"content":"streaming reply before outage"},"index":0}]}\n\n');
      if (requestCount === 1) outageStartedAt = Date.now();
      if (Date.now() - outageStartedAt < outageMs) {
        setTimeout(() => res.destroy(), 80);
        return;
      }
      res.write('data: {"choices":[{"delta":{"content":" and after recovery"},"index":0}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "fake gateway" }));
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveListen(server));
  });
}

function readJsonBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolveBody(JSON.parse(body || "{}")); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function startPythonGateway() {
  const python = resolvePython();
  const child = spawn(python, ["-m", "drsai.backend.gateway"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DRSAI_API_HOST: "127.0.0.1",
      DRSAI_API_PORT: String(port),
      DRSAI_GATEWAY_FAKE_AGENT: "1",
      OPENDRSAI_DESKTOP_RUNTIME: "1",
      OPENDRSAI_OIDC_HS256_SECRET: oidcSigningSecret,
      DRSAI_HOME: appHome,
      USERNAME: "opendrsai-e2e-chat",
      USERPROFILE: pythonUserProfile,
      PYTHONPATH: [pythonSrc, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const logs = collectLogs(child);
  child.once("exit", (code) => {
    if (!shuttingDownGateway && code !== null && code !== 0) {
      process.stderr.write(`Python gateway exited with code ${code}.\n${logs.tail()}\n`);
    }
  });
  gatewayProcess = child;
  return child;
}

function runPackagedApp(options = {}) {
  return new Promise((resolvePromise, reject) => {
    const activeResultPath = options.resultPath || resultPath;
    let settled = false;
    const child = spawn(exePath, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        PATH: systemPath,
        DRSAI_HOME: appHome,
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_GATEWAY_PORT: String(port),
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_OIDC_HS256_SECRET: oidcSigningSecret,
        OPENDRSAI_OIDC_HS256_SECRET: oidcSigningSecret,
        OPENDRSAI_E2E_CHAT: "1",
        OPENDRSAI_E2E_CHAT_SCENARIO: scenario,
        OPENDRSAI_E2E_RESULT: activeResultPath,
        OPENDRSAI_E2E_K2_PHASE: options.phase,
        OPENDRSAI_E2E_L1_PHASE: options.l1Phase,
        OPENDRSAI_E2E_L1_SHARE_IDS: options.l1ShareIds,
        OPENDRSAI_E2E_L2_PHASE: options.l2Phase,
        OPENDRSAI_E2E_L3_PHASE: options.l3Phase,
        OPENDRSAI_E2E_L4_PHASE: options.l4Phase,
        OPENDRSAI_E2E_L5_PHASE: options.l5Phase,
        OPENDRSAI_E2E_L6_PHASE: options.l6Phase,
        OPENDRSAI_E2E_L6_SHARE_ID: options.l6ShareId,
        OPENDRSAI_E2E_L6_OBJECT_ID: options.l6ObjectId,
        OPENDRSAI_E2E_L7_PHASE: options.l7Phase,
        OPENDRSAI_E2E_L7_SHARE_ID: options.l7ShareId,
        OPENDRSAI_E2E_L7_OBJECT_ID: options.l7ObjectId,
        OPENDRSAI_E2E_L7_V1_SHA: options.l7V1Sha,
        OPENDRSAI_E2E_SCREENSHOT: options.screenshotPath || (scenario === "j1-user-preferences" ? j1EvidenceScreenshot : scenario === "j2-memory-safety" ? j2EvidenceScreenshot : scenario === "j3-memory-management" ? j3EvidenceScreenshot : scenario === "j4-memory-scopes" ? j4EvidenceScreenshot : scenario === "j5-reusable-task" ? j5EvidenceScreenshot : scenario === "j6-reusable-task-adjustments" ? j6EvidenceScreenshot : scenario === "k1-natural-language-schedule" ? k1EvidenceScreenshot : scenario === "k7-scheduled-task-management" ? k7EvidenceScreenshot : undefined),
        OPENDRSAI_E2E_WORKSPACE_PATH: workspacePath,
        OPENDRSAI_E2E_AUTH_USER_ID: e2ePlatformUserId(options.authUserId || (scenario === "j4-memory-scopes" ? "authorized-cern-user" : "developer-local")),
        OPENDRSAI_E2E_AUTH_EMAIL: options.authEmail || (scenario === "j4-memory-scopes" ? "authorized@cern.example" : undefined),
        OPENDRSAI_E2E_WORKSPACE_B_PATH: scenario === "j4-memory-scopes" ? workspaceBPath : undefined,
        OPENDRSAI_E2E_AUTH_GROUPS: scenario === "j4-memory-scopes" ? "cern-research" : undefined,
        OPENDRSAI_E2E_TIMEOUT_MS: scenario === "network-recovery" ? "120000" : ["j1-user-preferences", "j2-memory-safety", "j3-memory-management", "j4-memory-scopes", "j5-reusable-task", "j6-reusable-task-adjustments"].includes(scenario) ? "90000" : "45000",
        OPENDRSAI_NETWORK_RECOVERY_WINDOW_MS: scenario === "network-recovery" ? "90000" : undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      reject(new Error(`E2E chat timed out.\n${stdout}\n${stderr}`));
    }, scenario === "network-recovery" ? 140_000 : ["j1-user-preferences", "j2-memory-safety", "j3-memory-management", "j4-memory-scopes", "j5-reusable-task", "j6-reusable-task-adjustments"].includes(scenario) ? 105_000 : 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 || (existsSync(activeResultPath) && isSuccessfulChatRoundTrip(JSON.parse(readFileSync(activeResultPath, "utf8"))))) {
        resolvePromise();
        return;
      }
      const result = existsSync(activeResultPath) ? `\n${readFileSync(activeResultPath, "utf8")}` : "";
      reject(new Error(`Packaged app exited with code ${code}.${result}\n${stdout}\n${stderr}`));
    });
  });
}

function resolvePython() {
  const candidates = [
    process.env.OPENDRSAI_GATEWAY_SMOKE_PYTHON,
    join(repoRoot, "venv", "Scripts", "python.exe"),
    join(repoRoot, ".venv", "Scripts", "python.exe"),
    join(repoRoot, "venv", "bin", "python"),
    join(repoRoot, ".venv", "bin", "python"),
    "python.exe",
  ].filter(Boolean);
  const python = candidates.find((candidate) => candidate.includes("\\") || candidate.includes("/") ? existsSync(candidate) : true);
  if (!python) {
    throw new Error(`Could not find Python for E2E chat. Set OPENDRSAI_GATEWAY_SMOKE_PYTHON or create ${join(repoRoot, "venv")}.`);
  }
  return python;
}

async function waitForJson(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.status === 200) return;
    } catch {
      // Keep polling until ready.
    }
    if (gatewayProcess?.exitCode !== null) {
      throw new Error(`Python gateway exited before ${path} became ready.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Python gateway did not become ready at ${baseUrl}${path}.`);
}

function collectLogs(child) {
  const chunks = [];
  const append = (chunk) => {
    chunks.push(chunk.toString());
    while (chunks.join("").length > 12_000) chunks.shift();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { tail: () => chunks.join("").slice(-12_000) };
}

function killProcessTree(pid) {
  if (!pid) return;
  shuttingDownGateway = true;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopGateway(gateway) {
  shuttingDownGateway = true;
  if (!gateway.pid) {
    if (typeof gateway.close !== "function") throw new Error("E2E chat Gateway does not expose a close operation.");
    await new Promise((resolveClose, rejectClose) => gateway.close((error) => error ? rejectClose(error) : resolveClose()));
    return;
  }
  if (gateway.exitCode !== null || gateway.signalCode !== null) return;
  try { gateway.kill("SIGTERM"); } catch {}
  await waitForChildExit(gateway, 5_000);
  if (gateway.exitCode !== null || gateway.signalCode !== null) return;
  killProcessTree(gateway.pid);
  await waitForChildExit(gateway, 5_000);
  if (gateway.exitCode === null && gateway.signalCode === null) throw new Error(`E2E chat Gateway process ${gateway.pid} did not exit.`);
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => {
    const timer = setTimeout(resolveExit, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}
