"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[6796],{

/***/ 52318:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ icons_EllipsisOutlined; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/@ant-design/icons-svg/es/asn/EllipsisOutlined.js
// This icon file is generated automatically.
var EllipsisOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M176 511a56 56 0 10112 0 56 56 0 10-112 0zm280 0a56 56 0 10112 0 56 56 0 10-112 0zm280 0a56 56 0 10112 0 56 56 0 10-112 0z" } }] }, "name": "ellipsis", "theme": "outlined" };
/* harmony default export */ var asn_EllipsisOutlined = (EllipsisOutlined);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/EllipsisOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var EllipsisOutlined_EllipsisOutlined = function EllipsisOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_EllipsisOutlined
  }));
};

/**![ellipsis](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE3NiA1MTFhNTYgNTYgMCAxMDExMiAwIDU2IDU2IDAgMTAtMTEyIDB6bTI4MCAwYTU2IDU2IDAgMTAxMTIgMCA1NiA1NiAwIDEwLTExMiAwem0yODAgMGE1NiA1NiAwIDEwMTEyIDAgNTYgNTYgMCAxMC0xMTIgMHoiIC8+PC9zdmc+) */
var RefIcon = /*#__PURE__*/react.forwardRef(EllipsisOutlined_EllipsisOutlined);
if (false) {}
/* harmony default export */ var icons_EllipsisOutlined = (RefIcon);

/***/ }),

/***/ 42702:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ space; }
});

// UNUSED EXPORTS: SpaceContext

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
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
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
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

/***/ 3497:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ rc_dropdown_es; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
var objectWithoutProperties = __webpack_require__(80045);
// EXTERNAL MODULE: ./node_modules/@rc-component/trigger/es/index.js + 11 modules
var es = __webpack_require__(62427);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var es_ref = __webpack_require__(8719);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/rc-util/es/KeyCode.js
var KeyCode = __webpack_require__(16928);
// EXTERNAL MODULE: ./node_modules/rc-util/es/raf.js
var raf = __webpack_require__(25371);
;// ./node_modules/rc-dropdown/es/hooks/useAccessibility.js



var ESC = KeyCode/* default */.A.ESC,
  TAB = KeyCode/* default */.A.TAB;
