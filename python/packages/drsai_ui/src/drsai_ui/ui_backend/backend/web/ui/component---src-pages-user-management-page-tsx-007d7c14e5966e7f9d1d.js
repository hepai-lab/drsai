"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[7578],{

/***/ 70064:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ useClosable; },
/* harmony export */   d: function() { return /* binding */ pickClosable; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _ant_design_icons_es_icons_CloseOutlined__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(47852);
/* harmony import */ var rc_util_es_pickAttrs__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(72065);
"use client";




function pickClosable(context) {
  if (!context) {
    return undefined;
  }
  return {
    closable: context.closable,
    closeIcon: context.closeIcon
  };
}
/** Convert `closable` and `closeIcon` to config object */
function useClosableConfig(closableCollection) {
  const {
    closable,
    closeIcon
  } = closableCollection || {};
  return react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    if (
    // If `closable`, whatever rest be should be true
    !closable && (closable === false || closeIcon === false || closeIcon === null)) {
      return false;
    }
    if (closable === undefined && closeIcon === undefined) {
      return null;
    }
    let closableConfig = {
      closeIcon: typeof closeIcon !== 'boolean' && closeIcon !== null ? closeIcon : undefined
    };
    if (closable && typeof closable === 'object') {
      closableConfig = Object.assign(Object.assign({}, closableConfig), closable);
    }
    return closableConfig;
  }, [closable, closeIcon]);
}
/**
 * Assign object without `undefined` field. Will skip if is `false`.
 * This helps to handle both closableConfig or false
 */
