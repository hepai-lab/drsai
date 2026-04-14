(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[4064,5723,9245],{

/***/ 31946:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
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
const res=newAgents||(await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentAPI */ .cM.getAgentList(userEmail));setAgents(res);if(res.length===0)return;let orgDefaultAgentId;try{const myOrg=await _api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.getMyOrg(userEmail);orgDefaultAgentId=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;}catch(_unused){orgDefaultAgentId=undefined;}const{selectedAgent,agentId,mode}=_store_modeConfig__WEBPACK_IMPORTED_MODULE_1__/* .useModeConfigStore */ .Q.getState();const policyDefault=(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_3__/* .pickLoginDefaultAgent */ .Tw)(res,orgDefaultAgentId);const fallbackAgent=policyDefault||(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_3__/* .pickPreferredAgentFromList */ .WZ)(res)||res.find(agent=>agent.mode==="magentic-one")||res[0];// 与 drsai-mode-config 对齐：优先 drsai.recentAgents[0]，再 persisted agentId，再 mode
const resolveLastUsedFromPersist=()=>{const recentFirstId=(0,_utils_recentAgentsStorage__WEBPACK_IMPORTED_MODULE_4__/* .getFirstRecentAgentId */ .O)();if(recentFirstId){const byRecent=res.find(a=>a.id===recentFirstId);if(byRecent)return byRecent;}if(agentId){const byId=res.find(a=>a.id===agentId);if(byId)return byId;}if(mode){return res.find(a=>a.mode===mode);}return undefined;};// 如果已经有选中的 agent，检查它是否仍然存在于新列表中
if(selectedAgent&&selectedAgent.mode){const existingAgent=res.find(agent=>agent.mode===selectedAgent.mode);if(existingAgent){var _existingAgent$id;setSelectedAgent(existingAgent);setAgentId((_existingAgent$id=existingAgent.id)!==null&&_existingAgent$id!==void 0?_existingAgent$id:null);setAgentInfo(existingAgent);return;}const lastUsed=resolveLastUsedFromPersist()||fallbackAgent;if(lastUsed){await applyAgent(lastUsed);}return;}// 刷新后 selectedAgent 未持久化时，用 agentId / mode 恢复上次使用的智能体
const lastUsed=resolveLastUsedFromPersist();if(lastUsed){await applyAgent(lastUsed);return;}if(fallbackAgent){await applyAgent(fallbackAgent);}}catch(error){console.error("Error fetching agent list:",error);}},[userEmail,setSelectedAgent,setMode,setConfig,setAgentId,setAgentInfo]);const deleteAgent=(0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async(id,onSuccess,onError)=>{if(!userEmail)return;try{setIsLoading(true);await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentAPI */ .cM.deleteMainAgent(userEmail,id);const updatedAgents=await _api__WEBPACK_IMPORTED_MODULE_2__/* .agentAPI */ .cM.getAgentList(userEmail);setAgents(updatedAgents);onSuccess===null||onSuccess===void 0?void 0:onSuccess();}catch(error){console.error("Error deleting agent:",error);onError===null||onError===void 0?void 0:onError(error);}finally{setIsLoading(false);}},[userEmail]);return{agents,isLoading,fetchAgentList,deleteAgent};};

/***/ }),

/***/ 84456:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
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

/***/ }),

/***/ 35494:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(69036);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(56914);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(12609);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(46789);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(81917);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(77128);
/* harmony import */ var _hooks_provider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(92744);
/* harmony import */ var _components_views_api__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(39614);




const UserManagementPage = () => {
  const {
    user
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useContext)(_hooks_provider__WEBPACK_IMPORTED_MODULE_1__/* .appContext */ .v);
  const operatorUserId = (user === null || user === void 0 ? void 0 : user.email) || "";
  const {
    0: rows,
    1: setRows
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);
  const {
    0: loading,
    1: setLoading
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
  const {
    0: q,
    1: setQ
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)("");
  const [msgApi, holder] = antd__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .Ay.useMessage();
  const load = (0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async () => {
    if (!operatorUserId) {
      msgApi.error("未登录或缺少用户信息");
      return;
    }
    setLoading(true);
    try {
      const list = await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .userAPI */ .Eo.listUsers(operatorUserId);
      setRows(list.map(u => Object.assign({}, u, {
        key: u.user_id
      })));
    } catch (e) {
      msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "加载用户失败（可能你还不是管理员）");
    } finally {
      setLoading(false);
    }
  }, [operatorUserId, msgApi]);
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    if (!operatorUserId) return;
    void load();
  }, [operatorUserId, load]);
  const filtered = (0,react__WEBPACK_IMPORTED_MODULE_0__.useMemo)(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter(r => r.user_id.toLowerCase().includes(qq));
  }, [q, rows]);
  const columns = [{
    title: "用户",
    dataIndex: "user_id",
    key: "user_id",
    render: v => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "font-mono text-xs"
    }, v)
  }, {
    title: "来源",
    dataIndex: "auth_source",
    key: "auth_source",
    width: 120,
    render: v => v === "sso" ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
      color: "purple"
    }, "SSO") : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
      color: "blue"
    }, "LOCAL")
  }, {
    title: "合作组",
    key: "org",
    width: 160,
    render: (_, record) => record.org_slug ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "text-xs"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, null, record.org_slug), record.org_role ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "text-secondary ml-1"
    }, record.org_role) : null) : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "text-secondary text-xs"
    }, "\u2014")
  }, {
    title: "管理员",
    dataIndex: "is_admin",
    key: "is_admin",
    width: 120,
    render: (_, record) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A, {
      checked: record.is_admin,
      onChange: async next => {
        if (!operatorUserId) return;
        const prev = record.is_admin;
        setRows(old => old.map(r => r.user_id === record.user_id ? Object.assign({}, r, {
          is_admin: next
        }) : r));
        try {
          await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .userAPI */ .Eo.setAdmin(operatorUserId, record.user_id, next);
          msgApi.success(next ? "已设为管理员" : "已取消管理员");
        } catch (e) {
          setRows(old => old.map(r => r.user_id === record.user_id ? Object.assign({}, r, {
            is_admin: prev
          }) : r));
          msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "更新失败");
        }
      }
    })
  }];
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "h-full min-h-0 flex flex-col p-4"
  }, holder, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex items-center justify-between gap-3 mb-3"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-base font-semibold text-primary"
  }, "\u7528\u6237\u7BA1\u7406"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-xs text-secondary mt-1"
  }, "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650\u3002\u5F53\u524D\u64CD\u4F5C\u4EBA\uFF1A", /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
    className: "font-mono"
  }, operatorUserId || "-"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A, {
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "\u6309 user_id \u641C\u7D22",
    allowClear: true,
    style: {
      width: 220
    }
  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_7__/* ["default"] */ .Ay, {
    onClick: () => void load(),
    loading: loading,
    type: "primary"
  }, "\u5237\u65B0"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex-1 min-h-0"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_8__/* ["default"] */ .A, {
    size: "middle",
    bordered: true,
    loading: loading,
    columns: columns,
    dataSource: filtered,
    pagination: {
      pageSize: 20,
      showSizeChanger: true
    }
  })));
};
/* harmony default export */ __webpack_exports__["default"] = (UserManagementPage);

/***/ }),

/***/ 13907:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": function() { return /* binding */ NewChatView; }
/* harmony export */ });
/* harmony import */ var _components_features_Agents_useAgentInfo__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(43044);
/* harmony import */ var _hooks_provider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(92744);
/* harmony import */ var lucide_react__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(80827);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(96540);
/* harmony import */ var _chat_chatinput__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(71127);
/* harmony import */ var _sampletasks__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(84152);






/**
 * 新对话视图 - 当用户选中智能体但还没有创建会话时显示
 */
function NewChatView(_ref) {
  var _ref2, _agentInfo$name, _agentInfo$descriptio, _agentInfo$descriptio2;
  let {
    agent,
    onSubmit,
    serverFilesPrefill
  } = _ref;
  const chatInputRef = react__WEBPACK_IMPORTED_MODULE_2__.useRef(null);
  const [isSubmitting, setIsSubmitting] = react__WEBPACK_IMPORTED_MODULE_2__.useState(false);
  const [hasInputValue, setHasInputValue] = react__WEBPACK_IMPORTED_MODULE_2__.useState(false);
  const {
    user,
    darkMode
  } = react__WEBPACK_IMPORTED_MODULE_2__.useContext(_hooks_provider__WEBPACK_IMPORTED_MODULE_1__/* .appContext */ .v);
  const {
    agentInfo
  } = (0,_components_features_Agents_useAgentInfo__WEBPACK_IMPORTED_MODULE_0__/* .useAgentInfo */ .B)(user === null || user === void 0 ? void 0 : user.email);
  const isDark = darkMode === "dark";

  // 从 store 中获取 config 并合并到 agent 对象中

  const handleSubmit = async function (query, files, accepted, plan) {
    if (accepted === void 0) {
      accepted = false;
    }
    // 允许只发送文件（没有文本）
    if (isSubmitting || !query.trim() && (Array.isArray(files) ? files.length === 0 : false)) return;

    // 如果只有文件没有文字，添加默认提示
    let finalQuery = query;
    if (!query.trim() && Array.isArray(files) && files.length > 0) {
      finalQuery = "请帮我分析这些文件。";
    }
    setIsSubmitting(true);
    try {
      // 注意：文件上传逻辑已经在 ChatInput 组件内部处理了
      // 这里只需要调用 onSubmit，不需要再次上传文件
      // 传递完整的 agent，确保使用的是包含完整配置的 agent
      await onSubmit(agentInfo !== null && agentInfo !== void 0 ? agentInfo : agent, finalQuery, files, plan);
    } finally {
      setIsSubmitting(false);
    }
  };
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(react__WEBPACK_IMPORTED_MODULE_2__.Fragment, null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("style", null, "\n                .hide-scrollbar::-webkit-scrollbar {\n                    display: none;\n                }\n                .hide-scrollbar {\n                    -ms-overflow-style: none;\n                    scrollbar-width: none;\n                }\n            "), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex flex-col h-full overflow-hidden"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex-1 flex items-start justify-center overflow-y-auto hide-scrollbar pt-[15vh]"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "w-full max-w-4xl py-8 px-4"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "text-center space-y-8"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "animate-fade-in"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex flex-col items-center gap-4"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("h1", {
    className: "text-5xl font-bold"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
    className: "text-6xl bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent font-extrabold"
  }, (_ref2 = (_agentInfo$name = agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.name) !== null && _agentInfo$name !== void 0 ? _agentInfo$name : agent === null || agent === void 0 ? void 0 : agent.name) !== null && _ref2 !== void 0 ? _ref2 : "Dr.Sai")), ((_agentInfo$descriptio = agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.description) !== null && _agentInfo$descriptio !== void 0 ? _agentInfo$descriptio : agent === null || agent === void 0 ? void 0 : agent.description) && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("p", {
    className: "text-xl text-secondary"
  }, (_agentInfo$descriptio2 = agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.description) !== null && _agentInfo$descriptio2 !== void 0 ? _agentInfo$descriptio2 : agent === null || agent === void 0 ? void 0 : agent.description)))), serverFilesPrefill && serverFilesPrefill.length > 0 && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "w-full px-4 text-left"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "rounded-xl border px-4 py-3 text-sm " + (isDark ? "border-border-primary/35 bg-white/[0.04] text-primary" : "border-gray-200 bg-gray-50/90 text-gray-900")
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex items-center gap-2 font-medium mb-2"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A, {
    className: "w-4 h-4 shrink-0 opacity-80",
    "aria-hidden": true
  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", null, "\u5DF2\u4ECE\u5E93\u9009\u62E9 ", serverFilesPrefill.length, " \u4E2A\u6587\u4EF6\uFF08\u76F4\u63A5\u5F15\u7528\uFF0C\u65E0\u9700\u91CD\u65B0\u4E0A\u4F20\uFF09")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("ul", {
    className: "space-y-1 text-secondary text-xs sm:text-sm"
  }, serverFilesPrefill.map(f => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("li", {
    key: f.uuid,
    className: "truncate",
    title: f.name
  }, f.name))))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "w-full px-4"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(_chat_chatinput__WEBPACK_IMPORTED_MODULE_3__["default"], {
    ref: chatInputRef,
    onSubmit: handleSubmit,
    error: null,
    onCancel: () => {},
    runStatus: undefined,
    inputRequest: undefined,
    isPlanMessage: false,
    onPause: () => {},
    enable_upload: true,
    onExecutePlan: () => {},
    sessionId: -1,
    onTextChange: text => {
      setHasInputValue(text.trim().length > 0);
    },
    serverFilesPrefill: serverFilesPrefill
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "w-full px-4"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(_sampletasks__WEBPACK_IMPORTED_MODULE_4__["default"], {
    hasInputValue: hasInputValue,
    onSelect: task => {
      setTimeout(() => {
        if (chatInputRef.current) {
          chatInputRef.current.setValue(task);
        }
      }, 200);
    }
  })))))));
}

/***/ }),

/***/ 35660:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ pages; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/core-js/modules/es.array.flat-map.js
var es_array_flat_map = __webpack_require__(78350);
// EXTERNAL MODULE: ./node_modules/core-js/modules/es.array.sort.js
var es_array_sort = __webpack_require__(26910);
// EXTERNAL MODULE: ./node_modules/core-js/modules/es.array.unscopables.flat-map.js
var es_array_unscopables_flat_map = __webpack_require__(30237);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutPropertiesLoose.js
var objectWithoutPropertiesLoose = __webpack_require__(98587);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/antd/es/dropdown/index.js + 5 modules
var dropdown = __webpack_require__(30761);
// EXTERNAL MODULE: ./node_modules/antd/es/spin/index.js + 6 modules
var spin = __webpack_require__(34716);
// EXTERNAL MODULE: ./node_modules/react-dom/index.js
var react_dom = __webpack_require__(40961);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/search.js
var search = __webpack_require__(98445);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/trash-2.js
var trash_2 = __webpack_require__(32708);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/ellipsis-vertical.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const EllipsisVertical = (0,createLucideIcon/* default */.A)("EllipsisVertical", [
  ["circle", { cx: "12", cy: "12", r: "1", key: "41hilf" }],
  ["circle", { cx: "12", cy: "5", r: "1", key: "gxeob9" }],
  ["circle", { cx: "12", cy: "19", r: "1", key: "lyex9k" }]
]);


//# sourceMappingURL=ellipsis-vertical.js.map

// EXTERNAL MODULE: ./node_modules/yaml/browser/index.js
var browser = __webpack_require__(46670);
// EXTERNAL MODULE: ./node_modules/zustand/esm/react.mjs + 1 modules
var esm_react = __webpack_require__(71511);
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
const DEFAULT_AGENT_FLOW_SETTINGS={direction:"TB",showLabels:true,showGrid:true,showTokens:true,showMessages:true,showMiniMap:false};const useConfigStore=(0,esm_react/* create */.v)()((0,middleware/* persist */.Zr)(set=>({// Existing state
messages:[],setMessages:messages=>set({messages}),session:null,setSession:session=>set({session}),sessions:[],setSessions:sessions=>set({sessions:Array.isArray(sessions)?sessions:[]}),version:null,setVersion:version=>set({version}),connectionId:esm_browser_v4(),// Header state
header:{title:"",breadcrumbs:[]},setHeader:newHeader=>set(state=>({header:Object.assign({},state.header,newHeader)})),setBreadcrumbs:breadcrumbs=>set(state=>({header:Object.assign({},state.header,{breadcrumbs})})),// Add AgentFlow settings
agentFlow:DEFAULT_AGENT_FLOW_SETTINGS,setAgentFlowSettings:newSettings=>set(state=>({agentFlow:Object.assign({},state.agentFlow,newSettings)})),// Sidebar state and actions
sidebar:{isExpanded:true,isPinned:false},setSidebarState:newState=>set(state=>({sidebar:Object.assign({},state.sidebar,newState)})),collapseSidebar:()=>set(state=>({sidebar:Object.assign({},state.sidebar,{isExpanded:false})})),expandSidebar:()=>set(state=>({sidebar:Object.assign({},state.sidebar,{isExpanded:true})})),toggleSidebar:()=>set(state=>({sidebar:Object.assign({},state.sidebar,{isExpanded:!state.sidebar.isExpanded})}))}),{name:"app-sidebar-state",storage:(0,middleware/* createJSONStorage */.KU)(()=>localStorage),partialize:state=>({sidebar:state.sidebar,agentFlow:state.agentFlow,session:state.session})}));
// EXTERNAL MODULE: ./src/store/modeConfig.tsx
var modeConfig = __webpack_require__(41025);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/plus.js
var plus = __webpack_require__(80697);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/refresh-cw.js
var refresh_cw = __webpack_require__(15977);
// EXTERNAL MODULE: ./src/components/common/Button.tsx
var Button = __webpack_require__(2915);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
;// ./node_modules/lucide-react/dist/esm/icons/network.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Network = (0,createLucideIcon/* default */.A)("Network", [
  ["rect", { x: "16", y: "16", width: "6", height: "6", rx: "1", key: "4q2zg0" }],
  ["rect", { x: "2", y: "16", width: "6", height: "6", rx: "1", key: "8cvhb9" }],
  ["rect", { x: "9", y: "2", width: "6", height: "6", rx: "1", key: "1egb70" }],
  ["path", { d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", key: "1jsf9p" }],
  ["path", { d: "M12 12V8", key: "2874zd" }]
]);


//# sourceMappingURL=network.js.map

;// ./node_modules/lucide-react/dist/esm/icons/pencil.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Pencil = (0,createLucideIcon/* default */.A)("Pencil", [
  [
    "path",
    {
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      key: "1a8usu"
    }
  ],
  ["path", { d: "m15 5 4 4", key: "1mk7zo" }]
]);


//# sourceMappingURL=pencil.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/x.js
var x = __webpack_require__(48697);
// EXTERNAL MODULE: ./src/utils/recentAgentsStorage.ts
var recentAgentsStorage = __webpack_require__(40490);
;// ./src/components/features/Agents/AgentCard.tsx
const DEFAULT_AVATAR="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzRkM2RjMyIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPgo=";/** 统一图标：缩小版容器，logo 居中 contain */const ICON_BOX="flex h-7 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#fbf8ee] ring-1 ring-inset ring-[#f3cf63]";const pushRecentAgent=agentId=>{if(!agentId)return;try{const raw=window.localStorage.getItem(recentAgentsStorage/* DRSAI_RECENT_AGENTS_KEY */.f);const list=raw?JSON.parse(raw):[];const next=[agentId].concat((0,toConsumableArray/* default */.A)(list.filter(id=>id!==agentId))).slice(0,12);window.localStorage.setItem(recentAgentsStorage/* DRSAI_RECENT_AGENTS_KEY */.f,JSON.stringify(next));window.dispatchEvent(new CustomEvent("drsai:recentAgentsUpdated"));window.dispatchEvent(new CustomEvent("drsai:agentUsed",{detail:{agentId}}));}catch(_unused){// ignore storage errors (private mode, quota, etc.)
}};const AgentCard=_ref=>{let{agent,onEdit}=_ref;const{setAgentId,setMode}=(0,modeConfig/* useModeConfigStore */.Q)();const handleTryClick=async()=>{setAgentId(agent.id||"");setMode(agent.mode||"");pushRecentAgent(agent.id);window.dispatchEvent(new CustomEvent("switchToCurrentSession",{detail:{clearSession:true}}));};const handleRemoveClick=e=>{var _agent$onRemove;e.stopPropagation();(_agent$onRemove=agent.onRemove)===null||_agent$onRemove===void 0?void 0:_agent$onRemove.call(agent,agent.id);};const handleEditClick=e=>{e.stopPropagation();onEdit===null||onEdit===void 0?void 0:onEdit(agent.id);};const showToolbar=(agent.mode==="remote"||agent.mode==="custom")&&agent.onRemove||agent.mode==="custom"&&onEdit;const modeLabel=agent.mode==="remote"?{text:"远程",className:"bg-blue-100 text-blue-800 dark:bg-[#0b2a4a]/70 dark:text-[#bfe3ff] dark:shadow-[0_0_0_1px_rgba(56,189,248,0.22)]"}:agent.mode==="custom"?{text:"自定义",className:"bg-purple-100 text-purple-800 dark:bg-[#2a2342] dark:text-[#d9ccff] dark:shadow-[0_0_0_1px_rgba(167,139,250,0.22)]"}:{text:"官方",className:"bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-[#e4e8ff] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.10)]"};const modeDotClass=agent.mode==="custom"?"bg-[#a78bfa]/80":agent.mode==="remote"?"bg-[#38bdf8]/85":"bg-[#a78bfa]/75";return/*#__PURE__*/react.createElement("div",{className:"group relative flex min-h-[96px] w-full max-w-[300px] flex-col rounded-xl border border-[#c9b8ff] bg-[#f8f8fb] px-3 py-2.5 shadow-sm transition-all duration-200 hover:border-[#b8a4ff] hover:shadow-md dark:border-[#6550ba] dark:bg-[#181824]"},/*#__PURE__*/react.createElement("div",{className:"flex min-h-[1.125rem] items-start justify-between gap-1.5"},/*#__PURE__*/react.createElement("div",{className:"min-w-0 flex-1"},/*#__PURE__*/react.createElement("span",{className:"inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium "+modeLabel.className},agent.mode==="remote"?/*#__PURE__*/react.createElement(Network,{className:"mr-1 h-3 w-3 shrink-0"}):/*#__PURE__*/react.createElement("span",{className:"mr-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full "+modeDotClass}),modeLabel.text)),showToolbar&&/*#__PURE__*/react.createElement("div",{className:"flex shrink-0 items-center gap-1"},agent.mode==="custom"&&onEdit&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:handleEditClick,className:"flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/90 text-white opacity-0 transition-opacity hover:bg-blue-600 group-hover:opacity-100",title:"\u7F16\u8F91\u81EA\u5B9A\u4E49\u667A\u80FD\u4F53"},/*#__PURE__*/react.createElement(Pencil,{className:"h-3 w-3"})),(agent.mode==="remote"||agent.mode==="custom")&&agent.onRemove&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:handleRemoveClick,className:"flex h-6 w-6 items-center justify-center rounded-full bg-red-500/90 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100",title:"\u79FB\u9664\u667A\u80FD\u4F53"},/*#__PURE__*/react.createElement(x/* default */.A,{className:"h-3 w-3"})))),/*#__PURE__*/react.createElement("div",{className:"mt-1.5 flex items-center gap-2"},/*#__PURE__*/react.createElement("div",{className:ICON_BOX},/*#__PURE__*/react.createElement("img",{src:agent.logo,alt:"",className:"h-5 w-5 max-h-full max-w-full object-contain",onError:e=>{const target=e.target;target.src=DEFAULT_AVATAR;}})),/*#__PURE__*/react.createElement("div",{className:"min-w-0 flex-1"},/*#__PURE__*/react.createElement("h3",{className:"truncate text-[clamp(9px,1.1vw,15px)] font-semibold leading-[1.15] tracking-[-0.02em] text-[#233457] dark:text-[#e4e8ff]"},agent.name),/*#__PURE__*/react.createElement("p",{className:"mt-0.5 truncate text-[clamp(7px,0.8vw,10px)] leading-tight text-[#9aa2b2] dark:text-[#b6bdd0]"},agent.owner))),/*#__PURE__*/react.createElement("p",{className:"mt-2 line-clamp-2 text-left text-[clamp(8px,0.95vw,12px)] leading-[1.35] text-[#374156] dark:text-[#cfd6e9]"},agent.description),/*#__PURE__*/react.createElement("div",{className:"mt-2.5 flex justify-start"},/*#__PURE__*/react.createElement(Button/* Button */.$,{variant:"ghost",size:"sm",onClick:handleTryClick,className:"min-w-[4.5rem] !rounded-full !border !border-[#b5a1ff] !bg-[#ece9ff] !px-2.5 !py-1 !text-[clamp(8px,0.95vw,12px)] font-semibold tracking-[0.02em] text-[#5d3fcd] transition-colors hover:!translate-y-0 hover:!border-[#9f85ff] hover:!bg-[#e2dcff] hover:text-[#4d32b4] dark:!border-[#6f56c7] dark:!bg-[#2a2342] dark:text-[#bca8ff] dark:hover:!bg-[#32294d]"},"\u8BD5\u7528\u4E00\u4E0B")));};
;// ./node_modules/lucide-react/dist/esm/icons/sparkles.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Sparkles = (0,createLucideIcon/* default */.A)("Sparkles", [
  [
    "path",
    {
      d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
      key: "4pj2yx"
    }
  ],
  ["path", { d: "M20 3v4", key: "1olli1" }],
  ["path", { d: "M22 5h-4", key: "1gvqau" }],
  ["path", { d: "M4 17v2", key: "vumght" }],
  ["path", { d: "M5 18H3", key: "zchphs" }]
]);


//# sourceMappingURL=sparkles.js.map

// EXTERNAL MODULE: ./node_modules/antd/es/input/index.js + 22 modules
var input = __webpack_require__(46789);
// EXTERNAL MODULE: ./node_modules/antd/es/select/index.js + 40 modules
var es_select = __webpack_require__(85319);
;// ./src/components/common/agent-form/ToolConfigurationForm.tsx
const ToolConfigurationForm=_ref=>{let{config,index,onConfigChange,onRemove,canRemove,errors}=_ref;const{darkMode}=react.useContext(provider/* appContext */.v);// Tools options - 当前只支持 MCP，但可以配置多个 MCP
const toolsOptions=[{value:"MCP",label:"MCP"}];const renderInputField=function(label,value,onChange,type,placeholder,isRequired,error){if(type===void 0){type="text";}if(placeholder===void 0){placeholder="Value";}if(isRequired===void 0){isRequired=false;}const InputComponent=type==="password"?input/* default */.A.Password:input/* default */.A;return/*#__PURE__*/react.createElement("div",{className:"flex flex-col mb-3"},/*#__PURE__*/react.createElement("div",{className:"flex items-center"},/*#__PURE__*/react.createElement("label",{className:"\n                        w-20 text-sm font-medium\n                        "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#4a5568]")+"\n                    "},label,": ",isRequired&&/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement("div",{className:"flex-1 ml-4"},/*#__PURE__*/react.createElement(InputComponent,{value:value,onChange:e=>onChange(e.target.value),placeholder:placeholder,status:error?"error":undefined,style:{width:'100%'}}))),error&&/*#__PURE__*/react.createElement("p",{className:"mt-1 ml-24 text-xs text-red-500"},error));};// 根据选择的工具类型渲染不同的字段（当前只支持 MCP）
const renderFieldsByToolType=()=>{switch(config.type){case"MCP":return/*#__PURE__*/react.createElement(react.Fragment,null,renderInputField("URL",config.url,value=>onConfigChange(config.id,"url",value),"text","Value",true,errors===null||errors===void 0?void 0:errors.url),renderInputField("Token",config.token,value=>onConfigChange(config.id,"token",value),"password",false));default:// 兜底也按 MCP 渲染，保证表单可用
return/*#__PURE__*/react.createElement(react.Fragment,null,renderInputField("URL",config.url,value=>onConfigChange(config.id,"url",value),"text","Value",true,errors===null||errors===void 0?void 0:errors.url),renderInputField("Token",config.token,value=>onConfigChange(config.id,"token",value),"password",false));}};return/*#__PURE__*/react.createElement("div",{className:"\n                 rounded-md p-4\n                "+(darkMode==="dark"?"border-[#e5e5e530] bg-[#3a3a3a]":"border-[#e2e8f0] bg-[#f9fafb]")+"\n            "},/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-between mb-3"},/*#__PURE__*/react.createElement("span",{className:"\n                    text-sm font-medium\n                    "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#4a5568]")+"\n                "},"Configuration ",index+1),canRemove&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>onRemove(config.id),className:"\n                            p-1 rounded-full hover:bg-gray-100\n                            "+(darkMode==="dark"?"hover:bg-gray-400":"")+"\n                        "},/*#__PURE__*/react.createElement(x/* default */.A,{className:"w-4 h-4 text-gray-500 hover:text-white"}))),/*#__PURE__*/react.createElement("div",{className:"flex items-center mb-3"},/*#__PURE__*/react.createElement("label",{className:"\n                    w-20 text-sm font-medium\n                    "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#4a5568]")+"\n                "},"Type:"),/*#__PURE__*/react.createElement("div",{className:"flex-1 ml-4"},/*#__PURE__*/react.createElement(es_select/* default */.A,{value:config.type,onChange:value=>onConfigChange(config.id,"type",value),placeholder:"Select Tool Type",style:{width:'100%'},options:toolsOptions}))),renderFieldsByToolType());};/* harmony default export */ var agent_form_ToolConfigurationForm = (ToolConfigurationForm);
;// ./node_modules/lucide-react/dist/esm/icons/info.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Info = (0,createLucideIcon/* default */.A)("Info", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 16v-4", key: "1dtifu" }],
  ["path", { d: "M12 8h.01", key: "e9boi3" }]
]);


//# sourceMappingURL=info.js.map

;// ./src/components/common/agent-form/KnowledgeConfigurationForm.tsx
const KnowledgeConfigurationForm=_ref=>{let{config,index,onConfigChange,onRemove,canRemove=false,darkMode="light",showLabel=true,errors,provider:externalProvider,onProviderChange}=_ref;const handleGetApiKey=()=>{// 默认URL，可以根据实际需求修改
const defaultUrl="https://ragflow.ihep.ac.cn/user-setting/api";window.open(defaultUrl,"_blank");};const[dataSets,setDataSets]=react.useState([]);// Provider 选择：Ihep Knowledge / Local Knowledge
const[provider,setProvider]=react.useState(externalProvider||"ihep");// 使用 ref 存储 onProviderChange，避免依赖问题
const onProviderChangeRef=react.useRef(onProviderChange);react.useEffect(()=>{onProviderChangeRef.current=onProviderChange;},[onProviderChange]);// 如果外部传入 provider，使用外部的
const currentProvider=externalProvider||provider;react.useEffect(()=>{const fetchDataSets=async()=>{if(!config.ragflow_url||!config.ragflow_token)return;const baseUrl=config.ragflow_url.replace(/\/+$/,"");const response=await fetch(baseUrl+"/api/v1/datasets",{method:"GET",headers:{"Content-Type":"application/json",Authorization:"Bearer "+config.ragflow_token}});const data=await response.json();setDataSets((data.data||[]).map(item=>{var _item$id;return{label:item.name,value:(_item$id=item.id)!==null&&_item$id!==void 0?_item$id:item.name};}));};if(config.ragflow_url&&config.ragflow_token){fetchDataSets();}},[config.ragflow_url,config.ragflow_token]);// 如果是 IHEP Provider 且 ragflow_url 还是空，自动填充默认 URL
react.useEffect(()=>{if(currentProvider==="ihep"&&!config.ragflow_url){onConfigChange("ragflow_url","https://ragflow.ihep.ac.cn");}},[currentProvider,config.ragflow_url,onConfigChange]);// 当 provider 改变时，同步到外部（如果需要）
react.useEffect(()=>{if(externalProvider&&externalProvider!==provider){setProvider(externalProvider);// 如果外部 provider 是 ihep，则自动设置默认的 Ragflow URL
if(externalProvider==="ihep"){onConfigChange("ragflow_url","https://ragflow.ihep.ac.cn");}}},[externalProvider,provider,onConfigChange]);// 当 provider 改变时，通知父组件
react.useEffect(()=>{if(onProviderChangeRef.current){onProviderChangeRef.current(currentProvider);}},[currentProvider]);const renderContent=labelWidth=>/*#__PURE__*/react.createElement("div",{className:"flex-1 space-y-4 w-full items-center justify-between px-3 py-2 rounded-md\n                border transition-all duration-200  "+(darkMode==="dark"?"bg-[#444444] text-[#e5e5e5] border-[#e5e5e530] placeholder:text-gray-400":"bg-white text-[#4a5568] border-[#e2e8f0] placeholder:text-gray-400")+"  "},/*#__PURE__*/react.createElement("div",{className:"flex items-center"},/*#__PURE__*/react.createElement("label",{className:"\n                        "+labelWidth+" text-sm font-medium\n                        "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#4a5568]")+"\n                    "},"Provider:"),/*#__PURE__*/react.createElement("div",{className:"flex-1 ml-4"},/*#__PURE__*/react.createElement(es_select/* default */.A,{value:currentProvider,onChange:value=>{const newProvider=value;setProvider(newProvider);// 如果切换到非 local（即 ihep），自动设置默认 Ragflow URL
if(newProvider==="ihep"){onConfigChange("ragflow_url","https://ragflow.ihep.ac.cn");}},style:{width:'100%'},options:[{value:"ihep",label:"Ihep Knowledge"},{value:"local",label:"Local Knowledge"}]}))),currentProvider==="local"&&/*#__PURE__*/react.createElement("div",{className:"flex items-center"},/*#__PURE__*/react.createElement("label",{className:"\n                            "+labelWidth+" text-sm font-medium\n                            "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#4a5568]")+"\n                        "},"Knowledge URL: ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement("div",{className:"flex-1 ml-4"},/*#__PURE__*/react.createElement(input/* default */.A,{value:config.ragflow_url,onChange:e=>onConfigChange("ragflow_url",e.target.value),placeholder:"\u4F8B\u5982 http://localhost:886",status:errors!==null&&errors!==void 0&&errors.ragflow_url?"error":undefined,style:{width:'100%'}}),(errors===null||errors===void 0?void 0:errors.ragflow_url)&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.ragflow_url))),/*#__PURE__*/react.createElement("div",{className:"flex items-center"},/*#__PURE__*/react.createElement("label",{className:"\n                        "+labelWidth+" text-sm font-medium\n                        "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#4a5568]")+"\n                    "},"Ragflow Token: ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement("div",{className:"flex-1 ml-4 relative group"},/*#__PURE__*/react.createElement(input/* default */.A.Password,{value:config.ragflow_token,onChange:e=>onConfigChange("ragflow_token",e.target.value),placeholder:"\u8BF7\u8F93\u5165 Ragflow Token",status:errors!==null&&errors!==void 0&&errors.ragflow_token?"error":undefined,style:{width:'100%'}}),(errors===null||errors===void 0?void 0:errors.ragflow_token)&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500 absolute top-full left-0"},errors.ragflow_token),/*#__PURE__*/react.createElement("button",{type:"button",className:"\n                            absolute right-12 top-1/2 transform -translate-y-1/2 p-1 z-10\n                            "+(darkMode==="dark"?"text-[#e5e5e5] hover:text-[#4d3dc3]":"text-[#4a5568] hover:text-[#4d3dc3]")+"\n                        "},/*#__PURE__*/react.createElement(Info,{className:"w-4 h-4"}),/*#__PURE__*/react.createElement("div",{className:"\n                                absolute bottom-full right-0 mb-2 p-3 rounded-md text-sm w-64 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10\n                                "+(darkMode==="dark"?"bg-[#3a3a3a] text-[#e5e5e5] border border-[#e5e5e530]":"bg-[#f9fafb] text-[#4a5568] border border-[#e2e8f0]")+"\n                            "},/*#__PURE__*/react.createElement("p",null,"\u8BF7\u8F93\u5165\u7528\u4E8E\u8BBF\u95EE Ragflow \u7684 Token\u3002\u5982\u679C\u6CA1\u6709 Token\uFF0C \u8BF7\u70B9\u51FB\"\u83B7\u53D6\"\u6309\u94AE\u3002"),/*#__PURE__*/react.createElement("div",{className:"absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#3a3a3a]"}))),/*#__PURE__*/react.createElement("button",{type:"button",onClick:handleGetApiKey,className:"\n                            absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs rounded z-10\n                            bg-[#4d3dc3] text-white hover:bg-[#3d2db3] transition-colors\n                        "},"\u83B7\u53D6"))),/*#__PURE__*/react.createElement("div",{className:"flex items-center"},/*#__PURE__*/react.createElement("label",{className:"\n                        "+labelWidth+" text-sm font-medium\n                        "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#4a5568]")+"\n                    "},"Dataset IDs: ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement("div",{className:"flex-1 ml-4 relative group"},/*#__PURE__*/react.createElement(es_select/* default */.A,{mode:"multiple",allowClear:true,value:config.dataset_ids,onChange:values=>onConfigChange("dataset_ids",values),options:dataSets,placeholder:"请选择数据集名称",style:{width:"100%"},size:"middle",status:errors!==null&&errors!==void 0&&errors.dataset_ids?"error":undefined}),(errors===null||errors===void 0?void 0:errors.dataset_ids)&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.dataset_ids))));return/*#__PURE__*/react.createElement("div",{className:"space-y-4"},/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-between"},/*#__PURE__*/react.createElement("span",{className:"\n                        text-sm font-medium\n                        "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#4a5568]")+"\n                    "},"Knowledge ",index+1),canRemove&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:onRemove,className:"\n                            p-1 rounded-full hover:bg-gray-100\n                            "+(darkMode==="dark"?"hover:bg-gray-500":"")+"\n                        "},/*#__PURE__*/react.createElement(x/* default */.A,{className:"w-4 h-4 text-gray-500 hover:text-white"}))),showLabel?renderContent("w-24"):renderContent("w-20"));};/* harmony default export */ var agent_form_KnowledgeConfigurationForm = (KnowledgeConfigurationForm);
;// ./src/components/common/agent-form/CustomAgentForm.tsx
// 后端需要的最终数据结构
// 前端表单内部使用的数据结构
const HEPAI_DEFAULT_BASE_URL="https://aiapi.ihep.ac.cn/apiv2";const getModelSourceFromClient=modelClient=>{if(!modelClient){return"HepAI";}const baseUrl=(modelClient.base_url||"").trim();const apiKey=(modelClient.api_key||"").trim();const hasCustomConfig=Boolean(baseUrl&&baseUrl!==HEPAI_DEFAULT_BASE_URL)||Boolean(apiKey);return hasCustomConfig?"custom":"HepAI";};const CustomAgentForm=_ref=>{var _initialData$model_cl,_initialData$model_cl2,_initialData$model_cl3;let{onSubmit,onCancel,initialData,models}=_ref;const{darkMode}=react.useContext(provider/* appContext */.v);const{0:formData,1:setFormData}=(0,react.useState)({name:(initialData===null||initialData===void 0?void 0:initialData.name)||"",avatar:(initialData===null||initialData===void 0?void 0:initialData.avatar)||"",description:(initialData===null||initialData===void 0?void 0:initialData.description)||"",system_message:(initialData===null||initialData===void 0?void 0:initialData.system_message)||"",// 根据 model_client 的配置判断初始来源
model_source:getModelSourceFromClient(initialData===null||initialData===void 0?void 0:initialData.model_client),llmProvider:(initialData===null||initialData===void 0?void 0:(_initialData$model_cl=initialData.model_client)===null||_initialData$model_cl===void 0?void 0:_initialData$model_cl.model)||"",baseUrl:(initialData===null||initialData===void 0?void 0:(_initialData$model_cl2=initialData.model_client)===null||_initialData$model_cl2===void 0?void 0:_initialData$model_cl2.base_url)||"",apiKey:(initialData===null||initialData===void 0?void 0:(_initialData$model_cl3=initialData.model_client)===null||_initialData$model_cl3===void 0?void 0:_initialData$model_cl3.api_key)||"",toolConfigs:initialData!==null&&initialData!==void 0&&initialData.mcp_sse_list&&initialData.mcp_sse_list.length>0?initialData.mcp_sse_list:[],ragflow_configs:initialData!==null&&initialData!==void 0&&initialData.ragflow_configs&&initialData.ragflow_configs.length>0?initialData.ragflow_configs:[]});const{0:avatarError,1:setAvatarError}=(0,react.useState)(null);const avatarInputRef=(0,react.useRef)(null);const MAX_AVATAR_SIZE=1024*1024;// 1MB
// 表单验证错误状态
const{0:errors,1:setErrors}=(0,react.useState)({});// 工具配置错误状态
const{0:toolErrors,1:setToolErrors}=(0,react.useState)({});// 知识配置错误状态
const{0:knowledgeErrors,1:setKnowledgeErrors}=(0,react.useState)({});// 存储每个知识配置的 provider 状态
const{0:knowledgeProviders,1:setKnowledgeProviders}=(0,react.useState)({});const{0:llmModelOptions,1:setLlmModelOptions}=(0,react.useState)([]);(0,react.useEffect)(()=>{if(models){setLlmModelOptions(models.map(model=>({value:model.id,label:model.id})));}},[models]);// Provider 下拉框选项：优先使用远端加载的 models；如果暂时还没加载到数据，
// 也保证至少有一个“占位”选项，这样 UI 始终是下拉框而不是退回到输入框。
const providerOptions=react.useMemo(()=>llmModelOptions.length>0?llmModelOptions:formData.llmProvider?[{value:formData.llmProvider,label:formData.llmProvider}]:[{value:"",label:"自定义 Provider"}],[llmModelOptions,formData.llmProvider]);const handleInputChange=(field,value)=>{setFormData(prev=>{let updatedState=Object.assign({},prev,{[field]:value});if(field==="model_source"&&value==="HepAI"){updatedState=Object.assign({},updatedState,{baseUrl:"",apiKey:""});}return updatedState;});// 清除对应字段的错误
if(errors[field]){setErrors(prev=>{const newErrors=Object.assign({},prev);delete newErrors[field];return newErrors;});}if(field==="model_source"&&value==="HepAI"){setErrors(prev=>{if(!prev.baseUrl&&!prev.apiKey){return prev;}const newErrors=Object.assign({},prev);delete newErrors.baseUrl;delete newErrors.apiKey;return newErrors;});}};const handleToolConfigChange=(id,field,value)=>{setFormData(prev=>Object.assign({},prev,{toolConfigs:prev.toolConfigs.map(config=>config.id===id?Object.assign({},config,{[field]:value}):config)}));// 清除对应字段的错误
if(toolErrors[id]&&toolErrors[id][field]){setToolErrors(prev=>{const newErrors=Object.assign({},prev);if(newErrors[id]){delete newErrors[id][field];if(Object.keys(newErrors[id]).length===0){delete newErrors[id];}}return newErrors;});}};const addToolConfig=()=>{const newId=(formData.toolConfigs.length+1).toString();setFormData(prev=>Object.assign({},prev,{toolConfigs:[].concat((0,toConsumableArray/* default */.A)(prev.toolConfigs),[// 新增的配置同样默认是 MCP
{id:newId,type:"MCP",url:"",token:""}])}));};const removeToolConfig=id=>{setFormData(prev=>Object.assign({},prev,{toolConfigs:prev.toolConfigs.filter(config=>config.id!==id)}));setToolErrors(prev=>{const newErrors=Object.assign({},prev);delete newErrors[id];return newErrors;});};const handleKnowledgeConfigChange=(index,field,value)=>{setFormData(prev=>{var _configs$index;const baseConfigs=prev.ragflow_configs&&prev.ragflow_configs.length>0?prev.ragflow_configs:[{ragflow_url:"",ragflow_token:"",dataset_ids:[]}];const configs=(0,toConsumableArray/* default */.A)(baseConfigs);const current=(_configs$index=configs[index])!==null&&_configs$index!==void 0?_configs$index:{ragflow_url:"",ragflow_token:"",dataset_ids:[]};configs[index]=Object.assign({},current,{[field]:value});return Object.assign({},prev,{ragflow_configs:configs});});// 清除对应字段的错误
if(knowledgeErrors[index]&&knowledgeErrors[index][field]){setKnowledgeErrors(prev=>{const newErrors=Object.assign({},prev);if(newErrors[index]){delete newErrors[index][field];if(Object.keys(newErrors[index]).length===0){delete newErrors[index];}}return newErrors;});}};const addKnowledgeConfig=()=>{setFormData(prev=>Object.assign({},prev,{ragflow_configs:[].concat((0,toConsumableArray/* default */.A)(prev.ragflow_configs||[]),[{ragflow_url:"",ragflow_token:"",dataset_ids:[]}])}));};const removeKnowledgeConfig=index=>{setFormData(prev=>{const nextConfigs=(prev.ragflow_configs||[]).filter((_,i)=>i!==index);return Object.assign({},prev,{ragflow_configs:nextConfigs});});setKnowledgeErrors(prev=>{const next={};Object.entries(prev).forEach(_ref2=>{let[k,v]=_ref2;const idx=Number(k);if(idx===index)return;const newIdx=idx>index?idx-1:idx;next[newIdx]=v;});return next;});setKnowledgeProviders(prev=>{const next={};Object.entries(prev).forEach(_ref3=>{let[k,v]=_ref3;const idx=Number(k);if(idx===index)return;const newIdx=idx>index?idx-1:idx;next[newIdx]=v;});return next;});};const handleSubmit=e=>{var _formData$llmProvider,_formData$baseUrl,_formData$apiKey;e.preventDefault();// 验证必填字段
const newErrors={};if(!formData.name.trim()){newErrors.name="Name 是必填项";}if(!formData.system_message.trim()){newErrors.system_message="System Message 是必填项";}if(!formData.llmProvider.trim()){newErrors.llmProvider="Provider 是必填项";}// 如果是自定义模型，需要验证 baseUrl 和 apiKey
if(formData.model_source==="custom"){if(!formData.baseUrl.trim()){newErrors.baseUrl="Base URL 是必填项";}if(!formData.apiKey.trim()){newErrors.apiKey="API Key 是必填项";}}// 验证工具配置
const newToolErrors={};let hasToolErrors=false;formData.toolConfigs.forEach(tool=>{if(!tool.url.trim()){newToolErrors[tool.id]={url:"URL 是必填项"};hasToolErrors=true;}});// 验证知识配置
const newKnowledgeErrors={};let hasKnowledgeErrors=false;formData.ragflow_configs.forEach((cfg,index)=>{const cfgErrors={};if(!cfg.ragflow_token||!cfg.ragflow_token.trim()){cfgErrors.ragflow_token="Ragflow Token 是必填项";hasKnowledgeErrors=true;}if(!cfg.dataset_ids||cfg.dataset_ids.length===0){cfgErrors.dataset_ids="Dataset IDs 是必填项，请至少选择一个数据集";hasKnowledgeErrors=true;}// 如果 provider 是 local，验证 ragflow_url
const provider=knowledgeProviders[index]||"ihep";if(provider==="local"&&(!cfg.ragflow_url||!cfg.ragflow_url.trim())){cfgErrors.ragflow_url="Knowledge URL 是必填项（Local Knowledge 模式）";hasKnowledgeErrors=true;}if(Object.keys(cfgErrors).length>0){newKnowledgeErrors[index]=cfgErrors;}});setToolErrors(newToolErrors);setKnowledgeErrors(newKnowledgeErrors);setErrors(newErrors);// 如果有错误，不提交
if(Object.keys(newErrors).length>0||hasToolErrors||hasKnowledgeErrors){return;}const providerModel=((_formData$llmProvider=formData.llmProvider)===null||_formData$llmProvider===void 0?void 0:_formData$llmProvider.trim())||"gpt-4o-mini";const customBaseUrl=((_formData$baseUrl=formData.baseUrl)===null||_formData$baseUrl===void 0?void 0:_formData$baseUrl.trim())||"https://api.openai.com/v1";const customApiKey=((_formData$apiKey=formData.apiKey)===null||_formData$apiKey===void 0?void 0:_formData$apiKey.trim())||"sk-test-xxxx";const isHepAIModel=formData.model_source==="HepAI";const modelClient={model:providerModel,base_url:isHepAIModel?HEPAI_DEFAULT_BASE_URL:customBaseUrl,api_key:isHepAIModel?"":customApiKey};const payload={name:formData.name||"Test Agent",avatar:formData.avatar||undefined,description:formData.description||"用于测试后端接口的自定义 Agent",system_message:formData.system_message||"你是一个用于测试的智能体。",model_client:modelClient,mcp_sse_list:formData.toolConfigs||[],// 后端需要 ragflow_configs: KnowledgeConfig[]
ragflow_configs:formData.ragflow_configs||[]};onSubmit(payload);};const resetAvatarInput=()=>{if(avatarInputRef.current){avatarInputRef.current.value="";}};const triggerAvatarUpload=()=>{var _avatarInputRef$curre;(_avatarInputRef$curre=avatarInputRef.current)===null||_avatarInputRef$curre===void 0?void 0:_avatarInputRef$curre.click();};const handleAvatarFileChange=event=>{var _event$target$files;const file=(_event$target$files=event.target.files)===null||_event$target$files===void 0?void 0:_event$target$files[0];if(!file)return;if(!file.type.startsWith("image/")){setAvatarError("请上传图片文件");resetAvatarInput();return;}if(file.size>MAX_AVATAR_SIZE){setAvatarError("头像大小需小于 1MB");resetAvatarInput();return;}const reader=new FileReader();reader.onloadend=()=>{handleInputChange("avatar",reader.result);setAvatarError(null);resetAvatarInput();};reader.onerror=()=>{setAvatarError("上传头像失败，请重试");resetAvatarInput();};reader.readAsDataURL(file);};return/*#__PURE__*/react.createElement("div",{className:"\n            p-6 rounded-2xl border my-4 max-w-[960px] mx-auto\n            "+(darkMode==="dark"?"bg-[#1a1a1a] border-[#2f2f2f]":"bg-[#f9fafb] border-[#e5e7eb]")+"\n        "},/*#__PURE__*/react.createElement("h2",{className:"\n                text-lg font-semibold mb-4 text-left tracking-tight\n                "+(darkMode==="dark"?"text-[#f9fafb]":"text-[#111827]")+"\n            "},"Custom Your Agent"),/*#__PURE__*/react.createElement("form",{onSubmit:handleSubmit,className:"space-y-5 h-[420px] overflow-auto pr-1"},/*#__PURE__*/react.createElement("div",{className:"\n                    rounded-2xl border flex flex-col gap-4 p-5\n                    "+(darkMode==="dark"?"border-[#2f2f2f] bg-[#151515] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]":"border-[#e5e7eb] bg-white shadow-sm")+"\n                "},/*#__PURE__*/react.createElement("header",{className:"flex items-center justify-between"},/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("p",{className:"text-sm font-semibold tracking-tight "+(darkMode==="dark"?"text-white":"text-[#111827]")},"Basic Info"))),/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-6 flex-wrap"},/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center gap-2"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:triggerAvatarUpload,className:"\n                                    w-14 h-14 rounded-full border-2 flex items-center justify-center transition-colors relative overflow-hidden\n                                    "+(darkMode==="dark"?"border-[#4d3dc3]/40 bg-[#333333] hover:border-[#4d3dc3]":"border-[#d6d3f8] bg-[#f5f4ff] hover:border-[#4d3dc3]")+"\n                                "},formData.avatar?/*#__PURE__*/react.createElement("img",{src:formData.avatar,alt:"Agent avatar preview",className:"w-full h-full object-cover rounded-full"}):/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center text-xs text-[#4d3dc3]"},/*#__PURE__*/react.createElement(plus/* default */.A,{className:"w-4 h-4"}),"\u4E0A\u4F20")),/*#__PURE__*/react.createElement("input",{ref:avatarInputRef,type:"file",accept:"image/*",className:"hidden",onChange:handleAvatarFileChange})),/*#__PURE__*/react.createElement("div",{className:"w-48"},/*#__PURE__*/react.createElement("label",{className:"text-xs font-medium uppercase tracking-wide "+(darkMode==="dark"?"text-gray-400":"text-gray-500")},"Name ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement(input/* default */.A,{value:formData.name,onChange:e=>handleInputChange("name",e.target.value),placeholder:"Set name",status:errors.name?"error":undefined,style:{marginTop:'0.25rem',width:'100%'}}),errors.name&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.name)),/*#__PURE__*/react.createElement("div",{className:"flex flex-col gap-1 flex-1 min-w-[200px]"},/*#__PURE__*/react.createElement("label",{className:"text-xs font-medium uppercase tracking-wide "+(darkMode==="dark"?"text-gray-400":"text-gray-500")},"Description"),/*#__PURE__*/react.createElement(input/* default */.A,{value:formData.description,onChange:e=>handleInputChange("description",e.target.value),placeholder:"\u4E00\u53E5\u8BDD\u63CF\u8FF0 Agent \u7684\u98CE\u683C\u6216\u7528\u9014",status:errors.description?"error":undefined,style:{width:'100%'}}),errors.description&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.description))),/*#__PURE__*/react.createElement("div",{className:"grid grid-cols-1 gap-3 w-full"},/*#__PURE__*/react.createElement("div",{className:"flex flex-col gap-1 flex-shrink-0"},/*#__PURE__*/react.createElement("label",{className:"text-xs font-medium uppercase tracking-wide "+(darkMode==="dark"?"text-gray-400":"text-gray-500")},"System Message ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement(input/* default */.A,{value:formData.system_message,onChange:e=>handleInputChange("system_message",e.target.value),placeholder:"\u53EF\u9009\u63D0\u793A\uFF1A\u4F8B\u5982\u59CB\u7EC8\u4EE5\u6295\u7814\u987E\u95EE\u56DE\u7B54",status:errors.system_message?"error":undefined,style:{width:'100%'}}),errors.system_message&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.system_message)))),/*#__PURE__*/react.createElement("div",{className:"\n                    rounded-2xl border flex flex-col gap-4 p-5\n                    "+(darkMode==="dark"?"border-[#2f2f2f] bg-[#151515] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]":"border-[#e5e7eb] bg-white shadow-sm")+"\n                "},/*#__PURE__*/react.createElement("header",{className:"flex items-center justify-between"},/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("p",{className:"text-sm font-semibold tracking-tight "+(darkMode==="dark"?"text-white":"text-[#111827]")},"Model Client"),/*#__PURE__*/react.createElement("p",{className:"text-xs "+(darkMode==="dark"?"text-gray-500":"text-gray-500")},"\u7531 Provider + Base URL + API Key \u5171\u540C\u51B3\u5B9A Agent \u7684\u63A8\u7406\u5927\u8111\u3002"))),/*#__PURE__*/react.createElement("div",{className:"flex flex-col gap-3"},/*#__PURE__*/react.createElement("div",{className:"flex flex-col gap-1"},/*#__PURE__*/react.createElement("span",{className:"text-xs font-medium uppercase tracking-wide "+(darkMode==="dark"?"text-gray-400":"text-gray-500")},"model_source"),/*#__PURE__*/react.createElement(es_select/* default */.A,{value:formData.model_source||"HepAI",onChange:value=>handleInputChange("model_source",value),placeholder:"\u9009\u62E9\u6A21\u578B\u6765\u6E90",style:{width:'100%'},options:[{value:"HepAI",label:"HepAI"},{value:"custom",label:"自定义模型"}]})),/*#__PURE__*/react.createElement("div",{className:"flex flex-col gap-1"},/*#__PURE__*/react.createElement("span",{className:"text-xs font-medium uppercase tracking-wide "+(darkMode==="dark"?"text-gray-400":"text-gray-500")},"Provider ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),formData.model_source==="HepAI"?/*#__PURE__*/react.createElement(es_select/* default */.A,{value:formData.llmProvider||undefined,onChange:value=>handleInputChange("llmProvider",value),placeholder:"\u9009\u62E9 Provider",showSearch:true,style:{width:'100%'},options:providerOptions,filterOption:(input,option)=>{var _option$label,_option$value;return((_option$label=option===null||option===void 0?void 0:option.label)!==null&&_option$label!==void 0?_option$label:'').toLowerCase().includes(input.toLowerCase())||((_option$value=option===null||option===void 0?void 0:option.value)!==null&&_option$value!==void 0?_option$value:'').toLowerCase().includes(input.toLowerCase());},className:"\n                                            "+(errors.llmProvider?"ant-select-error":"")+"\n                                        ",status:errors.llmProvider?"error":undefined}):/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(input/* default */.A,{value:formData.llmProvider,onChange:e=>handleInputChange("llmProvider",e.target.value),placeholder:"OpenAI / Qwen",status:errors.llmProvider?"error":undefined,style:{width:'100%'}}),errors.llmProvider&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.llmProvider)),formData.model_source==="HepAI"&&errors.llmProvider&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.llmProvider)),formData.model_source==="custom"&&/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"flex flex-col gap-1"},/*#__PURE__*/react.createElement("span",{className:"text-xs font-medium uppercase tracking-wide "+(darkMode==="dark"?"text-gray-400":"text-gray-500")},"Base URL ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement(input/* default */.A,{value:formData.baseUrl,onChange:e=>handleInputChange("baseUrl",e.target.value),placeholder:"https://api.example.com",status:errors.baseUrl?"error":undefined,style:{width:'100%'}}),errors.baseUrl&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.baseUrl)),/*#__PURE__*/react.createElement("div",{className:"flex flex-col gap-1"},/*#__PURE__*/react.createElement("span",{className:"text-xs font-medium uppercase tracking-wide "+(darkMode==="dark"?"text-gray-400":"text-gray-500")},"API Key ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement(input/* default */.A.Password,{value:formData.apiKey,onChange:e=>handleInputChange("apiKey",e.target.value),placeholder:"sk-***",status:errors.apiKey?"error":undefined,style:{width:'100%'}}),errors.apiKey&&/*#__PURE__*/react.createElement("p",{className:"mt-1 text-xs text-red-500"},errors.apiKey))))),/*#__PURE__*/react.createElement("div",{className:darkMode==="dark"?"rounded-2xl border flex flex-col gap-4 p-5 border-[#2f2f2f] bg-[#151515] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]":"rounded-2xl border flex flex-col gap-4 p-5 border-[#e5e7eb] bg-white shadow-sm"},/*#__PURE__*/react.createElement("header",{className:"flex items-center justify-between"},/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("p",{className:"text-sm font-semibold tracking-tight "+(darkMode==="dark"?"text-white":"text-[#111827]")},"Tools"),/*#__PURE__*/react.createElement("p",{className:"text-xs "+(darkMode==="dark"?"text-gray-500":"text-gray-500")},"\u4E3A Agent \u6302\u8F7D\u4E00\u4E2A\u6216\u591A\u4E2A\u5DE5\u5177\u94FE")),/*#__PURE__*/react.createElement("button",{type:"button",onClick:addToolConfig,className:"\n                                inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium\n                                "+(darkMode==="dark"?"bg-[#4d3dc3] text-white hover:bg-[#3d2db3]":"bg-[#4d3dc3] text-white hover:bg-[#3d2db3]")+"\n                                transition-colors\n                            "},/*#__PURE__*/react.createElement(plus/* default */.A,{className:"w-3 h-3"}),"\u6DFB\u52A0\u5DE5\u5177")),formData.toolConfigs.length>0&&/*#__PURE__*/react.createElement("div",{className:"space-y-3"},formData.toolConfigs.map((config,index)=>/*#__PURE__*/react.createElement("div",{key:config.id,className:"\n                                        rounded-xl border px-3 py-3\n                                        "+(darkMode==="dark"?"border-[#2f2f2f] bg-[#101010]":"border-[#e5e7eb] bg-[#f9fafb]")+"\n                                    "},/*#__PURE__*/react.createElement(agent_form_ToolConfigurationForm,{config:config,index:index,onConfigChange:handleToolConfigChange,onRemove:removeToolConfig,canRemove:formData.toolConfigs.length>0,errors:toolErrors[config.id]}))))),/*#__PURE__*/react.createElement("div",{className:"\n                    rounded-2xl border flex flex-col gap-4 p-5 mb-2\n                    "+(darkMode==="dark"?"border-[#2f2f2f] bg-[#151515] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]":"border-[#e5e7eb] bg-white shadow-sm")+"\n                "},/*#__PURE__*/react.createElement("header",{className:"flex items-center justify-between"},/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("p",{className:"text-sm font-semibold tracking-tight "+(darkMode==="dark"?"text-white":"text-[#111827]")},"Knowledge"),/*#__PURE__*/react.createElement("p",{className:"text-xs "+(darkMode==="dark"?"text-gray-500":"text-gray-500")},"\u8FDE\u63A5\u5230\u4E00\u4E2A\u6216\u591A\u4E2A\u77E5\u8BC6\u6E90\uFF0C\u589E\u5F3A RAG \u80FD\u529B")),/*#__PURE__*/react.createElement("button",{type:"button",onClick:addKnowledgeConfig,className:"\n                                inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium\n                                "+(darkMode==="dark"?"bg-[#4d3dc3] text-white hover:bg-[#3d2db3]":"bg-[#4d3dc3] text-white hover:bg-[#3d2db3]")+"\n                                transition-colors\n                            "},/*#__PURE__*/react.createElement(plus/* default */.A,{className:"w-3 h-3"}),"\u589E\u52A0KnowledgeBase")),formData.ragflow_configs.length>0&&/*#__PURE__*/react.createElement(react.Fragment,null,formData.ragflow_configs.map((cfg,index)=>/*#__PURE__*/react.createElement("div",{key:index,className:index===0?"":"mt-4"},/*#__PURE__*/react.createElement(agent_form_KnowledgeConfigurationForm,{index:index,config:cfg,onConfigChange:(field,value)=>handleKnowledgeConfigChange(index,field,value),onRemove:()=>removeKnowledgeConfig(index),canRemove:formData.ragflow_configs.length>0,darkMode:darkMode,showLabel:index===0,errors:knowledgeErrors[index],onProviderChange:provider=>{setKnowledgeProviders(prev=>Object.assign({},prev,{[index]:provider}));}}))))),/*#__PURE__*/react.createElement("div",{className:"flex justify-end gap-3 pt-4"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:onCancel,className:"\n                            px-4 py-2 rounded-md text-sm font-medium border\n                            "+(darkMode==="dark"?"border-[#4b5563] text-[#e5e5e5] hover:bg-[#111827]":"border-[#d1d5db] text-[#374151] bg-white hover:bg-gray-50")+"\n                            transition-colors\n                        "},"Cancel"),/*#__PURE__*/react.createElement("button",{type:"submit",className:"\n                            px-5 py-2 rounded-md text-sm font-medium\n                            bg-[#4d3dc3] text-white hover:bg-[#3d2db3]\n                            shadow-sm hover:shadow-md transition-all\n                        "},"Save"))));};/* harmony default export */ var agent_form_CustomAgentForm = (CustomAgentForm);
;// ./src/components/features/Agents/CustomAgentModal.tsx
const CustomAgentModal=_ref=>{let{isOpen,onClose,onSave,models,isLoadingModels=false,onReloadModels,isSaving=false,initialData,title}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const{0:modalRoot,1:setModalRoot}=(0,react.useState)(null);const{0:formInstanceKey,1:setFormInstanceKey}=(0,react.useState)(0);(0,react.useEffect)(()=>{if(isOpen){const root=document.getElementById("___gatsby")||document.body;setModalRoot(root);}},[isOpen]);(0,react.useEffect)(()=>{if(!isOpen){setFormInstanceKey(prev=>prev+1);}},[isOpen]);if(!isOpen||!modalRoot)return null;const renderHeaderAction=()=>{if(!onReloadModels)return null;return/*#__PURE__*/react.createElement("button",{type:"button",onClick:onReloadModels,disabled:isLoadingModels,className:"inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg border transition-colors "+(darkMode==="dark"?"border-gray-700 text-gray-200 hover:bg-gray-800 disabled:text-gray-500":"border-gray-200 text-gray-600 hover:bg-gray-100 disabled:text-gray-400")},/*#__PURE__*/react.createElement(refresh_cw/* default */.A,{className:"h-3.5 w-3.5 "+(isLoadingModels?"animate-spin":"")}),isLoadingModels?"刷新中":"刷新模型");};return/*#__PURE__*/react_dom.createPortal(/*#__PURE__*/react.createElement("div",{className:"fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm",style:{zIndex:1000}},/*#__PURE__*/react.createElement("div",{className:"relative rounded-2xl shadow-xl border w-[800px] max-w-[95vw] max-h-[92vh] overflow-hidden flex flex-col "+(darkMode==="dark"?"bg-[#101010] border-gray-800":"bg-white border-gray-200"),onClick:e=>e.stopPropagation()},/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800"},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-3"},/*#__PURE__*/react.createElement("div",{className:"p-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white"},/*#__PURE__*/react.createElement(Sparkles,{className:"h-4 w-4"})),/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("h2",{className:"text-lg font-semibold "+(darkMode==="dark"?"text-gray-100":"text-gray-800")},title||"自定义智能体"),/*#__PURE__*/react.createElement("p",{className:"text-xs text-gray-500 dark:text-gray-400"},"\u914D\u7F6E\u591A\u6A21\u6001\u80FD\u529B\u3001\u5DE5\u5177\u94FE\u4EE5\u53CA\u77E5\u8BC6\u5E93\uFF0C\u6253\u9020\u4E2A\u6027\u5316\u667A\u80FD\u4F53\u3002"))),/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2"},renderHeaderAction(),/*#__PURE__*/react.createElement("button",{type:"button",onClick:onClose,className:"p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors","aria-label":"\u5173\u95ED"},/*#__PURE__*/react.createElement(x/* default */.A,{className:"h-4 w-4 text-gray-500 dark:text-gray-300"})))),/*#__PURE__*/react.createElement("div",{className:"flex-1 overflow-auto p-5"},!models.length&&!isLoadingModels&&/*#__PURE__*/react.createElement("div",{className:"mb-4 text-xs rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200"},"\u6682\u672A\u68C0\u6D4B\u5230\u6A21\u578B\u5217\u8868\uFF0C\u53EF\u70B9\u51FB\u53F3\u4E0A\u89D2\u5237\u65B0\u6216\u76F4\u63A5\u5728\u8F93\u5165\u6846\u4E2D\u586B\u5165\u6A21\u578B\u540D\u79F0\u3002"),isLoadingModels?/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-64 text-sm text-gray-500 dark:text-gray-300"},/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center gap-3"},/*#__PURE__*/react.createElement("div",{className:"w-10 h-10 border-2 border-current border-t-transparent rounded-full animate-spin"}),"\u6B63\u5728\u52A0\u8F7D\u53EF\u7528\u6A21\u578B\uFF0C\u8BF7\u7A0D\u5019...")):/*#__PURE__*/react.createElement(agent_form_CustomAgentForm,{key:formInstanceKey,models:models,onSubmit:onSave,onCancel:onClose,initialData:initialData})),isSaving&&/*#__PURE__*/react.createElement("div",{className:"absolute inset-0 flex items-center justify-center bg-black/30 rounded-2xl"},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2 text-white text-sm"},/*#__PURE__*/react.createElement("div",{className:"w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"}),"\u4FDD\u5B58\u4E2D...")))),modalRoot);};/* harmony default export */ var Agents_CustomAgentModal = (CustomAgentModal);
;// ./node_modules/lucide-react/dist/esm/icons/wifi.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Wifi = (0,createLucideIcon/* default */.A)("Wifi", [
  ["path", { d: "M12 20h.01", key: "zekei9" }],
  ["path", { d: "M2 8.82a15 15 0 0 1 20 0", key: "dnpr2z" }],
  ["path", { d: "M5 12.859a10 10 0 0 1 14 0", key: "1x1e6c" }],
  ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0", key: "1bycff" }]
]);


//# sourceMappingURL=wifi.js.map

;// ./node_modules/lucide-react/dist/esm/icons/circle-alert.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CircleAlert = (0,createLucideIcon/* default */.A)("CircleAlert", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "12", x2: "12", y1: "8", y2: "12", key: "1pkeuh" }],
  ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16", key: "4dfq90" }]
]);


//# sourceMappingURL=circle-alert.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/circle-check.js
var circle_check = __webpack_require__(79804);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/zap.js
var zap = __webpack_require__(46858);
;// ./node_modules/lucide-react/dist/esm/icons/save.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Save = (0,createLucideIcon/* default */.A)("Save", [
  [
    "path",
    {
      d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      key: "1c8476"
    }
  ],
  ["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7", key: "1ydtos" }],
  ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7", key: "t51u73" }]
]);


//# sourceMappingURL=save.js.map

;// ./src/components/features/Agents/RemoteAgentModal.tsx
const RemoteAgentModal=_ref=>{let{isOpen,onClose,onSave}=_ref;const{darkMode,user}=(0,react.useContext)(provider/* appContext */.v);const{0:modalRoot,1:setModalRoot}=(0,react.useState)(null);const{0:formData,1:setFormData}=(0,react.useState)({name:"R1_test",url:"https://aiapi.ihep.ac.cn/apiv2",api_key:""});const{0:isTestingConnection,1:setIsTestingConnection}=(0,react.useState)(false);const{0:connectionTestPassed,1:setConnectionTestPassed}=(0,react.useState)(false);const{0:testError,1:setTestError}=(0,react.useState)("");const{0:agentInfo,1:setAgentInfo}=(0,react.useState)(null);react.useEffect(()=>{if(isOpen){const root=document.getElementById("___gatsby")||document.body;setModalRoot(root);}},[isOpen]);const handleInputChange=(field,value)=>{setFormData(prev=>Object.assign({},prev,{[field]:value}));// Reset connection test status when form data changes
setConnectionTestPassed(false);setTestError("");};const testConnection=async()=>{if(!formData.name||!formData.url||!formData.api_key){message/* default */.Ay.error("请填写所有必填字段");return;}setIsTestingConnection(true);setTestError("");try{// 检查用户是否已登录
if(!(user!==null&&user!==void 0&&user.email)){throw new Error("用户未登录");}// 使用后端接口测试远程智能体连接
const testResult=await api/* agentWorkerAPI */.Ml.testRemoteAgent(user.email,formData.url,formData.name,formData.api_key// 使用用户输入的远程智能体API key
);setAgentInfo(testResult);setConnectionTestPassed(true);message/* default */.Ay.success("连接测试成功！远程智能体响应正常");}catch(error){const errorMessage=error instanceof Error?error.message:"连接失败";setTestError(errorMessage);message/* default */.Ay.error("\u8FDE\u63A5\u6D4B\u8BD5\u5931\u8D25: "+errorMessage);}finally{setIsTestingConnection(false);}};const handleSave=()=>{if(!connectionTestPassed){message/* default */.Ay.error("请先测试连接成功后再保存");return;}onSave(formData,agentInfo);message/* default */.Ay.success("远程智能体配置已保存");onClose();// Reset form
setFormData({name:"",url:"",api_key:""});setConnectionTestPassed(false);setTestError("");setAgentInfo(null);};const handleClose=()=>{onClose();// Reset form
setFormData({name:"",url:"",api_key:""});setConnectionTestPassed(false);setTestError("");setAgentInfo(null);};if(!isOpen||!modalRoot)return null;const renderInputField=function(label,field,placeholder,type){if(type===void 0){type="text";}return/*#__PURE__*/react.createElement("div",{className:"mb-3"},/*#__PURE__*/react.createElement("label",{className:"block text-sm font-medium mb-2 "+(darkMode==="dark"?"text-gray-300":"text-gray-600")},label," ",/*#__PURE__*/react.createElement("span",{className:"text-red-500"},"*")),/*#__PURE__*/react.createElement("input",{type:type,value:formData[field],onChange:e=>handleInputChange(field,e.target.value),placeholder:placeholder,className:"w-full h-9 px-3 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-[#4d3dc3]/40 focus:border-[#4d3dc3] "+(darkMode==="dark"?"bg-[#3a3a3a] text-[#e5e5e5] border-transparent placeholder:text-gray-400":"bg-gray-50 text-[#2d3748] border-transparent placeholder:text-gray-400")}));};const modalContent=/*#__PURE__*/react.createElement("div",{className:"fixed inset-0 flex items-center justify-center bg-black bg-opacity-50",style:{zIndex:1000}},/*#__PURE__*/react.createElement("div",{className:"rounded-2xl shadow-2xl "+(darkMode==="dark"?"bg-[#171a21]":"bg-white border border-gray-200")+" w-[520px] max-w-[92vw] max-h-[90vh] overflow-auto",onClick:e=>e.stopPropagation()},/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700"},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2"},/*#__PURE__*/react.createElement(Wifi,{className:"h-5 w-5 text-[#4d3dc3]"}),/*#__PURE__*/react.createElement("h2",{className:"text-lg font-semibold "+(darkMode==="dark"?"text-[#e5e5e5]":"text-[#2d3748]")},"\u8FDE\u63A5\u8FDC\u7A0B\u667A\u80FD\u4F53"),connectionTestPassed&&/*#__PURE__*/react.createElement("span",{className:"ml-1 inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"},"\u5DF2\u901A\u8FC7\u9A8C\u8BC1")),/*#__PURE__*/react.createElement("button",{onClick:handleClose,className:"p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors","aria-label":"Close"},/*#__PURE__*/react.createElement(x/* default */.A,{size:18,className:darkMode==="dark"?"text-gray-400":"text-gray-600"}))),/*#__PURE__*/react.createElement("div",{className:"p-5"},/*#__PURE__*/react.createElement("form",{onSubmit:e=>e.preventDefault()},renderInputField("智能体名称","name","例如: My Remote Agent"),renderInputField("服务器URL","url","例如: http://localhost:42806/apiv2"),renderInputField("API密钥","api_key","例如: sk-xxxxxxxxxxxxxxxx","password"),testError&&/*#__PURE__*/react.createElement("div",{className:"mb-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400"},/*#__PURE__*/react.createElement(CircleAlert,{className:"h-4 w-4"}),/*#__PURE__*/react.createElement("span",null,"\u8FDE\u63A5\u6D4B\u8BD5\u5931\u8D25\uFF1A",testError)),connectionTestPassed&&/*#__PURE__*/react.createElement("div",{className:"mb-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400"},/*#__PURE__*/react.createElement(circle_check/* default */.A,{className:"h-4 w-4"}),/*#__PURE__*/react.createElement("span",null,"\u8FDE\u63A5\u6D4B\u8BD5\u6210\u529F\uFF0C\u53EF\u4EE5\u4FDD\u5B58\u914D\u7F6E\u3002")))),/*#__PURE__*/react.createElement("div",{className:"flex justify-end gap-2 px-5 py-3.5 border-t border-gray-200 dark:border-gray-700"},/*#__PURE__*/react.createElement("button",{onClick:handleClose,className:"px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors "+(darkMode==="dark"?"text-gray-300 hover:text-gray-100 hover:bg-gray-700/60":"text-gray-600 hover:text-gray-800 hover:bg-gray-100")},"\u53D6\u6D88"),/*#__PURE__*/react.createElement("button",{onClick:testConnection,disabled:!formData.name||!formData.url||!formData.api_key||isTestingConnection,className:"px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 border "+(!formData.name||!formData.url||!formData.api_key||isTestingConnection?darkMode==="dark"?"border-gray-700 text-gray-500 cursor-not-allowed":"border-gray-200 text-gray-400 cursor-not-allowed":darkMode==="dark"?"border-[#4d3dc3] text-[#e5e5ff] hover:bg-[#4d3dc3]/20":"border-[#4d3dc3] text-[#4d3dc3] hover:bg-[#4d3dc3]/10")},isTestingConnection?/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"}),"\u6D4B\u8BD5\u4E2D..."):/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(zap/* default */.A,{className:"h-4 w-4"}),"\u6D4B\u8BD5\u8FDE\u63A5")),/*#__PURE__*/react.createElement("button",{onClick:handleSave,disabled:!connectionTestPassed,className:"px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2 "+(!connectionTestPassed?darkMode==="dark"?"bg-gray-700 text-gray-500 cursor-not-allowed":"bg-gray-200 text-gray-400 cursor-not-allowed":darkMode==="dark"?"bg-[#4d3dc3] text-white hover:bg-[#4336b1]":"bg-[#4d3dc3] text-white hover:bg-[#4336b1]")},/*#__PURE__*/react.createElement(Save,{className:"h-4 w-4"}),"\u4FDD\u5B58"))));return/*#__PURE__*/react_dom.createPortal(modalContent,modalRoot);};/* harmony default export */ var Agents_RemoteAgentModal = (RemoteAgentModal);
// EXTERNAL MODULE: ./src/components/utils.ts
var utils = __webpack_require__(70870);
// EXTERNAL MODULE: ./src/utils/agentPreference.ts
var agentPreference = __webpack_require__(12708);
;// ./src/utils/authSession.ts
/**
 * 本地账号密码登录时写入 token 为 `local_<timestamp>`；
 * 高能所 SSO 回调写入的是服务端下发的 token（通常不以 `local_` 开头）。
 */function isLocalPasswordLogin(){if(typeof window==="undefined")return false;const t=window.localStorage.getItem("token");return typeof t==="string"&&t.startsWith("local_");}
;// ./src/components/features/Agents/AgentSquare.tsx
const AgentSquare=_ref=>{let{className="",handleAgentList}=_ref;const{user}=(0,react.useContext)(provider/* appContext */.v);const{agentId,setAgentId,setMode}=(0,modeConfig/* useModeConfigStore */.Q)();const{0:agentList,1:setAgentList}=(0,react.useState)([]);const{0:loading,1:setLoading}=(0,react.useState)(true);const{0:error,1:setError}=(0,react.useState)(null);const{0:isRemoteModalOpen,1:setIsRemoteModalOpen}=(0,react.useState)(false);const{0:isCustomModalOpen,1:setIsCustomModalOpen}=(0,react.useState)(false);const{0:editingCustomAgent,1:setEditingCustomAgent}=(0,react.useState)(null);const{0:availableModels,1:setAvailableModels}=(0,react.useState)([]);const{0:isModelListLoading,1:setIsModelListLoading}=(0,react.useState)(false);const{0:modelSourceApiKey,1:setModelSourceApiKey}=(0,react.useState)();const{0:isSavingCustomAgent,1:setIsSavingCustomAgent}=(0,react.useState)(false);const{0:isRefreshing,1:setIsRefreshing}=(0,react.useState)(false);const{0:search,1:setSearch}=(0,react.useState)("");const{0:ownerFilter,1:setOwnerFilter}=(0,react.useState)("all");const{0:sortBy,1:setSortBy}=(0,react.useState)("recent");const{0:recentAgentIds,1:setRecentAgentIds}=(0,react.useState)([]);const{0:plazaRows,1:setPlazaRows}=(0,react.useState)([]);const{0:plazaLoading,1:setPlazaLoading}=(0,react.useState)(false);/** 广场接口失败（如本地账号、未接入组织服务）时仍为 true，用于提示而非整页空白 */const{0:plazaLoadError,1:setPlazaLoadError}=(0,react.useState)(false);/** 未配置平台模型 API Key：不阻塞页面，仍可使用「连接远程」 */const{0:noModelApiKeyForList,1:setNoModelApiKeyForList}=(0,react.useState)(false);const DEFAULT_AGENT_INIT_KEY="drsai.defaultAgentInitialized";const readRecentAgentIds=(0,react.useCallback)(()=>{try{const raw=window.localStorage.getItem(recentAgentsStorage/* DRSAI_RECENT_AGENTS_KEY */.f);const ids=raw?JSON.parse(raw):[];setRecentAgentIds(Array.isArray(ids)?ids:[]);}catch(_unused){setRecentAgentIds([]);}},[]);const syncRecentFromServer=(0,react.useCallback)(async()=>{if(!(user!==null&&user!==void 0&&user.email))return;try{const rows=await api/* agentWorkerAPI */.Ml.getRecentUserAgents(user.email,12);const ids=(rows||[]).map(r=>r===null||r===void 0?void 0:r.agent_id).filter(Boolean);if(ids.length){setRecentAgentIds(ids);try{window.localStorage.setItem(recentAgentsStorage/* DRSAI_RECENT_AGENTS_KEY */.f,JSON.stringify(ids));}catch(_unused2){}}}catch(e){// ignore network errors; localStorage will be used as fallback
console.debug("Failed to sync recent agents from server:",e);}},[user===null||user===void 0?void 0:user.email]);// eslint-disable-next-line react-hooks/exhaustive-deps
const handleRemoveRemoteAgent=(0,react.useCallback)(async id=>{if(!id||!(user!==null&&user!==void 0&&user.email))return;try{await api/* agentWorkerAPI */.Ml.removeRemoteAgent(user.email,id);await loadAgentList();}catch(error){console.error("Failed to remove remote agent:",error);}},[user===null||user===void 0?void 0:user.email]);const createRemoteAgentCard=(0,react.useCallback)(agent=>({id:agent.id,logo:agent.logo||"/api/placeholder/64/64",name:agent.name,description:agent.description||"远程智能体 - 自定义连接",owner:agent.owner||"未知",url:agent.url||"",config:agent.config,mode:agent.mode||"remote",api_key:agent.api_key,onRemove:id=>handleRemoveRemoteAgent(id||agent.id),onClick:()=>{}}),[handleRemoveRemoteAgent]);// 转换统一格式的 agent 为 AgentCardData
const transformUnifiedAgentToCardData=(0,react.useCallback)(agent=>{const config=agent.config||{};return{id:agent.id,logo:agent.logo||"/api/placeholder/64/64",name:agent.name||config.name||"未知智能体",description:agent.description||"智能体",owner:agent.owner||(user===null||user===void 0?void 0:user.email)||"未知",url:agent.url||config.url||config.base_url||"",config:agent.config,mode:agent.mode||"remote",api_key:agent.api_key||config.api_key||config.apiKey,featured:Boolean(agent.featured),is_default:Boolean(agent.is_default),onRemove:agent.mode==="remote"||agent.mode==="custom"?id=>handleRemoveRemoteAgent(id||agent.id):undefined,onClick:()=>{}};},[user===null||user===void 0?void 0:user.email,handleRemoveRemoteAgent]);// 提取获取 API Key 和 BaseUrl 的逻辑
const getApiKeyFromSettings=(0,react.useCallback)(async userEmail=>{var _parsed,_parsed$model_config;const settings=await api/* settingsAPI */.YP.getSettings(userEmail);let parsed={};try{if(settings!==null&&settings!==void 0&&settings.model_configs){parsed=(0,browser.parse)(settings.model_configs);}}catch(_unused3){parsed={};}const modelConfig=((_parsed=parsed)===null||_parsed===void 0?void 0:(_parsed$model_config=_parsed.model_config)===null||_parsed$model_config===void 0?void 0:_parsed$model_config.config)||{};const apiKey=modelConfig.api_key;const baseUrl=modelConfig.base_url;return{apiKey,baseUrl};},[]);const loadAgentList=(0,react.useCallback)(async()=>{if(!(user!==null&&user!==void 0&&user.email)){setLoading(false);return;}try{setLoading(true);setError(null);setNoModelApiKeyForList(false);let apiKey;try{const keys=await getApiKeyFromSettings(user.email);apiKey=keys.apiKey;}catch(e){console.warn("Could not load settings for agent list:",e);apiKey=undefined;}if(!apiKey){// 本地账号未配置平台模型 Key：用空 Bearer 调统一列表接口，后端仍会合并默认 + 远程/自定义（DDF 段为空）
setNoModelApiKeyForList(true);setModelSourceApiKey(undefined);try{const agentsData=await api/* agentWorkerAPI */.Ml.getUserAgents(user.email,"",false);const agents=agentsData.map(transformUnifiedAgentToCardData);setAgentList(agents);}catch(e2){console.warn("getUserAgents without platform key failed, trying remote-only list:",e2);try{const raw=await api/* agentWorkerAPI */.Ml.getUserRemoteAgents(user.email);const list=Array.isArray(raw)?raw:[];setAgentList(list.map(transformUnifiedAgentToCardData));}catch(_unused4){setAgentList([]);}}return;}setNoModelApiKeyForList(false);setModelSourceApiKey(apiKey);const agentsData=await api/* agentWorkerAPI */.Ml.getUserAgents(user.email,apiKey,false);const agents=agentsData.map(transformUnifiedAgentToCardData);setAgentList(agents);}catch(err){console.error("Error loading agent list:",err);setError(err instanceof Error?err.message:"Failed to load agents");}finally{setLoading(false);}},[user===null||user===void 0?void 0:user.email,getApiKeyFromSettings,transformUnifiedAgentToCardData]);const loadAvailableModels=(0,react.useCallback)(async()=>{if(!(user!==null&&user!==void 0&&user.email)||!modelSourceApiKey){setAvailableModels([]);return;}setIsModelListLoading(true);try{const baseUrl=(0,utils/* getServerUrl */.Tt)();const modelsUrl=baseUrl+"/models/llm_models?user_id="+encodeURIComponent(user.email);const response=await fetch(modelsUrl,{headers:{"Content-Type":"application/json",Authorization:"Bearer "+modelSourceApiKey}});if(!response.ok){throw new Error("Failed to fetch models: "+response.status);}const payload=await response.json();if(!payload.status){throw new Error(payload.message||"Failed to fetch models");}// 后端返回的数据结构是 { status: True, data: {...} }
// 需要从 data 中提取模型列表
const modelsData=payload.data||{};const rawList=Array.isArray(modelsData===null||modelsData===void 0?void 0:modelsData.data)?modelsData.data:Array.isArray(modelsData===null||modelsData===void 0?void 0:modelsData.models)?modelsData.models:Array.isArray(modelsData)?modelsData:[];const formatted=rawList.map((item,index)=>({id:(item===null||item===void 0?void 0:item.id)||(item===null||item===void 0?void 0:item.name)||(item===null||item===void 0?void 0:item.model)||"model-"+index})).filter(item=>Boolean(item.id)).filter((item,index,arr)=>arr.findIndex(candidate=>candidate.id===item.id)===index);setAvailableModels(formatted);}catch(err){console.error("Failed to load available models:",err);setAvailableModels([]);}finally{setIsModelListLoading(false);}},[user===null||user===void 0?void 0:user.email,modelSourceApiKey]);const handleRemoteAgentSave=(0,react.useCallback)(async(config,agentInfo)=>{if(!(user!==null&&user!==void 0&&user.email))return;try{var _config$api_key;await api/* agentWorkerAPI */.Ml.saveRemoteAgent(user.email,Object.assign({name:config.name,url:config.url,api_key:(_config$api_key=config.api_key)!==null&&_config$api_key!==void 0?_config$api_key:config.apiKey,mode:"remote"},agentInfo));await loadAgentList();setIsRemoteModalOpen(false);}catch(error){console.error("Failed to save remote agent:",error);}},[user===null||user===void 0?void 0:user.email,loadAgentList]);const handleCustomAgentSave=(0,react.useCallback)(async customConfig=>{if(!(user!==null&&user!==void 0&&user.email)){message/* default */.Ay.error("用户未登录");return;}try{setIsSavingCustomAgent(true);const isEdit=Boolean(editingCustomAgent===null||editingCustomAgent===void 0?void 0:editingCustomAgent.id);const payload={mode:"custom",name:customConfig.name,description:customConfig.description||"自定义智能体",owner:user.email,type:isEdit?"update":"add",logo:customConfig.avatar||"/api/placeholder/64/64",system_message:customConfig.system_message,// 将前端自定义 Agent 配置整体塞到 config 中，方便后端统一解析
config:{model_client:customConfig.model_client,mcp_sse_list:customConfig.mcp_sse_list,// 后端期望 ragflow_configs 为列表
ragflow_configs:customConfig.ragflow_configs,name:customConfig.name,description:customConfig.description||"自定义智能体",system_message:customConfig.system_message}};if(isEdit){payload.id=editingCustomAgent.id;payload.config.id=editingCustomAgent.id;}const updatedAgents=await api/* agentWorkerAPI */.Ml.saveRemoteAgent(user.email,payload);await loadAgentList();if(handleAgentList){await handleAgentList(updatedAgents);}message/* default */.Ay.success(isEdit?"自定义智能体已更新":"自定义智能体已保存");setIsCustomModalOpen(false);setEditingCustomAgent(null);}catch(err){console.error("Failed to save custom agent:",err);message/* default */.Ay.error("保存自定义智能体失败");}finally{setIsSavingCustomAgent(false);}},[user===null||user===void 0?void 0:user.email,handleAgentList,loadAgentList,editingCustomAgent]);const handleEditCustomAgent=(0,react.useCallback)(agent=>{var _agent$system_message;const config=agent.config||{};const initialData={id:agent.id,name:agent.name,avatar:agent.logo,description:agent.description,system_message:(_agent$system_message=agent.system_message)!==null&&_agent$system_message!==void 0?_agent$system_message:config.system_message,model_client:config.model_client,mcp_sse_list:config.mcp_sse_list||[],ragflow_configs:config.ragflow_configs||[]};setEditingCustomAgent({id:agent.id,initialData});setIsCustomModalOpen(true);},[]);const handleRefresh=(0,react.useCallback)(async()=>{if(!(user!==null&&user!==void 0&&user.email)){message/* default */.Ay.warning("无法刷新：缺少用户信息");return;}try{setIsRefreshing(true);let refreshKey="";try{var _keys$apiKey;const keys=await getApiKeyFromSettings(user.email);refreshKey=(_keys$apiKey=keys.apiKey)!==null&&_keys$apiKey!==void 0?_keys$apiKey:"";}catch(_unused5){refreshKey="";}// 刷新智能体列表（is_refresh=true 会跳过缓存；无平台 Key 时仍刷新默认+远程）
const agentsData=await api/* agentWorkerAPI */.Ml.getUserAgents(user.email,refreshKey,true);console.log("agentsData",agentsData);const agents=agentsData.map(transformUnifiedAgentToCardData);setAgentList(agents);message/* default */.Ay.success("刷新成功");}catch(err){console.error("Failed to refresh agent list:",err);message/* default */.Ay.error("刷新失败");}finally{setIsRefreshing(false);}},[user===null||user===void 0?void 0:user.email,getApiKeyFromSettings,transformUnifiedAgentToCardData]);(0,react.useEffect)(()=>{loadAgentList();},[loadAgentList]);(0,react.useEffect)(()=>{if(isCustomModalOpen){loadAvailableModels();}},[isCustomModalOpen,loadAvailableModels]);(0,react.useEffect)(()=>{readRecentAgentIds();syncRecentFromServer();const handler=()=>readRecentAgentIds();window.addEventListener("drsai:recentAgentsUpdated",handler);const usageHandler=evt=>{var _custom$detail;const custom=evt;const agentId=custom===null||custom===void 0?void 0:(_custom$detail=custom.detail)===null||_custom$detail===void 0?void 0:_custom$detail.agentId;if(!(user!==null&&user!==void 0&&user.email)||!agentId)return;api/* agentWorkerAPI */.Ml.recordUserAgentUsage(user.email,agentId).catch(()=>{});};window.addEventListener("drsai:agentUsed",usageHandler);return()=>window.removeEventListener("drsai:recentAgentsUpdated",handler);},[readRecentAgentIds,syncRecentFromServer,user===null||user===void 0?void 0:user.email]);// 新用户默认：有组织用组织默认智能体，否则 Dr.Sai General（必须放在条件 return 之前，避免 hooks 次序变化）
(0,react.useEffect)(()=>{if(agentId)return;if(!agentList.length)return;const email=user===null||user===void 0?void 0:user.email;if(!email)return;let cancelled=false;void(async()=>{try{if(window.localStorage.getItem(DEFAULT_AGENT_INIT_KEY))return;const myOrg=await api/* organizationsAPI */.PB.getMyOrg(email).catch(()=>null);if(cancelled)return;const orgDefault=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;const target=(0,agentPreference/* pickLoginDefaultAgent */.Tw)(agentList,orgDefault);if(!(target!==null&&target!==void 0&&target.id))return;setAgentId(target.id);setMode(target.mode||"");window.localStorage.setItem(DEFAULT_AGENT_INIT_KEY,"1");}catch(_unused6){// ignore
}})();return()=>{cancelled=true;};},[agentId,agentList,setAgentId,setMode,user===null||user===void 0?void 0:user.email]);(0,react.useEffect)(()=>{const email=user===null||user===void 0?void 0:user.email;if(!email)return;let cancelled=false;void(async()=>{setPlazaLoading(true);setPlazaLoadError(false);try{const rows=await api/* organizationsAPI */.PB.plazaList(email);if(!cancelled){setPlazaRows(rows||[]);setPlazaLoadError(false);}}catch(_unused7){if(!cancelled){setPlazaRows([]);setPlazaLoadError(true);}}finally{if(!cancelled)setPlazaLoading(false);}})();return()=>{cancelled=true;};},[user===null||user===void 0?void 0:user.email]);if(loading){return/*#__PURE__*/react.createElement("div",{className:"flex justify-center items-center h-64 "+className},/*#__PURE__*/react.createElement("div",{className:"text-secondary"},"\u52A0\u8F7D\u4E2D..."));}if(error){return/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center justify-center h-64 "+className},/*#__PURE__*/react.createElement("div",{className:"text-red-500 mb-2"},"\u52A0\u8F7D\u5931\u8D25: ",error),/*#__PURE__*/react.createElement("div",{className:"text-secondary text-sm"},"\u4F7F\u7528\u9ED8\u8BA4\u6570\u636E"));}const isMine=agent=>Boolean(user===null||user===void 0?void 0:user.email)&&agent.owner===(user===null||user===void 0?void 0:user.email);const matchOwner=agent=>{if(ownerFilter==="all")return true;if(ownerFilter==="mine")return isMine(agent);// official
return agent.mode!=="remote"&&agent.mode!=="custom";};const matchSearch=agent=>{const q=search.trim().toLowerCase();if(!q)return true;return(agent.name||"").toLowerCase().includes(q)||(agent.description||"").toLowerCase().includes(q)||(agent.owner||"").toLowerCase().includes(q);};const baseList=agentList.filter(agent=>agent.mode!=="magentic-one"&&agent.mode!=="besiii");/**
   * 主推位（与下方网格去重）：
   * - 优先展示后端标记的默认智能体（is_default），便于下游自定义“默认/主推”；
   * - 若无默认，再回退到后端标记的 featured（官方精选）。
   */const featuredAgent=baseList.find(a=>a.is_default)||baseList.find(a=>a.featured&&a.mode!=="remote"&&a.mode!=="custom");const filteredList=baseList.filter(agent=>matchOwner(agent)&&matchSearch(agent)).filter(agent=>featuredAgent!==null&&featuredAgent!==void 0&&featuredAgent.id?agent.id!==featuredAgent.id:true);const sortList=list=>{if(sortBy==="name"){return (0,toConsumableArray/* default */.A)(list).sort((a,b)=>(a.name||"").localeCompare(b.name||""));}// recent: keep "recently used" at top if present, otherwise stable fallback by name
const order=new Map(recentAgentIds.map((id,idx)=>[id,idx]));return (0,toConsumableArray/* default */.A)(list).sort((a,b)=>{const ai=a.id?order.get(a.id):undefined;const bi=b.id?order.get(b.id):undefined;const aHas=typeof ai==="number";const bHas=typeof bi==="number";if(aHas&&bHas)return ai-bi;if(aHas)return-1;if(bHas)return 1;return(a.name||"").localeCompare(b.name||"");});};const recentAgents=recentAgentIds.map(id=>baseList.find(a=>a.id===id)).filter(Boolean);/** 与 AgentCard「试用一下」一致：选中、最近使用、上报、切会话 */const startWithAgent=agent=>{if(!(agent!==null&&agent!==void 0&&agent.id))return;setAgentId(agent.id);setMode(agent.mode||"");try{const raw=window.localStorage.getItem(recentAgentsStorage/* DRSAI_RECENT_AGENTS_KEY */.f);const list=raw?JSON.parse(raw):[];const next=[agent.id].concat((0,toConsumableArray/* default */.A)(list.filter(id=>id!==agent.id))).slice(0,12);window.localStorage.setItem(recentAgentsStorage/* DRSAI_RECENT_AGENTS_KEY */.f,JSON.stringify(next));setRecentAgentIds(next);window.dispatchEvent(new CustomEvent("drsai:recentAgentsUpdated"));window.dispatchEvent(new CustomEvent("drsai:agentUsed",{detail:{agentId:agent.id}}));}catch(_unused8){/* ignore */}window.dispatchEvent(new CustomEvent("switchToCurrentSession",{detail:{clearSession:true}}));};return/*#__PURE__*/react.createElement("div",{className:"flex flex-col h-full "+className},/*#__PURE__*/react.createElement("div",{className:"sticky top-0 z-10 mb-4 bg-transparent pr-4"},/*#__PURE__*/react.createElement("div",{className:"ml-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e7e7ef] bg-white/70 px-3 py-2 backdrop-blur dark:border-[#2a2a3a] dark:bg-[#101018]/70"},/*#__PURE__*/react.createElement("div",{className:"flex min-w-[260px] flex-1 items-center gap-2"},/*#__PURE__*/react.createElement("div",{className:"text-sm font-semibold text-[#233457] dark:text-[#e4e8ff]"},"\u667A\u80FD\u4F53",/*#__PURE__*/react.createElement("span",{className:"ml-2 text-xs font-normal text-[#9aa2b2] dark:text-[#b6bdd0]"},filteredList.length,"/",baseList.length)),/*#__PURE__*/react.createElement("input",{value:search,onChange:e=>setSearch(e.target.value),placeholder:"\u641C\u7D22\u540D\u79F0 / \u63CF\u8FF0 / \u521B\u5EFA\u4EBA",className:"ml-2 h-8 w-full max-w-[420px] rounded-lg border border-[#e7e7ef] bg-white px-3 text-sm outline-none transition-colors focus:border-[#b5a1ff] dark:border-[#2a2a3a] dark:bg-[#0f0f16] dark:text-[#e4e8ff]"})),/*#__PURE__*/react.createElement("div",{className:"flex flex-wrap items-center gap-2"},/*#__PURE__*/react.createElement(Button/* Button */.$,{variant:"secondary",size:"sm",onClick:()=>setIsRemoteModalOpen(true),icon:/*#__PURE__*/react.createElement(plus/* default */.A,{className:"h-3 w-3"}),className:"h-8 rounded-lg !border border-[#e7e7ef] bg-white/80 px-3 text-xs font-medium text-[#334155] shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-sm hover:bg-white hover:border-[#c7b8ff] hover:shadow-[0_10px_30px_rgba(93,63,205,0.12)] active:translate-y-0 dark:border-[#2a2a3a] dark:bg-[#0f0f16]/80 dark:text-[#cfd6e9] dark:hover:bg-[#121226] dark:hover:border-[#5d3fcd]/50"},"\u8FDE\u63A5\u8FDC\u7A0B"),/*#__PURE__*/react.createElement("div",{className:"flex items-center rounded-lg border border-[#e7e7ef] bg-white px-1 py-1 text-xs dark:border-[#2a2a3a] dark:bg-[#0f0f16]"},[["all","全部"],["mine","我的"],["official","官方"]].map(_ref2=>{let[key,label]=_ref2;return/*#__PURE__*/react.createElement("button",{key:key,type:"button",onClick:()=>setOwnerFilter(key),className:"rounded-md px-2 py-1 transition-colors "+(ownerFilter===key?"bg-[#ece9ff] text-[#5d3fcd] dark:bg-[#2a2342] dark:text-[#bca8ff]":"text-[#55627a] hover:bg-[#f2f2f7] dark:text-[#b6bdd0] dark:hover:bg-[#1a1a26]")},label);})),/*#__PURE__*/react.createElement("select",{value:sortBy,onChange:e=>setSortBy(e.target.value),className:"h-8 rounded-lg border border-[#e7e7ef] bg-white px-2 text-xs text-[#55627a] outline-none dark:border-[#2a2a3a] dark:bg-[#0f0f16] dark:text-[#b6bdd0]"},/*#__PURE__*/react.createElement("option",{value:"recent"},"\u6309\u6700\u8FD1\u4F7F\u7528"),/*#__PURE__*/react.createElement("option",{value:"name"},"\u6309\u540D\u79F0")),/*#__PURE__*/react.createElement(Button/* Button */.$,{variant:"primary",size:"sm",onClick:handleRefresh,disabled:isRefreshing,icon:/*#__PURE__*/react.createElement(refresh_cw/* default */.A,{className:"h-3 w-3 "+(isRefreshing?"animate-spin":"")}),className:"text-xs px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white border-0 shadow-none"},"\u5237\u65B0")))),(user===null||user===void 0?void 0:user.email)&&plazaLoadError&&isLocalPasswordLogin()&&/*#__PURE__*/react.createElement("div",{className:"mb-3 ml-4 mr-4 rounded-xl border border-amber-200/90 bg-amber-50/95 px-3 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100/95"},"\u5B98\u65B9\u667A\u80FD\u4F53\u6682\u4E0D\u53EF\u7528\uFF08\u672C\u5730\u767B\u5F55\u8D26\u53F7\u901A\u5E38\u65E0ddf\u6CE8\u518C\u7684\u667A\u80FD\u4F53\u7684\u6570\u636E\uFF09\u3002\u4E0D\u5F71\u54CD\u4F7F\u7528\u4E0A\u65B9\u300C\u8FDE\u63A5\u8FDC\u7A0B\u300D\u6DFB\u52A0\u5916\u90E8\u667A\u80FD\u4F53\u3002"),(user===null||user===void 0?void 0:user.email)&&plazaRows.length>0&&/*#__PURE__*/react.createElement("div",{className:"mb-4 ml-4 mr-4 rounded-xl border border-[#e7e7ef] bg-white/80 p-3 dark:border-[#2a2a3a] dark:bg-[#101018]/80"},/*#__PURE__*/react.createElement("div",{className:"mb-2 text-xs font-semibold text-[#55627a] dark:text-[#b6bdd0]"},"\u5176\u4ED6\u5408\u4F5C\u7EC4\u667A\u80FD\u4F53\uFF08\u7533\u8BF7\u901A\u8FC7\u540E\u53EF\u5728\u300C\u6211\u7684\u667A\u80FD\u4F53\u300D\u4FA7\u680F\u4F7F\u7528\uFF09",plazaLoading?/*#__PURE__*/react.createElement("span",{className:"ml-2 text-[10px] opacity-70"},"\u52A0\u8F7D\u4E2D\u2026"):null),/*#__PURE__*/react.createElement("div",{className:"flex flex-col gap-2 max-h-48 overflow-y-auto"},plazaRows.map(row=>{const snap=row.snapshot||{};const name=snap.name||row.agent_id;return/*#__PURE__*/react.createElement("div",{key:row.org_id+"-"+row.agent_id,className:"flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#eee] px-2 py-1.5 text-xs dark:border-[#2a2a3a]"},/*#__PURE__*/react.createElement("div",{className:"min-w-0"},/*#__PURE__*/react.createElement("span",{className:"font-medium text-[#0f172a] dark:text-[#e4e8ff]"},name),/*#__PURE__*/react.createElement("span",{className:"ml-2 text-[#9aa2b2]"},row.org_display_name||"org "+row.org_id)),/*#__PURE__*/react.createElement("button",{type:"button",className:"shrink-0 rounded-md bg-[#5d3fcd] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#4c32b3]",onClick:async()=>{try{await api/* organizationsAPI */.PB.plazaApply(user.email,row.org_id,row.agent_id);message/* default */.Ay.success("已提交申请，请等待平台管理员审批");}catch(e){message/* default */.Ay.error((e===null||e===void 0?void 0:e.message)||"申请失败");}}},"\u7533\u8BF7\u4F7F\u7528"));}))),baseList.length===0?/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center justify-center h-64 flex-1 px-4 text-center"},noModelApiKeyForList?/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"text-[#334155] dark:text-[#cfd6e9] mb-2 font-medium"},"\u672A\u914D\u7F6E\u5E73\u53F0\u6A21\u578B API Key\uFF0C\u6258\u7BA1\u667A\u80FD\u4F53\u5217\u8868\u65E0\u6CD5\u52A0\u8F7D"),/*#__PURE__*/react.createElement("div",{className:"text-secondary text-sm max-w-md"},"\u672C\u5730\u8D26\u53F7\u53EF\u70B9\u51FB\u4E0A\u65B9\u300C\u8FDE\u63A5\u8FDC\u7A0B\u300D\uFF0C\u586B\u5199\u8FDC\u7A0B\u667A\u80FD\u4F53\u5730\u5740\u4E0E Key \u5373\u53EF\u4F7F\u7528\uFF1B\u82E5\u9700\u5E73\u53F0\u6258\u7BA1\u667A\u80FD\u4F53\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6A21\u578B API Key \u540E\u5237\u65B0\u3002")):/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"text-secondary mb-2"},"\u5F53\u524D\u7528\u6237\u672A\u90E8\u7F72\u4EFB\u4F55\u667A\u80FD\u4F53"),/*#__PURE__*/react.createElement("div",{className:"text-secondary text-sm"},"\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u90E8\u7F72\u667A\u80FD\u4F53\u6216\u4F7F\u7528\u9ED8\u8BA4\u667A\u80FD\u4F53"))):/*#__PURE__*/react.createElement("div",{className:"flex-1 min-h-0 overflow-y-auto"},featuredAgent&&ownerFilter!=="mine"&&/*#__PURE__*/react.createElement("div",{className:"mb-6 pl-4 pr-4"},/*#__PURE__*/react.createElement("div",{className:"mb-3 flex items-center gap-2"},/*#__PURE__*/react.createElement("span",{className:"inline-flex items-center rounded-full bg-[#111827] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white dark:bg-white dark:text-[#111827]"},"Featured"),/*#__PURE__*/react.createElement("span",{className:"text-xs font-semibold tracking-wide text-[#55627a] dark:text-[#b6bdd0]"},"\u5B98\u65B9\u7CBE\u9009")),/*#__PURE__*/react.createElement("div",{className:"w-full max-w-[min(100%,42rem)]"},/*#__PURE__*/react.createElement("div",{className:"group relative overflow-hidden rounded-2xl border border-[#e7e7ef] bg-white shadow-sm dark:border-[#2a2a3a] dark:bg-[#0f0f16]"},/*#__PURE__*/react.createElement("div",{className:"pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-gradient-to-br from-[#a78bfa]/30 via-[#60a5fa]/20 to-transparent blur-2xl"}),/*#__PURE__*/react.createElement("div",{className:"pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-tr from-[#f472b6]/20 via-[#34d399]/10 to-transparent blur-2xl"}),/*#__PURE__*/react.createElement("div",{className:"relative flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5"},/*#__PURE__*/react.createElement("div",{className:"flex min-w-[240px] flex-1 items-start gap-3"},/*#__PURE__*/react.createElement("div",{className:"relative shrink-0"},/*#__PURE__*/react.createElement("div",{className:"flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-black/5 shadow-sm dark:bg-[#111122] dark:ring-white/10"},/*#__PURE__*/react.createElement("img",{src:featuredAgent.logo,alt:"",className:"h-8 w-8 object-contain"})),/*#__PURE__*/react.createElement("span",{className:"absolute -right-1 -top-1 inline-flex h-4 w-4 rounded-full bg-gradient-to-br from-[#7c3aed] to-[#2563eb] ring-2 ring-white dark:ring-[#0f0f16]"})),/*#__PURE__*/react.createElement("div",{className:"min-w-0 flex-1"},/*#__PURE__*/react.createElement("div",{className:"flex flex-wrap items-center gap-2"},/*#__PURE__*/react.createElement("h3",{className:"truncate text-[15px] font-semibold tracking-[-0.02em] text-[#0f172a] dark:text-[#e4e8ff]"},featuredAgent.name),/*#__PURE__*/react.createElement("span",{className:"inline-flex shrink-0 items-center rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium text-[#334155] dark:bg-white/10 dark:text-[#cfd6e9]"},"\u5B98\u65B9")),/*#__PURE__*/react.createElement("div",{className:"mt-0.5 truncate text-[12px] text-[#64748b] dark:text-[#aab3c8]"},featuredAgent.owner),/*#__PURE__*/react.createElement("p",{className:"mt-2 line-clamp-3 text-[13px] leading-relaxed text-[#334155] dark:text-[#cfd6e9]"},featuredAgent.description))),/*#__PURE__*/react.createElement("div",{className:"flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center"},featuredAgent.mode==="custom"&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>handleEditCustomAgent(featuredAgent),className:"inline-flex items-center justify-center rounded-full border border-[#e7e7ef] bg-white px-4 py-2 text-sm font-medium text-[#334155] transition hover:bg-[#f8fafc] dark:border-[#2a2a3a] dark:bg-[#181824] dark:text-[#e4e8ff] dark:hover:bg-[#1f1f2e]"},"\u7F16\u8F91"),/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>startWithAgent(featuredAgent),className:"inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[#4f46e5] to-[#7c3aed] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99]"},"\u5F00\u59CB\u4F7F\u7528")))))),recentAgents.length>0&&/*#__PURE__*/react.createElement("div",{className:"mb-5 pl-4 pr-4"},/*#__PURE__*/react.createElement("div",{className:"mb-2 flex items-center justify-between"},/*#__PURE__*/react.createElement("div",{className:"text-xs font-semibold tracking-wide text-[#55627a] dark:text-[#b6bdd0]"},"\u6700\u8FD1\u4F7F\u7528")),/*#__PURE__*/react.createElement("div",{className:"grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"},recentAgents.filter(a=>featuredAgent!==null&&featuredAgent!==void 0&&featuredAgent.id?a.id!==featuredAgent.id:true).slice(0,6).map(agent=>/*#__PURE__*/react.createElement(AgentCard,{key:"recent-"+(agent.id||agent.name),agent:agent,onEdit:agent.mode==="custom"?()=>handleEditCustomAgent(agent):undefined})))),/*#__PURE__*/react.createElement("div",{className:"pl-4 pr-4 pb-6"},/*#__PURE__*/react.createElement("div",{className:"mb-2 text-xs font-semibold tracking-wide text-[#55627a] dark:text-[#b6bdd0]"},"\u5168\u90E8"),filteredList.length===0?/*#__PURE__*/react.createElement("div",{className:"flex h-40 items-center justify-center rounded-xl border border-dashed border-[#e7e7ef] text-sm text-[#9aa2b2] dark:border-[#2a2a3a] dark:text-[#8f97ad]"},"\u6CA1\u6709\u5339\u914D\u7684\u667A\u80FD\u4F53"):/*#__PURE__*/react.createElement("div",{className:"grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5"},sortList(filteredList).map(agent=>/*#__PURE__*/react.createElement(AgentCard,{key:agent.id||agent.name,agent:agent,onEdit:agent.mode==="custom"?()=>handleEditCustomAgent(agent):undefined}))))),/*#__PURE__*/react.createElement(Agents_CustomAgentModal,{isOpen:isCustomModalOpen,onClose:()=>{setIsCustomModalOpen(false);setEditingCustomAgent(null);},onSave:handleCustomAgentSave,models:availableModels,isLoadingModels:isModelListLoading,onReloadModels:loadAvailableModels,isSaving:isSavingCustomAgent,initialData:editingCustomAgent===null||editingCustomAgent===void 0?void 0:editingCustomAgent.initialData,title:editingCustomAgent?"编辑自定义智能体":"自定义智能体"}),/*#__PURE__*/react.createElement(Agents_RemoteAgentModal,{isOpen:isRemoteModalOpen,onClose:()=>setIsRemoteModalOpen(false),onSave:handleRemoteAgentSave}));};
// EXTERNAL MODULE: ./src/components/features/Agents/useAgentInfo.ts
var useAgentInfo = __webpack_require__(43044);
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var tooltip = __webpack_require__(40367);
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/PlusOutlined.js + 1 modules
var PlusOutlined = __webpack_require__(49237);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/UploadOutlined.js + 1 modules
var UploadOutlined = __webpack_require__(77028);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/SearchOutlined.js + 1 modules
var SearchOutlined = __webpack_require__(42877);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
// EXTERNAL MODULE: ./node_modules/antd/es/skeleton/index.js + 10 modules
var skeleton = __webpack_require__(97072);
// EXTERNAL MODULE: ./node_modules/antd/es/tabs/index.js + 24 modules
var es_tabs = __webpack_require__(10277);
;// ./node_modules/antd/es/card/Grid.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};



const Grid = _a => {
  var {
      prefixCls,
      className,
      hoverable = true
    } = _a,
    props = __rest(_a, ["prefixCls", "className", "hoverable"]);
  const {
    getPrefixCls
  } = react.useContext(context/* ConfigContext */.QO);
  const prefix = getPrefixCls('card', prefixCls);
  const classString = classnames_default()(`${prefix}-grid`, className, {
    [`${prefix}-grid-hoverable`]: hoverable
  });
  return /*#__PURE__*/react.createElement("div", Object.assign({}, props, {
    className: classString
  }));
};
/* harmony default export */ var card_Grid = (Grid);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
;// ./node_modules/antd/es/card/style/index.js



// ============================== Styles ==============================
// ============================== Head ==============================
const genCardHeadStyle = token => {
  const {
    antCls,
    componentCls,
    headerHeight,
    cardPaddingBase,
    tabsMarginBottom
  } = token;
  return Object.assign(Object.assign({
    display: 'flex',
    justifyContent: 'center',
    flexDirection: 'column',
    minHeight: headerHeight,
    marginBottom: -1,
    padding: `0 ${(0,es/* unit */.zA)(cardPaddingBase)}`,
    color: token.colorTextHeading,
    fontWeight: token.fontWeightStrong,
    fontSize: token.headerFontSize,
    background: token.headerBg,
    borderBottom: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorderSecondary}`,
    borderRadius: `${(0,es/* unit */.zA)(token.borderRadiusLG)} ${(0,es/* unit */.zA)(token.borderRadiusLG)} 0 0`
  }, (0,style/* clearFix */.t6)()), {
    '&-wrapper': {
      width: '100%',
      display: 'flex',
      alignItems: 'center'
    },
    '&-title': Object.assign(Object.assign({
      display: 'inline-block',
      flex: 1
    }, style/* textEllipsis */.L9), {
      [`
          > ${componentCls}-typography,
          > ${componentCls}-typography-edit-content
        `]: {
        insetInlineStart: 0,
        marginTop: 0,
        marginBottom: 0
      }
    }),
    [`${antCls}-tabs-top`]: {
      clear: 'both',
      marginBottom: tabsMarginBottom,
      color: token.colorText,
      fontWeight: 'normal',
      fontSize: token.fontSize,
      '&-bar': {
        borderBottom: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorderSecondary}`
      }
    }
  });
};
// ============================== Grid ==============================
const genCardGridStyle = token => {
  const {
    cardPaddingBase,
    colorBorderSecondary,
    cardShadow,
    lineWidth
  } = token;
  return {
    width: '33.33%',
    padding: cardPaddingBase,
    border: 0,
    borderRadius: 0,
    boxShadow: `
      ${(0,es/* unit */.zA)(lineWidth)} 0 0 0 ${colorBorderSecondary},
      0 ${(0,es/* unit */.zA)(lineWidth)} 0 0 ${colorBorderSecondary},
      ${(0,es/* unit */.zA)(lineWidth)} ${(0,es/* unit */.zA)(lineWidth)} 0 0 ${colorBorderSecondary},
      ${(0,es/* unit */.zA)(lineWidth)} 0 0 0 ${colorBorderSecondary} inset,
      0 ${(0,es/* unit */.zA)(lineWidth)} 0 0 ${colorBorderSecondary} inset;
    `,
    transition: `all ${token.motionDurationMid}`,
    '&-hoverable:hover': {
      position: 'relative',
      zIndex: 1,
      boxShadow: cardShadow
    }
  };
};
// ============================== Actions ==============================
const genCardActionsStyle = token => {
  const {
    componentCls,
    iconCls,
    actionsLiMargin,
    cardActionsIconSize,
    colorBorderSecondary,
    actionsBg
  } = token;
  return Object.assign(Object.assign({
    margin: 0,
    padding: 0,
    listStyle: 'none',
    background: actionsBg,
    borderTop: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${colorBorderSecondary}`,
    display: 'flex',
    borderRadius: `0 0 ${(0,es/* unit */.zA)(token.borderRadiusLG)} ${(0,es/* unit */.zA)(token.borderRadiusLG)}`
  }, (0,style/* clearFix */.t6)()), {
    '& > li': {
      margin: actionsLiMargin,
      color: token.colorTextDescription,
      textAlign: 'center',
      '> span': {
        position: 'relative',
        display: 'block',
        minWidth: token.calc(token.cardActionsIconSize).mul(2).equal(),
        fontSize: token.fontSize,
        lineHeight: token.lineHeight,
        cursor: 'pointer',
        '&:hover': {
          color: token.colorPrimary,
          transition: `color ${token.motionDurationMid}`
        },
        [`a:not(${componentCls}-btn), > ${iconCls}`]: {
          display: 'inline-block',
          width: '100%',
          color: token.colorTextDescription,
          lineHeight: (0,es/* unit */.zA)(token.fontHeight),
          transition: `color ${token.motionDurationMid}`,
          '&:hover': {
            color: token.colorPrimary
          }
        },
        [`> ${iconCls}`]: {
          fontSize: cardActionsIconSize,
          lineHeight: (0,es/* unit */.zA)(token.calc(cardActionsIconSize).mul(token.lineHeight).equal())
        }
      },
      '&:not(:last-child)': {
        borderInlineEnd: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${colorBorderSecondary}`
      }
    }
  });
};
// ============================== Meta ==============================
const genCardMetaStyle = token => Object.assign(Object.assign({
  margin: `${(0,es/* unit */.zA)(token.calc(token.marginXXS).mul(-1).equal())} 0`,
  display: 'flex'
}, (0,style/* clearFix */.t6)()), {
  '&-avatar': {
    paddingInlineEnd: token.padding
  },
  '&-detail': {
    overflow: 'hidden',
    flex: 1,
    '> div:not(:last-child)': {
      marginBottom: token.marginXS
    }
  },
  '&-title': Object.assign({
    color: token.colorTextHeading,
    fontWeight: token.fontWeightStrong,
    fontSize: token.fontSizeLG
  }, style/* textEllipsis */.L9),
  '&-description': {
    color: token.colorTextDescription
  }
});
// ============================== Inner ==============================
const genCardTypeInnerStyle = token => {
  const {
    componentCls,
    cardPaddingBase,
    colorFillAlter
  } = token;
  return {
    [`${componentCls}-head`]: {
      padding: `0 ${(0,es/* unit */.zA)(cardPaddingBase)}`,
      background: colorFillAlter,
      '&-title': {
        fontSize: token.fontSize
      }
    },
    [`${componentCls}-body`]: {
      padding: `${(0,es/* unit */.zA)(token.padding)} ${(0,es/* unit */.zA)(cardPaddingBase)}`
    }
  };
};
// ============================== Loading ==============================
const genCardLoadingStyle = token => {
  const {
    componentCls
  } = token;
  return {
    overflow: 'hidden',
    [`${componentCls}-body`]: {
      userSelect: 'none'
    }
  };
};
// ============================== Basic ==============================
const genCardStyle = token => {
  const {
    componentCls,
    cardShadow,
    cardHeadPadding,
    colorBorderSecondary,
    boxShadowTertiary,
    cardPaddingBase,
    extraColor
  } = token;
  return {
    [componentCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      position: 'relative',
      background: token.colorBgContainer,
      borderRadius: token.borderRadiusLG,
      [`&:not(${componentCls}-bordered)`]: {
        boxShadow: boxShadowTertiary
      },
      [`${componentCls}-head`]: genCardHeadStyle(token),
      [`${componentCls}-extra`]: {
        // https://stackoverflow.com/a/22429853/3040605
        marginInlineStart: 'auto',
        color: extraColor,
        fontWeight: 'normal',
        fontSize: token.fontSize
      },
      [`${componentCls}-body`]: Object.assign({
        padding: cardPaddingBase,
        borderRadius: `0 0 ${(0,es/* unit */.zA)(token.borderRadiusLG)} ${(0,es/* unit */.zA)(token.borderRadiusLG)}`
      }, (0,style/* clearFix */.t6)()),
      [`${componentCls}-grid`]: genCardGridStyle(token),
      [`${componentCls}-cover`]: {
        '> *': {
          display: 'block',
          width: '100%',
          borderRadius: `${(0,es/* unit */.zA)(token.borderRadiusLG)} ${(0,es/* unit */.zA)(token.borderRadiusLG)} 0 0`
        }
      },
      [`${componentCls}-actions`]: genCardActionsStyle(token),
      [`${componentCls}-meta`]: genCardMetaStyle(token)
    }),
    [`${componentCls}-bordered`]: {
      border: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${colorBorderSecondary}`,
      [`${componentCls}-cover`]: {
        marginTop: -1,
        marginInlineStart: -1,
        marginInlineEnd: -1
      }
    },
    [`${componentCls}-hoverable`]: {
      cursor: 'pointer',
      transition: `box-shadow ${token.motionDurationMid}, border-color ${token.motionDurationMid}`,
      '&:hover': {
        borderColor: 'transparent',
        boxShadow: cardShadow
      }
    },
    [`${componentCls}-contain-grid`]: {
      borderRadius: `${(0,es/* unit */.zA)(token.borderRadiusLG)} ${(0,es/* unit */.zA)(token.borderRadiusLG)} 0 0 `,
      [`${componentCls}-body`]: {
        display: 'flex',
        flexWrap: 'wrap'
      },
      [`&:not(${componentCls}-loading) ${componentCls}-body`]: {
        marginBlockStart: token.calc(token.lineWidth).mul(-1).equal(),
        marginInlineStart: token.calc(token.lineWidth).mul(-1).equal(),
        padding: 0
      }
    },
    [`${componentCls}-contain-tabs`]: {
      [`> div${componentCls}-head`]: {
        minHeight: 0,
        [`${componentCls}-head-title, ${componentCls}-extra`]: {
          paddingTop: cardHeadPadding
        }
      }
    },
    [`${componentCls}-type-inner`]: genCardTypeInnerStyle(token),
    [`${componentCls}-loading`]: genCardLoadingStyle(token),
    [`${componentCls}-rtl`]: {
      direction: 'rtl'
    }
  };
};
// ============================== Size ==============================
const genCardSizeStyle = token => {
  const {
    componentCls,
    cardPaddingSM,
    headerHeightSM,
    headerFontSizeSM
  } = token;
  return {
    [`${componentCls}-small`]: {
      [`> ${componentCls}-head`]: {
        minHeight: headerHeightSM,
        padding: `0 ${(0,es/* unit */.zA)(cardPaddingSM)}`,
        fontSize: headerFontSizeSM,
        [`> ${componentCls}-head-wrapper`]: {
          [`> ${componentCls}-extra`]: {
            fontSize: token.fontSize
          }
        }
      },
      [`> ${componentCls}-body`]: {
        padding: cardPaddingSM
      }
    },
    [`${componentCls}-small${componentCls}-contain-tabs`]: {
      [`> ${componentCls}-head`]: {
        [`${componentCls}-head-title, ${componentCls}-extra`]: {
          paddingTop: 0,
          display: 'flex',
          alignItems: 'center'
        }
      }
    }
  };
};
const prepareComponentToken = token => ({
  headerBg: 'transparent',
  headerFontSize: token.fontSizeLG,
  headerFontSizeSM: token.fontSize,
  headerHeight: token.fontSizeLG * token.lineHeightLG + token.padding * 2,
  headerHeightSM: token.fontSize * token.lineHeight + token.paddingXS * 2,
  actionsBg: token.colorBgContainer,
  actionsLiMargin: `${token.paddingSM}px 0`,
  tabsMarginBottom: -token.padding - token.lineWidth,
  extraColor: token.colorText
});
// ============================== Export ==============================
/* harmony default export */ var card_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Card', token => {
  const cardToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    cardShadow: token.boxShadowCard,
    cardHeadPadding: token.padding,
    cardPaddingBase: token.paddingLG,
    cardActionsIconSize: token.fontSize,
    cardPaddingSM: 12 // Fixed padding.
  });
  return [
  // Style
  genCardStyle(cardToken),
  // Size
  genCardSizeStyle(cardToken)];
}, prepareComponentToken));
;// ./node_modules/antd/es/card/Card.js
"use client";

var Card_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};










const ActionNode = props => {
  const {
    actionClasses,
    actions = [],
    actionStyle
  } = props;
  return /*#__PURE__*/react.createElement("ul", {
    className: actionClasses,
    style: actionStyle
  }, actions.map((action, index) => {
    // Move this out since eslint not allow index key
    // And eslint-disable makes conflict with rollup
    // ref https://github.com/ant-design/ant-design/issues/46022
    const key = `action-${index}`;
    return /*#__PURE__*/react.createElement("li", {
      style: {
        width: `${100 / actions.length}%`
      },
      key: key
    }, /*#__PURE__*/react.createElement("span", null, action));
  }));
};
const Card = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      style,
      extra,
      headStyle = {},
      bodyStyle = {},
      title,
      loading,
      bordered = true,
      size: customizeSize,
      type,
      cover,
      actions,
      tabList,
      children,
      activeTabKey,
      defaultActiveTabKey,
      tabBarExtraContent,
      hoverable,
      tabProps = {},
      classNames: customClassNames,
      styles: customStyles
    } = props,
    others = Card_rest(props, ["prefixCls", "className", "rootClassName", "style", "extra", "headStyle", "bodyStyle", "title", "loading", "bordered", "size", "type", "cover", "actions", "tabList", "children", "activeTabKey", "defaultActiveTabKey", "tabBarExtraContent", "hoverable", "tabProps", "classNames", "styles"]);
  const {
    getPrefixCls,
    direction,
    card
  } = react.useContext(context/* ConfigContext */.QO);
  // =================Warning===================
  if (false) {}
  const onTabChange = key => {
    var _a;
    (_a = props.onTabChange) === null || _a === void 0 ? void 0 : _a.call(props, key);
  };
  const moduleClass = moduleName => {
    var _a;
    return classnames_default()((_a = card === null || card === void 0 ? void 0 : card.classNames) === null || _a === void 0 ? void 0 : _a[moduleName], customClassNames === null || customClassNames === void 0 ? void 0 : customClassNames[moduleName]);
  };
  const moduleStyle = moduleName => {
    var _a;
    return Object.assign(Object.assign({}, (_a = card === null || card === void 0 ? void 0 : card.styles) === null || _a === void 0 ? void 0 : _a[moduleName]), customStyles === null || customStyles === void 0 ? void 0 : customStyles[moduleName]);
  };
  const isContainGrid = react.useMemo(() => {
    let containGrid = false;
    react.Children.forEach(children, element => {
      if ((element === null || element === void 0 ? void 0 : element.type) === card_Grid) {
        containGrid = true;
      }
    });
    return containGrid;
  }, [children]);
  const prefixCls = getPrefixCls('card', customizePrefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = card_style(prefixCls);
  const loadingBlock = /*#__PURE__*/react.createElement(skeleton/* default */.A, {
    loading: true,
    active: true,
    paragraph: {
      rows: 4
    },
    title: false
  }, children);
  const hasActiveTabKey = activeTabKey !== undefined;
  const extraProps = Object.assign(Object.assign({}, tabProps), {
    [hasActiveTabKey ? 'activeKey' : 'defaultActiveKey']: hasActiveTabKey ? activeTabKey : defaultActiveTabKey,
    tabBarExtraContent
  });
  let head;
  const mergedSize = (0,useSize/* default */.A)(customizeSize);
  const tabSize = !mergedSize || mergedSize === 'default' ? 'large' : mergedSize;
  const tabs = tabList ? (/*#__PURE__*/react.createElement(es_tabs/* default */.A, Object.assign({
    size: tabSize
  }, extraProps, {
    className: `${prefixCls}-head-tabs`,
    onChange: onTabChange,
    items: tabList.map(_a => {
      var {
          tab
        } = _a,
        item = Card_rest(_a, ["tab"]);
      return Object.assign({
        label: tab
      }, item);
    })
  }))) : null;
  if (title || extra || tabs) {
    const headClasses = classnames_default()(`${prefixCls}-head`, moduleClass('header'));
    const titleClasses = classnames_default()(`${prefixCls}-head-title`, moduleClass('title'));
    const extraClasses = classnames_default()(`${prefixCls}-extra`, moduleClass('extra'));
    const mergedHeadStyle = Object.assign(Object.assign({}, headStyle), moduleStyle('header'));
    head = /*#__PURE__*/react.createElement("div", {
      className: headClasses,
      style: mergedHeadStyle
    }, /*#__PURE__*/react.createElement("div", {
      className: `${prefixCls}-head-wrapper`
    }, title && (/*#__PURE__*/react.createElement("div", {
      className: titleClasses,
      style: moduleStyle('title')
    }, title)), extra && (/*#__PURE__*/react.createElement("div", {
      className: extraClasses,
      style: moduleStyle('extra')
    }, extra))), tabs);
  }
  const coverClasses = classnames_default()(`${prefixCls}-cover`, moduleClass('cover'));
  const coverDom = cover ? (/*#__PURE__*/react.createElement("div", {
    className: coverClasses,
    style: moduleStyle('cover')
  }, cover)) : null;
  const bodyClasses = classnames_default()(`${prefixCls}-body`, moduleClass('body'));
  const mergedBodyStyle = Object.assign(Object.assign({}, bodyStyle), moduleStyle('body'));
  const body = /*#__PURE__*/react.createElement("div", {
    className: bodyClasses,
    style: mergedBodyStyle
  }, loading ? loadingBlock : children);
  const actionClasses = classnames_default()(`${prefixCls}-actions`, moduleClass('actions'));
  const actionDom = (actions === null || actions === void 0 ? void 0 : actions.length) ? (/*#__PURE__*/react.createElement(ActionNode, {
    actionClasses: actionClasses,
    actionStyle: moduleStyle('actions'),
    actions: actions
  })) : null;
  const divProps = (0,omit/* default */.A)(others, ['onTabChange']);
  const classString = classnames_default()(prefixCls, card === null || card === void 0 ? void 0 : card.className, {
    [`${prefixCls}-loading`]: loading,
    [`${prefixCls}-bordered`]: bordered,
    [`${prefixCls}-hoverable`]: hoverable,
    [`${prefixCls}-contain-grid`]: isContainGrid,
    [`${prefixCls}-contain-tabs`]: tabList === null || tabList === void 0 ? void 0 : tabList.length,
    [`${prefixCls}-${mergedSize}`]: mergedSize,
    [`${prefixCls}-type-${type}`]: !!type,
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, className, rootClassName, hashId, cssVarCls);
  const mergedStyle = Object.assign(Object.assign({}, card === null || card === void 0 ? void 0 : card.style), style);
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", Object.assign({
    ref: ref
  }, divProps, {
    className: classString,
    style: mergedStyle
  }), head, coverDom, body, actionDom));
});
/* harmony default export */ var card_Card = (Card);
;// ./node_modules/antd/es/card/Meta.js
"use client";

var Meta_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};



const Meta = props => {
  const {
      prefixCls: customizePrefixCls,
      className,
      avatar,
      title,
      description
    } = props,
    others = Meta_rest(props, ["prefixCls", "className", "avatar", "title", "description"]);
  const {
    getPrefixCls
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('card', customizePrefixCls);
  const classString = classnames_default()(`${prefixCls}-meta`, className);
  const avatarDom = avatar ? (/*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-meta-avatar`
  }, avatar)) : null;
  const titleDom = title ? (/*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-meta-title`
  }, title)) : null;
  const descriptionDom = description ? (/*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-meta-description`
  }, description)) : null;
  const MetaDetail = titleDom || descriptionDom ? (/*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-meta-detail`
  }, titleDom, descriptionDom)) : null;
  return /*#__PURE__*/react.createElement("div", Object.assign({}, others, {
    className: classString
  }), avatarDom, MetaDetail);
};
/* harmony default export */ var card_Meta = (Meta);
;// ./node_modules/antd/es/card/index.js
"use client";




const es_card_Card = card_Card;
es_card_Card.Grid = card_Grid;
es_card_Card.Meta = card_Meta;
if (false) {}
/* harmony default export */ var card = (es_card_Card);
// EXTERNAL MODULE: ./node_modules/antd/es/modal/index.js + 27 modules
var modal = __webpack_require__(48458);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/download.js
var download = __webpack_require__(48309);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/circle-play.js
var circle_play = __webpack_require__(56808);
;// ./node_modules/lucide-react/dist/esm/icons/pen.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Pen = (0,createLucideIcon/* default */.A)("Pen", [
  [
    "path",
    {
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      key: "1a8usu"
    }
  ]
]);


//# sourceMappingURL=pen.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/clock.js
var clock = __webpack_require__(27235);
// EXTERNAL MODULE: ./src/pages/chat/plan.tsx + 3 modules
var chat_plan = __webpack_require__(75860);
// EXTERNAL MODULE: ./src/components/views/atoms.tsx
var atoms = __webpack_require__(96880);
;// ./src/components/features/Plans/PlanCard.tsx
const PlanCard=_ref=>{let{plan,onUsePlan,onEditClick,onPlanSaved,onDeletePlan,isNew=false,onEditComplete}=_ref;const{0:isHovering,1:setIsHovering}=(0,react.useState)(false);const{0:isModalOpen,1:setIsModalOpen}=(0,react.useState)(isNew);const{0:localSteps,1:setLocalSteps}=(0,react.useState)(plan.steps||[]);const{0:localTask,1:setLocalTask}=(0,react.useState)(plan.task||"");const{0:isAutoSaving,1:setIsAutoSaving}=(0,react.useState)(false);const handleDelete=async e=>{e.stopPropagation();e.preventDefault();try{if(!plan.id||!plan.user_id){console.error("Missing required IDs:",{planId:plan.id,userId:plan.user_id});return;}if(window.confirm("Are you sure you want to delete \""+plan.task+"\"?")){await api/* planAPI */.a7.deletePlan(plan.id,plan.user_id);if(onDeletePlan){onDeletePlan(plan.id);}}}catch(error){console.error("Failed to delete plan:",error);}};const handleEdit=()=>{setIsModalOpen(true);if(onEditClick){onEditClick(plan);}};const handleModalCancel=()=>{// Save any changes before closing the modal
const updatedPlan=Object.assign({},plan,{task:localTask,steps:localSteps});const hasChanges=localTask!==plan.task||JSON.stringify(localSteps)!==JSON.stringify(plan.steps);if(hasChanges){if(plan.id!==undefined&&plan.user_id!==undefined){api/* planAPI */.a7.updatePlan(plan.id,updatedPlan,plan.user_id).then(()=>{// notify parent to update the card
if(onPlanSaved){onPlanSaved(updatedPlan);}}).catch(error=>{console.error("Failed to save plan on close:",error);});}}setIsModalOpen(false);if(isNew&&onEditComplete){onEditComplete();}};const handleSavePlan=async function(updatedSteps,isAutoSave){if(isAutoSave===void 0){isAutoSave=false;}try{if(isAutoSave){setIsAutoSaving(true);}const updatedPlan=Object.assign({},plan,{task:localTask,steps:updatedSteps});if(plan.id===undefined||plan.user_id===undefined){console.error("Cannot update plan: missing IDs");return;}await api/* planAPI */.a7.updatePlan(plan.id,updatedPlan,plan.user_id);if(onPlanSaved&&!isAutoSave&&!isAutoSaving){onPlanSaved(updatedPlan);}setIsAutoSaving(false);}catch(error){console.error("Failed to save plan:",error);setIsAutoSaving(false);}};const handleExport=e=>{e.stopPropagation();e.preventDefault();try{const planData=JSON.stringify(plan,null,2);const blob=new Blob([planData],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="plan-"+plan.id+"-"+plan.task.replace(/\s+/g,"-").toLowerCase()+".json";document.body.appendChild(link);link.click();document.body.removeChild(link);URL.revokeObjectURL(url);}catch(error){console.error("Failed to export plan:",error);}};const steps=plan.steps||[];return/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(card,{key:plan.id,title:/*#__PURE__*/react.createElement("div",{className:"flex justify-between items-center"},/*#__PURE__*/react.createElement("span",{className:"truncate max-w-[80%]",title:plan.task||"Untitled Plan"},plan.task||"Untitled Plan"),isHovering&&/*#__PURE__*/react.createElement("div",{className:"flex items-center ml-2"},/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"Export plan as JSON file"},/*#__PURE__*/react.createElement("button",{className:"bg-transparent border-none cursor-pointer mr-2",onClick:handleExport,"aria-label":"Export plan"},/*#__PURE__*/react.createElement(download/* default */.A,{className:"h-5 w-5 transition-colors"}))),/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"Delete this plan"},/*#__PURE__*/react.createElement("button",{className:"bg-transparent border-none cursor-pointer",onClick:handleDelete,"aria-label":"Delete plan"},/*#__PURE__*/react.createElement(trash_2/* default */.A,{className:"h-5 w-5 transition-colors"}))))),className:"shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col",onMouseEnter:()=>setIsHovering(true),onMouseLeave:()=>setIsHovering(false),actions:[/*#__PURE__*/react.createElement("div",{key:"use",className:"flex items-center justify-center h-full"},/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"Create a new session with this plan loaded"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"text",className:"cursor-pointer flex items-center justify-center font-semibold transition-colors",onClick:()=>{if(onUsePlan)onUsePlan(plan);}},/*#__PURE__*/react.createElement(circle_play/* default */.A,{className:"h-4 w-4 mr-1"}),"Run Plan"))),/*#__PURE__*/react.createElement("div",{key:"edit",className:"flex items-center justify-center h-full"},/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"Modify plan title and steps"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"text",className:"cursor-pointer flex items-center justify-center font-semibold transition-colors",onClick:handleEdit},/*#__PURE__*/react.createElement(Pen,{className:"h-4 w-4 mr-1"}),"Edit")))]},/*#__PURE__*/react.createElement("div",{className:"flex flex-col flex-grow justify-between"},/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("div",{className:"mb-4"},/*#__PURE__*/react.createElement("p",{className:"text-sm"},steps.length," steps")),/*#__PURE__*/react.createElement("div",{className:"space-y-2 min-h-[80px]"},steps.slice(0,3).map((step,idx)=>/*#__PURE__*/react.createElement("div",{key:idx,className:"text-xs border-l-2 border-gray-200 pl-2"},step.title||"Step "+(idx+1))),steps.length>3&&/*#__PURE__*/react.createElement("div",{className:"text-xs"},"+ ",steps.length-3," more steps"))),/*#__PURE__*/react.createElement("div",{className:"mt-4 text-xs flex items-center"},plan.created_at?/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(clock/* default */.A,{className:"h-3 w-3 mr-1"}),(0,atoms/* getRelativeTimeString */.vq)(plan.created_at)):""))),/*#__PURE__*/react.createElement(modal/* default */.A,{open:isModalOpen,onCancel:handleModalCancel,footer:null,width:800,destroyOnClose:true},isModalOpen&&/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("div",{className:"mb-4"},/*#__PURE__*/react.createElement("label",{className:"block text-sm font-medium mb-1"},"Plan Title"),/*#__PURE__*/react.createElement(input/* default */.A,{type:"text",value:localTask,onChange:e=>setLocalTask(e.target.value),onPressEnter:()=>handleSavePlan(localSteps,false),placeholder:"Enter plan title"})),/*#__PURE__*/react.createElement(chat_plan["default"],{task:localTask,plan:localSteps,setPlan:setLocalSteps,viewOnly:false,onSavePlan:updatedSteps=>{handleSavePlan(updatedSteps,true);}}))));};/* harmony default export */ var Plans_PlanCard = (PlanCard);
;// ./src/components/features/Plans/PlanList.tsx
const normalizePlanData=function(planData,userId,defaultTask,preserveId// Add this parameter
){if(defaultTask===void 0){defaultTask="Untitled";}if(preserveId===void 0){preserveId=false;}return Object.assign({},preserveId&&planData.id?{id:planData.id}:{},{task:planData.task||defaultTask,steps:Array.isArray(planData.steps)?planData.steps.map(step=>({title:step.title||"Untitled Step",details:step.details||"",enabled:step.enabled!==false,open:step.open||false,agent_name:step.agent_name||""})):[],user_id:planData.user_id||userId,session_id:planData.session_id||null});};const PlanList=_ref=>{let{onTabChange,onSelectSession,onCreateSessionFromPlan}=_ref;const{0:plans,1:setPlans}=(0,react.useState)([]);const{0:loading,1:setLoading}=(0,react.useState)(true);const{0:error,1:setError}=(0,react.useState)(null);const{user}=(0,react.useContext)(provider/* appContext */.v);const planAPI=new api/* PlanAPI */.og();const sessionAPI=new api/* SessionAPI */.hq();const{0:isCreatingPlan,1:setIsCreatingPlan}=(0,react.useState)(false);const fileInputRef=(0,react.useRef)(null);const{0:isDragging,1:setIsDragging}=(0,react.useState)(false);const{0:searchTerm,1:setSearchTerm}=(0,react.useState)("");const{0:newPlanId,1:setNewPlanId}=(0,react.useState)(null);const userId=(user===null||user===void 0?void 0:user.email)||"";const fetchPlans=async()=>{try{setLoading(true);const response=await planAPI.listPlans(userId);const validatedPlans=response.map(plan=>normalizePlanData(plan,userId,"Untitled",true)// preserve ID
);setPlans(validatedPlans);}catch(err){console.error("Error fetching plans:",err);setError("An error occurred: "+(err instanceof Error?err.message:String(err)));}finally{setLoading(false);}};(0,react.useEffect)(()=>{if(user!==null&&user!==void 0&&user.email){fetchPlans();}else{setLoading(false);setError("Please sign in to view your plans");}},[user===null||user===void 0?void 0:user.email]);const handleDeletePlan=planId=>{setPlans(prevPlans=>prevPlans.filter(plan=>plan.id!==planId));message/* default */.Ay.success("Plan deleted successfully");};const handlePlanSaved=updatedPlan=>{setPlans(prevPlans=>prevPlans.map(p=>p.id===updatedPlan.id?updatedPlan:p));fetchPlans();};const handleUsePlan=async plan=>{try{message/* default */.Ay.loading({content:"Creating new session from plan...",key:"sessionCreation"});const sessionResponse=await sessionAPI.createSession({name:"Plan: "+plan.task,team_id:undefined,// TODO: remove team_id if not needed
agent:undefined// plans may not have agent; keep undefined
},userId);if(onCreateSessionFromPlan&&sessionResponse.id){onCreateSessionFromPlan(sessionResponse.id,"Plan: "+plan.task,plan);}if(onTabChange){onTabChange("current_session");}}catch(error){console.error("Error using plan:",error);message/* default */.Ay.error({content:"Error creating session",key:"sessionCreation"});}};const handleCreatePlan=async()=>{try{setIsCreatingPlan(true);const newPlan=normalizePlanData({task:"New Plan",steps:[]},userId);const response=await planAPI.createPlan(newPlan,userId);if(response&&response.id){message/* default */.Ay.success("New plan created successfully");setNewPlanId(response.id);// Store the new plan ID
fetchPlans();// Refresh the list to include the new plan
}}catch(err){console.error("Error creating new plan:",err);message/* default */.Ay.error("Failed to create plan: "+(err instanceof Error?err.message:String(err)));}finally{setIsCreatingPlan(false);}};const handleImportPlan=async file=>{try{const fileContent=await file.text();let planData;try{planData=JSON.parse(fileContent);}catch(parseError){message/* default */.Ay.error({content:"Invalid JSON file format. Please check your file and try again.",duration:5});return;}if(!planData||typeof planData!=="object"){message/* default */.Ay.error({content:"Invalid plan format. The file does not contain a valid plan structure.",duration:5});return;}const newPlan=normalizePlanData(planData,userId,"Imported Plan");const response=await planAPI.createPlan(newPlan,userId);if(response&&response.id){message/* default */.Ay.success("Plan imported successfully");fetchPlans();// Refresh to get the new plan with its ID
}}catch(err){console.error("Error importing plan:",err);message/* default */.Ay.error({content:"Failed to import plan: "+(err instanceof Error?err.message:String(err)),duration:5});}};const handleFileUpload=event=>{const files=event.target.files;if(files&&files.length>0){handleImportPlan(files[0]);}// Reset the input so the same file can be selected again
if(fileInputRef.current){fileInputRef.current.value="";}};const handleDragOver=e=>{e.preventDefault();setIsDragging(true);};const handleDragLeave=e=>{e.preventDefault();setIsDragging(false);};const handleDrop=e=>{e.preventDefault();setIsDragging(false);const files=e.dataTransfer.files;if(files&&files.length>0){const file=files[0];if(file.type==="application/json"||file.name.endsWith(".json")){handleImportPlan(file);}else{message/* default */.Ay.error("Please upload a JSON file");}}};// Filter plans based on search term
const filteredPlans=plans.filter(plan=>plan.task.toLowerCase().includes(searchTerm.toLowerCase()));if(loading){return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full"},/*#__PURE__*/react.createElement(spin/* default */.A,{size:"large",tip:"Loading plans..."}));}if(error){return/*#__PURE__*/react.createElement("div",{className:"text-center p-8 text-red-500"},/*#__PURE__*/react.createElement("p",null,error),/*#__PURE__*/react.createElement("button",{className:"mt-4 px-4 py-2 bg-primary text-white rounded hover:bg-primary/80",onClick:()=>window.location.reload()},"Retry"));}return/*#__PURE__*/react.createElement("div",{className:"container mx-auto p-4 h-[calc(100vh-150px)] overflow-auto",onDragOver:handleDragOver,onDragLeave:handleDragLeave,onDrop:handleDrop,style:{border:isDragging?"2px dashed var(--color-primary)":"2px dashed transparent",transition:"border 0.2s ease",position:"relative"}},isDragging&&/*#__PURE__*/react.createElement("div",{style:{position:"absolute",top:0,left:0,right:0,bottom:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:10,pointerEvents:"none"}},/*#__PURE__*/react.createElement("div",{className:"text-xl font-semibold text-primary"},"Drop your plan file here to import")),/*#__PURE__*/react.createElement("div",{className:"flex justify-between items-center mb-6"},/*#__PURE__*/react.createElement("h1",{className:"text-2xl font-bold"},"Your Saved Plans"),/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2 w-1/3"},/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"Create a new empty plan"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{icon:/*#__PURE__*/react.createElement(PlusOutlined/* default */.A,null),onClick:handleCreatePlan,className:"flex items-center"},"Create")),/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"Import a plan from a JSON file"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{icon:/*#__PURE__*/react.createElement(UploadOutlined/* default */.A,null),onClick:()=>{var _fileInputRef$current;return(_fileInputRef$current=fileInputRef.current)===null||_fileInputRef$current===void 0?void 0:_fileInputRef$current.click();},className:"flex items-center"},"Import")),/*#__PURE__*/react.createElement(input/* default */.A,{placeholder:"Search plans...",prefix:/*#__PURE__*/react.createElement(SearchOutlined/* default */.A,{className:"text-primary"}),value:searchTerm,onChange:e=>setSearchTerm(e.target.value),className:"rounded-md",allowClear:true}),/*#__PURE__*/react.createElement("input",{type:"file",ref:fileInputRef,onChange:handleFileUpload,accept:".json",style:{display:"none"}}))),/*#__PURE__*/react.createElement("div",{className:"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"},filteredPlans.length>0?filteredPlans.map(plan=>/*#__PURE__*/react.createElement("div",{key:plan.id,className:"h-full"},/*#__PURE__*/react.createElement(Plans_PlanCard,{plan:plan,onUsePlan:handleUsePlan,onPlanSaved:handlePlanSaved,onDeletePlan:handleDeletePlan,isNew:plan.id===newPlanId,onEditComplete:()=>setNewPlanId(null)}))):searchTerm?/*#__PURE__*/react.createElement("div",{className:"col-span-3 flex flex-col items-center justify-center py-12 text-primary"},/*#__PURE__*/react.createElement(SearchOutlined/* default */.A,{style:{fontSize:"48px",marginBottom:"16px"}}),/*#__PURE__*/react.createElement("p",null,"No plans found matching \"",searchTerm,"\""),/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"link",onClick:()=>setSearchTerm(""),className:"mt-2"},"Clear search")):/*#__PURE__*/react.createElement("div",{className:"col-span-3 flex flex-col items-center justify-center py-12 text-primary"},/*#__PURE__*/react.createElement("p",null,"No plans yet. Create one or import an existing plan."))));};/* harmony default export */ var Plans_PlanList = (PlanList);
// EXTERNAL MODULE: ./src/components/store.tsx
var store = __webpack_require__(32134);
// EXTERNAL MODULE: ./src/pages/chat/chat.tsx + 7 modules
var chat = __webpack_require__(7654);
// EXTERNAL MODULE: ./src/pages/chat/NewChatView.tsx
var NewChatView = __webpack_require__(13907);
// EXTERNAL MODULE: ./src/components/views/hooks/useAgentManager.ts
var useAgentManager = __webpack_require__(31946);
// EXTERNAL MODULE: ./src/hooks/useRouter.ts
var useRouter = __webpack_require__(13555);
;// ./src/components/views/hooks/useSessionStorage.ts
/**
 * LocalStorage utilities for session persistence
 */const SESSION_STORAGE_KEY='current_session_id';const SELECTED_AGENT_KEY='selected_agent';const useSessionStorage=()=>{const saveSessionId=sessionId=>{if(typeof window!=="undefined"){if(sessionId){localStorage.setItem(SESSION_STORAGE_KEY,sessionId.toString());}else{localStorage.removeItem(SESSION_STORAGE_KEY);}}};const getSessionId=()=>{if(typeof window!=="undefined"){const stored=localStorage.getItem(SESSION_STORAGE_KEY);return stored?parseInt(stored,10):null;}return null;};return{saveSessionId,getSessionId};};
;// ./src/components/views/hooks/useSessionManager.ts
const useSessionManager=_ref=>{let{userEmail,onSuccess,onError}=_ref;const{session,setSession,sessions,setSessions}=useConfigStore();const{selectedAgent,setSelectedAgent,setMode,setConfig}=(0,modeConfig/* useModeConfigStore */.Q)();const{saveSessionId,getSessionId}=useSessionStorage();const{0:isLoading,1:setIsLoading}=(0,react.useState)(false);const{0:isSessionLoading,1:setIsSessionLoading}=(0,react.useState)(false);const{0:sessionRunStatuses,1:setSessionRunStatuses}=(0,react.useState)({});const{0:pendingFirstMessage,1:setPendingFirstMessage}=(0,react.useState)(null);// 标记用户主动清空session（使用 ref 避免状态更新延迟）
const{0:isIntentionalSessionClear,1:setIsIntentionalSessionClear}=(0,react.useState)(false);const isIntentionalSessionClearRef=(0,react.useRef)(false);const hasInitializedRef=(0,react.useRef)(false);const lastUserEmailRef=(0,react.useRef)(userEmail);// Reset initialization flag when user changes
if(lastUserEmailRef.current!==userEmail){lastUserEmailRef.current=userEmail;hasInitializedRef.current=false;}// Fetch sessions from API
const fetchSessions=(0,react.useCallback)(async()=>{if(!userEmail)return;try{setIsLoading(true);const data=await api/* sessionAPI */.jT.listSessions(userEmail);setSessions(data);// Only auto-load session on initial fetch
if(!hasInitializedRef.current){hasInitializedRef.current=true;// Check URL params - only load session if explicitly specified in URL
const params=new URLSearchParams(window.location.search);const urlSessionId=params.get("sessionId");if(urlSessionId){// Load session from URL
const sessionIdNum=parseInt(urlSessionId,10);const sessionToLoad=data.find(s=>s.id===sessionIdNum)||null;if(sessionToLoad&&!session){try{const fullSessionData=await api/* sessionAPI */.jT.getSession(sessionToLoad.id,userEmail);setSession(fullSessionData);// Reset intentional clear flag
isIntentionalSessionClearRef.current=false;setIsIntentionalSessionClear(false);// Update agent config
if(fullSessionData.agent_mode_config){setSelectedAgent(fullSessionData.agent_mode_config);setMode(fullSessionData.agent_mode_config.mode);try{const agentConfig=await api/* agentAPI */.cM.getAgentConfig(userEmail,fullSessionData.agent_mode_config.mode);if(agentConfig){setConfig(agentConfig.config);}}catch(e){console.warn("Failed to load agent config:",e);}}window.history.pushState({},"","?sessionId="+sessionToLoad.id);}catch(error){console.error("Error loading session details:",error);}}}else{// No URL sessionId - clear localStorage and don't auto-load any session
// This ensures we always show welcome page when opening the app fresh
saveSessionId(null);setSession(null);// Preserve other query params (e.g. menu/view), only remove sessionId
const params=new URLSearchParams(window.location.search);params.delete("sessionId");const nextSearch=params.toString();window.history.replaceState({},"",""+window.location.pathname+(nextSearch?"?"+nextSearch:""));}// The selected agent will be restored from localStorage separately
}}catch(error){console.error("Error fetching sessions:",error);onError===null||onError===void 0?void 0:onError("Error loading sessions");}finally{setIsLoading(false);}},[userEmail]);// eslint-disable-line react-hooks/exhaustive-deps
// Note: This should only depend on userEmail to avoid infinite loops
// Other dependencies (setSessions, setSession, etc.) are stable from stores
// session state is checked inside but shouldn't trigger refetch
// Select a session
const selectSession=(0,react.useCallback)(async selectedSession=>{if(!userEmail||!(selectedSession!==null&&selectedSession!==void 0&&selectedSession.id)||isSessionLoading)return;try{setIsLoading(true);setIsSessionLoading(true);const data=await api/* sessionAPI */.jT.getSession(selectedSession.id,userEmail);if(!data){saveSessionId(null);onError===null||onError===void 0?void 0:onError("Session not found");window.history.pushState({},"",window.location.pathname);if(Array.isArray(sessions)&&sessions.length>0){setSession(sessions[0]);}else{setSession(null);}return;}setSession(data);// 重置清空标志
isIntentionalSessionClearRef.current=false;setIsIntentionalSessionClear(false);// 同步更新全局选中智能体
if(data.agent_mode_config){setSelectedAgent(data.agent_mode_config);setMode(data.agent_mode_config.mode);try{const agentConfig=await api/* agentAPI */.cM.getAgentConfig(userEmail,data.agent_mode_config.mode);if(agentConfig){setConfig(agentConfig.config);}}catch(e){console.warn("Failed to load agent config:",e);}}window.history.pushState({},"","?sessionId="+selectedSession.id);}catch(error){console.error("Error loading session:",error);if(error instanceof Error&&error.message.includes("Failed to fetch session")){saveSessionId(null);}onError===null||onError===void 0?void 0:onError("Error loading session");window.history.pushState({},"",window.location.pathname);if(Array.isArray(sessions)&&sessions.length>0){setSession(sessions[0]);if(sessions[0].agent_mode_config){setSelectedAgent(sessions[0].agent_mode_config);setMode(sessions[0].agent_mode_config.mode||"");}}else{setSession(null);setSelectedAgent(null);setMode("");setConfig({});}}finally{setIsLoading(false);setIsSessionLoading(false);}},[userEmail,isSessionLoading,sessions,setSession,setSelectedAgent,setMode,setConfig,saveSessionId,onError]);// Create default session
const createDefaultSession=(0,react.useCallback)(async()=>{if(!userEmail)return;try{setIsLoading(true);const defaultName="Default Session - "+new Date().toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"});const created=await api/* sessionAPI */.jT.createSession({name:defaultName,agent_mode_config:{}},userEmail);setSessions([created].concat((0,toConsumableArray/* default */.A)(Array.isArray(sessions)?sessions:[])));setSession(created);if(created.id){window.history.pushState({},"","?sessionId="+created.id);}}catch(error){console.error("Error creating default session:",error);onError===null||onError===void 0?void 0:onError("Error creating default session");}finally{setIsLoading(false);}},[userEmail,sessions,setSessions,setSession,onError]);// Create new chat session with first message
const createNewChatSession=(0,react.useCallback)(async function(agent,query,files,plan){if(files===void 0){files=[];}if(!userEmail){onError===null||onError===void 0?void 0:onError("User not logged in");return;}try{setIsLoading(true);// 1. 保存待发送的消息
setPendingFirstMessage({query,files,plan});// 2. 创建新会话
const sessionData={name:query.slice(0,50)||agent.name+" Chat",agent_mode_config:Object.assign({mode:agent.mode,name:agent.name},agent.config)};const created=await api/* sessionAPI */.jT.createSession(sessionData,userEmail);// 3. 更新会话列表和当前会话
setSessions([created].concat((0,toConsumableArray/* default */.A)(Array.isArray(sessions)?sessions:[])));setSession(created);// 重置标志
isIntentionalSessionClearRef.current=false;setIsIntentionalSessionClear(false);}catch(e){onError===null||onError===void 0?void 0:onError("创建会话失败");console.error(e);setPendingFirstMessage(null);}finally{setIsLoading(false);}},[userEmail,sessions,setSessions,setSession,onError]);// Update session
const updateSession=(0,react.useCallback)(async sessionData=>{if(!userEmail)return;try{setIsLoading(true);if(sessionData.id){const curSession=sessions.find(s=>s.id===sessionData.id);if(!curSession)return;curSession.name=sessionData.name||curSession.name;const updated=await api/* sessionAPI */.jT.updateSession(sessionData.id,curSession,userEmail);setSessions(Array.isArray(sessions)?sessions.map(s=>s.id===updated.id?updated:s):[updated]);if((session===null||session===void 0?void 0:session.id)===updated.id){setSession(updated);}}else{// Create new session
setSelectedAgent({mode:"magentic-one",name:"Dr.Sai WebSurfer"});const created=await api/* sessionAPI */.jT.createSession(Object.assign({},sessionData,{name:"Default Session - "+new Date().toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"}),agent_mode_config:{mode:"magentic-one",name:"Dr.Sai WebSurfer"}}),userEmail);setSessions([created].concat((0,toConsumableArray/* default */.A)(Array.isArray(sessions)?sessions:[])));setSession(created);}}catch(error){onError===null||onError===void 0?void 0:onError("Error saving session");console.error(error);}finally{setIsLoading(false);}},[userEmail,sessions,session,setSessions,setSession,setSelectedAgent,onError]);// Update session name only
const updateSessionName=(0,react.useCallback)(async sessionData=>{if(!sessionData.id||!userEmail)return;const currentSession=sessions.find(s=>s.id===sessionData.id);if(!currentSession)return;currentSession.name=sessionData.name||currentSession.name;try{const updated=await api/* sessionAPI */.jT.updateSession(sessionData.id,currentSession,userEmail);setSessions(Array.isArray(sessions)?sessions.map(s=>s.id===updated.id?updated:s):[updated]);if((session===null||session===void 0?void 0:session.id)===updated.id){setSession(updated);}}catch(error){console.error("Error updating session name:",error);onError===null||onError===void 0?void 0:onError("Error updating session name");}},[userEmail,sessions,session,setSessions,setSession,onError]);// Delete session
const deleteSession=(0,react.useCallback)(async(sessionId,closeSocket)=>{if(!userEmail)return;try{setIsLoading(true);// Close socket
closeSocket(sessionId);await api/* sessionAPI */.jT.deleteSession(sessionId,userEmail);const isDeletingCurrentSession=(session===null||session===void 0?void 0:session.id)===sessionId;const updatedSessions=Array.isArray(sessions)?sessions.filter(s=>s.id!==sessionId):[];setSessions(updatedSessions);if(isDeletingCurrentSession){saveSessionId(null);closeSocket(sessionId);// 清空当前会话，不创建默认 session
// 保持当前选中的 agent 不变
setSession(null);window.history.pushState({},"",window.location.pathname);// 触发事件，通知 manager 切换到 NewChatView
window.dispatchEvent(new CustomEvent("sessionDeleted",{detail:{sessionId}}));}else{if(session&&!updatedSessions.find(s=>s.id===session.id)){if(updatedSessions.length>0){setSession(updatedSessions[0]);if(updatedSessions[0].id){window.history.pushState({},"","?sessionId="+updatedSessions[0].id);}}else{setSession(null);}}}onSuccess===null||onSuccess===void 0?void 0:onSuccess("Session deleted");}catch(error){console.error("Error deleting session:",error);onError===null||onError===void 0?void 0:onError("Error deleting session");}finally{setIsLoading(false);}},[userEmail,session,sessions,setSessions,setSession,saveSessionId,onSuccess,onError]);// Clear current session (when switching agents)
const clearCurrentSession=(0,react.useCallback)(()=>{isIntentionalSessionClearRef.current=true;setIsIntentionalSessionClear(true);setSession(null);saveSessionId(null);// Preserve other query params (e.g. menu/view), only remove sessionId
const params=new URLSearchParams(window.location.search);params.delete("sessionId");const nextSearch=params.toString();window.history.replaceState({},"",""+window.location.pathname+(nextSearch?"?"+nextSearch:""));},[setSession,saveSessionId]);// Update session run status
const updateSessionRunStatus=(0,react.useCallback)((sessionId,status)=>{setSessionRunStatuses(prev=>Object.assign({},prev,{[sessionId]:status}));},[]);// Note: Auto-restore session from localStorage is now handled in fetchSessions
// This ensures the session from localStorage is properly validated against DB data
// Note: Auto-select first session is now handled in fetchSessions
// This avoids race conditions and ensures proper session selection priority
// Save session to localStorage when it changes
(0,react.useEffect)(()=>{if(session!==null&&session!==void 0&&session.id){saveSessionId(session.id);}else{saveSessionId(null);}},[session===null||session===void 0?void 0:session.id,saveSessionId]);// Handle browser back/forward
(0,react.useEffect)(()=>{const handleLocationChange=()=>{const params=new URLSearchParams(window.location.search);const sessionId=params.get("sessionId");if(!sessionId&&session){setSession(null);}};window.addEventListener("popstate",handleLocationChange);return()=>window.removeEventListener("popstate",handleLocationChange);},[session,setSession]);return{// State
session,sessions,isLoading,isSessionLoading,sessionRunStatuses,pendingFirstMessage,isIntentionalSessionClear,// Actions
fetchSessions,selectSession,createDefaultSession,createNewChatSession,updateSession,updateSessionName,deleteSession,clearCurrentSession,updateSessionRunStatus,setPendingFirstMessage};};
;// ./src/components/views/hooks/useWebSocketManager.ts
const useWebSocketManager=()=>{const{0:sessionSockets,1:setSessionSockets}=(0,react.useState)({});// Ref to avoid stale closure when closing existing sockets (React setState is async)
const sessionSocketsRef=(0,react.useRef)({});const getBaseUrl=(0,react.useCallback)(url=>{try{let baseUrl=url.replace(/(^\w+:|^)\/\//,"");if(baseUrl.startsWith("localhost")){baseUrl=baseUrl.replace("/api","");}else if(baseUrl==="/api"){baseUrl=window.location.host;}else{baseUrl=baseUrl.replace("/api","").replace(/\/$/,"");}return baseUrl;}catch(error){console.error("Error processing server URL:",error);throw new Error("Invalid server URL configuration");}},[]);const setupWebSocket=(0,react.useCallback)((sessionId,runId)=>{// Use ref to get current socket - avoids stale closure when called rapidly (setState is async)
const existing=sessionSocketsRef.current[sessionId];if(existing){try{existing.socket.close();}catch(e){console.warn("Error closing existing socket:",e);}}const serverUrl=(0,utils/* getServerUrl */.Tt)();const baseUrl=getBaseUrl(serverUrl);const wsProtocol=window.location.protocol==="https:"?"wss:":"ws:";const wsUrl=wsProtocol+"//"+baseUrl+"/api/ws/runs/"+runId;const socket=new WebSocket(wsUrl);const entry={socket,runId};// Update ref immediately so subsequent rapid calls see the latest socket
sessionSocketsRef.current=Object.assign({},sessionSocketsRef.current,{[sessionId]:entry});setSessionSockets(prev=>Object.assign({},prev,{[sessionId]:entry}));return socket;},[getBaseUrl]);const getSessionSocket=(0,react.useCallback)(function(sessionId,runId,fresh_socket,only_retrieve_existing_socket){if(fresh_socket===void 0){fresh_socket=false;}if(only_retrieve_existing_socket===void 0){only_retrieve_existing_socket=false;}if(fresh_socket){return setupWebSocket(sessionId,runId);}else{// Use ref for up-to-date socket reference
const existingSocket=sessionSocketsRef.current[sessionId];if((existingSocket===null||existingSocket===void 0?void 0:existingSocket.socket.readyState)===WebSocket.OPEN&&existingSocket.runId===runId){return existingSocket.socket;}if(only_retrieve_existing_socket){return null;}return setupWebSocket(sessionId,runId);}},[setupWebSocket]);const closeSocket=(0,react.useCallback)(sessionId=>{const existing=sessionSocketsRef.current[sessionId];if(existing){try{existing.socket.close();}catch(e){console.warn("Error closing socket:",e);}const updated=Object.assign({},sessionSocketsRef.current);delete updated[sessionId];sessionSocketsRef.current=updated;setSessionSockets(updated);}},[]);const stopSession=(0,react.useCallback)(sessionId=>{var _sessionSocketsRef$cu;const ws=(_sessionSocketsRef$cu=sessionSocketsRef.current[sessionId])===null||_sessionSocketsRef$cu===void 0?void 0:_sessionSocketsRef$cu.socket;if(ws&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:"stop",reason:"Cancelled by user"}));ws.close();}},[]);// Cleanup on unmount
(0,react.useEffect)(()=>{const closeAllSockets=()=>{Object.values(sessionSocketsRef.current).forEach(_ref=>{let{socket}=_ref;try{if(socket.readyState===WebSocket.OPEN){socket.close();}}catch(error){console.error("Error closing socket:",error);}});};window.addEventListener("beforeunload",closeAllSockets);window.addEventListener("offline",closeAllSockets);return()=>{window.removeEventListener("beforeunload",closeAllSockets);window.removeEventListener("offline",closeAllSockets);closeAllSockets();};},[]);return{sessionSockets,getSessionSocket,closeSocket,stopSession};};
// EXTERNAL MODULE: ./src/pages/AgentManagementPage.tsx
var AgentManagementPage = __webpack_require__(84456);
// EXTERNAL MODULE: ./src/pages/settings/ChannelsPage.tsx
var ChannelsPage = __webpack_require__(70612);
// EXTERNAL MODULE: ./src/pages/FilePreviewPage.tsx + 2 modules
var FilePreviewPage = __webpack_require__(71758);
// EXTERNAL MODULE: ./src/pages/settings/LogsPage.tsx
var LogsPage = __webpack_require__(33037);
// EXTERNAL MODULE: ./src/pages/settings/Config.tsx + 47 modules
var Config = __webpack_require__(35606);
// EXTERNAL MODULE: ./src/pages/SkillsSquarePage.tsx + 10 modules
var SkillsSquarePage = __webpack_require__(68147);
// EXTERNAL MODULE: ./src/pages/UserManagementPage.tsx
var UserManagementPage = __webpack_require__(35494);
// EXTERNAL MODULE: ./src/pages/CooperationManagementPage.tsx
var CooperationManagementPage = __webpack_require__(19378);
// EXTERNAL MODULE: ./src/pages/library/LibraryPage.tsx + 14 modules
var LibraryPage = __webpack_require__(62858);
;// ./src/components/views/menuRoutes.ts
const MENU_QUERY_KEY="menu";const VIEW_QUERY_KEY="view";const MENU_IDS={currentSession:"current_session",myAgents:"my_agents",agentSquare:"agent_square",savedPlan:"saved_plan",skillsSquare:"skills_square",library:"library",profile:"profile",channels:"channels",logs:"logs",agentManagement:"agent_management",userManagement:"user_management",cooperationManagement:"cooperation_management"};const VALID_MENU_IDS=new Set(Object.values(MENU_IDS));const DEFAULT_MENU_ID=MENU_IDS.currentSession;const DEFAULT_VIEW_ID="chat";const MENU_LABELS={[MENU_IDS.currentSession]:"聊天",[MENU_IDS.myAgents]:"我的智能体",[MENU_IDS.agentSquare]:"智能体广场",[MENU_IDS.savedPlan]:"计划",[MENU_IDS.skillsSquare]:"技能广场",[MENU_IDS.library]:"库",[MENU_IDS.profile]:"配置",[MENU_IDS.channels]:"频道",[MENU_IDS.logs]:"日志",[MENU_IDS.agentManagement]:"智能体管理",[MENU_IDS.userManagement]:"用户管理",[MENU_IDS.cooperationManagement]:"合作组管理"};const getMenuIdFromSearch=search=>{const params=new URLSearchParams(search);const rawMenu=params.get(MENU_QUERY_KEY);if(rawMenu&&VALID_MENU_IDS.has(rawMenu)){return rawMenu;}return DEFAULT_MENU_ID;};const createSearchWithMenu=(search,menuId)=>{const params=new URLSearchParams(search);params.set(MENU_QUERY_KEY,menuId);return"?"+params.toString();};const getCanvasViewFromSearch=search=>{const params=new URLSearchParams(search);const rawView=params.get(VIEW_QUERY_KEY);if(rawView==="file_preview"||rawView==="chat"){return rawView;}return DEFAULT_VIEW_ID;};const createSearchWithView=(search,viewId)=>{const params=new URLSearchParams(search);params.set(VIEW_QUERY_KEY,viewId);return"?"+params.toString();};
// EXTERNAL MODULE: ./node_modules/antd/es/form/index.js + 23 modules
var es_form = __webpack_require__(74054);
;// ./src/components/views/session_editor.tsx
const SessionEditor=_ref=>{let{session,onSave,onCancel,isOpen}=_ref;const[form]=es_form/* default */.A.useForm();const{0:teams,1:setTeams}=(0,react.useState)([]);const{0:loading,1:setLoading}=(0,react.useState)(false);const{user}=(0,react.useContext)(provider/* appContext */.v);const[messageApi,contextHolder]=message/* default */.Ay.useMessage();const getDefaultSessionName=()=>{const today=new Date();return today.toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"});};// Fetch teams when modal opens
(0,react.useEffect)(()=>{const fetchTeams=async()=>{if(isOpen){try{setLoading(true);const userId=(user===null||user===void 0?void 0:user.email)||"";const teamsData=await api/* teamAPI */.CG.listTeams(userId);setTeams(teamsData);}catch(error){messageApi.error("Error loading teams");console.error("Error loading teams:",error);}finally{setLoading(false);}}};fetchTeams();},[isOpen,user===null||user===void 0?void 0:user.email]);// Set form values when modal opens or session changes
(0,react.useEffect)(()=>{if(isOpen){form.setFieldsValue({name:(session===null||session===void 0?void 0:session.name)||getDefaultSessionName(),team_id:(session===null||session===void 0?void 0:session.team_id)||undefined});}else{form.resetFields();}},[form,session,isOpen]);const onFinish=async values=>{try{await onSave(Object.assign({},values,{id:session===null||session===void 0?void 0:session.id}));messageApi.success("Session "+(session?"updated":"created")+" successfully");}catch(error){if(error instanceof Error){messageApi.error(error.message);}}};const onFinishFailed=errorInfo=>{messageApi.error("Please check the form for errors");console.error("Form validation failed:",errorInfo);};const hasNoTeams=false;return/*#__PURE__*/react.createElement(modal/* default */.A,{title:session?"Edit Session":"Create Session",open:isOpen,onCancel:onCancel,footer:null,className:"text-primary",forceRender:true},contextHolder,/*#__PURE__*/react.createElement(es_form/* default */.A,{form:form,name:"session-form",layout:"vertical",onFinish:onFinish,onFinishFailed:onFinishFailed,autoComplete:"off"},/*#__PURE__*/react.createElement(es_form/* default */.A.Item,{label:"Session Name",name:"name",rules:[{required:true,message:"Please enter a session name"},{max:100,message:"Session name cannot exceed 100 characters"}]},/*#__PURE__*/react.createElement(input/* default */.A,null)),/*#__PURE__*/react.createElement(es_form/* default */.A.Item,{className:"flex justify-end mb-0"},/*#__PURE__*/react.createElement("div",{className:"flex gap-2"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{onClick:onCancel},"Cancel"),/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"primary",htmlType:"submit",disabled:hasNoTeams},session?"Update":"Create")))));};/* harmony default export */ var session_editor = ((/* unused pure expression or super */ null && (SessionEditor)));
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/index.js + 8 modules
var config_provider = __webpack_require__(20867);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/themes/default/index.js + 5 modules
var themes_default = __webpack_require__(14184);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/themes/seed.js
var seed = __webpack_require__(50723);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/alias.js + 1 modules
var alias = __webpack_require__(13894);
;// ./node_modules/antd/es/theme/getDesignToken.js




const getDesignToken = config => {
  const theme = (config === null || config === void 0 ? void 0 : config.algorithm) ? (0,es/* createTheme */.an)(config.algorithm) : (0,es/* createTheme */.an)(themes_default/* default */.A);
  const mergedToken = Object.assign(Object.assign({}, seed/* default */.A), config === null || config === void 0 ? void 0 : config.token);
  return (0,es/* getComputedToken */.lO)(mergedToken, {
    override: config === null || config === void 0 ? void 0 : config.token
  }, theme, alias/* default */.A);
};
/* harmony default export */ var theme_getDesignToken = (getDesignToken);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/useToken.js + 2 modules
var useToken = __webpack_require__(11320);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/context.js
var theme_context = __webpack_require__(49806);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/themes/shared/genControlHeight.js
var genControlHeight = __webpack_require__(78690);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/themes/shared/genFontMapToken.js
var genFontMapToken = __webpack_require__(51892);
;// ./node_modules/antd/es/theme/themes/compact/genCompactSizeMapToken.js
function genSizeMapToken(token) {
  const {
    sizeUnit,
    sizeStep
  } = token;
  const compactSizeStep = sizeStep - 2;
  return {
    sizeXXL: sizeUnit * (compactSizeStep + 10),
    sizeXL: sizeUnit * (compactSizeStep + 6),
    sizeLG: sizeUnit * (compactSizeStep + 2),
    sizeMD: sizeUnit * (compactSizeStep + 2),
    sizeMS: sizeUnit * (compactSizeStep + 1),
    size: sizeUnit * compactSizeStep,
    sizeSM: sizeUnit * compactSizeStep,
    sizeXS: sizeUnit * (compactSizeStep - 1),
    sizeXXS: sizeUnit * (compactSizeStep - 1)
  };
}
;// ./node_modules/antd/es/theme/themes/compact/index.js




const derivative = (token, mapToken) => {
  const mergedMapToken = mapToken !== null && mapToken !== void 0 ? mapToken : (0,themes_default/* default */.A)(token);
  const fontSize = mergedMapToken.fontSizeSM; // Smaller size font-size as base
  const controlHeight = mergedMapToken.controlHeight - 4;
  return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, mergedMapToken), genSizeMapToken(mapToken !== null && mapToken !== void 0 ? mapToken : token)), (0,genFontMapToken/* default */.A)(fontSize)), {
    // controlHeight
    controlHeight
  }), (0,genControlHeight/* default */.A)(Object.assign(Object.assign({}, mergedMapToken), {
    controlHeight
  })));
};
/* harmony default export */ var compact = (derivative);
// EXTERNAL MODULE: ./node_modules/@ant-design/colors/es/index.js + 2 modules
var colors_es = __webpack_require__(45748);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/themes/shared/genColorMapToken.js
var genColorMapToken = __webpack_require__(27484);
// EXTERNAL MODULE: ./node_modules/@ctrl/tinycolor/dist/module/index.js
var dist_module = __webpack_require__(24978);
;// ./node_modules/antd/es/theme/themes/dark/colorAlgorithm.js

const getAlphaColor = (baseColor, alpha) => new dist_module/* TinyColor */.q(baseColor).setAlpha(alpha).toRgbString();
const getSolidColor = (baseColor, brightness) => {
  const instance = new dist_module/* TinyColor */.q(baseColor);
  return instance.lighten(brightness).toHexString();
};
;// ./node_modules/antd/es/theme/themes/dark/colors.js


const generateColorPalettes = baseColor => {
  const colors = (0,colors_es/* generate */.cM)(baseColor, {
    theme: 'dark'
  });
  return {
    1: colors[0],
    2: colors[1],
    3: colors[2],
    4: colors[3],
    5: colors[6],
    6: colors[5],
    7: colors[4],
    8: colors[6],
    9: colors[5],
    10: colors[4]
    // 8: colors[9],
    // 9: colors[8],
    // 10: colors[7],
  };
};
const generateNeutralColorPalettes = (bgBaseColor, textBaseColor) => {
  const colorBgBase = bgBaseColor || '#000';
  const colorTextBase = textBaseColor || '#fff';
  return {
    colorBgBase,
    colorTextBase,
    colorText: getAlphaColor(colorTextBase, 0.85),
    colorTextSecondary: getAlphaColor(colorTextBase, 0.65),
    colorTextTertiary: getAlphaColor(colorTextBase, 0.45),
    colorTextQuaternary: getAlphaColor(colorTextBase, 0.25),
    colorFill: getAlphaColor(colorTextBase, 0.18),
    colorFillSecondary: getAlphaColor(colorTextBase, 0.12),
    colorFillTertiary: getAlphaColor(colorTextBase, 0.08),
    colorFillQuaternary: getAlphaColor(colorTextBase, 0.04),
    colorBgSolid: getAlphaColor(colorTextBase, 0.95),
    colorBgSolidHover: getAlphaColor(colorTextBase, 1),
    colorBgSolidActive: getAlphaColor(colorTextBase, 0.9),
    colorBgElevated: getSolidColor(colorBgBase, 12),
    colorBgContainer: getSolidColor(colorBgBase, 8),
    colorBgLayout: getSolidColor(colorBgBase, 0),
    colorBgSpotlight: getSolidColor(colorBgBase, 26),
    colorBgBlur: getAlphaColor(colorTextBase, 0.04),
    colorBorder: getSolidColor(colorBgBase, 26),
    colorBorderSecondary: getSolidColor(colorBgBase, 19)
  };
};
;// ./node_modules/antd/es/theme/themes/dark/index.js





const dark_derivative = (token, mapToken) => {
  const colorPalettes = Object.keys(seed/* defaultPresetColors */.r).map(colorKey => {
    const colors = (0,colors_es/* generate */.cM)(token[colorKey], {
      theme: 'dark'
    });
    return new Array(10).fill(1).reduce((prev, _, i) => {
      prev[`${colorKey}-${i + 1}`] = colors[i];
      prev[`${colorKey}${i + 1}`] = colors[i];
      return prev;
    }, {});
  }).reduce((prev, cur) => {
    // biome-ignore lint/style/noParameterAssign: it is a reduce
    prev = Object.assign(Object.assign({}, prev), cur);
    return prev;
  }, {});
  const mergedMapToken = mapToken !== null && mapToken !== void 0 ? mapToken : (0,themes_default/* default */.A)(token);
  return Object.assign(Object.assign(Object.assign({}, mergedMapToken), colorPalettes), (0,genColorMapToken/* default */.A)(token, {
    generateColorPalettes: generateColorPalettes,
    generateNeutralColorPalettes: generateNeutralColorPalettes
  }));
};
/* harmony default export */ var dark = (dark_derivative);
;// ./node_modules/antd/es/theme/index.js
"use client";






// ZombieJ: We export as object to user but array in internal.
// This is used to minimize the bundle size for antd package but safe to refactor as object also.
// Please do not export internal `useToken` directly to avoid something export unexpected.
/** Get current context Design Token. Will be different if you are using nest theme config. */
function theme_useToken() {
  const [theme, token, hashId] = (0,useToken/* default */.Ay)();
  return {
    theme,
    token,
    hashId
  };
}
/* harmony default export */ var theme = ({
  /** Default seedToken */
  defaultSeed: theme_context/* defaultConfig */.sb.token,
  useToken: theme_useToken,
  defaultAlgorithm: themes_default/* default */.A,
  darkAlgorithm: dark,
  compactAlgorithm: compact,
  getDesignToken: theme_getDesignToken,
  /**
   * @private Private variable
   * @warring 🔥 Do not use in production. 🔥
   */
  defaultConfig: theme_context/* defaultConfig */.sb,
  /**
   * @private Private variable
   * @warring 🔥 Do not use in production. 🔥
   */
  _internalContext: theme_context/* DesignTokenContext */.vG
});
;// ./node_modules/@heroicons/react/24/outline/esm/SunIcon.js

function SunIcon({
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
    d: "M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
  }));
}
const ForwardRef = /*#__PURE__*/ react.forwardRef(SunIcon);
/* harmony default export */ var esm_SunIcon = (ForwardRef);
;// ./node_modules/@heroicons/react/24/outline/esm/MoonIcon.js

function MoonIcon({
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
    d: "M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
  }));
}
const MoonIcon_ForwardRef = /*#__PURE__*/ react.forwardRef(MoonIcon);
/* harmony default export */ var esm_MoonIcon = (MoonIcon_ForwardRef);
;// ./node_modules/lucide-react/dist/esm/icons/github.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Github = (0,createLucideIcon/* default */.A)("Github", [
  [
    "path",
    {
      d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
      key: "tonef"
    }
  ],
  ["path", { d: "M9 18c-4.51 2-5-2-7-2", key: "9comsn" }]
]);


//# sourceMappingURL=github.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/book-open.js
var book_open = __webpack_require__(60665);
;// ./node_modules/lucide-react/dist/esm/icons/user.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const User = (0,createLucideIcon/* default */.A)("User", [
  ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", key: "975kel" }],
  ["circle", { cx: "12", cy: "7", r: "4", key: "17ys0d" }]
]);


//# sourceMappingURL=user.js.map

;// ./node_modules/lucide-react/dist/esm/icons/log-out.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const LogOut = (0,createLucideIcon/* default */.A)("LogOut", [
  ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", key: "1uf3rs" }],
  ["polyline", { points: "16 17 21 12 16 7", key: "1gabdz" }],
  ["line", { x1: "21", x2: "9", y1: "12", y2: "12", key: "1uyos4" }]
]);


//# sourceMappingURL=log-out.js.map

;// ./src/components/userProfile.tsx
const UserProfileModal=_ref=>{let{isVisible,onClose,user}=_ref;return/*#__PURE__*/react.createElement(modal/* default */.A,{open:isVisible,onCancel:onClose,footer:null,title:"\u7528\u6237\u4FE1\u606F",centered:true,destroyOnClose:true},/*#__PURE__*/react.createElement("div",{style:{textAlign:"center"}},/*#__PURE__*/react.createElement("div",{style:{fontWeight:"bold",fontSize:18,marginBottom:8}},(user===null||user===void 0?void 0:user.name)||(user===null||user===void 0?void 0:user.email)),/*#__PURE__*/react.createElement("div",{style:{color:"#888",marginBottom:24}},user===null||user===void 0?void 0:user.email)));};/* harmony default export */ var userProfile = (UserProfileModal);
;// ./src/layout/TopNav.tsx
const TopNav=_ref=>{let{isSidebarOpen,onToggleSidebar}=_ref;const{user,darkMode,setDarkMode}=(0,react.useContext)(provider/* appContext */.v);const{0:isProfileModalOpen,1:setIsProfileModalOpen}=(0,react.useState)(false);const{0:lang,1:setLang}=(0,react.useState)(()=>localStorage.getItem("drsai_lang")||"zh");(0,react.useEffect)(()=>{console.log(user,"user");},[user]);const handleLogout=()=>{localStorage.removeItem("token");localStorage.removeItem("username");localStorage.removeItem("user_email");localStorage.removeItem("user_name");if(true){window.location.href="/login";}else{}};const toggleLang=()=>{const next=lang==="zh"?"en":"zh";setLang(next);localStorage.setItem("drsai_lang",next);};return/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 flex items-center h-14 px-3 "+(darkMode==="dark"?"bg-[#0f0f0f]/65 backdrop-blur-md shadow-[0_12px_28px_-24px_rgba(0,0,0,0.95)]":"bg-white/70 border-b border-gray-200/80 backdrop-blur-md")+" z-[70]"},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2 flex-shrink-0"},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2 px-2.5 py-1"},/*#__PURE__*/react.createElement("img",{src:"https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",alt:"Dr.Sai Logo",className:"w-6 h-6 rounded-md object-cover"}),/*#__PURE__*/react.createElement("span",{className:"text-sm font-semibold tracking-wide text-primary whitespace-nowrap"},"OpenDrSai"))),/*#__PURE__*/react.createElement("div",{className:"flex-1"}),/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-1 flex-shrink-0"},/*#__PURE__*/react.createElement(input/* default */.A,{prefix:/*#__PURE__*/react.createElement(search/* default */.A,{className:"w-4 h-4 text-secondary"}),placeholder:lang==="zh"?"搜索...":"Search...",className:"w-64 rounded-xl mr-2 "+(darkMode==="dark"?"[&_.ant-input]:!bg-white/5 [&_.ant-input]:!text-primary [&_.ant-input-affix-wrapper]:!bg-white/5 [&_.ant-input-affix-wrapper]:!border-border-primary/50":"[&_.ant-input]:!bg-white/85 [&_.ant-input-affix-wrapper]:!bg-white/90 [&_.ant-input-affix-wrapper]:!border-gray-200"),allowClear:true}),/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:darkMode==="dark"?lang==="zh"?"切换亮色":"Light mode":lang==="zh"?"切换暗色":"Dark mode"},/*#__PURE__*/react.createElement("button",{onClick:()=>setDarkMode(darkMode==="dark"?"light":"dark"),className:"flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"},darkMode==="dark"?/*#__PURE__*/react.createElement(esm_SunIcon,{className:"w-5 h-5"}):/*#__PURE__*/react.createElement(esm_MoonIcon,{className:"w-5 h-5"}))),/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:lang==="zh"?"Switch to English":"切换为中文"},/*#__PURE__*/react.createElement("button",{onClick:toggleLang,className:"flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all text-sm font-medium"},lang==="zh"?"EN":"中")),/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"GitHub"},/*#__PURE__*/react.createElement("a",{href:"https://github.com/hepai-lab/drsai",target:"_blank",rel:"noopener noreferrer",className:"flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"},/*#__PURE__*/react.createElement(Github,{className:"w-5 h-5 stroke-[2]"}))),/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:lang==="zh"?"文档":"Documentation"},/*#__PURE__*/react.createElement("a",{href:"https://docs-drsai.ihep.ac.cn/",target:"_blank",rel:"noopener noreferrer",className:"flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"},/*#__PURE__*/react.createElement(book_open/* default */.A,{className:"w-5 h-5 stroke-[2]"}))),user&&/*#__PURE__*/react.createElement(dropdown/* default */.A,{trigger:["click"],menu:{items:[{key:"profile",label:lang==="zh"?"个人设置":"Profile Settings",icon:/*#__PURE__*/react.createElement(User,{className:"w-4 h-4"}),onClick:()=>setIsProfileModalOpen(true)},{type:"divider"},{key:"logout",label:lang==="zh"?"退出登录":"Sign Out",icon:/*#__PURE__*/react.createElement(LogOut,{className:"w-4 h-4"}),onClick:handleLogout,danger:true}]},placement:"bottomRight"},/*#__PURE__*/react.createElement("button",{className:"flex items-center gap-2 px-2 py-1.5 rounded-xl text-sm font-medium transition-colors ml-1 "+(darkMode==="dark"?"text-secondary hover:text-accent hover:bg-white/5":"text-secondary hover:text-accent hover:bg-violet-50")},user.avatar_url?/*#__PURE__*/react.createElement("img",{className:"h-6 w-6 rounded-full",src:user.avatar_url,alt:user.name}):/*#__PURE__*/react.createElement("div",{className:"h-6 w-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-medium"},String(user.name||user.email||"?").charAt(0).toUpperCase()))))),/*#__PURE__*/react.createElement(userProfile,{isVisible:isProfileModalOpen,onClose:()=>setIsProfileModalOpen(false),user:user||{name:"",email:""}}));};/* harmony default export */ var layout_TopNav = (TopNav);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/message-square.js
var message_square = __webpack_require__(47504);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/bot.js
var bot = __webpack_require__(42640);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/settings.js
var settings = __webpack_require__(80964);
;// ./node_modules/lucide-react/dist/esm/icons/shield.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Shield = (0,createLucideIcon/* default */.A)("Shield", [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ]
]);


//# sourceMappingURL=shield.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/chevron-down.js
var chevron_down = __webpack_require__(75107);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/chevron-right.js
var chevron_right = __webpack_require__(87677);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/chevron-left.js
var chevron_left = __webpack_require__(60250);
;// ./node_modules/lucide-react/dist/esm/icons/grid-2x2.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Grid2x2 = (0,createLucideIcon/* default */.A)("Grid2x2", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M3 12h18", key: "1i2n21" }],
  ["path", { d: "M12 3v18", key: "108xh3" }]
]);


//# sourceMappingURL=grid-2x2.js.map

;// ./node_modules/lucide-react/dist/esm/icons/library.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Library = (0,createLucideIcon/* default */.A)("Library", [
  ["path", { d: "m16 6 4 14", key: "ji33uf" }],
  ["path", { d: "M12 6v14", key: "1n7gus" }],
  ["path", { d: "M8 8v12", key: "1gg7y9" }],
  ["path", { d: "M4 4v16", key: "6qkkli" }]
]);


//# sourceMappingURL=library.js.map

;// ./node_modules/lucide-react/dist/esm/icons/user-cog.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const UserCog = (0,createLucideIcon/* default */.A)("UserCog", [
  ["circle", { cx: "18", cy: "15", r: "3", key: "gjjjvw" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["path", { d: "M10 15H6a4 4 0 0 0-4 4v2", key: "1nfge6" }],
  ["path", { d: "m21.7 16.4-.9-.3", key: "12j9ji" }],
  ["path", { d: "m15.2 13.9-.9-.3", key: "1fdjdi" }],
  ["path", { d: "m16.6 18.7.3-.9", key: "heedtr" }],
  ["path", { d: "m19.1 12.2.3-.9", key: "1af3ki" }],
  ["path", { d: "m19.6 18.7-.4-1", key: "1x9vze" }],
  ["path", { d: "m16.8 12.3-.4-1", key: "vqeiwj" }],
  ["path", { d: "m14.3 16.6 1-.4", key: "1qlj63" }],
  ["path", { d: "m20.7 13.8 1-.4", key: "1v5t8k" }]
]);


//# sourceMappingURL=user-cog.js.map

;// ./node_modules/lucide-react/dist/esm/icons/radio.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Radio = (0,createLucideIcon/* default */.A)("Radio", [
  ["path", { d: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9", key: "1vaf9d" }],
  ["path", { d: "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5", key: "u1ii0m" }],
  ["circle", { cx: "12", cy: "12", r: "2", key: "1c9p78" }],
  ["path", { d: "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5", key: "1j5fej" }],
  ["path", { d: "M19.1 4.9C23 8.8 23 15.1 19.1 19", key: "10b0cb" }]
]);


//# sourceMappingURL=radio.js.map

;// ./node_modules/lucide-react/dist/esm/icons/building-2.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Building2 = (0,createLucideIcon/* default */.A)("Building2", [
  ["path", { d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z", key: "1b4qmf" }],
  ["path", { d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2", key: "i71pzd" }],
  ["path", { d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2", key: "10jefs" }],
  ["path", { d: "M10 6h4", key: "1itunk" }],
  ["path", { d: "M10 10h4", key: "tcdvrf" }],
  ["path", { d: "M10 14h4", key: "kelpxr" }],
  ["path", { d: "M10 18h4", key: "1ulq68" }]
]);


//# sourceMappingURL=building-2.js.map

;// ./node_modules/lucide-react/dist/esm/icons/bot-message-square.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const BotMessageSquare = (0,createLucideIcon/* default */.A)("BotMessageSquare", [
  ["path", { d: "M12 6V2H8", key: "1155em" }],
  ["path", { d: "m8 18-4 4V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2Z", key: "w2lp3e" }],
  ["path", { d: "M2 12h2", key: "1t8f8n" }],
  ["path", { d: "M9 11v2", key: "1ueba0" }],
  ["path", { d: "M15 11v2", key: "i11awn" }],
  ["path", { d: "M20 12h2", key: "1q8mjw" }]
]);


//# sourceMappingURL=bot-message-square.js.map

;// ./node_modules/lucide-react/dist/esm/icons/users.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Users = (0,createLucideIcon/* default */.A)("Users", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
  ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75", key: "1da9ce" }]
]);


//# sourceMappingURL=users.js.map

;// ./src/layout/LeftMenu.tsx
const SECTIONS=[{id:"chat",icon:/*#__PURE__*/react.createElement(message_square/* default */.A,{className:"w-3.5 h-3.5"}),label:"聊天",defaultItem:"current_session"},{id:"agents",icon:/*#__PURE__*/react.createElement(bot/* default */.A,{className:"w-3.5 h-3.5"}),label:"智能体",defaultItem:"my_agents"},{id:"settings",icon:/*#__PURE__*/react.createElement(settings/* default */.A,{className:"w-3.5 h-3.5"}),label:"设置",defaultItem:"profile"},{id:"admin",icon:/*#__PURE__*/react.createElement(Shield,{className:"w-3.5 h-3.5"}),label:"管理员",defaultItem:"cooperation_management"}];const LeftMenu=_ref=>{let{isSidebarOpen,activeSubMenuItem,onSubMenuChange,onClose}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const isDark=darkMode==="dark";const{0:expanded,1:setExpanded}=(0,react.useState)({chat:true,agents:false,settings:false,admin:false});(0,react.useEffect)(()=>{if(["current_session"].includes(activeSubMenuItem)){setExpanded(e=>Object.assign({},e,{chat:true}));}else if(["my_agents","agent_square","skills_square","library"].includes(activeSubMenuItem)){setExpanded(e=>Object.assign({},e,{agents:true}));}else if(["profile","channels","logs"].includes(activeSubMenuItem)){setExpanded(e=>Object.assign({},e,{settings:true}));}else if(["agent_management","user_management","cooperation_management"].includes(activeSubMenuItem)){setExpanded(e=>Object.assign({},e,{admin:true}));}},[activeSubMenuItem]);const toggleSection=id=>setExpanded(e=>Object.assign({},e,{[id]:!e[id]}));const SectionHeader=_ref2=>{let{id,icon,label}=_ref2;return/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>toggleSection(id),className:"w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold tracking-wide text-secondary hover:text-primary hover:bg-tertiary/25 transition-colors"},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2"},icon,/*#__PURE__*/react.createElement("span",null,label)),expanded[id]?/*#__PURE__*/react.createElement(chevron_down/* default */.A,{className:"w-3.5 h-3.5"}):/*#__PURE__*/react.createElement(chevron_right/* default */.A,{className:"w-3.5 h-3.5"}));};const NavItem=_ref3=>{let{id,icon,label,onClick}=_ref3;const isActive=id?activeSubMenuItem===id:false;return/*#__PURE__*/react.createElement("button",{type:"button",onClick:onClick,className:"relative w-full flex items-center gap-2.5 pl-7 pr-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 "+(isActive?"bg-accent/15 text-accent font-semibold shadow-sm":"text-secondary hover:text-primary hover:bg-tertiary/25")},isActive&&/*#__PURE__*/react.createElement("span",{className:"absolute left-3 h-4 w-0.5 rounded-full bg-accent"}),/*#__PURE__*/react.createElement("span",{className:"flex-shrink-0"},icon),/*#__PURE__*/react.createElement("span",{className:"truncate"},label));};// ── Collapsed strip ──
// Map each section to the items it contains, for active highlight detection
const SECTION_ITEMS={chat:["current_session"],agents:["my_agents","agent_square","skills_square","library"],settings:["profile","channels","logs"],admin:["cooperation_management","agent_management","user_management"]};if(!isSidebarOpen){return/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center pt-1 h-full"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:onClose,title:"\u5C55\u5F00\u4FA7\u8FB9\u680F",className:"flex items-center justify-center w-full h-8 transition-colors "+(isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},/*#__PURE__*/react.createElement(chevron_right/* default */.A,{className:"w-3.5 h-3.5"})),/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center gap-1 mt-2"},SECTIONS.map(s=>{const isSectionActive=SECTION_ITEMS[s.id].includes(activeSubMenuItem);return/*#__PURE__*/react.createElement(tooltip/* default */.A,{key:s.id,title:s.label,placement:"right"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{onSubMenuChange(s.defaultItem);onClose();},className:"flex items-center justify-center w-7 h-7 rounded-lg transition-colors "+(isSectionActive?"text-accent bg-accent/10":isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},s.icon));})));}// ── Expanded ──
return/*#__PURE__*/react.createElement("div",{className:"h-full flex flex-col"},/*#__PURE__*/react.createElement("div",{className:"px-3 pt-3 flex items-center justify-end"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:onClose,title:"\u6536\u8D77\u4FA7\u8FB9\u680F",className:"flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors "+(isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},/*#__PURE__*/react.createElement(chevron_left/* default */.A,{className:"w-3.5 h-3.5"}))),/*#__PURE__*/react.createElement("div",{className:"flex-1 overflow-y-auto px-2 pt-2 pb-4 sidebar-scroll space-y-1"},/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement(SectionHeader,{id:"chat",icon:/*#__PURE__*/react.createElement(message_square/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u804A\u5929"}),expanded.chat&&/*#__PURE__*/react.createElement("div",{className:"mt-0.5 space-y-0.5"},/*#__PURE__*/react.createElement(NavItem,{id:"current_session",icon:/*#__PURE__*/react.createElement(message_square/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u804A\u5929",onClick:()=>onSubMenuChange("current_session")}))),/*#__PURE__*/react.createElement("div",{className:"h-px bg-border-primary/25 my-1.5"}),/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement(SectionHeader,{id:"agents",icon:/*#__PURE__*/react.createElement(bot/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u667A\u80FD\u4F53"}),expanded.agents&&/*#__PURE__*/react.createElement("div",{className:"mt-0.5 space-y-0.5"},/*#__PURE__*/react.createElement(NavItem,{id:"agent_square",icon:/*#__PURE__*/react.createElement(Grid2x2,{className:"w-3.5 h-3.5"}),label:"\u667A\u80FD\u4F53\u5E7F\u573A",onClick:()=>onSubMenuChange("agent_square")}),/*#__PURE__*/react.createElement(NavItem,{id:"skills_square",icon:/*#__PURE__*/react.createElement(zap/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u6280\u80FD\u5E7F\u573A",onClick:()=>onSubMenuChange("skills_square")}),/*#__PURE__*/react.createElement(NavItem,{id:"library",icon:/*#__PURE__*/react.createElement(Library,{className:"w-3.5 h-3.5"}),label:"\u5E93",onClick:()=>onSubMenuChange("library")}))),/*#__PURE__*/react.createElement("div",{className:"h-px bg-border-primary/25 my-1.5"}),/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement(SectionHeader,{id:"settings",icon:/*#__PURE__*/react.createElement(settings/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u8BBE\u7F6E"}),expanded.settings&&/*#__PURE__*/react.createElement("div",{className:"mt-0.5 space-y-0.5"},/*#__PURE__*/react.createElement(NavItem,{id:"profile",icon:/*#__PURE__*/react.createElement(UserCog,{className:"w-3.5 h-3.5"}),label:"\u914D\u7F6E",onClick:()=>onSubMenuChange("profile")}),/*#__PURE__*/react.createElement(NavItem,{id:"channels",icon:/*#__PURE__*/react.createElement(Radio,{className:"w-3.5 h-3.5"}),label:"\u9891\u9053",onClick:()=>onSubMenuChange("channels")}))),/*#__PURE__*/react.createElement("div",{className:"h-px bg-border-primary/25 my-1.5"}),/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement(SectionHeader,{id:"admin",icon:/*#__PURE__*/react.createElement(Shield,{className:"w-3.5 h-3.5"}),label:"\u7BA1\u7406\u5458"}),expanded.admin&&/*#__PURE__*/react.createElement("div",{className:"mt-0.5 space-y-0.5"},/*#__PURE__*/react.createElement(NavItem,{id:"cooperation_management",icon:/*#__PURE__*/react.createElement(Building2,{className:"w-3.5 h-3.5"}),label:"\u5408\u4F5C\u7EC4\u7BA1\u7406",onClick:()=>onSubMenuChange("cooperation_management")}),/*#__PURE__*/react.createElement(NavItem,{id:"agent_management",icon:/*#__PURE__*/react.createElement(BotMessageSquare,{className:"w-3.5 h-3.5"}),label:"\u667A\u80FD\u4F53\u7BA1\u7406",onClick:()=>onSubMenuChange("agent_management")}),/*#__PURE__*/react.createElement(NavItem,{id:"user_management",icon:/*#__PURE__*/react.createElement(Users,{className:"w-3.5 h-3.5"}),label:"\u7528\u6237\u7BA1\u7406",onClick:()=>onSubMenuChange("user_management")})))));};/* harmony default export */ var layout_LeftMenu = (LeftMenu);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
;// ./src/layout/Canvas.tsx
// const VIEWS: { id: CanvasViewId; label: string; icon: React.ReactNode }[] = [
//   { id: "chat", label: "对话", icon: <MessageSquare className="w-3.5 h-3.5" /> },
//   { id: "file_preview", label: "文件预览", icon: <FileText className="w-3.5 h-3.5" /> },
// ];
const Canvas=_ref=>{let{children,filePreviewContent,activeView,activeMenuLabel,onViewChange,onNewSession,showNewSessionButton=false}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const location=(0,useRouter/* useLocation */.z)();const navigate=(0,useRouter/* useNavigate */.Z)();const activeMenuId=getMenuIdFromSearch(location.search);const session=useConfigStore(s=>s.session);const agentInfo=(0,modeConfig/* useModeConfigStore */.Q)(s=>s.agentInfo);const selectedAgent=(0,modeConfig/* useModeConfigStore */.Q)(s=>s.selectedAgent);const{agentDisplayName,defaultConfigLabel}=(0,react.useMemo)(()=>{var _ref2,_ref3,_sessionAgentModeConf;const sessionAgentModeConfig=(session===null||session===void 0?void 0:session.agent_mode_config)||null;const name=typeof(sessionAgentModeConfig===null||sessionAgentModeConfig===void 0?void 0:sessionAgentModeConfig.name)==="string"&&sessionAgentModeConfig.name.trim()||typeof(agentInfo===null||agentInfo===void 0?void 0:agentInfo.name)==="string"&&agentInfo.name.trim()||typeof(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.name)==="string"&&selectedAgent.name.trim()||typeof(sessionAgentModeConfig===null||sessionAgentModeConfig===void 0?void 0:sessionAgentModeConfig.mode)==="string"&&sessionAgentModeConfig.mode.trim()||typeof(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.mode)==="string"&&selectedAgent.mode.trim()||"";const cfgRaw=(_ref2=(_ref3=(_sessionAgentModeConf=sessionAgentModeConfig===null||sessionAgentModeConfig===void 0?void 0:sessionAgentModeConfig.defult_config_name)!==null&&_sessionAgentModeConf!==void 0?_sessionAgentModeConf:agentInfo===null||agentInfo===void 0?void 0:agentInfo.defult_config_name)!==null&&_ref3!==void 0?_ref3:selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.defult_config_name)!==null&&_ref2!==void 0?_ref2:"";const cfg=typeof cfgRaw==="string"?cfgRaw.trim():String(cfgRaw||"").trim();const normalizedCfg=/^default$/i.test(cfg)?"":cfg;return{agentDisplayName:name,defaultConfigLabel:normalizedCfg};},[session===null||session===void 0?void 0:session.id,session===null||session===void 0?void 0:session.agent_mode_config,agentInfo,selectedAgent]);const hasActiveSession=Boolean(session===null||session===void 0?void 0:session.id);const showSessionAgentBar=activeMenuId===MENU_IDS.currentSession&&hasActiveSession&&(Boolean(agentDisplayName)||Boolean(defaultConfigLabel));return/*#__PURE__*/react.createElement("div",{className:"h-full flex flex-col min-h-0 overflow-hidden"},/*#__PURE__*/react.createElement("div",{className:"relative flex-shrink-0 flex items-center gap-1 px-4 h-11 text-sm "+(darkMode==="dark"?"bg-white/[0.02]":"border-b border-gray-200/80 bg-white/60")},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-1 min-w-0 flex-shrink z-10"},/*#__PURE__*/react.createElement("span",{className:"text-secondary font-medium tracking-wide"},"OpenDrSai"),/*#__PURE__*/react.createElement(chevron_right/* default */.A,{className:"w-3.5 h-3.5 text-secondary/50 flex-shrink-0"}),/*#__PURE__*/react.createElement("span",{className:"px-2 py-0.5 rounded-md text-xs font-medium "+(darkMode==="dark"?"bg-violet-500/10 text-violet-200":"bg-violet-100 text-violet-700")},activeMenuLabel)),showSessionAgentBar&&/*#__PURE__*/react.createElement("div",{className:"pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center px-28 sm:px-36","aria-live":"polite"},/*#__PURE__*/react.createElement("div",{className:"flex max-w-[min(480px,52vw)] min-w-0 items-center gap-2.5 p-0"},/*#__PURE__*/react.createElement(bot/* default */.A,{className:"h-6 w-6 flex-shrink-0 text-accent opacity-90 animate-logo-hop motion-reduce:animate-none",strokeWidth:2,"aria-hidden":true}),/*#__PURE__*/react.createElement("div",{className:"flex min-w-0 flex-1 flex-row flex-nowrap items-baseline gap-x-1 text-left font-agent"},agentDisplayName?/*#__PURE__*/react.createElement("span",{className:"min-w-0 truncate text-[1.0625rem] sm:text-lg font-bold leading-tight tracking-[-0.03em] antialiased "+(defaultConfigLabel?"flex-none max-w-[min(13rem,46%)]":"max-w-full")+" "+(darkMode==="dark"?"text-white [text-shadow:0_1px_24px_rgba(167,139,250,0.12)]":"text-slate-900"),title:agentDisplayName},agentDisplayName):null,defaultConfigLabel?/*#__PURE__*/react.createElement("span",{className:"font-agent-mono min-w-0 truncate text-[0.8125rem] font-medium tracking-wide "+(agentDisplayName?"flex-1 text-left":"max-w-full text-left")+" "+(darkMode==="dark"?"text-violet-300/85":"text-violet-700/90"),title:defaultConfigLabel},defaultConfigLabel):null))),/*#__PURE__*/react.createElement("div",{className:"ml-auto flex items-center gap-2 flex-shrink-0 z-10"},showNewSessionButton&&onNewSession&&activeMenuId===MENU_IDS.currentSession&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:onNewSession,className:"flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors "+(darkMode==="dark"?"bg-white/[0.04] hover:bg-white/[0.07] text-secondary border border-border-primary/30":"bg-white/70 hover:bg-white text-gray-700 border border-gray-200/80"),"aria-label":"\u65B0\u5EFA\u4F1A\u8BDD",title:"\u65B0\u5EFA\u4F1A\u8BDD"},/*#__PURE__*/react.createElement(plus/* default */.A,{className:"w-3.5 h-3.5"}),/*#__PURE__*/react.createElement("span",null,"\u65B0\u5EFA\u4F1A\u8BDD")),activeMenuId===MENU_IDS.currentSession&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{const withMenu=createSearchWithMenu(location.search,MENU_IDS.agentSquare);navigate(createSearchWithView(withMenu,"chat"));},className:"group relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 "+(darkMode==="dark"?"ring-offset-[#0b0f19]":"ring-offset-white"),"aria-label":"\u4F53\u9A8C\u66F4\u591A\uFF1A\u8DF3\u8F6C\u667A\u80FD\u4F53\u5E7F\u573A",title:"\u4F53\u9A8C\u66F4\u591A\uFF1A\u667A\u80FD\u4F53\u5E7F\u573A"},/*#__PURE__*/react.createElement("span",{className:"absolute inset-0 rounded-lg opacity-100 transition-opacity "+(darkMode==="dark"?"bg-gradient-to-r from-fuchsia-500/90 via-violet-500/90 to-indigo-500/90":"bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500")}),/*#__PURE__*/react.createElement("span",{className:"absolute -inset-0.5 rounded-xl blur opacity-40 transition-opacity group-hover:opacity-70 "+(darkMode==="dark"?"bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500":"bg-gradient-to-r from-fuchsia-400 via-violet-400 to-indigo-400")}),/*#__PURE__*/react.createElement("span",{className:"relative inline-flex items-center gap-2 "+(darkMode==="dark"?"text-white":"text-white")},/*#__PURE__*/react.createElement(Grid2x2,{className:"w-3.5 h-3.5"}),/*#__PURE__*/react.createElement("span",null,"\u4F53\u9A8C\u66F4\u591A"))))),/*#__PURE__*/react.createElement("div",{className:"flex-1 min-h-0 overflow-hidden rounded-b-2xl"},/*#__PURE__*/react.createElement("div",{className:activeView==="chat"?"h-full":"hidden"},children),/*#__PURE__*/react.createElement("div",{className:activeView==="file_preview"?"h-full":"hidden"},filePreviewContent!==null&&filePreviewContent!==void 0?filePreviewContent:/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement(file_text/* default */.A,{className:"w-10 h-10 mx-auto mb-3 opacity-20"}),/*#__PURE__*/react.createElement("p",{className:"text-sm opacity-40"},"\u6682\u65E0\u6587\u4EF6"))))));};/* harmony default export */ var layout_Canvas = (Canvas);
;// ./node_modules/lucide-react/dist/esm/icons/activity.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Activity = (0,createLucideIcon/* default */.A)("Activity", [
  [
    "path",
    {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
      key: "169zse"
    }
  ]
]);


//# sourceMappingURL=activity.js.map

// EXTERNAL MODULE: ./src/store/rightPanel.ts
var rightPanel = __webpack_require__(46886);
;// ./src/layout/RightPanel.tsx
const TABS=[{id:"files",label:"文件空间",icon:/*#__PURE__*/react.createElement(file_text/* default */.A,{className:"w-3.5 h-3.5"})},{id:"overview",label:"运行概览",icon:/*#__PURE__*/react.createElement(Activity,{className:"w-3.5 h-3.5"})},{id:"history",label:"历史会话",icon:/*#__PURE__*/react.createElement(clock/* default */.A,{className:"w-3.5 h-3.5"})}];const RightPanel=_ref=>{let{width=380,historyContent,filesContent,onTabChange}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const activeTab=(0,rightPanel/* useRightPanelStore */.x)(s=>s.layoutTab);const setActiveTab=(0,rightPanel/* useRightPanelStore */.x)(s=>s.setLayoutTab);const isOpen=(0,rightPanel/* useRightPanelStore */.x)(s=>s.isOpen);const setIsOpen=(0,rightPanel/* useRightPanelStore */.x)(s=>s.setIsOpen);const setOverviewSlot=(0,rightPanel/* useRightPanelStore */.x)(s=>s.setOverviewSlot);const overviewSlotRef=(0,react.useCallback)(el=>{setOverviewSlot(el);},[setOverviewSlot]);const isDark=darkMode==="dark";return/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 flex flex-col h-full transition-all duration-300 overflow-hidden shadow-modern "+(isOpen?"rounded-2xl":"rounded-lg")+" "+(isDark?"bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg":"bg-white/90 border border-gray-200/70 backdrop-blur-md"),style:{width:isOpen?width:40}},isOpen?/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 flex items-stretch "+(isDark?"bg-white/[0.02]":"border-b border-gray-200/80 bg-white/70")},TABS.map(tab=>{const isActive=activeTab===tab.id;return/*#__PURE__*/react.createElement("button",{key:tab.id,type:"button",onClick:()=>{setActiveTab(tab.id);onTabChange===null||onTabChange===void 0?void 0:onTabChange(tab.id);},className:"relative flex flex-col items-center justify-center gap-0.5 h-11 text-[11px] font-medium transition-all select-none flex-1 "+(isActive?"text-accent bg-accent/[0.11]":"text-secondary hover:text-primary hover:bg-tertiary/25")},/*#__PURE__*/react.createElement("span",{className:"transition-transform "+(isActive?"scale-110":"")},tab.icon),/*#__PURE__*/react.createElement("span",{className:isActive?"font-semibold":""},tab.label),isActive&&/*#__PURE__*/react.createElement("span",{className:"absolute bottom-0 left-0 right-0 h-[3px] rounded-t bg-accent"}));}),/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>setIsOpen(false),title:"\u6536\u8D77\u9762\u677F",className:"flex-shrink-0 flex items-center justify-center w-8 transition-colors "+(isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},/*#__PURE__*/react.createElement(chevron_right/* default */.A,{className:"w-3.5 h-3.5"}))),/*#__PURE__*/react.createElement("div",{className:"flex-1 min-h-0 overflow-hidden pt-1"},/*#__PURE__*/react.createElement("div",{className:activeTab==="overview"?"h-full":"hidden"},/*#__PURE__*/react.createElement("div",{ref:overviewSlotRef,className:"h-full w-full"})),/*#__PURE__*/react.createElement("div",{className:activeTab==="history"?"h-full":"hidden"},historyContent!==null&&historyContent!==void 0?historyContent:/*#__PURE__*/react.createElement(Empty,{icon:/*#__PURE__*/react.createElement(clock/* default */.A,null),text:"\u6682\u65E0\u5386\u53F2\u4F1A\u8BDD"})),/*#__PURE__*/react.createElement("div",{className:activeTab==="files"?"h-full":"hidden"},filesContent!==null&&filesContent!==void 0?filesContent:/*#__PURE__*/react.createElement(Empty,{icon:/*#__PURE__*/react.createElement(file_text/* default */.A,null),text:"\u6682\u65E0\u6587\u4EF6"})))):/*#__PURE__*//* Collapsed strip */react.createElement("div",{className:"flex flex-col items-center pt-1"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>setIsOpen(true),title:"\u5C55\u5F00\u9762\u677F",className:"flex items-center justify-center w-full h-8 transition-colors "+(isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},/*#__PURE__*/react.createElement(chevron_left/* default */.A,{className:"w-3.5 h-3.5"})),/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center gap-1 mt-2"},TABS.map(tab=>/*#__PURE__*/react.createElement("button",{key:tab.id,type:"button",onClick:()=>{setIsOpen(true);setActiveTab(tab.id);onTabChange===null||onTabChange===void 0?void 0:onTabChange(tab.id);},title:tab.label,className:"flex items-center justify-center w-7 h-7 rounded-lg transition-colors "+(activeTab===tab.id?"text-accent bg-accent/10":isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},tab.icon)))));};const Empty=_ref2=>{let{icon,text}=_ref2;return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement("div",{className:"w-10 h-10 mx-auto mb-3 opacity-20 [&>svg]:w-full [&>svg]:h-full"},icon),/*#__PURE__*/react.createElement("p",{className:"text-sm opacity-40"},text)));};/* harmony default export */ var layout_RightPanel = (RightPanel);
;// ./src/layout/AppLayout.tsx
const AppLayout=_ref=>{let{// TopNav
isSidebarOpen,onToggleSidebar,// LeftMenu
activeSubMenuItem,activeMenuLabel,onSubMenuChange,// RightPanel
rightPanelWidth=380,rightPanelHistory,rightPanelFiles,onRightPanelTabChange,// Canvas
children,canvasActiveView,onCanvasViewChange,canvasFilePreviewContent,onNewSession,showNewSessionButton=false}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const rightPanelIsOpen=(0,rightPanel/* useRightPanelStore */.x)(s=>s.isOpen);const containerRef=(0,react.useRef)(null);const sizes=(0,react.useMemo)(()=>({left:{collapsed:40,min:180,max:420,defaultOpen:224,storageKey:"drsai:layout:leftWidth"},right:{collapsed:40,min:280,max:720,defaultOpen:rightPanelWidth,storageKey:"drsai:layout:rightWidth"}}),[rightPanelWidth]);const{0:leftWidth,1:setLeftWidth}=(0,react.useState)(sizes.left.defaultOpen);const{0:rightWidth,1:setRightWidth}=(0,react.useState)(sizes.right.defaultOpen);(0,react.useEffect)(()=>{try{const leftRaw=localStorage.getItem(sizes.left.storageKey);const rightRaw=localStorage.getItem(sizes.right.storageKey);if(leftRaw){const v=Number(leftRaw);if(Number.isFinite(v))setLeftWidth(Math.min(sizes.left.max,Math.max(sizes.left.min,v)));}if(rightRaw){const v=Number(rightRaw);if(Number.isFinite(v))setRightWidth(Math.min(sizes.right.max,Math.max(sizes.right.min,v)));}}catch(_unused){// ignore
}},[sizes.left.max,sizes.left.min,sizes.left.storageKey,sizes.right.max,sizes.right.min,sizes.right.storageKey]);(0,react.useEffect)(()=>{try{localStorage.setItem(sizes.left.storageKey,String(leftWidth));}catch(_unused2){// ignore
}},[leftWidth,sizes.left.storageKey]);(0,react.useEffect)(()=>{try{localStorage.setItem(sizes.right.storageKey,String(rightWidth));}catch(_unused3){// ignore
}},[rightWidth,sizes.right.storageKey]);const beginDrag=(e,side)=>{var _setPointerCapture,_ref2;const el=containerRef.current;if(!el)return;e.preventDefault();(_setPointerCapture=(_ref2=e.currentTarget).setPointerCapture)===null||_setPointerCapture===void 0?void 0:_setPointerCapture.call(_ref2,e.pointerId);const rect=el.getBoundingClientRect();const bodyCursor=document.body.style.cursor;const bodyUserSelect=document.body.style.userSelect;document.body.style.cursor="col-resize";document.body.style.userSelect="none";const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));const onMove=ev=>{if(side==="left"){const next=clamp(ev.clientX-rect.left,sizes.left.min,sizes.left.max);setLeftWidth(next);}else{const next=clamp(rect.right-ev.clientX,sizes.right.min,sizes.right.max);setRightWidth(next);}};const onUp=()=>{window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);window.removeEventListener("pointercancel",onUp);document.body.style.cursor=bodyCursor;document.body.style.userSelect=bodyUserSelect;};window.addEventListener("pointermove",onMove);window.addEventListener("pointerup",onUp);window.addEventListener("pointercancel",onUp);};(0,react.useEffect)(()=>{document.getElementsByTagName("html")[0].className=darkMode==="dark"?"dark bg-primary":"light bg-primary";},[darkMode]);return/*#__PURE__*/react.createElement(config_provider/* default */.Ay,{theme:{token:{borderRadius:12,colorBgBase:darkMode==="dark"?"#0d1117":"#ffffff"},algorithm:darkMode==="dark"?theme.darkAlgorithm:theme.defaultAlgorithm}},/*#__PURE__*/react.createElement("div",{className:"h-screen flex flex-col bg-primary overflow-hidden relative"},/*#__PURE__*/react.createElement("div",{className:"pointer-events-none absolute inset-0 overflow-hidden"},/*#__PURE__*/react.createElement("div",{className:"absolute -top-24 -left-20 h-72 w-72 rounded-full blur-3xl "+(darkMode==="dark"?"bg-violet-500/10":"bg-violet-400/20")}),/*#__PURE__*/react.createElement("div",{className:"absolute -bottom-28 right-6 h-80 w-80 rounded-full blur-3xl "+(darkMode==="dark"?"bg-blue-500/10":"bg-cyan-300/25")})),/*#__PURE__*/react.createElement(layout_TopNav,{isSidebarOpen:isSidebarOpen,onToggleSidebar:onToggleSidebar}),/*#__PURE__*/react.createElement("div",{ref:containerRef,className:"flex-1 flex overflow-hidden p-2 gap-2 relative z-10"},/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 h-full transition-all duration-300 overflow-hidden shadow-modern "+(isSidebarOpen?"rounded-2xl":"rounded-lg")+" "+(darkMode==="dark"?"bg-[#0d1117]/72 backdrop-blur-md shadow-modern-lg":"bg-white/90 border border-gray-200/70 backdrop-blur-md"),style:{width:isSidebarOpen?leftWidth:sizes.left.collapsed}},/*#__PURE__*/react.createElement(layout_LeftMenu,{isSidebarOpen:isSidebarOpen,activeSubMenuItem:activeSubMenuItem,onSubMenuChange:onSubMenuChange,onClose:onToggleSidebar})),isSidebarOpen&&/*#__PURE__*/react.createElement("div",{role:"separator","aria-orientation":"vertical","aria-label":"\u8C03\u6574\u5DE6\u4FA7\u680F\u5BBD\u5EA6",onPointerDown:e=>beginDrag(e,"left"),className:"w-1 rounded-full transition-colors "+(darkMode==="dark"?"bg-white/5 hover:bg-white/12":"bg-gray-200/60 hover:bg-gray-300/80"),style:{cursor:"col-resize",touchAction:"none"}}),/*#__PURE__*/react.createElement("div",{className:"flex-1 min-w-0 rounded-2xl shadow-modern overflow-hidden "+(darkMode==="dark"?"bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg":"bg-white/85 border border-gray-200/70 backdrop-blur-md")},/*#__PURE__*/react.createElement(layout_Canvas,{activeView:canvasActiveView,activeMenuLabel:activeMenuLabel,onViewChange:onCanvasViewChange,filePreviewContent:canvasFilePreviewContent,onNewSession:onNewSession,showNewSessionButton:showNewSessionButton},children)),rightPanelIsOpen&&/*#__PURE__*/react.createElement("div",{role:"separator","aria-orientation":"vertical","aria-label":"\u8C03\u6574\u53F3\u4FA7\u680F\u5BBD\u5EA6",onPointerDown:e=>beginDrag(e,"right"),className:"w-1 rounded-full transition-colors "+(darkMode==="dark"?"bg-white/5 hover:bg-white/12":"bg-gray-200/60 hover:bg-gray-300/80"),style:{cursor:"col-resize",touchAction:"none"}}),/*#__PURE__*/react.createElement(layout_RightPanel,{width:rightWidth,historyContent:rightPanelHistory,filesContent:rightPanelFiles,onTabChange:onRightPanelTabChange}))));};/* harmony default export */ var layout_AppLayout = (AppLayout);
;// ./src/layout/index.ts

;// ./src/components/views/manager.tsx
const _excluded=["default_agent_id"];const SessionManager=()=>{const{0:isEditorOpen,1:setIsEditorOpen}=(0,react.useState)(false);const{0:editingSession,1:setEditingSession}=(0,react.useState)();const{0:isSidebarOpen,1:setIsSidebarOpen}=(0,react.useState)(true);const{0:historySearchQuery,1:setHistorySearchQuery}=(0,react.useState)("");/** 从「库」带入聊天输入框的已上传文件（短时清空引用，避免重复注入） */const{0:libraryAttachPrefill,1:setLibraryAttachPrefill}=(0,react.useState)(null);const[messageApi,contextHolder]=message/* default */.Ay.useMessage();const{0:baseUrl,1:setBaseUrl}=(0,react.useState)();const{0:sessionFileEvents,1:setSessionFileEvents}=(0,react.useState)({});const{0:selectedPreviewFile,1:setSelectedPreviewFile}=(0,react.useState)(null);const location=(0,useRouter/* useLocation */.z)();const navigate=(0,useRouter/* useNavigate */.Z)();const activeSubMenuItem=(0,react.useMemo)(()=>getMenuIdFromSearch(location.search),[location.search]);const activeCanvasView=(0,react.useMemo)(()=>getCanvasViewFromSearch(location.search),[location.search]);const activeMenuLabel=(0,react.useMemo)(()=>MENU_LABELS[activeSubMenuItem],[activeSubMenuItem]);const navigateToMenu=(0,react.useCallback)(menuId=>{const withMenu=createSearchWithMenu(location.search,menuId);navigate(createSearchWithView(withMenu,"chat"));},[location.search,navigate]);const navigateToView=(0,react.useCallback)(viewId=>{navigate(createSearchWithView(location.search,viewId));},[location.search,navigate]);const{user,darkMode}=(0,react.useContext)(provider/* appContext */.v);const formatFileSize=(0,react.useCallback)(size=>{if(typeof size!=="number"||!Number.isFinite(size)||size<=0)return"-";if(size<1024)return size+" B";if(size<1024*1024)return(size/1024).toFixed(1)+" KB";return(size/(1024*1024)).toFixed(1)+" MB";},[]);const buildDownloadHref=(0,react.useCallback)(file=>{if(file.download_method==="url"&&file.url)return file.url;if(file.download_method==="base64"&&file.base64_content){const mime=file.mime_type||"application/octet-stream";return"data:"+mime+";base64,"+file.base64_content;}return null;},[]);const handleFileEventsChange=(0,react.useCallback)((sessionId,fileEvents)=>{setSessionFileEvents(prev=>{const current=prev[sessionId]||[];if(current===fileEvents)return prev;return Object.assign({},prev,{[sessionId]:fileEvents});});},[]);const{session,setSession,setSessions}=useConfigStore();const{selectedAgent,setSelectedAgent,setConfig}=(0,modeConfig/* useModeConfigStore */.Q)();const{saveSessionId}=useSessionStorage();const{config:settingsConfig,updateConfig:updateSettingsConfig}=(0,store/* useSettingsStore */.C)();// Session management
const{sessions,isLoading:isSessionLoading,sessionRunStatuses,pendingFirstMessage,fetchSessions,selectSession,createNewChatSession,updateSession,updateSessionName,deleteSession,clearCurrentSession,updateSessionRunStatus,setPendingFirstMessage}=useSessionManager({userEmail:user===null||user===void 0?void 0:user.email,onSuccess:msg=>messageApi.success(msg),onError:msg=>messageApi.error(msg)});// WebSocket management
const{getSessionSocket,closeSocket,stopSession}=useWebSocketManager();// Agent management
const{agents,fetchAgentList,deleteAgent}=(0,useAgentManager/* useAgentManager */.A)(user===null||user===void 0?void 0:user.email);const{agentInfo}=(0,useAgentInfo/* useAgentInfo */.B)(user===null||user===void 0?void 0:user.email);// Load settings on page refresh
(0,react.useEffect)(()=>{const loadSettings=async()=>{if(user!==null&&user!==void 0&&user.email){try{// 请求全局setting配置
const settings=await api/* settingsAPI */.YP.getSettings(user.email);// 不再使用服务端/历史里的 default_agent_id 驱动前端选中的智能体
const _ref=settings,settingsForStore=(0,objectWithoutPropertiesLoose/* default */.A)(_ref,_excluded);// 存储到store
updateSettingsConfig(settingsForStore);// 更新前端页面渲染（通过store的更新自动触发）
// 同时提取baseUrl用于其他用途
if(settings.model_configs){try{var _parsed$model_config,_parsed$model_config$;const parsed=(0,browser.parse)(settings.model_configs);const baseUrl=(_parsed$model_config=parsed.model_config)===null||_parsed$model_config===void 0?void 0:(_parsed$model_config$=_parsed$model_config.config)===null||_parsed$model_config$===void 0?void 0:_parsed$model_config$.base_url;if(baseUrl){setBaseUrl(baseUrl);}}catch(parseError){console.warn("Failed to parse model_configs for baseUrl:",parseError);}}}catch(error){console.error("Failed to load settings:",error);}}};loadSettings();},[user===null||user===void 0?void 0:user.email,updateSettingsConfig]);// 等 modeConfig 从 localStorage rehydrate 后再拉列表，否则 agentId 未恢复会误选默认智能体
(0,react.useEffect)(()=>{if(!(user!==null&&user!==void 0&&user.email))return;const run=()=>fetchAgentList();if(modeConfig/* useModeConfigStore */.Q.persist.hasHydrated()){run();return;}return modeConfig/* useModeConfigStore */.Q.persist.onFinishHydration(()=>{run();});},[user===null||user===void 0?void 0:user.email,fetchAgentList]);(0,react.useEffect)(()=>{const handleAgentListChanged=()=>{fetchAgentList();};window.addEventListener("agentListChanged",handleAgentListChanged);return()=>{window.removeEventListener("agentListChanged",handleAgentListChanged);};},[fetchAgentList]);(0,react.useEffect)(()=>{fetchSessions();},[fetchSessions]);// 库 → 聊天 时把文件放在 state 里传给 NewChatView；不要用短时定时器清空，否则智能体信息未加载完时
// NewChatView 尚未挂载，prefill 已被清空，输入框收不到附件。
(0,react.useEffect)(()=>{if(activeSubMenuItem===MENU_IDS.currentSession)return;if(!libraryAttachPrefill)return;setLibraryAttachPrefill(null);},[activeSubMenuItem,libraryAttachPrefill]);const{setAgentId,setMode}=(0,modeConfig/* useModeConfigStore */.Q)();// Handle agent click
const handleAgentClick=(0,react.useCallback)(async agent=>{if(!(user!==null&&user!==void 0&&user.email))return;// 更新 agentId（在函数开始时就设置，确保及时触发 useAgentInfo）
if(agent.id){setAgentId(agent.id);}else{setAgentId(null);}setMode(agent.mode||"");// 对于 type === "add" 的自定义智能体，使用 id 或 name 来判断是否为不同智能体
// 对于非自定义智能体，使用 mode 来判断
const isDifferentAgent=agent.type==="add"?(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.id)!==agent.id&&(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.name)!==agent.name:(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.mode)!==agent.mode;if(isDifferentAgent){clearCurrentSession();}navigateToMenu(MENU_IDS.currentSession);},[user===null||user===void 0?void 0:user.email,selectedAgent,clearCurrentSession,setAgentId,setMode]);// Handle edit session
const handleEditSession=(0,react.useCallback)(async sessionData=>{navigateToMenu(MENU_IDS.currentSession);if(sessionData){setEditingSession(sessionData);setIsEditorOpen(true);}else{// 不创建新会话，只是清空当前会话
// 保持当前选中的 agent 不变
// 会话将在用户发送第一条消息时创建
clearCurrentSession();}},[clearCurrentSession]);// Handle save session
const handleSaveSession=(0,react.useCallback)(async sessionData=>{await updateSession(sessionData);setIsEditorOpen(false);setEditingSession(undefined);},[updateSession]);// Handle delete session
const handleDeleteSession=(0,react.useCallback)(async sessionId=>{const isDeletingCurrentSession=(session===null||session===void 0?void 0:session.id)===sessionId;await deleteSession(sessionId,closeSocket);// 如果删除的是当前会话，确保显示 NewChatView
if(isDeletingCurrentSession){navigateToMenu(MENU_IDS.currentSession);}},[deleteSession,closeSocket,session===null||session===void 0?void 0:session.id]);// Handle delete agent
const handleDeleteAgent=(0,react.useCallback)(async id=>{await deleteAgent(id,()=>messageApi.success("Agent deleted successfully"),()=>messageApi.error("Failed to delete agent"));},[deleteAgent,messageApi]);// Handle stop session
const handleStopSession=(0,react.useCallback)(sessionId=>{if(sessionId===undefined||sessionId===null)return;stopSession(sessionId);updateSessionRunStatus(sessionId,"stopped");},[stopSession,updateSessionRunStatus]);// Handle create session from plan
const handleCreateSessionFromPlan=(0,react.useCallback)((sessionId,planData)=>{selectSession({id:sessionId});setTimeout(()=>{window.dispatchEvent(new CustomEvent("planReady",{detail:{planData:planData,sessionId:sessionId,messageId:"plan_"+Date.now()}}));},2000);},[selectSession]);// Handle selecting a session from sidebar / plan list:
// always switch back to "current_session" view so the chat is visible.
const handleSelectSession=(0,react.useCallback)(async selectedSession=>{navigateToMenu(MENU_IDS.currentSession);selectSession(selectedSession);},[selectSession]);// Listen for switchToCurrentSession event
(0,react.useEffect)(()=>{const handleSwitchToCurrentSession=async event=>{const{agent,newSession,config,clearSession}=event.detail||{};navigateToMenu(MENU_IDS.currentSession);if(agent){setSelectedAgent(agent);}if(config){setConfig(config);}if(clearSession){clearCurrentSession();return;}if(newSession){try{const currentSessions=Array.isArray(sessions)?sessions:[];setSessions([newSession].concat((0,toConsumableArray/* default */.A)(currentSessions)));setSession(newSession);window.history.pushState({},"","?sessionId="+newSession.id);saveSessionId(newSession.id);}catch(error){console.error("Error setting new session:",error);}}};window.addEventListener("switchToCurrentSession",handleSwitchToCurrentSession);return()=>{window.removeEventListener("switchToCurrentSession",handleSwitchToCurrentSession);};},[setSelectedAgent,sessions,setSessions,setSession,saveSessionId,setConfig,clearCurrentSession]);// Listen for sessionDeleted event and ensure NewChatView is shown
(0,react.useEffect)(()=>{const handleSessionDeleted=()=>{navigateToMenu(MENU_IDS.currentSession);};window.addEventListener("sessionDeleted",handleSessionDeleted);return()=>{window.removeEventListener("sessionDeleted",handleSessionDeleted);};},[]);// Ensure NewChatView is shown when session becomes null
(0,react.useEffect)(()=>{// Only enforce the chat menu when the user is already on chat.
// Otherwise (e.g. agent_management), keep the current menu on refresh.
if(activeSubMenuItem===MENU_IDS.currentSession&&!session&&selectedAgent&&selectedAgent.name){navigateToMenu(MENU_IDS.currentSession);}},[activeSubMenuItem,session,selectedAgent,navigateToMenu]);// Chat views
const chatViews=(0,react.useMemo)(()=>{if(!Array.isArray(sessions)||!session){return[];}return sessions.map(s=>{if(!s.id)return null;// Always render ChatView for all sessions to preserve streamed messages when switching.
// Non-current sessions are hidden via CSS (className="hidden").
return/*#__PURE__*/react.createElement("div",{key:s.id,className:((session===null||session===void 0?void 0:session.id)===s.id?"block":"hidden")+" relative h-full min-h-0"},/*#__PURE__*/react.createElement(chat["default"],{session:s,onSessionNameChange:updateSessionName,getSessionSocket:getSessionSocket,visible:(session===null||session===void 0?void 0:session.id)===s.id,onRunStatusChange:updateSessionRunStatus,pendingFirstMessage:(session===null||session===void 0?void 0:session.id)===s.id?pendingFirstMessage:null,onPendingMessageSent:()=>setPendingFirstMessage(null),libraryServerFilesPrefill:(session===null||session===void 0?void 0:session.id)===s.id?libraryAttachPrefill:null,onFileEventsChange:handleFileEventsChange}));});},[sessions,session,updateSessionName,getSessionSocket,updateSessionRunStatus,pendingFirstMessage,libraryAttachPrefill,handleFileEventsChange]);const rightPanelFiles=(0,react.useMemo)(()=>{const currentSessionId=session===null||session===void 0?void 0:session.id;if(!currentSessionId)return null;const events=sessionFileEvents[currentSessionId]||[];const files=events.flatMap(event=>{var _event$content;return((_event$content=event.content)===null||_event$content===void 0?void 0:_event$content.files)||[];});if(files.length===0)return null;return/*#__PURE__*/react.createElement("div",{className:"h-full overflow-y-auto p-3 space-y-2"},files.map((file,index)=>{const href=buildDownloadHref(file);return/*#__PURE__*/react.createElement("div",{key:file.name+"-"+index,className:"rounded-lg border border-border-primary/30 bg-tertiary/10 p-3"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{setSelectedPreviewFile(file);navigateToView("file_preview");},className:"text-sm font-medium text-primary break-all text-left hover:text-accent transition-colors",title:"\u70B9\u51FB\u9884\u89C8\u5E76\u7F16\u8F91"},file.name||"file-"+(index+1)),/*#__PURE__*/react.createElement("div",{className:"mt-1 text-xs text-secondary"},file.description||"无描述"," \xB7 ",formatFileSize(file.size)),/*#__PURE__*/react.createElement("div",{className:"mt-2 flex items-center gap-2"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{setSelectedPreviewFile(file);navigateToView("file_preview");},className:"inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium bg-tertiary/20 text-primary hover:bg-tertiary/30 transition-colors"},"\u9884\u89C8/\u7F16\u8F91"),href?/*#__PURE__*/react.createElement("a",{href:href,download:file.name||"file-"+(index+1),target:file.download_method==="url"?"_blank":undefined,rel:file.download_method==="url"?"noreferrer":undefined,className:"inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"},"\u4E0B\u8F7D\u6587\u4EF6"):/*#__PURE__*/react.createElement("span",{className:"text-xs text-secondary"},"\u6682\u65E0\u53EF\u7528\u4E0B\u8F7D\u94FE\u63A5")));}));},[session===null||session===void 0?void 0:session.id,sessionFileEvents,buildDownloadHref,formatFileSize]);const rightPanelHistory=(0,react.useMemo)(()=>{const sortedSessions=Array.isArray(sessions)?(0,toConsumableArray/* default */.A)(sessions).sort((a,b)=>new Date(b.updated_at||b.created_at||0).getTime()-new Date(a.updated_at||a.created_at||0).getTime()):[];if(sortedSessions.length===0){return null;}const q=historySearchQuery.trim().toLowerCase();const filteredSessions=q?sortedSessions.filter(s=>{const name=(s.name||"").toLowerCase();const idStr=s.id!=null?String(s.id):"";return name.includes(q)||idStr.includes(q);}):sortedSessions;const inputRing=darkMode==="dark"?"border-border-primary/40 bg-white/[0.04] text-primary placeholder:text-secondary/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/30":"border-gray-200/90 bg-white text-gray-900 placeholder:text-gray-400 focus:border-violet-400 focus:ring-1 focus:ring-violet-200";return/*#__PURE__*/react.createElement("div",{className:"h-full flex flex-col min-h-0"},/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 px-3 pt-3 pb-2"},/*#__PURE__*/react.createElement("label",{className:"sr-only",htmlFor:"history-session-search"},"\u641C\u7D22\u4F1A\u8BDD"),/*#__PURE__*/react.createElement("div",{className:"relative"},/*#__PURE__*/react.createElement(search/* default */.A,{className:"absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none","aria-hidden":true}),/*#__PURE__*/react.createElement("input",{id:"history-session-search",type:"search",value:historySearchQuery,onChange:e=>setHistorySearchQuery(e.target.value),placeholder:"\u641C\u7D22\u4F1A\u8BDD\u540D\u79F0\u6216 ID\u2026",autoComplete:"off",className:"w-full rounded-lg pl-9 pr-3 py-2 text-sm border outline-none transition-shadow "+inputRing}))),/*#__PURE__*/react.createElement("div",{className:"flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1"},filteredSessions.length===0?/*#__PURE__*/react.createElement("div",{className:"text-center text-sm text-secondary py-8 px-2"},"\u65E0\u5339\u914D\u4F1A\u8BDD\uFF0C\u8BF7\u8C03\u6574\u5173\u952E\u8BCD"):filteredSessions.map(historySession=>{const isCurrent=(session===null||session===void 0?void 0:session.id)===historySession.id;const lastTime=historySession.updated_at||historySession.created_at;const sid=historySession.id;return/*#__PURE__*/react.createElement("div",{key:sid!==null&&sid!==void 0?sid:historySession.name,className:"group relative flex items-center gap-0.5 rounded-lg transition-colors "+(isCurrent?"bg-accent/10":"hover:bg-tertiary/15")},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>void handleSelectSession(historySession),className:"flex-1 min-w-0 text-left rounded-lg px-3 py-2 pr-1 transition-colors "+(isCurrent?"text-accent":"text-primary")},/*#__PURE__*/react.createElement("div",{className:"text-sm font-medium truncate"},historySession.name||"Session "+(sid!==null&&sid!==void 0?sid:"")),/*#__PURE__*/react.createElement("div",{className:"text-xs text-secondary mt-1"},lastTime?new Date(lastTime).toLocaleString():"-")),sid!=null&&/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 pr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150"},/*#__PURE__*/react.createElement(dropdown/* default */.A,{trigger:["click"],placement:"bottomRight",menu:{items:[{key:"delete",danger:true,disabled:isSessionLoading,label:/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(trash_2/* default */.A,{className:"w-4 h-4 inline-block mr-1.5 -mt-0.5 align-middle"}),"\u5220\u9664"),onClick:e=>{e.domEvent.stopPropagation();void handleDeleteSession(sid);}}]}},/*#__PURE__*/react.createElement("button",{type:"button",title:"\u66F4\u591A","aria-haspopup":"menu","aria-label":"\u4F1A\u8BDD\u64CD\u4F5C",disabled:isSessionLoading,onClick:e=>e.stopPropagation(),onPointerDown:e=>e.stopPropagation(),className:"flex items-center justify-center w-7 h-7 rounded-lg outline-none border-0 bg-transparent shadow-none ring-0 transition-colors "+(isSessionLoading?"opacity-40 cursor-not-allowed":"text-secondary hover:text-primary hover:bg-tertiary/30")},/*#__PURE__*/react.createElement(EllipsisVertical,{className:"w-3.5 h-3.5",strokeWidth:2})))));})));},[sessions,session===null||session===void 0?void 0:session.id,handleSelectSession,historySearchQuery,darkMode,isSessionLoading,handleDeleteSession]);return/*#__PURE__*/react.createElement(react.Fragment,null,contextHolder,/*#__PURE__*/react.createElement(layout_AppLayout// TopNav
,{isSidebarOpen:isSidebarOpen,onToggleSidebar:()=>setIsSidebarOpen(!isSidebarOpen)// LeftMenu
,activeSubMenuItem:activeSubMenuItem,activeMenuLabel:activeMenuLabel,onSubMenuChange:tabId=>navigateToMenu(tabId),canvasActiveView:activeCanvasView,onCanvasViewChange:navigateToView,canvasFilePreviewContent:/*#__PURE__*/react.createElement(FilePreviewPage["default"],{file:selectedPreviewFile}),rightPanelHistory:rightPanelHistory,rightPanelFiles:rightPanelFiles,onRightPanelTabChange:tab=>{if(tab==="files"){navigateToView("file_preview");return;}navigateToView("chat");},onNewSession:()=>{navigateToMenu(MENU_IDS.currentSession);navigateToView("chat");clearCurrentSession();},showNewSessionButton:Boolean(session)},activeSubMenuItem===MENU_IDS.currentSession?(()=>{if(session){return/*#__PURE__*/react.createElement("div",{className:"h-full min-h-0"},chatViews);}else if(agentInfo||selectedAgent){const chatAgent=agentInfo||selectedAgent;return/*#__PURE__*/react.createElement(NewChatView["default"],{agent:chatAgent,serverFilesPrefill:libraryAttachPrefill,onSubmit:async(agent,query,files,plan)=>{await createNewChatSession(agent,query,files,plan);}});}else{return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement(spin/* default */.A,{size:"large"}),/*#__PURE__*/react.createElement("p",{className:"mt-4 text-sm"},"Loading...")));}})():activeSubMenuItem===MENU_IDS.agentSquare||activeSubMenuItem===MENU_IDS.myAgents?/*#__PURE__*/react.createElement("div",{className:"h-full overflow-hidden"},/*#__PURE__*/react.createElement(AgentSquare,{agents:[],handleAgentList:fetchAgentList})):activeSubMenuItem===MENU_IDS.skillsSquare?/*#__PURE__*/react.createElement(SkillsSquarePage["default"],null):activeSubMenuItem===MENU_IDS.channels?/*#__PURE__*/react.createElement(ChannelsPage["default"],null):activeSubMenuItem===MENU_IDS.logs?/*#__PURE__*/react.createElement(LogsPage["default"],null):activeSubMenuItem===MENU_IDS.cooperationManagement?/*#__PURE__*/react.createElement(CooperationManagementPage["default"],null):activeSubMenuItem===MENU_IDS.agentManagement?/*#__PURE__*/react.createElement(AgentManagementPage["default"],null):activeSubMenuItem===MENU_IDS.userManagement?/*#__PURE__*/react.createElement(UserManagementPage["default"],null):activeSubMenuItem===MENU_IDS.profile?/*#__PURE__*/react.createElement(Config["default"],{user:user||{name:"",email:""},onClose:()=>navigateToMenu(MENU_IDS.currentSession)}):activeSubMenuItem===MENU_IDS.savedPlan?/*#__PURE__*/react.createElement("div",{className:"h-full overflow-hidden"},/*#__PURE__*/react.createElement(Plans_PlanList,{onTabChange:tabId=>navigateToMenu(tabId),onSelectSession:handleSelectSession,onCreateSessionFromPlan:handleCreateSessionFromPlan})):activeSubMenuItem===MENU_IDS.library?/*#__PURE__*/react.createElement("div",{className:"h-full min-h-0 overflow-hidden"},/*#__PURE__*/react.createElement(LibraryPage["default"],{onStartChat:async(files,query)=>{const chatAgent=agentInfo||selectedAgent;if(!chatAgent)return;// 把文件放进 prefill 以便 ChatView 回显（不重新上传）
(0,react_dom.flushSync)(()=>setLibraryAttachPrefill(files));// 直接创建会话并发送首条消息，跳过 NewChatView
await createNewChatSession(chatAgent,query,files);// Use live URL after clearCurrentSession so sessionId is not re-applied from stale React location
const withMenu=createSearchWithMenu(window.location.search,MENU_IDS.currentSession);navigate(createSearchWithView(withMenu,"chat"));}})):/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement("p",{className:"text-sm opacity-50"},"\u656C\u8BF7\u671F\u5F85"))),/*#__PURE__*/react.createElement(SessionEditor,{session:editingSession,isOpen:isEditorOpen,onSave:handleSaveSession,onCancel:()=>{setIsEditorOpen(false);setEditingSession(undefined);}})));};
;// ./src/pages/index.tsx


const IndexPage = () => {
  return /*#__PURE__*/react.createElement(SessionManager, null);
};
const query = "2538745103";
/* harmony default export */ var pages = (IndexPage);

/***/ }),

/***/ 70612:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);

const ChannelsPage = () => {
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex items-center justify-center h-full text-secondary"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-center"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h2", {
    className: "text-base font-medium text-primary"
  }, "\u9891\u9053"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
    className: "mt-2 text-sm opacity-60"
  }, "\u9875\u9762\u5EFA\u8BBE\u4E2D...")));
};
/* harmony default export */ __webpack_exports__["default"] = (ChannelsPage);

/***/ }),

/***/ 33037:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);

const LogsPage = () => {
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex items-center justify-center h-full text-secondary"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-center"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h2", {
    className: "text-base font-medium text-primary"
  }, "\u65E5\u5FD7"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
    className: "mt-2 text-sm opacity-60"
  }, "\u9875\u9762\u5EFA\u8BBE\u4E2D...")));
};
/* harmony default export */ __webpack_exports__["default"] = (LogsPage);

/***/ }),

/***/ 6469:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var wellKnownSymbol = __webpack_require__(78227);
var create = __webpack_require__(2360);
var defineProperty = (__webpack_require__(24913).f);

var UNSCOPABLES = wellKnownSymbol('unscopables');
var ArrayPrototype = Array.prototype;

// Array.prototype[@@unscopables]
// https://tc39.es/ecma262/#sec-array.prototype-@@unscopables
if (ArrayPrototype[UNSCOPABLES] === undefined) {
  defineProperty(ArrayPrototype, UNSCOPABLES, {
    configurable: true,
    value: create(null)
  });
}

// add a key to Array.prototype[@@unscopables]
module.exports = function (key) {
  ArrayPrototype[UNSCOPABLES][key] = true;
};


/***/ }),

/***/ 87433:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var isArray = __webpack_require__(34376);
var isConstructor = __webpack_require__(33517);
var isObject = __webpack_require__(20034);
var wellKnownSymbol = __webpack_require__(78227);

var SPECIES = wellKnownSymbol('species');
var $Array = Array;

// a part of `ArraySpeciesCreate` abstract operation
// https://tc39.es/ecma262/#sec-arrayspeciescreate
module.exports = function (originalArray) {
  var C;
  if (isArray(originalArray)) {
    C = originalArray.constructor;
    // cross-realm fallback
    if (isConstructor(C) && (C === $Array || isArray(C.prototype))) C = undefined;
    else if (isObject(C)) {
      C = C[SPECIES];
      if (C === null) C = undefined;
    }
  } return C === undefined ? $Array : C;
};


/***/ }),

/***/ 1469:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var arraySpeciesConstructor = __webpack_require__(87433);

// `ArraySpeciesCreate` abstract operation
// https://tc39.es/ecma262/#sec-arrayspeciescreate
module.exports = function (originalArray, length) {
  return new (arraySpeciesConstructor(originalArray))(length === 0 ? 0 : length);
};


/***/ }),

/***/ 96837:
/***/ (function(module) {

"use strict";

var $TypeError = TypeError;
var MAX_SAFE_INTEGER = 0x1FFFFFFFFFFFFF; // 2 ** 53 - 1 == 9007199254740991

module.exports = function (it) {
  if (it > MAX_SAFE_INTEGER) throw $TypeError('Maximum allowed index exceeded');
  return it;
};


/***/ }),

/***/ 70259:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var isArray = __webpack_require__(34376);
var lengthOfArrayLike = __webpack_require__(26198);
var doesNotExceedSafeInteger = __webpack_require__(96837);
var bind = __webpack_require__(76080);

// `FlattenIntoArray` abstract operation
// https://tc39.github.io/proposal-flatMap/#sec-FlattenIntoArray
var flattenIntoArray = function (target, original, source, sourceLen, start, depth, mapper, thisArg) {
  var targetIndex = start;
  var sourceIndex = 0;
  var mapFn = mapper ? bind(mapper, thisArg) : false;
  var element, elementLen;

  while (sourceIndex < sourceLen) {
    if (sourceIndex in source) {
      element = mapFn ? mapFn(source[sourceIndex], sourceIndex, original) : source[sourceIndex];

      if (depth > 0 && isArray(element)) {
        elementLen = lengthOfArrayLike(element);
        targetIndex = flattenIntoArray(target, original, element, elementLen, targetIndex, depth - 1) - 1;
      } else {
        doesNotExceedSafeInteger(targetIndex + 1);
        target[targetIndex] = element;
      }

      targetIndex++;
    }
    sourceIndex++;
  }
  return targetIndex;
};

module.exports = flattenIntoArray;


/***/ }),

/***/ 20397:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var getBuiltIn = __webpack_require__(97751);

module.exports = getBuiltIn('document', 'documentElement');


/***/ }),

/***/ 34376:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var classof = __webpack_require__(22195);

// `IsArray` abstract operation
// https://tc39.es/ecma262/#sec-isarray
// eslint-disable-next-line es/no-array-isarray -- safe
module.exports = Array.isArray || function isArray(argument) {
  return classof(argument) === 'Array';
};


/***/ }),

/***/ 2360:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

/* global ActiveXObject -- old IE, WSH */
var anObject = __webpack_require__(28551);
var definePropertiesModule = __webpack_require__(96801);
var enumBugKeys = __webpack_require__(88727);
var hiddenKeys = __webpack_require__(30421);
var html = __webpack_require__(20397);
var documentCreateElement = __webpack_require__(4055);
var sharedKey = __webpack_require__(66119);

var GT = '>';
var LT = '<';
var PROTOTYPE = 'prototype';
var SCRIPT = 'script';
var IE_PROTO = sharedKey('IE_PROTO');

var EmptyConstructor = function () { /* empty */ };

var scriptTag = function (content) {
  return LT + SCRIPT + GT + content + LT + '/' + SCRIPT + GT;
};

// Create object with fake `null` prototype: use ActiveX Object with cleared prototype
var NullProtoObjectViaActiveX = function (activeXDocument) {
  activeXDocument.write(scriptTag(''));
  activeXDocument.close();
  var temp = activeXDocument.parentWindow.Object;
  // eslint-disable-next-line no-useless-assignment -- avoid memory leak
  activeXDocument = null;
  return temp;
};

// Create object with fake `null` prototype: use iframe Object with cleared prototype
var NullProtoObjectViaIFrame = function () {
  // Thrash, waste and sodomy: IE GC bug
  var iframe = documentCreateElement('iframe');
  var JS = 'java' + SCRIPT + ':';
  var iframeDocument;
  iframe.style.display = 'none';
  html.appendChild(iframe);
  // https://github.com/zloirock/core-js/issues/475
  iframe.src = String(JS);
  iframeDocument = iframe.contentWindow.document;
  iframeDocument.open();
  iframeDocument.write(scriptTag('document.F=Object'));
  iframeDocument.close();
  return iframeDocument.F;
};

// Check for document.domain and active x support
// No need to use active x approach when document.domain is not set
// see https://github.com/es-shims/es5-shim/issues/150
// variation of https://github.com/kitcambridge/es5-shim/commit/4f738ac066346
// avoid IE GC bug
var activeXDocument;
var NullProtoObject = function () {
  try {
    activeXDocument = new ActiveXObject('htmlfile');
  } catch (error) { /* ignore */ }
  NullProtoObject = typeof document != 'undefined'
    ? document.domain && activeXDocument
      ? NullProtoObjectViaActiveX(activeXDocument) // old IE
      : NullProtoObjectViaIFrame()
    : NullProtoObjectViaActiveX(activeXDocument); // WSH
  var length = enumBugKeys.length;
  while (length--) delete NullProtoObject[PROTOTYPE][enumBugKeys[length]];
  return NullProtoObject();
};

hiddenKeys[IE_PROTO] = true;

// `Object.create` method
// https://tc39.es/ecma262/#sec-object.create
// eslint-disable-next-line es/no-object-create -- safe
module.exports = Object.create || function create(O, Properties) {
  var result;
  if (O !== null) {
    EmptyConstructor[PROTOTYPE] = anObject(O);
    result = new EmptyConstructor();
    EmptyConstructor[PROTOTYPE] = null;
    // add "__proto__" for Object.getPrototypeOf polyfill
    result[IE_PROTO] = O;
  } else result = NullProtoObject();
  return Properties === undefined ? result : definePropertiesModule.f(result, Properties);
};


/***/ }),

/***/ 96801:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var DESCRIPTORS = __webpack_require__(43724);
var V8_PROTOTYPE_DEFINE_BUG = __webpack_require__(48686);
var definePropertyModule = __webpack_require__(24913);
var anObject = __webpack_require__(28551);
var toIndexedObject = __webpack_require__(25397);
var objectKeys = __webpack_require__(71072);

// `Object.defineProperties` method
// https://tc39.es/ecma262/#sec-object.defineproperties
// eslint-disable-next-line es/no-object-defineproperties -- safe
exports.f = DESCRIPTORS && !V8_PROTOTYPE_DEFINE_BUG ? Object.defineProperties : function defineProperties(O, Properties) {
  anObject(O);
  var props = toIndexedObject(Properties);
  var keys = objectKeys(Properties);
  var length = keys.length;
  var index = 0;
  var key;
  while (length > index) definePropertyModule.f(O, key = keys[index++], props[key]);
  return O;
};


/***/ }),

/***/ 71072:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var internalObjectKeys = __webpack_require__(61828);
var enumBugKeys = __webpack_require__(88727);

// `Object.keys` method
// https://tc39.es/ecma262/#sec-object.keys
// eslint-disable-next-line es/no-object-keys -- safe
module.exports = Object.keys || function keys(O) {
  return internalObjectKeys(O, enumBugKeys);
};


/***/ }),

/***/ 78350:
/***/ (function(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var $ = __webpack_require__(46518);
var flattenIntoArray = __webpack_require__(70259);
var aCallable = __webpack_require__(79306);
var toObject = __webpack_require__(48981);
var lengthOfArrayLike = __webpack_require__(26198);
var arraySpeciesCreate = __webpack_require__(1469);

// `Array.prototype.flatMap` method
// https://tc39.es/ecma262/#sec-array.prototype.flatmap
$({ target: 'Array', proto: true }, {
  flatMap: function flatMap(callbackfn /* , thisArg */) {
    var O = toObject(this);
    var sourceLen = lengthOfArrayLike(O);
    var A;
    aCallable(callbackfn);
    A = arraySpeciesCreate(O, 0);
    A.length = flattenIntoArray(A, O, O, sourceLen, 0, 1, callbackfn, arguments.length > 1 ? arguments[1] : undefined);
    return A;
  }
});


/***/ }),

/***/ 30237:
/***/ (function(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {

"use strict";

// this method was added to unscopables after implementation
// in popular engines, so it's moved to a separate module
var addToUnscopables = __webpack_require__(6469);

// https://tc39.es/ecma262/#sec-array.prototype-@@unscopables
addToUnscopables('flatMap');


/***/ }),

/***/ 46670:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

module.exports = __webpack_require__(97376).YAML


/***/ }),

/***/ 97376:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  YAML: function() { return /* binding */ YAML; }
});

;// ./node_modules/yaml/browser/dist/PlainValue-b8036b75.js
function _typeof(obj) {
  "@babel/helpers - typeof";

  if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
    _typeof = function (obj) {
      return typeof obj;
    };
  } else {
    _typeof = function (obj) {
      return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
    };
  }

  return _typeof(obj);
}

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor) descriptor.writable = true;
    Object.defineProperty(target, descriptor.key, descriptor);
  }
}

function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps) _defineProperties(Constructor.prototype, protoProps);
  if (staticProps) _defineProperties(Constructor, staticProps);
  return Constructor;
}

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function _inherits(subClass, superClass) {
  if (typeof superClass !== "function" && superClass !== null) {
    throw new TypeError("Super expression must either be null or a function");
  }

  subClass.prototype = Object.create(superClass && superClass.prototype, {
    constructor: {
      value: subClass,
      writable: true,
      configurable: true
    }
  });
  if (superClass) _setPrototypeOf(subClass, superClass);
}

function _getPrototypeOf(o) {
  _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf : function _getPrototypeOf(o) {
    return o.__proto__ || Object.getPrototypeOf(o);
  };
  return _getPrototypeOf(o);
}

function _setPrototypeOf(o, p) {
  _setPrototypeOf = Object.setPrototypeOf || function _setPrototypeOf(o, p) {
    o.__proto__ = p;
    return o;
  };

  return _setPrototypeOf(o, p);
}

function _isNativeReflectConstruct() {
  if (typeof Reflect === "undefined" || !Reflect.construct) return false;
  if (Reflect.construct.sham) return false;
  if (typeof Proxy === "function") return true;

  try {
    Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));
    return true;
  } catch (e) {
    return false;
  }
}

function _construct(Parent, args, Class) {
  if (_isNativeReflectConstruct()) {
    _construct = Reflect.construct;
  } else {
    _construct = function _construct(Parent, args, Class) {
      var a = [null];
      a.push.apply(a, args);
      var Constructor = Function.bind.apply(Parent, a);
      var instance = new Constructor();
      if (Class) _setPrototypeOf(instance, Class.prototype);
      return instance;
    };
  }

  return _construct.apply(null, arguments);
}

function _isNativeFunction(fn) {
  return Function.toString.call(fn).indexOf("[native code]") !== -1;
}

function _wrapNativeSuper(Class) {
  var _cache = typeof Map === "function" ? new Map() : undefined;

  _wrapNativeSuper = function _wrapNativeSuper(Class) {
    if (Class === null || !_isNativeFunction(Class)) return Class;

    if (typeof Class !== "function") {
      throw new TypeError("Super expression must either be null or a function");
    }

    if (typeof _cache !== "undefined") {
      if (_cache.has(Class)) return _cache.get(Class);

      _cache.set(Class, Wrapper);
    }

    function Wrapper() {
      return _construct(Class, arguments, _getPrototypeOf(this).constructor);
    }

    Wrapper.prototype = Object.create(Class.prototype, {
      constructor: {
        value: Wrapper,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
    return _setPrototypeOf(Wrapper, Class);
  };

  return _wrapNativeSuper(Class);
}

function _assertThisInitialized(self) {
  if (self === void 0) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }

  return self;
}

function _possibleConstructorReturn(self, call) {
  if (call && (typeof call === "object" || typeof call === "function")) {
    return call;
  }

  return _assertThisInitialized(self);
}

function _createSuper(Derived) {
  var hasNativeReflectConstruct = _isNativeReflectConstruct();

  return function _createSuperInternal() {
    var Super = _getPrototypeOf(Derived),
        result;

    if (hasNativeReflectConstruct) {
      var NewTarget = _getPrototypeOf(this).constructor;

      result = Reflect.construct(Super, arguments, NewTarget);
    } else {
      result = Super.apply(this, arguments);
    }

    return _possibleConstructorReturn(this, result);
  };
}

function _superPropBase(object, property) {
  while (!Object.prototype.hasOwnProperty.call(object, property)) {
    object = _getPrototypeOf(object);
    if (object === null) break;
  }

  return object;
}

function _get(target, property, receiver) {
  if (typeof Reflect !== "undefined" && Reflect.get) {
    _get = Reflect.get;
  } else {
    _get = function _get(target, property, receiver) {
      var base = _superPropBase(target, property);

      if (!base) return;
      var desc = Object.getOwnPropertyDescriptor(base, property);

      if (desc.get) {
        return desc.get.call(receiver);
      }

      return desc.value;
    };
  }

  return _get(target, property, receiver || target);
}

function _slicedToArray(arr, i) {
  return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
}

function _toArray(arr) {
  return _arrayWithHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableRest();
}

function _arrayWithHoles(arr) {
  if (Array.isArray(arr)) return arr;
}

function _iterableToArray(iter) {
  if (typeof Symbol !== "undefined" && Symbol.iterator in Object(iter)) return Array.from(iter);
}

function _iterableToArrayLimit(arr, i) {
  if (typeof Symbol === "undefined" || !(Symbol.iterator in Object(arr))) return;
  var _arr = [];
  var _n = true;
  var _d = false;
  var _e = undefined;

  try {
    for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
      _arr.push(_s.value);

      if (i && _arr.length === i) break;
    }
  } catch (err) {
    _d = true;
    _e = err;
  } finally {
    try {
      if (!_n && _i["return"] != null) _i["return"]();
    } finally {
      if (_d) throw _e;
    }
  }

  return _arr;
}

function _unsupportedIterableToArray(o, minLen) {
  if (!o) return;
  if (typeof o === "string") return _arrayLikeToArray(o, minLen);
  var n = Object.prototype.toString.call(o).slice(8, -1);
  if (n === "Object" && o.constructor) n = o.constructor.name;
  if (n === "Map" || n === "Set") return Array.from(o);
  if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
}

function _arrayLikeToArray(arr, len) {
  if (len == null || len > arr.length) len = arr.length;

  for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];

  return arr2;
}

function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}

function _createForOfIteratorHelper(o, allowArrayLike) {
  var it;

  if (typeof Symbol === "undefined" || o[Symbol.iterator] == null) {
    if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") {
      if (it) o = it;
      var i = 0;

      var F = function () {};

      return {
        s: F,
        n: function () {
          if (i >= o.length) return {
            done: true
          };
          return {
            done: false,
            value: o[i++]
          };
        },
        e: function (e) {
          throw e;
        },
        f: F
      };
    }

    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }

  var normalCompletion = true,
      didErr = false,
      err;
  return {
    s: function () {
      it = o[Symbol.iterator]();
    },
    n: function () {
      var step = it.next();
      normalCompletion = step.done;
      return step;
    },
    e: function (e) {
      didErr = true;
      err = e;
    },
    f: function () {
      try {
        if (!normalCompletion && it.return != null) it.return();
      } finally {
        if (didErr) throw err;
      }
    }
  };
}

var Char = {
  ANCHOR: '&',
  COMMENT: '#',
  TAG: '!',
  DIRECTIVES_END: '-',
  DOCUMENT_END: '.'
};
var Type = {
  ALIAS: 'ALIAS',
  BLANK_LINE: 'BLANK_LINE',
  BLOCK_FOLDED: 'BLOCK_FOLDED',
  BLOCK_LITERAL: 'BLOCK_LITERAL',
  COMMENT: 'COMMENT',
  DIRECTIVE: 'DIRECTIVE',
  DOCUMENT: 'DOCUMENT',
  FLOW_MAP: 'FLOW_MAP',
  FLOW_SEQ: 'FLOW_SEQ',
  MAP: 'MAP',
  MAP_KEY: 'MAP_KEY',
  MAP_VALUE: 'MAP_VALUE',
  PLAIN: 'PLAIN',
  QUOTE_DOUBLE: 'QUOTE_DOUBLE',
  QUOTE_SINGLE: 'QUOTE_SINGLE',
  SEQ: 'SEQ',
  SEQ_ITEM: 'SEQ_ITEM'
};
var defaultTagPrefix = 'tag:yaml.org,2002:';
var defaultTags = {
  MAP: 'tag:yaml.org,2002:map',
  SEQ: 'tag:yaml.org,2002:seq',
  STR: 'tag:yaml.org,2002:str'
};

function findLineStarts(src) {
  var ls = [0];
  var offset = src.indexOf('\n');

  while (offset !== -1) {
    offset += 1;
    ls.push(offset);
    offset = src.indexOf('\n', offset);
  }

  return ls;
}

function getSrcInfo(cst) {
  var lineStarts, src;

  if (typeof cst === 'string') {
    lineStarts = findLineStarts(cst);
    src = cst;
  } else {
    if (Array.isArray(cst)) cst = cst[0];

    if (cst && cst.context) {
      if (!cst.lineStarts) cst.lineStarts = findLineStarts(cst.context.src);
      lineStarts = cst.lineStarts;
      src = cst.context.src;
    }
  }

  return {
    lineStarts: lineStarts,
    src: src
  };
}
/**
 * @typedef {Object} LinePos - One-indexed position in the source
 * @property {number} line
 * @property {number} col
 */

/**
 * Determine the line/col position matching a character offset.
 *
 * Accepts a source string or a CST document as the second parameter. With
 * the latter, starting indices for lines are cached in the document as
 * `lineStarts: number[]`.
 *
 * Returns a one-indexed `{ line, col }` location if found, or
 * `undefined` otherwise.
 *
 * @param {number} offset
 * @param {string|Document|Document[]} cst
 * @returns {?LinePos}
 */


function getLinePos(offset, cst) {
  if (typeof offset !== 'number' || offset < 0) return null;

  var _getSrcInfo = getSrcInfo(cst),
      lineStarts = _getSrcInfo.lineStarts,
      src = _getSrcInfo.src;

  if (!lineStarts || !src || offset > src.length) return null;

  for (var i = 0; i < lineStarts.length; ++i) {
    var start = lineStarts[i];

    if (offset < start) {
      return {
        line: i,
        col: offset - lineStarts[i - 1] + 1
      };
    }

    if (offset === start) return {
      line: i + 1,
      col: 1
    };
  }

  var line = lineStarts.length;
  return {
    line: line,
    col: offset - lineStarts[line - 1] + 1
  };
}
/**
 * Get a specified line from the source.
 *
 * Accepts a source string or a CST document as the second parameter. With
 * the latter, starting indices for lines are cached in the document as
 * `lineStarts: number[]`.
 *
 * Returns the line as a string if found, or `null` otherwise.
 *
 * @param {number} line One-indexed line number
 * @param {string|Document|Document[]} cst
 * @returns {?string}
 */

function getLine(line, cst) {
  var _getSrcInfo2 = getSrcInfo(cst),
      lineStarts = _getSrcInfo2.lineStarts,
      src = _getSrcInfo2.src;

  if (!lineStarts || !(line >= 1) || line > lineStarts.length) return null;
  var start = lineStarts[line - 1];
  var end = lineStarts[line]; // undefined for last line; that's ok for slice()

  while (end && end > start && src[end - 1] === '\n') {
    --end;
  }

  return src.slice(start, end);
}
/**
 * Pretty-print the starting line from the source indicated by the range `pos`
 *
 * Trims output to `maxWidth` chars while keeping the starting column visible,
 * using `…` at either end to indicate dropped characters.
 *
 * Returns a two-line string (or `null`) with `\n` as separator; the second line
 * will hold appropriately indented `^` marks indicating the column range.
 *
 * @param {Object} pos
 * @param {LinePos} pos.start
 * @param {LinePos} [pos.end]
 * @param {string|Document|Document[]*} cst
 * @param {number} [maxWidth=80]
 * @returns {?string}
 */

function getPrettyContext(_ref, cst) {
  var start = _ref.start,
      end = _ref.end;
  var maxWidth = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 80;
  var src = getLine(start.line, cst);
  if (!src) return null;
  var col = start.col;

  if (src.length > maxWidth) {
    if (col <= maxWidth - 10) {
      src = src.substr(0, maxWidth - 1) + '…';
    } else {
      var halfWidth = Math.round(maxWidth / 2);
      if (src.length > col + halfWidth) src = src.substr(0, col + halfWidth - 1) + '…';
      col -= src.length - maxWidth;
      src = '…' + src.substr(1 - maxWidth);
    }
  }

  var errLen = 1;
  var errEnd = '';

  if (end) {
    if (end.line === start.line && col + (end.col - start.col) <= maxWidth + 1) {
      errLen = end.col - start.col;
    } else {
      errLen = Math.min(src.length + 1, maxWidth) - col;
      errEnd = '…';
    }
  }

  var offset = col > 1 ? ' '.repeat(col - 1) : '';
  var err = '^'.repeat(errLen);
  return "".concat(src, "\n").concat(offset).concat(err).concat(errEnd);
}

var Range = /*#__PURE__*/function () {
  function Range(start, end) {
    _classCallCheck(this, Range);

    this.start = start;
    this.end = end || start;
  }

  _createClass(Range, [{
    key: "isEmpty",
    value: function isEmpty() {
      return typeof this.start !== 'number' || !this.end || this.end <= this.start;
    }
    /**
     * Set `origStart` and `origEnd` to point to the original source range for
     * this node, which may differ due to dropped CR characters.
     *
     * @param {number[]} cr - Positions of dropped CR characters
     * @param {number} offset - Starting index of `cr` from the last call
     * @returns {number} - The next offset, matching the one found for `origStart`
     */

  }, {
    key: "setOrigRange",
    value: function setOrigRange(cr, offset) {
      var start = this.start,
          end = this.end;

      if (cr.length === 0 || end <= cr[0]) {
        this.origStart = start;
        this.origEnd = end;
        return offset;
      }

      var i = offset;

      while (i < cr.length) {
        if (cr[i] > start) break;else ++i;
      }

      this.origStart = start + i;
      var nextOffset = i;

      while (i < cr.length) {
        // if end was at \n, it should now be at \r
        if (cr[i] >= end) break;else ++i;
      }

      this.origEnd = end + i;
      return nextOffset;
    }
  }], [{
    key: "copy",
    value: function copy(orig) {
      return new Range(orig.start, orig.end);
    }
  }]);

  return Range;
}();

/** Root class of all nodes */

var Node = /*#__PURE__*/function () {
  function Node(type, props, context) {
    _classCallCheck(this, Node);

    Object.defineProperty(this, 'context', {
      value: context || null,
      writable: true
    });
    this.error = null;
    this.range = null;
    this.valueRange = null;
    this.props = props || [];
    this.type = type;
    this.value = null;
  }

  _createClass(Node, [{
    key: "getPropValue",
    value: function getPropValue(idx, key, skipKey) {
      if (!this.context) return null;
      var src = this.context.src;
      var prop = this.props[idx];
      return prop && src[prop.start] === key ? src.slice(prop.start + (skipKey ? 1 : 0), prop.end) : null;
    }
  }, {
    key: "anchor",
    get: function get() {
      for (var i = 0; i < this.props.length; ++i) {
        var anchor = this.getPropValue(i, Char.ANCHOR, true);
        if (anchor != null) return anchor;
      }

      return null;
    }
  }, {
    key: "comment",
    get: function get() {
      var comments = [];

      for (var i = 0; i < this.props.length; ++i) {
        var comment = this.getPropValue(i, Char.COMMENT, true);
        if (comment != null) comments.push(comment);
      }

      return comments.length > 0 ? comments.join('\n') : null;
    }
  }, {
    key: "commentHasRequiredWhitespace",
    value: function commentHasRequiredWhitespace(start) {
      var src = this.context.src;
      if (this.header && start === this.header.end) return false;
      if (!this.valueRange) return false;
      var end = this.valueRange.end;
      return start !== end || Node.atBlank(src, end - 1);
    }
  }, {
    key: "hasComment",
    get: function get() {
      if (this.context) {
        var src = this.context.src;

        for (var i = 0; i < this.props.length; ++i) {
          if (src[this.props[i].start] === Char.COMMENT) return true;
        }
      }

      return false;
    }
  }, {
    key: "hasProps",
    get: function get() {
      if (this.context) {
        var src = this.context.src;

        for (var i = 0; i < this.props.length; ++i) {
          if (src[this.props[i].start] !== Char.COMMENT) return true;
        }
      }

      return false;
    }
  }, {
    key: "includesTrailingLines",
    get: function get() {
      return false;
    }
  }, {
    key: "jsonLike",
    get: function get() {
      var jsonLikeTypes = [Type.FLOW_MAP, Type.FLOW_SEQ, Type.QUOTE_DOUBLE, Type.QUOTE_SINGLE];
      return jsonLikeTypes.indexOf(this.type) !== -1;
    }
  }, {
    key: "rangeAsLinePos",
    get: function get() {
      if (!this.range || !this.context) return undefined;
      var start = getLinePos(this.range.start, this.context.root);
      if (!start) return undefined;
      var end = getLinePos(this.range.end, this.context.root);
      return {
        start: start,
        end: end
      };
    }
  }, {
    key: "rawValue",
    get: function get() {
      if (!this.valueRange || !this.context) return null;
      var _this$valueRange = this.valueRange,
          start = _this$valueRange.start,
          end = _this$valueRange.end;
      return this.context.src.slice(start, end);
    }
  }, {
    key: "tag",
    get: function get() {
      for (var i = 0; i < this.props.length; ++i) {
        var tag = this.getPropValue(i, Char.TAG, false);

        if (tag != null) {
          if (tag[1] === '<') {
            return {
              verbatim: tag.slice(2, -1)
            };
          } else {
            // eslint-disable-next-line no-unused-vars
            var _tag$match = tag.match(/^(.*!)([^!]*)$/),
                _tag$match2 = _slicedToArray(_tag$match, 3);
                _tag$match2[0];
                var handle = _tag$match2[1],
                suffix = _tag$match2[2];

            return {
              handle: handle,
              suffix: suffix
            };
          }
        }
      }

      return null;
    }
  }, {
    key: "valueRangeContainsNewline",
    get: function get() {
      if (!this.valueRange || !this.context) return false;
      var _this$valueRange2 = this.valueRange,
          start = _this$valueRange2.start,
          end = _this$valueRange2.end;
      var src = this.context.src;

      for (var i = start; i < end; ++i) {
        if (src[i] === '\n') return true;
      }

      return false;
    }
  }, {
    key: "parseComment",
    value: function parseComment(start) {
      var src = this.context.src;

      if (src[start] === Char.COMMENT) {
        var end = Node.endOfLine(src, start + 1);
        var commentRange = new Range(start, end);
        this.props.push(commentRange);
        return end;
      }

      return start;
    }
    /**
     * Populates the `origStart` and `origEnd` values of all ranges for this
     * node. Extended by child classes to handle descendant nodes.
     *
     * @param {number[]} cr - Positions of dropped CR characters
     * @param {number} offset - Starting index of `cr` from the last call
     * @returns {number} - The next offset, matching the one found for `origStart`
     */

  }, {
    key: "setOrigRanges",
    value: function setOrigRanges(cr, offset) {
      if (this.range) offset = this.range.setOrigRange(cr, offset);
      if (this.valueRange) this.valueRange.setOrigRange(cr, offset);
      this.props.forEach(function (prop) {
        return prop.setOrigRange(cr, offset);
      });
      return offset;
    }
  }, {
    key: "toString",
    value: function toString() {
      var src = this.context.src,
          range = this.range,
          value = this.value;
      if (value != null) return value;
      var str = src.slice(range.start, range.end);
      return Node.addStringTerminator(src, range.end, str);
    }
  }], [{
    key: "addStringTerminator",
    value: function addStringTerminator(src, offset, str) {
      if (str[str.length - 1] === '\n') return str;
      var next = Node.endOfWhiteSpace(src, offset);
      return next >= src.length || src[next] === '\n' ? str + '\n' : str;
    } // ^(---|...)

  }, {
    key: "atDocumentBoundary",
    value: function atDocumentBoundary(src, offset, sep) {
      var ch0 = src[offset];
      if (!ch0) return true;
      var prev = src[offset - 1];
      if (prev && prev !== '\n') return false;

      if (sep) {
        if (ch0 !== sep) return false;
      } else {
        if (ch0 !== Char.DIRECTIVES_END && ch0 !== Char.DOCUMENT_END) return false;
      }

      var ch1 = src[offset + 1];
      var ch2 = src[offset + 2];
      if (ch1 !== ch0 || ch2 !== ch0) return false;
      var ch3 = src[offset + 3];
      return !ch3 || ch3 === '\n' || ch3 === '\t' || ch3 === ' ';
    }
  }, {
    key: "endOfIdentifier",
    value: function endOfIdentifier(src, offset) {
      var ch = src[offset];
      var isVerbatim = ch === '<';
      var notOk = isVerbatim ? ['\n', '\t', ' ', '>'] : ['\n', '\t', ' ', '[', ']', '{', '}', ','];

      while (ch && notOk.indexOf(ch) === -1) {
        ch = src[offset += 1];
      }

      if (isVerbatim && ch === '>') offset += 1;
      return offset;
    }
  }, {
    key: "endOfIndent",
    value: function endOfIndent(src, offset) {
      var ch = src[offset];

      while (ch === ' ') {
        ch = src[offset += 1];
      }

      return offset;
    }
  }, {
    key: "endOfLine",
    value: function endOfLine(src, offset) {
      var ch = src[offset];

      while (ch && ch !== '\n') {
        ch = src[offset += 1];
      }

      return offset;
    }
  }, {
    key: "endOfWhiteSpace",
    value: function endOfWhiteSpace(src, offset) {
      var ch = src[offset];

      while (ch === '\t' || ch === ' ') {
        ch = src[offset += 1];
      }

      return offset;
    }
  }, {
    key: "startOfLine",
    value: function startOfLine(src, offset) {
      var ch = src[offset - 1];
      if (ch === '\n') return offset;

      while (ch && ch !== '\n') {
        ch = src[offset -= 1];
      }

      return offset + 1;
    }
    /**
     * End of indentation, or null if the line's indent level is not more
     * than `indent`
     *
     * @param {string} src
     * @param {number} indent
     * @param {number} lineStart
     * @returns {?number}
     */

  }, {
    key: "endOfBlockIndent",
    value: function endOfBlockIndent(src, indent, lineStart) {
      var inEnd = Node.endOfIndent(src, lineStart);

      if (inEnd > lineStart + indent) {
        return inEnd;
      } else {
        var wsEnd = Node.endOfWhiteSpace(src, inEnd);
        var ch = src[wsEnd];
        if (!ch || ch === '\n') return wsEnd;
      }

      return null;
    }
  }, {
    key: "atBlank",
    value: function atBlank(src, offset, endAsBlank) {
      var ch = src[offset];
      return ch === '\n' || ch === '\t' || ch === ' ' || endAsBlank && !ch;
    }
  }, {
    key: "nextNodeIsIndented",
    value: function nextNodeIsIndented(ch, indentDiff, indicatorAsIndent) {
      if (!ch || indentDiff < 0) return false;
      if (indentDiff > 0) return true;
      return indicatorAsIndent && ch === '-';
    } // should be at line or string end, or at next non-whitespace char

  }, {
    key: "normalizeOffset",
    value: function normalizeOffset(src, offset) {
      var ch = src[offset];
      return !ch ? offset : ch !== '\n' && src[offset - 1] === '\n' ? offset - 1 : Node.endOfWhiteSpace(src, offset);
    } // fold single newline into space, multiple newlines to N - 1 newlines
    // presumes src[offset] === '\n'

  }, {
    key: "foldNewline",
    value: function foldNewline(src, offset, indent) {
      var inCount = 0;
      var error = false;
      var fold = '';
      var ch = src[offset + 1];

      while (ch === ' ' || ch === '\t' || ch === '\n') {
        switch (ch) {
          case '\n':
            inCount = 0;
            offset += 1;
            fold += '\n';
            break;

          case '\t':
            if (inCount <= indent) error = true;
            offset = Node.endOfWhiteSpace(src, offset + 2) - 1;
            break;

          case ' ':
            inCount += 1;
            offset += 1;
            break;
        }

        ch = src[offset + 1];
      }

      if (!fold) fold = ' ';
      if (ch && inCount <= indent) error = true;
      return {
        fold: fold,
        offset: offset,
        error: error
      };
    }
  }]);

  return Node;
}();

var YAMLError = /*#__PURE__*/function (_Error) {
  _inherits(YAMLError, _Error);

  var _super = _createSuper(YAMLError);

  function YAMLError(name, source, message) {
    var _this;

    _classCallCheck(this, YAMLError);

    if (!message || !(source instanceof Node)) throw new Error("Invalid arguments for new ".concat(name));
    _this = _super.call(this);
    _this.name = name;
    _this.message = message;
    _this.source = source;
    return _this;
  }

  _createClass(YAMLError, [{
    key: "makePretty",
    value: function makePretty() {
      if (!this.source) return;
      this.nodeType = this.source.type;
      var cst = this.source.context && this.source.context.root;

      if (typeof this.offset === 'number') {
        this.range = new Range(this.offset, this.offset + 1);
        var start = cst && getLinePos(this.offset, cst);

        if (start) {
          var end = {
            line: start.line,
            col: start.col + 1
          };
          this.linePos = {
            start: start,
            end: end
          };
        }

        delete this.offset;
      } else {
        this.range = this.source.range;
        this.linePos = this.source.rangeAsLinePos;
      }

      if (this.linePos) {
        var _this$linePos$start = this.linePos.start,
            line = _this$linePos$start.line,
            col = _this$linePos$start.col;
        this.message += " at line ".concat(line, ", column ").concat(col);
        var ctx = cst && getPrettyContext(this.linePos, cst);
        if (ctx) this.message += ":\n\n".concat(ctx, "\n");
      }

      delete this.source;
    }
  }]);

  return YAMLError;
}( /*#__PURE__*/_wrapNativeSuper(Error));
var YAMLReferenceError = /*#__PURE__*/function (_YAMLError) {
  _inherits(YAMLReferenceError, _YAMLError);

  var _super2 = _createSuper(YAMLReferenceError);

  function YAMLReferenceError(source, message) {
    _classCallCheck(this, YAMLReferenceError);

    return _super2.call(this, 'YAMLReferenceError', source, message);
  }

  return YAMLReferenceError;
}(YAMLError);
var YAMLSemanticError = /*#__PURE__*/function (_YAMLError2) {
  _inherits(YAMLSemanticError, _YAMLError2);

  var _super3 = _createSuper(YAMLSemanticError);

  function YAMLSemanticError(source, message) {
    _classCallCheck(this, YAMLSemanticError);

    return _super3.call(this, 'YAMLSemanticError', source, message);
  }

  return YAMLSemanticError;
}(YAMLError);
var YAMLSyntaxError = /*#__PURE__*/function (_YAMLError3) {
  _inherits(YAMLSyntaxError, _YAMLError3);

  var _super4 = _createSuper(YAMLSyntaxError);

  function YAMLSyntaxError(source, message) {
    _classCallCheck(this, YAMLSyntaxError);

    return _super4.call(this, 'YAMLSyntaxError', source, message);
  }

  return YAMLSyntaxError;
}(YAMLError);
var YAMLWarning = /*#__PURE__*/function (_YAMLError4) {
  _inherits(YAMLWarning, _YAMLError4);

  var _super5 = _createSuper(YAMLWarning);

  function YAMLWarning(source, message) {
    _classCallCheck(this, YAMLWarning);

    return _super5.call(this, 'YAMLWarning', source, message);
  }

  return YAMLWarning;
}(YAMLError);

var PlainValue = /*#__PURE__*/function (_Node) {
  _inherits(PlainValue, _Node);

  var _super = _createSuper(PlainValue);

  function PlainValue() {
    _classCallCheck(this, PlainValue);

    return _super.apply(this, arguments);
  }

  _createClass(PlainValue, [{
    key: "strValue",
    get: function get() {
      if (!this.valueRange || !this.context) return null;
      var _this$valueRange = this.valueRange,
          start = _this$valueRange.start,
          end = _this$valueRange.end;
      var src = this.context.src;
      var ch = src[end - 1];

      while (start < end && (ch === '\n' || ch === '\t' || ch === ' ')) {
        ch = src[--end - 1];
      }

      var str = '';

      for (var i = start; i < end; ++i) {
        var _ch = src[i];

        if (_ch === '\n') {
          var _Node$foldNewline = Node.foldNewline(src, i, -1),
              fold = _Node$foldNewline.fold,
              offset = _Node$foldNewline.offset;

          str += fold;
          i = offset;
        } else if (_ch === ' ' || _ch === '\t') {
          // trim trailing whitespace
          var wsStart = i;
          var next = src[i + 1];

          while (i < end && (next === ' ' || next === '\t')) {
            i += 1;
            next = src[i + 1];
          }

          if (next !== '\n') str += i > wsStart ? src.slice(wsStart, i + 1) : _ch;
        } else {
          str += _ch;
        }
      }

      var ch0 = src[start];

      switch (ch0) {
        case '\t':
          {
            var msg = 'Plain value cannot start with a tab character';
            var errors = [new YAMLSemanticError(this, msg)];
            return {
              errors: errors,
              str: str
            };
          }

        case '@':
        case '`':
          {
            var _msg = "Plain value cannot start with reserved character ".concat(ch0);

            var _errors = [new YAMLSemanticError(this, _msg)];
            return {
              errors: _errors,
              str: str
            };
          }

        default:
          return str;
      }
    }
  }, {
    key: "parseBlockValue",
    value: function parseBlockValue(start) {
      var _this$context = this.context,
          indent = _this$context.indent,
          inFlow = _this$context.inFlow,
          src = _this$context.src;
      var offset = start;
      var valueEnd = start;

      for (var ch = src[offset]; ch === '\n'; ch = src[offset]) {
        if (Node.atDocumentBoundary(src, offset + 1)) break;
        var end = Node.endOfBlockIndent(src, indent, offset + 1);
        if (end === null || src[end] === '#') break;

        if (src[end] === '\n') {
          offset = end;
        } else {
          valueEnd = PlainValue.endOfLine(src, end, inFlow);
          offset = valueEnd;
        }
      }

      if (this.valueRange.isEmpty()) this.valueRange.start = start;
      this.valueRange.end = valueEnd;
      return valueEnd;
    }
    /**
     * Parses a plain value from the source
     *
     * Accepted forms are:
     * ```
     * #comment
     *
     * first line
     *
     * first line #comment
     *
     * first line
     * block
     * lines
     *
     * #comment
     * block
     * lines
     * ```
     * where block lines are empty or have an indent level greater than `indent`.
     *
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this scalar, may be `\n`
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var inFlow = context.inFlow,
          src = context.src;
      var offset = start;
      var ch = src[offset];

      if (ch && ch !== '#' && ch !== '\n') {
        offset = PlainValue.endOfLine(src, start, inFlow);
      }

      this.valueRange = new Range(start, offset);
      offset = Node.endOfWhiteSpace(src, offset);
      offset = this.parseComment(offset);

      if (!this.hasComment || this.valueRange.isEmpty()) {
        offset = this.parseBlockValue(offset);
      }

      return offset;
    }
  }], [{
    key: "endOfLine",
    value: function endOfLine(src, start, inFlow) {
      var ch = src[start];
      var offset = start;

      while (ch && ch !== '\n') {
        if (inFlow && (ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === ',')) break;
        var next = src[offset + 1];
        if (ch === ':' && (!next || next === '\n' || next === '\t' || next === ' ' || inFlow && next === ',')) break;
        if ((ch === ' ' || ch === '\t') && next === '#') break;
        offset += 1;
        ch = next;
      }

      return offset;
    }
  }]);

  return PlainValue;
}(Node);



;// ./node_modules/yaml/browser/dist/parse-cst.js


var BlankLine = /*#__PURE__*/function (_Node) {
  _inherits(BlankLine, _Node);

  var _super = _createSuper(BlankLine);

  function BlankLine() {
    _classCallCheck(this, BlankLine);

    return _super.call(this, Type.BLANK_LINE);
  }
  /* istanbul ignore next */


  _createClass(BlankLine, [{
    key: "includesTrailingLines",
    get: function get() {
      // This is never called from anywhere, but if it were,
      // this is the value it should return.
      return true;
    }
    /**
     * Parses a blank line from the source
     *
     * @param {ParseContext} context
     * @param {number} start - Index of first \n character
     * @returns {number} - Index of the character after this
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      this.range = new Range(start, start + 1);
      return start + 1;
    }
  }]);

  return BlankLine;
}(Node);

var CollectionItem = /*#__PURE__*/function (_Node) {
  _inherits(CollectionItem, _Node);

  var _super = _createSuper(CollectionItem);

  function CollectionItem(type, props) {
    var _this;

    _classCallCheck(this, CollectionItem);

    _this = _super.call(this, type, props);
    _this.node = null;
    return _this;
  }

  _createClass(CollectionItem, [{
    key: "includesTrailingLines",
    get: function get() {
      return !!this.node && this.node.includesTrailingLines;
    }
    /**
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var parseNode = context.parseNode,
          src = context.src;
      var atLineStart = context.atLineStart,
          lineStart = context.lineStart;
      if (!atLineStart && this.type === Type.SEQ_ITEM) this.error = new YAMLSemanticError(this, 'Sequence items must not have preceding content on the same line');
      var indent = atLineStart ? start - lineStart : context.indent;
      var offset = Node.endOfWhiteSpace(src, start + 1);
      var ch = src[offset];
      var inlineComment = ch === '#';
      var comments = [];
      var blankLine = null;

      while (ch === '\n' || ch === '#') {
        if (ch === '#') {
          var _end = Node.endOfLine(src, offset + 1);

          comments.push(new Range(offset, _end));
          offset = _end;
        } else {
          atLineStart = true;
          lineStart = offset + 1;
          var wsEnd = Node.endOfWhiteSpace(src, lineStart);

          if (src[wsEnd] === '\n' && comments.length === 0) {
            blankLine = new BlankLine();
            lineStart = blankLine.parse({
              src: src
            }, lineStart);
          }

          offset = Node.endOfIndent(src, lineStart);
        }

        ch = src[offset];
      }

      if (Node.nextNodeIsIndented(ch, offset - (lineStart + indent), this.type !== Type.SEQ_ITEM)) {
        this.node = parseNode({
          atLineStart: atLineStart,
          inCollection: false,
          indent: indent,
          lineStart: lineStart,
          parent: this
        }, offset);
      } else if (ch && lineStart > start + 1) {
        offset = lineStart - 1;
      }

      if (this.node) {
        if (blankLine) {
          // Only blank lines preceding non-empty nodes are captured. Note that
          // this means that collection item range start indices do not always
          // increase monotonically. -- eemeli/yaml#126
          var items = context.parent.items || context.parent.contents;
          if (items) items.push(blankLine);
        }

        if (comments.length) Array.prototype.push.apply(this.props, comments);
        offset = this.node.range.end;
      } else {
        if (inlineComment) {
          var c = comments[0];
          this.props.push(c);
          offset = c.end;
        } else {
          offset = Node.endOfLine(src, start + 1);
        }
      }

      var end = this.node ? this.node.valueRange.end : offset;
      this.valueRange = new Range(start, end);
      return offset;
    }
  }, {
    key: "setOrigRanges",
    value: function setOrigRanges(cr, offset) {
      offset = _get(_getPrototypeOf(CollectionItem.prototype), "setOrigRanges", this).call(this, cr, offset);
      return this.node ? this.node.setOrigRanges(cr, offset) : offset;
    }
  }, {
    key: "toString",
    value: function toString() {
      var src = this.context.src,
          node = this.node,
          range = this.range,
          value = this.value;
      if (value != null) return value;
      var str = node ? src.slice(range.start, node.range.start) + String(node) : src.slice(range.start, range.end);
      return Node.addStringTerminator(src, range.end, str);
    }
  }]);

  return CollectionItem;
}(Node);

var Comment = /*#__PURE__*/function (_Node) {
  _inherits(Comment, _Node);

  var _super = _createSuper(Comment);

  function Comment() {
    _classCallCheck(this, Comment);

    return _super.call(this, Type.COMMENT);
  }
  /**
   * Parses a comment line from the source
   *
   * @param {ParseContext} context
   * @param {number} start - Index of first character
   * @returns {number} - Index of the character after this scalar
   */


  _createClass(Comment, [{
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var offset = this.parseComment(start);
      this.range = new Range(start, offset);
      return offset;
    }
  }]);

  return Comment;
}(Node);

function grabCollectionEndComments(node) {
  var cnode = node;

  while (cnode instanceof CollectionItem) {
    cnode = cnode.node;
  }

  if (!(cnode instanceof Collection)) return null;
  var len = cnode.items.length;
  var ci = -1;

  for (var i = len - 1; i >= 0; --i) {
    var n = cnode.items[i];

    if (n.type === Type.COMMENT) {
      // Keep sufficiently indented comments with preceding node
      var _n$context = n.context,
          indent = _n$context.indent,
          lineStart = _n$context.lineStart;
      if (indent > 0 && n.range.start >= lineStart + indent) break;
      ci = i;
    } else if (n.type === Type.BLANK_LINE) ci = i;else break;
  }

  if (ci === -1) return null;
  var ca = cnode.items.splice(ci, len - ci);
  var prevEnd = ca[0].range.start;

  while (true) {
    cnode.range.end = prevEnd;
    if (cnode.valueRange && cnode.valueRange.end > prevEnd) cnode.valueRange.end = prevEnd;
    if (cnode === node) break;
    cnode = cnode.context.parent;
  }

  return ca;
}
var Collection = /*#__PURE__*/function (_Node) {
  _inherits(Collection, _Node);

  var _super = _createSuper(Collection);

  function Collection(firstItem) {
    var _this;

    _classCallCheck(this, Collection);

    _this = _super.call(this, firstItem.type === Type.SEQ_ITEM ? Type.SEQ : Type.MAP);

    for (var i = firstItem.props.length - 1; i >= 0; --i) {
      if (firstItem.props[i].start < firstItem.context.lineStart) {
        // props on previous line are assumed by the collection
        _this.props = firstItem.props.slice(0, i + 1);
        firstItem.props = firstItem.props.slice(i + 1);
        var itemRange = firstItem.props[0] || firstItem.valueRange;
        firstItem.range.start = itemRange.start;
        break;
      }
    }

    _this.items = [firstItem];
    var ec = grabCollectionEndComments(firstItem);
    if (ec) Array.prototype.push.apply(_this.items, ec);
    return _this;
  }

  _createClass(Collection, [{
    key: "includesTrailingLines",
    get: function get() {
      return this.items.length > 0;
    }
    /**
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var parseNode = context.parseNode,
          src = context.src; // It's easier to recalculate lineStart here rather than tracking down the
      // last context from which to read it -- eemeli/yaml#2

      var lineStart = Node.startOfLine(src, start);
      var firstItem = this.items[0]; // First-item context needs to be correct for later comment handling
      // -- eemeli/yaml#17

      firstItem.context.parent = this;
      this.valueRange = Range.copy(firstItem.valueRange);
      var indent = firstItem.range.start - firstItem.context.lineStart;
      var offset = start;
      offset = Node.normalizeOffset(src, offset);
      var ch = src[offset];
      var atLineStart = Node.endOfWhiteSpace(src, lineStart) === offset;
      var prevIncludesTrailingLines = false;

      while (ch) {
        while (ch === '\n' || ch === '#') {
          if (atLineStart && ch === '\n' && !prevIncludesTrailingLines) {
            var blankLine = new BlankLine();
            offset = blankLine.parse({
              src: src
            }, offset);
            this.valueRange.end = offset;

            if (offset >= src.length) {
              ch = null;
              break;
            }

            this.items.push(blankLine);
            offset -= 1; // blankLine.parse() consumes terminal newline
          } else if (ch === '#') {
            if (offset < lineStart + indent && !Collection.nextContentHasIndent(src, offset, indent)) {
              return offset;
            }

            var comment = new Comment();
            offset = comment.parse({
              indent: indent,
              lineStart: lineStart,
              src: src
            }, offset);
            this.items.push(comment);
            this.valueRange.end = offset;

            if (offset >= src.length) {
              ch = null;
              break;
            }
          }

          lineStart = offset + 1;
          offset = Node.endOfIndent(src, lineStart);

          if (Node.atBlank(src, offset)) {
            var wsEnd = Node.endOfWhiteSpace(src, offset);
            var next = src[wsEnd];

            if (!next || next === '\n' || next === '#') {
              offset = wsEnd;
            }
          }

          ch = src[offset];
          atLineStart = true;
        }

        if (!ch) {
          break;
        }

        if (offset !== lineStart + indent && (atLineStart || ch !== ':')) {
          if (offset < lineStart + indent) {
            if (lineStart > start) offset = lineStart;
            break;
          } else if (!this.error) {
            var msg = 'All collection items must start at the same column';
            this.error = new YAMLSyntaxError(this, msg);
          }
        }

        if (firstItem.type === Type.SEQ_ITEM) {
          if (ch !== '-') {
            if (lineStart > start) offset = lineStart;
            break;
          }
        } else if (ch === '-' && !this.error) {
          // map key may start with -, as long as it's followed by a non-whitespace char
          var _next = src[offset + 1];

          if (!_next || _next === '\n' || _next === '\t' || _next === ' ') {
            var _msg = 'A collection cannot be both a mapping and a sequence';
            this.error = new YAMLSyntaxError(this, _msg);
          }
        }

        var node = parseNode({
          atLineStart: atLineStart,
          inCollection: true,
          indent: indent,
          lineStart: lineStart,
          parent: this
        }, offset);
        if (!node) return offset; // at next document start

        this.items.push(node);
        this.valueRange.end = node.valueRange.end;
        offset = Node.normalizeOffset(src, node.range.end);
        ch = src[offset];
        atLineStart = false;
        prevIncludesTrailingLines = node.includesTrailingLines; // Need to reset lineStart and atLineStart here if preceding node's range
        // has advanced to check the current line's indentation level
        // -- eemeli/yaml#10 & eemeli/yaml#38

        if (ch) {
          var ls = offset - 1;
          var prev = src[ls];

          while (prev === ' ' || prev === '\t') {
            prev = src[--ls];
          }

          if (prev === '\n') {
            lineStart = ls + 1;
            atLineStart = true;
          }
        }

        var ec = grabCollectionEndComments(node);
        if (ec) Array.prototype.push.apply(this.items, ec);
      }

      return offset;
    }
  }, {
    key: "setOrigRanges",
    value: function setOrigRanges(cr, offset) {
      offset = _get(_getPrototypeOf(Collection.prototype), "setOrigRanges", this).call(this, cr, offset);
      this.items.forEach(function (node) {
        offset = node.setOrigRanges(cr, offset);
      });
      return offset;
    }
  }, {
    key: "toString",
    value: function toString() {
      var src = this.context.src,
          items = this.items,
          range = this.range,
          value = this.value;
      if (value != null) return value;
      var str = src.slice(range.start, items[0].range.start) + String(items[0]);

      for (var i = 1; i < items.length; ++i) {
        var item = items[i];
        var _item$context = item.context,
            atLineStart = _item$context.atLineStart,
            indent = _item$context.indent;
        if (atLineStart) for (var _i = 0; _i < indent; ++_i) {
          str += ' ';
        }
        str += String(item);
      }

      return Node.addStringTerminator(src, range.end, str);
    }
  }], [{
    key: "nextContentHasIndent",
    value: function nextContentHasIndent(src, offset, indent) {
      var lineStart = Node.endOfLine(src, offset) + 1;
      offset = Node.endOfWhiteSpace(src, lineStart);
      var ch = src[offset];
      if (!ch) return false;
      if (offset >= lineStart + indent) return true;
      if (ch !== '#' && ch !== '\n') return false;
      return Collection.nextContentHasIndent(src, offset, indent);
    }
  }]);

  return Collection;
}(Node);

var Directive = /*#__PURE__*/function (_Node) {
  _inherits(Directive, _Node);

  var _super = _createSuper(Directive);

  function Directive() {
    var _this;

    _classCallCheck(this, Directive);

    _this = _super.call(this, Type.DIRECTIVE);
    _this.name = null;
    return _this;
  }

  _createClass(Directive, [{
    key: "parameters",
    get: function get() {
      var raw = this.rawValue;
      return raw ? raw.trim().split(/[ \t]+/) : [];
    }
  }, {
    key: "parseName",
    value: function parseName(start) {
      var src = this.context.src;
      var offset = start;
      var ch = src[offset];

      while (ch && ch !== '\n' && ch !== '\t' && ch !== ' ') {
        ch = src[offset += 1];
      }

      this.name = src.slice(start, offset);
      return offset;
    }
  }, {
    key: "parseParameters",
    value: function parseParameters(start) {
      var src = this.context.src;
      var offset = start;
      var ch = src[offset];

      while (ch && ch !== '\n' && ch !== '#') {
        ch = src[offset += 1];
      }

      this.valueRange = new Range(start, offset);
      return offset;
    }
  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var offset = this.parseName(start + 1);
      offset = this.parseParameters(offset);
      offset = this.parseComment(offset);
      this.range = new Range(start, offset);
      return offset;
    }
  }]);

  return Directive;
}(Node);

var Document = /*#__PURE__*/function (_Node) {
  _inherits(Document, _Node);

  var _super = _createSuper(Document);

  function Document() {
    var _this;

    _classCallCheck(this, Document);

    _this = _super.call(this, Type.DOCUMENT);
    _this.directives = null;
    _this.contents = null;
    _this.directivesEndMarker = null;
    _this.documentEndMarker = null;
    return _this;
  }

  _createClass(Document, [{
    key: "parseDirectives",
    value: function parseDirectives(start) {
      var src = this.context.src;
      this.directives = [];
      var atLineStart = true;
      var hasDirectives = false;
      var offset = start;

      while (!Node.atDocumentBoundary(src, offset, Char.DIRECTIVES_END)) {
        offset = Document.startCommentOrEndBlankLine(src, offset);

        switch (src[offset]) {
          case '\n':
            if (atLineStart) {
              var blankLine = new BlankLine();
              offset = blankLine.parse({
                src: src
              }, offset);

              if (offset < src.length) {
                this.directives.push(blankLine);
              }
            } else {
              offset += 1;
              atLineStart = true;
            }

            break;

          case '#':
            {
              var comment = new Comment();
              offset = comment.parse({
                src: src
              }, offset);
              this.directives.push(comment);
              atLineStart = false;
            }
            break;

          case '%':
            {
              var directive = new Directive();
              offset = directive.parse({
                parent: this,
                src: src
              }, offset);
              this.directives.push(directive);
              hasDirectives = true;
              atLineStart = false;
            }
            break;

          default:
            if (hasDirectives) {
              this.error = new YAMLSemanticError(this, 'Missing directives-end indicator line');
            } else if (this.directives.length > 0) {
              this.contents = this.directives;
              this.directives = [];
            }

            return offset;
        }
      }

      if (src[offset]) {
        this.directivesEndMarker = new Range(offset, offset + 3);
        return offset + 3;
      }

      if (hasDirectives) {
        this.error = new YAMLSemanticError(this, 'Missing directives-end indicator line');
      } else if (this.directives.length > 0) {
        this.contents = this.directives;
        this.directives = [];
      }

      return offset;
    }
  }, {
    key: "parseContents",
    value: function parseContents(start) {
      var _this$context = this.context,
          parseNode = _this$context.parseNode,
          src = _this$context.src;
      if (!this.contents) this.contents = [];
      var lineStart = start;

      while (src[lineStart - 1] === '-') {
        lineStart -= 1;
      }

      var offset = Node.endOfWhiteSpace(src, start);
      var atLineStart = lineStart === start;
      this.valueRange = new Range(offset);

      while (!Node.atDocumentBoundary(src, offset, Char.DOCUMENT_END)) {
        switch (src[offset]) {
          case '\n':
            if (atLineStart) {
              var blankLine = new BlankLine();
              offset = blankLine.parse({
                src: src
              }, offset);

              if (offset < src.length) {
                this.contents.push(blankLine);
              }
            } else {
              offset += 1;
              atLineStart = true;
            }

            lineStart = offset;
            break;

          case '#':
            {
              var comment = new Comment();
              offset = comment.parse({
                src: src
              }, offset);
              this.contents.push(comment);
              atLineStart = false;
            }
            break;

          default:
            {
              var iEnd = Node.endOfIndent(src, offset);
              var context = {
                atLineStart: atLineStart,
                indent: -1,
                inFlow: false,
                inCollection: false,
                lineStart: lineStart,
                parent: this
              };
              var node = parseNode(context, iEnd);
              if (!node) return this.valueRange.end = iEnd; // at next document start

              this.contents.push(node);
              offset = node.range.end;
              atLineStart = false;
              var ec = grabCollectionEndComments(node);
              if (ec) Array.prototype.push.apply(this.contents, ec);
            }
        }

        offset = Document.startCommentOrEndBlankLine(src, offset);
      }

      this.valueRange.end = offset;

      if (src[offset]) {
        this.documentEndMarker = new Range(offset, offset + 3);
        offset += 3;

        if (src[offset]) {
          offset = Node.endOfWhiteSpace(src, offset);

          if (src[offset] === '#') {
            var _comment = new Comment();

            offset = _comment.parse({
              src: src
            }, offset);
            this.contents.push(_comment);
          }

          switch (src[offset]) {
            case '\n':
              offset += 1;
              break;

            case undefined:
              break;

            default:
              this.error = new YAMLSyntaxError(this, 'Document end marker line cannot have a non-comment suffix');
          }
        }
      }

      return offset;
    }
    /**
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      context.root = this;
      this.context = context;
      var src = context.src;
      var offset = src.charCodeAt(start) === 0xfeff ? start + 1 : start; // skip BOM

      offset = this.parseDirectives(offset);
      offset = this.parseContents(offset);
      return offset;
    }
  }, {
    key: "setOrigRanges",
    value: function setOrigRanges(cr, offset) {
      offset = _get(_getPrototypeOf(Document.prototype), "setOrigRanges", this).call(this, cr, offset);
      this.directives.forEach(function (node) {
        offset = node.setOrigRanges(cr, offset);
      });
      if (this.directivesEndMarker) offset = this.directivesEndMarker.setOrigRange(cr, offset);
      this.contents.forEach(function (node) {
        offset = node.setOrigRanges(cr, offset);
      });
      if (this.documentEndMarker) offset = this.documentEndMarker.setOrigRange(cr, offset);
      return offset;
    }
  }, {
    key: "toString",
    value: function toString() {
      var contents = this.contents,
          directives = this.directives,
          value = this.value;
      if (value != null) return value;
      var str = directives.join('');

      if (contents.length > 0) {
        if (directives.length > 0 || contents[0].type === Type.COMMENT) str += '---\n';
        str += contents.join('');
      }

      if (str[str.length - 1] !== '\n') str += '\n';
      return str;
    }
  }], [{
    key: "startCommentOrEndBlankLine",
    value: function startCommentOrEndBlankLine(src, start) {
      var offset = Node.endOfWhiteSpace(src, start);
      var ch = src[offset];
      return ch === '#' || ch === '\n' ? offset : start;
    }
  }]);

  return Document;
}(Node);

var Alias = /*#__PURE__*/function (_Node) {
  _inherits(Alias, _Node);

  var _super = _createSuper(Alias);

  function Alias() {
    _classCallCheck(this, Alias);

    return _super.apply(this, arguments);
  }

  _createClass(Alias, [{
    key: "parse",
    value:
    /**
     * Parses an *alias from the source
     *
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this scalar
     */
    function parse(context, start) {
      this.context = context;
      var src = context.src;
      var offset = Node.endOfIdentifier(src, start + 1);
      this.valueRange = new Range(start + 1, offset);
      offset = Node.endOfWhiteSpace(src, offset);
      offset = this.parseComment(offset);
      return offset;
    }
  }]);

  return Alias;
}(Node);

var Chomp = {
  CLIP: 'CLIP',
  KEEP: 'KEEP',
  STRIP: 'STRIP'
};
var BlockValue = /*#__PURE__*/function (_Node) {
  _inherits(BlockValue, _Node);

  var _super = _createSuper(BlockValue);

  function BlockValue(type, props) {
    var _this;

    _classCallCheck(this, BlockValue);

    _this = _super.call(this, type, props);
    _this.blockIndent = null;
    _this.chomping = Chomp.CLIP;
    _this.header = null;
    return _this;
  }

  _createClass(BlockValue, [{
    key: "includesTrailingLines",
    get: function get() {
      return this.chomping === Chomp.KEEP;
    }
  }, {
    key: "strValue",
    get: function get() {
      if (!this.valueRange || !this.context) return null;
      var _this$valueRange = this.valueRange,
          start = _this$valueRange.start,
          end = _this$valueRange.end;
      var _this$context = this.context,
          indent = _this$context.indent,
          src = _this$context.src;
      if (this.valueRange.isEmpty()) return '';
      var lastNewLine = null;
      var ch = src[end - 1];

      while (ch === '\n' || ch === '\t' || ch === ' ') {
        end -= 1;

        if (end <= start) {
          if (this.chomping === Chomp.KEEP) break;else return ''; // probably never happens
        }

        if (ch === '\n') lastNewLine = end;
        ch = src[end - 1];
      }

      var keepStart = end + 1;

      if (lastNewLine) {
        if (this.chomping === Chomp.KEEP) {
          keepStart = lastNewLine;
          end = this.valueRange.end;
        } else {
          end = lastNewLine;
        }
      }

      var bi = indent + this.blockIndent;
      var folded = this.type === Type.BLOCK_FOLDED;
      var atStart = true;
      var str = '';
      var sep = '';
      var prevMoreIndented = false;

      for (var i = start; i < end; ++i) {
        for (var j = 0; j < bi; ++j) {
          if (src[i] !== ' ') break;
          i += 1;
        }

        var _ch = src[i];

        if (_ch === '\n') {
          if (sep === '\n') str += '\n';else sep = '\n';
        } else {
          var lineEnd = Node.endOfLine(src, i);
          var line = src.slice(i, lineEnd);
          i = lineEnd;

          if (folded && (_ch === ' ' || _ch === '\t') && i < keepStart) {
            if (sep === ' ') sep = '\n';else if (!prevMoreIndented && !atStart && sep === '\n') sep = '\n\n';
            str += sep + line; //+ ((lineEnd < end && src[lineEnd]) || '')

            sep = lineEnd < end && src[lineEnd] || '';
            prevMoreIndented = true;
          } else {
            str += sep + line;
            sep = folded && i < keepStart ? ' ' : '\n';
            prevMoreIndented = false;
          }

          if (atStart && line !== '') atStart = false;
        }
      }

      return this.chomping === Chomp.STRIP ? str : str + '\n';
    }
  }, {
    key: "parseBlockHeader",
    value: function parseBlockHeader(start) {
      var src = this.context.src;
      var offset = start + 1;
      var bi = '';

      while (true) {
        var ch = src[offset];

        switch (ch) {
          case '-':
            this.chomping = Chomp.STRIP;
            break;

          case '+':
            this.chomping = Chomp.KEEP;
            break;

          case '0':
          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
          case '6':
          case '7':
          case '8':
          case '9':
            bi += ch;
            break;

          default:
            this.blockIndent = Number(bi) || null;
            this.header = new Range(start, offset);
            return offset;
        }

        offset += 1;
      }
    }
  }, {
    key: "parseBlockValue",
    value: function parseBlockValue(start) {
      var _this$context2 = this.context,
          indent = _this$context2.indent,
          src = _this$context2.src;
      var explicit = !!this.blockIndent;
      var offset = start;
      var valueEnd = start;
      var minBlockIndent = 1;

      for (var ch = src[offset]; ch === '\n'; ch = src[offset]) {
        offset += 1;
        if (Node.atDocumentBoundary(src, offset)) break;
        var end = Node.endOfBlockIndent(src, indent, offset); // should not include tab?

        if (end === null) break;
        var _ch2 = src[end];
        var lineIndent = end - (offset + indent);

        if (!this.blockIndent) {
          // no explicit block indent, none yet detected
          if (src[end] !== '\n') {
            // first line with non-whitespace content
            if (lineIndent < minBlockIndent) {
              var msg = 'Block scalars with more-indented leading empty lines must use an explicit indentation indicator';
              this.error = new YAMLSemanticError(this, msg);
            }

            this.blockIndent = lineIndent;
          } else if (lineIndent > minBlockIndent) {
            // empty line with more whitespace
            minBlockIndent = lineIndent;
          }
        } else if (_ch2 && _ch2 !== '\n' && lineIndent < this.blockIndent) {
          if (src[end] === '#') break;

          if (!this.error) {
            var _src = explicit ? 'explicit indentation indicator' : 'first line';

            var _msg = "Block scalars must not be less indented than their ".concat(_src);

            this.error = new YAMLSemanticError(this, _msg);
          }
        }

        if (src[end] === '\n') {
          offset = end;
        } else {
          offset = valueEnd = Node.endOfLine(src, end);
        }
      }

      if (this.chomping !== Chomp.KEEP) {
        offset = src[valueEnd] ? valueEnd + 1 : valueEnd;
      }

      this.valueRange = new Range(start + 1, offset);
      return offset;
    }
    /**
     * Parses a block value from the source
     *
     * Accepted forms are:
     * ```
     * BS
     * block
     * lines
     *
     * BS #comment
     * block
     * lines
     * ```
     * where the block style BS matches the regexp `[|>][-+1-9]*` and block lines
     * are empty or have an indent level greater than `indent`.
     *
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this block
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var src = context.src;
      var offset = this.parseBlockHeader(start);
      offset = Node.endOfWhiteSpace(src, offset);
      offset = this.parseComment(offset);
      offset = this.parseBlockValue(offset);
      return offset;
    }
  }, {
    key: "setOrigRanges",
    value: function setOrigRanges(cr, offset) {
      offset = _get(_getPrototypeOf(BlockValue.prototype), "setOrigRanges", this).call(this, cr, offset);
      return this.header ? this.header.setOrigRange(cr, offset) : offset;
    }
  }]);

  return BlockValue;
}(Node);

var FlowCollection = /*#__PURE__*/function (_Node) {
  _inherits(FlowCollection, _Node);

  var _super = _createSuper(FlowCollection);

  function FlowCollection(type, props) {
    var _this;

    _classCallCheck(this, FlowCollection);

    _this = _super.call(this, type, props);
    _this.items = null;
    return _this;
  }

  _createClass(FlowCollection, [{
    key: "prevNodeIsJsonLike",
    value: function prevNodeIsJsonLike() {
      var idx = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : this.items.length;
      var node = this.items[idx - 1];
      return !!node && (node.jsonLike || node.type === Type.COMMENT && this.prevNodeIsJsonLike(idx - 1));
    }
    /**
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var parseNode = context.parseNode,
          src = context.src;
      var indent = context.indent,
          lineStart = context.lineStart;
      var char = src[start]; // { or [

      this.items = [{
        char: char,
        offset: start
      }];
      var offset = Node.endOfWhiteSpace(src, start + 1);
      char = src[offset];

      while (char && char !== ']' && char !== '}') {
        switch (char) {
          case '\n':
            {
              lineStart = offset + 1;
              var wsEnd = Node.endOfWhiteSpace(src, lineStart);

              if (src[wsEnd] === '\n') {
                var blankLine = new BlankLine();
                lineStart = blankLine.parse({
                  src: src
                }, lineStart);
                this.items.push(blankLine);
              }

              offset = Node.endOfIndent(src, lineStart);

              if (offset <= lineStart + indent) {
                char = src[offset];

                if (offset < lineStart + indent || char !== ']' && char !== '}') {
                  var msg = 'Insufficient indentation in flow collection';
                  this.error = new YAMLSemanticError(this, msg);
                }
              }
            }
            break;

          case ',':
            {
              this.items.push({
                char: char,
                offset: offset
              });
              offset += 1;
            }
            break;

          case '#':
            {
              var comment = new Comment();
              offset = comment.parse({
                src: src
              }, offset);
              this.items.push(comment);
            }
            break;

          case '?':
          case ':':
            {
              var next = src[offset + 1];

              if (next === '\n' || next === '\t' || next === ' ' || next === ',' || // in-flow : after JSON-like key does not need to be followed by whitespace
              char === ':' && this.prevNodeIsJsonLike()) {
                this.items.push({
                  char: char,
                  offset: offset
                });
                offset += 1;
                break;
              }
            }
          // fallthrough

          default:
            {
              var node = parseNode({
                atLineStart: false,
                inCollection: false,
                inFlow: true,
                indent: -1,
                lineStart: lineStart,
                parent: this
              }, offset);

              if (!node) {
                // at next document start
                this.valueRange = new Range(start, offset);
                return offset;
              }

              this.items.push(node);
              offset = Node.normalizeOffset(src, node.range.end);
            }
        }

        offset = Node.endOfWhiteSpace(src, offset);
        char = src[offset];
      }

      this.valueRange = new Range(start, offset + 1);

      if (char) {
        this.items.push({
          char: char,
          offset: offset
        });
        offset = Node.endOfWhiteSpace(src, offset + 1);
        offset = this.parseComment(offset);
      }

      return offset;
    }
  }, {
    key: "setOrigRanges",
    value: function setOrigRanges(cr, offset) {
      offset = _get(_getPrototypeOf(FlowCollection.prototype), "setOrigRanges", this).call(this, cr, offset);
      this.items.forEach(function (node) {
        if (node instanceof Node) {
          offset = node.setOrigRanges(cr, offset);
        } else if (cr.length === 0) {
          node.origOffset = node.offset;
        } else {
          var i = offset;

          while (i < cr.length) {
            if (cr[i] > node.offset) break;else ++i;
          }

          node.origOffset = node.offset + i;
          offset = i;
        }
      });
      return offset;
    }
  }, {
    key: "toString",
    value: function toString() {
      var src = this.context.src,
          items = this.items,
          range = this.range,
          value = this.value;
      if (value != null) return value;
      var nodes = items.filter(function (item) {
        return item instanceof Node;
      });
      var str = '';
      var prevEnd = range.start;
      nodes.forEach(function (node) {
        var prefix = src.slice(prevEnd, node.range.start);
        prevEnd = node.range.end;
        str += prefix + String(node);

        if (str[str.length - 1] === '\n' && src[prevEnd - 1] !== '\n' && src[prevEnd] === '\n') {
          // Comment range does not include the terminal newline, but its
          // stringified value does. Without this fix, newlines at comment ends
          // get duplicated.
          prevEnd += 1;
        }
      });
      str += src.slice(prevEnd, range.end);
      return Node.addStringTerminator(src, range.end, str);
    }
  }]);

  return FlowCollection;
}(Node);

var QuoteDouble = /*#__PURE__*/function (_Node) {
  _inherits(QuoteDouble, _Node);

  var _super = _createSuper(QuoteDouble);

  function QuoteDouble() {
    _classCallCheck(this, QuoteDouble);

    return _super.apply(this, arguments);
  }

  _createClass(QuoteDouble, [{
    key: "strValue",
    get:
    /**
     * @returns {string | { str: string, errors: YAMLSyntaxError[] }}
     */
    function get() {
      if (!this.valueRange || !this.context) return null;
      var errors = [];
      var _this$valueRange = this.valueRange,
          start = _this$valueRange.start,
          end = _this$valueRange.end;
      var _this$context = this.context,
          indent = _this$context.indent,
          src = _this$context.src;
      if (src[end - 1] !== '"') errors.push(new YAMLSyntaxError(this, 'Missing closing "quote')); // Using String#replace is too painful with escaped newlines preceded by
      // escaped backslashes; also, this should be faster.

      var str = '';

      for (var i = start + 1; i < end - 1; ++i) {
        var ch = src[i];

        if (ch === '\n') {
          if (Node.atDocumentBoundary(src, i + 1)) errors.push(new YAMLSemanticError(this, 'Document boundary indicators are not allowed within string values'));

          var _Node$foldNewline = Node.foldNewline(src, i, indent),
              fold = _Node$foldNewline.fold,
              offset = _Node$foldNewline.offset,
              error = _Node$foldNewline.error;

          str += fold;
          i = offset;
          if (error) errors.push(new YAMLSemanticError(this, 'Multi-line double-quoted string needs to be sufficiently indented'));
        } else if (ch === '\\') {
          i += 1;

          switch (src[i]) {
            case '0':
              str += '\0';
              break;
            // null character

            case 'a':
              str += '\x07';
              break;
            // bell character

            case 'b':
              str += '\b';
              break;
            // backspace

            case 'e':
              str += '\x1b';
              break;
            // escape character

            case 'f':
              str += '\f';
              break;
            // form feed

            case 'n':
              str += '\n';
              break;
            // line feed

            case 'r':
              str += '\r';
              break;
            // carriage return

            case 't':
              str += '\t';
              break;
            // horizontal tab

            case 'v':
              str += '\v';
              break;
            // vertical tab

            case 'N':
              str += "\x85";
              break;
            // Unicode next line

            case '_':
              str += "\xA0";
              break;
            // Unicode non-breaking space

            case 'L':
              str += "\u2028";
              break;
            // Unicode line separator

            case 'P':
              str += "\u2029";
              break;
            // Unicode paragraph separator

            case ' ':
              str += ' ';
              break;

            case '"':
              str += '"';
              break;

            case '/':
              str += '/';
              break;

            case '\\':
              str += '\\';
              break;

            case '\t':
              str += '\t';
              break;

            case 'x':
              str += this.parseCharCode(i + 1, 2, errors);
              i += 2;
              break;

            case 'u':
              str += this.parseCharCode(i + 1, 4, errors);
              i += 4;
              break;

            case 'U':
              str += this.parseCharCode(i + 1, 8, errors);
              i += 8;
              break;

            case '\n':
              // skip escaped newlines, but still trim the following line
              while (src[i + 1] === ' ' || src[i + 1] === '\t') {
                i += 1;
              }

              break;

            default:
              errors.push(new YAMLSyntaxError(this, "Invalid escape sequence ".concat(src.substr(i - 1, 2))));
              str += '\\' + src[i];
          }
        } else if (ch === ' ' || ch === '\t') {
          // trim trailing whitespace
          var wsStart = i;
          var next = src[i + 1];

          while (next === ' ' || next === '\t') {
            i += 1;
            next = src[i + 1];
          }

          if (next !== '\n') str += i > wsStart ? src.slice(wsStart, i + 1) : ch;
        } else {
          str += ch;
        }
      }

      return errors.length > 0 ? {
        errors: errors,
        str: str
      } : str;
    }
  }, {
    key: "parseCharCode",
    value: function parseCharCode(offset, length, errors) {
      var src = this.context.src;
      var cc = src.substr(offset, length);
      var ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      var code = ok ? parseInt(cc, 16) : NaN;

      if (isNaN(code)) {
        errors.push(new YAMLSyntaxError(this, "Invalid escape sequence ".concat(src.substr(offset - 2, length + 2))));
        return src.substr(offset - 2, length + 2);
      }

      return String.fromCodePoint(code);
    }
    /**
     * Parses a "double quoted" value from the source
     *
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this scalar
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var src = context.src;
      var offset = QuoteDouble.endOfQuote(src, start + 1);
      this.valueRange = new Range(start, offset);
      offset = Node.endOfWhiteSpace(src, offset);
      offset = this.parseComment(offset);
      return offset;
    }
  }], [{
    key: "endOfQuote",
    value: function endOfQuote(src, offset) {
      var ch = src[offset];

      while (ch && ch !== '"') {
        offset += ch === '\\' ? 2 : 1;
        ch = src[offset];
      }

      return offset + 1;
    }
  }]);

  return QuoteDouble;
}(Node);

var QuoteSingle = /*#__PURE__*/function (_Node) {
  _inherits(QuoteSingle, _Node);

  var _super = _createSuper(QuoteSingle);

  function QuoteSingle() {
    _classCallCheck(this, QuoteSingle);

    return _super.apply(this, arguments);
  }

  _createClass(QuoteSingle, [{
    key: "strValue",
    get:
    /**
     * @returns {string | { str: string, errors: YAMLSyntaxError[] }}
     */
    function get() {
      if (!this.valueRange || !this.context) return null;
      var errors = [];
      var _this$valueRange = this.valueRange,
          start = _this$valueRange.start,
          end = _this$valueRange.end;
      var _this$context = this.context,
          indent = _this$context.indent,
          src = _this$context.src;
      if (src[end - 1] !== "'") errors.push(new YAMLSyntaxError(this, "Missing closing 'quote"));
      var str = '';

      for (var i = start + 1; i < end - 1; ++i) {
        var ch = src[i];

        if (ch === '\n') {
          if (Node.atDocumentBoundary(src, i + 1)) errors.push(new YAMLSemanticError(this, 'Document boundary indicators are not allowed within string values'));

          var _Node$foldNewline = Node.foldNewline(src, i, indent),
              fold = _Node$foldNewline.fold,
              offset = _Node$foldNewline.offset,
              error = _Node$foldNewline.error;

          str += fold;
          i = offset;
          if (error) errors.push(new YAMLSemanticError(this, 'Multi-line single-quoted string needs to be sufficiently indented'));
        } else if (ch === "'") {
          str += ch;
          i += 1;
          if (src[i] !== "'") errors.push(new YAMLSyntaxError(this, 'Unescaped single quote? This should not happen.'));
        } else if (ch === ' ' || ch === '\t') {
          // trim trailing whitespace
          var wsStart = i;
          var next = src[i + 1];

          while (next === ' ' || next === '\t') {
            i += 1;
            next = src[i + 1];
          }

          if (next !== '\n') str += i > wsStart ? src.slice(wsStart, i + 1) : ch;
        } else {
          str += ch;
        }
      }

      return errors.length > 0 ? {
        errors: errors,
        str: str
      } : str;
    }
    /**
     * Parses a 'single quoted' value from the source
     *
     * @param {ParseContext} context
     * @param {number} start - Index of first character
     * @returns {number} - Index of the character after this scalar
     */

  }, {
    key: "parse",
    value: function parse(context, start) {
      this.context = context;
      var src = context.src;
      var offset = QuoteSingle.endOfQuote(src, start + 1);
      this.valueRange = new Range(start, offset);
      offset = Node.endOfWhiteSpace(src, offset);
      offset = this.parseComment(offset);
      return offset;
    }
  }], [{
    key: "endOfQuote",
    value: function endOfQuote(src, offset) {
      var ch = src[offset];

      while (ch) {
        if (ch === "'") {
          if (src[offset + 1] !== "'") break;
          ch = src[offset += 2];
        } else {
          ch = src[offset += 1];
        }
      }

      return offset + 1;
    }
  }]);

  return QuoteSingle;
}(Node);

function createNewNode(type, props) {
  switch (type) {
    case Type.ALIAS:
      return new Alias(type, props);

    case Type.BLOCK_FOLDED:
    case Type.BLOCK_LITERAL:
      return new BlockValue(type, props);

    case Type.FLOW_MAP:
    case Type.FLOW_SEQ:
      return new FlowCollection(type, props);

    case Type.MAP_KEY:
    case Type.MAP_VALUE:
    case Type.SEQ_ITEM:
      return new CollectionItem(type, props);

    case Type.COMMENT:
    case Type.PLAIN:
      return new PlainValue(type, props);

    case Type.QUOTE_DOUBLE:
      return new QuoteDouble(type, props);

    case Type.QUOTE_SINGLE:
      return new QuoteSingle(type, props);

    /* istanbul ignore next */

    default:
      return null;
    // should never happen
  }
}
/**
 * @param {boolean} atLineStart - Node starts at beginning of line
 * @param {boolean} inFlow - true if currently in a flow context
 * @param {boolean} inCollection - true if currently in a collection context
 * @param {number} indent - Current level of indentation
 * @param {number} lineStart - Start of the current line
 * @param {Node} parent - The parent of the node
 * @param {string} src - Source of the YAML document
 */


var ParseContext = /*#__PURE__*/function () {
  function ParseContext() {
    var _this = this;

    var orig = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
        atLineStart = _ref.atLineStart,
        inCollection = _ref.inCollection,
        inFlow = _ref.inFlow,
        indent = _ref.indent,
        lineStart = _ref.lineStart,
        parent = _ref.parent;

    _classCallCheck(this, ParseContext);

    _defineProperty(this, "parseNode", function (overlay, start) {
      if (Node.atDocumentBoundary(_this.src, start)) return null;
      var context = new ParseContext(_this, overlay);

      var _context$parseProps = context.parseProps(start),
          props = _context$parseProps.props,
          type = _context$parseProps.type,
          valueStart = _context$parseProps.valueStart;

      var node = createNewNode(type, props);
      var offset = node.parse(context, valueStart);
      node.range = new Range(start, offset);
      /* istanbul ignore if */

      if (offset <= start) {
        // This should never happen, but if it does, let's make sure to at least
        // step one character forward to avoid a busy loop.
        node.error = new Error("Node#parse consumed no characters");
        node.error.parseEnd = offset;
        node.error.source = node;
        node.range.end = start + 1;
      }

      if (context.nodeStartsCollection(node)) {
        if (!node.error && !context.atLineStart && context.parent.type === Type.DOCUMENT) {
          node.error = new YAMLSyntaxError(node, 'Block collection must not have preceding content here (e.g. directives-end indicator)');
        }

        var collection = new Collection(node);
        offset = collection.parse(new ParseContext(context), offset);
        collection.range = new Range(start, offset);
        return collection;
      }

      return node;
    });

    this.atLineStart = atLineStart != null ? atLineStart : orig.atLineStart || false;
    this.inCollection = inCollection != null ? inCollection : orig.inCollection || false;
    this.inFlow = inFlow != null ? inFlow : orig.inFlow || false;
    this.indent = indent != null ? indent : orig.indent;
    this.lineStart = lineStart != null ? lineStart : orig.lineStart;
    this.parent = parent != null ? parent : orig.parent || {};
    this.root = orig.root;
    this.src = orig.src;
  }

  _createClass(ParseContext, [{
    key: "nodeStartsCollection",
    value: function nodeStartsCollection(node) {
      var inCollection = this.inCollection,
          inFlow = this.inFlow,
          src = this.src;
      if (inCollection || inFlow) return false;
      if (node instanceof CollectionItem) return true; // check for implicit key

      var offset = node.range.end;
      if (src[offset] === '\n' || src[offset - 1] === '\n') return false;
      offset = Node.endOfWhiteSpace(src, offset);
      return src[offset] === ':';
    } // Anchor and tag are before type, which determines the node implementation
    // class; hence this intermediate step.

  }, {
    key: "parseProps",
    value: function parseProps(offset) {
      var inFlow = this.inFlow,
          parent = this.parent,
          src = this.src;
      var props = [];
      var lineHasProps = false;
      offset = this.atLineStart ? Node.endOfIndent(src, offset) : Node.endOfWhiteSpace(src, offset);
      var ch = src[offset];

      while (ch === Char.ANCHOR || ch === Char.COMMENT || ch === Char.TAG || ch === '\n') {
        if (ch === '\n') {
          var inEnd = offset;
          var lineStart = void 0;

          do {
            lineStart = inEnd + 1;
            inEnd = Node.endOfIndent(src, lineStart);
          } while (src[inEnd] === '\n');

          var indentDiff = inEnd - (lineStart + this.indent);
          var noIndicatorAsIndent = parent.type === Type.SEQ_ITEM && parent.context.atLineStart;
          if (src[inEnd] !== '#' && !Node.nextNodeIsIndented(src[inEnd], indentDiff, !noIndicatorAsIndent)) break;
          this.atLineStart = true;
          this.lineStart = lineStart;
          lineHasProps = false;
          offset = inEnd;
        } else if (ch === Char.COMMENT) {
          var end = Node.endOfLine(src, offset + 1);
          props.push(new Range(offset, end));
          offset = end;
        } else {
          var _end = Node.endOfIdentifier(src, offset + 1);

          if (ch === Char.TAG && src[_end] === ',' && /^[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+,\d\d\d\d(-\d\d){0,2}\/\S/.test(src.slice(offset + 1, _end + 13))) {
            // Let's presume we're dealing with a YAML 1.0 domain tag here, rather
            // than an empty but 'foo.bar' private-tagged node in a flow collection
            // followed without whitespace by a plain string starting with a year
            // or date divided by something.
            _end = Node.endOfIdentifier(src, _end + 5);
          }

          props.push(new Range(offset, _end));
          lineHasProps = true;
          offset = Node.endOfWhiteSpace(src, _end);
        }

        ch = src[offset];
      } // '- &a : b' has an anchor on an empty node


      if (lineHasProps && ch === ':' && Node.atBlank(src, offset + 1, true)) offset -= 1;
      var type = ParseContext.parseType(src, offset, inFlow);
      return {
        props: props,
        type: type,
        valueStart: offset
      };
    }
    /**
     * Parses a node from the source
     * @param {ParseContext} overlay
     * @param {number} start - Index of first non-whitespace character for the node
     * @returns {?Node} - null if at a document boundary
     */

  }], [{
    key: "parseType",
    value: function parseType(src, offset, inFlow) {
      switch (src[offset]) {
        case '*':
          return Type.ALIAS;

        case '>':
          return Type.BLOCK_FOLDED;

        case '|':
          return Type.BLOCK_LITERAL;

        case '{':
          return Type.FLOW_MAP;

        case '[':
          return Type.FLOW_SEQ;

        case '?':
          return !inFlow && Node.atBlank(src, offset + 1, true) ? Type.MAP_KEY : Type.PLAIN;

        case ':':
          return !inFlow && Node.atBlank(src, offset + 1, true) ? Type.MAP_VALUE : Type.PLAIN;

        case '-':
          return !inFlow && Node.atBlank(src, offset + 1, true) ? Type.SEQ_ITEM : Type.PLAIN;

        case '"':
          return Type.QUOTE_DOUBLE;

        case "'":
          return Type.QUOTE_SINGLE;

        default:
          return Type.PLAIN;
      }
    }
  }]);

  return ParseContext;
}();

// Published as 'yaml/parse-cst'
function parse(src) {
  var cr = [];

  if (src.indexOf('\r') !== -1) {
    src = src.replace(/\r\n?/g, function (match, offset) {
      if (match.length > 1) cr.push(offset);
      return '\n';
    });
  }

  var documents = [];
  var offset = 0;

  do {
    var doc = new Document();
    var context = new ParseContext({
      src: src
    });
    offset = doc.parse(context, offset);
    documents.push(doc);
  } while (offset < src.length);

  documents.setOrigRanges = function () {
    if (cr.length === 0) return false;

    for (var i = 1; i < cr.length; ++i) {
      cr[i] -= i;
    }

    var crOffset = 0;

    for (var _i = 0; _i < documents.length; ++_i) {
      crOffset = documents[_i].setOrigRanges(cr, crOffset);
    }

    cr.splice(0, cr.length);
    return true;
  };

  documents.toString = function () {
    return documents.join('...\n');
  };

  return documents;
}



;// ./node_modules/yaml/browser/dist/resolveSeq-492ab440.js


function addCommentBefore(str, indent, comment) {
  if (!comment) return str;
  var cc = comment.replace(/[\s\S]^/gm, "$&".concat(indent, "#"));
  return "#".concat(cc, "\n").concat(indent).concat(str);
}
function addComment(str, indent, comment) {
  return !comment ? str : comment.indexOf('\n') === -1 ? "".concat(str, " #").concat(comment) : "".concat(str, "\n") + comment.replace(/^/gm, "".concat(indent || '', "#"));
}

var resolveSeq_492ab440_Node = function Node() {
  _classCallCheck(this, Node);
};

function toJSON(value, arg, ctx) {
  if (Array.isArray(value)) return value.map(function (v, i) {
    return toJSON(v, String(i), ctx);
  });

  if (value && typeof value.toJSON === 'function') {
    var anchor = ctx && ctx.anchors && ctx.anchors.get(value);
    if (anchor) ctx.onCreate = function (res) {
      anchor.res = res;
      delete ctx.onCreate;
    };
    var res = value.toJSON(arg, ctx);
    if (anchor && ctx.onCreate) ctx.onCreate(res);
    return res;
  }

  if ((!ctx || !ctx.keep) && typeof value === 'bigint') return Number(value);
  return value;
}

var Scalar = /*#__PURE__*/function (_Node) {
  _inherits(Scalar, _Node);

  var _super = _createSuper(Scalar);

  function Scalar(value) {
    var _this;

    _classCallCheck(this, Scalar);

    _this = _super.call(this);
    _this.value = value;
    return _this;
  }

  _createClass(Scalar, [{
    key: "toJSON",
    value: function toJSON$1(arg, ctx) {
      return ctx && ctx.keep ? this.value : toJSON(this.value, arg, ctx);
    }
  }, {
    key: "toString",
    value: function toString() {
      return String(this.value);
    }
  }]);

  return Scalar;
}(resolveSeq_492ab440_Node);

function collectionFromPath(schema, path, value) {
  var v = value;

  for (var i = path.length - 1; i >= 0; --i) {
    var k = path[i];

    if (Number.isInteger(k) && k >= 0) {
      var a = [];
      a[k] = v;
      v = a;
    } else {
      var o = {};
      Object.defineProperty(o, k, {
        value: v,
        writable: true,
        enumerable: true,
        configurable: true
      });
      v = o;
    }
  }

  return schema.createNode(v, false);
} // null, undefined, or an empty non-string iterable (e.g. [])


var isEmptyPath = function isEmptyPath(path) {
  return path == null || _typeof(path) === 'object' && path[Symbol.iterator]().next().done;
};
var resolveSeq_492ab440_Collection = /*#__PURE__*/function (_Node) {
  _inherits(Collection, _Node);

  var _super = _createSuper(Collection);

  function Collection(schema) {
    var _this;

    _classCallCheck(this, Collection);

    _this = _super.call(this);

    _defineProperty(_assertThisInitialized(_this), "items", []);

    _this.schema = schema;
    return _this;
  }

  _createClass(Collection, [{
    key: "addIn",
    value: function addIn(path, value) {
      if (isEmptyPath(path)) this.add(value);else {
        var _path = _toArray(path),
            key = _path[0],
            rest = _path.slice(1);

        var node = this.get(key, true);
        if (node instanceof Collection) node.addIn(rest, value);else if (node === undefined && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));else throw new Error("Expected YAML collection at ".concat(key, ". Remaining path: ").concat(rest));
      }
    }
  }, {
    key: "deleteIn",
    value: function deleteIn(_ref) {
      var _ref2 = _toArray(_ref),
          key = _ref2[0],
          rest = _ref2.slice(1);

      if (rest.length === 0) return this.delete(key);
      var node = this.get(key, true);
      if (node instanceof Collection) return node.deleteIn(rest);else throw new Error("Expected YAML collection at ".concat(key, ". Remaining path: ").concat(rest));
    }
  }, {
    key: "getIn",
    value: function getIn(_ref3, keepScalar) {
      var _ref4 = _toArray(_ref3),
          key = _ref4[0],
          rest = _ref4.slice(1);

      var node = this.get(key, true);
      if (rest.length === 0) return !keepScalar && node instanceof Scalar ? node.value : node;else return node instanceof Collection ? node.getIn(rest, keepScalar) : undefined;
    }
  }, {
    key: "hasAllNullValues",
    value: function hasAllNullValues() {
      return this.items.every(function (node) {
        if (!node || node.type !== 'PAIR') return false;
        var n = node.value;
        return n == null || n instanceof Scalar && n.value == null && !n.commentBefore && !n.comment && !n.tag;
      });
    }
  }, {
    key: "hasIn",
    value: function hasIn(_ref5) {
      var _ref6 = _toArray(_ref5),
          key = _ref6[0],
          rest = _ref6.slice(1);

      if (rest.length === 0) return this.has(key);
      var node = this.get(key, true);
      return node instanceof Collection ? node.hasIn(rest) : false;
    }
  }, {
    key: "setIn",
    value: function setIn(_ref7, value) {
      var _ref8 = _toArray(_ref7),
          key = _ref8[0],
          rest = _ref8.slice(1);

      if (rest.length === 0) {
        this.set(key, value);
      } else {
        var node = this.get(key, true);
        if (node instanceof Collection) node.setIn(rest, value);else if (node === undefined && this.schema) this.set(key, collectionFromPath(this.schema, rest, value));else throw new Error("Expected YAML collection at ".concat(key, ". Remaining path: ").concat(rest));
      }
    } // overridden in implementations

    /* istanbul ignore next */

  }, {
    key: "toJSON",
    value: function toJSON() {
      return null;
    }
  }, {
    key: "toString",
    value: function toString(ctx, _ref9, onComment, onChompKeep) {
      var _this2 = this;

      var blockItem = _ref9.blockItem,
          flowChars = _ref9.flowChars,
          isMap = _ref9.isMap,
          itemIndent = _ref9.itemIndent;
      var _ctx = ctx,
          indent = _ctx.indent,
          indentStep = _ctx.indentStep,
          stringify = _ctx.stringify;
      var inFlow = this.type === Type.FLOW_MAP || this.type === Type.FLOW_SEQ || ctx.inFlow;
      if (inFlow) itemIndent += indentStep;
      var allNullValues = isMap && this.hasAllNullValues();
      ctx = Object.assign({}, ctx, {
        allNullValues: allNullValues,
        indent: itemIndent,
        inFlow: inFlow,
        type: null
      });
      var chompKeep = false;
      var hasItemWithNewLine = false;
      var nodes = this.items.reduce(function (nodes, item, i) {
        var comment;

        if (item) {
          if (!chompKeep && item.spaceBefore) nodes.push({
            type: 'comment',
            str: ''
          });
          if (item.commentBefore) item.commentBefore.match(/^.*$/gm).forEach(function (line) {
            nodes.push({
              type: 'comment',
              str: "#".concat(line)
            });
          });
          if (item.comment) comment = item.comment;
          if (inFlow && (!chompKeep && item.spaceBefore || item.commentBefore || item.comment || item.key && (item.key.commentBefore || item.key.comment) || item.value && (item.value.commentBefore || item.value.comment))) hasItemWithNewLine = true;
        }

        chompKeep = false;
        var str = stringify(item, ctx, function () {
          return comment = null;
        }, function () {
          return chompKeep = true;
        });
        if (inFlow && !hasItemWithNewLine && str.includes('\n')) hasItemWithNewLine = true;
        if (inFlow && i < _this2.items.length - 1) str += ',';
        str = addComment(str, itemIndent, comment);
        if (chompKeep && (comment || inFlow)) chompKeep = false;
        nodes.push({
          type: 'item',
          str: str
        });
        return nodes;
      }, []);
      var str;

      if (nodes.length === 0) {
        str = flowChars.start + flowChars.end;
      } else if (inFlow) {
        var start = flowChars.start,
            end = flowChars.end;
        var strings = nodes.map(function (n) {
          return n.str;
        });

        if (hasItemWithNewLine || strings.reduce(function (sum, str) {
          return sum + str.length + 2;
        }, 2) > Collection.maxFlowStringSingleLineLength) {
          str = start;

          var _iterator = _createForOfIteratorHelper(strings),
              _step;

          try {
            for (_iterator.s(); !(_step = _iterator.n()).done;) {
              var s = _step.value;
              str += s ? "\n".concat(indentStep).concat(indent).concat(s) : '\n';
            }
          } catch (err) {
            _iterator.e(err);
          } finally {
            _iterator.f();
          }

          str += "\n".concat(indent).concat(end);
        } else {
          str = "".concat(start, " ").concat(strings.join(' '), " ").concat(end);
        }
      } else {
        var _strings = nodes.map(blockItem);

        str = _strings.shift();

        var _iterator2 = _createForOfIteratorHelper(_strings),
            _step2;

        try {
          for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
            var _s = _step2.value;
            str += _s ? "\n".concat(indent).concat(_s) : '\n';
          }
        } catch (err) {
          _iterator2.e(err);
        } finally {
          _iterator2.f();
        }
      }

      if (this.comment) {
        str += '\n' + this.comment.replace(/^/gm, "".concat(indent, "#"));
        if (onComment) onComment();
      } else if (chompKeep && onChompKeep) onChompKeep();

      return str;
    }
  }]);

  return Collection;
}(resolveSeq_492ab440_Node);

_defineProperty(resolveSeq_492ab440_Collection, "maxFlowStringSingleLineLength", 60);

function asItemIndex(key) {
  var idx = key instanceof Scalar ? key.value : key;
  if (idx && typeof idx === 'string') idx = Number(idx);
  return Number.isInteger(idx) && idx >= 0 ? idx : null;
}

var YAMLSeq = /*#__PURE__*/function (_Collection) {
  _inherits(YAMLSeq, _Collection);

  var _super = _createSuper(YAMLSeq);

  function YAMLSeq() {
    _classCallCheck(this, YAMLSeq);

    return _super.apply(this, arguments);
  }

  _createClass(YAMLSeq, [{
    key: "add",
    value: function add(value) {
      this.items.push(value);
    }
  }, {
    key: "delete",
    value: function _delete(key) {
      var idx = asItemIndex(key);
      if (typeof idx !== 'number') return false;
      var del = this.items.splice(idx, 1);
      return del.length > 0;
    }
  }, {
    key: "get",
    value: function get(key, keepScalar) {
      var idx = asItemIndex(key);
      if (typeof idx !== 'number') return undefined;
      var it = this.items[idx];
      return !keepScalar && it instanceof Scalar ? it.value : it;
    }
  }, {
    key: "has",
    value: function has(key) {
      var idx = asItemIndex(key);
      return typeof idx === 'number' && idx < this.items.length;
    }
  }, {
    key: "set",
    value: function set(key, value) {
      var idx = asItemIndex(key);
      if (typeof idx !== 'number') throw new Error("Expected a valid index, not ".concat(key, "."));
      this.items[idx] = value;
    }
  }, {
    key: "toJSON",
    value: function toJSON$1(_, ctx) {
      var seq = [];
      if (ctx && ctx.onCreate) ctx.onCreate(seq);
      var i = 0;

      var _iterator = _createForOfIteratorHelper(this.items),
          _step;

      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var item = _step.value;
          seq.push(toJSON(item, String(i++), ctx));
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }

      return seq;
    }
  }, {
    key: "toString",
    value: function toString(ctx, onComment, onChompKeep) {
      if (!ctx) return JSON.stringify(this);
      return _get(_getPrototypeOf(YAMLSeq.prototype), "toString", this).call(this, ctx, {
        blockItem: function blockItem(n) {
          return n.type === 'comment' ? n.str : "- ".concat(n.str);
        },
        flowChars: {
          start: '[',
          end: ']'
        },
        isMap: false,
        itemIndent: (ctx.indent || '') + '  '
      }, onComment, onChompKeep);
    }
  }]);

  return YAMLSeq;
}(resolveSeq_492ab440_Collection);

var stringifyKey = function stringifyKey(key, jsKey, ctx) {
  if (jsKey === null) return '';
  if (_typeof(jsKey) !== 'object') return String(jsKey);
  if (key instanceof resolveSeq_492ab440_Node && ctx && ctx.doc) return key.toString({
    anchors: Object.create(null),
    doc: ctx.doc,
    indent: '',
    indentStep: ctx.indentStep,
    inFlow: true,
    inStringifyKey: true,
    stringify: ctx.stringify
  });
  return JSON.stringify(jsKey);
};

var Pair = /*#__PURE__*/function (_Node) {
  _inherits(Pair, _Node);

  var _super = _createSuper(Pair);

  function Pair(key) {
    var _this;

    var value = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

    _classCallCheck(this, Pair);

    _this = _super.call(this);
    _this.key = key;
    _this.value = value;
    _this.type = Pair.Type.PAIR;
    return _this;
  }

  _createClass(Pair, [{
    key: "commentBefore",
    get: function get() {
      return this.key instanceof resolveSeq_492ab440_Node ? this.key.commentBefore : undefined;
    },
    set: function set(cb) {
      if (this.key == null) this.key = new Scalar(null);
      if (this.key instanceof resolveSeq_492ab440_Node) this.key.commentBefore = cb;else {
        var msg = 'Pair.commentBefore is an alias for Pair.key.commentBefore. To set it, the key must be a Node.';
        throw new Error(msg);
      }
    }
  }, {
    key: "addToJSMap",
    value: function addToJSMap(ctx, map) {
      var key = toJSON(this.key, '', ctx);

      if (map instanceof Map) {
        var value = toJSON(this.value, key, ctx);
        map.set(key, value);
      } else if (map instanceof Set) {
        map.add(key);
      } else {
        var stringKey = stringifyKey(this.key, key, ctx);

        var _value = toJSON(this.value, stringKey, ctx);

        if (stringKey in map) Object.defineProperty(map, stringKey, {
          value: _value,
          writable: true,
          enumerable: true,
          configurable: true
        });else map[stringKey] = _value;
      }

      return map;
    }
  }, {
    key: "toJSON",
    value: function toJSON(_, ctx) {
      var pair = ctx && ctx.mapAsMap ? new Map() : {};
      return this.addToJSMap(ctx, pair);
    }
  }, {
    key: "toString",
    value: function toString(ctx, onComment, onChompKeep) {
      if (!ctx || !ctx.doc) return JSON.stringify(this);
      var _ctx$doc$options = ctx.doc.options,
          indentSize = _ctx$doc$options.indent,
          indentSeq = _ctx$doc$options.indentSeq,
          simpleKeys = _ctx$doc$options.simpleKeys;
      var key = this.key,
          value = this.value;
      var keyComment = key instanceof resolveSeq_492ab440_Node && key.comment;

      if (simpleKeys) {
        if (keyComment) {
          throw new Error('With simple keys, key nodes cannot have comments');
        }

        if (key instanceof resolveSeq_492ab440_Collection) {
          var msg = 'With simple keys, collection cannot be used as a key value';
          throw new Error(msg);
        }
      }

      var explicitKey = !simpleKeys && (!key || keyComment || (key instanceof resolveSeq_492ab440_Node ? key instanceof resolveSeq_492ab440_Collection || key.type === Type.BLOCK_FOLDED || key.type === Type.BLOCK_LITERAL : _typeof(key) === 'object'));
      var _ctx = ctx,
          doc = _ctx.doc,
          indent = _ctx.indent,
          indentStep = _ctx.indentStep,
          stringify = _ctx.stringify;
      ctx = Object.assign({}, ctx, {
        implicitKey: !explicitKey,
        indent: indent + indentStep
      });
      var chompKeep = false;
      var str = stringify(key, ctx, function () {
        return keyComment = null;
      }, function () {
        return chompKeep = true;
      });
      str = addComment(str, ctx.indent, keyComment);

      if (!explicitKey && str.length > 1024) {
        if (simpleKeys) throw new Error('With simple keys, single line scalar must not span more than 1024 characters');
        explicitKey = true;
      }

      if (ctx.allNullValues && !simpleKeys) {
        if (this.comment) {
          str = addComment(str, ctx.indent, this.comment);
          if (onComment) onComment();
        } else if (chompKeep && !keyComment && onChompKeep) onChompKeep();

        return ctx.inFlow && !explicitKey ? str : "? ".concat(str);
      }

      str = explicitKey ? "? ".concat(str, "\n").concat(indent, ":") : "".concat(str, ":");

      if (this.comment) {
        // expected (but not strictly required) to be a single-line comment
        str = addComment(str, ctx.indent, this.comment);
        if (onComment) onComment();
      }

      var vcb = '';
      var valueComment = null;

      if (value instanceof resolveSeq_492ab440_Node) {
        if (value.spaceBefore) vcb = '\n';

        if (value.commentBefore) {
          var cs = value.commentBefore.replace(/^/gm, "".concat(ctx.indent, "#"));
          vcb += "\n".concat(cs);
        }

        valueComment = value.comment;
      } else if (value && _typeof(value) === 'object') {
        value = doc.schema.createNode(value, true);
      }

      ctx.implicitKey = false;
      if (!explicitKey && !this.comment && value instanceof Scalar) ctx.indentAtStart = str.length + 1;
      chompKeep = false;

      if (!indentSeq && indentSize >= 2 && !ctx.inFlow && !explicitKey && value instanceof YAMLSeq && value.type !== Type.FLOW_SEQ && !value.tag && !doc.anchors.getName(value)) {
        // If indentSeq === false, consider '- ' as part of indentation where possible
        ctx.indent = ctx.indent.substr(2);
      }

      var valueStr = stringify(value, ctx, function () {
        return valueComment = null;
      }, function () {
        return chompKeep = true;
      });
      var ws = ' ';

      if (vcb || this.comment) {
        ws = "".concat(vcb, "\n").concat(ctx.indent);
      } else if (!explicitKey && value instanceof resolveSeq_492ab440_Collection) {
        var flow = valueStr[0] === '[' || valueStr[0] === '{';
        if (!flow || valueStr.includes('\n')) ws = "\n".concat(ctx.indent);
      } else if (valueStr[0] === '\n') ws = '';

      if (chompKeep && !valueComment && onChompKeep) onChompKeep();
      return addComment(str + ws + valueStr, ctx.indent, valueComment);
    }
  }]);

  return Pair;
}(resolveSeq_492ab440_Node);

_defineProperty(Pair, "Type", {
  PAIR: 'PAIR',
  MERGE_PAIR: 'MERGE_PAIR'
});

var getAliasCount = function getAliasCount(node, anchors) {
  if (node instanceof resolveSeq_492ab440_Alias) {
    var anchor = anchors.get(node.source);
    return anchor.count * anchor.aliasCount;
  } else if (node instanceof resolveSeq_492ab440_Collection) {
    var count = 0;

    var _iterator = _createForOfIteratorHelper(node.items),
        _step;

    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var item = _step.value;
        var c = getAliasCount(item, anchors);
        if (c > count) count = c;
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }

    return count;
  } else if (node instanceof Pair) {
    var kc = getAliasCount(node.key, anchors);
    var vc = getAliasCount(node.value, anchors);
    return Math.max(kc, vc);
  }

  return 1;
};

var resolveSeq_492ab440_Alias = /*#__PURE__*/function (_Node) {
  _inherits(Alias, _Node);

  var _super = _createSuper(Alias);

  function Alias(source) {
    var _this;

    _classCallCheck(this, Alias);

    _this = _super.call(this);
    _this.source = source;
    _this.type = Type.ALIAS;
    return _this;
  }

  _createClass(Alias, [{
    key: "tag",
    set: function set(t) {
      throw new Error('Alias nodes cannot have tags');
    }
  }, {
    key: "toJSON",
    value: function toJSON$1(arg, ctx) {
      if (!ctx) return toJSON(this.source, arg, ctx);
      var anchors = ctx.anchors,
          maxAliasCount = ctx.maxAliasCount;
      var anchor = anchors.get(this.source);
      /* istanbul ignore if */

      if (!anchor || anchor.res === undefined) {
        var msg = 'This should not happen: Alias anchor was not resolved?';
        if (this.cstNode) throw new YAMLReferenceError(this.cstNode, msg);else throw new ReferenceError(msg);
      }

      if (maxAliasCount >= 0) {
        anchor.count += 1;
        if (anchor.aliasCount === 0) anchor.aliasCount = getAliasCount(this.source, anchors);

        if (anchor.count * anchor.aliasCount > maxAliasCount) {
          var _msg = 'Excessive alias count indicates a resource exhaustion attack';
          if (this.cstNode) throw new YAMLReferenceError(this.cstNode, _msg);else throw new ReferenceError(_msg);
        }
      }

      return anchor.res;
    } // Only called when stringifying an alias mapping key while constructing
    // Object output.

  }, {
    key: "toString",
    value: function toString(ctx) {
      return Alias.stringify(this, ctx);
    }
  }], [{
    key: "stringify",
    value: function stringify(_ref, _ref2) {
      var range = _ref.range,
          source = _ref.source;
      var anchors = _ref2.anchors,
          doc = _ref2.doc,
          implicitKey = _ref2.implicitKey,
          inStringifyKey = _ref2.inStringifyKey;
      var anchor = Object.keys(anchors).find(function (a) {
        return anchors[a] === source;
      });
      if (!anchor && inStringifyKey) anchor = doc.anchors.getName(source) || doc.anchors.newName();
      if (anchor) return "*".concat(anchor).concat(implicitKey ? ' ' : '');
      var msg = doc.anchors.getName(source) ? 'Alias node must be after source node' : 'Source node not found for alias node';
      throw new Error("".concat(msg, " [").concat(range, "]"));
    }
  }]);

  return Alias;
}(resolveSeq_492ab440_Node);

_defineProperty(resolveSeq_492ab440_Alias, "default", true);

function findPair(items, key) {
  var k = key instanceof Scalar ? key.value : key;

  var _iterator = _createForOfIteratorHelper(items),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var it = _step.value;

      if (it instanceof Pair) {
        if (it.key === key || it.key === k) return it;
        if (it.key && it.key.value === k) return it;
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  return undefined;
}
var YAMLMap = /*#__PURE__*/function (_Collection) {
  _inherits(YAMLMap, _Collection);

  var _super = _createSuper(YAMLMap);

  function YAMLMap() {
    _classCallCheck(this, YAMLMap);

    return _super.apply(this, arguments);
  }

  _createClass(YAMLMap, [{
    key: "add",
    value: function add(pair, overwrite) {
      if (!pair) pair = new Pair(pair);else if (!(pair instanceof Pair)) pair = new Pair(pair.key || pair, pair.value);
      var prev = findPair(this.items, pair.key);
      var sortEntries = this.schema && this.schema.sortMapEntries;

      if (prev) {
        if (overwrite) prev.value = pair.value;else throw new Error("Key ".concat(pair.key, " already set"));
      } else if (sortEntries) {
        var i = this.items.findIndex(function (item) {
          return sortEntries(pair, item) < 0;
        });
        if (i === -1) this.items.push(pair);else this.items.splice(i, 0, pair);
      } else {
        this.items.push(pair);
      }
    }
  }, {
    key: "delete",
    value: function _delete(key) {
      var it = findPair(this.items, key);
      if (!it) return false;
      var del = this.items.splice(this.items.indexOf(it), 1);
      return del.length > 0;
    }
  }, {
    key: "get",
    value: function get(key, keepScalar) {
      var it = findPair(this.items, key);
      var node = it && it.value;
      return !keepScalar && node instanceof Scalar ? node.value : node;
    }
  }, {
    key: "has",
    value: function has(key) {
      return !!findPair(this.items, key);
    }
  }, {
    key: "set",
    value: function set(key, value) {
      this.add(new Pair(key, value), true);
    }
    /**
     * @param {*} arg ignored
     * @param {*} ctx Conversion context, originally set in Document#toJSON()
     * @param {Class} Type If set, forces the returned collection type
     * @returns {*} Instance of Type, Map, or Object
     */

  }, {
    key: "toJSON",
    value: function toJSON(_, ctx, Type) {
      var map = Type ? new Type() : ctx && ctx.mapAsMap ? new Map() : {};
      if (ctx && ctx.onCreate) ctx.onCreate(map);

      var _iterator2 = _createForOfIteratorHelper(this.items),
          _step2;

      try {
        for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
          var item = _step2.value;
          item.addToJSMap(ctx, map);
        }
      } catch (err) {
        _iterator2.e(err);
      } finally {
        _iterator2.f();
      }

      return map;
    }
  }, {
    key: "toString",
    value: function toString(ctx, onComment, onChompKeep) {
      if (!ctx) return JSON.stringify(this);

      var _iterator3 = _createForOfIteratorHelper(this.items),
          _step3;

      try {
        for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
          var item = _step3.value;
          if (!(item instanceof Pair)) throw new Error("Map items must all be pairs; found ".concat(JSON.stringify(item), " instead"));
        }
      } catch (err) {
        _iterator3.e(err);
      } finally {
        _iterator3.f();
      }

      return _get(_getPrototypeOf(YAMLMap.prototype), "toString", this).call(this, ctx, {
        blockItem: function blockItem(n) {
          return n.str;
        },
        flowChars: {
          start: '{',
          end: '}'
        },
        isMap: true,
        itemIndent: ctx.indent || ''
      }, onComment, onChompKeep);
    }
  }]);

  return YAMLMap;
}(resolveSeq_492ab440_Collection);

var MERGE_KEY = '<<';
var Merge = /*#__PURE__*/function (_Pair) {
  _inherits(Merge, _Pair);

  var _super = _createSuper(Merge);

  function Merge(pair) {
    var _this;

    _classCallCheck(this, Merge);

    if (pair instanceof Pair) {
      var seq = pair.value;

      if (!(seq instanceof YAMLSeq)) {
        seq = new YAMLSeq();
        seq.items.push(pair.value);
        seq.range = pair.value.range;
      }

      _this = _super.call(this, pair.key, seq);
      _this.range = pair.range;
    } else {
      _this = _super.call(this, new Scalar(MERGE_KEY), new YAMLSeq());
    }

    _this.type = Pair.Type.MERGE_PAIR;
    return _possibleConstructorReturn(_this);
  } // If the value associated with a merge key is a single mapping node, each of
  // its key/value pairs is inserted into the current mapping, unless the key
  // already exists in it. If the value associated with the merge key is a
  // sequence, then this sequence is expected to contain mapping nodes and each
  // of these nodes is merged in turn according to its order in the sequence.
  // Keys in mapping nodes earlier in the sequence override keys specified in
  // later mapping nodes. -- http://yaml.org/type/merge.html


  _createClass(Merge, [{
    key: "addToJSMap",
    value: function addToJSMap(ctx, map) {
      var _iterator = _createForOfIteratorHelper(this.value.items),
          _step;

      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var source = _step.value.source;
          if (!(source instanceof YAMLMap)) throw new Error('Merge sources must be maps');
          var srcMap = source.toJSON(null, ctx, Map);

          var _iterator2 = _createForOfIteratorHelper(srcMap),
              _step2;

          try {
            for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
              var _step2$value = _slicedToArray(_step2.value, 2),
                  key = _step2$value[0],
                  value = _step2$value[1];

              if (map instanceof Map) {
                if (!map.has(key)) map.set(key, value);
              } else if (map instanceof Set) {
                map.add(key);
              } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
                Object.defineProperty(map, key, {
                  value: value,
                  writable: true,
                  enumerable: true,
                  configurable: true
                });
              }
            }
          } catch (err) {
            _iterator2.e(err);
          } finally {
            _iterator2.f();
          }
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }

      return map;
    }
  }, {
    key: "toString",
    value: function toString(ctx, onComment) {
      var seq = this.value;
      if (seq.items.length > 1) return _get(_getPrototypeOf(Merge.prototype), "toString", this).call(this, ctx, onComment);
      this.value = seq.items[0];

      var str = _get(_getPrototypeOf(Merge.prototype), "toString", this).call(this, ctx, onComment);

      this.value = seq;
      return str;
    }
  }]);

  return Merge;
}(Pair);

var binaryOptions = {
  defaultType: Type.BLOCK_LITERAL,
  lineWidth: 76
};
var boolOptions = {
  trueStr: 'true',
  falseStr: 'false'
};
var intOptions = {
  asBigInt: false
};
var nullOptions = {
  nullStr: 'null'
};
var strOptions = {
  defaultType: Type.PLAIN,
  doubleQuoted: {
    jsonEncoding: false,
    minMultiLineLength: 40
  },
  fold: {
    lineWidth: 80,
    minContentWidth: 20
  }
};

function resolveScalar(str, tags, scalarFallback) {
  var _iterator = _createForOfIteratorHelper(tags),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var _step$value = _step.value,
          format = _step$value.format,
          test = _step$value.test,
          resolve = _step$value.resolve;

      if (test) {
        var match = str.match(test);

        if (match) {
          var res = resolve.apply(null, match);
          if (!(res instanceof Scalar)) res = new Scalar(res);
          if (format) res.format = format;
          return res;
        }
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  if (scalarFallback) str = scalarFallback(str);
  return new Scalar(str);
}

var FOLD_FLOW = 'flow';
var FOLD_BLOCK = 'block';
var FOLD_QUOTED = 'quoted'; // presumes i+1 is at the start of a line
// returns index of last newline in more-indented block

var consumeMoreIndentedLines = function consumeMoreIndentedLines(text, i) {
  var ch = text[i + 1];

  while (ch === ' ' || ch === '\t') {
    do {
      ch = text[i += 1];
    } while (ch && ch !== '\n');

    ch = text[i + 1];
  }

  return i;
};
/**
 * Tries to keep input at up to `lineWidth` characters, splitting only on spaces
 * not followed by newlines or spaces unless `mode` is `'quoted'`. Lines are
 * terminated with `\n` and started with `indent`.
 *
 * @param {string} text
 * @param {string} indent
 * @param {string} [mode='flow'] `'block'` prevents more-indented lines
 *   from being folded; `'quoted'` allows for `\` escapes, including escaped
 *   newlines
 * @param {Object} options
 * @param {number} [options.indentAtStart] Accounts for leading contents on
 *   the first line, defaulting to `indent.length`
 * @param {number} [options.lineWidth=80]
 * @param {number} [options.minContentWidth=20] Allow highly indented lines to
 *   stretch the line width or indent content from the start
 * @param {function} options.onFold Called once if the text is folded
 * @param {function} options.onFold Called once if any line of text exceeds
 *   lineWidth characters
 */


function foldFlowLines(text, indent, mode, _ref) {
  var indentAtStart = _ref.indentAtStart,
      _ref$lineWidth = _ref.lineWidth,
      lineWidth = _ref$lineWidth === void 0 ? 80 : _ref$lineWidth,
      _ref$minContentWidth = _ref.minContentWidth,
      minContentWidth = _ref$minContentWidth === void 0 ? 20 : _ref$minContentWidth,
      onFold = _ref.onFold,
      onOverflow = _ref.onOverflow;
  if (!lineWidth || lineWidth < 0) return text;
  var endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
  if (text.length <= endStep) return text;
  var folds = [];
  var escapedFolds = {};
  var end = lineWidth - indent.length;

  if (typeof indentAtStart === 'number') {
    if (indentAtStart > lineWidth - Math.max(2, minContentWidth)) folds.push(0);else end = lineWidth - indentAtStart;
  }

  var split = undefined;
  var prev = undefined;
  var overflow = false;
  var i = -1;
  var escStart = -1;
  var escEnd = -1;

  if (mode === FOLD_BLOCK) {
    i = consumeMoreIndentedLines(text, i);
    if (i !== -1) end = i + endStep;
  }

  for (var ch; ch = text[i += 1];) {
    if (mode === FOLD_QUOTED && ch === '\\') {
      escStart = i;

      switch (text[i + 1]) {
        case 'x':
          i += 3;
          break;

        case 'u':
          i += 5;
          break;

        case 'U':
          i += 9;
          break;

        default:
          i += 1;
      }

      escEnd = i;
    }

    if (ch === '\n') {
      if (mode === FOLD_BLOCK) i = consumeMoreIndentedLines(text, i);
      end = i + endStep;
      split = undefined;
    } else {
      if (ch === ' ' && prev && prev !== ' ' && prev !== '\n' && prev !== '\t') {
        // space surrounded by non-space can be replaced with newline + indent
        var next = text[i + 1];
        if (next && next !== ' ' && next !== '\n' && next !== '\t') split = i;
      }

      if (i >= end) {
        if (split) {
          folds.push(split);
          end = split + endStep;
          split = undefined;
        } else if (mode === FOLD_QUOTED) {
          // white-space collected at end may stretch past lineWidth
          while (prev === ' ' || prev === '\t') {
            prev = ch;
            ch = text[i += 1];
            overflow = true;
          } // Account for newline escape, but don't break preceding escape


          var j = i > escEnd + 1 ? i - 2 : escStart - 1; // Bail out if lineWidth & minContentWidth are shorter than an escape string

          if (escapedFolds[j]) return text;
          folds.push(j);
          escapedFolds[j] = true;
          end = j + endStep;
          split = undefined;
        } else {
          overflow = true;
        }
      }
    }

    prev = ch;
  }

  if (overflow && onOverflow) onOverflow();
  if (folds.length === 0) return text;
  if (onFold) onFold();
  var res = text.slice(0, folds[0]);

  for (var _i = 0; _i < folds.length; ++_i) {
    var fold = folds[_i];

    var _end = folds[_i + 1] || text.length;

    if (fold === 0) res = "\n".concat(indent).concat(text.slice(0, _end));else {
      if (mode === FOLD_QUOTED && escapedFolds[fold]) res += "".concat(text[fold], "\\");
      res += "\n".concat(indent).concat(text.slice(fold + 1, _end));
    }
  }

  return res;
}

var getFoldOptions = function getFoldOptions(_ref) {
  var indentAtStart = _ref.indentAtStart;
  return indentAtStart ? Object.assign({
    indentAtStart: indentAtStart
  }, strOptions.fold) : strOptions.fold;
}; // Also checks for lines starting with %, as parsing the output as YAML 1.1 will
// presume that's starting a new document.


var containsDocumentMarker = function containsDocumentMarker(str) {
  return /^(%|---|\.\.\.)/m.test(str);
};

function lineLengthOverLimit(str, lineWidth, indentLength) {
  if (!lineWidth || lineWidth < 0) return false;
  var limit = lineWidth - indentLength;
  var strLen = str.length;
  if (strLen <= limit) return false;

  for (var i = 0, start = 0; i < strLen; ++i) {
    if (str[i] === '\n') {
      if (i - start > limit) return true;
      start = i + 1;
      if (strLen - start <= limit) return false;
    }
  }

  return true;
}

function doubleQuotedString(value, ctx) {
  var implicitKey = ctx.implicitKey;
  var _strOptions$doubleQuo = strOptions.doubleQuoted,
      jsonEncoding = _strOptions$doubleQuo.jsonEncoding,
      minMultiLineLength = _strOptions$doubleQuo.minMultiLineLength;
  var json = JSON.stringify(value);
  if (jsonEncoding) return json;
  var indent = ctx.indent || (containsDocumentMarker(value) ? '  ' : '');
  var str = '';
  var start = 0;

  for (var i = 0, ch = json[i]; ch; ch = json[++i]) {
    if (ch === ' ' && json[i + 1] === '\\' && json[i + 2] === 'n') {
      // space before newline needs to be escaped to not be folded
      str += json.slice(start, i) + '\\ ';
      i += 1;
      start = i;
      ch = '\\';
    }

    if (ch === '\\') switch (json[i + 1]) {
      case 'u':
        {
          str += json.slice(start, i);
          var code = json.substr(i + 2, 4);

          switch (code) {
            case '0000':
              str += '\\0';
              break;

            case '0007':
              str += '\\a';
              break;

            case '000b':
              str += '\\v';
              break;

            case '001b':
              str += '\\e';
              break;

            case '0085':
              str += '\\N';
              break;

            case '00a0':
              str += '\\_';
              break;

            case '2028':
              str += '\\L';
              break;

            case '2029':
              str += '\\P';
              break;

            default:
              if (code.substr(0, 2) === '00') str += '\\x' + code.substr(2);else str += json.substr(i, 6);
          }

          i += 5;
          start = i + 1;
        }
        break;

      case 'n':
        if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
          i += 1;
        } else {
          // folding will eat first newline
          str += json.slice(start, i) + '\n\n';

          while (json[i + 2] === '\\' && json[i + 3] === 'n' && json[i + 4] !== '"') {
            str += '\n';
            i += 2;
          }

          str += indent; // space after newline needs to be escaped to not be folded

          if (json[i + 2] === ' ') str += '\\';
          i += 1;
          start = i + 1;
        }

        break;

      default:
        i += 1;
    }
  }

  str = start ? str + json.slice(start) : json;
  return implicitKey ? str : foldFlowLines(str, indent, FOLD_QUOTED, getFoldOptions(ctx));
}

function singleQuotedString(value, ctx) {
  if (ctx.implicitKey) {
    if (/\n/.test(value)) return doubleQuotedString(value, ctx);
  } else {
    // single quoted string can't have leading or trailing whitespace around newline
    if (/[ \t]\n|\n[ \t]/.test(value)) return doubleQuotedString(value, ctx);
  }

  var indent = ctx.indent || (containsDocumentMarker(value) ? '  ' : '');
  var res = "'" + value.replace(/'/g, "''").replace(/\n+/g, "$&\n".concat(indent)) + "'";
  return ctx.implicitKey ? res : foldFlowLines(res, indent, FOLD_FLOW, getFoldOptions(ctx));
}

function blockString(_ref2, ctx, onComment, onChompKeep) {
  var comment = _ref2.comment,
      type = _ref2.type,
      value = _ref2.value;

  // 1. Block can't end in whitespace unless the last line is non-empty.
  // 2. Strings consisting of only whitespace are best rendered explicitly.
  if (/\n[\t ]+$/.test(value) || /^\s*$/.test(value)) {
    return doubleQuotedString(value, ctx);
  }

  var indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? '  ' : '');
  var indentSize = indent ? '2' : '1'; // root is at -1

  var literal = type === Type.BLOCK_FOLDED ? false : type === Type.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, strOptions.fold.lineWidth, indent.length);
  var header = literal ? '|' : '>';
  if (!value) return header + '\n';
  var wsStart = '';
  var wsEnd = '';
  value = value.replace(/[\n\t ]*$/, function (ws) {
    var n = ws.indexOf('\n');

    if (n === -1) {
      header += '-'; // strip
    } else if (value === ws || n !== ws.length - 1) {
      header += '+'; // keep

      if (onChompKeep) onChompKeep();
    }

    wsEnd = ws.replace(/\n$/, '');
    return '';
  }).replace(/^[\n ]*/, function (ws) {
    if (ws.indexOf(' ') !== -1) header += indentSize;
    var m = ws.match(/ +$/);

    if (m) {
      wsStart = ws.slice(0, -m[0].length);
      return m[0];
    } else {
      wsStart = ws;
      return '';
    }
  });
  if (wsEnd) wsEnd = wsEnd.replace(/\n+(?!\n|$)/g, "$&".concat(indent));
  if (wsStart) wsStart = wsStart.replace(/\n+/g, "$&".concat(indent));

  if (comment) {
    header += ' #' + comment.replace(/ ?[\r\n]+/g, ' ');
    if (onComment) onComment();
  }

  if (!value) return "".concat(header).concat(indentSize, "\n").concat(indent).concat(wsEnd);

  if (literal) {
    value = value.replace(/\n+/g, "$&".concat(indent));
    return "".concat(header, "\n").concat(indent).concat(wsStart).concat(value).concat(wsEnd);
  }

  value = value.replace(/\n+/g, '\n$&').replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, '$1$2') // more-indented lines aren't folded
  //         ^ ind.line  ^ empty     ^ capture next empty lines only at end of indent
  .replace(/\n+/g, "$&".concat(indent));
  var body = foldFlowLines("".concat(wsStart).concat(value).concat(wsEnd), indent, FOLD_BLOCK, strOptions.fold);
  return "".concat(header, "\n").concat(indent).concat(body);
}

function plainString(item, ctx, onComment, onChompKeep) {
  var comment = item.comment,
      type = item.type,
      value = item.value;
  var actualString = ctx.actualString,
      implicitKey = ctx.implicitKey,
      indent = ctx.indent,
      inFlow = ctx.inFlow;

  if (implicitKey && /[\n[\]{},]/.test(value) || inFlow && /[[\]{},]/.test(value)) {
    return doubleQuotedString(value, ctx);
  }

  if (!value || /^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
    // not allowed:
    // - empty string, '-' or '?'
    // - start with an indicator character (except [?:-]) or /[?-] /
    // - '\n ', ': ' or ' \n' anywhere
    // - '#' not preceded by a non-space char
    // - end with ' ' or ':'
    return implicitKey || inFlow || value.indexOf('\n') === -1 ? value.indexOf('"') !== -1 && value.indexOf("'") === -1 ? singleQuotedString(value, ctx) : doubleQuotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
  }

  if (!implicitKey && !inFlow && type !== Type.PLAIN && value.indexOf('\n') !== -1) {
    // Where allowed & type not set explicitly, prefer block style for multiline strings
    return blockString(item, ctx, onComment, onChompKeep);
  }

  if (indent === '' && containsDocumentMarker(value)) {
    ctx.forceBlockIndent = true;
    return blockString(item, ctx, onComment, onChompKeep);
  }

  var str = value.replace(/\n+/g, "$&\n".concat(indent)); // Verify that output will be parsed as a string, as e.g. plain numbers and
  // booleans get parsed with those types in v1.2 (e.g. '42', 'true' & '0.9e-3'),
  // and others in v1.1.

  if (actualString) {
    var tags = ctx.doc.schema.tags;
    var resolved = resolveScalar(str, tags, tags.scalarFallback).value;
    if (typeof resolved !== 'string') return doubleQuotedString(value, ctx);
  }

  var body = implicitKey ? str : foldFlowLines(str, indent, FOLD_FLOW, getFoldOptions(ctx));

  if (comment && !inFlow && (body.indexOf('\n') !== -1 || comment.indexOf('\n') !== -1)) {
    if (onComment) onComment();
    return addCommentBefore(body, indent, comment);
  }

  return body;
}

function stringifyString(item, ctx, onComment, onChompKeep) {
  var defaultType = strOptions.defaultType;
  var implicitKey = ctx.implicitKey,
      inFlow = ctx.inFlow;
  var _item = item,
      type = _item.type,
      value = _item.value;

  if (typeof value !== 'string') {
    value = String(value);
    item = Object.assign({}, item, {
      value: value
    });
  }

  var _stringify = function _stringify(_type) {
    switch (_type) {
      case Type.BLOCK_FOLDED:
      case Type.BLOCK_LITERAL:
        return blockString(item, ctx, onComment, onChompKeep);

      case Type.QUOTE_DOUBLE:
        return doubleQuotedString(value, ctx);

      case Type.QUOTE_SINGLE:
        return singleQuotedString(value, ctx);

      case Type.PLAIN:
        return plainString(item, ctx, onComment, onChompKeep);

      default:
        return null;
    }
  };

  if (type !== Type.QUOTE_DOUBLE && /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(value)) {
    // force double quotes on control characters
    type = Type.QUOTE_DOUBLE;
  } else if ((implicitKey || inFlow) && (type === Type.BLOCK_FOLDED || type === Type.BLOCK_LITERAL)) {
    // should not happen; blocks are not valid inside flow containers
    type = Type.QUOTE_DOUBLE;
  }

  var res = _stringify(type);

  if (res === null) {
    res = _stringify(defaultType);
    if (res === null) throw new Error("Unsupported default string type ".concat(defaultType));
  }

  return res;
}

function stringifyNumber(_ref) {
  var format = _ref.format,
      minFractionDigits = _ref.minFractionDigits,
      tag = _ref.tag,
      value = _ref.value;
  if (typeof value === 'bigint') return String(value);
  if (!isFinite(value)) return isNaN(value) ? '.nan' : value < 0 ? '-.inf' : '.inf';
  var n = JSON.stringify(value);

  if (!format && minFractionDigits && (!tag || tag === 'tag:yaml.org,2002:float') && /^\d/.test(n)) {
    var i = n.indexOf('.');

    if (i < 0) {
      i = n.length;
      n += '.';
    }

    var d = minFractionDigits - (n.length - i - 1);

    while (d-- > 0) {
      n += '0';
    }
  }

  return n;
}

function checkFlowCollectionEnd(errors, cst) {
  var char, name;

  switch (cst.type) {
    case Type.FLOW_MAP:
      char = '}';
      name = 'flow map';
      break;

    case Type.FLOW_SEQ:
      char = ']';
      name = 'flow sequence';
      break;

    default:
      errors.push(new YAMLSemanticError(cst, 'Not a flow collection!?'));
      return;
  }

  var lastItem;

  for (var i = cst.items.length - 1; i >= 0; --i) {
    var item = cst.items[i];

    if (!item || item.type !== Type.COMMENT) {
      lastItem = item;
      break;
    }
  }

  if (lastItem && lastItem.char !== char) {
    var msg = "Expected ".concat(name, " to end with ").concat(char);
    var err;

    if (typeof lastItem.offset === 'number') {
      err = new YAMLSemanticError(cst, msg);
      err.offset = lastItem.offset + 1;
    } else {
      err = new YAMLSemanticError(lastItem, msg);
      if (lastItem.range && lastItem.range.end) err.offset = lastItem.range.end - lastItem.range.start;
    }

    errors.push(err);
  }
}
function checkFlowCommentSpace(errors, comment) {
  var prev = comment.context.src[comment.range.start - 1];

  if (prev !== '\n' && prev !== '\t' && prev !== ' ') {
    var msg = 'Comments must be separated from other tokens by white space characters';
    errors.push(new YAMLSemanticError(comment, msg));
  }
}
function getLongKeyError(source, key) {
  var sk = String(key);
  var k = sk.substr(0, 8) + '...' + sk.substr(-8);
  return new YAMLSemanticError(source, "The \"".concat(k, "\" key is too long"));
}
function resolveComments(collection, comments) {
  var _iterator = _createForOfIteratorHelper(comments),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var _step$value = _step.value,
          afterKey = _step$value.afterKey,
          before = _step$value.before,
          comment = _step$value.comment;
      var item = collection.items[before];

      if (!item) {
        if (comment !== undefined) {
          if (collection.comment) collection.comment += '\n' + comment;else collection.comment = comment;
        }
      } else {
        if (afterKey && item.value) item = item.value;

        if (comment === undefined) {
          if (afterKey || !item.commentBefore) item.spaceBefore = true;
        } else {
          if (item.commentBefore) item.commentBefore += '\n' + comment;else item.commentBefore = comment;
        }
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
}

// on error, will return { str: string, errors: Error[] }
function resolveString(doc, node) {
  var res = node.strValue;
  if (!res) return '';
  if (typeof res === 'string') return res;
  res.errors.forEach(function (error) {
    if (!error.source) error.source = node;
    doc.errors.push(error);
  });
  return res.str;
}

function resolveTagHandle(doc, node) {
  var _node$tag = node.tag,
      handle = _node$tag.handle,
      suffix = _node$tag.suffix;
  var prefix = doc.tagPrefixes.find(function (p) {
    return p.handle === handle;
  });

  if (!prefix) {
    var dtp = doc.getDefaults().tagPrefixes;
    if (dtp) prefix = dtp.find(function (p) {
      return p.handle === handle;
    });
    if (!prefix) throw new YAMLSemanticError(node, "The ".concat(handle, " tag handle is non-default and was not declared."));
  }

  if (!suffix) throw new YAMLSemanticError(node, "The ".concat(handle, " tag has no suffix."));

  if (handle === '!' && (doc.version || doc.options.version) === '1.0') {
    if (suffix[0] === '^') {
      doc.warnings.push(new YAMLWarning(node, 'YAML 1.0 ^ tag expansion is not supported'));
      return suffix;
    }

    if (/[:/]/.test(suffix)) {
      // word/foo -> tag:word.yaml.org,2002:foo
      var vocab = suffix.match(/^([a-z0-9-]+)\/(.*)/i);
      return vocab ? "tag:".concat(vocab[1], ".yaml.org,2002:").concat(vocab[2]) : "tag:".concat(suffix);
    }
  }

  return prefix.prefix + decodeURIComponent(suffix);
}

function resolveTagName(doc, node) {
  var tag = node.tag,
      type = node.type;
  var nonSpecific = false;

  if (tag) {
    var handle = tag.handle,
        suffix = tag.suffix,
        verbatim = tag.verbatim;

    if (verbatim) {
      if (verbatim !== '!' && verbatim !== '!!') return verbatim;
      var msg = "Verbatim tags aren't resolved, so ".concat(verbatim, " is invalid.");
      doc.errors.push(new YAMLSemanticError(node, msg));
    } else if (handle === '!' && !suffix) {
      nonSpecific = true;
    } else {
      try {
        return resolveTagHandle(doc, node);
      } catch (error) {
        doc.errors.push(error);
      }
    }
  }

  switch (type) {
    case Type.BLOCK_FOLDED:
    case Type.BLOCK_LITERAL:
    case Type.QUOTE_DOUBLE:
    case Type.QUOTE_SINGLE:
      return defaultTags.STR;

    case Type.FLOW_MAP:
    case Type.MAP:
      return defaultTags.MAP;

    case Type.FLOW_SEQ:
    case Type.SEQ:
      return defaultTags.SEQ;

    case Type.PLAIN:
      return nonSpecific ? defaultTags.STR : null;

    default:
      return null;
  }
}

function resolveByTagName(doc, node, tagName) {
  var tags = doc.schema.tags;
  var matchWithTest = [];

  var _iterator = _createForOfIteratorHelper(tags),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var tag = _step.value;

      if (tag.tag === tagName) {
        if (tag.test) matchWithTest.push(tag);else {
          var res = tag.resolve(doc, node);
          return res instanceof resolveSeq_492ab440_Collection ? res : new Scalar(res);
        }
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  var str = resolveString(doc, node);
  if (typeof str === 'string' && matchWithTest.length > 0) return resolveScalar(str, matchWithTest, tags.scalarFallback);
  return null;
}

function getFallbackTagName(_ref) {
  var type = _ref.type;

  switch (type) {
    case Type.FLOW_MAP:
    case Type.MAP:
      return defaultTags.MAP;

    case Type.FLOW_SEQ:
    case Type.SEQ:
      return defaultTags.SEQ;

    default:
      return defaultTags.STR;
  }
}

function resolveTag(doc, node, tagName) {
  try {
    var res = resolveByTagName(doc, node, tagName);

    if (res) {
      if (tagName && node.tag) res.tag = tagName;
      return res;
    }
  } catch (error) {
    /* istanbul ignore if */
    if (!error.source) error.source = node;
    doc.errors.push(error);
    return null;
  }

  try {
    var fallback = getFallbackTagName(node);
    if (!fallback) throw new Error("The tag ".concat(tagName, " is unavailable"));
    var msg = "The tag ".concat(tagName, " is unavailable, falling back to ").concat(fallback);
    doc.warnings.push(new YAMLWarning(node, msg));

    var _res = resolveByTagName(doc, node, fallback);

    _res.tag = tagName;
    return _res;
  } catch (error) {
    var refError = new YAMLReferenceError(node, error.message);
    refError.stack = error.stack;
    doc.errors.push(refError);
    return null;
  }
}

var isCollectionItem = function isCollectionItem(node) {
  if (!node) return false;
  var type = node.type;
  return type === Type.MAP_KEY || type === Type.MAP_VALUE || type === Type.SEQ_ITEM;
};

function resolveNodeProps(errors, node) {
  var comments = {
    before: [],
    after: []
  };
  var hasAnchor = false;
  var hasTag = false;
  var props = isCollectionItem(node.context.parent) ? node.context.parent.props.concat(node.props) : node.props;

  var _iterator = _createForOfIteratorHelper(props),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var _step$value = _step.value,
          start = _step$value.start,
          end = _step$value.end;

      switch (node.context.src[start]) {
        case Char.COMMENT:
          {
            if (!node.commentHasRequiredWhitespace(start)) {
              var msg = 'Comments must be separated from other tokens by white space characters';
              errors.push(new YAMLSemanticError(node, msg));
            }

            var header = node.header,
                valueRange = node.valueRange;
            var cc = valueRange && (start > valueRange.start || header && start > header.start) ? comments.after : comments.before;
            cc.push(node.context.src.slice(start + 1, end));
            break;
          }
        // Actual anchor & tag resolution is handled by schema, here we just complain

        case Char.ANCHOR:
          if (hasAnchor) {
            var _msg = 'A node can have at most one anchor';
            errors.push(new YAMLSemanticError(node, _msg));
          }

          hasAnchor = true;
          break;

        case Char.TAG:
          if (hasTag) {
            var _msg2 = 'A node can have at most one tag';
            errors.push(new YAMLSemanticError(node, _msg2));
          }

          hasTag = true;
          break;
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  return {
    comments: comments,
    hasAnchor: hasAnchor,
    hasTag: hasTag
  };
}

function resolveNodeValue(doc, node) {
  var anchors = doc.anchors,
      errors = doc.errors,
      schema = doc.schema;

  if (node.type === Type.ALIAS) {
    var name = node.rawValue;
    var src = anchors.getNode(name);

    if (!src) {
      var msg = "Aliased anchor not found: ".concat(name);
      errors.push(new YAMLReferenceError(node, msg));
      return null;
    } // Lazy resolution for circular references


    var res = new resolveSeq_492ab440_Alias(src);

    anchors._cstAliases.push(res);

    return res;
  }

  var tagName = resolveTagName(doc, node);
  if (tagName) return resolveTag(doc, node, tagName);

  if (node.type !== Type.PLAIN) {
    var _msg3 = "Failed to resolve ".concat(node.type, " node here");

    errors.push(new YAMLSyntaxError(node, _msg3));
    return null;
  }

  try {
    var str = resolveString(doc, node);
    return resolveScalar(str, schema.tags, schema.tags.scalarFallback);
  } catch (error) {
    if (!error.source) error.source = node;
    errors.push(error);
    return null;
  }
} // sets node.resolved on success


function resolveNode(doc, node) {
  if (!node) return null;
  if (node.error) doc.errors.push(node.error);

  var _resolveNodeProps = resolveNodeProps(doc.errors, node),
      comments = _resolveNodeProps.comments,
      hasAnchor = _resolveNodeProps.hasAnchor,
      hasTag = _resolveNodeProps.hasTag;

  if (hasAnchor) {
    var anchors = doc.anchors;
    var name = node.anchor;
    var prev = anchors.getNode(name); // At this point, aliases for any preceding node with the same anchor
    // name have already been resolved, so it may safely be renamed.

    if (prev) anchors.map[anchors.newName(name)] = prev; // During parsing, we need to store the CST node in anchors.map as
    // anchors need to be available during resolution to allow for
    // circular references.

    anchors.map[name] = node;
  }

  if (node.type === Type.ALIAS && (hasAnchor || hasTag)) {
    var msg = 'An alias node must not specify any properties';
    doc.errors.push(new YAMLSemanticError(node, msg));
  }

  var res = resolveNodeValue(doc, node);

  if (res) {
    res.range = [node.range.start, node.range.end];
    if (doc.options.keepCstNodes) res.cstNode = node;
    if (doc.options.keepNodeTypes) res.type = node.type;
    var cb = comments.before.join('\n');

    if (cb) {
      res.commentBefore = res.commentBefore ? "".concat(res.commentBefore, "\n").concat(cb) : cb;
    }

    var ca = comments.after.join('\n');
    if (ca) res.comment = res.comment ? "".concat(res.comment, "\n").concat(ca) : ca;
  }

  return node.resolved = res;
}

function resolveMap(doc, cst) {
  if (cst.type !== Type.MAP && cst.type !== Type.FLOW_MAP) {
    var msg = "A ".concat(cst.type, " node cannot be resolved as a mapping");
    doc.errors.push(new YAMLSyntaxError(cst, msg));
    return null;
  }

  var _ref = cst.type === Type.FLOW_MAP ? resolveFlowMapItems(doc, cst) : resolveBlockMapItems(doc, cst),
      comments = _ref.comments,
      items = _ref.items;

  var map = new YAMLMap();
  map.items = items;
  resolveComments(map, comments);
  var hasCollectionKey = false;

  for (var i = 0; i < items.length; ++i) {
    var iKey = items[i].key;
    if (iKey instanceof resolveSeq_492ab440_Collection) hasCollectionKey = true;

    if (doc.schema.merge && iKey && iKey.value === MERGE_KEY) {
      items[i] = new Merge(items[i]);
      var sources = items[i].value.items;
      var error = null;
      sources.some(function (node) {
        if (node instanceof resolveSeq_492ab440_Alias) {
          // During parsing, alias sources are CST nodes; to account for
          // circular references their resolved values can't be used here.
          var type = node.source.type;
          if (type === Type.MAP || type === Type.FLOW_MAP) return false;
          return error = 'Merge nodes aliases can only point to maps';
        }

        return error = 'Merge nodes can only have Alias nodes as values';
      });
      if (error) doc.errors.push(new YAMLSemanticError(cst, error));
    } else {
      for (var j = i + 1; j < items.length; ++j) {
        var jKey = items[j].key;

        if (iKey === jKey || iKey && jKey && Object.prototype.hasOwnProperty.call(iKey, 'value') && iKey.value === jKey.value) {
          var _msg = "Map keys must be unique; \"".concat(iKey, "\" is repeated");

          doc.errors.push(new YAMLSemanticError(cst, _msg));
          break;
        }
      }
    }
  }

  if (hasCollectionKey && !doc.options.mapAsMap) {
    var warn = 'Keys with collection values will be stringified as YAML due to JS Object restrictions. Use mapAsMap: true to avoid this.';
    doc.warnings.push(new YAMLWarning(cst, warn));
  }

  cst.resolved = map;
  return map;
}

var valueHasPairComment = function valueHasPairComment(_ref2) {
  var _ref2$context = _ref2.context,
      lineStart = _ref2$context.lineStart,
      node = _ref2$context.node,
      src = _ref2$context.src,
      props = _ref2.props;
  if (props.length === 0) return false;
  var start = props[0].start;
  if (node && start > node.valueRange.start) return false;
  if (src[start] !== Char.COMMENT) return false;

  for (var i = lineStart; i < start; ++i) {
    if (src[i] === '\n') return false;
  }

  return true;
};

function resolvePairComment(item, pair) {
  if (!valueHasPairComment(item)) return;
  var comment = item.getPropValue(0, Char.COMMENT, true);
  var found = false;
  var cb = pair.value.commentBefore;

  if (cb && cb.startsWith(comment)) {
    pair.value.commentBefore = cb.substr(comment.length + 1);
    found = true;
  } else {
    var cc = pair.value.comment;

    if (!item.node && cc && cc.startsWith(comment)) {
      pair.value.comment = cc.substr(comment.length + 1);
      found = true;
    }
  }

  if (found) pair.comment = comment;
}

function resolveBlockMapItems(doc, cst) {
  var comments = [];
  var items = [];
  var key = undefined;
  var keyStart = null;

  for (var i = 0; i < cst.items.length; ++i) {
    var item = cst.items[i];

    switch (item.type) {
      case Type.BLANK_LINE:
        comments.push({
          afterKey: !!key,
          before: items.length
        });
        break;

      case Type.COMMENT:
        comments.push({
          afterKey: !!key,
          before: items.length,
          comment: item.comment
        });
        break;

      case Type.MAP_KEY:
        if (key !== undefined) items.push(new Pair(key));
        if (item.error) doc.errors.push(item.error);
        key = resolveNode(doc, item.node);
        keyStart = null;
        break;

      case Type.MAP_VALUE:
        {
          if (key === undefined) key = null;
          if (item.error) doc.errors.push(item.error);

          if (!item.context.atLineStart && item.node && item.node.type === Type.MAP && !item.node.context.atLineStart) {
            var msg = 'Nested mappings are not allowed in compact mappings';
            doc.errors.push(new YAMLSemanticError(item.node, msg));
          }

          var valueNode = item.node;

          if (!valueNode && item.props.length > 0) {
            // Comments on an empty mapping value need to be preserved, so we
            // need to construct a minimal empty node here to use instead of the
            // missing `item.node`. -- eemeli/yaml#19
            valueNode = new PlainValue(Type.PLAIN, []);
            valueNode.context = {
              parent: item,
              src: item.context.src
            };
            var pos = item.range.start + 1;
            valueNode.range = {
              start: pos,
              end: pos
            };
            valueNode.valueRange = {
              start: pos,
              end: pos
            };

            if (typeof item.range.origStart === 'number') {
              var origPos = item.range.origStart + 1;
              valueNode.range.origStart = valueNode.range.origEnd = origPos;
              valueNode.valueRange.origStart = valueNode.valueRange.origEnd = origPos;
            }
          }

          var pair = new Pair(key, resolveNode(doc, valueNode));
          resolvePairComment(item, pair);
          items.push(pair);

          if (key && typeof keyStart === 'number') {
            if (item.range.start > keyStart + 1024) doc.errors.push(getLongKeyError(cst, key));
          }

          key = undefined;
          keyStart = null;
        }
        break;

      default:
        if (key !== undefined) items.push(new Pair(key));
        key = resolveNode(doc, item);
        keyStart = item.range.start;
        if (item.error) doc.errors.push(item.error);

        next: for (var j = i + 1;; ++j) {
          var nextItem = cst.items[j];

          switch (nextItem && nextItem.type) {
            case Type.BLANK_LINE:
            case Type.COMMENT:
              continue next;

            case Type.MAP_VALUE:
              break next;

            default:
              {
                var _msg2 = 'Implicit map keys need to be followed by map values';
                doc.errors.push(new YAMLSemanticError(item, _msg2));
                break next;
              }
          }
        }

        if (item.valueRangeContainsNewline) {
          var _msg3 = 'Implicit map keys need to be on a single line';
          doc.errors.push(new YAMLSemanticError(item, _msg3));
        }

    }
  }

  if (key !== undefined) items.push(new Pair(key));
  return {
    comments: comments,
    items: items
  };
}

function resolveFlowMapItems(doc, cst) {
  var comments = [];
  var items = [];
  var key = undefined;
  var explicitKey = false;
  var next = '{';

  for (var i = 0; i < cst.items.length; ++i) {
    var item = cst.items[i];

    if (typeof item.char === 'string') {
      var char = item.char,
          offset = item.offset;

      if (char === '?' && key === undefined && !explicitKey) {
        explicitKey = true;
        next = ':';
        continue;
      }

      if (char === ':') {
        if (key === undefined) key = null;

        if (next === ':') {
          next = ',';
          continue;
        }
      } else {
        if (explicitKey) {
          if (key === undefined && char !== ',') key = null;
          explicitKey = false;
        }

        if (key !== undefined) {
          items.push(new Pair(key));
          key = undefined;

          if (char === ',') {
            next = ':';
            continue;
          }
        }
      }

      if (char === '}') {
        if (i === cst.items.length - 1) continue;
      } else if (char === next) {
        next = ':';
        continue;
      }

      var msg = "Flow map contains an unexpected ".concat(char);
      var err = new YAMLSyntaxError(cst, msg);
      err.offset = offset;
      doc.errors.push(err);
    } else if (item.type === Type.BLANK_LINE) {
      comments.push({
        afterKey: !!key,
        before: items.length
      });
    } else if (item.type === Type.COMMENT) {
      checkFlowCommentSpace(doc.errors, item);
      comments.push({
        afterKey: !!key,
        before: items.length,
        comment: item.comment
      });
    } else if (key === undefined) {
      if (next === ',') doc.errors.push(new YAMLSemanticError(item, 'Separator , missing in flow map'));
      key = resolveNode(doc, item);
    } else {
      if (next !== ',') doc.errors.push(new YAMLSemanticError(item, 'Indicator : missing in flow map entry'));
      items.push(new Pair(key, resolveNode(doc, item)));
      key = undefined;
      explicitKey = false;
    }
  }

  checkFlowCollectionEnd(doc.errors, cst);
  if (key !== undefined) items.push(new Pair(key));
  return {
    comments: comments,
    items: items
  };
}

function resolveSeq(doc, cst) {
  if (cst.type !== Type.SEQ && cst.type !== Type.FLOW_SEQ) {
    var msg = "A ".concat(cst.type, " node cannot be resolved as a sequence");
    doc.errors.push(new YAMLSyntaxError(cst, msg));
    return null;
  }

  var _ref = cst.type === Type.FLOW_SEQ ? resolveFlowSeqItems(doc, cst) : resolveBlockSeqItems(doc, cst),
      comments = _ref.comments,
      items = _ref.items;

  var seq = new YAMLSeq();
  seq.items = items;
  resolveComments(seq, comments);

  if (!doc.options.mapAsMap && items.some(function (it) {
    return it instanceof Pair && it.key instanceof resolveSeq_492ab440_Collection;
  })) {
    var warn = 'Keys with collection values will be stringified as YAML due to JS Object restrictions. Use mapAsMap: true to avoid this.';
    doc.warnings.push(new YAMLWarning(cst, warn));
  }

  cst.resolved = seq;
  return seq;
}

function resolveBlockSeqItems(doc, cst) {
  var comments = [];
  var items = [];

  for (var i = 0; i < cst.items.length; ++i) {
    var item = cst.items[i];

    switch (item.type) {
      case Type.BLANK_LINE:
        comments.push({
          before: items.length
        });
        break;

      case Type.COMMENT:
        comments.push({
          comment: item.comment,
          before: items.length
        });
        break;

      case Type.SEQ_ITEM:
        if (item.error) doc.errors.push(item.error);
        items.push(resolveNode(doc, item.node));

        if (item.hasProps) {
          var msg = 'Sequence items cannot have tags or anchors before the - indicator';
          doc.errors.push(new YAMLSemanticError(item, msg));
        }

        break;

      default:
        if (item.error) doc.errors.push(item.error);
        doc.errors.push(new YAMLSyntaxError(item, "Unexpected ".concat(item.type, " node in sequence")));
    }
  }

  return {
    comments: comments,
    items: items
  };
}

function resolveFlowSeqItems(doc, cst) {
  var comments = [];
  var items = [];
  var explicitKey = false;
  var key = undefined;
  var keyStart = null;
  var next = '[';
  var prevItem = null;

  for (var i = 0; i < cst.items.length; ++i) {
    var item = cst.items[i];

    if (typeof item.char === 'string') {
      var char = item.char,
          offset = item.offset;

      if (char !== ':' && (explicitKey || key !== undefined)) {
        if (explicitKey && key === undefined) key = next ? items.pop() : null;
        items.push(new Pair(key));
        explicitKey = false;
        key = undefined;
        keyStart = null;
      }

      if (char === next) {
        next = null;
      } else if (!next && char === '?') {
        explicitKey = true;
      } else if (next !== '[' && char === ':' && key === undefined) {
        if (next === ',') {
          key = items.pop();

          if (key instanceof Pair) {
            var msg = 'Chaining flow sequence pairs is invalid';
            var err = new YAMLSemanticError(cst, msg);
            err.offset = offset;
            doc.errors.push(err);
          }

          if (!explicitKey && typeof keyStart === 'number') {
            var keyEnd = item.range ? item.range.start : item.offset;
            if (keyEnd > keyStart + 1024) doc.errors.push(getLongKeyError(cst, key));
            var src = prevItem.context.src;

            for (var _i = keyStart; _i < keyEnd; ++_i) {
              if (src[_i] === '\n') {
                var _msg = 'Implicit keys of flow sequence pairs need to be on a single line';
                doc.errors.push(new YAMLSemanticError(prevItem, _msg));
                break;
              }
            }
          }
        } else {
          key = null;
        }

        keyStart = null;
        explicitKey = false;
        next = null;
      } else if (next === '[' || char !== ']' || i < cst.items.length - 1) {
        var _msg2 = "Flow sequence contains an unexpected ".concat(char);

        var _err = new YAMLSyntaxError(cst, _msg2);

        _err.offset = offset;
        doc.errors.push(_err);
      }
    } else if (item.type === Type.BLANK_LINE) {
      comments.push({
        before: items.length
      });
    } else if (item.type === Type.COMMENT) {
      checkFlowCommentSpace(doc.errors, item);
      comments.push({
        comment: item.comment,
        before: items.length
      });
    } else {
      if (next) {
        var _msg3 = "Expected a ".concat(next, " in flow sequence");

        doc.errors.push(new YAMLSemanticError(item, _msg3));
      }

      var value = resolveNode(doc, item);

      if (key === undefined) {
        items.push(value);
        prevItem = item;
      } else {
        items.push(new Pair(key, value));
        key = undefined;
      }

      keyStart = item.range.start;
      next = ',';
    }
  }

  checkFlowCollectionEnd(doc.errors, cst);
  if (key !== undefined) items.push(new Pair(key));
  return {
    comments: comments,
    items: items
  };
}



;// ./node_modules/yaml/browser/dist/warnings-df54cb69.js



/* global atob, btoa, Buffer */
var binary = {
  identify: function identify(value) {
    return value instanceof Uint8Array;
  },
  // Buffer inherits from Uint8Array
  default: false,
  tag: 'tag:yaml.org,2002:binary',

  /**
   * Returns a Buffer in node and an Uint8Array in browsers
   *
   * To use the resulting buffer as an image, you'll want to do something like:
   *
   *   const blob = new Blob([buffer], { type: 'image/jpeg' })
   *   document.querySelector('#photo').src = URL.createObjectURL(blob)
   */
  resolve: function resolve(doc, node) {
    var src = resolveString(doc, node);

    if (typeof Buffer === 'function') {
      return Buffer.from(src, 'base64');
    } else if (typeof atob === 'function') {
      // On IE 11, atob() can't handle newlines
      var str = atob(src.replace(/[\n\r]/g, ''));
      var buffer = new Uint8Array(str.length);

      for (var i = 0; i < str.length; ++i) {
        buffer[i] = str.charCodeAt(i);
      }

      return buffer;
    } else {
      var msg = 'This environment does not support reading binary tags; either Buffer or atob is required';
      doc.errors.push(new YAMLReferenceError(node, msg));
      return null;
    }
  },
  options: binaryOptions,
  stringify: function stringify(_ref, ctx, onComment, onChompKeep) {
    var comment = _ref.comment,
        type = _ref.type,
        value = _ref.value;
    var src;

    if (typeof Buffer === 'function') {
      src = value instanceof Buffer ? value.toString('base64') : Buffer.from(value.buffer).toString('base64');
    } else if (typeof btoa === 'function') {
      var s = '';

      for (var i = 0; i < value.length; ++i) {
        s += String.fromCharCode(value[i]);
      }

      src = btoa(s);
    } else {
      throw new Error('This environment does not support writing binary tags; either Buffer or btoa is required');
    }

    if (!type) type = binaryOptions.defaultType;

    if (type === Type.QUOTE_DOUBLE) {
      value = src;
    } else {
      var lineWidth = binaryOptions.lineWidth;
      var n = Math.ceil(src.length / lineWidth);
      var lines = new Array(n);

      for (var _i = 0, o = 0; _i < n; ++_i, o += lineWidth) {
        lines[_i] = src.substr(o, lineWidth);
      }

      value = lines.join(type === Type.BLOCK_LITERAL ? '\n' : ' ');
    }

    return stringifyString({
      comment: comment,
      type: type,
      value: value
    }, ctx, onComment, onChompKeep);
  }
};

function parsePairs(doc, cst) {
  var seq = resolveSeq(doc, cst);

  for (var i = 0; i < seq.items.length; ++i) {
    var item = seq.items[i];
    if (item instanceof Pair) continue;else if (item instanceof YAMLMap) {
      if (item.items.length > 1) {
        var msg = 'Each pair must have its own sequence indicator';
        throw new YAMLSemanticError(cst, msg);
      }

      var pair = item.items[0] || new Pair();
      if (item.commentBefore) pair.commentBefore = pair.commentBefore ? "".concat(item.commentBefore, "\n").concat(pair.commentBefore) : item.commentBefore;
      if (item.comment) pair.comment = pair.comment ? "".concat(item.comment, "\n").concat(pair.comment) : item.comment;
      item = pair;
    }
    seq.items[i] = item instanceof Pair ? item : new Pair(item);
  }

  return seq;
}
function createPairs(schema, iterable, ctx) {
  var pairs = new YAMLSeq(schema);
  pairs.tag = 'tag:yaml.org,2002:pairs';

  var _iterator = _createForOfIteratorHelper(iterable),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var it = _step.value;
      var key = void 0,
          value = void 0;

      if (Array.isArray(it)) {
        if (it.length === 2) {
          key = it[0];
          value = it[1];
        } else throw new TypeError("Expected [key, value] tuple: ".concat(it));
      } else if (it && it instanceof Object) {
        var keys = Object.keys(it);

        if (keys.length === 1) {
          key = keys[0];
          value = it[key];
        } else throw new TypeError("Expected { key: value } tuple: ".concat(it));
      } else {
        key = it;
      }

      var pair = schema.createPair(key, value, ctx);
      pairs.items.push(pair);
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  return pairs;
}
var pairs = {
  default: false,
  tag: 'tag:yaml.org,2002:pairs',
  resolve: parsePairs,
  createNode: createPairs
};

var YAMLOMap = /*#__PURE__*/function (_YAMLSeq) {
  _inherits(YAMLOMap, _YAMLSeq);

  var _super = _createSuper(YAMLOMap);

  function YAMLOMap() {
    var _this;

    _classCallCheck(this, YAMLOMap);

    _this = _super.call(this);

    _defineProperty(_assertThisInitialized(_this), "add", YAMLMap.prototype.add.bind(_assertThisInitialized(_this)));

    _defineProperty(_assertThisInitialized(_this), "delete", YAMLMap.prototype.delete.bind(_assertThisInitialized(_this)));

    _defineProperty(_assertThisInitialized(_this), "get", YAMLMap.prototype.get.bind(_assertThisInitialized(_this)));

    _defineProperty(_assertThisInitialized(_this), "has", YAMLMap.prototype.has.bind(_assertThisInitialized(_this)));

    _defineProperty(_assertThisInitialized(_this), "set", YAMLMap.prototype.set.bind(_assertThisInitialized(_this)));

    _this.tag = YAMLOMap.tag;
    return _this;
  }

  _createClass(YAMLOMap, [{
    key: "toJSON",
    value: function toJSON$1(_, ctx) {
      var map = new Map();
      if (ctx && ctx.onCreate) ctx.onCreate(map);

      var _iterator = _createForOfIteratorHelper(this.items),
          _step;

      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var pair = _step.value;
          var key = void 0,
              value = void 0;

          if (pair instanceof Pair) {
            key = toJSON(pair.key, '', ctx);
            value = toJSON(pair.value, key, ctx);
          } else {
            key = toJSON(pair, '', ctx);
          }

          if (map.has(key)) throw new Error('Ordered maps must not include duplicate keys');
          map.set(key, value);
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }

      return map;
    }
  }]);

  return YAMLOMap;
}(YAMLSeq);

_defineProperty(YAMLOMap, "tag", 'tag:yaml.org,2002:omap');

function parseOMap(doc, cst) {
  var pairs = parsePairs(doc, cst);
  var seenKeys = [];

  var _iterator2 = _createForOfIteratorHelper(pairs.items),
      _step2;

  try {
    for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
      var key = _step2.value.key;

      if (key instanceof Scalar) {
        if (seenKeys.includes(key.value)) {
          var msg = 'Ordered maps must not include duplicate keys';
          throw new YAMLSemanticError(cst, msg);
        } else {
          seenKeys.push(key.value);
        }
      }
    }
  } catch (err) {
    _iterator2.e(err);
  } finally {
    _iterator2.f();
  }

  return Object.assign(new YAMLOMap(), pairs);
}

function createOMap(schema, iterable, ctx) {
  var pairs = createPairs(schema, iterable, ctx);
  var omap = new YAMLOMap();
  omap.items = pairs.items;
  return omap;
}

var omap = {
  identify: function identify(value) {
    return value instanceof Map;
  },
  nodeClass: YAMLOMap,
  default: false,
  tag: 'tag:yaml.org,2002:omap',
  resolve: parseOMap,
  createNode: createOMap
};

var YAMLSet = /*#__PURE__*/function (_YAMLMap) {
  _inherits(YAMLSet, _YAMLMap);

  var _super = _createSuper(YAMLSet);

  function YAMLSet() {
    var _this;

    _classCallCheck(this, YAMLSet);

    _this = _super.call(this);
    _this.tag = YAMLSet.tag;
    return _this;
  }

  _createClass(YAMLSet, [{
    key: "add",
    value: function add(key) {
      var pair = key instanceof Pair ? key : new Pair(key);
      var prev = findPair(this.items, pair.key);
      if (!prev) this.items.push(pair);
    }
  }, {
    key: "get",
    value: function get(key, keepPair) {
      var pair = findPair(this.items, key);
      return !keepPair && pair instanceof Pair ? pair.key instanceof Scalar ? pair.key.value : pair.key : pair;
    }
  }, {
    key: "set",
    value: function set(key, value) {
      if (typeof value !== 'boolean') throw new Error("Expected boolean value for set(key, value) in a YAML set, not ".concat(_typeof(value)));
      var prev = findPair(this.items, key);

      if (prev && !value) {
        this.items.splice(this.items.indexOf(prev), 1);
      } else if (!prev && value) {
        this.items.push(new Pair(key));
      }
    }
  }, {
    key: "toJSON",
    value: function toJSON(_, ctx) {
      return _get(_getPrototypeOf(YAMLSet.prototype), "toJSON", this).call(this, _, ctx, Set);
    }
  }, {
    key: "toString",
    value: function toString(ctx, onComment, onChompKeep) {
      if (!ctx) return JSON.stringify(this);
      if (this.hasAllNullValues()) return _get(_getPrototypeOf(YAMLSet.prototype), "toString", this).call(this, ctx, onComment, onChompKeep);else throw new Error('Set items must all have null values');
    }
  }]);

  return YAMLSet;
}(YAMLMap);

_defineProperty(YAMLSet, "tag", 'tag:yaml.org,2002:set');

function parseSet(doc, cst) {
  var map = resolveMap(doc, cst);
  if (!map.hasAllNullValues()) throw new YAMLSemanticError(cst, 'Set items must all have null values');
  return Object.assign(new YAMLSet(), map);
}

function createSet(schema, iterable, ctx) {
  var set = new YAMLSet();

  var _iterator = _createForOfIteratorHelper(iterable),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var value = _step.value;
      set.items.push(schema.createPair(value, null, ctx));
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  return set;
}

var set = {
  identify: function identify(value) {
    return value instanceof Set;
  },
  nodeClass: YAMLSet,
  default: false,
  tag: 'tag:yaml.org,2002:set',
  resolve: parseSet,
  createNode: createSet
};

var parseSexagesimal = function parseSexagesimal(sign, parts) {
  var n = parts.split(':').reduce(function (n, p) {
    return n * 60 + Number(p);
  }, 0);
  return sign === '-' ? -n : n;
}; // hhhh:mm:ss.sss


var stringifySexagesimal = function stringifySexagesimal(_ref) {
  var value = _ref.value;
  if (isNaN(value) || !isFinite(value)) return stringifyNumber(value);
  var sign = '';

  if (value < 0) {
    sign = '-';
    value = Math.abs(value);
  }

  var parts = [value % 60]; // seconds, including ms

  if (value < 60) {
    parts.unshift(0); // at least one : is required
  } else {
    value = Math.round((value - parts[0]) / 60);
    parts.unshift(value % 60); // minutes

    if (value >= 60) {
      value = Math.round((value - parts[0]) / 60);
      parts.unshift(value); // hours
    }
  }

  return sign + parts.map(function (n) {
    return n < 10 ? '0' + String(n) : String(n);
  }).join(':').replace(/000000\d*$/, '') // % 60 may introduce error
  ;
};

var intTime = {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:int',
  format: 'TIME',
  test: /^([-+]?)([0-9][0-9_]*(?::[0-5]?[0-9])+)$/,
  resolve: function resolve(str, sign, parts) {
    return parseSexagesimal(sign, parts.replace(/_/g, ''));
  },
  stringify: stringifySexagesimal
};
var floatTime = {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:float',
  format: 'TIME',
  test: /^([-+]?)([0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*)$/,
  resolve: function resolve(str, sign, parts) {
    return parseSexagesimal(sign, parts.replace(/_/g, ''));
  },
  stringify: stringifySexagesimal
};
var timestamp = {
  identify: function identify(value) {
    return value instanceof Date;
  },
  default: true,
  tag: 'tag:yaml.org,2002:timestamp',
  // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
  // may be omitted altogether, resulting in a date format. In such a case, the time part is
  // assumed to be 00:00:00Z (start of day, UTC).
  test: RegExp('^(?:' + '([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})' + // YYYY-Mm-Dd
  '(?:(?:t|T|[ \\t]+)' + // t | T | whitespace
  '([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)' + // Hh:Mm:Ss(.ss)?
  '(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?' + // Z | +5 | -03:30
  ')?' + ')$'),
  resolve: function resolve(str, year, month, day, hour, minute, second, millisec, tz) {
    if (millisec) millisec = (millisec + '00').substr(1, 3);
    var date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec || 0);

    if (tz && tz !== 'Z') {
      var d = parseSexagesimal(tz[0], tz.slice(1));
      if (Math.abs(d) < 30) d *= 60;
      date -= 60000 * d;
    }

    return new Date(date);
  },
  stringify: function stringify(_ref2) {
    var value = _ref2.value;
    return value.toISOString().replace(/((T00:00)?:00)?\.000Z$/, '');
  }
};

/* global console, process, YAML_SILENCE_DEPRECATION_WARNINGS, YAML_SILENCE_WARNINGS */
function shouldWarn(deprecation) {
  var env = typeof process !== 'undefined' && ({}) || {};

  if (deprecation) {
    if (typeof YAML_SILENCE_DEPRECATION_WARNINGS !== 'undefined') return !YAML_SILENCE_DEPRECATION_WARNINGS;
    return !env.YAML_SILENCE_DEPRECATION_WARNINGS;
  }

  if (typeof YAML_SILENCE_WARNINGS !== 'undefined') return !YAML_SILENCE_WARNINGS;
  return !env.YAML_SILENCE_WARNINGS;
}

function warn(warning, type) {
  if (shouldWarn(false)) {
    var emit = typeof process !== 'undefined' && process.emitWarning; // This will throw in Jest if `warning` is an Error instance due to
    // https://github.com/facebook/jest/issues/2549

    if (emit) emit(warning, type);else {
      // eslint-disable-next-line no-console
      console.warn(type ? "".concat(type, ": ").concat(warning) : warning);
    }
  }
}
function warnFileDeprecation(filename) {
  if (shouldWarn(true)) {
    var path = filename.replace(/.*yaml[/\\]/i, '').replace(/\.js$/, '').replace(/\\/g, '/');
    warn("The endpoint 'yaml/".concat(path, "' will be removed in a future release."), 'DeprecationWarning');
  }
}
var warned = {};
function warnOptionDeprecation(name, alternative) {
  if (!warned[name] && shouldWarn(true)) {
    warned[name] = true;
    var msg = "The option '".concat(name, "' will be removed in a future release");
    msg += alternative ? ", use '".concat(alternative, "' instead.") : '.';
    warn(msg, 'DeprecationWarning');
  }
}



;// ./node_modules/yaml/browser/dist/Schema-e94716c8.js




function createMap(schema, obj, ctx) {
  var map = new YAMLMap(schema);

  if (obj instanceof Map) {
    var _iterator = _createForOfIteratorHelper(obj),
        _step;

    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var _step$value = _slicedToArray(_step.value, 2),
            key = _step$value[0],
            value = _step$value[1];

        map.items.push(schema.createPair(key, value, ctx));
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }
  } else if (obj && _typeof(obj) === 'object') {
    for (var _i = 0, _Object$keys = Object.keys(obj); _i < _Object$keys.length; _i++) {
      var _key = _Object$keys[_i];
      map.items.push(schema.createPair(_key, obj[_key], ctx));
    }
  }

  if (typeof schema.sortMapEntries === 'function') {
    map.items.sort(schema.sortMapEntries);
  }

  return map;
}

var map = {
  createNode: createMap,
  default: true,
  nodeClass: YAMLMap,
  tag: 'tag:yaml.org,2002:map',
  resolve: resolveMap
};

function createSeq(schema, obj, ctx) {
  var seq = new YAMLSeq(schema);

  if (obj && obj[Symbol.iterator]) {
    var _iterator = _createForOfIteratorHelper(obj),
        _step;

    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var it = _step.value;
        var v = schema.createNode(it, ctx.wrapScalars, null, ctx);
        seq.items.push(v);
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }
  }

  return seq;
}

var seq = {
  createNode: createSeq,
  default: true,
  nodeClass: YAMLSeq,
  tag: 'tag:yaml.org,2002:seq',
  resolve: resolveSeq
};

var string = {
  identify: function identify(value) {
    return typeof value === 'string';
  },
  default: true,
  tag: 'tag:yaml.org,2002:str',
  resolve: resolveString,
  stringify: function stringify(item, ctx, onComment, onChompKeep) {
    ctx = Object.assign({
      actualString: true
    }, ctx);
    return stringifyString(item, ctx, onComment, onChompKeep);
  },
  options: strOptions
};

var failsafe = [map, seq, string];

/* global BigInt */

var intIdentify$2 = function intIdentify(value) {
  return typeof value === 'bigint' || Number.isInteger(value);
};

var intResolve$1 = function intResolve(src, part, radix) {
  return intOptions.asBigInt ? BigInt(src) : parseInt(part, radix);
};

function intStringify$1(node, radix, prefix) {
  var value = node.value;
  if (intIdentify$2(value) && value >= 0) return prefix + value.toString(radix);
  return stringifyNumber(node);
}

var nullObj = {
  identify: function identify(value) {
    return value == null;
  },
  createNode: function createNode(schema, value, ctx) {
    return ctx.wrapScalars ? new Scalar(null) : null;
  },
  default: true,
  tag: 'tag:yaml.org,2002:null',
  test: /^(?:~|[Nn]ull|NULL)?$/,
  resolve: function resolve() {
    return null;
  },
  options: nullOptions,
  stringify: function stringify() {
    return nullOptions.nullStr;
  }
};
var boolObj = {
  identify: function identify(value) {
    return typeof value === 'boolean';
  },
  default: true,
  tag: 'tag:yaml.org,2002:bool',
  test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
  resolve: function resolve(str) {
    return str[0] === 't' || str[0] === 'T';
  },
  options: boolOptions,
  stringify: function stringify(_ref) {
    var value = _ref.value;
    return value ? boolOptions.trueStr : boolOptions.falseStr;
  }
};
var octObj = {
  identify: function identify(value) {
    return intIdentify$2(value) && value >= 0;
  },
  default: true,
  tag: 'tag:yaml.org,2002:int',
  format: 'OCT',
  test: /^0o([0-7]+)$/,
  resolve: function resolve(str, oct) {
    return intResolve$1(str, oct, 8);
  },
  options: intOptions,
  stringify: function stringify(node) {
    return intStringify$1(node, 8, '0o');
  }
};
var intObj = {
  identify: intIdentify$2,
  default: true,
  tag: 'tag:yaml.org,2002:int',
  test: /^[-+]?[0-9]+$/,
  resolve: function resolve(str) {
    return intResolve$1(str, str, 10);
  },
  options: intOptions,
  stringify: stringifyNumber
};
var hexObj = {
  identify: function identify(value) {
    return intIdentify$2(value) && value >= 0;
  },
  default: true,
  tag: 'tag:yaml.org,2002:int',
  format: 'HEX',
  test: /^0x([0-9a-fA-F]+)$/,
  resolve: function resolve(str, hex) {
    return intResolve$1(str, hex, 16);
  },
  options: intOptions,
  stringify: function stringify(node) {
    return intStringify$1(node, 16, '0x');
  }
};
var nanObj = {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^(?:[-+]?\.inf|(\.nan))$/i,
  resolve: function resolve(str, nan) {
    return nan ? NaN : str[0] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  },
  stringify: stringifyNumber
};
var expObj = {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:float',
  format: 'EXP',
  test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
  resolve: function resolve(str) {
    return parseFloat(str);
  },
  stringify: function stringify(_ref2) {
    var value = _ref2.value;
    return Number(value).toExponential();
  }
};
var floatObj = {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^[-+]?(?:\.([0-9]+)|[0-9]+\.([0-9]*))$/,
  resolve: function resolve(str, frac1, frac2) {
    var frac = frac1 || frac2;
    var node = new Scalar(parseFloat(str));
    if (frac && frac[frac.length - 1] === '0') node.minFractionDigits = frac.length;
    return node;
  },
  stringify: stringifyNumber
};
var core = failsafe.concat([nullObj, boolObj, octObj, intObj, hexObj, nanObj, expObj, floatObj]);

/* global BigInt */

var intIdentify$1 = function intIdentify(value) {
  return typeof value === 'bigint' || Number.isInteger(value);
};

var stringifyJSON = function stringifyJSON(_ref) {
  var value = _ref.value;
  return JSON.stringify(value);
};

var json = [map, seq, {
  identify: function identify(value) {
    return typeof value === 'string';
  },
  default: true,
  tag: 'tag:yaml.org,2002:str',
  resolve: resolveString,
  stringify: stringifyJSON
}, {
  identify: function identify(value) {
    return value == null;
  },
  createNode: function createNode(schema, value, ctx) {
    return ctx.wrapScalars ? new Scalar(null) : null;
  },
  default: true,
  tag: 'tag:yaml.org,2002:null',
  test: /^null$/,
  resolve: function resolve() {
    return null;
  },
  stringify: stringifyJSON
}, {
  identify: function identify(value) {
    return typeof value === 'boolean';
  },
  default: true,
  tag: 'tag:yaml.org,2002:bool',
  test: /^true|false$/,
  resolve: function resolve(str) {
    return str === 'true';
  },
  stringify: stringifyJSON
}, {
  identify: intIdentify$1,
  default: true,
  tag: 'tag:yaml.org,2002:int',
  test: /^-?(?:0|[1-9][0-9]*)$/,
  resolve: function resolve(str) {
    return intOptions.asBigInt ? BigInt(str) : parseInt(str, 10);
  },
  stringify: function stringify(_ref2) {
    var value = _ref2.value;
    return intIdentify$1(value) ? value.toString() : JSON.stringify(value);
  }
}, {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
  resolve: function resolve(str) {
    return parseFloat(str);
  },
  stringify: stringifyJSON
}];

json.scalarFallback = function (str) {
  throw new SyntaxError("Unresolved plain scalar ".concat(JSON.stringify(str)));
};

/* global BigInt */

var boolStringify = function boolStringify(_ref) {
  var value = _ref.value;
  return value ? boolOptions.trueStr : boolOptions.falseStr;
};

var intIdentify = function intIdentify(value) {
  return typeof value === 'bigint' || Number.isInteger(value);
};

function intResolve(sign, src, radix) {
  var str = src.replace(/_/g, '');

  if (intOptions.asBigInt) {
    switch (radix) {
      case 2:
        str = "0b".concat(str);
        break;

      case 8:
        str = "0o".concat(str);
        break;

      case 16:
        str = "0x".concat(str);
        break;
    }

    var _n = BigInt(str);

    return sign === '-' ? BigInt(-1) * _n : _n;
  }

  var n = parseInt(str, radix);
  return sign === '-' ? -1 * n : n;
}

function intStringify(node, radix, prefix) {
  var value = node.value;

  if (intIdentify(value)) {
    var str = value.toString(radix);
    return value < 0 ? '-' + prefix + str.substr(1) : prefix + str;
  }

  return stringifyNumber(node);
}

var yaml11 = failsafe.concat([{
  identify: function identify(value) {
    return value == null;
  },
  createNode: function createNode(schema, value, ctx) {
    return ctx.wrapScalars ? new Scalar(null) : null;
  },
  default: true,
  tag: 'tag:yaml.org,2002:null',
  test: /^(?:~|[Nn]ull|NULL)?$/,
  resolve: function resolve() {
    return null;
  },
  options: nullOptions,
  stringify: function stringify() {
    return nullOptions.nullStr;
  }
}, {
  identify: function identify(value) {
    return typeof value === 'boolean';
  },
  default: true,
  tag: 'tag:yaml.org,2002:bool',
  test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
  resolve: function resolve() {
    return true;
  },
  options: boolOptions,
  stringify: boolStringify
}, {
  identify: function identify(value) {
    return typeof value === 'boolean';
  },
  default: true,
  tag: 'tag:yaml.org,2002:bool',
  test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/i,
  resolve: function resolve() {
    return false;
  },
  options: boolOptions,
  stringify: boolStringify
}, {
  identify: intIdentify,
  default: true,
  tag: 'tag:yaml.org,2002:int',
  format: 'BIN',
  test: /^([-+]?)0b([0-1_]+)$/,
  resolve: function resolve(str, sign, bin) {
    return intResolve(sign, bin, 2);
  },
  stringify: function stringify(node) {
    return intStringify(node, 2, '0b');
  }
}, {
  identify: intIdentify,
  default: true,
  tag: 'tag:yaml.org,2002:int',
  format: 'OCT',
  test: /^([-+]?)0([0-7_]+)$/,
  resolve: function resolve(str, sign, oct) {
    return intResolve(sign, oct, 8);
  },
  stringify: function stringify(node) {
    return intStringify(node, 8, '0');
  }
}, {
  identify: intIdentify,
  default: true,
  tag: 'tag:yaml.org,2002:int',
  test: /^([-+]?)([0-9][0-9_]*)$/,
  resolve: function resolve(str, sign, abs) {
    return intResolve(sign, abs, 10);
  },
  stringify: stringifyNumber
}, {
  identify: intIdentify,
  default: true,
  tag: 'tag:yaml.org,2002:int',
  format: 'HEX',
  test: /^([-+]?)0x([0-9a-fA-F_]+)$/,
  resolve: function resolve(str, sign, hex) {
    return intResolve(sign, hex, 16);
  },
  stringify: function stringify(node) {
    return intStringify(node, 16, '0x');
  }
}, {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^(?:[-+]?\.inf|(\.nan))$/i,
  resolve: function resolve(str, nan) {
    return nan ? NaN : str[0] === '-' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  },
  stringify: stringifyNumber
}, {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:float',
  format: 'EXP',
  test: /^[-+]?([0-9][0-9_]*)?(\.[0-9_]*)?[eE][-+]?[0-9]+$/,
  resolve: function resolve(str) {
    return parseFloat(str.replace(/_/g, ''));
  },
  stringify: function stringify(_ref2) {
    var value = _ref2.value;
    return Number(value).toExponential();
  }
}, {
  identify: function identify(value) {
    return typeof value === 'number';
  },
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^[-+]?(?:[0-9][0-9_]*)?\.([0-9_]*)$/,
  resolve: function resolve(str, frac) {
    var node = new Scalar(parseFloat(str.replace(/_/g, '')));

    if (frac) {
      var f = frac.replace(/_/g, '');
      if (f[f.length - 1] === '0') node.minFractionDigits = f.length;
    }

    return node;
  },
  stringify: stringifyNumber
}], binary, omap, pairs, set, intTime, floatTime, timestamp);

var schemas = {
  core: core,
  failsafe: failsafe,
  json: json,
  yaml11: yaml11
};
var tags = {
  binary: binary,
  bool: boolObj,
  float: floatObj,
  floatExp: expObj,
  floatNaN: nanObj,
  floatTime: floatTime,
  int: intObj,
  intHex: hexObj,
  intOct: octObj,
  intTime: intTime,
  map: map,
  null: nullObj,
  omap: omap,
  pairs: pairs,
  seq: seq,
  set: set,
  timestamp: timestamp
};

function findTagObject(value, tagName, tags) {
  if (tagName) {
    var match = tags.filter(function (t) {
      return t.tag === tagName;
    });
    var tagObj = match.find(function (t) {
      return !t.format;
    }) || match[0];
    if (!tagObj) throw new Error("Tag ".concat(tagName, " not found"));
    return tagObj;
  } // TODO: deprecate/remove class check


  return tags.find(function (t) {
    return (t.identify && t.identify(value) || t.class && value instanceof t.class) && !t.format;
  });
}

function createNode(value, tagName, ctx) {
  if (value instanceof resolveSeq_492ab440_Node) return value;
  var defaultPrefix = ctx.defaultPrefix,
      onTagObj = ctx.onTagObj,
      prevObjects = ctx.prevObjects,
      schema = ctx.schema,
      wrapScalars = ctx.wrapScalars;
  if (tagName && tagName.startsWith('!!')) tagName = defaultPrefix + tagName.slice(2);
  var tagObj = findTagObject(value, tagName, schema.tags);

  if (!tagObj) {
    if (typeof value.toJSON === 'function') value = value.toJSON();
    if (!value || _typeof(value) !== 'object') return wrapScalars ? new Scalar(value) : value;
    tagObj = value instanceof Map ? map : value[Symbol.iterator] ? seq : map;
  }

  if (onTagObj) {
    onTagObj(tagObj);
    delete ctx.onTagObj;
  } // Detect duplicate references to the same object & use Alias nodes for all
  // after first. The `obj` wrapper allows for circular references to resolve.


  var obj = {
    value: undefined,
    node: undefined
  };

  if (value && _typeof(value) === 'object' && prevObjects) {
    var prev = prevObjects.get(value);

    if (prev) {
      var alias = new resolveSeq_492ab440_Alias(prev); // leaves source dirty; must be cleaned by caller

      ctx.aliasNodes.push(alias); // defined along with prevObjects

      return alias;
    }

    obj.value = value;
    prevObjects.set(value, obj);
  }

  obj.node = tagObj.createNode ? tagObj.createNode(ctx.schema, value, ctx) : wrapScalars ? new Scalar(value) : value;
  if (tagName && obj.node instanceof resolveSeq_492ab440_Node) obj.node.tag = tagName;
  return obj.node;
}

function getSchemaTags(schemas, knownTags, customTags, schemaId) {
  var tags = schemas[schemaId.replace(/\W/g, '')]; // 'yaml-1.1' -> 'yaml11'

  if (!tags) {
    var keys = Object.keys(schemas).map(function (key) {
      return JSON.stringify(key);
    }).join(', ');
    throw new Error("Unknown schema \"".concat(schemaId, "\"; use one of ").concat(keys));
  }

  if (Array.isArray(customTags)) {
    var _iterator = _createForOfIteratorHelper(customTags),
        _step;

    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var tag = _step.value;
        tags = tags.concat(tag);
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }
  } else if (typeof customTags === 'function') {
    tags = customTags(tags.slice());
  }

  for (var i = 0; i < tags.length; ++i) {
    var _tag = tags[i];

    if (typeof _tag === 'string') {
      var tagObj = knownTags[_tag];

      if (!tagObj) {
        var _keys = Object.keys(knownTags).map(function (key) {
          return JSON.stringify(key);
        }).join(', ');

        throw new Error("Unknown custom tag \"".concat(_tag, "\"; use one of ").concat(_keys));
      }

      tags[i] = tagObj;
    }
  }

  return tags;
}

var sortMapEntriesByKey = function sortMapEntriesByKey(a, b) {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
};

var Schema = /*#__PURE__*/function () {
  // TODO: remove in v2
  // TODO: remove in v2
  function Schema(_ref) {
    var customTags = _ref.customTags,
        merge = _ref.merge,
        schema = _ref.schema,
        sortMapEntries = _ref.sortMapEntries,
        deprecatedCustomTags = _ref.tags;

    _classCallCheck(this, Schema);

    this.merge = !!merge;
    this.name = schema;
    this.sortMapEntries = sortMapEntries === true ? sortMapEntriesByKey : sortMapEntries || null;
    if (!customTags && deprecatedCustomTags) warnOptionDeprecation('tags', 'customTags');
    this.tags = getSchemaTags(schemas, tags, customTags || deprecatedCustomTags, schema);
  }

  _createClass(Schema, [{
    key: "createNode",
    value: function createNode$1(value, wrapScalars, tagName, ctx) {
      var baseCtx = {
        defaultPrefix: Schema.defaultPrefix,
        schema: this,
        wrapScalars: wrapScalars
      };
      var createCtx = ctx ? Object.assign(ctx, baseCtx) : baseCtx;
      return createNode(value, tagName, createCtx);
    }
  }, {
    key: "createPair",
    value: function createPair(key, value, ctx) {
      if (!ctx) ctx = {
        wrapScalars: true
      };
      var k = this.createNode(key, ctx.wrapScalars, null, ctx);
      var v = this.createNode(value, ctx.wrapScalars, null, ctx);
      return new Pair(k, v);
    }
  }]);

  return Schema;
}();

_defineProperty(Schema, "defaultPrefix", defaultTagPrefix);

_defineProperty(Schema, "defaultTags", defaultTags);



;// ./node_modules/yaml/browser/dist/index.js






var defaultOptions = {
  anchorPrefix: 'a',
  customTags: null,
  indent: 2,
  indentSeq: true,
  keepCstNodes: false,
  keepNodeTypes: true,
  keepBlobsInJSON: true,
  mapAsMap: false,
  maxAliasCount: 100,
  prettyErrors: false,
  // TODO Set true in v2
  simpleKeys: false,
  version: '1.2'
};
var scalarOptions = {
  get binary() {
    return binaryOptions;
  },

  set binary(opt) {
    Object.assign(binaryOptions, opt);
  },

  get bool() {
    return boolOptions;
  },

  set bool(opt) {
    Object.assign(boolOptions, opt);
  },

  get int() {
    return intOptions;
  },

  set int(opt) {
    Object.assign(intOptions, opt);
  },

  get null() {
    return nullOptions;
  },

  set null(opt) {
    Object.assign(nullOptions, opt);
  },

  get str() {
    return strOptions;
  },

  set str(opt) {
    Object.assign(strOptions, opt);
  }

};
var documentOptions = {
  '1.0': {
    schema: 'yaml-1.1',
    merge: true,
    tagPrefixes: [{
      handle: '!',
      prefix: defaultTagPrefix
    }, {
      handle: '!!',
      prefix: 'tag:private.yaml.org,2002:'
    }]
  },
  1.1: {
    schema: 'yaml-1.1',
    merge: true,
    tagPrefixes: [{
      handle: '!',
      prefix: '!'
    }, {
      handle: '!!',
      prefix: defaultTagPrefix
    }]
  },
  1.2: {
    schema: 'core',
    merge: false,
    tagPrefixes: [{
      handle: '!',
      prefix: '!'
    }, {
      handle: '!!',
      prefix: defaultTagPrefix
    }]
  }
};

function stringifyTag(doc, tag) {
  if ((doc.version || doc.options.version) === '1.0') {
    var priv = tag.match(/^tag:private\.yaml\.org,2002:([^:/]+)$/);
    if (priv) return '!' + priv[1];
    var vocab = tag.match(/^tag:([a-zA-Z0-9-]+)\.yaml\.org,2002:(.*)/);
    return vocab ? "!".concat(vocab[1], "/").concat(vocab[2]) : "!".concat(tag.replace(/^tag:/, ''));
  }

  var p = doc.tagPrefixes.find(function (p) {
    return tag.indexOf(p.prefix) === 0;
  });

  if (!p) {
    var dtp = doc.getDefaults().tagPrefixes;
    p = dtp && dtp.find(function (p) {
      return tag.indexOf(p.prefix) === 0;
    });
  }

  if (!p) return tag[0] === '!' ? tag : "!<".concat(tag, ">");
  var suffix = tag.substr(p.prefix.length).replace(/[!,[\]{}]/g, function (ch) {
    return {
      '!': '%21',
      ',': '%2C',
      '[': '%5B',
      ']': '%5D',
      '{': '%7B',
      '}': '%7D'
    }[ch];
  });
  return p.handle + suffix;
}

function getTagObject(tags, item) {
  if (item instanceof resolveSeq_492ab440_Alias) return resolveSeq_492ab440_Alias;

  if (item.tag) {
    var match = tags.filter(function (t) {
      return t.tag === item.tag;
    });
    if (match.length > 0) return match.find(function (t) {
      return t.format === item.format;
    }) || match[0];
  }

  var tagObj, obj;

  if (item instanceof Scalar) {
    obj = item.value; // TODO: deprecate/remove class check

    var _match = tags.filter(function (t) {
      return t.identify && t.identify(obj) || t.class && obj instanceof t.class;
    });

    tagObj = _match.find(function (t) {
      return t.format === item.format;
    }) || _match.find(function (t) {
      return !t.format;
    });
  } else {
    obj = item;
    tagObj = tags.find(function (t) {
      return t.nodeClass && obj instanceof t.nodeClass;
    });
  }

  if (!tagObj) {
    var name = obj && obj.constructor ? obj.constructor.name : _typeof(obj);
    throw new Error("Tag not resolved for ".concat(name, " value"));
  }

  return tagObj;
} // needs to be called before value stringifier to allow for circular anchor refs


function stringifyProps(node, tagObj, _ref) {
  var anchors = _ref.anchors,
      doc = _ref.doc;
  var props = [];
  var anchor = doc.anchors.getName(node);

  if (anchor) {
    anchors[anchor] = node;
    props.push("&".concat(anchor));
  }

  if (node.tag) {
    props.push(stringifyTag(doc, node.tag));
  } else if (!tagObj.default) {
    props.push(stringifyTag(doc, tagObj.tag));
  }

  return props.join(' ');
}

function stringify$1(item, ctx, onComment, onChompKeep) {
  var _ctx$doc = ctx.doc,
      anchors = _ctx$doc.anchors,
      schema = _ctx$doc.schema;
  var tagObj;

  if (!(item instanceof resolveSeq_492ab440_Node)) {
    var createCtx = {
      aliasNodes: [],
      onTagObj: function onTagObj(o) {
        return tagObj = o;
      },
      prevObjects: new Map()
    };
    item = schema.createNode(item, true, null, createCtx);

    var _iterator = _createForOfIteratorHelper(createCtx.aliasNodes),
        _step;

    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var alias = _step.value;
        alias.source = alias.source.node;
        var name = anchors.getName(alias.source);

        if (!name) {
          name = anchors.newName();
          anchors.map[name] = alias.source;
        }
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }
  }

  if (item instanceof Pair) return item.toString(ctx, onComment, onChompKeep);
  if (!tagObj) tagObj = getTagObject(schema.tags, item);
  var props = stringifyProps(item, tagObj, ctx);
  if (props.length > 0) ctx.indentAtStart = (ctx.indentAtStart || 0) + props.length + 1;
  var str = typeof tagObj.stringify === 'function' ? tagObj.stringify(item, ctx, onComment, onChompKeep) : item instanceof Scalar ? stringifyString(item, ctx, onComment, onChompKeep) : item.toString(ctx, onComment, onChompKeep);
  if (!props) return str;
  return item instanceof Scalar || str[0] === '{' || str[0] === '[' ? "".concat(props, " ").concat(str) : "".concat(props, "\n").concat(ctx.indent).concat(str);
}

var Anchors = /*#__PURE__*/function () {
  function Anchors(prefix) {
    _classCallCheck(this, Anchors);

    _defineProperty(this, "map", Object.create(null));

    this.prefix = prefix;
  }

  _createClass(Anchors, [{
    key: "createAlias",
    value: function createAlias(node, name) {
      this.setAnchor(node, name);
      return new resolveSeq_492ab440_Alias(node);
    }
  }, {
    key: "createMergePair",
    value: function createMergePair() {
      var _this = this;

      var merge = new Merge();

      for (var _len = arguments.length, sources = new Array(_len), _key = 0; _key < _len; _key++) {
        sources[_key] = arguments[_key];
      }

      merge.value.items = sources.map(function (s) {
        if (s instanceof resolveSeq_492ab440_Alias) {
          if (s.source instanceof YAMLMap) return s;
        } else if (s instanceof YAMLMap) {
          return _this.createAlias(s);
        }

        throw new Error('Merge sources must be Map nodes or their Aliases');
      });
      return merge;
    }
  }, {
    key: "getName",
    value: function getName(node) {
      var map = this.map;
      return Object.keys(map).find(function (a) {
        return map[a] === node;
      });
    }
  }, {
    key: "getNames",
    value: function getNames() {
      return Object.keys(this.map);
    }
  }, {
    key: "getNode",
    value: function getNode(name) {
      return this.map[name];
    }
  }, {
    key: "newName",
    value: function newName(prefix) {
      if (!prefix) prefix = this.prefix;
      var names = Object.keys(this.map);

      for (var i = 1; true; ++i) {
        var name = "".concat(prefix).concat(i);
        if (!names.includes(name)) return name;
      }
    } // During parsing, map & aliases contain CST nodes

  }, {
    key: "resolveNodes",
    value: function resolveNodes() {
      var map = this.map,
          _cstAliases = this._cstAliases;
      Object.keys(map).forEach(function (a) {
        map[a] = map[a].resolved;
      });

      _cstAliases.forEach(function (a) {
        a.source = a.source.resolved;
      });

      delete this._cstAliases;
    }
  }, {
    key: "setAnchor",
    value: function setAnchor(node, name) {
      if (node != null && !Anchors.validAnchorNode(node)) {
        throw new Error('Anchors may only be set for Scalar, Seq and Map nodes');
      }

      if (name && /[\x00-\x19\s,[\]{}]/.test(name)) {
        throw new Error('Anchor names must not contain whitespace or control characters');
      }

      var map = this.map;
      var prev = node && Object.keys(map).find(function (a) {
        return map[a] === node;
      });

      if (prev) {
        if (!name) {
          return prev;
        } else if (prev !== name) {
          delete map[prev];
          map[name] = node;
        }
      } else {
        if (!name) {
          if (!node) return null;
          name = this.newName();
        }

        map[name] = node;
      }

      return name;
    }
  }], [{
    key: "validAnchorNode",
    value: function validAnchorNode(node) {
      return node instanceof Scalar || node instanceof YAMLSeq || node instanceof YAMLMap;
    }
  }]);

  return Anchors;
}();

var visit = function visit(node, tags) {
  if (node && _typeof(node) === 'object') {
    var tag = node.tag;

    if (node instanceof resolveSeq_492ab440_Collection) {
      if (tag) tags[tag] = true;
      node.items.forEach(function (n) {
        return visit(n, tags);
      });
    } else if (node instanceof Pair) {
      visit(node.key, tags);
      visit(node.value, tags);
    } else if (node instanceof Scalar) {
      if (tag) tags[tag] = true;
    }
  }

  return tags;
};

var listTagNames = function listTagNames(node) {
  return Object.keys(visit(node, {}));
};

function parseContents(doc, contents) {
  var comments = {
    before: [],
    after: []
  };
  var body = undefined;
  var spaceBefore = false;

  var _iterator = _createForOfIteratorHelper(contents),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var node = _step.value;

      if (node.valueRange) {
        if (body !== undefined) {
          var msg = 'Document contains trailing content not separated by a ... or --- line';
          doc.errors.push(new YAMLSyntaxError(node, msg));
          break;
        }

        var res = resolveNode(doc, node);

        if (spaceBefore) {
          res.spaceBefore = true;
          spaceBefore = false;
        }

        body = res;
      } else if (node.comment !== null) {
        var cc = body === undefined ? comments.before : comments.after;
        cc.push(node.comment);
      } else if (node.type === Type.BLANK_LINE) {
        spaceBefore = true;

        if (body === undefined && comments.before.length > 0 && !doc.commentBefore) {
          // space-separated comments at start are parsed as document comments
          doc.commentBefore = comments.before.join('\n');
          comments.before = [];
        }
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  doc.contents = body || null;

  if (!body) {
    doc.comment = comments.before.concat(comments.after).join('\n') || null;
  } else {
    var cb = comments.before.join('\n');

    if (cb) {
      var cbNode = body instanceof resolveSeq_492ab440_Collection && body.items[0] ? body.items[0] : body;
      cbNode.commentBefore = cbNode.commentBefore ? "".concat(cb, "\n").concat(cbNode.commentBefore) : cb;
    }

    doc.comment = comments.after.join('\n') || null;
  }
}

function resolveTagDirective(_ref, directive) {
  var tagPrefixes = _ref.tagPrefixes;

  var _directive$parameters = _slicedToArray(directive.parameters, 2),
      handle = _directive$parameters[0],
      prefix = _directive$parameters[1];

  if (!handle || !prefix) {
    var msg = 'Insufficient parameters given for %TAG directive';
    throw new YAMLSemanticError(directive, msg);
  }

  if (tagPrefixes.some(function (p) {
    return p.handle === handle;
  })) {
    var _msg = 'The %TAG directive must only be given at most once per handle in the same document.';
    throw new YAMLSemanticError(directive, _msg);
  }

  return {
    handle: handle,
    prefix: prefix
  };
}

function resolveYamlDirective(doc, directive) {
  var _directive$parameters2 = _slicedToArray(directive.parameters, 1),
      version = _directive$parameters2[0];

  if (directive.name === 'YAML:1.0') version = '1.0';

  if (!version) {
    var msg = 'Insufficient parameters given for %YAML directive';
    throw new YAMLSemanticError(directive, msg);
  }

  if (!documentOptions[version]) {
    var v0 = doc.version || doc.options.version;

    var _msg2 = "Document will be parsed as YAML ".concat(v0, " rather than YAML ").concat(version);

    doc.warnings.push(new YAMLWarning(directive, _msg2));
  }

  return version;
}

function parseDirectives(doc, directives, prevDoc) {
  var directiveComments = [];
  var hasDirectives = false;

  var _iterator = _createForOfIteratorHelper(directives),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var directive = _step.value;
      var comment = directive.comment,
          name = directive.name;

      switch (name) {
        case 'TAG':
          try {
            doc.tagPrefixes.push(resolveTagDirective(doc, directive));
          } catch (error) {
            doc.errors.push(error);
          }

          hasDirectives = true;
          break;

        case 'YAML':
        case 'YAML:1.0':
          if (doc.version) {
            var msg = 'The %YAML directive must only be given at most once per document.';
            doc.errors.push(new YAMLSemanticError(directive, msg));
          }

          try {
            doc.version = resolveYamlDirective(doc, directive);
          } catch (error) {
            doc.errors.push(error);
          }

          hasDirectives = true;
          break;

        default:
          if (name) {
            var _msg3 = "YAML only supports %TAG and %YAML directives, and not %".concat(name);

            doc.warnings.push(new YAMLWarning(directive, _msg3));
          }

      }

      if (comment) directiveComments.push(comment);
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  if (prevDoc && !hasDirectives && '1.1' === (doc.version || prevDoc.version || doc.options.version)) {
    var copyTagPrefix = function copyTagPrefix(_ref2) {
      var handle = _ref2.handle,
          prefix = _ref2.prefix;
      return {
        handle: handle,
        prefix: prefix
      };
    };

    doc.tagPrefixes = prevDoc.tagPrefixes.map(copyTagPrefix);
    doc.version = prevDoc.version;
  }

  doc.commentBefore = directiveComments.join('\n') || null;
}

function assertCollection(contents) {
  if (contents instanceof resolveSeq_492ab440_Collection) return true;
  throw new Error('Expected a YAML collection as document contents');
}

var Document$1 = /*#__PURE__*/function () {
  function Document(options) {
    _classCallCheck(this, Document);

    this.anchors = new Anchors(options.anchorPrefix);
    this.commentBefore = null;
    this.comment = null;
    this.contents = null;
    this.directivesEndMarker = null;
    this.errors = [];
    this.options = options;
    this.schema = null;
    this.tagPrefixes = [];
    this.version = null;
    this.warnings = [];
  }

  _createClass(Document, [{
    key: "add",
    value: function add(value) {
      assertCollection(this.contents);
      return this.contents.add(value);
    }
  }, {
    key: "addIn",
    value: function addIn(path, value) {
      assertCollection(this.contents);
      this.contents.addIn(path, value);
    }
  }, {
    key: "delete",
    value: function _delete(key) {
      assertCollection(this.contents);
      return this.contents.delete(key);
    }
  }, {
    key: "deleteIn",
    value: function deleteIn(path) {
      if (isEmptyPath(path)) {
        if (this.contents == null) return false;
        this.contents = null;
        return true;
      }

      assertCollection(this.contents);
      return this.contents.deleteIn(path);
    }
  }, {
    key: "getDefaults",
    value: function getDefaults() {
      return Document.defaults[this.version] || Document.defaults[this.options.version] || {};
    }
  }, {
    key: "get",
    value: function get(key, keepScalar) {
      return this.contents instanceof resolveSeq_492ab440_Collection ? this.contents.get(key, keepScalar) : undefined;
    }
  }, {
    key: "getIn",
    value: function getIn(path, keepScalar) {
      if (isEmptyPath(path)) return !keepScalar && this.contents instanceof Scalar ? this.contents.value : this.contents;
      return this.contents instanceof resolveSeq_492ab440_Collection ? this.contents.getIn(path, keepScalar) : undefined;
    }
  }, {
    key: "has",
    value: function has(key) {
      return this.contents instanceof resolveSeq_492ab440_Collection ? this.contents.has(key) : false;
    }
  }, {
    key: "hasIn",
    value: function hasIn(path) {
      if (isEmptyPath(path)) return this.contents !== undefined;
      return this.contents instanceof resolveSeq_492ab440_Collection ? this.contents.hasIn(path) : false;
    }
  }, {
    key: "set",
    value: function set(key, value) {
      assertCollection(this.contents);
      this.contents.set(key, value);
    }
  }, {
    key: "setIn",
    value: function setIn(path, value) {
      if (isEmptyPath(path)) this.contents = value;else {
        assertCollection(this.contents);
        this.contents.setIn(path, value);
      }
    }
  }, {
    key: "setSchema",
    value: function setSchema(id, customTags) {
      if (!id && !customTags && this.schema) return;
      if (typeof id === 'number') id = id.toFixed(1);

      if (id === '1.0' || id === '1.1' || id === '1.2') {
        if (this.version) this.version = id;else this.options.version = id;
        delete this.options.schema;
      } else if (id && typeof id === 'string') {
        this.options.schema = id;
      }

      if (Array.isArray(customTags)) this.options.customTags = customTags;
      var opt = Object.assign({}, this.getDefaults(), this.options);
      this.schema = new Schema(opt);
    }
  }, {
    key: "parse",
    value: function parse(node, prevDoc) {
      if (this.options.keepCstNodes) this.cstNode = node;
      if (this.options.keepNodeTypes) this.type = 'DOCUMENT';
      var _node$directives = node.directives,
          directives = _node$directives === void 0 ? [] : _node$directives,
          _node$contents = node.contents,
          contents = _node$contents === void 0 ? [] : _node$contents,
          directivesEndMarker = node.directivesEndMarker,
          error = node.error,
          valueRange = node.valueRange;

      if (error) {
        if (!error.source) error.source = this;
        this.errors.push(error);
      }

      parseDirectives(this, directives, prevDoc);
      if (directivesEndMarker) this.directivesEndMarker = true;
      this.range = valueRange ? [valueRange.start, valueRange.end] : null;
      this.setSchema();
      this.anchors._cstAliases = [];
      parseContents(this, contents);
      this.anchors.resolveNodes();

      if (this.options.prettyErrors) {
        var _iterator = _createForOfIteratorHelper(this.errors),
            _step;

        try {
          for (_iterator.s(); !(_step = _iterator.n()).done;) {
            var _error = _step.value;
            if (_error instanceof YAMLError) _error.makePretty();
          }
        } catch (err) {
          _iterator.e(err);
        } finally {
          _iterator.f();
        }

        var _iterator2 = _createForOfIteratorHelper(this.warnings),
            _step2;

        try {
          for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
            var warn = _step2.value;
            if (warn instanceof YAMLError) warn.makePretty();
          }
        } catch (err) {
          _iterator2.e(err);
        } finally {
          _iterator2.f();
        }
      }

      return this;
    }
  }, {
    key: "listNonDefaultTags",
    value: function listNonDefaultTags() {
      return listTagNames(this.contents).filter(function (t) {
        return t.indexOf(Schema.defaultPrefix) !== 0;
      });
    }
  }, {
    key: "setTagPrefix",
    value: function setTagPrefix(handle, prefix) {
      if (handle[0] !== '!' || handle[handle.length - 1] !== '!') throw new Error('Handle must start and end with !');

      if (prefix) {
        var prev = this.tagPrefixes.find(function (p) {
          return p.handle === handle;
        });
        if (prev) prev.prefix = prefix;else this.tagPrefixes.push({
          handle: handle,
          prefix: prefix
        });
      } else {
        this.tagPrefixes = this.tagPrefixes.filter(function (p) {
          return p.handle !== handle;
        });
      }
    }
  }, {
    key: "toJSON",
    value: function toJSON$1(arg, onAnchor) {
      var _this = this;

      var _this$options = this.options,
          keepBlobsInJSON = _this$options.keepBlobsInJSON,
          mapAsMap = _this$options.mapAsMap,
          maxAliasCount = _this$options.maxAliasCount;
      var keep = keepBlobsInJSON && (typeof arg !== 'string' || !(this.contents instanceof Scalar));
      var ctx = {
        doc: this,
        indentStep: '  ',
        keep: keep,
        mapAsMap: keep && !!mapAsMap,
        maxAliasCount: maxAliasCount,
        stringify: stringify$1 // Requiring directly in Pair would create circular dependencies

      };
      var anchorNames = Object.keys(this.anchors.map);
      if (anchorNames.length > 0) ctx.anchors = new Map(anchorNames.map(function (name) {
        return [_this.anchors.map[name], {
          alias: [],
          aliasCount: 0,
          count: 1
        }];
      }));

      var res = toJSON(this.contents, arg, ctx);

      if (typeof onAnchor === 'function' && ctx.anchors) {
        var _iterator3 = _createForOfIteratorHelper(ctx.anchors.values()),
            _step3;

        try {
          for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
            var _step3$value = _step3.value,
                count = _step3$value.count,
                _res = _step3$value.res;
            onAnchor(_res, count);
          }
        } catch (err) {
          _iterator3.e(err);
        } finally {
          _iterator3.f();
        }
      }

      return res;
    }
  }, {
    key: "toString",
    value: function toString() {
      if (this.errors.length > 0) throw new Error('Document with errors cannot be stringified');
      var indentSize = this.options.indent;

      if (!Number.isInteger(indentSize) || indentSize <= 0) {
        var s = JSON.stringify(indentSize);
        throw new Error("\"indent\" option must be a positive integer, not ".concat(s));
      }

      this.setSchema();
      var lines = [];
      var hasDirectives = false;

      if (this.version) {
        var vd = '%YAML 1.2';

        if (this.schema.name === 'yaml-1.1') {
          if (this.version === '1.0') vd = '%YAML:1.0';else if (this.version === '1.1') vd = '%YAML 1.1';
        }

        lines.push(vd);
        hasDirectives = true;
      }

      var tagNames = this.listNonDefaultTags();
      this.tagPrefixes.forEach(function (_ref) {
        var handle = _ref.handle,
            prefix = _ref.prefix;

        if (tagNames.some(function (t) {
          return t.indexOf(prefix) === 0;
        })) {
          lines.push("%TAG ".concat(handle, " ").concat(prefix));
          hasDirectives = true;
        }
      });
      if (hasDirectives || this.directivesEndMarker) lines.push('---');

      if (this.commentBefore) {
        if (hasDirectives || !this.directivesEndMarker) lines.unshift('');
        lines.unshift(this.commentBefore.replace(/^/gm, '#'));
      }

      var ctx = {
        anchors: Object.create(null),
        doc: this,
        indent: '',
        indentStep: ' '.repeat(indentSize),
        stringify: stringify$1 // Requiring directly in nodes would create circular dependencies

      };
      var chompKeep = false;
      var contentComment = null;

      if (this.contents) {
        if (this.contents instanceof resolveSeq_492ab440_Node) {
          if (this.contents.spaceBefore && (hasDirectives || this.directivesEndMarker)) lines.push('');
          if (this.contents.commentBefore) lines.push(this.contents.commentBefore.replace(/^/gm, '#')); // top-level block scalars need to be indented if followed by a comment

          ctx.forceBlockIndent = !!this.comment;
          contentComment = this.contents.comment;
        }

        var onChompKeep = contentComment ? null : function () {
          return chompKeep = true;
        };
        var body = stringify$1(this.contents, ctx, function () {
          return contentComment = null;
        }, onChompKeep);
        lines.push(addComment(body, '', contentComment));
      } else if (this.contents !== undefined) {
        lines.push(stringify$1(this.contents, ctx));
      }

      if (this.comment) {
        if ((!chompKeep || contentComment) && lines[lines.length - 1] !== '') lines.push('');
        lines.push(this.comment.replace(/^/gm, '#'));
      }

      return lines.join('\n') + '\n';
    }
  }]);

  return Document;
}();

_defineProperty(Document$1, "defaults", documentOptions);

function dist_createNode(value) {
  var wrapScalars = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;
  var tag = arguments.length > 2 ? arguments[2] : undefined;

  if (tag === undefined && typeof wrapScalars === 'string') {
    tag = wrapScalars;
    wrapScalars = true;
  }

  var options = Object.assign({}, Document$1.defaults[defaultOptions.version], defaultOptions);
  var schema = new Schema(options);
  return schema.createNode(value, wrapScalars, tag);
}

var dist_Document = /*#__PURE__*/function (_YAMLDocument) {
  _inherits(Document, _YAMLDocument);

  var _super = _createSuper(Document);

  function Document(options) {
    _classCallCheck(this, Document);

    return _super.call(this, Object.assign({}, defaultOptions, options));
  }

  return Document;
}(Document$1);

function parseAllDocuments(src, options) {
  var stream = [];
  var prev;

  var _iterator = _createForOfIteratorHelper(parse(src)),
      _step;

  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var cstDoc = _step.value;
      var doc = new dist_Document(options);
      doc.parse(cstDoc, prev);
      stream.push(doc);
      prev = doc;
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }

  return stream;
}

function parseDocument(src, options) {
  var cst = parse(src);
  var doc = new dist_Document(options).parse(cst[0]);

  if (cst.length > 1) {
    var errMsg = 'Source contains multiple documents; please use YAML.parseAllDocuments()';
    doc.errors.unshift(new YAMLSemanticError(cst[1], errMsg));
  }

  return doc;
}

function dist_parse(src, options) {
  var doc = parseDocument(src, options);
  doc.warnings.forEach(function (warning) {
    return warn(warning);
  });
  if (doc.errors.length > 0) throw doc.errors[0];
  return doc.toJSON();
}

function stringify(value, options) {
  var doc = new dist_Document(options);
  doc.contents = value;
  return String(doc);
}

var YAML = {
  createNode: dist_createNode,
  defaultOptions: defaultOptions,
  Document: dist_Document,
  parse: dist_parse,
  parseAllDocuments: parseAllDocuments,
  parseCST: parse,
  parseDocument: parseDocument,
  scalarOptions: scalarOptions,
  stringify: stringify
};




/***/ })

}]);
//# sourceMappingURL=component---src-pages-index-tsx-9693624a34a79561ecc8.js.map