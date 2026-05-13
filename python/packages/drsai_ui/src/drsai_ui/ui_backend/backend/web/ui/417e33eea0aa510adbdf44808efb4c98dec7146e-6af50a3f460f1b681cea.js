"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[1430],{

/***/ 68000:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ icons_RightOutlined; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/@ant-design/icons-svg/es/asn/RightOutlined.js
// This icon file is generated automatically.
var RightOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M765.7 486.8L314.9 134.7A7.97 7.97 0 00302 141v77.3c0 4.9 2.3 9.6 6.1 12.6l360 281.1-360 281.1c-3.9 3-6.1 7.7-6.1 12.6V883c0 6.7 7.7 10.4 12.9 6.3l450.8-352.1a31.96 31.96 0 000-50.4z" } }] }, "name": "right", "theme": "outlined" };
/* harmony default export */ var asn_RightOutlined = (RightOutlined);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/RightOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var RightOutlined_RightOutlined = function RightOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_RightOutlined
  }));
};

/**![right](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTc2NS43IDQ4Ni44TDMxNC45IDEzNC43QTcuOTcgNy45NyAwIDAwMzAyIDE0MXY3Ny4zYzAgNC45IDIuMyA5LjYgNi4xIDEyLjZsMzYwIDI4MS4xLTM2MCAyODEuMWMtMy45IDMtNi4xIDcuNy02LjEgMTIuNlY4ODNjMCA2LjcgNy43IDEwLjQgMTIuOSA2LjNsNDUwLjgtMzUyLjFhMzEuOTYgMzEuOTYgMCAwMDAtNTAuNHoiIC8+PC9zdmc+) */
var RefIcon = /*#__PURE__*/react.forwardRef(RightOutlined_RightOutlined);
if (false) {}
/* harmony default export */ var icons_RightOutlined = (RefIcon);

/***/ }),

/***/ 51679:
/***/ (function(__unused_webpack_module, __webpack_exports__) {

const extendsObject = function () {
  const result = Object.assign({}, arguments.length <= 0 ? undefined : arguments[0]);
  for (let i = 1; i < arguments.length; i++) {
    const obj = i < 0 || arguments.length <= i ? undefined : arguments[i];
    if (obj) {
      Object.keys(obj).forEach(key => {
        const val = obj[key];
        if (val !== undefined) {
          result[key] = val;
        }
      });
    }
  }
  return result;
};
/* harmony default export */ __webpack_exports__.A = (extendsObject);

/***/ }),

/***/ 24945:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Ay: function() { return /* binding */ useResponsiveObserver; },
/* harmony export */   ye: function() { return /* binding */ responsiveArray; }
/* harmony export */ });
/* unused harmony export matchScreen */
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _theme_internal__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(11320);


const responsiveArray = ['xxl', 'xl', 'lg', 'md', 'sm', 'xs'];
const getResponsiveMap = token => ({
  xs: `(max-width: ${token.screenXSMax}px)`,
  sm: `(min-width: ${token.screenSM}px)`,
  md: `(min-width: ${token.screenMD}px)`,
  lg: `(min-width: ${token.screenLG}px)`,
  xl: `(min-width: ${token.screenXL}px)`,
  xxl: `(min-width: ${token.screenXXL}px)`
});
/**
 * Ensures that the breakpoints token are valid, in good order
 * For each breakpoint : screenMin <= screen <= screenMax and screenMax <= nextScreenMin
 */
const validateBreakpoints = token => {
  const indexableToken = token;
  const revBreakpoints = [].concat(responsiveArray).reverse();
  revBreakpoints.forEach((breakpoint, i) => {
    const breakpointUpper = breakpoint.toUpperCase();
    const screenMin = `screen${breakpointUpper}Min`;
    const screen = `screen${breakpointUpper}`;
    if (!(indexableToken[screenMin] <= indexableToken[screen])) {
      throw new Error(`${screenMin}<=${screen} fails : !(${indexableToken[screenMin]}<=${indexableToken[screen]})`);
    }
    if (i < revBreakpoints.length - 1) {
      const screenMax = `screen${breakpointUpper}Max`;
      if (!(indexableToken[screen] <= indexableToken[screenMax])) {
        throw new Error(`${screen}<=${screenMax} fails : !(${indexableToken[screen]}<=${indexableToken[screenMax]})`);
      }
      const nextBreakpointUpperMin = revBreakpoints[i + 1].toUpperCase();
      const nextScreenMin = `screen${nextBreakpointUpperMin}Min`;
      if (!(indexableToken[screenMax] <= indexableToken[nextScreenMin])) {
        throw new Error(`${screenMax}<=${nextScreenMin} fails : !(${indexableToken[screenMax]}<=${indexableToken[nextScreenMin]})`);
      }
    }
  });
  return token;
};
function useResponsiveObserver() {
  const [, token] = (0,_theme_internal__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .Ay)();
  const responsiveMap = getResponsiveMap(validateBreakpoints(token));
  // To avoid repeat create instance, we add `useMemo` here.
  return react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    const subscribers = new Map();
    let subUid = -1;
    let screens = {};
    return {
      matchHandlers: {},
      dispatch(pointMap) {
        screens = pointMap;
        subscribers.forEach(func => func(screens));
        return subscribers.size >= 1;
      },
      subscribe(func) {
        if (!subscribers.size) this.register();
        subUid += 1;
        subscribers.set(subUid, func);
        func(screens);
        return subUid;
      },
      unsubscribe(paramToken) {
        subscribers.delete(paramToken);
        if (!subscribers.size) this.unregister();
      },
      unregister() {
        Object.keys(responsiveMap).forEach(screen => {
          const matchMediaQuery = responsiveMap[screen];
          const handler = this.matchHandlers[matchMediaQuery];
          handler === null || handler === void 0 ? void 0 : handler.mql.removeListener(handler === null || handler === void 0 ? void 0 : handler.listener);
        });
        subscribers.clear();
      },
      register() {
        Object.keys(responsiveMap).forEach(screen => {
          const matchMediaQuery = responsiveMap[screen];
          const listener = _ref => {
            let {
              matches
            } = _ref;
            this.dispatch(Object.assign(Object.assign({}, screens), {
              [screen]: matches
            }));
          };
          const mql = window.matchMedia(matchMediaQuery);
          mql.addListener(listener);
          this.matchHandlers[matchMediaQuery] = {
            mql,
            listener
          };
          listener(mql);
        });
      },
      responsiveMap
    };
  }, [token]);
}
const matchScreen = (screens, screenSizes) => {
  if (screenSizes && typeof screenSizes === 'object') {
    for (let i = 0; i < responsiveArray.length; i++) {
      const breakpoint = responsiveArray[i];
      if (screens[breakpoint] && screenSizes[breakpoint] !== undefined) {
        return screenSizes[breakpoint];
      }
    }
  }
};

/***/ }),

/***/ 78551:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var rc_util_es_hooks_useLayoutEffect__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(30981);
/* harmony import */ var _util_hooks_useForceUpdate__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(47447);
/* harmony import */ var _util_responsiveObserver__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(24945);
"use client";





function useBreakpoint() {
  let refreshOnChange = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;
  const screensRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)({});
  const forceUpdate = (0,_util_hooks_useForceUpdate__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)();
  const responsiveObserver = (0,_util_responsiveObserver__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .Ay)();
  (0,rc_util_es_hooks_useLayoutEffect__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)(() => {
    const token = responsiveObserver.subscribe(supportScreens => {
      screensRef.current = supportScreens;
      if (refreshOnChange) {
        forceUpdate();
      }
    });
    return () => responsiveObserver.unsubscribe(token);
  }, []);
  return screensRef.current;
}
/* harmony default export */ __webpack_exports__.A = (useBreakpoint);

/***/ }),

/***/ 9149:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ pagination; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
;// ./node_modules/@ant-design/icons-svg/es/asn/DoubleLeftOutlined.js
// This icon file is generated automatically.
var DoubleLeftOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M272.9 512l265.4-339.1c4.1-5.2.4-12.9-6.3-12.9h-77.3c-4.9 0-9.6 2.3-12.6 6.1L186.8 492.3a31.99 31.99 0 000 39.5l255.3 326.1c3 3.9 7.7 6.1 12.6 6.1H532c6.7 0 10.4-7.7 6.3-12.9L272.9 512zm304 0l265.4-339.1c4.1-5.2.4-12.9-6.3-12.9h-77.3c-4.9 0-9.6 2.3-12.6 6.1L490.8 492.3a31.99 31.99 0 000 39.5l255.3 326.1c3 3.9 7.7 6.1 12.6 6.1H836c6.7 0 10.4-7.7 6.3-12.9L576.9 512z" } }] }, "name": "double-left", "theme": "outlined" };
/* harmony default export */ var asn_DoubleLeftOutlined = (DoubleLeftOutlined);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/DoubleLeftOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var DoubleLeftOutlined_DoubleLeftOutlined = function DoubleLeftOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_DoubleLeftOutlined
  }));
};

