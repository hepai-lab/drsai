import React, { useEffect } from "react";
import { HelpCircle } from "lucide-react";

type LoginTab = "sso" | "local";

export const SSOLogin: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<LoginTab>("sso");
  const [agree, setAgree] = React.useState(false);
  const [showAgreementModal, setShowAgreementModal] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginError, setLoginError] = React.useState("");

  useEffect(() => {
    const saved = localStorage.getItem("user_agreement_accepted");
    if (saved === "true") setAgree(true);
  }, []);

  const handleAgreeChange = (checked: boolean) => {
    setAgree(checked);
    if (checked) {
      localStorage.setItem("user_agreement_accepted", "true");
    } else {
      localStorage.removeItem("user_agreement_accepted");
    }
  };

  const doLogin = () => {
    if (activeTab === "sso") {
      setIsLoading(true);
      // window.location.href = `/umt/login`;
      // window.location.href = `https://opendrsai.ihep.ac.cn/umt/login`;
      window.location.href = `http://localhost:8081/umt/login`;
    } else {
      if (!username || !password) {
        setLoginError("请输入账号和密码");
        return;
      }
      setLoginError("");
      window.location.href = `/auth?username=${encodeURIComponent(username)}&token=local`;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agree) {
      setShowAgreementModal(true);
      return;
    }
    doLogin();
  };

  const switchTab = (tab: LoginTab) => {
    setActiveTab(tab);
    setLoginError("");
    setUsername("");
    setPassword("");
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-50 relative">
      {/* 左侧品牌介绍（桌面端） */}
      <div className="hidden lg:flex lg:flex-1 bg-gradient-to-br from-blue-600 to-blue-800 text-white flex-col justify-center px-8 py-12 xl:px-16 relative overflow-hidden">
        <div className="relative z-10">
          <div className="text-2xl xl:text-3xl font-bold mb-4">
            IHEP 计算中心
          </div>
          <div className="text-lg xl:text-xl mb-6 tracking-wide">
            Open Dr. Sai 智能体平台
          </div>
          <ul className="text-sm xl:text-base leading-relaxed pl-5 space-y-3">
            <li>
              <span className="text-cyan-300 mr-2">●</span>
              <span>智能对话</span>
              <div className="text-xs text-blue-100 ml-5 mt-1">
                与 Dr. Sai 进行自然语言交互，快速获取专业解答
              </div>
            </li>
            <li>
              <span className="text-cyan-300 mr-2">●</span>
              <span>强大智能体</span>
              <div className="text-xs text-blue-100 ml-5 mt-1">
                支持多种 AI 智能体，覆盖科研计算全流程
              </div>
            </li>
            <li>
              <span className="text-cyan-300 mr-2">●</span>
              <span>安全可靠</span>
              <div className="text-xs text-blue-100 ml-5 mt-1">
                依托高能所统一认证，保障数据安全
              </div>
            </li>
          </ul>
        </div>
      </div>

      {/* 移动端顶部 Logo 横幅 */}
      <div className="lg:hidden bg-gradient-to-r from-blue-600 to-blue-700 text-white py-5 px-6 text-center">
        <div className="text-xl font-bold mb-1">IHEP 计算中心</div>
        <div className="text-xs opacity-90">Open Dr. Sai 智能体平台</div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex-1 flex flex-col justify-center items-center bg-white px-4 py-8 lg:py-12">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md bg-white shadow-lg rounded-xl p-6 sm:p-8 lg:p-10 lg:-mt-12"
        >
          {/* Logo + 标题 */}
          <div className="flex items-center justify-center mb-5">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-full flex items-center justify-center mr-2.5 shadow">
              <span className="text-white font-bold text-xs">AI</span>
            </div>
            <div className="text-lg sm:text-xl font-semibold text-gray-900">
              Dr. Sai
            </div>
            <span className="text-gray-400 text-sm sm:text-base ml-2 font-normal">
              智能体平台
            </span>
          </div>

          {/* Tab 切换 */}
          <div className="flex gap-2 mb-5 mt-4">
            <button
              type="button"
              onClick={() => switchTab("sso")}
              className={`flex-1 py-2 px-3 text-xs sm:text-sm font-semibold border-none rounded-lg cursor-pointer transition-all duration-200 ${activeTab === "sso"
                ? "bg-gradient-to-br from-purple-600 to-pink-600 text-white shadow-lg"
                : "bg-gray-100 text-gray-500"
                }`}
            >
              IHEP-SSO 登录
            </button>
            <button
              type="button"
              onClick={() => switchTab("local")}
              className={`flex-1 py-2 px-3 text-xs sm:text-sm font-semibold border-none rounded-lg cursor-pointer transition-all duration-200 ${activeTab === "local"
                ? "bg-gradient-to-br from-blue-600 to-cyan-600 text-white shadow-lg"
                : "bg-gray-100 text-gray-500"
                }`}
            >
              本地账号登录
            </button>
          </div>

          {/* 错误提示 */}
          {loginError && (
            <div className="bg-red-50 text-red-600 py-2 px-3 rounded-md text-xs sm:text-sm mb-4 border border-red-200">
              {loginError}
            </div>
          )}

          {/* Tab 内容 */}
          {activeTab === "sso" ? (
            <div className="text-center text-xs sm:text-sm text-gray-600 mb-5">
              使用高能所统一认证（IHEP-SSO）登录，无需单独注册账号。
            </div>
          ) : (
            <div className="mb-4">
              <input
                type="text"
                placeholder="账号"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full py-2 px-3 text-xs sm:text-sm mb-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full py-2 px-3 text-xs sm:text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* 协议勾选 */}
          <div className="mb-5">
            <label className="text-xs text-gray-700 flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={agree}
                onChange={e => handleAgreeChange(e.target.checked)}
                className="mr-2 mt-0.5 accent-blue-600"
              />
              <div>
                我已阅读并同意
                <a href="#" className="text-blue-600 underline ml-1">用户协议</a>
              </div>
            </label>
          </div>

          {/* 登录按钮 */}
          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-2.5 sm:py-3 text-sm sm:text-base font-bold text-white border-none rounded-lg flex items-center justify-center transition-all ${!isLoading
              ? activeTab === "sso"
                ? "bg-gradient-to-br from-purple-600 to-pink-600 shadow-lg cursor-pointer hover:from-purple-700 hover:to-pink-700"
                : "bg-gradient-to-br from-blue-600 to-cyan-600 shadow-lg cursor-pointer hover:from-blue-700 hover:to-cyan-700"
              : "bg-gray-300 cursor-not-allowed"
              }`}
          >
            {isLoading ? (
              <>
                <span className="mr-2">登录中</span>
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </>
            ) : activeTab === "sso" ? (
              "IHEP-SSO 登录"
            ) : (
              "登录"
            )}
          </button>

          {/* SSO 注册提示 */}
          {activeTab === "sso" && (
            <div className="mt-4 text-center">
              <a
                href="https://newlogin.ihep.ac.cn/admin/register"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 no-underline hover:text-blue-600 transition-colors"
              >
                <HelpCircle size={14} className="flex-shrink-0" />
                <span>没有 IHEP 账号？</span>
                <span className="text-blue-600 font-semibold">立即注册</span>
              </a>
            </div>
          )}

          <div className="text-xs text-gray-400 mt-5 sm:mt-6 text-center">
            京ICP备05002790号-1 © 中国科学院高能物理研究所
          </div>
        </form>
      </div>

      {/* 协议确认弹窗 */}
      {showAgreementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 mx-4 w-full max-w-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-2">
              请先阅读用户协议
            </h2>
            <p className="text-sm text-gray-600 mb-5">
              使用本平台前，请阅读并同意用户协议及隐私政策。
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowAgreementModal(false);
                  handleAgreeChange(true);
                  doLogin();
                }}
                className={`flex-1 py-2 text-sm font-semibold text-white rounded-lg transition-all ${activeTab === "sso"
                  ? "bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                  : "bg-gradient-to-br from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
                  }`}
              >
                同意并登录
              </button>
              <button
                type="button"
                onClick={() => setShowAgreementModal(false)}
                className="flex-1 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-all"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SSOLogin;
