import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const api = read("src/shared/desktopApi.ts");
const app = read("src/renderer/src/App.tsx");
const queue = read("src/renderer/src/components/SkillSquareView.tsx");
const styles = read("src/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const packaged = read("scripts/verify-packaged-presentation-pdf-action.mjs");

const checks = {
  unifiedStatusContract: /type DesktopBackgroundTaskStatus/.test(api)
    && /"queued"/.test(api)
    && /"running"/.test(api)
    && /"waiting_approval"/.test(api)
    && /"completed"/.test(api)
    && /"failed"/.test(api),
  defaultTaskCenterEntry: /activeNav === MENU_IDS\.savedPlan/.test(app)
    && /TaskCenterView/.test(app),
  taskCenterPollsAuthoritativeStore: /listBackgroundTasks\(\{ workspacePath, limit: 50 \}\)/.test(app)
    && /setInterval\(\(\) => void refresh\(\), 1000\)/.test(app),
  fiveUserStates: /"waiting" \| "running" \| "needs_decision" \| "success" \| "failure"/.test(queue),
  userLanguageLabels: ["等待中", "进行中", "需要决定", "已完成", "未完成"].every((label) => queue.includes(label)),
  listAndDetailShareMapping: /const state = getTaskStatePresentation\(task, language\)/.test(queue)
    && /background-task-list-status/.test(queue)
    && /background-task-detail-status/.test(queue),
  taskIdentityAndRawStateExposedForVerification: /data-task-id=\{task\.id\}/.test(queue)
    && /data-task-status=\{task\.status\}/.test(queue),
  nonColorStatusCues: /state\.symbol/.test(queue)
    && /background-task-state-badge/.test(queue),
  fiveDistinctVisualRules: ["waiting", "running", "needs_decision", "success", "failure"]
    .every((state) => styles.includes(`user-state-${state}`)),
  statusDetailsExplainNextStep: /当前步骤/.test(queue)
    && /接下来/.test(queue)
    && /nextAction/.test(queue),
  packagedFiveStateMatrix: /fiveUserStatesVisible/.test(smoke)
    && /listAndDetailStatusConsistent/.test(smoke)
    && /uiAndUnderlyingStatusConsistent/.test(smoke)
    && /statusMatrixRunStarted/.test(smoke),
  packagedRejectsStaleRunning: /completedTaskNotStaleRunning/.test(smoke),
  packagedRejectsRawLabels: /noRawStatusAsVisibleLabel/.test(smoke),
  cernScenarioRegistered: /"status-matrix"/.test(packaged),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`E2 unified task status contract failed: ${failed.join(", ")}`);
console.log(JSON.stringify({ ok: true, checks }, null, 2));
