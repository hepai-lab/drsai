"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[4893],{

/***/ 91196:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ es_checkbox; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-checkbox/es/index.js
var es = __webpack_require__(38873);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var es_ref = __webpack_require__(8719);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/wave/index.js + 4 modules
var wave = __webpack_require__(57);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/wave/interface.js
var wave_interface = __webpack_require__(4424);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var config_provider_context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/DisabledContext.js
var DisabledContext = __webpack_require__(98119);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
// EXTERNAL MODULE: ./node_modules/antd/es/form/context.js
var context = __webpack_require__(94241);
;// ./node_modules/antd/es/checkbox/GroupContext.js

const GroupContext = /*#__PURE__*/react.createContext(null);
/* harmony default export */ var checkbox_GroupContext = (GroupContext);
// EXTERNAL MODULE: ./node_modules/antd/es/checkbox/style/index.js
var checkbox_style = __webpack_require__(77391);
// EXTERNAL MODULE: ./node_modules/antd/es/checkbox/useBubbleLock.js
var useBubbleLock = __webpack_require__(96827);
;// ./node_modules/antd/es/checkbox/Checkbox.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};














const InternalCheckbox = (props, ref) => {
  var _a;
  const {
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      children,
      indeterminate = false,
      style,
      onMouseEnter,
      onMouseLeave,
      skipGroup = false,
      disabled
    } = props,
    restProps = __rest(props, ["prefixCls", "className", "rootClassName", "children", "indeterminate", "style", "onMouseEnter", "onMouseLeave", "skipGroup", "disabled"]);
  const {
    getPrefixCls,
    direction,
    checkbox
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const checkboxGroup = react.useContext(checkbox_GroupContext);
  const {
    isFormItemInput
  } = react.useContext(context/* FormItemInputContext */.$W);
  const contextDisabled = react.useContext(DisabledContext/* default */.A);
  const mergedDisabled = (_a = (checkboxGroup === null || checkboxGroup === void 0 ? void 0 : checkboxGroup.disabled) || disabled) !== null && _a !== void 0 ? _a : contextDisabled;
  const prevValue = react.useRef(restProps.value);
  const checkboxRef = react.useRef(null);
  const mergedRef = (0,es_ref/* composeRef */.K4)(ref, checkboxRef);
  if (false) {}
  react.useEffect(() => {
    checkboxGroup === null || checkboxGroup === void 0 ? void 0 : checkboxGroup.registerValue(restProps.value);
  }, []);
  react.useEffect(() => {
    if (skipGroup) {
      return;
    }
    if (restProps.value !== prevValue.current) {
      checkboxGroup === null || checkboxGroup === void 0 ? void 0 : checkboxGroup.cancelValue(prevValue.current);
      checkboxGroup === null || checkboxGroup === void 0 ? void 0 : checkboxGroup.registerValue(restProps.value);
      prevValue.current = restProps.value;
    }
    return () => checkboxGroup === null || checkboxGroup === void 0 ? void 0 : checkboxGroup.cancelValue(restProps.value);
  }, [restProps.value]);
  react.useEffect(() => {
    var _a;
    if ((_a = checkboxRef.current) === null || _a === void 0 ? void 0 : _a.input) {
      checkboxRef.current.input.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  const prefixCls = getPrefixCls('checkbox', customizePrefixCls);
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = (0,checkbox_style/* default */.Ay)(prefixCls, rootCls);
  const checkboxProps = Object.assign({}, restProps);
  if (checkboxGroup && !skipGroup) {
    checkboxProps.onChange = function () {
      if (restProps.onChange) {
        restProps.onChange.apply(restProps, arguments);
      }
      if (checkboxGroup.toggleOption) {
        checkboxGroup.toggleOption({
          label: children,
          value: restProps.value
        });
      }
    };
    checkboxProps.name = checkboxGroup.name;
    checkboxProps.checked = checkboxGroup.value.includes(restProps.value);
  }
  const classString = classnames_default()(`${prefixCls}-wrapper`, {
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-wrapper-checked`]: checkboxProps.checked,
    [`${prefixCls}-wrapper-disabled`]: mergedDisabled,
    [`${prefixCls}-wrapper-in-form-item`]: isFormItemInput
  }, checkbox === null || checkbox === void 0 ? void 0 : checkbox.className, className, rootClassName, cssVarCls, rootCls, hashId);
  const checkboxClass = classnames_default()({
    [`${prefixCls}-indeterminate`]: indeterminate
  }, wave_interface/* TARGET_CLS */.D, hashId);
  // ============================ Event Lock ============================
  const [onLabelClick, onInputClick] = (0,useBubbleLock/* default */.A)(checkboxProps.onClick);
  // ============================== Render ==============================
  return wrapCSSVar(/*#__PURE__*/react.createElement(wave/* default */.A, {
    component: "Checkbox",
    disabled: mergedDisabled
  }, /*#__PURE__*/react.createElement("label", {
    className: classString,
    style: Object.assign(Object.assign({}, checkbox === null || checkbox === void 0 ? void 0 : checkbox.style), style),
    onMouseEnter: onMouseEnter,
    onMouseLeave: onMouseLeave,
    onClick: onLabelClick
  }, /*#__PURE__*/react.createElement(es/* default */.A, Object.assign({}, checkboxProps, {
    onClick: onInputClick,
    prefixCls: prefixCls,
    className: checkboxClass,
    disabled: mergedDisabled,
    ref: mergedRef
  })), children !== undefined && /*#__PURE__*/react.createElement("span", null, children))));
};
const Checkbox = /*#__PURE__*/react.forwardRef(InternalCheckbox);
if (false) {}
/* harmony default export */ var checkbox_Checkbox = (Checkbox);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
;// ./node_modules/antd/es/checkbox/Group.js
"use client";


var Group_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};








const CheckboxGroup = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      defaultValue,
      children,
      options = [],
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      style,
      onChange
    } = props,
    restProps = Group_rest(props, ["defaultValue", "children", "options", "prefixCls", "className", "rootClassName", "style", "onChange"]);
  const {
    getPrefixCls,
    direction
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const [value, setValue] = react.useState(restProps.value || defaultValue || []);
  const [registeredValues, setRegisteredValues] = react.useState([]);
  react.useEffect(() => {
    if ('value' in restProps) {
      setValue(restProps.value || []);
    }
  }, [restProps.value]);
  const memoOptions = react.useMemo(() => options.map(option => {
    if (typeof option === 'string' || typeof option === 'number') {
      return {
        label: option,
        value: option
      };
    }
    return option;
  }), [options]);
  const cancelValue = val => {
    setRegisteredValues(prevValues => prevValues.filter(v => v !== val));
  };
  const registerValue = val => {
    setRegisteredValues(prevValues => [].concat((0,toConsumableArray/* default */.A)(prevValues), [val]));
  };
  const toggleOption = option => {
    const optionIndex = value.indexOf(option.value);
    const newValue = (0,toConsumableArray/* default */.A)(value);
    if (optionIndex === -1) {
      newValue.push(option.value);
    } else {
      newValue.splice(optionIndex, 1);
    }
    if (!('value' in restProps)) {
      setValue(newValue);
    }
    onChange === null || onChange === void 0 ? void 0 : onChange(newValue.filter(val => registeredValues.includes(val)).sort((a, b) => {
      const indexA = memoOptions.findIndex(opt => opt.value === a);
      const indexB = memoOptions.findIndex(opt => opt.value === b);
      return indexA - indexB;
    }));
  };
  const prefixCls = getPrefixCls('checkbox', customizePrefixCls);
  const groupPrefixCls = `${prefixCls}-group`;
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = (0,checkbox_style/* default */.Ay)(prefixCls, rootCls);
  const domProps = (0,omit/* default */.A)(restProps, ['value', 'disabled']);
  const childrenNode = options.length ? memoOptions.map(option => (/*#__PURE__*/react.createElement(checkbox_Checkbox, {
    prefixCls: prefixCls,
    key: option.value.toString(),
    disabled: 'disabled' in option ? option.disabled : restProps.disabled,
    value: option.value,
    checked: value.includes(option.value),
    onChange: option.onChange,
    className: `${groupPrefixCls}-item`,
    style: option.style,
    title: option.title,
    id: option.id,
    required: option.required
  }, option.label))) : children;
  const context = {
    toggleOption,
    value,
    disabled: restProps.disabled,
    name: restProps.name,
    // https://github.com/ant-design/ant-design/issues/16376
    registerValue,
    cancelValue
  };
  const classString = classnames_default()(groupPrefixCls, {
    [`${groupPrefixCls}-rtl`]: direction === 'rtl'
  }, className, rootClassName, cssVarCls, rootCls, hashId);
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", Object.assign({
    className: classString,
    style: style
  }, domProps, {
    ref: ref
  }), /*#__PURE__*/react.createElement(checkbox_GroupContext.Provider, {
    value: context
  }, childrenNode)));
});

/* harmony default export */ var Group = (CheckboxGroup);
;// ./node_modules/antd/es/checkbox/index.js
"use client";



const es_checkbox_Checkbox = checkbox_Checkbox;
es_checkbox_Checkbox.Group = Group;
es_checkbox_Checkbox.__ANT_CHECKBOX = true;
if (false) {}
/* harmony default export */ var es_checkbox = (es_checkbox_Checkbox);

/***/ }),

/***/ 77391:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   gd: function() { return /* binding */ getStyle; }
/* harmony export */ });
/* unused harmony export genCheckboxStyle */
/* harmony import */ var _ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(52187);
/* harmony import */ var _style__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(25905);
/* harmony import */ var _theme_internal__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(14277);
/* harmony import */ var _theme_internal__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(37358);



// ============================== Styles ==============================
const genCheckboxStyle = token => {
  const {
    checkboxCls
  } = token;
  const wrapperCls = `${checkboxCls}-wrapper`;
  return [
  // ===================== Basic =====================
  {
    // Group
    [`${checkboxCls}-group`]: Object.assign(Object.assign({}, (0,_style__WEBPACK_IMPORTED_MODULE_1__/* .resetComponent */ .dF)(token)), {
      display: 'inline-flex',
      flexWrap: 'wrap',
      columnGap: token.marginXS,
      // Group > Grid
      [`> ${token.antCls}-row`]: {
        flex: 1
      }
    }),
    // Wrapper
    [wrapperCls]: Object.assign(Object.assign({}, (0,_style__WEBPACK_IMPORTED_MODULE_1__/* .resetComponent */ .dF)(token)), {
      display: 'inline-flex',
      alignItems: 'baseline',
      cursor: 'pointer',
      // Fix checkbox & radio in flex align #30260
      '&:after': {
        display: 'inline-block',
        width: 0,
        overflow: 'hidden',
        content: "'\\a0'"
      },
      // Checkbox near checkbox
      [`& + ${wrapperCls}`]: {
        marginInlineStart: 0
      },
      [`&${wrapperCls}-in-form-item`]: {
        'input[type="checkbox"]': {
          width: 14,
          // FIXME: magic
          height: 14 // FIXME: magic
        }
      }
    }),
    // Wrapper > Checkbox
    [checkboxCls]: Object.assign(Object.assign({}, (0,_style__WEBPACK_IMPORTED_MODULE_1__/* .resetComponent */ .dF)(token)), {
      position: 'relative',
      whiteSpace: 'nowrap',
      lineHeight: 1,
      cursor: 'pointer',
      borderRadius: token.borderRadiusSM,
      // To make alignment right when `controlHeight` is changed
      // Ref: https://github.com/ant-design/ant-design/issues/41564
      alignSelf: 'center',
      // Wrapper > Checkbox > input
      [`${checkboxCls}-input`]: {
        position: 'absolute',
        // Since baseline align will get additional space offset,
        // we need to move input to top to make it align with text.
        // Ref: https://github.com/ant-design/ant-design/issues/38926#issuecomment-1486137799
        inset: 0,
        zIndex: 1,
        cursor: 'pointer',
        opacity: 0,
        margin: 0,
        [`&:focus-visible + ${checkboxCls}-inner`]: Object.assign({}, (0,_style__WEBPACK_IMPORTED_MODULE_1__/* .genFocusOutline */ .jk)(token))
      },
      // Wrapper > Checkbox > inner
      [`${checkboxCls}-inner`]: {
        boxSizing: 'border-box',
        display: 'block',
        width: token.checkboxSize,
        height: token.checkboxSize,
        direction: 'ltr',
        backgroundColor: token.colorBgContainer,
        border: `${(0,_ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .unit */ .zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
        borderRadius: token.borderRadiusSM,
        borderCollapse: 'separate',
        transition: `all ${token.motionDurationSlow}`,
        '&:after': {
          boxSizing: 'border-box',
          position: 'absolute',
          top: '50%',
          insetInlineStart: '25%',
          display: 'table',
          width: token.calc(token.checkboxSize).div(14).mul(5).equal(),
          height: token.calc(token.checkboxSize).div(14).mul(8).equal(),
          border: `${(0,_ant_design_cssinjs__WEBPACK_IMPORTED_MODULE_0__/* .unit */ .zA)(token.lineWidthBold)} solid ${token.colorWhite}`,
          borderTop: 0,
          borderInlineStart: 0,
          transform: 'rotate(45deg) scale(0) translate(-50%,-50%)',
          opacity: 0,
          content: '""',
          transition: `all ${token.motionDurationFast} ${token.motionEaseInBack}, opacity ${token.motionDurationFast}`
        }
      },
      // Wrapper > Checkbox + Text
      '& + span': {
        paddingInlineStart: token.paddingXS,
        paddingInlineEnd: token.paddingXS
      }
    })
  },
  // ===================== Hover =====================
  {
    // Wrapper & Wrapper > Checkbox
    [`
        ${wrapperCls}:not(${wrapperCls}-disabled),
        ${checkboxCls}:not(${checkboxCls}-disabled)
      `]: {
      [`&:hover ${checkboxCls}-inner`]: {
        borderColor: token.colorPrimary
      }
    },
    [`${wrapperCls}:not(${wrapperCls}-disabled)`]: {
      [`&:hover ${checkboxCls}-checked:not(${checkboxCls}-disabled) ${checkboxCls}-inner`]: {
        backgroundColor: token.colorPrimaryHover,
        borderColor: 'transparent'
      },
      [`&:hover ${checkboxCls}-checked:not(${checkboxCls}-disabled):after`]: {
        borderColor: token.colorPrimaryHover
      }
    }
  },
  // ==================== Checked ====================
  {
    // Wrapper > Checkbox
    [`${checkboxCls}-checked`]: {
      [`${checkboxCls}-inner`]: {
        backgroundColor: token.colorPrimary,
        borderColor: token.colorPrimary,
        '&:after': {
          opacity: 1,
          transform: 'rotate(45deg) scale(1) translate(-50%,-50%)',
          transition: `all ${token.motionDurationMid} ${token.motionEaseOutBack} ${token.motionDurationFast}`
        }
      }
    },
    [`
        ${wrapperCls}-checked:not(${wrapperCls}-disabled),
        ${checkboxCls}-checked:not(${checkboxCls}-disabled)
      `]: {
      [`&:hover ${checkboxCls}-inner`]: {
        backgroundColor: token.colorPrimaryHover,
        borderColor: 'transparent'
      }
    }
  },
  // ================= Indeterminate =================
  {
    [checkboxCls]: {
      '&-indeterminate': {
        // Wrapper > Checkbox > inner
        [`${checkboxCls}-inner`]: {
          backgroundColor: `${token.colorBgContainer} !important`,
          borderColor: `${token.colorBorder} !important`,
          '&:after': {
            top: '50%',
            insetInlineStart: '50%',
            width: token.calc(token.fontSizeLG).div(2).equal(),
            height: token.calc(token.fontSizeLG).div(2).equal(),
            backgroundColor: token.colorPrimary,
            border: 0,
            transform: 'translate(-50%, -50%) scale(1)',
            opacity: 1,
            content: '""'
          }
        },
        // https://github.com/ant-design/ant-design/issues/50074
        [`&:hover ${checkboxCls}-inner`]: {
          backgroundColor: `${token.colorBgContainer} !important`,
          borderColor: `${token.colorPrimary} !important`
        }
      }
    }
  },
  // ==================== Disable ====================
  {
    // Wrapper
    [`${wrapperCls}-disabled`]: {
      cursor: 'not-allowed'
    },
    // Wrapper > Checkbox
    [`${checkboxCls}-disabled`]: {
      // Wrapper > Checkbox > input
      [`&, ${checkboxCls}-input`]: {
        cursor: 'not-allowed',
        // Disabled for native input to enable Tooltip event handler
        // ref: https://github.com/ant-design/ant-design/issues/39822#issuecomment-1365075901
        pointerEvents: 'none'
      },
      // Wrapper > Checkbox > inner
      [`${checkboxCls}-inner`]: {
        background: token.colorBgContainerDisabled,
        borderColor: token.colorBorder,
        '&:after': {
          borderColor: token.colorTextDisabled
        }
      },
      '&:after': {
        display: 'none'
      },
      '& + span': {
        color: token.colorTextDisabled
      },
      [`&${checkboxCls}-indeterminate ${checkboxCls}-inner::after`]: {
        background: token.colorTextDisabled
      }
    }
  }];
};
// ============================== Export ==============================
function getStyle(prefixCls, token) {
  const checkboxToken = (0,_theme_internal__WEBPACK_IMPORTED_MODULE_2__/* .mergeToken */ .oX)(token, {
    checkboxCls: `.${prefixCls}`,
    checkboxSize: token.controlInteractiveSize
  });
  return [genCheckboxStyle(checkboxToken)];
}
/* harmony default export */ __webpack_exports__.Ay = ((0,_theme_internal__WEBPACK_IMPORTED_MODULE_3__/* .genStyleHooks */ .OF)('Checkbox', (token, _ref) => {
  let {
    prefixCls
  } = _ref;
  return [getStyle(prefixCls, token)];
}));

/***/ }),

/***/ 96827:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ useBubbleLock; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var rc_util_es_raf__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(25371);


/**
 * When click on the label,
 * the event will be stopped to prevent the label from being clicked twice.
 * label click -> input click -> label click again
 */
function useBubbleLock(onOriginInputClick) {
  const labelClickLockRef = react__WEBPACK_IMPORTED_MODULE_0__.useRef(null);
  const clearLock = () => {
    rc_util_es_raf__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A.cancel(labelClickLockRef.current);
    labelClickLockRef.current = null;
  };
  const onLabelClick = () => {
    clearLock();
    labelClickLockRef.current = (0,rc_util_es_raf__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)(() => {
      labelClickLockRef.current = null;
    });
  };
  const onInputClick = e => {
    if (labelClickLockRef.current) {
      e.stopPropagation();
      clearLock();
    }
    onOriginInputClick === null || onOriginInputClick === void 0 ? void 0 : onOriginInputClick(e);
  };
  return [onLabelClick, onInputClick];
}

/***/ }),

