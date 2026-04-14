"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[8990],{

/***/ 45062:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ es; }
});

// UNUSED EXPORTS: inlineMock

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/react-dom/index.js
var react_dom = __webpack_require__(40961);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/canUseDom.js
var canUseDom = __webpack_require__(20998);
// EXTERNAL MODULE: ./node_modules/rc-util/es/warning.js
var warning = __webpack_require__(68210);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var es_ref = __webpack_require__(8719);
;// ./node_modules/@rc-component/portal/es/Context.js

var OrderContext = /*#__PURE__*/react.createContext(null);
/* harmony default export */ var Context = (OrderContext);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useLayoutEffect.js
var useLayoutEffect = __webpack_require__(30981);
;// ./node_modules/@rc-component/portal/es/useDom.js






var EMPTY_LIST = [];

/**
 * Will add `div` to document. Nest call will keep order
 * @param render Render DOM in document
 */
function useDom(render, debug) {
  var _React$useState = react.useState(function () {
      if (!(0,canUseDom/* default */.A)()) {
        return null;
      }
      var defaultEle = document.createElement('div');
      if (false) {}
      return defaultEle;
    }),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 1),
    ele = _React$useState2[0];

  // ========================== Order ==========================
  var appendedRef = react.useRef(false);
  var queueCreate = react.useContext(Context);
  var _React$useState3 = react.useState(EMPTY_LIST),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    queue = _React$useState4[0],
    setQueue = _React$useState4[1];
  var mergedQueueCreate = queueCreate || (appendedRef.current ? undefined : function (appendFn) {
    setQueue(function (origin) {
      var newQueue = [appendFn].concat((0,toConsumableArray/* default */.A)(origin));
      return newQueue;
    });
  });

  // =========================== DOM ===========================
  function append() {
    if (!ele.parentElement) {
      document.body.appendChild(ele);
    }
    appendedRef.current = true;
  }
  function cleanup() {
    var _ele$parentElement;
    (_ele$parentElement = ele.parentElement) === null || _ele$parentElement === void 0 ? void 0 : _ele$parentElement.removeChild(ele);
    appendedRef.current = false;
  }
  (0,useLayoutEffect/* default */.A)(function () {
    if (render) {
      if (queueCreate) {
        queueCreate(append);
      } else {
        append();
      }
    } else {
      cleanup();
    }
    return cleanup;
  }, [render]);
  (0,useLayoutEffect/* default */.A)(function () {
    if (queue.length) {
      queue.forEach(function (appendFn) {
        return appendFn();
      });
      setQueue(EMPTY_LIST);
    }
  }, [queue]);
  return [ele, mergedQueueCreate];
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/dynamicCSS.js
var dynamicCSS = __webpack_require__(85089);
// EXTERNAL MODULE: ./node_modules/rc-util/es/getScrollBarSize.js
var getScrollBarSize = __webpack_require__(82987);
;// ./node_modules/@rc-component/portal/es/util.js
/**
 * Test usage export. Do not use in your production
 */
function isBodyOverflowing() {
  return document.body.scrollHeight > (window.innerHeight || document.documentElement.clientHeight) && window.innerWidth > document.body.offsetWidth;
}
;// ./node_modules/@rc-component/portal/es/useScrollLocker.js






