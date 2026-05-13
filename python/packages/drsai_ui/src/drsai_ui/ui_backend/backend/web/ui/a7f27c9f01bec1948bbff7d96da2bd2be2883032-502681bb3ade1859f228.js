(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[7165],{

/***/ 43044:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   B: function() { return /* binding */ useAgentInfo; }
/* harmony export */ });
/* harmony import */ var core_js_modules_es_promise_finally_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9391);
/* harmony import */ var core_js_modules_es_promise_finally_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(core_js_modules_es_promise_finally_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(96540);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(48458);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(69036);
/* harmony import */ var _store_modeConfig__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(41025);
/* harmony import */ var _components_views_api__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(39614);
/* harmony import */ var _components_utils__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(70870);
/* harmony import */ var _utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(12708);
const pendingAgentInfoRequests=new Map();const shownOfflineModalAgentKeys=new Set();function resolveUserId(explicit){if(explicit)return explicit;const fromStorage=(0,_components_utils__WEBPACK_IMPORTED_MODULE_4__/* .getLocalStorage */ .Lg)('user_email',false);return fromStorage||undefined;}/** Match backend/session shapes that use `id` or `agent_id`. */function resolveAgentRecordId(agent){var _agent_id;if(!agent)return null;const raw=(_agent_id=agent.agent_id)!==null&&_agent_id!==void 0?_agent_id:agent.id;return raw!=null&&raw!==''?String(raw):null;}/**
 * 全局 agent_info：用 getUserAgentById 拉取 UserAgents 详情。
 * userId 未传入时从 localStorage user_email 读取，避免 Provider 尚未恢复 user 时首屏永远不请求。
 */const useAgentInfo=userIdProp=>{const{agentId,agentInfo,setAgentId,setAgentInfo,setAgentOfflineSnapshot}=(0,_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q)();const userId=resolveUserId(userIdProp);(0,react__WEBPACK_IMPORTED_MODULE_1__.useEffect)(()=>{if(!userId){return;}let cancelled=false;const run=async()=>{let id=agentId!==null&&agentId!==void 0?agentId:undefined;if(!id){const sa=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;if(sa!==null&&sa!==void 0&&sa.id){setAgentId(String(sa.id));return;}}if(!id){const sa=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;try{var _userDefault$stored_d;const[agents,myOrg,userDefault]=await Promise.all([// Use UserAgents list for consistency with getUserAgentById
_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentWorkerAPI */ .Ml.getUserDefaultAgents(userId).then(r=>(r===null||r===void 0?void 0:r.data)||[]),_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .organizationsAPI */ .PB.getMyOrg(userId).catch(()=>null),_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentWorkerAPI */ .Ml.getUserDefaultAgent(userId).catch(()=>null)]);if(cancelled)return;const orgDefault=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;// Use stored_default_agent_id so "not set" doesn't degrade into a forced builtin.
const userDefaultId=(_userDefault$stored_d=userDefault===null||userDefault===void 0?void 0:userDefault.stored_default_agent_id)!==null&&_userDefault$stored_d!==void 0?_userDefault$stored_d:null;const match=(sa===null||sa===void 0?void 0:sa.id)&&(agents===null||agents===void 0?void 0:agents.find(a=>a.id===sa.id))||(sa===null||sa===void 0?void 0:sa.name)&&(agents===null||agents===void 0?void 0:agents.find(a=>a.name===sa.name||Boolean(sa.mode)&&a.mode===sa.mode))||(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__/* .pickLoginDefaultAgent */ .T)(agents||[],orgDefault,userDefaultId)||(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__/* .pickPreferredAgentFromList */ .W)(agents||[]);if(match!==null&&match!==void 0&&match.id){setAgentId(match.id);return;}}catch(_unused){// ignore
}const sa2=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;if(sa2!==null&&sa2!==void 0&&sa2.name){setAgentInfo(sa2);}else{setAgentInfo(null);}setAgentOfflineSnapshot(false);return;}if(cancelled)return;const requestKey=userId+":"+id;setAgentOfflineSnapshot(false);try{let pendingRequest=pendingAgentInfoRequests.get(requestKey);if(!pendingRequest){pendingRequest=_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentWorkerAPI */ .Ml.getUserAgentById(userId,id).finally(()=>{pendingAgentInfoRequests.delete(requestKey);});pendingAgentInfoRequests.set(requestKey,pendingRequest);}const agentData=await pendingRequest;if(!cancelled){setAgentInfo(agentData);setAgentOfflineSnapshot(false);}}catch(error){console.error('Failed to fetch agent info:',error);const errorMessage=error instanceof Error?error.message:String(error);const isOfflineAgentError=errorMessage.includes('该智能体已经下线或更新');if(isOfflineAgentError){const sa=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;// Opening a historical session restores agent snapshot into selectedAgent; UserAgents
// may no longer list that id — keep the snapshot so chat/history stays usable.
if(resolveAgentRecordId(sa)===String(id)){setAgentInfo(sa);setAgentOfflineSnapshot(true);return;}if(!shownOfflineModalAgentKeys.has(requestKey)){shownOfflineModalAgentKeys.add(requestKey);antd__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A.confirm({title:'智能体不可用',content:errorMessage,okText:'删除',closable:false,maskClosable:false,keyboard:false,cancelButtonProps:{style:{display:'none'}},onOk:async()=>{await _components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentAPI */ .cM.deleteMainAgent(userId,id);setAgentId(null);setAgentInfo(null);setAgentOfflineSnapshot(false);window.dispatchEvent(new CustomEvent('agentListChanged'));window.dispatchEvent(new CustomEvent('switchToCurrentSession',{detail:{clearSession:true}}));antd__WEBPACK_IMPORTED_MODULE_7__/* ["default"] */ .Ay.success('已删除不可用智能体');}});setAgentOfflineSnapshot(false);setAgentInfo(null);return;}// Modal already shown for this agent id; fall through to list/default fallback.
}try{var _userDefault$stored_d2;const[agents,myOrg,userDefault]=await Promise.all([_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentWorkerAPI */ .Ml.getUserDefaultAgents(userId).then(r=>(r===null||r===void 0?void 0:r.data)||[]),_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .organizationsAPI */ .PB.getMyOrg(userId).catch(()=>null),_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentWorkerAPI */ .Ml.getUserDefaultAgent(userId).catch(()=>null)]);const byId=agents===null||agents===void 0?void 0:agents.find(a=>a.id===id);if(byId){setAgentOfflineSnapshot(false);setAgentInfo(byId);return;}const orgDefault=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;const userDefaultId=(_userDefault$stored_d2=userDefault===null||userDefault===void 0?void 0:userDefault.stored_default_agent_id)!==null&&_userDefault$stored_d2!==void 0?_userDefault$stored_d2:null;const preferred=(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__/* .pickLoginDefaultAgent */ .T)(agents||[],orgDefault,userDefaultId)||(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__/* .pickPreferredAgentFromList */ .W)(agents||[]);if(preferred!==null&&preferred!==void 0&&preferred.id&&typeof preferred.id==='string'&&preferred.id!==id){setAgentOfflineSnapshot(false);setAgentId(preferred.id);return;}if(preferred){setAgentOfflineSnapshot(false);setAgentInfo(preferred);return;}}catch(_unused2){// ignore; fall through
}const fallback=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;if(fallback!==null&&fallback!==void 0&&fallback.name){setAgentOfflineSnapshot(false);setAgentInfo(fallback);}else{setAgentOfflineSnapshot(false);setAgentInfo(null);}}};void run();return()=>{cancelled=true;};},[agentId,userId,setAgentId,setAgentInfo,setAgentOfflineSnapshot]);return{agentId,agentInfo};};

/***/ }),

/***/ 75625:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  J: function() { return /* binding */ useConfigStore; }
});

// EXTERNAL MODULE: ./node_modules/zustand/esm/react.mjs + 1 modules
var react = __webpack_require__(71511);
// EXTERNAL MODULE: ./node_modules/zustand/esm/middleware.mjs
var middleware = __webpack_require__(87134);
;// ./node_modules/uuid/dist/esm-browser/rng.js
// Unique ID creation requires a high quality random # generator. In the browser we therefore
// require the crypto API and do not support built-in fallback to lower quality random number
// generators (like Math.random()).
var getRandomValues;
var rnds8 = new Uint8Array(16);
function rng() {
  // lazy load so that environments that need to polyfill have a chance to do so
  if (!getRandomValues) {
    // getRandomValues needs to be invoked in a context where "this" is a Crypto implementation. Also,
    // find the complete implementation of crypto (msCrypto) on IE11.
    getRandomValues = typeof crypto !== 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto) || typeof msCrypto !== 'undefined' && typeof msCrypto.getRandomValues === 'function' && msCrypto.getRandomValues.bind(msCrypto);

    if (!getRandomValues) {
      throw new Error('crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported');
    }
  }

  return getRandomValues(rnds8);
}
;// ./node_modules/uuid/dist/esm-browser/regex.js
/* harmony default export */ var regex = (/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i);
;// ./node_modules/uuid/dist/esm-browser/validate.js


function validate(uuid) {
  return typeof uuid === 'string' && regex.test(uuid);
}

/* harmony default export */ var esm_browser_validate = (validate);
;// ./node_modules/uuid/dist/esm-browser/stringify.js

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */

var byteToHex = [];

for (var i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).substr(1));
}

function stringify(arr) {
  var offset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  var uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase(); // Consistency check for valid UUID.  If this throws, it's likely due to one
  // of the following:
  // - One or more input array values don't map to a hex octet (leading to
  // "undefined" in the uuid)
  // - Invalid input values for the RFC `version` or `variant` fields

  if (!esm_browser_validate(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }

  return uuid;
}

/* harmony default export */ var esm_browser_stringify = (stringify);
;// ./node_modules/uuid/dist/esm-browser/v4.js



function v4(options, buf, offset) {
  options = options || {};
  var rnds = options.random || (options.rng || rng)(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  if (buf) {
    offset = offset || 0;

    for (var i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }

    return buf;
  }

  return esm_browser_stringify(rnds);
}

/* harmony default export */ var esm_browser_v4 = (v4);
;// ./src/hooks/store.tsx
// New interfaces
// Default settings
const DEFAULT_AGENT_FLOW_SETTINGS={direction:"TB",showLabels:true,showGrid:true,showTokens:true,showMessages:true,showMiniMap:false};const useConfigStore=(0,react/* create */.v)()((0,middleware/* persist */.Zr)(set=>({// Existing state
messages:[],setMessages:messages=>set({messages}),session:null,setSession:session=>set({session}),sessions:[],setSessions:sessions=>set({sessions:Array.isArray(sessions)?sessions:[]}),version:null,setVersion:version=>set({version}),connectionId:esm_browser_v4(),// Header state
header:{title:"",breadcrumbs:[]},setHeader:newHeader=>set(state=>({header:Object.assign({},state.header,newHeader)})),setBreadcrumbs:breadcrumbs=>set(state=>({header:Object.assign({},state.header,{breadcrumbs})})),// Add AgentFlow settings
agentFlow:DEFAULT_AGENT_FLOW_SETTINGS,setAgentFlowSettings:newSettings=>set(state=>({agentFlow:Object.assign({},state.agentFlow,newSettings)})),// Sidebar state and actions
sidebar:{isExpanded:true,isPinned:false},setSidebarState:newState=>set(state=>({sidebar:Object.assign({},state.sidebar,newState)})),collapseSidebar:()=>set(state=>({sidebar:Object.assign({},state.sidebar,{isExpanded:false})})),expandSidebar:()=>set(state=>({sidebar:Object.assign({},state.sidebar,{isExpanded:true})})),toggleSidebar:()=>set(state=>({sidebar:Object.assign({},state.sidebar,{isExpanded:!state.sidebar.isExpanded})}))}),{name:"app-sidebar-state",storage:(0,middleware/* createJSONStorage */.KU)(()=>localStorage),partialize:state=>({sidebar:state.sidebar,agentFlow:state.agentFlow,session:state.session})}));

/***/ }),

/***/ 71127:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ chatinput; }
});

// EXTERNAL MODULE: ./node_modules/core-js/modules/es.promise.finally.js
var es_promise_finally = __webpack_require__(9391);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/@heroicons/react/24/outline/esm/XMarkIcon.js

function XMarkIcon({
  title,
  titleId,
  ...props
}, svgRef) {
  return /*#__PURE__*/react.createElement("svg", Object.assign({
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.5,
    stroke: "currentColor",
    "aria-hidden": "true",
    "data-slot": "icon",
    ref: svgRef,
    "aria-labelledby": titleId
  }, props), title ? /*#__PURE__*/react.createElement("title", {
    id: titleId
  }, title) : null, /*#__PURE__*/react.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    d: "M6 18 18 6M6 6l12 12"
  }));
}
const ForwardRef = /*#__PURE__*/ react.forwardRef(XMarkIcon);
/* harmony default export */ var esm_XMarkIcon = (ForwardRef);
;// ./node_modules/@heroicons/react/24/outline/esm/PauseCircleIcon.js

function PauseCircleIcon({
  title,
  titleId,
  ...props
}, svgRef) {
  return /*#__PURE__*/react.createElement("svg", Object.assign({
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.5,
    stroke: "currentColor",
    "aria-hidden": "true",
    "data-slot": "icon",
    ref: svgRef,
    "aria-labelledby": titleId
  }, props), title ? /*#__PURE__*/react.createElement("title", {
    id: titleId
  }, title) : null, /*#__PURE__*/react.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    d: "M14.25 9v6m-4.5 0V9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
  }));
}
const PauseCircleIcon_ForwardRef = /*#__PURE__*/ react.forwardRef(PauseCircleIcon);
/* harmony default export */ var esm_PauseCircleIcon = (PauseCircleIcon_ForwardRef);
;// ./node_modules/@heroicons/react/24/outline/esm/PaperAirplaneIcon.js

function PaperAirplaneIcon({
  title,
  titleId,
  ...props
}, svgRef) {
  return /*#__PURE__*/react.createElement("svg", Object.assign({
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.5,
    stroke: "currentColor",
    "aria-hidden": "true",
    "data-slot": "icon",
    ref: svgRef,
    "aria-labelledby": titleId
  }, props), title ? /*#__PURE__*/react.createElement("title", {
    id: titleId
  }, title) : null, /*#__PURE__*/react.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    d: "M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
  }));
}
const PaperAirplaneIcon_ForwardRef = /*#__PURE__*/ react.forwardRef(PaperAirplaneIcon);
/* harmony default export */ var esm_PaperAirplaneIcon = (PaperAirplaneIcon_ForwardRef);
;// ./node_modules/@heroicons/react/24/outline/esm/ExclamationTriangleIcon.js

