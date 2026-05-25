"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[5057],{

/***/ 42877:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ icons_SearchOutlined; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/@ant-design/icons-svg/es/asn/SearchOutlined.js
// This icon file is generated automatically.
var SearchOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M909.6 854.5L649.9 594.8C690.2 542.7 712 479 712 412c0-80.2-31.3-155.4-87.9-212.1-56.6-56.7-132-87.9-212.1-87.9s-155.5 31.3-212.1 87.9C143.2 256.5 112 331.8 112 412c0 80.1 31.3 155.5 87.9 212.1C256.5 680.8 331.8 712 412 712c67 0 130.6-21.8 182.7-62l259.7 259.6a8.2 8.2 0 0011.6 0l43.6-43.5a8.2 8.2 0 000-11.6zM570.4 570.4C528 612.7 471.8 636 412 636s-116-23.3-158.4-65.6C211.3 528 188 471.8 188 412s23.3-116.1 65.6-158.4C296 211.3 352.2 188 412 188s116.1 23.2 158.4 65.6S636 352.2 636 412s-23.3 116.1-65.6 158.4z" } }] }, "name": "search", "theme": "outlined" };
/* harmony default export */ var asn_SearchOutlined = (SearchOutlined);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/SearchOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var SearchOutlined_SearchOutlined = function SearchOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_SearchOutlined
  }));
};

/**![search](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTkwOS42IDg1NC41TDY0OS45IDU5NC44QzY5MC4yIDU0Mi43IDcxMiA0NzkgNzEyIDQxMmMwLTgwLjItMzEuMy0xNTUuNC04Ny45LTIxMi4xLTU2LjYtNTYuNy0xMzItODcuOS0yMTIuMS04Ny45cy0xNTUuNSAzMS4zLTIxMi4xIDg3LjlDMTQzLjIgMjU2LjUgMTEyIDMzMS44IDExMiA0MTJjMCA4MC4xIDMxLjMgMTU1LjUgODcuOSAyMTIuMUMyNTYuNSA2ODAuOCAzMzEuOCA3MTIgNDEyIDcxMmM2NyAwIDEzMC42LTIxLjggMTgyLjctNjJsMjU5LjcgMjU5LjZhOC4yIDguMiAwIDAwMTEuNiAwbDQzLjYtNDMuNWE4LjIgOC4yIDAgMDAwLTExLjZ6TTU3MC40IDU3MC40QzUyOCA2MTIuNyA0NzEuOCA2MzYgNDEyIDYzNnMtMTE2LTIzLjMtMTU4LjQtNjUuNkMyMTEuMyA1MjggMTg4IDQ3MS44IDE4OCA0MTJzMjMuMy0xMTYuMSA2NS42LTE1OC40QzI5NiAyMTEuMyAzNTIuMiAxODggNDEyIDE4OHMxMTYuMSAyMy4yIDE1OC40IDY1LjZTNjM2IDM1Mi4yIDYzNiA0MTJzLTIzLjMgMTE2LjEtNjUuNiAxNTguNHoiIC8+PC9zdmc+) */
var RefIcon = /*#__PURE__*/react.forwardRef(SearchOutlined_SearchOutlined);
if (false) {}
/* harmony default export */ var icons_SearchOutlined = (RefIcon);

/***/ }),

/***/ 79365:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ input; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/form/context.js
var form_context = __webpack_require__(94241);
// EXTERNAL MODULE: ./node_modules/antd/es/input/style/index.js
var input_style = __webpack_require__(81594);
;// ./node_modules/antd/es/input/Group.js
"use client";