/***/ 91375:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ es_dropdown; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/RightOutlined.js + 1 modules
var RightOutlined = __webpack_require__(68000);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-dropdown/es/index.js + 4 modules
var es = __webpack_require__(3497);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useEvent.js
var useEvent = __webpack_require__(26956);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/hooks/useZIndex.js
var useZIndex = __webpack_require__(60275);
;// ./node_modules/antd/es/_util/isPrimitive.js
const isPrimitive = value => typeof value !== 'object' && typeof value !== 'function' || value === null;
/* harmony default export */ var _util_isPrimitive = (isPrimitive);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/placements.js
var placements = __webpack_require__(13257);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/PurePanel.js
var PurePanel = __webpack_require__(53425);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/reactNode.js
var reactNode = __webpack_require__(40682);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/warning.js
var _util_warning = __webpack_require__(18877);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/zindexContext.js
var zindexContext = __webpack_require__(72616);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
// EXTERNAL MODULE: ./node_modules/antd/es/menu/index.js + 11 modules
var es_menu = __webpack_require__(25226);
// EXTERNAL MODULE: ./node_modules/antd/es/menu/OverrideContext.js
var OverrideContext = __webpack_require__(96476);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/useToken.js + 2 modules
var useToken = __webpack_require__(11320);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/slide.js
var slide = __webpack_require__(53561);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/move.js
var move = __webpack_require__(24211);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/zoom.js
var zoom = __webpack_require__(99077);
// EXTERNAL MODULE: ./node_modules/antd/es/style/placementArrow.js
var placementArrow = __webpack_require__(95201);
// EXTERNAL MODULE: ./node_modules/antd/es/style/roundedArrow.js
var roundedArrow = __webpack_require__(20791);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
;// ./node_modules/antd/es/dropdown/style/status.js
const genStatusStyle = token => {
  const {
    componentCls,
    menuCls,
    colorError,
    colorTextLightSolid
  } = token;
  const itemCls = `${menuCls}-item`;
  return {
    [`${componentCls}, ${componentCls}-menu-submenu`]: {
      [`${menuCls} ${itemCls}`]: {
        [`&${itemCls}-danger:not(${itemCls}-disabled)`]: {
          color: colorError,
          '&:hover': {
            color: colorTextLightSolid,
            backgroundColor: colorError
          }
        }
      }
    }
  };
};
/* harmony default export */ var style_status = (genStatusStyle);
;// ./node_modules/antd/es/dropdown/style/index.js







// =============================== Base ===============================
const genBaseStyle = token => {
  const {
    componentCls,
    menuCls,
    zIndexPopup,
    dropdownArrowDistance,
    sizePopupArrow,
    antCls,
    iconCls,
    motionDurationMid,
    paddingBlock,
    fontSize,
    dropdownEdgeChildPadding,
    colorTextDisabled,
    fontSizeIcon,
    controlPaddingHorizontal,
    colorBgElevated
  } = token;
  return [{
    [componentCls]: {
      position: 'absolute',
      top: -9999,
      left: {
        _skip_check_: true,
        value: -9999
      },
      zIndex: zIndexPopup,
      display: 'block',
      // A placeholder out of dropdown visible range to avoid close when user moving
      '&::before': {
        position: 'absolute',
        insetBlock: token.calc(sizePopupArrow).div(2).sub(dropdownArrowDistance).equal(),
        // insetInlineStart: -7, // FIXME: Seems not work for hidden element
        zIndex: -9999,
        opacity: 0.0001,
        content: '""'
      },
      // Makes vertical dropdowns have a scrollbar once they become taller than the viewport.
      '&-menu-vertical': {
        maxHeight: '100vh',
        overflowY: 'auto'
      },
      [`&-trigger${antCls}-btn`]: {
        [`& > ${iconCls}-down, & > ${antCls}-btn-icon > ${iconCls}-down`]: {
          fontSize: fontSizeIcon
        }
      },
      [`${componentCls}-wrap`]: {
        position: 'relative',
        [`${antCls}-btn > ${iconCls}-down`]: {
          fontSize: fontSizeIcon
        },
        [`${iconCls}-down::before`]: {
          transition: `transform ${motionDurationMid}`
        }
      },
      [`${componentCls}-wrap-open`]: {
        [`${iconCls}-down::before`]: {
          transform: `rotate(180deg)`
        }
      },
      [`
        &-hidden,
        &-menu-hidden,
        &-menu-submenu-hidden
      `]: {
        display: 'none'
      },
      // =============================================================
      // ==                         Motion                          ==
      // =============================================================
      // When position is not enough for dropdown, the placement will revert.
      // We will handle this with revert motion name.
      [`&${antCls}-slide-down-enter${antCls}-slide-down-enter-active${componentCls}-placement-bottomLeft,
          &${antCls}-slide-down-appear${antCls}-slide-down-appear-active${componentCls}-placement-bottomLeft,
          &${antCls}-slide-down-enter${antCls}-slide-down-enter-active${componentCls}-placement-bottom,
          &${antCls}-slide-down-appear${antCls}-slide-down-appear-active${componentCls}-placement-bottom,
          &${antCls}-slide-down-enter${antCls}-slide-down-enter-active${componentCls}-placement-bottomRight,
          &${antCls}-slide-down-appear${antCls}-slide-down-appear-active${componentCls}-placement-bottomRight`]: {
        animationName: slide/* slideUpIn */.ox
      },
      [`&${antCls}-slide-up-enter${antCls}-slide-up-enter-active${componentCls}-placement-topLeft,
          &${antCls}-slide-up-appear${antCls}-slide-up-appear-active${componentCls}-placement-topLeft,
          &${antCls}-slide-up-enter${antCls}-slide-up-enter-active${componentCls}-placement-top,
          &${antCls}-slide-up-appear${antCls}-slide-up-appear-active${componentCls}-placement-top,
          &${antCls}-slide-up-enter${antCls}-slide-up-enter-active${componentCls}-placement-topRight,
          &${antCls}-slide-up-appear${antCls}-slide-up-appear-active${componentCls}-placement-topRight`]: {
        animationName: slide/* slideDownIn */.nP
      },
      [`&${antCls}-slide-down-leave${antCls}-slide-down-leave-active${componentCls}-placement-bottomLeft,
          &${antCls}-slide-down-leave${antCls}-slide-down-leave-active${componentCls}-placement-bottom,
          &${antCls}-slide-down-leave${antCls}-slide-down-leave-active${componentCls}-placement-bottomRight`]: {
        animationName: slide/* slideUpOut */.vR
      },
      [`&${antCls}-slide-up-leave${antCls}-slide-up-leave-active${componentCls}-placement-topLeft,
          &${antCls}-slide-up-leave${antCls}-slide-up-leave-active${componentCls}-placement-top,
          &${antCls}-slide-up-leave${antCls}-slide-up-leave-active${componentCls}-placement-topRight`]: {
        animationName: slide/* slideDownOut */.YU
      }
    }
  },
  // =============================================================
  // ==                        Arrow style                      ==
  // =============================================================
  (0,placementArrow/* default */.Ay)(token, colorBgElevated, {
    arrowPlacement: {
      top: true,
      bottom: true
    }
  }), {
    // =============================================================
    // ==                          Menu                           ==
    // =============================================================
    [`${componentCls} ${menuCls}`]: {
      position: 'relative',
      margin: 0
    },
    [`${menuCls}-submenu-popup`]: {
      position: 'absolute',
      zIndex: zIndexPopup,
      background: 'transparent',
      boxShadow: 'none',
      transformOrigin: '0 0',
      'ul, li': {
        listStyle: 'none',
        margin: 0
      }
    },
    [`${componentCls}, ${componentCls}-menu-submenu`]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      [menuCls]: Object.assign(Object.assign({
        padding: dropdownEdgeChildPadding,
        listStyleType: 'none',
        backgroundColor: colorBgElevated,
        backgroundClip: 'padding-box',
        borderRadius: token.borderRadiusLG,
        outline: 'none',
        boxShadow: token.boxShadowSecondary
      }, (0,style/* genFocusStyle */.K8)(token)), {
        '&:empty': {
          padding: 0,
          boxShadow: 'none'
        },
        [`${menuCls}-item-group-title`]: {
          padding: `${(0,cssinjs_es/* unit */.zA)(paddingBlock)} ${(0,cssinjs_es/* unit */.zA)(controlPaddingHorizontal)}`,
          color: token.colorTextDescription,
          transition: `all ${motionDurationMid}`
        },
        // ======================= Item Content =======================
        [`${menuCls}-item`]: {
          position: 'relative',
          display: 'flex',
          alignItems: 'center'
        },
        [`${menuCls}-item-icon`]: {
          minWidth: fontSize,
          marginInlineEnd: token.marginXS,
          fontSize: token.fontSizeSM
        },
        [`${menuCls}-title-content`]: {
          flex: 'auto',
          '&-with-extra': {
            display: 'inline-flex',
            alignItems: 'center',
            width: '100%'
          },
          '> a': {
            color: 'inherit',
            transition: `all ${motionDurationMid}`,
            '&:hover': {
              color: 'inherit'
            },
            '&::after': {
              position: 'absolute',
              inset: 0,
              content: '""'
            }
          },
          [`${menuCls}-item-extra`]: {
            paddingInlineStart: token.padding,
            marginInlineStart: 'auto',
            fontSize: token.fontSizeSM,
            color: token.colorTextDescription
          }
        },
        // =========================== Item ===========================
        [`${menuCls}-item, ${menuCls}-submenu-title`]: Object.assign(Object.assign({
          display: 'flex',
          margin: 0,
          padding: `${(0,cssinjs_es/* unit */.zA)(paddingBlock)} ${(0,cssinjs_es/* unit */.zA)(controlPaddingHorizontal)}`,
          color: token.colorText,
          fontWeight: 'normal',
          fontSize,
          lineHeight: token.lineHeight,
          cursor: 'pointer',
          transition: `all ${motionDurationMid}`,
          borderRadius: token.borderRadiusSM,
          '&:hover, &-active': {
            backgroundColor: token.controlItemBgHover
          }
        }, (0,style/* genFocusStyle */.K8)(token)), {
          '&-selected': {
            color: token.colorPrimary,
            backgroundColor: token.controlItemBgActive,
            '&:hover, &-active': {
              backgroundColor: token.controlItemBgActiveHover
            }
          },
          '&-disabled': {
            color: colorTextDisabled,
            cursor: 'not-allowed',
            '&:hover': {
              color: colorTextDisabled,
              backgroundColor: colorBgElevated,
              cursor: 'not-allowed'
            },
            a: {
              pointerEvents: 'none'
            }
          },
          '&-divider': {
            height: 1,
            // By design
            margin: `${(0,cssinjs_es/* unit */.zA)(token.marginXXS)} 0`,
            overflow: 'hidden',
            lineHeight: 0,
            backgroundColor: token.colorSplit
          },
          [`${componentCls}-menu-submenu-expand-icon`]: {
            position: 'absolute',
            insetInlineEnd: token.paddingXS,
            [`${componentCls}-menu-submenu-arrow-icon`]: {
              marginInlineEnd: '0 !important',
              color: token.colorTextDescription,
              fontSize: fontSizeIcon,
              fontStyle: 'normal'
            }
          }
        }),
        [`${menuCls}-item-group-list`]: {
          margin: `0 ${(0,cssinjs_es/* unit */.zA)(token.marginXS)}`,
          padding: 0,
          listStyle: 'none'
        },
        [`${menuCls}-submenu-title`]: {
          paddingInlineEnd: token.calc(controlPaddingHorizontal).add(token.fontSizeSM).equal()
        },
        [`${menuCls}-submenu-vertical`]: {
          position: 'relative'
        },
        [`${menuCls}-submenu${menuCls}-submenu-disabled ${componentCls}-menu-submenu-title`]: {
          [`&, ${componentCls}-menu-submenu-arrow-icon`]: {
            color: colorTextDisabled,
            backgroundColor: colorBgElevated,
            cursor: 'not-allowed'
          }
        },
        // https://github.com/ant-design/ant-design/issues/19264
        [`${menuCls}-submenu-selected ${componentCls}-menu-submenu-title`]: {
          color: token.colorPrimary
        }
      })
    })
  },
  // Follow code may reuse in other components
  [(0,slide/* initSlideMotion */._j)(token, 'slide-up'), (0,slide/* initSlideMotion */._j)(token, 'slide-down'), (0,move/* initMoveMotion */.Mh)(token, 'move-up'), (0,move/* initMoveMotion */.Mh)(token, 'move-down'), (0,zoom/* initZoomMotion */.aB)(token, 'zoom-big')]];
};
// ============================== Export ==============================
const prepareComponentToken = token => Object.assign(Object.assign({
  zIndexPopup: token.zIndexPopupBase + 50,
  paddingBlock: (token.controlHeight - token.fontSize * token.lineHeight) / 2
}, (0,placementArrow/* getArrowOffsetToken */.Ke)({
  contentRadius: token.borderRadiusLG,
  limitVerticalRadius: true
})), (0,roundedArrow/* getArrowToken */.n)(token));
/* harmony default export */ var dropdown_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Dropdown', token => {
  const {
    marginXXS,
    sizePopupArrow,
    paddingXXS,
    componentCls
  } = token;
  const dropdownToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    menuCls: `${componentCls}-menu`,
    dropdownArrowDistance: token.calc(sizePopupArrow).div(2).add(marginXXS).equal(),
    dropdownEdgeChildPadding: paddingXXS
  });
  return [genBaseStyle(dropdownToken), style_status(dropdownToken)];
}, prepareComponentToken, {
  resetStyle: false
}));
;// ./node_modules/antd/es/dropdown/dropdown.js
"use client";





















