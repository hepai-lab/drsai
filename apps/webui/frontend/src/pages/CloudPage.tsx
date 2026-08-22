import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  FileText,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  File,
  Eye,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { appContext } from "../hooks/provider";
import { useCloudFilesStore, type CloudFile } from "../store/cloudFiles";
import { cloudAPI } from "../components/views/api";
import CloudPanel from "../components/cloud-panel/CloudPanel";

const STATUS_DOT: Record<string, string> = {
  connected: "🟢",
  disconnected: "🔴",
  checking: "🟡",
  error: "🔴",
};
const STATUS_LABEL: Record<string, string> = {
  connected: "已连接",
  disconnected: "未连接",
  checking: "检测中…",
  error: "连接异常",
};

type CloudTab = "recent" | "mine";

const CloudPage: React.FC = () => {
  const { user } = useContext(appContext);
  const connectionStatus = useCloudFilesStore((s) => s.connectionStatus);
  const connectionError = useCloudFilesStore((s) => s.connectionError);
  const mountPath = useCloudFilesStore((s) => s.mountPath);
  const setConnectionStatus = useCloudFilesStore((s) => s.setConnectionStatus);
  const setConnectionError = useCloudFilesStore((s) => s.setConnectionError);
  const setMountPath = useCloudFilesStore((s) => s.setMountPath);
  const setLastSyncTime = useCloudFilesStore((s) => s.setLastSyncTime);

  const recentFiles = useCloudFilesStore((s) => s.recentFiles);
  const recentFilesLoading = useCloudFilesStore((s) => s.recentFilesLoading);
  const setRecentFiles = useCloudFilesStore((s) => s.setRecentFiles);
  const setRecentFilesLoading = useCloudFilesStore((s) => s.setRecentFilesLoading);
  const removeRecentFile = useCloudFilesStore((s) => s.removeRecentFile);
  const [activeTab, setActiveTab] = useState<CloudTab>("mine");

  // Refresh GFS status when the page opens — auto-provision if disconnected.
  // On F5: force a config refresh from OpenAPI *before* checkStatus so the
  // /cloud/status response reflects the latest credentials (bypasses TTL).
  useEffect(() => {
    let cancelled = false;
    const userId = (user as { email?: string } | null)?.email ?? "";

    const refresh = async () => {
      setConnectionStatus("checking");
      try {
        // Step 1: force OpenAPI refresh → updates DB, resets TTL timer
        try { await cloudAPI.refreshSync(userId || undefined); } catch { /* best-effort */ }

        if (cancelled) return;

        // Step 2: now checkStatus returns the freshest DB state
        let status = await cloudAPI.checkStatus(userId || undefined);
        if (cancelled) return;

        // If disconnected and we have a user, try provisioning once
        if (!status.connected && userId) {
          try {
            await cloudAPI.provision(userId);
          } catch (err) {
            if (!cancelled) {
              setConnectionError(err instanceof Error ? err.message : "GFS 配置失败，请稍后重试");
              setConnectionStatus("error");
            }
            return;
          }
          if (cancelled) return;
          // Re-check after provision
          status = await cloudAPI.checkStatus(userId || undefined);
          if (cancelled) return;

          // Provisioning created new config — refresh one more time to sync favourites etc.
          if (status.connected) {
            try { await cloudAPI.refreshSync(userId || undefined); } catch { /* best-effort */ }
          }
        }

        setConnectionStatus(status.connected ? "connected" : "disconnected");
        setMountPath(status.mountPath);
        setLastSyncTime(status.lastSyncTime);
        console.log(
          "[CloudPage] checkStatus response:",
          JSON.stringify({
            connected: status.connected,
            bucket_name: status.bucket_name,
            access_key: status.access_key ? status.access_key.slice(0, 8) + "***" : "NONE",
            buckets: status.buckets?.map((b: any) => b.bucket_name),
          })
        );
      } catch (err) {
        if (!cancelled) {
          setConnectionError(err instanceof Error ? err.message : "网络异常，请检查连接");
          setConnectionStatus("error");
        }
      }
    };

    refresh();
    return () => {
      cancelled = true;
    };
  }, [(user as { email?: string } | null)?.email, setConnectionStatus, setMountPath, setLastSyncTime]);

  // ── 收藏：从 GFS favorites/ 拉取 ──────────────────────────────
  const fetchFavorites = useCallback(async () => {
    const userId = (user as { email?: string } | null)?.email ?? '';
    if (!userId || connectionStatus !== 'connected') return;
    setRecentFilesLoading(true);
    try {
      const files = await cloudAPI.listFiles('favorites', userId);
      const mapped: CloudFile[] = files.map((f: any) => ({
        name: f.name,
        path: f.path,
        size: f.size || 0,
        type: f.type || 'file',
        suffix: f.suffix || f.name?.split('.').pop()?.toLowerCase() || '',
        syncStatus: 'synced' as const,
        updatedAt: f.updatedAt || null,
      }));
      setRecentFiles(mapped);
    } catch (err) {
      console.error('获取收藏列表失败:', err);
    } finally {
      setRecentFilesLoading(false);
    }
  }, [(user as { email?: string } | null)?.email, connectionStatus, setRecentFiles, setRecentFilesLoading]);

  // 切到「我的收藏」tab 时拉取；首次连接成功也主动拉取（F5 后自动显示）
  useEffect(() => {
    if (connectionStatus === 'connected') {
      fetchFavorites();
    }
  }, [connectionStatus, fetchFavorites]);
  useEffect(() => {
    if (activeTab === 'recent') {
      fetchFavorites();
    }
  }, [activeTab, fetchFavorites]);

  // GFS 删除收藏文件
  const handleRemoveFavorite = useCallback(async (path: string) => {
    const userId = (user as { email?: string } | null)?.email ?? '';
    // 先从本地移除（乐观更新）
    removeRecentFile(path);
    try {
      await cloudAPI.deleteFile(path, { userId });
    } catch (err) {
      console.error('删除收藏失败:', err);
      // 删除失败时重新拉取列表
      fetchFavorites();
    }
  }, [user, removeRecentFile, fetchFavorites]);

  const tabs: { id: CloudTab; label: string }[] = [
    { id: "recent", label: "我的收藏" },
    { id: "mine", label: "我的云盘" },
  ];

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Header — always above tabs */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border-primary/20">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-primary">云盘（GFS）</h2>
          <span
            title={`GFS ${STATUS_LABEL[connectionStatus] ?? "未知"}${mountPath ? `\n${mountPath}` : ""}${connectionError ? `\n${connectionError}` : ""}`}
            className="text-xs leading-none cursor-default"
          >
            {STATUS_DOT[connectionStatus] ?? "⚪"}
          </span>
          <span className="text-xs text-secondary">
            {STATUS_LABEL[connectionStatus] ?? "未知"}
          </span>
          {connectionStatus === "disconnected" && (
            <span className="text-xs text-secondary">
              · 请前往{" "}
              <a href="https://gfs.ihep.ac.cn" target="_blank" rel="noreferrer" className="text-accent underline">
                gfs.ihep.ac.cn
              </a>
              {" "}获取密钥后配置 AK/SK/Bucket
            </span>
          )}
          {mountPath && (
            <span className="text-xs text-tertiary truncate max-w-[480px]" title={mountPath}>
              · {mountPath}
            </span>
          )}
          {connectionError && (
            <span className="text-xs text-secondary truncate max-w-[400px]">
              · {connectionError.split(/(https?:\/\/\S+)/g).map((part, i) =>
                /^https?:\/\//.test(part) ? (
                  <a key={i} href={part} target="_blank" rel="noreferrer"
                    className="text-purple-400 underline hover:text-purple-300">
                    {part}
                  </a>
                ) : part
              )}
            </span>
          )}
        </div>
        {/* <button
          type="button"
          disabled
          title="打开挂载卷（即将上线）"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-accent/40 cursor-not-allowed border border-border-primary/30"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>打开挂载卷</span>
        </button> */}
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 flex items-stretch border-b border-border-primary/20 px-4">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${isActive
                ? "text-accent"
                : "text-secondary hover:text-primary"
                }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "recent" ? (
          <RecentFilesList
            files={recentFiles}
            loading={recentFilesLoading}
            onRefresh={fetchFavorites}
            onRemove={handleRemoveFavorite}
          />
        ) : (
          <div className="h-full" style={{ zoom: 1.35 }}>
            <CloudPanel />
          </div>
        )}
      </div>
    </div>
  );
};

