"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[2127,6341],{

/***/ 2915:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $: function() { return /* binding */ Button; }
/* harmony export */ });
/* harmony import */ var _babel_runtime_helpers_esm_objectWithoutPropertiesLoose__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(98587);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
const _excluded=["variant","size","isLoading","icon","iconPosition","fullWidth","disabled","children","className"];const Button=_ref=>{let{variant="primary",size="md",isLoading=false,icon,iconPosition="left",fullWidth=false,disabled=false,children,className=""}=_ref,props=(0,_babel_runtime_helpers_esm_objectWithoutPropertiesLoose__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)(_ref,_excluded);// Base classes shared by all buttons
const hasNoFocus=className.includes('sidebar-dropdown-button');const baseClasses=hasNoFocus?"inline-flex items-center justify-center rounded-xl transition-smooth focus:outline-none hover-lift":"inline-flex items-center justify-center rounded-xl transition-smooth focus:outline-none focus:ring-2 focus:ring-accent/20 hover-lift";// Size variations
const sizeClasses={xs:"px-3 py-1.5 text-xs font-medium",sm:"px-4 py-2 text-sm font-medium",md:"px-6 py-3 text-base font-semibold",lg:"px-8 py-4 text-lg font-semibold"};// Variant classes - using modern design tokens
const variantClasses={primary:"bg-accent text-white hover:bg-accent/90 shadow-modern hover:shadow-modern-lg",secondary:"bg-tertiary/50 border-2 border-border-primary text-primary hover:bg-tertiary/70 hover:border-accent/50 backdrop-blur-sm",tertiary:"bg-transparent text-secondary hover:text-accent hover:bg-tertiary/30",success:"bg-success-primary text-white hover:bg-success-primary/90 shadow-modern hover:shadow-modern-lg",warning:"bg-warning-primary text-white hover:bg-warning-primary/90 shadow-modern hover:shadow-modern-lg",danger:"bg-error-primary text-white hover:bg-error-primary/90 shadow-modern hover:shadow-modern-lg",ghost:"bg-transparent text-secondary hover:text-accent hover:bg-accent/10",gradient:"bg-gradient-primary text-white hover:shadow-modern-lg pulse-glow"};// States
const stateClasses=disabled||isLoading?"opacity-50 cursor-not-allowed transform-none":"cursor-pointer";// Width
const widthClass=fullWidth?"w-full":"";return/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("button",Object.assign({disabled:disabled||isLoading,className:"\n        "+baseClasses+"\n        "+sizeClasses[size]+"\n        "+variantClasses[variant]+"\n        "+stateClasses+"\n        "+widthClass+"\n        "+className+"\n      "},props),isLoading&&/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full "+(children?"mr-2":"")}),!isLoading&&icon&&iconPosition==="left"&&/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span",{className:""+(children?"mr-2":"")},icon),children,!isLoading&&icon&&iconPosition==="right"&&/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span",{className:""+(children?"ml-2":"")},icon));};

/***/ }),

/***/ 98748:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ DetailViewer_FeedbackForm; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/antd/es/input/index.js + 22 modules
var input = __webpack_require__(46789);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/eye-off.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const EyeOff = (0,createLucideIcon/* default */.A)("EyeOff", [
  [
    "path",
    {
      d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      key: "ct8e1f"
    }
  ],
  ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242", key: "151rxh" }],
  [
    "path",
    {
      d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      key: "13bj9a"
    }
  ],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }]
]);


//# sourceMappingURL=eye-off.js.map

// EXTERNAL MODULE: ./src/components/common/Button.tsx
var Button = __webpack_require__(2915);
;// ./src/pages/chat/DetailViewer/FeedbackForm.tsx




