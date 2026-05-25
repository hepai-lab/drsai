"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[3490,8792],{

/***/ 49237:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ icons_PlusOutlined; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/@ant-design/icons-svg/es/asn/PlusOutlined.js
// This icon file is generated automatically.
var PlusOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M482 152h60q8 0 8 8v704q0 8-8 8h-60q-8 0-8-8V160q0-8 8-8z" } }, { "tag": "path", "attrs": { "d": "M192 474h672q8 0 8 8v60q0 8-8 8H160q-8 0-8-8v-60q0-8 8-8z" } }] }, "name": "plus", "theme": "outlined" };
/* harmony default export */ var asn_PlusOutlined = (PlusOutlined);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/PlusOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var PlusOutlined_PlusOutlined = function PlusOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_PlusOutlined
  }));
};

/**![plus](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTQ4MiAxNTJoNjBxOCAwIDggOHY3MDRxMCA4LTggOGgtNjBxLTggMC04LThWMTYwcTAtOCA4LTh6IiAvPjxwYXRoIGQ9Ik0xOTIgNDc0aDY3MnE4IDAgOCA4djYwcTAgOC04IDhIMTYwcS04IDAtOC04di02MHEwLTggOC04eiIgLz48L3N2Zz4=) */
var RefIcon = /*#__PURE__*/react.forwardRef(PlusOutlined_PlusOutlined);
if (false) {}
/* harmony default export */ var icons_PlusOutlined = (RefIcon);

/***/ }),

/***/ 10277:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ tabs; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CloseOutlined.js + 1 modules
var CloseOutlined = __webpack_require__(47852);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/EllipsisOutlined.js + 1 modules
var EllipsisOutlined = __webpack_require__(52318);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/PlusOutlined.js + 1 modules
var PlusOutlined = __webpack_require__(49237);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectSpread2.js
var objectSpread2 = __webpack_require__(89379);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/typeof.js
var esm_typeof = __webpack_require__(82284);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
var objectWithoutProperties = __webpack_require__(80045);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
// EXTERNAL MODULE: ./node_modules/rc-util/es/isMobile.js
var isMobile = __webpack_require__(68430);
;// ./node_modules/rc-tabs/es/TabContext.js

/* harmony default export */ var TabContext = (/*#__PURE__*/(0,react.createContext)(null));
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/rc-resize-observer/es/index.js + 5 modules
var es = __webpack_require__(18462);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useEvent.js
var useEvent = __webpack_require__(26956);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var es_ref = __webpack_require__(8719);
// EXTERNAL MODULE: ./node_modules/rc-util/es/raf.js
var raf = __webpack_require__(25371);
;// ./node_modules/rc-tabs/es/hooks/useIndicator.js



var useIndicator = function useIndicator(options) {
  var activeTabOffset = options.activeTabOffset,
    horizontal = options.horizontal,
    rtl = options.rtl,
    _options$indicator = options.indicator,
    indicator = _options$indicator === void 0 ? {} : _options$indicator;
  var size = indicator.size,
    _indicator$align = indicator.align,
    align = _indicator$align === void 0 ? 'center' : _indicator$align;
  var _useState = (0,react.useState)(),
    _useState2 = (0,slicedToArray/* default */.A)(_useState, 2),
    inkStyle = _useState2[0],
    setInkStyle = _useState2[1];
  var inkBarRafRef = (0,react.useRef)();
  var getLength = react.useCallback(function (origin) {
    if (typeof size === 'function') {
      return size(origin);
    }
    if (typeof size === 'number') {
      return size;
    }
    return origin;
  }, [size]);

  // Delay set ink style to avoid remove tab blink
  function cleanInkBarRaf() {
    raf/* default */.A.cancel(inkBarRafRef.current);
  }
  (0,react.useEffect)(function () {
    var newInkStyle = {};
    if (activeTabOffset) {
      if (horizontal) {
        newInkStyle.width = getLength(activeTabOffset.width);
        var key = rtl ? 'right' : 'left';
        if (align === 'start') {
          newInkStyle[key] = activeTabOffset[key];
        }
        if (align === 'center') {
          newInkStyle[key] = activeTabOffset[key] + activeTabOffset.width / 2;
          newInkStyle.transform = rtl ? 'translateX(50%)' : 'translateX(-50%)';
        }
        if (align === 'end') {
          newInkStyle[key] = activeTabOffset[key] + activeTabOffset.width;
          newInkStyle.transform = 'translateX(-100%)';
        }
      } else {
        newInkStyle.height = getLength(activeTabOffset.height);
        if (align === 'start') {
          newInkStyle.top = activeTabOffset.top;
        }
        if (align === 'center') {
          newInkStyle.top = activeTabOffset.top + activeTabOffset.height / 2;
          newInkStyle.transform = 'translateY(-50%)';
        }
        if (align === 'end') {
          newInkStyle.top = activeTabOffset.top + activeTabOffset.height;
          newInkStyle.transform = 'translateY(-100%)';
        }
      }
    }
    cleanInkBarRaf();
    inkBarRafRef.current = (0,raf/* default */.A)(function () {
      setInkStyle(newInkStyle);
    });
    return cleanInkBarRaf;
  }, [activeTabOffset, horizontal, rtl, align, getLength]);
  return {
    style: inkStyle
  };
};
/* harmony default export */ var hooks_useIndicator = (useIndicator);
;// ./node_modules/rc-tabs/es/hooks/useOffsets.js


var DEFAULT_SIZE = {
  width: 0,
  height: 0,
  left: 0,
  top: 0
};
function useOffsets(tabs, tabSizes, holderScrollWidth) {
  return (0,react.useMemo)(function () {
    var _tabs$;
    var map = new Map();
    var lastOffset = tabSizes.get((_tabs$ = tabs[0]) === null || _tabs$ === void 0 ? void 0 : _tabs$.key) || DEFAULT_SIZE;
    var rightOffset = lastOffset.left + lastOffset.width;
    for (var i = 0; i < tabs.length; i += 1) {
      var key = tabs[i].key;
      var data = tabSizes.get(key);

      // Reuse last one when not exist yet
      if (!data) {
        var _tabs;
        data = tabSizes.get((_tabs = tabs[i - 1]) === null || _tabs === void 0 ? void 0 : _tabs.key) || DEFAULT_SIZE;
      }
      var entity = map.get(key) || (0,objectSpread2/* default */.A)({}, data);

      // Right
      entity.right = rightOffset - entity.left - entity.width;

      // Update entity
      map.set(key, entity);
    }
    return map;
  }, [tabs.map(function (tab) {
    return tab.key;
  }).join('_'), tabSizes, holderScrollWidth]);
}
;// ./node_modules/rc-tabs/es/hooks/useSyncState.js


function useSyncState(defaultState, onChange) {
  var stateRef = react.useRef(defaultState);
  var _React$useState = react.useState({}),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    forceUpdate = _React$useState2[1];
  function setState(updater) {
    var newValue = typeof updater === 'function' ? updater(stateRef.current) : updater;
    if (newValue !== stateRef.current) {
      onChange(newValue, stateRef.current);
    }
    stateRef.current = newValue;
    forceUpdate({});
  }
  return [stateRef.current, setState];
}
;// ./node_modules/rc-tabs/es/hooks/useTouchMove.js



var MIN_SWIPE_DISTANCE = 0.1;
var STOP_SWIPE_DISTANCE = 0.01;
var REFRESH_INTERVAL = 20;
var SPEED_OFF_MULTIPLE = Math.pow(0.995, REFRESH_INTERVAL);

// ================================= Hook =================================
function useTouchMove(ref, onOffset) {
  var _useState = (0,react.useState)(),
    _useState2 = (0,slicedToArray/* default */.A)(_useState, 2),
    touchPosition = _useState2[0],
    setTouchPosition = _useState2[1];
  var _useState3 = (0,react.useState)(0),
    _useState4 = (0,slicedToArray/* default */.A)(_useState3, 2),
    lastTimestamp = _useState4[0],
    setLastTimestamp = _useState4[1];
  var _useState5 = (0,react.useState)(0),
    _useState6 = (0,slicedToArray/* default */.A)(_useState5, 2),
    lastTimeDiff = _useState6[0],
    setLastTimeDiff = _useState6[1];
  var _useState7 = (0,react.useState)(),
    _useState8 = (0,slicedToArray/* default */.A)(_useState7, 2),
    lastOffset = _useState8[0],
    setLastOffset = _useState8[1];
  var motionRef = (0,react.useRef)();

  // ========================= Events =========================
  // >>> Touch events
  function onTouchStart(e) {
    var _e$touches$ = e.touches[0],
      screenX = _e$touches$.screenX,
      screenY = _e$touches$.screenY;
    setTouchPosition({
      x: screenX,
      y: screenY
    });
    window.clearInterval(motionRef.current);
  }
  function onTouchMove(e) {
    if (!touchPosition) return;

    // e.preventDefault();
    var _e$touches$2 = e.touches[0],
      screenX = _e$touches$2.screenX,
      screenY = _e$touches$2.screenY;
    setTouchPosition({
      x: screenX,
      y: screenY
    });
    var offsetX = screenX - touchPosition.x;
    var offsetY = screenY - touchPosition.y;
    onOffset(offsetX, offsetY);
    var now = Date.now();
    setLastTimestamp(now);
    setLastTimeDiff(now - lastTimestamp);
    setLastOffset({
      x: offsetX,
      y: offsetY
    });
  }
  function onTouchEnd() {
    if (!touchPosition) return;
    setTouchPosition(null);
    setLastOffset(null);

    // Swipe if needed
    if (lastOffset) {
      var distanceX = lastOffset.x / lastTimeDiff;
      var distanceY = lastOffset.y / lastTimeDiff;
      var absX = Math.abs(distanceX);
      var absY = Math.abs(distanceY);

      // Skip swipe if low distance
      if (Math.max(absX, absY) < MIN_SWIPE_DISTANCE) return;
      var currentX = distanceX;
      var currentY = distanceY;
      motionRef.current = window.setInterval(function () {
        if (Math.abs(currentX) < STOP_SWIPE_DISTANCE && Math.abs(currentY) < STOP_SWIPE_DISTANCE) {
          window.clearInterval(motionRef.current);
          return;
        }
        currentX *= SPEED_OFF_MULTIPLE;
        currentY *= SPEED_OFF_MULTIPLE;
        onOffset(currentX * REFRESH_INTERVAL, currentY * REFRESH_INTERVAL);
      }, REFRESH_INTERVAL);
    }
  }

  // >>> Wheel event
  var lastWheelDirectionRef = (0,react.useRef)();
  function onWheel(e) {
    var deltaX = e.deltaX,
      deltaY = e.deltaY;

    // Convert both to x & y since wheel only happened on PC
    var mixed = 0;
    var absX = Math.abs(deltaX);
    var absY = Math.abs(deltaY);
    if (absX === absY) {
      mixed = lastWheelDirectionRef.current === 'x' ? deltaX : deltaY;
    } else if (absX > absY) {
      mixed = deltaX;
      lastWheelDirectionRef.current = 'x';
    } else {
      mixed = deltaY;
      lastWheelDirectionRef.current = 'y';
    }
    if (onOffset(-mixed, -mixed)) {
      e.preventDefault();
    }
  }

  // ========================= Effect =========================
  var touchEventsRef = (0,react.useRef)(null);
  touchEventsRef.current = {
    onTouchStart: onTouchStart,
    onTouchMove: onTouchMove,
    onTouchEnd: onTouchEnd,
    onWheel: onWheel
  };
  react.useEffect(function () {
    function onProxyTouchStart(e) {
      touchEventsRef.current.onTouchStart(e);
    }
    function onProxyTouchMove(e) {
      touchEventsRef.current.onTouchMove(e);
    }
    function onProxyTouchEnd(e) {
      touchEventsRef.current.onTouchEnd(e);
    }
    function onProxyWheel(e) {
      touchEventsRef.current.onWheel(e);
    }
    document.addEventListener('touchmove', onProxyTouchMove, {
      passive: false
    });
    document.addEventListener('touchend', onProxyTouchEnd, {
      passive: true
    });

    // No need to clean up since element removed
    ref.current.addEventListener('touchstart', onProxyTouchStart, {
      passive: true
    });
    ref.current.addEventListener('wheel', onProxyWheel, {
      passive: false
    });
    return function () {
      document.removeEventListener('touchmove', onProxyTouchMove);
      document.removeEventListener('touchend', onProxyTouchEnd);
    };
  }, []);
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useLayoutEffect.js
var useLayoutEffect = __webpack_require__(30981);
;// ./node_modules/rc-tabs/es/hooks/useUpdate.js




/**
 * Help to merge callback with `useLayoutEffect`.
 * One time will only trigger once.
 */
function useUpdate(callback) {
  var _useState = (0,react.useState)(0),
    _useState2 = (0,slicedToArray/* default */.A)(_useState, 2),
    count = _useState2[0],
    setCount = _useState2[1];
  var effectRef = (0,react.useRef)(0);
  var callbackRef = (0,react.useRef)();
  callbackRef.current = callback;

  // Trigger on `useLayoutEffect`
  (0,useLayoutEffect/* useLayoutUpdateEffect */.o)(function () {
    var _callbackRef$current;
    (_callbackRef$current = callbackRef.current) === null || _callbackRef$current === void 0 || _callbackRef$current.call(callbackRef);
  }, [count]);

  // Trigger to update count
  return function () {
    if (effectRef.current !== count) {
      return;
    }
    effectRef.current += 1;
    setCount(effectRef.current);
  };
}
function useUpdateState(defaultState) {
  var batchRef = (0,react.useRef)([]);
  var _useState3 = (0,react.useState)({}),
    _useState4 = (0,slicedToArray/* default */.A)(_useState3, 2),
    forceUpdate = _useState4[1];
  var state = (0,react.useRef)(typeof defaultState === 'function' ? defaultState() : defaultState);
  var flushUpdate = useUpdate(function () {
    var current = state.current;
    batchRef.current.forEach(function (callback) {
      current = callback(current);
    });
    batchRef.current = [];
    state.current = current;
    forceUpdate({});
  });
  function updater(callback) {
    batchRef.current.push(callback);
    flushUpdate();
  }
  return [state.current, updater];
}
;// ./node_modules/rc-tabs/es/hooks/useVisibleRange.js

var useVisibleRange_DEFAULT_SIZE = {
  width: 0,
  height: 0,
  left: 0,
  top: 0,
  right: 0
};
function useVisibleRange(tabOffsets, visibleTabContentValue, transform, tabContentSizeValue, addNodeSizeValue, operationNodeSizeValue, _ref) {
  var tabs = _ref.tabs,
    tabPosition = _ref.tabPosition,
    rtl = _ref.rtl;
  var charUnit;
  var position;
  var transformSize;
  if (['top', 'bottom'].includes(tabPosition)) {
    charUnit = 'width';
    position = rtl ? 'right' : 'left';
    transformSize = Math.abs(transform);
  } else {
    charUnit = 'height';
    position = 'top';
    transformSize = -transform;
  }
  return (0,react.useMemo)(function () {
    if (!tabs.length) {
      return [0, 0];
    }
    var len = tabs.length;
    var endIndex = len;
    for (var i = 0; i < len; i += 1) {
      var offset = tabOffsets.get(tabs[i].key) || useVisibleRange_DEFAULT_SIZE;
      if (Math.floor(offset[position] + offset[charUnit]) > Math.floor(transformSize + visibleTabContentValue)) {
        endIndex = i - 1;
        break;
      }
    }
    var startIndex = 0;
    for (var _i = len - 1; _i >= 0; _i -= 1) {
      var _offset = tabOffsets.get(tabs[_i].key) || useVisibleRange_DEFAULT_SIZE;
      if (_offset[position] < transformSize) {
        startIndex = _i + 1;
        break;
      }
    }
    return startIndex >= endIndex ? [0, 0] : [startIndex, endIndex];
  }, [tabOffsets, visibleTabContentValue, tabContentSizeValue, addNodeSizeValue, operationNodeSizeValue, transformSize, tabPosition, tabs.map(function (tab) {
    return tab.key;
  }).join('_'), rtl]);
}
;// ./node_modules/rc-tabs/es/util.js
/**
 * We trade Map as deps which may change with same value but different ref object.
 * We should make it as hash for deps
 * */
function stringify(obj) {
  var tgt;
  if (obj instanceof Map) {
    tgt = {};
    obj.forEach(function (v, k) {
      tgt[k] = v;
    });
  } else {
    tgt = obj;
  }
  return JSON.stringify(tgt);
}
var RC_TABS_DOUBLE_QUOTE = 'TABS_DQ';
function genDataNodeKey(key) {
  return String(key).replace(/"/g, RC_TABS_DOUBLE_QUOTE);
}
function getRemovable(closable, closeIcon, editable, disabled) {
  if (
  // Only editable tabs can be removed
  !editable ||
  // Tabs cannot be removed when disabled
  disabled ||
  // closable is false
  closable === false ||
  // If closable is undefined, the remove button should be hidden when closeIcon is null or false
  closable === undefined && (closeIcon === false || closeIcon === null)) {
    return false;
  }
  return true;
}
;// ./node_modules/rc-tabs/es/TabNavList/AddButton.js

var AddButton = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var prefixCls = props.prefixCls,
    editable = props.editable,
    locale = props.locale,
    style = props.style;
  if (!editable || editable.showAdd === false) {
    return null;
  }
  return /*#__PURE__*/react.createElement("button", {
    ref: ref,
    type: "button",
    className: "".concat(prefixCls, "-nav-add"),
    style: style,
    "aria-label": (locale === null || locale === void 0 ? void 0 : locale.addAriaLabel) || 'Add tab',
    onClick: function onClick(event) {
      editable.onEdit('add', {
        event: event
      });
    }
  }, editable.addIcon || '+');
});
/* harmony default export */ var TabNavList_AddButton = (AddButton);
;// ./node_modules/rc-tabs/es/TabNavList/ExtraContent.js


var ExtraContent = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var position = props.position,
    prefixCls = props.prefixCls,
    extra = props.extra;
  if (!extra) {
    return null;
  }
  var content;

  // Parse extra
  var assertExtra = {};
  if ((0,esm_typeof/* default */.A)(extra) === 'object' && ! /*#__PURE__*/react.isValidElement(extra)) {
    assertExtra = extra;
  } else {
    assertExtra.right = extra;
  }
  if (position === 'right') {
    content = assertExtra.right;
  }
  if (position === 'left') {
    content = assertExtra.left;
  }
  return content ? /*#__PURE__*/react.createElement("div", {
    className: "".concat(prefixCls, "-extra-content"),
    ref: ref
  }, content) : null;
});
if (false) {}
/* harmony default export */ var TabNavList_ExtraContent = (ExtraContent);
// EXTERNAL MODULE: ./node_modules/rc-dropdown/es/index.js + 4 modules
var rc_dropdown_es = __webpack_require__(3497);
// EXTERNAL MODULE: ./node_modules/rc-menu/es/index.js + 26 modules
var rc_menu_es = __webpack_require__(48810);
// EXTERNAL MODULE: ./node_modules/rc-util/es/KeyCode.js
var KeyCode = __webpack_require__(16928);
;// ./node_modules/rc-tabs/es/TabNavList/OperationNode.js