function ExclamationTriangleIcon({
  title,
  titleId,
  ...props
}, svgRef) {
  return /*#__PURE__*/react.createElement("svg", Object.assign({
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.5,
    stroke: "currentColor",
    "aria-hidden": "true",
    "data-slot": "icon",
    ref: svgRef,
    "aria-labelledby": titleId
  }, props), title ? /*#__PURE__*/react.createElement("title", {
    id: titleId
  }, title) : null, /*#__PURE__*/react.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    d: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
  }));
}
const ExclamationTriangleIcon_ForwardRef = /*#__PURE__*/ react.forwardRef(ExclamationTriangleIcon);
/* harmony default export */ var esm_ExclamationTriangleIcon = (ExclamationTriangleIcon_ForwardRef);
// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/antd/es/modal/index.js + 27 modules
var modal = __webpack_require__(48458);
// EXTERNAL MODULE: ./node_modules/antd/es/input/index.js + 22 modules
var input = __webpack_require__(46789);
// EXTERNAL MODULE: ./node_modules/antd/es/spin/index.js + 6 modules
var spin = __webpack_require__(34716);
// EXTERNAL MODULE: ./node_modules/antd/es/checkbox/index.js + 3 modules
var es_checkbox = __webpack_require__(91196);
// EXTERNAL MODULE: ./node_modules/antd/es/dropdown/index.js + 5 modules
var dropdown = __webpack_require__(30761);
// EXTERNAL MODULE: ./node_modules/antd/es/menu/index.js + 11 modules
var menu = __webpack_require__(25226);
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var tooltip = __webpack_require__(40367);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/wrench.js
var wrench = __webpack_require__(46816);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/paperclip.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Paperclip = (0,createLucideIcon/* default */.A)("Paperclip", [
  [
    "path",
    {
      d: "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
      key: "1u3ebp"
    }
  ]
]);


//# sourceMappingURL=paperclip.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/bot.js
var bot = __webpack_require__(42640);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/plus.js
var plus = __webpack_require__(80697);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./src/pages/chat/plan.tsx + 3 modules
var plan = __webpack_require__(75860);
// EXTERNAL MODULE: ./src/pages/chat/relevant_plans.tsx + 4 modules
var relevant_plans = __webpack_require__(66736);
// EXTERNAL MODULE: ./node_modules/core-js/modules/es.array.sort.js
var es_array_sort = __webpack_require__(26910);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/rc-util/es/React/render.js
var render = __webpack_require__(14832);
// EXTERNAL MODULE: ./node_modules/antd/es/app/context.js
var context = __webpack_require__(41240);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var config_provider_context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/index.js + 8 modules
var config_provider = __webpack_require__(20867);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CheckCircleFilled.js + 1 modules
var CheckCircleFilled = __webpack_require__(38811);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CloseCircleFilled.js + 1 modules
var CloseCircleFilled = __webpack_require__(36029);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CloseOutlined.js + 1 modules
var CloseOutlined = __webpack_require__(47852);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/ExclamationCircleFilled.js + 1 modules
var ExclamationCircleFilled = __webpack_require__(7541);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/InfoCircleFilled.js + 1 modules
var InfoCircleFilled = __webpack_require__(17850);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/LoadingOutlined.js + 1 modules
var LoadingOutlined = __webpack_require__(93567);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-notification/es/index.js + 6 modules
var es = __webpack_require__(22370);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/hooks/useZIndex.js
var useZIndex = __webpack_require__(60275);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
;// ./node_modules/antd/es/notification/style/placement.js

const genNotificationPlacementStyle = token => {
  const {
    componentCls,
    notificationMarginEdge,
    animationMaxHeight
  } = token;
  const noticeCls = `${componentCls}-notice`;
  const rightFadeIn = new cssinjs_es/* Keyframes */.Mo('antNotificationFadeIn', {
    '0%': {
      transform: `translate3d(100%, 0, 0)`,
      opacity: 0
    },
    '100%': {
      transform: `translate3d(0, 0, 0)`,
      opacity: 1
    }
  });
  const topFadeIn = new cssinjs_es/* Keyframes */.Mo('antNotificationTopFadeIn', {
    '0%': {
      top: -animationMaxHeight,
      opacity: 0
    },
    '100%': {
      top: 0,
      opacity: 1
    }
  });
  const bottomFadeIn = new cssinjs_es/* Keyframes */.Mo('antNotificationBottomFadeIn', {
    '0%': {
      bottom: token.calc(animationMaxHeight).mul(-1).equal(),
      opacity: 0
    },
    '100%': {
      bottom: 0,
      opacity: 1
    }
  });
  const leftFadeIn = new cssinjs_es/* Keyframes */.Mo('antNotificationLeftFadeIn', {
    '0%': {
      transform: `translate3d(-100%, 0, 0)`,
      opacity: 0
    },
    '100%': {
      transform: `translate3d(0, 0, 0)`,
      opacity: 1
    }
  });
  return {
    [componentCls]: {
      [`&${componentCls}-top, &${componentCls}-bottom`]: {
        marginInline: 0,
        [noticeCls]: {
          marginInline: 'auto auto'
        }
      },
      [`&${componentCls}-top`]: {
        [`${componentCls}-fade-enter${componentCls}-fade-enter-active, ${componentCls}-fade-appear${componentCls}-fade-appear-active`]: {
          animationName: topFadeIn
        }
      },
      [`&${componentCls}-bottom`]: {
        [`${componentCls}-fade-enter${componentCls}-fade-enter-active, ${componentCls}-fade-appear${componentCls}-fade-appear-active`]: {
          animationName: bottomFadeIn
        }
      },
      [`&${componentCls}-topRight, &${componentCls}-bottomRight`]: {
        [`${componentCls}-fade-enter${componentCls}-fade-enter-active, ${componentCls}-fade-appear${componentCls}-fade-appear-active`]: {
          animationName: rightFadeIn
        }
      },
      [`&${componentCls}-topLeft, &${componentCls}-bottomLeft`]: {
        marginRight: {
          value: 0,
          _skip_check_: true
        },
        marginLeft: {
          value: notificationMarginEdge,
          _skip_check_: true
        },
        [noticeCls]: {
          marginInlineEnd: 'auto',
          marginInlineStart: 0
        },
        [`${componentCls}-fade-enter${componentCls}-fade-enter-active, ${componentCls}-fade-appear${componentCls}-fade-appear-active`]: {
          animationName: leftFadeIn
        }
      }
    }
  };
};
/* harmony default export */ var placement = (genNotificationPlacementStyle);
;// ./node_modules/antd/es/notification/interface.js
const NotificationPlacements = ['top', 'topLeft', 'topRight', 'bottom', 'bottomLeft', 'bottomRight'];
;// ./node_modules/antd/es/notification/style/stack.js

const placementAlignProperty = {
  topLeft: 'left',
  topRight: 'right',
  bottomLeft: 'left',
  bottomRight: 'right',
  top: 'left',
  bottom: 'left'
};
const genPlacementStackStyle = (token, placement) => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}-${placement}`]: {
      [`&${componentCls}-stack > ${componentCls}-notice-wrapper`]: {
        [placement.startsWith('top') ? 'top' : 'bottom']: 0,
        [placementAlignProperty[placement]]: {
          value: 0,
          _skip_check_: true
        }
      }
    }
  };
};
const genStackChildrenStyle = token => {
  const childrenStyle = {};
  for (let i = 1; i < token.notificationStackLayer; i++) {
    childrenStyle[`&:nth-last-child(${i + 1})`] = {
      overflow: 'hidden',
      [`& > ${token.componentCls}-notice`]: {
        opacity: 0,
        transition: `opacity ${token.motionDurationMid}`
      }
    };
  }
  return Object.assign({
    [`&:not(:nth-last-child(-n+${token.notificationStackLayer}))`]: {
      opacity: 0,
      overflow: 'hidden',
      color: 'transparent',
      pointerEvents: 'none'
    }
  }, childrenStyle);
};
const genStackedNoticeStyle = token => {
  const childrenStyle = {};
  for (let i = 1; i < token.notificationStackLayer; i++) {
    childrenStyle[`&:nth-last-child(${i + 1})`] = {
      background: token.colorBgBlur,
      backdropFilter: 'blur(10px)',
      '-webkit-backdrop-filter': 'blur(10px)'
    };
  }
  return Object.assign({}, childrenStyle);
};
const genStackStyle = token => {
  const {
    componentCls
  } = token;
  return Object.assign({
    [`${componentCls}-stack`]: {
      [`& > ${componentCls}-notice-wrapper`]: Object.assign({
        transition: `all ${token.motionDurationSlow}, backdrop-filter 0s`,
        position: 'absolute'
      }, genStackChildrenStyle(token))
    },
    [`${componentCls}-stack:not(${componentCls}-stack-expanded)`]: {
      [`& > ${componentCls}-notice-wrapper`]: Object.assign({}, genStackedNoticeStyle(token))
    },
    [`${componentCls}-stack${componentCls}-stack-expanded`]: {
      [`& > ${componentCls}-notice-wrapper`]: {
        '&:not(:nth-last-child(-n + 1))': {
          opacity: 1,
          overflow: 'unset',
          color: 'inherit',
          pointerEvents: 'auto',
          [`& > ${token.componentCls}-notice`]: {
            opacity: 1
          }
        },
        '&:after': {
          content: '""',
          position: 'absolute',
          height: token.margin,
          width: '100%',
          insetInline: 0,
          bottom: token.calc(token.margin).mul(-1).equal(),
          background: 'transparent',
          pointerEvents: 'auto'
        }
      }
    }
  }, NotificationPlacements.map(placement => genPlacementStackStyle(token, placement)).reduce((acc, cur) => Object.assign(Object.assign({}, acc), cur), {}));
};
/* harmony default export */ var stack = (genStackStyle);
;// ./node_modules/antd/es/notification/style/index.js






const genNoticeStyle = token => {
  const {
    iconCls,
    componentCls,
    // .ant-notification
    boxShadow,
    fontSizeLG,
    notificationMarginBottom,
    borderRadiusLG,
    colorSuccess,
    colorInfo,
    colorWarning,
    colorError,
    colorTextHeading,
    notificationBg,
    notificationPadding,
    notificationMarginEdge,
    notificationProgressBg,
    notificationProgressHeight,
    fontSize,
    lineHeight,
    width,
    notificationIconSize,
    colorText
  } = token;
  const noticeCls = `${componentCls}-notice`;
  return {
    position: 'relative',
    marginBottom: notificationMarginBottom,
    marginInlineStart: 'auto',
    background: notificationBg,
    borderRadius: borderRadiusLG,
    boxShadow,
    [noticeCls]: {
      padding: notificationPadding,
      width,
      maxWidth: `calc(100vw - ${(0,cssinjs_es/* unit */.zA)(token.calc(notificationMarginEdge).mul(2).equal())})`,
      overflow: 'hidden',
      lineHeight,
      wordWrap: 'break-word'
    },
    [`${noticeCls}-message`]: {
      marginBottom: token.marginXS,
      color: colorTextHeading,
      fontSize: fontSizeLG,
      lineHeight: token.lineHeightLG
    },
    [`${noticeCls}-description`]: {
      fontSize,
      color: colorText
    },
    [`${noticeCls}-closable ${noticeCls}-message`]: {
      paddingInlineEnd: token.paddingLG
    },
    [`${noticeCls}-with-icon ${noticeCls}-message`]: {
      marginBottom: token.marginXS,
      marginInlineStart: token.calc(token.marginSM).add(notificationIconSize).equal(),
      fontSize: fontSizeLG
    },
    [`${noticeCls}-with-icon ${noticeCls}-description`]: {
      marginInlineStart: token.calc(token.marginSM).add(notificationIconSize).equal(),
      fontSize
    },
    // Icon & color style in different selector level
    // https://github.com/ant-design/ant-design/issues/16503
    // https://github.com/ant-design/ant-design/issues/15512
    [`${noticeCls}-icon`]: {
      position: 'absolute',
      fontSize: notificationIconSize,
      lineHeight: 1,
      // icon-font
      [`&-success${iconCls}`]: {
        color: colorSuccess
      },
      [`&-info${iconCls}`]: {
        color: colorInfo
      },
      [`&-warning${iconCls}`]: {
        color: colorWarning
      },
      [`&-error${iconCls}`]: {
        color: colorError
      }
    },
    [`${noticeCls}-close`]: Object.assign({
      position: 'absolute',
      top: token.notificationPaddingVertical,
      insetInlineEnd: token.notificationPaddingHorizontal,
      color: token.colorIcon,
      outline: 'none',
      width: token.notificationCloseButtonSize,
      height: token.notificationCloseButtonSize,
      borderRadius: token.borderRadiusSM,
      transition: `background-color ${token.motionDurationMid}, color ${token.motionDurationMid}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      '&:hover': {
        color: token.colorIconHover,
        backgroundColor: token.colorBgTextHover
      },
      '&:active': {
        backgroundColor: token.colorBgTextActive
      }
    }, (0,style/* genFocusStyle */.K8)(token)),
    [`${noticeCls}-progress`]: {
      position: 'absolute',
      display: 'block',
      appearance: 'none',
      WebkitAppearance: 'none',
      inlineSize: `calc(100% - ${(0,cssinjs_es/* unit */.zA)(borderRadiusLG)} * 2)`,
      left: {
        _skip_check_: true,
        value: borderRadiusLG
      },
      right: {
        _skip_check_: true,
        value: borderRadiusLG
      },
      bottom: 0,
      blockSize: notificationProgressHeight,
      border: 0,
      '&, &::-webkit-progress-bar': {
        borderRadius: borderRadiusLG,
        backgroundColor: `rgba(0, 0, 0, 0.04)`
      },
      '&::-moz-progress-bar': {
        background: notificationProgressBg
      },
      '&::-webkit-progress-value': {
        borderRadius: borderRadiusLG,
        background: notificationProgressBg
      }
    },
    [`${noticeCls}-btn`]: {
      float: 'right',
      marginTop: token.marginSM
    }
  };
};
const genNotificationStyle = token => {
  const {
    componentCls,
    // .ant-notification
    notificationMarginBottom,
    notificationMarginEdge,
    motionDurationMid,
    motionEaseInOut
  } = token;
  const noticeCls = `${componentCls}-notice`;
  const fadeOut = new cssinjs_es/* Keyframes */.Mo('antNotificationFadeOut', {
    '0%': {
      maxHeight: token.animationMaxHeight,
      marginBottom: notificationMarginBottom
    },
    '100%': {
      maxHeight: 0,
      marginBottom: 0,
      paddingTop: 0,
      paddingBottom: 0,
      opacity: 0
    }
  });
  return [
  // ============================ Holder ============================
  {
    [componentCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      position: 'fixed',
      zIndex: token.zIndexPopup,
      marginRight: {
        value: notificationMarginEdge,
        _skip_check_: true
      },
      [`${componentCls}-hook-holder`]: {
        position: 'relative'
      },
      //  animation
      [`${componentCls}-fade-appear-prepare`]: {
        opacity: '0 !important'
      },
      [`${componentCls}-fade-enter, ${componentCls}-fade-appear`]: {
        animationDuration: token.motionDurationMid,
        animationTimingFunction: motionEaseInOut,
        animationFillMode: 'both',
        opacity: 0,
        animationPlayState: 'paused'
      },
      [`${componentCls}-fade-leave`]: {
        animationTimingFunction: motionEaseInOut,
        animationFillMode: 'both',
        animationDuration: motionDurationMid,
        animationPlayState: 'paused'
      },
      [`${componentCls}-fade-enter${componentCls}-fade-enter-active, ${componentCls}-fade-appear${componentCls}-fade-appear-active`]: {
        animationPlayState: 'running'
      },
      [`${componentCls}-fade-leave${componentCls}-fade-leave-active`]: {
        animationName: fadeOut,
        animationPlayState: 'running'
      },
      // RTL
      '&-rtl': {
        direction: 'rtl',
        [`${noticeCls}-btn`]: {
          float: 'left'
        }
      }
    })
  },
  // ============================ Notice ============================
  {
    [componentCls]: {
      [`${noticeCls}-wrapper`]: Object.assign({}, genNoticeStyle(token))
    }
  }];
};
// ============================== Export ==============================
const prepareComponentToken = token => ({
  zIndexPopup: token.zIndexPopupBase + useZIndex/* CONTAINER_MAX_OFFSET */.jH + 50,
  width: 384
});
const prepareNotificationToken = token => {
  const notificationPaddingVertical = token.paddingMD;
  const notificationPaddingHorizontal = token.paddingLG;
  const notificationToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    notificationBg: token.colorBgElevated,
    notificationPaddingVertical,
    notificationPaddingHorizontal,
    notificationIconSize: token.calc(token.fontSizeLG).mul(token.lineHeightLG).equal(),
    notificationCloseButtonSize: token.calc(token.controlHeightLG).mul(0.55).equal(),
    notificationMarginBottom: token.margin,
    notificationPadding: `${(0,cssinjs_es/* unit */.zA)(token.paddingMD)} ${(0,cssinjs_es/* unit */.zA)(token.paddingContentHorizontalLG)}`,
    notificationMarginEdge: token.marginLG,
    animationMaxHeight: 150,
    notificationStackLayer: 3,
    notificationProgressHeight: 2,
    notificationProgressBg: `linear-gradient(90deg, ${token.colorPrimaryBorderHover}, ${token.colorPrimary})`
  });
  return notificationToken;
};
/* harmony default export */ var notification_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Notification', token => {
  const notificationToken = prepareNotificationToken(token);
  return [genNotificationStyle(notificationToken), placement(notificationToken), stack(notificationToken)];
}, prepareComponentToken));
;// ./node_modules/antd/es/notification/style/pure-panel.js



