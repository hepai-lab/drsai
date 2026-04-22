"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[5179],{

/***/ 34788:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": function() { return /* binding */ WelcomeScreen; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _chat_chatinput__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(71127);
/* harmony import */ var _sampletasks__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(84152);



function WelcomeScreen(_ref) {
  let {
    currentRun,
    sessionId,
    error,
    isPlanMessage,
    chatInputRef,
    onSubmit,
    onCancel,
    onPause,
    onExecutePlan,
    serverFilesPrefill
  } = _ref;
  const [hasInputValue, setHasInputValue] = react__WEBPACK_IMPORTED_MODULE_0__.useState(false);
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-center w-full mx-auto px-2 sm:px-3 md:px-4"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "animate-fade-in text-center mb-10"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h1", {
    className: "leading-tight"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
    className: "block text-5xl font-extrabold bg-gradient-to-br from-violet-500 via-purple-500 to-blue-500 bg-clip-text text-transparent",
    style: {
      letterSpacing: "-0.02em"
    }
  }, "Dr.Sai")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
    className: "text-base text-secondary animate-slide-up max-w-sm mx-auto leading-relaxed",
    style: {
      animationDelay: "0.15s"
    }
  }, "\u8F93\u5165\u6D88\u606F\u5F00\u59CB\u5BF9\u8BDD\uFF0C\u6216\u4ECE\u4E0B\u65B9\u9009\u62E9\u793A\u4F8B\u4EFB\u52A1"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-full space-y-6"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_chat_chatinput__WEBPACK_IMPORTED_MODULE_1__["default"], {
    ref: chatInputRef,
    onSubmit: function (query, files, accepted, plan, llm) {
      if (accepted === void 0) {
        accepted = false;
      }
      onSubmit(query, files, accepted, plan, llm);
    },
    error: error,
    onCancel: onCancel,
    runStatus: currentRun === null || currentRun === void 0 ? void 0 : currentRun.status,
    inputRequest: currentRun === null || currentRun === void 0 ? void 0 : currentRun.input_request,
    isPlanMessage: isPlanMessage,
    onPause: onPause,
    enable_upload: true,
    onExecutePlan: onExecutePlan,
    sessionId: sessionId,
    onTextChange: text => {
      setHasInputValue(text.trim().length > 0);
    },
    serverFilesPrefill: serverFilesPrefill
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_sampletasks__WEBPACK_IMPORTED_MODULE_2__["default"], {
    hasInputValue: hasInputValue,
    onSelect: task => {
      setTimeout(() => {
        if (chatInputRef.current) {
          chatInputRef.current.setValue(task);
        }
      }, 200);
    }
  }));
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
//# sourceMappingURL=component---src-pages-chat-welcome-screen-tsx-6118bb057a2d386ac0e4.js.map