import { Session, SessionRuns } from "../types/datamodel";
import { getServerUrl } from "../utils";
import { Team, AgentConfig } from "../types/datamodel";
import { GeneralConfig } from "../store";
export class SessionAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    async listSessions(userId: string): Promise<Session[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/sessions/?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch sessions");
        return data.data;
    }

    async getSession(sessionId: number, userId: string): Promise<Session> {
        const response = await fetch(
            `${this.getBaseUrl()}/sessions/${sessionId}?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch session");
        return data.data;
    }

    async createSession(
        sessionData: Partial<Session>,
        userId: string,
    ): Promise<Session> {
        const session = {
            ...sessionData,
            user_id: userId, // Ensure user_id is included
            // Note: created_at is handled by server_default=func.now() in backend
        };

        const response = await fetch(`${this.getBaseUrl()}/sessions/`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(session),
        });
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to create session");
        return data.data;
    }

    async updateSession(
        sessionId: number,
        sessionData: Partial<Session>,
        userId: string
    ): Promise<Session> {
        // Exclude created_at when updating, as it should be preserved
        const { created_at, ...dataWithoutCreatedAt } = sessionData;

        const session = {
            ...dataWithoutCreatedAt,
            id: sessionId,
            user_id: userId, // Ensure user_id is included
            // Note: updated_at is handled by onupdate=func.now() in backend
        };

        const response = await fetch(
            `${this.getBaseUrl()}/sessions/${sessionId}?user_id=${userId}`,
            {
                method: "PUT",
                headers: this.getHeaders(),
                body: JSON.stringify(session),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to update session");
        return data.data;
    }

    // session runs with messages
    async getSessionRuns(
        sessionId: number,
        userId: string
    ): Promise<SessionRuns> {
        const response = await fetch(
            `${this.getBaseUrl()}/sessions/${sessionId}/runs?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch session runs");
        return data.data; // Returns { runs: RunMessage[] }
    }

    async updateSessionRuns(
        runId: string,
        runData: Partial<any>,
    ): Promise<Session> {
    
        const response = await fetch(
            `${this.getBaseUrl()}/runs/${runId}`,
            {
                method: "PUT",
                headers: this.getHeaders(),
                body: JSON.stringify(runData),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to update Runs");
        return data.data;
    }

    async deleteSession(sessionId: number, userId: string): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/sessions/${sessionId}?user_id=${userId}`,
            {
                method: "DELETE",
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to delete session");
    }

    async setSessionShare(
        sessionId: number,
        userId: string,
        enabled: boolean
    ): Promise<{ share_token: string; share_enabled: boolean }> {
        const params = new URLSearchParams({
            user_id: userId,
            enabled: String(enabled),
        });
        const response = await fetch(
            `${this.getBaseUrl()}/sessions/${sessionId}/share?${params.toString()}`,
            {
                method: "POST",
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.detail || data.message || "Failed to update share");
        return data.data;
    }

    async getSharedSession(shareToken: string): Promise<{
        session: Session;
        runs: SessionRuns["runs"];
    }> {
        const response = await fetch(
            `${this.getBaseUrl()}/sessions/shared/${encodeURIComponent(shareToken)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.detail || data.message || "Failed to load shared session");
        return data.data;
    }

    buildShareUrl(shareToken: string): string {
        const prefix = (process.env.GATSBY_PREFIX_PATH_VALUE || "").replace(/\/+$/, "");
        const origin =
            typeof window !== "undefined" ? window.location.origin : "";
        return `${origin}${prefix}/share?token=${encodeURIComponent(shareToken)}`;
    }

    // Adding messages endpoint
    async listSessionMessages(
        sessionId: number,
        userId: string
    ): Promise<any[]> {
        // Replace 'any' with proper message type
        const response = await fetch(
            `${this.getBaseUrl()}/sessions/${sessionId}/messages?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch messages");
        return data.data;
    }
}

export class TeamAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    async listTeams(userId: string): Promise<Team[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/teams/?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch teams");
        return data.data;
    }

    async getTeam(teamId: number, userId: string): Promise<Team> {
        const response = await fetch(
            `${this.getBaseUrl()}/teams/${teamId}?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch team");
        return data.data;
    }

    async createTeam(teamData: Partial<Team>, userId: string): Promise<Team> {
        const team = {
            ...teamData,
            user_id: userId,
        };

        const response = await fetch(`${this.getBaseUrl()}/teams/`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(team),
        });
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to create team");
        return data.data;
    }

    async deleteTeam(teamId: number, userId: string): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/teams/${teamId}?user_id=${userId}`,
            {
                method: "DELETE",
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to delete team");
    }

    // Team-Agent Link Management
    async linkAgent(teamId: number, agentId: number): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/teams/${teamId}/agents/${agentId}`,
            {
                method: "POST",
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to link agent to team");
    }

    async linkAgentWithSequence(
        teamId: number,
        agentId: number,
        sequenceId: number
    ): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/teams/${teamId}/agents/${agentId}/${sequenceId}`,
            {
                method: "POST",
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(
                data.message || "Failed to link agent to team with sequence"
            );
    }

    async unlinkAgent(teamId: number, agentId: number): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/teams/${teamId}/agents/${agentId}`,
            {
                method: "DELETE",
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to unlink agent from team");
    }

    async getTeamAgents(teamId: number): Promise<AgentConfig[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/teams/${teamId}/agents`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch team agents");
        return data.data;
    }
}

export class PlanAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    async listPlans(userId: string): Promise<any[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/plans/?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch plans");
        return data.data;
    }

    async getPlan(planId: number, userId: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/plans/${planId}?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch plan");
        return data.data;
    }

    async createPlan(planData: Partial<any>, userId: string): Promise<any> {
        const plan = {
            ...planData,
            user_id: userId,
        };

        const response = await fetch(`${this.getBaseUrl()}/plans/`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(plan),
        });
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to create plan");
        return data.data;
    }

    async updatePlan(
        planId: number,
        planData: Partial<any>,
        userId: string
    ): Promise<any> {
        if (!planData.task) {
            console.error("Missing task in planData:", planData);
        }
        if (!planData.steps || !Array.isArray(planData.steps)) {
            console.error("Missing or invalid steps in planData:", planData);
        }

        const { created_at, ...dataWithoutCreatedAt } = planData;

        const plan = {
            ...dataWithoutCreatedAt,
            id: planId,
            user_id: userId,
            updated_at: null, // This will be replaced by the server with current time
        };

        try {
            const response = await fetch(
                `${this.getBaseUrl()}/plans/${planId}?user_id=${userId}`,
                {
                    method: "PUT",
                    headers: this.getHeaders(),
                    body: JSON.stringify(plan),
                }
            );

            const data = await response.json();
            if (!data.status)
                throw new Error(data.message || "Failed to update plan");
            return data.data;
        } catch (error) {
            console.error("Error in updatePlan:", error);
            throw error;
        }
    }

    async deletePlan(planId: number, userId: string): Promise<void> {
        try {
            const response = await fetch(
                `${this.getBaseUrl()}/plans/${planId}?user_id=${userId}`,
                {
                    method: "DELETE",
                    headers: this.getHeaders(),
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to delete plan. Server responded with status: ${response.status}`
                );
            }

            const data = await response.json();

            if (!data.status) {
                throw new Error(data.message || "Failed to delete plan");
            }
        } catch (error) {
            throw error;
        }
    }

    async learnPlan(sessionId: number, userId: string): Promise<any> {
        try {
            const response = await fetch(
                `${this.getBaseUrl()}/plans/learn_plan`,
                {
                    method: "POST",
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        session_id: sessionId,
                        user_id: userId,
                    }),
                }
            );

            if (!response.ok) {
                // Log the complete error response
                const errorText = await response.text();
                console.error("Full error response:", errorText);
                try {
                    const errorData = JSON.parse(errorText);
                    throw new Error(errorData.detail || response.statusText);
                } catch (e) {
                    throw new Error(
                        `${response.status} ${response.statusText}: ${errorText}`
                    );
                }
            }

            return await response.json();
        } catch (error) {
            console.error("Error learning plan:", error);
            throw error;
        }
    }
}

