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
const useAgentManager=userEmail=>{const{0:agents,1:setAgents}=(0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);const{0:isLoading,1:setIsLoading}=(0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);const{setSelectedAgent,setMode,setConfig,setAgentId,setAgentInfo}=(0,_store_modeConfig__WEBPACK_IMPORTED_MODULE_1__/* .useModeConfigStore */ .Q)();const fetchAgentList=(0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async newAgents=>{if(!userEmail)return;const applyAgent=async agent=>{setSelectedAgent(agent);// 与 /agentmode 列表一致，先写入以便首屏渲染（getUserAgentById 依赖 UserAgents 可能尚未同步）
setAgentInfo(agent);setMode(agent.mode||"magentic-one");if(agent.id){setAgentId(agent.id);}try{const agentMode=agent.mode||"magentic-one";const agentConfig=await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentAPI */ .cM.getAgentConfig(userEmail,agentMode);if(agentConfig){setConfig(agentConfig.config);}}catch(error){console.warn("Failed to load agent config:",error);}};try{// 如果提供了新的 agent 列表，直接使用它，否则重新获取
const res=newAgents||(await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentAPI */ .cM.getAgentList(userEmail));setAgents(res);if(res.length===0)return;let orgDefaultAgentId;let userDefaultAgentId;try{var _userDefault$stored_d;const[myOrg,userDefault]=await Promise.all([_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.getMyOrg(userEmail).catch(()=>null),_api__WEBPACK_IMPORTED_MODULE_2__/* .agentWorkerAPI */ .Ml.getUserDefaultAgent(userEmail).catch(()=>null)]);orgDefaultAgentId=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;// Treat personal default as "explicitly set by user".
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
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(77128);
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

/***/ })

}]);
//# sourceMappingURL=component---src-pages-agent-management-page-tsx-89a97b18f406d7ef6e5d.js.map