const Group = props => {
  const {
    getPrefixCls,
    direction
  } = (0,react.useContext)(context/* ConfigContext */.QO);
  const {
    prefixCls: customizePrefixCls,
    className
  } = props;
  const prefixCls = getPrefixCls('input-group', customizePrefixCls);
  const inputPrefixCls = getPrefixCls('input');
  const [wrapCSSVar, hashId] = (0,input_style/* default */.Ay)(inputPrefixCls);
  const cls = classnames_default()(prefixCls, {
    [`${prefixCls}-lg`]: props.size === 'large',
    [`${prefixCls}-sm`]: props.size === 'small',
    [`${prefixCls}-compact`]: props.compact,
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, hashId, className);
  const formItemContext = (0,react.useContext)(form_context/* FormItemInputContext */.$W);
  const groupFormItemContext = (0,react.useMemo)(() => Object.assign(Object.assign({}, formItemContext), {
    isFormItemInput: false
  }), [formItemContext]);
  if (false) {}
  return wrapCSSVar(/*#__PURE__*/react.createElement("span", {
    className: cls,
    style: props.style,
    onMouseEnter: props.onMouseEnter,
    onMouseLeave: props.onMouseLeave,
    onFocus: props.onFocus,
    onBlur: props.onBlur
  }, /*#__PURE__*/react.createElement(form_context/* FormItemInputContext */.$W.Provider, {
    value: groupFormItemContext
  }, props.children)));
};
/* harmony default export */ var input_Group = (Group);
// EXTERNAL MODULE: ./node_modules/rc-input/es/index.js + 2 modules
var es = __webpack_require__(48491);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var es_ref = __webpack_require__(8719);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/ContextIsolator.js
var ContextIsolator = __webpack_require__(62897);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/getAllowClear.js
var getAllowClear = __webpack_require__(96311);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/statusUtils.js
var statusUtils = __webpack_require__(58182);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/DisabledContext.js
var DisabledContext = __webpack_require__(98119);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
// EXTERNAL MODULE: ./node_modules/antd/es/form/hooks/useVariants.js
var useVariants = __webpack_require__(90124);
// EXTERNAL MODULE: ./node_modules/antd/es/space/Compact.js
var Compact = __webpack_require__(76327);
;// ./node_modules/antd/es/input/hooks/useRemovePasswordTimeout.js

function useRemovePasswordTimeout(inputRef, triggerOnMount) {
  const removePasswordTimeoutRef = (0,react.useRef)([]);
  const removePasswordTimeout = () => {
    removePasswordTimeoutRef.current.push(setTimeout(() => {
      var _a, _b, _c, _d;
      if (((_a = inputRef.current) === null || _a === void 0 ? void 0 : _a.input) && ((_b = inputRef.current) === null || _b === void 0 ? void 0 : _b.input.getAttribute('type')) === 'password' && ((_c = inputRef.current) === null || _c === void 0 ? void 0 : _c.input.hasAttribute('value'))) {
        (_d = inputRef.current) === null || _d === void 0 ? void 0 : _d.input.removeAttribute('value');
      }
    }));
  };
  (0,react.useEffect)(() => {
    if (triggerOnMount) {
      removePasswordTimeout();
    }
    return () => removePasswordTimeoutRef.current.forEach(timer => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }, []);
  return removePasswordTimeout;
}
;// ./node_modules/antd/es/input/utils.js
function hasPrefixSuffix(props) {
  return !!(props.prefix || props.suffix || props.allowClear || props.showCount);
}
;// ./node_modules/antd/es/input/Input.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};




















const Input = /*#__PURE__*/(0,react.forwardRef)((props, ref) => {
  var _a;
  const {
      prefixCls: customizePrefixCls,
      bordered = true,
      status: customStatus,
      size: customSize,
      disabled: customDisabled,
      onBlur,
      onFocus,
      suffix,
      allowClear,
      addonAfter,
      addonBefore,
      className,
      style,
      styles,
      rootClassName,
      onChange,
      classNames: classes,
      variant: customVariant
    } = props,
    rest = __rest(props, ["prefixCls", "bordered", "status", "size", "disabled", "onBlur", "onFocus", "suffix", "allowClear", "addonAfter", "addonBefore", "className", "style", "styles", "rootClassName", "onChange", "classNames", "variant"]);
  if (false) {}
  const {
    getPrefixCls,
    direction,
    input
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('input', customizePrefixCls);
  const inputRef = (0,react.useRef)(null);
  // Style
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = (0,input_style/* default */.Ay)(prefixCls, rootCls);
  // ===================== Compact Item =====================
  const {
    compactSize,
    compactItemClassnames
  } = (0,Compact/* useCompactItemContext */.RQ)(prefixCls, direction);
  // ===================== Size =====================
  const mergedSize = (0,useSize/* default */.A)(ctx => {
    var _a;
    return (_a = customSize !== null && customSize !== void 0 ? customSize : compactSize) !== null && _a !== void 0 ? _a : ctx;
  });
  // ===================== Disabled =====================
  const disabled = react.useContext(DisabledContext/* default */.A);
  const mergedDisabled = customDisabled !== null && customDisabled !== void 0 ? customDisabled : disabled;
  // ===================== Status =====================
  const {
    status: contextStatus,
    hasFeedback,
    feedbackIcon
  } = (0,react.useContext)(form_context/* FormItemInputContext */.$W);
  const mergedStatus = (0,statusUtils/* getMergedStatus */.v)(contextStatus, customStatus);
  // ===================== Focus warning =====================
  const inputHasPrefixSuffix = hasPrefixSuffix(props) || !!hasFeedback;
  const prevHasPrefixSuffix = (0,react.useRef)(inputHasPrefixSuffix);
  /* eslint-disable react-hooks/rules-of-hooks */
  if (false) {}
  /* eslint-enable */
  // ===================== Remove Password value =====================
  const removePasswordTimeout = useRemovePasswordTimeout(inputRef, true);
  const handleBlur = e => {
    removePasswordTimeout();
    onBlur === null || onBlur === void 0 ? void 0 : onBlur(e);
  };
  const handleFocus = e => {
    removePasswordTimeout();
    onFocus === null || onFocus === void 0 ? void 0 : onFocus(e);
  };
  const handleChange = e => {
    removePasswordTimeout();
    onChange === null || onChange === void 0 ? void 0 : onChange(e);
  };
  const suffixNode = (hasFeedback || suffix) && (/*#__PURE__*/react.createElement(react.Fragment, null, suffix, hasFeedback && feedbackIcon));
  const mergedAllowClear = (0,getAllowClear/* default */.A)(allowClear !== null && allowClear !== void 0 ? allowClear : input === null || input === void 0 ? void 0 : input.allowClear);
  const [variant, enableVariantCls] = (0,useVariants/* default */.A)('input', customVariant, bordered);
  return wrapCSSVar(/*#__PURE__*/react.createElement(es/* default */.A, Object.assign({
    ref: (0,es_ref/* composeRef */.K4)(ref, inputRef),
    prefixCls: prefixCls,
    autoComplete: input === null || input === void 0 ? void 0 : input.autoComplete
  }, rest, {
    disabled: mergedDisabled,
    onBlur: handleBlur,
    onFocus: handleFocus,
    style: Object.assign(Object.assign({}, input === null || input === void 0 ? void 0 : input.style), style),
    styles: Object.assign(Object.assign({}, input === null || input === void 0 ? void 0 : input.styles), styles),
    suffix: suffixNode,
    allowClear: mergedAllowClear,
    className: classnames_default()(className, rootClassName, cssVarCls, rootCls, compactItemClassnames, input === null || input === void 0 ? void 0 : input.className),
    onChange: handleChange,
    addonBefore: addonBefore && (/*#__PURE__*/react.createElement(ContextIsolator/* default */.A, {
      form: true,
      space: true
    }, addonBefore)),
    addonAfter: addonAfter && (/*#__PURE__*/react.createElement(ContextIsolator/* default */.A, {
      form: true,
      space: true
    }, addonAfter)),
    classNames: Object.assign(Object.assign(Object.assign({}, classes), input === null || input === void 0 ? void 0 : input.classNames), {
      input: classnames_default()({
        [`${prefixCls}-sm`]: mergedSize === 'small',
        [`${prefixCls}-lg`]: mergedSize === 'large',
        [`${prefixCls}-rtl`]: direction === 'rtl'
      }, classes === null || classes === void 0 ? void 0 : classes.input, (_a = input === null || input === void 0 ? void 0 : input.classNames) === null || _a === void 0 ? void 0 : _a.input, hashId),
      variant: classnames_default()({
        [`${prefixCls}-${variant}`]: enableVariantCls
      }, (0,statusUtils/* getStatusClassNames */.L)(prefixCls, mergedStatus)),
      affixWrapper: classnames_default()({
        [`${prefixCls}-affix-wrapper-sm`]: mergedSize === 'small',
        [`${prefixCls}-affix-wrapper-lg`]: mergedSize === 'large',
        [`${prefixCls}-affix-wrapper-rtl`]: direction === 'rtl'
      }, hashId),
      wrapper: classnames_default()({
        [`${prefixCls}-group-rtl`]: direction === 'rtl'
      }, hashId),
      groupWrapper: classnames_default()({
        [`${prefixCls}-group-wrapper-sm`]: mergedSize === 'small',
        [`${prefixCls}-group-wrapper-lg`]: mergedSize === 'large',
        [`${prefixCls}-group-wrapper-rtl`]: direction === 'rtl',
        [`${prefixCls}-group-wrapper-${variant}`]: enableVariantCls
      }, (0,statusUtils/* getStatusClassNames */.L)(`${prefixCls}-group-wrapper`, mergedStatus, hasFeedback), hashId)
    })
  })));
});
if (false) {}
/* harmony default export */ var input_Input = (Input);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useEvent.js
var useEvent = __webpack_require__(26956);
// EXTERNAL MODULE: ./node_modules/rc-util/es/pickAttrs.js
var pickAttrs = __webpack_require__(72065);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
// EXTERNAL MODULE: ./node_modules/antd/es/input/style/token.js
var style_token = __webpack_require__(44335);
;// ./node_modules/antd/es/input/style/otp.js


// =============================== OTP ================================
const genOTPStyle = token => {
  const {
    componentCls,
    paddingXS
  } = token;
  return {
    [componentCls]: {
      display: 'inline-flex',
      alignItems: 'center',
      flexWrap: 'nowrap',
      columnGap: paddingXS,
      '&-rtl': {
        direction: 'rtl'
      },
      [`${componentCls}-input`]: {
        textAlign: 'center',
        paddingInline: token.paddingXXS
      },
      // ================= Size =================
      [`&${componentCls}-sm ${componentCls}-input`]: {
        paddingInline: token.calc(token.paddingXXS).div(2).equal()
      },
      [`&${componentCls}-lg ${componentCls}-input`]: {
        paddingInline: token.paddingXS
      }
    }
  };
};
// ============================== Export ==============================
/* harmony default export */ var otp = ((0,genStyleUtils/* genStyleHooks */.OF)(['Input', 'OTP'], token => {
  const inputToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, (0,style_token/* initInputToken */.C)(token));
  return [genOTPStyle(inputToken)];
}, style_token/* initComponentToken */.b));
// EXTERNAL MODULE: ./node_modules/rc-util/es/raf.js
var raf = __webpack_require__(25371);
;// ./node_modules/antd/es/input/OTP/OTPInput.js
"use client";

var OTPInput_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};



const OTPInput = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      value,
      onChange,
      onActiveChange,
      index,
      mask
    } = props,
    restProps = OTPInput_rest(props, ["value", "onChange", "onActiveChange", "index", "mask"]);
  const internalValue = value && typeof mask === 'string' ? mask : value;
  const onInternalChange = e => {
    onChange(index, e.target.value);
  };
  // ========================== Ref ===========================
  const inputRef = react.useRef(null);
  react.useImperativeHandle(ref, () => inputRef.current);
  // ========================= Focus ==========================
  const syncSelection = () => {
    (0,raf/* default */.A)(() => {
      var _a;
      const inputEle = (_a = inputRef.current) === null || _a === void 0 ? void 0 : _a.input;
      if (document.activeElement === inputEle && inputEle) {
        inputEle.select();
      }
    });
  };
  // ======================== Keyboard ========================
  const onInternalKeyDown = event => {
    const {
      key,
      ctrlKey,
      metaKey
    } = event;
    if (key === 'ArrowLeft') {
      onActiveChange(index - 1);
    } else if (key === 'ArrowRight') {
      onActiveChange(index + 1);
    } else if (key === 'z' && (ctrlKey || metaKey)) {
      event.preventDefault();
    }
    syncSelection();
  };
  const onInternalKeyUp = e => {
    if (e.key === 'Backspace' && !value) {
      onActiveChange(index - 1);
    }
    syncSelection();
  };
  // ========================= Render =========================
  return /*#__PURE__*/react.createElement(input_Input, Object.assign({
    type: mask === true ? 'password' : 'text'
  }, restProps, {
    ref: inputRef,
    value: internalValue,
    onInput: onInternalChange,
    onFocus: syncSelection,
    onKeyDown: onInternalKeyDown,
    onKeyUp: onInternalKeyUp,
    onMouseDown: syncSelection,
    onMouseUp: syncSelection
  }));
});
/* harmony default export */ var OTP_OTPInput = (OTPInput);
;// ./node_modules/antd/es/input/OTP/index.js
"use client";