function useAccessibility(_ref) {
  var visible = _ref.visible,
    triggerRef = _ref.triggerRef,
    onVisibleChange = _ref.onVisibleChange,
    autoFocus = _ref.autoFocus,
    overlayRef = _ref.overlayRef;
  var focusMenuRef = react.useRef(false);
  var handleCloseMenuAndReturnFocus = function handleCloseMenuAndReturnFocus() {
    if (visible) {
      var _triggerRef$current, _triggerRef$current$f;
      (_triggerRef$current = triggerRef.current) === null || _triggerRef$current === void 0 || (_triggerRef$current$f = _triggerRef$current.focus) === null || _triggerRef$current$f === void 0 || _triggerRef$current$f.call(_triggerRef$current);
      onVisibleChange === null || onVisibleChange === void 0 || onVisibleChange(false);
    }
  };
  var focusMenu = function focusMenu() {
    var _overlayRef$current;
    if ((_overlayRef$current = overlayRef.current) !== null && _overlayRef$current !== void 0 && _overlayRef$current.focus) {
      overlayRef.current.focus();
      focusMenuRef.current = true;
      return true;
    }
    return false;
  };
  var handleKeyDown = function handleKeyDown(event) {
    switch (event.keyCode) {
      case ESC:
        handleCloseMenuAndReturnFocus();
        break;
      case TAB:
        {
          var focusResult = false;
          if (!focusMenuRef.current) {
            focusResult = focusMenu();
          }
          if (focusResult) {
            event.preventDefault();
          } else {
            handleCloseMenuAndReturnFocus();
          }
          break;
        }
    }
  };
  react.useEffect(function () {
    if (visible) {
      window.addEventListener("keydown", handleKeyDown);
      if (autoFocus) {
        // FIXME: hack with raf
        (0,raf/* default */.A)(focusMenu, 3);
      }
      return function () {
        window.removeEventListener("keydown", handleKeyDown);
        focusMenuRef.current = false;
      };
    }
    return function () {
      focusMenuRef.current = false;
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
}
;// ./node_modules/rc-dropdown/es/Overlay.js


var Overlay = /*#__PURE__*/(0,react.forwardRef)(function (props, ref) {
  var overlay = props.overlay,
    arrow = props.arrow,
    prefixCls = props.prefixCls;
  var overlayNode = (0,react.useMemo)(function () {
    var overlayElement;
    if (typeof overlay === 'function') {
      overlayElement = overlay();
    } else {
      overlayElement = overlay;
    }
    return overlayElement;
  }, [overlay]);
  var composedRef = (0,es_ref/* composeRef */.K4)(ref, (0,es_ref/* getNodeRef */.A9)(overlayNode));
  return /*#__PURE__*/react.createElement(react.Fragment, null, arrow && /*#__PURE__*/react.createElement("div", {
    className: "".concat(prefixCls, "-arrow")
  }), /*#__PURE__*/react.cloneElement(overlayNode, {
    ref: (0,es_ref/* supportRef */.f3)(overlayNode) ? composedRef : undefined
  }));
});
/* harmony default export */ var es_Overlay = (Overlay);
;// ./node_modules/rc-dropdown/es/placements.js
var autoAdjustOverflow = {
  adjustX: 1,
  adjustY: 1
};
var targetOffset = [0, 0];
var placements = {
  topLeft: {
    points: ['bl', 'tl'],
    overflow: autoAdjustOverflow,
    offset: [0, -4],
    targetOffset: targetOffset
  },
  top: {
    points: ['bc', 'tc'],
    overflow: autoAdjustOverflow,
    offset: [0, -4],
    targetOffset: targetOffset
  },
  topRight: {
    points: ['br', 'tr'],
    overflow: autoAdjustOverflow,
    offset: [0, -4],
    targetOffset: targetOffset
  },
  bottomLeft: {
    points: ['tl', 'bl'],
    overflow: autoAdjustOverflow,
    offset: [0, 4],
    targetOffset: targetOffset
  },
  bottom: {
    points: ['tc', 'bc'],
    overflow: autoAdjustOverflow,
    offset: [0, 4],
    targetOffset: targetOffset
  },
  bottomRight: {
    points: ['tr', 'br'],
    overflow: autoAdjustOverflow,
    offset: [0, 4],
    targetOffset: targetOffset
  }
};
/* harmony default export */ var es_placements = (placements);
;// ./node_modules/rc-dropdown/es/Dropdown.js




var _excluded = ["arrow", "prefixCls", "transitionName", "animation", "align", "placement", "placements", "getPopupContainer", "showAction", "hideAction", "overlayClassName", "overlayStyle", "visible", "trigger", "autoFocus", "overlay", "children", "onVisibleChange"];







function Dropdown(props, ref) {
  var _children$props;
  var _props$arrow = props.arrow,
    arrow = _props$arrow === void 0 ? false : _props$arrow,
    _props$prefixCls = props.prefixCls,
    prefixCls = _props$prefixCls === void 0 ? 'rc-dropdown' : _props$prefixCls,
    transitionName = props.transitionName,
    animation = props.animation,
    align = props.align,
    _props$placement = props.placement,
    placement = _props$placement === void 0 ? 'bottomLeft' : _props$placement,
    _props$placements = props.placements,
    placements = _props$placements === void 0 ? es_placements : _props$placements,
    getPopupContainer = props.getPopupContainer,
    showAction = props.showAction,
    hideAction = props.hideAction,
    overlayClassName = props.overlayClassName,
    overlayStyle = props.overlayStyle,
    visible = props.visible,
    _props$trigger = props.trigger,
    trigger = _props$trigger === void 0 ? ['hover'] : _props$trigger,
    autoFocus = props.autoFocus,
    overlay = props.overlay,
    children = props.children,
    onVisibleChange = props.onVisibleChange,
    otherProps = (0,objectWithoutProperties/* default */.A)(props, _excluded);
  var _React$useState = react.useState(),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    triggerVisible = _React$useState2[0],
    setTriggerVisible = _React$useState2[1];
  var mergedVisible = 'visible' in props ? visible : triggerVisible;
  var triggerRef = react.useRef(null);
  var overlayRef = react.useRef(null);
  var childRef = react.useRef(null);
  react.useImperativeHandle(ref, function () {
    return triggerRef.current;
  });
  var handleVisibleChange = function handleVisibleChange(newVisible) {
    setTriggerVisible(newVisible);
    onVisibleChange === null || onVisibleChange === void 0 || onVisibleChange(newVisible);
  };
  useAccessibility({
    visible: mergedVisible,
    triggerRef: childRef,
    onVisibleChange: handleVisibleChange,
    autoFocus: autoFocus,
    overlayRef: overlayRef
  });
  var onClick = function onClick(e) {
    var onOverlayClick = props.onOverlayClick;
    setTriggerVisible(false);
    if (onOverlayClick) {
      onOverlayClick(e);
    }
  };
  var getMenuElement = function getMenuElement() {
    return /*#__PURE__*/react.createElement(es_Overlay, {
      ref: overlayRef,
      overlay: overlay,
      prefixCls: prefixCls,
      arrow: arrow
    });
  };
  var getMenuElementOrLambda = function getMenuElementOrLambda() {
    if (typeof overlay === 'function') {
      return getMenuElement;
    }
    return getMenuElement();
  };
  var getMinOverlayWidthMatchTrigger = function getMinOverlayWidthMatchTrigger() {
    var minOverlayWidthMatchTrigger = props.minOverlayWidthMatchTrigger,
      alignPoint = props.alignPoint;
    if ('minOverlayWidthMatchTrigger' in props) {
      return minOverlayWidthMatchTrigger;
    }
    return !alignPoint;
  };
  var getOpenClassName = function getOpenClassName() {
    var openClassName = props.openClassName;
    if (openClassName !== undefined) {
      return openClassName;
    }
    return "".concat(prefixCls, "-open");
  };
  var childrenNode = /*#__PURE__*/react.cloneElement(children, {
    className: classnames_default()((_children$props = children.props) === null || _children$props === void 0 ? void 0 : _children$props.className, mergedVisible && getOpenClassName()),
    ref: (0,es_ref/* supportRef */.f3)(children) ? (0,es_ref/* composeRef */.K4)(childRef, (0,es_ref/* getNodeRef */.A9)(children)) : undefined
  });
  var triggerHideAction = hideAction;
  if (!triggerHideAction && trigger.indexOf('contextMenu') !== -1) {
    triggerHideAction = ['click'];
  }
  return /*#__PURE__*/react.createElement(es/* default */.A, (0,esm_extends/* default */.A)({
    builtinPlacements: placements
  }, otherProps, {
    prefixCls: prefixCls,
    ref: triggerRef,
    popupClassName: classnames_default()(overlayClassName, (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-show-arrow"), arrow)),
    popupStyle: overlayStyle,
    action: trigger,
    showAction: showAction,
    hideAction: triggerHideAction,
    popupPlacement: placement,
    popupAlign: align,
    popupTransitionName: transitionName,
    popupAnimation: animation,
    popupVisible: mergedVisible,
    stretch: getMinOverlayWidthMatchTrigger() ? 'minWidth' : '',
    popup: getMenuElementOrLambda(),
    onPopupVisibleChange: handleVisibleChange,
    onPopupClick: onClick,
    getPopupContainer: getPopupContainer
  }), childrenNode);
}
/* harmony default export */ var es_Dropdown = (/*#__PURE__*/react.forwardRef(Dropdown));
;// ./node_modules/rc-dropdown/es/index.js

/* harmony default export */ var rc_dropdown_es = (es_Dropdown);

/***/ }),

/***/ 48810:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  cG: function() { return /* reexport */ Divider; },
  q7: function() { return /* reexport */ es_MenuItem; },
  te: function() { return /* reexport */ es_MenuItemGroup; },
  Dr: function() { return /* reexport */ es_MenuItem; },
  g8: function() { return /* reexport */ es_SubMenu; },
  Ay: function() { return /* binding */ rc_menu_es; },
  Wj: function() { return /* reexport */ useFullPath; }
});

// UNUSED EXPORTS: MenuItemGroup

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
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-overflow/es/index.js + 6 modules
var es = __webpack_require__(99591);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
// EXTERNAL MODULE: ./node_modules/rc-util/es/isEqual.js
var isEqual = __webpack_require__(43210);
// EXTERNAL MODULE: ./node_modules/rc-util/es/warning.js
var warning = __webpack_require__(68210);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/react-dom/index.js
var react_dom = __webpack_require__(40961);
;// ./node_modules/rc-menu/es/context/IdContext.js

var IdContext = /*#__PURE__*/react.createContext(null);
function getMenuId(uuid, eventKey) {
  if (uuid === undefined) {
    return null;
  }
  return "".concat(uuid, "-").concat(eventKey);
}

/**
 * Get `data-menu-id`
 */
function useMenuId(eventKey) {
  var id = react.useContext(IdContext);
  return getMenuId(id, eventKey);
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMemo.js
var useMemo = __webpack_require__(28104);
;// ./node_modules/rc-menu/es/context/MenuContext.js


var _excluded = ["children", "locked"];



var MenuContext = /*#__PURE__*/react.createContext(null);
function mergeProps(origin, target) {
  var clone = (0,objectSpread2/* default */.A)({}, origin);
  Object.keys(target).forEach(function (key) {
    var value = target[key];
    if (value !== undefined) {
      clone[key] = value;
    }
  });
  return clone;
}
function InheritableContextProvider(_ref) {
  var children = _ref.children,
    locked = _ref.locked,
    restProps = (0,objectWithoutProperties/* default */.A)(_ref, _excluded);
  var context = react.useContext(MenuContext);
  var inheritableContext = (0,useMemo/* default */.A)(function () {
    return mergeProps(context, restProps);
  }, [context, restProps], function (prev, next) {
    return !locked && (prev[0] !== next[0] || !(0,isEqual/* default */.A)(prev[1], next[1], true));
  });
  return /*#__PURE__*/react.createElement(MenuContext.Provider, {
    value: inheritableContext
  }, children);
}
;// ./node_modules/rc-menu/es/context/PathContext.js


var EmptyList = [];

// ========================= Path Register =========================

var PathRegisterContext = /*#__PURE__*/react.createContext(null);
function useMeasure() {
  return react.useContext(PathRegisterContext);
}

// ========================= Path Tracker ==========================
var PathTrackerContext = /*#__PURE__*/react.createContext(EmptyList);
function useFullPath(eventKey) {
  var parentKeyPath = react.useContext(PathTrackerContext);
  return react.useMemo(function () {
    return eventKey !== undefined ? [].concat((0,toConsumableArray/* default */.A)(parentKeyPath), [eventKey]) : parentKeyPath;
  }, [parentKeyPath, eventKey]);
}

// =========================== Path User ===========================

var PathUserContext = /*#__PURE__*/react.createContext(null);
;// ./node_modules/rc-menu/es/context/PrivateContext.js

var PrivateContext = /*#__PURE__*/react.createContext({});
/* harmony default export */ var context_PrivateContext = (PrivateContext);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/isVisible.js
var isVisible = __webpack_require__(42467);
;// ./node_modules/rc-util/es/Dom/focus.js


function focusable(node) {
  var includePositive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
  if ((0,isVisible/* default */.A)(node)) {
    var nodeName = node.nodeName.toLowerCase();
    var isFocusableElement =
    // Focusable element
    ['input', 'select', 'textarea', 'button'].includes(nodeName) ||
    // Editable element
    node.isContentEditable ||
    // Anchor with href element
    nodeName === 'a' && !!node.getAttribute('href');

    // Get tabIndex
    var tabIndexAttr = node.getAttribute('tabindex');
    var tabIndexNum = Number(tabIndexAttr);

    // Parse as number if validate
    var tabIndex = null;
    if (tabIndexAttr && !Number.isNaN(tabIndexNum)) {
      tabIndex = tabIndexNum;
    } else if (isFocusableElement && tabIndex === null) {
      tabIndex = 0;
    }

    // Block focusable if disabled
    if (isFocusableElement && node.disabled) {
      tabIndex = null;
    }
    return tabIndex !== null && (tabIndex >= 0 || includePositive && tabIndex < 0);
  }
  return false;
}
function getFocusNodeList(node) {
  var includePositive = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
  var res = (0,toConsumableArray/* default */.A)(node.querySelectorAll('*')).filter(function (child) {
    return focusable(child, includePositive);
  });
  if (focusable(node, includePositive)) {
    res.unshift(node);
  }
  return res;
}
var lastFocusElement = null;

/** @deprecated Do not use since this may failed when used in async */
function saveLastFocusNode() {
  lastFocusElement = document.activeElement;
}

/** @deprecated Do not use since this may failed when used in async */
function clearLastFocusNode() {
  lastFocusElement = null;
}

/** @deprecated Do not use since this may failed when used in async */
function backLastFocusNode() {
  if (lastFocusElement) {
    try {
      // 元素可能已经被移动了
      lastFocusElement.focus();

      /* eslint-disable no-empty */
    } catch (e) {
      // empty
    }
    /* eslint-enable no-empty */
  }
}
function limitTabRange(node, e) {
  if (e.keyCode === 9) {
    var tabNodeList = getFocusNodeList(node);
    var lastTabNode = tabNodeList[e.shiftKey ? 0 : tabNodeList.length - 1];
    var leavingTab = lastTabNode === document.activeElement || node === document.activeElement;
    if (leavingTab) {
      var target = tabNodeList[e.shiftKey ? tabNodeList.length - 1 : 0];
      target.focus();
      e.preventDefault();
    }
  }
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/KeyCode.js
var KeyCode = __webpack_require__(16928);
// EXTERNAL MODULE: ./node_modules/rc-util/es/raf.js
var raf = __webpack_require__(25371);
;// ./node_modules/rc-menu/es/hooks/useAccessibility.js






// destruct to reduce minify size
var LEFT = KeyCode/* default */.A.LEFT,
  RIGHT = KeyCode/* default */.A.RIGHT,
  UP = KeyCode/* default */.A.UP,
  DOWN = KeyCode/* default */.A.DOWN,
  ENTER = KeyCode/* default */.A.ENTER,
  ESC = KeyCode/* default */.A.ESC,
  HOME = KeyCode/* default */.A.HOME,
  END = KeyCode/* default */.A.END;
var ArrowKeys = [UP, DOWN, LEFT, RIGHT];
function getOffset(mode, isRootLevel, isRtl, which) {
  var _offsets;
  var prev = 'prev';
  var next = 'next';
  var children = 'children';
  var parent = 'parent';

  // Inline enter is special that we use unique operation
  if (mode === 'inline' && which === ENTER) {
    return {
      inlineTrigger: true
    };
  }
  var inline = (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, UP, prev), DOWN, next);
  var horizontal = (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, LEFT, isRtl ? next : prev), RIGHT, isRtl ? prev : next), DOWN, children), ENTER, children);
  var vertical = (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, UP, prev), DOWN, next), ENTER, children), ESC, parent), LEFT, isRtl ? children : parent), RIGHT, isRtl ? parent : children);
  var offsets = {
    inline: inline,
    horizontal: horizontal,
    vertical: vertical,
    inlineSub: inline,
    horizontalSub: vertical,
    verticalSub: vertical
  };
  var type = (_offsets = offsets["".concat(mode).concat(isRootLevel ? '' : 'Sub')]) === null || _offsets === void 0 ? void 0 : _offsets[which];
  switch (type) {
    case prev:
      return {
        offset: -1,
        sibling: true
      };
    case next:
      return {
        offset: 1,
        sibling: true
      };
    case parent:
      return {
        offset: -1,
        sibling: false
      };
    case children:
      return {
        offset: 1,
        sibling: false
      };
    default:
      return null;
  }
}
function findContainerUL(element) {
  var current = element;
  while (current) {
    if (current.getAttribute('data-menu-list')) {
      return current;
    }
    current = current.parentElement;
  }

  // Normally should not reach this line
  /* istanbul ignore next */
  return null;
}

/**
 * Find focused element within element set provided
 */