var OperationNode = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var prefixCls = props.prefixCls,
    id = props.id,
    tabs = props.tabs,
    locale = props.locale,
    mobile = props.mobile,
    _props$more = props.more,
    moreProps = _props$more === void 0 ? {} : _props$more,
    style = props.style,
    className = props.className,
    editable = props.editable,
    tabBarGutter = props.tabBarGutter,
    rtl = props.rtl,
    removeAriaLabel = props.removeAriaLabel,
    onTabClick = props.onTabClick,
    getPopupContainer = props.getPopupContainer,
    popupClassName = props.popupClassName;
  // ======================== Dropdown ========================
  var _useState = (0,react.useState)(false),
    _useState2 = (0,slicedToArray/* default */.A)(_useState, 2),
    open = _useState2[0],
    setOpen = _useState2[1];
  var _useState3 = (0,react.useState)(null),
    _useState4 = (0,slicedToArray/* default */.A)(_useState3, 2),
    selectedKey = _useState4[0],
    setSelectedKey = _useState4[1];
  var _moreProps$icon = moreProps.icon,
    moreIcon = _moreProps$icon === void 0 ? 'More' : _moreProps$icon;
  var popupId = "".concat(id, "-more-popup");
  var dropdownPrefix = "".concat(prefixCls, "-dropdown");
  var selectedItemId = selectedKey !== null ? "".concat(popupId, "-").concat(selectedKey) : null;
  var dropdownAriaLabel = locale === null || locale === void 0 ? void 0 : locale.dropdownAriaLabel;
  function onRemoveTab(event, key) {
    event.preventDefault();
    event.stopPropagation();
    editable.onEdit('remove', {
      key: key,
      event: event
    });
  }
  var menu = /*#__PURE__*/react.createElement(rc_menu_es/* default */.Ay, {
    onClick: function onClick(_ref) {
      var key = _ref.key,
        domEvent = _ref.domEvent;
      onTabClick(key, domEvent);
      setOpen(false);
    },
    prefixCls: "".concat(dropdownPrefix, "-menu"),
    id: popupId,
    tabIndex: -1,
    role: "listbox",
    "aria-activedescendant": selectedItemId,
    selectedKeys: [selectedKey],
    "aria-label": dropdownAriaLabel !== undefined ? dropdownAriaLabel : 'expanded dropdown'
  }, tabs.map(function (tab) {
    var closable = tab.closable,
      disabled = tab.disabled,
      closeIcon = tab.closeIcon,
      key = tab.key,
      label = tab.label;
    var removable = getRemovable(closable, closeIcon, editable, disabled);
    return /*#__PURE__*/react.createElement(rc_menu_es/* MenuItem */.Dr, {
      key: key,
      id: "".concat(popupId, "-").concat(key),
      role: "option",
      "aria-controls": id && "".concat(id, "-panel-").concat(key),
      disabled: disabled
    }, /*#__PURE__*/react.createElement("span", null, label), removable && /*#__PURE__*/react.createElement("button", {
      type: "button",
      "aria-label": removeAriaLabel || 'remove',
      tabIndex: 0,
      className: "".concat(dropdownPrefix, "-menu-item-remove"),
      onClick: function onClick(e) {
        e.stopPropagation();
        onRemoveTab(e, key);
      }
    }, closeIcon || editable.removeIcon || '×'));
  }));
  function selectOffset(offset) {
    var enabledTabs = tabs.filter(function (tab) {
      return !tab.disabled;
    });
    var selectedIndex = enabledTabs.findIndex(function (tab) {
      return tab.key === selectedKey;
    }) || 0;
    var len = enabledTabs.length;
    for (var i = 0; i < len; i += 1) {
      selectedIndex = (selectedIndex + offset + len) % len;
      var tab = enabledTabs[selectedIndex];
      if (!tab.disabled) {
        setSelectedKey(tab.key);
        return;
      }
    }
  }
  function onKeyDown(e) {
    var which = e.which;
    if (!open) {
      if ([KeyCode/* default */.A.DOWN, KeyCode/* default */.A.SPACE, KeyCode/* default */.A.ENTER].includes(which)) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (which) {
      case KeyCode/* default */.A.UP:
        selectOffset(-1);
        e.preventDefault();
        break;
      case KeyCode/* default */.A.DOWN:
        selectOffset(1);
        e.preventDefault();
        break;
      case KeyCode/* default */.A.ESC:
        setOpen(false);
        break;
      case KeyCode/* default */.A.SPACE:
      case KeyCode/* default */.A.ENTER:
        if (selectedKey !== null) {
          onTabClick(selectedKey, e);
        }
        break;
    }
  }

  // ========================= Effect =========================
  (0,react.useEffect)(function () {
    // We use query element here to avoid React strict warning
    var ele = document.getElementById(selectedItemId);
    if (ele && ele.scrollIntoView) {
      ele.scrollIntoView(false);
    }
  }, [selectedKey]);
  (0,react.useEffect)(function () {
    if (!open) {
      setSelectedKey(null);
    }
  }, [open]);

  // ========================= Render =========================
  var moreStyle = (0,defineProperty/* default */.A)({}, rtl ? 'marginRight' : 'marginLeft', tabBarGutter);
  if (!tabs.length) {
    moreStyle.visibility = 'hidden';
    moreStyle.order = 1;
  }
  var overlayClassName = classnames_default()((0,defineProperty/* default */.A)({}, "".concat(dropdownPrefix, "-rtl"), rtl));
  var moreNode = mobile ? null : /*#__PURE__*/react.createElement(rc_dropdown_es/* default */.A, (0,esm_extends/* default */.A)({
    prefixCls: dropdownPrefix,
    overlay: menu,
    visible: tabs.length ? open : false,
    onVisibleChange: setOpen,
    overlayClassName: classnames_default()(overlayClassName, popupClassName),
    mouseEnterDelay: 0.1,
    mouseLeaveDelay: 0.1,
    getPopupContainer: getPopupContainer
  }, moreProps), /*#__PURE__*/react.createElement("button", {
    type: "button",
    className: "".concat(prefixCls, "-nav-more"),
    style: moreStyle,
    tabIndex: -1,
    "aria-hidden": "true",
    "aria-haspopup": "listbox",
    "aria-controls": popupId,
    id: "".concat(id, "-more"),
    "aria-expanded": open,
    onKeyDown: onKeyDown
  }, moreIcon));
  return /*#__PURE__*/react.createElement("div", {
    className: classnames_default()("".concat(prefixCls, "-nav-operations"), className),
    style: style,
    ref: ref
  }, moreNode, /*#__PURE__*/react.createElement(TabNavList_AddButton, {
    prefixCls: prefixCls,
    locale: locale,
    editable: editable
  }));
});
/* harmony default export */ var TabNavList_OperationNode = (/*#__PURE__*/react.memo(OperationNode, function (_, next) {
  return (
    // https://github.com/ant-design/ant-design/issues/32544
    // We'd better remove syntactic sugar in `rc-menu` since this has perf issue
    next.tabMoving
  );
}));
;// ./node_modules/rc-tabs/es/TabNavList/TabNode.js





var TabNode = function TabNode(props) {
  var prefixCls = props.prefixCls,
    id = props.id,
    active = props.active,
    _props$tab = props.tab,
    key = _props$tab.key,
    label = _props$tab.label,
    disabled = _props$tab.disabled,
    closeIcon = _props$tab.closeIcon,
    icon = _props$tab.icon,
    closable = props.closable,
    renderWrapper = props.renderWrapper,
    removeAriaLabel = props.removeAriaLabel,
    editable = props.editable,
    onClick = props.onClick,
    onFocus = props.onFocus,
    style = props.style;
  var tabPrefix = "".concat(prefixCls, "-tab");
  var removable = getRemovable(closable, closeIcon, editable, disabled);
  function onInternalClick(e) {
    if (disabled) {
      return;
    }
    onClick(e);
  }
  function onRemoveTab(event) {
    event.preventDefault();
    event.stopPropagation();
    editable.onEdit('remove', {
      key: key,
      event: event
    });
  }
  var labelNode = react.useMemo(function () {
    return icon && typeof label === 'string' ? /*#__PURE__*/react.createElement("span", null, label) : label;
  }, [label, icon]);
  var node = /*#__PURE__*/react.createElement("div", {
    key: key
    // ref={ref}
    ,
    "data-node-key": genDataNodeKey(key),
    className: classnames_default()(tabPrefix, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(tabPrefix, "-with-remove"), removable), "".concat(tabPrefix, "-active"), active), "".concat(tabPrefix, "-disabled"), disabled)),
    style: style,
    onClick: onInternalClick
  }, /*#__PURE__*/react.createElement("div", {
    role: "tab",
    "aria-selected": active,
    id: id && "".concat(id, "-tab-").concat(key),
    className: "".concat(tabPrefix, "-btn"),
    "aria-controls": id && "".concat(id, "-panel-").concat(key),
    "aria-disabled": disabled,
    tabIndex: disabled ? null : 0,
    onClick: function onClick(e) {
      e.stopPropagation();
      onInternalClick(e);
    },
    onKeyDown: function onKeyDown(e) {
      if ([KeyCode/* default */.A.SPACE, KeyCode/* default */.A.ENTER].includes(e.which)) {
        e.preventDefault();
        onInternalClick(e);
      }
    },
    onFocus: onFocus
  }, icon && /*#__PURE__*/react.createElement("span", {
    className: "".concat(tabPrefix, "-icon")
  }, icon), label && labelNode), removable && /*#__PURE__*/react.createElement("button", {
    type: "button",
    "aria-label": removeAriaLabel || 'remove',
    tabIndex: 0,
    className: "".concat(tabPrefix, "-remove"),
    onClick: function onClick(e) {
      e.stopPropagation();
      onRemoveTab(e);
    }
  }, closeIcon || editable.removeIcon || '×'));
  return renderWrapper ? renderWrapper(node) : node;
};
/* harmony default export */ var TabNavList_TabNode = (TabNode);
;// ./node_modules/rc-tabs/es/TabNavList/index.js





/* eslint-disable react-hooks/exhaustive-deps */


















var getTabSize = function getTabSize(tab, containerRect) {
  // tabListRef
  var offsetWidth = tab.offsetWidth,
    offsetHeight = tab.offsetHeight,
    offsetTop = tab.offsetTop,
    offsetLeft = tab.offsetLeft;
  var _tab$getBoundingClien = tab.getBoundingClientRect(),
    width = _tab$getBoundingClien.width,
    height = _tab$getBoundingClien.height,
    left = _tab$getBoundingClien.left,
    top = _tab$getBoundingClien.top;

  // Use getBoundingClientRect to avoid decimal inaccuracy
  if (Math.abs(width - offsetWidth) < 1) {
    return [width, height, left - containerRect.left, top - containerRect.top];
  }
  return [offsetWidth, offsetHeight, offsetLeft, offsetTop];
};
var getSize = function getSize(refObj) {
  var _ref = refObj.current || {},
    _ref$offsetWidth = _ref.offsetWidth,
    offsetWidth = _ref$offsetWidth === void 0 ? 0 : _ref$offsetWidth,
    _ref$offsetHeight = _ref.offsetHeight,
    offsetHeight = _ref$offsetHeight === void 0 ? 0 : _ref$offsetHeight;

  // Use getBoundingClientRect to avoid decimal inaccuracy
  if (refObj.current) {
    var _refObj$current$getBo = refObj.current.getBoundingClientRect(),
      width = _refObj$current$getBo.width,
      height = _refObj$current$getBo.height;
    if (Math.abs(width - offsetWidth) < 1) {
      return [width, height];
    }
  }
  return [offsetWidth, offsetHeight];
};

/**
 * Convert `SizeInfo` to unit value. Such as [123, 456] with `top` position get `123`
 */
var getUnitValue = function getUnitValue(size, tabPositionTopOrBottom) {
  return size[tabPositionTopOrBottom ? 0 : 1];
};
var TabNavList = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var className = props.className,
    style = props.style,
    id = props.id,
    animated = props.animated,
    activeKey = props.activeKey,
    rtl = props.rtl,
    extra = props.extra,
    editable = props.editable,
    locale = props.locale,
    tabPosition = props.tabPosition,
    tabBarGutter = props.tabBarGutter,
    children = props.children,
    onTabClick = props.onTabClick,
    onTabScroll = props.onTabScroll,
    indicator = props.indicator;
  var _React$useContext = react.useContext(TabContext),
    prefixCls = _React$useContext.prefixCls,
    tabs = _React$useContext.tabs;
  var containerRef = (0,react.useRef)(null);
  var extraLeftRef = (0,react.useRef)(null);
  var extraRightRef = (0,react.useRef)(null);
  var tabsWrapperRef = (0,react.useRef)(null);
  var tabListRef = (0,react.useRef)(null);
  var operationsRef = (0,react.useRef)(null);
  var innerAddButtonRef = (0,react.useRef)(null);
  var tabPositionTopOrBottom = tabPosition === 'top' || tabPosition === 'bottom';
  var _useSyncState = useSyncState(0, function (next, prev) {
      if (tabPositionTopOrBottom && onTabScroll) {
        onTabScroll({
          direction: next > prev ? 'left' : 'right'
        });
      }
    }),
    _useSyncState2 = (0,slicedToArray/* default */.A)(_useSyncState, 2),
    transformLeft = _useSyncState2[0],
    setTransformLeft = _useSyncState2[1];
  var _useSyncState3 = useSyncState(0, function (next, prev) {
      if (!tabPositionTopOrBottom && onTabScroll) {
        onTabScroll({
          direction: next > prev ? 'top' : 'bottom'
        });
      }
    }),
    _useSyncState4 = (0,slicedToArray/* default */.A)(_useSyncState3, 2),
    transformTop = _useSyncState4[0],
    setTransformTop = _useSyncState4[1];
  var _useState = (0,react.useState)([0, 0]),
    _useState2 = (0,slicedToArray/* default */.A)(_useState, 2),
    containerExcludeExtraSize = _useState2[0],
    setContainerExcludeExtraSize = _useState2[1];
  var _useState3 = (0,react.useState)([0, 0]),
    _useState4 = (0,slicedToArray/* default */.A)(_useState3, 2),
    tabContentSize = _useState4[0],
    setTabContentSize = _useState4[1];
  var _useState5 = (0,react.useState)([0, 0]),
    _useState6 = (0,slicedToArray/* default */.A)(_useState5, 2),
    addSize = _useState6[0],
    setAddSize = _useState6[1];
  var _useState7 = (0,react.useState)([0, 0]),
    _useState8 = (0,slicedToArray/* default */.A)(_useState7, 2),
    operationSize = _useState8[0],
    setOperationSize = _useState8[1];
  var _useUpdateState = useUpdateState(new Map()),
    _useUpdateState2 = (0,slicedToArray/* default */.A)(_useUpdateState, 2),
    tabSizes = _useUpdateState2[0],
    setTabSizes = _useUpdateState2[1];
  var tabOffsets = useOffsets(tabs, tabSizes, tabContentSize[0]);

  // ========================== Unit =========================
  var containerExcludeExtraSizeValue = getUnitValue(containerExcludeExtraSize, tabPositionTopOrBottom);
  var tabContentSizeValue = getUnitValue(tabContentSize, tabPositionTopOrBottom);
  var addSizeValue = getUnitValue(addSize, tabPositionTopOrBottom);
  var operationSizeValue = getUnitValue(operationSize, tabPositionTopOrBottom);
  var needScroll = Math.floor(containerExcludeExtraSizeValue) < Math.floor(tabContentSizeValue + addSizeValue);
  var visibleTabContentValue = needScroll ? containerExcludeExtraSizeValue - operationSizeValue : containerExcludeExtraSizeValue - addSizeValue;

  // ========================== Util =========================
  var operationsHiddenClassName = "".concat(prefixCls, "-nav-operations-hidden");
  var transformMin = 0;
  var transformMax = 0;
  if (!tabPositionTopOrBottom) {
    transformMin = Math.min(0, visibleTabContentValue - tabContentSizeValue);
    transformMax = 0;
  } else if (rtl) {
    transformMin = 0;
    transformMax = Math.max(0, tabContentSizeValue - visibleTabContentValue);
  } else {
    transformMin = Math.min(0, visibleTabContentValue - tabContentSizeValue);
    transformMax = 0;
  }
  function alignInRange(value) {
    if (value < transformMin) {
      return transformMin;
    }
    if (value > transformMax) {
      return transformMax;
    }
    return value;
  }

  // ========================= Mobile ========================
  var touchMovingRef = (0,react.useRef)(null);
  var _useState9 = (0,react.useState)(),
    _useState10 = (0,slicedToArray/* default */.A)(_useState9, 2),
    lockAnimation = _useState10[0],
    setLockAnimation = _useState10[1];
  function doLockAnimation() {
    setLockAnimation(Date.now());
  }
  function clearTouchMoving() {
    if (touchMovingRef.current) {
      clearTimeout(touchMovingRef.current);
    }
  }
  useTouchMove(tabsWrapperRef, function (offsetX, offsetY) {
    function doMove(setState, offset) {
      setState(function (value) {
        var newValue = alignInRange(value + offset);
        return newValue;
      });
    }

    // Skip scroll if place is enough
    if (!needScroll) {
      return false;
    }
    if (tabPositionTopOrBottom) {
      doMove(setTransformLeft, offsetX);
    } else {
      doMove(setTransformTop, offsetY);
    }
    clearTouchMoving();
    doLockAnimation();
    return true;
  });
  (0,react.useEffect)(function () {
    clearTouchMoving();
    if (lockAnimation) {
      touchMovingRef.current = setTimeout(function () {
        setLockAnimation(0);
      }, 100);
    }
    return clearTouchMoving;
  }, [lockAnimation]);

  // ===================== Visible Range =====================
  // Render tab node & collect tab offset
  var _useVisibleRange = useVisibleRange(tabOffsets,
    // Container
    visibleTabContentValue,
    // Transform
    tabPositionTopOrBottom ? transformLeft : transformTop,
    // Tabs
    tabContentSizeValue,
    // Add
    addSizeValue,
    // Operation
    operationSizeValue, (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, props), {}, {
      tabs: tabs
    })),
    _useVisibleRange2 = (0,slicedToArray/* default */.A)(_useVisibleRange, 2),
    visibleStart = _useVisibleRange2[0],
    visibleEnd = _useVisibleRange2[1];

  // ========================= Scroll ========================
  var scrollToTab = (0,useEvent/* default */.A)(function () {
    var key = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : activeKey;
    var tabOffset = tabOffsets.get(key) || {
      width: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0
    };
    if (tabPositionTopOrBottom) {
      // ============ Align with top & bottom ============
      var newTransform = transformLeft;

      // RTL
      if (rtl) {
        if (tabOffset.right < transformLeft) {
          newTransform = tabOffset.right;
        } else if (tabOffset.right + tabOffset.width > transformLeft + visibleTabContentValue) {
          newTransform = tabOffset.right + tabOffset.width - visibleTabContentValue;
        }
      }
      // LTR
      else if (tabOffset.left < -transformLeft) {
        newTransform = -tabOffset.left;
      } else if (tabOffset.left + tabOffset.width > -transformLeft + visibleTabContentValue) {
        newTransform = -(tabOffset.left + tabOffset.width - visibleTabContentValue);
      }
      setTransformTop(0);
      setTransformLeft(alignInRange(newTransform));
    } else {
      // ============ Align with left & right ============
      var _newTransform = transformTop;
      if (tabOffset.top < -transformTop) {
        _newTransform = -tabOffset.top;
      } else if (tabOffset.top + tabOffset.height > -transformTop + visibleTabContentValue) {
        _newTransform = -(tabOffset.top + tabOffset.height - visibleTabContentValue);
      }
      setTransformLeft(0);
      setTransformTop(alignInRange(_newTransform));
    }
  });

  // ========================== Tab ==========================
  var tabNodeStyle = {};
  if (tabPosition === 'top' || tabPosition === 'bottom') {
    tabNodeStyle[rtl ? 'marginRight' : 'marginLeft'] = tabBarGutter;
  } else {
    tabNodeStyle.marginTop = tabBarGutter;
  }
  var tabNodes = tabs.map(function (tab, i) {
    var key = tab.key;
    return /*#__PURE__*/react.createElement(TabNavList_TabNode, {
      id: id,
      prefixCls: prefixCls,
      key: key,
      tab: tab
      /* first node should not have margin left */,
      style: i === 0 ? undefined : tabNodeStyle,
      closable: tab.closable,
      editable: editable,
      active: key === activeKey,
      renderWrapper: children,
      removeAriaLabel: locale === null || locale === void 0 ? void 0 : locale.removeAriaLabel,
      onClick: function onClick(e) {
        onTabClick(key, e);
      },
      onFocus: function onFocus() {
        scrollToTab(key);
        doLockAnimation();
        if (!tabsWrapperRef.current) {
          return;
        }
        // Focus element will make scrollLeft change which we should reset back
        if (!rtl) {
          tabsWrapperRef.current.scrollLeft = 0;
        }
        tabsWrapperRef.current.scrollTop = 0;
      }
    });
  });

  // Update buttons records
  var updateTabSizes = function updateTabSizes() {
    return setTabSizes(function () {
      var _tabListRef$current;
      var newSizes = new Map();
      var listRect = (_tabListRef$current = tabListRef.current) === null || _tabListRef$current === void 0 ? void 0 : _tabListRef$current.getBoundingClientRect();
      tabs.forEach(function (_ref2) {
        var _tabListRef$current2;
        var key = _ref2.key;
        var btnNode = (_tabListRef$current2 = tabListRef.current) === null || _tabListRef$current2 === void 0 ? void 0 : _tabListRef$current2.querySelector("[data-node-key=\"".concat(genDataNodeKey(key), "\"]"));
        if (btnNode) {
          var _getTabSize = getTabSize(btnNode, listRect),
            _getTabSize2 = (0,slicedToArray/* default */.A)(_getTabSize, 4),
            width = _getTabSize2[0],
            height = _getTabSize2[1],
            left = _getTabSize2[2],
            top = _getTabSize2[3];
          newSizes.set(key, {
            width: width,
            height: height,
            left: left,
            top: top
          });
        }
      });
      return newSizes;
    });
  };
  (0,react.useEffect)(function () {
    updateTabSizes();
  }, [tabs.map(function (tab) {
    return tab.key;
  }).join('_')]);
  var onListHolderResize = useUpdate(function () {
    // Update wrapper records
    var containerSize = getSize(containerRef);
    var extraLeftSize = getSize(extraLeftRef);
    var extraRightSize = getSize(extraRightRef);
    setContainerExcludeExtraSize([containerSize[0] - extraLeftSize[0] - extraRightSize[0], containerSize[1] - extraLeftSize[1] - extraRightSize[1]]);
    var newAddSize = getSize(innerAddButtonRef);
    setAddSize(newAddSize);
    var newOperationSize = getSize(operationsRef);
    setOperationSize(newOperationSize);

    // Which includes add button size
    var tabContentFullSize = getSize(tabListRef);
    setTabContentSize([tabContentFullSize[0] - newAddSize[0], tabContentFullSize[1] - newAddSize[1]]);

    // Update buttons records
    updateTabSizes();
  });

  // ======================== Dropdown =======================
  var startHiddenTabs = tabs.slice(0, visibleStart);
  var endHiddenTabs = tabs.slice(visibleEnd + 1);
  var hiddenTabs = [].concat((0,toConsumableArray/* default */.A)(startHiddenTabs), (0,toConsumableArray/* default */.A)(endHiddenTabs));

  // =================== Link & Operations ===================
  var activeTabOffset = tabOffsets.get(activeKey);
  var _useIndicator = hooks_useIndicator({
      activeTabOffset: activeTabOffset,
      horizontal: tabPositionTopOrBottom,
      indicator: indicator,
      rtl: rtl
    }),
    indicatorStyle = _useIndicator.style;

  // ========================= Effect ========================
  (0,react.useEffect)(function () {
    scrollToTab();
  }, [activeKey, transformMin, transformMax, stringify(activeTabOffset), stringify(tabOffsets), tabPositionTopOrBottom]);

  // Should recalculate when rtl changed
  (0,react.useEffect)(function () {
    onListHolderResize();
    // eslint-disable-next-line
  }, [rtl]);

  // ========================= Render ========================
  var hasDropdown = !!hiddenTabs.length;
  var wrapPrefix = "".concat(prefixCls, "-nav-wrap");
  var pingLeft;
  var pingRight;
  var pingTop;
  var pingBottom;
  if (tabPositionTopOrBottom) {
    if (rtl) {
      pingRight = transformLeft > 0;
      pingLeft = transformLeft !== transformMax;
    } else {
      pingLeft = transformLeft < 0;
      pingRight = transformLeft !== transformMin;
    }
  } else {
    pingTop = transformTop < 0;
    pingBottom = transformTop !== transformMin;
  }
  return /*#__PURE__*/react.createElement(es/* default */.A, {
    onResize: onListHolderResize
  }, /*#__PURE__*/react.createElement("div", {
    ref: (0,es_ref/* useComposeRef */.xK)(ref, containerRef),
    role: "tablist",
    className: classnames_default()("".concat(prefixCls, "-nav"), className),
    style: style,
    onKeyDown: function onKeyDown() {
      // No need animation when use keyboard
      doLockAnimation();
    }
  }, /*#__PURE__*/react.createElement(TabNavList_ExtraContent, {
    ref: extraLeftRef,
    position: "left",
    extra: extra,
    prefixCls: prefixCls
  }), /*#__PURE__*/react.createElement(es/* default */.A, {
    onResize: onListHolderResize
  }, /*#__PURE__*/react.createElement("div", {
    className: classnames_default()(wrapPrefix, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(wrapPrefix, "-ping-left"), pingLeft), "".concat(wrapPrefix, "-ping-right"), pingRight), "".concat(wrapPrefix, "-ping-top"), pingTop), "".concat(wrapPrefix, "-ping-bottom"), pingBottom)),
    ref: tabsWrapperRef
  }, /*#__PURE__*/react.createElement(es/* default */.A, {
    onResize: onListHolderResize
  }, /*#__PURE__*/react.createElement("div", {
    ref: tabListRef,
    className: "".concat(prefixCls, "-nav-list"),
    style: {
      transform: "translate(".concat(transformLeft, "px, ").concat(transformTop, "px)"),
      transition: lockAnimation ? 'none' : undefined
    }
  }, tabNodes, /*#__PURE__*/react.createElement(TabNavList_AddButton, {
    ref: innerAddButtonRef,
    prefixCls: prefixCls,
    locale: locale,
    editable: editable,
    style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, tabNodes.length === 0 ? undefined : tabNodeStyle), {}, {
      visibility: hasDropdown ? 'hidden' : null
    })
  }), /*#__PURE__*/react.createElement("div", {
    className: classnames_default()("".concat(prefixCls, "-ink-bar"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-ink-bar-animated"), animated.inkBar)),
    style: indicatorStyle
  }))))), /*#__PURE__*/react.createElement(TabNavList_OperationNode, (0,esm_extends/* default */.A)({}, props, {
    removeAriaLabel: locale === null || locale === void 0 ? void 0 : locale.removeAriaLabel,
    ref: operationsRef,
    prefixCls: prefixCls,
    tabs: hiddenTabs,
    className: !hasDropdown && operationsHiddenClassName,
    tabMoving: !!lockAnimation
  })), /*#__PURE__*/react.createElement(TabNavList_ExtraContent, {
    ref: extraRightRef,
    position: "right",
    extra: extra,
    prefixCls: prefixCls
  })));
  /* eslint-enable */
});
/* harmony default export */ var es_TabNavList = (TabNavList);
;// ./node_modules/rc-tabs/es/TabPanelList/TabPane.js