const _Placements = (/* unused pure expression or super */ null && (['topLeft', 'topCenter', 'topRight', 'bottomLeft', 'bottomCenter', 'bottomRight', 'top', 'bottom']));
const Dropdown = props => {
  var _a;
  const {
    menu,
    arrow,
    prefixCls: customizePrefixCls,
    children,
    trigger,
    disabled,
    dropdownRender,
    getPopupContainer,
    overlayClassName,
    rootClassName,
    overlayStyle,
    open,
    onOpenChange,
    // Deprecated
    visible,
    onVisibleChange,
    mouseEnterDelay = 0.15,
    mouseLeaveDelay = 0.1,
    autoAdjustOverflow = true,
    placement = '',
    overlay,
    transitionName
  } = props;
  const {
    getPopupContainer: getContextPopupContainer,
    getPrefixCls,
    direction,
    dropdown
  } = react.useContext(context/* ConfigContext */.QO);
  // Warning for deprecated usage
  const warning = (0,_util_warning/* devUseWarning */.rJ)('Dropdown');
  if (false) {}
  const memoTransitionName = react.useMemo(() => {
    const rootPrefixCls = getPrefixCls();
    if (transitionName !== undefined) {
      return transitionName;
    }
    if (placement.includes('top')) {
      return `${rootPrefixCls}-slide-down`;
    }
    return `${rootPrefixCls}-slide-up`;
  }, [getPrefixCls, placement, transitionName]);
  const memoPlacement = react.useMemo(() => {
    if (!placement) {
      return direction === 'rtl' ? 'bottomRight' : 'bottomLeft';
    }
    if (placement.includes('Center')) {
      return placement.slice(0, placement.indexOf('Center'));
    }
    return placement;
  }, [placement, direction]);
  if (false) {}
  const prefixCls = getPrefixCls('dropdown', customizePrefixCls);
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = dropdown_style(prefixCls, rootCls);
  const [, token] = (0,useToken/* default */.Ay)();
  const child = react.Children.only(_util_isPrimitive(children) ? /*#__PURE__*/react.createElement("span", null, children) : children);
  const dropdownTrigger = (0,reactNode/* cloneElement */.Ob)(child, {
    className: classnames_default()(`${prefixCls}-trigger`, {
      [`${prefixCls}-rtl`]: direction === 'rtl'
    }, child.props.className),
    disabled: (_a = child.props.disabled) !== null && _a !== void 0 ? _a : disabled
  });
  const triggerActions = disabled ? [] : trigger;
  const alignPoint = !!(triggerActions === null || triggerActions === void 0 ? void 0 : triggerActions.includes('contextMenu'));
  // =========================== Open ============================
  const [mergedOpen, setOpen] = (0,useMergedState/* default */.A)(false, {
    value: open !== null && open !== void 0 ? open : visible
  });
  const onInnerOpenChange = (0,useEvent/* default */.A)(nextOpen => {
    onOpenChange === null || onOpenChange === void 0 ? void 0 : onOpenChange(nextOpen, {
      source: 'trigger'
    });
    onVisibleChange === null || onVisibleChange === void 0 ? void 0 : onVisibleChange(nextOpen);
    setOpen(nextOpen);
  });
  // =========================== Overlay ============================
  const overlayClassNameCustomized = classnames_default()(overlayClassName, rootClassName, hashId, cssVarCls, rootCls, dropdown === null || dropdown === void 0 ? void 0 : dropdown.className, {
    [`${prefixCls}-rtl`]: direction === 'rtl'
  });
  const builtinPlacements = (0,placements/* default */.A)({
    arrowPointAtCenter: typeof arrow === 'object' && arrow.pointAtCenter,
    autoAdjustOverflow,
    offset: token.marginXXS,
    arrowWidth: arrow ? token.sizePopupArrow : 0,
    borderRadius: token.borderRadius
  });
  const onMenuClick = react.useCallback(() => {
    if ((menu === null || menu === void 0 ? void 0 : menu.selectable) && (menu === null || menu === void 0 ? void 0 : menu.multiple)) {
      return;
    }
    onOpenChange === null || onOpenChange === void 0 ? void 0 : onOpenChange(false, {
      source: 'menu'
    });
    setOpen(false);
  }, [menu === null || menu === void 0 ? void 0 : menu.selectable, menu === null || menu === void 0 ? void 0 : menu.multiple]);
  const renderOverlay = () => {
    // rc-dropdown already can process the function of overlay, but we have check logic here.
    // So we need render the element to check and pass back to rc-dropdown.
    let overlayNode;
    if (menu === null || menu === void 0 ? void 0 : menu.items) {
      overlayNode = /*#__PURE__*/react.createElement(es_menu/* default */.A, Object.assign({}, menu));
    } else if (typeof overlay === 'function') {
      overlayNode = overlay();
    } else {
      overlayNode = overlay;
    }
    if (dropdownRender) {
      overlayNode = dropdownRender(overlayNode);
    }
    overlayNode = react.Children.only(typeof overlayNode === 'string' ? /*#__PURE__*/react.createElement("span", null, overlayNode) : overlayNode);
    return /*#__PURE__*/react.createElement(OverrideContext/* OverrideProvider */.A, {
      prefixCls: `${prefixCls}-menu`,
      rootClassName: classnames_default()(cssVarCls, rootCls),
      expandIcon: /*#__PURE__*/react.createElement("span", {
        className: `${prefixCls}-menu-submenu-arrow`
      }, /*#__PURE__*/react.createElement(RightOutlined/* default */.A, {
        className: `${prefixCls}-menu-submenu-arrow-icon`
      })),
      mode: "vertical",
      selectable: false,
      onClick: onMenuClick,
      validator: _ref3 => {
        let {
          mode
        } = _ref3;
        // Warning if use other mode
         false ? 0 : void 0;
      }
    }, overlayNode);
  };
  // =========================== zIndex ============================
  const [zIndex, contextZIndex] = (0,useZIndex/* useZIndex */.YK)('Dropdown', overlayStyle === null || overlayStyle === void 0 ? void 0 : overlayStyle.zIndex);
  // ============================ Render ============================
  let renderNode = /*#__PURE__*/react.createElement(es/* default */.A, Object.assign({
    alignPoint: alignPoint
  }, (0,omit/* default */.A)(props, ['rootClassName']), {
    mouseEnterDelay: mouseEnterDelay,
    mouseLeaveDelay: mouseLeaveDelay,
    visible: mergedOpen,
    builtinPlacements: builtinPlacements,
    arrow: !!arrow,
    overlayClassName: overlayClassNameCustomized,
    prefixCls: prefixCls,
    getPopupContainer: getPopupContainer || getContextPopupContainer,
    transitionName: memoTransitionName,
    trigger: triggerActions,
    overlay: renderOverlay,
    placement: memoPlacement,
    onVisibleChange: onInnerOpenChange,
    overlayStyle: Object.assign(Object.assign(Object.assign({}, dropdown === null || dropdown === void 0 ? void 0 : dropdown.style), overlayStyle), {
      zIndex
    })
  }), dropdownTrigger);
  if (zIndex) {
    renderNode = /*#__PURE__*/react.createElement(zindexContext/* default */.A.Provider, {
      value: contextZIndex
    }, renderNode);
  }
  return wrapCSSVar(renderNode);
};
function postPureProps(props) {
  return Object.assign(Object.assign({}, props), {
    align: {
      overflow: {
        adjustX: false,
        adjustY: false
      }
    }
  });
}
// We don't care debug panel
const dropdown_PurePanel = (0,PurePanel/* default */.A)(Dropdown, 'dropdown', prefixCls => prefixCls, postPureProps);
/* istanbul ignore next */
const WrapPurePanel = props => (/*#__PURE__*/react.createElement(dropdown_PurePanel, Object.assign({}, props), /*#__PURE__*/react.createElement("span", null)));
Dropdown._InternalPanelDoNotUseOrYouWillBeFired = WrapPurePanel;
if (false) {}
/* harmony default export */ var dropdown = (Dropdown);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/EllipsisOutlined.js + 1 modules
var EllipsisOutlined = __webpack_require__(52318);
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Children/toArray.js
var toArray = __webpack_require__(82546);
;// ./node_modules/antd/es/_util/gapSize.js
function isPresetSize(size) {
  return ['small', 'middle', 'large'].includes(size);
}
function isValidGapNumber(size) {
  if (!size) {
    // The case of size = 0 is deliberately excluded here, because the default value of the gap attribute in CSS is 0, so if the user passes 0 in, we can directly ignore it.
    return false;
  }
  return typeof size === 'number' && !Number.isNaN(size);
}
// EXTERNAL MODULE: ./node_modules/antd/es/space/Compact.js
var Compact = __webpack_require__(76327);
;// ./node_modules/antd/es/space/context.js

const SpaceContext = /*#__PURE__*/react.createContext({
  latestIndex: 0
});
const SpaceContextProvider = SpaceContext.Provider;
;// ./node_modules/antd/es/space/Item.js
"use client";



const Item = _ref => {
  let {
    className,
    index,
    children,
    split,
    style
  } = _ref;
  const {
    latestIndex
  } = react.useContext(SpaceContext);
  if (children === null || children === undefined) {
    return null;
  }
  return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("div", {
    className: className,
    style: style
  }, children), index < latestIndex && split && /*#__PURE__*/react.createElement("span", {
    className: `${className}-split`
  }, split));
};
/* harmony default export */ var space_Item = (Item);
// EXTERNAL MODULE: ./node_modules/antd/es/space/style/index.js + 1 modules
var space_style = __webpack_require__(85447);
;// ./node_modules/antd/es/space/index.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};