export class SettingsAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    async getSettings(userId: string): Promise<Record<string, any>> {
        const response = await fetch(
            `${this.getBaseUrl()}/settings/?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        // For non-SSO / missing users, backend should return 4xx. Treat as "no settings".
        if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 422) {
            return {};
        }
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch settings");
        return data.data.config || {}; // Return just the config object
    }

    async updateSettings(
        userId: string,
        config: Record<string, any>
    ): Promise<{ config: GeneralConfig }> {
        const response = await fetch(`${this.getBaseUrl()}/settings/`, {
            method: "PUT",
            headers: this.getHeaders(),
            body: JSON.stringify({
                user_id: userId,
                config: config,
            }),
        });
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to update settings");
        return data.data;
    }
}

export class Agent {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    // get main agent list
    async getAgentList(userId: string): Promise<any[]> {
        // console.log("Fetching agent list for user:", userId);
        // console.log("Using base URL:", this.getBaseUrl());
        const response = await fetch(
            `${this.getBaseUrl()}/agentmode/?user_id=${userId}`,
            {
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch agents");

        // 后端返回的数据结构是 { agents_mode: [] }
        // 需要提取 config.agent_modes 数组
        const agentSettings = data.data;
        if (agentSettings && agentSettings.agents_mode) {
            return agentSettings.agents_mode;
        }

        // 如果数据结构不符合预期，返回空数组
        console.warn("Unexpected agent list data structure:", agentSettings);
        return [];
    }

    // update main agent list
    async updateAgentList(
        userId: string,
        id: string): Promise<any[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentmode/?user_id=${userId}&id=${id}`,
            {
                method: "PUT",
                headers: this.getHeaders(),
            }
        );

 
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to update agents");