var TabPane = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var prefixCls = props.prefixCls,
    className = props.className,
    style = props.style,
    id = props.id,
    active = props.active,
    tabKey = props.tabKey,
    children = props.children;
  return /*#__PURE__*/react.createElement("div", {
    id: id && "".concat(id, "-panel-").concat(tabKey),
    role: "tabpanel",
    tabIndex: active ? 0 : -1,
    "aria-labelledby": id && "".concat(id, "-tab-").concat(tabKey),
    "aria-hidden": !active,
    style: style,
    className: classnames_default()(prefixCls, active && "".concat(prefixCls, "-active"), className),
    ref: ref
  }, children);
});
if (false) {}
/* harmony default export */ var TabPanelList_TabPane = (TabPane);
;// ./node_modules/rc-tabs/es/TabNavList/Wrapper.js



var _excluded = ["renderTabBar"],
  _excluded2 = ["label", "key"];
// zombieJ: To compatible with `renderTabBar` usage.





// We have to create a TabNavList components.
var TabNavListWrapper = function TabNavListWrapper(_ref) {
  var renderTabBar = _ref.renderTabBar,
    restProps = (0,objectWithoutProperties/* default */.A)(_ref, _excluded);
  var _React$useContext = react.useContext(TabContext),
    tabs = _React$useContext.tabs;
  if (renderTabBar) {
    var tabNavBarProps = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, restProps), {}, {
      // Legacy support. We do not use this actually
      panes: tabs.map(function (_ref2) {
        var label = _ref2.label,
          key = _ref2.key,
          restTabProps = (0,objectWithoutProperties/* default */.A)(_ref2, _excluded2);
        return /*#__PURE__*/react.createElement(TabPanelList_TabPane, (0,esm_extends/* default */.A)({
          tab: label,
          key: key,
          tabKey: key
        }, restTabProps));
      })
    });
    return renderTabBar(tabNavBarProps, es_TabNavList);
  }
  return /*#__PURE__*/react.createElement(es_TabNavList, restProps);
};
if (false) {}
/* harmony default export */ var Wrapper = (TabNavListWrapper);
// EXTERNAL MODULE: ./node_modules/rc-motion/es/index.js + 13 modules
var rc_motion_es = __webpack_require__(90754);
;// ./node_modules/rc-tabs/es/TabPanelList/index.js




var TabPanelList_excluded = ["key", "forceRender", "style", "className", "destroyInactiveTabPane"];





var TabPanelList = function TabPanelList(props) {
  var id = props.id,
    activeKey = props.activeKey,
    animated = props.animated,
    tabPosition = props.tabPosition,
    destroyInactiveTabPane = props.destroyInactiveTabPane;
  var _React$useContext = react.useContext(TabContext),
    prefixCls = _React$useContext.prefixCls,
    tabs = _React$useContext.tabs;
  var tabPaneAnimated = animated.tabPane;
  var tabPanePrefixCls = "".concat(prefixCls, "-tabpane");
  return /*#__PURE__*/react.createElement("div", {
    className: classnames_default()("".concat(prefixCls, "-content-holder"))
  }, /*#__PURE__*/react.createElement("div", {
    className: classnames_default()("".concat(prefixCls, "-content"), "".concat(prefixCls, "-content-").concat(tabPosition), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-content-animated"), tabPaneAnimated))
  }, tabs.map(function (item) {
    var key = item.key,
      forceRender = item.forceRender,
      paneStyle = item.style,
      paneClassName = item.className,
      itemDestroyInactiveTabPane = item.destroyInactiveTabPane,
      restTabProps = (0,objectWithoutProperties/* default */.A)(item, TabPanelList_excluded);
    var active = key === activeKey;
    return /*#__PURE__*/react.createElement(rc_motion_es/* default */.Ay, (0,esm_extends/* default */.A)({
      key: key,
      visible: active,
      forceRender: forceRender,
      removeOnLeave: !!(destroyInactiveTabPane || itemDestroyInactiveTabPane),
      leavedClassName: "".concat(tabPanePrefixCls, "-hidden")
    }, animated.tabPaneMotion), function (_ref, ref) {
      var motionStyle = _ref.style,
        motionClassName = _ref.className;
      return /*#__PURE__*/react.createElement(TabPanelList_TabPane, (0,esm_extends/* default */.A)({}, restTabProps, {
        prefixCls: tabPanePrefixCls,
        id: id,
        tabKey: key,
        animated: tabPaneAnimated,
        active: active,
        style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, paneStyle), motionStyle),
        className: classnames_default()(paneClassName, motionClassName),
        ref: ref
      }));
    });
  })));
};
/* harmony default export */ var es_TabPanelList = (TabPanelList);
// EXTERNAL MODULE: ./node_modules/rc-util/es/warning.js
var warning = __webpack_require__(68210);
;// ./node_modules/rc-tabs/es/hooks/useAnimateConfig.js



function useAnimateConfig() {
  var animated = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {
    inkBar: true,
    tabPane: false
  };
  var mergedAnimated;
  if (animated === false) {
    mergedAnimated = {
      inkBar: false,
      tabPane: false
    };
  } else if (animated === true) {
    mergedAnimated = {
      inkBar: true,
      tabPane: false
    };
  } else {
    mergedAnimated = (0,objectSpread2/* default */.A)({
      inkBar: true
    }, (0,esm_typeof/* default */.A)(animated) === 'object' ? animated : {});
  }

  // Enable tabPane animation if provide motion
  if (mergedAnimated.tabPaneMotion && mergedAnimated.tabPane === undefined) {
    mergedAnimated.tabPane = true;
  }
  if (!mergedAnimated.tabPaneMotion && mergedAnimated.tabPane) {
    if (false) {}
    mergedAnimated.tabPane = false;
  }
  return mergedAnimated;
}
;// ./node_modules/rc-tabs/es/Tabs.js






var Tabs_excluded = ["id", "prefixCls", "className", "items", "direction", "activeKey", "defaultActiveKey", "editable", "animated", "tabPosition", "tabBarGutter", "tabBarStyle", "tabBarExtraContent", "locale", "more", "destroyInactiveTabPane", "renderTabBar", "onChange", "onTabClick", "onTabScroll", "getPopupContainer", "popupClassName", "indicator"];
// Accessibility https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/Tab_Role









/**
 * Should added antd:
 * - type
 *
 * Removed:
 * - onNextClick
 * - onPrevClick
 * - keyboard
 */

// Used for accessibility
var uuid = 0;
var Tabs = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var id = props.id,
    _props$prefixCls = props.prefixCls,
    prefixCls = _props$prefixCls === void 0 ? 'rc-tabs' : _props$prefixCls,
    className = props.className,
    items = props.items,
    direction = props.direction,
    activeKey = props.activeKey,
    defaultActiveKey = props.defaultActiveKey,
    editable = props.editable,
    animated = props.animated,
    _props$tabPosition = props.tabPosition,
    tabPosition = _props$tabPosition === void 0 ? 'top' : _props$tabPosition,
    tabBarGutter = props.tabBarGutter,
    tabBarStyle = props.tabBarStyle,
    tabBarExtraContent = props.tabBarExtraContent,
    locale = props.locale,
    more = props.more,
    destroyInactiveTabPane = props.destroyInactiveTabPane,
    renderTabBar = props.renderTabBar,
    onChange = props.onChange,
    onTabClick = props.onTabClick,
    onTabScroll = props.onTabScroll,
    getPopupContainer = props.getPopupContainer,
    popupClassName = props.popupClassName,
    indicator = props.indicator,
    restProps = (0,objectWithoutProperties/* default */.A)(props, Tabs_excluded);
  var tabs = react.useMemo(function () {
    return (items || []).filter(function (item) {
      return item && (0,esm_typeof/* default */.A)(item) === 'object' && 'key' in item;
    });
  }, [items]);
  var rtl = direction === 'rtl';
  var mergedAnimated = useAnimateConfig(animated);

  // ======================== Mobile ========================
  var _useState = (0,react.useState)(false),
    _useState2 = (0,slicedToArray/* default */.A)(_useState, 2),
    mobile = _useState2[0],
    setMobile = _useState2[1];
  (0,react.useEffect)(function () {
    // Only update on the client side
    setMobile((0,isMobile/* default */.A)());
  }, []);

  // ====================== Active Key ======================
  var _useMergedState = (0,useMergedState/* default */.A)(function () {
      var _tabs$;
      return (_tabs$ = tabs[0]) === null || _tabs$ === void 0 ? void 0 : _tabs$.key;
    }, {
      value: activeKey,
      defaultValue: defaultActiveKey
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    mergedActiveKey = _useMergedState2[0],
    setMergedActiveKey = _useMergedState2[1];
  var _useState3 = (0,react.useState)(function () {
      return tabs.findIndex(function (tab) {
        return tab.key === mergedActiveKey;
      });
    }),
    _useState4 = (0,slicedToArray/* default */.A)(_useState3, 2),
    activeIndex = _useState4[0],
    setActiveIndex = _useState4[1];

  // Reset active key if not exist anymore
  (0,react.useEffect)(function () {
    var newActiveIndex = tabs.findIndex(function (tab) {
      return tab.key === mergedActiveKey;
    });
    if (newActiveIndex === -1) {
      var _tabs$newActiveIndex;
      newActiveIndex = Math.max(0, Math.min(activeIndex, tabs.length - 1));
      setMergedActiveKey((_tabs$newActiveIndex = tabs[newActiveIndex]) === null || _tabs$newActiveIndex === void 0 ? void 0 : _tabs$newActiveIndex.key);
    }
    setActiveIndex(newActiveIndex);
  }, [tabs.map(function (tab) {
    return tab.key;
  }).join('_'), mergedActiveKey, activeIndex]);

  // ===================== Accessibility ====================
  var _useMergedState3 = (0,useMergedState/* default */.A)(null, {
      value: id
    }),
    _useMergedState4 = (0,slicedToArray/* default */.A)(_useMergedState3, 2),
    mergedId = _useMergedState4[0],
    setMergedId = _useMergedState4[1];

  // Async generate id to avoid ssr mapping failed
  (0,react.useEffect)(function () {
    if (!id) {
      setMergedId("rc-tabs-".concat( false ? 0 : uuid));
      uuid += 1;
    }
  }, []);

  // ======================== Events ========================
  function onInternalTabClick(key, e) {
    onTabClick === null || onTabClick === void 0 || onTabClick(key, e);
    var isActiveChanged = key !== mergedActiveKey;
    setMergedActiveKey(key);
    if (isActiveChanged) {
      onChange === null || onChange === void 0 || onChange(key);
    }
  }

  // ======================== Render ========================
  var sharedProps = {
    id: mergedId,
    activeKey: mergedActiveKey,
    animated: mergedAnimated,
    tabPosition: tabPosition,
    rtl: rtl,
    mobile: mobile
  };
  var tabNavBarProps = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, sharedProps), {}, {
    editable: editable,
    locale: locale,
    more: more,
    tabBarGutter: tabBarGutter,
    onTabClick: onInternalTabClick,
    onTabScroll: onTabScroll,
    extra: tabBarExtraContent,
    style: tabBarStyle,
    panes: null,
    getPopupContainer: getPopupContainer,
    popupClassName: popupClassName,
    indicator: indicator
  });
  return /*#__PURE__*/react.createElement(TabContext.Provider, {
    value: {
      tabs: tabs,
      prefixCls: prefixCls
    }
  }, /*#__PURE__*/react.createElement("div", (0,esm_extends/* default */.A)({
    ref: ref,
    id: id,
    className: classnames_default()(prefixCls, "".concat(prefixCls, "-").concat(tabPosition), (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-mobile"), mobile), "".concat(prefixCls, "-editable"), editable), "".concat(prefixCls, "-rtl"), rtl), className)
  }, restProps), /*#__PURE__*/react.createElement(Wrapper, (0,esm_extends/* default */.A)({}, tabNavBarProps, {
    renderTabBar: renderTabBar
  })), /*#__PURE__*/react.createElement(es_TabPanelList, (0,esm_extends/* default */.A)({
    destroyInactiveTabPane: destroyInactiveTabPane
  }, sharedProps, {
    animated: mergedAnimated
  }))));
});
if (false) {}
/* harmony default export */ var es_Tabs = (Tabs);
;// ./node_modules/rc-tabs/es/index.js

/* harmony default export */ var rc_tabs_es = (es_Tabs);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/motion.js
var motion = __webpack_require__(23723);
;// ./node_modules/antd/es/tabs/hooks/useAnimateConfig.js

