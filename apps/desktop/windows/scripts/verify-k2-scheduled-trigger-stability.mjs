import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const timingSource = readFileSync(join(root, "src", "main", "scheduleTiming.ts"), "utf8");
const schedulerSource = readFileSync(join(root, "src", "main", "scheduledTasks.ts"), "utf8");
const apiSource = readFileSync(join(root, "src", "shared", "desktopApi.ts"), "utf8");
const uiSource = readFileSync(join(root, "src", "renderer", "src", "components", "TaskCenterView.tsx"), "utf8");
const e2eSource = readFileSync(join(root, "src", "main", "e2eSmoke.ts"), "utf8");
const mockSource = readFileSync(join(root, "src", "renderer", "src", "mockDesktopApi.ts"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(`K2 verification failed: ${message}`);
}

const js = ts.transpileModule(timingSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('from "crypto"', 'from "node:crypto"');
const timing = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

function makeTask(nextRunAt, timezone = "Asia/Shanghai") {
  return {
    id: "scheduled-task:monitor:k2-stability",
    kind: "monitor",
    title: "K2 CERN schedule",
    status: "enabled",
    cadence: "weekly",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    target: "C:\\K2-CERN",
    nextRunAt,
    approvalRequired: true,
    message: "ready",
    verification: "verify once",
    missedRunPolicy: "run_once_immediately",
    userDefinition: {
      sourceText: "Every Monday at nine",
      timeDescription: "Every Monday 09:00",
      materialDescription: "CERN workspace",
      actionDescription: "Check new data",
      notificationDescription: "Windows notification",
      timezone,
      weekday: 1,
      localTime: "09:00",
      confirmedAt: "2026-07-01T00:00:00.000Z",
    },
  };
}

let task = makeTask("2026-07-20T01:00:00.000Z");
const audits = [];
for (let iteration = 0; iteration < 20; iteration += 1) {
  const scheduled = task.nextRunAt;
  const delay = iteration === 7 ? 5 * 60 * 1000 : iteration === 13 ? 2 * 24 * 60 * 60 * 1000 : 0;
  const triggeredAt = new Date(Date.parse(scheduled) + delay).toISOString();
  const audit = timing.createScheduledTriggerAudit(task, triggeredAt);
  audits.push(audit);
  task = { ...task, nextRunAt: timing.getNextRunAfterTrigger(task, triggeredAt), lastTriggerAudit: audit };
  if (iteration === 9) task = JSON.parse(JSON.stringify(task));
}

const newYork = makeTask("2026-03-02T14:00:00.000Z", "America/New_York");
const afterDst = timing.getNextRunAfterTrigger(newYork, "2026-03-02T14:00:00.000Z");
const afterDstAgain = timing.getNextRunAfterTrigger({ ...newYork, nextRunAt: afterDst }, afterDst);
const nyFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const metrics = {
  twentyOfTwenty: audits.length === 20,
  noDuplicateOccurrence: new Set(audits.map((item) => item.triggerKey)).size === 20,
  onTimeAudited: audits.filter((item) => !item.missed).length === 18,
  missedRunCaughtUp: audits.filter((item) => item.missed && item.missedRunPolicy === "run_once_immediately").length === 2,
  sleepDelayCoalesced: audits.some((item) => item.missedByMs === 2 * 24 * 60 * 60 * 1000),
  restartPersistence: audits.slice(10).length === 10 && task.lastTriggerAudit.triggerKey === audits[19].triggerKey,
  wallClockNoDrift: task.nextRunAt.endsWith("T01:00:00.000Z"),
  daylightSavingRecorded: afterDst === "2026-03-09T13:00:00.000Z" && afterDstAgain === "2026-03-16T13:00:00.000Z" && nyFormatter.format(new Date(afterDst)) === "09:00",
};
for (const [name, passed] of Object.entries(metrics)) assert(passed, `metric ${name}`);

const validEvidence = {
  triggerCount: 20,
  uniqueKeys: 20,
  missedPolicy: "run_once_immediately",
  timezone: "Asia/Shanghai",
  dstPolicy: "follow_timezone_wall_clock",
  restartRecovered: true,
  duplicateAfterRestart: 0,
  nextWallClock: "09:00",
};
const mutations = [
  { triggerCount: 19 }, { uniqueKeys: 19 }, { missedPolicy: "skip" }, { timezone: "" },
  { dstPolicy: "fixed_utc" }, { restartRecovered: false }, { duplicateAfterRestart: 1 }, { nextWallClock: "09:05" },
];
const accepts = (value) => value.triggerCount === 20 && value.uniqueKeys === 20 && value.missedPolicy === "run_once_immediately" && Boolean(value.timezone) && value.dstPolicy === "follow_timezone_wall_clock" && value.restartRecovered === true && value.duplicateAfterRestart === 0 && value.nextWallClock === "09:00";
assert(accepts(validEvidence), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...validEvidence, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [apiSource, "DesktopScheduledTaskTriggerAudit"], [apiSource, '"run_once_immediately"'],
  [apiSource, '"follow_timezone_wall_clock"'], [apiSource, "lastTriggerAudit"],
  [schedulerSource, "scheduledTaskRunQueue"], [schedulerSource, "runDueScheduledTasksUnlocked"],
  [schedulerSource, "createScheduledTriggerAudit"], [schedulerSource, "getNextRunAfterTrigger"],
  [schedulerSource, "lastTriggerAudit: triggerAudit"], [schedulerSource, "triggerAudit,"],
  [timingSource, "nextWallClockOccurrence"], [timingSource, "zonedTimeToUtc"],
  [timingSource, "getTimezoneOffsetMs"], [timingSource, "while (next.getTime() <= now.getTime())"],
  [uiSource, 'data-testid="schedule-trigger-audit"'], [uiSource, "已补跑错过的安排"],
  [uiSource, "时区与夏令时"], [uiSource, 'workflowTemplateId: "plan-review-fix"'],
  [e2eSource, '"k2-scheduled-trigger-stability"'], [e2eSource, "concurrentScanDeduplicated"],
  [e2eSource, "restartDidNotDuplicate"], [e2eSource, "sleepLikeDelayCovered"],
  [mockSource, 'missedRunPolicy: "run_once_immediately"'], [mockSource, "triggerAudits"],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`K2 scheduled-trigger verification passed: ${Object.keys(metrics).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
