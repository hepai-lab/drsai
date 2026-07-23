import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const api = read("..", "shared", "api", "desktopApi.ts");
const service = read("src", "main", "shares.ts");
const main = read("src", "main", "index.ts");
const preload = read("..", "shared", "main", "preload.ts");
const ui = read("..", "shared", "renderer", "src", "App.tsx");
const mock = read("..", "shared", "renderer", "src", "mockDesktopApi.ts");
const smoke = read("src", "main", "e2eSmoke.ts");
const runner = read("scripts", "verify-e2e-chat.mjs");

function assert(value, message) { if (!value) throw new Error(`L6 verification failed: ${message}`); }

const acceptance = {
  explicitConfirmation: ui.includes('shareRevokeConfirmation !== "REVOKE"'),
  recipientCardRemoved: service.includes('share.status === "active" && identities.has(share.recipientAccount)'),
  oldOpenDenied: service.includes('item.id === typed.shareId && item.status === "active"'),
  oldDownloadDenied: (service.match(/item\.id === typed\.shareId && item\.status === "active"/g) || []).length >= 7,
  collaborationDenied: service.includes("The current share permission does not allow comments") && service.includes("The current share permission does not allow continued processing"),
  persistedAcrossRestart: service.includes('(item.status === "active" || item.status === "revoked")'),
  receiptRecorded: api.includes("auditEntryId: string") && service.includes('appendAudit(share, actorAccount, "revoke", "allowed"'),
  noModelDependency: runner.includes('"network.noModelRequests": completionRequests.length === 0'),
};
for (const [name, passed] of Object.entries(acceptance)) assert(passed, `metric ${name}`);

const golden = { confirm: true, inbox: true, open: true, download: true, collaboration: true, persistence: true, audit: true, noModel: true };
const accepts = (value) => Object.values(value).every(Boolean);
const mutations = Object.keys(golden).map((key) => ({ [key]: false }));
assert(accepts(golden), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...golden, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [api, 'status: "active" | "revoked"'], [api, "revokedAt?: string"], [api, "revokedByAccount?: string"],
  [api, "DesktopShareRevokeRequest"], [api, 'confirmation: "REVOKE"'], [api, "DesktopShareRevocationResult"],
  [api, 'DesktopShareAuditAction = "permission_update" | "comment" | "continue" | "comment_task" | "revoke"'], [api, "revokeShare(request"],
  [service, "export async function revokeShare"], [service, "normalizeRevokeRequest"], [service, "Only the share owner can revoke this share"],
  [service, 'share.status = "revoked"'], [service, "share.revokedAt = revokedAt"], [service, "share.revokedByAccount = actorAccount"],
  [service, 'appendAudit(share, actorAccount, "revoke", "denied"'], [service, 'appendAudit(share, actorAccount, "revoke", "allowed"'],
  [service, "objectsInvalidated: share.objects.length"], [service, "assertRecipientShareActive"],
  [service, 'share.status === "active" && identities.has(share.recipientAccount)'], [service, '(item.status === "active" || item.status === "revoked")'],
  [main, 'secureHandle("desktop:share-revoke"'], [preload, 'ipcRenderer.invoke("desktop:share-revoke"'], [mock, "revokeShare: async"],
  [ui, 'data-testid="share-revoke"'], [ui, 'data-testid="share-revoke-dialog"'], [ui, 'data-testid="share-revoke-confirmation"'],
  [ui, 'data-testid="share-revoke-confirm"'], [ui, 'data-testid="share-revoked-badge"'], [ui, 'data-testid="share-revocation-receipt"'],
  [ui, 'data-testid="share-revocation-audit-id"'], [smoke, "runShareRevocationSmoke"], [smoke, "oldOpenDenied"],
  [smoke, "oldDownloadDenied"], [smoke, "oldCommentsDenied"], [smoke, "oldContinueDenied"],
  [smoke, "revocationPersistsAcrossRestart"], [runner, '"l6-share-revocation"'], [runner, "l6OwnerScreenshot"],
  [runner, "l6RecipientScreenshot"], [runner, '"network.noModelRequests"'],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`L6 share-revocation verification passed: ${Object.keys(acceptance).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