var OTP_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};












function strToArr(str) {
  return (str || '').split('');
}
const OTP = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      prefixCls: customizePrefixCls,
      length = 6,
      size: customSize,
      defaultValue,
      value,
      onChange,
      formatter,
      variant,
      disabled,
      status: customStatus,
      autoFocus,
      mask,
      type,
      onInput,
      inputMode
    } = props,
    restProps = OTP_rest(props, ["prefixCls", "length", "size", "defaultValue", "value", "onChange", "formatter", "variant", "disabled", "status", "autoFocus", "mask", "type", "onInput", "inputMode"]);
  if (false) {}
  const {
    getPrefixCls,
    direction
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('otp', customizePrefixCls);
  const domAttrs = (0,pickAttrs/* default */.A)(restProps, {
    aria: true,
    data: true,
    attr: true
  });
  // ========================= Root =========================
  // Style
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = otp(prefixCls, rootCls);
  // ========================= Size =========================
  const mergedSize = (0,useSize/* default */.A)(ctx => customSize !== null && customSize !== void 0 ? customSize : ctx);
  // ======================== Status ========================
  const formContext = react.useContext(form_context/* FormItemInputContext */.$W);
  const mergedStatus = (0,statusUtils/* getMergedStatus */.v)(formContext.status, customStatus);
  const proxyFormContext = react.useMemo(() => Object.assign(Object.assign({}, formContext), {
    status: mergedStatus,
    hasFeedback: false,
    feedbackIcon: null
  }), [formContext, mergedStatus]);
  // ========================= Refs =========================
  const containerRef = react.useRef(null);
  const refs = react.useRef({});
  react.useImperativeHandle(ref, () => ({
    focus: () => {
      var _a;
      (_a = refs.current[0]) === null || _a === void 0 ? void 0 : _a.focus();
    },
    blur: () => {
      var _a;
      for (let i = 0; i < length; i += 1) {
        (_a = refs.current[i]) === null || _a === void 0 ? void 0 : _a.blur();
      }
    },
    nativeElement: containerRef.current
  }));
  // ======================= Formatter ======================
  const internalFormatter = txt => formatter ? formatter(txt) : txt;
  // ======================== Values ========================
  const [valueCells, setValueCells] = react.useState(strToArr(internalFormatter(defaultValue || '')));
  react.useEffect(() => {
    if (value !== undefined) {
      setValueCells(strToArr(value));
    }
  }, [value]);
  const triggerValueCellsChange = (0,useEvent/* default */.A)(nextValueCells => {
    setValueCells(nextValueCells);
    if (onInput) {
      onInput(nextValueCells);
    }
    // Trigger if all cells are filled
    if (onChange && nextValueCells.length === length && nextValueCells.every(c => c) && nextValueCells.some((c, index) => valueCells[index] !== c)) {
      onChange(nextValueCells.join(''));
    }
  });
  const patchValue = (0,useEvent/* default */.A)((index, txt) => {
    let nextCells = (0,toConsumableArray/* default */.A)(valueCells);
    // Fill cells till index
    for (let i = 0; i < index; i += 1) {
      if (!nextCells[i]) {
        nextCells[i] = '';
      }
    }
    if (txt.length <= 1) {
      nextCells[index] = txt;
    } else {
      nextCells = nextCells.slice(0, index).concat(strToArr(txt));
    }
    nextCells = nextCells.slice(0, length);
    // Clean the last empty cell
    for (let i = nextCells.length - 1; i >= 0; i -= 1) {
      if (nextCells[i]) {
        break;
      }
      nextCells.pop();
    }
    // Format if needed
    const formattedValue = internalFormatter(nextCells.map(c => c || ' ').join(''));
    nextCells = strToArr(formattedValue).map((c, i) => {
      if (c === ' ' && !nextCells[i]) {
        return nextCells[i];
      }
      return c;
    });
    return nextCells;
  });
  // ======================== Change ========================
  const onInputChange = (index, txt) => {
    var _a;
    const nextCells = patchValue(index, txt);
    const nextIndex = Math.min(index + txt.length, length - 1);
    if (nextIndex !== index && nextCells[index] !== undefined) {
      (_a = refs.current[nextIndex]) === null || _a === void 0 ? void 0 : _a.focus();
    }
    triggerValueCellsChange(nextCells);
  };
  const onInputActiveChange = nextIndex => {
    var _a;
    (_a = refs.current[nextIndex]) === null || _a === void 0 ? void 0 : _a.focus();
  };
  // ======================== Render ========================
  const inputSharedProps = {
    variant,
    disabled,
    status: mergedStatus,
    mask,
    type,
    inputMode
  };
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", Object.assign({}, domAttrs, {
    ref: containerRef,
    className: classnames_default()(prefixCls, {
      [`${prefixCls}-sm`]: mergedSize === 'small',
      [`${prefixCls}-lg`]: mergedSize === 'large',
      [`${prefixCls}-rtl`]: direction === 'rtl'
    }, cssVarCls, hashId)
  }), /*#__PURE__*/react.createElement(form_context/* FormItemInputContext */.$W.Provider, {
    value: proxyFormContext
  }, Array.from({
    length
  }).map((_, index) => {
    const key = `otp-${index}`;
    const singleValue = valueCells[index] || '';
    return /*#__PURE__*/react.createElement(OTP_OTPInput, Object.assign({
      ref: inputEle => {
        refs.current[index] = inputEle;
      },
      key: key,
      index: index,
      size: mergedSize,
      htmlSize: 1,
      className: `${prefixCls}-input`,
      onChange: onInputChange,
      value: singleValue,
      onActiveChange: onInputActiveChange,
      autoFocus: index === 0 && autoFocus
    }, inputSharedProps));
  }))));
});
/* harmony default export */ var input_OTP = (OTP);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
;// ./node_modules/@ant-design/icons-svg/es/asn/EyeInvisibleOutlined.js
// This icon file is generated automatically.
var EyeInvisibleOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M942.2 486.2Q889.47 375.11 816.7 305l-50.88 50.88C807.31 395.53 843.45 447.4 874.7 512 791.5 684.2 673.4 766 512 766q-72.67 0-133.87-22.38L323 798.75Q408 838 512 838q288.3 0 430.2-300.3a60.29 60.29 0 000-51.5zm-63.57-320.64L836 122.88a8 8 0 00-11.32 0L715.31 232.2Q624.86 186 512 186q-288.3 0-430.2 300.3a60.3 60.3 0 000 51.5q56.69 119.4 136.5 191.41L112.48 835a8 8 0 000 11.31L155.17 889a8 8 0 0011.31 0l712.15-712.12a8 8 0 000-11.32zM149.3 512C232.6 339.8 350.7 258 512 258c54.54 0 104.13 9.36 149.12 28.39l-70.3 70.3a176 176 0 00-238.13 238.13l-83.42 83.42C223.1 637.49 183.3 582.28 149.3 512zm246.7 0a112.11 112.11 0 01146.2-106.69L401.31 546.2A112 112 0 01396 512z" } }, { "tag": "path", "attrs": { "d": "M508 624c-3.46 0-6.87-.16-10.25-.47l-52.82 52.82a176.09 176.09 0 00227.42-227.42l-52.82 52.82c.31 3.38.47 6.79.47 10.25a111.94 111.94 0 01-112 112z" } }] }, "name": "eye-invisible", "theme": "outlined" };
/* harmony default export */ var asn_EyeInvisibleOutlined = (EyeInvisibleOutlined);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/EyeInvisibleOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var EyeInvisibleOutlined_EyeInvisibleOutlined = function EyeInvisibleOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_EyeInvisibleOutlined
  }));
};

