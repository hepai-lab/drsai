"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[8570],{

/***/ 68147:
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
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var tooltip = __webpack_require__(40367);
// EXTERNAL MODULE: ./node_modules/antd/es/spin/index.js + 6 modules
var spin = __webpack_require__(34716);
// EXTERNAL MODULE: ./node_modules/antd/es/empty/index.js + 3 modules
var empty = __webpack_require__(17308);
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
// EXTERNAL MODULE: ./node_modules/antd/es/modal/index.js + 27 modules
var modal = __webpack_require__(48458);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/zap.js
var zap = __webpack_require__(46858);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/upload.js
var upload = __webpack_require__(94796);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/search.js
var icons_search = __webpack_require__(98445);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/refresh-cw.js
var refresh_cw = __webpack_require__(15977);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/book-open.js
var book_open = __webpack_require__(60665);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/download.js
var download = __webpack_require__(48309);
// EXTERNAL MODULE: ./src/components/common/markdownrender.tsx + 213 modules
var markdownrender = __webpack_require__(57256);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
// EXTERNAL MODULE: ./src/components/common/Button.tsx
var Button = __webpack_require__(2915);
;// ./src/pages/SkillsSquarePage.tsx






const ENABLE_SKILL_DOWNLOAD = false;
const ENABLE_SKILL_UPLOAD = false;
const SkillsSquarePage = () => {
  const {
    0: items,
    1: setItems
  } = (0,react.useState)([]);
  const {
    0: loading,
    1: setLoading
  } = (0,react.useState)(true);
  const {
    0: error,
    1: setError
  } = (0,react.useState)(null);
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
    0: uploadOpen,
    1: setUploadOpen
  } = (0,react.useState)(false);
  const {
    0: uploadSlug,
    1: setUploadSlug
  } = (0,react.useState)("");
  const {
    0: uploading,
    1: setUploading
  } = (0,react.useState)(false);
  const {
    0: downloadSlug,
    1: setDownloadSlug
  } = (0,react.useState)(null);
  const uploadInputRef = (0,react.useRef)(null);
  const load = (0,react.useCallback)(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api/* skillsAPI */.xm.listCatalog();
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);
  (0,react.useEffect)(() => {
    void load();
  }, [load]);
  const filtered = (0,react.useMemo)(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q));
  }, [items, search]);
  const openDetail = async row => {
    setActive(row);
    setDrawerOpen(true);
    setDetailBody(null);
    setDetailLoading(true);
    try {
      const d = await api/* skillsAPI */.xm.getCatalogEntry(row.slug);
      setDetailBody(d.body);
    } catch (e) {
      setDetailBody("_\u52A0\u8F7D\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e)) + "_");
    } finally {
      setDetailLoading(false);
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
  const submitUpload = async () => {
    var _input$files;
    const input = uploadInputRef.current;
    const file = input === null || input === void 0 ? void 0 : (_input$files = input.files) === null || _input$files === void 0 ? void 0 : _input$files[0];
    if (!file) {
      message/* default */.Ay.warning("请选择 .zip 文件");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      message/* default */.Ay.warning("请上传 .zip 格式的技能包");
      return;
    }
    setUploading(true);
    try {
      await api/* skillsAPI */.xm.uploadCatalogZip(file, uploadSlug.trim() || undefined);
      message/* default */.Ay.success("上传成功");
      setUploadOpen(false);
      setUploadSlug("");
      if (input) input.value = "";
      await load();
    } catch (e) {
      message/* default */.Ay.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };
  return /*#__PURE__*/react.createElement("div", {
    className: "h-full min-h-0 flex flex-col bg-background"
  }, /*#__PURE__*/react.createElement("div", {
    className: "shrink-0 px-4 pt-4 pb-3 border-b border-tertiary/40 dark:border-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0))] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_12px_34px_rgba(0,0,0,0.45)]"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between max-w-6xl mx-auto w-full"
  }, /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("h1", {
    className: "text-lg font-semibold text-primary flex items-center gap-2"
  }, /*#__PURE__*/react.createElement(zap/* default */.A, {
    className: "w-5 h-5 text-accent"
  }), "\u6280\u80FD\u5E7F\u573A"), /*#__PURE__*/react.createElement("p", {
    className: "text-sm text-secondary mt-0.5"
  }, "\u6D4F\u89C8\u3001\u4E0B\u8F7D\u6216\u4E0A\u4F20 Agent Skills\uFF08ZIP \u5185\u542B SKILL.md \u76EE\u5F55\uFF09\uFF0C\u4E0E\u667A\u80FD\u4F53\u80FD\u529B\u8BF4\u660E\u540C\u6B65\u3002")), /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-2 w-full sm:w-auto"
  }, ENABLE_SKILL_UPLOAD ? /*#__PURE__*/react.createElement("span", {
    role: "button",
    tabIndex: loading ? -1 : 0,
    "aria-disabled": loading,
    className: ["inline-flex shrink-0 h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium", "border border-tertiary/50 bg-gradient-to-b from-tertiary/25 to-tertiary/10 text-primary", "shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_1px_2px_rgba(0,0,0,0.25)]", "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out", "hover:border-accent/40 hover:from-tertiary/35 hover:to-tertiary/18 hover:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_4px_12px_rgba(0,0,0,0.2)]", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background", "active:scale-[0.98]", loading ? "pointer-events-none cursor-not-allowed opacity-45" : "cursor-pointer"].join(" "),
    onClick: () => {
      if (!loading) setUploadOpen(true);
    },
    onKeyDown: e => {
      if (loading) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setUploadOpen(true);
      }
    }
  }, /*#__PURE__*/react.createElement(upload/* default */.A, {
    className: "w-4 h-4 text-accent/90",
    "aria-hidden": true
  }), "\u4E0A\u4F20") : null, /*#__PURE__*/react.createElement(input/* default */.A, {
    allowClear: true,
    prefix: /*#__PURE__*/react.createElement(icons_search/* default */.A, {
      className: "w-4 h-4 text-secondary"
    }),
    placeholder: "\u641C\u7D22\u540D\u79F0\u3001\u63CF\u8FF0\u6216\u76EE\u5F55\u540D\u2026",
    value: search,
    onChange: e => setSearch(e.target.value),
    className: "max-w-md"
  }), /*#__PURE__*/react.createElement(tooltip/* default */.A, {
    title: "\u5237\u65B0\u5217\u8868"
  }, /*#__PURE__*/react.createElement("span", {
    role: "button",
    tabIndex: loading ? -1 : 0,
    "aria-disabled": loading,
    "aria-label": "\u5237\u65B0\u5217\u8868",
    className: ["inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", "border border-tertiary/50 bg-gradient-to-b from-tertiary/25 to-tertiary/10 text-secondary", "shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_1px_2px_rgba(0,0,0,0.25)]", "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out", "hover:border-accent/40 hover:text-accent hover:from-tertiary/35 hover:to-tertiary/18", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background", "active:scale-[0.98]", loading ? "pointer-events-none cursor-not-allowed opacity-45" : "cursor-pointer"].join(" "),
    onClick: () => {
      if (!loading) void load();
    },
    onKeyDown: e => {
      if (loading) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void load();
      }
    }
  }, /*#__PURE__*/react.createElement(refresh_cw/* default */.A, {
    className: "h-4 w-4 " + (loading ? "animate-spin text-accent" : ""),
    "aria-hidden": true
  })))))), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 min-h-0 overflow-auto px-4 py-4"
  }, /*#__PURE__*/react.createElement("div", {
    className: "max-w-6xl mx-auto"
  }, loading ? /*#__PURE__*/react.createElement("div", {
    className: "flex justify-center py-20"
  }, /*#__PURE__*/react.createElement(spin/* default */.A, {
    size: "large"
  })) : error ? /*#__PURE__*/react.createElement("div", {
    className: "rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
  }, error) : filtered.length === 0 ? /*#__PURE__*/react.createElement(empty/* default */.A, {
    className: "py-16",
    description: items.length === 0 ? "暂无技能或目录未找到" : "无匹配项"
  }) : /*#__PURE__*/react.createElement("ul", {
    className: "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
  }, filtered.map(s => /*#__PURE__*/react.createElement("li", {
    key: s.slug,
    className: "h-full"
  }, /*#__PURE__*/react.createElement("div", {
    className: "h-[168px] rounded-2xl border border-tertiary/50 bg-tertiary/10 hover:bg-tertiary/20 hover:border-accent/30 transition-colors flex flex-col overflow-hidden dark:border-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_14px_32px_rgba(0,0,0,0.5)] dark:hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.022))] dark:hover:shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_22px_48px_rgba(0,0,0,0.6)] dark:hover:ring-1 dark:hover:ring-white/10"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: () => void openDetail(s),
    className: "w-full text-left p-4 flex flex-col gap-2 flex-1"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-start justify-between gap-2"
  }, /*#__PURE__*/react.createElement("span", {
    className: "font-semibold text-primary line-clamp-2"
  }, s.name), /*#__PURE__*/react.createElement(book_open/* default */.A, {
    className: "w-4 h-4 shrink-0 text-accent opacity-80"
  })), /*#__PURE__*/react.createElement("p", {
    className: "text-sm text-secondary line-clamp-3 flex-1"
  }, s.description)), /*#__PURE__*/react.createElement("div", {
    className: "flex items-center justify-between gap-2 px-4 pb-3 pt-0 text-xs text-secondary/80 border-t border-tertiary/30 dark:border-transparent dark:bg-white/[0.02] dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] dark:text-secondary dark:[&_code]:text-primary dark:[&_code]:font-medium"
  }, /*#__PURE__*/react.createElement("div", {
    className: "min-w-0 flex-1 flex items-center gap-2"
  }, /*#__PURE__*/react.createElement("code", {
    className: "truncate"
  }, s.slug), s.compatibility ? /*#__PURE__*/react.createElement("span", {
    className: "truncate hidden sm:inline",
    title: s.compatibility
  }, s.compatibility) : null), ENABLE_SKILL_DOWNLOAD ? /*#__PURE__*/react.createElement(tooltip/* default */.A, {
    title: "\u4E0B\u8F7D ZIP"
  }, /*#__PURE__*/react.createElement(Button/* Button */.$, {
    type: "button",
    variant: "ghost",
    className: "shrink-0 h-7 px-2",
    onClick: e => {
      e.stopPropagation();
      void handleDownload(s.slug);
    },
    disabled: downloadSlug === s.slug,
    isLoading: downloadSlug === s.slug
  }, /*#__PURE__*/react.createElement(download/* default */.A, {
    className: "w-4 h-4"
  }))) : null))))))), /*#__PURE__*/react.createElement(drawer, {
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
    title: "\u4E0A\u4F20\u6280\u80FD\uFF08ZIP\uFF09",
    open: ENABLE_SKILL_UPLOAD && uploadOpen,
    onCancel: () => {
      setUploadOpen(false);
      setUploadSlug("");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    },
    onOk: () => void submitUpload(),
    confirmLoading: uploading,
    okText: "\u4E0A\u4F20",
    destroyOnClose: true
  }, /*#__PURE__*/react.createElement("p", {
    className: "text-sm text-secondary mb-3"
  }, "\u652F\u6301\u4E24\u79CD\u7ED3\u6784\uFF1A\uFF081\uFF09ZIP \u5185\u4EC5\u4E00\u4E2A\u5B50\u76EE\u5F55\uFF0C\u4E14\u5185\u542B ", /*#__PURE__*/react.createElement("code", null, "SKILL.md"), "\uFF0C\u76EE\u5F55\u540D\u5C06\u4F5C\u4E3A\u6280\u80FD slug\uFF1B\uFF082\uFF09ZIP \u6839\u76EE\u5F55\u76F4\u63A5\u5305\u542B ", /*#__PURE__*/react.createElement("code", null, "SKILL.md"), "\uFF0C\u6B64\u65F6\u8BF7\u5728\u4E0B\u65B9\u586B\u5199 slug\u3002"), /*#__PURE__*/react.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("div", {
    className: "text-xs text-secondary mb-1"
  }, "slug\uFF08\u53EF\u9009\uFF0C\u6839\u76EE\u5F55 SKILL.md \u65F6\u5FC5\u586B\uFF09"), /*#__PURE__*/react.createElement(input/* default */.A, {
    placeholder: "\u4F8B\u5982 my-skill",
    value: uploadSlug,
    onChange: e => setUploadSlug(e.target.value),
    allowClear: true
  })), /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("input", {
    ref: uploadInputRef,
    type: "file",
    accept: ".zip,application/zip",
    className: "block w-full text-sm text-secondary file:mr-3 file:rounded-lg file:border file:border-tertiary/50 file:bg-tertiary/20 file:px-3 file:py-1.5"
  })))));
};
/* harmony default export */ var pages_SkillsSquarePage = (SkillsSquarePage);

/***/ }),

/***/ 60665:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ BookOpen; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const BookOpen = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("BookOpen", [
  ["path", { d: "M12 7v14", key: "1akyts" }],
  [
    "path",
    {
      d: "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
      key: "ruj8y"
    }
  ]
]);


//# sourceMappingURL=book-open.js.map


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


/***/ }),

/***/ 46858:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Zap; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Zap = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Zap", [
  [
    "path",
    {
      d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
      key: "1xq2db"
    }
  ]
]);


//# sourceMappingURL=zap.js.map


/***/ })

}]);
//# sourceMappingURL=64ac6e19568de891ca78ccbec0f0cfeaaf675e77-09002c87f957e68a306e.js.map