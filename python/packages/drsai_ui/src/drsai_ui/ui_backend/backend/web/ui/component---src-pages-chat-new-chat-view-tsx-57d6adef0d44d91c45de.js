"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[3891,4321],{

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
/* harmony import */ var _chat_chatinput__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(42014);
/* harmony import */ var _sampletasks__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(64317);






const LOGO_BOX_BASE = "mb-4 flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl";

/** 有图：中性底 + contain，避免贴纸 logo 被裁切 */
const LOGO_IMAGE_BOX_CLASS = LOGO_BOX_BASE + " bg-light ring-1 ring-inset ring-border-primary/55 dark:bg-tertiary/50 dark:ring-border-primary/40";
function isMeaningfulAgentLogo(src) {
  if (!(src !== null && src !== void 0 && src.trim())) return false;
  const url = src.trim();
  if (/\/api\/placeholder\//i.test(url)) return false;
  if (/^data:image\/svg\+xml/i.test(url)) return false;
  return true;
}
function resolveLogoUrl(src) {
  const url = src.trim();
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  if (url.startsWith("/")) {
    return "" + window.location.origin + url;
  }
  return url;
}
function AgentHeaderLogo(_ref) {
  let {
    src
  } = _ref;
  const [loadFailed, setLoadFailed] = react__WEBPACK_IMPORTED_MODULE_2__.useState(false);
  const canShowImage = isMeaningfulAgentLogo(src) && !loadFailed;
  react__WEBPACK_IMPORTED_MODULE_2__.useEffect(() => {
    setLoadFailed(false);
  }, [src]);
  if (!canShowImage || !src) {
    return null;
  }
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: LOGO_IMAGE_BOX_CLASS
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("img", {
    src: resolveLogoUrl(src),
    alt: "",
    className: "h-10 w-10 object-contain p-0.5",
    onError: () => setLoadFailed(true)
  }));
}
/**
 * 新对话视图 - 当用户选中智能体但还没有创建会话时显示
 */
function NewChatView(_ref2) {
  var _ref3, _agentInfo$name, _agentInfo$descriptio, _agentInfo$logo;
  let {
    agent,
    onSubmit,
    serverFilesPrefill,
    suppressSampleTasks = false,
    onDismissSampleTasks
  } = _ref2;
  const chatInputRef = react__WEBPACK_IMPORTED_MODULE_2__.useRef(null);
  const [isSubmitting, setIsSubmitting] = react__WEBPACK_IMPORTED_MODULE_2__.useState(false);
  const [hasInputValue, setHasInputValue] = react__WEBPACK_IMPORTED_MODULE_2__.useState(false);
  const [hideSampleTasks, setHideSampleTasks] = react__WEBPACK_IMPORTED_MODULE_2__.useState(false);
  react__WEBPACK_IMPORTED_MODULE_2__.useEffect(() => {
    if (hasInputValue) {
      setHideSampleTasks(true);
    }
  }, [hasInputValue]);
  const {
    user
  } = react__WEBPACK_IMPORTED_MODULE_2__.useContext(_hooks_provider__WEBPACK_IMPORTED_MODULE_1__/* .appContext */ .v);
  const {
    agentInfo
  } = (0,_components_features_Agents_useAgentInfo__WEBPACK_IMPORTED_MODULE_0__/* .useAgentInfo */ .B)(user === null || user === void 0 ? void 0 : user.email);
  const displayName = (_ref3 = (_agentInfo$name = agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.name) !== null && _agentInfo$name !== void 0 ? _agentInfo$name : agent === null || agent === void 0 ? void 0 : agent.name) !== null && _ref3 !== void 0 ? _ref3 : "Dr.Sai";
  const description = (_agentInfo$descriptio = agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.description) !== null && _agentInfo$descriptio !== void 0 ? _agentInfo$descriptio : agent === null || agent === void 0 ? void 0 : agent.description;
  const logoSrc = (_agentInfo$logo = agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.logo) !== null && _agentInfo$logo !== void 0 ? _agentInfo$logo : agent === null || agent === void 0 ? void 0 : agent.logo;
  const handleSubmit = async function (query, files, accepted, plan) {
    if (accepted === void 0) {
      accepted = false;
    }
    if (isSubmitting || !query.trim() && (Array.isArray(files) ? files.length === 0 : false)) return;
    let finalQuery = query;
    if (!query.trim() && Array.isArray(files) && files.length > 0) {
      finalQuery = "请帮我分析这些文件。";
    }
    onDismissSampleTasks === null || onDismissSampleTasks === void 0 ? void 0 : onDismissSampleTasks();
    setHideSampleTasks(true);
    setIsSubmitting(true);
    try {
      await onSubmit(agentInfo !== null && agentInfo !== void 0 ? agentInfo : agent, finalQuery, files, plan);
    } finally {
      setIsSubmitting(false);
    }
  };
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "relative flex h-full flex-col overflow-hidden"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "pointer-events-none absolute inset-0 overflow-hidden",
    "aria-hidden": true
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "absolute left-1/2 top-[8%] h-48 w-[min(480px,85vw)] -translate-x-1/2 rounded-full bg-accent/[0.08] blur-3xl dark:bg-accent/[0.12]"
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "hide-scrollbar relative flex flex-1 items-start justify-center overflow-y-auto pt-10 sm:pt-14 md:pt-[9vh]"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("header", {
    className: "animate-fade-in mb-8 flex flex-col items-center text-center"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("p", {
    className: "font-agent-mono mb-3 text-[10px] font-medium uppercase tracking-[0.22em] text-accent"
  }, "\u65B0\u5BF9\u8BDD"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(AgentHeaderLogo, {
    src: logoSrc
  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("h1", {
    id: "new-chat-agent-title",
    className: "font-agent max-w-xl text-[1.75rem] font-bold leading-[1.15] tracking-[-0.03em] text-primary sm:text-4xl md:text-[2.5rem] break-words"
  }, displayName), description ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("p", {
    className: "mt-3 max-w-md text-[15px] leading-relaxed text-secondary sm:text-base"
  }, description) : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("p", {
    className: "mt-3 max-w-md text-[15px] leading-relaxed text-secondary/80 sm:text-base"
  }, "\u8F93\u5165\u6D88\u606F\u5F00\u59CB\uFF0C\u6216\u70B9\u9009\u4E0B\u65B9\u793A\u4F8B")), serverFilesPrefill && serverFilesPrefill.length > 0 && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "mb-5 text-left"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "rounded-2xl border border-border-primary/45 bg-tertiary/20 px-4 py-3 text-sm text-primary shadow-sm dark:bg-tertiary/30"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "mb-2 flex items-center gap-2 font-medium"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A, {
    className: "h-4 w-4 shrink-0 text-accent",
    "aria-hidden": true
  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", null, "\u5DF2\u4ECE\u5E93\u9009\u62E9 ", serverFilesPrefill.length, " \u4E2A\u6587\u4EF6")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("ul", {
    className: "space-y-1 text-xs text-secondary sm:text-sm"
  }, serverFilesPrefill.map(f => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("li", {
    key: f.uuid,
    className: "truncate font-agent-mono",
    title: f.name
  }, f.name))))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "pointer-events-none absolute -inset-x-2 -top-3 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent",
    "aria-hidden": true
  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(_chat_chatinput__WEBPACK_IMPORTED_MODULE_3__["default"], {
    ref: chatInputRef,
    composerLabelledBy: "new-chat-agent-title",
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
    onClear: () => {
      if (!suppressSampleTasks) {
        setHideSampleTasks(false);
      }
    },
    serverFilesPrefill: serverFilesPrefill
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement(_sampletasks__WEBPACK_IMPORTED_MODULE_4__["default"], {
    hidden: suppressSampleTasks || hideSampleTasks || hasInputValue || isSubmitting,
    onSelect: task => {
      var _chatInputRef$current;
      setHideSampleTasks(true);
      (_chatInputRef$current = chatInputRef.current) === null || _chatInputRef$current === void 0 ? void 0 : _chatInputRef$current.setValue(task);
    }
  }))));
}

/***/ }),

