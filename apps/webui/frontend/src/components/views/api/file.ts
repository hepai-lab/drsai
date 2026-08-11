import { getServerUrl } from "../../utils";

export class FileAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            // Don't set Content-Type for file uploads, let the browser set it with boundary
        };
    }

     async saveFilesToServer(
        userId: string,
        files: File[],
        sessionId: number
    ): Promise<any> {
        const formData = new FormData();

        // Add user_id and session_id as query parameters
        const url = `${this.getBaseUrl()}/files/?user_id=${encodeURIComponent(
            userId
        )}&session_id=${sessionId}`;

        // Add files to form data
        files.forEach((file) => {
            formData.append("files", file);
        });

        const response = await fetch(url, {
            method: "POST",
            headers: this.getHeaders(),
            body: formData,
        });

        if (!response.ok) {
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch (e) {
                // If response is not JSON, use status text
                errorMessage = response.statusText || errorMessage;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || data.detail || "Failed to upload files");
        }
        const raw = data.data;
        if (raw == null) {
            return [];
        }
        if (Array.isArray(raw)) {
            return raw;
        }
        // 兼容单对象或意外包装格式
        if (typeof raw === "object" && raw.name && raw.path) {
            return [raw];
        }
        return [];
    }

    async listUserFiles(userId: string, _sessionId: number = 0): Promise<
        Array<{
            name: string;
            type: string;
            path: string;
            suffix: string;
            size: number;
            uuid: string;
            url?: string;
        }>
    > {
        const url = `${this.getBaseUrl()}/files/${_sessionId}?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, { method: "GET" });
        if (!response.ok) {
            throw new Error(`Failed to list files: ${response.status}`);
        }
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || data.detail || "Failed to list files");
        }
        const raw = data.data;
        if (raw == null) {
            return [];
        }
        return Array.isArray(raw) ? raw : [];
    }

    async deleteUserFile(userId: string, fileUuid: string): Promise<void> {
        const url = `${this.getBaseUrl()}/files/item/${encodeURIComponent(
            fileUuid
        )}?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, { method: "DELETE" });
        if (!response.ok) {
            let errorMessage = `HTTP error! status: ${response.status}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch {
                errorMessage = response.statusText || errorMessage;
            }
            throw new Error(errorMessage);
        }
    }

    getDownloadUrl(userId: string, fileUuid: string): string {
        return `${this.getBaseUrl()}/files/download/${encodeURIComponent(
            fileUuid
        )}?user_id=${encodeURIComponent(userId)}`;
    }

    async editDocx(
        userId: string,
        fileName: string,
        originalParagraphs: string[],
        edits: Array<{
            type: string;
            old_text?: string;
            new_text?: string;
            text?: string;
            content?: string;
            formatting?: { bold?: boolean | null; italic?: boolean | null };
            position?: number;
        }>,
        fileUrl?: string | null,
        fileBase64?: string | null,
    ): Promise<{
        success: boolean;
        saved_name?: string;
        uuid?: string;
        path?: string;
        url?: string;
        changes?: string[];
        message?: string;
    }> {
        const url = `${this.getBaseUrl()}/files/docx/edit`;
        const body: Record<string, unknown> = {
            user_id: userId,
            file_name: fileName,
            original_paragraphs: originalParagraphs,
            edits: edits,
        };
        if (fileUrl) body.file_url = fileUrl;
        if (fileBase64) body.file_base64 = fileBase64;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const text = await response.text();
        let data: any;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(text || `Server error (${response.status})`);
        }
        if (!data.status) {
            const detail = data.detail;
            const errMsg = data.message
                || (Array.isArray(detail) ? detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ") : detail)
                || "Failed to edit docx";
            throw new Error(errMsg);
        }
        return data.data;
    }

    async uploadToHepAI(
        userId: string,
        file: File,
        meta?: {
            slug?: string;
            display_name?: string;
            icon?: string;
            description?: string;
            version?: string;
            changelog?: string;
            source?: string;
        }
    ): Promise<{ id: string; url: string }> {
        const form = new FormData();
        form.append("file", file);
        const m = meta ?? {};
        if (m.slug?.trim()) form.append("slug", m.slug.trim());
        if (m.display_name?.trim()) form.append("display_name", m.display_name.trim());
        if (m.icon?.trim()) form.append("icon", m.icon.trim());
        if (m.description?.trim()) form.append("description", m.description.trim());
        if (m.version?.trim()) form.append("version", m.version.trim());
        if (m.changelog?.trim()) form.append("changelog", m.changelog.trim());
        if (m.source?.trim()) form.append("source", m.source.trim());
        const url = `${this.getBaseUrl()}/files/hepai/upload?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "上传到 HepAI 失败");
        }
        const raw = data.data || {};
        if (!raw.id || !raw.url) {
            throw new Error("上传成功但未返回 HepAI 文件信息");
        }
        return { id: raw.id, url: raw.url };
    }

    async getHepaiZipSkillMd(userId: string, fileId: string): Promise<{ path: string; content: string }> {
        const url = `${this.getBaseUrl()}/files/hepai/skill-md/${encodeURIComponent(fileId)}?user_id=${encodeURIComponent(
            userId
        )}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "读取 SKILL.md 失败");
        }
        const raw = data.data || {};
        if (typeof raw.content !== "string") {
            throw new Error("读取成功但未返回 SKILL.md 内容");
        }
        return { path: String(raw.path || "SKILL.md"), content: raw.content };
    }

    async updateHepaiFile(
        userId: string,
        fileId: string,
        options?: {
            file?: File;
            display_name?: string;
            icon?: string;
            description?: string;
            version?: string;
            changelog?: string;
            source?: string;
        }
    ): Promise<{
        id: string;
        filename: string;
        url: string;
        createdAtMs: number;
        description?: string;
        uploadedBy?: string;
        metadata?: Record<string, unknown>;
    }> {
        const form = new FormData();
        const opts = options ?? {};
        if (opts.file) form.append("file", opts.file);
        if (opts.display_name?.trim()) form.append("display_name", opts.display_name.trim());
        if (opts.icon?.trim()) form.append("icon", opts.icon.trim());
        if (opts.description?.trim()) form.append("description", opts.description.trim());
        if (opts.version?.trim()) form.append("version", opts.version.trim());
        if (opts.changelog?.trim()) form.append("changelog", opts.changelog.trim());
        if (opts.source?.trim()) form.append("source", opts.source.trim());
        const url = `${this.getBaseUrl()}/files/hepai/${encodeURIComponent(fileId)}?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, { method: "PUT", body: form });
        const data = await response.json();
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "更新 HepAI 文件失败");
        }
        const raw = data.data || {};
        return {
            id: raw.id || fileId,
            filename: String(raw.filename || ""),
            url: raw.url || "",
            createdAtMs: Number(raw.createdAtMs || 0),
            description: typeof raw.description === "string" ? raw.description : undefined,
            uploadedBy: typeof raw.uploadedBy === "string" ? raw.uploadedBy : undefined,
            metadata:
                raw.metadata && typeof raw.metadata === "object" && raw.metadata !== null
                    ? raw.metadata
                    : undefined,
        };
    }

    async listHepaiFiles(
        userId: string
    ): Promise<
        Array<{
            id: string;
            filename: string;
            url: string;
            createdAtMs: number;
            description?: string;
            uploadedBy?: string;
            metadata?: Record<string, unknown>;
        }>
    > {
        const url = `${this.getBaseUrl()}/files/hepai/list?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "获取 HepAI 文件列表失败");
        }
        const rows = Array.isArray(data.data) ? data.data : [];
        return rows
            .filter((r: any) => r && typeof r.id === "string" && typeof r.url === "string")
            .map((r: any) => {
                const uploadedRaw = r.uploadedBy ?? r.uploaded_by;
                return {
                    id: r.id,
                    filename: String(r.filename || r.name || "file.zip"),
                    url: r.url,
                    createdAtMs: Number(r.createdAtMs || Date.now()),
                    description: typeof r.description === "string" ? r.description : undefined,
                    uploadedBy:
                        typeof uploadedRaw === "string" && uploadedRaw.trim()
                            ? uploadedRaw.trim()
                            : undefined,
                    metadata:
                        r.metadata && typeof r.metadata === "object" && r.metadata !== null
                            ? r.metadata
                            : undefined,
                };
            });
    }
}

export const fileAPI = new FileAPI();