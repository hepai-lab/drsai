"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[3716],{

/***/ 57826:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ pages_SkillsSquarePage; }
});

// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectSpread2.js
var objectSpread2 = __webpack_require__(89379);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/@rc-component/portal/es/index.js + 6 modules
var es = __webpack_require__(45062);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useLayoutEffect.js
var useLayoutEffect = __webpack_require__(30981);
;// ./node_modules/rc-drawer/es/context.js

var DrawerContext = /*#__PURE__*/react.createContext(null);
var RefContext = /*#__PURE__*/react.createContext({});
/* harmony default export */ var context = (DrawerContext);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/rc-motion/es/index.js + 13 modules
var rc_motion_es = __webpack_require__(90754);
// EXTERNAL MODULE: ./node_modules/rc-util/es/KeyCode.js
var KeyCode = __webpack_require__(16928);
// EXTERNAL MODULE: ./node_modules/rc-util/es/pickAttrs.js
var pickAttrs = __webpack_require__(72065);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
var objectWithoutProperties = __webpack_require__(80045);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var ref = __webpack_require__(8719);
;// ./node_modules/rc-drawer/es/DrawerPanel.js


var _excluded = ["prefixCls", "className", "containerRef"];





var DrawerPanel = function DrawerPanel(props) {
  var prefixCls = props.prefixCls,
    className = props.className,
    containerRef = props.containerRef,
    restProps = (0,objectWithoutProperties/* default */.A)(props, _excluded);
  var _React$useContext = react.useContext(RefContext),
    panelRef = _React$useContext.panel;
  var mergedRef = (0,ref/* useComposeRef */.xK)(panelRef, containerRef);

  // =============================== Render ===============================

  return /*#__PURE__*/react.createElement("div", (0,esm_extends/* default */.A)({
    className: classnames_default()("".concat(prefixCls, "-content"), className),
    role: "dialog",
    ref: mergedRef
  }, (0,pickAttrs/* default */.A)(props, {
    aria: true
  }), {
    "aria-modal": "true"
  }, restProps));
};
if (false) {}
/* harmony default export */ var es_DrawerPanel = (DrawerPanel);
// EXTERNAL MODULE: ./node_modules/rc-util/es/warning.js
var es_warning = __webpack_require__(68210);
;// ./node_modules/rc-drawer/es/util.js


function parseWidthHeight(value) {
  if (typeof value === 'string' && String(Number(value)) === value) {
    (0,es_warning/* default */.Ay)(false, 'Invalid value type of `width` or `height` which should be number type instead.');
    return Number(value);
  }
  return value;
}
function warnCheck(props) {
  warning(!('wrapperClassName' in props), "'wrapperClassName' is removed. Please use 'rootClassName' instead.");
  warning(canUseDom() || !props.open, "Drawer with 'open' in SSR is not work since no place to createPortal. Please move to 'useEffect' instead.");
}
;// ./node_modules/rc-drawer/es/DrawerPopup.js












var sentinelStyle = {
  width: 0,
  height: 0,
  overflow: 'hidden',
  outline: 'none',
  position: 'absolute'
};
function DrawerPopup(props, ref) {
  var _ref, _pushConfig$distance, _pushConfig;
  var prefixCls = props.prefixCls,
    open = props.open,
    placement = props.placement,
    inline = props.inline,
    push = props.push,
    forceRender = props.forceRender,
    autoFocus = props.autoFocus,
    keyboard = props.keyboard,
    drawerClassNames = props.classNames,
    rootClassName = props.rootClassName,
    rootStyle = props.rootStyle,
    zIndex = props.zIndex,
    className = props.className,
    id = props.id,
    style = props.style,
    motion = props.motion,
    width = props.width,
    height = props.height,
    children = props.children,
    mask = props.mask,
    maskClosable = props.maskClosable,
    maskMotion = props.maskMotion,
    maskClassName = props.maskClassName,
    maskStyle = props.maskStyle,
    afterOpenChange = props.afterOpenChange,
    onClose = props.onClose,
    onMouseEnter = props.onMouseEnter,
    onMouseOver = props.onMouseOver,
    onMouseLeave = props.onMouseLeave,
    onClick = props.onClick,
    onKeyDown = props.onKeyDown,
    onKeyUp = props.onKeyUp,
    styles = props.styles,
    drawerRender = props.drawerRender;

  // ================================ Refs ================================
  var panelRef = react.useRef();
  var sentinelStartRef = react.useRef();
  var sentinelEndRef = react.useRef();
  react.useImperativeHandle(ref, function () {
    return panelRef.current;
  });
  var onPanelKeyDown = function onPanelKeyDown(event) {
    var keyCode = event.keyCode,
      shiftKey = event.shiftKey;
    switch (keyCode) {
      // Tab active
      case KeyCode/* default */.A.TAB:
        {
          if (keyCode === KeyCode/* default */.A.TAB) {
            if (!shiftKey && document.activeElement === sentinelEndRef.current) {
              var _sentinelStartRef$cur;
              (_sentinelStartRef$cur = sentinelStartRef.current) === null || _sentinelStartRef$cur === void 0 || _sentinelStartRef$cur.focus({
                preventScroll: true
              });
            } else if (shiftKey && document.activeElement === sentinelStartRef.current) {
              var _sentinelEndRef$curre;
              (_sentinelEndRef$curre = sentinelEndRef.current) === null || _sentinelEndRef$curre === void 0 || _sentinelEndRef$curre.focus({
                preventScroll: true
              });
            }
          }
          break;
        }

      // Close
      case KeyCode/* default */.A.ESC:
        {
          if (onClose && keyboard) {
            event.stopPropagation();
            onClose(event);
          }
          break;
        }
    }
  };

  // ========================== Control ===========================
  // Auto Focus
  react.useEffect(function () {
    if (open && autoFocus) {
      var _panelRef$current;
      (_panelRef$current = panelRef.current) === null || _panelRef$current === void 0 || _panelRef$current.focus({
        preventScroll: true
      });
    }
  }, [open]);

  // ============================ Push ============================
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    pushed = _React$useState2[0],
    setPushed = _React$useState2[1];
  var parentContext = react.useContext(context);

  // Merge push distance
  var pushConfig;
  if (typeof push === 'boolean') {
    pushConfig = push ? {} : {
      distance: 0
    };
  } else {
    pushConfig = push || {};
  }
  var pushDistance = (_ref = (_pushConfig$distance = (_pushConfig = pushConfig) === null || _pushConfig === void 0 ? void 0 : _pushConfig.distance) !== null && _pushConfig$distance !== void 0 ? _pushConfig$distance : parentContext === null || parentContext === void 0 ? void 0 : parentContext.pushDistance) !== null && _ref !== void 0 ? _ref : 180;
  var mergedContext = react.useMemo(function () {
    return {
      pushDistance: pushDistance,
      push: function push() {
        setPushed(true);
      },
      pull: function pull() {
        setPushed(false);
      }
    };
  }, [pushDistance]);

  // ========================= ScrollLock =========================
  // Tell parent to push
  react.useEffect(function () {
    if (open) {
      var _parentContext$push;
      parentContext === null || parentContext === void 0 || (_parentContext$push = parentContext.push) === null || _parentContext$push === void 0 || _parentContext$push.call(parentContext);
    } else {
      var _parentContext$pull;
      parentContext === null || parentContext === void 0 || (_parentContext$pull = parentContext.pull) === null || _parentContext$pull === void 0 || _parentContext$pull.call(parentContext);
    }
  }, [open]);

  // Clean up
  react.useEffect(function () {
    return function () {
      var _parentContext$pull2;
      parentContext === null || parentContext === void 0 || (_parentContext$pull2 = parentContext.pull) === null || _parentContext$pull2 === void 0 || _parentContext$pull2.call(parentContext);
    };
  }, []);

  // ============================ Mask ============================
  var maskNode = mask && /*#__PURE__*/react.createElement(rc_motion_es/* default */.Ay, (0,esm_extends/* default */.A)({
    key: "mask"
  }, maskMotion, {
    visible: open
  }), function (_ref2, maskRef) {
    var motionMaskClassName = _ref2.className,
      motionMaskStyle = _ref2.style;
    return /*#__PURE__*/react.createElement("div", {
      className: classnames_default()("".concat(prefixCls, "-mask"), motionMaskClassName, drawerClassNames === null || drawerClassNames === void 0 ? void 0 : drawerClassNames.mask, maskClassName),
      style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, motionMaskStyle), maskStyle), styles === null || styles === void 0 ? void 0 : styles.mask),
      onClick: maskClosable && open ? onClose : undefined,
      ref: maskRef
    });
  });

  // =========================== Panel ============================
  var motionProps = typeof motion === 'function' ? motion(placement) : motion;
  var wrapperStyle = {};
  if (pushed && pushDistance) {
    switch (placement) {
      case 'top':
        wrapperStyle.transform = "translateY(".concat(pushDistance, "px)");
        break;
      case 'bottom':
        wrapperStyle.transform = "translateY(".concat(-pushDistance, "px)");
        break;
      case 'left':
        wrapperStyle.transform = "translateX(".concat(pushDistance, "px)");
        break;
      default:
        wrapperStyle.transform = "translateX(".concat(-pushDistance, "px)");
        break;
    }
  }
  if (placement === 'left' || placement === 'right') {
    wrapperStyle.width = parseWidthHeight(width);
  } else {
    wrapperStyle.height = parseWidthHeight(height);
  }
  var eventHandlers = {
    onMouseEnter: onMouseEnter,
    onMouseOver: onMouseOver,
    onMouseLeave: onMouseLeave,
    onClick: onClick,
    onKeyDown: onKeyDown,
    onKeyUp: onKeyUp
  };
  var panelNode = /*#__PURE__*/react.createElement(rc_motion_es/* default */.Ay, (0,esm_extends/* default */.A)({
    key: "panel"
  }, motionProps, {
    visible: open,
    forceRender: forceRender,
    onVisibleChanged: function onVisibleChanged(nextVisible) {
      afterOpenChange === null || afterOpenChange === void 0 || afterOpenChange(nextVisible);
    },
    removeOnLeave: false,
    leavedClassName: "".concat(prefixCls, "-content-wrapper-hidden")
  }), function (_ref3, motionRef) {
    var motionClassName = _ref3.className,
      motionStyle = _ref3.style;
    var content = /*#__PURE__*/react.createElement(es_DrawerPanel, (0,esm_extends/* default */.A)({
      id: id,
      containerRef: motionRef,
      prefixCls: prefixCls,
      className: classnames_default()(className, drawerClassNames === null || drawerClassNames === void 0 ? void 0 : drawerClassNames.content),
      style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, style), styles === null || styles === void 0 ? void 0 : styles.content)
    }, (0,pickAttrs/* default */.A)(props, {
      aria: true
    }), eventHandlers), children);
    return /*#__PURE__*/react.createElement("div", (0,esm_extends/* default */.A)({
      className: classnames_default()("".concat(prefixCls, "-content-wrapper"), drawerClassNames === null || drawerClassNames === void 0 ? void 0 : drawerClassNames.wrapper, motionClassName),
      style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, wrapperStyle), motionStyle), styles === null || styles === void 0 ? void 0 : styles.wrapper)
    }, (0,pickAttrs/* default */.A)(props, {
      data: true
    })), drawerRender ? drawerRender(content) : content);
  });

  // =========================== Render ===========================
  var containerStyle = (0,objectSpread2/* default */.A)({}, rootStyle);
  if (zIndex) {
    containerStyle.zIndex = zIndex;
  }
  return /*#__PURE__*/react.createElement(context.Provider, {
    value: mergedContext
  }, /*#__PURE__*/react.createElement("div", {
    className: classnames_default()(prefixCls, "".concat(prefixCls, "-").concat(placement), rootClassName, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-open"), open), "".concat(prefixCls, "-inline"), inline)),
    style: containerStyle,
    tabIndex: -1,
    ref: panelRef,
    onKeyDown: onPanelKeyDown
  }, maskNode, /*#__PURE__*/react.createElement("div", {
    tabIndex: 0,
    ref: sentinelStartRef,
    style: sentinelStyle,
    "aria-hidden": "true",
    "data-sentinel": "start"
  }), panelNode, /*#__PURE__*/react.createElement("div", {
    tabIndex: 0,
    ref: sentinelEndRef,
    style: sentinelStyle,
    "aria-hidden": "true",
    "data-sentinel": "end"
  })));
}
var RefDrawerPopup = /*#__PURE__*/react.forwardRef(DrawerPopup);
if (false) {}
/* harmony default export */ var es_DrawerPopup = (RefDrawerPopup);
;// ./node_modules/rc-drawer/es/Drawer.js








