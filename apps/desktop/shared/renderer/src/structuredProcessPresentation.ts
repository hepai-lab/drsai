import type {
  OaepResourceRef,
} from "@shared/oaep.generated";
import type {
  ProgressPart,
  StructuredActivityEvent,
  StructuredTurnState,
} from "@shared/structuredConversation";
import { userFacingBusinessText } from "./userFacingLanguage";
import { formatWebSearchActivitySummary } from "./webSearchPresentation";

export type ProcessLanguage = "en" | "zh";

export interface ProcessCount {
  key: "operations" | "files" | "approvals" | "subtasks" | "artifacts";
  label: string;
  count: number;
}

export interface ProcessActivityGroup {
  id: string;
  kind: StructuredActivityEvent["kind"];
  status: StructuredActivityEvent["status"];
  label: string;
  count: number;
  durationMs?: number;
  fileNames: string[];
  fileResources: Array<{ name: string; resourceRef: OaepResourceRef }>;
  itemIds: string[];
  toolName?: string;
}

export interface ProcessProgressGroup {
  id: string;
  status: ProgressPart["status"];
  summary: string;
  count: number;
  completed?: number;
  total?: number;
}

export interface StructuredProcessPresentation {
  counts: ProcessCount[];
  activityGroups: ProcessActivityGroup[];
  progressGroups: ProcessProgressGroup[];
  operationCount: number;
  changedFileCount: number;
  currentActivity?: string;
  completionSummary?: string;
}

export function buildStructuredProcessPresentation(
  turn: StructuredTurnState,
  language: ProcessLanguage,
): StructuredProcessPresentation {
  const toolActivities = turn.activities.filter((activity) => activity.kind === "tool");
  const fileActivities = turn.activities.filter((activity) => activity.kind === "file_change");
  const changedFiles = new Set(fileActivities.map((activity) => activity.kind === "file_change" ? activity.path : "").filter(Boolean));
  const operationCount = toolActivities.length;
  // "已完成 N 项操作" must only count tools that actually reported success:
  // failed / cancelled / unconfirmed executions are surfaced separately so the
  // summary cannot claim a turn succeeded when tools errored.
  const failedOperationCount = toolActivities.filter((activity) => activity.status === "error" || activity.status === "cancelled").length;
  const approvalCount = turn.parts.filter((part) => part.kind === "interaction" && part.interactionType === "approval").length;
  const subtaskCount = turn.activities.filter((activity) => activity.kind === "subtask").length
    + turn.parts.filter((part) => part.kind === "subtask").length;
  const artifactCount = turn.parts.filter((part) => part.kind === "artifact").length;
  const counts = ([
    { key: "operations", label: language === "zh" ? "操作" : "Actions", count: operationCount },
    { key: "files", label: language === "zh" ? "文件" : "Files", count: changedFiles.size },
    { key: "approvals", label: language === "zh" ? "审批" : "Approvals", count: approvalCount },
    { key: "subtasks", label: language === "zh" ? "子任务" : "Subtasks", count: subtaskCount },
    { key: "artifacts", label: language === "zh" ? "产物" : "Artifacts", count: artifactCount },
  ] satisfies ProcessCount[]).filter((item) => item.count > 0);

  const active = [...turn.activities].reverse().find((activity) => activity.status === "pending" || activity.status === "running");
  const currentActivity = active ? formatActivitySummary(active, language) : undefined;
  const summaryChunks = language === "zh"
    ? [operationCount ? `${operationCount} 项操作` : "", changedFiles.size ? `${changedFiles.size} 个文件` : "", subtaskCount ? `${subtaskCount} 个子任务` : ""]
    : [operationCount ? `${operationCount} action${operationCount === 1 ? "" : "s"}` : "", changedFiles.size ? `${changedFiles.size} file${changedFiles.size === 1 ? "" : "s"}` : "", subtaskCount ? `${subtaskCount} subtask${subtaskCount === 1 ? "" : "s"}` : ""];
  const completionSummary = turn.status !== "running" && turn.status !== "pending" && summaryChunks.filter(Boolean).length
    ? failedOperationCount > 0
      ? (language === "zh"
        ? `共 ${operationCount} 项操作 · ${failedOperationCount} 项失败或未确认`
        : `${operationCount} action${operationCount === 1 ? "" : "s"} · ${failedOperationCount} failed or unconfirmed`)
      : (language === "zh" ? `已完成 ${summaryChunks.filter(Boolean).join(" · ")}` : `Completed ${summaryChunks.filter(Boolean).join(" · ")}`)
    : undefined;

  return {
    counts,
    activityGroups: aggregateActivities(turn.activities, language),
    progressGroups: aggregateProgress(turn.parts.filter((part): part is ProgressPart => part.kind === "progress")),
    operationCount,
    changedFileCount: changedFiles.size,
    currentActivity,
    completionSummary,
  };
}