/***/ 64317:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ sampletasks; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./src/components/features/Agents/useAgentInfo.ts
var useAgentInfo = __webpack_require__(43044);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/arrow-up-right.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const ArrowUpRight = (0,createLucideIcon/* default */.A)("ArrowUpRight", [
  ["path", { d: "M7 7h10v10", key: "1tivn9" }],
  ["path", { d: "M7 17 17 7", key: "1vkiza" }]
]);


//# sourceMappingURL=arrow-up-right.js.map

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./src/pages/chat/sampletasks.tsx





const MARQUEE_THRESHOLD = 4;
const ROW_COUNT = 2;
const MARQUEE_ROW_DURATIONS = ["38s", "44s"];
const MARQUEE_MASK = {
  maskImage: "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
  WebkitMaskImage: "linear-gradient(to right, transparent, black 6%, black 94%, transparent)"
};
const isSlashCommand = text => /^\s*\//.test(text);
function splitIntoRows(items, rowCount) {
  const rows = Array.from({
    length: rowCount
  }, () => []);
  items.forEach((item, i) => {
    rows[i % rowCount].push(item);
  });
  return rows;
}

/** Pad sparse rows so the loop track is wide enough for a smooth marquee. */
function buildMarqueeLoop(items) {
  let segment = items;
  while (segment.length < 4) {
    segment = [].concat((0,toConsumableArray/* default */.A)(segment), (0,toConsumableArray/* default */.A)(items));
  }
  return [].concat((0,toConsumableArray/* default */.A)(segment), (0,toConsumableArray/* default */.A)(segment));
}
const TaskChip = _ref => {
  let {
    task,
    onSelect,
    duplicate = false,
    layout = "pill"
  } = _ref;
  const command = isSlashCommand(task);
  const label = command ? task.trim().split(/\s+/)[0] : task;
  const title = task.length > 48 ? task : command ? "\u4F7F\u7528 " + label : task;
  const isRow = layout === "row";
  return /*#__PURE__*/react.createElement("button", {
    type: "button",
    title: title,
    tabIndex: duplicate ? -1 : undefined,
    "aria-hidden": duplicate || undefined,
    onClick: () => onSelect(task),
    className: "group flex items-center gap-2 text-left text-sm transition-all duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 " + (isRow ? "w-full justify-between rounded-xl border px-4 py-3" : "inline-flex shrink-0 max-w-full gap-1.5 rounded-full border px-3.5 py-2") + " " + (command ? "border-accent/40 bg-accent/[0.08] font-agent-mono text-accent shadow-[0_0_0_1px_rgba(124,58,237,0.06)] hover:border-accent/60 hover:bg-accent/[0.14] dark:bg-accent/[0.12] dark:hover:bg-accent/[0.18]" : "border-border-primary/55 bg-tertiary/25 text-primary hover:border-accent/45 hover:bg-accent/[0.06] dark:bg-tertiary/35")
  }, /*#__PURE__*/react.createElement("span", {
    className: command ? "min-w-0 truncate" : isRow ? "min-w-0 flex-1 truncate" : "line-clamp-2 max-w-[16rem]"
  }, label), /*#__PURE__*/react.createElement(ArrowUpRight, {
    className: "h-3.5 w-3.5 shrink-0 transition-opacity duration-200 " + (isRow ? "text-secondary/50 group-hover:text-accent group-hover:opacity-100 group-focus-visible:text-accent" : "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70"),
    "aria-hidden": true
  }));
};
const MarqueeRow = _ref2 => {
  let {
    items,
    duration,
    onSelect
  } = _ref2;
  const loop = (0,react.useMemo)(() => buildMarqueeLoop(items), [items]);
  const segmentLen = loop.length / 2;
  return /*#__PURE__*/react.createElement("div", {
    className: "group/row relative overflow-hidden",
    style: MARQUEE_MASK
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex w-max gap-4 motion-reduce:animate-none animate-marquee-x group-hover/row:[animation-play-state:paused]",
    style: {
      ["--marquee-duration"]: duration
    }
  }, loop.map((task, idx) => /*#__PURE__*/react.createElement(TaskChip, {
    key: idx + "-" + task.slice(0, 24),
    task: task,
    onSelect: onSelect,
    duplicate: idx >= segmentLen
  }))));
};
const SampleTasks = _ref3 => {
  var _agentInfo$examples;
  let {
    onSelect,
    hidden
  } = _ref3;
  const {
    user
  } = (0,react.useContext)(provider/* appContext */.v);
  const {
    agentInfo
  } = (0,useAgentInfo/* useAgentInfo */.B)(user === null || user === void 0 ? void 0 : user.email);
  const examples = (_agentInfo$examples = agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.examples) !== null && _agentInfo$examples !== void 0 ? _agentInfo$examples : [];
  const useMarquee = examples.length > MARQUEE_THRESHOLD;
  const marqueeRows = (0,react.useMemo)(() => useMarquee ? splitIntoRows(examples, ROW_COUNT) : [], [examples, useMarquee]);
  if (!examples.length || hidden) {
    return null;
  }
  return /*#__PURE__*/react.createElement("section", {
    className: "mt-7 animate-fade-in",
    "aria-label": "\u793A\u4F8B\u4EFB\u52A1"
  }, /*#__PURE__*/react.createElement("div", {
    className: "mb-3 flex items-center justify-center gap-3"
  }, /*#__PURE__*/react.createElement("span", {
    className: "h-px w-10 bg-border-primary/60",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("span", {
    className: "font-agent-mono text-[10px] font-medium uppercase tracking-[0.18em] text-secondary"
  }, "\u8BD5\u8BD5\u8FD9\u4E9B"), /*#__PURE__*/react.createElement("span", {
    className: "h-px w-10 bg-border-primary/60",
    "aria-hidden": true
  })), useMarquee ? /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col gap-4"
  }, marqueeRows.map((rowItems, rowIdx) => {
    var _MARQUEE_ROW_DURATION;
    return rowItems.length > 0 ? /*#__PURE__*/react.createElement(MarqueeRow, {
      key: rowIdx,
      items: rowItems,
      duration: (_MARQUEE_ROW_DURATION = MARQUEE_ROW_DURATIONS[rowIdx]) !== null && _MARQUEE_ROW_DURATION !== void 0 ? _MARQUEE_ROW_DURATION : "40s",
      onSelect: onSelect
    }) : null;
  })) : /*#__PURE__*/react.createElement("ul", {
    className: "mx-auto flex w-full max-w-xl flex-col gap-2"
  }, examples.map((task, idx) => /*#__PURE__*/react.createElement("li", {
    key: idx + "-" + task.slice(0, 24)
  }, /*#__PURE__*/react.createElement(TaskChip, {
    task: task,
    onSelect: onSelect,
    layout: "row"
  })))));
};
/* harmony default export */ var sampletasks = (SampleTasks);

/***/ }),

/***/ 80827:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

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

/***/ 655:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var classof = __webpack_require__(36955);

var $String = String;

module.exports = function (argument) {
  if (classof(argument) === 'Symbol') throw new TypeError('Cannot convert a Symbol value to a string');
  return $String(argument);
};


/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-new-chat-view-tsx-57d6adef0d44d91c45de.js.map