const InternalSpace = /*#__PURE__*/react.forwardRef((props, ref) => {
  var _a, _b, _c;
  const {
    getPrefixCls,
    space,
    direction: directionConfig
  } = react.useContext(context/* ConfigContext */.QO);
  const {
      size = (_a = space === null || space === void 0 ? void 0 : space.size) !== null && _a !== void 0 ? _a : 'small',
      align,
      className,
      rootClassName,
      children,
      direction = 'horizontal',
      prefixCls: customizePrefixCls,
      split,
      style,
      wrap = false,
      classNames: customClassNames,
      styles
    } = props,
    otherProps = __rest(props, ["size", "align", "className", "rootClassName", "children", "direction", "prefixCls", "split", "style", "wrap", "classNames", "styles"]);
  const [horizontalSize, verticalSize] = Array.isArray(size) ? size : [size, size];
  const isPresetVerticalSize = isPresetSize(verticalSize);
  const isPresetHorizontalSize = isPresetSize(horizontalSize);
  const isValidVerticalSize = isValidGapNumber(verticalSize);
  const isValidHorizontalSize = isValidGapNumber(horizontalSize);
  const childNodes = (0,toArray/* default */.A)(children, {
    keepEmpty: true
  });
  const mergedAlign = align === undefined && direction === 'horizontal' ? 'center' : align;
  const prefixCls = getPrefixCls('space', customizePrefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = (0,space_style/* default */.A)(prefixCls);
  const cls = classnames_default()(prefixCls, space === null || space === void 0 ? void 0 : space.className, hashId, `${prefixCls}-${direction}`, {
    [`${prefixCls}-rtl`]: directionConfig === 'rtl',
    [`${prefixCls}-align-${mergedAlign}`]: mergedAlign,
    [`${prefixCls}-gap-row-${verticalSize}`]: isPresetVerticalSize,
    [`${prefixCls}-gap-col-${horizontalSize}`]: isPresetHorizontalSize
  }, className, rootClassName, cssVarCls);
  const itemClassName = classnames_default()(`${prefixCls}-item`, (_b = customClassNames === null || customClassNames === void 0 ? void 0 : customClassNames.item) !== null && _b !== void 0 ? _b : (_c = space === null || space === void 0 ? void 0 : space.classNames) === null || _c === void 0 ? void 0 : _c.item);
  // Calculate latest one
  let latestIndex = 0;
  const nodes = childNodes.map((child, i) => {
    var _a, _b;
    if (child !== null && child !== undefined) {
      latestIndex = i;
    }
    const key = (child === null || child === void 0 ? void 0 : child.key) || `${itemClassName}-${i}`;
    return /*#__PURE__*/react.createElement(space_Item, {
      className: itemClassName,
      key: key,
      index: i,
      split: split,
      style: (_a = styles === null || styles === void 0 ? void 0 : styles.item) !== null && _a !== void 0 ? _a : (_b = space === null || space === void 0 ? void 0 : space.styles) === null || _b === void 0 ? void 0 : _b.item
    }, child);
  });
  const spaceContext = react.useMemo(() => ({
    latestIndex
  }), [latestIndex]);
  // =========================== Render ===========================
  if (childNodes.length === 0) {
    return null;
  }
  const gapStyle = {};
  if (wrap) {
    gapStyle.flexWrap = 'wrap';
  }
  if (!isPresetHorizontalSize && isValidHorizontalSize) {
    gapStyle.columnGap = horizontalSize;
  }
  if (!isPresetVerticalSize && isValidVerticalSize) {
    gapStyle.rowGap = verticalSize;
  }
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", Object.assign({
    ref: ref,
    className: cls,
    style: Object.assign(Object.assign(Object.assign({}, gapStyle), space === null || space === void 0 ? void 0 : space.style), style)
  }, otherProps), /*#__PURE__*/react.createElement(SpaceContextProvider, {
    value: spaceContext
  }, nodes)));
});
const Space = InternalSpace;
Space.Compact = Compact/* default */.Ay;
if (false) {}
/* harmony default export */ var space = (Space);
;// ./node_modules/antd/es/dropdown/dropdown-button.js
"use client";

var dropdown_button_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};








const DropdownButton = props => {
  const {
    getPopupContainer: getContextPopupContainer,
    getPrefixCls,
    direction
  } = react.useContext(context/* ConfigContext */.QO);
  const {
      prefixCls: customizePrefixCls,
      type = 'default',
      danger,
      disabled,
      loading,
      onClick,
      htmlType,
      children,
      className,
      menu,
      arrow,
      autoFocus,
      overlay,
      trigger,
      align,
      open,
      onOpenChange,
      placement,
      getPopupContainer,
      href,
      icon = /*#__PURE__*/react.createElement(EllipsisOutlined/* default */.A, null),
      title,
      buttonsRender = buttons => buttons,
      mouseEnterDelay,
      mouseLeaveDelay,
      overlayClassName,
      overlayStyle,
      destroyPopupOnHide,
      dropdownRender
    } = props,
    restProps = dropdown_button_rest(props, ["prefixCls", "type", "danger", "disabled", "loading", "onClick", "htmlType", "children", "className", "menu", "arrow", "autoFocus", "overlay", "trigger", "align", "open", "onOpenChange", "placement", "getPopupContainer", "href", "icon", "title", "buttonsRender", "mouseEnterDelay", "mouseLeaveDelay", "overlayClassName", "overlayStyle", "destroyPopupOnHide", "dropdownRender"]);
  const prefixCls = getPrefixCls('dropdown', customizePrefixCls);
  const buttonPrefixCls = `${prefixCls}-button`;
  const dropdownProps = {
    menu,
    arrow,
    autoFocus,
    align,
    disabled,
    trigger: disabled ? [] : trigger,
    onOpenChange,
    getPopupContainer: getPopupContainer || getContextPopupContainer,
    mouseEnterDelay,
    mouseLeaveDelay,
    overlayClassName,
    overlayStyle,
    destroyPopupOnHide,
    dropdownRender
  };
  const {
    compactSize,
    compactItemClassnames
  } = (0,Compact/* useCompactItemContext */.RQ)(prefixCls, direction);
  const classes = classnames_default()(buttonPrefixCls, compactItemClassnames, className);
  if ('overlay' in props) {
    dropdownProps.overlay = overlay;
  }
  if ('open' in props) {
    dropdownProps.open = open;
  }
  if ('placement' in props) {
    dropdownProps.placement = placement;
  } else {
    dropdownProps.placement = direction === 'rtl' ? 'bottomLeft' : 'bottomRight';
  }
  const leftButton = /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    type: type,
    danger: danger,
    disabled: disabled,
    loading: loading,
    onClick: onClick,
    htmlType: htmlType,
    href: href,
    title: title
  }, children);
  const rightButton = /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    type: type,
    danger: danger,
    icon: icon
  });
  const [leftButtonToRender, rightButtonToRender] = buttonsRender([leftButton, rightButton]);
  return /*#__PURE__*/react.createElement(space.Compact, Object.assign({
    className: classes,
    size: compactSize,
    block: true
  }, restProps), leftButtonToRender, /*#__PURE__*/react.createElement(dropdown, Object.assign({}, dropdownProps), rightButtonToRender));
};
DropdownButton.__ANT_BUTTON = true;
/* harmony default export */ var dropdown_button = (DropdownButton);
;// ./node_modules/antd/es/dropdown/index.js
"use client";



const dropdown_Dropdown = dropdown;
dropdown_Dropdown.Button = dropdown_button;
/* harmony default export */ var es_dropdown = (dropdown_Dropdown);

/***/ }),

/***/ 96476:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ OverrideProvider; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var rc_util_es_ref__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(8719);
/* harmony import */ var _util_ContextIsolator__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(62897);
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};



const OverrideContext = /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createContext(null);
/** @internal Only used for Dropdown component. Do not use this in your production. */
const OverrideProvider = /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.forwardRef((props, ref) => {
  const {
      children
    } = props,
    restProps = __rest(props, ["children"]);
  const override = react__WEBPACK_IMPORTED_MODULE_0__.useContext(OverrideContext);
  const context = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => Object.assign(Object.assign({}, override), restProps), [override, restProps.prefixCls,
  // restProps.expandIcon, Not mark as deps since this is a ReactNode
  restProps.mode, restProps.selectable, restProps.rootClassName
  // restProps.validator, Not mark as deps since this is a function
  ]);
  const canRef = (0,rc_util_es_ref__WEBPACK_IMPORTED_MODULE_1__/* .supportNodeRef */ .H3)(children);
  const mergedRef = (0,rc_util_es_ref__WEBPACK_IMPORTED_MODULE_1__/* .useComposeRef */ .xK)(ref, canRef ? (0,rc_util_es_ref__WEBPACK_IMPORTED_MODULE_1__/* .getNodeRef */ .A9)(children) : null);
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(OverrideContext.Provider, {
    value: context
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_util_ContextIsolator__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A, {
    space: true
  }, canRef ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.cloneElement(children, {
    ref: mergedRef
  }) : children));
});
/** @internal Only used for Dropdown component. Do not use this in your production. */
/* harmony default export */ __webpack_exports__.h = (OverrideContext);

/***/ }),

/***/ 25226:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ es_menu; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/rc-menu/es/index.js + 26 modules
var es = __webpack_require__(48810);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
;// ./node_modules/antd/es/layout/Sider.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};











const dimensionMaxMap = {
  xs: '479.98px',
  sm: '575.98px',
  md: '767.98px',
  lg: '991.98px',
  xl: '1199.98px',
  xxl: '1599.98px'
};
const SiderContext = /*#__PURE__*/react.createContext({});
const generateId = (() => {
  let i = 0;
  return function () {
    let prefix = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
    i += 1;
    return `${prefix}${i}`;
  };
})();
const Sider = /*#__PURE__*/(/* unused pure expression or super */ null && (React.forwardRef((props, ref) => {
  const {
      prefixCls: customizePrefixCls,
      className,
      trigger,
      children,
      defaultCollapsed = false,
      theme = 'dark',
      style = {},
      collapsible = false,
      reverseArrow = false,
      width = 200,
      collapsedWidth = 80,
      zeroWidthTriggerStyle,
      breakpoint,
      onCollapse,
      onBreakpoint
    } = props,
    otherProps = __rest(props, ["prefixCls", "className", "trigger", "children", "defaultCollapsed", "theme", "style", "collapsible", "reverseArrow", "width", "collapsedWidth", "zeroWidthTriggerStyle", "breakpoint", "onCollapse", "onBreakpoint"]);
  const {
    siderHook
  } = useContext(LayoutContext);
  const [collapsed, setCollapsed] = useState('collapsed' in props ? props.collapsed : defaultCollapsed);
  const [below, setBelow] = useState(false);
  useEffect(() => {
    if ('collapsed' in props) {
      setCollapsed(props.collapsed);
    }
  }, [props.collapsed]);
  const handleSetCollapsed = (value, type) => {
    if (!('collapsed' in props)) {
      setCollapsed(value);
    }
    onCollapse === null || onCollapse === void 0 ? void 0 : onCollapse(value, type);
  };
  // =========================== Prefix ===========================
  const {
    getPrefixCls
  } = useContext(ConfigContext);
  const prefixCls = getPrefixCls('layout-sider', customizePrefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = useStyle(prefixCls);
  // ========================= Responsive =========================
  const responsiveHandlerRef = useRef();
  responsiveHandlerRef.current = mql => {
    setBelow(mql.matches);
    onBreakpoint === null || onBreakpoint === void 0 ? void 0 : onBreakpoint(mql.matches);
    if (collapsed !== mql.matches) {
      handleSetCollapsed(mql.matches, 'responsive');
    }
  };
  useEffect(() => {
    function responsiveHandler(mql) {
      return responsiveHandlerRef.current(mql);
    }
    let mql;
    if (typeof window !== 'undefined') {
      const {
        matchMedia
      } = window;
      if (matchMedia && breakpoint && breakpoint in dimensionMaxMap) {
        mql = matchMedia(`screen and (max-width: ${dimensionMaxMap[breakpoint]})`);
        try {
          mql.addEventListener('change', responsiveHandler);
        } catch (_a) {
          mql.addListener(responsiveHandler);
        }
        responsiveHandler(mql);
      }
    }
    return () => {
      try {
        mql === null || mql === void 0 ? void 0 : mql.removeEventListener('change', responsiveHandler);
      } catch (_a) {
        mql === null || mql === void 0 ? void 0 : mql.removeListener(responsiveHandler);
      }
    };
  }, [breakpoint]); // in order to accept dynamic 'breakpoint' property, we need to add 'breakpoint' into dependency array.
  useEffect(() => {
    const uniqueId = generateId('ant-sider-');
    siderHook.addSider(uniqueId);
    return () => siderHook.removeSider(uniqueId);
  }, []);
  const toggle = () => {
    handleSetCollapsed(!collapsed, 'clickTrigger');
  };
  const renderSider = () => {
    const divProps = omit(otherProps, ['collapsed']);
    const rawWidth = collapsed ? collapsedWidth : width;
    // use "px" as fallback unit for width
    const siderWidth = isNumeric(rawWidth) ? `${rawWidth}px` : String(rawWidth);
    // special trigger when collapsedWidth == 0
    const zeroWidthTrigger = parseFloat(String(collapsedWidth || 0)) === 0 ? (/*#__PURE__*/React.createElement("span", {
      onClick: toggle,
      className: classNames(`${prefixCls}-zero-width-trigger`, `${prefixCls}-zero-width-trigger-${reverseArrow ? 'right' : 'left'}`),
      style: zeroWidthTriggerStyle
    }, trigger || /*#__PURE__*/React.createElement(BarsOutlined, null))) : null;
    const iconObj = {
      expanded: reverseArrow ? /*#__PURE__*/React.createElement(RightOutlined, null) : /*#__PURE__*/React.createElement(LeftOutlined, null),
      collapsed: reverseArrow ? /*#__PURE__*/React.createElement(LeftOutlined, null) : /*#__PURE__*/React.createElement(RightOutlined, null)
    };
    const status = collapsed ? 'collapsed' : 'expanded';
    const defaultTrigger = iconObj[status];
    const triggerDom = trigger !== null ? zeroWidthTrigger || (/*#__PURE__*/React.createElement("div", {
      className: `${prefixCls}-trigger`,
      onClick: toggle,
      style: {
        width: siderWidth
      }
    }, trigger || defaultTrigger)) : null;
    const divStyle = Object.assign(Object.assign({}, style), {
      flex: `0 0 ${siderWidth}`,
      maxWidth: siderWidth,
      minWidth: siderWidth,
      width: siderWidth
    });
    const siderCls = classNames(prefixCls, `${prefixCls}-${theme}`, {
      [`${prefixCls}-collapsed`]: !!collapsed,
      [`${prefixCls}-has-trigger`]: collapsible && trigger !== null && !zeroWidthTrigger,
      [`${prefixCls}-below`]: !!below,
      [`${prefixCls}-zero-width`]: parseFloat(siderWidth) === 0
    }, className, hashId, cssVarCls);
    return /*#__PURE__*/React.createElement("aside", Object.assign({
      className: siderCls
    }, divProps, {
      style: divStyle,
      ref: ref
    }), /*#__PURE__*/React.createElement("div", {
      className: `${prefixCls}-children`
    }, children), collapsible || below && zeroWidthTrigger ? triggerDom : null);
  };
  const contextValue = React.useMemo(() => ({
    siderCollapsed: collapsed
  }), [collapsed]);
  return wrapCSSVar(/*#__PURE__*/React.createElement(SiderContext.Provider, {
    value: contextValue
  }, renderSider()));
})));
if (false) {}
/* harmony default export */ var layout_Sider = ((/* unused pure expression or super */ null && (Sider)));
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/EllipsisOutlined.js + 1 modules
var EllipsisOutlined = __webpack_require__(52318);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useEvent.js
var useEvent = __webpack_require__(26956);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var es_omit = __webpack_require__(19853);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/motion.js
var motion = __webpack_require__(23723);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/reactNode.js
var reactNode = __webpack_require__(40682);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
;// ./node_modules/antd/es/menu/MenuContext.js
"use client";


const MenuContext = /*#__PURE__*/(0,react.createContext)({
  prefixCls: '',
  firstLevel: true,
  inlineCollapsed: false
});
/* harmony default export */ var menu_MenuContext = (MenuContext);
;// ./node_modules/antd/es/menu/MenuDivider.js
"use client";

var MenuDivider_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};




