"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[1266],{

/***/ 77128:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ table; }
});

// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./node_modules/rc-table/es/constant.js
var EXPAND_COLUMN = {};
var INTERNAL_HOOKS = 'rc-table-internal-hook';
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/slicedToArray.js + 1 modules
var slicedToArray = __webpack_require__(5544);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useEvent.js
var useEvent = __webpack_require__(26956);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useLayoutEffect.js
var useLayoutEffect = __webpack_require__(30981);
// EXTERNAL MODULE: ./node_modules/rc-util/es/isEqual.js
var isEqual = __webpack_require__(43210);
// EXTERNAL MODULE: ./node_modules/react-dom/index.js
var react_dom = __webpack_require__(40961);
;// ./node_modules/@rc-component/context/es/context.js






function createContext(defaultValue) {
  var Context = /*#__PURE__*/react.createContext(undefined);
  var Provider = function Provider(_ref) {
    var value = _ref.value,
      children = _ref.children;
    var valueRef = react.useRef(value);
    valueRef.current = value;
    var _React$useState = react.useState(function () {
        return {
          getValue: function getValue() {
            return valueRef.current;
          },
          listeners: new Set()
        };
      }),
      _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 1),
      context = _React$useState2[0];
    (0,useLayoutEffect/* default */.A)(function () {
      (0,react_dom.unstable_batchedUpdates)(function () {
        context.listeners.forEach(function (listener) {
          listener(value);
        });
      });
    }, [value]);
    return /*#__PURE__*/react.createElement(Context.Provider, {
      value: context
    }, children);
  };
  return {
    Context: Context,
    Provider: Provider,
    defaultValue: defaultValue
  };
}

/** e.g. useSelect(userContext) => user */

/** e.g. useSelect(userContext, user => user.name) => user.name */

/** e.g. useSelect(userContext, ['name', 'age']) => user { name, age } */

/** e.g. useSelect(userContext, 'name') => user.name */

function useContext(holder, selector) {
  var eventSelector = (0,useEvent/* default */.A)(typeof selector === 'function' ? selector : function (ctx) {
    if (selector === undefined) {
      return ctx;
    }
    if (!Array.isArray(selector)) {
      return ctx[selector];
    }
    var obj = {};
    selector.forEach(function (key) {
      obj[key] = ctx[key];
    });
    return obj;
  });
  var context = react.useContext(holder === null || holder === void 0 ? void 0 : holder.Context);
  var _ref2 = context || {},
    listeners = _ref2.listeners,
    getValue = _ref2.getValue;
  var valueRef = react.useRef();
  valueRef.current = eventSelector(context ? getValue() : holder === null || holder === void 0 ? void 0 : holder.defaultValue);
  var _React$useState3 = react.useState({}),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    forceUpdate = _React$useState4[1];
  (0,useLayoutEffect/* default */.A)(function () {
    if (!context) {
      return;
    }
    function trigger(nextValue) {
      var nextSelectorValue = eventSelector(nextValue);
      if (!(0,isEqual/* default */.A)(valueRef.current, nextSelectorValue, true)) {
        forceUpdate({});
      }
    }
    listeners.add(trigger);
    return function () {
      listeners.delete(trigger);
    };
  }, [context]);
  return valueRef.current;
}
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var es_ref = __webpack_require__(8719);
;// ./node_modules/@rc-component/context/es/Immutable.js



/**
 * Create Immutable pair for `makeImmutable` and `responseImmutable`.
 */
function createImmutable() {
  var ImmutableContext = /*#__PURE__*/react.createContext(null);

  /**
   * Get render update mark by `makeImmutable` root.
   * Do not deps on the return value as render times
   * but only use for `useMemo` or `useCallback` deps.
   */
  function useImmutableMark() {
    return react.useContext(ImmutableContext);
  }

  /**
  * Wrapped Component will be marked as Immutable.
  * When Component parent trigger render,
  * it will notice children component (use with `responseImmutable`) node that parent has updated.
  * @param Component Passed Component
  * @param triggerRender Customize trigger `responseImmutable` children re-render logic. Default will always trigger re-render when this component re-render.
  */
  function makeImmutable(Component, shouldTriggerRender) {
    var refAble = (0,es_ref/* supportRef */.f3)(Component);
    var ImmutableComponent = function ImmutableComponent(props, ref) {
      var refProps = refAble ? {
        ref: ref
      } : {};
      var renderTimesRef = react.useRef(0);
      var prevProps = react.useRef(props);

      // If parent has the context, we do not wrap it
      var mark = useImmutableMark();
      if (mark !== null) {
        return /*#__PURE__*/react.createElement(Component, (0,esm_extends/* default */.A)({}, props, refProps));
      }
      if (
      // Always trigger re-render if not provide `notTriggerRender`
      !shouldTriggerRender || shouldTriggerRender(prevProps.current, props)) {
        renderTimesRef.current += 1;
      }
      prevProps.current = props;
      return /*#__PURE__*/react.createElement(ImmutableContext.Provider, {
        value: renderTimesRef.current
      }, /*#__PURE__*/react.createElement(Component, (0,esm_extends/* default */.A)({}, props, refProps)));
    };
    if (false) {}
    return refAble ? /*#__PURE__*/react.forwardRef(ImmutableComponent) : ImmutableComponent;
  }

  /**
   * Wrapped Component with `React.memo`.
   * But will rerender when parent with `makeImmutable` rerender.
   */
  function responseImmutable(Component, propsAreEqual) {
    var refAble = (0,es_ref/* supportRef */.f3)(Component);
    var ImmutableComponent = function ImmutableComponent(props, ref) {
      var refProps = refAble ? {
        ref: ref
      } : {};
      useImmutableMark();
      return /*#__PURE__*/react.createElement(Component, (0,esm_extends/* default */.A)({}, props, refProps));
    };
    if (false) {}
    return refAble ? /*#__PURE__*/react.memo( /*#__PURE__*/react.forwardRef(ImmutableComponent), propsAreEqual) : /*#__PURE__*/react.memo(ImmutableComponent, propsAreEqual);
  }
  return {
    makeImmutable: makeImmutable,
    responseImmutable: responseImmutable,
    useImmutableMark: useImmutableMark
  };
}
;// ./node_modules/@rc-component/context/es/index.js



// For legacy usage, we export it directly
var _createImmutable = createImmutable(),
  makeImmutable = _createImmutable.makeImmutable,
  responseImmutable = _createImmutable.responseImmutable,
  useImmutableMark = _createImmutable.useImmutableMark;

;// ./node_modules/rc-table/es/context/TableContext.js

var TableContext_createImmutable = createImmutable(),
  TableContext_makeImmutable = TableContext_createImmutable.makeImmutable,
  TableContext_responseImmutable = TableContext_createImmutable.responseImmutable,
  TableContext_useImmutableMark = TableContext_createImmutable.useImmutableMark;

var TableContext = createContext();
/* harmony default export */ var context_TableContext = (TableContext);
;// ./node_modules/rc-table/es/hooks/useRenderTimes.js
/* istanbul ignore file */

function useRenderTimes(props, debug) {
  // Render times
  var timesRef = React.useRef(0);
  timesRef.current += 1;

  // Props changed
  var propsRef = React.useRef(props);
  var keys = [];
  Object.keys(props || {}).map(function (key) {
    var _propsRef$current;
    if ((props === null || props === void 0 ? void 0 : props[key]) !== ((_propsRef$current = propsRef.current) === null || _propsRef$current === void 0 ? void 0 : _propsRef$current[key])) {
      keys.push(key);
    }
  });
  propsRef.current = props;

  // Cache keys since React rerender may cause it lost
  var keysRef = React.useRef([]);
  if (keys.length) {
    keysRef.current = keys;
  }
  React.useDebugValue(timesRef.current);
  React.useDebugValue(keysRef.current.join(', '));
  if (debug) {
    console.log("".concat(debug, ":"), timesRef.current, keysRef.current);
  }
  return timesRef.current;
}
/* harmony default export */ var hooks_useRenderTimes = ((/* unused pure expression or super */ null && ( false ? 0 : function () {})));
var RenderBlock = /*#__PURE__*/(/* unused pure expression or super */ null && (React.memo(function () {
  var times = useRenderTimes();
  return /*#__PURE__*/React.createElement("h1", null, "Render Times: ", times);
})));
if (false) {}
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/typeof.js
var esm_typeof = __webpack_require__(82284);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectSpread2.js
var objectSpread2 = __webpack_require__(89379);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/defineProperty.js
var defineProperty = __webpack_require__(64467);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMemo.js
var useMemo = __webpack_require__(28104);
// EXTERNAL MODULE: ./node_modules/rc-util/es/utils/get.js
var get = __webpack_require__(16300);
// EXTERNAL MODULE: ./node_modules/rc-util/es/warning.js
var es_warning = __webpack_require__(68210);
;// ./node_modules/rc-table/es/context/PerfContext.js

// TODO: Remove when use `responsiveImmutable`
var PerfContext = /*#__PURE__*/react.createContext({
  renderWithProps: false
});
/* harmony default export */ var context_PerfContext = (PerfContext);
;// ./node_modules/rc-table/es/utils/valueUtil.js
var INTERNAL_KEY_PREFIX = 'RC_TABLE_KEY';
function toArray(arr) {
  if (arr === undefined || arr === null) {
    return [];
  }
  return Array.isArray(arr) ? arr : [arr];
}
function getColumnsKey(columns) {
  var columnKeys = [];
  var keys = {};
  columns.forEach(function (column) {
    var _ref = column || {},
      key = _ref.key,
      dataIndex = _ref.dataIndex;
    var mergedKey = key || toArray(dataIndex).join('-') || INTERNAL_KEY_PREFIX;
    while (keys[mergedKey]) {
      mergedKey = "".concat(mergedKey, "_next");
    }
    keys[mergedKey] = true;
    columnKeys.push(mergedKey);
  });
  return columnKeys;
}
function validateValue(val) {
  return val !== null && val !== undefined;
}
function validNumberValue(value) {
  return typeof value === 'number' && !Number.isNaN(value);
}
;// ./node_modules/rc-table/es/Cell/useCellRender.js










function isRenderCell(data) {
  return data && (0,esm_typeof/* default */.A)(data) === 'object' && !Array.isArray(data) && ! /*#__PURE__*/react.isValidElement(data);
}
function useCellRender(record, dataIndex, renderIndex, children, render, shouldCellUpdate) {
  // TODO: Remove this after next major version
  var perfRecord = react.useContext(context_PerfContext);
  var mark = TableContext_useImmutableMark();

  // ======================== Render ========================
  var retData = (0,useMemo/* default */.A)(function () {
    if (validateValue(children)) {
      return [children];
    }
    var path = dataIndex === null || dataIndex === undefined || dataIndex === '' ? [] : Array.isArray(dataIndex) ? dataIndex : [dataIndex];
    var value = (0,get/* default */.A)(record, path);

    // Customize render node
    var returnChildNode = value;
    var returnCellProps = undefined;
    if (render) {
      var renderData = render(value, record, renderIndex);
      if (isRenderCell(renderData)) {
        if (false) {}
        returnChildNode = renderData.children;
        returnCellProps = renderData.props;
        perfRecord.renderWithProps = true;
      } else {
        returnChildNode = renderData;
      }
    }
    return [returnChildNode, returnCellProps];
  }, [
  // Force update deps
  mark,
  // Normal deps
  record, children, dataIndex, render, renderIndex], function (prev, next) {
    if (shouldCellUpdate) {
      var _prev = (0,slicedToArray/* default */.A)(prev, 2),
        prevRecord = _prev[1];
      var _next = (0,slicedToArray/* default */.A)(next, 2),
        nextRecord = _next[1];
      return shouldCellUpdate(nextRecord, prevRecord);
    }

    // Legacy mode should always update
    if (perfRecord.renderWithProps) {
      return true;
    }
    return !(0,isEqual/* default */.A)(prev, next, true);
  });
  return retData;
}
;// ./node_modules/rc-table/es/Cell/useHoverState.js


/** Check if cell is in hover range */
function inHoverRange(cellStartRow, cellRowSpan, startRow, endRow) {
  var cellEndRow = cellStartRow + cellRowSpan - 1;
  return cellStartRow <= endRow && cellEndRow >= startRow;
}
function useHoverState(rowIndex, rowSpan) {
  return useContext(context_TableContext, function (ctx) {
    var hovering = inHoverRange(rowIndex, rowSpan || 1, ctx.hoverStartRow, ctx.hoverEndRow);
    return [hovering, ctx.onHover];
  });
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/index.js
var es = __webpack_require__(81470);
;// ./node_modules/rc-table/es/Cell/index.js













var getTitleFromCellRenderChildren = function getTitleFromCellRenderChildren(_ref) {
  var ellipsis = _ref.ellipsis,
    rowType = _ref.rowType,
    children = _ref.children;
  var title;
  var ellipsisConfig = ellipsis === true ? {
    showTitle: true
  } : ellipsis;
  if (ellipsisConfig && (ellipsisConfig.showTitle || rowType === 'header')) {
    if (typeof children === 'string' || typeof children === 'number') {
      title = children.toString();
    } else if ( /*#__PURE__*/react.isValidElement(children) && typeof children.props.children === 'string') {
      title = children.props.children;
    }
  }
  return title;
};
function Cell(props) {
  var _ref2, _ref3, _legacyCellProps$colS, _ref4, _ref5, _legacyCellProps$rowS, _additionalProps$titl, _classNames;
  if (false) {}
  var Component = props.component,
    children = props.children,
    ellipsis = props.ellipsis,
    scope = props.scope,
    prefixCls = props.prefixCls,
    className = props.className,
    align = props.align,
    record = props.record,
    render = props.render,
    dataIndex = props.dataIndex,
    renderIndex = props.renderIndex,
    shouldCellUpdate = props.shouldCellUpdate,
    index = props.index,
    rowType = props.rowType,
    colSpan = props.colSpan,
    rowSpan = props.rowSpan,
    fixLeft = props.fixLeft,
    fixRight = props.fixRight,
    firstFixLeft = props.firstFixLeft,
    lastFixLeft = props.lastFixLeft,
    firstFixRight = props.firstFixRight,
    lastFixRight = props.lastFixRight,
    appendNode = props.appendNode,
    _props$additionalProp = props.additionalProps,
    additionalProps = _props$additionalProp === void 0 ? {} : _props$additionalProp,
    isSticky = props.isSticky;
  var cellPrefixCls = "".concat(prefixCls, "-cell");
  var _useContext = useContext(context_TableContext, ['supportSticky', 'allColumnsFixedLeft', 'rowHoverable']),
    supportSticky = _useContext.supportSticky,
    allColumnsFixedLeft = _useContext.allColumnsFixedLeft,
    rowHoverable = _useContext.rowHoverable;

  // ====================== Value =======================
  var _useCellRender = useCellRender(record, dataIndex, renderIndex, children, render, shouldCellUpdate),
    _useCellRender2 = (0,slicedToArray/* default */.A)(_useCellRender, 2),
    childNode = _useCellRender2[0],
    legacyCellProps = _useCellRender2[1];

  // ====================== Fixed =======================
  var fixedStyle = {};
  var isFixLeft = typeof fixLeft === 'number' && supportSticky;
  var isFixRight = typeof fixRight === 'number' && supportSticky;
  if (isFixLeft) {
    fixedStyle.position = 'sticky';
    fixedStyle.left = fixLeft;
  }
  if (isFixRight) {
    fixedStyle.position = 'sticky';
    fixedStyle.right = fixRight;
  }

  // ================ RowSpan & ColSpan =================
  var mergedColSpan = (_ref2 = (_ref3 = (_legacyCellProps$colS = legacyCellProps === null || legacyCellProps === void 0 ? void 0 : legacyCellProps.colSpan) !== null && _legacyCellProps$colS !== void 0 ? _legacyCellProps$colS : additionalProps.colSpan) !== null && _ref3 !== void 0 ? _ref3 : colSpan) !== null && _ref2 !== void 0 ? _ref2 : 1;
  var mergedRowSpan = (_ref4 = (_ref5 = (_legacyCellProps$rowS = legacyCellProps === null || legacyCellProps === void 0 ? void 0 : legacyCellProps.rowSpan) !== null && _legacyCellProps$rowS !== void 0 ? _legacyCellProps$rowS : additionalProps.rowSpan) !== null && _ref5 !== void 0 ? _ref5 : rowSpan) !== null && _ref4 !== void 0 ? _ref4 : 1;

  // ====================== Hover =======================
  var _useHoverState = useHoverState(index, mergedRowSpan),
    _useHoverState2 = (0,slicedToArray/* default */.A)(_useHoverState, 2),
    hovering = _useHoverState2[0],
    onHover = _useHoverState2[1];
  var onMouseEnter = (0,es/* useEvent */._q)(function (event) {
    var _additionalProps$onMo;
    if (record) {
      onHover(index, index + mergedRowSpan - 1);
    }
    additionalProps === null || additionalProps === void 0 || (_additionalProps$onMo = additionalProps.onMouseEnter) === null || _additionalProps$onMo === void 0 || _additionalProps$onMo.call(additionalProps, event);
  });
  var onMouseLeave = (0,es/* useEvent */._q)(function (event) {
    var _additionalProps$onMo2;
    if (record) {
      onHover(-1, -1);
    }
    additionalProps === null || additionalProps === void 0 || (_additionalProps$onMo2 = additionalProps.onMouseLeave) === null || _additionalProps$onMo2 === void 0 || _additionalProps$onMo2.call(additionalProps, event);
  });

  // ====================== Render ======================
  if (mergedColSpan === 0 || mergedRowSpan === 0) {
    return null;
  }

  // >>>>> Title
  var title = (_additionalProps$titl = additionalProps.title) !== null && _additionalProps$titl !== void 0 ? _additionalProps$titl : getTitleFromCellRenderChildren({
    rowType: rowType,
    ellipsis: ellipsis,
    children: childNode
  });

  // >>>>> ClassName
  var mergedClassName = classnames_default()(cellPrefixCls, className, (_classNames = {}, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)(_classNames, "".concat(cellPrefixCls, "-fix-left"), isFixLeft && supportSticky), "".concat(cellPrefixCls, "-fix-left-first"), firstFixLeft && supportSticky), "".concat(cellPrefixCls, "-fix-left-last"), lastFixLeft && supportSticky), "".concat(cellPrefixCls, "-fix-left-all"), lastFixLeft && allColumnsFixedLeft && supportSticky), "".concat(cellPrefixCls, "-fix-right"), isFixRight && supportSticky), "".concat(cellPrefixCls, "-fix-right-first"), firstFixRight && supportSticky), "".concat(cellPrefixCls, "-fix-right-last"), lastFixRight && supportSticky), "".concat(cellPrefixCls, "-ellipsis"), ellipsis), "".concat(cellPrefixCls, "-with-append"), appendNode), "".concat(cellPrefixCls, "-fix-sticky"), (isFixLeft || isFixRight) && isSticky && supportSticky), (0,defineProperty/* default */.A)(_classNames, "".concat(cellPrefixCls, "-row-hover"), !legacyCellProps && hovering)), additionalProps.className, legacyCellProps === null || legacyCellProps === void 0 ? void 0 : legacyCellProps.className);

  // >>>>> Style
  var alignStyle = {};
  if (align) {
    alignStyle.textAlign = align;
  }

  // The order is important since user can overwrite style.
  // For example ant-design/ant-design#51763
  var mergedStyle = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, legacyCellProps === null || legacyCellProps === void 0 ? void 0 : legacyCellProps.style), fixedStyle), alignStyle), additionalProps.style);

  // >>>>> Children Node
  var mergedChildNode = childNode;

  // Not crash if final `childNode` is not validate ReactNode
  if ((0,esm_typeof/* default */.A)(mergedChildNode) === 'object' && !Array.isArray(mergedChildNode) && ! /*#__PURE__*/react.isValidElement(mergedChildNode)) {
    mergedChildNode = null;
  }
  if (ellipsis && (lastFixLeft || firstFixRight)) {
    mergedChildNode = /*#__PURE__*/react.createElement("span", {
      className: "".concat(cellPrefixCls, "-content")
    }, mergedChildNode);
  }
  return /*#__PURE__*/react.createElement(Component, (0,esm_extends/* default */.A)({}, legacyCellProps, additionalProps, {
    className: mergedClassName,
    style: mergedStyle
    // A11y
    ,
    title: title,
    scope: scope
    // Hover
    ,
    onMouseEnter: rowHoverable ? onMouseEnter : undefined,
    onMouseLeave: rowHoverable ? onMouseLeave : undefined
    //Span
    ,
    colSpan: mergedColSpan !== 1 ? mergedColSpan : null,
    rowSpan: mergedRowSpan !== 1 ? mergedRowSpan : null
  }), appendNode, mergedChildNode);
}
/* harmony default export */ var es_Cell = (/*#__PURE__*/react.memo(Cell));
;// ./node_modules/rc-table/es/utils/fixUtil.js
function getCellFixedInfo(colStart, colEnd, columns, stickyOffsets, direction) {
  var startColumn = columns[colStart] || {};
  var endColumn = columns[colEnd] || {};
  var fixLeft;
  var fixRight;
  if (startColumn.fixed === 'left') {
    fixLeft = stickyOffsets.left[direction === 'rtl' ? colEnd : colStart];
  } else if (endColumn.fixed === 'right') {
    fixRight = stickyOffsets.right[direction === 'rtl' ? colStart : colEnd];
  }
  var lastFixLeft = false;
  var firstFixRight = false;
  var lastFixRight = false;
  var firstFixLeft = false;
  var nextColumn = columns[colEnd + 1];
  var prevColumn = columns[colStart - 1];

  // need show shadow only when canLastFix is true
  var canLastFix = nextColumn && !nextColumn.fixed || prevColumn && !prevColumn.fixed || columns.every(function (col) {
    return col.fixed === 'left';
  });
  if (direction === 'rtl') {
    if (fixLeft !== undefined) {
      var prevFixLeft = prevColumn && prevColumn.fixed === 'left';
      firstFixLeft = !prevFixLeft && canLastFix;
    } else if (fixRight !== undefined) {
      var nextFixRight = nextColumn && nextColumn.fixed === 'right';
      lastFixRight = !nextFixRight && canLastFix;
    }
  } else if (fixLeft !== undefined) {
    var nextFixLeft = nextColumn && nextColumn.fixed === 'left';
    lastFixLeft = !nextFixLeft && canLastFix;
  } else if (fixRight !== undefined) {
    var prevFixRight = prevColumn && prevColumn.fixed === 'right';
    firstFixRight = !prevFixRight && canLastFix;
  }
  return {
    fixLeft: fixLeft,
    fixRight: fixRight,
    lastFixLeft: lastFixLeft,
    firstFixRight: firstFixRight,
    lastFixRight: lastFixRight,
    firstFixLeft: firstFixLeft,
    isSticky: stickyOffsets.isSticky
  };
}
;// ./node_modules/rc-table/es/Footer/SummaryContext.js

var SummaryContext = /*#__PURE__*/react.createContext({});
/* harmony default export */ var Footer_SummaryContext = (SummaryContext);
;// ./node_modules/rc-table/es/Footer/Cell.js







function SummaryCell(_ref) {
  var className = _ref.className,
    index = _ref.index,
    children = _ref.children,
    _ref$colSpan = _ref.colSpan,
    colSpan = _ref$colSpan === void 0 ? 1 : _ref$colSpan,
    rowSpan = _ref.rowSpan,
    align = _ref.align;
  var _useContext = useContext(context_TableContext, ['prefixCls', 'direction']),
    prefixCls = _useContext.prefixCls,
    direction = _useContext.direction;
  var _React$useContext = react.useContext(Footer_SummaryContext),
    scrollColumnIndex = _React$useContext.scrollColumnIndex,
    stickyOffsets = _React$useContext.stickyOffsets,
    flattenColumns = _React$useContext.flattenColumns;
  var lastIndex = index + colSpan - 1;
  var mergedColSpan = lastIndex + 1 === scrollColumnIndex ? colSpan + 1 : colSpan;
  var fixedInfo = getCellFixedInfo(index, index + mergedColSpan - 1, flattenColumns, stickyOffsets, direction);
  return /*#__PURE__*/react.createElement(es_Cell, (0,esm_extends/* default */.A)({
    className: className,
    index: index,
    component: "td",
    prefixCls: prefixCls,
    record: null,
    dataIndex: null,
    align: align,
    colSpan: mergedColSpan,
    rowSpan: rowSpan,
    render: function render() {
      return children;
    }
  }, fixedInfo));
}
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js
var objectWithoutProperties = __webpack_require__(80045);
;// ./node_modules/rc-table/es/Footer/Row.js

var _excluded = ["children"];

function FooterRow(_ref) {
  var children = _ref.children,
    props = (0,objectWithoutProperties/* default */.A)(_ref, _excluded);
  return /*#__PURE__*/react.createElement("tr", props, children);
}
;// ./node_modules/rc-table/es/Footer/Summary.js


/**
 * Syntactic sugar. Do not support HOC.
 */
function Summary(_ref) {
  var children = _ref.children;
  return children;
}
Summary.Row = FooterRow;
Summary.Cell = SummaryCell;
/* harmony default export */ var Footer_Summary = (Summary);
;// ./node_modules/rc-table/es/Footer/index.js






function Footer(props) {
  if (false) {}
  var children = props.children,
    stickyOffsets = props.stickyOffsets,
    flattenColumns = props.flattenColumns;
  var prefixCls = useContext(context_TableContext, 'prefixCls');
  var lastColumnIndex = flattenColumns.length - 1;
  var scrollColumn = flattenColumns[lastColumnIndex];
  var summaryContext = react.useMemo(function () {
    return {
      stickyOffsets: stickyOffsets,
      flattenColumns: flattenColumns,
      scrollColumnIndex: scrollColumn !== null && scrollColumn !== void 0 && scrollColumn.scrollbar ? lastColumnIndex : null
    };
  }, [scrollColumn, flattenColumns, lastColumnIndex, stickyOffsets]);
  return /*#__PURE__*/react.createElement(Footer_SummaryContext.Provider, {
    value: summaryContext
  }, /*#__PURE__*/react.createElement("tfoot", {
    className: "".concat(prefixCls, "-summary")
  }, children));
}
/* harmony default export */ var es_Footer = (TableContext_responseImmutable(Footer));
var FooterComponents = Footer_Summary;
// EXTERNAL MODULE: ./node_modules/rc-resize-observer/es/index.js + 5 modules
var rc_resize_observer_es = __webpack_require__(18462);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/isVisible.js
var isVisible = __webpack_require__(42467);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/canUseDom.js
var canUseDom = __webpack_require__(20998);
;// ./node_modules/rc-util/es/Dom/styleChecker.js

var isStyleNameSupport = function isStyleNameSupport(styleName) {
  if ((0,canUseDom/* default */.A)() && window.document.documentElement) {
    var styleNameList = Array.isArray(styleName) ? styleName : [styleName];
    var documentElement = window.document.documentElement;
    return styleNameList.some(function (name) {
      return name in documentElement.style;
    });
  }
  return false;
};
var isStyleValueSupport = function isStyleValueSupport(styleName, value) {
  if (!isStyleNameSupport(styleName)) {
    return false;
  }
  var ele = document.createElement('div');
  var origin = ele.style[styleName];
  ele.style[styleName] = value;
  return ele.style[styleName] !== origin;
};
function isStyleSupport(styleName, styleValue) {
  if (!Array.isArray(styleName) && styleValue !== undefined) {
    return isStyleValueSupport(styleName, styleValue);
  }
  return isStyleNameSupport(styleName);
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/getScrollBarSize.js
var getScrollBarSize = __webpack_require__(82987);
// EXTERNAL MODULE: ./node_modules/rc-util/es/pickAttrs.js
var pickAttrs = __webpack_require__(72065);
;// ./node_modules/rc-table/es/hooks/useFlattenRecords.js

// recursion (flat tree structure)
function fillRecords(list, record, indent, childrenColumnName, expandedKeys, getRowKey, index) {
  list.push({
    record: record,
    indent: indent,
    index: index
  });
  var key = getRowKey(record);
  var expanded = expandedKeys === null || expandedKeys === void 0 ? void 0 : expandedKeys.has(key);
  if (record && Array.isArray(record[childrenColumnName]) && expanded) {
    // expanded state, flat record
    for (var i = 0; i < record[childrenColumnName].length; i += 1) {
      fillRecords(list, record[childrenColumnName][i], indent + 1, childrenColumnName, expandedKeys, getRowKey, i);
    }
  }
}
/**
 * flat tree data on expanded state
 *
 * @export
 * @template T
 * @param {*} data : table data
 * @param {string} childrenColumnName : 指定树形结构的列名
 * @param {Set<Key>} expandedKeys : 展开的行对应的keys
 * @param {GetRowKey<T>} getRowKey  : 获取当前rowKey的方法
 * @returns flattened data
 */
function useFlattenRecords(data, childrenColumnName, expandedKeys, getRowKey) {
  var arr = react.useMemo(function () {
    if (expandedKeys !== null && expandedKeys !== void 0 && expandedKeys.size) {
      var list = [];

      // collect flattened record
      for (var i = 0; i < (data === null || data === void 0 ? void 0 : data.length); i += 1) {
        var record = data[i];

        // using array.push or spread operator may cause "Maximum call stack size exceeded" exception if array size is big enough.
        fillRecords(list, record, 0, childrenColumnName, expandedKeys, getRowKey, i);
      }
      return list;
    }
    return data === null || data === void 0 ? void 0 : data.map(function (item, index) {
      return {
        record: item,
        indent: 0,
        index: index
      };
    });
  }, [data, childrenColumnName, expandedKeys, getRowKey]);
  return arr;
}
;// ./node_modules/rc-table/es/hooks/useRowInfo.js






function useRowInfo(record, rowKey, recordIndex, indent) {
  var context = useContext(context_TableContext, ['prefixCls', 'fixedInfoList', 'flattenColumns', 'expandableType', 'expandRowByClick', 'onTriggerExpand', 'rowClassName', 'expandedRowClassName', 'indentSize', 'expandIcon', 'expandedRowRender', 'expandIconColumnIndex', 'expandedKeys', 'childrenColumnName', 'rowExpandable', 'onRow']);
  var flattenColumns = context.flattenColumns,
    expandableType = context.expandableType,
    expandedKeys = context.expandedKeys,
    childrenColumnName = context.childrenColumnName,
    onTriggerExpand = context.onTriggerExpand,
    rowExpandable = context.rowExpandable,
    onRow = context.onRow,
    expandRowByClick = context.expandRowByClick,
    rowClassName = context.rowClassName;

  // ======================= Expandable =======================
  // Only when row is not expandable and `children` exist in record
  var nestExpandable = expandableType === 'nest';
  var rowSupportExpand = expandableType === 'row' && (!rowExpandable || rowExpandable(record));
  var mergedExpandable = rowSupportExpand || nestExpandable;
  var expanded = expandedKeys && expandedKeys.has(rowKey);
  var hasNestChildren = childrenColumnName && record && record[childrenColumnName];
  var onInternalTriggerExpand = (0,es/* useEvent */._q)(onTriggerExpand);

  // ========================= onRow ==========================
  var rowProps = onRow === null || onRow === void 0 ? void 0 : onRow(record, recordIndex);
  var onRowClick = rowProps === null || rowProps === void 0 ? void 0 : rowProps.onClick;
  var onClick = function onClick(event) {
    if (expandRowByClick && mergedExpandable) {
      onTriggerExpand(record, event);
    }
    for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      args[_key - 1] = arguments[_key];
    }
    onRowClick === null || onRowClick === void 0 || onRowClick.apply(void 0, [event].concat(args));
  };

  // ====================== RowClassName ======================
  var computeRowClassName;
  if (typeof rowClassName === 'string') {
    computeRowClassName = rowClassName;
  } else if (typeof rowClassName === 'function') {
    computeRowClassName = rowClassName(record, recordIndex, indent);
  }

  // ========================= Column =========================
  var columnsKey = getColumnsKey(flattenColumns);
  return (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, context), {}, {
    columnsKey: columnsKey,
    nestExpandable: nestExpandable,
    expanded: expanded,
    hasNestChildren: hasNestChildren,
    record: record,
    onTriggerExpand: onInternalTriggerExpand,
    rowSupportExpand: rowSupportExpand,
    expandable: mergedExpandable,
    rowProps: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, rowProps), {}, {
      className: classnames_default()(computeRowClassName, rowProps === null || rowProps === void 0 ? void 0 : rowProps.className),
      onClick: onClick
    })
  });
}
;// ./node_modules/rc-table/es/Body/ExpandedRow.js





function ExpandedRow(props) {
  if (false) {}
  var prefixCls = props.prefixCls,
    children = props.children,
    Component = props.component,
    cellComponent = props.cellComponent,
    className = props.className,
    expanded = props.expanded,
    colSpan = props.colSpan,
    isEmpty = props.isEmpty;
  var _useContext = useContext(context_TableContext, ['scrollbarSize', 'fixHeader', 'fixColumn', 'componentWidth', 'horizonScroll']),
    scrollbarSize = _useContext.scrollbarSize,
    fixHeader = _useContext.fixHeader,
    fixColumn = _useContext.fixColumn,
    componentWidth = _useContext.componentWidth,
    horizonScroll = _useContext.horizonScroll;

  // Cache render node
  var contentNode = children;
  if (isEmpty ? horizonScroll && componentWidth : fixColumn) {
    contentNode = /*#__PURE__*/react.createElement("div", {
      style: {
        width: componentWidth - (fixHeader && !isEmpty ? scrollbarSize : 0),
        position: 'sticky',
        left: 0,
        overflow: 'hidden'
      },
      className: "".concat(prefixCls, "-expanded-row-fixed")
    }, contentNode);
  }
  return /*#__PURE__*/react.createElement(Component, {
    className: className,
    style: {
      display: expanded ? null : 'none'
    }
  }, /*#__PURE__*/react.createElement(es_Cell, {
    component: cellComponent,
    prefixCls: prefixCls,
    colSpan: colSpan
  }, contentNode));
}
/* harmony default export */ var Body_ExpandedRow = (ExpandedRow);
;// ./node_modules/rc-table/es/utils/expandUtil.js



function renderExpandIcon(_ref) {
  var prefixCls = _ref.prefixCls,
    record = _ref.record,
    onExpand = _ref.onExpand,
    expanded = _ref.expanded,
    expandable = _ref.expandable;
  var expandClassName = "".concat(prefixCls, "-row-expand-icon");
  if (!expandable) {
    return /*#__PURE__*/react.createElement("span", {
      className: classnames_default()(expandClassName, "".concat(prefixCls, "-row-spaced"))
    });
  }
  var onClick = function onClick(event) {
    onExpand(record, event);
    event.stopPropagation();
  };
  return /*#__PURE__*/react.createElement("span", {
    className: classnames_default()(expandClassName, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-row-expanded"), expanded), "".concat(prefixCls, "-row-collapsed"), !expanded)),
    onClick: onClick
  });
}
function findAllChildrenKeys(data, getRowKey, childrenColumnName) {
  var keys = [];
  function dig(list) {
    (list || []).forEach(function (item, index) {
      keys.push(getRowKey(item, index));
      dig(item[childrenColumnName]);
    });
  }
  dig(data);
  return keys;
}
function computedExpandedClassName(cls, record, index, indent) {
  if (typeof cls === 'string') {
    return cls;
  }
  if (typeof cls === 'function') {
    return cls(record, index, indent);
  }
  return '';
}
;// ./node_modules/rc-table/es/Body/BodyRow.js











// ==================================================================================
// ==                                 getCellProps                                 ==
// ==================================================================================
function getCellProps(rowInfo, column, colIndex, indent, index) {
  var record = rowInfo.record,
    prefixCls = rowInfo.prefixCls,
    columnsKey = rowInfo.columnsKey,
    fixedInfoList = rowInfo.fixedInfoList,
    expandIconColumnIndex = rowInfo.expandIconColumnIndex,
    nestExpandable = rowInfo.nestExpandable,
    indentSize = rowInfo.indentSize,
    expandIcon = rowInfo.expandIcon,
    expanded = rowInfo.expanded,
    hasNestChildren = rowInfo.hasNestChildren,
    onTriggerExpand = rowInfo.onTriggerExpand;
  var key = columnsKey[colIndex];
  var fixedInfo = fixedInfoList[colIndex];

  // ============= Used for nest expandable =============
  var appendCellNode;
  if (colIndex === (expandIconColumnIndex || 0) && nestExpandable) {
    appendCellNode = /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("span", {
      style: {
        paddingLeft: "".concat(indentSize * indent, "px")
      },
      className: "".concat(prefixCls, "-row-indent indent-level-").concat(indent)
    }), expandIcon({
      prefixCls: prefixCls,
      expanded: expanded,
      expandable: hasNestChildren,
      record: record,
      onExpand: onTriggerExpand
    }));
  }
  var additionalCellProps;
  if (column.onCell) {
    additionalCellProps = column.onCell(record, index);
  }
  return {
    key: key,
    fixedInfo: fixedInfo,
    appendCellNode: appendCellNode,
    additionalCellProps: additionalCellProps || {}
  };
}

// ==================================================================================
// ==                                 getCellProps                                 ==
// ==================================================================================
function BodyRow(props) {
  if (false) {}
  var className = props.className,
    style = props.style,
    record = props.record,
    index = props.index,
    renderIndex = props.renderIndex,
    rowKey = props.rowKey,
    _props$indent = props.indent,
    indent = _props$indent === void 0 ? 0 : _props$indent,
    RowComponent = props.rowComponent,
    cellComponent = props.cellComponent,
    scopeCellComponent = props.scopeCellComponent;
  var rowInfo = useRowInfo(record, rowKey, index, indent);
  var prefixCls = rowInfo.prefixCls,
    flattenColumns = rowInfo.flattenColumns,
    expandedRowClassName = rowInfo.expandedRowClassName,
    expandedRowRender = rowInfo.expandedRowRender,
    rowProps = rowInfo.rowProps,
    expanded = rowInfo.expanded,
    rowSupportExpand = rowInfo.rowSupportExpand;

  // Force render expand row if expanded before
  var expandedRef = react.useRef(false);
  expandedRef.current || (expandedRef.current = expanded);
  if (false) {}

  // 若没有 expandedRowRender 参数, 将使用 baseRowNode 渲染 Children
  // 此时如果 level > 1 则说明是 expandedRow, 一样需要附加 computedExpandedRowClassName
  var expandedClsName = computedExpandedClassName(expandedRowClassName, record, index, indent);

  // ======================== Base tr row ========================
  var baseRowNode = /*#__PURE__*/react.createElement(RowComponent, (0,esm_extends/* default */.A)({}, rowProps, {
    "data-row-key": rowKey,
    className: classnames_default()(className, "".concat(prefixCls, "-row"), "".concat(prefixCls, "-row-level-").concat(indent), rowProps === null || rowProps === void 0 ? void 0 : rowProps.className, (0,defineProperty/* default */.A)({}, expandedClsName, indent >= 1)),
    style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, style), rowProps === null || rowProps === void 0 ? void 0 : rowProps.style)
  }), flattenColumns.map(function (column, colIndex) {
    var render = column.render,
      dataIndex = column.dataIndex,
      columnClassName = column.className;
    var _getCellProps = getCellProps(rowInfo, column, colIndex, indent, index),
      key = _getCellProps.key,
      fixedInfo = _getCellProps.fixedInfo,
      appendCellNode = _getCellProps.appendCellNode,
      additionalCellProps = _getCellProps.additionalCellProps;
    return /*#__PURE__*/react.createElement(es_Cell, (0,esm_extends/* default */.A)({
      className: columnClassName,
      ellipsis: column.ellipsis,
      align: column.align,
      scope: column.rowScope,
      component: column.rowScope ? scopeCellComponent : cellComponent,
      prefixCls: prefixCls,
      key: key,
      record: record,
      index: index,
      renderIndex: renderIndex,
      dataIndex: dataIndex,
      render: render,
      shouldCellUpdate: column.shouldCellUpdate
    }, fixedInfo, {
      appendNode: appendCellNode,
      additionalProps: additionalCellProps
    }));
  }));

  // ======================== Expand Row =========================
  var expandRowNode;
  if (rowSupportExpand && (expandedRef.current || expanded)) {
    var expandContent = expandedRowRender(record, index, indent + 1, expanded);
    expandRowNode = /*#__PURE__*/react.createElement(Body_ExpandedRow, {
      expanded: expanded,
      className: classnames_default()("".concat(prefixCls, "-expanded-row"), "".concat(prefixCls, "-expanded-row-level-").concat(indent + 1), expandedClsName),
      prefixCls: prefixCls,
      component: RowComponent,
      cellComponent: cellComponent,
      colSpan: flattenColumns.length,
      isEmpty: false
    }, expandContent);
  }
  return /*#__PURE__*/react.createElement(react.Fragment, null, baseRowNode, expandRowNode);
}
if (false) {}
/* harmony default export */ var Body_BodyRow = (TableContext_responseImmutable(BodyRow));
;// ./node_modules/rc-table/es/Body/MeasureCell.js


function MeasureCell(_ref) {
  var columnKey = _ref.columnKey,
    onColumnResize = _ref.onColumnResize;
  var cellRef = react.useRef();
  react.useEffect(function () {
    if (cellRef.current) {
      onColumnResize(columnKey, cellRef.current.offsetWidth);
    }
  }, []);
  return /*#__PURE__*/react.createElement(rc_resize_observer_es/* default */.A, {
    data: columnKey
  }, /*#__PURE__*/react.createElement("td", {
    ref: cellRef,
    style: {
      padding: 0,
      border: 0,
      height: 0
    }
  }, /*#__PURE__*/react.createElement("div", {
    style: {
      height: 0,
      overflow: 'hidden'
    }
  }, "\xA0")));
}
;// ./node_modules/rc-table/es/Body/MeasureRow.js



function MeasureRow(_ref) {
  var prefixCls = _ref.prefixCls,
    columnsKey = _ref.columnsKey,
    onColumnResize = _ref.onColumnResize;
  return /*#__PURE__*/react.createElement("tr", {
    "aria-hidden": "true",
    className: "".concat(prefixCls, "-measure-row"),
    style: {
      height: 0,
      fontSize: 0
    }
  }, /*#__PURE__*/react.createElement(rc_resize_observer_es/* default */.A.Collection, {
    onBatchResize: function onBatchResize(infoList) {
      infoList.forEach(function (_ref2) {
        var columnKey = _ref2.data,
          size = _ref2.size;
        onColumnResize(columnKey, size.offsetWidth);
      });
    }
  }, columnsKey.map(function (columnKey) {
    return /*#__PURE__*/react.createElement(MeasureCell, {
      key: columnKey,
      columnKey: columnKey,
      onColumnResize: onColumnResize
    });
  })));
}
;// ./node_modules/rc-table/es/Body/index.js










function Body(props) {
  if (false) {}
  var data = props.data,
    measureColumnWidth = props.measureColumnWidth;
  var _useContext = useContext(context_TableContext, ['prefixCls', 'getComponent', 'onColumnResize', 'flattenColumns', 'getRowKey', 'expandedKeys', 'childrenColumnName', 'emptyNode']),
    prefixCls = _useContext.prefixCls,
    getComponent = _useContext.getComponent,
    onColumnResize = _useContext.onColumnResize,
    flattenColumns = _useContext.flattenColumns,
    getRowKey = _useContext.getRowKey,
    expandedKeys = _useContext.expandedKeys,
    childrenColumnName = _useContext.childrenColumnName,
    emptyNode = _useContext.emptyNode;
  var flattenData = useFlattenRecords(data, childrenColumnName, expandedKeys, getRowKey);

  // =================== Performance ====================
  var perfRef = react.useRef({
    renderWithProps: false
  });

  // ====================== Render ======================
  var WrapperComponent = getComponent(['body', 'wrapper'], 'tbody');
  var trComponent = getComponent(['body', 'row'], 'tr');
  var tdComponent = getComponent(['body', 'cell'], 'td');
  var thComponent = getComponent(['body', 'cell'], 'th');
  var rows;
  if (data.length) {
    rows = flattenData.map(function (item, idx) {
      var record = item.record,
        indent = item.indent,
        renderIndex = item.index;
      var key = getRowKey(record, idx);
      return /*#__PURE__*/react.createElement(Body_BodyRow, {
        key: key,
        rowKey: key,
        record: record,
        index: idx,
        renderIndex: renderIndex,
        rowComponent: trComponent,
        cellComponent: tdComponent,
        scopeCellComponent: thComponent,
        getRowKey: getRowKey,
        indent: indent
      });
    });
  } else {
    rows = /*#__PURE__*/react.createElement(Body_ExpandedRow, {
      expanded: true,
      className: "".concat(prefixCls, "-placeholder"),
      prefixCls: prefixCls,
      component: trComponent,
      cellComponent: tdComponent,
      colSpan: flattenColumns.length,
      isEmpty: true
    }, emptyNode);
  }
  var columnsKey = getColumnsKey(flattenColumns);
  return /*#__PURE__*/react.createElement(context_PerfContext.Provider, {
    value: perfRef.current
  }, /*#__PURE__*/react.createElement(WrapperComponent, {
    className: "".concat(prefixCls, "-tbody")
  }, measureColumnWidth && /*#__PURE__*/react.createElement(MeasureRow, {
    prefixCls: prefixCls,
    columnsKey: columnsKey,
    onColumnResize: onColumnResize
  }), rows));
}
if (false) {}
/* harmony default export */ var es_Body = (TableContext_responseImmutable(Body));
;// ./node_modules/rc-table/es/utils/legacyUtil.js


var legacyUtil_excluded = ["expandable"];

var INTERNAL_COL_DEFINE = 'RC_TABLE_INTERNAL_COL_DEFINE';
function getExpandableProps(props) {
  var expandable = props.expandable,
    legacyExpandableConfig = (0,objectWithoutProperties/* default */.A)(props, legacyUtil_excluded);
  var config;
  if ('expandable' in props) {
    config = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, legacyExpandableConfig), expandable);
  } else {
    if (false) {}
    config = legacyExpandableConfig;
  }
  if (config.showExpandColumn === false) {
    config.expandIconColumnIndex = -1;
  }
  return config;
}
;// ./node_modules/rc-table/es/ColGroup.js


var ColGroup_excluded = ["columnType"];




function ColGroup(_ref) {
  var colWidths = _ref.colWidths,
    columns = _ref.columns,
    columCount = _ref.columCount;
  var _useContext = useContext(context_TableContext, ['tableLayout']),
    tableLayout = _useContext.tableLayout;
  var cols = [];
  var len = columCount || columns.length;

  // Only insert col with width & additional props
  // Skip if rest col do not have any useful info
  var mustInsert = false;
  for (var i = len - 1; i >= 0; i -= 1) {
    var width = colWidths[i];
    var column = columns && columns[i];
    var additionalProps = void 0;
    var minWidth = void 0;
    if (column) {
      additionalProps = column[INTERNAL_COL_DEFINE];

      // fixed will cause layout problems
      if (tableLayout === 'auto') {
        minWidth = column.minWidth;
      }
    }
    if (width || minWidth || additionalProps || mustInsert) {
      var _ref2 = additionalProps || {},
        columnType = _ref2.columnType,
        restAdditionalProps = (0,objectWithoutProperties/* default */.A)(_ref2, ColGroup_excluded);
      cols.unshift( /*#__PURE__*/react.createElement("col", (0,esm_extends/* default */.A)({
        key: i,
        style: {
          width: width,
          minWidth: minWidth
        }
      }, restAdditionalProps)));
      mustInsert = true;
    }
  }
  return /*#__PURE__*/react.createElement("colgroup", null, cols);
}
/* harmony default export */ var es_ColGroup = (ColGroup);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
;// ./node_modules/rc-table/es/FixedHolder/index.js




var FixedHolder_excluded = ["className", "noData", "columns", "flattenColumns", "colWidths", "columCount", "stickyOffsets", "direction", "fixHeader", "stickyTopOffset", "stickyBottomOffset", "stickyClassName", "onScroll", "maxContentScroll", "children"];








function useColumnWidth(colWidths, columCount) {
  return (0,react.useMemo)(function () {
    var cloneColumns = [];
    for (var i = 0; i < columCount; i += 1) {
      var val = colWidths[i];
      if (val !== undefined) {
        cloneColumns[i] = val;
      } else {
        return null;
      }
    }
    return cloneColumns;
  }, [colWidths.join('_'), columCount]);
}
var FixedHolder = /*#__PURE__*/react.forwardRef(function (props, ref) {
  if (false) {}
  var className = props.className,
    noData = props.noData,
    columns = props.columns,
    flattenColumns = props.flattenColumns,
    colWidths = props.colWidths,
    columCount = props.columCount,
    stickyOffsets = props.stickyOffsets,
    direction = props.direction,
    fixHeader = props.fixHeader,
    stickyTopOffset = props.stickyTopOffset,
    stickyBottomOffset = props.stickyBottomOffset,
    stickyClassName = props.stickyClassName,
    onScroll = props.onScroll,
    maxContentScroll = props.maxContentScroll,
    children = props.children,
    restProps = (0,objectWithoutProperties/* default */.A)(props, FixedHolder_excluded);
  var _useContext = useContext(context_TableContext, ['prefixCls', 'scrollbarSize', 'isSticky', 'getComponent']),
    prefixCls = _useContext.prefixCls,
    scrollbarSize = _useContext.scrollbarSize,
    isSticky = _useContext.isSticky,
    getComponent = _useContext.getComponent;
  var TableComponent = getComponent(['header', 'table'], 'table');
  var combinationScrollBarSize = isSticky && !fixHeader ? 0 : scrollbarSize;

  // Pass wheel to scroll event
  var scrollRef = react.useRef(null);
  var setScrollRef = react.useCallback(function (element) {
    (0,es_ref/* fillRef */.Xf)(ref, element);
    (0,es_ref/* fillRef */.Xf)(scrollRef, element);
  }, []);
  react.useEffect(function () {
    var _scrollRef$current;
    function onWheel(e) {
      var _ref = e,
        currentTarget = _ref.currentTarget,
        deltaX = _ref.deltaX;
      if (deltaX) {
        onScroll({
          currentTarget: currentTarget,
          scrollLeft: currentTarget.scrollLeft + deltaX
        });
        e.preventDefault();
      }
    }
    (_scrollRef$current = scrollRef.current) === null || _scrollRef$current === void 0 || _scrollRef$current.addEventListener('wheel', onWheel, {
      passive: false
    });
    return function () {
      var _scrollRef$current2;
      (_scrollRef$current2 = scrollRef.current) === null || _scrollRef$current2 === void 0 || _scrollRef$current2.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Check if all flattenColumns has width
  var allFlattenColumnsWithWidth = react.useMemo(function () {
    return flattenColumns.every(function (column) {
      return column.width;
    });
  }, [flattenColumns]);

  // Add scrollbar column
  var lastColumn = flattenColumns[flattenColumns.length - 1];
  var ScrollBarColumn = {
    fixed: lastColumn ? lastColumn.fixed : null,
    scrollbar: true,
    onHeaderCell: function onHeaderCell() {
      return {
        className: "".concat(prefixCls, "-cell-scrollbar")
      };
    }
  };
  var columnsWithScrollbar = (0,react.useMemo)(function () {
    return combinationScrollBarSize ? [].concat((0,toConsumableArray/* default */.A)(columns), [ScrollBarColumn]) : columns;
  }, [combinationScrollBarSize, columns]);
  var flattenColumnsWithScrollbar = (0,react.useMemo)(function () {
    return combinationScrollBarSize ? [].concat((0,toConsumableArray/* default */.A)(flattenColumns), [ScrollBarColumn]) : flattenColumns;
  }, [combinationScrollBarSize, flattenColumns]);

  // Calculate the sticky offsets
  var headerStickyOffsets = (0,react.useMemo)(function () {
    var right = stickyOffsets.right,
      left = stickyOffsets.left;
    return (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, stickyOffsets), {}, {
      left: direction === 'rtl' ? [].concat((0,toConsumableArray/* default */.A)(left.map(function (width) {
        return width + combinationScrollBarSize;
      })), [0]) : left,
      right: direction === 'rtl' ? right : [].concat((0,toConsumableArray/* default */.A)(right.map(function (width) {
        return width + combinationScrollBarSize;
      })), [0]),
      isSticky: isSticky
    });
  }, [combinationScrollBarSize, stickyOffsets, isSticky]);
  var mergedColumnWidth = useColumnWidth(colWidths, columCount);
  return /*#__PURE__*/react.createElement("div", {
    style: (0,objectSpread2/* default */.A)({
      overflow: 'hidden'
    }, isSticky ? {
      top: stickyTopOffset,
      bottom: stickyBottomOffset
    } : {}),
    ref: setScrollRef,
    className: classnames_default()(className, (0,defineProperty/* default */.A)({}, stickyClassName, !!stickyClassName))
  }, /*#__PURE__*/react.createElement(TableComponent, {
    style: {
      tableLayout: 'fixed',
      visibility: noData || mergedColumnWidth ? null : 'hidden'
    }
  }, (!noData || !maxContentScroll || allFlattenColumnsWithWidth) && /*#__PURE__*/react.createElement(es_ColGroup, {
    colWidths: mergedColumnWidth ? [].concat((0,toConsumableArray/* default */.A)(mergedColumnWidth), [combinationScrollBarSize]) : [],
    columCount: columCount + 1,
    columns: flattenColumnsWithScrollbar
  }), children((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, restProps), {}, {
    stickyOffsets: headerStickyOffsets,
    columns: columnsWithScrollbar,
    flattenColumns: flattenColumnsWithScrollbar
  }))));
});
if (false) {}

/** Return a table in div as fixed element which contains sticky info */
// export default responseImmutable(FixedHolder);
/* harmony default export */ var es_FixedHolder = (/*#__PURE__*/react.memo(FixedHolder));
;// ./node_modules/rc-table/es/Header/HeaderRow.js







var HeaderRow = function HeaderRow(props) {
  var cells = props.cells,
    stickyOffsets = props.stickyOffsets,
    flattenColumns = props.flattenColumns,
    RowComponent = props.rowComponent,
    CellComponent = props.cellComponent,
    onHeaderRow = props.onHeaderRow,
    index = props.index;
  var _useContext = useContext(context_TableContext, ['prefixCls', 'direction']),
    prefixCls = _useContext.prefixCls,
    direction = _useContext.direction;
  var rowProps;
  if (onHeaderRow) {
    rowProps = onHeaderRow(cells.map(function (cell) {
      return cell.column;
    }), index);
  }
  var columnsKey = getColumnsKey(cells.map(function (cell) {
    return cell.column;
  }));
  return /*#__PURE__*/react.createElement(RowComponent, rowProps, cells.map(function (cell, cellIndex) {
    var column = cell.column;
    var fixedInfo = getCellFixedInfo(cell.colStart, cell.colEnd, flattenColumns, stickyOffsets, direction);
    var additionalProps;
    if (column && column.onHeaderCell) {
      additionalProps = cell.column.onHeaderCell(column);
    }
    return /*#__PURE__*/react.createElement(es_Cell, (0,esm_extends/* default */.A)({}, cell, {
      scope: column.title ? cell.colSpan > 1 ? 'colgroup' : 'col' : null,
      ellipsis: column.ellipsis,
      align: column.align,
      component: CellComponent,
      prefixCls: prefixCls,
      key: columnsKey[cellIndex]
    }, fixedInfo, {
      additionalProps: additionalProps,
      rowType: "header"
    }));
  }));
};
if (false) {}
/* harmony default export */ var Header_HeaderRow = (HeaderRow);
;// ./node_modules/rc-table/es/Header/Header.js





function parseHeaderRows(rootColumns) {
  var rows = [];
  function fillRowCells(columns, colIndex) {
    var rowIndex = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 0;
    // Init rows
    rows[rowIndex] = rows[rowIndex] || [];
    var currentColIndex = colIndex;
    var colSpans = columns.filter(Boolean).map(function (column) {
      var cell = {
        key: column.key,
        className: column.className || '',
        children: column.title,
        column: column,
        colStart: currentColIndex
      };
      var colSpan = 1;
      var subColumns = column.children;
      if (subColumns && subColumns.length > 0) {
        colSpan = fillRowCells(subColumns, currentColIndex, rowIndex + 1).reduce(function (total, count) {
          return total + count;
        }, 0);
        cell.hasSubColumns = true;
      }
      if ('colSpan' in column) {
        colSpan = column.colSpan;
      }
      if ('rowSpan' in column) {
        cell.rowSpan = column.rowSpan;
      }
      cell.colSpan = colSpan;
      cell.colEnd = cell.colStart + colSpan - 1;
      rows[rowIndex].push(cell);
      currentColIndex += colSpan;
      return colSpan;
    });
    return colSpans;
  }

  // Generate `rows` cell data
  fillRowCells(rootColumns, 0);

  // Handle `rowSpan`
  var rowCount = rows.length;
  var _loop = function _loop(rowIndex) {
    rows[rowIndex].forEach(function (cell) {
      if (!('rowSpan' in cell) && !cell.hasSubColumns) {
        // eslint-disable-next-line no-param-reassign
        cell.rowSpan = rowCount - rowIndex;
      }
    });
  };
  for (var rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    _loop(rowIndex);
  }
  return rows;
}
var Header = function Header(props) {
  if (false) {}
  var stickyOffsets = props.stickyOffsets,
    columns = props.columns,
    flattenColumns = props.flattenColumns,
    onHeaderRow = props.onHeaderRow;
  var _useContext = useContext(context_TableContext, ['prefixCls', 'getComponent']),
    prefixCls = _useContext.prefixCls,
    getComponent = _useContext.getComponent;
  var rows = react.useMemo(function () {
    return parseHeaderRows(columns);
  }, [columns]);
  var WrapperComponent = getComponent(['header', 'wrapper'], 'thead');
  var trComponent = getComponent(['header', 'row'], 'tr');
  var thComponent = getComponent(['header', 'cell'], 'th');
  return /*#__PURE__*/react.createElement(WrapperComponent, {
    className: "".concat(prefixCls, "-thead")
  }, rows.map(function (row, rowIndex) {
    var rowNode = /*#__PURE__*/react.createElement(Header_HeaderRow, {
      key: rowIndex,
      flattenColumns: flattenColumns,
      cells: row,
      stickyOffsets: stickyOffsets,
      rowComponent: trComponent,
      cellComponent: thComponent,
      onHeaderRow: onHeaderRow,
      index: rowIndex
    });
    return rowNode;
  }));
};
/* harmony default export */ var Header_Header = (TableContext_responseImmutable(Header));
// EXTERNAL MODULE: ./node_modules/rc-util/es/Children/toArray.js
var Children_toArray = __webpack_require__(82546);
;// ./node_modules/rc-table/es/hooks/useColumns/useWidthColumns.js


function parseColWidth(totalWidth) {
  var width = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  if (typeof width === 'number') {
    return width;
  }
  if (width.endsWith('%')) {
    return totalWidth * parseFloat(width) / 100;
  }
  return null;
}

/**
 * Fill all column with width
 */
function useWidthColumns(flattenColumns, scrollWidth, clientWidth) {
  return react.useMemo(function () {
    // Fill width if needed
    if (scrollWidth && scrollWidth > 0) {
      var totalWidth = 0;
      var missWidthCount = 0;

      // collect not given width column
      flattenColumns.forEach(function (col) {
        var colWidth = parseColWidth(scrollWidth, col.width);
        if (colWidth) {
          totalWidth += colWidth;
        } else {
          missWidthCount += 1;
        }
      });

      // Fill width
      var maxFitWidth = Math.max(scrollWidth, clientWidth);
      var restWidth = Math.max(maxFitWidth - totalWidth, missWidthCount);
      var restCount = missWidthCount;
      var avgWidth = restWidth / missWidthCount;
      var realTotal = 0;
      var filledColumns = flattenColumns.map(function (col) {
        var clone = (0,objectSpread2/* default */.A)({}, col);
        var colWidth = parseColWidth(scrollWidth, clone.width);
        if (colWidth) {
          clone.width = colWidth;
        } else {
          var colAvgWidth = Math.floor(avgWidth);
          clone.width = restCount === 1 ? restWidth : colAvgWidth;
          restWidth -= colAvgWidth;
          restCount -= 1;
        }
        realTotal += clone.width;
        return clone;
      });

      // If realTotal is less than clientWidth,
      // We need extend column width
      if (realTotal < maxFitWidth) {
        var scale = maxFitWidth / realTotal;
        restWidth = maxFitWidth;
        filledColumns.forEach(function (col, index) {
          var colWidth = Math.floor(col.width * scale);
          col.width = index === filledColumns.length - 1 ? restWidth : colWidth;
          restWidth -= colWidth;
        });
      }
      return [filledColumns, Math.max(realTotal, maxFitWidth)];
    }
    return [flattenColumns, scrollWidth];
  }, [flattenColumns, scrollWidth, clientWidth]);
}
;// ./node_modules/rc-table/es/hooks/useColumns/index.js






var useColumns_excluded = ["children"],
  _excluded2 = ["fixed"];






function convertChildrenToColumns(children) {
  return (0,Children_toArray/* default */.A)(children).filter(function (node) {
    return /*#__PURE__*/react.isValidElement(node);
  }).map(function (_ref) {
    var key = _ref.key,
      props = _ref.props;
    var nodeChildren = props.children,
      restProps = (0,objectWithoutProperties/* default */.A)(props, useColumns_excluded);
    var column = (0,objectSpread2/* default */.A)({
      key: key
    }, restProps);
    if (nodeChildren) {
      column.children = convertChildrenToColumns(nodeChildren);
    }
    return column;
  });
}
function filterHiddenColumns(columns) {
  return columns.filter(function (column) {
    return column && (0,esm_typeof/* default */.A)(column) === 'object' && !column.hidden;
  }).map(function (column) {
    var subColumns = column.children;
    if (subColumns && subColumns.length > 0) {
      return (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, column), {}, {
        children: filterHiddenColumns(subColumns)
      });
    }
    return column;
  });
}
function flatColumns(columns) {
  var parentKey = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'key';
  return columns.filter(function (column) {
    return column && (0,esm_typeof/* default */.A)(column) === 'object';
  }).reduce(function (list, column, index) {
    var fixed = column.fixed;
    // Convert `fixed='true'` to `fixed='left'` instead
    var parsedFixed = fixed === true ? 'left' : fixed;
    var mergedKey = "".concat(parentKey, "-").concat(index);
    var subColumns = column.children;
    if (subColumns && subColumns.length > 0) {
      return [].concat((0,toConsumableArray/* default */.A)(list), (0,toConsumableArray/* default */.A)(flatColumns(subColumns, mergedKey).map(function (subColum) {
        return (0,objectSpread2/* default */.A)({
          fixed: parsedFixed
        }, subColum);
      })));
    }
    return [].concat((0,toConsumableArray/* default */.A)(list), [(0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({
      key: mergedKey
    }, column), {}, {
      fixed: parsedFixed
    })]);
  }, []);
}
function revertForRtl(columns) {
  return columns.map(function (column) {
    var fixed = column.fixed,
      restProps = (0,objectWithoutProperties/* default */.A)(column, _excluded2);

    // Convert `fixed='left'` to `fixed='right'` instead
    var parsedFixed = fixed;
    if (fixed === 'left') {
      parsedFixed = 'right';
    } else if (fixed === 'right') {
      parsedFixed = 'left';
    }
    return (0,objectSpread2/* default */.A)({
      fixed: parsedFixed
    }, restProps);
  });
}

/**
 * Parse `columns` & `children` into `columns`.
 */
function useColumns(_ref2, transformColumns) {
  var prefixCls = _ref2.prefixCls,
    columns = _ref2.columns,
    children = _ref2.children,
    expandable = _ref2.expandable,
    expandedKeys = _ref2.expandedKeys,
    columnTitle = _ref2.columnTitle,
    getRowKey = _ref2.getRowKey,
    onTriggerExpand = _ref2.onTriggerExpand,
    expandIcon = _ref2.expandIcon,
    rowExpandable = _ref2.rowExpandable,
    expandIconColumnIndex = _ref2.expandIconColumnIndex,
    direction = _ref2.direction,
    expandRowByClick = _ref2.expandRowByClick,
    columnWidth = _ref2.columnWidth,
    fixed = _ref2.fixed,
    scrollWidth = _ref2.scrollWidth,
    clientWidth = _ref2.clientWidth;
  var baseColumns = react.useMemo(function () {
    var newColumns = columns || convertChildrenToColumns(children) || [];
    return filterHiddenColumns(newColumns.slice());
  }, [columns, children]);

  // ========================== Expand ==========================
  var withExpandColumns = react.useMemo(function () {
    if (expandable) {
      var cloneColumns = baseColumns.slice();

      // >>> Warning if use `expandIconColumnIndex`
      if (false) {}

      // >>> Insert expand column if not exist
      if (!cloneColumns.includes(EXPAND_COLUMN)) {
        var expandColIndex = expandIconColumnIndex || 0;
        if (expandColIndex >= 0) {
          cloneColumns.splice(expandColIndex, 0, EXPAND_COLUMN);
        }
      }

      // >>> Deduplicate additional expand column
      if (false) {}
      var expandColumnIndex = cloneColumns.indexOf(EXPAND_COLUMN);
      cloneColumns = cloneColumns.filter(function (column, index) {
        return column !== EXPAND_COLUMN || index === expandColumnIndex;
      });

      // >>> Check if expand column need to fixed
      var prevColumn = baseColumns[expandColumnIndex];
      var fixedColumn;
      if ((fixed === 'left' || fixed) && !expandIconColumnIndex) {
        fixedColumn = 'left';
      } else if ((fixed === 'right' || fixed) && expandIconColumnIndex === baseColumns.length) {
        fixedColumn = 'right';
      } else {
        fixedColumn = prevColumn ? prevColumn.fixed : null;
      }

      // >>> Create expandable column
      var expandColumn = (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, INTERNAL_COL_DEFINE, {
        className: "".concat(prefixCls, "-expand-icon-col"),
        columnType: 'EXPAND_COLUMN'
      }), "title", columnTitle), "fixed", fixedColumn), "className", "".concat(prefixCls, "-row-expand-icon-cell")), "width", columnWidth), "render", function render(_, record, index) {
        var rowKey = getRowKey(record, index);
        var expanded = expandedKeys.has(rowKey);
        var recordExpandable = rowExpandable ? rowExpandable(record) : true;
        var icon = expandIcon({
          prefixCls: prefixCls,
          expanded: expanded,
          expandable: recordExpandable,
          record: record,
          onExpand: onTriggerExpand
        });
        if (expandRowByClick) {
          return /*#__PURE__*/react.createElement("span", {
            onClick: function onClick(e) {
              return e.stopPropagation();
            }
          }, icon);
        }
        return icon;
      });
      return cloneColumns.map(function (col) {
        return col === EXPAND_COLUMN ? expandColumn : col;
      });
    }
    if (false) {}
    return baseColumns.filter(function (col) {
      return col !== EXPAND_COLUMN;
    });
  }, [expandable, baseColumns, getRowKey, expandedKeys, expandIcon, direction]);

  // ========================= Transform ========================
  var mergedColumns = react.useMemo(function () {
    var finalColumns = withExpandColumns;
    if (transformColumns) {
      finalColumns = transformColumns(finalColumns);
    }

    // Always provides at least one column for table display
    if (!finalColumns.length) {
      finalColumns = [{
        render: function render() {
          return null;
        }
      }];
    }
    return finalColumns;
  }, [transformColumns, withExpandColumns, direction]);

  // ========================== Flatten =========================
  var flattenColumns = react.useMemo(function () {
    if (direction === 'rtl') {
      return revertForRtl(flatColumns(mergedColumns));
    }
    return flatColumns(mergedColumns);
  }, [mergedColumns, direction, scrollWidth]);

  // ========================= Gap Fixed ========================
  var hasGapFixed = react.useMemo(function () {
    // Fixed: left, since old browser not support `findLastIndex`, we should use reverse loop
    var lastLeftIndex = -1;
    for (var i = flattenColumns.length - 1; i >= 0; i -= 1) {
      var colFixed = flattenColumns[i].fixed;
      if (colFixed === 'left' || colFixed === true) {
        lastLeftIndex = i;
        break;
      }
    }
    if (lastLeftIndex >= 0) {
      for (var _i = 0; _i <= lastLeftIndex; _i += 1) {
        var _colFixed = flattenColumns[_i].fixed;
        if (_colFixed !== 'left' && _colFixed !== true) {
          return true;
        }
      }
    }

    // Fixed: right
    var firstRightIndex = flattenColumns.findIndex(function (_ref3) {
      var colFixed = _ref3.fixed;
      return colFixed === 'right';
    });
    if (firstRightIndex >= 0) {
      for (var _i2 = firstRightIndex; _i2 < flattenColumns.length; _i2 += 1) {
        var _colFixed2 = flattenColumns[_i2].fixed;
        if (_colFixed2 !== 'right') {
          return true;
        }
      }
    }
    return false;
  }, [flattenColumns]);

  // ========================= FillWidth ========================
  var _useWidthColumns = useWidthColumns(flattenColumns, scrollWidth, clientWidth),
    _useWidthColumns2 = (0,slicedToArray/* default */.A)(_useWidthColumns, 2),
    filledColumns = _useWidthColumns2[0],
    realScrollWidth = _useWidthColumns2[1];
  return [mergedColumns, filledColumns, realScrollWidth, hasGapFixed];
}
/* harmony default export */ var hooks_useColumns = (useColumns);
;// ./node_modules/rc-table/es/hooks/useExpand.js








function useExpand(props, mergedData, getRowKey) {
  var expandableConfig = getExpandableProps(props);
  var expandIcon = expandableConfig.expandIcon,
    expandedRowKeys = expandableConfig.expandedRowKeys,
    defaultExpandedRowKeys = expandableConfig.defaultExpandedRowKeys,
    defaultExpandAllRows = expandableConfig.defaultExpandAllRows,
    expandedRowRender = expandableConfig.expandedRowRender,
    onExpand = expandableConfig.onExpand,
    onExpandedRowsChange = expandableConfig.onExpandedRowsChange,
    childrenColumnName = expandableConfig.childrenColumnName;
  var mergedExpandIcon = expandIcon || renderExpandIcon;
  var mergedChildrenColumnName = childrenColumnName || 'children';
  var expandableType = react.useMemo(function () {
    if (expandedRowRender) {
      return 'row';
    }
    /* eslint-disable no-underscore-dangle */
    /**
     * Fix https://github.com/ant-design/ant-design/issues/21154
     * This is a workaround to not to break current behavior.
     * We can remove follow code after final release.
     *
     * To other developer:
     *  Do not use `__PARENT_RENDER_ICON__` in prod since we will remove this when refactor
     */
    if (props.expandable && props.internalHooks === INTERNAL_HOOKS && props.expandable.__PARENT_RENDER_ICON__ || mergedData.some(function (record) {
      return record && (0,esm_typeof/* default */.A)(record) === 'object' && record[mergedChildrenColumnName];
    })) {
      return 'nest';
    }
    /* eslint-enable */
    return false;
  }, [!!expandedRowRender, mergedData]);
  var _React$useState = react.useState(function () {
      if (defaultExpandedRowKeys) {
        return defaultExpandedRowKeys;
      }
      if (defaultExpandAllRows) {
        return findAllChildrenKeys(mergedData, getRowKey, mergedChildrenColumnName);
      }
      return [];
    }),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    innerExpandedKeys = _React$useState2[0],
    setInnerExpandedKeys = _React$useState2[1];
  var mergedExpandedKeys = react.useMemo(function () {
    return new Set(expandedRowKeys || innerExpandedKeys || []);
  }, [expandedRowKeys, innerExpandedKeys]);
  var onTriggerExpand = react.useCallback(function (record) {
    var key = getRowKey(record, mergedData.indexOf(record));
    var newExpandedKeys;
    var hasKey = mergedExpandedKeys.has(key);
    if (hasKey) {
      mergedExpandedKeys.delete(key);
      newExpandedKeys = (0,toConsumableArray/* default */.A)(mergedExpandedKeys);
    } else {
      newExpandedKeys = [].concat((0,toConsumableArray/* default */.A)(mergedExpandedKeys), [key]);
    }
    setInnerExpandedKeys(newExpandedKeys);
    if (onExpand) {
      onExpand(!hasKey, record);
    }
    if (onExpandedRowsChange) {
      onExpandedRowsChange(newExpandedKeys);
    }
  }, [getRowKey, mergedExpandedKeys, mergedData, onExpand, onExpandedRowsChange]);

  // Warning if use `expandedRowRender` and nest children in the same time
  if (false) {}
  return [expandableConfig, expandableType, mergedExpandedKeys, mergedExpandIcon, mergedChildrenColumnName, onTriggerExpand];
}
;// ./node_modules/rc-table/es/hooks/useFixedInfo.js



function useFixedInfo(flattenColumns, stickyOffsets, direction) {
  var fixedInfoList = flattenColumns.map(function (_, colIndex) {
    return getCellFixedInfo(colIndex, colIndex, flattenColumns, stickyOffsets, direction);
  });
  return (0,useMemo/* default */.A)(function () {
    return fixedInfoList;
  }, [fixedInfoList], function (prev, next) {
    return !(0,isEqual/* default */.A)(prev, next);
  });
}
;// ./node_modules/rc-table/es/hooks/useFrame.js


/**
 * Execute code before next frame but async
 */
function useLayoutState(defaultState) {
  var stateRef = (0,react.useRef)(defaultState);
  var _useState = (0,react.useState)({}),
    _useState2 = (0,slicedToArray/* default */.A)(_useState, 2),
    forceUpdate = _useState2[1];
  var lastPromiseRef = (0,react.useRef)(null);
  var updateBatchRef = (0,react.useRef)([]);
  function setFrameState(updater) {
    updateBatchRef.current.push(updater);
    var promise = Promise.resolve();
    lastPromiseRef.current = promise;
    promise.then(function () {
      if (lastPromiseRef.current === promise) {
        var prevBatch = updateBatchRef.current;
        var prevState = stateRef.current;
        updateBatchRef.current = [];
        prevBatch.forEach(function (batchUpdater) {
          stateRef.current = batchUpdater(stateRef.current);
        });
        lastPromiseRef.current = null;
        if (prevState !== stateRef.current) {
          forceUpdate({});
        }
      }
    });
  }
  (0,react.useEffect)(function () {
    return function () {
      lastPromiseRef.current = null;
    };
  }, []);
  return [stateRef.current, setFrameState];
}

/** Lock frame, when frame pass reset the lock. */
function useTimeoutLock(defaultState) {
  var frameRef = (0,react.useRef)(defaultState || null);
  var timeoutRef = (0,react.useRef)();
  function cleanUp() {
    window.clearTimeout(timeoutRef.current);
  }
  function setState(newState) {
    frameRef.current = newState;
    cleanUp();
    timeoutRef.current = window.setTimeout(function () {
      frameRef.current = null;
      timeoutRef.current = undefined;
    }, 100);
  }
  function getState() {
    return frameRef.current;
  }
  (0,react.useEffect)(function () {
    return cleanUp;
  }, []);
  return [setState, getState];
}
;// ./node_modules/rc-table/es/hooks/useHover.js


function useHover() {
  var _React$useState = react.useState(-1),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    startRow = _React$useState2[0],
    setStartRow = _React$useState2[1];
  var _React$useState3 = react.useState(-1),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    endRow = _React$useState4[0],
    setEndRow = _React$useState4[1];
  var onHover = react.useCallback(function (start, end) {
    setStartRow(start);
    setEndRow(end);
  }, []);
  return [startRow, endRow, onHover];
}
;// ./node_modules/rc-table/es/hooks/useSticky.js



// fix ssr render
var defaultContainer = (0,canUseDom/* default */.A)() ? window : null;

/** Sticky header hooks */
function useSticky(sticky, prefixCls) {
  var _ref = (0,esm_typeof/* default */.A)(sticky) === 'object' ? sticky : {},
    _ref$offsetHeader = _ref.offsetHeader,
    offsetHeader = _ref$offsetHeader === void 0 ? 0 : _ref$offsetHeader,
    _ref$offsetSummary = _ref.offsetSummary,
    offsetSummary = _ref$offsetSummary === void 0 ? 0 : _ref$offsetSummary,
    _ref$offsetScroll = _ref.offsetScroll,
    offsetScroll = _ref$offsetScroll === void 0 ? 0 : _ref$offsetScroll,
    _ref$getContainer = _ref.getContainer,
    getContainer = _ref$getContainer === void 0 ? function () {
      return defaultContainer;
    } : _ref$getContainer;
  var container = getContainer() || defaultContainer;
  var isSticky = !!sticky;
  return react.useMemo(function () {
    return {
      isSticky: isSticky,
      stickyClassName: isSticky ? "".concat(prefixCls, "-sticky-holder") : '',
      offsetHeader: offsetHeader,
      offsetSummary: offsetSummary,
      offsetScroll: offsetScroll,
      container: container
    };
  }, [isSticky, offsetScroll, offsetHeader, offsetSummary, prefixCls, container]);
}
;// ./node_modules/rc-table/es/hooks/useStickyOffsets.js

/**
 * Get sticky column offset width
 */
function useStickyOffsets(colWidths, flattenColumns, direction) {
  var stickyOffsets = (0,react.useMemo)(function () {
    var columnCount = flattenColumns.length;
    var getOffsets = function getOffsets(startIndex, endIndex, offset) {
      var offsets = [];
      var total = 0;
      for (var i = startIndex; i !== endIndex; i += offset) {
        offsets.push(total);
        if (flattenColumns[i].fixed) {
          total += colWidths[i] || 0;
        }
      }
      return offsets;
    };
    var startOffsets = getOffsets(0, columnCount, 1);
    var endOffsets = getOffsets(columnCount - 1, -1, -1).reverse();
    return direction === 'rtl' ? {
      left: endOffsets,
      right: startOffsets
    } : {
      left: startOffsets,
      right: endOffsets
    };
  }, [colWidths, flattenColumns, direction]);
  return stickyOffsets;
}
/* harmony default export */ var hooks_useStickyOffsets = (useStickyOffsets);
;// ./node_modules/rc-table/es/Panel/index.js

function Panel(_ref) {
  var className = _ref.className,
    children = _ref.children;
  return /*#__PURE__*/react.createElement("div", {
    className: className
  }, children);
}
/* harmony default export */ var es_Panel = (Panel);
;// ./node_modules/rc-util/es/Dom/addEventListener.js

function addEventListenerWrap(target, eventType, cb, option) {
  /* eslint camelcase: 2 */
  var callback = react_dom.unstable_batchedUpdates ? function run(e) {
    react_dom.unstable_batchedUpdates(cb, e);
  } : cb;
  if (target !== null && target !== void 0 && target.addEventListener) {
    target.addEventListener(eventType, callback, option);
  }
  return {
    remove: function remove() {
      if (target !== null && target !== void 0 && target.removeEventListener) {
        target.removeEventListener(eventType, callback, option);
      }
    }
  };
}
;// ./node_modules/rc-util/es/Dom/css.js
/* eslint-disable no-nested-ternary */
var PIXEL_PATTERN = /margin|padding|width|height|max|min|offset/;
var removePixel = {
  left: true,
  top: true
};
var floatMap = {
  cssFloat: 1,
  styleFloat: 1,
  float: 1
};
function css_getComputedStyle(node) {
  return node.nodeType === 1 ? node.ownerDocument.defaultView.getComputedStyle(node, null) : {};
}
function getStyleValue(node, type, value) {
  type = type.toLowerCase();
  if (value === 'auto') {
    if (type === 'height') {
      return node.offsetHeight;
    }
    if (type === 'width') {
      return node.offsetWidth;
    }
  }
  if (!(type in removePixel)) {
    removePixel[type] = PIXEL_PATTERN.test(type);
  }
  return removePixel[type] ? parseFloat(value) || 0 : value;
}
function css_get(node, name) {
  var length = arguments.length;
  var style = css_getComputedStyle(node);
  name = floatMap[name] ? 'cssFloat' in node.style ? 'cssFloat' : 'styleFloat' : name;
  return length === 1 ? style : getStyleValue(node, name, style[name] || node.style[name]);
}
function set(node, name, value) {
  var length = arguments.length;
  name = floatMap[name] ? 'cssFloat' in node.style ? 'cssFloat' : 'styleFloat' : name;
  if (length === 3) {
    if (typeof value === 'number' && PIXEL_PATTERN.test(name)) {
      value = "".concat(value, "px");
    }
    node.style[name] = value; // Number
    return value;
  }
  for (var x in name) {
    if (name.hasOwnProperty(x)) {
      set(node, x, name[x]);
    }
  }
  return css_getComputedStyle(node);
}
function getOuterWidth(el) {
  if (el === document.body) {
    return document.documentElement.clientWidth;
  }
  return el.offsetWidth;
}
function getOuterHeight(el) {
  if (el === document.body) {
    return window.innerHeight || document.documentElement.clientHeight;
  }
  return el.offsetHeight;
}
function getDocSize() {
  var width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  var height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  return {
    width: width,
    height: height
  };
}
function getClientSize() {
  var width = document.documentElement.clientWidth;
  var height = window.innerHeight || document.documentElement.clientHeight;
  return {
    width: width,
    height: height
  };
}
function getScroll() {
  return {
    scrollLeft: Math.max(document.documentElement.scrollLeft, document.body.scrollLeft),
    scrollTop: Math.max(document.documentElement.scrollTop, document.body.scrollTop)
  };
}
function getOffset(node) {
  var box = node.getBoundingClientRect();
  var docElem = document.documentElement;

  // < ie8 不支持 win.pageXOffset, 则使用 docElem.scrollLeft
  return {
    left: box.left + (window.pageXOffset || docElem.scrollLeft) - (docElem.clientLeft || document.body.clientLeft || 0),
    top: box.top + (window.pageYOffset || docElem.scrollTop) - (docElem.clientTop || document.body.clientTop || 0)
  };
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/raf.js
var raf = __webpack_require__(25371);
;// ./node_modules/rc-table/es/stickyScrollBar.js












var StickyScrollBar = function StickyScrollBar(_ref, ref) {
  var _scrollBodyRef$curren, _scrollBodyRef$curren2;
  var scrollBodyRef = _ref.scrollBodyRef,
    onScroll = _ref.onScroll,
    offsetScroll = _ref.offsetScroll,
    container = _ref.container;
  var prefixCls = useContext(context_TableContext, 'prefixCls');
  var bodyScrollWidth = ((_scrollBodyRef$curren = scrollBodyRef.current) === null || _scrollBodyRef$curren === void 0 ? void 0 : _scrollBodyRef$curren.scrollWidth) || 0;
  var bodyWidth = ((_scrollBodyRef$curren2 = scrollBodyRef.current) === null || _scrollBodyRef$curren2 === void 0 ? void 0 : _scrollBodyRef$curren2.clientWidth) || 0;
  var scrollBarWidth = bodyScrollWidth && bodyWidth * (bodyWidth / bodyScrollWidth);
  var scrollBarRef = react.useRef();
  var _useLayoutState = useLayoutState({
      scrollLeft: 0,
      isHiddenScrollBar: true
    }),
    _useLayoutState2 = (0,slicedToArray/* default */.A)(_useLayoutState, 2),
    scrollState = _useLayoutState2[0],
    setScrollState = _useLayoutState2[1];
  var refState = react.useRef({
    delta: 0,
    x: 0
  });
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    isActive = _React$useState2[0],
    setActive = _React$useState2[1];
  var rafRef = react.useRef(null);
  react.useEffect(function () {
    return function () {
      raf/* default */.A.cancel(rafRef.current);
    };
  }, []);
  var onMouseUp = function onMouseUp() {
    setActive(false);
  };
  var onMouseDown = function onMouseDown(event) {
    event.persist();
    refState.current.delta = event.pageX - scrollState.scrollLeft;
    refState.current.x = 0;
    setActive(true);
    event.preventDefault();
  };
  var onMouseMove = function onMouseMove(event) {
    var _window;
    // https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons
    var _ref2 = event || ((_window = window) === null || _window === void 0 ? void 0 : _window.event),
      buttons = _ref2.buttons;
    if (!isActive || buttons === 0) {
      // If out body mouse up, we can set isActive false when mouse move
      if (isActive) {
        setActive(false);
      }
      return;
    }
    var left = refState.current.x + event.pageX - refState.current.x - refState.current.delta;
    if (left <= 0) {
      left = 0;
    }
    if (left + scrollBarWidth >= bodyWidth) {
      left = bodyWidth - scrollBarWidth;
    }
    onScroll({
      scrollLeft: left / bodyWidth * (bodyScrollWidth + 2)
    });
    refState.current.x = event.pageX;
  };
  var checkScrollBarVisible = function checkScrollBarVisible() {
    rafRef.current = (0,raf/* default */.A)(function () {
      if (!scrollBodyRef.current) {
        return;
      }
      var tableOffsetTop = getOffset(scrollBodyRef.current).top;
      var tableBottomOffset = tableOffsetTop + scrollBodyRef.current.offsetHeight;
      var currentClientOffset = container === window ? document.documentElement.scrollTop + window.innerHeight : getOffset(container).top + container.clientHeight;
      if (tableBottomOffset - (0,getScrollBarSize/* default */.A)() <= currentClientOffset || tableOffsetTop >= currentClientOffset - offsetScroll) {
        setScrollState(function (state) {
          return (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, state), {}, {
            isHiddenScrollBar: true
          });
        });
      } else {
        setScrollState(function (state) {
          return (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, state), {}, {
            isHiddenScrollBar: false
          });
        });
      }
    });
  };
  var setScrollLeft = function setScrollLeft(left) {
    setScrollState(function (state) {
      return (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, state), {}, {
        scrollLeft: left / bodyScrollWidth * bodyWidth || 0
      });
    });
  };
  react.useImperativeHandle(ref, function () {
    return {
      setScrollLeft: setScrollLeft,
      checkScrollBarVisible: checkScrollBarVisible
    };
  });
  react.useEffect(function () {
    var onMouseUpListener = addEventListenerWrap(document.body, 'mouseup', onMouseUp, false);
    var onMouseMoveListener = addEventListenerWrap(document.body, 'mousemove', onMouseMove, false);
    checkScrollBarVisible();
    return function () {
      onMouseUpListener.remove();
      onMouseMoveListener.remove();
    };
  }, [scrollBarWidth, isActive]);
  react.useEffect(function () {
    var onScrollListener = addEventListenerWrap(container, 'scroll', checkScrollBarVisible, false);
    var onResizeListener = addEventListenerWrap(window, 'resize', checkScrollBarVisible, false);
    return function () {
      onScrollListener.remove();
      onResizeListener.remove();
    };
  }, [container]);
  react.useEffect(function () {
    if (!scrollState.isHiddenScrollBar) {
      setScrollState(function (state) {
        var bodyNode = scrollBodyRef.current;
        if (!bodyNode) {
          return state;
        }
        return (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, state), {}, {
          scrollLeft: bodyNode.scrollLeft / bodyNode.scrollWidth * bodyNode.clientWidth
        });
      });
    }
  }, [scrollState.isHiddenScrollBar]);
  if (bodyScrollWidth <= bodyWidth || !scrollBarWidth || scrollState.isHiddenScrollBar) {
    return null;
  }
  return /*#__PURE__*/react.createElement("div", {
    style: {
      height: (0,getScrollBarSize/* default */.A)(),
      width: bodyWidth,
      bottom: offsetScroll
    },
    className: "".concat(prefixCls, "-sticky-scroll")
  }, /*#__PURE__*/react.createElement("div", {
    onMouseDown: onMouseDown,
    ref: scrollBarRef,
    className: classnames_default()("".concat(prefixCls, "-sticky-scroll-bar"), (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-sticky-scroll-bar-active"), isActive)),
    style: {
      width: "".concat(scrollBarWidth, "px"),
      transform: "translate3d(".concat(scrollState.scrollLeft, "px, 0, 0)")
    }
  }));
};
/* harmony default export */ var stickyScrollBar = (/*#__PURE__*/react.forwardRef(StickyScrollBar));
;// ./node_modules/rc-table/es/sugar/Column.js
/* istanbul ignore next */
/**
 * This is a syntactic sugar for `columns` prop.
 * So HOC will not work on this.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Column(_) {
  return null;
}
/* harmony default export */ var sugar_Column = (Column);
;// ./node_modules/rc-table/es/sugar/ColumnGroup.js
/* istanbul ignore next */
/**
 * This is a syntactic sugar for `columns` prop.
 * So HOC will not work on this.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ColumnGroup(_) {
  return null;
}
/* harmony default export */ var sugar_ColumnGroup = (ColumnGroup);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/findDOMNode.js
var findDOMNode = __webpack_require__(66588);
;// ./node_modules/rc-table/es/Table.js




/**
 * Feature:
 *  - fixed not need to set width
 *  - support `rowExpandable` to config row expand logic
 *  - add `summary` to support `() => ReactNode`
 *
 * Update:
 *  - `dataIndex` is `array[]` now
 *  - `expandable` wrap all the expand related props
 *
 * Removed:
 *  - expandIconAsCell
 *  - useFixedHeader
 *  - rowRef
 *  - columns[number].onCellClick
 *  - onRowClick
 *  - onRowDoubleClick
 *  - onRowMouseEnter
 *  - onRowMouseLeave
 *  - getBodyWrapper
 *  - bodyStyle
 *
 * Deprecated:
 *  - All expanded props, move into expandable
 */
































var DEFAULT_PREFIX = 'rc-table';

// Used for conditions cache
var EMPTY_DATA = [];

// Used for customize scroll
var EMPTY_SCROLL_TARGET = {};
function defaultEmpty() {
  return 'No Data';
}
function Table_Table(tableProps, ref) {
  var props = (0,objectSpread2/* default */.A)({
    rowKey: 'key',
    prefixCls: DEFAULT_PREFIX,
    emptyText: defaultEmpty
  }, tableProps);
  var prefixCls = props.prefixCls,
    className = props.className,
    rowClassName = props.rowClassName,
    style = props.style,
    data = props.data,
    rowKey = props.rowKey,
    scroll = props.scroll,
    tableLayout = props.tableLayout,
    direction = props.direction,
    title = props.title,
    footer = props.footer,
    summary = props.summary,
    caption = props.caption,
    id = props.id,
    showHeader = props.showHeader,
    components = props.components,
    emptyText = props.emptyText,
    onRow = props.onRow,
    onHeaderRow = props.onHeaderRow,
    onScroll = props.onScroll,
    internalHooks = props.internalHooks,
    transformColumns = props.transformColumns,
    internalRefs = props.internalRefs,
    tailor = props.tailor,
    getContainerWidth = props.getContainerWidth,
    sticky = props.sticky,
    _props$rowHoverable = props.rowHoverable,
    rowHoverable = _props$rowHoverable === void 0 ? true : _props$rowHoverable;
  var mergedData = data || EMPTY_DATA;
  var hasData = !!mergedData.length;
  var useInternalHooks = internalHooks === INTERNAL_HOOKS;

  // ===================== Warning ======================
  if (false) {}

  // ==================== Customize =====================
  var getComponent = react.useCallback(function (path, defaultComponent) {
    return (0,get/* default */.A)(components, path) || defaultComponent;
  }, [components]);
  var getRowKey = react.useMemo(function () {
    if (typeof rowKey === 'function') {
      return rowKey;
    }
    return function (record) {
      var key = record && record[rowKey];
      if (false) {}
      return key;
    };
  }, [rowKey]);
  var customizeScrollBody = getComponent(['body']);

  // ====================== Hover =======================
  var _useHover = useHover(),
    _useHover2 = (0,slicedToArray/* default */.A)(_useHover, 3),
    startRow = _useHover2[0],
    endRow = _useHover2[1],
    onHover = _useHover2[2];

  // ====================== Expand ======================
  var _useExpand = useExpand(props, mergedData, getRowKey),
    _useExpand2 = (0,slicedToArray/* default */.A)(_useExpand, 6),
    expandableConfig = _useExpand2[0],
    expandableType = _useExpand2[1],
    mergedExpandedKeys = _useExpand2[2],
    mergedExpandIcon = _useExpand2[3],
    mergedChildrenColumnName = _useExpand2[4],
    onTriggerExpand = _useExpand2[5];

  // ====================== Column ======================
  var scrollX = scroll === null || scroll === void 0 ? void 0 : scroll.x;
  var _React$useState = react.useState(0),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    componentWidth = _React$useState2[0],
    setComponentWidth = _React$useState2[1];
  var _useColumns = hooks_useColumns((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, props), expandableConfig), {}, {
      expandable: !!expandableConfig.expandedRowRender,
      columnTitle: expandableConfig.columnTitle,
      expandedKeys: mergedExpandedKeys,
      getRowKey: getRowKey,
      // https://github.com/ant-design/ant-design/issues/23894
      onTriggerExpand: onTriggerExpand,
      expandIcon: mergedExpandIcon,
      expandIconColumnIndex: expandableConfig.expandIconColumnIndex,
      direction: direction,
      scrollWidth: useInternalHooks && tailor && typeof scrollX === 'number' ? scrollX : null,
      clientWidth: componentWidth
    }), useInternalHooks ? transformColumns : null),
    _useColumns2 = (0,slicedToArray/* default */.A)(_useColumns, 4),
    columns = _useColumns2[0],
    flattenColumns = _useColumns2[1],
    flattenScrollX = _useColumns2[2],
    hasGapFixed = _useColumns2[3];
  var mergedScrollX = flattenScrollX !== null && flattenScrollX !== void 0 ? flattenScrollX : scrollX;
  var columnContext = react.useMemo(function () {
    return {
      columns: columns,
      flattenColumns: flattenColumns
    };
  }, [columns, flattenColumns]);

  // ======================= Refs =======================
  var fullTableRef = react.useRef();
  var scrollHeaderRef = react.useRef();
  var scrollBodyRef = react.useRef();
  var scrollBodyContainerRef = react.useRef();
  react.useImperativeHandle(ref, function () {
    return {
      nativeElement: fullTableRef.current,
      scrollTo: function scrollTo(config) {
        var _scrollBodyRef$curren3;
        if (scrollBodyRef.current instanceof HTMLElement) {
          // Native scroll
          var index = config.index,
            top = config.top,
            key = config.key;
          if (validNumberValue(top)) {
            var _scrollBodyRef$curren;
            (_scrollBodyRef$curren = scrollBodyRef.current) === null || _scrollBodyRef$curren === void 0 || _scrollBodyRef$curren.scrollTo({
              top: top
            });
          } else {
            var _scrollBodyRef$curren2;
            var mergedKey = key !== null && key !== void 0 ? key : getRowKey(mergedData[index]);
            (_scrollBodyRef$curren2 = scrollBodyRef.current.querySelector("[data-row-key=\"".concat(mergedKey, "\"]"))) === null || _scrollBodyRef$curren2 === void 0 || _scrollBodyRef$curren2.scrollIntoView();
          }
        } else if ((_scrollBodyRef$curren3 = scrollBodyRef.current) !== null && _scrollBodyRef$curren3 !== void 0 && _scrollBodyRef$curren3.scrollTo) {
          // Pass to proxy
          scrollBodyRef.current.scrollTo(config);
        }
      }
    };
  });

  // ====================== Scroll ======================
  var scrollSummaryRef = react.useRef();
  var _React$useState3 = react.useState(false),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    pingedLeft = _React$useState4[0],
    setPingedLeft = _React$useState4[1];
  var _React$useState5 = react.useState(false),
    _React$useState6 = (0,slicedToArray/* default */.A)(_React$useState5, 2),
    pingedRight = _React$useState6[0],
    setPingedRight = _React$useState6[1];
  var _useLayoutState = useLayoutState(new Map()),
    _useLayoutState2 = (0,slicedToArray/* default */.A)(_useLayoutState, 2),
    colsWidths = _useLayoutState2[0],
    updateColsWidths = _useLayoutState2[1];

  // Convert map to number width
  var colsKeys = getColumnsKey(flattenColumns);
  var pureColWidths = colsKeys.map(function (columnKey) {
    return colsWidths.get(columnKey);
  });
  var colWidths = react.useMemo(function () {
    return pureColWidths;
  }, [pureColWidths.join('_')]);
  var stickyOffsets = hooks_useStickyOffsets(colWidths, flattenColumns, direction);
  var fixHeader = scroll && validateValue(scroll.y);
  var horizonScroll = scroll && validateValue(mergedScrollX) || Boolean(expandableConfig.fixed);
  var fixColumn = horizonScroll && flattenColumns.some(function (_ref) {
    var fixed = _ref.fixed;
    return fixed;
  });

  // Sticky
  var stickyRef = react.useRef();
  var _useSticky = useSticky(sticky, prefixCls),
    isSticky = _useSticky.isSticky,
    offsetHeader = _useSticky.offsetHeader,
    offsetSummary = _useSticky.offsetSummary,
    offsetScroll = _useSticky.offsetScroll,
    stickyClassName = _useSticky.stickyClassName,
    container = _useSticky.container;

  // Footer (Fix footer must fixed header)
  var summaryNode = react.useMemo(function () {
    return summary === null || summary === void 0 ? void 0 : summary(mergedData);
  }, [summary, mergedData]);
  var fixFooter = (fixHeader || isSticky) && /*#__PURE__*/react.isValidElement(summaryNode) && summaryNode.type === Footer_Summary && summaryNode.props.fixed;

  // Scroll
  var scrollXStyle;
  var scrollYStyle;
  var scrollTableStyle;
  if (fixHeader) {
    scrollYStyle = {
      overflowY: hasData ? 'scroll' : 'auto',
      maxHeight: scroll.y
    };
  }
  if (horizonScroll) {
    scrollXStyle = {
      overflowX: 'auto'
    };
    // When no vertical scrollbar, should hide it
    // https://github.com/ant-design/ant-design/pull/20705
    // https://github.com/ant-design/ant-design/issues/21879
    if (!fixHeader) {
      scrollYStyle = {
        overflowY: 'hidden'
      };
    }
    scrollTableStyle = {
      width: mergedScrollX === true ? 'auto' : mergedScrollX,
      minWidth: '100%'
    };
  }
  var onColumnResize = react.useCallback(function (columnKey, width) {
    if ((0,isVisible/* default */.A)(fullTableRef.current)) {
      updateColsWidths(function (widths) {
        if (widths.get(columnKey) !== width) {
          var newWidths = new Map(widths);
          newWidths.set(columnKey, width);
          return newWidths;
        }
        return widths;
      });
    }
  }, []);
  var _useTimeoutLock = useTimeoutLock(null),
    _useTimeoutLock2 = (0,slicedToArray/* default */.A)(_useTimeoutLock, 2),
    setScrollTarget = _useTimeoutLock2[0],
    getScrollTarget = _useTimeoutLock2[1];
  function forceScroll(scrollLeft, target) {
    if (!target) {
      return;
    }
    if (typeof target === 'function') {
      target(scrollLeft);
    } else if (target.scrollLeft !== scrollLeft) {
      target.scrollLeft = scrollLeft;

      // Delay to force scroll position if not sync
      // ref: https://github.com/ant-design/ant-design/issues/37179
      if (target.scrollLeft !== scrollLeft) {
        setTimeout(function () {
          target.scrollLeft = scrollLeft;
        }, 0);
      }
    }
  }
  var onInternalScroll = (0,useEvent/* default */.A)(function (_ref2) {
    var currentTarget = _ref2.currentTarget,
      scrollLeft = _ref2.scrollLeft;
    var isRTL = direction === 'rtl';
    var mergedScrollLeft = typeof scrollLeft === 'number' ? scrollLeft : currentTarget.scrollLeft;
    var compareTarget = currentTarget || EMPTY_SCROLL_TARGET;
    if (!getScrollTarget() || getScrollTarget() === compareTarget) {
      var _stickyRef$current;
      setScrollTarget(compareTarget);
      forceScroll(mergedScrollLeft, scrollHeaderRef.current);
      forceScroll(mergedScrollLeft, scrollBodyRef.current);
      forceScroll(mergedScrollLeft, scrollSummaryRef.current);
      forceScroll(mergedScrollLeft, (_stickyRef$current = stickyRef.current) === null || _stickyRef$current === void 0 ? void 0 : _stickyRef$current.setScrollLeft);
    }
    var measureTarget = currentTarget || scrollHeaderRef.current;
    if (measureTarget) {
      var scrollWidth =
      // Should use mergedScrollX in virtual table(useInternalHooks && tailor === true)
      useInternalHooks && tailor && typeof mergedScrollX === 'number' ? mergedScrollX : measureTarget.scrollWidth;
      var clientWidth = measureTarget.clientWidth;
      // There is no space to scroll
      if (scrollWidth === clientWidth) {
        setPingedLeft(false);
        setPingedRight(false);
        return;
      }
      if (isRTL) {
        setPingedLeft(-mergedScrollLeft < scrollWidth - clientWidth);
        setPingedRight(-mergedScrollLeft > 0);
      } else {
        setPingedLeft(mergedScrollLeft > 0);
        setPingedRight(mergedScrollLeft < scrollWidth - clientWidth);
      }
    }
  });
  var onBodyScroll = (0,useEvent/* default */.A)(function (e) {
    onInternalScroll(e);
    onScroll === null || onScroll === void 0 || onScroll(e);
  });
  var triggerOnScroll = function triggerOnScroll() {
    if (horizonScroll && scrollBodyRef.current) {
      var _scrollBodyRef$curren4;
      onInternalScroll({
        currentTarget: (0,findDOMNode/* getDOM */.rb)(scrollBodyRef.current),
        scrollLeft: (_scrollBodyRef$curren4 = scrollBodyRef.current) === null || _scrollBodyRef$curren4 === void 0 ? void 0 : _scrollBodyRef$curren4.scrollLeft
      });
    } else {
      setPingedLeft(false);
      setPingedRight(false);
    }
  };
  var onFullTableResize = function onFullTableResize(_ref3) {
    var _stickyRef$current2;
    var width = _ref3.width;
    (_stickyRef$current2 = stickyRef.current) === null || _stickyRef$current2 === void 0 || _stickyRef$current2.checkScrollBarVisible();
    var mergedWidth = fullTableRef.current ? fullTableRef.current.offsetWidth : width;
    if (useInternalHooks && getContainerWidth && fullTableRef.current) {
      mergedWidth = getContainerWidth(fullTableRef.current, mergedWidth) || mergedWidth;
    }
    if (mergedWidth !== componentWidth) {
      triggerOnScroll();
      setComponentWidth(mergedWidth);
    }
  };

  // Sync scroll bar when init or `horizonScroll`, `data` and `columns.length` changed
  var mounted = react.useRef(false);
  react.useEffect(function () {
    // onFullTableResize will be trigger once when ResizeObserver is mounted
    // This will reduce one duplicated triggerOnScroll time
    if (mounted.current) {
      triggerOnScroll();
    }
  }, [horizonScroll, data, columns.length]);
  react.useEffect(function () {
    mounted.current = true;
  }, []);

  // ===================== Effects ======================
  var _React$useState7 = react.useState(0),
    _React$useState8 = (0,slicedToArray/* default */.A)(_React$useState7, 2),
    scrollbarSize = _React$useState8[0],
    setScrollbarSize = _React$useState8[1];
  var _React$useState9 = react.useState(true),
    _React$useState10 = (0,slicedToArray/* default */.A)(_React$useState9, 2),
    supportSticky = _React$useState10[0],
    setSupportSticky = _React$useState10[1]; // Only IE not support, we mark as support first

  react.useEffect(function () {
    if (!tailor || !useInternalHooks) {
      if (scrollBodyRef.current instanceof Element) {
        setScrollbarSize((0,getScrollBarSize/* getTargetScrollBarSize */.V)(scrollBodyRef.current).width);
      } else {
        setScrollbarSize((0,getScrollBarSize/* getTargetScrollBarSize */.V)(scrollBodyContainerRef.current).width);
      }
    }
    setSupportSticky(isStyleSupport('position', 'sticky'));
  }, []);

  // ================== INTERNAL HOOKS ==================
  react.useEffect(function () {
    if (useInternalHooks && internalRefs) {
      internalRefs.body.current = scrollBodyRef.current;
    }
  });

  // ========================================================================
  // ==                               Render                               ==
  // ========================================================================
  // =================== Render: Func ===================
  var renderFixedHeaderTable = react.useCallback(function (fixedHolderPassProps) {
    return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement(Header_Header, fixedHolderPassProps), fixFooter === 'top' && /*#__PURE__*/react.createElement(es_Footer, fixedHolderPassProps, summaryNode));
  }, [fixFooter, summaryNode]);
  var renderFixedFooterTable = react.useCallback(function (fixedHolderPassProps) {
    return /*#__PURE__*/react.createElement(es_Footer, fixedHolderPassProps, summaryNode);
  }, [summaryNode]);

  // =================== Render: Node ===================
  var TableComponent = getComponent(['table'], 'table');

  // Table layout
  var mergedTableLayout = react.useMemo(function () {
    if (tableLayout) {
      return tableLayout;
    }
    // https://github.com/ant-design/ant-design/issues/25227
    // When scroll.x is max-content, no need to fix table layout
    // it's width should stretch out to fit content
    if (fixColumn) {
      return mergedScrollX === 'max-content' ? 'auto' : 'fixed';
    }
    if (fixHeader || isSticky || flattenColumns.some(function (_ref4) {
      var ellipsis = _ref4.ellipsis;
      return ellipsis;
    })) {
      return 'fixed';
    }
    return 'auto';
  }, [fixHeader, fixColumn, flattenColumns, tableLayout, isSticky]);
  var groupTableNode;

  // Header props
  var headerProps = {
    colWidths: colWidths,
    columCount: flattenColumns.length,
    stickyOffsets: stickyOffsets,
    onHeaderRow: onHeaderRow,
    fixHeader: fixHeader,
    scroll: scroll
  };

  // Empty
  var emptyNode = react.useMemo(function () {
    if (hasData) {
      return null;
    }
    if (typeof emptyText === 'function') {
      return emptyText();
    }
    return emptyText;
  }, [hasData, emptyText]);

  // Body
  var bodyTable = /*#__PURE__*/react.createElement(es_Body, {
    data: mergedData,
    measureColumnWidth: fixHeader || horizonScroll || isSticky
  });
  var bodyColGroup = /*#__PURE__*/react.createElement(es_ColGroup, {
    colWidths: flattenColumns.map(function (_ref5) {
      var width = _ref5.width;
      return width;
    }),
    columns: flattenColumns
  });
  var captionElement = caption !== null && caption !== undefined ? /*#__PURE__*/react.createElement("caption", {
    className: "".concat(prefixCls, "-caption")
  }, caption) : undefined;
  var dataProps = (0,pickAttrs/* default */.A)(props, {
    data: true
  });
  var ariaProps = (0,pickAttrs/* default */.A)(props, {
    aria: true
  });
  if (fixHeader || isSticky) {
    // >>>>>> Fixed Header
    var bodyContent;
    if (typeof customizeScrollBody === 'function') {
      bodyContent = customizeScrollBody(mergedData, {
        scrollbarSize: scrollbarSize,
        ref: scrollBodyRef,
        onScroll: onInternalScroll
      });
      headerProps.colWidths = flattenColumns.map(function (_ref6, index) {
        var width = _ref6.width;
        var colWidth = index === flattenColumns.length - 1 ? width - scrollbarSize : width;
        if (typeof colWidth === 'number' && !Number.isNaN(colWidth)) {
          return colWidth;
        }
        if (false) {}
        return 0;
      });
    } else {
      bodyContent = /*#__PURE__*/react.createElement("div", {
        style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, scrollXStyle), scrollYStyle),
        onScroll: onBodyScroll,
        ref: scrollBodyRef,
        className: classnames_default()("".concat(prefixCls, "-body"))
      }, /*#__PURE__*/react.createElement(TableComponent, (0,esm_extends/* default */.A)({
        style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, scrollTableStyle), {}, {
          tableLayout: mergedTableLayout
        })
      }, ariaProps), captionElement, bodyColGroup, bodyTable, !fixFooter && summaryNode && /*#__PURE__*/react.createElement(es_Footer, {
        stickyOffsets: stickyOffsets,
        flattenColumns: flattenColumns
      }, summaryNode)));
    }

    // Fixed holder share the props
    var fixedHolderProps = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({
      noData: !mergedData.length,
      maxContentScroll: horizonScroll && mergedScrollX === 'max-content'
    }, headerProps), columnContext), {}, {
      direction: direction,
      stickyClassName: stickyClassName,
      onScroll: onInternalScroll
    });
    groupTableNode = /*#__PURE__*/react.createElement(react.Fragment, null, showHeader !== false && /*#__PURE__*/react.createElement(es_FixedHolder, (0,esm_extends/* default */.A)({}, fixedHolderProps, {
      stickyTopOffset: offsetHeader,
      className: "".concat(prefixCls, "-header"),
      ref: scrollHeaderRef
    }), renderFixedHeaderTable), bodyContent, fixFooter && fixFooter !== 'top' && /*#__PURE__*/react.createElement(es_FixedHolder, (0,esm_extends/* default */.A)({}, fixedHolderProps, {
      stickyBottomOffset: offsetSummary,
      className: "".concat(prefixCls, "-summary"),
      ref: scrollSummaryRef
    }), renderFixedFooterTable), isSticky && scrollBodyRef.current && scrollBodyRef.current instanceof Element && /*#__PURE__*/react.createElement(stickyScrollBar, {
      ref: stickyRef,
      offsetScroll: offsetScroll,
      scrollBodyRef: scrollBodyRef,
      onScroll: onInternalScroll,
      container: container
    }));
  } else {
    // >>>>>> Unique table
    groupTableNode = /*#__PURE__*/react.createElement("div", {
      style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, scrollXStyle), scrollYStyle),
      className: classnames_default()("".concat(prefixCls, "-content")),
      onScroll: onInternalScroll,
      ref: scrollBodyRef
    }, /*#__PURE__*/react.createElement(TableComponent, (0,esm_extends/* default */.A)({
      style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, scrollTableStyle), {}, {
        tableLayout: mergedTableLayout
      })
    }, ariaProps), captionElement, bodyColGroup, showHeader !== false && /*#__PURE__*/react.createElement(Header_Header, (0,esm_extends/* default */.A)({}, headerProps, columnContext)), bodyTable, summaryNode && /*#__PURE__*/react.createElement(es_Footer, {
      stickyOffsets: stickyOffsets,
      flattenColumns: flattenColumns
    }, summaryNode)));
  }
  var fullTable = /*#__PURE__*/react.createElement("div", (0,esm_extends/* default */.A)({
    className: classnames_default()(prefixCls, className, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-rtl"), direction === 'rtl'), "".concat(prefixCls, "-ping-left"), pingedLeft), "".concat(prefixCls, "-ping-right"), pingedRight), "".concat(prefixCls, "-layout-fixed"), tableLayout === 'fixed'), "".concat(prefixCls, "-fixed-header"), fixHeader), "".concat(prefixCls, "-fixed-column"), fixColumn), "".concat(prefixCls, "-fixed-column-gapped"), fixColumn && hasGapFixed), "".concat(prefixCls, "-scroll-horizontal"), horizonScroll), "".concat(prefixCls, "-has-fix-left"), flattenColumns[0] && flattenColumns[0].fixed), "".concat(prefixCls, "-has-fix-right"), flattenColumns[flattenColumns.length - 1] && flattenColumns[flattenColumns.length - 1].fixed === 'right')),
    style: style,
    id: id,
    ref: fullTableRef
  }, dataProps), title && /*#__PURE__*/react.createElement(es_Panel, {
    className: "".concat(prefixCls, "-title")
  }, title(mergedData)), /*#__PURE__*/react.createElement("div", {
    ref: scrollBodyContainerRef,
    className: "".concat(prefixCls, "-container")
  }, groupTableNode), footer && /*#__PURE__*/react.createElement(es_Panel, {
    className: "".concat(prefixCls, "-footer")
  }, footer(mergedData)));
  if (horizonScroll) {
    fullTable = /*#__PURE__*/react.createElement(rc_resize_observer_es/* default */.A, {
      onResize: onFullTableResize
    }, fullTable);
  }
  var fixedInfoList = useFixedInfo(flattenColumns, stickyOffsets, direction);
  var TableContextValue = react.useMemo(function () {
    return {
      // Scroll
      scrollX: mergedScrollX,
      // Table
      prefixCls: prefixCls,
      getComponent: getComponent,
      scrollbarSize: scrollbarSize,
      direction: direction,
      fixedInfoList: fixedInfoList,
      isSticky: isSticky,
      supportSticky: supportSticky,
      componentWidth: componentWidth,
      fixHeader: fixHeader,
      fixColumn: fixColumn,
      horizonScroll: horizonScroll,
      // Body
      tableLayout: mergedTableLayout,
      rowClassName: rowClassName,
      expandedRowClassName: expandableConfig.expandedRowClassName,
      expandIcon: mergedExpandIcon,
      expandableType: expandableType,
      expandRowByClick: expandableConfig.expandRowByClick,
      expandedRowRender: expandableConfig.expandedRowRender,
      onTriggerExpand: onTriggerExpand,
      expandIconColumnIndex: expandableConfig.expandIconColumnIndex,
      indentSize: expandableConfig.indentSize,
      allColumnsFixedLeft: flattenColumns.every(function (col) {
        return col.fixed === 'left';
      }),
      emptyNode: emptyNode,
      // Column
      columns: columns,
      flattenColumns: flattenColumns,
      onColumnResize: onColumnResize,
      // Row
      hoverStartRow: startRow,
      hoverEndRow: endRow,
      onHover: onHover,
      rowExpandable: expandableConfig.rowExpandable,
      onRow: onRow,
      getRowKey: getRowKey,
      expandedKeys: mergedExpandedKeys,
      childrenColumnName: mergedChildrenColumnName,
      rowHoverable: rowHoverable
    };
  }, [
  // Scroll
  mergedScrollX,
  // Table
  prefixCls, getComponent, scrollbarSize, direction, fixedInfoList, isSticky, supportSticky, componentWidth, fixHeader, fixColumn, horizonScroll,
  // Body
  mergedTableLayout, rowClassName, expandableConfig.expandedRowClassName, mergedExpandIcon, expandableType, expandableConfig.expandRowByClick, expandableConfig.expandedRowRender, onTriggerExpand, expandableConfig.expandIconColumnIndex, expandableConfig.indentSize, emptyNode,
  // Column
  columns, flattenColumns, onColumnResize,
  // Row
  startRow, endRow, onHover, expandableConfig.rowExpandable, onRow, getRowKey, mergedExpandedKeys, mergedChildrenColumnName, rowHoverable]);
  return /*#__PURE__*/react.createElement(context_TableContext.Provider, {
    value: TableContextValue
  }, fullTable);
}
var RefTable = /*#__PURE__*/react.forwardRef(Table_Table);
if (false) {}
function genTable(shouldTriggerRender) {
  return TableContext_makeImmutable(RefTable, shouldTriggerRender);
}
var ImmutableTable = genTable();
ImmutableTable.EXPAND_COLUMN = EXPAND_COLUMN;
ImmutableTable.INTERNAL_HOOKS = INTERNAL_HOOKS;
ImmutableTable.Column = sugar_Column;
ImmutableTable.ColumnGroup = sugar_ColumnGroup;
ImmutableTable.Summary = FooterComponents;
/* harmony default export */ var es_Table = (ImmutableTable);
// EXTERNAL MODULE: ./node_modules/rc-virtual-list/es/index.js + 17 modules
var rc_virtual_list_es = __webpack_require__(60551);
;// ./node_modules/rc-table/es/VirtualTable/context.js

var StaticContext = createContext(null);
var GridContext = createContext(null);
;// ./node_modules/rc-table/es/VirtualTable/VirtualCell.js








/**
 * Return the width of the column by `colSpan`.
 * When `colSpan` is `0` will be trade as `1`.
 */
function getColumnWidth(colIndex, colSpan, columnsOffset) {
  var mergedColSpan = colSpan || 1;
  return columnsOffset[colIndex + mergedColSpan] - (columnsOffset[colIndex] || 0);
}
function VirtualCell(props) {
  var rowInfo = props.rowInfo,
    column = props.column,
    colIndex = props.colIndex,
    indent = props.indent,
    index = props.index,
    component = props.component,
    renderIndex = props.renderIndex,
    record = props.record,
    style = props.style,
    className = props.className,
    inverse = props.inverse,
    getHeight = props.getHeight;
  var render = column.render,
    dataIndex = column.dataIndex,
    columnClassName = column.className,
    colWidth = column.width;
  var _useContext = useContext(GridContext, ['columnsOffset']),
    columnsOffset = _useContext.columnsOffset;
  var _getCellProps = getCellProps(rowInfo, column, colIndex, indent, index),
    key = _getCellProps.key,
    fixedInfo = _getCellProps.fixedInfo,
    appendCellNode = _getCellProps.appendCellNode,
    additionalCellProps = _getCellProps.additionalCellProps;
  var cellStyle = additionalCellProps.style,
    _additionalCellProps$ = additionalCellProps.colSpan,
    colSpan = _additionalCellProps$ === void 0 ? 1 : _additionalCellProps$,
    _additionalCellProps$2 = additionalCellProps.rowSpan,
    rowSpan = _additionalCellProps$2 === void 0 ? 1 : _additionalCellProps$2;

  // ========================= ColWidth =========================
  // column width
  var startColIndex = colIndex - 1;
  var concatColWidth = getColumnWidth(startColIndex, colSpan, columnsOffset);

  // margin offset
  var marginOffset = colSpan > 1 ? colWidth - concatColWidth : 0;

  // ========================== Style ===========================
  var mergedStyle = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, cellStyle), style), {}, {
    flex: "0 0 ".concat(concatColWidth, "px"),
    width: "".concat(concatColWidth, "px"),
    marginRight: marginOffset,
    pointerEvents: 'auto'
  });

  // When `colSpan` or `rowSpan` is `0`, should skip render.
  var needHide = react.useMemo(function () {
    if (inverse) {
      return rowSpan <= 1;
    } else {
      return colSpan === 0 || rowSpan === 0 || rowSpan > 1;
    }
  }, [rowSpan, colSpan, inverse]);

  // 0 rowSpan or colSpan should not render
  if (needHide) {
    mergedStyle.visibility = 'hidden';
  } else if (inverse) {
    mergedStyle.height = getHeight === null || getHeight === void 0 ? void 0 : getHeight(rowSpan);
  }
  var mergedRender = needHide ? function () {
    return null;
  } : render;

  // ========================== Render ==========================
  var cellSpan = {};

  // Virtual should reset `colSpan` & `rowSpan`
  if (rowSpan === 0 || colSpan === 0) {
    cellSpan.rowSpan = 1;
    cellSpan.colSpan = 1;
  }
  return /*#__PURE__*/react.createElement(es_Cell, (0,esm_extends/* default */.A)({
    className: classnames_default()(columnClassName, className),
    ellipsis: column.ellipsis,
    align: column.align,
    scope: column.rowScope,
    component: component,
    prefixCls: rowInfo.prefixCls,
    key: key,
    record: record,
    index: index,
    renderIndex: renderIndex,
    dataIndex: dataIndex,
    render: mergedRender,
    shouldCellUpdate: column.shouldCellUpdate
  }, fixedInfo, {
    appendNode: appendCellNode,
    additionalProps: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, additionalCellProps), {}, {
      style: mergedStyle
    }, cellSpan)
  }));
}
/* harmony default export */ var VirtualTable_VirtualCell = (VirtualCell);
;// ./node_modules/rc-table/es/VirtualTable/BodyLine.js




var BodyLine_excluded = ["data", "index", "className", "rowKey", "style", "extra", "getHeight"];









var BodyLine = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var data = props.data,
    index = props.index,
    className = props.className,
    rowKey = props.rowKey,
    style = props.style,
    extra = props.extra,
    getHeight = props.getHeight,
    restProps = (0,objectWithoutProperties/* default */.A)(props, BodyLine_excluded);
  var record = data.record,
    indent = data.indent,
    renderIndex = data.index;
  var _useContext = useContext(context_TableContext, ['prefixCls', 'flattenColumns', 'fixColumn', 'componentWidth', 'scrollX']),
    scrollX = _useContext.scrollX,
    flattenColumns = _useContext.flattenColumns,
    prefixCls = _useContext.prefixCls,
    fixColumn = _useContext.fixColumn,
    componentWidth = _useContext.componentWidth;
  var _useContext2 = useContext(StaticContext, ['getComponent']),
    getComponent = _useContext2.getComponent;
  var rowInfo = useRowInfo(record, rowKey, index, indent);
  var RowComponent = getComponent(['body', 'row'], 'div');
  var cellComponent = getComponent(['body', 'cell'], 'div');

  // ========================== Expand ==========================
  var rowSupportExpand = rowInfo.rowSupportExpand,
    expanded = rowInfo.expanded,
    rowProps = rowInfo.rowProps,
    expandedRowRender = rowInfo.expandedRowRender,
    expandedRowClassName = rowInfo.expandedRowClassName;
  var expandRowNode;
  if (rowSupportExpand && expanded) {
    var expandContent = expandedRowRender(record, index, indent + 1, expanded);
    var expandedClsName = computedExpandedClassName(expandedRowClassName, record, index, indent);
    var additionalProps = {};
    if (fixColumn) {
      additionalProps = {
        style: (0,defineProperty/* default */.A)({}, '--virtual-width', "".concat(componentWidth, "px"))
      };
    }
    var rowCellCls = "".concat(prefixCls, "-expanded-row-cell");
    expandRowNode = /*#__PURE__*/react.createElement(RowComponent, {
      className: classnames_default()("".concat(prefixCls, "-expanded-row"), "".concat(prefixCls, "-expanded-row-level-").concat(indent + 1), expandedClsName)
    }, /*#__PURE__*/react.createElement(es_Cell, {
      component: cellComponent,
      prefixCls: prefixCls,
      className: classnames_default()(rowCellCls, (0,defineProperty/* default */.A)({}, "".concat(rowCellCls, "-fixed"), fixColumn)),
      additionalProps: additionalProps
    }, expandContent));
  }

  // ========================== Render ==========================
  var rowStyle = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, style), {}, {
    width: scrollX
  });
  if (extra) {
    rowStyle.position = 'absolute';
    rowStyle.pointerEvents = 'none';
  }
  var rowNode = /*#__PURE__*/react.createElement(RowComponent, (0,esm_extends/* default */.A)({}, rowProps, restProps, {
    "data-row-key": rowKey,
    ref: rowSupportExpand ? null : ref,
    className: classnames_default()(className, "".concat(prefixCls, "-row"), rowProps === null || rowProps === void 0 ? void 0 : rowProps.className, (0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-row-extra"), extra)),
    style: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, rowStyle), rowProps === null || rowProps === void 0 ? void 0 : rowProps.style)
  }), flattenColumns.map(function (column, colIndex) {
    return /*#__PURE__*/react.createElement(VirtualTable_VirtualCell, {
      key: colIndex,
      component: cellComponent,
      rowInfo: rowInfo,
      column: column,
      colIndex: colIndex,
      indent: indent,
      index: index,
      renderIndex: renderIndex,
      record: record,
      inverse: extra,
      getHeight: getHeight
    });
  }));
  if (rowSupportExpand) {
    return /*#__PURE__*/react.createElement("div", {
      ref: ref
    }, rowNode, expandRowNode);
  }
  return rowNode;
});
var ResponseBodyLine = TableContext_responseImmutable(BodyLine);
if (false) {}
/* harmony default export */ var VirtualTable_BodyLine = (ResponseBodyLine);
;// ./node_modules/rc-table/es/VirtualTable/BodyGrid.js









var Grid = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var data = props.data,
    onScroll = props.onScroll;
  var _useContext = useContext(context_TableContext, ['flattenColumns', 'onColumnResize', 'getRowKey', 'prefixCls', 'expandedKeys', 'childrenColumnName', 'scrollX', 'direction']),
    flattenColumns = _useContext.flattenColumns,
    onColumnResize = _useContext.onColumnResize,
    getRowKey = _useContext.getRowKey,
    expandedKeys = _useContext.expandedKeys,
    prefixCls = _useContext.prefixCls,
    childrenColumnName = _useContext.childrenColumnName,
    scrollX = _useContext.scrollX,
    direction = _useContext.direction;
  var _useContext2 = useContext(StaticContext),
    sticky = _useContext2.sticky,
    scrollY = _useContext2.scrollY,
    listItemHeight = _useContext2.listItemHeight,
    getComponent = _useContext2.getComponent,
    onTablePropScroll = _useContext2.onScroll;

  // =========================== Ref ============================
  var listRef = react.useRef();

  // =========================== Data ===========================
  var flattenData = useFlattenRecords(data, childrenColumnName, expandedKeys, getRowKey);

  // ========================== Column ==========================
  var columnsWidth = react.useMemo(function () {
    var total = 0;
    return flattenColumns.map(function (_ref) {
      var width = _ref.width,
        key = _ref.key;
      total += width;
      return [key, width, total];
    });
  }, [flattenColumns]);
  var columnsOffset = react.useMemo(function () {
    return columnsWidth.map(function (colWidth) {
      return colWidth[2];
    });
  }, [columnsWidth]);
  react.useEffect(function () {
    columnsWidth.forEach(function (_ref2) {
      var _ref3 = (0,slicedToArray/* default */.A)(_ref2, 2),
        key = _ref3[0],
        width = _ref3[1];
      onColumnResize(key, width);
    });
  }, [columnsWidth]);

  // =========================== Ref ============================
  react.useImperativeHandle(ref, function () {
    var _listRef$current2;
    var obj = {
      scrollTo: function scrollTo(config) {
        var _listRef$current;
        (_listRef$current = listRef.current) === null || _listRef$current === void 0 || _listRef$current.scrollTo(config);
      },
      nativeElement: (_listRef$current2 = listRef.current) === null || _listRef$current2 === void 0 ? void 0 : _listRef$current2.nativeElement
    };
    Object.defineProperty(obj, 'scrollLeft', {
      get: function get() {
        var _listRef$current3;
        return ((_listRef$current3 = listRef.current) === null || _listRef$current3 === void 0 ? void 0 : _listRef$current3.getScrollInfo().x) || 0;
      },
      set: function set(value) {
        var _listRef$current4;
        (_listRef$current4 = listRef.current) === null || _listRef$current4 === void 0 || _listRef$current4.scrollTo({
          left: value
        });
      }
    });
    return obj;
  });

  // ======================= Col/Row Span =======================
  var getRowSpan = function getRowSpan(column, index) {
    var _flattenData$index;
    var record = (_flattenData$index = flattenData[index]) === null || _flattenData$index === void 0 ? void 0 : _flattenData$index.record;
    var onCell = column.onCell;
    if (onCell) {
      var _cellProps$rowSpan;
      var cellProps = onCell(record, index);
      return (_cellProps$rowSpan = cellProps === null || cellProps === void 0 ? void 0 : cellProps.rowSpan) !== null && _cellProps$rowSpan !== void 0 ? _cellProps$rowSpan : 1;
    }
    return 1;
  };
  var extraRender = function extraRender(info) {
    var start = info.start,
      end = info.end,
      getSize = info.getSize,
      offsetY = info.offsetY;

    // Do nothing if no data
    if (end < 0) {
      return null;
    }

    // Find first rowSpan column
    var firstRowSpanColumns = flattenColumns.filter(
    // rowSpan is 0
    function (column) {
      return getRowSpan(column, start) === 0;
    });
    var startIndex = start;
    var _loop = function _loop(i) {
      firstRowSpanColumns = firstRowSpanColumns.filter(function (column) {
        return getRowSpan(column, i) === 0;
      });
      if (!firstRowSpanColumns.length) {
        startIndex = i;
        return 1; // break
      }
    };
    for (var i = start; i >= 0; i -= 1) {
      if (_loop(i)) break;
    }

    // Find last rowSpan column
    var lastRowSpanColumns = flattenColumns.filter(
    // rowSpan is not 1
    function (column) {
      return getRowSpan(column, end) !== 1;
    });
    var endIndex = end;
    var _loop2 = function _loop2(_i) {
      lastRowSpanColumns = lastRowSpanColumns.filter(function (column) {
        return getRowSpan(column, _i) !== 1;
      });
      if (!lastRowSpanColumns.length) {
        endIndex = Math.max(_i - 1, end);
        return 1; // break
      }
    };
    for (var _i = end; _i < flattenData.length; _i += 1) {
      if (_loop2(_i)) break;
    }

    // Collect the line who has rowSpan
    var spanLines = [];
    var _loop3 = function _loop3(_i2) {
      var item = flattenData[_i2];

      // This code will never reach, just incase
      if (!item) {
        return 1; // continue
      }
      if (flattenColumns.some(function (column) {
        return getRowSpan(column, _i2) > 1;
      })) {
        spanLines.push(_i2);
      }
    };
    for (var _i2 = startIndex; _i2 <= endIndex; _i2 += 1) {
      if (_loop3(_i2)) continue;
    }

    // Patch extra line on the page
    var nodes = spanLines.map(function (index) {
      var item = flattenData[index];
      var rowKey = getRowKey(item.record, index);
      var getHeight = function getHeight(rowSpan) {
        var endItemIndex = index + rowSpan - 1;
        var endItemKey = getRowKey(flattenData[endItemIndex].record, endItemIndex);
        var sizeInfo = getSize(rowKey, endItemKey);
        return sizeInfo.bottom - sizeInfo.top;
      };
      var sizeInfo = getSize(rowKey);
      return /*#__PURE__*/react.createElement(VirtualTable_BodyLine, {
        key: index,
        data: item,
        rowKey: rowKey,
        index: index,
        style: {
          top: -offsetY + sizeInfo.top
        },
        extra: true,
        getHeight: getHeight
      });
    });
    return nodes;
  };

  // ========================= Context ==========================
  var gridContext = react.useMemo(function () {
    return {
      columnsOffset: columnsOffset
    };
  }, [columnsOffset]);

  // ========================== Render ==========================
  var tblPrefixCls = "".concat(prefixCls, "-tbody");

  // default 'div' in rc-virtual-list
  var wrapperComponent = getComponent(['body', 'wrapper']);

  // ========================== Sticky Scroll Bar ==========================
  var horizontalScrollBarStyle = {};
  if (sticky) {
    horizontalScrollBarStyle.position = 'sticky';
    horizontalScrollBarStyle.bottom = 0;
    if ((0,esm_typeof/* default */.A)(sticky) === 'object' && sticky.offsetScroll) {
      horizontalScrollBarStyle.bottom = sticky.offsetScroll;
    }
  }
  return /*#__PURE__*/react.createElement(GridContext.Provider, {
    value: gridContext
  }, /*#__PURE__*/react.createElement(rc_virtual_list_es/* default */.A, {
    fullHeight: false,
    ref: listRef,
    prefixCls: "".concat(tblPrefixCls, "-virtual"),
    styles: {
      horizontalScrollBar: horizontalScrollBarStyle
    },
    className: tblPrefixCls,
    height: scrollY,
    itemHeight: listItemHeight || 24,
    data: flattenData,
    itemKey: function itemKey(item) {
      return getRowKey(item.record);
    },
    component: wrapperComponent,
    scrollWidth: scrollX,
    direction: direction,
    onVirtualScroll: function onVirtualScroll(_ref4) {
      var _listRef$current5;
      var x = _ref4.x;
      onScroll({
        currentTarget: (_listRef$current5 = listRef.current) === null || _listRef$current5 === void 0 ? void 0 : _listRef$current5.nativeElement,
        scrollLeft: x
      });
    },
    onScroll: onTablePropScroll,
    extraRender: extraRender
  }, function (item, index, itemProps) {
    var rowKey = getRowKey(item.record, index);
    return /*#__PURE__*/react.createElement(VirtualTable_BodyLine, {
      data: item,
      rowKey: rowKey,
      index: index,
      style: itemProps.style
    });
  }));
});
var ResponseGrid = TableContext_responseImmutable(Grid);
if (false) {}
/* harmony default export */ var BodyGrid = (ResponseGrid);
;// ./node_modules/rc-table/es/VirtualTable/index.js











var renderBody = function renderBody(rawData, props) {
  var ref = props.ref,
    onScroll = props.onScroll;
  return /*#__PURE__*/react.createElement(BodyGrid, {
    ref: ref,
    data: rawData,
    onScroll: onScroll
  });
};
function VirtualTable(props, ref) {
  var data = props.data,
    columns = props.columns,
    scroll = props.scroll,
    sticky = props.sticky,
    _props$prefixCls = props.prefixCls,
    prefixCls = _props$prefixCls === void 0 ? DEFAULT_PREFIX : _props$prefixCls,
    className = props.className,
    listItemHeight = props.listItemHeight,
    components = props.components,
    onScroll = props.onScroll;
  var _ref = scroll || {},
    scrollX = _ref.x,
    scrollY = _ref.y;

  // Fill scrollX
  if (typeof scrollX !== 'number') {
    if (false) {}
    scrollX = 1;
  }

  // Fill scrollY
  if (typeof scrollY !== 'number') {
    scrollY = 500;
    if (false) {}
  }
  var getComponent = (0,es/* useEvent */._q)(function (path, defaultComponent) {
    return (0,get/* default */.A)(components, path) || defaultComponent;
  });

  // Memo this
  var onInternalScroll = (0,es/* useEvent */._q)(onScroll);

  // ========================= Context ==========================
  var context = react.useMemo(function () {
    return {
      sticky: sticky,
      scrollY: scrollY,
      listItemHeight: listItemHeight,
      getComponent: getComponent,
      onScroll: onInternalScroll
    };
  }, [sticky, scrollY, listItemHeight, getComponent, onInternalScroll]);

  // ========================== Render ==========================
  return /*#__PURE__*/react.createElement(StaticContext.Provider, {
    value: context
  }, /*#__PURE__*/react.createElement(es_Table, (0,esm_extends/* default */.A)({}, props, {
    className: classnames_default()(className, "".concat(prefixCls, "-virtual")),
    scroll: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, scroll), {}, {
      x: scrollX
    }),
    components: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, components), {}, {
      // fix https://github.com/ant-design/ant-design/issues/48991
      body: data !== null && data !== void 0 && data.length ? renderBody : undefined
    }),
    columns: columns,
    internalHooks: INTERNAL_HOOKS,
    tailor: true,
    ref: ref
  })));
}
var RefVirtualTable = /*#__PURE__*/react.forwardRef(VirtualTable);
if (false) {}
function genVirtualTable(shouldTriggerRender) {
  return TableContext_makeImmutable(RefVirtualTable, shouldTriggerRender);
}
/* harmony default export */ var es_VirtualTable = (genVirtualTable());
;// ./node_modules/rc-table/es/index.js








/* harmony default export */ var rc_table_es = ((/* unused pure expression or super */ null && (Table)));
;// ./node_modules/antd/es/table/Column.js
/* istanbul ignore next */
/** This is a syntactic sugar for `columns` prop. So HOC will not work on this. */
const Column_Column = _ => null;
/* harmony default export */ var table_Column = (Column_Column);
;// ./node_modules/antd/es/table/ColumnGroup.js
/* istanbul ignore next */
/** This is a syntactic sugar for `columns` prop. So HOC will not work on this. */
const ColumnGroup_ColumnGroup = _ => null;
/* harmony default export */ var table_ColumnGroup = (ColumnGroup_ColumnGroup);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/DownOutlined.js + 1 modules
var DownOutlined = __webpack_require__(14103);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/classCallCheck.js
var classCallCheck = __webpack_require__(23029);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/createClass.js
var createClass = __webpack_require__(92901);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/assertThisInitialized.js
var assertThisInitialized = __webpack_require__(9417);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/inherits.js
var inherits = __webpack_require__(85501);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/createSuper.js + 1 modules
var createSuper = __webpack_require__(49640);
;// ./node_modules/rc-tree/es/contextTypes.js
/**
 * Webpack has bug for import loop, which is not the same behavior as ES module.
 * When util.js imports the TreeNode for tree generate will cause treeContextTypes be empty.
 */

var TreeContext = /*#__PURE__*/react.createContext(null);
;// ./node_modules/rc-tree/es/Indent.js



var Indent = function Indent(_ref) {
  var prefixCls = _ref.prefixCls,
    level = _ref.level,
    isStart = _ref.isStart,
    isEnd = _ref.isEnd;
  var baseClassName = "".concat(prefixCls, "-indent-unit");
  var list = [];
  for (var i = 0; i < level; i += 1) {
    list.push( /*#__PURE__*/react.createElement("span", {
      key: i,
      className: classnames_default()(baseClassName, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(baseClassName, "-start"), isStart[i]), "".concat(baseClassName, "-end"), isEnd[i]))
    }));
  }
  return /*#__PURE__*/react.createElement("span", {
    "aria-hidden": "true",
    className: "".concat(prefixCls, "-indent")
  }, list);
};
/* harmony default export */ var es_Indent = (/*#__PURE__*/react.memo(Indent));
;// ./node_modules/rc-tree/es/utils/keyUtil.js
function getEntity(keyEntities, key) {
  return keyEntities[key];
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
;// ./node_modules/rc-tree/es/utils/treeUtil.js




var treeUtil_excluded = ["children"];




function getPosition(level, index) {
  return "".concat(level, "-").concat(index);
}
function isTreeNode(node) {
  return node && node.type && node.type.isTreeNode;
}
function getKey(key, pos) {
  if (key !== null && key !== undefined) {
    return key;
  }
  return pos;
}
function fillFieldNames(fieldNames) {
  var _ref = fieldNames || {},
    title = _ref.title,
    _title = _ref._title,
    key = _ref.key,
    children = _ref.children;
  var mergedTitle = title || 'title';
  return {
    title: mergedTitle,
    _title: _title || [mergedTitle],
    key: key || 'key',
    children: children || 'children'
  };
}

/**
 * Warning if TreeNode do not provides key
 */
function warningWithoutKey(treeData, fieldNames) {
  var keys = new Map();
  function dig(list) {
    var path = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
    (list || []).forEach(function (treeNode) {
      var key = treeNode[fieldNames.key];
      var children = treeNode[fieldNames.children];
      warning(key !== null && key !== undefined, "Tree node must have a certain key: [".concat(path).concat(key, "]"));
      var recordKey = String(key);
      warning(!keys.has(recordKey) || key === null || key === undefined, "Same 'key' exist in the Tree: ".concat(recordKey));
      keys.set(recordKey, true);
      dig(children, "".concat(path).concat(recordKey, " > "));
    });
  }
  dig(treeData);
}

/**
 * Convert `children` of Tree into `treeData` structure.
 */
function convertTreeToData(rootNodes) {
  function dig(node) {
    var treeNodes = (0,Children_toArray/* default */.A)(node);
    return treeNodes.map(function (treeNode) {
      // Filter invalidate node
      if (!isTreeNode(treeNode)) {
        (0,es_warning/* default */.Ay)(!treeNode, 'Tree/TreeNode can only accept TreeNode as children.');
        return null;
      }
      var key = treeNode.key;
      var _treeNode$props = treeNode.props,
        children = _treeNode$props.children,
        rest = (0,objectWithoutProperties/* default */.A)(_treeNode$props, treeUtil_excluded);
      var dataNode = (0,objectSpread2/* default */.A)({
        key: key
      }, rest);
      var parsedChildren = dig(children);
      if (parsedChildren.length) {
        dataNode.children = parsedChildren;
      }
      return dataNode;
    }).filter(function (dataNode) {
      return dataNode;
    });
  }
  return dig(rootNodes);
}

/**
 * Flat nest tree data into flatten list. This is used for virtual list render.
 * @param treeNodeList Origin data node list
 * @param expandedKeys
 * need expanded keys, provides `true` means all expanded (used in `rc-tree-select`).
 */
function flattenTreeData(treeNodeList, expandedKeys, fieldNames) {
  var _fillFieldNames = fillFieldNames(fieldNames),
    fieldTitles = _fillFieldNames._title,
    fieldKey = _fillFieldNames.key,
    fieldChildren = _fillFieldNames.children;
  var expandedKeySet = new Set(expandedKeys === true ? [] : expandedKeys);
  var flattenList = [];
  function dig(list) {
    var parent = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
    return list.map(function (treeNode, index) {
      var pos = getPosition(parent ? parent.pos : '0', index);
      var mergedKey = getKey(treeNode[fieldKey], pos);

      // Pick matched title in field title list
      var mergedTitle;
      for (var i = 0; i < fieldTitles.length; i += 1) {
        var fieldTitle = fieldTitles[i];
        if (treeNode[fieldTitle] !== undefined) {
          mergedTitle = treeNode[fieldTitle];
          break;
        }
      }

      // Add FlattenDataNode into list
      // We use `Object.assign` here to save perf since babel's `objectSpread` has perf issue
      var flattenNode = Object.assign((0,omit/* default */.A)(treeNode, [].concat((0,toConsumableArray/* default */.A)(fieldTitles), [fieldKey, fieldChildren])), {
        title: mergedTitle,
        key: mergedKey,
        parent: parent,
        pos: pos,
        children: null,
        data: treeNode,
        isStart: [].concat((0,toConsumableArray/* default */.A)(parent ? parent.isStart : []), [index === 0]),
        isEnd: [].concat((0,toConsumableArray/* default */.A)(parent ? parent.isEnd : []), [index === list.length - 1])
      });
      flattenList.push(flattenNode);

      // Loop treeNode children
      if (expandedKeys === true || expandedKeySet.has(mergedKey)) {
        flattenNode.children = dig(treeNode[fieldChildren] || [], flattenNode);
      } else {
        flattenNode.children = [];
      }
      return flattenNode;
    });
  }
  dig(treeNodeList);
  return flattenList;
}
/**
 * Traverse all the data by `treeData`.
 * Please not use it out of the `rc-tree` since we may refactor this code.
 */
function traverseDataNodes(dataNodes, callback,
// To avoid too many params, let use config instead of origin param
config) {
  var mergedConfig = {};
  if ((0,esm_typeof/* default */.A)(config) === 'object') {
    mergedConfig = config;
  } else {
    mergedConfig = {
      externalGetKey: config
    };
  }
  mergedConfig = mergedConfig || {};

  // Init config
  var _mergedConfig = mergedConfig,
    childrenPropName = _mergedConfig.childrenPropName,
    externalGetKey = _mergedConfig.externalGetKey,
    fieldNames = _mergedConfig.fieldNames;
  var _fillFieldNames2 = fillFieldNames(fieldNames),
    fieldKey = _fillFieldNames2.key,
    fieldChildren = _fillFieldNames2.children;
  var mergeChildrenPropName = childrenPropName || fieldChildren;

  // Get keys
  var syntheticGetKey;
  if (externalGetKey) {
    if (typeof externalGetKey === 'string') {
      syntheticGetKey = function syntheticGetKey(node) {
        return node[externalGetKey];
      };
    } else if (typeof externalGetKey === 'function') {
      syntheticGetKey = function syntheticGetKey(node) {
        return externalGetKey(node);
      };
    }
  } else {
    syntheticGetKey = function syntheticGetKey(node, pos) {
      return getKey(node[fieldKey], pos);
    };
  }

  // Process
  function processNode(node, index, parent, pathNodes) {
    var children = node ? node[mergeChildrenPropName] : dataNodes;
    var pos = node ? getPosition(parent.pos, index) : '0';
    var connectNodes = node ? [].concat((0,toConsumableArray/* default */.A)(pathNodes), [node]) : [];

    // Process node if is not root
    if (node) {
      var key = syntheticGetKey(node, pos);
      var _data = {
        node: node,
        index: index,
        pos: pos,
        key: key,
        parentPos: parent.node ? parent.pos : null,
        level: parent.level + 1,
        nodes: connectNodes
      };
      callback(_data);
    }

    // Process children node
    if (children) {
      children.forEach(function (subNode, subIndex) {
        processNode(subNode, subIndex, {
          node: node,
          pos: pos,
          level: parent ? parent.level + 1 : -1
        }, connectNodes);
      });
    }
  }
  processNode(null);
}
/**
 * Convert `treeData` into entity records.
 */
function convertDataToEntities(dataNodes) {
  var _ref2 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
    initWrapper = _ref2.initWrapper,
    processEntity = _ref2.processEntity,
    onProcessFinished = _ref2.onProcessFinished,
    externalGetKey = _ref2.externalGetKey,
    childrenPropName = _ref2.childrenPropName,
    fieldNames = _ref2.fieldNames;
  var /** @deprecated Use `config.externalGetKey` instead */
  legacyExternalGetKey = arguments.length > 2 ? arguments[2] : undefined;
  // Init config
  var mergedExternalGetKey = externalGetKey || legacyExternalGetKey;
  var posEntities = {};
  var keyEntities = {};
  var wrapper = {
    posEntities: posEntities,
    keyEntities: keyEntities
  };
  if (initWrapper) {
    wrapper = initWrapper(wrapper) || wrapper;
  }
  traverseDataNodes(dataNodes, function (item) {
    var node = item.node,
      index = item.index,
      pos = item.pos,
      key = item.key,
      parentPos = item.parentPos,
      level = item.level,
      nodes = item.nodes;
    var entity = {
      node: node,
      nodes: nodes,
      index: index,
      key: key,
      pos: pos,
      level: level
    };
    var mergedKey = getKey(key, pos);
    posEntities[pos] = entity;
    keyEntities[mergedKey] = entity;

    // Fill children
    entity.parent = posEntities[parentPos];
    if (entity.parent) {
      entity.parent.children = entity.parent.children || [];
      entity.parent.children.push(entity);
    }
    if (processEntity) {
      processEntity(entity, wrapper);
    }
  }, {
    externalGetKey: mergedExternalGetKey,
    childrenPropName: childrenPropName,
    fieldNames: fieldNames
  });
  if (onProcessFinished) {
    onProcessFinished(wrapper);
  }
  return wrapper;
}
/**
 * Get TreeNode props with Tree props.
 */
function getTreeNodeProps(key, _ref3) {
  var expandedKeys = _ref3.expandedKeys,
    selectedKeys = _ref3.selectedKeys,
    loadedKeys = _ref3.loadedKeys,
    loadingKeys = _ref3.loadingKeys,
    checkedKeys = _ref3.checkedKeys,
    halfCheckedKeys = _ref3.halfCheckedKeys,
    dragOverNodeKey = _ref3.dragOverNodeKey,
    dropPosition = _ref3.dropPosition,
    keyEntities = _ref3.keyEntities;
  var entity = getEntity(keyEntities, key);
  var treeNodeProps = {
    eventKey: key,
    expanded: expandedKeys.indexOf(key) !== -1,
    selected: selectedKeys.indexOf(key) !== -1,
    loaded: loadedKeys.indexOf(key) !== -1,
    loading: loadingKeys.indexOf(key) !== -1,
    checked: checkedKeys.indexOf(key) !== -1,
    halfChecked: halfCheckedKeys.indexOf(key) !== -1,
    pos: String(entity ? entity.pos : ''),
    // [Legacy] Drag props
    // Since the interaction of drag is changed, the semantic of the props are
    // not accuracy, I think it should be finally removed
    dragOver: dragOverNodeKey === key && dropPosition === 0,
    dragOverGapTop: dragOverNodeKey === key && dropPosition === -1,
    dragOverGapBottom: dragOverNodeKey === key && dropPosition === 1
  };
  return treeNodeProps;
}
function convertNodePropsToEventData(props) {
  var data = props.data,
    expanded = props.expanded,
    selected = props.selected,
    checked = props.checked,
    loaded = props.loaded,
    loading = props.loading,
    halfChecked = props.halfChecked,
    dragOver = props.dragOver,
    dragOverGapTop = props.dragOverGapTop,
    dragOverGapBottom = props.dragOverGapBottom,
    pos = props.pos,
    active = props.active,
    eventKey = props.eventKey;
  var eventData = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, data), {}, {
    expanded: expanded,
    selected: selected,
    checked: checked,
    loaded: loaded,
    loading: loading,
    halfChecked: halfChecked,
    dragOver: dragOver,
    dragOverGapTop: dragOverGapTop,
    dragOverGapBottom: dragOverGapBottom,
    pos: pos,
    active: active,
    key: eventKey
  });
  if (!('props' in eventData)) {
    Object.defineProperty(eventData, 'props', {
      get: function get() {
        (0,es_warning/* default */.Ay)(false, 'Second param return from event is node data instead of TreeNode instance. Please read value directly instead of reading from `props`.');
        return props;
      }
    });
  }
  return eventData;
}
;// ./node_modules/rc-tree/es/TreeNode.js









var TreeNode_excluded = ["eventKey", "className", "style", "dragOver", "dragOverGapTop", "dragOverGapBottom", "isLeaf", "isStart", "isEnd", "expanded", "selected", "checked", "halfChecked", "loading", "domRef", "active", "data", "onMouseMove", "selectable"];



// @ts-ignore




var ICON_OPEN = 'open';
var ICON_CLOSE = 'close';
var defaultTitle = '---';
var InternalTreeNode = /*#__PURE__*/function (_React$Component) {
  (0,inherits/* default */.A)(InternalTreeNode, _React$Component);
  var _super = (0,createSuper/* default */.A)(InternalTreeNode);
  function InternalTreeNode() {
    var _this;
    (0,classCallCheck/* default */.A)(this, InternalTreeNode);
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    _this = _super.call.apply(_super, [this].concat(args));
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "state", {
      dragNodeHighlight: false
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "selectHandle", void 0);
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "cacheIndent", void 0);
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onSelectorClick", function (e) {
      // Click trigger before select/check operation
      var onNodeClick = _this.props.context.onNodeClick;
      onNodeClick(e, convertNodePropsToEventData(_this.props));
      if (_this.isSelectable()) {
        _this.onSelect(e);
      } else {
        _this.onCheck(e);
      }
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onSelectorDoubleClick", function (e) {
      var onNodeDoubleClick = _this.props.context.onNodeDoubleClick;
      onNodeDoubleClick(e, convertNodePropsToEventData(_this.props));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onSelect", function (e) {
      if (_this.isDisabled()) return;
      var onNodeSelect = _this.props.context.onNodeSelect;
      onNodeSelect(e, convertNodePropsToEventData(_this.props));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onCheck", function (e) {
      if (_this.isDisabled()) return;
      var _this$props = _this.props,
        disableCheckbox = _this$props.disableCheckbox,
        checked = _this$props.checked;
      var onNodeCheck = _this.props.context.onNodeCheck;
      if (!_this.isCheckable() || disableCheckbox) return;
      var targetChecked = !checked;
      onNodeCheck(e, convertNodePropsToEventData(_this.props), targetChecked);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onMouseEnter", function (e) {
      var onNodeMouseEnter = _this.props.context.onNodeMouseEnter;
      onNodeMouseEnter(e, convertNodePropsToEventData(_this.props));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onMouseLeave", function (e) {
      var onNodeMouseLeave = _this.props.context.onNodeMouseLeave;
      onNodeMouseLeave(e, convertNodePropsToEventData(_this.props));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onContextMenu", function (e) {
      var onNodeContextMenu = _this.props.context.onNodeContextMenu;
      onNodeContextMenu(e, convertNodePropsToEventData(_this.props));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onDragStart", function (e) {
      var onNodeDragStart = _this.props.context.onNodeDragStart;
      e.stopPropagation();
      _this.setState({
        dragNodeHighlight: true
      });
      onNodeDragStart(e, (0,assertThisInitialized/* default */.A)(_this));
      try {
        // ie throw error
        // firefox-need-it
        e.dataTransfer.setData('text/plain', '');
      } catch (error) {
        // empty
      }
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onDragEnter", function (e) {
      var onNodeDragEnter = _this.props.context.onNodeDragEnter;
      e.preventDefault();
      e.stopPropagation();
      onNodeDragEnter(e, (0,assertThisInitialized/* default */.A)(_this));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onDragOver", function (e) {
      var onNodeDragOver = _this.props.context.onNodeDragOver;
      e.preventDefault();
      e.stopPropagation();
      onNodeDragOver(e, (0,assertThisInitialized/* default */.A)(_this));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onDragLeave", function (e) {
      var onNodeDragLeave = _this.props.context.onNodeDragLeave;
      e.stopPropagation();
      onNodeDragLeave(e, (0,assertThisInitialized/* default */.A)(_this));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onDragEnd", function (e) {
      var onNodeDragEnd = _this.props.context.onNodeDragEnd;
      e.stopPropagation();
      _this.setState({
        dragNodeHighlight: false
      });
      onNodeDragEnd(e, (0,assertThisInitialized/* default */.A)(_this));
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onDrop", function (e) {
      var onNodeDrop = _this.props.context.onNodeDrop;
      e.preventDefault();
      e.stopPropagation();
      _this.setState({
        dragNodeHighlight: false
      });
      onNodeDrop(e, (0,assertThisInitialized/* default */.A)(_this));
    });
    // Disabled item still can be switch
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onExpand", function (e) {
      var _this$props2 = _this.props,
        loading = _this$props2.loading,
        onNodeExpand = _this$props2.context.onNodeExpand;
      if (loading) return;
      onNodeExpand(e, convertNodePropsToEventData(_this.props));
    });
    // Drag usage
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "setSelectHandle", function (node) {
      _this.selectHandle = node;
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "getNodeState", function () {
      var expanded = _this.props.expanded;
      if (_this.isLeaf()) {
        return null;
      }
      return expanded ? ICON_OPEN : ICON_CLOSE;
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "hasChildren", function () {
      var eventKey = _this.props.eventKey;
      var keyEntities = _this.props.context.keyEntities;
      var _ref = getEntity(keyEntities, eventKey) || {},
        children = _ref.children;
      return !!(children || []).length;
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "isLeaf", function () {
      var _this$props3 = _this.props,
        isLeaf = _this$props3.isLeaf,
        loaded = _this$props3.loaded;
      var loadData = _this.props.context.loadData;
      var hasChildren = _this.hasChildren();
      if (isLeaf === false) {
        return false;
      }
      return isLeaf || !loadData && !hasChildren || loadData && loaded && !hasChildren;
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "isDisabled", function () {
      var disabled = _this.props.disabled;
      var treeDisabled = _this.props.context.disabled;
      return !!(treeDisabled || disabled);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "isCheckable", function () {
      var checkable = _this.props.checkable;
      var treeCheckable = _this.props.context.checkable;

      // Return false if tree or treeNode is not checkable
      if (!treeCheckable || checkable === false) return false;
      return treeCheckable;
    });
    // Load data to avoid default expanded tree without data
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "syncLoadData", function (props) {
      var expanded = props.expanded,
        loading = props.loading,
        loaded = props.loaded;
      var _this$props$context = _this.props.context,
        loadData = _this$props$context.loadData,
        onNodeLoad = _this$props$context.onNodeLoad;
      if (loading) {
        return;
      }

      // read from state to avoid loadData at same time
      if (loadData && expanded && !_this.isLeaf() && !loaded) {
        // We needn't reload data when has children in sync logic
        // It's only needed in node expanded
        onNodeLoad(convertNodePropsToEventData(_this.props));
      }
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "isDraggable", function () {
      var _this$props4 = _this.props,
        data = _this$props4.data,
        draggable = _this$props4.context.draggable;
      return !!(draggable && (!draggable.nodeDraggable || draggable.nodeDraggable(data)));
    });
    // ==================== Render: Drag Handler ====================
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "renderDragHandler", function () {
      var _this$props$context2 = _this.props.context,
        draggable = _this$props$context2.draggable,
        prefixCls = _this$props$context2.prefixCls;
      return draggable !== null && draggable !== void 0 && draggable.icon ? /*#__PURE__*/react.createElement("span", {
        className: "".concat(prefixCls, "-draggable-icon")
      }, draggable.icon) : null;
    });
    // ====================== Render: Switcher ======================
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "renderSwitcherIconDom", function (isLeaf) {
      var switcherIconFromProps = _this.props.switcherIcon;
      var switcherIconFromCtx = _this.props.context.switcherIcon;
      var switcherIcon = switcherIconFromProps || switcherIconFromCtx;
      // if switcherIconDom is null, no render switcher span
      if (typeof switcherIcon === 'function') {
        return switcherIcon((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, _this.props), {}, {
          isLeaf: isLeaf
        }));
      }
      return switcherIcon;
    });
    // Switcher
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "renderSwitcher", function () {
      var expanded = _this.props.expanded;
      var prefixCls = _this.props.context.prefixCls;
      if (_this.isLeaf()) {
        // if switcherIconDom is null, no render switcher span
        var _switcherIconDom = _this.renderSwitcherIconDom(true);
        return _switcherIconDom !== false ? /*#__PURE__*/react.createElement("span", {
          className: classnames_default()("".concat(prefixCls, "-switcher"), "".concat(prefixCls, "-switcher-noop"))
        }, _switcherIconDom) : null;
      }
      var switcherCls = classnames_default()("".concat(prefixCls, "-switcher"), "".concat(prefixCls, "-switcher_").concat(expanded ? ICON_OPEN : ICON_CLOSE));
      var switcherIconDom = _this.renderSwitcherIconDom(false);
      return switcherIconDom !== false ? /*#__PURE__*/react.createElement("span", {
        onClick: _this.onExpand,
        className: switcherCls
      }, switcherIconDom) : null;
    });
    // ====================== Render: Checkbox ======================
    // Checkbox
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "renderCheckbox", function () {
      var _this$props5 = _this.props,
        checked = _this$props5.checked,
        halfChecked = _this$props5.halfChecked,
        disableCheckbox = _this$props5.disableCheckbox;
      var prefixCls = _this.props.context.prefixCls;
      var disabled = _this.isDisabled();
      var checkable = _this.isCheckable();
      if (!checkable) return null;

      // [Legacy] Custom element should be separate with `checkable` in future
      var $custom = typeof checkable !== 'boolean' ? checkable : null;
      return /*#__PURE__*/react.createElement("span", {
        className: classnames_default()("".concat(prefixCls, "-checkbox"), checked && "".concat(prefixCls, "-checkbox-checked"), !checked && halfChecked && "".concat(prefixCls, "-checkbox-indeterminate"), (disabled || disableCheckbox) && "".concat(prefixCls, "-checkbox-disabled")),
        onClick: _this.onCheck
      }, $custom);
    });
    // ==================== Render: Title + Icon ====================
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "renderIcon", function () {
      var loading = _this.props.loading;
      var prefixCls = _this.props.context.prefixCls;
      return /*#__PURE__*/react.createElement("span", {
        className: classnames_default()("".concat(prefixCls, "-iconEle"), "".concat(prefixCls, "-icon__").concat(_this.getNodeState() || 'docu'), loading && "".concat(prefixCls, "-icon_loading"))
      });
    });
    // Icon + Title
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "renderSelector", function () {
      var dragNodeHighlight = _this.state.dragNodeHighlight;
      var _this$props6 = _this.props,
        _this$props6$title = _this$props6.title,
        title = _this$props6$title === void 0 ? defaultTitle : _this$props6$title,
        selected = _this$props6.selected,
        icon = _this$props6.icon,
        loading = _this$props6.loading,
        data = _this$props6.data;
      var _this$props$context3 = _this.props.context,
        prefixCls = _this$props$context3.prefixCls,
        showIcon = _this$props$context3.showIcon,
        treeIcon = _this$props$context3.icon,
        loadData = _this$props$context3.loadData,
        titleRender = _this$props$context3.titleRender;
      var disabled = _this.isDisabled();
      var wrapClass = "".concat(prefixCls, "-node-content-wrapper");

      // Icon - Still show loading icon when loading without showIcon
      var $icon;
      if (showIcon) {
        var currentIcon = icon || treeIcon;
        $icon = currentIcon ? /*#__PURE__*/react.createElement("span", {
          className: classnames_default()("".concat(prefixCls, "-iconEle"), "".concat(prefixCls, "-icon__customize"))
        }, typeof currentIcon === 'function' ? currentIcon(_this.props) : currentIcon) : _this.renderIcon();
      } else if (loadData && loading) {
        $icon = _this.renderIcon();
      }

      // Title
      var titleNode;
      if (typeof title === 'function') {
        titleNode = title(data);
      } else if (titleRender) {
        titleNode = titleRender(data);
      } else {
        titleNode = title;
      }
      var $title = /*#__PURE__*/react.createElement("span", {
        className: "".concat(prefixCls, "-title")
      }, titleNode);
      return /*#__PURE__*/react.createElement("span", {
        ref: _this.setSelectHandle,
        title: typeof title === 'string' ? title : '',
        className: classnames_default()("".concat(wrapClass), "".concat(wrapClass, "-").concat(_this.getNodeState() || 'normal'), !disabled && (selected || dragNodeHighlight) && "".concat(prefixCls, "-node-selected")),
        onMouseEnter: _this.onMouseEnter,
        onMouseLeave: _this.onMouseLeave,
        onContextMenu: _this.onContextMenu,
        onClick: _this.onSelectorClick,
        onDoubleClick: _this.onSelectorDoubleClick
      }, $icon, $title, _this.renderDropIndicator());
    });
    // =================== Render: Drop Indicator ===================
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "renderDropIndicator", function () {
      var _this$props7 = _this.props,
        disabled = _this$props7.disabled,
        eventKey = _this$props7.eventKey;
      var _this$props$context4 = _this.props.context,
        draggable = _this$props$context4.draggable,
        dropLevelOffset = _this$props$context4.dropLevelOffset,
        dropPosition = _this$props$context4.dropPosition,
        prefixCls = _this$props$context4.prefixCls,
        indent = _this$props$context4.indent,
        dropIndicatorRender = _this$props$context4.dropIndicatorRender,
        dragOverNodeKey = _this$props$context4.dragOverNodeKey,
        direction = _this$props$context4.direction;
      var rootDraggable = !!draggable;
      // allowDrop is calculated in Tree.tsx, there is no need for calc it here
      var showIndicator = !disabled && rootDraggable && dragOverNodeKey === eventKey;

      // This is a hot fix which is already fixed in
      // https://github.com/react-component/tree/pull/743/files
      // But some case need break point so we hack on this
      // ref https://github.com/ant-design/ant-design/issues/43493
      var mergedIndent = indent !== null && indent !== void 0 ? indent : _this.cacheIndent;
      _this.cacheIndent = indent;
      return showIndicator ? dropIndicatorRender({
        dropPosition: dropPosition,
        dropLevelOffset: dropLevelOffset,
        indent: mergedIndent,
        prefixCls: prefixCls,
        direction: direction
      }) : null;
    });
    return _this;
  }
  (0,createClass/* default */.A)(InternalTreeNode, [{
    key: "componentDidMount",
    value:
    // Isomorphic needn't load data in server side
    function componentDidMount() {
      this.syncLoadData(this.props);
    }
  }, {
    key: "componentDidUpdate",
    value: function componentDidUpdate() {
      this.syncLoadData(this.props);
    }
  }, {
    key: "isSelectable",
    value: function isSelectable() {
      var selectable = this.props.selectable;
      var treeSelectable = this.props.context.selectable;

      // Ignore when selectable is undefined or null
      if (typeof selectable === 'boolean') {
        return selectable;
      }
      return treeSelectable;
    }
  }, {
    key: "render",
    value:
    // =========================== Render ===========================
    function render() {
      var _classNames;
      var _this$props8 = this.props,
        eventKey = _this$props8.eventKey,
        className = _this$props8.className,
        style = _this$props8.style,
        dragOver = _this$props8.dragOver,
        dragOverGapTop = _this$props8.dragOverGapTop,
        dragOverGapBottom = _this$props8.dragOverGapBottom,
        isLeaf = _this$props8.isLeaf,
        isStart = _this$props8.isStart,
        isEnd = _this$props8.isEnd,
        expanded = _this$props8.expanded,
        selected = _this$props8.selected,
        checked = _this$props8.checked,
        halfChecked = _this$props8.halfChecked,
        loading = _this$props8.loading,
        domRef = _this$props8.domRef,
        active = _this$props8.active,
        data = _this$props8.data,
        onMouseMove = _this$props8.onMouseMove,
        selectable = _this$props8.selectable,
        otherProps = (0,objectWithoutProperties/* default */.A)(_this$props8, TreeNode_excluded);
      var _this$props$context5 = this.props.context,
        prefixCls = _this$props$context5.prefixCls,
        filterTreeNode = _this$props$context5.filterTreeNode,
        keyEntities = _this$props$context5.keyEntities,
        dropContainerKey = _this$props$context5.dropContainerKey,
        dropTargetKey = _this$props$context5.dropTargetKey,
        draggingNodeKey = _this$props$context5.draggingNodeKey;
      var disabled = this.isDisabled();
      var dataOrAriaAttributeProps = (0,pickAttrs/* default */.A)(otherProps, {
        aria: true,
        data: true
      });
      var _ref2 = getEntity(keyEntities, eventKey) || {},
        level = _ref2.level;
      var isEndNode = isEnd[isEnd.length - 1];
      var mergedDraggable = this.isDraggable();
      var draggableWithoutDisabled = !disabled && mergedDraggable;
      var dragging = draggingNodeKey === eventKey;
      var ariaSelected = selectable !== undefined ? {
        'aria-selected': !!selectable
      } : undefined;
      return /*#__PURE__*/react.createElement("div", (0,esm_extends/* default */.A)({
        ref: domRef,
        className: classnames_default()(className, "".concat(prefixCls, "-treenode"), (_classNames = {}, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)(_classNames, "".concat(prefixCls, "-treenode-disabled"), disabled), "".concat(prefixCls, "-treenode-switcher-").concat(expanded ? 'open' : 'close'), !isLeaf), "".concat(prefixCls, "-treenode-checkbox-checked"), checked), "".concat(prefixCls, "-treenode-checkbox-indeterminate"), halfChecked), "".concat(prefixCls, "-treenode-selected"), selected), "".concat(prefixCls, "-treenode-loading"), loading), "".concat(prefixCls, "-treenode-active"), active), "".concat(prefixCls, "-treenode-leaf-last"), isEndNode), "".concat(prefixCls, "-treenode-draggable"), mergedDraggable), "dragging", dragging), (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)(_classNames, 'drop-target', dropTargetKey === eventKey), 'drop-container', dropContainerKey === eventKey), 'drag-over', !disabled && dragOver), 'drag-over-gap-top', !disabled && dragOverGapTop), 'drag-over-gap-bottom', !disabled && dragOverGapBottom), 'filter-node', filterTreeNode && filterTreeNode(convertNodePropsToEventData(this.props))))),
        style: style
        // Draggable config
        ,
        draggable: draggableWithoutDisabled,
        "aria-grabbed": dragging,
        onDragStart: draggableWithoutDisabled ? this.onDragStart : undefined
        // Drop config
        ,
        onDragEnter: mergedDraggable ? this.onDragEnter : undefined,
        onDragOver: mergedDraggable ? this.onDragOver : undefined,
        onDragLeave: mergedDraggable ? this.onDragLeave : undefined,
        onDrop: mergedDraggable ? this.onDrop : undefined,
        onDragEnd: mergedDraggable ? this.onDragEnd : undefined,
        onMouseMove: onMouseMove
      }, ariaSelected, dataOrAriaAttributeProps), /*#__PURE__*/react.createElement(es_Indent, {
        prefixCls: prefixCls,
        level: level,
        isStart: isStart,
        isEnd: isEnd
      }), this.renderDragHandler(), this.renderSwitcher(), this.renderCheckbox(), this.renderSelector());
    }
  }]);
  return InternalTreeNode;
}(react.Component);
var ContextTreeNode = function ContextTreeNode(props) {
  return /*#__PURE__*/react.createElement(TreeContext.Consumer, null, function (context) {
    return /*#__PURE__*/react.createElement(InternalTreeNode, (0,esm_extends/* default */.A)({}, props, {
      context: context
    }));
  });
};
ContextTreeNode.displayName = 'TreeNode';
ContextTreeNode.isTreeNode = 1;
/* harmony default export */ var es_TreeNode = (ContextTreeNode);
;// ./node_modules/rc-tree/es/util.js




var util_excluded = (/* unused pure expression or super */ null && (["children"]));
/* eslint-disable no-lonely-if */
/**
 * Legacy code. Should avoid to use if you are new to import these code.
 */






function arrDel(list, value) {
  if (!list) return [];
  var clone = list.slice();
  var index = clone.indexOf(value);
  if (index >= 0) {
    clone.splice(index, 1);
  }
  return clone;
}
function arrAdd(list, value) {
  var clone = (list || []).slice();
  if (clone.indexOf(value) === -1) {
    clone.push(value);
  }
  return clone;
}
function posToArr(pos) {
  return pos.split('-');
}
function getDragChildrenKeys(dragNodeKey, keyEntities) {
  // not contains self
  // self for left or right drag
  var dragChildrenKeys = [];
  var entity = getEntity(keyEntities, dragNodeKey);
  function dig() {
    var list = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
    list.forEach(function (_ref) {
      var key = _ref.key,
        children = _ref.children;
      dragChildrenKeys.push(key);
      dig(children);
    });
  }
  dig(entity.children);
  return dragChildrenKeys;
}
function isLastChild(treeNodeEntity) {
  if (treeNodeEntity.parent) {
    var posArr = posToArr(treeNodeEntity.pos);
    return Number(posArr[posArr.length - 1]) === treeNodeEntity.parent.children.length - 1;
  }
  return false;
}
function isFirstChild(treeNodeEntity) {
  var posArr = posToArr(treeNodeEntity.pos);
  return Number(posArr[posArr.length - 1]) === 0;
}

// Only used when drag, not affect SSR.
function calcDropPosition(event, dragNode, targetNode, indent, startMousePosition, allowDrop, flattenedNodes, keyEntities, expandKeys, direction) {
  var _abstractDropNodeEnti;
  var clientX = event.clientX,
    clientY = event.clientY;
  var _getBoundingClientRec = event.target.getBoundingClientRect(),
    top = _getBoundingClientRec.top,
    height = _getBoundingClientRec.height;
  // optional chain for testing
  var horizontalMouseOffset = (direction === 'rtl' ? -1 : 1) * (((startMousePosition === null || startMousePosition === void 0 ? void 0 : startMousePosition.x) || 0) - clientX);
  var rawDropLevelOffset = (horizontalMouseOffset - 12) / indent;

  // Filter the expanded keys to exclude the node that not has children currently (like async nodes).
  var filteredExpandKeys = expandKeys.filter(function (key) {
    var _keyEntities$key;
    return (_keyEntities$key = keyEntities[key]) === null || _keyEntities$key === void 0 || (_keyEntities$key = _keyEntities$key.children) === null || _keyEntities$key === void 0 ? void 0 : _keyEntities$key.length;
  });

  // find abstract drop node by horizontal offset
  var abstractDropNodeEntity = getEntity(keyEntities, targetNode.props.eventKey);
  if (clientY < top + height / 2) {
    // first half, set abstract drop node to previous node
    var nodeIndex = flattenedNodes.findIndex(function (flattenedNode) {
      return flattenedNode.key === abstractDropNodeEntity.key;
    });
    var prevNodeIndex = nodeIndex <= 0 ? 0 : nodeIndex - 1;
    var prevNodeKey = flattenedNodes[prevNodeIndex].key;
    abstractDropNodeEntity = getEntity(keyEntities, prevNodeKey);
  }
  var initialAbstractDropNodeKey = abstractDropNodeEntity.key;
  var abstractDragOverEntity = abstractDropNodeEntity;
  var dragOverNodeKey = abstractDropNodeEntity.key;
  var dropPosition = 0;
  var dropLevelOffset = 0;

  // Only allow cross level drop when dragging on a non-expanded node
  if (!filteredExpandKeys.includes(initialAbstractDropNodeKey)) {
    for (var i = 0; i < rawDropLevelOffset; i += 1) {
      if (isLastChild(abstractDropNodeEntity)) {
        abstractDropNodeEntity = abstractDropNodeEntity.parent;
        dropLevelOffset += 1;
      } else {
        break;
      }
    }
  }
  var abstractDragDataNode = dragNode.props.data;
  var abstractDropDataNode = abstractDropNodeEntity.node;
  var dropAllowed = true;
  if (isFirstChild(abstractDropNodeEntity) && abstractDropNodeEntity.level === 0 && clientY < top + height / 2 && allowDrop({
    dragNode: abstractDragDataNode,
    dropNode: abstractDropDataNode,
    dropPosition: -1
  }) && abstractDropNodeEntity.key === targetNode.props.eventKey) {
    // first half of first node in first level
    dropPosition = -1;
  } else if ((abstractDragOverEntity.children || []).length && filteredExpandKeys.includes(dragOverNodeKey)) {
    // drop on expanded node
    // only allow drop inside
    if (allowDrop({
      dragNode: abstractDragDataNode,
      dropNode: abstractDropDataNode,
      dropPosition: 0
    })) {
      dropPosition = 0;
    } else {
      dropAllowed = false;
    }
  } else if (dropLevelOffset === 0) {
    if (rawDropLevelOffset > -1.5) {
      // | Node     | <- abstractDropNode
      // | -^-===== | <- mousePosition
      // 1. try drop after
      // 2. do not allow drop
      if (allowDrop({
        dragNode: abstractDragDataNode,
        dropNode: abstractDropDataNode,
        dropPosition: 1
      })) {
        dropPosition = 1;
      } else {
        dropAllowed = false;
      }
    } else {
      // | Node     | <- abstractDropNode
      // | ---==^== | <- mousePosition
      // whether it has children or doesn't has children
      // always
      // 1. try drop inside
      // 2. try drop after
      // 3. do not allow drop
      if (allowDrop({
        dragNode: abstractDragDataNode,
        dropNode: abstractDropDataNode,
        dropPosition: 0
      })) {
        dropPosition = 0;
      } else if (allowDrop({
        dragNode: abstractDragDataNode,
        dropNode: abstractDropDataNode,
        dropPosition: 1
      })) {
        dropPosition = 1;
      } else {
        dropAllowed = false;
      }
    }
  } else {
    // | Node1 | <- abstractDropNode
    //      |  Node2  |
    // --^--|----=====| <- mousePosition
    // 1. try insert after Node1
    // 2. do not allow drop
    if (allowDrop({
      dragNode: abstractDragDataNode,
      dropNode: abstractDropDataNode,
      dropPosition: 1
    })) {
      dropPosition = 1;
    } else {
      dropAllowed = false;
    }
  }
  return {
    dropPosition: dropPosition,
    dropLevelOffset: dropLevelOffset,
    dropTargetKey: abstractDropNodeEntity.key,
    dropTargetPos: abstractDropNodeEntity.pos,
    dragOverNodeKey: dragOverNodeKey,
    dropContainerKey: dropPosition === 0 ? null : ((_abstractDropNodeEnti = abstractDropNodeEntity.parent) === null || _abstractDropNodeEnti === void 0 ? void 0 : _abstractDropNodeEnti.key) || null,
    dropAllowed: dropAllowed
  };
}

/**
 * Return selectedKeys according with multiple prop
 * @param selectedKeys
 * @param props
 * @returns [string]
 */
function calcSelectedKeys(selectedKeys, props) {
  if (!selectedKeys) return undefined;
  var multiple = props.multiple;
  if (multiple) {
    return selectedKeys.slice();
  }
  if (selectedKeys.length) {
    return [selectedKeys[0]];
  }
  return selectedKeys;
}
var internalProcessProps = function internalProcessProps(props) {
  return props;
};
function convertDataToTree(treeData, processor) {
  if (!treeData) return [];
  var _ref2 = processor || {},
    _ref2$processProps = _ref2.processProps,
    processProps = _ref2$processProps === void 0 ? internalProcessProps : _ref2$processProps;
  var list = Array.isArray(treeData) ? treeData : [treeData];
  return list.map(function (_ref3) {
    var children = _ref3.children,
      props = _objectWithoutProperties(_ref3, util_excluded);
    var childrenNodes = convertDataToTree(children, processor);
    return /*#__PURE__*/React.createElement(TreeNode, _extends({
      key: props.key
    }, processProps(props)), childrenNodes);
  });
}

/**
 * Parse `checkedKeys` to { checkedKeys, halfCheckedKeys } style
 */
function parseCheckedKeys(keys) {
  if (!keys) {
    return null;
  }

  // Convert keys to object format
  var keyProps;
  if (Array.isArray(keys)) {
    // [Legacy] Follow the api doc
    keyProps = {
      checkedKeys: keys,
      halfCheckedKeys: undefined
    };
  } else if ((0,esm_typeof/* default */.A)(keys) === 'object') {
    keyProps = {
      checkedKeys: keys.checked || undefined,
      halfCheckedKeys: keys.halfChecked || undefined
    };
  } else {
    (0,es_warning/* default */.Ay)(false, '`checkedKeys` is not an array or an object');
    return null;
  }
  return keyProps;
}

/**
 * If user use `autoExpandParent` we should get the list of parent node
 * @param keyList
 * @param keyEntities
 */
function conductExpandParent(keyList, keyEntities) {
  var expandedKeys = new Set();
  function conductUp(key) {
    if (expandedKeys.has(key)) return;
    var entity = getEntity(keyEntities, key);
    if (!entity) return;
    expandedKeys.add(key);
    var parent = entity.parent,
      node = entity.node;
    if (node.disabled) return;
    if (parent) {
      conductUp(parent.key);
    }
  }
  (keyList || []).forEach(function (key) {
    conductUp(key);
  });
  return (0,toConsumableArray/* default */.A)(expandedKeys);
}
;// ./node_modules/rc-tree/es/utils/conductUtil.js


function removeFromCheckedKeys(halfCheckedKeys, checkedKeys) {
  var filteredKeys = new Set();
  halfCheckedKeys.forEach(function (key) {
    if (!checkedKeys.has(key)) {
      filteredKeys.add(key);
    }
  });
  return filteredKeys;
}
function isCheckDisabled(node) {
  var _ref = node || {},
    disabled = _ref.disabled,
    disableCheckbox = _ref.disableCheckbox,
    checkable = _ref.checkable;
  return !!(disabled || disableCheckbox) || checkable === false;
}

// Fill miss keys
function fillConductCheck(keys, levelEntities, maxLevel, syntheticGetCheckDisabled) {
  var checkedKeys = new Set(keys);
  var halfCheckedKeys = new Set();

  // Add checked keys top to bottom
  for (var level = 0; level <= maxLevel; level += 1) {
    var entities = levelEntities.get(level) || new Set();
    entities.forEach(function (entity) {
      var key = entity.key,
        node = entity.node,
        _entity$children = entity.children,
        children = _entity$children === void 0 ? [] : _entity$children;
      if (checkedKeys.has(key) && !syntheticGetCheckDisabled(node)) {
        children.filter(function (childEntity) {
          return !syntheticGetCheckDisabled(childEntity.node);
        }).forEach(function (childEntity) {
          checkedKeys.add(childEntity.key);
        });
      }
    });
  }

  // Add checked keys from bottom to top
  var visitedKeys = new Set();
  for (var _level = maxLevel; _level >= 0; _level -= 1) {
    var _entities = levelEntities.get(_level) || new Set();
    _entities.forEach(function (entity) {
      var parent = entity.parent,
        node = entity.node;

      // Skip if no need to check
      if (syntheticGetCheckDisabled(node) || !entity.parent || visitedKeys.has(entity.parent.key)) {
        return;
      }

      // Skip if parent is disabled
      if (syntheticGetCheckDisabled(entity.parent.node)) {
        visitedKeys.add(parent.key);
        return;
      }
      var allChecked = true;
      var partialChecked = false;
      (parent.children || []).filter(function (childEntity) {
        return !syntheticGetCheckDisabled(childEntity.node);
      }).forEach(function (_ref2) {
        var key = _ref2.key;
        var checked = checkedKeys.has(key);
        if (allChecked && !checked) {
          allChecked = false;
        }
        if (!partialChecked && (checked || halfCheckedKeys.has(key))) {
          partialChecked = true;
        }
      });
      if (allChecked) {
        checkedKeys.add(parent.key);
      }
      if (partialChecked) {
        halfCheckedKeys.add(parent.key);
      }
      visitedKeys.add(parent.key);
    });
  }
  return {
    checkedKeys: Array.from(checkedKeys),
    halfCheckedKeys: Array.from(removeFromCheckedKeys(halfCheckedKeys, checkedKeys))
  };
}

// Remove useless key
function cleanConductCheck(keys, halfKeys, levelEntities, maxLevel, syntheticGetCheckDisabled) {
  var checkedKeys = new Set(keys);
  var halfCheckedKeys = new Set(halfKeys);

  // Remove checked keys from top to bottom
  for (var level = 0; level <= maxLevel; level += 1) {
    var entities = levelEntities.get(level) || new Set();
    entities.forEach(function (entity) {
      var key = entity.key,
        node = entity.node,
        _entity$children2 = entity.children,
        children = _entity$children2 === void 0 ? [] : _entity$children2;
      if (!checkedKeys.has(key) && !halfCheckedKeys.has(key) && !syntheticGetCheckDisabled(node)) {
        children.filter(function (childEntity) {
          return !syntheticGetCheckDisabled(childEntity.node);
        }).forEach(function (childEntity) {
          checkedKeys.delete(childEntity.key);
        });
      }
    });
  }

  // Remove checked keys form bottom to top
  halfCheckedKeys = new Set();
  var visitedKeys = new Set();
  for (var _level2 = maxLevel; _level2 >= 0; _level2 -= 1) {
    var _entities2 = levelEntities.get(_level2) || new Set();
    _entities2.forEach(function (entity) {
      var parent = entity.parent,
        node = entity.node;

      // Skip if no need to check
      if (syntheticGetCheckDisabled(node) || !entity.parent || visitedKeys.has(entity.parent.key)) {
        return;
      }

      // Skip if parent is disabled
      if (syntheticGetCheckDisabled(entity.parent.node)) {
        visitedKeys.add(parent.key);
        return;
      }
      var allChecked = true;
      var partialChecked = false;
      (parent.children || []).filter(function (childEntity) {
        return !syntheticGetCheckDisabled(childEntity.node);
      }).forEach(function (_ref3) {
        var key = _ref3.key;
        var checked = checkedKeys.has(key);
        if (allChecked && !checked) {
          allChecked = false;
        }
        if (!partialChecked && (checked || halfCheckedKeys.has(key))) {
          partialChecked = true;
        }
      });
      if (!allChecked) {
        checkedKeys.delete(parent.key);
      }
      if (partialChecked) {
        halfCheckedKeys.add(parent.key);
      }
      visitedKeys.add(parent.key);
    });
  }
  return {
    checkedKeys: Array.from(checkedKeys),
    halfCheckedKeys: Array.from(removeFromCheckedKeys(halfCheckedKeys, checkedKeys))
  };
}

/**
 * Conduct with keys.
 * @param keyList current key list
 * @param keyEntities key - dataEntity map
 * @param mode `fill` to fill missing key, `clean` to remove useless key
 */
function conductCheck(keyList, checked, keyEntities, getCheckDisabled) {
  var warningMissKeys = [];
  var syntheticGetCheckDisabled;
  if (getCheckDisabled) {
    syntheticGetCheckDisabled = getCheckDisabled;
  } else {
    syntheticGetCheckDisabled = isCheckDisabled;
  }

  // We only handle exist keys
  var keys = new Set(keyList.filter(function (key) {
    var hasEntity = !!getEntity(keyEntities, key);
    if (!hasEntity) {
      warningMissKeys.push(key);
    }
    return hasEntity;
  }));
  var levelEntities = new Map();
  var maxLevel = 0;

  // Convert entities by level for calculation
  Object.keys(keyEntities).forEach(function (key) {
    var entity = keyEntities[key];
    var level = entity.level;
    var levelSet = levelEntities.get(level);
    if (!levelSet) {
      levelSet = new Set();
      levelEntities.set(level, levelSet);
    }
    levelSet.add(entity);
    maxLevel = Math.max(maxLevel, level);
  });
  (0,es_warning/* default */.Ay)(!warningMissKeys.length, "Tree missing follow keys: ".concat(warningMissKeys.slice(0, 100).map(function (key) {
    return "'".concat(key, "'");
  }).join(', ')));
  var result;
  if (checked === true) {
    result = fillConductCheck(keys, levelEntities, maxLevel, syntheticGetCheckDisabled);
  } else {
    result = cleanConductCheck(keys, checked.halfCheckedKeys, levelEntities, maxLevel, syntheticGetCheckDisabled);
  }
  return result;
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useMergedState.js
var useMergedState = __webpack_require__(12533);
;// ./node_modules/antd/es/_util/hooks/useMultipleSelect.js

/**
 * @title multipleSelect hooks
 * @description multipleSelect by hold down shift key
 */
function useMultipleSelect(getKey) {
  const [prevSelectedIndex, setPrevSelectedIndex] = (0,react.useState)(null);
  const multipleSelect = (0,react.useCallback)((currentSelectedIndex, data, selectedKeys) => {
    const configPrevSelectedIndex = prevSelectedIndex !== null && prevSelectedIndex !== void 0 ? prevSelectedIndex : currentSelectedIndex;
    // add/delete the selected range
    const startIndex = Math.min(configPrevSelectedIndex || 0, currentSelectedIndex);
    const endIndex = Math.max(configPrevSelectedIndex || 0, currentSelectedIndex);
    const rangeKeys = data.slice(startIndex, endIndex + 1).map(item => getKey(item));
    const shouldSelected = rangeKeys.some(rangeKey => !selectedKeys.has(rangeKey));
    const changedKeys = [];
    rangeKeys.forEach(item => {
      if (shouldSelected) {
        if (!selectedKeys.has(item)) {
          changedKeys.push(item);
        }
        selectedKeys.add(item);
      } else {
        selectedKeys.delete(item);
        changedKeys.push(item);
      }
    });
    setPrevSelectedIndex(shouldSelected ? endIndex : null);
    return changedKeys;
  }, [prevSelectedIndex]);
  const updatePrevSelectedIndex = val => {
    setPrevSelectedIndex(val);
  };
  return [multipleSelect, updatePrevSelectedIndex];
}
// EXTERNAL MODULE: ./node_modules/antd/es/_util/warning.js
var _util_warning = __webpack_require__(18877);
;// ./node_modules/rc-checkbox/es/index.js





var es_excluded = ["prefixCls", "className", "style", "checked", "disabled", "defaultChecked", "type", "title", "onChange"];




var Checkbox = /*#__PURE__*/(0,react.forwardRef)(function (props, ref) {
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
    inputProps = (0,objectWithoutProperties/* default */.A)(props, es_excluded);
  var inputRef = (0,react.useRef)(null);
  var holderRef = (0,react.useRef)(null);
  var _useMergedState = (0,useMergedState/* default */.A)(defaultChecked, {
      value: checked
    }),
    _useMergedState2 = (0,slicedToArray/* default */.A)(_useMergedState, 2),
    rawValue = _useMergedState2[0],
    setRawValue = _useMergedState2[1];
  (0,react.useImperativeHandle)(ref, function () {
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
  var classString = classnames_default()(prefixCls, className, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-checked"), rawValue), "".concat(prefixCls, "-disabled"), disabled));
  var handleChange = function handleChange(e) {
    if (disabled) {
      return;
    }
    if (!('checked' in props)) {
      setRawValue(e.target.checked);
    }
    onChange === null || onChange === void 0 || onChange({
      target: (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, props), {}, {
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
  return /*#__PURE__*/react.createElement("span", {
    className: classString,
    title: title,
    style: style,
    ref: holderRef
  }, /*#__PURE__*/react.createElement("input", (0,esm_extends/* default */.A)({}, inputProps, {
    className: "".concat(prefixCls, "-input"),
    ref: inputRef,
    onChange: handleChange,
    disabled: disabled,
    checked: !!rawValue,
    type: type
  })), /*#__PURE__*/react.createElement("span", {
    className: "".concat(prefixCls, "-inner")
  }));
});
/* harmony default export */ var rc_checkbox_es = (Checkbox);
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
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
;// ./node_modules/antd/es/checkbox/style/index.js



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
    [`${checkboxCls}-group`]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      display: 'inline-flex',
      flexWrap: 'wrap',
      columnGap: token.marginXS,
      // Group > Grid
      [`> ${token.antCls}-row`]: {
        flex: 1
      }
    }),
    // Wrapper
    [wrapperCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
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
    [checkboxCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
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
        [`&:focus-visible + ${checkboxCls}-inner`]: Object.assign({}, (0,style/* genFocusOutline */.jk)(token))
      },
      // Wrapper > Checkbox > inner
      [`${checkboxCls}-inner`]: {
        boxSizing: 'border-box',
        display: 'block',
        width: token.checkboxSize,
        height: token.checkboxSize,
        direction: 'ltr',
        backgroundColor: token.colorBgContainer,
        border: `${(0,cssinjs_es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`,
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
          border: `${(0,cssinjs_es/* unit */.zA)(token.lineWidthBold)} solid ${token.colorWhite}`,
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
  const checkboxToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    checkboxCls: `.${prefixCls}`,
    checkboxSize: token.controlInteractiveSize
  });
  return [genCheckboxStyle(checkboxToken)];
}
/* harmony default export */ var checkbox_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Checkbox', (token, _ref) => {
  let {
    prefixCls
  } = _ref;
  return [getStyle(prefixCls, token)];
}));
;// ./node_modules/antd/es/checkbox/useBubbleLock.js


/**
 * When click on the label,
 * the event will be stopped to prevent the label from being clicked twice.
 * label click -> input click -> label click again
 */
function useBubbleLock(onOriginInputClick) {
  const labelClickLockRef = react.useRef(null);
  const clearLock = () => {
    raf/* default */.A.cancel(labelClickLockRef.current);
    labelClickLockRef.current = null;
  };
  const onLabelClick = () => {
    clearLock();
    labelClickLockRef.current = (0,raf/* default */.A)(() => {
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
  const [wrapCSSVar, hashId, cssVarCls] = checkbox_style(prefixCls, rootCls);
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
  const [onLabelClick, onInputClick] = useBubbleLock(checkboxProps.onClick);
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
  }, /*#__PURE__*/react.createElement(rc_checkbox_es, Object.assign({}, checkboxProps, {
    onClick: onInputClick,
    prefixCls: prefixCls,
    className: checkboxClass,
    disabled: mergedDisabled,
    ref: mergedRef
  })), children !== undefined && /*#__PURE__*/react.createElement("span", null, children))));
};
const Checkbox_Checkbox = /*#__PURE__*/react.forwardRef(InternalCheckbox);
if (false) {}
/* harmony default export */ var checkbox_Checkbox = (Checkbox_Checkbox);
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
  const [wrapCSSVar, hashId, cssVarCls] = checkbox_style(prefixCls, rootCls);
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
// EXTERNAL MODULE: ./node_modules/antd/es/dropdown/index.js + 5 modules
var dropdown = __webpack_require__(30761);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
;// ./node_modules/antd/es/radio/context.js

const RadioGroupContext = /*#__PURE__*/react.createContext(null);
const RadioGroupContextProvider = RadioGroupContext.Provider;
/* harmony default export */ var radio_context = (RadioGroupContext);
const RadioOptionTypeContext = /*#__PURE__*/react.createContext(null);
const RadioOptionTypeContextProvider = RadioOptionTypeContext.Provider;
;// ./node_modules/antd/es/radio/style/index.js



// ============================== Styles ==============================
// styles from RadioGroup only
const getGroupRadioStyle = token => {
  const {
    componentCls,
    antCls
  } = token;
  const groupPrefixCls = `${componentCls}-group`;
  return {
    [groupPrefixCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      display: 'inline-block',
      fontSize: 0,
      // RTL
      [`&${groupPrefixCls}-rtl`]: {
        direction: 'rtl'
      },
      [`&${groupPrefixCls}-block`]: {
        display: 'flex'
      },
      [`${antCls}-badge ${antCls}-badge-count`]: {
        zIndex: 1
      },
      [`> ${antCls}-badge:not(:first-child) > ${antCls}-button-wrapper`]: {
        borderInlineStart: 'none'
      }
    })
  };
};
// Styles from radio-wrapper
const getRadioBasicStyle = token => {
  const {
    componentCls,
    wrapperMarginInlineEnd,
    colorPrimary,
    radioSize,
    motionDurationSlow,
    motionDurationMid,
    motionEaseInOutCirc,
    colorBgContainer,
    colorBorder,
    lineWidth,
    colorBgContainerDisabled,
    colorTextDisabled,
    paddingXS,
    dotColorDisabled,
    lineType,
    radioColor,
    radioBgColor,
    calc
  } = token;
  const radioInnerPrefixCls = `${componentCls}-inner`;
  const dotPadding = 4;
  const radioDotDisabledSize = calc(radioSize).sub(calc(dotPadding).mul(2));
  const radioSizeCalc = calc(1).mul(radioSize).equal({
    unit: true
  });
  return {
    [`${componentCls}-wrapper`]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      display: 'inline-flex',
      alignItems: 'baseline',
      marginInlineStart: 0,
      marginInlineEnd: wrapperMarginInlineEnd,
      cursor: 'pointer',
      // RTL
      [`&${componentCls}-wrapper-rtl`]: {
        direction: 'rtl'
      },
      '&-disabled': {
        cursor: 'not-allowed',
        color: token.colorTextDisabled
      },
      '&::after': {
        display: 'inline-block',
        width: 0,
        overflow: 'hidden',
        content: '"\\a0"'
      },
      '&-block': {
        flex: 1,
        justifyContent: 'center'
      },
      // hashId 在 wrapper 上，只能铺平
      [`${componentCls}-checked::after`]: {
        position: 'absolute',
        insetBlockStart: 0,
        insetInlineStart: 0,
        width: '100%',
        height: '100%',
        border: `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${colorPrimary}`,
        borderRadius: '50%',
        visibility: 'hidden',
        opacity: 0,
        content: '""'
      },
      [componentCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
        position: 'relative',
        display: 'inline-block',
        outline: 'none',
        cursor: 'pointer',
        alignSelf: 'center',
        borderRadius: '50%'
      }),
      [`${componentCls}-wrapper:hover &,
        &:hover ${radioInnerPrefixCls}`]: {
        borderColor: colorPrimary
      },
      [`${componentCls}-input:focus-visible + ${radioInnerPrefixCls}`]: Object.assign({}, (0,style/* genFocusOutline */.jk)(token)),
      [`${componentCls}:hover::after, ${componentCls}-wrapper:hover &::after`]: {
        visibility: 'visible'
      },
      [`${componentCls}-inner`]: {
        '&::after': {
          boxSizing: 'border-box',
          position: 'absolute',
          insetBlockStart: '50%',
          insetInlineStart: '50%',
          display: 'block',
          width: radioSizeCalc,
          height: radioSizeCalc,
          marginBlockStart: calc(1).mul(radioSize).div(-2).equal({
            unit: true
          }),
          marginInlineStart: calc(1).mul(radioSize).div(-2).equal({
            unit: true
          }),
          backgroundColor: radioColor,
          borderBlockStart: 0,
          borderInlineStart: 0,
          borderRadius: radioSizeCalc,
          transform: 'scale(0)',
          opacity: 0,
          transition: `all ${motionDurationSlow} ${motionEaseInOutCirc}`,
          content: '""'
        },
        boxSizing: 'border-box',
        position: 'relative',
        insetBlockStart: 0,
        insetInlineStart: 0,
        display: 'block',
        width: radioSizeCalc,
        height: radioSizeCalc,
        backgroundColor: colorBgContainer,
        borderColor: colorBorder,
        borderStyle: 'solid',
        borderWidth: lineWidth,
        borderRadius: '50%',
        transition: `all ${motionDurationMid}`
      },
      [`${componentCls}-input`]: {
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        cursor: 'pointer',
        opacity: 0
      },
      // 选中状态
      [`${componentCls}-checked`]: {
        [radioInnerPrefixCls]: {
          borderColor: colorPrimary,
          backgroundColor: radioBgColor,
          '&::after': {
            transform: `scale(${token.calc(token.dotSize).div(radioSize).equal()})`,
            opacity: 1,
            transition: `all ${motionDurationSlow} ${motionEaseInOutCirc}`
          }
        }
      },
      [`${componentCls}-disabled`]: {
        cursor: 'not-allowed',
        [radioInnerPrefixCls]: {
          backgroundColor: colorBgContainerDisabled,
          borderColor: colorBorder,
          cursor: 'not-allowed',
          '&::after': {
            backgroundColor: dotColorDisabled
          }
        },
        [`${componentCls}-input`]: {
          cursor: 'not-allowed'
        },
        [`${componentCls}-disabled + span`]: {
          color: colorTextDisabled,
          cursor: 'not-allowed'
        },
        [`&${componentCls}-checked`]: {
          [radioInnerPrefixCls]: {
            '&::after': {
              transform: `scale(${calc(radioDotDisabledSize).div(radioSize).equal()})`
            }
          }
        }
      },
      [`span${componentCls} + *`]: {
        paddingInlineStart: paddingXS,
        paddingInlineEnd: paddingXS
      }
    })
  };
};
// Styles from radio-button
const getRadioButtonStyle = token => {
  const {
    buttonColor,
    controlHeight,
    componentCls,
    lineWidth,
    lineType,
    colorBorder,
    motionDurationSlow,
    motionDurationMid,
    buttonPaddingInline,
    fontSize,
    buttonBg,
    fontSizeLG,
    controlHeightLG,
    controlHeightSM,
    paddingXS,
    borderRadius,
    borderRadiusSM,
    borderRadiusLG,
    buttonCheckedBg,
    buttonSolidCheckedColor,
    colorTextDisabled,
    colorBgContainerDisabled,
    buttonCheckedBgDisabled,
    buttonCheckedColorDisabled,
    colorPrimary,
    colorPrimaryHover,
    colorPrimaryActive,
    buttonSolidCheckedBg,
    buttonSolidCheckedHoverBg,
    buttonSolidCheckedActiveBg,
    calc
  } = token;
  return {
    [`${componentCls}-button-wrapper`]: {
      position: 'relative',
      display: 'inline-block',
      height: controlHeight,
      margin: 0,
      paddingInline: buttonPaddingInline,
      paddingBlock: 0,
      color: buttonColor,
      fontSize,
      lineHeight: (0,cssinjs_es/* unit */.zA)(calc(controlHeight).sub(calc(lineWidth).mul(2)).equal()),
      background: buttonBg,
      border: `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${colorBorder}`,
      // strange align fix for chrome but works
      // https://gw.alipayobjects.com/zos/rmsportal/VFTfKXJuogBAXcvfAUWJ.gif
      borderBlockStartWidth: calc(lineWidth).add(0.02).equal(),
      borderInlineStartWidth: 0,
      borderInlineEndWidth: lineWidth,
      cursor: 'pointer',
      transition: [`color ${motionDurationMid}`, `background ${motionDurationMid}`, `box-shadow ${motionDurationMid}`].join(','),
      a: {
        color: buttonColor
      },
      [`> ${componentCls}-button`]: {
        position: 'absolute',
        insetBlockStart: 0,
        insetInlineStart: 0,
        zIndex: -1,
        width: '100%',
        height: '100%'
      },
      '&:not(:first-child)': {
        '&::before': {
          position: 'absolute',
          insetBlockStart: calc(lineWidth).mul(-1).equal(),
          insetInlineStart: calc(lineWidth).mul(-1).equal(),
          display: 'block',
          boxSizing: 'content-box',
          width: 1,
          height: '100%',
          paddingBlock: lineWidth,
          paddingInline: 0,
          backgroundColor: colorBorder,
          transition: `background-color ${motionDurationSlow}`,
          content: '""'
        }
      },
      '&:first-child': {
        borderInlineStart: `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${colorBorder}`,
        borderStartStartRadius: borderRadius,
        borderEndStartRadius: borderRadius
      },
      '&:last-child': {
        borderStartEndRadius: borderRadius,
        borderEndEndRadius: borderRadius
      },
      '&:first-child:last-child': {
        borderRadius
      },
      [`${componentCls}-group-large &`]: {
        height: controlHeightLG,
        fontSize: fontSizeLG,
        lineHeight: (0,cssinjs_es/* unit */.zA)(calc(controlHeightLG).sub(calc(lineWidth).mul(2)).equal()),
        '&:first-child': {
          borderStartStartRadius: borderRadiusLG,
          borderEndStartRadius: borderRadiusLG
        },
        '&:last-child': {
          borderStartEndRadius: borderRadiusLG,
          borderEndEndRadius: borderRadiusLG
        }
      },
      [`${componentCls}-group-small &`]: {
        height: controlHeightSM,
        paddingInline: calc(paddingXS).sub(lineWidth).equal(),
        paddingBlock: 0,
        lineHeight: (0,cssinjs_es/* unit */.zA)(calc(controlHeightSM).sub(calc(lineWidth).mul(2)).equal()),
        '&:first-child': {
          borderStartStartRadius: borderRadiusSM,
          borderEndStartRadius: borderRadiusSM
        },
        '&:last-child': {
          borderStartEndRadius: borderRadiusSM,
          borderEndEndRadius: borderRadiusSM
        }
      },
      '&:hover': {
        position: 'relative',
        color: colorPrimary
      },
      '&:has(:focus-visible)': Object.assign({}, (0,style/* genFocusOutline */.jk)(token)),
      [`${componentCls}-inner, input[type='checkbox'], input[type='radio']`]: {
        width: 0,
        height: 0,
        opacity: 0,
        pointerEvents: 'none'
      },
      [`&-checked:not(${componentCls}-button-wrapper-disabled)`]: {
        zIndex: 1,
        color: colorPrimary,
        background: buttonCheckedBg,
        borderColor: colorPrimary,
        '&::before': {
          backgroundColor: colorPrimary
        },
        '&:first-child': {
          borderColor: colorPrimary
        },
        '&:hover': {
          color: colorPrimaryHover,
          borderColor: colorPrimaryHover,
          '&::before': {
            backgroundColor: colorPrimaryHover
          }
        },
        '&:active': {
          color: colorPrimaryActive,
          borderColor: colorPrimaryActive,
          '&::before': {
            backgroundColor: colorPrimaryActive
          }
        }
      },
      [`${componentCls}-group-solid &-checked:not(${componentCls}-button-wrapper-disabled)`]: {
        color: buttonSolidCheckedColor,
        background: buttonSolidCheckedBg,
        borderColor: buttonSolidCheckedBg,
        '&:hover': {
          color: buttonSolidCheckedColor,
          background: buttonSolidCheckedHoverBg,
          borderColor: buttonSolidCheckedHoverBg
        },
        '&:active': {
          color: buttonSolidCheckedColor,
          background: buttonSolidCheckedActiveBg,
          borderColor: buttonSolidCheckedActiveBg
        }
      },
      '&-disabled': {
        color: colorTextDisabled,
        backgroundColor: colorBgContainerDisabled,
        borderColor: colorBorder,
        cursor: 'not-allowed',
        '&:first-child, &:hover': {
          color: colorTextDisabled,
          backgroundColor: colorBgContainerDisabled,
          borderColor: colorBorder
        }
      },
      [`&-disabled${componentCls}-button-wrapper-checked`]: {
        color: buttonCheckedColorDisabled,
        backgroundColor: buttonCheckedBgDisabled,
        borderColor: colorBorder,
        boxShadow: 'none'
      },
      '&-block': {
        flex: 1,
        textAlign: 'center'
      }
    }
  };
};
// ============================== Export ==============================
const prepareComponentToken = token => {
  const {
    wireframe,
    padding,
    marginXS,
    lineWidth,
    fontSizeLG,
    colorText,
    colorBgContainer,
    colorTextDisabled,
    controlItemBgActiveDisabled,
    colorTextLightSolid,
    colorPrimary,
    colorPrimaryHover,
    colorPrimaryActive,
    colorWhite
  } = token;
  const dotPadding = 4; // Fixed value
  const radioSize = fontSizeLG;
  const radioDotSize = wireframe ? radioSize - dotPadding * 2 : radioSize - (dotPadding + lineWidth) * 2;
  return {
    // Radio
    radioSize,
    dotSize: radioDotSize,
    dotColorDisabled: colorTextDisabled,
    // Radio buttons
    buttonSolidCheckedColor: colorTextLightSolid,
    buttonSolidCheckedBg: colorPrimary,
    buttonSolidCheckedHoverBg: colorPrimaryHover,
    buttonSolidCheckedActiveBg: colorPrimaryActive,
    buttonBg: colorBgContainer,
    buttonCheckedBg: colorBgContainer,
    buttonColor: colorText,
    buttonCheckedBgDisabled: controlItemBgActiveDisabled,
    buttonCheckedColorDisabled: colorTextDisabled,
    buttonPaddingInline: padding - lineWidth,
    wrapperMarginInlineEnd: marginXS,
    // internal
    radioColor: wireframe ? colorPrimary : colorWhite,
    radioBgColor: wireframe ? colorBgContainer : colorPrimary
  };
};
/* harmony default export */ var radio_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Radio', token => {
  const {
    controlOutline,
    controlOutlineWidth
  } = token;
  const radioFocusShadow = `0 0 0 ${(0,cssinjs_es/* unit */.zA)(controlOutlineWidth)} ${controlOutline}`;
  const radioButtonFocusShadow = radioFocusShadow;
  const radioToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    radioFocusShadow,
    radioButtonFocusShadow
  });
  return [getGroupRadioStyle(radioToken), getRadioBasicStyle(radioToken), getRadioButtonStyle(radioToken)];
}, prepareComponentToken, {
  unitless: {
    radioSize: true,
    dotSize: true
  }
}));
;// ./node_modules/antd/es/radio/radio.js
"use client";

var radio_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};














const InternalRadio = (props, ref) => {
  var _a, _b;
  const groupContext = react.useContext(radio_context);
  const radioOptionTypeContext = react.useContext(RadioOptionTypeContext);
  const {
    getPrefixCls,
    direction,
    radio
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const innerRef = react.useRef(null);
  const mergedRef = (0,es_ref/* composeRef */.K4)(ref, innerRef);
  const {
    isFormItemInput
  } = react.useContext(context/* FormItemInputContext */.$W);
  if (false) {}
  const onChange = e => {
    var _a, _b;
    (_a = props.onChange) === null || _a === void 0 ? void 0 : _a.call(props, e);
    (_b = groupContext === null || groupContext === void 0 ? void 0 : groupContext.onChange) === null || _b === void 0 ? void 0 : _b.call(groupContext, e);
  };
  const {
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      children,
      style,
      title
    } = props,
    restProps = radio_rest(props, ["prefixCls", "className", "rootClassName", "children", "style", "title"]);
  const radioPrefixCls = getPrefixCls('radio', customizePrefixCls);
  const isButtonType = ((groupContext === null || groupContext === void 0 ? void 0 : groupContext.optionType) || radioOptionTypeContext) === 'button';
  const prefixCls = isButtonType ? `${radioPrefixCls}-button` : radioPrefixCls;
  // Style
  const rootCls = (0,useCSSVarCls/* default */.A)(radioPrefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = radio_style(radioPrefixCls, rootCls);
  const radioProps = Object.assign({}, restProps);
  // ===================== Disabled =====================
  const disabled = react.useContext(DisabledContext/* default */.A);
  if (groupContext) {
    radioProps.name = groupContext.name;
    radioProps.onChange = onChange;
    radioProps.checked = props.value === groupContext.value;
    radioProps.disabled = (_a = radioProps.disabled) !== null && _a !== void 0 ? _a : groupContext.disabled;
  }
  radioProps.disabled = (_b = radioProps.disabled) !== null && _b !== void 0 ? _b : disabled;
  const wrapperClassString = classnames_default()(`${prefixCls}-wrapper`, {
    [`${prefixCls}-wrapper-checked`]: radioProps.checked,
    [`${prefixCls}-wrapper-disabled`]: radioProps.disabled,
    [`${prefixCls}-wrapper-rtl`]: direction === 'rtl',
    [`${prefixCls}-wrapper-in-form-item`]: isFormItemInput,
    [`${prefixCls}-wrapper-block`]: !!(groupContext === null || groupContext === void 0 ? void 0 : groupContext.block)
  }, radio === null || radio === void 0 ? void 0 : radio.className, className, rootClassName, hashId, cssVarCls, rootCls);
  // ============================ Event Lock ============================
  const [onLabelClick, onInputClick] = useBubbleLock(radioProps.onClick);
  // ============================== Render ==============================
  return wrapCSSVar(/*#__PURE__*/react.createElement(wave/* default */.A, {
    component: "Radio",
    disabled: radioProps.disabled
  }, /*#__PURE__*/react.createElement("label", {
    className: wrapperClassString,
    style: Object.assign(Object.assign({}, radio === null || radio === void 0 ? void 0 : radio.style), style),
    onMouseEnter: props.onMouseEnter,
    onMouseLeave: props.onMouseLeave,
    title: title,
    onClick: onLabelClick
  }, /*#__PURE__*/react.createElement(rc_checkbox_es, Object.assign({}, radioProps, {
    className: classnames_default()(radioProps.className, {
      [wave_interface/* TARGET_CLS */.D]: !isButtonType
    }),
    type: "radio",
    prefixCls: prefixCls,
    ref: mergedRef,
    onClick: onInputClick
  })), children !== undefined ? /*#__PURE__*/react.createElement("span", null, children) : null)));
};
const Radio = /*#__PURE__*/react.forwardRef(InternalRadio);
if (false) {}
/* harmony default export */ var radio_radio = (Radio);
;// ./node_modules/antd/es/radio/group.js
"use client";











const RadioGroup = /*#__PURE__*/react.forwardRef((props, ref) => {
  const {
    getPrefixCls,
    direction
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    options,
    buttonStyle = 'outline',
    disabled,
    children,
    size: customizeSize,
    style,
    id,
    optionType,
    name,
    defaultValue,
    value: customizedValue,
    block = false,
    onChange,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur
  } = props;
  const [value, setValue] = (0,useMergedState/* default */.A)(defaultValue, {
    value: customizedValue
  });
  const onRadioChange = react.useCallback(event => {
    const lastValue = value;
    const val = event.target.value;
    if (!('value' in props)) {
      setValue(val);
    }
    if (val !== lastValue) {
      onChange === null || onChange === void 0 ? void 0 : onChange(event);
    }
  }, [value, setValue, onChange]);
  const prefixCls = getPrefixCls('radio', customizePrefixCls);
  const groupPrefixCls = `${prefixCls}-group`;
  // Style
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = radio_style(prefixCls, rootCls);
  let childrenToRender = children;
  // 如果存在 options, 优先使用
  if (options && options.length > 0) {
    childrenToRender = options.map(option => {
      if (typeof option === 'string' || typeof option === 'number') {
        // 此处类型自动推导为 string
        return /*#__PURE__*/react.createElement(radio_radio, {
          key: option.toString(),
          prefixCls: prefixCls,
          disabled: disabled,
          value: option,
          checked: value === option
        }, option);
      }
      // 此处类型自动推导为 { label: string value: string }
      return /*#__PURE__*/react.createElement(radio_radio, {
        key: `radio-group-value-options-${option.value}`,
        prefixCls: prefixCls,
        disabled: option.disabled || disabled,
        value: option.value,
        checked: value === option.value,
        title: option.title,
        style: option.style,
        id: option.id,
        required: option.required
      }, option.label);
    });
  }
  const mergedSize = (0,useSize/* default */.A)(customizeSize);
  const classString = classnames_default()(groupPrefixCls, `${groupPrefixCls}-${buttonStyle}`, {
    [`${groupPrefixCls}-${mergedSize}`]: mergedSize,
    [`${groupPrefixCls}-rtl`]: direction === 'rtl',
    [`${groupPrefixCls}-block`]: block
  }, className, rootClassName, hashId, cssVarCls, rootCls);
  const memoizedValue = react.useMemo(() => ({
    onChange: onRadioChange,
    value,
    disabled,
    name,
    optionType,
    block
  }), [onRadioChange, value, disabled, name, optionType, block]);
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", Object.assign({}, (0,pickAttrs/* default */.A)(props, {
    aria: true,
    data: true
  }), {
    className: classString,
    style: style,
    onMouseEnter: onMouseEnter,
    onMouseLeave: onMouseLeave,
    onFocus: onFocus,
    onBlur: onBlur,
    id: id,
    ref: ref
  }), /*#__PURE__*/react.createElement(RadioGroupContextProvider, {
    value: memoizedValue
  }, childrenToRender)));
});
/* harmony default export */ var group = (/*#__PURE__*/react.memo(RadioGroup));
;// ./node_modules/antd/es/radio/radioButton.js
"use client";

var radioButton_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};




const RadioButton = (props, ref) => {
  const {
    getPrefixCls
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const {
      prefixCls: customizePrefixCls
    } = props,
    radioProps = radioButton_rest(props, ["prefixCls"]);
  const prefixCls = getPrefixCls('radio', customizePrefixCls);
  return /*#__PURE__*/react.createElement(RadioOptionTypeContextProvider, {
    value: "button"
  }, /*#__PURE__*/react.createElement(radio_radio, Object.assign({
    prefixCls: prefixCls
  }, radioProps, {
    type: "radio",
    ref: ref
  })));
};
/* harmony default export */ var radioButton = (/*#__PURE__*/react.forwardRef(RadioButton));
;// ./node_modules/antd/es/radio/index.js
"use client";





const radio_Radio = radio_radio;
radio_Radio.Button = radioButton;
radio_Radio.Group = group;
radio_Radio.__ANT_RADIO = true;
/* harmony default export */ var es_radio = (radio_Radio);
;// ./node_modules/antd/es/table/hooks/useSelection.js
"use client";
















// TODO: warning if use ajax!!!
const SELECTION_COLUMN = {};
const SELECTION_ALL = 'SELECT_ALL';
const SELECTION_INVERT = 'SELECT_INVERT';
const SELECTION_NONE = 'SELECT_NONE';
const EMPTY_LIST = [];
const flattenData = (childrenColumnName, data) => {
  let list = [];
  (data || []).forEach(record => {
    list.push(record);
    if (record && typeof record === 'object' && childrenColumnName in record) {
      list = [].concat((0,toConsumableArray/* default */.A)(list), (0,toConsumableArray/* default */.A)(flattenData(childrenColumnName, record[childrenColumnName])));
    }
  });
  return list;
};
const useSelection = (config, rowSelection) => {
  const {
    preserveSelectedRowKeys,
    selectedRowKeys,
    defaultSelectedRowKeys,
    getCheckboxProps,
    onChange: onSelectionChange,
    onSelect,
    onSelectAll,
    onSelectInvert,
    onSelectNone,
    onSelectMultiple,
    columnWidth: selectionColWidth,
    type: selectionType,
    selections,
    fixed,
    renderCell: customizeRenderCell,
    hideSelectAll,
    checkStrictly = true
  } = rowSelection || {};
  const {
    prefixCls,
    data,
    pageData,
    getRecordByKey,
    getRowKey,
    expandType,
    childrenColumnName,
    locale: tableLocale,
    getPopupContainer
  } = config;
  const warning = (0,_util_warning/* devUseWarning */.rJ)('Table');
  // ========================= MultipleSelect =========================
  const [multipleSelect, updatePrevSelectedIndex] = useMultipleSelect(item => item);
  // ========================= Keys =========================
  const [mergedSelectedKeys, setMergedSelectedKeys] = (0,useMergedState/* default */.A)(selectedRowKeys || defaultSelectedRowKeys || EMPTY_LIST, {
    value: selectedRowKeys
  });
  // ======================== Caches ========================
  const preserveRecordsRef = react.useRef(new Map());
  const updatePreserveRecordsCache = (0,react.useCallback)(keys => {
    if (preserveSelectedRowKeys) {
      const newCache = new Map();
      // Keep key if mark as preserveSelectedRowKeys
      keys.forEach(key => {
        let record = getRecordByKey(key);
        if (!record && preserveRecordsRef.current.has(key)) {
          record = preserveRecordsRef.current.get(key);
        }
        newCache.set(key, record);
      });
      // Refresh to new cache
      preserveRecordsRef.current = newCache;
    }
  }, [getRecordByKey, preserveSelectedRowKeys]);
  // Update cache with selectedKeys
  react.useEffect(() => {
    updatePreserveRecordsCache(mergedSelectedKeys);
  }, [mergedSelectedKeys]);
  // Get flatten data
  const flattedData = (0,react.useMemo)(() => flattenData(childrenColumnName, pageData), [childrenColumnName, pageData]);
  const {
    keyEntities
  } = (0,react.useMemo)(() => {
    if (checkStrictly) {
      return {
        keyEntities: null
      };
    }
    let convertData = data;
    if (preserveSelectedRowKeys) {
      // use flattedData keys
      const keysSet = new Set(flattedData.map((record, index) => getRowKey(record, index)));
      // remove preserveRecords that duplicate data
      const preserveRecords = Array.from(preserveRecordsRef.current).reduce((total, _ref) => {
        let [key, value] = _ref;
        return keysSet.has(key) ? total : total.concat(value);
      }, []);
      convertData = [].concat((0,toConsumableArray/* default */.A)(convertData), (0,toConsumableArray/* default */.A)(preserveRecords));
    }
    return convertDataToEntities(convertData, {
      externalGetKey: getRowKey,
      childrenPropName: childrenColumnName
    });
  }, [data, getRowKey, checkStrictly, childrenColumnName, preserveSelectedRowKeys, flattedData]);
  // Get all checkbox props
  const checkboxPropsMap = (0,react.useMemo)(() => {
    const map = new Map();
    flattedData.forEach((record, index) => {
      const key = getRowKey(record, index);
      const checkboxProps = (getCheckboxProps ? getCheckboxProps(record) : null) || {};
      map.set(key, checkboxProps);
       false ? 0 : void 0;
    });
    return map;
  }, [flattedData, getRowKey, getCheckboxProps]);
  const isCheckboxDisabled = (0,react.useCallback)(r => {
    var _a;
    return !!((_a = checkboxPropsMap.get(getRowKey(r))) === null || _a === void 0 ? void 0 : _a.disabled);
  }, [checkboxPropsMap, getRowKey]);
  const [derivedSelectedKeys, derivedHalfSelectedKeys] = (0,react.useMemo)(() => {
    if (checkStrictly) {
      return [mergedSelectedKeys || [], []];
    }
    const {
      checkedKeys,
      halfCheckedKeys
    } = conductCheck(mergedSelectedKeys, true, keyEntities, isCheckboxDisabled);
    return [checkedKeys || [], halfCheckedKeys];
  }, [mergedSelectedKeys, checkStrictly, keyEntities, isCheckboxDisabled]);
  const derivedSelectedKeySet = (0,react.useMemo)(() => {
    const keys = selectionType === 'radio' ? derivedSelectedKeys.slice(0, 1) : derivedSelectedKeys;
    return new Set(keys);
  }, [derivedSelectedKeys, selectionType]);
  const derivedHalfSelectedKeySet = (0,react.useMemo)(() => selectionType === 'radio' ? new Set() : new Set(derivedHalfSelectedKeys), [derivedHalfSelectedKeys, selectionType]);
  // Reset if rowSelection reset
  react.useEffect(() => {
    if (!rowSelection) {
      setMergedSelectedKeys(EMPTY_LIST);
    }
  }, [!!rowSelection]);
  const setSelectedKeys = (0,react.useCallback)((keys, method) => {
    let availableKeys;
    let records;
    updatePreserveRecordsCache(keys);
    if (preserveSelectedRowKeys) {
      availableKeys = keys;
      records = keys.map(key => preserveRecordsRef.current.get(key));
    } else {
      // Filter key which not exist in the `dataSource`
      availableKeys = [];
      records = [];
      keys.forEach(key => {
        const record = getRecordByKey(key);
        if (record !== undefined) {
          availableKeys.push(key);
          records.push(record);
        }
      });
    }
    setMergedSelectedKeys(availableKeys);
    onSelectionChange === null || onSelectionChange === void 0 ? void 0 : onSelectionChange(availableKeys, records, {
      type: method
    });
  }, [setMergedSelectedKeys, getRecordByKey, onSelectionChange, preserveSelectedRowKeys]);
  // ====================== Selections ======================
  // Trigger single `onSelect` event
  const triggerSingleSelection = (0,react.useCallback)((key, selected, keys, event) => {
    if (onSelect) {
      const rows = keys.map(k => getRecordByKey(k));
      onSelect(getRecordByKey(key), selected, rows, event);
    }
    setSelectedKeys(keys, 'single');
  }, [onSelect, getRecordByKey, setSelectedKeys]);
  const mergedSelections = (0,react.useMemo)(() => {
    if (!selections || hideSelectAll) {
      return null;
    }
    const selectionList = selections === true ? [SELECTION_ALL, SELECTION_INVERT, SELECTION_NONE] : selections;
    return selectionList.map(selection => {
      if (selection === SELECTION_ALL) {
        return {
          key: 'all',
          text: tableLocale.selectionAll,
          onSelect() {
            setSelectedKeys(data.map((record, index) => getRowKey(record, index)).filter(key => {
              const checkProps = checkboxPropsMap.get(key);
              return !(checkProps === null || checkProps === void 0 ? void 0 : checkProps.disabled) || derivedSelectedKeySet.has(key);
            }), 'all');
          }
        };
      }
      if (selection === SELECTION_INVERT) {
        return {
          key: 'invert',
          text: tableLocale.selectInvert,
          onSelect() {
            const keySet = new Set(derivedSelectedKeySet);
            pageData.forEach((record, index) => {
              const key = getRowKey(record, index);
              const checkProps = checkboxPropsMap.get(key);
              if (!(checkProps === null || checkProps === void 0 ? void 0 : checkProps.disabled)) {
                if (keySet.has(key)) {
                  keySet.delete(key);
                } else {
                  keySet.add(key);
                }
              }
            });
            const keys = Array.from(keySet);
            if (onSelectInvert) {
              warning.deprecated(false, 'onSelectInvert', 'onChange');
              onSelectInvert(keys);
            }
            setSelectedKeys(keys, 'invert');
          }
        };
      }
      if (selection === SELECTION_NONE) {
        return {
          key: 'none',
          text: tableLocale.selectNone,
          onSelect() {
            onSelectNone === null || onSelectNone === void 0 ? void 0 : onSelectNone();
            setSelectedKeys(Array.from(derivedSelectedKeySet).filter(key => {
              const checkProps = checkboxPropsMap.get(key);
              return checkProps === null || checkProps === void 0 ? void 0 : checkProps.disabled;
            }), 'none');
          }
        };
      }
      return selection;
    }).map(selection => Object.assign(Object.assign({}, selection), {
      onSelect: function () {
        var _a2;
        var _a;
        for (var _len = arguments.length, rest = new Array(_len), _key = 0; _key < _len; _key++) {
          rest[_key] = arguments[_key];
        }
        (_a = selection.onSelect) === null || _a === void 0 ? void 0 : (_a2 = _a).call.apply(_a2, [selection].concat(rest));
        updatePrevSelectedIndex(null);
      }
    }));
  }, [selections, derivedSelectedKeySet, pageData, getRowKey, onSelectInvert, setSelectedKeys]);
  // ======================= Columns ========================
  const transformColumns = (0,react.useCallback)(columns => {
    var _a;
    // >>>>>>>>>>> Skip if not exists `rowSelection`
    if (!rowSelection) {
       false ? 0 : void 0;
      return columns.filter(col => col !== SELECTION_COLUMN);
    }
    // >>>>>>>>>>> Support selection
    let cloneColumns = (0,toConsumableArray/* default */.A)(columns);
    const keySet = new Set(derivedSelectedKeySet);
    // Record key only need check with enabled
    const recordKeys = flattedData.map(getRowKey).filter(key => !checkboxPropsMap.get(key).disabled);
    const checkedCurrentAll = recordKeys.every(key => keySet.has(key));
    const checkedCurrentSome = recordKeys.some(key => keySet.has(key));
    const onSelectAllChange = () => {
      const changeKeys = [];
      if (checkedCurrentAll) {
        recordKeys.forEach(key => {
          keySet.delete(key);
          changeKeys.push(key);
        });
      } else {
        recordKeys.forEach(key => {
          if (!keySet.has(key)) {
            keySet.add(key);
            changeKeys.push(key);
          }
        });
      }
      const keys = Array.from(keySet);
      onSelectAll === null || onSelectAll === void 0 ? void 0 : onSelectAll(!checkedCurrentAll, keys.map(k => getRecordByKey(k)), changeKeys.map(k => getRecordByKey(k)));
      setSelectedKeys(keys, 'all');
      updatePrevSelectedIndex(null);
    };
    // ===================== Render =====================
    // Title Cell
    let title;
    let columnTitleCheckbox;
    if (selectionType !== 'radio') {
      let customizeSelections;
      if (mergedSelections) {
        const menu = {
          getPopupContainer,
          items: mergedSelections.map((selection, index) => {
            const {
              key,
              text,
              onSelect: onSelectionClick
            } = selection;
            return {
              key: key !== null && key !== void 0 ? key : index,
              onClick: () => {
                onSelectionClick === null || onSelectionClick === void 0 ? void 0 : onSelectionClick(recordKeys);
              },
              label: text
            };
          })
        };
        customizeSelections = /*#__PURE__*/react.createElement("div", {
          className: `${prefixCls}-selection-extra`
        }, /*#__PURE__*/react.createElement(dropdown/* default */.A, {
          menu: menu,
          getPopupContainer: getPopupContainer
        }, /*#__PURE__*/react.createElement("span", null, /*#__PURE__*/react.createElement(DownOutlined/* default */.A, null))));
      }
      const allDisabledData = flattedData.map((record, index) => {
        const key = getRowKey(record, index);
        const checkboxProps = checkboxPropsMap.get(key) || {};
        return Object.assign({
          checked: keySet.has(key)
        }, checkboxProps);
      }).filter(_ref2 => {
        let {
          disabled
        } = _ref2;
        return disabled;
      });
      const allDisabled = !!allDisabledData.length && allDisabledData.length === flattedData.length;
      const allDisabledAndChecked = allDisabled && allDisabledData.every(_ref3 => {
        let {
          checked
        } = _ref3;
        return checked;
      });
      const allDisabledSomeChecked = allDisabled && allDisabledData.some(_ref4 => {
        let {
          checked
        } = _ref4;
        return checked;
      });
      columnTitleCheckbox = /*#__PURE__*/react.createElement(es_checkbox, {
        checked: !allDisabled ? !!flattedData.length && checkedCurrentAll : allDisabledAndChecked,
        indeterminate: !allDisabled ? !checkedCurrentAll && checkedCurrentSome : !allDisabledAndChecked && allDisabledSomeChecked,
        onChange: onSelectAllChange,
        disabled: flattedData.length === 0 || allDisabled,
        "aria-label": customizeSelections ? 'Custom selection' : 'Select all',
        skipGroup: true
      });
      title = !hideSelectAll && (/*#__PURE__*/react.createElement("div", {
        className: `${prefixCls}-selection`
      }, columnTitleCheckbox, customizeSelections));
    }
    // Body Cell
    let renderCell;
    if (selectionType === 'radio') {
      renderCell = (_, record, index) => {
        const key = getRowKey(record, index);
        const checked = keySet.has(key);
        const checkboxProps = checkboxPropsMap.get(key);
        return {
          node: (/*#__PURE__*/react.createElement(es_radio, Object.assign({}, checkboxProps, {
            checked: checked,
            onClick: e => {
              var _a;
              e.stopPropagation();
              (_a = checkboxProps === null || checkboxProps === void 0 ? void 0 : checkboxProps.onClick) === null || _a === void 0 ? void 0 : _a.call(checkboxProps, e);
            },
            onChange: event => {
              var _a;
              if (!keySet.has(key)) {
                triggerSingleSelection(key, true, [key], event.nativeEvent);
              }
              (_a = checkboxProps === null || checkboxProps === void 0 ? void 0 : checkboxProps.onChange) === null || _a === void 0 ? void 0 : _a.call(checkboxProps, event);
            }
          }))),
          checked
        };
      };
    } else {
      renderCell = (_, record, index) => {
        var _a;
        const key = getRowKey(record, index);
        const checked = keySet.has(key);
        const indeterminate = derivedHalfSelectedKeySet.has(key);
        const checkboxProps = checkboxPropsMap.get(key);
        let mergedIndeterminate;
        if (expandType === 'nest') {
          mergedIndeterminate = indeterminate;
           false ? 0 : void 0;
        } else {
          mergedIndeterminate = (_a = checkboxProps === null || checkboxProps === void 0 ? void 0 : checkboxProps.indeterminate) !== null && _a !== void 0 ? _a : indeterminate;
        }
        // Record checked
        return {
          node: (/*#__PURE__*/react.createElement(es_checkbox, Object.assign({}, checkboxProps, {
            indeterminate: mergedIndeterminate,
            checked: checked,
            skipGroup: true,
            onClick: e => {
              var _a;
              e.stopPropagation();
              (_a = checkboxProps === null || checkboxProps === void 0 ? void 0 : checkboxProps.onClick) === null || _a === void 0 ? void 0 : _a.call(checkboxProps, e);
            },
            onChange: event => {
              var _a;
              const {
                nativeEvent
              } = event;
              const {
                shiftKey
              } = nativeEvent;
              const currentSelectedIndex = recordKeys.findIndex(item => item === key);
              const isMultiple = derivedSelectedKeys.some(item => recordKeys.includes(item));
              if (shiftKey && checkStrictly && isMultiple) {
                const changedKeys = multipleSelect(currentSelectedIndex, recordKeys, keySet);
                const keys = Array.from(keySet);
                onSelectMultiple === null || onSelectMultiple === void 0 ? void 0 : onSelectMultiple(!checked, keys.map(recordKey => getRecordByKey(recordKey)), changedKeys.map(recordKey => getRecordByKey(recordKey)));
                setSelectedKeys(keys, 'multiple');
              } else {
                // Single record selected
                const originCheckedKeys = derivedSelectedKeys;
                if (checkStrictly) {
                  const checkedKeys = checked ? arrDel(originCheckedKeys, key) : arrAdd(originCheckedKeys, key);
                  triggerSingleSelection(key, !checked, checkedKeys, nativeEvent);
                } else {
                  // Always fill first
                  const result = conductCheck([].concat((0,toConsumableArray/* default */.A)(originCheckedKeys), [key]), true, keyEntities, isCheckboxDisabled);
                  const {
                    checkedKeys,
                    halfCheckedKeys
                  } = result;
                  let nextCheckedKeys = checkedKeys;
                  // If remove, we do it again to correction
                  if (checked) {
                    const tempKeySet = new Set(checkedKeys);
                    tempKeySet.delete(key);
                    nextCheckedKeys = conductCheck(Array.from(tempKeySet), {
                      checked: false,
                      halfCheckedKeys
                    }, keyEntities, isCheckboxDisabled).checkedKeys;
                  }
                  triggerSingleSelection(key, !checked, nextCheckedKeys, nativeEvent);
                }
              }
              if (checked) {
                updatePrevSelectedIndex(null);
              } else {
                updatePrevSelectedIndex(currentSelectedIndex);
              }
              (_a = checkboxProps === null || checkboxProps === void 0 ? void 0 : checkboxProps.onChange) === null || _a === void 0 ? void 0 : _a.call(checkboxProps, event);
            }
          }))),
          checked
        };
      };
    }
    const renderSelectionCell = (_, record, index) => {
      const {
        node,
        checked
      } = renderCell(_, record, index);
      if (customizeRenderCell) {
        return customizeRenderCell(checked, record, index, node);
      }
      return node;
    };
    // Insert selection column if not exist
    if (!cloneColumns.includes(SELECTION_COLUMN)) {
      // Always after expand icon
      if (cloneColumns.findIndex(col => {
        var _a;
        return ((_a = col[INTERNAL_COL_DEFINE]) === null || _a === void 0 ? void 0 : _a.columnType) === 'EXPAND_COLUMN';
      }) === 0) {
        const [expandColumn, ...restColumns] = cloneColumns;
        cloneColumns = [expandColumn, SELECTION_COLUMN].concat((0,toConsumableArray/* default */.A)(restColumns));
      } else {
        // Normal insert at first column
        cloneColumns = [SELECTION_COLUMN].concat((0,toConsumableArray/* default */.A)(cloneColumns));
      }
    }
    // Deduplicate selection column
    const selectionColumnIndex = cloneColumns.indexOf(SELECTION_COLUMN);
     false ? 0 : void 0;
    cloneColumns = cloneColumns.filter((column, index) => column !== SELECTION_COLUMN || index === selectionColumnIndex);
    // Fixed column logic
    const prevCol = cloneColumns[selectionColumnIndex - 1];
    const nextCol = cloneColumns[selectionColumnIndex + 1];
    let mergedFixed = fixed;
    if (mergedFixed === undefined) {
      if ((nextCol === null || nextCol === void 0 ? void 0 : nextCol.fixed) !== undefined) {
        mergedFixed = nextCol.fixed;
      } else if ((prevCol === null || prevCol === void 0 ? void 0 : prevCol.fixed) !== undefined) {
        mergedFixed = prevCol.fixed;
      }
    }
    if (mergedFixed && prevCol && ((_a = prevCol[INTERNAL_COL_DEFINE]) === null || _a === void 0 ? void 0 : _a.columnType) === 'EXPAND_COLUMN' && prevCol.fixed === undefined) {
      prevCol.fixed = mergedFixed;
    }
    const columnCls = classnames_default()(`${prefixCls}-selection-col`, {
      [`${prefixCls}-selection-col-with-dropdown`]: selections && selectionType === 'checkbox'
    });
    const renderColumnTitle = () => {
      if (!(rowSelection === null || rowSelection === void 0 ? void 0 : rowSelection.columnTitle)) {
        return title;
      }
      if (typeof rowSelection.columnTitle === 'function') {
        return rowSelection.columnTitle(columnTitleCheckbox);
      }
      return rowSelection.columnTitle;
    };
    // Replace with real selection column
    const selectionColumn = {
      fixed: mergedFixed,
      width: selectionColWidth,
      className: `${prefixCls}-selection-column`,
      title: renderColumnTitle(),
      render: renderSelectionCell,
      onCell: rowSelection.onCell,
      [INTERNAL_COL_DEFINE]: {
        className: columnCls
      }
    };
    return cloneColumns.map(col => col === SELECTION_COLUMN ? selectionColumn : col);
  }, [getRowKey, flattedData, rowSelection, derivedSelectedKeys, derivedSelectedKeySet, derivedHalfSelectedKeySet, selectionColWidth, mergedSelections, expandType, checkboxPropsMap, onSelectMultiple, triggerSingleSelection, isCheckboxDisabled]);
  return [transformColumns, derivedSelectedKeySet];
};
/* harmony default export */ var hooks_useSelection = (useSelection);
;// ./node_modules/antd/es/_util/hooks/useProxyImperativeHandle.js
// Proxy the dom ref with `{ nativeElement, otherFn }` type
// ref: https://github.com/ant-design/ant-design/discussions/45242

function fillProxy(element, handler) {
  element._antProxy = element._antProxy || {};
  Object.keys(handler).forEach(key => {
    if (!(key in element._antProxy)) {
      const ori = element[key];
      element._antProxy[key] = ori;
      element[key] = handler[key];
    }
  });
  return element;
}
function useProxyImperativeHandle(ref, init) {
  return (0,react.useImperativeHandle)(ref, () => {
    const refObj = init();
    const {
      nativeElement
    } = refObj;
    if (typeof Proxy !== 'undefined') {
      return new Proxy(nativeElement, {
        get(obj, prop) {
          if (refObj[prop]) {
            return refObj[prop];
          }
          return Reflect.get(obj, prop);
        }
      });
    }
    // Fallback of IE
    return fillProxy(nativeElement, refObj);
  });
}
;// ./node_modules/antd/es/_util/easings.js
function easeInOutCubic(t, b, c, d) {
  const cc = c - b;
  // biome-ignore lint: it is a common easing function
  t /= d / 2;
  if (t < 1) {
    return cc / 2 * t * t * t + b;
  }
  // biome-ignore lint: it is a common easing function
  return cc / 2 * ((t -= 2) * t * t + 2) + b;
}
;// ./node_modules/antd/es/_util/getScroll.js
function isWindow(obj) {
  return obj !== null && obj !== undefined && obj === obj.window;
}
const getScroll_getScroll = target => {
  var _a, _b;
  if (typeof window === 'undefined') {
    return 0;
  }
  let result = 0;
  if (isWindow(target)) {
    result = target.pageYOffset;
  } else if (target instanceof Document) {
    result = target.documentElement.scrollTop;
  } else if (target instanceof HTMLElement) {
    result = target.scrollTop;
  } else if (target) {
    // According to the type inference, the `target` is `never` type.
    // Since we configured the loose mode type checking, and supports mocking the target with such shape below::
    //    `{ documentElement: { scrollLeft: 200, scrollTop: 400 } }`,
    //    the program may falls into this branch.
    // Check the corresponding tests for details. Don't sure what is the real scenario this happens.
    /* biome-ignore lint/complexity/useLiteralKeys: target is a never type */ /* eslint-disable-next-line dot-notation */
    result = target['scrollTop'];
  }
  if (target && !isWindow(target) && typeof result !== 'number') {
    result = (_b = ((_a = target.ownerDocument) !== null && _a !== void 0 ? _a : target).documentElement) === null || _b === void 0 ? void 0 : _b.scrollTop;
  }
  return result;
};
/* harmony default export */ var _util_getScroll = (getScroll_getScroll);
;// ./node_modules/antd/es/_util/scrollTo.js



function scrollTo(y) {
  let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  const {
    getContainer = () => window,
    callback,
    duration = 450
  } = options;
  const container = getContainer();
  const scrollTop = _util_getScroll(container);
  const startTime = Date.now();
  const frameFunc = () => {
    const timestamp = Date.now();
    const time = timestamp - startTime;
    const nextScrollTop = easeInOutCubic(time > duration ? duration : time, scrollTop, y, duration);
    if (isWindow(container)) {
      container.scrollTo(window.pageXOffset, nextScrollTop);
    } else if (container instanceof Document || container.constructor.name === 'HTMLDocument') {
      container.documentElement.scrollTop = nextScrollTop;
    } else {
      container.scrollTop = nextScrollTop;
    }
    if (time < duration) {
      (0,raf/* default */.A)(frameFunc);
    } else if (typeof callback === 'function') {
      callback();
    }
  };
  (0,raf/* default */.A)(frameFunc);
}
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/defaultRenderEmpty.js
var defaultRenderEmpty = __webpack_require__(35128);
// EXTERNAL MODULE: ./node_modules/antd/es/grid/hooks/useBreakpoint.js
var useBreakpoint = __webpack_require__(78551);
// EXTERNAL MODULE: ./node_modules/antd/es/locale/en_US.js + 5 modules
var en_US = __webpack_require__(80436);
// EXTERNAL MODULE: ./node_modules/antd/es/pagination/index.js + 15 modules
var es_pagination = __webpack_require__(9149);
// EXTERNAL MODULE: ./node_modules/antd/es/spin/index.js + 6 modules
var spin = __webpack_require__(34716);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/useToken.js + 2 modules
var useToken = __webpack_require__(11320);
;// ./node_modules/antd/es/table/ExpandIcon.js
"use client";



function ExpandIcon_renderExpandIcon(locale) {
  return props => {
    const {
      prefixCls,
      onExpand,
      record,
      expanded,
      expandable
    } = props;
    const iconPrefix = `${prefixCls}-row-expand-icon`;
    return /*#__PURE__*/react.createElement("button", {
      type: "button",
      onClick: e => {
        onExpand(record, e);
        e.stopPropagation();
      },
      className: classnames_default()(iconPrefix, {
        [`${iconPrefix}-spaced`]: !expandable,
        [`${iconPrefix}-expanded`]: expandable && expanded,
        [`${iconPrefix}-collapsed`]: expandable && !expanded
      }),
      "aria-label": expanded ? locale.collapse : locale.expand,
      "aria-expanded": expanded
    });
  };
}
/* harmony default export */ var ExpandIcon = (ExpandIcon_renderExpandIcon);
;// ./node_modules/antd/es/table/hooks/useContainerWidth.js
function useContainerWidth(prefixCls) {
  const getContainerWidth = (ele, width) => {
    const container = ele.querySelector(`.${prefixCls}-container`);
    let returnWidth = width;
    if (container) {
      const style = getComputedStyle(container);
      const borderLeft = parseInt(style.borderLeftWidth, 10);
      const borderRight = parseInt(style.borderRightWidth, 10);
      returnWidth = width - borderLeft - borderRight;
    }
    return returnWidth;
  };
  return getContainerWidth;
}
;// ./node_modules/antd/es/table/util.js
const getColumnKey = (column, defaultKey) => {
  if ('key' in column && column.key !== undefined && column.key !== null) {
    return column.key;
  }
  if (column.dataIndex) {
    return Array.isArray(column.dataIndex) ? column.dataIndex.join('.') : column.dataIndex;
  }
  return defaultKey;
};
function getColumnPos(index, pos) {
  return pos ? `${pos}-${index}` : `${index}`;
}
const renderColumnTitle = (title, props) => {
  if (typeof title === 'function') {
    return title(props);
  }
  return title;
};
/**
 * Safe get column title
 *
 * Should filter [object Object]
 *
 * @param title
 */
const safeColumnTitle = (title, props) => {
  const res = renderColumnTitle(title, props);
  if (Object.prototype.toString.call(res) === '[object Object]') {
    return '';
  }
  return res;
};
;// ./node_modules/@ant-design/icons-svg/es/asn/FilterFilled.js
// This icon file is generated automatically.
var FilterFilled = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M349 838c0 17.7 14.2 32 31.8 32h262.4c17.6 0 31.8-14.3 31.8-32V642H349v196zm531.1-684H143.9c-24.5 0-39.8 26.7-27.5 48l221.3 376h348.8l221.3-376c12.1-21.3-3.2-48-27.7-48z" } }] }, "name": "filter", "theme": "filled" };
/* harmony default export */ var asn_FilterFilled = (FilterFilled);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/FilterFilled.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var FilterFilled_FilterFilled = function FilterFilled(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_FilterFilled
  }));
};

/**![filter](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTM0OSA4MzhjMCAxNy43IDE0LjIgMzIgMzEuOCAzMmgyNjIuNGMxNy42IDAgMzEuOC0xNC4zIDMxLjgtMzJWNjQySDM0OXYxOTZ6bTUzMS4xLTY4NEgxNDMuOWMtMjQuNSAwLTM5LjggMjYuNy0yNy41IDQ4bDIyMS4zIDM3NmgzNDguOGwyMjEuMy0zNzZjMTIuMS0yMS4zLTMuMi00OC0yNy43LTQ4eiIgLz48L3N2Zz4=) */
var RefIcon = /*#__PURE__*/react.forwardRef(FilterFilled_FilterFilled);
if (false) {}
/* harmony default export */ var icons_FilterFilled = (RefIcon);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/extendsObject.js
var extendsObject = __webpack_require__(51679);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/hooks/useForceUpdate.js
var useForceUpdate = __webpack_require__(47447);
;// ./node_modules/antd/es/_util/hooks/useSyncState.js


function useSyncState(initialValue) {
  const ref = react.useRef(initialValue);
  const forceUpdate = (0,useForceUpdate/* default */.A)();
  return [() => ref.current, newValue => {
    ref.current = newValue;
    // re-render
    forceUpdate();
  }];
}
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
// EXTERNAL MODULE: ./node_modules/antd/es/empty/index.js + 3 modules
var es_empty = __webpack_require__(17308);
// EXTERNAL MODULE: ./node_modules/antd/es/menu/index.js + 11 modules
var menu = __webpack_require__(25226);
// EXTERNAL MODULE: ./node_modules/antd/es/menu/OverrideContext.js
var OverrideContext = __webpack_require__(96476);
// EXTERNAL MODULE: ./node_modules/rc-util/es/KeyCode.js
var KeyCode = __webpack_require__(16928);
;// ./node_modules/rc-tree/es/DropIndicator.js

function DropIndicator(_ref) {
  var dropPosition = _ref.dropPosition,
    dropLevelOffset = _ref.dropLevelOffset,
    indent = _ref.indent;
  var style = {
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    backgroundColor: 'red',
    height: 2
  };
  switch (dropPosition) {
    case -1:
      style.top = 0;
      style.left = -dropLevelOffset * indent;
      break;
    case 1:
      style.bottom = 0;
      style.left = -dropLevelOffset * indent;
      break;
    case 0:
      style.bottom = 0;
      style.left = indent;
      break;
  }
  return /*#__PURE__*/react.createElement("div", {
    style: style
  });
}
;// ./node_modules/@babel/runtime/helpers/esm/objectDestructuringEmpty.js
function _objectDestructuringEmpty(t) {
  if (null == t) throw new TypeError("Cannot destructure " + t);
}

// EXTERNAL MODULE: ./node_modules/rc-motion/es/index.js + 13 modules
var rc_motion_es = __webpack_require__(90754);
;// ./node_modules/rc-tree/es/useUnmount.js




/**
 * Trigger only when component unmount
 */
function useUnmount(triggerStart, triggerEnd) {
  var _React$useState = react.useState(false),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    firstMount = _React$useState2[0],
    setFirstMount = _React$useState2[1];
  (0,useLayoutEffect/* default */.A)(function () {
    if (firstMount) {
      triggerStart();
      return function () {
        triggerEnd();
      };
    }
  }, [firstMount]);
  (0,useLayoutEffect/* default */.A)(function () {
    setFirstMount(true);
    return function () {
      setFirstMount(false);
    };
  }, []);
}
;// ./node_modules/rc-tree/es/MotionTreeNode.js




var MotionTreeNode_excluded = ["className", "style", "motion", "motionNodes", "motionType", "onMotionStart", "onMotionEnd", "active", "treeNodeRequiredProps"];








var MotionTreeNode = function MotionTreeNode(_ref, ref) {
  var className = _ref.className,
    style = _ref.style,
    motion = _ref.motion,
    motionNodes = _ref.motionNodes,
    motionType = _ref.motionType,
    onOriginMotionStart = _ref.onMotionStart,
    onOriginMotionEnd = _ref.onMotionEnd,
    active = _ref.active,
    treeNodeRequiredProps = _ref.treeNodeRequiredProps,
    props = (0,objectWithoutProperties/* default */.A)(_ref, MotionTreeNode_excluded);
  var _React$useState = react.useState(true),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    visible = _React$useState2[0],
    setVisible = _React$useState2[1];
  var _React$useContext = react.useContext(TreeContext),
    prefixCls = _React$useContext.prefixCls;

  // Calculate target visible here.
  // And apply in effect to make `leave` motion work.
  var targetVisible = motionNodes && motionType !== 'hide';
  (0,useLayoutEffect/* default */.A)(function () {
    if (motionNodes) {
      if (targetVisible !== visible) {
        setVisible(targetVisible);
      }
    }
  }, [motionNodes]);
  var triggerMotionStart = function triggerMotionStart() {
    if (motionNodes) {
      onOriginMotionStart();
    }
  };

  // Should only trigger once
  var triggerMotionEndRef = react.useRef(false);
  var triggerMotionEnd = function triggerMotionEnd() {
    if (motionNodes && !triggerMotionEndRef.current) {
      triggerMotionEndRef.current = true;
      onOriginMotionEnd();
    }
  };

  // Effect if unmount
  useUnmount(triggerMotionStart, triggerMotionEnd);

  // Motion end event
  var onVisibleChanged = function onVisibleChanged(nextVisible) {
    if (targetVisible === nextVisible) {
      triggerMotionEnd();
    }
  };
  if (motionNodes) {
    return /*#__PURE__*/react.createElement(rc_motion_es/* default */.Ay, (0,esm_extends/* default */.A)({
      ref: ref,
      visible: visible
    }, motion, {
      motionAppear: motionType === 'show',
      onVisibleChanged: onVisibleChanged
    }), function (_ref2, motionRef) {
      var motionClassName = _ref2.className,
        motionStyle = _ref2.style;
      return /*#__PURE__*/react.createElement("div", {
        ref: motionRef,
        className: classnames_default()("".concat(prefixCls, "-treenode-motion"), motionClassName),
        style: motionStyle
      }, motionNodes.map(function (treeNode) {
        var restProps = Object.assign({}, (_objectDestructuringEmpty(treeNode.data), treeNode.data)),
          title = treeNode.title,
          key = treeNode.key,
          isStart = treeNode.isStart,
          isEnd = treeNode.isEnd;
        delete restProps.children;
        var treeNodeProps = getTreeNodeProps(key, treeNodeRequiredProps);
        return /*#__PURE__*/react.createElement(es_TreeNode, (0,esm_extends/* default */.A)({}, restProps, treeNodeProps, {
          title: title,
          active: active,
          data: treeNode.data,
          key: key,
          isStart: isStart,
          isEnd: isEnd
        }));
      }));
    });
  }
  return /*#__PURE__*/react.createElement(es_TreeNode, (0,esm_extends/* default */.A)({
    domRef: ref,
    className: className,
    style: style
  }, props, {
    active: active
  }));
};
MotionTreeNode.displayName = 'MotionTreeNode';
var RefMotionTreeNode = /*#__PURE__*/react.forwardRef(MotionTreeNode);
/* harmony default export */ var es_MotionTreeNode = (RefMotionTreeNode);
;// ./node_modules/rc-tree/es/utils/diffUtil.js
function findExpandedKeys() {
  var prev = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : [];
  var next = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];
  var prevLen = prev.length;
  var nextLen = next.length;
  if (Math.abs(prevLen - nextLen) !== 1) {
    return {
      add: false,
      key: null
    };
  }
  function find(shorter, longer) {
    var cache = new Map();
    shorter.forEach(function (key) {
      cache.set(key, true);
    });
    var keys = longer.filter(function (key) {
      return !cache.has(key);
    });
    return keys.length === 1 ? keys[0] : null;
  }
  if (prevLen < nextLen) {
    return {
      add: true,
      key: find(prev, next)
    };
  }
  return {
    add: false,
    key: find(next, prev)
  };
}
function getExpandRange(shorter, longer, key) {
  var shorterStartIndex = shorter.findIndex(function (data) {
    return data.key === key;
  });
  var shorterEndNode = shorter[shorterStartIndex + 1];
  var longerStartIndex = longer.findIndex(function (data) {
    return data.key === key;
  });
  if (shorterEndNode) {
    var longerEndIndex = longer.findIndex(function (data) {
      return data.key === shorterEndNode.key;
    });
    return longer.slice(longerStartIndex + 1, longerEndIndex);
  }
  return longer.slice(longerStartIndex + 1);
}
;// ./node_modules/rc-tree/es/NodeList.js




var NodeList_excluded = ["prefixCls", "data", "selectable", "checkable", "expandedKeys", "selectedKeys", "checkedKeys", "loadedKeys", "loadingKeys", "halfCheckedKeys", "keyEntities", "disabled", "dragging", "dragOverNodeKey", "dropPosition", "motion", "height", "itemHeight", "virtual", "focusable", "activeItem", "focused", "tabIndex", "onKeyDown", "onFocus", "onBlur", "onActiveChange", "onListChangeStart", "onListChangeEnd"];
/**
 * Handle virtual list of the TreeNodes.
 */







var HIDDEN_STYLE = {
  width: 0,
  height: 0,
  display: 'flex',
  overflow: 'hidden',
  opacity: 0,
  border: 0,
  padding: 0,
  margin: 0
};
var noop = function noop() {};
var MOTION_KEY = "RC_TREE_MOTION_".concat(Math.random());
var MotionNode = {
  key: MOTION_KEY
};
var MotionEntity = {
  key: MOTION_KEY,
  level: 0,
  index: 0,
  pos: '0',
  node: MotionNode,
  nodes: [MotionNode]
};
var MotionFlattenData = {
  parent: null,
  children: [],
  pos: MotionEntity.pos,
  data: MotionNode,
  title: null,
  key: MOTION_KEY,
  /** Hold empty list here since we do not use it */
  isStart: [],
  isEnd: []
};
/**
 * We only need get visible content items to play the animation.
 */
function getMinimumRangeTransitionRange(list, virtual, height, itemHeight) {
  if (virtual === false || !height) {
    return list;
  }
  return list.slice(0, Math.ceil(height / itemHeight) + 1);
}
function itemKey(item) {
  var key = item.key,
    pos = item.pos;
  return getKey(key, pos);
}
function getAccessibilityPath(item) {
  var path = String(item.data.key);
  var current = item;
  while (current.parent) {
    current = current.parent;
    path = "".concat(current.data.key, " > ").concat(path);
  }
  return path;
}
var NodeList = /*#__PURE__*/react.forwardRef(function (props, ref) {
  var prefixCls = props.prefixCls,
    data = props.data,
    selectable = props.selectable,
    checkable = props.checkable,
    expandedKeys = props.expandedKeys,
    selectedKeys = props.selectedKeys,
    checkedKeys = props.checkedKeys,
    loadedKeys = props.loadedKeys,
    loadingKeys = props.loadingKeys,
    halfCheckedKeys = props.halfCheckedKeys,
    keyEntities = props.keyEntities,
    disabled = props.disabled,
    dragging = props.dragging,
    dragOverNodeKey = props.dragOverNodeKey,
    dropPosition = props.dropPosition,
    motion = props.motion,
    height = props.height,
    itemHeight = props.itemHeight,
    virtual = props.virtual,
    focusable = props.focusable,
    activeItem = props.activeItem,
    focused = props.focused,
    tabIndex = props.tabIndex,
    onKeyDown = props.onKeyDown,
    onFocus = props.onFocus,
    onBlur = props.onBlur,
    onActiveChange = props.onActiveChange,
    onListChangeStart = props.onListChangeStart,
    onListChangeEnd = props.onListChangeEnd,
    domProps = (0,objectWithoutProperties/* default */.A)(props, NodeList_excluded);

  // =============================== Ref ================================
  var listRef = react.useRef(null);
  var indentMeasurerRef = react.useRef(null);
  react.useImperativeHandle(ref, function () {
    return {
      scrollTo: function scrollTo(scroll) {
        listRef.current.scrollTo(scroll);
      },
      getIndentWidth: function getIndentWidth() {
        return indentMeasurerRef.current.offsetWidth;
      }
    };
  });

  // ============================== Motion ==============================
  var _React$useState = react.useState(expandedKeys),
    _React$useState2 = (0,slicedToArray/* default */.A)(_React$useState, 2),
    prevExpandedKeys = _React$useState2[0],
    setPrevExpandedKeys = _React$useState2[1];
  var _React$useState3 = react.useState(data),
    _React$useState4 = (0,slicedToArray/* default */.A)(_React$useState3, 2),
    prevData = _React$useState4[0],
    setPrevData = _React$useState4[1];
  var _React$useState5 = react.useState(data),
    _React$useState6 = (0,slicedToArray/* default */.A)(_React$useState5, 2),
    transitionData = _React$useState6[0],
    setTransitionData = _React$useState6[1];
  var _React$useState7 = react.useState([]),
    _React$useState8 = (0,slicedToArray/* default */.A)(_React$useState7, 2),
    transitionRange = _React$useState8[0],
    setTransitionRange = _React$useState8[1];
  var _React$useState9 = react.useState(null),
    _React$useState10 = (0,slicedToArray/* default */.A)(_React$useState9, 2),
    motionType = _React$useState10[0],
    setMotionType = _React$useState10[1];

  // When motion end but data change, this will makes data back to previous one
  var dataRef = react.useRef(data);
  dataRef.current = data;
  function onMotionEnd() {
    var latestData = dataRef.current;
    setPrevData(latestData);
    setTransitionData(latestData);
    setTransitionRange([]);
    setMotionType(null);
    onListChangeEnd();
  }

  // Do animation if expanded keys changed
  // layoutEffect here to avoid blink of node removing
  (0,useLayoutEffect/* default */.A)(function () {
    setPrevExpandedKeys(expandedKeys);
    var diffExpanded = findExpandedKeys(prevExpandedKeys, expandedKeys);
    if (diffExpanded.key !== null) {
      if (diffExpanded.add) {
        var keyIndex = prevData.findIndex(function (_ref) {
          var key = _ref.key;
          return key === diffExpanded.key;
        });
        var rangeNodes = getMinimumRangeTransitionRange(getExpandRange(prevData, data, diffExpanded.key), virtual, height, itemHeight);
        var newTransitionData = prevData.slice();
        newTransitionData.splice(keyIndex + 1, 0, MotionFlattenData);
        setTransitionData(newTransitionData);
        setTransitionRange(rangeNodes);
        setMotionType('show');
      } else {
        var _keyIndex = data.findIndex(function (_ref2) {
          var key = _ref2.key;
          return key === diffExpanded.key;
        });
        var _rangeNodes = getMinimumRangeTransitionRange(getExpandRange(data, prevData, diffExpanded.key), virtual, height, itemHeight);
        var _newTransitionData = data.slice();
        _newTransitionData.splice(_keyIndex + 1, 0, MotionFlattenData);
        setTransitionData(_newTransitionData);
        setTransitionRange(_rangeNodes);
        setMotionType('hide');
      }
    } else if (prevData !== data) {
      // If whole data changed, we just refresh the list
      setPrevData(data);
      setTransitionData(data);
    }
  }, [expandedKeys, data]);

  // We should clean up motion if is changed by dragging
  react.useEffect(function () {
    if (!dragging) {
      onMotionEnd();
    }
  }, [dragging]);
  var mergedData = motion ? transitionData : data;
  var treeNodeRequiredProps = {
    expandedKeys: expandedKeys,
    selectedKeys: selectedKeys,
    loadedKeys: loadedKeys,
    loadingKeys: loadingKeys,
    checkedKeys: checkedKeys,
    halfCheckedKeys: halfCheckedKeys,
    dragOverNodeKey: dragOverNodeKey,
    dropPosition: dropPosition,
    keyEntities: keyEntities
  };
  return /*#__PURE__*/react.createElement(react.Fragment, null, focused && activeItem && /*#__PURE__*/react.createElement("span", {
    style: HIDDEN_STYLE,
    "aria-live": "assertive"
  }, getAccessibilityPath(activeItem)), /*#__PURE__*/react.createElement("div", null, /*#__PURE__*/react.createElement("input", {
    style: HIDDEN_STYLE,
    disabled: focusable === false || disabled,
    tabIndex: focusable !== false ? tabIndex : null,
    onKeyDown: onKeyDown,
    onFocus: onFocus,
    onBlur: onBlur,
    value: "",
    onChange: noop,
    "aria-label": "for screen reader"
  })), /*#__PURE__*/react.createElement("div", {
    className: "".concat(prefixCls, "-treenode"),
    "aria-hidden": true,
    style: {
      position: 'absolute',
      pointerEvents: 'none',
      visibility: 'hidden',
      height: 0,
      overflow: 'hidden',
      border: 0,
      padding: 0
    }
  }, /*#__PURE__*/react.createElement("div", {
    className: "".concat(prefixCls, "-indent")
  }, /*#__PURE__*/react.createElement("div", {
    ref: indentMeasurerRef,
    className: "".concat(prefixCls, "-indent-unit")
  }))), /*#__PURE__*/react.createElement(rc_virtual_list_es/* default */.A, (0,esm_extends/* default */.A)({}, domProps, {
    data: mergedData,
    itemKey: itemKey,
    height: height,
    fullHeight: false,
    virtual: virtual,
    itemHeight: itemHeight,
    prefixCls: "".concat(prefixCls, "-list"),
    ref: listRef,
    onVisibleChange: function onVisibleChange(originList) {
      // The best match is using `fullList` - `originList` = `restList`
      // and check the `restList` to see if has the MOTION_KEY node
      // but this will cause performance issue for long list compare
      // we just check `originList` and repeat trigger `onMotionEnd`
      if (originList.every(function (item) {
        return itemKey(item) !== MOTION_KEY;
      })) {
        onMotionEnd();
      }
    }
  }), function (treeNode) {
    var pos = treeNode.pos,
      restProps = Object.assign({}, (_objectDestructuringEmpty(treeNode.data), treeNode.data)),
      title = treeNode.title,
      key = treeNode.key,
      isStart = treeNode.isStart,
      isEnd = treeNode.isEnd;
    var mergedKey = getKey(key, pos);
    delete restProps.key;
    delete restProps.children;
    var treeNodeProps = getTreeNodeProps(mergedKey, treeNodeRequiredProps);
    return /*#__PURE__*/react.createElement(es_MotionTreeNode, (0,esm_extends/* default */.A)({}, restProps, treeNodeProps, {
      title: title,
      active: !!activeItem && key === activeItem.key,
      pos: pos,
      data: treeNode.data,
      isStart: isStart,
      isEnd: isEnd,
      motion: motion,
      motionNodes: key === MOTION_KEY ? transitionRange : null,
      motionType: motionType,
      onMotionStart: onListChangeStart,
      onMotionEnd: onMotionEnd,
      treeNodeRequiredProps: treeNodeRequiredProps,
      onMouseMove: function onMouseMove() {
        onActiveChange(null);
      }
    }));
  }));
});
NodeList.displayName = 'NodeList';
/* harmony default export */ var es_NodeList = (NodeList);
;// ./node_modules/rc-tree/es/Tree.js










// TODO: https://www.w3.org/TR/2017/NOTE-wai-aria-practices-1.1-20171214/examples/treeview/treeview-2/treeview-2a.html
// Fully accessibility support














var MAX_RETRY_TIMES = 10;
var Tree = /*#__PURE__*/function (_React$Component) {
  (0,inherits/* default */.A)(Tree, _React$Component);
  var _super = (0,createSuper/* default */.A)(Tree);
  function Tree() {
    var _this;
    (0,classCallCheck/* default */.A)(this, Tree);
    for (var _len = arguments.length, _args = new Array(_len), _key = 0; _key < _len; _key++) {
      _args[_key] = arguments[_key];
    }
    _this = _super.call.apply(_super, [this].concat(_args));
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "destroyed", false);
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "delayedDragEnterLogic", void 0);
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "loadingRetryTimes", {});
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "state", {
      keyEntities: {},
      indent: null,
      selectedKeys: [],
      checkedKeys: [],
      halfCheckedKeys: [],
      loadedKeys: [],
      loadingKeys: [],
      expandedKeys: [],
      draggingNodeKey: null,
      dragChildrenKeys: [],
      // dropTargetKey is the key of abstract-drop-node
      // the abstract-drop-node is the real drop node when drag and drop
      // not the DOM drag over node
      dropTargetKey: null,
      dropPosition: null,
      // the drop position of abstract-drop-node, inside 0, top -1, bottom 1
      dropContainerKey: null,
      // the container key of abstract-drop-node if dropPosition is -1 or 1
      dropLevelOffset: null,
      // the drop level offset of abstract-drag-over-node
      dropTargetPos: null,
      // the pos of abstract-drop-node
      dropAllowed: true,
      // if drop to abstract-drop-node is allowed
      // the abstract-drag-over-node
      // if mouse is on the bottom of top dom node or no the top of the bottom dom node
      // abstract-drag-over-node is the top node
      dragOverNodeKey: null,
      treeData: [],
      flattenNodes: [],
      focused: false,
      activeKey: null,
      listChanging: false,
      prevProps: null,
      fieldNames: fillFieldNames()
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "dragStartMousePosition", null);
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "dragNode", void 0);
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "currentMouseOverDroppableNodeKey", null);
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "listRef", /*#__PURE__*/react.createRef());
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeDragStart", function (event, node) {
      var _this$state = _this.state,
        expandedKeys = _this$state.expandedKeys,
        keyEntities = _this$state.keyEntities;
      var onDragStart = _this.props.onDragStart;
      var eventKey = node.props.eventKey;
      _this.dragNode = node;
      _this.dragStartMousePosition = {
        x: event.clientX,
        y: event.clientY
      };
      var newExpandedKeys = arrDel(expandedKeys, eventKey);
      _this.setState({
        draggingNodeKey: eventKey,
        dragChildrenKeys: getDragChildrenKeys(eventKey, keyEntities),
        indent: _this.listRef.current.getIndentWidth()
      });
      _this.setExpandedKeys(newExpandedKeys);
      window.addEventListener('dragend', _this.onWindowDragEnd);
      onDragStart === null || onDragStart === void 0 || onDragStart({
        event: event,
        node: convertNodePropsToEventData(node.props)
      });
    });
    /**
     * [Legacy] Select handler is smaller than node,
     * so that this will trigger when drag enter node or select handler.
     * This is a little tricky if customize css without padding.
     * Better for use mouse move event to refresh drag state.
     * But let's just keep it to avoid event trigger logic change.
     */
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeDragEnter", function (event, node) {
      var _this$state2 = _this.state,
        expandedKeys = _this$state2.expandedKeys,
        keyEntities = _this$state2.keyEntities,
        dragChildrenKeys = _this$state2.dragChildrenKeys,
        flattenNodes = _this$state2.flattenNodes,
        indent = _this$state2.indent;
      var _this$props = _this.props,
        onDragEnter = _this$props.onDragEnter,
        onExpand = _this$props.onExpand,
        allowDrop = _this$props.allowDrop,
        direction = _this$props.direction;
      var _node$props = node.props,
        pos = _node$props.pos,
        eventKey = _node$props.eventKey;
      var _assertThisInitialize = (0,assertThisInitialized/* default */.A)(_this),
        dragNode = _assertThisInitialize.dragNode;

      // record the key of node which is latest entered, used in dragleave event.
      if (_this.currentMouseOverDroppableNodeKey !== eventKey) {
        _this.currentMouseOverDroppableNodeKey = eventKey;
      }
      if (!dragNode) {
        _this.resetDragState();
        return;
      }
      var _calcDropPosition = calcDropPosition(event, dragNode, node, indent, _this.dragStartMousePosition, allowDrop, flattenNodes, keyEntities, expandedKeys, direction),
        dropPosition = _calcDropPosition.dropPosition,
        dropLevelOffset = _calcDropPosition.dropLevelOffset,
        dropTargetKey = _calcDropPosition.dropTargetKey,
        dropContainerKey = _calcDropPosition.dropContainerKey,
        dropTargetPos = _calcDropPosition.dropTargetPos,
        dropAllowed = _calcDropPosition.dropAllowed,
        dragOverNodeKey = _calcDropPosition.dragOverNodeKey;
      if (
      // don't allow drop inside its children
      dragChildrenKeys.indexOf(dropTargetKey) !== -1 ||
      // don't allow drop when drop is not allowed caculated by calcDropPosition
      !dropAllowed) {
        _this.resetDragState();
        return;
      }

      // Side effect for delay drag
      if (!_this.delayedDragEnterLogic) {
        _this.delayedDragEnterLogic = {};
      }
      Object.keys(_this.delayedDragEnterLogic).forEach(function (key) {
        clearTimeout(_this.delayedDragEnterLogic[key]);
      });
      if (dragNode.props.eventKey !== node.props.eventKey) {
        // hoist expand logic here
        // since if logic is on the bottom
        // it will be blocked by abstract dragover node check
        //   => if you dragenter from top, you mouse will still be consider as in the top node
        event.persist();
        _this.delayedDragEnterLogic[pos] = window.setTimeout(function () {
          if (_this.state.draggingNodeKey === null) return;
          var newExpandedKeys = (0,toConsumableArray/* default */.A)(expandedKeys);
          var entity = getEntity(keyEntities, node.props.eventKey);
          if (entity && (entity.children || []).length) {
            newExpandedKeys = arrAdd(expandedKeys, node.props.eventKey);
          }
          if (!_this.props.hasOwnProperty('expandedKeys')) {
            _this.setExpandedKeys(newExpandedKeys);
          }
          onExpand === null || onExpand === void 0 || onExpand(newExpandedKeys, {
            node: convertNodePropsToEventData(node.props),
            expanded: true,
            nativeEvent: event.nativeEvent
          });
        }, 800);
      }

      // Skip if drag node is self
      if (dragNode.props.eventKey === dropTargetKey && dropLevelOffset === 0) {
        _this.resetDragState();
        return;
      }

      // Update drag over node and drag state
      _this.setState({
        dragOverNodeKey: dragOverNodeKey,
        dropPosition: dropPosition,
        dropLevelOffset: dropLevelOffset,
        dropTargetKey: dropTargetKey,
        dropContainerKey: dropContainerKey,
        dropTargetPos: dropTargetPos,
        dropAllowed: dropAllowed
      });
      onDragEnter === null || onDragEnter === void 0 || onDragEnter({
        event: event,
        node: convertNodePropsToEventData(node.props),
        expandedKeys: expandedKeys
      });
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeDragOver", function (event, node) {
      var _this$state3 = _this.state,
        dragChildrenKeys = _this$state3.dragChildrenKeys,
        flattenNodes = _this$state3.flattenNodes,
        keyEntities = _this$state3.keyEntities,
        expandedKeys = _this$state3.expandedKeys,
        indent = _this$state3.indent;
      var _this$props2 = _this.props,
        onDragOver = _this$props2.onDragOver,
        allowDrop = _this$props2.allowDrop,
        direction = _this$props2.direction;
      var _assertThisInitialize2 = (0,assertThisInitialized/* default */.A)(_this),
        dragNode = _assertThisInitialize2.dragNode;
      if (!dragNode) {
        return;
      }
      var _calcDropPosition2 = calcDropPosition(event, dragNode, node, indent, _this.dragStartMousePosition, allowDrop, flattenNodes, keyEntities, expandedKeys, direction),
        dropPosition = _calcDropPosition2.dropPosition,
        dropLevelOffset = _calcDropPosition2.dropLevelOffset,
        dropTargetKey = _calcDropPosition2.dropTargetKey,
        dropContainerKey = _calcDropPosition2.dropContainerKey,
        dropAllowed = _calcDropPosition2.dropAllowed,
        dropTargetPos = _calcDropPosition2.dropTargetPos,
        dragOverNodeKey = _calcDropPosition2.dragOverNodeKey;
      if (dragChildrenKeys.indexOf(dropTargetKey) !== -1 || !dropAllowed) {
        // don't allow drop inside its children
        // don't allow drop when drop is not allowed calculated by calcDropPosition
        return;
      }

      // Update drag position

      if (dragNode.props.eventKey === dropTargetKey && dropLevelOffset === 0) {
        if (!(_this.state.dropPosition === null && _this.state.dropLevelOffset === null && _this.state.dropTargetKey === null && _this.state.dropContainerKey === null && _this.state.dropTargetPos === null && _this.state.dropAllowed === false && _this.state.dragOverNodeKey === null)) {
          _this.resetDragState();
        }
      } else if (!(dropPosition === _this.state.dropPosition && dropLevelOffset === _this.state.dropLevelOffset && dropTargetKey === _this.state.dropTargetKey && dropContainerKey === _this.state.dropContainerKey && dropTargetPos === _this.state.dropTargetPos && dropAllowed === _this.state.dropAllowed && dragOverNodeKey === _this.state.dragOverNodeKey)) {
        _this.setState({
          dropPosition: dropPosition,
          dropLevelOffset: dropLevelOffset,
          dropTargetKey: dropTargetKey,
          dropContainerKey: dropContainerKey,
          dropTargetPos: dropTargetPos,
          dropAllowed: dropAllowed,
          dragOverNodeKey: dragOverNodeKey
        });
      }
      onDragOver === null || onDragOver === void 0 || onDragOver({
        event: event,
        node: convertNodePropsToEventData(node.props)
      });
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeDragLeave", function (event, node) {
      // if it is outside the droppable area
      // currentMouseOverDroppableNodeKey will be updated in dragenter event when into another droppable receiver.
      if (_this.currentMouseOverDroppableNodeKey === node.props.eventKey && !event.currentTarget.contains(event.relatedTarget)) {
        _this.resetDragState();
        _this.currentMouseOverDroppableNodeKey = null;
      }
      var onDragLeave = _this.props.onDragLeave;
      onDragLeave === null || onDragLeave === void 0 || onDragLeave({
        event: event,
        node: convertNodePropsToEventData(node.props)
      });
    });
    // since stopPropagation() is called in treeNode
    // if onWindowDrag is called, whice means state is keeped, drag state should be cleared
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onWindowDragEnd", function (event) {
      _this.onNodeDragEnd(event, null, true);
      window.removeEventListener('dragend', _this.onWindowDragEnd);
    });
    // if onNodeDragEnd is called, onWindowDragEnd won't be called since stopPropagation() is called
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeDragEnd", function (event, node) {
      var onDragEnd = _this.props.onDragEnd;
      _this.setState({
        dragOverNodeKey: null
      });
      _this.cleanDragState();
      onDragEnd === null || onDragEnd === void 0 || onDragEnd({
        event: event,
        node: convertNodePropsToEventData(node.props)
      });
      _this.dragNode = null;
      window.removeEventListener('dragend', _this.onWindowDragEnd);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeDrop", function (event, node) {
      var _this$getActiveItem;
      var outsideTree = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
      var _this$state4 = _this.state,
        dragChildrenKeys = _this$state4.dragChildrenKeys,
        dropPosition = _this$state4.dropPosition,
        dropTargetKey = _this$state4.dropTargetKey,
        dropTargetPos = _this$state4.dropTargetPos,
        dropAllowed = _this$state4.dropAllowed;
      if (!dropAllowed) return;
      var onDrop = _this.props.onDrop;
      _this.setState({
        dragOverNodeKey: null
      });
      _this.cleanDragState();
      if (dropTargetKey === null) return;
      var abstractDropNodeProps = (0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, getTreeNodeProps(dropTargetKey, _this.getTreeNodeRequiredProps())), {}, {
        active: ((_this$getActiveItem = _this.getActiveItem()) === null || _this$getActiveItem === void 0 ? void 0 : _this$getActiveItem.key) === dropTargetKey,
        data: getEntity(_this.state.keyEntities, dropTargetKey).node
      });
      var dropToChild = dragChildrenKeys.indexOf(dropTargetKey) !== -1;
      (0,es_warning/* default */.Ay)(!dropToChild, "Can not drop to dragNode's children node. This is a bug of rc-tree. Please report an issue.");
      var posArr = posToArr(dropTargetPos);
      var dropResult = {
        event: event,
        node: convertNodePropsToEventData(abstractDropNodeProps),
        dragNode: _this.dragNode ? convertNodePropsToEventData(_this.dragNode.props) : null,
        dragNodesKeys: [_this.dragNode.props.eventKey].concat(dragChildrenKeys),
        dropToGap: dropPosition !== 0,
        dropPosition: dropPosition + Number(posArr[posArr.length - 1])
      };
      if (!outsideTree) {
        onDrop === null || onDrop === void 0 || onDrop(dropResult);
      }
      _this.dragNode = null;
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "cleanDragState", function () {
      var draggingNodeKey = _this.state.draggingNodeKey;
      if (draggingNodeKey !== null) {
        _this.setState({
          draggingNodeKey: null,
          dropPosition: null,
          dropContainerKey: null,
          dropTargetKey: null,
          dropLevelOffset: null,
          dropAllowed: true,
          dragOverNodeKey: null
        });
      }
      _this.dragStartMousePosition = null;
      _this.currentMouseOverDroppableNodeKey = null;
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "triggerExpandActionExpand", function (e, treeNode) {
      var _this$state5 = _this.state,
        expandedKeys = _this$state5.expandedKeys,
        flattenNodes = _this$state5.flattenNodes;
      var expanded = treeNode.expanded,
        key = treeNode.key,
        isLeaf = treeNode.isLeaf;
      if (isLeaf || e.shiftKey || e.metaKey || e.ctrlKey) {
        return;
      }
      var node = flattenNodes.filter(function (nodeItem) {
        return nodeItem.key === key;
      })[0];
      var eventNode = convertNodePropsToEventData((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, getTreeNodeProps(key, _this.getTreeNodeRequiredProps())), {}, {
        data: node.data
      }));
      _this.setExpandedKeys(expanded ? arrDel(expandedKeys, key) : arrAdd(expandedKeys, key));
      _this.onNodeExpand(e, eventNode);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeClick", function (e, treeNode) {
      var _this$props3 = _this.props,
        onClick = _this$props3.onClick,
        expandAction = _this$props3.expandAction;
      if (expandAction === 'click') {
        _this.triggerExpandActionExpand(e, treeNode);
      }
      onClick === null || onClick === void 0 || onClick(e, treeNode);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeDoubleClick", function (e, treeNode) {
      var _this$props4 = _this.props,
        onDoubleClick = _this$props4.onDoubleClick,
        expandAction = _this$props4.expandAction;
      if (expandAction === 'doubleClick') {
        _this.triggerExpandActionExpand(e, treeNode);
      }
      onDoubleClick === null || onDoubleClick === void 0 || onDoubleClick(e, treeNode);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeSelect", function (e, treeNode) {
      var selectedKeys = _this.state.selectedKeys;
      var _this$state6 = _this.state,
        keyEntities = _this$state6.keyEntities,
        fieldNames = _this$state6.fieldNames;
      var _this$props5 = _this.props,
        onSelect = _this$props5.onSelect,
        multiple = _this$props5.multiple;
      var selected = treeNode.selected;
      var key = treeNode[fieldNames.key];
      var targetSelected = !selected;

      // Update selected keys
      if (!targetSelected) {
        selectedKeys = arrDel(selectedKeys, key);
      } else if (!multiple) {
        selectedKeys = [key];
      } else {
        selectedKeys = arrAdd(selectedKeys, key);
      }

      // [Legacy] Not found related usage in doc or upper libs
      var selectedNodes = selectedKeys.map(function (selectedKey) {
        var entity = getEntity(keyEntities, selectedKey);
        if (!entity) return null;
        return entity.node;
      }).filter(function (node) {
        return node;
      });
      _this.setUncontrolledState({
        selectedKeys: selectedKeys
      });
      onSelect === null || onSelect === void 0 || onSelect(selectedKeys, {
        event: 'select',
        selected: targetSelected,
        node: treeNode,
        selectedNodes: selectedNodes,
        nativeEvent: e.nativeEvent
      });
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeCheck", function (e, treeNode, checked) {
      var _this$state7 = _this.state,
        keyEntities = _this$state7.keyEntities,
        oriCheckedKeys = _this$state7.checkedKeys,
        oriHalfCheckedKeys = _this$state7.halfCheckedKeys;
      var _this$props6 = _this.props,
        checkStrictly = _this$props6.checkStrictly,
        onCheck = _this$props6.onCheck;
      var key = treeNode.key;

      // Prepare trigger arguments
      var checkedObj;
      var eventObj = {
        event: 'check',
        node: treeNode,
        checked: checked,
        nativeEvent: e.nativeEvent
      };
      if (checkStrictly) {
        var checkedKeys = checked ? arrAdd(oriCheckedKeys, key) : arrDel(oriCheckedKeys, key);
        var halfCheckedKeys = arrDel(oriHalfCheckedKeys, key);
        checkedObj = {
          checked: checkedKeys,
          halfChecked: halfCheckedKeys
        };
        eventObj.checkedNodes = checkedKeys.map(function (checkedKey) {
          return getEntity(keyEntities, checkedKey);
        }).filter(function (entity) {
          return entity;
        }).map(function (entity) {
          return entity.node;
        });
        _this.setUncontrolledState({
          checkedKeys: checkedKeys
        });
      } else {
        // Always fill first
        var _conductCheck = conductCheck([].concat((0,toConsumableArray/* default */.A)(oriCheckedKeys), [key]), true, keyEntities),
          _checkedKeys = _conductCheck.checkedKeys,
          _halfCheckedKeys = _conductCheck.halfCheckedKeys;

        // If remove, we do it again to correction
        if (!checked) {
          var keySet = new Set(_checkedKeys);
          keySet.delete(key);
          var _conductCheck2 = conductCheck(Array.from(keySet), {
            checked: false,
            halfCheckedKeys: _halfCheckedKeys
          }, keyEntities);
          _checkedKeys = _conductCheck2.checkedKeys;
          _halfCheckedKeys = _conductCheck2.halfCheckedKeys;
        }
        checkedObj = _checkedKeys;

        // [Legacy] This is used for `rc-tree-select`
        eventObj.checkedNodes = [];
        eventObj.checkedNodesPositions = [];
        eventObj.halfCheckedKeys = _halfCheckedKeys;
        _checkedKeys.forEach(function (checkedKey) {
          var entity = getEntity(keyEntities, checkedKey);
          if (!entity) return;
          var node = entity.node,
            pos = entity.pos;
          eventObj.checkedNodes.push(node);
          eventObj.checkedNodesPositions.push({
            node: node,
            pos: pos
          });
        });
        _this.setUncontrolledState({
          checkedKeys: _checkedKeys
        }, false, {
          halfCheckedKeys: _halfCheckedKeys
        });
      }
      onCheck === null || onCheck === void 0 || onCheck(checkedObj, eventObj);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeLoad", function (treeNode) {
      var _entity$children;
      var key = treeNode.key;
      var keyEntities = _this.state.keyEntities;

      // Skip if has children already
      var entity = getEntity(keyEntities, key);
      if (entity !== null && entity !== void 0 && (_entity$children = entity.children) !== null && _entity$children !== void 0 && _entity$children.length) {
        return;
      }
      var loadPromise = new Promise(function (resolve, reject) {
        // We need to get the latest state of loading/loaded keys
        _this.setState(function (_ref) {
          var _ref$loadedKeys = _ref.loadedKeys,
            loadedKeys = _ref$loadedKeys === void 0 ? [] : _ref$loadedKeys,
            _ref$loadingKeys = _ref.loadingKeys,
            loadingKeys = _ref$loadingKeys === void 0 ? [] : _ref$loadingKeys;
          var _this$props7 = _this.props,
            loadData = _this$props7.loadData,
            onLoad = _this$props7.onLoad;
          if (!loadData || loadedKeys.indexOf(key) !== -1 || loadingKeys.indexOf(key) !== -1) {
            return null;
          }

          // Process load data
          var promise = loadData(treeNode);
          promise.then(function () {
            var currentLoadedKeys = _this.state.loadedKeys;
            var newLoadedKeys = arrAdd(currentLoadedKeys, key);

            // onLoad should trigger before internal setState to avoid `loadData` trigger twice.
            // https://github.com/ant-design/ant-design/issues/12464
            onLoad === null || onLoad === void 0 || onLoad(newLoadedKeys, {
              event: 'load',
              node: treeNode
            });
            _this.setUncontrolledState({
              loadedKeys: newLoadedKeys
            });
            _this.setState(function (prevState) {
              return {
                loadingKeys: arrDel(prevState.loadingKeys, key)
              };
            });
            resolve();
          }).catch(function (e) {
            _this.setState(function (prevState) {
              return {
                loadingKeys: arrDel(prevState.loadingKeys, key)
              };
            });

            // If exceed max retry times, we give up retry
            _this.loadingRetryTimes[key] = (_this.loadingRetryTimes[key] || 0) + 1;
            if (_this.loadingRetryTimes[key] >= MAX_RETRY_TIMES) {
              var currentLoadedKeys = _this.state.loadedKeys;
              (0,es_warning/* default */.Ay)(false, 'Retry for `loadData` many times but still failed. No more retry.');
              _this.setUncontrolledState({
                loadedKeys: arrAdd(currentLoadedKeys, key)
              });
              resolve();
            }
            reject(e);
          });
          return {
            loadingKeys: arrAdd(loadingKeys, key)
          };
        });
      });

      // Not care warning if we ignore this
      loadPromise.catch(function () {});
      return loadPromise;
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeMouseEnter", function (event, node) {
      var onMouseEnter = _this.props.onMouseEnter;
      onMouseEnter === null || onMouseEnter === void 0 || onMouseEnter({
        event: event,
        node: node
      });
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeMouseLeave", function (event, node) {
      var onMouseLeave = _this.props.onMouseLeave;
      onMouseLeave === null || onMouseLeave === void 0 || onMouseLeave({
        event: event,
        node: node
      });
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeContextMenu", function (event, node) {
      var onRightClick = _this.props.onRightClick;
      if (onRightClick) {
        event.preventDefault();
        onRightClick({
          event: event,
          node: node
        });
      }
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onFocus", function () {
      var onFocus = _this.props.onFocus;
      _this.setState({
        focused: true
      });
      for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }
      onFocus === null || onFocus === void 0 || onFocus.apply(void 0, args);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onBlur", function () {
      var onBlur = _this.props.onBlur;
      _this.setState({
        focused: false
      });
      _this.onActiveChange(null);
      for (var _len3 = arguments.length, args = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
        args[_key3] = arguments[_key3];
      }
      onBlur === null || onBlur === void 0 || onBlur.apply(void 0, args);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "getTreeNodeRequiredProps", function () {
      var _this$state8 = _this.state,
        expandedKeys = _this$state8.expandedKeys,
        selectedKeys = _this$state8.selectedKeys,
        loadedKeys = _this$state8.loadedKeys,
        loadingKeys = _this$state8.loadingKeys,
        checkedKeys = _this$state8.checkedKeys,
        halfCheckedKeys = _this$state8.halfCheckedKeys,
        dragOverNodeKey = _this$state8.dragOverNodeKey,
        dropPosition = _this$state8.dropPosition,
        keyEntities = _this$state8.keyEntities;
      return {
        expandedKeys: expandedKeys || [],
        selectedKeys: selectedKeys || [],
        loadedKeys: loadedKeys || [],
        loadingKeys: loadingKeys || [],
        checkedKeys: checkedKeys || [],
        halfCheckedKeys: halfCheckedKeys || [],
        dragOverNodeKey: dragOverNodeKey,
        dropPosition: dropPosition,
        keyEntities: keyEntities
      };
    });
    // =========================== Expanded ===========================
    /** Set uncontrolled `expandedKeys`. This will also auto update `flattenNodes`. */
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "setExpandedKeys", function (expandedKeys) {
      var _this$state9 = _this.state,
        treeData = _this$state9.treeData,
        fieldNames = _this$state9.fieldNames;
      var flattenNodes = flattenTreeData(treeData, expandedKeys, fieldNames);
      _this.setUncontrolledState({
        expandedKeys: expandedKeys,
        flattenNodes: flattenNodes
      }, true);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onNodeExpand", function (e, treeNode) {
      var expandedKeys = _this.state.expandedKeys;
      var _this$state10 = _this.state,
        listChanging = _this$state10.listChanging,
        fieldNames = _this$state10.fieldNames;
      var _this$props8 = _this.props,
        onExpand = _this$props8.onExpand,
        loadData = _this$props8.loadData;
      var expanded = treeNode.expanded;
      var key = treeNode[fieldNames.key];

      // Do nothing when motion is in progress
      if (listChanging) {
        return;
      }

      // Update selected keys
      var index = expandedKeys.indexOf(key);
      var targetExpanded = !expanded;
      (0,es_warning/* default */.Ay)(expanded && index !== -1 || !expanded && index === -1, 'Expand state not sync with index check');
      if (targetExpanded) {
        expandedKeys = arrAdd(expandedKeys, key);
      } else {
        expandedKeys = arrDel(expandedKeys, key);
      }
      _this.setExpandedKeys(expandedKeys);
      onExpand === null || onExpand === void 0 || onExpand(expandedKeys, {
        node: treeNode,
        expanded: targetExpanded,
        nativeEvent: e.nativeEvent
      });

      // Async Load data
      if (targetExpanded && loadData) {
        var loadPromise = _this.onNodeLoad(treeNode);
        if (loadPromise) {
          loadPromise.then(function () {
            // [Legacy] Refresh logic
            var newFlattenTreeData = flattenTreeData(_this.state.treeData, expandedKeys, fieldNames);
            _this.setUncontrolledState({
              flattenNodes: newFlattenTreeData
            });
          }).catch(function () {
            var currentExpandedKeys = _this.state.expandedKeys;
            var expandedKeysToRestore = arrDel(currentExpandedKeys, key);
            _this.setExpandedKeys(expandedKeysToRestore);
          });
        }
      }
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onListChangeStart", function () {
      _this.setUncontrolledState({
        listChanging: true
      });
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onListChangeEnd", function () {
      setTimeout(function () {
        _this.setUncontrolledState({
          listChanging: false
        });
      });
    });
    // =========================== Keyboard ===========================
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onActiveChange", function (newActiveKey) {
      var activeKey = _this.state.activeKey;
      var _this$props9 = _this.props,
        onActiveChange = _this$props9.onActiveChange,
        _this$props9$itemScro = _this$props9.itemScrollOffset,
        itemScrollOffset = _this$props9$itemScro === void 0 ? 0 : _this$props9$itemScro;
      if (activeKey === newActiveKey) {
        return;
      }
      _this.setState({
        activeKey: newActiveKey
      });
      if (newActiveKey !== null) {
        _this.scrollTo({
          key: newActiveKey,
          offset: itemScrollOffset
        });
      }
      onActiveChange === null || onActiveChange === void 0 || onActiveChange(newActiveKey);
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "getActiveItem", function () {
      var _this$state11 = _this.state,
        activeKey = _this$state11.activeKey,
        flattenNodes = _this$state11.flattenNodes;
      if (activeKey === null) {
        return null;
      }
      return flattenNodes.find(function (_ref2) {
        var key = _ref2.key;
        return key === activeKey;
      }) || null;
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "offsetActiveKey", function (offset) {
      var _this$state12 = _this.state,
        flattenNodes = _this$state12.flattenNodes,
        activeKey = _this$state12.activeKey;
      var index = flattenNodes.findIndex(function (_ref3) {
        var key = _ref3.key;
        return key === activeKey;
      });

      // Align with index
      if (index === -1 && offset < 0) {
        index = flattenNodes.length;
      }
      index = (index + offset + flattenNodes.length) % flattenNodes.length;
      var item = flattenNodes[index];
      if (item) {
        var _key4 = item.key;
        _this.onActiveChange(_key4);
      } else {
        _this.onActiveChange(null);
      }
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "onKeyDown", function (event) {
      var _this$state13 = _this.state,
        activeKey = _this$state13.activeKey,
        expandedKeys = _this$state13.expandedKeys,
        checkedKeys = _this$state13.checkedKeys,
        fieldNames = _this$state13.fieldNames;
      var _this$props10 = _this.props,
        onKeyDown = _this$props10.onKeyDown,
        checkable = _this$props10.checkable,
        selectable = _this$props10.selectable;

      // >>>>>>>>>> Direction
      switch (event.which) {
        case KeyCode/* default */.A.UP:
          {
            _this.offsetActiveKey(-1);
            event.preventDefault();
            break;
          }
        case KeyCode/* default */.A.DOWN:
          {
            _this.offsetActiveKey(1);
            event.preventDefault();
            break;
          }
      }

      // >>>>>>>>>> Expand & Selection
      var activeItem = _this.getActiveItem();
      if (activeItem && activeItem.data) {
        var treeNodeRequiredProps = _this.getTreeNodeRequiredProps();
        var expandable = activeItem.data.isLeaf === false || !!(activeItem.data[fieldNames.children] || []).length;
        var eventNode = convertNodePropsToEventData((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, getTreeNodeProps(activeKey, treeNodeRequiredProps)), {}, {
          data: activeItem.data,
          active: true
        }));
        switch (event.which) {
          // >>> Expand
          case KeyCode/* default */.A.LEFT:
            {
              // Collapse if possible
              if (expandable && expandedKeys.includes(activeKey)) {
                _this.onNodeExpand({}, eventNode);
              } else if (activeItem.parent) {
                _this.onActiveChange(activeItem.parent.key);
              }
              event.preventDefault();
              break;
            }
          case KeyCode/* default */.A.RIGHT:
            {
              // Expand if possible
              if (expandable && !expandedKeys.includes(activeKey)) {
                _this.onNodeExpand({}, eventNode);
              } else if (activeItem.children && activeItem.children.length) {
                _this.onActiveChange(activeItem.children[0].key);
              }
              event.preventDefault();
              break;
            }

          // Selection
          case KeyCode/* default */.A.ENTER:
          case KeyCode/* default */.A.SPACE:
            {
              if (checkable && !eventNode.disabled && eventNode.checkable !== false && !eventNode.disableCheckbox) {
                _this.onNodeCheck({}, eventNode, !checkedKeys.includes(activeKey));
              } else if (!checkable && selectable && !eventNode.disabled && eventNode.selectable !== false) {
                _this.onNodeSelect({}, eventNode);
              }
              break;
            }
        }
      }
      onKeyDown === null || onKeyDown === void 0 || onKeyDown(event);
    });
    /**
     * Only update the value which is not in props
     */
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "setUncontrolledState", function (state) {
      var atomic = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
      var forceState = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;
      if (!_this.destroyed) {
        var needSync = false;
        var allPassed = true;
        var newState = {};
        Object.keys(state).forEach(function (name) {
          if (_this.props.hasOwnProperty(name)) {
            allPassed = false;
            return;
          }
          needSync = true;
          newState[name] = state[name];
        });
        if (needSync && (!atomic || allPassed)) {
          _this.setState((0,objectSpread2/* default */.A)((0,objectSpread2/* default */.A)({}, newState), forceState));
        }
      }
    });
    (0,defineProperty/* default */.A)((0,assertThisInitialized/* default */.A)(_this), "scrollTo", function (scroll) {
      _this.listRef.current.scrollTo(scroll);
    });
    return _this;
  }
  (0,createClass/* default */.A)(Tree, [{
    key: "componentDidMount",
    value: function componentDidMount() {
      this.destroyed = false;
      this.onUpdated();
    }
  }, {
    key: "componentDidUpdate",
    value: function componentDidUpdate() {
      this.onUpdated();
    }
  }, {
    key: "onUpdated",
    value: function onUpdated() {
      var _this$props11 = this.props,
        activeKey = _this$props11.activeKey,
        _this$props11$itemScr = _this$props11.itemScrollOffset,
        itemScrollOffset = _this$props11$itemScr === void 0 ? 0 : _this$props11$itemScr;
      if (activeKey !== undefined && activeKey !== this.state.activeKey) {
        this.setState({
          activeKey: activeKey
        });
        if (activeKey !== null) {
          this.scrollTo({
            key: activeKey,
            offset: itemScrollOffset
          });
        }
      }
    }
  }, {
    key: "componentWillUnmount",
    value: function componentWillUnmount() {
      window.removeEventListener('dragend', this.onWindowDragEnd);
      this.destroyed = true;
    }
  }, {
    key: "resetDragState",
    value: function resetDragState() {
      this.setState({
        dragOverNodeKey: null,
        dropPosition: null,
        dropLevelOffset: null,
        dropTargetKey: null,
        dropContainerKey: null,
        dropTargetPos: null,
        dropAllowed: false
      });
    }
  }, {
    key: "render",
    value: function render() {
      var _this$state14 = this.state,
        focused = _this$state14.focused,
        flattenNodes = _this$state14.flattenNodes,
        keyEntities = _this$state14.keyEntities,
        draggingNodeKey = _this$state14.draggingNodeKey,
        activeKey = _this$state14.activeKey,
        dropLevelOffset = _this$state14.dropLevelOffset,
        dropContainerKey = _this$state14.dropContainerKey,
        dropTargetKey = _this$state14.dropTargetKey,
        dropPosition = _this$state14.dropPosition,
        dragOverNodeKey = _this$state14.dragOverNodeKey,
        indent = _this$state14.indent;
      var _this$props12 = this.props,
        prefixCls = _this$props12.prefixCls,
        className = _this$props12.className,
        style = _this$props12.style,
        showLine = _this$props12.showLine,
        focusable = _this$props12.focusable,
        _this$props12$tabInde = _this$props12.tabIndex,
        tabIndex = _this$props12$tabInde === void 0 ? 0 : _this$props12$tabInde,
        selectable = _this$props12.selectable,
        showIcon = _this$props12.showIcon,
        icon = _this$props12.icon,
        switcherIcon = _this$props12.switcherIcon,
        draggable = _this$props12.draggable,
        checkable = _this$props12.checkable,
        checkStrictly = _this$props12.checkStrictly,
        disabled = _this$props12.disabled,
        motion = _this$props12.motion,
        loadData = _this$props12.loadData,
        filterTreeNode = _this$props12.filterTreeNode,
        height = _this$props12.height,
        itemHeight = _this$props12.itemHeight,
        virtual = _this$props12.virtual,
        titleRender = _this$props12.titleRender,
        dropIndicatorRender = _this$props12.dropIndicatorRender,
        onContextMenu = _this$props12.onContextMenu,
        onScroll = _this$props12.onScroll,
        direction = _this$props12.direction,
        rootClassName = _this$props12.rootClassName,
        rootStyle = _this$props12.rootStyle;
      var domProps = (0,pickAttrs/* default */.A)(this.props, {
        aria: true,
        data: true
      });

      // It's better move to hooks but we just simply keep here
      var draggableConfig;
      if (draggable) {
        if ((0,esm_typeof/* default */.A)(draggable) === 'object') {
          draggableConfig = draggable;
        } else if (typeof draggable === 'function') {
          draggableConfig = {
            nodeDraggable: draggable
          };
        } else {
          draggableConfig = {};
        }
      }
      return /*#__PURE__*/react.createElement(TreeContext.Provider, {
        value: {
          prefixCls: prefixCls,
          selectable: selectable,
          showIcon: showIcon,
          icon: icon,
          switcherIcon: switcherIcon,
          draggable: draggableConfig,
          draggingNodeKey: draggingNodeKey,
          checkable: checkable,
          checkStrictly: checkStrictly,
          disabled: disabled,
          keyEntities: keyEntities,
          dropLevelOffset: dropLevelOffset,
          dropContainerKey: dropContainerKey,
          dropTargetKey: dropTargetKey,
          dropPosition: dropPosition,
          dragOverNodeKey: dragOverNodeKey,
          indent: indent,
          direction: direction,
          dropIndicatorRender: dropIndicatorRender,
          loadData: loadData,
          filterTreeNode: filterTreeNode,
          titleRender: titleRender,
          onNodeClick: this.onNodeClick,
          onNodeDoubleClick: this.onNodeDoubleClick,
          onNodeExpand: this.onNodeExpand,
          onNodeSelect: this.onNodeSelect,
          onNodeCheck: this.onNodeCheck,
          onNodeLoad: this.onNodeLoad,
          onNodeMouseEnter: this.onNodeMouseEnter,
          onNodeMouseLeave: this.onNodeMouseLeave,
          onNodeContextMenu: this.onNodeContextMenu,
          onNodeDragStart: this.onNodeDragStart,
          onNodeDragEnter: this.onNodeDragEnter,
          onNodeDragOver: this.onNodeDragOver,
          onNodeDragLeave: this.onNodeDragLeave,
          onNodeDragEnd: this.onNodeDragEnd,
          onNodeDrop: this.onNodeDrop
        }
      }, /*#__PURE__*/react.createElement("div", {
        role: "tree",
        className: classnames_default()(prefixCls, className, rootClassName, (0,defineProperty/* default */.A)((0,defineProperty/* default */.A)((0,defineProperty/* default */.A)({}, "".concat(prefixCls, "-show-line"), showLine), "".concat(prefixCls, "-focused"), focused), "".concat(prefixCls, "-active-focused"), activeKey !== null)),
        style: rootStyle
      }, /*#__PURE__*/react.createElement(es_NodeList, (0,esm_extends/* default */.A)({
        ref: this.listRef,
        prefixCls: prefixCls,
        style: style,
        data: flattenNodes,
        disabled: disabled,
        selectable: selectable,
        checkable: !!checkable,
        motion: motion,
        dragging: draggingNodeKey !== null,
        height: height,
        itemHeight: itemHeight,
        virtual: virtual,
        focusable: focusable,
        focused: focused,
        tabIndex: tabIndex,
        activeItem: this.getActiveItem(),
        onFocus: this.onFocus,
        onBlur: this.onBlur,
        onKeyDown: this.onKeyDown,
        onActiveChange: this.onActiveChange,
        onListChangeStart: this.onListChangeStart,
        onListChangeEnd: this.onListChangeEnd,
        onContextMenu: onContextMenu,
        onScroll: onScroll
      }, this.getTreeNodeRequiredProps(), domProps))));
    }
  }], [{
    key: "getDerivedStateFromProps",
    value: function getDerivedStateFromProps(props, prevState) {
      var prevProps = prevState.prevProps;
      var newState = {
        prevProps: props
      };
      function needSync(name) {
        return !prevProps && props.hasOwnProperty(name) || prevProps && prevProps[name] !== props[name];
      }

      // ================== Tree Node ==================
      var treeData;

      // fieldNames
      var fieldNames = prevState.fieldNames;
      if (needSync('fieldNames')) {
        fieldNames = fillFieldNames(props.fieldNames);
        newState.fieldNames = fieldNames;
      }

      // Check if `treeData` or `children` changed and save into the state.
      if (needSync('treeData')) {
        treeData = props.treeData;
      } else if (needSync('children')) {
        (0,es_warning/* default */.Ay)(false, '`children` of Tree is deprecated. Please use `treeData` instead.');
        treeData = convertTreeToData(props.children);
      }

      // Save flatten nodes info and convert `treeData` into keyEntities
      if (treeData) {
        newState.treeData = treeData;
        var entitiesMap = convertDataToEntities(treeData, {
          fieldNames: fieldNames
        });
        newState.keyEntities = (0,objectSpread2/* default */.A)((0,defineProperty/* default */.A)({}, MOTION_KEY, MotionEntity), entitiesMap.keyEntities);

        // Warning if treeNode not provide key
        if (false) {}
      }
      var keyEntities = newState.keyEntities || prevState.keyEntities;

      // ================ expandedKeys =================
      if (needSync('expandedKeys') || prevProps && needSync('autoExpandParent')) {
        newState.expandedKeys = props.autoExpandParent || !prevProps && props.defaultExpandParent ? conductExpandParent(props.expandedKeys, keyEntities) : props.expandedKeys;
      } else if (!prevProps && props.defaultExpandAll) {
        var cloneKeyEntities = (0,objectSpread2/* default */.A)({}, keyEntities);
        delete cloneKeyEntities[MOTION_KEY];

        // Only take the key who has the children to enhance the performance
        var nextExpandedKeys = [];
        Object.keys(cloneKeyEntities).forEach(function (key) {
          var entity = cloneKeyEntities[key];
          if (entity.children && entity.children.length) {
            nextExpandedKeys.push(entity.key);
          }
        });
        newState.expandedKeys = nextExpandedKeys;
      } else if (!prevProps && props.defaultExpandedKeys) {
        newState.expandedKeys = props.autoExpandParent || props.defaultExpandParent ? conductExpandParent(props.defaultExpandedKeys, keyEntities) : props.defaultExpandedKeys;
      }
      if (!newState.expandedKeys) {
        delete newState.expandedKeys;
      }

      // ================ flattenNodes =================
      if (treeData || newState.expandedKeys) {
        var flattenNodes = flattenTreeData(treeData || prevState.treeData, newState.expandedKeys || prevState.expandedKeys, fieldNames);
        newState.flattenNodes = flattenNodes;
      }

      // ================ selectedKeys =================
      if (props.selectable) {
        if (needSync('selectedKeys')) {
          newState.selectedKeys = calcSelectedKeys(props.selectedKeys, props);
        } else if (!prevProps && props.defaultSelectedKeys) {
          newState.selectedKeys = calcSelectedKeys(props.defaultSelectedKeys, props);
        }
      }

      // ================= checkedKeys =================
      if (props.checkable) {
        var checkedKeyEntity;
        if (needSync('checkedKeys')) {
          checkedKeyEntity = parseCheckedKeys(props.checkedKeys) || {};
        } else if (!prevProps && props.defaultCheckedKeys) {
          checkedKeyEntity = parseCheckedKeys(props.defaultCheckedKeys) || {};
        } else if (treeData) {
          // If `treeData` changed, we also need check it
          checkedKeyEntity = parseCheckedKeys(props.checkedKeys) || {
            checkedKeys: prevState.checkedKeys,
            halfCheckedKeys: prevState.halfCheckedKeys
          };
        }
        if (checkedKeyEntity) {
          var _checkedKeyEntity = checkedKeyEntity,
            _checkedKeyEntity$che = _checkedKeyEntity.checkedKeys,
            checkedKeys = _checkedKeyEntity$che === void 0 ? [] : _checkedKeyEntity$che,
            _checkedKeyEntity$hal = _checkedKeyEntity.halfCheckedKeys,
            halfCheckedKeys = _checkedKeyEntity$hal === void 0 ? [] : _checkedKeyEntity$hal;
          if (!props.checkStrictly) {
            var conductKeys = conductCheck(checkedKeys, true, keyEntities);
            checkedKeys = conductKeys.checkedKeys;
            halfCheckedKeys = conductKeys.halfCheckedKeys;
          }
          newState.checkedKeys = checkedKeys;
          newState.halfCheckedKeys = halfCheckedKeys;
        }
      }

      // ================= loadedKeys ==================
      if (needSync('loadedKeys')) {
        newState.loadedKeys = props.loadedKeys;
      }
      return newState;
    }
  }]);
  return Tree;
}(react.Component);
(0,defineProperty/* default */.A)(Tree, "defaultProps", {
  prefixCls: 'rc-tree',
  showLine: false,
  showIcon: true,
  selectable: true,
  multiple: false,
  checkable: false,
  disabled: false,
  checkStrictly: false,
  draggable: false,
  defaultExpandParent: true,
  autoExpandParent: false,
  defaultExpandAll: false,
  defaultExpandedKeys: [],
  defaultCheckedKeys: [],
  defaultSelectedKeys: [],
  dropIndicatorRender: DropIndicator,
  allowDrop: function allowDrop() {
    return true;
  },
  expandAction: false
});
(0,defineProperty/* default */.A)(Tree, "TreeNode", es_TreeNode);
/* harmony default export */ var es_Tree = (Tree);
;// ./node_modules/rc-tree/es/index.js



/* harmony default export */ var rc_tree_es = (es_Tree);
;// ./node_modules/@ant-design/icons-svg/es/asn/FileOutlined.js
// This icon file is generated automatically.
var FileOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M854.6 288.6L639.4 73.4c-6-6-14.1-9.4-22.6-9.4H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V311.3c0-8.5-3.4-16.7-9.4-22.7zM790.2 326H602V137.8L790.2 326zm1.8 562H232V136h302v216a42 42 0 0042 42h216v494z" } }] }, "name": "file", "theme": "outlined" };
/* harmony default export */ var asn_FileOutlined = (FileOutlined);

;// ./node_modules/@ant-design/icons/es/icons/FileOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var FileOutlined_FileOutlined = function FileOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_FileOutlined
  }));
};

/**![file](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTg1NC42IDI4OC42TDYzOS40IDczLjRjLTYtNi0xNC4xLTkuNC0yMi42LTkuNEgxOTJjLTE3LjcgMC0zMiAxNC4zLTMyIDMydjgzMmMwIDE3LjcgMTQuMyAzMiAzMiAzMmg2NDBjMTcuNyAwIDMyLTE0LjMgMzItMzJWMzExLjNjMC04LjUtMy40LTE2LjctOS40LTIyLjd6TTc5MC4yIDMyNkg2MDJWMTM3LjhMNzkwLjIgMzI2em0xLjggNTYySDIzMlYxMzZoMzAydjIxNmE0MiA0MiAwIDAwNDIgNDJoMjE2djQ5NHoiIC8+PC9zdmc+) */
var FileOutlined_RefIcon = /*#__PURE__*/react.forwardRef(FileOutlined_FileOutlined);
if (false) {}
/* harmony default export */ var icons_FileOutlined = (FileOutlined_RefIcon);
;// ./node_modules/@ant-design/icons-svg/es/asn/FolderOpenOutlined.js
// This icon file is generated automatically.
var FolderOpenOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M928 444H820V330.4c0-17.7-14.3-32-32-32H473L355.7 186.2a8.15 8.15 0 00-5.5-2.2H96c-17.7 0-32 14.3-32 32v592c0 17.7 14.3 32 32 32h698c13 0 24.8-7.9 29.7-20l134-332c1.5-3.8 2.3-7.9 2.3-12 0-17.7-14.3-32-32-32zM136 256h188.5l119.6 114.4H748V444H238c-13 0-24.8 7.9-29.7 20L136 643.2V256zm635.3 512H159l103.3-256h612.4L771.3 768z" } }] }, "name": "folder-open", "theme": "outlined" };
/* harmony default export */ var asn_FolderOpenOutlined = (FolderOpenOutlined);

;// ./node_modules/@ant-design/icons/es/icons/FolderOpenOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var FolderOpenOutlined_FolderOpenOutlined = function FolderOpenOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_FolderOpenOutlined
  }));
};

/**![folder-open](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTkyOCA0NDRIODIwVjMzMC40YzAtMTcuNy0xNC4zLTMyLTMyLTMySDQ3M0wzNTUuNyAxODYuMmE4LjE1IDguMTUgMCAwMC01LjUtMi4ySDk2Yy0xNy43IDAtMzIgMTQuMy0zMiAzMnY1OTJjMCAxNy43IDE0LjMgMzIgMzIgMzJoNjk4YzEzIDAgMjQuOC03LjkgMjkuNy0yMGwxMzQtMzMyYzEuNS0zLjggMi4zLTcuOSAyLjMtMTIgMC0xNy43LTE0LjMtMzItMzItMzJ6TTEzNiAyNTZoMTg4LjVsMTE5LjYgMTE0LjRINzQ4VjQ0NEgyMzhjLTEzIDAtMjQuOCA3LjktMjkuNyAyMEwxMzYgNjQzLjJWMjU2em02MzUuMyA1MTJIMTU5bDEwMy4zLTI1Nmg2MTIuNEw3NzEuMyA3Njh6IiAvPjwvc3ZnPg==) */
var FolderOpenOutlined_RefIcon = /*#__PURE__*/react.forwardRef(FolderOpenOutlined_FolderOpenOutlined);
if (false) {}
/* harmony default export */ var icons_FolderOpenOutlined = (FolderOpenOutlined_RefIcon);
;// ./node_modules/@ant-design/icons-svg/es/asn/FolderOutlined.js
// This icon file is generated automatically.
var FolderOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M880 298.4H521L403.7 186.2a8.15 8.15 0 00-5.5-2.2H144c-17.7 0-32 14.3-32 32v592c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V330.4c0-17.7-14.3-32-32-32zM840 768H184V256h188.5l119.6 114.4H840V768z" } }] }, "name": "folder", "theme": "outlined" };
/* harmony default export */ var asn_FolderOutlined = (FolderOutlined);

;// ./node_modules/@ant-design/icons/es/icons/FolderOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var FolderOutlined_FolderOutlined = function FolderOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_FolderOutlined
  }));
};

/**![folder](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTg4MCAyOTguNEg1MjFMNDAzLjcgMTg2LjJhOC4xNSA4LjE1IDAgMDAtNS41LTIuMkgxNDRjLTE3LjcgMC0zMiAxNC4zLTMyIDMydjU5MmMwIDE3LjcgMTQuMyAzMiAzMiAzMmg3MzZjMTcuNyAwIDMyLTE0LjMgMzItMzJWMzMwLjRjMC0xNy43LTE0LjMtMzItMzItMzJ6TTg0MCA3NjhIMTg0VjI1NmgxODguNWwxMTkuNiAxMTQuNEg4NDBWNzY4eiIgLz48L3N2Zz4=) */
var FolderOutlined_RefIcon = /*#__PURE__*/react.forwardRef(FolderOutlined_FolderOutlined);
if (false) {}
/* harmony default export */ var icons_FolderOutlined = (FolderOutlined_RefIcon);
;// ./node_modules/@ant-design/icons-svg/es/asn/HolderOutlined.js
// This icon file is generated automatically.
var HolderOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M300 276.5a56 56 0 1056-97 56 56 0 00-56 97zm0 284a56 56 0 1056-97 56 56 0 00-56 97zM640 228a56 56 0 10112 0 56 56 0 00-112 0zm0 284a56 56 0 10112 0 56 56 0 00-112 0zM300 844.5a56 56 0 1056-97 56 56 0 00-56 97zM640 796a56 56 0 10112 0 56 56 0 00-112 0z" } }] }, "name": "holder", "theme": "outlined" };
/* harmony default export */ var asn_HolderOutlined = (HolderOutlined);

;// ./node_modules/@ant-design/icons/es/icons/HolderOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var HolderOutlined_HolderOutlined = function HolderOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_HolderOutlined
  }));
};

/**![holder](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTMwMCAyNzYuNWE1NiA1NiAwIDEwNTYtOTcgNTYgNTYgMCAwMC01NiA5N3ptMCAyODRhNTYgNTYgMCAxMDU2LTk3IDU2IDU2IDAgMDAtNTYgOTd6TTY0MCAyMjhhNTYgNTYgMCAxMDExMiAwIDU2IDU2IDAgMDAtMTEyIDB6bTAgMjg0YTU2IDU2IDAgMTAxMTIgMCA1NiA1NiAwIDAwLTExMiAwek0zMDAgODQ0LjVhNTYgNTYgMCAxMDU2LTk3IDU2IDU2IDAgMDAtNTYgOTd6TTY0MCA3OTZhNTYgNTYgMCAxMDExMiAwIDU2IDU2IDAgMDAtMTEyIDB6IiAvPjwvc3ZnPg==) */
var HolderOutlined_RefIcon = /*#__PURE__*/react.forwardRef(HolderOutlined_HolderOutlined);
if (false) {}
/* harmony default export */ var icons_HolderOutlined = (HolderOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/motion.js
var _util_motion = __webpack_require__(23723);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/collapse.js
var collapse = __webpack_require__(60977);
;// ./node_modules/antd/es/tree/style/directory.js
// ============================ Directory =============================
const genDirectoryStyle = _ref => {
  let {
    treeCls,
    treeNodeCls,
    directoryNodeSelectedBg,
    directoryNodeSelectedColor,
    motionDurationMid,
    borderRadius,
    controlItemBgHover
  } = _ref;
  return {
    [`${treeCls}${treeCls}-directory ${treeNodeCls}`]: {
      // >>> Title
      [`${treeCls}-node-content-wrapper`]: {
        position: 'static',
        [`> *:not(${treeCls}-drop-indicator)`]: {
          position: 'relative'
        },
        '&:hover': {
          background: 'transparent'
        },
        // Expand interactive area to whole line
        '&:before': {
          position: 'absolute',
          inset: 0,
          transition: `background-color ${motionDurationMid}`,
          content: '""',
          borderRadius
        },
        '&:hover:before': {
          background: controlItemBgHover
        }
      },
      [`${treeCls}-switcher, ${treeCls}-checkbox, ${treeCls}-draggable-icon`]: {
        zIndex: 1
      },
      // ============= Selected =============
      '&-selected': {
        [`${treeCls}-switcher, ${treeCls}-draggable-icon`]: {
          color: directoryNodeSelectedColor
        },
        // >>> Title
        [`${treeCls}-node-content-wrapper`]: {
          color: directoryNodeSelectedColor,
          background: 'transparent',
          '&:before, &:hover:before': {
            background: directoryNodeSelectedBg
          }
        }
      }
    }
  };
};
;// ./node_modules/antd/es/tree/style/index.js






// ============================ Keyframes =============================
const treeNodeFX = new cssinjs_es/* Keyframes */.Mo('ant-tree-node-fx-do-not-use', {
  '0%': {
    opacity: 0
  },
  '100%': {
    opacity: 1
  }
});
// ============================== Switch ==============================
const getSwitchStyle = (prefixCls, token) => ({
  [`.${prefixCls}-switcher-icon`]: {
    display: 'inline-block',
    fontSize: 10,
    verticalAlign: 'baseline',
    svg: {
      transition: `transform ${token.motionDurationSlow}`
    }
  }
});
// =============================== Drop ===============================
const getDropIndicatorStyle = (prefixCls, token) => ({
  [`.${prefixCls}-drop-indicator`]: {
    position: 'absolute',
    // it should displayed over the following node
    zIndex: 1,
    height: 2,
    backgroundColor: token.colorPrimary,
    borderRadius: 1,
    pointerEvents: 'none',
    '&:after': {
      position: 'absolute',
      top: -3,
      insetInlineStart: -6,
      width: 8,
      height: 8,
      backgroundColor: 'transparent',
      border: `${(0,cssinjs_es/* unit */.zA)(token.lineWidthBold)} solid ${token.colorPrimary}`,
      borderRadius: '50%',
      content: '""'
    }
  }
});
const genBaseStyle = (prefixCls, token) => {
  const {
    treeCls,
    treeNodeCls,
    treeNodePadding,
    titleHeight,
    indentSize,
    nodeSelectedBg,
    nodeHoverBg,
    colorTextQuaternary
  } = token;
  return {
    [treeCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      background: token.colorBgContainer,
      borderRadius: token.borderRadius,
      transition: `background-color ${token.motionDurationSlow}`,
      '&-rtl': {
        direction: 'rtl'
      },
      [`&${treeCls}-rtl ${treeCls}-switcher_close ${treeCls}-switcher-icon svg`]: {
        transform: 'rotate(90deg)'
      },
      [`&-focused:not(:hover):not(${treeCls}-active-focused)`]: Object.assign({}, (0,style/* genFocusOutline */.jk)(token)),
      // =================== Virtual List ===================
      [`${treeCls}-list-holder-inner`]: {
        alignItems: 'flex-start'
      },
      [`&${treeCls}-block-node`]: {
        [`${treeCls}-list-holder-inner`]: {
          alignItems: 'stretch',
          // >>> Title
          [`${treeCls}-node-content-wrapper`]: {
            flex: 'auto'
          },
          // >>> Drag
          [`${treeNodeCls}.dragging:after`]: {
            position: 'absolute',
            inset: 0,
            border: `1px solid ${token.colorPrimary}`,
            opacity: 0,
            animationName: treeNodeFX,
            animationDuration: token.motionDurationSlow,
            animationPlayState: 'running',
            animationFillMode: 'forwards',
            content: '""',
            pointerEvents: 'none',
            borderRadius: token.borderRadius
          }
        }
      },
      // ===================== TreeNode =====================
      [treeNodeCls]: {
        display: 'flex',
        alignItems: 'flex-start',
        marginBottom: treeNodePadding,
        lineHeight: (0,cssinjs_es/* unit */.zA)(titleHeight),
        position: 'relative',
        // 非常重要，避免 drop-indicator 在拖拽过程中闪烁
        '&:before': {
          content: '""',
          position: 'absolute',
          zIndex: 1,
          insetInlineStart: 0,
          width: '100%',
          top: '100%',
          height: treeNodePadding
        },
        // Disabled
        [`&-disabled ${treeCls}-node-content-wrapper`]: {
          color: token.colorTextDisabled,
          cursor: 'not-allowed',
          '&:hover': {
            background: 'transparent'
          }
        },
        // not disable
        [`&:not(${treeNodeCls}-disabled)`]: {
          // >>> Title
          [`${treeCls}-node-content-wrapper`]: {
            '&:hover': {
              color: token.nodeHoverColor
            }
          }
        },
        [`&-active ${treeCls}-node-content-wrapper`]: {
          background: token.controlItemBgHover
        },
        [`&:not(${treeNodeCls}-disabled).filter-node ${treeCls}-title`]: {
          color: token.colorPrimary,
          fontWeight: 500
        },
        '&-draggable': {
          cursor: 'grab',
          [`${treeCls}-draggable-icon`]: {
            // https://github.com/ant-design/ant-design/issues/41915
            flexShrink: 0,
            width: titleHeight,
            textAlign: 'center',
            visibility: 'visible',
            color: colorTextQuaternary
          },
          [`&${treeNodeCls}-disabled ${treeCls}-draggable-icon`]: {
            visibility: 'hidden'
          }
        }
      },
      // >>> Indent
      [`${treeCls}-indent`]: {
        alignSelf: 'stretch',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        '&-unit': {
          display: 'inline-block',
          width: indentSize
        }
      },
      // >>> Drag Handler
      [`${treeCls}-draggable-icon`]: {
        visibility: 'hidden'
      },
      // Switcher / Checkbox
      [`${treeCls}-switcher, ${treeCls}-checkbox`]: {
        marginInlineEnd: token.calc(token.calc(titleHeight).sub(token.controlInteractiveSize)).div(2).equal()
      },
      // >>> Switcher
      [`${treeCls}-switcher`]: Object.assign(Object.assign({}, getSwitchStyle(prefixCls, token)), {
        position: 'relative',
        flex: 'none',
        alignSelf: 'stretch',
        width: titleHeight,
        textAlign: 'center',
        cursor: 'pointer',
        userSelect: 'none',
        transition: `all ${token.motionDurationSlow}`,
        '&-noop': {
          cursor: 'unset'
        },
        '&:before': {
          pointerEvents: 'none',
          content: '""',
          width: titleHeight,
          height: titleHeight,
          position: 'absolute',
          left: {
            _skip_check_: true,
            value: 0
          },
          top: 0,
          borderRadius: token.borderRadius,
          transition: `all ${token.motionDurationSlow}`
        },
        [`&:not(${treeCls}-switcher-noop):hover:before`]: {
          backgroundColor: token.colorBgTextHover
        },
        [`&_close ${treeCls}-switcher-icon svg`]: {
          transform: 'rotate(-90deg)'
        },
        '&-loading-icon': {
          color: token.colorPrimary
        },
        '&-leaf-line': {
          position: 'relative',
          zIndex: 1,
          display: 'inline-block',
          width: '100%',
          height: '100%',
          // https://github.com/ant-design/ant-design/issues/31884
          '&:before': {
            position: 'absolute',
            top: 0,
            insetInlineEnd: token.calc(titleHeight).div(2).equal(),
            bottom: token.calc(treeNodePadding).mul(-1).equal(),
            marginInlineStart: -1,
            borderInlineEnd: `1px solid ${token.colorBorder}`,
            content: '""'
          },
          '&:after': {
            position: 'absolute',
            width: token.calc(token.calc(titleHeight).div(2).equal()).mul(0.8).equal(),
            height: token.calc(titleHeight).div(2).equal(),
            borderBottom: `1px solid ${token.colorBorder}`,
            content: '""'
          }
        }
      }),
      // >>> Title
      // add `${treeCls}-checkbox + span` to cover checkbox `${checkboxCls} + span`
      [`${treeCls}-node-content-wrapper`]: Object.assign(Object.assign({
        position: 'relative',
        minHeight: titleHeight,
        paddingBlock: 0,
        paddingInline: token.paddingXS,
        background: 'transparent',
        borderRadius: token.borderRadius,
        cursor: 'pointer',
        transition: `all ${token.motionDurationMid}, border 0s, line-height 0s, box-shadow 0s`
      }, getDropIndicatorStyle(prefixCls, token)), {
        '&:hover': {
          backgroundColor: nodeHoverBg
        },
        [`&${treeCls}-node-selected`]: {
          color: token.nodeSelectedColor,
          backgroundColor: nodeSelectedBg
        },
        // Icon
        [`${treeCls}-iconEle`]: {
          display: 'inline-block',
          width: titleHeight,
          height: titleHeight,
          textAlign: 'center',
          verticalAlign: 'top',
          '&:empty': {
            display: 'none'
          }
        }
      }),
      // https://github.com/ant-design/ant-design/issues/28217
      [`${treeCls}-unselectable ${treeCls}-node-content-wrapper:hover`]: {
        backgroundColor: 'transparent'
      },
      [`${treeNodeCls}.drop-container > [draggable]`]: {
        boxShadow: `0 0 0 2px ${token.colorPrimary}`
      },
      // ==================== Show Line =====================
      '&-show-line': {
        // ================ Indent lines ================
        [`${treeCls}-indent-unit`]: {
          position: 'relative',
          height: '100%',
          '&:before': {
            position: 'absolute',
            top: 0,
            insetInlineEnd: token.calc(titleHeight).div(2).equal(),
            bottom: token.calc(treeNodePadding).mul(-1).equal(),
            borderInlineEnd: `1px solid ${token.colorBorder}`,
            content: '""'
          },
          '&-end:before': {
            display: 'none'
          }
        },
        // ============== Cover Background ==============
        [`${treeCls}-switcher`]: {
          background: 'transparent',
          '&-line-icon': {
            // https://github.com/ant-design/ant-design/issues/32813
            verticalAlign: '-0.15em'
          }
        }
      },
      [`${treeNodeCls}-leaf-last ${treeCls}-switcher-leaf-line:before`]: {
        top: 'auto !important',
        bottom: 'auto !important',
        height: `${(0,cssinjs_es/* unit */.zA)(token.calc(titleHeight).div(2).equal())} !important`
      }
    })
  };
};
// ============================== Merged ==============================
const genTreeStyle = (prefixCls, token) => {
  const treeCls = `.${prefixCls}`;
  const treeNodeCls = `${treeCls}-treenode`;
  const treeNodePadding = token.calc(token.paddingXS).div(2).equal();
  const treeToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    treeCls,
    treeNodeCls,
    treeNodePadding
  });
  return [
  // Basic
  genBaseStyle(prefixCls, treeToken),
  // Directory
  genDirectoryStyle(treeToken)];
};
const initComponentToken = token => {
  const {
    controlHeightSM,
    controlItemBgHover,
    controlItemBgActive
  } = token;
  const titleHeight = controlHeightSM;
  return {
    titleHeight,
    indentSize: titleHeight,
    nodeHoverBg: controlItemBgHover,
    nodeHoverColor: token.colorText,
    nodeSelectedBg: controlItemBgActive,
    nodeSelectedColor: token.colorText
  };
};
const style_prepareComponentToken = token => {
  const {
    colorTextLightSolid,
    colorPrimary
  } = token;
  return Object.assign(Object.assign({}, initComponentToken(token)), {
    directoryNodeSelectedColor: colorTextLightSolid,
    directoryNodeSelectedBg: colorPrimary
  });
};
/* harmony default export */ var tree_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Tree', (token, _ref) => {
  let {
    prefixCls
  } = _ref;
  return [{
    [token.componentCls]: getStyle(`${prefixCls}-checkbox`, token)
  }, genTreeStyle(prefixCls, token), (0,collapse/* default */.A)(token)];
}, style_prepareComponentToken));
;// ./node_modules/antd/es/tree/utils/dropIndicator.js
"use client";


const offset = 4;
function dropIndicatorRender(props) {
  const {
    dropPosition,
    dropLevelOffset,
    prefixCls,
    indent,
    direction = 'ltr'
  } = props;
  const startPosition = direction === 'ltr' ? 'left' : 'right';
  const endPosition = direction === 'ltr' ? 'right' : 'left';
  const style = {
    [startPosition]: -dropLevelOffset * indent + offset,
    [endPosition]: 0
  };
  switch (dropPosition) {
    case -1:
      style.top = -3;
      break;
    case 1:
      style.bottom = -3;
      break;
    default:
      // dropPosition === 0
      style.bottom = -3;
      style[startPosition] = indent + offset;
      break;
  }
  return /*#__PURE__*/react.createElement("div", {
    style: style,
    className: `${prefixCls}-drop-indicator`
  });
}
/* harmony default export */ var dropIndicator = (dropIndicatorRender);
;// ./node_modules/@ant-design/icons-svg/es/asn/CaretDownFilled.js
// This icon file is generated automatically.
var CaretDownFilled = { "icon": { "tag": "svg", "attrs": { "viewBox": "0 0 1024 1024", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M840.4 300H183.6c-19.7 0-30.7 20.8-18.5 35l328.4 380.8c9.4 10.9 27.5 10.9 37 0L858.9 335c12.2-14.2 1.2-35-18.5-35z" } }] }, "name": "caret-down", "theme": "filled" };
/* harmony default export */ var asn_CaretDownFilled = (CaretDownFilled);

;// ./node_modules/@ant-design/icons/es/icons/CaretDownFilled.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var CaretDownFilled_CaretDownFilled = function CaretDownFilled(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_CaretDownFilled
  }));
};

/**![caret-down](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTg0MC40IDMwMEgxODMuNmMtMTkuNyAwLTMwLjcgMjAuOC0xOC41IDM1bDMyOC40IDM4MC44YzkuNCAxMC45IDI3LjUgMTAuOSAzNyAwTDg1OC45IDMzNWMxMi4yLTE0LjIgMS4yLTM1LTE4LjUtMzV6IiAvPjwvc3ZnPg==) */
var CaretDownFilled_RefIcon = /*#__PURE__*/react.forwardRef(CaretDownFilled_CaretDownFilled);
if (false) {}
/* harmony default export */ var icons_CaretDownFilled = (CaretDownFilled_RefIcon);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/LoadingOutlined.js + 1 modules
var LoadingOutlined = __webpack_require__(93567);
;// ./node_modules/@ant-design/icons-svg/es/asn/MinusSquareOutlined.js
// This icon file is generated automatically.
var MinusSquareOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M328 544h368c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H328c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8z" } }, { "tag": "path", "attrs": { "d": "M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zm-40 728H184V184h656v656z" } }] }, "name": "minus-square", "theme": "outlined" };
/* harmony default export */ var asn_MinusSquareOutlined = (MinusSquareOutlined);

;// ./node_modules/@ant-design/icons/es/icons/MinusSquareOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var MinusSquareOutlined_MinusSquareOutlined = function MinusSquareOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_MinusSquareOutlined
  }));
};

/**![minus-square](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTMyOCA1NDRoMzY4YzQuNCAwIDgtMy42IDgtOHYtNDhjMC00LjQtMy42LTgtOC04SDMyOGMtNC40IDAtOCAzLjYtOCA4djQ4YzAgNC40IDMuNiA4IDggOHoiIC8+PHBhdGggZD0iTTg4MCAxMTJIMTQ0Yy0xNy43IDAtMzIgMTQuMy0zMiAzMnY3MzZjMCAxNy43IDE0LjMgMzIgMzIgMzJoNzM2YzE3LjcgMCAzMi0xNC4zIDMyLTMyVjE0NGMwLTE3LjctMTQuMy0zMi0zMi0zMnptLTQwIDcyOEgxODRWMTg0aDY1NnY2NTZ6IiAvPjwvc3ZnPg==) */
var MinusSquareOutlined_RefIcon = /*#__PURE__*/react.forwardRef(MinusSquareOutlined_MinusSquareOutlined);
if (false) {}
/* harmony default export */ var icons_MinusSquareOutlined = (MinusSquareOutlined_RefIcon);
;// ./node_modules/@ant-design/icons-svg/es/asn/PlusSquareOutlined.js
// This icon file is generated automatically.
var PlusSquareOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M328 544h152v152c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V544h152c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H544V328c0-4.4-3.6-8-8-8h-48c-4.4 0-8 3.6-8 8v152H328c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8z" } }, { "tag": "path", "attrs": { "d": "M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zm-40 728H184V184h656v656z" } }] }, "name": "plus-square", "theme": "outlined" };
/* harmony default export */ var asn_PlusSquareOutlined = (PlusSquareOutlined);

;// ./node_modules/@ant-design/icons/es/icons/PlusSquareOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var PlusSquareOutlined_PlusSquareOutlined = function PlusSquareOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_PlusSquareOutlined
  }));
};

/**![plus-square](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTMyOCA1NDRoMTUydjE1MmMwIDQuNCAzLjYgOCA4IDhoNDhjNC40IDAgOC0zLjYgOC04VjU0NGgxNTJjNC40IDAgOC0zLjYgOC04di00OGMwLTQuNC0zLjYtOC04LThINTQ0VjMyOGMwLTQuNC0zLjYtOC04LThoLTQ4Yy00LjQgMC04IDMuNi04IDh2MTUySDMyOGMtNC40IDAtOCAzLjYtOCA4djQ4YzAgNC40IDMuNiA4IDggOHoiIC8+PHBhdGggZD0iTTg4MCAxMTJIMTQ0Yy0xNy43IDAtMzIgMTQuMy0zMiAzMnY3MzZjMCAxNy43IDE0LjMgMzIgMzIgMzJoNzM2YzE3LjcgMCAzMi0xNC4zIDMyLTMyVjE0NGMwLTE3LjctMTQuMy0zMi0zMi0zMnptLTQwIDcyOEgxODRWMTg0aDY1NnY2NTZ6IiAvPjwvc3ZnPg==) */
var PlusSquareOutlined_RefIcon = /*#__PURE__*/react.forwardRef(PlusSquareOutlined_PlusSquareOutlined);
if (false) {}
/* harmony default export */ var icons_PlusSquareOutlined = (PlusSquareOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/reactNode.js
var reactNode = __webpack_require__(40682);
;// ./node_modules/antd/es/tree/utils/iconUtil.js
"use client";









const SwitcherIconCom = props => {
  const {
    prefixCls,
    switcherIcon,
    treeNodeProps,
    showLine,
    switcherLoadingIcon
  } = props;
  const {
    isLeaf,
    expanded,
    loading
  } = treeNodeProps;
  if (loading) {
    if (/*#__PURE__*/react.isValidElement(switcherLoadingIcon)) {
      return switcherLoadingIcon;
    }
    return /*#__PURE__*/react.createElement(LoadingOutlined/* default */.A, {
      className: `${prefixCls}-switcher-loading-icon`
    });
  }
  let showLeafIcon;
  if (showLine && typeof showLine === 'object') {
    showLeafIcon = showLine.showLeafIcon;
  }
  if (isLeaf) {
    if (!showLine) {
      return null;
    }
    if (typeof showLeafIcon !== 'boolean' && !!showLeafIcon) {
      const leafIcon = typeof showLeafIcon === 'function' ? showLeafIcon(treeNodeProps) : showLeafIcon;
      const leafCls = `${prefixCls}-switcher-line-custom-icon`;
      if (/*#__PURE__*/react.isValidElement(leafIcon)) {
        return (0,reactNode/* cloneElement */.Ob)(leafIcon, {
          className: classnames_default()(leafIcon.props.className || '', leafCls)
        });
      }
      return leafIcon;
    }
    return showLeafIcon ? (/*#__PURE__*/react.createElement(icons_FileOutlined, {
      className: `${prefixCls}-switcher-line-icon`
    })) : (/*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-switcher-leaf-line`
    }));
  }
  const switcherCls = `${prefixCls}-switcher-icon`;
  const switcher = typeof switcherIcon === 'function' ? switcherIcon(treeNodeProps) : switcherIcon;
  if (/*#__PURE__*/react.isValidElement(switcher)) {
    return (0,reactNode/* cloneElement */.Ob)(switcher, {
      className: classnames_default()(switcher.props.className || '', switcherCls)
    });
  }
  if (switcher !== undefined) {
    return switcher;
  }
  if (showLine) {
    return expanded ? (/*#__PURE__*/react.createElement(icons_MinusSquareOutlined, {
      className: `${prefixCls}-switcher-line-icon`
    })) : (/*#__PURE__*/react.createElement(icons_PlusSquareOutlined, {
      className: `${prefixCls}-switcher-line-icon`
    }));
  }
  return /*#__PURE__*/react.createElement(icons_CaretDownFilled, {
    className: switcherCls
  });
};
/* harmony default export */ var iconUtil = (SwitcherIconCom);
;// ./node_modules/antd/es/tree/Tree.js
"use client";











const Tree_Tree = /*#__PURE__*/react.forwardRef((props, ref) => {
  var _a;
  const {
    getPrefixCls,
    direction,
    virtual,
    tree
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const {
    prefixCls: customizePrefixCls,
    className,
    showIcon = false,
    showLine,
    switcherIcon,
    switcherLoadingIcon,
    blockNode = false,
    children,
    checkable = false,
    selectable = true,
    draggable,
    motion: customMotion,
    style
  } = props;
  const prefixCls = getPrefixCls('tree', customizePrefixCls);
  const rootPrefixCls = getPrefixCls();
  const motion = customMotion !== null && customMotion !== void 0 ? customMotion : Object.assign(Object.assign({}, (0,_util_motion/* default */.A)(rootPrefixCls)), {
    motionAppear: false
  });
  const newProps = Object.assign(Object.assign({}, props), {
    checkable,
    selectable,
    showIcon,
    motion,
    blockNode,
    showLine: Boolean(showLine),
    dropIndicatorRender: dropIndicator
  });
  const [wrapCSSVar, hashId, cssVarCls] = tree_style(prefixCls);
  const [, token] = (0,useToken/* default */.Ay)();
  const itemHeight = token.paddingXS / 2 + (((_a = token.Tree) === null || _a === void 0 ? void 0 : _a.titleHeight) || token.controlHeightSM);
  const draggableConfig = react.useMemo(() => {
    if (!draggable) {
      return false;
    }
    let mergedDraggable = {};
    switch (typeof draggable) {
      case 'function':
        mergedDraggable.nodeDraggable = draggable;
        break;
      case 'object':
        mergedDraggable = Object.assign({}, draggable);
        break;
      default:
        break;
      // Do nothing
    }
    if (mergedDraggable.icon !== false) {
      mergedDraggable.icon = mergedDraggable.icon || /*#__PURE__*/react.createElement(icons_HolderOutlined, null);
    }
    return mergedDraggable;
  }, [draggable]);
  const renderSwitcherIcon = nodeProps => (/*#__PURE__*/react.createElement(iconUtil, {
    prefixCls: prefixCls,
    switcherIcon: switcherIcon,
    switcherLoadingIcon: switcherLoadingIcon,
    treeNodeProps: nodeProps,
    showLine: showLine
  }));
  return wrapCSSVar(
  /*#__PURE__*/
  // @ts-ignore
  react.createElement(rc_tree_es, Object.assign({
    itemHeight: itemHeight,
    ref: ref,
    virtual: virtual
  }, newProps, {
    // newProps may contain style so declare style below it
    style: Object.assign(Object.assign({}, tree === null || tree === void 0 ? void 0 : tree.style), style),
    prefixCls: prefixCls,
    className: classnames_default()({
      [`${prefixCls}-icon-hide`]: !showIcon,
      [`${prefixCls}-block-node`]: blockNode,
      [`${prefixCls}-unselectable`]: !selectable,
      [`${prefixCls}-rtl`]: direction === 'rtl'
    }, tree === null || tree === void 0 ? void 0 : tree.className, className, hashId, cssVarCls),
    direction: direction,
    checkable: checkable ? /*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-checkbox-inner`
    }) : checkable,
    selectable: selectable,
    switcherIcon: renderSwitcherIcon,
    draggable: draggableConfig
  }), children));
});
if (false) {}
/* harmony default export */ var tree_Tree = (Tree_Tree);
;// ./node_modules/antd/es/tree/utils/dictUtil.js


const RECORD_NONE = 0;
const RECORD_START = 1;
const RECORD_END = 2;
function traverseNodesKey(treeData, callback, fieldNames) {
  const {
    key: fieldKey,
    children: fieldChildren
  } = fieldNames;
  function processNode(dataNode) {
    const key = dataNode[fieldKey];
    const children = dataNode[fieldChildren];
    if (callback(key, dataNode) !== false) {
      traverseNodesKey(children || [], callback, fieldNames);
    }
  }
  treeData.forEach(processNode);
}
/** 计算选中范围，只考虑expanded情况以优化性能 */
function calcRangeKeys(_ref) {
  let {
    treeData,
    expandedKeys,
    startKey,
    endKey,
    fieldNames
  } = _ref;
  const keys = [];
  let record = RECORD_NONE;
  if (startKey && startKey === endKey) {
    return [startKey];
  }
  if (!startKey || !endKey) {
    return [];
  }
  function matchKey(key) {
    return key === startKey || key === endKey;
  }
  traverseNodesKey(treeData, key => {
    if (record === RECORD_END) {
      return false;
    }
    if (matchKey(key)) {
      // Match test
      keys.push(key);
      if (record === RECORD_NONE) {
        record = RECORD_START;
      } else if (record === RECORD_START) {
        record = RECORD_END;
        return false;
      }
    } else if (record === RECORD_START) {
      // Append selection
      keys.push(key);
    }
    return expandedKeys.includes(key);
  }, fillFieldNames(fieldNames));
  return keys;
}
function convertDirectoryKeysToNodes(treeData, keys, fieldNames) {
  const restKeys = (0,toConsumableArray/* default */.A)(keys);
  const nodes = [];
  traverseNodesKey(treeData, (key, node) => {
    const index = restKeys.indexOf(key);
    if (index !== -1) {
      nodes.push(node);
      restKeys.splice(index, 1);
    }
    return !!restKeys.length;
  }, fillFieldNames(fieldNames));
  return nodes;
}
;// ./node_modules/antd/es/tree/DirectoryTree.js
"use client";


var DirectoryTree_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};










function getIcon(props) {
  const {
    isLeaf,
    expanded
  } = props;
  if (isLeaf) {
    return /*#__PURE__*/react.createElement(icons_FileOutlined, null);
  }
  return expanded ? /*#__PURE__*/react.createElement(icons_FolderOpenOutlined, null) : /*#__PURE__*/react.createElement(icons_FolderOutlined, null);
}
function getTreeData(_ref) {
  let {
    treeData,
    children
  } = _ref;
  return treeData || convertTreeToData(children);
}
const DirectoryTree = (_a, ref) => {
  var {
      defaultExpandAll,
      defaultExpandParent,
      defaultExpandedKeys
    } = _a,
    props = DirectoryTree_rest(_a, ["defaultExpandAll", "defaultExpandParent", "defaultExpandedKeys"]);
  // Shift click usage
  const lastSelectedKey = react.useRef();
  const cachedSelectedKeys = react.useRef();
  const getInitExpandedKeys = () => {
    const {
      keyEntities
    } = convertDataToEntities(getTreeData(props));
    let initExpandedKeys;
    // Expanded keys
    if (defaultExpandAll) {
      initExpandedKeys = Object.keys(keyEntities);
    } else if (defaultExpandParent) {
      initExpandedKeys = conductExpandParent(props.expandedKeys || defaultExpandedKeys || [], keyEntities);
    } else {
      initExpandedKeys = props.expandedKeys || defaultExpandedKeys || [];
    }
    return initExpandedKeys;
  };
  const [selectedKeys, setSelectedKeys] = react.useState(props.selectedKeys || props.defaultSelectedKeys || []);
  const [expandedKeys, setExpandedKeys] = react.useState(() => getInitExpandedKeys());
  react.useEffect(() => {
    if ('selectedKeys' in props) {
      setSelectedKeys(props.selectedKeys);
    }
  }, [props.selectedKeys]);
  react.useEffect(() => {
    if ('expandedKeys' in props) {
      setExpandedKeys(props.expandedKeys);
    }
  }, [props.expandedKeys]);
  const onExpand = (keys, info) => {
    var _a;
    if (!('expandedKeys' in props)) {
      setExpandedKeys(keys);
    }
    // Call origin function
    return (_a = props.onExpand) === null || _a === void 0 ? void 0 : _a.call(props, keys, info);
  };
  const onSelect = (keys, event) => {
    var _a;
    const {
      multiple,
      fieldNames
    } = props;
    const {
      node,
      nativeEvent
    } = event;
    const {
      key = ''
    } = node;
    const treeData = getTreeData(props);
    // const newState: DirectoryTreeState = {};
    // We need wrap this event since some value is not same
    const newEvent = Object.assign(Object.assign({}, event), {
      selected: true
    });
    // Windows / Mac single pick
    const ctrlPick = (nativeEvent === null || nativeEvent === void 0 ? void 0 : nativeEvent.ctrlKey) || (nativeEvent === null || nativeEvent === void 0 ? void 0 : nativeEvent.metaKey);
    const shiftPick = nativeEvent === null || nativeEvent === void 0 ? void 0 : nativeEvent.shiftKey;
    // Generate new selected keys
    let newSelectedKeys;
    if (multiple && ctrlPick) {
      // Control click
      newSelectedKeys = keys;
      lastSelectedKey.current = key;
      cachedSelectedKeys.current = newSelectedKeys;
      newEvent.selectedNodes = convertDirectoryKeysToNodes(treeData, newSelectedKeys, fieldNames);
    } else if (multiple && shiftPick) {
      // Shift click
      newSelectedKeys = Array.from(new Set([].concat((0,toConsumableArray/* default */.A)(cachedSelectedKeys.current || []), (0,toConsumableArray/* default */.A)(calcRangeKeys({
        treeData,
        expandedKeys,
        startKey: key,
        endKey: lastSelectedKey.current,
        fieldNames
      })))));
      newEvent.selectedNodes = convertDirectoryKeysToNodes(treeData, newSelectedKeys, fieldNames);
    } else {
      // Single click
      newSelectedKeys = [key];
      lastSelectedKey.current = key;
      cachedSelectedKeys.current = newSelectedKeys;
      newEvent.selectedNodes = convertDirectoryKeysToNodes(treeData, newSelectedKeys, fieldNames);
    }
    (_a = props.onSelect) === null || _a === void 0 ? void 0 : _a.call(props, newSelectedKeys, newEvent);
    if (!('selectedKeys' in props)) {
      setSelectedKeys(newSelectedKeys);
    }
  };
  const {
    getPrefixCls,
    direction
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const {
      prefixCls: customizePrefixCls,
      className,
      showIcon = true,
      expandAction = 'click'
    } = props,
    otherProps = DirectoryTree_rest(props, ["prefixCls", "className", "showIcon", "expandAction"]);
  const prefixCls = getPrefixCls('tree', customizePrefixCls);
  const connectClassName = classnames_default()(`${prefixCls}-directory`, {
    [`${prefixCls}-directory-rtl`]: direction === 'rtl'
  }, className);
  return /*#__PURE__*/react.createElement(tree_Tree, Object.assign({
    icon: getIcon,
    ref: ref,
    blockNode: true
  }, otherProps, {
    showIcon: showIcon,
    expandAction: expandAction,
    prefixCls: prefixCls,
    className: connectClassName,
    expandedKeys: expandedKeys,
    selectedKeys: selectedKeys,
    onSelect: onSelect,
    onExpand: onExpand
  }));
};
const ForwardDirectoryTree = /*#__PURE__*/react.forwardRef(DirectoryTree);
if (false) {}
/* harmony default export */ var tree_DirectoryTree = (ForwardDirectoryTree);
;// ./node_modules/antd/es/tree/index.js
"use client";




const es_tree_Tree = tree_Tree;
es_tree_Tree.DirectoryTree = tree_DirectoryTree;
es_tree_Tree.TreeNode = es_TreeNode;
/* harmony default export */ var tree = (es_tree_Tree);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/SearchOutlined.js + 1 modules
var SearchOutlined = __webpack_require__(42877);
// EXTERNAL MODULE: ./node_modules/antd/es/input/index.js + 22 modules
var input = __webpack_require__(46789);
;// ./node_modules/antd/es/table/hooks/useFilter/FilterSearch.js
"use client";




const FilterSearch = props => {
  const {
    value,
    filterSearch,
    tablePrefixCls,
    locale,
    onChange
  } = props;
  if (!filterSearch) {
    return null;
  }
  return /*#__PURE__*/react.createElement("div", {
    className: `${tablePrefixCls}-filter-dropdown-search`
  }, /*#__PURE__*/react.createElement(input/* default */.A, {
    prefix: /*#__PURE__*/react.createElement(SearchOutlined/* default */.A, null),
    placeholder: locale.filterSearchPlaceholder,
    onChange: onChange,
    value: value,
    // for skip min-width of input
    htmlSize: 1,
    className: `${tablePrefixCls}-filter-dropdown-search-input`
  }));
};
/* harmony default export */ var useFilter_FilterSearch = (FilterSearch);
;// ./node_modules/antd/es/table/hooks/useFilter/FilterWrapper.js
"use client";



const onKeyDown = event => {
  const {
    keyCode
  } = event;
  if (keyCode === KeyCode/* default */.A.ENTER) {
    event.stopPropagation();
  }
};
const FilterDropdownMenuWrapper = /*#__PURE__*/react.forwardRef((props, ref) => (/*#__PURE__*/react.createElement("div", {
  className: props.className,
  onClick: e => e.stopPropagation(),
  onKeyDown: onKeyDown,
  ref: ref
}, props.children)));
if (false) {}
/* harmony default export */ var FilterWrapper = (FilterDropdownMenuWrapper);
;// ./node_modules/antd/es/table/hooks/useFilter/FilterDropdown.js
"use client";




















function flattenKeys(filters) {
  let keys = [];
  (filters || []).forEach(_ref => {
    let {
      value,
      children
    } = _ref;
    keys.push(value);
    if (children) {
      keys = [].concat((0,toConsumableArray/* default */.A)(keys), (0,toConsumableArray/* default */.A)(flattenKeys(children)));
    }
  });
  return keys;
}
function hasSubMenu(filters) {
  return filters.some(_ref2 => {
    let {
      children
    } = _ref2;
    return children;
  });
}
function searchValueMatched(searchValue, text) {
  if (typeof text === 'string' || typeof text === 'number') {
    return text === null || text === void 0 ? void 0 : text.toString().toLowerCase().includes(searchValue.trim().toLowerCase());
  }
  return false;
}
function renderFilterItems(_ref3) {
  let {
    filters,
    prefixCls,
    filteredKeys,
    filterMultiple,
    searchValue,
    filterSearch
  } = _ref3;
  return filters.map((filter, index) => {
    const key = String(filter.value);
    if (filter.children) {
      return {
        key: key || index,
        label: filter.text,
        popupClassName: `${prefixCls}-dropdown-submenu`,
        children: renderFilterItems({
          filters: filter.children,
          prefixCls,
          filteredKeys,
          filterMultiple,
          searchValue,
          filterSearch
        })
      };
    }
    const Component = filterMultiple ? es_checkbox : es_radio;
    const item = {
      key: filter.value !== undefined ? key : index,
      label: (/*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement(Component, {
        checked: filteredKeys.includes(key)
      }), /*#__PURE__*/react.createElement("span", null, filter.text)))
    };
    if (searchValue.trim()) {
      if (typeof filterSearch === 'function') {
        return filterSearch(searchValue, filter) ? item : null;
      }
      return searchValueMatched(searchValue, filter.text) ? item : null;
    }
    return item;
  });
}
function wrapStringListType(keys) {
  return keys || [];
}
const FilterDropdown = props => {
  var _a, _b, _c, _d;
  const {
    tablePrefixCls,
    prefixCls,
    column,
    dropdownPrefixCls,
    columnKey,
    filterOnClose,
    filterMultiple,
    filterMode = 'menu',
    filterSearch = false,
    filterState,
    triggerFilter,
    locale,
    children,
    getPopupContainer,
    rootClassName
  } = props;
  const {
    filterResetToDefaultFilteredValue,
    defaultFilteredValue,
    filterDropdownProps = {},
    // Deprecated
    filterDropdownOpen,
    filterDropdownVisible,
    onFilterDropdownVisibleChange,
    onFilterDropdownOpenChange
  } = column;
  const [visible, setVisible] = react.useState(false);
  const filtered = !!(filterState && (((_a = filterState.filteredKeys) === null || _a === void 0 ? void 0 : _a.length) || filterState.forceFiltered));
  const triggerVisible = newVisible => {
    var _a;
    setVisible(newVisible);
    (_a = filterDropdownProps.onOpenChange) === null || _a === void 0 ? void 0 : _a.call(filterDropdownProps, newVisible);
    // deprecated
    onFilterDropdownOpenChange === null || onFilterDropdownOpenChange === void 0 ? void 0 : onFilterDropdownOpenChange(newVisible);
    onFilterDropdownVisibleChange === null || onFilterDropdownVisibleChange === void 0 ? void 0 : onFilterDropdownVisibleChange(newVisible);
  };
  // =================Warning===================
  if (false) {}
  const mergedVisible = (_d = (_c = (_b = filterDropdownProps.open) !== null && _b !== void 0 ? _b : filterDropdownOpen) !== null && _c !== void 0 ? _c : filterDropdownVisible) !== null && _d !== void 0 ? _d : visible; // inner state
  // ===================== Select Keys =====================
  const propFilteredKeys = filterState === null || filterState === void 0 ? void 0 : filterState.filteredKeys;
  const [getFilteredKeysSync, setFilteredKeysSync] = useSyncState(wrapStringListType(propFilteredKeys));
  const onSelectKeys = _ref5 => {
    let {
      selectedKeys
    } = _ref5;
    setFilteredKeysSync(selectedKeys);
  };
  const onCheck = (keys, _ref6) => {
    let {
      node,
      checked
    } = _ref6;
    if (!filterMultiple) {
      onSelectKeys({
        selectedKeys: checked && node.key ? [node.key] : []
      });
    } else {
      onSelectKeys({
        selectedKeys: keys
      });
    }
  };
  react.useEffect(() => {
    if (!visible) {
      return;
    }
    onSelectKeys({
      selectedKeys: wrapStringListType(propFilteredKeys)
    });
  }, [propFilteredKeys]);
  // ====================== Open Keys ======================
  const [openKeys, setOpenKeys] = react.useState([]);
  const onOpenChange = keys => {
    setOpenKeys(keys);
  };
  // search in tree mode column filter
  const [searchValue, setSearchValue] = react.useState('');
  const onSearch = e => {
    const {
      value
    } = e.target;
    setSearchValue(value);
  };
  // clear search value after close filter dropdown
  react.useEffect(() => {
    if (!visible) {
      setSearchValue('');
    }
  }, [visible]);
  // ======================= Submit ========================
  const internalTriggerFilter = keys => {
    const mergedKeys = (keys === null || keys === void 0 ? void 0 : keys.length) ? keys : null;
    if (mergedKeys === null && (!filterState || !filterState.filteredKeys)) {
      return null;
    }
    if ((0,isEqual/* default */.A)(mergedKeys, filterState === null || filterState === void 0 ? void 0 : filterState.filteredKeys, true)) {
      return null;
    }
    triggerFilter({
      column,
      key: columnKey,
      filteredKeys: mergedKeys
    });
  };
  const onConfirm = () => {
    triggerVisible(false);
    internalTriggerFilter(getFilteredKeysSync());
  };
  const onReset = function () {
    let {
      confirm,
      closeDropdown
    } = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {
      confirm: false,
      closeDropdown: false
    };
    if (confirm) {
      internalTriggerFilter([]);
    }
    if (closeDropdown) {
      triggerVisible(false);
    }
    setSearchValue('');
    if (filterResetToDefaultFilteredValue) {
      setFilteredKeysSync((defaultFilteredValue || []).map(key => String(key)));
    } else {
      setFilteredKeysSync([]);
    }
  };
  const doFilter = function () {
    let {
      closeDropdown
    } = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {
      closeDropdown: true
    };
    if (closeDropdown) {
      triggerVisible(false);
    }
    internalTriggerFilter(getFilteredKeysSync());
  };
  const onVisibleChange = (newVisible, info) => {
    if (info.source === 'trigger') {
      if (newVisible && propFilteredKeys !== undefined) {
        // Sync filteredKeys on appear in controlled mode (propFilteredKeys !== undefined)
        setFilteredKeysSync(wrapStringListType(propFilteredKeys));
      }
      triggerVisible(newVisible);
      if (!newVisible && !column.filterDropdown && filterOnClose) {
        onConfirm();
      }
    }
  };
  // ======================== Style ========================
  const dropdownMenuClass = classnames_default()({
    [`${dropdownPrefixCls}-menu-without-submenu`]: !hasSubMenu(column.filters || [])
  });
  const onCheckAll = e => {
    if (e.target.checked) {
      const allFilterKeys = flattenKeys(column === null || column === void 0 ? void 0 : column.filters).map(key => String(key));
      setFilteredKeysSync(allFilterKeys);
    } else {
      setFilteredKeysSync([]);
    }
  };
  const getTreeData = _ref7 => {
    let {
      filters
    } = _ref7;
    return (filters || []).map((filter, index) => {
      const key = String(filter.value);
      const item = {
        title: filter.text,
        key: filter.value !== undefined ? key : String(index)
      };
      if (filter.children) {
        item.children = getTreeData({
          filters: filter.children
        });
      }
      return item;
    });
  };
  const getFilterData = node => {
    var _a;
    return Object.assign(Object.assign({}, node), {
      text: node.title,
      value: node.key,
      children: ((_a = node.children) === null || _a === void 0 ? void 0 : _a.map(item => getFilterData(item))) || []
    });
  };
  let dropdownContent;
  const {
    direction,
    renderEmpty
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  if (typeof column.filterDropdown === 'function') {
    dropdownContent = column.filterDropdown({
      prefixCls: `${dropdownPrefixCls}-custom`,
      setSelectedKeys: selectedKeys => onSelectKeys({
        selectedKeys: selectedKeys
      }),
      selectedKeys: getFilteredKeysSync(),
      confirm: doFilter,
      clearFilters: onReset,
      filters: column.filters,
      visible: mergedVisible,
      close: () => {
        triggerVisible(false);
      }
    });
  } else if (column.filterDropdown) {
    dropdownContent = column.filterDropdown;
  } else {
    const selectedKeys = getFilteredKeysSync() || [];
    const getFilterComponent = () => {
      var _a;
      const empty = (_a = renderEmpty === null || renderEmpty === void 0 ? void 0 : renderEmpty('Table.filter')) !== null && _a !== void 0 ? _a : (/*#__PURE__*/react.createElement(es_empty/* default */.A, {
        image: es_empty/* default */.A.PRESENTED_IMAGE_SIMPLE,
        description: locale.filterEmptyText,
        imageStyle: {
          height: 24
        },
        style: {
          margin: 0,
          padding: '16px 0'
        }
      }));
      if ((column.filters || []).length === 0) {
        return empty;
      }
      if (filterMode === 'tree') {
        return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement(useFilter_FilterSearch, {
          filterSearch: filterSearch,
          value: searchValue,
          onChange: onSearch,
          tablePrefixCls: tablePrefixCls,
          locale: locale
        }), /*#__PURE__*/react.createElement("div", {
          className: `${tablePrefixCls}-filter-dropdown-tree`
        }, filterMultiple ? (/*#__PURE__*/react.createElement(es_checkbox, {
          checked: selectedKeys.length === flattenKeys(column.filters).length,
          indeterminate: selectedKeys.length > 0 && selectedKeys.length < flattenKeys(column.filters).length,
          className: `${tablePrefixCls}-filter-dropdown-checkall`,
          onChange: onCheckAll
        }, locale.filterCheckall)) : null, /*#__PURE__*/react.createElement(tree, {
          checkable: true,
          selectable: false,
          blockNode: true,
          multiple: filterMultiple,
          checkStrictly: !filterMultiple,
          className: `${dropdownPrefixCls}-menu`,
          onCheck: onCheck,
          checkedKeys: selectedKeys,
          selectedKeys: selectedKeys,
          showIcon: false,
          treeData: getTreeData({
            filters: column.filters
          }),
          autoExpandParent: true,
          defaultExpandAll: true,
          filterTreeNode: searchValue.trim() ? node => {
            if (typeof filterSearch === 'function') {
              return filterSearch(searchValue, getFilterData(node));
            }
            return searchValueMatched(searchValue, node.title);
          } : undefined
        })));
      }
      const items = renderFilterItems({
        filters: column.filters || [],
        filterSearch,
        prefixCls,
        filteredKeys: getFilteredKeysSync(),
        filterMultiple,
        searchValue
      });
      const isEmpty = items.every(item => item === null);
      return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement(useFilter_FilterSearch, {
        filterSearch: filterSearch,
        value: searchValue,
        onChange: onSearch,
        tablePrefixCls: tablePrefixCls,
        locale: locale
      }), isEmpty ? empty : (/*#__PURE__*/react.createElement(menu/* default */.A, {
        selectable: true,
        multiple: filterMultiple,
        prefixCls: `${dropdownPrefixCls}-menu`,
        className: dropdownMenuClass,
        onSelect: onSelectKeys,
        onDeselect: onSelectKeys,
        selectedKeys: selectedKeys,
        getPopupContainer: getPopupContainer,
        openKeys: openKeys,
        onOpenChange: onOpenChange,
        items: items
      })));
    };
    const getResetDisabled = () => {
      if (filterResetToDefaultFilteredValue) {
        return (0,isEqual/* default */.A)((defaultFilteredValue || []).map(key => String(key)), selectedKeys, true);
      }
      return selectedKeys.length === 0;
    };
    dropdownContent = /*#__PURE__*/react.createElement(react.Fragment, null, getFilterComponent(), /*#__PURE__*/react.createElement("div", {
      className: `${prefixCls}-dropdown-btns`
    }, /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
      type: "link",
      size: "small",
      disabled: getResetDisabled(),
      onClick: () => onReset()
    }, locale.filterReset), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
      type: "primary",
      size: "small",
      onClick: onConfirm
    }, locale.filterConfirm)));
  }
  // We should not block customize Menu with additional props
  if (column.filterDropdown) {
    dropdownContent = /*#__PURE__*/react.createElement(OverrideContext/* OverrideProvider */.A, {
      selectable: undefined
    }, dropdownContent);
  }
  dropdownContent = /*#__PURE__*/react.createElement(FilterWrapper, {
    className: `${prefixCls}-dropdown`
  }, dropdownContent);
  const getDropdownTrigger = () => {
    let filterIcon;
    if (typeof column.filterIcon === 'function') {
      filterIcon = column.filterIcon(filtered);
    } else if (column.filterIcon) {
      filterIcon = column.filterIcon;
    } else {
      filterIcon = /*#__PURE__*/react.createElement(icons_FilterFilled, null);
    }
    return /*#__PURE__*/react.createElement("span", {
      role: "button",
      tabIndex: -1,
      className: classnames_default()(`${prefixCls}-trigger`, {
        active: filtered
      }),
      onClick: e => {
        e.stopPropagation();
      }
    }, filterIcon);
  };
  const mergedDropdownProps = (0,extendsObject/* default */.A)({
    trigger: ['click'],
    placement: direction === 'rtl' ? 'bottomLeft' : 'bottomRight',
    children: getDropdownTrigger(),
    getPopupContainer
  }, Object.assign(Object.assign({}, filterDropdownProps), {
    rootClassName: classnames_default()(rootClassName, filterDropdownProps.rootClassName),
    open: mergedVisible,
    onOpenChange: onVisibleChange,
    dropdownRender: () => {
      if (typeof (filterDropdownProps === null || filterDropdownProps === void 0 ? void 0 : filterDropdownProps.dropdownRender) === 'function') {
        return filterDropdownProps.dropdownRender(dropdownContent);
      }
      return dropdownContent;
    }
  }));
  return /*#__PURE__*/react.createElement("div", {
    className: `${prefixCls}-column`
  }, /*#__PURE__*/react.createElement("span", {
    className: `${tablePrefixCls}-column-title`
  }, children), /*#__PURE__*/react.createElement(dropdown/* default */.A, Object.assign({}, mergedDropdownProps)));
};
/* harmony default export */ var useFilter_FilterDropdown = (FilterDropdown);
;// ./node_modules/antd/es/table/hooks/useFilter/index.js
"use client";






const collectFilterStates = (columns, init, pos) => {
  let filterStates = [];
  (columns || []).forEach((column, index) => {
    var _a;
    const columnPos = getColumnPos(index, pos);
    if (column.filters || 'filterDropdown' in column || 'onFilter' in column) {
      if ('filteredValue' in column) {
        // Controlled
        let filteredValues = column.filteredValue;
        if (!('filterDropdown' in column)) {
          filteredValues = (_a = filteredValues === null || filteredValues === void 0 ? void 0 : filteredValues.map(String)) !== null && _a !== void 0 ? _a : filteredValues;
        }
        filterStates.push({
          column,
          key: getColumnKey(column, columnPos),
          filteredKeys: filteredValues,
          forceFiltered: column.filtered
        });
      } else {
        // Uncontrolled
        filterStates.push({
          column,
          key: getColumnKey(column, columnPos),
          filteredKeys: init && column.defaultFilteredValue ? column.defaultFilteredValue : undefined,
          forceFiltered: column.filtered
        });
      }
    }
    if ('children' in column) {
      filterStates = [].concat((0,toConsumableArray/* default */.A)(filterStates), (0,toConsumableArray/* default */.A)(collectFilterStates(column.children, init, columnPos)));
    }
  });
  return filterStates;
};
function injectFilter(prefixCls, dropdownPrefixCls, columns, filterStates, locale, triggerFilter, getPopupContainer, pos, rootClassName) {
  return columns.map((column, index) => {
    const columnPos = getColumnPos(index, pos);
    const {
      filterOnClose = true,
      filterMultiple = true,
      filterMode,
      filterSearch
    } = column;
    let newColumn = column;
    if (newColumn.filters || newColumn.filterDropdown) {
      const columnKey = getColumnKey(newColumn, columnPos);
      const filterState = filterStates.find(_ref => {
        let {
          key
        } = _ref;
        return columnKey === key;
      });
      newColumn = Object.assign(Object.assign({}, newColumn), {
        title: renderProps => (/*#__PURE__*/react.createElement(useFilter_FilterDropdown, {
          tablePrefixCls: prefixCls,
          prefixCls: `${prefixCls}-filter`,
          dropdownPrefixCls: dropdownPrefixCls,
          column: newColumn,
          columnKey: columnKey,
          filterState: filterState,
          filterOnClose: filterOnClose,
          filterMultiple: filterMultiple,
          filterMode: filterMode,
          filterSearch: filterSearch,
          triggerFilter: triggerFilter,
          locale: locale,
          getPopupContainer: getPopupContainer,
          rootClassName: rootClassName
        }, renderColumnTitle(column.title, renderProps)))
      });
    }
    if ('children' in newColumn) {
      newColumn = Object.assign(Object.assign({}, newColumn), {
        children: injectFilter(prefixCls, dropdownPrefixCls, newColumn.children, filterStates, locale, triggerFilter, getPopupContainer, columnPos, rootClassName)
      });
    }
    return newColumn;
  });
}
const generateFilterInfo = filterStates => {
  const currentFilters = {};
  filterStates.forEach(_ref2 => {
    let {
      key,
      filteredKeys,
      column
    } = _ref2;
    const keyAsString = key;
    const {
      filters,
      filterDropdown
    } = column;
    if (filterDropdown) {
      currentFilters[keyAsString] = filteredKeys || null;
    } else if (Array.isArray(filteredKeys)) {
      const keys = flattenKeys(filters);
      currentFilters[keyAsString] = keys.filter(originKey => filteredKeys.includes(String(originKey)));
    } else {
      currentFilters[keyAsString] = null;
    }
  });
  return currentFilters;
};
const getFilterData = (data, filterStates, childrenColumnName) => {
  const filterDatas = filterStates.reduce((currentData, filterState) => {
    const {
      column: {
        onFilter,
        filters
      },
      filteredKeys
    } = filterState;
    if (onFilter && filteredKeys && filteredKeys.length) {
      return currentData
      // shallow copy
      .map(record => Object.assign({}, record)).filter(record => filteredKeys.some(key => {
        const keys = flattenKeys(filters);
        const keyIndex = keys.findIndex(k => String(k) === String(key));
        const realKey = keyIndex !== -1 ? keys[keyIndex] : key;
        // filter children
        if (record[childrenColumnName]) {
          record[childrenColumnName] = getFilterData(record[childrenColumnName], filterStates, childrenColumnName);
        }
        return onFilter(realKey, record);
      }));
    }
    return currentData;
  }, data);
  return filterDatas;
};
const getMergedColumns = rawMergedColumns => rawMergedColumns.flatMap(column => {
  if ('children' in column) {
    return [column].concat((0,toConsumableArray/* default */.A)(getMergedColumns(column.children || [])));
  }
  return [column];
});
const useFilter = props => {
  const {
    prefixCls,
    dropdownPrefixCls,
    mergedColumns: rawMergedColumns,
    onFilterChange,
    getPopupContainer,
    locale: tableLocale,
    rootClassName
  } = props;
  const warning = (0,_util_warning/* devUseWarning */.rJ)('Table');
  const mergedColumns = react.useMemo(() => getMergedColumns(rawMergedColumns || []), [rawMergedColumns]);
  const [filterStates, setFilterStates] = react.useState(() => collectFilterStates(mergedColumns, true));
  const mergedFilterStates = react.useMemo(() => {
    const collectedStates = collectFilterStates(mergedColumns, false);
    if (collectedStates.length === 0) {
      return collectedStates;
    }
    let filteredKeysIsAllNotControlled = true;
    let filteredKeysIsAllControlled = true;
    collectedStates.forEach(_ref3 => {
      let {
        filteredKeys
      } = _ref3;
      if (filteredKeys !== undefined) {
        filteredKeysIsAllNotControlled = false;
      } else {
        filteredKeysIsAllControlled = false;
      }
    });
    // Return if not controlled
    if (filteredKeysIsAllNotControlled) {
      // Filter column may have been removed
      const keyList = (mergedColumns || []).map((column, index) => getColumnKey(column, getColumnPos(index)));
      return filterStates.filter(_ref4 => {
        let {
          key
        } = _ref4;
        return keyList.includes(key);
      }).map(item => {
        const col = mergedColumns[keyList.findIndex(key => key === item.key)];
        return Object.assign(Object.assign({}, item), {
          column: Object.assign(Object.assign({}, item.column), col),
          forceFiltered: col.filtered
        });
      });
    }
     false ? 0 : void 0;
    return collectedStates;
  }, [mergedColumns, filterStates]);
  const filters = react.useMemo(() => generateFilterInfo(mergedFilterStates), [mergedFilterStates]);
  const triggerFilter = filterState => {
    const newFilterStates = mergedFilterStates.filter(_ref5 => {
      let {
        key
      } = _ref5;
      return key !== filterState.key;
    });
    newFilterStates.push(filterState);
    setFilterStates(newFilterStates);
    onFilterChange(generateFilterInfo(newFilterStates), newFilterStates);
  };
  const transformColumns = innerColumns => injectFilter(prefixCls, dropdownPrefixCls, innerColumns, mergedFilterStates, tableLocale, triggerFilter, getPopupContainer, undefined, rootClassName);
  return [transformColumns, mergedFilterStates, filters];
};

/* harmony default export */ var hooks_useFilter = (useFilter);
;// ./node_modules/antd/es/table/hooks/useLazyKVMap.js

const useLazyKVMap = (data, childrenColumnName, getRowKey) => {
  const mapCacheRef = react.useRef({});
  function getRecordByKey(key) {
    var _a;
    if (!mapCacheRef.current || mapCacheRef.current.data !== data || mapCacheRef.current.childrenColumnName !== childrenColumnName || mapCacheRef.current.getRowKey !== getRowKey) {
      const kvMap = new Map();
      function dig(records) {
        records.forEach((record, index) => {
          const rowKey = getRowKey(record, index);
          kvMap.set(rowKey, record);
          if (record && typeof record === 'object' && childrenColumnName in record) {
            dig(record[childrenColumnName] || []);
          }
        });
      }
      dig(data);
      mapCacheRef.current = {
        data,
        childrenColumnName,
        kvMap,
        getRowKey
      };
    }
    return (_a = mapCacheRef.current.kvMap) === null || _a === void 0 ? void 0 : _a.get(key);
  }
  return [getRecordByKey];
};
/* harmony default export */ var hooks_useLazyKVMap = (useLazyKVMap);
;// ./node_modules/antd/es/table/hooks/usePagination.js
var usePagination_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};


const DEFAULT_PAGE_SIZE = 10;
function getPaginationParam(mergedPagination, pagination) {
  const param = {
    current: mergedPagination.current,
    pageSize: mergedPagination.pageSize
  };
  const paginationObj = pagination && typeof pagination === 'object' ? pagination : {};
  Object.keys(paginationObj).forEach(pageProp => {
    const value = mergedPagination[pageProp];
    if (typeof value !== 'function') {
      param[pageProp] = value;
    }
  });
  return param;
}
function usePagination(total, onChange, pagination) {
  const _a = pagination && typeof pagination === 'object' ? pagination : {},
    {
      total: paginationTotal = 0
    } = _a,
    paginationObj = usePagination_rest(_a, ["total"]);
  const [innerPagination, setInnerPagination] = (0,react.useState)(() => ({
    current: 'defaultCurrent' in paginationObj ? paginationObj.defaultCurrent : 1,
    pageSize: 'defaultPageSize' in paginationObj ? paginationObj.defaultPageSize : DEFAULT_PAGE_SIZE
  }));
  // ============ Basic Pagination Config ============
  const mergedPagination = (0,extendsObject/* default */.A)(innerPagination, paginationObj, {
    total: paginationTotal > 0 ? paginationTotal : total
  });
  // Reset `current` if data length or pageSize changed
  const maxPage = Math.ceil((paginationTotal || total) / mergedPagination.pageSize);
  if (mergedPagination.current > maxPage) {
    // Prevent a maximum page count of 0
    mergedPagination.current = maxPage || 1;
  }
  const refreshPagination = (current, pageSize) => {
    setInnerPagination({
      current: current !== null && current !== void 0 ? current : 1,
      pageSize: pageSize || mergedPagination.pageSize
    });
  };
  const onInternalChange = (current, pageSize) => {
    var _a;
    if (pagination) {
      (_a = pagination.onChange) === null || _a === void 0 ? void 0 : _a.call(pagination, current, pageSize);
    }
    refreshPagination(current, pageSize);
    onChange(current, pageSize || (mergedPagination === null || mergedPagination === void 0 ? void 0 : mergedPagination.pageSize));
  };
  if (pagination === false) {
    return [{}, () => {}];
  }
  return [Object.assign(Object.assign({}, mergedPagination), {
    onChange: onInternalChange
  }), refreshPagination];
}
/* harmony default export */ var hooks_usePagination = (usePagination);
;// ./node_modules/@ant-design/icons-svg/es/asn/CaretDownOutlined.js
// This icon file is generated automatically.
var CaretDownOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "0 0 1024 1024", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M840.4 300H183.6c-19.7 0-30.7 20.8-18.5 35l328.4 380.8c9.4 10.9 27.5 10.9 37 0L858.9 335c12.2-14.2 1.2-35-18.5-35z" } }] }, "name": "caret-down", "theme": "outlined" };
/* harmony default export */ var asn_CaretDownOutlined = (CaretDownOutlined);

;// ./node_modules/@ant-design/icons/es/icons/CaretDownOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var CaretDownOutlined_CaretDownOutlined = function CaretDownOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_CaretDownOutlined
  }));
};

/**![caret-down](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTg0MC40IDMwMEgxODMuNmMtMTkuNyAwLTMwLjcgMjAuOC0xOC41IDM1bDMyOC40IDM4MC44YzkuNCAxMC45IDI3LjUgMTAuOSAzNyAwTDg1OC45IDMzNWMxMi4yLTE0LjIgMS4yLTM1LTE4LjUtMzV6IiAvPjwvc3ZnPg==) */
var CaretDownOutlined_RefIcon = /*#__PURE__*/react.forwardRef(CaretDownOutlined_CaretDownOutlined);
if (false) {}
/* harmony default export */ var icons_CaretDownOutlined = (CaretDownOutlined_RefIcon);
;// ./node_modules/@ant-design/icons-svg/es/asn/CaretUpOutlined.js
// This icon file is generated automatically.
var CaretUpOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "0 0 1024 1024", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M858.9 689L530.5 308.2c-9.4-10.9-27.5-10.9-37 0L165.1 689c-12.2 14.2-1.2 35 18.5 35h656.8c19.7 0 30.7-20.8 18.5-35z" } }] }, "name": "caret-up", "theme": "outlined" };
/* harmony default export */ var asn_CaretUpOutlined = (CaretUpOutlined);

;// ./node_modules/@ant-design/icons/es/icons/CaretUpOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var CaretUpOutlined_CaretUpOutlined = function CaretUpOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_CaretUpOutlined
  }));
};

/**![caret-up](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTg1OC45IDY4OUw1MzAuNSAzMDguMmMtOS40LTEwLjktMjcuNS0xMC45LTM3IDBMMTY1LjEgNjg5Yy0xMi4yIDE0LjItMS4yIDM1IDE4LjUgMzVoNjU2LjhjMTkuNyAwIDMwLjctMjAuOCAxOC41LTM1eiIgLz48L3N2Zz4=) */
var CaretUpOutlined_RefIcon = /*#__PURE__*/react.forwardRef(CaretUpOutlined_CaretUpOutlined);
if (false) {}
/* harmony default export */ var icons_CaretUpOutlined = (CaretUpOutlined_RefIcon);
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var tooltip = __webpack_require__(40367);
;// ./node_modules/antd/es/table/hooks/useSorter.js
"use client";









const ASCEND = 'ascend';
const DESCEND = 'descend';
const getMultiplePriority = column => {
  if (typeof column.sorter === 'object' && typeof column.sorter.multiple === 'number') {
    return column.sorter.multiple;
  }
  return false;
};
const getSortFunction = sorter => {
  if (typeof sorter === 'function') {
    return sorter;
  }
  if (sorter && typeof sorter === 'object' && sorter.compare) {
    return sorter.compare;
  }
  return false;
};
const nextSortDirection = (sortDirections, current) => {
  if (!current) {
    return sortDirections[0];
  }
  return sortDirections[sortDirections.indexOf(current) + 1];
};
const collectSortStates = (columns, init, pos) => {
  let sortStates = [];
  const pushState = (column, columnPos) => {
    sortStates.push({
      column,
      key: getColumnKey(column, columnPos),
      multiplePriority: getMultiplePriority(column),
      sortOrder: column.sortOrder
    });
  };
  (columns || []).forEach((column, index) => {
    const columnPos = getColumnPos(index, pos);
    if (column.children) {
      if ('sortOrder' in column) {
        // Controlled
        pushState(column, columnPos);
      }
      sortStates = [].concat((0,toConsumableArray/* default */.A)(sortStates), (0,toConsumableArray/* default */.A)(collectSortStates(column.children, init, columnPos)));
    } else if (column.sorter) {
      if ('sortOrder' in column) {
        // Controlled
        pushState(column, columnPos);
      } else if (init && column.defaultSortOrder) {
        // Default sorter
        sortStates.push({
          column,
          key: getColumnKey(column, columnPos),
          multiplePriority: getMultiplePriority(column),
          sortOrder: column.defaultSortOrder
        });
      }
    }
  });
  return sortStates;
};
const injectSorter = (prefixCls, columns, sorterStates, triggerSorter, defaultSortDirections, tableLocale, tableShowSorterTooltip, pos) => {
  const finalColumns = (columns || []).map((column, index) => {
    const columnPos = getColumnPos(index, pos);
    let newColumn = column;
    if (newColumn.sorter) {
      const sortDirections = newColumn.sortDirections || defaultSortDirections;
      const showSorterTooltip = newColumn.showSorterTooltip === undefined ? tableShowSorterTooltip : newColumn.showSorterTooltip;
      const columnKey = getColumnKey(newColumn, columnPos);
      const sorterState = sorterStates.find(_ref => {
        let {
          key
        } = _ref;
        return key === columnKey;
      });
      const sortOrder = sorterState ? sorterState.sortOrder : null;
      const nextSortOrder = nextSortDirection(sortDirections, sortOrder);
      let sorter;
      if (column.sortIcon) {
        sorter = column.sortIcon({
          sortOrder
        });
      } else {
        const upNode = sortDirections.includes(ASCEND) && (/*#__PURE__*/react.createElement(icons_CaretUpOutlined, {
          className: classnames_default()(`${prefixCls}-column-sorter-up`, {
            active: sortOrder === ASCEND
          })
        }));
        const downNode = sortDirections.includes(DESCEND) && (/*#__PURE__*/react.createElement(icons_CaretDownOutlined, {
          className: classnames_default()(`${prefixCls}-column-sorter-down`, {
            active: sortOrder === DESCEND
          })
        }));
        sorter = /*#__PURE__*/react.createElement("span", {
          className: classnames_default()(`${prefixCls}-column-sorter`, {
            [`${prefixCls}-column-sorter-full`]: !!(upNode && downNode)
          })
        }, /*#__PURE__*/react.createElement("span", {
          className: `${prefixCls}-column-sorter-inner`,
          "aria-hidden": "true"
        }, upNode, downNode));
      }
      const {
        cancelSort,
        triggerAsc,
        triggerDesc
      } = tableLocale || {};
      let sortTip = cancelSort;
      if (nextSortOrder === DESCEND) {
        sortTip = triggerDesc;
      } else if (nextSortOrder === ASCEND) {
        sortTip = triggerAsc;
      }
      const tooltipProps = typeof showSorterTooltip === 'object' ? Object.assign({
        title: sortTip
      }, showSorterTooltip) : {
        title: sortTip
      };
      newColumn = Object.assign(Object.assign({}, newColumn), {
        className: classnames_default()(newColumn.className, {
          [`${prefixCls}-column-sort`]: sortOrder
        }),
        title: renderProps => {
          const columnSortersClass = `${prefixCls}-column-sorters`;
          const renderColumnTitleWrapper = /*#__PURE__*/react.createElement("span", {
            className: `${prefixCls}-column-title`
          }, renderColumnTitle(column.title, renderProps));
          const renderSortTitle = /*#__PURE__*/react.createElement("div", {
            className: columnSortersClass
          }, renderColumnTitleWrapper, sorter);
          if (showSorterTooltip) {
            if (typeof showSorterTooltip !== 'boolean' && (showSorterTooltip === null || showSorterTooltip === void 0 ? void 0 : showSorterTooltip.target) === 'sorter-icon') {
              return /*#__PURE__*/react.createElement("div", {
                className: `${columnSortersClass} ${prefixCls}-column-sorters-tooltip-target-sorter`
              }, renderColumnTitleWrapper, /*#__PURE__*/react.createElement(tooltip/* default */.A, Object.assign({}, tooltipProps), sorter));
            }
            return /*#__PURE__*/react.createElement(tooltip/* default */.A, Object.assign({}, tooltipProps), renderSortTitle);
          }
          return renderSortTitle;
        },
        onHeaderCell: col => {
          var _a;
          const cell = ((_a = column.onHeaderCell) === null || _a === void 0 ? void 0 : _a.call(column, col)) || {};
          const originOnClick = cell.onClick;
          const originOKeyDown = cell.onKeyDown;
          cell.onClick = event => {
            triggerSorter({
              column,
              key: columnKey,
              sortOrder: nextSortOrder,
              multiplePriority: getMultiplePriority(column)
            });
            originOnClick === null || originOnClick === void 0 ? void 0 : originOnClick(event);
          };
          cell.onKeyDown = event => {
            if (event.keyCode === KeyCode/* default */.A.ENTER) {
              triggerSorter({
                column,
                key: columnKey,
                sortOrder: nextSortOrder,
                multiplePriority: getMultiplePriority(column)
              });
              originOKeyDown === null || originOKeyDown === void 0 ? void 0 : originOKeyDown(event);
            }
          };
          const renderTitle = safeColumnTitle(column.title, {});
          const displayTitle = renderTitle === null || renderTitle === void 0 ? void 0 : renderTitle.toString();
          // Inform the screen-reader so it can tell the visually impaired user which column is sorted
          if (sortOrder) {
            cell['aria-sort'] = sortOrder === 'ascend' ? 'ascending' : 'descending';
          } else {
            cell['aria-label'] = displayTitle || '';
          }
          cell.className = classnames_default()(cell.className, `${prefixCls}-column-has-sorters`);
          cell.tabIndex = 0;
          if (column.ellipsis) {
            cell.title = (renderTitle !== null && renderTitle !== void 0 ? renderTitle : '').toString();
          }
          return cell;
        }
      });
    }
    if ('children' in newColumn) {
      newColumn = Object.assign(Object.assign({}, newColumn), {
        children: injectSorter(prefixCls, newColumn.children, sorterStates, triggerSorter, defaultSortDirections, tableLocale, tableShowSorterTooltip, columnPos)
      });
    }
    return newColumn;
  });
  return finalColumns;
};
const stateToInfo = sorterState => {
  const {
    column,
    sortOrder
  } = sorterState;
  return {
    column,
    order: sortOrder,
    field: column.dataIndex,
    columnKey: column.key
  };
};
const generateSorterInfo = sorterStates => {
  const activeSorters = sorterStates.filter(_ref2 => {
    let {
      sortOrder
    } = _ref2;
    return sortOrder;
  }).map(stateToInfo);
  // =========== Legacy compatible support ===========
  // https://github.com/ant-design/ant-design/pull/19226
  if (activeSorters.length === 0 && sorterStates.length) {
    const lastIndex = sorterStates.length - 1;
    return Object.assign(Object.assign({}, stateToInfo(sorterStates[lastIndex])), {
      column: undefined,
      order: undefined,
      field: undefined,
      columnKey: undefined
    });
  }
  if (activeSorters.length <= 1) {
    return activeSorters[0] || {};
  }
  return activeSorters;
};
const getSortData = (data, sortStates, childrenColumnName) => {
  const innerSorterStates = sortStates.slice().sort((a, b) => b.multiplePriority - a.multiplePriority);
  const cloneData = data.slice();
  const runningSorters = innerSorterStates.filter(_ref3 => {
    let {
      column: {
        sorter
      },
      sortOrder
    } = _ref3;
    return getSortFunction(sorter) && sortOrder;
  });
  // Skip if no sorter needed
  if (!runningSorters.length) {
    return cloneData;
  }
  return cloneData.sort((record1, record2) => {
    for (let i = 0; i < runningSorters.length; i += 1) {
      const sorterState = runningSorters[i];
      const {
        column: {
          sorter
        },
        sortOrder
      } = sorterState;
      const compareFn = getSortFunction(sorter);
      if (compareFn && sortOrder) {
        const compareResult = compareFn(record1, record2, sortOrder);
        if (compareResult !== 0) {
          return sortOrder === ASCEND ? compareResult : -compareResult;
        }
      }
    }
    return 0;
  }).map(record => {
    const subRecords = record[childrenColumnName];
    if (subRecords) {
      return Object.assign(Object.assign({}, record), {
        [childrenColumnName]: getSortData(subRecords, sortStates, childrenColumnName)
      });
    }
    return record;
  });
};
const useFilterSorter = props => {
  const {
    prefixCls,
    mergedColumns,
    sortDirections,
    tableLocale,
    showSorterTooltip,
    onSorterChange
  } = props;
  const [sortStates, setSortStates] = react.useState(collectSortStates(mergedColumns, true));
  const getColumnKeys = (columns, pos) => {
    const newKeys = [];
    columns.forEach((item, index) => {
      const columnPos = getColumnPos(index, pos);
      newKeys.push(getColumnKey(item, columnPos));
      if (Array.isArray(item.children)) {
        const childKeys = getColumnKeys(item.children, columnPos);
        newKeys.push.apply(newKeys, (0,toConsumableArray/* default */.A)(childKeys));
      }
    });
    return newKeys;
  };
  const mergedSorterStates = react.useMemo(() => {
    let validate = true;
    const collectedStates = collectSortStates(mergedColumns, false);
    // Return if not controlled
    if (!collectedStates.length) {
      const mergedColumnsKeys = getColumnKeys(mergedColumns);
      return sortStates.filter(_ref4 => {
        let {
          key
        } = _ref4;
        return mergedColumnsKeys.includes(key);
      });
    }
    const validateStates = [];
    function patchStates(state) {
      if (validate) {
        validateStates.push(state);
      } else {
        validateStates.push(Object.assign(Object.assign({}, state), {
          sortOrder: null
        }));
      }
    }
    let multipleMode = null;
    collectedStates.forEach(state => {
      if (multipleMode === null) {
        patchStates(state);
        if (state.sortOrder) {
          if (state.multiplePriority === false) {
            validate = false;
          } else {
            multipleMode = true;
          }
        }
      } else if (multipleMode && state.multiplePriority !== false) {
        patchStates(state);
      } else {
        validate = false;
        patchStates(state);
      }
    });
    return validateStates;
  }, [mergedColumns, sortStates]);
  // Get render columns title required props
  const columnTitleSorterProps = react.useMemo(() => {
    var _a, _b;
    const sortColumns = mergedSorterStates.map(_ref5 => {
      let {
        column,
        sortOrder
      } = _ref5;
      return {
        column,
        order: sortOrder
      };
    });
    return {
      sortColumns,
      // Legacy
      sortColumn: (_a = sortColumns[0]) === null || _a === void 0 ? void 0 : _a.column,
      sortOrder: (_b = sortColumns[0]) === null || _b === void 0 ? void 0 : _b.order
    };
  }, [mergedSorterStates]);
  const triggerSorter = sortState => {
    let newSorterStates;
    if (sortState.multiplePriority === false || !mergedSorterStates.length || mergedSorterStates[0].multiplePriority === false) {
      newSorterStates = [sortState];
    } else {
      newSorterStates = [].concat((0,toConsumableArray/* default */.A)(mergedSorterStates.filter(_ref6 => {
        let {
          key
        } = _ref6;
        return key !== sortState.key;
      })), [sortState]);
    }
    setSortStates(newSorterStates);
    onSorterChange(generateSorterInfo(newSorterStates), newSorterStates);
  };
  const transformColumns = innerColumns => injectSorter(prefixCls, innerColumns, mergedSorterStates, triggerSorter, sortDirections, tableLocale, showSorterTooltip);
  const getSorters = () => generateSorterInfo(mergedSorterStates);
  return [transformColumns, mergedSorterStates, columnTitleSorterProps, getSorters];
};
/* harmony default export */ var useSorter = (useFilterSorter);
;// ./node_modules/antd/es/table/hooks/useTitleColumns.js


const fillTitle = (columns, columnTitleProps) => {
  const finalColumns = columns.map(column => {
    const cloneColumn = Object.assign({}, column);
    cloneColumn.title = renderColumnTitle(column.title, columnTitleProps);
    if ('children' in cloneColumn) {
      cloneColumn.children = fillTitle(cloneColumn.children, columnTitleProps);
    }
    return cloneColumn;
  });
  return finalColumns;
};
const useTitleColumns = columnTitleProps => {
  const filledColumns = react.useCallback(columns => fillTitle(columns, columnTitleProps), [columnTitleProps]);
  return [filledColumns];
};
/* harmony default export */ var hooks_useTitleColumns = (useTitleColumns);
;// ./node_modules/antd/es/table/RcTable/index.js
"use client";


/**
 * Same as `rc-table` but we modify trigger children update logic instead.
 */
const RcTable = genTable((prev, next) => {
  const {
    _renderTimes: prevRenderTimes
  } = prev;
  const {
    _renderTimes: nextRenderTimes
  } = next;
  return prevRenderTimes !== nextRenderTimes;
});
/* harmony default export */ var table_RcTable = (RcTable);
;// ./node_modules/antd/es/table/RcTable/VirtualTable.js
"use client";


/**
 * Same as `rc-table` but we modify trigger children update logic instead.
 */
const RcVirtualTable = genVirtualTable((prev, next) => {
  const {
    _renderTimes: prevRenderTimes
  } = prev;
  const {
    _renderTimes: nextRenderTimes
  } = next;
  return prevRenderTimes !== nextRenderTimes;
});
/* harmony default export */ var RcTable_VirtualTable = (RcVirtualTable);
// EXTERNAL MODULE: ./node_modules/@ctrl/tinycolor/dist/module/index.js
var dist_module = __webpack_require__(24978);
;// ./node_modules/antd/es/table/style/bordered.js

const genBorderedStyle = token => {
  const {
    componentCls,
    lineWidth,
    lineType,
    tableBorderColor,
    tableHeaderBg,
    tablePaddingVertical,
    tablePaddingHorizontal,
    calc
  } = token;
  const tableBorder = `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${tableBorderColor}`;
  const getSizeBorderStyle = (size, paddingVertical, paddingHorizontal) => ({
    [`&${componentCls}-${size}`]: {
      [`> ${componentCls}-container`]: {
        [`> ${componentCls}-content, > ${componentCls}-body`]: {
          [`
            > table > tbody > tr > th,
            > table > tbody > tr > td
          `]: {
            [`> ${componentCls}-expanded-row-fixed`]: {
              margin: `${(0,cssinjs_es/* unit */.zA)(calc(paddingVertical).mul(-1).equal())}
              ${(0,cssinjs_es/* unit */.zA)(calc(calc(paddingHorizontal).add(lineWidth)).mul(-1).equal())}`
            }
          }
        }
      }
    }
  });
  return {
    [`${componentCls}-wrapper`]: {
      [`${componentCls}${componentCls}-bordered`]: Object.assign(Object.assign(Object.assign({
        // ============================ Title =============================
        [`> ${componentCls}-title`]: {
          border: tableBorder,
          borderBottom: 0
        },
        // ============================ Content ============================
        [`> ${componentCls}-container`]: {
          borderInlineStart: tableBorder,
          borderTop: tableBorder,
          [`
            > ${componentCls}-content,
            > ${componentCls}-header,
            > ${componentCls}-body,
            > ${componentCls}-summary
          `]: {
            '> table': {
              // ============================= Cell =============================
              [`
                > thead > tr > th,
                > thead > tr > td,
                > tbody > tr > th,
                > tbody > tr > td,
                > tfoot > tr > th,
                > tfoot > tr > td
              `]: {
                borderInlineEnd: tableBorder
              },
              // ============================ Header ============================
              '> thead': {
                '> tr:not(:last-child) > th': {
                  borderBottom: tableBorder
                },
                '> tr > th::before': {
                  backgroundColor: 'transparent !important'
                }
              },
              // Fixed right should provides additional border
              [`
                > thead > tr,
                > tbody > tr,
                > tfoot > tr
              `]: {
                [`> ${componentCls}-cell-fix-right-first::after`]: {
                  borderInlineEnd: tableBorder
                }
              },
              // ========================== Expandable ==========================
              [`
                > tbody > tr > th,
                > tbody > tr > td
              `]: {
                [`> ${componentCls}-expanded-row-fixed`]: {
                  margin: `${(0,cssinjs_es/* unit */.zA)(calc(tablePaddingVertical).mul(-1).equal())} ${(0,cssinjs_es/* unit */.zA)(calc(calc(tablePaddingHorizontal).add(lineWidth)).mul(-1).equal())}`,
                  '&::after': {
                    position: 'absolute',
                    top: 0,
                    insetInlineEnd: lineWidth,
                    bottom: 0,
                    borderInlineEnd: tableBorder,
                    content: '""'
                  }
                }
              }
            }
          }
        },
        // ============================ Scroll ============================
        [`&${componentCls}-scroll-horizontal`]: {
          [`> ${componentCls}-container > ${componentCls}-body`]: {
            '> table > tbody': {
              [`
                > tr${componentCls}-expanded-row,
                > tr${componentCls}-placeholder
              `]: {
                '> th, > td': {
                  borderInlineEnd: 0
                }
              }
            }
          }
        }
      }, getSizeBorderStyle('middle', token.tablePaddingVerticalMiddle, token.tablePaddingHorizontalMiddle)), getSizeBorderStyle('small', token.tablePaddingVerticalSmall, token.tablePaddingHorizontalSmall)), {
        // ============================ Footer ============================
        [`> ${componentCls}-footer`]: {
          border: tableBorder,
          borderTop: 0
        }
      }),
      // ============================ Nested ============================
      [`${componentCls}-cell`]: {
        [`${componentCls}-container:first-child`]: {
          // :first-child to avoid the case when bordered and title is set
          borderTop: 0
        },
        // https://github.com/ant-design/ant-design/issues/35577
        '&-scrollbar:not([rowspan])': {
          boxShadow: `0 ${(0,cssinjs_es/* unit */.zA)(lineWidth)} 0 ${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${tableHeaderBg}`
        }
      },
      [`${componentCls}-bordered ${componentCls}-cell-scrollbar`]: {
        borderInlineEnd: tableBorder
      }
    }
  };
};
/* harmony default export */ var bordered = (genBorderedStyle);
;// ./node_modules/antd/es/table/style/ellipsis.js

const genEllipsisStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}-wrapper`]: {
      [`${componentCls}-cell-ellipsis`]: Object.assign(Object.assign({}, style/* textEllipsis */.L9), {
        wordBreak: 'keep-all',
        // Fixed first or last should special process
        [`
          &${componentCls}-cell-fix-left-last,
          &${componentCls}-cell-fix-right-first
        `]: {
          overflow: 'visible',
          [`${componentCls}-cell-content`]: {
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }
        },
        [`${componentCls}-column-title`]: {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          wordBreak: 'keep-all'
        }
      })
    }
  };
};
/* harmony default export */ var ellipsis = (genEllipsisStyle);
;// ./node_modules/antd/es/table/style/empty.js
// ========================= Placeholder ==========================
const genEmptyStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}-wrapper`]: {
      [`${componentCls}-tbody > tr${componentCls}-placeholder`]: {
        textAlign: 'center',
        color: token.colorTextDisabled,
        [`
          &:hover > th,
          &:hover > td,
        `]: {
          background: token.colorBgContainer
        }
      }
    }
  };
};
/* harmony default export */ var empty = (genEmptyStyle);
;// ./node_modules/antd/es/table/style/expand.js


const genExpandStyle = token => {
  const {
    componentCls,
    antCls,
    motionDurationSlow,
    lineWidth,
    paddingXS,
    lineType,
    tableBorderColor,
    tableExpandIconBg,
    tableExpandColumnWidth,
    borderRadius,
    tablePaddingVertical,
    tablePaddingHorizontal,
    tableExpandedRowBg,
    paddingXXS,
    expandIconMarginTop,
    expandIconSize,
    expandIconHalfInner,
    expandIconScale,
    calc
  } = token;
  const tableBorder = `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${tableBorderColor}`;
  const expandIconLineOffset = calc(paddingXXS).sub(lineWidth).equal();
  return {
    [`${componentCls}-wrapper`]: {
      [`${componentCls}-expand-icon-col`]: {
        width: tableExpandColumnWidth
      },
      [`${componentCls}-row-expand-icon-cell`]: {
        textAlign: 'center',
        [`${componentCls}-row-expand-icon`]: {
          display: 'inline-flex',
          float: 'none',
          verticalAlign: 'sub'
        }
      },
      [`${componentCls}-row-indent`]: {
        height: 1,
        float: 'left'
      },
      [`${componentCls}-row-expand-icon`]: Object.assign(Object.assign({}, (0,style/* operationUnit */.Y1)(token)), {
        position: 'relative',
        float: 'left',
        width: expandIconSize,
        height: expandIconSize,
        color: 'inherit',
        lineHeight: (0,cssinjs_es/* unit */.zA)(expandIconSize),
        background: tableExpandIconBg,
        border: tableBorder,
        borderRadius,
        transform: `scale(${expandIconScale})`,
        '&:focus, &:hover, &:active': {
          borderColor: 'currentcolor'
        },
        '&::before, &::after': {
          position: 'absolute',
          background: 'currentcolor',
          transition: `transform ${motionDurationSlow} ease-out`,
          content: '""'
        },
        '&::before': {
          top: expandIconHalfInner,
          insetInlineEnd: expandIconLineOffset,
          insetInlineStart: expandIconLineOffset,
          height: lineWidth
        },
        '&::after': {
          top: expandIconLineOffset,
          bottom: expandIconLineOffset,
          insetInlineStart: expandIconHalfInner,
          width: lineWidth,
          transform: 'rotate(90deg)'
        },
        // Motion effect
        '&-collapsed::before': {
          transform: 'rotate(-180deg)'
        },
        '&-collapsed::after': {
          transform: 'rotate(0deg)'
        },
        '&-spaced': {
          '&::before, &::after': {
            display: 'none',
            content: 'none'
          },
          background: 'transparent',
          border: 0,
          visibility: 'hidden'
        }
      }),
      [`${componentCls}-row-indent + ${componentCls}-row-expand-icon`]: {
        marginTop: expandIconMarginTop,
        marginInlineEnd: paddingXS
      },
      [`tr${componentCls}-expanded-row`]: {
        '&, &:hover': {
          '> th, > td': {
            background: tableExpandedRowBg
          }
        },
        // https://github.com/ant-design/ant-design/issues/25573
        [`${antCls}-descriptions-view`]: {
          display: 'flex',
          table: {
            flex: 'auto',
            width: '100%'
          }
        }
      },
      // With fixed
      [`${componentCls}-expanded-row-fixed`]: {
        position: 'relative',
        margin: `${(0,cssinjs_es/* unit */.zA)(calc(tablePaddingVertical).mul(-1).equal())} ${(0,cssinjs_es/* unit */.zA)(calc(tablePaddingHorizontal).mul(-1).equal())}`,
        padding: `${(0,cssinjs_es/* unit */.zA)(tablePaddingVertical)} ${(0,cssinjs_es/* unit */.zA)(tablePaddingHorizontal)}`
      }
    }
  };
};
/* harmony default export */ var expand = (genExpandStyle);
;// ./node_modules/antd/es/table/style/filter.js


const genFilterStyle = token => {
  const {
    componentCls,
    antCls,
    iconCls,
    tableFilterDropdownWidth,
    tableFilterDropdownSearchWidth,
    paddingXXS,
    paddingXS,
    colorText,
    lineWidth,
    lineType,
    tableBorderColor,
    headerIconColor,
    fontSizeSM,
    tablePaddingHorizontal,
    borderRadius,
    motionDurationSlow,
    colorTextDescription,
    colorPrimary,
    tableHeaderFilterActiveBg,
    colorTextDisabled,
    tableFilterDropdownBg,
    tableFilterDropdownHeight,
    controlItemBgHover,
    controlItemBgActive,
    boxShadowSecondary,
    filterDropdownMenuBg,
    calc
  } = token;
  const dropdownPrefixCls = `${antCls}-dropdown`;
  const tableFilterDropdownPrefixCls = `${componentCls}-filter-dropdown`;
  const treePrefixCls = `${antCls}-tree`;
  const tableBorder = `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${tableBorderColor}`;
  return [{
    [`${componentCls}-wrapper`]: {
      [`${componentCls}-filter-column`]: {
        display: 'flex',
        justifyContent: 'space-between'
      },
      [`${componentCls}-filter-trigger`]: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        marginBlock: calc(paddingXXS).mul(-1).equal(),
        marginInline: `${(0,cssinjs_es/* unit */.zA)(paddingXXS)} ${(0,cssinjs_es/* unit */.zA)(calc(tablePaddingHorizontal).div(2).mul(-1).equal())}`,
        padding: `0 ${(0,cssinjs_es/* unit */.zA)(paddingXXS)}`,
        color: headerIconColor,
        fontSize: fontSizeSM,
        borderRadius,
        cursor: 'pointer',
        transition: `all ${motionDurationSlow}`,
        '&:hover': {
          color: colorTextDescription,
          background: tableHeaderFilterActiveBg
        },
        '&.active': {
          color: colorPrimary
        }
      }
    }
  }, {
    // Dropdown
    [`${antCls}-dropdown`]: {
      [tableFilterDropdownPrefixCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
        minWidth: tableFilterDropdownWidth,
        backgroundColor: tableFilterDropdownBg,
        borderRadius,
        boxShadow: boxShadowSecondary,
        overflow: 'hidden',
        // Reset menu
        [`${dropdownPrefixCls}-menu`]: {
          // https://github.com/ant-design/ant-design/issues/4916
          // https://github.com/ant-design/ant-design/issues/19542
          maxHeight: tableFilterDropdownHeight,
          overflowX: 'hidden',
          border: 0,
          boxShadow: 'none',
          borderRadius: 'unset',
          backgroundColor: filterDropdownMenuBg,
          '&:empty::after': {
            display: 'block',
            padding: `${(0,cssinjs_es/* unit */.zA)(paddingXS)} 0`,
            color: colorTextDisabled,
            fontSize: fontSizeSM,
            textAlign: 'center',
            content: '"Not Found"'
          }
        },
        [`${tableFilterDropdownPrefixCls}-tree`]: {
          paddingBlock: `${(0,cssinjs_es/* unit */.zA)(paddingXS)} 0`,
          paddingInline: paddingXS,
          [treePrefixCls]: {
            padding: 0
          },
          [`${treePrefixCls}-treenode ${treePrefixCls}-node-content-wrapper:hover`]: {
            backgroundColor: controlItemBgHover
          },
          [`${treePrefixCls}-treenode-checkbox-checked ${treePrefixCls}-node-content-wrapper`]: {
            '&, &:hover': {
              backgroundColor: controlItemBgActive
            }
          }
        },
        [`${tableFilterDropdownPrefixCls}-search`]: {
          padding: paddingXS,
          borderBottom: tableBorder,
          '&-input': {
            input: {
              minWidth: tableFilterDropdownSearchWidth
            },
            [iconCls]: {
              color: colorTextDisabled
            }
          }
        },
        [`${tableFilterDropdownPrefixCls}-checkall`]: {
          width: '100%',
          marginBottom: paddingXXS,
          marginInlineStart: paddingXXS
        },
        // Operation
        [`${tableFilterDropdownPrefixCls}-btns`]: {
          display: 'flex',
          justifyContent: 'space-between',
          padding: `${(0,cssinjs_es/* unit */.zA)(calc(paddingXS).sub(lineWidth).equal())} ${(0,cssinjs_es/* unit */.zA)(paddingXS)}`,
          overflow: 'hidden',
          borderTop: tableBorder
        }
      })
    }
  },
  // Dropdown Menu & SubMenu
  {
    // submenu of table filter dropdown
    [`${antCls}-dropdown ${tableFilterDropdownPrefixCls}, ${tableFilterDropdownPrefixCls}-submenu`]: {
      // Checkbox
      [`${antCls}-checkbox-wrapper + span`]: {
        paddingInlineStart: paddingXS,
        color: colorText
      },
      '> ul': {
        maxHeight: 'calc(100vh - 130px)',
        overflowX: 'hidden',
        overflowY: 'auto'
      }
    }
  }];
};
/* harmony default export */ var filter = (genFilterStyle);
;// ./node_modules/antd/es/table/style/fixed.js
const genFixedStyle = token => {
  const {
    componentCls,
    lineWidth,
    colorSplit,
    motionDurationSlow,
    zIndexTableFixed,
    tableBg,
    zIndexTableSticky,
    calc
  } = token;
  const shadowColor = colorSplit;
  // Follow style is magic of shadow which should not follow token:
  return {
    [`${componentCls}-wrapper`]: {
      [`
        ${componentCls}-cell-fix-left,
        ${componentCls}-cell-fix-right
      `]: {
        position: 'sticky !important',
        zIndex: zIndexTableFixed,
        background: tableBg
      },
      [`
        ${componentCls}-cell-fix-left-first::after,
        ${componentCls}-cell-fix-left-last::after
      `]: {
        position: 'absolute',
        top: 0,
        right: {
          _skip_check_: true,
          value: 0
        },
        bottom: calc(lineWidth).mul(-1).equal(),
        width: 30,
        transform: 'translateX(100%)',
        transition: `box-shadow ${motionDurationSlow}`,
        content: '""',
        pointerEvents: 'none'
      },
      [`${componentCls}-cell-fix-left-all::after`]: {
        display: 'none'
      },
      [`
        ${componentCls}-cell-fix-right-first::after,
        ${componentCls}-cell-fix-right-last::after
      `]: {
        position: 'absolute',
        top: 0,
        bottom: calc(lineWidth).mul(-1).equal(),
        left: {
          _skip_check_: true,
          value: 0
        },
        width: 30,
        transform: 'translateX(-100%)',
        transition: `box-shadow ${motionDurationSlow}`,
        content: '""',
        pointerEvents: 'none'
      },
      [`${componentCls}-container`]: {
        position: 'relative',
        '&::before, &::after': {
          position: 'absolute',
          top: 0,
          bottom: 0,
          zIndex: calc(zIndexTableSticky).add(1).equal({
            unit: false
          }),
          width: 30,
          transition: `box-shadow ${motionDurationSlow}`,
          content: '""',
          pointerEvents: 'none'
        },
        '&::before': {
          insetInlineStart: 0
        },
        '&::after': {
          insetInlineEnd: 0
        }
      },
      [`${componentCls}-ping-left`]: {
        [`&:not(${componentCls}-has-fix-left) ${componentCls}-container::before`]: {
          boxShadow: `inset 10px 0 8px -8px ${shadowColor}`
        },
        [`
          ${componentCls}-cell-fix-left-first::after,
          ${componentCls}-cell-fix-left-last::after
        `]: {
          boxShadow: `inset 10px 0 8px -8px ${shadowColor}`
        },
        [`${componentCls}-cell-fix-left-last::before`]: {
          backgroundColor: 'transparent !important'
        }
      },
      [`${componentCls}-ping-right`]: {
        [`&:not(${componentCls}-has-fix-right) ${componentCls}-container::after`]: {
          boxShadow: `inset -10px 0 8px -8px ${shadowColor}`
        },
        [`
          ${componentCls}-cell-fix-right-first::after,
          ${componentCls}-cell-fix-right-last::after
        `]: {
          boxShadow: `inset -10px 0 8px -8px ${shadowColor}`
        }
      },
      // Gapped fixed Columns do not show the shadow
      [`${componentCls}-fixed-column-gapped`]: {
        [`
        ${componentCls}-cell-fix-left-first::after,
        ${componentCls}-cell-fix-left-last::after,
        ${componentCls}-cell-fix-right-first::after,
        ${componentCls}-cell-fix-right-last::after
      `]: {
          boxShadow: 'none'
        }
      }
    }
  };
};
/* harmony default export */ var fixed = (genFixedStyle);
;// ./node_modules/antd/es/table/style/pagination.js

const genPaginationStyle = token => {
  const {
    componentCls,
    antCls,
    margin
  } = token;
  return {
    [`${componentCls}-wrapper`]: {
      // ========================== Pagination ==========================
      [`${componentCls}-pagination${antCls}-pagination`]: {
        margin: `${(0,cssinjs_es/* unit */.zA)(margin)} 0`
      },
      [`${componentCls}-pagination`]: {
        display: 'flex',
        flexWrap: 'wrap',
        rowGap: token.paddingXS,
        '> *': {
          flex: 'none'
        },
        '&-left': {
          justifyContent: 'flex-start'
        },
        '&-center': {
          justifyContent: 'center'
        },
        '&-right': {
          justifyContent: 'flex-end'
        }
      }
    }
  };
};
/* harmony default export */ var pagination = (genPaginationStyle);
;// ./node_modules/antd/es/table/style/radius.js

const genRadiusStyle = token => {
  const {
    componentCls,
    tableRadius
  } = token;
  return {
    [`${componentCls}-wrapper`]: {
      [componentCls]: {
        // https://github.com/ant-design/ant-design/issues/39115#issuecomment-1362314574
        [`${componentCls}-title, ${componentCls}-header`]: {
          borderRadius: `${(0,cssinjs_es/* unit */.zA)(tableRadius)} ${(0,cssinjs_es/* unit */.zA)(tableRadius)} 0 0`
        },
        [`${componentCls}-title + ${componentCls}-container`]: {
          borderStartStartRadius: 0,
          borderStartEndRadius: 0,
          // https://github.com/ant-design/ant-design/issues/41975
          [`${componentCls}-header, table`]: {
            borderRadius: 0
          },
          'table > thead > tr:first-child': {
            'th:first-child, th:last-child, td:first-child, td:last-child': {
              borderRadius: 0
            }
          }
        },
        '&-container': {
          borderStartStartRadius: tableRadius,
          borderStartEndRadius: tableRadius,
          'table > thead > tr:first-child': {
            '> *:first-child': {
              borderStartStartRadius: tableRadius
            },
            '> *:last-child': {
              borderStartEndRadius: tableRadius
            }
          }
        },
        '&-footer': {
          borderRadius: `0 0 ${(0,cssinjs_es/* unit */.zA)(tableRadius)} ${(0,cssinjs_es/* unit */.zA)(tableRadius)}`
        }
      }
    }
  };
};
/* harmony default export */ var radius = (genRadiusStyle);
;// ./node_modules/antd/es/table/style/rtl.js
const genStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [`${componentCls}-wrapper-rtl`]: {
      direction: 'rtl',
      table: {
        direction: 'rtl'
      },
      [`${componentCls}-pagination-left`]: {
        justifyContent: 'flex-end'
      },
      [`${componentCls}-pagination-right`]: {
        justifyContent: 'flex-start'
      },
      [`${componentCls}-row-expand-icon`]: {
        float: 'right',
        '&::after': {
          transform: 'rotate(-90deg)'
        },
        '&-collapsed::before': {
          transform: 'rotate(180deg)'
        },
        '&-collapsed::after': {
          transform: 'rotate(0deg)'
        }
      },
      [`${componentCls}-container`]: {
        '&::before': {
          insetInlineStart: 'unset',
          insetInlineEnd: 0
        },
        '&::after': {
          insetInlineStart: 0,
          insetInlineEnd: 'unset'
        },
        [`${componentCls}-row-indent`]: {
          float: 'right'
        }
      }
    }
  };
};
/* harmony default export */ var rtl = (genStyle);
;// ./node_modules/antd/es/table/style/selection.js

const genSelectionStyle = token => {
  const {
    componentCls,
    antCls,
    iconCls,
    fontSizeIcon,
    padding,
    paddingXS,
    headerIconColor,
    headerIconHoverColor,
    tableSelectionColumnWidth,
    tableSelectedRowBg,
    tableSelectedRowHoverBg,
    tableRowHoverBg,
    tablePaddingHorizontal,
    calc
  } = token;
  return {
    [`${componentCls}-wrapper`]: {
      // ========================== Selections ==========================
      [`${componentCls}-selection-col`]: {
        width: tableSelectionColumnWidth,
        [`&${componentCls}-selection-col-with-dropdown`]: {
          width: calc(tableSelectionColumnWidth).add(fontSizeIcon).add(calc(padding).div(4)).equal()
        }
      },
      [`${componentCls}-bordered ${componentCls}-selection-col`]: {
        width: calc(tableSelectionColumnWidth).add(calc(paddingXS).mul(2)).equal(),
        [`&${componentCls}-selection-col-with-dropdown`]: {
          width: calc(tableSelectionColumnWidth).add(fontSizeIcon).add(calc(padding).div(4)).add(calc(paddingXS).mul(2)).equal()
        }
      },
      [`
        table tr th${componentCls}-selection-column,
        table tr td${componentCls}-selection-column,
        ${componentCls}-selection-column
      `]: {
        paddingInlineEnd: token.paddingXS,
        paddingInlineStart: token.paddingXS,
        textAlign: 'center',
        [`${antCls}-radio-wrapper`]: {
          marginInlineEnd: 0
        }
      },
      [`table tr th${componentCls}-selection-column${componentCls}-cell-fix-left`]: {
        zIndex: calc(token.zIndexTableFixed).add(1).equal({
          unit: false
        })
      },
      [`table tr th${componentCls}-selection-column::after`]: {
        backgroundColor: 'transparent !important'
      },
      [`${componentCls}-selection`]: {
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column'
      },
      [`${componentCls}-selection-extra`]: {
        position: 'absolute',
        top: 0,
        zIndex: 1,
        cursor: 'pointer',
        transition: `all ${token.motionDurationSlow}`,
        marginInlineStart: '100%',
        paddingInlineStart: (0,cssinjs_es/* unit */.zA)(calc(tablePaddingHorizontal).div(4).equal()),
        [iconCls]: {
          color: headerIconColor,
          fontSize: fontSizeIcon,
          verticalAlign: 'baseline',
          '&:hover': {
            color: headerIconHoverColor
          }
        }
      },
      // ============================= Rows =============================
      [`${componentCls}-tbody`]: {
        [`${componentCls}-row`]: {
          [`&${componentCls}-row-selected`]: {
            [`> ${componentCls}-cell`]: {
              background: tableSelectedRowBg,
              '&-row-hover': {
                background: tableSelectedRowHoverBg
              }
            }
          },
          [`> ${componentCls}-cell-row-hover`]: {
            background: tableRowHoverBg
          }
        }
      }
    }
  };
};
/* harmony default export */ var selection = (genSelectionStyle);
;// ./node_modules/antd/es/table/style/size.js

const genSizeStyle = token => {
  const {
    componentCls,
    tableExpandColumnWidth,
    calc
  } = token;
  const getSizeStyle = (size, paddingVertical, paddingHorizontal, fontSize) => ({
    [`${componentCls}${componentCls}-${size}`]: {
      fontSize,
      [`
        ${componentCls}-title,
        ${componentCls}-footer,
        ${componentCls}-cell,
        ${componentCls}-thead > tr > th,
        ${componentCls}-tbody > tr > th,
        ${componentCls}-tbody > tr > td,
        tfoot > tr > th,
        tfoot > tr > td
      `]: {
        padding: `${(0,cssinjs_es/* unit */.zA)(paddingVertical)} ${(0,cssinjs_es/* unit */.zA)(paddingHorizontal)}`
      },
      [`${componentCls}-filter-trigger`]: {
        marginInlineEnd: (0,cssinjs_es/* unit */.zA)(calc(paddingHorizontal).div(2).mul(-1).equal())
      },
      [`${componentCls}-expanded-row-fixed`]: {
        margin: `${(0,cssinjs_es/* unit */.zA)(calc(paddingVertical).mul(-1).equal())} ${(0,cssinjs_es/* unit */.zA)(calc(paddingHorizontal).mul(-1).equal())}`
      },
      [`${componentCls}-tbody`]: {
        // ========================= Nest Table ===========================
        [`${componentCls}-wrapper:only-child ${componentCls}`]: {
          marginBlock: (0,cssinjs_es/* unit */.zA)(calc(paddingVertical).mul(-1).equal()),
          marginInline: `${(0,cssinjs_es/* unit */.zA)(calc(tableExpandColumnWidth).sub(paddingHorizontal).equal())} ${(0,cssinjs_es/* unit */.zA)(calc(paddingHorizontal).mul(-1).equal())}`
        }
      },
      // https://github.com/ant-design/ant-design/issues/35167
      [`${componentCls}-selection-extra`]: {
        paddingInlineStart: (0,cssinjs_es/* unit */.zA)(calc(paddingHorizontal).div(4).equal())
      }
    }
  });
  return {
    [`${componentCls}-wrapper`]: Object.assign(Object.assign({}, getSizeStyle('middle', token.tablePaddingVerticalMiddle, token.tablePaddingHorizontalMiddle, token.tableFontSizeMiddle)), getSizeStyle('small', token.tablePaddingVerticalSmall, token.tablePaddingHorizontalSmall, token.tableFontSizeSmall))
  };
};
/* harmony default export */ var size = (genSizeStyle);
;// ./node_modules/antd/es/table/style/sorter.js
const genSorterStyle = token => {
  const {
    componentCls,
    marginXXS,
    fontSizeIcon,
    headerIconColor,
    headerIconHoverColor
  } = token;
  return {
    [`${componentCls}-wrapper`]: {
      [`${componentCls}-thead th${componentCls}-column-has-sorters`]: {
        outline: 'none',
        cursor: 'pointer',
        // why left 0s? Avoid column header move with transition when left is changed
        // https://github.com/ant-design/ant-design/issues/50588
        transition: `all ${token.motionDurationSlow}, left 0s`,
        '&:hover': {
          background: token.tableHeaderSortHoverBg,
          '&::before': {
            backgroundColor: 'transparent !important'
          }
        },
        '&:focus-visible': {
          color: token.colorPrimary
        },
        // https://github.com/ant-design/ant-design/issues/30969
        [`
          &${componentCls}-cell-fix-left:hover,
          &${componentCls}-cell-fix-right:hover
        `]: {
          background: token.tableFixedHeaderSortActiveBg
        }
      },
      [`${componentCls}-thead th${componentCls}-column-sort`]: {
        background: token.tableHeaderSortBg,
        '&::before': {
          backgroundColor: 'transparent !important'
        }
      },
      [`td${componentCls}-column-sort`]: {
        background: token.tableBodySortBg
      },
      [`${componentCls}-column-title`]: {
        position: 'relative',
        zIndex: 1,
        flex: 1
      },
      [`${componentCls}-column-sorters`]: {
        display: 'flex',
        flex: 'auto',
        alignItems: 'center',
        justifyContent: 'space-between',
        '&::after': {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          content: '""'
        }
      },
      [`${componentCls}-column-sorters-tooltip-target-sorter`]: {
        '&::after': {
          content: 'none'
        }
      },
      [`${componentCls}-column-sorter`]: {
        marginInlineStart: marginXXS,
        color: headerIconColor,
        fontSize: 0,
        transition: `color ${token.motionDurationSlow}`,
        '&-inner': {
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center'
        },
        '&-up, &-down': {
          fontSize: fontSizeIcon,
          '&.active': {
            color: token.colorPrimary
          }
        },
        [`${componentCls}-column-sorter-up + ${componentCls}-column-sorter-down`]: {
          marginTop: '-0.3em'
        }
      },
      [`${componentCls}-column-sorters:hover ${componentCls}-column-sorter`]: {
        color: headerIconHoverColor
      }
    }
  };
};
/* harmony default export */ var sorter = (genSorterStyle);
;// ./node_modules/antd/es/table/style/sticky.js

const genStickyStyle = token => {
  const {
    componentCls,
    opacityLoading,
    tableScrollThumbBg,
    tableScrollThumbBgHover,
    tableScrollThumbSize,
    tableScrollBg,
    zIndexTableSticky,
    stickyScrollBarBorderRadius,
    lineWidth,
    lineType,
    tableBorderColor
  } = token;
  const tableBorder = `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${tableBorderColor}`;
  return {
    [`${componentCls}-wrapper`]: {
      [`${componentCls}-sticky`]: {
        '&-holder': {
          position: 'sticky',
          zIndex: zIndexTableSticky,
          background: token.colorBgContainer
        },
        '&-scroll': {
          position: 'sticky',
          bottom: 0,
          height: `${(0,cssinjs_es/* unit */.zA)(tableScrollThumbSize)} !important`,
          zIndex: zIndexTableSticky,
          display: 'flex',
          alignItems: 'center',
          background: tableScrollBg,
          borderTop: tableBorder,
          opacity: opacityLoading,
          '&:hover': {
            transformOrigin: 'center bottom'
          },
          // fake scrollbar style of sticky
          '&-bar': {
            height: tableScrollThumbSize,
            backgroundColor: tableScrollThumbBg,
            borderRadius: stickyScrollBarBorderRadius,
            transition: `all ${token.motionDurationSlow}, transform none`,
            position: 'absolute',
            bottom: 0,
            '&:hover, &-active': {
              backgroundColor: tableScrollThumbBgHover
            }
          }
        }
      }
    }
  };
};
/* harmony default export */ var sticky = (genStickyStyle);
;// ./node_modules/antd/es/table/style/summary.js

const genSummaryStyle = token => {
  const {
    componentCls,
    lineWidth,
    tableBorderColor,
    calc
  } = token;
  const tableBorder = `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${token.lineType} ${tableBorderColor}`;
  return {
    [`${componentCls}-wrapper`]: {
      [`${componentCls}-summary`]: {
        position: 'relative',
        zIndex: token.zIndexTableFixed,
        background: token.tableBg,
        '> tr': {
          '> th, > td': {
            borderBottom: tableBorder
          }
        }
      },
      [`div${componentCls}-summary`]: {
        boxShadow: `0 ${(0,cssinjs_es/* unit */.zA)(calc(lineWidth).mul(-1).equal())} 0 ${tableBorderColor}`
      }
    }
  };
};
/* harmony default export */ var summary = (genSummaryStyle);
;// ./node_modules/antd/es/table/style/virtual.js

const genVirtualStyle = token => {
  const {
    componentCls,
    motionDurationMid,
    lineWidth,
    lineType,
    tableBorderColor,
    calc
  } = token;
  const tableBorder = `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${tableBorderColor}`;
  const rowCellCls = `${componentCls}-expanded-row-cell`;
  return {
    [`${componentCls}-wrapper`]: {
      // ========================== Row ==========================
      [`${componentCls}-tbody-virtual`]: {
        [`${componentCls}-tbody-virtual-holder-inner`]: {
          [`
            & > ${componentCls}-row, 
            & > div:not(${componentCls}-row) > ${componentCls}-row
          `]: {
            display: 'flex',
            boxSizing: 'border-box',
            width: '100%'
          }
        },
        [`${componentCls}-cell`]: {
          borderBottom: tableBorder,
          transition: `background ${motionDurationMid}`
        },
        [`${componentCls}-expanded-row`]: {
          [`${rowCellCls}${rowCellCls}-fixed`]: {
            position: 'sticky',
            insetInlineStart: 0,
            overflow: 'hidden',
            width: `calc(var(--virtual-width) - ${(0,cssinjs_es/* unit */.zA)(lineWidth)})`,
            borderInlineEnd: 'none'
          }
        }
      },
      // ======================== Border =========================
      [`${componentCls}-bordered`]: {
        [`${componentCls}-tbody-virtual`]: {
          '&:after': {
            content: '""',
            insetInline: 0,
            bottom: 0,
            borderBottom: tableBorder,
            position: 'absolute'
          },
          [`${componentCls}-cell`]: {
            borderInlineEnd: tableBorder,
            [`&${componentCls}-cell-fix-right-first:before`]: {
              content: '""',
              position: 'absolute',
              insetBlock: 0,
              insetInlineStart: calc(lineWidth).mul(-1).equal(),
              borderInlineStart: tableBorder
            }
          }
        },
        // Empty placeholder
        [`&${componentCls}-virtual`]: {
          [`${componentCls}-placeholder ${componentCls}-cell`]: {
            borderInlineEnd: tableBorder,
            borderBottom: tableBorder
          }
        }
      }
    }
  };
};
/* harmony default export */ var virtual = (genVirtualStyle);
;// ./node_modules/antd/es/table/style/index.js



















const genTableStyle = token => {
  const {
    componentCls,
    fontWeightStrong,
    tablePaddingVertical,
    tablePaddingHorizontal,
    tableExpandColumnWidth,
    lineWidth,
    lineType,
    tableBorderColor,
    tableFontSize,
    tableBg,
    tableRadius,
    tableHeaderTextColor,
    motionDurationMid,
    tableHeaderBg,
    tableHeaderCellSplitColor,
    tableFooterTextColor,
    tableFooterBg,
    calc
  } = token;
  const tableBorder = `${(0,cssinjs_es/* unit */.zA)(lineWidth)} ${lineType} ${tableBorderColor}`;
  return {
    [`${componentCls}-wrapper`]: Object.assign(Object.assign({
      clear: 'both',
      maxWidth: '100%'
    }, (0,style/* clearFix */.t6)()), {
      [componentCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
        fontSize: tableFontSize,
        background: tableBg,
        borderRadius: `${(0,cssinjs_es/* unit */.zA)(tableRadius)} ${(0,cssinjs_es/* unit */.zA)(tableRadius)} 0 0`,
        // https://github.com/ant-design/ant-design/issues/47486
        scrollbarColor: `${token.tableScrollThumbBg} ${token.tableScrollBg}`
      }),
      // https://github.com/ant-design/ant-design/issues/17611
      table: {
        width: '100%',
        textAlign: 'start',
        borderRadius: `${(0,cssinjs_es/* unit */.zA)(tableRadius)} ${(0,cssinjs_es/* unit */.zA)(tableRadius)} 0 0`,
        borderCollapse: 'separate',
        borderSpacing: 0
      },
      // ============================= Cell ==============================
      [`
          ${componentCls}-cell,
          ${componentCls}-thead > tr > th,
          ${componentCls}-tbody > tr > th,
          ${componentCls}-tbody > tr > td,
          tfoot > tr > th,
          tfoot > tr > td
        `]: {
        position: 'relative',
        padding: `${(0,cssinjs_es/* unit */.zA)(tablePaddingVertical)} ${(0,cssinjs_es/* unit */.zA)(tablePaddingHorizontal)}`,
        overflowWrap: 'break-word'
      },
      // ============================ Title =============================
      [`${componentCls}-title`]: {
        padding: `${(0,cssinjs_es/* unit */.zA)(tablePaddingVertical)} ${(0,cssinjs_es/* unit */.zA)(tablePaddingHorizontal)}`
      },
      // ============================ Header ============================
      [`${componentCls}-thead`]: {
        [`
          > tr > th,
          > tr > td
        `]: {
          position: 'relative',
          color: tableHeaderTextColor,
          fontWeight: fontWeightStrong,
          textAlign: 'start',
          background: tableHeaderBg,
          borderBottom: tableBorder,
          transition: `background ${motionDurationMid} ease`,
          "&[colspan]:not([colspan='1'])": {
            textAlign: 'center'
          },
          [`&:not(:last-child):not(${componentCls}-selection-column):not(${componentCls}-row-expand-icon-cell):not([colspan])::before`]: {
            position: 'absolute',
            top: '50%',
            insetInlineEnd: 0,
            width: 1,
            height: '1.6em',
            backgroundColor: tableHeaderCellSplitColor,
            transform: 'translateY(-50%)',
            transition: `background-color ${motionDurationMid}`,
            content: '""'
          }
        },
        '> tr:not(:last-child) > th[colspan]': {
          borderBottom: 0
        }
      },
      // ============================ Body ============================
      [`${componentCls}-tbody`]: {
        '> tr': {
          '> th, > td': {
            transition: `background ${motionDurationMid}, border-color ${motionDurationMid}`,
            borderBottom: tableBorder,
            // ========================= Nest Table ===========================
            [`
              > ${componentCls}-wrapper:only-child,
              > ${componentCls}-expanded-row-fixed > ${componentCls}-wrapper:only-child
            `]: {
              [componentCls]: {
                marginBlock: (0,cssinjs_es/* unit */.zA)(calc(tablePaddingVertical).mul(-1).equal()),
                marginInline: `${(0,cssinjs_es/* unit */.zA)(calc(tableExpandColumnWidth).sub(tablePaddingHorizontal).equal())}
                ${(0,cssinjs_es/* unit */.zA)(calc(tablePaddingHorizontal).mul(-1).equal())}`,
                [`${componentCls}-tbody > tr:last-child > td`]: {
                  borderBottom: 0,
                  '&:first-child, &:last-child': {
                    borderRadius: 0
                  }
                }
              }
            }
          },
          '> th': {
            position: 'relative',
            color: tableHeaderTextColor,
            fontWeight: fontWeightStrong,
            textAlign: 'start',
            background: tableHeaderBg,
            borderBottom: tableBorder,
            transition: `background ${motionDurationMid} ease`
          }
        }
      },
      // ============================ Footer ============================
      [`${componentCls}-footer`]: {
        padding: `${(0,cssinjs_es/* unit */.zA)(tablePaddingVertical)} ${(0,cssinjs_es/* unit */.zA)(tablePaddingHorizontal)}`,
        color: tableFooterTextColor,
        background: tableFooterBg
      }
    })
  };
};
const table_style_prepareComponentToken = token => {
  const {
    colorFillAlter,
    colorBgContainer,
    colorTextHeading,
    colorFillSecondary,
    colorFillContent,
    controlItemBgActive,
    controlItemBgActiveHover,
    padding,
    paddingSM,
    paddingXS,
    colorBorderSecondary,
    borderRadiusLG,
    controlHeight,
    colorTextPlaceholder,
    fontSize,
    fontSizeSM,
    lineHeight,
    lineWidth,
    colorIcon,
    colorIconHover,
    opacityLoading,
    controlInteractiveSize
  } = token;
  const colorFillSecondarySolid = new dist_module/* TinyColor */.q(colorFillSecondary).onBackground(colorBgContainer).toHexShortString();
  const colorFillContentSolid = new dist_module/* TinyColor */.q(colorFillContent).onBackground(colorBgContainer).toHexShortString();
  const colorFillAlterSolid = new dist_module/* TinyColor */.q(colorFillAlter).onBackground(colorBgContainer).toHexShortString();
  const baseColorAction = new dist_module/* TinyColor */.q(colorIcon);
  const baseColorActionHover = new dist_module/* TinyColor */.q(colorIconHover);
  const expandIconHalfInner = controlInteractiveSize / 2 - lineWidth;
  const expandIconSize = expandIconHalfInner * 2 + lineWidth * 3;
  return {
    headerBg: colorFillAlterSolid,
    headerColor: colorTextHeading,
    headerSortActiveBg: colorFillSecondarySolid,
    headerSortHoverBg: colorFillContentSolid,
    bodySortBg: colorFillAlterSolid,
    rowHoverBg: colorFillAlterSolid,
    rowSelectedBg: controlItemBgActive,
    rowSelectedHoverBg: controlItemBgActiveHover,
    rowExpandedBg: colorFillAlter,
    cellPaddingBlock: padding,
    cellPaddingInline: padding,
    cellPaddingBlockMD: paddingSM,
    cellPaddingInlineMD: paddingXS,
    cellPaddingBlockSM: paddingXS,
    cellPaddingInlineSM: paddingXS,
    borderColor: colorBorderSecondary,
    headerBorderRadius: borderRadiusLG,
    footerBg: colorFillAlterSolid,
    footerColor: colorTextHeading,
    cellFontSize: fontSize,
    cellFontSizeMD: fontSize,
    cellFontSizeSM: fontSize,
    headerSplitColor: colorBorderSecondary,
    fixedHeaderSortActiveBg: colorFillSecondarySolid,
    headerFilterHoverBg: colorFillContent,
    filterDropdownMenuBg: colorBgContainer,
    filterDropdownBg: colorBgContainer,
    expandIconBg: colorBgContainer,
    selectionColumnWidth: controlHeight,
    stickyScrollBarBg: colorTextPlaceholder,
    stickyScrollBarBorderRadius: 100,
    expandIconMarginTop: (fontSize * lineHeight - lineWidth * 3) / 2 - Math.ceil((fontSizeSM * 1.4 - lineWidth * 3) / 2),
    headerIconColor: baseColorAction.clone().setAlpha(baseColorAction.getAlpha() * opacityLoading).toRgbString(),
    headerIconHoverColor: baseColorActionHover.clone().setAlpha(baseColorActionHover.getAlpha() * opacityLoading).toRgbString(),
    expandIconHalfInner,
    expandIconSize,
    expandIconScale: controlInteractiveSize / expandIconSize
  };
};
const zIndexTableFixed = 2;
// ============================== Export ==============================
/* harmony default export */ var table_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Table', token => {
  const {
    colorTextHeading,
    colorSplit,
    colorBgContainer,
    controlInteractiveSize: checkboxSize,
    headerBg,
    headerColor,
    headerSortActiveBg,
    headerSortHoverBg,
    bodySortBg,
    rowHoverBg,
    rowSelectedBg,
    rowSelectedHoverBg,
    rowExpandedBg,
    cellPaddingBlock,
    cellPaddingInline,
    cellPaddingBlockMD,
    cellPaddingInlineMD,
    cellPaddingBlockSM,
    cellPaddingInlineSM,
    borderColor,
    footerBg,
    footerColor,
    headerBorderRadius,
    cellFontSize,
    cellFontSizeMD,
    cellFontSizeSM,
    headerSplitColor,
    fixedHeaderSortActiveBg,
    headerFilterHoverBg,
    filterDropdownBg,
    expandIconBg,
    selectionColumnWidth,
    stickyScrollBarBg,
    calc
  } = token;
  const tableToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    tableFontSize: cellFontSize,
    tableBg: colorBgContainer,
    tableRadius: headerBorderRadius,
    tablePaddingVertical: cellPaddingBlock,
    tablePaddingHorizontal: cellPaddingInline,
    tablePaddingVerticalMiddle: cellPaddingBlockMD,
    tablePaddingHorizontalMiddle: cellPaddingInlineMD,
    tablePaddingVerticalSmall: cellPaddingBlockSM,
    tablePaddingHorizontalSmall: cellPaddingInlineSM,
    tableBorderColor: borderColor,
    tableHeaderTextColor: headerColor,
    tableHeaderBg: headerBg,
    tableFooterTextColor: footerColor,
    tableFooterBg: footerBg,
    tableHeaderCellSplitColor: headerSplitColor,
    tableHeaderSortBg: headerSortActiveBg,
    tableHeaderSortHoverBg: headerSortHoverBg,
    tableBodySortBg: bodySortBg,
    tableFixedHeaderSortActiveBg: fixedHeaderSortActiveBg,
    tableHeaderFilterActiveBg: headerFilterHoverBg,
    tableFilterDropdownBg: filterDropdownBg,
    tableRowHoverBg: rowHoverBg,
    tableSelectedRowBg: rowSelectedBg,
    tableSelectedRowHoverBg: rowSelectedHoverBg,
    zIndexTableFixed,
    zIndexTableSticky: calc(zIndexTableFixed).add(1).equal({
      unit: false
    }),
    tableFontSizeMiddle: cellFontSizeMD,
    tableFontSizeSmall: cellFontSizeSM,
    tableSelectionColumnWidth: selectionColumnWidth,
    tableExpandIconBg: expandIconBg,
    tableExpandColumnWidth: calc(checkboxSize).add(calc(token.padding).mul(2)).equal(),
    tableExpandedRowBg: rowExpandedBg,
    // Dropdown
    tableFilterDropdownWidth: 120,
    tableFilterDropdownHeight: 264,
    tableFilterDropdownSearchWidth: 140,
    // Virtual Scroll Bar
    tableScrollThumbSize: 8,
    // Mac scroll bar size
    tableScrollThumbBg: stickyScrollBarBg,
    tableScrollThumbBgHover: colorTextHeading,
    tableScrollBg: colorSplit
  });
  return [genTableStyle(tableToken), pagination(tableToken), summary(tableToken), sorter(tableToken), filter(tableToken), bordered(tableToken), radius(tableToken), expand(tableToken), summary(tableToken), empty(tableToken), selection(tableToken), fixed(tableToken), sticky(tableToken), ellipsis(tableToken), size(tableToken), rtl(tableToken), virtual(tableToken)];
}, table_style_prepareComponentToken, {
  unitless: {
    expandIconScale: true
  }
}));
;// ./node_modules/antd/es/table/InternalTable.js
"use client";





























const InternalTable_EMPTY_LIST = [];
const InternalTable = (props, ref) => {
  var _a, _b;
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    style,
    size: customizeSize,
    bordered,
    dropdownPrefixCls: customizeDropdownPrefixCls,
    dataSource,
    pagination,
    rowSelection,
    rowKey = 'key',
    rowClassName,
    columns,
    children,
    childrenColumnName: legacyChildrenColumnName,
    onChange,
    getPopupContainer,
    loading,
    expandIcon,
    expandable,
    expandedRowRender,
    expandIconColumnIndex,
    indentSize,
    scroll,
    sortDirections,
    locale,
    showSorterTooltip = {
      target: 'full-header'
    },
    virtual
  } = props;
  const warning = (0,_util_warning/* devUseWarning */.rJ)('Table');
  if (false) {}
  const baseColumns = react.useMemo(() => columns || convertChildrenToColumns(children), [columns, children]);
  const needResponsive = react.useMemo(() => baseColumns.some(col => col.responsive), [baseColumns]);
  const screens = (0,useBreakpoint/* default */.A)(needResponsive);
  const mergedColumns = react.useMemo(() => {
    const matched = new Set(Object.keys(screens).filter(m => screens[m]));
    return baseColumns.filter(c => !c.responsive || c.responsive.some(r => matched.has(r)));
  }, [baseColumns, screens]);
  const tableProps = (0,omit/* default */.A)(props, ['className', 'style', 'columns']);
  const {
    locale: contextLocale = en_US/* default */.A,
    direction,
    table,
    renderEmpty,
    getPrefixCls,
    getPopupContainer: getContextPopupContainer
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const mergedSize = (0,useSize/* default */.A)(customizeSize);
  const tableLocale = Object.assign(Object.assign({}, contextLocale.Table), locale);
  const rawData = dataSource || InternalTable_EMPTY_LIST;
  const prefixCls = getPrefixCls('table', customizePrefixCls);
  const dropdownPrefixCls = getPrefixCls('dropdown', customizeDropdownPrefixCls);
  const [, token] = (0,useToken/* default */.Ay)();
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = table_style(prefixCls, rootCls);
  const mergedExpandable = Object.assign(Object.assign({
    childrenColumnName: legacyChildrenColumnName,
    expandIconColumnIndex
  }, expandable), {
    expandIcon: (_a = expandable === null || expandable === void 0 ? void 0 : expandable.expandIcon) !== null && _a !== void 0 ? _a : (_b = table === null || table === void 0 ? void 0 : table.expandable) === null || _b === void 0 ? void 0 : _b.expandIcon
  });
  const {
    childrenColumnName = 'children'
  } = mergedExpandable;
  const expandType = react.useMemo(() => {
    if (rawData.some(item => item === null || item === void 0 ? void 0 : item[childrenColumnName])) {
      return 'nest';
    }
    if (expandedRowRender || (expandable === null || expandable === void 0 ? void 0 : expandable.expandedRowRender)) {
      return 'row';
    }
    return null;
  }, [rawData]);
  const internalRefs = {
    body: react.useRef()
  };
  // ============================ Width =============================
  const getContainerWidth = useContainerWidth(prefixCls);
  // ============================= Refs =============================
  const rootRef = react.useRef(null);
  const tblRef = react.useRef(null);
  useProxyImperativeHandle(ref, () => Object.assign(Object.assign({}, tblRef.current), {
    nativeElement: rootRef.current
  }));
  // ============================ RowKey ============================
  const getRowKey = react.useMemo(() => {
    if (typeof rowKey === 'function') {
      return rowKey;
    }
    return record => record === null || record === void 0 ? void 0 : record[rowKey];
  }, [rowKey]);
  const [getRecordByKey] = hooks_useLazyKVMap(rawData, childrenColumnName, getRowKey);
  // ============================ Events =============================
  const changeEventInfo = {};
  const triggerOnChange = function (info, action) {
    let reset = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
    var _a, _b, _c, _d;
    const changeInfo = Object.assign(Object.assign({}, changeEventInfo), info);
    if (reset) {
      (_a = changeEventInfo.resetPagination) === null || _a === void 0 ? void 0 : _a.call(changeEventInfo);
      // Reset event param
      if ((_b = changeInfo.pagination) === null || _b === void 0 ? void 0 : _b.current) {
        changeInfo.pagination.current = 1;
      }
      // Trigger pagination events
      if (pagination) {
        (_c = pagination.onChange) === null || _c === void 0 ? void 0 : _c.call(pagination, 1, (_d = changeInfo.pagination) === null || _d === void 0 ? void 0 : _d.pageSize);
      }
    }
    if (scroll && scroll.scrollToFirstRowOnChange !== false && internalRefs.body.current) {
      scrollTo(0, {
        getContainer: () => internalRefs.body.current
      });
    }
    onChange === null || onChange === void 0 ? void 0 : onChange(changeInfo.pagination, changeInfo.filters, changeInfo.sorter, {
      currentDataSource: getFilterData(getSortData(rawData, changeInfo.sorterStates, childrenColumnName), changeInfo.filterStates, childrenColumnName),
      action
    });
  };
  /**
   * Controlled state in `columns` is not a good idea that makes too many code (1000+ line?) to read
   * state out and then put it back to title render. Move these code into `hooks` but still too
   * complex. We should provides Table props like `sorter` & `filter` to handle control in next big
   * version.
   */
  // ============================ Sorter =============================
  const onSorterChange = (sorter, sorterStates) => {
    triggerOnChange({
      sorter,
      sorterStates
    }, 'sort', false);
  };
  const [transformSorterColumns, sortStates, sorterTitleProps, getSorters] = useSorter({
    prefixCls,
    mergedColumns,
    onSorterChange,
    sortDirections: sortDirections || ['ascend', 'descend'],
    tableLocale,
    showSorterTooltip
  });
  const sortedData = react.useMemo(() => getSortData(rawData, sortStates, childrenColumnName), [rawData, sortStates]);
  changeEventInfo.sorter = getSorters();
  changeEventInfo.sorterStates = sortStates;
  // ============================ Filter ============================
  const onFilterChange = (filters, filterStates) => {
    triggerOnChange({
      filters,
      filterStates
    }, 'filter', true);
  };
  const [transformFilterColumns, filterStates, filters] = hooks_useFilter({
    prefixCls,
    locale: tableLocale,
    dropdownPrefixCls,
    mergedColumns,
    onFilterChange,
    getPopupContainer: getPopupContainer || getContextPopupContainer,
    rootClassName: classnames_default()(rootClassName, rootCls)
  });
  const mergedData = getFilterData(sortedData, filterStates, childrenColumnName);
  changeEventInfo.filters = filters;
  changeEventInfo.filterStates = filterStates;
  // ============================ Column ============================
  const columnTitleProps = react.useMemo(() => {
    const mergedFilters = {};
    Object.keys(filters).forEach(filterKey => {
      if (filters[filterKey] !== null) {
        mergedFilters[filterKey] = filters[filterKey];
      }
    });
    return Object.assign(Object.assign({}, sorterTitleProps), {
      filters: mergedFilters
    });
  }, [sorterTitleProps, filters]);
  const [transformTitleColumns] = hooks_useTitleColumns(columnTitleProps);
  // ========================== Pagination ==========================
  const onPaginationChange = (current, pageSize) => {
    triggerOnChange({
      pagination: Object.assign(Object.assign({}, changeEventInfo.pagination), {
        current,
        pageSize
      })
    }, 'paginate');
  };
  const [mergedPagination, resetPagination] = hooks_usePagination(mergedData.length, onPaginationChange, pagination);
  changeEventInfo.pagination = pagination === false ? {} : getPaginationParam(mergedPagination, pagination);
  changeEventInfo.resetPagination = resetPagination;
  // ============================= Data =============================
  const pageData = react.useMemo(() => {
    if (pagination === false || !mergedPagination.pageSize) {
      return mergedData;
    }
    const {
      current = 1,
      total,
      pageSize = DEFAULT_PAGE_SIZE
    } = mergedPagination;
     false ? 0 : void 0;
    // Dynamic table data
    if (mergedData.length < total) {
      if (mergedData.length > pageSize) {
         false ? 0 : void 0;
        return mergedData.slice((current - 1) * pageSize, current * pageSize);
      }
      return mergedData;
    }
    return mergedData.slice((current - 1) * pageSize, current * pageSize);
  }, [!!pagination, mergedData, mergedPagination === null || mergedPagination === void 0 ? void 0 : mergedPagination.current, mergedPagination === null || mergedPagination === void 0 ? void 0 : mergedPagination.pageSize, mergedPagination === null || mergedPagination === void 0 ? void 0 : mergedPagination.total]);
  // ========================== Selections ==========================
  const [transformSelectionColumns, selectedKeySet] = hooks_useSelection({
    prefixCls,
    data: mergedData,
    pageData,
    getRowKey,
    getRecordByKey,
    expandType,
    childrenColumnName,
    locale: tableLocale,
    getPopupContainer: getPopupContainer || getContextPopupContainer
  }, rowSelection);
  const internalRowClassName = (record, index, indent) => {
    let mergedRowClassName;
    if (typeof rowClassName === 'function') {
      mergedRowClassName = classnames_default()(rowClassName(record, index, indent));
    } else {
      mergedRowClassName = classnames_default()(rowClassName);
    }
    return classnames_default()({
      [`${prefixCls}-row-selected`]: selectedKeySet.has(getRowKey(record, index))
    }, mergedRowClassName);
  };
  // ========================== Expandable ==========================
  // Pass origin render status into `rc-table`, this can be removed when refactor with `rc-table`
  mergedExpandable.__PARENT_RENDER_ICON__ = mergedExpandable.expandIcon;
  // Customize expandable icon
  mergedExpandable.expandIcon = mergedExpandable.expandIcon || expandIcon || ExpandIcon(tableLocale);
  // Adjust expand icon index, no overwrite expandIconColumnIndex if set.
  if (expandType === 'nest' && mergedExpandable.expandIconColumnIndex === undefined) {
    mergedExpandable.expandIconColumnIndex = rowSelection ? 1 : 0;
  } else if (mergedExpandable.expandIconColumnIndex > 0 && rowSelection) {
    mergedExpandable.expandIconColumnIndex -= 1;
  }
  // Indent size
  if (typeof mergedExpandable.indentSize !== 'number') {
    mergedExpandable.indentSize = typeof indentSize === 'number' ? indentSize : 15;
  }
  // ============================ Render ============================
  const transformColumns = react.useCallback(innerColumns => transformTitleColumns(transformSelectionColumns(transformFilterColumns(transformSorterColumns(innerColumns)))), [transformSorterColumns, transformFilterColumns, transformSelectionColumns]);
  let topPaginationNode;
  let bottomPaginationNode;
  if (pagination !== false && (mergedPagination === null || mergedPagination === void 0 ? void 0 : mergedPagination.total)) {
    let paginationSize;
    if (mergedPagination.size) {
      paginationSize = mergedPagination.size;
    } else {
      paginationSize = mergedSize === 'small' || mergedSize === 'middle' ? 'small' : undefined;
    }
    const renderPagination = position => (/*#__PURE__*/react.createElement(es_pagination/* default */.A, Object.assign({}, mergedPagination, {
      className: classnames_default()(`${prefixCls}-pagination ${prefixCls}-pagination-${position}`, mergedPagination.className),
      size: paginationSize
    })));
    const defaultPosition = direction === 'rtl' ? 'left' : 'right';
    const {
      position
    } = mergedPagination;
    if (position !== null && Array.isArray(position)) {
      const topPos = position.find(p => p.includes('top'));
      const bottomPos = position.find(p => p.includes('bottom'));
      const isDisable = position.every(p => `${p}` === 'none');
      if (!topPos && !bottomPos && !isDisable) {
        bottomPaginationNode = renderPagination(defaultPosition);
      }
      if (topPos) {
        topPaginationNode = renderPagination(topPos.toLowerCase().replace('top', ''));
      }
      if (bottomPos) {
        bottomPaginationNode = renderPagination(bottomPos.toLowerCase().replace('bottom', ''));
      }
    } else {
      bottomPaginationNode = renderPagination(defaultPosition);
    }
  }
  // >>>>>>>>> Spinning
  let spinProps;
  if (typeof loading === 'boolean') {
    spinProps = {
      spinning: loading
    };
  } else if (typeof loading === 'object') {
    spinProps = Object.assign({
      spinning: true
    }, loading);
  }
  const wrapperClassNames = classnames_default()(cssVarCls, rootCls, `${prefixCls}-wrapper`, table === null || table === void 0 ? void 0 : table.className, {
    [`${prefixCls}-wrapper-rtl`]: direction === 'rtl'
  }, className, rootClassName, hashId);
  const mergedStyle = Object.assign(Object.assign({}, table === null || table === void 0 ? void 0 : table.style), style);
  const emptyText = typeof (locale === null || locale === void 0 ? void 0 : locale.emptyText) !== 'undefined' ? locale.emptyText : (renderEmpty === null || renderEmpty === void 0 ? void 0 : renderEmpty('Table')) || /*#__PURE__*/react.createElement(defaultRenderEmpty/* default */.A, {
    componentName: "Table"
  });
  // ========================== Render ==========================
  const TableComponent = virtual ? RcTable_VirtualTable : table_RcTable;
  // >>> Virtual Table props. We set height here since it will affect height collection
  const virtualProps = {};
  const listItemHeight = react.useMemo(() => {
    const {
      fontSize,
      lineHeight,
      padding,
      paddingXS,
      paddingSM
    } = token;
    const fontHeight = Math.floor(fontSize * lineHeight);
    switch (mergedSize) {
      case 'large':
        return padding * 2 + fontHeight;
      case 'small':
        return paddingXS * 2 + fontHeight;
      default:
        return paddingSM * 2 + fontHeight;
    }
  }, [token, mergedSize]);
  if (virtual) {
    virtualProps.listItemHeight = listItemHeight;
  }
  return wrapCSSVar(/*#__PURE__*/react.createElement("div", {
    ref: rootRef,
    className: wrapperClassNames,
    style: mergedStyle
  }, /*#__PURE__*/react.createElement(spin/* default */.A, Object.assign({
    spinning: false
  }, spinProps), topPaginationNode, /*#__PURE__*/react.createElement(TableComponent, Object.assign({}, virtualProps, tableProps, {
    ref: tblRef,
    columns: mergedColumns,
    direction: direction,
    expandable: mergedExpandable,
    prefixCls: prefixCls,
    className: classnames_default()({
      [`${prefixCls}-middle`]: mergedSize === 'middle',
      [`${prefixCls}-small`]: mergedSize === 'small',
      [`${prefixCls}-bordered`]: bordered,
      [`${prefixCls}-empty`]: rawData.length === 0
    }, cssVarCls, rootCls, hashId),
    data: pageData,
    rowKey: getRowKey,
    rowClassName: internalRowClassName,
    emptyText: emptyText,
    // Internal
    internalHooks: INTERNAL_HOOKS,
    internalRefs: internalRefs,
    transformColumns: transformColumns,
    getContainerWidth: getContainerWidth
  })), bottomPaginationNode)));
};
/* harmony default export */ var table_InternalTable = (/*#__PURE__*/react.forwardRef(InternalTable));
;// ./node_modules/antd/es/table/Table.js
"use client";







const table_Table_Table = (props, ref) => {
  const renderTimesRef = react.useRef(0);
  renderTimesRef.current += 1;
  return /*#__PURE__*/react.createElement(table_InternalTable, Object.assign({}, props, {
    ref: ref,
    _renderTimes: renderTimesRef.current
  }));
};
const ForwardTable = /*#__PURE__*/react.forwardRef(table_Table_Table);
ForwardTable.SELECTION_COLUMN = SELECTION_COLUMN;
ForwardTable.EXPAND_COLUMN = EXPAND_COLUMN;
ForwardTable.SELECTION_ALL = SELECTION_ALL;
ForwardTable.SELECTION_INVERT = SELECTION_INVERT;
ForwardTable.SELECTION_NONE = SELECTION_NONE;
ForwardTable.Column = table_Column;
ForwardTable.ColumnGroup = table_ColumnGroup;
ForwardTable.Summary = FooterComponents;
if (false) {}
/* harmony default export */ var table_Table = (ForwardTable);
;// ./node_modules/antd/es/table/index.js
"use client";


/* harmony default export */ var table = (table_Table);

/***/ }),

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

/***/ })

}]);
//# sourceMappingURL=f91d8e9d750fa4ec50d600b86d30029d939db10c-80f7137f6b06c2970673.js.map