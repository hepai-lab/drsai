import { readFile, rm, stat } from "fs/promises";
import { homedir } from "os";
import { dirname, isAbsolute, parse, relative, resolve } from "path";
import type {
  DesktopDataCleanupPreview,
  DesktopDataCleanupRequest,
  DesktopDataCleanupResult,
  DesktopDataCleanupScope,
  WorkspaceProject,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";
import { cleanupAllVoiceTempFiles } from "./voiceTempFiles";

interface CleanupTarget {
  category: DesktopDataCleanupPreview["applicationData"][number]["category"];
  path: string;
}

const SESSION_TARGETS: CleanupTarget[] = [
  target("sessions", "desktop", "threads.json"),
  target("sessions", "desktop", "thread-snapshots.json"),
];

const ALL_LOCAL_DATA_TARGETS: CleanupTarget[] = [
  ...SESSION_TARGETS,
  target("account", "auth"),
  target("account", ".env"),
  target("settings", "config.yaml"),
  target("settings", "configs"),
  target("cache", "cache"),
  target("cache", "logs"),
  target("tasks", "desktop", "background-tasks.json"),
  target("tasks", "desktop", "manager-presentation-tasks.json"),
  target("tasks", "desktop", "reusable-tasks.json"),
  target("tasks", "desktop", "scheduled-tasks.json"),
  target("tasks", "desktop", "workflow-runs.json"),
  target("tasks", "desktop", "fork-worktrees"),
  target("tasks", "desktop", "workspace-checkpoints"),
  target("tasks", "desktop", "workspace-checkpoints.json"),
  target("memory", "desktop", "project-memory.json"),
  target("memory", "desktop", "team-memory.json"),
  target("memory", "desktop", "user-preferences.json"),
  target("settings", "desktop", "workspaces.json"),
  target("settings", "desktop", "completion-notifications.json"),
  target("settings", "desktop", "custom-commands.json"),
  target("settings", "desktop", "channel-connections.json"),
  target("settings", "desktop", "channel-deliveries.json"),
  target("settings", "desktop", "channel-inbound-events.json"),
  target("settings", "desktop", "channel-log-cursors.json"),
  target("settings", "desktop", "provider-error-analytics.json"),
  target("settings", "desktop", "provider-usage-analytics.json"),
  target("settings", "desktop", "shares.json"),
  target("settings", "desktop", "shares.lock"),
  target("settings", "desktop", "sanitized-shares"),
  target("settings", "desktop", "skill-drafts"),
  target("settings", "desktop", "installed-skills"),
];

export async function previewLocalDataCleanup(rawScope: unknown): Promise<DesktopDataCleanupPreview> {
  const scope = validateScope(rawScope);
  const workspaces = await readRegisteredWorkspaces();
  const categories = scope === "sessions"
    ? [{ category: "sessions" as const, label: "会话和会话消息", description: "清除聊天与智能体会话记录。" }]
    : [
        { category: "account" as const, label: "账户与登录", description: "清除本机登录凭据和服务密钥。" },
        { category: "sessions" as const, label: "会话", description: "清除会话和消息快照。" },
        { category: "cache" as const, label: "缓存与日志", description: "清除可重新生成的缓存和本机日志。" },
        { category: "memory" as const, label: "记忆", description: "清除个人、项目和团队记忆。" },
        { category: "tasks" as const, label: "任务", description: "清除后台、定时、复用任务和恢复点。" },
        { category: "settings" as const, label: "设置与连接", description: "清除工作区登记、偏好、分享和连接设置。" },
      ];
  return {
    scope,
    applicationData: categories,
    preservedUserMaterials: workspaces.map((workspace) => ({
      name: workspace.name,
      path: workspace.path,
      reason: "这是用户工作区；清理只移除 OpenDrSai 应用数据，不会删除其中的 PDF、PPT、数据文件或成果。",
    })),
    preservesAllWorkspaceFiles: true,
    confirmationPhrase: scope === "all_local_data" ? "清除" : undefined,
    requiresSignInAgain: scope === "all_local_data",
  };
}

export async function clearLocalData(rawRequest: unknown): Promise<DesktopDataCleanupResult> {
  const request = validateRequest(rawRequest);
  assertSafeHome(DRSAI_HOME);
  const workspaces = await readRegisteredWorkspaces();
  const targets = request.scope === "sessions" ? SESSION_TARGETS : ALL_LOCAL_DATA_TARGETS;
  const removedPaths: string[] = [];
  const protectedPaths = new Set(workspaces.map((workspace) => resolve(workspace.path)));
  const skippedTargets: string[] = [];

  for (const item of targets) {
    assertOwnedTarget(item.path);
    const protectedWorkspace = workspaces.find((workspace) => containsPath(item.path, workspace.path));
    if (protectedWorkspace) {
      protectedPaths.add(resolve(protectedWorkspace.path));
      skippedTargets.push(item.path);
      continue;
    }
    try {
      await stat(item.path);
    } catch {
      continue;
    }
    await rm(item.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    removedPaths.push(item.path);
  }

  if (request.scope === "all_local_data") cleanupAllVoiceTempFiles();

  return {
    ok: true,
    scope: request.scope,
    removedPaths,
    protectedWorkspacePaths: [...protectedPaths],
    skippedTargets,
    requiresSignInAgain: request.scope === "all_local_data",
    message: request.scope === "sessions"
      ? "会话数据已清除；工作区文件和成果未受影响。"
      : "OpenDrSai 应用数据已清除；用户工作区文件和成果未受影响。",
  };
}

function target(category: CleanupTarget["category"], ...segments: string[]): CleanupTarget {
  return { category, path: resolve(DRSAI_HOME, ...segments) };
}

function validateScope(value: unknown): DesktopDataCleanupScope {
  if (value !== "sessions" && value !== "all_local_data") throw new Error("Data cleanup scope is invalid.");
  return value;
}

function validateRequest(value: unknown): DesktopDataCleanupRequest {
  if (!value || typeof value !== "object") throw new Error("Data cleanup request is invalid.");
  const request = value as Partial<DesktopDataCleanupRequest>;
  const scope = validateScope(request.scope);
  const expected = scope === "sessions" ? "CLEAR_SESSIONS" : "DELETE_LOCAL_DATA";
  if (request.confirmation !== expected) throw new Error("Data cleanup confirmation did not match the requested scope.");
  return { scope, confirmation: expected };
}

async function readRegisteredWorkspaces(): Promise<WorkspaceProject[]> {
  try {
    const value = JSON.parse(await readFile(resolve(DRSAI_HOME, "desktop", "workspaces.json"), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is WorkspaceProject => Boolean(item && typeof item === "object" && typeof item.name === "string" && typeof item.path === "string" && isAbsolute(item.path)));
  } catch {
    return [];
  }
}

function assertSafeHome(path: string): void {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  if (resolved === root || resolved === resolve(homedir()) || resolved === resolve(dirname(homedir())) || resolved.length < root.length + 4) {
    throw new Error("Refusing to clear an unsafe application data root.");
  }
}

function assertOwnedTarget(path: string): void {
  const relation = relative(resolve(DRSAI_HOME), resolve(path));
  if (!relation || relation.startsWith("..") || isAbsolute(relation)) throw new Error("Refusing to clear a path outside OpenDrSai application data.");
}

function containsPath(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}
