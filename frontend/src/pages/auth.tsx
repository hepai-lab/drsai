// 接收sso登录的回调，负责保存token和username到本地存储，并跳转到主页

import * as React from "react";
import { navigate } from "gatsby";

const AuthPage = () => {
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const username = params.get("username");
    if (token && username) {
      localStorage.setItem("token", token);
      localStorage.setItem("username", username);
      localStorage.setItem("user_email", username); // 假设username就是email
      localStorage.setItem("user_name", username);
      // 跳转到主页
      navigate("/");
    } else {
      // 没有参数，跳转到登录
      navigate("/sso-login");
    }
  }, []);
  return <div>正在登录，请稍候...</div>;
};

export default AuthPage;
