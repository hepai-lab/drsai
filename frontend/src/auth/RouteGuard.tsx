import React, { useEffect } from "react";
import { useLocation, useNavigate } from "../hooks/useRouter";

const PUBLIC_ROUTES = ["/login", "/auth"];

const normalizePath = (path: string) => path.replace(/\/$/, "") || "/";

interface RouteGuardProps {
    children: React.ReactNode;
}

export const RouteGuard: React.FC<RouteGuardProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        const user_email = localStorage.getItem("user_email");
        const isAuthenticated = !!user_email;
        const normalizedPath = normalizePath(location.pathname);
        const isPublicRoute = PUBLIC_ROUTES.some((r) => normalizePath(r) === normalizedPath);

        if (isAuthenticated) {
            if (normalizedPath === "/login") {
                navigate("/", { replace: true });
            }
        } else {
            if (!isPublicRoute && normalizedPath !== normalizePath("/login")) {
                navigate("/login", { replace: true });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    return <>{children}</>;
};
