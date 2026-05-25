"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[4064,5723,9245],{

/***/ 5131:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ theme; }
});

// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var es = __webpack_require__(52187);
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
var context = __webpack_require__(49806);
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
  defaultSeed: context/* defaultConfig */.sb.token,
  useToken: theme_useToken,
  defaultAlgorithm: themes_default/* default */.A,
  darkAlgorithm: dark,
  compactAlgorithm: compact,
  getDesignToken: theme_getDesignToken,
  /**
   * @private Private variable
   * @warring 🔥 Do not use in production. 🔥
   */
  defaultConfig: context/* defaultConfig */.sb,
  /**
   * @private Private variable
   * @warring 🔥 Do not use in production. 🔥
   */
  _internalContext: context/* DesignTokenContext */.vG
});

/***/ }),

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

/***/ 26459:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

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
// EXTERNAL MODULE: ./node_modules/antd/es/spin/index.js + 6 modules
var spin = __webpack_require__(34716);
// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/antd/es/dropdown/index.js + 9 modules
var dropdown = __webpack_require__(91375);
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
// EXTERNAL MODULE: ./node_modules/react-dom/index.js
var react_dom = __webpack_require__(40961);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/search.js
var search = __webpack_require__(98445);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/share-2.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Share2 = (0,createLucideIcon/* default */.A)("Share2", [
  ["circle", { cx: "18", cy: "5", r: "3", key: "gq8acd" }],
  ["circle", { cx: "6", cy: "12", r: "3", key: "w7nqdw" }],
  ["circle", { cx: "18", cy: "19", r: "3", key: "1xt0gg" }],
  ["line", { x1: "8.59", x2: "15.42", y1: "13.51", y2: "17.49", key: "47mynk" }],
  ["line", { x1: "15.41", x2: "8.59", y1: "6.51", y2: "10.49", key: "1n3mei" }]
]);


//# sourceMappingURL=share-2.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/trash-2.js
var trash_2 = __webpack_require__(32708);
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
// EXTERNAL MODULE: ./src/hooks/store.tsx + 5 modules
var store = __webpack_require__(75625);
// EXTERNAL MODULE: ./src/store/modeConfig.tsx
var modeConfig = __webpack_require__(41025);
// EXTERNAL MODULE: ./src/components/features/Agents/useAgentInfo.ts
var useAgentInfo = __webpack_require__(43044);
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var es_tooltip = __webpack_require__(40367);
// EXTERNAL MODULE: ./node_modules/antd/es/input/index.js + 13 modules
var input = __webpack_require__(79365);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/PlusOutlined.js + 1 modules
var PlusOutlined = __webpack_require__(49237);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
;// ./node_modules/@ant-design/icons-svg/es/asn/UploadOutlined.js
// This icon file is generated automatically.
var UploadOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M400 317.7h73.9V656c0 4.4 3.6 8 8 8h60c4.4 0 8-3.6 8-8V317.7H624c6.7 0 10.4-7.7 6.3-12.9L518.3 163a8 8 0 00-12.6 0l-112 141.7c-4.1 5.3-.4 13 6.3 13zM878 626h-60c-4.4 0-8 3.6-8 8v154H214V634c0-4.4-3.6-8-8-8h-60c-4.4 0-8 3.6-8 8v198c0 17.7 14.3 32 32 32h684c17.7 0 32-14.3 32-32V634c0-4.4-3.6-8-8-8z" } }] }, "name": "upload", "theme": "outlined" };
/* harmony default export */ var asn_UploadOutlined = (UploadOutlined);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/UploadOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var UploadOutlined_UploadOutlined = function UploadOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_UploadOutlined
  }));
};

/**![upload](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTQwMCAzMTcuN2g3My45VjY1NmMwIDQuNCAzLjYgOCA4IDhoNjBjNC40IDAgOC0zLjYgOC04VjMxNy43SDYyNGM2LjcgMCAxMC40LTcuNyA2LjMtMTIuOUw1MTguMyAxNjNhOCA4IDAgMDAtMTIuNiAwbC0xMTIgMTQxLjdjLTQuMSA1LjMtLjQgMTMgNi4zIDEzek04NzggNjI2aC02MGMtNC40IDAtOCAzLjYtOCA4djE1NEgyMTRWNjM0YzAtNC40LTMuNi04LTgtOGgtNjBjLTQuNCAwLTggMy42LTggOHYxOThjMCAxNy43IDE0LjMgMzIgMzIgMzJoNjg0YzE3LjcgMCAzMi0xNC4zIDMyLTMyVjYzNGMwLTQuNC0zLjYtOC04LTh6IiAvPjwvc3ZnPg==) */
var RefIcon = /*#__PURE__*/react.forwardRef(UploadOutlined_UploadOutlined);
if (false) {}
/* harmony default export */ var icons_UploadOutlined = (RefIcon);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/SearchOutlined.js + 1 modules
var SearchOutlined = __webpack_require__(42877);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
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
// EXTERNAL MODULE: ./node_modules/antd/es/modal/index.js + 28 modules
var modal = __webpack_require__(56426);
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
if(onPlanSaved){onPlanSaved(updatedPlan);}}).catch(error=>{console.error("Failed to save plan on close:",error);});}}setIsModalOpen(false);if(isNew&&onEditComplete){onEditComplete();}};const handleSavePlan=async function(updatedSteps,isAutoSave){if(isAutoSave===void 0){isAutoSave=false;}try{if(isAutoSave){setIsAutoSaving(true);}const updatedPlan=Object.assign({},plan,{task:localTask,steps:updatedSteps});if(plan.id===undefined||plan.user_id===undefined){console.error("Cannot update plan: missing IDs");return;}await api/* planAPI */.a7.updatePlan(plan.id,updatedPlan,plan.user_id);if(onPlanSaved&&!isAutoSave&&!isAutoSaving){onPlanSaved(updatedPlan);}setIsAutoSaving(false);}catch(error){console.error("Failed to save plan:",error);setIsAutoSaving(false);}};const handleExport=e=>{e.stopPropagation();e.preventDefault();try{const planData=JSON.stringify(plan,null,2);const blob=new Blob([planData],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="plan-"+plan.id+"-"+plan.task.replace(/\s+/g,"-").toLowerCase()+".json";document.body.appendChild(link);link.click();document.body.removeChild(link);URL.revokeObjectURL(url);}catch(error){console.error("Failed to export plan:",error);}};const steps=plan.steps||[];return/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(card,{key:plan.id,title:/*#__PURE__*/react.createElement("div",{className:"flex justify-between items-center"},/*#__PURE__*/react.createElement("span",{className:"truncate max-w-[80%]",title:plan.task||"Untitled Plan"},plan.task||"Untitled Plan"),isHovering&&/*#__PURE__*/react.createElement("div",{className:"flex items-center ml-2"},/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:"Export plan as JSON file"},/*#__PURE__*/react.createElement("button",{className:"bg-transparent border-none cursor-pointer mr-2",onClick:handleExport,"aria-label":"Export plan"},/*#__PURE__*/react.createElement(download/* default */.A,{className:"h-5 w-5 transition-colors"}))),/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:"Delete this plan"},/*#__PURE__*/react.createElement("button",{className:"bg-transparent border-none cursor-pointer",onClick:handleDelete,"aria-label":"Delete plan"},/*#__PURE__*/react.createElement(trash_2/* default */.A,{className:"h-5 w-5 transition-colors"}))))),className:"shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col",onMouseEnter:()=>setIsHovering(true),onMouseLeave:()=>setIsHovering(false),actions:[/*#__PURE__*/react.createElement("div",{key:"use",className:"flex items-center justify-center h-full"},/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:"Create a new session with this plan loaded"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"text",className:"cursor-pointer flex items-center justify-center font-semibold transition-colors",onClick:()=>{if(onUsePlan)onUsePlan(plan);}},/*#__PURE__*/react.createElement(circle_play/* default */.A,{className:"h-4 w-4 mr-1"}),"Run Plan"))),/*#__PURE__*/react.createElement("div",{key:"edit",className:"flex items-center justify-center h-full"},/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:"Modify plan title and steps"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"text",className:"cursor-pointer flex items-center justify-center font-semibold transition-colors",onClick:handleEdit},/*#__PURE__*/react.createElement(Pen,{className:"h-4 w-4 mr-1"}),"Edit")))]},/*#__PURE__*/react.createElement("div",{className:"flex flex-col flex-grow justify-between"},/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("div",{className:"mb-4"},/*#__PURE__*/react.createElement("p",{className:"text-sm"},steps.length," steps")),/*#__PURE__*/react.createElement("div",{className:"space-y-2 min-h-[80px]"},steps.slice(0,3).map((step,idx)=>/*#__PURE__*/react.createElement("div",{key:idx,className:"text-xs border-l-2 border-gray-200 pl-2"},step.title||"Step "+(idx+1))),steps.length>3&&/*#__PURE__*/react.createElement("div",{className:"text-xs"},"+ ",steps.length-3," more steps"))),/*#__PURE__*/react.createElement("div",{className:"mt-4 text-xs flex items-center"},plan.created_at?/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(clock/* default */.A,{className:"h-3 w-3 mr-1"}),(0,atoms/* getRelativeTimeString */.vq)(plan.created_at)):""))),/*#__PURE__*/react.createElement(modal/* default */.A,{open:isModalOpen,onCancel:handleModalCancel,footer:null,width:800,destroyOnClose:true},isModalOpen&&/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement("div",{className:"mb-4"},/*#__PURE__*/react.createElement("label",{className:"block text-sm font-medium mb-1"},"Plan Title"),/*#__PURE__*/react.createElement(input/* default */.A,{type:"text",value:localTask,onChange:e=>setLocalTask(e.target.value),onPressEnter:()=>handleSavePlan(localSteps,false),placeholder:"Enter plan title"})),/*#__PURE__*/react.createElement(chat_plan["default"],{task:localTask,plan:localSteps,setPlan:setLocalSteps,viewOnly:false,onSavePlan:updatedSteps=>{handleSavePlan(updatedSteps,true);}}))));};/* harmony default export */ var Plans_PlanCard = (PlanCard);
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
const filteredPlans=plans.filter(plan=>plan.task.toLowerCase().includes(searchTerm.toLowerCase()));if(loading){return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full"},/*#__PURE__*/react.createElement(spin/* default */.A,{size:"large",tip:"Loading plans..."}));}if(error){return/*#__PURE__*/react.createElement("div",{className:"text-center p-8 text-red-500"},/*#__PURE__*/react.createElement("p",null,error),/*#__PURE__*/react.createElement("button",{className:"mt-4 px-4 py-2 bg-primary text-white rounded hover:bg-primary/80",onClick:()=>window.location.reload()},"Retry"));}return/*#__PURE__*/react.createElement("div",{className:"container mx-auto p-4 h-[calc(100vh-150px)] overflow-auto",onDragOver:handleDragOver,onDragLeave:handleDragLeave,onDrop:handleDrop,style:{border:isDragging?"2px dashed var(--color-primary)":"2px dashed transparent",transition:"border 0.2s ease",position:"relative"}},isDragging&&/*#__PURE__*/react.createElement("div",{style:{position:"absolute",top:0,left:0,right:0,bottom:0,display:"flex",alignItems:"center",justifyContent:"center",zIndex:10,pointerEvents:"none"}},/*#__PURE__*/react.createElement("div",{className:"text-xl font-semibold text-primary"},"Drop your plan file here to import")),/*#__PURE__*/react.createElement("div",{className:"flex justify-between items-center mb-6"},/*#__PURE__*/react.createElement("h1",{className:"text-2xl font-bold"},"Your Saved Plans"),/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2 w-1/3"},/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:"Create a new empty plan"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{icon:/*#__PURE__*/react.createElement(PlusOutlined/* default */.A,null),onClick:handleCreatePlan,className:"flex items-center"},"Create")),/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:"Import a plan from a JSON file"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{icon:/*#__PURE__*/react.createElement(icons_UploadOutlined,null),onClick:()=>{var _fileInputRef$current;return(_fileInputRef$current=fileInputRef.current)===null||_fileInputRef$current===void 0?void 0:_fileInputRef$current.click();},className:"flex items-center"},"Import")),/*#__PURE__*/react.createElement(input/* default */.A,{placeholder:"Search plans...",prefix:/*#__PURE__*/react.createElement(SearchOutlined/* default */.A,{className:"text-primary"}),value:searchTerm,onChange:e=>setSearchTerm(e.target.value),className:"rounded-md",allowClear:true}),/*#__PURE__*/react.createElement("input",{type:"file",ref:fileInputRef,onChange:handleFileUpload,accept:".json",style:{display:"none"}}))),/*#__PURE__*/react.createElement("div",{className:"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"},filteredPlans.length>0?filteredPlans.map(plan=>/*#__PURE__*/react.createElement("div",{key:plan.id,className:"h-full"},/*#__PURE__*/react.createElement(Plans_PlanCard,{plan:plan,onUsePlan:handleUsePlan,onPlanSaved:handlePlanSaved,onDeletePlan:handleDeletePlan,isNew:plan.id===newPlanId,onEditComplete:()=>setNewPlanId(null)}))):searchTerm?/*#__PURE__*/react.createElement("div",{className:"col-span-3 flex flex-col items-center justify-center py-12 text-primary"},/*#__PURE__*/react.createElement(SearchOutlined/* default */.A,{style:{fontSize:"48px",marginBottom:"16px"}}),/*#__PURE__*/react.createElement("p",null,"No plans found matching \"",searchTerm,"\""),/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"link",onClick:()=>setSearchTerm(""),className:"mt-2"},"Clear search")):/*#__PURE__*/react.createElement("div",{className:"col-span-3 flex flex-col items-center justify-center py-12 text-primary"},/*#__PURE__*/react.createElement("p",null,"No plans yet. Create one or import an existing plan."))));};/* harmony default export */ var Plans_PlanList = (PlanList);
// EXTERNAL MODULE: ./src/components/store.tsx
var components_store = __webpack_require__(32134);
// EXTERNAL MODULE: ./src/pages/chat/chat.tsx + 7 modules
var chat = __webpack_require__(39359);
// EXTERNAL MODULE: ./src/pages/chat/NewChatView.tsx
var NewChatView = __webpack_require__(13907);
// EXTERNAL MODULE: ./src/components/views/hooks/useAgentManager.ts + 1 modules
var useAgentManager = __webpack_require__(19907);
// EXTERNAL MODULE: ./src/hooks/useRouter.ts
var useRouter = __webpack_require__(13555);
;// ./src/components/views/hooks/useSessionStorage.ts
/**
 * LocalStorage utilities for session persistence
 */const SESSION_STORAGE_KEY='current_session_id';const SELECTED_AGENT_KEY='selected_agent';const useSessionStorage=()=>{const saveSessionId=sessionId=>{if(typeof window!=="undefined"){if(sessionId){localStorage.setItem(SESSION_STORAGE_KEY,sessionId.toString());}else{localStorage.removeItem(SESSION_STORAGE_KEY);}}};const getSessionId=()=>{if(typeof window!=="undefined"){const stored=localStorage.getItem(SESSION_STORAGE_KEY);return stored?parseInt(stored,10):null;}return null;};return{saveSessionId,getSessionId};};
