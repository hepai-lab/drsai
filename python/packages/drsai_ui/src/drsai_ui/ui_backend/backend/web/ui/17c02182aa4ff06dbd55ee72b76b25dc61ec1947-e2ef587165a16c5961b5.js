"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[8461],{

/***/ 96311:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _ant_design_icons_es_icons_CloseCircleFilled__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(36029);
"use client";



const getAllowClear = allowClear => {
  let mergedAllowClear;
  if (typeof allowClear === 'object' && (allowClear === null || allowClear === void 0 ? void 0 : allowClear.clearIcon)) {
    mergedAllowClear = allowClear;
  } else if (allowClear) {
    mergedAllowClear = {
      clearIcon: /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_ant_design_icons_es_icons_CloseCircleFilled__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A, null)
    };
  }
  return mergedAllowClear;
};
/* harmony default export */ __webpack_exports__.A = (getAllowClear);

/***/ }),

/***/ 98638:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ input_TextArea; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectSpread2.js
var objectSpread2 = __webpack_require__(89379);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
var objectWithoutProperties = __webpack_require__(80045);
// EXTERNAL MODULE: ./node_modules/rc-input/es/index.js + 2 modules
var es = __webpack_require__(48491);
// EXTERNAL MODULE: ./node_modules/rc-input/es/hooks/useCount.js
var useCount = __webpack_require__(22489);
// EXTERNAL MODULE: ./node_modules/rc-input/es/utils/commonUtils.js
var commonUtils = __webpack_require__(11980);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/typeof.js
var esm_typeof = __webpack_require__(82284);
// EXTERNAL MODULE: ./node_modules/rc-resize-observer/es/index.js + 5 modules
var rc_resize_observer_es = __webpack_require__(18462);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useLayoutEffect.js
var useLayoutEffect = __webpack_require__(30981);
// EXTERNAL MODULE: ./node_modules/rc-util/es/raf.js
var raf = __webpack_require__(25371);
;// ./node_modules/rc-textarea/es/calculateNodeHeight.js
// Thanks to https://github.com/andreypopp/react-textarea-autosize/

/**
 * calculateNodeHeight(uiTextNode, useCache = false)
 */

var HIDDEN_TEXTAREA_STYLE = "\n  min-height:0 !important;\n  max-height:none !important;\n  height:0 !important;\n  visibility:hidden !important;\n  overflow:hidden !important;\n  position:absolute !important;\n  z-index:-1000 !important;\n  top:0 !important;\n  right:0 !important;\n  pointer-events: none !important;\n";
var SIZING_STYLE = ['letter-spacing', 'line-height', 'padding-top', 'padding-bottom', 'font-family', 'font-weight', 'font-size', 'font-variant', 'text-rendering', 'text-transform', 'width', 'text-indent', 'padding-left', 'padding-right', 'border-width', 'box-sizing', 'word-break', 'white-space'];
var computedStyleCache = {};
var hiddenTextarea;
function calculateNodeStyling(node) {
  var useCache = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
  var nodeRef = node.getAttribute('id') || node.getAttribute('data-reactid') || node.getAttribute('name');
  if (useCache && computedStyleCache[nodeRef]) {
    return computedStyleCache[nodeRef];
  }
  var style = window.getComputedStyle(node);
  var boxSizing = style.getPropertyValue('box-sizing') || style.getPropertyValue('-moz-box-sizing') || style.getPropertyValue('-webkit-box-sizing');
  var paddingSize = parseFloat(style.getPropertyValue('padding-bottom')) + parseFloat(style.getPropertyValue('padding-top'));
  var borderSize = parseFloat(style.getPropertyValue('border-bottom-width')) + parseFloat(style.getPropertyValue('border-top-width'));
  var sizingStyle = SIZING_STYLE.map(function (name) {
    return "".concat(name, ":").concat(style.getPropertyValue(name));
  }).join(';');
  var nodeInfo = {
    sizingStyle: sizingStyle,
    paddingSize: paddingSize,
    borderSize: borderSize,
    boxSizing: boxSizing
  };
  if (useCache && nodeRef) {
    computedStyleCache[nodeRef] = nodeInfo;
  }
  return nodeInfo;
}
function calculateAutoSizeStyle(uiTextNode) {
  var useCache = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
  var minRows = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;
  var maxRows = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : null;
  if (!hiddenTextarea) {
    hiddenTextarea = document.createElement('textarea');
    hiddenTextarea.setAttribute('tab-index', '-1');
    hiddenTextarea.setAttribute('aria-hidden', 'true');
    // fix: A form field element should have an id or name attribute
    // A form field element has neither an id nor a name attribute. This might prevent the browser from correctly autofilling the form.
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/textarea
    hiddenTextarea.setAttribute('name', 'hiddenTextarea');
    document.body.appendChild(hiddenTextarea);
  }

  // Fix wrap="off" issue
  // https://github.com/ant-design/ant-design/issues/6577
  if (uiTextNode.getAttribute('wrap')) {
    hiddenTextarea.setAttribute('wrap', uiTextNode.getAttribute('wrap'));
  } else {
    hiddenTextarea.removeAttribute('wrap');
  }

  // Copy all CSS properties that have an impact on the height of the content in
  // the textbox
  var _calculateNodeStyling = calculateNodeStyling(uiTextNode, useCache),
    paddingSize = _calculateNodeStyling.paddingSize,
    borderSize = _calculateNodeStyling.borderSize,
    boxSizing = _calculateNodeStyling.boxSizing,
    sizingStyle = _calculateNodeStyling.sizingStyle;

  // Need to have the overflow attribute to hide the scrollbar otherwise
  // text-lines will not calculated properly as the shadow will technically be
  // narrower for content
  hiddenTextarea.setAttribute('style', "".concat(sizingStyle, ";").concat(HIDDEN_TEXTAREA_STYLE));
  hiddenTextarea.value = uiTextNode.value || uiTextNode.placeholder || '';
  var minHeight = undefined;
  var maxHeight = undefined;
  var overflowY;
  var height = hiddenTextarea.scrollHeight;
  if (boxSizing === 'border-box') {
    // border-box: add border, since height = content + padding + border
    height += borderSize;
  } else if (boxSizing === 'content-box') {
    // remove padding, since height = content
    height -= paddingSize;
  }
  if (minRows !== null || maxRows !== null) {
    // measure height of a textarea with a single row
    hiddenTextarea.value = ' ';
    var singleRowHeight = hiddenTextarea.scrollHeight - paddingSize;
    if (minRows !== null) {
      minHeight = singleRowHeight * minRows;
      if (boxSizing === 'border-box') {
        minHeight = minHeight + paddingSize + borderSize;
      }
      height = Math.max(minHeight, height);
    }
    if (maxRows !== null) {
      maxHeight = singleRowHeight * maxRows;
      if (boxSizing === 'border-box') {
        maxHeight = maxHeight + paddingSize + borderSize;
      }
      overflowY = height > maxHeight ? '' : 'hidden';
      height = Math.min(maxHeight, height);
    }
  }
  var style = {
    height: height,
    overflowY: overflowY,
    resize: 'none'
  };
  if (minHeight) {
    style.minHeight = minHeight;
  }
  if (maxHeight) {
    style.maxHeight = maxHeight;
  }
  return style;
}
;// ./node_modules/rc-textarea/es/ResizableTextArea.js






