"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[9028],{

/***/ 4990:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   OZ: function() { return /* binding */ convertToIPlanSteps; },
/* harmony export */   iQ: function() { return /* binding */ convertPlanStepsToJsonString; }
/* harmony export */ });
/* unused harmony exports emptyPlan, defaultPlan */
/**
 * Represents a single step in a plan
 *//**
 * Represents a complete plan with metadata
 *//**
 * Default empty plan
 */const emptyPlan={task:"",steps:[{title:"Loading Plan...",details:"",enabled:false,agent_name:""}]};/**
 * Default plan template with example steps
 */const defaultPlan={task:"Example task",steps:[{title:"Initiate Web Search",details:"Ask WebSurfer to perform a web search for relevant information.",enabled:true,agent_name:"WebSurfer"},{title:"Summarize Key Findings",details:"Request WebSurfer to summarize the top results or key information found.",enabled:true,agent_name:"WebSurfer"},{title:"Validate Information",details:"Ensure that the information gathered is from credible sources.",enabled:true,agent_name:"WebSurfer"}]};/**
 * Convert a JSON string to an array of IPlanStep objects
 */function convertToIPlanSteps(jsonString){try{const parsedArray=JSON.parse(jsonString);const stepsArray=Array.isArray(parsedArray)?parsedArray:[parsedArray];const planSteps=stepsArray.map(item=>({title:item.title||"Untitled Step",details:item.details||"",enabled:item.enabled!==undefined?item.enabled:true,agent_name:item.agent_name||""}));return planSteps;}catch(e){console.error("Failed to parse plan JSON:",e);return[];}}/**
 * Convert plan steps to a JSON string
 */function convertPlanStepsToJsonString(steps){if(!steps||!Array.isArray(steps)){console.error("Invalid steps array passed to convertPlanStepsToJsonString:",steps);return JSON.stringify([]);}const filteredSteps=steps.filter(step=>step.enabled!==false);const cleanedSteps=filteredSteps.map(_ref=>{let{title,details,agent_name}=_ref;return{title,details,agent_name};});return JSON.stringify(cleanedSteps);}

/***/ }),

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
/* harmony import */ var _utils_apiDatetime__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(51037);
const LoadingIndicator=_ref=>{let{size=16}=_ref;return(/*#__PURE__*/// 旋转加载图标
React.createElement("div",{className:"inline-flex items-center gap-2 text-accent   mr-2"},/*#__PURE__*/React.createElement(Loader2,{size:size,className:"animate-spin"})));};const LoadingDots=_ref2=>{let{size=8}=_ref2;// 三个点的加载动画
return/*#__PURE__*/React.createElement("span",{className:"inline-flex items-center gap-2"},/*#__PURE__*/React.createElement("span",{className:"bg-accent rounded-full animate-bounce",style:{width:size+"px",height:size+"px",animationDuration:"0.6s"}}),/*#__PURE__*/React.createElement("span",{className:"bg-accent rounded-full animate-bounce",style:{width:size+"px",height:size+"px",animationDuration:"0.6s",animationDelay:"0.2s"}}),/*#__PURE__*/React.createElement("span",{className:"bg-accent rounded-full animate-bounce",style:{width:size+"px",height:size+"px",animationDuration:"0.6s",animationDelay:"0.4s"}}));};const TruncatableText=/*#__PURE__*/(/* unused pure expression or super */ null && (memo(_ref3=>{let{content,isJson=false,className="",jsonThreshold=1000,textThreshold=500}=_ref3;const{0:isExpanded,1:setIsExpanded}=useState(false);const threshold=isJson?jsonThreshold:textThreshold;const shouldTruncate=content.length>threshold;const toggleExpand=()=>{setIsExpanded(!isExpanded);};const displayContent=shouldTruncate&&!isExpanded?content.slice(0,threshold)+"...":content;return/*#__PURE__*/React.createElement("div",{className:"relative"},/*#__PURE__*/React.createElement("div",{className:"\n            transition-[max-height,opacity] duration-500 ease-in-out\n            "+(shouldTruncate&&!isExpanded?"max-h-[300px]":"max-h-[10000px]")+"\n            "+className+"\n          "},displayContent,shouldTruncate&&!isExpanded&&/*#__PURE__*/React.createElement("div",{className:"absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-secondary/20 to-transparent"})),shouldTruncate&&/*#__PURE__*/React.createElement("div",{className:"mt-2 flex items-center justify-end"},/*#__PURE__*/React.createElement("button",{type:"button",onClick:toggleExpand,className:"\n                inline-flex items-center gap-2 px-3 py-1.5 \n                rounded bg-secondary/80 \n                text-xs font-medium\n                transition-all duration-300\n                 hover:text-accent\n                hover:scale-105\n                z-10\n              ","aria-label":isExpanded?"less":"more"},/*#__PURE__*/React.createElement("span",null,isExpanded?"Show less":"Show more"),isExpanded?/*#__PURE__*/React.createElement(Minimize2,{size:14}):/*#__PURE__*/React.createElement(Maximize2,{size:14}))));})));const Modal=_ref4=>{let{isOpen,onClose,children,className=""}=_ref4;(0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(()=>{if(isOpen){document.body.style.overflow="hidden";const handleEscape=e=>{if(e.key==="Escape")onClose();};window.addEventListener("keydown",handleEscape);return()=>{document.body.style.overflow="";window.removeEventListener("keydown",handleEscape);};}},[isOpen,onClose]);if(!isOpen)return null;return/*#__PURE__*/(0,react_dom__WEBPACK_IMPORTED_MODULE_1__.createPortal)(/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"fixed inset-0 z-50","aria-modal":"true",role:"dialog",onClick:onClose},/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"absolute inset-0 bg-black/80 backdrop-blur-sm"}),/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"\n        relative z-10 \n        w-full h-full\n        flex items-center justify-center\n        "+className+"\n      "},children)),document.body);};const FullScreenImage=_ref5=>{let{src,alt,onClose,className=""}=_ref5;return/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(Modal,{isOpen:true,onClose:onClose},/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("button",{onClick:e=>{e.stopPropagation();onClose();},className:"absolute top-4 right-4 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-all duration-300 hover:scale-105","aria-label":"Close fullscreen image"},/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A,{size:24})),/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div",{className:"relative",onClick:e=>e.stopPropagation()},/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("img",{src:src,alt:alt,className:"\n            max-h-[90vh] max-w-[90vw] \n            object-contain rounded-lg \n            shadow-2xl\n            "+className+"\n          "})));};const ClickableImage=_ref6=>{let{src,alt,className="",expandedClassName=""}=_ref6;const{0:isFullScreen,1:setIsFullScreen}=(0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);return/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(react__WEBPACK_IMPORTED_MODULE_0__.Fragment,null,/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("img",{src:src,alt:alt,className:"\n          "+className+" \n          cursor-zoom-in \n          transition-all duration-300 \n          hover:brightness-110\n        ",onClick:()=>setIsFullScreen(true)}),isFullScreen&&/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(FullScreenImage,{src:src,alt:alt,className:expandedClassName,onClose:()=>setIsFullScreen(false)}));};// dateUtils.ts — API ISO strings without timezone are parsed as UTC (see apiDatetime).
function getRelativeTimeString(date){const now=new Date();let past;if(typeof date==="string"){var _parseApiDateAsUtc;past=(_parseApiDateAsUtc=(0,_utils_apiDatetime__WEBPACK_IMPORTED_MODULE_3__/* .parseApiDateAsUtc */ .Y4)(date))!==null&&_parseApiDateAsUtc!==void 0?_parseApiDateAsUtc:new Date(date);}else if(typeof date==="number"){const ms=date>1e12?date:date*1000;past=new Date(ms);}else{past=date;}const diffInMs=now.getTime()-past.getTime();const diffInSeconds=Math.floor(diffInMs/1000);const diffInMinutes=Math.floor(diffInSeconds/60);const diffInHours=Math.floor(diffInMinutes/60);const diffInDays=Math.floor(diffInHours/24);const diffInMonths=Math.floor(diffInDays/30);const diffInYears=Math.floor(diffInDays/365);if(diffInSeconds<60){return"just now";}else if(diffInMinutes<60){return diffInMinutes+" "+(diffInMinutes===1?"minute":"minutes")+" ago";}else if(diffInHours<24){return diffInHours+" "+(diffInHours===1?"hour":"hours")+" ago";}else if(diffInDays<30){return diffInDays+" "+(diffInDays===1?"day":"days")+" ago";}else if(diffInMonths<12){return diffInMonths+" "+(diffInMonths===1?"month":"months")+" ago";}else{return diffInYears+" "+(diffInYears===1?"year":"years")+" ago";}}

/***/ }),

/***/ 66930:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  RenderMessage: function() { return /* binding */ RenderMessage; },
  "default": function() { return /* binding */ rendermessage; },
  messageUtils: function() { return /* binding */ messageUtils; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/triangle-alert.js
var triangle_alert = __webpack_require__(418);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/circle-check-big.js
var circle_check_big = __webpack_require__(44471);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/refresh-cw.js
var refresh_cw = __webpack_require__(15977);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/clock.js
var clock = __webpack_require__(27235);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/earth.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Earth = (0,createLucideIcon/* default */.A)("Earth", [
  ["path", { d: "M21.54 15H17a2 2 0 0 0-2 2v4.54", key: "1djwo0" }],
  [
    "path",
    {
      d: "M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17",
      key: "1tzkfa"
    }
  ],
  ["path", { d: "M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05", key: "14pb5j" }],
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]
]);


//# sourceMappingURL=earth.js.map

;// ./node_modules/lucide-react/dist/esm/icons/terminal.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Terminal = (0,createLucideIcon/* default */.A)("Terminal", [
  ["polyline", { points: "4 17 10 11 4 5", key: "akl6gq" }],
  ["line", { x1: "12", x2: "20", y1: "19", y2: "19", key: "q2wloq" }]
]);


//# sourceMappingURL=terminal.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/chevron-down.js
var chevron_down = __webpack_require__(75107);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/chevron-right.js
var chevron_right = __webpack_require__(87677);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/image.js
var icons_image = __webpack_require__(59612);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/send.js
var send = __webpack_require__(27775);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/x.js
var x = __webpack_require__(48697);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/check.js
var check = __webpack_require__(45773);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/copy.js
var copy = __webpack_require__(35404);
;// ./node_modules/lucide-react/dist/esm/icons/square-pen.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const SquarePen = (0,createLucideIcon/* default */.A)("SquarePen", [
  ["path", { d: "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7", key: "1m0v6g" }],
  [
    "path",
    {
      d: "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",
      key: "ohrbg2"
    }
  ]
]);