function assignWithoutUndefined() {
  const target = {};
  for (var _len = arguments.length, objList = new Array(_len), _key = 0; _key < _len; _key++) {
    objList[_key] = arguments[_key];
  }
  objList.forEach(obj => {
    if (obj) {
      Object.keys(obj).forEach(key => {
        if (obj[key] !== undefined) {
          target[key] = obj[key];
        }
      });
    }
  });
  return target;
}
/** Use same object to support `useMemo` optimization */
const EmptyFallbackCloseCollection = {};
function useClosable(propCloseCollection, contextCloseCollection) {
  let fallbackCloseCollection = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : EmptyFallbackCloseCollection;
  // Align the `props`, `context` `fallback` to config object first
  const propCloseConfig = useClosableConfig(propCloseCollection);
  const contextCloseConfig = useClosableConfig(contextCloseCollection);
  const closeBtnIsDisabled = typeof propCloseConfig !== 'boolean' ? !!(propCloseConfig === null || propCloseConfig === void 0 ? void 0 : propCloseConfig.disabled) : false;
  const mergedFallbackCloseCollection = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => Object.assign({
    closeIcon: /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_ant_design_icons_es_icons_CloseOutlined__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A, null)
  }, fallbackCloseCollection), [fallbackCloseCollection]);
  // Use fallback logic to fill the config
  const mergedClosableConfig = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    // ================ Props First ================
    // Skip if prop is disabled
    if (propCloseConfig === false) {
      return false;
    }
    if (propCloseConfig) {
      return assignWithoutUndefined(mergedFallbackCloseCollection, contextCloseConfig, propCloseConfig);
    }
    // =============== Context Second ==============
    // Skip if context is disabled
    if (contextCloseConfig === false) {
      return false;
    }
    if (contextCloseConfig) {
      return assignWithoutUndefined(mergedFallbackCloseCollection, contextCloseConfig);
    }
    // ============= Fallback Default ==============
    return !mergedFallbackCloseCollection.closable ? false : mergedFallbackCloseCollection;
  }, [propCloseConfig, contextCloseConfig, mergedFallbackCloseCollection]);
  // Calculate the final closeIcon
  return react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    if (mergedClosableConfig === false) {
      return [false, null, closeBtnIsDisabled];
    }
    const {
      closeIconRender
    } = mergedFallbackCloseCollection;
    const {
      closeIcon
    } = mergedClosableConfig;
    let mergedCloseIcon = closeIcon;
    if (mergedCloseIcon !== null && mergedCloseIcon !== undefined) {
      // Wrap the closeIcon if needed
      if (closeIconRender) {
        mergedCloseIcon = closeIconRender(closeIcon);
      }
      // Wrap the closeIcon with aria props
      const ariaProps = (0,rc_util_es_pickAttrs__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A)(mergedClosableConfig, true);
      if (Object.keys(ariaProps).length) {
        mergedCloseIcon = /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.isValidElement(mergedCloseIcon) ? (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.cloneElement(mergedCloseIcon, ariaProps)) : (/*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", Object.assign({}, ariaProps), mergedCloseIcon));
      }
    }
    return [true, mergedCloseIcon, closeBtnIsDisabled];
  }, [mergedClosableConfig, mergedFallbackCloseCollection]);
}

/***/ }),

/***/ 12609:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ es_switch; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/LoadingOutlined.js + 1 modules
var LoadingOutlined = __webpack_require__(93567);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
var objectWithoutProperties = __webpack_require__(80045);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
// EXTERNAL MODULE: ./node_modules/rc-util/es/KeyCode.js
var KeyCode = __webpack_require__(16928);
;// ./node_modules/rc-switch/es/index.js




var _excluded = ["prefixCls", "className", "checked", "defaultChecked", "disabled", "loadingIcon", "checkedChildren", "unCheckedChildren", "onClick", "onChange", "onKeyDown"];




var Switch = /*#__PURE__*/react.forwardRef(function (_ref, ref) {
  var _classNames;
  var _ref$prefixCls = _ref.prefixCls,
    prefixCls = _ref$prefixCls === void 0 ? 'rc-switch' : _ref$prefixCls,
    className = _ref.className,
    checked = _ref.checked,
    defaultChecked = _ref.defaultChecked,
    disabled = _ref.disabled,
    loadingIcon = _ref.loadingIcon,
    checkedChildren = _ref.checkedChildren,
    unCheckedChildren = _ref.unCheckedChildren,
    onClick = _ref.onClick,
    onChange = _ref.onChange,
    onKeyDown = _ref.onKeyDown,
    restProps = (0,objectWithoutProperties/* default */.A)(_ref, _excluded);
  var _useMergedState = (0,useMergedState/* default */.A)(false, {
      value: checked,
      defaultValue: defaultChecked
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    innerChecked = _useMergedState2[0],
    setInnerChecked = _useMergedState2[1];
  function triggerChange(newChecked, event) {
    var mergedChecked = innerChecked;
    if (!disabled) {
      mergedChecked = newChecked;
      setInnerChecked(mergedChecked);
      onChange === null || onChange === void 0 ? void 0 : onChange(mergedChecked, event);
    }
    return mergedChecked;
  }
  function onInternalKeyDown(e) {
    if (e.which === KeyCode/* default */.A.LEFT) {
      triggerChange(false, e);
    } else if (e.which === KeyCode/* default */.A.RIGHT) {
      triggerChange(true, e);
    }
    onKeyDown === null || onKeyDown === void 0 ? void 0 : onKeyDown(e);
  }
  function onInternalClick(e) {
    var ret = triggerChange(!innerChecked, e);
    // [Legacy] trigger onClick with value
    onClick === null || onClick === void 0 ? void 0 : onClick(ret, e);
  }
  var switchClassName = classnames_default()(prefixCls, className, (_classNames = {}, (0,defineProperty/* default */.A)(_classNames, "".concat(prefixCls, "-checked"), innerChecked), (0,defineProperty/* default */.A)(_classNames, "".concat(prefixCls, "-disabled"), disabled), _classNames));
  return /*#__PURE__*/react.createElement("button", (0,esm_extends/* default */.A)({}, restProps, {
    type: "button",
    role: "switch",
    "aria-checked": innerChecked,
    disabled: disabled,
    className: switchClassName,
    ref: ref,
    onKeyDown: onInternalKeyDown,
    onClick: onInternalClick
  }), loadingIcon, /*#__PURE__*/react.createElement("span", {
    className: "".concat(prefixCls, "-inner")
  }, /*#__PURE__*/react.createElement("span", {
    className: "".concat(prefixCls, "-inner-checked")
  }, checkedChildren), /*#__PURE__*/react.createElement("span", {
    className: "".concat(prefixCls, "-inner-unchecked")
  }, unCheckedChildren)));
});
Switch.displayName = 'Switch';
/* harmony default export */ var es = (Switch);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/wave/index.js + 4 modules
var wave = __webpack_require__(57);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/DisabledContext.js
var DisabledContext = __webpack_require__(98119);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/@ctrl/tinycolor/dist/module/index.js
var dist_module = __webpack_require__(24978);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
;// ./node_modules/antd/es/switch/style/index.js




const genSwitchSmallStyle = token => {
  const {
    componentCls,
    trackHeightSM,
    trackPadding,
    trackMinWidthSM,
    innerMinMarginSM,
    innerMaxMarginSM,
    handleSizeSM,
    calc
  } = token;
  const switchInnerCls = `${componentCls}-inner`;
  const trackPaddingCalc = (0,cssinjs_es/* unit */.zA)(calc(handleSizeSM).add(calc(trackPadding).mul(2)).equal());
  const innerMaxMarginCalc = (0,cssinjs_es/* unit */.zA)(calc(innerMaxMarginSM).mul(2).equal());
  return {
    [componentCls]: {
      [`&${componentCls}-small`]: {
        minWidth: trackMinWidthSM,
        height: trackHeightSM,
        lineHeight: (0,cssinjs_es/* unit */.zA)(trackHeightSM),
        [`${componentCls}-inner`]: {
          paddingInlineStart: innerMaxMarginSM,
          paddingInlineEnd: innerMinMarginSM,
          [`${switchInnerCls}-checked, ${switchInnerCls}-unchecked`]: {
            minHeight: trackHeightSM
          },
          [`${switchInnerCls}-checked`]: {
            marginInlineStart: `calc(-100% + ${trackPaddingCalc} - ${innerMaxMarginCalc})`,
            marginInlineEnd: `calc(100% - ${trackPaddingCalc} + ${innerMaxMarginCalc})`
          },
          [`${switchInnerCls}-unchecked`]: {
            marginTop: calc(trackHeightSM).mul(-1).equal(),
            marginInlineStart: 0,
            marginInlineEnd: 0
          }
        },
        [`${componentCls}-handle`]: {
          width: handleSizeSM,
          height: handleSizeSM
        },
        [`${componentCls}-loading-icon`]: {
          top: calc(calc(handleSizeSM).sub(token.switchLoadingIconSize)).div(2).equal(),
          fontSize: token.switchLoadingIconSize
        },
        [`&${componentCls}-checked`]: {
          [`${componentCls}-inner`]: {
            paddingInlineStart: innerMinMarginSM,
            paddingInlineEnd: innerMaxMarginSM,
            [`${switchInnerCls}-checked`]: {
              marginInlineStart: 0,
              marginInlineEnd: 0
            },
            [`${switchInnerCls}-unchecked`]: {
              marginInlineStart: `calc(100% - ${trackPaddingCalc} + ${innerMaxMarginCalc})`,
              marginInlineEnd: `calc(-100% + ${trackPaddingCalc} - ${innerMaxMarginCalc})`
            }
          },
          [`${componentCls}-handle`]: {
            insetInlineStart: `calc(100% - ${(0,cssinjs_es/* unit */.zA)(calc(handleSizeSM).add(trackPadding).equal())})`
          }
        },
        [`&:not(${componentCls}-disabled):active`]: {
          [`&:not(${componentCls}-checked) ${switchInnerCls}`]: {
            [`${switchInnerCls}-unchecked`]: {
              marginInlineStart: calc(token.marginXXS).div(2).equal(),
              marginInlineEnd: calc(token.marginXXS).mul(-1).div(2).equal()
            }
          },
          [`&${componentCls}-checked ${switchInnerCls}`]: {
            [`${switchInnerCls}-checked`]: {
              marginInlineStart: calc(token.marginXXS).mul(-1).div(2).equal(),
              marginInlineEnd: calc(token.marginXXS).div(2).equal()
            }
          }
        }
      }
    }
  };
};
const genSwitchLoadingStyle = token => {
  const {
    componentCls,
    handleSize,
    calc
  } = token;
  return {
    [componentCls]: {
      [`${componentCls}-loading-icon${token.iconCls}`]: {
        position: 'relative',
        top: calc(calc(handleSize).sub(token.fontSize)).div(2).equal(),
        color: token.switchLoadingIconColor,
        verticalAlign: 'top'
      },
      [`&${componentCls}-checked ${componentCls}-loading-icon`]: {
        color: token.switchColor
      }
    }
  };
};
const genSwitchHandleStyle = token => {
  const {
    componentCls,
    trackPadding,
    handleBg,
    handleShadow,
    handleSize,
    calc
  } = token;
  const switchHandleCls = `${componentCls}-handle`;
  return {
    [componentCls]: {
      [switchHandleCls]: {
        position: 'absolute',
        top: trackPadding,
        insetInlineStart: trackPadding,
        width: handleSize,
        height: handleSize,
        transition: `all ${token.switchDuration} ease-in-out`,
        '&::before': {
          position: 'absolute',
          top: 0,
          insetInlineEnd: 0,
          bottom: 0,
          insetInlineStart: 0,
          backgroundColor: handleBg,
          borderRadius: calc(handleSize).div(2).equal(),
          boxShadow: handleShadow,
          transition: `all ${token.switchDuration} ease-in-out`,
          content: '""'
        }
      },
      [`&${componentCls}-checked ${switchHandleCls}`]: {
        insetInlineStart: `calc(100% - ${(0,cssinjs_es/* unit */.zA)(calc(handleSize).add(trackPadding).equal())})`
      },
      [`&:not(${componentCls}-disabled):active`]: {
        [`${switchHandleCls}::before`]: {
          insetInlineEnd: token.switchHandleActiveInset,
          insetInlineStart: 0
        },
        [`&${componentCls}-checked ${switchHandleCls}::before`]: {
          insetInlineEnd: 0,
          insetInlineStart: token.switchHandleActiveInset
        }
      }
    }
  };
};
const genSwitchInnerStyle = token => {
  const {
    componentCls,
    trackHeight,
    trackPadding,
    innerMinMargin,
    innerMaxMargin,
    handleSize,
    calc
  } = token;
  const switchInnerCls = `${componentCls}-inner`;
  const trackPaddingCalc = (0,cssinjs_es/* unit */.zA)(calc(handleSize).add(calc(trackPadding).mul(2)).equal());
  const innerMaxMarginCalc = (0,cssinjs_es/* unit */.zA)(calc(innerMaxMargin).mul(2).equal());
  return {
    [componentCls]: {
      [switchInnerCls]: {
        display: 'block',
        overflow: 'hidden',
        borderRadius: 100,
        height: '100%',
        paddingInlineStart: innerMaxMargin,
        paddingInlineEnd: innerMinMargin,
        transition: `padding-inline-start ${token.switchDuration} ease-in-out, padding-inline-end ${token.switchDuration} ease-in-out`,
        [`${switchInnerCls}-checked, ${switchInnerCls}-unchecked`]: {
          display: 'block',
          color: token.colorTextLightSolid,
          fontSize: token.fontSizeSM,
          transition: `margin-inline-start ${token.switchDuration} ease-in-out, margin-inline-end ${token.switchDuration} ease-in-out`,
          pointerEvents: 'none',
          minHeight: trackHeight
        },
        [`${switchInnerCls}-checked`]: {
          marginInlineStart: `calc(-100% + ${trackPaddingCalc} - ${innerMaxMarginCalc})`,
          marginInlineEnd: `calc(100% - ${trackPaddingCalc} + ${innerMaxMarginCalc})`
        },
        [`${switchInnerCls}-unchecked`]: {
          marginTop: calc(trackHeight).mul(-1).equal(),
          marginInlineStart: 0,
          marginInlineEnd: 0
        }
      },
      [`&${componentCls}-checked ${switchInnerCls}`]: {
        paddingInlineStart: innerMinMargin,
        paddingInlineEnd: innerMaxMargin,
        [`${switchInnerCls}-checked`]: {
          marginInlineStart: 0,
          marginInlineEnd: 0
        },
        [`${switchInnerCls}-unchecked`]: {
          marginInlineStart: `calc(100% - ${trackPaddingCalc} + ${innerMaxMarginCalc})`,
          marginInlineEnd: `calc(-100% + ${trackPaddingCalc} - ${innerMaxMarginCalc})`
        }
      },
      [`&:not(${componentCls}-disabled):active`]: {
        [`&:not(${componentCls}-checked) ${switchInnerCls}`]: {
          [`${switchInnerCls}-unchecked`]: {
            marginInlineStart: calc(trackPadding).mul(2).equal(),
            marginInlineEnd: calc(trackPadding).mul(-1).mul(2).equal()
          }
        },
        [`&${componentCls}-checked ${switchInnerCls}`]: {
          [`${switchInnerCls}-checked`]: {
            marginInlineStart: calc(trackPadding).mul(-1).mul(2).equal(),
            marginInlineEnd: calc(trackPadding).mul(2).equal()
          }
        }
      }
    }
  };
};
const genSwitchStyle = token => {
  const {
    componentCls,
    trackHeight,
    trackMinWidth
  } = token;
  return {
    [componentCls]: Object.assign(Object.assign(Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      position: 'relative',
      display: 'inline-block',
      boxSizing: 'border-box',
      minWidth: trackMinWidth,
      height: trackHeight,
      lineHeight: (0,cssinjs_es/* unit */.zA)(trackHeight),
      verticalAlign: 'middle',
      background: token.colorTextQuaternary,
      border: '0',
      borderRadius: 100,
      cursor: 'pointer',
      transition: `all ${token.motionDurationMid}`,
      userSelect: 'none',
      [`&:hover:not(${componentCls}-disabled)`]: {
        background: token.colorTextTertiary
      }
    }), (0,style/* genFocusStyle */.K8)(token)), {
      [`&${componentCls}-checked`]: {
        background: token.switchColor,
        [`&:hover:not(${componentCls}-disabled)`]: {
          background: token.colorPrimaryHover
        }
      },
      [`&${componentCls}-loading, &${componentCls}-disabled`]: {
        cursor: 'not-allowed',
        opacity: token.switchDisabledOpacity,
        '*': {
          boxShadow: 'none',
          cursor: 'not-allowed'
        }
      },
      // rtl style
      [`&${componentCls}-rtl`]: {
        direction: 'rtl'
      }
    })
  };
};
// ============================== Export ==============================
const prepareComponentToken = token => {
  const {
    fontSize,
    lineHeight,
    controlHeight,
    colorWhite
  } = token;
  const height = fontSize * lineHeight;
  const heightSM = controlHeight / 2;
  const padding = 2; // Fixed value
  const handleSize = height - padding * 2;
  const handleSizeSM = heightSM - padding * 2;
  return {
    trackHeight: height,
    trackHeightSM: heightSM,
    trackMinWidth: handleSize * 2 + padding * 4,
    trackMinWidthSM: handleSizeSM * 2 + padding * 2,
    trackPadding: padding,
    // Fixed value
    handleBg: colorWhite,
    handleSize,
    handleSizeSM,
    handleShadow: `0 2px 4px 0 ${new dist_module/* TinyColor */.q('#00230b').setAlpha(0.2).toRgbString()}`,
    innerMinMargin: handleSize / 2,
    innerMaxMargin: handleSize + padding + padding * 2,
    innerMinMarginSM: handleSizeSM / 2,
    innerMaxMarginSM: handleSizeSM + padding + padding * 2
  };
};
/* harmony default export */ var switch_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Switch', token => {
  const switchToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    switchDuration: token.motionDurationMid,
    switchColor: token.colorPrimary,
    switchDisabledOpacity: token.opacityLoading,
    switchLoadingIconSize: token.calc(token.fontSizeIcon).mul(0.75).equal(),
    switchLoadingIconColor: `rgba(0, 0, 0, ${token.opacityLoading})`,
    switchHandleActiveInset: '-30%'
  });
  return [genSwitchStyle(switchToken),
  // inner style
  genSwitchInnerStyle(switchToken),
  // handle style
  genSwitchHandleStyle(switchToken),
  // loading style
  genSwitchLoadingStyle(switchToken),
  // small style
  genSwitchSmallStyle(switchToken)];
}, prepareComponentToken));
;// ./node_modules/antd/es/switch/index.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};










