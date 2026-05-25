(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[6355],{

/***/ 17965:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";


var deselectCurrent = __webpack_require__(16426);

var clipboardToIE11Formatting = {
  "text/plain": "Text",
  "text/html": "Url",
  "default": "Text"
}

var defaultMessage = "Copy to clipboard: #{key}, Enter";

function format(message) {
  var copyKey = (/mac os x/i.test(navigator.userAgent) ? "⌘" : "Ctrl") + "+C";
  return message.replace(/#{\s*key\s*}/g, copyKey);
}

function copy(text, options) {
  var debug,
    message,
    reselectPrevious,
    range,
    selection,
    mark,
    success = false;
  if (!options) {
    options = {};
  }
  debug = options.debug || false;
  try {
    reselectPrevious = deselectCurrent();

    range = document.createRange();
    selection = document.getSelection();

    mark = document.createElement("span");
    mark.textContent = text;
    // avoid screen readers from reading out loud the text
    mark.ariaHidden = "true"
    // reset user styles for span element
    mark.style.all = "unset";
    // prevents scrolling to the end of the page
    mark.style.position = "fixed";
    mark.style.top = 0;
    mark.style.clip = "rect(0, 0, 0, 0)";
    // used to preserve spaces and line breaks
    mark.style.whiteSpace = "pre";
    // do not inherit user-select (it may be `none`)
    mark.style.webkitUserSelect = "text";
    mark.style.MozUserSelect = "text";
    mark.style.msUserSelect = "text";
    mark.style.userSelect = "text";
    mark.addEventListener("copy", function(e) {
      e.stopPropagation();
      if (options.format) {
        e.preventDefault();
        if (typeof e.clipboardData === "undefined") { // IE 11
          debug && console.warn("unable to use e.clipboardData");
          debug && console.warn("trying IE specific stuff");
          window.clipboardData.clearData();
          var format = clipboardToIE11Formatting[options.format] || clipboardToIE11Formatting["default"]
          window.clipboardData.setData(format, text);
        } else { // all other browsers
          e.clipboardData.clearData();
          e.clipboardData.setData(options.format, text);
        }
      }
      if (options.onCopy) {
        e.preventDefault();
        options.onCopy(e.clipboardData);
      }
    });

    document.body.appendChild(mark);

    range.selectNodeContents(mark);
    selection.addRange(range);

    var successful = document.execCommand("copy");
    if (!successful) {
      throw new Error("copy command was unsuccessful");
    }
    success = true;
  } catch (err) {
    debug && console.error("unable to copy using execCommand: ", err);
    debug && console.warn("trying IE specific stuff");
    try {
      window.clipboardData.setData(options.format || "text", text);
      options.onCopy && options.onCopy(window.clipboardData);
      success = true;
    } catch (err) {
      debug && console.error("unable to copy using clipboardData: ", err);
      debug && console.error("falling back to prompt");
      message = format("message" in options ? options.message : defaultMessage);
      window.prompt(message, text);
    }
  } finally {
    if (selection) {
      if (typeof selection.removeRange == "function") {
        selection.removeRange(range);
      } else {
        selection.removeAllRanges();
      }
    }

    if (mark) {
      document.body.removeChild(mark);
    }
    reselectPrevious();
  }

  return success;
}

module.exports = copy;


/***/ }),

/***/ 2754:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ settings_UsageAnalyticsPage; }
});

// EXTERNAL MODULE: ./node_modules/core-js/modules/es.array.sort.js
var es_array_sort = __webpack_require__(26910);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/antd/es/spin/index.js + 6 modules
var spin = __webpack_require__(34716);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/index.js + 8 modules
var config_provider = __webpack_require__(20867);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/index.js + 6 modules
var theme = __webpack_require__(5131);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
var objectWithoutProperties = __webpack_require__(80045);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectSpread2.js
var objectSpread2 = __webpack_require__(89379);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/typeof.js
var esm_typeof = __webpack_require__(82284);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var es_ref = __webpack_require__(8719);
// EXTERNAL MODULE: ./node_modules/rc-motion/es/index.js + 13 modules
var es = __webpack_require__(90754);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useLayoutEffect.js
var useLayoutEffect = __webpack_require__(30981);
;// ./node_modules/rc-segmented/es/MotionThumb.js







var calcThumbStyle = function calcThumbStyle(targetElement, vertical) {
  if (!targetElement) return null;
  var style = {
    left: targetElement.offsetLeft,
    right: targetElement.parentElement.clientWidth - targetElement.clientWidth - targetElement.offsetLeft,
    width: targetElement.clientWidth,
    top: targetElement.offsetTop,
    bottom: targetElement.parentElement.clientHeight - targetElement.clientHeight - targetElement.offsetTop,
    height: targetElement.clientHeight
  };
  if (vertical) {
    // Adjusts positioning and size for vertical layout by setting horizontal properties to 0 and using vertical properties from the style object.
    return {
      left: 0,
      right: 0,
      width: 0,
      top: style.top,
      bottom: style.bottom,
      height: style.height
    };
  }
  return {
    left: style.left,
    right: style.right,
    width: style.width,
    top: 0,
    bottom: 0,
    height: 0
  };
};
var toPX = function toPX(value) {
  return value !== undefined ? "".concat(value, "px") : undefined;
};
function MotionThumb(props) {
  var prefixCls = props.prefixCls,
    containerRef = props.containerRef,
    value = props.value,
    getValueIndex = props.getValueIndex,
    motionName = props.motionName,
    onMotionStart = props.onMotionStart,
    onMotionEnd = props.onMotionEnd,
    direction = props.direction,
    _props$vertical = props.vertical,
    vertical = _props$vertical === void 0 ? false : _props$vertical;
  var thumbRef = react.useRef(null);
  var _React$useState = react.useState(value),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    prevValue = _React$useState2[0],
    setPrevValue = _React$useState2[1];

  // =========================== Effect ===========================
  var findValueElement = function findValueElement(val) {
    var _containerRef$current;
    var index = getValueIndex(val);
    var ele = (_containerRef$current = containerRef.current) === null || _containerRef$current === void 0 ? void 0 : _containerRef$current.querySelectorAll(".".concat(prefixCls, "-item"))[index];
    return (ele === null || ele === void 0 ? void 0 : ele.offsetParent) && ele;
  };
  var _React$useState3 = react.useState(null),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    prevStyle = _React$useState4[0],
    setPrevStyle = _React$useState4[1];
  var _React$useState5 = react.useState(null),
    _React$useState6 = (0,slicedToArray/* default */.A)(_React$useState5, 2),
    nextStyle = _React$useState6[0],
    setNextStyle = _React$useState6[1];
  (0,useLayoutEffect/* default */.A)(function () {
    if (prevValue !== value) {
      var prev = findValueElement(prevValue);
      var next = findValueElement(value);
      var calcPrevStyle = calcThumbStyle(prev, vertical);
      var calcNextStyle = calcThumbStyle(next, vertical);
      setPrevValue(value);
      setPrevStyle(calcPrevStyle);
      setNextStyle(calcNextStyle);
      if (prev && next) {
        onMotionStart();
      } else {
        onMotionEnd();
      }
    }
  }, [value]);
  var thumbStart = react.useMemo(function () {
    if (vertical) {
      var _prevStyle$top;
      return toPX((_prevStyle$top = prevStyle === null || prevStyle === void 0 ? void 0 : prevStyle.top) !== null && _prevStyle$top !== void 0 ? _prevStyle$top : 0);
    }
    if (direction === 'rtl') {
      return toPX(-(prevStyle === null || prevStyle === void 0 ? void 0 : prevStyle.right));
    }
    return toPX(prevStyle === null || prevStyle === void 0 ? void 0 : prevStyle.left);
  }, [vertical, direction, prevStyle]);
  var thumbActive = react.useMemo(function () {
    if (vertical) {
      var _nextStyle$top;
      return toPX((_nextStyle$top = nextStyle === null || nextStyle === void 0 ? void 0 : nextStyle.top) !== null && _nextStyle$top !== void 0 ? _nextStyle$top : 0);
    }
    if (direction === 'rtl') {
      return toPX(-(nextStyle === null || nextStyle === void 0 ? void 0 : nextStyle.right));
    }
    return toPX(nextStyle === null || nextStyle === void 0 ? void 0 : nextStyle.left);
  }, [vertical, direction, nextStyle]);

  // =========================== Motion ===========================
  var onAppearStart = function onAppearStart() {
    if (vertical) {
      return {
        transform: 'translateY(var(--thumb-start-top))',
        height: 'var(--thumb-start-height)'
      };
    }
    return {
      transform: 'translateX(var(--thumb-start-left))',
      width: 'var(--thumb-start-width)'
    };
  };
  var onAppearActive = function onAppearActive() {
    if (vertical) {
      return {
        transform: 'translateY(var(--thumb-active-top))',
        height: 'var(--thumb-active-height)'
      };
    }
    return {
      transform: 'translateX(var(--thumb-active-left))',
      width: 'var(--thumb-active-width)'
    };
  };
  var onVisibleChanged = function onVisibleChanged() {
    setPrevStyle(null);
    setNextStyle(null);
    onMotionEnd();
  };

  // =========================== Render ===========================
  // No need motion when nothing exist in queue
  if (!prevStyle || !nextStyle) {
    return null;
  }
  return /*#__PURE__*/react.createElement(es/* default */.Ay, {
    visible: true,
    motionName: motionName,
    motionAppear: true,
    onAppearStart: onAppearStart,
    onAppearActive: onAppearActive,
    onVisibleChanged: onVisibleChanged
  }, function (_ref, ref) {
    var motionClassName = _ref.className,
      motionStyle = _ref.style;
    var mergedStyle = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, motionStyle), {}, {
      '--thumb-start-left': thumbStart,
      '--thumb-start-width': toPX(prevStyle === null || prevStyle === void 0 ? void 0 : prevStyle.width),
      '--thumb-active-left': thumbActive,
      '--thumb-active-width': toPX(nextStyle === null || nextStyle === void 0 ? void 0 : nextStyle.width),
      '--thumb-start-top': thumbStart,
      '--thumb-start-height': toPX(prevStyle === null || prevStyle === void 0 ? void 0 : prevStyle.height),
      '--thumb-active-top': thumbActive,
      '--thumb-active-height': toPX(nextStyle === null || nextStyle === void 0 ? void 0 : nextStyle.height)
    });

    // It's little ugly which should be refactor when @umi/test update to latest jsdom
    var motionProps = {
      ref: (0,es_ref/* composeRef */.K4)(thumbRef, ref),
      style: mergedStyle,
      className: classnames_default()("".concat(prefixCls, "-thumb"), motionClassName)
    };
    if (false) {}
    return /*#__PURE__*/react.createElement("div", motionProps);
  });
}
;// ./node_modules/rc-segmented/es/index.js






var _excluded = ["prefixCls", "direction", "vertical", "options", "disabled", "defaultValue", "value", "onChange", "className", "motionName"];






function getValidTitle(option) {
  if (typeof option.title !== 'undefined') {
    return option.title;
  }

  // read `label` when title is `undefined`
  if ((0,esm_typeof/* default */.A)(option.label) !== 'object') {
    var _option$label;
    return (_option$label = option.label) === null || _option$label === void 0 ? void 0 : _option$label.toString();
  }
}
function normalizeOptions(options) {
  return options.map(function (option) {
    if ((0,esm_typeof/* default */.A)(option) === 'object' && option !== null) {
      var validTitle = getValidTitle(option);
      return (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, option), {}, {
        title: validTitle
      });
    }
    return {
      label: option === null || option === void 0 ? void 0 : option.toString(),
      title: option === null || option === void 0 ? void 0 : option.toString(),
      value: option
    };
  });
}
var InternalSegmentedOption = function InternalSegmentedOption(_ref) {
  var prefixCls = _ref.prefixCls,
    className = _ref.className,
    disabled = _ref.disabled,
    checked = _ref.checked,
    label = _ref.label,
    title = _ref.title,
    value = _ref.value,
    onChange = _ref.onChange;
  var handleChange = function handleChange(event) {
    if (disabled) {
      return;
    }
    onChange(event, value);
  };
  return /*#__PURE__*/react.createElement("label", {
    className: classnames_default()(className, (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-item-disabled"), disabled))
  }, /*#__PURE__*/react.createElement("input", {
    className: "".concat(prefixCls, "-item-input"),
    type: "radio",
    disabled: disabled,
    checked: checked,
    onChange: handleChange
  }), /*#__PURE__*/react.createElement("div", {
    className: "".concat(prefixCls, "-item-label"),
    title: title,
    role: "option",
    "aria-selected": checked
  }, label));
};
var Segmented = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var _segmentedOptions$, _classNames2;
  var _props$prefixCls = props.prefixCls,
    prefixCls = _props$prefixCls === void 0 ? 'rc-segmented' : _props$prefixCls,
    direction = props.direction,
    vertical = props.vertical,
    _props$options = props.options,
    options = _props$options === void 0 ? [] : _props$options,
    disabled = props.disabled,
    defaultValue = props.defaultValue,
    value = props.value,
    onChange = props.onChange,
    _props$className = props.className,
    className = _props$className === void 0 ? '' : _props$className,
    _props$motionName = props.motionName,
    motionName = _props$motionName === void 0 ? 'thumb-motion' : _props$motionName,
    restProps = (0,objectWithoutProperties/* default */.A)(props, _excluded);
  var containerRef = react.useRef(null);
  var mergedRef = react.useMemo(function () {
    return (0,es_ref/* composeRef */.K4)(containerRef, ref);
  }, [containerRef, ref]);
  var segmentedOptions = react.useMemo(function () {
    return normalizeOptions(options);
  }, [options]);

  // Note: We should not auto switch value when value not exist in options
  // which may break single source of truth.
  var _useMergedState = (0,useMergedState/* default */.A)((_segmentedOptions$ = segmentedOptions[0]) === null || _segmentedOptions$ === void 0 ? void 0 : _segmentedOptions$.value, {
      value: value,
      defaultValue: defaultValue
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    rawValue = _useMergedState2[0],
    setRawValue = _useMergedState2[1];

  // ======================= Change ========================
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    thumbShow = _React$useState2[0],
    setThumbShow = _React$useState2[1];
  var handleChange = function handleChange(event, val) {
    if (disabled) {
      return;
    }
    setRawValue(val);
    onChange === null || onChange === void 0 || onChange(val);
  };
  var divProps = (0,omit/* default */.A)(restProps, ['children']);
  return /*#__PURE__*/react.createElement("div", (0,esm_extends/* default */.A)({
    role: "listbox",
    "aria-label": "segmented control"
  }, divProps, {
    className: classnames_default()(prefixCls, (_classNames2 = {}, (0,defineProperty/* default */.A)(_classNames2, "".concat(prefixCls, "-rtl"), direction === 'rtl'), (0,defineProperty/* default */.A)(_classNames2, "".concat(prefixCls, "-disabled"), disabled), (0,defineProperty/* default */.A)(_classNames2, "".concat(prefixCls, "-vertical"), vertical), _classNames2), className),
    ref: mergedRef
  }), /*#__PURE__*/react.createElement("div", {
    className: "".concat(prefixCls, "-group")
  }, /*#__PURE__*/react.createElement(MotionThumb, {
    vertical: vertical,
    prefixCls: prefixCls,
    value: rawValue,
    containerRef: containerRef,
    motionName: "".concat(prefixCls, "-").concat(motionName),
    direction: direction,
    getValueIndex: function getValueIndex(val) {
      return segmentedOptions.findIndex(function (n) {
        return n.value === val;
      });
    },
    onMotionStart: function onMotionStart() {
      setThumbShow(true);
    },
    onMotionEnd: function onMotionEnd() {
      setThumbShow(false);
    }
  }), segmentedOptions.map(function (segmentedOption) {
    return /*#__PURE__*/react.createElement(InternalSegmentedOption, (0,esm_extends/* default */.A)({}, segmentedOption, {
      key: segmentedOption.value,
      prefixCls: prefixCls,
      className: classnames_default()(segmentedOption.className, "".concat(prefixCls, "-item"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-item-selected"), segmentedOption.value === rawValue && !thumbShow)),
      checked: segmentedOption.value === rawValue,
      onChange: handleChange,
      disabled: !!disabled || !!segmentedOption.disabled
    }));
  })));
});
if (false) {}
var TypedSegmented = Segmented;
/* harmony default export */ var rc_segmented_es = (TypedSegmented);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
;// ./node_modules/antd/es/segmented/style/index.js



// ============================== Mixins ==============================
function getItemDisabledStyle(cls, token) {
  return {
    [`${cls}, ${cls}:hover, ${cls}:focus`]: {
      color: token.colorTextDisabled,
      cursor: 'not-allowed'
    }
  };
}
function getItemSelectedStyle(token) {
  return {
    backgroundColor: token.itemSelectedBg,
    boxShadow: token.boxShadowTertiary
  };
}
const segmentedTextEllipsisCss = Object.assign({
  overflow: 'hidden'
}, style/* textEllipsis */.L9);
// ============================== Styles ==============================
const genSegmentedStyle = token => {
  const {
    componentCls
  } = token;
  const labelHeight = token.calc(token.controlHeight).sub(token.calc(token.trackPadding).mul(2)).equal();
  const labelHeightLG = token.calc(token.controlHeightLG).sub(token.calc(token.trackPadding).mul(2)).equal();
  const labelHeightSM = token.calc(token.controlHeightSM).sub(token.calc(token.trackPadding).mul(2)).equal();
  return {
    [componentCls]: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      display: 'inline-block',
      padding: token.trackPadding,
      color: token.itemColor,
      background: token.trackBg,
      borderRadius: token.borderRadius,
      transition: `all ${token.motionDurationMid} ${token.motionEaseInOut}`,
      [`${componentCls}-group`]: {
        position: 'relative',
        display: 'flex',
        alignItems: 'stretch',
        justifyItems: 'flex-start',
        flexDirection: 'row',
        width: '100%'
      },
      // RTL styles
      [`&${componentCls}-rtl`]: {
        direction: 'rtl'
      },
      [`&${componentCls}-vertical`]: {
        [`${componentCls}-group`]: {
          flexDirection: 'column'
        },
        [`${componentCls}-thumb`]: {
          width: '100%',
          height: 0,
          padding: `0 ${(0,cssinjs_es/* unit */.zA)(token.paddingXXS)}`
        }
      },
      // block styles
      [`&${componentCls}-block`]: {
        display: 'flex'
      },
      [`&${componentCls}-block ${componentCls}-item`]: {
        flex: 1,
        minWidth: 0
      },
      // item styles
      [`${componentCls}-item`]: {
        position: 'relative',
        textAlign: 'center',
        cursor: 'pointer',
        transition: `color ${token.motionDurationMid} ${token.motionEaseInOut}`,
        borderRadius: token.borderRadiusSM,
        // Fix Safari render bug
        // https://github.com/ant-design/ant-design/issues/45250
        transform: 'translateZ(0)',
        '&-selected': Object.assign(Object.assign({}, getItemSelectedStyle(token)), {
          color: token.itemSelectedColor
        }),
        '&::after': {
          content: '""',
          position: 'absolute',
          zIndex: -1,
          width: '100%',
          height: '100%',
          top: 0,
          insetInlineStart: 0,
          borderRadius: 'inherit',
          transition: `background-color ${token.motionDurationMid}`,
          // This is mandatory to make it not clickable or hoverable
          // Ref: https://github.com/ant-design/ant-design/issues/40888
          pointerEvents: 'none'
        },
        [`&:hover:not(${componentCls}-item-selected):not(${componentCls}-item-disabled)`]: {
          color: token.itemHoverColor,
          '&::after': {
            backgroundColor: token.itemHoverBg
          }
        },
        [`&:active:not(${componentCls}-item-selected):not(${componentCls}-item-disabled)`]: {
          color: token.itemHoverColor,
          '&::after': {
            backgroundColor: token.itemActiveBg
          }
        },
        '&-label': Object.assign({
          minHeight: labelHeight,
          lineHeight: (0,cssinjs_es/* unit */.zA)(labelHeight),
          padding: `0 ${(0,cssinjs_es/* unit */.zA)(token.segmentedPaddingHorizontal)}`
        }, segmentedTextEllipsisCss),
        // syntactic sugar to add `icon` for Segmented Item
        '&-icon + *': {
          marginInlineStart: token.calc(token.marginSM).div(2).equal()
        },
        '&-input': {
          position: 'absolute',
          insetBlockStart: 0,
          insetInlineStart: 0,
          width: 0,
          height: 0,
          opacity: 0,
          pointerEvents: 'none'
        }
      },
      // thumb styles
      [`${componentCls}-thumb`]: Object.assign(Object.assign({}, getItemSelectedStyle(token)), {
        position: 'absolute',
        insetBlockStart: 0,
        insetInlineStart: 0,
        width: 0,
        height: '100%',
        padding: `${(0,cssinjs_es/* unit */.zA)(token.paddingXXS)} 0`,
        borderRadius: token.borderRadiusSM,
        transition: `transform ${token.motionDurationSlow} ${token.motionEaseInOut}, height ${token.motionDurationSlow} ${token.motionEaseInOut}`,
        [`& ~ ${componentCls}-item:not(${componentCls}-item-selected):not(${componentCls}-item-disabled)::after`]: {
          backgroundColor: 'transparent'
        }
      }),
      // size styles
      [`&${componentCls}-lg`]: {
        borderRadius: token.borderRadiusLG,
        [`${componentCls}-item-label`]: {
          minHeight: labelHeightLG,
          lineHeight: (0,cssinjs_es/* unit */.zA)(labelHeightLG),
          padding: `0 ${(0,cssinjs_es/* unit */.zA)(token.segmentedPaddingHorizontal)}`,
          fontSize: token.fontSizeLG
        },
        [`${componentCls}-item, ${componentCls}-thumb`]: {
          borderRadius: token.borderRadius
        }
      },
      [`&${componentCls}-sm`]: {
        borderRadius: token.borderRadiusSM,
        [`${componentCls}-item-label`]: {
          minHeight: labelHeightSM,
          lineHeight: (0,cssinjs_es/* unit */.zA)(labelHeightSM),
          padding: `0 ${(0,cssinjs_es/* unit */.zA)(token.segmentedPaddingHorizontalSM)}`
        },
        [`${componentCls}-item, ${componentCls}-thumb`]: {
          borderRadius: token.borderRadiusXS
        }
      }
    }), getItemDisabledStyle(`&-disabled ${componentCls}-item`, token)), getItemDisabledStyle(`${componentCls}-item-disabled`, token)), {
      // transition effect when `appear-active`
      [`${componentCls}-thumb-motion-appear-active`]: {
        transition: `transform ${token.motionDurationSlow} ${token.motionEaseInOut}, width ${token.motionDurationSlow} ${token.motionEaseInOut}`,
        willChange: 'transform, width'
      }
    })
  };
};
// ============================== Export ==============================
const prepareComponentToken = token => {
  const {
    colorTextLabel,
    colorText,
    colorFillSecondary,
    colorBgElevated,
    colorFill,
    lineWidthBold,
    colorBgLayout
  } = token;
  return {
    trackPadding: lineWidthBold,
    trackBg: colorBgLayout,
    itemColor: colorTextLabel,
    itemHoverColor: colorText,
    itemHoverBg: colorFillSecondary,
    itemSelectedBg: colorBgElevated,
    itemActiveBg: colorFill,
    itemSelectedColor: colorText
  };
};
/* harmony default export */ var segmented_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Segmented', token => {
  const {
    lineWidth,
    calc
  } = token;
  const segmentedToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    segmentedPaddingHorizontal: calc(token.controlPaddingHorizontal).sub(lineWidth).equal(),
    segmentedPaddingHorizontalSM: calc(token.controlPaddingHorizontalSM).sub(lineWidth).equal()
  });
  return [genSegmentedStyle(segmentedToken)];
}, prepareComponentToken));
;// ./node_modules/antd/es/segmented/index.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};