//# sourceMappingURL=square-pen.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/bot.js
var bot = __webpack_require__(42640);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/settings.js
var settings = __webpack_require__(80964);
// EXTERNAL MODULE: ./src/components/views/atoms.tsx
var atoms = __webpack_require__(96880);
// EXTERNAL MODULE: ./src/components/common/markdownrender.tsx + 213 modules
var markdownrender = __webpack_require__(57256);
// EXTERNAL MODULE: ./src/pages/chat/plan.tsx + 3 modules
var plan = __webpack_require__(75860);
// EXTERNAL MODULE: ./src/components/types/plan.ts
var types_plan = __webpack_require__(4990);
// EXTERNAL MODULE: ./node_modules/core-js/modules/es.promise.finally.js
var es_promise_finally = __webpack_require__(9391);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/code.js
var code = __webpack_require__(93164);
;// ./node_modules/lucide-react/dist/esm/icons/file.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const File = (0,createLucideIcon/* default */.A)("File", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }]
]);


//# sourceMappingURL=file.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/download.js
var download = __webpack_require__(48309);
// EXTERNAL MODULE: ./src/components/utils.ts
var utils = __webpack_require__(70870);
;// ./src/components/common/filerenderer.tsx
// Types
// File type to icon mapping
const FILE_ICONS={image:icons_image/* default */.A,code:code/* default */.A,text:file_text/* default */.A,pdf:File,unknown:File};// Add a mapping of file extensions to file types
const FILE_EXTENSIONS_MAP={// Images
jpg:"image",jpeg:"image",png:"image",gif:"image",svg:"image",webp:"image",// Code
js:"code",jsx:"code",ts:"code",tsx:"code",py:"code",java:"code",c:"code",cpp:"code",cs:"code",go:"code",rb:"code",php:"code",html:"code",css:"code",scss:"code",json:"code",xml:"code",yaml:"code",yml:"code",// Text
txt:"text",md:"text",markdown:"text",csv:"text",log:"text",// PDF
pdf:"pdf"};// Modal component for displaying file content
const FileModal=_ref=>{let{isOpen,onClose,file,content}=_ref;const{0:isFullScreen,1:setIsFullScreen}=(0,react.useState)(false);const modalRef=react.useRef(null);const{0:downloadUrl,1:setDownloadUrl}=(0,react.useState)(null);const{0:isLoading,1:setIsLoading}=(0,react.useState)(false);const{0:processedContent,1:setProcessedContent}=(0,react.useState)(null);(0,react.useEffect)(()=>{// Add escape key handler
const handleEscKey=event=>{if(event.key==="Escape"){onClose();}};// Add the event listener when the modal is open
if(isOpen){document.addEventListener("keydown",handleEscKey);}// Clean up the event listener
return()=>{document.removeEventListener("keydown",handleEscKey);};},[isOpen,onClose]);(0,react.useEffect)(()=>{if(file){const fileUrl=(0,utils/* getServerUrl */.Tt)().replace("/api","")+("/"+(file.short_path||file.path||file.name));setDownloadUrl(fileUrl);}else{setDownloadUrl(null);}},[file,content]);// Process content in a non-blocking way
(0,react.useEffect)(()=>{if(!content||!file){setProcessedContent(null);return;}setIsLoading(true);try{let finalContent=content;// Only process text/code files
if(file.type==="text"||file.type==="code"){// For very large files, we truncate early to prevent processing overhead
const maxLength=5000;// 5000 characters
if(content.length>maxLength){// Only process the first chunk to avoid unnecessary string operations
finalContent=content.slice(0,maxLength)+"\n\n... Content truncated. File is too large to display completely. Please download the file to view all content ...";}}setProcessedContent(finalContent);}catch(error){console.error("Error processing file content:",error);setProcessedContent("Error processing file content. The file may be too large to display.");}finally{setIsLoading(false);}},[content,file]);if(!isOpen||!file)return null;const toggleFullScreen=()=>{setIsFullScreen(!isFullScreen);};// Handle click outside the modal content
const handleBackdropClick=e=>{if(e.target===e.currentTarget){onClose();}};const renderContent=()=>{// Show loading state
if(isLoading){return/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center justify-center h-64"},/*#__PURE__*/react.createElement("div",{className:"animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"}),/*#__PURE__*/react.createElement("p",{className:"mt-4 text-gray-600"},"Loading file content..."));}// If file is an image, display the image
if(file.type==="image"){return/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center"},/*#__PURE__*/react.createElement(atoms/* ClickableImage */.wx,{src:content||"",alt:file.name,className:"max-w-full max-h-[70vh] object-contain"}));}// For text or code files, render content with markdown
else if(file.type==="text"||file.type==="code"){return/*#__PURE__*/react.createElement("div",{className:"flex flex-col"},isLoading?/*#__PURE__*/react.createElement("div",{className:"flex flex-col items-center justify-center h-64"},/*#__PURE__*/react.createElement("div",{className:"animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"}),/*#__PURE__*/react.createElement("p",{className:"mt-4 text-gray-600"},"Processing large file...")):processedContent===null?/*#__PURE__*/react.createElement("div",{className:"p-4 text-gray-500"},"No content available"):/*#__PURE__*/react.createElement(markdownrender/* default */.A,{content:processedContent,fileExtension:file.extension}));}// For PDF files, use an iframe with the direct URL
else if(file.type==="pdf"){return/*#__PURE__*/react.createElement("div",{className:"flex flex-col"},/*#__PURE__*/react.createElement("iframe",{src:content||"",title:file.name,className:"w-full h-[70vh]",frameBorder:"0"}));}// For unknown file types, show a message
return/*#__PURE__*/react.createElement("div",{className:"p-4 text-center"},/*#__PURE__*/react.createElement("p",null,"Unable to preview this file type."),/*#__PURE__*/react.createElement("p",null,"Filename: ",file.name));};return/*#__PURE__*/react.createElement("div",{className:"fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50",onClick:handleBackdropClick},/*#__PURE__*/react.createElement("div",{ref:modalRef,className:"bg-white rounded-lg shadow-lg overflow-hidden "+(isFullScreen?"fixed inset-0":"max-w-4xl w-full max-h-[85vh]")},/*#__PURE__*/react.createElement("div",{className:"flex justify-between items-center p-4 border-b"},/*#__PURE__*/react.createElement("h3",{className:"text-lg font-medium text-black"},file.name),/*#__PURE__*/react.createElement("div",{className:"flex gap-2"},downloadUrl&&/*#__PURE__*/react.createElement("a",{href:downloadUrl,download:file.name,className:"p-1 rounded-full hover:bg-gray-200 text-black flex items-center justify-center",title:"Download file",onClick:e=>e.stopPropagation()},/*#__PURE__*/react.createElement(download/* default */.A,{size:18})),/*#__PURE__*/react.createElement("button",{onClick:onClose,className:"p-1 rounded-full hover:bg-gray-200 text-black",title:"Close"},/*#__PURE__*/react.createElement(x/* default */.A,{size:18})))),/*#__PURE__*/react.createElement("div",{className:"p-4 overflow-auto text-black "+(isFullScreen?"h-[calc(90vh-64px)]":"max-h-[70vh]")},renderContent())));};// ImageThumbnail component to display image previews
const ImageThumbnail=/*#__PURE__*/(0,react.memo)(_ref2=>{let{file}=_ref2;const{0:thumbnailUrl,1:setThumbnailUrl}=(0,react.useState)("");const{0:isLoading,1:setIsLoading}=(0,react.useState)(true);const{0:hasError,1:setHasError}=(0,react.useState)(false);(0,react.useEffect)(()=>{const loadThumbnail=async()=>{try{setIsLoading(true);const fileUrl=(0,utils/* getServerUrl */.Tt)().replace("/api","")+("/"+(file.short_path||file.path||file.name));setThumbnailUrl(fileUrl);setIsLoading(false);}catch(error){console.error("Failed to load thumbnail:",error);setHasError(true);setIsLoading(false);}};if(file.type==="image"){loadThumbnail();}},[file]);if(isLoading){return/*#__PURE__*/react.createElement("div",{className:"w-full h-20 flex items-center justify-center bg-gray-50"},/*#__PURE__*/react.createElement("div",{className:"animate-pulse bg-gray-200 w-8 h-8 rounded"}));}if(hasError){return/*#__PURE__*/react.createElement("div",{className:"w-full h-20 flex items-center justify-center bg-gray-50"},/*#__PURE__*/react.createElement(icons_image/* default */.A,{className:"w-8 h-8 text-blue-500"}));}return/*#__PURE__*/react.createElement("div",{className:"w-full h-20 bg-gray-50 flex items-center justify-center overflow-hidden"},/*#__PURE__*/react.createElement("img",{src:thumbnailUrl,alt:file.name,className:"w-full h-full object-contain",onError:()=>setHasError(true)}));});ImageThumbnail.displayName="ImageThumbnail";// Add this new component for the download button
const DownloadButton=/*#__PURE__*/(0,react.memo)(_ref3=>{let{file}=_ref3;const handleDownload=e=>{e.stopPropagation();// Prevent opening the modal
const fileUrl=(0,utils/* getServerUrl */.Tt)().replace("/api","")+("/"+(file.short_path||file.path||file.name));// Create a temporary anchor element
const link=document.createElement("a");link.href=fileUrl;link.download=file.name;// Set the download filename
link.target="_blank";// Open in new tab to prevent page navigation
document.body.appendChild(link);link.click();document.body.removeChild(link);};return/*#__PURE__*/react.createElement("button",{onClick:handleDownload,className:"absolute top-2 right-2 p-1.5 rounded-full bg-white/90 hover:bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200",title:"Download file"},/*#__PURE__*/react.createElement(download/* default */.A,{size:16,className:"text-gray-700"}));});DownloadButton.displayName="DownloadButton";// Update the FileCard component
const FileCard=/*#__PURE__*/(0,react.memo)(_ref4=>{let{file,onFileClick}=_ref4;const IconComponent=FILE_ICONS[file.type]||FILE_ICONS.unknown;if(file.type==="image"){return/*#__PURE__*/react.createElement("div",{className:"group relative flex flex-col overflow-hidden rounded-lg border border-gray-200 hover:border-blue-500 shadow-sm hover:shadow-md cursor-pointer transition-all",onClick:()=>onFileClick(file)},/*#__PURE__*/react.createElement(ImageThumbnail,{file:file}),/*#__PURE__*/react.createElement("div",{className:"p-2 bg-white border-t w-full"},/*#__PURE__*/react.createElement("span",{className:"text-xs truncate w-full block",title:file.name},file.name)),/*#__PURE__*/react.createElement(DownloadButton,{file:file}));}return/*#__PURE__*/react.createElement("div",{className:"group relative flex flex-col items-center p-3 rounded-lg border border-gray-200 hover:border-blue-500 cursor-pointer transition-colors shadow-sm hover:shadow-md",onClick:()=>onFileClick(file)},/*#__PURE__*/react.createElement(IconComponent,{className:"w-8 h-8 mb-2 text-blue-500"}),/*#__PURE__*/react.createElement("span",{className:"text-xs text-center truncate w-full",title:file.name},file.name),/*#__PURE__*/react.createElement(DownloadButton,{file:file}));});FileCard.displayName="FileCard";// Main RenderFile component
const RenderFile=_ref5=>{var _message$metadata3;let{message}=_ref5;const{0:files,1:setFiles}=(0,react.useState)([]);const{0:selectedFile,1:setSelectedFile}=(0,react.useState)(null);const{0:fileContent,1:setFileContent}=(0,react.useState)(null);const{0:isModalOpen,1:setIsModalOpen}=(0,react.useState)(false);(0,react.useEffect)(()=>{var _message$metadata,_message$metadata2;// Extract file information from the message metadata
if((message===null||message===void 0?void 0:(_message$metadata=message.metadata)===null||_message$metadata===void 0?void 0:_message$metadata.type)==="file"&&message!==null&&message!==void 0&&(_message$metadata2=message.metadata)!==null&&_message$metadata2!==void 0&&_message$metadata2.files){try{const parsedFiles=JSON.parse(message.metadata.files);// Process files to ensure correct type detection
const processedFiles=Array.isArray(parsedFiles)?parsedFiles.map(file=>{var _file$extension;// If the file already has a valid type, keep it
if(["image","code","text","pdf"].includes(file.type)){return file;}// Otherwise, try to determine type from extension
const extension=((_file$extension=file.extension)===null||_file$extension===void 0?void 0:_file$extension.toLowerCase())||"";const detectedType=FILE_EXTENSIONS_MAP[extension]||"unknown";return Object.assign({},file,{type:detectedType});}):[];setFiles(processedFiles);}catch(error){console.error("Failed to parse files:",error);setFiles([]);}}},[message]);const handleFileClick=file=>{setSelectedFile(file);setIsModalOpen(true);setFileContent(null);// Reset content before loading new file
// Construct the proper URL path for web access
const fileUrl=(0,utils/* getServerUrl */.Tt)().replace("/api","")+("/"+(file.short_path||file.path||file.name));// For images and PDFs, just use the URL directly
if(file.type==="image"||file.type==="pdf"){setFileContent(fileUrl);return;}// For text/code files, fetch asynchronously without blocking
if(file.type==="text"||file.type==="code"){const controller=new AbortController();const timeoutId=setTimeout(()=>controller.abort(),2000);// 2 second timeout
fetch(fileUrl,{signal:controller.signal}).then(response=>{if(!response.ok){throw new Error("HTTP error! status: "+response.status);}return response.text();}).then(text=>{setFileContent(text);}).catch(error=>{if(error.name==="AbortError"){console.error("Request timed out");setFileContent("Error: Request timed out. The file may be too large or the server is not responding.");}else{console.error("Failed to load file content:",error);setFileContent("Error loading file: "+error.message);}}).finally(()=>{clearTimeout(timeoutId);});}else{// For other file types, use the URL
setFileContent(fileUrl);}};const closeModal=()=>{setIsModalOpen(false);setSelectedFile(null);setFileContent(null);};// If no files or not a file message, return null
if(!files.length||(message===null||message===void 0?void 0:(_message$metadata3=message.metadata)===null||_message$metadata3===void 0?void 0:_message$metadata3.type)!=="file"){return null;}return/*#__PURE__*/react.createElement("div",{className:"mt-4"},/*#__PURE__*/react.createElement("div",{className:"grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2"},files.map((file,index)=>/*#__PURE__*/react.createElement(FileCard,{key:index,file:file,onFileClick:handleFileClick}))),/*#__PURE__*/react.createElement(FileModal,{isOpen:isModalOpen,onClose:closeModal,file:selectedFile,content:fileContent}));};// Add window.fs typings
/* harmony default export */ var filerenderer = (RenderFile);
// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var tooltip = __webpack_require__(40367);
// EXTERNAL MODULE: ./node_modules/antd/es/spin/index.js + 6 modules
var spin = __webpack_require__(34716);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
;// ./node_modules/@heroicons/react/24/outline/esm/CheckCircleIcon.js

function CheckCircleIcon({
  title,
  titleId,
  ...props
}, svgRef) {
  return /*#__PURE__*/react.createElement("svg", Object.assign({
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.5,
    stroke: "currentColor",
    "aria-hidden": "true",
    "data-slot": "icon",
    ref: svgRef,
    "aria-labelledby": titleId
  }, props), title ? /*#__PURE__*/react.createElement("title", {
    id: titleId
  }, title) : null, /*#__PURE__*/react.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    d: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
  }));
}
const ForwardRef = /*#__PURE__*/ react.forwardRef(CheckCircleIcon);
/* harmony default export */ var esm_CheckCircleIcon = (ForwardRef);
;// ./node_modules/@heroicons/react/24/outline/esm/LightBulbIcon.js

