import { getServerUrl } from "../../utils";
import { getAuthToken } from "../../../utils/authSession";

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

    async getCooperInfo(): Promise<{ cooper_info: string; display_name: string }> {
        const headers: HeadersInit = this.getHeaders();
        const token = getAuthToken();
        if (token) {
            (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
        }
        const response = await fetch(
            `${this.getBaseUrl()}/auth/me`,
            { headers, credentials: "include" }
        );
        const data = await response.json();
        if (!data.status) {
            throw new Error(data.message || data.detail || "Failed to fetch cooper info");
        }
        return {
            cooper_info: (data.data?.cooper_info as string) || "",
            display_name: (data.data?.display_name as string) || "",
        };
    }
}

export const userAPI = new UserAPI();