/* harmony default export */ var pure_panel = ((0,genStyleUtils/* genSubStyleComponent */.bf)(['Notification', 'PurePanel'], token => {
  const noticeCls = `${token.componentCls}-notice`;
  const notificationToken = prepareNotificationToken(token);
  return {
    [`${noticeCls}-pure-panel`]: Object.assign(Object.assign({}, genNoticeStyle(notificationToken)), {
      width: notificationToken.width,
      maxWidth: `calc(100vw - ${(0,cssinjs_es/* unit */.zA)(token.calc(notificationToken.notificationMarginEdge).mul(2).equal())})`,
      margin: 0
    })
  };
}, prepareComponentToken));
;// ./node_modules/antd/es/notification/PurePanel.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};













const TypeIcon = {
  info: /*#__PURE__*/react.createElement(InfoCircleFilled/* default */.A, null),
  success: /*#__PURE__*/react.createElement(CheckCircleFilled/* default */.A, null),
  error: /*#__PURE__*/react.createElement(CloseCircleFilled/* default */.A, null),
  warning: /*#__PURE__*/react.createElement(ExclamationCircleFilled/* default */.A, null),
  loading: /*#__PURE__*/react.createElement(LoadingOutlined/* default */.A, null)
};
function getCloseIcon(prefixCls, closeIcon) {
  if (closeIcon === null || closeIcon === false) {
    return null;
  }
  return closeIcon || /*#__PURE__*/react.createElement(CloseOutlined/* default */.A, {
    className: `${prefixCls}-close-icon`
  });
}
const typeToIcon = {
  success: CheckCircleFilled/* default */.A,
  info: InfoCircleFilled/* default */.A,
  error: CloseCircleFilled/* default */.A,
  warning: ExclamationCircleFilled/* default */.A
};
const PureContent = props => {
  const {
    prefixCls,
    icon,
    type,
    message,
    description,
    btn,
    role = 'alert'
  } = props;
  let iconNode = null;
  if (icon) {
    iconNode = /*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-icon`
    }, icon);
  } else if (type) {
    iconNode = /*#__PURE__*/react.createElement(typeToIcon[type] || null, {
      className: classnames_default()(`${prefixCls}-icon`, `${prefixCls}-icon-${type}`)
    });
  }
  return /*#__PURE__*/react.createElement("div", {
    className: classnames_default()({
      [`${prefixCls}-with-icon`]: iconNode
    }),
    role: role
  }, iconNode, /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-message`
  }, message), /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-description`
  }, description), btn && /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-btn`
  }, btn));
};
/** @private Internal Component. Do not use in your production. */
const PurePanel = props => {
  const {
      prefixCls: staticPrefixCls,
      className,
      icon,
      type,
      message,
      description,
      btn,
      closable = true,
      closeIcon,
      className: notificationClassName
    } = props,
    restProps = __rest(props, ["prefixCls", "className", "icon", "type", "message", "description", "btn", "closable", "closeIcon", "className"]);
  const {
    getPrefixCls
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const prefixCls = staticPrefixCls || getPrefixCls('notification');
  const noticePrefixCls = `${prefixCls}-notice`;
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = notification_style(prefixCls, rootCls);
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", {
    className: classnames_default()(`${noticePrefixCls}-pure-panel`, hashId, className, cssVarCls, rootCls)
  }, /*#__PURE__*/react.createElement(pure_panel, {
    prefixCls: prefixCls
  }), /*#__PURE__*/react.createElement(es/* Notice */.$T, Object.assign({}, restProps, {
    prefixCls: prefixCls,
    eventKey: "pure",
    duration: null,
    closable: closable,
    className: classnames_default()({
      notificationClassName
    }),
    closeIcon: getCloseIcon(prefixCls, closeIcon),
    content: /*#__PURE__*/react.createElement(PureContent, {
      prefixCls: noticePrefixCls,
      icon: icon,
      type: type,
      message: message,
      description: description,
      btn: btn
    })
  }))));
};
/* harmony default export */ var notification_PurePanel = (PurePanel);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/warning.js
var _util_warning = __webpack_require__(18877);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/useToken.js + 2 modules
var useToken = __webpack_require__(11320);
;// ./node_modules/antd/es/notification/util.js
function getPlacementStyle(placement, top, bottom) {
  let style;
  switch (placement) {
    case 'top':
      style = {
        left: '50%',
        transform: 'translateX(-50%)',
        right: 'auto',
        top,
        bottom: 'auto'
      };
      break;
    case 'topLeft':
      style = {
        left: 0,
        top,
        bottom: 'auto'
      };
      break;
    case 'topRight':
      style = {
        right: 0,
        top,
        bottom: 'auto'
      };
      break;
    case 'bottom':
      style = {
        left: '50%',
        transform: 'translateX(-50%)',
        right: 'auto',
        top: 'auto',
        bottom
      };
      break;
    case 'bottomLeft':
      style = {
        left: 0,
        top: 'auto',
        bottom
      };
      break;
    default:
      style = {
        right: 0,
        top: 'auto',
        bottom
      };
      break;
  }
  return style;
}
function getMotion(prefixCls) {
  return {
    motionName: `${prefixCls}-fade`
  };
}
;// ./node_modules/antd/es/notification/useNotification.js
"use client";

var useNotification_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};










const DEFAULT_OFFSET = 24;
const DEFAULT_DURATION = 4.5;
const DEFAULT_PLACEMENT = 'topRight';
const Wrapper = _ref => {
  let {
    children,
    prefixCls
  } = _ref;
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = notification_style(prefixCls, rootCls);
  return wrapCSSVar(/*#__PURE__*/react.createElement(es/* NotificationProvider */.ph, {
    classNames: {
      list: classnames_default()(hashId, cssVarCls, rootCls)
    }
  }, children));
};
const renderNotifications = (node, _ref2) => {
  let {
    prefixCls,
    key
  } = _ref2;
  return /*#__PURE__*/react.createElement(Wrapper, {
    prefixCls: prefixCls,
    key: key
  }, node);
};
const Holder = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
    top,
    bottom,
    prefixCls: staticPrefixCls,
    getContainer: staticGetContainer,
    maxCount,
    rtl,
    onAllRemoved,
    stack,
    duration,
    pauseOnHover = true,
    showProgress
  } = props;
  const {
    getPrefixCls,
    getPopupContainer,
    notification,
    direction
  } = (0,react.useContext)(config_provider_context/* ConfigContext */.QO);
  const [, token] = (0,useToken/* default */.Ay)();
  const prefixCls = staticPrefixCls || getPrefixCls('notification');
  // =============================== Style ===============================
  const getStyle = placement => getPlacementStyle(placement, top !== null && top !== void 0 ? top : DEFAULT_OFFSET, bottom !== null && bottom !== void 0 ? bottom : DEFAULT_OFFSET);
  const getClassName = () => classnames_default()({
    [`${prefixCls}-rtl`]: rtl !== null && rtl !== void 0 ? rtl : direction === 'rtl'
  });
  // ============================== Motion ===============================
  const getNotificationMotion = () => getMotion(prefixCls);
  // ============================== Origin ===============================
  const [api, holder] = (0,es/* useNotification */.hN)({
    prefixCls,
    style: getStyle,
    className: getClassName,
    motion: getNotificationMotion,
    closable: true,
    closeIcon: getCloseIcon(prefixCls),
    duration: duration !== null && duration !== void 0 ? duration : DEFAULT_DURATION,
    getContainer: () => (staticGetContainer === null || staticGetContainer === void 0 ? void 0 : staticGetContainer()) || (getPopupContainer === null || getPopupContainer === void 0 ? void 0 : getPopupContainer()) || document.body,
    maxCount,
    pauseOnHover,
    showProgress,
    onAllRemoved,
    renderNotifications,
    stack: stack === false ? false : {
      threshold: typeof stack === 'object' ? stack === null || stack === void 0 ? void 0 : stack.threshold : undefined,
      offset: 8,
      gap: token.margin
    }
  });
  // ================================ Ref ================================
  react.useImperativeHandle(ref, () => Object.assign(Object.assign({}, api), {
    prefixCls,
    notification
  }));
  return holder;
});
// ==============================================================================
// ==                                   Hook                                   ==
// ==============================================================================
function useInternalNotification(notificationConfig) {
  const holderRef = react.useRef(null);
  const warning = (0,_util_warning/* devUseWarning */.rJ)('Notification');
  // ================================ API ================================
  const wrapAPI = react.useMemo(() => {
    // Wrap with notification content
    // >>> Open
    const open = config => {
      var _a;
      if (!holderRef.current) {
         false ? 0 : void 0;
        return;
      }
      const {
        open: originOpen,
        prefixCls,
        notification
      } = holderRef.current;
      const noticePrefixCls = `${prefixCls}-notice`;
      const {
          message,
          description,
          icon,
          type,
          btn,
          className,
          style,
          role = 'alert',
          closeIcon,
          closable
        } = config,
        restConfig = useNotification_rest(config, ["message", "description", "icon", "type", "btn", "className", "style", "role", "closeIcon", "closable"]);
      const realCloseIcon = getCloseIcon(noticePrefixCls, typeof closeIcon !== 'undefined' ? closeIcon : notification === null || notification === void 0 ? void 0 : notification.closeIcon);
      return originOpen(Object.assign(Object.assign({
        // use placement from props instead of hard-coding "topRight"
        placement: (_a = notificationConfig === null || notificationConfig === void 0 ? void 0 : notificationConfig.placement) !== null && _a !== void 0 ? _a : DEFAULT_PLACEMENT
      }, restConfig), {
        content: (/*#__PURE__*/react.createElement(PureContent, {
          prefixCls: noticePrefixCls,
          icon: icon,
          type: type,
          message: message,
          description: description,
          btn: btn,
          role: role
        })),
        className: classnames_default()(type && `${noticePrefixCls}-${type}`, className, notification === null || notification === void 0 ? void 0 : notification.className),
        style: Object.assign(Object.assign({}, notification === null || notification === void 0 ? void 0 : notification.style), style),
        closeIcon: realCloseIcon,
        closable: closable !== null && closable !== void 0 ? closable : !!realCloseIcon
      }));
    };
    // >>> destroy
    const destroy = key => {
      var _a, _b;
      if (key !== undefined) {
        (_a = holderRef.current) === null || _a === void 0 ? void 0 : _a.close(key);
      } else {
        (_b = holderRef.current) === null || _b === void 0 ? void 0 : _b.destroy();
      }
    };
    const clone = {
      open,
      destroy
    };
    const keys = ['success', 'info', 'warning', 'error'];
    keys.forEach(type => {
      clone[type] = config => open(Object.assign(Object.assign({}, config), {
        type
      }));
    });
    return clone;
  }, []);
  // ============================== Return ===============================
  return [wrapAPI, /*#__PURE__*/react.createElement(Holder, Object.assign({
    key: "notification-holder"
  }, notificationConfig, {
    ref: holderRef
  }))];
}
function useNotification(notificationConfig) {
  return useInternalNotification(notificationConfig);
}
;// ./node_modules/antd/es/notification/index.js
"use client";







let notification = null;
let act = callback => callback();
let taskQueue = [];
let defaultGlobalConfig = {};
function getGlobalContext() {
  const {
    getContainer,
    rtl,
    maxCount,
    top,
    bottom,
    showProgress,
    pauseOnHover
  } = defaultGlobalConfig;
  const mergedContainer = (getContainer === null || getContainer === void 0 ? void 0 : getContainer()) || document.body;
  return {
    getContainer: () => mergedContainer,
    rtl,
    maxCount,
    top,
    bottom,
    showProgress,
    pauseOnHover
  };
}
const GlobalHolder = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
    notificationConfig,
    sync
  } = props;
  const {
    getPrefixCls
  } = (0,react.useContext)(config_provider_context/* ConfigContext */.QO);
  const prefixCls = defaultGlobalConfig.prefixCls || getPrefixCls('notification');
  const appConfig = (0,react.useContext)(context/* AppConfigContext */.B);
  const [api, holder] = useInternalNotification(Object.assign(Object.assign(Object.assign({}, notificationConfig), {
    prefixCls
  }), appConfig.notification));
  react.useEffect(sync, []);
  react.useImperativeHandle(ref, () => {
    const instance = Object.assign({}, api);
    Object.keys(instance).forEach(method => {
      instance[method] = function () {
        sync();
        return api[method].apply(api, arguments);
      };
    });
    return {
      instance,
      sync
    };
  });
  return holder;
});
const GlobalHolderWrapper = /*#__PURE__*/react.forwardRef((_, ref) => {
  const [notificationConfig, setNotificationConfig] = react.useState(getGlobalContext);
  const sync = () => {
    setNotificationConfig(getGlobalContext);
  };
  react.useEffect(sync, []);
  const global = (0,config_provider/* globalConfig */.cr)();
  const rootPrefixCls = global.getRootPrefixCls();
  const rootIconPrefixCls = global.getIconPrefixCls();
  const theme = global.getTheme();
  const dom = /*#__PURE__*/react.createElement(GlobalHolder, {
    ref: ref,
    sync: sync,
    notificationConfig: notificationConfig
  });
  return /*#__PURE__*/react.createElement(config_provider/* default */.Ay, {
    prefixCls: rootPrefixCls,
    iconPrefixCls: rootIconPrefixCls,
    theme: theme
  }, global.holderRender ? global.holderRender(dom) : dom);
});
function flushNotice() {
  if (!notification) {
    const holderFragment = document.createDocumentFragment();
    const newNotification = {
      fragment: holderFragment
    };
    notification = newNotification;
    // Delay render to avoid sync issue
    act(() => {
      (0,render/* render */.X)(/*#__PURE__*/react.createElement(GlobalHolderWrapper, {
        ref: node => {
          const {
            instance,
            sync
          } = node || {};
          Promise.resolve().then(() => {
            if (!newNotification.instance && instance) {
              newNotification.instance = instance;
              newNotification.sync = sync;
              flushNotice();
            }
          });
        }
      }), holderFragment);
    });
    return;
  }
  // Notification not ready
  if (!notification.instance) {
    return;
  }
  // >>> Execute task
  taskQueue.forEach(task => {
    switch (task.type) {
      case 'open':
        {
          act(() => {
            notification.instance.open(Object.assign(Object.assign({}, defaultGlobalConfig), task.config));
          });
          break;
        }
      case 'destroy':
        act(() => {
          notification === null || notification === void 0 ? void 0 : notification.instance.destroy(task.key);
        });
        break;
    }
  });
  // Clean up
  taskQueue = [];
}
// ==============================================================================
// ==                                  Export                                  ==
// ==============================================================================
function setNotificationGlobalConfig(config) {
  defaultGlobalConfig = Object.assign(Object.assign({}, defaultGlobalConfig), config);
  // Trigger sync for it
  act(() => {
    var _a;
    (_a = notification === null || notification === void 0 ? void 0 : notification.sync) === null || _a === void 0 ? void 0 : _a.call(notification);
  });
}
function notification_open(config) {
  const global = (0,config_provider/* globalConfig */.cr)();
  if (false) {}
  taskQueue.push({
    type: 'open',
    config
  });
  flushNotice();
}
const destroy = key => {
  taskQueue.push({
    type: 'destroy',
    key
  });
  flushNotice();
};
const methods = ['success', 'info', 'warning', 'error'];
const baseStaticMethods = {
  open: notification_open,
  destroy,
  config: setNotificationGlobalConfig,
  useNotification: useNotification,
  _InternalPanelDoNotUseOrYouWillBeFired: notification_PurePanel
};
const staticMethods = baseStaticMethods;
methods.forEach(type => {
  staticMethods[type] = config => notification_open(Object.assign(Object.assign({}, config), {
    type
  }));
});
// ==============================================================================
// ==                                   Test                                   ==
// ==============================================================================
const noop = () => {};
/** @internal Only Work in test env */
// eslint-disable-next-line import/no-mutable-exports
let actWrapper = (/* unused pure expression or super */ null && (noop));
if (false) {}
/** @internal Only Work in test env */
// eslint-disable-next-line import/no-mutable-exports
let actDestroy = (/* unused pure expression or super */ null && (noop));
if (false) {}
/* harmony default export */ var es_notification = (staticMethods);
;// ./src/pages/chat/chat/constants/fileConfig.ts
// File upload configuration constants
// Maximum file size in bytes (20MB)
const MAX_FILE_SIZE=20*1024*1024;// Threshold for large text files (in characters)
const LARGE_TEXT_THRESHOLD=1500;// Allowed file types
const ALLOWED_FILE_TYPES=(/* unused pure expression or super */ null && (["text/plain","image/jpeg","image/png","image/gif","image/svg+xml","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]));
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
;// ./src/pages/chat/chat/hooks/useFileUpload.tsx
const useFileUpload=_ref=>{let{enable_upload,isInputDisabled,userId,sessionId,serverFilesPrefill}=_ref;const[fileList,setFileList]=react.useState([]);const[isUploading,setIsUploading]=react.useState(false);const[uploadedFilesInfo,setUploadedFilesInfo]=react.useState([]);const[notificationApi,notificationContextHolder]=es_notification.useNotification();const fileListRef=react.useRef([]);react.useEffect(()=>{fileListRef.current=fileList;},[fileList]);const appliedPrefillRef=react.useRef("");react.useEffect(()=>{if(!(serverFilesPrefill!==null&&serverFilesPrefill!==void 0&&serverFilesPrefill.length)){appliedPrefillRef.current="";return;}const sig=serverFilesPrefill.map(f=>f.uuid).sort().join(",");if(sig===appliedPrefillRef.current){return;}appliedPrefillRef.current=sig;setUploadedFilesInfo(prev=>{const byUuid=new Map(prev.map(f=>[f.uuid,f]));serverFilesPrefill.forEach(f=>byUuid.set(f.uuid,f));return Array.from(byUuid.values());});setFileList(prev=>{const byUid=new Set(prev.map(p=>p.uid));const next=(0,toConsumableArray/* default */.A)(prev);serverFilesPrefill.forEach(f=>{if(byUid.has(f.uuid))return;byUid.add(f.uuid);next.push({uid:f.uuid,name:f.name,status:"done",size:f.size,response:f});});return next;});},[serverFilesPrefill]);/**
   * Validate and add file to upload list, then upload to server immediately
   */const handleFileValidationAndAdd=async file=>{// Check file size
if(file.size>MAX_FILE_SIZE){message/* default */.Ay.error(file.name+" is too large. Maximum size is 20MB.");return false;}// Check if file already exists（ref 避免并发选择时闭包中的 fileList 陈旧）
if(fileListRef.current.some(f=>f.name===file.name)){message/* default */.Ay.warning(file.name+" is already attached.");return false;}// Add file to fileList with uploading status
const fileUid="file-"+Date.now()+"-"+file.name;const uploadFile={uid:fileUid,name:file.name,status:"uploading",size:file.size,type:file.type,originFileObj:file};setFileList(prev=>[].concat((0,toConsumableArray/* default */.A)(prev),[uploadFile]));// Upload file to server immediately if enable_upload is true
// Note: file upload no longer depends on sessionId
if(enable_upload&&userId){try{setIsUploading(true);// sessionId is optional, use 0 or -1 if not provided
const uploadSessionId=sessionId&&sessionId>0?sessionId:sessionId||0;const response=await api/* fileAPI */.jp.saveFilesToServer(userId,[file],uploadSessionId);// Extract file info from response
// fileAPI.saveFilesToServer returns data.data which is already the files array
let fileInfoList=[];if(response){if(Array.isArray(response)){// Response is directly an array (this is the expected format)
fileInfoList=response;}else if(response.data&&Array.isArray(response.data)){// Response has {status, data} format
fileInfoList=response.data;}else if(response.status&&response.data){// Response has nested data
fileInfoList=Array.isArray(response.data)?response.data:[];}}// Store uploaded file info
if(fileInfoList.length>0){const fileInfo=fileInfoList[0];// Use first file info
setUploadedFilesInfo(prev=>{const newInfo=[].concat((0,toConsumableArray/* default */.A)(prev),[fileInfo]);return newInfo;});// Update file status to done after successful upload
// Also store the uploaded file info in the file's response field for easier matching
setFileList(prev=>{const updated=prev.map(f=>f.uid===fileUid?Object.assign({},f,{status:"done",response:fileInfo}):f);return updated;});}else{// Even if fileInfoList is empty, mark file as done (but without response)
setFileList(prev=>prev.map(f=>f.uid===fileUid?Object.assign({},f,{status:"done"}):f));}// Show success notification
notificationApi.success({message:/*#__PURE__*/react.createElement("span",{className:"text-sm"},"File Uploaded"),description:/*#__PURE__*/react.createElement("span",{className:"text-sm text-secondary"},file.name," has been uploaded successfully."),duration:3});}catch(error){// Update file status to error
setFileList(prev=>prev.map(f=>f.uid===fileUid?Object.assign({},f,{status:"error"}):f));const errorMessage=error instanceof Error?error.message:"文件上传失败";message/* default */.Ay.error(file.name+": "+errorMessage);console.error("File upload error:",error);// Remove file from list on error (optional, you can keep it if you want to retry)
// setFileList((prev) => prev.filter((f) => f.uid !== fileUid));
}finally{setIsUploading(false);}}else{// If upload is disabled or missing credentials, just mark as done
setFileList(prev=>prev.map(f=>f.uid===fileUid?Object.assign({},f,{status:"done"}):f));// Show success notification
notificationApi.success({message:/*#__PURE__*/react.createElement("span",{className:"text-sm"},"File Added"),description:/*#__PURE__*/react.createElement("span",{className:"text-sm text-secondary"},file.name," will be sent with your message."),duration:3});}return true;};/**
   * Handle paste event for images and large text
   */const handlePaste=async(e,textAreaRef,setText)=>{var _e$clipboardData;if(isInputDisabled||!enable_upload)return;// Handle multiple files paste
if((_e$clipboardData=e.clipboardData)!==null&&_e$clipboardData!==void 0&&_e$clipboardData.items){const filesToUpload=[];const uploadFiles=[];let hasImageItem=false;let hasLargeText=false;let largeTextContent="";// First pass: collect all files and check for large text
for(let i=0;i<e.clipboardData.items.length;i++){const item=e.clipboardData.items[i];// Handle image items
if(item.type.indexOf("image/")===0){hasImageItem=true;const file=item.getAsFile();if(file&&file.size<=MAX_FILE_SIZE){const fileName="pasted-image-"+new Date().getTime()+"-"+i+".png";const namedFile=new File([file],fileName,{type:file.type});filesToUpload.push(namedFile);const uploadFile={uid:"paste-"+Date.now()+"-"+i,name:fileName,status:"uploading",size:namedFile.size,type:namedFile.type,originFileObj:namedFile};uploadFiles.push(uploadFile);}else if(file&&file.size>MAX_FILE_SIZE){message/* default */.Ay.error("Pasted image "+(file.name||"image")+" is too large. Maximum size is 20MB.");}}// Handle text items - only if there's a large amount of text
if(item.type==="text/plain"&&!hasImageItem){item.getAsString(text=>{if(text.length>LARGE_TEXT_THRESHOLD){hasLargeText=true;largeTextContent=text;}});}}// If we have files to upload, prevent default paste and process them
if(filesToUpload.length>0||hasLargeText){e.preventDefault();// Add all files to file list with uploading status
setFileList(prev=>[].concat((0,toConsumableArray/* default */.A)(prev),uploadFiles));// Handle large text conversion
if(hasLargeText){setTimeout(()=>{if(textAreaRef.current){const currentValue=textAreaRef.current.value;const selectionStart=textAreaRef.current.selectionStart||0;const selectionEnd=textAreaRef.current.selectionEnd||0;const newValue=currentValue.substring(0,selectionStart-largeTextContent.length)+currentValue.substring(selectionEnd);textAreaRef.current.value=newValue;setText(newValue);}},0);// Create a text file from the pasted content
const blob=new Blob([largeTextContent],{type:"text/plain"});const textFile=new File([blob],"pasted-text-"+new Date().getTime()+".txt",{type:"text/plain"});filesToUpload.push(textFile);const textUploadFile={uid:"paste-text-"+Date.now(),name:textFile.name,status:"uploading",size:textFile.size,type:textFile.type,originFileObj:textFile};uploadFiles.push(textUploadFile);setFileList(prev=>[].concat((0,toConsumableArray/* default */.A)(prev),[textUploadFile]));}// Upload files to server immediately if enable_upload is true
if(filesToUpload.length>0){if(enable_upload&&userId){// Upload all files
setIsUploading(true);Promise.all(filesToUpload.map(async file=>{var _uploadFiles$find;const fileUid=(_uploadFiles$find=uploadFiles.find(uf=>uf.name===file.name))===null||_uploadFiles$find===void 0?void 0:_uploadFiles$find.uid;if(!fileUid)return;try{const uploadSessionId=sessionId&&sessionId>0?sessionId:sessionId||0;const result=await api/* fileAPI */.jp.saveFilesToServer(userId,[file],uploadSessionId);// Store uploaded file info
if(result&&result.length>0){setUploadedFilesInfo(prev=>{const newInfo=[].concat((0,toConsumableArray/* default */.A)(prev),(0,toConsumableArray/* default */.A)(result));return newInfo;});}// Update file status to done after successful upload
// Also store the uploaded file info in the file's response field for easier matching
setFileList(prev=>prev.map(f=>f.uid===fileUid?Object.assign({},f,{status:"done",response:result&&result.length>0?result[0]:undefined}):f));}catch(error){// Update file status to error
setFileList(prev=>prev.map(f=>f.uid===fileUid?Object.assign({},f,{status:"error"}):f));const errorMessage=error instanceof Error?error.message:"文件上传失败";message/* default */.Ay.error(file.name+": "+errorMessage);}})).finally(()=>{setIsUploading(false);});const fileCount=filesToUpload.length;const fileType=fileCount===1?"file":"files";message/* default */.Ay.success(fileCount+" "+fileType+" pasted and uploading...");}else{// If upload is disabled or missing credentials, just mark as done
setFileList(prev=>prev.map(f=>{const isUploadedFile=uploadFiles.some(uf=>uf.uid===f.uid);return isUploadedFile?Object.assign({},f,{status:"done"}):f;}));const fileCount=filesToUpload.length;const fileType=fileCount===1?"file":"files";message/* default */.Ay.success(fileCount+" "+fileType+" pasted and will be sent with your message");}}}}};/**
   * Remove file from list
   */const removeFile=uid=>{let removedName;setFileList(prev=>{const fileToRemove=prev.find(item=>item.uid===uid);removedName=fileToRemove===null||fileToRemove===void 0?void 0:fileToRemove.name;return prev.filter(item=>item.uid!==uid);});if(removedName){setUploadedFilesInfo(prev=>prev.filter(info=>info.name!==removedName));}};/**
   * Clear all files
   */const clearFiles=()=>{setFileList([]);setUploadedFilesInfo([]);};return{fileList,setFileList,isUploading,notificationContextHolder,handleFileValidationAndAdd,handlePaste,removeFile,clearFiles,uploadedFilesInfo};};
// EXTERNAL MODULE: ./node_modules/lodash/debounce.js
var debounce = __webpack_require__(38221);
var debounce_default = /*#__PURE__*/__webpack_require__.n(debounce);
;// ./src/pages/chat/chat/hooks/usePlanSearch.tsx
const usePlanSearch=_ref=>{let{userId,runStatus,isPlanMessage}=_ref;const[isSearching,setIsSearching]=react.useState(false);const[relevantPlans,setRelevantPlans]=react.useState([]);const[allPlans,setAllPlans]=react.useState([]);const[attachedPlan,setAttachedPlan]=react.useState(null);const[isLoading,setIsLoading]=react.useState(false);const[isRelevantPlansVisible,setIsRelevantPlansVisible]=react.useState(false);const[isPlanModalVisible,setIsPlanModalVisible]=react.useState(false);// Fetch all plans on mount
react.useEffect(()=>{const fetchAllPlans=async()=>{try{setIsLoading(true);const response=await api/* planAPI */.a7.listPlans(userId);if(response){if(Array.isArray(response)){setAllPlans(response);}else{console.warn("Unexpected response format:",response);}}else{console.warn("Empty response received");}}catch(error){console.error("Error fetching plans:",error);}finally{setIsLoading(false);}};fetchAllPlans();},[userId]);// Create searchable data structure
const searchableData=react.useMemo(()=>{return allPlans.map(plan=>{var _plan$task,_plan$steps;return Object.assign({},plan,{taskLower:((_plan$task=plan.task)===null||_plan$task===void 0?void 0:_plan$task.toLowerCase())||"",stepTexts:((_plan$steps=plan.steps)===null||_plan$steps===void 0?void 0:_plan$steps.map(step=>{var _step$title,_step$details;return(((_step$title=step.title)===null||_step$title===void 0?void 0:_step$title.toLowerCase())||"")+" "+(((_step$details=step.details)===null||_step$details===void 0?void 0:_step$details.toLowerCase())||"");}))||[]});});},[allPlans]);// Search plans with debounce
const searchPlans=react.useCallback(debounce_default()(query=>{// Don't search if query is too short, no plans available, or plan is already attached
if(query.length<3||!searchableData||searchableData.length===0||attachedPlan){return;}setIsSearching(true);try{const searchTerms=query.toLowerCase().split(" ");const matchingPlans=searchableData.filter(plan=>{if(query.length<=2){if(plan.taskLower.startsWith(query.toLowerCase())){return true;}}const taskMatches=searchTerms.every(term=>plan.taskLower.includes(term));if(taskMatches){return true;}return plan.stepTexts.some(stepText=>searchTerms.every(term=>stepText.includes(term)));});if(matchingPlans.length>0){setRelevantPlans(matchingPlans.slice(0,5));setIsRelevantPlansVisible(true);}else{setRelevantPlans([]);setAttachedPlan(null);setIsRelevantPlansVisible(false);}}catch(error){console.error("Error searching plans:",error);}finally{setIsSearching(false);}},1000),[searchableData,runStatus,isPlanMessage,attachedPlan]);const handleUsePlan=plan=>{setRelevantPlans([]);setAttachedPlan(plan);setIsRelevantPlansVisible(false);};const clearAttachedPlan=()=>{setAttachedPlan(null);};const handlePlanClick=()=>{setIsPlanModalVisible(true);};const handlePlanModalClose=()=>{setIsPlanModalVisible(false);};return{isSearching,relevantPlans,allPlans,attachedPlan,isLoading,isRelevantPlansVisible,isPlanModalVisible,searchPlans,handleUsePlan,clearAttachedPlan,handlePlanClick,handlePlanModalClose,setRelevantPlans,setIsRelevantPlansVisible};};
// EXTERNAL MODULE: ./src/components/features/Agents/useAgentInfo.ts
var useAgentInfo = __webpack_require__(43044);
// EXTERNAL MODULE: ./src/store/modeConfig.tsx
var modeConfig = __webpack_require__(41025);
// EXTERNAL MODULE: ./src/hooks/store.tsx + 5 modules
var store = __webpack_require__(75625);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/upload.js
var upload = __webpack_require__(94796);
;// ./src/pages/chat/chat/components/DragDropOverlay.tsx
const DragDropOverlay=_ref=>{let{isDragActive,darkMode}=_ref;if(!isDragActive)return null;return/*#__PURE__*/react.createElement("div",{className:"absolute inset-0 border-2 border-dashed rounded-lg flex items-center justify-center z-10 pointer-events-none "+(darkMode==="dark"?"bg-magenta-500 bg-opacity-10 border-magenta-500":"bg-magenta-500 bg-opacity-5 border-magenta-500")},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement(upload/* default */.A,{className:"w-12 h-12 mx-auto mb-2 "+(darkMode==="dark"?"text-magenta-400":"text-magenta-600")}),/*#__PURE__*/react.createElement("p",{className:"font-medium "+(darkMode==="dark"?"text-magenta-300":"text-magenta-700")},"Drop files here to upload"),/*#__PURE__*/react.createElement("p",{className:"text-sm "+(darkMode==="dark"?"text-magenta-400":"text-magenta-600")},"Supported: Images, PDF, Word, Text files")));};/* harmony default export */ var components_DragDropOverlay = (DragDropOverlay);
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/x.js
var x = __webpack_require__(48697);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/image.js
var icons_image = __webpack_require__(59612);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
// EXTERNAL MODULE: ./node_modules/antd/es/progress/index.js + 13 modules
var progress = __webpack_require__(17983);
;// ./src/pages/chat/chat/utils/fileHelpers.tsx
/**
 * Format file size to human readable format
 */const formatFileSize=bytes=>{if(bytes===0)return"0 Bytes";const k=1024;const sizes=["Bytes","KB","MB","GB"];const i=Math.floor(Math.log(bytes)/Math.log(k));return parseFloat((bytes/Math.pow(k,i)).toFixed(2))+" "+sizes[i];};/**
 * Get appropriate icon for file type
 */const getFileIcon=(file,darkMode)=>{const fileType=file.type||"";const fileName=file.name||"";// Show upload status
if(file.status==="uploading"){return/*#__PURE__*/react.createElement(progress/* default */.A,{type:"circle",size:16,percent:50,strokeColor:darkMode==="dark"?"#a855f7":"#7c3aed"});}if(file.status==="error"){return/*#__PURE__*/react.createElement(esm_ExclamationTriangleIcon,{className:"w-4 h-4 text-red-500"});}if(fileType.startsWith("image/")){return/*#__PURE__*/react.createElement(icons_image/* default */.A,{className:"w-4 h-4 "+(darkMode==="dark"?"text-magenta-400":"text-magenta-600")});}if(fileType==="application/pdf"){return/*#__PURE__*/react.createElement(file_text/* default */.A,{className:"w-4 h-4 text-red-500"});}if(fileType.includes("word")||fileName.endsWith(".doc")||fileName.endsWith(".docx")){return/*#__PURE__*/react.createElement(file_text/* default */.A,{className:"w-4 h-4 "+(darkMode==="dark"?"text-magenta-400":"text-magenta-600")});}if(fileType==="text/plain"||fileName.endsWith(".txt")){return/*#__PURE__*/react.createElement(file_text/* default */.A,{className:"w-4 h-4 text-green-500"});}return/*#__PURE__*/react.createElement(file_text/* default */.A,{className:"w-4 h-4 "+(darkMode==="dark"?"text-gray-400":"text-gray-500")});};
;// ./src/pages/chat/chat/components/FilePreview.tsx
const FilePreview=_ref=>{let{fileList,darkMode,onRemove}=_ref;if(fileList.length===0)return null;return/*#__PURE__*/react.createElement(react.Fragment,null,fileList.map(file=>/*#__PURE__*/react.createElement("div",{key:file.uid,className:"flex items-center gap-2 "+(darkMode==="dark"?"bg-[#444444] text-white border border-gray-600":"bg-white text-magenta-800 border border-magenta-200")+" rounded-lg px-3 py-2 text-xs shadow-sm hover:shadow-md transition-shadow "+(file.status==="error"?"border-red-500":"")},getFileIcon(file,darkMode),/*#__PURE__*/react.createElement("div",{className:"flex flex-col min-w-0 flex-1"},/*#__PURE__*/react.createElement("span",{className:"truncate font-medium "+(darkMode==="dark"?"text-white":"text-magenta-800")},file.name),/*#__PURE__*/react.createElement("span",{className:"text-xs "+(darkMode==="dark"?"text-gray-400":"text-magenta-600")},formatFileSize(file.size||0),file.status==="uploading"&&" - Uploading...",file.status==="error"&&" - Upload failed")),/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"text",size:"small",className:"p-0 ml-1 flex items-center justify-center rounded-full "+(darkMode==="dark"?"hover:bg-red-500/20 hover:text-red-400":"hover:bg-red-100 hover:text-red-600"),onClick:()=>onRemove(file.uid),icon:/*#__PURE__*/react.createElement(x/* default */.A,{className:"w-3 h-3 "+(darkMode==="dark"?"text-gray-400":"text-magenta-600")})}))));};/* harmony default export */ var components_FilePreview = (FilePreview);
;// ./src/pages/chat/chat/components/PlanPreview.tsx
const PlanPreview=_ref=>{let{plan,darkMode,onRemove,onClick}=_ref;return/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-1 "+(darkMode==="dark"?"bg-[#444444] text-white":"bg-white text-magenta-800 border border-magenta-200")+" rounded px-2 py-1 text-xs cursor-pointer hover:opacity-80 transition-opacity shadow-sm",onClick:onClick},/*#__PURE__*/react.createElement("span",{className:"truncate max-w-[150px] "+(darkMode==="dark"?"text-white":"text-magenta-800")},"\uD83D\uDCCB ",plan.task),/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"text",size:"small",className:"p-0 ml-1 flex items-center justify-center rounded-full "+(darkMode==="dark"?"hover:bg-red-500/20 hover:text-red-400":"hover:bg-red-100 hover:text-red-600"),onClick:e=>{e.stopPropagation();onRemove();},icon:/*#__PURE__*/react.createElement(x/* default */.A,{className:"w-3 h-3 "+(darkMode==="dark"?"text-gray-400":"text-magenta-600")})}));};/* harmony default export */ var components_PlanPreview = (PlanPreview);
;// ./src/pages/chat/chat/chatinput.tsx











// Import custom hooks



// Import components








/** HepAI 技能 ZIP（与 SkillsSquarePage / fileAPI.listHepaiFiles 一致） */

const SKILL_INSTALL_DEFAULT_LINE = "帮我安装这些智能体";
const ChatInput = /*#__PURE__*/react.forwardRef((_ref, ref) => {
  let {
    onSubmit,
    error,
    disabled = false,
    onCancel,
    runStatus,
    inputRequest,
    isPlanMessage = false,
    onPause,
    enable_upload = false,
    onExecutePlan,
    sessionId,
    onTextChange,
    serverFilesPrefill
  } = _ref;
  const textAreaRef = react.useRef(null);
  const attachFileInputRef = react.useRef(null);
  const [skillModalOpen, setSkillModalOpen] = react.useState(false);
  const [skillModalLoading, setSkillModalLoading] = react.useState(false);
  const [skillModalRows, setSkillModalRows] = react.useState([]);
  const [skillModalSearch, setSkillModalSearch] = react.useState("");
  const [skillModalSelectedIds, setSkillModalSelectedIds] = react.useState(() => new Set());
  const [attachedSkills, setAttachedSkills] = react.useState([]);
  const [text, setText] = react.useState("");
  const [dragOver, setDragOver] = react.useState(false);
  const [isDragActive, setIsDragActive] = react.useState(false);
  const {
    darkMode,
    user
  } = react.useContext(provider/* appContext */.v);
  const userId = (user === null || user === void 0 ? void 0 : user.email) || "default_user";
  const {
    agentInfo,
    agentId
  } = (0,useAgentInfo/* useAgentInfo */.B)(user === null || user === void 0 ? void 0 : user.email);
  const {
    session,
    setSession,
    sessions,
    setSessions
  } = (0,store/* useConfigStore */.J)();
  const setAgentInfo = (0,modeConfig/* useModeConfigStore */.Q)(s => s.setAgentInfo);
  const selectedAgent = (0,modeConfig/* useModeConfigStore */.Q)(s => s.selectedAgent);
  const setSelectedAgent = (0,modeConfig/* useModeConfigStore */.Q)(s => s.setSelectedAgent);
  const [llmList, setLlmList] = react.useState([]);
  const [selectedLlmLabel, setSelectedLlmLabel] = react.useState("");
  react.useEffect(() => {
    if (agentInfo && agentInfo.agent_config) {
      const llmList = Object.entries(agentInfo.agent_config).map(_ref2 => {
        let [key, value] = _ref2;
        return {
          label: key,
          value: value
        };
      });
      setLlmList(llmList);
    } else setLlmList([]);
  }, [agentInfo]);
  react.useEffect(() => {
    const defaultConfigName = (agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.defult_config_name) || "";
    if (defaultConfigName && llmList.some(llm => llm.label === defaultConfigName)) {
      setSelectedLlmLabel(defaultConfigName);
    } else {
      setSelectedLlmLabel("");
    }
  }, [agentInfo, llmList]);
  const isInputDisabled = disabled || runStatus === "active" || runStatus === "pausing" || runStatus === "paused" || (inputRequest === null || inputRequest === void 0 ? void 0 : inputRequest.input_type) === "approval";

  // Use custom hooks
  const {
    fileList,
    notificationContextHolder,
    handleFileValidationAndAdd,
    handlePaste,
    removeFile,
    clearFiles,
    uploadedFilesInfo
  } = useFileUpload({
    enable_upload,
    isInputDisabled,
    userId,
    sessionId,
    serverFilesPrefill
  });
  const filteredSkillModalRows = react.useMemo(() => {
    const q = skillModalSearch.trim().toLowerCase();
    if (!q) return skillModalRows;
    return skillModalRows.filter(r => r.filename.toLowerCase().includes(q));
  }, [skillModalRows, skillModalSearch]);
  const openSkillAttachModal = () => {
    if (!userId || userId === "default_user") {
      message/* default */.Ay.warning("请先登录后再选择技能包");
      return;
    }
    if (isInputDisabled) return;
    setSkillModalOpen(true);
    setSkillModalSearch("");
    setSkillModalLoading(true);
    void api/* fileAPI */.jp.listHepaiFiles(userId).then(rows => {
      setSkillModalRows(rows.map(r => ({
        id: r.id,
        filename: r.filename,
        url: r.url
      })));
      setSkillModalSelectedIds(new Set(attachedSkills.map(s => s.id)));
    }).catch(e => {
      message/* default */.Ay.error(e instanceof Error ? e.message : String(e));
      setSkillModalRows([]);
    }).finally(() => {
      setSkillModalLoading(false);
    });
  };
  const confirmSkillPicker = () => {
    const next = skillModalRows.filter(r => skillModalSelectedIds.has(r.id));
    setAttachedSkills(next);
    setSkillModalOpen(false);
  };
  const removeAttachedSkill = id => {
    setAttachedSkills(prev => prev.filter(s => s.id !== id));
  };
  const {
    isSearching,
    relevantPlans,
    attachedPlan,
    isRelevantPlansVisible,
    isPlanModalVisible,
    searchPlans,
    handleUsePlan,
    clearAttachedPlan,
    handlePlanClick,
    handlePlanModalClose,
    setRelevantPlans,
    setIsRelevantPlansVisible
  } = usePlanSearch({
    userId,
    runStatus,
    isPlanMessage
  });
  const getTextAreaDefaultHeight = () => {
    const baseHeight = 52; // 基础高度 52px
    return baseHeight + "px";
  };
  // Handle textarea auto-resize
  react.useEffect(() => {
    const ta = textAreaRef.current;
    if (!ta) return;

    // 清空后 scrollHeight 有时会沿用撑开前的值，不能直接用来设高度
    if (!text.trim()) {
      ta.style.height = getTextAreaDefaultHeight();
      return;
    }
    ta.style.height = getTextAreaDefaultHeight();
    const scrollHeight = ta.scrollHeight;
    ta.style.height = Math.min(scrollHeight, 120) + "px";
  }, [text, inputRequest]);
  react.useEffect(() => {
    if (!error) {
      resetInput();
    }
  }, [error]);
  react.useEffect(() => {
    if (!isInputDisabled && textAreaRef.current) {
      // textAreaRef.current.focus();
    }
  }, [isInputDisabled]);

  // Handle click outside to close relevant plans
  react.useEffect(() => {
    const handleClickOutside = e => {
      if (!isRelevantPlansVisible) return;
      const target = e.target;
      const textAreaElement = textAreaRef.current;
      const planElement = document.querySelector('[data-component="relevant-plans"]');
      const isClickInsideTextArea = textAreaElement && textAreaElement.contains(target);
      const isClickInsidePlans = planElement && planElement.contains(target);
      if (!isClickInsideTextArea && !isClickInsidePlans) {
        setIsRelevantPlansVisible(false);
      }
    };
    const handleKeyDown = e => {
      if (e.key === "Escape" && isRelevantPlansVisible) {
        setIsRelevantPlansVisible(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRelevantPlansVisible]);
  const resetInput = () => {
    if (textAreaRef.current) {
      textAreaRef.current.value = "";
      textAreaRef.current.style.height = getTextAreaDefaultHeight();
      setText("");
      clearFiles();
      setAttachedSkills([]);
      setRelevantPlans([]);
      clearAttachedPlan();
    }
    if (onTextChange) {
      onTextChange("");
    }
  };
  const handleTextChange = event => {
    const newText = event.target.value;
    setText(newText);
    if (onTextChange) {
      onTextChange(newText);
    }
    setRelevantPlans([]);
    const shouldSearch = !(runStatus === "connected" || runStatus === "awaiting_input");
    if (shouldSearch) {
      searchPlans(newText);
    } else if (relevantPlans.length > 0) {
      setRelevantPlans([]);
      clearAttachedPlan();
    }
  };
  const submitInternal = function (query, files, accepted, doResetInput) {
    var _textAreaRef$current;
    if (doResetInput === void 0) {
      doResetInput = true;
    }
    const selectedLlm = llmList.find(llm => llm.label === selectedLlmLabel);
    if (attachedPlan) {
      onSubmit(query, files, accepted, attachedPlan, selectedLlm);
    } else {
      onSubmit(query, files, accepted, undefined, selectedLlm);
    }
    if (doResetInput) {
      // 延迟清空文件，确保文件信息已经传递
      setTimeout(() => {
        resetInput();
      }, 100);
    }
    (_textAreaRef$current = textAreaRef.current) === null || _textAreaRef$current === void 0 ? void 0 : _textAreaRef$current.focus();
  };
  const handleSubmit = async () => {
    var _textAreaRef$current2;
    const trimmedInput = (((_textAreaRef$current2 = textAreaRef.current) === null || _textAreaRef$current2 === void 0 ? void 0 : _textAreaRef$current2.value) || "").trim();
    if ((trimmedInput || fileList.length > 0 || attachedSkills.length > 0) && !isInputDisabled) {
      var _textAreaRef$current3;
      let query = ((_textAreaRef$current3 = textAreaRef.current) === null || _textAreaRef$current3 === void 0 ? void 0 : _textAreaRef$current3.value) || "";
      const files = fileList.filter(file => file.originFileObj).map(file => file.originFileObj);

      // 如果只有文件没有文字，添加默认提示
      if (!query.trim() && files.length > 0) {
        query = "请帮我分析这些文件。";
      }
      if (attachedSkills.length > 0) {
        const urlBlock = attachedSkills.map(s => s.url).join("\n");
        const base = query.trim();
        query = base ? base + "\n\n" + SKILL_INSTALL_DEFAULT_LINE + "\n\n" + urlBlock : SKILL_INSTALL_DEFAULT_LINE + "\n\n" + urlBlock;
      }

      // 注意：文件上传已经在 handleFileValidationAndAdd 中处理了
      // 这里只需要检查是否有上传失败的文件
      const hasErrorFiles = fileList.some(f => f.status === "error");
      if (hasErrorFiles) {
        message/* default */.Ay.warning("部分文件上传失败，请检查后重试");
      }

      // 使用上传后的文件信息（如果已上传），否则使用原始文件
      // 只使用已成功上传的文件信息（status === "done"）
      const successfullyUploadedFiles = fileList.filter(f => f.status === "done" && f.originFileObj);

      // 优先使用 uploadedFilesInfo（这是最可靠的来源，因为它在文件上传成功后立即更新）
      let filesToUse = [];

      // 优先级1: 使用 uploadedFilesInfo（最可靠）
      if (uploadedFilesInfo.length > 0) {
        filesToUse = uploadedFilesInfo;
      } else if (successfullyUploadedFiles.length > 0) {
        // 优先级2: 如果 uploadedFilesInfo 为空，尝试从 successfullyUploadedFiles 中提取
        filesToUse = successfullyUploadedFiles.map(file => {
          // 优先使用 file.response（上传时存储的结果）
          if (file.response) {
            return file.response;
          }
          return undefined;
        }).filter(info => info !== undefined);
      } else if (fileList.length > 0) {
        // 如果文件还没有上传完成，但 fileList 中有文件，检查是否有 response
        const filesWithResponse = fileList.filter(f => f.response).map(f => f.response).filter(info => info !== undefined);
        if (filesWithResponse.length > 0) {
          filesToUse = filesWithResponse;
        } else {
          // 尝试从 fileList 中获取所有文件，即使状态不是 done
          const allFiles = fileList.filter(f => f.response).map(f => f.response).filter(info => info !== undefined);
          if (allFiles.length > 0) {
            filesToUse = allFiles;
          }
        }
      }

      // 如果 filesToUse 仍然为空，但 fileList 中有文件，尝试直接使用 fileList 中的文件信息
      if (filesToUse.length === 0 && fileList.length > 0) {
        const allPossibleFiles = fileList.map(f => {
          // 尝试从 response 获取
          if (f.response) {
            return f.response;
          }
          // 尝试从 uploadedFilesInfo 匹配
          const matched = uploadedFilesInfo === null || uploadedFilesInfo === void 0 ? void 0 : uploadedFilesInfo.find(info => info.name === f.name);
          if (matched) {
            return matched;
          }
          return undefined;
        }).filter(info => info !== undefined);
        if (allPossibleFiles.length > 0) {
          filesToUse = allPossibleFiles;
        }
      }

      // 如果 filesToUse 为空，但 fileList 中有文件，尝试等待文件上传完成
      if (filesToUse.length === 0 && fileList.length > 0) {
        const uploadingFiles = fileList.filter(f => f.status === "uploading");
        if (uploadingFiles.length > 0) {
          message/* default */.Ay.warning("文件正在上传中，请稍候再试");
          return;
        }
        const hasLocalAttachments = fileList.some(f => f.originFileObj);
        if (hasLocalAttachments && enable_upload) {
          message/* default */.Ay.error("未能获取已上传文件的信息，请移除附件后重新添加，或确认网络与上传服务正常");
          return;
        }
      }
      submitInternal(query, filesToUse, false, true);
    }
  };
  const handlePause = () => {
    if (onPause) {
      onPause();
    }
  };
  const handleLLMSelect = async llm => {
    try {
      if (!agentId || !agentInfo) {
        message/* default */.Ay.warning("请先选择智能体");
        return;
      }

      // 只更新默认模型名：不要把整个 agent_config 列表回传给后端
      // 后端字段拼写为 defult_config_name（与后端保持一致）
      const updatedAgentConfig = {
        id: agentId,
        defult_config_name: llm.label
      };

      // 调用后端 API 更新 agent
      await api/* agentWorkerAPI */.Ml.updateUserAgent(userId, updatedAgentConfig);
      setAgentInfo(Object.assign({}, agentInfo, {
        defult_config_name: llm.label
      }));
      if (selectedAgent) {
        setSelectedAgent(Object.assign({}, selectedAgent, {
          defult_config_name: llm.label
        }));
      }
      if (session !== null && session !== void 0 && session.id && session !== null && session !== void 0 && session.agent_mode_config) {
        const updatedSession = Object.assign({}, session, {
          agent_mode_config: Object.assign({}, session.agent_mode_config, {
            defult_config_name: llm.label
          })
        });
        setSession(updatedSession);
        if (Array.isArray(sessions) && sessions.length > 0) {
          setSessions(sessions.map(s => s.id === session.id ? Object.assign({}, s, {
            agent_mode_config: Object.assign({}, s.agent_mode_config, {
              defult_config_name: llm.label
            })
          }) : s));
        }
      }
      setSelectedLlmLabel(llm.label);
      message/* default */.Ay.success("\u5DF2\u9009\u62E9\u6A21\u578B: " + llm.label);
      console.log("Selected LLM:", llm);
    } catch (error) {
      console.error("Failed to update agent LLM:", error);
      const errorMessage = error instanceof Error ? error.message : "更新模型选择失败";
      message/* default */.Ay.error(errorMessage);
    }
  };
  const handleKeyDown = event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  // Expose focus and setValue methods via ref
  react.useImperativeHandle(ref, () => ({
    focus: () => {
      var _textAreaRef$current4;
      (_textAreaRef$current4 = textAreaRef.current) === null || _textAreaRef$current4 === void 0 ? void 0 : _textAreaRef$current4.focus();
    },
    setValue: value => {
      setText(value);
      if (textAreaRef.current) {
        textAreaRef.current.value = value;
        if (!value.trim()) {
          textAreaRef.current.style.height = getTextAreaDefaultHeight();
        } else {
          const scrollHeight = textAreaRef.current.scrollHeight;
          const newHeight = Math.min(scrollHeight, 120);
          textAreaRef.current.style.height = newHeight + "px";
        }
        textAreaRef.current.focus();
        textAreaRef.current.setSelectionRange(value.length, value.length);
      }
      if (onTextChange) {
        onTextChange(value);
      }
    }
  }));
  const handleAttachFileInputChange = async e => {
    const list = e.target.files;
    if (list !== null && list !== void 0 && list.length) {
      for (const f of Array.from(list)) {
        await handleFileValidationAndAdd(f);
      }
    }
    e.target.value = "";
  };

  // Drag and drop handlers
  const handleDragOver = e => {
    e.preventDefault();
    e.stopPropagation();
    if (!isInputDisabled && enable_upload) {
      setDragOver(true);
      setIsDragActive(true);
    }
  };
  const handleDragLeave = e => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    setIsDragActive(false);
  };
  const handleDrop = async e => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    setIsDragActive(false);
    if (isInputDisabled || !enable_upload) return;
    const droppedFiles = Array.from(e.dataTransfer.files);
    for (const file of droppedFiles) {
      await handleFileValidationAndAdd(file);
    }
  };
  const clearText = () => {
    setText("");
    if (textAreaRef.current) {
      textAreaRef.current.value = "";
      textAreaRef.current.style.height = getTextAreaDefaultHeight();
      textAreaRef.current.focus();
      textAreaRef.current.setSelectionRange(0, 0);
    }
    setRelevantPlans([]);
    clearAttachedPlan();
    if (onTextChange) {
      onTextChange("");
    }
  };
  return /*#__PURE__*/react.createElement("div", {
    className: "mt-2 w-full max-w-4xl mx-auto relative"
  }, notificationContextHolder, isRelevantPlansVisible && /*#__PURE__*/react.createElement(relevant_plans["default"], {
    isSearching: isSearching,
    relevantPlans: relevantPlans,
    darkMode: darkMode,
    onUsePlan: handleUsePlan
  }), /*#__PURE__*/react.createElement(components_DragDropOverlay, {
    isDragActive: isDragActive && enable_upload,
    darkMode: darkMode
  }), (attachedPlan || fileList.length > 0 || attachedSkills.length > 0) && /*#__PURE__*/react.createElement("div", {
    className: "-mb-2 mx-1 " + (darkMode === "dark" ? "bg-[#121826]/65 shadow-modern" : "bg-violet-50/80 border-violet-200/60") + " rounded-t-2xl border-b-0 p-2 flex " + (darkMode === "dark" ? "" : "border") + " flex-wrap gap-2"
  }, attachedPlan && /*#__PURE__*/react.createElement(components_PlanPreview, {
    plan: attachedPlan,
    darkMode: darkMode,
    onRemove: clearAttachedPlan,
    onClick: handlePlanClick
  }), attachedSkills.map(s => /*#__PURE__*/react.createElement("div", {
    key: s.id,
    className: "flex items-center gap-2 max-w-[min(100%,22rem)] " + (darkMode === "dark" ? "bg-[#444444] text-white border border-gray-600" : "bg-white text-magenta-800 border border-magenta-200") + " rounded-lg px-3 py-2 text-xs shadow-sm"
  }, /*#__PURE__*/react.createElement(wrench/* default */.A, {
    className: "w-3.5 h-3.5 shrink-0 " + (darkMode === "dark" ? "text-gray-300" : "text-magenta-600"),
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("div", {
    className: "flex min-w-0 flex-1 flex-col"
  }, /*#__PURE__*/react.createElement("span", {
    className: "truncate font-medium " + (darkMode === "dark" ? "text-white" : "text-magenta-800"),
    title: s.filename
  }, s.filename), /*#__PURE__*/react.createElement("span", {
    className: "truncate text-[11px] " + (darkMode === "dark" ? "text-gray-400" : "text-magenta-600"),
    title: s.url
  }, s.url)), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: () => removeAttachedSkill(s.id),
    className: "shrink-0 rounded-full p-1 " + (darkMode === "dark" ? "hover:bg-red-500/20 hover:text-red-400 text-gray-400" : "hover:bg-red-100 hover:text-red-600 text-magenta-600"),
    "aria-label": "\u79FB\u9664 " + s.filename
  }, /*#__PURE__*/react.createElement(esm_XMarkIcon, {
    className: "h-3.5 w-3.5"
  })))), /*#__PURE__*/react.createElement(components_FilePreview, {
    fileList: fileList,
    darkMode: darkMode,
    onRemove: removeFile
  })), /*#__PURE__*/react.createElement(modal/* default */.A, {
    title: "Plan: " + ((attachedPlan === null || attachedPlan === void 0 ? void 0 : attachedPlan.task) || "Untitled Plan"),
    open: isPlanModalVisible,
    onCancel: handlePlanModalClose,
    footer: null,
    width: 800,
    destroyOnClose: true
  }, attachedPlan && /*#__PURE__*/react.createElement(plan["default"], {
    task: attachedPlan.task || "",
    plan: attachedPlan.steps || [],
    viewOnly: true,
    setPlan: () => {}
  })), /*#__PURE__*/react.createElement(modal/* default */.A, {
    title: "\u9009\u62E9\u6280\u80FD\u5305\uFF08HepAI\uFF09",
    open: skillModalOpen,
    onCancel: () => setSkillModalOpen(false),
    onOk: () => confirmSkillPicker(),
    okText: "\u6DFB\u52A0",
    cancelText: "\u53D6\u6D88",
    destroyOnClose: true,
    width: 560,
    okButtonProps: {
      disabled: skillModalLoading
    }
  }, /*#__PURE__*/react.createElement("p", {
    className: "mb-3 text-xs " + (darkMode === "dark" ? "text-gray-400" : "text-secondary")
  }, "\u53D1\u9001\u65F6\u4F1A\u81EA\u52A8\u9644\u5E26\u300C", SKILL_INSTALL_DEFAULT_LINE, "\u300D\u4E0E\u6240\u9009 ZIP \u7684\u4E0B\u8F7D\u94FE\u63A5\u3002"), /*#__PURE__*/react.createElement(input/* default */.A, {
    allowClear: true,
    placeholder: "\u6309\u6587\u4EF6\u540D\u7B5B\u9009",
    value: skillModalSearch,
    onChange: e => setSkillModalSearch(e.target.value),
    className: "mb-3"
  }), skillModalLoading ? /*#__PURE__*/react.createElement("div", {
    className: "flex justify-center py-12"
  }, /*#__PURE__*/react.createElement(spin/* default */.A, null)) : filteredSkillModalRows.length === 0 ? /*#__PURE__*/react.createElement("div", {
    className: "rounded-lg border border-dashed py-10 text-center text-sm " + (darkMode === "dark" ? "border-gray-600 text-gray-400" : "border-gray-200 text-gray-500")
  }, skillModalRows.length === 0 ? "暂无技能包，请先到技能广场上传 ZIP" : "无匹配项") : /*#__PURE__*/react.createElement("ul", {
    className: "max-h-[min(60vh,22rem)] space-y-1 overflow-auto rounded-lg border p-2 " + (darkMode === "dark" ? "border-gray-600" : "border-gray-200")
  }, filteredSkillModalRows.map(r => /*#__PURE__*/react.createElement("li", {
    key: r.id
  }, /*#__PURE__*/react.createElement("label", {
    className: "flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 " + (darkMode === "dark" ? "hover:bg-white/5" : "hover:bg-violet-50/80")
  }, /*#__PURE__*/react.createElement(es_checkbox/* default */.A, {
    checked: skillModalSelectedIds.has(r.id),
    onChange: e => {
      const checked = e.target.checked;
      setSkillModalSelectedIds(prev => {
        const next = new Set(prev);
        if (checked) next.add(r.id);else next.delete(r.id);
        return next;
      });
    },
    className: "mt-0.5"
  }), /*#__PURE__*/react.createElement("span", {
    className: "min-w-0 flex-1"
  }, /*#__PURE__*/react.createElement("span", {
    className: "block text-sm font-medium " + (darkMode === "dark" ? "text-gray-100" : "text-gray-800")
  }, r.filename), /*#__PURE__*/react.createElement("span", {
    className: "mt-0.5 block truncate text-xs " + (darkMode === "dark" ? "text-gray-500" : "text-gray-500"),
    title: r.url
  }, r.url))))))), /*#__PURE__*/react.createElement("div", {
    className: "chat-input-wrapper mt-4 p-1"
  }, /*#__PURE__*/react.createElement("div", {
    className: "relative w-full transition-smooth rounded-[28px] shadow-modern " + (isDragActive ? "ring-2 ring-accent ring-opacity-50 bg-accent/5" : "") + " " + (darkMode === "dark" ? "bg-[#0d1117] backdrop-blur-sm border border-border-primary/50 hover:border-accent/40 focus-within:border-accent/60" : "bg-white/95 backdrop-blur-sm border border-gray-200/80 hover:border-violet-300/60 focus-within:border-violet-400/70"),
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex w-full"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex-1 relative"
  }, /*#__PURE__*/react.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      handleSubmit();
    },
    className: "relative w-full"
  }, enable_upload && /*#__PURE__*/react.createElement("div", {
    className: "absolute left-4 top-1/2 transform -translate-y-1/2 z-10 " + (isInputDisabled ? "pointer-events-none opacity-50" : "")
  }, /*#__PURE__*/react.createElement("input", {
    ref: attachFileInputRef,
    type: "file",
    multiple: true,
    className: "hidden",
    "aria-hidden": true,
    onChange: handleAttachFileInputChange
  }), /*#__PURE__*/react.createElement(dropdown/* default */.A, {
    overlay: /*#__PURE__*/react.createElement(menu/* default */.A, {
      className: darkMode === "dark" ? "dark-menu" : ""
    }, /*#__PURE__*/react.createElement(menu/* default */.A.Item, {
      key: "attach-file",
      onClick: _ref3 => {
        let {
          domEvent
        } = _ref3;
        domEvent === null || domEvent === void 0 ? void 0 : domEvent.preventDefault();
        domEvent === null || domEvent === void 0 ? void 0 : domEvent.stopPropagation();
        if (!isInputDisabled) {
          var _attachFileInputRef$c;
          (_attachFileInputRef$c = attachFileInputRef.current) === null || _attachFileInputRef$c === void 0 ? void 0 : _attachFileInputRef$c.click();
        }
      }
    }, /*#__PURE__*/react.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/react.createElement(Paperclip, {
      className: "w-4 h-4 flex-shrink-0 " + (darkMode === "dark" ? "text-gray-300" : "text-magenta-600")
    }), /*#__PURE__*/react.createElement("span", {
      className: darkMode === "dark" ? "text-gray-300" : "text-magenta-600"
    }, "Attach File"))), /*#__PURE__*/react.createElement(menu/* default */.A.Item, {
      key: "attach-skill",
      onClick: _ref4 => {
        let {
          domEvent
        } = _ref4;
        domEvent === null || domEvent === void 0 ? void 0 : domEvent.preventDefault();
        domEvent === null || domEvent === void 0 ? void 0 : domEvent.stopPropagation();
        openSkillAttachModal();
      }
    }, /*#__PURE__*/react.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/react.createElement(wrench/* default */.A, {
      className: "w-4 h-4 flex-shrink-0 " + (darkMode === "dark" ? "text-gray-300" : "text-magenta-600")
    }), /*#__PURE__*/react.createElement("span", {
      className: darkMode === "dark" ? "text-gray-300" : "text-magenta-600"
    }, "Attach Skill"))), /*#__PURE__*/react.createElement(menu/* default */.A.SubMenu, {
      key: "llm-options",
      title: /*#__PURE__*/react.createElement("span", {
        className: darkMode === "dark" ? "text-gray-300" : "text-magenta-600"
      }, "Agent Mode"),
      icon: /*#__PURE__*/react.createElement(bot/* default */.A, {
        className: "w-4 h-4 flex-shrink-0 " + (darkMode === "dark" ? "text-gray-300" : "text-magenta-600")
      })
    }, llmList.length === 0 ? /*#__PURE__*/react.createElement(menu/* default */.A.Item, {
      disabled: true,
      key: "no-llm-options",
      className: darkMode === "dark" ? "text-gray-500" : ""
    }, /*#__PURE__*/react.createElement("span", {
      className: darkMode === "dark" ? "text-gray-500" : ""
    }, "No Agent Mode")) : llmList.map(llm => /*#__PURE__*/react.createElement(menu/* default */.A.Item, {
      key: llm.value,
      onClick: () => {
        handleLLMSelect(llm);
      },
      className: darkMode === "dark" ? "text-gray-300 hover:text-white" : ""
    }, /*#__PURE__*/react.createElement("span", {
      className: "flex w-full items-center justify-between"
    }, /*#__PURE__*/react.createElement("span", {
      className: darkMode === "dark" ? "text-gray-300" : ""
    }, llm.label), llm.label === selectedLlmLabel && /*#__PURE__*/react.createElement("span", {
      className: "ml-2 text-green-500 font-bold"
    }, "\u221A")))))),
    trigger: ["click"]
  }, /*#__PURE__*/react.createElement(tooltip/* default */.A, {
    title: /*#__PURE__*/react.createElement("span", {
      className: "text-sm"
    }, (() => {
      const n = fileList.length;
      const m = attachedSkills.length;
      if (n + m === 0) return "Attach File";
      const parts = [];
      if (n) parts.push(n + " \u4E2A\u6587\u4EF6");
      if (m) parts.push(m + " \u4E2A\u6280\u80FD\u5305");
      return parts.join("，");
    })()),
    placement: "top"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    disabled: isInputDisabled,
    className: "flex justify-center items-center w-8 h-8 rounded-xl transition-smooth hover-lift relative " + (fileList.length + attachedSkills.length > 0 ? "text-accent bg-accent/10" : darkMode === "dark" ? "text-secondary hover:text-accent hover:bg-accent/10" : "text-secondary hover:text-accent hover:bg-accent/10")
  }, /*#__PURE__*/react.createElement(plus/* default */.A, {
    className: "h-4 w-4"
  }), fileList.length + attachedSkills.length > 0 && /*#__PURE__*/react.createElement("span", {
    className: "absolute -top-1 -right-1 bg-accent text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-bounce-in"
  }, fileList.length + attachedSkills.length))))), /*#__PURE__*/react.createElement("textarea", {
    id: "queryInput",
    name: "queryInput",
    onPaste: e => handlePaste(e, textAreaRef, setText),
    ref: textAreaRef,
    defaultValue: "",
    onChange: handleTextChange,
    onKeyDown: handleKeyDown,
    className: "input-enhanced chat-input-scrollbar-hide flex items-center w-full resize-none p-4 " + (enable_upload ? "pl-14" : "pl-6") + " " + (runStatus === "active" ? "pr-36" : "pr-28") + " rounded-[28px] transition-smooth border-0 bg-transparent " + (isInputDisabled ? "cursor-not-allowed opacity-50" : "") + " focus:outline-none",
    style: {
      maxHeight: "120px",
      overflowY: "auto",
      minHeight: "52px"
    },
    placeholder: runStatus === "awaiting_input" ? "Type your response here..." : enable_upload ? dragOver ? "Drop files here..." : "Type your message here..." : "Type your message here...",
    disabled: isInputDisabled
  }), /*#__PURE__*/react.createElement("div", {
    className: "absolute right-2 bottom-2 flex items-center space-x-2"
  }, text.trim().length > 0 && !isInputDisabled && /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: clearText,
    className: "rounded-full flex justify-center items-center h-8 transition-smooth hover-lift text-secondary hover:text-accent hover:bg-accent/10",
    "aria-label": "Clear input"
  }, /*#__PURE__*/react.createElement(esm_XMarkIcon, {
    className: "h-4 w-4"
  })), (runStatus === "active" || runStatus === "connected" || runStatus === "created") && /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: handlePause,
    className: "rounded-full flex justify-center items-center w-10 h-10 transition-smooth hover-lift " + (darkMode === "dark" ? "bg-warning-primary/20 hover:bg-warning-primary/30 text-warning-primary" : "bg-warning-primary/10 hover:bg-warning-primary/20 text-warning-primary") + " shadow-modern"
  }, /*#__PURE__*/react.createElement(esm_PauseCircleIcon, {
    className: "h-5 w-5"
  })), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: handleSubmit,
    disabled: isInputDisabled,
    className: "transition-smooth rounded-full flex justify-center items-center w-10 h-10 " + (isInputDisabled ? "cursor-not-allowed opacity-50 bg-gray-400" : darkMode === "dark" ? "bg-gradient-primary hover:shadow-modern-lg text-white hover-lift pulse-glow" : "bg-gradient-primary hover:shadow-modern-lg text-white hover-lift pulse-glow")
  }, /*#__PURE__*/react.createElement(esm_PaperAirplaneIcon, {
    className: "h-5 w-5 transform -rotate-45"
  })))))))), error && !error.status && /*#__PURE__*/react.createElement("div", {
    className: "p-2 border rounded mt-4 text-sm " + (darkMode === "dark" ? "border-orange-500/30 text-orange-400 bg-orange-500/10" : "border-orange-300 text-orange-600 bg-orange-50")
  }, /*#__PURE__*/react.createElement(esm_ExclamationTriangleIcon, {
    className: "h-5 inline-block mr-2 " + (darkMode === "dark" ? "text-orange-400" : "text-orange-600")
  }), error.message));
});
/* harmony default export */ var chatinput = (ChatInput);

/***/ }),

/***/ 41025:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Q: function() { return /* binding */ useModeConfigStore; }
/* harmony export */ });
/* harmony import */ var zustand__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(71511);
/* harmony import */ var zustand_middleware__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(87134);
/* harmony import */ var _components_views_api__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(39614);
/* harmony import */ var _components_utils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(70870);
/* harmony import */ var _utils_agentPreference__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(12708);
const useModeConfigStore=(0,zustand__WEBPACK_IMPORTED_MODULE_2__/* .create */ .v)()((0,zustand_middleware__WEBPACK_IMPORTED_MODULE_3__/* .persist */ .Zr)(set=>({mode:"",setMode:mode=>set({mode}),config:{},setConfig:config=>set({config}),selectedAgent:null,setSelectedAgent:selectedAgent=>set({selectedAgent}),lastSelectedAgentMode:"",setLastSelectedAgentMode:mode=>set({lastSelectedAgentMode:mode}),// update by yqsun
agentId:null,setAgentId:agentId=>set({agentId}),agentInfo:null,setAgentInfo:agentInfo=>set({agentInfo}),agentOfflineSnapshot:false,setAgentOfflineSnapshot:agentOfflineSnapshot=>set({agentOfflineSnapshot})}),{name:"drsai-mode-config",storage:(0,zustand_middleware__WEBPACK_IMPORTED_MODULE_3__/* .createJSONStorage */ .KU)(()=>localStorage),// 刷新后恢复上次选中：持久化 agentId；mode 在 id 失效时作为备选匹配
partialize:state=>({agentId:state.agentId,mode:state.mode}),// 注意：recentAgents 仅用于 UI 展示，不应覆盖“默认智能体”选择。
// 否则一旦 recent[0] 恰好是历史遗留的 builtin（如 eab8...），会把用户显式默认顶掉。
onRehydrateStorage:()=>state=>{if(!state)return;const{agentId}=useModeConfigStore.getState();if(agentId)return;const userId=(0,_components_utils__WEBPACK_IMPORTED_MODULE_1__/* .getLocalStorage */ .Lg)("user_email",false);if(!userId)return;void Promise.all([_components_views_api__WEBPACK_IMPORTED_MODULE_0__/* .agentWorkerAPI */ .Ml.getUserDefaultAgents(userId).then(r=>(r===null||r===void 0?void 0:r.data)||[]),_components_views_api__WEBPACK_IMPORTED_MODULE_0__/* .organizationsAPI */ .PB.getMyOrg(userId).catch(()=>null),_components_views_api__WEBPACK_IMPORTED_MODULE_0__/* .agentWorkerAPI */ .Ml.getUserDefaultAgent(userId).catch(()=>null)]).then(_ref=>{var _userDefault$stored_d;let[agents,myOrg,userDefault]=_ref;const orgDefault=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;// Only treat explicitly stored default as personal preference.
const userDefaultId=(_userDefault$stored_d=userDefault===null||userDefault===void 0?void 0:userDefault.stored_default_agent_id)!==null&&_userDefault$stored_d!==void 0?_userDefault$stored_d:null;const preferred=(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_4__/* .pickLoginDefaultAgent */ .T)(agents||[],orgDefault,userDefaultId);const id=preferred===null||preferred===void 0?void 0:preferred.id;if(!id||typeof id!=="string")return;const{agentId:cur,setAgentId:setId}=useModeConfigStore.getState();if(!cur){setId(id);}}).catch(err=>{console.warn("获取 agent 列表失败，无法设置默认 agentId:",err);});}}));

/***/ }),

/***/ 12708:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   T: function() { return /* binding */ pickLoginDefaultAgent; },
/* harmony export */   W: function() { return /* binding */ pickPreferredAgentFromList; }
/* harmony export */ });
/**
 * 排除内部占位 mode，优先 is_default，其次 featured，最后列表首项。
 */function pickPreferredAgentFromList(agents){if(!(agents!==null&&agents!==void 0&&agents.length))return undefined;const baseList=agents.filter(a=>a.mode!=="magentic-one"&&a.mode!=="besiii");const byDefault=baseList.find(a=>a.is_default);if(byDefault!==null&&byDefault!==void 0&&byDefault.id)return byDefault;const featured=baseList.find(a=>a.featured);if(featured!==null&&featured!==void 0&&featured.id)return featured;return agents[0];}/**
 * 登录后默认智能体选择优先级（完全来自 DB，无硬编码内置）：
 * 1. 用户在后端设置的 default_agent_id（如果传入且在列表中存在）
 * 2. 组织级别的 default_agent_id
 * 3. 列表中标记 is_default 的
 * 4. pickPreferredAgentFromList 兜底（featured / 首项）
 */function pickLoginDefaultAgent(agents,orgDefaultAgentId,userDefaultAgentId){if(!(agents!==null&&agents!==void 0&&agents.length))return undefined;const uid=(userDefaultAgentId||"").trim();if(uid){const userHit=agents.find(a=>a.id===uid);if(userHit)return userHit;}const oid=(orgDefaultAgentId||"").trim();if(oid){const orgHit=agents.find(a=>a.id===oid);if(orgHit)return orgHit;}const byDefault=agents.find(a=>a.is_default);if(byDefault!==null&&byDefault!==void 0&&byDefault.id)return byDefault;return pickPreferredAgentFromList(agents);}

/***/ }),

/***/ 51873:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var root = __webpack_require__(9325);

/** Built-in value references. */
var Symbol = root.Symbol;

module.exports = Symbol;


/***/ }),

/***/ 72552:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var Symbol = __webpack_require__(51873),
    getRawTag = __webpack_require__(659),
    objectToString = __webpack_require__(59350);

/** `Object#toString` result references. */
var nullTag = '[object Null]',
    undefinedTag = '[object Undefined]';