/**![eye-invisible](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTk0Mi4yIDQ4Ni4yUTg4OS40NyAzNzUuMTEgODE2LjcgMzA1bC01MC44OCA1MC44OEM4MDcuMzEgMzk1LjUzIDg0My40NSA0NDcuNCA4NzQuNyA1MTIgNzkxLjUgNjg0LjIgNjczLjQgNzY2IDUxMiA3NjZxLTcyLjY3IDAtMTMzLjg3LTIyLjM4TDMyMyA3OTguNzVRNDA4IDgzOCA1MTIgODM4cTI4OC4zIDAgNDMwLjItMzAwLjNhNjAuMjkgNjAuMjkgMCAwMDAtNTEuNXptLTYzLjU3LTMyMC42NEw4MzYgMTIyLjg4YTggOCAwIDAwLTExLjMyIDBMNzE1LjMxIDIzMi4yUTYyNC44NiAxODYgNTEyIDE4NnEtMjg4LjMgMC00MzAuMiAzMDAuM2E2MC4zIDYwLjMgMCAwMDAgNTEuNXE1Ni42OSAxMTkuNCAxMzYuNSAxOTEuNDFMMTEyLjQ4IDgzNWE4IDggMCAwMDAgMTEuMzFMMTU1LjE3IDg4OWE4IDggMCAwMDExLjMxIDBsNzEyLjE1LTcxMi4xMmE4IDggMCAwMDAtMTEuMzJ6TTE0OS4zIDUxMkMyMzIuNiAzMzkuOCAzNTAuNyAyNTggNTEyIDI1OGM1NC41NCAwIDEwNC4xMyA5LjM2IDE0OS4xMiAyOC4zOWwtNzAuMyA3MC4zYTE3NiAxNzYgMCAwMC0yMzguMTMgMjM4LjEzbC04My40MiA4My40MkMyMjMuMSA2MzcuNDkgMTgzLjMgNTgyLjI4IDE0OS4zIDUxMnptMjQ2LjcgMGExMTIuMTEgMTEyLjExIDAgMDExNDYuMi0xMDYuNjlMNDAxLjMxIDU0Ni4yQTExMiAxMTIgMCAwMTM5NiA1MTJ6IiAvPjxwYXRoIGQ9Ik01MDggNjI0Yy0zLjQ2IDAtNi44Ny0uMTYtMTAuMjUtLjQ3bC01Mi44MiA1Mi44MmExNzYuMDkgMTc2LjA5IDAgMDAyMjcuNDItMjI3LjQybC01Mi44MiA1Mi44MmMuMzEgMy4zOC40NyA2Ljc5LjQ3IDEwLjI1YTExMS45NCAxMTEuOTQgMCAwMS0xMTIgMTEyeiIgLz48L3N2Zz4=) */
var RefIcon = /*#__PURE__*/react.forwardRef(EyeInvisibleOutlined_EyeInvisibleOutlined);
if (false) {}
/* harmony default export */ var icons_EyeInvisibleOutlined = (RefIcon);
;// ./node_modules/@ant-design/icons-svg/es/asn/EyeOutlined.js
// This icon file is generated automatically.
var EyeOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M942.2 486.2C847.4 286.5 704.1 186 512 186c-192.2 0-335.4 100.5-430.2 300.3a60.3 60.3 0 000 51.5C176.6 737.5 319.9 838 512 838c192.2 0 335.4-100.5 430.2-300.3 7.7-16.2 7.7-35 0-51.5zM512 766c-161.3 0-279.4-81.8-362.7-254C232.6 339.8 350.7 258 512 258c161.3 0 279.4 81.8 362.7 254C791.5 684.2 673.4 766 512 766zm-4-430c-97.2 0-176 78.8-176 176s78.8 176 176 176 176-78.8 176-176-78.8-176-176-176zm0 288c-61.9 0-112-50.1-112-112s50.1-112 112-112 112 50.1 112 112-50.1 112-112 112z" } }] }, "name": "eye", "theme": "outlined" };
/* harmony default export */ var asn_EyeOutlined = (EyeOutlined);