var Drawer = function Drawer(props) {
  var _props$open = props.open,
    open = _props$open === void 0 ? false : _props$open,
    _props$prefixCls = props.prefixCls,
    prefixCls = _props$prefixCls === void 0 ? 'rc-drawer' : _props$prefixCls,
    _props$placement = props.placement,
    placement = _props$placement === void 0 ? 'right' : _props$placement,
    _props$autoFocus = props.autoFocus,
    autoFocus = _props$autoFocus === void 0 ? true : _props$autoFocus,
    _props$keyboard = props.keyboard,
    keyboard = _props$keyboard === void 0 ? true : _props$keyboard,
    _props$width = props.width,
    width = _props$width === void 0 ? 378 : _props$width,
    _props$mask = props.mask,
    mask = _props$mask === void 0 ? true : _props$mask,
    _props$maskClosable = props.maskClosable,
    maskClosable = _props$maskClosable === void 0 ? true : _props$maskClosable,
    getContainer = props.getContainer,
    forceRender = props.forceRender,
    afterOpenChange = props.afterOpenChange,
    destroyOnClose = props.destroyOnClose,
    onMouseEnter = props.onMouseEnter,
    onMouseOver = props.onMouseOver,
    onMouseLeave = props.onMouseLeave,
    onClick = props.onClick,
    onKeyDown = props.onKeyDown,
    onKeyUp = props.onKeyUp,
    panelRef = props.panelRef;
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    animatedVisible = _React$useState2[0],
    setAnimatedVisible = _React$useState2[1];

  // ============================= Warn =============================
  if (false) {}

  // ============================= Open =============================
  var _React$useState3 = react.useState(false),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    mounted = _React$useState4[0],
    setMounted = _React$useState4[1];
  (0,useLayoutEffect/* default */.A)(function () {
    setMounted(true);
  }, []);
  var mergedOpen = mounted ? open : false;

  // ============================ Focus =============================
  var popupRef = react.useRef();
  var lastActiveRef = react.useRef();
  (0,useLayoutEffect/* default */.A)(function () {
    if (mergedOpen) {
      lastActiveRef.current = document.activeElement;
    }
  }, [mergedOpen]);

  // ============================= Open =============================
  var internalAfterOpenChange = function internalAfterOpenChange(nextVisible) {
    var _popupRef$current;
    setAnimatedVisible(nextVisible);
    afterOpenChange === null || afterOpenChange === void 0 || afterOpenChange(nextVisible);
    if (!nextVisible && lastActiveRef.current && !((_popupRef$current = popupRef.current) !== null && _popupRef$current !== void 0 && _popupRef$current.contains(lastActiveRef.current))) {
      var _lastActiveRef$curren;
      (_lastActiveRef$curren = lastActiveRef.current) === null || _lastActiveRef$curren === void 0 || _lastActiveRef$curren.focus({
        preventScroll: true
      });
    }
  };

  // =========================== Context ============================
  var refContext = react.useMemo(function () {
    return {
      panel: panelRef
    };
  }, [panelRef]);

  // ============================ Render ============================
  if (!forceRender && !animatedVisible && !mergedOpen && destroyOnClose) {
    return null;
  }
  var eventHandlers = {
    onMouseEnter: onMouseEnter,
    onMouseOver: onMouseOver,
    onMouseLeave: onMouseLeave,
    onClick: onClick,
    onKeyDown: onKeyDown,
    onKeyUp: onKeyUp
  };
  var drawerPopupProps = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, props), {}, {
    open: mergedOpen,
    prefixCls: prefixCls,
    placement: placement,
    autoFocus: autoFocus,
    keyboard: keyboard,
    width: width,
    mask: mask,
    maskClosable: maskClosable,
    inline: getContainer === false,
    afterOpenChange: internalAfterOpenChange,
    ref: popupRef
  }, eventHandlers);
  return /*#__PURE__*/react.createElement(RefContext.Provider, {
    value: refContext
  }, /*#__PURE__*/react.createElement(es/* default */.A, {
    open: mergedOpen || forceRender || animatedVisible,
    autoDestroy: false,
    getContainer: getContainer,
    autoLock: mask && (mergedOpen || animatedVisible)
  }, /*#__PURE__*/react.createElement(es_DrawerPopup, drawerPopupProps)));
};
if (false) {}
/* harmony default export */ var es_Drawer = (Drawer);
;// ./node_modules/rc-drawer/es/index.js
// export this package's api

/* harmony default export */ var rc_drawer_es = (es_Drawer);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/ContextIsolator.js
var ContextIsolator = __webpack_require__(62897);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/hooks/useZIndex.js
var useZIndex = __webpack_require__(60275);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/motion.js
var motion = __webpack_require__(23723);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/zindexContext.js
var zindexContext = __webpack_require__(72616);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var config_provider_context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/watermark/context.js
var watermark_context = __webpack_require__(28557);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/hooks/useClosable.js
var useClosable = __webpack_require__(70064);
// EXTERNAL MODULE: ./node_modules/antd/es/skeleton/index.js + 10 modules
var skeleton = __webpack_require__(97072);
;// ./node_modules/antd/es/drawer/DrawerPanel.js
"use client";