var _excluded = ["prefixCls", "defaultValue", "value", "autoSize", "onResize", "className", "style", "disabled", "onChange", "onInternalAutoSize"];







var RESIZE_START = 0;
var RESIZE_MEASURING = 1;
var RESIZE_STABLE = 2;
var ResizableTextArea = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var _ref = props,
    prefixCls = _ref.prefixCls,
    defaultValue = _ref.defaultValue,
    value = _ref.value,
    autoSize = _ref.autoSize,
    onResize = _ref.onResize,
    className = _ref.className,
    style = _ref.style,
    disabled = _ref.disabled,
    onChange = _ref.onChange,
    onInternalAutoSize = _ref.onInternalAutoSize,
    restProps = (0,objectWithoutProperties/* default */.A)(_ref, _excluded);

  // =============================== Value ================================
  var _useMergedState = (0,useMergedState/* default */.A)(defaultValue, {
      value: value,
      postState: function postState(val) {
        return val !== null && val !== void 0 ? val : '';
      }
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    mergedValue = _useMergedState2[0],
    setMergedValue = _useMergedState2[1];
  var onInternalChange = function onInternalChange(event) {
    setMergedValue(event.target.value);
    onChange === null || onChange === void 0 || onChange(event);
  };

  // ================================ Ref =================================
  var textareaRef = react.useRef();
  react.useImperativeHandle(ref, function () {
    return {
      textArea: textareaRef.current
    };
  });

  // ============================== AutoSize ==============================
  var _React$useMemo = react.useMemo(function () {
      if (autoSize && (0,esm_typeof/* default */.A)(autoSize) === 'object') {
        return [autoSize.minRows, autoSize.maxRows];
      }
      return [];
    }, [autoSize]),
    _React$useMemo2 = (0,slicedToArray/* default */.A)(_React$useMemo, 2),
    minRows = _React$useMemo2[0],
    maxRows = _React$useMemo2[1];
  var needAutoSize = !!autoSize;

  // =============================== Scroll ===============================
  // https://github.com/ant-design/ant-design/issues/21870
  var fixFirefoxAutoScroll = function fixFirefoxAutoScroll() {
    try {
      // FF has bug with jump of scroll to top. We force back here.
      if (document.activeElement === textareaRef.current) {
        var _textareaRef$current = textareaRef.current,
          selectionStart = _textareaRef$current.selectionStart,
          selectionEnd = _textareaRef$current.selectionEnd,
          scrollTop = _textareaRef$current.scrollTop;

        // Fix Safari bug which not rollback when break line
        // This makes Chinese IME can't input. Do not fix this
        // const { value: tmpValue } = textareaRef.current;
        // textareaRef.current.value = '';
        // textareaRef.current.value = tmpValue;

        textareaRef.current.setSelectionRange(selectionStart, selectionEnd);
        textareaRef.current.scrollTop = scrollTop;
      }
    } catch (e) {
      // Fix error in Chrome:
      // Failed to read the 'selectionStart' property from 'HTMLInputElement'
      // http://stackoverflow.com/q/21177489/3040605
    }
  };

  // =============================== Resize ===============================
  var _React$useState = react.useState(RESIZE_STABLE),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    resizeState = _React$useState2[0],
    setResizeState = _React$useState2[1];
  var _React$useState3 = react.useState(),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    autoSizeStyle = _React$useState4[0],
    setAutoSizeStyle = _React$useState4[1];
  var startResize = function startResize() {
    setResizeState(RESIZE_START);
    if (false) {}
  };

  // Change to trigger resize measure
  (0,useLayoutEffect/* default */.A)(function () {
    if (needAutoSize) {
      startResize();
    }
  }, [value, minRows, maxRows, needAutoSize]);
  (0,useLayoutEffect/* default */.A)(function () {
    if (resizeState === RESIZE_START) {
      setResizeState(RESIZE_MEASURING);
    } else if (resizeState === RESIZE_MEASURING) {
      var textareaStyles = calculateAutoSizeStyle(textareaRef.current, false, minRows, maxRows);

      // Safari has bug that text will keep break line on text cut when it's prev is break line.
      // ZombieJ: This not often happen. So we just skip it.
      // const { selectionStart, selectionEnd, scrollTop } = textareaRef.current;
      // const { value: tmpValue } = textareaRef.current;
      // textareaRef.current.value = '';
      // textareaRef.current.value = tmpValue;

      // if (document.activeElement === textareaRef.current) {
      //   textareaRef.current.scrollTop = scrollTop;
      //   textareaRef.current.setSelectionRange(selectionStart, selectionEnd);
      // }

      setResizeState(RESIZE_STABLE);
      setAutoSizeStyle(textareaStyles);
    } else {
      fixFirefoxAutoScroll();
    }
  }, [resizeState]);

  // We lock resize trigger by raf to avoid Safari warning
  var resizeRafRef = react.useRef();
  var cleanRaf = function cleanRaf() {
    raf/* default */.A.cancel(resizeRafRef.current);
  };
  var onInternalResize = function onInternalResize(size) {
    if (resizeState === RESIZE_STABLE) {
      onResize === null || onResize === void 0 || onResize(size);
      if (autoSize) {
        cleanRaf();
        resizeRafRef.current = (0,raf/* default */.A)(function () {
          startResize();
        });
      }
    }
  };
  react.useEffect(function () {
    return cleanRaf;
  }, []);

  // =============================== Render ===============================
  var mergedAutoSizeStyle = needAutoSize ? autoSizeStyle : null;
  var mergedStyle = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, style), mergedAutoSizeStyle);
  if (resizeState === RESIZE_START || resizeState === RESIZE_MEASURING) {
    mergedStyle.overflowY = 'hidden';
    mergedStyle.overflowX = 'hidden';
  }
  return /*#__PURE__*/react.createElement(rc_resize_observer_es/* default */.A, {
    onResize: onInternalResize,
    disabled: !(autoSize || onResize)
  }, /*#__PURE__*/react.createElement("textarea", (0,esm_extends/* default */.A)({}, restProps, {
    ref: textareaRef,
    style: mergedStyle,
    className: classnames_default()(prefixCls, className, (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-disabled"), disabled)),
    disabled: disabled,
    value: mergedValue,
    onChange: onInternalChange
  })));
});
/* harmony default export */ var es_ResizableTextArea = (ResizableTextArea);
;// ./node_modules/rc-textarea/es/TextArea.js






