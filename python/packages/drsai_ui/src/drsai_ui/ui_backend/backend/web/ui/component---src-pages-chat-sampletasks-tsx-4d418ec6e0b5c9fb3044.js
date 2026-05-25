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
//# sourceMappingURL=component---src-pages-chat-sampletasks-tsx-4d418ec6e0b5c9fb3044.js.map