const useAnimateConfig_motion = {
  motionAppear: false,
  motionEnter: true,
  motionLeave: true
};
function useAnimateConfig_useAnimateConfig(prefixCls) {
  let animated = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {
    inkBar: true,
    tabPane: false
  };
  let mergedAnimated;
  if (animated === false) {
    mergedAnimated = {
      inkBar: false,
      tabPane: false
    };
  } else if (animated === true) {
    mergedAnimated = {
      inkBar: true,
      tabPane: true
    };
  } else {
    mergedAnimated = Object.assign({
      inkBar: true
    }, typeof animated === 'object' ? animated : {});
  }
  if (mergedAnimated.tabPane) {
    mergedAnimated.tabPaneMotion = Object.assign(Object.assign({}, useAnimateConfig_motion), {
      motionName: (0,motion/* getTransitionName */.b)(prefixCls, 'switch')
    });
  }
  return mergedAnimated;
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/Children/toArray.js
var toArray = __webpack_require__(82546);
;// ./node_modules/antd/es/tabs/hooks/useLegacyItems.js
var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};



function filter(items) {
  return items.filter(item => item);
}
function useLegacyItems(items, children) {
  if (false) {}
  if (items) {
    return items;
  }
  const childrenItems = (0,toArray/* default */.A)(children).map(node => {
    if (/*#__PURE__*/react.isValidElement(node)) {
      const {
        key,
        props
      } = node;
      const _a = props || {},
        {
          tab
        } = _a,
        restProps = __rest(_a, ["tab"]);
      const item = Object.assign(Object.assign({
        key: String(key)
      }, restProps), {
        label: tab
      });
      return item;
    }
    return null;
  });
  return filter(childrenItems);
}
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/slide.js
var slide = __webpack_require__(53561);
;// ./node_modules/antd/es/tabs/style/motion.js

const genMotionStyle = token => {
  const {
    componentCls,
    motionDurationSlow
  } = token;
  return [{
    [componentCls]: {
      [`${componentCls}-switch`]: {
        '&-appear, &-enter': {
          transition: 'none',
          '&-start': {
            opacity: 0
          },
          '&-active': {
            opacity: 1,
            transition: `opacity ${motionDurationSlow}`
          }
        },
        '&-leave': {
          position: 'absolute',
          transition: 'none',
          inset: 0,
          '&-start': {
            opacity: 1
          },
          '&-active': {
            opacity: 0,
            transition: `opacity ${motionDurationSlow}`
          }
        }
      }
    }
  },
  // Follow code may reuse in other components
  [(0,slide/* initSlideMotion */._j)(token, 'slide-up'), (0,slide/* initSlideMotion */._j)(token, 'slide-down')]];
};
/* harmony default export */ var style_motion = (genMotionStyle);
;// ./node_modules/antd/es/tabs/style/index.js




const genCardStyle = token => {
  const {
    componentCls,
    tabsCardPadding,
    cardBg,
    cardGutter,
    colorBorderSecondary,
    itemSelectedColor
  } = token;
  return {
    [`${componentCls}-card`]: {
      [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
        [`${componentCls}-tab`]: {
          margin: 0,
          padding: tabsCardPadding,
          background: cardBg,
          border: `${(0,cssinjs_es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${colorBorderSecondary}`,
          transition: `all ${token.motionDurationSlow} ${token.motionEaseInOut}`
        },
        [`${componentCls}-tab-active`]: {
          color: itemSelectedColor,
          background: token.colorBgContainer
        },
        [`${componentCls}-ink-bar`]: {
          visibility: 'hidden'
        }
      },
      // ========================== Top & Bottom ==========================
      [`&${componentCls}-top, &${componentCls}-bottom`]: {
        [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
          [`${componentCls}-tab + ${componentCls}-tab`]: {
            marginLeft: {
              _skip_check_: true,
              value: (0,cssinjs_es/* unit */.zA)(cardGutter)
            }
          }
        }
      },
      [`&${componentCls}-top`]: {
        [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
          [`${componentCls}-tab`]: {
            borderRadius: `${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)} ${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)} 0 0`
          },
          [`${componentCls}-tab-active`]: {
            borderBottomColor: token.colorBgContainer
          }
        }
      },
      [`&${componentCls}-bottom`]: {
        [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
          [`${componentCls}-tab`]: {
            borderRadius: `0 0 ${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)} ${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)}`
          },
          [`${componentCls}-tab-active`]: {
            borderTopColor: token.colorBgContainer
          }
        }
      },
      // ========================== Left & Right ==========================
      [`&${componentCls}-left, &${componentCls}-right`]: {
        [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
          [`${componentCls}-tab + ${componentCls}-tab`]: {
            marginTop: (0,cssinjs_es/* unit */.zA)(cardGutter)
          }
        }
      },
      [`&${componentCls}-left`]: {
        [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
          [`${componentCls}-tab`]: {
            borderRadius: {
              _skip_check_: true,
              value: `${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)} 0 0 ${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)}`
            }
          },
          [`${componentCls}-tab-active`]: {
            borderRightColor: {
              _skip_check_: true,
              value: token.colorBgContainer
            }
          }
        }
      },
      [`&${componentCls}-right`]: {
        [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
          [`${componentCls}-tab`]: {
            borderRadius: {
              _skip_check_: true,
              value: `0 ${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)} ${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)} 0`
            }
          },
          [`${componentCls}-tab-active`]: {
            borderLeftColor: {
              _skip_check_: true,
              value: token.colorBgContainer
            }
          }
        }
      }
    }
  };
};
const genDropdownStyle = token => {
  const {
    componentCls,
    itemHoverColor,
    dropdownEdgeChildVerticalPadding
  } = token;
  return {
    [`${componentCls}-dropdown`]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      position: 'absolute',
      top: -9999,
      left: {
        _skip_check_: true,
        value: -9999
      },
      zIndex: token.zIndexPopup,
      display: 'block',
      '&-hidden': {
        display: 'none'
      },
      [`${componentCls}-dropdown-menu`]: {
        maxHeight: token.tabsDropdownHeight,
        margin: 0,
        padding: `${(0,cssinjs_es/* unit */.zA)(dropdownEdgeChildVerticalPadding)} 0`,
        overflowX: 'hidden',
        overflowY: 'auto',
        textAlign: {
          _skip_check_: true,
          value: 'left'
        },
        listStyleType: 'none',
        backgroundColor: token.colorBgContainer,
        backgroundClip: 'padding-box',
        borderRadius: token.borderRadiusLG,
        outline: 'none',
        boxShadow: token.boxShadowSecondary,
        '&-item': Object.assign(Object.assign({}, style/* textEllipsis */.L9), {
          display: 'flex',
          alignItems: 'center',
          minWidth: token.tabsDropdownWidth,
          margin: 0,
          padding: `${(0,cssinjs_es/* unit */.zA)(token.paddingXXS)} ${(0,cssinjs_es/* unit */.zA)(token.paddingSM)}`,
          color: token.colorText,
          fontWeight: 'normal',
          fontSize: token.fontSize,
          lineHeight: token.lineHeight,
          cursor: 'pointer',
          transition: `all ${token.motionDurationSlow}`,
          '> span': {
            flex: 1,
            whiteSpace: 'nowrap'
          },
          '&-remove': {
            flex: 'none',
            marginLeft: {
              _skip_check_: true,
              value: token.marginSM
            },
            color: token.colorTextDescription,
            fontSize: token.fontSizeSM,
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            '&:hover': {
              color: itemHoverColor
            }
          },
          '&:hover': {
            background: token.controlItemBgHover
          },
          '&-disabled': {
            '&, &:hover': {
              color: token.colorTextDisabled,
              background: 'transparent',
              cursor: 'not-allowed'
            }
          }
        })
      }
    })
  };
};
const genPositionStyle = token => {
  const {
    componentCls,
    margin,
    colorBorderSecondary,
    horizontalMargin,
    verticalItemPadding,
    verticalItemMargin,
    calc
  } = token;
  return {
    // ========================== Top & Bottom ==========================
    [`${componentCls}-top, ${componentCls}-bottom`]: {
      flexDirection: 'column',
      [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
        margin: horizontalMargin,
        '&::before': {
          position: 'absolute',
          right: {
            _skip_check_: true,
            value: 0
          },
          left: {
            _skip_check_: true,
            value: 0
          },
          borderBottom: `${(0,cssinjs_es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${colorBorderSecondary}`,
          content: "''"
        },
        [`${componentCls}-ink-bar`]: {
          height: token.lineWidthBold,
          '&-animated': {
            transition: `width ${token.motionDurationSlow}, left ${token.motionDurationSlow},
            right ${token.motionDurationSlow}`
          }
        },
        [`${componentCls}-nav-wrap`]: {
          '&::before, &::after': {
            top: 0,
            bottom: 0,
            width: token.controlHeight
          },
          '&::before': {
            left: {
              _skip_check_: true,
              value: 0
            },
            boxShadow: token.boxShadowTabsOverflowLeft
          },
          '&::after': {
            right: {
              _skip_check_: true,
              value: 0
            },
            boxShadow: token.boxShadowTabsOverflowRight
          },
          [`&${componentCls}-nav-wrap-ping-left::before`]: {
            opacity: 1
          },
          [`&${componentCls}-nav-wrap-ping-right::after`]: {
            opacity: 1
          }
        }
      }
    },
    [`${componentCls}-top`]: {
      [`> ${componentCls}-nav,
        > div > ${componentCls}-nav`]: {
        '&::before': {
          bottom: 0
        },
        [`${componentCls}-ink-bar`]: {
          bottom: 0
        }
      }
    },
    [`${componentCls}-bottom`]: {
      [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
        order: 1,
        marginTop: margin,
        marginBottom: 0,
        '&::before': {
          top: 0
        },
        [`${componentCls}-ink-bar`]: {
          top: 0
        }
      },
      [`> ${componentCls}-content-holder, > div > ${componentCls}-content-holder`]: {
        order: 0
      }
    },
    // ========================== Left & Right ==========================
    [`${componentCls}-left, ${componentCls}-right`]: {
      [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
        flexDirection: 'column',
        minWidth: calc(token.controlHeight).mul(1.25).equal(),
        // >>>>>>>>>>> Tab
        [`${componentCls}-tab`]: {
          padding: verticalItemPadding,
          textAlign: 'center'
        },
        [`${componentCls}-tab + ${componentCls}-tab`]: {
          margin: verticalItemMargin
        },
        // >>>>>>>>>>> Nav
        [`${componentCls}-nav-wrap`]: {
          flexDirection: 'column',
          '&::before, &::after': {
            right: {
              _skip_check_: true,
              value: 0
            },
            left: {
              _skip_check_: true,
              value: 0
            },
            height: token.controlHeight
          },
          '&::before': {
            top: 0,
            boxShadow: token.boxShadowTabsOverflowTop
          },
          '&::after': {
            bottom: 0,
            boxShadow: token.boxShadowTabsOverflowBottom
          },
          [`&${componentCls}-nav-wrap-ping-top::before`]: {
            opacity: 1
          },
          [`&${componentCls}-nav-wrap-ping-bottom::after`]: {
            opacity: 1
          }
        },
        // >>>>>>>>>>> Ink Bar
        [`${componentCls}-ink-bar`]: {
          width: token.lineWidthBold,
          '&-animated': {
            transition: `height ${token.motionDurationSlow}, top ${token.motionDurationSlow}`
          }
        },
        [`${componentCls}-nav-list, ${componentCls}-nav-operations`]: {
          flex: '1 0 auto',
          // fix safari scroll problem
          flexDirection: 'column'
        }
      }
    },
    [`${componentCls}-left`]: {
      [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
        [`${componentCls}-ink-bar`]: {
          right: {
            _skip_check_: true,
            value: 0
          }
        }
      },
      [`> ${componentCls}-content-holder, > div > ${componentCls}-content-holder`]: {
        marginLeft: {
          _skip_check_: true,
          value: (0,cssinjs_es/* unit */.zA)(calc(token.lineWidth).mul(-1).equal())
        },
        borderLeft: {
          _skip_check_: true,
          value: `${(0,cssinjs_es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`
        },
        [`> ${componentCls}-content > ${componentCls}-tabpane`]: {
          paddingLeft: {
            _skip_check_: true,
            value: token.paddingLG
          }
        }
      }
    },
    [`${componentCls}-right`]: {
      [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
        order: 1,
        [`${componentCls}-ink-bar`]: {
          left: {
            _skip_check_: true,
            value: 0
          }
        }
      },
      [`> ${componentCls}-content-holder, > div > ${componentCls}-content-holder`]: {
        order: 0,
        marginRight: {
          _skip_check_: true,
          value: calc(token.lineWidth).mul(-1).equal()
        },
        borderRight: {
          _skip_check_: true,
          value: `${(0,cssinjs_es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`
        },
        [`> ${componentCls}-content > ${componentCls}-tabpane`]: {
          paddingRight: {
            _skip_check_: true,
            value: token.paddingLG
          }
        }
      }
    }
  };
};
const genSizeStyle = token => {
  const {
    componentCls,
    cardPaddingSM,
    cardPaddingLG,
    horizontalItemPaddingSM,
    horizontalItemPaddingLG
  } = token;
  return {
    [componentCls]: {
      '&-small': {
        [`> ${componentCls}-nav`]: {
          [`${componentCls}-tab`]: {
            padding: horizontalItemPaddingSM,
            fontSize: token.titleFontSizeSM
          }
        }
      },
      '&-large': {
        [`> ${componentCls}-nav`]: {
          [`${componentCls}-tab`]: {
            padding: horizontalItemPaddingLG,
            fontSize: token.titleFontSizeLG
          }
        }
      }
    },
    [`${componentCls}-card`]: {
      [`&${componentCls}-small`]: {
        [`> ${componentCls}-nav`]: {
          [`${componentCls}-tab`]: {
            padding: cardPaddingSM
          }
        },
        [`&${componentCls}-bottom`]: {
          [`> ${componentCls}-nav ${componentCls}-tab`]: {
            borderRadius: `0 0 ${(0,cssinjs_es/* unit */.zA)(token.borderRadius)} ${(0,cssinjs_es/* unit */.zA)(token.borderRadius)}`
          }
        },
        [`&${componentCls}-top`]: {
          [`> ${componentCls}-nav ${componentCls}-tab`]: {
            borderRadius: `${(0,cssinjs_es/* unit */.zA)(token.borderRadius)} ${(0,cssinjs_es/* unit */.zA)(token.borderRadius)} 0 0`
          }
        },
        [`&${componentCls}-right`]: {
          [`> ${componentCls}-nav ${componentCls}-tab`]: {
            borderRadius: {
              _skip_check_: true,
              value: `0 ${(0,cssinjs_es/* unit */.zA)(token.borderRadius)} ${(0,cssinjs_es/* unit */.zA)(token.borderRadius)} 0`
            }
          }
        },
        [`&${componentCls}-left`]: {
          [`> ${componentCls}-nav ${componentCls}-tab`]: {
            borderRadius: {
              _skip_check_: true,
              value: `${(0,cssinjs_es/* unit */.zA)(token.borderRadius)} 0 0 ${(0,cssinjs_es/* unit */.zA)(token.borderRadius)}`
            }
          }
        }
      },
      [`&${componentCls}-large`]: {
        [`> ${componentCls}-nav`]: {
          [`${componentCls}-tab`]: {
            padding: cardPaddingLG
          }
        }
      }
    }
  };
};
const genTabStyle = token => {
  const {
    componentCls,
    itemActiveColor,
    itemHoverColor,
    iconCls,
    tabsHorizontalItemMargin,
    horizontalItemPadding,
    itemSelectedColor,
    itemColor
  } = token;
  const tabCls = `${componentCls}-tab`;
  return {
    [tabCls]: {
      position: 'relative',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent',
      display: 'inline-flex',
      alignItems: 'center',
      padding: horizontalItemPadding,
      fontSize: token.titleFontSize,
      background: 'transparent',
      border: 0,
      outline: 'none',
      cursor: 'pointer',
      color: itemColor,
      '&-btn, &-remove': Object.assign({
        '&:focus:not(:focus-visible), &:active': {
          color: itemActiveColor
        }
      }, (0,style/* genFocusStyle */.K8)(token)),
      '&-btn': {
        outline: 'none',
        transition: `all ${token.motionDurationSlow}`,
        [`${tabCls}-icon:not(:last-child)`]: {
          marginInlineEnd: token.marginSM
        }
      },
      '&-remove': {
        flex: 'none',
        marginRight: {
          _skip_check_: true,
          value: token.calc(token.marginXXS).mul(-1).equal()
        },
        marginLeft: {
          _skip_check_: true,
          value: token.marginXS
        },
        color: token.colorTextDescription,
        fontSize: token.fontSizeSM,
        background: 'transparent',
        border: 'none',
        outline: 'none',
        cursor: 'pointer',
        transition: `all ${token.motionDurationSlow}`,
        '&:hover': {
          color: token.colorTextHeading
        }
      },
      '&:hover': {
        color: itemHoverColor
      },
      [`&${tabCls}-active ${tabCls}-btn`]: {
        color: itemSelectedColor,
        textShadow: token.tabsActiveTextShadow
      },
      [`&${tabCls}-disabled`]: {
        color: token.colorTextDisabled,
        cursor: 'not-allowed'
      },
      [`&${tabCls}-disabled ${tabCls}-btn, &${tabCls}-disabled ${componentCls}-remove`]: {
        '&:focus, &:active': {
          color: token.colorTextDisabled
        }
      },
      [`& ${tabCls}-remove ${iconCls}`]: {
        margin: 0
      },
      [`${iconCls}:not(:last-child)`]: {
        marginRight: {
          _skip_check_: true,
          value: token.marginSM
        }
      }
    },
    [`${tabCls} + ${tabCls}`]: {
      margin: {
        _skip_check_: true,
        value: tabsHorizontalItemMargin
      }
    }
  };
};
const genRtlStyle = token => {
  const {
    componentCls,
    tabsHorizontalItemMarginRTL,
    iconCls,
    cardGutter,
    calc
  } = token;
  const rtlCls = `${componentCls}-rtl`;
  return {
    [rtlCls]: {
      direction: 'rtl',
      [`${componentCls}-nav`]: {
        [`${componentCls}-tab`]: {
          margin: {
            _skip_check_: true,
            value: tabsHorizontalItemMarginRTL
          },
          [`${componentCls}-tab:last-of-type`]: {
            marginLeft: {
              _skip_check_: true,
              value: 0
            }
          },
          [iconCls]: {
            marginRight: {
              _skip_check_: true,
              value: 0
            },
            marginLeft: {
              _skip_check_: true,
              value: (0,cssinjs_es/* unit */.zA)(token.marginSM)
            }
          },
          [`${componentCls}-tab-remove`]: {
            marginRight: {
              _skip_check_: true,
              value: (0,cssinjs_es/* unit */.zA)(token.marginXS)
            },
            marginLeft: {
              _skip_check_: true,
              value: (0,cssinjs_es/* unit */.zA)(calc(token.marginXXS).mul(-1).equal())
            },
            [iconCls]: {
              margin: 0
            }
          }
        }
      },
      [`&${componentCls}-left`]: {
        [`> ${componentCls}-nav`]: {
          order: 1
        },
        [`> ${componentCls}-content-holder`]: {
          order: 0
        }
      },
      [`&${componentCls}-right`]: {
        [`> ${componentCls}-nav`]: {
          order: 0
        },
        [`> ${componentCls}-content-holder`]: {
          order: 1
        }
      },
      // ====================== Card ======================
      [`&${componentCls}-card${componentCls}-top, &${componentCls}-card${componentCls}-bottom`]: {
        [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
          [`${componentCls}-tab + ${componentCls}-tab`]: {
            marginRight: {
              _skip_check_: true,
              value: cardGutter
            },
            marginLeft: {
              _skip_check_: true,
              value: 0
            }
          }
        }
      }
    },
    [`${componentCls}-dropdown-rtl`]: {
      direction: 'rtl'
    },
    [`${componentCls}-menu-item`]: {
      [`${componentCls}-dropdown-rtl`]: {
        textAlign: {
          _skip_check_: true,
          value: 'right'
        }
      }
    }
  };
};
const genTabsStyle = token => {
  const {
    componentCls,
    tabsCardPadding,
    cardHeight,
    cardGutter,
    itemHoverColor,
    itemActiveColor,
    colorBorderSecondary
  } = token;
  return {
    [componentCls]: Object.assign(Object.assign(Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      display: 'flex',
      // ========================== Navigation ==========================
      [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
        position: 'relative',
        display: 'flex',
        flex: 'none',
        alignItems: 'center',
        [`${componentCls}-nav-wrap`]: {
          position: 'relative',
          display: 'flex',
          flex: 'auto',
          alignSelf: 'stretch',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          transform: 'translate(0)',
          // Fix chrome render bug
          // >>>>> Ping shadow
          '&::before, &::after': {
            position: 'absolute',
            zIndex: 1,
            opacity: 0,
            transition: `opacity ${token.motionDurationSlow}`,
            content: "''",
            pointerEvents: 'none'
          }
        },
        [`${componentCls}-nav-list`]: {
          position: 'relative',
          display: 'flex',
          transition: `opacity ${token.motionDurationSlow}`
        },
        // >>>>>>>> Operations
        [`${componentCls}-nav-operations`]: {
          display: 'flex',
          alignSelf: 'stretch'
        },
        [`${componentCls}-nav-operations-hidden`]: {
          position: 'absolute',
          visibility: 'hidden',
          pointerEvents: 'none'
        },
        [`${componentCls}-nav-more`]: {
          position: 'relative',
          padding: tabsCardPadding,
          background: 'transparent',
          border: 0,
          color: token.colorText,
          '&::after': {
            position: 'absolute',
            right: {
              _skip_check_: true,
              value: 0
            },
            bottom: 0,
            left: {
              _skip_check_: true,
              value: 0
            },
            height: token.calc(token.controlHeightLG).div(8).equal(),
            transform: 'translateY(100%)',
            content: "''"
          }
        },
        [`${componentCls}-nav-add`]: Object.assign({
          minWidth: cardHeight,
          marginLeft: {
            _skip_check_: true,
            value: cardGutter
          },
          padding: (0,cssinjs_es/* unit */.zA)(token.paddingXS),
          background: 'transparent',
          border: `${(0,cssinjs_es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${colorBorderSecondary}`,
          borderRadius: `${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)} ${(0,cssinjs_es/* unit */.zA)(token.borderRadiusLG)} 0 0`,
          outline: 'none',
          cursor: 'pointer',
          color: token.colorText,
          transition: `all ${token.motionDurationSlow} ${token.motionEaseInOut}`,
          '&:hover': {
            color: itemHoverColor
          },
          '&:active, &:focus:not(:focus-visible)': {
            color: itemActiveColor
          }
        }, (0,style/* genFocusStyle */.K8)(token))
      },
      [`${componentCls}-extra-content`]: {
        flex: 'none'
      },
      // ============================ InkBar ============================
      [`${componentCls}-ink-bar`]: {
        position: 'absolute',
        background: token.inkBarColor,
        pointerEvents: 'none'
      }
    }), genTabStyle(token)), {
      // =========================== TabPanes ===========================
      [`${componentCls}-content`]: {
        position: 'relative',
        width: '100%'
      },
      [`${componentCls}-content-holder`]: {
        flex: 'auto',
        minWidth: 0,
        minHeight: 0
      },
      [`${componentCls}-tabpane`]: {
        outline: 'none',
        '&-hidden': {
          display: 'none'
        }
      }
    }),
    [`${componentCls}-centered`]: {
      [`> ${componentCls}-nav, > div > ${componentCls}-nav`]: {
        [`${componentCls}-nav-wrap`]: {
          [`&:not([class*='${componentCls}-nav-wrap-ping']) > ${componentCls}-nav-list`]: {
            margin: 'auto'
          }
        }
      }
    }
  };
};
const prepareComponentToken = token => {
  const cardHeight = token.controlHeightLG;
  return {
    zIndexPopup: token.zIndexPopupBase + 50,
    cardBg: token.colorFillAlter,
    cardHeight,
    // Initialize with empty string, because cardPadding will be calculated with cardHeight by default.
    cardPadding: `${(cardHeight - Math.round(token.fontSize * token.lineHeight)) / 2 - token.lineWidth}px ${token.padding}px`,
    cardPaddingSM: `${token.paddingXXS * 1.5}px ${token.padding}px`,
    cardPaddingLG: `${token.paddingXS}px ${token.padding}px ${token.paddingXXS * 1.5}px`,
    titleFontSize: token.fontSize,
    titleFontSizeLG: token.fontSizeLG,
    titleFontSizeSM: token.fontSize,
    inkBarColor: token.colorPrimary,
    horizontalMargin: `0 0 ${token.margin}px 0`,
    horizontalItemGutter: 32,
    // Fixed Value
    // Initialize with empty string, because horizontalItemMargin will be calculated with horizontalItemGutter by default.
    horizontalItemMargin: ``,
    horizontalItemMarginRTL: ``,
    horizontalItemPadding: `${token.paddingSM}px 0`,
    horizontalItemPaddingSM: `${token.paddingXS}px 0`,
    horizontalItemPaddingLG: `${token.padding}px 0`,
    verticalItemPadding: `${token.paddingXS}px ${token.paddingLG}px`,
    verticalItemMargin: `${token.margin}px 0 0 0`,
    itemColor: token.colorText,
    itemSelectedColor: token.colorPrimary,
    itemHoverColor: token.colorPrimaryHover,
    itemActiveColor: token.colorPrimaryActive,
    cardGutter: token.marginXXS / 2
  };
};
// ============================== Export ==============================
/* harmony default export */ var tabs_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Tabs', token => {
  const tabsToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    // `cardPadding` is empty by default, so we could calculate with dynamic `cardHeight`
    tabsCardPadding: token.cardPadding,
    dropdownEdgeChildVerticalPadding: token.paddingXXS,
    tabsActiveTextShadow: '0 0 0.25px currentcolor',
    tabsDropdownHeight: 200,
    tabsDropdownWidth: 120,
    tabsHorizontalItemMargin: `0 0 0 ${(0,cssinjs_es/* unit */.zA)(token.horizontalItemGutter)}`,
    tabsHorizontalItemMarginRTL: `0 0 0 ${(0,cssinjs_es/* unit */.zA)(token.horizontalItemGutter)}`
  });
  return [genSizeStyle(tabsToken), genRtlStyle(tabsToken), genPositionStyle(tabsToken), genDropdownStyle(tabsToken), genCardStyle(tabsToken), genTabsStyle(tabsToken), style_motion(tabsToken)];
}, prepareComponentToken));
;// ./node_modules/antd/es/tabs/TabPane.js
const TabPane_TabPane = () => null;
if (false) {}
/* harmony default export */ var tabs_TabPane = (TabPane_TabPane);
;// ./node_modules/antd/es/tabs/index.js
"use client";