function getFocusElement(activeElement, elements) {
  var current = activeElement || document.activeElement;
  while (current) {
    if (elements.has(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Get focusable elements from the element set under provided container
 */
function getFocusableElements(container, elements) {
  var list = getFocusNodeList(container, true);
  return list.filter(function (ele) {
    return elements.has(ele);
  });
}
function getNextFocusElement(parentQueryContainer, elements, focusMenuElement) {
  var offset = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 1;
  // Key on the menu item will not get validate parent container
  if (!parentQueryContainer) {
    return null;
  }

  // List current level menu item elements
  var sameLevelFocusableMenuElementList = getFocusableElements(parentQueryContainer, elements);

  // Find next focus index
  var count = sameLevelFocusableMenuElementList.length;
  var focusIndex = sameLevelFocusableMenuElementList.findIndex(function (ele) {
    return focusMenuElement === ele;
  });
  if (offset < 0) {
    if (focusIndex === -1) {
      focusIndex = count - 1;
    } else {
      focusIndex -= 1;
    }
  } else if (offset > 0) {
    focusIndex += 1;
  }
  focusIndex = (focusIndex + count) % count;

  // Focus menu item
  return sameLevelFocusableMenuElementList[focusIndex];
}
var refreshElements = function refreshElements(keys, id) {
  var elements = new Set();
  var key2element = new Map();
  var element2key = new Map();
  keys.forEach(function (key) {
    var element = document.querySelector("[data-menu-id='".concat(getMenuId(id, key), "']"));
    if (element) {
      elements.add(element);
      element2key.set(element, key);
      key2element.set(key, element);
    }
  });
  return {
    elements: elements,
    key2element: key2element,
    element2key: element2key
  };
};
function useAccessibility(mode, activeKey, isRtl, id, containerRef, getKeys, getKeyPath, triggerActiveKey, triggerAccessibilityOpen, originOnKeyDown) {
  var rafRef = react.useRef();
  var activeRef = react.useRef();
  activeRef.current = activeKey;
  var cleanRaf = function cleanRaf() {
    raf/* default */.A.cancel(rafRef.current);
  };
  react.useEffect(function () {
    return function () {
      cleanRaf();
    };
  }, []);
  return function (e) {
    var which = e.which;
    if ([].concat(ArrowKeys, [ENTER, ESC, HOME, END]).includes(which)) {
      var keys = getKeys();
      var refreshedElements = refreshElements(keys, id);
      var _refreshedElements = refreshedElements,
        elements = _refreshedElements.elements,
        key2element = _refreshedElements.key2element,
        element2key = _refreshedElements.element2key;

      // First we should find current focused MenuItem/SubMenu element
      var activeElement = key2element.get(activeKey);
      var focusMenuElement = getFocusElement(activeElement, elements);
      var focusMenuKey = element2key.get(focusMenuElement);
      var offsetObj = getOffset(mode, getKeyPath(focusMenuKey, true).length === 1, isRtl, which);

      // Some mode do not have fully arrow operation like inline
      if (!offsetObj && which !== HOME && which !== END) {
        return;
      }

      // Arrow prevent default to avoid page scroll
      if (ArrowKeys.includes(which) || [HOME, END].includes(which)) {
        e.preventDefault();
      }
      var tryFocus = function tryFocus(menuElement) {
        if (menuElement) {
          var focusTargetElement = menuElement;

          // Focus to link instead of menu item if possible
          var link = menuElement.querySelector('a');
          if (link !== null && link !== void 0 && link.getAttribute('href')) {
            focusTargetElement = link;
          }
          var targetKey = element2key.get(menuElement);
          triggerActiveKey(targetKey);

          /**
           * Do not `useEffect` here since `tryFocus` may trigger async
           * which makes React sync update the `activeKey`
           * that force render before `useRef` set the next activeKey
           */
          cleanRaf();
          rafRef.current = (0,raf/* default */.A)(function () {
            if (activeRef.current === targetKey) {
              focusTargetElement.focus();
            }
          });
        }
      };
      if ([HOME, END].includes(which) || offsetObj.sibling || !focusMenuElement) {
        // ========================== Sibling ==========================
        // Find walkable focus menu element container
        var parentQueryContainer;
        if (!focusMenuElement || mode === 'inline') {
          parentQueryContainer = containerRef.current;
        } else {
          parentQueryContainer = findContainerUL(focusMenuElement);
        }

        // Get next focus element
        var targetElement;
        var focusableElements = getFocusableElements(parentQueryContainer, elements);
        if (which === HOME) {
          targetElement = focusableElements[0];
        } else if (which === END) {
          targetElement = focusableElements[focusableElements.length - 1];
        } else {
          targetElement = getNextFocusElement(parentQueryContainer, elements, focusMenuElement, offsetObj.offset);
        }
        // Focus menu item
        tryFocus(targetElement);

        // ======================= InlineTrigger =======================
      } else if (offsetObj.inlineTrigger) {
        // Inline trigger no need switch to sub menu item
        triggerAccessibilityOpen(focusMenuKey);
        // =========================== Level ===========================
      } else if (offsetObj.offset > 0) {
        triggerAccessibilityOpen(focusMenuKey, true);
        cleanRaf();
        rafRef.current = (0,raf/* default */.A)(function () {
          // Async should resync elements
          refreshedElements = refreshElements(keys, id);
          var controlId = focusMenuElement.getAttribute('aria-controls');
          var subQueryContainer = document.getElementById(controlId);

          // Get sub focusable menu item
          var targetElement = getNextFocusElement(subQueryContainer, refreshedElements.elements);

          // Focus menu item
          tryFocus(targetElement);
        }, 5);
      } else if (offsetObj.offset < 0) {
        var keyPath = getKeyPath(focusMenuKey, true);
        var parentKey = keyPath[keyPath.length - 2];
        var parentMenuElement = key2element.get(parentKey);

        // Focus menu item
        triggerAccessibilityOpen(parentKey, false);
        tryFocus(parentMenuElement);
      }
    }

    // Pass origin key down event
    originOnKeyDown === null || originOnKeyDown === void 0 || originOnKeyDown(e);
  };
}
;// ./node_modules/rc-menu/es/utils/timeUtil.js
function nextSlice(callback) {
  /* istanbul ignore next */
  Promise.resolve().then(callback);
}
;// ./node_modules/rc-menu/es/hooks/useKeyRecords.js






var PATH_SPLIT = '__RC_UTIL_PATH_SPLIT__';
var getPathStr = function getPathStr(keyPath) {
  return keyPath.join(PATH_SPLIT);
};
var getPathKeys = function getPathKeys(keyPathStr) {
  return keyPathStr.split(PATH_SPLIT);
};
var OVERFLOW_KEY = 'rc-menu-more';
function useKeyRecords() {
  var _React$useState = react.useState({}),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    internalForceUpdate = _React$useState2[1];
  var key2pathRef = (0,react.useRef)(new Map());
  var path2keyRef = (0,react.useRef)(new Map());
  var _React$useState3 = react.useState([]),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    overflowKeys = _React$useState4[0],
    setOverflowKeys = _React$useState4[1];
  var updateRef = (0,react.useRef)(0);
  var destroyRef = (0,react.useRef)(false);
  var forceUpdate = function forceUpdate() {
    if (!destroyRef.current) {
      internalForceUpdate({});
    }
  };
  var registerPath = (0,react.useCallback)(function (key, keyPath) {
    // Warning for invalidate or duplicated `key`
    if (false) {}

    // Fill map
    var connectedPath = getPathStr(keyPath);
    path2keyRef.current.set(connectedPath, key);
    key2pathRef.current.set(key, connectedPath);
    updateRef.current += 1;
    var id = updateRef.current;
    nextSlice(function () {
      if (id === updateRef.current) {
        forceUpdate();
      }
    });
  }, []);
  var unregisterPath = (0,react.useCallback)(function (key, keyPath) {
    var connectedPath = getPathStr(keyPath);
    path2keyRef.current.delete(connectedPath);
    key2pathRef.current.delete(key);
  }, []);
  var refreshOverflowKeys = (0,react.useCallback)(function (keys) {
    setOverflowKeys(keys);
  }, []);
  var getKeyPath = (0,react.useCallback)(function (eventKey, includeOverflow) {
    var fullPath = key2pathRef.current.get(eventKey) || '';
    var keys = getPathKeys(fullPath);
    if (includeOverflow && overflowKeys.includes(keys[0])) {
      keys.unshift(OVERFLOW_KEY);
    }
    return keys;
  }, [overflowKeys]);
  var isSubPathKey = (0,react.useCallback)(function (pathKeys, eventKey) {
    return pathKeys.filter(function (item) {
      return item !== undefined;
    }).some(function (pathKey) {
      var pathKeyList = getKeyPath(pathKey, true);
      return pathKeyList.includes(eventKey);
    });
  }, [getKeyPath]);
  var getKeys = function getKeys() {
    var keys = (0,toConsumableArray/* default */.A)(key2pathRef.current.keys());
    if (overflowKeys.length) {
      keys.push(OVERFLOW_KEY);
    }
    return keys;
  };

  /**
   * Find current key related child path keys
   */
  var getSubPathKeys = (0,react.useCallback)(function (key) {
    var connectedPath = "".concat(key2pathRef.current.get(key)).concat(PATH_SPLIT);
    var pathKeys = new Set();
    (0,toConsumableArray/* default */.A)(path2keyRef.current.keys()).forEach(function (pathKey) {
      if (pathKey.startsWith(connectedPath)) {
        pathKeys.add(path2keyRef.current.get(pathKey));
      }
    });
    return pathKeys;
  }, []);
  react.useEffect(function () {
    return function () {
      destroyRef.current = true;
    };
  }, []);
  return {
    // Register
    registerPath: registerPath,
    unregisterPath: unregisterPath,
    refreshOverflowKeys: refreshOverflowKeys,
    // Util
    isSubPathKey: isSubPathKey,
    getKeyPath: getKeyPath,
    getKeys: getKeys,
    getSubPathKeys: getSubPathKeys
  };
}
;// ./node_modules/rc-menu/es/hooks/useMemoCallback.js


/**
 * Cache callback function that always return same ref instead.
 * This is used for context optimization.
 */
function useMemoCallback(func) {
  var funRef = react.useRef(func);
  funRef.current = func;
  var callback = react.useCallback(function () {
    var _funRef$current;
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    return (_funRef$current = funRef.current) === null || _funRef$current === void 0 ? void 0 : _funRef$current.call.apply(_funRef$current, [funRef].concat(args));
  }, []);
  return func ? callback : undefined;
}
;// ./node_modules/rc-menu/es/hooks/useUUID.js



var uniquePrefix = Math.random().toFixed(5).toString().slice(2);
var internalId = 0;
function useUUID(id) {
  var _useMergedState = (0,useMergedState/* default */.A)(id, {
      value: id
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    uuid = _useMergedState2[0],
    setUUID = _useMergedState2[1];
  react.useEffect(function () {
    internalId += 1;
    var newId =  false ? 0 : "".concat(uniquePrefix, "-").concat(internalId);
    setUUID("rc-menu-uuid-".concat(newId));
  }, []);
  return uuid;
}
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/classCallCheck.js
var classCallCheck = __webpack_require__(23029);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/createClass.js
var createClass = __webpack_require__(92901);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/inherits.js
var inherits = __webpack_require__(85501);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/createSuper.js + 1 modules
var createSuper = __webpack_require__(49640);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var es_ref = __webpack_require__(8719);
;// ./node_modules/rc-menu/es/hooks/useActive.js


function useActive(eventKey, disabled, onMouseEnter, onMouseLeave) {
  var _React$useContext = react.useContext(MenuContext),
    activeKey = _React$useContext.activeKey,
    onActive = _React$useContext.onActive,
    onInactive = _React$useContext.onInactive;
  var ret = {
    active: activeKey === eventKey
  };

  // Skip when disabled
  if (!disabled) {
    ret.onMouseEnter = function (domEvent) {
      onMouseEnter === null || onMouseEnter === void 0 || onMouseEnter({
        key: eventKey,
        domEvent: domEvent
      });
      onActive(eventKey);
    };
    ret.onMouseLeave = function (domEvent) {
      onMouseLeave === null || onMouseLeave === void 0 || onMouseLeave({
        key: eventKey,
        domEvent: domEvent
      });
      onInactive(eventKey);
    };
  }
  return ret;
}
;// ./node_modules/rc-menu/es/hooks/useDirectionStyle.js


function useDirectionStyle(level) {
  var _React$useContext = react.useContext(MenuContext),
    mode = _React$useContext.mode,
    rtl = _React$useContext.rtl,
    inlineIndent = _React$useContext.inlineIndent;
  if (mode !== 'inline') {
    return null;
  }
  var len = level;
  return rtl ? {
    paddingRight: len * inlineIndent
  } : {
    paddingLeft: len * inlineIndent
  };
}
;// ./node_modules/rc-menu/es/Icon.js


function Icon(_ref) {
  var icon = _ref.icon,
    props = _ref.props,
    children = _ref.children;
  var iconNode;
  if (icon === null || icon === false) {
    return null;
  }
  if (typeof icon === 'function') {
    iconNode = /*#__PURE__*/react.createElement(icon, (0,objectSpread2/* default */.A)({}, props));
  } else if (typeof icon !== "boolean") {
    // Compatible for origin definition
    iconNode = icon;
  }
  return iconNode || children || null;
}
;// ./node_modules/rc-menu/es/utils/warnUtil.js

var warnUtil_excluded = ["item"];


/**
 * `onClick` event return `info.item` which point to react node directly.
 * We should warning this since it will not work on FC.
 */
function warnItemProp(_ref) {
  var item = _ref.item,
    restInfo = (0,objectWithoutProperties/* default */.A)(_ref, warnUtil_excluded);
  Object.defineProperty(restInfo, 'item', {
    get: function get() {
      (0,warning/* default */.Ay)(false, '`info.item` is deprecated since we will move to function component that not provides React Node instance in future.');
      return item;
    }
  });
  return restInfo;
}
;// ./node_modules/rc-menu/es/MenuItem.js









var MenuItem_excluded = ["title", "attribute", "elementRef"],
  _excluded2 = ["style", "className", "eventKey", "warnKey", "disabled", "itemIcon", "children", "role", "onMouseEnter", "onMouseLeave", "onClick", "onKeyDown", "onFocus"],
  _excluded3 = ["active"];















// Since Menu event provide the `info.item` which point to the MenuItem node instance.
// We have to use class component here.
// This should be removed from doc & api in future.
var LegacyMenuItem = /*#__PURE__*/function (_React$Component) {
  (0,inherits/* default */.A)(LegacyMenuItem, _React$Component);
  var _super = (0,createSuper/* default */.A)(LegacyMenuItem);
  function LegacyMenuItem() {
    (0,classCallCheck/* default */.A)(this, LegacyMenuItem);
    return _super.apply(this, arguments);
  }
  (0,createClass/* default */.A)(LegacyMenuItem, [{
    key: "render",
    value: function render() {
      var _this$props = this.props,
        title = _this$props.title,
        attribute = _this$props.attribute,
        elementRef = _this$props.elementRef,
        restProps = (0,objectWithoutProperties/* default */.A)(_this$props, MenuItem_excluded);

      // Here the props are eventually passed to the DOM element.
      // React does not recognize non-standard attributes.
      // Therefore, remove the props that is not used here.
      // ref: https://github.com/ant-design/ant-design/issues/41395
      var passedProps = (0,omit/* default */.A)(restProps, ['eventKey', 'popupClassName', 'popupOffset', 'onTitleClick']);
      (0,warning/* default */.Ay)(!attribute, '`attribute` of Menu.Item is deprecated. Please pass attribute directly.');
      return /*#__PURE__*/react.createElement(es/* default */.A.Item, (0,esm_extends/* default */.A)({}, attribute, {
        title: typeof title === 'string' ? title : undefined
      }, passedProps, {
        ref: elementRef
      }));
    }
  }]);
  return LegacyMenuItem;
}(react.Component);
/**
 * Real Menu Item component
 */
var InternalMenuItem = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var style = props.style,
    className = props.className,
    eventKey = props.eventKey,
    warnKey = props.warnKey,
    disabled = props.disabled,
    itemIcon = props.itemIcon,
    children = props.children,
    role = props.role,
    onMouseEnter = props.onMouseEnter,
    onMouseLeave = props.onMouseLeave,
    onClick = props.onClick,
    onKeyDown = props.onKeyDown,
    onFocus = props.onFocus,
    restProps = (0,objectWithoutProperties/* default */.A)(props, _excluded2);
  var domDataId = useMenuId(eventKey);
  var _React$useContext = react.useContext(MenuContext),
    prefixCls = _React$useContext.prefixCls,
    onItemClick = _React$useContext.onItemClick,
    contextDisabled = _React$useContext.disabled,
    overflowDisabled = _React$useContext.overflowDisabled,
    contextItemIcon = _React$useContext.itemIcon,
    selectedKeys = _React$useContext.selectedKeys,
    onActive = _React$useContext.onActive;
  var _React$useContext2 = react.useContext(context_PrivateContext),
    _internalRenderMenuItem = _React$useContext2._internalRenderMenuItem;
  var itemCls = "".concat(prefixCls, "-item");
  var legacyMenuItemRef = react.useRef();
  var elementRef = react.useRef();
  var mergedDisabled = contextDisabled || disabled;
  var mergedEleRef = (0,es_ref/* useComposeRef */.xK)(ref, elementRef);
  var connectedKeys = useFullPath(eventKey);

  // ================================ Warn ================================
  if (false) {}

  // ============================= Info =============================
  var getEventInfo = function getEventInfo(e) {
    return {
      key: eventKey,
      // Note: For legacy code is reversed which not like other antd component
      keyPath: (0,toConsumableArray/* default */.A)(connectedKeys).reverse(),
      item: legacyMenuItemRef.current,
      domEvent: e
    };
  };

  // ============================= Icon =============================
  var mergedItemIcon = itemIcon || contextItemIcon;

  // ============================ Active ============================
  var _useActive = useActive(eventKey, mergedDisabled, onMouseEnter, onMouseLeave),
    active = _useActive.active,
    activeProps = (0,objectWithoutProperties/* default */.A)(_useActive, _excluded3);

  // ============================ Select ============================
  var selected = selectedKeys.includes(eventKey);

  // ======================== DirectionStyle ========================
  var directionStyle = useDirectionStyle(connectedKeys.length);

  // ============================ Events ============================
  var onInternalClick = function onInternalClick(e) {
    if (mergedDisabled) {
      return;
    }
    var info = getEventInfo(e);
    onClick === null || onClick === void 0 || onClick(warnItemProp(info));
    onItemClick(info);
  };
  var onInternalKeyDown = function onInternalKeyDown(e) {
    onKeyDown === null || onKeyDown === void 0 || onKeyDown(e);
    if (e.which === KeyCode/* default */.A.ENTER) {
      var info = getEventInfo(e);

      // Legacy. Key will also trigger click event
      onClick === null || onClick === void 0 || onClick(warnItemProp(info));
      onItemClick(info);
    }
  };

  /**
   * Used for accessibility. Helper will focus element without key board.
   * We should manually trigger an active
   */
  var onInternalFocus = function onInternalFocus(e) {
    onActive(eventKey);
    onFocus === null || onFocus === void 0 || onFocus(e);
  };

  // ============================ Render ============================
  var optionRoleProps = {};
  if (props.role === 'option') {
    optionRoleProps['aria-selected'] = selected;
  }
  var renderNode = /*#__PURE__*/react.createElement(LegacyMenuItem, (0,esm_extends/* default */.A)({
    ref: legacyMenuItemRef,
    elementRef: mergedEleRef,
    role: role === null ? 'none' : role || 'menuitem',
    tabIndex: disabled ? null : -1,
    "data-menu-id": overflowDisabled && domDataId ? null : domDataId
  }, (0,omit/* default */.A)(restProps, ['extra']), activeProps, optionRoleProps, {
    component: "li",
    "aria-disabled": disabled,
    style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, directionStyle), style),
    className: classnames_default()(itemCls, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(itemCls, "-active"), active), "".concat(itemCls, "-selected"), selected), "".concat(itemCls, "-disabled"), mergedDisabled), className),
    onClick: onInternalClick,
    onKeyDown: onInternalKeyDown,
    onFocus: onInternalFocus
  }), children, /*#__PURE__*/react.createElement(Icon, {
    props: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, props), {}, {
      isSelected: selected
    }),
    icon: mergedItemIcon
  }));
  if (_internalRenderMenuItem) {
    renderNode = _internalRenderMenuItem(renderNode, props, {
      selected: selected
    });
  }
  return renderNode;
});
function MenuItem(props, ref) {
  var eventKey = props.eventKey;

  // ==================== Record KeyPath ====================
  var measure = useMeasure();
  var connectedKeyPath = useFullPath(eventKey);

  // eslint-disable-next-line consistent-return
  react.useEffect(function () {
    if (measure) {
      measure.registerPath(eventKey, connectedKeyPath);
      return function () {
        measure.unregisterPath(eventKey, connectedKeyPath);
      };
    }
  }, [connectedKeyPath]);
  if (measure) {
    return null;
  }

  // ======================== Render ========================
  return /*#__PURE__*/react.createElement(InternalMenuItem, (0,esm_extends/* default */.A)({}, props, {
    ref: ref
  }));
}
/* harmony default export */ var es_MenuItem = (/*#__PURE__*/react.forwardRef(MenuItem));
;// ./node_modules/rc-menu/es/SubMenu/SubMenuList.js