const DrawerPanel_DrawerPanel = props => {
  var _a, _b;
  const {
    prefixCls,
    title,
    footer,
    extra,
    loading,
    onClose,
    headerStyle,
    bodyStyle,
    footerStyle,
    children,
    classNames: drawerClassNames,
    styles: drawerStyles
  } = props;
  const {
    drawer: drawerContext
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const customCloseIconRender = react.useCallback(icon => (/*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "Close",
    className: `${prefixCls}-close`
  }, icon)), [onClose]);
  const [mergedClosable, mergedCloseIcon] = (0,useClosable/* default */.A)((0,useClosable/* pickClosable */.d)(props), (0,useClosable/* pickClosable */.d)(drawerContext), {
    closable: true,
    closeIconRender: customCloseIconRender
  });
  const headerNode = react.useMemo(() => {
    var _a, _b;
    if (!title && !mergedClosable) {
      return null;
    }
    return /*#__PURE__*/react.createElement("div", {
      style: Object.assign(Object.assign(Object.assign({}, (_a = drawerContext === null || drawerContext === void 0 ? void 0 : drawerContext.styles) === null || _a === void 0 ? void 0 : _a.header), headerStyle), drawerStyles === null || drawerStyles === void 0 ? void 0 : drawerStyles.header),
      className: classnames_default()(`${prefixCls}-header`, {
        [`${prefixCls}-header-close-only`]: mergedClosable && !title && !extra
      }, (_b = drawerContext === null || drawerContext === void 0 ? void 0 : drawerContext.classNames) === null || _b === void 0 ? void 0 : _b.header, drawerClassNames === null || drawerClassNames === void 0 ? void 0 : drawerClassNames.header)
    }, /*#__PURE__*/react.createElement("div", {
      className: `${prefixCls}-header-title`
    }, mergedCloseIcon, title && /*#__PURE__*/react.createElement("div", {
      className: `${prefixCls}-title`
    }, title)), extra && /*#__PURE__*/react.createElement("div", {
      className: `${prefixCls}-extra`
    }, extra));
  }, [mergedClosable, mergedCloseIcon, extra, headerStyle, prefixCls, title]);
  const footerNode = react.useMemo(() => {
    var _a, _b;
    if (!footer) {
      return null;
    }
    const footerClassName = `${prefixCls}-footer`;
    return /*#__PURE__*/react.createElement("div", {
      className: classnames_default()(footerClassName, (_a = drawerContext === null || drawerContext === void 0 ? void 0 : drawerContext.classNames) === null || _a === void 0 ? void 0 : _a.footer, drawerClassNames === null || drawerClassNames === void 0 ? void 0 : drawerClassNames.footer),
      style: Object.assign(Object.assign(Object.assign({}, (_b = drawerContext === null || drawerContext === void 0 ? void 0 : drawerContext.styles) === null || _b === void 0 ? void 0 : _b.footer), footerStyle), drawerStyles === null || drawerStyles === void 0 ? void 0 : drawerStyles.footer)
    }, footer);
  }, [footer, footerStyle, prefixCls]);
  return /*#__PURE__*/react.createElement(react.Fragment, null, headerNode, /*#__PURE__*/react.createElement("div", {
    className: classnames_default()(`${prefixCls}-body`, drawerClassNames === null || drawerClassNames === void 0 ? void 0 : drawerClassNames.body, (_a = drawerContext === null || drawerContext === void 0 ? void 0 : drawerContext.classNames) === null || _a === void 0 ? void 0 : _a.body),
    style: Object.assign(Object.assign(Object.assign({}, (_b = drawerContext === null || drawerContext === void 0 ? void 0 : drawerContext.styles) === null || _b === void 0 ? void 0 : _b.body), bodyStyle), drawerStyles === null || drawerStyles === void 0 ? void 0 : drawerStyles.body)
  }, loading ? (/*#__PURE__*/react.createElement(skeleton/* default */.A, {
    active: true,
    title: false,
    paragraph: {
      rows: 5
    },
    className: `${prefixCls}-body-skeleton`
  })) : children), footerNode);
};
/* harmony default export */ var drawer_DrawerPanel = (DrawerPanel_DrawerPanel);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
;// ./node_modules/antd/es/drawer/style/motion.js
const getMoveTranslate = direction => {
  const value = '100%';
  return {
    left: `translateX(-${value})`,
    right: `translateX(${value})`,
    top: `translateY(-${value})`,
    bottom: `translateY(${value})`
  }[direction];
};
const getEnterLeaveStyle = (startStyle, endStyle) => ({
  '&-enter, &-appear': Object.assign(Object.assign({}, startStyle), {
    '&-active': endStyle
  }),
  '&-leave': Object.assign(Object.assign({}, endStyle), {
    '&-active': startStyle
  })
});
const getFadeStyle = (from, duration) => Object.assign({
  '&-enter, &-appear, &-leave': {
    '&-start': {
      transition: 'none'
    },
    '&-active': {
      transition: `all ${duration}`
    }
  }
}, getEnterLeaveStyle({
  opacity: from
}, {
  opacity: 1
}));
const getPanelMotionStyles = (direction, duration) => [getFadeStyle(0.7, duration), getEnterLeaveStyle({
  transform: getMoveTranslate(direction)
}, {
  transform: 'none'
})];
const genMotionStyle = token => {
  const {
    componentCls,
    motionDurationSlow
  } = token;
  return {
    [componentCls]: {
      // ======================== Mask ========================
      [`${componentCls}-mask-motion`]: getFadeStyle(0, motionDurationSlow),
      // ======================= Panel ========================
      [`${componentCls}-panel-motion`]: ['left', 'right', 'top', 'bottom'].reduce((obj, direction) => Object.assign(Object.assign({}, obj), {
        [`&-${direction}`]: getPanelMotionStyles(direction, motionDurationSlow)
      }), {})
    }
  };
};
/* harmony default export */ var style_motion = (genMotionStyle);
;// ./node_modules/antd/es/drawer/style/index.js




// =============================== Base ===============================
const genDrawerStyle = token => {
  const {
    borderRadiusSM,
    componentCls,
    zIndexPopup,
    colorBgMask,
    colorBgElevated,
    motionDurationSlow,
    motionDurationMid,
    paddingXS,
    padding,
    paddingLG,
    fontSizeLG,
    lineHeightLG,
    lineWidth,
    lineType,
    colorSplit,
    marginXS,
    colorIcon,
    colorIconHover,
    colorBgTextHover,
    colorBgTextActive,
    colorText,
    fontWeightStrong,
    footerPaddingBlock,
    footerPaddingInline,
    calc
  } = token;
  const wrapperCls = `${componentCls}-content-wrapper`;
  return {
    [componentCls]: {
      position: 'fixed',
      inset: 0,
      zIndex: zIndexPopup,
      pointerEvents: 'none',
      color: colorText,
      '&-pure': {
        position: 'relative',
        background: colorBgElevated,
        display: 'flex',
        flexDirection: 'column',
        [`&${componentCls}-left`]: {
          boxShadow: token.boxShadowDrawerLeft
        },
        [`&${componentCls}-right`]: {
          boxShadow: token.boxShadowDrawerRight
        },
        [`&${componentCls}-top`]: {
          boxShadow: token.boxShadowDrawerUp
        },
        [`&${componentCls}-bottom`]: {
          boxShadow: token.boxShadowDrawerDown
        }
      },
      '&-inline': {
        position: 'absolute'
      },
      // ====================== Mask ======================
      [`${componentCls}-mask`]: {
        position: 'absolute',
        inset: 0,
        zIndex: zIndexPopup,
        background: colorBgMask,
        pointerEvents: 'auto'
      },
      // ==================== Content =====================
      [wrapperCls]: {
        position: 'absolute',
        zIndex: zIndexPopup,
        maxWidth: '100vw',
        transition: `all ${motionDurationSlow}`,
        '&-hidden': {
          display: 'none'
        }
      },
      // Placement
      [`&-left > ${wrapperCls}`]: {
        top: 0,
        bottom: 0,
        left: {
          _skip_check_: true,
          value: 0
        },
        boxShadow: token.boxShadowDrawerLeft
      },
      [`&-right > ${wrapperCls}`]: {
        top: 0,
        right: {
          _skip_check_: true,
          value: 0
        },
        bottom: 0,
        boxShadow: token.boxShadowDrawerRight
      },
      [`&-top > ${wrapperCls}`]: {
        top: 0,
        insetInline: 0,
        boxShadow: token.boxShadowDrawerUp
      },
      [`&-bottom > ${wrapperCls}`]: {
        bottom: 0,
        insetInline: 0,
        boxShadow: token.boxShadowDrawerDown
      },
      [`${componentCls}-content`]: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: colorBgElevated,
        pointerEvents: 'auto'
      },
      // Header
      [`${componentCls}-header`]: {
        display: 'flex',
        flex: 0,
        alignItems: 'center',
        padding: `${(0,cssinjs_es/* unit */.zA)(padding)} ${(0,cssinjs_es/* unit */.zA)(paddingLG)}`,
        fontSize: fontSizeLG,
        lineHeight: lineHeightLG,
        borderBottom: `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${colorSplit}`,
        '&-title': {
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          minWidth: 0,
          minHeight: 0
        }
      },
      [`${componentCls}-extra`]: {
        flex: 'none'
      },
      [`${componentCls}-close`]: Object.assign({
        display: 'inline-flex',
        width: calc(fontSizeLG).add(paddingXS).equal(),
        height: calc(fontSizeLG).add(paddingXS).equal(),
        borderRadius: borderRadiusSM,
        justifyContent: 'center',
        alignItems: 'center',
        marginInlineEnd: marginXS,
        color: colorIcon,
        fontWeight: fontWeightStrong,
        fontSize: fontSizeLG,
        fontStyle: 'normal',
        lineHeight: 1,
        textAlign: 'center',
        textTransform: 'none',
        textDecoration: 'none',
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        transition: `all ${motionDurationMid}`,
        textRendering: 'auto',
        '&:hover': {
          color: colorIconHover,
          backgroundColor: colorBgTextHover,
          textDecoration: 'none'
        },
        '&:active': {
          backgroundColor: colorBgTextActive
        }
      }, (0,style/* genFocusStyle */.K8)(token)),
      [`${componentCls}-title`]: {
        flex: 1,
        margin: 0,
        fontWeight: token.fontWeightStrong,
        fontSize: fontSizeLG,
        lineHeight: lineHeightLG
      },
      // Body
      [`${componentCls}-body`]: {
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        padding: paddingLG,
        overflow: 'auto',
        [`${componentCls}-body-skeleton`]: {
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center'
        }
      },
      // Footer
      [`${componentCls}-footer`]: {
        flexShrink: 0,
        padding: `${(0,cssinjs_es/* unit */.zA)(footerPaddingBlock)} ${(0,cssinjs_es/* unit */.zA)(footerPaddingInline)}`,
        borderTop: `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${colorSplit}`
      },
      // ====================== RTL =======================
      '&-rtl': {
        direction: 'rtl'
      }
    }
  };
};
const prepareComponentToken = token => ({
  zIndexPopup: token.zIndexPopupBase,
  footerPaddingBlock: token.paddingXS,
  footerPaddingInline: token.padding
});
// ============================== Export ==============================
/* harmony default export */ var drawer_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Drawer', token => {
  const drawerToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {});
  return [genDrawerStyle(drawerToken), style_motion(drawerToken)];
}, prepareComponentToken));
;// ./node_modules/antd/es/drawer/index.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};