var TextArea_excluded = ["defaultValue", "value", "onFocus", "onBlur", "onChange", "allowClear", "maxLength", "onCompositionStart", "onCompositionEnd", "suffix", "prefixCls", "showCount", "count", "className", "style", "disabled", "hidden", "classNames", "styles", "onResize", "onClear", "onPressEnter", "readOnly", "autoSize", "onKeyDown"];







var TextArea = /*#__PURE__*/react.forwardRef(function (_ref, ref) {
  var _countConfig$max;
  var defaultValue = _ref.defaultValue,
    customValue = _ref.value,
    onFocus = _ref.onFocus,
    onBlur = _ref.onBlur,
    onChange = _ref.onChange,
    allowClear = _ref.allowClear,
    maxLength = _ref.maxLength,
    onCompositionStart = _ref.onCompositionStart,
    onCompositionEnd = _ref.onCompositionEnd,
    suffix = _ref.suffix,
    _ref$prefixCls = _ref.prefixCls,
    prefixCls = _ref$prefixCls === void 0 ? 'rc-textarea' : _ref$prefixCls,
    showCount = _ref.showCount,
    count = _ref.count,
    className = _ref.className,
    style = _ref.style,
    disabled = _ref.disabled,
    hidden = _ref.hidden,
    classNames = _ref.classNames,
    styles = _ref.styles,
    onResize = _ref.onResize,
    onClear = _ref.onClear,
    onPressEnter = _ref.onPressEnter,
    readOnly = _ref.readOnly,
    autoSize = _ref.autoSize,
    onKeyDown = _ref.onKeyDown,
    rest = (0,objectWithoutProperties/* default */.A)(_ref, TextArea_excluded);
  var _useMergedState = (0,useMergedState/* default */.A)(defaultValue, {
      value: customValue,
      defaultValue: defaultValue
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    value = _useMergedState2[0],
    setValue = _useMergedState2[1];
  var formatValue = value === undefined || value === null ? '' : String(value);
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    focused = _React$useState2[0],
    setFocused = _React$useState2[1];
  var compositionRef = react.useRef(false);
  var _React$useState3 = react.useState(null),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    textareaResized = _React$useState4[0],
    setTextareaResized = _React$useState4[1];

  // =============================== Ref ================================
  var holderRef = (0,react.useRef)(null);
  var resizableTextAreaRef = (0,react.useRef)(null);
  var getTextArea = function getTextArea() {
    var _resizableTextAreaRef;
    return (_resizableTextAreaRef = resizableTextAreaRef.current) === null || _resizableTextAreaRef === void 0 ? void 0 : _resizableTextAreaRef.textArea;
  };
  var focus = function focus() {
    getTextArea().focus();
  };
  (0,react.useImperativeHandle)(ref, function () {
    var _holderRef$current;
    return {
      resizableTextArea: resizableTextAreaRef.current,
      focus: focus,
      blur: function blur() {
        getTextArea().blur();
      },
      nativeElement: ((_holderRef$current = holderRef.current) === null || _holderRef$current === void 0 ? void 0 : _holderRef$current.nativeElement) || getTextArea()
    };
  });
  (0,react.useEffect)(function () {
    setFocused(function (prev) {
      return !disabled && prev;
    });
  }, [disabled]);

  // =========================== Select Range ===========================
  var _React$useState5 = react.useState(null),
    _React$useState6 = (0,slicedToArray/* default */.A)(_React$useState5, 2),
    selection = _React$useState6[0],
    setSelection = _React$useState6[1];
  react.useEffect(function () {
    if (selection) {
      var _getTextArea;
      (_getTextArea = getTextArea()).setSelectionRange.apply(_getTextArea, (0,toConsumableArray/* default */.A)(selection));
    }
  }, [selection]);

  // ============================== Count ===============================
  var countConfig = (0,useCount/* default */.A)(count, showCount);
  var mergedMax = (_countConfig$max = countConfig.max) !== null && _countConfig$max !== void 0 ? _countConfig$max : maxLength;

  // Max length value
  var hasMaxLength = Number(mergedMax) > 0;
  var valueLength = countConfig.strategy(formatValue);
  var isOutOfRange = !!mergedMax && valueLength > mergedMax;

  // ============================== Change ==============================
  var triggerChange = function triggerChange(e, currentValue) {
    var cutValue = currentValue;
    if (!compositionRef.current && countConfig.exceedFormatter && countConfig.max && countConfig.strategy(currentValue) > countConfig.max) {
      cutValue = countConfig.exceedFormatter(currentValue, {
        max: countConfig.max
      });
      if (currentValue !== cutValue) {
        setSelection([getTextArea().selectionStart || 0, getTextArea().selectionEnd || 0]);
      }
    }
    setValue(cutValue);
    (0,commonUtils/* resolveOnChange */.gS)(e.currentTarget, e, onChange, cutValue);
  };

  // =========================== Value Update ===========================
  var onInternalCompositionStart = function onInternalCompositionStart(e) {
    compositionRef.current = true;
    onCompositionStart === null || onCompositionStart === void 0 || onCompositionStart(e);
  };
  var onInternalCompositionEnd = function onInternalCompositionEnd(e) {
    compositionRef.current = false;
    triggerChange(e, e.currentTarget.value);
    onCompositionEnd === null || onCompositionEnd === void 0 || onCompositionEnd(e);
  };
  var onInternalChange = function onInternalChange(e) {
    triggerChange(e, e.target.value);
  };
  var handleKeyDown = function handleKeyDown(e) {
    if (e.key === 'Enter' && onPressEnter) {
      onPressEnter(e);
    }
    onKeyDown === null || onKeyDown === void 0 || onKeyDown(e);
  };
  var handleFocus = function handleFocus(e) {
    setFocused(true);
    onFocus === null || onFocus === void 0 || onFocus(e);
  };
  var handleBlur = function handleBlur(e) {
    setFocused(false);
    onBlur === null || onBlur === void 0 || onBlur(e);
  };

  // ============================== Reset ===============================
  var handleReset = function handleReset(e) {
    setValue('');
    focus();
    (0,commonUtils/* resolveOnChange */.gS)(getTextArea(), e, onChange);
  };
  var suffixNode = suffix;
  var dataCount;
  if (countConfig.show) {
    if (countConfig.showFormatter) {
      dataCount = countConfig.showFormatter({
        value: formatValue,
        count: valueLength,
        maxLength: mergedMax
      });
    } else {
      dataCount = "".concat(valueLength).concat(hasMaxLength ? " / ".concat(mergedMax) : '');
    }
    suffixNode = /*#__PURE__*/react.createElement(react.Fragment, null, suffixNode, /*#__PURE__*/react.createElement("span", {
      className: classnames_default()("".concat(prefixCls, "-data-count"), classNames === null || classNames === void 0 ? void 0 : classNames.count),
      style: styles === null || styles === void 0 ? void 0 : styles.count
    }, dataCount));
  }
  var handleResize = function handleResize(size) {
    var _getTextArea2;
    onResize === null || onResize === void 0 || onResize(size);
    if ((_getTextArea2 = getTextArea()) !== null && _getTextArea2 !== void 0 && _getTextArea2.style.height) {
      setTextareaResized(true);
    }
  };
  var isPureTextArea = !autoSize && !showCount && !allowClear;
  return /*#__PURE__*/react.createElement(es/* BaseInput */.a, {
    ref: holderRef,
    value: formatValue,
    allowClear: allowClear,
    handleReset: handleReset,
    suffix: suffixNode,
    prefixCls: prefixCls,
    classNames: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, classNames), {}, {
      affixWrapper: classnames_default()(classNames === null || classNames === void 0 ? void 0 : classNames.affixWrapper, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-show-count"), showCount), "".concat(prefixCls, "-textarea-allow-clear"), allowClear))
    }),
    disabled: disabled,
    focused: focused,
    className: classnames_default()(className, isOutOfRange && "".concat(prefixCls, "-out-of-range")),
    style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, style), textareaResized && !isPureTextArea ? {
      height: 'auto'
    } : {}),
    dataAttrs: {
      affixWrapper: {
        'data-count': typeof dataCount === 'string' ? dataCount : undefined
      }
    },
    hidden: hidden,
    readOnly: readOnly,
    onClear: onClear
  }, /*#__PURE__*/react.createElement(es_ResizableTextArea, (0,esm_extends/* default */.A)({}, rest, {
    autoSize: autoSize,
    maxLength: maxLength,
    onKeyDown: handleKeyDown,
    onChange: onInternalChange,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onCompositionStart: onInternalCompositionStart,
    onCompositionEnd: onInternalCompositionEnd,
    className: classnames_default()(classNames === null || classNames === void 0 ? void 0 : classNames.textarea),
    style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, styles === null || styles === void 0 ? void 0 : styles.textarea), {}, {
      resize: style === null || style === void 0 ? void 0 : style.resize
    }),
    disabled: disabled,
    prefixCls: prefixCls,
    onResize: handleResize,
    ref: resizableTextAreaRef,
    readOnly: readOnly
  })));
});
/* harmony default export */ var es_TextArea = (TextArea);
;// ./node_modules/rc-textarea/es/index.js


