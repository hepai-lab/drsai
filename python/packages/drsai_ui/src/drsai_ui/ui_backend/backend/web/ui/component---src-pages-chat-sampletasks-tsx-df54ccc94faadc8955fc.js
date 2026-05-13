"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[8990],{

/***/ 43044:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

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

/***/ 84152:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _components_features_Agents_useAgentInfo__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(43044);
/* harmony import */ var _hooks_provider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(92744);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(96540);



const SampleTasks = _ref => {
  var _agentInfo$examples, _agentInfo$examples2;
  let {
    onSelect
  } = _ref;
  const {
    0: isLoading,
    1: setIsLoading
  } = (0,react__WEBPACK_IMPORTED_MODULE_2__.useState)(false);
  const {
    0: isInputFocused,
    1: setIsInputFocused
  } = (0,react__WEBPACK_IMPORTED_MODULE_2__.useState)(true);
  const dropdownRef = (0,react__WEBPACK_IMPORTED_MODULE_2__.useRef)(null);
  const truncateText = function (text, maxWords) {
    if (maxWords === void 0) {
      maxWords = 20;
    }
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ") + "...";
  };
  const {
    user,
    darkMode
  } = (0,react__WEBPACK_IMPORTED_MODULE_2__.useContext)(_hooks_provider__WEBPACK_IMPORTED_MODULE_1__/* .appContext */ .v);
  const {
    agentInfo
  } = (0,_components_features_Agents_useAgentInfo__WEBPACK_IMPORTED_MODULE_0__/* .useAgentInfo */ .B)(user === null || user === void 0 ? void 0 : user.email);

  // 监听输入框焦点
  (0,react__WEBPACK_IMPORTED_MODULE_2__.useEffect)(() => {
    const handleFocus = () => {
      if (agentInfo !== null && agentInfo !== void 0 && agentInfo.examples && agentInfo.examples.length > 3) {
        setIsInputFocused(true);
      }
    };
    const handleBlur = e => {
      if (dropdownRef.current && dropdownRef.current.contains(e.relatedTarget)) {
        return;
      }
      setIsInputFocused(false);
    };
    const findTextarea = () => document.querySelector("#queryInput");
    const attach = ta => {
      ta.addEventListener("focus", handleFocus);
      ta.addEventListener("blur", handleBlur);
    };
    const textarea = findTextarea();
    if (textarea) {
      attach(textarea);
      return () => {
        textarea.removeEventListener("focus", handleFocus);
        textarea.removeEventListener("blur", handleBlur);
      };
    }
    const observer = new MutationObserver(() => {
      const ta = findTextarea();
      if (ta) {
        attach(ta);
        observer.disconnect();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    return () => observer.disconnect();
  }, [agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.examples]);

  // 点击外部隐藏
  (0,react__WEBPACK_IMPORTED_MODULE_2__.useEffect)(() => {
    if (!isInputFocused) return;
    const handleClickOutside = event => {
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) return;
      const textarea = document.querySelector("#queryInput");
      if (textarea && textarea.contains(event.target)) return;
      setIsInputFocused(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isInputFocused]);
  const handleTaskSelect = async task => {
    try {
      setIsLoading(true);
      onSelect(task);
      setIsInputFocused(false);
    } catch (_unused) {
      onSelect(task);
      setIsInputFocused(false);
    } finally {
      setIsLoading(false);
    }
  };
  const shouldShowDropdown = (agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.examples) && agentInfo.examples.length > 3;
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "w-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("style", null, "\n        .sample-tasks-scrollbar::-webkit-scrollbar { width: 6px; }\n        .sample-tasks-scrollbar::-webkit-scrollbar-track { background: transparent; }\n        .sample-tasks-scrollbar::-webkit-scrollbar-thumb {\n          background: rgba(156,163,175,0.3); border-radius: 3px;\n        }\n        .sample-tasks-scrollbar::-webkit-scrollbar-thumb:hover {\n          background: rgba(156,163,175,0.5);\n        }\n        .sample-tasks-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(156,163,175,0.3) transparent; }\n      "), shouldShowDropdown && isInputFocused && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    ref: dropdownRef,
    className: "w-full rounded-b-2xl overflow-hidden border-border-primary mt-1"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "max-h-[400px] flex flex-col items-center overflow-y-auto sample-tasks-scrollbar"
  }, agentInfo === null || agentInfo === void 0 ? void 0 : (_agentInfo$examples = agentInfo.examples) === null || _agentInfo$examples === void 0 ? void 0 : _agentInfo$examples.map((task, idx) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("button", {
    key: idx,
    className: "w-[94%] px-4 py-3 text-left transition-smooth text-primary hover:text-accent border-b last:border-b-0 group " + (darkMode === "dark" ? "hover:bg-[#1a1a1a] hover:rounded-lg" : "hover:bg-gray-50 hover:rounded-lg"),
    style: {
      borderBottomColor: "#434141"
    },
    onClick: () => handleTaskSelect(task),
    disabled: isLoading,
    type: "button",
    title: task
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "text-sm leading-loose line-clamp-2"
  }, truncateText(task, 22)))))), !shouldShowDropdown && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex flex-wrap justify-center gap-3 w-full mt-2"
  }, agentInfo === null || agentInfo === void 0 ? void 0 : (_agentInfo$examples2 = agentInfo.examples) === null || _agentInfo$examples2 === void 0 ? void 0 : _agentInfo$examples2.map((task, idx) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("button", {
    key: idx,
    className: "flex-1 min-w-[260px] max-w-[380px] rounded-2xl px-5 py-4 text-left transition-all duration-200 animate-fade-in group border " + (darkMode === "dark" ? "bg-white/[0.03] border-border-primary/50 hover:border-accent/40 hover:bg-white/[0.06]" : "bg-white/80 border-gray-200/70 hover:border-violet-300/70 hover:bg-violet-50/60") + " shadow-sm hover:shadow-modern",
    style: {
      animationDelay: idx * 0.08 + "s"
    },
    onClick: () => handleTaskSelect(task),
    disabled: isLoading,
    type: "button",
    title: "\u70B9\u51FB\u586B\u5145\u5230\u8F93\u5165\u6846\uFF0C\u53EF\u7F16\u8F91\u540E\u53D1\u9001"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "text-sm leading-relaxed text-secondary group-hover:text-primary transition-colors line-clamp-3"
  }, task), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex items-center gap-1.5 mt-3"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
    className: "text-[10px] font-medium text-secondary/50 group-hover:text-accent/70 transition-colors uppercase tracking-wide"
  }, isLoading ? "处理中..." : "点击使用"))))));
};
/* harmony default export */ __webpack_exports__["default"] = (SampleTasks);