const {
  TextArea
} = input/* default */.A;
const FeedbackForm = _ref => {
  let {
    userFeedback,
    setUserFeedback,
    onSubmit
  } = _ref;
  return /*#__PURE__*/react.createElement("div", {
    className: "fixed inset-0 flex items-center pointer-events-none"
  }, /*#__PURE__*/react.createElement("div", {
    className: "w-[22vw] ml-[10vw] pointer-events-none"
  }, /*#__PURE__*/react.createElement("div", {
    className: "feedback-form w-full max-w-md pointer-events-auto"
  }, /*#__PURE__*/react.createElement("div", {
    className: "bg-tertiary rounded-lg shadow-lg p-6"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex justify-center mb-4"
  }, /*#__PURE__*/react.createElement("div", {
    className: "p-2 rounded-full bg-blue-700"
  }, /*#__PURE__*/react.createElement(EyeOff, {
    className: "text-blue-800 w-8 h-8"
  }))), /*#__PURE__*/react.createElement("h3", {
    className: "text-lg font-medium text-primary mb-4 text-center"
  }, "Dr. Sai can't see what you do when you take control."), /*#__PURE__*/react.createElement("p", {
    className: "text-base mb-4 text-primary"
  }, "Please describe what you did when you are ready to hand back control:"), /*#__PURE__*/react.createElement(TextArea, {
    value: userFeedback,
    onChange: e => setUserFeedback(e.target.value),
    placeholder: "For example: I entered my zip code, I clicked on the top link...",
    autoSize: {
      minRows: 5,
      maxRows: 8
    },
    className: "w-full text-primary placeholder:text-secondary"
  }), /*#__PURE__*/react.createElement("div", {
    className: "mt-4"
  }, /*#__PURE__*/react.createElement(Button/* Button */.$, {
    variant: "primary",
    size: "md",
    fullWidth: true,
    onClick: onSubmit,
    className: "font-medium shadow-md"
  }, "Give control back to Dr. Sai"))))));
};
/* harmony default export */ var DetailViewer_FeedbackForm = (FeedbackForm);

/***/ }),

/***/ 84478:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _FeedbackForm__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(98748);


const FullscreenOverlay = _ref => {
  let {
    isVisible,
    onClose,
    targetElementId,
    children,
    zIndex = 1000,
    onInputResponse,
    runStatus
  } = _ref;
  const {
    0: userFeedback,
    1: setUserFeedback
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)("");

  // Lock body scroll and intercept all events
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    if (isVisible) {
      document.body.style.overflow = "hidden";

      // Event handler to capture and stop all events
      const captureEvents = e => {
        if (targetElementId) {
          // Check if the event target is inside our target element
          const targetElement = document.getElementById(targetElementId);
          if (targetElement && (e.target === targetElement || targetElement.contains(e.target))) {
            // Allow events within the target element
            return;
          }

          // Allow events from our feedback form
          if (e.target.closest(".feedback-form")) {
            return;
          }
        }

        // ADDED: Allow events from modal-root (where the portal renders)
        const modalRoot = document.getElementById("modal-root");
        if (modalRoot && (e.target === modalRoot || modalRoot.contains(e.target))) {
          return;
        }

        // Stop all other events from propagating
        e.stopPropagation();
        e.preventDefault();
      };

      // Capture all these events
      const eventsToCapture = ["click", "mousedown", "mouseup", "mousemove", "touchstart", "touchend", "touchmove", "keydown", "keyup", "keypress", "wheel", "scroll"];

      // Add event listeners with capture phase
      eventsToCapture.forEach(eventName => {
        document.addEventListener(eventName, captureEvents, {
          capture: true
        });
      });

      // Clean up
      return () => {
        document.body.style.overflow = "";
        eventsToCapture.forEach(eventName => {
          document.removeEventListener(eventName, captureEvents, {
            capture: true
          });
        });
      };
    }
  }, [isVisible, targetElementId]);

  // Apply styles to target element
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    if (isVisible && targetElementId) {
      const targetEl = document.getElementById(targetElementId);
      if (targetEl) {
        // Save original styles
        const originalPosition = targetEl.style.position;
        const originalZIndex = targetEl.style.zIndex;
        // Apply new styles
        targetEl.style.position = "relative";
        targetEl.style.zIndex = "" + (zIndex + 1);
        // Clean up function to restore original styles
        return () => {
          targetEl.style.position = originalPosition;
          targetEl.style.zIndex = originalZIndex;
        };
      }
    }
  }, [isVisible, targetElementId, zIndex]);
  const handleSubmitFeedback = () => {
    onClose();
    if (onInputResponse) {
      if (runStatus === "awaiting_input") {
        const feedbackToSend = userFeedback.trim() === "" ? "Resume" : userFeedback;
        onInputResponse(feedbackToSend, true);
      }
    }
    setUserFeedback("");
  };
  if (!isVisible) return null;
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    id: "fullscreen-overlay",
    className: "fixed inset-0 bg-black bg-opacity-50",
    style: {
      zIndex
    },
    "aria-label": "Control Mode Active"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_FeedbackForm__WEBPACK_IMPORTED_MODULE_1__["default"], {
    userFeedback: userFeedback,
    setUserFeedback: setUserFeedback,
    onSubmit: handleSubmitFeedback
  }), children);
};
/* harmony default export */ __webpack_exports__["default"] = (FullscreenOverlay);

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
//# sourceMappingURL=component---src-pages-chat-detail-viewer-fullscreen-overlay-tsx-474bd12ffda75a5fbb1d.js.map