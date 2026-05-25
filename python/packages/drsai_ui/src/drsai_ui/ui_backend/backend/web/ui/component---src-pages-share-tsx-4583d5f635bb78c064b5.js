"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[4147,6580],{

/***/ 85163:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Du: function() { return /* binding */ shouldShowPanel; },
/* harmony export */   mJ: function() { return /* binding */ getAgentConfig; }
/* harmony export */ });
/* unused harmony exports AGENT_CONFIGS, getPanelDefaultMinimized */
/**
 * Agent Panel 配置接口
 * 定义了每个 agent 可以显示的侧边面板的配置
 *//**
 * Agent 配置接口
 *//**
 * Agent 类型枚举
 * 根据实际的 agent 类型来定义
 *//**
 * Agent 配置映射表
 */const AGENT_CONFIGS={// Magentic One - 使用 VNC 浏览器预览
'magentic-one':{name:'magentic-one',displayName:'Magentic One',panel:{type:'vnc',title:'Browser Preview',defaultMinimized:true,isMinimizable:true,componentName:'VNCViewer'}},// BESIII - 使用自定义分析面板（待开发）
'besiii':{name:'besiii',displayName:'BESIII Agent',panel:{type:'besiii',title:'BESIII Analysis Panel',defaultMinimized:false,isMinimizable:true,componentName:'BESIIIPanel'}},// 默认配置 - 无面板
'default':{name:'default',displayName:'Default Agent',panel:{type:'none',title:'',defaultMinimized:true,isMinimizable:false}}};/**
 * 获取 Agent 配置
 * 
 * 这个函数支持灵活的 agent 类型匹配：
 * - 精确匹配：'magentic-one', 'besiii', 'default'
 * - 模糊匹配：包含关键词的字符串
 * - 大小写不敏感
 * 
 * @param agentType Agent 类型标识，可以从以下来源获取：
 *   - run.task.metadata.agent_type
 *   - session.agent_mode_config.agent_type
 *   - session.agent_mode_config.type
 * @returns Agent 配置对象
 * 
 * @example
 * getAgentConfig('magentic-one') // 返回 magentic-one 配置
 * getAgentConfig('MagenticOneAgent') // 模糊匹配，返回 magentic-one 配置
 * getAgentConfig('BESIII_Analyzer') // 模糊匹配，返回 besiii 配置
 * getAgentConfig(null) // 返回 default 配置
 */function getAgentConfig(agentType){// 如果没有指定类型，返回默认配置
if(!agentType){return AGENT_CONFIGS.default;}// 尝试精确匹配
if(agentType in AGENT_CONFIGS){return AGENT_CONFIGS[agentType];}// 尝试模糊匹配已知的 agent 类型
const normalizedType=agentType.toLowerCase().trim();// Magentic One agent - 用于浏览器自动化
// 匹配: 'magentic', 'magnetic', 'magneticone' 等
if(normalizedType.includes('magentic')||normalizedType.includes('magnetic')){return AGENT_CONFIGS['magentic-one'];}// BESIII agent - 用于物理分析
// 匹配: 'besiii', 'bes3', 'bes-iii' 等
if(normalizedType.includes('besiii')||normalizedType.includes('bes3')||normalizedType.includes('bes-iii')){return AGENT_CONFIGS.besiii;}// 未匹配到任何已知类型，返回默认配置
return AGENT_CONFIGS.default;}/**
 * 判断 agent 是否需要显示面板
 * @param agentType Agent 类型标识
 * @returns 是否需要显示面板
 */function shouldShowPanel(agentType){const config=getAgentConfig(agentType);return config.panel.type!=='none';}/**
 * 获取面板的初始最小化状态
 * @param agentType Agent 类型标识
 * @returns 是否默认最小化
 */function getPanelDefaultMinimized(agentType){const config=getAgentConfig(agentType);return config.panel.defaultMinimized;}

/***/ }),

/***/ 98142:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _share_ShareSessionPage__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(7017);


const SharePage = () => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_share_ShareSessionPage__WEBPACK_IMPORTED_MODULE_1__["default"], null);
/* harmony default export */ __webpack_exports__["default"] = (SharePage);

/***/ }),

/***/ 7017:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(34716);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _components_views_api__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(39614);
/* harmony import */ var _chat_runview__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(15682);
/* harmony import */ var _chat_config_agentConfigs__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(85163);





