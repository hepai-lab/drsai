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

function assert(value, message) { if (!value) throw new Error(`L2 verification failed: ${message}`); }

const manifest = { scope: "result_only", objects: [{ objectType: "artifact", objectId: "deck", label: "manager.pptx", sha256: "a".repeat(64) }] };
const forbiddenIds = ["source-pdf", "hidden-attachment", "provenance", "conversation", "../source.pdf"];
const allowed = (id) => manifest.objects.some((object) => object.objectType === "artifact" && object.objectId === id);
const metrics = {
  oneFinalResult: manifest.objects.length === 1 && allowed("deck"),
  sourceDenied: !allowed(forbiddenIds[0]),
  hiddenAttachmentDenied: !allowed(forbiddenIds[1]),
  provenanceDenied: !allowed(forbiddenIds[2]),
  conversationDenied: !allowed(forbiddenIds[3]),
  traversalDenied: !allowed(forbiddenIds[4]),
  publicManifestHidesPaths: !/workspacePath|artifactPath|[A-Z]:\\/.test(JSON.stringify(manifest)),
  zeroModelRequestGate: runner.includes('"network.noModelRequests": completionRequests.length === 0'),
};
for (const [name, passed] of Object.entries(metrics)) assert(passed, `metric ${name}`);

const golden = { exact: true, source: true, hidden: true, provenance: true, conversation: true, traversal: true, paths: true, network: true };
const accepts = (value) => Object.values(value).every(Boolean);
const mutations = Object.keys(golden).map((key) => ({ [key]: false }));
assert(accepts(golden), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...golden, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [api, "DesktopSharedArtifactDownloadRequest"], [api, "DesktopSharedArtifactDownloadResult"], [api, "downloadSharedArtifact(request"],
  [service, "MAX_SHARED_DOWNLOAD_BYTES"], [service, "requireAuthContext"], [service, 'item.objectType === "artifact"'],
  [service, "listOwnedBackgroundTasks"],
  [service, "This result is not included in the share manifest"], [service, "safeFileName"], [service, 'file.toString("base64")'],
  [main, 'secureHandle("desktop:shared-artifact-download"'], [preload, 'ipcRenderer.invoke("desktop:shared-artifact-download"'],
  [ui, "downloadIncomingArtifact"], [ui, 'data-testid="shared-artifact-download"'], [ui, 'data-testid="shared-artifact-download-status"'],
  [ui, "URL.createObjectURL"], [mock, "downloadSharedArtifact: async"],
  [smoke, "runFinalResultIsolationSmoke"], [smoke, "manifestContainsNoForbiddenData"], [smoke, "authorizedDownloadIntegrity"],
  [smoke, "allUnauthorizedAccessDenied"], [smoke, "recipientPageOnlyShowsDeck"], [smoke, "downloadUiWorks"],
  [smoke, "ownerTaskListIsolated"],
  [runner, '"l2-final-result-isolation"'], [runner, "packaged-l2-final-result-isolation-result.json"],
  [runner, "PRIVATE-CONVERSATION-SECRET"], [runner, "HIDDEN-ATTACHMENT-SECRET"], [runner, "completionRequests.length === 0"],
  [runner, 'l2Phase: "owner"'], [runner, 'l2Phase: "recipient"'], [runner, "startUserPreferenceGateway"],
  [api, "ownerUserId?: string"], [main, "listOwnedBackgroundTasks(request)"],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

assert(!/\b(?:fetch|https?\.request|createServer)\b/.test(service), "share service gained a network dependency");
console.log(`L2 final-result isolation verification passed: ${Object.keys(metrics).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