const MenuDivider = props => {
  const {
      prefixCls: customizePrefixCls,
      className,
      dashed
    } = props,
    restProps = MenuDivider_rest(props, ["prefixCls", "className", "dashed"]);
  const {
    getPrefixCls
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('menu', customizePrefixCls);
  const classString = classnames_default()({
    [`${prefixCls}-item-divider-dashed`]: !!dashed
  }, className);
  return /*#__PURE__*/react.createElement(es/* Divider */.cG, Object.assign({
    className: classString
  }, restProps));
};
/* harmony default export */ var menu_MenuDivider = (MenuDivider);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Children/toArray.js
var toArray = __webpack_require__(82546);
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var tooltip = __webpack_require__(40367);
;// ./node_modules/antd/es/menu/MenuItem.js
"use client";










const MenuItem = props => {
  var _a;
  const {
    className,
    children,
    icon,
    title,
    danger,
    extra
  } = props;
  const {
    prefixCls,
    firstLevel,
    direction,
    disableMenuItemTitleTooltip,
    inlineCollapsed: isInlineCollapsed
  } = react.useContext(menu_MenuContext);
  const renderItemChildren = inlineCollapsed => {
    const label = children === null || children === void 0 ? void 0 : children[0];
    const wrapNode = /*#__PURE__*/react.createElement("span", {
      className: classnames_default()(`${prefixCls}-title-content`, {
        [`${prefixCls}-title-content-with-extra`]: !!extra || extra === 0
      })
    }, children);
    // inline-collapsed.md demo 依赖 span 来隐藏文字,有 icon 属性，则内部包裹一个 span
    // ref: https://github.com/ant-design/ant-design/pull/23456
    if (!icon || /*#__PURE__*/react.isValidElement(children) && children.type === 'span') {
      if (children && inlineCollapsed && firstLevel && typeof label === 'string') {
        return /*#__PURE__*/react.createElement("div", {
          className: `${prefixCls}-inline-collapsed-noicon`
        }, label.charAt(0));
      }
    }
    return wrapNode;
  };
  const {
    siderCollapsed
  } = react.useContext(SiderContext);
  let tooltipTitle = title;
  if (typeof title === 'undefined') {
    tooltipTitle = firstLevel ? children : '';
  } else if (title === false) {
    tooltipTitle = '';
  }
  const tooltipProps = {
    title: tooltipTitle
  };
  if (!siderCollapsed && !isInlineCollapsed) {
    tooltipProps.title = null;
    // Reset `open` to fix control mode tooltip display not correct
    // ref: https://github.com/ant-design/ant-design/issues/16742
    tooltipProps.open = false;
  }
  const childrenLength = (0,toArray/* default */.A)(children).length;
  let returnNode = /*#__PURE__*/react.createElement(es/* Item */.q7, Object.assign({}, (0,es_omit/* default */.A)(props, ['title', 'icon', 'danger']), {
    className: classnames_default()({
      [`${prefixCls}-item-danger`]: danger,
      [`${prefixCls}-item-only-child`]: (icon ? childrenLength + 1 : childrenLength) === 1
    }, className),
    title: typeof title === 'string' ? title : undefined
  }), (0,reactNode/* cloneElement */.Ob)(icon, {
    className: classnames_default()(/*#__PURE__*/react.isValidElement(icon) ? (_a = icon.props) === null || _a === void 0 ? void 0 : _a.className : '', `${prefixCls}-item-icon`)
  }), renderItemChildren(isInlineCollapsed));
  if (!disableMenuItemTitleTooltip) {
    returnNode = /*#__PURE__*/react.createElement(tooltip/* default */.A, Object.assign({}, tooltipProps, {
      placement: direction === 'rtl' ? 'left' : 'right',
      overlayClassName: `${prefixCls}-inline-collapsed-tooltip`
    }), returnNode);
  }
  return returnNode;
};
/* harmony default export */ var menu_MenuItem = (MenuItem);
// EXTERNAL MODULE: ./node_modules/antd/es/menu/OverrideContext.js
var OverrideContext = __webpack_require__(96476);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/@ctrl/tinycolor/dist/module/index.js
var dist_module = __webpack_require__(24978);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/collapse.js
var collapse = __webpack_require__(60977);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/slide.js
var slide = __webpack_require__(53561);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/zoom.js
var zoom = __webpack_require__(99077);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
;// ./node_modules/antd/es/menu/style/horizontal.js

const getHorizontalStyle = token => {
  const {
    componentCls,
    motionDurationSlow,
    horizontalLineHeight,
    colorSplit,
    lineWidth,
    lineType,
    itemPaddingInline
  } = token;
  return {
    [`${componentCls}-horizontal`]: {
      lineHeight: horizontalLineHeight,
      border: 0,
      borderBottom: `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${colorSplit}`,
      boxShadow: 'none',
      '&::after': {
        display: 'block',
        clear: 'both',
        height: 0,
        content: '"\\20"'
      },
      // ======================= Item =======================
      [`${componentCls}-item, ${componentCls}-submenu`]: {
        position: 'relative',
        display: 'inline-block',
        verticalAlign: 'bottom',
        paddingInline: itemPaddingInline
      },
      [`> ${componentCls}-item:hover,
        > ${componentCls}-item-active,
        > ${componentCls}-submenu ${componentCls}-submenu-title:hover`]: {
        backgroundColor: 'transparent'
      },
      [`${componentCls}-item, ${componentCls}-submenu-title`]: {
        transition: [`border-color ${motionDurationSlow}`, `background ${motionDurationSlow}`].join(',')
      },
      // ===================== Sub Menu =====================
      [`${componentCls}-submenu-arrow`]: {
        display: 'none'
      }
    }
  };
};
/* harmony default export */ var horizontal = (getHorizontalStyle);
;// ./node_modules/antd/es/menu/style/rtl.js

const getRTLStyle = _ref => {
  let {
    componentCls,
    menuArrowOffset,
    calc
  } = _ref;
  return {
    [`${componentCls}-rtl`]: {
      direction: 'rtl'
    },
    [`${componentCls}-submenu-rtl`]: {
      transformOrigin: '100% 0'
    },
    // Vertical Arrow
    [`${componentCls}-rtl${componentCls}-vertical,
    ${componentCls}-submenu-rtl ${componentCls}-vertical`]: {
      [`${componentCls}-submenu-arrow`]: {
        '&::before': {
          transform: `rotate(-45deg) translateY(${(0,cssinjs_es/* unit */.zA)(calc(menuArrowOffset).mul(-1).equal())})`
        },
        '&::after': {
          transform: `rotate(45deg) translateY(${(0,cssinjs_es/* unit */.zA)(menuArrowOffset)})`
        }
      }
    }
  };
};
/* harmony default export */ var rtl = (getRTLStyle);
;// ./node_modules/antd/es/menu/style/theme.js


const accessibilityFocus = token => Object.assign({}, (0,style/* genFocusOutline */.jk)(token));
const getThemeStyle = (token, themeSuffix) => {
  const {
    componentCls,
    itemColor,
    itemSelectedColor,
    groupTitleColor,
    itemBg,
    subMenuItemBg,
    itemSelectedBg,
    activeBarHeight,
    activeBarWidth,
    activeBarBorderWidth,
    motionDurationSlow,
    motionEaseInOut,
    motionEaseOut,
    itemPaddingInline,
    motionDurationMid,
    itemHoverColor,
    lineType,
    colorSplit,
    // Disabled
    itemDisabledColor,
    // Danger
    dangerItemColor,
    dangerItemHoverColor,
    dangerItemSelectedColor,
    dangerItemActiveBg,
    dangerItemSelectedBg,
    // Bg
    popupBg,
    itemHoverBg,
    itemActiveBg,
    menuSubMenuBg,
    // Horizontal
    horizontalItemSelectedColor,
    horizontalItemSelectedBg,
    horizontalItemBorderRadius,
    horizontalItemHoverBg
  } = token;
  return {
    [`${componentCls}-${themeSuffix}, ${componentCls}-${themeSuffix} > ${componentCls}`]: {
      color: itemColor,
      background: itemBg,
      [`&${componentCls}-root:focus-visible`]: Object.assign({}, accessibilityFocus(token)),
      // ======================== Item ========================
      [`${componentCls}-item`]: {
        '&-group-title, &-extra': {
          color: groupTitleColor
        }
      },
      [`${componentCls}-submenu-selected`]: {
        [`> ${componentCls}-submenu-title`]: {
          color: itemSelectedColor
        }
      },
      [`${componentCls}-item, ${componentCls}-submenu-title`]: {
        color: itemColor,
        [`&:not(${componentCls}-item-disabled):focus-visible`]: Object.assign({}, accessibilityFocus(token))
      },
      // Disabled
      [`${componentCls}-item-disabled, ${componentCls}-submenu-disabled`]: {
        color: `${itemDisabledColor} !important`
      },
      // Hover
      [`${componentCls}-item:not(${componentCls}-item-selected):not(${componentCls}-submenu-selected)`]: {
        [`&:hover, > ${componentCls}-submenu-title:hover`]: {
          color: itemHoverColor
        }
      },
      [`&:not(${componentCls}-horizontal)`]: {
        [`${componentCls}-item:not(${componentCls}-item-selected)`]: {
          '&:hover': {
            backgroundColor: itemHoverBg
          },
          '&:active': {
            backgroundColor: itemActiveBg
          }
        },
        [`${componentCls}-submenu-title`]: {
          '&:hover': {
            backgroundColor: itemHoverBg
          },
          '&:active': {
            backgroundColor: itemActiveBg
          }
        }
      },
      // Danger - only Item has
      [`${componentCls}-item-danger`]: {
        color: dangerItemColor,
        [`&${componentCls}-item:hover`]: {
          [`&:not(${componentCls}-item-selected):not(${componentCls}-submenu-selected)`]: {
            color: dangerItemHoverColor
          }
        },
        [`&${componentCls}-item:active`]: {
          background: dangerItemActiveBg
        }
      },
      [`${componentCls}-item a`]: {
        '&, &:hover': {
          color: 'inherit'
        }
      },
      [`${componentCls}-item-selected`]: {
        color: itemSelectedColor,
        // Danger
        [`&${componentCls}-item-danger`]: {
          color: dangerItemSelectedColor
        },
        'a, a:hover': {
          color: 'inherit'
        }
      },
      [`& ${componentCls}-item-selected`]: {
        backgroundColor: itemSelectedBg,
        // Danger
        [`&${componentCls}-item-danger`]: {
          backgroundColor: dangerItemSelectedBg
        }
      },
      [`&${componentCls}-submenu > ${componentCls}`]: {
        backgroundColor: menuSubMenuBg
      },
      // ===== 设置浮层的颜色 =======
      // ！dark 模式会被popupBg 会被rest 为 darkPopupBg
      [`&${componentCls}-popup > ${componentCls}`]: {
        backgroundColor: popupBg
      },
      [`&${componentCls}-submenu-popup > ${componentCls}`]: {
        backgroundColor: popupBg
      },
      // ===== 设置浮层的颜色 end =======
      // ====================== Horizontal ======================
      [`&${componentCls}-horizontal`]: Object.assign(Object.assign({}, themeSuffix === 'dark' ? {
        borderBottom: 0
      } : {}), {
        [`> ${componentCls}-item, > ${componentCls}-submenu`]: {
          top: activeBarBorderWidth,
          marginTop: token.calc(activeBarBorderWidth).mul(-1).equal(),
          marginBottom: 0,
          borderRadius: horizontalItemBorderRadius,
          '&::after': {
            position: 'absolute',
            insetInline: itemPaddingInline,
            bottom: 0,
            borderBottom: `${(0,cssinjs_es/* unit */.zA)(activeBarHeight)} solid transparent`,
            transition: `border-color ${motionDurationSlow} ${motionEaseInOut}`,
            content: '""'
          },
          '&:hover, &-active, &-open': {
            background: horizontalItemHoverBg,
            '&::after': {
              borderBottomWidth: activeBarHeight,
              borderBottomColor: horizontalItemSelectedColor
            }
          },
          '&-selected': {
            color: horizontalItemSelectedColor,
            backgroundColor: horizontalItemSelectedBg,
            '&:hover': {
              backgroundColor: horizontalItemSelectedBg
            },
            '&::after': {
              borderBottomWidth: activeBarHeight,
              borderBottomColor: horizontalItemSelectedColor
            }
          }
        }
      }),
      // ================== Inline & Vertical ===================
      //
      [`&${componentCls}-root`]: {
        [`&${componentCls}-inline, &${componentCls}-vertical`]: {
          borderInlineEnd: `${(0,cssinjs_es/* unit */.zA)(activeBarBorderWidth)} ${lineType} ${colorSplit}`
        }
      },
      // ======================== Inline ========================
      [`&${componentCls}-inline`]: {
        // Sub
        [`${componentCls}-sub${componentCls}-inline`]: {
          background: subMenuItemBg
        },
        [`${componentCls}-item`]: {
          position: 'relative',
          '&::after': {
            position: 'absolute',
            insetBlock: 0,
            insetInlineEnd: 0,
            borderInlineEnd: `${(0,cssinjs_es/* unit */.zA)(activeBarWidth)} solid ${itemSelectedColor}`,
            transform: 'scaleY(0.0001)',
            opacity: 0,
            transition: [`transform ${motionDurationMid} ${motionEaseOut}`, `opacity ${motionDurationMid} ${motionEaseOut}`].join(','),
            content: '""'
          },
          // Danger
          [`&${componentCls}-item-danger`]: {
            '&::after': {
              borderInlineEndColor: dangerItemSelectedColor
            }
          }
        },
        [`${componentCls}-selected, ${componentCls}-item-selected`]: {
          '&::after': {
            transform: 'scaleY(1)',
            opacity: 1,
            transition: [`transform ${motionDurationMid} ${motionEaseInOut}`, `opacity ${motionDurationMid} ${motionEaseInOut}`].join(',')
          }
        }
      }
    }
  };
};
/* harmony default export */ var theme = (getThemeStyle);
;// ./node_modules/antd/es/menu/style/vertical.js


const getVerticalInlineStyle = token => {
  const {
    componentCls,
    itemHeight,
    itemMarginInline,
    padding,
    menuArrowSize,
    marginXS,
    itemMarginBlock,
    itemWidth,
    itemPaddingInline
  } = token;
  const paddingWithArrow = token.calc(menuArrowSize).add(padding).add(marginXS).equal();
  return {
    [`${componentCls}-item`]: {
      position: 'relative',
      overflow: 'hidden'
    },
    [`${componentCls}-item, ${componentCls}-submenu-title`]: {
      height: itemHeight,
      lineHeight: (0,cssinjs_es/* unit */.zA)(itemHeight),
      paddingInline: itemPaddingInline,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      marginInline: itemMarginInline,
      marginBlock: itemMarginBlock,
      width: itemWidth
    },
    [`> ${componentCls}-item,
            > ${componentCls}-submenu > ${componentCls}-submenu-title`]: {
      height: itemHeight,
      lineHeight: (0,cssinjs_es/* unit */.zA)(itemHeight)
    },
    [`${componentCls}-item-group-list ${componentCls}-submenu-title,
            ${componentCls}-submenu-title`]: {
      paddingInlineEnd: paddingWithArrow
    }
  };
};
const getVerticalStyle = token => {
  const {
    componentCls,
    iconCls,
    itemHeight,
    colorTextLightSolid,
    dropdownWidth,
    controlHeightLG,
    motionEaseOut,
    paddingXL,
    itemMarginInline,
    fontSizeLG,
    motionDurationFast,
    motionDurationSlow,
    paddingXS,
    boxShadowSecondary,
    collapsedWidth,
    collapsedIconSize
  } = token;
  const inlineItemStyle = {
    height: itemHeight,
    lineHeight: (0,cssinjs_es/* unit */.zA)(itemHeight),
    listStylePosition: 'inside',
    listStyleType: 'disc'
  };
  return [{
    [componentCls]: {
      '&-inline, &-vertical': Object.assign({
        [`&${componentCls}-root`]: {
          boxShadow: 'none'
        }
      }, getVerticalInlineStyle(token))
    },
    [`${componentCls}-submenu-popup`]: {
      [`${componentCls}-vertical`]: Object.assign(Object.assign({}, getVerticalInlineStyle(token)), {
        boxShadow: boxShadowSecondary
      })
    }
  },
  // Vertical only
  {
    [`${componentCls}-submenu-popup ${componentCls}-vertical${componentCls}-sub`]: {
      minWidth: dropdownWidth,
      maxHeight: `calc(100vh - ${(0,cssinjs_es/* unit */.zA)(token.calc(controlHeightLG).mul(2.5).equal())})`,
      padding: '0',
      overflow: 'hidden',
      borderInlineEnd: 0,
      // https://github.com/ant-design/ant-design/issues/22244
      // https://github.com/ant-design/ant-design/issues/26812
      "&:not([class*='-active'])": {
        overflowX: 'hidden',
        overflowY: 'auto'
      }
    }
  },
  // Inline Only
  {
    [`${componentCls}-inline`]: {
      width: '100%',
      // Motion enhance for first level
      [`&${componentCls}-root`]: {
        [`${componentCls}-item, ${componentCls}-submenu-title`]: {
          display: 'flex',
          alignItems: 'center',
          transition: [`border-color ${motionDurationSlow}`, `background ${motionDurationSlow}`, `padding ${motionDurationFast} ${motionEaseOut}`].join(','),
          [`> ${componentCls}-title-content`]: {
            flex: 'auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          },
          '> *': {
            flex: 'none'
          }
        }
      },
      // >>>>> Sub
      [`${componentCls}-sub${componentCls}-inline`]: {
        padding: 0,
        border: 0,
        borderRadius: 0,
        boxShadow: 'none',
        [`& > ${componentCls}-submenu > ${componentCls}-submenu-title`]: inlineItemStyle,
        [`& ${componentCls}-item-group-title`]: {
          paddingInlineStart: paddingXL
        }
      },
      // >>>>> Item
      [`${componentCls}-item`]: inlineItemStyle
    }
  },
  // Inline Collapse Only
  {
    [`${componentCls}-inline-collapsed`]: {
      width: collapsedWidth,
      [`&${componentCls}-root`]: {
        [`${componentCls}-item, ${componentCls}-submenu ${componentCls}-submenu-title`]: {
          [`> ${componentCls}-inline-collapsed-noicon`]: {
            fontSize: fontSizeLG,
            textAlign: 'center'
          }
        }
      },
      [`> ${componentCls}-item,
          > ${componentCls}-item-group > ${componentCls}-item-group-list > ${componentCls}-item,
          > ${componentCls}-item-group > ${componentCls}-item-group-list > ${componentCls}-submenu > ${componentCls}-submenu-title,
          > ${componentCls}-submenu > ${componentCls}-submenu-title`]: {
        insetInlineStart: 0,
        paddingInline: `calc(50% - ${(0,cssinjs_es/* unit */.zA)(token.calc(collapsedIconSize).div(2).equal())} - ${(0,cssinjs_es/* unit */.zA)(itemMarginInline)})`,
        textOverflow: 'clip',
        [`
            ${componentCls}-submenu-arrow,
            ${componentCls}-submenu-expand-icon
          `]: {
          opacity: 0
        },
        [`${componentCls}-item-icon, ${iconCls}`]: {
          margin: 0,
          fontSize: collapsedIconSize,
          lineHeight: (0,cssinjs_es/* unit */.zA)(itemHeight),
          '+ span': {
            display: 'inline-block',
            opacity: 0
          }
        }
      },
      [`${componentCls}-item-icon, ${iconCls}`]: {
        display: 'inline-block'
      },
      '&-tooltip': {
        pointerEvents: 'none',
        [`${componentCls}-item-icon, ${iconCls}`]: {
          display: 'none'
        },
        'a, a:hover': {
          color: colorTextLightSolid
        }
      },
      [`${componentCls}-item-group-title`]: Object.assign(Object.assign({}, style/* textEllipsis */.L9), {
        paddingInline: paddingXS
      })
    }
  }];
};
/* harmony default export */ var vertical = (getVerticalStyle);
;// ./node_modules/antd/es/menu/style/index.js









const genMenuItemStyle = token => {
  const {
    componentCls,
    motionDurationSlow,
    motionDurationMid,
    motionEaseInOut,
    motionEaseOut,
    iconCls,
    iconSize,
    iconMarginInlineEnd
  } = token;
  return {
    // >>>>> Item
    [`${componentCls}-item, ${componentCls}-submenu-title`]: {
      position: 'relative',
      display: 'block',
      margin: 0,
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      transition: [`border-color ${motionDurationSlow}`, `background ${motionDurationSlow}`, `padding calc(${motionDurationSlow} + 0.1s) ${motionEaseInOut}`].join(','),
      [`${componentCls}-item-icon, ${iconCls}`]: {
        minWidth: iconSize,
        fontSize: iconSize,
        transition: [`font-size ${motionDurationMid} ${motionEaseOut}`, `margin ${motionDurationSlow} ${motionEaseInOut}`, `color ${motionDurationSlow}`].join(','),
        '+ span': {
          marginInlineStart: iconMarginInlineEnd,
          opacity: 1,
          transition: [`opacity ${motionDurationSlow} ${motionEaseInOut}`, `margin ${motionDurationSlow}`, `color ${motionDurationSlow}`].join(',')
        }
      },
      [`${componentCls}-item-icon`]: Object.assign({}, (0,style/* resetIcon */.Nk)()),
      [`&${componentCls}-item-only-child`]: {
        [`> ${iconCls}, > ${componentCls}-item-icon`]: {
          marginInlineEnd: 0
        }
      }
    },
    // Disabled state sets text to gray and nukes hover/tab effects
    [`${componentCls}-item-disabled, ${componentCls}-submenu-disabled`]: {
      background: 'none !important',
      cursor: 'not-allowed',
      '&::after': {
        borderColor: 'transparent !important'
      },
      a: {
        color: 'inherit !important'
      },
      [`> ${componentCls}-submenu-title`]: {
        color: 'inherit !important',
        cursor: 'not-allowed'
      }
    }
  };
};
const genSubMenuArrowStyle = token => {
  const {
    componentCls,
    motionDurationSlow,
    motionEaseInOut,
    borderRadius,
    menuArrowSize,
    menuArrowOffset
  } = token;
  return {
    [`${componentCls}-submenu`]: {
      '&-expand-icon, &-arrow': {
        position: 'absolute',
        top: '50%',
        insetInlineEnd: token.margin,
        width: menuArrowSize,
        color: 'currentcolor',
        transform: 'translateY(-50%)',
        transition: `transform ${motionDurationSlow} ${motionEaseInOut}, opacity ${motionDurationSlow}`
      },
      '&-arrow': {
        // →
        '&::before, &::after': {
          position: 'absolute',
          width: token.calc(menuArrowSize).mul(0.6).equal(),
          height: token.calc(menuArrowSize).mul(0.15).equal(),
          backgroundColor: 'currentcolor',
          borderRadius,
          transition: [`background ${motionDurationSlow} ${motionEaseInOut}`, `transform ${motionDurationSlow} ${motionEaseInOut}`, `top ${motionDurationSlow} ${motionEaseInOut}`, `color ${motionDurationSlow} ${motionEaseInOut}`].join(','),
          content: '""'
        },
        '&::before': {
          transform: `rotate(45deg) translateY(${(0,cssinjs_es/* unit */.zA)(token.calc(menuArrowOffset).mul(-1).equal())})`
        },
        '&::after': {
          transform: `rotate(-45deg) translateY(${(0,cssinjs_es/* unit */.zA)(menuArrowOffset)})`
        }
      }
    }
  };
};
// =============================== Base ===============================
const getBaseStyle = token => {
  const {
    antCls,
    componentCls,
    fontSize,
    motionDurationSlow,
    motionDurationMid,
    motionEaseInOut,
    paddingXS,
    padding,
    colorSplit,
    lineWidth,
    zIndexPopup,
    borderRadiusLG,
    subMenuItemBorderRadius,
    menuArrowSize,
    menuArrowOffset,
    lineType,
    groupTitleLineHeight,
    groupTitleFontSize
  } = token;
  return [
  // Misc
  {
    '': {
      [componentCls]: Object.assign(Object.assign({}, (0,style/* clearFix */.t6)()), {
        // Hidden
        '&-hidden': {
          display: 'none'
        }
      })
    },
    [`${componentCls}-submenu-hidden`]: {
      display: 'none'
    }
  }, {
    [componentCls]: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), (0,style/* clearFix */.t6)()), {
      marginBottom: 0,
      paddingInlineStart: 0,
      // Override default ul/ol
      fontSize,
      lineHeight: 0,
      listStyle: 'none',
      outline: 'none',
      // Magic cubic here but smooth transition
      transition: `width ${motionDurationSlow} cubic-bezier(0.2, 0, 0, 1) 0s`,
      'ul, ol': {
        margin: 0,
        padding: 0,
        listStyle: 'none'
      },
      // Overflow ellipsis
      '&-overflow': {
        display: 'flex',
        [`${componentCls}-item`]: {
          flex: 'none'
        }
      },
      [`${componentCls}-item, ${componentCls}-submenu, ${componentCls}-submenu-title`]: {
        borderRadius: token.itemBorderRadius
      },
      [`${componentCls}-item-group-title`]: {
        padding: `${(0,cssinjs_es/* unit */.zA)(paddingXS)} ${(0,cssinjs_es/* unit */.zA)(padding)}`,
        fontSize: groupTitleFontSize,
        lineHeight: groupTitleLineHeight,
        transition: `all ${motionDurationSlow}`
      },
      [`&-horizontal ${componentCls}-submenu`]: {
        transition: [`border-color ${motionDurationSlow} ${motionEaseInOut}`, `background ${motionDurationSlow} ${motionEaseInOut}`].join(',')
      },
      [`${componentCls}-submenu, ${componentCls}-submenu-inline`]: {
        transition: [`border-color ${motionDurationSlow} ${motionEaseInOut}`, `background ${motionDurationSlow} ${motionEaseInOut}`, `padding ${motionDurationMid} ${motionEaseInOut}`].join(',')
      },
      [`${componentCls}-submenu ${componentCls}-sub`]: {
        cursor: 'initial',
        transition: [`background ${motionDurationSlow} ${motionEaseInOut}`, `padding ${motionDurationSlow} ${motionEaseInOut}`].join(',')
      },
      [`${componentCls}-title-content`]: {
        transition: `color ${motionDurationSlow}`,
        '&-with-extra': {
          display: 'inline-flex',
          alignItems: 'center',
          width: '100%'
        },
        // https://github.com/ant-design/ant-design/issues/41143
        [`> ${antCls}-typography-ellipsis-single-line`]: {
          display: 'inline',
          verticalAlign: 'unset'
        },
        [`${componentCls}-item-extra`]: {
          marginInlineStart: 'auto',
          paddingInlineStart: token.padding,
          fontSize: token.fontSizeSM
        }
      },
      [`${componentCls}-item a`]: {
        '&::before': {
          position: 'absolute',
          inset: 0,
          backgroundColor: 'transparent',
          content: '""'
        }
      },
      // Removed a Badge related style seems it's safe
      // https://github.com/ant-design/ant-design/issues/19809
      // >>>>> Divider
      [`${componentCls}-item-divider`]: {
        overflow: 'hidden',
        lineHeight: 0,
        borderColor: colorSplit,
        borderStyle: lineType,
        borderWidth: 0,
        borderTopWidth: lineWidth,
        marginBlock: lineWidth,
        padding: 0,
        '&-dashed': {
          borderStyle: 'dashed'
        }
      }
    }), genMenuItemStyle(token)), {
      [`${componentCls}-item-group`]: {
        [`${componentCls}-item-group-list`]: {
          margin: 0,
          padding: 0,
          [`${componentCls}-item, ${componentCls}-submenu-title`]: {
            paddingInline: `${(0,cssinjs_es/* unit */.zA)(token.calc(fontSize).mul(2).equal())} ${(0,cssinjs_es/* unit */.zA)(padding)}`
          }
        }
      },
      // ======================= Sub Menu =======================
      '&-submenu': {
        '&-popup': {
          position: 'absolute',
          zIndex: zIndexPopup,
          borderRadius: borderRadiusLG,
          boxShadow: 'none',
          transformOrigin: '0 0',
          [`&${componentCls}-submenu`]: {
            background: 'transparent'
          },
          // https://github.com/ant-design/ant-design/issues/13955
          '&::before': {
            position: 'absolute',
            inset: 0,
            zIndex: -1,
            width: '100%',
            height: '100%',
            opacity: 0,
            content: '""'
          },
          [`> ${componentCls}`]: Object.assign(Object.assign(Object.assign({
            borderRadius: borderRadiusLG
          }, genMenuItemStyle(token)), genSubMenuArrowStyle(token)), {
            [`${componentCls}-item, ${componentCls}-submenu > ${componentCls}-submenu-title`]: {
              borderRadius: subMenuItemBorderRadius
            },
            [`${componentCls}-submenu-title::after`]: {
              transition: `transform ${motionDurationSlow} ${motionEaseInOut}`
            }
          })
        },
        [`
          &-placement-leftTop,
          &-placement-bottomRight,
          `]: {
          transformOrigin: '100% 0'
        },
        [`
          &-placement-leftBottom,
          &-placement-topRight,
          `]: {
          transformOrigin: '100% 100%'
        },
        [`
          &-placement-rightBottom,
          &-placement-topLeft,
          `]: {
          transformOrigin: '0 100%'
        },
        [`
          &-placement-bottomLeft,
          &-placement-rightTop,
          `]: {
          transformOrigin: '0 0'
        },
        [`
          &-placement-leftTop,
          &-placement-leftBottom
          `]: {
          paddingInlineEnd: token.paddingXS
        },
        [`
          &-placement-rightTop,
          &-placement-rightBottom
          `]: {
          paddingInlineStart: token.paddingXS
        },
        [`
          &-placement-topRight,
          &-placement-topLeft
          `]: {
          paddingBottom: token.paddingXS
        },
        [`
          &-placement-bottomRight,
          &-placement-bottomLeft
          `]: {
          paddingTop: token.paddingXS
        }
      }
    }), genSubMenuArrowStyle(token)), {
      [`&-inline-collapsed ${componentCls}-submenu-arrow,
        &-inline ${componentCls}-submenu-arrow`]: {
        // ↓
        '&::before': {
          transform: `rotate(-45deg) translateX(${(0,cssinjs_es/* unit */.zA)(menuArrowOffset)})`
        },
        '&::after': {
          transform: `rotate(45deg) translateX(${(0,cssinjs_es/* unit */.zA)(token.calc(menuArrowOffset).mul(-1).equal())})`
        }
      },
      [`${componentCls}-submenu-open${componentCls}-submenu-inline > ${componentCls}-submenu-title > ${componentCls}-submenu-arrow`]: {
        // ↑
        transform: `translateY(${(0,cssinjs_es/* unit */.zA)(token.calc(menuArrowSize).mul(0.2).mul(-1).equal())})`,
        '&::after': {
          transform: `rotate(-45deg) translateX(${(0,cssinjs_es/* unit */.zA)(token.calc(menuArrowOffset).mul(-1).equal())})`
        },
        '&::before': {
          transform: `rotate(45deg) translateX(${(0,cssinjs_es/* unit */.zA)(menuArrowOffset)})`
        }
      }
    })
  },
  // Integration with header element so menu items have the same height
  {
    [`${antCls}-layout-header`]: {
      [componentCls]: {
        lineHeight: 'inherit'
      }
    }
  }];
};
const prepareComponentToken = token => {
  var _a, _b, _c;
  const {
    colorPrimary,
    colorError,
    colorTextDisabled,
    colorErrorBg,
    colorText,
    colorTextDescription,
    colorBgContainer,
    colorFillAlter,
    colorFillContent,
    lineWidth,
    lineWidthBold,
    controlItemBgActive,
    colorBgTextHover,
    controlHeightLG,
    lineHeight,
    colorBgElevated,
    marginXXS,
    padding,
    fontSize,
    controlHeightSM,
    fontSizeLG,
    colorTextLightSolid,
    colorErrorHover
  } = token;
  const activeBarWidth = (_a = token.activeBarWidth) !== null && _a !== void 0 ? _a : 0;
  const activeBarBorderWidth = (_b = token.activeBarBorderWidth) !== null && _b !== void 0 ? _b : lineWidth;
  const itemMarginInline = (_c = token.itemMarginInline) !== null && _c !== void 0 ? _c : token.marginXXS;
  const colorTextDark = new dist_module/* TinyColor */.q(colorTextLightSolid).setAlpha(0.65).toRgbString();
  return {
    dropdownWidth: 160,
    zIndexPopup: token.zIndexPopupBase + 50,
    radiusItem: token.borderRadiusLG,
    itemBorderRadius: token.borderRadiusLG,
    radiusSubMenuItem: token.borderRadiusSM,
    subMenuItemBorderRadius: token.borderRadiusSM,
    colorItemText: colorText,
    itemColor: colorText,
    colorItemTextHover: colorText,
    itemHoverColor: colorText,
    colorItemTextHoverHorizontal: colorPrimary,
    horizontalItemHoverColor: colorPrimary,
    colorGroupTitle: colorTextDescription,
    groupTitleColor: colorTextDescription,
    colorItemTextSelected: colorPrimary,
    itemSelectedColor: colorPrimary,
    colorItemTextSelectedHorizontal: colorPrimary,
    horizontalItemSelectedColor: colorPrimary,
    colorItemBg: colorBgContainer,
    itemBg: colorBgContainer,
    colorItemBgHover: colorBgTextHover,
    itemHoverBg: colorBgTextHover,
    colorItemBgActive: colorFillContent,
    itemActiveBg: controlItemBgActive,
    colorSubItemBg: colorFillAlter,
    subMenuItemBg: colorFillAlter,
    colorItemBgSelected: controlItemBgActive,
    itemSelectedBg: controlItemBgActive,
    colorItemBgSelectedHorizontal: 'transparent',
    horizontalItemSelectedBg: 'transparent',
    colorActiveBarWidth: 0,
    activeBarWidth,
    colorActiveBarHeight: lineWidthBold,
    activeBarHeight: lineWidthBold,
    colorActiveBarBorderSize: lineWidth,
    activeBarBorderWidth,
    // Disabled
    colorItemTextDisabled: colorTextDisabled,
    itemDisabledColor: colorTextDisabled,
    // Danger
    colorDangerItemText: colorError,
    dangerItemColor: colorError,
    colorDangerItemTextHover: colorError,
    dangerItemHoverColor: colorError,
    colorDangerItemTextSelected: colorError,
    dangerItemSelectedColor: colorError,
    colorDangerItemBgActive: colorErrorBg,
    dangerItemActiveBg: colorErrorBg,
    colorDangerItemBgSelected: colorErrorBg,
    dangerItemSelectedBg: colorErrorBg,
    itemMarginInline,
    horizontalItemBorderRadius: 0,
    horizontalItemHoverBg: 'transparent',
    itemHeight: controlHeightLG,
    groupTitleLineHeight: lineHeight,
    collapsedWidth: controlHeightLG * 2,
    popupBg: colorBgElevated,
    itemMarginBlock: marginXXS,
    itemPaddingInline: padding,
    horizontalLineHeight: `${controlHeightLG * 1.15}px`,
    iconSize: fontSize,
    iconMarginInlineEnd: controlHeightSM - fontSize,
    collapsedIconSize: fontSizeLG,
    groupTitleFontSize: fontSize,
    // Disabled
    darkItemDisabledColor: new dist_module/* TinyColor */.q(colorTextLightSolid).setAlpha(0.25).toRgbString(),
    // Dark
    darkItemColor: colorTextDark,
    darkDangerItemColor: colorError,
    darkItemBg: '#001529',
    darkPopupBg: '#001529',
    darkSubMenuItemBg: '#000c17',
    darkItemSelectedColor: colorTextLightSolid,
    darkItemSelectedBg: colorPrimary,
    darkDangerItemSelectedBg: colorError,
    darkItemHoverBg: 'transparent',
    darkGroupTitleColor: colorTextDark,
    darkItemHoverColor: colorTextLightSolid,
    darkDangerItemHoverColor: colorErrorHover,
    darkDangerItemSelectedColor: colorTextLightSolid,
    darkDangerItemActiveBg: colorError,
    // internal
    itemWidth: activeBarWidth ? `calc(100% + ${activeBarBorderWidth}px)` : `calc(100% - ${itemMarginInline * 2}px)`
  };
};
// ============================== Export ==============================
/* harmony default export */ var menu_style = (function (prefixCls) {
  let rootCls = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : prefixCls;
  let injectStyle = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
  const useStyle = (0,genStyleUtils/* genStyleHooks */.OF)('Menu', token => {
    const {
      colorBgElevated,
      controlHeightLG,
      fontSize,
      darkItemColor,
      darkDangerItemColor,
      darkItemBg,
      darkSubMenuItemBg,
      darkItemSelectedColor,
      darkItemSelectedBg,
      darkDangerItemSelectedBg,
      darkItemHoverBg,
      darkGroupTitleColor,
      darkItemHoverColor,
      darkItemDisabledColor,
      darkDangerItemHoverColor,
      darkDangerItemSelectedColor,
      darkDangerItemActiveBg,
      popupBg,
      darkPopupBg
    } = token;
    const menuArrowSize = token.calc(fontSize).div(7).mul(5).equal();
    // Menu Token
    const menuToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
      menuArrowSize,
      menuHorizontalHeight: token.calc(controlHeightLG).mul(1.15).equal(),
      menuArrowOffset: token.calc(menuArrowSize).mul(0.25).equal(),
      menuSubMenuBg: colorBgElevated,
      calc: token.calc,
      popupBg
    });
    const menuDarkToken = (0,cssinjs_utils_es/* mergeToken */.oX)(menuToken, {
      itemColor: darkItemColor,
      itemHoverColor: darkItemHoverColor,
      groupTitleColor: darkGroupTitleColor,
      itemSelectedColor: darkItemSelectedColor,
      itemBg: darkItemBg,
      popupBg: darkPopupBg,
      subMenuItemBg: darkSubMenuItemBg,
      itemActiveBg: 'transparent',
      itemSelectedBg: darkItemSelectedBg,
      activeBarHeight: 0,
      activeBarBorderWidth: 0,
      itemHoverBg: darkItemHoverBg,
      // Disabled
      itemDisabledColor: darkItemDisabledColor,
      // Danger
      dangerItemColor: darkDangerItemColor,
      dangerItemHoverColor: darkDangerItemHoverColor,
      dangerItemSelectedColor: darkDangerItemSelectedColor,
      dangerItemActiveBg: darkDangerItemActiveBg,
      dangerItemSelectedBg: darkDangerItemSelectedBg,
      menuSubMenuBg: darkSubMenuItemBg,
      // Horizontal
      horizontalItemSelectedColor: darkItemSelectedColor,
      horizontalItemSelectedBg: darkItemSelectedBg
    });
    return [
    // Basic
    getBaseStyle(menuToken),
    // Horizontal
    horizontal(menuToken),
    // Hard code for some light style
    // Vertical
    vertical(menuToken),
    // Hard code for some light style
    // Theme
    theme(menuToken, 'light'), theme(menuDarkToken, 'dark'),
    // RTL
    rtl(menuToken),
    // Motion
    (0,collapse/* default */.A)(menuToken), (0,slide/* initSlideMotion */._j)(menuToken, 'slide-up'), (0,slide/* initSlideMotion */._j)(menuToken, 'slide-down'), (0,zoom/* initZoomMotion */.aB)(menuToken, 'zoom-big')];
  }, prepareComponentToken, {
    deprecatedTokens: [['colorGroupTitle', 'groupTitleColor'], ['radiusItem', 'itemBorderRadius'], ['radiusSubMenuItem', 'subMenuItemBorderRadius'], ['colorItemText', 'itemColor'], ['colorItemTextHover', 'itemHoverColor'], ['colorItemTextHoverHorizontal', 'horizontalItemHoverColor'], ['colorItemTextSelected', 'itemSelectedColor'], ['colorItemTextSelectedHorizontal', 'horizontalItemSelectedColor'], ['colorItemTextDisabled', 'itemDisabledColor'], ['colorDangerItemText', 'dangerItemColor'], ['colorDangerItemTextHover', 'dangerItemHoverColor'], ['colorDangerItemTextSelected', 'dangerItemSelectedColor'], ['colorDangerItemBgActive', 'dangerItemActiveBg'], ['colorDangerItemBgSelected', 'dangerItemSelectedBg'], ['colorItemBg', 'itemBg'], ['colorItemBgHover', 'itemHoverBg'], ['colorSubItemBg', 'subMenuItemBg'], ['colorItemBgActive', 'itemActiveBg'], ['colorItemBgSelectedHorizontal', 'horizontalItemSelectedBg'], ['colorActiveBarWidth', 'activeBarWidth'], ['colorActiveBarHeight', 'activeBarHeight'], ['colorActiveBarBorderSize', 'activeBarBorderWidth'], ['colorItemBgSelected', 'itemSelectedBg']],
    // Dropdown will handle menu style self. We do not need to handle this.
    injectStyle,
    unitless: {
      groupTitleLineHeight: true
    }
  });
  return useStyle(prefixCls, rootCls);
});
// EXTERNAL MODULE: ./node_modules/antd/es/_util/hooks/useZIndex.js
var useZIndex = __webpack_require__(60275);
;// ./node_modules/antd/es/menu/SubMenu.js
"use client";