;// ./src/components/views/hooks/useSessionManager.ts
const useSessionManager=_ref=>{let{userEmail,onSuccess,onError}=_ref;const{session,setSession,sessions,setSessions}=(0,store/* useConfigStore */.J)();const{selectedAgent,setSelectedAgent,setMode,setConfig,setAgentId,setAgentInfo}=(0,modeConfig/* useModeConfigStore */.Q)();const{saveSessionId,getSessionId}=useSessionStorage();const{0:isLoading,1:setIsLoading}=(0,react.useState)(false);const{0:isSessionLoading,1:setIsSessionLoading}=(0,react.useState)(false);const{0:sessionRunStatuses,1:setSessionRunStatuses}=(0,react.useState)({});const{0:pendingFirstMessage,1:setPendingFirstMessage}=(0,react.useState)(null);// 标记用户主动清空session（使用 ref 避免状态更新延迟）
const{0:isIntentionalSessionClear,1:setIsIntentionalSessionClear}=(0,react.useState)(false);const isIntentionalSessionClearRef=(0,react.useRef)(false);const hasInitializedRef=(0,react.useRef)(false);const lastUserEmailRef=(0,react.useRef)(userEmail);// Reset initialization flag when user changes
if(lastUserEmailRef.current!==userEmail){lastUserEmailRef.current=userEmail;hasInitializedRef.current=false;}// Fetch sessions from API
const fetchSessions=(0,react.useCallback)(async()=>{if(!userEmail)return;try{setIsLoading(true);const data=await api/* sessionAPI */.jT.listSessions(userEmail);setSessions(data);// Only auto-load session on initial fetch
if(!hasInitializedRef.current){hasInitializedRef.current=true;// Check URL params - only load session if explicitly specified in URL
const params=new URLSearchParams(window.location.search);const urlSessionId=params.get("sessionId");if(urlSessionId){// Load session from URL
const sessionIdNum=parseInt(urlSessionId,10);const sessionToLoad=data.find(s=>s.id===sessionIdNum)||null;if(sessionToLoad&&!session){try{const fullSessionData=await api/* sessionAPI */.jT.getSession(sessionToLoad.id,userEmail);setSession(fullSessionData);// Reset intentional clear flag
isIntentionalSessionClearRef.current=false;setIsIntentionalSessionClear(false);// Update agent config
if(fullSessionData.agent_mode_config){var _ref2,_agent_id,_fullSessionData$agen,_fullSessionData$agen2;setSelectedAgent(fullSessionData.agent_mode_config);setMode(fullSessionData.agent_mode_config.mode);const sid=(_ref2=(_agent_id=(_fullSessionData$agen=fullSessionData.agent_mode_config)===null||_fullSessionData$agen===void 0?void 0:_fullSessionData$agen.agent_id)!==null&&_agent_id!==void 0?_agent_id:(_fullSessionData$agen2=fullSessionData.agent_mode_config)===null||_fullSessionData$agen2===void 0?void 0:_fullSessionData$agen2.id)!==null&&_ref2!==void 0?_ref2:null;if(sid)setAgentId(String(sid));setAgentInfo(fullSessionData.agent_mode_config);try{const agentConfig=await api/* agentAPI */.cM.getAgentConfig(userEmail,fullSessionData.agent_mode_config.mode);if(agentConfig){setConfig(agentConfig.config);}}catch(e){console.warn("Failed to load agent config:",e);}}window.history.pushState({},"","?sessionId="+sessionToLoad.id);}catch(error){console.error("Error loading session details:",error);}}}else{// No URL sessionId - clear localStorage and don't auto-load any session
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
if(data.agent_mode_config){var _ref3,_agent_id2,_data$agent_mode_conf,_data$agent_mode_conf2;setSelectedAgent(data.agent_mode_config);setMode(data.agent_mode_config.mode);const sid=(_ref3=(_agent_id2=(_data$agent_mode_conf=data.agent_mode_config)===null||_data$agent_mode_conf===void 0?void 0:_data$agent_mode_conf.agent_id)!==null&&_agent_id2!==void 0?_agent_id2:(_data$agent_mode_conf2=data.agent_mode_config)===null||_data$agent_mode_conf2===void 0?void 0:_data$agent_mode_conf2.id)!==null&&_ref3!==void 0?_ref3:null;if(sid)setAgentId(String(sid));setAgentInfo(data.agent_mode_config);try{const agentConfig=await api/* agentAPI */.cM.getAgentConfig(userEmail,data.agent_mode_config.mode);if(agentConfig){setConfig(agentConfig.config);}}catch(e){console.warn("Failed to load agent config:",e);}}window.history.pushState({},"","?sessionId="+selectedSession.id);}catch(error){console.error("Error loading session:",error);if(error instanceof Error&&error.message.includes("Failed to fetch session")){saveSessionId(null);}onError===null||onError===void 0?void 0:onError("Error loading session");window.history.pushState({},"",window.location.pathname);if(Array.isArray(sessions)&&sessions.length>0){setSession(sessions[0]);if(sessions[0].agent_mode_config){setSelectedAgent(sessions[0].agent_mode_config);setMode(sessions[0].agent_mode_config.mode||"");}}else{setSession(null);setSelectedAgent(null);setMode("");setConfig({});}}finally{setIsLoading(false);setIsSessionLoading(false);}},[userEmail,isSessionLoading,sessions,setSession,setSelectedAgent,setMode,setConfig,saveSessionId,onError]);// Create default session
const createDefaultSession=(0,react.useCallback)(async()=>{if(!userEmail)return;try{setIsLoading(true);const defaultName="Default Session - "+new Date().toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"});const created=await api/* sessionAPI */.jT.createSession({name:defaultName,agent_mode_config:{}},userEmail);setSessions([created].concat((0,toConsumableArray/* default */.A)(Array.isArray(sessions)?sessions:[])));setSession(created);if(created.id){window.history.pushState({},"","?sessionId="+created.id);}}catch(error){console.error("Error creating default session:",error);onError===null||onError===void 0?void 0:onError("Error creating default session");}finally{setIsLoading(false);}},[userEmail,sessions,setSessions,setSession,onError]);// Create new chat session with first message
const createNewChatSession=(0,react.useCallback)(async function(agent,query,files,plan){if(files===void 0){files=[];}if(!userEmail){onError===null||onError===void 0?void 0:onError("User not logged in");return;}try{var _ref4,_defult_config_name,_config,_agent_config;setIsLoading(true);// 1. 保存待发送的消息
setPendingFirstMessage({query,files,plan});// 2. 创建新会话
const sessionData={name:query.slice(0,50)||agent.name+" Chat",agent_mode_config:Object.assign({// Persist agent identity to avoid "crossed agent" on later continues.
id:agent.id,agent_id:agent.id,mode:agent.mode,name:agent.name,// Ensure per-agent default config label is stored with the session.
defult_config_name:(_ref4=(_defult_config_name=agent===null||agent===void 0?void 0:agent.defult_config_name)!==null&&_defult_config_name!==void 0?_defult_config_name:agent===null||agent===void 0?void 0:(_config=agent.config)===null||_config===void 0?void 0:_config.defult_config_name)!==null&&_ref4!==void 0?_ref4:agent===null||agent===void 0?void 0:(_agent_config=agent.agent_config)===null||_agent_config===void 0?void 0:_agent_config.defult_config_name},agent.config)};const created=await api/* sessionAPI */.jT.createSession(sessionData,userEmail);// 3. 更新会话列表和当前会话
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
// EXTERNAL MODULE: ./src/components/utils.ts
var utils = __webpack_require__(70870);
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
// EXTERNAL MODULE: ./src/pages/FilePreviewPage.tsx + 29 modules
var FilePreviewPage = __webpack_require__(52078);
// EXTERNAL MODULE: ./src/pages/settings/LogsPage.tsx
var LogsPage = __webpack_require__(33037);
// EXTERNAL MODULE: ./src/pages/settings/Config.tsx + 14 modules
var Config = __webpack_require__(30999);
// EXTERNAL MODULE: ./src/pages/UserManagementPage.tsx + 3 modules
var UserManagementPage = __webpack_require__(94024);
// EXTERNAL MODULE: ./src/components/views/menuRoutes.ts
var menuRoutes = __webpack_require__(89993);
// EXTERNAL MODULE: ./src/utils/apiDatetime.ts
var apiDatetime = __webpack_require__(51037);
// EXTERNAL MODULE: ./node_modules/antd/es/form/context.js
var form_context = __webpack_require__(94241);
// EXTERNAL MODULE: ./node_modules/rc-motion/es/index.js + 13 modules
var rc_motion_es = __webpack_require__(90754);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/motion.js
var motion = __webpack_require__(23723);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
;// ./node_modules/antd/es/form/hooks/useDebounce.js

function useDebounce(value) {
  const [cacheValue, setCacheValue] = react.useState(value);
  react.useEffect(() => {
    const timeout = setTimeout(() => {
      setCacheValue(value);
    }, value.length ? 0 : 10);
    return () => {
      clearTimeout(timeout);
    };
  }, [value]);
  return cacheValue;
}
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/zoom.js
var zoom = __webpack_require__(99077);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/collapse.js
var collapse = __webpack_require__(60977);
;// ./node_modules/antd/es/form/style/explain.js
const genFormValidateMotionStyle = token => {
  const {
    componentCls
  } = token;
  const helpCls = `${componentCls}-show-help`;
  const helpItemCls = `${componentCls}-show-help-item`;
  return {
    [helpCls]: {
      // Explain holder
      transition: `opacity ${token.motionDurationFast} ${token.motionEaseInOut}`,
      '&-appear, &-enter': {
        opacity: 0,
        '&-active': {
          opacity: 1
        }
      },
      '&-leave': {
        opacity: 1,
        '&-active': {
          opacity: 0
        }
      },
      // Explain
      [helpItemCls]: {
        overflow: 'hidden',
        transition: `height ${token.motionDurationFast} ${token.motionEaseInOut},
                     opacity ${token.motionDurationFast} ${token.motionEaseInOut},
                     transform ${token.motionDurationFast} ${token.motionEaseInOut} !important`,
        [`&${helpItemCls}-appear, &${helpItemCls}-enter`]: {
          transform: `translateY(-5px)`,
          opacity: 0,
          '&-active': {
            transform: 'translateY(0)',
            opacity: 1
          }
        },
        [`&${helpItemCls}-leave-active`]: {
          transform: `translateY(-5px)`
        }
      }
    }
  };
};
/* harmony default export */ var explain = (genFormValidateMotionStyle);
;// ./node_modules/antd/es/form/style/index.js





const resetForm = token => ({
  legend: {
    display: 'block',
    width: '100%',
    marginBottom: token.marginLG,
    padding: 0,
    color: token.colorTextDescription,
    fontSize: token.fontSizeLG,
    lineHeight: 'inherit',
    border: 0,
    borderBottom: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`
  },
  'input[type="search"]': {
    boxSizing: 'border-box'
  },
  // Position radios and checkboxes better
  'input[type="radio"], input[type="checkbox"]': {
    lineHeight: 'normal'
  },
  'input[type="file"]': {
    display: 'block'
  },
  // Make range inputs behave like textual form controls
  'input[type="range"]': {
    display: 'block',
    width: '100%'
  },
  // Make multiple select elements height not fixed
  'select[multiple], select[size]': {
    height: 'auto'
  },
  // Focus for file, radio, and checkbox
  [`input[type='file']:focus,
  input[type='radio']:focus,
  input[type='checkbox']:focus`]: {
    outline: 0,
    boxShadow: `0 0 0 ${(0,es/* unit */.zA)(token.controlOutlineWidth)} ${token.controlOutline}`
  },
  // Adjust output element
  output: {
    display: 'block',
    paddingTop: 15,
    color: token.colorText,
    fontSize: token.fontSize,
    lineHeight: token.lineHeight
  }
});
const genFormSize = (token, height) => {
  const {
    formItemCls
  } = token;
  return {
    [formItemCls]: {
      [`${formItemCls}-label > label`]: {
        height
      },
      [`${formItemCls}-control-input`]: {
        minHeight: height
      }
    }
  };
};
const genFormStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [token.componentCls]: Object.assign(Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), resetForm(token)), {
      [`${componentCls}-text`]: {
        display: 'inline-block',
        paddingInlineEnd: token.paddingSM
      },
      // ================================================================
      // =                             Size                             =
      // ================================================================
      '&-small': Object.assign({}, genFormSize(token, token.controlHeightSM)),
      '&-large': Object.assign({}, genFormSize(token, token.controlHeightLG))
    })
  };
};
const genFormItemStyle = token => {
  const {
    formItemCls,
    iconCls,
    componentCls,
    rootPrefixCls,
    antCls,
    labelRequiredMarkColor,
    labelColor,
    labelFontSize,
    labelHeight,
    labelColonMarginInlineStart,
    labelColonMarginInlineEnd,
    itemMarginBottom
  } = token;
  return {
    [formItemCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      marginBottom: itemMarginBottom,
      verticalAlign: 'top',
      '&-with-help': {
        transition: 'none'
      },
      [`&-hidden,
        &-hidden${antCls}-row`]: {
        // https://github.com/ant-design/ant-design/issues/26141
        display: 'none'
      },
      '&-has-warning': {
        [`${formItemCls}-split`]: {
          color: token.colorError
        }
      },
      '&-has-error': {
        [`${formItemCls}-split`]: {
          color: token.colorWarning
        }
      },
      // ==============================================================
      // =                            Label                           =
      // ==============================================================
      [`${formItemCls}-label`]: {
        flexGrow: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textAlign: 'end',
        verticalAlign: 'middle',
        '&-left': {
          textAlign: 'start'
        },
        '&-wrap': {
          overflow: 'unset',
          lineHeight: token.lineHeight,
          whiteSpace: 'unset'
        },
        '> label': {
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          maxWidth: '100%',
          height: labelHeight,
          color: labelColor,
          fontSize: labelFontSize,
          [`> ${iconCls}`]: {
            fontSize: token.fontSize,
            verticalAlign: 'top'
          },
          // Required mark
          [`&${formItemCls}-required:not(${formItemCls}-required-mark-optional)::before`]: {
            display: 'inline-block',
            marginInlineEnd: token.marginXXS,
            color: labelRequiredMarkColor,
            fontSize: token.fontSize,
            fontFamily: 'SimSun, sans-serif',
            lineHeight: 1,
            content: '"*"',
            [`${componentCls}-hide-required-mark &`]: {
              display: 'none'
            }
          },
          // Optional mark
          [`${formItemCls}-optional`]: {
            display: 'inline-block',
            marginInlineStart: token.marginXXS,
            color: token.colorTextDescription,
            [`${componentCls}-hide-required-mark &`]: {
              display: 'none'
            }
          },
          // Optional mark
          [`${formItemCls}-tooltip`]: {
            color: token.colorTextDescription,
            cursor: 'help',
            writingMode: 'horizontal-tb',
            marginInlineStart: token.marginXXS
          },
          '&::after': {
            content: '":"',
            position: 'relative',
            marginBlock: 0,
            marginInlineStart: labelColonMarginInlineStart,
            marginInlineEnd: labelColonMarginInlineEnd
          },
          [`&${formItemCls}-no-colon::after`]: {
            content: '"\\a0"'
          }
        }
      },
      // ==============================================================
      // =                            Input                           =
      // ==============================================================
      [`${formItemCls}-control`]: {
        ['--ant-display']: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        [`&:first-child:not([class^="'${rootPrefixCls}-col-'"]):not([class*="' ${rootPrefixCls}-col-'"])`]: {
          width: '100%'
        },
        '&-input': {
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          minHeight: token.controlHeight,
          '&-content': {
            flex: 'auto',
            maxWidth: '100%'
          }
        }
      },
      // ==============================================================
      // =                           Explain                          =
      // ==============================================================
      [formItemCls]: {
        '&-additional': {
          display: 'flex',
          flexDirection: 'column'
        },
        '&-explain, &-extra': {
          clear: 'both',
          color: token.colorTextDescription,
          fontSize: token.fontSize,
          lineHeight: token.lineHeight
        },
        '&-explain-connected': {
          width: '100%'
        },
        '&-extra': {
          minHeight: token.controlHeightSM,
          transition: `color ${token.motionDurationMid} ${token.motionEaseOut}` // sync input color transition
        },
        '&-explain': {
          '&-error': {
            color: token.colorError
          },
          '&-warning': {
            color: token.colorWarning
          }
        }
      },
      [`&-with-help ${formItemCls}-explain`]: {
        height: 'auto',
        opacity: 1
      },
      // ==============================================================
      // =                        Feedback Icon                       =
      // ==============================================================
      [`${formItemCls}-feedback-icon`]: {
        fontSize: token.fontSize,
        textAlign: 'center',
        visibility: 'visible',
        animationName: zoom/* zoomIn */.nF,
        animationDuration: token.motionDurationMid,
        animationTimingFunction: token.motionEaseOutBack,
        pointerEvents: 'none',
        '&-success': {
          color: token.colorSuccess
        },
        '&-error': {
          color: token.colorError
        },
        '&-warning': {
          color: token.colorWarning
        },
        '&-validating': {
          color: token.colorPrimary
        }
      }
    })
  };
};
const genHorizontalStyle = (token, className) => {
  const {
    formItemCls
  } = token;
  return {
    [`${className}-horizontal`]: {
      [`${formItemCls}-label`]: {
        flexGrow: 0
      },
      [`${formItemCls}-control`]: {
        flex: '1 1 0',
        // https://github.com/ant-design/ant-design/issues/32777
        // https://github.com/ant-design/ant-design/issues/33773
        minWidth: 0
      },
      // Do not change this to `ant-col-24`! `-24` match all the responsive rules
      // https://github.com/ant-design/ant-design/issues/32980
      // https://github.com/ant-design/ant-design/issues/34903
      // https://github.com/ant-design/ant-design/issues/44538
      [`${formItemCls}-label[class$='-24'], ${formItemCls}-label[class*='-24 ']`]: {
        [`& + ${formItemCls}-control`]: {
          minWidth: 'unset'
        }
      }
    }
  };
};
const genInlineStyle = token => {
  const {
    componentCls,
    formItemCls,
    inlineItemMarginBottom
  } = token;
  return {
    [`${componentCls}-inline`]: {
      display: 'flex',
      flexWrap: 'wrap',
      [formItemCls]: {
        flex: 'none',
        marginInlineEnd: token.margin,
        marginBottom: inlineItemMarginBottom,
        '&-row': {
          flexWrap: 'nowrap'
        },
        [`> ${formItemCls}-label,
        > ${formItemCls}-control`]: {
          display: 'inline-block',
          verticalAlign: 'top'
        },
        [`> ${formItemCls}-label`]: {
          flex: 'none'
        },
        [`${componentCls}-text`]: {
          display: 'inline-block'
        },
        [`${formItemCls}-has-feedback`]: {
          display: 'inline-block'
        }
      }
    }
  };
};
const makeVerticalLayoutLabel = token => ({
  padding: token.verticalLabelPadding,
  margin: token.verticalLabelMargin,
  whiteSpace: 'initial',
  textAlign: 'start',
  '> label': {
    margin: 0,
    '&::after': {
      // https://github.com/ant-design/ant-design/issues/43538
      visibility: 'hidden'
    }
  }
});
const makeVerticalLayout = token => {
  const {
    componentCls,
    formItemCls,
    rootPrefixCls
  } = token;
  return {
    [`${formItemCls} ${formItemCls}-label`]: makeVerticalLayoutLabel(token),
    // ref: https://github.com/ant-design/ant-design/issues/45122
    [`${componentCls}:not(${componentCls}-inline)`]: {
      [formItemCls]: {
        flexWrap: 'wrap',
        [`${formItemCls}-label, ${formItemCls}-control`]: {
          // When developer pass `xs: { span }`,
          // It should follow the `xs` screen config
          // ref: https://github.com/ant-design/ant-design/issues/44386
          [`&:not([class*=" ${rootPrefixCls}-col-xs"])`]: {
            flex: '0 0 100%',
            maxWidth: '100%'
          }
        }
      }
    }
  };
};
const genVerticalStyle = token => {
  const {
    componentCls,
    formItemCls,
    antCls
  } = token;
  return {
    [`${componentCls}-vertical`]: {
      [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
        [`${formItemCls}-row`]: {
          flexDirection: 'column'
        },
        [`${formItemCls}-label > label`]: {
          height: 'auto'
        },
        [`${formItemCls}-control`]: {
          width: '100%'
        },
        [`${formItemCls}-label,
        ${antCls}-col-24${formItemCls}-label,
        ${antCls}-col-xl-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    },
    [`@media (max-width: ${(0,es/* unit */.zA)(token.screenXSMax)})`]: [makeVerticalLayout(token), {
      [componentCls]: {
        [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
          [`${antCls}-col-xs-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
        }
      }
    }],
    [`@media (max-width: ${(0,es/* unit */.zA)(token.screenSMMax)})`]: {
      [componentCls]: {
        [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
          [`${antCls}-col-sm-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
        }
      }
    },
    [`@media (max-width: ${(0,es/* unit */.zA)(token.screenMDMax)})`]: {
      [componentCls]: {
        [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
          [`${antCls}-col-md-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
        }
      }
    },
    [`@media (max-width: ${(0,es/* unit */.zA)(token.screenLGMax)})`]: {
      [componentCls]: {
        [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
          [`${antCls}-col-lg-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
        }
      }
    }
  };
};
const genItemVerticalStyle = token => {
  const {
    formItemCls,
    antCls
  } = token;
  return {
    [`${formItemCls}-vertical`]: {
      [`${formItemCls}-row`]: {
        flexDirection: 'column'
      },
      [`${formItemCls}-label > label`]: {
        height: 'auto'
      },
      [`${formItemCls}-control`]: {
        width: '100%'
      }
    },
    [`${formItemCls}-vertical ${formItemCls}-label,
      ${antCls}-col-24${formItemCls}-label,
      ${antCls}-col-xl-24${formItemCls}-label`]: makeVerticalLayoutLabel(token),
    [`@media (max-width: ${(0,es/* unit */.zA)(token.screenXSMax)})`]: [makeVerticalLayout(token), {
      [formItemCls]: {
        [`${antCls}-col-xs-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    }],
    [`@media (max-width: ${(0,es/* unit */.zA)(token.screenSMMax)})`]: {
      [formItemCls]: {
        [`${antCls}-col-sm-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    },
    [`@media (max-width: ${(0,es/* unit */.zA)(token.screenMDMax)})`]: {
      [formItemCls]: {
        [`${antCls}-col-md-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    },
    [`@media (max-width: ${(0,es/* unit */.zA)(token.screenLGMax)})`]: {
      [formItemCls]: {
        [`${antCls}-col-lg-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    }
  };
};
// ============================== Export ==============================
const style_prepareComponentToken = token => ({
  labelRequiredMarkColor: token.colorError,
  labelColor: token.colorTextHeading,
  labelFontSize: token.fontSize,
  labelHeight: token.controlHeight,
  labelColonMarginInlineStart: token.marginXXS / 2,
  labelColonMarginInlineEnd: token.marginXS,
  itemMarginBottom: token.marginLG,
  verticalLabelPadding: `0 0 ${token.paddingXS}px`,
  verticalLabelMargin: 0,
  inlineItemMarginBottom: 0
});
const prepareToken = (token, rootPrefixCls) => {
  const formToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    formItemCls: `${token.componentCls}-item`,
    rootPrefixCls
  });
  return formToken;
};
/* harmony default export */ var form_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Form', (token, _ref) => {
  let {
    rootPrefixCls
  } = _ref;
  const formToken = prepareToken(token, rootPrefixCls);
  return [genFormStyle(formToken), genFormItemStyle(formToken), explain(formToken), genHorizontalStyle(formToken, formToken.componentCls), genHorizontalStyle(formToken, formToken.formItemCls), genInlineStyle(formToken), genVerticalStyle(formToken), genItemVerticalStyle(formToken), (0,collapse/* default */.A)(formToken), zoom/* zoomIn */.nF];
}, style_prepareComponentToken, {
  // Let From style before the Grid
  // ref https://github.com/ant-design/ant-design/issues/44386
  order: -1000
}));
;// ./node_modules/antd/es/form/ErrorList.js
"use client";











const EMPTY_LIST = [];
function toErrorEntity(error, prefix, errorStatus) {
  let index = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;
  return {
    key: typeof error === 'string' ? error : `${prefix}-${index}`,
    error,
    errorStatus
  };
}
const ErrorList = _ref => {
  let {
    help,
    helpStatus,
    errors = EMPTY_LIST,
    warnings = EMPTY_LIST,
    className: rootClassName,
    fieldId,
    onVisibleChanged
  } = _ref;
  const {
    prefixCls
  } = react.useContext(form_context/* FormItemPrefixContext */.hb);
  const baseClassName = `${prefixCls}-item-explain`;
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = form_style(prefixCls, rootCls);
  const collapseMotion = (0,react.useMemo)(() => (0,motion/* default */.A)(prefixCls), [prefixCls]);
  // We have to debounce here again since somewhere use ErrorList directly still need no shaking
  // ref: https://github.com/ant-design/ant-design/issues/36336
  const debounceErrors = useDebounce(errors);
  const debounceWarnings = useDebounce(warnings);
  const fullKeyList = react.useMemo(() => {
    if (help !== undefined && help !== null) {
      return [toErrorEntity(help, 'help', helpStatus)];
    }
    return [].concat((0,toConsumableArray/* default */.A)(debounceErrors.map((error, index) => toErrorEntity(error, 'error', 'error', index))), (0,toConsumableArray/* default */.A)(debounceWarnings.map((warning, index) => toErrorEntity(warning, 'warning', 'warning', index))));
  }, [help, helpStatus, debounceErrors, debounceWarnings]);
  const filledKeyFullKeyList = react.useMemo(() => {
    const keysCount = {};
    fullKeyList.forEach(_ref2 => {
      let {
        key
      } = _ref2;
      keysCount[key] = (keysCount[key] || 0) + 1;
    });
    return fullKeyList.map((entity, index) => Object.assign(Object.assign({}, entity), {
      key: keysCount[entity.key] > 1 ? `${entity.key}-fallback-${index}` : entity.key
    }));
  }, [fullKeyList]);
  const helpProps = {};
  if (fieldId) {
    helpProps.id = `${fieldId}_help`;
  }
  return wrapCSSVar(/*#__PURE__*/react.createElement(rc_motion_es/* default */.Ay, {
    motionDeadline: collapseMotion.motionDeadline,
    motionName: `${prefixCls}-show-help`,
    visible: !!filledKeyFullKeyList.length,
    onVisibleChanged: onVisibleChanged
  }, holderProps => {
    const {
      className: holderClassName,
      style: holderStyle
    } = holderProps;
    return /*#__PURE__*/react.createElement("div", Object.assign({}, helpProps, {
      className: classnames_default()(baseClassName, holderClassName, cssVarCls, rootCls, rootClassName, hashId),
      style: holderStyle,
      role: "alert"
    }), /*#__PURE__*/react.createElement(rc_motion_es/* CSSMotionList */.aF, Object.assign({
      keys: filledKeyFullKeyList
    }, (0,motion/* default */.A)(prefixCls), {
      motionName: `${prefixCls}-show-help-item`,
      component: false
    }), itemProps => {
      const {
        key,
        error,
        errorStatus,
        className: itemClassName,
        style: itemStyle
      } = itemProps;
      return /*#__PURE__*/react.createElement("div", {
        key: key,
        className: classnames_default()(itemClassName, {
          [`${baseClassName}-${errorStatus}`]: errorStatus
        }),
        style: itemStyle
      }, error);
    }));
  }));
};
/* harmony default export */ var form_ErrorList = (ErrorList);
// EXTERNAL MODULE: ./node_modules/rc-field-form/es/index.js + 41 modules
var rc_field_form_es = __webpack_require__(93592);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/DisabledContext.js
var DisabledContext = __webpack_require__(98119);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/SizeContext.js
var SizeContext = __webpack_require__(48224);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/findDOMNode.js
var findDOMNode = __webpack_require__(66588);
;// ./node_modules/compute-scroll-into-view/dist/index.js
const t=t=>"object"==typeof t&&null!=t&&1===t.nodeType,e=(t,e)=>(!e||"hidden"!==t)&&("visible"!==t&&"clip"!==t),n=(t,n)=>{if(t.clientHeight<t.scrollHeight||t.clientWidth<t.scrollWidth){const o=getComputedStyle(t,null);return e(o.overflowY,n)||e(o.overflowX,n)||(t=>{const e=(t=>{if(!t.ownerDocument||!t.ownerDocument.defaultView)return null;try{return t.ownerDocument.defaultView.frameElement}catch(t){return null}})(t);return!!e&&(e.clientHeight<t.scrollHeight||e.clientWidth<t.scrollWidth)})(t)}return!1},o=(t,e,n,o,l,r,i,s)=>r<t&&i>e||r>t&&i<e?0:r<=t&&s<=n||i>=e&&s>=n?r-t-o:i>e&&s<n||r<t&&s>n?i-e+l:0,l=t=>{const e=t.parentElement;return null==e?t.getRootNode().host||null:e},dist_r=(e,r)=>{var i,s,d,h;if("undefined"==typeof document)return[];const{scrollMode:c,block:f,inline:u,boundary:a,skipOverflowHiddenElements:g}=r,p="function"==typeof a?a:t=>t!==a;if(!t(e))throw new TypeError("Invalid target");const m=document.scrollingElement||document.documentElement,w=[];let W=e;for(;t(W)&&p(W);){if(W=l(W),W===m){w.push(W);break}null!=W&&W===document.body&&n(W)&&!n(document.documentElement)||null!=W&&n(W,g)&&w.push(W)}const b=null!=(s=null==(i=window.visualViewport)?void 0:i.width)?s:innerWidth,H=null!=(h=null==(d=window.visualViewport)?void 0:d.height)?h:innerHeight,{scrollX:y,scrollY:M}=window,{height:v,width:E,top:x,right:C,bottom:I,left:R}=e.getBoundingClientRect(),{top:T,right:B,bottom:F,left:V}=(t=>{const e=window.getComputedStyle(t);return{top:parseFloat(e.scrollMarginTop)||0,right:parseFloat(e.scrollMarginRight)||0,bottom:parseFloat(e.scrollMarginBottom)||0,left:parseFloat(e.scrollMarginLeft)||0}})(e);let k="start"===f||"nearest"===f?x-T:"end"===f?I+F:x+v/2-T+F,D="center"===u?R+E/2-V+B:"end"===u?C+B:R-V;const L=[];for(let t=0;t<w.length;t++){const e=w[t],{height:n,width:l,top:r,right:i,bottom:s,left:d}=e.getBoundingClientRect();if("if-needed"===c&&x>=0&&R>=0&&I<=H&&C<=b&&x>=r&&I<=s&&R>=d&&C<=i)return L;const h=getComputedStyle(e),a=parseInt(h.borderLeftWidth,10),g=parseInt(h.borderTopWidth,10),p=parseInt(h.borderRightWidth,10),W=parseInt(h.borderBottomWidth,10);let T=0,B=0;const F="offsetWidth"in e?e.offsetWidth-e.clientWidth-a-p:0,V="offsetHeight"in e?e.offsetHeight-e.clientHeight-g-W:0,S="offsetWidth"in e?0===e.offsetWidth?0:l/e.offsetWidth:0,X="offsetHeight"in e?0===e.offsetHeight?0:n/e.offsetHeight:0;if(m===e)T="start"===f?k:"end"===f?k-H:"nearest"===f?o(M,M+H,H,g,W,M+k,M+k+v,v):k-H/2,B="start"===u?D:"center"===u?D-b/2:"end"===u?D-b:o(y,y+b,b,a,p,y+D,y+D+E,E),T=Math.max(0,T+M),B=Math.max(0,B+y);else{T="start"===f?k-r-g:"end"===f?k-s+W+V:"nearest"===f?o(r,s,n,g,W+V,k,k+v,v):k-(r+n/2)+V/2,B="start"===u?D-d-a:"center"===u?D-(d+l/2)+F/2:"end"===u?D-i+p+F:o(d,i,l,a,p+F,D,D+E,E);const{scrollLeft:t,scrollTop:h}=e;T=0===X?0:Math.max(0,Math.min(h+T/X,e.scrollHeight-n/X+V)),B=0===S?0:Math.max(0,Math.min(t+B/S,e.scrollWidth-l/S+F)),k+=h-T,D+=t-B}L.push({el:e,top:T,left:B})}return L};//# sourceMappingURL=index.js.map

;// ./node_modules/scroll-into-view-if-needed/dist/index.js
const dist_o=t=>!1===t?{block:"end",inline:"nearest"}:(t=>t===Object(t)&&0!==Object.keys(t).length)(t)?t:{block:"start",inline:"nearest"};function dist_e(e,r){if(!e.isConnected||!(t=>{let o=t;for(;o&&o.parentNode;){if(o.parentNode===document)return!0;o=o.parentNode instanceof ShadowRoot?o.parentNode.host:o.parentNode}return!1})(e))return;const n=(t=>{const o=window.getComputedStyle(t);return{top:parseFloat(o.scrollMarginTop)||0,right:parseFloat(o.scrollMarginRight)||0,bottom:parseFloat(o.scrollMarginBottom)||0,left:parseFloat(o.scrollMarginLeft)||0}})(e);if((t=>"object"==typeof t&&"function"==typeof t.behavior)(r))return r.behavior(dist_r(e,r));const l="boolean"==typeof r||null==r?void 0:r.behavior;for(const{el:a,top:i,left:s}of dist_r(e,dist_o(r))){const t=i-n.top+n.bottom,o=s-n.left+n.right;a.scroll({top:t,left:o,behavior:l})}}//# sourceMappingURL=index.js.map

;// ./node_modules/antd/es/form/util.js
// form item name black list.  in form ,you can use form.id get the form item element.
// use object hasOwnProperty will get better performance if black list is longer.
const formItemNameBlackList = ['parentNode'];
// default form item id prefix.
const defaultItemNamePrefixCls = 'form_item';
function toArray(candidate) {
  if (candidate === undefined || candidate === false) return [];
  return Array.isArray(candidate) ? candidate : [candidate];
}
function getFieldId(namePath, formName) {
  if (!namePath.length) {
    return undefined;
  }
  const mergedId = namePath.join('_');
  if (formName) {
    return `${formName}_${mergedId}`;
  }
  const isIllegalName = formItemNameBlackList.includes(mergedId);
  return isIllegalName ? `${defaultItemNamePrefixCls}_${mergedId}` : mergedId;
}
/**
 * Get merged status by meta or passed `validateStatus`.
 */
function getStatus(errors, warnings, meta, defaultValidateStatus, hasFeedback, validateStatus) {
  let status = defaultValidateStatus;
  if (validateStatus !== undefined) {
    status = validateStatus;
  } else if (meta.validating) {
    status = 'validating';
  } else if (errors.length) {
    status = 'error';
  } else if (warnings.length) {
    status = 'warning';
  } else if (meta.touched || hasFeedback && meta.validated) {
    // success feedback should display when pass hasFeedback prop and current value is valid value
    status = 'success';
  }
  return status;
}
;// ./node_modules/antd/es/form/hooks/useForm.js





function toNamePathStr(name) {
  const namePath = toArray(name);
  return namePath.join('_');
}
function getFieldDOMNode(name, wrapForm) {
  const field = wrapForm.getFieldInstance(name);
  const fieldDom = (0,findDOMNode/* getDOM */.rb)(field);
  if (fieldDom) {
    return fieldDom;
  }
  const fieldId = getFieldId(toArray(name), wrapForm.__INTERNAL__.name);
  if (fieldId) {
    return document.getElementById(fieldId);
  }
}
function useForm(form) {
  const [rcForm] = (0,rc_field_form_es/* useForm */.mN)();
  const itemsRef = react.useRef({});
  const wrapForm = react.useMemo(() => form !== null && form !== void 0 ? form : Object.assign(Object.assign({}, rcForm), {
    __INTERNAL__: {
      itemRef: name => node => {
        const namePathStr = toNamePathStr(name);
        if (node) {
          itemsRef.current[namePathStr] = node;
        } else {
          delete itemsRef.current[namePathStr];
        }
      }
    },
    scrollToField: function (name) {
      let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      const node = getFieldDOMNode(name, wrapForm);
      if (node) {
        dist_e(node, Object.assign({
          scrollMode: 'if-needed',
          block: 'nearest'
        }, options));
      }
    },
    focusField: name => {
      var _a;
      const node = getFieldDOMNode(name, wrapForm);
      if (node) {
        (_a = node.focus) === null || _a === void 0 ? void 0 : _a.call(node);
      }
    },
    getFieldInstance: name => {
      const namePathStr = toNamePathStr(name);
      return itemsRef.current[namePathStr];
    }
  }), [form, rcForm]);
  return [wrapForm];
}
// EXTERNAL MODULE: ./node_modules/antd/es/form/validateMessagesContext.js
var validateMessagesContext = __webpack_require__(69407);
;// ./node_modules/antd/es/form/Form.js
"use client";

var Form_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};














const InternalForm = (props, ref) => {
  const contextDisabled = react.useContext(DisabledContext/* default */.A);
  const {
    getPrefixCls,
    direction,
    form: contextForm
  } = react.useContext(context/* ConfigContext */.QO);
  const {
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      size,
      disabled = contextDisabled,
      form,
      colon,
      labelAlign,
      labelWrap,
      labelCol,
      wrapperCol,
      hideRequiredMark,
      layout = 'horizontal',
      scrollToFirstError,
      requiredMark,
      onFinishFailed,
      name,
      style,
      feedbackIcons,
      variant
    } = props,
    restFormProps = Form_rest(props, ["prefixCls", "className", "rootClassName", "size", "disabled", "form", "colon", "labelAlign", "labelWrap", "labelCol", "wrapperCol", "hideRequiredMark", "layout", "scrollToFirstError", "requiredMark", "onFinishFailed", "name", "style", "feedbackIcons", "variant"]);
  const mergedSize = (0,useSize/* default */.A)(size);
  const contextValidateMessages = react.useContext(validateMessagesContext/* default */.A);
  if (false) {}
  const mergedRequiredMark = (0,react.useMemo)(() => {
    if (requiredMark !== undefined) {
      return requiredMark;
    }
    if (hideRequiredMark) {
      return false;
    }
    if (contextForm && contextForm.requiredMark !== undefined) {
      return contextForm.requiredMark;
    }
    return true;
  }, [hideRequiredMark, requiredMark, contextForm]);
  const mergedColon = colon !== null && colon !== void 0 ? colon : contextForm === null || contextForm === void 0 ? void 0 : contextForm.colon;
  const prefixCls = getPrefixCls('form', customizePrefixCls);
  // Style
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = form_style(prefixCls, rootCls);
  const formClassName = classnames_default()(prefixCls, `${prefixCls}-${layout}`, {
    [`${prefixCls}-hide-required-mark`]: mergedRequiredMark === false,
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-${mergedSize}`]: mergedSize
  }, cssVarCls, rootCls, hashId, contextForm === null || contextForm === void 0 ? void 0 : contextForm.className, className, rootClassName);
  const [wrapForm] = useForm(form);
  const {
    __INTERNAL__
  } = wrapForm;
  __INTERNAL__.name = name;
  const formContextValue = (0,react.useMemo)(() => ({
    name,
    labelAlign,
    labelCol,
    labelWrap,
    wrapperCol,
    vertical: layout === 'vertical',
    colon: mergedColon,
    requiredMark: mergedRequiredMark,
    itemRef: __INTERNAL__.itemRef,
    form: wrapForm,
    feedbackIcons
  }), [name, labelAlign, labelCol, wrapperCol, layout, mergedColon, mergedRequiredMark, wrapForm, feedbackIcons]);
  const nativeElementRef = react.useRef(null);
  react.useImperativeHandle(ref, () => {
    var _a;
    return Object.assign(Object.assign({}, wrapForm), {
      nativeElement: (_a = nativeElementRef.current) === null || _a === void 0 ? void 0 : _a.nativeElement
    });
  });
  const scrollToField = (options, fieldName) => {
    if (options) {
      let defaultScrollToFirstError = {
        block: 'nearest'
      };
      if (typeof options === 'object') {
        defaultScrollToFirstError = Object.assign(Object.assign({}, defaultScrollToFirstError), options);
      }
      wrapForm.scrollToField(fieldName, defaultScrollToFirstError);
      if (defaultScrollToFirstError.focus) {
        wrapForm.focusField(fieldName);
      }
    }
  };
  const onInternalFinishFailed = errorInfo => {
    onFinishFailed === null || onFinishFailed === void 0 ? void 0 : onFinishFailed(errorInfo);
    if (errorInfo.errorFields.length) {
      const fieldName = errorInfo.errorFields[0].name;
      if (scrollToFirstError !== undefined) {
        scrollToField(scrollToFirstError, fieldName);
        return;
      }
      if (contextForm && contextForm.scrollToFirstError !== undefined) {
        scrollToField(contextForm.scrollToFirstError, fieldName);
      }
    }
  };
  return wrapCSSVar(/*#__PURE__*/react.createElement(form_context/* VariantContext */.Pp.Provider, {
    value: variant
  }, /*#__PURE__*/react.createElement(DisabledContext/* DisabledContextProvider */.X, {
    disabled: disabled
  }, /*#__PURE__*/react.createElement(SizeContext/* default */.A.Provider, {
    value: mergedSize
  }, /*#__PURE__*/react.createElement(form_context/* FormProvider */.Op, {
    // This is not list in API, we pass with spread
    validateMessages: contextValidateMessages
  }, /*#__PURE__*/react.createElement(form_context/* FormContext */.cK.Provider, {
    value: formContextValue
  }, /*#__PURE__*/react.createElement(rc_field_form_es/* default */.Ay, Object.assign({
    id: name
  }, restFormProps, {
    name: name,
    onFinishFailed: onInternalFinishFailed,
    form: wrapForm,
    ref: nativeElementRef,
    style: Object.assign(Object.assign({}, contextForm === null || contextForm === void 0 ? void 0 : contextForm.style), style),
    className: formClassName
  }))))))));
};
const Form = /*#__PURE__*/react.forwardRef(InternalForm);
if (false) {}

/* harmony default export */ var form_Form = (Form);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useState.js
var useState = __webpack_require__(1233);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var ref = __webpack_require__(8719);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/reactNode.js
var reactNode = __webpack_require__(40682);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/warning.js
var _util_warning = __webpack_require__(18877);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Children/toArray.js
var Children_toArray = __webpack_require__(82546);
;// ./node_modules/antd/es/form/hooks/useChildren.js

function useChildren(children) {
  if (typeof children === 'function') {
    return children;
  }
  const childList = (0,Children_toArray/* default */.A)(children);
  return childList.length <= 1 ? childList[0] : childList;
}
;// ./node_modules/antd/es/form/hooks/useFormItemStatus.js



const useFormItemStatus = () => {
  const {
    status,
    errors = [],
    warnings = []
  } = (0,react.useContext)(form_context/* FormItemInputContext */.$W);
  if (false) {}
  return {
    status,
    errors,
    warnings
  };
};
// Only used for compatible package. Not promise this will work on future version.
useFormItemStatus.Context = form_context/* FormItemInputContext */.$W;
/* harmony default export */ var hooks_useFormItemStatus = (useFormItemStatus);
// EXTERNAL MODULE: ./node_modules/rc-util/es/raf.js
var raf = __webpack_require__(25371);
;// ./node_modules/antd/es/form/hooks/useFrameState.js



function useFrameState(defaultValue) {
  const [value, setValue] = react.useState(defaultValue);
  const frameRef = (0,react.useRef)(null);
  const batchRef = (0,react.useRef)([]);
  const destroyRef = (0,react.useRef)(false);
  react.useEffect(() => {
    destroyRef.current = false;
    return () => {
      destroyRef.current = true;
      raf/* default */.A.cancel(frameRef.current);
      frameRef.current = null;
    };
  }, []);
  function setFrameValue(updater) {
    if (destroyRef.current) {
      return;
    }
    if (frameRef.current === null) {
      batchRef.current = [];
      frameRef.current = (0,raf/* default */.A)(() => {
        frameRef.current = null;
        setValue(prevValue => {
          let current = prevValue;
          batchRef.current.forEach(func => {
            current = func(current);
          });
          return current;
        });
      });
    }
    batchRef.current.push(updater);
  }
  return [value, setFrameValue];
}
;// ./node_modules/antd/es/form/hooks/useItemRef.js



function useItemRef() {
  const {
    itemRef
  } = react.useContext(form_context/* FormContext */.cK);
  const cacheRef = react.useRef({});
  function getRef(name, children) {
    // Outer caller already check the `supportRef`
    const childrenRef = children && typeof children === 'object' && (0,ref/* getNodeRef */.A9)(children);
    const nameStr = name.join('_');
    if (cacheRef.current.name !== nameStr || cacheRef.current.originRef !== childrenRef) {
      cacheRef.current.name = nameStr;
      cacheRef.current.originRef = childrenRef;
      cacheRef.current.ref = (0,ref/* composeRef */.K4)(itemRef(name), childrenRef);
    }
    return cacheRef.current.ref;
  }
  return getRef;
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/isVisible.js
var isVisible = __webpack_require__(42467);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useLayoutEffect.js
var useLayoutEffect = __webpack_require__(30981);
// EXTERNAL MODULE: ./node_modules/antd/es/grid/row.js
var row = __webpack_require__(74948);
// EXTERNAL MODULE: ./node_modules/rc-util/es/index.js
var rc_util_es = __webpack_require__(81470);
// EXTERNAL MODULE: ./node_modules/antd/es/grid/col.js
var col = __webpack_require__(26606);
;// ./node_modules/antd/es/form/style/fallbackCmp.js
/**
 * Fallback of IE.
 * Safe to remove.
 */
// Style as inline component


// ============================= Fallback =============================
const genFallbackStyle = token => {
  const {
    formItemCls
  } = token;
  return {
    '@media screen and (-ms-high-contrast: active), (-ms-high-contrast: none)': {
      // Fallback for IE, safe to remove we not support it anymore
      [`${formItemCls}-control`]: {
        display: 'flex'
      }
    }
  };
};
// ============================== Export ==============================
/* harmony default export */ var fallbackCmp = ((0,genStyleUtils/* genSubStyleComponent */.bf)(['Form', 'item-item'], (token, _ref) => {
  let {
    rootPrefixCls
  } = _ref;
  const formToken = prepareToken(token, rootPrefixCls);
  return [genFallbackStyle(formToken)];
}));
;// ./node_modules/antd/es/form/FormItemInput.js
"use client";

var FormItemInput_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};








const GRID_MAX = 24;
const FormItemInput = props => {
  const {
    prefixCls,
    status,
    labelCol,
    wrapperCol,
    children,
    errors,
    warnings,
    _internalItemRender: formItemRender,
    extra,
    help,
    fieldId,
    marginBottom,
    onErrorVisibleChanged,
    label
  } = props;
  const baseClassName = `${prefixCls}-item`;
  const formContext = react.useContext(form_context/* FormContext */.cK);
  const mergedWrapperCol = react.useMemo(() => {
    let mergedWrapper = Object.assign({}, wrapperCol || formContext.wrapperCol || {});
    if (label === null && !labelCol && !wrapperCol && formContext.labelCol) {
      const list = [undefined, 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
      list.forEach(size => {
        const _size = size ? [size] : [];
        const formLabel = (0,rc_util_es/* get */.Jt)(formContext.labelCol, _size);
        const formLabelObj = typeof formLabel === 'object' ? formLabel : {};
        const wrapper = (0,rc_util_es/* get */.Jt)(mergedWrapper, _size);
        const wrapperObj = typeof wrapper === 'object' ? wrapper : {};
        if ('span' in formLabelObj && !('offset' in wrapperObj) && formLabelObj.span < GRID_MAX) {
          mergedWrapper = (0,rc_util_es/* set */.hZ)(mergedWrapper, [].concat(_size, ['offset']), formLabelObj.span);
        }
      });
    }
    return mergedWrapper;
  }, [wrapperCol, formContext]);
  const className = classnames_default()(`${baseClassName}-control`, mergedWrapperCol.className);
  // Pass to sub FormItem should not with col info
  const subFormContext = react.useMemo(() => {
    const {
        labelCol,
        wrapperCol
      } = formContext,
      rest = FormItemInput_rest(formContext, ["labelCol", "wrapperCol"]);
    return rest;
  }, [formContext]);
  const extraRef = react.useRef(null);
  const [extraHeight, setExtraHeight] = react.useState(0);
  (0,useLayoutEffect/* default */.A)(() => {
    if (extra && extraRef.current) {
      setExtraHeight(extraRef.current.clientHeight);
    } else {
      setExtraHeight(0);
    }
  }, [extra]);
  const inputDom = /*#__PURE__*/react.createElement("div", {
    className: `${baseClassName}-control-input`
  }, /*#__PURE__*/react.createElement("div", {
    className: `${baseClassName}-control-input-content`
  }, children));
  const formItemContext = react.useMemo(() => ({
    prefixCls,
    status
  }), [prefixCls, status]);
  const errorListDom = marginBottom !== null || errors.length || warnings.length ? (/*#__PURE__*/react.createElement(form_context/* FormItemPrefixContext */.hb.Provider, {
    value: formItemContext
  }, /*#__PURE__*/react.createElement(form_ErrorList, {
    fieldId: fieldId,
    errors: errors,
    warnings: warnings,
    help: help,
    helpStatus: status,
    className: `${baseClassName}-explain-connected`,
    onVisibleChanged: onErrorVisibleChanged
  }))) : null;
  const extraProps = {};
  if (fieldId) {
    extraProps.id = `${fieldId}_extra`;
  }
  // If extra = 0, && will goes wrong
  // 0&&error -> 0
  const extraDom = extra ? (/*#__PURE__*/react.createElement("div", Object.assign({}, extraProps, {
    className: `${baseClassName}-extra`,
    ref: extraRef
  }), extra)) : null;
  const additionalDom = errorListDom || extraDom ? (/*#__PURE__*/react.createElement("div", {
    className: `${baseClassName}-additional`,
    style: marginBottom ? {
      minHeight: marginBottom + extraHeight
    } : {}
  }, errorListDom, extraDom)) : null;
  const dom = formItemRender && formItemRender.mark === 'pro_table_render' && formItemRender.render ? formItemRender.render(props, {
    input: inputDom,
    errorList: errorListDom,
    extra: extraDom
  }) : (/*#__PURE__*/react.createElement(react.Fragment, null, inputDom, additionalDom));
  return /*#__PURE__*/react.createElement(form_context/* FormContext */.cK.Provider, {
    value: subFormContext
  }, /*#__PURE__*/react.createElement(col/* default */.A, Object.assign({}, mergedWrapperCol, {
    className: className
  }), dom), /*#__PURE__*/react.createElement(fallbackCmp, {
    prefixCls: prefixCls
  }));
};
/* harmony default export */ var form_FormItemInput = (FormItemInput);
;// ./node_modules/@ant-design/icons-svg/es/asn/QuestionCircleOutlined.js
// This icon file is generated automatically.
var QuestionCircleOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z" } }, { "tag": "path", "attrs": { "d": "M623.6 316.7C593.6 290.4 554 276 512 276s-81.6 14.5-111.6 40.7C369.2 344 352 380.7 352 420v7.6c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V420c0-44.1 43.1-80 96-80s96 35.9 96 80c0 31.1-22 59.6-56.1 72.7-21.2 8.1-39.2 22.3-52.1 40.9-13.1 19-19.9 41.8-19.9 64.9V620c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8v-22.7a48.3 48.3 0 0130.9-44.8c59-22.7 97.1-74.7 97.1-132.5.1-39.3-17.1-76-48.3-103.3zM472 732a40 40 0 1080 0 40 40 0 10-80 0z" } }] }, "name": "question-circle", "theme": "outlined" };
/* harmony default export */ var asn_QuestionCircleOutlined = (QuestionCircleOutlined);

;// ./node_modules/@ant-design/icons/es/icons/QuestionCircleOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var QuestionCircleOutlined_QuestionCircleOutlined = function QuestionCircleOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_QuestionCircleOutlined
  }));
};

/**![question-circle](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTUxMiA2NEMyNjQuNiA2NCA2NCAyNjQuNiA2NCA1MTJzMjAwLjYgNDQ4IDQ0OCA0NDggNDQ4LTIwMC42IDQ0OC00NDhTNzU5LjQgNjQgNTEyIDY0em0wIDgyMGMtMjA1LjQgMC0zNzItMTY2LjYtMzcyLTM3MnMxNjYuNi0zNzIgMzcyLTM3MiAzNzIgMTY2LjYgMzcyIDM3Mi0xNjYuNiAzNzItMzcyIDM3MnoiIC8+PHBhdGggZD0iTTYyMy42IDMxNi43QzU5My42IDI5MC40IDU1NCAyNzYgNTEyIDI3NnMtODEuNiAxNC41LTExMS42IDQwLjdDMzY5LjIgMzQ0IDM1MiAzODAuNyAzNTIgNDIwdjcuNmMwIDQuNCAzLjYgOCA4IDhoNDhjNC40IDAgOC0zLjYgOC04VjQyMGMwLTQ0LjEgNDMuMS04MCA5Ni04MHM5NiAzNS45IDk2IDgwYzAgMzEuMS0yMiA1OS42LTU2LjEgNzIuNy0yMS4yIDguMS0zOS4yIDIyLjMtNTIuMSA0MC45LTEzLjEgMTktMTkuOSA0MS44LTE5LjkgNjQuOVY2MjBjMCA0LjQgMy42IDggOCA4aDQ4YzQuNCAwIDgtMy42IDgtOHYtMjIuN2E0OC4zIDQ4LjMgMCAwMTMwLjktNDQuOGM1OS0yMi43IDk3LjEtNzQuNyA5Ny4xLTEzMi41LjEtMzkuMy0xNy4xLTc2LTQ4LjMtMTAzLjN6TTQ3MiA3MzJhNDAgNDAgMCAxMDgwIDAgNDAgNDAgMCAxMC04MCAweiIgLz48L3N2Zz4=) */
var QuestionCircleOutlined_RefIcon = /*#__PURE__*/react.forwardRef(QuestionCircleOutlined_QuestionCircleOutlined);
if (false) {}
/* harmony default export */ var icons_QuestionCircleOutlined = (QuestionCircleOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/antd/es/locale/useLocale.js
var useLocale = __webpack_require__(19155);
// EXTERNAL MODULE: ./node_modules/antd/es/locale/en_US.js + 5 modules
var en_US = __webpack_require__(80436);
;// ./node_modules/antd/es/form/FormItemLabel.js
"use client";

var FormItemLabel_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};








function toTooltipProps(tooltip) {
  if (!tooltip) {
    return null;
  }
  if (typeof tooltip === 'object' && ! /*#__PURE__*/react.isValidElement(tooltip)) {
    return tooltip;
  }
  return {
    title: tooltip
  };
}
const FormItemLabel = _ref => {
  let {
    prefixCls,
    label,
    htmlFor,
    labelCol,
    labelAlign,
    colon,
    required,
    requiredMark,
    tooltip,
    vertical
  } = _ref;
  var _a;
  const [formLocale] = (0,useLocale/* default */.A)('Form');
  const {
    labelAlign: contextLabelAlign,
    labelCol: contextLabelCol,
    labelWrap,
    colon: contextColon
  } = react.useContext(form_context/* FormContext */.cK);
  if (!label) {
    return null;
  }
  const mergedLabelCol = labelCol || contextLabelCol || {};
  const mergedLabelAlign = labelAlign || contextLabelAlign;
  const labelClsBasic = `${prefixCls}-item-label`;
  const labelColClassName = classnames_default()(labelClsBasic, mergedLabelAlign === 'left' && `${labelClsBasic}-left`, mergedLabelCol.className, {
    [`${labelClsBasic}-wrap`]: !!labelWrap
  });
  let labelChildren = label;
  // Keep label is original where there should have no colon
  const computedColon = colon === true || contextColon !== false && colon !== false;
  const haveColon = computedColon && !vertical;
  // Remove duplicated user input colon
  if (haveColon && typeof label === 'string' && label.trim()) {
    labelChildren = label.replace(/[:|：]\s*$/, '');
  }
  // Tooltip
  const tooltipProps = toTooltipProps(tooltip);
  if (tooltipProps) {
    const {
        icon = /*#__PURE__*/react.createElement(icons_QuestionCircleOutlined, null)
      } = tooltipProps,
      restTooltipProps = FormItemLabel_rest(tooltipProps, ["icon"]);
    const tooltipNode = /*#__PURE__*/react.createElement(es_tooltip/* default */.A, Object.assign({}, restTooltipProps), /*#__PURE__*/react.cloneElement(icon, {
      className: `${prefixCls}-item-tooltip`,
      title: '',
      onClick: e => {
        // Prevent label behavior in tooltip icon
        // https://github.com/ant-design/ant-design/issues/46154
        e.preventDefault();
      },
      tabIndex: null
    }));
    labelChildren = /*#__PURE__*/react.createElement(react.Fragment, null, labelChildren, tooltipNode);
  }
  // Required Mark
  const isOptionalMark = requiredMark === 'optional';
  const isRenderMark = typeof requiredMark === 'function';
  if (isRenderMark) {
    labelChildren = requiredMark(labelChildren, {
      required: !!required
    });
  } else if (isOptionalMark && !required) {
    labelChildren = /*#__PURE__*/react.createElement(react.Fragment, null, labelChildren, /*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-item-optional`,
      title: ""
    }, (formLocale === null || formLocale === void 0 ? void 0 : formLocale.optional) || ((_a = en_US/* default */.A.Form) === null || _a === void 0 ? void 0 : _a.optional)));
  }
  const labelClassName = classnames_default()({
    [`${prefixCls}-item-required`]: required,
    [`${prefixCls}-item-required-mark-optional`]: isOptionalMark || isRenderMark,
    [`${prefixCls}-item-no-colon`]: !computedColon
  });
  return /*#__PURE__*/react.createElement(col/* default */.A, Object.assign({}, mergedLabelCol, {
    className: labelColClassName
  }), /*#__PURE__*/react.createElement("label", {
    htmlFor: htmlFor,
    className: labelClassName,
    title: typeof label === 'string' ? label : ''
  }, labelChildren));
};
/* harmony default export */ var form_FormItemLabel = (FormItemLabel);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CheckCircleFilled.js + 1 modules
var CheckCircleFilled = __webpack_require__(38811);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CloseCircleFilled.js + 1 modules
var CloseCircleFilled = __webpack_require__(36029);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/ExclamationCircleFilled.js + 1 modules
var ExclamationCircleFilled = __webpack_require__(7541);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/LoadingOutlined.js + 1 modules
var LoadingOutlined = __webpack_require__(93567);
;// ./node_modules/antd/es/form/FormItem/StatusProvider.js
"use client";









const iconMap = {
  success: CheckCircleFilled/* default */.A,
  warning: ExclamationCircleFilled/* default */.A,
  error: CloseCircleFilled/* default */.A,
  validating: LoadingOutlined/* default */.A
};
function StatusProvider(_ref) {
  let {
    children,
    errors,
    warnings,
    hasFeedback,
    validateStatus,
    prefixCls,
    meta,
    noStyle
  } = _ref;
  const itemPrefixCls = `${prefixCls}-item`;
  const {
    feedbackIcons
  } = react.useContext(form_context/* FormContext */.cK);
  const mergedValidateStatus = getStatus(errors, warnings, meta, null, !!hasFeedback, validateStatus);
  const {
    isFormItemInput: parentIsFormItemInput,
    status: parentStatus,
    hasFeedback: parentHasFeedback,
    feedbackIcon: parentFeedbackIcon
  } = react.useContext(form_context/* FormItemInputContext */.$W);
  // ====================== Context =======================
  const formItemStatusContext = react.useMemo(() => {
    var _a;
    let feedbackIcon;
    if (hasFeedback) {
      const customIcons = hasFeedback !== true && hasFeedback.icons || feedbackIcons;
      const customIconNode = mergedValidateStatus && ((_a = customIcons === null || customIcons === void 0 ? void 0 : customIcons({
        status: mergedValidateStatus,
        errors,
        warnings
      })) === null || _a === void 0 ? void 0 : _a[mergedValidateStatus]);
      const IconNode = mergedValidateStatus && iconMap[mergedValidateStatus];
      feedbackIcon = customIconNode !== false && IconNode ? (/*#__PURE__*/react.createElement("span", {
        className: classnames_default()(`${itemPrefixCls}-feedback-icon`, `${itemPrefixCls}-feedback-icon-${mergedValidateStatus}`)
      }, customIconNode || /*#__PURE__*/react.createElement(IconNode, null))) : null;
    }
    const context = {
      status: mergedValidateStatus || '',
      errors,
      warnings,
      hasFeedback: !!hasFeedback,
      feedbackIcon,
      isFormItemInput: true
    };
    // No style will follow parent context
    if (noStyle) {
      context.status = (mergedValidateStatus !== null && mergedValidateStatus !== void 0 ? mergedValidateStatus : parentStatus) || '';
      context.isFormItemInput = parentIsFormItemInput;
      context.hasFeedback = !!(hasFeedback !== null && hasFeedback !== void 0 ? hasFeedback : parentHasFeedback);
      context.feedbackIcon = hasFeedback !== undefined ? context.feedbackIcon : parentFeedbackIcon;
    }
    return context;
  }, [mergedValidateStatus, hasFeedback, noStyle, parentIsFormItemInput, parentStatus]);
  // ======================= Render =======================
  return /*#__PURE__*/react.createElement(form_context/* FormItemInputContext */.$W.Provider, {
    value: formItemStatusContext
  }, children);
}
;// ./node_modules/antd/es/form/FormItem/ItemHolder.js
"use client";

var ItemHolder_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};












function ItemHolder(props) {
  const {
      prefixCls,
      className,
      rootClassName,
      style,
      help,
      errors,
      warnings,
      validateStatus,
      meta,
      hasFeedback,
      hidden,
      children,
      fieldId,
      required,
      isRequired,
      onSubItemMetaChange,
      layout
    } = props,
    restProps = ItemHolder_rest(props, ["prefixCls", "className", "rootClassName", "style", "help", "errors", "warnings", "validateStatus", "meta", "hasFeedback", "hidden", "children", "fieldId", "required", "isRequired", "onSubItemMetaChange", "layout"]);
  const itemPrefixCls = `${prefixCls}-item`;
  const {
    requiredMark,
    vertical: formVertical
  } = react.useContext(form_context/* FormContext */.cK);
  const vertical = formVertical || layout === 'vertical';
  // ======================== Margin ========================
  const itemRef = react.useRef(null);
  const debounceErrors = useDebounce(errors);
  const debounceWarnings = useDebounce(warnings);
  const hasHelp = help !== undefined && help !== null;
  const hasError = !!(hasHelp || errors.length || warnings.length);
  const isOnScreen = !!itemRef.current && (0,isVisible/* default */.A)(itemRef.current);
  const [marginBottom, setMarginBottom] = react.useState(null);
  (0,useLayoutEffect/* default */.A)(() => {
    if (hasError && itemRef.current) {
      // The element must be part of the DOMTree to use getComputedStyle
      // https://stackoverflow.com/questions/35360711/getcomputedstyle-returns-a-cssstyledeclaration-but-all-properties-are-empty-on-a
      const itemStyle = getComputedStyle(itemRef.current);
      setMarginBottom(parseInt(itemStyle.marginBottom, 10));
    }
  }, [hasError, isOnScreen]);
  const onErrorVisibleChanged = nextVisible => {
    if (!nextVisible) {
      setMarginBottom(null);
    }
  };
  // ======================== Status ========================
  const getValidateState = function () {
    let isDebounce = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
    const _errors = isDebounce ? debounceErrors : meta.errors;
    const _warnings = isDebounce ? debounceWarnings : meta.warnings;
    return getStatus(_errors, _warnings, meta, '', !!hasFeedback, validateStatus);
  };
  const mergedValidateStatus = getValidateState();
  // ======================== Render ========================
  const itemClassName = classnames_default()(itemPrefixCls, className, rootClassName, {
    [`${itemPrefixCls}-with-help`]: hasHelp || debounceErrors.length || debounceWarnings.length,
    // Status
    [`${itemPrefixCls}-has-feedback`]: mergedValidateStatus && hasFeedback,
    [`${itemPrefixCls}-has-success`]: mergedValidateStatus === 'success',
    [`${itemPrefixCls}-has-warning`]: mergedValidateStatus === 'warning',
    [`${itemPrefixCls}-has-error`]: mergedValidateStatus === 'error',
    [`${itemPrefixCls}-is-validating`]: mergedValidateStatus === 'validating',
    [`${itemPrefixCls}-hidden`]: hidden,
    // Layout
    [`${itemPrefixCls}-${layout}`]: layout
  });
  return /*#__PURE__*/react.createElement("div", {
    className: itemClassName,
    style: style,
    ref: itemRef
  }, /*#__PURE__*/react.createElement(row/* default */.A, Object.assign({
    className: `${itemPrefixCls}-row`
  }, (0,omit/* default */.A)(restProps, ['_internalItemRender', 'colon', 'dependencies', 'extra', 'fieldKey', 'getValueFromEvent', 'getValueProps', 'htmlFor', 'id',
  // It is deprecated because `htmlFor` is its replacement.
  'initialValue', 'isListField', 'label', 'labelAlign', 'labelCol', 'labelWrap', 'messageVariables', 'name', 'normalize', 'noStyle', 'preserve', 'requiredMark', 'rules', 'shouldUpdate', 'trigger', 'tooltip', 'validateFirst', 'validateTrigger', 'valuePropName', 'wrapperCol', 'validateDebounce'])), /*#__PURE__*/react.createElement(form_FormItemLabel, Object.assign({
    htmlFor: fieldId
  }, props, {
    requiredMark: requiredMark,
    required: required !== null && required !== void 0 ? required : isRequired,
    prefixCls: prefixCls,
    vertical: vertical
  })), /*#__PURE__*/react.createElement(form_FormItemInput, Object.assign({}, props, meta, {
    errors: debounceErrors,
    warnings: debounceWarnings,
    prefixCls: prefixCls,
    status: mergedValidateStatus,
    help: help,
    marginBottom: marginBottom,
    onErrorVisibleChanged: onErrorVisibleChanged
  }), /*#__PURE__*/react.createElement(form_context/* NoStyleItemContext */.jC.Provider, {
    value: onSubItemMetaChange
  }, /*#__PURE__*/react.createElement(StatusProvider, {
    prefixCls: prefixCls,
    meta: meta,
    errors: meta.errors,
    warnings: meta.warnings,
    hasFeedback: hasFeedback,
    // Already calculated
    validateStatus: mergedValidateStatus
  }, children)))), !!marginBottom && (/*#__PURE__*/react.createElement("div", {
    className: `${itemPrefixCls}-margin-offset`,
    style: {
      marginBottom: -marginBottom
    }
  })));
}
;// ./node_modules/antd/es/form/FormItem/index.js
"use client";




















const NAME_SPLIT = '__SPLIT__';
const _ValidateStatuses = (/* unused pure expression or super */ null && (['success', 'warning', 'error', 'validating', '']));
// https://github.com/ant-design/ant-design/issues/46417
// `getValueProps` may modify the value props name,
// we should check if the control is similar.
function isSimilarControl(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every(key => {
    const propValueA = a[key];
    const propValueB = b[key];
    return propValueA === propValueB || typeof propValueA === 'function' || typeof propValueB === 'function';
  });
}
const MemoInput = /*#__PURE__*/react.memo(_ref => {
  let {
    children
  } = _ref;
  return children;
}, (prev, next) => isSimilarControl(prev.control, next.control) && prev.update === next.update && prev.childProps.length === next.childProps.length && prev.childProps.every((value, index) => value === next.childProps[index]));
function genEmptyMeta() {
  return {
    errors: [],
    warnings: [],
    touched: false,
    validating: false,
    name: [],
    validated: false
  };
}
function InternalFormItem(props) {
  const {
    name,
    noStyle,
    className,
    dependencies,
    prefixCls: customizePrefixCls,
    shouldUpdate,
    rules,
    children,
    required,
    label,
    messageVariables,
    trigger = 'onChange',
    validateTrigger,
    hidden,
    help,
    layout
  } = props;
  const {
    getPrefixCls
  } = react.useContext(context/* ConfigContext */.QO);
  const {
    name: formName
  } = react.useContext(form_context/* FormContext */.cK);
  const mergedChildren = useChildren(children);
  const isRenderProps = typeof mergedChildren === 'function';
  const notifyParentMetaChange = react.useContext(form_context/* NoStyleItemContext */.jC);
  const {
    validateTrigger: contextValidateTrigger
  } = react.useContext(rc_field_form_es/* FieldContext */._z);
  const mergedValidateTrigger = validateTrigger !== undefined ? validateTrigger : contextValidateTrigger;
  const hasName = !(name === undefined || name === null);
  const prefixCls = getPrefixCls('form', customizePrefixCls);
  // Style
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = form_style(prefixCls, rootCls);
  // ========================= Warn =========================
  const warning = (0,_util_warning/* devUseWarning */.rJ)('Form.Item');
  if (false) {}
  // ========================= MISC =========================
  // Get `noStyle` required info
  const listContext = react.useContext(rc_field_form_es/* ListContext */.EF);
  const fieldKeyPathRef = react.useRef();
  // ======================== Errors ========================
  // >>>>> Collect sub field errors
  const [subFieldErrors, setSubFieldErrors] = useFrameState({});
  // >>>>> Current field errors
  const [meta, setMeta] = (0,useState/* default */.A)(() => genEmptyMeta());
  const onMetaChange = nextMeta => {
    // This keyInfo is not correct when field is removed
    // Since origin keyManager no longer keep the origin key anymore
    // Which means we need cache origin one and reuse when removed
    const keyInfo = listContext === null || listContext === void 0 ? void 0 : listContext.getKey(nextMeta.name);
    // Destroy will reset all the meta
    setMeta(nextMeta.destroy ? genEmptyMeta() : nextMeta, true);
    // Bump to parent since noStyle
    if (noStyle && help !== false && notifyParentMetaChange) {
      let namePath = nextMeta.name;
      if (!nextMeta.destroy) {
        if (keyInfo !== undefined) {
          const [fieldKey, restPath] = keyInfo;
          namePath = [fieldKey].concat((0,toConsumableArray/* default */.A)(restPath));
          fieldKeyPathRef.current = namePath;
        }
      } else {
        // Use origin cache data
        namePath = fieldKeyPathRef.current || namePath;
      }
      notifyParentMetaChange(nextMeta, namePath);
    }
  };
  // >>>>> Collect noStyle Field error to the top FormItem
  const onSubItemMetaChange = (subMeta, uniqueKeys) => {
    // Only `noStyle` sub item will trigger
    setSubFieldErrors(prevSubFieldErrors => {
      const clone = Object.assign({}, prevSubFieldErrors);
      // name: ['user', 1] + key: [4] = ['user', 4]
      const mergedNamePath = [].concat((0,toConsumableArray/* default */.A)(subMeta.name.slice(0, -1)), (0,toConsumableArray/* default */.A)(uniqueKeys));
      const mergedNameKey = mergedNamePath.join(NAME_SPLIT);
      if (subMeta.destroy) {
        // Remove
        delete clone[mergedNameKey];
      } else {
        // Update
        clone[mergedNameKey] = subMeta;
      }
      return clone;
    });
  };
  // >>>>> Get merged errors
  const [mergedErrors, mergedWarnings] = react.useMemo(() => {
    const errorList = (0,toConsumableArray/* default */.A)(meta.errors);
    const warningList = (0,toConsumableArray/* default */.A)(meta.warnings);
    Object.values(subFieldErrors).forEach(subFieldError => {
      errorList.push.apply(errorList, (0,toConsumableArray/* default */.A)(subFieldError.errors || []));
      warningList.push.apply(warningList, (0,toConsumableArray/* default */.A)(subFieldError.warnings || []));
    });
    return [errorList, warningList];
  }, [subFieldErrors, meta.errors, meta.warnings]);
  // ===================== Children Ref =====================
  const getItemRef = useItemRef();
  // ======================== Render ========================
  function renderLayout(baseChildren, fieldId, isRequired) {
    if (noStyle && !hidden) {
      return /*#__PURE__*/react.createElement(StatusProvider, {
        prefixCls: prefixCls,
        hasFeedback: props.hasFeedback,
        validateStatus: props.validateStatus,
        meta: meta,
        errors: mergedErrors,
        warnings: mergedWarnings,
        noStyle: true
      }, baseChildren);
    }
    return /*#__PURE__*/react.createElement(ItemHolder, Object.assign({
      key: "row"
    }, props, {
      className: classnames_default()(className, cssVarCls, rootCls, hashId),
      prefixCls: prefixCls,
      fieldId: fieldId,
      isRequired: isRequired,
      errors: mergedErrors,
      warnings: mergedWarnings,
      meta: meta,
      onSubItemMetaChange: onSubItemMetaChange,
      layout: layout
    }), baseChildren);
  }
  if (!hasName && !isRenderProps && !dependencies) {
    return wrapCSSVar(renderLayout(mergedChildren));
  }
  let variables = {};
  if (typeof label === 'string') {
    variables.label = label;
  } else if (name) {
    variables.label = String(name);
  }
  if (messageVariables) {
    variables = Object.assign(Object.assign({}, variables), messageVariables);
  }
  // >>>>> With Field
  return wrapCSSVar(/*#__PURE__*/react.createElement(rc_field_form_es/* Field */.D0, Object.assign({}, props, {
    messageVariables: variables,
    trigger: trigger,
    validateTrigger: mergedValidateTrigger,
    onMetaChange: onMetaChange
  }), (control, renderMeta, context) => {
    const mergedName = toArray(name).length && renderMeta ? renderMeta.name : [];
    const fieldId = getFieldId(mergedName, formName);
    const isRequired = required !== undefined ? required : !!(rules === null || rules === void 0 ? void 0 : rules.some(rule => {
      if (rule && typeof rule === 'object' && rule.required && !rule.warningOnly) {
        return true;
      }
      if (typeof rule === 'function') {
        const ruleEntity = rule(context);
        return (ruleEntity === null || ruleEntity === void 0 ? void 0 : ruleEntity.required) && !(ruleEntity === null || ruleEntity === void 0 ? void 0 : ruleEntity.warningOnly);
      }
      return false;
    }));
    // ======================= Children =======================
    const mergedControl = Object.assign({}, control);
    let childNode = null;
     false ? 0 : void 0;
    if (Array.isArray(mergedChildren) && hasName) {
       false ? 0 : void 0;
      childNode = mergedChildren;
    } else if (isRenderProps && (!(shouldUpdate || dependencies) || hasName)) {
       false ? 0 : void 0;
       false ? 0 : void 0;
    } else if (dependencies && !isRenderProps && !hasName) {
       false ? 0 : void 0;
    } else if (/*#__PURE__*/react.isValidElement(mergedChildren)) {
       false ? 0 : void 0;
      const childProps = Object.assign(Object.assign({}, mergedChildren.props), mergedControl);
      if (!childProps.id) {
        childProps.id = fieldId;
      }
      if (help || mergedErrors.length > 0 || mergedWarnings.length > 0 || props.extra) {
        const describedbyArr = [];
        if (help || mergedErrors.length > 0) {
          describedbyArr.push(`${fieldId}_help`);
        }
        if (props.extra) {
          describedbyArr.push(`${fieldId}_extra`);
        }
        childProps['aria-describedby'] = describedbyArr.join(' ');
      }
      if (mergedErrors.length > 0) {
        childProps['aria-invalid'] = 'true';
      }
      if (isRequired) {
        childProps['aria-required'] = 'true';
      }
      if ((0,ref/* supportRef */.f3)(mergedChildren)) {
        childProps.ref = getItemRef(mergedName, mergedChildren);
      }
      // We should keep user origin event handler
      const triggers = new Set([].concat((0,toConsumableArray/* default */.A)(toArray(trigger)), (0,toConsumableArray/* default */.A)(toArray(mergedValidateTrigger))));
      triggers.forEach(eventName => {
        childProps[eventName] = function () {
          var _a2, _c2;
          var _a, _b, _c;
          for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
          }
          (_a = mergedControl[eventName]) === null || _a === void 0 ? void 0 : (_a2 = _a).call.apply(_a2, [mergedControl].concat(args));
          (_c = (_b = mergedChildren.props)[eventName]) === null || _c === void 0 ? void 0 : (_c2 = _c).call.apply(_c2, [_b].concat(args));
        };
      });
      // List of props that need to be watched for changes -> if changes are detected in MemoInput -> rerender
      const watchingChildProps = [childProps['aria-required'], childProps['aria-invalid'], childProps['aria-describedby']];
      childNode = /*#__PURE__*/react.createElement(MemoInput, {
        control: mergedControl,
        update: mergedChildren,
        childProps: watchingChildProps
      }, (0,reactNode/* cloneElement */.Ob)(mergedChildren, childProps));
    } else if (isRenderProps && (shouldUpdate || dependencies) && !hasName) {
      childNode = mergedChildren(context);
    } else {
       false ? 0 : void 0;
      childNode = mergedChildren;
    }
    return renderLayout(childNode, fieldId, isRequired);
  }));
}
const FormItem = InternalFormItem;
FormItem.useStatus = hooks_useFormItemStatus;
/* harmony default export */ var form_FormItem = (FormItem);
;// ./node_modules/antd/es/form/FormList.js
"use client";

var FormList_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};





const FormList = _a => {
  var {
      prefixCls: customizePrefixCls,
      children
    } = _a,
    props = FormList_rest(_a, ["prefixCls", "children"]);
  if (false) {}
  const {
    getPrefixCls
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('form', customizePrefixCls);
  const contextValue = react.useMemo(() => ({
    prefixCls,
    status: 'error'
  }), [prefixCls]);
  return /*#__PURE__*/react.createElement(rc_field_form_es/* List */.B8, Object.assign({}, props), (fields, operation, meta) => (/*#__PURE__*/react.createElement(form_context/* FormItemPrefixContext */.hb.Provider, {
    value: contextValue
  }, children(fields.map(field => Object.assign(Object.assign({}, field), {
    fieldKey: field.key
  })), operation, {
    errors: meta.errors,
    warnings: meta.warnings
  }))));
};
/* harmony default export */ var form_FormList = (FormList);
;// ./node_modules/antd/es/form/hooks/useFormInstance.js


function useFormInstance() {
  const {
    form
  } = (0,react.useContext)(form_context/* FormContext */.cK);
  return form;
}
;// ./node_modules/antd/es/form/index.js
"use client";








const es_form_Form = form_Form;
es_form_Form.Item = form_FormItem;
es_form_Form.List = form_FormList;
es_form_Form.ErrorList = form_ErrorList;
es_form_Form.useForm = useForm;
es_form_Form.useFormInstance = useFormInstance;
es_form_Form.useWatch = rc_field_form_es/* useWatch */.FH;
es_form_Form.Provider = form_context/* FormProvider */.Op;
es_form_Form.create = () => {
   false ? 0 : void 0;
};
/* harmony default export */ var es_form = (es_form_Form);
;// ./src/components/views/session_editor.tsx
const SessionEditor=_ref=>{let{session,onSave,onCancel,isOpen}=_ref;const[form]=es_form.useForm();const{0:teams,1:setTeams}=(0,react.useState)([]);const{0:loading,1:setLoading}=(0,react.useState)(false);const{user}=(0,react.useContext)(provider/* appContext */.v);const[messageApi,contextHolder]=message/* default */.Ay.useMessage();const getDefaultSessionName=()=>{const today=new Date();return today.toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"});};// Fetch teams when modal opens
(0,react.useEffect)(()=>{const fetchTeams=async()=>{if(isOpen){try{setLoading(true);const userId=(user===null||user===void 0?void 0:user.email)||"";const teamsData=await api/* teamAPI */.CG.listTeams(userId);setTeams(teamsData);}catch(error){messageApi.error("Error loading teams");console.error("Error loading teams:",error);}finally{setLoading(false);}}};fetchTeams();},[isOpen,user===null||user===void 0?void 0:user.email]);// Set form values when modal opens or session changes
(0,react.useEffect)(()=>{if(isOpen){form.setFieldsValue({name:(session===null||session===void 0?void 0:session.name)||getDefaultSessionName(),team_id:(session===null||session===void 0?void 0:session.team_id)||undefined});}else{form.resetFields();}},[form,session,isOpen]);const onFinish=async values=>{try{await onSave(Object.assign({},values,{id:session===null||session===void 0?void 0:session.id}));messageApi.success("Session "+(session?"updated":"created")+" successfully");}catch(error){if(error instanceof Error){messageApi.error(error.message);}}};const onFinishFailed=errorInfo=>{messageApi.error("Please check the form for errors");console.error("Form validation failed:",errorInfo);};const hasNoTeams=false;return/*#__PURE__*/react.createElement(modal/* default */.A,{title:session?"Edit Session":"Create Session",open:isOpen,onCancel:onCancel,footer:null,className:"text-primary",forceRender:true},contextHolder,/*#__PURE__*/react.createElement(es_form,{form:form,name:"session-form",layout:"vertical",onFinish:onFinish,onFinishFailed:onFinishFailed,autoComplete:"off"},/*#__PURE__*/react.createElement(es_form.Item,{label:"Session Name",name:"name",rules:[{required:true,message:"Please enter a session name"},{max:100,message:"Session name cannot exceed 100 characters"}]},/*#__PURE__*/react.createElement(input/* default */.A,null)),/*#__PURE__*/react.createElement(es_form.Item,{className:"flex justify-end mb-0"},/*#__PURE__*/react.createElement("div",{className:"flex gap-2"},/*#__PURE__*/react.createElement(es_button/* default */.Ay,{onClick:onCancel},"Cancel"),/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"primary",htmlType:"submit",disabled:hasNoTeams},session?"Update":"Create")))));};/* harmony default export */ var session_editor = ((/* unused pure expression or super */ null && (SessionEditor)));
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/index.js + 8 modules
var config_provider = __webpack_require__(20867);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/index.js + 6 modules
var theme = __webpack_require__(5131);
;// ./src/hooks/useMediaQuery.ts
/** Matches Tailwind `lg` — tablet portrait and phones use compact layout. */const COMPACT_LAYOUT_QUERY="(max-width: 1023px)";function useMediaQuery(query){const{0:matches,1:setMatches}=(0,react.useState)(false);(0,react.useEffect)(()=>{if(typeof window==="undefined"||!window.matchMedia)return;const mql=window.matchMedia(query);const onChange=()=>setMatches(mql.matches);onChange();mql.addEventListener("change",onChange);return()=>mql.removeEventListener("change",onChange);},[query]);return matches;}function useIsCompactLayout(){return useMediaQuery(COMPACT_LAYOUT_QUERY);}
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
;// ./node_modules/lucide-react/dist/esm/icons/menu.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Menu = (0,createLucideIcon/* default */.A)("Menu", [
  ["line", { x1: "4", x2: "20", y1: "12", y2: "12", key: "1e0a9i" }],
  ["line", { x1: "4", x2: "20", y1: "6", y2: "6", key: "1owob3" }],
  ["line", { x1: "4", x2: "20", y1: "18", y2: "18", key: "yk5zj1" }]
]);


//# sourceMappingURL=menu.js.map

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

;// ./node_modules/lucide-react/dist/esm/icons/book-open.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const BookOpen = (0,createLucideIcon/* default */.A)("BookOpen", [
  ["path", { d: "M12 7v14", key: "1akyts" }],
  [
    "path",
    {
      d: "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
      key: "ruj8y"
    }
  ]
]);


//# sourceMappingURL=book-open.js.map

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
const TopNav=_ref=>{let{onToggleSidebar}=_ref;const{user,darkMode,setDarkMode}=(0,react.useContext)(provider/* appContext */.v);const{0:isProfileModalOpen,1:setIsProfileModalOpen}=(0,react.useState)(false);const{0:lang,1:setLang}=(0,react.useState)(()=>localStorage.getItem("drsai_lang")||"zh");(0,react.useEffect)(()=>{console.log(user,"user");},[user]);const handleLogout=()=>{localStorage.removeItem("token");localStorage.removeItem("username");localStorage.removeItem("user_email");localStorage.removeItem("user_name");if(true){window.location.href="/login";}else{}};const toggleLang=()=>{const next=lang==="zh"?"en":"zh";setLang(next);localStorage.setItem("drsai_lang",next);};return/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 flex items-center h-12 lg:h-14 px-2 lg:px-3 "+(darkMode==="dark"?"bg-[#0f0f0f]/65 backdrop-blur-md shadow-[0_12px_28px_-24px_rgba(0,0,0,0.95)]":"bg-white/70 border-b border-gray-200/80 backdrop-blur-md")+" z-[70]"},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-1 flex-shrink-0 min-w-0"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:onToggleSidebar,"aria-label":"\u6253\u5F00\u5BFC\u822A\u83DC\u5355",className:"lg:hidden flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"},/*#__PURE__*/react.createElement(Menu,{className:"w-5 h-5"})),/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2 px-1 lg:px-2.5 py-1 min-w-0"},/*#__PURE__*/react.createElement("img",{src:"https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",alt:"Dr.Sai Logo",className:"w-6 h-6 rounded-md object-cover flex-shrink-0"}),/*#__PURE__*/react.createElement("span",{className:"text-sm font-semibold tracking-wide text-primary whitespace-nowrap hidden sm:inline"},"OpenDrSai"))),/*#__PURE__*/react.createElement("div",{className:"flex-1 min-w-0"}),/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-0.5 lg:gap-1 flex-shrink-0"},/*#__PURE__*/react.createElement(input/* default */.A,{prefix:/*#__PURE__*/react.createElement(search/* default */.A,{className:"w-4 h-4 text-secondary"}),placeholder:lang==="zh"?"搜索...":"Search...",className:"hidden lg:block w-64 rounded-xl mr-2 "+(darkMode==="dark"?"[&_.ant-input]:!bg-white/5 [&_.ant-input]:!text-primary [&_.ant-input-affix-wrapper]:!bg-white/5 [&_.ant-input-affix-wrapper]:!border-border-primary/50":"[&_.ant-input]:!bg-white/85 [&_.ant-input-affix-wrapper]:!bg-white/90 [&_.ant-input-affix-wrapper]:!border-gray-200"),allowClear:true}),/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:darkMode==="dark"?lang==="zh"?"切换亮色":"Light mode":lang==="zh"?"切换暗色":"Dark mode"},/*#__PURE__*/react.createElement("button",{onClick:()=>setDarkMode(darkMode==="dark"?"light":"dark"),className:"flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"},darkMode==="dark"?/*#__PURE__*/react.createElement(esm_SunIcon,{className:"w-5 h-5"}):/*#__PURE__*/react.createElement(esm_MoonIcon,{className:"w-5 h-5"}))),/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:lang==="zh"?"Switch to English":"切换为中文"},/*#__PURE__*/react.createElement("button",{onClick:toggleLang,className:"flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all text-sm font-medium"},lang==="zh"?"EN":"中")),/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:"GitHub"},/*#__PURE__*/react.createElement("a",{href:"https://github.com/hepai-lab/drsai",target:"_blank",rel:"noopener noreferrer",className:"hidden sm:flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"},/*#__PURE__*/react.createElement(Github,{className:"w-5 h-5 stroke-[2]"}))),/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{title:lang==="zh"?"文档":"Documentation"},/*#__PURE__*/react.createElement("a",{href:"https://docs-drsai.ihep.ac.cn/",target:"_blank",rel:"noopener noreferrer",className:"hidden sm:flex items-center justify-center w-9 h-9 rounded-xl text-primary hover:text-accent hover:bg-tertiary/30 transition-all"},/*#__PURE__*/react.createElement(BookOpen,{className:"w-5 h-5 stroke-[2]"}))),user&&/*#__PURE__*/react.createElement(dropdown/* default */.A,{trigger:["click"],menu:{items:[{key:"profile",label:lang==="zh"?"个人设置":"Profile Settings",icon:/*#__PURE__*/react.createElement(User,{className:"w-4 h-4"}),onClick:()=>setIsProfileModalOpen(true)},{type:"divider"},{key:"logout",label:lang==="zh"?"退出登录":"Sign Out",icon:/*#__PURE__*/react.createElement(LogOut,{className:"w-4 h-4"}),onClick:handleLogout,danger:true}]},placement:"bottomRight"},/*#__PURE__*/react.createElement("button",{className:"flex items-center gap-2 px-2 py-1.5 rounded-xl text-sm font-medium transition-colors ml-0.5 lg:ml-1 "+(darkMode==="dark"?"text-secondary hover:text-accent hover:bg-white/5":"text-secondary hover:text-accent hover:bg-violet-50")},user.avatar_url?/*#__PURE__*/react.createElement("img",{className:"h-6 w-6 rounded-full",src:user.avatar_url,alt:user.name}):/*#__PURE__*/react.createElement("div",{className:"h-6 w-6 rounded-full bg-accent text-white flex items-center justify-center text-xs font-medium"},String(user.name||user.email||"?").charAt(0).toUpperCase()))))),/*#__PURE__*/react.createElement(userProfile,{isVisible:isProfileModalOpen,onClose:()=>setIsProfileModalOpen(false),user:user||{name:"",email:""}}));};/* harmony default export */ var layout_TopNav = (TopNav);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/message-square.js
var message_square = __webpack_require__(47504);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/bot.js
var bot = __webpack_require__(42640);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/settings.js
var settings = __webpack_require__(80964);
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

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/wrench.js
var wrench = __webpack_require__(46816);
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

;// ./node_modules/lucide-react/dist/esm/icons/chart-column.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const ChartColumn = (0,createLucideIcon/* default */.A)("ChartColumn", [
  ["path", { d: "M3 3v16a2 2 0 0 0 2 2h16", key: "c24i48" }],
  ["path", { d: "M18 17V9", key: "2bz60n" }],
  ["path", { d: "M13 17V5", key: "1frdt8" }],
  ["path", { d: "M8 17v-3", key: "17ska0" }]
]);


//# sourceMappingURL=chart-column.js.map

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
const SECTIONS=[{id:"chat",icon:/*#__PURE__*/react.createElement(message_square/* default */.A,{className:"w-3.5 h-3.5"}),label:"聊天",defaultItem:"current_session"},{id:"agents",icon:/*#__PURE__*/react.createElement(bot/* default */.A,{className:"w-3.5 h-3.5"}),label:"智能体",defaultItem:"my_agents"},{id:"settings",icon:/*#__PURE__*/react.createElement(settings/* default */.A,{className:"w-3.5 h-3.5"}),label:"设置",defaultItem:"profile"}];const LeftMenu=_ref=>{let{isSidebarOpen,activeSubMenuItem,onSubMenuChange,onClose,showAdminNav=false}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const isDark=darkMode==="dark";const{0:expanded,1:setExpanded}=(0,react.useState)({chat:true,agents:false,settings:false});(0,react.useEffect)(()=>{if(["current_session"].includes(activeSubMenuItem)){setExpanded(e=>Object.assign({},e,{chat:true}));}else if(["my_agents","agent_square","skills_square","library"].includes(activeSubMenuItem)){setExpanded(e=>Object.assign({},e,{agents:true}));}else if(["profile","channels","logs","usage_analytics","user_management","agent_management"].includes(activeSubMenuItem)){setExpanded(e=>Object.assign({},e,{settings:true}));}},[activeSubMenuItem]);const toggleSection=id=>setExpanded(e=>Object.assign({},e,{[id]:!e[id]}));const SectionHeader=_ref2=>{let{id,icon,label}=_ref2;return/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>toggleSection(id),className:"w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold tracking-wide text-secondary hover:text-primary hover:bg-tertiary/25 transition-colors"},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-2"},icon,/*#__PURE__*/react.createElement("span",null,label)),expanded[id]?/*#__PURE__*/react.createElement(chevron_down/* default */.A,{className:"w-3.5 h-3.5"}):/*#__PURE__*/react.createElement(chevron_right/* default */.A,{className:"w-3.5 h-3.5"}));};const NavItem=_ref3=>{let{id,icon,label,onClick}=_ref3;const isActive=id?activeSubMenuItem===id:false;return/*#__PURE__*/react.createElement("button",{type:"button",onClick:onClick,className:"relative w-full flex items-center gap-2.5 pl-7 pr-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 "+(isActive?"bg-accent/15 text-accent font-semibold shadow-sm":"text-secondary hover:text-primary hover:bg-tertiary/25")},isActive&&/*#__PURE__*/react.createElement("span",{className:"absolute left-3 h-4 w-0.5 rounded-full bg-accent"}),/*#__PURE__*/react.createElement("span",{className:"flex-shrink-0"},icon),/*#__PURE__*/react.createElement("span",{className:"truncate"},label));};// ── Collapsed strip ──
// Map each section to the items it contains, for active highlight detection
const SECTION_ITEMS={chat:["current_session"],agents:["my_agents","agent_square","skills_square","library"],settings:["profile","channels","logs"].concat((0,toConsumableArray/* default */.A)(showAdminNav?["usage_analytics","user_management"]:[]),["agent_management"])};if(!isSidebarOpen){return/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center pt-1 h-full"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:onClose,title:"\u5C55\u5F00\u4FA7\u8FB9\u680F",className:"flex items-center justify-center w-full h-8 transition-colors "+(isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},/*#__PURE__*/react.createElement(chevron_right/* default */.A,{className:"w-3.5 h-3.5"})),/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center gap-1 mt-2"},SECTIONS.map(s=>{const isSectionActive=SECTION_ITEMS[s.id].includes(activeSubMenuItem);return/*#__PURE__*/react.createElement(es_tooltip/* default */.A,{key:s.id,title:s.label,placement:"right"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{onSubMenuChange(s.defaultItem);onClose();},className:"flex items-center justify-center w-7 h-7 rounded-lg transition-colors "+(isSectionActive?"text-accent bg-accent/10":isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},s.icon));})));}// ── Expanded ──
return/*#__PURE__*/react.createElement("div",{className:"h-full flex flex-col"},/*#__PURE__*/react.createElement("div",{className:"px-3 pt-3 flex items-center justify-end"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:onClose,title:"\u6536\u8D77\u4FA7\u8FB9\u680F",className:"flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors "+(isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},/*#__PURE__*/react.createElement(chevron_left/* default */.A,{className:"w-3.5 h-3.5"}))),/*#__PURE__*/react.createElement("div",{className:"flex-1 overflow-y-auto px-2 pt-2 pb-4 sidebar-scroll space-y-1"},/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement(SectionHeader,{id:"chat",icon:/*#__PURE__*/react.createElement(message_square/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u804A\u5929"}),expanded.chat&&/*#__PURE__*/react.createElement("div",{className:"mt-0.5 space-y-0.5"},/*#__PURE__*/react.createElement(NavItem,{id:"current_session",icon:/*#__PURE__*/react.createElement(message_square/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u804A\u5929",onClick:()=>onSubMenuChange("current_session")}))),/*#__PURE__*/react.createElement("div",{className:"h-px bg-border-primary/25 my-1.5"}),/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement(SectionHeader,{id:"agents",icon:/*#__PURE__*/react.createElement(bot/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u667A\u80FD\u4F53"}),expanded.agents&&/*#__PURE__*/react.createElement("div",{className:"mt-0.5 space-y-0.5"},/*#__PURE__*/react.createElement(NavItem,{id:"agent_square",icon:/*#__PURE__*/react.createElement(Grid2x2,{className:"w-3.5 h-3.5"}),label:"\u667A\u80FD\u4F53\u5E7F\u573A",onClick:()=>onSubMenuChange("agent_square")}),/*#__PURE__*/react.createElement(NavItem,{id:"skills_square",icon:/*#__PURE__*/react.createElement(wrench/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u6280\u80FD\u5E7F\u573A",onClick:()=>onSubMenuChange("skills_square")}),/*#__PURE__*/react.createElement(NavItem,{id:"library",icon:/*#__PURE__*/react.createElement(Library,{className:"w-3.5 h-3.5"}),label:"\u5E93",onClick:()=>onSubMenuChange("library")}))),/*#__PURE__*/react.createElement("div",{className:"h-px bg-border-primary/25 my-1.5"}),/*#__PURE__*/react.createElement("div",null,/*#__PURE__*/react.createElement(SectionHeader,{id:"settings",icon:/*#__PURE__*/react.createElement(settings/* default */.A,{className:"w-3.5 h-3.5"}),label:"\u8BBE\u7F6E"}),expanded.settings&&/*#__PURE__*/react.createElement("div",{className:"mt-0.5 space-y-0.5"},/*#__PURE__*/react.createElement(NavItem,{id:"profile",icon:/*#__PURE__*/react.createElement(UserCog,{className:"w-3.5 h-3.5"}),label:"\u914D\u7F6E",onClick:()=>onSubMenuChange("profile")}),showAdminNav?/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(NavItem,{id:"usage_analytics",icon:/*#__PURE__*/react.createElement(ChartColumn,{className:"w-3.5 h-3.5"}),label:"\u4F7F\u7528\u5206\u6790",onClick:()=>onSubMenuChange("usage_analytics")}),/*#__PURE__*/react.createElement(NavItem,{id:"user_management",icon:/*#__PURE__*/react.createElement(Users,{className:"w-3.5 h-3.5"}),label:"\u7528\u6237\u7BA1\u7406",onClick:()=>onSubMenuChange("user_management")})):null))));};/* harmony default export */ var layout_LeftMenu = (LeftMenu);
;// ./node_modules/lucide-react/dist/esm/icons/panel-left-open.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const PanelLeftOpen = (0,createLucideIcon/* default */.A)("PanelLeftOpen", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }],
  ["path", { d: "m14 9 3 3-3 3", key: "8010ee" }]
]);


