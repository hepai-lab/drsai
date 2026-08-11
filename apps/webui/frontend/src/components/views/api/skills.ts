import { getServerUrl } from "../../utils";

export type SkillsCatalogItem = {
    slug: string;
    name: string;
    description: string;
    compatibility?: string | null;
};

export type SkillsPublicItem = {
    slug: string;
    name: string;
    description: string;
    compatibility?: string | null;
    icon: string;
    version: string;
    owner: string;
    updated_at: string;
    downloads: number;
    can_edit?: boolean;
    profile?: string;
    changelog?: string;
    category?: string;
};

export type SkillsPublicDetail = SkillsPublicItem & {
    body: string;
    created_at: string;
    profile?: string;
    changelog?: string;
};

export type SkillsUserItem = {
    slug: string;
    name: string;
    description: string;
    icon: string;
    version: string;
    owner: string;
    source: "created" | "imported";
    /** Whether this skill is currently published to the public skills square. */
    public: boolean;
    unlisted: boolean;
    created_at: string;
    updated_at: string;
    download_url: string;
    profile: string;
    changelog: string;
    downloads: number;
    category?: string;
};

export type SkillsUserDetail = SkillsUserItem & {
    body: string;
};

export type SkillsCatalogDetail = SkillsCatalogItem & {
    body: string;
};

export type SkillsCatalogUploadResult = SkillsCatalogItem;