var SubMenuList_excluded = ["className", "children"];



var InternalSubMenuList = function InternalSubMenuList(_ref, ref) {
  var className = _ref.className,
    children = _ref.children,
    restProps = (0,objectWithoutProperties/* default */.A)(_ref, SubMenuList_excluded);
  var _React$useContext = react.useContext(MenuContext),
    prefixCls = _React$useContext.prefixCls,
    mode = _React$useContext.mode,
    rtl = _React$useContext.rtl;
  return /*#__PURE__*/react.createElement("ul", (0,esm_extends/* default */.A)({
    className: classnames_default()(prefixCls, rtl && "".concat(prefixCls, "-rtl"), "".concat(prefixCls, "-sub"), "".concat(prefixCls, "-").concat(mode === 'inline' ? 'inline' : 'vertical'), className),
    role: "menu"
  }, restProps, {
    "data-menu-list": true,
    ref: ref
  }), children);
};
var SubMenuList = /*#__PURE__*/react.forwardRef(InternalSubMenuList);
SubMenuList.displayName = 'SubMenuList';
/* harmony default export */ var SubMenu_SubMenuList = (SubMenuList);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Children/toArray.js
var toArray = __webpack_require__(82546);
;// ./node_modules/rc-menu/es/utils/commonUtil.js



