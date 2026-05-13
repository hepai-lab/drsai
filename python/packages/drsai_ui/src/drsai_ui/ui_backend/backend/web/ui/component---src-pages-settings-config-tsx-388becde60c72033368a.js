"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[6743],{

/***/ 56914:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ tag; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/colors.js
var colors = __webpack_require__(54121);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/hooks/useClosable.js
var useClosable = __webpack_require__(70064);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/reactNode.js
var reactNode = __webpack_require__(40682);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/wave/index.js + 4 modules
var wave = __webpack_require__(57);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/@ctrl/tinycolor/dist/module/index.js
var dist_module = __webpack_require__(24978);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
;// ./node_modules/antd/es/tag/style/index.js




// ============================== Styles ==============================
const genBaseStyle = token => {
  const {
    paddingXXS,
    lineWidth,
    tagPaddingHorizontal,
    componentCls,
    calc
  } = token;
  const paddingInline = calc(tagPaddingHorizontal).sub(lineWidth).equal();
  const iconMarginInline = calc(paddingXXS).sub(lineWidth).equal();
  return {
    // Result
    [componentCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      display: 'inline-block',
      height: 'auto',
      // https://github.com/ant-design/ant-design/pull/47504
      marginInlineEnd: token.marginXS,
      paddingInline,
      fontSize: token.tagFontSize,
      lineHeight: token.tagLineHeight,
      whiteSpace: 'nowrap',
      background: token.defaultBg,
      border: `${(0,es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
      borderRadius: token.borderRadiusSM,
      opacity: 1,
      transition: `all ${token.motionDurationMid}`,
      textAlign: 'start',
      position: 'relative',
      // RTL
      [`&${componentCls}-rtl`]: {
        direction: 'rtl'
      },
      '&, a, a:hover': {
        color: token.defaultColor
      },
      [`${componentCls}-close-icon`]: {
        marginInlineStart: iconMarginInline,
        fontSize: token.tagIconSize,
        color: token.colorTextDescription,
        cursor: 'pointer',
        transition: `all ${token.motionDurationMid}`,
        '&:hover': {
          color: token.colorTextHeading
        }
      },
      [`&${componentCls}-has-color`]: {
        borderColor: 'transparent',
        [`&, a, a:hover, ${token.iconCls}-close, ${token.iconCls}-close:hover`]: {
          color: token.colorTextLightSolid
        }
      },
      '&-checkable': {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        cursor: 'pointer',
        [`&:not(${componentCls}-checkable-checked):hover`]: {
          color: token.colorPrimary,
          backgroundColor: token.colorFillSecondary
        },
        '&:active, &-checked': {
          color: token.colorTextLightSolid
        },
        '&-checked': {
          backgroundColor: token.colorPrimary,
          '&:hover': {
            backgroundColor: token.colorPrimaryHover
          }
        },
        '&:active': {
          backgroundColor: token.colorPrimaryActive
        }
      },
      '&-hidden': {
        display: 'none'
      },
      // To ensure that a space will be placed between character and `Icon`.
      [`> ${token.iconCls} + span, > span + ${token.iconCls}`]: {
        marginInlineStart: paddingInline
      }
    }),
    [`${componentCls}-borderless`]: {
      borderColor: 'transparent',
      background: token.tagBorderlessBg
    }
  };
};
// ============================== Export ==============================
const prepareToken = token => {
  const {
    lineWidth,
    fontSizeIcon,
    calc
  } = token;
  const tagFontSize = token.fontSizeSM;
  const tagToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    tagFontSize,
    tagLineHeight: (0,es/* unit */.zA)(calc(token.lineHeightSM).mul(tagFontSize).equal()),
    tagIconSize: calc(fontSizeIcon).sub(calc(lineWidth).mul(2)).equal(),
    // Tag icon is much smaller
    tagPaddingHorizontal: 8,
    // Fixed padding.
    tagBorderlessBg: token.defaultBg
  });
  return tagToken;
};
const prepareComponentToken = token => ({
  defaultBg: new dist_module/* TinyColor */.q(token.colorFillQuaternary).onBackground(token.colorBgContainer).toHexString(),
  defaultColor: token.colorText
});
/* harmony default export */ var tag_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Tag', token => {
  const tagToken = prepareToken(token);
  return genBaseStyle(tagToken);
}, prepareComponentToken));
;// ./node_modules/antd/es/tag/CheckableTag.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};




const CheckableTag = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
      prefixCls: customizePrefixCls,
      style,
      className,
      checked,
      onChange,
      onClick
    } = props,
    restProps = __rest(props, ["prefixCls", "style", "className", "checked", "onChange", "onClick"]);
  const {
    getPrefixCls,
    tag
  } = react.useContext(context/* ConfigContext */.QO);
  const handleClick = e => {
    onChange === null || onChange === void 0 ? void 0 : onChange(!checked);
    onClick === null || onClick === void 0 ? void 0 : onClick(e);
  };
  const prefixCls = getPrefixCls('tag', customizePrefixCls);
  // Style
  const [wrapCSSVar, hashId, cssVarCls] = tag_style(prefixCls);
  const cls = classnames_default()(prefixCls, `${prefixCls}-checkable`, {
    [`${prefixCls}-checkable-checked`]: checked
  }, tag === null || tag === void 0 ? void 0 : tag.className, className, hashId, cssVarCls);
  return wrapCSSVar(/*#__PURE__*/react.createElement("span", Object.assign({}, restProps, {
    ref: ref,
    style: Object.assign(Object.assign({}, style), tag === null || tag === void 0 ? void 0 : tag.style),
    className: cls,
    onClick: handleClick
  })));
});
/* harmony default export */ var tag_CheckableTag = (CheckableTag);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genPresetColor.js
var genPresetColor = __webpack_require__(31108);
;// ./node_modules/antd/es/tag/style/presetCmp.js
// Style as status component


// ============================== Preset ==============================
const genPresetStyle = token => (0,genPresetColor/* default */.A)(token, (colorKey, _ref) => {
  let {
    textColor,
    lightBorderColor,
    lightColor,
    darkColor
  } = _ref;
  return {
    [`${token.componentCls}${token.componentCls}-${colorKey}`]: {
      color: textColor,
      background: lightColor,
      borderColor: lightBorderColor,
      // Inverse color
      '&-inverse': {
        color: token.colorTextLightSolid,
        background: darkColor,
        borderColor: darkColor
      },
      [`&${token.componentCls}-borderless`]: {
        borderColor: 'transparent'
      }
    }
  };
});
// ============================== Export ==============================
/* harmony default export */ var presetCmp = ((0,genStyleUtils/* genSubStyleComponent */.bf)(['Tag', 'preset'], token => {
  const tagToken = prepareToken(token);
  return genPresetStyle(tagToken);
}, prepareComponentToken));
;// ./node_modules/antd/es/_util/capitalize.js
function capitalize(str) {
  if (typeof str !== 'string') {
    return str;
  }
  const ret = str.charAt(0).toUpperCase() + str.slice(1);
  return ret;
}
;// ./node_modules/antd/es/tag/style/statusCmp.js



const genTagStatusStyle = (token, status, cssVariableType) => {
  const capitalizedCssVariableType = capitalize(cssVariableType);
  return {
    [`${token.componentCls}${token.componentCls}-${status}`]: {
      color: token[`color${cssVariableType}`],
      background: token[`color${capitalizedCssVariableType}Bg`],
      borderColor: token[`color${capitalizedCssVariableType}Border`],
      [`&${token.componentCls}-borderless`]: {
        borderColor: 'transparent'
      }
    }
  };
};
// ============================== Export ==============================
/* harmony default export */ var statusCmp = ((0,genStyleUtils/* genSubStyleComponent */.bf)(['Tag', 'status'], token => {
  const tagToken = prepareToken(token);
  return [genTagStatusStyle(tagToken, 'success', 'Success'), genTagStatusStyle(tagToken, 'processing', 'Info'), genTagStatusStyle(tagToken, 'error', 'Error'), genTagStatusStyle(tagToken, 'warning', 'Warning')];
}, prepareComponentToken));
;// ./node_modules/antd/es/tag/index.js
"use client";

var tag_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};













const InternalTag = /*#__PURE__*/react.forwardRef((tagProps, ref) => {
  const {
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      style,
      children,
      icon,
      color,
      onClose,
      bordered = true,
      visible: deprecatedVisible
    } = tagProps,
    props = tag_rest(tagProps, ["prefixCls", "className", "rootClassName", "style", "children", "icon", "color", "onClose", "bordered", "visible"]);
  const {
    getPrefixCls,
    direction,
    tag: tagContext
  } = react.useContext(context/* ConfigContext */.QO);
  const [visible, setVisible] = react.useState(true);
  const domProps = (0,omit/* default */.A)(props, ['closeIcon', 'closable']);
  // Warning for deprecated usage
  if (false) {}
  react.useEffect(() => {
    if (deprecatedVisible !== undefined) {
      setVisible(deprecatedVisible);
    }
  }, [deprecatedVisible]);
  const isPreset = (0,colors/* isPresetColor */.nP)(color);
  const isStatus = (0,colors/* isPresetStatusColor */.ZZ)(color);
  const isInternalColor = isPreset || isStatus;
  const tagStyle = Object.assign(Object.assign({
    backgroundColor: color && !isInternalColor ? color : undefined
  }, tagContext === null || tagContext === void 0 ? void 0 : tagContext.style), style);
  const prefixCls = getPrefixCls('tag', customizePrefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = tag_style(prefixCls);
  // Style
  const tagClassName = classnames_default()(prefixCls, tagContext === null || tagContext === void 0 ? void 0 : tagContext.className, {
    [`${prefixCls}-${color}`]: isInternalColor,
    [`${prefixCls}-has-color`]: color && !isInternalColor,
    [`${prefixCls}-hidden`]: !visible,
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-borderless`]: !bordered
  }, className, rootClassName, hashId, cssVarCls);
  const handleCloseClick = e => {
    e.stopPropagation();
    onClose === null || onClose === void 0 ? void 0 : onClose(e);
    if (e.defaultPrevented) {
      return;
    }
    setVisible(false);
  };
  const [, mergedCloseIcon] = (0,useClosable/* default */.A)((0,useClosable/* pickClosable */.d)(tagProps), (0,useClosable/* pickClosable */.d)(tagContext), {
    closable: false,
    closeIconRender: iconNode => {
      const replacement = /*#__PURE__*/react.createElement("span", {
        className: `${prefixCls}-close-icon`,
        onClick: handleCloseClick
      }, iconNode);
      return (0,reactNode/* replaceElement */.fx)(iconNode, replacement, originProps => ({
        onClick: e => {
          var _a;
          (_a = originProps === null || originProps === void 0 ? void 0 : originProps.onClick) === null || _a === void 0 ? void 0 : _a.call(originProps, e);
          handleCloseClick(e);
        },
        className: classnames_default()(originProps === null || originProps === void 0 ? void 0 : originProps.className, `${prefixCls}-close-icon`)
      }));
    }
  });
  const isNeedWave = typeof props.onClick === 'function' || children && children.type === 'a';
  const iconNode = icon || null;
  const kids = iconNode ? (/*#__PURE__*/react.createElement(react.Fragment, null, iconNode, children && /*#__PURE__*/react.createElement("span", null, children))) : children;
  const tagNode = /*#__PURE__*/react.createElement("span", Object.assign({}, domProps, {
    ref: ref,
    className: tagClassName,
    style: tagStyle
  }), kids, mergedCloseIcon, isPreset && /*#__PURE__*/react.createElement(presetCmp, {
    key: "preset",
    prefixCls: prefixCls
  }), isStatus && /*#__PURE__*/react.createElement(statusCmp, {
    key: "status",
    prefixCls: prefixCls
  }));
  return wrapCSSVar(isNeedWave ? /*#__PURE__*/react.createElement(wave/* default */.A, {
    component: "Tag"
  }, tagNode) : tagNode);
});
const Tag = InternalTag;
if (false) {}
Tag.CheckableTag = tag_CheckableTag;
/* harmony default export */ var tag = (Tag);

/***/ }),

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
//# sourceMappingURL=component---src-pages-settings-config-tsx-388becde60c72033368a.js.map