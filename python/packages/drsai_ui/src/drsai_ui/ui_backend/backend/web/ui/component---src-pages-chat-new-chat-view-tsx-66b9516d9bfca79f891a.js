"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[3891],{

/***/ 13907:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

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

/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-new-chat-view-tsx-66b9516d9bfca79f891a.js.map