function isSegmentedLabeledOptionWithIcon(option) {
  return typeof option === 'object' && !!(option === null || option === void 0 ? void 0 : option.icon);
}
const InternalSegmented = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      block,
      options = [],
      size: customSize = 'middle',
      style,
      vertical
    } = props,
    restProps = __rest(props, ["prefixCls", "className", "rootClassName", "block", "options", "size", "style", "vertical"]);
  const {
    getPrefixCls,
    direction,
    segmented
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('segmented', customizePrefixCls);
  // Style
  const [wrapCSSVar, hashId, cssVarCls] = segmented_style(prefixCls);
  // ===================== Size =====================
  const mergedSize = (0,useSize/* default */.A)(customSize);
  // syntactic sugar to support `icon` for Segmented Item
  const extendedOptions = react.useMemo(() => options.map(option => {
    if (isSegmentedLabeledOptionWithIcon(option)) {
      const {
          icon,
          label
        } = option,
        restOption = __rest(option, ["icon", "label"]);
      return Object.assign(Object.assign({}, restOption), {
        label: (/*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("span", {
          className: `${prefixCls}-item-icon`
        }, icon), label && /*#__PURE__*/react.createElement("span", null, label)))
      });
    }
    return option;
  }), [options, prefixCls]);
  const cls = classnames_default()(className, rootClassName, segmented === null || segmented === void 0 ? void 0 : segmented.className, {
    [`${prefixCls}-block`]: block,
    [`${prefixCls}-sm`]: mergedSize === 'small',
    [`${prefixCls}-lg`]: mergedSize === 'large',
    [`${prefixCls}-vertical`]: vertical
  }, hashId, cssVarCls);
  const mergedStyle = Object.assign(Object.assign({}, segmented === null || segmented === void 0 ? void 0 : segmented.style), style);
  return wrapCSSVar(/*#__PURE__*/react.createElement(rc_segmented_es, Object.assign({}, restProps, {
    className: cls,
    style: mergedStyle,
    options: extendedOptions,
    ref: ref,
    prefixCls: prefixCls,
    direction: direction,
    vertical: vertical
  })));
});
const segmented_Segmented = InternalSegmented;
if (false) {}
/* harmony default export */ var segmented = (segmented_Segmented);
// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CheckCircleFilled.js + 1 modules
var CheckCircleFilled = __webpack_require__(38811);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CloseCircleFilled.js + 1 modules
var CloseCircleFilled = __webpack_require__(36029);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/ExclamationCircleFilled.js + 1 modules
var ExclamationCircleFilled = __webpack_require__(7541);
;// ./node_modules/@ant-design/icons-svg/es/asn/WarningFilled.js
// This icon file is generated automatically.
var WarningFilled = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M955.7 856l-416-720c-6.2-10.7-16.9-16-27.7-16s-21.6 5.3-27.7 16l-416 720C56 877.4 71.4 904 96 904h832c24.6 0 40-26.6 27.7-48zM480 416c0-4.4 3.6-8 8-8h48c4.4 0 8 3.6 8 8v184c0 4.4-3.6 8-8 8h-48c-4.4 0-8-3.6-8-8V416zm32 352a48.01 48.01 0 010-96 48.01 48.01 0 010 96z" } }] }, "name": "warning", "theme": "filled" };
/* harmony default export */ var asn_WarningFilled = (WarningFilled);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/WarningFilled.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var WarningFilled_WarningFilled = function WarningFilled(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_WarningFilled
  }));
};

/**![warning](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTk1NS43IDg1NmwtNDE2LTcyMGMtNi4yLTEwLjctMTYuOS0xNi0yNy43LTE2cy0yMS42IDUuMy0yNy43IDE2bC00MTYgNzIwQzU2IDg3Ny40IDcxLjQgOTA0IDk2IDkwNGg4MzJjMjQuNiAwIDQwLTI2LjYgMjcuNy00OHpNNDgwIDQxNmMwLTQuNCAzLjYtOCA4LThoNDhjNC40IDAgOCAzLjYgOCA4djE4NGMwIDQuNC0zLjYgOC04IDhoLTQ4Yy00LjQgMC04LTMuNi04LThWNDE2em0zMiAzNTJhNDguMDEgNDguMDEgMCAwMTAtOTYgNDguMDEgNDguMDEgMCAwMTAgOTZ6IiAvPjwvc3ZnPg==) */
var RefIcon = /*#__PURE__*/react.forwardRef(WarningFilled_WarningFilled);
if (false) {}
/* harmony default export */ var icons_WarningFilled = (RefIcon);
;// ./node_modules/antd/es/result/noFound.js
"use client";


const NoFound = () => (/*#__PURE__*/react.createElement("svg", {
  width: "252",
  height: "294"
}, /*#__PURE__*/react.createElement("title", null, "No Found"), /*#__PURE__*/react.createElement("defs", null, /*#__PURE__*/react.createElement("path", {
  d: "M0 .387h251.772v251.772H0z"
})), /*#__PURE__*/react.createElement("g", {
  fill: "none",
  fillRule: "evenodd"
}, /*#__PURE__*/react.createElement("g", {
  transform: "translate(0 .012)"
}, /*#__PURE__*/react.createElement("mask", {
  fill: "#fff"
}), /*#__PURE__*/react.createElement("path", {
  d: "M0 127.32v-2.095C0 56.279 55.892.387 124.838.387h2.096c68.946 0 124.838 55.892 124.838 124.838v2.096c0 68.946-55.892 124.838-124.838 124.838h-2.096C55.892 252.16 0 196.267 0 127.321",
  fill: "#E4EBF7",
  mask: "url(#b)"
})), /*#__PURE__*/react.createElement("path", {
  d: "M39.755 130.84a8.276 8.276 0 1 1-16.468-1.66 8.276 8.276 0 0 1 16.468 1.66",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M36.975 134.297l10.482 5.943M48.373 146.508l-12.648 10.788",
  stroke: "#FFF",
  strokeWidth: "2"
}), /*#__PURE__*/react.createElement("path", {
  d: "M39.875 159.352a5.667 5.667 0 1 1-11.277-1.136 5.667 5.667 0 0 1 11.277 1.136M57.588 143.247a5.708 5.708 0 1 1-11.358-1.145 5.708 5.708 0 0 1 11.358 1.145M99.018 26.875l29.82-.014a4.587 4.587 0 1 0-.003-9.175l-29.82.013a4.587 4.587 0 1 0 .003 9.176M110.424 45.211l29.82-.013a4.588 4.588 0 0 0-.004-9.175l-29.82.013a4.587 4.587 0 1 0 .004 9.175",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M112.798 26.861v-.002l15.784-.006a4.588 4.588 0 1 0 .003 9.175l-15.783.007v-.002a4.586 4.586 0 0 0-.004-9.172M184.523 135.668c-.553 5.485-5.447 9.483-10.931 8.93-5.485-.553-9.483-5.448-8.93-10.932.552-5.485 5.447-9.483 10.932-8.93 5.485.553 9.483 5.447 8.93 10.932",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M179.26 141.75l12.64 7.167M193.006 156.477l-15.255 13.011",
  stroke: "#FFF",
  strokeWidth: "2"
}), /*#__PURE__*/react.createElement("path", {
  d: "M184.668 170.057a6.835 6.835 0 1 1-13.6-1.372 6.835 6.835 0 0 1 13.6 1.372M203.34 153.325a6.885 6.885 0 1 1-13.7-1.382 6.885 6.885 0 0 1 13.7 1.382",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M151.931 192.324a2.222 2.222 0 1 1-4.444 0 2.222 2.222 0 0 1 4.444 0zM225.27 116.056a2.222 2.222 0 1 1-4.445 0 2.222 2.222 0 0 1 4.444 0zM216.38 151.08a2.223 2.223 0 1 1-4.446-.001 2.223 2.223 0 0 1 4.446 0zM176.917 107.636a2.223 2.223 0 1 1-4.445 0 2.223 2.223 0 0 1 4.445 0zM195.291 92.165a2.223 2.223 0 1 1-4.445 0 2.223 2.223 0 0 1 4.445 0zM202.058 180.711a2.223 2.223 0 1 1-4.446 0 2.223 2.223 0 0 1 4.446 0z",
  stroke: "#FFF",
  strokeWidth: "2"
}), /*#__PURE__*/react.createElement("path", {
  stroke: "#FFF",
  strokeWidth: "2",
  d: "M214.404 153.302l-1.912 20.184-10.928 5.99M173.661 174.792l-6.356 9.814h-11.36l-4.508 6.484M174.941 125.168v-15.804M220.824 117.25l-12.84 7.901-15.31-7.902V94.39"
}), /*#__PURE__*/react.createElement("path", {
  d: "M166.588 65.936h-3.951a4.756 4.756 0 0 1-4.743-4.742 4.756 4.756 0 0 1 4.743-4.743h3.951a4.756 4.756 0 0 1 4.743 4.743 4.756 4.756 0 0 1-4.743 4.742",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M174.823 30.03c0-16.281 13.198-29.48 29.48-29.48 16.28 0 29.48 13.199 29.48 29.48 0 16.28-13.2 29.48-29.48 29.48-16.282 0-29.48-13.2-29.48-29.48",
  fill: "#1677ff"
}), /*#__PURE__*/react.createElement("path", {
  d: "M205.952 38.387c.5.5.785 1.142.785 1.928s-.286 1.465-.785 1.964c-.572.5-1.214.75-2 .75-.785 0-1.429-.285-1.929-.785-.572-.5-.82-1.143-.82-1.929s.248-1.428.82-1.928c.5-.5 1.144-.75 1.93-.75.785 0 1.462.25 1.999.75m4.285-19.463c1.428 1.249 2.143 2.963 2.143 5.142 0 1.712-.427 3.13-1.219 4.25-.067.096-.137.18-.218.265-.416.429-1.41 1.346-2.956 2.699a5.07 5.07 0 0 0-1.428 1.75 5.207 5.207 0 0 0-.536 2.357v.5h-4.107v-.5c0-1.357.215-2.536.714-3.5.464-.964 1.857-2.464 4.178-4.536l.43-.5c.643-.785.964-1.643.964-2.535 0-1.18-.358-2.108-1-2.785-.678-.68-1.643-1.001-2.858-1.001-1.536 0-2.642.464-3.357 1.43-.37.5-.621 1.135-.76 1.904a1.999 1.999 0 0 1-1.971 1.63h-.004c-1.277 0-2.257-1.183-1.98-2.43.337-1.518 1.02-2.78 2.073-3.784 1.536-1.5 3.607-2.25 6.25-2.25 2.32 0 4.214.607 5.642 1.894",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M52.04 76.131s21.81 5.36 27.307 15.945c5.575 10.74-6.352 9.26-15.73 4.935-10.86-5.008-24.7-11.822-11.577-20.88",
  fill: "#FFB594"
}), /*#__PURE__*/react.createElement("path", {
  d: "M90.483 67.504l-.449 2.893c-.753.49-4.748-2.663-4.748-2.663l-1.645.748-1.346-5.684s6.815-4.589 8.917-5.018c2.452-.501 9.884.94 10.7 2.278 0 0 1.32.486-2.227.69-3.548.203-5.043.447-6.79 3.132-1.747 2.686-2.412 3.624-2.412 3.624",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M128.055 111.367c-2.627-7.724-6.15-13.18-8.917-15.478-3.5-2.906-9.34-2.225-11.366-4.187-1.27-1.231-3.215-1.197-3.215-1.197s-14.98-3.158-16.828-3.479c-2.37-.41-2.124-.714-6.054-1.405-1.57-1.907-2.917-1.122-2.917-1.122l-7.11-1.383c-.853-1.472-2.423-1.023-2.423-1.023l-2.468-.897c-1.645 9.976-7.74 13.796-7.74 13.796 1.795 1.122 15.703 8.3 15.703 8.3l5.107 37.11s-3.321 5.694 1.346 9.109c0 0 19.883-3.743 34.921-.329 0 0 3.047-2.546.972-8.806.523-3.01 1.394-8.263 1.736-11.622.385.772 2.019 1.918 3.14 3.477 0 0 9.407-7.365 11.052-14.012-.832-.723-1.598-1.585-2.267-2.453-.567-.736-.358-2.056-.765-2.717-.669-1.084-1.804-1.378-1.907-1.682",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M101.09 289.998s4.295 2.041 7.354 1.021c2.821-.94 4.53.668 7.08 1.178 2.55.51 6.874 1.1 11.686-1.26-.103-5.51-6.889-3.98-11.96-6.713-2.563-1.38-3.784-4.722-3.598-8.799h-9.402s-1.392 10.52-1.16 14.573",
  fill: "#CBD1D1"
}), /*#__PURE__*/react.createElement("path", {
  d: "M101.067 289.826s2.428 1.271 6.759.653c3.058-.437 3.712.481 7.423 1.031 3.712.55 10.724-.069 11.823-.894.413 1.1-.343 2.063-.343 2.063s-1.512.603-4.812.824c-2.03.136-5.8.291-7.607-.503-1.787-1.375-5.247-1.903-5.728-.241-3.918.95-7.355-.286-7.355-.286l-.16-2.647z",
  fill: "#2B0849"
}), /*#__PURE__*/react.createElement("path", {
  d: "M108.341 276.044h3.094s-.103 6.702 4.536 8.558c-4.64.618-8.558-2.303-7.63-8.558",
  fill: "#A4AABA"
}), /*#__PURE__*/react.createElement("path", {
  d: "M57.542 272.401s-2.107 7.416-4.485 12.306c-1.798 3.695-4.225 7.492 5.465 7.492 6.648 0 8.953-.48 7.423-6.599-1.53-6.12.266-13.199.266-13.199h-8.669z",
  fill: "#CBD1D1"
}), /*#__PURE__*/react.createElement("path", {
  d: "M51.476 289.793s2.097 1.169 6.633 1.169c6.083 0 8.249-1.65 8.249-1.65s.602 1.114-.619 2.165c-.993.855-3.597 1.591-7.39 1.546-4.145-.048-5.832-.566-6.736-1.168-.825-.55-.687-1.58-.137-2.062",
  fill: "#2B0849"
}), /*#__PURE__*/react.createElement("path", {
  d: "M58.419 274.304s.033 1.519-.314 2.93c-.349 1.42-1.078 3.104-1.13 4.139-.058 1.151 4.537 1.58 5.155.034.62-1.547 1.294-6.427 1.913-7.252.619-.825-4.903-2.119-5.624.15",
  fill: "#A4AABA"
}), /*#__PURE__*/react.createElement("path", {
  d: "M99.66 278.514l13.378.092s1.298-54.52 1.853-64.403c.554-9.882 3.776-43.364 1.002-63.128l-12.547-.644-22.849.78s-.434 3.966-1.195 9.976c-.063.496-.682.843-.749 1.365-.075.585.423 1.354.32 1.966-2.364 14.08-6.377 33.104-8.744 46.677-.116.666-1.234 1.009-1.458 2.691-.04.302.211 1.525.112 1.795-6.873 18.744-10.949 47.842-14.277 61.885l14.607-.014s2.197-8.57 4.03-16.97c2.811-12.886 23.111-85.01 23.111-85.01l3.016-.521 1.043 46.35s-.224 1.234.337 2.02c.56.785-.56 1.123-.392 2.244l.392 1.794s-.449 7.178-.898 11.89c-.448 4.71-.092 39.165-.092 39.165",
  fill: "#7BB2F9"
}), /*#__PURE__*/react.createElement("path", {
  d: "M76.085 221.626c1.153.094 4.038-2.019 6.955-4.935M106.36 225.142s2.774-1.11 6.103-3.883",
  stroke: "#648BD8",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M107.275 222.1s2.773-1.11 6.102-3.884",
  stroke: "#648BD8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M74.74 224.767s2.622-.591 6.505-3.365M86.03 151.634c-.27 3.106.3 8.525-4.336 9.123M103.625 149.88s.11 14.012-1.293 15.065c-2.219 1.664-2.99 1.944-2.99 1.944M99.79 150.438s.035 12.88-1.196 24.377M93.673 175.911s7.212-1.664 9.431-1.664M74.31 205.861a212.013 212.013 0 0 1-.979 4.56s-1.458 1.832-1.009 3.776c.449 1.944-.947 2.045-4.985 15.355-1.696 5.59-4.49 18.591-6.348 27.597l-.231 1.12M75.689 197.807a320.934 320.934 0 0 1-.882 4.754M82.591 152.233L81.395 162.7s-1.097.15-.5 2.244c.113 1.346-2.674 15.775-5.18 30.43M56.12 274.418h13.31",
  stroke: "#648BD8",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M116.241 148.22s-17.047-3.104-35.893.2c.158 2.514-.003 4.15-.003 4.15s14.687-2.818 35.67-.312c.252-2.355.226-4.038.226-4.038",
  fill: "#192064"
}), /*#__PURE__*/react.createElement("path", {
  d: "M106.322 151.165l.003-4.911a.81.81 0 0 0-.778-.815c-2.44-.091-5.066-.108-7.836-.014a.818.818 0 0 0-.789.815l-.003 4.906a.81.81 0 0 0 .831.813c2.385-.06 4.973-.064 7.73.017a.815.815 0 0 0 .842-.81",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M105.207 150.233l.002-3.076a.642.642 0 0 0-.619-.646 94.321 94.321 0 0 0-5.866-.01.65.65 0 0 0-.63.647v3.072a.64.64 0 0 0 .654.644 121.12 121.12 0 0 1 5.794.011c.362.01.665-.28.665-.642",
  fill: "#192064"
}), /*#__PURE__*/react.createElement("path", {
  d: "M100.263 275.415h12.338M101.436 270.53c.006 3.387.042 5.79.111 6.506M101.451 264.548a915.75 915.75 0 0 0-.015 4.337M100.986 174.965l.898 44.642s.673 1.57-.225 2.692c-.897 1.122 2.468.673.898 2.243-1.57 1.57.897 1.122 0 3.365-.596 1.489-.994 21.1-1.096 35.146",
  stroke: "#648BD8",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M46.876 83.427s-.516 6.045 7.223 5.552c11.2-.712 9.218-9.345 31.54-21.655-.786-2.708-2.447-4.744-2.447-4.744s-11.068 3.11-22.584 8.046c-6.766 2.9-13.395 6.352-13.732 12.801M104.46 91.057l.941-5.372-8.884-11.43-5.037 5.372-1.74 7.834a.321.321 0 0 0 .108.32c.965.8 6.5 5.013 14.347 3.544a.332.332 0 0 0 .264-.268",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M93.942 79.387s-4.533-2.853-2.432-6.855c1.623-3.09 4.513 1.133 4.513 1.133s.52-3.642 3.121-3.642c.52-1.04 1.561-4.162 1.561-4.162s11.445 2.601 13.526 3.121c0 5.203-2.304 19.424-7.84 19.861-8.892.703-12.449-9.456-12.449-9.456",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M113.874 73.446c2.601-2.081 3.47-9.722 3.47-9.722s-2.479-.49-6.64-2.05c-4.683-2.081-12.798-4.747-17.48.976-9.668 3.223-2.05 19.823-2.05 19.823l2.713-3.021s-3.935-3.287-2.08-6.243c2.17-3.462 3.92 1.073 3.92 1.073s.637-2.387 3.581-3.342c.355-.71 1.036-2.674 1.432-3.85a1.073 1.073 0 0 1 1.263-.704c2.4.558 8.677 2.019 11.356 2.662.522.125.871.615.82 1.15l-.305 3.248z",
  fill: "#520038"
}), /*#__PURE__*/react.createElement("path", {
  d: "M104.977 76.064c-.103.61-.582 1.038-1.07.956-.489-.083-.801-.644-.698-1.254.103-.61.582-1.038 1.07-.956.488.082.8.644.698 1.254M112.132 77.694c-.103.61-.582 1.038-1.07.956-.488-.083-.8-.644-.698-1.254.103-.61.582-1.038 1.07-.956.488.082.8.643.698 1.254",
  fill: "#552950"
}), /*#__PURE__*/react.createElement("path", {
  stroke: "#DB836E",
  strokeWidth: "1.118",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  d: "M110.13 74.84l-.896 1.61-.298 4.357h-2.228"
}), /*#__PURE__*/react.createElement("path", {
  d: "M110.846 74.481s1.79-.716 2.506.537",
  stroke: "#5C2552",
  strokeWidth: "1.118",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M92.386 74.282s.477-1.114 1.113-.716c.637.398 1.274 1.433.558 1.99-.717.556.159 1.67.159 1.67",
  stroke: "#DB836E",
  strokeWidth: "1.118",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M103.287 72.93s1.83 1.113 4.137.954",
  stroke: "#5C2552",
  strokeWidth: "1.118",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M103.685 81.762s2.227 1.193 4.376 1.193M104.64 84.308s.954.398 1.511.318M94.693 81.205s2.308 7.4 10.424 7.639",
  stroke: "#DB836E",
  strokeWidth: "1.118",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M81.45 89.384s.45 5.647-4.935 12.787M69 82.654s-.726 9.282-8.204 14.206",
  stroke: "#E4EBF7",
  strokeWidth: "1.101",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M129.405 122.865s-5.272 7.403-9.422 10.768",
  stroke: "#E4EBF7",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M119.306 107.329s.452 4.366-2.127 32.062",
  stroke: "#E4EBF7",
  strokeWidth: "1.101",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M150.028 151.232h-49.837a1.01 1.01 0 0 1-1.01-1.01v-31.688c0-.557.452-1.01 1.01-1.01h49.837c.558 0 1.01.453 1.01 1.01v31.688a1.01 1.01 0 0 1-1.01 1.01",
  fill: "#F2D7AD"
}), /*#__PURE__*/react.createElement("path", {
  d: "M150.29 151.232h-19.863v-33.707h20.784v32.786a.92.92 0 0 1-.92.92",
  fill: "#F4D19D"
}), /*#__PURE__*/react.createElement("path", {
  d: "M123.554 127.896H92.917a.518.518 0 0 1-.425-.816l6.38-9.113c.193-.277.51-.442.85-.442h31.092l-7.26 10.371z",
  fill: "#F2D7AD"
}), /*#__PURE__*/react.createElement("path", {
  fill: "#CC9B6E",
  d: "M123.689 128.447H99.25v-.519h24.169l7.183-10.26.424.298z"
}), /*#__PURE__*/react.createElement("path", {
  d: "M158.298 127.896h-18.669a2.073 2.073 0 0 1-1.659-.83l-7.156-9.541h19.965c.49 0 .95.23 1.244.622l6.69 8.92a.519.519 0 0 1-.415.83",
  fill: "#F4D19D"
}), /*#__PURE__*/react.createElement("path", {
  fill: "#CC9B6E",
  d: "M157.847 128.479h-19.384l-7.857-10.475.415-.31 7.7 10.266h19.126zM130.554 150.685l-.032-8.177.519-.002.032 8.177z"
}), /*#__PURE__*/react.createElement("path", {
  fill: "#CC9B6E",
  d: "M130.511 139.783l-.08-21.414.519-.002.08 21.414zM111.876 140.932l-.498-.143 1.479-5.167.498.143zM108.437 141.06l-2.679-2.935 2.665-3.434.41.318-2.397 3.089 2.384 2.612zM116.607 141.06l-.383-.35 2.383-2.612-2.397-3.089.41-.318 2.665 3.434z"
}), /*#__PURE__*/react.createElement("path", {
  d: "M154.316 131.892l-3.114-1.96.038 3.514-1.043.092c-1.682.115-3.634.23-4.789.23-1.902 0-2.693 2.258 2.23 2.648l-2.645-.596s-2.168 1.317.504 2.3c0 0-1.58 1.217.561 2.58-.584 3.504 5.247 4.058 7.122 3.59 1.876-.47 4.233-2.359 4.487-5.16.28-3.085-.89-5.432-3.35-7.238",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M153.686 133.577s-6.522.47-8.36.372c-1.836-.098-1.904 2.19 2.359 2.264 3.739.15 5.451-.044 5.451-.044",
  stroke: "#DB836E",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M145.16 135.877c-1.85 1.346.561 2.355.561 2.355s3.478.898 6.73.617",
  stroke: "#DB836E",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M151.89 141.71s-6.28.111-6.73-2.132c-.223-1.346.45-1.402.45-1.402M146.114 140.868s-1.103 3.16 5.44 3.533M151.202 129.932v3.477M52.838 89.286c3.533-.337 8.423-1.248 13.582-7.754",
  stroke: "#DB836E",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M168.567 248.318a6.647 6.647 0 0 1-6.647-6.647v-66.466a6.647 6.647 0 1 1 13.294 0v66.466a6.647 6.647 0 0 1-6.647 6.647",
  fill: "#5BA02E"
}), /*#__PURE__*/react.createElement("path", {
  d: "M176.543 247.653a6.647 6.647 0 0 1-6.646-6.647v-33.232a6.647 6.647 0 1 1 13.293 0v33.232a6.647 6.647 0 0 1-6.647 6.647",
  fill: "#92C110"
}), /*#__PURE__*/react.createElement("path", {
  d: "M186.443 293.613H158.92a3.187 3.187 0 0 1-3.187-3.187v-46.134a3.187 3.187 0 0 1 3.187-3.187h27.524a3.187 3.187 0 0 1 3.187 3.187v46.134a3.187 3.187 0 0 1-3.187 3.187",
  fill: "#F2D7AD"
}), /*#__PURE__*/react.createElement("path", {
  d: "M88.979 89.48s7.776 5.384 16.6 2.842",
  stroke: "#E4EBF7",
  strokeWidth: "1.101",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}))));
