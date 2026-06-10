import React, { useEffect } from "react";
import { useLocation, useNavigate } from "../hooks/useRouter";

// 公开路由列表（不需要登录即可访问）
const PUBLIC_ROUTES = ["/login", "/sso-login"];

// 标准化路径，兼容 Gatsby 的 trailing slash（/login 与 /login/ 视为同一路由）
const normalizePath = (path: string) => path.replace(/\/$/, "") || "/";

interface RouteGuardProps {
    children: React.ReactNode;
}

/**
 * 路由保护组件 - 使用 react-router-dom
 * - 未登录态：只能访问 /login，访问其他页面强制重定向到 /login
 * - 已登录态：可以访问受保护页面，访问 /login 自动跳转首页
 * - 刷新不丢登录态
 */
export const RouteGuard: React.FC<RouteGuardProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        // 检查登录状态
        const checkAuth = () => {
            // 使用 user_email 作为登录状态标识（刷新时也能保持）
            const user_email = localStorage.getItem("user_email");
            const isAuthenticated = !!user_email;
            const currentPath = location.pathname;
            const normalizedPath = normalizePath(currentPath);
            const isPublicRoute = PUBLIC_ROUTES.some((r) => normalizePath(r) === normalizedPath);

            if (isAuthenticated) {
                // 已登录态
                // 如果访问登录页，重定向到首页
                if (normalizedPath === "/login" || normalizedPath === "/sso-login") {
                    navigate("/", { replace: true });
                    return;
                }
            } else {
                // 未登录态
                // 如果访问非公开路由，重定向到登录页
                if (!isPublicRoute) {
                    const loginPath = process.env.GATSBY_SERVICE_MODE === "DEV" ? "/login" : "/sso-login";
                    // 避免重复重定向（标准化后比较，兼容 /login 与 /login/）
                    if (normalizedPath !== normalizePath(loginPath)) {
                        navigate(loginPath, { replace: true });
                        return;
                    }
                }
            }
        };

        checkAuth();
        // 只依赖 pathname，不依赖 navigate（因为 navigate 现在是稳定的）
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    // 直接显示内容，让路由系统处理重定向
    // 如果需要重定向，路由会变化，useEffect 会再次执行
    return <>{children}</>;
};
