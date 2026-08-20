import { getServerUrl } from "../../utils";

export interface DocMasterTemplateEntry {
    id?: string;
    name: string;
    aliases?: string[];
    category?: string | null;
    tags?: string[];
    description?: string | null;
    path?: string;
    file?: string;
    file_type?: string | null;
    source?: "shared" | "mine";
    [key: string]: unknown;
}

export interface DocMasterPptxPreviewSlide {
    index: number;
    name: string;
    url: string;
}

export interface DocMasterTemplatesResponse {
    shared: DocMasterTemplateEntry[];
    mine: DocMasterTemplateEntry[];
}

export class DocMasterAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    /** URL the browser can hit to download/stream a template file. */
    templateFileUrl(params: {
        templateId: string;
        source: "shared" | "mine";
        userId?: string;
    }): string {
        const qs = new URLSearchParams();
        qs.set("template_id", params.templateId);
        qs.set("source", params.source);
        if (params.source === "mine" && params.userId) qs.set("user_id", params.userId);
        return `${this.getBaseUrl()}/docmaster/templates/file?${qs.toString()}`;
    }

    pptxPreviewUrl(params: {
        templateId: string;
        source: "shared" | "mine";
        userId?: string;
    }): string {
        const qs = new URLSearchParams();
        qs.set("template_id", params.templateId);
        qs.set("source", params.source);
        if (params.source === "mine" && params.userId) qs.set("user_id", params.userId);
        return `${this.getBaseUrl()}/docmaster/templates/pptx-preview?${qs.toString()}`;
    }

    async getPptxPreview(params: {
        templateId: string;
        source: "shared" | "mine";
        userId?: string;
    }): Promise<{ template_id: string; name: string; slides: DocMasterPptxPreviewSlide[] }> {
        const response = await fetch(this.pptxPreviewUrl(params), {
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                typeof data.detail === "string" ? data.detail : data.message || "PPTX 预览加载失败"
            );
        }
        if (!data.status) {
            throw new Error(data.message || "PPTX 预览加载失败");
        }
        return data.data;
    }

    async saveTemplate(params: {
        userId: string;
        name: string;
        description?: string;
        category?: string;
        tags?: string[];
        aliases?: string[];
        templateId?: string;
        file: File;
    }): Promise<{ template_id?: string; metadata?: DocMasterTemplateEntry }> {
        const form = new FormData();
        form.append("user_id", params.userId);
        form.append("name", params.name);
        if (params.description) form.append("description", params.description);
        if (params.category) form.append("category", params.category);
        if (params.tags && params.tags.length > 0) {
            form.append("tags", JSON.stringify(params.tags));
        }
        if (params.aliases && params.aliases.length > 0) {
            form.append("aliases", JSON.stringify(params.aliases));
        }
        if (params.templateId) form.append("template_id", params.templateId);
        form.append("file", params.file);
        const response = await fetch(`${this.getBaseUrl()}/docmaster/templates`, {
            method: "POST",
            body: form,
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                typeof data.detail === "string" ? data.detail : data.message || "保存模板失败"
            );
        }
        if (!data.status) {
            throw new Error(data.message || "保存模板失败");
        }
        return data.data || {};
    }

    async deleteTemplate(params: {
        templateId: string;
        userId: string;
    }): Promise<{ removed_id?: string }> {
        const qs = new URLSearchParams();
        qs.set("user_id", params.userId);
        const response = await fetch(
            `${this.getBaseUrl()}/docmaster/templates/${encodeURIComponent(params.templateId)}?${qs.toString()}`,
            { method: "DELETE", headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                typeof data.detail === "string" ? data.detail : data.message || "删除模板失败"
            );
        }
        if (!data.status) {
            throw new Error(data.message || "删除模板失败");
        }
        return data.data || {};
    }

    async listTemplates(params: {
        userId?: string;
        category?: string;
        query?: string;
    } = {}): Promise<DocMasterTemplatesResponse> {
        const qs = new URLSearchParams();
        if (params.userId) qs.set("user_id", params.userId);
        if (params.category) qs.set("category", params.category);
        if (params.query) qs.set("query", params.query);
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        const response = await fetch(
            `${this.getBaseUrl()}/docmaster/templates${suffix}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                typeof data.detail === "string" ? data.detail : data.message || "Failed to list templates"
            );
        }
        if (!data.status) {
            throw new Error(data.message || "Failed to list templates");
        }
        return {
            shared: data.data?.shared || [],
            mine: data.data?.mine || [],
        };
    }

    /** Seed server-side fixture files into the user's GFS bucket. Used by
     * the right-panel 试用 buttons to bypass file upload during demos.
     * Returns the same `{uploaded, errors}` shape as `cloudAPI.uploadFiles`,
     * so callers can pipe the result through their existing handlers. */
    async seedDemo(params: {
        kind: "guanlianyewu" | "zonghe";
        userId: string;
    }): Promise<{ uploaded: { name: string; remote_path: string }[]; errors: { name: string; error: string }[] }> {
        const qs = new URLSearchParams();
        qs.set("kind", params.kind);
        qs.set("user_id", params.userId);
        const response = await fetch(
            `${this.getBaseUrl()}/docmaster/demo/seed?${qs.toString()}`,
            { method: "POST", headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!response.ok || !data.status) {
            throw new Error(
                typeof data.detail === "string" ? data.detail : data.message || "演示文件加载失败"
            );
        }
        return {
            uploaded: data.data?.uploaded || [],
            errors: data.data?.errors || [],
        };
    }
}

export const docmasterAPI = new DocMasterAPI();