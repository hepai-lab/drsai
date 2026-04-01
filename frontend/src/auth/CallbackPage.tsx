// 接收 SSO 回调，保存 token 和 username，跳转主页

import * as React from "react";
import { navigate } from "gatsby";
import { appContext } from "../hooks/provider";
import { agentWorkerAPI } from "../components/views/api";

const CallbackPage = () => {
    const { setUser } = React.useContext(appContext);
    React.useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");
        const username = params.get("username");
        if (token && username) {
            localStorage.setItem("token", token);
            localStorage.setItem("username", username);
            localStorage.setItem("user_email", username);
            localStorage.setItem("user_name", username);
            localStorage.removeItem("drsai-mode-config");

            setUser({ name: username, email: username, username });

            agentWorkerAPI.getUserDefaultAgents(username)
                .then(() => navigate("/", { delay: 0 }))
                .catch((error) => {
                    console.error("Failed to initialize user default agents:", error);
                    navigate("/", { delay: 0 });
                });
        } else {
            navigate("/login");
        }
    }, []);
    return <div>正在登录，请稍候...</div>;
};

export default CallbackPage;