const _SizeTypes = (/* unused pure expression or super */ null && (['default', 'large']));
const defaultPushState = {
  distance: 180
};
const drawer_Drawer = props => {
  var _a;
  const {
      rootClassName,
      width,
      height,
      size = 'default',
      mask = true,
      push = defaultPushState,
      open,
      afterOpenChange,
      onClose,
      prefixCls: customizePrefixCls,
      getContainer: customizeGetContainer,
      style,
      className,
      // Deprecated
      visible,
      afterVisibleChange,
      maskStyle,
      drawerStyle,
      contentWrapperStyle
    } = props,
    rest = __rest(props, ["rootClassName", "width", "height", "size", "mask", "push", "open", "afterOpenChange", "onClose", "prefixCls", "getContainer", "style", "className", "visible", "afterVisibleChange", "maskStyle", "drawerStyle", "contentWrapperStyle"]);
  const {
    getPopupContainer,
    getPrefixCls,
    direction,
    drawer
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('drawer', customizePrefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = drawer_style(prefixCls);
  const getContainer =
  // 有可能为 false，所以不能直接判断
  customizeGetContainer === undefined && getPopupContainer ? () => getPopupContainer(document.body) : customizeGetContainer;
  const drawerClassName = classnames_default()({
    'no-mask': !mask,
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, rootClassName, hashId, cssVarCls);
  // ========================== Warning ===========================
  if (false) {}
  // ============================ Size ============================
  const mergedWidth = react.useMemo(() => width !== null && width !== void 0 ? width : size === 'large' ? 736 : 378, [width, size]);
  const mergedHeight = react.useMemo(() => height !== null && height !== void 0 ? height : size === 'large' ? 736 : 378, [height, size]);
  // =========================== Motion ===========================
  const maskMotion = {
    motionName: (0,motion/* getTransitionName */.b)(prefixCls, 'mask-motion'),
    motionAppear: true,
    motionEnter: true,
    motionLeave: true,
    motionDeadline: 500
  };
  const panelMotion = motionPlacement => ({
    motionName: (0,motion/* getTransitionName */.b)(prefixCls, `panel-motion-${motionPlacement}`),
    motionAppear: true,
    motionEnter: true,
    motionLeave: true,
    motionDeadline: 500
  });
  // ============================ Refs ============================
  // Select `ant-modal-content` by `panelRef`
  const panelRef = (0,watermark_context/* usePanelRef */.f)();
  // ============================ zIndex ============================
  const [zIndex, contextZIndex] = (0,useZIndex/* useZIndex */.YK)('Drawer', rest.zIndex);
  // =========================== Render ===========================
  const {
    classNames: propClassNames = {},
    styles: propStyles = {}
  } = rest;
  const {
    classNames: contextClassNames = {},
    styles: contextStyles = {}
  } = drawer || {};
  return wrapCSSVar(/*#__PURE__*/react.createElement(ContextIsolator/* default */.A, {
    form: true,
    space: true
  }, /*#__PURE__*/react.createElement(zindexContext/* default */.A.Provider, {
    value: contextZIndex
  }, /*#__PURE__*/react.createElement(rc_drawer_es, Object.assign({
    prefixCls: prefixCls,
    onClose: onClose,
    maskMotion: maskMotion,
    motion: panelMotion
  }, rest, {
    classNames: {
      mask: classnames_default()(propClassNames.mask, contextClassNames.mask),
      content: classnames_default()(propClassNames.content, contextClassNames.content),
      wrapper: classnames_default()(propClassNames.wrapper, contextClassNames.wrapper)
    },
    styles: {
      mask: Object.assign(Object.assign(Object.assign({}, propStyles.mask), maskStyle), contextStyles.mask),
      content: Object.assign(Object.assign(Object.assign({}, propStyles.content), drawerStyle), contextStyles.content),
      wrapper: Object.assign(Object.assign(Object.assign({}, propStyles.wrapper), contentWrapperStyle), contextStyles.wrapper)
    },
    open: open !== null && open !== void 0 ? open : visible,
    mask: mask,
    push: push,
    width: mergedWidth,
    height: mergedHeight,
    style: Object.assign(Object.assign({}, drawer === null || drawer === void 0 ? void 0 : drawer.style), style),
    className: classnames_default()(drawer === null || drawer === void 0 ? void 0 : drawer.className, className),
    rootClassName: drawerClassName,
    getContainer: getContainer,
    afterOpenChange: afterOpenChange !== null && afterOpenChange !== void 0 ? afterOpenChange : afterVisibleChange,
    panelRef: panelRef,
    zIndex: zIndex
  }), /*#__PURE__*/react.createElement(drawer_DrawerPanel, Object.assign({
    prefixCls: prefixCls
  }, rest, {
    onClose: onClose
  }))))));
};
/** @private Internal Component. Do not use in your production. */
const PurePanel = props => {
  const {
      prefixCls: customizePrefixCls,
      style,
      className,
      placement = 'right'
    } = props,
    restProps = __rest(props, ["prefixCls", "style", "className", "placement"]);
  const {
    getPrefixCls
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('drawer', customizePrefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = drawer_style(prefixCls);
  const cls = classnames_default()(prefixCls, `${prefixCls}-pure`, `${prefixCls}-${placement}`, hashId, cssVarCls, className);
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", {
    className: cls,
    style: style
  }, /*#__PURE__*/react.createElement(drawer_DrawerPanel, Object.assign({
    prefixCls: prefixCls
  }, restProps))));
};
drawer_Drawer._InternalPanelDoNotUseOrYouWillBeFired = PurePanel;
if (false) {}
/* harmony default export */ var drawer = (drawer_Drawer);
// EXTERNAL MODULE: ./node_modules/antd/es/spin/index.js + 6 modules
var spin = __webpack_require__(34716);
// EXTERNAL MODULE: ./node_modules/antd/es/modal/index.js + 28 modules
var modal = __webpack_require__(56426);
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
// EXTERNAL MODULE: ./node_modules/antd/es/input/index.js + 13 modules
var input = __webpack_require__(79365);
// EXTERNAL MODULE: ./node_modules/antd/es/select/index.js + 40 modules
var es_select = __webpack_require__(85319);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/package.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Package = (0,createLucideIcon/* default */.A)("Package", [
  [
    "path",
    {
      d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z",
      key: "1a0edw"
    }
  ],
  ["path", { d: "M12 22V12", key: "d0xqtd" }],
  ["path", { d: "m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7", key: "yx3hmr" }],
  ["path", { d: "m7.5 4.27 9 5.15", key: "1c824w" }]
]);


//# sourceMappingURL=package.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/wrench.js
var wrench = __webpack_require__(46816);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/code.js
var code = __webpack_require__(93164);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/sparkles.js
var sparkles = __webpack_require__(46110);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/bot.js
var bot = __webpack_require__(42640);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/search.js
var icons_search = __webpack_require__(98445);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/upload.js
var upload = __webpack_require__(94796);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/eye.js
var eye = __webpack_require__(3160);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/download.js
var download = __webpack_require__(48309);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/check.js
var check = __webpack_require__(45773);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/copy.js
var copy = __webpack_require__(35404);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/send.js
var send = __webpack_require__(27775);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/folder-open.js
var folder_open = __webpack_require__(43242);
// EXTERNAL MODULE: ./src/components/common/Button.tsx
var Button = __webpack_require__(2915);
// EXTERNAL MODULE: ./src/components/common/markdownrender.tsx + 213 modules
var markdownrender = __webpack_require__(57256);
// EXTERNAL MODULE: ./src/components/store.tsx
var store = __webpack_require__(32134);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./node_modules/jszip/dist/jszip.min.js
var jszip_min = __webpack_require__(71710);
var jszip_min_default = /*#__PURE__*/__webpack_require__.n(jszip_min);
;// ./src/pages/SkillsSquarePage.tsx









const ENABLE_SKILL_DOWNLOAD = false;
const ENABLE_HEPAI_SKILL_ZIP_UPLOAD = true;
const LIST_ROW_ACTION_BTN = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-secondary transition-[background-color,border-color,color,opacity] duration-200 hover:border-border-primary/60 hover:bg-tertiary/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 dark:hover:border-white/10 dark:hover:bg-white/[0.06]";
const SEARCH_INPUT_CLS = "w-full rounded-xl border border-primary/40 bg-tertiary/10 py-2 pl-9 pr-3 text-sm text-primary outline-none placeholder:text-secondary/60 transition-[border-color,box-shadow] duration-200 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 dark:border-white/10 dark:bg-white/[0.04]";
const HEPAI_MAX_ZIP_BYTES = 10 * 1024 * 1024;
/** 与提示文案一致：文件夹打包内文件数上限 */
const MAX_SKILL_FOLDER_FILES = 200;
async function zipFolderFileListToZipFile(files) {
  var _firstRel$split$;
  const zip = new (jszip_min_default())();
  const n = files.length;
  if (n === 0) throw new Error("未选择任何文件");
  if (n > MAX_SKILL_FOLDER_FILES) {
    throw new Error("\u6587\u4EF6\u5939\u5185\u6587\u4EF6\u8BF7\u4E0D\u8D85\u8FC7 " + MAX_SKILL_FOLDER_FILES + " \u4E2A");
  }
  let hasSkillMd = false;
  for (let i = 0; i < n; i++) {
    const f = files[i];
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    if (/(^|\/)SKILL\.MD$/i.test(rel)) {
      hasSkillMd = true;
    }
    zip.file(rel, await f.arrayBuffer());
  }
  if (!hasSkillMd) {
    throw new Error("文件夹内需包含 SKILL.md");
  }
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE"
  });
  if (blob.size > HEPAI_MAX_ZIP_BYTES) {
    throw new Error("打包后超过 10 MB，请精简文件后重试");
  }
  const first = files[0];
  const firstRel = (first.webkitRelativePath || first.name).replace(/\\/g, "/");
  const rootFolder = firstRel.includes("/") ? (_firstRel$split$ = firstRel.split("/")[0]) !== null && _firstRel$split$ !== void 0 ? _firstRel$split$ : "skill" : "skill";
  const safeStem = rootFolder.replace(/[^\w\u4e00-\u9fff.-]/g, "-").slice(0, 80) || "skill";
  return new File([blob], safeStem + ".zip", {
    type: "application/zip"
  });
}
const SKILL_ICON_OPTIONS = [{
  value: "package",
  label: "包裹",
  Icon: Package
}, {
  value: "wrench",
  label: "扳手",
  Icon: wrench/* default */.A
}, {
  value: "code",
  label: "代码",
  Icon: code/* default */.A
}, {
  value: "sparkles",
  label: "创意",
  Icon: sparkles/* default */.A
}, {
  value: "bot",
  label: "智能体",
  Icon: bot/* default */.A
}, {
  value: "file-text",
  label: "文档",
  Icon: file_text/* default */.A
}];
function rowPrimaryTitle(row) {
  var _row$metadata;
  const raw = (_row$metadata = row.metadata) === null || _row$metadata === void 0 ? void 0 : _row$metadata.display_name;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return splitArchiveName(row.filename).stem;
}
function rowListIconComponent(row) {
  var _row$metadata2, _hit$Icon;
  const key = typeof ((_row$metadata2 = row.metadata) === null || _row$metadata2 === void 0 ? void 0 : _row$metadata2.icon) === "string" ? row.metadata.icon.trim() : "";
  const hit = SKILL_ICON_OPTIONS.find(o => o.value === key);
  return (_hit$Icon = hit === null || hit === void 0 ? void 0 : hit.Icon) !== null && _hit$Icon !== void 0 ? _hit$Icon : Package;
}