const InternalSwitch = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      prefixCls: customizePrefixCls,
      size: customizeSize,
      disabled: customDisabled,
      loading,
      className,
      rootClassName,
      style,
      checked: checkedProp,
      value,
      defaultChecked: defaultCheckedProp,
      defaultValue,
      onChange
    } = props,
    restProps = __rest(props, ["prefixCls", "size", "disabled", "loading", "className", "rootClassName", "style", "checked", "value", "defaultChecked", "defaultValue", "onChange"]);
  const [checked, setChecked] = (0,useMergedState/* default */.A)(false, {
    value: checkedProp !== null && checkedProp !== void 0 ? checkedProp : value,
    defaultValue: defaultCheckedProp !== null && defaultCheckedProp !== void 0 ? defaultCheckedProp : defaultValue
  });
  const {
    getPrefixCls,
    direction,
    switch: SWITCH
  } = react.useContext(context/* ConfigContext */.QO);
  // ===================== Disabled =====================
  const disabled = react.useContext(DisabledContext/* default */.A);
  const mergedDisabled = (customDisabled !== null && customDisabled !== void 0 ? customDisabled : disabled) || loading;
  const prefixCls = getPrefixCls('switch', customizePrefixCls);
  const loadingIcon = /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-handle`
  }, loading && /*#__PURE__*/react.createElement(LoadingOutlined/* default */.A, {
    className: `${prefixCls}-loading-icon`
  }));
  // Style
  const [wrapCSSVar, hashId, cssVarCls] = switch_style(prefixCls);
  const mergedSize = (0,useSize/* default */.A)(customizeSize);
  const classes = classnames_default()(SWITCH === null || SWITCH === void 0 ? void 0 : SWITCH.className, {
    [`${prefixCls}-small`]: mergedSize === 'small',
    [`${prefixCls}-loading`]: loading,
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, className, rootClassName, hashId, cssVarCls);
  const mergedStyle = Object.assign(Object.assign({}, SWITCH === null || SWITCH === void 0 ? void 0 : SWITCH.style), style);
  const changeHandler = function () {
    setChecked(arguments.length <= 0 ? undefined : arguments[0]);
    onChange === null || onChange === void 0 ? void 0 : onChange.apply(void 0, arguments);
  };
  return wrapCSSVar(/*#__PURE__*/react.createElement(wave/* default */.A, {
    component: "Switch"
  }, /*#__PURE__*/react.createElement(es, Object.assign({}, restProps, {
    checked: checked,
    onChange: changeHandler,
    prefixCls: prefixCls,
    className: classes,
    style: mergedStyle,
    disabled: mergedDisabled,
    ref: ref,
    loadingIcon: loadingIcon
  }))));
});
const switch_Switch = InternalSwitch;
switch_Switch.__ANT_SWITCH = true;
if (false) {}
/* harmony default export */ var es_switch = (switch_Switch);

/***/ }),

/***/ 35494:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(69036);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(56914);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(12609);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(46789);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(81917);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(29799);
/* harmony import */ var _hooks_provider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(92744);
/* harmony import */ var _components_views_api__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(39614);




const UserManagementPage = () => {
  const {
    user
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useContext)(_hooks_provider__WEBPACK_IMPORTED_MODULE_1__/* .appContext */ .v);
  const operatorUserId = (user === null || user === void 0 ? void 0 : user.email) || "";
  const {
    0: rows,
    1: setRows
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);
  const {
    0: loading,
    1: setLoading
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
  const {
    0: q,
    1: setQ
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)("");
  const [msgApi, holder] = antd__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .Ay.useMessage();
  const load = (0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async () => {
    if (!operatorUserId) {
      msgApi.error("未登录或缺少用户信息");
      return;
    }
    setLoading(true);
    try {
      const list = await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .userAPI */ .Eo.listUsers(operatorUserId);
      setRows(list.map(u => Object.assign({}, u, {
        key: u.user_id
      })));
    } catch (e) {
      msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "加载用户失败（可能你还不是管理员）");
    } finally {
      setLoading(false);
    }
  }, [operatorUserId, msgApi]);
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    if (!operatorUserId) return;
    void load();
  }, [operatorUserId, load]);
  const filtered = (0,react__WEBPACK_IMPORTED_MODULE_0__.useMemo)(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter(r => r.user_id.toLowerCase().includes(qq));
  }, [q, rows]);
  const columns = [{
    title: "用户",
    dataIndex: "user_id",
    key: "user_id",
    render: v => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "font-mono text-xs"
    }, v)
  }, {
    title: "来源",
    dataIndex: "auth_source",
    key: "auth_source",
    width: 120,
    render: v => v === "sso" ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
      color: "purple"
    }, "SSO") : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
      color: "blue"
    }, "LOCAL")
  }, {
    title: "合作组",
    key: "org",
    width: 160,
    render: (_, record) => record.org_slug ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "text-xs"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, null, record.org_slug), record.org_role ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "text-secondary ml-1"
    }, record.org_role) : null) : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "text-secondary text-xs"
    }, "\u2014")
  }, {
    title: "管理员",
    dataIndex: "is_admin",
    key: "is_admin",
    width: 120,
    render: (_, record) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .A, {
      checked: record.is_admin,
      onChange: async next => {
        if (!operatorUserId) return;
        const prev = record.is_admin;
        setRows(old => old.map(r => r.user_id === record.user_id ? Object.assign({}, r, {
          is_admin: next
        }) : r));
        try {
          await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .userAPI */ .Eo.setAdmin(operatorUserId, record.user_id, next);
          msgApi.success(next ? "已设为管理员" : "已取消管理员");
        } catch (e) {
          setRows(old => old.map(r => r.user_id === record.user_id ? Object.assign({}, r, {
            is_admin: prev
          }) : r));
          msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "更新失败");
        }
      }
    })
  }];
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "h-full min-h-0 flex flex-col p-4"
  }, holder, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex items-center justify-between gap-3 mb-3"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-base font-semibold text-primary"
  }, "\u7528\u6237\u7BA1\u7406"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-xs text-secondary mt-1"
  }, "\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650\u3002\u5F53\u524D\u64CD\u4F5C\u4EBA\uFF1A", /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
    className: "font-mono"
  }, operatorUserId || "-"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A, {
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "\u6309 user_id \u641C\u7D22",
    allowClear: true,
    style: {
      width: 220
    }
  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_7__/* ["default"] */ .Ay, {
    onClick: () => void load(),
    loading: loading,
    type: "primary"
  }, "\u5237\u65B0"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex-1 min-h-0"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_8__/* ["default"] */ .A, {
    size: "middle",
    bordered: true,
    loading: loading,
    columns: columns,
    dataSource: filtered,
    pagination: {
      pageSize: 20,
      showSizeChanger: true
    }
  })));
};
/* harmony default export */ __webpack_exports__["default"] = (UserManagementPage);

/***/ })

}]);
//# sourceMappingURL=component---src-pages-user-management-page-tsx-007d7c14e5966e7f9d1d.js.map