/**![double-left](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTI3Mi45IDUxMmwyNjUuNC0zMzkuMWM0LjEtNS4yLjQtMTIuOS02LjMtMTIuOWgtNzcuM2MtNC45IDAtOS42IDIuMy0xMi42IDYuMUwxODYuOCA0OTIuM2EzMS45OSAzMS45OSAwIDAwMCAzOS41bDI1NS4zIDMyNi4xYzMgMy45IDcuNyA2LjEgMTIuNiA2LjFINTMyYzYuNyAwIDEwLjQtNy43IDYuMy0xMi45TDI3Mi45IDUxMnptMzA0IDBsMjY1LjQtMzM5LjFjNC4xLTUuMi40LTEyLjktNi4zLTEyLjloLTc3LjNjLTQuOSAwLTkuNiAyLjMtMTIuNiA2LjFMNDkwLjggNDkyLjNhMzEuOTkgMzEuOTkgMCAwMDAgMzkuNWwyNTUuMyAzMjYuMWMzIDMuOSA3LjcgNi4xIDEyLjYgNi4xSDgzNmM2LjcgMCAxMC40LTcuNyA2LjMtMTIuOUw1NzYuOSA1MTJ6IiAvPjwvc3ZnPg==) */
var RefIcon = /*#__PURE__*/react.forwardRef(DoubleLeftOutlined_DoubleLeftOutlined);
if (false) {}
/* harmony default export */ var icons_DoubleLeftOutlined = (RefIcon);
;// ./node_modules/@ant-design/icons-svg/es/asn/DoubleRightOutlined.js
// This icon file is generated automatically.
var DoubleRightOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M533.2 492.3L277.9 166.1c-3-3.9-7.7-6.1-12.6-6.1H188c-6.7 0-10.4 7.7-6.3 12.9L447.1 512 181.7 851.1A7.98 7.98 0 00188 864h77.3c4.9 0 9.6-2.3 12.6-6.1l255.3-326.1c9.1-11.7 9.1-27.9 0-39.5zm304 0L581.9 166.1c-3-3.9-7.7-6.1-12.6-6.1H492c-6.7 0-10.4 7.7-6.3 12.9L751.1 512 485.7 851.1A7.98 7.98 0 00492 864h77.3c4.9 0 9.6-2.3 12.6-6.1l255.3-326.1c9.1-11.7 9.1-27.9 0-39.5z" } }] }, "name": "double-right", "theme": "outlined" };
/* harmony default export */ var asn_DoubleRightOutlined = (DoubleRightOutlined);

;// ./node_modules/@ant-design/icons/es/icons/DoubleRightOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var DoubleRightOutlined_DoubleRightOutlined = function DoubleRightOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_DoubleRightOutlined
  }));
};

/**![double-right](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTUzMy4yIDQ5Mi4zTDI3Ny45IDE2Ni4xYy0zLTMuOS03LjctNi4xLTEyLjYtNi4xSDE4OGMtNi43IDAtMTAuNCA3LjctNi4zIDEyLjlMNDQ3LjEgNTEyIDE4MS43IDg1MS4xQTcuOTggNy45OCAwIDAwMTg4IDg2NGg3Ny4zYzQuOSAwIDkuNi0yLjMgMTIuNi02LjFsMjU1LjMtMzI2LjFjOS4xLTExLjcgOS4xLTI3LjkgMC0zOS41em0zMDQgMEw1ODEuOSAxNjYuMWMtMy0zLjktNy43LTYuMS0xMi42LTYuMUg0OTJjLTYuNyAwLTEwLjQgNy43LTYuMyAxMi45TDc1MS4xIDUxMiA0ODUuNyA4NTEuMUE3Ljk4IDcuOTggMCAwMDQ5MiA4NjRoNzcuM2M0LjkgMCA5LjYtMi4zIDEyLjYtNi4xbDI1NS4zLTMyNi4xYzkuMS0xMS43IDkuMS0yNy45IDAtMzkuNXoiIC8+PC9zdmc+) */
var DoubleRightOutlined_RefIcon = /*#__PURE__*/react.forwardRef(DoubleRightOutlined_DoubleRightOutlined);
if (false) {}
/* harmony default export */ var icons_DoubleRightOutlined = (DoubleRightOutlined_RefIcon);
;// ./node_modules/@ant-design/icons-svg/es/asn/LeftOutlined.js
// This icon file is generated automatically.
var LeftOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M724 218.3V141c0-6.7-7.7-10.4-12.9-6.3L260.3 486.8a31.86 31.86 0 000 50.3l450.8 352.1c5.3 4.1 12.9.4 12.9-6.3v-77.3c0-4.9-2.3-9.6-6.1-12.6l-360-281 360-281.1c3.8-3 6.1-7.7 6.1-12.6z" } }] }, "name": "left", "theme": "outlined" };
/* harmony default export */ var asn_LeftOutlined = (LeftOutlined);

;// ./node_modules/@ant-design/icons/es/icons/LeftOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var LeftOutlined_LeftOutlined = function LeftOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_LeftOutlined
  }));
};

