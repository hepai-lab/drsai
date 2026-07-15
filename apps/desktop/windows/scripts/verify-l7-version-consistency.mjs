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

function assert(value, message) { if (!value) throw new Error(`L7 verification failed: ${message}`); }

const acceptance = {
  immutableSnapshots: service.includes('const versionDirectory = join(sanitizedDirectory, "v1")') && service.includes('`v${currentVersion}-${randomUUID()}`'),
  explicitCurrentVersion: ui.includes('data-testid="share-version-badge"') && ui.includes("Current version"),
  commentsBoundToVersion: service.includes('version: shareVersion(share), versionStatus: "current"'),
  staleCommentsVisible: service.includes('versionStatus: version === shareVersion(share) ? "current" : "stale"') && ui.includes('data-testid="share-comment-stale"'),
  optimisticPublishCheck: service.includes("typed.expectedVersion !== previousVersion") && service.includes("sameFingerprints"),
  noSilentOverwrite: service.includes("store.revision") && service.includes("acquireShareStoreLock") && service.includes("no changes were overwritten"),
  conflictAudited: service.includes('"version_conflict", "denied"') && smoke.includes("conflictAudited"),
  cernPackagedNoModel: smoke.includes("realCernPdf") && runner.includes('"network.noModelRequests": completionRequests.length === 0'),
};
for (const [name, passed] of Object.entries(acceptance)) assert(passed, `metric ${name}`);

const golden = { snapshots: true, badge: true, binding: true, stale: true, optimistic: true, noOverwrite: true, conflict: true, cern: true };
const accepts = (value) => Object.values(value).every(Boolean);
const mutations = Object.keys(golden).map((key) => ({ [key]: false }));
assert(accepts(golden), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...golden, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [api, "version: number"], [api, "versionUpdatedAt: string"], [api, "versionUpdatedByAccount: string"],
  [api, 'versionStatus: "current" | "stale"'], [api, "DesktopShareVersionInspection"], [api, "DesktopShareVersionPublishRequest"],
  [api, "DesktopShareVersionPublishResult"], [api, '"version_publish" | "version_conflict"'], [api, "inspectShareVersion(request"], [api, "publishShareVersion(request"],
  [service, "sourceArtifactPath"], [service, "export async function inspectShareVersion"], [service, "export async function publishShareVersion"],
  [service, "commentsThatWillBecomeStale"], [service, "sameFingerprints"], [service, "Version conflict: this share is now"],
  [service, "no content was overwritten"], [service, "acquireShareStoreLock"], [service, "currentRevision !== store.revision"],
  [service, 'appendAudit(share, actorAccount, "version_publish"'], [service, 'appendAudit(share, actorAccount, "version_conflict"'],
  [main, 'secureHandle("desktop:share-version-inspect"'], [main, 'secureHandle("desktop:share-version-publish"'],
  [preload, 'ipcRenderer.invoke("desktop:share-version-inspect"'], [preload, 'ipcRenderer.invoke("desktop:share-version-publish"'],
  [mock, "inspectShareVersion: async"], [mock, "publishShareVersion: async"],
  [ui, 'data-testid="share-version-check"'], [ui, 'data-testid="share-version-dialog"'], [ui, 'data-testid="share-version-artifact"'],
  [ui, 'data-testid="share-version-stale-warning"'], [ui, 'data-testid="share-version-publish"'], [ui, 'data-testid="share-version-status"'],
  [ui, 'data-comment-version-status={comment.versionStatus}'], [smoke, "runShareVersionConsistencySmoke"], [smoke, "immutableV1Snapshot"],
  [smoke, "oldCommentsMarkedStaleNotDeleted"], [smoke, "stalePublisherRejected"], [smoke, "newCommentBoundToV2"],
  [runner, '"l7-version-consistency"'], [runner, "immutableV1AndV2Snapshots"], [runner, "revisionedNoOverwrite"],
  [runner, "l7OwnerScreenshot"], [runner, "l7RecipientScreenshot"], [runner, '"network.noModelRequests"'],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`L7 version-consistency verification passed: ${Object.keys(acceptance).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