/** SKILL.md YAML frontmatter `description:` (aligned with backend parsing). */
function parseSkillMdDescription(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) return undefined;
  const fm = m[1];
  for (const line of fm.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (key !== "description") continue;
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    return value || undefined;
  }
  return undefined;
}
function metadataDescription(row) {
  var _row$metadata3;
  const raw = (_row$metadata3 = row.metadata) === null || _row$metadata3 === void 0 ? void 0 : _row$metadata3.description;
  return typeof raw === "string" ? raw.trim() : "";
}
function displayDescription(row, skillMdParsed) {
  var _row$description;
  const fromMeta = metadataDescription(row);
  if (fromMeta) return fromMeta;
  const persisted = ((_row$description = row.description) !== null && _row$description !== void 0 ? _row$description : "").trim();
  if (persisted) return persisted;
  return (skillMdParsed !== null && skillMdParsed !== void 0 ? skillMdParsed : "").trim();
}

/** 主名 + 扩展名拆分，便于用字重/颜色区分。 */
function splitArchiveName(filename) {
  if (filename.toLowerCase().endsWith(".zip")) {
    return {
      stem: filename.slice(0, -4),
      ext: ".zip"
    };
  }
  return {
    stem: filename,
    ext: ""
  };
}

/** 相对上传时间，超过约一周回落到日期。 */
function formatRelativePast(ms) {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 15) return "刚刚";
  if (sec < 60) return sec + " \u79D2\u524D";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + " \u5206\u949F\u524D";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + " \u5C0F\u65F6\u524D";
  const day = Math.floor(hr / 24);
  if (day < 7) return day + " \u5929\u524D";
  return new Date(ms).toLocaleDateString();
}
function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return n + " B";
  const kb = n / 1024;
  if (kb < 1024) return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + " KB";
  const mb = kb / 1024;
  return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + " MB";
}
const SkillsSquarePage = () => {
  const {
    user
  } = react.useContext(provider/* appContext */.v);
  const {
    0: search,
    1: setSearch
  } = (0,react.useState)("");
  const {
    0: drawerOpen,
    1: setDrawerOpen
  } = (0,react.useState)(false);
  const {
    0: active,
    1: setActive
  } = (0,react.useState)(null);
  const {
    0: detailBody,
    1: setDetailBody
  } = (0,react.useState)(null);
  const {
    0: detailLoading,
    1: setDetailLoading
  } = (0,react.useState)(false);
  const {
    0: downloadSlug,
    1: setDownloadSlug
  } = (0,react.useState)(null);
  const hepaiZipInputRef = (0,react.useRef)(null);
  const hepaiFolderInputRef = (0,react.useRef)(null);
  /** 必须在挂载时设置 webkitdirectory；勿对 input 使用 pointer-events-none，否则会阻断程序化 .click() 打开选文件夹对话框 */
  const setFolderInputRef = (0,react.useCallback)(el => {
    hepaiFolderInputRef.current = el;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
      try {
        el.setAttribute("mozdirectory", "");
      } catch (_unused) {
        /* ignore */
      }
      el.multiple = true;
    }
  }, []);
  const {
    0: hepaiUploadOpen,
    1: setHepaiUploadOpen
  } = (0,react.useState)(false);
  const {
    0: hepaiUploading,
    1: setHepaiUploading
  } = (0,react.useState)(false);
  const {
    0: hepaiPackingFolder,
    1: setHepaiPackingFolder
  } = (0,react.useState)(false);
  const {
    0: hepaiZipFile,
    1: setHepaiZipFile
  } = (0,react.useState)(null);
  const {
    0: publishSlug,
    1: setPublishSlug
  } = (0,react.useState)("");
  const {
    0: publishDisplayName,
    1: setPublishDisplayName
  } = (0,react.useState)("");
  const {
    0: publishIcon,
    1: setPublishIcon
  } = (0,react.useState)("");
  const {
    0: publishDescription,
    1: setPublishDescription
  } = (0,react.useState)("");
  const {
    0: publishVersion,
    1: setPublishVersion
  } = (0,react.useState)("1.0.0");
  const {
    0: publishChangelog,
    1: setPublishChangelog
  } = (0,react.useState)("");
  const {
    0: hepaiRows,
    1: setHepaiRows
  } = (0,react.useState)([]);
  const {
    0: skillMdOpen,
    1: setSkillMdOpen
  } = (0,react.useState)(false);
  const {
    0: skillMdLoading,
    1: setSkillMdLoading
  } = (0,react.useState)(false);
  const {
    0: skillMdTitle,
    1: setSkillMdTitle
  } = (0,react.useState)("");
  const {
    0: skillMdBody,
    1: setSkillMdBody
  } = (0,react.useState)("");
  const {
    0: skillMdDescById,
    1: setSkillMdDescById
  } = (0,react.useState)({});
  const skillDescFetchedRef = (0,react.useRef)(new Set());
  const copyFeedbackTimerRef = (0,react.useRef)(null);
  const {
    0: copiedRowId,
    1: setCopiedRowId
  } = (0,react.useState)(null);
  const {
    config: _config
  } = (0,store/* useSettingsStore */.C)();
  const hepaiPickPreview = (0,react.useMemo)(() => hepaiZipFile ? {
    name: hepaiZipFile.name,
    size: hepaiZipFile.size
  } : null, [hepaiZipFile]);
  const filteredHepaiRows = (0,react.useMemo)(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hepaiRows;
    return hepaiRows.filter(r => {
      var _r$uploadedBy;
      const desc = displayDescription(r, skillMdDescById[r.id]).toLowerCase();
      const by = ((_r$uploadedBy = r.uploadedBy) !== null && _r$uploadedBy !== void 0 ? _r$uploadedBy : "").toLowerCase();
      const title = rowPrimaryTitle(r).toLowerCase();
      return r.filename.toLowerCase().includes(q) || title.includes(q) || desc.includes(q) || by.length > 0 && by.includes(q);
    });
  }, [hepaiRows, search, skillMdDescById]);
  const resetPublishForm = () => {
    setHepaiZipFile(null);
    setPublishSlug("");
    setPublishDisplayName("");
    setPublishIcon("");
    setPublishDescription("");
    setPublishVersion("1.0.0");
    setPublishChangelog("");
    if (hepaiZipInputRef.current) {
      hepaiZipInputRef.current.value = "";
    }
    if (hepaiFolderInputRef.current) {
      hepaiFolderInputRef.current.value = "";
    }
  };
  const syncPickFromFile = f => {
    if (f && f.size > HEPAI_MAX_ZIP_BYTES) {
      message/* default */.Ay.warning("压缩包总大小请不超过 10 MB");
      return;
    }
    setHepaiZipFile(f);
    if (f !== null && f !== void 0 && f.name) {
      const stem = splitArchiveName(f.name).stem;
      setPublishDisplayName(prev => prev.trim() ? prev : stem);
    }
  };
  const handleFolderInputChange = async e => {
    const list = e.target.files;
    if (!(list !== null && list !== void 0 && list.length)) return;
    const first = list[0];
    if (!first.webkitRelativePath) {
      message/* default */.Ay.error("未能按文件夹读取文件，请使用 Chrome / Edge 等浏览器，或直接「选择 zip 文件」");
      e.target.value = "";
      return;
    }
    setHepaiPackingFolder(true);
    try {
      const zipFile = await zipFolderFileListToZipFile(list);
      syncPickFromFile(zipFile);
      message/* default */.Ay.success("已将文件夹打包为 zip");
    } catch (err) {
      message/* default */.Ay.error(err instanceof Error ? err.message : String(err));
    } finally {
      setHepaiPackingFolder(false);
      e.target.value = "";
    }
  };
  (0,react.useEffect)(() => {
    const userId = (user === null || user === void 0 ? void 0 : user.email) || "";
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await api/* fileAPI */.jp.listHepaiFiles(userId);
        if (cancelled) return;
        setHepaiRows(rows.map(r => ({
          id: r.id,
          filename: r.filename,
          previewUrl: r.url,
          createdAtMs: r.createdAtMs,
          description: r.description,
          uploadedBy: r.uploadedBy,
          metadata: r.metadata
        })));
      } catch (_unused2) {
        // keep UI quiet; list is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user === null || user === void 0 ? void 0 : user.email]);
  (0,react.useEffect)(() => {
    const userId = (user === null || user === void 0 ? void 0 : user.email) || "";
    if (!userId || hepaiRows.length === 0) return;
    for (const r of hepaiRows) {
      var _r$description;
      if (metadataDescription(r) || ((_r$description = r.description) !== null && _r$description !== void 0 ? _r$description : "").trim()) continue;
      if (skillDescFetchedRef.current.has(r.id)) continue;
      skillDescFetchedRef.current.add(r.id);
      void api/* fileAPI */.jp.getHepaiZipSkillMd(userId, r.id).then(_ref => {
        var _parseSkillMdDescript;
        let {
          content
        } = _ref;
        const d = (_parseSkillMdDescript = parseSkillMdDescription(content)) === null || _parseSkillMdDescript === void 0 ? void 0 : _parseSkillMdDescript.trim();
        if (d) setSkillMdDescById(prev => Object.assign({}, prev, {
          [r.id]: d
        }));
      }).catch(() => {});
    }
  }, [user === null || user === void 0 ? void 0 : user.email, hepaiRows]);
  (0,react.useEffect)(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
        copyFeedbackTimerRef.current = null;
      }
    };
  }, []);
  const copyPreviewUrl = async (rowId, text) => {
    try {
      await navigator.clipboard.writeText(text);
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
      setCopiedRowId(rowId);
      copyFeedbackTimerRef.current = setTimeout(() => {
        setCopiedRowId(null);
        copyFeedbackTimerRef.current = null;
      }, 1600);
    } catch (_unused3) {
      message/* default */.Ay.error("复制失败");
    }
  };
  const copySkillMdFullText = async () => {
    if (!skillMdBody) return;
    try {
      await navigator.clipboard.writeText(skillMdBody);
      message/* default */.Ay.success("已复制全文");
    } catch (_unused4) {
      message/* default */.Ay.error("复制失败");
    }
  };
  const handleDownload = async slug => {
    setDownloadSlug(slug);
    try {
      await api/* skillsAPI */.xm.downloadCatalogArchive(slug);
      message/* default */.Ay.success("已开始下载");
    } catch (e) {
      message/* default */.Ay.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadSlug(null);
    }
  };
  const submitHepaiUpload = async () => {
    const file = hepaiZipFile;
    if (!file) {
      message/* default */.Ay.warning("请选择技能包 .zip 文件");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      message/* default */.Ay.warning("请上传 .zip 格式的技能包");
      return;
    }
    if (file.size > HEPAI_MAX_ZIP_BYTES) {
      message/* default */.Ay.warning("压缩包总大小请不超过 10 MB");
      return;
    }
    const dn = publishDisplayName.trim();
    if (!dn) {
      message/* default */.Ay.warning("请填写显示名称");
      return;
    }
    const slugTrim = publishSlug.trim();
    if (slugTrim && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugTrim.toLowerCase())) {
      message/* default */.Ay.warning("Slug 仅允许小写字母、数字和连字符；不需要可留空");
      return;
    }
    const userId = (user === null || user === void 0 ? void 0 : user.email) || "";
    if (!userId) {
      message/* default */.Ay.error("未登录或缺少 user_id（email）");
      return;
    }
    setHepaiUploading(true);
    try {
      await api/* fileAPI */.jp.uploadToHepAI(userId, file, {
        slug: slugTrim || undefined,
        display_name: dn,
        icon: publishIcon.trim() || undefined,
        description: publishDescription.trim() || undefined,
        version: publishVersion.trim() || "1.0.0",
        changelog: publishChangelog.trim() || undefined
      });
      const rows = await api/* fileAPI */.jp.listHepaiFiles(userId);
      setHepaiRows(rows.map(r => ({
        id: r.id,
        filename: r.filename,
        previewUrl: r.url,
        createdAtMs: r.createdAtMs,
        description: r.description,
        uploadedBy: r.uploadedBy,
        metadata: r.metadata
      })));
      message/* default */.Ay.success("发布成功");
      setHepaiUploadOpen(false);
      resetPublishForm();
    } catch (e) {
      message/* default */.Ay.error(e instanceof Error ? e.message : String(e));
    } finally {
      setHepaiUploading(false);
    }
  };
  const openSkillMdPreview = async (fileId, filename) => {
    const userId = (user === null || user === void 0 ? void 0 : user.email) || "";
    if (!userId) {
      message/* default */.Ay.error("未登录或缺少 user_id（email）");
      return;
    }
    setSkillMdTitle(filename);
    setSkillMdBody("");
    setSkillMdOpen(true);
    setSkillMdLoading(true);
    try {
      const {
        content
      } = await api/* fileAPI */.jp.getHepaiZipSkillMd(userId, fileId);
      setSkillMdBody(content);
    } catch (e) {
      message/* default */.Ay.error(e instanceof Error ? e.message : String(e));
      setSkillMdOpen(false);
    } finally {
      setSkillMdLoading(false);
    }
  };
  const openPublishModal = () => {
    resetPublishForm();
    setHepaiUploadOpen(true);
  };
  const listSummary = hepaiRows.length === 0 ? null : search.trim() ? "\u5171 " + hepaiRows.length + " \u4E2A\u6280\u80FD \xB7 \u5339\u914D " + filteredHepaiRows.length + " \u4E2A" : "\u5171 " + hepaiRows.length + " \u4E2A\u6280\u80FD";
  return /*#__PURE__*/react.createElement("div", {
    className: "relative flex h-full min-h-0 flex-col bg-primary"
  }, /*#__PURE__*/react.createElement("div", {
    className: "pointer-events-none absolute inset-x-0 top-0 h-48 overflow-hidden",
    "aria-hidden": true
  }, /*#__PURE__*/react.createElement("div", {
    className: "absolute left-1/2 top-0 h-40 w-[min(560px,90vw)] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-3xl dark:bg-accent/[0.11]"
  })), /*#__PURE__*/react.createElement("div", {
    className: "relative z-10 flex min-h-0 flex-1 flex-col p-4 sm:p-5"
  }, /*#__PURE__*/react.createElement("header", {
    className: "shrink-0"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
  }, /*#__PURE__*/react.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/react.createElement("p", {
    className: "font-agent-mono text-[10px] font-medium uppercase tracking-[0.2em] text-accent"
  }, "SkillHub"), /*#__PURE__*/react.createElement("div", {
    className: "mt-1.5 flex items-center gap-2.5"
  }, /*#__PURE__*/react.createElement("span", {
    className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-primary/50 bg-tertiary/30 text-accent dark:border-white/10 dark:bg-white/[0.05]"
  }, /*#__PURE__*/react.createElement(wrench/* default */.A, {
    className: "h-[18px] w-[18px]",
    "aria-hidden": true
  })), /*#__PURE__*/react.createElement("h1", {
    className: "font-agent text-xl font-semibold tracking-[-0.02em] text-primary sm:text-[1.35rem]"
  }, "\u6280\u80FD\u5E7F\u573A")), /*#__PURE__*/react.createElement("p", {
    className: "mt-2 max-w-md text-sm leading-relaxed text-secondary"
  }, "\u6D4F\u89C8\u3001\u9884\u89C8\u4E0E\u5206\u4EAB Agent \u6280\u80FD\u5305"), listSummary ? /*#__PURE__*/react.createElement("p", {
    className: "mt-1 text-xs text-secondary/80"
  }, listSummary) : null), /*#__PURE__*/react.createElement("div", {
    className: "flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px] sm:flex-row sm:items-center sm:justify-end"
  }, /*#__PURE__*/react.createElement("div", {
    className: "relative flex-1 sm:max-w-xs"
  }, /*#__PURE__*/react.createElement(icons_search/* default */.A, {
    className: "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("input", {
    type: "search",
    value: search,
    onChange: e => setSearch(e.target.value),
    placeholder: "\u641C\u7D22\u540D\u79F0\u6216\u63CF\u8FF0",
    className: SEARCH_INPUT_CLS
  })), ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? /*#__PURE__*/react.createElement(Button/* Button */.$, {
    variant: "primary",
    size: "sm",
    icon: /*#__PURE__*/react.createElement(upload/* default */.A, {
      className: "h-4 w-4",
      "aria-hidden": true
    }),
    className: "shrink-0",
    onClick: openPublishModal
  }, "\u53D1\u5E03 Skill") : null))), /*#__PURE__*/react.createElement("div", {
    className: "min-h-0 flex-1 overflow-auto pt-5"
  }, /*#__PURE__*/react.createElement("div", {
    className: "mx-auto max-w-5xl"
  }, hepaiRows.length === 0 ? /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary/70 bg-tertiary/15 px-6 py-20 text-center dark:border-white/12 dark:bg-white/[0.02]"
  }, /*#__PURE__*/react.createElement("div", {
    className: "mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border-primary/50 bg-primary shadow-sm dark:border-white/10"
  }, /*#__PURE__*/react.createElement(Package, {
    className: "h-8 w-8 text-accent",
    strokeWidth: 1.75,
    "aria-hidden": true
  })), /*#__PURE__*/react.createElement("p", {
    className: "text-base font-medium text-primary"
  }, "\u8FD8\u6CA1\u6709\u6280\u80FD\u5305"), /*#__PURE__*/react.createElement("p", {
    className: "mt-2 max-w-xs text-sm leading-relaxed text-secondary"
  }, "\u4E0A\u4F20\u5305\u542B SKILL.md \u7684 zip \u5305\uFF0C\u5BA1\u6838\u901A\u8FC7\u540E\u4F1A\u5C55\u793A\u5728\u8FD9\u91CC"), ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? /*#__PURE__*/react.createElement(Button/* Button */.$, {
    variant: "primary",
    size: "sm",
    icon: /*#__PURE__*/react.createElement(upload/* default */.A, {
      className: "h-4 w-4",
      "aria-hidden": true
    }),
    className: "mt-6",
    onClick: openPublishModal
  }, "\u53D1\u5E03\u7B2C\u4E00\u4E2A Skill") : null) : filteredHepaiRows.length === 0 ? /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col items-center justify-center rounded-2xl border border-border-primary/60 bg-tertiary/10 px-6 py-16 text-center dark:border-white/10 dark:bg-white/[0.02]"
  }, /*#__PURE__*/react.createElement("div", {
    className: "mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-tertiary/40 dark:bg-white/[0.06]"
  }, /*#__PURE__*/react.createElement(icons_search/* default */.A, {
    className: "h-5 w-5 text-secondary",
    "aria-hidden": true
  })), /*#__PURE__*/react.createElement("p", {
    className: "text-sm font-medium text-primary"
  }, "\u6CA1\u6709\u5339\u914D\u7684\u6280\u80FD"), /*#__PURE__*/react.createElement("p", {
    className: "mt-1.5 text-xs text-secondary"
  }, "\u8BD5\u8BD5\u5176\u4ED6\u5173\u952E\u8BCD\uFF0C\u6216\u6E05\u7A7A\u641C\u7D22"), /*#__PURE__*/react.createElement("button", {
    type: "button",
    className: "mt-4 text-xs font-medium text-accent transition-colors hover:text-accent/80",
    onClick: () => setSearch("")
  }, "\u6E05\u7A7A\u641C\u7D22")) : /*#__PURE__*/react.createElement("ul", {
    className: "flex flex-col gap-2"
  }, filteredHepaiRows.map(r => {
    var _r$uploadedBy2, _user$email;
    const desc = displayDescription(r, skillMdDescById[r.id]);
    const RowIcon = rowListIconComponent(r);
    const primaryTitle = rowPrimaryTitle(r);
    const {
      ext
    } = splitArchiveName(r.filename);
    const absTime = new Date(r.createdAtMs).toLocaleString();
    const uploader = ((_r$uploadedBy2 = r.uploadedBy) === null || _r$uploadedBy2 === void 0 ? void 0 : _r$uploadedBy2.trim()) || (user === null || user === void 0 ? void 0 : (_user$email = user.email) === null || _user$email === void 0 ? void 0 : _user$email.trim()) || "";
    const copied = copiedRowId === r.id;
    return /*#__PURE__*/react.createElement("li", {
      key: r.id,
      className: "group rounded-xl border border-border-primary/55 bg-primary transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-accent/30 hover:shadow-[0_8px_24px_rgba(52,61,88,0.06)] dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:border-accent/25 dark:hover:shadow-[0_10px_28px_rgba(0,0,0,0.22)]"
    }, /*#__PURE__*/react.createElement("div", {
      className: "flex items-start gap-3 px-4 py-3.5 sm:items-center sm:gap-4 sm:py-4"
    }, /*#__PURE__*/react.createElement("div", {
      className: "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-accent/15 bg-accent/[0.08] text-accent dark:border-accent/20 dark:bg-accent/[0.12]"
    }, /*#__PURE__*/react.createElement(RowIcon, {
      className: "h-[22px] w-[22px]",
      strokeWidth: 2,
      "aria-hidden": true
    })), /*#__PURE__*/react.createElement("div", {
      className: "min-w-0 flex-1"
    }, /*#__PURE__*/react.createElement("div", {
      className: "flex flex-wrap items-center gap-x-2 gap-y-1"
    }, /*#__PURE__*/react.createElement("div", {
      className: "truncate text-[15px] font-medium leading-snug text-primary",
      title: "" + primaryTitle + ext
    }, /*#__PURE__*/react.createElement("span", null, primaryTitle), ext ? /*#__PURE__*/react.createElement("span", {
      className: "font-agent-mono text-xs font-normal text-secondary/70"
    }, ext) : null), ext ? /*#__PURE__*/react.createElement("span", {
      className: "inline-flex shrink-0 items-center rounded-full border border-border-primary/60 bg-tertiary/25 px-2 py-0.5 font-agent-mono text-[10px] font-medium uppercase tracking-wide text-secondary dark:border-white/10 dark:bg-white/[0.05]"
    }, "zip") : null), desc ? /*#__PURE__*/react.createElement("p", {
      className: "mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-secondary"
    }, desc) : null, /*#__PURE__*/react.createElement("p", {
      className: "mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-secondary"
    }, uploader ? /*#__PURE__*/react.createElement("span", {
      className: "max-w-[12rem] truncate rounded-md bg-tertiary/30 px-1.5 py-0.5 dark:bg-white/[0.05]",
      title: uploader
    }, uploader) : null, /*#__PURE__*/react.createElement("span", {
      className: "tabular-nums text-secondary/85",
      title: absTime
    }, formatRelativePast(r.createdAtMs)))), /*#__PURE__*/react.createElement("div", {
      className: "flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-70 sm:transition-opacity sm:duration-200 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
    }, /*#__PURE__*/react.createElement("button", {
      type: "button",
      className: LIST_ROW_ACTION_BTN,
      onClick: () => void openSkillMdPreview(r.id, r.filename),
      title: "\u9884\u89C8 SKILL.md",
      "aria-label": "\u9884\u89C8 SKILL.md"
    }, /*#__PURE__*/react.createElement(eye/* default */.A, {
      className: "h-4 w-4",
      "aria-hidden": true
    })), /*#__PURE__*/react.createElement("a", {
      href: r.previewUrl,
      target: "_blank",
      rel: "noreferrer",
      className: LIST_ROW_ACTION_BTN,
      title: "\u4E0B\u8F7D",
      "aria-label": "\u4E0B\u8F7D"
    }, /*#__PURE__*/react.createElement(download/* default */.A, {
      className: "h-4 w-4",
      "aria-hidden": true
    })), /*#__PURE__*/react.createElement("button", {
      type: "button",
      className: [LIST_ROW_ACTION_BTN, copied ? "border-accent/35 bg-accent/10 text-accent" : ""].join(" "),
      onClick: () => void copyPreviewUrl(r.id, r.previewUrl),
      title: copied ? "已复制" : "复制链接",
      "aria-label": copied ? "已复制" : "复制链接"
    }, copied ? /*#__PURE__*/react.createElement(check/* default */.A, {
      className: "h-4 w-4",
      strokeWidth: 2.5,
      "aria-hidden": true
    }) : /*#__PURE__*/react.createElement(copy/* default */.A, {
      className: "h-4 w-4",
      "aria-hidden": true
    })))));
  }))))), /*#__PURE__*/react.createElement(drawer, {
    title: active ? /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("div", {
      className: "text-base font-semibold"
    }, active.name), /*#__PURE__*/react.createElement("div", {
      className: "text-xs font-normal text-secondary mt-1"
    }, /*#__PURE__*/react.createElement("code", null, active.slug))) : "技能详情",
    placement: "right",
    width: 520,
    open: drawerOpen,
    onClose: () => {
      setDrawerOpen(false);
      setActive(null);
      setDetailBody(null);
    },
    destroyOnClose: true
  }, active && /*#__PURE__*/react.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-center justify-between gap-2"
  }, /*#__PURE__*/react.createElement("p", {
    className: "text-sm text-secondary flex-1"
  }, active.description), ENABLE_SKILL_DOWNLOAD ? /*#__PURE__*/react.createElement(Button/* Button */.$, {
    variant: "secondary",
    className: "shrink-0 h-8 border-1!",
    onClick: () => void handleDownload(active.slug),
    disabled: downloadSlug === active.slug,
    isLoading: downloadSlug === active.slug
  }, /*#__PURE__*/react.createElement(download/* default */.A, {
    className: "w-4 h-4 mr-1 inline"
  }), "\u4E0B\u8F7D ZIP") : null), detailLoading ? /*#__PURE__*/react.createElement("div", {
    className: "flex justify-center py-12"
  }, /*#__PURE__*/react.createElement(spin/* default */.A, null)) : detailBody ? /*#__PURE__*/react.createElement("div", {
    className: "prose prose-invert prose-sm max-w-none"
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: detailBody
  })) : null)), /*#__PURE__*/react.createElement(modal/* default */.A, {
    title: /*#__PURE__*/react.createElement("div", {
      className: "flex items-start gap-3 pr-6"
    }, /*#__PURE__*/react.createElement("span", {
      className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent dark:bg-accent/16"
    }, /*#__PURE__*/react.createElement(upload/* default */.A, {
      className: "h-5 w-5",
      "aria-hidden": true
    })), /*#__PURE__*/react.createElement("div", {
      className: "min-w-0 flex-1"
    }, /*#__PURE__*/react.createElement("div", {
      className: "font-agent text-base font-semibold leading-tight text-primary"
    }, "\u53D1\u5E03\u65B0\u6280\u80FD"), /*#__PURE__*/react.createElement("p", {
      className: "mt-1.5 text-xs font-normal leading-relaxed text-secondary"
    }, "\u4E0A\u4F20 Skill \u5305\uFF0C\u5BA1\u6838\u901A\u8FC7\u540E\u5C55\u793A\u5728\u6280\u80FD\u5E7F\u573A"))),
    open: ENABLE_HEPAI_SKILL_ZIP_UPLOAD && hepaiUploadOpen,
    onCancel: () => {
      setHepaiUploadOpen(false);
      resetPublishForm();
    },
    footer: /*#__PURE__*/react.createElement("div", {
      className: "flex justify-end gap-2"
    }, /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
      onClick: () => {
        setHepaiUploadOpen(false);
        resetPublishForm();
      }
    }, "\u53D6\u6D88"), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
      type: "primary",
      loading: hepaiUploading,
      disabled: hepaiPackingFolder,
      icon: /*#__PURE__*/react.createElement(send/* default */.A, {
        className: "h-4 w-4",
        "aria-hidden": true
      }),
      onClick: () => void submitHepaiUpload()
    }, "\u53D1\u5E03 Skill")),
    destroyOnClose: true,
    width: 600,
    styles: {
      content: {
        borderRadius: 16,
        overflow: "hidden"
      },
      header: {
        marginBottom: 0,
        paddingBottom: 12
      },
      body: {
        paddingTop: 8,
        maxHeight: "min(80vh, 720px)",
        overflow: "auto"
      },
      footer: {
        paddingTop: 16
      }
    }
  }, /*#__PURE__*/react.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("div", {
    className: "mb-1.5 text-sm font-medium text-primary"
  }, "Skill \u6587\u4EF6 ", /*#__PURE__*/react.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/react.createElement("input", {
    ref: setFolderInputRef,
    type: "file",
    multiple: true,
    className: "sr-only",
    "aria-hidden": true,
    tabIndex: -1,
    onChange: handleFolderInputChange
  }), /*#__PURE__*/react.createElement("input", {
    ref: hepaiZipInputRef,
    type: "file",
    accept: ".zip,application/zip",
    className: "sr-only",
    "aria-hidden": true,
    tabIndex: -1,
    onChange: e => {
      var _e$target$files$, _e$target$files;
      const f = (_e$target$files$ = (_e$target$files = e.target.files) === null || _e$target$files === void 0 ? void 0 : _e$target$files[0]) !== null && _e$target$files$ !== void 0 ? _e$target$files$ : null;
      syncPickFromFile(f);
      e.target.value = "";
    }
  }), /*#__PURE__*/react.createElement("div", {
    className: ["flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border-2 px-4 py-6 transition-[border-color,background-color,box-shadow]", hepaiPickPreview ? "border-accent/35 bg-accent/[0.06] shadow-sm ring-1 ring-accent/10 dark:border-accent/30 dark:bg-accent/[0.08] dark:ring-accent/15" : "border-dashed border-border-primary/70 bg-tertiary/20 dark:border-white/12 dark:bg-white/[0.02]"].join(" "),
    onDragOver: e => {
      e.preventDefault();
      e.stopPropagation();
    },
    onDrop: e => {
      var _e$dataTransfer$files, _f$name;
      e.preventDefault();
      const f = (_e$dataTransfer$files = e.dataTransfer.files) === null || _e$dataTransfer$files === void 0 ? void 0 : _e$dataTransfer$files[0];
      if (f !== null && f !== void 0 && (_f$name = f.name) !== null && _f$name !== void 0 && _f$name.toLowerCase().endsWith(".zip")) {
        syncPickFromFile(f);
      } else {
        message/* default */.Ay.warning("请将 .zip 文件拖到此处；文件夹请使用下方「选择文件夹」");
      }
    }
  }, hepaiPickPreview ? /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement(Package, {
    className: "h-9 w-9 text-accent/90",
    strokeWidth: 1.75,
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("span", {
    className: "max-w-full truncate px-1 text-center text-sm font-semibold text-primary"
  }, hepaiPickPreview.name), /*#__PURE__*/react.createElement("span", {
    className: "text-xs tabular-nums text-secondary"
  }, formatBytes(hepaiPickPreview.size)), /*#__PURE__*/react.createElement("span", {
    className: "text-center text-xs leading-relaxed text-secondary"
  }, "\u53EF\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u66F4\u6362\uFF1B\u62D6\u62FD\u4EC5\u652F\u6301 zip")) : /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("span", {
    className: "max-w-md text-center text-xs leading-relaxed text-secondary"
  }, "\u8BF7\u786E\u4FDD\u5305\u542B SKILL.md\uFF1B\u6587\u4EF6\u5939\u8BF7\u70B9\u300C\u9009\u62E9\u6587\u4EF6\u5939\u300D\uFF08\u6D4F\u89C8\u5668\u5C06\u6253\u5305\u4E3A zip\uFF09\uFF1B\u6700\u591A", " ", MAX_SKILL_FOLDER_FILES, " \u4E2A\u6587\u4EF6\uFF0C\u603B\u5927\u5C0F\u4E0D\u8D85\u8FC7 10 MB")), /*#__PURE__*/react.createElement("div", {
    className: "mt-3 flex flex-wrap items-center gap-2"
  }, /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    type: "default",
    loading: hepaiPackingFolder,
    disabled: hepaiUploading,
    icon: /*#__PURE__*/react.createElement(folder_open/* default */.A, {
      className: "h-4 w-4",
      "aria-hidden": true
    }),
    className: "rounded-xl",
    onClick: () => {
      var _hepaiFolderInputRef$;
      return (_hepaiFolderInputRef$ = hepaiFolderInputRef.current) === null || _hepaiFolderInputRef$ === void 0 ? void 0 : _hepaiFolderInputRef$.click();
    }
  }, "\u9009\u62E9\u6587\u4EF6\u5939"), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    type: "default",
    disabled: hepaiPackingFolder || hepaiUploading,
    icon: /*#__PURE__*/react.createElement(Package, {
      className: "h-4 w-4",
      "aria-hidden": true
    }),
    className: "rounded-xl",
    onClick: () => {
      var _hepaiZipInputRef$cur;
      return (_hepaiZipInputRef$cur = hepaiZipInputRef.current) === null || _hepaiZipInputRef$cur === void 0 ? void 0 : _hepaiZipInputRef$cur.click();
    }
  }, "\u9009\u62E9 zip \u6587\u4EF6")))), /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("div", {
    className: "mb-1.5 text-sm font-medium text-primary"
  }, "\u663E\u793A\u540D\u79F0 ", /*#__PURE__*/react.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/react.createElement(input/* default */.A, {
    placeholder: "Skill \u663E\u793A\u540D\u79F0",
    value: publishDisplayName,
    onChange: e => setPublishDisplayName(e.target.value),
    className: "rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
  })), /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("div", {
    className: "mb-1.5 text-sm font-medium text-primary"
  }, "\u56FE\u6807"), /*#__PURE__*/react.createElement(es_select/* default */.A, {
    allowClear: true,
    placeholder: "\u4E3A\u4F60\u7684 Skill \u9009\u62E9\u4E00\u4E2A\u5408\u9002\u7684\u56FE\u6807",
    value: publishIcon || undefined,
    onChange: v => setPublishIcon(typeof v === "string" ? v : ""),
    className: "w-full [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-tertiary/40 [&_.ant-select-selector]:bg-background/55 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]",
    options: SKILL_ICON_OPTIONS.map(o => ({
      value: o.value,
      label: /*#__PURE__*/react.createElement("span", {
        className: "flex items-center gap-2"
      }, /*#__PURE__*/react.createElement(o.Icon, {
        className: "h-4 w-4 shrink-0",
        "aria-hidden": true
      }), o.label)
    }))
  })), /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("div", {
    className: "mb-1.5 text-sm font-medium text-primary"
  }, "\u63CF\u8FF0"), /*#__PURE__*/react.createElement(input/* default */.A.TextArea, {
    rows: 3,
    placeholder: "\u8BE5\u63CF\u8FF0\u4F1A\u4ECE SKILL.md \u7684 description \u5B57\u6BB5\u4E2D\u81EA\u52A8\u63D0\u53D6\uFF0C\u4E5F\u652F\u6301\u624B\u52A8\u586B\u5199",
    value: publishDescription,
    onChange: e => setPublishDescription(e.target.value),
    className: "rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
  })), /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("div", {
    className: "mb-1.5 text-sm font-medium text-primary"
  }, "\u7248\u672C\u53F7 ", /*#__PURE__*/react.createElement("span", {
    className: "text-red-500"
  }, "*")), /*#__PURE__*/react.createElement(input/* default */.A, {
    placeholder: "1.0.0",
    value: publishVersion,
    onChange: e => setPublishVersion(e.target.value),
    className: "rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
  })), /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("div", {
    className: "mb-1.5 text-sm font-medium text-primary"
  }, "\u53D8\u66F4\u8BF4\u660E"), /*#__PURE__*/react.createElement(input/* default */.A.TextArea, {
    rows: 2,
    placeholder: "\u63CF\u8FF0\u672C\u6B21\u7248\u672C\u7684\u4E3B\u8981\u53D8\u66F4\u5185\u5BB9",
    value: publishChangelog,
    onChange: e => setPublishChangelog(e.target.value),
    className: "rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
  })))), /*#__PURE__*/react.createElement(modal/* default */.A, {
    title: /*#__PURE__*/react.createElement("div", {
      className: "flex items-start gap-3 pr-8"
    }, /*#__PURE__*/react.createElement("span", {
      className: "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent transition-colors dark:bg-accent/[0.16]"
    }, /*#__PURE__*/react.createElement(file_text/* default */.A, {
      className: "h-5 w-5",
      strokeWidth: 2,
      "aria-hidden": true
    })), /*#__PURE__*/react.createElement("div", {
      className: "min-w-0 flex-1"
    }, /*#__PURE__*/react.createElement("div", {
      className: "font-agent text-base font-semibold leading-tight text-primary"
    }, "SKILL.md \u9884\u89C8"), skillMdTitle ? /*#__PURE__*/react.createElement("div", {
      className: "mt-1 truncate text-sm font-medium leading-snug text-secondary",
      title: skillMdTitle
    }, (() => {
      const {
        stem,
        ext
      } = splitArchiveName(skillMdTitle);
      return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("span", null, stem), ext ? /*#__PURE__*/react.createElement("span", {
        className: "font-agent-mono text-[13px] font-normal text-secondary/70"
      }, ext) : null);
    })()) : /*#__PURE__*/react.createElement("div", {
      className: "mt-0.5 text-xs font-normal text-secondary"
    }, "\u6280\u80FD\u5305\u6587\u6863"))),
    open: skillMdOpen,
    onCancel: () => {
      setSkillMdOpen(false);
      setSkillMdBody("");
    },
    footer: null,
    destroyOnClose: true,
    width: 840,
    styles: {
      content: {
        borderRadius: 16,
        overflow: "hidden",
        padding: 0
      },
      header: {
        marginBottom: 0,
        padding: "16px 20px 12px",
        borderBottom: "1px solid color-mix(in oklab, var(--color-border-secondary, #e2e8f0) 65%, transparent)"
      },
      body: {
        padding: "0 20px 20px",
        paddingTop: 14
      }
    },
    className: "[&_.ant-modal-content]:bg-background [&_.ant-modal-header]:bg-background [&_.ant-modal-header]:border-b-border-secondary/60 dark:[&_.ant-modal-header]:border-white/[0.08]"
  }, skillMdLoading ? /*#__PURE__*/react.createElement("div", {
    className: "flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-tertiary/45 bg-tertiary/[0.06] px-6 py-14 dark:border-white/[0.1] dark:bg-white/[0.02]"
  }, /*#__PURE__*/react.createElement(spin/* default */.A, null), /*#__PURE__*/react.createElement("p", {
    className: "text-sm text-secondary"
  }, "\u6B63\u5728\u52A0\u8F7D SKILL.md\u2026")) : skillMdBody ? /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col gap-3"
  }, /*#__PURE__*/react.createElement("div", {
    className: ["relative scroll max-h-[min(70vh,640px)] overflow-auto rounded-2xl border border-tertiary/50", "bg-gradient-to-b from-background via-background to-tertiary/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]", "dark:border-white/[0.08] dark:from-background dark:via-background dark:to-white/[0.02]"].join(" ")
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    className: "absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-tertiary/45 bg-background/85 text-secondary shadow-sm backdrop-blur-sm transition-colors hover:border-accent/35 hover:bg-accent/10 hover:text-accent dark:border-white/[0.1] dark:bg-background/75 dark:hover:border-accent/40",
    "aria-label": "\u590D\u5236\u5168\u6587",
    onClick: () => void copySkillMdFullText()
  }, /*#__PURE__*/react.createElement(copy/* default */.A, {
    className: "h-3.5 w-3.5",
    "aria-hidden": true
  })), /*#__PURE__*/react.createElement("article", {
    className: "px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-8"
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: skillMdBody
  })))) : /*#__PURE__*/react.createElement("div", {
    className: "flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-tertiary/50 bg-tertiary/[0.06] px-6 py-10 text-center dark:border-white/[0.1] dark:bg-white/[0.02]"
  }, /*#__PURE__*/react.createElement(file_text/* default */.A, {
    className: "h-10 w-10 text-secondary/70",
    strokeWidth: 1.5,
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("p", {
    className: "text-sm font-medium text-primary"
  }, "\u6682\u65E0\u53EF\u9884\u89C8\u5185\u5BB9"), /*#__PURE__*/react.createElement("p", {
    className: "max-w-sm text-xs leading-relaxed text-secondary"
  }, "\u8BF7\u786E\u8BA4 ZIP \u5185\u5305\u542B\u6709\u6548\u7684 SKILL.md"))));
};
/* harmony default export */ var pages_SkillsSquarePage = (SkillsSquarePage);

/***/ }),

/***/ 43242:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ FolderOpen; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const FolderOpen = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("FolderOpen", [
  [
    "path",
    {
      d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
      key: "usdka0"
    }
  ]
]);


//# sourceMappingURL=folder-open.js.map


/***/ }),

/***/ 46110:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Sparkles; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Sparkles = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Sparkles", [
  [
    "path",
    {
      d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
      key: "4pj2yx"
    }
  ],
  ["path", { d: "M20 3v4", key: "1olli1" }],
  ["path", { d: "M22 5h-4", key: "1gvqau" }],
  ["path", { d: "M4 17v2", key: "vumght" }],
  ["path", { d: "M5 18H3", key: "zchphs" }]
]);


//# sourceMappingURL=sparkles.js.map


/***/ })

}]);
//# sourceMappingURL=f6e04e55f75b94c45cdfa5eb7fc81d81d60b79ec-4bca80cc548182260051.js.map