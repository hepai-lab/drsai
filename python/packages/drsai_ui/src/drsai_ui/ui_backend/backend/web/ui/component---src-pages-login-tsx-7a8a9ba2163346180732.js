"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[2655,5626],{

/***/ 78602:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* reexport */ auth_LoginPage; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/sun.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Sun = (0,createLucideIcon/* default */.A)("Sun", [
  ["circle", { cx: "12", cy: "12", r: "4", key: "4exip2" }],
  ["path", { d: "M12 2v2", key: "tus03m" }],
  ["path", { d: "M12 20v2", key: "1lh1kg" }],
  ["path", { d: "m4.93 4.93 1.41 1.41", key: "149t6j" }],
  ["path", { d: "m17.66 17.66 1.41 1.41", key: "ptbguv" }],
  ["path", { d: "M2 12h2", key: "1t8f8n" }],
  ["path", { d: "M20 12h2", key: "1q8mjw" }],
  ["path", { d: "m6.34 17.66-1.41 1.41", key: "1m8zz5" }],
  ["path", { d: "m19.07 4.93-1.41 1.41", key: "1shlcs" }]
]);


//# sourceMappingURL=sun.js.map

;// ./node_modules/lucide-react/dist/esm/icons/moon.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Moon = (0,createLucideIcon/* default */.A)("Moon", [
  ["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z", key: "a7tn18" }]
]);


//# sourceMappingURL=moon.js.map

;// ./node_modules/lucide-react/dist/esm/icons/globe.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Globe = (0,createLucideIcon/* default */.A)("Globe", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", key: "13o1zl" }],
  ["path", { d: "M2 12h20", key: "9i4pu4" }]
]);