var tabs_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};














const tabs_Tabs = props => {
  var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
  const {
      type,
      className,
      rootClassName,
      size: customSize,
      onEdit,
      hideAdd,
      centered,
      addIcon,
      removeIcon,
      moreIcon,
      more,
      popupClassName,
      children,
      items,
      animated,
      style,
      indicatorSize,
      indicator
    } = props,
    otherProps = tabs_rest(props, ["type", "className", "rootClassName", "size", "onEdit", "hideAdd", "centered", "addIcon", "removeIcon", "moreIcon", "more", "popupClassName", "children", "items", "animated", "style", "indicatorSize", "indicator"]);
  const {
    prefixCls: customizePrefixCls
  } = otherProps;
  const {
    direction,
    tabs,
    getPrefixCls,
    getPopupContainer
  } = react.useContext(context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('tabs', customizePrefixCls);
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = tabs_style(prefixCls, rootCls);
  let editable;
  if (type === 'editable-card') {
    editable = {
      onEdit: (editType, _ref) => {
        let {
          key,
          event
        } = _ref;
        onEdit === null || onEdit === void 0 ? void 0 : onEdit(editType === 'add' ? event : key, editType);
      },
      removeIcon: (_a = removeIcon !== null && removeIcon !== void 0 ? removeIcon : tabs === null || tabs === void 0 ? void 0 : tabs.removeIcon) !== null && _a !== void 0 ? _a : /*#__PURE__*/react.createElement(CloseOutlined/* default */.A, null),
      addIcon: (addIcon !== null && addIcon !== void 0 ? addIcon : tabs === null || tabs === void 0 ? void 0 : tabs.addIcon) || /*#__PURE__*/react.createElement(PlusOutlined/* default */.A, null),
      showAdd: hideAdd !== true
    };
  }
  const rootPrefixCls = getPrefixCls();
  if (false) {}
  const size = (0,useSize/* default */.A)(customSize);
  const mergedItems = useLegacyItems(items, children);
  const mergedAnimated = useAnimateConfig_useAnimateConfig(prefixCls, animated);
  const mergedStyle = Object.assign(Object.assign({}, tabs === null || tabs === void 0 ? void 0 : tabs.style), style);
  const mergedIndicator = {
    align: (_b = indicator === null || indicator === void 0 ? void 0 : indicator.align) !== null && _b !== void 0 ? _b : (_c = tabs === null || tabs === void 0 ? void 0 : tabs.indicator) === null || _c === void 0 ? void 0 : _c.align,
    size: (_g = (_e = (_d = indicator === null || indicator === void 0 ? void 0 : indicator.size) !== null && _d !== void 0 ? _d : indicatorSize) !== null && _e !== void 0 ? _e : (_f = tabs === null || tabs === void 0 ? void 0 : tabs.indicator) === null || _f === void 0 ? void 0 : _f.size) !== null && _g !== void 0 ? _g : tabs === null || tabs === void 0 ? void 0 : tabs.indicatorSize
  };
  return wrapCSSVar(/*#__PURE__*/react.createElement(rc_tabs_es, Object.assign({
    direction: direction,
    getPopupContainer: getPopupContainer
  }, otherProps, {
    items: mergedItems,
    className: classnames_default()({
      [`${prefixCls}-${size}`]: size,
      [`${prefixCls}-card`]: ['card', 'editable-card'].includes(type),
      [`${prefixCls}-editable-card`]: type === 'editable-card',
      [`${prefixCls}-centered`]: centered
    }, tabs === null || tabs === void 0 ? void 0 : tabs.className, className, rootClassName, hashId, cssVarCls, rootCls),
    popupClassName: classnames_default()(popupClassName, hashId, cssVarCls, rootCls),
    style: mergedStyle,
    editable: editable,
    more: Object.assign({
      icon: (_l = (_k = (_j = (_h = tabs === null || tabs === void 0 ? void 0 : tabs.more) === null || _h === void 0 ? void 0 : _h.icon) !== null && _j !== void 0 ? _j : tabs === null || tabs === void 0 ? void 0 : tabs.moreIcon) !== null && _k !== void 0 ? _k : moreIcon) !== null && _l !== void 0 ? _l : /*#__PURE__*/react.createElement(EllipsisOutlined/* default */.A, null),
      transitionName: `${rootPrefixCls}-slide-up`
    }, more),
    prefixCls: prefixCls,
    animated: mergedAnimated,
    indicator: mergedIndicator
  })));
};
tabs_Tabs.TabPane = tabs_TabPane;
if (false) {}
/* harmony default export */ var tabs = (tabs_Tabs);

/***/ }),

/***/ 32134:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   C: function() { return /* binding */ useSettingsStore; }
/* harmony export */ });
/* unused harmony export generateOpenAIModelConfig */
/* harmony import */ var _babel_runtime_helpers_esm_objectWithoutPropertiesLoose__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(98587);
/* harmony import */ var zustand__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(71511);
/* harmony import */ var zustand_middleware__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(87134);
const _excluded=["default_agent_id"],_excluded2=["default_agent_id"];const defaultConfig={cooperative_planning:true,autonomous_execution:false,allowed_websites:[],max_actions_per_step:5,multiple_tools_per_call:false,max_turns:20,approval_policy:"auto-conservative",allow_for_replans:true,do_bing_search:false,websurfer_loop:false,//   model_configs: `model_config: &client
//   provider: OpenAIChatCompletionClient
//   config:
//     model: gpt-4.1-2025-04-14
//   max_retries: 5
// model_config_action_guard: &client_action_guard
//   provider: OpenAIChatCompletionClient
//   config:
//     model: gpt-4.1-nano-2025-04-14
//   max_retries: 5
// orchestrator_client: *client
// coder_client: *client
// web_surfer_client: *client
// file_surfer_client: *client
// action_guard_client: *client_action_guard`,
model_configs:"model_config: &client\n  provider: drsai.HepAIChatCompletionClient\n  config:\n    model: \"deepseek-ai/deepseek-v3:671b\"\n    base_url: \"https://aiapi.ihep.ac.cn/apiv2\"\n    api_key: \"{{AUTO_PERSONAL_KEY_FOR_DR_SAI}}\"\n    max_retries: 1\n   \n\nr1_config: &r1_client\n  provider: drsai.HepAIChatCompletionClient\n  config:\n    model: \"deepseek-ai/deepseek-r1:671b\"\n    base_url: \"https://aiapi.ihep.ac.cn/apiv2\"\n    api_key: \"{{AUTO_PERSONAL_KEY_FOR_DR_SAI}}\"\n    max_retries: 1\n\nmode: drsai_besiii\n\norchestrator_client: *client\nweb_surfer_client: *client\nfile_surfer_client: *client\naction_guard_client: *client\nplanner_client: *client\ncoder_client: *r1_client\ntester_client: *r1_client\nhost_client: *r1_client\nparser_client: *client\n",retrieve_relevant_plans:"never"};const useSettingsStore=(0,zustand__WEBPACK_IMPORTED_MODULE_0__/* .create */ .v)()((0,zustand_middleware__WEBPACK_IMPORTED_MODULE_1__/* .persist */ .Zr)(set=>({config:defaultConfig,updateConfig:update=>set(state=>({config:Object.assign({},state.config,update)})),resetToDefaults:()=>set({config:defaultConfig})}),{name:"drsai_settings",storage:(0,zustand_middleware__WEBPACK_IMPORTED_MODULE_1__/* .createJSONStorage */ .KU)(()=>localStorage),// 旧版 localStorage 可能没有 version，migrate 不会跑；merge 在每次恢复时都会执行
merge:(persistedState,currentState)=>{const p=persistedState;const mergedConfig=Object.assign({},currentState.config,p===null||p===void 0?void 0:p.config);if(mergedConfig&&"default_agent_id"in mergedConfig){const rest=(0,_babel_runtime_helpers_esm_objectWithoutPropertiesLoose__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)(mergedConfig,_excluded);return Object.assign({},currentState,{config:rest});}return Object.assign({},currentState,{config:mergedConfig});},partialize:state=>{const _state$config=state.config,config=(0,_babel_runtime_helpers_esm_objectWithoutPropertiesLoose__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)(_state$config,_excluded2);return{config};}}));function generateOpenAIModelConfig(model){return"model_config: &client\n  provider: OpenAIChatCompletionClient\n  config:\n    model: "+model+"\n  max_retries: 5\n\norchestrator_client: *client\ncoder_client: *client\nweb_surfer_client: *client\nfile_surfer_client: *client\naction_guard_client: *client\n";}

/***/ }),

/***/ 30999:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ settings_Config; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./node_modules/antd/es/tabs/index.js + 24 modules
var tabs = __webpack_require__(10277);
;// ./node_modules/@monaco-editor/loader/lib/es/_virtual/_rollupPluginBabelHelpers.js
function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);

  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) symbols = symbols.filter(function (sym) {
      return Object.getOwnPropertyDescriptor(object, sym).enumerable;
    });
    keys.push.apply(keys, symbols);
  }

  return keys;
}

function _objectSpread2(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};

    if (i % 2) {
      ownKeys(Object(source), true).forEach(function (key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(Object(source)).forEach(function (key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }

  return target;
}

function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;

  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }

  return target;
}

function _objectWithoutProperties(source, excluded) {
  if (source == null) return {};

  var target = _objectWithoutPropertiesLoose(source, excluded);

  var key, i;

  if (Object.getOwnPropertySymbols) {
    var sourceSymbolKeys = Object.getOwnPropertySymbols(source);

    for (i = 0; i < sourceSymbolKeys.length; i++) {
      key = sourceSymbolKeys[i];
      if (excluded.indexOf(key) >= 0) continue;
      if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
      target[key] = source[key];
    }
  }

  return target;
}

function _slicedToArray(arr, i) {
  return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest();
}

function _arrayWithHoles(arr) {
  if (Array.isArray(arr)) return arr;
}

function _iterableToArrayLimit(arr, i) {
  if (typeof Symbol === "undefined" || !(Symbol.iterator in Object(arr))) return;
  var _arr = [];
  var _n = true;
  var _d = false;
  var _e = undefined;

  try {
    for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
      _arr.push(_s.value);

      if (i && _arr.length === i) break;
    }
  } catch (err) {
    _d = true;
    _e = err;
  } finally {
    try {
      if (!_n && _i["return"] != null) _i["return"]();
    } finally {
      if (_d) throw _e;
    }
  }

  return _arr;
}

function _unsupportedIterableToArray(o, minLen) {
  if (!o) return;
  if (typeof o === "string") return _arrayLikeToArray(o, minLen);
  var n = Object.prototype.toString.call(o).slice(8, -1);
  if (n === "Object" && o.constructor) n = o.constructor.name;
  if (n === "Map" || n === "Set") return Array.from(o);
  if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
}

function _arrayLikeToArray(arr, len) {
  if (len == null || len > arr.length) len = arr.length;

  for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];

  return arr2;
}

function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}



;// ./node_modules/state-local/lib/es/state-local.js
function state_local_defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function state_local_ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);

  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) symbols = symbols.filter(function (sym) {
      return Object.getOwnPropertyDescriptor(object, sym).enumerable;
    });
    keys.push.apply(keys, symbols);
  }

  return keys;
}

