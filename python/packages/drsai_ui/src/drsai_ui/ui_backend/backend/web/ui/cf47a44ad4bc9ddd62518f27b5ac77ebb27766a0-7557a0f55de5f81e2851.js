"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[9111],{

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

/***/ 14764:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ detail_viewer; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/chevron-left.js
var chevron_left = __webpack_require__(60250);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/chevron-right.js
var chevron_right = __webpack_require__(87677);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/mouse-pointer-click.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const MousePointerClick = (0,createLucideIcon/* default */.A)("MousePointerClick", [
  ["path", { d: "M14 4.1 12 6", key: "ita8i4" }],
  ["path", { d: "m5.1 8-2.9-.8", key: "1go3kf" }],
  ["path", { d: "m6 12-1.9 2", key: "mnht97" }],
  ["path", { d: "M7.2 2.2 8 5.1", key: "1cfko1" }],
  [
    "path",
    {
      d: "M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z",
      key: "s0h3yz"
    }
  ]
]);


//# sourceMappingURL=mouse-pointer-click.js.map

;// ./node_modules/lucide-react/dist/esm/icons/maximize-2.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Maximize2 = (0,createLucideIcon/* default */.A)("Maximize2", [
  ["polyline", { points: "15 3 21 3 21 9", key: "mznyad" }],
  ["polyline", { points: "9 21 3 21 3 15", key: "1avn1i" }],
  ["line", { x1: "21", x2: "14", y1: "3", y2: "10", key: "ota7mn" }],
  ["line", { x1: "3", x2: "10", y1: "21", y2: "14", key: "1atl0r" }]
]);


//# sourceMappingURL=maximize-2.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/x.js
var x = __webpack_require__(48697);
// EXTERNAL MODULE: ./src/components/views/atoms.tsx
var atoms = __webpack_require__(96880);
// EXTERNAL MODULE: ./src/pages/chat/DetailViewer/browser_iframe.tsx
var browser_iframe = __webpack_require__(15779);
// EXTERNAL MODULE: ./src/pages/chat/DetailViewer/browser_modal.tsx
var browser_modal = __webpack_require__(46480);
// EXTERNAL MODULE: ./src/pages/chat/DetailViewer/fullscreen_overlay.tsx
var fullscreen_overlay = __webpack_require__(84478);
;// ./src/pages/chat/detail_viewer.tsx





 // Import our new component

// Define VNC component props type

