"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[9857],{

/***/ 34047:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ approval_buttons; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/circle-check-big.js
var circle_check_big = __webpack_require__(44471);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/circle-x.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CircleX = (0,createLucideIcon/* default */.A)("CircleX", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m15 9-6 6", key: "1uzhvr" }],
  ["path", { d: "m9 9 6 6", key: "z0biqf" }]
]);


//# sourceMappingURL=circle-x.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/rotate-cw.js
var rotate_cw = __webpack_require__(85265);
;// ./src/pages/chat/approval_buttons.tsx


const ApprovalButtons = _ref => {
  let {
    status,
    inputRequest,
    isPlanMessage,
    onApprove,
    onDeny,
    onAcceptPlan,
    onRegeneratePlan
  } = _ref;
  const [planAcceptText, setPlanAcceptText] = react.useState("");
  if (status !== "awaiting_input") {
    return null;
  }
  return /*#__PURE__*/react.createElement("div", {
    className: "flex gap-2 justify-start"
  }, (inputRequest === null || inputRequest === void 0 ? void 0 : inputRequest.input_type) === "approval" ? /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onApprove,
    className: "bg-green-500 hover:bg-green-600 text-white rounded flex justify-center items-center px-2 py-1.5 transition duration-300"
  }, /*#__PURE__*/react.createElement(circle_check_big/* default */.A, {
    className: "h-5 w-5 mr-1"
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm mr-1"
  }, "Approve")), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onDeny,
    className: "bg-red-500 hover:bg-red-600 text-white rounded flex justify-center items-center px-2 py-1.5 transition duration-300"
  }, /*#__PURE__*/react.createElement(CircleX, {
    className: "h-5 w-5 mr-1"
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm mr-1"
  }, "Reject"))) :
  // Plan acceptance buttons
  isPlanMessage && /*#__PURE__*/react.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: () => onAcceptPlan === null || onAcceptPlan === void 0 ? void 0 : onAcceptPlan(planAcceptText),
    className: "bg-green-500 hover:bg-green-600 text-white rounded flex justify-center items-center px-2 py-1.5 transition duration-300"
  }, /*#__PURE__*/react.createElement(circle_check_big/* default */.A, {
    className: "h-5 w-5 mr-1"
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm mr-1"
  }, "Accept Plan")), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onRegeneratePlan,
    className: "bg-magenta-800 hover:bg-magenta-900 text-white rounded flex justify-center items-center px-2 py-1.5 transition duration-300"
  }, /*#__PURE__*/react.createElement(rotate_cw/* default */.A, {
    className: "h-5 w-5 mr-1"
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm mr-1"
  }, "Generate New Plan"))));
};
/* harmony default export */ var approval_buttons = (ApprovalButtons);

/***/ }),

/***/ 96850:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ runview; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/react-dom/index.js
var react_dom = __webpack_require__(40961);
// EXTERNAL MODULE: ./src/pages/chat/rendermessage.tsx + 9 modules
var rendermessage = __webpack_require__(27977);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/loader-circle.js
var loader_circle = __webpack_require__(8723);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/circle-help.js
var circle_help = __webpack_require__(64997);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/message-square.js
var message_square = __webpack_require__(47504);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/triangle-alert.js
var triangle_alert = __webpack_require__(418);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/circle-stop.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CircleStop = (0,createLucideIcon/* default */.A)("CircleStop", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["rect", { x: "9", y: "9", width: "6", height: "6", rx: "1", key: "1ssd4o" }]
]);


//# sourceMappingURL=circle-stop.js.map

;// ./node_modules/lucide-react/dist/esm/icons/circle-pause.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CirclePause = (0,createLucideIcon/* default */.A)("CirclePause", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "10", x2: "10", y1: "15", y2: "9", key: "c1nkhi" }],
  ["line", { x1: "14", x2: "14", y1: "15", y2: "9", key: "h65svq" }]
]);


//# sourceMappingURL=circle-pause.js.map

;// ./src/components/views/statusicon.tsx
const getStatusIcon=(status,errorMessage,stopReason,inputRequest)=>{switch(status){case"active":return/*#__PURE__*/react.createElement("div",{className:"inline-block mr-1"},/*#__PURE__*/react.createElement(loader_circle/* default */.A,{size:20,className:"inline-block mr-1 text-accent animate-spin"}),/*#__PURE__*/react.createElement("span",{className:"inline-block mr-2 ml-1 "},"Processing"));case"awaiting_input":const Icon=(inputRequest===null||inputRequest===void 0?void 0:inputRequest.input_type)==="approval"?circle_help/* default */.A:message_square/* default */.A;return/*#__PURE__*/react.createElement("div",{className:"flex items-center text-sm mb-2"},(inputRequest===null||inputRequest===void 0?void 0:inputRequest.input_type)==="approval"?/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("div",{className:"flex items-center"},/*#__PURE__*/react.createElement("span",null,/*#__PURE__*/react.createElement("span",{className:"font-semibold"},"Approval Request:")," ",inputRequest.prompt||"Waiting for approval"))):/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(message_square/* default */.A,{size:20,className:"flex-shrink-0 mr-2 text-accent"}),/*#__PURE__*/react.createElement("span",{className:"flex-1"},"Waiting for your input")));case"complete":return/*#__PURE__*/react.createElement("div",{className:"text-sm mb-2"},/*#__PURE__*/react.createElement(triangle_alert/* default */.A,{size:20,className:"inline-block mr-2 text-red-500"}),errorMessage||"An error occurred");case"error":return/*#__PURE__*/react.createElement("div",{className:"text-sm mb-2"},/*#__PURE__*/react.createElement(triangle_alert/* default */.A,{size:20,className:"inline-block mr-2 text-red-500"}),errorMessage||"An error occurred");case"stopped":return/*#__PURE__*/react.createElement("div",{className:"text-sm mb-2"},/*#__PURE__*/react.createElement(CircleStop,{size:20,className:"inline-block mr-2 text-red-500"}),"Task was stopped: ",stopReason);case"pausing":return/*#__PURE__*/react.createElement("div",{className:"text-sm mb-2"},/*#__PURE__*/react.createElement(loader_circle/* default */.A,{size:20,className:"inline-block mr-2 text-accent animate-spin"}),/*#__PURE__*/react.createElement("span",{className:"inline-block mr-2 ml-1"},"Pausing"));case"paused":return/*#__PURE__*/react.createElement("div",{className:"text-sm mb-2"},/*#__PURE__*/react.createElement(CirclePause,{size:20,className:"inline-block mr-2 text-accent"}),/*#__PURE__*/react.createElement("span",{className:"inline-block mr-2 ml-1"},"Paused"));case"resuming":return/*#__PURE__*/react.createElement("div",{className:"text-sm mb-2"},/*#__PURE__*/react.createElement(loader_circle/* default */.A,{size:20,className:"inline-block mr-2 text-accent animate-spin"}),/*#__PURE__*/react.createElement("span",{className:"inline-block mr-2 ml-1"},"Resuming"));default:return null;}};// SessionRunStatusIndicator: for sidebar session status
const SessionRunStatusIndicator=_ref=>{let{status}=_ref;switch(status){case"awaiting_input":return/*#__PURE__*/React.createElement("div",{className:"w-2 h-2 rounded-full bg-red-500 animate-pulse"});case"active":return/*#__PURE__*/React.createElement(Loader2,{className:"w-3 h-3 animate-spin text-accent"});case"final_answer_awaiting_input":return/*#__PURE__*/React.createElement(CheckCircle,{className:"w-3 h-3 text-green-500"});case"error":return/*#__PURE__*/React.createElement(AlertTriangle,{className:"w-3 h-3 text-red-500"});default:return null;}};
// EXTERNAL MODULE: ./src/pages/chat/approval_buttons.tsx + 1 modules
var approval_buttons = __webpack_require__(34047);
// EXTERNAL MODULE: ./src/pages/chat/chat/chatinput.tsx + 21 modules
var chatinput = __webpack_require__(71127);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutPropertiesLoose.js
var objectWithoutPropertiesLoose = __webpack_require__(98587);
// EXTERNAL MODULE: ./src/pages/chat/detail_viewer.tsx + 2 modules
var detail_viewer = __webpack_require__(14764);
;// ./src/pages/chat/panels/VNCPanel.tsx
/**
 * VNCPanel - VNC 浏览器预览面板
 * 
 * 这是 DetailViewer 的包装组件，用于 magentic-one agent 的浏览器预览功能
 * 包含两个标签页：
 * 1. Screenshots - 浏览器截图历史
 * 2. Live View - VNC 实时浏览器预览
 *//**
 * VNCPanel 组件
 * 
 * 目前直接使用 DetailViewer 实现
 * 未来可以根据需要进行定制化修改
 */const VNCPanel=props=>{return/*#__PURE__*/react.createElement("div",{className:"h-full"},/*#__PURE__*/react.createElement(detail_viewer["default"],props));};/* harmony default export */ var panels_VNCPanel = (VNCPanel);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/circle-check-big.js
var circle_check_big = __webpack_require__(44471);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/clock.js
var clock = __webpack_require__(27235);
;// ./node_modules/lucide-react/dist/esm/icons/circle.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Circle = (0,createLucideIcon/* default */.A)("Circle", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]
]);


