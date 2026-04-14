"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[3799,4020,4158],{

/***/ 40682:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Ob: function() { return /* binding */ cloneElement; },
/* harmony export */   fx: function() { return /* binding */ replaceElement; },
/* harmony export */   zv: function() { return /* binding */ isFragment; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);

function isFragment(child) {
  return child && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.isValidElement(child) && child.type === react__WEBPACK_IMPORTED_MODULE_0__.Fragment;
}
const replaceElement = (element, replacement, props) => {
  if (! /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.isValidElement(element)) {
    return replacement;
  }
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.cloneElement(element, typeof props === 'function' ? props(element.props || {}) : props);
};
function cloneElement(element, props) {
  return replaceElement(element, element, props);
}

/***/ }),

/***/ 829:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _SizeContext__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(48224);


const useSize = customSize => {
  const size = react__WEBPACK_IMPORTED_MODULE_0__.useContext(_SizeContext__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A);
  const mergedSize = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    if (!customSize) {
      return size;
    }
    if (typeof customSize === 'string') {
      return customSize !== null && customSize !== void 0 ? customSize : size;
    }
    if (customSize instanceof Function) {
      return customSize(size);
    }
    return size;
  }, [customSize, size]);
  return mergedSize;
};
/* harmony default export */ __webpack_exports__.A = (useSize);

/***/ }),

/***/ 76327:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   K6: function() { return /* binding */ NoCompactStyle; },
/* harmony export */   RQ: function() { return /* binding */ useCompactItemContext; }
/* harmony export */ });
/* unused harmony export SpaceCompactItemContext */
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var classnames__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(46942);
/* harmony import */ var classnames__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(classnames__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var rc_util_es_Children_toArray__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(82546);
/* harmony import */ var _config_provider__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(62279);
/* harmony import */ var _config_provider_hooks_useSize__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(829);
/* harmony import */ var _style__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(85447);
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};






const SpaceCompactItemContext = /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createContext(null);
const useCompactItemContext = (prefixCls, direction) => {
  const compactItemContext = react__WEBPACK_IMPORTED_MODULE_0__.useContext(SpaceCompactItemContext);
  const compactItemClassnames = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    if (!compactItemContext) {
      return '';
    }
    const {
      compactDirection,
      isFirstItem,
      isLastItem
    } = compactItemContext;
    const separator = compactDirection === 'vertical' ? '-vertical-' : '-';
    return classnames__WEBPACK_IMPORTED_MODULE_1___default()(`${prefixCls}-compact${separator}item`, {
      [`${prefixCls}-compact${separator}first-item`]: isFirstItem,
      [`${prefixCls}-compact${separator}last-item`]: isLastItem,
      [`${prefixCls}-compact${separator}item-rtl`]: direction === 'rtl'
    });
  }, [prefixCls, direction, compactItemContext]);
  return {
    compactSize: compactItemContext === null || compactItemContext === void 0 ? void 0 : compactItemContext.compactSize,
    compactDirection: compactItemContext === null || compactItemContext === void 0 ? void 0 : compactItemContext.compactDirection,
    compactItemClassnames
  };
};
const NoCompactStyle = _ref => {
  let {
    children
  } = _ref;
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(SpaceCompactItemContext.Provider, {
    value: null
  }, children);
};
const CompactItem = _a => {
  var {
      children
    } = _a,
    otherProps = __rest(_a, ["children"]);
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(SpaceCompactItemContext.Provider, {
    value: otherProps
  }, children);
};
const Compact = props => {
  const {
    getPrefixCls,
    direction: directionConfig
  } = react__WEBPACK_IMPORTED_MODULE_0__.useContext(_config_provider__WEBPACK_IMPORTED_MODULE_3__/* .ConfigContext */ .QO);
  const {
      size,
      direction,
      block,
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      children
    } = props,
    restProps = __rest(props, ["size", "direction", "block", "prefixCls", "className", "rootClassName", "children"]);
  const mergedSize = (0,_config_provider_hooks_useSize__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A)(ctx => size !== null && size !== void 0 ? size : ctx);
  const prefixCls = getPrefixCls('space-compact', customizePrefixCls);
  const [wrapCSSVar, hashId] = (0,_style__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A)(prefixCls);
  const clx = classnames__WEBPACK_IMPORTED_MODULE_1___default()(prefixCls, hashId, {
    [`${prefixCls}-rtl`]: directionConfig === 'rtl',
    [`${prefixCls}-block`]: block,
    [`${prefixCls}-vertical`]: direction === 'vertical'
  }, className, rootClassName);
  const compactItemContext = react__WEBPACK_IMPORTED_MODULE_0__.useContext(SpaceCompactItemContext);
  const childNodes = (0,rc_util_es_Children_toArray__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)(children);
  const nodes = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => childNodes.map((child, i) => {
    const key = (child === null || child === void 0 ? void 0 : child.key) || `${prefixCls}-item-${i}`;
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(CompactItem, {
      key: key,
      compactSize: mergedSize,
      compactDirection: direction,
      isFirstItem: i === 0 && (!compactItemContext || (compactItemContext === null || compactItemContext === void 0 ? void 0 : compactItemContext.isFirstItem)),
      isLastItem: i === childNodes.length - 1 && (!compactItemContext || (compactItemContext === null || compactItemContext === void 0 ? void 0 : compactItemContext.isLastItem))
    }, child);
  }), [size, childNodes, compactItemContext]);
  // =========================== Render ===========================
  if (childNodes.length === 0) {
    return null;
  }
  return wrapCSSVar(/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", Object.assign({
    className: clx
  }, restProps), nodes));
};
/* harmony default export */ __webpack_exports__.Ay = (Compact);