function state_local_objectSpread2(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};

    if (i % 2) {
      state_local_ownKeys(Object(source), true).forEach(function (key) {
        state_local_defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      state_local_ownKeys(Object(source)).forEach(function (key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }

  return target;
}

function compose() {
  for (var _len = arguments.length, fns = new Array(_len), _key = 0; _key < _len; _key++) {
    fns[_key] = arguments[_key];
  }

  return function (x) {
    return fns.reduceRight(function (y, f) {
      return f(y);
    }, x);
  };
}

function curry(fn) {
  return function curried() {
    var _this = this;

    for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      args[_key2] = arguments[_key2];
    }

    return args.length >= fn.length ? fn.apply(this, args) : function () {
      for (var _len3 = arguments.length, nextArgs = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
        nextArgs[_key3] = arguments[_key3];
      }

      return curried.apply(_this, [].concat(args, nextArgs));
    };
  };
}

function isObject(value) {
  return {}.toString.call(value).includes('Object');
}

function isEmpty(obj) {
  return !Object.keys(obj).length;
}

function isFunction(value) {
  return typeof value === 'function';
}

function state_local_hasOwnProperty(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function validateChanges(initial, changes) {
  if (!isObject(changes)) errorHandler('changeType');
  if (Object.keys(changes).some(function (field) {
    return !state_local_hasOwnProperty(initial, field);
  })) errorHandler('changeField');
  return changes;
}

function validateSelector(selector) {
  if (!isFunction(selector)) errorHandler('selectorType');
}

function validateHandler(handler) {
  if (!(isFunction(handler) || isObject(handler))) errorHandler('handlerType');
  if (isObject(handler) && Object.values(handler).some(function (_handler) {
    return !isFunction(_handler);
  })) errorHandler('handlersType');
}

function validateInitial(initial) {
  if (!initial) errorHandler('initialIsRequired');
  if (!isObject(initial)) errorHandler('initialType');
  if (isEmpty(initial)) errorHandler('initialContent');
}

function throwError(errorMessages, type) {
  throw new Error(errorMessages[type] || errorMessages["default"]);
}

var errorMessages = {
  initialIsRequired: 'initial state is required',
  initialType: 'initial state should be an object',
  initialContent: 'initial state shouldn\'t be an empty object',
  handlerType: 'handler should be an object or a function',
  handlersType: 'all handlers should be a functions',
  selectorType: 'selector should be a function',
  changeType: 'provided value of changes should be an object',
  changeField: 'it seams you want to change a field in the state which is not specified in the "initial" state',
  "default": 'an unknown error accured in `state-local` package'
};
var errorHandler = curry(throwError)(errorMessages);
var validators = {
  changes: validateChanges,
  selector: validateSelector,
  handler: validateHandler,
  initial: validateInitial
};

function create(initial) {
  var handler = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  validators.initial(initial);
  validators.handler(handler);
  var state = {
    current: initial
  };
  var didUpdate = curry(didStateUpdate)(state, handler);
  var update = curry(updateState)(state);
  var validate = curry(validators.changes)(initial);
  var getChanges = curry(extractChanges)(state);

  function getState() {
    var selector = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : function (state) {
      return state;
    };
    validators.selector(selector);
    return selector(state.current);
  }

  function setState(causedChanges) {
    compose(didUpdate, update, validate, getChanges)(causedChanges);
  }

  return [getState, setState];
}

function extractChanges(state, causedChanges) {
  return isFunction(causedChanges) ? causedChanges(state.current) : causedChanges;
}

function updateState(state, changes) {
  state.current = state_local_objectSpread2(state_local_objectSpread2({}, state.current), changes);
  return changes;
}

function didStateUpdate(state, handler, changes) {
  isFunction(handler) ? handler(state.current) : Object.keys(changes).forEach(function (field) {
    var _handler$field;

    return (_handler$field = handler[field]) === null || _handler$field === void 0 ? void 0 : _handler$field.call(handler, state.current[field]);
  });
  return changes;
}

var index = {
  create: create
};

/* harmony default export */ var state_local = (index);

;// ./node_modules/@monaco-editor/loader/lib/es/config/index.js
var config = {
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs'
  }
};

/* harmony default export */ var es_config = (config);

;// ./node_modules/@monaco-editor/loader/lib/es/utils/curry.js
function curry_curry(fn) {
  return function curried() {
    var _this = this;

    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }

    return args.length >= fn.length ? fn.apply(this, args) : function () {
      for (var _len2 = arguments.length, nextArgs = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        nextArgs[_key2] = arguments[_key2];
      }

      return curried.apply(_this, [].concat(args, nextArgs));
    };
  };
}

/* harmony default export */ var utils_curry = (curry_curry);

;// ./node_modules/@monaco-editor/loader/lib/es/utils/isObject.js
function isObject_isObject(value) {
  return {}.toString.call(value).includes('Object');
}

/* harmony default export */ var utils_isObject = (isObject_isObject);

;// ./node_modules/@monaco-editor/loader/lib/es/validators/index.js



/**
 * validates the configuration object and informs about deprecation
 * @param {Object} config - the configuration object 
 * @return {Object} config - the validated configuration object
 */

function validateConfig(config) {
  if (!config) validators_errorHandler('configIsRequired');
  if (!utils_isObject(config)) validators_errorHandler('configType');

  if (config.urls) {
    informAboutDeprecation();
    return {
      paths: {
        vs: config.urls.monacoBase
      }
    };
  }

  return config;
}
/**
 * logs deprecation message
 */


function informAboutDeprecation() {
  console.warn(validators_errorMessages.deprecation);
}

function validators_throwError(errorMessages, type) {
  throw new Error(errorMessages[type] || errorMessages["default"]);
}

var validators_errorMessages = {
  configIsRequired: 'the configuration object is required',
  configType: 'the configuration object should be an object',
  "default": 'an unknown error accured in `@monaco-editor/loader` package',
  deprecation: "Deprecation warning!\n    You are using deprecated way of configuration.\n\n    Instead of using\n      monaco.config({ urls: { monacoBase: '...' } })\n    use\n      monaco.config({ paths: { vs: '...' } })\n\n    For more please check the link https://github.com/suren-atoyan/monaco-loader#config\n  "
};
var validators_errorHandler = utils_curry(validators_throwError)(validators_errorMessages);
var validators_validators = {
  config: validateConfig
};

/* harmony default export */ var es_validators = (validators_validators);


;// ./node_modules/@monaco-editor/loader/lib/es/utils/compose.js
var compose_compose = function compose() {
  for (var _len = arguments.length, fns = new Array(_len), _key = 0; _key < _len; _key++) {
    fns[_key] = arguments[_key];
  }

  return function (x) {
    return fns.reduceRight(function (y, f) {
      return f(y);
    }, x);
  };
};

/* harmony default export */ var utils_compose = (compose_compose);

;// ./node_modules/@monaco-editor/loader/lib/es/utils/deepMerge.js


function merge(target, source) {
  Object.keys(source).forEach(function (key) {
    if (source[key] instanceof Object) {
      if (target[key]) {
        Object.assign(source[key], merge(target[key], source[key]));
      }
    }
  });
  return _objectSpread2(_objectSpread2({}, target), source);
}

/* harmony default export */ var deepMerge = (merge);

;// ./node_modules/@monaco-editor/loader/lib/es/utils/makeCancelable.js
// The source (has been changed) is https://github.com/facebook/react/issues/5465#issuecomment-157888325
var CANCELATION_MESSAGE = {
  type: 'cancelation',
  msg: 'operation is manually canceled'
};

function makeCancelable(promise) {
  var hasCanceled_ = false;
  var wrappedPromise = new Promise(function (resolve, reject) {
    promise.then(function (val) {
      return hasCanceled_ ? reject(CANCELATION_MESSAGE) : resolve(val);
    });
    promise["catch"](reject);
  });
  return wrappedPromise.cancel = function () {
    return hasCanceled_ = true;
  }, wrappedPromise;
}

/* harmony default export */ var utils_makeCancelable = (makeCancelable);


;// ./node_modules/@monaco-editor/loader/lib/es/loader/index.js








/** the local state of the module */

var _state$create = state_local.create({
  config: es_config,
  isInitialized: false,
  resolve: null,
  reject: null,
  monaco: null
}),
    _state$create2 = _slicedToArray(_state$create, 2),
    getState = _state$create2[0],
    setState = _state$create2[1];
/**
 * set the loader configuration
 * @param {Object} config - the configuration object
 */


function loader_config(globalConfig) {
  var _validators$config = es_validators.config(globalConfig),
      monaco = _validators$config.monaco,
      config = _objectWithoutProperties(_validators$config, ["monaco"]);

  setState(function (state) {
    return {
      config: deepMerge(state.config, config),
      monaco: monaco
    };
  });
}
/**
 * handles the initialization of the monaco-editor
 * @return {Promise} - returns an instance of monaco (with a cancelable promise)
 */


function init() {
  var state = getState(function (_ref) {
    var monaco = _ref.monaco,
        isInitialized = _ref.isInitialized,
        resolve = _ref.resolve;
    return {
      monaco: monaco,
      isInitialized: isInitialized,
      resolve: resolve
    };
  });

  if (!state.isInitialized) {
    setState({
      isInitialized: true
    });

    if (state.monaco) {
      state.resolve(state.monaco);
      return utils_makeCancelable(wrapperPromise);
    }

    if (window.monaco && window.monaco.editor) {
      storeMonacoInstance(window.monaco);
      state.resolve(window.monaco);
      return utils_makeCancelable(wrapperPromise);
    }

    utils_compose(injectScripts, getMonacoLoaderScript)(configureLoader);
  }

  return utils_makeCancelable(wrapperPromise);
}
/**
 * injects provided scripts into the document.body
 * @param {Object} script - an HTML script element
 * @return {Object} - the injected HTML script element
 */


function injectScripts(script) {
  return document.body.appendChild(script);
}
/**
 * creates an HTML script element with/without provided src
 * @param {string} [src] - the source path of the script
 * @return {Object} - the created HTML script element
 */


function createScript(src) {
  var script = document.createElement('script');
  return src && (script.src = src), script;
}
/**
 * creates an HTML script element with the monaco loader src
 * @return {Object} - the created HTML script element
 */


function getMonacoLoaderScript(configureLoader) {
  var state = getState(function (_ref2) {
    var config = _ref2.config,
        reject = _ref2.reject;
    return {
      config: config,
      reject: reject
    };
  });
  var loaderScript = createScript("".concat(state.config.paths.vs, "/loader.js"));

  loaderScript.onload = function () {
    return configureLoader();
  };

  loaderScript.onerror = state.reject;
  return loaderScript;
}
/**
 * configures the monaco loader
 */


function configureLoader() {
  var state = getState(function (_ref3) {
    var config = _ref3.config,
        resolve = _ref3.resolve,
        reject = _ref3.reject;
    return {
      config: config,
      resolve: resolve,
      reject: reject
    };
  });
  var require = window.require;

  require.config(state.config);

  require(['vs/editor/editor.main'], function (monaco) {
    storeMonacoInstance(monaco);
    state.resolve(monaco);
  }, function (error) {
    state.reject(error);
  });
}
/**
 * store monaco instance in local state
 */


function storeMonacoInstance(monaco) {
  if (!getState().monaco) {
    setState({
      monaco: monaco
    });
  }
}
/**
 * internal helper function
 * extracts stored monaco instance
 * @return {Object|null} - the monaco instance
 */


function __getMonacoInstance() {
  return getState(function (_ref4) {
    var monaco = _ref4.monaco;
    return monaco;
  });
}

var wrapperPromise = new Promise(function (resolve, reject) {
  return setState({
    resolve: resolve,
    reject: reject
  });
});
var loader = {
  config: loader_config,
  init: init,
  __getMonacoInstance: __getMonacoInstance
};

/* harmony default export */ var es_loader = (loader);

;// ./node_modules/@monaco-editor/loader/lib/es/index.js



;// ./node_modules/@monaco-editor/react/dist/index.mjs
var le={wrapper:{display:"flex",position:"relative",textAlign:"initial"},fullWidth:{width:"100%"},hide:{display:"none"}},v=le;var ae={container:{display:"flex",height:"100%",width:"100%",justifyContent:"center",alignItems:"center"}},Y=ae;function Me({children:e}){return react.createElement("div",{style:Y.container},e)}var Z=Me;var $=Z;function Ee({width:e,height:r,isEditorReady:n,loading:t,_ref:a,className:m,wrapperProps:E}){return react.createElement("section",{style:{...v.wrapper,width:e,height:r},...E},!n&&react.createElement($,null,t),react.createElement("div",{ref:a,style:{...v.fullWidth,...!n&&v.hide},className:m}))}var ee=Ee;var H=(0,react.memo)(ee);function Ce(e){(0,react.useEffect)(e,[])}var k=Ce;function he(e,r,n=!0){let t=(0,react.useRef)(!0);(0,react.useEffect)(t.current||!n?()=>{t.current=!1}:e,r)}var l=he;function D(){}function h(e,r,n,t){return De(e,t)||be(e,r,n,t)}function De(e,r){return e.editor.getModel(te(e,r))}function be(e,r,n,t){return e.editor.createModel(r,n,t?te(e,t):void 0)}function te(e,r){return e.Uri.parse(r)}function Oe({original:e,modified:r,language:n,originalLanguage:t,modifiedLanguage:a,originalModelPath:m,modifiedModelPath:E,keepCurrentOriginalModel:g=!1,keepCurrentModifiedModel:N=!1,theme:x="light",loading:P="Loading...",options:y={},height:V="100%",width:z="100%",className:F,wrapperProps:j={},beforeMount:A=D,onMount:q=D}){let[M,O]=(0,react.useState)(!1),[T,s]=(0,react.useState)(!0),u=(0,react.useRef)(null),c=(0,react.useRef)(null),w=(0,react.useRef)(null),d=(0,react.useRef)(q),o=(0,react.useRef)(A),b=(0,react.useRef)(!1);k(()=>{let i=es_loader.init();return i.then(f=>(c.current=f)&&s(!1)).catch(f=>f?.type!=="cancelation"&&console.error("Monaco initialization: error:",f)),()=>u.current?I():i.cancel()}),l(()=>{if(u.current&&c.current){let i=u.current.getOriginalEditor(),f=h(c.current,e||"",t||n||"text",m||"");f!==i.getModel()&&i.setModel(f)}},[m],M),l(()=>{if(u.current&&c.current){let i=u.current.getModifiedEditor(),f=h(c.current,r||"",a||n||"text",E||"");f!==i.getModel()&&i.setModel(f)}},[E],M),l(()=>{let i=u.current.getModifiedEditor();i.getOption(c.current.editor.EditorOption.readOnly)?i.setValue(r||""):r!==i.getValue()&&(i.executeEdits("",[{range:i.getModel().getFullModelRange(),text:r||"",forceMoveMarkers:!0}]),i.pushUndoStop())},[r],M),l(()=>{u.current?.getModel()?.original.setValue(e||"")},[e],M),l(()=>{let{original:i,modified:f}=u.current.getModel();c.current.editor.setModelLanguage(i,t||n||"text"),c.current.editor.setModelLanguage(f,a||n||"text")},[n,t,a],M),l(()=>{c.current?.editor.setTheme(x)},[x],M),l(()=>{u.current?.updateOptions(y)},[y],M);let L=(0,react.useCallback)(()=>{if(!c.current)return;o.current(c.current);let i=h(c.current,e||"",t||n||"text",m||""),f=h(c.current,r||"",a||n||"text",E||"");u.current?.setModel({original:i,modified:f})},[n,r,a,e,t,m,E]),U=(0,react.useCallback)(()=>{!b.current&&w.current&&(u.current=c.current.editor.createDiffEditor(w.current,{automaticLayout:!0,...y}),L(),c.current?.editor.setTheme(x),O(!0),b.current=!0)},[y,x,L]);(0,react.useEffect)(()=>{M&&d.current(u.current,c.current)},[M]),(0,react.useEffect)(()=>{!T&&!M&&U()},[T,M,U]);function I(){let i=u.current?.getModel();g||i?.original?.dispose(),N||i?.modified?.dispose(),u.current?.dispose()}return react.createElement(H,{width:z,height:V,isEditorReady:M,loading:P,_ref:w,className:F,wrapperProps:j})}var ie=Oe;var we=(0,react.memo)(ie);function Pe(){let[e,r]=Ie(ce.__getMonacoInstance());return k(()=>{let n;return e||(n=ce.init(),n.then(t=>{r(t)})),()=>n?.cancel()}),e}var Le=(/* unused pure expression or super */ null && (Pe));function He(e){let r=(0,react.useRef)();return (0,react.useEffect)(()=>{r.current=e},[e]),r.current}var se=He;var _=new Map;function Ve({defaultValue:e,defaultLanguage:r,defaultPath:n,value:t,language:a,path:m,theme:E="light",line:g,loading:N="Loading...",options:x={},overrideServices:P={},saveViewState:y=!0,keepCurrentModel:V=!1,width:z="100%",height:F="100%",className:j,wrapperProps:A={},beforeMount:q=D,onMount:M=D,onChange:O,onValidate:T=D}){let[s,u]=(0,react.useState)(!1),[c,w]=(0,react.useState)(!0),d=(0,react.useRef)(null),o=(0,react.useRef)(null),b=(0,react.useRef)(null),L=(0,react.useRef)(M),U=(0,react.useRef)(q),I=(0,react.useRef)(),i=(0,react.useRef)(t),f=se(m),Q=(0,react.useRef)(!1),B=(0,react.useRef)(!1);k(()=>{let p=es_loader.init();return p.then(R=>(d.current=R)&&w(!1)).catch(R=>R?.type!=="cancelation"&&console.error("Monaco initialization: error:",R)),()=>o.current?pe():p.cancel()}),l(()=>{let p=h(d.current,e||t||"",r||a||"",m||n||"");p!==o.current?.getModel()&&(y&&_.set(f,o.current?.saveViewState()),o.current?.setModel(p),y&&o.current?.restoreViewState(_.get(m)))},[m],s),l(()=>{o.current?.updateOptions(x)},[x],s),l(()=>{!o.current||t===void 0||(o.current.getOption(d.current.editor.EditorOption.readOnly)?o.current.setValue(t):t!==o.current.getValue()&&(B.current=!0,o.current.executeEdits("",[{range:o.current.getModel().getFullModelRange(),text:t,forceMoveMarkers:!0}]),o.current.pushUndoStop(),B.current=!1))},[t],s),l(()=>{let p=o.current?.getModel();p&&a&&d.current?.editor.setModelLanguage(p,a)},[a],s),l(()=>{g!==void 0&&o.current?.revealLine(g)},[g],s),l(()=>{d.current?.editor.setTheme(E)},[E],s);let X=(0,react.useCallback)(()=>{if(!(!b.current||!d.current)&&!Q.current){U.current(d.current);let p=m||n,R=h(d.current,t||e||"",r||a||"",p||"");o.current=d.current?.editor.create(b.current,{model:R,automaticLayout:!0,...x},P),y&&o.current.restoreViewState(_.get(p)),d.current.editor.setTheme(E),g!==void 0&&o.current.revealLine(g),u(!0),Q.current=!0}},[e,r,n,t,a,m,x,P,y,E,g]);(0,react.useEffect)(()=>{s&&L.current(o.current,d.current)},[s]),(0,react.useEffect)(()=>{!c&&!s&&X()},[c,s,X]),i.current=t,(0,react.useEffect)(()=>{s&&O&&(I.current?.dispose(),I.current=o.current?.onDidChangeModelContent(p=>{B.current||O(o.current.getValue(),p)}))},[s,O]),(0,react.useEffect)(()=>{if(s){let p=d.current.editor.onDidChangeMarkers(R=>{let G=o.current.getModel()?.uri;if(G&&R.find(J=>J.path===G.path)){let J=d.current.editor.getModelMarkers({resource:G});T?.(J)}});return()=>{p?.dispose()}}return()=>{}},[s,T]);function pe(){I.current?.dispose(),V?y&&_.set(m,o.current.saveViewState()):o.current.getModel()?.dispose(),o.current.dispose()}return react.createElement(H,{width:z,height:F,isEditorReady:s,loading:N,_ref:b,className:j,wrapperProps:A})}var fe=Ve;var de=(0,react.memo)(fe);var Ft=(/* unused pure expression or super */ null && (de));
//# sourceMappingURL=index.mjs.map
// EXTERNAL MODULE: ./src/components/store.tsx
var store = __webpack_require__(32134);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
// EXTERNAL MODULE: ./src/components/utils.ts
var utils = __webpack_require__(70870);
// EXTERNAL MODULE: ./src/components/common/Button.tsx
var common_Button = __webpack_require__(2915);
;// ./src/components/signin.tsx
const signin_SignInModal=_ref=>{let{isVisible,onClose}=_ref;const{user,setUser}=React.useContext(appContext);const[email,setEmail]=React.useState((user===null||user===void 0?void 0:user.email)||"");// const [email, setEmail] = React.useState(user?.email || "default");
const isAlreadySignedIn=!!(user!==null&&user!==void 0&&user.email);const handleEmailChange=e=>{setEmail(e.target.value);};const handleSignIn=()=>{const trimmedEmail=email.trim();if(!trimmedEmail){message.error("Username cannot be empty");return;}setUser(Object.assign({},user,{email:trimmedEmail,name:trimmedEmail}));setLocalStorage("user_email",trimmedEmail);onClose();};return/*#__PURE__*/React.createElement(Modal,{open:isVisible,footer:null,closable:isAlreadySignedIn,maskClosable:isAlreadySignedIn,onCancel:isAlreadySignedIn?onClose:undefined},/*#__PURE__*/React.createElement("span",{className:"text-lg"},"Enter a username.",/*#__PURE__*/React.createElement("br",null)," A change of username will create a new profile."),/*#__PURE__*/React.createElement("div",{className:"mb-4"},/*#__PURE__*/React.createElement(Input,{type:"text",placeholder:"Enter a username",value:email,onChange:handleEmailChange,className:"shadow-sm"})),/*#__PURE__*/React.createElement("div",{className:"flex justify-center"},/*#__PURE__*/React.createElement(Button,{type:"button",onClick:handleSignIn},"Sign In")));};/* harmony default export */ var signin = ((/* unused pure expression or super */ null && (signin_SignInModal)));
// EXTERNAL MODULE: ./node_modules/antd/es/input/index.js + 13 modules
var input = __webpack_require__(79365);
// EXTERNAL MODULE: ./src/utils/storageUtils.ts
var storageUtils = __webpack_require__(73268);
;// ./src/components/settings.tsx
const settings_MODEL_OPTIONS=[// { value: "drsai-foundry", label: "Dr.Sai Foundry Template" },
{value:"hepai-foundry",label:"HepAI Foundry Template"},{value:"gpt-4.1-2025-04-14",label:"OpenAI GPT-4.1"},{value:"gpt-4.1-mini-2025-04-14",label:"OpenAI GPT-4.1 Mini"},{value:"azure-ai-foundry",label:"Azure AI Foundry Template"},{value:"ollama",label:"Ollama (Local)"},{value:"openrouter",label:"OpenRouter"},{value:"gpt-4.1-nano-2025-04-14",label:"OpenAI GPT-4.1 Nano"},{value:"o4-mini-2025-04-16",label:"OpenAI O4 Mini"},{value:"o3-mini-2025-01-31",label:"OpenAI O3 Mini"},{value:"gpt-4o-2024-08-06",label:"OpenAI GPT-4o"},{value:"gpt-4o-mini-2024-07-18",label:"OpenAI GPT-4o Mini"}];const{TextArea}=input/* default */.A;const SettingsMenu=_ref=>{let{isOpen,onClose}=_ref;const{darkMode,setDarkMode,user}=React.useContext(appContext);const[isEmailModalOpen,setIsEmailModalOpen]=React.useState(false);const[hasChanges,setHasChanges]=React.useState(false);const[validationWarning,setValidationWarning]=React.useState(null);const{config,updateConfig,resetToDefaults}=useSettingsStore();const[websiteInput,setWebsiteInput]=React.useState("");const[cachedWebsites,setCachedWebsites]=React.useState([]);const[allowedlistEnabled,setAllowedlistEnabled]=React.useState(false);const[modelLabel,setModelLabel]=React.useState();const AZURE_AI_FOUNDRY_YAML="model_config: &client\n  provider: AzureOpenAIChatCompletionClient\n  config:\n    model: gpt-4o\n    azure_endpoint: \"<YOUR ENDPOINT>\"\n    azure_deployment: \"<YOUR DEPLOYMENT>\"\n    api_version: \"2024-10-21\"\n    azure_ad_token_provider:\n      provider: autogen_ext.auth.azure.AzureTokenProvider\n      config:\n        provider_kind: DefaultAzureCredential\n        scopes:\n          - https://cognitiveservices.azure.com/.default\n    max_retries: 10\n\norchestrator_client: *client\ncoder_client: *client\nweb_surfer_client: *client\nfile_surfer_client: *client\naction_guard_client: *client\n";const OPENROUTER_YAML="model_config: &client\n  provider: OpenAIChatCompletionClient\n  config:\n    model: \"openai/gpt-4o\"\n    base_url: \"https://openrouter.ai/api/v1\"\n    api_key: <Your api-key>\n    model_info: # change per model\n       vision: true \n       function_calling: true # required true for file_surfer, but will still work if file_surfer is not needed\n       json_output: false\n       family: unknown\n       structured_output: false\n  max_retries: 5\n\n\norchestrator_client: *client\ncoder_client: *client\nweb_surfer_client: *client\nfile_surfer_client: *client\naction_guard_client: *client\n";const OLLAMA_YAML="model_config: &client\n  provider: autogen_ext.models.ollama.OllamaChatCompletionClient\n  config:\n    model: \"qwen2.5vl:32b\" # change to your desired Ollama model\n    host: \"http://localhost:11434\" # change to your ollama host\n    model_info: # change per model you use\n      vision: true\n      function_calling: true # will work if false but not fully\n      json_output: false # prefered true\n      family: unknown\n      structured_output: false\n  max_retries: 5\n\n# Note you can define multiple model clients and use them for different agents\n# You can also use the OpenAI client instead and access Ollama models\n#model_config: &client\n#  provider: OpenAIChatCompletionClient\n#  config:\n#    model: \"qwen2.5vl:32b\"\n#    base_url: \"http://localhost:11434/v1\" # change to your ollama host\n#    model_info: # change per model\n#       vision: true \n#       function_calling: true # required true for file_surfer, but will still work if file_surfer is not needed\n#       json_output: false\n#       family: unknown\n#       structured_output: false\n#  max_retries: 5\n\norchestrator_client: *client\ncoder_client: *client\nweb_surfer_client: *client\nfile_surfer_client: *client\naction_guard_client: *client\n";const HEPAI_FOUNDRY_YAML="model_config: &client\n  provider: drsai.HepAIChatCompletionClient\n  config:\n    model: \"openai/gpt-4.1\"\n    base_url: \"https://aiapi.ihep.ac.cn/apiv2\"\n    api_key: \"{{AUTO_PERSONAL_KEY_FOR_DR_SAI}}\"\n    max_retries: 1\n\ncoder_client: *client\norchestrator_client: *client\nweb_surfer_client: *client\nfile_surfer_client: *client\naction_guard_client: *client\n";const DRSAI_FOUNDRY_YAML="model_config: &client\n  provider: drsai.HepAIChatCompletionClient\n  config:\n    model: deepseek-v3-250324\n    api_key: 68d92faa-9b6e-4ba4-9fdc-b6055ce6c5bc\n    base_url: \"https://ark.cn-beijing.volces.com/api/v3\"\n    max_retries: 10\n\nr1_config: &r1_client\n  provider: drsai.HepAIChatCompletionClient\n  config:\n    model: deepseek-r1-250120\n    api_key: 68d92faa-9b6e-4ba4-9fdc-b6055ce6c5bc\n    base_url: \"https://ark.cn-beijing.volces.com/api/v3\"\n    max_retries: 10\n\nmode: drsai_besiii\n\norchestrator_client: *client\nweb_surfer_client: *client\nfile_surfer_client: *client\naction_guard_client: *client\nplanner_client: *client\ncoder_client: *r1_client\ntester_client: *r1_client\nhost_client: *r1_client\nparser_client: *client\n";React.useEffect(()=>{if(isOpen){setHasChanges(false);setValidationWarning(null);// Load settings when modal opens
const loadSettings=async()=>{if(user!==null&&user!==void 0&&user.email){try{var _settings$allowed_web;const settings=await settingsAPI.getSettings(user.email);updateConfig(settings);// Initialize the cached websites from loaded settings
setCachedWebsites(settings.allowed_websites||[]);setAllowedlistEnabled(Boolean((_settings$allowed_web=settings.allowed_websites)===null||_settings$allowed_web===void 0?void 0:_settings$allowed_web.length));}catch(error){console.error("Failed to load settings");}}};loadSettings();}},[isOpen,user===null||user===void 0?void 0:user.email]);const handleUpdateConfig=async changes=>{// updateConfig(changes);
// console.log('changes:',changes)
setHasChanges(true);// Save to database
if(user!==null&&user!==void 0&&user.email){try{const updatedConfig=Object.assign({},config,changes);const res=await settingsAPI.updateSettings(user.email,updatedConfig);updateConfig({model_configs:res.config.model_configs,model_name:res.config.model_name});}catch(error){console.error("Failed to save settings:",error);}}};const handleResetDefaults=async()=>{resetToDefaults();setCachedWebsites([]);// Clear the list of websites manually added by people
setHasChanges(true);// Save default settings to database
if(user!==null&&user!==void 0&&user.email){try{const defaultConfig=useSettingsStore.getState().config;await settingsAPI.updateSettings(user.email,defaultConfig);}catch(error){console.error("Failed to save default settings:",error);}}};const addWebsite=()=>{if(websiteInput&&!cachedWebsites.includes(websiteInput)){const updatedList=[].concat(_toConsumableArray(cachedWebsites),[websiteInput]);setCachedWebsites(updatedList);handleUpdateConfig({allowed_websites:updatedList});setWebsiteInput("");setValidationWarning(null);}};const removeWebsite=site=>{const updatedList=cachedWebsites.filter(item=>item!==site);setCachedWebsites(updatedList);handleUpdateConfig({allowed_websites:updatedList});};const handleClose=()=>{// Check if allowedlist is enabled but no websites are added
if(allowedlistEnabled&&cachedWebsites.length===0){setValidationWarning("You must add at least one website to the Allowed Websites list or turn off this feature");return;}setValidationWarning(null);onClose();};const validateYamlConfig=content=>{const requiredClients=["orchestrator_client","coder_client","web_surfer_client","file_surfer_client"];const hasAllClients=requiredClients.every(client=>content.includes(client));if(!hasAllClients){message.error("YAML must include all required model clients: "+requiredClients.join(", "));return false;}return true;};const handleYamlFileUpload=async file=>{try{const reader=new FileReader();reader.onload=e=>{var _e$target;const content=(_e$target=e.target)===null||_e$target===void 0?void 0:_e$target.result;if(validateYamlConfig(content)){handleUpdateConfig({model_configs:content,model_name:modelLabel});message.success("YAML configuration imported successfully");}};reader.onerror=()=>{message.error("Failed to read the YAML file");};reader.readAsText(file);}catch(error){message.error("Failed to import YAML configuration");console.error("Error importing YAML:",error);}return false;// Prevent default upload behavior
};const updateModelInConfig=_ref2=>{let{value:modelName,label:modelLabel}=_ref2;setModelLabel(modelLabel);try{if(modelName==="azure-ai-foundry"){handleUpdateConfig({model_configs:AZURE_AI_FOUNDRY_YAML,model_name:modelLabel});message.success("Azure AI Foundry configuration applied");return;}if(modelName==="openrouter"){handleUpdateConfig({model_configs:OPENROUTER_YAML,model_name:modelLabel});message.success("OpenRouter configuration applied");return;}if(modelName==="hepai-foundry"){handleUpdateConfig({model_configs:HEPAI_FOUNDRY_YAML,model_name:modelLabel});message.success("HepAI configuration applied");return;}if(modelName==="drsai-foundry"){handleUpdateConfig({model_configs:DRSAI_FOUNDRY_YAML,model_name:modelLabel});message.success("Dr.Sai configuration applied");return;}if(modelName==="ollama"){handleUpdateConfig({model_configs:OLLAMA_YAML,model_name:modelLabel});message.success("Ollama configuration applied");return;}// For OpenAI models, reset YAML to default with only client and selected model
handleUpdateConfig({model_configs:generateOpenAIModelConfig(modelName),model_name:modelLabel});message.success("OpenAI model configuration applied");}catch(error){console.error("Error updating model in config:",error);message.error("Failed to update model configuration");}};return/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement(Modal,{open:isOpen,onCancel:handleClose,closable:!(allowedlistEnabled&&cachedWebsites.length===0),footer:[/*#__PURE__*/React.createElement("div",{key:"footer",className:"mt-12 space-y-2"},validationWarning&&/*#__PURE__*/React.createElement("div",{className:"text-red-500 text-sm"},validationWarning),hasChanges&&/*#__PURE__*/React.createElement("div",{className:"text-secondary text-sm italic"},"Warning: Settings changes will only apply when you create a new session"),/*#__PURE__*/React.createElement("div",{className:"flex gap-2 justify-end"},/*#__PURE__*/React.createElement(Button,{key:"reset",onClick:handleResetDefaults},"Reset to Defaults")))],width:700},/*#__PURE__*/React.createElement("div",{className:"mt-12 space-y-4"},/*#__PURE__*/React.createElement(Tabs,{tabPosition:"left",items:[{key:"general",label:"General",children:/*#__PURE__*/React.createElement("div",{className:"space-y-6 px-4"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between"},/*#__PURE__*/React.createElement("span",{className:"text-primary"},darkMode==="dark"?"Dark Mode":"Light Mode"),/*#__PURE__*/React.createElement("button",{onClick:()=>setDarkMode(darkMode==="dark"?"light":"dark"),className:"text-secondary hover:text-primary"},darkMode==="dark"?/*#__PURE__*/React.createElement(MoonIcon,{className:"h-6 w-6"}):/*#__PURE__*/React.createElement(SunIcon,{className:"h-6 w-6"}))),/*#__PURE__*/React.createElement(Divider,null),/*#__PURE__*/React.createElement("div",{className:"space-y-4"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between"},/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-2"},"Action Approval Policy",/*#__PURE__*/React.createElement(Tooltip,{title:"Controls when approval is required before taking actions"},/*#__PURE__*/React.createElement(InfoCircleOutlined,{className:"text-secondary hover:text-primary cursor-help"}))),/*#__PURE__*/React.createElement(Select,{value:config.approval_policy,onChange:value=>handleUpdateConfig({approval_policy:value}),style:{width:200},options:[{value:"never",label:"Never require approval"},{value:"auto-conservative",label:"AI based judgement"},{value:"always",label:"Always require approval"}]})),/*#__PURE__*/React.createElement(Divider,null),/*#__PURE__*/React.createElement("div",{className:"space-y-4"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between"},/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-2"},"Allowed Websites List",/*#__PURE__*/React.createElement(Tooltip,{title:"When enabled, Magentic-UI will only be able to visit websites you add to the list below.s"},/*#__PURE__*/React.createElement(InfoCircleOutlined,{className:"text-secondary hover:text-primary cursor-help"}))),cachedWebsites.length===0&&/*#__PURE__*/React.createElement(Switch,{checked:allowedlistEnabled,checkedChildren:"Restricted to List",unCheckedChildren:"All Websites Allowed",onChange:checked=>{setAllowedlistEnabled(checked);if(!checked){setCachedWebsites([]);handleUpdateConfig({allowed_websites:[]});setValidationWarning(null);}}})),/*#__PURE__*/React.createElement(Space,{direction:"vertical",style:{width:"100%"}},allowedlistEnabled||cachedWebsites.length>0?/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("div",{className:"flex w-full gap-2"},/*#__PURE__*/React.createElement(Input,{placeholder:"https://example.com",value:websiteInput,onChange:e=>setWebsiteInput(e.target.value),onPressEnter:addWebsite,className:"flex-1"}),/*#__PURE__*/React.createElement(Button,{icon:/*#__PURE__*/React.createElement(Plus,{size:16}),onClick:addWebsite},"Add")),/*#__PURE__*/React.createElement("div",null,cachedWebsites.length===0?/*#__PURE__*/React.createElement("div",null):cachedWebsites.map((site,index)=>/*#__PURE__*/React.createElement(Tag,{key:index,closable:true,onClose:()=>removeWebsite(site),style:{margin:"0 8px 8px 0"}},site)))):/*#__PURE__*/React.createElement("div",{className:"text-secondary italic"})))))},{key:"advanced",label:"Advanced",children:/*#__PURE__*/React.createElement("div",{className:"space-y-4 px-4"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between"},/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-2"},"Allow Replans",/*#__PURE__*/React.createElement(Tooltip,{title:"When enabled, Magentic-UI will automatically replan if the current plan is not working or you change the original request"},/*#__PURE__*/React.createElement(InfoCircleOutlined,{className:"text-secondary hover:text-primary cursor-help"}))),/*#__PURE__*/React.createElement(Switch,{checked:config.allow_for_replans,checkedChildren:"ON",unCheckedChildren:"OFF",onChange:checked=>handleUpdateConfig({allow_for_replans:checked})})),/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between"},/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-2"},"Retrieve Relevant Plans",/*#__PURE__*/React.createElement(Tooltip,{title:"Controls how Magentic-UI retrieves and uses relevant plans from previous sessions"},/*#__PURE__*/React.createElement(InfoCircleOutlined,{className:"text-secondary hover:text-primary cursor-help"}))),/*#__PURE__*/React.createElement(Select,{value:config.retrieve_relevant_plans,onChange:value=>handleUpdateConfig({retrieve_relevant_plans:value}),style:{width:200},options:[{value:"never",label:/*#__PURE__*/React.createElement(Tooltip,{title:"No plan retrieval"},"No plan retrieval")},{value:"hint",label:/*#__PURE__*/React.createElement(Tooltip,{title:"Retrieve most relevant saved plan as hints for new plans"},"Retrieve plans as hints")},{value:"reuse",label:/*#__PURE__*/React.createElement(Tooltip,{title:"Retrieve most relevant saved plan to be used directly"},"Retrieve plans to use directly")}]})),/*#__PURE__*/React.createElement(Divider,null),/*#__PURE__*/React.createElement("div",{className:"space-y-4"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between"},/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-2"},"Storage Management",/*#__PURE__*/React.createElement(Tooltip,{title:"Manage browser storage used by DrSai"},/*#__PURE__*/React.createElement(InfoCircleOutlined,{className:"text-secondary hover:text-primary cursor-help"})))),/*#__PURE__*/React.createElement("div",{className:"space-y-2"},/*#__PURE__*/React.createElement("div",{className:"text-sm text-secondary"},"Current usage: ",getStorageUsageString()),/*#__PURE__*/React.createElement("div",{className:"flex gap-2"},/*#__PURE__*/React.createElement(Button,{size:"small",onClick:()=>{clearMessageCache();message.success('Message cache cleared');}},"Clear Message Cache"),/*#__PURE__*/React.createElement(Button,{size:"small",danger:true,onClick:()=>{Modal.confirm({title:'Clear All DrSai Storage',content:'This will clear all DrSai data including settings, message cache, and other stored data. Are you sure?',onOk:()=>{clearDrSaiStorage();message.success('All DrSai storage cleared');// Reload page to reset state
setTimeout(()=>window.location.reload(),1000);}});}},"Clear All Storage")))))},{key:"model",label:"Model Configuration",children:/*#__PURE__*/React.createElement("div",{className:"space-y-4 px-4"},/*#__PURE__*/React.createElement("div",{className:"flex flex-col gap-2"},/*#__PURE__*/React.createElement("div",{className:"flex items-center justify-between"},/*#__PURE__*/React.createElement("span",{className:"flex items-center gap-2"},"Model Configuration",/*#__PURE__*/React.createElement(Tooltip,{title:/*#__PURE__*/React.createElement(React.Fragment,null,/*#__PURE__*/React.createElement("p",null,"YAML configuration for the underlying LLM of the agents."," "),/*#__PURE__*/React.createElement("p",null," ","The configuration uses AutoGen ChatCompletionClient format."),/*#__PURE__*/React.createElement("p",null,"Must include configurations for: orchestrator_client, coder_client, web_surfer_client, and file_surfer_client."),/*#__PURE__*/React.createElement("p",null,"Each client should follow the AutoGen ChatCompletionClient specification with provider, config (model, etc), and max_retries."),/*#__PURE__*/React.createElement("p",null,"Changes require a new session to take effect."))},/*#__PURE__*/React.createElement(InfoCircleOutlined,{className:"text-secondary hover:text-primary cursor-help"}))),/*#__PURE__*/React.createElement(Upload,{accept:".yaml,.yml",showUploadList:false,beforeUpload:handleYamlFileUpload},/*#__PURE__*/React.createElement(Button,{icon:/*#__PURE__*/React.createElement(UploadOutlined,null)},"Import YAML"))),/*#__PURE__*/React.createElement("div",{className:"flex gap-2 items-center"},/*#__PURE__*/React.createElement("div",{className:"flex-grow"},/*#__PURE__*/React.createElement("div",{className:"flex items-center gap-2 mb-1"},/*#__PURE__*/React.createElement("span",{className:"text-sm"},"Select LLM for All Clients"),/*#__PURE__*/React.createElement(Tooltip,{title:"This will update the model configuration for all agent clients (orchestrator, coder, web surfer, and file surfer)"},/*#__PURE__*/React.createElement(InfoCircleOutlined,{className:"text-primary hover:text-primary cursor-help"}))),/*#__PURE__*/React.createElement(Select,{labelInValue:true,style:{width:"100%"},options:settings_MODEL_OPTIONS,onChange:option=>updateModelInConfig(option),placeholder:"Select model to use for all clients"}))),/*#__PURE__*/React.createElement(Divider,null),/*#__PURE__*/React.createElement("div",null,/*#__PURE__*/React.createElement("div",{className:"text-sm mb-1"},"Advanced Configuration (YAML)"),/*#__PURE__*/React.createElement(MonacoEditor,{value:config.model_configs,onChange:value=>{handleUpdateConfig({model_configs:value});},language:"yaml",height:"300px",options:{fontFamily:"monospace",minimap:{enabled:false},wordWrap:"on",scrollBeyondLastLine:false,theme:darkMode==="dark"?"vs-dark":"light"}}))))}]}))),/*#__PURE__*/React.createElement(SignInModal,{isVisible:isEmailModalOpen,onClose:()=>setIsEmailModalOpen(false)}));};/* harmony default export */ var settings = ((/* unused pure expression or super */ null && (SettingsMenu)));
;// ./src/pages/settings/Config.tsx