function LightBulbIcon({
  title,
  titleId,
  ...props
}, svgRef) {
  return /*#__PURE__*/react.createElement("svg", Object.assign({
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.5,
    stroke: "currentColor",
    "aria-hidden": "true",
    "data-slot": "icon",
    ref: svgRef,
    "aria-labelledby": titleId
  }, props), title ? /*#__PURE__*/react.createElement("title", {
    id: titleId
  }, title) : null, /*#__PURE__*/react.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    d: "M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
  }));
}
const LightBulbIcon_ForwardRef = /*#__PURE__*/ react.forwardRef(LightBulbIcon);
/* harmony default export */ var esm_LightBulbIcon = (LightBulbIcon_ForwardRef);
;// ./src/components/features/Plans/LearnPlanButton.tsx
const LearnPlanButton=_ref=>{let{sessionId,messageId,userId,onSuccess}=_ref;const{0:isLearning,1:setIsLearning}=(0,react.useState)(false);const{0:isLearned,1:setIsLearned}=(0,react.useState)(false);const{0:error,1:setError}=(0,react.useState)(null);const{user,darkMode}=(0,react.useContext)(provider/* appContext */.v);const planAPI=new api/* PlanAPI */.og();const effectiveUserId=userId||(user===null||user===void 0?void 0:user.email);react.useEffect(()=>{if(messageId!==-1){const learnedPlans=JSON.parse(localStorage.getItem("learned_plans")||"{}");if(learnedPlans[sessionId+"-"+messageId]){setIsLearned(true);}}},[sessionId,messageId]);const handleLearnPlan=async()=>{if(!sessionId||!effectiveUserId){message/* default */.Ay.error("Missing session or user information");return;}try{setIsLearning(true);setError(null);message/* default */.Ay.loading({content:"Creating plan from conversation...",key:"learnPlan"});const response=await planAPI.learnPlan(sessionId,effectiveUserId);if(response&&response.status){var _response$data;message/* default */.Ay.success({content:"Plan created successfully!",key:"learnPlan",duration:2});if(onSuccess&&(_response$data=response.data)!==null&&_response$data!==void 0&&_response$data.id){onSuccess(response.data.id);}// Mark as learned when successful
setIsLearned(true);const learnedPlans=JSON.parse(localStorage.getItem("learned_plans")||"{}");learnedPlans[sessionId+"-"+messageId]=true;localStorage.setItem("learned_plans",JSON.stringify(learnedPlans));}else{throw new Error((response===null||response===void 0?void 0:response.message)||"Failed to create plan");}}catch(error){console.error("Error creating plan:",error);setError(error instanceof Error?error.message:"Unknown error");message/* default */.Ay.error({content:"Failed to create plan: "+(error instanceof Error?error.message:"Unknown error"),key:"learnPlan"});}finally{setIsLearning(false);}};// If already learned, show success message
if(isLearned){return/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"This plan has been saved to your library"},/*#__PURE__*/react.createElement("div",{className:"inline-flex items-center px-3 py-1.5 rounded-md "+(darkMode==="dark"?"bg-green-900/30 text-green-400 border border-green-700":"bg-green-100 text-green-700 border border-green-200")},/*#__PURE__*/react.createElement(esm_CheckCircleIcon,{className:"h-4 w-4 mr-1.5"}),/*#__PURE__*/react.createElement("span",{className:"text-sm font-medium"},"Plan Learned")));}// If learning, show spinner
if(isLearning){return/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"Creating a plan from this conversation"},/*#__PURE__*/react.createElement("button",{disabled:true,className:"inline-flex items-center px-3 py-1.5 rounded-md transition-colors "+(darkMode==="dark"?"bg-blue-800/30 text-blue-400 border border-blue-700":"bg-blue-100 text-blue-800 border border-blue-200")+" cursor-wait"},/*#__PURE__*/react.createElement(spin/* default */.A,{size:"small",className:"mr-2"}),/*#__PURE__*/react.createElement("span",{className:"text-sm font-medium"},"Learning Plan...")));}// Default state - ready to learn
return/*#__PURE__*/react.createElement(tooltip/* default */.A,{title:"Learn a reusable plan from this conversation and save it to your library"},/*#__PURE__*/react.createElement("button",{onClick:handleLearnPlan,disabled:!sessionId||!effectiveUserId,className:"inline-flex items-center px-3 py-1.5 rounded-md transition-colors "+(darkMode==="dark"?"bg-blue-700/20 text-blue-400 border border-blue-400/50 hover:bg-blue-700/30 hover:border-blue-700":"bg-blue-400 text-blue-800 border border-blue-200 hover:bg-blue-100 hover:border-blue-300")+" "+(!sessionId||!effectiveUserId?"opacity-50 cursor-not-allowed":"cursor-pointer")},/*#__PURE__*/react.createElement(esm_LightBulbIcon,{className:"h-4 w-4 mr-1.5 "+(darkMode==="dark"?"text-blue-400":"text-blue-800")}),/*#__PURE__*/react.createElement("span",{className:"text-sm font-medium"},"Learn Plan")));};/* harmony default export */ var Plans_LearnPlanButton = (LearnPlanButton);
;// ./src/pages/chat/rendermessage.tsx










// Types

