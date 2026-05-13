"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[3874],{

/***/ 70064:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ useClosable; },
/* harmony export */   d: function() { return /* binding */ pickClosable; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _ant_design_icons_es_icons_CloseOutlined__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(47852);
/* harmony import */ var rc_util_es_pickAttrs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(72065);
"use client";




function pickClosable(context) {
  if (!context) {
    return undefined;
  }
  return {
    closable: context.closable,
    closeIcon: context.closeIcon
  };
}
/** Convert `closable` and `closeIcon` to config object */
function useClosableConfig(closableCollection) {
  const {
    closable,
    closeIcon
  } = closableCollection || {};
  return react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    if (
    // If `closable`, whatever rest be should be true
    !closable && (closable === false || closeIcon === false || closeIcon === null)) {
      return false;
    }
    if (closable === undefined && closeIcon === undefined) {
      return null;
    }
    let closableConfig = {
      closeIcon: typeof closeIcon !== 'boolean' && closeIcon !== null ? closeIcon : undefined
    };
    if (closable && typeof closable === 'object') {
      closableConfig = Object.assign(Object.assign({}, closableConfig), closable);
    }
    return closableConfig;
  }, [closable, closeIcon]);
}
/**
 * Assign object without `undefined` field. Will skip if is `false`.
 * This helps to handle both closableConfig or false
 */
function assignWithoutUndefined() {
  const target = {};
  for (var _len = arguments.length, objList = new Array(_len), _key = 0; _key < _len; _key++) {
    objList[_key] = arguments[_key];
  }
  objList.forEach(obj => {
    if (obj) {
      Object.keys(obj).forEach(key => {
        if (obj[key] !== undefined) {
          target[key] = obj[key];
        }
      });
    }
  });
  return target;
}
/** Use same object to support `useMemo` optimization */
const EmptyFallbackCloseCollection = {};
function useClosable(propCloseCollection, contextCloseCollection) {
  let fallbackCloseCollection = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : EmptyFallbackCloseCollection;
  // Align the `props`, `context` `fallback` to config object first
  const propCloseConfig = useClosableConfig(propCloseCollection);
  const contextCloseConfig = useClosableConfig(contextCloseCollection);
  const closeBtnIsDisabled = typeof propCloseConfig !== 'boolean' ? !!(propCloseConfig === null || propCloseConfig === void 0 ? void 0 : propCloseConfig.disabled) : false;
  const mergedFallbackCloseCollection = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => Object.assign({
    closeIcon: /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_ant_design_icons_es_icons_CloseOutlined__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A, null)
  }, fallbackCloseCollection), [fallbackCloseCollection]);
  // Use fallback logic to fill the config
  const mergedClosableConfig = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    // ================ Props First ================
    // Skip if prop is disabled
    if (propCloseConfig === false) {
      return false;
    }
    if (propCloseConfig) {
      return assignWithoutUndefined(mergedFallbackCloseCollection, contextCloseConfig, propCloseConfig);
    }
    // =============== Context Second ==============
    // Skip if context is disabled
    if (contextCloseConfig === false) {
      return false;
    }
    if (contextCloseConfig) {
      return assignWithoutUndefined(mergedFallbackCloseCollection, contextCloseConfig);
    }
    // ============= Fallback Default ==============
    return !mergedFallbackCloseCollection.closable ? false : mergedFallbackCloseCollection;
  }, [propCloseConfig, contextCloseConfig, mergedFallbackCloseCollection]);
  // Calculate the final closeIcon
  return react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    if (mergedClosableConfig === false) {
      return [false, null, closeBtnIsDisabled];
    }
    const {
      closeIconRender
    } = mergedFallbackCloseCollection;
    const {
      closeIcon
    } = mergedClosableConfig;
    let mergedCloseIcon = closeIcon;
    if (mergedCloseIcon !== null && mergedCloseIcon !== undefined) {
      // Wrap the closeIcon if needed
      if (closeIconRender) {
        mergedCloseIcon = closeIconRender(closeIcon);
      }
      // Wrap the closeIcon with aria props
      const ariaProps = (0,rc_util_es_pickAttrs__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)(mergedClosableConfig, true);
      if (Object.keys(ariaProps).length) {
        mergedCloseIcon = /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.isValidElement(mergedCloseIcon) ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.cloneElement(mergedCloseIcon, ariaProps)) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", Object.assign({}, ariaProps), mergedCloseIcon));
      }
    }
    return [true, mergedCloseIcon, closeBtnIsDisabled];
  }, [mergedClosableConfig, mergedFallbackCloseCollection]);
}

/***/ }),