// ── 个人信息 ──────────────────────────────────────────────────────────────────

const ProfileSection = _ref => {
  let {
    user
  } = _ref;
  const {
    darkMode
  } = (0,react.useContext)(provider/* appContext */.v);
  const initial = String(user.name || user.email || "?").charAt(0).toUpperCase();
  return /*#__PURE__*/react.createElement("div", {
    className: "flex justify-center pt-6"
  }, /*#__PURE__*/react.createElement("div", {
    className: "w-full max-w-sm rounded-2xl border shadow-modern overflow-hidden " + (darkMode === "dark" ? "bg-[#0f0f0f]/60 border-border-primary/40" : "bg-white/90 border-gray-200/70")
  }, /*#__PURE__*/react.createElement("div", {
    className: "h-20 bg-gradient-to-br from-violet-500/30 via-purple-500/20 to-blue-500/10"
  }), /*#__PURE__*/react.createElement("div", {
    className: "flex justify-center -mt-10 mb-3"
  }, user.avatar_url ? /*#__PURE__*/react.createElement("img", {
    src: user.avatar_url,
    alt: user.name,
    className: "w-20 h-20 rounded-2xl ring-4 ring-offset-2 ring-accent/30 object-cover"
  }) : /*#__PURE__*/react.createElement("div", {
    className: "w-20 h-20 rounded-2xl ring-4 ring-offset-2 ring-accent/30 bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg"
  }, initial)), /*#__PURE__*/react.createElement("div", {
    className: "px-6 pb-6 text-center"
  }, /*#__PURE__*/react.createElement("h2", {
    className: "text-lg font-semibold text-primary leading-tight"
  }, user.name || "—"), /*#__PURE__*/react.createElement("p", {
    className: "mt-1 text-sm " + (darkMode === "dark" ? "text-secondary" : "text-gray-500")
  }, user.email), /*#__PURE__*/react.createElement("div", {
    className: "mt-5 rounded-xl border p-4 text-left space-y-3 " + (darkMode === "dark" ? "border-border-primary/30 bg-white/[0.03]" : "border-gray-100 bg-gray-50/80")
  }, /*#__PURE__*/react.createElement(ConfigRow, {
    label: "\u7528\u6237\u540D",
    value: user.name || "—"
  }), /*#__PURE__*/react.createElement(ConfigRow, {
    label: "\u90AE\u7BB1",
    value: user.email || "—"
  })))));
};
const ConfigRow = _ref2 => {
  let {
    label,
    value
  } = _ref2;
  return /*#__PURE__*/react.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/react.createElement("span", {
    className: "text-xs text-secondary uppercase tracking-wide font-medium"
  }, label), /*#__PURE__*/react.createElement("span", {
    className: "text-sm text-primary font-medium truncate max-w-[60%]"
  }, value));
};