/** Built-in value references. */
var symToStringTag = Symbol ? Symbol.toStringTag : undefined;

/**
 * The base implementation of `getTag` without fallbacks for buggy environments.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */
function baseGetTag(value) {
  if (value == null) {
    return value === undefined ? undefinedTag : nullTag;
  }
  return (symToStringTag && symToStringTag in Object(value))
    ? getRawTag(value)
    : objectToString(value);
}

module.exports = baseGetTag;


/***/ }),

/***/ 54128:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var trimmedEndIndex = __webpack_require__(31800);

/** Used to match leading whitespace. */
var reTrimStart = /^\s+/;

/**
 * The base implementation of `_.trim`.
 *
 * @private
 * @param {string} string The string to trim.
 * @returns {string} Returns the trimmed string.
 */
function baseTrim(string) {
  return string
    ? string.slice(0, trimmedEndIndex(string) + 1).replace(reTrimStart, '')
    : string;
}

module.exports = baseTrim;


/***/ }),

/***/ 34840:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

/** Detect free variable `global` from Node.js. */
var freeGlobal = typeof __webpack_require__.g == 'object' && __webpack_require__.g && __webpack_require__.g.Object === Object && __webpack_require__.g;

module.exports = freeGlobal;


/***/ }),

/***/ 659:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var Symbol = __webpack_require__(51873);

