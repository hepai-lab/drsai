"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[1854],{

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


/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-progressbar-tsx-231061ed0d3a0a2756fc.js.map