// Helper functions
const getImageSource = item => {
  if (item.url) return item.url;
  if (item.data) return "data:image/png;base64," + item.data;
  return "/api/placeholder/400/320";
};
const stringifyForDisplay = value => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (_unused) {
    return String(value);
  }
};
const getStepIcon = (status, runStatus, is_step_repeated, is_step_failed) => {
  if (is_step_failed) return /*#__PURE__*/react.createElement(triangle_alert/* default */.A, {
    size: 16,
    className: "text-magenta-800"
  });
  if (is_step_repeated) return /*#__PURE__*/react.createElement(triangle_alert/* default */.A, {
    size: 16,
    className: "text-magenta-800"
  });
  if (status === "completed") return /*#__PURE__*/react.createElement(circle_check_big/* default */.A, {
    size: 16,
    className: "text-magenta-800"
  });
  if (status === "current" && runStatus === "active") return /*#__PURE__*/react.createElement(refresh_cw/* default */.A, {
    size: 16,
    className: "text-magenta-800 animate-spin"
  });
  if (status === "upcoming") return /*#__PURE__*/react.createElement(clock/* default */.A, {
    size: 16,
    className: "text-gray-400"
  });
  if (status === "failed") return /*#__PURE__*/react.createElement(triangle_alert/* default */.A, {
    size: 16,
    className: "text-magenta-500"
  });
  return null;
};
const parseUserContent = content => {
  const message_content = content.content;
  if (Array.isArray(message_content)) {
    return {
      text: message_content,
      metadata: content.metadata
    };
  }

  // If content is not a string, convert it to string
  if (typeof message_content !== "string") {
    return {
      text: stringifyForDisplay(message_content),
      metadata: content.metadata
    };
  }
  try {
    const parsedContent = JSON.parse(message_content);

    // Handle case where content is in content field
    if (parsedContent.content) {
      // If parsedContent.content is an object, extract text from it
      // Otherwise, use it directly (it's already a string or array)
      let text;
      if (typeof parsedContent.content === "object" && parsedContent.content !== null && !Array.isArray(parsedContent.content)) {
        // Object: try to extract content/text field, or stringify if not found
        text = parsedContent.content.content || parsedContent.content.text || JSON.stringify(parsedContent.content);
      } else {
        // String or array: use directly
        text = parsedContent.content;
      }
      // If text is an array, it might contain images
      if (Array.isArray(text)) {
        return {
          text,
          metadata: content.metadata
        };
      }
      return {
        text,
        metadata: content.metadata
      };
    }

    // Handle case where plan exists
    let planSteps = [];
    if (parsedContent.plan && typeof parsedContent.plan === "string") {
      try {
        planSteps = (0,types_plan/* convertToIPlanSteps */.OZ)(parsedContent.plan);
      } catch (e) {
        console.error("Failed to parse plan:", e);
        planSteps = [];
      }
    }

    // Return both the content and plan if they exist
    // Ensure text is always a string
    let textValue;
    if (parsedContent.content) {
      if (typeof parsedContent.content === "string") {
        textValue = parsedContent.content;
      } else if (Array.isArray(parsedContent.content)) {
        textValue = parsedContent.content;
      } else if (typeof parsedContent.content === "object") {
        // If it's an object, try to extract text or stringify
        textValue = parsedContent.content.content || parsedContent.content.text || JSON.stringify(parsedContent.content);
      } else {
        textValue = stringifyForDisplay(parsedContent.content);
      }
    } else {
      // Fallback to original content, ensuring it's a string
      textValue = typeof message_content === "string" ? message_content : stringifyForDisplay(message_content);
    }
    return {
      text: textValue,
      plan: planSteps.length > 0 ? planSteps : undefined,
      metadata: content.metadata
    };
  } catch (e) {
    // If JSON parsing fails, return original content
    return {
      text: message_content,
      metadata: content.metadata
    };
  }
};
const parseContent = content => {
  if (typeof content !== "string") return stringifyForDisplay(content);
  try {
    const parsedContent = JSON.parse(content);
    // If parsedContent has a content field
    if (parsedContent.content !== undefined) {
      // If content is an object, extract text from it
      if (typeof parsedContent.content === "object" && parsedContent.content !== null && !Array.isArray(parsedContent.content)) {
        return parsedContent.content.content || parsedContent.content.text || JSON.stringify(parsedContent.content);
      }
      // Otherwise, use content directly (string or array)
      return typeof parsedContent.content === "string" ? parsedContent.content : stringifyForDisplay(parsedContent.content);
    }
    // If no content field, return original content
    return content;
  } catch (_unused2) {
    return content;
  }
};
const parseorchestratorContent = (content, metadata) => {
  if (messageUtils.isFinalAnswer(metadata)) {
    const prefix = "Final Answer:";
    return {
      type: "final-answer",
      content: content.startsWith(prefix) ? content.substring(prefix.length).trim() : content
    };
  }
  try {
    const parsedContent = JSON.parse(content);
    if (messageUtils.isPlanMessage(metadata)) {
      return {
        type: "plan",
        content: parsedContent
      };
    }
    if (messageUtils.isStepExecution(metadata)) {
      return {
        type: "step-execution",
        content: parsedContent
      };
    }
  } catch (_unused3) {}
  return {
    type: "default",
    content
  };
};
const RenderMultiModalBrowserStep = /*#__PURE__*/(0,react.memo)(_ref => {
  let {
    content,
    onImageClick
  } = _ref;
  return /*#__PURE__*/react.createElement("div", {
    className: "text-sm"
  }, content.map((item, index) => {
    if (typeof item !== "string") return null;
    const hasNextImage = index < content.length - 1 && typeof content[index + 1] === "object";
    return /*#__PURE__*/react.createElement("div", {
      key: index,
      className: "relative pl-4"
    }, /*#__PURE__*/react.createElement("div", {
      className: "absolute top-0 bottom-0 left-0 w-2 border-l-[2px] border-b-[2px] rounded-bl-lg",
      style: {
        borderColor: "var(--color-border-secondary)"
      }
    }), /*#__PURE__*/react.createElement("div", {
      className: "flex items-center h-full"
    }, hasNextImage && /*#__PURE__*/react.createElement("div", {
      className: "flex-shrink-0 mr-1 -ml-1 mt-2"
    }, /*#__PURE__*/react.createElement(Earth, {
      size: 16,
      className: "text-magenta-800 hover:text-magenta-900 cursor-pointer",
      onClick: () => onImageClick === null || onImageClick === void 0 ? void 0 : onImageClick(index)
    })), /*#__PURE__*/react.createElement("div", {
      className: "flex-1 cursor-pointer mt-2",
      onClick: () => onImageClick === null || onImageClick === void 0 ? void 0 : onImageClick(index)
    }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
      content: item,
      indented: true
    }))));
  }));
});
const RenderMultiModal = /*#__PURE__*/(0,react.memo)(_ref2 => {
  let {
    content
  } = _ref2;
  return /*#__PURE__*/react.createElement("div", {
    className: "space-y-2 text-sm"
  }, content.map((item, index) => /*#__PURE__*/react.createElement("div", {
    key: index
  }, typeof item === "string" ? /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: item,
    indented: true
  }) : /*#__PURE__*/react.createElement(atoms/* ClickableImage */.wx, {
    src: getImageSource(item),
    alt: "Content " + index,
    className: "max-w-[400px]  max-h-[30vh] rounded-lg"
  }))));
});
const RenderToolCall = /*#__PURE__*/(0,react.memo)(_ref3 => {
  let {
    content
  } = _ref3;
  return /*#__PURE__*/react.createElement("div", {
    className: "space-y-2 text-sm"
  }, content.map(call => /*#__PURE__*/react.createElement("div", {
    key: call.id,
    className: "border border-secondary rounded p-2"
  }, /*#__PURE__*/react.createElement("div", {
    className: "font-medium"
  }, "Function: ", call.name), /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: JSON.stringify(JSON.parse(call.arguments), null, 2),
    indented: true
  }))));
});
const RenderToolResult = /*#__PURE__*/(0,react.memo)(_ref4 => {
  let {
    content
  } = _ref4;
  const {
    0: expandedResults,
    1: setExpandedResults
  } = (0,react.useState)({});
  const toggleExpand = callId => {
    setExpandedResults(prev => Object.assign({}, prev, {
      [callId]: !prev[callId]
    }));
  };
  return /*#__PURE__*/react.createElement("div", {
    className: "space-y-2 text-sm"
  }, content.map(result => {
    const isExpanded = expandedResults[result.call_id];
    const displayContent = isExpanded ? result.content : result.content.slice(0, 100) + (result.content.length > 100 ? "..." : "");
    return /*#__PURE__*/react.createElement("div", {
      key: result.call_id,
      className: "rounded p-2"
    }, /*#__PURE__*/react.createElement("div", {
      className: "font-medium"
    }, "Result ID: ", result.call_id), /*#__PURE__*/react.createElement("div", {
      className: "cursor-pointer hover:bg-secondary/50 rounded p-1",
      onClick: () => toggleExpand(result.call_id)
    }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
      content: displayContent,
      indented: true
    }), result.content.length > 100 && /*#__PURE__*/react.createElement("div", {
      className: "text-xs text-gray-500 mt-1"
    }, isExpanded ? "Click to minimize" : "Click to expand")));
  }));
});
const RenderToolCallSummaryCard = /*#__PURE__*/(0,react.memo)(_ref5 => {
  let {
    content,
    defaultCollapsed = true
  } = _ref5;
  const {
    0: expanded,
    1: setExpanded
  } = (0,react.useState)(!defaultCollapsed);
  const trimmed = (content || "").trim();
  return /*#__PURE__*/react.createElement("div", {
    className: "rounded-lg bg-gradient-to-br from-violet-500/12 via-purple-500/8 to-fuchsia-500/[0.06] pl-2.5 pr-2  backdrop-blur-[2px] dark:from-violet-400/16 dark:via-purple-500/11 dark:to-fuchsia-500/8"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    className: "group w-full flex items-center gap-2 text-left min-w-0 rounded-md py-0.5 transition-colors ",
    onClick: e => {
      e.stopPropagation();
      setExpanded(v => !v);
    },
    "aria-expanded": expanded
  }, /*#__PURE__*/react.createElement(Terminal, {
    size: 14,
    className: "shrink-0 text-violet-600/75 opacity-90 group-hover:opacity-100 dark:text-violet-300/80 transition-opacity",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-xs font-medium text-violet-900/75 truncate flex-1 min-w-0 dark:text-violet-100/80"
  }, "Tool result")), expanded ? /*#__PURE__*/react.createElement("div", {
    className: "mt-2 pt-2 border-t border-violet-400/25 dark:border-violet-500/30 pl-0.5"
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: trimmed,
    indented: true,
    disableThinkTags: true
  })) : null);
});
RenderToolCallSummaryCard.displayName = "RenderToolCallSummaryCard";
const RenderPlan = /*#__PURE__*/(0,react.memo)(_ref6 => {
  let {
    content,
    isEditable,
    onSavePlan,
    onRegeneratePlan,
    forceCollapsed
  } = _ref6;
  // Make sure content.steps is an array before using it
  const initialSteps = Array.isArray(content.steps) ? content.steps : [];

  // Convert to IPlanStep[] if needed
  const initialPlanSteps = initialSteps.map(step => ({
    title: step.title || "",
    details: step.details || "",
    enabled: step.enabled !== false,
    open: step.open || false,
    agent_name: step.agent_name || ""
  }));
  const {
    0: planSteps,
    1: setPlanSteps
  } = (0,react.useState)(initialPlanSteps);
  return /*#__PURE__*/react.createElement("div", {
    className: "space-y-2 text-sm"
  }, /*#__PURE__*/react.createElement(plan["default"], {
    task: content.task || "Untitled Task",
    plan: planSteps,
    setPlan: setPlanSteps,
    viewOnly: !isEditable,
    onSavePlan: onSavePlan,
    onRegeneratePlan: onRegeneratePlan,
    forceCollapsed: forceCollapsed,
    fromMemory: content.from_memory || false
  }));
});
const RenderStepExecution = /*#__PURE__*/(0,react.memo)(_ref7 => {
  let {
    content,
    hidden,
    is_step_repeated,
    // is_step_repeated means the step is being re-tried
    is_step_failed,
    // is_step_failed means the step is being re-planned
    runStatus,
    onToggleHide,
    stepFollowingExpanded
  } = _ref7;
  const expanded = stepFollowingExpanded !== undefined ? stepFollowingExpanded : true;
  const handleToggle = () => {
    onToggleHide === null || onToggleHide === void 0 ? void 0 : onToggleHide(!expanded);
  };
  const isUserProxyInstruction = content.agent_name === "user_proxy";
  if (is_step_repeated && !hidden) {
    return /*#__PURE__*/react.createElement("div", {
      id: "step-execution-" + content.index,
      className: ""
    }, isUserProxyInstruction && content.instruction && /*#__PURE__*/react.createElement("div", {
      className: "flex items-start"
    }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
      content: content.instruction
    })), !isUserProxyInstruction && content.instruction && /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
      content: content.progress_summary,
      indented: true
    }));
  }
  if (is_step_repeated && hidden) {
    return null;
  }
  // if hidden add success green thingy

  return /*#__PURE__*/react.createElement("div", {
    id: "step-execution-" + content.index,
    className: "flex flex-col"
  }, !isUserProxyInstruction && content.instruction && content.index !== 0 && /*#__PURE__*/react.createElement("div", {
    className: " mb-2"
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: content.progress_summary,
    indented: true
  })), /*#__PURE__*/react.createElement("div", {
    className: "relative border-2 border-transparent hover:border-gray-300 rounded-lg p-2 cursor-pointer overflow-hidden bg-secondary",
    onClick: handleToggle
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-center w-full"
  }, /*#__PURE__*/react.createElement("button", {
    className: "flex-none flex items-center justify-center w-8 h-8 rounded-full bg-secondary transition-colors",
    onClick: e => {
      e.stopPropagation();
      handleToggle();
    },
    "aria-label": expanded ? "Hide following messages" : "Show following messages"
  }, expanded ? /*#__PURE__*/react.createElement(chevron_down/* default */.A, {
    size: 16,
    className: "text-primary"
  }) : /*#__PURE__*/react.createElement(chevron_right/* default */.A, {
    size: 16,
    className: "text-primary"
  })), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 mx-2"
  }, /*#__PURE__*/react.createElement("div", {
    className: "font-semibold text-primary"
  }, "Step ", content.index + 1, ": ", content.title)), /*#__PURE__*/react.createElement("div", {
    className: "flex-none"
  }, getStepIcon(hidden ? "completed" : "current", runStatus, is_step_repeated, is_step_failed)))), /*#__PURE__*/react.createElement("div", null, isUserProxyInstruction && content.instruction && expanded && /*#__PURE__*/react.createElement("div", {
    className: "flex items-start"
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: content.instruction
  }))));
});
const RenderFinalAnswer = /*#__PURE__*/(0,react.memo)(_ref8 => {
  let {
    content,
    sessionId,
    messageIdx
  } = _ref8;
  return /*#__PURE__*/react.createElement("div", {
    className: "border-2 border-secondary rounded-lg p-4"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex justify-between items-center"
  }, /*#__PURE__*/react.createElement("div", {
    className: "font-semibold text-primary"
  }, "Final Answer"), /*#__PURE__*/react.createElement(Plans_LearnPlanButton, {
    sessionId: sessionId,
    messageId: messageIdx,
    onSuccess: planId => {}
  })), /*#__PURE__*/react.createElement("div", {
    className: ""
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: content
  })));
});
RenderFinalAnswer.displayName = "RenderFinalAnswer";