function parseChildren(children, keyPath) {
  return (0,toArray/* default */.A)(children).map(function (child, index) {
    if ( /*#__PURE__*/react.isValidElement(child)) {
      var _eventKey, _child$props;
      var key = child.key;
      var eventKey = (_eventKey = (_child$props = child.props) === null || _child$props === void 0 ? void 0 : _child$props.eventKey) !== null && _eventKey !== void 0 ? _eventKey : key;
      var emptyKey = eventKey === null || eventKey === undefined;
      if (emptyKey) {
        eventKey = "tmp_key-".concat([].concat((0,toConsumableArray/* default */.A)(keyPath), [index]).join('-'));
      }
      var cloneProps = {
        key: eventKey,
        eventKey: eventKey
      };
      if (false) {}
      return /*#__PURE__*/react.cloneElement(child, cloneProps);
    }
    return child;
  });
}
// EXTERNAL MODULE: ./node_modules/@rc-component/trigger/es/index.js + 11 modules
var trigger_es = __webpack_require__(62427);
;// ./node_modules/rc-menu/es/placements.js
var autoAdjustOverflow = {
  adjustX: 1,
  adjustY: 1
};
var placements = {
  topLeft: {
    points: ['bl', 'tl'],
    overflow: autoAdjustOverflow
  },
  topRight: {
    points: ['br', 'tr'],
    overflow: autoAdjustOverflow
  },
  bottomLeft: {
    points: ['tl', 'bl'],
    overflow: autoAdjustOverflow
  },
  bottomRight: {
    points: ['tr', 'br'],
    overflow: autoAdjustOverflow
  },
  leftTop: {
    points: ['tr', 'tl'],
    overflow: autoAdjustOverflow
  },
  leftBottom: {
    points: ['br', 'bl'],
    overflow: autoAdjustOverflow
  },
  rightTop: {
    points: ['tl', 'tr'],
    overflow: autoAdjustOverflow
  },
  rightBottom: {
    points: ['bl', 'br'],
    overflow: autoAdjustOverflow
  }
};
var placementsRtl = {
  topLeft: {
    points: ['bl', 'tl'],
    overflow: autoAdjustOverflow
  },
  topRight: {
    points: ['br', 'tr'],
    overflow: autoAdjustOverflow
  },
  bottomLeft: {
    points: ['tl', 'bl'],
    overflow: autoAdjustOverflow
  },
  bottomRight: {
    points: ['tr', 'br'],
    overflow: autoAdjustOverflow
  },
  rightTop: {
    points: ['tr', 'tl'],
    overflow: autoAdjustOverflow
  },
  rightBottom: {
    points: ['br', 'bl'],
    overflow: autoAdjustOverflow
  },
  leftTop: {
    points: ['tl', 'tr'],
    overflow: autoAdjustOverflow
  },
  leftBottom: {
    points: ['bl', 'br'],
    overflow: autoAdjustOverflow
  }
};
/* harmony default export */ var es_placements = ((/* unused pure expression or super */ null && (placements)));
;// ./node_modules/rc-menu/es/utils/motionUtil.js
function getMotion(mode, motion, defaultMotions) {
  if (motion) {
    return motion;
  }
  if (defaultMotions) {
    return defaultMotions[mode] || defaultMotions.other;
  }
  return undefined;
}
;// ./node_modules/rc-menu/es/SubMenu/PopupTrigger.js










