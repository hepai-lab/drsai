// 接收 SSO 回调，保存 token 和 user_email，跳转主页

import * as React from "react";
import { navigate } from "gatsby";
import { appContext } from "../hooks/provider";
import { useLang } from "../i18n/useLang";
import { saveAuthSession } from "../utils/authSession";

const CallbackPage = () => {
    const { setUser } = React.useContext(appContext);
    const { t } = useLang();
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");
        const userEmail = params.get("username");

        if (!token || !userEmail) {
            setError(t("callback.error.noCredentials"));
            return;
        }

        saveAuthSession(token, userEmail);
        localStorage.removeItem("drsai-mode-config");

        setUser({ name: userEmail, email: userEmail });
        navigate("/?menu=current_session&view=chat", { replace: true });
    }, [setUser]);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <p className="text-red-500 mb-4">{error}</p>
                    <a href="/login" className="text-blue-600 underline text-sm">{t("callback.backToLogin")}</a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <p className="text-gray-500">{t("callback.loggingIn")}</p>
        </div>
    );
};

export default CallbackPage;