var UNIQUE_ID = "rc-util-locker-".concat(Date.now());
var uuid = 0;
function useScrollLocker(lock) {
  var mergedLock = !!lock;
  var _React$useState = react.useState(function () {
      uuid += 1;
      return "".concat(UNIQUE_ID, "_").concat(uuid);
    }),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 1),
    id = _React$useState2[0];
  (0,useLayoutEffect/* default */.A)(function () {
    if (mergedLock) {
      var scrollbarSize = (0,getScrollBarSize/* getTargetScrollBarSize */.V)(document.body).width;
      var isOverflow = isBodyOverflowing();
      (0,dynamicCSS/* updateCSS */.BD)("\nhtml body {\n  overflow-y: hidden;\n  ".concat(isOverflow ? "width: calc(100% - ".concat(scrollbarSize, "px);") : '', "\n}"), id);
    } else {
      (0,dynamicCSS/* removeCSS */.m6)(id);
    }
    return function () {
      (0,dynamicCSS/* removeCSS */.m6)(id);
    };
  }, [mergedLock, id]);
}
;// ./node_modules/@rc-component/portal/es/mock.js
var inline = false;
function inlineMock(nextInline) {
  if (typeof nextInline === 'boolean') {
    inline = nextInline;
  }
  return inline;
}
;// ./node_modules/@rc-component/portal/es/Portal.js










var getPortalContainer = function getPortalContainer(getContainer) {
  if (getContainer === false) {
    return false;
  }
  if (!(0,canUseDom/* default */.A)() || !getContainer) {
    return null;
  }
  if (typeof getContainer === 'string') {
    return document.querySelector(getContainer);
  }
  if (typeof getContainer === 'function') {
    return getContainer();
  }
  return getContainer;
};
var Portal = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var open = props.open,
    autoLock = props.autoLock,
    getContainer = props.getContainer,
    debug = props.debug,
    _props$autoDestroy = props.autoDestroy,
    autoDestroy = _props$autoDestroy === void 0 ? true : _props$autoDestroy,
    children = props.children;
  var _React$useState = react.useState(open),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    shouldRender = _React$useState2[0],
    setShouldRender = _React$useState2[1];
  var mergedRender = shouldRender || open;

  // ========================= Warning =========================
  if (false) {}

  // ====================== Should Render ======================
  react.useEffect(function () {
    if (autoDestroy || open) {
      setShouldRender(open);
    }
  }, [open, autoDestroy]);

  // ======================== Container ========================
  var _React$useState3 = react.useState(function () {
      return getPortalContainer(getContainer);
    }),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    innerContainer = _React$useState4[0],
    setInnerContainer = _React$useState4[1];
  react.useEffect(function () {
    var customizeContainer = getPortalContainer(getContainer);

    // Tell component that we check this in effect which is safe to be `null`
    setInnerContainer(customizeContainer !== null && customizeContainer !== void 0 ? customizeContainer : null);
  });
  var _useDom = useDom(mergedRender && !innerContainer, debug),
    _useDom2 = (0,slicedToArray/* default */.A)(_useDom, 2),
    defaultContainer = _useDom2[0],
    queueCreate = _useDom2[1];
  var mergedContainer = innerContainer !== null && innerContainer !== void 0 ? innerContainer : defaultContainer;

  // ========================= Locker ==========================
  useScrollLocker(autoLock && open && (0,canUseDom/* default */.A)() && (mergedContainer === defaultContainer || mergedContainer === document.body));

  // =========================== Ref ===========================
  var childRef = null;
  if (children && (0,es_ref/* supportRef */.f3)(children) && ref) {
    var _ref = children;
    childRef = _ref.ref;
  }
  var mergedRef = (0,es_ref/* useComposeRef */.xK)(childRef, ref);

  // ========================= Render ==========================
  // Do not render when nothing need render
  // When innerContainer is `undefined`, it may not ready since user use ref in the same render
  if (!mergedRender || !(0,canUseDom/* default */.A)() || innerContainer === undefined) {
    return null;
  }

  // Render inline
  var renderInline = mergedContainer === false || inlineMock();
  var reffedChildren = children;
  if (ref) {
    reffedChildren = /*#__PURE__*/react.cloneElement(children, {
      ref: mergedRef
    });
  }
  return /*#__PURE__*/react.createElement(Context.Provider, {
    value: queueCreate
  }, renderInline ? reffedChildren : /*#__PURE__*/(0,react_dom.createPortal)(reffedChildren, mergedContainer));
});
if (false) {}
/* harmony default export */ var es_Portal = (Portal);
;// ./node_modules/@rc-component/portal/es/index.js



