"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[1854],{

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

/***/ 67040:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": function() { return /* binding */ ProgressBar; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var lucide_react__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(79804);
/* harmony import */ var lucide_react__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(85265);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(40367);



function ProgressBar(_ref) {
  var _adjustedProgress$pla3, _adjustedProgress$pla4, _adjustedProgress$pla5, _adjustedProgress$pla6, _adjustedProgress$pla7;
  let {
    isPlanning,
    progress,
    hasFinalAnswer,
    onStepClick
  } = _ref;
  // Adjust progress when we have final answer
  const adjustedProgress = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    var _progress$plan;
    if (hasFinalAnswer && (_progress$plan = progress.plan) !== null && _progress$plan !== void 0 && _progress$plan.steps) {
      return Object.assign({}, progress, {
        currentStep: progress.plan.steps.length - 1,
        totalSteps: progress.plan.steps.length
      });
    }
    return progress;
  }, [hasFinalAnswer, progress]);
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-3/5 max-w-3xl mx-auto overflow-hidden flex flex-col"
  }, isPlanning ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex justify-center w-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-full max-w-xs px-4 py-2"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-sm text-gray-500 mt-1 text-center font-medium"
  }, "Planning..."))) : adjustedProgress.totalSteps > 0 && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex justify-center w-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-full px-4 py-2"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "relative w-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-full bg-gray-200 rounded-full h-1 dark:bg-gray-700"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "relative w-full h-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute bg-green-600 h-1 rounded-full transition-all duration-300",
    style: {
      width: hasFinalAnswer ? "100%" : adjustedProgress.currentStep / adjustedProgress.totalSteps * 100 + "%"
    }
  }), !hasFinalAnswer && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute bg-magenta-800 h-1 transition-all duration-300",
    style: {
      left: adjustedProgress.currentStep / adjustedProgress.totalSteps * 100 + "%",
      width: 1 / adjustedProgress.totalSteps * 100 + "%"
    }
  }), !hasFinalAnswer && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute bg-gray-300 h-1 rounded-r-full transition-all duration-300",
    style: {
      left: (adjustedProgress.currentStep + 1) / adjustedProgress.totalSteps * 100 + "%",
      width: (adjustedProgress.totalSteps - adjustedProgress.currentStep - 1) / adjustedProgress.totalSteps * 100 + "%"
    }
  }))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute w-full flex",
    style: {
      top: "-12px",
      height: "24px"
    }
  }, Array.from({
    length: adjustedProgress.totalSteps
  }, (_, index) => {
    var _adjustedProgress$pla;
    const step = (_adjustedProgress$pla = adjustedProgress.plan) === null || _adjustedProgress$pla === void 0 ? void 0 : _adjustedProgress$pla.steps[index];
    const tooltipContent = step ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "font-medium"
    }, "Step ", index + 1, ": ", step.title), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "text-xs mt-1"
    }, step.details)) : "Step " + (index + 1);
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A, {
      key: index,
      title: tooltipContent,
      placement: "top",
      overlayStyle: {
        maxWidth: "300px"
      }
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "absolute h-full " + (onStepClick ? "cursor-pointer" : "cursor-help"),
      style: {
        left: index / adjustedProgress.totalSteps * 100 + "%",
        width: 1 / adjustedProgress.totalSteps * 100 + "%"
      },
      onClick: () => onStepClick === null || onStepClick === void 0 ? void 0 : onStepClick(index)
    }));
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute w-full flex justify-between px-2",
    style: {
      top: "-7px"
    }
  }, Array.from({
    length: adjustedProgress.totalSteps
  }, (_, index) => {
    var _adjustedProgress$pla2;
    const step = (_adjustedProgress$pla2 = adjustedProgress.plan) === null || _adjustedProgress$pla2 === void 0 ? void 0 : _adjustedProgress$pla2.steps[index];
    const tooltipContent = step ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "font-medium"
    }, "Step ", index + 1, ": ", step.title), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "text-xs mt-1"
    }, step.details)) : "Step " + (index + 1);
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      key: index,
      className: "absolute",
      style: {
        left: (index + 0.5) / adjustedProgress.totalSteps * 100 + "%",
        transform: "translateX(-50%)"
      }
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A, {
      title: tooltipContent,
      placement: "top",
      overlayStyle: {
        maxWidth: "300px"
      }
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "w-5 h-5 rounded-full flex items-center justify-center " + (onStepClick ? "cursor-pointer" : "cursor-help") + "\n                              " + (hasFinalAnswer || index < adjustedProgress.currentStep ? "bg-green-600 text-white" : index === adjustedProgress.currentStep ? "bg-magenta-800 text-white" : "bg-gray-400 text-white"),
      onClick: () => onStepClick === null || onStepClick === void 0 ? void 0 : onStepClick(index)
    }, hasFinalAnswer || index < adjustedProgress.currentStep ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A, {
      className: "w-4 h-4"
    }) : index === adjustedProgress.currentStep ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .A, {
      className: "w-4 h-4 animate-spin"
    }) : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "text-xs font-medium"
    }, index + 1))));
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-sm text-gray-500 mt-5 text-center"
  }, hasFinalAnswer ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
    className: "text-green-600 font-medium"
  }, "Task Completed") : (_adjustedProgress$pla3 = adjustedProgress.plan) !== null && _adjustedProgress$pla3 !== void 0 && _adjustedProgress$pla3.task ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", null, "Step ", adjustedProgress.currentStep + 1, " of", " ", adjustedProgress.totalSteps, ((_adjustedProgress$pla4 = adjustedProgress.plan) === null || _adjustedProgress$pla4 === void 0 ? void 0 : (_adjustedProgress$pla5 = _adjustedProgress$pla4.steps[adjustedProgress.currentStep]) === null || _adjustedProgress$pla5 === void 0 ? void 0 : _adjustedProgress$pla5.title) && ": " + adjustedProgress.plan.steps[adjustedProgress.currentStep].title.substring(0, 30) + "...") : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", null, "Step ", adjustedProgress.currentStep + 1, " of", " ", adjustedProgress.totalSteps, ((_adjustedProgress$pla6 = adjustedProgress.plan) === null || _adjustedProgress$pla6 === void 0 ? void 0 : (_adjustedProgress$pla7 = _adjustedProgress$pla6.steps[adjustedProgress.currentStep]) === null || _adjustedProgress$pla7 === void 0 ? void 0 : _adjustedProgress$pla7.title) && ": " + adjustedProgress.plan.steps[adjustedProgress.currentStep].title.substring(0, 30) + "..."))))));
}