//# sourceMappingURL=circle.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/check.js
var check = __webpack_require__(45773);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
;// ./src/pages/chat/panels/BESIIIPanel.tsx
/**
 * BESIII Panel - 用于显示 BESIII Agent 的任务执行状态
 * 
 * 功能：
 * 1. 全局任务执行 - 总览
 * 2. Files - 文件列表和下载
 * 3. Terminal - 终端输出
 *//** Shown first; only these keys are treated as read-only. */const GLOBAL_INFO_READ_ONLY_ORDER=["taskName","root_path"];const GLOBAL_INFO_READ_ONLY_SET=new Set(GLOBAL_INFO_READ_ONLY_ORDER);/** Inline keyframes so idle animation always applies (Tailwind JIT 有时未生成自定义 animate-*). */const BESIII_IDLE_KEYFRAMES="\n@keyframes besiii-idle-wave {\n  0%, 100% { transform: scaleY(0.35); }\n  50% { transform: scaleY(1); }\n}\n@keyframes besiii-idle-glow {\n  0%, 100% { opacity: 0.22; }\n  50% { opacity: 0.5; }\n}\n";const BESIIIPanel=_ref=>{var _logs$length;let{tasks=[],terminalOutput='',logs=[],fileEvents:_fileEvents=[],serverGlobalInfo=null,onMinimize,onInputResponse,activeTab:controlledActiveTab,onTabChange}=_ref;const{darkMode}=react.useContext(provider/* appContext */.v);const{0:internalActiveTab,1:setInternalActiveTab}=(0,react.useState)('global_info');// 使用受控的 activeTab（如果提供），否则使用内部状态
const activeTab=controlledActiveTab!==undefined?controlledActiveTab:internalActiveTab;const setActiveTab=(0,react.useCallback)(tab=>{if(onTabChange){onTabChange(tab);}else{setInternalActiveTab(tab);}},[onTabChange]);/** 与 runview 中 global_info / run.logs / besiii_terminal 的约定一致：无数据则不挂载对应 tab。 */const hasGlobalInfoTab=Boolean((serverGlobalInfo===null||serverGlobalInfo===void 0?void 0:serverGlobalInfo.fields)&&Object.keys(serverGlobalInfo.fields).length>0);const hasLogsTab=((_logs$length=logs===null||logs===void 0?void 0:logs.length)!==null&&_logs$length!==void 0?_logs$length:0)>0;const hasTerminalTab=terminalOutput.trim().length>0;const visibleTabs=(0,react.useMemo)(()=>{const t=[];if(hasGlobalInfoTab)t.push({id:"global_info",label:"Global Info"});if(hasLogsTab)t.push({id:"logs",label:"LogExecution"});if(hasTerminalTab)t.push({id:"terminal",label:"Terminal"});return t;},[hasGlobalInfoTab,hasLogsTab,hasTerminalTab]);(0,react.useEffect)(()=>{const ids=visibleTabs.map(x=>x.id);if(ids.length===0)return;if(!ids.includes(activeTab)){setActiveTab(ids[0]);}},[visibleTabs,activeTab,setActiveTab]);const{0:localTasks,1:setLocalTasks}=(0,react.useState)(tasks);const logContainerRef=(0,react.useRef)(null);const initialGlobalInfoRef=(0,react.useRef)({});/** Only re-apply server snapshot when revision changes — avoids wiping local edits on every run.messages update. */const lastSyncedGlobalInfoRevisionRef=(0,react.useRef)(null);const{0:globalInfo,1:setGlobalInfo}=(0,react.useState)({});(0,react.useEffect)(()=>{var _serverGlobalInfo$rev,_fields$root_path;const fields=serverGlobalInfo===null||serverGlobalInfo===void 0?void 0:serverGlobalInfo.fields;const revision=(_serverGlobalInfo$rev=serverGlobalInfo===null||serverGlobalInfo===void 0?void 0:serverGlobalInfo.revision)!==null&&_serverGlobalInfo$rev!==void 0?_serverGlobalInfo$rev:null;if(!fields||Object.keys(fields).length===0){if(serverGlobalInfo==null&&lastSyncedGlobalInfoRevisionRef.current!=null){lastSyncedGlobalInfoRevisionRef.current=null;initialGlobalInfoRef.current={};setGlobalInfo({});}return;}if(revision===lastSyncedGlobalInfoRevisionRef.current){return;}lastSyncedGlobalInfoRevisionRef.current=revision;const normalized=Object.assign({},fields,{root_path:(_fields$root_path=fields.root_path)!==null&&_fields$root_path!==void 0?_fields$root_path:""});initialGlobalInfoRef.current=normalized;setGlobalInfo(Object.assign({},normalized));},[serverGlobalInfo]);// 同步 tasks prop 到 localTasks 状态
(0,react.useEffect)(()=>{// 始终同步 tasks prop，即使为空数组也要更新
if(Array.isArray(tasks)){setLocalTasks(tasks);}},[tasks]);// 自动滚动日志到底部
(0,react.useEffect)(()=>{if(activeTab==='logs'&&logContainerRef.current&&logs.length>0){logContainerRef.current.scrollTop=logContainerRef.current.scrollHeight;}},[logs,activeTab]);// 切换任务展开/折叠
const toggleTask=taskId=>{setLocalTasks(prev=>prev.map(task=>task.id===taskId?Object.assign({},task,{isExpanded:!task.isExpanded}):task));};// 渲染状态图标
const renderStatusIcon=status=>{switch(status){case'completed':return/*#__PURE__*/react.createElement(circle_check_big/* default */.A,{size:20,className:"text-green-500"});case'running':return/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-1 px-2 py-1 rounded-full text-xs "+(darkMode==="dark"?"bg-yellow-500/20 text-yellow-400":"bg-yellow-100 text-yellow-800")},/*#__PURE__*/react.createElement(clock/* default */.A,{size:14}),/*#__PURE__*/react.createElement("span",null,"\u6267\u884C\u4E2D"));case'waiting':return/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-1 px-2 py-1 rounded-full text-xs "+(darkMode==="dark"?"bg-gray-700 text-gray-400":"bg-gray-100 text-gray-500")},/*#__PURE__*/react.createElement(Circle,{size:14}),/*#__PURE__*/react.createElement("span",null,"\u7B49\u5F85\u4E2D"));}};const globalInfoKeys=Object.keys(globalInfo);const globalInfoReadOnlyKeys=GLOBAL_INFO_READ_ONLY_ORDER.filter(k=>k in globalInfo);const globalInfoEditableKeys=Object.keys(globalInfo).filter(k=>!GLOBAL_INFO_READ_ONLY_SET.has(k));const hasGlobalInfoEdits=react.useMemo(()=>{const initial=initialGlobalInfoRef.current;for(const key of Object.keys(globalInfo)){var _globalInfo$key,_initial$key;if(GLOBAL_INFO_READ_ONLY_SET.has(key))continue;if(((_globalInfo$key=globalInfo[key])!==null&&_globalInfo$key!==void 0?_globalInfo$key:"")!==((_initial$key=initial[key])!==null&&_initial$key!==void 0?_initial$key:"")){return true;}}return false;},[globalInfo]);const reviseDisabled=!onInputResponse||!hasGlobalInfoEdits;const updateGlobalField=(key,value)=>{setGlobalInfo(prev=>Object.assign({},prev,{[key]:value}));};const handleRevise=()=>{if(!onInputResponse){console.warn("[BESIII] Revise skipped: onInputResponse is not wired");return;}const initial=initialGlobalInfoRef.current;const changed={};for(const key of globalInfoEditableKeys){var _globalInfo$key2,_initial$key2;const cur=(_globalInfo$key2=globalInfo[key])!==null&&_globalInfo$key2!==void 0?_globalInfo$key2:"";const init=(_initial$key2=initial[key])!==null&&_initial$key2!==void 0?_initial$key2:"";if(cur!==init){changed[key]=cur;}}if(Object.keys(changed).length===0){console.warn("[BESIII] Revise skipped: no edited fields");return;}// Revise: `type` on envelope metadata; edited fields only in inner `content` JSON (see useTaskActions)
onInputResponse(JSON.stringify(changed),false,undefined,[],undefined,{type:"global_info"});};const renderGlobalInfo=()=>{const border=darkMode==="dark"?"border-gray-700":"border-gray-200";const muted=darkMode==="dark"?"text-gray-500":"text-gray-500";const keyCls="shrink-0 font-mono text-xs "+muted+" sm:w-44";const inputCls=darkMode==="dark"?"bg-gray-900 border-gray-600 text-gray-100 focus:border-purple-500 focus:ring-purple-500/30":"bg-white border-gray-300 text-gray-900 focus:border-purple-500 focus:ring-purple-500/30";const valueCls=darkMode==="dark"?"text-gray-100":"text-gray-900";const row="px-3 py-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4";return/*#__PURE__*/react.createElement("div",{className:"flex min-h-0 flex-1 flex-col p-4 "+(globalInfoKeys.length===0?"overflow-hidden":"overflow-y-auto")},globalInfoKeys.length===0?/*#__PURE__*/react.createElement("div",{className:"flex min-h-0 flex-1 items-center justify-center rounded-lg border "+border+" text-sm "+muted},"Loading..."):/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"rounded-lg border "+border+" divide-y "+(darkMode==="dark"?"divide-gray-700":"divide-gray-200")},globalInfoReadOnlyKeys.map(key=>{var _globalInfo$key3;return/*#__PURE__*/react.createElement("div",{key:key,className:row},/*#__PURE__*/react.createElement("span",{className:keyCls},key),/*#__PURE__*/react.createElement("span",{className:"text-sm break-all min-h-[1.25rem] flex-1 "+valueCls},(_globalInfo$key3=globalInfo[key])!==null&&_globalInfo$key3!==void 0?_globalInfo$key3:""));}),globalInfoEditableKeys.map(key=>{var _initialGlobalInfoRef,_globalInfo$key4;const initial=(_initialGlobalInfoRef=initialGlobalInfoRef.current[key])!==null&&_initialGlobalInfoRef!==void 0?_initialGlobalInfoRef:"";const current=(_globalInfo$key4=globalInfo[key])!==null&&_globalInfo$key4!==void 0?_globalInfo$key4:"";const isEdited=current!==initial;return/*#__PURE__*/react.createElement("div",{key:key,className:row},/*#__PURE__*/react.createElement("label",{htmlFor:"global-info-"+key,className:keyCls},key),/*#__PURE__*/react.createElement("div",{className:"flex flex-1 min-w-0 items-center gap-2"},/*#__PURE__*/react.createElement("input",{id:"global-info-"+key,type:"text",value:current,onChange:e=>updateGlobalField(key,e.target.value),className:"flex-1 min-w-0 rounded-md border px-2.5 py-1.5 h-9 text-sm focus:outline-none focus:ring-2 "+inputCls}),/*#__PURE__*/react.createElement("span",{className:"inline-flex h-7 w-7 shrink-0 items-center justify-center"},isEdited?/*#__PURE__*/react.createElement(check/* default */.A,{size:16,className:darkMode==="dark"?"text-emerald-400":"text-emerald-600",strokeWidth:2.5}):null)));})),/*#__PURE__*/react.createElement("div",{className:"mt-4 flex justify-end"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:handleRevise,disabled:reviseDisabled,title:!onInputResponse?"Input response is not available":!hasGlobalInfoEdits?"Edit at least one field to submit":undefined,className:"rounded-md px-4 py-2 text-sm font-medium transition-colors "+(darkMode==="dark"?"bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 disabled:hover:bg-purple-600 disabled:cursor-not-allowed":"bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40 disabled:hover:bg-purple-600 disabled:cursor-not-allowed")},"Revise"))));};const formatTimestamp=timestamp=>{if(timestamp===undefined||timestamp===null){return"--";}const numericValue=typeof timestamp==="number"?timestamp:Number(timestamp);if(!Number.isFinite(numericValue)){return"--";}const millis=numericValue>1e12?numericValue:numericValue*1000;return new Date(millis).toLocaleString();};const getLevelBadgeClasses=level=>{switch(level){case"ERROR":case"FATAL":return"bg-red-500/20 text-red-300 border-red-500/40";case"WARNING":return"bg-amber-500/20 text-amber-300 border-amber-500/40";case"DEBUG":case"TRACE":return"bg-cyan-500/20 text-cyan-300 border-cyan-500/40";default:return"bg-emerald-500/20 text-emerald-200 border-emerald-500/40";}};const renderLogMeta=(logLevel,source,contentType)=>/*#__PURE__*/react.createElement("div",{className:"flex flex-wrap items-center gap-2 text-xs text-slate-400"},/*#__PURE__*/react.createElement("span",{className:"px-2 py-0.5 rounded-full border font-semibold "+getLevelBadgeClasses(logLevel)},logLevel),/*#__PURE__*/react.createElement("span",{className:"text-slate-400"},source||"agent"),contentType&&/*#__PURE__*/react.createElement("span",{className:"px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-200 border border-purple-500/30"},contentType));// 渲染全局任务执行标签页
const renderLogs=()=>{if(!logs||logs.length===0){return/*#__PURE__*/react.createElement("div",{className:"flex h-full min-h-0 items-center justify-center rounded-lg border border-gray-900 bg-gray-950 text-sm text-slate-300"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement("div",{className:"text-slate-500 mb-2"},"\uD83D\uDCCB"),/*#__PURE__*/react.createElement("div",null,"\u6682\u65E0\u65E5\u5FD7")));}return/*#__PURE__*/react.createElement("div",{className:"flex h-full min-h-0 flex-col overflow-hidden"},/*#__PURE__*/react.createElement("div",{ref:logContainerRef,className:"min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-900 bg-gray-950 shadow-inner",style:{scrollbarWidth:'thin',scrollbarColor:'#475569 #0f172a'}},/*#__PURE__*/react.createElement("div",{className:"min-w-0 p-4 flex flex-col gap-3 text-slate-100"},logs.map((log,index)=>{var _log$send_time_stamp;const level=(log.send_level||"INFO").toUpperCase();return/*#__PURE__*/react.createElement("div",{key:((_log$send_time_stamp=log.send_time_stamp)!==null&&_log$send_time_stamp!==void 0?_log$send_time_stamp:index)+"-"+index,className:"min-w-0 rounded-lg bg-gray-900 border border-gray-800 shadow-sm"},/*#__PURE__*/react.createElement("div",{className:"flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 bg-gray-900/80 px-4 py-2"},/*#__PURE__*/react.createElement("span",{className:"font-mono text-[12px] text-slate-400"},formatTimestamp(log.send_time_stamp)),renderLogMeta(level,log.source,log.content_type)),/*#__PURE__*/react.createElement("div",{className:"min-w-0 overflow-x-hidden px-4 py-3"},/*#__PURE__*/react.createElement("pre",{className:"max-w-full whitespace-pre-wrap break-words font-mono text-sm text-slate-100 leading-relaxed select-text [overflow-wrap:anywhere]"},log.content)));}))),/*#__PURE__*/react.createElement("div",{className:"mt-2 flex items-center justify-between text-xs text-slate-400 px-1"},/*#__PURE__*/react.createElement("span",null,"\u5171 ",logs.length," \u6761\u65E5\u5FD7\u6761\u76EE"),/*#__PURE__*/react.createElement("span",{className:"text-slate-500"},"\u81EA\u52A8\u6EDA\u52A8\u5230\u5E95\u90E8")));};// 渲染 Terminal 标签页
const renderTerminal=()=>/*#__PURE__*/react.createElement("div",{className:"h-full min-h-0 overflow-y-auto rounded-lg bg-black p-4 font-mono text-sm text-green-400"},/*#__PURE__*/react.createElement("pre",{className:"whitespace-pre-wrap"},terminalOutput||"等待输出..."));return/*#__PURE__*/react.createElement("div",{className:(darkMode==="dark"?"bg-[#0f0f0f]":"bg-white")+" flex h-full min-h-0 min-w-0 w-full flex-col overflow-x-hidden rounded-lg shadow-lg"},visibleTabs.length>0?/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 px-3 pt-3 pb-2"},/*#__PURE__*/react.createElement("div",{className:"flex min-w-0 rounded-lg p-[3px] "+(darkMode==="dark"?"bg-[#1e1e1e]":"bg-gray-100")},visibleTabs.map(tab=>/*#__PURE__*/react.createElement("button",{key:tab.id,type:"button",onClick:()=>setActiveTab(tab.id),title:tab.label,className:"min-w-0 flex-1 truncate py-1 px-2 text-[11px] font-medium rounded-md transition-all "+(activeTab===tab.id?darkMode==="dark"?"bg-[#2a2a2a] text-white shadow-sm":"bg-white text-gray-900 shadow-sm":darkMode==="dark"?"text-gray-400 hover:text-gray-200":"text-gray-500 hover:text-gray-700")},tab.label)))):null,/*#__PURE__*/react.createElement("div",{className:"min-h-0 flex-1 overflow-hidden "+(darkMode==="dark"?"bg-[#0f0f0f]":"")},visibleTabs.length===0?/*#__PURE__*/react.createElement("div",{className:"relative flex h-full min-h-0 flex-col items-center justify-center overflow-hidden p-6","aria-busy":true,"aria-label":"\u52A0\u8F7D\u4E2D"},/*#__PURE__*/react.createElement("style",null,BESIII_IDLE_KEYFRAMES),/*#__PURE__*/react.createElement("div",{className:"pointer-events-none absolute inset-0 will-change-[opacity] "+(darkMode==="dark"?"bg-[radial-gradient(ellipse_at_50%_40%,rgba(129,140,248,0.14),transparent_58%)]":"bg-[radial-gradient(ellipse_at_50%_40%,rgba(99,102,241,0.1),transparent_58%)]"),style:{animation:darkMode==="dark"?"besiii-idle-glow 6s ease-in-out infinite":"besiii-idle-glow 2.2s ease-in-out infinite",opacity:darkMode==="dark"?0.14:undefined},"aria-hidden":true}),/*#__PURE__*/react.createElement("div",{className:"relative z-10 flex h-11 items-end justify-center gap-1.5","aria-hidden":true},(darkMode==="dark"?[0,1,2,3]:[0,1,2,3,4,5]).map(i=>/*#__PURE__*/react.createElement("div",{key:i,className:"h-8 w-[5px] shrink-0 rounded-full will-change-transform "+(darkMode==="dark"?"bg-indigo-300/55":"bg-indigo-500/65"),style:{transformOrigin:"bottom center",animation:darkMode==="dark"?"besiii-idle-wave 1.65s ease-in-out infinite":"besiii-idle-wave 1.05s ease-in-out infinite",animationDelay:i*(darkMode==="dark"?140:95)+"ms"}})))):/*#__PURE__*/react.createElement(react.Fragment,null,activeTab==="logs"&&hasLogsTab&&/*#__PURE__*/react.createElement("div",{className:"flex h-full min-h-0 flex-col p-4"},renderLogs()),activeTab==="global_info"&&hasGlobalInfoTab&&/*#__PURE__*/react.createElement("div",{className:"flex h-full min-h-0 flex-col"},renderGlobalInfo()),activeTab==="terminal"&&hasTerminalTab&&/*#__PURE__*/react.createElement("div",{className:"flex h-full min-h-0 flex-col p-4"},renderTerminal()))));};/* harmony default export */ var panels_BESIIIPanel = (BESIIIPanel);
;// ./src/pages/chat/panels/AgentPanel.tsx
const _excluded=["panelConfig","onMinimize","vncProps","besiiiProps"];/**
 * AgentPanel - 通用 Panel 容器组件
 * 根据 agent 配置动态渲染不同类型的面板
 */const AgentPanel=_ref=>{let{panelConfig,onMinimize,vncProps,besiiiProps}=_ref,otherProps=(0,objectWithoutPropertiesLoose/* default */.A)(_ref,_excluded);// 根据面板类型渲染对应的组件
const renderPanel=()=>{var _vncProps$isExpanded,_vncProps$onToggleExp,_besiiiProps$serverGl;switch(panelConfig.type){case'vnc':// VNC 浏览器预览面板 (magentic-one)
if(!vncProps){return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-gray-500"},"VNC Panel: Missing props");}return/*#__PURE__*/react.createElement(panels_VNCPanel,{images:vncProps.images,imageTitles:vncProps.imageTitles,currentIndex:vncProps.currentIndex,onIndexChange:vncProps.onIndexChange,novncPort:vncProps.novncPort,onPause:vncProps.onPause,runStatus:vncProps.runStatus,activeTab:vncProps.activeTab,onTabChange:vncProps.onTabChange,detailViewerContainerId:vncProps.detailViewerContainerId,onInputResponse:vncProps.onInputResponse,isExpanded:(_vncProps$isExpanded=vncProps.isExpanded)!==null&&_vncProps$isExpanded!==void 0?_vncProps$isExpanded:false,onToggleExpand:(_vncProps$onToggleExp=vncProps.onToggleExpand)!==null&&_vncProps$onToggleExp!==void 0?_vncProps$onToggleExp:()=>{},onMinimize:onMinimize});case'besiii':// BESIII 分析面板 — 宽度随右侧栏/Portal 容器自适应，勿用固定大宽度以免横向溢出
return/*#__PURE__*/react.createElement("div",{className:"h-full w-full min-w-0 max-w-full overflow-hidden"},/*#__PURE__*/react.createElement(panels_BESIIIPanel,{tasks:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.tasks,terminalOutput:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.terminalOutput,logs:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.logs,fileEvents:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.fileEvents,serverGlobalInfo:(_besiiiProps$serverGl=besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.serverGlobalInfo)!==null&&_besiiiProps$serverGl!==void 0?_besiiiProps$serverGl:null,onMinimize:onMinimize,onTaskClick:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.onTaskClick,onSubtaskClick:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.onSubtaskClick,activeTab:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.activeTab,onTabChange:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.onTabChange,onInputResponse:besiiiProps===null||besiiiProps===void 0?void 0:besiiiProps.onInputResponse}));case'terminal':// 纯终端面板 (未来扩展)
return/*#__PURE__*/react.createElement("div",{className:"bg-black text-green-400 font-mono p-4 rounded h-full overflow-auto"},/*#__PURE__*/react.createElement("pre",null,"Terminal Panel (Coming Soon...)"));case'none':default:// 无面板或未知类型
return null;}};const panel=renderPanel();if(!panel){return null;}return/*#__PURE__*/react.createElement("div",{className:panelConfig.type==="besiii"?"h-full w-full min-w-0":"h-full w-full"},panel);};/* harmony default export */ var panels_AgentPanel = (AgentPanel);
// EXTERNAL MODULE: ./src/store/rightPanel.ts
var rightPanel = __webpack_require__(46886);
;// ./src/pages/chat/runview.tsx









const DETAIL_VIEWER_CONTAINER_ID = "detail-viewer-container";
const CHAT_INPUT_BASE_HEIGHT_PX = 78;

/** Next index that bounds the "segment" after messageIndex (plan, final answer, or next non-duplicate step). */
function getNextSignificantMessageIndex(messages, messageIndex) {
  let nextSignificantIndex = messages.length;
  for (let i = messageIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    const content = msg.config.content;
    if (typeof content === "string" && (rendermessage.messageUtils.isFinalAnswer(msg.config.metadata) || rendermessage.messageUtils.isPlanMessage(msg.config.metadata))) {
      nextSignificantIndex = i;
      break;
    }
    if (rendermessage.messageUtils.isStepExecution(msg.config.metadata) && typeof content === "string") {
      try {
        const currentStep = JSON.parse(content);
        if (currentStep.title && currentStep.details) {
          const earlierMessages = messages.slice(0, i);
          const isDuplicate = earlierMessages.some(earlierMsg => {
            if (typeof earlierMsg.config.content !== "string") return false;
            try {
              const earlierContent = JSON.parse(earlierMsg.config.content);
              return earlierContent.title === currentStep.title && earlierContent.details === currentStep.details;
            } catch (_unused) {
              return false;
            }
          });
          if (!isDuplicate) {
            nextSignificantIndex = i;
            break;
          }
        }
      } catch (_unused2) {
        continue;
      }
    }
  }
  return nextSignificantIndex;
}
const RunView = _ref => {
  var _run$messages, _run$team_result, _run$team_result$task;
  let {
    run,
    onSavePlan,
    onPause,
    onRegeneratePlan,
    isPanelMinimized,
    setIsPanelMinimized,
    showPanel,
    setShowPanel,
    agentConfig,
    // 从 parent 接收
    onApprove,
    onDeny,
    onAcceptPlan,
    // Add new props here
    onInputResponse,
    onRunTask,
    onCancel,
    error,
    chatInputRef,
    onExecutePlan,
    enable_upload = false,
    serverFilesPrefill
  } = _ref;
  const setIsRightPanelOpen = (0,rightPanel/* useRightPanelStore */.x)(s => s.setIsOpen);
  const overviewSlot = (0,rightPanel/* useRightPanelStore */.x)(s => s.overviewSlot);
  const threadContainerRef = (0,react.useRef)(null);
  const autoScrollLockedRef = (0,react.useRef)(false);
  const {
    0: autoScrollLocked,
    1: setAutoScrollLocked
  } = (0,react.useState)(false);
  /** Last scroll metrics — used so ResizeObserver can tell "was pinned to bottom" when content height grows (streaming). */
  const scrollMetricsRef = (0,react.useRef)({
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0
  });
  /** True while we are scrolling programmatically — ignore scroll-lock so streaming doesn't falsely lock. */
  const programmaticScrollRef = (0,react.useRef)(false);
  const programmaticScrollClearTimerRef = (0,react.useRef)(null);
  const {
    0: novncPort,
    1: setNovncPort
  } = (0,react.useState)();
  const {
    0: detailViewerExpanded,
    1: setDetailViewerExpanded
  } = (0,react.useState)(false);
  const {
    0: detailViewerTab,
    1: setDetailViewerTab
  } = (0,react.useState)("live");
  const {
    0: besiiiActiveTab,
    1: setBesiiiActiveTab
  } = (0,react.useState)("global_info");
  const {
    0: hiddenMessageIndices,
    1: setHiddenMessageIndices
  } = (0,react.useState)(new Set());
  const {
    0: hiddenStepExecutionIndices,
    1: setHiddenStepExecutionIndices
  } = (0,react.useState)(new Set());
  const {
    0: localMessages,
    1: setLocalMessages
  } = (0,react.useState)([]);

  /** Step indices where the user explicitly expanded; auto-collapse skips these. */
  const userPinnedExpandedStepIndicesRef = (0,react.useRef)(new Set());
  const isTogglingRef = (0,react.useRef)(false);

  // Add this state to track repeated step indices and their earlier occurrences
  const {
    0: repeatedStepIndices,
    1: setRepeatedStepIndices
  } = (0,react.useState)(new Set());
  const {
    0: failedStepIndices,
    1: setFailedStepIndices
  } = (0,react.useState)(new Set());

  // Add ref for the latest user message
  const latestUserMessageRef = (0,react.useRef)(null);

  // Add state to track the last plan message index
  const {
    0: lastPlanIndex,
    1: setLastPlanIndex
  } = (0,react.useState)(-1);

  // Add this with other refs near the top of the component
  const buttonsContainerRef = (0,react.useRef)(null);
  const {
    0: chatInputHeight,
    1: setChatInputHeight
  } = (0,react.useState)(CHAT_INPUT_BASE_HEIGHT_PX);
  (0,react.useEffect)(() => {
    const container = buttonsContainerRef.current;
    if (!container) return;
    const updateHeight = () => {
      const nextHeight = container.offsetHeight || CHAT_INPUT_BASE_HEIGHT_PX;
      setChatInputHeight(nextHeight);
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const scrollToBottom = (0,react.useCallback)(function (behavior) {
    if (behavior === void 0) {
      behavior = "auto";
    }
    const container = threadContainerRef.current;
    if (!container) return;
    if (programmaticScrollClearTimerRef.current != null) {
      clearTimeout(programmaticScrollClearTimerRef.current);
      programmaticScrollClearTimerRef.current = null;
    }
    autoScrollLockedRef.current = false;
    setAutoScrollLocked(false);
    programmaticScrollRef.current = true;
    const syncScrollMetrics = () => {
      const el = threadContainerRef.current;
      if (!el) return;
      scrollMetricsRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight
      };
    };
    const scroll = () => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior
      });
      syncScrollMetrics();
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        scroll();
        window.requestAnimationFrame(syncScrollMetrics);
      });
    } else {
      scroll();
    }
    const clearMs = behavior === "smooth" ? 450 : 80;
    programmaticScrollClearTimerRef.current = setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollClearTimerRef.current = null;
      syncScrollMetrics();
    }, clearMs);
  }, []);

  // Agent configuration - 从 parent (chat.tsx) 接收

  // 将 run.task 转换为 BESIIITask 格式的辅助函数
  const convertTaskToBESIIITask = react.useCallback(task => {
    if (!task) {
      return [];
    }

    // TaskEvent 的结构: { content: str | Dict, type: "TaskEvent", source: ..., ... }
    // 处理不同的数据结构
    let taskContent = null;
    if (task.content) {
      // 如果 task 有 content 字段
      if (typeof task.content === 'string') {
        try {
          // 尝试解析 JSON 字符串
          taskContent = JSON.parse(task.content);
        } catch (e) {
          // 如果不是 JSON，可能是纯文本，创建一个简单的任务结构
          taskContent = {
            content: task.content
          };
        }
      } else if (typeof task.content === 'object') {
        // 如果 content 是对象，直接使用
        taskContent = task.content;
      }
    } else {
      // 如果没有 content 字段，可能 task 本身就是内容
      taskContent = task;
    }
    if (!taskContent) {
      return [];
    }
    const childTasks = taskContent.child_tasks || [];

    // 将子任务转换为 BESIIISubTask 格式
    const subtasks = childTasks.map(childTask => {
      let status = 'waiting';
      if (childTask.status === 'completed') {
        status = 'completed';
      } else if (childTask.status === 'running' || childTask.status === 'active' || childTask.status === 'queued') {
        status = 'running';
      }

      // 处理时间戳：如果是数字（秒级），转换为毫秒；如果已经是字符串，直接使用
      const formatTimestamp = ts => {
        if (!ts) return undefined;
        if (typeof ts === 'number') {
          // 判断是秒级还是毫秒级时间戳
          const timestamp = ts > 1e12 ? ts : ts * 1000;
          return new Date(timestamp).toISOString();
        }
        if (typeof ts === 'string') {
          return ts;
        }
        return undefined;
      };
      return {
        id: childTask.id || '',
        name: childTask.content || '未命名任务',
        status: status,
        startTime: formatTimestamp(childTask.created_at),
        endTime: formatTimestamp(childTask.completed_at),
        error: childTask.error || undefined
      };
    });

    // 返回主任务
    // 如果没有子任务，至少显示主任务本身
    const mainTaskName = taskContent.content || taskContent.name || taskContent.task || '主任务';
    return [{
      id: task.id || taskContent.id || taskContent.task_id || 'main-task',
      name: typeof mainTaskName === 'string' ? mainTaskName : JSON.stringify(mainTaskName),
      subtasks: subtasks,
      isExpanded: true,
      metadata: {
        status: taskContent.status || task.status,
        executor: taskContent.executor,
        created_at: taskContent.created_at,
        completed_at: taskContent.completed_at,
        solution: taskContent.solution,
        raw: taskContent // 保存原始数据用于调试
      }
    }];
  }, []);

  // BESIII Panel states - 从 run.task 初始化
  const {
    0: besiiiTasks,
    1: setBesiiiTasks
  } = (0,react.useState)(() => {
    return convertTaskToBESIIITask(run.task);
  });
  const {
    0: logs,
    1: setLogs
  } = (0,react.useState)([]);
  const {
    0: terminalOutput,
    1: setTerminalOutput
  } = (0,react.useState)("");
  const besiiiServerGlobalInfo = react.useMemo(() => {
    if (agentConfig.panel.type !== "besiii") return null;
    for (let i = run.messages.length - 1; i >= 0; i--) {
      const m = run.messages[i];
      const meta = m.config.metadata;
      if ((meta === null || meta === void 0 ? void 0 : meta.type) !== "global_info") continue;
      const c = m.config.content;
      if (typeof c !== "string") continue;
      try {
        const parsed = JSON.parse(c);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const out = {};
          for (const [k, v] of Object.entries(parsed)) {
            out[k] = v == null ? "" : String(v);
          }
          if (!Object.prototype.hasOwnProperty.call(out, "root_path")) {
            out.root_path = "";
          }
          return {
            revision: i + ":" + c,
            fields: out
          };
        }
      } catch (_unused3) {
        continue;
      }
    }
    return null;
  }, [run.messages, agentConfig.panel.type]);

  // New global_info from the run → show BESIII Global Info tab and bring user to 运行概览 in the right rail
  (0,react.useEffect)(() => {
    if (agentConfig.panel.type !== "besiii") return;
    if (!(besiiiServerGlobalInfo !== null && besiiiServerGlobalInfo !== void 0 && besiiiServerGlobalInfo.revision)) return;
    setBesiiiActiveTab("global_info");
    setShowPanel(true);
    setIsPanelMinimized(false);
  }, [agentConfig.panel.type, besiiiServerGlobalInfo === null || besiiiServerGlobalInfo === void 0 ? void 0 : besiiiServerGlobalInfo.revision, setShowPanel, setIsPanelMinimized]);

  // Track manual scrolling so users can inspect earlier messages without being forced to bottom
  (0,react.useEffect)(() => {
    const container = threadContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        scrollMetricsRef.current = {
          scrollHeight: container.scrollHeight,
          scrollTop: container.scrollTop,
          clientHeight: container.clientHeight
        };
        return;
      }
      scrollMetricsRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight
      };
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const isAtBottom = distanceFromBottom <= 48;
      if (!isAtBottom && !autoScrollLockedRef.current) {
        autoScrollLockedRef.current = true;
        setAutoScrollLocked(true);
      } else if (isAtBottom && autoScrollLockedRef.current) {
        autoScrollLockedRef.current = false;
        setAutoScrollLocked(false);
      }
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // When thread content height grows (streaming, collapsible blocks), scrollHeight can jump before scrollTop
  // catches up — the scroll handler may think the user left the bottom and lock auto-scroll. If metrics show we
  // were pinned to the bottom before the growth, keep following.
  (0,react.useEffect)(() => {
    const container = threadContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const el = threadContainerRef.current;
      if (!el) return;
      const prev = scrollMetricsRef.current;
      const wasAtBottom = prev.scrollHeight > 0 && prev.scrollTop >= prev.scrollHeight - prev.clientHeight - 48;
      if (wasAtBottom && el.scrollHeight > prev.scrollHeight) {
        scrollToBottom("auto");
        return;
      }
      scrollMetricsRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight
      };
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // Combine scroll behavior when messages or status change
  (0,react.useEffect)(() => {
    if (run.messages.length === 0 || !threadContainerRef.current || autoScrollLockedRef.current) {
      return;
    }

    // Use a small delay to ensure the DOM has updated
    const timeout = setTimeout(() => {
      scrollToBottom("auto");
    }, 100);
    return () => clearTimeout(timeout);
  }, [run.messages, run.status, autoScrollLocked, scrollToBottom]);
  (0,react.useEffect)(() => {
    autoScrollLockedRef.current = false;
    setAutoScrollLocked(false);
    const timeout = setTimeout(() => {
      scrollToBottom("auto");
    }, 100);
    return () => clearTimeout(timeout);
  }, [run.id, scrollToBottom]);
  (0,react.useEffect)(() => {
    userPinnedExpandedStepIndicesRef.current = new Set();
  }, [run.id]);

  // Effect to handle browser_address message (for VNC panel)
  (0,react.useEffect)(() => {
    var _lastBrowserAddressMs;
    if (agentConfig.panel.type !== 'vnc') return;
    const browserAddressMessages = run.messages.filter(msg => {
      var _msg$config$metadata;
      return ((_msg$config$metadata = msg.config.metadata) === null || _msg$config$metadata === void 0 ? void 0 : _msg$config$metadata.type) === "browser_address";
    });
    const lastBrowserAddressMsg = browserAddressMessages[browserAddressMessages.length - 1];
    // only update if novncPort is it is different from the current novncPort
    if (lastBrowserAddressMsg && ((_lastBrowserAddressMs = lastBrowserAddressMsg.config.metadata) === null || _lastBrowserAddressMs === void 0 ? void 0 : _lastBrowserAddressMs.novnc_port) !== novncPort) {
      var _lastBrowserAddressMs2;
      setNovncPort((_lastBrowserAddressMs2 = lastBrowserAddressMsg.config.metadata) === null || _lastBrowserAddressMs2 === void 0 ? void 0 : _lastBrowserAddressMs2.novnc_port);
      // Show Panel when novncPort becomes available
      setShowPanel(true);
      setIsPanelMinimized(false);
    }
  }, [run.messages, agentConfig.panel.type]);

  // Effect to handle BESIII tasks from run.task (for BESIII panel)
  (0,react.useEffect)(() => {
    if (agentConfig.panel.type !== 'besiii') return;

    // 从 run.task 更新任务数据
    if (run.task) {
      const convertedTasks = convertTaskToBESIIITask(run.task);
      // 即使 convertedTasks 为空，也要更新状态，以便清空之前的任务
      setBesiiiTasks(convertedTasks);
      if (convertedTasks.length > 0) {
        setShowPanel(true);
        setIsPanelMinimized(false);
      }
    } else {
      // 如果 run.task 为空，清空任务列表
      setBesiiiTasks([]);
    }

    // Also handle terminal output
    const terminalMessages = run.messages.filter(msg => {
      var _msg$config$metadata2;
      return ((_msg$config$metadata2 = msg.config.metadata) === null || _msg$config$metadata2 === void 0 ? void 0 : _msg$config$metadata2.type) === "besiii_terminal";
    });
    if (terminalMessages.length > 0) {
      const allOutput = terminalMessages.map(msg => {
        var _msg$config$metadata3;
        return ((_msg$config$metadata3 = msg.config.metadata) === null || _msg$config$metadata3 === void 0 ? void 0 : _msg$config$metadata3.output) || '';
      }).join('\n');
      setTerminalOutput(allOutput);
    }
  }, [run.task, run.messages, agentConfig.panel.type, convertTaskToBESIIITask]);

  // Effect to handle logs from run.logs (for BESIII panel LogExecution)
  (0,react.useEffect)(() => {
    if (agentConfig.panel.type !== 'besiii') return;

    // 规范化 logs：处理可能的 string 类型，转换为 RunLogEntry[]
    if (run.logs && Array.isArray(run.logs)) {
      const normalizedLogs = run.logs.map(log => typeof log === "string" ? {
        content: log
      } : log);
      setLogs(normalizedLogs);
    } else {
      // 如果 run.logs 不存在或为空，清空日志列表
      setLogs([]);
    }
  }, [run.logs, agentConfig.panel.type]);

  // Control right panel open state based on panel visibility
  (0,react.useEffect)(() => {
    const shouldShow = showPanel && !isPanelMinimized && agentConfig.panel.type !== 'none';
    setIsRightPanelOpen(shouldShow);
    return () => {
      setIsRightPanelOpen(false);
    };
  }, [showPanel, isPanelMinimized, agentConfig.panel.type, setIsRightPanelOpen]);
  const isEditable = run.status === "awaiting_input" && rendermessage.messageUtils.isPlanMessage((_run$messages = run.messages[run.messages.length - 1]) === null || _run$messages === void 0 ? void 0 : _run$messages.config.metadata);

  // Add state for tracking images from multimodal messages
  const {
    0: messageImages,
    1: setMessageImages
  } = (0,react.useState)({
    urls: [],
    titles: [],
    messageIndices: []
  });

  // Function to collect images from multimodal messages for browser steps
  const collectImagesFromMessages = messages => {
    const images = {
      urls: [],
      titles: [],
      messageIndices: []
    };
    let latestImageIndex = -1;
    messages.forEach((msg, msgIndex) => {
      var _msg$config$metadata4;
      if (Array.isArray(msg.config.content) && ((_msg$config$metadata4 = msg.config.metadata) === null || _msg$config$metadata4 === void 0 ? void 0 : _msg$config$metadata4.type) === "browser_screenshot") {
        msg.config.content.forEach((item, itemIndex) => {
          if (typeof item === "object" && ("url" in item || "data" in item)) {
            const imageUrl = "url" in item && item.url || ("data" in item && item.data ? "data:image/png;base64," + item.data : "");
            images.urls.push(imageUrl);
            images.messageIndices.push(msgIndex);
            latestImageIndex = images.urls.length - 1;
          }
          if (typeof item === "string") {
            images.titles.push(item);
          }
        });
      }
    });
    setMessageImages(Object.assign({}, images, {
      currentIndex: latestImageIndex >= 0 ? latestImageIndex : undefined
    }));
  };

  // Update images when messages change
  (0,react.useEffect)(() => {
    collectImagesFromMessages(run.messages);
  }, [run.messages]);
  const handleMaximize = () => {
    setIsPanelMinimized(false);
    setShowPanel(true);
  };

  // Handle switching to logExecution panel when clicking log messages
  const handleSwitchToLogExecution = react.useCallback(() => {
    if (agentConfig.panel.type === 'besiii') {
      setBesiiiActiveTab('logs');
      setIsPanelMinimized(false);
      setShowPanel(true);
    }
  }, [agentConfig.panel.type]);

  // Update handleImageClick to use the correct image index
  const handleImageClick = messageIndex => {
    const imageIndices = messageImages.messageIndices.map((msgIdx, imgIdx) => ({
      msgIdx,
      imgIdx
    })).filter(_ref2 => {
      let {
        msgIdx
      } = _ref2;
      return msgIdx === messageIndex;
    }).map(_ref3 => {
      let {
        imgIdx
      } = _ref3;
      return imgIdx;
    });
    if (imageIndices.length > 0) {
      const lastImageIndex = imageIndices[imageIndices.length - 1];
      setMessageImages(prev => Object.assign({}, prev, {
        currentIndex: lastImageIndex
      }));
      setDetailViewerTab("screenshots");
      handleMaximize();
    }
  };
  const handleToggleHide = async function (messageIndex, expanded, isUserAction) {
    if (isUserAction === void 0) {
      isUserAction = false;
    }
    // If a toggle operation is already in progress, ignore this request
    if (isTogglingRef.current) {
      return;
    }
    try {
      isTogglingRef.current = true;
      const newIndicesToHide = new Set();
      const nextSignificantIndex = getNextSignificantMessageIndex(run.messages, messageIndex);

      // Update hidden states for messages between current and next significant message
      for (let i = messageIndex + 1; i < nextSignificantIndex; i++) {
        newIndicesToHide.add(i);
      }
      if (isUserAction) {
        if (expanded) {
          const next = new Set(userPinnedExpandedStepIndicesRef.current);
          next.add(messageIndex);
          userPinnedExpandedStepIndicesRef.current = next;
        } else {
          const next = new Set(userPinnedExpandedStepIndicesRef.current);
          next.delete(messageIndex);
          userPinnedExpandedStepIndicesRef.current = next;
        }
      }
      if (!expanded) {
        setHiddenMessageIndices(prevSet => {
          const updatedSet = new Set(prevSet);
          newIndicesToHide.forEach(index => updatedSet.add(index));
          return updatedSet;
        });
      } else {
        setHiddenMessageIndices(prevSet => {
          const updatedSet = new Set(prevSet);
          newIndicesToHide.forEach(index => updatedSet.delete(index));
          return updatedSet;
        });
      }
    } finally {
      // Always reset the toggling flag when done
      isTogglingRef.current = false;
    }
  };

  /** True when no messages in this step's segment (before next significant) are hidden. */
  const getStepFollowingExpanded = messageIndex => {
    const next = getNextSignificantMessageIndex(run.messages, messageIndex);
    for (let i = messageIndex + 1; i < next; i++) {
      if (hiddenMessageIndices.has(i)) return false;
    }
    return true;
  };

  // Add this function to check if a message is a step execution
  const isStepExecution = message => {
    return rendermessage.messageUtils.isStepExecution(message.config.metadata);
  };

  // Add this effect to update repeated steps whenever messages change
  (0,react.useEffect)(() => {
    const newRepeatedIndices = new Set();
    const newFailedIndices = new Set();
    const newRepeatedHistory = new Map();

    // For each message that is a step execution
    run.messages.forEach((msg, msgIndex) => {
      if (!isStepExecution(msg)) return;
      try {
        const content = JSON.parse(String(msg.config.content));

        // Look for earlier messages with same step details
        const earlierMessages = run.messages.slice(0, msgIndex);
        const identicalStepIndices = [];

        // Find all identical steps
        earlierMessages.forEach((earlierMsg, idx) => {
          if (typeof earlierMsg.config.content !== "string") return;
          try {
            const earlierContent = JSON.parse(earlierMsg.config.content);
            if (earlierContent.index === content.index && earlierContent.title === content.title && earlierContent.details === content.details) {
              identicalStepIndices.push(idx);
            }
          } catch (_unused4) {
            return;
          }
        });

        // If we found identical steps, check for Final Answer or Plan after the last one
        if (identicalStepIndices.length > 0) {
          const messagesBetween = run.messages.slice(identicalStepIndices[identicalStepIndices.length - 1] + 1, msgIndex);
          const hasSeparator = messagesBetween.some(msg => {
            if (typeof msg.config.content !== "string") return false;
            return rendermessage.messageUtils.isPlanMessage(msg.config.metadata) || rendermessage.messageUtils.isFinalAnswer(msg.config.metadata);
          });

          // Only mark as repeated if there's no separator
          if (!hasSeparator) {
            newRepeatedIndices.add(msgIndex);
            newRepeatedHistory.set(msgIndex, identicalStepIndices);
          }
        }

        // Separate step failure detection
        const nextMessages = run.messages.slice(msgIndex + 1);
        for (const nextMsg of nextMessages) {
          if (typeof nextMsg.config.content !== "string") continue;

          // If we find a step execution, plan, or final answer before finding "Replanning...", break
          try {
            var _nextMsg$config$metad;
            if (rendermessage.messageUtils.isStepExecution(nextMsg.config.metadata)) break;
            if (rendermessage.messageUtils.isPlanMessage(nextMsg.config.metadata)) break;
            if (((_nextMsg$config$metad = nextMsg.config.metadata) === null || _nextMsg$config$metad === void 0 ? void 0 : _nextMsg$config$metad.type) === "replanning") {
              newFailedIndices.add(msgIndex);
              break;
            }
          } catch (_unused5) {
            if (rendermessage.messageUtils.isFinalAnswer(nextMsg.config.metadata)) break;
          }
        }
      } catch (_unused6) {
        // Skip if we can't parse the message
      }
    });
    setRepeatedStepIndices(newRepeatedIndices);
    setFailedStepIndices(newFailedIndices);

    // handle auto-hiding of previous step execution messages
    const newHiddenStepExecutionIndices = new Set(hiddenStepExecutionIndices);
    // Process messages in order
    (async () => {
      for (let i = 0; i < run.messages.length; i++) {
        const msg = run.messages[i];
        if (typeof msg.config.content !== "string") continue;
        try {
          // If this is a final answer, hide all previous step executions
          if (rendermessage.messageUtils.isFinalAnswer(msg.config.metadata)) {
            for (let j = 0; j < i; j++) {
              const prevMsg = run.messages[j];
              if (typeof prevMsg.config.content === "string") {
                try {
                  if (rendermessage.messageUtils.isStepExecution(prevMsg.config.metadata)) {
                    newHiddenStepExecutionIndices.add(j);
                    if (!userPinnedExpandedStepIndicesRef.current.has(j)) {
                      handleToggleHide(j, false);
                    }
                    // delay for 100ms
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                } catch (_unused7) {}
              }
            }
            continue;
          }
          const content = JSON.parse(msg.config.content);

          // If this is a step execution that's not repeated
          if (rendermessage.messageUtils.isStepExecution(msg.config.metadata) && !newRepeatedIndices.has(i)) {
            // Hide all previous step executions
            for (let j = 0; j < i; j++) {
              const prevMsg = run.messages[j];
              if (typeof prevMsg.config.content === "string") {
                try {
                  if (rendermessage.messageUtils.isStepExecution(prevMsg.config.metadata)) {
                    if (!newRepeatedIndices.has(j)) {
                      if (!userPinnedExpandedStepIndicesRef.current.has(j)) {
                        handleToggleHide(j, false);
                      }
                      newHiddenStepExecutionIndices.add(j);
                      // delay for 100ms
                      await new Promise(resolve => setTimeout(resolve, 100));
                    }
                  }
                } catch (_unused8) {}
              }
            }
          }
        } catch (_unused9) {}
      }
      if (newHiddenStepExecutionIndices.size > 0 && newHiddenStepExecutionIndices !== hiddenStepExecutionIndices) {
        setHiddenStepExecutionIndices(prevSet => {
          const updatedSet = new Set(prevSet);
          for (const index of newHiddenStepExecutionIndices) {
            updatedSet.add(index);
          }
          return updatedSet;
        });
      }
    })();
  }, [run.messages]);
  (0,react.useEffect)(() => {
    if (!run.messages.length) return;
    const updatedMessages = (0,toConsumableArray/* default */.A)(run.messages);
    updatedMessages.forEach((msg, idx) => {
      var _msg$config$metadata5;
      // Parse and validate attached_files from metadata if present
      if ((_msg$config$metadata5 = msg.config.metadata) !== null && _msg$config$metadata5 !== void 0 && _msg$config$metadata5.attached_files) {
        try {
          const attachedFilesStr = msg.config.metadata.attached_files;
          // If it's a string, parse it to validate and ensure it's valid JSON
          if (typeof attachedFilesStr === "string") {
            const parsed = JSON.parse(attachedFilesStr);
            // Ensure it's an array, then stringify it back to keep metadata type consistent
            const validArray = Array.isArray(parsed) ? parsed : [];
            // Update the message with validated attached_files (as JSON string)
            updatedMessages[idx] = Object.assign({}, msg, {
              config: Object.assign({}, msg.config, {
                metadata: Object.assign({}, msg.config.metadata, {
                  attached_files: JSON.stringify(validArray)
                })
              })
            });
          }
        } catch (e) {
          // If parsing fails, set to empty array as JSON string
          updatedMessages[idx] = Object.assign({}, msg, {
            config: Object.assign({}, msg.config, {
              metadata: Object.assign({}, msg.config.metadata, {
                attached_files: "[]"
              })
            })
          });
        }
      }
      if (idx === 0) return;
      const userPlans = rendermessage.messageUtils.findUserPlan(msg.config.content);

      // Check if this is a user message with a plan
      if (rendermessage.messageUtils.isUser(msg.config.source) && userPlans.length > 0) {
        const prevIdx = idx - 1;
        const prevMsg = updatedMessages[prevIdx];

        // Check if previous message is a plan
        if (prevMsg && rendermessage.messageUtils.isPlanMessage(prevMsg.config.metadata)) {
          try {
            // Create a new message object with updated content
            const updatedContent = rendermessage.messageUtils.updatePlan(prevMsg.config.content, userPlans);
            if (updatedContent !== prevMsg.config.content) {
              updatedMessages[prevIdx] = Object.assign({}, prevMsg, {
                config: Object.assign({}, prevMsg.config, {
                  content: updatedContent,
                  version: (prevMsg.config.version || 0) + 1
                })
              });
            }
          } catch (error) {
            console.error("Error updating plan for message at index " + prevIdx + ":", error);
          }
        }
      }
    });
    setLocalMessages(updatedMessages);
  }, [run.messages]);

  // Update useEffect to find the last plan message
  (0,react.useEffect)(() => {
    let lastIdx = -1;
    run.messages.forEach((msg, idx) => {
      if (typeof msg.config.content === "string" && rendermessage.messageUtils.isPlanMessage(msg.config.metadata)) {
        lastIdx = idx;
      }
    });
    setLastPlanIndex(lastIdx);
  }, [run.messages]);

  // Update handleRegeneratePlan to work with the effect
  const handleRegeneratePlan = () => {
    if (onRegeneratePlan) {
      onRegeneratePlan();
    }
  };

  // Add this before the return statement
  const lastMessage = localMessages[localMessages.length - 1];
  const isPlanMsg = lastMessage && rendermessage.messageUtils.isPlanMessage(lastMessage.config.metadata);

  // Add this effect to handle scrolling when status changes
  (0,react.useEffect)(() => {
    if (run.status === "awaiting_input" && buttonsContainerRef.current) {
      // Use a small delay to ensure the DOM has updated
      setTimeout(() => {
        var _buttonsContainerRef$;
        (_buttonsContainerRef$ = buttonsContainerRef.current) === null || _buttonsContainerRef$ === void 0 ? void 0 : _buttonsContainerRef$.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      }, 100);
    }
  }, [run.status]);
  return /*#__PURE__*/react.createElement("div", {
    className: "flex w-full h-full"
  }, /*#__PURE__*/react.createElement("div", {
    className: "items-start relative flex flex-col h-full w-full transition-all duration-300"
  }, /*#__PURE__*/react.createElement("div", {
    ref: threadContainerRef,
    className: "w-full max-w-4xl mx-auto flex-1 min-h-0 overflow-y-auto scroll px-8 pt-4 pb-4"
  }, localMessages.length > 0 && localMessages.map((msg, idx) => {
    var _msg$config$metadata6, _msg$config$metadata7, _nextMessage$config$m, _nextMessage$config$m2, _nextMessage$config$m3, _nextMessage$config$m4, _nextMessage$config$m5;
    const isCurrentMessagePlan = typeof msg.config.content === "string" && rendermessage.messageUtils.isPlanMessage(msg.config.metadata);
    const isLatestPlan = isCurrentMessagePlan && idx === localMessages.length - 1;
    const shouldForceCollapse = isCurrentMessagePlan && idx !== lastPlanIndex;

    // Check if current message is log message
    const isLogMessage = ((_msg$config$metadata6 = msg.config.metadata) === null || _msg$config$metadata6 === void 0 ? void 0 : _msg$config$metadata6.type) === "log" || msg.config.content_type === "log" || msg.config.type === "AgentLogEvent" || ((_msg$config$metadata7 = msg.config.metadata) === null || _msg$config$metadata7 === void 0 ? void 0 : _msg$config$metadata7.type) === "AgentLogEvent";

    // Check if next message is chunk message (streaming message)
    const nextMessage = idx < localMessages.length - 1 ? localMessages[idx + 1] : null;
    const isNextChunkMessage = nextMessage && (
    // Chunk messages typically have start_flag or are streaming messages from assistant
    ((_nextMessage$config$m = nextMessage.config.metadata) === null || _nextMessage$config$m === void 0 ? void 0 : (_nextMessage$config$m2 = _nextMessage$config$m.start_flag) === null || _nextMessage$config$m2 === void 0 ? void 0 : _nextMessage$config$m2.toLowerCase()) === "yes" ||
    // Or it's an assistant message that's not a log message and has stream_source_label
    (nextMessage.config.source === "assistant" || ((_nextMessage$config$m3 = nextMessage.config.metadata) === null || _nextMessage$config$m3 === void 0 ? void 0 : _nextMessage$config$m3.stream_source_label)) && !rendermessage.messageUtils.isUser(nextMessage.config.source) && ((_nextMessage$config$m4 = nextMessage.config.metadata) === null || _nextMessage$config$m4 === void 0 ? void 0 : _nextMessage$config$m4.type) !== "log" && nextMessage.config.type !== "AgentLogEvent" && ((_nextMessage$config$m5 = nextMessage.config.metadata) === null || _nextMessage$config$m5 === void 0 ? void 0 : _nextMessage$config$m5.type) !== "AgentLogEvent");
    return /*#__PURE__*/react.createElement("div", {
      key: "message-" + idx + "-" + run.id,
      className: "w-full",
      ref: rendermessage.messageUtils.isUser(msg.config.source) ? latestUserMessageRef : null
    }, /*#__PURE__*/react.createElement(rendermessage.RenderMessage, {
      key: "render-" + idx + "-" + (msg.config.version || 0),
      message: msg.config,
      sessionId: msg.session_id,
      messageIdx: idx,
      isLast: idx === localMessages.length - 1,
      isEditable: isEditable && idx === localMessages.length - 1,
      hidden: hiddenMessageIndices.has(idx) || hiddenStepExecutionIndices.has(idx),
      is_step_repeated: repeatedStepIndices.has(idx),
      is_step_failed: failedStepIndices.has(idx),
      onSavePlan: onSavePlan,
      onImageClick: () => handleImageClick(idx),
      onToggleHide: expanded => handleToggleHide(idx, expanded, true),
      stepFollowingExpanded: rendermessage.messageUtils.isStepExecution(msg.config.metadata) ? getStepFollowingExpanded(idx) : undefined,
      runStatus: run.status,
      onRegeneratePlan: isLatestPlan ? handleRegeneratePlan : undefined,
      onResendMessage: content => {
        // awaiting_input: answer HITL via input_response. Paused: continue with new start (not input_response — that sends accepted:false and replans / re-prompts).
        if (run.status === "awaiting_input") {
          onInputResponse === null || onInputResponse === void 0 ? void 0 : onInputResponse(content, false, undefined, []);
        } else {
          onRunTask === null || onRunTask === void 0 ? void 0 : onRunTask(content, [], undefined, true);
        }
      },
      onActionButtonClick: action => {
        if (run.status === "awaiting_input") {
          onInputResponse === null || onInputResponse === void 0 ? void 0 : onInputResponse(action, false, undefined, []);
        } else {
          onRunTask === null || onRunTask === void 0 ? void 0 : onRunTask(action, [], undefined, true);
        }
      },
      forceCollapsed: shouldForceCollapse,
      onLogMessageClick: handleSwitchToLogExecution,
      className: isLogMessage && isNextChunkMessage ? "!mb-8" : ""
    }));
  }), /*#__PURE__*/react.createElement("div", {
    className: "pt-2 pb-2 flex-shrink-0"
  }, /*#__PURE__*/react.createElement("div", {
    className: "inline-block"
  }, getStatusIcon(run.status, run.error_message, (_run$team_result = run.team_result) === null || _run$team_result === void 0 ? void 0 : (_run$team_result$task = _run$team_result.task_result) === null || _run$team_result$task === void 0 ? void 0 : _run$team_result$task.stop_reason, run.input_request))), /*#__PURE__*/react.createElement("div", {
    className: "flex-shrink-0"
  }, /*#__PURE__*/react.createElement(approval_buttons["default"], {
    status: run.status,
    inputRequest: run.input_request,
    isPlanMessage: isPlanMsg,
    onApprove: onApprove,
    onDeny: onDeny,
    onAcceptPlan: onAcceptPlan,
    onRegeneratePlan: onRegeneratePlan
  }))), /*#__PURE__*/react.createElement("div", {
    ref: buttonsContainerRef,
    className: "flex-shrink-0 w-full relative"
  }, /*#__PURE__*/react.createElement("div", {
    className: "absolute -top-8 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-primary to-transparent"
  }), /*#__PURE__*/react.createElement("div", {
    className: "px-4 pb-3 pt-1 max-w-4xl mx-auto w-full"
  }, /*#__PURE__*/react.createElement(chatinput["default"], {
    ref: chatInputRef,
    onSubmit: function (query, files, accepted, plan, llm) {
      if (accepted === void 0) {
        accepted = false;
      }
      scrollToBottom("smooth");
      if (run.status === "awaiting_input") {
        onInputResponse === null || onInputResponse === void 0 ? void 0 : onInputResponse(query, accepted, plan, files, llm);
      } else {
        onRunTask === null || onRunTask === void 0 ? void 0 : onRunTask(query, files, plan, true, llm);
      }
    },
    error: error !== null && error !== void 0 ? error : null,
    onCancel: onCancel,
    runStatus: run.status,
    isPlanMessage: isPlanMsg,
    onPause: onPause,
    enable_upload: enable_upload,
    inputRequest: run.input_request,
    onExecutePlan: onExecutePlan,
    sessionId: run.session_id,
    serverFilesPrefill: serverFilesPrefill
  })))), showPanel && agentConfig.panel.type !== 'none' && !isPanelMinimized && overviewSlot && /*#__PURE__*/react_dom.createPortal(/*#__PURE__*/react.createElement("div", {
    className: "h-full w-full overflow-auto"
  }, /*#__PURE__*/react.createElement(panels_AgentPanel, {
    panelConfig: agentConfig.panel,
    onMinimize: () => setIsPanelMinimized(true)

    // VNC Panel props
    ,

    vncProps: {
      images: messageImages.urls,
      imageTitles: messageImages.titles,
      currentIndex: messageImages.currentIndex || 0,
      onIndexChange: index => setMessageImages(prev => Object.assign({}, prev, {
        currentIndex: index
      })),
      novncPort: novncPort,
      onPause: onPause,
      runStatus: run.status,
      activeTab: detailViewerTab,
      onTabChange: setDetailViewerTab,
      detailViewerContainerId: DETAIL_VIEWER_CONTAINER_ID,
      onInputResponse: onInputResponse,
      isExpanded: detailViewerExpanded,
      onToggleExpand: () => setDetailViewerExpanded(!detailViewerExpanded)
    }

    // BESIII Panel props
    ,

    besiiiProps: {
      tasks: besiiiTasks,
      terminalOutput: terminalOutput,
      logs: logs,
      fileEvents: run.file_events || [],
      serverGlobalInfo: besiiiServerGlobalInfo,
      activeTab: besiiiActiveTab,
      onTabChange: setBesiiiActiveTab,
      isExpanded: detailViewerExpanded,
      onTaskClick: taskId => {
        // TODO: Handle task click
      },
      onSubtaskClick: (taskId, subtaskId) => {
        // TODO: Handle subtask click
      },
      onInputResponse
    }
  })), overviewSlot));
};
/* harmony default export */ var runview = (RunView);

/***/ }),