/***/ }),

/***/ 41025:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

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

/***/ 87134:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   KU: function() { return /* binding */ createJSONStorage; },
/* harmony export */   Zr: function() { return /* binding */ persist; }
/* harmony export */ });
/* unused harmony exports combine, devtools, redux, subscribeWithSelector */
const reduxImpl = (reducer, initial) => (set, _get, api) => {
  api.dispatch = (action) => {
    set((state) => reducer(state, action), false, action);
    return action;
  };
  api.dispatchFromDevtools = true;
  return { dispatch: (...a) => api.dispatch(...a), ...initial };
};
const redux = (/* unused pure expression or super */ null && (reduxImpl));

const trackedConnections = /* @__PURE__ */ new Map();
const getTrackedConnectionState = (name) => {
  const api = trackedConnections.get(name);
  if (!api) return {};
  return Object.fromEntries(
    Object.entries(api.stores).map(([key, api2]) => [key, api2.getState()])
  );
};
const extractConnectionInformation = (store, extensionConnector, options) => {
  if (store === void 0) {
    return {
      type: "untracked",
      connection: extensionConnector.connect(options)
    };
  }
  const existingConnection = trackedConnections.get(options.name);
  if (existingConnection) {
    return { type: "tracked", store, ...existingConnection };
  }
  const newConnection = {
    connection: extensionConnector.connect(options),
    stores: {}
  };
  trackedConnections.set(options.name, newConnection);
  return { type: "tracked", store, ...newConnection };
};
const devtoolsImpl = (fn, devtoolsOptions = {}) => (set, get, api) => {
  const { enabled, anonymousActionType, store, ...options } = devtoolsOptions;
  let extensionConnector;
  try {
    extensionConnector = (enabled != null ? enabled : ( false ? 0 : void 0) !== "production") && window.__REDUX_DEVTOOLS_EXTENSION__;
  } catch (e) {
  }
  if (!extensionConnector) {
    return fn(set, get, api);
  }
  const { connection, ...connectionInformation } = extractConnectionInformation(store, extensionConnector, options);
  let isRecording = true;
  api.setState = (state, replace, nameOrAction) => {
    const r = set(state, replace);
    if (!isRecording) return r;
    const action = nameOrAction === void 0 ? { type: anonymousActionType || "anonymous" } : typeof nameOrAction === "string" ? { type: nameOrAction } : nameOrAction;
    if (store === void 0) {
      connection == null ? void 0 : connection.send(action, get());
      return r;
    }
    connection == null ? void 0 : connection.send(
      {
        ...action,
        type: `${store}/${action.type}`
      },
      {
        ...getTrackedConnectionState(options.name),
        [store]: api.getState()
      }
    );
    return r;
  };
  const setStateFromDevtools = (...a) => {
    const originalIsRecording = isRecording;
    isRecording = false;
    set(...a);
    isRecording = originalIsRecording;
  };
  const initialState = fn(api.setState, get, api);
  if (connectionInformation.type === "untracked") {
    connection == null ? void 0 : connection.init(initialState);
  } else {
    connectionInformation.stores[connectionInformation.store] = api;
    connection == null ? void 0 : connection.init(
      Object.fromEntries(
        Object.entries(connectionInformation.stores).map(([key, store2]) => [
          key,
          key === connectionInformation.store ? initialState : store2.getState()
        ])
      )
    );
  }
  if (api.dispatchFromDevtools && typeof api.dispatch === "function") {
    let didWarnAboutReservedActionType = false;
    const originalDispatch = api.dispatch;
    api.dispatch = (...a) => {
      if (( false ? 0 : void 0) !== "production" && a[0].type === "__setState" && !didWarnAboutReservedActionType) {
        console.warn(
          '[zustand devtools middleware] "__setState" action type is reserved to set state from the devtools. Avoid using it.'
        );
        didWarnAboutReservedActionType = true;
      }
      originalDispatch(...a);
    };
  }
  connection.subscribe((message) => {
    var _a;
    switch (message.type) {
      case "ACTION":
        if (typeof message.payload !== "string") {
          console.error(
            "[zustand devtools middleware] Unsupported action format"
          );
          return;
        }
        return parseJsonThen(
          message.payload,
          (action) => {
            if (action.type === "__setState") {
              if (store === void 0) {
                setStateFromDevtools(action.state);
                return;
              }
              if (Object.keys(action.state).length !== 1) {
                console.error(
                  `
                    [zustand devtools middleware] Unsupported __setState action format.
                    When using 'store' option in devtools(), the 'state' should have only one key, which is a value of 'store' that was passed in devtools(),
                    and value of this only key should be a state object. Example: { "type": "__setState", "state": { "abc123Store": { "foo": "bar" } } }
                    `
                );
              }
              const stateFromDevtools = action.state[store];
              if (stateFromDevtools === void 0 || stateFromDevtools === null) {
                return;
              }
              if (JSON.stringify(api.getState()) !== JSON.stringify(stateFromDevtools)) {
                setStateFromDevtools(stateFromDevtools);
              }
              return;
            }
            if (!api.dispatchFromDevtools) return;
            if (typeof api.dispatch !== "function") return;
            api.dispatch(action);
          }
        );
      case "DISPATCH":
        switch (message.payload.type) {
          case "RESET":
            setStateFromDevtools(initialState);
            if (store === void 0) {
              return connection == null ? void 0 : connection.init(api.getState());
            }
            return connection == null ? void 0 : connection.init(getTrackedConnectionState(options.name));
          case "COMMIT":
            if (store === void 0) {
              connection == null ? void 0 : connection.init(api.getState());
              return;
            }
            return connection == null ? void 0 : connection.init(getTrackedConnectionState(options.name));
          case "ROLLBACK":
            return parseJsonThen(message.state, (state) => {
              if (store === void 0) {
                setStateFromDevtools(state);
                connection == null ? void 0 : connection.init(api.getState());
                return;
              }
              setStateFromDevtools(state[store]);
              connection == null ? void 0 : connection.init(getTrackedConnectionState(options.name));
            });
          case "JUMP_TO_STATE":
          case "JUMP_TO_ACTION":
            return parseJsonThen(message.state, (state) => {
              if (store === void 0) {
                setStateFromDevtools(state);
                return;
              }
              if (JSON.stringify(api.getState()) !== JSON.stringify(state[store])) {
                setStateFromDevtools(state[store]);
              }
            });
          case "IMPORT_STATE": {
            const { nextLiftedState } = message.payload;
            const lastComputedState = (_a = nextLiftedState.computedStates.slice(-1)[0]) == null ? void 0 : _a.state;
            if (!lastComputedState) return;
            if (store === void 0) {
              setStateFromDevtools(lastComputedState);
            } else {
              setStateFromDevtools(lastComputedState[store]);
            }
            connection == null ? void 0 : connection.send(
              null,
              // FIXME no-any
              nextLiftedState
            );
            return;
          }
          case "PAUSE_RECORDING":
            return isRecording = !isRecording;
        }
        return;
    }
  });
  return initialState;
};
const devtools = (/* unused pure expression or super */ null && (devtoolsImpl));
const parseJsonThen = (stringified, f) => {
  let parsed;
  try {
    parsed = JSON.parse(stringified);
  } catch (e) {
    console.error(
      "[zustand devtools middleware] Could not parse the received json",
      e
    );
  }
  if (parsed !== void 0) f(parsed);
};