var popupPlacementMap = {
  horizontal: 'bottomLeft',
  vertical: 'rightTop',
  'vertical-left': 'rightTop',
  'vertical-right': 'leftTop'
};
function PopupTrigger(_ref) {
  var prefixCls = _ref.prefixCls,
    visible = _ref.visible,
    children = _ref.children,
    popup = _ref.popup,
    popupStyle = _ref.popupStyle,
    popupClassName = _ref.popupClassName,
    popupOffset = _ref.popupOffset,
    disabled = _ref.disabled,
    mode = _ref.mode,
    onVisibleChange = _ref.onVisibleChange;
  var _React$useContext = react.useContext(MenuContext),
    getPopupContainer = _React$useContext.getPopupContainer,
    rtl = _React$useContext.rtl,
    subMenuOpenDelay = _React$useContext.subMenuOpenDelay,
    subMenuCloseDelay = _React$useContext.subMenuCloseDelay,
    builtinPlacements = _React$useContext.builtinPlacements,
    triggerSubMenuAction = _React$useContext.triggerSubMenuAction,
    forceSubMenuRender = _React$useContext.forceSubMenuRender,
    rootClassName = _React$useContext.rootClassName,
    motion = _React$useContext.motion,
    defaultMotions = _React$useContext.defaultMotions;
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    innerVisible = _React$useState2[0],
    setInnerVisible = _React$useState2[1];
  var placement = rtl ? (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, placementsRtl), builtinPlacements) : (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, placements), builtinPlacements);
  var popupPlacement = popupPlacementMap[mode];
  var targetMotion = getMotion(mode, motion, defaultMotions);
  var targetMotionRef = react.useRef(targetMotion);
  if (mode !== 'inline') {
    /**
     * PopupTrigger is only used for vertical and horizontal types.
     * When collapsed is unfolded, the inline animation will destroy the vertical animation.
     */
    targetMotionRef.current = targetMotion;
  }
  var mergedMotion = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, targetMotionRef.current), {}, {
    leavedClassName: "".concat(prefixCls, "-hidden"),
    removeOnLeave: false,
    motionAppear: true
  });

  // Delay to change visible
  var visibleRef = react.useRef();
  react.useEffect(function () {
    visibleRef.current = (0,raf/* default */.A)(function () {
      setInnerVisible(visible);
    });
    return function () {
      raf/* default */.A.cancel(visibleRef.current);
    };
  }, [visible]);
  return /*#__PURE__*/react.createElement(trigger_es/* default */.A, {
    prefixCls: prefixCls,
    popupClassName: classnames_default()("".concat(prefixCls, "-popup"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-rtl"), rtl), popupClassName, rootClassName),
    stretch: mode === 'horizontal' ? 'minWidth' : null,
    getPopupContainer: getPopupContainer,
    builtinPlacements: placement,
    popupPlacement: popupPlacement,
    popupVisible: innerVisible,
    popup: popup,
    popupStyle: popupStyle,
    popupAlign: popupOffset && {
      offset: popupOffset
    },
    action: disabled ? [] : [triggerSubMenuAction],
    mouseEnterDelay: subMenuOpenDelay,
    mouseLeaveDelay: subMenuCloseDelay,
    onPopupVisibleChange: onVisibleChange,
    forceRender: forceSubMenuRender,
    popupMotion: mergedMotion,
    fresh: true
  }, children);
}
// EXTERNAL MODULE: ./node_modules/rc-motion/es/index.js + 13 modules
var rc_motion_es = __webpack_require__(90754);
;// ./node_modules/rc-menu/es/SubMenu/InlineSubMenuList.js








function InlineSubMenuList(_ref) {
  var id = _ref.id,
    open = _ref.open,
    keyPath = _ref.keyPath,
    children = _ref.children;
  var fixedMode = 'inline';
  var _React$useContext = react.useContext(MenuContext),
    prefixCls = _React$useContext.prefixCls,
    forceSubMenuRender = _React$useContext.forceSubMenuRender,
    motion = _React$useContext.motion,
    defaultMotions = _React$useContext.defaultMotions,
    mode = _React$useContext.mode;

  // Always use latest mode check
  var sameModeRef = react.useRef(false);
  sameModeRef.current = mode === fixedMode;

  // We record `destroy` mark here since when mode change from `inline` to others.
  // The inline list should remove when motion end.
  var _React$useState = react.useState(!sameModeRef.current),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    destroy = _React$useState2[0],
    setDestroy = _React$useState2[1];
  var mergedOpen = sameModeRef.current ? open : false;

  // ================================= Effect =================================
  // Reset destroy state when mode change back
  react.useEffect(function () {
    if (sameModeRef.current) {
      setDestroy(false);
    }
  }, [mode]);

  // ================================= Render =================================
  var mergedMotion = (0,objectSpread2/* default */.A)({}, getMotion(fixedMode, motion, defaultMotions));

  // No need appear since nest inlineCollapse changed
  if (keyPath.length > 1) {
    mergedMotion.motionAppear = false;
  }

  // Hide inline list when mode changed and motion end
  var originOnVisibleChanged = mergedMotion.onVisibleChanged;
  mergedMotion.onVisibleChanged = function (newVisible) {
    if (!sameModeRef.current && !newVisible) {
      setDestroy(true);
    }
    return originOnVisibleChanged === null || originOnVisibleChanged === void 0 ? void 0 : originOnVisibleChanged(newVisible);
  };
  if (destroy) {
    return null;
  }
  return /*#__PURE__*/react.createElement(InheritableContextProvider, {
    mode: fixedMode,
    locked: !sameModeRef.current
  }, /*#__PURE__*/react.createElement(rc_motion_es/* default */.Ay, (0,esm_extends/* default */.A)({
    visible: mergedOpen
  }, mergedMotion, {
    forceRender: forceSubMenuRender,
    removeOnLeave: false,
    leavedClassName: "".concat(prefixCls, "-hidden")
  }), function (_ref2) {
    var motionClassName = _ref2.className,
      motionStyle = _ref2.style;
    return /*#__PURE__*/react.createElement(SubMenu_SubMenuList, {
      id: id,
      className: motionClassName,
      style: motionStyle
    }, children);
  }));
}
;// ./node_modules/rc-menu/es/SubMenu/index.js





var SubMenu_excluded = ["style", "className", "title", "eventKey", "warnKey", "disabled", "internalPopupClose", "children", "itemIcon", "expandIcon", "popupClassName", "popupOffset", "popupStyle", "onClick", "onMouseEnter", "onMouseLeave", "onTitleClick", "onTitleMouseEnter", "onTitleMouseLeave"],
  SubMenu_excluded2 = ["active"];

















var InternalSubMenu = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var style = props.style,
    className = props.className,
    title = props.title,
    eventKey = props.eventKey,
    warnKey = props.warnKey,
    disabled = props.disabled,
    internalPopupClose = props.internalPopupClose,
    children = props.children,
    itemIcon = props.itemIcon,
    expandIcon = props.expandIcon,
    popupClassName = props.popupClassName,
    popupOffset = props.popupOffset,
    popupStyle = props.popupStyle,
    onClick = props.onClick,
    onMouseEnter = props.onMouseEnter,
    onMouseLeave = props.onMouseLeave,
    onTitleClick = props.onTitleClick,
    onTitleMouseEnter = props.onTitleMouseEnter,
    onTitleMouseLeave = props.onTitleMouseLeave,
    restProps = (0,objectWithoutProperties/* default */.A)(props, SubMenu_excluded);
  var domDataId = useMenuId(eventKey);
  var _React$useContext = react.useContext(MenuContext),
    prefixCls = _React$useContext.prefixCls,
    mode = _React$useContext.mode,
    openKeys = _React$useContext.openKeys,
    contextDisabled = _React$useContext.disabled,
    overflowDisabled = _React$useContext.overflowDisabled,
    activeKey = _React$useContext.activeKey,
    selectedKeys = _React$useContext.selectedKeys,
    contextItemIcon = _React$useContext.itemIcon,
    contextExpandIcon = _React$useContext.expandIcon,
    onItemClick = _React$useContext.onItemClick,
    onOpenChange = _React$useContext.onOpenChange,
    onActive = _React$useContext.onActive;
  var _React$useContext2 = react.useContext(context_PrivateContext),
    _internalRenderSubMenuItem = _React$useContext2._internalRenderSubMenuItem;
  var _React$useContext3 = react.useContext(PathUserContext),
    isSubPathKey = _React$useContext3.isSubPathKey;
  var connectedPath = useFullPath();
  var subMenuPrefixCls = "".concat(prefixCls, "-submenu");
  var mergedDisabled = contextDisabled || disabled;
  var elementRef = react.useRef();
  var popupRef = react.useRef();

  // ================================ Warn ================================
  if (false) {}

  // ================================ Icon ================================
  var mergedItemIcon = itemIcon !== null && itemIcon !== void 0 ? itemIcon : contextItemIcon;
  var mergedExpandIcon = expandIcon !== null && expandIcon !== void 0 ? expandIcon : contextExpandIcon;

  // ================================ Open ================================
  var originOpen = openKeys.includes(eventKey);
  var open = !overflowDisabled && originOpen;

  // =============================== Select ===============================
  var childrenSelected = isSubPathKey(selectedKeys, eventKey);

  // =============================== Active ===============================
  var _useActive = useActive(eventKey, mergedDisabled, onTitleMouseEnter, onTitleMouseLeave),
    active = _useActive.active,
    activeProps = (0,objectWithoutProperties/* default */.A)(_useActive, SubMenu_excluded2);

  // Fallback of active check to avoid hover on menu title or disabled item
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    childrenActive = _React$useState2[0],
    setChildrenActive = _React$useState2[1];
  var triggerChildrenActive = function triggerChildrenActive(newActive) {
    if (!mergedDisabled) {
      setChildrenActive(newActive);
    }
  };
  var onInternalMouseEnter = function onInternalMouseEnter(domEvent) {
    triggerChildrenActive(true);
    onMouseEnter === null || onMouseEnter === void 0 || onMouseEnter({
      key: eventKey,
      domEvent: domEvent
    });
  };
  var onInternalMouseLeave = function onInternalMouseLeave(domEvent) {
    triggerChildrenActive(false);
    onMouseLeave === null || onMouseLeave === void 0 || onMouseLeave({
      key: eventKey,
      domEvent: domEvent
    });
  };
  var mergedActive = react.useMemo(function () {
    if (active) {
      return active;
    }
    if (mode !== 'inline') {
      return childrenActive || isSubPathKey([activeKey], eventKey);
    }
    return false;
  }, [mode, active, activeKey, childrenActive, eventKey, isSubPathKey]);

  // ========================== DirectionStyle ==========================
  var directionStyle = useDirectionStyle(connectedPath.length);

  // =============================== Events ===============================
  // >>>> Title click
  var onInternalTitleClick = function onInternalTitleClick(e) {
    // Skip if disabled
    if (mergedDisabled) {
      return;
    }
    onTitleClick === null || onTitleClick === void 0 || onTitleClick({
      key: eventKey,
      domEvent: e
    });

    // Trigger open by click when mode is `inline`
    if (mode === 'inline') {
      onOpenChange(eventKey, !originOpen);
    }
  };

  // >>>> Context for children click
  var onMergedItemClick = useMemoCallback(function (info) {
    onClick === null || onClick === void 0 || onClick(warnItemProp(info));
    onItemClick(info);
  });

  // >>>>> Visible change
  var onPopupVisibleChange = function onPopupVisibleChange(newVisible) {
    if (mode !== 'inline') {
      onOpenChange(eventKey, newVisible);
    }
  };

  /**
   * Used for accessibility. Helper will focus element without key board.
   * We should manually trigger an active
   */
  var onInternalFocus = function onInternalFocus() {
    onActive(eventKey);
  };

  // =============================== Render ===============================
  var popupId = domDataId && "".concat(domDataId, "-popup");

  // >>>>> Title
  var titleNode = /*#__PURE__*/react.createElement("div", (0,esm_extends/* default */.A)({
    role: "menuitem",
    style: directionStyle,
    className: "".concat(subMenuPrefixCls, "-title"),
    tabIndex: mergedDisabled ? null : -1,
    ref: elementRef,
    title: typeof title === 'string' ? title : null,
    "data-menu-id": overflowDisabled && domDataId ? null : domDataId,
    "aria-expanded": open,
    "aria-haspopup": true,
    "aria-controls": popupId,
    "aria-disabled": mergedDisabled,
    onClick: onInternalTitleClick,
    onFocus: onInternalFocus
  }, activeProps), title, /*#__PURE__*/react.createElement(Icon, {
    icon: mode !== 'horizontal' ? mergedExpandIcon : undefined,
    props: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, props), {}, {
      isOpen: open,
      // [Legacy] Not sure why need this mark
      isSubMenu: true
    })
  }, /*#__PURE__*/react.createElement("i", {
    className: "".concat(subMenuPrefixCls, "-arrow")
  })));

  // Cache mode if it change to `inline` which do not have popup motion
  var triggerModeRef = react.useRef(mode);
  if (mode !== 'inline' && connectedPath.length > 1) {
    triggerModeRef.current = 'vertical';
  } else {
    triggerModeRef.current = mode;
  }
  if (!overflowDisabled) {
    var triggerMode = triggerModeRef.current;

    // Still wrap with Trigger here since we need avoid react re-mount dom node
    // Which makes motion failed
    titleNode = /*#__PURE__*/react.createElement(PopupTrigger, {
      mode: triggerMode,
      prefixCls: subMenuPrefixCls,
      visible: !internalPopupClose && open && mode !== 'inline',
      popupClassName: popupClassName,
      popupOffset: popupOffset,
      popupStyle: popupStyle,
      popup: /*#__PURE__*/react.createElement(InheritableContextProvider
      // Special handle of horizontal mode
      , {
        mode: triggerMode === 'horizontal' ? 'vertical' : triggerMode
      }, /*#__PURE__*/react.createElement(SubMenu_SubMenuList, {
        id: popupId,
        ref: popupRef
      }, children)),
      disabled: mergedDisabled,
      onVisibleChange: onPopupVisibleChange
    }, titleNode);
  }

  // >>>>> List node
  var listNode = /*#__PURE__*/react.createElement(es/* default */.A.Item, (0,esm_extends/* default */.A)({
    ref: ref,
    role: "none"
  }, restProps, {
    component: "li",
    style: style,
    className: classnames_default()(subMenuPrefixCls, "".concat(subMenuPrefixCls, "-").concat(mode), className, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(subMenuPrefixCls, "-open"), open), "".concat(subMenuPrefixCls, "-active"), mergedActive), "".concat(subMenuPrefixCls, "-selected"), childrenSelected), "".concat(subMenuPrefixCls, "-disabled"), mergedDisabled)),
    onMouseEnter: onInternalMouseEnter,
    onMouseLeave: onInternalMouseLeave
  }), titleNode, !overflowDisabled && /*#__PURE__*/react.createElement(InlineSubMenuList, {
    id: popupId,
    open: open,
    keyPath: connectedPath
  }, children));
  if (_internalRenderSubMenuItem) {
    listNode = _internalRenderSubMenuItem(listNode, props, {
      selected: childrenSelected,
      active: mergedActive,
      open: open,
      disabled: mergedDisabled
    });
  }

  // >>>>> Render
  return /*#__PURE__*/react.createElement(InheritableContextProvider, {
    onItemClick: onMergedItemClick,
    mode: mode === 'horizontal' ? 'vertical' : mode,
    itemIcon: mergedItemIcon,
    expandIcon: mergedExpandIcon
  }, listNode);
});
var SubMenu = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var eventKey = props.eventKey,
    children = props.children;
  var connectedKeyPath = useFullPath(eventKey);
  var childList = parseChildren(children, connectedKeyPath);

  // ==================== Record KeyPath ====================
  var measure = useMeasure();

  // eslint-disable-next-line consistent-return
  react.useEffect(function () {
    if (measure) {
      measure.registerPath(eventKey, connectedKeyPath);
      return function () {
        measure.unregisterPath(eventKey, connectedKeyPath);
      };
    }
  }, [connectedKeyPath]);
  var renderNode;

  // ======================== Render ========================
  if (measure) {
    renderNode = childList;
  } else {
    renderNode = /*#__PURE__*/react.createElement(InternalSubMenu, (0,esm_extends/* default */.A)({
      ref: ref
    }, props), childList);
  }
  return /*#__PURE__*/react.createElement(PathTrackerContext.Provider, {
    value: connectedKeyPath
  }, renderNode);
});
if (false) {}
/* harmony default export */ var es_SubMenu = (SubMenu);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/typeof.js
var esm_typeof = __webpack_require__(82284);
;// ./node_modules/rc-menu/es/Divider.js




function Divider(_ref) {
  var className = _ref.className,
    style = _ref.style;
  var _React$useContext = react.useContext(MenuContext),
    prefixCls = _React$useContext.prefixCls;
  var measure = useMeasure();
  if (measure) {
    return null;
  }
  return /*#__PURE__*/react.createElement("li", {
    role: "separator",
    className: classnames_default()("".concat(prefixCls, "-item-divider"), className),
    style: style
  });
}
;// ./node_modules/rc-menu/es/MenuItemGroup.js


var MenuItemGroup_excluded = ["className", "title", "eventKey", "children"];






var InternalMenuItemGroup = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var className = props.className,
    title = props.title,
    eventKey = props.eventKey,
    children = props.children,
    restProps = (0,objectWithoutProperties/* default */.A)(props, MenuItemGroup_excluded);
  var _React$useContext = react.useContext(MenuContext),
    prefixCls = _React$useContext.prefixCls;
  var groupPrefixCls = "".concat(prefixCls, "-item-group");
  return /*#__PURE__*/react.createElement("li", (0,esm_extends/* default */.A)({
    ref: ref,
    role: "presentation"
  }, restProps, {
    onClick: function onClick(e) {
      return e.stopPropagation();
    },
    className: classnames_default()(groupPrefixCls, className)
  }), /*#__PURE__*/react.createElement("div", {
    role: "presentation",
    className: "".concat(groupPrefixCls, "-title"),
    title: typeof title === 'string' ? title : undefined
  }, title), /*#__PURE__*/react.createElement("ul", {
    role: "group",
    className: "".concat(groupPrefixCls, "-list")
  }, children));
});
var MenuItemGroup = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var eventKey = props.eventKey,
    children = props.children;
  var connectedKeyPath = useFullPath(eventKey);
  var childList = parseChildren(children, connectedKeyPath);
  var measure = useMeasure();
  if (measure) {
    return childList;
  }
  return /*#__PURE__*/react.createElement(InternalMenuItemGroup, (0,esm_extends/* default */.A)({
    ref: ref
  }, (0,omit/* default */.A)(props, ['warnKey'])), childList);
});
if (false) {}
/* harmony default export */ var es_MenuItemGroup = (MenuItemGroup);
;// ./node_modules/rc-menu/es/utils/nodeUtil.js




var nodeUtil_excluded = ["label", "children", "key", "type", "extra"];