/***/ }),

/***/ 85447:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ style; }
});

// UNUSED EXPORTS: prepareComponentToken

// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var es = __webpack_require__(14277);
;// ./node_modules/antd/es/space/style/compact.js
const genSpaceCompactStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [componentCls]: {
      '&-block': {
        display: 'flex',
        width: '100%'
      },
      '&-vertical': {
        flexDirection: 'column'
      }
    }
  };
};
// ============================== Export ==============================
/* harmony default export */ var compact = (genSpaceCompactStyle);
;// ./node_modules/antd/es/space/style/index.js


const genSpaceStyle = token => {
  const {
    componentCls,
    antCls
  } = token;
  return {
    [componentCls]: {
      display: 'inline-flex',
      '&-rtl': {
        direction: 'rtl'
      },
      '&-vertical': {
        flexDirection: 'column'
      },
      '&-align': {
        flexDirection: 'column',
        '&-center': {
          alignItems: 'center'
        },
        '&-start': {
          alignItems: 'flex-start'
        },
        '&-end': {
          alignItems: 'flex-end'
        },
        '&-baseline': {
          alignItems: 'baseline'
        }
      },
      [`${componentCls}-item:empty`]: {
        display: 'none'
      },
      // https://github.com/ant-design/ant-design/issues/47875
      [`${componentCls}-item > ${antCls}-badge-not-a-wrapper:only-child`]: {
        display: 'block'
      }
    }
  };
};
const genSpaceGapStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [componentCls]: {
      '&-gap-row-small': {
        rowGap: token.spaceGapSmallSize
      },
      '&-gap-row-middle': {
        rowGap: token.spaceGapMiddleSize
      },
      '&-gap-row-large': {
        rowGap: token.spaceGapLargeSize
      },
      '&-gap-col-small': {
        columnGap: token.spaceGapSmallSize
      },
      '&-gap-col-middle': {
        columnGap: token.spaceGapMiddleSize
      },
      '&-gap-col-large': {
        columnGap: token.spaceGapLargeSize
      }
    }
  };
};
// ============================== Export ==============================
const prepareComponentToken = () => ({});
/* harmony default export */ var style = ((0,genStyleUtils/* genStyleHooks */.OF)('Space', token => {
  const spaceToken = (0,es/* mergeToken */.oX)(token, {
    spaceGapSmallSize: token.paddingXS,
    spaceGapMiddleSize: token.padding,
    spaceGapLargeSize: token.paddingLG
  });
  return [genSpaceStyle(spaceToken), genSpaceGapStyle(spaceToken), compact(spaceToken)];
}, () => ({}), {
  // Space component don't apply extra font style
  // https://github.com/ant-design/ant-design/issues/40315
  resetStyle: false
}));

/***/ }),

/***/ 81134:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ DetailViewer_SecurityBanner; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/shield-alert.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const ShieldAlert = (0,createLucideIcon/* default */.A)("ShieldAlert", [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "M12 8v4", key: "1got3b" }],
  ["path", { d: "M12 16h.01", key: "1drbdi" }]
]);


//# sourceMappingURL=shield-alert.js.map

;// ./src/pages/chat/DetailViewer/SecurityBanner.tsx