const subscribeWithSelectorImpl = (fn) => (set, get, api) => {
  const origSubscribe = api.subscribe;
  api.subscribe = (selector, optListener, options) => {
    let listener = selector;
    if (optListener) {
      const equalityFn = (options == null ? void 0 : options.equalityFn) || Object.is;
      let currentSlice = selector(api.getState());
      listener = (state) => {
        const nextSlice = selector(state);
        if (!equalityFn(currentSlice, nextSlice)) {
          const previousSlice = currentSlice;
          optListener(currentSlice = nextSlice, previousSlice);
        }
      };
      if (options == null ? void 0 : options.fireImmediately) {
        optListener(currentSlice, currentSlice);
      }
    }
    return origSubscribe(listener);
  };
  const initialState = fn(set, get, api);
  return initialState;
};
const subscribeWithSelector = (/* unused pure expression or super */ null && (subscribeWithSelectorImpl));

const combine = (initialState, create) => (...a) => Object.assign({}, initialState, create(...a));

function createJSONStorage(getStorage, options) {
  let storage;
  try {
    storage = getStorage();
  } catch (e) {
    return;
  }
  const persistStorage = {
    getItem: (name) => {
      var _a;
      const parse = (str2) => {
        if (str2 === null) {
          return null;
        }
        return JSON.parse(str2, options == null ? void 0 : options.reviver);
      };
      const str = (_a = storage.getItem(name)) != null ? _a : null;
      if (str instanceof Promise) {
        return str.then(parse);
      }
      return parse(str);
    },
    setItem: (name, newValue) => storage.setItem(
      name,
      JSON.stringify(newValue, options == null ? void 0 : options.replacer)
    ),
    removeItem: (name) => storage.removeItem(name)
  };
  return persistStorage;
}
const toThenable = (fn) => (input) => {
  try {
    const result = fn(input);
    if (result instanceof Promise) {
      return result;
    }
    return {
      then(onFulfilled) {
        return toThenable(onFulfilled)(result);
      },
      catch(_onRejected) {
        return this;
      }
    };
  } catch (e) {
    return {
      then(_onFulfilled) {
        return this;
      },
      catch(onRejected) {
        return toThenable(onRejected)(e);
      }
    };
  }
};
const persistImpl = (config, baseOptions) => (set, get, api) => {
  let options = {
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => state,
    version: 0,
    merge: (persistedState, currentState) => ({
      ...currentState,
      ...persistedState
    }),
    ...baseOptions
  };
  let hasHydrated = false;
  const hydrationListeners = /* @__PURE__ */ new Set();
  const finishHydrationListeners = /* @__PURE__ */ new Set();
  let storage = options.storage;
  if (!storage) {
    return config(
      (...args) => {
        console.warn(
          `[zustand persist middleware] Unable to update item '${options.name}', the given storage is currently unavailable.`
        );
        set(...args);
      },
      get,
      api
    );
  }
  const setItem = () => {
    const state = options.partialize({ ...get() });
    return storage.setItem(options.name, {
      state,
      version: options.version
    });
  };
  const savedSetState = api.setState;
  api.setState = (state, replace) => {
    savedSetState(state, replace);
    void setItem();
  };
  const configResult = config(
    (...args) => {
      set(...args);
      void setItem();
    },
    get,
    api
  );
  api.getInitialState = () => configResult;
  let stateFromStorage;
  const hydrate = () => {
    var _a, _b;
    if (!storage) return;
    hasHydrated = false;
    hydrationListeners.forEach((cb) => {
      var _a2;
      return cb((_a2 = get()) != null ? _a2 : configResult);
    });
    const postRehydrationCallback = ((_b = options.onRehydrateStorage) == null ? void 0 : _b.call(options, (_a = get()) != null ? _a : configResult)) || void 0;
    return toThenable(storage.getItem.bind(storage))(options.name).then((deserializedStorageValue) => {
      if (deserializedStorageValue) {
        if (typeof deserializedStorageValue.version === "number" && deserializedStorageValue.version !== options.version) {
          if (options.migrate) {
            const migration = options.migrate(
              deserializedStorageValue.state,
              deserializedStorageValue.version
            );
            if (migration instanceof Promise) {
              return migration.then((result) => [true, result]);
            }
            return [true, migration];
          }
          console.error(
            `State loaded from storage couldn't be migrated since no migrate function was provided`
          );
        } else {
          return [false, deserializedStorageValue.state];
        }
      }
      return [false, void 0];
    }).then((migrationResult) => {
      var _a2;
      const [migrated, migratedState] = migrationResult;
      stateFromStorage = options.merge(
        migratedState,
        (_a2 = get()) != null ? _a2 : configResult
      );
      set(stateFromStorage, true);
      if (migrated) {
        return setItem();
      }
    }).then(() => {
      postRehydrationCallback == null ? void 0 : postRehydrationCallback(stateFromStorage, void 0);
      stateFromStorage = get();
      hasHydrated = true;
      finishHydrationListeners.forEach((cb) => cb(stateFromStorage));
    }).catch((e) => {
      postRehydrationCallback == null ? void 0 : postRehydrationCallback(void 0, e);
    });
  };
  api.persist = {
    setOptions: (newOptions) => {
      options = {
        ...options,
        ...newOptions
      };
      if (newOptions.storage) {
        storage = newOptions.storage;
      }
    },
    clearStorage: () => {
      storage == null ? void 0 : storage.removeItem(options.name);
    },
    getOptions: () => options,
    rehydrate: () => hydrate(),
    hasHydrated: () => hasHydrated,
    onHydrate: (cb) => {
      hydrationListeners.add(cb);
      return () => {
        hydrationListeners.delete(cb);
      };
    },
    onFinishHydration: (cb) => {
      finishHydrationListeners.add(cb);
      return () => {
        finishHydrationListeners.delete(cb);
      };
    }
  };
  if (!options.skipHydration) {
    hydrate();
  }
  return stateFromStorage || configResult;
};
const persist = persistImpl;




/***/ }),

/***/ 71511:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  v: function() { return /* binding */ create; }
});

// UNUSED EXPORTS: useStore

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/zustand/esm/vanilla.mjs
const createStoreImpl = (createState) => {
  let state;
  const listeners = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };
  const getState = () => state;
  const getInitialState = () => initialState;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const api = { setState, getState, getInitialState, subscribe };
  const initialState = state = createState(setState, getState, api);
  return api;
};
const createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;



;// ./node_modules/zustand/esm/react.mjs



const identity = (arg) => arg;
function useStore(api, selector = identity) {
  const slice = react.useSyncExternalStore(
    api.subscribe,
    () => selector(api.getState()),
    () => selector(api.getInitialState())
  );
  react.useDebugValue(slice);
  return slice;
}
const createImpl = (createState) => {
  const api = createStore(createState);
  const useBoundStore = (selector) => useStore(api, selector);
  Object.assign(useBoundStore, api);
  return useBoundStore;
};
const create = (createState) => createState ? createImpl(createState) : createImpl;




/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-sampletasks-tsx-df54ccc94faadc8955fc.js.map