/***/ 31946:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ useAgentManager; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _store_modeConfig__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(41025);
/* harmony import */ var _utils_recentAgentsStorage__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(40490);
/* harmony import */ var _utils_agentPreference__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(12708);
/* harmony import */ var _api__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(39614);
const useAgentManager=userEmail=>{const{0:agents,1:setAgents}=(0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);const{0:isLoading,1:setIsLoading}=(0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);const{setSelectedAgent,setMode,setConfig,setAgentId,setAgentInfo}=(0,_store_modeConfig__WEBPACK_IMPORTED_MODULE_1__/* .useModeConfigStore */ .Q)();const fetchUserAgentsFromDb=(0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async()=>{if(!userEmail)return[];const resp=await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentWorkerAPI */ .Ml.getUserDefaultAgents(userEmail);return(resp===null||resp===void 0?void 0:resp.data)||[];},[userEmail]);const fetchAgentList=(0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async newAgents=>{if(!userEmail)return;const applyAgent=async agent=>{setSelectedAgent(agent);// 与 /agentmode 列表一致，先写入以便首屏渲染（getUserAgentById 依赖 UserAgents 可能尚未同步）
setAgentInfo(agent);setMode(agent.mode||"magentic-one");if(agent.id){setAgentId(agent.id);}try{const agentMode=agent.mode||"magentic-one";const agentConfig=await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentAPI */ .cM.getAgentConfig(userEmail,agentMode);if(agentConfig){setConfig(agentConfig.config);}}catch(error){console.warn("Failed to load agent config:",error);}};try{// 统一数据源：用 UserAgents 表（/user_default_agents/list），避免 /agentmode 与 /user_agents/{id} 不一致导致“智能体下线”
const res=newAgents||(await fetchUserAgentsFromDb());setAgents(res);if(res.length===0)return;let orgDefaultAgentId;let userDefaultAgentId;try{var _userDefault$stored_d;const[myOrg,userDefault]=await Promise.all([_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.getMyOrg(userEmail).catch(()=>null),_api__WEBPACK_IMPORTED_MODULE_2__/* .agentWorkerAPI */ .Ml.getUserDefaultAgent(userEmail).catch(()=>null)]);orgDefaultAgentId=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;// Treat personal default as "explicitly set by user".
// Backend may return a resolved fallback in default_agent_id (e.g. Dr.Sai General)
// even when the user never chose one; stored_default_agent_id preserves intent.
userDefaultAgentId=(_userDefault$stored_d=userDefault===null||userDefault===void 0?void 0:userDefault.stored_default_agent_id)!==null&&_userDefault$stored_d!==void 0?_userDefault$stored_d:null;}catch(_unused){orgDefaultAgentId=undefined;userDefaultAgentId=undefined;}const{selectedAgent,agentId,mode}=_store_modeConfig__WEBPACK_IMPORTED_MODULE_1__/* .useModeConfigStore */ .Q.getState();const policyDefault=(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_3__/* .pickLoginDefaultAgent */ .T)(res,orgDefaultAgentId,userDefaultAgentId);const fallbackAgent=policyDefault||(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_3__/* .pickPreferredAgentFromList */ .W)(res)||res.find(agent=>agent.mode==="magentic-one")||res[0];// 与 drsai-mode-config 对齐：优先 drsai.recentAgents[0]，再 persisted agentId，再 mode
const resolveLastUsedFromPersist=()=>{const recentFirstId=(0,_utils_recentAgentsStorage__WEBPACK_IMPORTED_MODULE_4__/* .getFirstRecentAgentId */ .O)();if(recentFirstId){const byRecent=res.find(a=>a.id===recentFirstId);if(byRecent)return byRecent;}if(agentId){const byId=res.find(a=>a.id===agentId);if(byId)return byId;}if(mode){return res.find(a=>a.mode===mode);}return undefined;};// 如果已经有选中的 agent，检查它是否仍然存在于新列表中
if(selectedAgent&&selectedAgent.mode){const existingAgent=res.find(agent=>agent.mode===selectedAgent.mode);if(existingAgent){var _existingAgent$id;setSelectedAgent(existingAgent);setAgentId((_existingAgent$id=existingAgent.id)!==null&&_existingAgent$id!==void 0?_existingAgent$id:null);setAgentInfo(existingAgent);return;}const lastUsed=resolveLastUsedFromPersist()||fallbackAgent;if(lastUsed){await applyAgent(lastUsed);}return;}// 刷新后 selectedAgent 未持久化时，用 agentId / mode 恢复上次使用的智能体
const lastUsed=resolveLastUsedFromPersist();if(lastUsed){await applyAgent(lastUsed);return;}if(fallbackAgent){await applyAgent(fallbackAgent);}}catch(error){console.error("Error fetching agent list:",error);}},[userEmail,setSelectedAgent,setMode,setConfig,setAgentId,setAgentInfo]);const deleteAgent=(0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async(id,onSuccess,onError)=>{if(!userEmail)return;try{setIsLoading(true);await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentAPI */ .cM.deleteMainAgent(userEmail,id);const updatedAgents=await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentAPI */ .cM.getAgentList(userEmail);setAgents(updatedAgents);onSuccess===null||onSuccess===void 0?void 0:onSuccess();}catch(error){console.error("Error deleting agent:",error);onError===null||onError===void 0?void 0:onError(error);}finally{setIsLoading(false);}},[userEmail]);return{agents,isLoading,fetchAgentList,deleteAgent};};