/** Used for built-in method references. */
var objectProto = Object.prototype;

/** Used to check objects for own properties. */
var hasOwnProperty = objectProto.hasOwnProperty;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString = objectProto.toString;

/** Built-in value references. */
var symToStringTag = Symbol ? Symbol.toStringTag : undefined;

/**
 * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the raw `toStringTag`.
 */
function getRawTag(value) {
  var isOwn = hasOwnProperty.call(value, symToStringTag),
      tag = value[symToStringTag];

  try {
    value[symToStringTag] = undefined;
    var unmasked = true;
  } catch (e) {}

  var result = nativeObjectToString.call(value);
  if (unmasked) {
    if (isOwn) {
      value[symToStringTag] = tag;
    } else {
      delete value[symToStringTag];
    }
  }
  return result;
}

module.exports = getRawTag;


/***/ }),

/***/ 59350:
/***/ (function(module) {

/** Used for built-in method references. */
var objectProto = Object.prototype;

/**
 * Used to resolve the
 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
 * of values.
 */
var nativeObjectToString = objectProto.toString;

/**
 * Converts `value` to a string using `Object.prototype.toString`.
 *
 * @private
 * @param {*} value The value to convert.
 * @returns {string} Returns the converted string.
 */
function objectToString(value) {
  return nativeObjectToString.call(value);
}

module.exports = objectToString;


/***/ }),

