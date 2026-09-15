import type { DesktopHealth } from "@shared/desktopApi";
import type { AppLanguage } from "./navigation";

export function formatUpdateStatus(
  health: DesktopHealth | null,
  language: AppLanguage,
): string {
  const zh = language === "zh";
  if (!health) return zh ? "未检查" : "not checked";
  if (health.update.phase === "rolled-back")
    return zh
      ? `新版本 ${health.update.version ?? ""} 未能正常启动，已自动恢复到可用版本 ${health.update.currentVersion}。你的账户、任务、工作区和文件未受影响。`
      : `Version ${health.update.version ?? ""} could not start, so OpenDrSai automatically restored working version ${health.update.currentVersion}. Your account, tasks, workspace, and files were not affected.`;
  if (health.update.error) return health.update.error;
  if (health.update.downloaded)
    return zh ? `已下载，待安装 ${health.update.version ?? ""}` : `ready to install ${health.update.version ?? ""}`;
  if (health.update.downloading)
    return zh ? `正在下载 ${health.update.version ?? ""}` : `downloading ${health.update.version ?? ""}`;
  if (health.update.checking) return zh ? "正在检查" : "checking";
  if (health.update.available)
    return zh ? `可更新 ${health.update.version ?? ""}` : `available ${health.update.version ?? ""}`;
  return zh ? "未检查" : "not checked";
}