/* harmony default export */ var es = (es_Portal);

/***/ }),

/***/ 53425:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   U: function() { return /* binding */ withPureRenderTheme; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var rc_util_es_hooks_useMergedState__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(12533);
/* harmony import */ var _config_provider__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(20867);
/* harmony import */ var _config_provider__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(62279);
"use client";




function withPureRenderTheme(Component) {
  return props => (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_config_provider__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .Ay, {
    theme: {
      token: {
        motion: false,
        zIndexPopupBase: 0
      }
    }
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Component, Object.assign({}, props))));
}
/* istanbul ignore next */
const genPurePanel = (Component, defaultPrefixCls, getDropdownCls, postProps) => {
  const PurePanel = props => {
    const {
      prefixCls: customizePrefixCls,
      style
    } = props;
    const holderRef = react__WEBPACK_IMPORTED_MODULE_0__.useRef(null);
    const [popupHeight, setPopupHeight] = react__WEBPACK_IMPORTED_MODULE_0__.useState(0);
    const [popupWidth, setPopupWidth] = react__WEBPACK_IMPORTED_MODULE_0__.useState(0);
    const [open, setOpen] = (0,rc_util_es_hooks_useMergedState__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)(false, {
      value: props.open
    });
    const {
      getPrefixCls
    } = react__WEBPACK_IMPORTED_MODULE_0__.useContext(_config_provider__WEBPACK_IMPORTED_MODULE_3__/* .ConfigContext */ .QO);
    const prefixCls = getPrefixCls(defaultPrefixCls || 'select', customizePrefixCls);
    react__WEBPACK_IMPORTED_MODULE_0__.useEffect(() => {
      // We do not care about ssr
      setOpen(true);
      if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(entries => {
          const element = entries[0].target;
          setPopupHeight(element.offsetHeight + 8);
          setPopupWidth(element.offsetWidth);
        });
        const interval = setInterval(() => {
          var _a;
          const dropdownCls = getDropdownCls ? `.${getDropdownCls(prefixCls)}` : `.${prefixCls}-dropdown`;
          const popup = (_a = holderRef.current) === null || _a === void 0 ? void 0 : _a.querySelector(dropdownCls);
          if (popup) {
            clearInterval(interval);
            resizeObserver.observe(popup);
          }
        }, 10);
        return () => {
          clearInterval(interval);
          resizeObserver.disconnect();
        };
      }
    }, []);
    let mergedProps = Object.assign(Object.assign({}, props), {
      style: Object.assign(Object.assign({}, style), {
        margin: 0
      }),
      open,
      visible: open,
      getPopupContainer: () => holderRef.current
    });
    if (postProps) {
      mergedProps = postProps(mergedProps);
    }
    const mergedStyle = {
      paddingBottom: popupHeight,
      position: 'relative',
      minWidth: popupWidth
    };
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      ref: holderRef,
      style: mergedStyle
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Component, Object.assign({}, mergedProps)));
  };
  return withPureRenderTheme(PurePanel);
};
/* harmony default export */ __webpack_exports__.A = (genPurePanel);

/***/ }),

/***/ 23723:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   b: function() { return /* binding */ getTransitionName; }
/* harmony export */ });
/* harmony import */ var _config_provider__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(62279);