function convertItemsToNodes(list, components, prefixCls) {
  var MergedMenuItem = components.item,
    MergedMenuItemGroup = components.group,
    MergedSubMenu = components.submenu,
    MergedDivider = components.divider;
  return (list || []).map(function (opt, index) {
    if (opt && (0,esm_typeof/* default */.A)(opt) === 'object') {
      var _ref = opt,
        label = _ref.label,
        children = _ref.children,
        key = _ref.key,
        type = _ref.type,
        extra = _ref.extra,
        restProps = (0,objectWithoutProperties/* default */.A)(_ref, nodeUtil_excluded);
      var mergedKey = key !== null && key !== void 0 ? key : "tmp-".concat(index);

      // MenuItemGroup & SubMenuItem
      if (children || type === 'group') {
        if (type === 'group') {
          // Group
          return /*#__PURE__*/react.createElement(MergedMenuItemGroup, (0,esm_extends/* default */.A)({
            key: mergedKey
          }, restProps, {
            title: label
          }), convertItemsToNodes(children, components, prefixCls));
        }

        // Sub Menu
        return /*#__PURE__*/react.createElement(MergedSubMenu, (0,esm_extends/* default */.A)({
          key: mergedKey
        }, restProps, {
          title: label
        }), convertItemsToNodes(children, components, prefixCls));
      }

      // MenuItem & Divider
      if (type === 'divider') {
        return /*#__PURE__*/react.createElement(MergedDivider, (0,esm_extends/* default */.A)({
          key: mergedKey
        }, restProps));
      }
      return /*#__PURE__*/react.createElement(MergedMenuItem, (0,esm_extends/* default */.A)({
        key: mergedKey
      }, restProps, {
        extra: extra
      }), label, (!!extra || extra === 0) && /*#__PURE__*/react.createElement("span", {
        className: "".concat(prefixCls, "-item-extra")
      }, extra));
    }
    return null;
  }).filter(function (opt) {
    return opt;
  });
}
function parseItems(children, items, keyPath, components, prefixCls) {
  var childNodes = children;
  var mergedComponents = (0,objectSpread2/* default */.A)({
    divider: Divider,
    item: es_MenuItem,
    group: es_MenuItemGroup,
    submenu: es_SubMenu
  }, components);
  if (items) {
    childNodes = convertItemsToNodes(items, mergedComponents, prefixCls);
  }
  return parseChildren(childNodes, keyPath);
}
;// ./node_modules/rc-menu/es/Menu.js






var Menu_excluded = ["prefixCls", "rootClassName", "style", "className", "tabIndex", "items", "children", "direction", "id", "mode", "inlineCollapsed", "disabled", "disabledOverflow", "subMenuOpenDelay", "subMenuCloseDelay", "forceSubMenuRender", "defaultOpenKeys", "openKeys", "activeKey", "defaultActiveFirst", "selectable", "multiple", "defaultSelectedKeys", "selectedKeys", "onSelect", "onDeselect", "inlineIndent", "motion", "defaultMotions", "triggerSubMenuAction", "builtinPlacements", "itemIcon", "expandIcon", "overflowedIndicator", "overflowedIndicatorPopupClassName", "getPopupContainer", "onClick", "onOpenChange", "onKeyDown", "openAnimation", "openTransitionName", "_internalRenderMenuItem", "_internalRenderSubMenuItem", "_internalComponents"];





















/**
 * Menu modify after refactor:
 * ## Add
 * - disabled
 *
 * ## Remove
 * - openTransitionName
 * - openAnimation
 * - onDestroy
 * - siderCollapsed: Seems antd do not use this prop (Need test in antd)
 * - collapsedWidth: Seems this logic should be handle by antd Layout.Sider
 */