/* harmony default export */ var noFound = (NoFound);
;// ./node_modules/antd/es/result/serverError.js
"use client";


const ServerError = () => (/*#__PURE__*/react.createElement("svg", {
  width: "254",
  height: "294"
}, /*#__PURE__*/react.createElement("title", null, "Server Error"), /*#__PURE__*/react.createElement("defs", null, /*#__PURE__*/react.createElement("path", {
  d: "M0 .335h253.49v253.49H0z"
}), /*#__PURE__*/react.createElement("path", {
  d: "M0 293.665h253.49V.401H0z"
})), /*#__PURE__*/react.createElement("g", {
  fill: "none",
  fillRule: "evenodd"
}, /*#__PURE__*/react.createElement("g", {
  transform: "translate(0 .067)"
}, /*#__PURE__*/react.createElement("mask", {
  fill: "#fff"
}), /*#__PURE__*/react.createElement("path", {
  d: "M0 128.134v-2.11C0 56.608 56.273.334 125.69.334h2.11c69.416 0 125.69 56.274 125.69 125.69v2.11c0 69.417-56.274 125.69-125.69 125.69h-2.11C56.273 253.824 0 197.551 0 128.134",
  fill: "#E4EBF7",
  mask: "url(#b)"
})), /*#__PURE__*/react.createElement("path", {
  d: "M39.989 132.108a8.332 8.332 0 1 1-16.581-1.671 8.332 8.332 0 0 1 16.58 1.671",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M37.19 135.59l10.553 5.983M48.665 147.884l-12.734 10.861",
  stroke: "#FFF",
  strokeWidth: "2"
}), /*#__PURE__*/react.createElement("path", {
  d: "M40.11 160.816a5.706 5.706 0 1 1-11.354-1.145 5.706 5.706 0 0 1 11.354 1.145M57.943 144.6a5.747 5.747 0 1 1-11.436-1.152 5.747 5.747 0 0 1 11.436 1.153M99.656 27.434l30.024-.013a4.619 4.619 0 1 0-.004-9.238l-30.024.013a4.62 4.62 0 0 0 .004 9.238M111.14 45.896l30.023-.013a4.62 4.62 0 1 0-.004-9.238l-30.024.013a4.619 4.619 0 1 0 .004 9.238",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M113.53 27.421v-.002l15.89-.007a4.619 4.619 0 1 0 .005 9.238l-15.892.007v-.002a4.618 4.618 0 0 0-.004-9.234M150.167 70.091h-3.979a4.789 4.789 0 0 1-4.774-4.775 4.788 4.788 0 0 1 4.774-4.774h3.979a4.789 4.789 0 0 1 4.775 4.774 4.789 4.789 0 0 1-4.775 4.775",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M171.687 30.234c0-16.392 13.289-29.68 29.681-29.68 16.392 0 29.68 13.288 29.68 29.68 0 16.393-13.288 29.681-29.68 29.681s-29.68-13.288-29.68-29.68",
  fill: "#FF603B"
}), /*#__PURE__*/react.createElement("path", {
  d: "M203.557 19.435l-.676 15.035a1.514 1.514 0 0 1-3.026 0l-.675-15.035a2.19 2.19 0 1 1 4.377 0m-.264 19.378c.513.477.77 1.1.77 1.87s-.257 1.393-.77 1.907c-.55.476-1.21.733-1.943.733a2.545 2.545 0 0 1-1.87-.77c-.55-.514-.806-1.136-.806-1.87 0-.77.256-1.393.806-1.87.513-.513 1.137-.733 1.87-.733.77 0 1.43.22 1.943.733",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M119.3 133.275c4.426-.598 3.612-1.204 4.079-4.778.675-5.18-3.108-16.935-8.262-25.118-1.088-10.72-12.598-11.24-12.598-11.24s4.312 4.895 4.196 16.199c1.398 5.243.804 14.45.804 14.45s5.255 11.369 11.78 10.487",
  fill: "#FFB594"
}), /*#__PURE__*/react.createElement("path", {
  d: "M100.944 91.61s1.463-.583 3.211.582c8.08 1.398 10.368 6.706 11.3 11.368 1.864 1.282 1.864 2.33 1.864 3.496.365.777 1.515 3.03 1.515 3.03s-7.225 1.748-10.954 6.758c-1.399-6.41-6.936-25.235-6.936-25.235",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M94.008 90.5l1.019-5.815-9.23-11.874-5.233 5.581-2.593 9.863s8.39 5.128 16.037 2.246",
  fill: "#FFB594"
}), /*#__PURE__*/react.createElement("path", {
  d: "M82.931 78.216s-4.557-2.868-2.445-6.892c1.632-3.107 4.537 1.139 4.537 1.139s.524-3.662 3.139-3.662c.523-1.046 1.569-4.184 1.569-4.184s11.507 2.615 13.6 3.138c-.001 5.23-2.317 19.529-7.884 19.969-8.94.706-12.516-9.508-12.516-9.508",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M102.971 72.243c2.616-2.093 3.489-9.775 3.489-9.775s-2.492-.492-6.676-2.062c-4.708-2.092-12.867-4.771-17.575.982-9.54 4.41-2.062 19.93-2.062 19.93l2.729-3.037s-3.956-3.304-2.092-6.277c2.183-3.48 3.943 1.08 3.943 1.08s.64-2.4 3.6-3.36c.356-.714 1.04-2.69 1.44-3.872a1.08 1.08 0 0 1 1.27-.707c2.41.56 8.723 2.03 11.417 2.676.524.126.876.619.825 1.156l-.308 3.266z",
  fill: "#520038"
}), /*#__PURE__*/react.createElement("path", {
  d: "M101.22 76.514c-.104.613-.585 1.044-1.076.96-.49-.082-.805-.646-.702-1.26.104-.613.585-1.044 1.076-.961.491.083.805.647.702 1.26M94.26 75.074c-.104.613-.585 1.044-1.076.96-.49-.082-.805-.646-.702-1.26.104-.613.585-1.044 1.076-.96.491.082.805.646.702 1.26",
  fill: "#552950"
}), /*#__PURE__*/react.createElement("path", {
  stroke: "#DB836E",
  strokeWidth: "1.063",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  d: "M99.206 73.644l-.9 1.62-.3 4.38h-2.24"
}), /*#__PURE__*/react.createElement("path", {
  d: "M99.926 73.284s1.8-.72 2.52.54",
  stroke: "#5C2552",
  strokeWidth: "1.117",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M81.367 73.084s.48-1.12 1.12-.72c.64.4 1.28 1.44.56 2s.16 1.68.16 1.68",
  stroke: "#DB836E",
  strokeWidth: "1.117",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M92.326 71.724s1.84 1.12 4.16.96",
  stroke: "#5C2552",
  strokeWidth: "1.117",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M92.726 80.604s2.24 1.2 4.4 1.2M93.686 83.164s.96.4 1.52.32M83.687 80.044s1.786 6.547 9.262 7.954",
  stroke: "#DB836E",
  strokeWidth: "1.063",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M95.548 91.663s-1.068 2.821-8.298 2.105c-7.23-.717-10.29-5.044-10.29-5.044",
  stroke: "#E4EBF7",
  strokeWidth: "1.136",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M78.126 87.478s6.526 4.972 16.47 2.486c0 0 9.577 1.02 11.536 5.322 5.36 11.77.543 36.835 0 39.962 3.496 4.055-.466 8.483-.466 8.483-15.624-3.548-35.81-.6-35.81-.6-4.849-3.546-1.223-9.044-1.223-9.044L62.38 110.32c-2.485-15.227.833-19.803 3.549-20.743 3.03-1.049 8.04-1.282 8.04-1.282.496-.058 1.08-.076 1.37-.233 2.36-1.282 2.787-.583 2.787-.583",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M65.828 89.81s-6.875.465-7.59 8.156c-.466 8.857 3.03 10.954 3.03 10.954s6.075 22.102 16.796 22.957c8.39-2.176 4.758-6.702 4.661-11.42-.233-11.304-7.108-16.897-7.108-16.897s-4.212-13.75-9.789-13.75",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M71.716 124.225s.855 11.264 9.828 6.486c4.765-2.536 7.581-13.828 9.789-22.568 1.456-5.768 2.58-12.197 2.58-12.197l-4.973-1.709s-2.408 5.516-7.769 12.275c-4.335 5.467-9.144 11.11-9.455 17.713",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M108.463 105.191s1.747 2.724-2.331 30.535c2.376 2.216 1.053 6.012-.233 7.51",
  stroke: "#E4EBF7",
  strokeWidth: "1.085",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M123.262 131.527s-.427 2.732-11.77 1.981c-15.187-1.006-25.326-3.25-25.326-3.25l.933-5.8s.723.215 9.71-.068c11.887-.373 18.714-6.07 24.964-1.022 4.039 3.263 1.489 8.16 1.489 8.16",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M70.24 90.974s-5.593-4.739-11.054 2.68c-3.318 7.223.517 15.284 2.664 19.578-.31 3.729 2.33 4.311 2.33 4.311s.108.895 1.516 2.68c4.078-7.03 6.72-9.166 13.711-12.546-.328-.656-1.877-3.265-1.825-3.767.175-1.69-1.282-2.623-1.282-2.623s-.286-.156-1.165-2.738c-.788-2.313-2.036-5.177-4.895-7.575",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M90.232 288.027s4.855 2.308 8.313 1.155c3.188-1.063 5.12.755 8.002 1.331 2.881.577 7.769 1.243 13.207-1.424-.117-6.228-7.786-4.499-13.518-7.588-2.895-1.56-4.276-5.336-4.066-9.944H91.544s-1.573 11.89-1.312 16.47",
  fill: "#CBD1D1"
}), /*#__PURE__*/react.createElement("path", {
  d: "M90.207 287.833s2.745 1.437 7.639.738c3.456-.494 3.223.66 7.418 1.282 4.195.621 13.092-.194 14.334-1.126.466 1.242-.388 2.33-.388 2.33s-1.709.682-5.438.932c-2.295.154-8.098.276-10.14-.621-2.02-1.554-4.894-1.515-6.06-.234-4.427 1.075-7.184-.31-7.184-.31l-.181-2.991z",
  fill: "#2B0849"
}), /*#__PURE__*/react.createElement("path", {
  d: "M98.429 272.257h3.496s-.117 7.574 5.127 9.671c-5.244.7-9.672-2.602-8.623-9.671",
  fill: "#A4AABA"
}), /*#__PURE__*/react.createElement("path", {
  d: "M44.425 272.046s-2.208 7.774-4.702 12.899c-1.884 3.874-4.428 7.854 5.729 7.854 6.97 0 9.385-.503 7.782-6.917-1.604-6.415.279-13.836.279-13.836h-9.088z",
  fill: "#CBD1D1"
}), /*#__PURE__*/react.createElement("path", {
  d: "M38.066 290.277s2.198 1.225 6.954 1.225c6.376 0 8.646-1.73 8.646-1.73s.63 1.168-.649 2.27c-1.04.897-3.77 1.668-7.745 1.621-4.347-.05-6.115-.593-7.062-1.224-.864-.577-.72-1.657-.144-2.162",
  fill: "#2B0849"
}), /*#__PURE__*/react.createElement("path", {
  d: "M45.344 274.041s.035 1.592-.329 3.07c-.365 1.49-1.13 3.255-1.184 4.34-.061 1.206 4.755 1.657 5.403.036.65-1.622 1.357-6.737 2.006-7.602.648-.865-5.14-2.222-5.896.156",
  fill: "#A4AABA"
}), /*#__PURE__*/react.createElement("path", {
  d: "M89.476 277.57l13.899.095s1.349-56.643 1.925-66.909c.576-10.267 3.923-45.052 1.042-65.585l-13.037-.669-23.737.81s-.452 4.12-1.243 10.365c-.065.515-.708.874-.777 1.417-.078.608.439 1.407.332 2.044-2.455 14.627-5.797 32.736-8.256 46.837-.121.693-1.282 1.048-1.515 2.796-.042.314.22 1.584.116 1.865-7.14 19.473-12.202 52.601-15.66 67.19l15.176-.015s2.282-10.145 4.185-18.871c2.922-13.389 24.012-88.32 24.012-88.32l3.133-.954-.158 48.568s-.233 1.282.35 2.098c.583.815-.581 1.167-.408 2.331l.408 1.864s-.466 7.458-.932 12.352c-.467 4.895 1.145 40.69 1.145 40.69",
  fill: "#7BB2F9"
}), /*#__PURE__*/react.createElement("path", {
  d: "M64.57 218.881c1.197.099 4.195-2.097 7.225-5.127M96.024 222.534s2.881-1.152 6.34-4.034",
  stroke: "#648BD8",
  strokeWidth: "1.085",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M96.973 219.373s2.882-1.153 6.34-4.034",
  stroke: "#648BD8",
  strokeWidth: "1.032",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M63.172 222.144s2.724-.614 6.759-3.496M74.903 146.166c-.281 3.226.31 8.856-4.506 9.478M93.182 144.344s.115 14.557-1.344 15.65c-2.305 1.73-3.107 2.02-3.107 2.02M89.197 144.923s.269 13.144-1.01 25.088M83.525 170.71s6.81-1.051 9.116-1.051M46.026 270.045l-.892 4.538M46.937 263.289l-.815 4.157M62.725 202.503c-.33 1.618-.102 1.904-.449 3.438 0 0-2.756 1.903-2.29 3.923.466 2.02-.31 3.424-4.505 17.252-1.762 5.807-4.233 18.922-6.165 28.278-.03.144-.521 2.646-1.14 5.8M64.158 194.136c-.295 1.658-.6 3.31-.917 4.938M71.33 146.787l-1.244 10.877s-1.14.155-.519 2.33c.117 1.399-2.778 16.39-5.382 31.615M44.242 273.727H58.07",
  stroke: "#648BD8",
  strokeWidth: "1.085",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M106.18 142.117c-3.028-.489-18.825-2.744-36.219.2a.625.625 0 0 0-.518.644c.063 1.307.044 2.343.015 2.995a.617.617 0 0 0 .716.636c3.303-.534 17.037-2.412 35.664-.266.347.04.66-.214.692-.56.124-1.347.16-2.425.17-3.029a.616.616 0 0 0-.52-.62",
  fill: "#192064"
}), /*#__PURE__*/react.createElement("path", {
  d: "M96.398 145.264l.003-5.102a.843.843 0 0 0-.809-.847 114.104 114.104 0 0 0-8.141-.014.85.85 0 0 0-.82.847l-.003 5.097c0 .476.388.857.864.845 2.478-.064 5.166-.067 8.03.017a.848.848 0 0 0 .876-.843",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M95.239 144.296l.002-3.195a.667.667 0 0 0-.643-.672c-1.9-.061-3.941-.073-6.094-.01a.675.675 0 0 0-.654.672l-.002 3.192c0 .376.305.677.68.669 1.859-.042 3.874-.043 6.02.012.376.01.69-.291.691-.668",
  fill: "#192064"
}), /*#__PURE__*/react.createElement("path", {
  d: "M90.102 273.522h12.819M91.216 269.761c.006 3.519-.072 5.55 0 6.292M90.923 263.474c-.009 1.599-.016 2.558-.016 4.505M90.44 170.404l.932 46.38s.7 1.631-.233 2.796c-.932 1.166 2.564.7.932 2.33-1.63 1.633.933 1.166 0 3.497-.618 1.546-1.031 21.921-1.138 36.513",
  stroke: "#648BD8",
  strokeWidth: "1.085",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M73.736 98.665l2.214 4.312s2.098.816 1.865 2.68l.816 2.214M64.297 116.611c.233-.932 2.176-7.147 12.585-10.488M77.598 90.042s7.691 6.137 16.547 2.72",
  stroke: "#E4EBF7",
  strokeWidth: "1.085",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M91.974 86.954s5.476-.816 7.574-4.545c1.297-.345.72 2.212-.33 3.671-.7.971-1.01 1.554-1.01 1.554s.194.31.155.816c-.053.697-.175.653-.272 1.048-.081.335.108.657 0 1.049-.046.17-.198.5-.382.878-.12.249-.072.687-.2.948-.231.469-1.562 1.87-2.622 2.855-3.826 3.554-5.018 1.644-6.001-.408-.894-1.865-.661-5.127-.874-6.875-.35-2.914-2.622-3.03-1.923-4.429.343-.685 2.87.69 3.263 1.748.757 2.04 2.952 1.807 2.622 1.69",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M99.8 82.429c-.465.077-.35.272-.97 1.243-.622.971-4.817 2.932-6.39 3.224-2.589.48-2.278-1.56-4.254-2.855-1.69-1.107-3.562-.638-1.398 1.398.99.932.932 1.107 1.398 3.205.335 1.506-.64 3.67.7 5.593",
  stroke: "#DB836E",
  strokeWidth: ".774",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M79.543 108.673c-2.1 2.926-4.266 6.175-5.557 8.762",
  stroke: "#E59788",
  strokeWidth: ".774",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M87.72 124.768s-2.098-1.942-5.127-2.719c-3.03-.777-3.574-.155-5.516.078-1.942.233-3.885-.932-3.652.7.233 1.63 5.05 1.01 5.206 2.097.155 1.087-6.37 2.796-8.313 2.175-.777.777.466 1.864 2.02 2.175.233 1.554 2.253 1.554 2.253 1.554s.699 1.01 2.641 1.088c2.486 1.32 8.934-.7 10.954-1.554 2.02-.855-.466-5.594-.466-5.594",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M73.425 122.826s.66 1.127 3.167 1.418c2.315.27 2.563.583 2.563.583s-2.545 2.894-9.07 2.272M72.416 129.274s3.826.097 4.933-.718M74.98 130.75s1.961.136 3.36-.505M77.232 131.916s1.748.019 2.914-.505M73.328 122.321s-.595-1.032 1.262-.427c1.671.544 2.833.055 5.128.155 1.389.061 3.067-.297 3.982.15 1.606.784 3.632 2.181 3.632 2.181s10.526 1.204 19.033-1.127M78.864 108.104s-8.39 2.758-13.168 12.12",
  stroke: "#E59788",
  strokeWidth: ".774",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M109.278 112.533s3.38-3.613 7.575-4.662",
  stroke: "#E4EBF7",
  strokeWidth: "1.085",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M107.375 123.006s9.697-2.745 11.445-.88",
  stroke: "#E59788",
  strokeWidth: ".774",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M194.605 83.656l3.971-3.886M187.166 90.933l3.736-3.655M191.752 84.207l-4.462-4.56M198.453 91.057l-4.133-4.225M129.256 163.074l3.718-3.718M122.291 170.039l3.498-3.498M126.561 163.626l-4.27-4.27M132.975 170.039l-3.955-3.955",
  stroke: "#BFCDDD",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M190.156 211.779h-1.604a4.023 4.023 0 0 1-4.011-4.011V175.68a4.023 4.023 0 0 1 4.01-4.01h1.605a4.023 4.023 0 0 1 4.011 4.01v32.088a4.023 4.023 0 0 1-4.01 4.01",
  fill: "#A3B4C6"
}), /*#__PURE__*/react.createElement("path", {
  d: "M237.824 212.977a4.813 4.813 0 0 1-4.813 4.813h-86.636a4.813 4.813 0 0 1 0-9.626h86.636a4.813 4.813 0 0 1 4.813 4.813",
  fill: "#A3B4C6"
}), /*#__PURE__*/react.createElement("mask", {
  fill: "#fff"
}), /*#__PURE__*/react.createElement("path", {
  fill: "#A3B4C6",
  mask: "url(#d)",
  d: "M154.098 190.096h70.513v-84.617h-70.513z"
}), /*#__PURE__*/react.createElement("path", {
  d: "M224.928 190.096H153.78a3.219 3.219 0 0 1-3.208-3.209V167.92a3.219 3.219 0 0 1 3.208-3.21h71.148a3.219 3.219 0 0 1 3.209 3.21v18.967a3.219 3.219 0 0 1-3.21 3.209M224.928 130.832H153.78a3.218 3.218 0 0 1-3.208-3.208v-18.968a3.219 3.219 0 0 1 3.208-3.209h71.148a3.219 3.219 0 0 1 3.209 3.21v18.967a3.218 3.218 0 0 1-3.21 3.208",
  fill: "#BFCDDD",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M159.563 120.546a2.407 2.407 0 1 1 0-4.813 2.407 2.407 0 0 1 0 4.813M166.98 120.546a2.407 2.407 0 1 1 0-4.813 2.407 2.407 0 0 1 0 4.813M174.397 120.546a2.407 2.407 0 1 1 0-4.813 2.407 2.407 0 0 1 0 4.813M222.539 120.546h-22.461a.802.802 0 0 1-.802-.802v-3.208c0-.443.359-.803.802-.803h22.46c.444 0 .803.36.803.803v3.208c0 .443-.36.802-.802.802",
  fill: "#FFF",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M224.928 160.464H153.78a3.218 3.218 0 0 1-3.208-3.209v-18.967a3.219 3.219 0 0 1 3.208-3.209h71.148a3.219 3.219 0 0 1 3.209 3.209v18.967a3.218 3.218 0 0 1-3.21 3.209",
  fill: "#BFCDDD",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M173.455 130.832h49.301M164.984 130.832h6.089M155.952 130.832h6.75M173.837 160.613h49.3M165.365 160.613h6.089M155.57 160.613h6.751",
  stroke: "#7C90A5",
  strokeWidth: "1.124",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M159.563 151.038a2.407 2.407 0 1 1 0-4.814 2.407 2.407 0 0 1 0 4.814M166.98 151.038a2.407 2.407 0 1 1 0-4.814 2.407 2.407 0 0 1 0 4.814M174.397 151.038a2.407 2.407 0 1 1 .001-4.814 2.407 2.407 0 0 1 0 4.814M222.539 151.038h-22.461a.802.802 0 0 1-.802-.802v-3.209c0-.443.359-.802.802-.802h22.46c.444 0 .803.36.803.802v3.209c0 .443-.36.802-.802.802M159.563 179.987a2.407 2.407 0 1 1 0-4.813 2.407 2.407 0 0 1 0 4.813M166.98 179.987a2.407 2.407 0 1 1 0-4.813 2.407 2.407 0 0 1 0 4.813M174.397 179.987a2.407 2.407 0 1 1 0-4.813 2.407 2.407 0 0 1 0 4.813M222.539 179.987h-22.461a.802.802 0 0 1-.802-.802v-3.209c0-.443.359-.802.802-.802h22.46c.444 0 .803.36.803.802v3.209c0 .443-.36.802-.802.802",
  fill: "#FFF",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M203.04 221.108h-27.372a2.413 2.413 0 0 1-2.406-2.407v-11.448a2.414 2.414 0 0 1 2.406-2.407h27.372a2.414 2.414 0 0 1 2.407 2.407V218.7a2.413 2.413 0 0 1-2.407 2.407",
  fill: "#BFCDDD",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M177.259 207.217v11.52M201.05 207.217v11.52",
  stroke: "#A3B4C6",
  strokeWidth: "1.124",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M162.873 267.894a9.422 9.422 0 0 1-9.422-9.422v-14.82a9.423 9.423 0 0 1 18.845 0v14.82a9.423 9.423 0 0 1-9.423 9.422",
  fill: "#5BA02E",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M171.22 267.83a9.422 9.422 0 0 1-9.422-9.423v-3.438a9.423 9.423 0 0 1 18.845 0v3.438a9.423 9.423 0 0 1-9.422 9.423",
  fill: "#92C110",
  mask: "url(#d)"
}), /*#__PURE__*/react.createElement("path", {
  d: "M181.31 293.666h-27.712a3.209 3.209 0 0 1-3.209-3.21V269.79a3.209 3.209 0 0 1 3.209-3.21h27.711a3.209 3.209 0 0 1 3.209 3.21v20.668a3.209 3.209 0 0 1-3.209 3.209",
  fill: "#F2D7AD",
  mask: "url(#d)"
}))));
/* harmony default export */ var serverError = (ServerError);
;// ./node_modules/antd/es/result/style/index.js