function normalizeRun(raw, sessionId) {
  var _raw$messages, _raw$team_result, _raw$task;
  return Object.assign({}, raw, {
    id: String(raw.id),
    session_id: sessionId,
    messages: (_raw$messages = raw.messages) !== null && _raw$messages !== void 0 ? _raw$messages : [],
    team_result: (_raw$team_result = raw.team_result) !== null && _raw$team_result !== void 0 ? _raw$team_result : null,
    task: (_raw$task = raw.task) !== null && _raw$task !== void 0 ? _raw$task : {
      source: "user",
      content: ""
    }
  });
}
const ShareSessionPage = () => {
  var _session$agent_mode_c2;
  const {
    0: loading,
    1: setLoading
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(true);
  const {
    0: error,
    1: setError
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
  const {
    0: session,
    1: setSession
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
  const {
    0: run,
    1: setRun
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
  const {
    0: isPanelMinimized,
    1: setIsPanelMinimized
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
  const {
    0: showPanel,
    1: setShowPanel
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
  const shareToken = (0,react__WEBPACK_IMPORTED_MODULE_0__.useMemo)(() => {
    var _URLSearchParams$get$, _URLSearchParams$get;
    if (typeof window === "undefined") return "";
    return (_URLSearchParams$get$ = (_URLSearchParams$get = new URLSearchParams(window.location.search).get("token")) === null || _URLSearchParams$get === void 0 ? void 0 : _URLSearchParams$get.trim()) !== null && _URLSearchParams$get$ !== void 0 ? _URLSearchParams$get$ : "";
  }, []);
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    if (!shareToken) {
      setError("缺少分享 token");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        var _data$runs, _sess$agent_mode_conf;
        setLoading(true);
        setError(null);
        const data = await _components_views_api__WEBPACK_IMPORTED_MODULE_1__/* .sessionAPI */ .jT.getSharedSession(shareToken);
        if (cancelled) return;
        const sess = data.session;
        setSession(sess);
        const runs = (_data$runs = data.runs) !== null && _data$runs !== void 0 ? _data$runs : [];
        const latest = runs.length > 0 ? runs[runs.length - 1] : null;
        if (latest) {
          setRun(normalizeRun(latest, sess.id));
        } else {
          setRun(null);
        }
        const mode = (_sess$agent_mode_conf = sess.agent_mode_config) === null || _sess$agent_mode_conf === void 0 ? void 0 : _sess$agent_mode_conf.mode;
        setShowPanel((0,_chat_config_agentConfigs__WEBPACK_IMPORTED_MODULE_3__/* .shouldShowPanel */ .Du)(mode));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "无法加载分享的会话");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareToken]);
  const agentConfig = (0,react__WEBPACK_IMPORTED_MODULE_0__.useMemo)(() => {
    var _session$agent_mode_c;
    return (0,_chat_config_agentConfigs__WEBPACK_IMPORTED_MODULE_3__/* .getAgentConfig */ .mJ)(session === null || session === void 0 ? void 0 : (_session$agent_mode_c = session.agent_mode_config) === null || _session$agent_mode_c === void 0 ? void 0 : _session$agent_mode_c.mode);
  }, [session === null || session === void 0 ? void 0 : (_session$agent_mode_c2 = session.agent_mode_config) === null || _session$agent_mode_c2 === void 0 ? void 0 : _session$agent_mode_c2.mode]);
  if (loading) {
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "min-h-screen flex items-center justify-center bg-primary"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
      size: "large"
    }));
  }
  if (error || !session) {
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "min-h-screen flex flex-col items-center justify-center bg-primary px-4"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
      className: "text-primary text-lg mb-2"
    }, "\u65E0\u6CD5\u67E5\u770B\u8BE5\u4F1A\u8BDD"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
      className: "text-secondary text-sm"
    }, error !== null && error !== void 0 ? error : "链接无效或分享已关闭"));
  }
  if (!run) {
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "min-h-screen flex flex-col bg-primary"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("header", {
      className: "border-b border-border px-4 py-3"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h1", {
      className: "text-lg font-medium text-primary truncate"
    }, session.name || "分享的会话"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
      className: "text-xs text-secondary mt-1"
    }, "\u53EA\u8BFB \xB7 \u8BBF\u5BA2\u6A21\u5F0F")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "flex-1 flex items-center justify-center text-secondary"
    }, "\u8BE5\u4F1A\u8BDD\u6682\u65E0\u6D88\u606F\u8BB0\u5F55"));
  }
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "min-h-screen flex flex-col bg-primary"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("header", {
    className: "flex-shrink-0 border-b border-border px-4 py-3"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h1", {
    className: "text-lg font-medium text-primary truncate"
  }, session.name || "分享的会话"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
    className: "text-xs text-secondary mt-1"
  }, "\u53EA\u8BFB \xB7 \u8BBF\u5BA2\u6A21\u5F0F")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex-1 min-h-0"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_chat_runview__WEBPACK_IMPORTED_MODULE_2__["default"], {
    run: run,
    viewOnly: true,
    agentConfig: agentConfig,
    isPanelMinimized: isPanelMinimized,
    setIsPanelMinimized: setIsPanelMinimized,
    showPanel: showPanel,
    setShowPanel: setShowPanel,
    enable_upload: false
  })));
};
/* harmony default export */ __webpack_exports__["default"] = (ShareSessionPage);

/***/ })

}]);
//# sourceMappingURL=component---src-pages-share-tsx-4583d5f635bb78c064b5.js.map