/* harmony default export */ var rc_textarea_es = (es_TextArea);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/getAllowClear.js
var getAllowClear = __webpack_require__(96311);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/statusUtils.js
var statusUtils = __webpack_require__(58182);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/DisabledContext.js
var DisabledContext = __webpack_require__(98119);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
// EXTERNAL MODULE: ./node_modules/antd/es/form/context.js
var form_context = __webpack_require__(94241);
// EXTERNAL MODULE: ./node_modules/antd/es/form/hooks/useVariants.js
var useVariants = __webpack_require__(90124);
// EXTERNAL MODULE: ./node_modules/antd/es/input/style/index.js
var input_style = __webpack_require__(81594);
;// ./node_modules/antd/es/input/TextArea.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};















const TextArea_TextArea = /*#__PURE__*/(0,react.forwardRef)((props, ref) => {
  var _a, _b;
  const {
      prefixCls: customizePrefixCls,
      bordered = true,
      size: customizeSize,
      disabled: customDisabled,
      status: customStatus,
      allowClear,
      classNames: classes,
      rootClassName,
      className,
      style,
      styles,
      variant: customVariant
    } = props,
    rest = __rest(props, ["prefixCls", "bordered", "size", "disabled", "status", "allowClear", "classNames", "rootClassName", "className", "style", "styles", "variant"]);
  if (false) {}
  const {
    getPrefixCls,
    direction,
    textArea
  } = react.useContext(context/* ConfigContext */.QO);
  // ===================== Size =====================
  const mergedSize = (0,useSize/* default */.A)(customizeSize);
  // ===================== Disabled =====================
  const disabled = react.useContext(DisabledContext/* default */.A);
  const mergedDisabled = customDisabled !== null && customDisabled !== void 0 ? customDisabled : disabled;
  // ===================== Status =====================
  const {
    status: contextStatus,
    hasFeedback,
    feedbackIcon
  } = react.useContext(form_context/* FormItemInputContext */.$W);
  const mergedStatus = (0,statusUtils/* getMergedStatus */.v)(contextStatus, customStatus);
  // ===================== Ref =====================
  const innerRef = react.useRef(null);
  react.useImperativeHandle(ref, () => {
    var _a;
    return {
      resizableTextArea: (_a = innerRef.current) === null || _a === void 0 ? void 0 : _a.resizableTextArea,
      focus: option => {
        var _a, _b;
        (0,commonUtils/* triggerFocus */.F4)((_b = (_a = innerRef.current) === null || _a === void 0 ? void 0 : _a.resizableTextArea) === null || _b === void 0 ? void 0 : _b.textArea, option);
      },
      blur: () => {
        var _a;
        return (_a = innerRef.current) === null || _a === void 0 ? void 0 : _a.blur();
      }
    };
  });
  const prefixCls = getPrefixCls('input', customizePrefixCls);
  // ===================== Style =====================
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = (0,input_style/* default */.Ay)(prefixCls, rootCls);
  const [variant, enableVariantCls] = (0,useVariants/* default */.A)('textArea', customVariant, bordered);
  const mergedAllowClear = (0,getAllowClear/* default */.A)(allowClear !== null && allowClear !== void 0 ? allowClear : textArea === null || textArea === void 0 ? void 0 : textArea.allowClear);
  return wrapCSSVar(/*#__PURE__*/react.createElement(rc_textarea_es, Object.assign({
    autoComplete: textArea === null || textArea === void 0 ? void 0 : textArea.autoComplete
  }, rest, {
    style: Object.assign(Object.assign({}, textArea === null || textArea === void 0 ? void 0 : textArea.style), style),
    styles: Object.assign(Object.assign({}, textArea === null || textArea === void 0 ? void 0 : textArea.styles), styles),
    disabled: mergedDisabled,
    allowClear: mergedAllowClear,
    className: classnames_default()(cssVarCls, rootCls, className, rootClassName, textArea === null || textArea === void 0 ? void 0 : textArea.className),
    classNames: Object.assign(Object.assign(Object.assign({}, classes), textArea === null || textArea === void 0 ? void 0 : textArea.classNames), {
      textarea: classnames_default()({
        [`${prefixCls}-sm`]: mergedSize === 'small',
        [`${prefixCls}-lg`]: mergedSize === 'large'
      }, hashId, classes === null || classes === void 0 ? void 0 : classes.textarea, (_a = textArea === null || textArea === void 0 ? void 0 : textArea.classNames) === null || _a === void 0 ? void 0 : _a.textarea),
      variant: classnames_default()({
        [`${prefixCls}-${variant}`]: enableVariantCls
      }, (0,statusUtils/* getStatusClassNames */.L)(prefixCls, mergedStatus)),
      affixWrapper: classnames_default()(`${prefixCls}-textarea-affix-wrapper`, {
        [`${prefixCls}-affix-wrapper-rtl`]: direction === 'rtl',
        [`${prefixCls}-affix-wrapper-sm`]: mergedSize === 'small',
        [`${prefixCls}-affix-wrapper-lg`]: mergedSize === 'large',
        [`${prefixCls}-textarea-show-count`]: props.showCount || ((_b = props.count) === null || _b === void 0 ? void 0 : _b.show)
      }, hashId)
    }),
    prefixCls: prefixCls,
    suffix: hasFeedback && /*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-textarea-suffix`
    }, feedbackIcon),
    ref: innerRef
  })));
});
/* harmony default export */ var input_TextArea = (TextArea_TextArea);

/***/ }),

/***/ 22489:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ useCount; }
/* harmony export */ });
/* unused harmony export inCountRange */
/* harmony import */ var _babel_runtime_helpers_esm_objectWithoutProperties__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(80045);
/* harmony import */ var _babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(89379);
/* harmony import */ var _babel_runtime_helpers_esm_typeof__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(82284);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);