;// ./node_modules/@ant-design/icons/es/icons/EyeOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var EyeOutlined_EyeOutlined = function EyeOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_EyeOutlined
  }));
};

/**![eye](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTk0Mi4yIDQ4Ni4yQzg0Ny40IDI4Ni41IDcwNC4xIDE4NiA1MTIgMTg2Yy0xOTIuMiAwLTMzNS40IDEwMC41LTQzMC4yIDMwMC4zYTYwLjMgNjAuMyAwIDAwMCA1MS41QzE3Ni42IDczNy41IDMxOS45IDgzOCA1MTIgODM4YzE5Mi4yIDAgMzM1LjQtMTAwLjUgNDMwLjItMzAwLjMgNy43LTE2LjIgNy43LTM1IDAtNTEuNXpNNTEyIDc2NmMtMTYxLjMgMC0yNzkuNC04MS44LTM2Mi43LTI1NEMyMzIuNiAzMzkuOCAzNTAuNyAyNTggNTEyIDI1OGMxNjEuMyAwIDI3OS40IDgxLjggMzYyLjcgMjU0Qzc5MS41IDY4NC4yIDY3My40IDc2NiA1MTIgNzY2em0tNC00MzBjLTk3LjIgMC0xNzYgNzguOC0xNzYgMTc2czc4LjggMTc2IDE3NiAxNzYgMTc2LTc4LjggMTc2LTE3Ni03OC44LTE3Ni0xNzYtMTc2em0wIDI4OGMtNjEuOSAwLTExMi01MC4xLTExMi0xMTJzNTAuMS0xMTIgMTEyLTExMiAxMTIgNTAuMSAxMTIgMTEyLTUwLjEgMTEyLTExMiAxMTJ6IiAvPjwvc3ZnPg==) */
var EyeOutlined_RefIcon = /*#__PURE__*/react.forwardRef(EyeOutlined_EyeOutlined);
if (false) {}
/* harmony default export */ var icons_EyeOutlined = (EyeOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
;// ./node_modules/antd/es/input/Password.js
"use client";

var Password_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};