const SubMenu = props => {
  var _a;
  const {
    popupClassName,
    icon,
    title,
    theme: customTheme
  } = props;
  const context = react.useContext(menu_MenuContext);
  const {
    prefixCls,
    inlineCollapsed,
    theme: contextTheme
  } = context;
  const parentPath = (0,es/* useFullPath */.Wj)();
  let titleNode;
  if (!icon) {
    titleNode = inlineCollapsed && !parentPath.length && title && typeof title === 'string' ? (/*#__PURE__*/react.createElement("div", {
      className: `${prefixCls}-inline-collapsed-noicon`
    }, title.charAt(0))) : (/*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-title-content`
    }, title));
  } else {
    // inline-collapsed.md demo 依赖 span 来隐藏文字,有 icon 属性，则内部包裹一个 span
    // ref: https://github.com/ant-design/ant-design/pull/23456
    const titleIsSpan = /*#__PURE__*/react.isValidElement(title) && title.type === 'span';
    titleNode = /*#__PURE__*/react.createElement(react.Fragment, null, (0,reactNode/* cloneElement */.Ob)(icon, {
      className: classnames_default()(/*#__PURE__*/react.isValidElement(icon) ? (_a = icon.props) === null || _a === void 0 ? void 0 : _a.className : '', `${prefixCls}-item-icon`)
    }), titleIsSpan ? title : /*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-title-content`
    }, title));
  }
  const contextValue = react.useMemo(() => Object.assign(Object.assign({}, context), {
    firstLevel: false
  }), [context]);
  // ============================ zIndex ============================
  const [zIndex] = (0,useZIndex/* useZIndex */.YK)('Menu');
  return /*#__PURE__*/react.createElement(menu_MenuContext.Provider, {
    value: contextValue
  }, /*#__PURE__*/react.createElement(es/* SubMenu */.g8, Object.assign({}, (0,es_omit/* default */.A)(props, ['icon']), {
    title: titleNode,
    popupClassName: classnames_default()(prefixCls, popupClassName, `${prefixCls}-${customTheme || contextTheme}`),
    popupStyle: Object.assign({
      zIndex
    }, props.popupStyle)
  })));
};
/* harmony default export */ var menu_SubMenu = (SubMenu);
;// ./node_modules/antd/es/menu/menu.js
"use client";

var menu_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};


















function isEmptyIcon(icon) {
  return icon === null || icon === false;
}
const MENU_COMPONENTS = {
  item: menu_MenuItem,
  submenu: menu_SubMenu,
  divider: menu_MenuDivider
};
const InternalMenu = /*#__PURE__*/(0,react.forwardRef)((props, ref) => {
  var _a;
  const override = react.useContext(OverrideContext/* default */.h);
  const overrideObj = override || {};
  const {
    getPrefixCls,
    getPopupContainer,
    direction,
    menu
  } = react.useContext(context/* ConfigContext */.QO);
  const rootPrefixCls = getPrefixCls();
  const {
      prefixCls: customizePrefixCls,
      className,
      style,
      theme = 'light',
      expandIcon,
      _internalDisableMenuItemTitleTooltip,
      inlineCollapsed,
      siderCollapsed,
      rootClassName,
      mode,
      selectable,
      onClick,
      overflowedIndicatorPopupClassName
    } = props,
    restProps = menu_rest(props, ["prefixCls", "className", "style", "theme", "expandIcon", "_internalDisableMenuItemTitleTooltip", "inlineCollapsed", "siderCollapsed", "rootClassName", "mode", "selectable", "onClick", "overflowedIndicatorPopupClassName"]);
  const passedProps = (0,es_omit/* default */.A)(restProps, ['collapsedWidth']);
  // ======================== Warning ==========================
  if (false) {}
  (_a = overrideObj.validator) === null || _a === void 0 ? void 0 : _a.call(overrideObj, {
    mode
  });
  // ========================== Click ==========================
  // Tell dropdown that item clicked
  const onItemClick = (0,useEvent/* default */.A)(function () {
    var _a;
    onClick === null || onClick === void 0 ? void 0 : onClick.apply(void 0, arguments);
    (_a = overrideObj.onClick) === null || _a === void 0 ? void 0 : _a.call(overrideObj);
  });
  // ========================== Mode ===========================
  const mergedMode = overrideObj.mode || mode;
  // ======================= Selectable ========================
  const mergedSelectable = selectable !== null && selectable !== void 0 ? selectable : overrideObj.selectable;
  // ======================== Collapsed ========================
  // Inline Collapsed
  const mergedInlineCollapsed = inlineCollapsed !== null && inlineCollapsed !== void 0 ? inlineCollapsed : siderCollapsed;
  const defaultMotions = {
    horizontal: {
      motionName: `${rootPrefixCls}-slide-up`
    },
    inline: (0,motion/* default */.A)(rootPrefixCls),
    other: {
      motionName: `${rootPrefixCls}-zoom-big`
    }
  };
  const prefixCls = getPrefixCls('menu', customizePrefixCls || overrideObj.prefixCls);
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = menu_style(prefixCls, rootCls, !override);
  const menuClassName = classnames_default()(`${prefixCls}-${theme}`, menu === null || menu === void 0 ? void 0 : menu.className, className);
  // ====================== ExpandIcon ========================
  const mergedExpandIcon = react.useMemo(() => {
    var _a, _b;
    if (typeof expandIcon === 'function' || isEmptyIcon(expandIcon)) {
      return expandIcon || null;
    }
    if (typeof overrideObj.expandIcon === 'function' || isEmptyIcon(overrideObj.expandIcon)) {
      return overrideObj.expandIcon || null;
    }
    if (typeof (menu === null || menu === void 0 ? void 0 : menu.expandIcon) === 'function' || isEmptyIcon(menu === null || menu === void 0 ? void 0 : menu.expandIcon)) {
      return (menu === null || menu === void 0 ? void 0 : menu.expandIcon) || null;
    }
    const mergedIcon = (_a = expandIcon !== null && expandIcon !== void 0 ? expandIcon : overrideObj === null || overrideObj === void 0 ? void 0 : overrideObj.expandIcon) !== null && _a !== void 0 ? _a : menu === null || menu === void 0 ? void 0 : menu.expandIcon;
    return (0,reactNode/* cloneElement */.Ob)(mergedIcon, {
      className: classnames_default()(`${prefixCls}-submenu-expand-icon`, /*#__PURE__*/react.isValidElement(mergedIcon) ? (_b = mergedIcon.props) === null || _b === void 0 ? void 0 : _b.className : undefined)
    });
  }, [expandIcon, overrideObj === null || overrideObj === void 0 ? void 0 : overrideObj.expandIcon, menu === null || menu === void 0 ? void 0 : menu.expandIcon, prefixCls]);
  // ======================== Context ==========================
  const contextValue = react.useMemo(() => ({
    prefixCls,
    inlineCollapsed: mergedInlineCollapsed || false,
    direction,
    firstLevel: true,
    theme,
    mode: mergedMode,
    disableMenuItemTitleTooltip: _internalDisableMenuItemTitleTooltip
  }), [prefixCls, mergedInlineCollapsed, direction, _internalDisableMenuItemTitleTooltip, theme]);
  // ========================= Render ==========================
  return wrapCSSVar(/*#__PURE__*/react.createElement(OverrideContext/* default */.h.Provider, {
    value: null
  }, /*#__PURE__*/react.createElement(menu_MenuContext.Provider, {
    value: contextValue
  }, /*#__PURE__*/react.createElement(es/* default */.Ay, Object.assign({
    getPopupContainer: getPopupContainer,
    overflowedIndicator: /*#__PURE__*/react.createElement(EllipsisOutlined/* default */.A, null),
    overflowedIndicatorPopupClassName: classnames_default()(prefixCls, `${prefixCls}-${theme}`, overflowedIndicatorPopupClassName),
    mode: mergedMode,
    selectable: mergedSelectable,
    onClick: onItemClick
  }, passedProps, {
    inlineCollapsed: mergedInlineCollapsed,
    style: Object.assign(Object.assign({}, menu === null || menu === void 0 ? void 0 : menu.style), style),
    className: menuClassName,
    prefixCls: prefixCls,
    direction: direction,
    defaultMotions: defaultMotions,
    expandIcon: mergedExpandIcon,
    ref: ref,
    rootClassName: classnames_default()(rootClassName, hashId, overrideObj.rootClassName, cssVarCls, rootCls),
    _internalComponents: MENU_COMPONENTS
  })))));
});
/* harmony default export */ var menu = (InternalMenu);
;// ./node_modules/antd/es/menu/index.js
"use client";









const Menu = /*#__PURE__*/(0,react.forwardRef)((props, ref) => {
  const menuRef = (0,react.useRef)(null);
  const context = react.useContext(SiderContext);
  (0,react.useImperativeHandle)(ref, () => ({
    menu: menuRef.current,
    focus: options => {
      var _a;
      (_a = menuRef.current) === null || _a === void 0 ? void 0 : _a.focus(options);
    }
  }));
  return /*#__PURE__*/react.createElement(menu, Object.assign({
    ref: menuRef
  }, props, context));
});
Menu.Item = menu_MenuItem;
Menu.SubMenu = menu_SubMenu;
Menu.Divider = menu_MenuDivider;
Menu.ItemGroup = es/* ItemGroup */.te;
if (false) {}
/* harmony default export */ var es_menu = (Menu);

/***/ }),

