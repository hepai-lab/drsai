import React, { useContext, useEffect, useState } from "react";
import { useLocation, useNavigate } from "../hooks/useRouter";
import { appContext } from "../hooks/provider";
import { verifyAuthSession } from "../utils/authSession";

const PUBLIC_ROUTES = ["/login", "/auth", "/share"];

const normalizePath = (path: string) => path.replace(/\/$/, "") || "/";

interface RouteGuardProps {
    children: React.ReactNode;
}

export const RouteGuard: React.FC<RouteGuardProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { setUser } = useContext(appContext);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const guard = async () => {
            const normalizedPath = normalizePath(location.pathname);
            const isPublicRoute = PUBLIC_ROUTES.some(
                (route) => normalizePath(route) === normalizedPath
            );

            if (isPublicRoute) {
                if (normalizedPath === "/login") {
                    const session = await verifyAuthSession();
                    if (!cancelled && session.ok) {
                        setUser({ email: session.userEmail, name: session.userEmail });
                        navigate("/", { replace: true });
                        return;
                    }
                }
                if (!cancelled) {
                    setChecked(true);
                }
                return;
            }

            const session = await verifyAuthSession();
            if (cancelled) {
                return;
            }

            if (session.ok) {
                setUser({ email: session.userEmail, name: session.userEmail });
                setChecked(true);
                return;
            }

            if (normalizedPath !== normalizePath("/login")) {
                navigate("/login", { replace: true });
            }
        };

        setChecked(false);
        void guard();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    if (!checked) {
        return null;
    }

    return <>{children}</>;
};
