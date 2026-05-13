"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[8570],{

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
// EXTERNAL MODULE: ./node_modules/antd/es/input/index.js + 22 modules
var input = __webpack_require__(46789);
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
// EXTERNAL MODULE: ./node_modules/antd/es/modal/index.js + 27 modules
var modal = __webpack_require__(48458);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/wrench.js
var wrench = __webpack_require__(46816);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/upload.js
var upload = __webpack_require__(94796);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/search.js
var icons_search = __webpack_require__(98445);
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

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/eye.js
var eye = __webpack_require__(3160);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/download.js
var download = __webpack_require__(48309);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/check.js
var check = __webpack_require__(45773);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/copy.js
var copy = __webpack_require__(35404);
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
;// ./src/pages/SkillsSquarePage.tsx








const ENABLE_SKILL_DOWNLOAD = false;
const ENABLE_HEPAI_SKILL_ZIP_UPLOAD = true;
const LIST_ROW_ACTION_BTN = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-tertiary/40 text-secondary transition-colors duration-200 hover:bg-accent/15 hover:text-accent dark:bg-white/[0.06]";
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
  var _row$metadata;
  const raw = (_row$metadata = row.metadata) === null || _row$metadata === void 0 ? void 0 : _row$metadata.description;
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
  const hepaiUploadInputRef = (0,react.useRef)(null);
  const {
    0: hepaiUploadOpen,
    1: setHepaiUploadOpen
  } = (0,react.useState)(false);
  const {
    0: hepaiUploading,
    1: setHepaiUploading
  } = (0,react.useState)(false);
  const {
    0: hepaiPickPreview,
    1: setHepaiPickPreview
  } = (0,react.useState)(null);
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
  const filteredHepaiRows = (0,react.useMemo)(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hepaiRows;
    return hepaiRows.filter(r => {
      var _r$uploadedBy;
      const desc = displayDescription(r, skillMdDescById[r.id]).toLowerCase();
      const by = ((_r$uploadedBy = r.uploadedBy) !== null && _r$uploadedBy !== void 0 ? _r$uploadedBy : "").toLowerCase();
      return r.filename.toLowerCase().includes(q) || desc.includes(q) || by.length > 0 && by.includes(q);
    });
  }, [hepaiRows, search, skillMdDescById]);
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
      } catch (_unused) {
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
    } catch (_unused2) {
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
    var _input$files;
    const input = hepaiUploadInputRef.current;
    const file = input === null || input === void 0 ? void 0 : (_input$files = input.files) === null || _input$files === void 0 ? void 0 : _input$files[0];
    if (!file) {
      message/* default */.Ay.warning("请选择 .zip 文件");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      message/* default */.Ay.warning("请上传 .zip 格式的技能包");
      return;
    }
    const userId = (user === null || user === void 0 ? void 0 : user.email) || "";
    if (!userId) {
      message/* default */.Ay.error("未登录或缺少 user_id（email）");
      return;
    }
    setHepaiUploading(true);
    try {
      await api/* fileAPI */.jp.uploadToHepAI(userId, file);
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
      message/* default */.Ay.success("已上传到 HepAI Files");
      setHepaiUploadOpen(false);
      setHepaiPickPreview(null);
      if (input) input.value = "";
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
  return /*#__PURE__*/react.createElement("div", {
    className: "relative flex h-full min-h-0 flex-col bg-background"
  }, /*#__PURE__*/react.createElement("div", {
    className: "pointer-events-none absolute inset-0 overflow-hidden",
    "aria-hidden": true
  }, /*#__PURE__*/react.createElement("div", {
    className: "absolute -top-28 left-[15%] h-64 w-64 rounded-full bg-accent/[0.1] blur-3xl dark:bg-accent/[0.16]"
  }), /*#__PURE__*/react.createElement("div", {
    className: "absolute top-16 right-[-6%] h-72 w-72 rounded-full bg-blue-700/[0.09] blur-3xl dark:bg-blue-700/[0.14]"
  }), /*#__PURE__*/react.createElement("div", {
    className: "absolute inset-0 opacity-[0.4] dark:opacity-[0.24]",
    style: {
      backgroundImage: "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px),\n              linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)",
      backgroundSize: "40px 40px"
    }
  })), /*#__PURE__*/react.createElement("div", {
    className: "relative z-10 flex min-h-0 flex-1 flex-col"
  }, /*#__PURE__*/react.createElement("div", {
    className: "shrink-0 border-b border-tertiary/40 px-4 pb-4 pt-5 dark:border-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_14px_36px_rgba(0,0,0,0.4)]"
  }, /*#__PURE__*/react.createElement("div", {
    className: "mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
  }, /*#__PURE__*/react.createElement("div", {
    className: "min-w-0 animate-slide-up"
  }, /*#__PURE__*/react.createElement("h1", {
    className: "font-agent flex items-center gap-2.5 text-lg font-medium tracking-normal text-slate-600 sm:text-xl dark:text-slate-200"
  }, /*#__PURE__*/react.createElement("span", {
    className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tertiary/40 text-accent dark:bg-white/[0.06]"
  }, /*#__PURE__*/react.createElement(wrench/* default */.A, {
    className: "h-[18px] w-[18px]",
    "aria-hidden": true
  })), /*#__PURE__*/react.createElement("span", {
    className: "leading-snug font-medium tracking-wide"
  }, "SKILLS"))), /*#__PURE__*/react.createElement("div", {
    className: "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end animate-slide-up [animation-delay:50ms] [animation-fill-mode:backwards]"
  }, ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? /*#__PURE__*/react.createElement("span", {
    role: "button",
    tabIndex: 0,
    className: ["inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-medium", "border border-accent/35 bg-accent/12 text-slate-700 dark:text-slate-200", "transition-[background-color,border-color,transform] duration-200 ease-out", "hover:border-accent/50 hover:bg-accent/18", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background", "active:scale-[0.98]"].join(" "),
    onClick: () => {
      setHepaiPickPreview(null);
      setHepaiUploadOpen(true);
    },
    onKeyDown: e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setHepaiPickPreview(null);
        setHepaiUploadOpen(true);
      }
    }
  }, /*#__PURE__*/react.createElement(upload/* default */.A, {
    className: "h-4 w-4 text-accent/90",
    "aria-hidden": true
  }), "\u4E0A\u4F20") : null, /*#__PURE__*/react.createElement(input/* default */.A, {
    allowClear: true,
    prefix: /*#__PURE__*/react.createElement(icons_search/* default */.A, {
      className: "h-4 w-4 text-secondary"
    }),
    placeholder: "\u641C\u7D22\u540D\u79F0\u6216\u63CF\u8FF0",
    value: search,
    onChange: e => setSearch(e.target.value),
    className: "w-full sm:max-w-xs [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 [&_.ant-input]:py-1.5 [&_.ant-input]:text-slate-700 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04] dark:[&_.ant-input]:text-slate-200"
  })))), /*#__PURE__*/react.createElement("div", {
    className: "min-h-0 flex-1 overflow-auto px-4 py-5"
  }, /*#__PURE__*/react.createElement("div", {
    className: "mx-auto max-w-6xl"
  }, hepaiRows.length === 0 ? /*#__PURE__*/react.createElement("div", {
    className: "animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-tertiary/55 bg-tertiary/10 px-6 py-16 text-center dark:border-white/12 dark:bg-white/[0.03]"
  }, /*#__PURE__*/react.createElement("div", {
    className: "mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-tertiary/40 dark:bg-white/[0.06]"
  }, /*#__PURE__*/react.createElement(Package, {
    className: "h-7 w-7 text-accent",
    "aria-hidden": true
  })), /*#__PURE__*/react.createElement("p", {
    className: "text-sm font-medium text-slate-700 dark:text-slate-200"
  }, "\u6682\u65E0\u6280\u80FD\u5305"), /*#__PURE__*/react.createElement("p", {
    className: "mt-1 text-xs text-secondary"
  }, "\u4E0A\u4F20 ZIP \u540E\u5373\u53EF\u51FA\u73B0\u5728\u6B64\u5217\u8868"), ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? /*#__PURE__*/react.createElement("button", {
    type: "button",
    className: "mt-5 inline-flex h-9 items-center gap-2 rounded-xl border border-accent/40 bg-accent/14 px-4 text-sm font-medium text-slate-700 transition hover:border-accent/55 hover:bg-accent/22 dark:text-slate-200",
    onClick: () => {
      setHepaiPickPreview(null);
      setHepaiUploadOpen(true);
    }
  }, /*#__PURE__*/react.createElement(upload/* default */.A, {
    className: "h-4 w-4 text-accent",
    "aria-hidden": true
  }), "\u4E0A\u4F20 ZIP") : null) : filteredHepaiRows.length === 0 ? /*#__PURE__*/react.createElement("div", {
    className: "animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-tertiary/50 bg-tertiary/10 px-6 py-12 dark:border-white/10 dark:bg-white/[0.03]"
  }, /*#__PURE__*/react.createElement(icons_search/* default */.A, {
    className: "mb-2 h-9 w-9 text-secondary opacity-80",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("p", {
    className: "text-sm font-medium text-slate-700 dark:text-slate-200"
  }, "\u65E0\u5339\u914D\u9879"), /*#__PURE__*/react.createElement("p", {
    className: "mt-1 text-xs text-secondary"
  }, "\u6E05\u7A7A\u641C\u7D22\u6216\u6362\u5173\u952E\u8BCD")) : /*#__PURE__*/react.createElement("div", {
    className: "overflow-hidden rounded-2xl border border-tertiary/50 bg-background/40 dark:border-white/[0.06] dark:bg-white/[0.02]"
  }, /*#__PURE__*/react.createElement("ul", {
    className: "divide-y divide-tertiary/45 text-sm dark:divide-white/[0.08]"
  }, filteredHepaiRows.map(r => {
    var _r$uploadedBy2, _user$email;
    const desc = displayDescription(r, skillMdDescById[r.id]);
    const {
      stem,
      ext
    } = splitArchiveName(r.filename);
    const absTime = new Date(r.createdAtMs).toLocaleString();
    const uploader = ((_r$uploadedBy2 = r.uploadedBy) === null || _r$uploadedBy2 === void 0 ? void 0 : _r$uploadedBy2.trim()) || (user === null || user === void 0 ? void 0 : (_user$email = user.email) === null || _user$email === void 0 ? void 0 : _user$email.trim()) || "";
    const copied = copiedRowId === r.id;
    return /*#__PURE__*/react.createElement("li", {
      key: r.id,
      className: "px-4 py-3.5 sm:px-4 sm:py-4"
    }, /*#__PURE__*/react.createElement("div", {
      className: "flex items-center gap-3 sm:gap-4"
    }, /*#__PURE__*/react.createElement("div", {
      className: "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/[0.12] text-accent dark:bg-accent/[0.16]"
    }, /*#__PURE__*/react.createElement(Package, {
      className: "h-[24px] w-[24px]",
      strokeWidth: 2,
      "aria-hidden": true
    })), /*#__PURE__*/react.createElement("div", {
      className: "min-w-0 flex-1"
    }, /*#__PURE__*/react.createElement("div", {
      className: "truncate text-[15px] font-medium leading-snug text-slate-800 dark:text-slate-100",
      title: r.filename
    }, /*#__PURE__*/react.createElement("span", null, stem), ext ? /*#__PURE__*/react.createElement("span", {
      className: "font-mono text-sm font-normal text-slate-400 dark:text-slate-500"
    }, ext) : null), desc ? /*#__PURE__*/react.createElement("p", {
      className: "mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400"
    }, desc) : null, /*#__PURE__*/react.createElement("p", {
      className: "mt-1.5 text-xs leading-relaxed text-secondary"
    }, uploader ? /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("span", {
      className: "max-w-[14rem] truncate text-secondary/90",
      title: uploader
    }, uploader), /*#__PURE__*/react.createElement("span", {
      className: "text-secondary/50"
    }, " \u4E0A\u4F20")) : /*#__PURE__*/react.createElement("span", {
      className: "text-secondary/75"
    }, "\u4E0A\u4F20"), /*#__PURE__*/react.createElement("span", {
      className: "mx-1.5 text-secondary/40"
    }, "\xB7"), /*#__PURE__*/react.createElement("span", {
      className: "tabular-nums"
    }, formatRelativePast(r.createdAtMs)), /*#__PURE__*/react.createElement("span", {
      className: "mx-1.5 text-secondary/40"
    }, "\xB7"), /*#__PURE__*/react.createElement("span", {
      className: "tabular-nums text-secondary/85"
    }, absTime))), /*#__PURE__*/react.createElement("div", {
      className: "flex shrink-0 items-center gap-1.5"
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
      className: LIST_ROW_ACTION_BTN,
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
  })))))), /*#__PURE__*/react.createElement(drawer, {
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
      className: "flex items-center gap-3 pr-6"
    }, /*#__PURE__*/react.createElement("span", {
      className: ["flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors", hepaiPickPreview ? "bg-emerald-500/14 text-emerald-600 dark:bg-emerald-400/14 dark:text-emerald-400" : "bg-accent/12 text-accent dark:bg-accent/16"].join(" ")
    }, hepaiPickPreview ? /*#__PURE__*/react.createElement(check/* default */.A, {
      className: "h-5 w-5",
      strokeWidth: 2.25,
      "aria-hidden": true
    }) : /*#__PURE__*/react.createElement(upload/* default */.A, {
      className: "h-5 w-5",
      "aria-hidden": true
    })), /*#__PURE__*/react.createElement("div", {
      className: "min-w-0 flex-1"
    }, /*#__PURE__*/react.createElement("div", {
      className: "font-agent text-base font-semibold leading-tight text-slate-800 dark:text-slate-100"
    }, "\u4E0A\u4F20\u5230 HepAI"), hepaiPickPreview ? /*#__PURE__*/react.createElement("div", {
      className: "mt-1 min-w-0 space-y-0.5"
    }, /*#__PURE__*/react.createElement("div", {
      className: "truncate text-sm font-medium leading-snug text-slate-700 dark:text-slate-200",
      title: hepaiPickPreview.name
    }, (() => {
      const {
        stem,
        ext
      } = splitArchiveName(hepaiPickPreview.name);
      return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("span", null, stem), ext ? /*#__PURE__*/react.createElement("span", {
        className: "font-mono text-[13px] font-normal text-slate-400 dark:text-slate-500"
      }, ext) : null);
    })()), /*#__PURE__*/react.createElement("div", {
      className: "flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal text-secondary"
    }, /*#__PURE__*/react.createElement("span", {
      className: "tabular-nums"
    }, formatBytes(hepaiPickPreview.size)), !hepaiPickPreview.name.toLowerCase().endsWith(".zip") ? /*#__PURE__*/react.createElement("span", {
      className: "text-amber-600 dark:text-amber-400"
    }, "\u9700\u4E3A .zip \u683C\u5F0F") : /*#__PURE__*/react.createElement("span", null, "ZIP \xB7 SKILL.md"))) : /*#__PURE__*/react.createElement("div", {
      className: "mt-0.5 text-xs font-normal text-secondary"
    }, "ZIP \xB7 SKILL.md"))),
    open: ENABLE_HEPAI_SKILL_ZIP_UPLOAD && hepaiUploadOpen,
    onCancel: () => {
      setHepaiUploadOpen(false);
      setHepaiPickPreview(null);
      if (hepaiUploadInputRef.current) hepaiUploadInputRef.current.value = "";
    },
    onOk: () => void submitHepaiUpload(),
    confirmLoading: hepaiUploading,
    okText: "\u4E0A\u4F20",
    destroyOnClose: true,
    width: 440,
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
        paddingTop: 8
      },
      footer: {
        paddingTop: 12
      }
    }
  }, /*#__PURE__*/react.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/react.createElement("label", {
    className: ["relative flex min-h-[168px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 px-4 py-8 transition-[border-color,background-color,box-shadow]", hepaiPickPreview ? "border-accent/35 bg-accent/[0.06] shadow-sm ring-1 ring-accent/10 dark:border-accent/30 dark:bg-accent/[0.08] dark:ring-accent/15" : "border-dashed border-slate-200 bg-slate-50/90 hover:border-accent/40 hover:bg-accent/[0.04] dark:border-white/12 dark:bg-white/[0.03] dark:hover:border-accent/35 dark:hover:bg-accent/[0.06]"].join(" ")
  }, hepaiPickPreview ? /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement(Package, {
    className: "pointer-events-none h-9 w-9 text-accent/90",
    strokeWidth: 1.75,
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("span", {
    className: "pointer-events-none max-w-full truncate px-1 text-center text-sm font-semibold text-slate-800 dark:text-slate-100"
  }, hepaiPickPreview.name), /*#__PURE__*/react.createElement("span", {
    className: "pointer-events-none text-xs tabular-nums text-secondary"
  }, formatBytes(hepaiPickPreview.size)), /*#__PURE__*/react.createElement("span", {
    className: "pointer-events-none text-center text-xs leading-relaxed text-secondary"
  }, "\u70B9\u51FB\u533A\u57DF\u53EF\u66F4\u6362\u6587\u4EF6")) : /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement(upload/* default */.A, {
    className: "pointer-events-none h-9 w-9 text-accent/85",
    strokeWidth: 1.75,
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("span", {
    className: "pointer-events-none text-sm font-medium text-slate-700 dark:text-slate-200"
  }, "\u70B9\u51FB\u9009\u62E9\u6587\u4EF6"), /*#__PURE__*/react.createElement("span", {
    className: "pointer-events-none text-center text-xs leading-relaxed text-secondary"
  }, "\u4EC5\u652F\u6301 .zip\uFF0C\u9700\u5305\u542B SKILL.md")), /*#__PURE__*/react.createElement("input", {
    ref: hepaiUploadInputRef,
    type: "file",
    accept: ".zip,application/zip",
    className: "absolute inset-0 h-full w-full cursor-pointer opacity-0",
    onChange: e => {
      var _e$target$files;
      const f = (_e$target$files = e.target.files) === null || _e$target$files === void 0 ? void 0 : _e$target$files[0];
      setHepaiPickPreview(f ? {
        name: f.name,
        size: f.size
      } : null);
    }
  })))), /*#__PURE__*/react.createElement(modal/* default */.A, {
    title: skillMdTitle ? skillMdTitle + " \xB7 SKILL.md" : "SKILL.md",
    open: skillMdOpen,
    onCancel: () => {
      setSkillMdOpen(false);
      setSkillMdBody("");
    },
    footer: null,
    destroyOnClose: true,
    width: 720
  }, skillMdLoading ? /*#__PURE__*/react.createElement("div", {
    className: "flex justify-center py-10"
  }, /*#__PURE__*/react.createElement(spin/* default */.A, null)) : skillMdBody ? /*#__PURE__*/react.createElement("div", {
    className: "prose prose-invert prose-sm max-w-none"
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: skillMdBody
  })) : /*#__PURE__*/react.createElement("div", {
    className: "text-sm text-secondary"
  }, "\u6682\u65E0\u53EF\u9884\u89C8\u5185\u5BB9")));
};
/* harmony default export */ var pages_SkillsSquarePage = (SkillsSquarePage);

/***/ }),

/***/ 98445:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Search; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Search = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Search", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
]);


//# sourceMappingURL=search.js.map


/***/ })

}]);
//# sourceMappingURL=64ac6e19568de891ca78ccbec0f0cfeaaf675e77-2bea81557bf0982628bd.js.map