import { getServerUrl } from "../../utils";

export class AgentWorkerAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(apiKey: string): HeadersInit {
        return {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        };
    }

    async getAgentList(userId: string, apiKey: string, is_refresh = false): Promise<any[]> {
        let url = `${this.getBaseUrl()}/agentworker/ddf_agents?user_id=${encodeURIComponent(userId)}&is_refresh=${is_refresh}`;

        const response = await fetch(
            url,
            {
                headers: this.getHeaders(apiKey),
            }
        );
        const data = await response.json();
        // console.log("Agent worker list response:", data);
        if (!data.status)
            throw new Error(data.message || "Failed to fetch agent workers");
        return data.data;
    }

    async testRemoteAgent(userId: string, baseUrl: string, modelName: string, apiKey: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentworker/remote_agent/test`,
            {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    user_id: userId,
                    base_url: baseUrl,
                    model_name: modelName,
                    api_key: apiKey
                })
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to test remote agent connection");
        return data.data;
    }

    async saveRemoteAgent(userId: string, agentConfig: any): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentworker/remote_agent/save`,
            {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    user_id: userId,
                    agent_config: agentConfig
                })
            }
        );
        let data: any = {};
        try {
            data = await response.json();
        } catch {
            throw new Error("Failed to save remote agent");
        }
        if (!response.ok) {
            const d = data?.detail;
            let msg: string;
            if (typeof d === "string") {
                msg = d;
            } else if (Array.isArray(d)) {
                msg = d
                    .map((x: unknown) => {
                        if (x && typeof x === "object" && "msg" in x) {
                            return String((x as { msg: unknown }).msg);
                        }
                        return typeof x === "string" ? x : JSON.stringify(x);
                    })
                    .join(", ");
            } else {
                msg = data?.message || `Request failed (${response.status})`;
            }
            throw new Error(msg);
        }
        if (!data.status)
            throw new Error(data.message || "Failed to save remote agent");
        return data;
    }

    async getUserRemoteAgents(userId: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentworker/remote_agent/list?user_id=${userId}`,
            {
                method: 'GET',
                headers: {
                    "Content-Type": "application/json",
                }
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to get user remote agents");
        return data.data;
    }

    async removeRemoteAgent(userId: string, id: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentworker/remote_agent/remove`,
            {
                method: 'DELETE',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    user_id: userId,
                    id
                })
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to remove remote agent");
        return data;
    }

    async getUserAgents(userId: string, apiKey: string, is_refresh = false): Promise<any[]> {
        const url = `${this.getBaseUrl()}/agentworker/user_agents/list?user_id=${encodeURIComponent(userId)}&is_refresh=${is_refresh}`;
        const response = await fetch(url, {
            headers: this.getHeaders(apiKey),
        });
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch user agents");
        return data.data || [];
    }

    // 在 AgentWorkerAPI 类中添加这个方法
    async getUserAgentById(userId: string, agentId: string): Promise<any> {
        const url = `${this.getBaseUrl()}/agentworker/user_agents/${encodeURIComponent(agentId)}?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
            },
        });
        const data = await response.json();
        if (!data.status) {
            const error = new Error(data.message || "Failed to fetch agent") as Error & {
                code?: string;
                payload?: any;
            };
            error.name = "ApiStatusError";
            error.code = data.error_code;
            error.payload = data;
            throw error;
        }
        return data.data;
    }

    async updateUserAgent(userId: string, agentConfig: any): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentworker/user_agent/save`,
            {
                method: 'PUT',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    user_id: userId,
                    agent_config: agentConfig
                })
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to update user agent");
        return data;
    }

    async recordUserAgentUsage(userId: string, agentId: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentworker/user_agent/usage`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    user_id: userId,
                    agent_id: agentId,
                }),
            }
        );
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || "Failed to record agent usage");
        }
        return data.data;
    }

    async getRecentUserAgents(userId: string, limit = 12): Promise<{ agent_id: string }[]> {
        const url = `${this.getBaseUrl()}/agentworker/user_agent/recent?user_id=${encodeURIComponent(userId)}&limit=${encodeURIComponent(String(limit))}`;
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
            },
        });
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || "Failed to fetch recent agents");
        }
        return data.data || [];
    }

    async getUserDefaultAgent(userId: string): Promise<{
        default_agent_id: string | null;
        stored_default_agent_id: string | null;
        auto_load_default_agent?: boolean;
        default_agent_name?: string | null;
        science_default_agent_name?: string | null;
    }> {
        const url = `${this.getBaseUrl()}/agentworker/user_default_agent?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, {
            headers: { "Content-Type": "application/json" },
        });
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || "Failed to fetch user default agent");
        }
        return data.data;
    }

    async setUserDefaultAgent(userId: string, agentId: string): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentworker/user_default_agent`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, agent_id: agentId }),
            },
        );
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || "Failed to set default agent");
        }
    }
}

export const agentWorkerAPI = new AgentWorkerAPI();