// Message type checking utilities
const messageUtils = {
  isToolCallContent(content) {
    if (!Array.isArray(content)) return false;
    return content.every(item => typeof item === "object" && item !== null && "id" in item && "arguments" in item && "name" in item);
  },
  isMultiModalContent(content) {
    if (!Array.isArray(content)) return false;
    return content.every(item => typeof item === "string" || typeof item === "object" && item !== null && ("url" in item || "data" in item));
  },
  isFunctionExecutionResult(content) {
    if (!Array.isArray(content)) return false;
    return content.every(item => typeof item === "object" && item !== null && "call_id" in item && "content" in item);
  },
  isFinalAnswer(metadata) {
    return (metadata === null || metadata === void 0 ? void 0 : metadata.type) === "final_answer";
  },
  isPlanMessage(metadata) {
    return (metadata === null || metadata === void 0 ? void 0 : metadata.type) === "plan_message";
  },
  isStepExecution(metadata) {
    return (metadata === null || metadata === void 0 ? void 0 : metadata.type) === "step_execution";
  },
  findUserPlan(content) {
    if (typeof content !== "string") return [];
    try {
      const parsedContent = JSON.parse(content);
      let plan = [];
      if (parsedContent.plan && typeof parsedContent.plan === "string") {
        plan = JSON.parse(parsedContent.plan);
      }
      return plan;
    } catch (_unused4) {
      return [];
    }
  },
  updatePlan(content, planSteps) {
    if (typeof content !== "string") return "";
    try {
      const parsedContent = JSON.parse(content);
      if (typeof parsedContent === "object" && parsedContent !== null) {
        parsedContent.steps = planSteps;
        return JSON.stringify(parsedContent);
      }
      return "";
    } catch (error) {
      return "";
    }
  },
  isUser(source) {
    return source === "user" || source === "user_proxy";
  }
};

/** Backend may send action_buttons as JSON string or as an array */
function parseActionButtonsFromMetadata(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (_unused5) {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(b => typeof b === "object" && b !== null && typeof b.label === "string" && typeof b.action === "string");
}
const RenderUserMessage = /*#__PURE__*/(0,react.memo)(_ref9 => {
  let {
    parsedContent,
    isUserProxy,
    messageIdx,
    onEditMessage,
    onResendMessage,
    runStatus,
    isEditing: externalIsEditing,
    onStartEdit,
    onCancelEdit
  } = _ref9;
  const {
    darkMode
  } = react.useContext(provider/* appContext */.v);
  const {
    0: internalIsEditing,
    1: setInternalIsEditing
  } = (0,react.useState)(false);
  const {
    0: editValue,
    1: setEditValue
  } = (0,react.useState)("");
  const isEditing = externalIsEditing !== undefined ? externalIsEditing : internalIsEditing;
  const setIsEditing = externalIsEditing !== undefined ? onStartEdit || (() => {}) : setInternalIsEditing;

  // attached_files: set by construct_task on first message; files: WebSocket input_response uploads (user_proxy metadata)
  const attachedFiles = react.useMemo(() => {
    const meta = parsedContent.metadata;
    if (!meta) return [];
    const parseList = raw => {
      if (raw == null) return [];
      try {
        const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(arr)) return [];
        return arr.map(f => ({
          name: typeof (f === null || f === void 0 ? void 0 : f.name) === "string" ? f.name : "file",
          type: typeof (f === null || f === void 0 ? void 0 : f.type) === "string" ? f.type : "application/octet-stream"
        }));
      } catch (_unused6) {
        return [];
      }
    };
    if (meta.attached_files != null && meta.attached_files !== "") {
      const fromAttached = parseList(meta.attached_files);
      if (fromAttached.length > 0) return fromAttached;
    }
    if (meta.files != null && meta.files !== "") {
      return parseList(meta.files);
    }
    return [];
  }, [parsedContent.metadata]);

  // Get the text content for editing/copying
  const getTextContent = () => {
    if (messageUtils.isMultiModalContent(parsedContent.text)) {
      return parsedContent.text.filter(item => typeof item === "string").map(item => parseContent(item)).join("\n");
    }
    return stringifyForDisplay(parsedContent.text);
  };

  // Initialize editValue when entering edit mode
  react.useEffect(() => {
    if (isEditing && !editValue) {
      const textContent = getTextContent();
      setEditValue(textContent);
    }
    // Reset editValue when exiting edit mode
    if (!isEditing) {
      setEditValue("");
    }
  }, [isEditing]);
  const handleSend = () => {
    if (onResendMessage && editValue.trim()) {
      onResendMessage(editValue);
    }
    if (externalIsEditing !== undefined) {
      // Controlled mode - parent will handle state
      setInternalIsEditing(false);
    } else {
      setIsEditing(false);
    }
    setEditValue("");
  };
  const handleCancel = () => {
    if (externalIsEditing !== undefined) {
      // Controlled mode - notify parent to exit edit mode
      if (onCancelEdit) {
        onCancelEdit();
      }
      setInternalIsEditing(false);
    } else {
      setIsEditing(false);
    }
    setEditValue("");
  };
  return /*#__PURE__*/react.createElement("div", {
    className: "space-y-2"
  }, attachedFiles.length > 0 && /*#__PURE__*/react.createElement("div", {
    className: "flex flex-wrap gap-2"
  }, attachedFiles.map((file, index) => /*#__PURE__*/react.createElement("div", {
    key: index,
    className: "flex items-center gap-1  rounded px-2 py-1 text-xs",
    title: file.name
  }, file.type.startsWith("image") ? /*#__PURE__*/react.createElement(icons_image/* default */.A, {
    className: "w-3 h-3"
  }) : /*#__PURE__*/react.createElement(file_text/* default */.A, {
    className: "w-3 h-3"
  }), /*#__PURE__*/react.createElement("span", {
    className: "truncate max-w-[150px]"
  }, file.name)))), isEditing ? /*#__PURE__*/react.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/react.createElement("textarea", {
    value: editValue,
    onChange: e => setEditValue(e.target.value),
    className: "w-full p-2 border border-secondary rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary " + (darkMode === "dark" ? "bg-[#0f0f0f] text-gray-200 border-transparent" : "bg-background text-primary"),
    rows: Math.min(editValue.split('\n').length + 2, 10),
    autoFocus: true,
    onKeyDown: e => {
      // Allow Ctrl/Cmd+Enter to send
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
      // Allow Escape to cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    }
  }), /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-2"
  }, onResendMessage && /*#__PURE__*/react.createElement("button", {
    onClick: handleSend,
    className: "flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary rounded-lg hover:bg-primary/90 transition-colors",
    title: "Send edited message"
  }, /*#__PURE__*/react.createElement(send/* default */.A, {
    size: 14
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm"
  }, "Send")), /*#__PURE__*/react.createElement("button", {
    onClick: handleCancel,
    className: "flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-primary rounded-lg hover:bg-secondary/80 transition-colors",
    title: "Cancel editing"
  }, /*#__PURE__*/react.createElement(x/* default */.A, {
    size: 14
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-sm"
  }, "Cancel")))) : /*#__PURE__*/react.createElement(react.Fragment, null, messageUtils.isMultiModalContent(parsedContent.text) ? /*#__PURE__*/react.createElement("div", {
    className: "space-y-2"
  }, parsedContent.text.map((item, index) => /*#__PURE__*/react.createElement("div", {
    key: index
  }, typeof item === "string" ? /*#__PURE__*/react.createElement("div", {
    className: "break-words whitespace-pre-wrap overflow-wrap-anywhere"
  }, parseContent(item)) : /*#__PURE__*/react.createElement(atoms/* ClickableImage */.wx, {
    src: getImageSource(item),
    alt: item.alt || "Attachment " + (index + 1),
    className: "max-w-[400px] max-h-[30vh] rounded-lg"
  })))) : /*#__PURE__*/react.createElement("div", {
    className: "break-words whitespace-pre-wrap overflow-wrap-anywhere"
  }, stringifyForDisplay(parsedContent.text)), parsedContent.plan && Array.isArray(parsedContent.plan) && parsedContent.plan.length > 0 && /*#__PURE__*/react.createElement(plan["default"], {
    task: "",
    plan: parsedContent.plan,
    setPlan: () => {} // No-op since it's read-only
    ,

    viewOnly: true,
    onSavePlan: () => {} // No-op since it's read-only
  })));
});
RenderUserMessage.displayName = "RenderUserMessage";

