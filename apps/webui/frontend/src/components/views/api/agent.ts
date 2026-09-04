import { apiFetch, getServerUrl } from "../../utils";
import { getAuthToken } from "../../../utils/authSession";

export class Agent {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        const token = getAuthToken();
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
    }

    // get main agent list
    async getAgentList(userId: string): Promise<any[]> {
        // console.log("Fetching agent list for user:", userId);
        // console.log("Using base URL:", this.getBaseUrl());
        const response = await apiFetch(
            `${this.getBaseUrl()}/agentmode/?user_id=${userId}`,
            {
                headers: this.getHeaders(),
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
        const response = await apiFetch(
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
        const response = await apiFetch(
            `${this.getBaseUrl()}/agentmode/?user_id=${userId}&id=${id}`,
            {
                method: "DELETE",
                headers: this.getHeaders(),
            }
        );
    }

    // save agent config
    async saveAgentConfig(agentConfig: any): Promise<any> {
        const response = await apiFetch(`${this.getBaseUrl()}/agentmode/`, {
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
        const response = await apiFetch(
            `${this.getBaseUrl()}/agentmode/config/?user_id=${userId}&mode=${mode}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch agent config");
        return data.data;
    }
}

export const agentAPI = new Agent();