// ================== Collapse Motion ==================
const getCollapsedHeight = () => ({
  height: 0,
  opacity: 0
});
const getRealHeight = node => {
  const {
    scrollHeight
  } = node;
  return {
    height: scrollHeight,
    opacity: 1
  };
};
const getCurrentHeight = node => ({
  height: node ? node.offsetHeight : 0
});
const skipOpacityTransition = (_, event) => (event === null || event === void 0 ? void 0 : event.deadline) === true || event.propertyName === 'height';
const initCollapseMotion = function () {
  let rootCls = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : _config_provider__WEBPACK_IMPORTED_MODULE_0__/* .defaultPrefixCls */ .yH;
  return {
    motionName: `${rootCls}-motion-collapse`,
    onAppearStart: getCollapsedHeight,
    onEnterStart: getCollapsedHeight,
    onAppearActive: getRealHeight,
    onEnterActive: getRealHeight,
    onLeaveStart: getCurrentHeight,
    onLeaveActive: getCollapsedHeight,
    onAppearEnd: skipOpacityTransition,
    onEnterEnd: skipOpacityTransition,
    onLeaveEnd: skipOpacityTransition,
    motionDeadline: 500
  };
};
const _SelectPlacements = (/* unused pure expression or super */ null && (['bottomLeft', 'bottomRight', 'topLeft', 'topRight']));
const getTransitionName = (rootPrefixCls, motion, transitionName) => {
  if (transitionName !== undefined) {
    return transitionName;
  }
  return `${rootPrefixCls}-${motion}`;
};

/* harmony default export */ __webpack_exports__.A = (initCollapseMotion);

/***/ }),

/***/ 19155:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _context__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(60685);
/* harmony import */ var _en_US__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(80436);



const useLocale = (componentName, defaultLocale) => {
  const fullLocale = react__WEBPACK_IMPORTED_MODULE_0__.useContext(_context__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A);
  const getLocale = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    var _a;
    const locale = defaultLocale || _en_US__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A[componentName];
    const localeFromContext = (_a = fullLocale === null || fullLocale === void 0 ? void 0 : fullLocale[componentName]) !== null && _a !== void 0 ? _a : {};
    return Object.assign(Object.assign({}, typeof locale === 'function' ? locale() : locale), localeFromContext || {});
  }, [componentName, defaultLocale, fullLocale]);
  const getLocaleCode = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    const localeCode = fullLocale === null || fullLocale === void 0 ? void 0 : fullLocale.locale;
    // Had use LocaleProvide but didn't set locale
    if ((fullLocale === null || fullLocale === void 0 ? void 0 : fullLocale.exist) && !localeCode) {
      return _en_US__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A.locale;
    }
    return localeCode;
  }, [fullLocale]);
  return [getLocale, getLocaleCode];
};
/* harmony default export */ __webpack_exports__.A = (useLocale);

/***/ }),

/***/ 14980:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   b: function() { return /* binding */ initMotion; }
/* harmony export */ });
const initMotionCommon = duration => ({
  animationDuration: duration,
  animationFillMode: 'both'
});
// FIXME: origin less code seems same as initMotionCommon. Maybe we can safe remove
const initMotionCommonLeave = duration => ({
  animationDuration: duration,
  animationFillMode: 'both'
});
const initMotion = function (motionCls, inKeyframes, outKeyframes, duration) {
  let sameLevel = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : false;
  const sameLevelPrefix = sameLevel ? '&' : '';
  return {
    [`
      ${sameLevelPrefix}${motionCls}-enter,
      ${sameLevelPrefix}${motionCls}-appear
    `]: Object.assign(Object.assign({}, initMotionCommon(duration)), {
      animationPlayState: 'paused'
    }),
    [`${sameLevelPrefix}${motionCls}-leave`]: Object.assign(Object.assign({}, initMotionCommonLeave(duration)), {
      animationPlayState: 'paused'
    }),
    [`
      ${sameLevelPrefix}${motionCls}-enter${motionCls}-enter-active,
      ${sameLevelPrefix}${motionCls}-appear${motionCls}-appear-active
    `]: {
      animationName: inKeyframes,
      animationPlayState: 'running'
    },
    [`${sameLevelPrefix}${motionCls}-leave${motionCls}-leave-active`]: {
      animationName: outKeyframes,
      animationPlayState: 'running',
      pointerEvents: 'none'
    }
  };
};

/***/ }),

