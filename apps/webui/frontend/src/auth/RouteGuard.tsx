import React, { useContext, useEffect, useState } from "react";
import { useLocation, useNavigate } from "../hooks/useRouter";
import { appContext } from "../hooks/provider";
import { verifyAuthSession, saveAuthSession } from "../utils/authSession";
import { authAPI } from "../components/views/api";
import ScienceUserErrorPage from "./ScienceUserErrorPage";

const PUBLIC_ROUTES = ["/welcome", "/login", "/auth", "/share"];
const PUBLIC_ROUTE_PREFIXES = ["/share/skill", "/auth/login", "/auth/oidc", "/umt/oidc-login"];

const normalizePath = (path: string) => path.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";

function consumePendingSearch(): string {
    try {
        const match = document.cookie.match(/(?:^|;\s*)drsai_pending_search=([^;]*)/);
        const raw = match ? decodeURIComponent(match[1]) : "";
        if (!raw) {
            return "";
        }
        document.cookie = "drsai_pending_search=; path=/; max-age=0; SameSite=Lax";
        const pending = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
        let extra = "";
        for (const key of ["share_agent", "agentId", "agentName"]) {
            const value = pending.get(key);
            if (value) {
                extra += `&${key}=${encodeURIComponent(value)}`;
            }
        }
        return extra;
    } catch {
        return "";
    }
}

interface RouteGuardProps {
    children: React.ReactNode;
}