// ============================== Styles ==============================
const genBaseStyle = token => {
  const {
    componentCls,
    lineHeightHeading3,
    iconCls,
    padding,
    paddingXL,
    paddingXS,
    paddingLG,
    marginXS,
    lineHeight
  } = token;
  return {
    // Result
    [componentCls]: {
      padding: `${(0,cssinjs_es/* unit */.zA)(token.calc(paddingLG).mul(2).equal())} ${(0,cssinjs_es/* unit */.zA)(paddingXL)}`,
      // RTL
      '&-rtl': {
        direction: 'rtl'
      }
    },
    // Exception Status image
    [`${componentCls} ${componentCls}-image`]: {
      width: token.imageWidth,
      height: token.imageHeight,
      margin: 'auto'
    },
    [`${componentCls} ${componentCls}-icon`]: {
      marginBottom: paddingLG,
      textAlign: 'center',
      [`& > ${iconCls}`]: {
        fontSize: token.iconFontSize
      }
    },
    [`${componentCls} ${componentCls}-title`]: {
      color: token.colorTextHeading,
      fontSize: token.titleFontSize,
      lineHeight: lineHeightHeading3,
      marginBlock: marginXS,
      textAlign: 'center'
    },
    [`${componentCls} ${componentCls}-subtitle`]: {
      color: token.colorTextDescription,
      fontSize: token.subtitleFontSize,
      lineHeight,
      textAlign: 'center'
    },
    [`${componentCls} ${componentCls}-content`]: {
      marginTop: paddingLG,
      padding: `${(0,cssinjs_es/* unit */.zA)(paddingLG)} ${(0,cssinjs_es/* unit */.zA)(token.calc(padding).mul(2.5).equal())}`,
      backgroundColor: token.colorFillAlter
    },
    [`${componentCls} ${componentCls}-extra`]: {
      margin: token.extraMargin,
      textAlign: 'center',
      '& > *': {
        marginInlineEnd: paddingXS,
        '&:last-child': {
          marginInlineEnd: 0
        }
      }
    }
  };
};
const genStatusIconStyle = token => {
  const {
    componentCls,
    iconCls
  } = token;
  return {
    [`${componentCls}-success ${componentCls}-icon > ${iconCls}`]: {
      color: token.resultSuccessIconColor
    },
    [`${componentCls}-error ${componentCls}-icon > ${iconCls}`]: {
      color: token.resultErrorIconColor
    },
    [`${componentCls}-info ${componentCls}-icon > ${iconCls}`]: {
      color: token.resultInfoIconColor
    },
    [`${componentCls}-warning ${componentCls}-icon > ${iconCls}`]: {
      color: token.resultWarningIconColor
    }
  };
};
const genResultStyle = token => [genBaseStyle(token), genStatusIconStyle(token)];
const getStyle = token => genResultStyle(token);
// ============================== Export ==============================
const style_prepareComponentToken = token => ({
  titleFontSize: token.fontSizeHeading3,
  subtitleFontSize: token.fontSize,
  iconFontSize: token.fontSizeHeading3 * 3,
  extraMargin: `${token.paddingLG}px 0 0 0`
});
/* harmony default export */ var result_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Result', token => {
  const resultInfoIconColor = token.colorInfo;
  const resultErrorIconColor = token.colorError;
  const resultSuccessIconColor = token.colorSuccess;
  const resultWarningIconColor = token.colorWarning;
  const resultToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    resultInfoIconColor,
    resultErrorIconColor,
    resultSuccessIconColor,
    resultWarningIconColor,
    imageWidth: 250,
    imageHeight: 295
  });
  return [getStyle(resultToken)];
}, style_prepareComponentToken));
;// ./node_modules/antd/es/result/unauthorized.js
"use client";


const Unauthorized = () => (/*#__PURE__*/react.createElement("svg", {
  width: "251",
  height: "294"
}, /*#__PURE__*/react.createElement("title", null, "Unauthorized"), /*#__PURE__*/react.createElement("g", {
  fill: "none",
  fillRule: "evenodd"
}, /*#__PURE__*/react.createElement("path", {
  d: "M0 129.023v-2.084C0 58.364 55.591 2.774 124.165 2.774h2.085c68.574 0 124.165 55.59 124.165 124.165v2.084c0 68.575-55.59 124.166-124.165 124.166h-2.085C55.591 253.189 0 197.598 0 129.023",
  fill: "#E4EBF7"
}), /*#__PURE__*/react.createElement("path", {
  d: "M41.417 132.92a8.231 8.231 0 1 1-16.38-1.65 8.231 8.231 0 0 1 16.38 1.65",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M38.652 136.36l10.425 5.91M49.989 148.505l-12.58 10.73",
  stroke: "#FFF",
  strokeWidth: "2"
}), /*#__PURE__*/react.createElement("path", {
  d: "M41.536 161.28a5.636 5.636 0 1 1-11.216-1.13 5.636 5.636 0 0 1 11.216 1.13M59.154 145.261a5.677 5.677 0 1 1-11.297-1.138 5.677 5.677 0 0 1 11.297 1.138M100.36 29.516l29.66-.013a4.562 4.562 0 1 0-.004-9.126l-29.66.013a4.563 4.563 0 0 0 .005 9.126M111.705 47.754l29.659-.013a4.563 4.563 0 1 0-.004-9.126l-29.66.013a4.563 4.563 0 1 0 .005 9.126",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M114.066 29.503V29.5l15.698-.007a4.563 4.563 0 1 0 .004 9.126l-15.698.007v-.002a4.562 4.562 0 0 0-.004-9.122M185.405 137.723c-.55 5.455-5.418 9.432-10.873 8.882-5.456-.55-9.432-5.418-8.882-10.873.55-5.455 5.418-9.432 10.873-8.882 5.455.55 9.432 5.418 8.882 10.873",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M180.17 143.772l12.572 7.129M193.841 158.42L178.67 171.36",
  stroke: "#FFF",
  strokeWidth: "2"
}), /*#__PURE__*/react.createElement("path", {
  d: "M185.55 171.926a6.798 6.798 0 1 1-13.528-1.363 6.798 6.798 0 0 1 13.527 1.363M204.12 155.285a6.848 6.848 0 1 1-13.627-1.375 6.848 6.848 0 0 1 13.626 1.375",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M152.988 194.074a2.21 2.21 0 1 1-4.42 0 2.21 2.21 0 0 1 4.42 0zM225.931 118.217a2.21 2.21 0 1 1-4.421 0 2.21 2.21 0 0 1 4.421 0zM217.09 153.051a2.21 2.21 0 1 1-4.421 0 2.21 2.21 0 0 1 4.42 0zM177.84 109.842a2.21 2.21 0 1 1-4.422 0 2.21 2.21 0 0 1 4.421 0zM196.114 94.454a2.21 2.21 0 1 1-4.421 0 2.21 2.21 0 0 1 4.421 0zM202.844 182.523a2.21 2.21 0 1 1-4.42 0 2.21 2.21 0 0 1 4.42 0z",
  stroke: "#FFF",
  strokeWidth: "2"
}), /*#__PURE__*/react.createElement("path", {
  stroke: "#FFF",
  strokeWidth: "2",
  d: "M215.125 155.262l-1.902 20.075-10.87 5.958M174.601 176.636l-6.322 9.761H156.98l-4.484 6.449M175.874 127.28V111.56M221.51 119.404l-12.77 7.859-15.228-7.86V96.668"
}), /*#__PURE__*/react.createElement("path", {
  d: "M180.68 29.32C180.68 13.128 193.806 0 210 0c16.193 0 29.32 13.127 29.32 29.32 0 16.194-13.127 29.322-29.32 29.322-16.193 0-29.32-13.128-29.32-29.321",
  fill: "#A26EF4"
}), /*#__PURE__*/react.createElement("path", {
  d: "M221.45 41.706l-21.563-.125a1.744 1.744 0 0 1-1.734-1.754l.071-12.23a1.744 1.744 0 0 1 1.754-1.734l21.562.125c.964.006 1.74.791 1.735 1.755l-.071 12.229a1.744 1.744 0 0 1-1.754 1.734",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M215.106 29.192c-.015 2.577-2.049 4.654-4.543 4.64-2.494-.014-4.504-2.115-4.489-4.693l.04-6.925c.016-2.577 2.05-4.654 4.543-4.64 2.494.015 4.504 2.116 4.49 4.693l-.04 6.925zm-4.53-14.074a6.877 6.877 0 0 0-6.916 6.837l-.043 7.368a6.877 6.877 0 0 0 13.754.08l.042-7.368a6.878 6.878 0 0 0-6.837-6.917zM167.566 68.367h-3.93a4.73 4.73 0 0 1-4.717-4.717 4.73 4.73 0 0 1 4.717-4.717h3.93a4.73 4.73 0 0 1 4.717 4.717 4.73 4.73 0 0 1-4.717 4.717",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M168.214 248.838a6.611 6.611 0 0 1-6.61-6.611v-66.108a6.611 6.611 0 0 1 13.221 0v66.108a6.611 6.611 0 0 1-6.61 6.61",
  fill: "#5BA02E"
}), /*#__PURE__*/react.createElement("path", {
  d: "M176.147 248.176a6.611 6.611 0 0 1-6.61-6.61v-33.054a6.611 6.611 0 1 1 13.221 0v33.053a6.611 6.611 0 0 1-6.61 6.611",
  fill: "#92C110"
}), /*#__PURE__*/react.createElement("path", {
  d: "M185.994 293.89h-27.376a3.17 3.17 0 0 1-3.17-3.17v-45.887a3.17 3.17 0 0 1 3.17-3.17h27.376a3.17 3.17 0 0 1 3.17 3.17v45.886a3.17 3.17 0 0 1-3.17 3.17",
  fill: "#F2D7AD"
}), /*#__PURE__*/react.createElement("path", {
  d: "M81.972 147.673s6.377-.927 17.566-1.28c11.729-.371 17.57 1.086 17.57 1.086s3.697-3.855.968-8.424c1.278-12.077 5.982-32.827.335-48.273-1.116-1.339-3.743-1.512-7.536-.62-1.337.315-7.147-.149-7.983-.1l-15.311-.347s-3.487-.17-8.035-.508c-1.512-.113-4.227-1.683-5.458-.338-.406.443-2.425 5.669-1.97 16.077l8.635 35.642s-3.141 3.61 1.219 7.085",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M75.768 73.325l-.9-6.397 11.982-6.52s7.302-.118 8.038 1.205c.737 1.324-5.616.993-5.616.993s-1.836 1.388-2.615 2.5c-1.654 2.363-.986 6.471-8.318 5.986-1.708.284-2.57 2.233-2.57 2.233",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M52.44 77.672s14.217 9.406 24.973 14.444c1.061.497-2.094 16.183-11.892 11.811-7.436-3.318-20.162-8.44-21.482-14.496-.71-3.258 2.543-7.643 8.401-11.76M141.862 80.113s-6.693 2.999-13.844 6.876c-3.894 2.11-10.137 4.704-12.33 7.988-6.224 9.314 3.536 11.22 12.947 7.503 6.71-2.651 28.999-12.127 13.227-22.367",
  fill: "#FFB594"
}), /*#__PURE__*/react.createElement("path", {
  d: "M76.166 66.36l3.06 3.881s-2.783 2.67-6.31 5.747c-7.103 6.195-12.803 14.296-15.995 16.44-3.966 2.662-9.754 3.314-12.177-.118-3.553-5.032.464-14.628 31.422-25.95",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M64.674 85.116s-2.34 8.413-8.912 14.447c.652.548 18.586 10.51 22.144 10.056 5.238-.669 6.417-18.968 1.145-20.531-.702-.208-5.901-1.286-8.853-2.167-.87-.26-1.611-1.71-3.545-.936l-1.98-.869zM128.362 85.826s5.318 1.956 7.325 13.734c-.546.274-17.55 12.35-21.829 7.805-6.534-6.94-.766-17.393 4.275-18.61 4.646-1.121 5.03-1.37 10.23-2.929",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M78.18 94.656s.911 7.41-4.914 13.078",
  stroke: "#E4EBF7",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M87.397 94.68s3.124 2.572 10.263 2.572c7.14 0 9.074-3.437 9.074-3.437",
  stroke: "#E4EBF7",
  strokeWidth: ".932",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M117.184 68.639l-6.781-6.177s-5.355-4.314-9.223-.893c-3.867 3.422 4.463 2.083 5.653 4.165 1.19 2.082.848 1.143-2.083.446-5.603-1.331-2.082.893 2.975 5.355 2.091 1.845 6.992.955 6.992.955l2.467-3.851z",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M105.282 91.315l-.297-10.937-15.918-.027-.53 10.45c-.026.403.17.788.515.999 2.049 1.251 9.387 5.093 15.799.424.287-.21.443-.554.431-.91",
  fill: "#FFB594"
}), /*#__PURE__*/react.createElement("path", {
  d: "M107.573 74.24c.817-1.147.982-9.118 1.015-11.928a1.046 1.046 0 0 0-.965-1.055l-4.62-.365c-7.71-1.044-17.071.624-18.253 6.346-5.482 5.813-.421 13.244-.421 13.244s1.963 3.566 4.305 6.791c.756 1.041.398-3.731 3.04-5.929 5.524-4.594 15.899-7.103 15.899-7.103",
  fill: "#5C2552"
}), /*#__PURE__*/react.createElement("path", {
  d: "M88.426 83.206s2.685 6.202 11.602 6.522c7.82.28 8.973-7.008 7.434-17.505l-.909-5.483c-6.118-2.897-15.478.54-15.478.54s-.576 2.044-.19 5.504c-2.276 2.066-1.824 5.618-1.824 5.618s-.905-1.922-1.98-2.321c-.86-.32-1.897.089-2.322 1.98-1.04 4.632 3.667 5.145 3.667 5.145",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  stroke: "#DB836E",
  strokeWidth: "1.145",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  d: "M100.843 77.099l1.701-.928-1.015-4.324.674-1.406"
}), /*#__PURE__*/react.createElement("path", {
  d: "M105.546 74.092c-.022.713-.452 1.279-.96 1.263-.51-.016-.904-.607-.882-1.32.021-.713.452-1.278.96-1.263.51.016.904.607.882 1.32M97.592 74.349c-.022.713-.452 1.278-.961 1.263-.509-.016-.904-.607-.882-1.32.022-.713.452-1.279.961-1.263.51.016.904.606.882 1.32",
  fill: "#552950"
}), /*#__PURE__*/react.createElement("path", {
  d: "M91.132 86.786s5.269 4.957 12.679 2.327",
  stroke: "#DB836E",
  strokeWidth: "1.145",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M99.776 81.903s-3.592.232-1.44-2.79c1.59-1.496 4.897-.46 4.897-.46s1.156 3.906-3.457 3.25",
  fill: "#DB836E"
}), /*#__PURE__*/react.createElement("path", {
  d: "M102.88 70.6s2.483.84 3.402.715M93.883 71.975s2.492-1.144 4.778-1.073",
  stroke: "#5C2552",
  strokeWidth: "1.526",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M86.32 77.374s.961.879 1.458 2.106c-.377.48-1.033 1.152-.236 1.809M99.337 83.719s1.911.151 2.509-.254",
  stroke: "#DB836E",
  strokeWidth: "1.145",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M87.782 115.821l15.73-3.012M100.165 115.821l10.04-2.008",
  stroke: "#E4EBF7",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M66.508 86.763s-1.598 8.83-6.697 14.078",
  stroke: "#E4EBF7",
  strokeWidth: "1.114",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M128.31 87.934s3.013 4.121 4.06 11.785",
  stroke: "#E4EBF7",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M64.09 84.816s-6.03 9.912-13.607 9.903",
  stroke: "#DB836E",
  strokeWidth: ".795",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M112.366 65.909l-.142 5.32s5.993 4.472 11.945 9.202c4.482 3.562 8.888 7.455 10.985 8.662 4.804 2.766 8.9 3.355 11.076 1.808 4.071-2.894 4.373-9.878-8.136-15.263-4.271-1.838-16.144-6.36-25.728-9.73",
  fill: "#FFC6A0"
}), /*#__PURE__*/react.createElement("path", {
  d: "M130.532 85.488s4.588 5.757 11.619 6.214",
  stroke: "#DB836E",
  strokeWidth: ".75",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M121.708 105.73s-.393 8.564-1.34 13.612",
  stroke: "#E4EBF7",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M115.784 161.512s-3.57-1.488-2.678-7.14",
  stroke: "#648BD8",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M101.52 290.246s4.326 2.057 7.408 1.03c2.842-.948 4.564.673 7.132 1.186 2.57.514 6.925 1.108 11.772-1.269-.104-5.551-6.939-4.01-12.048-6.763-2.582-1.39-3.812-4.757-3.625-8.863h-9.471s-1.402 10.596-1.169 14.68",
  fill: "#CBD1D1"
}), /*#__PURE__*/react.createElement("path", {
  d: "M101.496 290.073s2.447 1.281 6.809.658c3.081-.44 3.74.485 7.479 1.039 3.739.554 10.802-.07 11.91-.9.415 1.108-.347 2.077-.347 2.077s-1.523.608-4.847.831c-2.045.137-5.843.293-7.663-.507-1.8-1.385-5.286-1.917-5.77-.243-3.947.958-7.41-.288-7.41-.288l-.16-2.667z",
  fill: "#2B0849"
}), /*#__PURE__*/react.createElement("path", {
  d: "M108.824 276.19h3.116s-.103 6.751 4.57 8.62c-4.673.624-8.62-2.32-7.686-8.62",
  fill: "#A4AABA"
}), /*#__PURE__*/react.createElement("path", {
  d: "M57.65 272.52s-2.122 7.47-4.518 12.396c-1.811 3.724-4.255 7.548 5.505 7.548 6.698 0 9.02-.483 7.479-6.648-1.541-6.164.268-13.296.268-13.296H57.65z",
  fill: "#CBD1D1"
}), /*#__PURE__*/react.createElement("path", {
  d: "M51.54 290.04s2.111 1.178 6.682 1.178c6.128 0 8.31-1.662 8.31-1.662s.605 1.122-.624 2.18c-1 .862-3.624 1.603-7.444 1.559-4.177-.049-5.876-.57-6.786-1.177-.831-.554-.692-1.593-.138-2.078",
  fill: "#2B0849"
}), /*#__PURE__*/react.createElement("path", {
  d: "M58.533 274.438s.034 1.529-.315 2.95c-.352 1.431-1.087 3.127-1.139 4.17-.058 1.16 4.57 1.592 5.194.035.623-1.559 1.303-6.475 1.927-7.306.622-.831-4.94-2.135-5.667.15",
  fill: "#A4AABA"
}), /*#__PURE__*/react.createElement("path", {
  d: "M100.885 277.015l13.306.092s1.291-54.228 1.843-64.056c.552-9.828 3.756-43.13.997-62.788l-12.48-.64-22.725.776s-.433 3.944-1.19 9.921c-.062.493-.677.838-.744 1.358-.075.582.42 1.347.318 1.956-2.35 14.003-6.343 32.926-8.697 46.425-.116.663-1.227 1.004-1.45 2.677-.04.3.21 1.516.112 1.785-6.836 18.643-10.89 47.584-14.2 61.551l14.528-.014s2.185-8.524 4.008-16.878c2.796-12.817 22.987-84.553 22.987-84.553l3-.517 1.037 46.1s-.223 1.228.334 2.008c.558.782-.556 1.117-.39 2.233l.39 1.784s-.446 7.14-.892 11.826c-.446 4.685-.092 38.954-.092 38.954",
  fill: "#7BB2F9"
}), /*#__PURE__*/react.createElement("path", {
  d: "M77.438 220.434c1.146.094 4.016-2.008 6.916-4.91M107.55 223.931s2.758-1.103 6.069-3.862",
  stroke: "#648BD8",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M108.459 220.905s2.759-1.104 6.07-3.863",
  stroke: "#648BD8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M76.099 223.557s2.608-.587 6.47-3.346M87.33 150.82c-.27 3.088.297 8.478-4.315 9.073M104.829 149.075s.11 13.936-1.286 14.983c-2.207 1.655-2.975 1.934-2.975 1.934M101.014 149.63s.035 12.81-1.19 24.245M94.93 174.965s7.174-1.655 9.38-1.655M75.671 204.754c-.316 1.55-.64 3.067-.973 4.535 0 0-1.45 1.822-1.003 3.756.446 1.934-.943 2.034-4.96 15.273-1.686 5.559-4.464 18.49-6.313 27.447-.078.38-4.018 18.06-4.093 18.423M77.043 196.743a313.269 313.269 0 0 1-.877 4.729M83.908 151.414l-1.19 10.413s-1.091.148-.496 2.23c.111 1.34-2.66 15.692-5.153 30.267M57.58 272.94h13.238",
  stroke: "#648BD8",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}), /*#__PURE__*/react.createElement("path", {
  d: "M117.377 147.423s-16.955-3.087-35.7.199c.157 2.501-.002 4.128-.002 4.128s14.607-2.802 35.476-.31c.251-2.342.226-4.017.226-4.017",
  fill: "#192064"
}), /*#__PURE__*/react.createElement("path", {
  d: "M107.511 150.353l.004-4.885a.807.807 0 0 0-.774-.81c-2.428-.092-5.04-.108-7.795-.014a.814.814 0 0 0-.784.81l-.003 4.88c0 .456.371.82.827.808a140.76 140.76 0 0 1 7.688.017.81.81 0 0 0 .837-.806",
  fill: "#FFF"
}), /*#__PURE__*/react.createElement("path", {
  d: "M106.402 149.426l.002-3.06a.64.64 0 0 0-.616-.643 94.135 94.135 0 0 0-5.834-.009.647.647 0 0 0-.626.643l-.001 3.056c0 .36.291.648.651.64 1.78-.04 3.708-.041 5.762.012.36.009.662-.279.662-.64",
  fill: "#192064"
}), /*#__PURE__*/react.createElement("path", {
  d: "M101.485 273.933h12.272M102.652 269.075c.006 3.368.04 5.759.11 6.47M102.667 263.125c-.009 1.53-.015 2.98-.016 4.313M102.204 174.024l.893 44.402s.669 1.561-.224 2.677c-.892 1.116 2.455.67.893 2.231-1.562 1.562.893 1.116 0 3.347-.592 1.48-.988 20.987-1.09 34.956",
  stroke: "#648BD8",
  strokeWidth: "1.051",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}))));
/* harmony default export */ var unauthorized = (Unauthorized);
;// ./node_modules/antd/es/result/index.js
"use client";













const IconMap = {
  success: CheckCircleFilled/* default */.A,
  error: CloseCircleFilled/* default */.A,
  info: ExclamationCircleFilled/* default */.A,
  warning: icons_WarningFilled
};
const ExceptionMap = {
  '404': noFound,
  '500': serverError,
  '403': unauthorized
};
// ExceptionImageMap keys
const ExceptionStatus = Object.keys(ExceptionMap);
const Icon = _ref => {
  let {
    prefixCls,
    icon,
    status
  } = _ref;
  const className = classnames_default()(`${prefixCls}-icon`);
  if (false) {}
  if (ExceptionStatus.includes(`${status}`)) {
    const SVGComponent = ExceptionMap[status];
    return /*#__PURE__*/react.createElement("div", {
      className: `${className} ${prefixCls}-image`
    }, /*#__PURE__*/react.createElement(SVGComponent, null));
  }
  const iconNode = /*#__PURE__*/react.createElement(IconMap[status]);
  if (icon === null || icon === false) {
    return null;
  }
  return /*#__PURE__*/react.createElement("div", {
    className: className
  }, icon || iconNode);
};
const Extra = _ref2 => {
  let {
    prefixCls,
    extra
  } = _ref2;
  if (!extra) {
    return null;
  }
  return /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-extra`
  }, extra);
};
const Result = _ref3 => {
  let {
    prefixCls: customizePrefixCls,
    className: customizeClassName,
    rootClassName,
    subTitle,
    title,
    style,
    children,
    status = 'info',
    icon,
    extra
  } = _ref3;
  const {
    getPrefixCls,
    direction,
    result
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('result', customizePrefixCls);
  // Style
  const [wrapCSSVar, hashId, cssVarCls] = result_style(prefixCls);
  const className = classnames_default()(prefixCls, `${prefixCls}-${status}`, customizeClassName, result === null || result === void 0 ? void 0 : result.className, rootClassName, {
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, hashId, cssVarCls);
  const mergedStyle = Object.assign(Object.assign({}, result === null || result === void 0 ? void 0 : result.style), style);
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", {
    className: className,
    style: mergedStyle
  }, /*#__PURE__*/react.createElement(Icon, {
    prefixCls: prefixCls,
    status: status,
    icon: icon
  }), /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-title`
  }, title), subTitle && /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-subtitle`
  }, subTitle), /*#__PURE__*/react.createElement(Extra, {
    prefixCls: prefixCls,
    extra: extra
  }), children && /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-content`
  }, children)));
};
Result.PRESENTED_IMAGE_403 = ExceptionMap['403'];
Result.PRESENTED_IMAGE_404 = ExceptionMap['404'];
Result.PRESENTED_IMAGE_500 = ExceptionMap['500'];
if (false) {}
/* harmony default export */ var result = (Result);
;// ./node_modules/@ant-design/icons-svg/es/asn/EditOutlined.js
// This icon file is generated automatically.
var EditOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M257.7 752c2 0 4-.2 6-.5L431.9 722c2-.4 3.9-1.3 5.3-2.8l423.9-423.9a9.96 9.96 0 000-14.1L694.9 114.9c-1.9-1.9-4.4-2.9-7.1-2.9s-5.2 1-7.1 2.9L256.8 538.8c-1.5 1.5-2.4 3.3-2.8 5.3l-29.5 168.2a33.5 33.5 0 009.4 29.8c6.6 6.4 14.9 9.9 23.8 9.9zm67.4-174.4L687.8 215l73.3 73.3-362.7 362.6-88.9 15.7 15.6-89zM880 836H144c-17.7 0-32 14.3-32 32v36c0 4.4 3.6 8 8 8h784c4.4 0 8-3.6 8-8v-36c0-17.7-14.3-32-32-32z" } }] }, "name": "edit", "theme": "outlined" };
/* harmony default export */ var asn_EditOutlined = (EditOutlined);