// Main component
const RenderMessage = /*#__PURE__*/(0,react.memo)(_ref10 => {
  var _message$metadata, _message$metadata2, _message$metadata3, _message$metadata4, _message$metadata5, _message$metadata6, _normalizedMessage$me, _normalizedMessage$me2, _normalizedMessage$me3, _normalizedMessage$me4, _normalizedMessage$me5, _normalizedMessage$me6, _normalizedMessage$me7;
  let {
    message,
    sessionId,
    messageIdx,
    runStatus,
    isLast = false,
    className = "",
    isEditable = false,
    hidden = false,
    is_step_repeated = false,
    is_step_failed = false,
    onSavePlan,
    onImageClick,
    onToggleHide,
    onRegeneratePlan,
    onEditMessage,
    onResendMessage,
    forceCollapsed = false,
    onLogMessageClick,
    onActionButtonClick,
    stepFollowingExpanded
  } = _ref10;
  const {
    darkMode
  } = react.useContext(provider/* appContext */.v);
  const {
    0: isEditing,
    1: setIsEditing
  } = (0,react.useState)(false);
  const {
    0: isCopied,
    1: setIsCopied
  } = (0,react.useState)(false);
  const editTriggerRef = react.useRef(null);
  if (!message) return null;
  if (((_message$metadata = message.metadata) === null || _message$metadata === void 0 ? void 0 : _message$metadata.type) === "browser_address") return null;

  // Check if this is a FilesEvent - these should only be shown in panel, not in main chat
  const messageAny = message;
  if (messageAny.type === "FilesEvent" || ((_message$metadata2 = message.metadata) === null || _message$metadata2 === void 0 ? void 0 : _message$metadata2.type) === "FilesEvent") {
    return null;
  }

  // BESIII global_info — right panel only (runview besiiiServerGlobalInfo); hide from main thread
  if (((_message$metadata3 = message.metadata) === null || _message$metadata3 === void 0 ? void 0 : _message$metadata3.type) === "global_info") {
    return null;
  }
  const isUser = messageUtils.isUser(message.source);
  const isUserProxy = message.source === "user_proxy";
  // const isOrchestrator = ["Orchestrator"].includes(message.source);

  // Check if this is a log message (from historical data or WebSocket)
  // Historical messages may have content_type="log" or type="AgentLogEvent" in config
  const isLogMessage = ((_message$metadata4 = message.metadata) === null || _message$metadata4 === void 0 ? void 0 : _message$metadata4.type) === "log" || messageAny.content_type === "log" || messageAny.type === "AgentLogEvent" || ((_message$metadata5 = message.metadata) === null || _message$metadata5 === void 0 ? void 0 : _message$metadata5.type) === "AgentLogEvent";

  // For historical log messages, extract title and content, and normalize metadata
  let normalizedMessage = message;
  if (isLogMessage && !((_message$metadata6 = message.metadata) !== null && _message$metadata6 !== void 0 && _message$metadata6.type)) {
    // Historical message: normalize to have metadata.type = "log"
    let contentValue;

    // 处理 title（优先使用 title 作为显示内容）
    if (messageAny.title) {
      contentValue = typeof messageAny.title === "string" ? messageAny.title : stringifyForDisplay(messageAny.title);
    }
    // 处理 content（可能是对象或字符串）
    else if (messageAny.content) {
      if (typeof messageAny.content === "string") {
        contentValue = messageAny.content;
      } else if (typeof messageAny.content === "object" && messageAny.content !== null) {
        // 如果是对象，尝试提取文本内容或序列化
        contentValue = messageAny.content.content || messageAny.content.text || JSON.stringify(messageAny.content);
      } else {
        contentValue = stringifyForDisplay(messageAny.content);
      }
    }
    // 回退到 message.content
    else if (message.content) {
      contentValue = typeof message.content === "string" ? message.content : stringifyForDisplay(message.content);
    } else {
      contentValue = "";
    }

    // 处理 log_content（保存原始的 content 用于 logExecution 面板）
    let logContentValue;
    if (messageAny.content) {
      if (typeof messageAny.content === "string") {
        logContentValue = messageAny.content;
      } else if (typeof messageAny.content === "object" && messageAny.content !== null) {
        logContentValue = messageAny.content.content || messageAny.content.text || JSON.stringify(messageAny.content);
      } else {
        logContentValue = stringifyForDisplay(messageAny.content);
      }
    } else if (message.content && typeof message.content === "string") {
      logContentValue = message.content;
    }
    normalizedMessage = Object.assign({}, message, {
      metadata: Object.assign({}, message.metadata, {
        type: "log",
        log_content: logContentValue
      }, typeof messageAny.content_type === "string" ? {
        content_type: messageAny.content_type
      } : {}),
      content: contentValue
    });
  }
  const parsedContent = isUser || isUserProxy ? parseUserContent(normalizedMessage) : (() => {
    // For non-user messages, ensure text is always a string or array
    let textValue;
    const contentValue = normalizedMessage.content;
    if (Array.isArray(contentValue)) {
      textValue = contentValue;
    } else if (typeof contentValue === "string") {
      textValue = contentValue;
    } else if (typeof contentValue === "object" && contentValue !== null) {
      // If it's an object, try to extract text or stringify
      const extracted = contentValue.content || contentValue.text;
      if (typeof extracted === "string") {
        textValue = extracted;
      } else if (Array.isArray(extracted)) {
        textValue = extracted;
      } else {
        // textValue = stringifyForDisplay(contentValue);
        textValue = String(contentValue || "");
      }
    } else {
      // textValue = stringifyForDisplay(contentValue);
      textValue = String(contentValue || "");
    }
    return {
      text: textValue,
      metadata: normalizedMessage.metadata
    };
  })();

  /** tools / AgentLogEvent 行 — 不显示本条下方的复制按钮（用归一化后 config，避免 metadata 为空时漏判） */
  const cfg = normalizedMessage;
  const meta = normalizedMessage.metadata || {};
  const suppressNonUserCopyButton = cfg.content_type === "tools" || meta.content_type === "tools" || cfg.type === "AgentLogEvent" || meta.type === "AgentLogEvent";

  /** Hide footer "Copy" when the bubble is only reasoning (e.g. collapsed "Thought Completed") with no real reply text. */
  const rawAssistantMarkdownSource = (() => {
    const t = parsedContent.text;
    if (typeof t === "string") return t;
    if (Array.isArray(t)) {
      return t.filter(item => typeof item === "string").join("\n");
    }
    return stringifyForDisplay(t);
  })();
  const stripThinkBlocksForCopyHeuristic = raw => raw
  // Strip blocks closed with `</think>` (parser) or `</think>` (disableThinkTags path).
  .replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, "");
  const hasAssistantThinkTags = rawAssistantMarkdownSource.includes("<think>");
  const assistantBodyOutsideThink = hasAssistantThinkTags ? stripThinkBlocksForCopyHeuristic(rawAssistantMarkdownSource).trim() : rawAssistantMarkdownSource.trim();
  const showAssistantMessageCopyButton = !hasAssistantThinkTags || assistantBodyOutsideThink.replace(/\s+/g, "").length >= 12;
  // Use new plan message check
  const isPlanMsg = messageUtils.isPlanMessage(normalizedMessage.metadata);
  const orchestratorContent =
  // isOrchestrator && typeof normalizedMessage.content === "string"
  typeof normalizedMessage.content === "string" ? parseorchestratorContent(normalizedMessage.content, normalizedMessage.metadata) : null;
  const isEmptyFinalAnswerMessage = (orchestratorContent === null || orchestratorContent === void 0 ? void 0 : orchestratorContent.type) === "final-answer" && typeof orchestratorContent.content === "string" && orchestratorContent.content.trim().length === 0;
  if (isEmptyFinalAnswerMessage) {
    return null;
  }

  // Derive plan content by message type, not by source
  let planContent = null;
  if (isPlanMsg) {
    if (orchestratorContent !== null && orchestratorContent !== void 0 && orchestratorContent.content) {
      planContent = orchestratorContent.content;
    } else {
      const rawContent = normalizedMessage.content;
      if (typeof rawContent === "string") {
        try {
          planContent = JSON.parse(rawContent);
        } catch (_unused7) {
          planContent = rawContent;
        }
      } else {
        planContent = rawContent;
      }
    }

    // Basic shape guard
    if (!planContent || typeof planContent !== "object") {
      planContent = {};
    } else if (!Array.isArray(planContent.steps)) {
      planContent = Object.assign({}, planContent, {
        steps: []
      });
    }
  }
  const startFlagValue = (_normalizedMessage$me = normalizedMessage.metadata) === null || _normalizedMessage$me === void 0 ? void 0 : _normalizedMessage$me.start_flag;
  const isStartFlagActive = typeof startFlagValue === "string" && startFlagValue.toLowerCase() === "yes";
  const streamSourceLabel = typeof ((_normalizedMessage$me2 = normalizedMessage.metadata) === null || _normalizedMessage$me2 === void 0 ? void 0 : _normalizedMessage$me2.stream_source_label) === "string" ? normalizedMessage.metadata.stream_source_label : undefined;
  const sourceBadgeText = streamSourceLabel || normalizedMessage.source;

  // 判断是否是 TextMessage 类型（使用已存在的 messageAny）
  const normalizedMessageAny = normalizedMessage;
  const isTextMessage = normalizedMessageAny.type === "TextMessage";
  const isToolCallSummaryMessage = normalizedMessageAny.type === "ToolCallSummaryMessage";

  // 判断是否是历史消息（没有 start_flag 或 metadata.is_save === "yes"）
  const isHistoricalMessage = !startFlagValue || ((_normalizedMessage$me3 = normalizedMessage.metadata) === null || _normalizedMessage$me3 === void 0 ? void 0 : _normalizedMessage$me3.is_save) === "yes" || ((_normalizedMessage$me4 = normalizedMessage.metadata) === null || _normalizedMessage$me4 === void 0 ? void 0 : _normalizedMessage$me4.internal) === "yes";

  // 对于 TextMessage 类型的历史消息，直接显示 source badge；对于流式消息，需要 start_flag 判断
  const shouldShowSourceBadge = !isUser && !isUserProxy && (isTextMessage && isHistoricalMessage || isStartFlagActive);

  // Hide regeneration request messages
  if (parsedContent.text === "Regenerate a plan that improves on the current plan") {
    return null;
  }

  // Helper functions for user message actions
  const getTextContent = () => {
    if (messageUtils.isMultiModalContent(parsedContent.text)) {
      return parsedContent.text.filter(item => typeof item === "string").map(item => parseContent(item)).join("\n");
    }
    return stringifyForDisplay(parsedContent.text);
  };
  const handleCopy = async () => {
    const textToCopy = getTextContent();
    if (textToCopy.trim()) {
      try {
        // Check if clipboard API is available
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          // Fallback for environments where clipboard API is not available
          const textArea = document.createElement('textarea');
          textArea.value = textToCopy;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        setIsCopied(true);
        // Reset after 2 seconds
        setTimeout(() => {
          setIsCopied(false);
        }, 2000);
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
    }
  };

  // Get text content for non-user messages
  const getNonUserTextContent = () => {
    if ((orchestratorContent === null || orchestratorContent === void 0 ? void 0 : orchestratorContent.type) === "final-answer") {
      return orchestratorContent.content;
    }
    if ((orchestratorContent === null || orchestratorContent === void 0 ? void 0 : orchestratorContent.type) === "step-execution") {
      const stepContent = orchestratorContent.content;
      console.log("stepContent", stepContent);
      return stepContent.details || stepContent.progress_summary || "";
    }
    if (messageUtils.isToolCallContent(parsedContent.text)) {
      return JSON.stringify(parsedContent.text, null, 2);
    }
    if (messageUtils.isMultiModalContent(parsedContent.text)) {
      return parsedContent.text.filter(item => typeof item === "string").map(item => parseContent(item)).join("\n");
    }
    if (messageUtils.isFunctionExecutionResult(parsedContent.text)) {
      return parsedContent.text.map(result => result.content).join("\n\n");
    }
    return stringifyForDisplay(parsedContent.text);
  };
  const handleNonUserCopy = async () => {
    const textToCopy = getNonUserTextContent();
    if (textToCopy.trim()) {
      try {
        // Check if clipboard API is available
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          // Fallback for environments where clipboard API is not available
          const textArea = document.createElement('textarea');
          textArea.value = textToCopy;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        setIsCopied(true);
        // Reset after 2 seconds
        setTimeout(() => {
          setIsCopied(false);
        }, 2000);
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
    }
  };
  const canEditUserMessage = (isUser || isUserProxy) && !messageUtils.isMultiModalContent(parsedContent.text) && !parsedContent.plan;
  return /*#__PURE__*/react.createElement("div", {
    className: "relative " + (isUser || isUserProxy ? "mb-8" : "mb-3") + " " + className + " w-full break-words " + (hidden && (!orchestratorContent || orchestratorContent.type !== "step-execution") ? "hidden" : "")
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex group " + (isUser || isUserProxy ? "justify-end" : "justify-start") + " items-start w-full transition-all duration-200"
  }, /*#__PURE__*/react.createElement("div", {
    className: "relative flex flex-col items-end"
  }, /*#__PURE__*/react.createElement("div", {
    className: (isUser || isUserProxy ? "text-primary rounded-2xl bg-tertiary rounded-tr-sm px-4 py-2 " + (parsedContent.plan && parsedContent.plan.length > 0 ? "w-[100%]" : "max-w-[100%]") : "w-full text-primary") + " break-words overflow-hidden"
  }, (isUser || isUserProxy) && /*#__PURE__*/react.createElement(RenderUserMessage, {
    parsedContent: parsedContent,
    isUserProxy: isUserProxy,
    messageIdx: messageIdx,
    onEditMessage: (idx, content) => {
      onEditMessage === null || onEditMessage === void 0 ? void 0 : onEditMessage(idx, content);
      setIsEditing(false);
    },
    onResendMessage: content => {
      onResendMessage === null || onResendMessage === void 0 ? void 0 : onResendMessage(content);
      setIsEditing(false);
    },
    runStatus: runStatus,
    isEditing: isEditing,
    onStartEdit: () => setIsEditing(true),
    onCancelEdit: () => setIsEditing(false)
  })), (isUser || isUserProxy) && !isEditing && /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-1 absolute " + (isUser || isUserProxy ? 'right-0' : 'left-0') + " top-full z-10 px-1 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"
  }, /*#__PURE__*/react.createElement("button", {
    onClick: handleCopy,
    className: "p-1.5 text-secondary hover:text-primary transition-colors rounded hover:bg-secondary/50",
    title: isCopied ? "Copied!" : "Copy message"
  }, isCopied ? /*#__PURE__*/react.createElement(check/* default */.A, {
    size: 14
  }) : /*#__PURE__*/react.createElement(copy/* default */.A, {
    size: 14
  })), canEditUserMessage && (onEditMessage || onResendMessage) && /*#__PURE__*/react.createElement("button", {
    onClick: () => setIsEditing(true),
    className: "p-1.5 text-secondary hover:text-primary transition-colors rounded hover:bg-secondary/50",
    title: "Edit message"
  }, /*#__PURE__*/react.createElement(SquarePen, {
    size: 14
  })))), !isUser && !isUserProxy && /*#__PURE__*/react.createElement("div", {
    className: "w-full text-primary break-words overflow-hidden"
  }, shouldShowSourceBadge && /*#__PURE__*/react.createElement("div", {
    className: "relative mb-2 inline-flex items-center py-1.5 text-base font-semibold text-primary gap-2"
  }, /*#__PURE__*/react.createElement("span", {
    className: ""
  }, /*#__PURE__*/react.createElement(bot/* default */.A, null)), /*#__PURE__*/react.createElement("span", null, sourceBadgeText)), !isUser && !isUserProxy && (isPlanMsg ? /*#__PURE__*/react.createElement(RenderPlan, {
    content: planContent || {},
    isEditable: isEditable,
    onSavePlan: onSavePlan,
    onRegeneratePlan: onRegeneratePlan,
    forceCollapsed: forceCollapsed
  }) : (orchestratorContent === null || orchestratorContent === void 0 ? void 0 : orchestratorContent.type) === "step-execution" ? /*#__PURE__*/react.createElement(RenderStepExecution, {
    content: orchestratorContent.content,
    hidden: hidden,
    is_step_repeated: is_step_repeated,
    is_step_failed: is_step_failed,
    runStatus: runStatus || "",
    onToggleHide: onToggleHide,
    stepFollowingExpanded: stepFollowingExpanded
  }) : (orchestratorContent === null || orchestratorContent === void 0 ? void 0 : orchestratorContent.type) === "final-answer" ? /*#__PURE__*/react.createElement(RenderFinalAnswer, {
    content: orchestratorContent.content,
    sessionId: sessionId,
    messageIdx: messageIdx
  }) : messageUtils.isToolCallContent(parsedContent.text) ? /*#__PURE__*/react.createElement(RenderToolCall, {
    content: parsedContent.text
  }) : messageUtils.isMultiModalContent(parsedContent.text) ? ((_normalizedMessage$me5 = normalizedMessage.metadata) === null || _normalizedMessage$me5 === void 0 ? void 0 : _normalizedMessage$me5.type) === "browser_screenshot" ? /*#__PURE__*/react.createElement(RenderMultiModalBrowserStep, {
    content: parsedContent.text,
    onImageClick: onImageClick
  }) : /*#__PURE__*/react.createElement(RenderMultiModal, {
    content: parsedContent.text
  }) : messageUtils.isFunctionExecutionResult(parsedContent.text) ? /*#__PURE__*/react.createElement(RenderToolResult, {
    content: parsedContent.text
  }) : /*#__PURE__*/react.createElement("div", {
    className: "break-words"
  }, ((_normalizedMessage$me6 = normalizedMessage.metadata) === null || _normalizedMessage$me6 === void 0 ? void 0 : _normalizedMessage$me6.type) === "file" ? /*#__PURE__*/react.createElement(filerenderer, {
    message: normalizedMessage
  }) : isLogMessage ? /*#__PURE__*/react.createElement("div", {
    className: "flex items-start gap-2 " + (onLogMessageClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""),
    onClick: onLogMessageClick ? e => {
      e.preventDefault();
      e.stopPropagation();
      if (onLogMessageClick) {
        onLogMessageClick();
      }
    } : undefined,
    title: onLogMessageClick ? "点击查看详细日志" : undefined
  }, /*#__PURE__*/react.createElement(settings/* default */.A, {
    size: 14,
    className: "shrink-0 text-violet-600 dark:text-violet-400 mt-[0.28em] leading-none",
    onClick: onLogMessageClick ? e => {
      e.preventDefault();
      e.stopPropagation();
      onLogMessageClick();
    } : undefined
  }), /*#__PURE__*/react.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/react.createElement("div", {
    style: {
      pointerEvents: onLogMessageClick ? "none" : "auto"
    }
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: (() => {
      let contentText;
      if (typeof parsedContent.text === "string") {
        contentText = parsedContent.text;
      } else if (Array.isArray(parsedContent.text)) {
        // Filter out non-string items and join
        const textArray = parsedContent.text;
        const stringItems = textArray.filter(item => typeof item === "string");
        contentText = stringItems.join("\n");
      } else {
        contentText = stringifyForDisplay(parsedContent.text);
      }
      // Ensure log message content ends with double newline to separate from chunk message
      // Markdown requires double newline for paragraph break
      if (contentText && !contentText.endsWith("\n\n")) {
        if (contentText.endsWith("\n")) {
          contentText += "\n";
        } else {
          contentText += "\n\n";
        }
      }
      return contentText;
    })(),
    indented: !orchestratorContent || orchestratorContent.type !== "default"
  })), typeof ((_normalizedMessage$me7 = normalizedMessage.metadata) === null || _normalizedMessage$me7 === void 0 ? void 0 : _normalizedMessage$me7.tool_call_summary) === "string" && normalizedMessage.metadata.tool_call_summary.trim().length > 0 && /*#__PURE__*/react.createElement("div", {
    className: "mt-1.5",
    style: {
      pointerEvents: "auto"
    },
    onClick: e => {
      // Keep log card click for open-details, but allow expanding tool result.
      e.stopPropagation();
    }
  }, /*#__PURE__*/react.createElement(RenderToolCallSummaryCard, {
    content: normalizedMessage.metadata.tool_call_summary,
    defaultCollapsed: true
  })))) : /*#__PURE__*/react.createElement("div", null, isToolCallSummaryMessage ? /*#__PURE__*/react.createElement(RenderToolCallSummaryCard, {
    content: (() => {
      if (typeof parsedContent.text === "string") {
        return parsedContent.text;
      } else if (Array.isArray(parsedContent.text)) {
        const textArray = parsedContent.text;
        const stringItems = textArray.filter(item => typeof item === "string");
        return stringItems.join("\n");
      }
      return stringifyForDisplay(parsedContent.text);
    })(),
    defaultCollapsed: true
  }) : /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: (() => {
      if (typeof parsedContent.text === "string") {
        return parsedContent.text;
      } else if (Array.isArray(parsedContent.text)) {
        // Filter out non-string items and join
        const textArray = parsedContent.text;
        const stringItems = textArray.filter(item => typeof item === "string");
        return stringItems.join("\n");
      } else {
        return stringifyForDisplay(parsedContent.text);
      }
    })(),
    indented: !orchestratorContent || orchestratorContent.type !== "default"
  })))), !isPlanMsg && !isUser && !isUserProxy && (_normalizedMessage$me8 => {
    const rawButtons = (_normalizedMessage$me8 = normalizedMessage.metadata) === null || _normalizedMessage$me8 === void 0 ? void 0 : _normalizedMessage$me8.action_buttons;
    const actionButtons = parseActionButtonsFromMetadata(rawButtons);
    return actionButtons.length > 0 && onActionButtonClick ? /*#__PURE__*/react.createElement("div", {
      className: "flex flex-wrap gap-2 mt-2"
    }, actionButtons.map(btn => /*#__PURE__*/react.createElement("button", {
      key: btn.action,
      type: "button",
      onClick: () => onActionButtonClick(btn.action),
      className: "px-3 py-1.5 text-sm rounded-md bg-primary/10 hover:bg-primary/20 text-primary transition-colors border border-primary/30 focus:!border-accent focus-visible:!border-accent"
    }, btn.label))) : null;
  })(), !isPlanMsg && !suppressNonUserCopyButton && showAssistantMessageCopyButton && /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
  }, /*#__PURE__*/react.createElement("button", {
    onClick: handleNonUserCopy,
    className: "p-1.5 text-secondary hover:text-primary transition-colors rounded hover:bg-secondary/50",
    title: isCopied ? "Copied!" : "Copy message"
  }, isCopied ? /*#__PURE__*/react.createElement(check/* default */.A, {
    size: 14
  }) : /*#__PURE__*/react.createElement(copy/* default */.A, {
    size: 14
  }))))));
});
RenderMessage.displayName = "RenderMessage";
/* harmony default export */ var rendermessage = (RenderMessage);