export class SkillsAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    async listCatalog(): Promise<SkillsCatalogItem[]> {
        const response = await fetch(`${this.getBaseUrl()}/skills/catalog`, {
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || "Failed to list skills");
        }
        return data.data || [];
    }

    async getCatalogEntry(slug: string): Promise<SkillsCatalogDetail> {
        const response = await fetch(
            `${this.getBaseUrl()}/skills/catalog/${encodeURIComponent(slug)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                typeof data.detail === "string" ? data.detail : data.message || "Failed to load skill"
            );
        }
        if (!data.status) {
            throw new Error(data.message || "Failed to load skill");
        }
        return data.data;
    }

    /** Download skill folder as a .zip (browser save). */
    async downloadCatalogArchive(slug: string): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/skills/catalog/${encodeURIComponent(slug)}/download`,
            { headers: this.getHeaders() }
        );
        if (!response.ok) {
            let msg = "下载失败";
            try {
                const err = await response.json();
                msg =
                    typeof err.detail === "string"
                        ? err.detail
                        : err.message || msg;
            } catch {
                msg = response.statusText || msg;
            }
            throw new Error(msg);
        }
        const blob = await response.blob();
        const filename = `${slug}.zip`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /** Upload a .zip skill pack (single folder with SKILL.md, or flat SKILL.md + slug). */
    async uploadCatalogZip(file: File, slug?: string): Promise<SkillsCatalogUploadResult> {
        const form = new FormData();
        form.append("file", file);
        const s = slug?.trim();
        if (s) {
            form.append("slug", s);
        }
        const response = await fetch(`${this.getBaseUrl()}/skills/catalog/upload`, {
            method: "POST",
            body: form,
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                typeof data.detail === "string" ? data.detail : data.message || "上传失败"
            );
        }
        if (!data.status) {
            throw new Error(data.message || "上传失败");
        }
        return data.data;
    }

    // ── Public skills (GFS) ────────────────────────────────────────────────

    /** List all public skills from GFS. Optionally pass api_key for write hints. */
    async listPublicSkills(apiKey?: string): Promise<SkillsPublicItem[]> {
        const qs = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '';
        const headers: HeadersInit = this.getHeaders();
        if (apiKey) {
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(`${this.getBaseUrl()}/skills?type=public${qs ? '&' + qs.slice(1) : ''}`, { headers });
        const data = await response.json();
        if (!data.status) throw new Error(data.message || "Failed to list public skills");
        return data.data || [];
    }

    /** Get a single public skill with full body. */
    async getPublicSkill(slug: string, apiKey?: string): Promise<SkillsPublicDetail> {
        const qs = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '';
        const headers: HeadersInit = this.getHeaders();
        if (apiKey) {
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(
            `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}?type=public${qs ? '&' + qs.slice(1) : ''}`,
            { headers },
        );
        const data = await response.json();
        if (!response.ok) {
            throw new Error(typeof data.detail === "string" ? data.detail : data.message || "Failed to load public skill");
        }
        if (!data.status) throw new Error(data.message || "Failed to load public skill");
        return data.data;
    }

    /** Upload a skill ZIP to the public GFS. Requires api_key with contributor+ role. */
    async uploadPublicSkill(
        file: File,
        slug?: string,
        apiKey?: string,
        meta?: {
            display_name?: string;
            icon?: string;
            description?: string;
            version?: string;
            changelog?: string;
            profile?: File;
            category?: string;
        },
    ): Promise<SkillsCatalogUploadResult> {
        const form = new FormData();
        form.append("file", file);
        if (slug?.trim()) form.append("slug", slug.trim());
        if (meta?.display_name?.trim()) form.append("display_name", meta.display_name.trim());
        if (meta?.icon?.trim()) form.append("icon", meta.icon.trim());
        if (meta?.description?.trim()) form.append("description", meta.description.trim());
        if (meta?.version?.trim()) form.append("version", meta.version.trim());
        if (meta?.changelog?.trim()) form.append("changelog", meta.changelog.trim());
        if (meta?.category?.trim()) form.append("category", meta.category.trim());
        if (meta?.profile) form.append("profile", meta.profile);
        const qs = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '';
        const headers: HeadersInit = {};
        if (apiKey) {
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(`${this.getBaseUrl()}/skills/upload?type=public${qs ? '&' + qs.slice(1) : ''}`, {
            method: "POST",
            body: form,
            headers,
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(typeof data.detail === "string" ? data.detail : data.message || "Upload failed");
        }
        if (!data.status) throw new Error(data.message || "Upload failed");
        return data.data;
    }

    /** Update an existing public skill. Must be owner or admin.
     *  All fields optional — only provided fields are changed. */
    async updatePublicSkill(
        slug: string,
        apiKey: string,
        options?: {
            file?: File;
            name?: string;
            icon?: string;
            description?: string;
            version?: string;
            changelog?: string;
            profile?: File;
            category?: string;
        },
    ): Promise<SkillsCatalogUploadResult> {
        const form = new FormData();
        if (options?.file) form.append("file", options.file);
        if (options?.name?.trim()) form.append("name", options.name.trim());
        if (options?.icon?.trim()) form.append("icon", options.icon.trim());
        if (options?.description?.trim()) form.append("description", options.description.trim());
        if (options?.version?.trim()) form.append("version", options.version.trim());
        if (options?.changelog !== undefined) form.append("changelog", options.changelog.trim());
        if (options?.category?.trim()) form.append("category", options.category.trim());
        if (options?.profile) form.append("profile", options.profile);
        const qs = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '';
        const headers: HeadersInit = {};
        if (apiKey) {
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(
            `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}?type=public${qs ? '&' + qs.slice(1) : ''}`,
            { method: "PUT", body: form, headers },
        );
        const data = await response.json();
        if (!response.ok) {
            throw new Error(typeof data.detail === "string" ? data.detail : data.message || "Update failed");
        }
        if (!data.status) throw new Error(data.message || "Update failed");
        return data.data;
    }

    /** Delete a public skill. Must be owner or admin. */
    async deletePublicSkill(slug: string, apiKey?: string): Promise<{ slug: string }> {
        const qs = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '';
        const headers: HeadersInit = this.getHeaders();
        if (apiKey) {
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(
            `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}?type=public${qs ? '&' + qs.slice(1) : ''}`,
            { method: "DELETE", headers },
        );
        const data = await response.json();
        if (!response.ok) {
            throw new Error(typeof data.detail === "string" ? data.detail : data.message || "Delete failed");
        }
        if (!data.status) throw new Error(data.message || "Delete failed");
        return data.data;
    }

    /** Toggle a user skill's public visibility. */
    async toggleSkillVisibility(slug: string, userId: string, publicVal: boolean, apiKey?: string): Promise<{ slug: string; public: boolean }> {
        const headers: HeadersInit = this.getHeaders();
        let qs = `type=user&user_id=${encodeURIComponent(userId)}&public=${publicVal}`;
        if (apiKey) {
            qs += `&api_key=${encodeURIComponent(apiKey)}`;
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(
            `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}/visibility?${qs}`,
            { method: "PUT", headers },
        );
        const data = await response.json();
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "Toggle visibility failed");
        }
        return data.data;
    }

    /** Download a public skill as ZIP. */
    async downloadPublicSkill(slug: string): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}/download?type=public`,
            { headers: this.getHeaders() },
        );
        if (!response.ok) {
            let msg = "Download failed";
            try {
                const err = await response.json();
                msg = typeof err.detail === "string" ? err.detail : err.message || msg;
            } catch { msg = response.statusText || msg; }
            throw new Error(msg);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}.zip`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /** Import a public skill to My Skills — downloads from public GFS, uploads to user GFS. */
    async importPublicSkill(slug: string, userId: string, displayName?: string, apiKey?: string): Promise<{ id: string; url: string }> {
        // Step 1: download public skill zip as blob
        const dlResp = await fetch(
            `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}/download?type=public`,
            { headers: this.getHeaders() },
        );
        if (!dlResp.ok) {
            throw new Error("Failed to download public skill");
        }
        const blob = await dlResp.blob();
        const zipFile = new File([blob], `${slug}.zip`, { type: "application/zip" });

        // Step 2: upload to user GFS with source=imported marker
        return this.uploadUserSkill(userId, zipFile, {
            display_name: displayName || slug,
            slug,
            source: "imported",
        }, apiKey);
    }

    // ── User Private Skills (GFS) ─────────────────────────────────────────

    async listUserSkills(userId: string, apiKey?: string): Promise<SkillsUserItem[]> {
        const headers: HeadersInit = this.getHeaders();
        let qs = `type=user&user_id=${encodeURIComponent(userId)}`;
        if (apiKey) {
            qs += `&api_key=${encodeURIComponent(apiKey)}`;
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const url = `${this.getBaseUrl()}/skills?${qs}`;
        const response = await fetch(url, { headers });
        const data = await response.json();
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "获取用户技能列表失败");
        }
        return Array.isArray(data.data) ? data.data : [];
    }

    async uploadUserSkill(
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
            category?: string;
        },
        apiKey?: string,
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
        if (m.category?.trim()) form.append("category", m.category.trim());
        const headers: HeadersInit = {};
        let qs = `type=user&user_id=${encodeURIComponent(userId)}`;
        if (apiKey) {
            qs += `&api_key=${encodeURIComponent(apiKey)}`;
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const url = `${this.getBaseUrl()}/skills/upload?${qs}`;
        console.log("[publish:api] uploadUserSkill request", { url, userId, fileName: file.name, fileSize: file.size, meta });
        const response = await fetch(url, { method: "POST", body: form, headers });
        const data = await response.json();
        console.log("[publish:api] uploadUserSkill response", { status: response.status, ok: response.ok, data });
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "上传用户技能失败");
        }
        const raw = data.data || {};
        if (!raw.id || !raw.url) {
            throw new Error("上传成功但未返回技能信息");
        }
        return { id: raw.id, url: raw.url };
    }

    async updateUserSkill(
        slug: string,
        userId: string,
        options?: {
            file?: File;
            display_name?: string;
            icon?: string;
            description?: string;
            version?: string;
            changelog?: string;
            source?: string;
            profile?: File;
            category?: string;
        },
        apiKey?: string,
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
        if (opts.changelog !== undefined) form.append("changelog", opts.changelog.trim());
        if (opts.source?.trim()) form.append("source", opts.source.trim());
        if (opts.category?.trim()) form.append("category", opts.category.trim());
        if (opts.profile) form.append("profile", opts.profile);
        const headers: HeadersInit = {};
        let qs = `type=user&user_id=${encodeURIComponent(userId)}`;
        if (apiKey) {
            qs += `&api_key=${encodeURIComponent(apiKey)}`;
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const url = `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}?${qs}`;
        console.log("[publish:api] updateUserSkill request", { url, slug, userId, options });
        const response = await fetch(url, { method: "PUT", body: form, headers });
        const data = await response.json();
        console.log("[publish:api] updateUserSkill response", { status: response.status, ok: response.ok, data });
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "更新用户技能失败");
        }
        const raw = data.data || {};
        return {
            id: raw.id || slug,
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

    async deleteUserSkill(slug: string, userId: string, apiKey?: string): Promise<void> {
        const headers: HeadersInit = {};
        let qs = `type=user&user_id=${encodeURIComponent(userId)}`;
        if (apiKey) {
            qs += `&api_key=${encodeURIComponent(apiKey)}`;
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const url = `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}?${qs}`;
        const response = await fetch(url, { method: "DELETE", headers });
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

    async downloadUserSkill(slug: string, userId: string, apiKey?: string): Promise<void> {
        const headers: HeadersInit = this.getHeaders();
        let qs = `type=user&user_id=${encodeURIComponent(userId)}`;
        if (apiKey) {
            qs += `&api_key=${encodeURIComponent(apiKey)}`;
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(
            `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}/download?${qs}`,
            { headers },
        );
        if (!response.ok) {
            let msg = "Download failed";
            try {
                const err = await response.json();
                msg = typeof err.detail === "string" ? err.detail : err.message || msg;
            } catch { msg = response.statusText || msg; }
            throw new Error(msg);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}.zip`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async getUserSkillMd(slug: string, userId: string, apiKey?: string): Promise<{ path: string; content: string }> {
        const headers: HeadersInit = this.getHeaders();
        let qs = `user_id=${encodeURIComponent(userId)}`;
        if (apiKey) {
            qs += `&api_key=${encodeURIComponent(apiKey)}`;
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const url = `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}/skill-md?${qs}`;
        const response = await fetch(url, { headers });
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

    // ── Skill Share ────────────────────────────────────────────────────────

    async createSkillShare(
        slug: string,
        userId: string,
        password: string,
        expiresInHours: number,
    ): Promise<{ share_id: string }> {
        const form = new FormData();
        if (password.trim()) form.append("password", password.trim());
        form.append("expires_in_hours", String(expiresInHours));
        const url = `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}/share?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "创建分享链接失败");
        }
        return data.data;
    }

    async revokeSkillShare(slug: string, userId: string, shareId: string): Promise<void> {
        const url = `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}/share/${encodeURIComponent(shareId)}?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, { method: "DELETE" });
        if (!response.ok) {
            let msg = "撤销分享失败";
            try {
                const err = await response.json();
                msg = err?.detail || err?.message || msg;
            } catch { /* ignore */ }
            throw new Error(msg);
        }
    }

    async listSkillShares(slug: string, userId: string): Promise<Array<{
        share_id: string;
        has_password: boolean;
        expires_at: string;
        expired: boolean;
        created_at: string;
        access_count: number;
    }>> {
        const url = `${this.getBaseUrl()}/skills/${encodeURIComponent(slug)}/shares?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok || !data?.status) {
            throw new Error(data?.detail || data?.message || "获取分享列表失败");
        }
        return data.data || [];
    }
}

export const skillsAPI = new SkillsAPI();