/***/ 60977:
/***/ (function(__unused_webpack_module, __webpack_exports__) {

const genCollapseMotion = token => ({
  [token.componentCls]: {
    // For common/openAnimation
    [`${token.antCls}-motion-collapse-legacy`]: {
      overflow: 'hidden',
      '&-active': {
        transition: `height ${token.motionDurationMid} ${token.motionEaseInOut},
        opacity ${token.motionDurationMid} ${token.motionEaseInOut} !important`
      }
    },
    [`${token.antCls}-motion-collapse`]: {
      overflow: 'hidden',
      transition: `height ${token.motionDurationMid} ${token.motionEaseInOut},
        opacity ${token.motionDurationMid} ${token.motionEaseInOut} !important`
    }
  }
});
/* harmony default export */ __webpack_exports__.A = (genCollapseMotion);

/***/ }),

/***/ 38873:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* unused harmony export Checkbox */
/* harmony import */ var _babel_runtime_helpers_esm_extends__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(58168);
/* harmony import */ var _babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(89379);
/* harmony import */ var _babel_runtime_helpers_esm_defineProperty__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(64467);
/* harmony import */ var _babel_runtime_helpers_esm_slicedToArray__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(5544);
/* harmony import */ var _babel_runtime_helpers_esm_objectWithoutProperties__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(80045);
/* harmony import */ var classnames__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(46942);
/* harmony import */ var classnames__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(classnames__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var rc_util_es_hooks_useMergedState__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(12533);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(96540);





var _excluded = ["prefixCls", "className", "style", "checked", "disabled", "defaultChecked", "type", "title", "onChange"];




var Checkbox = /*#__PURE__*/(0,react__WEBPACK_IMPORTED_MODULE_2__.forwardRef)(function (props, ref) {
  var _props$prefixCls = props.prefixCls,
    prefixCls = _props$prefixCls === void 0 ? 'rc-checkbox' : _props$prefixCls,
    className = props.className,
    style = props.style,
    checked = props.checked,
    disabled = props.disabled,
    _props$defaultChecked = props.defaultChecked,
    defaultChecked = _props$defaultChecked === void 0 ? false : _props$defaultChecked,
    _props$type = props.type,
    type = _props$type === void 0 ? 'checkbox' : _props$type,
    title = props.title,
    onChange = props.onChange,
    inputProps = (0,_babel_runtime_helpers_esm_objectWithoutProperties__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .A)(props, _excluded);
  var inputRef = (0,react__WEBPACK_IMPORTED_MODULE_2__.useRef)(null);
  var holderRef = (0,react__WEBPACK_IMPORTED_MODULE_2__.useRef)(null);
  var _useMergedState = (0,rc_util_es_hooks_useMergedState__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)(defaultChecked, {
      value: checked
    }),
    _useMergedState2 = (0,_babel_runtime_helpers_esm_slicedToArray__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A)(_useMergedState, 2),
    rawValue = _useMergedState2[0],
    setRawValue = _useMergedState2[1];
  (0,react__WEBPACK_IMPORTED_MODULE_2__.useImperativeHandle)(ref, function () {
    return {
      focus: function focus(options) {
        var _inputRef$current;
        (_inputRef$current = inputRef.current) === null || _inputRef$current === void 0 || _inputRef$current.focus(options);
      },
      blur: function blur() {
        var _inputRef$current2;
        (_inputRef$current2 = inputRef.current) === null || _inputRef$current2 === void 0 || _inputRef$current2.blur();
      },
      input: inputRef.current,
      nativeElement: holderRef.current
    };
  });
  var classString = classnames__WEBPACK_IMPORTED_MODULE_0___default()(prefixCls, className, (0,_babel_runtime_helpers_esm_defineProperty__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A)((0,_babel_runtime_helpers_esm_defineProperty__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A)({}, "".concat(prefixCls, "-checked"), rawValue), "".concat(prefixCls, "-disabled"), disabled));
  var handleChange = function handleChange(e) {
    if (disabled) {
      return;
    }
    if (!('checked' in props)) {
      setRawValue(e.target.checked);
    }
    onChange === null || onChange === void 0 || onChange({
      target: (0,_babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A)((0,_babel_runtime_helpers_esm_objectSpread2__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A)({}, props), {}, {
        type: type,
        checked: e.target.checked
      }),
      stopPropagation: function stopPropagation() {
        e.stopPropagation();
      },
      preventDefault: function preventDefault() {
        e.preventDefault();
      },
      nativeEvent: e.nativeEvent
    });
  };
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
    className: classString,
    title: title,
    style: style,
    ref: holderRef
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("input", (0,_babel_runtime_helpers_esm_extends__WEBPACK_IMPORTED_MODULE_7__/* ["default"] */ .A)({}, inputProps, {
    className: "".concat(prefixCls, "-input"),
    ref: inputRef,
    onChange: handleChange,
    disabled: disabled,
    checked: !!rawValue,
    type: type
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
    className: "".concat(prefixCls, "-inner")
  }));
});
/* harmony default export */ __webpack_exports__.A = (Checkbox);

/***/ })

}]);
//# sourceMappingURL=e9b945f1fa7f29064e4dd2f49c0aae81d1129772-199cfbf63fbd7595a75c.js.map