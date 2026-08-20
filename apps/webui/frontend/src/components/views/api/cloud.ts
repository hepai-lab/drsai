import { getServerUrl } from "../../utils";

export interface CloudFileEntry {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'directory';
  suffix?: string;
  syncStatus: 'synced' | 'syncing' | 'modified' | 'cloud-only' | 'error';
  updatedAt?: string;
  children?: CloudFileEntry[];
}

export interface CloudTemplateEntry {
  name: string;
  path: string;
  description?: string;
  suffix: string;
}

export interface CloudStatus {
  connected: boolean;
  mountPath: string;
  lastSyncTime: string | null;
}

export class CloudAPI {
  private getBaseUrl(): string {
    return getServerUrl();
  }

  private getHeaders(): HeadersInit {
    return { "Content-Type": "application/json" };
  }

  async provision(userId: string): Promise<{ endpoint: string; buckets: Array<{ bucket_name: string; access_key: string; secret_key: string }> }> {
    const res = await fetch(`${this.getBaseUrl()}/cloud/provision`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.detail || data.message || "GFS 配置失败");
    return data.data;
  }

  async checkStatus(userId?: string): Promise<CloudStatus> {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    const res = await fetch(`${this.getBaseUrl()}/cloud/status${qs}`, { headers: this.getHeaders() });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "检查连接状态失败");
    return data.data;
  }

  /** Trigger a synchronous GFS→local reconcile. Resolves after the bucket
   * has been re-walked and pulled, so callers can re-fetch the file list
   * immediately and see fresh state. */
  async refreshSync(userId?: string): Promise<{ synced: boolean; counts?: Record<string, number>; lastSyncTime?: string }> {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    const res = await fetch(`${this.getBaseUrl()}/cloud/refresh${qs}`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "同步失败");
    return data.data;
  }

  async listFiles(subPath?: string, userId?: string): Promise<CloudFileEntry[]> {
    const qs = new URLSearchParams();
    if (subPath) qs.set('path', subPath);
    if (userId) qs.set('user_id', userId);
    const qstr = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`${this.getBaseUrl()}/cloud/files${qstr}`, { headers: this.getHeaders() });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "获取文件列表失败");
    return data.data;
  }

  async listTemplates(userId?: string): Promise<CloudTemplateEntry[]> {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    const res = await fetch(`${this.getBaseUrl()}/cloud/templates${qs}`, { headers: this.getHeaders() });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "获取模板列表失败");
    return data.data;
  }

  async sendToAgent(params: { filePaths: string[]; sessionId: string }): Promise<void> {
    const res = await fetch(`${this.getBaseUrl()}/cloud/send-to-agent`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "发送给 Agent 失败");
  }

  async applyTemplate(params: { templatePath: string; sessionId: string }): Promise<{ content: string }> {
    const res = await fetch(`${this.getBaseUrl()}/cloud/apply-template`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "应用模板失败");
    return data.data;
  }

  async getFileUrl(filePath: string): Promise<{ url: string }> {
    const res = await fetch(`${this.getBaseUrl()}/cloud/file-url`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path: filePath }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "获取文件链接失败");
    return data.data;
  }

  /** Build a direct-download URL for a single GFS file.
   *  GET /cloud/download serves the file bytes (FileResponse), unlike
   *  /cloud/file-url which returns a GFS web-UI page URL. */
  getDownloadUrl(filePath: string, userId?: string): string {
    const normalized = filePath.replace(/^\/+/, '');
    const qs = new URLSearchParams({ path: normalized });
    if (userId) qs.set('user_id', userId);
    return `${this.getBaseUrl()}/cloud/download?${qs.toString()}`;
  }

  /** 在 GFS 上新建空文件夹 */
  async createFolder(parentPath: string, name: string, userId?: string): Promise<{ path: string; name: string }> {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    const res = await fetch(`${this.getBaseUrl()}/cloud/folder${qs}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ parentPath, name }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "创建文件夹失败");
    return data.data;
  }

  /** 重命名 GFS 文件或文件夹 */
  async renameFile(oldPath: string, newName: string, userId?: string): Promise<{ renamed: string; to: string }> {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    const res = await fetch(`${this.getBaseUrl()}/cloud/rename${qs}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ oldPath, newName }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "重命名失败");
    return data.data;
  }

  /** 移动 GFS 文件/文件夹到目标目录（拖拽） */
  async moveFile(sourcePath: string, targetDir: string, userId?: string): Promise<{ moved: boolean; renamed: string; to: string }> {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    const res = await fetch(`${this.getBaseUrl()}/cloud/move${qs}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ sourcePath, targetDir }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "移动失败");
    return data.data;
  }

  /** 把多个 GFS 文件拉到 DocMaster workspace，返回本地绝对路径 */
  async pullToWorkspace(paths: string[], userId: string): Promise<{ files: { remote: string; local: string; name: string }[]; errors: { path: string; error: string }[] }> {
    const res = await fetch(`${this.getBaseUrl()}/cloud/pull-to-workspace`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ paths, user_id: userId }),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "拉取文件失败");
    return data.data;
  }

  /** 上传本地文件到 GFS 桶（可选目标目录） */
  async uploadFiles(files: File[], destDir: string = "uploads", userId: string = ""): Promise<{ uploaded: { name: string; remote_path: string }[]; errors: { name: string; error: string }[] }> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    const qs = new URLSearchParams();
    if (userId) qs.set("user_id", userId);
    if (destDir) qs.set("dest_dir", destDir);
    const res = await fetch(`${this.getBaseUrl()}/cloud/upload?${qs.toString()}`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type — browser will set multipart boundary
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "上传失败");
    return data.data;
  }

  /** 删除 GFS 文件或目录 */
  async deleteFile(remotePath: string, opts: { userId?: string; recursive?: boolean } = {}): Promise<{ deleted: string }> {
    const qs = new URLSearchParams({ path: remotePath });
    if (opts.userId) qs.set("user_id", opts.userId);
    if (opts.recursive) qs.set("recursive", "true");
    const res = await fetch(`${this.getBaseUrl()}/cloud/files?${qs.toString()}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    const data = await res.json();
    if (!data.status) throw new Error(data.message || "删除失败");
    return data.data;
  }
}

export const cloudAPI = new CloudAPI();