/***/ 99077:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   aB: function() { return /* binding */ initZoomMotion; },
/* harmony export */   nF: function() { return /* binding */ zoomIn; }
/* harmony export */ });
/* unused harmony exports zoomOut, zoomBigIn, zoomBigOut, zoomUpIn, zoomUpOut, zoomLeftIn, zoomLeftOut, zoomRightIn, zoomRightOut, zoomDownIn, zoomDownOut */
/* harmony import */ var _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(52187);
/* harmony import */ var _motion__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(14980);


const zoomIn = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomIn', {
  '0%': {
    transform: 'scale(0.2)',
    opacity: 0
  },
  '100%': {
    transform: 'scale(1)',
    opacity: 1
  }
});
const zoomOut = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomOut', {
  '0%': {
    transform: 'scale(1)'
  },
  '100%': {
    transform: 'scale(0.2)',
    opacity: 0
  }
});
const zoomBigIn = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomBigIn', {
  '0%': {
    transform: 'scale(0.8)',
    opacity: 0
  },
  '100%': {
    transform: 'scale(1)',
    opacity: 1
  }
});
const zoomBigOut = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomBigOut', {
  '0%': {
    transform: 'scale(1)'
  },
  '100%': {
    transform: 'scale(0.8)',
    opacity: 0
  }
});
const zoomUpIn = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomUpIn', {
  '0%': {
    transform: 'scale(0.8)',
    transformOrigin: '50% 0%',
    opacity: 0
  },
  '100%': {
    transform: 'scale(1)',
    transformOrigin: '50% 0%'
  }
});
const zoomUpOut = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomUpOut', {
  '0%': {
    transform: 'scale(1)',
    transformOrigin: '50% 0%'
  },
  '100%': {
    transform: 'scale(0.8)',
    transformOrigin: '50% 0%',
    opacity: 0
  }
});
const zoomLeftIn = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomLeftIn', {
  '0%': {
    transform: 'scale(0.8)',
    transformOrigin: '0% 50%',
    opacity: 0
  },
  '100%': {
    transform: 'scale(1)',
    transformOrigin: '0% 50%'
  }
});
const zoomLeftOut = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomLeftOut', {
  '0%': {
    transform: 'scale(1)',
    transformOrigin: '0% 50%'
  },
  '100%': {
    transform: 'scale(0.8)',
    transformOrigin: '0% 50%',
    opacity: 0
  }
});
const zoomRightIn = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomRightIn', {
  '0%': {
    transform: 'scale(0.8)',
    transformOrigin: '100% 50%',
    opacity: 0
  },
  '100%': {
    transform: 'scale(1)',
    transformOrigin: '100% 50%'
  }
});
const zoomRightOut = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomRightOut', {
  '0%': {
    transform: 'scale(1)',
    transformOrigin: '100% 50%'
  },
  '100%': {
    transform: 'scale(0.8)',
    transformOrigin: '100% 50%',
    opacity: 0
  }
});
const zoomDownIn = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomDownIn', {
  '0%': {
    transform: 'scale(0.8)',
    transformOrigin: '50% 100%',
    opacity: 0
  },
  '100%': {
    transform: 'scale(1)',
    transformOrigin: '50% 100%'
  }
});
const zoomDownOut = new _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .Keyframes */ .Mo('antZoomDownOut', {
  '0%': {
    transform: 'scale(1)',
    transformOrigin: '50% 100%'
  },
  '100%': {
    transform: 'scale(0.8)',
    transformOrigin: '50% 100%',
    opacity: 0
  }
});
const zoomMotion = {
  zoom: {
    inKeyframes: zoomIn,
    outKeyframes: zoomOut
  },
  'zoom-big': {
    inKeyframes: zoomBigIn,
    outKeyframes: zoomBigOut
  },
  'zoom-big-fast': {
    inKeyframes: zoomBigIn,
    outKeyframes: zoomBigOut
  },
  'zoom-left': {
    inKeyframes: zoomLeftIn,
    outKeyframes: zoomLeftOut
  },
  'zoom-right': {
    inKeyframes: zoomRightIn,
    outKeyframes: zoomRightOut
  },
  'zoom-up': {
    inKeyframes: zoomUpIn,
    outKeyframes: zoomUpOut
  },
  'zoom-down': {
    inKeyframes: zoomDownIn,
    outKeyframes: zoomDownOut
  }
};
const initZoomMotion = (token, motionName) => {
  const {
    antCls
  } = token;
  const motionCls = `${antCls}-${motionName}`;
  const {
    inKeyframes,
    outKeyframes
  } = zoomMotion[motionName];
  return [(0,_motion__WEBPACK_IMPORTED_MODULE_1__/* .initMotion */ .b)(motionCls, inKeyframes, outKeyframes, motionName === 'zoom-big-fast' ? token.motionDurationFast : token.motionDurationMid), {
    [`
        ${motionCls}-enter,
        ${motionCls}-appear
      `]: {
      transform: 'scale(0)',
      opacity: 0,
      animationTimingFunction: token.motionEaseOutCirc,
      '&-prepare': {
        transform: 'none'
      }
    },
    [`${motionCls}-leave`]: {
      animationTimingFunction: token.motionEaseInOutCirc
    }
  }];
};