/***/ }),

/***/ 51037:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   KW: function() { return /* binding */ formatUnixForDisplayZhCN; },
/* harmony export */   R3: function() { return /* binding */ apiDatetimeToUtcMs; },
/* harmony export */   TY: function() { return /* binding */ parseFlexibleTimestampToUnixSeconds; },
/* harmony export */   U7: function() { return /* binding */ formatApiDateTimeZhCN; },
/* harmony export */   Y4: function() { return /* binding */ parseApiDateAsUtc; }
/* harmony export */ });
/* unused harmony exports shanghaiMidnightUtcMs, getCalendarDayAsiaShanghai, todayCalendarAsiaShanghai, addCalendarDaysAsiaShanghai */
/**
 * Backend returns naive ISO datetimes (no Z / offset). Treat them as UTC instants,
 * then format or bucket using Asia/Shanghai for consistent 北京时间 display.
 */const DISPLAY_TIME_ZONE="Asia/Shanghai";function pad2(n){return n<10?"0"+n:String(n);}function hasExplicitTimezone(isoLike){return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(isoLike.trim());}/** Parse backend naive datetime string as a UTC instant (append Z when offset missing). */function parseApiDateAsUtc(isoLike){if(isoLike==null)return null;const s=String(isoLike).trim();if(!s)return null;const d=hasExplicitTimezone(s)?new Date(s):new Date(s+"Z");return Number.isNaN(d.getTime())?null:d;}function apiDatetimeToUtcMs(isoLike){const d=parseApiDateAsUtc(isoLike!==null&&isoLike!==void 0?isoLike:"");return d?d.getTime():0;}/** Midnight at the start of this calendar day in Shanghai, as UTC ms. */function shanghaiMidnightUtcMs(yyyyMmDd){const parts=yyyyMmDd.split("-").map(Number);const[y,m,d]=parts;if(!y||!m||!d)return NaN;return Date.parse(y+"-"+pad2(m)+"-"+pad2(d)+"T00:00:00+08:00");}/** YYYY-MM-DD in Asia/Shanghai for an instant. */function getCalendarDayAsiaShanghai(instant){return new Intl.DateTimeFormat("en-CA",{timeZone:DISPLAY_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(instant);}function todayCalendarAsiaShanghai(now){if(now===void 0){now=new Date();}return getCalendarDayAsiaShanghai(now);}/** Shift a Shanghai calendar day by deltaDays (China has no DST; noon UTC+8 anchor). */function addCalendarDaysAsiaShanghai(yyyyMmDd,deltaDays){const parts=yyyyMmDd.split("-").map(Number);const[y,m,d]=parts;if(!y||!m||!d)return"";const anchorMs=Date.parse(y+"-"+pad2(m)+"-"+pad2(d)+"T12:00:00+08:00");if(Number.isNaN(anchorMs))return"";return getCalendarDayAsiaShanghai(new Date(anchorMs+deltaDays*86400000));}/** API ISO string → 北京时间 locale display */function formatApiDateTimeZhCN(isoLike){const d=parseApiDateAsUtc(isoLike!==null&&isoLike!==void 0?isoLike:"");if(!d)return"—";return new Intl.DateTimeFormat("zh-CN",{timeZone:DISPLAY_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d);}/** Unix timestamp (seconds or ms) → 北京时间 display */function formatUnixForDisplayZhCN(unix){if(unix===undefined||unix===null)return"—";const n=typeof unix==="number"?unix:Number(unix);if(!Number.isFinite(n))return"—";const ms=n>1e12?n:n*1000;return new Intl.DateTimeFormat("zh-CN",{timeZone:DISPLAY_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(ms));}/** For chat payloads: epoch seconds for FilesEvent / logs; ISO strings parsed as UTC API time. */function parseFlexibleTimestampToUnixSeconds(raw){if(raw===undefined||raw===null)return undefined;if(typeof raw==="number"&&Number.isFinite(raw)){return raw>1e12?raw/1000:raw;}if(typeof raw==="string"){const trimmed=raw.trim();if(!trimmed)return undefined;const num=Number(trimmed);if(Number.isFinite(num)&&trimmed===String(num)){return num>1e12?num/1000:num;}const d=parseApiDateAsUtc(trimmed);return d?d.getTime()/1000:undefined;}return undefined;}

/***/ }),

/***/ 42640:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Bot; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Bot = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Bot", [
  ["path", { d: "M12 8V4H8", key: "hb8ula" }],
  ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2", key: "enze0r" }],
  ["path", { d: "M2 14h2", key: "vft8re" }],
  ["path", { d: "M20 14h2", key: "4cs60a" }],
  ["path", { d: "M15 13v2", key: "1xurst" }],
  ["path", { d: "M9 13v2", key: "rq6x2g" }]
]);