/***/ 9325:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var freeGlobal = __webpack_require__(34840);

/** Detect free variable `self`. */
var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

/** Used as a reference to the global object. */
var root = freeGlobal || freeSelf || Function('return this')();

module.exports = root;


/***/ }),

/***/ 31800:
/***/ (function(module) {

/** Used to match a single whitespace character. */
var reWhitespace = /\s/;

/**
 * Used by `_.trim` and `_.trimEnd` to get the index of the last non-whitespace
 * character of `string`.
 *
 * @private
 * @param {string} string The string to inspect.
 * @returns {number} Returns the index of the last non-whitespace character.
 */
function trimmedEndIndex(string) {
  var index = string.length;

  while (index-- && reWhitespace.test(string.charAt(index))) {}
  return index;
}

module.exports = trimmedEndIndex;


/***/ }),

/***/ 38221:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var isObject = __webpack_require__(23805),
    now = __webpack_require__(10124),
    toNumber = __webpack_require__(99374);

/** Error message constants. */
var FUNC_ERROR_TEXT = 'Expected a function';

/* Built-in method references for those with the same name as other `lodash` methods. */
var nativeMax = Math.max,
    nativeMin = Math.min;

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was
 * invoked. The debounced function comes with a `cancel` method to cancel
 * delayed `func` invocations and a `flush` method to immediately invoke them.
 * Provide `options` to indicate whether `func` should be invoked on the
 * leading and/or trailing edge of the `wait` timeout. The `func` is invoked
 * with the last arguments provided to the debounced function. Subsequent
 * calls to the debounced function return the result of the last `func`
 * invocation.
 *
 * **Note:** If `leading` and `trailing` options are `true`, `func` is
 * invoked on the trailing edge of the timeout only if the debounced function
 * is invoked more than once during the `wait` timeout.
 *
 * If `wait` is `0` and `leading` is `false`, `func` invocation is deferred
 * until to the next tick, similar to `setTimeout` with a timeout of `0`.
 *
 * See [David Corbacho's article](https://css-tricks.com/debouncing-throttling-explained-examples/)
 * for details over the differences between `_.debounce` and `_.throttle`.
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Function
 * @param {Function} func The function to debounce.
 * @param {number} [wait=0] The number of milliseconds to delay.
 * @param {Object} [options={}] The options object.
 * @param {boolean} [options.leading=false]
 *  Specify invoking on the leading edge of the timeout.
 * @param {number} [options.maxWait]
 *  The maximum time `func` is allowed to be delayed before it's invoked.
 * @param {boolean} [options.trailing=true]
 *  Specify invoking on the trailing edge of the timeout.
 * @returns {Function} Returns the new debounced function.
 * @example
 *
 * // Avoid costly calculations while the window size is in flux.
 * jQuery(window).on('resize', _.debounce(calculateLayout, 150));
 *
 * // Invoke `sendMail` when clicked, debouncing subsequent calls.
 * jQuery(element).on('click', _.debounce(sendMail, 300, {
 *   'leading': true,
 *   'trailing': false
 * }));
 *
 * // Ensure `batchLog` is invoked once after 1 second of debounced calls.
 * var debounced = _.debounce(batchLog, 250, { 'maxWait': 1000 });
 * var source = new EventSource('/stream');
 * jQuery(source).on('message', debounced);
 *
 * // Cancel the trailing debounced invocation.
 * jQuery(window).on('popstate', debounced.cancel);
 */
function debounce(func, wait, options) {
  var lastArgs,
      lastThis,
      maxWait,
      result,
      timerId,
      lastCallTime,
      lastInvokeTime = 0,
      leading = false,
      maxing = false,
      trailing = true;

  if (typeof func != 'function') {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  wait = toNumber(wait) || 0;
  if (isObject(options)) {
    leading = !!options.leading;
    maxing = 'maxWait' in options;
    maxWait = maxing ? nativeMax(toNumber(options.maxWait) || 0, wait) : maxWait;
    trailing = 'trailing' in options ? !!options.trailing : trailing;
  }

  function invokeFunc(time) {
    var args = lastArgs,
        thisArg = lastThis;

    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }

  function leadingEdge(time) {
    // Reset any `maxWait` timer.
    lastInvokeTime = time;
    // Start the timer for the trailing edge.
    timerId = setTimeout(timerExpired, wait);
    // Invoke the leading edge.
    return leading ? invokeFunc(time) : result;
  }

  function remainingWait(time) {
    var timeSinceLastCall = time - lastCallTime,
        timeSinceLastInvoke = time - lastInvokeTime,
        timeWaiting = wait - timeSinceLastCall;

    return maxing
      ? nativeMin(timeWaiting, maxWait - timeSinceLastInvoke)
      : timeWaiting;
  }

  function shouldInvoke(time) {
    var timeSinceLastCall = time - lastCallTime,
        timeSinceLastInvoke = time - lastInvokeTime;

    // Either this is the first call, activity has stopped and we're at the
    // trailing edge, the system time has gone backwards and we're treating
    // it as the trailing edge, or we've hit the `maxWait` limit.
    return (lastCallTime === undefined || (timeSinceLastCall >= wait) ||
      (timeSinceLastCall < 0) || (maxing && timeSinceLastInvoke >= maxWait));
  }

  function timerExpired() {
    var time = now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    // Restart the timer.
    timerId = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time) {
    timerId = undefined;

    // Only invoke if we have `lastArgs` which means `func` has been
    // debounced at least once.
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = undefined;
    return result;
  }

  function cancel() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timerId = undefined;
  }

  function flush() {
    return timerId === undefined ? result : trailingEdge(now());
  }

  function debounced() {
    var time = now(),
        isInvoking = shouldInvoke(time);

    lastArgs = arguments;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        return leadingEdge(lastCallTime);
      }
      if (maxing) {
        // Handle invocations in a tight loop.
        clearTimeout(timerId);
        timerId = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }
    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }
  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced;
}