/**![left](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTcyNCAyMTguM1YxNDFjMC02LjctNy43LTEwLjQtMTIuOS02LjNMMjYwLjMgNDg2LjhhMzEuODYgMzEuODYgMCAwMDAgNTAuM2w0NTAuOCAzNTIuMWM1LjMgNC4xIDEyLjkuNCAxMi45LTYuM3YtNzcuM2MwLTQuOS0yLjMtOS42LTYuMS0xMi42bC0zNjAtMjgxIDM2MC0yODEuMWMzLjgtMyA2LjEtNy43IDYuMS0xMi42eiIgLz48L3N2Zz4=) */
var LeftOutlined_RefIcon = /*#__PURE__*/react.forwardRef(LeftOutlined_LeftOutlined);
if (false) {}
/* harmony default export */ var icons_LeftOutlined = (LeftOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/RightOutlined.js + 1 modules
var RightOutlined = __webpack_require__(68000);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/typeof.js
var esm_typeof = __webpack_require__(82284);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectSpread2.js
var objectSpread2 = __webpack_require__(89379);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
// EXTERNAL MODULE: ./node_modules/rc-util/es/KeyCode.js
var KeyCode = __webpack_require__(16928);
// EXTERNAL MODULE: ./node_modules/rc-util/es/pickAttrs.js
var pickAttrs = __webpack_require__(72065);
// EXTERNAL MODULE: ./node_modules/rc-util/es/warning.js
var warning = __webpack_require__(68210);
;// ./node_modules/rc-pagination/es/locale/zh_CN.js
var locale = {
  // Options
  items_per_page: '条/页',
  jump_to: '跳至',
  jump_to_confirm: '确定',
  page: '页',
  // Pagination
  prev_page: '上一页',
  next_page: '下一页',
  prev_5: '向前 5 页',
  next_5: '向后 5 页',
  prev_3: '向前 3 页',
  next_3: '向后 3 页',
  page_size: '页码'
};
/* harmony default export */ var zh_CN = (locale);
;// ./node_modules/rc-pagination/es/Options.js



var defaultPageSizeOptions = [10, 20, 50, 100];
var Options = function Options(props) {
  var _props$pageSizeOption = props.pageSizeOptions,
    pageSizeOptions = _props$pageSizeOption === void 0 ? defaultPageSizeOptions : _props$pageSizeOption,
    locale = props.locale,
    changeSize = props.changeSize,
    pageSize = props.pageSize,
    goButton = props.goButton,
    quickGo = props.quickGo,
    rootPrefixCls = props.rootPrefixCls,
    disabled = props.disabled,
    buildOptionText = props.buildOptionText,
    showSizeChanger = props.showSizeChanger,
    sizeChangerRender = props.sizeChangerRender;
  var _React$useState = react.useState(''),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    goInputText = _React$useState2[0],
    setGoInputText = _React$useState2[1];
  var getValidValue = function getValidValue() {
    return !goInputText || Number.isNaN(goInputText) ? undefined : Number(goInputText);
  };
  var mergeBuildOptionText = typeof buildOptionText === 'function' ? buildOptionText : function (value) {
    return "".concat(value, " ").concat(locale.items_per_page);
  };
  var handleChange = function handleChange(e) {
    setGoInputText(e.target.value);
  };
  var handleBlur = function handleBlur(e) {
    if (goButton || goInputText === '') {
      return;
    }
    setGoInputText('');
    if (e.relatedTarget && (e.relatedTarget.className.indexOf("".concat(rootPrefixCls, "-item-link")) >= 0 || e.relatedTarget.className.indexOf("".concat(rootPrefixCls, "-item")) >= 0)) {
      return;
    }
    quickGo === null || quickGo === void 0 || quickGo(getValidValue());
  };
  var go = function go(e) {
    if (goInputText === '') {
      return;
    }
    if (e.keyCode === KeyCode/* default */.A.ENTER || e.type === 'click') {
      setGoInputText('');
      quickGo === null || quickGo === void 0 || quickGo(getValidValue());
    }
  };
  var getPageSizeOptions = function getPageSizeOptions() {
    if (pageSizeOptions.some(function (option) {
      return option.toString() === pageSize.toString();
    })) {
      return pageSizeOptions;
    }
    return pageSizeOptions.concat([pageSize]).sort(function (a, b) {
      var numberA = Number.isNaN(Number(a)) ? 0 : Number(a);
      var numberB = Number.isNaN(Number(b)) ? 0 : Number(b);
      return numberA - numberB;
    });
  };
  // ============== cls ==============
  var prefixCls = "".concat(rootPrefixCls, "-options");

  // ============== render ==============

  if (!showSizeChanger && !quickGo) {
    return null;
  }
  var changeSelect = null;
  var goInput = null;
  var gotoButton = null;

  // >>>>> Size Changer
  if (showSizeChanger && sizeChangerRender) {
    changeSelect = sizeChangerRender({
      disabled: disabled,
      size: pageSize,
      onSizeChange: function onSizeChange(nextValue) {
        changeSize === null || changeSize === void 0 || changeSize(Number(nextValue));
      },
      'aria-label': locale.page_size,
      className: "".concat(prefixCls, "-size-changer"),
      options: getPageSizeOptions().map(function (opt) {
        return {
          label: mergeBuildOptionText(opt),
          value: opt
        };
      })
    });
  }

  // >>>>> Quick Go
  if (quickGo) {
    if (goButton) {
      gotoButton = typeof goButton === 'boolean' ? /*#__PURE__*/react.createElement("button", {
        type: "button",
        onClick: go,
        onKeyUp: go,
        disabled: disabled,
        className: "".concat(prefixCls, "-quick-jumper-button")
      }, locale.jump_to_confirm) : /*#__PURE__*/react.createElement("span", {
        onClick: go,
        onKeyUp: go
      }, goButton);
    }
    goInput = /*#__PURE__*/react.createElement("div", {
      className: "".concat(prefixCls, "-quick-jumper")
    }, locale.jump_to, /*#__PURE__*/react.createElement("input", {
      disabled: disabled,
      type: "text",
      value: goInputText,
      onChange: handleChange,
      onKeyUp: go,
      onBlur: handleBlur,
      "aria-label": locale.page
    }), locale.page, gotoButton);
  }
  return /*#__PURE__*/react.createElement("li", {
    className: prefixCls
  }, changeSelect, goInput);
};
if (false) {}
/* harmony default export */ var es_Options = (Options);
;// ./node_modules/rc-pagination/es/Pager.js

/* eslint react/prop-types: 0 */


var Pager = function Pager(props) {
  var _classNames;
  var rootPrefixCls = props.rootPrefixCls,
    page = props.page,
    active = props.active,
    className = props.className,
    showTitle = props.showTitle,
    onClick = props.onClick,
    onKeyPress = props.onKeyPress,
    itemRender = props.itemRender;
  var prefixCls = "".concat(rootPrefixCls, "-item");
  var cls = classnames_default()(prefixCls, "".concat(prefixCls, "-").concat(page), (_classNames = {}, (0,defineProperty/* default */.A)(_classNames, "".concat(prefixCls, "-active"), active), (0,defineProperty/* default */.A)(_classNames, "".concat(prefixCls, "-disabled"), !page), _classNames), className);
  var handleClick = function handleClick() {
    onClick(page);
  };
  var handleKeyPress = function handleKeyPress(e) {
    onKeyPress(e, onClick, page);
  };
  var pager = itemRender(page, 'page', /*#__PURE__*/react.createElement("a", {
    rel: "nofollow"
  }, page));
  return pager ? /*#__PURE__*/react.createElement("li", {
    title: showTitle ? String(page) : null,
    className: cls,
    onClick: handleClick,
    onKeyDown: handleKeyPress,
    tabIndex: 0
  }, pager) : null;
};
if (false) {}
/* harmony default export */ var es_Pager = (Pager);
;// ./node_modules/rc-pagination/es/Pagination.js














var defaultItemRender = function defaultItemRender(page, type, element) {
  return element;
};
function noop() {}
function isInteger(v) {
  var value = Number(v);
  return typeof value === 'number' && !Number.isNaN(value) && isFinite(value) && Math.floor(value) === value;
}
function calculatePage(p, pageSize, total) {
  var _pageSize = typeof p === 'undefined' ? pageSize : p;
  return Math.floor((total - 1) / _pageSize) + 1;
}
var Pagination = function Pagination(props) {
  var _classNames5;
  var _props$prefixCls = props.prefixCls,
    prefixCls = _props$prefixCls === void 0 ? 'rc-pagination' : _props$prefixCls,
    _props$selectPrefixCl = props.selectPrefixCls,
    selectPrefixCls = _props$selectPrefixCl === void 0 ? 'rc-select' : _props$selectPrefixCl,
    className = props.className,
    currentProp = props.current,
    _props$defaultCurrent = props.defaultCurrent,
    defaultCurrent = _props$defaultCurrent === void 0 ? 1 : _props$defaultCurrent,
    _props$total = props.total,
    total = _props$total === void 0 ? 0 : _props$total,
    pageSizeProp = props.pageSize,
    _props$defaultPageSiz = props.defaultPageSize,
    defaultPageSize = _props$defaultPageSiz === void 0 ? 10 : _props$defaultPageSiz,
    _props$onChange = props.onChange,
    onChange = _props$onChange === void 0 ? noop : _props$onChange,
    hideOnSinglePage = props.hideOnSinglePage,
    align = props.align,
    _props$showPrevNextJu = props.showPrevNextJumpers,
    showPrevNextJumpers = _props$showPrevNextJu === void 0 ? true : _props$showPrevNextJu,
    showQuickJumper = props.showQuickJumper,
    showLessItems = props.showLessItems,
    _props$showTitle = props.showTitle,
    showTitle = _props$showTitle === void 0 ? true : _props$showTitle,
    _props$onShowSizeChan = props.onShowSizeChange,
    onShowSizeChange = _props$onShowSizeChan === void 0 ? noop : _props$onShowSizeChan,
    _props$locale = props.locale,
    locale = _props$locale === void 0 ? zh_CN : _props$locale,
    style = props.style,
    _props$totalBoundaryS = props.totalBoundaryShowSizeChanger,
    totalBoundaryShowSizeChanger = _props$totalBoundaryS === void 0 ? 50 : _props$totalBoundaryS,
    disabled = props.disabled,
    simple = props.simple,
    showTotal = props.showTotal,
    _props$showSizeChange = props.showSizeChanger,
    showSizeChanger = _props$showSizeChange === void 0 ? total > totalBoundaryShowSizeChanger : _props$showSizeChange,
    sizeChangerRender = props.sizeChangerRender,
    pageSizeOptions = props.pageSizeOptions,
    _props$itemRender = props.itemRender,
    itemRender = _props$itemRender === void 0 ? defaultItemRender : _props$itemRender,
    jumpPrevIcon = props.jumpPrevIcon,
    jumpNextIcon = props.jumpNextIcon,
    prevIcon = props.prevIcon,
    nextIcon = props.nextIcon;
  var paginationRef = react.useRef(null);
  var _useMergedState = (0,useMergedState/* default */.A)(10, {
      value: pageSizeProp,
      defaultValue: defaultPageSize
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    pageSize = _useMergedState2[0],
    setPageSize = _useMergedState2[1];
  var _useMergedState3 = (0,useMergedState/* default */.A)(1, {
      value: currentProp,
      defaultValue: defaultCurrent,
      postState: function postState(c) {
        return Math.max(1, Math.min(c, calculatePage(undefined, pageSize, total)));
      }
    }),
    _useMergedState4 = (0,slicedToArray/* default */.A)(_useMergedState3, 2),
    current = _useMergedState4[0],
    setCurrent = _useMergedState4[1];
  var _React$useState = react.useState(current),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    internalInputVal = _React$useState2[0],
    setInternalInputVal = _React$useState2[1];
  (0,react.useEffect)(function () {
    setInternalInputVal(current);
  }, [current]);
  var hasOnChange = onChange !== noop;
  var hasCurrent = ('current' in props);
  if (false) {}
  var jumpPrevPage = Math.max(1, current - (showLessItems ? 3 : 5));
  var jumpNextPage = Math.min(calculatePage(undefined, pageSize, total), current + (showLessItems ? 3 : 5));
  function getItemIcon(icon, label) {
    var iconNode = icon || /*#__PURE__*/react.createElement("button", {
      type: "button",
      "aria-label": label,
      className: "".concat(prefixCls, "-item-link")
    });
    if (typeof icon === 'function') {
      iconNode = /*#__PURE__*/react.createElement(icon, (0,objectSpread2/* default */.A)({}, props));
    }
    return iconNode;
  }
  function getValidValue(e) {
    var inputValue = e.target.value;
    var allPages = calculatePage(undefined, pageSize, total);
    var value;
    if (inputValue === '') {
      value = inputValue;
    } else if (Number.isNaN(Number(inputValue))) {
      value = internalInputVal;
    } else if (inputValue >= allPages) {
      value = allPages;
    } else {
      value = Number(inputValue);
    }
    return value;
  }
  function isValid(page) {
    return isInteger(page) && page !== current && isInteger(total) && total > 0;
  }
  var shouldDisplayQuickJumper = total > pageSize ? showQuickJumper : false;

  /**
   * prevent "up arrow" key reseting cursor position within textbox
   * @see https://stackoverflow.com/a/1081114
   */
  function handleKeyDown(event) {
    if (event.keyCode === KeyCode/* default */.A.UP || event.keyCode === KeyCode/* default */.A.DOWN) {
      event.preventDefault();
    }
  }
  function handleKeyUp(event) {
    var value = getValidValue(event);
    if (value !== internalInputVal) {
      setInternalInputVal(value);
    }
    switch (event.keyCode) {
      case KeyCode/* default */.A.ENTER:
        handleChange(value);
        break;
      case KeyCode/* default */.A.UP:
        handleChange(value - 1);
        break;
      case KeyCode/* default */.A.DOWN:
        handleChange(value + 1);
        break;
      default:
        break;
    }
  }
  function handleBlur(event) {
    handleChange(getValidValue(event));
  }
  function changePageSize(size) {
    var newCurrent = calculatePage(size, pageSize, total);
    var nextCurrent = current > newCurrent && newCurrent !== 0 ? newCurrent : current;
    setPageSize(size);
    setInternalInputVal(nextCurrent);
    onShowSizeChange === null || onShowSizeChange === void 0 || onShowSizeChange(current, size);
    setCurrent(nextCurrent);
    onChange === null || onChange === void 0 || onChange(nextCurrent, size);
  }
  function handleChange(page) {
    if (isValid(page) && !disabled) {
      var currentPage = calculatePage(undefined, pageSize, total);
      var newPage = page;
      if (page > currentPage) {
        newPage = currentPage;
      } else if (page < 1) {
        newPage = 1;
      }
      if (newPage !== internalInputVal) {
        setInternalInputVal(newPage);
      }
      setCurrent(newPage);
      onChange === null || onChange === void 0 || onChange(newPage, pageSize);
      return newPage;
    }
    return current;
  }
  var hasPrev = current > 1;
  var hasNext = current < calculatePage(undefined, pageSize, total);
  function prevHandle() {
    if (hasPrev) handleChange(current - 1);
  }
  function nextHandle() {
    if (hasNext) handleChange(current + 1);
  }
  function jumpPrevHandle() {
    handleChange(jumpPrevPage);
  }
  function jumpNextHandle() {
    handleChange(jumpNextPage);
  }
  function runIfEnter(event, callback) {
    if (event.key === 'Enter' || event.charCode === KeyCode/* default */.A.ENTER || event.keyCode === KeyCode/* default */.A.ENTER) {
      for (var _len = arguments.length, restParams = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) {
        restParams[_key - 2] = arguments[_key];
      }
      callback.apply(void 0, restParams);
    }
  }
  function runIfEnterPrev(event) {
    runIfEnter(event, prevHandle);
  }
  function runIfEnterNext(event) {
    runIfEnter(event, nextHandle);
  }
  function runIfEnterJumpPrev(event) {
    runIfEnter(event, jumpPrevHandle);
  }
  function runIfEnterJumpNext(event) {
    runIfEnter(event, jumpNextHandle);
  }
  function renderPrev(prevPage) {
    var prevButton = itemRender(prevPage, 'prev', getItemIcon(prevIcon, 'prev page'));
    return /*#__PURE__*/react.isValidElement(prevButton) ? /*#__PURE__*/react.cloneElement(prevButton, {
      disabled: !hasPrev
    }) : prevButton;
  }
  function renderNext(nextPage) {
    var nextButton = itemRender(nextPage, 'next', getItemIcon(nextIcon, 'next page'));
    return /*#__PURE__*/react.isValidElement(nextButton) ? /*#__PURE__*/react.cloneElement(nextButton, {
      disabled: !hasNext
    }) : nextButton;
  }
  function handleGoTO(event) {
    if (event.type === 'click' || event.keyCode === KeyCode/* default */.A.ENTER) {
      handleChange(internalInputVal);
    }
  }
  var jumpPrev = null;
  var dataOrAriaAttributeProps = (0,pickAttrs/* default */.A)(props, {
    aria: true,
    data: true
  });
  var totalText = showTotal && /*#__PURE__*/react.createElement("li", {
    className: "".concat(prefixCls, "-total-text")
  }, showTotal(total, [total === 0 ? 0 : (current - 1) * pageSize + 1, current * pageSize > total ? total : current * pageSize]));
  var jumpNext = null;
  var allPages = calculatePage(undefined, pageSize, total);

  // ================== Render ==================
  // When hideOnSinglePage is true and there is only 1 page, hide the pager
  if (hideOnSinglePage && total <= pageSize) {
    return null;
  }
  var pagerList = [];
  var pagerProps = {
    rootPrefixCls: prefixCls,
    onClick: handleChange,
    onKeyPress: runIfEnter,
    showTitle: showTitle,
    itemRender: itemRender,
    page: -1
  };
  var prevPage = current - 1 > 0 ? current - 1 : 0;
  var nextPage = current + 1 < allPages ? current + 1 : allPages;
  var goButton = showQuickJumper && showQuickJumper.goButton;

  // ================== Simple ==================
  // FIXME: ts type
  var isReadOnly = (0,esm_typeof/* default */.A)(simple) === 'object' ? simple.readOnly : !simple;
  var gotoButton = goButton;
  var simplePager = null;
  if (simple) {
    // ====== Simple quick jump ======
    if (goButton) {
      if (typeof goButton === 'boolean') {
        gotoButton = /*#__PURE__*/react.createElement("button", {
          type: "button",
          onClick: handleGoTO,
          onKeyUp: handleGoTO
        }, locale.jump_to_confirm);
      } else {
        gotoButton = /*#__PURE__*/react.createElement("span", {
          onClick: handleGoTO,
          onKeyUp: handleGoTO
        }, goButton);
      }
      gotoButton = /*#__PURE__*/react.createElement("li", {
        title: showTitle ? "".concat(locale.jump_to).concat(current, "/").concat(allPages) : null,
        className: "".concat(prefixCls, "-simple-pager")
      }, gotoButton);
    }
    simplePager = /*#__PURE__*/react.createElement("li", {
      title: showTitle ? "".concat(current, "/").concat(allPages) : null,
      className: "".concat(prefixCls, "-simple-pager")
    }, isReadOnly ? internalInputVal : /*#__PURE__*/react.createElement("input", {
      type: "text",
      value: internalInputVal,
      disabled: disabled,
      onKeyDown: handleKeyDown,
      onKeyUp: handleKeyUp,
      onChange: handleKeyUp,
      onBlur: handleBlur,
      size: 3
    }), /*#__PURE__*/react.createElement("span", {
      className: "".concat(prefixCls, "-slash")
    }, "/"), allPages);
  }

  // ====================== Normal ======================
  var pageBufferSize = showLessItems ? 1 : 2;
  if (allPages <= 3 + pageBufferSize * 2) {
    if (!allPages) {
      pagerList.push( /*#__PURE__*/react.createElement(es_Pager, (0,esm_extends/* default */.A)({}, pagerProps, {
        key: "noPager",
        page: 1,
        className: "".concat(prefixCls, "-item-disabled")
      })));
    }
    for (var i = 1; i <= allPages; i += 1) {
      pagerList.push( /*#__PURE__*/react.createElement(es_Pager, (0,esm_extends/* default */.A)({}, pagerProps, {
        key: i,
        page: i,
        active: current === i
      })));
    }
  } else {
    var prevItemTitle = showLessItems ? locale.prev_3 : locale.prev_5;
    var nextItemTitle = showLessItems ? locale.next_3 : locale.next_5;
    var jumpPrevContent = itemRender(jumpPrevPage, 'jump-prev', getItemIcon(jumpPrevIcon, 'prev page'));
    var jumpNextContent = itemRender(jumpNextPage, 'jump-next', getItemIcon(jumpNextIcon, 'next page'));
    if (showPrevNextJumpers) {
      jumpPrev = jumpPrevContent ? /*#__PURE__*/react.createElement("li", {
        title: showTitle ? prevItemTitle : null,
        key: "prev",
        onClick: jumpPrevHandle,
        tabIndex: 0,
        onKeyDown: runIfEnterJumpPrev,
        className: classnames_default()("".concat(prefixCls, "-jump-prev"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-jump-prev-custom-icon"), !!jumpPrevIcon))
      }, jumpPrevContent) : null;
      jumpNext = jumpNextContent ? /*#__PURE__*/react.createElement("li", {
        title: showTitle ? nextItemTitle : null,
        key: "next",
        onClick: jumpNextHandle,
        tabIndex: 0,
        onKeyDown: runIfEnterJumpNext,
        className: classnames_default()("".concat(prefixCls, "-jump-next"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-jump-next-custom-icon"), !!jumpNextIcon))
      }, jumpNextContent) : null;
    }
    var left = Math.max(1, current - pageBufferSize);
    var right = Math.min(current + pageBufferSize, allPages);
    if (current - 1 <= pageBufferSize) {
      right = 1 + pageBufferSize * 2;
    }
    if (allPages - current <= pageBufferSize) {
      left = allPages - pageBufferSize * 2;
    }
    for (var _i = left; _i <= right; _i += 1) {
      pagerList.push( /*#__PURE__*/react.createElement(es_Pager, (0,esm_extends/* default */.A)({}, pagerProps, {
        key: _i,
        page: _i,
        active: current === _i
      })));
    }
    if (current - 1 >= pageBufferSize * 2 && current !== 1 + 2) {
      pagerList[0] = /*#__PURE__*/react.cloneElement(pagerList[0], {
        className: classnames_default()("".concat(prefixCls, "-item-after-jump-prev"), pagerList[0].props.className)
      });
      pagerList.unshift(jumpPrev);
    }
    if (allPages - current >= pageBufferSize * 2 && current !== allPages - 2) {
      var lastOne = pagerList[pagerList.length - 1];
      pagerList[pagerList.length - 1] = /*#__PURE__*/react.cloneElement(lastOne, {
        className: classnames_default()("".concat(prefixCls, "-item-before-jump-next"), lastOne.props.className)
      });
      pagerList.push(jumpNext);
    }
    if (left !== 1) {
      pagerList.unshift( /*#__PURE__*/react.createElement(es_Pager, (0,esm_extends/* default */.A)({}, pagerProps, {
        key: 1,
        page: 1
      })));
    }
    if (right !== allPages) {
      pagerList.push( /*#__PURE__*/react.createElement(es_Pager, (0,esm_extends/* default */.A)({}, pagerProps, {
        key: allPages,
        page: allPages
      })));
    }
  }
  var prev = renderPrev(prevPage);
  if (prev) {
    var prevDisabled = !hasPrev || !allPages;
    prev = /*#__PURE__*/react.createElement("li", {
      title: showTitle ? locale.prev_page : null,
      onClick: prevHandle,
      tabIndex: prevDisabled ? null : 0,
      onKeyDown: runIfEnterPrev,
      className: classnames_default()("".concat(prefixCls, "-prev"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-disabled"), prevDisabled)),
      "aria-disabled": prevDisabled
    }, prev);
  }
  var next = renderNext(nextPage);
  if (next) {
    var nextDisabled, nextTabIndex;
    if (simple) {
      nextDisabled = !hasNext;
      nextTabIndex = hasPrev ? 0 : null;
    } else {
      nextDisabled = !hasNext || !allPages;
      nextTabIndex = nextDisabled ? null : 0;
    }
    next = /*#__PURE__*/react.createElement("li", {
      title: showTitle ? locale.next_page : null,
      onClick: nextHandle,
      tabIndex: nextTabIndex,
      onKeyDown: runIfEnterNext,
      className: classnames_default()("".concat(prefixCls, "-next"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-disabled"), nextDisabled)),
      "aria-disabled": nextDisabled
    }, next);
  }
  var cls = classnames_default()(prefixCls, className, (_classNames5 = {}, (0,defineProperty/* default */.A)(_classNames5, "".concat(prefixCls, "-start"), align === 'start'), (0,defineProperty/* default */.A)(_classNames5, "".concat(prefixCls, "-center"), align === 'center'), (0,defineProperty/* default */.A)(_classNames5, "".concat(prefixCls, "-end"), align === 'end'), (0,defineProperty/* default */.A)(_classNames5, "".concat(prefixCls, "-simple"), simple), (0,defineProperty/* default */.A)(_classNames5, "".concat(prefixCls, "-disabled"), disabled), _classNames5));
  return /*#__PURE__*/react.createElement("ul", (0,esm_extends/* default */.A)({
    className: cls,
    style: style,
    ref: paginationRef
  }, dataOrAriaAttributeProps), totalText, prev, simple ? simplePager : pagerList, next, /*#__PURE__*/react.createElement(es_Options, {
    locale: locale,
    rootPrefixCls: prefixCls,
    disabled: disabled,
    selectPrefixCls: selectPrefixCls,
    changeSize: changePageSize,
    pageSize: pageSize,
    pageSizeOptions: pageSizeOptions,
    quickGo: shouldDisplayQuickJumper ? handleChange : null,
    goButton: gotoButton,
    showSizeChanger: showSizeChanger,
    sizeChangerRender: sizeChangerRender
  }));
};
if (false) {}
/* harmony default export */ var es_Pagination = (Pagination);
;// ./node_modules/rc-pagination/es/index.js

// EXTERNAL MODULE: ./node_modules/rc-pagination/es/locale/en_US.js
var en_US = __webpack_require__(96069);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
// EXTERNAL MODULE: ./node_modules/antd/es/grid/hooks/useBreakpoint.js
var useBreakpoint = __webpack_require__(78551);
// EXTERNAL MODULE: ./node_modules/antd/es/locale/useLocale.js
var useLocale = __webpack_require__(19155);
// EXTERNAL MODULE: ./node_modules/antd/es/select/index.js + 40 modules
var es_select = __webpack_require__(85319);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/useToken.js + 2 modules
var useToken = __webpack_require__(11320);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/input/style/index.js
var style = __webpack_require__(81594);
// EXTERNAL MODULE: ./node_modules/antd/es/input/style/token.js
var style_token = __webpack_require__(44335);
// EXTERNAL MODULE: ./node_modules/antd/es/input/style/variants.js
var variants = __webpack_require__(89222);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var es_style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
;// ./node_modules/antd/es/pagination/style/index.js





const genPaginationDisabledStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}-disabled`]: {
      '&, &:hover': {
        cursor: 'not-allowed',
        [`${componentCls}-item-link`]: {
          color: token.colorTextDisabled,
          cursor: 'not-allowed'
        }
      },
      '&:focus-visible': {
        cursor: 'not-allowed',
        [`${componentCls}-item-link`]: {
          color: token.colorTextDisabled,
          cursor: 'not-allowed'
        }
      }
    },
    [`&${componentCls}-disabled`]: {
      cursor: 'not-allowed',
      [`${componentCls}-item`]: {
        cursor: 'not-allowed',
        '&:hover, &:active': {
          backgroundColor: 'transparent'
        },
        a: {
          color: token.colorTextDisabled,
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'not-allowed'
        },
        '&-active': {
          borderColor: token.colorBorder,
          backgroundColor: token.itemActiveBgDisabled,
          '&:hover, &:active': {
            backgroundColor: token.itemActiveBgDisabled
          },
          a: {
            color: token.itemActiveColorDisabled
          }
        }
      },
      [`${componentCls}-item-link`]: {
        color: token.colorTextDisabled,
        cursor: 'not-allowed',
        '&:hover, &:active': {
          backgroundColor: 'transparent'
        },
        [`${componentCls}-simple&`]: {
          backgroundColor: 'transparent',
          '&:hover, &:active': {
            backgroundColor: 'transparent'
          }
        }
      },
      [`${componentCls}-simple-pager`]: {
        color: token.colorTextDisabled
      },
      [`${componentCls}-jump-prev, ${componentCls}-jump-next`]: {
        [`${componentCls}-item-link-icon`]: {
          opacity: 0
        },
        [`${componentCls}-item-ellipsis`]: {
          opacity: 1
        }
      }
    },
    [`&${componentCls}-simple`]: {
      [`${componentCls}-prev, ${componentCls}-next`]: {
        [`&${componentCls}-disabled ${componentCls}-item-link`]: {
          '&:hover, &:active': {
            backgroundColor: 'transparent'
          }
        }
      }
    }
  };
};
const genPaginationMiniStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`&${componentCls}-mini ${componentCls}-total-text, &${componentCls}-mini ${componentCls}-simple-pager`]: {
      height: token.itemSizeSM,
      lineHeight: (0,es/* unit */.zA)(token.itemSizeSM)
    },
    [`&${componentCls}-mini ${componentCls}-item`]: {
      minWidth: token.itemSizeSM,
      height: token.itemSizeSM,
      margin: 0,
      lineHeight: (0,es/* unit */.zA)(token.calc(token.itemSizeSM).sub(2).equal())
    },
    [`&${componentCls}-mini:not(${componentCls}-disabled) ${componentCls}-item:not(${componentCls}-item-active)`]: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      '&:hover': {
        backgroundColor: token.colorBgTextHover
      },
      '&:active': {
        backgroundColor: token.colorBgTextActive
      }
    },
    [`&${componentCls}-mini ${componentCls}-prev, &${componentCls}-mini ${componentCls}-next`]: {
      minWidth: token.itemSizeSM,
      height: token.itemSizeSM,
      margin: 0,
      lineHeight: (0,es/* unit */.zA)(token.itemSizeSM)
    },
    [`&${componentCls}-mini:not(${componentCls}-disabled)`]: {
      [`${componentCls}-prev, ${componentCls}-next`]: {
        [`&:hover ${componentCls}-item-link`]: {
          backgroundColor: token.colorBgTextHover
        },
        [`&:active ${componentCls}-item-link`]: {
          backgroundColor: token.colorBgTextActive
        },
        [`&${componentCls}-disabled:hover ${componentCls}-item-link`]: {
          backgroundColor: 'transparent'
        }
      }
    },
    [`
    &${componentCls}-mini ${componentCls}-prev ${componentCls}-item-link,
    &${componentCls}-mini ${componentCls}-next ${componentCls}-item-link
    `]: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      '&::after': {
        height: token.itemSizeSM,
        lineHeight: (0,es/* unit */.zA)(token.itemSizeSM)
      }
    },
    [`&${componentCls}-mini ${componentCls}-jump-prev, &${componentCls}-mini ${componentCls}-jump-next`]: {
      height: token.itemSizeSM,
      marginInlineEnd: 0,
      lineHeight: (0,es/* unit */.zA)(token.itemSizeSM)
    },
    [`&${componentCls}-mini ${componentCls}-options`]: {
      marginInlineStart: token.paginationMiniOptionsMarginInlineStart,
      '&-size-changer': {
        top: token.miniOptionsSizeChangerTop
      },
      '&-quick-jumper': {
        height: token.itemSizeSM,
        lineHeight: (0,es/* unit */.zA)(token.itemSizeSM),
        input: Object.assign(Object.assign({}, (0,style/* genInputSmallStyle */.BZ)(token)), {
          width: token.paginationMiniQuickJumperInputWidth,
          height: token.controlHeightSM
        })
      }
    }
  };
};
const genPaginationSimpleStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`
    &${componentCls}-simple ${componentCls}-prev,
    &${componentCls}-simple ${componentCls}-next
    `]: {
      height: token.itemSizeSM,
      lineHeight: (0,es/* unit */.zA)(token.itemSizeSM),
      verticalAlign: 'top',
      [`${componentCls}-item-link`]: {
        height: token.itemSizeSM,
        backgroundColor: 'transparent',
        border: 0,
        '&:hover': {
          backgroundColor: token.colorBgTextHover
        },
        '&:active': {
          backgroundColor: token.colorBgTextActive
        },
        '&::after': {
          height: token.itemSizeSM,
          lineHeight: (0,es/* unit */.zA)(token.itemSizeSM)
        }
      }
    },
    [`&${componentCls}-simple ${componentCls}-simple-pager`]: {
      display: 'inline-block',
      height: token.itemSizeSM,
      marginInlineEnd: token.marginXS,
      input: {
        boxSizing: 'border-box',
        height: '100%',
        padding: `0 ${(0,es/* unit */.zA)(token.paginationItemPaddingInline)}`,
        textAlign: 'center',
        backgroundColor: token.itemInputBg,
        border: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
        borderRadius: token.borderRadius,
        outline: 'none',
        transition: `border-color ${token.motionDurationMid}`,
        color: 'inherit',
        '&:hover': {
          borderColor: token.colorPrimary
        },
        '&:focus': {
          borderColor: token.colorPrimaryHover,
          boxShadow: `${(0,es/* unit */.zA)(token.inputOutlineOffset)} 0 ${(0,es/* unit */.zA)(token.controlOutlineWidth)} ${token.controlOutline}`
        },
        '&[disabled]': {
          color: token.colorTextDisabled,
          backgroundColor: token.colorBgContainerDisabled,
          borderColor: token.colorBorder,
          cursor: 'not-allowed'
        }
      }
    }
  };
};
const genPaginationJumpStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}-jump-prev, ${componentCls}-jump-next`]: {
      outline: 0,
      [`${componentCls}-item-container`]: {
        position: 'relative',
        [`${componentCls}-item-link-icon`]: {
          color: token.colorPrimary,
          fontSize: token.fontSizeSM,
          opacity: 0,
          transition: `all ${token.motionDurationMid}`,
          '&-svg': {
            top: 0,
            insetInlineEnd: 0,
            bottom: 0,
            insetInlineStart: 0,
            margin: 'auto'
          }
        },
        [`${componentCls}-item-ellipsis`]: {
          position: 'absolute',
          top: 0,
          insetInlineEnd: 0,
          bottom: 0,
          insetInlineStart: 0,
          display: 'block',
          margin: 'auto',
          color: token.colorTextDisabled,
          letterSpacing: token.paginationEllipsisLetterSpacing,
          textAlign: 'center',
          textIndent: token.paginationEllipsisTextIndent,
          opacity: 1,
          transition: `all ${token.motionDurationMid}`
        }
      },
      '&:hover': {
        [`${componentCls}-item-link-icon`]: {
          opacity: 1
        },
        [`${componentCls}-item-ellipsis`]: {
          opacity: 0
        }
      }
    },
    [`
    ${componentCls}-prev,
    ${componentCls}-jump-prev,
    ${componentCls}-jump-next
    `]: {
      marginInlineEnd: token.marginXS
    },
    [`
    ${componentCls}-prev,
    ${componentCls}-next,
    ${componentCls}-jump-prev,
    ${componentCls}-jump-next
    `]: {
      display: 'inline-block',
      minWidth: token.itemSize,
      height: token.itemSize,
      color: token.colorText,
      fontFamily: token.fontFamily,
      lineHeight: (0,es/* unit */.zA)(token.itemSize),
      textAlign: 'center',
      verticalAlign: 'middle',
      listStyle: 'none',
      borderRadius: token.borderRadius,
      cursor: 'pointer',
      transition: `all ${token.motionDurationMid}`
    },
    [`${componentCls}-prev, ${componentCls}-next`]: {
      outline: 0,
      button: {
        color: token.colorText,
        cursor: 'pointer',
        userSelect: 'none'
      },
      [`${componentCls}-item-link`]: {
        display: 'block',
        width: '100%',
        height: '100%',
        padding: 0,
        fontSize: token.fontSizeSM,
        textAlign: 'center',
        backgroundColor: 'transparent',
        border: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} transparent`,
        borderRadius: token.borderRadius,
        outline: 'none',
        transition: `all ${token.motionDurationMid}`
      },
      [`&:hover ${componentCls}-item-link`]: {
        backgroundColor: token.colorBgTextHover
      },
      [`&:active ${componentCls}-item-link`]: {
        backgroundColor: token.colorBgTextActive
      },
      [`&${componentCls}-disabled:hover`]: {
        [`${componentCls}-item-link`]: {
          backgroundColor: 'transparent'
        }
      }
    },
    [`${componentCls}-slash`]: {
      marginInlineEnd: token.paginationSlashMarginInlineEnd,
      marginInlineStart: token.paginationSlashMarginInlineStart
    },
    [`${componentCls}-options`]: {
      display: 'inline-block',
      marginInlineStart: token.margin,
      verticalAlign: 'middle',
      '&-size-changer': {
        display: 'inline-block',
        width: 'auto'
      },
      '&-quick-jumper': {
        display: 'inline-block',
        height: token.controlHeight,
        marginInlineStart: token.marginXS,
        lineHeight: (0,es/* unit */.zA)(token.controlHeight),
        verticalAlign: 'top',
        input: Object.assign(Object.assign(Object.assign({}, (0,style/* genBasicInputStyle */.wj)(token)), (0,variants/* genBaseOutlinedStyle */.nI)(token, {
          borderColor: token.colorBorder,
          hoverBorderColor: token.colorPrimaryHover,
          activeBorderColor: token.colorPrimary,
          activeShadow: token.activeShadow
        })), {
          '&[disabled]': Object.assign({}, (0,variants/* genDisabledStyle */.eT)(token)),
          width: token.calc(token.controlHeightLG).mul(1.25).equal(),
          height: token.controlHeight,
          boxSizing: 'border-box',
          margin: 0,
          marginInlineStart: token.marginXS,
          marginInlineEnd: token.marginXS
        })
      }
    }
  };
};
const genPaginationItemStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}-item`]: {
      display: 'inline-block',
      minWidth: token.itemSize,
      height: token.itemSize,
      marginInlineEnd: token.marginXS,
      fontFamily: token.fontFamily,
      lineHeight: (0,es/* unit */.zA)(token.calc(token.itemSize).sub(2).equal()),
      textAlign: 'center',
      verticalAlign: 'middle',
      listStyle: 'none',
      backgroundColor: token.itemBg,
      border: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} transparent`,
      borderRadius: token.borderRadius,
      outline: 0,
      cursor: 'pointer',
      userSelect: 'none',
      a: {
        display: 'block',
        padding: `0 ${(0,es/* unit */.zA)(token.paginationItemPaddingInline)}`,
        color: token.colorText,
        '&:hover': {
          textDecoration: 'none'
        }
      },
      [`&:not(${componentCls}-item-active)`]: {
        '&:hover': {
          transition: `all ${token.motionDurationMid}`,
          backgroundColor: token.colorBgTextHover
        },
        '&:active': {
          backgroundColor: token.colorBgTextActive
        }
      },
      '&-active': {
        fontWeight: token.fontWeightStrong,
        backgroundColor: token.itemActiveBg,
        borderColor: token.colorPrimary,
        a: {
          color: token.colorPrimary
        },
        '&:hover': {
          borderColor: token.colorPrimaryHover
        },
        '&:hover a': {
          color: token.colorPrimaryHover
        }
      }
    }
  };
};
const genPaginationStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [componentCls]: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (0,es_style/* resetComponent */.dF)(token)), {
      display: 'flex',
      '&-start': {
        justifyContent: 'start'
      },
      '&-center': {
        justifyContent: 'center'
      },
      '&-end': {
        justifyContent: 'end'
      },
      'ul, ol': {
        margin: 0,
        padding: 0,
        listStyle: 'none'
      },
      '&::after': {
        display: 'block',
        clear: 'both',
        height: 0,
        overflow: 'hidden',
        visibility: 'hidden',
        content: '""'
      },
      [`${componentCls}-total-text`]: {
        display: 'inline-block',
        height: token.itemSize,
        marginInlineEnd: token.marginXS,
        lineHeight: (0,es/* unit */.zA)(token.calc(token.itemSize).sub(2).equal()),
        verticalAlign: 'middle'
      }
    }), genPaginationItemStyle(token)), genPaginationJumpStyle(token)), genPaginationSimpleStyle(token)), genPaginationMiniStyle(token)), genPaginationDisabledStyle(token)), {
      // media query style
      [`@media only screen and (max-width: ${token.screenLG}px)`]: {
        [`${componentCls}-item`]: {
          '&-after-jump-prev, &-before-jump-next': {
            display: 'none'
          }
        }
      },
      [`@media only screen and (max-width: ${token.screenSM}px)`]: {
        [`${componentCls}-options`]: {
          display: 'none'
        }
      }
    }),
    // rtl style
    [`&${token.componentCls}-rtl`]: {
      direction: 'rtl'
    }
  };
};
const genPaginationFocusStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}:not(${componentCls}-disabled)`]: {
      [`${componentCls}-item`]: Object.assign({}, (0,es_style/* genFocusStyle */.K8)(token)),
      [`${componentCls}-jump-prev, ${componentCls}-jump-next`]: {
        '&:focus-visible': Object.assign({
          [`${componentCls}-item-link-icon`]: {
            opacity: 1
          },
          [`${componentCls}-item-ellipsis`]: {
            opacity: 0
          }
        }, (0,es_style/* genFocusOutline */.jk)(token))
      },
      [`${componentCls}-prev, ${componentCls}-next`]: {
        [`&:focus-visible ${componentCls}-item-link`]: Object.assign({}, (0,es_style/* genFocusOutline */.jk)(token))
      }
    }
  };
};
const prepareComponentToken = token => Object.assign({
  itemBg: token.colorBgContainer,
  itemSize: token.controlHeight,
  itemSizeSM: token.controlHeightSM,
  itemActiveBg: token.colorBgContainer,
  itemLinkBg: token.colorBgContainer,
  itemActiveColorDisabled: token.colorTextDisabled,
  itemActiveBgDisabled: token.controlItemBgActiveDisabled,
  itemInputBg: token.colorBgContainer,
  miniOptionsSizeChangerTop: 0
}, (0,style_token/* initComponentToken */.b)(token));
const prepareToken = token => (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
  inputOutlineOffset: 0,
  paginationMiniOptionsMarginInlineStart: token.calc(token.marginXXS).div(2).equal(),
  paginationMiniQuickJumperInputWidth: token.calc(token.controlHeightLG).mul(1.1).equal(),
  paginationItemPaddingInline: token.calc(token.marginXXS).mul(1.5).equal(),
  paginationEllipsisLetterSpacing: token.calc(token.marginXXS).div(2).equal(),
  paginationSlashMarginInlineStart: token.marginSM,
  paginationSlashMarginInlineEnd: token.marginSM,
  paginationEllipsisTextIndent: '0.13em' // magic for ui experience
}, (0,style_token/* initInputToken */.C)(token));
// ============================== Export ==============================
/* harmony default export */ var pagination_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Pagination', token => {
  const paginationToken = prepareToken(token);
  return [genPaginationStyle(paginationToken), genPaginationFocusStyle(paginationToken)];
}, prepareComponentToken));
;// ./node_modules/antd/es/pagination/style/bordered.js



const genBorderedStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}${componentCls}-bordered${componentCls}-disabled:not(${componentCls}-mini)`]: {
      '&, &:hover': {
        [`${componentCls}-item-link`]: {
          borderColor: token.colorBorder
        }
      },
      '&:focus-visible': {
        [`${componentCls}-item-link`]: {
          borderColor: token.colorBorder
        }
      },
      [`${componentCls}-item, ${componentCls}-item-link`]: {
        backgroundColor: token.colorBgContainerDisabled,
        borderColor: token.colorBorder,
        [`&:hover:not(${componentCls}-item-active)`]: {
          backgroundColor: token.colorBgContainerDisabled,
          borderColor: token.colorBorder,
          a: {
            color: token.colorTextDisabled
          }
        },
        [`&${componentCls}-item-active`]: {
          backgroundColor: token.itemActiveBgDisabled
        }
      },
      [`${componentCls}-prev, ${componentCls}-next`]: {
        '&:hover button': {
          backgroundColor: token.colorBgContainerDisabled,
          borderColor: token.colorBorder,
          color: token.colorTextDisabled
        },
        [`${componentCls}-item-link`]: {
          backgroundColor: token.colorBgContainerDisabled,
          borderColor: token.colorBorder
        }
      }
    },
    [`${componentCls}${componentCls}-bordered:not(${componentCls}-mini)`]: {
      [`${componentCls}-prev, ${componentCls}-next`]: {
        '&:hover button': {
          borderColor: token.colorPrimaryHover,
          backgroundColor: token.itemBg
        },
        [`${componentCls}-item-link`]: {
          backgroundColor: token.itemLinkBg,
          borderColor: token.colorBorder
        },
        [`&:hover ${componentCls}-item-link`]: {
          borderColor: token.colorPrimary,
          backgroundColor: token.itemBg,
          color: token.colorPrimary
        },
        [`&${componentCls}-disabled`]: {
          [`${componentCls}-item-link`]: {
            borderColor: token.colorBorder,
            color: token.colorTextDisabled
          }
        }
      },
      [`${componentCls}-item`]: {
        backgroundColor: token.itemBg,
        border: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
        [`&:hover:not(${componentCls}-item-active)`]: {
          borderColor: token.colorPrimary,
          backgroundColor: token.itemBg,
          a: {
            color: token.colorPrimary
          }
        },
        '&-active': {
          borderColor: token.colorPrimary
        }
      }
    }
  };
};
/* harmony default export */ var bordered = ((0,genStyleUtils/* genSubStyleComponent */.bf)(['Pagination', 'bordered'], token => {
  const paginationToken = prepareToken(token);
  return [genBorderedStyle(paginationToken)];
}, prepareComponentToken));
;// ./node_modules/antd/es/pagination/useShowSizeChanger.js

function useShowSizeChanger(showSizeChanger) {
  return (0,react.useMemo)(() => {
    if (typeof showSizeChanger === 'boolean') {
      return [showSizeChanger, {}];
    }
    if (showSizeChanger && typeof showSizeChanger === 'object') {
      return [true, showSizeChanger];
    }
    return [undefined, undefined];
  }, [showSizeChanger]);
}
;// ./node_modules/antd/es/pagination/Pagination.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};


















const Pagination_Pagination = props => {
  const {
      align,
      prefixCls: customizePrefixCls,
      selectPrefixCls: customizeSelectPrefixCls,
      className,
      rootClassName,
      style,
      size: customizeSize,
      locale: customLocale,
      responsive,
      showSizeChanger,
      selectComponentClass,
      pageSizeOptions
    } = props,
    restProps = __rest(props, ["align", "prefixCls", "selectPrefixCls", "className", "rootClassName", "style", "size", "locale", "responsive", "showSizeChanger", "selectComponentClass", "pageSizeOptions"]);
  const {
    xs
  } = (0,useBreakpoint/* default */.A)(responsive);
  const [, token] = (0,useToken/* default */.Ay)();
  const {
    getPrefixCls,
    direction,
    pagination = {}
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('pagination', customizePrefixCls);
  // Style
  const [wrapCSSVar, hashId, cssVarCls] = pagination_style(prefixCls);
  // ============================== Size ==============================
  const mergedSize = (0,useSize/* default */.A)(customizeSize);
  const isSmall = mergedSize === 'small' || !!(xs && !mergedSize && responsive);
  // ============================= Locale =============================
  const [contextLocale] = (0,useLocale/* default */.A)('Pagination', en_US/* default */.A);
  const locale = Object.assign(Object.assign({}, contextLocale), customLocale);
  // ========================== Size Changer ==========================
  // Merge the props showSizeChanger
  const [propShowSizeChanger, propSizeChangerSelectProps] = useShowSizeChanger(showSizeChanger);
  const [contextShowSizeChanger, contextSizeChangerSelectProps] = useShowSizeChanger(pagination.showSizeChanger);
  const mergedShowSizeChanger = propShowSizeChanger !== null && propShowSizeChanger !== void 0 ? propShowSizeChanger : contextShowSizeChanger;
  const mergedShowSizeChangerSelectProps = propSizeChangerSelectProps !== null && propSizeChangerSelectProps !== void 0 ? propSizeChangerSelectProps : contextSizeChangerSelectProps;
  const SizeChanger = selectComponentClass || es_select/* default */.A;
  // Generate options
  const mergedPageSizeOptions = react.useMemo(() => {
    return pageSizeOptions ? pageSizeOptions.map(option => Number(option)) : undefined;
  }, [pageSizeOptions]);
  // Render size changer
  const sizeChangerRender = info => {
    var _a;
    const {
      disabled,
      size: pageSize,
      onSizeChange,
      'aria-label': ariaLabel,
      className: sizeChangerClassName,
      options
    } = info;
    const {
      className: propSizeChangerClassName,
      onChange: propSizeChangerOnChange
    } = mergedShowSizeChangerSelectProps || {};
    // Origin Select is using Select.Option,
    // So it make the option value must be string
    // Just for compatible
    const selectedValue = (_a = options.find(option => String(option.value) === String(pageSize))) === null || _a === void 0 ? void 0 : _a.value;
    return /*#__PURE__*/react.createElement(SizeChanger, Object.assign({
      disabled: disabled,
      showSearch: true,
      popupMatchSelectWidth: false,
      getPopupContainer: triggerNode => triggerNode.parentNode,
      "aria-label": ariaLabel,
      options: options
    }, mergedShowSizeChangerSelectProps, {
      value: selectedValue,
      onChange: (nextSize, option) => {
        onSizeChange === null || onSizeChange === void 0 ? void 0 : onSizeChange(nextSize);
        propSizeChangerOnChange === null || propSizeChangerOnChange === void 0 ? void 0 : propSizeChangerOnChange(nextSize, option);
      },
      size: isSmall ? 'small' : 'middle',
      className: classnames_default()(sizeChangerClassName, propSizeChangerClassName)
    }));
  };
  if (false) {}
  // ============================= Render =============================
  const iconsProps = react.useMemo(() => {
    const ellipsis = /*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-item-ellipsis`
    }, "\u2022\u2022\u2022");
    const prevIcon = /*#__PURE__*/react.createElement("button", {
      className: `${prefixCls}-item-link`,
      type: "button",
      tabIndex: -1
    }, direction === 'rtl' ? /*#__PURE__*/react.createElement(RightOutlined/* default */.A, null) : /*#__PURE__*/react.createElement(icons_LeftOutlined, null));
    const nextIcon = /*#__PURE__*/react.createElement("button", {
      className: `${prefixCls}-item-link`,
      type: "button",
      tabIndex: -1
    }, direction === 'rtl' ? /*#__PURE__*/react.createElement(icons_LeftOutlined, null) : /*#__PURE__*/react.createElement(RightOutlined/* default */.A, null));
    const jumpPrevIcon =
    /*#__PURE__*/
    // biome-ignore lint/a11y/useValidAnchor: it is hard to refactor
    react.createElement("a", {
      className: `${prefixCls}-item-link`
    }, /*#__PURE__*/react.createElement("div", {
      className: `${prefixCls}-item-container`
    }, direction === 'rtl' ? (/*#__PURE__*/react.createElement(icons_DoubleRightOutlined, {
      className: `${prefixCls}-item-link-icon`
    })) : (/*#__PURE__*/react.createElement(icons_DoubleLeftOutlined, {
      className: `${prefixCls}-item-link-icon`
    })), ellipsis));
    const jumpNextIcon =
    /*#__PURE__*/
    // biome-ignore lint/a11y/useValidAnchor: it is hard to refactor
    react.createElement("a", {
      className: `${prefixCls}-item-link`
    }, /*#__PURE__*/react.createElement("div", {
      className: `${prefixCls}-item-container`
    }, direction === 'rtl' ? (/*#__PURE__*/react.createElement(icons_DoubleLeftOutlined, {
      className: `${prefixCls}-item-link-icon`
    })) : (/*#__PURE__*/react.createElement(icons_DoubleRightOutlined, {
      className: `${prefixCls}-item-link-icon`
    })), ellipsis));
    return {
      prevIcon,
      nextIcon,
      jumpPrevIcon,
      jumpNextIcon
    };
  }, [direction, prefixCls]);
  const selectPrefixCls = getPrefixCls('select', customizeSelectPrefixCls);
  const extendedClassName = classnames_default()({
    [`${prefixCls}-${align}`]: !!align,
    [`${prefixCls}-mini`]: isSmall,
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-bordered`]: token.wireframe
  }, pagination === null || pagination === void 0 ? void 0 : pagination.className, className, rootClassName, hashId, cssVarCls);
  const mergedStyle = Object.assign(Object.assign({}, pagination === null || pagination === void 0 ? void 0 : pagination.style), style);
  return wrapCSSVar(/*#__PURE__*/react.createElement(react.Fragment, null, token.wireframe && /*#__PURE__*/react.createElement(bordered, {
    prefixCls: prefixCls
  }), /*#__PURE__*/react.createElement(es_Pagination, Object.assign({}, iconsProps, restProps, {
    style: mergedStyle,
    prefixCls: prefixCls,
    selectPrefixCls: selectPrefixCls,
    className: extendedClassName,
    locale: locale,
    pageSizeOptions: mergedPageSizeOptions,
    showSizeChanger: mergedShowSizeChanger,
    sizeChangerRender: sizeChangerRender
  }))));
};
if (false) {}
/* harmony default export */ var pagination_Pagination = (Pagination_Pagination);
;// ./node_modules/antd/es/pagination/index.js
"use client";


/* harmony default export */ var pagination = (pagination_Pagination);

/***/ })

}]);
//# sourceMappingURL=417e33eea0aa510adbdf44808efb4c98dec7146e-6af50a3f460f1b681cea.js.map