"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[1577],{

/***/ 45635:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* reexport */ auth_CallbackPage; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./.cache/gatsby-browser-entry.js + 4 modules
var gatsby_browser_entry = __webpack_require__(64810);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
;// ./src/auth/CallbackPage.tsx
// 接收 SSO 回调，保存 token 和 username，跳转主页
const CallbackPage=()=>{const{setUser}=react.useContext(provider/* appContext */.v);const[error,setError]=react.useState(null);react.useEffect(()=>{const params=new URLSearchParams(window.location.search);const token=params.get("token");const username=params.get("username");if(!token||!username){setError("未收到有效的登录凭证");return;}localStorage.setItem("token",token);localStorage.setItem("username",username);localStorage.setItem("user_email",username);localStorage.setItem("user_name",username);localStorage.removeItem("drsai-mode-config");setUser({name:username,email:username,username});(0,gatsby_browser_entry.navigate)("/?menu=current_session&view=chat",{replace:true});},[setUser]);if(error){return/*#__PURE__*/react.createElement("div",{className:"min-h-screen flex items-center justify-center bg-gray-50"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement("p",{className:"text-red-500 mb-4"},error),/*#__PURE__*/react.createElement("a",{href:"/login",className:"text-blue-600 underline text-sm"},"\u8FD4\u56DE\u767B\u5F55")));}return/*#__PURE__*/react.createElement("div",{className:"min-h-screen flex items-center justify-center bg-gray-50"},/*#__PURE__*/react.createElement("p",{className:"text-gray-500"},"\u6B63\u5728\u767B\u5F55\uFF0C\u8BF7\u7A0D\u5019..."));};/* harmony default export */ var auth_CallbackPage = (CallbackPage);
;// ./src/pages/auth.tsx


/***/ })

}]);
//# sourceMappingURL=component---src-pages-auth-tsx-9d2da465d8c6ab64f6a6.js.map