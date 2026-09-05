import { apiFetch, getServerUrl } from "../../utils";
import { getAuthToken } from "../../../utils/authSession";
import { GeneralConfig } from "../../store";

export class SettingsAPI {
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

    async getSettings(userId: string): Promise<Record<string, any>> {
        const response = await apiFetch(
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
        const response = await apiFetch(`${this.getBaseUrl()}/settings/`, {
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

export const settingsAPI = new SettingsAPI();