export function formatActivitySummary(activity: StructuredActivityEvent, language: ProcessLanguage): string {
  if (activity.kind === "tool") {
    if (activity.toolCategory === "search" || activity.toolName === "web_search") return formatWebSearchActivitySummary(activity, language);
    const categoryLabels = language === "zh"
      ? { skill: "加载技能", todo: "更新任务清单", subagent: "分派子任务", config: "更新用户配置", schedule: "管理定时任务", shell: "执行终端命令", file: "处理文件" }
      : { skill: "Load skill", todo: "Update task list", subagent: "Delegate subtask", config: "Update user configuration", schedule: "Manage scheduled tasks", shell: "Run terminal command", file: "Handle file" };
    if (activity.toolCategory && activity.toolCategory in categoryLabels) {
      return categoryLabels[activity.toolCategory as keyof typeof categoryLabels];
    }
    return formatToolActivityLabel(activity.toolName, activity.title, language);
  }
  if (activity.kind === "model") return language === "zh" ? "正在生成" : "Generating";
  if (activity.kind === "retry") {
    return language === "zh"
      ? `正在重试 ${activity.attempt}/${activity.limit}`
      : `Retrying ${activity.attempt}/${activity.limit}`;
  }
  if (activity.kind === "file_change") {
    const name = fileName(activity.path);
    const actions = language === "zh"
      ? { create: "创建", modify: "修改", delete: "删除", rename: "重命名", patch: "更新" }
      : { create: "Create", modify: "Modify", delete: "Delete", rename: "Rename", patch: "Update" };
    return `${actions[activity.action]} ${name}`;
  }
  if (activity.kind === "subtask") return activity.agentName || activity.title;
  return activity.title || (language === "zh" ? "正在处理" : "Working");
}

function aggregateActivities(
  activities: StructuredActivityEvent[],
  language: ProcessLanguage,
): ProcessActivityGroup[] {
  const groups: ProcessActivityGroup[] = [];
  let previousKey = "";
  for (const activity of activities) {
    if (activity.kind === "model" || activity.kind === "log") continue;
    const key = activityGroupKey(activity, language);
    const previous = groups.at(-1);
    const durationMs = activity.kind === "tool" ? activity.durationMs : undefined;
    if (previous && previousKey === key && previous.status === activity.status) {
      previous.count += 1;
      if (durationMs !== undefined) previous.durationMs = (previous.durationMs ?? 0) + durationMs;
      if (activity.kind === "file_change") {
        const name = fileName(activity.path);
        previous.fileNames.push(name);
        if (activity.resourceRef) previous.fileResources.push({ name, resourceRef: activity.resourceRef });
      }
      if (activity.oaepItemId) previous.itemIds.push(activity.oaepItemId);
      continue;
    }
    previousKey = key;
    groups.push({
      id: `${key}:${groups.length}`,
      kind: activity.kind,
      status: activity.status,
      label: activityGroupLabel(activity, language),
      count: 1,
      ...(durationMs !== undefined ? { durationMs } : {}),
      fileNames: activity.kind === "file_change" ? [fileName(activity.path)] : [],
      fileResources: activity.kind === "file_change" && activity.resourceRef
        ? [{ name: fileName(activity.path), resourceRef: activity.resourceRef }]
        : [],
      itemIds: activity.oaepItemId ? [activity.oaepItemId] : [],
      ...(activity.kind === "tool" ? { toolName: activity.toolName } : {}),
    });
  }
  return groups;
}

