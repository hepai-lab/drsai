"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[712],{

/***/ 96880:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   vq: function() { return /* binding */ getRelativeTimeString; },
/* harmony export */   wx: function() { return /* binding */ ClickableImage; }
/* harmony export */ });
/* unused harmony exports LoadingIndicator, LoadingDots, TruncatableText */
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var lucide_react__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(48697);
/* harmony import */ var react_dom__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(40961);
const LoadingIndicator=_ref=>{let{size=16}=_ref;return(/*#__PURE__*/// 旋转加载图标
React.createElement("div",{className:"inline-flex items-center gap-2 text-accent   mr-2"},/*#__PURE__*/React.createElement(Loader2,{size:size,className:"animate-spin"})));};const LoadingDots=_ref2=>{let{size=8}=_ref2;// 三个点的加载动画
return/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-2"},/*#__PURE__*/React.createElement("span",{className:"bg-accent rounded-full animate-bounce",style:{width:size+"px",height:size+"px",animationDuration:"0.6s"}}),/*#__PURE__*/React.createElement("span",{className:"bg-accent rounded-full animate-bounce",style:{width:size+"px",height:size+"px",animationDuration:"0.6s",animationDelay:"0.2s"}}),/*#__PURE__*/React.createElement("span",{className:"bg-accent rounded-full animate-bounce",style:{width:size+"px",height:size+"px",animationDuration:"0.6s",animationDelay:"0.4s"}}));};const TruncatableText=/*#__PURE__*/(/* unused pure expression or super */ null && (memo(_ref3=>{let{content,isJson=false,className="",jsonThreshold=1000,textThreshold=500}=_ref3;const{0:isExpanded,1:setIsExpanded}=useState(false);const threshold=isJson?jsonThreshold:textThreshold;const shouldTruncate=content.length>threshold;const toggleExpand=()=>{setIsExpanded(!isExpanded);};const displayContent=shouldTruncate&&!isExpanded?content.slice(0,threshold)+"...":content;return/*#__PURE__*/React.createElement("div",{className:"relative"},/*#__PURE__*/React.createElement("div",{className:"\n            transition-[max-height,opacity] duration-500 ease-in-out\n            "+(shouldTruncate&&!isExpanded?"max-h-[300px]":"max-h-[10000px]")+"\n            "+className+"\n          "},displayContent,shouldTruncate&&!isExpanded&&/*#__PURE__*/React.createElement("div",{className:"absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-secondary/20 to-transparent"})),shouldTruncate&&/*#__PURE__*/React.createElement("div",{className:"mt-2 flex items-center justify-end"},/*#__PURE__*/React.createElement("button",{type:"button",onClick:toggleExpand,className:"\n                inline-flex items-center gap-2 px-3 py-1.5 \n                rounded bg-secondary/80 \n                text-xs font-medium\n                transition-all duration-300\n                 hover:text-accent\n                hover:scale-105\n                z-10\n              ","aria-label":isExpanded?"less":"more"},/*#__PURE__*/React.createElement("span",null,isExpanded?"Show less":"Show more"),isExpanded?/*#__PURE__*/React.createElement(Minimize2,{size:14}):/*#__PURE__*/React.createElement(Maximize2,{size:14}))));})));const Modal=_ref4=>{let{isOpen,onClose,children,className=""}=_ref4;(0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(()=>{if(isOpen){document.body.style.overflow="hidden";const handleEscape=e=>{if(e.key==="Escape")onClose();};window.addEventListener("keydown",handleEscape);return()=>{document.body.style.overflow="";window.removeEventListener("keydown",handleEscape);};}},[isOpen,onClose]);if(!isOpen)return null;return/*#__PURE__*/(0,react_dom__WEBPACK_IMPORTED_MODULE_1__.createPortal)(/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"fixed inset-0 z-50","aria-modal":"true",role:"dialog",onClick:onClose},/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"absolute inset-0 bg-black/80 backdrop-blur-sm"}),/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"\n        relative z-10 \n        w-full h-full\n        flex items-center justify-center\n        "+className+"\n      "},children)),document.body);};const FullScreenImage=_ref5=>{let{src,alt,onClose,className=""}=_ref5;return/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Modal,{isOpen:true,onClose:onClose},/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("button",{onClick:e=>{e.stopPropagation();onClose();},className:"absolute top-4 right-4 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-all duration-300 hover:scale-105","aria-label":"Close fullscreen image"},/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A,{size:24})),/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"relative",onClick:e=>e.stopPropagation()},/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("img",{src:src,alt:alt,className:"\n            max-h-[90vh] max-w-[90vw] \n            object-contain rounded-lg \n            shadow-2xl\n            "+className+"\n          "})));};const ClickableImage=_ref6=>{let{src,alt,className="",expandedClassName=""}=_ref6;const{0:isFullScreen,1:setIsFullScreen}=(0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);return/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(react__WEBPACK_IMPORTED_MODULE_0__.Fragment,null,/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("img",{src:src,alt:alt,className:"\n          "+className+" \n          cursor-zoom-in \n          transition-all duration-300 \n          hover:brightness-110\n        ",onClick:()=>setIsFullScreen(true)}),isFullScreen&&/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(FullScreenImage,{src:src,alt:alt,className:expandedClassName,onClose:()=>setIsFullScreen(false)}));};// dateUtils.ts
function getRelativeTimeString(date){const now=new Date();const past=new Date(date);const diffInMs=now.getTime()-past.getTime();const diffInSeconds=Math.floor(diffInMs/1000);const diffInMinutes=Math.floor(diffInSeconds/60);const diffInHours=Math.floor(diffInMinutes/60);const diffInDays=Math.floor(diffInHours/24);const diffInMonths=Math.floor(diffInDays/30);const diffInYears=Math.floor(diffInDays/365);if(diffInSeconds<60){return"just now";}else if(diffInMinutes<60){return diffInMinutes+" "+(diffInMinutes===1?"minute":"minutes")+" ago";}else if(diffInHours<24){return diffInHours+" "+(diffInHours===1?"hour":"hours")+" ago";}else if(diffInDays<30){return diffInDays+" "+(diffInDays===1?"day":"days")+" ago";}else if(diffInMonths<12){return diffInMonths+" "+(diffInMonths===1?"month":"months")+" ago";}else{return diffInYears+" "+(diffInYears===1?"year":"years")+" ago";}}

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

/***/ 87677:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ ChevronRight; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const ChevronRight = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("ChevronRight", [
  ["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]
]);


//# sourceMappingURL=chevron-right.js.map


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


/***/ })

}]);
//# sourceMappingURL=component---src-pages-chat-detail-viewer-tsx-5f3065e16ca08ab5f480.js.map