// optimize for render
var EMPTY_LIST = [];
var Menu = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var _childList$;
  var _ref = props,
    _ref$prefixCls = _ref.prefixCls,
    prefixCls = _ref$prefixCls === void 0 ? 'rc-menu' : _ref$prefixCls,
    rootClassName = _ref.rootClassName,
    style = _ref.style,
    className = _ref.className,
    _ref$tabIndex = _ref.tabIndex,
    tabIndex = _ref$tabIndex === void 0 ? 0 : _ref$tabIndex,
    items = _ref.items,
    children = _ref.children,
    direction = _ref.direction,
    id = _ref.id,
    _ref$mode = _ref.mode,
    mode = _ref$mode === void 0 ? 'vertical' : _ref$mode,
    inlineCollapsed = _ref.inlineCollapsed,
    disabled = _ref.disabled,
    disabledOverflow = _ref.disabledOverflow,
    _ref$subMenuOpenDelay = _ref.subMenuOpenDelay,
    subMenuOpenDelay = _ref$subMenuOpenDelay === void 0 ? 0.1 : _ref$subMenuOpenDelay,
    _ref$subMenuCloseDela = _ref.subMenuCloseDelay,
    subMenuCloseDelay = _ref$subMenuCloseDela === void 0 ? 0.1 : _ref$subMenuCloseDela,
    forceSubMenuRender = _ref.forceSubMenuRender,
    defaultOpenKeys = _ref.defaultOpenKeys,
    openKeys = _ref.openKeys,
    activeKey = _ref.activeKey,
    defaultActiveFirst = _ref.defaultActiveFirst,
    _ref$selectable = _ref.selectable,
    selectable = _ref$selectable === void 0 ? true : _ref$selectable,
    _ref$multiple = _ref.multiple,
    multiple = _ref$multiple === void 0 ? false : _ref$multiple,
    defaultSelectedKeys = _ref.defaultSelectedKeys,
    selectedKeys = _ref.selectedKeys,
    onSelect = _ref.onSelect,
    onDeselect = _ref.onDeselect,
    _ref$inlineIndent = _ref.inlineIndent,
    inlineIndent = _ref$inlineIndent === void 0 ? 24 : _ref$inlineIndent,
    motion = _ref.motion,
    defaultMotions = _ref.defaultMotions,
    _ref$triggerSubMenuAc = _ref.triggerSubMenuAction,
    triggerSubMenuAction = _ref$triggerSubMenuAc === void 0 ? 'hover' : _ref$triggerSubMenuAc,
    builtinPlacements = _ref.builtinPlacements,
    itemIcon = _ref.itemIcon,
    expandIcon = _ref.expandIcon,
    _ref$overflowedIndica = _ref.overflowedIndicator,
    overflowedIndicator = _ref$overflowedIndica === void 0 ? '...' : _ref$overflowedIndica,
    overflowedIndicatorPopupClassName = _ref.overflowedIndicatorPopupClassName,
    getPopupContainer = _ref.getPopupContainer,
    onClick = _ref.onClick,
    onOpenChange = _ref.onOpenChange,
    onKeyDown = _ref.onKeyDown,
    openAnimation = _ref.openAnimation,
    openTransitionName = _ref.openTransitionName,
    _internalRenderMenuItem = _ref._internalRenderMenuItem,
    _internalRenderSubMenuItem = _ref._internalRenderSubMenuItem,
    _internalComponents = _ref._internalComponents,
    restProps = (0,objectWithoutProperties/* default */.A)(_ref, Menu_excluded);
  var _React$useMemo = react.useMemo(function () {
      return [parseItems(children, items, EMPTY_LIST, _internalComponents, prefixCls), parseItems(children, items, EMPTY_LIST, {}, prefixCls)];
    }, [children, items, _internalComponents]),
    _React$useMemo2 = (0,slicedToArray/* default */.A)(_React$useMemo, 2),
    childList = _React$useMemo2[0],
    measureChildList = _React$useMemo2[1];
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    mounted = _React$useState2[0],
    setMounted = _React$useState2[1];
  var containerRef = react.useRef();
  var uuid = useUUID(id);
  var isRtl = direction === 'rtl';

  // ========================= Warn =========================
  if (false) {}

  // ========================= Open =========================
  var _useMergedState = (0,useMergedState/* default */.A)(defaultOpenKeys, {
      value: openKeys,
      postState: function postState(keys) {
        return keys || EMPTY_LIST;
      }
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    mergedOpenKeys = _useMergedState2[0],
    setMergedOpenKeys = _useMergedState2[1];

  // React 18 will merge mouse event which means we open key will not sync
  // ref: https://github.com/ant-design/ant-design/issues/38818
  var triggerOpenKeys = function triggerOpenKeys(keys) {
    var forceFlush = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
    function doUpdate() {
      setMergedOpenKeys(keys);
      onOpenChange === null || onOpenChange === void 0 || onOpenChange(keys);
    }
    if (forceFlush) {
      (0,react_dom.flushSync)(doUpdate);
    } else {
      doUpdate();
    }
  };

  // >>>>> Cache & Reset open keys when inlineCollapsed changed
  var _React$useState3 = react.useState(mergedOpenKeys),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    inlineCacheOpenKeys = _React$useState4[0],
    setInlineCacheOpenKeys = _React$useState4[1];
  var mountRef = react.useRef(false);

  // ========================= Mode =========================
  var _React$useMemo3 = react.useMemo(function () {
      if ((mode === 'inline' || mode === 'vertical') && inlineCollapsed) {
        return ['vertical', inlineCollapsed];
      }
      return [mode, false];
    }, [mode, inlineCollapsed]),
    _React$useMemo4 = (0,slicedToArray/* default */.A)(_React$useMemo3, 2),
    mergedMode = _React$useMemo4[0],
    mergedInlineCollapsed = _React$useMemo4[1];
  var isInlineMode = mergedMode === 'inline';
  var _React$useState5 = react.useState(mergedMode),
    _React$useState6 = (0,slicedToArray/* default */.A)(_React$useState5, 2),
    internalMode = _React$useState6[0],
    setInternalMode = _React$useState6[1];
  var _React$useState7 = react.useState(mergedInlineCollapsed),
    _React$useState8 = (0,slicedToArray/* default */.A)(_React$useState7, 2),
    internalInlineCollapsed = _React$useState8[0],
    setInternalInlineCollapsed = _React$useState8[1];
  react.useEffect(function () {
    setInternalMode(mergedMode);
    setInternalInlineCollapsed(mergedInlineCollapsed);
    if (!mountRef.current) {
      return;
    }
    // Synchronously update MergedOpenKeys
    if (isInlineMode) {
      setMergedOpenKeys(inlineCacheOpenKeys);
    } else {
      // Trigger open event in case its in control
      triggerOpenKeys(EMPTY_LIST);
    }
  }, [mergedMode, mergedInlineCollapsed]);

  // ====================== Responsive ======================
  var _React$useState9 = react.useState(0),
    _React$useState10 = (0,slicedToArray/* default */.A)(_React$useState9, 2),
    lastVisibleIndex = _React$useState10[0],
    setLastVisibleIndex = _React$useState10[1];
  var allVisible = lastVisibleIndex >= childList.length - 1 || internalMode !== 'horizontal' || disabledOverflow;

  // Cache
  react.useEffect(function () {
    if (isInlineMode) {
      setInlineCacheOpenKeys(mergedOpenKeys);
    }
  }, [mergedOpenKeys]);
  react.useEffect(function () {
    mountRef.current = true;
    return function () {
      mountRef.current = false;
    };
  }, []);

  // ========================= Path =========================
  var _useKeyRecords = useKeyRecords(),
    registerPath = _useKeyRecords.registerPath,
    unregisterPath = _useKeyRecords.unregisterPath,
    refreshOverflowKeys = _useKeyRecords.refreshOverflowKeys,
    isSubPathKey = _useKeyRecords.isSubPathKey,
    getKeyPath = _useKeyRecords.getKeyPath,
    getKeys = _useKeyRecords.getKeys,
    getSubPathKeys = _useKeyRecords.getSubPathKeys;
  var registerPathContext = react.useMemo(function () {
    return {
      registerPath: registerPath,
      unregisterPath: unregisterPath
    };
  }, [registerPath, unregisterPath]);
  var pathUserContext = react.useMemo(function () {
    return {
      isSubPathKey: isSubPathKey
    };
  }, [isSubPathKey]);
  react.useEffect(function () {
    refreshOverflowKeys(allVisible ? EMPTY_LIST : childList.slice(lastVisibleIndex + 1).map(function (child) {
      return child.key;
    }));
  }, [lastVisibleIndex, allVisible]);

  // ======================== Active ========================
  var _useMergedState3 = (0,useMergedState/* default */.A)(activeKey || defaultActiveFirst && ((_childList$ = childList[0]) === null || _childList$ === void 0 ? void 0 : _childList$.key), {
      value: activeKey
    }),
    _useMergedState4 = (0,slicedToArray/* default */.A)(_useMergedState3, 2),
    mergedActiveKey = _useMergedState4[0],
    setMergedActiveKey = _useMergedState4[1];
  var onActive = useMemoCallback(function (key) {
    setMergedActiveKey(key);
  });
  var onInactive = useMemoCallback(function () {
    setMergedActiveKey(undefined);
  });
  (0,react.useImperativeHandle)(ref, function () {
    return {
      list: containerRef.current,
      focus: function focus(options) {
        var _childList$find;
        var keys = getKeys();
        var _refreshElements = refreshElements(keys, uuid),
          elements = _refreshElements.elements,
          key2element = _refreshElements.key2element,
          element2key = _refreshElements.element2key;
        var focusableElements = getFocusableElements(containerRef.current, elements);
        var shouldFocusKey = mergedActiveKey !== null && mergedActiveKey !== void 0 ? mergedActiveKey : focusableElements[0] ? element2key.get(focusableElements[0]) : (_childList$find = childList.find(function (node) {
          return !node.props.disabled;
        })) === null || _childList$find === void 0 ? void 0 : _childList$find.key;
        var elementToFocus = key2element.get(shouldFocusKey);
        if (shouldFocusKey && elementToFocus) {
          var _elementToFocus$focus;
          elementToFocus === null || elementToFocus === void 0 || (_elementToFocus$focus = elementToFocus.focus) === null || _elementToFocus$focus === void 0 || _elementToFocus$focus.call(elementToFocus, options);
        }
      }
    };
  });

  // ======================== Select ========================
  // >>>>> Select keys
  var _useMergedState5 = (0,useMergedState/* default */.A)(defaultSelectedKeys || [], {
      value: selectedKeys,
      // Legacy convert key to array
      postState: function postState(keys) {
        if (Array.isArray(keys)) {
          return keys;
        }
        if (keys === null || keys === undefined) {
          return EMPTY_LIST;
        }
        return [keys];
      }
    }),
    _useMergedState6 = (0,slicedToArray/* default */.A)(_useMergedState5, 2),
    mergedSelectKeys = _useMergedState6[0],
    setMergedSelectKeys = _useMergedState6[1];

  // >>>>> Trigger select
  var triggerSelection = function triggerSelection(info) {
    if (selectable) {
      // Insert or Remove
      var targetKey = info.key;
      var exist = mergedSelectKeys.includes(targetKey);
      var newSelectKeys;
      if (multiple) {
        if (exist) {
          newSelectKeys = mergedSelectKeys.filter(function (key) {
            return key !== targetKey;
          });
        } else {
          newSelectKeys = [].concat((0,toConsumableArray/* default */.A)(mergedSelectKeys), [targetKey]);
        }
      } else {
        newSelectKeys = [targetKey];
      }
      setMergedSelectKeys(newSelectKeys);

      // Trigger event
      var selectInfo = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, info), {}, {
        selectedKeys: newSelectKeys
      });
      if (exist) {
        onDeselect === null || onDeselect === void 0 || onDeselect(selectInfo);
      } else {
        onSelect === null || onSelect === void 0 || onSelect(selectInfo);
      }
    }

    // Whatever selectable, always close it
    if (!multiple && mergedOpenKeys.length && internalMode !== 'inline') {
      triggerOpenKeys(EMPTY_LIST);
    }
  };

  // ========================= Open =========================
  /**
   * Click for item. SubMenu do not have selection status
   */
  var onInternalClick = useMemoCallback(function (info) {
    onClick === null || onClick === void 0 || onClick(warnItemProp(info));
    triggerSelection(info);
  });
  var onInternalOpenChange = useMemoCallback(function (key, open) {
    var newOpenKeys = mergedOpenKeys.filter(function (k) {
      return k !== key;
    });
    if (open) {
      newOpenKeys.push(key);
    } else if (internalMode !== 'inline') {
      // We need find all related popup to close
      var subPathKeys = getSubPathKeys(key);
      newOpenKeys = newOpenKeys.filter(function (k) {
        return !subPathKeys.has(k);
      });
    }
    if (!(0,isEqual/* default */.A)(mergedOpenKeys, newOpenKeys, true)) {
      triggerOpenKeys(newOpenKeys, true);
    }
  });

  // ==================== Accessibility =====================
  var triggerAccessibilityOpen = function triggerAccessibilityOpen(key, open) {
    var nextOpen = open !== null && open !== void 0 ? open : !mergedOpenKeys.includes(key);
    onInternalOpenChange(key, nextOpen);
  };
  var onInternalKeyDown = useAccessibility(internalMode, mergedActiveKey, isRtl, uuid, containerRef, getKeys, getKeyPath, setMergedActiveKey, triggerAccessibilityOpen, onKeyDown);

  // ======================== Effect ========================
  react.useEffect(function () {
    setMounted(true);
  }, []);

  // ======================= Context ========================
  var privateContext = react.useMemo(function () {
    return {
      _internalRenderMenuItem: _internalRenderMenuItem,
      _internalRenderSubMenuItem: _internalRenderSubMenuItem
    };
  }, [_internalRenderMenuItem, _internalRenderSubMenuItem]);

  // ======================== Render ========================

  // >>>>> Children
  var wrappedChildList = internalMode !== 'horizontal' || disabledOverflow ? childList :
  // Need wrap for overflow dropdown that do not response for open
  childList.map(function (child, index) {
    return (
      /*#__PURE__*/
      // Always wrap provider to avoid sub node re-mount
      react.createElement(InheritableContextProvider, {
        key: child.key,
        overflowDisabled: index > lastVisibleIndex
      }, child)
    );
  });

  // >>>>> Container
  var container = /*#__PURE__*/react.createElement(es/* default */.A, (0,esm_extends/* default */.A)({
    id: id,
    ref: containerRef,
    prefixCls: "".concat(prefixCls, "-overflow"),
    component: "ul",
    itemComponent: es_MenuItem,
    className: classnames_default()(prefixCls, "".concat(prefixCls, "-root"), "".concat(prefixCls, "-").concat(internalMode), className, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-inline-collapsed"), internalInlineCollapsed), "".concat(prefixCls, "-rtl"), isRtl), rootClassName),
    dir: direction,
    style: style,
    role: "menu",
    tabIndex: tabIndex,
    data: wrappedChildList,
    renderRawItem: function renderRawItem(node) {
      return node;
    },
    renderRawRest: function renderRawRest(omitItems) {
      // We use origin list since wrapped list use context to prevent open
      var len = omitItems.length;
      var originOmitItems = len ? childList.slice(-len) : null;
      return /*#__PURE__*/react.createElement(es_SubMenu, {
        eventKey: OVERFLOW_KEY,
        title: overflowedIndicator,
        disabled: allVisible,
        internalPopupClose: len === 0,
        popupClassName: overflowedIndicatorPopupClassName
      }, originOmitItems);
    },
    maxCount: internalMode !== 'horizontal' || disabledOverflow ? es/* default */.A.INVALIDATE : es/* default */.A.RESPONSIVE,
    ssr: "full",
    "data-menu-list": true,
    onVisibleChange: function onVisibleChange(newLastIndex) {
      setLastVisibleIndex(newLastIndex);
    },
    onKeyDown: onInternalKeyDown
  }, restProps));

  // >>>>> Render
  return /*#__PURE__*/react.createElement(context_PrivateContext.Provider, {
    value: privateContext
  }, /*#__PURE__*/react.createElement(IdContext.Provider, {
    value: uuid
  }, /*#__PURE__*/react.createElement(InheritableContextProvider, {
    prefixCls: prefixCls,
    rootClassName: rootClassName,
    mode: internalMode,
    openKeys: mergedOpenKeys,
    rtl: isRtl
    // Disabled
    ,
    disabled: disabled
    // Motion
    ,
    motion: mounted ? motion : null,
    defaultMotions: mounted ? defaultMotions : null
    // Active
    ,
    activeKey: mergedActiveKey,
    onActive: onActive,
    onInactive: onInactive
    // Selection
    ,
    selectedKeys: mergedSelectKeys
    // Level
    ,
    inlineIndent: inlineIndent
    // Popup
    ,
    subMenuOpenDelay: subMenuOpenDelay,
    subMenuCloseDelay: subMenuCloseDelay,
    forceSubMenuRender: forceSubMenuRender,
    builtinPlacements: builtinPlacements,
    triggerSubMenuAction: triggerSubMenuAction,
    getPopupContainer: getPopupContainer
    // Icon
    ,
    itemIcon: itemIcon,
    expandIcon: expandIcon
    // Events
    ,
    onItemClick: onInternalClick,
    onOpenChange: onInternalOpenChange
  }, /*#__PURE__*/react.createElement(PathUserContext.Provider, {
    value: pathUserContext
  }, container), /*#__PURE__*/react.createElement("div", {
    style: {
      display: 'none'
    },
    "aria-hidden": true
  }, /*#__PURE__*/react.createElement(PathRegisterContext.Provider, {
    value: registerPathContext
  }, measureChildList)))));
});
/* harmony default export */ var es_Menu = (Menu);
;// ./node_modules/rc-menu/es/index.js







var ExportMenu = es_Menu;
ExportMenu.Item = es_MenuItem;
ExportMenu.SubMenu = es_SubMenu;
ExportMenu.ItemGroup = es_MenuItemGroup;
ExportMenu.Divider = Divider;
/* harmony default export */ var rc_menu_es = (ExportMenu);

/***/ })

}]);
//# sourceMappingURL=7e14c84ff1deba75e82059b0c922bfc7d51f387e-27f48af9b3b5dd98844b.js.map