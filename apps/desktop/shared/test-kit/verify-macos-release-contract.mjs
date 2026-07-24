import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), "utf8");
const builder = read("electron-builder.yml");
const packageJson = JSON.parse(read("package.json"));
const updater = read("src/main/updater.ts");
const runtimeInstaller = read("src/main/runtimeInstaller.ts");
const runtimeBuilder = read("scripts/build-runtime-artifact.sh");
const adhocHook = read("scripts/after-pack.cjs");
const nativePermissionsHook = read("scripts/after-pack-native-permissions.cjs");
const bootstrapEntry = read("src/main/bootstrapEntry.ts");
const browserRuntimeLock = read("resources/runtime/browser-requirements.lock");
const runtimeLock = read("resources/runtime/runtime-requirements.lock");
const macMain = read("src/main/index.ts");
const trustIpc = read("src/main/ipc/registerTrustIpc.ts");
const appServices = read("src/main/bootstrap/createAppServices.ts");
const nativeBuild = read("native/OpenDrSaiNativeHelper/build-debug.sh");
const macWindow = read("src/main/bootstrap/createWindow.ts");
const packagedSmoke = read("scripts/verify-packaged-smoke.mjs");
const packagedL5 = read("scripts/verify-packaged-l5.mjs");
const sleepWakeDevice = read("scripts/verify-sleep-wake-real-device.mjs");
const releaseL6 = read("scripts/verify-release-l6.mjs");
const tccL6 = read("scripts/verify-tcc-real-device.mjs");
const onlineUpdateL6 = read("scripts/verify-online-signed-update.mjs");
const updateWatchdog = read("resources/update/update-watchdog.sh");
const desktopRoot = resolve(root, "..");
const workflow = readFileSync(resolve(desktopRoot, "../../.github/workflows/macos-desktop.yml"), "utf8");
const gateway = readFileSync(resolve(root, "../../../cores/python/packages/drsai/src/drsai/backend/gateway.py"), "utf8");

