import React, { useState, useEffect } from "react";
import { HelpCircle, Sun, Moon, Globe } from "lucide-react";
import { appContext } from "../hooks/provider";
import { useLang } from "../i18n/useLang";
import { authAPI } from "../components/views/api";
import { saveAuthSession } from "../utils/authSession";

type LoginTab = "sso" | "login" | "register";

/** 编译期开关：构建前 export 或 .env 中设 GATSBY_ALLOW_REGISTER / GATSBY_ENABLE_LOCAL_REGISTRATION */
const ENABLE_REGISTRATION =
    process.env.GATSBY_ALLOW_REGISTER === "true" ||
    process.env.GATSBY_ENABLE_LOCAL_REGISTRATION === "true";

const LoginPage: React.FC = () => {
    const { setUser, darkMode, setDarkMode } = React.useContext(appContext);
    const [activeTab, setActiveTab] = useState<LoginTab>("sso");
    const [agree, setAgree] = useState(false);
    const [showAgreementModal, setShowAgreementModal] = useState(false);
    const { lang, toggleLang, t } = useLang();

    // 本地登录
    const [loginUsername, setLoginUsername] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [loginLoading, setLoginLoading] = useState(false);

    // 注册
    const [regUsername, setRegUsername] = useState("");
    const [regPassword, setRegPassword] = useState("");
    const [regConfirmPassword, setRegConfirmPassword] = useState("");
    const [registerLoading, setRegisterLoading] = useState(false);

    // SSO
    const [ssoLoading, setSsoLoading] = useState(false);

    const [error, setError] = useState("");

    useEffect(() => {
        const saved = localStorage.getItem("user_agreement_accepted");
        if (saved === "true") setAgree(true);
    }, []);

    // 同步 dark mode 到 html 元素
    useEffect(() => {
        document.documentElement.className = darkMode === "dark" ? "dark bg-primary" : "light bg-primary";
    }, [darkMode]);



    const handleAgreeChange = (checked: boolean) => {
        setAgree(checked);
        if (checked) {
            localStorage.setItem("user_agreement_accepted", "true");
        } else {
            localStorage.removeItem("user_agreement_accepted");
        }
    };

    const switchTab = (tab: LoginTab) => {
        setActiveTab(tab);
        setError("");
    };

    const doSSO = () => {
        setSsoLoading(true);
        window.location.href = `/umt/login`;
    };

    const doLogin = async () => {
        if (!loginUsername || !loginPassword) {
            setError(t("login.error.emptyFields"));
            return;
        }
        setLoginLoading(true);
        try {
            const response = await authAPI.login(loginUsername, loginPassword);
            if (response.status && response.data?.access_token) {
                const userId = response.data.user_id || loginUsername;
                saveAuthSession(response.data.access_token, userId);
                setUser({ name: userId, email: userId });
                localStorage.removeItem("drsai-mode-config");
                window.location.href = "/?menu=current_session&view=chat";
            }
        } catch (err: any) {
            setError(err.message || t("login.error.loginFailed"));
        } finally {
            setLoginLoading(false);
        }
    };

    const doRegister = async () => {
        if (!regUsername || !regPassword || !regConfirmPassword) {
            setError(t("login.error.emptyRegistration"));
            return;
        }
        if (/^\d+$/.test(regUsername)) {
            setError(t("login.error.digitsOnly"));
            return;
        }
        if (regUsername.length < 3) {
            setError(t("login.error.usernameTooShort"));
            return;
        }
        if (regPassword.length < 12) {
            setError(t("login.error.passwordTooShort"));
            return;
        }
        // 密码复杂度校验：至少包含大小写字母、数字、特殊符号中3种
        let pwdTypes = 0;
        if (/[a-z]/.test(regPassword)) pwdTypes++;
        if (/[A-Z]/.test(regPassword)) pwdTypes++;
        if (/\d/.test(regPassword)) pwdTypes++;
        if (/[^a-zA-Z\d]/.test(regPassword)) pwdTypes++;
        if (pwdTypes < 3) {
            setError(t("login.error.passwordTooSimple"));
            return;
        }
        // 拒绝含用户名全拼或日期格式
        if (regPassword.toLowerCase().includes(regUsername.toLowerCase()) || /\d{4}-?\d{2}-?\d{2}/.test(regPassword)) {
            setError(t("login.error.passwordWeakPattern"));
            return;
        }
        if (regPassword !== regConfirmPassword) {
            setError(t("login.error.passwordMismatch"));
            return;
        }
        setRegisterLoading(true);
        try {
            const response = await authAPI.register(regUsername, regPassword);
            if (response.status) {
                setError("");
                switchTab("login");
                setLoginUsername(regUsername);
            }
        } catch (err: any) {
            setError(err.message || t("login.error.registrationFailed"));
        } finally {
            setRegisterLoading(false);
        }
    };

    const doAction = () => {
        if (activeTab === "sso") doSSO();
        else if (activeTab === "login") doLogin();
        else doRegister();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!agree) {
            setShowAgreementModal(true);
            return;
        }
        doAction();
    };

    const handleAgreeAndProceed = () => {
        setShowAgreementModal(false);
        handleAgreeChange(true);
        doAction();
    };

    const isLoading = ssoLoading || loginLoading || registerLoading;

    const tabBtnClass = (tab: LoginTab) => {
        const active = activeTab === tab;
        const colors: Record<LoginTab, string> = {
            sso: "bg-gradient-to-br from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/30",
            login: "bg-gradient-to-br from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-500/30",
            register: "bg-gradient-to-br from-green-600 to-teal-600 text-white shadow-lg shadow-green-500/30",
        };
        return `flex-1 py-2 px-2 text-xs sm:text-sm font-semibold border-none rounded-lg cursor-pointer transition-all duration-200 ${active ? colors[tab] : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"
            }`;
    };

    const submitBtnColor: Record<LoginTab, string> = {
        sso: "bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-purple-500/30",
        login: "bg-gradient-to-br from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-blue-500/30",
        register: "bg-gradient-to-br from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 shadow-green-500/30",
    };

    const submitLabel: Record<LoginTab, string> = {
        sso: t("login.submit.sso"),
        login: t("login.submit.login"),
        register: t("login.submit.register"),
    };

    const loadingLabel: Record<LoginTab, string> = {
        sso: t("login.loading.redirecting"),
        login: t("login.loading.loggingIn"),
        register: t("login.loading.registering"),
    };

    return (
        <div className="flex flex-col lg:flex-row min-h-screen [min-height:100svh] bg-gray-50 dark:bg-slate-950 relative">
            {/* 右上角：主题 + 语言切换 */}
            <div className="absolute top-4 right-4 z-50 flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setDarkMode(darkMode === "dark" ? "light" : "dark")}
                    className="p-2 rounded-lg hover:bg-white/20 dark:hover:bg-slate-800 transition-colors"
                    aria-label={t("login.theme.aria")}
                >
                    {darkMode === "dark"
                        ? <Sun size={18} className="text-slate-300" />
                        : <Moon size={18} className="text-gray-600" />
                    }
                </button>
                <button
                    type="button"
                    onClick={toggleLang}
                    className="flex items-center gap-1 px-2 py-2 rounded-lg hover:bg-white/20 dark:hover:bg-slate-800 transition-colors text-sm font-medium text-gray-600 dark:text-slate-300"
                >
                    <Globe size={18} />
                    <span className="hidden sm:inline">{lang === "zh" ? "中/En" : "En/中"}</span>
                </button>
            </div>

            {/* 左侧品牌介绍（桌面端） */}
            <div className="hidden lg:flex lg:flex-1 bg-gradient-to-br from-[#2563eb] to-[#1e3a8a] dark:from-slate-900 dark:via-blue-950 dark:to-slate-950 text-white flex-col justify-center px-8 py-12 xl:px-16 relative overflow-hidden">
                <div className="hidden dark:block absolute inset-0 bg-gradient-to-br from-blue-500/20 via-cyan-500/10 to-transparent pointer-events-none"></div>
                <div className="hidden dark:block absolute bottom-0 right-0 w-96 h-96 bg-blue-500/5 blur-3xl rounded-full pointer-events-none"></div>
                <div className="relative z-10">
                    <div className="text-2xl xl:text-3xl font-bold mb-4 dark:text-transparent dark:bg-gradient-to-r dark:from-blue-300 dark:via-cyan-300 dark:to-blue-400 dark:bg-clip-text">
                        {t("login.brand.ihep")}
                    </div>
                    <div className="text-lg xl:text-xl mb-6 tracking-wide dark:text-blue-200/90">
                        {t("login.brand.platform")}
                    </div>
                    <ul className="text-sm xl:text-base leading-relaxed pl-5 space-y-3">
                        <li className="mb-3">
                            <span className="text-cyan-300 mr-2">●</span>
                            <span className="dark:text-blue-100">{t("login.features.smartChat")}</span>
                            <div className="text-xs text-blue-100 dark:text-blue-300/70 ml-5 mt-1">
                                {t("login.features.smartChatDesc")}
                            </div>
                        </li>
                        <li className="mb-3">
                            <span className="text-cyan-300 mr-2">●</span>
                            <span className="dark:text-blue-100">{t("login.features.powerfulAgents")}</span>
                            <div className="text-xs text-blue-100 dark:text-blue-300/70 ml-5 mt-1">
                                {t("login.features.powerfulAgentsDesc")}
                            </div>
                        </li>
                        <li>
                            <span className="text-cyan-300 mr-2">●</span>
                            <span className="dark:text-blue-100">{t("login.features.secure")}</span>
                            <div className="text-xs text-blue-100 dark:text-blue-300/70 ml-5 mt-1">
                                {t("login.features.secureDesc")}
                            </div>
                        </li>
                    </ul>
                </div>
            </div>

            {/* 移动端顶部 Logo 横幅 */}
            <div className="lg:hidden bg-gradient-to-r from-[#2563eb] to-[#1e40af] dark:from-slate-900 dark:via-blue-950 dark:to-slate-900 dark:border-b dark:border-blue-900/30 text-white py-5 px-6 text-center relative overflow-hidden">
                <div className="hidden dark:block absolute inset-0 bg-gradient-to-r from-blue-500/20 to-cyan-500/10 pointer-events-none"></div>
                <div className="relative z-10">
                    <div className="text-xl font-bold mb-1 dark:text-transparent dark:bg-gradient-to-r dark:from-blue-300 dark:to-cyan-300 dark:bg-clip-text">
                        {t("login.brand.ihep")}
                    </div>
                    <div className="text-xs opacity-90 dark:text-blue-200/80">
                        {t("login.brand.platform")}
                    </div>
                </div>
            </div>

            {/* 右侧登录表单 */}
            <div className="flex-1 flex flex-col justify-center items-center bg-white dark:bg-slate-900 px-4 py-8 lg:py-12">
                <form
                    onSubmit={handleSubmit}
                    className="w-full max-w-md bg-white dark:bg-gradient-to-br dark:from-slate-900 dark:to-slate-800 shadow-lg rounded-xl p-6 sm:p-8 lg:p-10 lg:-mt-12"
                >
                    {/* Logo + 标题 */}
                    <div className="flex items-center justify-center mb-5">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-full flex items-center justify-center mr-2.5 shadow shadow-blue-500/30">
                            <span className="text-white font-bold text-xs">AI</span>
                        </div>
                        <div className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-transparent dark:bg-gradient-to-r dark:from-blue-400 dark:to-cyan-400 dark:bg-clip-text">OpenDrSai</div>
                        <span className="text-gray-400 dark:text-slate-500 text-sm sm:text-base ml-2 font-normal">
                            {t("login.brand.subtitle")}
                        </span>
                    </div>

                    {/* Tab 切换 */}
                    <div className="flex gap-2 mb-5 mt-4">
                        <button type="button" onClick={() => switchTab("sso")} className={tabBtnClass("sso")}>
                            {t("login.tab.sso")}
                        </button>
                        <button type="button" onClick={() => switchTab("login")} className={tabBtnClass("login")}>
                            {t("login.tab.localLogin")}
                        </button>
                        {ENABLE_REGISTRATION && (
                            <button type="button" onClick={() => switchTab("register")} className={tabBtnClass("register")}>
                                {t("login.tab.register")}
                            </button>
                        )}
                    </div>

                    {/* 错误提示 */}
                    {error && (
                        <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 py-2 px-3 rounded-md text-xs sm:text-sm mb-4 border border-red-200 dark:border-red-800">
                            {error}
                        </div>
                    )}

                    {/* Tab 内容 */}
                    {activeTab === "sso" && (
                        <div className="text-center text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-5">
                            {t("login.sso.description")}
                        </div>
                    )}

                    {activeTab === "login" && (
                        <div className="mb-4">
                            <input
                                type="text"
                                placeholder={t("login.form.username")}
                                value={loginUsername}
                                onChange={e => setLoginUsername(e.target.value)}
                                className="w-full py-2 px-3 text-xs sm:text-sm mb-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <input
                                type="password"
                                placeholder={t("login.form.password")}
                                value={loginPassword}
                                onChange={e => setLoginPassword(e.target.value)}
                                className="w-full py-2 px-3 text-xs sm:text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                    )}

                    {activeTab === "register" && ENABLE_REGISTRATION && (
                        <div className="mb-4">
                            <input
                                type="text"
                                placeholder={t("login.form.usernameHint")}
                                value={regUsername}
                                onChange={e => setRegUsername(e.target.value)}
                                className="w-full py-2 px-3 text-xs sm:text-sm mb-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                            <input
                                type="password"
                                placeholder={t("login.form.passwordHint")}
                                value={regPassword}
                                onChange={e => setRegPassword(e.target.value)}
                                className="w-full py-2 px-3 text-xs sm:text-sm mb-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                            <input
                                type="password"
                                placeholder={t("login.form.confirmPassword")}
                                value={regConfirmPassword}
                                onChange={e => setRegConfirmPassword(e.target.value)}
                                className="w-full py-2 px-3 text-xs sm:text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                        </div>
                    )}

                    {/* 协议勾选 */}
                    <div className="mb-5">
                        <label className="text-xs text-gray-700 dark:text-slate-300 flex items-start cursor-pointer">
                            <input
                                type="checkbox"
                                checked={agree}
                                onChange={e => handleAgreeChange(e.target.checked)}
                                className="mr-2 mt-0.5 accent-blue-600"
                            />
                            <div>
                                {t("login.agreement.read")}
                                <a href="#" className="text-blue-600 dark:text-blue-400 underline ml-1">
                                    {t("login.agreement.title")}
                                </a>
                                {agree && (
                                    <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                        {t("login.agreement.saved")}
                                    </div>
                                )}
                            </div>
                        </label>
                    </div>

                    {/* 提交按钮 */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className={`w-full py-2.5 sm:py-3 text-sm sm:text-base font-bold text-white border-none rounded-lg flex items-center justify-center transition-all ${!isLoading
                            ? `${submitBtnColor[activeTab]} shadow-lg cursor-pointer`
                            : "bg-gray-300 dark:bg-slate-700 cursor-not-allowed"
                            }`}
                    >
                        {isLoading ? (
                            <>
                                <span className="mr-2">{loadingLabel[activeTab]}</span>
                                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            </>
                        ) : (
                            submitLabel[activeTab]
                        )}
                    </button>

                    {/* SSO 注册提示 */}
                    {activeTab === "sso" && (
                        <div className="mt-4 text-center">
                            <a
                                href="https://newlogin.ihep.ac.cn/admin/register"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 no-underline hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                            >
                                <HelpCircle size={14} className="flex-shrink-0" />
                                <span>{t("login.sso.noAccount")}</span>
                                <span className="text-blue-600 dark:text-blue-400 font-semibold">{t("login.sso.registerNow")}</span>
                            </a>
                        </div>
                    )}

                    <div className="text-xs text-gray-400 dark:text-slate-500 mt-5 sm:mt-6 text-center">
                        京ICP备05002790号-1 © 中国科学院高能物理研究所
                        <a href="#" className="text-blue-600 dark:text-blue-400 ml-2 hover:underline">
                            {t("login.footer.contact")}
                        </a>
                    </div>
                </form>
            </div>

            {/* 协议确认弹窗 */}
            {showAgreementModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 mx-4 w-full max-w-sm">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
                            {t("login.modal.title")}
                        </h2>
                        <p className="text-sm text-gray-600 dark:text-slate-300 mb-5">
                            {t("login.modal.description")}
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={handleAgreeAndProceed}
                                className={`flex-1 py-2 text-sm font-semibold text-white rounded-lg transition-all ${submitBtnColor[activeTab]}`}
                            >
                                {t("login.modal.agree")}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowAgreementModal(false)}
                                className="flex-1 py-2 text-sm font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-all"
                            >
                                {t("login.modal.cancel")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoginPage;