var _excluded = ["show"];

/**
 * Cut `value` by the `count.max` prop.
 */
function inCountRange(value, countConfig) {
  if (!countConfig.max) {
    return true;
  }
  var count = countConfig.strategy(value);
  return count <= countConfig.max;
}
function useCount(count, showCount) {
  return react__WEBPACK_IMPORTED_MODULE_0__.useMemo(function () {
    var mergedConfig = {};
    if (showCount) {
      mergedConfig.show = (0,_babel_runtime_helpers_esm_typeof__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)(showCount) === 'object' && showCount.formatter ? showCount.formatter : !!showCount;
    }
    mergedConfig = (0,_babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)((0,_babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)({}, mergedConfig), count);
    var _ref = mergedConfig,
      show = _ref.show,
      rest = (0,_babel_runtime_helpers_esm_objectWithoutProperties__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .A)(_ref, _excluded);
    return (0,_babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)((0,_babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)({}, rest), {}, {
      show: !!show,
      showFormatter: typeof show === 'function' ? show : undefined,
      strategy: rest.strategy || function (value) {
        return value.length;
      }
    });
  }, [count, showCount]);
}

/***/ }),

/***/ 48491:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  a: function() { return /* reexport */ es_BaseInput; },
  A: function() { return /* binding */ es; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectSpread2.js
var objectSpread2 = __webpack_require__(89379);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/typeof.js
var esm_typeof = __webpack_require__(82284);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/rc-input/es/utils/commonUtils.js
var commonUtils = __webpack_require__(11980);
;// ./node_modules/rc-input/es/BaseInput.js







var BaseInput = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var _element$props, _element$props2;
  var inputEl = props.inputElement,
    children = props.children,
    prefixCls = props.prefixCls,
    prefix = props.prefix,
    suffix = props.suffix,
    addonBefore = props.addonBefore,
    addonAfter = props.addonAfter,
    className = props.className,
    style = props.style,
    disabled = props.disabled,
    readOnly = props.readOnly,
    focused = props.focused,
    triggerFocus = props.triggerFocus,
    allowClear = props.allowClear,
    value = props.value,
    handleReset = props.handleReset,
    hidden = props.hidden,
    classes = props.classes,
    classNames = props.classNames,
    dataAttrs = props.dataAttrs,
    styles = props.styles,
    components = props.components,
    onClear = props.onClear;
  var inputElement = children !== null && children !== void 0 ? children : inputEl;
  var AffixWrapperComponent = (components === null || components === void 0 ? void 0 : components.affixWrapper) || 'span';
  var GroupWrapperComponent = (components === null || components === void 0 ? void 0 : components.groupWrapper) || 'span';
  var WrapperComponent = (components === null || components === void 0 ? void 0 : components.wrapper) || 'span';
  var GroupAddonComponent = (components === null || components === void 0 ? void 0 : components.groupAddon) || 'span';
  var containerRef = (0,react.useRef)(null);
  var onInputClick = function onInputClick(e) {
    var _containerRef$current;
    if ((_containerRef$current = containerRef.current) !== null && _containerRef$current !== void 0 && _containerRef$current.contains(e.target)) {
      triggerFocus === null || triggerFocus === void 0 || triggerFocus();
    }
  };
  var hasAffix = (0,commonUtils/* hasPrefixSuffix */.OL)(props);
  var element = /*#__PURE__*/(0,react.cloneElement)(inputElement, {
    value: value,
    className: classnames_default()(inputElement.props.className, !hasAffix && (classNames === null || classNames === void 0 ? void 0 : classNames.variant)) || null
  });

  // ======================== Ref ======================== //
  var groupRef = (0,react.useRef)(null);
  react.useImperativeHandle(ref, function () {
    return {
      nativeElement: groupRef.current || containerRef.current
    };
  });

  // ================== Prefix & Suffix ================== //
  if (hasAffix) {
    // ================== Clear Icon ================== //
    var clearIcon = null;
    if (allowClear) {
      var needClear = !disabled && !readOnly && value;
      var clearIconCls = "".concat(prefixCls, "-clear-icon");
      var iconNode = (0,esm_typeof/* default */.A)(allowClear) === 'object' && allowClear !== null && allowClear !== void 0 && allowClear.clearIcon ? allowClear.clearIcon : '✖';
      clearIcon = /*#__PURE__*/react.createElement("span", {
        onClick: function onClick(event) {
          handleReset === null || handleReset === void 0 || handleReset(event);
          onClear === null || onClear === void 0 || onClear();
        }
        // Do not trigger onBlur when clear input
        // https://github.com/ant-design/ant-design/issues/31200
        ,
        onMouseDown: function onMouseDown(e) {
          return e.preventDefault();
        },
        className: classnames_default()(clearIconCls, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(clearIconCls, "-hidden"), !needClear), "".concat(clearIconCls, "-has-suffix"), !!suffix)),
        role: "button",
        tabIndex: -1
      }, iconNode);
    }
    var affixWrapperPrefixCls = "".concat(prefixCls, "-affix-wrapper");
    var affixWrapperCls = classnames_default()(affixWrapperPrefixCls, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-disabled"), disabled), "".concat(affixWrapperPrefixCls, "-disabled"), disabled), "".concat(affixWrapperPrefixCls, "-focused"), focused), "".concat(affixWrapperPrefixCls, "-readonly"), readOnly), "".concat(affixWrapperPrefixCls, "-input-with-clear-btn"), suffix && allowClear && value), classes === null || classes === void 0 ? void 0 : classes.affixWrapper, classNames === null || classNames === void 0 ? void 0 : classNames.affixWrapper, classNames === null || classNames === void 0 ? void 0 : classNames.variant);
    var suffixNode = (suffix || allowClear) && /*#__PURE__*/react.createElement("span", {
      className: classnames_default()("".concat(prefixCls, "-suffix"), classNames === null || classNames === void 0 ? void 0 : classNames.suffix),
      style: styles === null || styles === void 0 ? void 0 : styles.suffix
    }, clearIcon, suffix);
    element = /*#__PURE__*/react.createElement(AffixWrapperComponent, (0,esm_extends/* default */.A)({
      className: affixWrapperCls,
      style: styles === null || styles === void 0 ? void 0 : styles.affixWrapper,
      onClick: onInputClick
    }, dataAttrs === null || dataAttrs === void 0 ? void 0 : dataAttrs.affixWrapper, {
      ref: containerRef
    }), prefix && /*#__PURE__*/react.createElement("span", {
      className: classnames_default()("".concat(prefixCls, "-prefix"), classNames === null || classNames === void 0 ? void 0 : classNames.prefix),
      style: styles === null || styles === void 0 ? void 0 : styles.prefix
    }, prefix), element, suffixNode);
  }

  // ================== Addon ================== //
  if ((0,commonUtils/* hasAddon */.bk)(props)) {
    var wrapperCls = "".concat(prefixCls, "-group");
    var addonCls = "".concat(wrapperCls, "-addon");
    var groupWrapperCls = "".concat(wrapperCls, "-wrapper");
    var mergedWrapperClassName = classnames_default()("".concat(prefixCls, "-wrapper"), wrapperCls, classes === null || classes === void 0 ? void 0 : classes.wrapper, classNames === null || classNames === void 0 ? void 0 : classNames.wrapper);
    var mergedGroupClassName = classnames_default()(groupWrapperCls, (0,defineProperty/* default */.A)({}, "".concat(groupWrapperCls, "-disabled"), disabled), classes === null || classes === void 0 ? void 0 : classes.group, classNames === null || classNames === void 0 ? void 0 : classNames.groupWrapper);

    // Need another wrapper for changing display:table to display:inline-block
    // and put style prop in wrapper
    element = /*#__PURE__*/react.createElement(GroupWrapperComponent, {
      className: mergedGroupClassName,
      ref: groupRef
    }, /*#__PURE__*/react.createElement(WrapperComponent, {
      className: mergedWrapperClassName
    }, addonBefore && /*#__PURE__*/react.createElement(GroupAddonComponent, {
      className: addonCls
    }, addonBefore), element, addonAfter && /*#__PURE__*/react.createElement(GroupAddonComponent, {
      className: addonCls
    }, addonAfter)));
  }

  // `className` and `style` are always on the root element
  return /*#__PURE__*/react.cloneElement(element, {
    className: classnames_default()((_element$props = element.props) === null || _element$props === void 0 ? void 0 : _element$props.className, className) || null,
    style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, (_element$props2 = element.props) === null || _element$props2 === void 0 ? void 0 : _element$props2.style), style),
    hidden: hidden
  });
});
/* harmony default export */ var es_BaseInput = (BaseInput);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
var objectWithoutProperties = __webpack_require__(80045);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
// EXTERNAL MODULE: ./node_modules/rc-input/es/hooks/useCount.js
var useCount = __webpack_require__(22489);
;// ./node_modules/rc-input/es/Input.js