/***/ }),

/***/ 9407:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ createLucideIcon; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/lucide-react/dist/esm/shared/src/utils.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */

const toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();


//# sourceMappingURL=utils.js.map

;// ./node_modules/lucide-react/dist/esm/defaultAttributes.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */

var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};


//# sourceMappingURL=defaultAttributes.js.map

;// ./node_modules/lucide-react/dist/esm/Icon.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */





const Icon = (0,react.forwardRef)(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return (0,react.createElement)(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => (0,react.createElement)(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);


//# sourceMappingURL=Icon.js.map

;// ./node_modules/lucide-react/dist/esm/createLucideIcon.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */





const createLucideIcon = (iconName, iconNode) => {
  const Component = (0,react.forwardRef)(
    ({ className, ...props }, ref) => (0,react.createElement)(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};


//# sourceMappingURL=createLucideIcon.js.map


/***/ }),

/***/ 79804:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ CircleCheck; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CircleCheck = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("CircleCheck", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
]);


//# sourceMappingURL=circle-check.js.map


/***/ }),

/***/ 85265:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ RotateCw; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const RotateCw = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("RotateCw", [
  ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", key: "1p45f6" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }]
]);


//# sourceMappingURL=rotate-cw.js.map


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
//# sourceMappingURL=component---src-pages-chat-progressbar-tsx-ef5b58560ea384e0ff49.js.map