function aggregateProgress(parts: ProgressPart[]): ProcessProgressGroup[] {
  const groups: ProcessProgressGroup[] = [];
  for (const part of parts) {
    const normalized = normalizeLabel(part.summary);
    const previous = groups.at(-1);
    if (previous && normalizeLabel(previous.summary) === normalized && previous.status === part.status) {
      previous.count += 1;
      previous.completed = part.completed ?? previous.completed;
      previous.total = part.total ?? previous.total;
      continue;
    }
    groups.push({
      id: `${part.phase || "progress"}:${normalized}:${groups.length}`,
      status: part.status,
      summary: part.summary,
      count: 1,
      completed: part.completed,
      total: part.total,
    });
  }
  return groups;
}

function activityGroupKey(activity: StructuredActivityEvent, language: ProcessLanguage): string {
  if (activity.kind === "file_change") return `file:${activity.action}`;
  if (activity.kind === "tool") return `tool:${normalizeLabel(activity.toolName)}`;
  if (activity.kind === "retry") return `retry:${activity.errorCode || "default"}`;
  if (activity.kind === "subtask") return `subtask:${normalizeLabel(activity.agentName || activity.title)}`;
  return `${activity.kind}:${normalizeLabel(formatActivitySummary(activity, language))}`;
}

function activityGroupLabel(activity: StructuredActivityEvent, language: ProcessLanguage): string {
  if (activity.kind !== "file_change") return formatActivitySummary(activity, language);
  const actions = language === "zh"
    ? { create: "创建文件", modify: "修改文件", delete: "删除文件", rename: "重命名文件", patch: "更新文件" }
    : { create: "Create files", modify: "Modify files", delete: "Delete files", rename: "Rename files", patch: "Update files" };
  return actions[activity.action];
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function formatToolActivityLabel(toolName: string, title: string, language: ProcessLanguage): string {
  const normalized = `${toolName} ${title}`.toLowerCase().replace(/[._:-]+/g, " ");
  const labels = language === "zh"
    ? [
        [/\b(search|lookup|query)\b/, "搜索信息"],
        [/\b(read|load|fetch|inspect|open)\b/, "读取资料"],
        [/\b(write|save|export|render|generate|create)\b/, "生成内容"],
        [/\b(edit|patch|update|modify)\b/, "修改内容"],
        [/\b(reflect|summari[sz]e|compose|synthesi[sz]e)\b/, "整理结果"],
        [/\b(install|setup)\b/, "准备运行环境"],
        [/\b(run|exec|command|shell|terminal)\b/, "执行任务步骤"],
      ] as const
    : [
        [/\b(search|lookup|query)\b/, "Search information"],
        [/\b(read|load|fetch|inspect|open)\b/, "Read materials"],
        [/\b(write|save|export|render|generate|create)\b/, "Create content"],
        [/\b(edit|patch|update|modify)\b/, "Modify content"],
        [/\b(reflect|summari[sz]e|compose|synthesi[sz]e)\b/, "Organize results"],
        [/\b(install|setup)\b/, "Prepare environment"],
        [/\b(run|exec|command|shell|terminal)\b/, "Run task step"],
      ] as const;
  const matched = labels.find(([pattern]) => pattern.test(normalized));
  if (matched) return matched[1];
  const friendlyTitle = userFacingBusinessText(title, "");
  if (friendlyTitle && !/^[a-z0-9_.:-]+$/i.test(friendlyTitle)) return friendlyTitle;
  const humanized = toolName.replace(/[._:-]+/g, " ").replace(/\s+/g, " ").trim();
  return userFacingBusinessText(humanized, language === "zh" ? "执行任务步骤" : "Run task step");
}