const SecurityBanner = _ref => {
  let {
    className = "",
    style = {}
  } = _ref;
  return /*#__PURE__*/react.createElement("div", {
    className: "bg-yellow-100 border-b border-yellow-300 text-yellow-800 px-4 py-3 flex items-center " + className,
    style: style
  }, /*#__PURE__*/react.createElement(ShieldAlert, {
    className: "h-5 w-5 mr-2 flex-shrink-0"
  }), /*#__PURE__*/react.createElement("p", {
    className: "text-sm"
  }, /*#__PURE__*/react.createElement("span", {
    className: "font-bold"
  }, "Security Note:"), " Magentic-UI cannot see what you do when you take control. Be cautious about entering passwords or sensitive information."));
};
/* harmony default export */ var DetailViewer_SecurityBanner = (SecurityBanner);

/***/ }),

/***/ 15779:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _SecurityBanner__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(81134);


const BrowserIframe = _ref => {
  let {
    novncPort,
    style = {},
    className = "",
    showDimensions = true,
    onPause,
    runStatus,
    quality = 9,
    viewOnly = false,
    scaling = "local",
    showTakeControlOverlay = true,
    onTakeControl,
    isControlMode = false
  } = _ref;
  const {
    0: iframeDimensions,
    1: setIframeDimensions
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)({
    width: 0,
    height: 0
  });
  const {
    0: isHovering,
    1: setIsHovering
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);

  // Reset hover state when status changes back to active
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    if (runStatus === "active") {
      setIsHovering(false);
    }
  }, [runStatus]);
  const handleOverlayClick = () => {
    if (runStatus === "active") {
      // Call both onPause and onTakeControl
      if (onPause) {
        onPause();
      }

      // Signal that take control was clicked
      if (onTakeControl) {
        onTakeControl();
      }
    }
  };
  if (!novncPort) {
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "flex items-center justify-center h-full"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
      className: "text-sm text-gray-600"
    }, "Waiting for browser session to start..."));
  }

  // Build VNC URL with parameters
  // const vncUrl = `http://localhost:${novncPort}/vnc.html?autoconnect=true&resize=${
  // const vncUrl = `http://aitest.ihep.ac.cn:${novncPort}/vnc.html?autoconnect=true&resize=${
  // const vncUrl = `https://drsai.ihep.ac.cn:42800/api/novnc?port=${novncPort}`;
  // const vncUrl = `http://202.122.37.162:${novncPort}/vnc.html?autoconnect=true&resize=${
  // const vncUrl = `https://drsai.ihep.ac.cn:42800/api/vncapi/${novncPort}/vnc.html?autoconnect=true&resize=${
  const vncServiceUrl =  false || "/api/vncapi";
  const vncUrl = vncServiceUrl + "/" + novncPort + "/vnc.html?autoconnect=true&resize=" + (scaling === "remote" ? "remote" : "scale") + "&show_dot=true&scaling=" + scaling + "&quality=" + quality + "&compression=0&view_only=" + (viewOnly ? 1 : 0);

  // const vncUrl = `https://drsai.ihep.ac.cn:42800/api/novnc?port=${novncPort}`;

  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "relative w-full h-full " + className,
    onMouseEnter: () => setIsHovering(true),
    onMouseLeave: () => setIsHovering(false)
  }, isControlMode && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_SecurityBanner__WEBPACK_IMPORTED_MODULE_1__["default"], {
    className: "sticky top-0 left-0 right-0"
  }), showDimensions && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute top-1 right-1 bg-gray-800 bg-opacity-75 text-white px-2 py-1 rounded text-xs z-10"
  }, iframeDimensions.width, " \xD7 ", iframeDimensions.height), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("iframe", {
    src: vncUrl,
    style: Object.assign({
      width: "100%",
      height: "100%",
      border: "none"
    }, style),
    title: "Browser View",
    className: "rounded",
    onLoad: e => {
      const iframe = e.target;
      setIframeDimensions({
        width: iframe.offsetWidth,
        height: iframe.offsetHeight
      });
    }
  }), showTakeControlOverlay && isHovering && runStatus === "active" && !isControlMode && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center cursor-pointer transition-opacity duration-200",
    onClick: handleOverlayClick
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-white text-base font-medium px-4 py-2 bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
  }, "Take Control")));
};
/* harmony default export */ __webpack_exports__["default"] = (BrowserIframe);

/***/ }),

/***/ 46480:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var react_dom__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(40961);
/* harmony import */ var lucide_react__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(48697);
/* harmony import */ var _browser_iframe__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(15779);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(81917);