// ── 文件图标映射 ────────────────────────────────────────────────

const EXT_ICON: Record<string, React.ElementType> = {
  txt: FileText,
  md: FileText,
  py: FileCode,
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  json: FileJson,
  yaml: FileJson,
  yml: FileJson,
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
};

const EXT_COLOR: Record<string, string> = {
  txt: "text-blue-400",
  md: "text-blue-400",
  py: "text-yellow-400",
  ts: "text-cyan-400",
  tsx: "text-cyan-400",
  js: "text-yellow-400",
  jsx: "text-yellow-400",
  json: "text-orange-400",
  yaml: "text-orange-400",
  yml: "text-orange-400",
  csv: "text-green-400",
  xlsx: "text-green-400",
  png: "text-pink-400",
  jpg: "text-pink-400",
  jpeg: "text-pink-400",
  gif: "text-pink-400",
  svg: "text-pink-400",
  webp: "text-pink-400",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 收藏列表组件 ────────────────────────────────────────────────

const RecentFilesList: React.FC<{
  files: CloudFile[];
  loading: boolean;
  onRefresh: () => void;
  onRemove: (path: string) => void;
}> = ({ files, loading, onRefresh, onRemove }) => {
  const handlePreview = useCallback((f: CloudFile) => {
    window.dispatchEvent(
      new CustomEvent("drsai:cloud:previewFile", {
        detail: {
          name: f.name,
          remotePath: f.path,
          size: f.size,
          suffix: f.suffix,
        },
      })
    );
  }, []);

  // 加载中
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center select-none">
          <Loader2 className="w-6 h-6 mx-auto mb-2 text-accent animate-spin" />
          <p className="text-xs text-secondary opacity-60">加载收藏列表中…</p>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center select-none max-w-xs">
          <div className="text-4xl mb-3 opacity-25">⭐</div>
          <p className="text-sm text-secondary">还没有收藏过文件</p>
          <p className="mt-1 text-xs text-tertiary">
            在文件预览中点击「收藏」按钮即可收藏，收藏后可以随时在这里找到
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1 rounded text-xs text-accent hover:bg-accent/10 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            刷新
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-secondary">
            共 {files.length} 个文件
          </p>
          <button
            type="button"
            onClick={onRefresh}
            title="刷新收藏列表"
            className="p-1 rounded text-secondary hover:text-primary hover:bg-bg-tertiary transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-1.5">
          {files.map((f) => {
            const ext = f.suffix?.toLowerCase() || "";
            const Icon = EXT_ICON[ext] || File;
            const iconColor = EXT_COLOR[ext] || "text-secondary";
            return (
              <div
                key={f.path}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border-primary/15 bg-bg-secondary/30 hover:bg-bg-secondary/70 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => handlePreview(f)}
                title="点击预览"
              >
                {/* 文件图标 + 扩展名角标 */}
                <div className="flex-shrink-0 relative">
                  <div className={`${iconColor}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {ext && (
                    <span className="absolute -bottom-1 -right-2 text-[8px] font-semibold uppercase text-tertiary bg-bg-secondary/90 px-0.5 rounded">
                      {ext}
                    </span>
                  )}
                </div>

                {/* 文件信息 */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-primary font-medium truncate">
                    {f.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-secondary tabular-nums">
                      {formatFileSize(f.size)}
                    </span>
                    {f.updatedAt && (
                      <>
                        <span className="text-[10px] text-tertiary/40">·</span>
                        <span className="text-[10px] text-tertiary tabular-nums">
                          {formatTime(f.updatedAt)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex-shrink-0 flex items-center gap-1">
                  <button
                    type="button"
                    title="预览"
                    onClick={(e) => { e.stopPropagation(); handlePreview(f); }}
                    className="p-1.5 rounded-md text-accent hover:bg-accent/10 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="取消收藏"
                    onClick={(e) => { e.stopPropagation(); onRemove(f.path); }}
                    className="p-1.5 rounded-md text-secondary hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CloudPage;