const defaultIconRender = visible => visible ? /*#__PURE__*/react.createElement(icons_EyeOutlined, null) : /*#__PURE__*/react.createElement(icons_EyeInvisibleOutlined, null);
const actionMap = {
  click: 'onClick',
  hover: 'onMouseOver'
};
const Password = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
    disabled: customDisabled,
    action = 'click',
    visibilityToggle = true,
    iconRender = defaultIconRender
  } = props;
  // ===================== Disabled =====================
  const disabled = react.useContext(DisabledContext/* default */.A);
  const mergedDisabled = customDisabled !== null && customDisabled !== void 0 ? customDisabled : disabled;
  const visibilityControlled = typeof visibilityToggle === 'object' && visibilityToggle.visible !== undefined;
  const [visible, setVisible] = (0,react.useState)(() => visibilityControlled ? visibilityToggle.visible : false);
  const inputRef = (0,react.useRef)(null);
  react.useEffect(() => {
    if (visibilityControlled) {
      setVisible(visibilityToggle.visible);
    }
  }, [visibilityControlled, visibilityToggle]);
  // Remove Password value
  const removePasswordTimeout = useRemovePasswordTimeout(inputRef);
  const onVisibleChange = () => {
    if (mergedDisabled) {
      return;
    }
    if (visible) {
      removePasswordTimeout();
    }
    setVisible(prevState => {
      var _a;
      const newState = !prevState;
      if (typeof visibilityToggle === 'object') {
        (_a = visibilityToggle.onVisibleChange) === null || _a === void 0 ? void 0 : _a.call(visibilityToggle, newState);
      }
      return newState;
    });
  };
  const getIcon = prefixCls => {
    const iconTrigger = actionMap[action] || '';
    const icon = iconRender(visible);
    const iconProps = {
      [iconTrigger]: onVisibleChange,
      className: `${prefixCls}-icon`,
      key: 'passwordIcon',
      onMouseDown: e => {
        // Prevent focused state lost
        // https://github.com/ant-design/ant-design/issues/15173
        e.preventDefault();
      },
      onMouseUp: e => {
        // Prevent caret position change
        // https://github.com/ant-design/ant-design/issues/23524
        e.preventDefault();
      }
    };
    return /*#__PURE__*/react.cloneElement(/*#__PURE__*/react.isValidElement(icon) ? icon : /*#__PURE__*/react.createElement("span", null, icon), iconProps);
  };
  const {
      className,
      prefixCls: customizePrefixCls,
      inputPrefixCls: customizeInputPrefixCls,
      size
    } = props,
    restProps = Password_rest(props, ["className", "prefixCls", "inputPrefixCls", "size"]);
  const {
    getPrefixCls
  } = react.useContext(context/* ConfigContext */.QO);
  const inputPrefixCls = getPrefixCls('input', customizeInputPrefixCls);
  const prefixCls = getPrefixCls('input-password', customizePrefixCls);
  const suffixIcon = visibilityToggle && getIcon(prefixCls);
  const inputClassName = classnames_default()(prefixCls, className, {
    [`${prefixCls}-${size}`]: !!size
  });
  const omittedProps = Object.assign(Object.assign({}, (0,omit/* default */.A)(restProps, ['suffix', 'iconRender', 'visibilityToggle'])), {
    type: visible ? 'text' : 'password',
    className: inputClassName,
    prefixCls: inputPrefixCls,
    suffix: suffixIcon
  });
  if (size) {
    omittedProps.size = size;
  }
  return /*#__PURE__*/react.createElement(input_Input, Object.assign({
    ref: (0,es_ref/* composeRef */.K4)(ref, inputRef)
  }, omittedProps));
});
if (false) {}
/* harmony default export */ var input_Password = (Password);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/SearchOutlined.js + 1 modules
var SearchOutlined = __webpack_require__(42877);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/reactNode.js
var reactNode = __webpack_require__(40682);
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
;// ./node_modules/antd/es/input/Search.js
"use client";

