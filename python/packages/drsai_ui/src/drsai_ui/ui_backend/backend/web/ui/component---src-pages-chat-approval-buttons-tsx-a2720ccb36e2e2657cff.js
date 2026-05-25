"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[1447,2655],{

/***/ 34047:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ approval_buttons; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/circle-check-big.js
var circle_check_big = __webpack_require__(44471);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/circle-x.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CircleX = (0,createLucideIcon/* default */.A)("CircleX", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m15 9-6 6", key: "1uzhvr" }],
  ["path", { d: "m9 9 6 6", key: "z0biqf" }]
]);


//# sourceMappingURL=circle-x.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/rotate-cw.js
var rotate_cw = __webpack_require__(85265);
;// ./src/pages/chat/approval_buttons.tsx


const ApprovalButtons = _ref => {
  let {
    status,
    inputRequest,
    isPlanMessage,
    onApprove,
    onDeny,
    onAcceptPlan,
    onRegeneratePlan
  } = _ref;
  const [planAcceptText, setPlanAcceptText] = react.useState("");
  if (status !== "awaiting_input") {
    return null;
  }
  return /*#__PURE__*/react.createElement("div", {
    className: "flex gap-2 justify-start"
  }, (inputRequest === null || inputRequest === void 0 ? void 0 : inputRequest.input_type) === "approval" ? /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onApprove,
    className: "bg-green-500 hover:bg-green-600 text-white rounded flex justify-center items-center px-2 py-1.5 transition duration-300"
  }, /*#__PURE__*/react.createElement(circle_check_big/* default */.A, {
    className: "h-5 w-5 mr-1"
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm mr-1"
  }, "Approve")), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onDeny,
    className: "bg-red-500 hover:bg-red-600 text-white rounded flex justify-center items-center px-2 py-1.5 transition duration-300"
  }, /*#__PURE__*/react.createElement(CircleX, {
    className: "h-5 w-5 mr-1"
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm mr-1"
  }, "Reject"))) :
  // Plan acceptance buttons
  isPlanMessage && /*#__PURE__*/react.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: () => onAcceptPlan === null || onAcceptPlan === void 0 ? void 0 : onAcceptPlan(planAcceptText),
    className: "bg-green-500 hover:bg-green-600 text-white rounded flex justify-center items-center px-2 py-1.5 transition duration-300"
  }, /*#__PURE__*/react.createElement(circle_check_big/* default */.A, {
    className: "h-5 w-5 mr-1"
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm mr-1"
  }, "Accept Plan")), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onRegeneratePlan,
    className: "bg-magenta-800 hover:bg-magenta-900 text-white rounded flex justify-center items-center px-2 py-1.5 transition duration-300"
  }, /*#__PURE__*/react.createElement(rotate_cw/* default */.A, {
    className: "h-5 w-5 mr-1"
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm mr-1"
  }, "Generate New Plan"))));
};
/* harmony default export */ var approval_buttons = (ApprovalButtons);

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

/***/ 44471:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ CircleCheckBig; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CircleCheckBig = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("CircleCheckBig", [
  ["path", { d: "M21.801 10A10 10 0 1 1 17 3.335", key: "yps3ct" }],
  ["path", { d: "m9 11 3 3L22 4", key: "1pflzl" }]
]);


//# sourceMappingURL=circle-check-big.js.map


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


/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-approval-buttons-tsx-a2720ccb36e2e2657cff.js.map