/***/ 46886:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   x: function() { return /* binding */ useRightPanelStore; }
/* harmony export */ });
/* harmony import */ var zustand__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(71511);
/** Tabs in the app right rail (运行概览 / 历史会话 / 文件空间) */const useRightPanelStore=(0,zustand__WEBPACK_IMPORTED_MODULE_0__/* .create */ .v)(set=>({isOpen:false,overviewSlot:null,layoutTab:'overview',setIsOpen:open=>set({isOpen:open}),setOverviewSlot:el=>set({overviewSlot:el}),setLayoutTab:tab=>set({layoutTab:tab})}));

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


/***/ }),

/***/ 8723:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ LoaderCircle; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const LoaderCircle = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("LoaderCircle", [
  ["path", { d: "M21 12a9 9 0 1 1-6.219-8.56", key: "13zald" }]
]);


//# sourceMappingURL=loader-circle.js.map


/***/ }),

/***/ 47504:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ MessageSquare; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const MessageSquare = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("MessageSquare", [
  ["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", key: "1lielz" }]
]);


//# sourceMappingURL=message-square.js.map


/***/ }),

/***/ 85265:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ RotateCw; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const RotateCw = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("RotateCw", [
  ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", key: "1p45f6" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }]
]);


//# sourceMappingURL=rotate-cw.js.map


/***/ })

}]);
//# sourceMappingURL=9eb3368a85963f3df9d2422e526fa644abd541c5-b4f18afcb29fa7daef21.js.map