var Search_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};










const Search = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      prefixCls: customizePrefixCls,
      inputPrefixCls: customizeInputPrefixCls,
      className,
      size: customizeSize,
      suffix,
      enterButton = false,
      addonAfter,
      loading,
      disabled,
      onSearch: customOnSearch,
      onChange: customOnChange,
      onCompositionStart,
      onCompositionEnd
    } = props,
    restProps = Search_rest(props, ["prefixCls", "inputPrefixCls", "className", "size", "suffix", "enterButton", "addonAfter", "loading", "disabled", "onSearch", "onChange", "onCompositionStart", "onCompositionEnd"]);
  const {
    getPrefixCls,
    direction
  } = react.useContext(context/* ConfigContext */.QO);
  const composedRef = react.useRef(false);
  const prefixCls = getPrefixCls('input-search', customizePrefixCls);
  const inputPrefixCls = getPrefixCls('input', customizeInputPrefixCls);
  const {
    compactSize
  } = (0,Compact/* useCompactItemContext */.RQ)(prefixCls, direction);
  const size = (0,useSize/* default */.A)(ctx => {
    var _a;
    return (_a = customizeSize !== null && customizeSize !== void 0 ? customizeSize : compactSize) !== null && _a !== void 0 ? _a : ctx;
  });
  const inputRef = react.useRef(null);
  const onChange = e => {
    if ((e === null || e === void 0 ? void 0 : e.target) && e.type === 'click' && customOnSearch) {
      customOnSearch(e.target.value, e, {
        source: 'clear'
      });
    }
    customOnChange === null || customOnChange === void 0 ? void 0 : customOnChange(e);
  };
  const onMouseDown = e => {
    var _a;
    if (document.activeElement === ((_a = inputRef.current) === null || _a === void 0 ? void 0 : _a.input)) {
      e.preventDefault();
    }
  };
  const onSearch = e => {
    var _a, _b;
    if (customOnSearch) {
      customOnSearch((_b = (_a = inputRef.current) === null || _a === void 0 ? void 0 : _a.input) === null || _b === void 0 ? void 0 : _b.value, e, {
        source: 'input'
      });
    }
  };
  const onPressEnter = e => {
    if (composedRef.current || loading) {
      return;
    }
    onSearch(e);
  };
  const searchIcon = typeof enterButton === 'boolean' ? /*#__PURE__*/react.createElement(SearchOutlined/* default */.A, null) : null;
  const btnClassName = `${prefixCls}-button`;
  let button;
  const enterButtonAsElement = enterButton || {};
  const isAntdButton = enterButtonAsElement.type && enterButtonAsElement.type.__ANT_BUTTON === true;
  if (isAntdButton || enterButtonAsElement.type === 'button') {
    button = (0,reactNode/* cloneElement */.Ob)(enterButtonAsElement, Object.assign({
      onMouseDown,
      onClick: e => {
        var _a, _b;
        (_b = (_a = enterButtonAsElement === null || enterButtonAsElement === void 0 ? void 0 : enterButtonAsElement.props) === null || _a === void 0 ? void 0 : _a.onClick) === null || _b === void 0 ? void 0 : _b.call(_a, e);
        onSearch(e);
      },
      key: 'enterButton'
    }, isAntdButton ? {
      className: btnClassName,
      size
    } : {}));
  } else {
    button = /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
      className: btnClassName,
      type: enterButton ? 'primary' : undefined,
      size: size,
      disabled: disabled,
      key: "enterButton",
      onMouseDown: onMouseDown,
      onClick: onSearch,
      loading: loading,
      icon: searchIcon
    }, enterButton);
  }
  if (addonAfter) {
    button = [button, (0,reactNode/* cloneElement */.Ob)(addonAfter, {
      key: 'addonAfter'
    })];
  }
  const cls = classnames_default()(prefixCls, {
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-${size}`]: !!size,
    [`${prefixCls}-with-button`]: !!enterButton
  }, className);
  const handleOnCompositionStart = e => {
    composedRef.current = true;
    onCompositionStart === null || onCompositionStart === void 0 ? void 0 : onCompositionStart(e);
  };
  const handleOnCompositionEnd = e => {
    composedRef.current = false;
    onCompositionEnd === null || onCompositionEnd === void 0 ? void 0 : onCompositionEnd(e);
  };
  return /*#__PURE__*/react.createElement(input_Input, Object.assign({
    ref: (0,es_ref/* composeRef */.K4)(inputRef, ref),
    onPressEnter: onPressEnter
  }, restProps, {
    size: size,
    onCompositionStart: handleOnCompositionStart,
    onCompositionEnd: handleOnCompositionEnd,
    prefixCls: inputPrefixCls,
    addonAfter: button,
    suffix: suffix,
    onChange: onChange,
    className: cls,
    disabled: disabled
  }));
});
if (false) {}
/* harmony default export */ var input_Search = (Search);
// EXTERNAL MODULE: ./node_modules/antd/es/input/TextArea.js + 4 modules
var TextArea = __webpack_require__(98638);
;// ./node_modules/antd/es/input/index.js
"use client";







const es_input_Input = input_Input;
es_input_Input.Group = input_Group;
es_input_Input.Search = input_Search;
es_input_Input.TextArea = TextArea/* default */.A;
es_input_Input.Password = input_Password;
es_input_Input.OTP = input_OTP;
/* harmony default export */ var input = (es_input_Input);

/***/ })

}]);
//# sourceMappingURL=ada6e772185e98233773ca8fc1a71d9a15118906-3f2bc24d88d9f00b7ef4.js.map