//# sourceMappingURL=panel-left-open.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/plus.js
var plus = __webpack_require__(80697);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
;// ./src/layout/Canvas.tsx
// const VIEWS: { id: CanvasViewId; label: string; icon: React.ReactNode }[] = [
//   { id: "chat", label: "对话", icon: <MessageSquare className="w-3.5 h-3.5" /> },
//   { id: "file_preview", label: "文件预览", icon: <FileText className="w-3.5 h-3.5" /> },
// ];
const Canvas=_ref=>{let{children,filePreviewContent,activeView,activeMenuId,activeMenuLabel,onViewChange,onNewSession,showNewSessionButton=false,showRightPanelToggle=false,onOpenRightPanel}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const location=(0,useRouter/* useLocation */.zy)();const navigate=(0,useRouter/* useNavigate */.Zp)();const session=(0,store/* useConfigStore */.J)(s=>s.session);const agentInfo=(0,modeConfig/* useModeConfigStore */.Q)(s=>s.agentInfo);const selectedAgent=(0,modeConfig/* useModeConfigStore */.Q)(s=>s.selectedAgent);const agentOfflineSnapshot=(0,modeConfig/* useModeConfigStore */.Q)(s=>s.agentOfflineSnapshot);const hasActiveSession=Boolean(session===null||session===void 0?void 0:session.id);const{agentDisplayName,defaultConfigLabel}=(0,react.useMemo)(()=>{var _sessionAgentModeConf,_ref2,_ref3,_sessionAgentModeConf2;const sessionAgentModeConfig=(session===null||session===void 0?void 0:session.agent_mode_config)||null;const name=typeof(sessionAgentModeConfig===null||sessionAgentModeConfig===void 0?void 0:sessionAgentModeConfig.name)==="string"&&sessionAgentModeConfig.name.trim()||typeof(agentInfo===null||agentInfo===void 0?void 0:agentInfo.name)==="string"&&agentInfo.name.trim()||typeof(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.name)==="string"&&selectedAgent.name.trim()||typeof(sessionAgentModeConfig===null||sessionAgentModeConfig===void 0?void 0:sessionAgentModeConfig.mode)==="string"&&sessionAgentModeConfig.mode.trim()||typeof(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.mode)==="string"&&selectedAgent.mode.trim()||"";const cfgRaw=hasActiveSession?(_sessionAgentModeConf=sessionAgentModeConfig===null||sessionAgentModeConfig===void 0?void 0:sessionAgentModeConfig.defult_config_name)!==null&&_sessionAgentModeConf!==void 0?_sessionAgentModeConf:"":(_ref2=(_ref3=(_sessionAgentModeConf2=sessionAgentModeConfig===null||sessionAgentModeConfig===void 0?void 0:sessionAgentModeConfig.defult_config_name)!==null&&_sessionAgentModeConf2!==void 0?_sessionAgentModeConf2:agentInfo===null||agentInfo===void 0?void 0:agentInfo.defult_config_name)!==null&&_ref3!==void 0?_ref3:selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.defult_config_name)!==null&&_ref2!==void 0?_ref2:"";const cfg=typeof cfgRaw==="string"?cfgRaw.trim():String(cfgRaw||"").trim();const normalizedCfg=/^default$/i.test(cfg)?"":cfg;return{agentDisplayName:name,defaultConfigLabel:normalizedCfg};},[session===null||session===void 0?void 0:session.id,session===null||session===void 0?void 0:session.agent_mode_config,agentInfo,selectedAgent,hasActiveSession]);const showSessionAgentBar=activeMenuId===menuRoutes/* MENU_IDS */.h7.currentSession&&hasActiveSession&&(Boolean(agentDisplayName)||Boolean(defaultConfigLabel));return/*#__PURE__*/react.createElement("div",{className:"h-full flex flex-col min-h-0 overflow-hidden"},/*#__PURE__*/react.createElement("div",{className:"relative flex-shrink-0 flex items-center gap-1 px-2 sm:px-4 h-11 text-sm "+(darkMode==="dark"?"bg-white/[0.02]":"border-b border-gray-200/80 bg-white/60")},/*#__PURE__*/react.createElement("div",{className:"flex items-center gap-1 min-w-0 flex-shrink z-10"},/*#__PURE__*/react.createElement("span",{className:"text-secondary font-medium tracking-wide hidden sm:inline"},"OpenDrSai"),/*#__PURE__*/react.createElement(chevron_right/* default */.A,{className:"w-3.5 h-3.5 text-secondary/50 flex-shrink-0 hidden sm:inline"}),/*#__PURE__*/react.createElement("span",{className:"px-2 py-0.5 rounded-md text-xs font-medium "+(darkMode==="dark"?"bg-violet-500/10 text-violet-200":"bg-violet-100 text-violet-700")},activeMenuLabel)),showSessionAgentBar&&/*#__PURE__*/react.createElement("div",{className:"pointer-events-none absolute inset-x-0 top-0 hidden md:flex h-full items-center justify-center px-28 sm:px-36","aria-live":"polite"},/*#__PURE__*/react.createElement("div",{className:"flex max-w-[min(480px,52vw)] min-w-0 items-center gap-2.5 p-0"},/*#__PURE__*/react.createElement(bot/* default */.A,Object.assign({className:"h-6 w-6 flex-shrink-0 motion-reduce:animate-none "+(agentOfflineSnapshot?"opacity-45 grayscale "+(darkMode==="dark"?"text-white/45":"text-slate-400"):"text-accent opacity-90 animate-logo-hop"),strokeWidth:2,"aria-hidden":!agentOfflineSnapshot},agentOfflineSnapshot?{"aria-label":"智能体已从列表移除，当前为会话中的存档配置",title:"智能体已从列表移除，当前为会话中的存档配置"}:{})),/*#__PURE__*/react.createElement("div",{className:"flex min-w-0 flex-1 flex-row flex-nowrap items-baseline gap-x-1 text-left font-agent"},agentDisplayName?/*#__PURE__*/react.createElement("span",{className:"min-w-0 truncate text-[1.0625rem] sm:text-lg font-bold leading-tight tracking-[-0.03em] antialiased "+(defaultConfigLabel?"flex-none max-w-[min(13rem,46%)]":"max-w-full")+" "+(darkMode==="dark"?"text-white [text-shadow:0_1px_24px_rgba(167,139,250,0.12)]":"text-slate-900"),title:agentDisplayName},agentDisplayName):null,defaultConfigLabel?/*#__PURE__*/react.createElement("span",{className:"font-agent-mono min-w-0 truncate text-[0.8125rem] font-medium tracking-wide "+(agentDisplayName?"flex-1 text-left":"max-w-full text-left")+" "+(darkMode==="dark"?"text-violet-300/85":"text-violet-700/90"),title:defaultConfigLabel},defaultConfigLabel):null))),/*#__PURE__*/react.createElement("div",{className:"ml-auto flex items-center gap-1.5 sm:gap-2 flex-shrink-0 z-10"},showRightPanelToggle&&onOpenRightPanel&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:onOpenRightPanel,className:"flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors "+(darkMode==="dark"?"bg-white/[0.04] hover:bg-white/[0.07] text-secondary border border-border-primary/30":"bg-white/70 hover:bg-white text-gray-700 border border-gray-200/80"),"aria-label":"\u6253\u5F00\u4FA7\u9762\u677F",title:"\u6253\u5F00\u4FA7\u9762\u677F"},/*#__PURE__*/react.createElement(PanelLeftOpen,{className:"w-3.5 h-3.5"})),showNewSessionButton&&onNewSession&&activeMenuId===menuRoutes/* MENU_IDS */.h7.currentSession&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:onNewSession,className:"flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors "+(darkMode==="dark"?"bg-white/[0.04] hover:bg-white/[0.07] text-secondary border border-border-primary/30":"bg-white/70 hover:bg-white text-gray-700 border border-gray-200/80"),"aria-label":"\u65B0\u5EFA\u4F1A\u8BDD",title:"\u65B0\u5EFA\u4F1A\u8BDD"},/*#__PURE__*/react.createElement(plus/* default */.A,{className:"w-3.5 h-3.5"}),/*#__PURE__*/react.createElement("span",{className:"hidden sm:inline"},"\u65B0\u5EFA\u4F1A\u8BDD")),activeMenuId===menuRoutes/* MENU_IDS */.h7.currentSession&&/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{const withMenu=(0,menuRoutes/* createSearchWithMenu */.gK)(location.search,menuRoutes/* MENU_IDS */.h7.agentSquare);navigate((0,menuRoutes/* createSearchWithView */._M)(withMenu,"chat"));},className:"group relative inline-flex items-center gap-2 px-2 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 "+(darkMode==="dark"?"ring-offset-[#0b0f19]":"ring-offset-white"),"aria-label":"\u4F53\u9A8C\u66F4\u591A\uFF1A\u8DF3\u8F6C\u667A\u80FD\u4F53\u5E7F\u573A",title:"\u4F53\u9A8C\u66F4\u591A\uFF1A\u667A\u80FD\u4F53\u5E7F\u573A"},/*#__PURE__*/react.createElement("span",{className:"absolute inset-0 rounded-lg opacity-100 transition-opacity "+(darkMode==="dark"?"bg-gradient-to-r from-fuchsia-500/90 via-violet-500/90 to-indigo-500/90":"bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500")}),/*#__PURE__*/react.createElement("span",{className:"absolute -inset-0.5 rounded-xl blur opacity-40 transition-opacity group-hover:opacity-70 "+(darkMode==="dark"?"bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500":"bg-gradient-to-r from-fuchsia-400 via-violet-400 to-indigo-400")}),/*#__PURE__*/react.createElement("span",{className:"relative inline-flex items-center gap-2 "+(darkMode==="dark"?"text-white":"text-white")},/*#__PURE__*/react.createElement(Grid2x2,{className:"w-3.5 h-3.5"}),/*#__PURE__*/react.createElement("span",{className:"hidden sm:inline"},"\u4F53\u9A8C\u66F4\u591A"))))),/*#__PURE__*/react.createElement("div",{className:"flex-1 min-h-0 overflow-hidden rounded-b-2xl"},/*#__PURE__*/react.createElement("div",{className:activeView==="chat"?"h-full":"hidden"},children),/*#__PURE__*/react.createElement("div",{className:activeView==="file_preview"?"h-full":"hidden"},filePreviewContent!==null&&filePreviewContent!==void 0?filePreviewContent:/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement(file_text/* default */.A,{className:"w-10 h-10 mx-auto mb-3 opacity-20"}),/*#__PURE__*/react.createElement("p",{className:"text-sm opacity-40"},"\u6682\u65E0\u6587\u4EF6"))))));};/* harmony default export */ var layout_Canvas = (Canvas);
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
var store_rightPanel = __webpack_require__(46886);
;// ./src/layout/RightPanel.tsx
const TABS=[{id:"files",label:"文件空间",icon:/*#__PURE__*/react.createElement(file_text/* default */.A,{className:"w-3.5 h-3.5"})},{id:"overview",label:"运行概览",icon:/*#__PURE__*/react.createElement(Activity,{className:"w-3.5 h-3.5"})},{id:"history",label:"历史会话",icon:/*#__PURE__*/react.createElement(clock/* default */.A,{className:"w-3.5 h-3.5"})}];const RightPanel=_ref=>{let{width=380,isCompact=false,historyContent,filesContent,onTabChange}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const activeTab=(0,store_rightPanel/* useRightPanelStore */.x)(s=>s.layoutTab);const setActiveTab=(0,store_rightPanel/* useRightPanelStore */.x)(s=>s.setLayoutTab);const isOpen=(0,store_rightPanel/* useRightPanelStore */.x)(s=>s.isOpen);const setIsOpen=(0,store_rightPanel/* useRightPanelStore */.x)(s=>s.setIsOpen);const setOverviewSlot=(0,store_rightPanel/* useRightPanelStore */.x)(s=>s.setOverviewSlot);const overviewSlotRef=(0,react.useCallback)(el=>{setOverviewSlot(el);},[setOverviewSlot]);const isDark=darkMode==="dark";if(isCompact&&!isOpen){return null;}const panelWidth=isCompact?"100%":isOpen?width:40;return/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 flex flex-col h-full transition-all duration-300 overflow-hidden shadow-modern "+(isOpen&&!isCompact?"rounded-2xl":isCompact?"rounded-none":"rounded-lg")+" "+(isDark?"bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg":"bg-white/90 border border-gray-200/70 backdrop-blur-md"),style:{width:panelWidth}},isOpen?/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 flex items-stretch "+(isDark?"bg-white/[0.02]":"border-b border-gray-200/80 bg-white/70")},TABS.map(tab=>{const isActive=activeTab===tab.id;return/*#__PURE__*/react.createElement("button",{key:tab.id,type:"button",onClick:()=>{setActiveTab(tab.id);onTabChange===null||onTabChange===void 0?void 0:onTabChange(tab.id);},className:"relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 flex-1 text-[11px] font-medium transition-all select-none "+(isActive?"text-accent bg-accent/[0.11]":"text-secondary hover:text-primary hover:bg-tertiary/25")},/*#__PURE__*/react.createElement("span",{className:"transition-transform "+(isActive?"scale-110":"")},tab.icon),/*#__PURE__*/react.createElement("span",{className:isActive?"font-semibold":""},tab.label),isActive&&/*#__PURE__*/react.createElement("span",{className:"absolute bottom-0 left-2 right-2 h-[3px] rounded-full bg-accent"}));}),/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>setIsOpen(false),title:"\u6536\u8D77\u9762\u677F",className:"flex-shrink-0 flex min-h-[44px] min-w-[44px] items-center justify-center transition-colors "+(isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},/*#__PURE__*/react.createElement(chevron_right/* default */.A,{className:"w-3.5 h-3.5"}))),/*#__PURE__*/react.createElement("div",{className:"flex-1 min-h-0 overflow-hidden pt-1"},/*#__PURE__*/react.createElement("div",{className:activeTab==="overview"?"h-full":"hidden"},/*#__PURE__*/react.createElement("div",{ref:overviewSlotRef,className:"h-full w-full"})),/*#__PURE__*/react.createElement("div",{className:activeTab==="history"?"h-full":"hidden"},historyContent!==null&&historyContent!==void 0?historyContent:/*#__PURE__*/react.createElement(Empty,{icon:/*#__PURE__*/react.createElement(clock/* default */.A,null),text:"\u6682\u65E0\u5386\u53F2\u4F1A\u8BDD"})),/*#__PURE__*/react.createElement("div",{className:activeTab==="files"?"h-full":"hidden"},filesContent!==null&&filesContent!==void 0?filesContent:/*#__PURE__*/react.createElement("div",{className:"border border-gray-200/70 rounded-lg m-4 h-full flex items-center justify-center bg-gray-100/60"},/*#__PURE__*/react.createElement(Empty,{icon:/*#__PURE__*/react.createElement(file_text/* default */.A,null),text:"\u6682\u65E0\u6587\u4EF6"}))))):/*#__PURE__*//* Collapsed strip (desktop only) */react.createElement("div",{className:"flex flex-col items-center pt-1"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>setIsOpen(true),title:"\u5C55\u5F00\u9762\u677F",className:"flex items-center justify-center w-full h-8 transition-colors "+(isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},/*#__PURE__*/react.createElement(chevron_left/* default */.A,{className:"w-3.5 h-3.5"})),/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center gap-1 mt-2"},TABS.map(tab=>/*#__PURE__*/react.createElement("button",{key:tab.id,type:"button",onClick:()=>{setIsOpen(true);setActiveTab(tab.id);onTabChange===null||onTabChange===void 0?void 0:onTabChange(tab.id);},title:tab.label,className:"flex items-center justify-center w-7 h-7 rounded-lg transition-colors "+(activeTab===tab.id?"text-accent bg-accent/10":isDark?"text-secondary hover:text-primary hover:bg-white/5":"text-gray-400 hover:text-gray-600 hover:bg-gray-100/60")},tab.icon)))));};const Empty=_ref2=>{let{icon,text}=_ref2;return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement("div",{className:"w-10 h-10 mx-auto mb-3 opacity-20 [&>svg]:w-full [&>svg]:h-full"},icon),/*#__PURE__*/react.createElement("p",{className:"text-sm opacity-40"},text)));};/* harmony default export */ var layout_RightPanel = (RightPanel);
;// ./src/layout/AppLayout.tsx
const AppLayout=_ref=>{let{isSidebarOpen,onToggleSidebar,activeSubMenuItem,activeMenuLabel,onSubMenuChange,showAdminNav=false,rightPanelWidth=380,rightPanelHistory,rightPanelFiles,onRightPanelTabChange,children,canvasActiveView,onCanvasViewChange,canvasFilePreviewContent,onNewSession,showNewSessionButton=false}=_ref;const{darkMode}=(0,react.useContext)(provider/* appContext */.v);const isCompact=useIsCompactLayout();const rightPanelIsOpen=(0,store_rightPanel/* useRightPanelStore */.x)(s=>s.isOpen);const setRightPanelOpen=(0,store_rightPanel/* useRightPanelStore */.x)(s=>s.setIsOpen);const containerRef=(0,react.useRef)(null);const sizes=(0,react.useMemo)(()=>({left:{collapsed:40,min:180,max:420,defaultOpen:224,storageKey:"drsai:layout:leftWidth"},right:{collapsed:40,min:280,max:720,defaultOpen:rightPanelWidth,storageKey:"drsai:layout:rightWidth"}}),[rightPanelWidth]);const{0:leftWidth,1:setLeftWidth}=(0,react.useState)(sizes.left.defaultOpen);const{0:rightWidth,1:setRightWidth}=(0,react.useState)(sizes.right.defaultOpen);(0,react.useEffect)(()=>{try{const leftRaw=localStorage.getItem(sizes.left.storageKey);const rightRaw=localStorage.getItem(sizes.right.storageKey);if(leftRaw){const v=Number(leftRaw);if(Number.isFinite(v))setLeftWidth(Math.min(sizes.left.max,Math.max(sizes.left.min,v)));}if(rightRaw){const v=Number(rightRaw);if(Number.isFinite(v))setRightWidth(Math.min(sizes.right.max,Math.max(sizes.right.min,v)));}}catch(_unused){// ignore
}},[sizes.left.max,sizes.left.min,sizes.left.storageKey,sizes.right.max,sizes.right.min,sizes.right.storageKey]);(0,react.useEffect)(()=>{try{localStorage.setItem(sizes.left.storageKey,String(leftWidth));}catch(_unused2){// ignore
}},[leftWidth,sizes.left.storageKey]);(0,react.useEffect)(()=>{try{localStorage.setItem(sizes.right.storageKey,String(rightWidth));}catch(_unused3){// ignore
}},[rightWidth,sizes.right.storageKey]);const beginDrag=(e,side)=>{var _setPointerCapture,_ref2;const el=containerRef.current;if(!el)return;e.preventDefault();(_setPointerCapture=(_ref2=e.currentTarget).setPointerCapture)===null||_setPointerCapture===void 0?void 0:_setPointerCapture.call(_ref2,e.pointerId);const rect=el.getBoundingClientRect();const bodyCursor=document.body.style.cursor;const bodyUserSelect=document.body.style.userSelect;document.body.style.cursor="col-resize";document.body.style.userSelect="none";const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));const onMove=ev=>{if(side==="left"){const next=clamp(ev.clientX-rect.left,sizes.left.min,sizes.left.max);setLeftWidth(next);}else{const next=clamp(rect.right-ev.clientX,sizes.right.min,sizes.right.max);setRightWidth(next);}};const onUp=()=>{window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);window.removeEventListener("pointercancel",onUp);document.body.style.cursor=bodyCursor;document.body.style.userSelect=bodyUserSelect;};window.addEventListener("pointermove",onMove);window.addEventListener("pointerup",onUp);window.addEventListener("pointercancel",onUp);};(0,react.useEffect)(()=>{document.getElementsByTagName("html")[0].className=darkMode==="dark"?"dark bg-primary":"light bg-primary";},[darkMode]);const panelShellClass=darkMode==="dark"?"bg-[#0d1117]/72 backdrop-blur-md shadow-modern-lg":"bg-white/90 border border-gray-200/70 backdrop-blur-md";const leftMenu=/*#__PURE__*/react.createElement(layout_LeftMenu,{isSidebarOpen:isCompact?true:isSidebarOpen,activeSubMenuItem:activeSubMenuItem,onSubMenuChange:onSubMenuChange,onClose:onToggleSidebar,showAdminNav:showAdminNav});const rightPanel=/*#__PURE__*/react.createElement(layout_RightPanel,{isCompact:isCompact,width:isCompact?undefined:rightWidth,historyContent:rightPanelHistory,filesContent:rightPanelFiles,onTabChange:onRightPanelTabChange});const openRightPanel=()=>{if(isCompact&&isSidebarOpen)onToggleSidebar();setRightPanelOpen(true);};return/*#__PURE__*/react.createElement(config_provider/* default */.Ay,{theme:{token:{borderRadius:12,colorBgBase:darkMode==="dark"?"#0d1117":"#ffffff"},algorithm:darkMode==="dark"?theme/* default */.A.darkAlgorithm:theme/* default */.A.defaultAlgorithm}},/*#__PURE__*/react.createElement("div",{className:"h-screen flex flex-col bg-primary overflow-hidden relative"},/*#__PURE__*/react.createElement("div",{className:"pointer-events-none absolute inset-0 overflow-hidden"},/*#__PURE__*/react.createElement("div",{className:"absolute -top-24 -left-20 h-72 w-72 rounded-full blur-3xl "+(darkMode==="dark"?"bg-violet-500/10":"bg-violet-400/20")}),/*#__PURE__*/react.createElement("div",{className:"absolute -bottom-28 right-6 h-80 w-80 rounded-full blur-3xl "+(darkMode==="dark"?"bg-blue-500/10":"bg-cyan-300/25")})),/*#__PURE__*/react.createElement(layout_TopNav,{isSidebarOpen:isSidebarOpen,onToggleSidebar:onToggleSidebar}),/*#__PURE__*/react.createElement("div",{ref:containerRef,className:"flex-1 flex overflow-hidden relative z-10 "+(isCompact?"p-1 gap-0":"p-2 gap-2")},!isCompact&&/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 h-full transition-all duration-300 overflow-hidden shadow-modern "+(isSidebarOpen?"rounded-2xl":"rounded-lg")+" "+panelShellClass,style:{width:isSidebarOpen?leftWidth:sizes.left.collapsed}},leftMenu),isSidebarOpen&&/*#__PURE__*/react.createElement("div",{role:"separator","aria-orientation":"vertical","aria-label":"\u8C03\u6574\u5DE6\u4FA7\u680F\u5BBD\u5EA6",onPointerDown:e=>beginDrag(e,"left"),className:"w-1 rounded-full transition-colors "+(darkMode==="dark"?"bg-white/5 hover:bg-white/12":"bg-gray-200/60 hover:bg-gray-300/80"),style:{cursor:"col-resize",touchAction:"none"}})),/*#__PURE__*/react.createElement("div",{className:"flex-1 min-w-0 rounded-2xl shadow-modern overflow-hidden "+(darkMode==="dark"?"bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg":"bg-white/85 border border-gray-200/70 backdrop-blur-md")},/*#__PURE__*/react.createElement(layout_Canvas,{activeView:canvasActiveView,activeMenuId:activeSubMenuItem,activeMenuLabel:activeMenuLabel,onViewChange:onCanvasViewChange,filePreviewContent:canvasFilePreviewContent,onNewSession:onNewSession,showNewSessionButton:showNewSessionButton,showRightPanelToggle:isCompact&&!rightPanelIsOpen,onOpenRightPanel:openRightPanel},children)),!isCompact&&/*#__PURE__*/react.createElement(react.Fragment,null,rightPanelIsOpen&&/*#__PURE__*/react.createElement("div",{role:"separator","aria-orientation":"vertical","aria-label":"\u8C03\u6574\u53F3\u4FA7\u680F\u5BBD\u5EA6",onPointerDown:e=>beginDrag(e,"right"),className:"w-1 rounded-full transition-colors "+(darkMode==="dark"?"bg-white/5 hover:bg-white/12":"bg-gray-200/60 hover:bg-gray-300/80"),style:{cursor:"col-resize",touchAction:"none"}}),rightPanel)),isCompact&&isSidebarOpen&&/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("button",{type:"button","aria-label":"\u5173\u95ED\u5BFC\u822A\u83DC\u5355",className:"fixed inset-0 top-12 lg:top-14 z-40 bg-black/50",onClick:onToggleSidebar}),/*#__PURE__*/react.createElement("div",{className:"fixed top-12 lg:top-14 left-0 bottom-0 z-50 w-[min(280px,85vw)] overflow-hidden shadow-modern rounded-r-2xl "+panelShellClass},leftMenu)),isCompact&&rightPanelIsOpen&&/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement("button",{type:"button","aria-label":"\u5173\u95ED\u4FA7\u9762\u677F",className:"fixed inset-0 top-12 lg:top-14 z-40 bg-black/50",onClick:()=>setRightPanelOpen(false)}),/*#__PURE__*/react.createElement("div",{className:"fixed top-12 lg:top-14 right-0 bottom-0 z-50 w-[min(100%,420px)] overflow-hidden shadow-modern rounded-l-2xl "+panelShellClass},rightPanel))));};/* harmony default export */ var layout_AppLayout = (AppLayout);
;// ./src/layout/index.ts

;// ./src/components/views/manager.tsx
const _excluded=["default_agent_id"];const AgentSquare=/*#__PURE__*/react.lazy(()=>__webpack_require__.e(/* import() */ 3264).then(__webpack_require__.bind(__webpack_require__, 43264)).then(m=>({default:m.AgentSquare})));const SkillsSquarePage=/*#__PURE__*/react.lazy(()=>Promise.all(/* import() */[__webpack_require__.e(1148), __webpack_require__.e(3716)]).then(__webpack_require__.bind(__webpack_require__, 57826)));const UsageAnalyticsPage=/*#__PURE__*/react.lazy(()=>Promise.all(/* import() */[__webpack_require__.e(1869), __webpack_require__.e(6355)]).then(__webpack_require__.bind(__webpack_require__, 2754)));const LibraryPage=/*#__PURE__*/react.lazy(()=>__webpack_require__.e(/* import() */ 2793).then(__webpack_require__.bind(__webpack_require__, 12679)));const MenuPanelFallback=()=>/*#__PURE__*/react.createElement("div",{className:"flex h-full items-center justify-center text-secondary"},/*#__PURE__*/react.createElement(spin/* default */.A,null));/** Extensions treated as inline-previewable images in the right-panel file list */const RIGHT_PANEL_IMAGE_EXT=new Set(["png","jpg","jpeg","gif","webp","svg","bmp"]);const extensionFromFilename=name=>{const i=name.lastIndexOf(".");return i<0?"":name.slice(i+1).toLowerCase();};const isImageMessageFile=file=>{var _file$mime_type$trim$,_file$mime_type;const mime=(_file$mime_type$trim$=(_file$mime_type=file.mime_type)===null||_file$mime_type===void 0?void 0:_file$mime_type.trim().toLowerCase())!==null&&_file$mime_type$trim$!==void 0?_file$mime_type$trim$:"";if(mime.startsWith("image/"))return true;return RIGHT_PANEL_IMAGE_EXT.has(extensionFromFilename((file.name||"").trim()));};const SessionManager=()=>{var _session$id;const{0:isEditorOpen,1:setIsEditorOpen}=(0,react.useState)(false);const{0:editingSession,1:setEditingSession}=(0,react.useState)();const{0:isSidebarOpen,1:setIsSidebarOpen}=(0,react.useState)(true);const isCompact=useIsCompactLayout();const{0:historySearchQuery,1:setHistorySearchQuery}=(0,react.useState)("");const historyScrollRef=(0,react.useRef)(null);const historyScrollTopRef=(0,react.useRef)(0);/** 从「库」带入聊天输入框的已上传文件（短时清空引用，避免重复注入） */const{0:libraryAttachPrefill,1:setLibraryAttachPrefill}=(0,react.useState)(null);/** Survives NewChatView → ChatView/WelcomeScreen so example chips do not flash on first send */const{0:sampleTasksDismissed,1:setSampleTasksDismissed}=(0,react.useState)(false);const[messageApi,contextHolder]=message/* default */.Ay.useMessage();const{0:baseUrl,1:setBaseUrl}=(0,react.useState)();const{0:sessionFileEvents,1:setSessionFileEvents}=(0,react.useState)({});const{0:selectedPreviewFile,1:setSelectedPreviewFile}=(0,react.useState)(null);const location=(0,useRouter/* useLocation */.zy)();const navigate=(0,useRouter/* useNavigate */.Zp)();const{0:pendingMenuId,1:setPendingMenuId}=(0,react.useState)(null);const menuFromUrl=(0,react.useMemo)(()=>(0,menuRoutes/* getMenuIdFromSearch */.JK)(location.search),[location.search]);const activeSubMenuItem=pendingMenuId!==null&&pendingMenuId!==void 0?pendingMenuId:menuFromUrl;(0,react.useEffect)(()=>{if(pendingMenuId!==null&&menuFromUrl===pendingMenuId){setPendingMenuId(null);}},[pendingMenuId,menuFromUrl]);const activeCanvasView=(0,react.useMemo)(()=>(0,menuRoutes/* getCanvasViewFromSearch */.U4)(location.search),[location.search]);const activeMenuLabel=(0,react.useMemo)(()=>menuRoutes/* MENU_LABELS */.AF[activeSubMenuItem],[activeSubMenuItem]);// 登入后常为 / 无 query，补全默认 menu/view（走 history，不触发 Gatsby page-data）
(0,react.useEffect)(()=>{if(typeof window==="undefined")return;const params=new URLSearchParams(location.search);if(params.has("menu")&&params.has("view"))return;const next=(0,menuRoutes/* createSearchWithView */._M)((0,menuRoutes/* createSearchWithMenu */.gK)(location.search,menuRoutes/* DEFAULT_MENU_ID */.Yh),menuRoutes/* DEFAULT_VIEW_ID */.UU);navigate(next,{replace:true});},[location.search,navigate]);const navigateToMenu=(0,react.useCallback)(menuId=>{const withMenu=(0,menuRoutes/* createSearchWithMenu */.gK)(location.search,menuId);navigate((0,menuRoutes/* createSearchWithView */._M)(withMenu,menuRoutes/* DEFAULT_VIEW_ID */.UU));},[location.search,navigate]);const navigateToView=(0,react.useCallback)(viewId=>{navigate((0,menuRoutes/* createSearchWithView */._M)(location.search,viewId));},[location.search,navigate]);(0,react.useEffect)(()=>{if(isCompact){setIsSidebarOpen(false);}},[isCompact]);(0,react.useEffect)(()=>{if(isCompact){setIsSidebarOpen(false);}},[activeSubMenuItem,isCompact]);const handleSubMenuChange=(0,react.useCallback)(tabId=>{const menuId=tabId;(0,react_dom.flushSync)(()=>setPendingMenuId(menuId));navigateToMenu(menuId);if(isCompact){setIsSidebarOpen(false);}},[isCompact,navigateToMenu]);const{user,darkMode}=(0,react.useContext)(provider/* appContext */.v);const rightPanelTab=(0,store_rightPanel/* useRightPanelStore */.x)(s=>s.layoutTab);const{0:showAdminNav,1:setShowAdminNav}=(0,react.useState)(false);const deferAfterPaint=(0,react.useCallback)(fn=>{if(typeof window.requestIdleCallback==="function"){const id=window.requestIdleCallback(fn,{timeout:2500});return()=>window.cancelIdleCallback(id);}const id=window.setTimeout(fn,1);return()=>window.clearTimeout(id);},[]);(0,react.useEffect)(()=>{let cancelled=false;const uid=user===null||user===void 0?void 0:user.email;if(!uid){setShowAdminNav(false);return()=>{cancelled=true;};}const cancelDefer=deferAfterPaint(()=>{api/* userAPI */.Eo.getAccess(uid).then(a=>{if(!cancelled)setShowAdminNav(Boolean(a===null||a===void 0?void 0:a.is_platform_admin));}).catch(()=>{if(!cancelled)setShowAdminNav(false);});});return()=>{cancelled=true;cancelDefer();};},[user===null||user===void 0?void 0:user.email,deferAfterPaint]);const formatFileSize=(0,react.useCallback)(size=>{if(typeof size!=="number"||!Number.isFinite(size)||size<=0)return"-";if(size<1024)return size+" B";if(size<1024*1024)return(size/1024).toFixed(1)+" KB";return(size/(1024*1024)).toFixed(1)+" MB";},[]);const buildDownloadHref=(0,react.useCallback)(file=>{if(file.download_method==="url"&&file.url)return file.url;if(file.download_method==="base64"&&file.base64_content){const mime=file.mime_type||"application/octet-stream";return"data:"+mime+";base64,"+file.base64_content;}return null;},[]);const handleFileEventsChange=(0,react.useCallback)((sessionId,fileEvents)=>{setSessionFileEvents(prev=>{const current=prev[sessionId]||[];if(current===fileEvents)return prev;return Object.assign({},prev,{[sessionId]:fileEvents});});},[]);const{session,setSession,setSessions}=(0,store/* useConfigStore */.J)();const{selectedAgent,setSelectedAgent,setConfig,setAgentId,setMode,agentId}=(0,modeConfig/* useModeConfigStore */.Q)();const{saveSessionId}=useSessionStorage();const{config:settingsConfig,updateConfig:updateSettingsConfig}=(0,components_store/* useSettingsStore */.C)();// Session management
const{sessions,isLoading:isSessionLoading,sessionRunStatuses,pendingFirstMessage,fetchSessions,selectSession,createNewChatSession,updateSession,updateSessionName,deleteSession,clearCurrentSession,updateSessionRunStatus,setPendingFirstMessage}=useSessionManager({userEmail:user===null||user===void 0?void 0:user.email,onSuccess:msg=>messageApi.success(msg),onError:msg=>messageApi.error(msg)});const handleClearCurrentSession=(0,react.useCallback)(()=>{setSampleTasksDismissed(false);clearCurrentSession();},[clearCurrentSession]);// WebSocket management
const{getSessionSocket,closeSocket,stopSession}=useWebSocketManager();// Agent management
const{agents,fetchAgentList,deleteAgent,agentCatalogLoaded,catalogRefreshing,catalogLoadingHint,platformAgentPolicy}=(0,useAgentManager/* useAgentManager */.A)(user===null||user===void 0?void 0:user.email);const{agentInfo}=(0,useAgentInfo/* useAgentInfo */.B)(user===null||user===void 0?void 0:user.email);// 延后拉配置，避免登入后占满主线程导致菜单点击无响应
(0,react.useEffect)(()=>{if(!(user!==null&&user!==void 0&&user.email))return;return deferAfterPaint(()=>{void(async()=>{try{const settings=await api/* settingsAPI */.YP.getSettings(user.email);const _ref=settings,settingsForStore=(0,objectWithoutPropertiesLoose/* default */.A)(_ref,_excluded);updateSettingsConfig(settingsForStore);if(settings.model_configs){try{var _parsed$model_config,_parsed$model_config$;const parsed=(0,browser.parse)(settings.model_configs);const baseUrl=(_parsed$model_config=parsed.model_config)===null||_parsed$model_config===void 0?void 0:(_parsed$model_config$=_parsed$model_config.config)===null||_parsed$model_config$===void 0?void 0:_parsed$model_config$.base_url;if(baseUrl)setBaseUrl(baseUrl);}catch(parseError){console.warn("Failed to parse model_configs for baseUrl:",parseError);}}}catch(error){console.error("Failed to load settings:",error);}})();});},[user===null||user===void 0?void 0:user.email,updateSettingsConfig,deferAfterPaint]);(0,react.useEffect)(()=>{if(!(user!==null&&user!==void 0&&user.email))return;return deferAfterPaint(()=>{const run=()=>fetchAgentList();if(modeConfig/* useModeConfigStore */.Q.persist.hasHydrated()){run();return;}modeConfig/* useModeConfigStore */.Q.persist.onFinishHydration(run);});},[user===null||user===void 0?void 0:user.email,fetchAgentList,deferAfterPaint]);(0,react.useEffect)(()=>{const handleAgentListChanged=()=>{fetchAgentList();};window.addEventListener("agentListChanged",handleAgentListChanged);return()=>{window.removeEventListener("agentListChanged",handleAgentListChanged);};},[fetchAgentList]);(0,react.useEffect)(()=>{if(!(user!==null&&user!==void 0&&user.email))return;return deferAfterPaint(()=>{fetchSessions();});},[user===null||user===void 0?void 0:user.email,fetchSessions,deferAfterPaint]);// 库 → 聊天 时把文件放在 state 里传给 NewChatView；不要用短时定时器清空，否则智能体信息未加载完时
// NewChatView 尚未挂载，prefill 已被清空，输入框收不到附件。
(0,react.useEffect)(()=>{if(activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.currentSession)return;if(!libraryAttachPrefill)return;setLibraryAttachPrefill(null);},[activeSubMenuItem,libraryAttachPrefill]);// Handle agent click
const handleAgentClick=(0,react.useCallback)(async agent=>{if(!(user!==null&&user!==void 0&&user.email))return;// 更新 agentId（在函数开始时就设置，确保及时触发 useAgentInfo）
if(agent.id){setAgentId(agent.id);}else{setAgentId(null);}setMode(agent.mode||"");// 对于 type === "add" 的自定义智能体，使用 id 或 name 来判断是否为不同智能体
// 对于非自定义智能体，使用 mode 来判断
const isDifferentAgent=agent.type==="add"?(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.id)!==agent.id&&(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.name)!==agent.name:(selectedAgent===null||selectedAgent===void 0?void 0:selectedAgent.mode)!==agent.mode;if(isDifferentAgent){handleClearCurrentSession();}navigateToMenu(menuRoutes/* MENU_IDS */.h7.currentSession);},[user===null||user===void 0?void 0:user.email,selectedAgent,handleClearCurrentSession,setAgentId,setMode]);// Handle edit session
const handleEditSession=(0,react.useCallback)(async sessionData=>{navigateToMenu(menuRoutes/* MENU_IDS */.h7.currentSession);if(sessionData){setEditingSession(sessionData);setIsEditorOpen(true);}else{// 不创建新会话，只是清空当前会话
// 保持当前选中的 agent 不变
// 会话将在用户发送第一条消息时创建
handleClearCurrentSession();}},[handleClearCurrentSession]);// Handle save session
const handleSaveSession=(0,react.useCallback)(async sessionData=>{await updateSession(sessionData);setIsEditorOpen(false);setEditingSession(undefined);},[updateSession]);// Handle delete session
const handleDeleteSession=(0,react.useCallback)(async sessionId=>{const isDeletingCurrentSession=(session===null||session===void 0?void 0:session.id)===sessionId;await deleteSession(sessionId,closeSocket);// 如果删除的是当前会话，确保显示 NewChatView
if(isDeletingCurrentSession){navigateToMenu(menuRoutes/* MENU_IDS */.h7.currentSession);}},[deleteSession,closeSocket,session===null||session===void 0?void 0:session.id]);const handleCopyShareLink=(0,react.useCallback)(async sessionId=>{if(!(user!==null&&user!==void 0&&user.email)){messageApi.error("请先登录");return;}try{const{share_token}=await api/* sessionAPI */.jT.setSessionShare(sessionId,user.email,true);const url=api/* sessionAPI */.jT.buildShareUrl(share_token);await navigator.clipboard.writeText(url);messageApi.success("分享链接已复制，访客可只读查看");}catch(e){messageApi.error(e instanceof Error?e.message:"生成分享链接失败");}},[user===null||user===void 0?void 0:user.email,messageApi]);// Handle delete agent
const handleDeleteAgent=(0,react.useCallback)(async id=>{await deleteAgent(id,()=>messageApi.success("Agent deleted successfully"),()=>messageApi.error("Failed to delete agent"));},[deleteAgent,messageApi]);// Handle stop session
const handleStopSession=(0,react.useCallback)(sessionId=>{if(sessionId===undefined||sessionId===null)return;stopSession(sessionId);updateSessionRunStatus(sessionId,"stopped");},[stopSession,updateSessionRunStatus]);// Handle create session from plan
const handleCreateSessionFromPlan=(0,react.useCallback)((sessionId,planData)=>{selectSession({id:sessionId});setTimeout(()=>{window.dispatchEvent(new CustomEvent("planReady",{detail:{planData:planData,sessionId:sessionId,messageId:"plan_"+Date.now()}}));},2000);},[selectSession]);// Handle selecting a session from sidebar / plan list:
// always switch back to "current_session" view so the chat is visible.
const handleSelectSession=(0,react.useCallback)(async selectedSession=>{if(historyScrollRef.current){historyScrollTopRef.current=historyScrollRef.current.scrollTop;}navigateToMenu(menuRoutes/* MENU_IDS */.h7.currentSession);selectSession(selectedSession);},[selectSession]);const setHistoryScrollContainer=(0,react.useCallback)(el=>{historyScrollRef.current=el;if(el){el.scrollTop=historyScrollTopRef.current;}},[]);(0,react.useLayoutEffect)(()=>{if(rightPanelTab!=="history")return;const el=historyScrollRef.current;if(!el)return;el.scrollTop=historyScrollTopRef.current;},[rightPanelTab,session===null||session===void 0?void 0:session.id,sessions]);// Listen for switchToCurrentSession event
(0,react.useEffect)(()=>{const handleSwitchToCurrentSession=async event=>{const{agent,newSession,config,clearSession}=event.detail||{};navigateToMenu(menuRoutes/* MENU_IDS */.h7.currentSession);if(agent){setSelectedAgent(agent);}if(config){setConfig(config);}if(clearSession){handleClearCurrentSession();return;}if(newSession){try{const currentSessions=Array.isArray(sessions)?sessions:[];setSessions([newSession].concat((0,toConsumableArray/* default */.A)(currentSessions)));setSession(newSession);window.history.pushState({},"","?sessionId="+newSession.id);saveSessionId(newSession.id);}catch(error){console.error("Error setting new session:",error);}}};window.addEventListener("switchToCurrentSession",handleSwitchToCurrentSession);return()=>{window.removeEventListener("switchToCurrentSession",handleSwitchToCurrentSession);};},[setSelectedAgent,sessions,setSessions,setSession,saveSessionId,setConfig,handleClearCurrentSession]);// Listen for sessionDeleted event and ensure NewChatView is shown
(0,react.useEffect)(()=>{const handleSessionDeleted=()=>{navigateToMenu(menuRoutes/* MENU_IDS */.h7.currentSession);};window.addEventListener("sessionDeleted",handleSessionDeleted);return()=>{window.removeEventListener("sessionDeleted",handleSessionDeleted);};},[]);// Ensure NewChatView is shown when session becomes null
(0,react.useEffect)(()=>{// Only enforce the chat menu when the user is already on chat.
// Otherwise (e.g. agent_management), keep the current menu on refresh.
if(activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.currentSession&&!session&&selectedAgent&&selectedAgent.name){navigateToMenu(menuRoutes/* MENU_IDS */.h7.currentSession);}},[activeSubMenuItem,session,selectedAgent,navigateToMenu]);// Chat views
const chatViews=(0,react.useMemo)(()=>{if(!Array.isArray(sessions)||!session){return[];}return sessions.map(s=>{if(!s.id)return null;// Always render ChatView for all sessions to preserve streamed messages when switching.
// Non-current sessions are hidden via CSS (className="hidden").
return/*#__PURE__*/react.createElement("div",{key:s.id,className:((session===null||session===void 0?void 0:session.id)===s.id?"block":"hidden")+" relative h-full min-h-0"},/*#__PURE__*/react.createElement(chat["default"],{session:s,onSessionNameChange:updateSessionName,getSessionSocket:getSessionSocket,visible:(session===null||session===void 0?void 0:session.id)===s.id,onRunStatusChange:updateSessionRunStatus,pendingFirstMessage:(session===null||session===void 0?void 0:session.id)===s.id?pendingFirstMessage:null,onPendingMessageSent:()=>setPendingFirstMessage(null),suppressSampleTasks:(session===null||session===void 0?void 0:session.id)===s.id&&(sampleTasksDismissed||!!pendingFirstMessage),libraryServerFilesPrefill:(session===null||session===void 0?void 0:session.id)===s.id?libraryAttachPrefill:null,onFileEventsChange:handleFileEventsChange}));});},[sessions,session,updateSessionName,getSessionSocket,updateSessionRunStatus,pendingFirstMessage,sampleTasksDismissed,libraryAttachPrefill,handleFileEventsChange]);const rightPanelFiles=(0,react.useMemo)(()=>{const currentSessionId=session===null||session===void 0?void 0:session.id;if(!currentSessionId)return null;const events=sessionFileEvents[currentSessionId]||[];/** 与 apiDatetime 一致：数值很大视为毫秒，否则视为秒 */const filesEventTimeMs=event=>{var _event$send_time_stam,_event$content;const raw=(_event$send_time_stam=event.send_time_stamp)!==null&&_event$send_time_stam!==void 0?_event$send_time_stam:(_event$content=event.content)===null||_event$content===void 0?void 0:_event$content.send_time_stamp;if(raw==null)return 0;const n=typeof raw==="number"?raw:Number(raw);if(!Number.isFinite(n))return 0;return n>1e12?n:n*1000;};const isJsonFile=file=>{const name=(file.name||"").trim().toLowerCase();if(name.endsWith(".json"))return true;const mime=(file.mime_type||"").trim().toLowerCase();return mime==="application/json"||mime==="text/json";};const fileRows=events.flatMap(event=>{var _event$content2;const timeMs=filesEventTimeMs(event);const list=((_event$content2=event.content)===null||_event$content2===void 0?void 0:_event$content2.files)||[];return list.filter(file=>!isJsonFile(file)).map(file=>({file,timeMs}));}).sort((a,b)=>b.timeMs-a.timeMs);if(fileRows.length===0)return null;return/*#__PURE__*/react.createElement("div",{className:"h-full overflow-y-auto p-3 space-y-2"},fileRows.map((_ref2,index)=>{let{file,timeMs}=_ref2;const href=buildDownloadHref(file);return/*#__PURE__*/react.createElement("div",{key:file.name+"-"+index,className:"rounded-lg border border-border-primary/30 bg-tertiary/10 p-3"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{setSelectedPreviewFile(file);navigateToView("file_preview");},className:"text-sm font-medium text-primary break-all text-left hover:text-accent transition-colors",title:"\u70B9\u51FB\u9884\u89C8\u5E76\u7F16\u8F91"},file.name||"file-"+(index+1)),/*#__PURE__*/react.createElement("div",{className:"mt-1 text-xs text-secondary"},timeMs>0?(0,apiDatetime/* formatUnixForDisplayZhCN */.KW)(timeMs):"—","  \xB7 ",formatFileSize(file.size)),href&&isImageMessageFile(file)?/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{setSelectedPreviewFile(file);navigateToView("file_preview");},className:"mt-3 w-full h-20 flex items-center justify-center rounded-md overflow-hidden border border-border-primary/25 bg-tertiary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",title:"\u70B9\u51FB\u67E5\u770B\u5B8C\u6574\u9884\u89C8"},/*#__PURE__*/react.createElement("img",{src:href,alt:file.name||"图片预览",className:"max-h-full max-w-full object-contain",loading:"lazy"})):null,/*#__PURE__*/react.createElement("div",{className:"mt-2 flex items-center gap-2"},/*#__PURE__*/react.createElement("button",{type:"button",onClick:()=>{setSelectedPreviewFile(file);navigateToView("file_preview");},className:"inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium bg-tertiary/20 text-primary hover:bg-tertiary/30 transition-colors"},"\u9884\u89C8/\u7F16\u8F91"),href?/*#__PURE__*/react.createElement("a",{href:href,download:file.name||"file-"+(index+1),target:file.download_method==="url"?"_blank":undefined,rel:file.download_method==="url"?"noreferrer":undefined,className:"inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"},"\u4E0B\u8F7D\u6587\u4EF6"):/*#__PURE__*/react.createElement("span",{className:"text-xs text-secondary"},"\u6682\u65E0\u53EF\u7528\u4E0B\u8F7D\u94FE\u63A5")));}));},[session===null||session===void 0?void 0:session.id,sessionFileEvents,buildDownloadHref,formatFileSize,navigateToView]);const rightPanelHistory=(0,react.useMemo)(()=>{const sortedSessions=Array.isArray(sessions)?(0,toConsumableArray/* default */.A)(sessions).sort((a,b)=>(0,apiDatetime/* apiDatetimeToUtcMs */.R3)(b.updated_at||b.created_at)-(0,apiDatetime/* apiDatetimeToUtcMs */.R3)(a.updated_at||a.created_at)):[];if(sortedSessions.length===0){return null;}const q=historySearchQuery.trim().toLowerCase();const filteredSessions=q?sortedSessions.filter(s=>{const name=(s.name||"").toLowerCase();const idStr=s.id!=null?String(s.id):"";return name.includes(q)||idStr.includes(q);}):sortedSessions;const inputRing=darkMode==="dark"?"border-border-primary/40 bg-white/[0.04] text-primary placeholder:text-secondary/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/30":"border-gray-200/90 bg-white text-gray-900 placeholder:text-gray-400 focus:border-violet-400 focus:ring-1 focus:ring-violet-200";return/*#__PURE__*/react.createElement("div",{className:"h-full flex flex-col min-h-0"},/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 px-3 pt-3 pb-2"},/*#__PURE__*/react.createElement("label",{className:"sr-only",htmlFor:"history-session-search"},"\u641C\u7D22\u4F1A\u8BDD"),/*#__PURE__*/react.createElement("div",{className:"relative"},/*#__PURE__*/react.createElement(search/* default */.A,{className:"absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none","aria-hidden":true}),/*#__PURE__*/react.createElement("input",{id:"history-session-search",type:"search",value:historySearchQuery,onChange:e=>setHistorySearchQuery(e.target.value),placeholder:"\u641C\u7D22\u4F1A\u8BDD\u540D\u79F0\u6216 ID\u2026",autoComplete:"off",className:"w-full rounded-lg pl-9 pr-3 py-2 text-sm border outline-none transition-shadow "+inputRing}))),/*#__PURE__*/react.createElement("div",{ref:setHistoryScrollContainer,onScroll:e=>{historyScrollTopRef.current=e.currentTarget.scrollTop;},className:"flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1"},filteredSessions.length===0?/*#__PURE__*/react.createElement("div",{className:"text-center text-sm text-secondary py-8 px-2"},"\u65E0\u5339\u914D\u4F1A\u8BDD\uFF0C\u8BF7\u8C03\u6574\u5173\u952E\u8BCD"):filteredSessions.map(historySession=>{const isCurrent=(session===null||session===void 0?void 0:session.id)===historySession.id;const lastTime=historySession.updated_at||historySession.created_at;const sid=historySession.id;return/*#__PURE__*/react.createElement("div",{key:sid!==null&&sid!==void 0?sid:historySession.name,className:"group relative flex items-center gap-0.5 rounded-lg transition-colors "+(isCurrent?"bg-accent/10":"hover:bg-tertiary/15")},/*#__PURE__*/react.createElement("button",{type:"button",onMouseDown:e=>e.preventDefault(),onClick:()=>void handleSelectSession(historySession),className:"flex-1 min-w-0 text-left rounded-lg px-3 py-2 pr-1 transition-colors "+(isCurrent?"text-accent":"text-primary")},/*#__PURE__*/react.createElement("div",{className:"text-sm font-medium truncate"},historySession.name||"Session "+(sid!==null&&sid!==void 0?sid:"")),/*#__PURE__*/react.createElement("div",{className:"text-xs text-secondary mt-1"},lastTime?(0,apiDatetime/* formatApiDateTimeZhCN */.U7)(lastTime):"-")),sid!=null&&/*#__PURE__*/react.createElement("div",{className:"flex-shrink-0 pr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150"},/*#__PURE__*/react.createElement(dropdown/* default */.A,{trigger:["click"],placement:"bottomRight",menu:{items:[{key:"share",disabled:isSessionLoading,label:/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(Share2,{className:"w-4 h-4 inline-block mr-1.5 -mt-0.5 align-middle"}),"\u5206\u4EAB"),onClick:e=>{e.domEvent.stopPropagation();void handleCopyShareLink(sid);}},{key:"delete",danger:true,disabled:isSessionLoading,label:/*#__PURE__*/react.createElement(react.Fragment,null,/*#__PURE__*/react.createElement(trash_2/* default */.A,{className:"w-4 h-4 inline-block mr-1.5 -mt-0.5 align-middle"}),"\u5220\u9664"),onClick:e=>{e.domEvent.stopPropagation();void handleDeleteSession(sid);}}]}},/*#__PURE__*/react.createElement("button",{type:"button",title:"\u66F4\u591A","aria-haspopup":"menu","aria-label":"\u4F1A\u8BDD\u64CD\u4F5C",disabled:isSessionLoading,onClick:e=>e.stopPropagation(),onPointerDown:e=>e.stopPropagation(),className:"flex items-center justify-center w-7 h-7 rounded-lg outline-none border-0 bg-transparent shadow-none ring-0 transition-colors "+(isSessionLoading?"opacity-40 cursor-not-allowed":"text-secondary hover:text-primary hover:bg-tertiary/30")},/*#__PURE__*/react.createElement(EllipsisVertical,{className:"w-3.5 h-3.5",strokeWidth:2})))));})));},[sessions,session===null||session===void 0?void 0:session.id,handleSelectSession,historySearchQuery,darkMode,isSessionLoading,handleDeleteSession,handleCopyShareLink]);return/*#__PURE__*/react.createElement(react.Fragment,null,contextHolder,/*#__PURE__*/react.createElement(layout_AppLayout// TopNav
,{isSidebarOpen:isSidebarOpen,onToggleSidebar:()=>setIsSidebarOpen(!isSidebarOpen)// LeftMenu
,activeSubMenuItem:activeSubMenuItem,activeMenuLabel:activeMenuLabel,onSubMenuChange:handleSubMenuChange,showAdminNav:showAdminNav,canvasActiveView:activeCanvasView,onCanvasViewChange:navigateToView,canvasFilePreviewContent:/*#__PURE__*/react.createElement(FilePreviewPage["default"],{file:selectedPreviewFile,sessionId:(_session$id=session===null||session===void 0?void 0:session.id)!==null&&_session$id!==void 0?_session$id:null,onFileEvent:evt=>{const sid=session===null||session===void 0?void 0:session.id;if(!sid)return;setSessionFileEvents(prev=>Object.assign({},prev,{[sid]:[].concat((0,toConsumableArray/* default */.A)(prev[sid]||[]),[evt])}));}}),rightPanelHistory:rightPanelHistory,rightPanelFiles:rightPanelFiles,onRightPanelTabChange:tab=>{if(tab==="files"){// Keep the current canvas view when only switching to the file-space tab.
// The canvas should switch to file preview only after selecting a specific file.
return;}navigateToView("chat");},onNewSession:()=>{navigateToMenu(menuRoutes/* MENU_IDS */.h7.currentSession);navigateToView("chat");handleClearCurrentSession();},showNewSessionButton:Boolean(session)},activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.currentSession?(()=>{if(session){return/*#__PURE__*/react.createElement("div",{className:"h-full min-h-0"},chatViews);}else if(agentInfo||selectedAgent){const chatAgent=agentInfo||selectedAgent;return/*#__PURE__*/react.createElement(NewChatView["default"],{agent:chatAgent,serverFilesPrefill:libraryAttachPrefill,suppressSampleTasks:sampleTasksDismissed,onDismissSampleTasks:()=>setSampleTasksDismissed(true),onSubmit:async(agent,query,files,plan)=>{setSampleTasksDismissed(true);await createNewChatSession(agent,query,files,plan);}});}else if(!(user!==null&&user!==void 0&&user.email)){return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement(spin/* default */.A,{size:"large"}),/*#__PURE__*/react.createElement("p",{className:"mt-4 text-sm"},"\u52A0\u8F7D\u4E2D\u2026")));}else if(!agentCatalogLoaded||agentId&&!agentInfo&&!selectedAgent){return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center px-6 max-w-md"},/*#__PURE__*/react.createElement(spin/* default */.A,{size:"large"}),/*#__PURE__*/react.createElement("p",{key:catalogRefreshing?catalogLoadingHint:"loading",className:"mt-4 text-sm transition-opacity duration-300"},catalogRefreshing&&catalogLoadingHint?catalogLoadingHint:"加载中…")));}else if(agents.length===0){return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary px-6"},/*#__PURE__*/react.createElement("div",{className:"text-center max-w-md"},/*#__PURE__*/react.createElement("p",{className:"text-base text-primary font-medium"},"\u6682\u65E0\u53EF\u7528\u667A\u80FD\u4F53"),/*#__PURE__*/react.createElement("p",{className:"mt-2 text-sm"},"\u8BF7\u7A0D\u540E\u518D\u8BD5\u6216\u8054\u7CFB\u7BA1\u7406\u5458\u4E3A\u4F60\u5F00\u901A\u6743\u9650\u3002")));}return/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary px-6"},/*#__PURE__*/react.createElement("div",{className:"text-center max-w-md space-y-4"},/*#__PURE__*/react.createElement("p",{className:"text-base text-primary font-medium"},"\u5148\u9009\u4E00\u4E2A\u667A\u80FD\u4F53\u518D\u5F00\u59CB\u5BF9\u8BDD"),/*#__PURE__*/react.createElement("p",{className:"text-sm"},(platformAgentPolicy===null||platformAgentPolicy===void 0?void 0:platformAgentPolicy.auto_load_default_agent)===false?"你还没有选择聊天要用的智能体。请到智能体广场挑选一个开始试用。":"你还没有选择聊天要用的智能体。请到智能体广场挑选，或设置你的默认智能体。"),/*#__PURE__*/react.createElement(es_button/* default */.Ay,{type:"primary",size:"large",onClick:()=>navigateToMenu(menuRoutes/* MENU_IDS */.h7.agentSquare)},"\u524D\u5F80\u667A\u80FD\u4F53\u5E7F\u573A")));})():activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.agentSquare||activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.myAgents?/*#__PURE__*/react.createElement("div",{className:"h-full overflow-hidden"},/*#__PURE__*/react.createElement(react.Suspense,{fallback:/*#__PURE__*/react.createElement(MenuPanelFallback,null)},/*#__PURE__*/react.createElement(AgentSquare,{agents:[],handleAgentList:fetchAgentList}))):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.skillsSquare?/*#__PURE__*/react.createElement(react.Suspense,{fallback:/*#__PURE__*/react.createElement(MenuPanelFallback,null)},/*#__PURE__*/react.createElement(SkillsSquarePage,null)):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.channels?/*#__PURE__*/react.createElement(ChannelsPage["default"],null):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.logs?/*#__PURE__*/react.createElement(LogsPage["default"],null):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.agentManagement?/*#__PURE__*/react.createElement(AgentManagementPage["default"],null):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.userManagement?/*#__PURE__*/react.createElement(UserManagementPage["default"],null):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.usageAnalytics?/*#__PURE__*/react.createElement(react.Suspense,{fallback:/*#__PURE__*/react.createElement(MenuPanelFallback,null)},/*#__PURE__*/react.createElement(UsageAnalyticsPage,null)):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.profile?/*#__PURE__*/react.createElement(Config["default"],null):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.savedPlan?/*#__PURE__*/react.createElement("div",{className:"h-full overflow-hidden"},/*#__PURE__*/react.createElement(Plans_PlanList,{onTabChange:tabId=>navigateToMenu(tabId),onSelectSession:handleSelectSession,onCreateSessionFromPlan:handleCreateSessionFromPlan})):activeSubMenuItem===menuRoutes/* MENU_IDS */.h7.library?/*#__PURE__*/react.createElement("div",{className:"h-full min-h-0 overflow-hidden"},/*#__PURE__*/react.createElement(react.Suspense,{fallback:/*#__PURE__*/react.createElement(MenuPanelFallback,null)},/*#__PURE__*/react.createElement(LibraryPage,{onStartChat:async(files,query)=>{const chatAgent=agentInfo||selectedAgent;if(!chatAgent)return;// 把文件放进 prefill 以便 ChatView 回显（不重新上传）
(0,react_dom.flushSync)(()=>setLibraryAttachPrefill(files));// 直接创建会话并发送首条消息，跳过 NewChatView
await createNewChatSession(chatAgent,query,files);// Use live URL after clearCurrentSession so sessionId is not re-applied from stale React location
const withMenu=(0,menuRoutes/* createSearchWithMenu */.gK)(window.location.search,menuRoutes/* MENU_IDS */.h7.currentSession);navigate((0,menuRoutes/* createSearchWithView */._M)(withMenu,"chat"));}}))):/*#__PURE__*/react.createElement("div",{className:"flex items-center justify-center h-full text-secondary"},/*#__PURE__*/react.createElement("div",{className:"text-center"},/*#__PURE__*/react.createElement("p",{className:"text-sm opacity-50"},"\u656C\u8BF7\u671F\u5F85"))),/*#__PURE__*/react.createElement(SessionEditor,{session:editingSession,isOpen:isEditorOpen,onSave:handleSaveSession,onCancel:()=>{setIsEditorOpen(false);setEditingSession(undefined);}})));};
;// ./src/pages/index.tsx


const IndexPage = () => {
  return /*#__PURE__*/react.createElement(SessionManager, null);
};
const query = "2538745103";
/* harmony default export */ var pages = (IndexPage);

/***/ }),

/***/ 70612:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

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

/***/ 98445:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Search; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Search = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
]);


//# sourceMappingURL=search.js.map


/***/ })

}]);
//# sourceMappingURL=component---src-pages-index-tsx-de6bcfca56bacfb4c903.js.map