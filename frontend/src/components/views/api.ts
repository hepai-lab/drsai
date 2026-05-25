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
        const data = await response.json();
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

    async getUserDefaultAgents(userId: string): Promise<any> {
        const url = `${this.getBaseUrl()}/agentworker/user_default_agents/list?user_id=${encodeURIComponent(userId)}`;
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
            },
        });
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch user default agents");
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

    async getUserDefaultAgent(userId: string): Promise<{ default_agent_id: string | null; stored_default_agent_id: string | null }> {
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
        if (!data.status) {
            throw new Error(data.message || "登录失败");
        }
        return data;
    }
}

export const authAPI = new AuthAPI();
export const fileAPI = new FileAPI();

export type ManagedUser = {
    user_id: string;
    auth_source: "local" | "sso";
    is_admin: boolean;
    org_id?: number | null;
    org_slug?: string | null;
    org_display_name?: string | null;
    org_role?: string | null;
};

export type OrgAccess = {
    is_platform_admin: boolean;
    org: { org_id: number; role: string; is_org_admin: boolean } | null;
};

export type PlazaAgentRow = {
    org_id: number;
    org_slug: string;
    org_display_name: string;
    agent_id: string;
    snapshot: Record<string, unknown>;
};

export class OrganizationsAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return { "Content-Type": "application/json" };
    }

    async getAccess(userId: string): Promise<OrgAccess> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/access?user_id=${encodeURIComponent(userId)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "access");
        return data.data;
    }

    async getMyOrg(userId: string): Promise<Record<string, unknown> | null> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/me?user_id=${encodeURIComponent(userId)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "me");
        return data.data ?? null;
    }

    async listCatalog(): Promise<{ id: number; slug: string; display_name: string }[]> {
        const response = await fetch(`${this.getBaseUrl()}/orgs/catalog`, { headers: this.getHeaders() });
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "catalog");
        return data.data || [];
    }

    async listOrgs(operatorUserId: string): Promise<any[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "orgs");
        return data.data || [];
    }

    async createOrg(
        operatorUserId: string,
        body: { slug: string; display_name?: string; default_agent_id?: string | null }
    ): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify(body),
            }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "create org");
        return data.data;
    }

    async deleteOrg(operatorUserId: string, orgId: number): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/${orgId}?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            { method: "DELETE", headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "delete org");
    }

    async listMembers(operatorUserId: string, orgId: number): Promise<any[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/${orgId}/members?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "members");
        return data.data || [];
    }

    async addMember(operatorUserId: string, orgId: number, userId: string, role: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/${orgId}/members?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify({ user_id: userId, role }),
            }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "add member");
        return data.data;
    }

    async removeMember(operatorUserId: string, orgId: number, userId: string): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/${orgId}/members/${encodeURIComponent(
                userId
            )}?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            { method: "DELETE", headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "remove member");
    }

    async listOrgAgents(orgId: number): Promise<any[]> {
        const response = await fetch(`${this.getBaseUrl()}/orgs/${orgId}/agents`, {
            headers: this.getHeaders(),
        });
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "org agents");
        return data.data || [];
    }

    async upsertOrgAgent(
        operatorUserId: string,
        orgId: number,
        agentId: string,
        snapshot: Record<string, unknown>
    ): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/${orgId}/agents?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify({ agent_id: agentId, snapshot }),
            }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "save org agent");
        return data.data;
    }

    async deleteOrgAgent(operatorUserId: string, orgId: number, agentId: string): Promise<void> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/${orgId}/agents/${encodeURIComponent(
                agentId
            )}?operator_user_id=${encodeURIComponent(operatorUserId)}`,
            { method: "DELETE", headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "delete org agent");
    }

    async plazaList(userId: string): Promise<PlazaAgentRow[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/plaza/agents?user_id=${encodeURIComponent(userId)}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "plaza");
        return data.data || [];
    }

    async plazaApply(applicantUserId: string, targetOrgId: number, requestedAgentId: string): Promise<any> {
        const response = await fetch(`${this.getBaseUrl()}/orgs/plaza/requests`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify({
                applicant_user_id: applicantUserId,
                target_org_id: targetOrgId,
                requested_agent_id: requestedAgentId,
            }),
        });
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "apply");
        return data.data;
    }

    async plazaMyRequests(applicantUserId: string): Promise<any[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/plaza/requests/mine?applicant_user_id=${encodeURIComponent(
                applicantUserId
            )}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "mine");
        return data.data || [];
    }

    async plazaPending(operatorUserId: string): Promise<any[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/plaza/requests/pending?operator_user_id=${encodeURIComponent(
                operatorUserId
            )}`,
            { headers: this.getHeaders() }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "pending");
        return data.data || [];
    }

    async plazaApprove(operatorUserId: string, requestUuid: string, message?: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/plaza/requests/${encodeURIComponent(requestUuid)}/approve`,
            {
                method: "PUT",
                headers: this.getHeaders(),
                body: JSON.stringify({ operator_user_id: operatorUserId, message: message || null }),
            }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "approve");
        return data.data;
    }

    async plazaReject(operatorUserId: string, requestUuid: string, message?: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/orgs/plaza/requests/${encodeURIComponent(requestUuid)}/reject`,
            {
                method: "PUT",
                headers: this.getHeaders(),
                body: JSON.stringify({ operator_user_id: operatorUserId, message: message || null }),
            }
        );
        const data = await response.json();
        if (!data.status) throw new Error(data.detail || data.message || "reject");
        return data.data;
    }
}

export const organizationsAPI = new OrganizationsAPI();

export class UserAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
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
    name: string;
    aliases?: string[];
    category?: string | null;
    tags?: string[];
    description?: string | null;
    path?: string;
    [key: string]: unknown;
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
