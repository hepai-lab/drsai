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
    owner_id?: string;
    updated_at: string;
    downloads: number;
    can_edit?: boolean;
    profile?: string;
    changelog?: string;
    source?: string;
    uskills_type?: string | null;
    imported_ref?: { origin: string; owner?: string | null; version?: string } | null;
    tags?: string[];
    academicGroupId?: string;
};

export type SkillsPublicDetail = SkillsPublicItem & {
    body: string;
    created_at: string;
    profile?: string;
    changelog?: string;
    restricted?: boolean;
};

export type SkillsUserItem = {
    slug: string;
    name: string;
    description: string;
    icon: string;
    version: string;
    owner: string;
    owner_id?: string;
    source: "user" | "higraf";
    uskills_type: "created" | "imported" | null;
    /** Whether this skill is currently published to the public skills square. */
    public: boolean;
    unlisted: boolean;
    created_at: string;
    updated_at: string;
    download_url: string;
    profile: string;
    changelog: string;
    downloads: number;
    tags?: string[];
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

    async listPublicSkillsPage(
        page = 1,
        pageSize = 20,
        apiKey?: string,
        opts?: { q?: string; tags?: string; sort?: "name" | "time"; source?: string },
    ): Promise<{
        data: SkillsPublicItem[];
        pagination: {
            page: number;
            page_size: number;
            total: number;
            total_pages: number;
            has_next: boolean;
            has_prev: boolean;
        };
    }> {
        const params = new URLSearchParams({ type: "public", visibility: "public", page: String(page), page_size: String(pageSize) });
        if (apiKey) params.set("api_key", apiKey);
        if (opts?.q?.trim()) params.set("q", opts.q.trim());
        if (opts?.tags?.trim()) params.set("tags", opts.tags.trim());
        if (opts?.source) params.set("source", opts.source);
        if (opts?.sort) params.set("sort", opts.sort);
        const headers: HeadersInit = this.getHeaders();
        if (apiKey) {
            (headers as Record<string, string>)["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(`${this.getBaseUrl()}/skills?${params}`, { headers });
        const data = await response.json();
        if (!data.status) throw new Error(data.message || "Failed to list public skills");
        return {
            data: data.data || [],
            pagination: data.pagination || {
                page,
                page_size: pageSize,
                total: (data.data || []).length,
                total_pages: 1,
                has_next: false,
                has_prev: false,
            },
        };
    }

    /** List all public skills (follows pagination until exhausted). */
    async listPublicSkills(apiKey?: string): Promise<SkillsPublicItem[]> {
        const pageSize = 100;
        const all: SkillsPublicItem[] = [];
        let page = 1;
        let totalPages = 1;
        do {
            const result = await this.listPublicSkillsPage(page, pageSize, apiKey);
            all.push(...result.data);
            totalPages = result.pagination?.total_pages ?? 1;
            page += 1;
        } while (page <= totalPages && page <= 50);
        return all;
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
            tags?: string;
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
        if (meta?.tags?.trim()) form.append("tags", meta.tags.trim());
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
            tags?: string;
        },
    ): Promise<SkillsCatalogUploadResult> {
        const form = new FormData();
        if (options?.file) form.append("file", options.file);
        if (options?.name?.trim()) form.append("name", options.name.trim());
        if (options?.icon?.trim()) form.append("icon", options.icon.trim());
        if (options?.description?.trim()) form.append("description", options.description.trim());
        if (options?.version?.trim()) form.append("version", options.version.trim());
        if (options?.changelog !== undefined) form.append("changelog", options.changelog.trim());
        if (options?.tags?.trim()) form.append("tags", options.tags.trim());
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

    /** Import a public skill to My Collections — creates a reference record, no zip copy. */
    async importPublicSkill(
        slug: string,
        userId: string,
        meta?: {
            display_name?: string;
            icon?: string;
            description?: string;
            version?: string;
            tags?: string;
            owner?: string;
            origin?: string;
            changelog?: string;
        } | string,
        apiKey?: string,
    ): Promise<{ id: string; url: string }> {
        const fields = typeof meta === "string" ? { display_name: meta } : (meta ?? {});
        // Create a reference record — source=user, uskills_type=imported
        return this.uploadUserSkill(userId, new File([], `${slug}.ref`), {
            display_name: fields.display_name || slug,
            slug,
            source: "imported",  // legacy: maps to uskills_type=imported
            icon: fields.icon,
            description: fields.description,
            version: fields.version,
            tags: fields.tags,
            owner: fields.owner,
            origin: fields.origin,
            changelog: fields.changelog,
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
            tags?: string;
            owner?: string;
            origin?: string;
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
        if (m.tags?.trim()) form.append("tags", m.tags.trim());
        if (m.owner?.trim()) form.append("owner", m.owner.trim());
        if (m.origin?.trim()) form.append("origin", m.origin.trim());
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
            tags?: string;
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
        if (opts.tags?.trim()) form.append("tags", opts.tags.trim());
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

// ── Academic Group Tags (Higraf proxy) ─────────────────────────────────────

/**
 * Tag names that represent academic groups in Higraf.
 * When selected in the skill square, skills are fetched from the Higraf proxy
 * using `visibility=group&academicGroupId=<tagName>`.
 */
export const ACADEMIC_GROUP_TAGS = new Set(["lhaaso"]);

// ── Higraf Skill Hub Proxy ─────────────────────────────────────────────────

export type HigrafGroupSkillResult = {
    slug: string;
    name: string;
    description: string;
    icon: string;
    version: string;
    owner: string;
    updated_at: string;
    downloads: number;
    tags: string[];
    source: "higraf";
};

/**
 * Fetch skills from the Higraf skill hub for a specific academic group.
 * Calls the backend proxy at `/api/deer-flow/skill-hub/list`.
 */
export async function fetchHigrafGroupSkills(
    academicGroupId: string,
): Promise<SkillsPublicItem[]> {
    const baseUrl = getServerUrl();
    const params = new URLSearchParams({
        visibility: "group",
        academicGroupId: academicGroupId.toLowerCase(),
    });
    const response = await fetch(
        `${baseUrl}/deer-flow/skill-hub/list?${params}`,
        { headers: { "Content-Type": "application/json" }, credentials: "include" },
    );
    const data = await response.json();
    if (!data.status) {
        throw new Error(data.message || "Failed to fetch Higraf group skills");
    }
    const items: any[] = data.data || [];
    return items.map(
        (h): SkillsPublicItem => ({
            slug: h.skillId || h.id || "",
            name: h.name || h.skillName || "",
            description: h.description || "",
            icon: h.emoji || "package",
            version: h.version || h.currentVersion || "1.0.0",
            owner: h.authorName || "",
            updated_at: h.updatedAt || h.updated_at || "",
            downloads: h.callCount || 0,
            tags: h.tags || [],
            source: "higraf",
            academicGroupId: h.academicGroupId || "",
        }),
    );
}

// ── Skill Tags (admin CRUD) ────────────────────────────────────────────────

export type SkillTagItem = {
    id: number;
    uuid: string;
    name: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
};

export class SkillTagAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return { "Content-Type": "application/json" };
    }

    async listTags(operatorUserId: string): Promise<SkillTagItem[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/skill-tags/?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.message || "Failed to list tags");
        return data.data || [];
    }

    async createTag(operatorUserId: string, name: string, sortOrder = 0): Promise<SkillTagItem> {
        const qs = `operator_user_id=${encodeURIComponent(operatorUserId)}&name=${encodeURIComponent(name)}&sort_order=${sortOrder}`;
        const response = await fetch(`${this.getBaseUrl()}/skill-tags/?${qs}`, {
            method: "POST",
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!data.status) throw new Error(data.message || "Failed to create tag");
        return data.data;
    }

    async updateTag(
        operatorUserId: string,
        tagId: number,
        options?: { name?: string; sort_order?: number }
    ): Promise<SkillTagItem> {
        let qs = `operator_user_id=${encodeURIComponent(operatorUserId)}`;
        if (options?.name !== undefined) qs += `&name=${encodeURIComponent(options.name)}`;
        if (options?.sort_order !== undefined) qs += `&sort_order=${options.sort_order}`;
        const response = await fetch(`${this.getBaseUrl()}/skill-tags/${tagId}?${qs}`, {
            method: "PUT",
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!data.status) throw new Error(data.message || "Failed to update tag");
        return data.data;
    }

    async deleteTag(operatorUserId: string, tagId: number): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/skill-tags/${tagId}?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            { method: "DELETE", headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.message || "Failed to delete tag");
    }
}

export const skillTagAPI = new SkillTagAPI();