;// ./node_modules/@ant-design/icons/es/icons/EditOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var EditOutlined_EditOutlined = function EditOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_EditOutlined
  }));
};

/**![edit](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTI1Ny43IDc1MmMyIDAgNC0uMiA2LS41TDQzMS45IDcyMmMyLS40IDMuOS0xLjMgNS4zLTIuOGw0MjMuOS00MjMuOWE5Ljk2IDkuOTYgMCAwMDAtMTQuMUw2OTQuOSAxMTQuOWMtMS45LTEuOS00LjQtMi45LTcuMS0yLjlzLTUuMiAxLTcuMSAyLjlMMjU2LjggNTM4LjhjLTEuNSAxLjUtMi40IDMuMy0yLjggNS4zbC0yOS41IDE2OC4yYTMzLjUgMzMuNSAwIDAwOS40IDI5LjhjNi42IDYuNCAxNC45IDkuOSAyMy44IDkuOXptNjcuNC0xNzQuNEw2ODcuOCAyMTVsNzMuMyA3My4zLTM2Mi43IDM2Mi42LTg4LjkgMTUuNyAxNS42LTg5ek04ODAgODM2SDE0NGMtMTcuNyAwLTMyIDE0LjMtMzIgMzJ2MzZjMCA0LjQgMy42IDggOCA4aDc4NGM0LjQgMCA4LTMuNiA4LTh2LTM2YzAtMTcuNy0xNC4zLTMyLTMyLTMyeiIgLz48L3N2Zz4=) */
var EditOutlined_RefIcon = /*#__PURE__*/react.forwardRef(EditOutlined_EditOutlined);
if (false) {}
/* harmony default export */ var icons_EditOutlined = (EditOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/rc-resize-observer/es/index.js + 5 modules
var rc_resize_observer_es = __webpack_require__(18462);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Children/toArray.js
var toArray = __webpack_require__(82546);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/styleChecker.js
var styleChecker = __webpack_require__(99777);
// EXTERNAL MODULE: ./node_modules/antd/es/locale/useLocale.js
var useLocale = __webpack_require__(19155);
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var es_tooltip = __webpack_require__(40367);
;// ./node_modules/@ant-design/icons-svg/es/asn/EnterOutlined.js
// This icon file is generated automatically.
var EnterOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M864 170h-60c-4.4 0-8 3.6-8 8v518H310v-73c0-6.7-7.8-10.5-13-6.3l-141.9 112a8 8 0 000 12.6l141.9 112c5.3 4.2 13 .4 13-6.3v-75h498c35.3 0 64-28.7 64-64V178c0-4.4-3.6-8-8-8z" } }] }, "name": "enter", "theme": "outlined" };
/* harmony default export */ var asn_EnterOutlined = (EnterOutlined);

;// ./node_modules/@ant-design/icons/es/icons/EnterOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var EnterOutlined_EnterOutlined = function EnterOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_EnterOutlined
  }));
};

/**![enter](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTg2NCAxNzBoLTYwYy00LjQgMC04IDMuNi04IDh2NTE4SDMxMHYtNzNjMC02LjctNy44LTEwLjUtMTMtNi4zbC0xNDEuOSAxMTJhOCA4IDAgMDAwIDEyLjZsMTQxLjkgMTEyYzUuMyA0LjIgMTMgLjQgMTMtNi4zdi03NWg0OThjMzUuMyAwIDY0LTI4LjcgNjQtNjRWMTc4YzAtNC40LTMuNi04LTgtOHoiIC8+PC9zdmc+) */
var EnterOutlined_RefIcon = /*#__PURE__*/react.forwardRef(EnterOutlined_EnterOutlined);
if (false) {}
/* harmony default export */ var icons_EnterOutlined = (EnterOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/rc-util/es/KeyCode.js
var KeyCode = __webpack_require__(16928);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/reactNode.js
var reactNode = __webpack_require__(40682);
// EXTERNAL MODULE: ./node_modules/antd/es/input/TextArea.js + 4 modules
var TextArea = __webpack_require__(98638);
// EXTERNAL MODULE: ./node_modules/@ant-design/colors/es/index.js + 2 modules
var colors_es = __webpack_require__(45748);
;// ./node_modules/antd/es/typography/style/mixins.js
/*
.typography-title(@fontSize; @fontWeight; @lineHeight; @headingColor; @headingMarginBottom;) {
 margin-bottom: @headingMarginBottom;
 color: @headingColor;
 font-weight: @fontWeight;
 fontSize: @fontSize;
 line-height: @lineHeight;
}
*/



const getTitleStyle = (fontSize, lineHeight, color, token) => {
  const {
    titleMarginBottom,
    fontWeightStrong
  } = token;
  return {
    marginBottom: titleMarginBottom,
    color,
    fontWeight: fontWeightStrong,
    fontSize,
    lineHeight
  };
};
const getTitleStyles = token => {
  const headings = [1, 2, 3, 4, 5];
  const styles = {};
  headings.forEach(headingLevel => {
    styles[`
      h${headingLevel}&,
      div&-h${headingLevel},
      div&-h${headingLevel} > textarea,
      h${headingLevel}
    `] = getTitleStyle(token[`fontSizeHeading${headingLevel}`], token[`lineHeightHeading${headingLevel}`], token.colorTextHeading, token);
  });
  return styles;
};
const getLinkStyles = token => {
  const {
    componentCls
  } = token;
  return {
    'a&, a': Object.assign(Object.assign({}, (0,style/* operationUnit */.Y1)(token)), {
      userSelect: 'text',
      [`&[disabled], &${componentCls}-disabled`]: {
        color: token.colorTextDisabled,
        cursor: 'not-allowed',
        '&:active, &:hover': {
          color: token.colorTextDisabled
        },
        '&:active': {
          pointerEvents: 'none'
        }
      }
    })
  };
};
const getResetStyles = token => ({
  code: {
    margin: '0 0.2em',
    paddingInline: '0.4em',
    paddingBlock: '0.2em 0.1em',
    fontSize: '85%',
    fontFamily: token.fontFamilyCode,
    background: 'rgba(150, 150, 150, 0.1)',
    border: '1px solid rgba(100, 100, 100, 0.2)',
    borderRadius: 3
  },
  kbd: {
    margin: '0 0.2em',
    paddingInline: '0.4em',
    paddingBlock: '0.15em 0.1em',
    fontSize: '90%',
    fontFamily: token.fontFamilyCode,
    background: 'rgba(150, 150, 150, 0.06)',
    border: '1px solid rgba(100, 100, 100, 0.2)',
    borderBottomWidth: 2,
    borderRadius: 3
  },
  mark: {
    padding: 0,
    // FIXME hardcode in v4
    backgroundColor: colors_es/* gold */.bK[2]
  },
  'u, ins': {
    textDecoration: 'underline',
    textDecorationSkipInk: 'auto'
  },
  's, del': {
    textDecoration: 'line-through'
  },
  strong: {
    fontWeight: 600
  },
  // list
  'ul, ol': {
    marginInline: 0,
    marginBlock: '0 1em',
    padding: 0,
    li: {
      marginInline: '20px 0',
      marginBlock: 0,
      paddingInline: '4px 0',
      paddingBlock: 0
    }
  },
  ul: {
    listStyleType: 'circle',
    ul: {
      listStyleType: 'disc'
    }
  },
  ol: {
    listStyleType: 'decimal'
  },
  // pre & block
  'pre, blockquote': {
    margin: '1em 0'
  },
  pre: {
    padding: '0.4em 0.6em',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    background: 'rgba(150, 150, 150, 0.1)',
    border: '1px solid rgba(100, 100, 100, 0.2)',
    borderRadius: 3,
    fontFamily: token.fontFamilyCode,
    // Compatible for marked
    code: {
      display: 'inline',
      margin: 0,
      padding: 0,
      fontSize: 'inherit',
      fontFamily: 'inherit',
      background: 'transparent',
      border: 0
    }
  },
  blockquote: {
    paddingInline: '0.6em 0',
    paddingBlock: 0,
    borderInlineStart: '4px solid rgba(100, 100, 100, 0.2)',
    opacity: 0.85
  }
});
const getEditableStyles = token => {
  const {
    componentCls,
    paddingSM
  } = token;
  const inputShift = paddingSM;
  return {
    '&-edit-content': {
      position: 'relative',
      'div&': {
        insetInlineStart: token.calc(token.paddingSM).mul(-1).equal(),
        marginTop: token.calc(inputShift).mul(-1).equal(),
        marginBottom: `calc(1em - ${(0,cssinjs_es/* unit */.zA)(inputShift)})`
      },
      [`${componentCls}-edit-content-confirm`]: {
        position: 'absolute',
        insetInlineEnd: token.calc(token.marginXS).add(2).equal(),
        insetBlockEnd: token.marginXS,
        color: token.colorTextDescription,
        // default style
        fontWeight: 'normal',
        fontSize: token.fontSize,
        fontStyle: 'normal',
        pointerEvents: 'none'
      },
      textarea: {
        margin: '0!important',
        // Fix Editable Textarea flash in Firefox
        MozTransition: 'none',
        height: '1em'
      }
    }
  };
};
const getCopyableStyles = token => ({
  [`${token.componentCls}-copy-success`]: {
    [`
    &,
    &:hover,
    &:focus`]: {
      color: token.colorSuccess
    }
  },
  [`${token.componentCls}-copy-icon-only`]: {
    marginInlineStart: 0
  }
});
const getEllipsisStyles = () => ({
  [`
  a&-ellipsis,
  span&-ellipsis
  `]: {
    display: 'inline-block',
    maxWidth: '100%'
  },
  '&-ellipsis-single-line': {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    // https://blog.csdn.net/iefreer/article/details/50421025
    'a&, span&': {
      verticalAlign: 'bottom'
    },
    '> code': {
      paddingBlock: 0,
      maxWidth: 'calc(100% - 1.2em)',
      display: 'inline-block',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      verticalAlign: 'bottom',
      // https://github.com/ant-design/ant-design/issues/45953
      boxSizing: 'content-box'
    }
  },
  '&-ellipsis-multiple-line': {
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical'
  }
});
;// ./node_modules/antd/es/typography/style/index.js



const genTypographyStyle = token => {
  const {
    componentCls,
    titleMarginTop
  } = token;
  return {
    [componentCls]: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({
      color: token.colorText,
      wordBreak: 'break-word',
      lineHeight: token.lineHeight,
      [`&${componentCls}-secondary`]: {
        color: token.colorTextDescription
      },
      [`&${componentCls}-success`]: {
        color: token.colorSuccess
      },
      [`&${componentCls}-warning`]: {
        color: token.colorWarning
      },
      [`&${componentCls}-danger`]: {
        color: token.colorError,
        'a&:active, a&:focus': {
          color: token.colorErrorActive
        },
        'a&:hover': {
          color: token.colorErrorHover
        }
      },
      [`&${componentCls}-disabled`]: {
        color: token.colorTextDisabled,
        cursor: 'not-allowed',
        userSelect: 'none'
      },
      [`
        div&,
        p
      `]: {
        marginBottom: '1em'
      }
    }, getTitleStyles(token)), {
      [`
      & + h1${componentCls},
      & + h2${componentCls},
      & + h3${componentCls},
      & + h4${componentCls},
      & + h5${componentCls}
      `]: {
        marginTop: titleMarginTop
      },
      [`
      div,
      ul,
      li,
      p,
      h1,
      h2,
      h3,
      h4,
      h5`]: {
        [`
        + h1,
        + h2,
        + h3,
        + h4,
        + h5
        `]: {
          marginTop: titleMarginTop
        }
      }
    }), getResetStyles(token)), getLinkStyles(token)), {
      // Operation
      [`
        ${componentCls}-expand,
        ${componentCls}-collapse,
        ${componentCls}-edit,
        ${componentCls}-copy
      `]: Object.assign(Object.assign({}, (0,style/* operationUnit */.Y1)(token)), {
        marginInlineStart: token.marginXXS
      })
    }), getEditableStyles(token)), getCopyableStyles(token)), getEllipsisStyles()), {
      '&-rtl': {
        direction: 'rtl'
      }
    })
  };
};
const typography_style_prepareComponentToken = () => ({
  titleMarginTop: '1.2em',
  titleMarginBottom: '0.5em'
});
// ============================== Export ==============================
/* harmony default export */ var typography_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Typography', token => [genTypographyStyle(token)], typography_style_prepareComponentToken));
;// ./node_modules/antd/es/typography/Editable.js
"use client";