        // 后端返回的数据结构是 { agents_mode: [] }
        // 需要提取 config.agent_modes 数组
        const agentSettings = data.data;
        if (agentSettings && agentSettings.agents_mode) {
            return agentSettings.agents_mode;
        }

        // 如果数据结构不符合预期，返回空数组
        console.warn("Unexpected agent list data structure:", agentSettings);
        return [];
    }

    // delete main agent list
    async deleteMainAgent(
        userId: string,
        id: string) {
        const response = await fetch(
            `${this.getBaseUrl()}/agentmode/?user_id=${userId}&id=${id}`,
            {
                method: "DELETE",
                headers: this.getHeaders(),
            }
        );
    }

    // save agent config
    async saveAgentConfig(agentConfig: any): Promise<any> {
        const response = await fetch(`${this.getBaseUrl()}/agentmode/`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(agentConfig),
        });
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to save agent config");
        return data.data;
    }

    // get agent config by user_id and mode
    async getAgentConfig(userId: string, mode: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/agentmode/config/?user_id=${userId}&mode=${mode}`,
            {
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch agent config");
        return data.data;
    }
}

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
export const teamAPI = new TeamAPI();
export const sessionAPI = new SessionAPI();
export const planAPI = new PlanAPI();
export const settingsAPI = new SettingsAPI();
export const agentAPI = new Agent();



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

export class AuthAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    async register(userId: string, password: string): Promise<any> {
        const params = new URLSearchParams({
            user_id: userId,
            password: password,
        });
        const response = await fetch(`${this.getBaseUrl()}/umtlocal/?${params.toString()}`, {
            method: "POST",
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                (data as { detail?: string; message?: string }).detail ||
                    (data as { message?: string }).message ||
                    `注册失败 (${response.status})`
            );
        }
        if (!data.status) {
            throw new Error(data.message || "注册失败");
        }
        return data;
    }

    async login(userId: string, password: string): Promise<any> {
        const params = new URLSearchParams({
            user_id: userId,
            password: password,
        });
        const response = await fetch(`${this.getBaseUrl()}/umtlocal/login?${params.toString()}`, {
            method: "POST",
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(
                (data as { detail?: string; message?: string }).detail ||
                    (data as { message?: string }).message ||
                    `登录失败 (${response.status})`
            );
        }
        if (!data.status) {
            throw new Error(data.message || "登录失败");
        }
        return data;
    }

    async scienceUserLogin(tokenId: string): Promise<{ access_token: string; user_id: string }> {
        const params = new URLSearchParams({ token_id: tokenId });
        const response = await fetch(`${this.getBaseUrl()}/auth/science-user/token?${params.toString()}`, {
            method: "POST",
            headers: this.getHeaders(),
            credentials: "include",
        });
        const data = await response.json();
        if (!response.ok || !data.status) {
            throw new Error(data.detail || data.message || `science_user_auth_failed`);
        }
        return data.data as { access_token: string; user_id: string };
    }

    /** 统一认证免密登录：用 IHEP access_token + username 换取本系统 JWT */
    async scienceUserVerify(accessToken: string, username: string): Promise<{ access_token: string; user_id: string }> {
        const params = new URLSearchParams({ access_token: accessToken, username });
        const response = await fetch(`${this.getBaseUrl()}/auth/science-user/verify?${params.toString()}`, {
            method: "POST",
            headers: this.getHeaders(),
            credentials: "include",
        });
        const data = await response.json();
        if (!response.ok || !data.status) {
            throw new Error(data.detail || data.message || `science_user_auth_failed`);
        }
        return data.data as { access_token: string; user_id: string };
    }
}

export const authAPI = new AuthAPI();
export const fileAPI = new FileAPI();

export type ManagedUser = {
    user_id: string;
    auth_source: "local" | "sso";
    is_admin: boolean;
};

export type UserAccess = {
    is_platform_admin: boolean;
};

export type AdminUsageOverviewData = {
    usage_events: Array<{
        user_id: string;
        agent_id: string;
        use_count: number;
    }>;
    top_agents_by_usage_records: Array<{
        agent_id: string;
        agent_name?: string | null;
        total_use_count_records: number;
    }>;
    sessions_per_user: Array<{ user_id: string; session_count: number }>;
    runs_per_user: Array<{ user_id: string; run_count: number }>;
    today_session_stats?: {
        today_key: string;
        session_count: number;
        dau: number;
        recent_by_user_agent: Array<{
            user_id: string;
            agent_name?: string | null;
            session_count: number;
            latest_created_at: string;
        }>;
    };
    session_usage_scatter?: Array<{
        user_id: string;
        agent_id: string;
        agent_name?: string | null;
        latest_created_at: string;
        session_count: number;
    }>;
    usage_daily_trends?: Array<{
        day_key: string;
        agent_session_count: number;
        active_user_count: number;
    }>;
    limits: { usage_events?: number };
};

/** Platform-admin cross-user usage aggregates (requires `UserRole.is_admin`). */
export class AdminAnalyticsAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return { "Content-Type": "application/json" };
    }

    async usageOverview(operatorUserId: string): Promise<AdminUsageOverviewData> {
        const url = `${this.getBaseUrl()}/admin/analytics/usage-overview?operator_user_id=${encodeURIComponent(
            operatorUserId
        )}`;
        const response = await fetch(url, { headers: this.getHeaders() });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const msg =
                typeof data.detail === "string"
                    ? data.detail
                    : data.message || `HTTP ${response.status}`;
            throw new Error(msg);
        }
        if (!data.status) {
            throw new Error(data.detail || data.message || "usage overview failed");
        }
        return data.data as AdminUsageOverviewData;
    }
}

export const adminAnalyticsAPI = new AdminAnalyticsAPI();

export class UserAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    async getAccess(userId: string): Promise<UserAccess> {
        const base = this.getBaseUrl();
        const q = `user_id=${encodeURIComponent(userId)}`;
        const urls = [`${base}/users/access?${q}`, `${base}/orgs/access?${q}`];
        let lastError = "access";
        for (const url of urls) {
            const response = await fetch(url, { headers: this.getHeaders() });
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.status && data.data) {
                return {
                    is_platform_admin: Boolean(data.data.is_platform_admin),
                };
            }
            lastError =
                typeof data.detail === "string"
                    ? data.detail
                    : data.message || `HTTP ${response.status}`;
        }
        throw new Error(lastError);
    }

    async listUsers(operatorUserId: string): Promise<ManagedUser[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/users/?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || data.detail || "Failed to fetch users");
        }
        return data.data || [];
    }

    async setAdmin(operatorUserId: string, userId: string, isAdmin: boolean): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/users/${encodeURIComponent(userId)}/admin?operator_user_id=${encodeURIComponent(operatorUserId)}&is_admin=${String(isAdmin)}`,
            {
                method: "PUT",
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || data.detail || "Failed to update user role");
        }
    }
}

export const userAPI = new UserAPI();

export type SkillsCatalogItem = {
    slug: string;
    name: string;
    description: string;
    compatibility?: string | null;
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
}

export const skillsAPI = new SkillsAPI();

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
}

export const docmasterAPI = new DocMasterAPI();
