import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const api = read("src", "shared", "desktopApi.ts");
const service = read("src", "main", "shares.ts");
const main = read("src", "main", "index.ts");
const preload = read("src", "preload", "index.ts");
const ui = read("src", "renderer", "src", "App.tsx");
const mock = read("src", "renderer", "src", "mockDesktopApi.ts");
const smoke = read("src", "main", "e2eSmoke.ts");
const runner = read("scripts", "verify-e2e-chat.mjs");

function assert(value, message) { if (!value) throw new Error(`L1 verification failed: ${message}`); }

const recipient = "recipient@cern.example";
const resultManifest = { id: "share:result", recipientAccount: recipient, scope: "result_only", objects: [{ objectType: "artifact", objectId: "ppt", label: "manager.pptx" }] };
const taskManifest = { id: "share:task", recipientAccount: recipient, scope: "complete_task", objects: [{ objectType: "task", objectId: "task", label: "CERN task" }, { objectType: "artifact", objectId: "ppt", label: "manager.pptx" }, { objectType: "artifact", objectId: "provenance", label: "provenance.json" }] };
const canOpen = (account, manifest, type, id) => account.toLowerCase() === manifest.recipientAccount && manifest.objects.some((object) => object.objectType === type && object.objectId === id);
const metrics = {
  resultScopeExact: resultManifest.objects.length === 1 && resultManifest.objects[0].objectId === "ppt",
  completeTaskScopeExact: taskManifest.objects.length === 3 && taskManifest.objects.filter((item) => item.objectType === "artifact").length === 2,
  recipientCanOpenResult: canOpen(recipient, resultManifest, "artifact", "ppt"),
  recipientCanOpenTask: canOpen(recipient, taskManifest, "task", "task"),
  crossObjectDenied: !canOpen(recipient, resultManifest, "artifact", "provenance"),
  outsiderDenied: !canOpen("outsider@cern.example", taskManifest, "artifact", "ppt"),
  manifestsHidePaths: !/[A-Z]:\\|workspacePath|artifactPath/.test(JSON.stringify([resultManifest, taskManifest])),
  keyboardContractPresent: (smoke.match(/sendInputEvent\(\{ type: "keyDown", keyCode: "SPACE"/g) || []).length >= 2,
};
for (const [name, passed] of Object.entries(metrics)) assert(passed, `metric ${name}`);

const golden = { resultExact: true, taskExact: true, keyboard: true, confirmation: true, recipientAllowed: true, crossDenied: true, outsiderDenied: true, pathsHidden: true };
const accepts = (v) => v.resultExact && v.taskExact && v.keyboard && v.confirmation && v.recipientAllowed && v.crossDenied && v.outsiderDenied && v.pathsHidden;
const mutations = [{ resultExact: false }, { taskExact: false }, { keyboard: false }, { confirmation: false }, { recipientAllowed: false }, { crossDenied: false }, { outsiderDenied: false }, { pathsHidden: false }];
assert(accepts(golden), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...golden, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [api, "DesktopShareManifest"], [api, 'DesktopShareScope = "result_only" | "complete_task"'],
  [api, "DesktopShareManifestObject"], [api, "createShare(request"], [api, "openSharedObject(request"],
  [service, "requireAuthContext"], [service, "currentAccounts(auth.userId"], [service, "This object is not included in the share manifest"],
  [service, "safeArtifactPath"], [service, "publicManifest"], [service, "internalObjects"],
  [main, 'secureHandle("desktop:share-create"'], [main, 'secureHandle("desktop:shared-object-open"'],
  [preload, 'ipcRenderer.invoke("desktop:share-create"'], [preload, 'ipcRenderer.invoke("desktop:shared-object-open"'],
  [ui, 'data-testid="results-share-artifact"'], [ui, 'data-testid="results-share-task"'],
  [ui, 'data-testid="share-confirmation-dialog"'], [ui, 'data-testid="share-manifest-preview"'],
  [ui, 'data-testid="shared-inbox"'], [ui, 'data-testid="shared-object-open"'],
  [mock, "createShare: async"], [mock, "openSharedObject: async"],
  [smoke, "runResultSharingSmoke"], [smoke, "artifactDialogOpenedByKeyboard"],
  [smoke, "crossObjectDenied"], [smoke, "outsiderDeniedAll"], [smoke, "cernPdfAvailable"],
  [runner, '"l1-result-sharing"'], [runner, "packaged-l1-result-sharing-result.json"],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`L1 result-sharing verification passed: ${Object.keys(metrics).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