// Lazy load the VNC component
const VncScreen = /*#__PURE__*/(0,react.lazy)(() =>
// @ts-ignore
Promise.all(/* import() */[__webpack_require__.e(6593), __webpack_require__.e(5358)]).then(__webpack_require__.bind(__webpack_require__, 76726)).then(module => ({
  default: module.VncScreen
})));
const DetailViewer = _ref => {
  let {
    images,
    imageTitles,
    onMinimize,
    currentIndex,
    onIndexChange,
    novncPort,
    onPause,
    runStatus,
    activeTab: controlledActiveTab,
    onTabChange,
    detailViewerContainerId,
    onInputResponse
  } = _ref;
  const {
    0: internalActiveTab,
    1: setInternalActiveTab
  } = (0,react.useState)("live");
  const activeTab = controlledActiveTab !== null && controlledActiveTab !== void 0 ? controlledActiveTab : internalActiveTab;
  const {
    0: viewMode,
    1: setViewMode
  } = (0,react.useState)("iframe");
  const vncRef = (0,react.useRef)();
  const {
    0: isModalOpen,
    1: setIsModalOpen
  } = (0,react.useState)(false);

  // Add state for fullscreen control mode
  const {
    0: isControlMode,
    1: setIsControlMode
  } = (0,react.useState)(false);
  const browserIframeId = "browser-iframe-container";

  // State for tracking if control was handed back from modal
  const {
    0: showControlHandoverForm,
    1: setShowControlHandoverForm
  } = (0,react.useState)(false);

  // Handle take control action
  const handleTakeControl = () => {
    setIsControlMode(true);
  };

  // Exit control mode
  const exitControlMode = () => {
    setIsControlMode(false);
  };

  // Modal control handlers
  const handleModalControlHandover = () => {
    // Show the feedback form overlay in DetailViewer
    setIsControlMode(true);
    setShowControlHandoverForm(true);
  };

  // Add keyboard navigation
  react.useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === "ArrowLeft") {
        handlePrevious();
      } else if (event.key === "ArrowRight") {
        handleNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex]);
  const handlePrevious = () => {
    const newIndex = currentIndex > 0 ? currentIndex - 1 : images.length - 1;
    onIndexChange(newIndex);
  };
  const handleNext = () => {
    const newIndex = currentIndex < images.length - 1 ? currentIndex + 1 : 0;
    onIndexChange(newIndex);
  };
  const handleTabChange = tab => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalActiveTab(tab);
    }
  };
  const handleMaximizeClick = () => {
    setIsModalOpen(true);
  };
  const renderScreenshotsTab = () => /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col h-[65vh] w-full"
  }, images.length === 0 ? /*#__PURE__*/react.createElement("div", {
    className: "flex-1 w-full flex items-center justify-center"
  }, /*#__PURE__*/react.createElement("p", null, "No screenshots")) : /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("div", {
    className: "relative flex-1 flex items-center justify-center overflow-y-auto"
  }, /*#__PURE__*/react.createElement("div", {
    className: "w-full h-full flex flex-col items-center justify-center"
  }, /*#__PURE__*/react.createElement("div", {
    className: "absolute border top-4 left-1/2 transform -translate-x-1/2 z-10 bg-secondary rounded-full px-3 py-1 flex items-center justify-center gap-4 shadow-md"
  }, /*#__PURE__*/react.createElement("button", {
    onClick: handlePrevious,
    className: "text-primary hover:text-opacity-80 transition-colors"
  }, /*#__PURE__*/react.createElement(chevron_left/* default */.A, {
    size: 18
  })), /*#__PURE__*/react.createElement("p", {
    className: "text-sm text-primary"
  }, currentIndex + 1, " / ", images.length), /*#__PURE__*/react.createElement("button", {
    onClick: handleNext,
    className: "text-primary hover:text-opacity-80 transition-colors"
  }, /*#__PURE__*/react.createElement(chevron_right/* default */.A, {
    size: 18
  }))), /*#__PURE__*/react.createElement(atoms/* ClickableImage */.wx, {
    src: images[currentIndex],
    alt: imageTitles[currentIndex],
    className: "max-w-full max-h-full object-contain rounded",
    expandedClassName: "object-contain max-h-[80vh] max-w-[90vw] w-auto h-auto"
  }))))));
  const renderLiveTab = react.useMemo(() => {
    if (!novncPort) {
      return /*#__PURE__*/react.createElement("div", {
        className: "flex-1 w-full h-full min-h-0 flex items-center justify-center"
      }, /*#__PURE__*/react.createElement("p", null, "Waiting for browser session to start..."));
    }
    return /*#__PURE__*/react.createElement("div", {
      className: "flex-1 w-full h-full flex flex-col"
    }, viewMode === "iframe" ? /*#__PURE__*/react.createElement(browser_iframe["default"], {
      novncPort: novncPort,
      style: {
        height: "100%",
        flex: "1 1 auto"
      },
      className: "w-full flex-1",
      showDimensions: true,
      onPause: onPause,
      runStatus: runStatus,
      quality: 7,
      viewOnly: false,
      scaling: "local",
      showTakeControlOverlay: !isControlMode,
      onTakeControl: handleTakeControl,
      isControlMode: isControlMode
    }) : /*#__PURE__*/react.createElement("div", {
      className: "relative w-full h-full flex flex-col",
      onMouseEnter: () => {} // Moved overlay to BrowserIframe
      ,

      onMouseLeave: () => {} // Moved overlay to BrowserIframe
    }, /*#__PURE__*/react.createElement(react.Suspense, {
      fallback: /*#__PURE__*/react.createElement("div", null, "Loading VNC viewer...")
    }, /*#__PURE__*/react.createElement(VncScreen, {
      url: "ws://localhost:" + novncPort,
      scaleViewport: true,
      background: "#000000",
      style: {
        width: "100%",
        height: "100%",
        flex: "1 1 auto",
        alignSelf: "flex-start",
        display: "flex",
        flexDirection: "column"
      },
      ref: vncRef
    }))));
  }, [novncPort, viewMode, runStatus, onPause, isControlMode]);
  return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("div", {
    className: "bg-tertiary rounded-lg shadow-lg p-4 h-full flex flex-col relative overflow-hidden",
    id: detailViewerContainerId
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex justify-between items-center mb-3 flex-shrink-0"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex rounded-lg bg-secondary/30 p-[3px] gap-[2px]"
  }, /*#__PURE__*/react.createElement("button", {
    className: "px-3 py-1 text-[11px] font-medium rounded-md transition-all " + (activeTab === "screenshots" ? "bg-tertiary text-primary shadow-sm" : "text-secondary hover:text-primary"),
    onClick: () => handleTabChange("screenshots")
  }, "Screenshots"), /*#__PURE__*/react.createElement("button", {
    className: "px-3 py-1 text-[11px] font-medium rounded-md transition-all " + (activeTab === "live" ? "bg-tertiary text-primary shadow-sm" : "text-secondary hover:text-primary"),
    onClick: () => handleTabChange("live")
  }, "Live View")), /*#__PURE__*/react.createElement("div", {
    className: "flex gap-2"
  }, isControlMode && /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-2 px-2 rounded-2xl bg-magenta-800 text-white"
  }, /*#__PURE__*/react.createElement(MousePointerClick, {
    size: 16
  }), /*#__PURE__*/react.createElement("span", null, "You have control")), /*#__PURE__*/react.createElement("button", {
    onClick: handleMaximizeClick,
    className: "p-1 hover:bg-gray-100 rounded-full transition-colors",
    title: "Open in full screen"
  }, /*#__PURE__*/react.createElement(Maximize2, {
    size: 20
  })), !isControlMode && /*#__PURE__*/react.createElement("button", {
    onClick: onMinimize,
    className: "p-1 hover:bg-gray-100 rounded-full transition-colors"
  }, /*#__PURE__*/react.createElement(x/* default */.A, {
    size: 20
  })))), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 flex flex-col min-h-0"
  }, activeTab === "screenshots" ? renderScreenshotsTab() : renderLiveTab)), /*#__PURE__*/react.createElement(browser_modal["default"], {
    isOpen: isModalOpen,
    onClose: () => {
      setIsModalOpen(false);
    },
    novncPort: novncPort,
    title: "Browser View",
    onPause: onPause,
    runStatus: runStatus,
    onControlHandover: handleModalControlHandover,
    isControlMode: isControlMode,
    onTakeControl: handleTakeControl
  }), /*#__PURE__*/react.createElement(fullscreen_overlay["default"], {
    isVisible: isControlMode,
    onClose: () => {
      exitControlMode();
      setShowControlHandoverForm(false);
    },
    targetElementId: detailViewerContainerId,
    zIndex: 50,
    onInputResponse: onInputResponse,
    runStatus: runStatus
  }));
};
/* harmony default export */ var detail_viewer = (DetailViewer);

/***/ }),

/***/ 60250:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ ChevronLeft; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const ChevronLeft = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("ChevronLeft", [
  ["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]
]);


//# sourceMappingURL=chevron-left.js.map


/***/ })

}]);
//# sourceMappingURL=cf47a44ad4bc9ddd62518f27b5ac77ebb27766a0-7557a0f55de5f81e2851.js.map