/***/ }),

/***/ 84456:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _hooks_provider__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(92744);
/* harmony import */ var _components_views_hooks_useAgentManager__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(31946);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(56914);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(81917);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(29799);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(96540);




const AgentManagementPage = () => {
  const {
    user
  } = (0,react__WEBPACK_IMPORTED_MODULE_2__.useContext)(_hooks_provider__WEBPACK_IMPORTED_MODULE_0__/* .appContext */ .v);
  const userId = user === null || user === void 0 ? void 0 : user.email;
  const {
    agents,
    fetchAgentList,
    isLoading
  } = (0,_components_views_hooks_useAgentManager__WEBPACK_IMPORTED_MODULE_1__/* .useAgentManager */ .A)(userId);
  (0,react__WEBPACK_IMPORTED_MODULE_2__.useEffect)(() => {
    if (!userId) return;
    fetchAgentList();
  }, [userId, fetchAgentList]);
  const dataSource = (0,react__WEBPACK_IMPORTED_MODULE_2__.useMemo)(() => {
    return (agents || []).filter(a => a && typeof a === "object").map(a => Object.assign({}, a, {
      key: String(a.id || a.mode || a.name)
    }));
  }, [agents]);
  const columns = (0,react__WEBPACK_IMPORTED_MODULE_2__.useMemo)(() => [{
    title: "名称",
    dataIndex: "name",
    key: "name",
    render: (name, row) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
      className: "flex flex-col"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
      className: "text-primary font-medium"
    }, name || row.mode || row.id), row.description ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
      className: "text-xs text-secondary mt-1 line-clamp-2"
    }, row.description) : null)
  }, {
    title: "模式",
    dataIndex: "mode",
    key: "mode",
    width: 160,
    render: mode => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
      className: "text-secondary"
    }, mode || "-")
  }, {
    title: "Owner",
    dataIndex: "owner",
    key: "owner",
    width: 140,
    render: owner => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
      className: "text-secondary"
    }, owner || "-")
  }, {
    title: "标签",
    dataIndex: "tags",
    key: "tags",
    width: 220,
    render: tags => {
      const list = Array.isArray(tags) ? tags : [];
      if (list.length === 0) return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
        className: "text-secondary"
      }, "-");
      return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
        className: "flex flex-wrap gap-1"
      }, list.slice(0, 6).map(t => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(antd__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .A, {
        key: String(t)
      }, String(t))));
    }
  }], []);
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "h-full min-h-0 flex flex-col p-4"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex items-start justify-between gap-3 mb-4"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "text-base font-medium text-primary"
  }, "\u667A\u80FD\u4F53\u7BA1\u7406"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "text-sm text-secondary mt-1"
  }, "\u5728\u8FD9\u91CC\u67E5\u770B\u4F60\u7684\u667A\u80FD\u4F53\u5217\u8868\u3002")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .Ay, {
    onClick: () => void fetchAgentList(),
    loading: isLoading
  }, "\u5237\u65B0")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex-1 min-h-0"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A, {
    size: "middle",
    loading: isLoading,
    columns: columns,
    dataSource: dataSource,
    pagination: {
      pageSize: 10,
      showSizeChanger: true
    },
    scroll: {
      y: "calc(100vh - 260px)"
    }
  })));
};
/* harmony default export */ __webpack_exports__["default"] = (AgentManagementPage);

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

/***/ 40490:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   O: function() { return /* binding */ getFirstRecentAgentId; },
/* harmony export */   f: function() { return /* binding */ DRSAI_RECENT_AGENTS_KEY; }
/* harmony export */ });
/** 与 AgentSquare / AgentCard 中「最近使用」列表共用同一 key */const DRSAI_RECENT_AGENTS_KEY="drsai.recentAgents";/** 最近使用列表第一条 agent id（即最近一次使用的智能体），用于与 drsai-mode-config.agentId 对齐 */function getFirstRecentAgentId(){try{if(typeof window==="undefined")return null;const raw=window.localStorage.getItem(DRSAI_RECENT_AGENTS_KEY);if(!raw)return null;const ids=JSON.parse(raw);if(!Array.isArray(ids)||ids.length===0)return null;const first=ids[0];return typeof first==="string"&&first.trim()?first.trim():null;}catch(_unused){return null;}}

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
//# sourceMappingURL=component---src-pages-agent-management-page-tsx-b3e10febef5f2b847f2d.js.map