export const RouteGuard: React.FC<RouteGuardProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { setUser } = useContext(appContext);
    const [checked, setChecked] = useState(false);
    const [scienceAuthError, setScienceAuthError] = useState<"invalidToken" | "networkError" | "missingToken" | null>(null);

    useEffect(() => {
        let cancelled = false;

        const guard = async () => {
            const searchParams = new URLSearchParams(location.search);

            // Science user iframe embed:
            //   统一认证: ?user_source=science_user&access_token=<ihep_token>
            //   院平台:   ?user_source=science_user&tokenId=<cas_token>
            // CSNS user_agent embed:
            //   ?user_source=user_agent&access_token=<csns_token>
            // 在所有其他守卫逻辑之前处理，避免跳转到登录页
            const userSource = (searchParams.get("user_source") || "").trim();
            if (userSource === "user_agent") {
                const accessToken =
                    searchParams.get("access_token") || searchParams.get("token");
                if (!accessToken) {
                    if (!cancelled) setScienceAuthError("missingToken");
                    return;
                }
                try {
                    const result = await authAPI.userAgentVerify(accessToken);
                    if (cancelled) return;
                    saveAuthSession(result.access_token, result.user_id);
                    localStorage.removeItem("drsai-mode-config");
                    localStorage.removeItem("drsai.recentAgents");
                    setUser({ name: result.user_id, email: result.user_id });
                    const agentName = result.agent_name || "iPanda";
                    window.location.replace(
                        `/?menu=current_session&view=chat&share_agent=true&agentName=${encodeURIComponent(agentName)}`
                    );
                } catch (err: any) {
                    if (cancelled) return;
                    const isNetwork = err instanceof TypeError || String(err?.message).includes("fetch");
                    setScienceAuthError(isNetwork ? "networkError" : "invalidToken");
                }
                return;
            }

            if (userSource === "science_user") {
                const accessToken = searchParams.get("access_token");
                const username = searchParams.get("username");
                const tokenId = searchParams.get("tokenId");

                // 统一认证：后端用 IHEP access_token + username 验证，换取本系统 JWT
                if (accessToken && username) {
                    try {
                        const result = await authAPI.scienceUserVerify(accessToken, username);
                        if (cancelled) return;
                        saveAuthSession(result.access_token, result.user_id);
                        localStorage.removeItem("drsai-mode-config");
                        localStorage.removeItem("drsai.recentAgents");
                        setUser({ name: result.user_id, email: result.user_id });
                        window.location.replace("/?menu=current_session&view=chat");
                    } catch (err: any) {
                        if (cancelled) return;
                        const isNetwork = err instanceof TypeError || String(err?.message).includes("fetch");
                        setScienceAuthError(isNetwork ? "networkError" : "invalidToken");
                    }
                    return;
                }

                // 院平台：通过 tokenId 换取 access_token
                if (!tokenId) {
                    if (!cancelled) setScienceAuthError("missingToken");
                    return;
                }
                try {
                    const result = await authAPI.scienceUserLogin(tokenId);
                    if (cancelled) return;
                    saveAuthSession(result.access_token, result.user_id);
                    // 清除所有 DrSai 相关 localStorage，确保 science_user 以干净状态启动
                    localStorage.removeItem("drsai-mode-config");
                    localStorage.removeItem("drsai.recentAgents");
                    setUser({ name: result.user_id, email: result.user_id });
                    // 移除 tokenId / user_source，用 replace 强制整页刷新
                    // navigate 不能触发 useEffect 重跑（pathname 没变），所以用 location.replace
                    window.location.replace("/?menu=current_session&view=chat");
                } catch (err: any) {
                    if (cancelled) return;
                    const isNetwork = err instanceof TypeError || String(err?.message).includes("fetch");
                    setScienceAuthError(isNetwork ? "networkError" : "invalidToken");
                }
                return;
            }

            const normalizedPath = normalizePath(location.pathname);
            const isPublicRoute = PUBLIC_ROUTES.some(
                (route) => normalizePath(route) === normalizedPath
            ) || PUBLIC_ROUTE_PREFIXES.some(
                (prefix) => normalizedPath.startsWith(prefix)
            );

            // 用户主动退出后带 ?logout=1，跳过 verifyAuthSession，避免
            // 残留 cookie 把人静默送回应用。
            const isLogout = searchParams.get("logout") === "1";

            if (isPublicRoute) {
                if (normalizedPath === "/login" && !isLogout) {
                    const session = await verifyAuthSession();
                    if (!cancelled && session.ok) {
                        setUser({ email: session.userEmail, name: session.displayName || session.userEmail });
                        navigate("/", { replace: true });
                        return;
                    }
                }
                if (!cancelled) {
                    setChecked(true);
                }
                return;
            }

            if (isLogout) {
                if (!cancelled) {
                    navigate("/welcome", { replace: true });
                }
                return;
            }

            const session = await verifyAuthSession();
            if (cancelled) {
                return;
            }

            if (session.ok) {
                setUser({ email: session.userEmail, name: session.displayName || session.userEmail });
                const extra = consumePendingSearch();
                if (extra && !searchParams.get("agentId") && !searchParams.get("share_agent")) {
                    navigate(`/?menu=current_session&view=chat${extra}`, { replace: true });
                    return;
                }
                setChecked(true);
                return;
            }

            if (normalizedPath !== normalizePath("/login")) {
                // 保存原始 URL 参数（agentId/agentName），登录后恢复
                // 用 cookie — 跨域重定向后不丢，max-age=600s 自动过期
                const search = location.search;
                console.log("[agentLink] RouteGuard: saving pending_search =", search);
                if (search) {
                    try { document.cookie = "drsai_pending_search=" + encodeURIComponent(search) + "; path=/; max-age=600; SameSite=Lax"; } catch {}
                }
                navigate("/welcome", { replace: true });
            }
        };

        setChecked(false);
        void guard();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    if (scienceAuthError) {
        return <ScienceUserErrorPage errorType={scienceAuthError} />;
    }

    // science_user / user_agent 验证中：显示全屏 loading，等待跳转
    const searchParams = new URLSearchParams(location.search);
    const embedSource = (searchParams.get("user_source") || "").trim();
    if (embedSource === "science_user" || embedSource === "user_agent") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
                <div className="flex flex-col items-center gap-3">
                    <span className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-gray-500 dark:text-slate-400">正在验证身份，请稍候...</p>
                </div>
            </div>
        );
    }

    if (!checked) {
        return null;
    }

    return <>{children}</>;
};
