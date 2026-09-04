import { apiFetch, getServerUrl } from "../../utils";

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
        const response = await apiFetch(url, { headers: this.getHeaders() });
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