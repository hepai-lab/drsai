import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const parserPath = join(root, "src", "renderer", "src", "naturalLanguageSchedule.ts");
const componentPath = join(root, "src", "renderer", "src", "components", "TaskCenterView.tsx");
const apiPath = join(root, "src", "shared", "desktopApi.ts");
const servicePath = join(root, "src", "main", "scheduledTasks.ts");
const parserSource = readFileSync(parserPath, "utf8");
const component = readFileSync(componentPath, "utf8");
const api = readFileSync(apiPath, "utf8");
const service = readFileSync(servicePath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(`K1 verification failed: ${message}`);
}

const js = ts.transpileModule(parserSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/^import[^;]+;\s*/gm, "");
const parser = await import(`${pathToFileURL(parserPath).href.replace(/\.ts$/, ".runtime.mjs")}?source=${encodeURIComponent(js)}`)
  .catch(async () => import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`));

const workspace = "C:\\K1-CERN\\WLCG-20260715";
const mondayMorning = new Date("2026-07-13T08:00:00+08:00");
const draft = parser.parseNaturalLanguageSchedule(
  "每周一上午九点检查这个文件夹的新数据",
  workspace,
  mondayMorning,
);

const metrics = {
  exactSentenceParsed: draft.cadence === "weekly",
  readableTime: draft.definition.weekday === 1 && draft.definition.localTime === "09:00" && draft.definition.timeDescription === "每周一 09:00",
  workspaceResolved: draft.target === workspace && draft.definition.materialDescription.includes(workspace),
  actionResolved: draft.definition.actionDescription === "检查文件夹中的新数据",
  notificationResolved: draft.definition.notificationDescription.includes("Windows 通知"),
  nextRunCorrect: draft.nextRunAt === "2026-07-13T01:00:00.000Z",
  explicitConfirmationGate: component.includes('data-testid="schedule-confirmation"') && component.includes('data-testid="schedule-confirm-save"') && component.indexOf("parseNaturalLanguageSchedule") < component.indexOf("createScheduledTask"),
  persistedViewAndEdit: component.includes('data-testid="saved-schedule-item"') && component.includes('data-testid="schedule-edit-form"') && component.includes("updateScheduledTask"),
};
for (const [name, passed] of Object.entries(metrics)) assert(passed, `metric ${name} did not pass`);

for (const invalid of [
  "", "检查这个文件夹的新数据", "每周一上午九点检查数据", "每周一检查这个文件夹", "明天检查这个文件夹",
  "每月一号检查这个文件夹", "每周一二十五点检查这个文件夹", "每周一上午九点检查邮箱",
]) {
  let rejected = false;
  try { parser.parseNaturalLanguageSchedule(invalid, workspace, mondayMorning); } catch { rejected = true; }
  assert(rejected, `negative input was accepted: ${invalid || "<empty>"}`);
}

const contracts = [
  [api, "DesktopScheduledTaskUserDefinition"], [api, "userDefinition?: DesktopScheduledTaskUserDefinition"],
  [api, "title?: string"], [api, "cadence?: DesktopScheduledTaskCadence"], [api, "target?: string"],
  [service, "normalizeUserDefinition"], [service, "isUserDefinition"], [service, "writeScheduledTaskStore"],
  [service, "userDefinition: { ...task.userDefinition }"], [component, "每周一上午九点检查这个文件夹的新数据"],
  [component, "请确认这项安排"], [component, "时间"], [component, "材料"], [component, "动作"],
  [component, "通知"], [component, "确认并保存"], [component, "已保存的安排"], [component, "编辑"],
  [component, "getNextWeeklyRunAt"], [component, "userDefinition"],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`K1 natural-language schedule verification passed: ${Object.keys(metrics).length}/8 metrics, 8/8 negative cases, ${contracts.length}/${contracts.length} contracts.`);
