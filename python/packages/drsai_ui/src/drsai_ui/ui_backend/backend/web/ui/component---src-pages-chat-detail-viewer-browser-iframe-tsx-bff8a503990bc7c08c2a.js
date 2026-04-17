"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[4020,4158],{

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
  const vncServiceUrl = ({}).GATSBY_VNC_SERVICE_URL || "/api/vncapi";
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


/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-detail-viewer-browser-iframe-tsx-bff8a503990bc7c08c2a.js.map