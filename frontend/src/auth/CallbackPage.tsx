// 接收 SSO 回调，保存 token 和 username，跳转主页

import * as React from "react";
import { navigate } from "gatsby";
import { appContext } from "../hooks/provider";

const CallbackPage = () => {
    const { setUser } = React.useContext(appContext);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");
        const username = params.get("username");

        if (!token || !username) {
            setError("未收到有效的登录凭证");
            return;
        }

        localStorage.setItem("token", token);
        localStorage.setItem("username", username);
        localStorage.setItem("user_email", username);
        localStorage.setItem("user_name", username);
        localStorage.removeItem("drsai-mode-config");

        setUser({ name: username, email: username, username });
        navigate("/", { replace: true });
    }, [setUser]);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <p className="text-red-500 mb-4">{error}</p>
                    <a href="/login" className="text-blue-600 underline text-sm">返回登录</a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <p className="text-gray-500">正在登录，请稍候...</p>
        </div>
    );
};

export default CallbackPage;
