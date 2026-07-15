import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "i6-external-conflict", "packaged-i6-external-conflict-result.json");
assert(existsSync(resultPath), "Run verify:packaged-i6-external-conflict before the independent verifier");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
assert(result.ok === true && Object.values(result.checks ?? {}).every(Boolean), "Packaged I6 scenario did not pass");
const evaluation = evaluate(result);
assert(evaluation.ok, `I6 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  unchangedHashRejected: !evaluate(mutate(result, { hashes: { ...result.details.hashes, blockedExternal: result.details.hashes.initial } })).ok,
  blockedDraftLeakRejected: !evaluate(mutate(result, { contents: { ...result.details.contents, blockedExternal: `${result.details.contents.blockedExternal}\nuser draft leaked` } })).ok,
  missingRecoveryChoiceRejected: !evaluate({ ...result, checks: { ...result.checks, threeRecoveryChoicesVisible: false } }).ok,
  staleReloadRejected: !evaluate({ ...result, checks: { ...result.checks, reloadUsesLatestExternalVersion: false } }).ok,
  missingSavedCopyRejected: !evaluate(mutate(result, { hashes: { ...result.details.hashes, savedCopy: undefined }, contents: { ...result.details.contents, savedCopy: "" } })).ok,
  normalSaveFailureRejected: !evaluate({ ...result, checks: { ...result.checks, unchangedHashAllowsSafeSave: false } }).ok,
  repeatedOverwriteRejected: !evaluate(mutate(result, { contents: { ...result.details.contents, finalExternal: `${result.details.contents.finalExternal}\nblocked follow-up draft` } })).ok,
  changedCernPdfRejected: !evaluate(mutate(result, { hashes: { ...result.details.hashes, pdfAfter: "sha256:changed" } })).ok,
};
assert(Object.values(negative).every(Boolean), `I6 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("src/shared/desktopApi.ts");
const main = read("src/main/index.ts");
const preload = read("src/preload/index.ts");
const files = read("src/renderer/src/components/files/FilesContextPanel.tsx");
const styles = read("src/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-agent-run.mjs");
const packageJson = read("package.json");
const contracts = {
  typedRequestAndResult: shared.includes("interface WorkspaceFileWriteRequest") && shared.includes("expectedHash: string") && shared.includes('mode?: "save" | "overwrite" | "save_as"') && shared.includes('status: "saved" | "conflict" | "canceled"'),
  hashRequiredAtBoundary: main.includes("The hash from the last read is required") && main.includes("/^sha256:[a-f0-9]{64}$/i"),
  workspaceAndSizeGuarded: main.includes("Protected text writes are limited to 1 MB") && main.includes("The workspace is not registered or allowed"),
  freshHashComparedBeforeWrite: main.indexOf("currentHash !== request.expectedHash") > 0 && main.indexOf("currentHash !== request.expectedHash") < main.indexOf("await writeFile(destinationPath"),
  conflictIsZeroWrite: main.includes('status: "conflict"') && main.includes("Nothing was overwritten") && main.indexOf('status: "conflict"') < main.indexOf("await writeFile(destinationPath"),
  saveAsMustBeDistinct: main.includes("Save as must use a different path so the external version remains intact"),
  explicitOverwriteUsesFreshHash: files.includes('applySafeEdit("overwrite")') && files.includes("safeEdit.conflict.currentHash") && main.includes("after a fresh hash check"),
  secureBridgeRegistered: preload.includes('"desktop:workspace-file-write"') && main.includes('secureHandle("desktop:workspace-file-write"'),
  protectedEditorVisible: files.includes('data-testid="safe-file-edit-open"') && files.includes('data-testid="safe-file-edit-draft"') && files.includes('data-testid="safe-file-edit-save"'),
  threeConflictChoicesVisible: ["external-conflict-reload", "external-conflict-save-as", "external-conflict-manual"].every((marker) => files.includes(marker)),
  manualChoiceHasBothOutcomes: files.includes("external-conflict-keep-external") && files.includes("external-conflict-overwrite"),
  conflictPresentationStyled: styles.includes(".files-external-conflict") && styles.includes(".files-external-conflict-actions"),
  independentExternalActor: runner.includes("i6ExternalWatcher") && runner.includes("i6-external-trigger.txt") && runner.includes("i6ExternalContent(externalEditCount)"),
  realCernFixturePinned: runner.includes("WLCG-20260715-WLCG-talk-IHEP-visit.pdf") && runner.includes("F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E"),
  packagedRuntimeCoversAllChoices: smoke.includes("runExternalFileConflictSmoke") && smoke.includes("saveAsPreservesBothVersions") && smoke.includes("repeatedExternalChangeStillProtected"),
  commandsRegistered: packageJson.includes('"verify:packaged-i6-external-conflict"') && packageJson.includes('"verify:i6-external-conflict"'),
};
assert(Object.values(contracts).every(Boolean), `I6 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const checks = input?.checks ?? {};
  const hashes = input?.details?.hashes ?? {};
  const contents = input?.details?.contents ?? {};
  const metrics = {
    staleHashDetection: checks.conflictDetectedAndWriteStopped === true && hashes.initial && hashes.blockedExternal && hashes.initial !== hashes.blockedExternal ? 1 : 0,
    zeroWriteOnConflict: checks.externalVersionPreservedOnBlock === true && !String(contents.blockedExternal ?? "").includes("user draft leaked") ? 1 : 0,
    recoveryChoiceCoverage: checks.threeRecoveryChoicesVisible === true && checks.manualChoiceExplainsBothOutcomes === true ? 1 : 0,
    reloadAccuracy: checks.reloadUsesLatestExternalVersion === true && checks.manualKeepExternalWorks === true ? 1 : 0,
    saveAsDualPreservation: checks.saveAsPreservesBothVersions === true && Boolean(hashes.savedCopy) && String(contents.savedCopy ?? "").length > String(contents.blockedExternal ?? "").length ? 1 : 0,
    safeWriteAccuracy: checks.unchangedHashAllowsSafeSave === true && hashes.normalSaved !== hashes.saveAsExternal ? 1 : 0,
    repeatedProtection: checks.repeatedExternalChangeStillProtected === true && hashes.finalExternal !== hashes.normalSaved && !String(contents.finalExternal ?? "").includes("blocked follow-up draft") ? 1 : 0,
    cernSourceProtection: checks.cernPdfUnchanged === true && hashes.pdfBefore === hashes.pdfAfter && /^sha256:[a-f0-9]{64}$/i.test(hashes.pdfBefore ?? "") ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), metrics };
}

function mutate(result, detailUpdates) {
  return { ...result, details: { ...result.details, ...detailUpdates } };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