const BrowserModal = props => {
  const {
    isOpen,
    onClose,
    novncPort,
    title = "Browser View",
    onPause,
    runStatus,
    onControlHandover,
    isControlMode = false,
    onTakeControl
  } = props;
  const {
    0: modalRoot,
    1: setModalRoot
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
  const modalIframeId = "modal-browser-iframe";
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    // Look for existing modal root
    let root = document.getElementById("modal-root");

    // Create it if it doesn't exist
    if (!root) {
      root = document.createElement("div");
      root.id = "modal-root";
      document.body.appendChild(root);
    }
    setModalRoot(root);

    // Clean up function
    return () => {
      var _document$getElementB;
      if (root && root.parentNode && !((_document$getElementB = document.getElementById("modal-root")) !== null && _document$getElementB !== void 0 && _document$getElementB.childElementCount)) {
        root.parentNode.removeChild(root);
      }
    };
  }, []);

  // Handle giving back control
  const handleGiveBackControl = () => {
    // Close the modal first
    onClose();

    // Then trigger the control handover in parent component (DetailViewer)
    if (onControlHandover) {
      onControlHandover();
    }
  };

  // Don't render until we have a modal root
  if (!isOpen || !modalRoot) return null;
  const modalContent = /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(react__WEBPACK_IMPORTED_MODULE_0__.Fragment, null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "fixed inset-0 flex items-center justify-center bg-black bg-opacity-75",
    style: {
      zIndex: 100
    }
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "bg-tertiary rounded-lg shadow-xl w-[95vw] h-[95vh] flex flex-col"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "grid grid-cols-3 items-center px-6 py-3 border-b border-primary/20"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex items-center"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h2", {
    className: "text-lg font-semibold text-primary"
  }, title)), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex justify-center"
  }, isControlMode && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .Ay, {
    type: "primary",
    block: true,
    onClick: handleGiveBackControl,
    className: "font-medium shadow-md flex justify-center items-center",
    size: "large"
  }, "Give control back to Magentic-UI")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex justify-end"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("button", {
    onClick: onClose,
    className: "p-1 hover:bg-gray-100 rounded-full transition-colors"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
    size: 20
  })))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex-grow p-2 h-full overflow-hidden"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    id: modalIframeId,
    className: "h-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_browser_iframe__WEBPACK_IMPORTED_MODULE_2__["default"], {
    novncPort: novncPort,
    className: "h-full",
    showDimensions: true,
    onPause: onPause,
    runStatus: runStatus,
    quality: 9,
    viewOnly: false,
    scaling: "remote",
    showTakeControlOverlay: !isControlMode,
    onTakeControl: onTakeControl,
    isControlMode: isControlMode
  }))))));
  return /*#__PURE__*/react_dom__WEBPACK_IMPORTED_MODULE_1__.createPortal(modalContent, modalRoot);
};
/* harmony default export */ __webpack_exports__["default"] = (BrowserModal);

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

/***/ 48697:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ X; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const X = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);


//# sourceMappingURL=x.js.map


/***/ }),

/***/ 82546:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ toArray; }
/* harmony export */ });
/* harmony import */ var _React_isFragment__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(76288);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(96540);


function toArray(children) {
  var option = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var ret = [];
  react__WEBPACK_IMPORTED_MODULE_1__.Children.forEach(children, function (child) {
    if ((child === undefined || child === null) && !option.keepEmpty) {
      return;
    }
    if (Array.isArray(child)) {
      ret = ret.concat(toArray(child));
    } else if ((0,_React_isFragment__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)(child) && child.props) {
      ret = ret.concat(toArray(child.props.children, option));
    } else {
      ret.push(child);
    }
  });
  return ret;
}

/***/ }),

/***/ 42467:
/***/ (function(__unused_webpack_module, __webpack_exports__) {

/* harmony default export */ __webpack_exports__.A = (function (element) {
  if (!element) {
    return false;
  }
  if (element instanceof Element) {
    if (element.offsetParent) {
      return true;
    }
    if (element.getBBox) {
      var _getBBox = element.getBBox(),
        width = _getBBox.width,
        height = _getBBox.height;
      if (width || height) {
        return true;
      }
    }
    if (element.getBoundingClientRect) {
      var _element$getBoundingC = element.getBoundingClientRect(),
        _width = _element$getBoundingC.width,
        _height = _element$getBoundingC.height;
      if (_width || _height) {
        return true;
      }
    }
  }
  return false;
});

/***/ }),

/***/ 19853:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ omit; }
/* harmony export */ });
function omit(obj, fields) {
  var clone = Object.assign({}, obj);
  if (Array.isArray(fields)) {
    fields.forEach(function (key) {
      delete clone[key];
    });
  }
  return clone;
}

/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-detail-viewer-browser-modal-tsx-36b72c3b371e810cf978.js.map