/***/ }),

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
const pendingAgentInfoRequests=new Map();const shownOfflineModalAgentKeys=new Set();function resolveUserId(explicit){if(explicit)return explicit;const fromStorage=(0,_components_utils__WEBPACK_IMPORTED_MODULE_4__/* .getLocalStorage */ .Lg)('user_email',false);return fromStorage||undefined;}/**
 * 全局 agent_info：用 getUserAgentById 拉取 UserAgents 详情。
 * userId 未传入时从 localStorage user_email 读取，避免 Provider 尚未恢复 user 时首屏永远不请求。
 */const useAgentInfo=userIdProp=>{const{agentId,agentInfo,setAgentId,setAgentInfo}=(0,_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q)();const userId=resolveUserId(userIdProp);(0,react__WEBPACK_IMPORTED_MODULE_1__.useEffect)(()=>{if(!userId){return;}let cancelled=false;const run=async()=>{let id=agentId!==null&&agentId!==void 0?agentId:undefined;if(!id){const sa=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;if(sa!==null&&sa!==void 0&&sa.id){setAgentId(String(sa.id));return;}}if(!id){const sa=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;try{const[agents,myOrg]=await Promise.all([_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentAPI */ .cM.getAgentList(userId),_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .organizationsAPI */ .PB.getMyOrg(userId).catch(()=>null)]);if(cancelled)return;const orgDefault=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;const match=(sa===null||sa===void 0?void 0:sa.id)&&(agents===null||agents===void 0?void 0:agents.find(a=>a.id===sa.id))||(sa===null||sa===void 0?void 0:sa.name)&&(agents===null||agents===void 0?void 0:agents.find(a=>a.name===sa.name||Boolean(sa.mode)&&a.mode===sa.mode))||(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__/* .pickLoginDefaultAgent */ .Tw)(agents||[],orgDefault)||(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__/* .pickPreferredAgentFromList */ .WZ)(agents||[]);if(match!==null&&match!==void 0&&match.id){setAgentId(match.id);return;}}catch(_unused){// ignore
}const sa2=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;if(sa2!==null&&sa2!==void 0&&sa2.name){setAgentInfo(sa2);}else{setAgentInfo(null);}return;}if(cancelled)return;const requestKey=userId+":"+id;try{let pendingRequest=pendingAgentInfoRequests.get(requestKey);if(!pendingRequest){pendingRequest=_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentWorkerAPI */ .Ml.getUserAgentById(userId,id).finally(()=>{pendingAgentInfoRequests.delete(requestKey);});pendingAgentInfoRequests.set(requestKey,pendingRequest);}const agentData=await pendingRequest;if(!cancelled)setAgentInfo(agentData);}catch(error){console.error('Failed to fetch agent info:',error);const errorMessage=error instanceof Error?error.message:String(error);const isOfflineAgentError=errorMessage.includes('该智能体已经下线或更新');if(isOfflineAgentError&&!shownOfflineModalAgentKeys.has(requestKey)){shownOfflineModalAgentKeys.add(requestKey);antd__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A.confirm({title:'智能体不可用',content:errorMessage,okText:'删除',closable:false,maskClosable:false,keyboard:false,cancelButtonProps:{style:{display:'none'}},onOk:async()=>{await _components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentAPI */ .cM.deleteMainAgent(userId,id);setAgentId(null);setAgentInfo(null);window.dispatchEvent(new CustomEvent('agentListChanged'));window.dispatchEvent(new CustomEvent('switchToCurrentSession',{detail:{clearSession:true}}));antd__WEBPACK_IMPORTED_MODULE_7__/* ["default"] */ .Ay.success('已删除不可用智能体');}});setAgentInfo(null);return;}try{const[agents,myOrg]=await Promise.all([_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .agentAPI */ .cM.getAgentList(userId),_components_views_api__WEBPACK_IMPORTED_MODULE_3__/* .organizationsAPI */ .PB.getMyOrg(userId).catch(()=>null)]);const byId=agents===null||agents===void 0?void 0:agents.find(a=>a.id===id);if(byId){setAgentInfo(byId);return;}const orgDefault=(myOrg===null||myOrg===void 0?void 0:myOrg.default_agent_id)||null;const preferred=(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__/* .pickLoginDefaultAgent */ .Tw)(agents||[],orgDefault)||(0,_utils_agentPreference__WEBPACK_IMPORTED_MODULE_5__/* .pickPreferredAgentFromList */ .WZ)(agents||[]);if(preferred!==null&&preferred!==void 0&&preferred.id&&typeof preferred.id==='string'&&preferred.id!==id){setAgentId(preferred.id);return;}if(preferred){setAgentInfo(preferred);return;}}catch(_unused2){// ignore; fall through
}const fallback=_store_modeConfig__WEBPACK_IMPORTED_MODULE_2__/* .useModeConfigStore */ .Q.getState().selectedAgent;if(fallback!==null&&fallback!==void 0&&fallback.name){setAgentInfo(fallback);}else{setAgentInfo(null);}}};void run();return()=>{cancelled=true;};},[agentId,userId,setAgentId,setAgentInfo]);return{agentId,agentInfo};};

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

