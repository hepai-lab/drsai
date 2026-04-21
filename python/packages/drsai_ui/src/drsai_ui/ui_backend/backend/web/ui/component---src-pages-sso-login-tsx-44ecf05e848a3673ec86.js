"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[2300],{

/***/ 46592:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ sso_login; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./src/components/SSOLogin.tsx
const backgroundStyle={minHeight:"100vh",display:"flex",justifyContent:"center",alignItems:"center",margin:0,background:"linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)),\n    url('https://images.unsplash.com/photo-1497864149936-d3163f0c0f4b?ixlib=rb-1.2.1&auto=format&fit=crop&w=1950&q=80')",backgroundSize:"cover",backgroundPosition:"center",fontFamily:"Arial, sans-serif",position:"relative"};const logoContainerStyle={position:"fixed",top:20,left:20,zIndex:1000,color:"white",fontSize:16,lineHeight:1.2};const containerStyle={textAlign:"center",padding:"2rem",background:"rgba(255,255,255,0.1)",borderRadius:15,backdropFilter:"blur(10px)",boxShadow:"0 8px 32px 0 rgba(31, 38, 135, 0.37)"};const h1Style={color:"#fff",fontSize:"2.5rem",marginBottom:"1.5rem",textShadow:"2px 2px 4px rgba(0,0,0,0.5)"};const h2Style={color:"#fff",fontSize:"1.5rem",marginBottom:"1.5rem",textShadow:"2px 2px 4px rgba(0,0,0,0.5)"};const buttonStyle={padding:"15px 30px",fontSize:"1.1rem",background:"rgba(255,255,255,0.1)",color:"#fff",border:"none",borderRadius:25,cursor:"pointer",transition:"all 0.3s ease",backdropFilter:"blur(5px)",boxShadow:"0 4px 15px rgba(0,0,0,0.2)"};const buttonHoverStyle={background:"rgba(255,255,255,0.2)",transform:"translateY(-2px)",boxShadow:"0 6px 20px rgba(0,0,0,0.3)"};const modalOverlayStyle={position:"fixed",top:0,left:0,width:"100vw",height:"100vh",background:"rgba(0,0,0,0.4)",display:"flex",justifyContent:"center",alignItems:"center",zIndex:2000};const modalStyle={background:"#fff",borderRadius:10,padding:"2rem",minWidth:320,boxShadow:"0 8px 32px 0 rgba(31, 38, 135, 0.37)",position:"relative",textAlign:"center"};const closeBtnStyle={position:"absolute",top:10,right:15,background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#888"};const SSOLogin=()=>{const[hover,setHover]=react.useState(false);const[showModal,setShowModal]=react.useState(false);const[username,setUsername]=react.useState("");const[password,setPassword]=react.useState("");const[loginError,setLoginError]=react.useState("");// 路由保护由 RouteGuard 组件统一处理
// 如果已经登录，RouteGuard 会自动重定向到主页
const handleLogin=()=>{window.location.href="/umt/login";};const handleLocalLogin=e=>{e.preventDefault();// TODO: 替换为实际本地登录逻辑
if(username===""||password===""){setLoginError("请输入账号和密码");}else{setLoginError("");// 跳转到 /auth?username=xxx
window.location.href="/auth?username="+encodeURIComponent(username)+"&token=local";setShowModal(false);}};return/*#__PURE__*/react.createElement("div",{style:backgroundStyle},/*#__PURE__*/react.createElement("div",{style:logoContainerStyle},"IHEP\u8BA1\u7B97\u4E2D\u5FC3"),/*#__PURE__*/react.createElement("div",{style:containerStyle},/*#__PURE__*/react.createElement("h2",{style:h2Style},"\u6B22\u8FCE\u63A2\u7D22 Dr. Sai \u667A\u80FD\u4F53"),/*#__PURE__*/react.createElement("button",{style:hover?Object.assign({},buttonStyle,buttonHoverStyle):buttonStyle,onMouseEnter:()=>setHover(true),onMouseLeave:()=>setHover(false),onClick:handleLogin},"\u4F7F\u7528\u9AD8\u80FD\u6240\u7EDF\u4E00\u8BA4\u8BC1\uFF08IHEP-SSO\uFF09\u767B\u5F55")),showModal&&/*#__PURE__*/react.createElement("div",{style:modalOverlayStyle,onClick:()=>setShowModal(false)},/*#__PURE__*/react.createElement("div",{style:modalStyle,onClick:e=>e.stopPropagation()},/*#__PURE__*/react.createElement("button",{style:closeBtnStyle,onClick:()=>setShowModal(false),title:"\u5173\u95ED"},"\xD7"),/*#__PURE__*/react.createElement("h3",{style:{marginBottom:20}},"\u672C\u5730\u7528\u6237\u767B\u5F55"),/*#__PURE__*/react.createElement("form",{onSubmit:handleLocalLogin},/*#__PURE__*/react.createElement("div",{style:{marginBottom:15}},/*#__PURE__*/react.createElement("input",{type:"text",placeholder:"\u8D26\u53F7",value:username,onChange:e=>setUsername(e.target.value),style:{width:"90%",padding:"8px",borderRadius:5,border:"1px solid #ccc",fontSize:16},autoFocus:true})),/*#__PURE__*/react.createElement("div",{style:{marginBottom:15}},/*#__PURE__*/react.createElement("input",{type:"password",placeholder:"\u5BC6\u7801",value:password,onChange:e=>setPassword(e.target.value),style:{width:"90%",padding:"8px",borderRadius:5,border:"1px solid #ccc",fontSize:16}})),loginError&&/*#__PURE__*/react.createElement("div",{style:{color:"red",marginBottom:10}},loginError),/*#__PURE__*/react.createElement("button",{type:"submit",style:Object.assign({},buttonStyle,{color:"#333",background:"#f0f0f0",boxShadow:"none",marginTop:5})},"\u767B\u5F55")))));};/* harmony default export */ var components_SSOLogin = (SSOLogin);
;// ./src/pages/sso-login.tsx

/* harmony default export */ var sso_login = (components_SSOLogin);

/***/ })

}]);
//# sourceMappingURL=component---src-pages-sso-login-tsx-44ecf05e848a3673ec86.js.map