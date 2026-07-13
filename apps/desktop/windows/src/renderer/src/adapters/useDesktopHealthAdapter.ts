import { useCallback, useEffect, useState } from "react";
import type { DesktopHealth, InstallProgress } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";

export interface DesktopHealthAdapter {
  actionMessage: string | null;
  apiKeyInput: string;
  busy: boolean;
  health: DesktopHealth | null;
  installProgress: InstallProgress | null;
  settingsMessage: string | null;
  refreshHealth: () => Promise<void>;
  setApiKeyInput: (value: string) => void;
  startInstall: (installPrerequisites?: boolean) => Promise<void>;
  cancelInstall: () => Promise<void>;
  startGateway: () => Promise<void>;
  stopGateway: () => Promise<void>;
  checkUpdates: () => Promise<void>;
  saveApiKey: () => Promise<void>;
}

export function useDesktopHealthAdapter(language: "en" | "zh" = "zh"): DesktopHealthAdapter {
  const [health, setHealth] = useState<DesktopHealth | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const zh = language === "zh";

  const refreshHealth = useCallback(async (): Promise<void> => {
    const [snapshot, install, gateway] = await Promise.all([
      desktopApi.getHealth(),
      desktopApi.getInstallStatus(),
      desktopApi.getGatewayStatus(),
    ]);
    setHealth({
      ...snapshot,
      installed: install.installed,
      gatewayReady: gateway.ready,
      version: install.version,
      install,
      gateway,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    desktopApi.getHealth().then((snapshot) => {
      if (!cancelled) setHealth(snapshot);
    }).catch(() => {
      if (!cancelled) setHealth(createFallbackHealth());
    });
    const timer = window.setTimeout(() => {
      void refreshHealth().catch(() => undefined);
    }, 750);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshHealth]);

  useEffect(() => {
    return desktopApi.onInstallProgress((progress) => {
      setInstallProgress(progress);
      if (progress.phase === "complete" || progress.phase === "error") {
        setBusy(false);
        refreshHealth();
      }
    });
  }, [refreshHealth]);

  useEffect(() => {
    return desktopApi.onUpdateStatus((update) => {
      setHealth((current) =>
        current ? { ...current, update } : { ...createFallbackHealth(), update },
      );
    });
  }, []);

  async function startInstall(installPrerequisites = false): Promise<void> {
    setBusy(true);
    setInstallProgress({
      phase: "running",
      message: installPrerequisites
        ? zh ? "正在启动安装器并自动安装依赖..." : "Starting installer with dependency bootstrap..."
        : zh ? "正在启动安装器..." : "Starting installer...",
      log: "",
    });
    try {
      await desktopApi.startInstall({ installPrerequisites });
    } catch (error) {
      setInstallProgress({
        phase: "error",
        message: error instanceof Error ? error.message : zh ? "安装器启动失败。" : "Installer failed to start.",
        log: "",
      });
      setBusy(false);
    }
  }

  async function cancelInstall(): Promise<void> {
    await desktopApi.cancelInstall();
  }

  async function startGateway(): Promise<void> {
    setBusy(true);
    setActionMessage(null);
    try {
      const started = await desktopApi.startGateway();
      await refreshHealth();
      setActionMessage(
        started
          ? zh ? "网关已启动。" : "Gateway started."
          : zh ? "网关未就绪，请查看诊断信息。" : "Gateway did not become ready. Open diagnostics for details.",
      );
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : zh ? "网关启动失败。" : "Gateway failed to start.");
    } finally {
      setBusy(false);
    }
  }

  async function stopGateway(): Promise<void> {
    setBusy(true);
    setActionMessage(null);
    try {
      await desktopApi.stopGateway();
      await refreshHealth();
      setActionMessage(zh ? "网关已停止。" : "Gateway stopped.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : zh ? "网关停止失败。" : "Gateway failed to stop.");
    } finally {
      setBusy(false);
    }
  }

  async function checkUpdates(): Promise<void> {
    setBusy(true);
    setActionMessage(null);
    try {
      const update = await desktopApi.checkForUpdates();
      setHealth((current) =>
        current ? { ...current, update } : { ...createFallbackHealth(), update },
      );
      setActionMessage(
        update.available
          ? zh ? `发现可用更新：${update.version ?? "新版本"}。` : `Update available: ${update.version ?? "new version"}.`
          : zh ? "暂无可用更新。" : "No update available.",
      );
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : zh ? "更新检查失败。" : "Update check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveApiKey(): Promise<void> {
    setBusy(true);
    try {
      const result = await desktopApi.saveApiKey(apiKeyInput);
      setSettingsMessage(localizeKnownMessage(result.message, language));
      if (result.ok) {
        setApiKeyInput("");
        await refreshHealth();
      }
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : zh ? "保存 API key 失败。" : "Failed to save API key.");
    } finally {
      setBusy(false);
    }
  }

  return {
    actionMessage,
    apiKeyInput,
    busy,
    health,
    installProgress,
    settingsMessage,
    refreshHealth,
    setApiKeyInput,
    startInstall,
    cancelInstall,
    startGateway,
    stopGateway,
    checkUpdates,
    saveApiKey,
  };
}

function localizeKnownMessage(message: string, language: "en" | "zh"): string {
  if (language === "en") return message;
  const known: Record<string, string> = {
    "API key saved.": "API key 已保存。",
    "API key must be text.": "API key 必须是文本。",
    "API key cannot be empty.": "API key 不能为空。",
    "API key must be a single line.": "API key 必须是单行文本。",
    "Mock API key saved.": "模拟 API key 已保存。",
  };
  return known[message] ?? message;
}

export function createFallbackHealth(): DesktopHealth {
  const install = {
    installed: false,
    home: "",
    repoPath: "",
    pythonPath: "",
    scriptPath: "",
    version: null,
    expectedVersion: null,
    backendNeedsRepair: false,
    bundledBackendAvailable: false,
    configExists: false,
    envExists: false,
    apiKeyConfigured: false,
    prerequisites: {
      pythonOnPath: false,
      pythonVersion: null,
      pythonCommand: null,
      gitOnPath: false,
      gitVersion: null,
      gitCommand: null,
      apiKeyConfigured: false,
      problems: ["状态不可用。"],
    },
    missing: ["status"],
  };
  const gateway = {
    ready: false,
    managed: false,
    externalReady: false,
    externalConflict: false,
    baseUrl: "http://127.0.0.1:18642",
    pid: null,
    lastLog: "",
  };
  const update = {
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: null,
    version: null,
    error: "状态不可用。",
  };
  return {
    installed: false,
    gatewayReady: false,
    mode: "local",
    version: null,
    install,
    gateway,
    update,
  };
}