/***/ 82987:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ getScrollBarSize; },
/* harmony export */   V: function() { return /* binding */ getTargetScrollBarSize; }
/* harmony export */ });
/* harmony import */ var _Dom_dynamicCSS__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(85089);
/* eslint-disable no-param-reassign */

var cached;
function measureScrollbarSize(ele) {
  var randomId = "rc-scrollbar-measure-".concat(Math.random().toString(36).substring(7));
  var measureEle = document.createElement('div');
  measureEle.id = randomId;

  // Create Style
  var measureStyle = measureEle.style;
  measureStyle.position = 'absolute';
  measureStyle.left = '0';
  measureStyle.top = '0';
  measureStyle.width = '100px';
  measureStyle.height = '100px';
  measureStyle.overflow = 'scroll';

  // Clone Style if needed
  var fallbackWidth;
  var fallbackHeight;
  if (ele) {
    var targetStyle = getComputedStyle(ele);
    measureStyle.scrollbarColor = targetStyle.scrollbarColor;
    measureStyle.scrollbarWidth = targetStyle.scrollbarWidth;

    // Set Webkit style
    var webkitScrollbarStyle = getComputedStyle(ele, '::-webkit-scrollbar');
    var width = parseInt(webkitScrollbarStyle.width, 10);
    var height = parseInt(webkitScrollbarStyle.height, 10);

    // Try wrap to handle CSP case
    try {
      var widthStyle = width ? "width: ".concat(webkitScrollbarStyle.width, ";") : '';
      var heightStyle = height ? "height: ".concat(webkitScrollbarStyle.height, ";") : '';
      (0,_Dom_dynamicCSS__WEBPACK_IMPORTED_MODULE_0__/* .updateCSS */ .BD)("\n#".concat(randomId, "::-webkit-scrollbar {\n").concat(widthStyle, "\n").concat(heightStyle, "\n}"), randomId);
    } catch (e) {
      // Can't wrap, just log error
      console.error(e);

      // Get from style directly
      fallbackWidth = width;
      fallbackHeight = height;
    }
  }
  document.body.appendChild(measureEle);

  // Measure. Get fallback style if provided
  var scrollWidth = ele && fallbackWidth && !isNaN(fallbackWidth) ? fallbackWidth : measureEle.offsetWidth - measureEle.clientWidth;
  var scrollHeight = ele && fallbackHeight && !isNaN(fallbackHeight) ? fallbackHeight : measureEle.offsetHeight - measureEle.clientHeight;

  // Clean up
  document.body.removeChild(measureEle);
  (0,_Dom_dynamicCSS__WEBPACK_IMPORTED_MODULE_0__/* .removeCSS */ .m6)(randomId);
  return {
    width: scrollWidth,
    height: scrollHeight
  };
}
function getScrollBarSize(fresh) {
  if (typeof document === 'undefined') {
    return 0;
  }
  if (fresh || cached === undefined) {
    cached = measureScrollbarSize();
  }
  return cached.width;
}
function getTargetScrollBarSize(target) {
  if (typeof document === 'undefined' || !target || !(target instanceof Element)) {
    return {
      width: 0,
      height: 0
    };
  }
  return measureScrollbarSize(target);
}