module.exports = debounce;


/***/ }),

/***/ 23805:
/***/ (function(module) {

/**
 * Checks if `value` is the
 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @since 0.1.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(_.noop);
 * // => true
 *
 * _.isObject(null);
 * // => false
 */
function isObject(value) {
  var type = typeof value;
  return value != null && (type == 'object' || type == 'function');
}

module.exports = isObject;


/***/ }),

/***/ 40346:
/***/ (function(module) {

/**
 * Checks if `value` is object-like. A value is object-like if it's not `null`
 * and has a `typeof` result of "object".
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 * @example
 *
 * _.isObjectLike({});
 * // => true
 *
 * _.isObjectLike([1, 2, 3]);
 * // => true
 *
 * _.isObjectLike(_.noop);
 * // => false
 *
 * _.isObjectLike(null);
 * // => false
 */
function isObjectLike(value) {
  return value != null && typeof value == 'object';
}

module.exports = isObjectLike;


/***/ }),

/***/ 44394:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var baseGetTag = __webpack_require__(72552),
    isObjectLike = __webpack_require__(40346);

/** `Object#toString` result references. */
var symbolTag = '[object Symbol]';

/**
 * Checks if `value` is classified as a `Symbol` primitive or object.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a symbol, else `false`.
 * @example
 *
 * _.isSymbol(Symbol.iterator);
 * // => true
 *
 * _.isSymbol('abc');
 * // => false
 */