for (const path of ["build/entitlements.mac.plist", "build/entitlements.mac.inherit.plist"]) {
  assert.ok(existsSync(resolve(root, path)), `missing macOS entitlement file: ${path}`);
  const source = read(path);
  assert.ok(source.includes("com.apple.security.cs.allow-jit"));
  assert.equal(source.includes("com.apple.security.app-sandbox"), false, "sandbox must not be claimed before runtime compatibility is proven");
}
assert.equal(read("build/entitlements.mac.plist").includes("disable-library-validation"), false, "Release entitlements must preserve library validation.");
assert.ok(read("build/entitlements.mac.unsigned-development.plist").includes("disable-library-validation"), "Only unsigned development sealing may disable library validation.");
assert.ok(builder.includes("afterSign: scripts/after-pack.cjs"), "Ad-hoc sealing must run after Electron fuse mutation.");
assert.ok(builder.includes("afterPack: scripts/after-pack-native-permissions.cjs"), "Native executable permissions must be normalized before signing.");
assert.ok(nativePermissionsHook.includes("chmodSync(helper, 0o755)"), "node-pty spawn helper must be executable before signing.");
for (const contract of ['CSC_IDENTITY_AUTO_DISCOVERY !== "false"', '"--deep", "--sign", "-"', '"--verify", "--deep", "--strict"', 'identity: "adhoc"', "releaseIdentity: false"]) assert.ok(adhocHook.includes(contract), `Unsigned sealing hook omits ${contract}`);
for (const contract of ["OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE", 'app.setPath("userData"', 'appendSwitch("use-mock-keychain")', 'process.once("unhandledRejection"']) assert.ok(bootstrapEntry.includes(contract), `Acceptance bootstrap omits ${contract}`);
for (const contract of ["hardenedRuntime: true", "notarize: true", "target: dmg", "target: zip", "arch: arm64", "onlyLoadAppFromAsar: true"]) {
  assert.ok(builder.includes(contract), `macOS builder contract omits ${contract}`);
}
for (const contract of ["../shared/browser-use-worker", "to: browser-use-worker", '"*.py"', "requirements.txt"]) {
  assert.ok(builder.includes(contract), `macOS builder omits Browser worker resource contract: ${contract}`);
}
for (const contract of ["native/OpenDrSaiNativeHelper/.build/debug", "to: native", "OpenDrSaiNativeHelper", "libOpenDrSaiNativeProtocol.dylib"]) assert.ok(builder.includes(contract), `macOS builder omits Native Helper resource contract: ${contract}`);
for (const contract of ["arm64-apple-macosx11.0", "MacOSX11.3.sdk", "OpenDrSaiNativeHelper", "-emit-library", 'lib${MODULE}.dylib']) assert.ok(nativeBuild.includes(contract), `Native Helper reproducible Debug build omits ${contract}`);
assert.ok(packageJson.scripts["build:mac:dir"]?.includes("build:native-helper") && packageJson.scripts["test:native-helper"], "macOS package scripts must build and test the Native Helper before packaging");
for (const path of ["../shared/browser-use-worker/worker.py", "../shared/browser-use-worker/protocol.py", "../shared/browser-use-worker/requirements.txt"]) {
  assert.ok(existsSync(resolve(root, path)), `missing shared Browser worker resource: ${path}`);
}
assert.ok(packageJson.scripts["build:mac:arm64"]?.includes("electron-builder"));
assert.ok(packageJson.devDependencies["electron-builder"]);
assert.ok(packageJson.dependencies["electron-updater"]);
assert.ok(packageJson.devDependencies.c8, "coverage runner dependency must be pinned in the macOS workspace");
assert.equal(packageJson.scripts["verify:coverage"], "node ../shared/test-kit/run-macos-shared-coverage.mjs");
assert.ok(packageJson.scripts.verify.indexOf("verify:coverage") >= 0 && packageJson.scripts.verify.indexOf("verify:coverage") < packageJson.scripts.verify.indexOf("verify:acceptance"), "coverage evidence must run before final feature acceptance");
for (const contract of ["checkForUpdates", "downloadUpdate", "CancellationToken", "quitAndInstall", "update-downloaded", "allowDowngrade = false"]) {
  assert.ok(updater.includes(contract), `macOS updater omits ${contract}`);
}
for (const contract of ["scheduleUpdateHealthConfirmation", "minimum = acceptance ? 1_000 : 30_000", "configureSignedUpdateLabFeed", 'url.protocol !== "https:"', "url.hostname !== expectedHost"]) {
  assert.ok(updater.includes(contract), `macOS updater health/lab policy omits ${contract}`);
}
for (const contract of ["scheduleUpdateHealthConfirmation()", "onRendererGone:"]) {
  assert.ok(macMain.includes(contract), `macOS update health orchestration omits ${contract}`);
}
for (const contract of ['window.webContents.on("render-process-gone"', 'window.on("unresponsive"', "cancelUpdateHealthConfirmation();"]) {
  assert.ok(macWindow.includes(contract), `macOS window update health cancellation omits ${contract}`);
}
for (const contract of ["prepareRollback", '"/usr/bin/ditto"', "update-watchdog.sh", "markUpdateHealthy", "expectedVersion"]) {
  assert.ok(updater.includes(contract), `macOS updater rollback omits ${contract}`);
}
for (const contract of ["kill -0", "EXPECTED_VERSION", "MAX_ATTEMPTS", "grep -Fq", "failed-update", "/usr/bin/ditto", "/usr/bin/open"]) {
  assert.ok(updateWatchdog.includes(contract), `macOS update watchdog omits ${contract}`);
}
for (const contract of ["sha256", "runtime-manifest.json", '"/usr/bin/tar"', '"import drsai"', ".previous", "rename(candidate, DRSAI_REPO)"]) {
  assert.ok(runtimeInstaller.includes(contract), `macOS Runtime installer omits ${contract}`);
}
for (const contract of ["OPENDRSAI_RUNTIME_PYTHON", 'EXPECTED_PYTHON="3.11.9"', "pip install", "shasum -a 256", 'uname -m']) {
  assert.ok(runtimeBuilder.includes(contract), `macOS Runtime artifact builder omits ${contract}`);
}
for (const contract of ["browser-requirements.lock", "browser-venv", "--require-hashes", "PLAYWRIGHT_BROWSERS_PATH", "playwright install chromium", "browserPython", "browserPath"]) {
  assert.ok(runtimeBuilder.includes(contract), `macOS Browser Runtime builder omits ${contract}`);
}
for (const contract of ["browser-use==0.13.6", "playwright==", "pyobjc-core==", "pyobjc-framework-cocoa=="]) {
  assert.ok(browserRuntimeLock.includes(contract), `macOS Browser Runtime lock omits ${contract}`);
}
assert.equal(browserRuntimeLock.includes("pywin32=="), false, "macOS Browser Runtime lock must not contain the Windows-only pywin32 package");
assert.equal(runtimeLock.includes("pywin32=="), false, "macOS Runtime lock must not contain the Windows-only pywin32 package");
for (const contract of ["browser-venv", "browser-browsers", "PLAYWRIGHT_BROWSERS_PATH", "OPENDRSAI_BROWSER_USE_PYTHON"]) {
  assert.ok(appServices.includes(contract), `macOS Browser Runtime launch omits ${contract}`);
}
assert.ok(macMain.includes("appServices = createMacosAppServices"), "macOS Browser Runtime services must be created after app readiness");
for (const contract of ['channel === "desktop:git-commit-approval"', 'channel === "desktop:propose-approval"', "deduplicate: false"]) {
  assert.ok(macMain.includes(contract), `Mutable approval proposal IPC must bypass completed-response caching: ${contract}`);
}
assert.ok(trustIpc.includes("executeLocalGitCommit(request, allowed, approval.id)"), "Approved Git commits must carry their persistent approval id into the commit trailer.");
for (const contract of ["listRuntimeWorktrees", "assertManagedFork", 'item.status === "active"', "realpath(owned.canonicalPath)", "assertForkAllowed: assertManagedFork"]) {
  assert.ok(trustIpc.includes(contract), `Fork approvals and dispatch must verify Runtime-managed worktree ownership: ${contract}`);
}
for (const contract of ["OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE", "OPENDRSAI_MACOS_PTY_OK", "renderer/preload/IPC", "child.exitCode"]) {
  assert.ok(packagedSmoke.includes(contract), `macOS packaged smoke omits ${contract}`);
}
for (const contract of ["packaged-core-journeys", "packaged-product-journeys", "thread-crud-snapshot-search-archive-binding", "chat-start-abort-journal-late-input", "agent-catalog-default-usage-start-abort-recovery", "OPENDRSAI_DEV_AUTH_BYPASS", "OPENDRSAI_E2E_AUTH_USER_ID", "OPENDRSAI_PLATFORM_AGENTS_ENABLED", "git-approval-execute-and-replay", "workspace-git-diff-stage-ref-revert-stale-review", "checkpoint-create-preview-approved-restore-accept", "worktree-create-event-queue-dispatch-abort-discard", "ide-context-native-icon-edit-command-pdf-launchservices", "handoff-source.ts", "ide-context.json", "handoff.pdf", "minimalPdf", "startxref", "git-action.txt", "OpenDrSai-Approval:", "rev-list", "rejected-after-crash.txt", "approvalRecoveredAfterCrash", "recoveredApprovalRejected", "rejectedApprovalCommits", "rejectedChangeRemainedStaged", "custom-command-crud", "project-memory-crud", "project-skill-draft-approval-install", "workflow-marketplace-strict-completion-history", "reusable-task-fresh-input-and-scheduled-safe-due", "background-task-idempotency-cancel-retry", "debug-policy-attach-detach", "managed-process-crash", "managed-process-crash-recovery", "nativeHelperForcedCrashes", "gatewayForcedCrashes", "performance-ready", "packaged-performance-budget", "coldInteractiveBudgetMs", "warmInteractiveP95BudgetMs", "idleAverageCpuBudgetPercent", "idleMaxRssBudgetKiB", "restart-stability", "packaged-resource-sampling", '"/bin/ps"', '"/usr/sbin/lsof"', '"pid=,ppid=,rss=,%cpu=,comm="', "formalHundredRestartBudgetSatisfied", "summarizeRestartGrowth", "rssSlopeKiBPerIteration", "fdSlopePerIteration", "iterations === 100", "residualProcessCount", "fault-injection", "SIGKILL", "OPENDRSAI_MACOS_L5_RESTART_ITERATIONS", "OPENDRSAI_MACOS_L5_STABILITY_MS"]) {
  assert.ok(packagedL5.includes(contract), `macOS packaged L5 omits ${contract}`);
}
for (const contract of ['scenario === "managed-process-crash"', 'process.kill(helperBefore.pid, "SIGKILL")', 'process.kill(gatewayBefore.pid, "SIGKILL")', "Native Helper did not recover after SIGKILL", "Gateway restart did not produce a new healthy PID"]) {
  assert.ok(read("src/main/packagedSmoke.ts").includes(contract), `Packaged managed-process recovery omits ${contract}`);
}
for (const contract of ["sleep-wake", "lock-screen", "unlock-screen", "allExpectedEventsObserved", "eventOrderValid", "gatewayAfter.ready"]) {
  assert.ok(read("src/main/packagedSmoke.ts").includes(contract), `Packaged real-device lifecycle scenario omits ${contract}`);
}
for (const contract of ["Apple Silicon macOS hardware", "Put this Mac to sleep", "waitForNoResiduals", "residualProcessCount: 0", "sleep-wake-real-device.json", 'featureIds: ["F06.4", "F06.5", "F08.5", "F10.3"]']) {
  assert.ok(sleepWakeDevice.includes(contract), `macOS real-device sleep/wake verifier omits ${contract}`);
}
for (const contract of ["OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE", "OPENDRSAI_DEV_AUTH_BYPASS", 'x-opendrsai-auth-mode") == "offline"', 'request.user_id == "packaged-l5-user"', 'fixture_request_id == "packaged_chat_recovery_001"', "network_retry_attempt", "resume_from_chars", "X-OpenDrSai-Packaged-Recovery-Fixture"]) {
  assert.ok(gateway.includes(contract), `Packaged Chat recovery fixture omits security or cursor contract: ${contract}`);
}
assert.ok((gateway.match(/packaged_recovery_fixture = \(/g) ?? []).length >= 2, "Both legacy Chat SSE and Runtime execute endpoints must gate the packaged recovery fixture.");
for (const contract of ["--deep", "--strict", "Developer ID Application:", "spctl", "stapler", "hdiutil", "clean-install", "signed-update-rollback-rehearsal", "onlineUpdateInstalled: false", "userDataPreserved: true"]) {
  assert.ok(releaseL6.includes(contract), `macOS automated L6 omits ${contract}`);
}
for (const contract of ["OPENDRSAI_MACOS_PACKAGED_SCENARIO", '"tcc"', "microphoneState", "automationState", "notificationVisiblyConfirmed", "hardwareIdentitySha256", "display dialog"]) {
  assert.ok(tccL6.includes(contract), `macOS real-device TCC L6 omits ${contract}`);
}
for (const contract of ["https:", "online-signed-update", "onlineUpdateInstalled: true", "healthConfirmed: true", "userDataPreserved: true", "installedAppExecutableSha256", "codesign"] ) {
  assert.ok(onlineUpdateL6.includes(contract), `macOS signed online update L6 omits ${contract}`);
}
for (const contract of ['scenario === "tcc"', 'requestSystemPermission("microphone")', 'requestSystemPermission("automation")', 'requestSystemPermission("notifications")', 'openSystemPermissionSettings("files")']) {
  assert.ok(read("src/main/packagedSmoke.ts").includes(contract), `macOS packaged TCC scenario omits ${contract}`);
}
for (const contract of ['scenario === "product-state"', "login", "listAgents", "setDefaultAgent", "recordAgentUsage", "startChat", "abortChat", "recoverChatRun", "respondChatInput", "onChatEvent", "startAgentRun", "abortAgentRun", "recoverAgentRun", "onAgentRunEvent", "createThread", "updateThreadSnapshot", "searchThreadMessages", "setThreadArchived", "deleteThread", "requestGitCommitApproval", "getWorkspaceGitDiff", "stageWorkspaceFile", "getWorkspaceGitFileAtRef", "revertWorkspaceFile", "createWorkspaceCheckpoint", "listWorkspaceCheckpoints", "previewWorkspaceCheckpoint", "restoreWorkspaceCheckpoint", "acceptWorkspaceCheckpoint", "prepareForkWorktree", "listWorktrees", "listWorktreeEvents", "requestForkQueueStartApproval", "dispatchForkQueue", "worktreeBecameIdle", "requestForkLifecycleApproval", "getIdeContext", "getFileIcon", "performEditCommand", "openPdfPage", "upsertCustomCommand", "addProjectMemory", "createProjectSkillDraft", "installProjectSkillDraft", "listPendingApprovals", "decideApproval", "listWorkflowMarketplace", "prepareWorkflowRun", "startWorkflowRun", "dispatchWorkflowRunStep", "completeWorkflowRunStep", "listWorkflowRuns", "saveReusableTask", "prepareReusableTaskRun", "listReusableTasks", "createScheduledTask", "runDueScheduledTasks", "updateScheduledTask", "deleteScheduledTask", "recordDiagnostic", "enqueueBackgroundTask", "updateBackgroundTask", "cancelBackgroundTask", "retryBackgroundTask", "updateInteractiveDebugPolicy", "startInteractiveDebugSession", 'action: "disconnect"']) {
  assert.ok(read("src/main/packagedSmoke.ts").includes(contract), `macOS packaged product-state scenario omits ${contract}`);
}
for (const contract of ["tags: [\"v*\"]", 'cron: "0 16 * * *"', "generate-source-snapshot.mjs --require-clean", "verify:runtime-reproducibility", "record:l4-evidence", "record:l5-evidence", "verify:packaged:l5", "--require-l4 --require-l5", "release-macos-l6-real-device", "self-hosted, macOS, ARM64, opendrsai-release", "verify:release:l6-auto", "stage:update-lab-feed", "verify:online-update:l6", "record:signed-update-evidence", "verify:tcc:l6", "record:l6-evidence", "--require-l4 --require-l5 --require-l6", "macos/build/acceptance/**"]) {
  assert.ok(workflow.includes(contract), `macOS CI evidence workflow omits ${contract}`);
}
assert.ok(workflow.indexOf("record:l6-evidence") < workflow.indexOf("Publish only after all L0-L6 gates pass"), "release publication must occur only after L6 evidence is recorded");
for (const path of [
  "../shared/test-kit/generate-source-snapshot.mjs",
  "../shared/test-kit/verify-macos-platform-evidence.mjs",
  "../shared/test-kit/record-macos-platform-evidence.mjs",
  "scripts/verify-runtime-reproducibility.mjs",
  "scripts/verify-packaged-l5.mjs",
  "scripts/verify-sleep-wake-real-device.mjs",
  "../shared/test-kit/record-macos-l5-evidence.mjs",
  "scripts/verify-release-l6.mjs",
  "scripts/verify-tcc-real-device.mjs",
  "scripts/verify-online-signed-update.mjs",
  "scripts/stage-update-lab-feed.mjs",
  "scripts/prepare-previous-release.mjs",
  "../shared/test-kit/record-macos-signed-update-evidence.mjs",
  "../shared/test-kit/record-macos-l6-evidence.mjs",
]) assert.ok(existsSync(resolve(root, path)), `missing macOS evidence tool: ${path}`);
console.log("macOS release contract passed (arm64 DMG/ZIP, hardened runtime, entitlements, notarization, ASAR-only loading).");