/***/ }),

/***/ 56855:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

var react__WEBPACK_IMPORTED_MODULE_0___namespace_cache;
/* unused harmony export resetUuid */
/* harmony import */ var _babel_runtime_helpers_esm_slicedToArray__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(5544);
/* harmony import */ var _babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(89379);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);



function getUseId() {
  // We need fully clone React function here to avoid webpack warning React 17 do not export `useId`
  var fullClone = (0,_babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)({}, /*#__PURE__*/ (react__WEBPACK_IMPORTED_MODULE_0___namespace_cache || (react__WEBPACK_IMPORTED_MODULE_0___namespace_cache = __webpack_require__.t(react__WEBPACK_IMPORTED_MODULE_0__, 2))));
  return fullClone.useId;
}
var uuid = 0;

/** @private Note only worked in develop env. Not work in production. */
function resetUuid() {
  if (false) {}
}
var useOriginId = getUseId();
/* harmony default export */ __webpack_exports__.A = (useOriginId ?
// Use React `useId`
function useId(id) {
  var reactId = useOriginId();

  // Developer passed id is single source of truth
  if (id) {
    return id;
  }

  // Test env always return mock id
  if (false) {}
  return reactId;
} :
// Use compatible of `useId`
function useCompatId(id) {
  // Inner id for accessibility usage. Only work in client side
  var _React$useState = react__WEBPACK_IMPORTED_MODULE_0__.useState('ssr-id'),
    _React$useState2 = (0,_babel_runtime_helpers_esm_slicedToArray__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)(_React$useState, 2),
    innerId = _React$useState2[0],
    setInnerId = _React$useState2[1];
  react__WEBPACK_IMPORTED_MODULE_0__.useEffect(function () {
    var nextId = uuid;
    uuid += 1;
    setInnerId("rc_unique_".concat(nextId));
  }, []);

  // Developer passed id is single source of truth
  if (id) {
    return id;
  }

  // Test env always return mock id
  if (false) {}

  // Return react native id or inner id
  return innerId;
});

/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-sampletasks-tsx-57b4152ba94b6d83e521.js.map