function isSymbol(value) {
  return typeof value == 'symbol' ||
    (isObjectLike(value) && baseGetTag(value) == symbolTag);
}

module.exports = isSymbol;


/***/ }),

/***/ 10124:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var root = __webpack_require__(9325);

/**
 * Gets the timestamp of the number of milliseconds that have elapsed since
 * the Unix epoch (1 January 1970 00:00:00 UTC).
 *
 * @static
 * @memberOf _
 * @since 2.4.0
 * @category Date
 * @returns {number} Returns the timestamp.
 * @example
 *
 * _.defer(function(stamp) {
 *   console.log(_.now() - stamp);
 * }, _.now());
 * // => Logs the number of milliseconds it took for the deferred invocation.
 */
var now = function() {
  return root.Date.now();
};

module.exports = now;


/***/ }),

/***/ 99374:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var baseTrim = __webpack_require__(54128),
    isObject = __webpack_require__(23805),
    isSymbol = __webpack_require__(44394);

/** Used as references for various `Number` constants. */
var NAN = 0 / 0;

/** Used to detect bad signed hexadecimal string values. */
var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;

/** Used to detect binary string values. */
var reIsBinary = /^0b[01]+$/i;

/** Used to detect octal string values. */
var reIsOctal = /^0o[0-7]+$/i;

/** Built-in method references without a dependency on `root`. */
var freeParseInt = parseInt;

/**
 * Converts `value` to a number.
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to process.
 * @returns {number} Returns the number.
 * @example
 *
 * _.toNumber(3.2);
 * // => 3.2
 *
 * _.toNumber(Number.MIN_VALUE);
 * // => 5e-324
 *
 * _.toNumber(Infinity);
 * // => Infinity
 *
 * _.toNumber('3.2');
 * // => 3.2
 */
function toNumber(value) {
  if (typeof value == 'number') {
    return value;
  }
  if (isSymbol(value)) {
    return NAN;
  }
  if (isObject(value)) {
    var other = typeof value.valueOf == 'function' ? value.valueOf() : value;
    value = isObject(other) ? (other + '') : other;
  }
  if (typeof value != 'string') {
    return value === 0 ? value : +value;
  }
  value = baseTrim(value);
  var isBinary = reIsBinary.test(value);
  return (isBinary || reIsOctal.test(value))
    ? freeParseInt(value.slice(2), isBinary ? 2 : 8)
    : (reIsBadHex.test(value) ? NAN : +value);
}

module.exports = toNumber;


/***/ }),

/***/ 42640:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Bot; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Bot = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Bot", [
  ["path", { d: "M12 8V4H8", key: "hb8ula" }],
  ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2", key: "enze0r" }],
  ["path", { d: "M2 14h2", key: "vft8re" }],
  ["path", { d: "M20 14h2", key: "4cs60a" }],
  ["path", { d: "M15 13v2", key: "1xurst" }],
  ["path", { d: "M9 13v2", key: "rq6x2g" }]
]);


//# sourceMappingURL=bot.js.map


/***/ }),

/***/ 80827:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ FileText; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const FileText = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("FileText", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M10 9H8", key: "b1mrlr" }],
  ["path", { d: "M16 13H8", key: "t4e002" }],
  ["path", { d: "M16 17H8", key: "z1uh3a" }]
]);


//# sourceMappingURL=file-text.js.map


/***/ }),

/***/ 59612:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Image; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Image = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Image", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2", key: "1m3agn" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", key: "1xmnt7" }]
]);


//# sourceMappingURL=image.js.map


/***/ }),

/***/ 94796:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Upload; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Upload = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Upload", [
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["polyline", { points: "17 8 12 3 7 8", key: "t8dd8p" }],
  ["line", { x1: "12", x2: "12", y1: "3", y2: "15", key: "widbto" }]
]);


//# sourceMappingURL=upload.js.map


/***/ }),

/***/ 46816:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Wrench; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Wrench = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Wrench", [
  [
    "path",
    {
      d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
      key: "cbrjhi"
    }
  ]
]);


//# sourceMappingURL=wrench.js.map


/***/ }),

/***/ 48697:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ X; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const X = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);


//# sourceMappingURL=x.js.map


/***/ })

}]);
//# sourceMappingURL=a7f27c9f01bec1948bbff7d96da2bd2be2883032-502681bb3ade1859f228.js.map