const Editable = props => {
  const {
    prefixCls,
    'aria-label': ariaLabel,
    className,
    style,
    direction,
    maxLength,
    autoSize = true,
    value,
    onSave,
    onCancel,
    onEnd,
    component,
    enterIcon = /*#__PURE__*/react.createElement(icons_EnterOutlined, null)
  } = props;
  const ref = react.useRef(null);
  const inComposition = react.useRef(false);
  const lastKeyCode = react.useRef();
  const [current, setCurrent] = react.useState(value);
  react.useEffect(() => {
    setCurrent(value);
  }, [value]);
  react.useEffect(() => {
    var _a;
    if ((_a = ref.current) === null || _a === void 0 ? void 0 : _a.resizableTextArea) {
      const {
        textArea
      } = ref.current.resizableTextArea;
      textArea.focus();
      const {
        length
      } = textArea.value;
      textArea.setSelectionRange(length, length);
    }
  }, []);
  const onChange = _ref => {
    let {
      target
    } = _ref;
    setCurrent(target.value.replace(/[\n\r]/g, ''));
  };
  const onCompositionStart = () => {
    inComposition.current = true;
  };
  const onCompositionEnd = () => {
    inComposition.current = false;
  };
  const onKeyDown = _ref2 => {
    let {
      keyCode
    } = _ref2;
    // We don't record keyCode when IME is using
    if (inComposition.current) return;
    lastKeyCode.current = keyCode;
  };
  const confirmChange = () => {
    onSave(current.trim());
  };
  const onKeyUp = _ref3 => {
    let {
      keyCode,
      ctrlKey,
      altKey,
      metaKey,
      shiftKey
    } = _ref3;
    // Check if it's a real key
    if (lastKeyCode.current !== keyCode || inComposition.current || ctrlKey || altKey || metaKey || shiftKey) {
      return;
    }
    if (keyCode === KeyCode/* default */.A.ENTER) {
      confirmChange();
      onEnd === null || onEnd === void 0 ? void 0 : onEnd();
    } else if (keyCode === KeyCode/* default */.A.ESC) {
      onCancel();
    }
  };
  const onBlur = () => {
    confirmChange();
  };
  const [wrapCSSVar, hashId, cssVarCls] = typography_style(prefixCls);
  const textAreaClassName = classnames_default()(prefixCls, `${prefixCls}-edit-content`, {
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-${component}`]: !!component
  }, className, hashId, cssVarCls);
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", {
    className: textAreaClassName,
    style: style
  }, /*#__PURE__*/react.createElement(TextArea/* default */.A, {
    ref: ref,
    maxLength: maxLength,
    value: current,
    onChange: onChange,
    onKeyDown: onKeyDown,
    onKeyUp: onKeyUp,
    onCompositionStart: onCompositionStart,
    onCompositionEnd: onCompositionEnd,
    onBlur: onBlur,
    "aria-label": ariaLabel,
    rows: 1,
    autoSize: autoSize
  }), enterIcon !== null ? (0,reactNode/* cloneElement */.Ob)(enterIcon, {
    className: `${prefixCls}-edit-content-confirm`
  }) : null));
};
/* harmony default export */ var typography_Editable = (Editable);
// EXTERNAL MODULE: ./node_modules/copy-to-clipboard/index.js
var copy_to_clipboard = __webpack_require__(17965);
var copy_to_clipboard_default = /*#__PURE__*/__webpack_require__.n(copy_to_clipboard);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useEvent.js
var useEvent = __webpack_require__(26956);
;// ./node_modules/antd/es/_util/toList.js
function toList(candidate) {
  let skipEmpty = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
  if (skipEmpty && (candidate === undefined || candidate === null)) return [];
  return Array.isArray(candidate) ? candidate : [candidate];
}
;// ./node_modules/antd/es/typography/hooks/useCopyClick.js
var __awaiter = undefined && undefined.__awaiter || function (thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function (resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function (resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
};




const useCopyClick = _ref => {
  let {
    copyConfig,
    children
  } = _ref;
  const [copied, setCopied] = react.useState(false);
  const [copyLoading, setCopyLoading] = react.useState(false);
  const copyIdRef = react.useRef(null);
  const cleanCopyId = () => {
    if (copyIdRef.current) {
      clearTimeout(copyIdRef.current);
    }
  };
  const copyOptions = {};
  if (copyConfig.format) {
    copyOptions.format = copyConfig.format;
  }
  react.useEffect(() => cleanCopyId, []);
  // Keep copy action up to date
  const onClick = (0,useEvent/* default */.A)(e => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    e === null || e === void 0 ? void 0 : e.preventDefault();
    e === null || e === void 0 ? void 0 : e.stopPropagation();
    setCopyLoading(true);
    try {
      const text = typeof copyConfig.text === 'function' ? yield copyConfig.text() : copyConfig.text;
      copy_to_clipboard_default()(text || toList(children, true).join('') || '', copyOptions);
      setCopyLoading(false);
      setCopied(true);
      // Trigger tips update
      cleanCopyId();
      copyIdRef.current = setTimeout(() => {
        setCopied(false);
      }, 3000);
      (_a = copyConfig.onCopy) === null || _a === void 0 ? void 0 : _a.call(copyConfig, e);
    } catch (error) {
      setCopyLoading(false);
      throw error;
    }
  }));
  return {
    copied,
    copyLoading,
    onClick
  };
};
/* harmony default export */ var hooks_useCopyClick = (useCopyClick);
;// ./node_modules/antd/es/typography/hooks/useMergedConfig.js

function useMergedConfig(propConfig, templateConfig) {
  return react.useMemo(() => {
    const support = !!propConfig;
    return [support, Object.assign(Object.assign({}, templateConfig), support && typeof propConfig === 'object' ? propConfig : null)];
  }, [propConfig]);
}
;// ./node_modules/antd/es/typography/hooks/usePrevious.js

const usePrevious = value => {
  const ref = (0,react.useRef)();
  (0,react.useEffect)(() => {
    ref.current = value;
  });
  return ref.current;
};
/* harmony default export */ var hooks_usePrevious = (usePrevious);
;// ./node_modules/antd/es/typography/hooks/useTooltipProps.js

const useTooltipProps = (tooltip, editConfigText, children) => (0,react.useMemo)(() => {
  if (tooltip === true) {
    return {
      title: editConfigText !== null && editConfigText !== void 0 ? editConfigText : children
    };
  }
  if (/*#__PURE__*/(0,react.isValidElement)(tooltip)) {
    return {
      title: tooltip
    };
  }
  if (typeof tooltip === 'object') {
    return Object.assign({
      title: editConfigText !== null && editConfigText !== void 0 ? editConfigText : children
    }, tooltip);
  }
  return {
    title: tooltip
  };
}, [tooltip, editConfigText, children]);
/* harmony default export */ var hooks_useTooltipProps = (useTooltipProps);
;// ./node_modules/antd/es/typography/Typography.js
"use client";

var Typography_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};






const Typography = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      prefixCls: customizePrefixCls,
      component: Component = 'article',
      className,
      rootClassName,
      setContentRef,
      children,
      direction: typographyDirection,
      style
    } = props,
    restProps = Typography_rest(props, ["prefixCls", "component", "className", "rootClassName", "setContentRef", "children", "direction", "style"]);
  const {
    getPrefixCls,
    direction: contextDirection,
    typography
  } = react.useContext(context/* ConfigContext */.QO);
  const direction = typographyDirection !== null && typographyDirection !== void 0 ? typographyDirection : contextDirection;
  const mergedRef = setContentRef ? (0,es_ref/* composeRef */.K4)(ref, setContentRef) : ref;
  const prefixCls = getPrefixCls('typography', customizePrefixCls);
  if (false) {}
  // Style
  const [wrapCSSVar, hashId, cssVarCls] = typography_style(prefixCls);
  const componentClassName = classnames_default()(prefixCls, typography === null || typography === void 0 ? void 0 : typography.className, {
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, className, rootClassName, hashId, cssVarCls);
  const mergedStyle = Object.assign(Object.assign({}, typography === null || typography === void 0 ? void 0 : typography.style), style);
  return wrapCSSVar(
  /*#__PURE__*/
  // @ts-expect-error: Expression produces a union type that is too complex to represent.
  react.createElement(Component, Object.assign({
    className: componentClassName,
    style: mergedStyle,
    ref: mergedRef
  }, restProps), children));
});
if (false) {}
/* harmony default export */ var typography_Typography = (Typography);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CheckOutlined.js + 1 modules
var CheckOutlined = __webpack_require__(26067);
;// ./node_modules/@ant-design/icons-svg/es/asn/CopyOutlined.js
// This icon file is generated automatically.
var CopyOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M832 64H296c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h496v688c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V96c0-17.7-14.3-32-32-32zM704 192H192c-17.7 0-32 14.3-32 32v530.7c0 8.5 3.4 16.6 9.4 22.6l173.3 173.3c2.2 2.2 4.7 4 7.4 5.5v1.9h4.2c3.5 1.3 7.2 2 11 2H704c17.7 0 32-14.3 32-32V224c0-17.7-14.3-32-32-32zM350 856.2L263.9 770H350v86.2zM664 888H414V746c0-22.1-17.9-40-40-40H232V264h432v624z" } }] }, "name": "copy", "theme": "outlined" };
/* harmony default export */ var asn_CopyOutlined = (CopyOutlined);

;// ./node_modules/@ant-design/icons/es/icons/CopyOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var CopyOutlined_CopyOutlined = function CopyOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_CopyOutlined
  }));
};

/**![copy](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTgzMiA2NEgyOTZjLTQuNCAwLTggMy42LTggOHY1NmMwIDQuNCAzLjYgOCA4IDhoNDk2djY4OGMwIDQuNCAzLjYgOCA4IDhoNTZjNC40IDAgOC0zLjYgOC04Vjk2YzAtMTcuNy0xNC4zLTMyLTMyLTMyek03MDQgMTkySDE5MmMtMTcuNyAwLTMyIDE0LjMtMzIgMzJ2NTMwLjdjMCA4LjUgMy40IDE2LjYgOS40IDIyLjZsMTczLjMgMTczLjNjMi4yIDIuMiA0LjcgNCA3LjQgNS41djEuOWg0LjJjMy41IDEuMyA3LjIgMiAxMSAySDcwNGMxNy43IDAgMzItMTQuMyAzMi0zMlYyMjRjMC0xNy43LTE0LjMtMzItMzItMzJ6TTM1MCA4NTYuMkwyNjMuOSA3NzBIMzUwdjg2LjJ6TTY2NCA4ODhINDE0Vjc0NmMwLTIyLjEtMTcuOS00MC00MC00MEgyMzJWMjY0aDQzMnY2MjR6IiAvPjwvc3ZnPg==) */
var CopyOutlined_RefIcon = /*#__PURE__*/react.forwardRef(CopyOutlined_CopyOutlined);
if (false) {}
/* harmony default export */ var icons_CopyOutlined = (CopyOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/LoadingOutlined.js + 1 modules
var LoadingOutlined = __webpack_require__(93567);
;// ./node_modules/antd/es/typography/Base/util.js
function util_toList(val) {
  if (val === false) {
    return [false, false];
  }
  return Array.isArray(val) ? val : [val];
}
function getNode(dom, defaultNode, needDom) {
  if (dom === true || dom === undefined) {
    return defaultNode;
  }
  return dom || needDom && defaultNode;
}
/**
 * Check for element is native ellipsis
 * ref:
 * - https://github.com/ant-design/ant-design/issues/50143
 * - https://github.com/ant-design/ant-design/issues/50414
 */
function isEleEllipsis(ele) {
  // Create a new div to get the size
  const childDiv = document.createElement('em');
  ele.appendChild(childDiv);
  // For test case
  if (false) {}
  const rect = ele.getBoundingClientRect();
  const childRect = childDiv.getBoundingClientRect();
  // Reset
  ele.removeChild(childDiv);
  // Range checker
  return (
    // Horizontal out of range
    rect.left > childRect.left || childRect.right > rect.right ||
    // Vertical out of range
    rect.top > childRect.top || childRect.bottom > rect.bottom
  );
}
const isValidText = val => ['string', 'number'].includes(typeof val);
;// ./node_modules/antd/es/typography/Base/CopyBtn.js
"use client";








const CopyBtn = _ref => {
  let {
    prefixCls,
    copied,
    locale,
    iconOnly,
    tooltips,
    icon,
    tabIndex,
    onCopy,
    loading: btnLoading
  } = _ref;
  const tooltipNodes = util_toList(tooltips);
  const iconNodes = util_toList(icon);
  const {
    copied: copiedText,
    copy: copyText
  } = locale !== null && locale !== void 0 ? locale : {};
  const systemStr = copied ? copiedText : copyText;
  const copyTitle = getNode(tooltipNodes[copied ? 1 : 0], systemStr);
  const ariaLabel = typeof copyTitle === 'string' ? copyTitle : systemStr;
  return /*#__PURE__*/react.createElement(es_tooltip/* default */.A, {
    title: copyTitle
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    className: classnames_default()(`${prefixCls}-copy`, {
      [`${prefixCls}-copy-success`]: copied,
      [`${prefixCls}-copy-icon-only`]: iconOnly
    }),
    onClick: onCopy,
    "aria-label": ariaLabel,
    tabIndex: tabIndex
  }, copied ? getNode(iconNodes[1], /*#__PURE__*/react.createElement(CheckOutlined/* default */.A, null), true) : getNode(iconNodes[0], btnLoading ? /*#__PURE__*/react.createElement(LoadingOutlined/* default */.A, null) : /*#__PURE__*/react.createElement(icons_CopyOutlined, null), true)));
};
/* harmony default export */ var Base_CopyBtn = (CopyBtn);
;// ./node_modules/antd/es/typography/Base/Ellipsis.js
"use client";






const MeasureText = /*#__PURE__*/react.forwardRef((_ref, ref) => {
  let {
    style,
    children
  } = _ref;
  const spanRef = react.useRef(null);
  react.useImperativeHandle(ref, () => ({
    isExceed: () => {
      const span = spanRef.current;
      return span.scrollHeight > span.clientHeight;
    },
    getHeight: () => spanRef.current.clientHeight
  }));
  return /*#__PURE__*/react.createElement("span", {
    "aria-hidden": true,
    ref: spanRef,
    style: Object.assign({
      position: 'fixed',
      display: 'block',
      left: 0,
      top: 0,
      pointerEvents: 'none',
      backgroundColor: 'rgba(255, 0, 0, 0.65)'
    }, style)
  }, children);
});
const getNodesLen = nodeList => nodeList.reduce((totalLen, node) => totalLen + (isValidText(node) ? String(node).length : 1), 0);
function sliceNodes(nodeList, len) {
  let currLen = 0;
  const currentNodeList = [];
  for (let i = 0; i < nodeList.length; i += 1) {
    // Match to return
    if (currLen === len) {
      return currentNodeList;
    }
    const node = nodeList[i];
    const canCut = isValidText(node);
    const nodeLen = canCut ? String(node).length : 1;
    const nextLen = currLen + nodeLen;
    // Exceed but current not which means we need cut this
    // This will not happen on validate ReactElement
    if (nextLen > len) {
      const restLen = len - currLen;
      currentNodeList.push(String(node).slice(0, restLen));
      return currentNodeList;
    }
    currentNodeList.push(node);
    currLen = nextLen;
  }
  return nodeList;
}
// Measure for the `text` is exceed the `rows` or not
const STATUS_MEASURE_NONE = 0;
const STATUS_MEASURE_PREPARE = 1;
const STATUS_MEASURE_START = 2;
const STATUS_MEASURE_NEED_ELLIPSIS = 3;
const STATUS_MEASURE_NO_NEED_ELLIPSIS = 4;
const lineClipStyle = {
  display: '-webkit-box',
  overflow: 'hidden',
  WebkitBoxOrient: 'vertical'
};
function EllipsisMeasure(props) {
  const {
    enableMeasure,
    width,
    text,
    children,
    rows,
    expanded,
    miscDeps,
    onEllipsis
  } = props;
  const nodeList = react.useMemo(() => (0,toArray/* default */.A)(text), [text]);
  const nodeLen = react.useMemo(() => getNodesLen(nodeList), [text]);
  // ========================= Full Content =========================
  // Used for measure only, which means it's always render as no need ellipsis
  const fullContent = react.useMemo(() => children(nodeList, false), [text]);
  // ========================= Cut Content ==========================
  const [ellipsisCutIndex, setEllipsisCutIndex] = react.useState(null);
  const cutMidRef = react.useRef(null);
  // ========================= NeedEllipsis =========================
  const measureWhiteSpaceRef = react.useRef(null);
  const needEllipsisRef = react.useRef(null);
  // Measure for `rows-1` height, to avoid operation exceed the line height
  const descRowsEllipsisRef = react.useRef(null);
  const symbolRowEllipsisRef = react.useRef(null);
  const [canEllipsis, setCanEllipsis] = react.useState(false);
  const [needEllipsis, setNeedEllipsis] = react.useState(STATUS_MEASURE_NONE);
  const [ellipsisHeight, setEllipsisHeight] = react.useState(0);
  const [parentWhiteSpace, setParentWhiteSpace] = react.useState(null);
  // Trigger start measure
  (0,useLayoutEffect/* default */.A)(() => {
    if (enableMeasure && width && nodeLen) {
      setNeedEllipsis(STATUS_MEASURE_PREPARE);
    } else {
      setNeedEllipsis(STATUS_MEASURE_NONE);
    }
  }, [width, text, rows, enableMeasure, nodeList]);
  // Measure process
  (0,useLayoutEffect/* default */.A)(() => {
    var _a, _b, _c, _d;
    if (needEllipsis === STATUS_MEASURE_PREPARE) {
      setNeedEllipsis(STATUS_MEASURE_START);
      // Parent ref `white-space`
      const nextWhiteSpace = measureWhiteSpaceRef.current && getComputedStyle(measureWhiteSpaceRef.current).whiteSpace;
      setParentWhiteSpace(nextWhiteSpace);
    } else if (needEllipsis === STATUS_MEASURE_START) {
      const isOverflow = !!((_a = needEllipsisRef.current) === null || _a === void 0 ? void 0 : _a.isExceed());
      setNeedEllipsis(isOverflow ? STATUS_MEASURE_NEED_ELLIPSIS : STATUS_MEASURE_NO_NEED_ELLIPSIS);
      setEllipsisCutIndex(isOverflow ? [0, nodeLen] : null);
      setCanEllipsis(isOverflow);
      // Get the basic height of ellipsis rows
      const baseRowsEllipsisHeight = ((_b = needEllipsisRef.current) === null || _b === void 0 ? void 0 : _b.getHeight()) || 0;
      // Get the height of `rows - 1` + symbol height
      const descRowsEllipsisHeight = rows === 1 ? 0 : ((_c = descRowsEllipsisRef.current) === null || _c === void 0 ? void 0 : _c.getHeight()) || 0;
      const symbolRowEllipsisHeight = ((_d = symbolRowEllipsisRef.current) === null || _d === void 0 ? void 0 : _d.getHeight()) || 0;
      const maxRowsHeight = Math.max(baseRowsEllipsisHeight,
      // height of rows with ellipsis
      descRowsEllipsisHeight + symbolRowEllipsisHeight);
      setEllipsisHeight(maxRowsHeight + 1);
      onEllipsis(isOverflow);
    }
  }, [needEllipsis]);
  // ========================= Cut Measure ==========================
  const cutMidIndex = ellipsisCutIndex ? Math.ceil((ellipsisCutIndex[0] + ellipsisCutIndex[1]) / 2) : 0;
  (0,useLayoutEffect/* default */.A)(() => {
    var _a;
    const [minIndex, maxIndex] = ellipsisCutIndex || [0, 0];
    if (minIndex !== maxIndex) {
      const midHeight = ((_a = cutMidRef.current) === null || _a === void 0 ? void 0 : _a.getHeight()) || 0;
      const isOverflow = midHeight > ellipsisHeight;
      let targetMidIndex = cutMidIndex;
      if (maxIndex - minIndex === 1) {
        targetMidIndex = isOverflow ? minIndex : maxIndex;
      }
      setEllipsisCutIndex(isOverflow ? [minIndex, targetMidIndex] : [targetMidIndex, maxIndex]);
    }
  }, [ellipsisCutIndex, cutMidIndex]);
  // ========================= Text Content =========================
  const finalContent = react.useMemo(() => {
    // Skip everything if `enableMeasure` is disabled
    if (!enableMeasure) {
      return children(nodeList, false);
    }
    if (needEllipsis !== STATUS_MEASURE_NEED_ELLIPSIS || !ellipsisCutIndex || ellipsisCutIndex[0] !== ellipsisCutIndex[1]) {
      const content = children(nodeList, false);
      // Limit the max line count to avoid scrollbar blink unless no need ellipsis
      // https://github.com/ant-design/ant-design/issues/42958
      if ([STATUS_MEASURE_NO_NEED_ELLIPSIS, STATUS_MEASURE_NONE].includes(needEllipsis)) {
        return content;
      }
      return /*#__PURE__*/react.createElement("span", {
        style: Object.assign(Object.assign({}, lineClipStyle), {
          WebkitLineClamp: rows
        })
      }, content);
    }
    return children(expanded ? nodeList : sliceNodes(nodeList, ellipsisCutIndex[0]), canEllipsis);
  }, [expanded, needEllipsis, ellipsisCutIndex, nodeList].concat((0,toConsumableArray/* default */.A)(miscDeps)));
  // ============================ Render ============================
  const measureStyle = {
    width,
    margin: 0,
    padding: 0,
    whiteSpace: parentWhiteSpace === 'nowrap' ? 'normal' : 'inherit'
  };
  return /*#__PURE__*/react.createElement(react.Fragment, null, finalContent, needEllipsis === STATUS_MEASURE_START && (/*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement(MeasureText, {
    style: Object.assign(Object.assign(Object.assign({}, measureStyle), lineClipStyle), {
      WebkitLineClamp: rows
    }),
    ref: needEllipsisRef
  }, fullContent), /*#__PURE__*/react.createElement(MeasureText, {
    style: Object.assign(Object.assign(Object.assign({}, measureStyle), lineClipStyle), {
      WebkitLineClamp: rows - 1
    }),
    ref: descRowsEllipsisRef
  }, fullContent), /*#__PURE__*/react.createElement(MeasureText, {
    style: Object.assign(Object.assign(Object.assign({}, measureStyle), lineClipStyle), {
      WebkitLineClamp: 1
    }),
    ref: symbolRowEllipsisRef
  }, children([], true)))), needEllipsis === STATUS_MEASURE_NEED_ELLIPSIS && ellipsisCutIndex && ellipsisCutIndex[0] !== ellipsisCutIndex[1] && (/*#__PURE__*/react.createElement(MeasureText, {
    style: Object.assign(Object.assign({}, measureStyle), {
      top: 400
    }),
    ref: cutMidRef
  }, children(sliceNodes(nodeList, cutMidIndex), true))), needEllipsis === STATUS_MEASURE_PREPARE && (/*#__PURE__*/react.createElement("span", {
    style: {
      whiteSpace: 'inherit'
    },
    ref: measureWhiteSpaceRef
  })));
}
;// ./node_modules/antd/es/typography/Base/EllipsisTooltip.js
"use client";



const EllipsisTooltip = _ref => {
  let {
    enableEllipsis,
    isEllipsis,
    children,
    tooltipProps
  } = _ref;
  if (!(tooltipProps === null || tooltipProps === void 0 ? void 0 : tooltipProps.title) || !enableEllipsis) {
    return children;
  }
  return /*#__PURE__*/react.createElement(es_tooltip/* default */.A, Object.assign({
    open: isEllipsis ? undefined : false
  }, tooltipProps), children);
};
if (false) {}
/* harmony default export */ var Base_EllipsisTooltip = (EllipsisTooltip);
;// ./node_modules/antd/es/typography/Base/index.js
"use client";

var Base_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};























function wrapperDecorations(_ref, content) {
  let {
    mark,
    code,
    underline,
    delete: del,
    strong,
    keyboard,
    italic
  } = _ref;
  let currentContent = content;
  function wrap(tag, needed) {
    if (!needed) {
      return;
    }
    currentContent = /*#__PURE__*/react.createElement(tag, {}, currentContent);
  }
  wrap('strong', strong);
  wrap('u', underline);
  wrap('del', del);
  wrap('code', code);
  wrap('mark', mark);
  wrap('kbd', keyboard);
  wrap('i', italic);
  return currentContent;
}
const ELLIPSIS_STR = '...';
const Base = /*#__PURE__*/react.forwardRef((props, ref) => {
  var _a;
  const {
      prefixCls: customizePrefixCls,
      className,
      style,
      type,
      disabled,
      children,
      ellipsis,
      editable,
      copyable,
      component,
      title
    } = props,
    restProps = Base_rest(props, ["prefixCls", "className", "style", "type", "disabled", "children", "ellipsis", "editable", "copyable", "component", "title"]);
  const {
    getPrefixCls,
    direction
  } = react.useContext(context/* ConfigContext */.QO);
  const [textLocale] = (0,useLocale/* default */.A)('Text');
  const typographyRef = react.useRef(null);
  const editIconRef = react.useRef(null);
  // ============================ MISC ============================
  const prefixCls = getPrefixCls('typography', customizePrefixCls);
  const textProps = (0,omit/* default */.A)(restProps, ['mark', 'code', 'delete', 'underline', 'strong', 'keyboard', 'italic']);
  // ========================== Editable ==========================
  const [enableEdit, editConfig] = useMergedConfig(editable);
  const [editing, setEditing] = (0,useMergedState/* default */.A)(false, {
    value: editConfig.editing
  });
  const {
    triggerType = ['icon']
  } = editConfig;
  const triggerEdit = edit => {
    var _a;
    if (edit) {
      (_a = editConfig.onStart) === null || _a === void 0 ? void 0 : _a.call(editConfig);
    }
    setEditing(edit);
  };
  // Focus edit icon when back
  const prevEditing = hooks_usePrevious(editing);
  (0,useLayoutEffect/* default */.A)(() => {
    var _a;
    if (!editing && prevEditing) {
      (_a = editIconRef.current) === null || _a === void 0 ? void 0 : _a.focus();
    }
  }, [editing]);
  const onEditClick = e => {
    e === null || e === void 0 ? void 0 : e.preventDefault();
    triggerEdit(true);
  };
  const onEditChange = value => {
    var _a;
    (_a = editConfig.onChange) === null || _a === void 0 ? void 0 : _a.call(editConfig, value);
    triggerEdit(false);
  };
  const onEditCancel = () => {
    var _a;
    (_a = editConfig.onCancel) === null || _a === void 0 ? void 0 : _a.call(editConfig);
    triggerEdit(false);
  };
  // ========================== Copyable ==========================
  const [enableCopy, copyConfig] = useMergedConfig(copyable);
  const {
    copied,
    copyLoading,
    onClick: onCopyClick
  } = hooks_useCopyClick({
    copyConfig,
    children
  });
  // ========================== Ellipsis ==========================
  const [isLineClampSupport, setIsLineClampSupport] = react.useState(false);
  const [isTextOverflowSupport, setIsTextOverflowSupport] = react.useState(false);
  const [isJsEllipsis, setIsJsEllipsis] = react.useState(false);
  const [isNativeEllipsis, setIsNativeEllipsis] = react.useState(false);
  const [isNativeVisible, setIsNativeVisible] = react.useState(true);
  const [enableEllipsis, ellipsisConfig] = useMergedConfig(ellipsis, {
    expandable: false,
    symbol: isExpanded => isExpanded ? textLocale === null || textLocale === void 0 ? void 0 : textLocale.collapse : textLocale === null || textLocale === void 0 ? void 0 : textLocale.expand
  });
  const [expanded, setExpanded] = (0,useMergedState/* default */.A)(ellipsisConfig.defaultExpanded || false, {
    value: ellipsisConfig.expanded
  });
  const mergedEnableEllipsis = enableEllipsis && (!expanded || ellipsisConfig.expandable === 'collapsible');
  // Shared prop to reduce bundle size
  const {
    rows = 1
  } = ellipsisConfig;
  const needMeasureEllipsis = react.useMemo(() =>
  // Disable ellipsis
  mergedEnableEllipsis && (
  // Provide suffix
  ellipsisConfig.suffix !== undefined || ellipsisConfig.onEllipsis ||
  // Can't use css ellipsis since we need to provide the place for button
  ellipsisConfig.expandable || enableEdit || enableCopy), [mergedEnableEllipsis, ellipsisConfig, enableEdit, enableCopy]);
  (0,useLayoutEffect/* default */.A)(() => {
    if (enableEllipsis && !needMeasureEllipsis) {
      setIsLineClampSupport((0,styleChecker/* isStyleSupport */.F)('webkitLineClamp'));
      setIsTextOverflowSupport((0,styleChecker/* isStyleSupport */.F)('textOverflow'));
    }
  }, [needMeasureEllipsis, enableEllipsis]);
  const [cssEllipsis, setCssEllipsis] = react.useState(mergedEnableEllipsis);
  const canUseCssEllipsis = react.useMemo(() => {
    if (needMeasureEllipsis) {
      return false;
    }
    if (rows === 1) {
      return isTextOverflowSupport;
    }
    return isLineClampSupport;
  }, [needMeasureEllipsis, isTextOverflowSupport, isLineClampSupport]);
  // We use effect to change from css ellipsis to js ellipsis.
  // To make SSR still can see the ellipsis.
  (0,useLayoutEffect/* default */.A)(() => {
    setCssEllipsis(canUseCssEllipsis && mergedEnableEllipsis);
  }, [canUseCssEllipsis, mergedEnableEllipsis]);
  const isMergedEllipsis = mergedEnableEllipsis && (cssEllipsis ? isNativeEllipsis : isJsEllipsis);
  const cssTextOverflow = mergedEnableEllipsis && rows === 1 && cssEllipsis;
  const cssLineClamp = mergedEnableEllipsis && rows > 1 && cssEllipsis;
  // >>>>> Expand
  const onExpandClick = (e, info) => {
    var _a;
    setExpanded(info.expanded);
    (_a = ellipsisConfig.onExpand) === null || _a === void 0 ? void 0 : _a.call(ellipsisConfig, e, info);
  };
  const [ellipsisWidth, setEllipsisWidth] = react.useState(0);
  const onResize = _ref2 => {
    let {
      offsetWidth
    } = _ref2;
    setEllipsisWidth(offsetWidth);
  };
  // >>>>> JS Ellipsis
  const onJsEllipsis = jsEllipsis => {
    var _a;
    setIsJsEllipsis(jsEllipsis);
    // Trigger if changed
    if (isJsEllipsis !== jsEllipsis) {
      (_a = ellipsisConfig.onEllipsis) === null || _a === void 0 ? void 0 : _a.call(ellipsisConfig, jsEllipsis);
    }
  };
  // >>>>> Native ellipsis
  react.useEffect(() => {
    const textEle = typographyRef.current;
    if (enableEllipsis && cssEllipsis && textEle) {
      const currentEllipsis = isEleEllipsis(textEle);
      if (isNativeEllipsis !== currentEllipsis) {
        setIsNativeEllipsis(currentEllipsis);
      }
    }
  }, [enableEllipsis, cssEllipsis, children, cssLineClamp, isNativeVisible, ellipsisWidth]);
  // https://github.com/ant-design/ant-design/issues/36786
  // Use IntersectionObserver to check if element is invisible
  react.useEffect(() => {
    const textEle = typographyRef.current;
    if (typeof IntersectionObserver === 'undefined' || !textEle || !cssEllipsis || !mergedEnableEllipsis) {
      return;
    }
    /* eslint-disable-next-line compat/compat */
    const observer = new IntersectionObserver(() => {
      setIsNativeVisible(!!textEle.offsetParent);
    });
    observer.observe(textEle);
    return () => {
      observer.disconnect();
    };
  }, [cssEllipsis, mergedEnableEllipsis]);
  // ========================== Tooltip ===========================
  const tooltipProps = hooks_useTooltipProps(ellipsisConfig.tooltip, editConfig.text, children);
  const topAriaLabel = react.useMemo(() => {
    if (!enableEllipsis || cssEllipsis) {
      return undefined;
    }
    return [editConfig.text, children, title, tooltipProps.title].find(isValidText);
  }, [enableEllipsis, cssEllipsis, title, tooltipProps.title, isMergedEllipsis]);
  // =========================== Render ===========================
  // >>>>>>>>>>> Editing input
  if (editing) {
    return /*#__PURE__*/react.createElement(typography_Editable, {
      value: (_a = editConfig.text) !== null && _a !== void 0 ? _a : typeof children === 'string' ? children : '',
      onSave: onEditChange,
      onCancel: onEditCancel,
      onEnd: editConfig.onEnd,
      prefixCls: prefixCls,
      className: className,
      style: style,
      direction: direction,
      component: component,
      maxLength: editConfig.maxLength,
      autoSize: editConfig.autoSize,
      enterIcon: editConfig.enterIcon
    });
  }
  // >>>>>>>>>>> Typography
  // Expand
  const renderExpand = () => {
    const {
      expandable,
      symbol
    } = ellipsisConfig;
    return expandable ? (/*#__PURE__*/react.createElement("button", {
      type: "button",
      key: "expand",
      className: `${prefixCls}-${expanded ? 'collapse' : 'expand'}`,
      onClick: e => onExpandClick(e, {
        expanded: !expanded
      }),
      "aria-label": expanded ? textLocale.collapse : textLocale === null || textLocale === void 0 ? void 0 : textLocale.expand
    }, typeof symbol === 'function' ? symbol(expanded) : symbol)) : null;
  };
  // Edit
  const renderEdit = () => {
    if (!enableEdit) {
      return;
    }
    const {
      icon,
      tooltip,
      tabIndex
    } = editConfig;
    const editTitle = (0,toArray/* default */.A)(tooltip)[0] || (textLocale === null || textLocale === void 0 ? void 0 : textLocale.edit);
    const ariaLabel = typeof editTitle === 'string' ? editTitle : '';
    return triggerType.includes('icon') ? (/*#__PURE__*/react.createElement(es_tooltip/* default */.A, {
      key: "edit",
      title: tooltip === false ? '' : editTitle
    }, /*#__PURE__*/react.createElement("button", {
      type: "button",
      ref: editIconRef,
      className: `${prefixCls}-edit`,
      onClick: onEditClick,
      "aria-label": ariaLabel,
      tabIndex: tabIndex
    }, icon || /*#__PURE__*/react.createElement(icons_EditOutlined, {
      role: "button"
    })))) : null;
  };
  // Copy
  const renderCopy = () => {
    if (!enableCopy) {
      return null;
    }
    return /*#__PURE__*/react.createElement(Base_CopyBtn, Object.assign({
      key: "copy"
    }, copyConfig, {
      prefixCls: prefixCls,
      copied: copied,
      locale: textLocale,
      onCopy: onCopyClick,
      loading: copyLoading,
      iconOnly: children === null || children === undefined
    }));
  };
  const renderOperations = canEllipsis => [canEllipsis && renderExpand(), renderEdit(), renderCopy()];
  const renderEllipsis = canEllipsis => [canEllipsis && !expanded && (/*#__PURE__*/react.createElement("span", {
    "aria-hidden": true,
    key: "ellipsis"
  }, ELLIPSIS_STR)), ellipsisConfig.suffix, renderOperations(canEllipsis)];
  return /*#__PURE__*/react.createElement(rc_resize_observer_es/* default */.A, {
    onResize: onResize,
    disabled: !mergedEnableEllipsis
  }, resizeRef => (/*#__PURE__*/react.createElement(Base_EllipsisTooltip, {
    tooltipProps: tooltipProps,
    enableEllipsis: mergedEnableEllipsis,
    isEllipsis: isMergedEllipsis
  }, /*#__PURE__*/react.createElement(typography_Typography, Object.assign({
    className: classnames_default()({
      [`${prefixCls}-${type}`]: type,
      [`${prefixCls}-disabled`]: disabled,
      [`${prefixCls}-ellipsis`]: enableEllipsis,
      [`${prefixCls}-ellipsis-single-line`]: cssTextOverflow,
      [`${prefixCls}-ellipsis-multiple-line`]: cssLineClamp
    }, className),
    prefixCls: customizePrefixCls,
    style: Object.assign(Object.assign({}, style), {
      WebkitLineClamp: cssLineClamp ? rows : undefined
    }),
    component: component,
    ref: (0,es_ref/* composeRef */.K4)(resizeRef, typographyRef, ref),
    direction: direction,
    onClick: triggerType.includes('text') ? onEditClick : undefined,
    "aria-label": topAriaLabel === null || topAriaLabel === void 0 ? void 0 : topAriaLabel.toString(),
    title: title
  }, textProps), /*#__PURE__*/react.createElement(EllipsisMeasure, {
    enableMeasure: mergedEnableEllipsis && !cssEllipsis,
    text: children,
    rows: rows,
    width: ellipsisWidth,
    onEllipsis: onJsEllipsis,
    expanded: expanded,
    miscDeps: [copied, expanded, copyLoading, enableEdit, enableCopy, textLocale]
  }, (node, canEllipsis) => wrapperDecorations(props, /*#__PURE__*/react.createElement(react.Fragment, null, node.length > 0 && canEllipsis && !expanded && topAriaLabel ? (/*#__PURE__*/react.createElement("span", {
    key: "show-content",
    "aria-hidden": true
  }, node)) : node, renderEllipsis(canEllipsis))))))));
});
/* harmony default export */ var typography_Base = (Base);
;// ./node_modules/antd/es/typography/Link.js
"use client";

var Link_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};



const Link = /*#__PURE__*/react.forwardRef((_a, ref) => {
  var {
      ellipsis,
      rel
    } = _a,
    restProps = Link_rest(_a, ["ellipsis", "rel"]);
  if (false) {}
  const mergedProps = Object.assign(Object.assign({}, restProps), {
    rel: rel === undefined && restProps.target === '_blank' ? 'noopener noreferrer' : rel
  });
  // @ts-expect-error: https://github.com/ant-design/ant-design/issues/26622
  delete mergedProps.navigate;
  return /*#__PURE__*/react.createElement(typography_Base, Object.assign({}, mergedProps, {
    ref: ref,
    ellipsis: !!ellipsis,
    component: "a"
  }));
});
/* harmony default export */ var typography_Link = (Link);
;// ./node_modules/antd/es/typography/Paragraph.js
"use client";



const Paragraph = /*#__PURE__*/react.forwardRef((props, ref) => (/*#__PURE__*/react.createElement(typography_Base, Object.assign({
  ref: ref
}, props, {
  component: "div"
}))));
/* harmony default export */ var typography_Paragraph = (Paragraph);
;// ./node_modules/antd/es/typography/Text.js
"use client";

var Text_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};




const Text = (_a, ref) => {
  var {
      ellipsis
    } = _a,
    restProps = Text_rest(_a, ["ellipsis"]);
  const mergedEllipsis = react.useMemo(() => {
    if (ellipsis && typeof ellipsis === 'object') {
      return (0,omit/* default */.A)(ellipsis, ['expandable', 'rows']);
    }
    return ellipsis;
  }, [ellipsis]);
  if (false) {}
  return /*#__PURE__*/react.createElement(typography_Base, Object.assign({
    ref: ref
  }, restProps, {
    ellipsis: mergedEllipsis,
    component: "span"
  }));
};
/* harmony default export */ var typography_Text = (/*#__PURE__*/react.forwardRef(Text));
;// ./node_modules/antd/es/typography/Title.js
"use client";

var Title_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};



const TITLE_ELE_LIST = [1, 2, 3, 4, 5];
const Title = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      level = 1
    } = props,
    restProps = Title_rest(props, ["level"]);
  if (false) {}
  const component = TITLE_ELE_LIST.includes(level) ? `h${level}` : `h1`;
  return /*#__PURE__*/react.createElement(typography_Base, Object.assign({
    ref: ref
  }, restProps, {
    component: component
  }));
});
/* harmony default export */ var typography_Title = (Title);
;// ./node_modules/antd/es/typography/index.js
"use client";






const es_typography_Typography = typography_Typography;
es_typography_Typography.Text = typography_Text;
es_typography_Typography.Link = typography_Link;
es_typography_Typography.Title = typography_Title;
es_typography_Typography.Paragraph = typography_Paragraph;
/* harmony default export */ var typography = (es_typography_Typography);
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
;// ./src/pages/settings/UsageAnalyticsPage.tsx









/** 管理端统计统一按北京时间展示（与服务器/用户本机时区无关）。 */
const ANALYTICS_DISPLAY_TZ = "Asia/Shanghai";

/**
 * 后端常见：ISO 串无 Z / 无时区后缀，但实际存的是 UTC。浏览器会把无后缀 ISO 当「本地时间」，会偏 8h。
 * 无显式时区时按 UTC 解析，再交给 toLocaleString 换到北京时间。
 */
function parseAnalyticsInstant(raw) {
  let s = String(raw).trim();
  if (!s) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    s = s.replace(" ", "T");
  }
  const hasExplicitZone = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  if (hasExplicitZone) {
    return new Date(s);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return new Date(s + "Z");
  }
  return new Date(s);
}
function formatAnalyticsDateTime(raw) {
  if (raw == null || raw === "") return "";
  const d = parseAnalyticsInstant(String(raw));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: ANALYTICS_DISPLAY_TZ
  });
}

/** 图表只展示后端已解析出显示名的智能体；agent_name 为空则不入图。 */
function hasResolvedAgentName(agentName) {
  return agentName != null && String(agentName).trim().length > 0;
}
function beijingDayKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ANALYTICS_DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ms));
}
function computeDashboardStats(overview) {
  if (!overview) return null;
  const usageEvents = overview.usage_events || [];
  const sessions = overview.sessions_per_user || [];
  const runs = overview.runs_per_user || [];
  const topAgents = overview.top_agents_by_usage_records || [];
  const userIds = new Set();
  const agentIds = new Set();
  let totalUseCount = 0;
  for (const row of usageEvents) {
    var _row$use_count;
    if (row.user_id) userIds.add(String(row.user_id));
    if (row.agent_id) agentIds.add(String(row.agent_id));
    totalUseCount += Math.max(0, Number((_row$use_count = row.use_count) !== null && _row$use_count !== void 0 ? _row$use_count : 0) || 0);
  }
  for (const row of sessions) {
    if (row.user_id) userIds.add(String(row.user_id));
  }
  for (const row of runs) {
    if (row.user_id) userIds.add(String(row.user_id));
  }
  for (const row of topAgents) {
    if (row.agent_id) agentIds.add(String(row.agent_id));
  }
  const totalSessions = sessions.reduce((sum, row) => sum + (Number(row.session_count) || 0), 0);
  const totalRuns = runs.reduce((sum, row) => sum + (Number(row.run_count) || 0), 0);
  return {
    activeUsers: userIds.size,
    activeAgents: agentIds.size,
    totalSessions,
    totalRuns,
    usageRecords: usageEvents.length,
    totalUseCount
  };
}
const CHART_HEIGHT = {
  row: 300,
  trend: 420
};
const USAGE_TREND_WINDOW_DAYS = 7;
const RECENT_TODAY_FEED_LIMIT = 20;
const TOP_AGENTS_CHART_LIMIT = 8;
const TOP_USERS_CHART_LIMIT = 10;
const DashboardStatCard = _ref => {
  let {
    label,
    value,
    hint
  } = _ref;
  return /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-stat"
  }, /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-stat-label"
  }, label), /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-stat-value"
  }, value), hint ? /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-stat-hint"
  }, hint) : null);
};
const ChartCard = _ref2 => {
  let {
    title,
    caption,
    badge,
    height,
    wide,
    className,
    headerExtra,
    loading,
    children
  } = _ref2;
  return /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-chart-card" + (wide ? " usage-analytics-chart-card--wide" : "") + (className ? " " + className : "")
  }, /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-chart-card-head"
  }, /*#__PURE__*/react.createElement("div", {
    className: "min-w-0 flex-1"
  }, /*#__PURE__*/react.createElement("h3", {
    className: "usage-analytics-chart-card-title"
  }, title), caption ? /*#__PURE__*/react.createElement("p", {
    className: "usage-analytics-chart-card-caption"
  }, caption) : null), /*#__PURE__*/react.createElement("div", {
    className: "flex shrink-0 flex-wrap items-center justify-end gap-2"
  }, headerExtra, badge ? /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-chart-card-badge"
  }, badge) : null)), /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-chart-card-body relative",
    style: {
      height
    }
  }, loading ? /*#__PURE__*/react.createElement("div", {
    className: "absolute inset-0 z-10 flex items-center justify-center bg-[#07060d]/60"
  }, /*#__PURE__*/react.createElement(spin/* default */.A, {
    size: "small"
  })) : null, children));
};
const ANALYTICS_CHART_COLORS = {
  axisMuted: "rgba(168, 85, 247, 0.28)",
  splitMuted: "rgba(124, 58, 237, 0.12)",
  labelColor: "#a78bfa",
  tipTitle: "#f5f3ff",
  tipBody: "#ddd6fe",
  accent: "#a855f7",
  accentBright: "#c084fc",
  gradient: ["#1e0533", "#4c1d95", "#7c3aed", "#9333ea", "#a855f7", "#c084fc", "#e879f9"]
};
const AnalyticsShell = _ref3 => {
  let {
    children
  } = _ref3;
  return /*#__PURE__*/react.createElement(config_provider/* default */.Ay, {
    theme: {
      algorithm: theme/* default */.A.darkAlgorithm,
      token: {
        colorPrimary: "#a855f7",
        colorBgContainer: "#120c1c",
        colorBgElevated: "#1a1028",
        colorBorder: "rgba(168, 85, 247, 0.22)",
        colorText: "#ede9fe",
        colorTextSecondary: "rgba(196, 181, 253, 0.65)",
        borderRadius: 12
      }
    }
  }, /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-shell relative h-full min-h-0 flex flex-col overflow-auto bg-[#07060d] text-purple-100/90"
  }, /*#__PURE__*/react.createElement("div", {
    className: "pointer-events-none absolute inset-0 overflow-hidden"
  }, /*#__PURE__*/react.createElement("div", {
    className: "absolute -top-28 -left-24 h-[28rem] w-[28rem] rounded-full bg-purple-600/18 blur-3xl"
  }), /*#__PURE__*/react.createElement("div", {
    className: "absolute top-1/4 -right-16 h-80 w-80 rounded-full bg-violet-500/12 blur-3xl"
  }), /*#__PURE__*/react.createElement("div", {
    className: "absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-fuchsia-600/10 blur-3xl"
  }), /*#__PURE__*/react.createElement("div", {
    className: "absolute inset-0 opacity-[0.35]",
    style: {
      backgroundImage: "radial-gradient(circle at 1px 1px, rgba(168,85,247,0.08) 1px, transparent 0)",
      backgroundSize: "28px 28px"
    }
  })), /*#__PURE__*/react.createElement("div", {
    className: "relative z-10 flex min-h-0 flex-1 flex-col p-4 md:p-6"
  }, children)));
};
function beijingTodayKey() {
  return beijingDayKey(Date.now());
}
function formatAnalyticsTimeOnly(raw) {
  const d = parseAnalyticsInstant(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: ANALYTICS_DISPLAY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/** 今日有效调用：按 Session（user + agent_mode_config）在北京日历日内创建计次。 */
function computeTodayStats(overview) {
  var _sessionStats$today_k, _sessionStats$recent_, _sessionStats$dau, _sessionStats$session, _sessionStats$session2;
  if (!(overview !== null && overview !== void 0 && overview.today_session_stats)) return null;
  const sessionStats = overview.today_session_stats;
  const todayKey = (_sessionStats$today_k = sessionStats.today_key) !== null && _sessionStats$today_k !== void 0 ? _sessionStats$today_k : beijingTodayKey();
  const recentEvents = ((_sessionStats$recent_ = sessionStats.recent_by_user_agent) !== null && _sessionStats$recent_ !== void 0 ? _sessionStats$recent_ : []).slice(0, RECENT_TODAY_FEED_LIMIT).map(row => {
    var _row$session_count;
    return {
      time: formatAnalyticsTimeOnly(row.latest_created_at),
      agentName: hasResolvedAgentName(row.agent_name) ? String(row.agent_name).trim() : "—",
      userId: String(row.user_id || "—"),
      useCount: Math.max(1, Number((_row$session_count = row.session_count) !== null && _row$session_count !== void 0 ? _row$session_count : 0) || 0)
    };
  });
  return {
    todayKey,
    dau: (_sessionStats$dau = sessionStats.dau) !== null && _sessionStats$dau !== void 0 ? _sessionStats$dau : 0,
    usagePairs: (_sessionStats$session = sessionStats.session_count) !== null && _sessionStats$session !== void 0 ? _sessionStats$session : 0,
    newSessions: (_sessionStats$session2 = sessionStats.session_count) !== null && _sessionStats$session2 !== void 0 ? _sessionStats$session2 : 0,
    recentEvents
  };
}
function formatTrendDayLabel(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
  if (!m) return dayKey;
  return m[2] + "-" + m[3];
}
/** UMD/`echarts$` webpack bundle exposes API on `default` or top-level depending on tooling. */
function getEchartsFromImport(mod) {
  var _root$default;
  const root = mod;
  const candidate = (_root$default = root.default) !== null && _root$default !== void 0 ? _root$default : root;
  const init = candidate.init;
  if (typeof init !== "function") {
    throw new Error("echarts: expected init() on dynamic import module");
  }
  return candidate;
}
function buildUsageDailyTrendLineOption(ordered) {
  const {
    axisMuted,
    splitMuted,
    labelColor,
    tipTitle,
    tipBody,
    accentBright
  } = ANALYTICS_CHART_COLORS;
  const dayLabels = ordered.map(r => formatTrendDayLabel(r.day_key));
  const agentSeries = ordered.map(r => {
    var _r$agent_session_coun;
    return Math.max(0, Number((_r$agent_session_coun = r.agent_session_count) !== null && _r$agent_session_coun !== void 0 ? _r$agent_session_coun : 0) || 0);
  });
  const userSeries = ordered.map(r => {
    var _r$active_user_count;
    return Math.max(0, Number((_r$active_user_count = r.active_user_count) !== null && _r$active_user_count !== void 0 ? _r$active_user_count : 0) || 0);
  });
  return {
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: "system-ui, 'Segoe UI', sans-serif"
    },
    title: {
      show: false
    },
    legend: {
      top: 4,
      right: 8,
      textStyle: {
        color: labelColor,
        fontSize: 11
      },
      itemWidth: 18,
      itemHeight: 8,
      itemGap: 16
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
        lineStyle: {
          color: "rgba(168, 85, 247, 0.45)",
          width: 1
        }
      },
      borderWidth: 0,
      padding: 0,
      extraCssText: "box-shadow:0 12px 40px rgba(76,29,149,0.35);border-radius:12px;overflow:hidden;",
      backgroundColor: "rgba(12, 8, 20, 0.96)",
      formatter: params => {
        var _first$dataIndex, _agentSeries$idx, _userSeries$idx;
        const arr = Array.isArray(params) ? params : [params];
        const first = arr[0];
        const idx = (_first$dataIndex = first === null || first === void 0 ? void 0 : first.dataIndex) !== null && _first$dataIndex !== void 0 ? _first$dataIndex : 0;
        const row = ordered[idx];
        if (!row) return "";
        const agentVal = (_agentSeries$idx = agentSeries[idx]) !== null && _agentSeries$idx !== void 0 ? _agentSeries$idx : 0;
        const userVal = (_userSeries$idx = userSeries[idx]) !== null && _userSeries$idx !== void 0 ? _userSeries$idx : 0;
        return "<div style=\"max-width:320px;line-height:1.5;border:1px solid " + accentBright + ";border-radius:12px;overflow:hidden\">\n<div style=\"padding:10px 12px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(168,85,247,0.15));border-bottom:1px solid rgba(168,85,247,0.25)\">\n<div style=\"font-weight:700;font-size:13px;color:" + tipTitle + "\">" + row.day_key + "\uFF08\u5317\u4EAC\uFF09</div>\n</div>\n<div style=\"padding:10px 12px;color:" + tipBody + "\">\n<div>\u667A\u80FD\u4F53\u8C03\u7528\uFF1A<b style=\"color:" + accentBright + "\">" + agentVal + "</b></div>\n<div style=\"margin-top:6px\">\u7528\u6237\u4F7F\u7528\uFF08\u6D3B\u8DC3\u4EBA\u6570\uFF09\uFF1A<b style=\"color:#e879f9\">" + userVal + "</b></div>\n</div>\n</div>";
      }
    },
    grid: {
      left: "4%",
      right: "4%",
      bottom: 36,
      top: 44,
      containLabel: true
    },
    xAxis: {
      type: "category",
      data: dayLabels,
      name: "日期",
      nameTextStyle: {
        color: labelColor,
        fontSize: 11
      },
      axisLine: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisTick: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisLabel: {
        color: labelColor,
        fontVariantNumeric: "tabular-nums"
      },
      splitLine: {
        show: true,
        lineStyle: {
          type: "dashed",
          color: splitMuted
        }
      }
    },
    yAxis: {
      type: "value",
      name: "数量",
      minInterval: 1,
      nameTextStyle: {
        color: labelColor,
        fontSize: 11
      },
      axisLine: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisTick: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisLabel: {
        color: labelColor,
        fontVariantNumeric: "tabular-nums"
      },
      splitLine: {
        lineStyle: {
          type: "dashed",
          color: splitMuted
        }
      }
    },
    series: [{
      name: "智能体调用",
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 7,
      data: agentSeries,
      lineStyle: {
        width: 2.5,
        color: accentBright
      },
      itemStyle: {
        color: accentBright,
        borderColor: "rgba(233, 213, 255, 0.35)",
        borderWidth: 1
      },
      areaStyle: {
        color: {
          type: "linear",
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [{
            offset: 0,
            color: "rgba(192, 132, 252, 0.28)"
          }, {
            offset: 1,
            color: "rgba(124, 58, 237, 0.02)"
          }]
        }
      },
      emphasis: {
        focus: "series"
      },
      animationDuration: 480,
      animationEasing: "cubicOut"
    }, {
      name: "用户使用",
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 7,
      data: userSeries,
      lineStyle: {
        width: 2.5,
        color: "#e879f9"
      },
      itemStyle: {
        color: "#e879f9",
        borderColor: "rgba(233, 213, 255, 0.35)",
        borderWidth: 1
      },
      areaStyle: {
        color: {
          type: "linear",
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [{
            offset: 0,
            color: "rgba(232, 121, 249, 0.22)"
          }, {
            offset: 1,
            color: "rgba(124, 58, 237, 0.02)"
          }]
        }
      },
      emphasis: {
        focus: "series"
      },
      animationDuration: 480,
      animationEasing: "cubicOut"
    }]
  };
}

/** 近 7 日按北京日历日：智能体会话数 vs 活跃用户数。 */
const UsageDailyTrendLineChart = _ref4 => {
  let {
    loading,
    rows
  } = _ref4;
  const hostRef = (0,react.useRef)(null);
  const chartRef = (0,react.useRef)(null);
  const ordered = (0,react.useMemo)(() => (0,toConsumableArray/* default */.A)(rows).sort((a, b) => String(a.day_key).localeCompare(String(b.day_key), "en", {
    numeric: true
  })), [rows]);
  const hasAnyActivity = (0,react.useMemo)(() => ordered.some(r => {
    var _r$agent_session_coun2, _r$active_user_count2;
    return (Number((_r$agent_session_coun2 = r.agent_session_count) !== null && _r$agent_session_coun2 !== void 0 ? _r$agent_session_coun2 : 0) || 0) > 0 || (Number((_r$active_user_count2 = r.active_user_count) !== null && _r$active_user_count2 !== void 0 ? _r$active_user_count2 : 0) || 0) > 0;
  }), [ordered]);
  (0,react.useEffect)(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    let alive = true;
    const onResize = () => {
      var _chartRef$current;
      return (_chartRef$current = chartRef.current) === null || _chartRef$current === void 0 ? void 0 : _chartRef$current.resize();
    };
    void __webpack_require__.e(/* import() | echarts */ 1902).then(__webpack_require__.t.bind(__webpack_require__, 17549, 23)).then(mod => {
      if (!alive || !hostRef.current) return;
      const ec = getEchartsFromImport(mod);
      chartRef.current = ec.init(hostRef.current);
      window.addEventListener("resize", onResize);
      if (ordered.length > 0) {
        chartRef.current.setOption(buildUsageDailyTrendLineOption(ordered), true);
      }
    });
    return () => {
      var _chartRef$current2;
      alive = false;
      window.removeEventListener("resize", onResize);
      (_chartRef$current2 = chartRef.current) === null || _chartRef$current2 === void 0 ? void 0 : _chartRef$current2.dispose();
      chartRef.current = null;
    };
  }, []);
  (0,react.useEffect)(() => {
    const chart = chartRef.current;
    if (!chart || ordered.length === 0) return;
    chart.setOption(buildUsageDailyTrendLineOption(ordered), true);
  }, [ordered]);
  (0,react.useEffect)(() => {
    var _chartRef$current3;
    if (!loading) (_chartRef$current3 = chartRef.current) === null || _chartRef$current3 === void 0 ? void 0 : _chartRef$current3.resize();
  }, [loading, ordered]);
  if (!loading && ordered.length === 0) {
    return /*#__PURE__*/react.createElement("span", {
      className: "usage-analytics-muted text-sm"
    }, "\u6682\u65E0\u8FD1 ", USAGE_TREND_WINDOW_DAYS, " \u65E5\u8D8B\u52BF\u6570\u636E");
  }
  if (!loading && !hasAnyActivity) {
    return /*#__PURE__*/react.createElement("span", {
      className: "usage-analytics-muted text-sm"
    }, "\u8FD1 ", USAGE_TREND_WINDOW_DAYS, " \u65E5\u5185\u6682\u65E0\u6709\u6548\u4F1A\u8BDD\u8BB0\u5F55\u3002");
  }
  return /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-panel relative h-full w-full overflow-hidden"
  }, /*#__PURE__*/react.createElement("div", {
    ref: hostRef,
    className: "relative z-[1] h-full w-full"
  }));
};
function buildTopAgentsBarOption(ordered) {
  const {
    axisMuted,
    splitMuted,
    labelColor,
    tipTitle,
    tipBody,
    accentBright
  } = ANALYTICS_CHART_COLORS;
  return {
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: "system-ui, 'Segoe UI', sans-serif"
    },
    title: {
      show: false
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
        shadowStyle: {
          color: "rgba(168, 85, 247, 0.18)"
        }
      },
      borderWidth: 0,
      padding: 0,
      extraCssText: "box-shadow:0 12px 40px rgba(76,29,149,0.35);border-radius:12px;overflow:hidden;",
      backgroundColor: "rgba(12, 8, 20, 0.96)",
      formatter: params => {
        var _first$dataIndex2;
        const arr = Array.isArray(params) ? params : [params];
        const first = arr[0];
        const idx = (_first$dataIndex2 = first === null || first === void 0 ? void 0 : first.dataIndex) !== null && _first$dataIndex2 !== void 0 ? _first$dataIndex2 : 0;
        const row = ordered[idx];
        if (!row) return "";
        const title = String(row.agent_name).trim();
        const rank = ordered.length - idx;
        return "<div style=\"max-width:400px;line-height:1.5;border:1px solid " + accentBright + ";border-radius:12px;overflow:hidden\">\n<div style=\"padding:10px 12px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(168,85,247,0.15));border-bottom:1px solid rgba(168,85,247,0.25)\">\n<div style=\"font-size:10px;opacity:.85;color:" + tipTitle + ";letter-spacing:.06em;font-weight:500\">\u6392\u540D <b>#" + rank + "</b></div>\n<div style=\"font-weight:700;font-size:13px;color:" + tipTitle + ";margin-top:6px\">" + title + "</div>\n<div style=\"font-size:11px;font-family:monospace;opacity:.85;word-break:break-all;margin-top:6px;color:" + tipTitle + "\">" + row.agent_id + "</div>\n</div>\n<div style=\"padding:10px 12px;color:" + tipBody + "\">\n<div>\u4F1A\u8BDD\u6570\uFF1A<b style=\"color:" + accentBright + "\">" + row.total_use_count_records + "</b></div>\n</div>\n</div>";
      }
    },
    grid: {
      left: "2%",
      right: "14%",
      bottom: 8,
      top: 8,
      containLabel: true
    },
    xAxis: {
      type: "value",
      name: "",
      nameTextStyle: {
        color: labelColor,
        fontSize: 10
      },
      axisLine: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisTick: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisLabel: {
        color: labelColor,
        fontVariantNumeric: "tabular-nums"
      },
      splitLine: {
        lineStyle: {
          type: "dashed",
          color: splitMuted
        }
      }
    },
    yAxis: {
      type: "category",
      data: ordered.map(r => String(r.agent_name).trim()),
      axisLine: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        width: 200,
        overflow: "truncate",
        interval: 0,
        color: labelColor
      },
      splitLine: {
        show: true,
        lineStyle: {
          type: "dashed",
          color: splitMuted
        }
      }
    },
    series: [{
      type: "bar",
      data: ordered.map(r => r.total_use_count_records),
      barCategoryGap: "28%",
      barMaxWidth: 28,
      showBackground: true,
      backgroundStyle: {
        color: "rgba(124, 58, 237, 0.08)",
        borderRadius: [0, 10, 10, 0]
      },
      itemStyle: {
        borderRadius: [0, 8, 8, 0],
        color: accentBright,
        borderColor: "rgba(233, 213, 255, 0.2)",
        borderWidth: 1
      },
      emphasis: {
        focus: "self"
      },
      label: {
        show: true,
        position: "right",
        formatter: "{c}",
        color: labelColor,
        fontSize: 10,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums"
      },
      animationDuration: 400,
      animationEasing: "cubicOut"
    }]
  };
}
const TopAgentsUsageBarChart = _ref5 => {
  let {
    loading,
    rows
  } = _ref5;
  const hostRef = (0,react.useRef)(null);
  const chartRef = (0,react.useRef)(null);
  const rowsWithName = (0,react.useMemo)(() => rows.filter(r => hasResolvedAgentName(r.agent_name)).slice(0, TOP_AGENTS_CHART_LIMIT), [rows]);
  const ordered = (0,react.useMemo)(() => (0,toConsumableArray/* default */.A)(rowsWithName).reverse(), [rowsWithName]);
  (0,react.useEffect)(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    let alive = true;
    const onResize = () => {
      var _chartRef$current4;
      return (_chartRef$current4 = chartRef.current) === null || _chartRef$current4 === void 0 ? void 0 : _chartRef$current4.resize();
    };
    void __webpack_require__.e(/* import() | echarts */ 1902).then(__webpack_require__.t.bind(__webpack_require__, 17549, 23)).then(mod => {
      if (!alive || !hostRef.current) return;
      const ec = getEchartsFromImport(mod);
      chartRef.current = ec.init(hostRef.current);
      window.addEventListener("resize", onResize);
      if (ordered.length > 0) {
        chartRef.current.setOption(buildTopAgentsBarOption(ordered), true);
      }
    });
    return () => {
      var _chartRef$current5;
      alive = false;
      window.removeEventListener("resize", onResize);
      (_chartRef$current5 = chartRef.current) === null || _chartRef$current5 === void 0 ? void 0 : _chartRef$current5.dispose();
      chartRef.current = null;
    };
  }, []);
  (0,react.useEffect)(() => {
    const chart = chartRef.current;
    if (!chart || ordered.length === 0) return;
    chart.setOption(buildTopAgentsBarOption(ordered), true);
  }, [ordered]);
  (0,react.useEffect)(() => {
    var _chartRef$current6;
    if (!loading) (_chartRef$current6 = chartRef.current) === null || _chartRef$current6 === void 0 ? void 0 : _chartRef$current6.resize();
  }, [loading, ordered]);
  if (!loading && rows.length > 0 && rowsWithName.length === 0) {
    return /*#__PURE__*/react.createElement("span", {
      className: "usage-analytics-muted text-sm"
    }, "\u5F53\u524D\u70ED\u95E8\u699C\u6837\u672C\u4E2D\u6682\u65E0\u5DF2\u89E3\u6790\u663E\u793A\u540D\u7684\u667A\u80FD\u4F53\uFF1B\u672A\u80FD\u89E3\u6790\u540D\u79F0\u7684\u6761\u76EE\u5DF2\u9690\u85CF\uFF0C\u89E3\u6790\u5B8C\u6210\u540E\u5237\u65B0\u5373\u53EF\u3002");
  }
  if (!loading && rows.length === 0) {
    return /*#__PURE__*/react.createElement("span", {
      className: "usage-analytics-muted text-sm"
    }, "\u6682\u65E0\u70ED\u95E8\u667A\u80FD\u4F53\u6570\u636E");
  }
  return /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-panel relative h-full w-full overflow-hidden"
  }, /*#__PURE__*/react.createElement("div", {
    ref: hostRef,
    className: "relative z-[1] h-full w-full"
  }));
};
function buildUserSessionsBarOption(chartRows) {
  const {
    axisMuted,
    splitMuted,
    labelColor,
    tipTitle,
    tipBody,
    accentBright
  } = ANALYTICS_CHART_COLORS;
  return {
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: "system-ui, 'Segoe UI', sans-serif"
    },
    title: {
      show: false
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
        shadowStyle: {
          color: "rgba(168, 85, 247, 0.18)"
        }
      },
      borderWidth: 0,
      padding: 0,
      extraCssText: "box-shadow:0 12px 40px rgba(76,29,149,0.35);border-radius:12px;overflow:hidden;",
      backgroundColor: "rgba(12, 8, 20, 0.96)",
      formatter: params => {
        var _first$dataIndex3;
        const arr = Array.isArray(params) ? params : [params];
        const first = arr[0];
        const idx = (_first$dataIndex3 = first === null || first === void 0 ? void 0 : first.dataIndex) !== null && _first$dataIndex3 !== void 0 ? _first$dataIndex3 : 0;
        const row = chartRows[idx];
        if (!row) return "";
        const rank = chartRows.length - idx;
        return "<div style=\"max-width:400px;line-height:1.5;border:1px solid " + accentBright + ";border-radius:12px;overflow:hidden\">\n<div style=\"padding:10px 12px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(168,85,247,0.15));border-bottom:1px solid rgba(168,85,247,0.25)\">\n<div style=\"font-size:10px;opacity:.85;color:" + tipTitle + ";letter-spacing:.06em;font-weight:500\">\u6392\u540D <b>#" + rank + "</b></div>\n<div style=\"font-size:11px;font-family:monospace;word-break:break-all;margin-top:6px;color:" + tipTitle + "\">" + row.user_id + "</div>\n</div>\n<div style=\"padding:10px 12px;color:" + tipBody + "\">\n<div>\u4F1A\u8BDD\u6570\uFF1A<b style=\"color:" + accentBright + "\">" + row.session_count + "</b></div>\n</div>\n</div>";
      }
    },
    grid: {
      left: "2%",
      right: "14%",
      bottom: 8,
      top: 8,
      containLabel: true
    },
    xAxis: {
      type: "value",
      name: "",
      nameTextStyle: {
        color: labelColor,
        fontSize: 10
      },
      axisLine: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisTick: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisLabel: {
        color: labelColor,
        fontVariantNumeric: "tabular-nums"
      },
      splitLine: {
        lineStyle: {
          type: "dashed",
          color: splitMuted
        }
      }
    },
    yAxis: {
      type: "category",
      data: chartRows.map(r => r.user_id),
      axisLine: {
        lineStyle: {
          color: axisMuted
        }
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        width: 220,
        overflow: "truncate",
        interval: 0,
        color: labelColor,
        fontFamily: "ui-monospace, monospace",
        fontSize: 10
      },
      splitLine: {
        show: true,
        lineStyle: {
          type: "dashed",
          color: splitMuted
        }
      }
    },
    series: [{
      type: "bar",
      data: chartRows.map(r => r.session_count),
      barCategoryGap: "28%",
      barMaxWidth: 24,
      showBackground: true,
      backgroundStyle: {
        color: "rgba(124, 58, 237, 0.08)",
        borderRadius: [0, 10, 10, 0]
      },
      itemStyle: {
        borderRadius: [0, 8, 8, 0],
        color: accentBright,
        borderColor: "rgba(233, 213, 255, 0.2)",
        borderWidth: 1
      },
      emphasis: {
        focus: "self"
      },
      label: {
        show: true,
        position: "right",
        formatter: "{c}",
        color: labelColor,
        fontSize: 10,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums"
      },
      animationDuration: 400,
      animationEasing: "cubicOut"
    }]
  };
}
const UserSessionsBarChart = _ref6 => {
  let {
    loading,
    rows
  } = _ref6;
  const hostRef = (0,react.useRef)(null);
  const chartRef = (0,react.useRef)(null);
  const ordered = (0,react.useMemo)(() => (0,toConsumableArray/* default */.A)(rows).sort((a, b) => b.session_count - a.session_count).slice(0, TOP_USERS_CHART_LIMIT), [rows]);
  const chartRows = (0,react.useMemo)(() => (0,toConsumableArray/* default */.A)(ordered).reverse(), [ordered]);
  (0,react.useEffect)(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    let alive = true;
    const onResize = () => {
      var _chartRef$current7;
      return (_chartRef$current7 = chartRef.current) === null || _chartRef$current7 === void 0 ? void 0 : _chartRef$current7.resize();
    };
    void __webpack_require__.e(/* import() | echarts */ 1902).then(__webpack_require__.t.bind(__webpack_require__, 17549, 23)).then(mod => {
      if (!alive || !hostRef.current) return;
      const ec = getEchartsFromImport(mod);
      chartRef.current = ec.init(hostRef.current);
      window.addEventListener("resize", onResize);
      if (chartRows.length > 0) {
        chartRef.current.setOption(buildUserSessionsBarOption(chartRows), true);
      }
    });
    return () => {
      var _chartRef$current8;
      alive = false;
      window.removeEventListener("resize", onResize);
      (_chartRef$current8 = chartRef.current) === null || _chartRef$current8 === void 0 ? void 0 : _chartRef$current8.dispose();
      chartRef.current = null;
    };
  }, []);
  (0,react.useEffect)(() => {
    const chart = chartRef.current;
    if (!chart || chartRows.length === 0) return;
    chart.setOption(buildUserSessionsBarOption(chartRows), true);
  }, [chartRows]);
  (0,react.useEffect)(() => {
    var _chartRef$current9;
    if (!loading) (_chartRef$current9 = chartRef.current) === null || _chartRef$current9 === void 0 ? void 0 : _chartRef$current9.resize();
  }, [loading, chartRows]);
  if (!loading && rows.length === 0) {
    return /*#__PURE__*/react.createElement("span", {
      className: "usage-analytics-muted text-sm"
    }, "\u6682\u65E0\u7528\u6237\u4F1A\u8BDD\u6570\u636E");
  }
  return /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-panel relative h-full w-full overflow-hidden"
  }, /*#__PURE__*/react.createElement("div", {
    ref: hostRef,
    className: "relative z-[1] h-full w-full"
  }));
};
const UsageRankingCard = _ref7 => {
  let {
    loading,
    agentRows,
    sessionRows
  } = _ref7;
  const {
    0: tab,
    1: setTab
  } = (0,react.useState)("agents");
  const caption = tab === "agents" ? "Top " + TOP_AGENTS_CHART_LIMIT + " \xB7 \u7D2F\u8BA1 use_count\uFF08\u5168\u7528\u6237\u6C47\u603B\uFF09" : "Top " + TOP_USERS_CHART_LIMIT + " \xB7 \u4F1A\u8BDD\u6570\uFF08\u6309 user \u6C47\u603B\uFF09";
  return /*#__PURE__*/react.createElement(ChartCard, {
    title: "\u4F7F\u7528\u6392\u884C",
    caption: caption,
    height: CHART_HEIGHT.row,
    loading: loading,
    headerExtra: /*#__PURE__*/react.createElement(segmented, {
      size: "small",
      value: tab,
      onChange: v => setTab(v),
      options: [{
        label: "智能体",
        value: "agents"
      }, {
        label: "用户",
        value: "users"
      }]
    })
  }, tab === "agents" ? /*#__PURE__*/react.createElement(TopAgentsUsageBarChart, {
    key: "rank-agents",
    loading: loading,
    rows: agentRows
  }) : /*#__PURE__*/react.createElement(UserSessionsBarChart, {
    key: "rank-users",
    loading: loading,
    rows: sessionRows
  }));
};
const TodayLivePanel = _ref8 => {
  var _stats$dau, _stats$usagePairs, _stats$newSessions, _stats$recentEvents;
  let {
    loading,
    stats
  } = _ref8;
  if (!loading && !stats) {
    return /*#__PURE__*/react.createElement("span", {
      className: "usage-analytics-muted text-sm"
    }, "\u6682\u65E0\u4ECA\u65E5\u6570\u636E");
  }
  const emptyToday = !loading && stats && stats.dau === 0 && stats.usagePairs === 0 && stats.newSessions === 0;
  const dauChip = loading ? "—" : (_stats$dau = stats === null || stats === void 0 ? void 0 : stats.dau) !== null && _stats$dau !== void 0 ? _stats$dau : 0;
  const checkInChip = loading ? "—" : (_stats$usagePairs = stats === null || stats === void 0 ? void 0 : stats.usagePairs) !== null && _stats$usagePairs !== void 0 ? _stats$usagePairs : 0;
  const newSessionsChip = loading ? "—" : (_stats$newSessions = stats === null || stats === void 0 ? void 0 : stats.newSessions) !== null && _stats$newSessions !== void 0 ? _stats$newSessions : 0;
  return /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-today"
  }, /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-today-head flex flex-wrap items-center gap-2"
  }, /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-chart-card-badge"
  }, "DAU ", dauChip), /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-chart-card-badge"
  }, "\u6253\u5361 ", checkInChip), /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-chart-card-badge"
  }, "\u65B0\u4F1A\u8BDD ", newSessionsChip)), emptyToday ? /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-today-empty"
  }, /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-muted text-sm"
  }, "\u4ECA\u65E5\u6682\u65E0\u6D3B\u52A8\u8BB0\u5F55\uFF0C\u70B9\u51FB\u53F3\u4E0A\u89D2\u5237\u65B0\u83B7\u53D6\u6700\u65B0\u6570\u636E")) : /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-today-feed"
  }, /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-today-section-title"
  }, "\u6700\u8FD1\u6253\u5361"), !loading && stats && stats.recentEvents.length === 0 ? /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-muted text-sm"
  }, "\u4ECA\u65E5\u6682\u65E0\u6253\u5361") : /*#__PURE__*/react.createElement("ul", {
    className: "usage-analytics-today-feed-list"
  }, ((_stats$recentEvents = stats === null || stats === void 0 ? void 0 : stats.recentEvents) !== null && _stats$recentEvents !== void 0 ? _stats$recentEvents : []).map((item, idx) => /*#__PURE__*/react.createElement("li", {
    key: item.time + "-" + item.userId + "-" + idx,
    className: "usage-analytics-today-feed-item"
  }, /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-today-feed-time"
  }, item.time), /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-today-feed-agent"
  }, item.agentName), /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-today-feed-user"
  }, item.userId), /*#__PURE__*/react.createElement("span", {
    className: "usage-analytics-today-feed-count"
  }, "\xD7", item.useCount))))));
};
const UsageAnalyticsPage = () => {
  var _overview$limits, _todayStats$todayKey;
  const {
    user
  } = (0,react.useContext)(provider/* appContext */.v);
  const uid = (user === null || user === void 0 ? void 0 : user.email) || "";
  const {
    0: isPlatformAdmin,
    1: setIsPlatformAdmin
  } = (0,react.useState)(null);
  const {
    0: overview,
    1: setOverview
  } = (0,react.useState)(null);
  const {
    0: loading,
    1: setLoading
  } = (0,react.useState)(false);
  const {
    0: lastRefreshedAt,
    1: setLastRefreshedAt
  } = (0,react.useState)(null);
  const [msgApi, holder] = message/* default */.Ay.useMessage();
  (0,react.useEffect)(() => {
    let cancelled = false;
    const run = async () => {
      if (!uid) {
        setIsPlatformAdmin(false);
        return;
      }
      try {
        const access = await api/* userAPI */.Eo.getAccess(uid);
        if (!cancelled) setIsPlatformAdmin(!!(access !== null && access !== void 0 && access.is_platform_admin));
      } catch (_unused) {
        if (!cancelled) setIsPlatformAdmin(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [uid]);
  const fetchOverview = (0,react.useCallback)(async opts => {
    if (!uid || !isPlatformAdmin) return;
    setLoading(true);
    try {
      const d = await api/* adminAnalyticsAPI */.Ku.usageOverview(uid);
      setOverview(d);
      setLastRefreshedAt(new Date());
      if (!(opts !== null && opts !== void 0 && opts.quiet)) msgApi.success("已刷新");
    } catch (e) {
      const m = e instanceof Error ? e.message : "加载失败";
      msgApi.error(m);
    } finally {
      setLoading(false);
    }
  }, [uid, isPlatformAdmin, msgApi]);
  (0,react.useEffect)(() => {
    if (isPlatformAdmin === true && uid) {
      void fetchOverview({
        quiet: true
      });
    }
  }, [isPlatformAdmin, uid, fetchOverview]);
  const dashboardStats = (0,react.useMemo)(() => computeDashboardStats(overview), [overview]);
  const todayStats = (0,react.useMemo)(() => computeTodayStats(overview), [overview]);
  const usageDailyTrendRows = (0,react.useMemo)(() => {
    var _overview$usage_daily;
    return (0,toConsumableArray/* default */.A)((_overview$usage_daily = overview === null || overview === void 0 ? void 0 : overview.usage_daily_trends) !== null && _overview$usage_daily !== void 0 ? _overview$usage_daily : []);
  }, [overview]);
  const sampleLimitHint = (overview === null || overview === void 0 ? void 0 : (_overview$limits = overview.limits) === null || _overview$limits === void 0 ? void 0 : _overview$limits.usage_events) != null ? "usage_events \u6837\u672C\u4E0A\u9650 " + overview.limits.usage_events + " \u6761" : null;
  if (isPlatformAdmin === null && uid) {
    return /*#__PURE__*/react.createElement(AnalyticsShell, null, /*#__PURE__*/react.createElement("div", {
      className: "flex flex-1 items-center justify-center p-8"
    }, /*#__PURE__*/react.createElement(spin/* default */.A, {
      size: "large"
    })));
  }
  if (!uid) {
    return /*#__PURE__*/react.createElement(AnalyticsShell, null, holder, /*#__PURE__*/react.createElement(result, {
      status: "warning",
      title: "\u672A\u767B\u5F55"
    }));
  }
  if (!isPlatformAdmin) {
    return /*#__PURE__*/react.createElement(AnalyticsShell, null, holder, /*#__PURE__*/react.createElement(result, {
      status: "403",
      title: "\u65E0\u6743\u9650",
      subTitle: "\u4EC5\u5E73\u53F0\u7BA1\u7406\u5458\u53EF\u67E5\u770B\u4F7F\u7528\u5206\u6790\u6570\u636E\u3002"
    }));
  }
  return /*#__PURE__*/react.createElement(AnalyticsShell, null, holder, /*#__PURE__*/react.createElement("div", {
    className: "mb-5 flex items-start justify-between gap-4"
  }, /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement(typography.Title, {
    level: 4,
    className: "!m-0 !bg-gradient-to-r !from-purple-200 !via-violet-300 !to-fuchsia-300 !bg-clip-text !font-bold !tracking-wide !text-transparent"
  }, "\u4F7F\u7528\u5206\u6790\u770B\u677F"), /*#__PURE__*/react.createElement("p", {
    className: "mt-1.5 text-xs text-purple-300/55"
  }, "\u5E73\u53F0\u667A\u80FD\u4F53\u4F7F\u7528\u5168\u666F \xB7 \u5317\u4EAC\u65F6\u95F4"), lastRefreshedAt ? /*#__PURE__*/react.createElement("p", {
    className: "mt-1 text-[10px] text-purple-400/45"
  }, "\u6570\u636E\u66F4\u65B0\u4E8E ", formatAnalyticsDateTime(lastRefreshedAt.toISOString()), sampleLimitHint ? " \xB7 " + sampleLimitHint : "") : null), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    type: "primary",
    loading: loading,
    onClick: () => void fetchOverview(),
    className: "!border-none !bg-gradient-to-r !from-violet-600 !to-purple-600 !shadow-lg !shadow-purple-900/40 hover:!from-violet-500 hover:!to-purple-500"
  }, "\u5237\u65B0")), !overview && loading ? /*#__PURE__*/react.createElement("div", {
    className: "flex flex-1 items-center justify-center"
  }, /*#__PURE__*/react.createElement(spin/* default */.A, null)) : /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-board pb-2"
  }, dashboardStats ? /*#__PURE__*/react.createElement("div", {
    className: "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
  }, /*#__PURE__*/react.createElement(DashboardStatCard, {
    label: "\u6D3B\u8DC3\u7528\u6237",
    value: dashboardStats.activeUsers,
    hint: "\u6709\u4F7F\u7528/\u4F1A\u8BDD/run \u8BB0\u5F55"
  }), /*#__PURE__*/react.createElement(DashboardStatCard, {
    label: "\u6D3B\u8DC3\u667A\u80FD\u4F53",
    value: dashboardStats.activeAgents,
    hint: "\u88AB\u8C03\u7528\u7684\u667A\u80FD\u4F53\u6570"
  }), /*#__PURE__*/react.createElement(DashboardStatCard, {
    label: "\u603B\u4F1A\u8BDD\u6570",
    value: dashboardStats.totalSessions
  }), /*#__PURE__*/react.createElement(DashboardStatCard, {
    label: "\u603B Run \u6570",
    value: dashboardStats.totalRuns,
    hint: "runs_per_user \u6C47\u603B"
  }), /*#__PURE__*/react.createElement(DashboardStatCard, {
    label: "\u6253\u5361\u8BB0\u5F55",
    value: dashboardStats.usageRecords,
    hint: "usage_events \u6761\u6570"
  }), /*#__PURE__*/react.createElement(DashboardStatCard, {
    label: "\u7D2F\u8BA1 use_count",
    value: dashboardStats.totalUseCount.toLocaleString("zh-CN"),
    hint: "\u6C47\u603B\u8C03\u7528\u6B21\u6570"
  })) : null, /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-charts-grid"
  }, /*#__PURE__*/react.createElement("div", {
    className: "usage-analytics-charts-row-top"
  }, /*#__PURE__*/react.createElement(ChartCard, {
    title: "\u4ECA\u65E5\u5B9E\u51B5",
    caption: "\u5317\u4EAC\u65E5\u5386\u65E5 \xB7 " + ((_todayStats$todayKey = todayStats === null || todayStats === void 0 ? void 0 : todayStats.todayKey) !== null && _todayStats$todayKey !== void 0 ? _todayStats$todayKey : beijingTodayKey()),
    badge: "\u4ECA\u65E5",
    height: CHART_HEIGHT.row,
    className: "usage-analytics-chart-card--today",
    loading: loading
  }, /*#__PURE__*/react.createElement(TodayLivePanel, {
    loading: loading,
    stats: todayStats
  })), /*#__PURE__*/react.createElement(UsageRankingCard, {
    loading: loading,
    agentRows: (0,toConsumableArray/* default */.A)((overview === null || overview === void 0 ? void 0 : overview.top_agents_by_usage_records) || []),
    sessionRows: (0,toConsumableArray/* default */.A)((overview === null || overview === void 0 ? void 0 : overview.sessions_per_user) || [])
  })), /*#__PURE__*/react.createElement(ChartCard, {
    title: "\u8C03\u7528\u8D8B\u52BF",
    caption: "\u6309\u5317\u4EAC\u65E5\u5386\u65E5 \xB7 \u7D2B\u7EBF=\u667A\u80FD\u4F53\u4F1A\u8BDD\u6570 \xB7 \u7C89\u7EBF=\u6D3B\u8DC3\u7528\u6237\u6570",
    badge: "\u8FD1 7 \u65E5",
    height: CHART_HEIGHT.trend,
    wide: true,
    loading: loading
  }, /*#__PURE__*/react.createElement(UsageDailyTrendLineChart, {
    loading: loading,
    rows: usageDailyTrendRows
  })))));
};
/* harmony default export */ var settings_UsageAnalyticsPage = (UsageAnalyticsPage);

/***/ }),

/***/ 16426:
/***/ (function(module) {


module.exports = function () {
  var selection = document.getSelection();
  if (!selection.rangeCount) {
    return function () {};
  }
  var active = document.activeElement;

  var ranges = [];
  for (var i = 0; i < selection.rangeCount; i++) {
    ranges.push(selection.getRangeAt(i));
  }

  switch (active.tagName.toUpperCase()) { // .toUpperCase handles XHTML
    case 'INPUT':
    case 'TEXTAREA':
      active.blur();
      break;

    default:
      active = null;
      break;
  }

  selection.removeAllRanges();
  return function () {
    selection.type === 'Caret' &&
    selection.removeAllRanges();

    if (!selection.rangeCount) {
      ranges.forEach(function(range) {
        selection.addRange(range);
      });
    }

    active &&
    active.focus();
  };
};


/***/ })

}]);
//# sourceMappingURL=e30eda8083752b606032b8e9dc4031ddb36509e7-cbef06290c9ff4cd8076.js.map