//# sourceMappingURL=bot.js.map


/***/ }),

/***/ 45773:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Check; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Check = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Check", [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]);


//# sourceMappingURL=check.js.map


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

/***/ 27235:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Clock; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Clock = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Clock", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["polyline", { points: "12 6 12 12 16 14", key: "68esgv" }]
]);


//# sourceMappingURL=clock.js.map


/***/ }),

/***/ 93164:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Code; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Code = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Code", [
  ["polyline", { points: "16 18 22 12 16 6", key: "z7tu5w" }],
  ["polyline", { points: "8 6 2 12 8 18", key: "1eg1df" }]
]);


//# sourceMappingURL=code.js.map


/***/ }),

/***/ 35404:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Copy; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Copy = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Copy", [
  ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2", key: "17jyea" }],
  ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", key: "zix9uf" }]
]);


//# sourceMappingURL=copy.js.map


/***/ }),

/***/ 15977:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ RefreshCw; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const RefreshCw = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("RefreshCw", [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
]);


//# sourceMappingURL=refresh-cw.js.map


/***/ }),

/***/ 27775:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Send; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Send = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Send", [
  [
    "path",
    {
      d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
      key: "1ffxy3"
    }
  ],
  ["path", { d: "m21.854 2.147-10.94 10.939", key: "12cjpa" }]
]);


//# sourceMappingURL=send.js.map


/***/ }),

/***/ 80964:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Settings; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Settings = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Settings", [
  [
    "path",
    {
      d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      key: "1qme2f"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
]);


//# sourceMappingURL=settings.js.map


/***/ }),

/***/ 418:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ TriangleAlert; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const TriangleAlert = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("TriangleAlert", [
  [
    "path",
    {
      d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      key: "wmoenq"
    }
  ],
  ["path", { d: "M12 9v4", key: "juzpu7" }],
  ["path", { d: "M12 17h.01", key: "p32p05" }]
]);


//# sourceMappingURL=triangle-alert.js.map


/***/ })

}]);
//# sourceMappingURL=6d14c8dd70e234fafe29cb2c56cd330b02bf6a2d-3911554717b31518f121.js.map