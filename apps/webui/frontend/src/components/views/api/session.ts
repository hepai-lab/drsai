import { Session, SessionRuns } from "../../types/datamodel";
import { getServerUrl } from "../../utils";
import { getAuthToken } from "../../../utils/authSession";

export class SessionAPI {
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
            user_id: userId,
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
        const { created_at, ...dataWithoutCreatedAt } = sessionData;

        const session = {
            ...dataWithoutCreatedAt,
            id: sessionId,
            user_id: userId,
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
        return data.data;
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

    async listSessionMessages(
        sessionId: number,
        userId: string
    ): Promise<any[]> {
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

export const sessionAPI = new SessionAPI();