//# sourceMappingURL=globe.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/circle-help.js
var circle_help = __webpack_require__(64997);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
;// ./src/auth/LoginPage.tsx
/** 编译期开关：构建前 export 或 .env 中设 GATSBY_ALLOW_REGISTER / GATSBY_ENABLE_LOCAL_REGISTRATION */const ENABLE_REGISTRATION=({}).GATSBY_ALLOW_REGISTER==="true"||({}).GATSBY_ENABLE_LOCAL_REGISTRATION==="true";const LoginPage=()=>{const{setUser,darkMode,setDarkMode}=react.useContext(provider/* appContext */.v);const{0:activeTab,1:setActiveTab}=(0,react.useState)("sso");const{0:agree,1:setAgree}=(0,react.useState)(false);const{0:showAgreementModal,1:setShowAgreementModal}=(0,react.useState)(false);const{0:lang,1:setLang}=(0,react.useState)(()=>localStorage.getItem("login_lang")||"zh");// 本地登录
const{0:loginUsername,1:setLoginUsername}=(0,react.useState)("");const{0:loginPassword,1:setLoginPassword}=(0,react.useState)("");const{0:loginLoading,1:setLoginLoading}=(0,react.useState)(false);// 注册
const{0:regUsername,1:setRegUsername}=(0,react.useState)("");const{0:regPassword,1:setRegPassword}=(0,react.useState)("");const{0:regConfirmPassword,1:setRegConfirmPassword}=(0,react.useState)("");const{0:registerLoading,1:setRegisterLoading}=(0,react.useState)(false);// SSO
const{0:ssoLoading,1:setSsoLoading}=(0,react.useState)(false);const{0:error,1:setError}=(0,react.useState)("");(0,react.useEffect)(()=>{const saved=localStorage.getItem("user_agreement_accepted");if(saved==="true")setAgree(true);},[]);// 同步 dark mode 到 html 元素
(0,react.useEffect)(()=>{document.documentElement.className=darkMode==="dark"?"dark bg-primary":"light bg-primary";},[darkMode]);const toggleLang=()=>{const next=lang==="zh"?"en":"zh";setLang(next);localStorage.setItem("login_lang",next);};const t=(zh,en)=>lang==="zh"?zh:en;const handleAgreeChange=checked=>{setAgree(checked);if(checked){localStorage.setItem("user_agreement_accepted","true");}else{localStorage.removeItem("user_agreement_accepted");}};const switchTab=tab=>{setActiveTab(tab);setError("");};const doSSO=()=>{setSsoLoading(true);window.location.href="/umt/login";};const doLogin=async()=>{if(!loginUsername||!loginPassword){setError("请输入用户名和密码");return;}setLoginLoading(true);try{const response=await api/* authAPI */.R2.login(loginUsername,loginPassword);if(response.status){localStorage.setItem("token","local_"+Date.now());localStorage.setItem("username",loginUsername);localStorage.setItem("user_email",loginUsername);localStorage.setItem("user_name",loginUsername);setUser({name:loginUsername,email:loginUsername,username:loginUsername});localStorage.removeItem("drsai-mode-config");window.location.href="/?menu=current_session&view=chat";}}catch(err){setError(err.message||"登录失败，请重试");}finally{setLoginLoading(false);}};const doRegister=async()=>{if(!regUsername||!regPassword||!regConfirmPassword){setError("请填写所有字段");return;}if(/^\d+$/.test(regUsername)){setError("用户名不能是纯数字");return;}if(regUsername.length<3){setError("用户名至少 3 个字符");return;}if(regPassword.length<6){setError("密码至少 6 个字符");return;}if(regPassword!==regConfirmPassword){setError("两次输入的密码不一致");return;}setRegisterLoading(true);try{const response=await api/* authAPI */.R2.register(regUsername,regPassword);if(response.status){setError("");switchTab("login");setLoginUsername(regUsername);}}catch(err){setError(err.message||"注册失败，请重试");}finally{setRegisterLoading(false);}};const doAction=()=>{if(activeTab==="sso")doSSO();else if(activeTab==="login")doLogin();else doRegister();};const handleSubmit=e=>{e.preventDefault();if(!agree){setShowAgreementModal(true);return;}doAction();};const handleAgreeAndProceed=()=>{setShowAgreementModal(false);handleAgreeChange(true);doAction();};const isLoading=ssoLoading||loginLoading||registerLoading;const tabBtnClass=tab=>{const active=activeTab===tab;const colors={sso:"bg-gradient-to-br from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/30",login:"bg-gradient-to-br from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-500/30",register:"bg-gradient-to-br from-green-600 to-teal-600 text-white shadow-lg shadow-green-500/30"};return"flex-1 py-2 px-2 text-xs sm:text-sm font-semibold border-none rounded-lg cursor-pointer transition-all duration-200 "+(active?colors[tab]:"bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400");};const submitBtnColor={sso:"bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-purple-500/30",login:"bg-gradient-to-br from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-blue-500/30",register:"bg-gradient-to-br from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 shadow-green-500/30"};const submitLabel={sso:t("IHEP-SSO 登录","IHEP-SSO Login"),login:t("登录","Login"),register:t("注册","Register")};const loadingLabel={sso:t("跳转中","Redirecting"),login:t("登录中","Logging in"),register:t("注册中","Registering")};return/*#__PURE__*/react.createElement("div",{className:"flex flex-col lg:flex-row min-h-screen [min-height:100svh] bg-gray-50 dark:bg-slate-950 relative"},/*#__PURE__*/react.createElement("div",{className:"absolute top-4 right-4 z-50 flex items-center gap-1"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>setDarkMode(darkMode==="dark"?"light":"dark"),className:"p-2 rounded-lg hover:bg-white/20 dark:hover:bg-slate-800 transition-colors","aria-label":"\u5207\u6362\u4E3B\u9898"},darkMode==="dark"?/*#__PURE__*/react.createElement(Sun,{size:18,className:"text-slate-300"}):/*#__PURE__*/react.createElement(Moon,{size:18,className:"text-gray-600"})),/*#__PURE__*/react.createElement("button",{type:"button",onClick:toggleLang,className:"flex items-center gap-1 px-2 py-2 rounded-lg hover:bg-white/20 dark:hover:bg-slate-800 transition-colors text-sm font-medium text-gray-600 dark:text-slate-300"},/*#__PURE__*/react.createElement(Globe,{size:18}),/*#__PURE__*/react.createElement("span",{className:"hidden sm:inline"},lang==="zh"?"中/En":"En/中"))),/*#__PURE__*/react.createElement("div",{className:"hidden lg:flex lg:flex-1 bg-gradient-to-br from-[#2563eb] to-[#1e3a8a] dark:from-slate-900 dark:via-blue-950 dark:to-slate-950 text-white flex-col justify-center px-8 py-12 xl:px-16 relative overflow-hidden"},/*#__PURE__*/react.createElement("div",{className:"hidden dark:block absolute inset-0 bg-gradient-to-br from-blue-500/20 via-cyan-500/10 to-transparent pointer-events-none"}),/*#__PURE__*/react.createElement("div",{className:"hidden dark:block absolute bottom-0 right-0 w-96 h-96 bg-blue-500/5 blur-3xl rounded-full pointer-events-none"}),/*#__PURE__*/react.createElement("div",{className:"relative z-10"},/*#__PURE__*/react.createElement("div",{className:"text-2xl xl:text-3xl font-bold mb-4 dark:text-transparent dark:bg-gradient-to-r dark:from-blue-300 dark:via-cyan-300 dark:to-blue-400 dark:bg-clip-text"},t("IHEP CAS","IHEP Computing Center")),/*#__PURE__*/react.createElement("div",{className:"text-lg xl:text-xl mb-6 tracking-wide dark:text-blue-200/90"},t("Open Dr. Sai 智能体平台","Open Dr. Sai Agent Platform")),/*#__PURE__*/react.createElement("ul",{className:"text-sm xl:text-base leading-relaxed pl-5 space-y-3"},/*#__PURE__*/react.createElement("li",{className:"mb-3"},/*#__PURE__*/react.createElement("span",{className:"text-cyan-300 mr-2"},"\u25CF"),/*#__PURE__*/react.createElement("span",{className:"dark:text-blue-100"},t("智能对话","Smart Chat")),/*#__PURE__*/react.createElement("div",{className:"text-xs text-blue-100 dark:text-blue-300/70 ml-5 mt-1"},t("与 Open Dr. Sai 进行自然语言交互，快速获取专业解答","Interact with Open Dr. Sai in natural language for quick expert answers"))),/*#__PURE__*/react.createElement("li",{className:"mb-3"},/*#__PURE__*/react.createElement("span",{className:"text-cyan-300 mr-2"},"\u25CF"),/*#__PURE__*/react.createElement("span",{className:"dark:text-blue-100"},t("强大智能体","Powerful Agents")),/*#__PURE__*/react.createElement("div",{className:"text-xs text-blue-100 dark:text-blue-300/70 ml-5 mt-1"},t("支持多种 AI 智能体，覆盖科研计算全流程","Multiple AI agents covering the full scientific computing workflow"))),/*#__PURE__*/react.createElement("li",null,/*#__PURE__*/react.createElement("span",{className:"text-cyan-300 mr-2"},"\u25CF"),/*#__PURE__*/react.createElement("span",{className:"dark:text-blue-100"},t("安全可靠","Secure & Reliable")),/*#__PURE__*/react.createElement("div",{className:"text-xs text-blue-100 dark:text-blue-300/70 ml-5 mt-1"},t("依托高能所统一认证，保障数据安全","Built on IHEP unified authentication for data security")))))),/*#__PURE__*/react.createElement("div",{className:"lg:hidden bg-gradient-to-r from-[#2563eb] to-[#1e40af] dark:from-slate-900 dark:via-blue-950 dark:to-slate-900 dark:border-b dark:border-blue-900/30 text-white py-5 px-6 text-center relative overflow-hidden"},/*#__PURE__*/react.createElement("div",{className:"hidden dark:block absolute inset-0 bg-gradient-to-r from-blue-500/20 to-cyan-500/10 pointer-events-none"}),/*#__PURE__*/react.createElement("div",{className:"relative z-10"},/*#__PURE__*/react.createElement("div",{className:"text-xl font-bold mb-1 dark:text-transparent dark:bg-gradient-to-r dark:from-blue-300 dark:to-cyan-300 dark:bg-clip-text"},t("IHEP CAS","IHEP Computing Center")),/*#__PURE__*/react.createElement("div",{className:"text-xs opacity-90 dark:text-blue-200/80"},t("Open Dr. Sai 智能体平台","Open Dr. Sai Agent Platform")))),/*#__PURE__*/react.createElement("div",{className:"flex-1 flex flex-col justify-center items-center bg-white dark:bg-slate-900 px-4 py-8 lg:py-12"},/*#__PURE__*/react.createElement("form",{onSubmit:handleSubmit,className:"w-full max-w-md bg-white dark:bg-gradient-to-br dark:from-slate-900 dark:to-slate-800 shadow-lg rounded-xl p-6 sm:p-8 lg:p-10 lg:-mt-12"},/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center mb-5"},/*#__PURE__*/react.createElement("div",{className:"w-8 h-8 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-full flex items-center justify-center mr-2.5 shadow shadow-blue-500/30"},/*#__PURE__*/react.createElement("span",{className:"text-white font-bold text-xs"},"AI")),/*#__PURE__*/react.createElement("div",{className:"text-lg sm:text-xl font-semibold text-gray-900 dark:text-transparent dark:bg-gradient-to-r dark:from-blue-400 dark:to-cyan-400 dark:bg-clip-text"},"Open Dr. Sai"),/*#__PURE__*/react.createElement("span",{className:"text-gray-400 dark:text-slate-500 text-sm sm:text-base ml-2 font-normal"},t("智能体平台","Agent Platform"))),/*#__PURE__*/react.createElement("div",{className:"flex gap-2 mb-5 mt-4"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>switchTab("sso"),className:tabBtnClass("sso")},t("SSO 登录","SSO Login")),/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>switchTab("login"),className:tabBtnClass("login")},t("本地登录","Local Login")),ENABLE_REGISTRATION&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>switchTab("register"),className:tabBtnClass("register")},t("注册","Register"))),error&&/*#__PURE__*/react.createElement("div",{className:"bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 py-2 px-3 rounded-md text-xs sm:text-sm mb-4 border border-red-200 dark:border-red-800"},error),activeTab==="sso"&&/*#__PURE__*/react.createElement("div",{className:"text-center text-xs sm:text-sm text-gray-600 dark:text-slate-400 mb-5"},t("使用高能所统一认证（IHEP-SSO）登录，无需单独注册账号。","Log in with IHEP unified authentication (SSO). No separate registration needed.")),activeTab==="login"&&/*#__PURE__*/react.createElement("div",{className:"mb-4"},/*#__PURE__*/react.createElement("input",{type:"text",placeholder:t("用户名","Username"),value:loginUsername,onChange:e=>setLoginUsername(e.target.value),className:"w-full py-2 px-3 text-xs sm:text-sm mb-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"}),/*#__PURE__*/react.createElement("input",{type:"password",placeholder:t("密码","Password"),value:loginPassword,onChange:e=>setLoginPassword(e.target.value),className:"w-full py-2 px-3 text-xs sm:text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"})),activeTab==="register"&&ENABLE_REGISTRATION&&/*#__PURE__*/react.createElement("div",{className:"mb-4"},/*#__PURE__*/react.createElement("input",{type:"text",placeholder:t("用户名（至少3个字符，不能是纯数字）","Username (min 3 chars, not all digits)"),value:regUsername,onChange:e=>setRegUsername(e.target.value),className:"w-full py-2 px-3 text-xs sm:text-sm mb-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"}),/*#__PURE__*/react.createElement("input",{type:"password",placeholder:t("密码（至少6个字符）","Password (min 6 chars)"),value:regPassword,onChange:e=>setRegPassword(e.target.value),className:"w-full py-2 px-3 text-xs sm:text-sm mb-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"}),/*#__PURE__*/react.createElement("input",{type:"password",placeholder:t("确认密码","Confirm password"),value:regConfirmPassword,onChange:e=>setRegConfirmPassword(e.target.value),className:"w-full py-2 px-3 text-xs sm:text-sm border border-gray-300 dark:border-slate-600 dark:bg-slate-950 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"})),/*#__PURE__*/react.createElement("div",{className:"mb-5"},/*#__PURE__*/react.createElement("label",{className:"text-xs text-gray-700 dark:text-slate-300 flex items-start cursor-pointer"},/*#__PURE__*/react.createElement("input",{type:"checkbox",checked:agree,onChange:e=>handleAgreeChange(e.target.checked),className:"mr-2 mt-0.5 accent-blue-600"}),/*#__PURE__*/react.createElement("div",null,t("我已阅读并同意","I have read and agree to the"),/*#__PURE__*/react.createElement("a",{href:"#",className:"text-blue-600 dark:text-blue-400 underline ml-1"},t("用户协议","User Agreement")),agree&&/*#__PURE__*/react.createElement("div",{className:"text-xs text-gray-500 dark:text-slate-400 mt-1"},t("协议已保存，下次无需重新勾选","Saved — no need to re-check next time"))))),/*#__PURE__*/react.createElement("button",{type:"submit",disabled:isLoading,className:"w-full py-2.5 sm:py-3 text-sm sm:text-base font-bold text-white border-none rounded-lg flex items-center justify-center transition-all "+(!isLoading?submitBtnColor[activeTab]+" shadow-lg cursor-pointer":"bg-gray-300 dark:bg-slate-700 cursor-not-allowed")},isLoading?/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("span",{className:"mr-2"},loadingLabel[activeTab]),/*#__PURE__*/react.createElement("span",{className:"inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"})):submitLabel[activeTab]),activeTab==="sso"&&/*#__PURE__*/react.createElement("div",{className:"mt-4 text-center"},/*#__PURE__*/react.createElement("a",{href:"https://newlogin.ihep.ac.cn/admin/register",target:"_blank",rel:"noopener noreferrer",className:"inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 no-underline hover:text-blue-600 dark:hover:text-blue-400 transition-colors"},/*#__PURE__*/react.createElement(circle_help/* default */.A,{size:14,className:"flex-shrink-0"}),/*#__PURE__*/react.createElement("span",null,t("没有 IHEP 账号？","No IHEP account?")),/*#__PURE__*/react.createElement("span",{className:"text-blue-600 dark:text-blue-400 font-semibold"},t("立即注册","Register now")))),/*#__PURE__*/react.createElement("div",{className:"text-xs text-gray-400 dark:text-slate-500 mt-5 sm:mt-6 text-center"},"\u4EACICP\u590705002790\u53F7-1 \xA9 \u4E2D\u56FD\u79D1\u5B66\u9662\u9AD8\u80FD\u7269\u7406\u7814\u7A76\u6240",/*#__PURE__*/react.createElement("a",{href:"#",className:"text-blue-600 dark:text-blue-400 ml-2 hover:underline"},t("联系我们","Contact us"))))),showAgreementModal&&/*#__PURE__*/react.createElement("div",{className:"fixed inset-0 z-50 flex items-center justify-center bg-black/50"},/*#__PURE__*/react.createElement("div",{className:"bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 mx-4 w-full max-w-sm"},/*#__PURE__*/react.createElement("h2",{className:"text-base font-semibold text-gray-900 dark:text-white mb-2"},t("请先阅读用户协议","Please read the User Agreement")),/*#__PURE__*/react.createElement("p",{className:"text-sm text-gray-600 dark:text-slate-300 mb-5"},t("使用本平台前，请阅读并同意用户协议及隐私政策。","Please read and agree to the User Agreement and Privacy Policy before using this platform.")),/*#__PURE__*/react.createElement("div",{className:"flex gap-3"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:handleAgreeAndProceed,className:"flex-1 py-2 text-sm font-semibold text-white rounded-lg transition-all "+submitBtnColor[activeTab]},t("同意并继续","Agree & Continue")),/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>setShowAgreementModal(false),className:"flex-1 py-2 text-sm font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-all"},t("取消","Cancel"))))));};/* harmony default export */ var auth_LoginPage = (LoginPage);
;// ./src/pages/login.tsx


/***/ }),

/***/ 9407:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ createLucideIcon; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/lucide-react/dist/esm/shared/src/utils.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */

const toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();


//# sourceMappingURL=utils.js.map

;// ./node_modules/lucide-react/dist/esm/defaultAttributes.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */

var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};


//# sourceMappingURL=defaultAttributes.js.map

;// ./node_modules/lucide-react/dist/esm/Icon.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */





const Icon = (0,react.forwardRef)(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return (0,react.createElement)(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => (0,react.createElement)(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);


//# sourceMappingURL=Icon.js.map

;// ./node_modules/lucide-react/dist/esm/createLucideIcon.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */





const createLucideIcon = (iconName, iconNode) => {
  const Component = (0,react.forwardRef)(
    ({ className, ...props }, ref) => (0,react.createElement)(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};


//# sourceMappingURL=createLucideIcon.js.map


/***/ }),

/***/ 64997:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ CircleHelp; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CircleHelp = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("CircleHelp", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", key: "1u773s" }],
  ["path", { d: "M12 17h.01", key: "p32p05" }]
]);


//# sourceMappingURL=circle-help.js.map


/***/ })

}]);
//# sourceMappingURL=component---src-pages-login-tsx-7a8a9ba2163346180732.js.map