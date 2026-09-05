import { getServerUrl } from "../../utils";

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

    /** CSNS user_agent 嵌入登录：用路径中的 access_token 换取本系统 JWT */
    async userAgentVerify(accessToken: string): Promise<{ access_token: string; user_id: string; agent_name?: string | null }> {
        const params = new URLSearchParams({ access_token: accessToken });
        const response = await fetch(`${this.getBaseUrl()}/auth/user-agent/verify?${params.toString()}`, {
            method: "POST",
            headers: this.getHeaders(),
            credentials: "include",
        });
        const data = await response.json();
        if (!response.ok || !data.status) {
            throw new Error(data.detail || data.message || `user_agent_auth_failed`);
        }
        return data.data as { access_token: string; user_id: string; agent_name?: string | null };
    }
}

export const authAPI = new AuthAPI();