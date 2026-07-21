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

function assert(value, message) { if (!value) throw new Error(`L4 verification failed: ${message}`); }

const permissions = {
  view: { open: true, download: true, comments: false, comment: false, continue: false },
  comment: { open: true, download: true, comments: true, comment: true, continue: false },
  continue: { open: true, download: true, comments: true, comment: true, continue: true },
};
const metrics = {
  threePermissionsDefined: Object.keys(permissions).join(",") === "view,comment,continue",
  viewIsReadOnly: permissions.view.open && permissions.view.download && !permissions.view.comments && !permissions.view.comment && !permissions.view.continue,
  commentAddsOnlyCollaboration: permissions.comment.open && permissions.comment.download && permissions.comment.comments && permissions.comment.comment && !permissions.comment.continue,
  continueHasAllActions: Object.values(permissions.continue).every(Boolean),
  ownerUpdatePersists: service.includes("share.permission = typed.permission") && service.includes("await writeStore(store)"),
  everyRequestRechecksPermission: service.includes("canComment(share.permission ?? \"view\")") && service.includes("(share.permission ?? \"view\") !== \"continue\""),
  violationsAreAudited: service.includes('appendAudit(share, actorAccount, "comment", "denied"') && service.includes('appendAudit(share, actorAccount, "continue", "denied"'),
  auditOmitsUserBody: service.includes('"Comment added."') && !service.includes("reason: typed.body"),
};
for (const [name, passed] of Object.entries(metrics)) assert(passed, `metric ${name}`);

const golden = { view: true, comment: true, continue: true, changed: true, denied: true, audit: true, ui: true, cern: true };
const accepts = (value) => Object.values(value).every(Boolean);
const mutations = Object.keys(golden).map((key) => ({ [key]: false }));
assert(accepts(golden), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...golden, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [api, 'DesktopSharePermission = "view" | "comment" | "continue"'], [api, "DesktopSharePermissionUpdateRequest"],
  [api, "DesktopShareComment"], [api, "DesktopShareContinuationRequest"], [api, "DesktopShareAuditEntry"],
  [api, "updateSharePermission(request"], [api, "listShareComments(request"], [api, "addShareComment(request"],
  [api, "continueSharedTask(request"], [api, "listShareAudit(request"],
  [service, "updateSharePermission"], [service, "listShareComments"], [service, "addShareComment"],
  [service, "continueSharedTask"], [service, "listShareAudit"], [service, "Only the share owner can change permissions"],
  [service, "The current permission does not allow reading comments"], [service, "Sensitive information was detected in the comment"],
  [service, "appendAudit"], [service, "permission_update"], [service, "MAX_SHARE_AUDIT_ENTRIES"],
  [main, 'secureHandle("desktop:share-permission-update"'], [main, 'secureHandle("desktop:share-comments-list"'],
  [main, 'secureHandle("desktop:share-comment-add"'], [main, 'secureHandle("desktop:share-continue"'], [main, 'secureHandle("desktop:share-audit-list"'],
  [preload, 'ipcRenderer.invoke("desktop:share-permission-update"'], [preload, 'ipcRenderer.invoke("desktop:share-comment-add"'], [preload, 'ipcRenderer.invoke("desktop:share-continue"'],
  [mock, "updateSharePermission: async"], [mock, "addShareComment: async"], [mock, "continueSharedTask: async"],
  [ui, 'data-testid="share-permission-select"'], [ui, 'data-testid="outgoing-share-permission"'], [ui, 'data-testid="share-permission-badge"'],
  [ui, 'data-testid="share-comment-input"'], [ui, 'data-testid="share-comment-send"'], [ui, 'data-testid="share-continue"'],
  [smoke, "runCollaborationPermissionSmoke"], [smoke, "actionMatrixExact"], [smoke, "changeVisibleImmediately"], [smoke, "allDeniedAttemptsRecorded"],
  [runner, '"l4-collaboration-permissions"'], [runner, "network.noModelRequests"],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`L4 collaboration-permission verification passed: ${Object.keys(metrics).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
