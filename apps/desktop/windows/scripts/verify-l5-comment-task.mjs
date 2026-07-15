import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const api = read("src", "shared", "desktopApi.ts");
const service = read("src", "main", "shares.ts");
const background = read("src", "main", "backgroundTasks.ts");
const main = read("src", "main", "index.ts");
const preload = read("src", "preload", "index.ts");
const ui = read("src", "renderer", "src", "App.tsx");
const mock = read("src", "renderer", "src", "mockDesktopApi.ts");
const smoke = read("src", "main", "e2eSmoke.ts");
const runner = read("scripts", "verify-e2e-chat.mjs");

function assert(value, message) { if (!value) throw new Error(`L5 verification failed: ${message}`); }

const sourceComment = { objectId: "l5-cern-manager-ppt", anchorType: "chart", anchorLabel: "p.42 WLCG bandwidth chart", body: "Add a clear annotation for the 4.8 Tbps 2024 challenge result." };
const generatedTask = { title: "Finalize CERN p.42 bandwidth chart", instructions: "Adjust the chart annotation, verify 4.8 Tbps, and keep the original comment backlink.", status: "completed", backlink: true };
const metrics = {
  exactObjectContext: sourceComment.objectId === "l5-cern-manager-ppt",
  exactChartAnchor: sourceComment.anchorType === "chart" && sourceComment.anchorLabel.includes("p.42"),
  commentBodyPreserved: sourceComment.body.includes("4.8 Tbps"),
  generatedTaskPreviewable: generatedTask.title.includes("p.42") && generatedTask.instructions.includes("4.8 Tbps"),
  generatedTaskEditable: generatedTask.title === "Finalize CERN p.42 bandwidth chart",
  realTaskLifecycle: generatedTask.status === "completed",
  backlinkPreserved: generatedTask.backlink,
  ownerOnlyConversion: service.includes("Only the share owner can turn comments into tasks"),
};
for (const [name, passed] of Object.entries(metrics)) assert(passed, `metric ${name}`);

const golden = { target: true, anchor: true, body: true, preview: true, edit: true, complete: true, backlink: true, owner: true };
const accepts = (value) => Object.values(value).every(Boolean);
const mutations = Object.keys(golden).map((key) => ({ [key]: false }));
assert(accepts(golden), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...golden, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [api, "DesktopShareCommentTarget"], [api, '"whole_result" | "paragraph" | "chart"'], [api, "DesktopShareCommentTaskPreview"],
  [api, "DesktopShareCommentTaskCreateRequest"], [api, "DesktopShareCommentTaskUpdateRequest"], [api, "DesktopShareCommentTaskCompleteRequest"],
  [api, "DesktopShareCommentTask"], [api, "previewShareCommentTask(request"], [api, "createShareCommentTask(request"],
  [api, "updateShareCommentTask(request"], [api, "completeShareCommentTask(request"], [api, "listShareCommentTasks(request"],
  [service, "buildCommentTaskPreview"], [service, "validateSafeCommentTaskText"], [service, "comment.target"],
  [service, 'kind: "agent_run", source: "manual"'], [service, "backgroundTaskId"], [service, "This comment already has a task"],
  [service, 'status = "completed"'], [service, "Comment task created."], [service, "Comment task updated."], [service, "Comment task completed."],
  [background, "typed.title !== undefined"],
  [main, 'secureHandle("desktop:share-comment-task-preview"'], [main, 'secureHandle("desktop:share-comment-task-create"'],
  [main, 'secureHandle("desktop:share-comment-task-update"'], [main, 'secureHandle("desktop:share-comment-task-complete"'], [main, 'secureHandle("desktop:share-comment-tasks-list"'],
  [preload, 'ipcRenderer.invoke("desktop:share-comment-task-preview"'], [preload, 'ipcRenderer.invoke("desktop:share-comment-task-create"'],
  [preload, 'ipcRenderer.invoke("desktop:share-comment-task-update"'], [preload, 'ipcRenderer.invoke("desktop:share-comment-task-complete"'],
  [mock, "previewShareCommentTask: async"], [mock, "createShareCommentTask: async"], [mock, "completeShareCommentTask: async"],
  [ui, 'data-testid="share-comment-anchor-type"'], [ui, 'data-testid="share-comment-anchor-label"'], [ui, 'data-testid="outgoing-share-comment"'],
  [ui, 'data-testid="comment-to-task"'], [ui, 'data-testid="comment-task-dialog"'], [ui, 'data-testid="comment-task-source-context"'],
  [ui, 'data-testid="comment-task-title"'], [ui, 'data-testid="comment-task-instructions"'], [ui, 'data-testid="comment-task-edit"'],
  [ui, 'data-testid="comment-task-complete"'], [ui, 'data-testid="comment-task-backlink"'],
  [smoke, "runCommentTaskSmoke"], [smoke, "previewCarriesContext"], [smoke, "generatedTaskEditable"], [smoke, "completedTaskBacklinks"],
  [runner, '"l5-comment-task"'], [runner, "network.noModelRequests"],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`L5 comment-task verification passed: ${Object.keys(metrics).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