// ── 智能体设置 ────────────────────────────────────────────────────────────────

const AgentSettingsSection = _ref3 => {
  var _config$allowed_websi;
  let {
    userEmail
  } = _ref3;
  const {
    darkMode
  } = useContext(appContext);
  const {
    config,
    updateConfig,
    resetToDefaults
  } = useSettingsStore();
  const [websiteInput, setWebsiteInput] = React.useState("");
  const [cachedWebsites, setCachedWebsites] = React.useState(config.allowed_websites || []);
  const [allowedlistEnabled, setAllowedlistEnabled] = React.useState(Boolean((_config$allowed_websi = config.allowed_websites) === null || _config$allowed_websi === void 0 ? void 0 : _config$allowed_websi.length));
  const [modelLabel, setModelLabel] = React.useState();
  React.useEffect(() => {
    if (!userEmail) return;
    settingsAPI.getSettings(userEmail).then(settings => {
      var _settings$allowed_web;
      updateConfig(settings);
      setCachedWebsites(settings.allowed_websites || []);
      setAllowedlistEnabled(Boolean((_settings$allowed_web = settings.allowed_websites) === null || _settings$allowed_web === void 0 ? void 0 : _settings$allowed_web.length));
    }).catch(() => {});
  }, [userEmail]);
  const handleUpdateConfig = async changes => {
    if (!userEmail) return;
    try {
      const updatedConfig = Object.assign({}, config, changes);
      const res = await settingsAPI.updateSettings(userEmail, updatedConfig);
      updateConfig({
        model_configs: res.config.model_configs,
        model_name: res.config.model_name
      });
    } catch (_unused) {
      message.error("保存设置失败");
    }
  };
  const addWebsite = () => {
    if (websiteInput && !cachedWebsites.includes(websiteInput)) {
      const updated = [].concat(_toConsumableArray(cachedWebsites), [websiteInput]);
      setCachedWebsites(updated);
      handleUpdateConfig({
        allowed_websites: updated
      });
      setWebsiteInput("");
    }
  };
  const removeWebsite = site => {
    const updated = cachedWebsites.filter(s => s !== site);
    setCachedWebsites(updated);
    handleUpdateConfig({
      allowed_websites: updated
    });
  };
  const handleYamlFileUpload = file => {
    const reader = new FileReader();
    reader.onload = e => {
      var _e$target;
      const content = (_e$target = e.target) === null || _e$target === void 0 ? void 0 : _e$target.result;
      handleUpdateConfig({
        model_configs: content,
        model_name: modelLabel
      });
      message.success("YAML 配置导入成功");
    };
    reader.readAsText(file);
    return false;
  };
  const updateModelInConfig = _ref4 => {
    let {
      value: modelName,
      label
    } = _ref4;
    setModelLabel(label);
    handleUpdateConfig({
      model_configs: generateOpenAIModelConfig(modelName),
      model_name: label
    });
    message.success("模型配置已更新");
  };
  const handleResetDefaults = () => {
    resetToDefaults();
    setCachedWebsites([]);
    if (userEmail) {
      settingsAPI.updateSettings(userEmail, useSettingsStore.getState().config).catch(() => {});
    }
    message.success("已恢复默认设置");
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "space-y-6 px-1 pt-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "text-sm font-semibold text-primary mb-3"
  }, "\u6267\u884C\u7B56\u7565"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-2 text-sm"
  }, "\u64CD\u4F5C\u5BA1\u6279\u7B56\u7565", /*#__PURE__*/React.createElement(Tooltip, {
    title: "\u63A7\u5236\u667A\u80FD\u4F53\u6267\u884C\u64CD\u4F5C\u524D\u662F\u5426\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4"
  }, /*#__PURE__*/React.createElement(InfoCircleOutlined, {
    className: "text-secondary"
  }))), /*#__PURE__*/React.createElement(Select, {
    value: config.approval_policy,
    onChange: value => handleUpdateConfig({
      approval_policy: value
    }),
    style: {
      width: 200
    },
    options: [{
      value: "never",
      label: "从不需要审批"
    }, {
      value: "auto-conservative",
      label: "AI 自动判断"
    }, {
      value: "always",
      label: "始终需要审批"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-2 text-sm"
  }, "\u5141\u8BB8\u91CD\u65B0\u89C4\u5212", /*#__PURE__*/React.createElement(Tooltip, {
    title: "\u5F53\u8BA1\u5212\u4E0D\u53EF\u884C\u65F6\uFF0C\u667A\u80FD\u4F53\u81EA\u52A8\u91CD\u65B0\u5236\u5B9A\u8BA1\u5212"
  }, /*#__PURE__*/React.createElement(InfoCircleOutlined, {
    className: "text-secondary"
  }))), /*#__PURE__*/React.createElement(Switch, {
    checked: config.allow_for_replans,
    checkedChildren: "\u5F00",
    unCheckedChildren: "\u5173",
    onChange: checked => handleUpdateConfig({
      allow_for_replans: checked
    })
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-2 text-sm"
  }, "\u68C0\u7D22\u5386\u53F2\u8BA1\u5212", /*#__PURE__*/React.createElement(Tooltip, {
    title: "\u63A7\u5236\u667A\u80FD\u4F53\u662F\u5426\u68C0\u7D22\u5386\u53F2\u4EFB\u52A1\u7684\u8BA1\u5212\u4F5C\u4E3A\u53C2\u8003"
  }, /*#__PURE__*/React.createElement(InfoCircleOutlined, {
    className: "text-secondary"
  }))), /*#__PURE__*/React.createElement(Select, {
    value: config.retrieve_relevant_plans,
    onChange: value => handleUpdateConfig({
      retrieve_relevant_plans: value
    }),
    style: {
      width: 200
    },
    options: [{
      value: "never",
      label: "不检索"
    }, {
      value: "hint",
      label: "作为提示"
    }, {
      value: "reuse",
      label: "直接复用"
    }]
  })))), /*#__PURE__*/React.createElement(Divider, {
    className: "!my-3"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "text-sm font-semibold text-primary mb-3"
  }, "\u7F51\u7AD9\u8BBF\u95EE\u63A7\u5236"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-2 text-sm"
  }, "\u5141\u8BB8\u8BBF\u95EE\u5217\u8868", /*#__PURE__*/React.createElement(Tooltip, {
    title: "\u5F00\u542F\u540E\uFF0C\u667A\u80FD\u4F53\u53EA\u80FD\u8BBF\u95EE\u5217\u8868\u4E2D\u7684\u7F51\u7AD9"
  }, /*#__PURE__*/React.createElement(InfoCircleOutlined, {
    className: "text-secondary"
  }))), cachedWebsites.length === 0 && /*#__PURE__*/React.createElement(Switch, {
    checked: allowedlistEnabled,
    checkedChildren: "\u9650\u5236\u8BBF\u95EE",
    unCheckedChildren: "\u4E0D\u9650\u5236",
    onChange: checked => {
      setAllowedlistEnabled(checked);
      if (!checked) {
        setCachedWebsites([]);
        handleUpdateConfig({
          allowed_websites: []
        });
      }
    }
  })), (allowedlistEnabled || cachedWebsites.length > 0) && /*#__PURE__*/React.createElement(Space, {
    direction: "vertical",
    style: {
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "https://example.com",
    value: websiteInput,
    onChange: e => setWebsiteInput(e.target.value),
    onPressEnter: addWebsite,
    className: "flex-1"
  }), /*#__PURE__*/React.createElement(Button, {
    icon: /*#__PURE__*/React.createElement(Plus, {
      size: 16
    }),
    onClick: addWebsite
  }, "\u6DFB\u52A0")), /*#__PURE__*/React.createElement("div", null, cachedWebsites.map((site, i) => /*#__PURE__*/React.createElement(Tag, {
    key: i,
    closable: true,
    onClose: () => removeWebsite(site),
    style: {
      margin: "0 8px 8px 0"
    }
  }, site)))))), /*#__PURE__*/React.createElement(Divider, {
    className: "!my-3"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "text-sm font-semibold text-primary mb-3"
  }, "\u6A21\u578B\u914D\u7F6E"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-secondary mb-1"
  }, "\u5FEB\u901F\u9009\u62E9\u6A21\u578B"), /*#__PURE__*/React.createElement(Select, {
    labelInValue: true,
    style: {
      width: "100%"
    },
    options: MODEL_OPTIONS,
    onChange: updateModelInConfig,
    placeholder: "\u9009\u62E9\u6A21\u578B\u5957\u7528\u914D\u7F6E\u6A21\u677F"
  })), /*#__PURE__*/React.createElement(Upload, {
    accept: ".yaml,.yml",
    showUploadList: false,
    beforeUpload: handleYamlFileUpload
  }, /*#__PURE__*/React.createElement(Button, {
    icon: /*#__PURE__*/React.createElement(UploadOutlined, null),
    className: "mt-5"
  }, "\u5BFC\u5165 YAML"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 text-sm text-secondary mb-1"
  }, "\u9AD8\u7EA7\u914D\u7F6E\uFF08YAML\uFF09", /*#__PURE__*/React.createElement(Tooltip, {
    title: "AutoGen ChatCompletionClient \u683C\u5F0F\uFF0C\u5FC5\u987B\u5305\u542B orchestrator_client\u3001coder_client\u3001web_surfer_client\u3001file_surfer_client"
  }, /*#__PURE__*/React.createElement(InfoCircleOutlined, null))), /*#__PURE__*/React.createElement(MonacoEditor, {
    value: config.model_configs,
    onChange: value => handleUpdateConfig({
      model_configs: value
    }),
    language: "yaml",
    height: "280px",
    options: {
      fontFamily: "monospace",
      minimap: {
        enabled: false
      },
      wordWrap: "on",
      scrollBeyondLastLine: false,
      theme: darkMode === "dark" ? "vs-dark" : "light"
    }
  })))), /*#__PURE__*/React.createElement(Divider, {
    className: "!my-3"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "text-sm font-semibold text-primary mb-3"
  }, "\u5B58\u50A8\u7BA1\u7406"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-secondary"
  }, "\u5F53\u524D\u5360\u7528\uFF1A", getStorageUsageString()), /*#__PURE__*/React.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/React.createElement(Button, {
    size: "small",
    onClick: () => {
      clearMessageCache();
      message.success("消息缓存已清除");
    }
  }, "\u6E05\u9664\u6D88\u606F\u7F13\u5B58"), /*#__PURE__*/React.createElement(Button, {
    size: "small",
    danger: true,
    onClick: () => Modal.confirm({
      title: "清除所有 Dr.Sai 数据",
      content: "将清除所有设置、消息缓存等本地数据，操作不可撤销。",
      onOk: () => {
        clearDrSaiStorage();
        message.success("所有数据已清除");
        setTimeout(() => window.location.reload(), 1000);
      }
    })
  }, "\u6E05\u9664\u6240\u6709\u6570\u636E")))), /*#__PURE__*/React.createElement("div", {
    className: "pt-2"
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: handleResetDefaults
  }, "\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E")));
};

// ── 主组件 ────────────────────────────────────────────────────────────────────

const Config = () => {
  const {
    user: ctxUser
  } = (0,react.useContext)(provider/* appContext */.v);
  const user = ctxUser || {};
  const tabItems = [{
    key: "profile",
    label: "个人信息",
    children: /*#__PURE__*/react.createElement(ProfileSection, {
      user: user
    })
  }
  // {
  //   key: "agent",
  //   label: "智能体设置",
  //   children: <AgentSettingsSection userEmail={user.email} />,
  // },
  ];
  return /*#__PURE__*/react.createElement("div", {
    className: "h-full overflow-y-auto px-6 pt-6 pb-10"
  }, /*#__PURE__*/react.createElement("div", {
    className: "max-w-2xl mx-auto"
  }, /*#__PURE__*/react.createElement("h1", {
    className: "text-xl font-semibold text-primary mb-6"
  }, "\u914D\u7F6E"), /*#__PURE__*/react.createElement(tabs/* default */.A, {
    tabPosition: "left",
    items: tabItems
  })));
};
/* harmony default export */ var settings_Config = (Config);

/***/ }),

/***/ 73268:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   cg: function() { return /* binding */ checkAndCleanStorage; }
/* harmony export */ });
/* unused harmony exports getStorageInfo, clearDrSaiStorage, clearMessageCache, safeSetItem, getStorageUsageString */
/* harmony import */ var core_js_modules_es_array_sort_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(26910);
/* harmony import */ var core_js_modules_es_array_sort_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(core_js_modules_es_array_sort_js__WEBPACK_IMPORTED_MODULE_0__);
// localStorage管理工具函数
/**
 * 获取localStorage使用情况
 */const getStorageInfo=()=>{// 服务器端返回默认值
if(typeof window==="undefined"){return{used:0,usedMB:0,usagePercent:0,items:[]};}const items=[];let totalUsed=0;for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key){const value=localStorage.getItem(key)||'';const size=new Blob([value]).size;totalUsed+=size;items.push({key,size,sizeMB:size/1024/1024});}}// 按大小排序
items.sort((a,b)=>b.size-a.size);const quota=5*1024*1024;// 估算5MB配额
const usagePercent=totalUsed/quota*100;return{used:totalUsed,usedMB:totalUsed/1024/1024,usagePercent,items};};/**
 * 清理DrSai相关的localStorage数据
 */const clearDrSaiStorage=()=>{if(typeof window==="undefined")return;const keysToRemove=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&(key.startsWith('drsai-')||key.includes('drsai'))){keysToRemove.push(key);}}keysToRemove.forEach(key=>{localStorage.removeItem(key);});};/**
 * 清理消息缓存
 */const clearMessageCache=()=>{if(typeof window==="undefined")return;localStorage.removeItem('drsai-message-cache');};/**
 * 检查存储空间并在必要时清理
 */const checkAndCleanStorage=()=>{if(typeof window==="undefined")return false;const info=getStorageInfo();// 如果使用超过80%，清理缓存
if(info.usagePercent>80){console.warn('localStorage usage high, clearing message cache');clearMessageCache();return true;}return false;};/**
 * 安全的localStorage设置，带有错误处理
 */const safeSetItem=(key,value)=>{if(typeof window==="undefined")return false;try{localStorage.setItem(key,value);return true;}catch(error){console.warn("Failed to set localStorage item '"+key+"':",error);if(error instanceof Error&&error.name==='QuotaExceededError'){// 尝试清理并重试
const cleaned=checkAndCleanStorage();if(cleaned){try{localStorage.setItem(key,value);return true;}catch(retryError){console.error('Failed to set item even after cleanup:',retryError);}}}return false;}};/**
 * 获取存储使用情况的人类可读字符串
 */const getStorageUsageString=()=>{const info=getStorageInfo();return info.usedMB.toFixed(2)+"MB used ("+info.usagePercent.toFixed(1)+"%)";};// 在开发环境下，将这些函数暴露到全局对象，方便调试
if(typeof window!=='undefined'&&"production"==='development'){}

/***/ })

}]);
//# sourceMappingURL=d18db970b4ccb5a5536150927de99f43531ae49a-67cd5000cedf9be28305.js.map