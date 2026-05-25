"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[4321,5179],{

/***/ 34788:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": function() { return /* binding */ WelcomeScreen; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _chat_chatinput__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(42014);
/* harmony import */ var _sampletasks__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(64317);



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
    serverFilesPrefill,
    suppressSampleTasks = false
  } = _ref;
  const [hasInputValue, setHasInputValue] = react__WEBPACK_IMPORTED_MODULE_0__.useState(false);
  const [hideSampleTasks, setHideSampleTasks] = react__WEBPACK_IMPORTED_MODULE_0__.useState(suppressSampleTasks);
  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {
    if (hasInputValue || suppressSampleTasks) {
      setHideSampleTasks(true);
    }
  }, [hasInputValue, suppressSampleTasks]);
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
      setHideSampleTasks(true);
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
    onClear: () => {
      if (!suppressSampleTasks) {
        setHideSampleTasks(false);
      }
    },
    serverFilesPrefill: serverFilesPrefill
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_sampletasks__WEBPACK_IMPORTED_MODULE_2__["default"], {
    hidden: suppressSampleTasks || hideSampleTasks || hasInputValue,
    onSelect: task => {
      var _chatInputRef$current;
      setHideSampleTasks(true);
      (_chatInputRef$current = chatInputRef.current) === null || _chatInputRef$current === void 0 ? void 0 : _chatInputRef$current.setValue(task);
    }
  }));
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
//# sourceMappingURL=component---src-pages-chat-welcome-screen-tsx-f13387f113504c51e2f6.js.map