var _excluded = ["autoComplete", "onChange", "onFocus", "onBlur", "onPressEnter", "onKeyDown", "onKeyUp", "prefixCls", "disabled", "htmlSize", "className", "maxLength", "suffix", "showCount", "count", "type", "classes", "classNames", "styles", "onCompositionStart", "onCompositionEnd"];







var Input = /*#__PURE__*/(0,react.forwardRef)(function (props, ref) {
  var autoComplete = props.autoComplete,
    onChange = props.onChange,
    onFocus = props.onFocus,
    onBlur = props.onBlur,
    onPressEnter = props.onPressEnter,
    onKeyDown = props.onKeyDown,
    onKeyUp = props.onKeyUp,
    _props$prefixCls = props.prefixCls,
    prefixCls = _props$prefixCls === void 0 ? 'rc-input' : _props$prefixCls,
    disabled = props.disabled,
    htmlSize = props.htmlSize,
    className = props.className,
    maxLength = props.maxLength,
    suffix = props.suffix,
    showCount = props.showCount,
    count = props.count,
    _props$type = props.type,
    type = _props$type === void 0 ? 'text' : _props$type,
    classes = props.classes,
    classNames = props.classNames,
    styles = props.styles,
    _onCompositionStart = props.onCompositionStart,
    onCompositionEnd = props.onCompositionEnd,
    rest = (0,objectWithoutProperties/* default */.A)(props, _excluded);
  var _useState = (0,react.useState)(false),
    _useState2 = (0,slicedToArray/* default */.A)(_useState, 2),
    focused = _useState2[0],
    setFocused = _useState2[1];
  var compositionRef = (0,react.useRef)(false);
  var keyLockRef = (0,react.useRef)(false);
  var inputRef = (0,react.useRef)(null);
  var holderRef = (0,react.useRef)(null);
  var focus = function focus(option) {
    if (inputRef.current) {
      (0,commonUtils/* triggerFocus */.F4)(inputRef.current, option);
    }
  };

  // ====================== Value =======================
  var _useMergedState = (0,useMergedState/* default */.A)(props.defaultValue, {
      value: props.value
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    value = _useMergedState2[0],
    setValue = _useMergedState2[1];
  var formatValue = value === undefined || value === null ? '' : String(value);

  // =================== Select Range ===================
  var _useState3 = (0,react.useState)(null),
    _useState4 = (0,slicedToArray/* default */.A)(_useState3, 2),
    selection = _useState4[0],
    setSelection = _useState4[1];

  // ====================== Count =======================
  var countConfig = (0,useCount/* default */.A)(count, showCount);
  var mergedMax = countConfig.max || maxLength;
  var valueLength = countConfig.strategy(formatValue);
  var isOutOfRange = !!mergedMax && valueLength > mergedMax;

  // ======================= Ref ========================
  (0,react.useImperativeHandle)(ref, function () {
    var _holderRef$current;
    return {
      focus: focus,
      blur: function blur() {
        var _inputRef$current;
        (_inputRef$current = inputRef.current) === null || _inputRef$current === void 0 || _inputRef$current.blur();
      },
      setSelectionRange: function setSelectionRange(start, end, direction) {
        var _inputRef$current2;
        (_inputRef$current2 = inputRef.current) === null || _inputRef$current2 === void 0 || _inputRef$current2.setSelectionRange(start, end, direction);
      },
      select: function select() {
        var _inputRef$current3;
        (_inputRef$current3 = inputRef.current) === null || _inputRef$current3 === void 0 || _inputRef$current3.select();
      },
      input: inputRef.current,
      nativeElement: ((_holderRef$current = holderRef.current) === null || _holderRef$current === void 0 ? void 0 : _holderRef$current.nativeElement) || inputRef.current
    };
  });
  (0,react.useEffect)(function () {
    if (keyLockRef.current) {
      keyLockRef.current = false;
    }
    setFocused(function (prev) {
      return prev && disabled ? false : prev;
    });
  }, [disabled]);
  var triggerChange = function triggerChange(e, currentValue, info) {
    var cutValue = currentValue;
    if (!compositionRef.current && countConfig.exceedFormatter && countConfig.max && countConfig.strategy(currentValue) > countConfig.max) {
      cutValue = countConfig.exceedFormatter(currentValue, {
        max: countConfig.max
      });
      if (currentValue !== cutValue) {
        var _inputRef$current4, _inputRef$current5;
        setSelection([((_inputRef$current4 = inputRef.current) === null || _inputRef$current4 === void 0 ? void 0 : _inputRef$current4.selectionStart) || 0, ((_inputRef$current5 = inputRef.current) === null || _inputRef$current5 === void 0 ? void 0 : _inputRef$current5.selectionEnd) || 0]);
      }
    } else if (info.source === 'compositionEnd') {
      // Avoid triggering twice
      // https://github.com/ant-design/ant-design/issues/46587
      return;
    }
    setValue(cutValue);
    if (inputRef.current) {
      (0,commonUtils/* resolveOnChange */.gS)(inputRef.current, e, onChange, cutValue);
    }
  };
  (0,react.useEffect)(function () {
    if (selection) {
      var _inputRef$current6;
      (_inputRef$current6 = inputRef.current) === null || _inputRef$current6 === void 0 || _inputRef$current6.setSelectionRange.apply(_inputRef$current6, (0,toConsumableArray/* default */.A)(selection));
    }
  }, [selection]);
  var onInternalChange = function onInternalChange(e) {
    triggerChange(e, e.target.value, {
      source: 'change'
    });
  };
  var onInternalCompositionEnd = function onInternalCompositionEnd(e) {
    compositionRef.current = false;
    triggerChange(e, e.currentTarget.value, {
      source: 'compositionEnd'
    });
    onCompositionEnd === null || onCompositionEnd === void 0 || onCompositionEnd(e);
  };
  var handleKeyDown = function handleKeyDown(e) {
    if (onPressEnter && e.key === 'Enter' && !keyLockRef.current) {
      keyLockRef.current = true;
      onPressEnter(e);
    }
    onKeyDown === null || onKeyDown === void 0 || onKeyDown(e);
  };
  var handleKeyUp = function handleKeyUp(e) {
    if (e.key === 'Enter') {
      keyLockRef.current = false;
    }
    onKeyUp === null || onKeyUp === void 0 || onKeyUp(e);
  };
  var handleFocus = function handleFocus(e) {
    setFocused(true);
    onFocus === null || onFocus === void 0 || onFocus(e);
  };
  var handleBlur = function handleBlur(e) {
    if (keyLockRef.current) {
      keyLockRef.current = false;
    }
    setFocused(false);
    onBlur === null || onBlur === void 0 || onBlur(e);
  };
  var handleReset = function handleReset(e) {
    setValue('');
    focus();
    if (inputRef.current) {
      (0,commonUtils/* resolveOnChange */.gS)(inputRef.current, e, onChange);
    }
  };

  // ====================== Input =======================
  var outOfRangeCls = isOutOfRange && "".concat(prefixCls, "-out-of-range");
  var getInputElement = function getInputElement() {
    // Fix https://fb.me/react-unknown-prop
    var otherProps = (0,omit/* default */.A)(props, ['prefixCls', 'onPressEnter', 'addonBefore', 'addonAfter', 'prefix', 'suffix', 'allowClear',
    // Input elements must be either controlled or uncontrolled,
    // specify either the value prop, or the defaultValue prop, but not both.
    'defaultValue', 'showCount', 'count', 'classes', 'htmlSize', 'styles', 'classNames', 'onClear']);
    return /*#__PURE__*/react.createElement("input", (0,esm_extends/* default */.A)({
      autoComplete: autoComplete
    }, otherProps, {
      onChange: onInternalChange,
      onFocus: handleFocus,
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
      onKeyUp: handleKeyUp,
      className: classnames_default()(prefixCls, (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-disabled"), disabled), classNames === null || classNames === void 0 ? void 0 : classNames.input),
      style: styles === null || styles === void 0 ? void 0 : styles.input,
      ref: inputRef,
      size: htmlSize,
      type: type,
      onCompositionStart: function onCompositionStart(e) {
        compositionRef.current = true;
        _onCompositionStart === null || _onCompositionStart === void 0 || _onCompositionStart(e);
      },
      onCompositionEnd: onInternalCompositionEnd
    }));
  };
  var getSuffix = function getSuffix() {
    // Max length value
    var hasMaxLength = Number(mergedMax) > 0;
    if (suffix || countConfig.show) {
      var dataCount = countConfig.showFormatter ? countConfig.showFormatter({
        value: formatValue,
        count: valueLength,
        maxLength: mergedMax
      }) : "".concat(valueLength).concat(hasMaxLength ? " / ".concat(mergedMax) : '');
      return /*#__PURE__*/react.createElement(react.Fragment, null, countConfig.show && /*#__PURE__*/react.createElement("span", {
        className: classnames_default()("".concat(prefixCls, "-show-count-suffix"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-show-count-has-suffix"), !!suffix), classNames === null || classNames === void 0 ? void 0 : classNames.count),
        style: (0,objectSpread2/* default */.A)({}, styles === null || styles === void 0 ? void 0 : styles.count)
      }, dataCount), suffix);
    }
    return null;
  };

  // ====================== Render ======================
  return /*#__PURE__*/react.createElement(es_BaseInput, (0,esm_extends/* default */.A)({}, rest, {
    prefixCls: prefixCls,
    className: classnames_default()(className, outOfRangeCls),
    handleReset: handleReset,
    value: formatValue,
    focused: focused,
    triggerFocus: focus,
    suffix: getSuffix(),
    disabled: disabled,
    classes: classes,
    classNames: classNames,
    styles: styles
  }), getInputElement());
});
/* harmony default export */ var es_Input = (Input);
;// ./node_modules/rc-input/es/index.js



/* harmony default export */ var es = (es_Input);

/***/ }),

/***/ 11980:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   F4: function() { return /* binding */ triggerFocus; },
/* harmony export */   OL: function() { return /* binding */ hasPrefixSuffix; },
/* harmony export */   bk: function() { return /* binding */ hasAddon; },
/* harmony export */   gS: function() { return /* binding */ resolveOnChange; }
/* harmony export */ });
function hasAddon(props) {
  return !!(props.addonBefore || props.addonAfter);
}
function hasPrefixSuffix(props) {
  return !!(props.prefix || props.suffix || props.allowClear);
}

// TODO: It's better to use `Proxy` replace the `element.value`. But we still need support IE11.
function cloneEvent(event, target, value) {
  // A bug report filed on WebKit's Bugzilla tracker, dating back to 2009, specifically addresses the issue of cloneNode() not copying files of <input type="file"> elements.
  // As of the last update, this bug was still marked as "NEW," indicating that it might not have been resolved yet​​.
  // https://bugs.webkit.org/show_bug.cgi?id=28123
  var currentTarget = target.cloneNode(true);

  // click clear icon
  var newEvent = Object.create(event, {
    target: {
      value: currentTarget
    },
    currentTarget: {
      value: currentTarget
    }
  });

  // Fill data
  currentTarget.value = value;

  // Fill selection. Some type like `email` not support selection
  // https://github.com/ant-design/ant-design/issues/47833
  if (typeof target.selectionStart === 'number' && typeof target.selectionEnd === 'number') {
    currentTarget.selectionStart = target.selectionStart;
    currentTarget.selectionEnd = target.selectionEnd;
  }
  currentTarget.setSelectionRange = function () {
    target.setSelectionRange.apply(target, arguments);
  };
  return newEvent;
}
function resolveOnChange(target, e, onChange, targetValue) {
  if (!onChange) {
    return;
  }
  var event = e;
  if (e.type === 'click') {
    // Clone a new target for event.
    // Avoid the following usage, the setQuery method gets the original value.
    //
    // const [query, setQuery] = React.useState('');
    // <Input
    //   allowClear
    //   value={query}
    //   onChange={(e)=> {
    //     setQuery((prevStatus) => e.target.value);
    //   }}
    // />

    event = cloneEvent(e, target, '');
    onChange(event);
    return;
  }

  // Trigger by composition event, this means we need force change the input value
  // https://github.com/ant-design/ant-design/issues/45737
  // https://github.com/ant-design/ant-design/issues/46598
  if (target.type !== 'file' && targetValue !== undefined) {
    event = cloneEvent(e, target, targetValue);
    onChange(event);
    return;
  }
  onChange(event);
}
function triggerFocus(element, option) {
  if (!element) return;
  element.focus(option);

  // Selection content
  var _ref = option || {},
    cursor = _ref.cursor;
  if (cursor) {
    var len = element.value.length;
    switch (cursor) {
      case 'start':
        element.setSelectionRange(0, 0);
        break;
      case 'end':
        element.setSelectionRange(len, len);
        break;
      default:
        element.setSelectionRange(0, len);
    }
  }
}

/***/ })

}]);
//# sourceMappingURL=17c02182aa4ff06dbd55ee72b76b25dc61ec1947-e2ef587165a16c5961b5.js.map