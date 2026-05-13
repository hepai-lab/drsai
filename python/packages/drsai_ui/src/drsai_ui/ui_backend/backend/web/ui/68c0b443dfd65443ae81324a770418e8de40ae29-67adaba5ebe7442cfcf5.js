"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[2302],{

/***/ 81145:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

/**
 * @license React
 * use-sync-external-store-shim.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


var React = __webpack_require__(96540);
function is(x, y) {
  return (x === y && (0 !== x || 1 / x === 1 / y)) || (x !== x && y !== y);
}
var objectIs = "function" === typeof Object.is ? Object.is : is,
  useState = React.useState,
  useEffect = React.useEffect,
  useLayoutEffect = React.useLayoutEffect,
  useDebugValue = React.useDebugValue;
function useSyncExternalStore$2(subscribe, getSnapshot) {
  var value = getSnapshot(),
    _useState = useState({ inst: { value: value, getSnapshot: getSnapshot } }),
    inst = _useState[0].inst,
    forceUpdate = _useState[1];
  useLayoutEffect(
    function () {
      inst.value = value;
      inst.getSnapshot = getSnapshot;
      checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
    },
    [subscribe, value, getSnapshot]
  );
  useEffect(
    function () {
      checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
      return subscribe(function () {
        checkIfSnapshotChanged(inst) && forceUpdate({ inst: inst });
      });
    },
    [subscribe]
  );
  useDebugValue(value);
  return value;
}
function checkIfSnapshotChanged(inst) {
  var latestGetSnapshot = inst.getSnapshot;
  inst = inst.value;
  try {
    var nextValue = latestGetSnapshot();
    return !objectIs(inst, nextValue);
  } catch (error) {
    return !0;
  }
}
function useSyncExternalStore$1(subscribe, getSnapshot) {
  return getSnapshot();
}
var shim =
  "undefined" === typeof window ||
  "undefined" === typeof window.document ||
  "undefined" === typeof window.document.createElement
    ? useSyncExternalStore$1
    : useSyncExternalStore$2;
exports.useSyncExternalStore =
  void 0 !== React.useSyncExternalStore ? React.useSyncExternalStore : shim;


/***/ }),

/***/ 45846:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

/**
 * @license React
 * use-sync-external-store-shim/with-selector.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


var React = __webpack_require__(96540),
  shim = __webpack_require__(83388);
function is(x, y) {
  return (x === y && (0 !== x || 1 / x === 1 / y)) || (x !== x && y !== y);
}
var objectIs = "function" === typeof Object.is ? Object.is : is,
  useSyncExternalStore = shim.useSyncExternalStore,
  useRef = React.useRef,
  useEffect = React.useEffect,
  useMemo = React.useMemo,
  useDebugValue = React.useDebugValue;
exports.useSyncExternalStoreWithSelector = function (
  subscribe,
  getSnapshot,
  getServerSnapshot,
  selector,
  isEqual
) {
  var instRef = useRef(null);
  if (null === instRef.current) {
    var inst = { hasValue: !1, value: null };
    instRef.current = inst;
  } else inst = instRef.current;
  instRef = useMemo(
    function () {
      function memoizedSelector(nextSnapshot) {
        if (!hasMemo) {
          hasMemo = !0;
          memoizedSnapshot = nextSnapshot;
          nextSnapshot = selector(nextSnapshot);
          if (void 0 !== isEqual && inst.hasValue) {
            var currentSelection = inst.value;
            if (isEqual(currentSelection, nextSnapshot))
              return (memoizedSelection = currentSelection);
          }
          return (memoizedSelection = nextSnapshot);
        }
        currentSelection = memoizedSelection;
        if (objectIs(memoizedSnapshot, nextSnapshot)) return currentSelection;
        var nextSelection = selector(nextSnapshot);
        if (void 0 !== isEqual && isEqual(currentSelection, nextSelection))
          return (memoizedSnapshot = nextSnapshot), currentSelection;
        memoizedSnapshot = nextSnapshot;
        return (memoizedSelection = nextSelection);
      }
      var hasMemo = !1,
        memoizedSnapshot,
        memoizedSelection,
        maybeGetServerSnapshot =
          void 0 === getServerSnapshot ? null : getServerSnapshot;
      return [
        function () {
          return memoizedSelector(getSnapshot());
        },
        null === maybeGetServerSnapshot
          ? void 0
          : function () {
              return memoizedSelector(maybeGetServerSnapshot());
            }
      ];
    },
    [getSnapshot, getServerSnapshot, selector, isEqual]
  );
  var value = useSyncExternalStore(subscribe, instRef[0], instRef[1]);
  useEffect(
    function () {
      inst.hasValue = !0;
      inst.value = value;
    },
    [value]
  );
  useDebugValue(value);
  return value;
};


/***/ }),

/***/ 83388:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {



if (true) {
  module.exports = __webpack_require__(81145);
} else {}


/***/ }),

/***/ 65118:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {



if (true) {
  module.exports = __webpack_require__(45846);
} else {}


/***/ }),

/***/ 89993:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AF: function() { return /* binding */ MENU_LABELS; },
/* harmony export */   JK: function() { return /* binding */ getMenuIdFromSearch; },
/* harmony export */   U4: function() { return /* binding */ getCanvasViewFromSearch; },
/* harmony export */   _M: function() { return /* binding */ createSearchWithView; },
/* harmony export */   gK: function() { return /* binding */ createSearchWithMenu; },
/* harmony export */   h7: function() { return /* binding */ MENU_IDS; }
/* harmony export */ });
/* unused harmony exports MENU_QUERY_KEY, VIEW_QUERY_KEY, DEFAULT_MENU_ID, DEFAULT_VIEW_ID */
const MENU_QUERY_KEY="menu";const VIEW_QUERY_KEY="view";const MENU_IDS={currentSession:"current_session",myAgents:"my_agents",agentSquare:"agent_square",savedPlan:"saved_plan",skillsSquare:"skills_square",library:"library",profile:"profile",channels:"channels",logs:"logs",agentManagement:"agent_management",userManagement:"user_management",cooperationManagement:"cooperation_management"};const VALID_MENU_IDS=new Set(Object.values(MENU_IDS));const DEFAULT_MENU_ID=MENU_IDS.currentSession;const DEFAULT_VIEW_ID="chat";const MENU_LABELS={[MENU_IDS.currentSession]:"聊天",[MENU_IDS.myAgents]:"我的智能体",[MENU_IDS.agentSquare]:"智能体广场",[MENU_IDS.savedPlan]:"计划",[MENU_IDS.skillsSquare]:"技能广场",[MENU_IDS.library]:"库",[MENU_IDS.profile]:"配置",[MENU_IDS.channels]:"频道",[MENU_IDS.logs]:"日志",[MENU_IDS.agentManagement]:"智能体管理",[MENU_IDS.userManagement]:"用户管理",[MENU_IDS.cooperationManagement]:"合作组管理"};const getMenuIdFromSearch=search=>{const params=new URLSearchParams(search);const rawMenu=params.get(MENU_QUERY_KEY);if(rawMenu&&VALID_MENU_IDS.has(rawMenu)){return rawMenu;}return DEFAULT_MENU_ID;};const createSearchWithMenu=(search,menuId)=>{const params=new URLSearchParams(search);params.set(MENU_QUERY_KEY,menuId);return"?"+params.toString();};const getCanvasViewFromSearch=search=>{const params=new URLSearchParams(search);const rawView=params.get(VIEW_QUERY_KEY);if(rawView==="file_preview"||rawView==="chat"){return rawView;}return DEFAULT_VIEW_ID;};const createSearchWithView=(search,viewId)=>{const params=new URLSearchParams(search);params.set(VIEW_QUERY_KEY,viewId);return"?"+params.toString();};

/***/ }),

/***/ 52078:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ pages_FilePreviewPage; }
});

// EXTERNAL MODULE: ./node_modules/core-js/modules/es.typed-array.set.js
var es_typed_array_set = __webpack_require__(28845);
// EXTERNAL MODULE: ./node_modules/core-js/modules/es.typed-array.sort.js
var es_typed_array_sort = __webpack_require__(373);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/eye.js
var eye = __webpack_require__(3160);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/pencil-line.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const PencilLine = (0,createLucideIcon/* default */.A)("PencilLine", [
  ["path", { d: "M12 20h9", key: "t2du7b" }],
  [
    "path",
    {
      d: "M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z",
      key: "1ykcvy"
    }
  ],
  ["path", { d: "m15 5 3 3", key: "1w25hb" }]
]);


//# sourceMappingURL=pencil-line.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/download.js
var download = __webpack_require__(48309);
;// ./node_modules/lucide-react/dist/esm/icons/arrow-left.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const ArrowLeft = (0,createLucideIcon/* default */.A)("ArrowLeft", [
  ["path", { d: "m12 19-7-7 7-7", key: "1l729n" }],
  ["path", { d: "M19 12H5", key: "x3x0zl" }]
]);


//# sourceMappingURL=arrow-left.js.map

// EXTERNAL MODULE: ./node_modules/react-dom/index.js
var react_dom = __webpack_require__(40961);
// EXTERNAL MODULE: ./node_modules/@tiptap/react/node_modules/use-sync-external-store/shim/index.js
var shim = __webpack_require__(83388);
// EXTERNAL MODULE: ./node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(74848);
// EXTERNAL MODULE: ./node_modules/@tiptap/core/dist/index.js
var dist = __webpack_require__(90277);
;// ./node_modules/fast-equals/dist/es/index.mjs
const { getOwnPropertyNames, getOwnPropertySymbols } = Object;
// eslint-disable-next-line @typescript-eslint/unbound-method
const { hasOwnProperty: es_hasOwnProperty } = Object.prototype;
/**
 * Combine two comparators into a single comparators.
 */
function combineComparators(comparatorA, comparatorB) {
    return function isEqual(a, b, state) {
        return comparatorA(a, b, state) && comparatorB(a, b, state);
    };
}
/**
 * Wrap the provided `areItemsEqual` method to manage the circular state, allowing
 * for circular references to be safely included in the comparison without creating
 * stack overflows.
 */
function createIsCircular(areItemsEqual) {
    return function isCircular(a, b, state) {
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
            return areItemsEqual(a, b, state);
        }
        const { cache } = state;
        const cachedA = cache.get(a);
        const cachedB = cache.get(b);
        if (cachedA && cachedB) {
            return cachedA === b && cachedB === a;
        }
        cache.set(a, b);
        cache.set(b, a);
        const result = areItemsEqual(a, b, state);
        cache.delete(a);
        cache.delete(b);
        return result;
    };
}
/**
 * Get the `@@toStringTag` of the value, if it exists.
 */
function getShortTag(value) {
    return value != null ? value[Symbol.toStringTag] : undefined;
}
/**
 * Get the properties to strictly examine, which include both own properties that are
 * not enumerable and symbol properties.
 */
function getStrictProperties(object) {
    return getOwnPropertyNames(object).concat(getOwnPropertySymbols(object));
}
/**
 * Whether the object contains the property passed as an own property.
 */
const hasOwn = 
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
Object.hasOwn || ((object, property) => es_hasOwnProperty.call(object, property));
/**
 * Whether the values passed are strictly equal or both NaN.
 */
function sameValueZeroEqual(a, b) {
    return a === b || (!a && !b && a !== a && b !== b);
}

const PREACT_VNODE = '__v';
const PREACT_OWNER = '__o';
const REACT_OWNER = '_owner';
const { getOwnPropertyDescriptor, keys } = Object;
/**
 * Whether the array buffers are equal in value.
 */
function areArrayBuffersEqual(a, b) {
    return a.byteLength === b.byteLength && areTypedArraysEqual(new Uint8Array(a), new Uint8Array(b));
}
/**
 * Whether the arrays are equal in value.
 */
function areArraysEqual(a, b, state) {
    let index = a.length;
    if (b.length !== index) {
        return false;
    }
    while (index-- > 0) {
        if (!state.equals(a[index], b[index], index, index, a, b, state)) {
            return false;
        }
    }
    return true;
}
/**
 * Whether the dataviews are equal in value.
 */
function areDataViewsEqual(a, b) {
    return (a.byteLength === b.byteLength
        && areTypedArraysEqual(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
}
/**
 * Whether the dates passed are equal in value.
 */
function areDatesEqual(a, b) {
    return sameValueZeroEqual(a.getTime(), b.getTime());
}
/**
 * Whether the errors passed are equal in value.
 */
function areErrorsEqual(a, b) {
    return a.name === b.name && a.message === b.message && a.cause === b.cause && a.stack === b.stack;
}
/**
 * Whether the functions passed are equal in value.
 */
function areFunctionsEqual(a, b) {
    return a === b;
}
/**
 * Whether the `Map`s are equal in value.
 */
function areMapsEqual(a, b, state) {
    const size = a.size;
    if (size !== b.size) {
        return false;
    }
    if (!size) {
        return true;
    }
    const matchedIndices = new Array(size);
    const aIterable = a.entries();
    let aResult;
    let bResult;
    let index = 0;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while ((aResult = aIterable.next())) {
        if (aResult.done) {
            break;
        }
        const bIterable = b.entries();
        let hasMatch = false;
        let matchIndex = 0;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while ((bResult = bIterable.next())) {
            if (bResult.done) {
                break;
            }
            if (matchedIndices[matchIndex]) {
                matchIndex++;
                continue;
            }
            const aEntry = aResult.value;
            const bEntry = bResult.value;
            if (state.equals(aEntry[0], bEntry[0], index, matchIndex, a, b, state)
                && state.equals(aEntry[1], bEntry[1], aEntry[0], bEntry[0], a, b, state)) {
                hasMatch = matchedIndices[matchIndex] = true;
                break;
            }
            matchIndex++;
        }
        if (!hasMatch) {
            return false;
        }
        index++;
    }
    return true;
}
/**
 * Whether the numbers are equal in value.
 */
const areNumbersEqual = sameValueZeroEqual;
/**
 * Whether the objects are equal in value.
 */
function areObjectsEqual(a, b, state) {
    const properties = keys(a);
    let index = properties.length;
    if (keys(b).length !== index) {
        return false;
    }
    // Decrementing `while` showed faster results than either incrementing or
    // decrementing `for` loop and than an incrementing `while` loop. Declarative
    // methods like `some` / `every` were not used to avoid incurring the garbage
    // cost of anonymous callbacks.
    while (index-- > 0) {
        if (!isPropertyEqual(a, b, state, properties[index])) {
            return false;
        }
    }
    return true;
}
/**
 * Whether the objects are equal in value with strict property checking.
 */
function areObjectsEqualStrict(a, b, state) {
    const properties = getStrictProperties(a);
    let index = properties.length;
    if (getStrictProperties(b).length !== index) {
        return false;
    }
    let property;
    let descriptorA;
    let descriptorB;
    // Decrementing `while` showed faster results than either incrementing or
    // decrementing `for` loop and than an incrementing `while` loop. Declarative
    // methods like `some` / `every` were not used to avoid incurring the garbage
    // cost of anonymous callbacks.
    while (index-- > 0) {
        property = properties[index];
        if (!isPropertyEqual(a, b, state, property)) {
            return false;
        }
        descriptorA = getOwnPropertyDescriptor(a, property);
        descriptorB = getOwnPropertyDescriptor(b, property);
        if ((descriptorA || descriptorB)
            && (!descriptorA
                || !descriptorB
                || descriptorA.configurable !== descriptorB.configurable
                || descriptorA.enumerable !== descriptorB.enumerable
                || descriptorA.writable !== descriptorB.writable)) {
            return false;
        }
    }
    return true;
}
/**
 * Whether the primitive wrappers passed are equal in value.
 */
function arePrimitiveWrappersEqual(a, b) {
    return sameValueZeroEqual(a.valueOf(), b.valueOf());
}
/**
 * Whether the regexps passed are equal in value.
 */
function areRegExpsEqual(a, b) {
    return a.source === b.source && a.flags === b.flags;
}
/**
 * Whether the `Set`s are equal in value.
 */
function areSetsEqual(a, b, state) {
    const size = a.size;
    if (size !== b.size) {
        return false;
    }
    if (!size) {
        return true;
    }
    const matchedIndices = new Array(size);
    const aIterable = a.values();
    let aResult;
    let bResult;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while ((aResult = aIterable.next())) {
        if (aResult.done) {
            break;
        }
        const bIterable = b.values();
        let hasMatch = false;
        let matchIndex = 0;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while ((bResult = bIterable.next())) {
            if (bResult.done) {
                break;
            }
            if (!matchedIndices[matchIndex]
                && state.equals(aResult.value, bResult.value, aResult.value, bResult.value, a, b, state)) {
                hasMatch = matchedIndices[matchIndex] = true;
                break;
            }
            matchIndex++;
        }
        if (!hasMatch) {
            return false;
        }
    }
    return true;
}
/**
 * Whether the TypedArray instances are equal in value.
 */
function areTypedArraysEqual(a, b) {
    let index = a.byteLength;
    if (b.byteLength !== index || a.byteOffset !== b.byteOffset) {
        return false;
    }
    while (index-- > 0) {
        if (a[index] !== b[index]) {
            return false;
        }
    }
    return true;
}
/**
 * Whether the URL instances are equal in value.
 */
function areUrlsEqual(a, b) {
    return (a.hostname === b.hostname
        && a.pathname === b.pathname
        && a.protocol === b.protocol
        && a.port === b.port
        && a.hash === b.hash
        && a.username === b.username
        && a.password === b.password);
}
function isPropertyEqual(a, b, state, property) {
    if ((property === REACT_OWNER || property === PREACT_OWNER || property === PREACT_VNODE)
        && (a.$$typeof || b.$$typeof)) {
        return true;
    }
    return hasOwn(b, property) && state.equals(a[property], b[property], property, property, a, b, state);
}

const ARRAY_BUFFER_TAG = '[object ArrayBuffer]';
const ARGUMENTS_TAG = '[object Arguments]';
const BOOLEAN_TAG = '[object Boolean]';
const DATA_VIEW_TAG = '[object DataView]';
const DATE_TAG = '[object Date]';
const ERROR_TAG = '[object Error]';
const MAP_TAG = '[object Map]';
const NUMBER_TAG = '[object Number]';
const OBJECT_TAG = '[object Object]';
const REG_EXP_TAG = '[object RegExp]';
const SET_TAG = '[object Set]';
const STRING_TAG = '[object String]';
const TYPED_ARRAY_TAGS = {
    '[object Int8Array]': true,
    '[object Uint8Array]': true,
    '[object Uint8ClampedArray]': true,
    '[object Int16Array]': true,
    '[object Uint16Array]': true,
    '[object Int32Array]': true,
    '[object Uint32Array]': true,
    '[object Float16Array]': true,
    '[object Float32Array]': true,
    '[object Float64Array]': true,
    '[object BigInt64Array]': true,
    '[object BigUint64Array]': true,
};
const URL_TAG = '[object URL]';
// eslint-disable-next-line @typescript-eslint/unbound-method
const es_toString = Object.prototype.toString;
/**
 * Create a comparator method based on the type-specific equality comparators passed.
 */
function createEqualityComparator({ areArrayBuffersEqual, areArraysEqual, areDataViewsEqual, areDatesEqual, areErrorsEqual, areFunctionsEqual, areMapsEqual, areNumbersEqual, areObjectsEqual, arePrimitiveWrappersEqual, areRegExpsEqual, areSetsEqual, areTypedArraysEqual, areUrlsEqual, unknownTagComparators, }) {
    /**
     * compare the value of the two objects and return true if they are equivalent in values
     */
    return function comparator(a, b, state) {
        // If the items are strictly equal, no need to do a value comparison.
        if (a === b) {
            return true;
        }
        // If either of the items are nullish and fail the strictly equal check
        // above, then they must be unequal.
        if (a == null || b == null) {
            return false;
        }
        const type = typeof a;
        if (type !== typeof b) {
            return false;
        }
        if (type !== 'object') {
            if (type === 'number') {
                return areNumbersEqual(a, b, state);
            }
            if (type === 'function') {
                return areFunctionsEqual(a, b, state);
            }
            // If a primitive value that is not strictly equal, it must be unequal.
            return false;
        }
        const constructor = a.constructor;
        // Checks are listed in order of commonality of use-case:
        //   1. Common complex object types (plain object, array)
        //   2. Common data values (date, regexp)
        //   3. Less-common complex object types (map, set)
        //   4. Less-common data values (promise, primitive wrappers)
        // Inherently this is both subjective and assumptive, however
        // when reviewing comparable libraries in the wild this order
        // appears to be generally consistent.
        // Constructors should match, otherwise there is potential for false positives
        // between class and subclass or custom object and POJO.
        if (constructor !== b.constructor) {
            return false;
        }
        // `isPlainObject` only checks against the object's own realm. Cross-realm
        // comparisons are rare, and will be handled in the ultimate fallback, so
        // we can avoid capturing the string tag.
        if (constructor === Object) {
            return areObjectsEqual(a, b, state);
        }
        // `isArray()` works on subclasses and is cross-realm, so we can avoid capturing
        // the string tag or doing an `instanceof` check.
        if (Array.isArray(a)) {
            return areArraysEqual(a, b, state);
        }
        // Try to fast-path equality checks for other complex object types in the
        // same realm to avoid capturing the string tag. Strict equality is used
        // instead of `instanceof` because it is more performant for the common
        // use-case. If someone is subclassing a native class, it will be handled
        // with the string tag comparison.
        if (constructor === Date) {
            return areDatesEqual(a, b, state);
        }
        if (constructor === RegExp) {
            return areRegExpsEqual(a, b, state);
        }
        if (constructor === Map) {
            return areMapsEqual(a, b, state);
        }
        if (constructor === Set) {
            return areSetsEqual(a, b, state);
        }
        // Since this is a custom object, capture the string tag to determing its type.
        // This is reasonably performant in modern environments like v8 and SpiderMonkey.
        const tag = es_toString.call(a);
        if (tag === DATE_TAG) {
            return areDatesEqual(a, b, state);
        }
        // For RegExp, the properties are not enumerable, and therefore will give false positives if
        // tested like a standard object.
        if (tag === REG_EXP_TAG) {
            return areRegExpsEqual(a, b, state);
        }
        if (tag === MAP_TAG) {
            return areMapsEqual(a, b, state);
        }
        if (tag === SET_TAG) {
            return areSetsEqual(a, b, state);
        }
        if (tag === OBJECT_TAG) {
            // The exception for value comparison is custom `Promise`-like class instances. These should
            // be treated the same as standard `Promise` objects, which means strict equality, and if
            // it reaches this point then that strict equality comparison has already failed.
            return typeof a.then !== 'function' && typeof b.then !== 'function' && areObjectsEqual(a, b, state);
        }
        // If a URL tag, it should be tested explicitly. Like RegExp, the properties are not
        // enumerable, and therefore will give false positives if tested like a standard object.
        if (tag === URL_TAG) {
            return areUrlsEqual(a, b, state);
        }
        // If an error tag, it should be tested explicitly. Like RegExp, the properties are not
        // enumerable, and therefore will give false positives if tested like a standard object.
        if (tag === ERROR_TAG) {
            return areErrorsEqual(a, b, state);
        }
        // If an arguments tag, it should be treated as a standard object.
        if (tag === ARGUMENTS_TAG) {
            return areObjectsEqual(a, b, state);
        }
        if (TYPED_ARRAY_TAGS[tag]) {
            return areTypedArraysEqual(a, b, state);
        }
        if (tag === ARRAY_BUFFER_TAG) {
            return areArrayBuffersEqual(a, b, state);
        }
        if (tag === DATA_VIEW_TAG) {
            return areDataViewsEqual(a, b, state);
        }
        // As the penultimate fallback, check if the values passed are primitive wrappers. This
        // is very rare in modern JS, which is why it is deprioritized compared to all other object
        // types.
        if (tag === BOOLEAN_TAG || tag === NUMBER_TAG || tag === STRING_TAG) {
            return arePrimitiveWrappersEqual(a, b, state);
        }
        if (unknownTagComparators) {
            let unknownTagComparator = unknownTagComparators[tag];
            if (!unknownTagComparator) {
                const shortTag = getShortTag(a);
                if (shortTag) {
                    unknownTagComparator = unknownTagComparators[shortTag];
                }
            }
            // If the custom config has an unknown tag comparator that matches the captured tag or the
            // @@toStringTag, it is the source of truth for whether the values are equal.
            if (unknownTagComparator) {
                return unknownTagComparator(a, b, state);
            }
        }
        // If not matching any tags that require a specific type of comparison, then we hard-code false because
        // the only thing remaining is strict equality, which has already been compared. This is for a few reasons:
        //   - Certain types that cannot be introspected (e.g., `WeakMap`). For these types, this is the only
        //     comparison that can be made.
        //   - For types that can be introspected, but rarely have requirements to be compared
        //     (`ArrayBuffer`, `DataView`, etc.), the cost is avoided to prioritize the common
        //     use-cases (may be included in a future release, if requested enough).
        //   - For types that can be introspected but do not have an objective definition of what
        //     equality is (`Error`, etc.), the subjective decision is to be conservative and strictly compare.
        // In all cases, these decisions should be reevaluated based on changes to the language and
        // common development practices.
        return false;
    };
}
/**
 * Create the configuration object used for building comparators.
 */
function createEqualityComparatorConfig({ circular, createCustomConfig, strict, }) {
    let config = {
        areArrayBuffersEqual,
        areArraysEqual: strict ? areObjectsEqualStrict : areArraysEqual,
        areDataViewsEqual,
        areDatesEqual: areDatesEqual,
        areErrorsEqual: areErrorsEqual,
        areFunctionsEqual: areFunctionsEqual,
        areMapsEqual: strict ? combineComparators(areMapsEqual, areObjectsEqualStrict) : areMapsEqual,
        areNumbersEqual: areNumbersEqual,
        areObjectsEqual: strict ? areObjectsEqualStrict : areObjectsEqual,
        arePrimitiveWrappersEqual: arePrimitiveWrappersEqual,
        areRegExpsEqual: areRegExpsEqual,
        areSetsEqual: strict ? combineComparators(areSetsEqual, areObjectsEqualStrict) : areSetsEqual,
        areTypedArraysEqual: strict
            ? combineComparators(areTypedArraysEqual, areObjectsEqualStrict)
            : areTypedArraysEqual,
        areUrlsEqual: areUrlsEqual,
        unknownTagComparators: undefined,
    };
    if (createCustomConfig) {
        config = Object.assign({}, config, createCustomConfig(config));
    }
    if (circular) {
        const areArraysEqual = createIsCircular(config.areArraysEqual);
        const areMapsEqual = createIsCircular(config.areMapsEqual);
        const areObjectsEqual = createIsCircular(config.areObjectsEqual);
        const areSetsEqual = createIsCircular(config.areSetsEqual);
        config = Object.assign({}, config, {
            areArraysEqual,
            areMapsEqual,
            areObjectsEqual,
            areSetsEqual,
        });
    }
    return config;
}
/**
 * Default equality comparator pass-through, used as the standard `isEqual` creator for
 * use inside the built comparator.
 */
function createInternalEqualityComparator(compare) {
    return function (a, b, _indexOrKeyA, _indexOrKeyB, _parentA, _parentB, state) {
        return compare(a, b, state);
    };
}
/**
 * Create the `isEqual` function used by the consuming application.
 */
function createIsEqual({ circular, comparator, createState, equals, strict }) {
    if (createState) {
        return function isEqual(a, b) {
            const { cache = circular ? new WeakMap() : undefined, meta } = createState();
            return comparator(a, b, {
                cache,
                equals,
                meta,
                strict,
            });
        };
    }
    if (circular) {
        return function isEqual(a, b) {
            return comparator(a, b, {
                cache: new WeakMap(),
                equals,
                meta: undefined,
                strict,
            });
        };
    }
    const state = {
        cache: undefined,
        equals,
        meta: undefined,
        strict,
    };
    return function isEqual(a, b) {
        return comparator(a, b, state);
    };
}

/**
 * Whether the items passed are deeply-equal in value.
 */
const deepEqual = createCustomEqual();
/**
 * Whether the items passed are deeply-equal in value based on strict comparison.
 */
const strictDeepEqual = createCustomEqual({ strict: true });
/**
 * Whether the items passed are deeply-equal in value, including circular references.
 */
const circularDeepEqual = createCustomEqual({ circular: true });
/**
 * Whether the items passed are deeply-equal in value, including circular references,
 * based on strict comparison.
 */
const strictCircularDeepEqual = createCustomEqual({
    circular: true,
    strict: true,
});
/**
 * Whether the items passed are shallowly-equal in value.
 */
const shallowEqual = createCustomEqual({
    createInternalComparator: () => sameValueZeroEqual,
});
/**
 * Whether the items passed are shallowly-equal in value based on strict comparison
 */
const strictShallowEqual = createCustomEqual({
    strict: true,
    createInternalComparator: () => sameValueZeroEqual,
});
/**
 * Whether the items passed are shallowly-equal in value, including circular references.
 */
const circularShallowEqual = createCustomEqual({
    circular: true,
    createInternalComparator: () => sameValueZeroEqual,
});
/**
 * Whether the items passed are shallowly-equal in value, including circular references,
 * based on strict comparison.
 */
const strictCircularShallowEqual = createCustomEqual({
    circular: true,
    createInternalComparator: () => sameValueZeroEqual,
    strict: true,
});
/**
 * Create a custom equality comparison method.
 *
 * This can be done to create very targeted comparisons in extreme hot-path scenarios
 * where the standard methods are not performant enough, but can also be used to provide
 * support for legacy environments that do not support expected features like
 * `RegExp.prototype.flags` out of the box.
 */
function createCustomEqual(options = {}) {
    const { circular = false, createInternalComparator: createCustomInternalComparator, createState, strict = false, } = options;
    const config = createEqualityComparatorConfig(options);
    const comparator = createEqualityComparator(config);
    const equals = createCustomInternalComparator
        ? createCustomInternalComparator(comparator)
        : createInternalEqualityComparator(comparator);
    return createIsEqual({ circular, comparator, createState, equals, strict });
}


//# sourceMappingURL=index.mjs.map

// EXTERNAL MODULE: ./node_modules/@tiptap/react/node_modules/use-sync-external-store/shim/with-selector.js
var with_selector = __webpack_require__(65118);
;// ./node_modules/@tiptap/react/dist/index.js
// src/Context.tsx


// src/EditorContent.tsx




var mergeRefs = (...refs) => {
  return (node) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ;
        ref.current = node;
      }
    });
  };
};
var Portals = ({ contentComponent }) => {
  const renderers = (0,shim.useSyncExternalStore)(
    contentComponent.subscribe,
    contentComponent.getSnapshot,
    contentComponent.getServerSnapshot
  );
  return /* @__PURE__ */ (0,jsx_runtime.jsx)(jsx_runtime.Fragment, { children: Object.values(renderers) });
};
function getInstance() {
  const subscribers = /* @__PURE__ */ new Set();
  let renderers = {};
  return {
    /**
     * Subscribe to the editor instance's changes.
     */
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    getSnapshot() {
      return renderers;
    },
    getServerSnapshot() {
      return renderers;
    },
    /**
     * Adds a new NodeView Renderer to the editor.
     */
    setRenderer(id, renderer) {
      renderers = {
        ...renderers,
        [id]: react_dom.createPortal(renderer.reactElement, renderer.element, id)
      };
      subscribers.forEach((subscriber) => subscriber());
    },
    /**
     * Removes a NodeView Renderer from the editor.
     */
    removeRenderer(id) {
      const nextRenderers = { ...renderers };
      delete nextRenderers[id];
      renderers = nextRenderers;
      subscribers.forEach((subscriber) => subscriber());
    }
  };
}
var PureEditorContent = class extends react.Component {
  constructor(props) {
    super(props);
    this.editorContentRef = react.createRef();
  }
  componentDidMount() {
    this.init();
  }
  componentDidUpdate() {
    this.init();
  }
  init() {
    var _a;
    const editor = this.props.editor;
    if (editor && !editor.isDestroyed && ((_a = editor.view.dom) == null ? void 0 : _a.parentNode)) {
      if (editor.contentComponent) {
        return;
      }
      const element = this.editorContentRef.current;
      element.append(...editor.view.dom.parentNode.childNodes);
      editor.setOptions({
        element
      });
      editor.contentComponent = getInstance();
      editor.createNodeViews();
      editor.isEditorContentInitialized = true;
      this.forceUpdate();
    }
  }
  componentWillUnmount() {
    var _a;
    const editor = this.props.editor;
    if (!editor) {
      return;
    }
    editor.isEditorContentInitialized = false;
    if (!editor.isDestroyed) {
      editor.view.setProps({
        nodeViews: {}
      });
    }
    editor.contentComponent = null;
    try {
      if (!((_a = editor.view.dom) == null ? void 0 : _a.parentNode)) {
        return;
      }
      const newElement = document.createElement("div");
      newElement.append(...editor.view.dom.parentNode.childNodes);
      editor.setOptions({
        element: newElement
      });
    } catch {
    }
  }
  render() {
    const { editor, innerRef, ...rest } = this.props;
    return /* @__PURE__ */ (0,jsx_runtime.jsxs)(jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0,jsx_runtime.jsx)("div", { ref: mergeRefs(innerRef, this.editorContentRef), ...rest }),
      (editor == null ? void 0 : editor.contentComponent) && /* @__PURE__ */ (0,jsx_runtime.jsx)(Portals, { contentComponent: editor.contentComponent })
    ] });
  }
};
var EditorContentWithKey = (0,react.forwardRef)(
  (props, ref) => {
    const key = react.useMemo(() => {
      return Math.floor(Math.random() * 4294967295).toString();
    }, [props.editor]);
    return react.createElement(PureEditorContent, {
      key,
      innerRef: ref,
      ...props
    });
  }
);
var EditorContent = react.memo(EditorContentWithKey);

// src/useEditor.ts




// src/useEditorState.ts



var useIsomorphicLayoutEffect = typeof window !== "undefined" ? react.useLayoutEffect : react.useEffect;
var EditorStateManager = class {
  constructor(initialEditor) {
    this.transactionNumber = 0;
    this.lastTransactionNumber = 0;
    this.subscribers = /* @__PURE__ */ new Set();
    this.editor = initialEditor;
    this.lastSnapshot = { editor: initialEditor, transactionNumber: 0 };
    this.getSnapshot = this.getSnapshot.bind(this);
    this.getServerSnapshot = this.getServerSnapshot.bind(this);
    this.watch = this.watch.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }
  /**
   * Get the current editor instance.
   */
  getSnapshot() {
    if (this.transactionNumber === this.lastTransactionNumber) {
      return this.lastSnapshot;
    }
    this.lastTransactionNumber = this.transactionNumber;
    this.lastSnapshot = { editor: this.editor, transactionNumber: this.transactionNumber };
    return this.lastSnapshot;
  }
  /**
   * Always disable the editor on the server-side.
   */
  getServerSnapshot() {
    return { editor: null, transactionNumber: 0 };
  }
  /**
   * Subscribe to the editor instance's changes.
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
  /**
   * Watch the editor instance for changes.
   */
  watch(nextEditor) {
    this.editor = nextEditor;
    if (this.editor) {
      const fn = () => {
        this.transactionNumber += 1;
        this.subscribers.forEach((callback) => callback());
      };
      const currentEditor = this.editor;
      currentEditor.on("transaction", fn);
      return () => {
        currentEditor.off("transaction", fn);
      };
    }
    return void 0;
  }
};
function useEditorState(options) {
  var _a;
  const [editorStateManager] = (0,react.useState)(() => new EditorStateManager(options.editor));
  const selectedState = (0,with_selector.useSyncExternalStoreWithSelector)(
    editorStateManager.subscribe,
    editorStateManager.getSnapshot,
    editorStateManager.getServerSnapshot,
    options.selector,
    (_a = options.equalityFn) != null ? _a : deepEqual
  );
  useIsomorphicLayoutEffect(() => {
    return editorStateManager.watch(options.editor);
  }, [options.editor, editorStateManager]);
  (0,react.useDebugValue)(selectedState);
  return selectedState;
}

// src/useEditor.ts
var isDev = "production" !== "production";
var isSSR = typeof window === "undefined";
var isNext = isSSR || Boolean(typeof window !== "undefined" && window.next);
var EditorInstanceManager = class _EditorInstanceManager {
  constructor(options) {
    /**
     * The current editor instance.
     */
    this.editor = null;
    /**
     * The subscriptions to notify when the editor instance
     * has been created or destroyed.
     */
    this.subscriptions = /* @__PURE__ */ new Set();
    /**
     * Whether the editor has been mounted.
     */
    this.isComponentMounted = false;
    /**
     * The most recent dependencies array.
     */
    this.previousDeps = null;
    /**
     * The unique instance ID. This is used to identify the editor instance. And will be re-generated for each new instance.
     */
    this.instanceId = "";
    this.options = options;
    this.subscriptions = /* @__PURE__ */ new Set();
    this.setEditor(this.getInitialEditor());
    this.scheduleDestroy();
    this.getEditor = this.getEditor.bind(this);
    this.getServerSnapshot = this.getServerSnapshot.bind(this);
    this.subscribe = this.subscribe.bind(this);
    this.refreshEditorInstance = this.refreshEditorInstance.bind(this);
    this.scheduleDestroy = this.scheduleDestroy.bind(this);
    this.onRender = this.onRender.bind(this);
    this.createEditor = this.createEditor.bind(this);
  }
  setEditor(editor) {
    this.editor = editor;
    this.instanceId = Math.random().toString(36).slice(2, 9);
    this.subscriptions.forEach((cb) => cb());
  }
  getInitialEditor() {
    if (this.options.current.immediatelyRender === void 0) {
      if (isSSR || isNext) {
        if (isDev) {
          throw new Error(
            "Tiptap Error: SSR has been detected, please set `immediatelyRender` explicitly to `false` to avoid hydration mismatches."
          );
        }
        return null;
      }
      return this.createEditor();
    }
    if (this.options.current.immediatelyRender && isSSR && isDev) {
      throw new Error(
        "Tiptap Error: SSR has been detected, and `immediatelyRender` has been set to `true` this is an unsupported configuration that may result in errors, explicitly set `immediatelyRender` to `false` to avoid hydration mismatches."
      );
    }
    if (this.options.current.immediatelyRender) {
      return this.createEditor();
    }
    return null;
  }
  /**
   * Create a new editor instance. And attach event listeners.
   */
  createEditor() {
    const optionsToApply = {
      ...this.options.current,
      // Always call the most recent version of the callback function by default
      onBeforeCreate: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onBeforeCreate) == null ? void 0 : _b.call(_a, ...args);
      },
      onBlur: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onBlur) == null ? void 0 : _b.call(_a, ...args);
      },
      onCreate: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onCreate) == null ? void 0 : _b.call(_a, ...args);
      },
      onDestroy: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onDestroy) == null ? void 0 : _b.call(_a, ...args);
      },
      onFocus: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onFocus) == null ? void 0 : _b.call(_a, ...args);
      },
      onSelectionUpdate: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onSelectionUpdate) == null ? void 0 : _b.call(_a, ...args);
      },
      onTransaction: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onTransaction) == null ? void 0 : _b.call(_a, ...args);
      },
      onUpdate: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onUpdate) == null ? void 0 : _b.call(_a, ...args);
      },
      onContentError: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onContentError) == null ? void 0 : _b.call(_a, ...args);
      },
      onDrop: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onDrop) == null ? void 0 : _b.call(_a, ...args);
      },
      onPaste: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onPaste) == null ? void 0 : _b.call(_a, ...args);
      },
      onDelete: (...args) => {
        var _a, _b;
        return (_b = (_a = this.options.current).onDelete) == null ? void 0 : _b.call(_a, ...args);
      }
    };
    const editor = new dist/* Editor */.KE(optionsToApply);
    return editor;
  }
  /**
   * Get the current editor instance.
   */
  getEditor() {
    return this.editor;
  }
  /**
   * Always disable the editor on the server-side.
   */
  getServerSnapshot() {
    return null;
  }
  /**
   * Subscribe to the editor instance's changes.
   */
  subscribe(onStoreChange) {
    this.subscriptions.add(onStoreChange);
    return () => {
      this.subscriptions.delete(onStoreChange);
    };
  }
  static compareOptions(a, b) {
    return Object.keys(a).every((key) => {
      if ([
        "onCreate",
        "onBeforeCreate",
        "onDestroy",
        "onUpdate",
        "onTransaction",
        "onFocus",
        "onBlur",
        "onSelectionUpdate",
        "onContentError",
        "onDrop",
        "onPaste"
      ].includes(key)) {
        return true;
      }
      if (key === "extensions" && a.extensions && b.extensions) {
        if (a.extensions.length !== b.extensions.length) {
          return false;
        }
        return a.extensions.every((extension, index) => {
          var _a;
          if (extension !== ((_a = b.extensions) == null ? void 0 : _a[index])) {
            return false;
          }
          return true;
        });
      }
      if (a[key] !== b[key]) {
        return false;
      }
      return true;
    });
  }
  /**
   * On each render, we will create, update, or destroy the editor instance.
   * @param deps The dependencies to watch for changes
   * @returns A cleanup function
   */
  onRender(deps) {
    return () => {
      this.isComponentMounted = true;
      clearTimeout(this.scheduledDestructionTimeout);
      if (this.editor && !this.editor.isDestroyed && deps.length === 0) {
        if (!_EditorInstanceManager.compareOptions(this.options.current, this.editor.options)) {
          this.editor.setOptions({
            ...this.options.current,
            editable: this.editor.isEditable
          });
        }
      } else {
        this.refreshEditorInstance(deps);
      }
      return () => {
        this.isComponentMounted = false;
        this.scheduleDestroy();
      };
    };
  }
  /**
   * Recreate the editor instance if the dependencies have changed.
   */
  refreshEditorInstance(deps) {
    if (this.editor && !this.editor.isDestroyed) {
      if (this.previousDeps === null) {
        this.previousDeps = deps;
        return;
      }
      const depsAreEqual = this.previousDeps.length === deps.length && this.previousDeps.every((dep, index) => dep === deps[index]);
      if (depsAreEqual) {
        return;
      }
    }
    if (this.editor && !this.editor.isDestroyed) {
      this.editor.destroy();
    }
    this.setEditor(this.createEditor());
    this.previousDeps = deps;
  }
  /**
   * Schedule the destruction of the editor instance.
   * This will only destroy the editor if it was not mounted on the next tick.
   * This is to avoid destroying the editor instance when it's actually still mounted.
   */
  scheduleDestroy() {
    const currentInstanceId = this.instanceId;
    const currentEditor = this.editor;
    this.scheduledDestructionTimeout = setTimeout(() => {
      if (this.isComponentMounted && this.instanceId === currentInstanceId) {
        if (currentEditor) {
          currentEditor.setOptions(this.options.current);
        }
        return;
      }
      if (currentEditor && !currentEditor.isDestroyed) {
        currentEditor.destroy();
        if (this.instanceId === currentInstanceId) {
          this.setEditor(null);
        }
      }
    }, 1);
  }
};
function useEditor(options = {}, deps = []) {
  const mostRecentOptions = (0,react.useRef)(options);
  mostRecentOptions.current = options;
  const [instanceManager] = (0,react.useState)(() => new EditorInstanceManager(mostRecentOptions));
  const editor = (0,shim.useSyncExternalStore)(
    instanceManager.subscribe,
    instanceManager.getEditor,
    instanceManager.getServerSnapshot
  );
  (0,react.useDebugValue)(editor);
  (0,react.useEffect)(instanceManager.onRender(deps));
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => {
      if (options.shouldRerenderOnTransaction === false || options.shouldRerenderOnTransaction === void 0) {
        return null;
      }
      if (options.immediatelyRender && transactionNumber === 0) {
        return 0;
      }
      return transactionNumber + 1;
    }
  });
  return editor;
}

// src/Context.tsx

var EditorContext = (0,react.createContext)({
  editor: null
});
var EditorConsumer = EditorContext.Consumer;
var useCurrentEditor = () => useContext(EditorContext);
function EditorProvider({
  children,
  slotAfter,
  slotBefore,
  editorContainerProps = {},
  ...editorOptions
}) {
  const editor = useEditor(editorOptions);
  const contextValue = useMemo(() => ({ editor }), [editor]);
  if (!editor) {
    return null;
  }
  return /* @__PURE__ */ jsxs2(EditorContext.Provider, { value: contextValue, children: [
    slotBefore,
    /* @__PURE__ */ jsx2(EditorConsumer, { children: ({ editor: currentEditor }) => /* @__PURE__ */ jsx2(EditorContent, { editor: currentEditor, ...editorContainerProps }) }),
    children,
    slotAfter
  ] });
}

// src/useReactNodeView.ts

var ReactNodeViewContext = (0,react.createContext)({
  onDragStart: () => {
  },
  nodeViewContentChildren: void 0,
  nodeViewContentRef: () => {
  }
});
var ReactNodeViewContentProvider = ({ children, content }) => {
  return createElement(ReactNodeViewContext.Provider, { value: { nodeViewContentChildren: content } }, children);
};
var useReactNodeView = () => (0,react.useContext)(ReactNodeViewContext);

// src/NodeViewContent.tsx

function NodeViewContent({
  as: Tag = "div",
  ...props
}) {
  const { nodeViewContentRef, nodeViewContentChildren } = useReactNodeView();
  return (
    // @ts-ignore
    /* @__PURE__ */ jsx3(
      Tag,
      {
        ...props,
        ref: nodeViewContentRef,
        "data-node-view-content": "",
        style: {
          whiteSpace: "pre-wrap",
          ...props.style
        },
        children: nodeViewContentChildren
      }
    )
  );
}

// src/NodeViewWrapper.tsx


var NodeViewWrapper = react.forwardRef((props, ref) => {
  const { onDragStart } = useReactNodeView();
  const Tag = props.as || "div";
  return (
    // @ts-ignore
    /* @__PURE__ */ (0,jsx_runtime.jsx)(
      Tag,
      {
        ...props,
        ref,
        "data-node-view-wrapper": "",
        onDragStart,
        style: {
          whiteSpace: "normal",
          ...props.style
        }
      }
    )
  );
});

// src/ReactMarkViewRenderer.tsx



// src/ReactRenderer.tsx



function isClassComponent(Component) {
  return !!(typeof Component === "function" && Component.prototype && Component.prototype.isReactComponent);
}
function isForwardRefComponent(Component) {
  return !!(typeof Component === "object" && Component.$$typeof && (Component.$$typeof.toString() === "Symbol(react.forward_ref)" || Component.$$typeof.description === "react.forward_ref"));
}
function isMemoComponent(Component) {
  return !!(typeof Component === "object" && Component.$$typeof && (Component.$$typeof.toString() === "Symbol(react.memo)" || Component.$$typeof.description === "react.memo"));
}
function canReceiveRef(Component) {
  if (isClassComponent(Component)) {
    return true;
  }
  if (isForwardRefComponent(Component)) {
    return true;
  }
  if (isMemoComponent(Component)) {
    const wrappedComponent = Component.type;
    if (wrappedComponent) {
      return isClassComponent(wrappedComponent) || isForwardRefComponent(wrappedComponent);
    }
  }
  return false;
}
function isReact19Plus() {
  try {
    if (react.version) {
      const majorVersion = parseInt(react.version.split(".")[0], 10);
      return majorVersion >= 19;
    }
  } catch {
  }
  return false;
}
var ReactRenderer = class {
  /**
   * Immediately creates element and renders the provided React component.
   */
  constructor(component, { editor, props = {}, as = "div", className = "" }) {
    this.ref = null;
    /**
     * Flag to track if the renderer has been destroyed, preventing queued or asynchronous renders from executing after teardown.
     */
    this.destroyed = false;
    this.id = Math.floor(Math.random() * 4294967295).toString();
    this.component = component;
    this.editor = editor;
    this.props = props;
    this.element = document.createElement(as);
    this.element.classList.add("react-renderer");
    if (className) {
      this.element.classList.add(...className.split(" "));
    }
    if (this.editor.isEditorContentInitialized) {
      (0,react_dom.flushSync)(() => {
        this.render();
      });
    } else {
      queueMicrotask(() => {
        if (this.destroyed) {
          return;
        }
        this.render();
      });
    }
  }
  /**
   * Render the React component.
   */
  render() {
    var _a;
    if (this.destroyed) {
      return;
    }
    const Component = this.component;
    const props = this.props;
    const editor = this.editor;
    const isReact19 = isReact19Plus();
    const componentCanReceiveRef = canReceiveRef(Component);
    const elementProps = { ...props };
    if (elementProps.ref && !(isReact19 || componentCanReceiveRef)) {
      delete elementProps.ref;
    }
    if (!elementProps.ref && (isReact19 || componentCanReceiveRef)) {
      elementProps.ref = (ref) => {
        this.ref = ref;
      };
    }
    this.reactElement = /* @__PURE__ */ (0,jsx_runtime.jsx)(Component, { ...elementProps });
    (_a = editor == null ? void 0 : editor.contentComponent) == null ? void 0 : _a.setRenderer(this.id, this);
  }
  /**
   * Re-renders the React component with new props.
   */
  updateProps(props = {}) {
    if (this.destroyed) {
      return;
    }
    this.props = {
      ...this.props,
      ...props
    };
    this.render();
  }
  /**
   * Destroy the React component.
   */
  destroy() {
    var _a;
    this.destroyed = true;
    const editor = this.editor;
    (_a = editor == null ? void 0 : editor.contentComponent) == null ? void 0 : _a.removeRenderer(this.id);
    try {
      if (this.element && this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
    } catch {
    }
  }
  /**
   * Update the attributes of the element that holds the React component.
   */
  updateAttributes(attributes) {
    Object.keys(attributes).forEach((key) => {
      this.element.setAttribute(key, attributes[key]);
    });
  }
};

// src/ReactMarkViewRenderer.tsx

var ReactMarkViewContext = react.createContext({
  markViewContentRef: () => {
  }
});
var MarkViewContent = (props) => {
  const { as: Tag = "span", ...rest } = props;
  const { markViewContentRef } = React4.useContext(ReactMarkViewContext);
  return (
    // @ts-ignore
    /* @__PURE__ */ jsx6(Tag, { ...rest, ref: markViewContentRef, "data-mark-view-content": "" })
  );
};
var ReactMarkView = class extends dist/* MarkView */.Db {
  constructor(component, props, options) {
    super(component, props, options);
    const { as = "span", attrs, className = "" } = options || {};
    const componentProps = { ...props, updateAttributes: this.updateAttributes.bind(this) };
    this.contentDOMElement = document.createElement("span");
    const markViewContentRef = (el) => {
      if (el && !el.contains(this.contentDOMElement)) {
        el.appendChild(this.contentDOMElement);
      }
    };
    const context = {
      markViewContentRef
    };
    const ReactMarkViewProvider = react.memo((componentProps2) => {
      return /* @__PURE__ */ (0,jsx_runtime.jsx)(ReactMarkViewContext.Provider, { value: context, children: react.createElement(component, componentProps2) });
    });
    ReactMarkViewProvider.displayName = "ReactMarkView";
    this.renderer = new ReactRenderer(ReactMarkViewProvider, {
      editor: props.editor,
      props: componentProps,
      as,
      className: `mark-${props.mark.type.name} ${className}`.trim()
    });
    if (attrs) {
      this.renderer.updateAttributes(attrs);
    }
  }
  get dom() {
    return this.renderer.element;
  }
  get contentDOM() {
    return this.contentDOMElement;
  }
};
function ReactMarkViewRenderer(component, options = {}) {
  return (props) => new ReactMarkView(component, props, options);
}

// src/ReactNodeViewRenderer.tsx



var ReactNodeView = class extends dist/* NodeView */.Yv {
  constructor(component, props, options) {
    super(component, props, options);
    /**
     * The requestAnimationFrame ID used for selection updates.
     */
    this.selectionRafId = null;
    /**
     * Callback registered with the per-editor position-update registry.
     * Stored so it can be unregistered in destroy().
     */
    this.positionCheckCallback = null;
    this.cachedExtensionWithSyncedStorage = null;
    if (!this.node.isLeaf) {
      if (this.options.contentDOMElementTag) {
        this.contentDOMElement = document.createElement(this.options.contentDOMElementTag);
      } else {
        this.contentDOMElement = document.createElement(this.node.isInline ? "span" : "div");
      }
      this.contentDOMElement.dataset.nodeViewContentReact = "";
      this.contentDOMElement.dataset.nodeViewWrapper = "";
      this.contentDOMElement.style.whiteSpace = "inherit";
      const contentTarget = this.dom.querySelector("[data-node-view-content]");
      if (!contentTarget) {
        return;
      }
      contentTarget.appendChild(this.contentDOMElement);
    }
  }
  /**
   * Returns a proxy of the extension that redirects storage access to the editor's mutable storage.
   * This preserves the original prototype chain (instanceof checks, methods like configure/extend work).
   * Cached to avoid proxy creation on every update.
   */
  get extensionWithSyncedStorage() {
    if (!this.cachedExtensionWithSyncedStorage) {
      const editor = this.editor;
      const extension = this.extension;
      this.cachedExtensionWithSyncedStorage = new Proxy(extension, {
        get(target, prop, receiver) {
          var _a;
          if (prop === "storage") {
            return (_a = editor.storage[extension.name]) != null ? _a : {};
          }
          return Reflect.get(target, prop, receiver);
        }
      });
    }
    return this.cachedExtensionWithSyncedStorage;
  }
  /**
   * Setup the React component.
   * Called on initialization.
   */
  mount() {
    const props = {
      editor: this.editor,
      node: this.node,
      decorations: this.decorations,
      innerDecorations: this.innerDecorations,
      view: this.view,
      selected: false,
      extension: this.extensionWithSyncedStorage,
      HTMLAttributes: this.HTMLAttributes,
      getPos: () => this.getPos(),
      updateAttributes: (attributes = {}) => this.updateAttributes(attributes),
      deleteNode: () => this.deleteNode(),
      ref: (0,react.createRef)()
    };
    if (!this.component.displayName) {
      const capitalizeFirstChar = (string) => {
        return string.charAt(0).toUpperCase() + string.substring(1);
      };
      this.component.displayName = capitalizeFirstChar(this.extension.name);
    }
    const onDragStart = this.onDragStart.bind(this);
    const nodeViewContentRef = (element) => {
      if (element && this.contentDOMElement && element.firstChild !== this.contentDOMElement) {
        if (element.hasAttribute("data-node-view-wrapper")) {
          element.removeAttribute("data-node-view-wrapper");
        }
        element.appendChild(this.contentDOMElement);
      }
    };
    const context = { onDragStart, nodeViewContentRef };
    const Component = this.component;
    const ReactNodeViewProvider = (0,react.memo)((componentProps) => {
      return /* @__PURE__ */ (0,jsx_runtime.jsx)(ReactNodeViewContext.Provider, { value: context, children: (0,react.createElement)(Component, componentProps) });
    });
    ReactNodeViewProvider.displayName = "ReactNodeView";
    let as = this.node.isInline ? "span" : "div";
    if (this.options.as) {
      as = this.options.as;
    }
    const { className = "" } = this.options;
    this.handleSelectionUpdate = this.handleSelectionUpdate.bind(this);
    this.renderer = new ReactRenderer(ReactNodeViewProvider, {
      editor: this.editor,
      props,
      as,
      className: `node-${this.node.type.name} ${className}`.trim()
    });
    this.editor.on("selectionUpdate", this.handleSelectionUpdate);
    this.updateElementAttributes();
    this.currentPos = this.getPos();
    this.positionCheckCallback = () => {
      const newPos = this.getPos();
      if (typeof newPos !== "number" || newPos === this.currentPos) {
        return;
      }
      this.currentPos = newPos;
      this.renderer.updateProps({ getPos: () => this.getPos() });
      if (typeof this.options.attrs === "function") {
        this.updateElementAttributes();
      }
    };
    (0,dist/* schedulePositionCheck */.fD)(this.editor, this.positionCheckCallback);
  }
  /**
   * Return the DOM element.
   * This is the element that will be used to display the node view.
   */
  get dom() {
    var _a;
    if (this.renderer.element.firstElementChild && !((_a = this.renderer.element.firstElementChild) == null ? void 0 : _a.hasAttribute("data-node-view-wrapper"))) {
      throw Error("Please use the NodeViewWrapper component for your node view.");
    }
    return this.renderer.element;
  }
  /**
   * Return the content DOM element.
   * This is the element that will be used to display the rich-text content of the node.
   */
  get contentDOM() {
    if (this.node.isLeaf) {
      return null;
    }
    return this.contentDOMElement;
  }
  /**
   * On editor selection update, check if the node is selected.
   * If it is, call `selectNode`, otherwise call `deselectNode`.
   */
  handleSelectionUpdate() {
    if (this.selectionRafId) {
      cancelAnimationFrame(this.selectionRafId);
      this.selectionRafId = null;
    }
    this.selectionRafId = requestAnimationFrame(() => {
      this.selectionRafId = null;
      const pos = this.currentPos;
      if (typeof pos !== "number") {
        return;
      }
      const isSelected = (0,dist/* isNodeViewSelected */.FA)({
        selection: this.editor.state.selection,
        pos,
        nodeSize: this.node.nodeSize,
        selectedOnTextSelection: this.options.selectedOnTextSelection
      });
      if (isSelected) {
        if (this.renderer.props.selected) {
          return;
        }
        this.selectNode();
      } else {
        if (!this.renderer.props.selected) {
          return;
        }
        this.deselectNode();
      }
    });
  }
  /**
   * On update, update the React component.
   * To prevent unnecessary updates, the `update` option can be used.
   */
  update(node, decorations, innerDecorations) {
    const rerenderComponent = (props) => {
      this.renderer.updateProps(props);
      if (typeof this.options.attrs === "function") {
        this.updateElementAttributes();
      }
    };
    if (node.type !== this.node.type) {
      return false;
    }
    if (typeof this.options.update === "function") {
      const oldNode = this.node;
      const oldDecorations = this.decorations;
      const oldInnerDecorations = this.innerDecorations;
      this.node = node;
      this.decorations = decorations;
      this.innerDecorations = innerDecorations;
      this.currentPos = this.getPos();
      return this.options.update({
        oldNode,
        oldDecorations,
        newNode: node,
        newDecorations: decorations,
        oldInnerDecorations,
        innerDecorations,
        updateProps: () => rerenderComponent({ node, decorations, innerDecorations, extension: this.extensionWithSyncedStorage })
      });
    }
    const newPos = this.getPos();
    if (node === this.node && this.decorations === decorations && this.innerDecorations === innerDecorations) {
      if (newPos === this.currentPos) {
        return true;
      }
      this.currentPos = newPos;
      rerenderComponent({
        node,
        decorations,
        innerDecorations,
        extension: this.extensionWithSyncedStorage,
        getPos: () => this.getPos()
      });
      return true;
    }
    this.node = node;
    this.decorations = decorations;
    this.innerDecorations = innerDecorations;
    this.currentPos = newPos;
    rerenderComponent({ node, decorations, innerDecorations, extension: this.extensionWithSyncedStorage });
    return true;
  }
  /**
   * Select the node.
   * Add the `selected` prop and the `ProseMirror-selectednode` class.
   */
  selectNode() {
    this.renderer.updateProps({
      selected: true
    });
    this.renderer.element.classList.add("ProseMirror-selectednode");
  }
  /**
   * Deselect the node.
   * Remove the `selected` prop and the `ProseMirror-selectednode` class.
   */
  deselectNode() {
    this.renderer.updateProps({
      selected: false
    });
    this.renderer.element.classList.remove("ProseMirror-selectednode");
  }
  /**
   * Destroy the React component instance.
   */
  destroy() {
    this.renderer.destroy();
    this.editor.off("selectionUpdate", this.handleSelectionUpdate);
    if (this.positionCheckCallback) {
      (0,dist/* cancelPositionCheck */.YT)(this.editor, this.positionCheckCallback);
      this.positionCheckCallback = null;
    }
    this.contentDOMElement = null;
    if (this.selectionRafId) {
      cancelAnimationFrame(this.selectionRafId);
      this.selectionRafId = null;
    }
  }
  /**
   * Update the attributes of the top-level element that holds the React component.
   * Applying the attributes defined in the `attrs` option.
   */
  updateElementAttributes() {
    if (this.options.attrs) {
      let attrsObj = {};
      if (typeof this.options.attrs === "function") {
        const extensionAttributes = this.editor.extensionManager.attributes;
        const HTMLAttributes = (0,dist/* getRenderedAttributes */.zU)(this.node, extensionAttributes);
        attrsObj = this.options.attrs({ node: this.node, HTMLAttributes });
      } else {
        attrsObj = this.options.attrs;
      }
      this.renderer.updateAttributes(attrsObj);
    }
  }
};
function ReactNodeViewRenderer(component, options) {
  return (props) => {
    if (!props.editor.contentComponent) {
      return {};
    }
    return new ReactNodeView(component, props, options);
  };
}

// src/Tiptap.tsx


var TiptapContext = (0,react.createContext)({
  get editor() {
    throw new Error("useTiptap must be used within a <Tiptap> provider");
  }
});
TiptapContext.displayName = "TiptapContext";
var useTiptap = () => (0,react.useContext)(TiptapContext);
function useTiptapState(selector, equalityFn) {
  const { editor } = useTiptap();
  return useEditorState({
    editor,
    selector,
    equalityFn
  });
}
function TiptapWrapper({ editor, instance, children }) {
  const resolvedEditor = editor != null ? editor : instance;
  if (!resolvedEditor) {
    throw new Error("Tiptap: An editor instance is required. Pass a non-null `editor` prop.");
  }
  const tiptapContextValue = (0,react.useMemo)(() => ({ editor: resolvedEditor }), [resolvedEditor]);
  const legacyContextValue = (0,react.useMemo)(() => ({ editor: resolvedEditor }), [resolvedEditor]);
  return /* @__PURE__ */ (0,jsx_runtime.jsx)(EditorContext.Provider, { value: legacyContextValue, children: /* @__PURE__ */ (0,jsx_runtime.jsx)(TiptapContext.Provider, { value: tiptapContextValue, children }) });
}
TiptapWrapper.displayName = "Tiptap";
function TiptapContent({ ...rest }) {
  const { editor } = useTiptap();
  return /* @__PURE__ */ (0,jsx_runtime.jsx)(EditorContent, { editor, ...rest });
}
TiptapContent.displayName = "Tiptap.Content";
var Tiptap = Object.assign(TiptapWrapper, {
  /**
   * The Tiptap Content component that renders the EditorContent with the editor instance from the context.
   * @see TiptapContent
   */
  Content: TiptapContent
});

// src/index.ts


//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/core/dist/jsx-runtime/jsx-runtime.js
// src/jsx-runtime.ts
function Fragment(props) {
  return props.children;
}
var h = (tag, attributes) => {
  if (tag === "slot") {
    return 0;
  }
  if (tag instanceof Function) {
    return tag(attributes);
  }
  const { children, ...rest } = attributes != null ? attributes : {};
  if (tag === "svg") {
    throw new Error("SVG elements are not supported in the JSX syntax, use the array syntax instead");
  }
  return [tag, rest, children];
};

//# sourceMappingURL=jsx-runtime.js.map
;// ./node_modules/@tiptap/extension-blockquote/dist/index.js
// src/blockquote.tsx


var inputRegex = /^\s*>\s$/;
var Blockquote = dist/* Node */.bP.create({
  name: "blockquote",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  content: "block+",
  group: "block",
  defining: true,
  parseHTML() {
    return [{ tag: "blockquote" }];
  },
  renderHTML({ HTMLAttributes }) {
    return /* @__PURE__ */ h("blockquote", { ...(0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), children: /* @__PURE__ */ h("slot", {}) });
  },
  parseMarkdown: (token, helpers) => {
    var _a;
    const parseBlockChildren = (_a = helpers.parseBlockChildren) != null ? _a : helpers.parseChildren;
    return helpers.createNode("blockquote", void 0, parseBlockChildren(token.tokens || []));
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    const prefix = ">";
    const result = [];
    node.content.forEach((child, index) => {
      var _a, _b;
      const childContent = (_b = (_a = h.renderChild) == null ? void 0 : _a.call(h, child, index)) != null ? _b : h.renderChildren([child]);
      const lines = childContent.split("\n");
      const linesWithPrefix = lines.map((line) => {
        if (line.trim() === "") {
          return prefix;
        }
        return `${prefix} ${line}`;
      });
      result.push(linesWithPrefix.join("\n"));
    });
    return result.join(`
${prefix}
`);
  },
  addCommands() {
    return {
      setBlockquote: () => ({ commands }) => {
        return commands.wrapIn(this.name);
      },
      toggleBlockquote: () => ({ commands }) => {
        return commands.toggleWrap(this.name);
      },
      unsetBlockquote: () => ({ commands }) => {
        return commands.lift(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-b": () => this.editor.commands.toggleBlockquote()
    };
  },
  addInputRules() {
    return [
      (0,dist/* wrappingInputRule */.tG)({
        find: inputRegex,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var index_default = (/* unused pure expression or super */ null && (Blockquote));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-bold/dist/index.js
// src/bold.tsx


var starInputRegex = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/;
var starPasteRegex = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))/g;
var underscoreInputRegex = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))$/;
var underscorePasteRegex = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))/g;
var Bold = dist/* Mark */.CU.create({
  name: "bold",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  parseHTML() {
    return [
      {
        tag: "strong"
      },
      {
        tag: "b",
        getAttrs: (node) => node.style.fontWeight !== "normal" && null
      },
      {
        style: "font-weight=400",
        clearMark: (mark) => mark.type.name === this.name
      },
      {
        style: "font-weight",
        getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return /* @__PURE__ */ h("strong", { ...(0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), children: /* @__PURE__ */ h("slot", {}) });
  },
  markdownTokenName: "strong",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("bold", helpers.parseInline(token.tokens || []));
  },
  markdownOptions: {
    htmlReopen: {
      open: "<strong>",
      close: "</strong>"
    }
  },
  renderMarkdown: (node, h) => {
    return `**${h.renderChildren(node)}**`;
  },
  addCommands() {
    return {
      setBold: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleBold: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetBold: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-b": () => this.editor.commands.toggleBold(),
      "Mod-B": () => this.editor.commands.toggleBold()
    };
  },
  addInputRules() {
    return [
      (0,dist/* markInputRule */.OX)({
        find: starInputRegex,
        type: this.type
      }),
      (0,dist/* markInputRule */.OX)({
        find: underscoreInputRegex,
        type: this.type
      })
    ];
  },
  addPasteRules() {
    return [
      (0,dist/* markPasteRule */.Zc)({
        find: starPasteRegex,
        type: this.type
      }),
      (0,dist/* markPasteRule */.Zc)({
        find: underscorePasteRegex,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var dist_index_default = (/* unused pure expression or super */ null && (Bold));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-code/dist/index.js
// src/code.ts

var dist_inputRegex = /(^|[^`])`([^`]+)`(?!`)$/;
var pasteRegex = /(^|[^`])`([^`]+)`(?!`)/g;
var Code = dist/* Mark */.CU.create({
  name: "code",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  excludes: "_",
  code: true,
  exitable: true,
  parseHTML() {
    return [{ tag: "code" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["code", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "codespan",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("code", [{ type: "text", text: token.text || "" }]);
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return `\`${h.renderChildren(node.content)}\``;
  },
  addCommands() {
    return {
      setCode: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleCode: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetCode: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-e": () => this.editor.commands.toggleCode()
    };
  },
  addInputRules() {
    return [
      (0,dist/* markInputRule */.OX)({
        find: dist_inputRegex,
        type: this.type
      })
    ];
  },
  addPasteRules() {
    return [
      (0,dist/* markPasteRule */.Zc)({
        find: pasteRegex,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var extension_code_dist_index_default = (/* unused pure expression or super */ null && (Code));

//# sourceMappingURL=index.js.map
// EXTERNAL MODULE: ./node_modules/prosemirror-state/dist/index.js
var prosemirror_state_dist = __webpack_require__(42845);
;// ./node_modules/@tiptap/extension-code-block/dist/index.js
// src/code-block.ts


var DEFAULT_TAB_SIZE = 4;
var backtickInputRegex = /^```([a-z]+)?[\s\n]$/;
var tildeInputRegex = /^~~~([a-z]+)?[\s\n]$/;
var CodeBlock = dist/* Node */.bP.create({
  name: "codeBlock",
  addOptions() {
    return {
      languageClassPrefix: "language-",
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      defaultLanguage: null,
      enableTabIndentation: false,
      tabSize: DEFAULT_TAB_SIZE,
      HTMLAttributes: {}
    };
  },
  content: "text*",
  marks: "",
  group: "block",
  code: true,
  defining: true,
  addAttributes() {
    return {
      language: {
        default: this.options.defaultLanguage,
        parseHTML: (element) => {
          var _a;
          const { languageClassPrefix } = this.options;
          if (!languageClassPrefix) {
            return null;
          }
          const classNames = [...((_a = element.firstElementChild) == null ? void 0 : _a.classList) || []];
          const languages = classNames.filter((className) => className.startsWith(languageClassPrefix)).map((className) => className.replace(languageClassPrefix, ""));
          const language = languages[0];
          if (!language) {
            return null;
          }
          return language;
        },
        rendered: false
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full"
      }
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes),
      [
        "code",
        {
          class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null
        },
        0
      ]
    ];
  },
  markdownTokenName: "code",
  parseMarkdown: (token, helpers) => {
    var _a, _b;
    if (((_a = token.raw) == null ? void 0 : _a.startsWith("```")) === false && ((_b = token.raw) == null ? void 0 : _b.startsWith("~~~")) === false && token.codeBlockStyle !== "indented") {
      return [];
    }
    return helpers.createNode(
      "codeBlock",
      { language: token.lang || null },
      token.text ? [helpers.createTextNode(token.text)] : []
    );
  },
  renderMarkdown: (node, h) => {
    var _a;
    let output = "";
    const language = ((_a = node.attrs) == null ? void 0 : _a.language) || "";
    if (!node.content) {
      output = `\`\`\`${language}

\`\`\``;
    } else {
      const lines = [`\`\`\`${language}`, h.renderChildren(node.content), "```"];
      output = lines.join("\n");
    }
    return output;
  },
  addCommands() {
    return {
      setCodeBlock: (attributes) => ({ commands }) => {
        return commands.setNode(this.name, attributes);
      },
      toggleCodeBlock: (attributes) => ({ commands }) => {
        return commands.toggleNode(this.name, "paragraph", attributes);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-c": () => this.editor.commands.toggleCodeBlock(),
      // remove code block when at start of document or code block is empty
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection;
        const isAtStart = $anchor.pos === 1;
        if (!empty || $anchor.parent.type.name !== this.name) {
          return false;
        }
        if (isAtStart || !$anchor.parent.textContent.length) {
          return this.editor.commands.clearNodes();
        }
        return false;
      },
      // handle tab indentation
      Tab: ({ editor }) => {
        var _a;
        if (!this.options.enableTabIndentation) {
          return false;
        }
        const tabSize = (_a = this.options.tabSize) != null ? _a : DEFAULT_TAB_SIZE;
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        if ($from.parent.type !== this.type) {
          return false;
        }
        const indent = " ".repeat(tabSize);
        if (empty) {
          return editor.commands.insertContent(indent);
        }
        return editor.commands.command(({ tr }) => {
          const { from, to } = selection;
          const text = state.doc.textBetween(from, to, "\n", "\n");
          const lines = text.split("\n");
          const indentedText = lines.map((line) => indent + line).join("\n");
          tr.replaceWith(from, to, state.schema.text(indentedText));
          return true;
        });
      },
      // handle shift+tab reverse indentation
      "Shift-Tab": ({ editor }) => {
        var _a;
        if (!this.options.enableTabIndentation) {
          return false;
        }
        const tabSize = (_a = this.options.tabSize) != null ? _a : DEFAULT_TAB_SIZE;
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        if ($from.parent.type !== this.type) {
          return false;
        }
        if (empty) {
          return editor.commands.command(({ tr }) => {
            var _a2;
            const { pos } = $from;
            const codeBlockStart = $from.start();
            const codeBlockEnd = $from.end();
            const allText = state.doc.textBetween(codeBlockStart, codeBlockEnd, "\n", "\n");
            const lines = allText.split("\n");
            let currentLineIndex = 0;
            let charCount = 0;
            const relativeCursorPos = pos - codeBlockStart;
            for (let i = 0; i < lines.length; i += 1) {
              if (charCount + lines[i].length >= relativeCursorPos) {
                currentLineIndex = i;
                break;
              }
              charCount += lines[i].length + 1;
            }
            const currentLine = lines[currentLineIndex];
            const leadingSpaces = ((_a2 = currentLine.match(/^ */)) == null ? void 0 : _a2[0]) || "";
            const spacesToRemove = Math.min(leadingSpaces.length, tabSize);
            if (spacesToRemove === 0) {
              return true;
            }
            let lineStartPos = codeBlockStart;
            for (let i = 0; i < currentLineIndex; i += 1) {
              lineStartPos += lines[i].length + 1;
            }
            tr.delete(lineStartPos, lineStartPos + spacesToRemove);
            const cursorPosInLine = pos - lineStartPos;
            if (cursorPosInLine <= spacesToRemove) {
              tr.setSelection(prosemirror_state_dist/* TextSelection */.U3.create(tr.doc, lineStartPos));
            }
            return true;
          });
        }
        return editor.commands.command(({ tr }) => {
          const { from, to } = selection;
          const text = state.doc.textBetween(from, to, "\n", "\n");
          const lines = text.split("\n");
          const reverseIndentText = lines.map((line) => {
            var _a2;
            const leadingSpaces = ((_a2 = line.match(/^ */)) == null ? void 0 : _a2[0]) || "";
            const spacesToRemove = Math.min(leadingSpaces.length, tabSize);
            return line.slice(spacesToRemove);
          }).join("\n");
          tr.replaceWith(from, to, state.schema.text(reverseIndentText));
          return true;
        });
      },
      // exit node on triple enter
      Enter: ({ editor }) => {
        if (!this.options.exitOnTripleEnter) {
          return false;
        }
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        if (!empty || $from.parent.type !== this.type) {
          return false;
        }
        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
        const endsWithDoubleNewline = $from.parent.textContent.endsWith("\n\n");
        if (!isAtEnd || !endsWithDoubleNewline) {
          return false;
        }
        return editor.chain().command(({ tr }) => {
          tr.delete($from.pos - 2, $from.pos);
          return true;
        }).exitCode().run();
      },
      // exit node on arrow down
      ArrowDown: ({ editor }) => {
        if (!this.options.exitOnArrowDown) {
          return false;
        }
        const { state } = editor;
        const { selection, doc } = state;
        const { $from, empty } = selection;
        if (!empty || $from.parent.type !== this.type) {
          return false;
        }
        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
        if (!isAtEnd) {
          return false;
        }
        const after = $from.after();
        if (after === void 0) {
          return false;
        }
        const nodeAfter = doc.nodeAt(after);
        if (nodeAfter) {
          return editor.commands.command(({ tr }) => {
            tr.setSelection(prosemirror_state_dist/* Selection */.LN.near(doc.resolve(after)));
            return true;
          });
        }
        return editor.commands.exitCode();
      }
    };
  },
  addInputRules() {
    return [
      (0,dist/* textblockTypeInputRule */.JJ)({
        find: backtickInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1]
        })
      }),
      (0,dist/* textblockTypeInputRule */.JJ)({
        find: tildeInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1]
        })
      })
    ];
  },
  addProseMirrorPlugins() {
    return [
      // this plugin creates a code block for pasted content from VS Code
      // we can also detect the copied code language
      new prosemirror_state_dist/* Plugin */.k_({
        key: new prosemirror_state_dist/* PluginKey */.hs("codeBlockVSCodeHandler"),
        props: {
          handlePaste: (view, event) => {
            if (!event.clipboardData) {
              return false;
            }
            if (this.editor.isActive(this.type.name)) {
              return false;
            }
            const text = event.clipboardData.getData("text/plain");
            const vscode = event.clipboardData.getData("vscode-editor-data");
            const vscodeData = vscode ? JSON.parse(vscode) : void 0;
            const language = vscodeData == null ? void 0 : vscodeData.mode;
            if (!text || !language) {
              return false;
            }
            const { tr, schema } = view.state;
            const textNode = schema.text(text.replace(/\r\n?/g, "\n"));
            tr.replaceSelectionWith(this.type.create({ language }, textNode));
            if (tr.selection.$from.parent.type !== this.type) {
              tr.setSelection(prosemirror_state_dist/* TextSelection */.U3.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2))));
            }
            tr.setMeta("paste", true);
            view.dispatch(tr);
            return true;
          }
        }
      })
    ];
  }
});

// src/index.ts
var extension_code_block_dist_index_default = (/* unused pure expression or super */ null && (CodeBlock));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-document/dist/index.js
// src/document.ts

var Document = dist/* Node */.bP.create({
  name: "doc",
  topNode: true,
  content: "block+",
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n\n");
  }
});

// src/index.ts
var extension_document_dist_index_default = (/* unused pure expression or super */ null && (Document));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-hard-break/dist/index.js
// src/hard-break.ts

var HardBreak = dist/* Node */.bP.create({
  name: "hardBreak",
  markdownTokenName: "br",
  addOptions() {
    return {
      keepMarks: true,
      HTMLAttributes: {}
    };
  },
  inline: true,
  group: "inline",
  selectable: false,
  linebreakReplacement: true,
  parseHTML() {
    return [{ tag: "br" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["br", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes)];
  },
  renderText() {
    return "\n";
  },
  renderMarkdown: () => `  
`,
  parseMarkdown: () => {
    return {
      type: "hardBreak"
    };
  },
  addCommands() {
    return {
      setHardBreak: () => ({ commands, chain, state, editor }) => {
        return commands.first([
          () => commands.exitCode(),
          () => commands.command(() => {
            const { selection, storedMarks } = state;
            if (selection.$from.parent.type.spec.isolating) {
              return false;
            }
            const { keepMarks } = this.options;
            const { splittableMarks } = editor.extensionManager;
            const marks = storedMarks || selection.$to.parentOffset && selection.$from.marks();
            return chain().insertContent({ type: this.name }).command(({ tr, dispatch }) => {
              if (dispatch && marks && keepMarks) {
                const filteredMarks = marks.filter((mark) => splittableMarks.includes(mark.type.name));
                tr.ensureMarks(filteredMarks);
              }
              return true;
            }).run();
          })
        ]);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.commands.setHardBreak(),
      "Shift-Enter": () => this.editor.commands.setHardBreak()
    };
  }
});

// src/index.ts
var extension_hard_break_dist_index_default = (/* unused pure expression or super */ null && (HardBreak));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-heading/dist/index.js
// src/heading.ts

var Heading = dist/* Node */.bP.create({
  name: "heading",
  addOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {}
    };
  },
  content: "inline*",
  group: "block",
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 1,
        rendered: false
      }
    };
  },
  parseHTML() {
    return this.options.levels.map((level) => ({
      tag: `h${level}`,
      attrs: { level }
    }));
  },
  renderHTML({ node, HTMLAttributes }) {
    const hasLevel = this.options.levels.includes(node.attrs.level);
    const level = hasLevel ? node.attrs.level : this.options.levels[0];
    return [`h${level}`, (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  parseMarkdown: (token, helpers) => {
    return helpers.createNode("heading", { level: token.depth || 1 }, helpers.parseInline(token.tokens || []));
  },
  renderMarkdown: (node, h) => {
    var _a;
    const level = ((_a = node.attrs) == null ? void 0 : _a.level) ? parseInt(node.attrs.level, 10) : 1;
    const headingChars = "#".repeat(level);
    if (!node.content) {
      return "";
    }
    return `${headingChars} ${h.renderChildren(node.content)}`;
  },
  addCommands() {
    return {
      setHeading: (attributes) => ({ commands }) => {
        if (!this.options.levels.includes(attributes.level)) {
          return false;
        }
        return commands.setNode(this.name, attributes);
      },
      toggleHeading: (attributes) => ({ commands }) => {
        if (!this.options.levels.includes(attributes.level)) {
          return false;
        }
        return commands.toggleNode(this.name, "paragraph", attributes);
      }
    };
  },
  addKeyboardShortcuts() {
    return this.options.levels.reduce(
      (items, level) => ({
        ...items,
        ...{
          [`Mod-Alt-${level}`]: () => this.editor.commands.toggleHeading({ level })
        }
      }),
      {}
    );
  },
  addInputRules() {
    return this.options.levels.map((level) => {
      return (0,dist/* textblockTypeInputRule */.JJ)({
        find: new RegExp(`^(#{${Math.min(...this.options.levels)},${level}})\\s$`),
        type: this.type,
        getAttributes: {
          level
        }
      });
    });
  }
});

// src/index.ts
var extension_heading_dist_index_default = (/* unused pure expression or super */ null && (Heading));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-horizontal-rule/dist/index.js
// src/horizontal-rule.ts


var HorizontalRule = dist/* Node */.bP.create({
  name: "horizontalRule",
  addOptions() {
    return {
      HTMLAttributes: {},
      nextNodeType: "paragraph"
    };
  },
  group: "block",
  parseHTML() {
    return [{ tag: "hr" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["hr", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes)];
  },
  markdownTokenName: "hr",
  parseMarkdown: (token, helpers) => {
    return helpers.createNode("horizontalRule");
  },
  renderMarkdown: () => {
    return "---";
  },
  addCommands() {
    return {
      setHorizontalRule: () => ({ chain, state }) => {
        if (!(0,dist/* canInsertNode */.AB)(state, state.schema.nodes[this.name])) {
          return false;
        }
        const { selection } = state;
        const { $to: $originTo } = selection;
        const currentChain = chain();
        if ((0,dist/* isNodeSelection */.BQ)(selection)) {
          currentChain.insertContentAt($originTo.pos, {
            type: this.name
          });
        } else {
          currentChain.insertContent({ type: this.name });
        }
        return currentChain.command(({ state: chainState, tr, dispatch }) => {
          if (dispatch) {
            const { $to } = tr.selection;
            const posAfter = $to.end();
            if ($to.nodeAfter) {
              if ($to.nodeAfter.isTextblock) {
                tr.setSelection(prosemirror_state_dist/* TextSelection */.U3.create(tr.doc, $to.pos + 1));
              } else if ($to.nodeAfter.isBlock) {
                tr.setSelection(prosemirror_state_dist/* NodeSelection */.nh.create(tr.doc, $to.pos));
              } else {
                tr.setSelection(prosemirror_state_dist/* TextSelection */.U3.create(tr.doc, $to.pos));
              }
            } else {
              const nodeType = chainState.schema.nodes[this.options.nextNodeType] || $to.parent.type.contentMatch.defaultType;
              const node = nodeType == null ? void 0 : nodeType.create();
              if (node) {
                tr.insert(posAfter, node);
                tr.setSelection(prosemirror_state_dist/* TextSelection */.U3.create(tr.doc, posAfter + 1));
              }
            }
            tr.scrollIntoView();
          }
          return true;
        }).run();
      }
    };
  },
  addInputRules() {
    return [
      (0,dist/* nodeInputRule */.Ce)({
        find: /^(?:---|—-|___\s|\*\*\*\s)$/,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var extension_horizontal_rule_dist_index_default = (/* unused pure expression or super */ null && (HorizontalRule));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-italic/dist/index.js
// src/italic.ts

var dist_starInputRegex = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/;
var dist_starPasteRegex = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))/g;
var dist_underscoreInputRegex = /(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))$/;
var dist_underscorePasteRegex = /(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))/g;
var Italic = dist/* Mark */.CU.create({
  name: "italic",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  parseHTML() {
    return [
      {
        tag: "em"
      },
      {
        tag: "i",
        getAttrs: (node) => node.style.fontStyle !== "normal" && null
      },
      {
        style: "font-style=normal",
        clearMark: (mark) => mark.type.name === this.name
      },
      {
        style: "font-style=italic"
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["em", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setItalic: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleItalic: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetItalic: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      }
    };
  },
  markdownTokenName: "em",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("italic", helpers.parseInline(token.tokens || []));
  },
  markdownOptions: {
    htmlReopen: {
      open: "<em>",
      close: "</em>"
    }
  },
  renderMarkdown: (node, h) => {
    return `*${h.renderChildren(node)}*`;
  },
  addKeyboardShortcuts() {
    return {
      "Mod-i": () => this.editor.commands.toggleItalic(),
      "Mod-I": () => this.editor.commands.toggleItalic()
    };
  },
  addInputRules() {
    return [
      (0,dist/* markInputRule */.OX)({
        find: dist_starInputRegex,
        type: this.type
      }),
      (0,dist/* markInputRule */.OX)({
        find: dist_underscoreInputRegex,
        type: this.type
      })
    ];
  },
  addPasteRules() {
    return [
      (0,dist/* markPasteRule */.Zc)({
        find: dist_starPasteRegex,
        type: this.type
      }),
      (0,dist/* markPasteRule */.Zc)({
        find: dist_underscorePasteRegex,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var extension_italic_dist_index_default = (/* unused pure expression or super */ null && (Italic));

//# sourceMappingURL=index.js.map
;// ./node_modules/linkifyjs/dist/linkify.mjs
// THIS FILE IS AUTOMATICALLY GENERATED DO NOT EDIT DIRECTLY
// See update-tlds.js for encoding/decoding format
// https://data.iana.org/TLD/tlds-alpha-by-domain.txt
const encodedTlds = 'aaa1rp3bb0ott3vie4c1le2ogado5udhabi7c0ademy5centure6ountant0s9o1tor4d0s1ult4e0g1ro2tna4f0l1rica5g0akhan5ency5i0g1rbus3force5tel5kdn3l0ibaba4pay4lfinanz6state5y2sace3tom5m0azon4ericanexpress7family11x2fam3ica3sterdam8nalytics7droid5quan4z2o0l2partments8p0le4q0uarelle8r0ab1mco4chi3my2pa2t0e3s0da2ia2sociates9t0hleta5torney7u0ction5di0ble3o3spost5thor3o0s4w0s2x0a2z0ure5ba0by2idu3namex4d1k2r0celona5laycard4s5efoot5gains6seball5ketball8uhaus5yern5b0c1t1va3cg1n2d1e0ats2uty4er2rlin4st0buy5t2f1g1h0arti5i0ble3d1ke2ng0o3o1z2j1lack0friday9ockbuster8g1omberg7ue3m0s1w2n0pparibas9o0ats3ehringer8fa2m1nd2o0k0ing5sch2tik2on4t1utique6x2r0adesco6idgestone9oadway5ker3ther5ussels7s1t1uild0ers6siness6y1zz3v1w1y1z0h3ca0b1fe2l0l1vinklein9m0era3p2non3petown5ital0one8r0avan4ds2e0er0s4s2sa1e1h1ino4t0ering5holic7ba1n1re3c1d1enter4o1rn3f0a1d2g1h0anel2nel4rity4se2t2eap3intai5ristmas6ome4urch5i0priani6rcle4sco3tadel4i0c2y3k1l0aims4eaning6ick2nic1que6othing5ud3ub0med6m1n1o0ach3des3ffee4llege4ogne5m0mbank4unity6pany2re3uter5sec4ndos3struction8ulting7tact3ractors9oking4l1p2rsica5untry4pon0s4rses6pa2r0edit0card4union9icket5own3s1uise0s6u0isinella9v1w1x1y0mru3ou3z2dad1nce3ta1e1ing3sun4y2clk3ds2e0al0er2s3gree4livery5l1oitte5ta3mocrat6ntal2ist5si0gn4v2hl2iamonds6et2gital5rect0ory7scount3ver5h2y2j1k1m1np2o0cs1tor4g1mains5t1wnload7rive4tv2ubai3nlop4pont4rban5vag2r2z2earth3t2c0o2deka3u0cation8e1g1mail3erck5nergy4gineer0ing9terprises10pson4quipment8r0icsson6ni3s0q1tate5t1u0rovision8s2vents5xchange6pert3osed4ress5traspace10fage2il1rwinds6th3mily4n0s2rm0ers5shion4t3edex3edback6rrari3ero6i0delity5o2lm2nal1nce1ial7re0stone6mdale6sh0ing5t0ness6j1k1lickr3ghts4r2orist4wers5y2m1o0o0d1tball6rd1ex2sale4um3undation8x2r0ee1senius7l1ogans4ntier7tr2ujitsu5n0d2rniture7tbol5yi3ga0l0lery3o1up4me0s3p1rden4y2b0iz3d0n2e0a1nt0ing5orge5f1g0ee3h1i0ft0s3ves2ing5l0ass3e1obal2o4m0ail3bh2o1x2n1odaddy5ld0point6f2o0dyear5g0le4p1t1v2p1q1r0ainger5phics5tis4een3ipe3ocery4up4s1t1u0cci3ge2ide2tars5ru3w1y2hair2mburg5ngout5us3bo2dfc0bank7ealth0care8lp1sinki6re1mes5iphop4samitsu7tachi5v2k0t2m1n1ockey4ldings5iday5medepot5goods5s0ense7nda3rse3spital5t0ing5t0els3mail5use3w2r1sbc3t1u0ghes5yatt3undai7ibm2cbc2e1u2d1e0ee3fm2kano4l1m0amat4db2mo0bilien9n0c1dustries8finiti5o2g1k1stitute6urance4e4t0ernational10uit4vestments10o1piranga7q1r0ish4s0maili5t0anbul7t0au2v3jaguar4va3cb2e0ep2tzt3welry6io2ll2m0p2nj2o0bs1urg4t1y2p0morgan6rs3uegos4niper7kaufen5ddi3e0rryhotels6properties14fh2g1h1i0a1ds2m1ndle4tchen5wi3m1n1oeln3matsu5sher5p0mg2n2r0d1ed3uokgroup8w1y0oto4z2la0caixa5mborghini8er3nd0rover6xess5salle5t0ino3robe5w0yer5b1c1ds2ease3clerc5frak4gal2o2xus4gbt3i0dl2fe0insurance9style7ghting6ke2lly3mited4o2ncoln4k2ve1ing5k1lc1p2oan0s3cker3us3l1ndon4tte1o3ve3pl0financial11r1s1t0d0a3u0ndbeck6xe1ury5v1y2ma0drid4if1son4keup4n0agement7go3p1rket0ing3s4riott5shalls7ttel5ba2c0kinsey7d1e0d0ia3et2lbourne7me1orial6n0u2rckmsd7g1h1iami3crosoft7l1ni1t2t0subishi9k1l0b1s2m0a2n1o0bi0le4da2e1i1m1nash3ey2ster5rmon3tgage6scow4to0rcycles9v0ie4p1q1r1s0d2t0n1r2u0seum3ic4v1w1x1y1z2na0b1goya4me2vy3ba2c1e0c1t0bank4flix4work5ustar5w0s2xt0direct7us4f0l2g0o2hk2i0co2ke1on3nja3ssan1y5l1o0kia3rton4w0ruz3tv4p1r0a1w2tt2u1yc2z2obi1server7ffice5kinawa6layan0group9lo3m0ega4ne1g1l0ine5oo2pen3racle3nge4g0anic5igins6saka4tsuka4t2vh3pa0ge2nasonic7ris2s1tners4s1y3y2ccw3e0t2f0izer5g1h0armacy6d1ilips5one2to0graphy6s4ysio5ics1tet2ures6d1n0g1k2oneer5zza4k1l0ace2y0station9umbing5s3m1n0c2ohl2ker3litie5rn2st3r0axi3ess3ime3o0d0uctions8f1gressive8mo2perties3y5tection8u0dential9s1t1ub2w0c2y2qa1pon3uebec3st5racing4dio4e0ad1lestate6tor2y4cipes5d0stone5umbrella9hab3ise0n3t2liance6n0t0als5pair3ort3ublican8st0aurant8view0s5xroth6ich0ardli6oh3l1o1p2o0cks3deo3gers4om3s0vp3u0gby3hr2n2w0e2yukyu6sa0arland6fe0ty4kura4le1on3msclub4ung5ndvik0coromant12ofi4p1rl2s1ve2xo3b0i1s2c0b1haeffler7midt4olarships8ol3ule3warz5ience5ot3d1e0arch3t2cure1ity6ek2lect4ner3rvices6ven3w1x0y3fr2g1h0angrila6rp3ell3ia1ksha5oes2p0ping5uji3w3i0lk2na1gles5te3j1k0i0n2y0pe4l0ing4m0art3ile4n0cf3o0ccer3ial4ftbank4ware6hu2lar2utions7ng1y2y2pa0ce3ort2t3r0l2s1t0ada2ples4r1tebank4farm7c0group6ockholm6rage3e3ream4udio2y3yle4u0cks3pplies3y2ort5rf1gery5zuki5v1watch4iss4x1y0dney4stems6z2tab1ipei4lk2obao4rget4tamotors6r2too4x0i3c0i2d0k2eam2ch0nology8l1masek5nnis4va3f1g1h0d1eater2re6iaa2ckets5enda4ps2res2ol4j0maxx4x2k0maxx5l1m0all4n1o0day3kyo3ols3p1ray3shiba5tal3urs3wn2yota3s3r0ade1ing4ining5vel0ers0insurance16ust3v2t1ube2i1nes3shu4v0s2w1z2ua1bank3s2g1k1nicom3versity8o2ol2ps2s1y1z2va0cations7na1guard7c1e0gas3ntures6risign5mögensberater2ung14sicherung10t2g1i0ajes4deo3g1king4llas4n1p1rgin4sa1ion4va1o3laanderen9n1odka3lvo3te1ing3o2yage5u2wales2mart4ter4ng0gou5tch0es6eather0channel12bcam3er2site5d0ding5ibo2r3f1hoswho6ien2ki2lliamhill9n0dows4e1ners6me2olterskluwer11odside6rk0s2ld3w2s1tc1f3xbox3erox4ihuan4n2xx2yz3yachts4hoo3maxun5ndex5e1odobashi7ga2kohama6u0tube6t1un3za0ppos4ra3ero3ip2m1one3uerich6w2';
// Internationalized domain names containing non-ASCII
const encodedUtlds = 'ελ1υ2бг1ел3дети4ею2католик6ом3мкд2он1сква6онлайн5рг3рус2ф2сайт3рб3укр3қаз3հայ3ישראל5קום3ابوظبي5رامكو5لاردن4بحرين5جزائر5سعودية6عليان5مغرب5مارات5یران5بارت2زار4يتك3ھارت5تونس4سودان3رية5شبكة4عراق2ب2مان4فلسطين6قطر3كاثوليك6وم3مصر2ليسيا5وريتانيا7قع4همراه5پاکستان7ڀارت4कॉम3नेट3भारत0म्3ोत5संगठन5বাংলা5ভারত2ৰত4ਭਾਰਤ4ભારત4ଭାରତ4இந்தியா6லங்கை6சிங்கப்பூர்11భారత్5ಭಾರತ4ഭാരതം5ලංකා4คอม3ไทย3ລາວ3გე2みんな3アマゾン4クラウド4グーグル4コム2ストア3セール3ファッション6ポイント4世界2中信1国1國1文网3亚马逊3企业2佛山2信息2健康2八卦2公司1益2台湾1灣2商城1店1标2嘉里0大酒店5在线2大拿2天主教3娱乐2家電2广东2微博2慈善2我爱你3手机2招聘2政务1府2新加坡2闻2时尚2書籍2机构2淡马锡3游戏2澳門2点看2移动2组织机构4网址1店1站1络2联通2谷歌2购物2通販2集团2電訊盈科4飞利浦3食品2餐厅2香格里拉3港2닷넷1컴2삼성2한국2';

/**
 * Finite State Machine generation utilities
 */

/**
 * @template T
 * @typedef {{ [group: string]: T[] }} Collections
 */

/**
 * @typedef {{ [group: string]: true }} Flags
 */

// Keys in scanner Collections instances
const numeric = 'numeric';
const ascii = 'ascii';
const alpha = 'alpha';
const asciinumeric = 'asciinumeric';
const alphanumeric = 'alphanumeric';
const domain = 'domain';
const emoji = 'emoji';
const scheme = 'scheme';
const slashscheme = 'slashscheme';
const whitespace = 'whitespace';

/**
 * @template T
 * @param {string} name
 * @param {Collections<T>} groups to register in
 * @returns {T[]} Current list of tokens in the given collection
 */
function registerGroup(name, groups) {
  if (!(name in groups)) {
    groups[name] = [];
  }
  return groups[name];
}

/**
 * @template T
 * @param {T} t token to add
 * @param {Collections<T>} groups
 * @param {Flags} flags
 */
function addToGroups(t, flags, groups) {
  if (flags[numeric]) {
    flags[asciinumeric] = true;
    flags[alphanumeric] = true;
  }
  if (flags[ascii]) {
    flags[asciinumeric] = true;
    flags[alpha] = true;
  }
  if (flags[asciinumeric]) {
    flags[alphanumeric] = true;
  }
  if (flags[alpha]) {
    flags[alphanumeric] = true;
  }
  if (flags[alphanumeric]) {
    flags[domain] = true;
  }
  if (flags[emoji]) {
    flags[domain] = true;
  }
  for (const k in flags) {
    const group = registerGroup(k, groups);
    if (group.indexOf(t) < 0) {
      group.push(t);
    }
  }
}

/**
 * @template T
 * @param {T} t token to check
 * @param {Collections<T>} groups
 * @returns {Flags} group flags that contain this token
 */
function flagsForToken(t, groups) {
  const result = {};
  for (const c in groups) {
    if (groups[c].indexOf(t) >= 0) {
      result[c] = true;
    }
  }
  return result;
}

/**
 * @template T
 * @typedef {null | T } Transition
 */

/**
 * Define a basic state machine state. j is the list of character transitions,
 * jr is the list of regex-match transitions, jd is the default state to
 * transition to t is the accepting token type, if any. If this is the terminal
 * state, then it does not emit a token.
 *
 * The template type T represents the type of the token this state accepts. This
 * should be a string (such as of the token exports in `text.js`) or a
 * MultiToken subclass (from `multi.js`)
 *
 * @template T
 * @param {T} [token] Token that this state emits
 */
function State(token = null) {
  // this.n = null; // DEBUG: State name
  /** @type {{ [input: string]: State<T> }} j */
  this.j = {}; // IMPLEMENTATION 1
  // this.j = []; // IMPLEMENTATION 2
  /** @type {[RegExp, State<T>][]} jr */
  this.jr = [];
  /** @type {?State<T>} jd */
  this.jd = null;
  /** @type {?T} t */
  this.t = token;
}

/**
 * Scanner token groups
 * @type Collections<string>
 */
State.groups = {};
State.prototype = {
  accepts() {
    return !!this.t;
  },
  /**
   * Follow an existing transition from the given input to the next state.
   * Does not mutate.
   * @param {string} input character or token type to transition on
   * @returns {?State<T>} the next state, if any
   */
  go(input) {
    const state = this;
    const nextState = state.j[input];
    if (nextState) {
      return nextState;
    }
    for (let i = 0; i < state.jr.length; i++) {
      const regex = state.jr[i][0];
      const nextState = state.jr[i][1]; // note: might be empty to prevent default jump
      if (nextState && regex.test(input)) {
        return nextState;
      }
    }
    // Nowhere left to jump! Return default, if any
    return state.jd;
  },
  /**
   * Whether the state has a transition for the given input. Set the second
   * argument to true to only look for an exact match (and not a default or
   * regular-expression-based transition)
   * @param {string} input
   * @param {boolean} exactOnly
   */
  has(input, exactOnly = false) {
    return exactOnly ? input in this.j : !!this.go(input);
  },
  /**
   * Short for "transition all"; create a transition from the array of items
   * in the given list to the same final resulting state.
   * @param {string | string[]} inputs Group of inputs to transition on
   * @param {Transition<T> | State<T>} [next] Transition options
   * @param {Flags} [flags] Collections flags to add token to
   * @param {Collections<T>} [groups] Master list of token groups
   */
  ta(inputs, next, flags, groups) {
    for (let i = 0; i < inputs.length; i++) {
      this.tt(inputs[i], next, flags, groups);
    }
  },
  /**
   * Short for "take regexp transition"; defines a transition for this state
   * when it encounters a token which matches the given regular expression
   * @param {RegExp} regexp Regular expression transition (populate first)
   * @param {T | State<T>} [next] Transition options
   * @param {Flags} [flags] Collections flags to add token to
   * @param {Collections<T>} [groups] Master list of token groups
   * @returns {State<T>} taken after the given input
   */
  tr(regexp, next, flags, groups) {
    groups = groups || State.groups;
    let nextState;
    if (next && next.j) {
      nextState = next;
    } else {
      // Token with maybe token groups
      nextState = new State(next);
      if (flags && groups) {
        addToGroups(next, flags, groups);
      }
    }
    this.jr.push([regexp, nextState]);
    return nextState;
  },
  /**
   * Short for "take transitions", will take as many sequential transitions as
   * the length of the given input and returns the
   * resulting final state.
   * @param {string | string[]} input
   * @param {T | State<T>} [next] Transition options
   * @param {Flags} [flags] Collections flags to add token to
   * @param {Collections<T>} [groups] Master list of token groups
   * @returns {State<T>} taken after the given input
   */
  ts(input, next, flags, groups) {
    let state = this;
    const len = input.length;
    if (!len) {
      return state;
    }
    for (let i = 0; i < len - 1; i++) {
      state = state.tt(input[i]);
    }
    return state.tt(input[len - 1], next, flags, groups);
  },
  /**
   * Short for "take transition", this is a method for building/working with
   * state machines.
   *
   * If a state already exists for the given input, returns it.
   *
   * If a token is specified, that state will emit that token when reached by
   * the linkify engine.
   *
   * If no state exists, it will be initialized with some default transitions
   * that resemble existing default transitions.
   *
   * If a state is given for the second argument, that state will be
   * transitioned to on the given input regardless of what that input
   * previously did.
   *
   * Specify a token group flags to define groups that this token belongs to.
   * The token will be added to corresponding entires in the given groups
   * object.
   *
   * @param {string} input character, token type to transition on
   * @param {T | State<T>} [next] Transition options
   * @param {Flags} [flags] Collections flags to add token to
   * @param {Collections<T>} [groups] Master list of groups
   * @returns {State<T>} taken after the given input
   */
  tt(input, next, flags, groups) {
    groups = groups || State.groups;
    const state = this;

    // Check if existing state given, just a basic transition
    if (next && next.j) {
      state.j[input] = next;
      return next;
    }
    const t = next;

    // Take the transition with the usual default mechanisms and use that as
    // a template for creating the next state
    let nextState,
      templateState = state.go(input);
    if (templateState) {
      nextState = new State();
      Object.assign(nextState.j, templateState.j);
      nextState.jr.push.apply(nextState.jr, templateState.jr);
      nextState.jd = templateState.jd;
      nextState.t = templateState.t;
    } else {
      nextState = new State();
    }
    if (t) {
      // Ensure newly token is in the same groups as the old token
      if (groups) {
        if (nextState.t && typeof nextState.t === 'string') {
          const allFlags = Object.assign(flagsForToken(nextState.t, groups), flags);
          addToGroups(t, allFlags, groups);
        } else if (flags) {
          addToGroups(t, flags, groups);
        }
      }
      nextState.t = t; // overwrite anything that was previously there
    }
    state.j[input] = nextState;
    return nextState;
  }
};

// Helper functions to improve minification (not exported outside linkifyjs module)

/**
 * @template T
 * @param {State<T>} state
 * @param {string | string[]} input
 * @param {Flags} [flags]
 * @param {Collections<T>} [groups]
 */
const ta = (state, input, next, flags, groups) => state.ta(input, next, flags, groups);

/**
 * @template T
 * @param {State<T>} state
 * @param {RegExp} regexp
 * @param {T | State<T>} [next]
 * @param {Flags} [flags]
 * @param {Collections<T>} [groups]
 */
const tr = (state, regexp, next, flags, groups) => state.tr(regexp, next, flags, groups);

/**
 * @template T
 * @param {State<T>} state
 * @param {string | string[]} input
 * @param {T | State<T>} [next]
 * @param {Flags} [flags]
 * @param {Collections<T>} [groups]
 */
const ts = (state, input, next, flags, groups) => state.ts(input, next, flags, groups);

/**
 * @template T
 * @param {State<T>} state
 * @param {string} input
 * @param {T | State<T>} [next]
 * @param {Collections<T>} [groups]
 * @param {Flags} [flags]
 */
const tt = (state, input, next, flags, groups) => state.tt(input, next, flags, groups);

/******************************************************************************
Text Tokens
Identifiers for token outputs from the regexp scanner
******************************************************************************/

// A valid web domain token
const WORD = 'WORD'; // only contains a-z
const UWORD = 'UWORD'; // contains letters other than a-z, used for IDN
const ASCIINUMERICAL = 'ASCIINUMERICAL'; // contains a-z, 0-9
const ALPHANUMERICAL = 'ALPHANUMERICAL'; // contains numbers and letters other than a-z, used for IDN

// Special case of word
const LOCALHOST = 'LOCALHOST';

// Valid top-level domain, special case of WORD (see tlds.js)
const TLD = 'TLD';

// Valid IDN TLD, special case of UWORD (see tlds.js)
const UTLD = 'UTLD';

// The scheme portion of a web URI protocol. Supported types include: `mailto`,
// `file`, and user-defined custom protocols. Limited to schemes that contain
// only letters
const SCHEME = 'SCHEME';

// Similar to SCHEME, except makes distinction for schemes that must always be
// followed by `://`, not just `:`. Supported types include `http`, `https`,
// `ftp`, `ftps`
const SLASH_SCHEME = 'SLASH_SCHEME';

// Any sequence of digits 0-9
const NUM = 'NUM';

// Any number of consecutive whitespace characters that are not newline
const WS = 'WS';

// New line (unix style)
const NL = 'NL'; // \n

// Opening/closing bracket classes
// TODO: Rename OPEN -> LEFT and CLOSE -> RIGHT in v5 to fit with Unicode names
// Also rename angle brackes to LESSTHAN and GREATER THAN
const OPENBRACE = 'OPENBRACE'; // {
const CLOSEBRACE = 'CLOSEBRACE'; // }
const OPENBRACKET = 'OPENBRACKET'; // [
const CLOSEBRACKET = 'CLOSEBRACKET'; // ]
const OPENPAREN = 'OPENPAREN'; // (
const CLOSEPAREN = 'CLOSEPAREN'; // )
const OPENANGLEBRACKET = 'OPENANGLEBRACKET'; // <
const CLOSEANGLEBRACKET = 'CLOSEANGLEBRACKET'; // >
const FULLWIDTHLEFTPAREN = 'FULLWIDTHLEFTPAREN'; // （
const FULLWIDTHRIGHTPAREN = 'FULLWIDTHRIGHTPAREN'; // ）
const LEFTCORNERBRACKET = 'LEFTCORNERBRACKET'; // 「
const RIGHTCORNERBRACKET = 'RIGHTCORNERBRACKET'; // 」
const LEFTWHITECORNERBRACKET = 'LEFTWHITECORNERBRACKET'; // 『
const RIGHTWHITECORNERBRACKET = 'RIGHTWHITECORNERBRACKET'; // 』
const FULLWIDTHLESSTHAN = 'FULLWIDTHLESSTHAN'; // ＜
const FULLWIDTHGREATERTHAN = 'FULLWIDTHGREATERTHAN'; // ＞

// Various symbols
const AMPERSAND = 'AMPERSAND'; // &
const APOSTROPHE = 'APOSTROPHE'; // '
const ASTERISK = 'ASTERISK'; // *
const AT = 'AT'; // @
const BACKSLASH = 'BACKSLASH'; // \
const BACKTICK = 'BACKTICK'; // `
const CARET = 'CARET'; // ^
const COLON = 'COLON'; // :
const COMMA = 'COMMA'; // ,
const DOLLAR = 'DOLLAR'; // $
const DOT = 'DOT'; // .
const EQUALS = 'EQUALS'; // =
const EXCLAMATION = 'EXCLAMATION'; // !
const HYPHEN = 'HYPHEN'; // -
const PERCENT = 'PERCENT'; // %
const PIPE = 'PIPE'; // |
const PLUS = 'PLUS'; // +
const POUND = 'POUND'; // #
const QUERY = 'QUERY'; // ?
const QUOTE = 'QUOTE'; // "
const FULLWIDTHMIDDLEDOT = 'FULLWIDTHMIDDLEDOT'; // ・

const SEMI = 'SEMI'; // ;
const SLASH = 'SLASH'; // /
const TILDE = 'TILDE'; // ~
const UNDERSCORE = 'UNDERSCORE'; // _

// Emoji symbol
const EMOJI$1 = 'EMOJI';

// Default token - anything that is not one of the above
const SYM = 'SYM';

var tk = /*#__PURE__*/Object.freeze({
	__proto__: null,
	ALPHANUMERICAL: ALPHANUMERICAL,
	AMPERSAND: AMPERSAND,
	APOSTROPHE: APOSTROPHE,
	ASCIINUMERICAL: ASCIINUMERICAL,
	ASTERISK: ASTERISK,
	AT: AT,
	BACKSLASH: BACKSLASH,
	BACKTICK: BACKTICK,
	CARET: CARET,
	CLOSEANGLEBRACKET: CLOSEANGLEBRACKET,
	CLOSEBRACE: CLOSEBRACE,
	CLOSEBRACKET: CLOSEBRACKET,
	CLOSEPAREN: CLOSEPAREN,
	COLON: COLON,
	COMMA: COMMA,
	DOLLAR: DOLLAR,
	DOT: DOT,
	EMOJI: EMOJI$1,
	EQUALS: EQUALS,
	EXCLAMATION: EXCLAMATION,
	FULLWIDTHGREATERTHAN: FULLWIDTHGREATERTHAN,
	FULLWIDTHLEFTPAREN: FULLWIDTHLEFTPAREN,
	FULLWIDTHLESSTHAN: FULLWIDTHLESSTHAN,
	FULLWIDTHMIDDLEDOT: FULLWIDTHMIDDLEDOT,
	FULLWIDTHRIGHTPAREN: FULLWIDTHRIGHTPAREN,
	HYPHEN: HYPHEN,
	LEFTCORNERBRACKET: LEFTCORNERBRACKET,
	LEFTWHITECORNERBRACKET: LEFTWHITECORNERBRACKET,
	LOCALHOST: LOCALHOST,
	NL: NL,
	NUM: NUM,
	OPENANGLEBRACKET: OPENANGLEBRACKET,
	OPENBRACE: OPENBRACE,
	OPENBRACKET: OPENBRACKET,
	OPENPAREN: OPENPAREN,
	PERCENT: PERCENT,
	PIPE: PIPE,
	PLUS: PLUS,
	POUND: POUND,
	QUERY: QUERY,
	QUOTE: QUOTE,
	RIGHTCORNERBRACKET: RIGHTCORNERBRACKET,
	RIGHTWHITECORNERBRACKET: RIGHTWHITECORNERBRACKET,
	SCHEME: SCHEME,
	SEMI: SEMI,
	SLASH: SLASH,
	SLASH_SCHEME: SLASH_SCHEME,
	SYM: SYM,
	TILDE: TILDE,
	TLD: TLD,
	UNDERSCORE: UNDERSCORE,
	UTLD: UTLD,
	UWORD: UWORD,
	WORD: WORD,
	WS: WS
});

// Note that these two Unicode ones expand into a really big one with Babel
const ASCII_LETTER = /[a-z]/;
const LETTER = /\p{L}/u; // Any Unicode character with letter data type
const EMOJI = /\p{Emoji}/u; // Any Unicode emoji character
const EMOJI_VARIATION$1 = /\ufe0f/;
const DIGIT = /\d/;
const SPACE = /\s/;

var regexp = /*#__PURE__*/Object.freeze({
	__proto__: null,
	ASCII_LETTER: ASCII_LETTER,
	DIGIT: DIGIT,
	EMOJI: EMOJI,
	EMOJI_VARIATION: EMOJI_VARIATION$1,
	LETTER: LETTER,
	SPACE: SPACE
});

/**
	The scanner provides an interface that takes a string of text as input, and
	outputs an array of tokens instances that can be used for easy URL parsing.
*/

const CR = '\r'; // carriage-return character
const LF = '\n'; // line-feed character
const EMOJI_VARIATION = '\ufe0f'; // Variation selector, follows heart and others
const EMOJI_JOINER = '\u200d'; // zero-width joiner
const OBJECT_REPLACEMENT = '\ufffc'; // whitespace placeholder that sometimes appears in rich text editors

let tlds = null,
  utlds = null; // don't change so only have to be computed once

/**
 * Scanner output token:
 * - `t` is the token name (e.g., 'NUM', 'EMOJI', 'TLD')
 * - `v` is the value of the token (e.g., '123', '❤️', 'com')
 * - `s` is the start index of the token in the original string
 * - `e` is the end index of the token in the original string
 * @typedef {{t: string, v: string, s: number, e: number}} Token
 */

/**
 * @template T
 * @typedef {{ [collection: string]: T[] }} Collections
 */

/**
 * Initialize the scanner character-based state machine for the given start
 * state
 * @param {[string, boolean][]} customSchemes List of custom schemes, where each
 * item is a length-2 tuple with the first element set to the string scheme, and
 * the second element set to `true` if the `://` after the scheme is optional
 */
function init$2(customSchemes = []) {
  // Frequently used states (name argument removed during minification)
  /** @type Collections<string> */
  const groups = {}; // of tokens
  State.groups = groups;
  /** @type State<string> */
  const Start = new State();
  if (tlds == null) {
    tlds = decodeTlds(encodedTlds);
  }
  if (utlds == null) {
    utlds = decodeTlds(encodedUtlds);
  }

  // States for special URL symbols that accept immediately after start
  tt(Start, "'", APOSTROPHE);
  tt(Start, '{', OPENBRACE);
  tt(Start, '}', CLOSEBRACE);
  tt(Start, '[', OPENBRACKET);
  tt(Start, ']', CLOSEBRACKET);
  tt(Start, '(', OPENPAREN);
  tt(Start, ')', CLOSEPAREN);
  tt(Start, '<', OPENANGLEBRACKET);
  tt(Start, '>', CLOSEANGLEBRACKET);
  tt(Start, '（', FULLWIDTHLEFTPAREN);
  tt(Start, '）', FULLWIDTHRIGHTPAREN);
  tt(Start, '「', LEFTCORNERBRACKET);
  tt(Start, '」', RIGHTCORNERBRACKET);
  tt(Start, '『', LEFTWHITECORNERBRACKET);
  tt(Start, '』', RIGHTWHITECORNERBRACKET);
  tt(Start, '＜', FULLWIDTHLESSTHAN);
  tt(Start, '＞', FULLWIDTHGREATERTHAN);
  tt(Start, '&', AMPERSAND);
  tt(Start, '*', ASTERISK);
  tt(Start, '@', AT);
  tt(Start, '`', BACKTICK);
  tt(Start, '^', CARET);
  tt(Start, ':', COLON);
  tt(Start, ',', COMMA);
  tt(Start, '$', DOLLAR);
  tt(Start, '.', DOT);
  tt(Start, '=', EQUALS);
  tt(Start, '!', EXCLAMATION);
  tt(Start, '-', HYPHEN);
  tt(Start, '%', PERCENT);
  tt(Start, '|', PIPE);
  tt(Start, '+', PLUS);
  tt(Start, '#', POUND);
  tt(Start, '?', QUERY);
  tt(Start, '"', QUOTE);
  tt(Start, '/', SLASH);
  tt(Start, ';', SEMI);
  tt(Start, '~', TILDE);
  tt(Start, '_', UNDERSCORE);
  tt(Start, '\\', BACKSLASH);
  tt(Start, '・', FULLWIDTHMIDDLEDOT);
  const Num = tr(Start, DIGIT, NUM, {
    [numeric]: true
  });
  tr(Num, DIGIT, Num);
  const Asciinumeric = tr(Num, ASCII_LETTER, ASCIINUMERICAL, {
    [asciinumeric]: true
  });
  const Alphanumeric = tr(Num, LETTER, ALPHANUMERICAL, {
    [alphanumeric]: true
  });

  // State which emits a word token
  const Word = tr(Start, ASCII_LETTER, WORD, {
    [ascii]: true
  });
  tr(Word, DIGIT, Asciinumeric);
  tr(Word, ASCII_LETTER, Word);
  tr(Asciinumeric, DIGIT, Asciinumeric);
  tr(Asciinumeric, ASCII_LETTER, Asciinumeric);

  // Same as previous, but specific to non-fsm.ascii alphabet words
  const UWord = tr(Start, LETTER, UWORD, {
    [alpha]: true
  });
  tr(UWord, ASCII_LETTER); // Non-accepting
  tr(UWord, DIGIT, Alphanumeric);
  tr(UWord, LETTER, UWord);
  tr(Alphanumeric, DIGIT, Alphanumeric);
  tr(Alphanumeric, ASCII_LETTER); // Non-accepting
  tr(Alphanumeric, LETTER, Alphanumeric); // Non-accepting

  // Whitespace jumps
  // Tokens of only non-newline whitespace are arbitrarily long
  // If any whitespace except newline, more whitespace!
  const Nl = tt(Start, LF, NL, {
    [whitespace]: true
  });
  const Cr = tt(Start, CR, WS, {
    [whitespace]: true
  });
  const Ws = tr(Start, SPACE, WS, {
    [whitespace]: true
  });
  tt(Start, OBJECT_REPLACEMENT, Ws);
  tt(Cr, LF, Nl); // \r\n
  tt(Cr, OBJECT_REPLACEMENT, Ws);
  tr(Cr, SPACE, Ws);
  tt(Ws, CR); // non-accepting state to avoid mixing whitespaces
  tt(Ws, LF); // non-accepting state to avoid mixing whitespaces
  tr(Ws, SPACE, Ws);
  tt(Ws, OBJECT_REPLACEMENT, Ws);

  // Emoji tokens. They are not grouped by the scanner except in cases where a
  // zero-width joiner is present
  const Emoji = tr(Start, EMOJI, EMOJI$1, {
    [emoji]: true
  });
  tt(Emoji, '#'); // no transition, emoji regex seems to match #
  tr(Emoji, EMOJI, Emoji);
  tt(Emoji, EMOJI_VARIATION, Emoji);
  // tt(Start, EMOJI_VARIATION, Emoji); // This one is sketchy

  const EmojiJoiner = tt(Emoji, EMOJI_JOINER);
  tt(EmojiJoiner, '#');
  tr(EmojiJoiner, EMOJI, Emoji);
  // tt(EmojiJoiner, EMOJI_VARIATION, Emoji); // also sketchy

  // Generates states for top-level domains
  // Note that this is most accurate when tlds are in alphabetical order
  const wordjr = [[ASCII_LETTER, Word], [DIGIT, Asciinumeric]];
  const uwordjr = [[ASCII_LETTER, null], [LETTER, UWord], [DIGIT, Alphanumeric]];
  for (let i = 0; i < tlds.length; i++) {
    fastts(Start, tlds[i], TLD, WORD, wordjr);
  }
  for (let i = 0; i < utlds.length; i++) {
    fastts(Start, utlds[i], UTLD, UWORD, uwordjr);
  }
  addToGroups(TLD, {
    tld: true,
    ascii: true
  }, groups);
  addToGroups(UTLD, {
    utld: true,
    alpha: true
  }, groups);

  // Collect the states generated by different protocols. NOTE: If any new TLDs
  // get added that are also protocols, set the token to be the same as the
  // protocol to ensure parsing works as expected.
  fastts(Start, 'file', SCHEME, WORD, wordjr);
  fastts(Start, 'mailto', SCHEME, WORD, wordjr);
  fastts(Start, 'http', SLASH_SCHEME, WORD, wordjr);
  fastts(Start, 'https', SLASH_SCHEME, WORD, wordjr);
  fastts(Start, 'ftp', SLASH_SCHEME, WORD, wordjr);
  fastts(Start, 'ftps', SLASH_SCHEME, WORD, wordjr);
  addToGroups(SCHEME, {
    scheme: true,
    ascii: true
  }, groups);
  addToGroups(SLASH_SCHEME, {
    slashscheme: true,
    ascii: true
  }, groups);

  // Register custom schemes. Assumes each scheme is asciinumeric with hyphens
  customSchemes = customSchemes.sort((a, b) => a[0] > b[0] ? 1 : -1);
  for (let i = 0; i < customSchemes.length; i++) {
    const sch = customSchemes[i][0];
    const optionalSlashSlash = customSchemes[i][1];
    const flags = optionalSlashSlash ? {
      [scheme]: true
    } : {
      [slashscheme]: true
    };
    if (sch.indexOf('-') >= 0) {
      flags[domain] = true;
    } else if (!ASCII_LETTER.test(sch)) {
      flags[numeric] = true; // numbers only
    } else if (DIGIT.test(sch)) {
      flags[asciinumeric] = true;
    } else {
      flags[ascii] = true;
    }
    ts(Start, sch, sch, flags);
  }

  // Localhost token
  ts(Start, 'localhost', LOCALHOST, {
    ascii: true
  });

  // Set default transition for start state (some symbol)
  Start.jd = new State(SYM);
  return {
    start: Start,
    tokens: Object.assign({
      groups
    }, tk)
  };
}

/**
	Given a string, returns an array of TOKEN instances representing the
	composition of that string.

	@method run
	@param {State<string>} start scanner starting state
	@param {string} str input string to scan
	@return {Token[]} list of tokens, each with a type and value
*/
function run$1(start, str) {
  // State machine is not case sensitive, so input is tokenized in lowercased
  // form (still returns regular case). Uses selective `toLowerCase` because
  // lowercasing the entire string causes the length and character position to
  // vary in some non-English strings with V8-based runtimes.
  const iterable = stringToArray(str.replace(/[A-Z]/g, c => c.toLowerCase()));
  const charCount = iterable.length; // <= len if there are emojis, etc
  const tokens = []; // return value

  // cursor through the string itself, accounting for characters that have
  // width with length 2 such as emojis
  let cursor = 0;

  // Cursor through the array-representation of the string
  let charCursor = 0;

  // Tokenize the string
  while (charCursor < charCount) {
    let state = start;
    let nextState = null;
    let tokenLength = 0;
    let latestAccepting = null;
    let sinceAccepts = -1;
    let charsSinceAccepts = -1;
    while (charCursor < charCount && (nextState = state.go(iterable[charCursor]))) {
      state = nextState;

      // Keep track of the latest accepting state
      if (state.accepts()) {
        sinceAccepts = 0;
        charsSinceAccepts = 0;
        latestAccepting = state;
      } else if (sinceAccepts >= 0) {
        sinceAccepts += iterable[charCursor].length;
        charsSinceAccepts++;
      }
      tokenLength += iterable[charCursor].length;
      cursor += iterable[charCursor].length;
      charCursor++;
    }

    // Roll back to the latest accepting state
    cursor -= sinceAccepts;
    charCursor -= charsSinceAccepts;
    tokenLength -= sinceAccepts;

    // No more jumps, just make a new token from the last accepting one
    tokens.push({
      t: latestAccepting.t,
      // token type/name
      v: str.slice(cursor - tokenLength, cursor),
      // string value
      s: cursor - tokenLength,
      // start index
      e: cursor // end index (excluding)
    });
  }
  return tokens;
}

/**
 * Convert a String to an Array of characters, taking into account that some
 * characters like emojis take up two string indexes.
 *
 * Adapted from core-js (MIT license)
 * https://github.com/zloirock/core-js/blob/2d69cf5f99ab3ea3463c395df81e5a15b68f49d9/packages/core-js/internals/string-multibyte.js
 *
 * @function stringToArray
 * @param {string} str
 * @returns {string[]}
 */
function stringToArray(str) {
  const result = [];
  const len = str.length;
  let index = 0;
  while (index < len) {
    let first = str.charCodeAt(index);
    let second;
    let char = first < 0xd800 || first > 0xdbff || index + 1 === len || (second = str.charCodeAt(index + 1)) < 0xdc00 || second > 0xdfff ? str[index] // single character
    : str.slice(index, index + 2); // two-index characters
    result.push(char);
    index += char.length;
  }
  return result;
}

/**
 * Fast version of ts function for when transition defaults are well known
 * @param {State<string>} state
 * @param {string} input
 * @param {string} t
 * @param {string} defaultt
 * @param {[RegExp, State<string>][]} jr
 * @returns {State<string>}
 */
function fastts(state, input, t, defaultt, jr) {
  let next;
  const len = input.length;
  for (let i = 0; i < len - 1; i++) {
    const char = input[i];
    if (state.j[char]) {
      next = state.j[char];
    } else {
      next = new State(defaultt);
      next.jr = jr.slice();
      state.j[char] = next;
    }
    state = next;
  }
  next = new State(t);
  next.jr = jr.slice();
  state.j[input[len - 1]] = next;
  return next;
}

/**
 * Converts a string of Top-Level Domain names encoded in update-tlds.js back
 * into a list of strings.
 * @param {str} encoded encoded TLDs string
 * @returns {str[]} original TLDs list
 */
function decodeTlds(encoded) {
  const words = [];
  const stack = [];
  let i = 0;
  let digits = '0123456789';
  while (i < encoded.length) {
    let popDigitCount = 0;
    while (digits.indexOf(encoded[i + popDigitCount]) >= 0) {
      popDigitCount++; // encountered some digits, have to pop to go one level up trie
    }
    if (popDigitCount > 0) {
      words.push(stack.join('')); // whatever preceded the pop digits must be a word
      for (let popCount = parseInt(encoded.substring(i, i + popDigitCount), 10); popCount > 0; popCount--) {
        stack.pop();
      }
      i += popDigitCount;
    } else {
      stack.push(encoded[i]); // drop down a level into the trie
      i++;
    }
  }
  return words;
}

/**
 * An object where each key is a valid DOM Event Name such as `click` or `focus`
 * and each value is an event handler function.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/Element#events
 * @typedef {?{ [event: string]: Function }} EventListeners
 */

/**
 * All formatted properties required to render a link, including `tagName`,
 * `attributes`, `content` and `eventListeners`.
 * @typedef {{ tagName: any, attributes: {[attr: string]: any}, content: string,
 * eventListeners: EventListeners }} IntermediateRepresentation
 */

/**
 * Specify either an object described by the template type `O` or a function.
 *
 * The function takes a string value (usually the link's href attribute), the
 * link type (`'url'`, `'hashtag`', etc.) and an internal token representation
 * of the link. It should return an object of the template type `O`
 * @template O
 * @typedef {O | ((value: string, type: string, token: MultiToken) => O)} OptObj
 */

/**
 * Specify either a function described by template type `F` or an object.
 *
 * Each key in the object should be a link type (`'url'`, `'hashtag`', etc.). Each
 * value should be a function with template type `F` that is called when the
 * corresponding link type is encountered.
 * @template F
 * @typedef {F | { [type: string]: F}} OptFn
 */

/**
 * Specify either a value with template type `V`, a function that returns `V` or
 * an object where each value resolves to `V`.
 *
 * The function takes a string value (usually the link's href attribute), the
 * link type (`'url'`, `'hashtag`', etc.) and an internal token representation
 * of the link. It should return an object of the template type `V`
 *
 * For the object, each key should be a link type (`'url'`, `'hashtag`', etc.).
 * Each value should either have type `V` or a function that returns V. This
 * function similarly takes a string value and a token.
 *
 * Example valid types for `Opt<string>`:
 *
 * ```js
 * 'hello'
 * (value, type, token) => 'world'
 * { url: 'hello', email: (value, token) => 'world'}
 * ```
 * @template V
 * @typedef {V | ((value: string, type: string, token: MultiToken) => V) | { [type: string]: V | ((value: string, token: MultiToken) => V) }} Opt
 */

/**
 * See available options: https://linkify.js.org/docs/options.html
 * @typedef {{
 * 	defaultProtocol?: string,
 *  events?: OptObj<EventListeners>,
 * 	format?: Opt<string>,
 * 	formatHref?: Opt<string>,
 * 	nl2br?: boolean,
 * 	tagName?: Opt<any>,
 * 	target?: Opt<string>,
 * 	rel?: Opt<string>,
 * 	validate?: Opt<boolean>,
 * 	truncate?: Opt<number>,
 * 	className?: Opt<string>,
 * 	attributes?: OptObj<({ [attr: string]: any })>,
 *  ignoreTags?: string[],
 * 	render?: OptFn<((ir: IntermediateRepresentation) => any)>
 * }} Opts
 */

/**
 * @type Required<Opts>
 */
const defaults = {
  defaultProtocol: 'http',
  events: null,
  format: noop,
  formatHref: noop,
  nl2br: false,
  tagName: 'a',
  target: null,
  rel: null,
  validate: true,
  truncate: Infinity,
  className: null,
  attributes: null,
  ignoreTags: [],
  render: null
};

/**
 * Utility class for linkify interfaces to apply specified
 * {@link Opts formatting and rendering options}.
 *
 * @param {Opts | Options} [opts] Option value overrides.
 * @param {(ir: IntermediateRepresentation) => any} [defaultRender] (For
 *   internal use) default render function that determines how to generate an
 *   HTML element based on a link token's derived tagName, attributes and HTML.
 *   Similar to render option
 */
function Options(opts, defaultRender = null) {
  let o = Object.assign({}, defaults);
  if (opts) {
    o = Object.assign(o, opts instanceof Options ? opts.o : opts);
  }

  // Ensure all ignored tags are uppercase
  const ignoredTags = o.ignoreTags;
  const uppercaseIgnoredTags = [];
  for (let i = 0; i < ignoredTags.length; i++) {
    uppercaseIgnoredTags.push(ignoredTags[i].toUpperCase());
  }
  /** @protected */
  this.o = o;
  if (defaultRender) {
    this.defaultRender = defaultRender;
  }
  this.ignoreTags = uppercaseIgnoredTags;
}
Options.prototype = {
  o: defaults,
  /**
   * @type string[]
   */
  ignoreTags: [],
  /**
   * @param {IntermediateRepresentation} ir
   * @returns {any}
   */
  defaultRender(ir) {
    return ir;
  },
  /**
   * Returns true or false based on whether a token should be displayed as a
   * link based on the user options.
   * @param {MultiToken} token
   * @returns {boolean}
   */
  check(token) {
    return this.get('validate', token.toString(), token);
  },
  // Private methods

  /**
   * Resolve an option's value based on the value of the option and the given
   * params. If operator and token are specified and the target option is
   * callable, automatically calls the function with the given argument.
   * @template {keyof Opts} K
   * @param {K} key Name of option to use
   * @param {string} [operator] will be passed to the target option if it's a
   * function. If not specified, RAW function value gets returned
   * @param {MultiToken} [token] The token from linkify.tokenize
   * @returns {Opts[K] | any}
   */
  get(key, operator, token) {
    const isCallable = operator != null;
    let option = this.o[key];
    if (!option) {
      return option;
    }
    if (typeof option === 'object') {
      option = token.t in option ? option[token.t] : defaults[key];
      if (typeof option === 'function' && isCallable) {
        option = option(operator, token);
      }
    } else if (typeof option === 'function' && isCallable) {
      option = option(operator, token.t, token);
    }
    return option;
  },
  /**
   * @template {keyof Opts} L
   * @param {L} key Name of options object to use
   * @param {string} [operator]
   * @param {MultiToken} [token]
   * @returns {Opts[L] | any}
   */
  getObj(key, operator, token) {
    let obj = this.o[key];
    if (typeof obj === 'function' && operator != null) {
      obj = obj(operator, token.t, token);
    }
    return obj;
  },
  /**
   * Convert the given token to a rendered element that may be added to the
   * calling-interface's DOM
   * @param {MultiToken} token Token to render to an HTML element
   * @returns {any} Render result; e.g., HTML string, DOM element, React
   *   Component, etc.
   */
  render(token) {
    const ir = token.render(this); // intermediate representation
    const renderFn = this.get('render', null, token) || this.defaultRender;
    return renderFn(ir, token.t, token);
  }
};
function noop(val) {
  return val;
}

var options = /*#__PURE__*/Object.freeze({
	__proto__: null,
	Options: Options,
	defaults: defaults
});

/******************************************************************************
	Multi-Tokens
	Tokens composed of arrays of TextTokens
******************************************************************************/

/**
 * @param {string} value
 * @param {Token[]} tokens
 */
function MultiToken(value, tokens) {
  this.t = 'token';
  this.v = value;
  this.tk = tokens;
}

/**
 * Abstract class used for manufacturing tokens of text tokens. That is rather
 * than the value for a token being a small string of text, it's value an array
 * of text tokens.
 *
 * Used for grouping together URLs, emails, hashtags, and other potential
 * creations.
 * @class MultiToken
 * @property {string} t
 * @property {string} v
 * @property {Token[]} tk
 * @abstract
 */
MultiToken.prototype = {
  isLink: false,
  /**
   * Return the string this token represents.
   * @return {string}
   */
  toString() {
    return this.v;
  },
  /**
   * What should the value for this token be in the `href` HTML attribute?
   * Returns the `.toString` value by default.
   * @param {string} [scheme]
   * @return {string}
   */
  toHref(scheme) {
    return this.toString();
  },
  /**
   * @param {Options} options Formatting options
   * @returns {string}
   */
  toFormattedString(options) {
    const val = this.toString();
    const truncate = options.get('truncate', val, this);
    const formatted = options.get('format', val, this);
    return truncate && formatted.length > truncate ? formatted.substring(0, truncate) + '…' : formatted;
  },
  /**
   *
   * @param {Options} options
   * @returns {string}
   */
  toFormattedHref(options) {
    return options.get('formatHref', this.toHref(options.get('defaultProtocol')), this);
  },
  /**
   * The start index of this token in the original input string
   * @returns {number}
   */
  startIndex() {
    return this.tk[0].s;
  },
  /**
   * The end index of this token in the original input string (up to this
   * index but not including it)
   * @returns {number}
   */
  endIndex() {
    return this.tk[this.tk.length - 1].e;
  },
  /**
  	Returns an object  of relevant values for this token, which includes keys
  	* type - Kind of token ('url', 'email', etc.)
  	* value - Original text
  	* href - The value that should be added to the anchor tag's href
  		attribute
  		@method toObject
  	@param {string} [protocol] `'http'` by default
  */
  toObject(protocol = defaults.defaultProtocol) {
    return {
      type: this.t,
      value: this.toString(),
      isLink: this.isLink,
      href: this.toHref(protocol),
      start: this.startIndex(),
      end: this.endIndex()
    };
  },
  /**
   *
   * @param {Options} options Formatting option
   */
  toFormattedObject(options) {
    return {
      type: this.t,
      value: this.toFormattedString(options),
      isLink: this.isLink,
      href: this.toFormattedHref(options),
      start: this.startIndex(),
      end: this.endIndex()
    };
  },
  /**
   * Whether this token should be rendered as a link according to the given options
   * @param {Options} options
   * @returns {boolean}
   */
  validate(options) {
    return options.get('validate', this.toString(), this);
  },
  /**
   * Return an object that represents how this link should be rendered.
   * @param {Options} options Formattinng options
   */
  render(options) {
    const token = this;
    const href = this.toHref(options.get('defaultProtocol'));
    const formattedHref = options.get('formatHref', href, this);
    const tagName = options.get('tagName', href, token);
    const content = this.toFormattedString(options);
    const attributes = {};
    const className = options.get('className', href, token);
    const target = options.get('target', href, token);
    const rel = options.get('rel', href, token);
    const attrs = options.getObj('attributes', href, token);
    const eventListeners = options.getObj('events', href, token);
    attributes.href = formattedHref;
    if (className) {
      attributes.class = className;
    }
    if (target) {
      attributes.target = target;
    }
    if (rel) {
      attributes.rel = rel;
    }
    if (attrs) {
      Object.assign(attributes, attrs);
    }
    return {
      tagName,
      attributes,
      content,
      eventListeners
    };
  }
};

/**
 * Create a new token that can be emitted by the parser state machine
 * @param {string} type readable type of the token
 * @param {object} props properties to assign or override, including isLink = true or false
 * @returns {new (value: string, tokens: Token[]) => MultiToken} new token class
 */
function createTokenClass(type, props) {
  class Token extends MultiToken {
    constructor(value, tokens) {
      super(value, tokens);
      this.t = type;
    }
  }
  for (const p in props) {
    Token.prototype[p] = props[p];
  }
  Token.t = type;
  return Token;
}

/**
	Represents a list of tokens making up a valid email address
*/
const Email = createTokenClass('email', {
  isLink: true,
  toHref() {
    return 'mailto:' + this.toString();
  }
});

/**
	Represents some plain text
*/
const Text = createTokenClass('text');

/**
	Multi-linebreak token - represents a line break
	@class Nl
*/
const Nl = createTokenClass('nl');

/**
	Represents a list of text tokens making up a valid URL
	@class Url
*/
const Url = createTokenClass('url', {
  isLink: true,
  /**
  	Lowercases relevant parts of the domain and adds the protocol if
  	required. Note that this will not escape unsafe HTML characters in the
  	URL.
  		@param {string} [scheme] default scheme (e.g., 'https')
  	@return {string} the full href
  */
  toHref(scheme = defaults.defaultProtocol) {
    // Check if already has a prefix scheme
    return this.hasProtocol() ? this.v : `${scheme}://${this.v}`;
  },
  /**
   * Check whether this URL token has a protocol
   * @return {boolean}
   */
  hasProtocol() {
    const tokens = this.tk;
    return tokens.length >= 2 && tokens[0].t !== LOCALHOST && tokens[1].t === COLON;
  }
});

var multi = /*#__PURE__*/Object.freeze({
	__proto__: null,
	Base: MultiToken,
	Email: Email,
	MultiToken: MultiToken,
	Nl: Nl,
	Text: Text,
	Url: Url,
	createTokenClass: createTokenClass
});

/**
	Not exactly parser, more like the second-stage scanner (although we can
	theoretically hotswap the code here with a real parser in the future... but
	for a little URL-finding utility abstract syntax trees may be a little
	overkill).

	URL format: http://en.wikipedia.org/wiki/URI_scheme
	Email format: http://en.wikipedia.org/wiki/EmailAddress (links to RFC in
	reference)

	@module linkify
	@submodule parser
	@main run
*/

const makeState = arg => new State(arg);

/**
 * Generate the parser multi token-based state machine
 * @param {{ groups: Collections<string> }} tokens
 */
function init$1({
  groups
}) {
  // Types of characters the URL can definitely end in
  const qsAccepting = groups.domain.concat([AMPERSAND, ASTERISK, AT, BACKSLASH, BACKTICK, CARET, DOLLAR, EQUALS, HYPHEN, NUM, PERCENT, PIPE, PLUS, POUND, SLASH, SYM, TILDE, UNDERSCORE]);

  // Types of tokens that can follow a URL and be part of the query string
  // but cannot be the very last characters
  // Characters that cannot appear in the URL at all should be excluded
  const qsNonAccepting = [APOSTROPHE, COLON, COMMA, DOT, EXCLAMATION, PERCENT, QUERY, QUOTE, SEMI, OPENANGLEBRACKET, CLOSEANGLEBRACKET, OPENBRACE, CLOSEBRACE, CLOSEBRACKET, OPENBRACKET, OPENPAREN, CLOSEPAREN, FULLWIDTHLEFTPAREN, FULLWIDTHRIGHTPAREN, LEFTCORNERBRACKET, RIGHTCORNERBRACKET, LEFTWHITECORNERBRACKET, RIGHTWHITECORNERBRACKET, FULLWIDTHLESSTHAN, FULLWIDTHGREATERTHAN];

  // For addresses without the mailto prefix
  // Tokens allowed in the localpart of the email
  const localpartAccepting = [AMPERSAND, APOSTROPHE, ASTERISK, BACKSLASH, BACKTICK, CARET, DOLLAR, EQUALS, HYPHEN, OPENBRACE, CLOSEBRACE, PERCENT, PIPE, PLUS, POUND, QUERY, SLASH, SYM, TILDE, UNDERSCORE];

  // The universal starting state.
  /**
   * @type State<Token>
   */
  const Start = makeState();
  const Localpart = tt(Start, TILDE); // Local part of the email address
  ta(Localpart, localpartAccepting, Localpart);
  ta(Localpart, groups.domain, Localpart);
  const Domain = makeState(),
    Scheme = makeState(),
    SlashScheme = makeState();
  ta(Start, groups.domain, Domain); // parsed string ends with a potential domain name (A)
  ta(Start, groups.scheme, Scheme); // e.g., 'mailto'
  ta(Start, groups.slashscheme, SlashScheme); // e.g., 'http'

  ta(Domain, localpartAccepting, Localpart);
  ta(Domain, groups.domain, Domain);
  const LocalpartAt = tt(Domain, AT); // Local part of the email address plus @

  tt(Localpart, AT, LocalpartAt); // close to an email address now

  // Local part of an email address can be e.g. 'http' or 'mailto'
  tt(Scheme, AT, LocalpartAt);
  tt(SlashScheme, AT, LocalpartAt);
  const LocalpartDot = tt(Localpart, DOT); // Local part of the email address plus '.' (localpart cannot end in .)
  ta(LocalpartDot, localpartAccepting, Localpart);
  ta(LocalpartDot, groups.domain, Localpart);
  const EmailDomain = makeState();
  ta(LocalpartAt, groups.domain, EmailDomain); // parsed string starts with local email info + @ with a potential domain name
  ta(EmailDomain, groups.domain, EmailDomain);
  const EmailDomainDot = tt(EmailDomain, DOT); // domain followed by DOT
  ta(EmailDomainDot, groups.domain, EmailDomain);
  const Email$1 = makeState(Email); // Possible email address (could have more tlds)
  ta(EmailDomainDot, groups.tld, Email$1);
  ta(EmailDomainDot, groups.utld, Email$1);
  tt(LocalpartAt, LOCALHOST, Email$1);

  // Hyphen can jump back to a domain name
  const EmailDomainHyphen = tt(EmailDomain, HYPHEN); // parsed string starts with local email info + @ with a potential domain name
  tt(EmailDomainHyphen, HYPHEN, EmailDomainHyphen);
  ta(EmailDomainHyphen, groups.domain, EmailDomain);
  ta(Email$1, groups.domain, EmailDomain);
  tt(Email$1, DOT, EmailDomainDot);
  tt(Email$1, HYPHEN, EmailDomainHyphen);

  // Final possible email states
  const EmailColon = tt(Email$1, COLON); // URL followed by colon (potential port number here)
  /*const EmailColonPort = */
  ta(EmailColon, groups.numeric, Email); // URL followed by colon and port number

  // Account for dots and hyphens. Hyphens are usually parts of domain names
  // (but not TLDs)
  const DomainHyphen = tt(Domain, HYPHEN); // domain followed by hyphen
  const DomainDot = tt(Domain, DOT); // domain followed by DOT
  tt(DomainHyphen, HYPHEN, DomainHyphen);
  ta(DomainHyphen, groups.domain, Domain);
  ta(DomainDot, localpartAccepting, Localpart);
  ta(DomainDot, groups.domain, Domain);
  const DomainDotTld = makeState(Url); // Simplest possible URL with no query string
  ta(DomainDot, groups.tld, DomainDotTld);
  ta(DomainDot, groups.utld, DomainDotTld);
  ta(DomainDotTld, groups.domain, Domain);
  ta(DomainDotTld, localpartAccepting, Localpart);
  tt(DomainDotTld, DOT, DomainDot);
  tt(DomainDotTld, HYPHEN, DomainHyphen);
  tt(DomainDotTld, AT, LocalpartAt);
  const DomainDotTldColon = tt(DomainDotTld, COLON); // URL followed by colon (potential port number here)
  const DomainDotTldColonPort = makeState(Url); // TLD followed by a port number
  ta(DomainDotTldColon, groups.numeric, DomainDotTldColonPort);

  // Long URL with optional port and maybe query string
  const Url$1 = makeState(Url);

  // URL with extra symbols at the end, followed by an opening bracket
  const UrlNonaccept = makeState(); // URL followed by some symbols (will not be part of the final URL)

  // Query strings
  ta(Url$1, qsAccepting, Url$1);
  ta(Url$1, qsNonAccepting, UrlNonaccept);
  ta(UrlNonaccept, qsAccepting, Url$1);
  ta(UrlNonaccept, qsNonAccepting, UrlNonaccept);

  // Become real URLs after `SLASH` or `COLON NUM SLASH`
  // Here works with or without scheme:// prefix
  tt(DomainDotTld, SLASH, Url$1);
  tt(DomainDotTldColonPort, SLASH, Url$1);

  // Note that domains that begin with schemes are treated slighly differently
  const SchemeColon = tt(Scheme, COLON); // e.g., 'mailto:'
  const SlashSchemeColon = tt(SlashScheme, COLON); // e.g., 'http:'
  const SlashSchemeColonSlash = tt(SlashSchemeColon, SLASH); // e.g., 'http:/'

  const UriPrefix = tt(SlashSchemeColonSlash, SLASH); // e.g., 'http://'

  // Scheme states can transition to domain states
  ta(Scheme, groups.domain, Domain);
  tt(Scheme, DOT, DomainDot);
  tt(Scheme, HYPHEN, DomainHyphen);
  ta(SlashScheme, groups.domain, Domain);
  tt(SlashScheme, DOT, DomainDot);
  tt(SlashScheme, HYPHEN, DomainHyphen);

  // Force URL with scheme prefix followed by anything sane
  ta(SchemeColon, groups.domain, Url$1);
  tt(SchemeColon, SLASH, Url$1);
  tt(SchemeColon, QUERY, Url$1);
  ta(UriPrefix, groups.domain, Url$1);
  ta(UriPrefix, qsAccepting, Url$1);
  tt(UriPrefix, SLASH, Url$1);
  const bracketPairs = [[OPENBRACE, CLOSEBRACE],
  // {}
  [OPENBRACKET, CLOSEBRACKET],
  // []
  [OPENPAREN, CLOSEPAREN],
  // ()
  [OPENANGLEBRACKET, CLOSEANGLEBRACKET],
  // <>
  [FULLWIDTHLEFTPAREN, FULLWIDTHRIGHTPAREN],
  // （）
  [LEFTCORNERBRACKET, RIGHTCORNERBRACKET],
  // 「」
  [LEFTWHITECORNERBRACKET, RIGHTWHITECORNERBRACKET],
  // 『』
  [FULLWIDTHLESSTHAN, FULLWIDTHGREATERTHAN] // ＜＞
  ];
  for (let i = 0; i < bracketPairs.length; i++) {
    const [OPEN, CLOSE] = bracketPairs[i];
    const UrlOpen = tt(Url$1, OPEN); // URL followed by open bracket

    // Continue not accepting for open brackets
    tt(UrlNonaccept, OPEN, UrlOpen);

    // Closing bracket component. This character WILL be included in the URL
    tt(UrlOpen, CLOSE, Url$1);

    // URL that beings with an opening bracket, followed by a symbols.
    // Note that the final state can still be `UrlOpen` (if the URL has a
    // single opening bracket for some reason).
    const UrlOpenQ = makeState(Url);
    ta(UrlOpen, qsAccepting, UrlOpenQ);
    const UrlOpenSyms = makeState(); // UrlOpen followed by some symbols it cannot end it
    ta(UrlOpen, qsNonAccepting);

    // URL that begins with an opening bracket, followed by some symbols
    ta(UrlOpenQ, qsAccepting, UrlOpenQ);
    ta(UrlOpenQ, qsNonAccepting, UrlOpenSyms);
    ta(UrlOpenSyms, qsAccepting, UrlOpenQ);
    ta(UrlOpenSyms, qsNonAccepting, UrlOpenSyms);

    // Close brace/bracket to become regular URL
    tt(UrlOpenQ, CLOSE, Url$1);
    tt(UrlOpenSyms, CLOSE, Url$1);
  }
  tt(Start, LOCALHOST, DomainDotTld); // localhost is a valid URL state
  tt(Start, NL, Nl); // single new line

  return {
    start: Start,
    tokens: tk
  };
}

/**
 * Run the parser state machine on a list of scanned string-based tokens to
 * create a list of multi tokens, each of which represents a URL, email address,
 * plain text, etc.
 *
 * @param {State<MultiToken>} start parser start state
 * @param {string} input the original input used to generate the given tokens
 * @param {Token[]} tokens list of scanned tokens
 * @returns {MultiToken[]}
 */
function run(start, input, tokens) {
  let len = tokens.length;
  let cursor = 0;
  let multis = [];
  let textTokens = [];
  while (cursor < len) {
    let state = start;
    let secondState = null;
    let nextState = null;
    let multiLength = 0;
    let latestAccepting = null;
    let sinceAccepts = -1;
    while (cursor < len && !(secondState = state.go(tokens[cursor].t))) {
      // Starting tokens with nowhere to jump to.
      // Consider these to be just plain text
      textTokens.push(tokens[cursor++]);
    }
    while (cursor < len && (nextState = secondState || state.go(tokens[cursor].t))) {
      // Get the next state
      secondState = null;
      state = nextState;

      // Keep track of the latest accepting state
      if (state.accepts()) {
        sinceAccepts = 0;
        latestAccepting = state;
      } else if (sinceAccepts >= 0) {
        sinceAccepts++;
      }
      cursor++;
      multiLength++;
    }
    if (sinceAccepts < 0) {
      // No accepting state was found, part of a regular text token add
      // the first text token to the text tokens array and try again from
      // the next
      cursor -= multiLength;
      if (cursor < len) {
        textTokens.push(tokens[cursor]);
        cursor++;
      }
    } else {
      // Accepting state!
      // First close off the textTokens (if available)
      if (textTokens.length > 0) {
        multis.push(initMultiToken(Text, input, textTokens));
        textTokens = [];
      }

      // Roll back to the latest accepting state
      cursor -= sinceAccepts;
      multiLength -= sinceAccepts;

      // Create a new multitoken
      const Multi = latestAccepting.t;
      const subtokens = tokens.slice(cursor - multiLength, cursor);
      multis.push(initMultiToken(Multi, input, subtokens));
    }
  }

  // Finally close off the textTokens (if available)
  if (textTokens.length > 0) {
    multis.push(initMultiToken(Text, input, textTokens));
  }
  return multis;
}

/**
 * Utility function for instantiating a new multitoken with all the relevant
 * fields during parsing.
 * @param {new (value: string, tokens: Token[]) => MultiToken} Multi class to instantiate
 * @param {string} input original input string
 * @param {Token[]} tokens consecutive tokens scanned from input string
 * @returns {MultiToken}
 */
function initMultiToken(Multi, input, tokens) {
  const startIdx = tokens[0].s;
  const endIdx = tokens[tokens.length - 1].e;
  const value = input.slice(startIdx, endIdx);
  return new Multi(value, tokens);
}

const warn = typeof console !== 'undefined' && console && console.warn || (() => {});
const warnAdvice = 'until manual call of linkify.init(). Register all schemes and plugins before invoking linkify the first time.';

// Side-effect initialization state
const INIT = {
  scanner: null,
  parser: null,
  tokenQueue: [],
  pluginQueue: [],
  customSchemes: [],
  initialized: false
};

/**
 * @typedef {{
 * 	start: State<string>,
 * 	tokens: { groups: Collections<string> } & typeof tk
 * }} ScannerInit
 */

/**
 * @typedef {{
 * 	start: State<MultiToken>,
 * 	tokens: typeof multi
 * }} ParserInit
 */

/**
 * @typedef {(arg: { scanner: ScannerInit }) => void} TokenPlugin
 */

/**
 * @typedef {(arg: { scanner: ScannerInit, parser: ParserInit }) => void} Plugin
 */

/**
 * De-register all plugins and reset the internal state-machine. Used for
 * testing; not required in practice.
 * @private
 */
function linkify_reset() {
  State.groups = {};
  INIT.scanner = null;
  INIT.parser = null;
  INIT.tokenQueue = [];
  INIT.pluginQueue = [];
  INIT.customSchemes = [];
  INIT.initialized = false;
  return INIT;
}

/**
 * Register a token plugin to allow the scanner to recognize additional token
 * types before the parser state machine is constructed from the results.
 * @param {string} name of plugin to register
 * @param {TokenPlugin} plugin function that accepts the scanner state machine
 * and available scanner tokens and collections and extends the state machine to
 * recognize additional tokens or groups.
 */
function registerTokenPlugin(name, plugin) {
  if (typeof plugin !== 'function') {
    throw new Error(`linkifyjs: Invalid token plugin ${plugin} (expects function)`);
  }
  for (let i = 0; i < INIT.tokenQueue.length; i++) {
    if (name === INIT.tokenQueue[i][0]) {
      warn(`linkifyjs: token plugin "${name}" already registered - will be overwritten`);
      INIT.tokenQueue[i] = [name, plugin];
      return;
    }
  }
  INIT.tokenQueue.push([name, plugin]);
  if (INIT.initialized) {
    warn(`linkifyjs: already initialized - will not register token plugin "${name}" ${warnAdvice}`);
  }
}

/**
 * Register a linkify plugin
 * @param {string} name of plugin to register
 * @param {Plugin} plugin function that accepts the parser state machine and
 * extends the parser to recognize additional link types
 */
function registerPlugin(name, plugin) {
  if (typeof plugin !== 'function') {
    throw new Error(`linkifyjs: Invalid plugin ${plugin} (expects function)`);
  }
  for (let i = 0; i < INIT.pluginQueue.length; i++) {
    if (name === INIT.pluginQueue[i][0]) {
      warn(`linkifyjs: plugin "${name}" already registered - will be overwritten`);
      INIT.pluginQueue[i] = [name, plugin];
      return;
    }
  }
  INIT.pluginQueue.push([name, plugin]);
  if (INIT.initialized) {
    warn(`linkifyjs: already initialized - will not register plugin "${name}" ${warnAdvice}`);
  }
}

/**
 * Detect URLs with the following additional protocol. Anything with format
 * "protocol://..." will be considered a link. If `optionalSlashSlash` is set to
 * `true`, anything with format "protocol:..." will be considered a link.
 * @param {string} scheme
 * @param {boolean} [optionalSlashSlash]
 */
function registerCustomProtocol(scheme, optionalSlashSlash = false) {
  if (INIT.initialized) {
    warn(`linkifyjs: already initialized - will not register custom scheme "${scheme}" ${warnAdvice}`);
  }
  if (!/^[0-9a-z]+(-[0-9a-z]+)*$/.test(scheme)) {
    throw new Error(`linkifyjs: incorrect scheme format.
1. Must only contain digits, lowercase ASCII letters or "-"
2. Cannot start or end with "-"
3. "-" cannot repeat`);
  }
  INIT.customSchemes.push([scheme, optionalSlashSlash]);
}

/**
 * Initialize the linkify state machine. Called automatically the first time
 * linkify is called on a string, but may be called manually as well.
 */
function init() {
  // Initialize scanner state machine and plugins
  INIT.scanner = init$2(INIT.customSchemes);
  for (let i = 0; i < INIT.tokenQueue.length; i++) {
    INIT.tokenQueue[i][1]({
      scanner: INIT.scanner
    });
  }

  // Initialize parser state machine and plugins
  INIT.parser = init$1(INIT.scanner.tokens);
  for (let i = 0; i < INIT.pluginQueue.length; i++) {
    INIT.pluginQueue[i][1]({
      scanner: INIT.scanner,
      parser: INIT.parser
    });
  }
  INIT.initialized = true;
  return INIT;
}

/**
 * Parse a string into tokens that represent linkable and non-linkable sub-components
 * @param {string} str
 * @return {MultiToken[]} tokens
 */
function tokenize(str) {
  if (!INIT.initialized) {
    init();
  }
  return run(INIT.parser.start, str, run$1(INIT.scanner.start, str));
}
tokenize.scan = run$1; // for testing

/**
 * Find a list of linkable items in the given string.
 * @param {string} str string to find links in
 * @param {string | Opts} [type] either formatting options or specific type of
 * links to find, e.g., 'url' or 'email'
 * @param {Opts} [opts] formatting options for final output. Cannot be specified
 * if opts already provided in `type` argument
 */
function find(str, type = null, opts = null) {
  if (type && typeof type === 'object') {
    if (opts) {
      throw Error(`linkifyjs: Invalid link type ${type}; must be a string`);
    }
    opts = type;
    type = null;
  }
  const options = new Options(opts);
  const tokens = tokenize(str);
  const filtered = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.isLink && (!type || token.t === type) && options.check(token)) {
      filtered.push(token.toFormattedObject(options));
    }
  }
  return filtered;
}

/**
 * Is the given string valid linkable text of some sort. Note that this does not
 * trim the text for you.
 *
 * Optionally pass in a second `type` param, which is the type of link to test
 * for.
 *
 * For example,
 *
 *     linkify.test(str, 'email');
 *
 * Returns `true` if str is a valid email.
 * @param {string} str string to test for links
 * @param {string} [type] optional specific link type to look for
 * @returns boolean true/false
 */
function test(str, type = null) {
  const tokens = tokenize(str);
  return tokens.length === 1 && tokens[0].isLink && (!type || tokens[0].t === type);
}



;// ./node_modules/@tiptap/extension-link/dist/index.js
// src/link.ts



// src/helpers/autolink.ts




// src/helpers/whitespace.ts
var UNICODE_WHITESPACE_PATTERN = "[\0- \xA0\u1680\u180E\u2000-\u2029\u205F\u3000]";
var UNICODE_WHITESPACE_REGEX = new RegExp(UNICODE_WHITESPACE_PATTERN);
var UNICODE_WHITESPACE_REGEX_END = new RegExp(`${UNICODE_WHITESPACE_PATTERN}$`);
var UNICODE_WHITESPACE_REGEX_GLOBAL = new RegExp(UNICODE_WHITESPACE_PATTERN, "g");

// src/helpers/autolink.ts
function isValidLinkStructure(tokens) {
  if (tokens.length === 1) {
    return tokens[0].isLink;
  }
  if (tokens.length === 3 && tokens[1].isLink) {
    return ["()", "[]"].includes(tokens[0].value + tokens[2].value);
  }
  return false;
}
function autolink(options) {
  return new prosemirror_state_dist/* Plugin */.k_({
    key: new prosemirror_state_dist/* PluginKey */.hs("autolink"),
    appendTransaction: (transactions, oldState, newState) => {
      const docChanges = transactions.some((transaction) => transaction.docChanged) && !oldState.doc.eq(newState.doc);
      const preventAutolink = transactions.some((transaction) => transaction.getMeta("preventAutolink"));
      if (!docChanges || preventAutolink) {
        return;
      }
      const { tr } = newState;
      const transform = (0,dist/* combineTransactionSteps */.T7)(oldState.doc, [...transactions]);
      const changes = (0,dist/* getChangedRanges */.FF)(transform);
      changes.forEach(({ newRange }) => {
        const nodesInChangedRanges = (0,dist/* findChildrenInRange */.Nx)(newState.doc, newRange, (node) => node.isTextblock);
        let textBlock;
        let textBeforeWhitespace;
        if (nodesInChangedRanges.length > 1) {
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(
            textBlock.pos,
            textBlock.pos + textBlock.node.nodeSize,
            void 0,
            " "
          );
        } else if (nodesInChangedRanges.length) {
          const endText = newState.doc.textBetween(newRange.from, newRange.to, " ", " ");
          if (!UNICODE_WHITESPACE_REGEX_END.test(endText)) {
            return;
          }
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(textBlock.pos, newRange.to, void 0, " ");
        }
        if (textBlock && textBeforeWhitespace) {
          const wordsBeforeWhitespace = textBeforeWhitespace.split(UNICODE_WHITESPACE_REGEX).filter(Boolean);
          if (wordsBeforeWhitespace.length <= 0) {
            return false;
          }
          const lastWordBeforeSpace = wordsBeforeWhitespace[wordsBeforeWhitespace.length - 1];
          const lastWordAndBlockOffset = textBlock.pos + textBeforeWhitespace.lastIndexOf(lastWordBeforeSpace);
          if (!lastWordBeforeSpace) {
            return false;
          }
          const linksBeforeSpace = tokenize(lastWordBeforeSpace).map((t) => t.toObject(options.defaultProtocol));
          if (!isValidLinkStructure(linksBeforeSpace)) {
            return false;
          }
          linksBeforeSpace.filter((link) => link.isLink).map((link) => ({
            ...link,
            from: lastWordAndBlockOffset + link.start + 1,
            to: lastWordAndBlockOffset + link.end + 1
          })).filter((link) => {
            if (!newState.schema.marks.code) {
              return true;
            }
            return !newState.doc.rangeHasMark(link.from, link.to, newState.schema.marks.code);
          }).filter((link) => options.validate(link.value)).filter((link) => options.shouldAutoLink(link.value)).forEach((link) => {
            if ((0,dist/* getMarksBetween */.hO)(link.from, link.to, newState.doc).some((item) => item.mark.type === options.type)) {
              return;
            }
            tr.addMark(
              link.from,
              link.to,
              options.type.create({
                href: link.href
              })
            );
          });
        }
      });
      if (!tr.steps.length) {
        return;
      }
      return tr;
    }
  });
}

// src/helpers/clickHandler.ts


function clickHandler(options) {
  return new prosemirror_state_dist/* Plugin */.k_({
    key: new prosemirror_state_dist/* PluginKey */.hs("handleClickLink"),
    props: {
      handleClick: (view, pos, event) => {
        var _a, _b;
        if (event.button !== 0) {
          return false;
        }
        if (!view.editable) {
          return false;
        }
        let link = null;
        if (event.target instanceof HTMLAnchorElement) {
          link = event.target;
        } else {
          const target = event.target;
          if (!target) {
            return false;
          }
          const root = options.editor.view.dom;
          link = target.closest("a");
          if (link && !root.contains(link)) {
            link = null;
          }
        }
        if (!link) {
          return false;
        }
        let handled = false;
        if (options.enableClickSelection) {
          const commandResult = options.editor.commands.extendMarkRange(options.type.name);
          handled = commandResult;
        }
        if (options.openOnClick) {
          const attrs = (0,dist/* getAttributes */.gu)(view.state, options.type.name);
          const href = (_a = link.href) != null ? _a : attrs.href;
          const target = (_b = link.target) != null ? _b : attrs.target;
          if (href) {
            window.open(href, target);
            handled = true;
          }
        }
        return handled;
      }
    }
  });
}

// src/helpers/pasteHandler.ts


function pasteHandler(options) {
  return new prosemirror_state_dist/* Plugin */.k_({
    key: new prosemirror_state_dist/* PluginKey */.hs("handlePasteLink"),
    props: {
      handlePaste: (view, _event, slice) => {
        const { shouldAutoLink } = options;
        const { state } = view;
        const { selection } = state;
        const { empty } = selection;
        if (empty) {
          return false;
        }
        let textContent = "";
        slice.content.forEach((node) => {
          textContent += node.textContent;
        });
        const link = find(textContent, { defaultProtocol: options.defaultProtocol }).find(
          (item) => item.isLink && item.value === textContent
        );
        if (!textContent || !link || shouldAutoLink !== void 0 && !shouldAutoLink(link.value)) {
          return false;
        }
        return options.editor.commands.setMark(options.type, {
          href: link.href
        });
      }
    }
  });
}

// src/link.ts
var dist_pasteRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z]{2,}\b(?:[-a-zA-Z0-9@:%._+~#=?!&/]*)(?:[-a-zA-Z0-9@:%._+~#=?!&/]*)/gi;
function isAllowedUri(uri, protocols) {
  const allowedProtocols = ["http", "https", "ftp", "ftps", "mailto", "tel", "callto", "sms", "cid", "xmpp"];
  if (protocols) {
    protocols.forEach((protocol) => {
      const nextProtocol = typeof protocol === "string" ? protocol : protocol.scheme;
      if (nextProtocol) {
        allowedProtocols.push(nextProtocol);
      }
    });
  }
  return !uri || uri.replace(UNICODE_WHITESPACE_REGEX_GLOBAL, "").match(
    new RegExp(
      // eslint-disable-next-line no-useless-escape
      `^(?:(?:${allowedProtocols.join("|")}):|[^a-z]|[a-z0-9+.-]+(?:[^a-z+.-:]|$))`,
      "i"
    )
  );
}
var Link = dist/* Mark */.CU.create({
  name: "link",
  priority: 1e3,
  keepOnSplit: false,
  exitable: true,
  onCreate() {
    if (this.options.validate && !this.options.shouldAutoLink) {
      this.options.shouldAutoLink = this.options.validate;
      console.warn("The `validate` option is deprecated. Rename to the `shouldAutoLink` option instead.");
    }
    this.options.protocols.forEach((protocol) => {
      if (typeof protocol === "string") {
        registerCustomProtocol(protocol);
        return;
      }
      registerCustomProtocol(protocol.scheme, protocol.optionalSlashes);
    });
  },
  onDestroy() {
    linkify_reset();
  },
  inclusive() {
    return this.options.autolink;
  },
  addOptions() {
    return {
      openOnClick: true,
      enableClickSelection: false,
      linkOnPaste: true,
      autolink: true,
      protocols: [],
      defaultProtocol: "http",
      HTMLAttributes: {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        class: null
      },
      isAllowedUri: (url, ctx) => !!isAllowedUri(url, ctx.protocols),
      validate: (url) => !!url,
      shouldAutoLink: (url) => {
        const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
        const hasMaybeProtocol = /^[a-z][a-z0-9+.-]*:/i.test(url);
        if (hasProtocol || hasMaybeProtocol && !url.includes("@")) {
          return true;
        }
        const urlWithoutUserinfo = url.includes("@") ? url.split("@").pop() : url;
        const hostname = urlWithoutUserinfo.split(/[/?#:]/)[0];
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
          return false;
        }
        if (!/\./.test(hostname)) {
          return false;
        }
        return true;
      }
    };
  },
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML(element) {
          return element.getAttribute("href");
        }
      },
      target: {
        default: this.options.HTMLAttributes.target
      },
      rel: {
        default: this.options.HTMLAttributes.rel
      },
      class: {
        default: this.options.HTMLAttributes.class
      },
      title: {
        default: null
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const href = dom.getAttribute("href");
          if (!href || !this.options.isAllowedUri(href, {
            defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
            protocols: this.options.protocols,
            defaultProtocol: this.options.defaultProtocol
          })) {
            return false;
          }
          return null;
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    if (!this.options.isAllowedUri(HTMLAttributes.href, {
      defaultValidate: (href) => !!isAllowedUri(href, this.options.protocols),
      protocols: this.options.protocols,
      defaultProtocol: this.options.defaultProtocol
    })) {
      return ["a", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, { ...HTMLAttributes, href: "" }), 0];
    }
    return ["a", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "link",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("link", helpers.parseInline(token.tokens || []), {
      href: token.href,
      title: token.title || null
    });
  },
  renderMarkdown: (node, h) => {
    var _a, _b, _c, _d;
    const href = (_b = (_a = node.attrs) == null ? void 0 : _a.href) != null ? _b : "";
    const title = (_d = (_c = node.attrs) == null ? void 0 : _c.title) != null ? _d : "";
    const text = h.renderChildren(node);
    return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`;
  },
  addCommands() {
    return {
      setLink: (attributes) => ({ chain }) => {
        const { href } = attributes;
        if (!this.options.isAllowedUri(href, {
          defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
          protocols: this.options.protocols,
          defaultProtocol: this.options.defaultProtocol
        })) {
          return false;
        }
        return chain().setMark(this.name, attributes).setMeta("preventAutolink", true).run();
      },
      toggleLink: (attributes) => ({ chain }) => {
        const { href } = attributes || {};
        if (href && !this.options.isAllowedUri(href, {
          defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
          protocols: this.options.protocols,
          defaultProtocol: this.options.defaultProtocol
        })) {
          return false;
        }
        return chain().toggleMark(this.name, attributes, { extendEmptyMarkRange: true }).setMeta("preventAutolink", true).run();
      },
      unsetLink: () => ({ chain }) => {
        return chain().unsetMark(this.name, { extendEmptyMarkRange: true }).setMeta("preventAutolink", true).run();
      }
    };
  },
  addPasteRules() {
    return [
      (0,dist/* markPasteRule */.Zc)({
        find: (text) => {
          const foundLinks = [];
          if (text) {
            const { protocols, defaultProtocol } = this.options;
            const links = find(text).filter(
              (item) => item.isLink && this.options.isAllowedUri(item.value, {
                defaultValidate: (href) => !!isAllowedUri(href, protocols),
                protocols,
                defaultProtocol
              })
            );
            if (links.length) {
              links.forEach((link) => {
                if (!this.options.shouldAutoLink(link.value)) {
                  return;
                }
                foundLinks.push({
                  text: link.value,
                  data: {
                    href: link.href
                  },
                  index: link.start
                });
              });
            }
          }
          return foundLinks;
        },
        type: this.type,
        getAttributes: (match) => {
          var _a;
          return {
            href: (_a = match.data) == null ? void 0 : _a.href
          };
        }
      })
    ];
  },
  addProseMirrorPlugins() {
    const plugins = [];
    const { protocols, defaultProtocol } = this.options;
    if (this.options.autolink) {
      plugins.push(
        autolink({
          type: this.type,
          defaultProtocol: this.options.defaultProtocol,
          validate: (url) => this.options.isAllowedUri(url, {
            defaultValidate: (href) => !!isAllowedUri(href, protocols),
            protocols,
            defaultProtocol
          }),
          shouldAutoLink: this.options.shouldAutoLink
        })
      );
    }
    plugins.push(
      clickHandler({
        type: this.type,
        editor: this.editor,
        openOnClick: this.options.openOnClick === "whenNotEditable" ? true : this.options.openOnClick,
        enableClickSelection: this.options.enableClickSelection
      })
    );
    if (this.options.linkOnPaste) {
      plugins.push(
        pasteHandler({
          editor: this.editor,
          defaultProtocol: this.options.defaultProtocol,
          type: this.type,
          shouldAutoLink: this.options.shouldAutoLink
        })
      );
    }
    return plugins;
  }
});

// src/index.ts
var extension_link_dist_index_default = (/* unused pure expression or super */ null && (Link));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-list/dist/index.js
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/bullet-list/bullet-list.ts

var ListItemName = "listItem";
var TextStyleName = "textStyle";
var bulletListInputRegex = /^\s*([-+*])\s$/;
var BulletList = dist/* Node */.bP.create({
  name: "bulletList",
  addOptions() {
    return {
      itemTypeName: "listItem",
      HTMLAttributes: {},
      keepMarks: false,
      keepAttributes: false
    };
  },
  group: "block list",
  content() {
    return `${this.options.itemTypeName}+`;
  },
  parseHTML() {
    return [{ tag: "ul" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ul", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "list",
  parseMarkdown: (token, helpers) => {
    if (token.type !== "list" || token.ordered) {
      return [];
    }
    return {
      type: "bulletList",
      content: token.items ? helpers.parseChildren(token.items) : []
    };
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n");
  },
  markdownOptions: {
    indentsContent: true
  },
  addCommands() {
    return {
      toggleBulletList: () => ({ commands, chain }) => {
        if (this.options.keepAttributes) {
          return chain().toggleList(this.name, this.options.itemTypeName, this.options.keepMarks).updateAttributes(ListItemName, this.editor.getAttributes(TextStyleName)).run();
        }
        return commands.toggleList(this.name, this.options.itemTypeName, this.options.keepMarks);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-8": () => this.editor.commands.toggleBulletList()
    };
  },
  addInputRules() {
    let inputRule = (0,dist/* wrappingInputRule */.tG)({
      find: bulletListInputRegex,
      type: this.type
    });
    if (this.options.keepMarks || this.options.keepAttributes) {
      inputRule = (0,dist/* wrappingInputRule */.tG)({
        find: bulletListInputRegex,
        type: this.type,
        keepMarks: this.options.keepMarks,
        keepAttributes: this.options.keepAttributes,
        getAttributes: () => {
          return this.editor.getAttributes(TextStyleName);
        },
        editor: this.editor
      });
    }
    return [inputRule];
  }
});

// src/item/list-item.ts

var ListItem = dist/* Node */.bP.create({
  name: "listItem",
  addOptions() {
    return {
      HTMLAttributes: {},
      bulletListTypeName: "bulletList",
      orderedListTypeName: "orderedList"
    };
  },
  content: "paragraph block*",
  defining: true,
  parseHTML() {
    return [
      {
        tag: "li"
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["li", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "list_item",
  parseMarkdown: (token, helpers) => {
    var _a;
    if (token.type !== "list_item") {
      return [];
    }
    const parseBlockChildren = (_a = helpers.parseBlockChildren) != null ? _a : helpers.parseChildren;
    let content = [];
    if (token.tokens && token.tokens.length > 0) {
      const hasParagraphTokens = token.tokens.some((t) => t.type === "paragraph");
      if (hasParagraphTokens) {
        content = parseBlockChildren(token.tokens);
      } else {
        const firstToken = token.tokens[0];
        if (firstToken && firstToken.type === "text" && firstToken.tokens && firstToken.tokens.length > 0) {
          const inlineContent = helpers.parseInline(firstToken.tokens);
          content = [
            {
              type: "paragraph",
              content: inlineContent
            }
          ];
          if (token.tokens.length > 1) {
            const remainingTokens = token.tokens.slice(1);
            const additionalContent = parseBlockChildren(remainingTokens);
            content.push(...additionalContent);
          }
        } else {
          content = parseBlockChildren(token.tokens);
        }
      }
    }
    if (content.length === 0) {
      content = [
        {
          type: "paragraph",
          content: []
        }
      ];
    }
    return {
      type: "listItem",
      content
    };
  },
  renderMarkdown: (node, h, ctx) => {
    return (0,dist/* renderNestedMarkdownContent */.kj)(
      node,
      h,
      (context) => {
        var _a, _b;
        if (context.parentType === "bulletList") {
          return "- ";
        }
        if (context.parentType === "orderedList") {
          const start = ((_b = (_a = context.meta) == null ? void 0 : _a.parentAttrs) == null ? void 0 : _b.start) || 1;
          return `${start + context.index}. `;
        }
        return "- ";
      },
      ctx
    );
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name)
    };
  }
});

// src/keymap/list-keymap.ts


// src/keymap/listHelpers/index.ts
var listHelpers_exports = {};
__export(listHelpers_exports, {
  findListItemPos: () => findListItemPos,
  getNextListDepth: () => getNextListDepth,
  handleBackspace: () => handleBackspace,
  handleDelete: () => handleDelete,
  hasListBefore: () => hasListBefore,
  hasListItemAfter: () => hasListItemAfter,
  hasListItemBefore: () => hasListItemBefore,
  listItemHasSubList: () => listItemHasSubList,
  nextListIsDeeper: () => nextListIsDeeper,
  nextListIsHigher: () => nextListIsHigher
});

// src/keymap/listHelpers/findListItemPos.ts

var findListItemPos = (typeOrName, state) => {
  const { $from } = state.selection;
  const nodeType = (0,dist/* getNodeType */.Pg)(typeOrName, state.schema);
  let currentNode = null;
  let currentDepth = $from.depth;
  let currentPos = $from.pos;
  let targetDepth = null;
  while (currentDepth > 0 && targetDepth === null) {
    currentNode = $from.node(currentDepth);
    if (currentNode.type === nodeType) {
      targetDepth = currentDepth;
    } else {
      currentDepth -= 1;
      currentPos -= 1;
    }
  }
  if (targetDepth === null) {
    return null;
  }
  return { $pos: state.doc.resolve(currentPos), depth: targetDepth };
};

// src/keymap/listHelpers/getNextListDepth.ts

var getNextListDepth = (typeOrName, state) => {
  const listItemPos = findListItemPos(typeOrName, state);
  if (!listItemPos) {
    return false;
  }
  const [, depth] = (0,dist/* getNodeAtPosition */.fl)(state, typeOrName, listItemPos.$pos.pos + 4);
  return depth;
};

// src/keymap/listHelpers/handleBackspace.ts


// src/keymap/listHelpers/hasListBefore.ts
var hasListBefore = (editorState, name, parentListTypes) => {
  const { $anchor } = editorState.selection;
  const previousNodePos = Math.max(0, $anchor.pos - 2);
  const previousNode = editorState.doc.resolve(previousNodePos).node();
  if (!previousNode || !parentListTypes.includes(previousNode.type.name)) {
    return false;
  }
  return true;
};

// src/keymap/listHelpers/hasListItemBefore.ts
var hasListItemBefore = (typeOrName, state) => {
  var _a;
  const { $anchor } = state.selection;
  const $targetPos = state.doc.resolve($anchor.pos - 2);
  if ($targetPos.index() === 0) {
    return false;
  }
  if (((_a = $targetPos.nodeBefore) == null ? void 0 : _a.type.name) !== typeOrName) {
    return false;
  }
  return true;
};

// src/keymap/listHelpers/listItemHasSubList.ts

var listItemHasSubList = (typeOrName, state, node) => {
  if (!node) {
    return false;
  }
  const nodeType = (0,dist/* getNodeType */.Pg)(typeOrName, state.schema);
  let hasSubList = false;
  node.descendants((child) => {
    if (child.type === nodeType) {
      hasSubList = true;
    }
  });
  return hasSubList;
};

// src/keymap/listHelpers/handleBackspace.ts
var handleBackspace = (editor, name, parentListTypes) => {
  if (editor.commands.undoInputRule()) {
    return true;
  }
  if (editor.state.selection.from !== editor.state.selection.to) {
    return false;
  }
  if (!(0,dist/* isNodeActive */.rU)(editor.state, name) && hasListBefore(editor.state, name, parentListTypes)) {
    const { $anchor } = editor.state.selection;
    const $listPos = editor.state.doc.resolve($anchor.before() - 1);
    const listDescendants = [];
    $listPos.node().descendants((node, pos) => {
      if (node.type.name === name) {
        listDescendants.push({ node, pos });
      }
    });
    const lastItem = listDescendants.at(-1);
    if (!lastItem) {
      return false;
    }
    const $lastItemPos = editor.state.doc.resolve($listPos.start() + lastItem.pos + 1);
    return editor.chain().cut({ from: $anchor.start() - 1, to: $anchor.end() + 1 }, $lastItemPos.end()).joinForward().run();
  }
  if (!(0,dist/* isNodeActive */.rU)(editor.state, name)) {
    return false;
  }
  if (!(0,dist/* isAtStartOfNode */.J_)(editor.state)) {
    return false;
  }
  const listItemPos = findListItemPos(name, editor.state);
  if (!listItemPos) {
    return false;
  }
  const $prev = editor.state.doc.resolve(listItemPos.$pos.pos - 2);
  const prevNode = $prev.node(listItemPos.depth);
  const previousListItemHasSubList = listItemHasSubList(name, editor.state, prevNode);
  if (hasListItemBefore(name, editor.state) && !previousListItemHasSubList) {
    return editor.commands.joinItemBackward();
  }
  return editor.chain().liftListItem(name).run();
};

// src/keymap/listHelpers/handleDelete.ts


// src/keymap/listHelpers/nextListIsDeeper.ts
var nextListIsDeeper = (typeOrName, state) => {
  const listDepth = getNextListDepth(typeOrName, state);
  const listItemPos = findListItemPos(typeOrName, state);
  if (!listItemPos || !listDepth) {
    return false;
  }
  if (listDepth > listItemPos.depth) {
    return true;
  }
  return false;
};

// src/keymap/listHelpers/nextListIsHigher.ts
var nextListIsHigher = (typeOrName, state) => {
  const listDepth = getNextListDepth(typeOrName, state);
  const listItemPos = findListItemPos(typeOrName, state);
  if (!listItemPos || !listDepth) {
    return false;
  }
  if (listDepth < listItemPos.depth) {
    return true;
  }
  return false;
};

// src/keymap/listHelpers/handleDelete.ts
var handleDelete = (editor, name) => {
  if (!(0,dist/* isNodeActive */.rU)(editor.state, name)) {
    return false;
  }
  if (!(0,dist/* isAtEndOfNode */.QN)(editor.state, name)) {
    return false;
  }
  const { selection } = editor.state;
  const { $from, $to } = selection;
  if (!selection.empty && $from.sameParent($to)) {
    return false;
  }
  if (nextListIsDeeper(name, editor.state)) {
    return editor.chain().focus(editor.state.selection.from + 4).lift(name).joinBackward().run();
  }
  if (nextListIsHigher(name, editor.state)) {
    return editor.chain().joinForward().joinBackward().run();
  }
  return editor.commands.joinItemForward();
};

// src/keymap/listHelpers/hasListItemAfter.ts
var hasListItemAfter = (typeOrName, state) => {
  var _a;
  const { $anchor } = state.selection;
  const $targetPos = state.doc.resolve($anchor.pos - $anchor.parentOffset - 2);
  if ($targetPos.index() === $targetPos.parent.childCount - 1) {
    return false;
  }
  if (((_a = $targetPos.nodeAfter) == null ? void 0 : _a.type.name) !== typeOrName) {
    return false;
  }
  return true;
};

// src/keymap/list-keymap.ts
var ListKeymap = dist/* Extension */.YY.create({
  name: "listKeymap",
  addOptions() {
    return {
      listTypes: [
        {
          itemName: "listItem",
          wrapperNames: ["bulletList", "orderedList"]
        },
        {
          itemName: "taskItem",
          wrapperNames: ["taskList"]
        }
      ]
    };
  },
  addKeyboardShortcuts() {
    return {
      Delete: ({ editor }) => {
        let handled = false;
        this.options.listTypes.forEach(({ itemName }) => {
          if (editor.state.schema.nodes[itemName] === void 0) {
            return;
          }
          if (handleDelete(editor, itemName)) {
            handled = true;
          }
        });
        return handled;
      },
      "Mod-Delete": ({ editor }) => {
        let handled = false;
        this.options.listTypes.forEach(({ itemName }) => {
          if (editor.state.schema.nodes[itemName] === void 0) {
            return;
          }
          if (handleDelete(editor, itemName)) {
            handled = true;
          }
        });
        return handled;
      },
      Backspace: ({ editor }) => {
        let handled = false;
        this.options.listTypes.forEach(({ itemName, wrapperNames }) => {
          if (editor.state.schema.nodes[itemName] === void 0) {
            return;
          }
          if (handleBackspace(editor, itemName, wrapperNames)) {
            handled = true;
          }
        });
        return handled;
      },
      "Mod-Backspace": ({ editor }) => {
        let handled = false;
        this.options.listTypes.forEach(({ itemName, wrapperNames }) => {
          if (editor.state.schema.nodes[itemName] === void 0) {
            return;
          }
          if (handleBackspace(editor, itemName, wrapperNames)) {
            handled = true;
          }
        });
        return handled;
      }
    };
  }
});

// src/kit/index.ts


// src/ordered-list/ordered-list.ts


// src/ordered-list/utils.ts
var ORDERED_LIST_ITEM_REGEX = /^(\s*)(\d+)\.\s+(.*)$/;
var INDENTED_LINE_REGEX = /^\s/;
function isBlockContentLine(line) {
  const trimmedLine = line.trimStart();
  return /^[-+*]\s+/.test(trimmedLine) || /^\d+\.\s+/.test(trimmedLine) || /^>\s?/.test(trimmedLine) || /^```/.test(trimmedLine) || /^~~~/.test(trimmedLine);
}
function splitItemContent(contentLines) {
  const paragraphLines = [];
  const blockLines = [];
  let reachedBlockBoundary = false;
  contentLines.forEach((line) => {
    if (reachedBlockBoundary) {
      blockLines.push(line);
      return;
    }
    if (line.trim() === "") {
      reachedBlockBoundary = true;
      blockLines.push(line);
      return;
    }
    if (paragraphLines.length > 0 && isBlockContentLine(line)) {
      reachedBlockBoundary = true;
      blockLines.push(line);
      return;
    }
    paragraphLines.push(line);
  });
  return {
    paragraphLines,
    blockLines
  };
}
function collectOrderedListItems(lines) {
  const listItems = [];
  let currentLineIndex = 0;
  let consumed = 0;
  while (currentLineIndex < lines.length) {
    const line = lines[currentLineIndex];
    const match = line.match(ORDERED_LIST_ITEM_REGEX);
    if (!match) {
      break;
    }
    const [, indent, number, content] = match;
    const indentLevel = indent.length;
    const itemContentLines = [content];
    let nextLineIndex = currentLineIndex + 1;
    const itemLines = [line];
    let sawBlankLine = false;
    while (nextLineIndex < lines.length) {
      const nextLine = lines[nextLineIndex];
      const nextMatch = nextLine.match(ORDERED_LIST_ITEM_REGEX);
      if (nextMatch) {
        break;
      }
      if (nextLine.trim() === "") {
        itemLines.push(nextLine);
        itemContentLines.push("");
        sawBlankLine = true;
        nextLineIndex += 1;
      } else if (nextLine.match(INDENTED_LINE_REGEX)) {
        itemLines.push(nextLine);
        itemContentLines.push(nextLine.slice(indentLevel + 2));
        nextLineIndex += 1;
      } else {
        if (sawBlankLine) {
          break;
        }
        itemLines.push(nextLine);
        itemContentLines.push(nextLine);
        nextLineIndex += 1;
      }
    }
    listItems.push({
      indent: indentLevel,
      number: parseInt(number, 10),
      content: itemContentLines.join("\n").trim(),
      contentLines: itemContentLines,
      raw: itemLines.join("\n")
    });
    consumed = nextLineIndex;
    currentLineIndex = nextLineIndex;
  }
  return [listItems, consumed];
}
function buildNestedStructure(items, baseIndent, lexer) {
  const result = [];
  let currentIndex = 0;
  while (currentIndex < items.length) {
    const item = items[currentIndex];
    if (item.indent === baseIndent) {
      const { paragraphLines, blockLines } = splitItemContent(item.contentLines);
      const mainText = paragraphLines.join("\n").trim();
      const tokens = [];
      if (mainText) {
        tokens.push({
          type: "paragraph",
          raw: mainText,
          tokens: lexer.inlineTokens(mainText)
        });
      }
      const additionalContent = blockLines.join("\n").trim();
      if (additionalContent) {
        const blockTokens = lexer.blockTokens(additionalContent);
        tokens.push(...blockTokens);
      }
      let lookAheadIndex = currentIndex + 1;
      const nestedItems = [];
      while (lookAheadIndex < items.length && items[lookAheadIndex].indent > baseIndent) {
        nestedItems.push(items[lookAheadIndex]);
        lookAheadIndex += 1;
      }
      if (nestedItems.length > 0) {
        const nextIndent = Math.min(...nestedItems.map((nestedItem) => nestedItem.indent));
        const nestedListItems = buildNestedStructure(nestedItems, nextIndent, lexer);
        tokens.push({
          type: "list",
          ordered: true,
          start: nestedItems[0].number,
          items: nestedListItems,
          raw: nestedItems.map((nestedItem) => nestedItem.raw).join("\n")
        });
      }
      result.push({
        type: "list_item",
        raw: item.raw,
        tokens
      });
      currentIndex = lookAheadIndex;
    } else {
      currentIndex += 1;
    }
  }
  return result;
}
function parseListItems(items, helpers) {
  return items.map((item) => {
    if (item.type !== "list_item") {
      return helpers.parseChildren([item])[0];
    }
    const content = [];
    if (item.tokens && item.tokens.length > 0) {
      item.tokens.forEach((itemToken) => {
        if (itemToken.type === "paragraph" || itemToken.type === "list" || itemToken.type === "blockquote" || itemToken.type === "code") {
          content.push(...helpers.parseChildren([itemToken]));
        } else if (itemToken.type === "text" && itemToken.tokens) {
          const inlineContent = helpers.parseChildren([itemToken]);
          content.push({
            type: "paragraph",
            content: inlineContent
          });
        } else {
          const parsed = helpers.parseChildren([itemToken]);
          if (parsed.length > 0) {
            content.push(...parsed);
          }
        }
      });
    }
    return {
      type: "listItem",
      content
    };
  });
}

// src/ordered-list/ordered-list.ts
var ListItemName2 = "listItem";
var TextStyleName2 = "textStyle";
var orderedListInputRegex = /^(\d+)\.\s$/;
var OrderedList = dist/* Node */.bP.create({
  name: "orderedList",
  addOptions() {
    return {
      itemTypeName: "listItem",
      HTMLAttributes: {},
      keepMarks: false,
      keepAttributes: false
    };
  },
  group: "block list",
  content() {
    return `${this.options.itemTypeName}+`;
  },
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element) => {
          return element.hasAttribute("start") ? parseInt(element.getAttribute("start") || "", 10) : 1;
        }
      },
      type: {
        default: null,
        parseHTML: (element) => element.getAttribute("type")
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "ol"
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const { start, ...attributesWithoutStart } = HTMLAttributes;
    return start === 1 ? ["ol", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, attributesWithoutStart), 0] : ["ol", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "list",
  parseMarkdown: (token, helpers) => {
    if (token.type !== "list" || !token.ordered) {
      return [];
    }
    const startValue = token.start || 1;
    const content = token.items ? parseListItems(token.items, helpers) : [];
    if (startValue !== 1) {
      return {
        type: "orderedList",
        attrs: { start: startValue },
        content
      };
    }
    return {
      type: "orderedList",
      content
    };
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n");
  },
  markdownTokenizer: {
    name: "orderedList",
    level: "block",
    start: (src) => {
      const match = src.match(/^(\s*)(\d+)\.\s+/);
      const index = match == null ? void 0 : match.index;
      return index !== void 0 ? index : -1;
    },
    tokenize: (src, _tokens, lexer) => {
      var _a;
      const lines = src.split("\n");
      const [listItems, consumed] = collectOrderedListItems(lines);
      if (listItems.length === 0) {
        return void 0;
      }
      const items = buildNestedStructure(listItems, 0, lexer);
      if (items.length === 0) {
        return void 0;
      }
      const startValue = ((_a = listItems[0]) == null ? void 0 : _a.number) || 1;
      return {
        type: "list",
        ordered: true,
        start: startValue,
        items,
        raw: lines.slice(0, consumed).join("\n")
      };
    }
  },
  markdownOptions: {
    indentsContent: true
  },
  addCommands() {
    return {
      toggleOrderedList: () => ({ commands, chain }) => {
        if (this.options.keepAttributes) {
          return chain().toggleList(this.name, this.options.itemTypeName, this.options.keepMarks).updateAttributes(ListItemName2, this.editor.getAttributes(TextStyleName2)).run();
        }
        return commands.toggleList(this.name, this.options.itemTypeName, this.options.keepMarks);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList()
    };
  },
  addInputRules() {
    let inputRule = (0,dist/* wrappingInputRule */.tG)({
      find: orderedListInputRegex,
      type: this.type,
      getAttributes: (match) => ({ start: +match[1] }),
      joinPredicate: (match, node) => node.childCount + node.attrs.start === +match[1]
    });
    if (this.options.keepMarks || this.options.keepAttributes) {
      inputRule = (0,dist/* wrappingInputRule */.tG)({
        find: orderedListInputRegex,
        type: this.type,
        keepMarks: this.options.keepMarks,
        keepAttributes: this.options.keepAttributes,
        getAttributes: (match) => ({ start: +match[1], ...this.editor.getAttributes(TextStyleName2) }),
        joinPredicate: (match, node) => node.childCount + node.attrs.start === +match[1],
        editor: this.editor
      });
    }
    return [inputRule];
  }
});

// src/task-item/task-item.ts

var extension_list_dist_inputRegex = /^\s*(\[([( |x])?\])\s$/;
var TaskItem = dist/* Node */.bP.create({
  name: "taskItem",
  addOptions() {
    return {
      nested: false,
      HTMLAttributes: {},
      taskListTypeName: "taskList",
      a11y: void 0
    };
  },
  content() {
    return this.options.nested ? "paragraph block*" : "paragraph+";
  },
  defining: true,
  addAttributes() {
    return {
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (element) => {
          const dataChecked = element.getAttribute("data-checked");
          return dataChecked === "" || dataChecked === "true";
        },
        renderHTML: (attributes) => ({
          "data-checked": attributes.checked
        })
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: `li[data-type="${this.name}"]`,
        priority: 51
      }
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "li",
      (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": this.name
      }),
      [
        "label",
        [
          "input",
          {
            type: "checkbox",
            checked: node.attrs.checked ? "checked" : null
          }
        ],
        ["span"]
      ],
      ["div", 0]
    ];
  },
  parseMarkdown: (token, h) => {
    const content = [];
    if (token.tokens && token.tokens.length > 0) {
      content.push(h.createNode("paragraph", {}, h.parseInline(token.tokens)));
    } else if (token.text) {
      content.push(h.createNode("paragraph", {}, [h.createNode("text", { text: token.text })]));
    } else {
      content.push(h.createNode("paragraph", {}, []));
    }
    if (token.nestedTokens && token.nestedTokens.length > 0) {
      const nestedContent = h.parseChildren(token.nestedTokens);
      content.push(...nestedContent);
    }
    return h.createNode("taskItem", { checked: token.checked || false }, content);
  },
  renderMarkdown: (node, h) => {
    var _a;
    const checkedChar = ((_a = node.attrs) == null ? void 0 : _a.checked) ? "x" : " ";
    const prefix = `- [${checkedChar}] `;
    return (0,dist/* renderNestedMarkdownContent */.kj)(node, h, prefix);
  },
  addKeyboardShortcuts() {
    const shortcuts = {
      Enter: () => this.editor.commands.splitListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name)
    };
    if (!this.options.nested) {
      return shortcuts;
    }
    return {
      ...shortcuts,
      Tab: () => this.editor.commands.sinkListItem(this.name)
    };
  },
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const listItem = document.createElement("li");
      const checkboxWrapper = document.createElement("label");
      const checkboxStyler = document.createElement("span");
      const checkbox = document.createElement("input");
      const content = document.createElement("div");
      const updateA11Y = (currentNode) => {
        var _a, _b;
        checkbox.ariaLabel = ((_b = (_a = this.options.a11y) == null ? void 0 : _a.checkboxLabel) == null ? void 0 : _b.call(_a, currentNode, checkbox.checked)) || `Task item checkbox for ${currentNode.textContent || "empty task item"}`;
      };
      updateA11Y(node);
      checkboxWrapper.contentEditable = "false";
      checkbox.type = "checkbox";
      checkbox.addEventListener("mousedown", (event) => event.preventDefault());
      checkbox.addEventListener("change", (event) => {
        if (!editor.isEditable && !this.options.onReadOnlyChecked) {
          checkbox.checked = !checkbox.checked;
          return;
        }
        const { checked } = event.target;
        if (editor.isEditable && typeof getPos === "function") {
          editor.chain().focus(void 0, { scrollIntoView: false }).command(({ tr }) => {
            const position = getPos();
            if (typeof position !== "number") {
              return false;
            }
            const currentNode = tr.doc.nodeAt(position);
            tr.setNodeMarkup(position, void 0, {
              ...currentNode == null ? void 0 : currentNode.attrs,
              checked
            });
            return true;
          }).run();
        }
        if (!editor.isEditable && this.options.onReadOnlyChecked) {
          if (!this.options.onReadOnlyChecked(node, checked)) {
            checkbox.checked = !checkbox.checked;
          }
        }
      });
      Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value);
      });
      listItem.dataset.checked = node.attrs.checked;
      checkbox.checked = node.attrs.checked;
      checkboxWrapper.append(checkbox, checkboxStyler);
      listItem.append(checkboxWrapper, content);
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value);
      });
      let prevRenderedAttributeKeys = new Set(Object.keys(HTMLAttributes));
      return {
        dom: listItem,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) {
            return false;
          }
          listItem.dataset.checked = updatedNode.attrs.checked;
          checkbox.checked = updatedNode.attrs.checked;
          updateA11Y(updatedNode);
          const extensionAttributes = editor.extensionManager.attributes;
          const newHTMLAttributes = (0,dist/* getRenderedAttributes */.zU)(updatedNode, extensionAttributes);
          const newKeys = new Set(Object.keys(newHTMLAttributes));
          const staticAttrs = this.options.HTMLAttributes;
          prevRenderedAttributeKeys.forEach((key) => {
            if (!newKeys.has(key)) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key]);
              } else {
                listItem.removeAttribute(key);
              }
            }
          });
          Object.entries(newHTMLAttributes).forEach(([key, value]) => {
            if (value === null || value === void 0) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key]);
              } else {
                listItem.removeAttribute(key);
              }
            } else {
              listItem.setAttribute(key, value);
            }
          });
          prevRenderedAttributeKeys = newKeys;
          return true;
        }
      };
    };
  },
  addInputRules() {
    return [
      (0,dist/* wrappingInputRule */.tG)({
        find: extension_list_dist_inputRegex,
        type: this.type,
        getAttributes: (match) => ({
          checked: match[match.length - 1] === "x"
        })
      })
    ];
  }
});

// src/task-list/task-list.ts

var TaskList = dist/* Node */.bP.create({
  name: "taskList",
  addOptions() {
    return {
      itemTypeName: "taskItem",
      HTMLAttributes: {}
    };
  },
  group: "block list",
  content() {
    return `${this.options.itemTypeName}+`;
  },
  parseHTML() {
    return [
      {
        tag: `ul[data-type="${this.name}"]`,
        priority: 51
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ul", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes, { "data-type": this.name }), 0];
  },
  parseMarkdown: (token, h) => {
    return h.createNode("taskList", {}, h.parseChildren(token.items || []));
  },
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n");
  },
  markdownTokenizer: {
    name: "taskList",
    level: "block",
    start(src) {
      var _a;
      const index = (_a = src.match(/^\s*[-+*]\s+\[([ xX])\]\s+/)) == null ? void 0 : _a.index;
      return index !== void 0 ? index : -1;
    },
    tokenize(src, tokens, lexer) {
      const parseTaskListContent = (content) => {
        const nestedResult = (0,dist/* parseIndentedBlocks */.Dd)(
          content,
          {
            itemPattern: /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/,
            extractItemData: (match) => ({
              indentLevel: match[1].length,
              mainContent: match[4],
              checked: match[3].toLowerCase() === "x"
            }),
            createToken: (data, nestedTokens) => ({
              type: "taskItem",
              raw: "",
              mainContent: data.mainContent,
              indentLevel: data.indentLevel,
              checked: data.checked,
              text: data.mainContent,
              tokens: lexer.inlineTokens(data.mainContent),
              nestedTokens
            }),
            // Allow recursive nesting
            customNestedParser: parseTaskListContent
          },
          lexer
        );
        if (nestedResult) {
          return [
            {
              type: "taskList",
              raw: nestedResult.raw,
              items: nestedResult.items
            }
          ];
        }
        return lexer.blockTokens(content);
      };
      const result = (0,dist/* parseIndentedBlocks */.Dd)(
        src,
        {
          itemPattern: /^(\s*)([-+*])\s+\[([ xX])\]\s+(.*)$/,
          extractItemData: (match) => ({
            indentLevel: match[1].length,
            mainContent: match[4],
            checked: match[3].toLowerCase() === "x"
          }),
          createToken: (data, nestedTokens) => ({
            type: "taskItem",
            raw: "",
            mainContent: data.mainContent,
            indentLevel: data.indentLevel,
            checked: data.checked,
            text: data.mainContent,
            tokens: lexer.inlineTokens(data.mainContent),
            nestedTokens
          }),
          // Use the recursive parser for nested content
          customNestedParser: parseTaskListContent
        },
        lexer
      );
      if (!result) {
        return void 0;
      }
      return {
        type: "taskList",
        raw: result.raw,
        items: result.items
      };
    }
  },
  markdownOptions: {
    indentsContent: true
  },
  addCommands() {
    return {
      toggleTaskList: () => ({ commands }) => {
        return commands.toggleList(this.name, this.options.itemTypeName);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList()
    };
  }
});

// src/kit/index.ts
var ListKit = dist/* Extension */.YY.create({
  name: "listKit",
  addExtensions() {
    const extensions = [];
    if (this.options.bulletList !== false) {
      extensions.push(BulletList.configure(this.options.bulletList));
    }
    if (this.options.listItem !== false) {
      extensions.push(ListItem.configure(this.options.listItem));
    }
    if (this.options.listKeymap !== false) {
      extensions.push(ListKeymap.configure(this.options.listKeymap));
    }
    if (this.options.orderedList !== false) {
      extensions.push(OrderedList.configure(this.options.orderedList));
    }
    if (this.options.taskItem !== false) {
      extensions.push(TaskItem.configure(this.options.taskItem));
    }
    if (this.options.taskList !== false) {
      extensions.push(TaskList.configure(this.options.taskList));
    }
    return extensions;
  }
});

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-paragraph/dist/index.js
// src/paragraph.ts

var EMPTY_PARAGRAPH_MARKDOWN = "&nbsp;";
var NBSP_CHAR = "\xA0";
var Paragraph = dist/* Node */.bP.create({
  name: "paragraph",
  priority: 1e3,
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  group: "block",
  content: "inline*",
  parseHTML() {
    return [{ tag: "p" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  parseMarkdown: (token, helpers) => {
    const tokens = token.tokens || [];
    if (tokens.length === 1 && tokens[0].type === "image") {
      return helpers.parseChildren([tokens[0]]);
    }
    const content = helpers.parseInline(tokens);
    const hasExplicitEmptyParagraphMarker = tokens.length === 1 && tokens[0].type === "text" && (tokens[0].raw === EMPTY_PARAGRAPH_MARKDOWN || tokens[0].text === EMPTY_PARAGRAPH_MARKDOWN || tokens[0].raw === NBSP_CHAR || tokens[0].text === NBSP_CHAR);
    if (hasExplicitEmptyParagraphMarker && content.length === 1 && content[0].type === "text" && (content[0].text === EMPTY_PARAGRAPH_MARKDOWN || content[0].text === NBSP_CHAR)) {
      return helpers.createNode("paragraph", void 0, []);
    }
    return helpers.createNode("paragraph", void 0, content);
  },
  renderMarkdown: (node, h, ctx) => {
    var _a, _b;
    if (!node) {
      return "";
    }
    const content = Array.isArray(node.content) ? node.content : [];
    if (content.length === 0) {
      const previousContent = Array.isArray((_a = ctx == null ? void 0 : ctx.previousNode) == null ? void 0 : _a.content) ? ctx.previousNode.content : [];
      const previousNodeIsEmptyParagraph = ((_b = ctx == null ? void 0 : ctx.previousNode) == null ? void 0 : _b.type) === "paragraph" && previousContent.length === 0;
      return previousNodeIsEmptyParagraph ? EMPTY_PARAGRAPH_MARKDOWN : "";
    }
    return h.renderChildren(content);
  },
  addCommands() {
    return {
      setParagraph: () => ({ commands }) => {
        return commands.setNode(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-0": () => this.editor.commands.setParagraph()
    };
  }
});

// src/index.ts
var extension_paragraph_dist_index_default = (/* unused pure expression or super */ null && (Paragraph));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-strike/dist/index.js
// src/strike.ts

var extension_strike_dist_inputRegex = /(?:^|\s)(~~(?!\s+~~)((?:[^~]+))~~(?!\s+~~))$/;
var extension_strike_dist_pasteRegex = /(?:^|\s)(~~(?!\s+~~)((?:[^~]+))~~(?!\s+~~))/g;
var Strike = dist/* Mark */.CU.create({
  name: "strike",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  parseHTML() {
    return [
      {
        tag: "s"
      },
      {
        tag: "del"
      },
      {
        tag: "strike"
      },
      {
        style: "text-decoration",
        consuming: false,
        getAttrs: (style) => style.includes("line-through") ? {} : false
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["s", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "del",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("strike", helpers.parseInline(token.tokens || []));
  },
  renderMarkdown: (node, h) => {
    return `~~${h.renderChildren(node)}~~`;
  },
  addCommands() {
    return {
      setStrike: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleStrike: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetStrike: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-s": () => this.editor.commands.toggleStrike()
    };
  },
  addInputRules() {
    return [
      (0,dist/* markInputRule */.OX)({
        find: extension_strike_dist_inputRegex,
        type: this.type
      })
    ];
  },
  addPasteRules() {
    return [
      (0,dist/* markPasteRule */.Zc)({
        find: extension_strike_dist_pasteRegex,
        type: this.type
      })
    ];
  }
});

// src/index.ts
var extension_strike_dist_index_default = (/* unused pure expression or super */ null && (Strike));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-text/dist/index.js
// src/text.ts

var dist_Text = dist/* Node */.bP.create({
  name: "text",
  group: "inline",
  parseMarkdown: (token) => {
    return {
      type: "text",
      text: token.text || ""
    };
  },
  renderMarkdown: (node) => node.text || ""
});

// src/index.ts
var extension_text_dist_index_default = (/* unused pure expression or super */ null && (dist_Text));

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-underline/dist/index.js
// src/underline.ts

var Underline = dist/* Mark */.CU.create({
  name: "underline",
  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },
  parseHTML() {
    return [
      {
        tag: "u"
      },
      {
        style: "text-decoration",
        consuming: false,
        getAttrs: (style) => style.includes("underline") ? {} : false
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", (0,dist/* mergeAttributes */.KV)(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  parseMarkdown(token, helpers) {
    return helpers.applyMark(this.name || "underline", helpers.parseInline(token.tokens || []));
  },
  renderMarkdown(node, helpers) {
    return `++${helpers.renderChildren(node)}++`;
  },
  markdownTokenizer: {
    name: "underline",
    level: "inline",
    start(src) {
      return src.indexOf("++");
    },
    tokenize(src, _tokens, lexer) {
      const rule = /^(\+\+)([\s\S]+?)(\+\+)/;
      const match = rule.exec(src);
      if (!match) {
        return void 0;
      }
      const innerContent = match[2].trim();
      return {
        type: "underline",
        raw: match[0],
        text: innerContent,
        tokens: lexer.inlineTokens(innerContent)
      };
    }
  },
  addCommands() {
    return {
      setUnderline: () => ({ commands }) => {
        return commands.setMark(this.name);
      },
      toggleUnderline: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
      unsetUnderline: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-u": () => this.editor.commands.toggleUnderline(),
      "Mod-U": () => this.editor.commands.toggleUnderline()
    };
  }
});

// src/index.ts
var extension_underline_dist_index_default = Underline;

//# sourceMappingURL=index.js.map
// EXTERNAL MODULE: ./node_modules/prosemirror-transform/dist/index.js
var prosemirror_transform_dist = __webpack_require__(38262);
;// ./node_modules/prosemirror-dropcursor/dist/index.js



/**
Create a plugin that, when added to a ProseMirror instance,
causes a decoration to show up at the drop position when something
is dragged over the editor.

Nodes may add a `disableDropCursor` property to their spec to
control the showing of a drop cursor inside them. This may be a
boolean or a function, which will be called with a view and a
position, and should return a boolean.
*/
function dropCursor(options = {}) {
    return new prosemirror_state_dist/* Plugin */.k_({
        view(editorView) { return new DropCursorView(editorView, options); }
    });
}
class DropCursorView {
    constructor(editorView, options) {
        var _a;
        this.editorView = editorView;
        this.cursorPos = null;
        this.element = null;
        this.timeout = -1;
        this.width = (_a = options.width) !== null && _a !== void 0 ? _a : 1;
        this.color = options.color === false ? undefined : (options.color || "black");
        this.class = options.class;
        this.handlers = ["dragover", "dragend", "drop", "dragleave"].map(name => {
            let handler = (e) => { this[name](e); };
            editorView.dom.addEventListener(name, handler);
            return { name, handler };
        });
    }
    destroy() {
        this.handlers.forEach(({ name, handler }) => this.editorView.dom.removeEventListener(name, handler));
    }
    update(editorView, prevState) {
        if (this.cursorPos != null && prevState.doc != editorView.state.doc) {
            if (this.cursorPos > editorView.state.doc.content.size)
                this.setCursor(null);
            else
                this.updateOverlay();
        }
    }
    setCursor(pos) {
        if (pos == this.cursorPos)
            return;
        this.cursorPos = pos;
        if (pos == null) {
            this.element.parentNode.removeChild(this.element);
            this.element = null;
        }
        else {
            this.updateOverlay();
        }
    }
    updateOverlay() {
        let $pos = this.editorView.state.doc.resolve(this.cursorPos);
        let isBlock = !$pos.parent.inlineContent, rect;
        let editorDOM = this.editorView.dom, editorRect = editorDOM.getBoundingClientRect();
        let scaleX = editorRect.width / editorDOM.offsetWidth, scaleY = editorRect.height / editorDOM.offsetHeight;
        if (isBlock) {
            let before = $pos.nodeBefore, after = $pos.nodeAfter;
            if (before || after) {
                let node = this.editorView.nodeDOM(this.cursorPos - (before ? before.nodeSize : 0));
                if (node) {
                    let nodeRect = node.getBoundingClientRect();
                    let top = before ? nodeRect.bottom : nodeRect.top;
                    if (before && after)
                        top = (top + this.editorView.nodeDOM(this.cursorPos).getBoundingClientRect().top) / 2;
                    let halfWidth = (this.width / 2) * scaleY;
                    rect = { left: nodeRect.left, right: nodeRect.right, top: top - halfWidth, bottom: top + halfWidth };
                }
            }
        }
        if (!rect) {
            let coords = this.editorView.coordsAtPos(this.cursorPos);
            let halfWidth = (this.width / 2) * scaleX;
            rect = { left: coords.left - halfWidth, right: coords.left + halfWidth, top: coords.top, bottom: coords.bottom };
        }
        let parent = this.editorView.dom.offsetParent;
        if (!this.element) {
            this.element = parent.appendChild(document.createElement("div"));
            if (this.class)
                this.element.className = this.class;
            this.element.style.cssText = "position: absolute; z-index: 50; pointer-events: none;";
            if (this.color) {
                this.element.style.backgroundColor = this.color;
            }
        }
        this.element.classList.toggle("prosemirror-dropcursor-block", isBlock);
        this.element.classList.toggle("prosemirror-dropcursor-inline", !isBlock);
        let parentLeft, parentTop;
        if (!parent || parent == document.body && getComputedStyle(parent).position == "static") {
            parentLeft = -pageXOffset;
            parentTop = -pageYOffset;
        }
        else {
            let rect = parent.getBoundingClientRect();
            let parentScaleX = rect.width / parent.offsetWidth, parentScaleY = rect.height / parent.offsetHeight;
            parentLeft = rect.left - parent.scrollLeft * parentScaleX;
            parentTop = rect.top - parent.scrollTop * parentScaleY;
        }
        this.element.style.left = (rect.left - parentLeft) / scaleX + "px";
        this.element.style.top = (rect.top - parentTop) / scaleY + "px";
        this.element.style.width = (rect.right - rect.left) / scaleX + "px";
        this.element.style.height = (rect.bottom - rect.top) / scaleY + "px";
    }
    scheduleRemoval(timeout) {
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => this.setCursor(null), timeout);
    }
    dragover(event) {
        if (!this.editorView.editable)
            return;
        let pos = this.editorView.posAtCoords({ left: event.clientX, top: event.clientY });
        let node = pos && pos.inside >= 0 && this.editorView.state.doc.nodeAt(pos.inside);
        let disableDropCursor = node && node.type.spec.disableDropCursor;
        let disabled = typeof disableDropCursor == "function"
            ? disableDropCursor(this.editorView, pos, event)
            : disableDropCursor;
        if (pos && !disabled) {
            let target = pos.pos;
            if (this.editorView.dragging && this.editorView.dragging.slice) {
                let point = (0,prosemirror_transform_dist/* dropPoint */.Um)(this.editorView.state.doc, target, this.editorView.dragging.slice);
                if (point != null)
                    target = point;
            }
            this.setCursor(target);
            this.scheduleRemoval(5000);
        }
    }
    dragend() {
        this.scheduleRemoval(20);
    }
    drop() {
        this.scheduleRemoval(20);
    }
    dragleave(event) {
        if (!this.editorView.dom.contains(event.relatedTarget))
            this.setCursor(null);
    }
}



// EXTERNAL MODULE: ./node_modules/prosemirror-view/dist/index.js
var prosemirror_view_dist = __webpack_require__(1575);
// EXTERNAL MODULE: ./node_modules/prosemirror-keymap/dist/index.js + 1 modules
var prosemirror_keymap_dist = __webpack_require__(61396);
// EXTERNAL MODULE: ./node_modules/prosemirror-model/dist/index.js + 1 modules
var prosemirror_model_dist = __webpack_require__(58903);
;// ./node_modules/prosemirror-gapcursor/dist/index.js





/**
Gap cursor selections are represented using this class. Its
`$anchor` and `$head` properties both point at the cursor position.
*/
class GapCursor extends prosemirror_state_dist/* Selection */.LN {
    /**
    Create a gap cursor.
    */
    constructor($pos) {
        super($pos, $pos);
    }
    map(doc, mapping) {
        let $pos = doc.resolve(mapping.map(this.head));
        return GapCursor.valid($pos) ? new GapCursor($pos) : prosemirror_state_dist/* Selection */.LN.near($pos);
    }
    content() { return prosemirror_model_dist/* Slice */.Ji.empty; }
    eq(other) {
        return other instanceof GapCursor && other.head == this.head;
    }
    toJSON() {
        return { type: "gapcursor", pos: this.head };
    }
    /**
    @internal
    */
    static fromJSON(doc, json) {
        if (typeof json.pos != "number")
            throw new RangeError("Invalid input for GapCursor.fromJSON");
        return new GapCursor(doc.resolve(json.pos));
    }
    /**
    @internal
    */
    getBookmark() { return new GapBookmark(this.anchor); }
    /**
    @internal
    */
    static valid($pos) {
        let parent = $pos.parent;
        if (parent.inlineContent || !closedBefore($pos) || !closedAfter($pos))
            return false;
        let override = parent.type.spec.allowGapCursor;
        if (override != null)
            return override;
        let deflt = parent.contentMatchAt($pos.index()).defaultType;
        return deflt && deflt.isTextblock;
    }
    /**
    @internal
    */
    static findGapCursorFrom($pos, dir, mustMove = false) {
        search: for (;;) {
            if (!mustMove && GapCursor.valid($pos))
                return $pos;
            let pos = $pos.pos, next = null;
            // Scan up from this position
            for (let d = $pos.depth;; d--) {
                let parent = $pos.node(d);
                if (dir > 0 ? $pos.indexAfter(d) < parent.childCount : $pos.index(d) > 0) {
                    next = parent.child(dir > 0 ? $pos.indexAfter(d) : $pos.index(d) - 1);
                    break;
                }
                else if (d == 0) {
                    return null;
                }
                pos += dir;
                let $cur = $pos.doc.resolve(pos);
                if (GapCursor.valid($cur))
                    return $cur;
            }
            // And then down into the next node
            for (;;) {
                let inside = dir > 0 ? next.firstChild : next.lastChild;
                if (!inside) {
                    if (next.isAtom && !next.isText && !prosemirror_state_dist/* NodeSelection */.nh.isSelectable(next)) {
                        $pos = $pos.doc.resolve(pos + next.nodeSize * dir);
                        mustMove = false;
                        continue search;
                    }
                    break;
                }
                next = inside;
                pos += dir;
                let $cur = $pos.doc.resolve(pos);
                if (GapCursor.valid($cur))
                    return $cur;
            }
            return null;
        }
    }
}
GapCursor.prototype.visible = false;
GapCursor.findFrom = GapCursor.findGapCursorFrom;
prosemirror_state_dist/* Selection */.LN.jsonID("gapcursor", GapCursor);
class GapBookmark {
    constructor(pos) {
        this.pos = pos;
    }
    map(mapping) {
        return new GapBookmark(mapping.map(this.pos));
    }
    resolve(doc) {
        let $pos = doc.resolve(this.pos);
        return GapCursor.valid($pos) ? new GapCursor($pos) : prosemirror_state_dist/* Selection */.LN.near($pos);
    }
}
function needsGap(type) {
    return type.isAtom || type.spec.isolating || type.spec.createGapCursor;
}
function closedBefore($pos) {
    for (let d = $pos.depth; d >= 0; d--) {
        let index = $pos.index(d), parent = $pos.node(d);
        // At the start of this parent, look at next one
        if (index == 0) {
            if (parent.type.spec.isolating)
                return true;
            continue;
        }
        // See if the node before (or its first ancestor) is closed
        for (let before = parent.child(index - 1);; before = before.lastChild) {
            if ((before.childCount == 0 && !before.inlineContent) || needsGap(before.type))
                return true;
            if (before.inlineContent)
                return false;
        }
    }
    // Hit start of document
    return true;
}
function closedAfter($pos) {
    for (let d = $pos.depth; d >= 0; d--) {
        let index = $pos.indexAfter(d), parent = $pos.node(d);
        if (index == parent.childCount) {
            if (parent.type.spec.isolating)
                return true;
            continue;
        }
        for (let after = parent.child(index);; after = after.firstChild) {
            if ((after.childCount == 0 && !after.inlineContent) || needsGap(after.type))
                return true;
            if (after.inlineContent)
                return false;
        }
    }
    return true;
}

/**
Create a gap cursor plugin. When enabled, this will capture clicks
near and arrow-key-motion past places that don't have a normally
selectable position nearby, and create a gap cursor selection for
them. The cursor is drawn as an element with class
`ProseMirror-gapcursor`. You can either include
`style/gapcursor.css` from the package's directory or add your own
styles to make it visible.
*/
function gapCursor() {
    return new prosemirror_state_dist/* Plugin */.k_({
        props: {
            decorations: drawGapCursor,
            createSelectionBetween(_view, $anchor, $head) {
                return $anchor.pos == $head.pos && GapCursor.valid($head) ? new GapCursor($head) : null;
            },
            handleClick,
            handleKeyDown,
            handleDOMEvents: { beforeinput: beforeinput }
        }
    });
}
const handleKeyDown = (0,prosemirror_keymap_dist/* keydownHandler */.K)({
    "ArrowLeft": arrow("horiz", -1),
    "ArrowRight": arrow("horiz", 1),
    "ArrowUp": arrow("vert", -1),
    "ArrowDown": arrow("vert", 1)
});
function arrow(axis, dir) {
    const dirStr = axis == "vert" ? (dir > 0 ? "down" : "up") : (dir > 0 ? "right" : "left");
    return function (state, dispatch, view) {
        let sel = state.selection;
        let $start = dir > 0 ? sel.$to : sel.$from, mustMove = sel.empty;
        if (sel instanceof prosemirror_state_dist/* TextSelection */.U3) {
            if (!view.endOfTextblock(dirStr) || $start.depth == 0)
                return false;
            mustMove = false;
            $start = state.doc.resolve(dir > 0 ? $start.after() : $start.before());
        }
        let $found = GapCursor.findGapCursorFrom($start, dir, mustMove);
        if (!$found)
            return false;
        if (dispatch)
            dispatch(state.tr.setSelection(new GapCursor($found)));
        return true;
    };
}
function handleClick(view, pos, event) {
    if (!view || !view.editable)
        return false;
    let $pos = view.state.doc.resolve(pos);
    if (!GapCursor.valid($pos))
        return false;
    let clickPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (clickPos && clickPos.inside > -1 && prosemirror_state_dist/* NodeSelection */.nh.isSelectable(view.state.doc.nodeAt(clickPos.inside)))
        return false;
    view.dispatch(view.state.tr.setSelection(new GapCursor($pos)));
    return true;
}
// This is a hack that, when a composition starts while a gap cursor
// is active, quickly creates an inline context for the composition to
// happen in, to avoid it being aborted by the DOM selection being
// moved into a valid position.
function beforeinput(view, event) {
    if (event.inputType != "insertCompositionText" || !(view.state.selection instanceof GapCursor))
        return false;
    let { $from } = view.state.selection;
    let insert = $from.parent.contentMatchAt($from.index()).findWrapping(view.state.schema.nodes.text);
    if (!insert)
        return false;
    let frag = prosemirror_model_dist/* Fragment */.FK.empty;
    for (let i = insert.length - 1; i >= 0; i--)
        frag = prosemirror_model_dist/* Fragment */.FK.from(insert[i].createAndFill(null, frag));
    let tr = view.state.tr.replace($from.pos, $from.pos, new prosemirror_model_dist/* Slice */.Ji(frag, 0, 0));
    tr.setSelection(prosemirror_state_dist/* TextSelection */.U3.near(tr.doc.resolve($from.pos + 1)));
    view.dispatch(tr);
    return false;
}
function drawGapCursor(state) {
    if (!(state.selection instanceof GapCursor))
        return null;
    let node = document.createElement("div");
    node.className = "ProseMirror-gapcursor";
    return prosemirror_view_dist/* DecorationSet */.zF.create(state.doc, [prosemirror_view_dist/* Decoration */.NZ.widget(state.selection.head, node, { key: "gapcursor" })]);
}



;// ./node_modules/rope-sequence/dist/index.js
var GOOD_LEAF_SIZE = 200;

// :: class<T> A rope sequence is a persistent sequence data structure
// that supports appending, prepending, and slicing without doing a
// full copy. It is represented as a mostly-balanced tree.
var RopeSequence = function RopeSequence () {};

RopeSequence.prototype.append = function append (other) {
  if (!other.length) { return this }
  other = RopeSequence.from(other);

  return (!this.length && other) ||
    (other.length < GOOD_LEAF_SIZE && this.leafAppend(other)) ||
    (this.length < GOOD_LEAF_SIZE && other.leafPrepend(this)) ||
    this.appendInner(other)
};

// :: (union<[T], RopeSequence<T>>) → RopeSequence<T>
// Prepend an array or other rope to this one, returning a new rope.
RopeSequence.prototype.prepend = function prepend (other) {
  if (!other.length) { return this }
  return RopeSequence.from(other).append(this)
};

RopeSequence.prototype.appendInner = function appendInner (other) {
  return new Append(this, other)
};

// :: (?number, ?number) → RopeSequence<T>
// Create a rope repesenting a sub-sequence of this rope.
RopeSequence.prototype.slice = function slice (from, to) {
    if ( from === void 0 ) from = 0;
    if ( to === void 0 ) to = this.length;

  if (from >= to) { return RopeSequence.empty }
  return this.sliceInner(Math.max(0, from), Math.min(this.length, to))
};

// :: (number) → T
// Retrieve the element at the given position from this rope.
RopeSequence.prototype.get = function get (i) {
  if (i < 0 || i >= this.length) { return undefined }
  return this.getInner(i)
};

// :: ((element: T, index: number) → ?bool, ?number, ?number)
// Call the given function for each element between the given
// indices. This tends to be more efficient than looping over the
// indices and calling `get`, because it doesn't have to descend the
// tree for every element.
RopeSequence.prototype.forEach = function forEach (f, from, to) {
    if ( from === void 0 ) from = 0;
    if ( to === void 0 ) to = this.length;

  if (from <= to)
    { this.forEachInner(f, from, to, 0); }
  else
    { this.forEachInvertedInner(f, from, to, 0); }
};

// :: ((element: T, index: number) → U, ?number, ?number) → [U]
// Map the given functions over the elements of the rope, producing
// a flat array.
RopeSequence.prototype.map = function map (f, from, to) {
    if ( from === void 0 ) from = 0;
    if ( to === void 0 ) to = this.length;

  var result = [];
  this.forEach(function (elt, i) { return result.push(f(elt, i)); }, from, to);
  return result
};

// :: (?union<[T], RopeSequence<T>>) → RopeSequence<T>
// Create a rope representing the given array, or return the rope
// itself if a rope was given.
RopeSequence.from = function from (values) {
  if (values instanceof RopeSequence) { return values }
  return values && values.length ? new Leaf(values) : RopeSequence.empty
};

var Leaf = /*@__PURE__*/(function (RopeSequence) {
  function Leaf(values) {
    RopeSequence.call(this);
    this.values = values;
  }

  if ( RopeSequence ) Leaf.__proto__ = RopeSequence;
  Leaf.prototype = Object.create( RopeSequence && RopeSequence.prototype );
  Leaf.prototype.constructor = Leaf;

  var prototypeAccessors = { length: { configurable: true },depth: { configurable: true } };

  Leaf.prototype.flatten = function flatten () {
    return this.values
  };

  Leaf.prototype.sliceInner = function sliceInner (from, to) {
    if (from == 0 && to == this.length) { return this }
    return new Leaf(this.values.slice(from, to))
  };

  Leaf.prototype.getInner = function getInner (i) {
    return this.values[i]
  };

  Leaf.prototype.forEachInner = function forEachInner (f, from, to, start) {
    for (var i = from; i < to; i++)
      { if (f(this.values[i], start + i) === false) { return false } }
  };

  Leaf.prototype.forEachInvertedInner = function forEachInvertedInner (f, from, to, start) {
    for (var i = from - 1; i >= to; i--)
      { if (f(this.values[i], start + i) === false) { return false } }
  };

  Leaf.prototype.leafAppend = function leafAppend (other) {
    if (this.length + other.length <= GOOD_LEAF_SIZE)
      { return new Leaf(this.values.concat(other.flatten())) }
  };

  Leaf.prototype.leafPrepend = function leafPrepend (other) {
    if (this.length + other.length <= GOOD_LEAF_SIZE)
      { return new Leaf(other.flatten().concat(this.values)) }
  };

  prototypeAccessors.length.get = function () { return this.values.length };

  prototypeAccessors.depth.get = function () { return 0 };

  Object.defineProperties( Leaf.prototype, prototypeAccessors );

  return Leaf;
}(RopeSequence));

// :: RopeSequence
// The empty rope sequence.
RopeSequence.empty = new Leaf([]);

var Append = /*@__PURE__*/(function (RopeSequence) {
  function Append(left, right) {
    RopeSequence.call(this);
    this.left = left;
    this.right = right;
    this.length = left.length + right.length;
    this.depth = Math.max(left.depth, right.depth) + 1;
  }

  if ( RopeSequence ) Append.__proto__ = RopeSequence;
  Append.prototype = Object.create( RopeSequence && RopeSequence.prototype );
  Append.prototype.constructor = Append;

  Append.prototype.flatten = function flatten () {
    return this.left.flatten().concat(this.right.flatten())
  };

  Append.prototype.getInner = function getInner (i) {
    return i < this.left.length ? this.left.get(i) : this.right.get(i - this.left.length)
  };

  Append.prototype.forEachInner = function forEachInner (f, from, to, start) {
    var leftLen = this.left.length;
    if (from < leftLen &&
        this.left.forEachInner(f, from, Math.min(to, leftLen), start) === false)
      { return false }
    if (to > leftLen &&
        this.right.forEachInner(f, Math.max(from - leftLen, 0), Math.min(this.length, to) - leftLen, start + leftLen) === false)
      { return false }
  };

  Append.prototype.forEachInvertedInner = function forEachInvertedInner (f, from, to, start) {
    var leftLen = this.left.length;
    if (from > leftLen &&
        this.right.forEachInvertedInner(f, from - leftLen, Math.max(to, leftLen) - leftLen, start + leftLen) === false)
      { return false }
    if (to < leftLen &&
        this.left.forEachInvertedInner(f, Math.min(from, leftLen), to, start) === false)
      { return false }
  };

  Append.prototype.sliceInner = function sliceInner (from, to) {
    if (from == 0 && to == this.length) { return this }
    var leftLen = this.left.length;
    if (to <= leftLen) { return this.left.slice(from, to) }
    if (from >= leftLen) { return this.right.slice(from - leftLen, to - leftLen) }
    return this.left.slice(from, leftLen).append(this.right.slice(0, to - leftLen))
  };

  Append.prototype.leafAppend = function leafAppend (other) {
    var inner = this.right.leafAppend(other);
    if (inner) { return new Append(this.left, inner) }
  };

  Append.prototype.leafPrepend = function leafPrepend (other) {
    var inner = this.left.leafPrepend(other);
    if (inner) { return new Append(inner, this.right) }
  };

  Append.prototype.appendInner = function appendInner (other) {
    if (this.left.depth >= Math.max(this.right.depth, other.depth) + 1)
      { return new Append(this.left, new Append(this.right, other)) }
    return new Append(this, other)
  };

  return Append;
}(RopeSequence));

/* harmony default export */ var rope_sequence_dist = (RopeSequence);

;// ./node_modules/prosemirror-history/dist/index.js




// ProseMirror's history isn't simply a way to roll back to a previous
// state, because ProseMirror supports applying changes without adding
// them to the history (for example during collaboration).
//
// To this end, each 'Branch' (one for the undo history and one for
// the redo history) keeps an array of 'Items', which can optionally
// hold a step (an actual undoable change), and always hold a position
// map (which is needed to move changes below them to apply to the
// current document).
//
// An item that has both a step and a selection bookmark is the start
// of an 'event' — a group of changes that will be undone or redone at
// once. (It stores only the bookmark, since that way we don't have to
// provide a document until the selection is actually applied, which
// is useful when compressing.)
// Used to schedule history compression
const max_empty_items = 500;
class Branch {
    constructor(items, eventCount) {
        this.items = items;
        this.eventCount = eventCount;
    }
    // Pop the latest event off the branch's history and apply it
    // to a document transform.
    popEvent(state, preserveItems) {
        if (this.eventCount == 0)
            return null;
        let end = this.items.length;
        for (;; end--) {
            let next = this.items.get(end - 1);
            if (next.selection) {
                --end;
                break;
            }
        }
        let remap, mapFrom;
        if (preserveItems) {
            remap = this.remapping(end, this.items.length);
            mapFrom = remap.maps.length;
        }
        let transform = state.tr;
        let selection, remaining;
        let addAfter = [], addBefore = [];
        this.items.forEach((item, i) => {
            if (!item.step) {
                if (!remap) {
                    remap = this.remapping(end, i + 1);
                    mapFrom = remap.maps.length;
                }
                mapFrom--;
                addBefore.push(item);
                return;
            }
            if (remap) {
                addBefore.push(new Item(item.map));
                let step = item.step.map(remap.slice(mapFrom)), map;
                if (step && transform.maybeStep(step).doc) {
                    map = transform.mapping.maps[transform.mapping.maps.length - 1];
                    addAfter.push(new Item(map, undefined, undefined, addAfter.length + addBefore.length));
                }
                mapFrom--;
                if (map)
                    remap.appendMap(map, mapFrom);
            }
            else {
                transform.maybeStep(item.step);
            }
            if (item.selection) {
                selection = remap ? item.selection.map(remap.slice(mapFrom)) : item.selection;
                remaining = new Branch(this.items.slice(0, end).append(addBefore.reverse().concat(addAfter)), this.eventCount - 1);
                return false;
            }
        }, this.items.length, 0);
        return { remaining: remaining, transform, selection: selection };
    }
    // Create a new branch with the given transform added.
    addTransform(transform, selection, histOptions, preserveItems) {
        let newItems = [], eventCount = this.eventCount;
        let oldItems = this.items, lastItem = !preserveItems && oldItems.length ? oldItems.get(oldItems.length - 1) : null;
        for (let i = 0; i < transform.steps.length; i++) {
            let step = transform.steps[i].invert(transform.docs[i]);
            let item = new Item(transform.mapping.maps[i], step, selection), merged;
            if (merged = lastItem && lastItem.merge(item)) {
                item = merged;
                if (i)
                    newItems.pop();
                else
                    oldItems = oldItems.slice(0, oldItems.length - 1);
            }
            newItems.push(item);
            if (selection) {
                eventCount++;
                selection = undefined;
            }
            if (!preserveItems)
                lastItem = item;
        }
        let overflow = eventCount - histOptions.depth;
        if (overflow > DEPTH_OVERFLOW) {
            oldItems = cutOffEvents(oldItems, overflow);
            eventCount -= overflow;
        }
        return new Branch(oldItems.append(newItems), eventCount);
    }
    remapping(from, to) {
        let maps = new prosemirror_transform_dist/* Mapping */.X9;
        this.items.forEach((item, i) => {
            let mirrorPos = item.mirrorOffset != null && i - item.mirrorOffset >= from
                ? maps.maps.length - item.mirrorOffset : undefined;
            maps.appendMap(item.map, mirrorPos);
        }, from, to);
        return maps;
    }
    addMaps(array) {
        if (this.eventCount == 0)
            return this;
        return new Branch(this.items.append(array.map(map => new Item(map))), this.eventCount);
    }
    // When the collab module receives remote changes, the history has
    // to know about those, so that it can adjust the steps that were
    // rebased on top of the remote changes, and include the position
    // maps for the remote changes in its array of items.
    rebased(rebasedTransform, rebasedCount) {
        if (!this.eventCount)
            return this;
        let rebasedItems = [], start = Math.max(0, this.items.length - rebasedCount);
        let mapping = rebasedTransform.mapping;
        let newUntil = rebasedTransform.steps.length;
        let eventCount = this.eventCount;
        this.items.forEach(item => { if (item.selection)
            eventCount--; }, start);
        let iRebased = rebasedCount;
        this.items.forEach(item => {
            let pos = mapping.getMirror(--iRebased);
            if (pos == null)
                return;
            newUntil = Math.min(newUntil, pos);
            let map = mapping.maps[pos];
            if (item.step) {
                let step = rebasedTransform.steps[pos].invert(rebasedTransform.docs[pos]);
                let selection = item.selection && item.selection.map(mapping.slice(iRebased + 1, pos));
                if (selection)
                    eventCount++;
                rebasedItems.push(new Item(map, step, selection));
            }
            else {
                rebasedItems.push(new Item(map));
            }
        }, start);
        let newMaps = [];
        for (let i = rebasedCount; i < newUntil; i++)
            newMaps.push(new Item(mapping.maps[i]));
        let items = this.items.slice(0, start).append(newMaps).append(rebasedItems);
        let branch = new Branch(items, eventCount);
        if (branch.emptyItemCount() > max_empty_items)
            branch = branch.compress(this.items.length - rebasedItems.length);
        return branch;
    }
    emptyItemCount() {
        let count = 0;
        this.items.forEach(item => { if (!item.step)
            count++; });
        return count;
    }
    // Compressing a branch means rewriting it to push the air (map-only
    // items) out. During collaboration, these naturally accumulate
    // because each remote change adds one. The `upto` argument is used
    // to ensure that only the items below a given level are compressed,
    // because `rebased` relies on a clean, untouched set of items in
    // order to associate old items with rebased steps.
    compress(upto = this.items.length) {
        let remap = this.remapping(0, upto), mapFrom = remap.maps.length;
        let items = [], events = 0;
        this.items.forEach((item, i) => {
            if (i >= upto) {
                items.push(item);
                if (item.selection)
                    events++;
            }
            else if (item.step) {
                let step = item.step.map(remap.slice(mapFrom)), map = step && step.getMap();
                mapFrom--;
                if (map)
                    remap.appendMap(map, mapFrom);
                if (step) {
                    let selection = item.selection && item.selection.map(remap.slice(mapFrom));
                    if (selection)
                        events++;
                    let newItem = new Item(map.invert(), step, selection), merged, last = items.length - 1;
                    if (merged = items.length && items[last].merge(newItem))
                        items[last] = merged;
                    else
                        items.push(newItem);
                }
            }
            else if (item.map) {
                mapFrom--;
            }
        }, this.items.length, 0);
        return new Branch(rope_sequence_dist.from(items.reverse()), events);
    }
}
Branch.empty = new Branch(rope_sequence_dist.empty, 0);
function cutOffEvents(items, n) {
    let cutPoint;
    items.forEach((item, i) => {
        if (item.selection && (n-- == 0)) {
            cutPoint = i;
            return false;
        }
    });
    return items.slice(cutPoint);
}
class Item {
    constructor(
    // The (forward) step map for this item.
    map, 
    // The inverted step
    step, 
    // If this is non-null, this item is the start of a group, and
    // this selection is the starting selection for the group (the one
    // that was active before the first step was applied)
    selection, 
    // If this item is the inverse of a previous mapping on the stack,
    // this points at the inverse's offset
    mirrorOffset) {
        this.map = map;
        this.step = step;
        this.selection = selection;
        this.mirrorOffset = mirrorOffset;
    }
    merge(other) {
        if (this.step && other.step && !other.selection) {
            let step = other.step.merge(this.step);
            if (step)
                return new Item(step.getMap().invert(), step, this.selection);
        }
    }
}
// The value of the state field that tracks undo/redo history for that
// state. Will be stored in the plugin state when the history plugin
// is active.
class HistoryState {
    constructor(done, undone, prevRanges, prevTime, prevComposition) {
        this.done = done;
        this.undone = undone;
        this.prevRanges = prevRanges;
        this.prevTime = prevTime;
        this.prevComposition = prevComposition;
    }
}
const DEPTH_OVERFLOW = 20;
// Record a transformation in undo history.
function applyTransaction(history, state, tr, options) {
    let historyTr = tr.getMeta(historyKey), rebased;
    if (historyTr)
        return historyTr.historyState;
    if (tr.getMeta(closeHistoryKey))
        history = new HistoryState(history.done, history.undone, null, 0, -1);
    let appended = tr.getMeta("appendedTransaction");
    if (tr.steps.length == 0) {
        return history;
    }
    else if (appended && appended.getMeta(historyKey)) {
        if (appended.getMeta(historyKey).redo)
            return new HistoryState(history.done.addTransform(tr, undefined, options, mustPreserveItems(state)), history.undone, rangesFor(tr.mapping.maps), history.prevTime, history.prevComposition);
        else
            return new HistoryState(history.done, history.undone.addTransform(tr, undefined, options, mustPreserveItems(state)), null, history.prevTime, history.prevComposition);
    }
    else if (tr.getMeta("addToHistory") !== false && !(appended && appended.getMeta("addToHistory") === false)) {
        // Group transforms that occur in quick succession into one event.
        let composition = tr.getMeta("composition");
        let newGroup = history.prevTime == 0 ||
            (!appended && history.prevComposition != composition &&
                (history.prevTime < (tr.time || 0) - options.newGroupDelay || !isAdjacentTo(tr, history.prevRanges)));
        let prevRanges = appended ? mapRanges(history.prevRanges, tr.mapping) : rangesFor(tr.mapping.maps);
        return new HistoryState(history.done.addTransform(tr, newGroup ? state.selection.getBookmark() : undefined, options, mustPreserveItems(state)), Branch.empty, prevRanges, tr.time, composition == null ? history.prevComposition : composition);
    }
    else if (rebased = tr.getMeta("rebased")) {
        // Used by the collab module to tell the history that some of its
        // content has been rebased.
        return new HistoryState(history.done.rebased(tr, rebased), history.undone.rebased(tr, rebased), mapRanges(history.prevRanges, tr.mapping), history.prevTime, history.prevComposition);
    }
    else {
        return new HistoryState(history.done.addMaps(tr.mapping.maps), history.undone.addMaps(tr.mapping.maps), mapRanges(history.prevRanges, tr.mapping), history.prevTime, history.prevComposition);
    }
}
function isAdjacentTo(transform, prevRanges) {
    if (!prevRanges)
        return false;
    if (!transform.docChanged)
        return true;
    let adjacent = false;
    transform.mapping.maps[0].forEach((start, end) => {
        for (let i = 0; i < prevRanges.length; i += 2)
            if (start <= prevRanges[i + 1] && end >= prevRanges[i])
                adjacent = true;
    });
    return adjacent;
}
function rangesFor(maps) {
    let result = [];
    for (let i = maps.length - 1; i >= 0 && result.length == 0; i--)
        maps[i].forEach((_from, _to, from, to) => result.push(from, to));
    return result;
}
function mapRanges(ranges, mapping) {
    if (!ranges)
        return null;
    let result = [];
    for (let i = 0; i < ranges.length; i += 2) {
        let from = mapping.map(ranges[i], 1), to = mapping.map(ranges[i + 1], -1);
        if (from <= to)
            result.push(from, to);
    }
    return result;
}
// Apply the latest event from one branch to the document and shift the event
// onto the other branch.
function histTransaction(history, state, redo) {
    let preserveItems = mustPreserveItems(state);
    let histOptions = historyKey.get(state).spec.config;
    let pop = (redo ? history.undone : history.done).popEvent(state, preserveItems);
    if (!pop)
        return null;
    let selection = pop.selection.resolve(pop.transform.doc);
    let added = (redo ? history.done : history.undone).addTransform(pop.transform, state.selection.getBookmark(), histOptions, preserveItems);
    let newHist = new HistoryState(redo ? added : pop.remaining, redo ? pop.remaining : added, null, 0, -1);
    return pop.transform.setSelection(selection).setMeta(historyKey, { redo, historyState: newHist });
}
let cachedPreserveItems = false, cachedPreserveItemsPlugins = null;
// Check whether any plugin in the given state has a
// `historyPreserveItems` property in its spec, in which case we must
// preserve steps exactly as they came in, so that they can be
// rebased.
function mustPreserveItems(state) {
    let plugins = state.plugins;
    if (cachedPreserveItemsPlugins != plugins) {
        cachedPreserveItems = false;
        cachedPreserveItemsPlugins = plugins;
        for (let i = 0; i < plugins.length; i++)
            if (plugins[i].spec.historyPreserveItems) {
                cachedPreserveItems = true;
                break;
            }
    }
    return cachedPreserveItems;
}
/**
Set a flag on the given transaction that will prevent further steps
from being appended to an existing history event (so that they
require a separate undo command to undo).
*/
function closeHistory(tr) {
    return tr.setMeta(closeHistoryKey, true);
}
const historyKey = new prosemirror_state_dist/* PluginKey */.hs("history");
const closeHistoryKey = new prosemirror_state_dist/* PluginKey */.hs("closeHistory");
/**
Returns a plugin that enables the undo history for an editor. The
plugin will track undo and redo stacks, which can be used with the
[`undo`](https://prosemirror.net/docs/ref/#history.undo) and [`redo`](https://prosemirror.net/docs/ref/#history.redo) commands.

You can set an `"addToHistory"` [metadata
property](https://prosemirror.net/docs/ref/#state.Transaction.setMeta) of `false` on a transaction
to prevent it from being rolled back by undo.
*/
function dist_history(config = {}) {
    config = { depth: config.depth || 100,
        newGroupDelay: config.newGroupDelay || 500 };
    return new prosemirror_state_dist/* Plugin */.k_({
        key: historyKey,
        state: {
            init() {
                return new HistoryState(Branch.empty, Branch.empty, null, 0, -1);
            },
            apply(tr, hist, state) {
                return applyTransaction(hist, state, tr, config);
            }
        },
        config,
        props: {
            handleDOMEvents: {
                beforeinput(view, e) {
                    let inputType = e.inputType;
                    let command = inputType == "historyUndo" ? undo : inputType == "historyRedo" ? redo : null;
                    if (!command || !view.editable)
                        return false;
                    e.preventDefault();
                    return command(view.state, view.dispatch);
                }
            }
        }
    });
}
function buildCommand(redo, scroll) {
    return (state, dispatch) => {
        let hist = historyKey.getState(state);
        if (!hist || (redo ? hist.undone : hist.done).eventCount == 0)
            return false;
        if (dispatch) {
            let tr = histTransaction(hist, state, redo);
            if (tr)
                dispatch(scroll ? tr.scrollIntoView() : tr);
        }
        return true;
    };
}
/**
A command function that undoes the last change, if any.
*/
const undo = buildCommand(false, true);
/**
A command function that redoes the last undone change, if any.
*/
const redo = buildCommand(true, true);
/**
A command function that undoes the last change. Don't scroll the
selection into view.
*/
const undoNoScroll = buildCommand(false, false);
/**
A command function that redoes the last undone change. Don't
scroll the selection into view.
*/
const redoNoScroll = buildCommand(true, false);
/**
The amount of undoable events available in a given state.
*/
function undoDepth(state) {
    let hist = historyKey.getState(state);
    return hist ? hist.done.eventCount : 0;
}
/**
The amount of redoable events available in a given editor state.
*/
function redoDepth(state) {
    let hist = historyKey.getState(state);
    return hist ? hist.undone.eventCount : 0;
}
/**
Returns true if the given transaction was generated by the history
plugin.
*/
function isHistoryTransaction(tr) {
    return tr.getMeta(historyKey) != null;
}



;// ./node_modules/@tiptap/extensions/dist/index.js
// src/character-count/character-count.ts


var CharacterCount = dist/* Extension */.YY.create({
  name: "characterCount",
  addOptions() {
    return {
      limit: null,
      mode: "textSize",
      textCounter: (text) => text.length,
      wordCounter: (text) => text.split(" ").filter((word) => word !== "").length
    };
  },
  addStorage() {
    return {
      characters: () => 0,
      words: () => 0
    };
  },
  onBeforeCreate() {
    this.storage.characters = (options) => {
      const node = (options == null ? void 0 : options.node) || this.editor.state.doc;
      const mode = (options == null ? void 0 : options.mode) || this.options.mode;
      if (mode === "textSize") {
        const text = node.textBetween(0, node.content.size, void 0, " ");
        return this.options.textCounter(text);
      }
      return node.nodeSize;
    };
    this.storage.words = (options) => {
      const node = (options == null ? void 0 : options.node) || this.editor.state.doc;
      const text = node.textBetween(0, node.content.size, " ", " ");
      return this.options.wordCounter(text);
    };
  },
  addProseMirrorPlugins() {
    let initialEvaluationDone = false;
    return [
      new prosemirror_state_dist/* Plugin */.k_({
        key: new prosemirror_state_dist/* PluginKey */.hs("characterCount"),
        appendTransaction: (transactions, oldState, newState) => {
          if (initialEvaluationDone) {
            return;
          }
          const limit = this.options.limit;
          if (limit === null || limit === void 0 || limit === 0) {
            initialEvaluationDone = true;
            return;
          }
          const initialContentSize = this.storage.characters({ node: newState.doc });
          if (initialContentSize > limit) {
            const over = initialContentSize - limit;
            const from = 0;
            const to = over;
            console.warn(
              `[CharacterCount] Initial content exceeded limit of ${limit} characters. Content was automatically trimmed.`
            );
            const tr = newState.tr.deleteRange(from, to);
            initialEvaluationDone = true;
            return tr;
          }
          initialEvaluationDone = true;
        },
        filterTransaction: (transaction, state) => {
          const limit = this.options.limit;
          if (!transaction.docChanged || limit === 0 || limit === null || limit === void 0) {
            return true;
          }
          const oldSize = this.storage.characters({ node: state.doc });
          const newSize = this.storage.characters({ node: transaction.doc });
          if (newSize <= limit) {
            return true;
          }
          if (oldSize > limit && newSize > limit && newSize <= oldSize) {
            return true;
          }
          if (oldSize > limit && newSize > limit && newSize > oldSize) {
            return false;
          }
          const isPaste = transaction.getMeta("paste");
          if (!isPaste) {
            return false;
          }
          const pos = transaction.selection.$head.pos;
          const over = newSize - limit;
          const from = pos - over;
          const to = pos;
          transaction.deleteRange(from, to);
          const updatedSize = this.storage.characters({ node: transaction.doc });
          if (updatedSize > limit) {
            return false;
          }
          return true;
        }
      })
    ];
  }
});

// src/drop-cursor/drop-cursor.ts


var Dropcursor = dist/* Extension */.YY.create({
  name: "dropCursor",
  addOptions() {
    return {
      color: "currentColor",
      width: 1,
      class: void 0
    };
  },
  addProseMirrorPlugins() {
    return [dropCursor(this.options)];
  }
});

// src/focus/focus.ts



var Focus = dist/* Extension */.YY.create({
  name: "focus",
  addOptions() {
    return {
      className: "has-focus",
      mode: "all"
    };
  },
  addProseMirrorPlugins() {
    return [
      new prosemirror_state_dist/* Plugin */.k_({
        key: new prosemirror_state_dist/* PluginKey */.hs("focus"),
        props: {
          decorations: ({ doc, selection }) => {
            const { isEditable, isFocused } = this.editor;
            const { anchor } = selection;
            const decorations = [];
            if (!isEditable || !isFocused) {
              return prosemirror_view_dist/* DecorationSet */.zF.create(doc, []);
            }
            let maxLevels = 0;
            if (this.options.mode === "deepest") {
              doc.descendants((node, pos) => {
                if (node.isText) {
                  return;
                }
                const isCurrent = anchor >= pos && anchor <= pos + node.nodeSize - 1;
                if (!isCurrent) {
                  return false;
                }
                maxLevels += 1;
              });
            }
            let currentLevel = 0;
            doc.descendants((node, pos) => {
              if (node.isText) {
                return false;
              }
              const isCurrent = anchor >= pos && anchor <= pos + node.nodeSize - 1;
              if (!isCurrent) {
                return false;
              }
              currentLevel += 1;
              const outOfScope = this.options.mode === "deepest" && maxLevels - currentLevel > 0 || this.options.mode === "shallowest" && currentLevel > 1;
              if (outOfScope) {
                return this.options.mode === "deepest";
              }
              decorations.push(
                prosemirror_view_dist/* Decoration */.NZ.node(pos, pos + node.nodeSize, {
                  class: this.options.className
                })
              );
            });
            return prosemirror_view_dist/* DecorationSet */.zF.create(doc, decorations);
          }
        }
      })
    ];
  }
});

// src/gap-cursor/gap-cursor.ts


var Gapcursor = dist/* Extension */.YY.create({
  name: "gapCursor",
  addProseMirrorPlugins() {
    return [gapCursor()];
  },
  extendNodeSchema(extension) {
    var _a;
    const context = {
      name: extension.name,
      options: extension.options,
      storage: extension.storage
    };
    return {
      allowGapCursor: (_a = (0,dist/* callOrReturn */.gk)((0,dist/* getExtensionField */.iI)(extension, "allowGapCursor", context))) != null ? _a : null
    };
  }
});

// src/placeholder/placeholder.ts



var DEFAULT_DATA_ATTRIBUTE = "placeholder";
function preparePlaceholderAttribute(attr) {
  return attr.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").replace(/^[0-9-]+/, "").replace(/^-+/, "").toLowerCase();
}
var Placeholder = dist/* Extension */.YY.create({
  name: "placeholder",
  addOptions() {
    return {
      emptyEditorClass: "is-editor-empty",
      emptyNodeClass: "is-empty",
      dataAttribute: DEFAULT_DATA_ATTRIBUTE,
      placeholder: "Write something \u2026",
      showOnlyWhenEditable: true,
      showOnlyCurrent: true,
      includeChildren: false
    };
  },
  addProseMirrorPlugins() {
    const dataAttribute = this.options.dataAttribute ? `data-${preparePlaceholderAttribute(this.options.dataAttribute)}` : `data-${DEFAULT_DATA_ATTRIBUTE}`;
    return [
      new prosemirror_state_dist/* Plugin */.k_({
        key: new prosemirror_state_dist/* PluginKey */.hs("placeholder"),
        props: {
          decorations: ({ doc, selection }) => {
            const active = this.editor.isEditable || !this.options.showOnlyWhenEditable;
            const { anchor } = selection;
            const decorations = [];
            if (!active) {
              return null;
            }
            const isEmptyDoc = this.editor.isEmpty;
            doc.descendants((node, pos) => {
              const hasAnchor = anchor >= pos && anchor <= pos + node.nodeSize;
              const isEmpty = !node.isLeaf && (0,dist/* isNodeEmpty */.Op)(node);
              if (!node.type.isTextblock) {
                return this.options.includeChildren;
              }
              if ((hasAnchor || !this.options.showOnlyCurrent) && isEmpty) {
                const classes = [this.options.emptyNodeClass];
                if (isEmptyDoc) {
                  classes.push(this.options.emptyEditorClass);
                }
                const decoration = prosemirror_view_dist/* Decoration */.NZ.node(pos, pos + node.nodeSize, {
                  class: classes.join(" "),
                  [dataAttribute]: typeof this.options.placeholder === "function" ? this.options.placeholder({
                    editor: this.editor,
                    node,
                    pos,
                    hasAnchor
                  }) : this.options.placeholder
                });
                decorations.push(decoration);
              }
              return this.options.includeChildren;
            });
            return prosemirror_view_dist/* DecorationSet */.zF.create(doc, decorations);
          }
        }
      })
    ];
  }
});

// src/selection/selection.ts



var Selection = dist/* Extension */.YY.create({
  name: "selection",
  addOptions() {
    return {
      className: "selection"
    };
  },
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new prosemirror_state_dist/* Plugin */.k_({
        key: new prosemirror_state_dist/* PluginKey */.hs("selection"),
        props: {
          decorations(state) {
            if (state.selection.empty || editor.isFocused || !editor.isEditable || (0,dist/* isNodeSelection */.BQ)(state.selection) || editor.view.dragging) {
              return null;
            }
            return prosemirror_view_dist/* DecorationSet */.zF.create(state.doc, [
              prosemirror_view_dist/* Decoration */.NZ.inline(state.selection.from, state.selection.to, {
                class: options.className
              })
            ]);
          }
        }
      })
    ];
  }
});

// src/trailing-node/trailing-node.ts


var skipTrailingNodeMeta = "skipTrailingNode";
function nodeEqualsType({ types, node }) {
  return node && Array.isArray(types) && types.includes(node.type) || (node == null ? void 0 : node.type) === types;
}
var TrailingNode = dist/* Extension */.YY.create({
  name: "trailingNode",
  addOptions() {
    return {
      node: void 0,
      notAfter: []
    };
  },
  addProseMirrorPlugins() {
    var _a;
    const plugin = new prosemirror_state_dist/* PluginKey */.hs(this.name);
    const defaultNode = this.options.node || ((_a = this.editor.schema.topNodeType.contentMatch.defaultType) == null ? void 0 : _a.name) || "paragraph";
    const disabledNodes = Object.entries(this.editor.schema.nodes).map(([, value]) => value).filter((node) => (this.options.notAfter || []).concat(defaultNode).includes(node.name));
    return [
      new prosemirror_state_dist/* Plugin */.k_({
        key: plugin,
        appendTransaction: (transactions, __, state) => {
          const { doc, tr, schema } = state;
          const shouldInsertNodeAtEnd = plugin.getState(state);
          const endPosition = doc.content.size;
          const type = schema.nodes[defaultNode];
          if (transactions.some((transaction) => transaction.getMeta(skipTrailingNodeMeta))) {
            return;
          }
          if (!shouldInsertNodeAtEnd) {
            return;
          }
          return tr.insert(endPosition, type.create());
        },
        state: {
          init: (_, state) => {
            const lastNode = state.tr.doc.lastChild;
            return !nodeEqualsType({ node: lastNode, types: disabledNodes });
          },
          apply: (tr, value) => {
            if (!tr.docChanged) {
              return value;
            }
            if (tr.getMeta("__uniqueIDTransaction")) {
              return value;
            }
            const lastNode = tr.doc.lastChild;
            return !nodeEqualsType({ node: lastNode, types: disabledNodes });
          }
        }
      })
    ];
  }
});

// src/undo-redo/undo-redo.ts


var UndoRedo = dist/* Extension */.YY.create({
  name: "undoRedo",
  addOptions() {
    return {
      depth: 100,
      newGroupDelay: 500
    };
  },
  addCommands() {
    return {
      undo: () => ({ state, dispatch }) => {
        return undo(state, dispatch);
      },
      redo: () => ({ state, dispatch }) => {
        return redo(state, dispatch);
      }
    };
  },
  addProseMirrorPlugins() {
    return [dist_history(this.options)];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-z": () => this.editor.commands.undo(),
      "Shift-Mod-z": () => this.editor.commands.redo(),
      "Mod-y": () => this.editor.commands.redo(),
      // Russian keyboard layouts
      "Mod-\u044F": () => this.editor.commands.undo(),
      "Shift-Mod-\u044F": () => this.editor.commands.redo()
    };
  }
});

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/starter-kit/dist/index.js
// src/starter-kit.ts

















var StarterKit = dist/* Extension */.YY.create({
  name: "starterKit",
  addExtensions() {
    var _a, _b, _c, _d;
    const extensions = [];
    if (this.options.bold !== false) {
      extensions.push(Bold.configure(this.options.bold));
    }
    if (this.options.blockquote !== false) {
      extensions.push(Blockquote.configure(this.options.blockquote));
    }
    if (this.options.bulletList !== false) {
      extensions.push(BulletList.configure(this.options.bulletList));
    }
    if (this.options.code !== false) {
      extensions.push(Code.configure(this.options.code));
    }
    if (this.options.codeBlock !== false) {
      extensions.push(CodeBlock.configure(this.options.codeBlock));
    }
    if (this.options.document !== false) {
      extensions.push(Document.configure(this.options.document));
    }
    if (this.options.dropcursor !== false) {
      extensions.push(Dropcursor.configure(this.options.dropcursor));
    }
    if (this.options.gapcursor !== false) {
      extensions.push(Gapcursor.configure(this.options.gapcursor));
    }
    if (this.options.hardBreak !== false) {
      extensions.push(HardBreak.configure(this.options.hardBreak));
    }
    if (this.options.heading !== false) {
      extensions.push(Heading.configure(this.options.heading));
    }
    if (this.options.undoRedo !== false) {
      extensions.push(UndoRedo.configure(this.options.undoRedo));
    }
    if (this.options.horizontalRule !== false) {
      extensions.push(HorizontalRule.configure(this.options.horizontalRule));
    }
    if (this.options.italic !== false) {
      extensions.push(Italic.configure(this.options.italic));
    }
    if (this.options.listItem !== false) {
      extensions.push(ListItem.configure(this.options.listItem));
    }
    if (this.options.listKeymap !== false) {
      extensions.push(ListKeymap.configure((_a = this.options) == null ? void 0 : _a.listKeymap));
    }
    if (this.options.link !== false) {
      extensions.push(Link.configure((_b = this.options) == null ? void 0 : _b.link));
    }
    if (this.options.orderedList !== false) {
      extensions.push(OrderedList.configure(this.options.orderedList));
    }
    if (this.options.paragraph !== false) {
      extensions.push(Paragraph.configure(this.options.paragraph));
    }
    if (this.options.strike !== false) {
      extensions.push(Strike.configure(this.options.strike));
    }
    if (this.options.text !== false) {
      extensions.push(dist_Text.configure(this.options.text));
    }
    if (this.options.underline !== false) {
      extensions.push(Underline.configure((_c = this.options) == null ? void 0 : _c.underline));
    }
    if (this.options.trailingNode !== false) {
      extensions.push(TrailingNode.configure((_d = this.options) == null ? void 0 : _d.trailingNode));
    }
    return extensions;
  }
});

// src/index.ts
var starter_kit_dist_index_default = StarterKit;

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-text-align/dist/index.js
// src/text-align.ts

var TextAlign = dist/* Extension */.YY.create({
  name: "textAlign",
  addOptions() {
    return {
      types: [],
      alignments: ["left", "center", "right", "justify"],
      defaultAlignment: null
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (element) => {
              const alignment = element.style.textAlign;
              return this.options.alignments.includes(alignment) ? alignment : this.options.defaultAlignment;
            },
            renderHTML: (attributes) => {
              if (!attributes.textAlign) {
                return {};
              }
              return { style: `text-align: ${attributes.textAlign}` };
            }
          }
        }
      }
    ];
  },
  addCommands() {
    return {
      setTextAlign: (alignment) => ({ commands }) => {
        if (!this.options.alignments.includes(alignment)) {
          return false;
        }
        return this.options.types.map((type) => commands.updateAttributes(type, { textAlign: alignment })).some((response) => response);
      },
      unsetTextAlign: () => ({ commands }) => {
        return this.options.types.map((type) => commands.resetAttributes(type, "textAlign")).some((response) => response);
      },
      toggleTextAlign: (alignment) => ({ editor, commands }) => {
        if (!this.options.alignments.includes(alignment)) {
          return false;
        }
        if (editor.isActive({ textAlign: alignment })) {
          return commands.unsetTextAlign();
        }
        return commands.setTextAlign(alignment);
      }
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => this.editor.commands.setTextAlign("left"),
      "Mod-Shift-e": () => this.editor.commands.setTextAlign("center"),
      "Mod-Shift-r": () => this.editor.commands.setTextAlign("right"),
      "Mod-Shift-j": () => this.editor.commands.setTextAlign("justify")
    };
  }
});

// src/index.ts
var extension_text_align_dist_index_default = TextAlign;

//# sourceMappingURL=index.js.map
;// ./node_modules/@tiptap/extension-typography/dist/index.js
// src/typography.ts

var emDash = (override) => (0,dist/* textInputRule */.Yp)({
  find: /--$/,
  replace: override != null ? override : "\u2014"
});
var ellipsis = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\.\.\.$/,
  replace: override != null ? override : "\u2026"
});
var openDoubleQuote = (override) => (0,dist/* textInputRule */.Yp)({
  find: /(?:^|[\s{[(<'"\u2018\u201C])(")$/,
  replace: override != null ? override : "\u201C"
});
var closeDoubleQuote = (override) => (0,dist/* textInputRule */.Yp)({
  find: /"$/,
  replace: override != null ? override : "\u201D"
});
var openSingleQuote = (override) => (0,dist/* textInputRule */.Yp)({
  find: /(?:^|[\s{[(<'"\u2018\u201C])(')$/,
  replace: override != null ? override : "\u2018"
});
var closeSingleQuote = (override) => (0,dist/* textInputRule */.Yp)({
  find: /'$/,
  replace: override != null ? override : "\u2019"
});
var leftArrow = (override) => (0,dist/* textInputRule */.Yp)({
  find: /<-$/,
  replace: override != null ? override : "\u2190"
});
var rightArrow = (override) => (0,dist/* textInputRule */.Yp)({
  find: /->$/,
  replace: override != null ? override : "\u2192"
});
var copyright = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\(c\)$/,
  replace: override != null ? override : "\xA9"
});
var trademark = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\(tm\)$/,
  replace: override != null ? override : "\u2122"
});
var servicemark = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\(sm\)$/,
  replace: override != null ? override : "\u2120"
});
var registeredTrademark = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\(r\)$/,
  replace: override != null ? override : "\xAE"
});
var oneHalf = (override) => (0,dist/* textInputRule */.Yp)({
  find: /(?:^|\s)(1\/2)\s$/,
  replace: override != null ? override : "\xBD"
});
var plusMinus = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\+\/-$/,
  replace: override != null ? override : "\xB1"
});
var notEqual = (override) => (0,dist/* textInputRule */.Yp)({
  find: /!=$/,
  replace: override != null ? override : "\u2260"
});
var laquo = (override) => (0,dist/* textInputRule */.Yp)({
  find: /<<$/,
  replace: override != null ? override : "\xAB"
});
var raquo = (override) => (0,dist/* textInputRule */.Yp)({
  find: />>$/,
  replace: override != null ? override : "\xBB"
});
var multiplication = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\d+\s?([*x])\s?\d+$/,
  replace: override != null ? override : "\xD7"
});
var superscriptTwo = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\^2$/,
  replace: override != null ? override : "\xB2"
});
var superscriptThree = (override) => (0,dist/* textInputRule */.Yp)({
  find: /\^3$/,
  replace: override != null ? override : "\xB3"
});
var oneQuarter = (override) => (0,dist/* textInputRule */.Yp)({
  find: /(?:^|\s)(1\/4)\s$/,
  replace: override != null ? override : "\xBC"
});
var threeQuarters = (override) => (0,dist/* textInputRule */.Yp)({
  find: /(?:^|\s)(3\/4)\s$/,
  replace: override != null ? override : "\xBE"
});
var Typography = dist/* Extension */.YY.create({
  name: "typography",
  addOptions() {
    return {
      closeDoubleQuote: "\u201D",
      closeSingleQuote: "\u2019",
      copyright: "\xA9",
      ellipsis: "\u2026",
      emDash: "\u2014",
      laquo: "\xAB",
      leftArrow: "\u2190",
      multiplication: "\xD7",
      notEqual: "\u2260",
      oneHalf: "\xBD",
      oneQuarter: "\xBC",
      openDoubleQuote: "\u201C",
      openSingleQuote: "\u2018",
      plusMinus: "\xB1",
      raquo: "\xBB",
      registeredTrademark: "\xAE",
      rightArrow: "\u2192",
      servicemark: "\u2120",
      superscriptThree: "\xB3",
      superscriptTwo: "\xB2",
      threeQuarters: "\xBE",
      trademark: "\u2122"
    };
  },
  addInputRules() {
    var _a, _b;
    const rules = [];
    if (this.options.emDash !== false) {
      rules.push(emDash(this.options.emDash));
    }
    if (this.options.ellipsis !== false) {
      rules.push(ellipsis(this.options.ellipsis));
    }
    const isRTL = this.editor.options.textDirection === "rtl";
    if ((_a = this.options.doubleQuotes) == null ? void 0 : _a.rtl) {
      const { open, close } = this.options.doubleQuotes.rtl;
      rules.push(openDoubleQuote(open));
      rules.push(closeDoubleQuote(close));
    } else if (isRTL) {
      rules.push(openDoubleQuote("\u201D"));
      rules.push(closeDoubleQuote("\u201C"));
    } else {
      if (this.options.openDoubleQuote !== false) {
        rules.push(openDoubleQuote(this.options.openDoubleQuote));
      }
      if (this.options.closeDoubleQuote !== false) {
        rules.push(closeDoubleQuote(this.options.closeDoubleQuote));
      }
    }
    if ((_b = this.options.singleQuotes) == null ? void 0 : _b.rtl) {
      const { open, close } = this.options.singleQuotes.rtl;
      rules.push(openSingleQuote(open));
      rules.push(closeSingleQuote(close));
    } else if (isRTL) {
      rules.push(openSingleQuote("\u2019"));
      rules.push(closeSingleQuote("\u2018"));
    } else {
      if (this.options.openSingleQuote !== false) {
        rules.push(openSingleQuote(this.options.openSingleQuote));
      }
      if (this.options.closeSingleQuote !== false) {
        rules.push(closeSingleQuote(this.options.closeSingleQuote));
      }
    }
    if (this.options.leftArrow !== false) {
      rules.push(leftArrow(this.options.leftArrow));
    }
    if (this.options.rightArrow !== false) {
      rules.push(rightArrow(this.options.rightArrow));
    }
    if (this.options.copyright !== false) {
      rules.push(copyright(this.options.copyright));
    }
    if (this.options.trademark !== false) {
      rules.push(trademark(this.options.trademark));
    }
    if (this.options.servicemark !== false) {
      rules.push(servicemark(this.options.servicemark));
    }
    if (this.options.registeredTrademark !== false) {
      rules.push(registeredTrademark(this.options.registeredTrademark));
    }
    if (this.options.oneHalf !== false) {
      rules.push(oneHalf(this.options.oneHalf));
    }
    if (this.options.plusMinus !== false) {
      rules.push(plusMinus(this.options.plusMinus));
    }
    if (this.options.notEqual !== false) {
      rules.push(notEqual(this.options.notEqual));
    }
    if (this.options.laquo !== false) {
      rules.push(laquo(this.options.laquo));
    }
    if (this.options.raquo !== false) {
      rules.push(raquo(this.options.raquo));
    }
    if (this.options.multiplication !== false) {
      rules.push(multiplication(this.options.multiplication));
    }
    if (this.options.superscriptTwo !== false) {
      rules.push(superscriptTwo(this.options.superscriptTwo));
    }
    if (this.options.superscriptThree !== false) {
      rules.push(superscriptThree(this.options.superscriptThree));
    }
    if (this.options.oneQuarter !== false) {
      rules.push(oneQuarter(this.options.oneQuarter));
    }
    if (this.options.threeQuarters !== false) {
      rules.push(threeQuarters(this.options.threeQuarters));
    }
    return rules;
  }
});

// src/index.ts
var extension_typography_dist_index_default = Typography;

//# sourceMappingURL=index.js.map
// EXTERNAL MODULE: ./src/components/common/markdownrender.tsx + 213 modules
var markdownrender = __webpack_require__(57256);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./src/hooks/useRouter.ts
var useRouter = __webpack_require__(13555);
// EXTERNAL MODULE: ./src/components/views/menuRoutes.ts
var menuRoutes = __webpack_require__(89993);
// EXTERNAL MODULE: ./src/store/rightPanel.ts
var rightPanel = __webpack_require__(46886);
;// ./src/pages/FilePreviewPage.tsx



















/* ============================================================
   WordEditor: Online .docx editor with STRUCTURED EDITS
   - Loads .docx via mammoth.js for display
   - Tracks edits as structured operations
   - Preserves original formatting when saving
   ============================================================ */

// Helper: Extract plain text from HTML
const extractTextFromHTML = html => {
  const div = document.createElement("div");
  div.innerHTML = html;
  const paragraphs = [];
  const children = div.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li");
  children.forEach(el => {
    var _el$textContent;
    paragraphs.push(((_el$textContent = el.textContent) === null || _el$textContent === void 0 ? void 0 : _el$textContent.trim()) || "");
  });
  if (paragraphs.length === 0) {
    var _div$textContent;
    return ((_div$textContent = div.textContent) === null || _div$textContent === void 0 ? void 0 : _div$textContent.split(/\n+/).map(s => s.trim()).filter(Boolean)) || [];
  }
  return paragraphs;
};

// WordEditor component with TipTap
const WordEditor = _ref => {
  let {
    file,
    onClose,
    onFileEvent
  } = _ref;
  const {
    user,
    darkMode
  } = react.useContext(provider/* appContext */.v);
  const userId = (user === null || user === void 0 ? void 0 : user.email) || "";
  const isDark = darkMode === "dark";
  const [loading, setLoading] = react.useState(true);
  const [error, setError] = react.useState(null);
  const [saving, setSaving] = react.useState(false);
  const [htmlContent, setHtmlContent] = react.useState("");
  const [originalParagraphs, setOriginalParagraphs] = react.useState([]);
  const [contentLoaded, setContentLoaded] = react.useState(false);

  // Load mammoth.js and convert docx to HTML
  react.useEffect(() => {
    const initMammoth = async () => {
      try {
        const {
          convertToHtml
        } = await Promise.all(/* import() */[__webpack_require__.e(906), __webpack_require__.e(306)]).then(__webpack_require__.t.bind(__webpack_require__, 70306, 19));
        let arrayBuffer;
        if (file.download_method === "base64" && file.base64_content) {
          const binary = atob(file.base64_content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        } else if (file.download_method === "url" && file.url) {
          const response = await fetch(file.url);
          if (!response.ok) throw new Error("HTTP " + response.status);
          arrayBuffer = await response.arrayBuffer();
        } else {
          throw new Error("当前文件没有可用内容");
        }

        // Always use HTML conversion — TipTap natively understands HTML
        // (markdown would be treated as a single text blob)
        const {
          value: rawHtml
        } = await convertToHtml({
          arrayBuffer
        });
        const content = rawHtml.replace(/<img[^>]*>/gi, "").replace(/<table[^>]*>[\s\S]*?<\/table>/gi, "<p>[表格内容]</p>");
        console.log("[WordEditor] HTML length:", content.length);
        console.log("[WordEditor] First 300 chars:", content.slice(0, 300));

        // Extract paragraphs from HTML using DOM parsing for accurate structure
        const originalParas = extractTextFromHTML(content);
        setOriginalParagraphs(originalParas);
        setHtmlContent(content);
        setLoading(false);
      } catch (e) {
        console.error("[WordEditor] Error:", e);
        setError(e instanceof Error ? e.message : "加载失败");
        setLoading(false);
      }
    };
    void initMammoth();
  }, [file]);
  const editor = useEditor({
    extensions: [starter_kit_dist_index_default, extension_underline_dist_index_default, extension_typography_dist_index_default, extension_text_align_dist_index_default.configure({
      types: ["heading", "paragraph"]
    })],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose max-w-none focus:outline-none min-h-[350px] p-4"
      }
    }
  });

  // Update editor content when mammoth finishes loading
  react.useEffect(() => {
    if (editor && htmlContent) {
      console.log("[WordEditor] Setting content, length:", htmlContent.length);
      try {
        editor.commands.setContent(htmlContent);
      } catch (e) {
        console.error("[WordEditor] setContent error:", e);
      }
      setContentLoaded(true);
    }
  }, [editor, htmlContent]);

  // Simple similarity calculation for change detection
  const calculateSimilarity = (s1, s2) => {
    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;
    const words1 = new Set(s1.toLowerCase().split(/\s+/).filter(Boolean));
    const words2 = new Set(s2.toLowerCase().split(/\s+/).filter(Boolean));
    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;
    const intersection = new Set((0,toConsumableArray/* default */.A)(words1).filter(x => words2.has(x))).size;
    const union = new Set([].concat((0,toConsumableArray/* default */.A)(words1), (0,toConsumableArray/* default */.A)(words2))).size;
    return union > 0 ? 2 * intersection / union : 0;
  };
  const generateEdits = react.useCallback(() => {
    if (!editor) return [];
    const doc = editor.getJSON();
    const edits = [];
    const currentParagraphs = [];
    const traverse = content => {
      content.forEach(node => {
        var _node$type;
        if (node.type === "paragraph" || (_node$type = node.type) !== null && _node$type !== void 0 && _node$type.startsWith("heading")) {
          let text = "";
          if (node.content) {
            node.content.forEach(child => {
              if (child.type === "text" && child.text) text += child.text;
            });
          }
          currentParagraphs.push(text);
        } else if (node.content) {
          traverse(node.content);
        }
      });
    };
    if (doc.content) traverse(doc.content);
    for (let i = 0; i < currentParagraphs.length; i++) {
      const currentText = currentParagraphs[i];
      let bestMatchIdx = -1;
      let bestSimilarity = 0;
      for (let j = 0; j < originalParagraphs.length; j++) {
        if (i === j || originalParagraphs[j] === currentText) {
          bestMatchIdx = j;
          bestSimilarity = 1;
          break;
        }
        const similarity = calculateSimilarity(originalParagraphs[j], currentText);
        if (similarity > bestSimilarity && similarity > 0.5) {
          bestSimilarity = similarity;
          bestMatchIdx = j;
        }
      }
      if (bestMatchIdx === -1) {
        edits.push({
          type: "add_paragraph",
          content: currentText,
          paragraph_index: i
        });
      } else if (originalParagraphs[bestMatchIdx] !== currentText) {
        edits.push({
          type: "replace_text",
          old_text: originalParagraphs[bestMatchIdx],
          new_text: currentText,
          paragraph_index: bestMatchIdx
        });
      }
    }
    return edits;
  }, [editor, originalParagraphs]);
  const handleSave = react.useCallback(async () => {
    if (originalParagraphs.length === 0) {
      alert("无法获取原始内容");
      return;
    }
    if (!file.url && !file.base64_content) {
      alert("文件内容不可用（无 URL 或 base64）");
      return;
    }
    setSaving(true);
    try {
      const edits = generateEdits();
      if (edits.length === 0) {
        alert("没有检测到任何更改");
        setSaving(false);
        return;
      }
      const result = await api/* fileAPI */.jp.editDocx(userId, file.name || "", originalParagraphs, edits, file.url || null, file.base64_content || null);
      if (result.success) {
        // Emit a FilesEvent so the file shows up in 文件空间 immediately
        if (onFileEvent) {
          const savedFile = {
            name: result.saved_name || file.name || "edited.docx",
            url: result.url || "",
            base64_content: "",
            size: file.size,
            mime_type: file.mime_type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            description: "Edited version of " + (file.name || "document"),
            download_method: result.url ? "url" : "base64"
          };
          onFileEvent({
            source: "WordEditor",
            content: {
              files: [savedFile],
              title: result.saved_name || "Edited Document",
              description: "Edited version of " + (file.name || "document"),
              send_time_stamp: Date.now()
            },
            type: "FilesEvent"
          });
        }
        alert("\u6587\u4EF6\u5DF2\u4FDD\u5B58\u5230\u6587\u4EF6\u7A7A\u95F4\uFF1A" + result.saved_name);
        onClose();
      } else {
        alert("\u4FDD\u5B58\u5931\u8D25\uFF1A" + result.message);
      }
    } catch (e) {
      alert("\u4FDD\u5B58\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setSaving(false);
    }
  }, [userId, file, originalParagraphs, generateEdits, onClose, onFileEvent]);
  const bg = isDark ? "bg-[#11151c]" : "bg-white";
  const textColor = isDark ? "text-white" : "text-gray-900";
  const borderColor = isDark ? "border-white/10" : "border-gray-200";
  const hoverBg = isDark ? "hover:bg-white/5" : "hover:bg-gray-100";
  const toolbarButton = function (label, onClick, active) {
    if (active === void 0) {
      active = false;
    }
    return /*#__PURE__*/react.createElement("button", {
      type: "button",
      onClick: onClick,
      className: "px-3 py-1.5 rounded text-sm font-medium transition-colors " + (active ? "bg-blue-600 text-white" : hoverBg + " " + textColor)
    }, label);
  };
  if (loading) {
    return /*#__PURE__*/react.createElement("div", {
      className: "fixed inset-0 flex items-center justify-center z-50 " + (isDark ? "bg-gray-900" : "bg-white")
    }, /*#__PURE__*/react.createElement("div", {
      className: "text-center"
    }, /*#__PURE__*/react.createElement("div", {
      className: "animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-4"
    }), /*#__PURE__*/react.createElement("p", {
      className: textColor
    }, "\u6B63\u5728\u52A0\u8F7D\u6587\u6863...")));
  }
  if (error) {
    return /*#__PURE__*/react.createElement("div", {
      className: "fixed inset-0 flex items-center justify-center z-50 " + (isDark ? "bg-gray-900" : "bg-white")
    }, /*#__PURE__*/react.createElement("div", {
      className: "text-center p-8"
    }, /*#__PURE__*/react.createElement("div", {
      className: "text-red-500 text-5xl mb-4"
    }, "\u26A0\uFE0F"), /*#__PURE__*/react.createElement("p", {
      className: "text-xl mb-4"
    }, error), /*#__PURE__*/react.createElement("button", {
      onClick: onClose,
      className: "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
    }, "\u5173\u95ED")));
  }
  return /*#__PURE__*/react.createElement("div", {
    className: "fixed inset-0 flex flex-col z-50 " + bg
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-center justify-between px-4 py-3 border-b " + borderColor
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-2"
  }, editor && /*#__PURE__*/react.createElement(react.Fragment, null, toolbarButton("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold")), toolbarButton("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic")), toolbarButton("U", () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline")), /*#__PURE__*/react.createElement("div", {
    className: "w-px h-6 bg-gray-400 mx-1"
  }), toolbarButton("H1", () => editor.chain().focus().toggleHeading({
    level: 1
  }).run(), editor.isActive("heading", {
    level: 1
  })), toolbarButton("H2", () => editor.chain().focus().toggleHeading({
    level: 2
  }).run(), editor.isActive("heading", {
    level: 2
  })), toolbarButton("P", () => editor.chain().focus().setParagraph().run(), editor.isActive("paragraph")), /*#__PURE__*/react.createElement("div", {
    className: "w-px h-6 bg-gray-400 mx-1"
  }), toolbarButton("≡L", () => editor.chain().focus().setTextAlign("left").run(), editor.isActive({
    textAlign: "left"
  })), toolbarButton("≡C", () => editor.chain().focus().setTextAlign("center").run(), editor.isActive({
    textAlign: "center"
  })), toolbarButton("≡R", () => editor.chain().focus().setTextAlign("right").run(), editor.isActive({
    textAlign: "right"
  })))), /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-3"
  }, /*#__PURE__*/react.createElement("button", {
    onClick: () => void handleSave(),
    disabled: saving,
    className: "px-4 py-1.5 bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:opacity-50"
  }, saving ? "保存中..." : "保存到文件空间"), /*#__PURE__*/react.createElement("button", {
    onClick: onClose,
    className: "px-4 py-1.5 rounded font-medium " + hoverBg + " " + textColor
  }, "\u5173\u95ED"))), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 overflow-auto p-6"
  }, /*#__PURE__*/react.createElement("div", {
    className: "max-w-4xl mx-auto rounded-lg shadow-lg overflow-hidden " + (isDark ? "bg-gray-800" : "bg-white")
  }, /*#__PURE__*/react.createElement("style", null, "\n            .ProseMirror { outline: none; min-height: 500px; padding: 32px 40px; font-size: 15px; line-height: 1.75; }\n            .ProseMirror p { margin: 0.6em 0; text-indent: 0; }\n            .ProseMirror p:first-child { margin-top: 0; }\n            .ProseMirror p + p { margin-top: 0.6em; }\n            .ProseMirror h1 { font-size: 1.75em; font-weight: bold; margin: 1.2em 0 0.6em; }\n            .ProseMirror h2 { font-size: 1.4em; font-weight: bold; margin: 1em 0 0.5em; }\n            .ProseMirror h3 { font-size: 1.2em; font-weight: bold; margin: 0.8em 0 0.4em; }\n            .ProseMirror h4, .ProseMirror h5, .ProseMirror h6 { font-size: 1.1em; font-weight: bold; margin: 0.6em 0 0.3em; }\n            .ProseMirror ul, .ProseMirror ol { padding-left: 1.5em; margin: 0.5em 0; }\n            .ProseMirror li { margin: 0.25em 0; }\n            .ProseMirror blockquote { border-left: 3px solid #ccc; padding-left: 1em; margin: 0.8em 0; margin-left: 0; color: #666; }\n            .ProseMirror code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }\n            .ProseMirror.ProseMirror-focused { outline: none; }\n            .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #aaa; float: left; height: 0; pointer-events: none; }\n            " + (isDark ? "\n            .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 { color: #fff; }\n            .ProseMirror p { color: #e5e5e5; }\n            .ProseMirror li { color: #e5e5e5; }\n            " : '') + "\n          "), /*#__PURE__*/react.createElement(EditorContent, {
    editor: editor
  }))));
};
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const WORD_EXTENSIONS = new Set(["doc", "docx"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "yaml", "yml", "xml", "csv", "log", "py", "ts", "tsx", "js", "jsx", "java", "c", "cpp", "go", "rs", "sh", "html", "css", "scss"]);
const getExtension = name => {
  const index = name.lastIndexOf(".");
  if (index < 0) return "";
  return name.slice(index + 1).toLowerCase();
};
const base64ToUtf8 = base64 => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
};
const fileToDataUrl = file => {
  if (file.download_method === "url" && file.url) return file.url;
  if (file.download_method === "base64" && file.base64_content) {
    const mime = file.mime_type || "application/octet-stream";
    return "data:" + mime + ";base64," + file.base64_content;
  }
  return null;
};
const isTextFile = file => {
  var _file$mime_type, _file$mime_type2;
  if ((_file$mime_type = file.mime_type) !== null && _file$mime_type !== void 0 && _file$mime_type.startsWith("text/")) return true;
  if ((_file$mime_type2 = file.mime_type) !== null && _file$mime_type2 !== void 0 && _file$mime_type2.includes("json")) return true;
  return TEXT_EXTENSIONS.has(getExtension(file.name || ""));
};
const isImageFile = file => {
  var _file$mime_type3;
  if ((_file$mime_type3 = file.mime_type) !== null && _file$mime_type3 !== void 0 && _file$mime_type3.startsWith("image/")) return true;
  return IMAGE_EXTENSIONS.has(getExtension(file.name || ""));
};
const isPdfFile = file => {
  if (file.mime_type === "application/pdf") return true;
  return getExtension(file.name || "") === "pdf";
};
const isWordFile = file => {
  if (file.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.mime_type === "application/msword") return true;
  return WORD_EXTENSIONS.has(getExtension(file.name || ""));
};
const isMarkdownFile = file => {
  const ext = getExtension(file.name || "");
  return ext === "md" || ext === "markdown";
};
const normalizeMarkdownForPreview = raw => {
  let text = raw.replace(/\r\n/g, "\n");
  text = text.replace(/<img[^>]*>/gi, tag => {
    const srcMatch = tag.match(/src\s*=\s*["']([^"']+)["']/i);
    const altMatch = tag.match(/alt\s*=\s*["']([^"']*)["']/i);
    const src = (srcMatch === null || srcMatch === void 0 ? void 0 : srcMatch[1]) || "";
    const alt = (altMatch === null || altMatch === void 0 ? void 0 : altMatch[1]) || "image";
    return src ? "\n![" + alt + "](" + src + ")\n" : "";
  });
  text = text.replace(/<\/?(div|p)[^>]*>/gi, "\n");

  // Insert line breaks before heading markers if backend flattened lines.
  text = text.replace(/(^|[^\n])(#{1,6}\s)/g, (_match, prefix, heading) => {
    return prefix + "\n" + heading;
  });

  // Insert line breaks before markdown list markers in flattened content.
  text = text.replace(/\s(-\s+\d+\.)/g, "\n$1");
  return text.replace(/\n{3,}/g, "\n\n").trim();
};
const FilePreviewPage = _ref2 => {
  let {
    file = null,
    sessionId,
    onFileEvent
  } = _ref2;
  const {
    darkMode
  } = react.useContext(provider/* appContext */.v);
  const isDark = darkMode === "dark";
  const location = (0,useRouter/* useLocation */.z)();
  const navigate = (0,useRouter/* useNavigate */.Z)();
  const setLayoutTab = (0,rightPanel/* useRightPanelStore */.x)(s => s.setLayoutTab);
  const setRightPanelOpen = (0,rightPanel/* useRightPanelStore */.x)(s => s.setIsOpen);
  const returnToSessionLikeOverviewTab = react.useCallback(() => {
    setLayoutTab("overview");
    setRightPanelOpen(true);
    navigate((0,menuRoutes/* createSearchWithView */._M)(location.search, "chat"));
  }, [location.search, navigate, setLayoutTab, setRightPanelOpen]);
  const [loading, setLoading] = react.useState(false);
  const [error, setError] = react.useState(null);
  const [originalText, setOriginalText] = react.useState("");
  const [editedText, setEditedText] = react.useState("");
  const [isEditing, setIsEditing] = react.useState(true);
  const [showWordEditor, setShowWordEditor] = react.useState(false);
  const dataUrl = react.useMemo(() => file ? fileToDataUrl(file) : null, [file]);
  const textMode = react.useMemo(() => file ? isTextFile(file) : false, [file]);
  const markdownMode = react.useMemo(() => file ? isMarkdownFile(file) : false, [file]);
  const imageMode = react.useMemo(() => file ? isImageFile(file) : false, [file]);
  const pdfMode = react.useMemo(() => file ? isPdfFile(file) : false, [file]);
  const wordMode = react.useMemo(() => file ? isWordFile(file) : false, [file]);
  const wordContainerRef = react.useRef(null);
  const [wordLoading, setWordLoading] = react.useState(false);
  const [wordError, setWordError] = react.useState(null);
  react.useEffect(() => {
    let cancelled = false;
    if (!file || !wordMode) return;
    const loadWord = async () => {
      setWordLoading(true);
      setWordError(null);
      try {
        let arrayBuffer;
        if (file.download_method === "base64" && file.base64_content) {
          const binary = atob(file.base64_content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        } else if (file.download_method === "url" && file.url) {
          const response = await fetch(file.url);
          if (!response.ok) throw new Error("HTTP " + response.status);
          arrayBuffer = await response.arrayBuffer();
        } else {
          throw new Error("当前文件没有可用内容");
        }
        if (cancelled) return;
        const container = wordContainerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const {
          renderAsync
        } = await Promise.all(/* import() */[__webpack_require__.e(906), __webpack_require__.e(3268)]).then(__webpack_require__.bind(__webpack_require__, 23268));
        await renderAsync(arrayBuffer, container);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "加载失败";
        setWordError("\u6587\u4EF6\u52A0\u8F7D\u5931\u8D25\uFF1A" + message);
      } finally {
        if (!cancelled) setWordLoading(false);
      }
    };
    void loadWord();
    return () => {
      cancelled = true;
    };
  }, [file, wordMode]);
  react.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      setOriginalText("");
      setEditedText("");
      if (!file || !textMode) return;
      setLoading(true);
      try {
        let text = "";
        if (file.download_method === "base64" && file.base64_content) {
          text = base64ToUtf8(file.base64_content);
        } else if (file.download_method === "url" && file.url) {
          const response = await fetch(file.url);
          if (!response.ok) {
            throw new Error("HTTP " + response.status);
          }
          text = await response.text();
        } else {
          throw new Error("当前文件没有可用内容");
        }
        if (cancelled) return;
        setOriginalText(text);
        setEditedText(text);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "加载失败";
        setError("\u6587\u4EF6\u52A0\u8F7D\u5931\u8D25\uFF1A" + message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [file, textMode]);
  const hasChanges = editedText !== originalText;
  const downloadEdited = react.useCallback(() => {
    if (!file) return;
    const blob = new Blob([editedText], {
      type: file.mime_type || "text/plain;charset=utf-8"
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = file.name || "edited-file.txt";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(href);
  }, [editedText, file]);
  if (!file) {
    return /*#__PURE__*/react.createElement("div", {
      className: "flex items-center justify-center h-full text-secondary"
    }, /*#__PURE__*/react.createElement("div", {
      className: "text-center"
    }, /*#__PURE__*/react.createElement(file_text/* default */.A, {
      className: "w-10 h-10 mx-auto mb-3 opacity-20"
    }), /*#__PURE__*/react.createElement("h2", {
      className: "text-base font-medium text-primary"
    }, "\u6587\u4EF6\u9884\u89C8"), /*#__PURE__*/react.createElement("p", {
      className: "mt-2 text-sm opacity-60"
    }, "\u8BF7\u9009\u62E9\u53F3\u4FA7\u6587\u4EF6\u8FDB\u884C\u9884\u89C8")));
  }
  return /*#__PURE__*/react.createElement(react.Fragment, null, showWordEditor && file && /*#__PURE__*/react.createElement(WordEditor, {
    key: Date.now(),
    file: file,
    onClose: () => setShowWordEditor(false),
    onFileEvent: onFileEvent
  }), /*#__PURE__*/react.createElement("div", {
    className: "h-full min-h-0 flex flex-col"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex-shrink-0 px-4 py-3 border-b border-border-primary/30 flex items-center justify-between gap-3"
  }, /*#__PURE__*/react.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/react.createElement("h2", {
    className: "text-base font-semibold text-primary truncate"
  }, file.name), /*#__PURE__*/react.createElement("p", {
    className: "text-xs text-secondary mt-1 truncate"
  }, file.description || "无描述")), textMode && /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: () => setIsEditing(v => !v),
    className: "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-tertiary/20 text-primary hover:bg-tertiary/30"
  }, isEditing ? /*#__PURE__*/react.createElement(eye/* default */.A, {
    className: "w-3.5 h-3.5"
  }) : /*#__PURE__*/react.createElement(PencilLine, {
    className: "w-3.5 h-3.5"
  }), isEditing ? "预览模式" : "编辑模式"), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: downloadEdited,
    disabled: !hasChanges,
    className: "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium " + (hasChanges ? "bg-accent/15 text-accent hover:bg-accent/25" : "bg-tertiary/20 text-secondary cursor-not-allowed")
  }, /*#__PURE__*/react.createElement(download/* default */.A, {
    className: "w-3.5 h-3.5"
  }), "\u4FDD\u5B58\u4E3A\u526F\u672C")), wordMode && /*#__PURE__*/react.createElement("div", {
    className: "flex flex-shrink-0 items-center gap-2"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: () => setShowWordEditor(true),
    className: "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25"
  }, /*#__PURE__*/react.createElement(PencilLine, {
    className: "w-3.5 h-3.5"
  }), "\u5728\u7EBF\u7F16\u8F91"), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: returnToSessionLikeOverviewTab,
    className: "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-tertiary/20 text-secondary hover:bg-tertiary/30"
  }, /*#__PURE__*/react.createElement(ArrowLeft, {
    className: "w-3.5 h-3.5"
  }), "\u8FD4\u56DE\u4F1A\u8BDD"))), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 min-h-0 overflow-auto p-4"
  }, loading && /*#__PURE__*/react.createElement("div", {
    className: "text-sm text-secondary"
  }, "\u6B63\u5728\u52A0\u8F7D\u6587\u4EF6\u5185\u5BB9..."), error && /*#__PURE__*/react.createElement("div", {
    className: "text-sm text-red-500"
  }, error), !loading && !error && textMode && (isEditing ? /*#__PURE__*/react.createElement("textarea", {
    value: editedText,
    onChange: e => setEditedText(e.target.value),
    className: "w-full h-full min-h-[300px] resize-none rounded-lg border border-border-primary/40 bg-primary px-3 py-2 text-sm text-primary outline-none focus:border-accent/50"
  }) : markdownMode ? /*#__PURE__*/react.createElement("div", {
    className: "text-primary bg-tertiary/10 border border-border-primary/25 rounded-lg p-3"
  }, /*#__PURE__*/react.createElement(markdownrender/* default */.A, {
    content: normalizeMarkdownForPreview(editedText)
  })) : /*#__PURE__*/react.createElement("pre", {
    className: "whitespace-pre-wrap break-words text-sm text-primary bg-tertiary/10 border border-border-primary/25 rounded-lg p-3"
  }, editedText)), !loading && !error && imageMode && dataUrl && /*#__PURE__*/react.createElement("div", {
    className: "h-full flex items-start justify-center"
  }, /*#__PURE__*/react.createElement("img", {
    src: dataUrl,
    alt: file.name,
    className: "max-h-full max-w-full object-contain rounded-md"
  })), !loading && !error && pdfMode && dataUrl && /*#__PURE__*/react.createElement("iframe", {
    src: dataUrl,
    title: file.name,
    className: "w-full h-full min-h-[500px] rounded-md border border-border-primary/30"
  }), !loading && !error && wordMode && /*#__PURE__*/react.createElement("div", {
    className: "h-full"
  }, wordLoading && /*#__PURE__*/react.createElement("div", {
    className: "text-sm text-secondary"
  }, "\u6B63\u5728\u52A0\u8F7D\u6587\u4EF6\u5185\u5BB9..."), wordError && /*#__PURE__*/react.createElement("div", {
    className: "text-sm text-red-500"
  }, wordError), /*#__PURE__*/react.createElement("div", {
    ref: wordContainerRef,
    className: "h-full overflow-auto bg-white rounded-md border border-border-primary/30 p-4" + (wordLoading || wordError ? " hidden" : "")
  })), !loading && !error && !textMode && !imageMode && !pdfMode && !wordMode && /*#__PURE__*/react.createElement("div", {
    className: "text-sm text-secondary"
  }, "\u5F53\u524D\u6587\u4EF6\u7C7B\u578B\u6682\u4E0D\u652F\u6301\u5728\u7EBF\u7F16\u8F91\uFF0C\u53EF\u4F7F\u7528\u4E0B\u8F7D\u6309\u94AE\u67E5\u770B\u3002"))));
};
/* harmony default export */ var pages_FilePreviewPage = (FilePreviewPage);

/***/ }),

/***/ 3160:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ Eye; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Eye = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("Eye", [
  [
    "path",
    {
      d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
      key: "1nclc0"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
]);


//# sourceMappingURL=eye.js.map


/***/ }),

/***/ 73506:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var isPossiblePrototype = __webpack_require__(13925);

var $String = String;
var $TypeError = TypeError;

module.exports = function (argument) {
  if (isPossiblePrototype(argument)) return argument;
  throw new $TypeError("Can't set " + $String(argument) + ' as a prototype');
};


/***/ }),

/***/ 77811:
/***/ (function(module) {


// eslint-disable-next-line es/no-typed-arrays -- safe
module.exports = typeof ArrayBuffer != 'undefined' && typeof DataView != 'undefined';


/***/ }),

/***/ 94644:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var NATIVE_ARRAY_BUFFER = __webpack_require__(77811);
var DESCRIPTORS = __webpack_require__(43724);
var globalThis = __webpack_require__(44576);
var isCallable = __webpack_require__(94901);
var isObject = __webpack_require__(20034);
var hasOwn = __webpack_require__(39297);
var classof = __webpack_require__(36955);
var tryToString = __webpack_require__(16823);
var createNonEnumerableProperty = __webpack_require__(66699);
var defineBuiltIn = __webpack_require__(36840);
var defineBuiltInAccessor = __webpack_require__(62106);
var isPrototypeOf = __webpack_require__(1625);
var getPrototypeOf = __webpack_require__(42787);
var setPrototypeOf = __webpack_require__(52967);
var wellKnownSymbol = __webpack_require__(78227);
var uid = __webpack_require__(33392);
var InternalStateModule = __webpack_require__(91181);

var enforceInternalState = InternalStateModule.enforce;
var getInternalState = InternalStateModule.get;
var Int8Array = globalThis.Int8Array;
var Int8ArrayPrototype = Int8Array && Int8Array.prototype;
var Uint8ClampedArray = globalThis.Uint8ClampedArray;
var Uint8ClampedArrayPrototype = Uint8ClampedArray && Uint8ClampedArray.prototype;
var TypedArray = Int8Array && getPrototypeOf(Int8Array);
var TypedArrayPrototype = Int8ArrayPrototype && getPrototypeOf(Int8ArrayPrototype);
var ObjectPrototype = Object.prototype;
var TypeError = globalThis.TypeError;

var TO_STRING_TAG = wellKnownSymbol('toStringTag');
var TYPED_ARRAY_TAG = uid('TYPED_ARRAY_TAG');
var TYPED_ARRAY_CONSTRUCTOR = 'TypedArrayConstructor';
// Fixing native typed arrays in Opera Presto crashes the browser, see #595
var NATIVE_ARRAY_BUFFER_VIEWS = NATIVE_ARRAY_BUFFER && !!setPrototypeOf && classof(globalThis.opera) !== 'Opera';
var TYPED_ARRAY_TAG_REQUIRED = false;
var NAME, Constructor, Prototype;

var TypedArrayConstructorsList = {
  Int8Array: 1,
  Uint8Array: 1,
  Uint8ClampedArray: 1,
  Int16Array: 2,
  Uint16Array: 2,
  Int32Array: 4,
  Uint32Array: 4,
  Float32Array: 4,
  Float64Array: 8
};

var BigIntArrayConstructorsList = {
  BigInt64Array: 8,
  BigUint64Array: 8
};

var isView = function isView(it) {
  if (!isObject(it)) return false;
  var klass = classof(it);
  return klass === 'DataView'
    || hasOwn(TypedArrayConstructorsList, klass)
    || hasOwn(BigIntArrayConstructorsList, klass);
};

var getTypedArrayConstructor = function (it) {
  var proto = getPrototypeOf(it);
  if (!isObject(proto)) return;
  var state = getInternalState(proto);
  return (state && hasOwn(state, TYPED_ARRAY_CONSTRUCTOR)) ? state[TYPED_ARRAY_CONSTRUCTOR] : getTypedArrayConstructor(proto);
};

var isTypedArray = function (it) {
  if (!isObject(it)) return false;
  var klass = classof(it);
  return hasOwn(TypedArrayConstructorsList, klass)
    || hasOwn(BigIntArrayConstructorsList, klass);
};

var aTypedArray = function (it) {
  if (isTypedArray(it)) return it;
  throw new TypeError('Target is not a typed array');
};

var aTypedArrayConstructor = function (C) {
  if (isCallable(C) && (!setPrototypeOf || isPrototypeOf(TypedArray, C))) return C;
  throw new TypeError(tryToString(C) + ' is not a typed array constructor');
};

var exportTypedArrayMethod = function (KEY, property, forced, options) {
  if (!DESCRIPTORS) return;
  if (forced) for (var ARRAY in TypedArrayConstructorsList) {
    var TypedArrayConstructor = globalThis[ARRAY];
    if (TypedArrayConstructor && hasOwn(TypedArrayConstructor.prototype, KEY)) try {
      delete TypedArrayConstructor.prototype[KEY];
    } catch (error) {
      // old WebKit bug - some methods are non-configurable
      try {
        TypedArrayConstructor.prototype[KEY] = property;
      } catch (error2) { /* empty */ }
    }
  }
  if (!TypedArrayPrototype[KEY] || forced) {
    defineBuiltIn(TypedArrayPrototype, KEY, forced ? property
      : NATIVE_ARRAY_BUFFER_VIEWS && Int8ArrayPrototype[KEY] || property, options);
  }
};

var exportTypedArrayStaticMethod = function (KEY, property, forced) {
  var ARRAY, TypedArrayConstructor;
  if (!DESCRIPTORS) return;
  if (setPrototypeOf) {
    if (forced) for (ARRAY in TypedArrayConstructorsList) {
      TypedArrayConstructor = globalThis[ARRAY];
      if (TypedArrayConstructor && hasOwn(TypedArrayConstructor, KEY)) try {
        delete TypedArrayConstructor[KEY];
      } catch (error) { /* empty */ }
    }
    if (!TypedArray[KEY] || forced) {
      // V8 ~ Chrome 49-50 `%TypedArray%` methods are non-writable non-configurable
      try {
        return defineBuiltIn(TypedArray, KEY, forced ? property : NATIVE_ARRAY_BUFFER_VIEWS && TypedArray[KEY] || property);
      } catch (error) { /* empty */ }
    } else return;
  }
  for (ARRAY in TypedArrayConstructorsList) {
    TypedArrayConstructor = globalThis[ARRAY];
    if (TypedArrayConstructor && (!TypedArrayConstructor[KEY] || forced)) {
      defineBuiltIn(TypedArrayConstructor, KEY, property);
    }
  }
};

for (NAME in TypedArrayConstructorsList) {
  Constructor = globalThis[NAME];
  Prototype = Constructor && Constructor.prototype;
  if (Prototype) enforceInternalState(Prototype)[TYPED_ARRAY_CONSTRUCTOR] = Constructor;
  else NATIVE_ARRAY_BUFFER_VIEWS = false;
}

for (NAME in BigIntArrayConstructorsList) {
  Constructor = globalThis[NAME];
  Prototype = Constructor && Constructor.prototype;
  if (Prototype) enforceInternalState(Prototype)[TYPED_ARRAY_CONSTRUCTOR] = Constructor;
}

// WebKit bug - typed arrays constructors prototype is Object.prototype
if (!NATIVE_ARRAY_BUFFER_VIEWS || !isCallable(TypedArray) || TypedArray === Function.prototype) {
  // eslint-disable-next-line no-shadow -- safe
  TypedArray = function TypedArray() {
    throw new TypeError('Incorrect invocation');
  };
  if (NATIVE_ARRAY_BUFFER_VIEWS) for (NAME in TypedArrayConstructorsList) {
    if (globalThis[NAME]) setPrototypeOf(globalThis[NAME], TypedArray);
  }
}

if (!NATIVE_ARRAY_BUFFER_VIEWS || !TypedArrayPrototype || TypedArrayPrototype === ObjectPrototype) {
  TypedArrayPrototype = TypedArray.prototype;
  if (NATIVE_ARRAY_BUFFER_VIEWS) for (NAME in TypedArrayConstructorsList) {
    if (globalThis[NAME]) setPrototypeOf(globalThis[NAME].prototype, TypedArrayPrototype);
  }
}

// WebKit bug - one more object in Uint8ClampedArray prototype chain
if (NATIVE_ARRAY_BUFFER_VIEWS && getPrototypeOf(Uint8ClampedArrayPrototype) !== TypedArrayPrototype) {
  setPrototypeOf(Uint8ClampedArrayPrototype, TypedArrayPrototype);
}

if (DESCRIPTORS && !hasOwn(TypedArrayPrototype, TO_STRING_TAG)) {
  TYPED_ARRAY_TAG_REQUIRED = true;
  defineBuiltInAccessor(TypedArrayPrototype, TO_STRING_TAG, {
    configurable: true,
    get: function () {
      return isObject(this) ? this[TYPED_ARRAY_TAG] : undefined;
    }
  });
  for (NAME in TypedArrayConstructorsList) if (globalThis[NAME]) {
    createNonEnumerableProperty(globalThis[NAME], TYPED_ARRAY_TAG, NAME);
  }
}

module.exports = {
  NATIVE_ARRAY_BUFFER_VIEWS: NATIVE_ARRAY_BUFFER_VIEWS,
  TYPED_ARRAY_TAG: TYPED_ARRAY_TAG_REQUIRED && TYPED_ARRAY_TAG,
  aTypedArray: aTypedArray,
  aTypedArrayConstructor: aTypedArrayConstructor,
  exportTypedArrayMethod: exportTypedArrayMethod,
  exportTypedArrayStaticMethod: exportTypedArrayStaticMethod,
  getTypedArrayConstructor: getTypedArrayConstructor,
  isView: isView,
  isTypedArray: isTypedArray,
  TypedArray: TypedArray,
  TypedArrayPrototype: TypedArrayPrototype
};


/***/ }),

/***/ 12211:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var fails = __webpack_require__(79039);

module.exports = !fails(function () {
  function F() { /* empty */ }
  F.prototype.constructor = null;
  // eslint-disable-next-line es/no-object-getprototypeof -- required for testing
  return Object.getPrototypeOf(new F()) !== F.prototype;
});


/***/ }),

/***/ 62106:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var makeBuiltIn = __webpack_require__(50283);
var defineProperty = __webpack_require__(24913);

module.exports = function (target, name, descriptor) {
  if (descriptor.get) makeBuiltIn(descriptor.get, name, { getter: true });
  if (descriptor.set) makeBuiltIn(descriptor.set, name, { setter: true });
  return defineProperty.f(target, name, descriptor);
};


/***/ }),

/***/ 46706:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var uncurryThis = __webpack_require__(79504);
var aCallable = __webpack_require__(79306);

module.exports = function (object, key, method) {
  try {
    // eslint-disable-next-line es/no-object-getownpropertydescriptor -- safe
    return uncurryThis(aCallable(Object.getOwnPropertyDescriptor(object, key)[method]));
  } catch (error) { /* empty */ }
};


/***/ }),

/***/ 13925:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var isObject = __webpack_require__(20034);

module.exports = function (argument) {
  return isObject(argument) || argument === null;
};


/***/ }),

/***/ 42787:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var hasOwn = __webpack_require__(39297);
var isCallable = __webpack_require__(94901);
var toObject = __webpack_require__(48981);
var sharedKey = __webpack_require__(66119);
var CORRECT_PROTOTYPE_GETTER = __webpack_require__(12211);

var IE_PROTO = sharedKey('IE_PROTO');
var $Object = Object;
var ObjectPrototype = $Object.prototype;

// `Object.getPrototypeOf` method
// https://tc39.es/ecma262/#sec-object.getprototypeof
// eslint-disable-next-line es/no-object-getprototypeof -- safe
module.exports = CORRECT_PROTOTYPE_GETTER ? $Object.getPrototypeOf : function (O) {
  var object = toObject(O);
  if (hasOwn(object, IE_PROTO)) return object[IE_PROTO];
  var constructor = object.constructor;
  if (isCallable(constructor) && object instanceof constructor) {
    return constructor.prototype;
  } return object instanceof $Object ? ObjectPrototype : null;
};


/***/ }),

/***/ 52967:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


/* eslint-disable no-proto -- safe */
var uncurryThisAccessor = __webpack_require__(46706);
var isObject = __webpack_require__(20034);
var requireObjectCoercible = __webpack_require__(67750);
var aPossiblePrototype = __webpack_require__(73506);

// `Object.setPrototypeOf` method
// https://tc39.es/ecma262/#sec-object.setprototypeof
// Works with __proto__ only. Old v8 can't work with null proto objects.
// eslint-disable-next-line es/no-object-setprototypeof -- safe
module.exports = Object.setPrototypeOf || ('__proto__' in {} ? function () {
  var CORRECT_SETTER = false;
  var test = {};
  var setter;
  try {
    setter = uncurryThisAccessor(Object.prototype, '__proto__', 'set');
    setter(test, []);
    CORRECT_SETTER = test instanceof Array;
  } catch (error) { /* empty */ }
  return function setPrototypeOf(O, proto) {
    requireObjectCoercible(O);
    aPossiblePrototype(proto);
    if (!isObject(O)) return O;
    if (CORRECT_SETTER) setter(O, proto);
    else O.__proto__ = proto;
    return O;
  };
}() : undefined);


/***/ }),

/***/ 58229:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var toPositiveInteger = __webpack_require__(99590);

var $RangeError = RangeError;

module.exports = function (it, BYTES) {
  var offset = toPositiveInteger(it);
  if (offset % BYTES) throw new $RangeError('Wrong offset');
  return offset;
};


/***/ }),

/***/ 99590:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var toIntegerOrInfinity = __webpack_require__(91291);

var $RangeError = RangeError;

module.exports = function (it) {
  var result = toIntegerOrInfinity(it);
  if (result < 0) throw new $RangeError("The argument can't be less than 0");
  return result;
};


/***/ }),

/***/ 28845:
/***/ (function(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {


var globalThis = __webpack_require__(44576);
var call = __webpack_require__(69565);
var ArrayBufferViewCore = __webpack_require__(94644);
var lengthOfArrayLike = __webpack_require__(26198);
var toOffset = __webpack_require__(58229);
var toIndexedObject = __webpack_require__(48981);
var fails = __webpack_require__(79039);

var RangeError = globalThis.RangeError;
var Int8Array = globalThis.Int8Array;
var Int8ArrayPrototype = Int8Array && Int8Array.prototype;
var $set = Int8ArrayPrototype && Int8ArrayPrototype.set;
var aTypedArray = ArrayBufferViewCore.aTypedArray;
var exportTypedArrayMethod = ArrayBufferViewCore.exportTypedArrayMethod;

var WORKS_WITH_OBJECTS_AND_GENERIC_ON_TYPED_ARRAYS = !fails(function () {
  // eslint-disable-next-line es/no-typed-arrays -- required for testing
  var array = new Uint8ClampedArray(2);
  call($set, array, { length: 1, 0: 3 }, 1);
  return array[1] !== 3;
});

// https://bugs.chromium.org/p/v8/issues/detail?id=11294 and other
var TO_OBJECT_BUG = WORKS_WITH_OBJECTS_AND_GENERIC_ON_TYPED_ARRAYS && ArrayBufferViewCore.NATIVE_ARRAY_BUFFER_VIEWS && fails(function () {
  var array = new Int8Array(2);
  array.set(1);
  array.set('2', 1);
  return array[0] !== 0 || array[1] !== 2;
});

// `%TypedArray%.prototype.set` method
// https://tc39.es/ecma262/#sec-%typedarray%.prototype.set
exportTypedArrayMethod('set', function set(arrayLike /* , offset */) {
  aTypedArray(this);
  var offset = toOffset(arguments.length > 1 ? arguments[1] : undefined, 1);
  var src = toIndexedObject(arrayLike);
  if (WORKS_WITH_OBJECTS_AND_GENERIC_ON_TYPED_ARRAYS) return call($set, this, src, offset);
  var length = this.length;
  var len = lengthOfArrayLike(src);
  var index = 0;
  if (len + offset > length) throw new RangeError('Wrong length');
  while (index < len) this[offset + index] = src[index++];
}, !WORKS_WITH_OBJECTS_AND_GENERIC_ON_TYPED_ARRAYS || TO_OBJECT_BUG);


/***/ }),

/***/ 373:
/***/ (function(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {


var globalThis = __webpack_require__(44576);
var uncurryThis = __webpack_require__(27476);
var fails = __webpack_require__(79039);
var aCallable = __webpack_require__(79306);
var internalSort = __webpack_require__(74488);
var ArrayBufferViewCore = __webpack_require__(94644);
var FF = __webpack_require__(13709);
var IE_OR_EDGE = __webpack_require__(13763);
var V8 = __webpack_require__(39519);
var WEBKIT = __webpack_require__(3607);

var aTypedArray = ArrayBufferViewCore.aTypedArray;
var exportTypedArrayMethod = ArrayBufferViewCore.exportTypedArrayMethod;
var Uint16Array = globalThis.Uint16Array;
var nativeSort = Uint16Array && uncurryThis(Uint16Array.prototype.sort);

// WebKit
var ACCEPT_INCORRECT_ARGUMENTS = !!nativeSort && !(fails(function () {
  nativeSort(new Uint16Array(2), null);
}) && fails(function () {
  nativeSort(new Uint16Array(2), {});
}));

var STABLE_SORT = !!nativeSort && !fails(function () {
  // feature detection can be too slow, so check engines versions
  if (V8) return V8 < 74;
  if (FF) return FF < 67;
  if (IE_OR_EDGE) return true;
  if (WEBKIT) return WEBKIT < 602;

  var array = new Uint16Array(516);
  var expected = Array(516);
  var index, mod;

  for (index = 0; index < 516; index++) {
    mod = index % 4;
    array[index] = 515 - index;
    expected[index] = index - 2 * mod + 3;
  }

  nativeSort(array, function (a, b) {
    return (a / 4 | 0) - (b / 4 | 0);
  });

  for (index = 0; index < 516; index++) {
    if (array[index] !== expected[index]) return true;
  }
});

var getSortCompare = function (comparefn) {
  return function (x, y) {
    if (comparefn !== undefined) return +comparefn(x, y) || 0;
    // eslint-disable-next-line no-self-compare -- NaN check
    if (y !== y) return -1;
    // eslint-disable-next-line no-self-compare -- NaN check
    if (x !== x) return 1;
    if (x === 0 && y === 0) return 1 / x > 0 && 1 / y < 0 ? 1 : -1;
    return x > y;
  };
};

// `%TypedArray%.prototype.sort` method
// https://tc39.es/ecma262/#sec-%typedarray%.prototype.sort
exportTypedArrayMethod('sort', function sort(comparefn) {
  if (comparefn !== undefined) aCallable(comparefn);
  if (STABLE_SORT) return nativeSort(this, comparefn);

  return internalSort(aTypedArray(this), getSortCompare(comparefn));
}, !STABLE_SORT || ACCEPT_INCORRECT_ARGUMENTS);


/***/ }),

/***/ 46762:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $f: function() { return /* binding */ selectTextblockStart; },
/* harmony export */   G2: function() { return /* binding */ joinUp; },
/* harmony export */   I$: function() { return /* binding */ exitCode; },
/* harmony export */   Im: function() { return /* binding */ wrapIn; },
/* harmony export */   Qv: function() { return /* binding */ joinBackward; },
/* harmony export */   Sd: function() { return /* binding */ selectNodeForward; },
/* harmony export */   Z1: function() { return /* binding */ createParagraphNear; },
/* harmony export */   _G: function() { return /* binding */ joinTextblockForward; },
/* harmony export */   _e: function() { return /* binding */ selectNodeBackward; },
/* harmony export */   bh: function() { return /* binding */ joinDown; },
/* harmony export */   eB: function() { return /* binding */ joinTextblockBackward; },
/* harmony export */   eT: function() { return /* binding */ joinForward; },
/* harmony export */   ec: function() { return /* binding */ selectTextblockEnd; },
/* harmony export */   hy: function() { return /* binding */ selectParentNode; },
/* harmony export */   ic: function() { return /* binding */ deleteSelection; },
/* harmony export */   iz: function() { return /* binding */ liftEmptyBlock; },
/* harmony export */   pC: function() { return /* binding */ newlineInCode; },
/* harmony export */   yY: function() { return /* binding */ lift; },
/* harmony export */   y_: function() { return /* binding */ setBlockType; }
/* harmony export */ });
/* unused harmony exports autoJoin, baseKeymap, chainCommands, macBaseKeymap, pcBaseKeymap, selectAll, splitBlock, splitBlockAs, splitBlockKeepMarks, toggleMark */
/* harmony import */ var prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(38262);
/* harmony import */ var prosemirror_model__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(58903);
/* harmony import */ var prosemirror_state__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(42845);




/**
Delete the selection, if there is one.
*/
const deleteSelection = (state, dispatch) => {
    if (state.selection.empty)
        return false;
    if (dispatch)
        dispatch(state.tr.deleteSelection().scrollIntoView());
    return true;
};
function atBlockStart(state, view) {
    let { $cursor } = state.selection;
    if (!$cursor || (view ? !view.endOfTextblock("backward", state)
        : $cursor.parentOffset > 0))
        return null;
    return $cursor;
}
/**
If the selection is empty and at the start of a textblock, try to
reduce the distance between that block and the one before it—if
there's a block directly before it that can be joined, join them.
If not, try to move the selected block closer to the next one in
the document structure by lifting it out of its parent or moving it
into a parent of the previous block. Will use the view for accurate
(bidi-aware) start-of-textblock detection if given.
*/
const joinBackward = (state, dispatch, view) => {
    let $cursor = atBlockStart(state, view);
    if (!$cursor)
        return false;
    let $cut = findCutBefore($cursor);
    // If there is no node before this, try to lift
    if (!$cut) {
        let range = $cursor.blockRange(), target = range && (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .liftTarget */ .jP)(range);
        if (target == null)
            return false;
        if (dispatch)
            dispatch(state.tr.lift(range, target).scrollIntoView());
        return true;
    }
    let before = $cut.nodeBefore;
    // Apply the joining algorithm
    if (deleteBarrier(state, $cut, dispatch, -1))
        return true;
    // If the node below has no content and the node above is
    // selectable, delete the node below and select the one above.
    if ($cursor.parent.content.size == 0 &&
        (textblockAt(before, "end") || prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.isSelectable(before))) {
        for (let depth = $cursor.depth;; depth--) {
            let delStep = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .replaceStep */ .$L)(state.doc, $cursor.before(depth), $cursor.after(depth), prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Slice */ .Ji.empty);
            if (delStep && delStep.slice.size < delStep.to - delStep.from) {
                if (dispatch) {
                    let tr = state.tr.step(delStep);
                    tr.setSelection(textblockAt(before, "end")
                        ? prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .Selection */ .LN.findFrom(tr.doc.resolve(tr.mapping.map($cut.pos, -1)), -1)
                        : prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.create(tr.doc, $cut.pos - before.nodeSize));
                    dispatch(tr.scrollIntoView());
                }
                return true;
            }
            if (depth == 1 || $cursor.node(depth - 1).childCount > 1)
                break;
        }
    }
    // If the node before is an atom, delete it
    if (before.isAtom && $cut.depth == $cursor.depth - 1) {
        if (dispatch)
            dispatch(state.tr.delete($cut.pos - before.nodeSize, $cut.pos).scrollIntoView());
        return true;
    }
    return false;
};
/**
A more limited form of [`joinBackward`](https://prosemirror.net/docs/ref/#commands.joinBackward)
that only tries to join the current textblock to the one before
it, if the cursor is at the start of a textblock.
*/
const joinTextblockBackward = (state, dispatch, view) => {
    let $cursor = atBlockStart(state, view);
    if (!$cursor)
        return false;
    let $cut = findCutBefore($cursor);
    return $cut ? joinTextblocksAround(state, $cut, dispatch) : false;
};
/**
A more limited form of [`joinForward`](https://prosemirror.net/docs/ref/#commands.joinForward)
that only tries to join the current textblock to the one after
it, if the cursor is at the end of a textblock.
*/
const joinTextblockForward = (state, dispatch, view) => {
    let $cursor = atBlockEnd(state, view);
    if (!$cursor)
        return false;
    let $cut = findCutAfter($cursor);
    return $cut ? joinTextblocksAround(state, $cut, dispatch) : false;
};
function joinTextblocksAround(state, $cut, dispatch) {
    let before = $cut.nodeBefore, beforeText = before, beforePos = $cut.pos - 1;
    for (; !beforeText.isTextblock; beforePos--) {
        if (beforeText.type.spec.isolating)
            return false;
        let child = beforeText.lastChild;
        if (!child)
            return false;
        beforeText = child;
    }
    let after = $cut.nodeAfter, afterText = after, afterPos = $cut.pos + 1;
    for (; !afterText.isTextblock; afterPos++) {
        if (afterText.type.spec.isolating)
            return false;
        let child = afterText.firstChild;
        if (!child)
            return false;
        afterText = child;
    }
    let step = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .replaceStep */ .$L)(state.doc, beforePos, afterPos, prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Slice */ .Ji.empty);
    if (!step || step.from != beforePos ||
        step instanceof prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .ReplaceStep */ .Ln && step.slice.size >= afterPos - beforePos)
        return false;
    if (dispatch) {
        let tr = state.tr.step(step);
        tr.setSelection(prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .TextSelection */ .U3.create(tr.doc, beforePos));
        dispatch(tr.scrollIntoView());
    }
    return true;
}
function textblockAt(node, side, only = false) {
    for (let scan = node; scan; scan = (side == "start" ? scan.firstChild : scan.lastChild)) {
        if (scan.isTextblock)
            return true;
        if (only && scan.childCount != 1)
            return false;
    }
    return false;
}
/**
When the selection is empty and at the start of a textblock, select
the node before that textblock, if possible. This is intended to be
bound to keys like backspace, after
[`joinBackward`](https://prosemirror.net/docs/ref/#commands.joinBackward) or other deleting
commands, as a fall-back behavior when the schema doesn't allow
deletion at the selected point.
*/
const selectNodeBackward = (state, dispatch, view) => {
    let { $head, empty } = state.selection, $cut = $head;
    if (!empty)
        return false;
    if ($head.parent.isTextblock) {
        if (view ? !view.endOfTextblock("backward", state) : $head.parentOffset > 0)
            return false;
        $cut = findCutBefore($head);
    }
    let node = $cut && $cut.nodeBefore;
    if (!node || !prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.isSelectable(node))
        return false;
    if (dispatch)
        dispatch(state.tr.setSelection(prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.create(state.doc, $cut.pos - node.nodeSize)).scrollIntoView());
    return true;
};
function findCutBefore($pos) {
    if (!$pos.parent.type.spec.isolating)
        for (let i = $pos.depth - 1; i >= 0; i--) {
            if ($pos.index(i) > 0)
                return $pos.doc.resolve($pos.before(i + 1));
            if ($pos.node(i).type.spec.isolating)
                break;
        }
    return null;
}
function atBlockEnd(state, view) {
    let { $cursor } = state.selection;
    if (!$cursor || (view ? !view.endOfTextblock("forward", state)
        : $cursor.parentOffset < $cursor.parent.content.size))
        return null;
    return $cursor;
}
/**
If the selection is empty and the cursor is at the end of a
textblock, try to reduce or remove the boundary between that block
and the one after it, either by joining them or by moving the other
block closer to this one in the tree structure. Will use the view
for accurate start-of-textblock detection if given.
*/
const joinForward = (state, dispatch, view) => {
    let $cursor = atBlockEnd(state, view);
    if (!$cursor)
        return false;
    let $cut = findCutAfter($cursor);
    // If there is no node after this, there's nothing to do
    if (!$cut)
        return false;
    let after = $cut.nodeAfter;
    // Try the joining algorithm
    if (deleteBarrier(state, $cut, dispatch, 1))
        return true;
    // If the node above has no content and the node below is
    // selectable, delete the node above and select the one below.
    if ($cursor.parent.content.size == 0 &&
        (textblockAt(after, "start") || prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.isSelectable(after))) {
        let delStep = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .replaceStep */ .$L)(state.doc, $cursor.before(), $cursor.after(), prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Slice */ .Ji.empty);
        if (delStep && delStep.slice.size < delStep.to - delStep.from) {
            if (dispatch) {
                let tr = state.tr.step(delStep);
                tr.setSelection(textblockAt(after, "start") ? prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .Selection */ .LN.findFrom(tr.doc.resolve(tr.mapping.map($cut.pos)), 1)
                    : prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.create(tr.doc, tr.mapping.map($cut.pos)));
                dispatch(tr.scrollIntoView());
            }
            return true;
        }
    }
    // If the next node is an atom, delete it
    if (after.isAtom && $cut.depth == $cursor.depth - 1) {
        if (dispatch)
            dispatch(state.tr.delete($cut.pos, $cut.pos + after.nodeSize).scrollIntoView());
        return true;
    }
    return false;
};
/**
When the selection is empty and at the end of a textblock, select
the node coming after that textblock, if possible. This is intended
to be bound to keys like delete, after
[`joinForward`](https://prosemirror.net/docs/ref/#commands.joinForward) and similar deleting
commands, to provide a fall-back behavior when the schema doesn't
allow deletion at the selected point.
*/
const selectNodeForward = (state, dispatch, view) => {
    let { $head, empty } = state.selection, $cut = $head;
    if (!empty)
        return false;
    if ($head.parent.isTextblock) {
        if (view ? !view.endOfTextblock("forward", state) : $head.parentOffset < $head.parent.content.size)
            return false;
        $cut = findCutAfter($head);
    }
    let node = $cut && $cut.nodeAfter;
    if (!node || !prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.isSelectable(node))
        return false;
    if (dispatch)
        dispatch(state.tr.setSelection(prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.create(state.doc, $cut.pos)).scrollIntoView());
    return true;
};
function findCutAfter($pos) {
    if (!$pos.parent.type.spec.isolating)
        for (let i = $pos.depth - 1; i >= 0; i--) {
            let parent = $pos.node(i);
            if ($pos.index(i) + 1 < parent.childCount)
                return $pos.doc.resolve($pos.after(i + 1));
            if (parent.type.spec.isolating)
                break;
        }
    return null;
}
/**
Join the selected block or, if there is a text selection, the
closest ancestor block of the selection that can be joined, with
the sibling above it.
*/
const joinUp = (state, dispatch) => {
    let sel = state.selection, nodeSel = sel instanceof prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh, point;
    if (nodeSel) {
        if (sel.node.isTextblock || !(0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .canJoin */ .n9)(state.doc, sel.from))
            return false;
        point = sel.from;
    }
    else {
        point = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .joinPoint */ .N0)(state.doc, sel.from, -1);
        if (point == null)
            return false;
    }
    if (dispatch) {
        let tr = state.tr.join(point);
        if (nodeSel)
            tr.setSelection(prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.create(tr.doc, point - state.doc.resolve(point).nodeBefore.nodeSize));
        dispatch(tr.scrollIntoView());
    }
    return true;
};
/**
Join the selected block, or the closest ancestor of the selection
that can be joined, with the sibling after it.
*/
const joinDown = (state, dispatch) => {
    let sel = state.selection, point;
    if (sel instanceof prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh) {
        if (sel.node.isTextblock || !(0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .canJoin */ .n9)(state.doc, sel.to))
            return false;
        point = sel.to;
    }
    else {
        point = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .joinPoint */ .N0)(state.doc, sel.to, 1);
        if (point == null)
            return false;
    }
    if (dispatch)
        dispatch(state.tr.join(point).scrollIntoView());
    return true;
};
/**
Lift the selected block, or the closest ancestor block of the
selection that can be lifted, out of its parent node.
*/
const lift = (state, dispatch) => {
    let { $from, $to } = state.selection;
    let range = $from.blockRange($to), target = range && (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .liftTarget */ .jP)(range);
    if (target == null)
        return false;
    if (dispatch)
        dispatch(state.tr.lift(range, target).scrollIntoView());
    return true;
};
/**
If the selection is in a node whose type has a truthy
[`code`](https://prosemirror.net/docs/ref/#model.NodeSpec.code) property in its spec, replace the
selection with a newline character.
*/
const newlineInCode = (state, dispatch) => {
    let { $head, $anchor } = state.selection;
    if (!$head.parent.type.spec.code || !$head.sameParent($anchor))
        return false;
    if (dispatch)
        dispatch(state.tr.insertText("\n").scrollIntoView());
    return true;
};
function defaultBlockAt(match) {
    for (let i = 0; i < match.edgeCount; i++) {
        let { type } = match.edge(i);
        if (type.isTextblock && !type.hasRequiredAttrs())
            return type;
    }
    return null;
}
/**
When the selection is in a node with a truthy
[`code`](https://prosemirror.net/docs/ref/#model.NodeSpec.code) property in its spec, create a
default block after the code block, and move the cursor there.
*/
const exitCode = (state, dispatch) => {
    let { $head, $anchor } = state.selection;
    if (!$head.parent.type.spec.code || !$head.sameParent($anchor))
        return false;
    let above = $head.node(-1), after = $head.indexAfter(-1), type = defaultBlockAt(above.contentMatchAt(after));
    if (!type || !above.canReplaceWith(after, after, type))
        return false;
    if (dispatch) {
        let pos = $head.after(), tr = state.tr.replaceWith(pos, pos, type.createAndFill());
        tr.setSelection(prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .Selection */ .LN.near(tr.doc.resolve(pos), 1));
        dispatch(tr.scrollIntoView());
    }
    return true;
};
/**
If a block node is selected, create an empty paragraph before (if
it is its parent's first child) or after it.
*/
const createParagraphNear = (state, dispatch) => {
    let sel = state.selection, { $from, $to } = sel;
    if (sel instanceof prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .AllSelection */ .i5 || $from.parent.inlineContent || $to.parent.inlineContent)
        return false;
    let type = defaultBlockAt($to.parent.contentMatchAt($to.indexAfter()));
    if (!type || !type.isTextblock)
        return false;
    if (dispatch) {
        let side = (!$from.parentOffset && $to.index() < $to.parent.childCount ? $from : $to).pos;
        let tr = state.tr.insert(side, type.createAndFill());
        tr.setSelection(prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .TextSelection */ .U3.create(tr.doc, side + 1));
        dispatch(tr.scrollIntoView());
    }
    return true;
};
/**
If the cursor is in an empty textblock that can be lifted, lift the
block.
*/
const liftEmptyBlock = (state, dispatch) => {
    let { $cursor } = state.selection;
    if (!$cursor || $cursor.parent.content.size)
        return false;
    if ($cursor.depth > 1 && $cursor.after() != $cursor.end(-1)) {
        let before = $cursor.before();
        if ((0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .canSplit */ .zy)(state.doc, before)) {
            if (dispatch)
                dispatch(state.tr.split(before).scrollIntoView());
            return true;
        }
    }
    let range = $cursor.blockRange(), target = range && (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .liftTarget */ .jP)(range);
    if (target == null)
        return false;
    if (dispatch)
        dispatch(state.tr.lift(range, target).scrollIntoView());
    return true;
};
/**
Create a variant of [`splitBlock`](https://prosemirror.net/docs/ref/#commands.splitBlock) that uses
a custom function to determine the type of the newly split off block.
*/
function splitBlockAs(splitNode) {
    return (state, dispatch) => {
        let { $from, $to } = state.selection;
        if (state.selection instanceof prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh && state.selection.node.isBlock) {
            if (!$from.parentOffset || !(0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .canSplit */ .zy)(state.doc, $from.pos))
                return false;
            if (dispatch)
                dispatch(state.tr.split($from.pos).scrollIntoView());
            return true;
        }
        if (!$from.depth)
            return false;
        let types = [];
        let splitDepth, deflt, atEnd = false, atStart = false;
        for (let d = $from.depth;; d--) {
            let node = $from.node(d);
            if (node.isBlock) {
                atEnd = $from.end(d) == $from.pos + ($from.depth - d);
                atStart = $from.start(d) == $from.pos - ($from.depth - d);
                deflt = defaultBlockAt($from.node(d - 1).contentMatchAt($from.indexAfter(d - 1)));
                let splitType = splitNode && splitNode($to.parent, atEnd, $from);
                types.unshift(splitType || (atEnd && deflt ? { type: deflt } : null));
                splitDepth = d;
                break;
            }
            else {
                if (d == 1)
                    return false;
                types.unshift(null);
            }
        }
        let tr = state.tr;
        if (state.selection instanceof prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .TextSelection */ .U3 || state.selection instanceof prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .AllSelection */ .i5)
            tr.deleteSelection();
        let splitPos = tr.mapping.map($from.pos);
        let can = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .canSplit */ .zy)(tr.doc, splitPos, types.length, types);
        if (!can) {
            types[0] = deflt ? { type: deflt } : null;
            can = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .canSplit */ .zy)(tr.doc, splitPos, types.length, types);
        }
        if (!can)
            return false;
        tr.split(splitPos, types.length, types);
        if (!atEnd && atStart && $from.node(splitDepth).type != deflt) {
            let first = tr.mapping.map($from.before(splitDepth)), $first = tr.doc.resolve(first);
            if (deflt && $from.node(splitDepth - 1).canReplaceWith($first.index(), $first.index() + 1, deflt))
                tr.setNodeMarkup(tr.mapping.map($from.before(splitDepth)), deflt);
        }
        if (dispatch)
            dispatch(tr.scrollIntoView());
        return true;
    };
}
/**
Split the parent block of the selection. If the selection is a text
selection, also delete its content.
*/
const splitBlock = splitBlockAs();
/**
Acts like [`splitBlock`](https://prosemirror.net/docs/ref/#commands.splitBlock), but without
resetting the set of active marks at the cursor.
*/
const splitBlockKeepMarks = (state, dispatch) => {
    return splitBlock(state, dispatch && (tr => {
        let marks = state.storedMarks || (state.selection.$to.parentOffset && state.selection.$from.marks());
        if (marks)
            tr.ensureMarks(marks);
        dispatch(tr);
    }));
};
/**
Move the selection to the node wrapping the current selection, if
any. (Will not select the document node.)
*/
const selectParentNode = (state, dispatch) => {
    let { $from, to } = state.selection, pos;
    let same = $from.sharedDepth(to);
    if (same == 0)
        return false;
    pos = $from.before(same);
    if (dispatch)
        dispatch(state.tr.setSelection(prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .NodeSelection */ .nh.create(state.doc, pos)));
    return true;
};
/**
Select the whole document.
*/
const selectAll = (state, dispatch) => {
    if (dispatch)
        dispatch(state.tr.setSelection(new prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .AllSelection */ .i5(state.doc)));
    return true;
};
function joinMaybeClear(state, $pos, dispatch) {
    let before = $pos.nodeBefore, after = $pos.nodeAfter, index = $pos.index();
    if (!before || !after || !before.type.compatibleContent(after.type))
        return false;
    if (!before.content.size && $pos.parent.canReplace(index - 1, index)) {
        if (dispatch)
            dispatch(state.tr.delete($pos.pos - before.nodeSize, $pos.pos).scrollIntoView());
        return true;
    }
    if (!$pos.parent.canReplace(index, index + 1) || !(after.isTextblock || (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .canJoin */ .n9)(state.doc, $pos.pos)))
        return false;
    if (dispatch)
        dispatch(state.tr.join($pos.pos).scrollIntoView());
    return true;
}
function deleteBarrier(state, $cut, dispatch, dir) {
    let before = $cut.nodeBefore, after = $cut.nodeAfter, conn, match;
    let isolated = before.type.spec.isolating || after.type.spec.isolating;
    if (!isolated && joinMaybeClear(state, $cut, dispatch))
        return true;
    let canDelAfter = !isolated && $cut.parent.canReplace($cut.index(), $cut.index() + 1);
    if (canDelAfter &&
        (conn = (match = before.contentMatchAt(before.childCount)).findWrapping(after.type)) &&
        match.matchType(conn[0] || after.type).validEnd) {
        if (dispatch) {
            let end = $cut.pos + after.nodeSize, wrap = prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Fragment */ .FK.empty;
            for (let i = conn.length - 1; i >= 0; i--)
                wrap = prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Fragment */ .FK.from(conn[i].create(null, wrap));
            wrap = prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Fragment */ .FK.from(before.copy(wrap));
            let tr = state.tr.step(new prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .ReplaceAroundStep */ .Wg($cut.pos - 1, end, $cut.pos, end, new prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Slice */ .Ji(wrap, 1, 0), conn.length, true));
            let $joinAt = tr.doc.resolve(end + 2 * conn.length);
            if ($joinAt.nodeAfter && $joinAt.nodeAfter.type == before.type &&
                (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .canJoin */ .n9)(tr.doc, $joinAt.pos))
                tr.join($joinAt.pos);
            dispatch(tr.scrollIntoView());
        }
        return true;
    }
    let selAfter = after.type.spec.isolating || (dir > 0 && isolated) ? null : prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .Selection */ .LN.findFrom($cut, 1);
    let range = selAfter && selAfter.$from.blockRange(selAfter.$to), target = range && (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .liftTarget */ .jP)(range);
    if (target != null && target >= $cut.depth) {
        if (dispatch)
            dispatch(state.tr.lift(range, target).scrollIntoView());
        return true;
    }
    if (canDelAfter && textblockAt(after, "start", true) && textblockAt(before, "end")) {
        let at = before, wrap = [];
        for (;;) {
            wrap.push(at);
            if (at.isTextblock)
                break;
            at = at.lastChild;
        }
        let afterText = after, afterDepth = 1;
        for (; !afterText.isTextblock; afterText = afterText.firstChild)
            afterDepth++;
        if (at.canReplace(at.childCount, at.childCount, afterText.content)) {
            if (dispatch) {
                let end = prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Fragment */ .FK.empty;
                for (let i = wrap.length - 1; i >= 0; i--)
                    end = prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Fragment */ .FK.from(wrap[i].copy(end));
                let tr = state.tr.step(new prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .ReplaceAroundStep */ .Wg($cut.pos - wrap.length, $cut.pos + after.nodeSize, $cut.pos + afterDepth, $cut.pos + after.nodeSize - afterDepth, new prosemirror_model__WEBPACK_IMPORTED_MODULE_2__/* .Slice */ .Ji(end, wrap.length, 0), 0, true));
                dispatch(tr.scrollIntoView());
            }
            return true;
        }
    }
    return false;
}
function selectTextblockSide(side) {
    return function (state, dispatch) {
        let sel = state.selection, $pos = side < 0 ? sel.$from : sel.$to;
        let depth = $pos.depth;
        while ($pos.node(depth).isInline) {
            if (!depth)
                return false;
            depth--;
        }
        if (!$pos.node(depth).isTextblock)
            return false;
        if (dispatch)
            dispatch(state.tr.setSelection(prosemirror_state__WEBPACK_IMPORTED_MODULE_1__/* .TextSelection */ .U3.create(state.doc, side < 0 ? $pos.start(depth) : $pos.end(depth))));
        return true;
    };
}
/**
Moves the cursor to the start of current text block.
*/
const selectTextblockStart = selectTextblockSide(-1);
/**
Moves the cursor to the end of current text block.
*/
const selectTextblockEnd = selectTextblockSide(1);
// Parameterized commands
/**
Wrap the selection in a node of the given type with the given
attributes.
*/
function wrapIn(nodeType, attrs = null) {
    return function (state, dispatch) {
        let { $from, $to } = state.selection;
        let range = $from.blockRange($to), wrapping = range && (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_0__/* .findWrapping */ .oM)(range, nodeType, attrs);
        if (!wrapping)
            return false;
        if (dispatch)
            dispatch(state.tr.wrap(range, wrapping).scrollIntoView());
        return true;
    };
}
/**
Returns a command that tries to set the selected textblocks to the
given node type with the given attributes.
*/
function setBlockType(nodeType, attrs = null) {
    return function (state, dispatch) {
        let applicable = false;
        for (let i = 0; i < state.selection.ranges.length && !applicable; i++) {
            let { $from: { pos: from }, $to: { pos: to } } = state.selection.ranges[i];
            state.doc.nodesBetween(from, to, (node, pos) => {
                if (applicable)
                    return false;
                if (!node.isTextblock || node.hasMarkup(nodeType, attrs))
                    return;
                if (node.type == nodeType) {
                    applicable = true;
                }
                else {
                    let $pos = state.doc.resolve(pos), index = $pos.index();
                    applicable = $pos.parent.canReplaceWith(index, index + 1, nodeType);
                }
            });
        }
        if (!applicable)
            return false;
        if (dispatch) {
            let tr = state.tr;
            for (let i = 0; i < state.selection.ranges.length; i++) {
                let { $from: { pos: from }, $to: { pos: to } } = state.selection.ranges[i];
                tr.setBlockType(from, to, nodeType, attrs);
            }
            dispatch(tr.scrollIntoView());
        }
        return true;
    };
}
function markApplies(doc, ranges, type, enterAtoms) {
    for (let i = 0; i < ranges.length; i++) {
        let { $from, $to } = ranges[i];
        let can = $from.depth == 0 ? doc.inlineContent && doc.type.allowsMarkType(type) : false;
        doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            if (can || !enterAtoms && node.isAtom && node.isInline && pos >= $from.pos && pos + node.nodeSize <= $to.pos)
                return false;
            can = node.inlineContent && node.type.allowsMarkType(type);
        });
        if (can)
            return true;
    }
    return false;
}
function removeInlineAtoms(ranges) {
    let result = [];
    for (let i = 0; i < ranges.length; i++) {
        let { $from, $to } = ranges[i];
        $from.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            if (node.isAtom && node.content.size && node.isInline && pos >= $from.pos && pos + node.nodeSize <= $to.pos) {
                if (pos + 1 > $from.pos)
                    result.push(new SelectionRange($from, $from.doc.resolve(pos + 1)));
                $from = $from.doc.resolve(pos + 1 + node.content.size);
                return false;
            }
        });
        if ($from.pos < $to.pos)
            result.push(new SelectionRange($from, $to));
    }
    return result;
}
/**
Create a command function that toggles the given mark with the
given attributes. Will return `false` when the current selection
doesn't support that mark. This will remove the mark if any marks
of that type exist in the selection, or add it otherwise. If the
selection is empty, this applies to the [stored
marks](https://prosemirror.net/docs/ref/#state.EditorState.storedMarks) instead of a range of the
document.
*/
function toggleMark(markType, attrs = null, options) {
    let removeWhenPresent = (options && options.removeWhenPresent) !== false;
    let enterAtoms = (options && options.enterInlineAtoms) !== false;
    let dropSpace = !(options && options.includeWhitespace);
    return function (state, dispatch) {
        let { empty, $cursor, ranges } = state.selection;
        if ((empty && !$cursor) || !markApplies(state.doc, ranges, markType, enterAtoms))
            return false;
        if (dispatch) {
            if ($cursor) {
                if (markType.isInSet(state.storedMarks || $cursor.marks()))
                    dispatch(state.tr.removeStoredMark(markType));
                else
                    dispatch(state.tr.addStoredMark(markType.create(attrs)));
            }
            else {
                let add, tr = state.tr;
                if (!enterAtoms)
                    ranges = removeInlineAtoms(ranges);
                if (removeWhenPresent) {
                    add = !ranges.some(r => state.doc.rangeHasMark(r.$from.pos, r.$to.pos, markType));
                }
                else {
                    add = !ranges.every(r => {
                        let missing = false;
                        tr.doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos, parent) => {
                            if (missing)
                                return false;
                            missing = !markType.isInSet(node.marks) && !!parent && parent.type.allowsMarkType(markType) &&
                                !(node.isText && /^\s*$/.test(node.textBetween(Math.max(0, r.$from.pos - pos), Math.min(node.nodeSize, r.$to.pos - pos))));
                        });
                        return !missing;
                    });
                }
                for (let i = 0; i < ranges.length; i++) {
                    let { $from, $to } = ranges[i];
                    if (!add) {
                        tr.removeMark($from.pos, $to.pos, markType);
                    }
                    else {
                        let from = $from.pos, to = $to.pos, start = $from.nodeAfter, end = $to.nodeBefore;
                        let spaceStart = dropSpace && start && start.isText ? /^\s*/.exec(start.text)[0].length : 0;
                        let spaceEnd = dropSpace && end && end.isText ? /\s*$/.exec(end.text)[0].length : 0;
                        if (from + spaceStart < to) {
                            from += spaceStart;
                            to -= spaceEnd;
                        }
                        tr.addMark(from, to, markType.create(attrs));
                    }
                }
                dispatch(tr.scrollIntoView());
            }
        }
        return true;
    };
}
function wrapDispatchForJoin(dispatch, isJoinable) {
    return (tr) => {
        if (!tr.isGeneric)
            return dispatch(tr);
        let ranges = [];
        for (let i = 0; i < tr.mapping.maps.length; i++) {
            let map = tr.mapping.maps[i];
            for (let j = 0; j < ranges.length; j++)
                ranges[j] = map.map(ranges[j]);
            map.forEach((_s, _e, from, to) => ranges.push(from, to));
        }
        // Figure out which joinable points exist inside those ranges,
        // by checking all node boundaries in their parent nodes.
        let joinable = [];
        for (let i = 0; i < ranges.length; i += 2) {
            let from = ranges[i], to = ranges[i + 1];
            let $from = tr.doc.resolve(from), depth = $from.sharedDepth(to), parent = $from.node(depth);
            for (let index = $from.indexAfter(depth), pos = $from.after(depth + 1); pos <= to; ++index) {
                let after = parent.maybeChild(index);
                if (!after)
                    break;
                if (index && joinable.indexOf(pos) == -1) {
                    let before = parent.child(index - 1);
                    if (before.type == after.type && isJoinable(before, after))
                        joinable.push(pos);
                }
                pos += after.nodeSize;
            }
        }
        // Join the joinable points
        joinable.sort((a, b) => a - b);
        for (let i = joinable.length - 1; i >= 0; i--) {
            if (canJoin(tr.doc, joinable[i]))
                tr.join(joinable[i]);
        }
        dispatch(tr);
    };
}
/**
Wrap a command so that, when it produces a transform that causes
two joinable nodes to end up next to each other, those are joined.
Nodes are considered joinable when they are of the same type and
when the `isJoinable` predicate returns true for them or, if an
array of strings was passed, if their node type name is in that
array.
*/
function autoJoin(command, isJoinable) {
    let canJoin = Array.isArray(isJoinable) ? (node) => isJoinable.indexOf(node.type.name) > -1
        : isJoinable;
    return (state, dispatch, view) => command(state, dispatch && wrapDispatchForJoin(dispatch, canJoin), view);
}
/**
Combine a number of command functions into a single function (which
calls them one by one until one returns true).
*/
function chainCommands(...commands) {
    return function (state, dispatch, view) {
        for (let i = 0; i < commands.length; i++)
            if (commands[i](state, dispatch, view))
                return true;
        return false;
    };
}
let backspace = chainCommands(deleteSelection, joinBackward, selectNodeBackward);
let del = chainCommands(deleteSelection, joinForward, selectNodeForward);
/**
A basic keymap containing bindings not specific to any schema.
Binds the following keys (when multiple commands are listed, they
are chained with [`chainCommands`](https://prosemirror.net/docs/ref/#commands.chainCommands)):

* **Enter** to `newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`
* **Mod-Enter** to `exitCode`
* **Backspace** and **Mod-Backspace** to `deleteSelection`, `joinBackward`, `selectNodeBackward`
* **Delete** and **Mod-Delete** to `deleteSelection`, `joinForward`, `selectNodeForward`
* **Mod-Delete** to `deleteSelection`, `joinForward`, `selectNodeForward`
* **Mod-a** to `selectAll`
*/
const pcBaseKeymap = {
    "Enter": chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
    "Mod-Enter": exitCode,
    "Backspace": backspace,
    "Mod-Backspace": backspace,
    "Shift-Backspace": backspace,
    "Delete": del,
    "Mod-Delete": del,
    "Mod-a": selectAll
};
/**
A copy of `pcBaseKeymap` that also binds **Ctrl-h** like Backspace,
**Ctrl-d** like Delete, **Alt-Backspace** like Ctrl-Backspace, and
**Ctrl-Alt-Backspace**, **Alt-Delete**, and **Alt-d** like
Ctrl-Delete.
*/
const macBaseKeymap = {
    "Ctrl-h": pcBaseKeymap["Backspace"],
    "Alt-Backspace": pcBaseKeymap["Mod-Backspace"],
    "Ctrl-d": pcBaseKeymap["Delete"],
    "Ctrl-Alt-Backspace": pcBaseKeymap["Mod-Delete"],
    "Alt-Delete": pcBaseKeymap["Mod-Delete"],
    "Alt-d": pcBaseKeymap["Mod-Delete"],
    "Ctrl-a": selectTextblockStart,
    "Ctrl-e": selectTextblockEnd
};
for (let key in pcBaseKeymap)
    macBaseKeymap[key] = pcBaseKeymap[key];
const mac = typeof navigator != "undefined" ? /Mac|iP(hone|[oa]d)/.test(navigator.platform)
    // @ts-ignore
    : typeof os != "undefined" && os.platform ? os.platform() == "darwin" : false;
/**
Depending on the detected platform, this will hold
[`pcBasekeymap`](https://prosemirror.net/docs/ref/#commands.pcBaseKeymap) or
[`macBaseKeymap`](https://prosemirror.net/docs/ref/#commands.macBaseKeymap).
*/
const baseKeymap = (/* unused pure expression or super */ null && (mac ? macBaseKeymap : pcBaseKeymap));




/***/ }),

/***/ 61396:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  K: function() { return /* binding */ keydownHandler; },
  w: function() { return /* binding */ keymap; }
});

;// ./node_modules/w3c-keyname/index.js
var base = {
  8: "Backspace",
  9: "Tab",
  10: "Enter",
  12: "NumLock",
  13: "Enter",
  16: "Shift",
  17: "Control",
  18: "Alt",
  20: "CapsLock",
  27: "Escape",
  32: " ",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  44: "PrintScreen",
  45: "Insert",
  46: "Delete",
  59: ";",
  61: "=",
  91: "Meta",
  92: "Meta",
  106: "*",
  107: "+",
  108: ",",
  109: "-",
  110: ".",
  111: "/",
  144: "NumLock",
  145: "ScrollLock",
  160: "Shift",
  161: "Shift",
  162: "Control",
  163: "Control",
  164: "Alt",
  165: "Alt",
  173: "-",
  186: ";",
  187: "=",
  188: ",",
  189: "-",
  190: ".",
  191: "/",
  192: "`",
  219: "[",
  220: "\\",
  221: "]",
  222: "'"
}

var shift = {
  48: ")",
  49: "!",
  50: "@",
  51: "#",
  52: "$",
  53: "%",
  54: "^",
  55: "&",
  56: "*",
  57: "(",
  59: ":",
  61: "+",
  173: "_",
  186: ":",
  187: "+",
  188: "<",
  189: "_",
  190: ">",
  191: "?",
  192: "~",
  219: "{",
  220: "|",
  221: "}",
  222: "\""
}

var mac = typeof navigator != "undefined" && /Mac/.test(navigator.platform)
var ie = typeof navigator != "undefined" && /MSIE \d|Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent)

// Fill in the digit keys
for (var i = 0; i < 10; i++) base[48 + i] = base[96 + i] = String(i)

// The function keys
for (var i = 1; i <= 24; i++) base[i + 111] = "F" + i

// And the alphabetic keys
for (var i = 65; i <= 90; i++) {
  base[i] = String.fromCharCode(i + 32)
  shift[i] = String.fromCharCode(i)
}

// For each code that doesn't have a shift-equivalent, copy the base name
for (var code in base) if (!shift.hasOwnProperty(code)) shift[code] = base[code]

function keyName(event) {
  // On macOS, keys held with Shift and Cmd don't reflect the effect of Shift in `.key`.
  // On IE, shift effect is never included in `.key`.
  var ignoreKey = mac && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey ||
      ie && event.shiftKey && event.key && event.key.length == 1 ||
      event.key == "Unidentified"
  var name = (!ignoreKey && event.key) ||
    (event.shiftKey ? shift : base)[event.keyCode] ||
    event.key || "Unidentified"
  // Edge sometimes produces wrong names (Issue #3)
  if (name == "Esc") name = "Escape"
  if (name == "Del") name = "Delete"
  // https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/8860571/
  if (name == "Left") name = "ArrowLeft"
  if (name == "Up") name = "ArrowUp"
  if (name == "Right") name = "ArrowRight"
  if (name == "Down") name = "ArrowDown"
  return name
}

// EXTERNAL MODULE: ./node_modules/prosemirror-state/dist/index.js
var dist = __webpack_require__(42845);
;// ./node_modules/prosemirror-keymap/dist/index.js



const dist_mac = typeof navigator != "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform);
const windows = typeof navigator != "undefined" && /Win/.test(navigator.platform);
function normalizeKeyName(name) {
    let parts = name.split(/-(?!$)/), result = parts[parts.length - 1];
    if (result == "Space")
        result = " ";
    let alt, ctrl, shift, meta;
    for (let i = 0; i < parts.length - 1; i++) {
        let mod = parts[i];
        if (/^(cmd|meta|m)$/i.test(mod))
            meta = true;
        else if (/^a(lt)?$/i.test(mod))
            alt = true;
        else if (/^(c|ctrl|control)$/i.test(mod))
            ctrl = true;
        else if (/^s(hift)?$/i.test(mod))
            shift = true;
        else if (/^mod$/i.test(mod)) {
            if (dist_mac)
                meta = true;
            else
                ctrl = true;
        }
        else
            throw new Error("Unrecognized modifier name: " + mod);
    }
    if (alt)
        result = "Alt-" + result;
    if (ctrl)
        result = "Ctrl-" + result;
    if (meta)
        result = "Meta-" + result;
    if (shift)
        result = "Shift-" + result;
    return result;
}
function normalize(map) {
    let copy = Object.create(null);
    for (let prop in map)
        copy[normalizeKeyName(prop)] = map[prop];
    return copy;
}
function modifiers(name, event, shift = true) {
    if (event.altKey)
        name = "Alt-" + name;
    if (event.ctrlKey)
        name = "Ctrl-" + name;
    if (event.metaKey)
        name = "Meta-" + name;
    if (shift && event.shiftKey)
        name = "Shift-" + name;
    return name;
}
/**
Create a keymap plugin for the given set of bindings.

Bindings should map key names to [command](https://prosemirror.net/docs/ref/#commands)-style
functions, which will be called with `(EditorState, dispatch,
EditorView)` arguments, and should return true when they've handled
the key. Note that the view argument isn't part of the command
protocol, but can be used as an escape hatch if a binding needs to
directly interact with the UI.

Key names may be strings like `"Shift-Ctrl-Enter"`—a key
identifier prefixed with zero or more modifiers. Key identifiers
are based on the strings that can appear in
[`KeyEvent.key`](https:developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key).
Use lowercase letters to refer to letter keys (or uppercase letters
if you want shift to be held). You may use `"Space"` as an alias
for the `" "` name.

Modifiers can be given in any order. `Shift-` (or `s-`), `Alt-` (or
`a-`), `Ctrl-` (or `c-` or `Control-`) and `Cmd-` (or `m-` or
`Meta-`) are recognized. For characters that are created by holding
shift, the `Shift-` prefix is implied, and should not be added
explicitly.

You can use `Mod-` as a shorthand for `Cmd-` on Mac and `Ctrl-` on
other platforms.

You can add multiple keymap plugins to an editor. The order in
which they appear determines their precedence (the ones early in
the array get to dispatch first).
*/
function keymap(bindings) {
    return new dist/* Plugin */.k_({ props: { handleKeyDown: keydownHandler(bindings) } });
}
/**
Given a set of bindings (using the same format as
[`keymap`](https://prosemirror.net/docs/ref/#keymap.keymap)), return a [keydown
handler](https://prosemirror.net/docs/ref/#view.EditorProps.handleKeyDown) that handles them.
*/
function keydownHandler(bindings) {
    let map = normalize(bindings);
    return function (view, event) {
        let name = keyName(event), baseName, direct = map[modifiers(name, event)];
        if (direct && direct(view.state, view.dispatch, view))
            return true;
        // A character key
        if (name.length == 1 && name != " ") {
            if (event.shiftKey) {
                // In case the name was already modified by shift, try looking
                // it up without its shift modifier
                let noShift = map[modifiers(name, event, false)];
                if (noShift && noShift(view.state, view.dispatch, view))
                    return true;
            }
            if ((event.altKey || event.metaKey || event.ctrlKey) &&
                // Ctrl-Alt may be used for AltGr on Windows
                !(windows && event.ctrlKey && event.altKey) &&
                (baseName = base[event.keyCode]) && baseName != name) {
                // Try falling back to the keyCode when there's a modifier
                // active or the character produced isn't ASCII, and our table
                // produces a different name from the the keyCode. See #668,
                // #1060, #1529.
                let fromCode = map[modifiers(baseName, event)];
                if (fromCode && fromCode(view.state, view.dispatch, view))
                    return true;
            }
        }
        return false;
    };
}




/***/ }),

/***/ 58903:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  S4: function() { return /* binding */ DOMParser; },
  ZF: function() { return /* binding */ DOMSerializer; },
  FK: function() { return /* binding */ Fragment; },
  CU: function() { return /* binding */ Mark; },
  sX: function() { return /* binding */ MarkType; },
  bP: function() { return /* binding */ Node; },
  u$: function() { return /* binding */ NodeRange; },
  vI: function() { return /* binding */ ReplaceError; },
  Sj: function() { return /* binding */ Schema; },
  Ji: function() { return /* binding */ Slice; }
});

// UNUSED EXPORTS: ContentMatch, NodeType, ResolvedPos

;// ./node_modules/orderedmap/dist/index.js
// ::- Persistent data structure representing an ordered mapping from
// strings to values, with some convenient update methods.
function OrderedMap(content) {
  this.content = content;
}

OrderedMap.prototype = {
  constructor: OrderedMap,

  find: function(key) {
    for (var i = 0; i < this.content.length; i += 2)
      if (this.content[i] === key) return i
    return -1
  },

  // :: (string) → ?any
  // Retrieve the value stored under `key`, or return undefined when
  // no such key exists.
  get: function(key) {
    var found = this.find(key);
    return found == -1 ? undefined : this.content[found + 1]
  },

  // :: (string, any, ?string) → OrderedMap
  // Create a new map by replacing the value of `key` with a new
  // value, or adding a binding to the end of the map. If `newKey` is
  // given, the key of the binding will be replaced with that key.
  update: function(key, value, newKey) {
    var self = newKey && newKey != key ? this.remove(newKey) : this;
    var found = self.find(key), content = self.content.slice();
    if (found == -1) {
      content.push(newKey || key, value);
    } else {
      content[found + 1] = value;
      if (newKey) content[found] = newKey;
    }
    return new OrderedMap(content)
  },

  // :: (string) → OrderedMap
  // Return a map with the given key removed, if it existed.
  remove: function(key) {
    var found = this.find(key);
    if (found == -1) return this
    var content = this.content.slice();
    content.splice(found, 2);
    return new OrderedMap(content)
  },

  // :: (string, any) → OrderedMap
  // Add a new key to the start of the map.
  addToStart: function(key, value) {
    return new OrderedMap([key, value].concat(this.remove(key).content))
  },

  // :: (string, any) → OrderedMap
  // Add a new key to the end of the map.
  addToEnd: function(key, value) {
    var content = this.remove(key).content.slice();
    content.push(key, value);
    return new OrderedMap(content)
  },

  // :: (string, string, any) → OrderedMap
  // Add a key after the given key. If `place` is not found, the new
  // key is added to the end.
  addBefore: function(place, key, value) {
    var without = this.remove(key), content = without.content.slice();
    var found = without.find(place);
    content.splice(found == -1 ? content.length : found, 0, key, value);
    return new OrderedMap(content)
  },

  // :: ((key: string, value: any))
  // Call the given function for each key/value pair in the map, in
  // order.
  forEach: function(f) {
    for (var i = 0; i < this.content.length; i += 2)
      f(this.content[i], this.content[i + 1]);
  },

  // :: (union<Object, OrderedMap>) → OrderedMap
  // Create a new map by prepending the keys in this map that don't
  // appear in `map` before the keys in `map`.
  prepend: function(map) {
    map = OrderedMap.from(map);
    if (!map.size) return this
    return new OrderedMap(map.content.concat(this.subtract(map).content))
  },

  // :: (union<Object, OrderedMap>) → OrderedMap
  // Create a new map by appending the keys in this map that don't
  // appear in `map` after the keys in `map`.
  append: function(map) {
    map = OrderedMap.from(map);
    if (!map.size) return this
    return new OrderedMap(this.subtract(map).content.concat(map.content))
  },

  // :: (union<Object, OrderedMap>) → OrderedMap
  // Create a map containing all the keys in this map that don't
  // appear in `map`.
  subtract: function(map) {
    var result = this;
    map = OrderedMap.from(map);
    for (var i = 0; i < map.content.length; i += 2)
      result = result.remove(map.content[i]);
    return result
  },

  // :: () → Object
  // Turn ordered map into a plain object.
  toObject: function() {
    var result = {};
    this.forEach(function(key, value) { result[key] = value; });
    return result
  },

  // :: number
  // The amount of keys in this map.
  get size() {
    return this.content.length >> 1
  }
};

// :: (?union<Object, OrderedMap>) → OrderedMap
// Return a map with the given content. If null, create an empty
// map. If given an ordered map, return that map itself. If given an
// object, create a map from the object's properties.
OrderedMap.from = function(value) {
  if (value instanceof OrderedMap) return value
  var content = [];
  if (value) for (var prop in value) content.push(prop, value[prop]);
  return new OrderedMap(content)
};

/* harmony default export */ var dist = (OrderedMap);

;// ./node_modules/prosemirror-model/dist/index.js


function findDiffStart(a, b, pos) {
    for (let i = 0;; i++) {
        if (i == a.childCount || i == b.childCount)
            return a.childCount == b.childCount ? null : pos;
        let childA = a.child(i), childB = b.child(i);
        if (childA == childB) {
            pos += childA.nodeSize;
            continue;
        }
        if (!childA.sameMarkup(childB))
            return pos;
        if (childA.isText && childA.text != childB.text) {
            for (let j = 0; childA.text[j] == childB.text[j]; j++)
                pos++;
            return pos;
        }
        if (childA.content.size || childB.content.size) {
            let inner = findDiffStart(childA.content, childB.content, pos + 1);
            if (inner != null)
                return inner;
        }
        pos += childA.nodeSize;
    }
}
function findDiffEnd(a, b, posA, posB) {
    for (let iA = a.childCount, iB = b.childCount;;) {
        if (iA == 0 || iB == 0)
            return iA == iB ? null : { a: posA, b: posB };
        let childA = a.child(--iA), childB = b.child(--iB), size = childA.nodeSize;
        if (childA == childB) {
            posA -= size;
            posB -= size;
            continue;
        }
        if (!childA.sameMarkup(childB))
            return { a: posA, b: posB };
        if (childA.isText && childA.text != childB.text) {
            let same = 0, minSize = Math.min(childA.text.length, childB.text.length);
            while (same < minSize && childA.text[childA.text.length - same - 1] == childB.text[childB.text.length - same - 1]) {
                same++;
                posA--;
                posB--;
            }
            return { a: posA, b: posB };
        }
        if (childA.content.size || childB.content.size) {
            let inner = findDiffEnd(childA.content, childB.content, posA - 1, posB - 1);
            if (inner)
                return inner;
        }
        posA -= size;
        posB -= size;
    }
}

/**
A fragment represents a node's collection of child nodes.

Like nodes, fragments are persistent data structures, and you
should not mutate them or their content. Rather, you create new
instances whenever needed. The API tries to make this easy.
*/
class Fragment {
    /**
    @internal
    */
    constructor(
    /**
    The child nodes in this fragment.
    */
    content, size) {
        this.content = content;
        this.size = size || 0;
        if (size == null)
            for (let i = 0; i < content.length; i++)
                this.size += content[i].nodeSize;
    }
    /**
    Invoke a callback for all descendant nodes between the given two
    positions (relative to start of this fragment). Doesn't descend
    into a node when the callback returns `false`.
    */
    nodesBetween(from, to, f, nodeStart = 0, parent) {
        for (let i = 0, pos = 0; pos < to; i++) {
            let child = this.content[i], end = pos + child.nodeSize;
            if (end > from && f(child, nodeStart + pos, parent || null, i) !== false && child.content.size) {
                let start = pos + 1;
                child.nodesBetween(Math.max(0, from - start), Math.min(child.content.size, to - start), f, nodeStart + start);
            }
            pos = end;
        }
    }
    /**
    Call the given callback for every descendant node. `pos` will be
    relative to the start of the fragment. The callback may return
    `false` to prevent traversal of a given node's children.
    */
    descendants(f) {
        this.nodesBetween(0, this.size, f);
    }
    /**
    Extract the text between `from` and `to`. See the same method on
    [`Node`](https://prosemirror.net/docs/ref/#model.Node.textBetween).
    */
    textBetween(from, to, blockSeparator, leafText) {
        let text = "", first = true;
        this.nodesBetween(from, to, (node, pos) => {
            let nodeText = node.isText ? node.text.slice(Math.max(from, pos) - pos, to - pos)
                : !node.isLeaf ? ""
                    : leafText ? (typeof leafText === "function" ? leafText(node) : leafText)
                        : node.type.spec.leafText ? node.type.spec.leafText(node)
                            : "";
            if (node.isBlock && (node.isLeaf && nodeText || node.isTextblock) && blockSeparator) {
                if (first)
                    first = false;
                else
                    text += blockSeparator;
            }
            text += nodeText;
        }, 0);
        return text;
    }
    /**
    Create a new fragment containing the combined content of this
    fragment and the other.
    */
    append(other) {
        if (!other.size)
            return this;
        if (!this.size)
            return other;
        let last = this.lastChild, first = other.firstChild, content = this.content.slice(), i = 0;
        if (last.isText && last.sameMarkup(first)) {
            content[content.length - 1] = last.withText(last.text + first.text);
            i = 1;
        }
        for (; i < other.content.length; i++)
            content.push(other.content[i]);
        return new Fragment(content, this.size + other.size);
    }
    /**
    Cut out the sub-fragment between the two given positions.
    */
    cut(from, to = this.size) {
        if (from == 0 && to == this.size)
            return this;
        let result = [], size = 0;
        if (to > from)
            for (let i = 0, pos = 0; pos < to; i++) {
                let child = this.content[i], end = pos + child.nodeSize;
                if (end > from) {
                    if (pos < from || end > to) {
                        if (child.isText)
                            child = child.cut(Math.max(0, from - pos), Math.min(child.text.length, to - pos));
                        else
                            child = child.cut(Math.max(0, from - pos - 1), Math.min(child.content.size, to - pos - 1));
                    }
                    result.push(child);
                    size += child.nodeSize;
                }
                pos = end;
            }
        return new Fragment(result, size);
    }
    /**
    @internal
    */
    cutByIndex(from, to) {
        if (from == to)
            return Fragment.empty;
        if (from == 0 && to == this.content.length)
            return this;
        return new Fragment(this.content.slice(from, to));
    }
    /**
    Create a new fragment in which the node at the given index is
    replaced by the given node.
    */
    replaceChild(index, node) {
        let current = this.content[index];
        if (current == node)
            return this;
        let copy = this.content.slice();
        let size = this.size + node.nodeSize - current.nodeSize;
        copy[index] = node;
        return new Fragment(copy, size);
    }
    /**
    Create a new fragment by prepending the given node to this
    fragment.
    */
    addToStart(node) {
        return new Fragment([node].concat(this.content), this.size + node.nodeSize);
    }
    /**
    Create a new fragment by appending the given node to this
    fragment.
    */
    addToEnd(node) {
        return new Fragment(this.content.concat(node), this.size + node.nodeSize);
    }
    /**
    Compare this fragment to another one.
    */
    eq(other) {
        if (this.content.length != other.content.length)
            return false;
        for (let i = 0; i < this.content.length; i++)
            if (!this.content[i].eq(other.content[i]))
                return false;
        return true;
    }
    /**
    The first child of the fragment, or `null` if it is empty.
    */
    get firstChild() { return this.content.length ? this.content[0] : null; }
    /**
    The last child of the fragment, or `null` if it is empty.
    */
    get lastChild() { return this.content.length ? this.content[this.content.length - 1] : null; }
    /**
    The number of child nodes in this fragment.
    */
    get childCount() { return this.content.length; }
    /**
    Get the child node at the given index. Raise an error when the
    index is out of range.
    */
    child(index) {
        let found = this.content[index];
        if (!found)
            throw new RangeError("Index " + index + " out of range for " + this);
        return found;
    }
    /**
    Get the child node at the given index, if it exists.
    */
    maybeChild(index) {
        return this.content[index] || null;
    }
    /**
    Call `f` for every child node, passing the node, its offset
    into this parent node, and its index.
    */
    forEach(f) {
        for (let i = 0, p = 0; i < this.content.length; i++) {
            let child = this.content[i];
            f(child, p, i);
            p += child.nodeSize;
        }
    }
    /**
    Find the first position at which this fragment and another
    fragment differ, or `null` if they are the same.
    */
    findDiffStart(other, pos = 0) {
        return findDiffStart(this, other, pos);
    }
    /**
    Find the first position, searching from the end, at which this
    fragment and the given fragment differ, or `null` if they are
    the same. Since this position will not be the same in both
    nodes, an object with two separate positions is returned.
    */
    findDiffEnd(other, pos = this.size, otherPos = other.size) {
        return findDiffEnd(this, other, pos, otherPos);
    }
    /**
    Find the index and inner offset corresponding to a given relative
    position in this fragment. The result object will be reused
    (overwritten) the next time the function is called. @internal
    */
    findIndex(pos) {
        if (pos == 0)
            return retIndex(0, pos);
        if (pos == this.size)
            return retIndex(this.content.length, pos);
        if (pos > this.size || pos < 0)
            throw new RangeError(`Position ${pos} outside of fragment (${this})`);
        for (let i = 0, curPos = 0;; i++) {
            let cur = this.child(i), end = curPos + cur.nodeSize;
            if (end >= pos) {
                if (end == pos)
                    return retIndex(i + 1, end);
                return retIndex(i, curPos);
            }
            curPos = end;
        }
    }
    /**
    Return a debugging string that describes this fragment.
    */
    toString() { return "<" + this.toStringInner() + ">"; }
    /**
    @internal
    */
    toStringInner() { return this.content.join(", "); }
    /**
    Create a JSON-serializeable representation of this fragment.
    */
    toJSON() {
        return this.content.length ? this.content.map(n => n.toJSON()) : null;
    }
    /**
    Deserialize a fragment from its JSON representation.
    */
    static fromJSON(schema, value) {
        if (!value)
            return Fragment.empty;
        if (!Array.isArray(value))
            throw new RangeError("Invalid input for Fragment.fromJSON");
        return new Fragment(value.map(schema.nodeFromJSON));
    }
    /**
    Build a fragment from an array of nodes. Ensures that adjacent
    text nodes with the same marks are joined together.
    */
    static fromArray(array) {
        if (!array.length)
            return Fragment.empty;
        let joined, size = 0;
        for (let i = 0; i < array.length; i++) {
            let node = array[i];
            size += node.nodeSize;
            if (i && node.isText && array[i - 1].sameMarkup(node)) {
                if (!joined)
                    joined = array.slice(0, i);
                joined[joined.length - 1] = node
                    .withText(joined[joined.length - 1].text + node.text);
            }
            else if (joined) {
                joined.push(node);
            }
        }
        return new Fragment(joined || array, size);
    }
    /**
    Create a fragment from something that can be interpreted as a
    set of nodes. For `null`, it returns the empty fragment. For a
    fragment, the fragment itself. For a node or array of nodes, a
    fragment containing those nodes.
    */
    static from(nodes) {
        if (!nodes)
            return Fragment.empty;
        if (nodes instanceof Fragment)
            return nodes;
        if (Array.isArray(nodes))
            return this.fromArray(nodes);
        if (nodes.attrs)
            return new Fragment([nodes], nodes.nodeSize);
        throw new RangeError("Can not convert " + nodes + " to a Fragment" +
            (nodes.nodesBetween ? " (looks like multiple versions of prosemirror-model were loaded)" : ""));
    }
}
/**
An empty fragment. Intended to be reused whenever a node doesn't
contain anything (rather than allocating a new empty fragment for
each leaf node).
*/
Fragment.empty = new Fragment([], 0);
const found = { index: 0, offset: 0 };
function retIndex(index, offset) {
    found.index = index;
    found.offset = offset;
    return found;
}

function compareDeep(a, b) {
    if (a === b)
        return true;
    if (!(a && typeof a == "object") ||
        !(b && typeof b == "object"))
        return false;
    let array = Array.isArray(a);
    if (Array.isArray(b) != array)
        return false;
    if (array) {
        if (a.length != b.length)
            return false;
        for (let i = 0; i < a.length; i++)
            if (!compareDeep(a[i], b[i]))
                return false;
    }
    else {
        for (let p in a)
            if (!(p in b) || !compareDeep(a[p], b[p]))
                return false;
        for (let p in b)
            if (!(p in a))
                return false;
    }
    return true;
}

/**
A mark is a piece of information that can be attached to a node,
such as it being emphasized, in code font, or a link. It has a
type and optionally a set of attributes that provide further
information (such as the target of the link). Marks are created
through a `Schema`, which controls which types exist and which
attributes they have.
*/
class Mark {
    /**
    @internal
    */
    constructor(
    /**
    The type of this mark.
    */
    type, 
    /**
    The attributes associated with this mark.
    */
    attrs) {
        this.type = type;
        this.attrs = attrs;
    }
    /**
    Given a set of marks, create a new set which contains this one as
    well, in the right position. If this mark is already in the set,
    the set itself is returned. If any marks that are set to be
    [exclusive](https://prosemirror.net/docs/ref/#model.MarkSpec.excludes) with this mark are present,
    those are replaced by this one.
    */
    addToSet(set) {
        let copy, placed = false;
        for (let i = 0; i < set.length; i++) {
            let other = set[i];
            if (this.eq(other))
                return set;
            if (this.type.excludes(other.type)) {
                if (!copy)
                    copy = set.slice(0, i);
            }
            else if (other.type.excludes(this.type)) {
                return set;
            }
            else {
                if (!placed && other.type.rank > this.type.rank) {
                    if (!copy)
                        copy = set.slice(0, i);
                    copy.push(this);
                    placed = true;
                }
                if (copy)
                    copy.push(other);
            }
        }
        if (!copy)
            copy = set.slice();
        if (!placed)
            copy.push(this);
        return copy;
    }
    /**
    Remove this mark from the given set, returning a new set. If this
    mark is not in the set, the set itself is returned.
    */
    removeFromSet(set) {
        for (let i = 0; i < set.length; i++)
            if (this.eq(set[i]))
                return set.slice(0, i).concat(set.slice(i + 1));
        return set;
    }
    /**
    Test whether this mark is in the given set of marks.
    */
    isInSet(set) {
        for (let i = 0; i < set.length; i++)
            if (this.eq(set[i]))
                return true;
        return false;
    }
    /**
    Test whether this mark has the same type and attributes as
    another mark.
    */
    eq(other) {
        return this == other ||
            (this.type == other.type && compareDeep(this.attrs, other.attrs));
    }
    /**
    Convert this mark to a JSON-serializeable representation.
    */
    toJSON() {
        let obj = { type: this.type.name };
        for (let _ in this.attrs) {
            obj.attrs = this.attrs;
            break;
        }
        return obj;
    }
    /**
    Deserialize a mark from JSON.
    */
    static fromJSON(schema, json) {
        if (!json)
            throw new RangeError("Invalid input for Mark.fromJSON");
        let type = schema.marks[json.type];
        if (!type)
            throw new RangeError(`There is no mark type ${json.type} in this schema`);
        let mark = type.create(json.attrs);
        type.checkAttrs(mark.attrs);
        return mark;
    }
    /**
    Test whether two sets of marks are identical.
    */
    static sameSet(a, b) {
        if (a == b)
            return true;
        if (a.length != b.length)
            return false;
        for (let i = 0; i < a.length; i++)
            if (!a[i].eq(b[i]))
                return false;
        return true;
    }
    /**
    Create a properly sorted mark set from null, a single mark, or an
    unsorted array of marks.
    */
    static setFrom(marks) {
        if (!marks || Array.isArray(marks) && marks.length == 0)
            return Mark.none;
        if (marks instanceof Mark)
            return [marks];
        let copy = marks.slice();
        copy.sort((a, b) => a.type.rank - b.type.rank);
        return copy;
    }
}
/**
The empty set of marks.
*/
Mark.none = [];

/**
Error type raised by [`Node.replace`](https://prosemirror.net/docs/ref/#model.Node.replace) when
given an invalid replacement.
*/
class ReplaceError extends Error {
}
/*
ReplaceError = function(this: any, message: string) {
  let err = Error.call(this, message)
  ;(err as any).__proto__ = ReplaceError.prototype
  return err
} as any

ReplaceError.prototype = Object.create(Error.prototype)
ReplaceError.prototype.constructor = ReplaceError
ReplaceError.prototype.name = "ReplaceError"
*/
/**
A slice represents a piece cut out of a larger document. It
stores not only a fragment, but also the depth up to which nodes on
both side are ‘open’ (cut through).
*/
class Slice {
    /**
    Create a slice. When specifying a non-zero open depth, you must
    make sure that there are nodes of at least that depth at the
    appropriate side of the fragment—i.e. if the fragment is an
    empty paragraph node, `openStart` and `openEnd` can't be greater
    than 1.
    
    It is not necessary for the content of open nodes to conform to
    the schema's content constraints, though it should be a valid
    start/end/middle for such a node, depending on which sides are
    open.
    */
    constructor(
    /**
    The slice's content.
    */
    content, 
    /**
    The open depth at the start of the fragment.
    */
    openStart, 
    /**
    The open depth at the end.
    */
    openEnd) {
        this.content = content;
        this.openStart = openStart;
        this.openEnd = openEnd;
    }
    /**
    The size this slice would add when inserted into a document.
    */
    get size() {
        return this.content.size - this.openStart - this.openEnd;
    }
    /**
    @internal
    */
    insertAt(pos, fragment) {
        let content = insertInto(this.content, pos + this.openStart, fragment);
        return content && new Slice(content, this.openStart, this.openEnd);
    }
    /**
    @internal
    */
    removeBetween(from, to) {
        return new Slice(removeRange(this.content, from + this.openStart, to + this.openStart), this.openStart, this.openEnd);
    }
    /**
    Tests whether this slice is equal to another slice.
    */
    eq(other) {
        return this.content.eq(other.content) && this.openStart == other.openStart && this.openEnd == other.openEnd;
    }
    /**
    @internal
    */
    toString() {
        return this.content + "(" + this.openStart + "," + this.openEnd + ")";
    }
    /**
    Convert a slice to a JSON-serializable representation.
    */
    toJSON() {
        if (!this.content.size)
            return null;
        let json = { content: this.content.toJSON() };
        if (this.openStart > 0)
            json.openStart = this.openStart;
        if (this.openEnd > 0)
            json.openEnd = this.openEnd;
        return json;
    }
    /**
    Deserialize a slice from its JSON representation.
    */
    static fromJSON(schema, json) {
        if (!json)
            return Slice.empty;
        let openStart = json.openStart || 0, openEnd = json.openEnd || 0;
        if (typeof openStart != "number" || typeof openEnd != "number")
            throw new RangeError("Invalid input for Slice.fromJSON");
        return new Slice(Fragment.fromJSON(schema, json.content), openStart, openEnd);
    }
    /**
    Create a slice from a fragment by taking the maximum possible
    open value on both side of the fragment.
    */
    static maxOpen(fragment, openIsolating = true) {
        let openStart = 0, openEnd = 0;
        for (let n = fragment.firstChild; n && !n.isLeaf && (openIsolating || !n.type.spec.isolating); n = n.firstChild)
            openStart++;
        for (let n = fragment.lastChild; n && !n.isLeaf && (openIsolating || !n.type.spec.isolating); n = n.lastChild)
            openEnd++;
        return new Slice(fragment, openStart, openEnd);
    }
}
/**
The empty slice.
*/
Slice.empty = new Slice(Fragment.empty, 0, 0);
function removeRange(content, from, to) {
    let { index, offset } = content.findIndex(from), child = content.maybeChild(index);
    let { index: indexTo, offset: offsetTo } = content.findIndex(to);
    if (offset == from || child.isText) {
        if (offsetTo != to && !content.child(indexTo).isText)
            throw new RangeError("Removing non-flat range");
        return content.cut(0, from).append(content.cut(to));
    }
    if (index != indexTo)
        throw new RangeError("Removing non-flat range");
    return content.replaceChild(index, child.copy(removeRange(child.content, from - offset - 1, to - offset - 1)));
}
function insertInto(content, dist, insert, parent) {
    let { index, offset } = content.findIndex(dist), child = content.maybeChild(index);
    if (offset == dist || child.isText) {
        if (parent && !parent.canReplace(index, index, insert))
            return null;
        return content.cut(0, dist).append(insert).append(content.cut(dist));
    }
    let inner = insertInto(child.content, dist - offset - 1, insert, child);
    return inner && content.replaceChild(index, child.copy(inner));
}
function replace($from, $to, slice) {
    if (slice.openStart > $from.depth)
        throw new ReplaceError("Inserted content deeper than insertion position");
    if ($from.depth - slice.openStart != $to.depth - slice.openEnd)
        throw new ReplaceError("Inconsistent open depths");
    return replaceOuter($from, $to, slice, 0);
}
function replaceOuter($from, $to, slice, depth) {
    let index = $from.index(depth), node = $from.node(depth);
    if (index == $to.index(depth) && depth < $from.depth - slice.openStart) {
        let inner = replaceOuter($from, $to, slice, depth + 1);
        return node.copy(node.content.replaceChild(index, inner));
    }
    else if (!slice.content.size) {
        return dist_close(node, replaceTwoWay($from, $to, depth));
    }
    else if (!slice.openStart && !slice.openEnd && $from.depth == depth && $to.depth == depth) { // Simple, flat case
        let parent = $from.parent, content = parent.content;
        return dist_close(parent, content.cut(0, $from.parentOffset).append(slice.content).append(content.cut($to.parentOffset)));
    }
    else {
        let { start, end } = prepareSliceForReplace(slice, $from);
        return dist_close(node, replaceThreeWay($from, start, end, $to, depth));
    }
}
function checkJoin(main, sub) {
    if (!sub.type.compatibleContent(main.type))
        throw new ReplaceError("Cannot join " + sub.type.name + " onto " + main.type.name);
}
function joinable($before, $after, depth) {
    let node = $before.node(depth);
    checkJoin(node, $after.node(depth));
    return node;
}
function addNode(child, target) {
    let last = target.length - 1;
    if (last >= 0 && child.isText && child.sameMarkup(target[last]))
        target[last] = child.withText(target[last].text + child.text);
    else
        target.push(child);
}
function addRange($start, $end, depth, target) {
    let node = ($end || $start).node(depth);
    let startIndex = 0, endIndex = $end ? $end.index(depth) : node.childCount;
    if ($start) {
        startIndex = $start.index(depth);
        if ($start.depth > depth) {
            startIndex++;
        }
        else if ($start.textOffset) {
            addNode($start.nodeAfter, target);
            startIndex++;
        }
    }
    for (let i = startIndex; i < endIndex; i++)
        addNode(node.child(i), target);
    if ($end && $end.depth == depth && $end.textOffset)
        addNode($end.nodeBefore, target);
}
function dist_close(node, content) {
    node.type.checkContent(content);
    return node.copy(content);
}
function replaceThreeWay($from, $start, $end, $to, depth) {
    let openStart = $from.depth > depth && joinable($from, $start, depth + 1);
    let openEnd = $to.depth > depth && joinable($end, $to, depth + 1);
    let content = [];
    addRange(null, $from, depth, content);
    if (openStart && openEnd && $start.index(depth) == $end.index(depth)) {
        checkJoin(openStart, openEnd);
        addNode(dist_close(openStart, replaceThreeWay($from, $start, $end, $to, depth + 1)), content);
    }
    else {
        if (openStart)
            addNode(dist_close(openStart, replaceTwoWay($from, $start, depth + 1)), content);
        addRange($start, $end, depth, content);
        if (openEnd)
            addNode(dist_close(openEnd, replaceTwoWay($end, $to, depth + 1)), content);
    }
    addRange($to, null, depth, content);
    return new Fragment(content);
}
function replaceTwoWay($from, $to, depth) {
    let content = [];
    addRange(null, $from, depth, content);
    if ($from.depth > depth) {
        let type = joinable($from, $to, depth + 1);
        addNode(dist_close(type, replaceTwoWay($from, $to, depth + 1)), content);
    }
    addRange($to, null, depth, content);
    return new Fragment(content);
}
function prepareSliceForReplace(slice, $along) {
    let extra = $along.depth - slice.openStart, parent = $along.node(extra);
    let node = parent.copy(slice.content);
    for (let i = extra - 1; i >= 0; i--)
        node = $along.node(i).copy(Fragment.from(node));
    return { start: node.resolveNoCache(slice.openStart + extra),
        end: node.resolveNoCache(node.content.size - slice.openEnd - extra) };
}

/**
You can [_resolve_](https://prosemirror.net/docs/ref/#model.Node.resolve) a position to get more
information about it. Objects of this class represent such a
resolved position, providing various pieces of context
information, and some helper methods.

Throughout this interface, methods that take an optional `depth`
parameter will interpret undefined as `this.depth` and negative
numbers as `this.depth + value`.
*/
class ResolvedPos {
    /**
    @internal
    */
    constructor(
    /**
    The position that was resolved.
    */
    pos, 
    /**
    @internal
    */
    path, 
    /**
    The offset this position has into its parent node.
    */
    parentOffset) {
        this.pos = pos;
        this.path = path;
        this.parentOffset = parentOffset;
        this.depth = path.length / 3 - 1;
    }
    /**
    @internal
    */
    resolveDepth(val) {
        if (val == null)
            return this.depth;
        if (val < 0)
            return this.depth + val;
        return val;
    }
    /**
    The parent node that the position points into. Note that even if
    a position points into a text node, that node is not considered
    the parent—text nodes are ‘flat’ in this model, and have no content.
    */
    get parent() { return this.node(this.depth); }
    /**
    The root node in which the position was resolved.
    */
    get doc() { return this.node(0); }
    /**
    The ancestor node at the given level. `p.node(p.depth)` is the
    same as `p.parent`.
    */
    node(depth) { return this.path[this.resolveDepth(depth) * 3]; }
    /**
    The index into the ancestor at the given level. If this points
    at the 3rd node in the 2nd paragraph on the top level, for
    example, `p.index(0)` is 1 and `p.index(1)` is 2.
    */
    index(depth) { return this.path[this.resolveDepth(depth) * 3 + 1]; }
    /**
    The index pointing after this position into the ancestor at the
    given level.
    */
    indexAfter(depth) {
        depth = this.resolveDepth(depth);
        return this.index(depth) + (depth == this.depth && !this.textOffset ? 0 : 1);
    }
    /**
    The (absolute) position at the start of the node at the given
    level.
    */
    start(depth) {
        depth = this.resolveDepth(depth);
        return depth == 0 ? 0 : this.path[depth * 3 - 1] + 1;
    }
    /**
    The (absolute) position at the end of the node at the given
    level.
    */
    end(depth) {
        depth = this.resolveDepth(depth);
        return this.start(depth) + this.node(depth).content.size;
    }
    /**
    The (absolute) position directly before the wrapping node at the
    given level, or, when `depth` is `this.depth + 1`, the original
    position.
    */
    before(depth) {
        depth = this.resolveDepth(depth);
        if (!depth)
            throw new RangeError("There is no position before the top-level node");
        return depth == this.depth + 1 ? this.pos : this.path[depth * 3 - 1];
    }
    /**
    The (absolute) position directly after the wrapping node at the
    given level, or the original position when `depth` is `this.depth + 1`.
    */
    after(depth) {
        depth = this.resolveDepth(depth);
        if (!depth)
            throw new RangeError("There is no position after the top-level node");
        return depth == this.depth + 1 ? this.pos : this.path[depth * 3 - 1] + this.path[depth * 3].nodeSize;
    }
    /**
    When this position points into a text node, this returns the
    distance between the position and the start of the text node.
    Will be zero for positions that point between nodes.
    */
    get textOffset() { return this.pos - this.path[this.path.length - 1]; }
    /**
    Get the node directly after the position, if any. If the position
    points into a text node, only the part of that node after the
    position is returned.
    */
    get nodeAfter() {
        let parent = this.parent, index = this.index(this.depth);
        if (index == parent.childCount)
            return null;
        let dOff = this.pos - this.path[this.path.length - 1], child = parent.child(index);
        return dOff ? parent.child(index).cut(dOff) : child;
    }
    /**
    Get the node directly before the position, if any. If the
    position points into a text node, only the part of that node
    before the position is returned.
    */
    get nodeBefore() {
        let index = this.index(this.depth);
        let dOff = this.pos - this.path[this.path.length - 1];
        if (dOff)
            return this.parent.child(index).cut(0, dOff);
        return index == 0 ? null : this.parent.child(index - 1);
    }
    /**
    Get the position at the given index in the parent node at the
    given depth (which defaults to `this.depth`).
    */
    posAtIndex(index, depth) {
        depth = this.resolveDepth(depth);
        let node = this.path[depth * 3], pos = depth == 0 ? 0 : this.path[depth * 3 - 1] + 1;
        for (let i = 0; i < index; i++)
            pos += node.child(i).nodeSize;
        return pos;
    }
    /**
    Get the marks at this position, factoring in the surrounding
    marks' [`inclusive`](https://prosemirror.net/docs/ref/#model.MarkSpec.inclusive) property. If the
    position is at the start of a non-empty node, the marks of the
    node after it (if any) are returned.
    */
    marks() {
        let parent = this.parent, index = this.index();
        // In an empty parent, return the empty array
        if (parent.content.size == 0)
            return Mark.none;
        // When inside a text node, just return the text node's marks
        if (this.textOffset)
            return parent.child(index).marks;
        let main = parent.maybeChild(index - 1), other = parent.maybeChild(index);
        // If the `after` flag is true of there is no node before, make
        // the node after this position the main reference.
        if (!main) {
            let tmp = main;
            main = other;
            other = tmp;
        }
        // Use all marks in the main node, except those that have
        // `inclusive` set to false and are not present in the other node.
        let marks = main.marks;
        for (var i = 0; i < marks.length; i++)
            if (marks[i].type.spec.inclusive === false && (!other || !marks[i].isInSet(other.marks)))
                marks = marks[i--].removeFromSet(marks);
        return marks;
    }
    /**
    Get the marks after the current position, if any, except those
    that are non-inclusive and not present at position `$end`. This
    is mostly useful for getting the set of marks to preserve after a
    deletion. Will return `null` if this position is at the end of
    its parent node or its parent node isn't a textblock (in which
    case no marks should be preserved).
    */
    marksAcross($end) {
        let after = this.parent.maybeChild(this.index());
        if (!after || !after.isInline)
            return null;
        let marks = after.marks, next = $end.parent.maybeChild($end.index());
        for (var i = 0; i < marks.length; i++)
            if (marks[i].type.spec.inclusive === false && (!next || !marks[i].isInSet(next.marks)))
                marks = marks[i--].removeFromSet(marks);
        return marks;
    }
    /**
    The depth up to which this position and the given (non-resolved)
    position share the same parent nodes.
    */
    sharedDepth(pos) {
        for (let depth = this.depth; depth > 0; depth--)
            if (this.start(depth) <= pos && this.end(depth) >= pos)
                return depth;
        return 0;
    }
    /**
    Returns a range based on the place where this position and the
    given position diverge around block content. If both point into
    the same textblock, for example, a range around that textblock
    will be returned. If they point into different blocks, the range
    around those blocks in their shared ancestor is returned. You can
    pass in an optional predicate that will be called with a parent
    node to see if a range into that parent is acceptable.
    */
    blockRange(other = this, pred) {
        if (other.pos < this.pos)
            return other.blockRange(this);
        for (let d = this.depth - (this.parent.inlineContent || this.pos == other.pos ? 1 : 0); d >= 0; d--)
            if (other.pos <= this.end(d) && (!pred || pred(this.node(d))))
                return new NodeRange(this, other, d);
        return null;
    }
    /**
    Query whether the given position shares the same parent node.
    */
    sameParent(other) {
        return this.pos - this.parentOffset == other.pos - other.parentOffset;
    }
    /**
    Return the greater of this and the given position.
    */
    max(other) {
        return other.pos > this.pos ? other : this;
    }
    /**
    Return the smaller of this and the given position.
    */
    min(other) {
        return other.pos < this.pos ? other : this;
    }
    /**
    @internal
    */
    toString() {
        let str = "";
        for (let i = 1; i <= this.depth; i++)
            str += (str ? "/" : "") + this.node(i).type.name + "_" + this.index(i - 1);
        return str + ":" + this.parentOffset;
    }
    /**
    @internal
    */
    static resolve(doc, pos) {
        if (!(pos >= 0 && pos <= doc.content.size))
            throw new RangeError("Position " + pos + " out of range");
        let path = [];
        let start = 0, parentOffset = pos;
        for (let node = doc;;) {
            let { index, offset } = node.content.findIndex(parentOffset);
            let rem = parentOffset - offset;
            path.push(node, index, start + offset);
            if (!rem)
                break;
            node = node.child(index);
            if (node.isText)
                break;
            parentOffset = rem - 1;
            start += offset + 1;
        }
        return new ResolvedPos(pos, path, parentOffset);
    }
    /**
    @internal
    */
    static resolveCached(doc, pos) {
        let cache = resolveCache.get(doc);
        if (cache) {
            for (let i = 0; i < cache.elts.length; i++) {
                let elt = cache.elts[i];
                if (elt.pos == pos)
                    return elt;
            }
        }
        else {
            resolveCache.set(doc, cache = new ResolveCache);
        }
        let result = cache.elts[cache.i] = ResolvedPos.resolve(doc, pos);
        cache.i = (cache.i + 1) % resolveCacheSize;
        return result;
    }
}
class ResolveCache {
    constructor() {
        this.elts = [];
        this.i = 0;
    }
}
const resolveCacheSize = 12, resolveCache = new WeakMap();
/**
Represents a flat range of content, i.e. one that starts and
ends in the same node.
*/
class NodeRange {
    /**
    Construct a node range. `$from` and `$to` should point into the
    same node until at least the given `depth`, since a node range
    denotes an adjacent set of nodes in a single parent node.
    */
    constructor(
    /**
    A resolved position along the start of the content. May have a
    `depth` greater than this object's `depth` property, since
    these are the positions that were used to compute the range,
    not re-resolved positions directly at its boundaries.
    */
    $from, 
    /**
    A position along the end of the content. See
    caveat for [`$from`](https://prosemirror.net/docs/ref/#model.NodeRange.$from).
    */
    $to, 
    /**
    The depth of the node that this range points into.
    */
    depth) {
        this.$from = $from;
        this.$to = $to;
        this.depth = depth;
    }
    /**
    The position at the start of the range.
    */
    get start() { return this.$from.before(this.depth + 1); }
    /**
    The position at the end of the range.
    */
    get end() { return this.$to.after(this.depth + 1); }
    /**
    The parent node that the range points into.
    */
    get parent() { return this.$from.node(this.depth); }
    /**
    The start index of the range in the parent node.
    */
    get startIndex() { return this.$from.index(this.depth); }
    /**
    The end index of the range in the parent node.
    */
    get endIndex() { return this.$to.indexAfter(this.depth); }
}

const emptyAttrs = Object.create(null);
/**
This class represents a node in the tree that makes up a
ProseMirror document. So a document is an instance of `Node`, with
children that are also instances of `Node`.

Nodes are persistent data structures. Instead of changing them, you
create new ones with the content you want. Old ones keep pointing
at the old document shape. This is made cheaper by sharing
structure between the old and new data as much as possible, which a
tree shape like this (without back pointers) makes easy.

**Do not** directly mutate the properties of a `Node` object. See
[the guide](https://prosemirror.net/docs/guide/#doc) for more information.
*/
class Node {
    /**
    @internal
    */
    constructor(
    /**
    The type of node that this is.
    */
    type, 
    /**
    An object mapping attribute names to values. The kind of
    attributes allowed and required are
    [determined](https://prosemirror.net/docs/ref/#model.NodeSpec.attrs) by the node type.
    */
    attrs, 
    // A fragment holding the node's children.
    content, 
    /**
    The marks (things like whether it is emphasized or part of a
    link) applied to this node.
    */
    marks = Mark.none) {
        this.type = type;
        this.attrs = attrs;
        this.marks = marks;
        this.content = content || Fragment.empty;
    }
    /**
    The array of this node's child nodes.
    */
    get children() { return this.content.content; }
    /**
    The size of this node, as defined by the integer-based [indexing
    scheme](https://prosemirror.net/docs/guide/#doc.indexing). For text nodes, this is the
    amount of characters. For other leaf nodes, it is one. For
    non-leaf nodes, it is the size of the content plus two (the
    start and end token).
    */
    get nodeSize() { return this.isLeaf ? 1 : 2 + this.content.size; }
    /**
    The number of children that the node has.
    */
    get childCount() { return this.content.childCount; }
    /**
    Get the child node at the given index. Raises an error when the
    index is out of range.
    */
    child(index) { return this.content.child(index); }
    /**
    Get the child node at the given index, if it exists.
    */
    maybeChild(index) { return this.content.maybeChild(index); }
    /**
    Call `f` for every child node, passing the node, its offset
    into this parent node, and its index.
    */
    forEach(f) { this.content.forEach(f); }
    /**
    Invoke a callback for all descendant nodes recursively between
    the given two positions that are relative to start of this
    node's content. The callback is invoked with the node, its
    position relative to the original node (method receiver),
    its parent node, and its child index. When the callback returns
    false for a given node, that node's children will not be
    recursed over. The last parameter can be used to specify a
    starting position to count from.
    */
    nodesBetween(from, to, f, startPos = 0) {
        this.content.nodesBetween(from, to, f, startPos, this);
    }
    /**
    Call the given callback for every descendant node. Doesn't
    descend into a node when the callback returns `false`.
    */
    descendants(f) {
        this.nodesBetween(0, this.content.size, f);
    }
    /**
    Concatenates all the text nodes found in this fragment and its
    children.
    */
    get textContent() {
        return (this.isLeaf && this.type.spec.leafText)
            ? this.type.spec.leafText(this)
            : this.textBetween(0, this.content.size, "");
    }
    /**
    Get all text between positions `from` and `to`. When
    `blockSeparator` is given, it will be inserted to separate text
    from different block nodes. If `leafText` is given, it'll be
    inserted for every non-text leaf node encountered, otherwise
    [`leafText`](https://prosemirror.net/docs/ref/#model.NodeSpec.leafText) will be used.
    */
    textBetween(from, to, blockSeparator, leafText) {
        return this.content.textBetween(from, to, blockSeparator, leafText);
    }
    /**
    Returns this node's first child, or `null` if there are no
    children.
    */
    get firstChild() { return this.content.firstChild; }
    /**
    Returns this node's last child, or `null` if there are no
    children.
    */
    get lastChild() { return this.content.lastChild; }
    /**
    Test whether two nodes represent the same piece of document.
    */
    eq(other) {
        return this == other || (this.sameMarkup(other) && this.content.eq(other.content));
    }
    /**
    Compare the markup (type, attributes, and marks) of this node to
    those of another. Returns `true` if both have the same markup.
    */
    sameMarkup(other) {
        return this.hasMarkup(other.type, other.attrs, other.marks);
    }
    /**
    Check whether this node's markup correspond to the given type,
    attributes, and marks.
    */
    hasMarkup(type, attrs, marks) {
        return this.type == type &&
            compareDeep(this.attrs, attrs || type.defaultAttrs || emptyAttrs) &&
            Mark.sameSet(this.marks, marks || Mark.none);
    }
    /**
    Create a new node with the same markup as this node, containing
    the given content (or empty, if no content is given).
    */
    copy(content = null) {
        if (content == this.content)
            return this;
        return new Node(this.type, this.attrs, content, this.marks);
    }
    /**
    Create a copy of this node, with the given set of marks instead
    of the node's own marks.
    */
    mark(marks) {
        return marks == this.marks ? this : new Node(this.type, this.attrs, this.content, marks);
    }
    /**
    Create a copy of this node with only the content between the
    given positions. If `to` is not given, it defaults to the end of
    the node.
    */
    cut(from, to = this.content.size) {
        if (from == 0 && to == this.content.size)
            return this;
        return this.copy(this.content.cut(from, to));
    }
    /**
    Cut out the part of the document between the given positions, and
    return it as a `Slice` object.
    */
    slice(from, to = this.content.size, includeParents = false) {
        if (from == to)
            return Slice.empty;
        let $from = this.resolve(from), $to = this.resolve(to);
        let depth = includeParents ? 0 : $from.sharedDepth(to);
        let start = $from.start(depth), node = $from.node(depth);
        let content = node.content.cut($from.pos - start, $to.pos - start);
        return new Slice(content, $from.depth - depth, $to.depth - depth);
    }
    /**
    Replace the part of the document between the given positions with
    the given slice. The slice must 'fit', meaning its open sides
    must be able to connect to the surrounding content, and its
    content nodes must be valid children for the node they are placed
    into. If any of this is violated, an error of type
    [`ReplaceError`](https://prosemirror.net/docs/ref/#model.ReplaceError) is thrown.
    */
    replace(from, to, slice) {
        return replace(this.resolve(from), this.resolve(to), slice);
    }
    /**
    Find the node directly after the given position.
    */
    nodeAt(pos) {
        for (let node = this;;) {
            let { index, offset } = node.content.findIndex(pos);
            node = node.maybeChild(index);
            if (!node)
                return null;
            if (offset == pos || node.isText)
                return node;
            pos -= offset + 1;
        }
    }
    /**
    Find the (direct) child node after the given offset, if any,
    and return it along with its index and offset relative to this
    node.
    */
    childAfter(pos) {
        let { index, offset } = this.content.findIndex(pos);
        return { node: this.content.maybeChild(index), index, offset };
    }
    /**
    Find the (direct) child node before the given offset, if any,
    and return it along with its index and offset relative to this
    node.
    */
    childBefore(pos) {
        if (pos == 0)
            return { node: null, index: 0, offset: 0 };
        let { index, offset } = this.content.findIndex(pos);
        if (offset < pos)
            return { node: this.content.child(index), index, offset };
        let node = this.content.child(index - 1);
        return { node, index: index - 1, offset: offset - node.nodeSize };
    }
    /**
    Resolve the given position in the document, returning an
    [object](https://prosemirror.net/docs/ref/#model.ResolvedPos) with information about its context.
    */
    resolve(pos) { return ResolvedPos.resolveCached(this, pos); }
    /**
    @internal
    */
    resolveNoCache(pos) { return ResolvedPos.resolve(this, pos); }
    /**
    Test whether a given mark or mark type occurs in this document
    between the two given positions.
    */
    rangeHasMark(from, to, type) {
        let found = false;
        if (to > from)
            this.nodesBetween(from, to, node => {
                if (type.isInSet(node.marks))
                    found = true;
                return !found;
            });
        return found;
    }
    /**
    True when this is a block (non-inline node)
    */
    get isBlock() { return this.type.isBlock; }
    /**
    True when this is a textblock node, a block node with inline
    content.
    */
    get isTextblock() { return this.type.isTextblock; }
    /**
    True when this node allows inline content.
    */
    get inlineContent() { return this.type.inlineContent; }
    /**
    True when this is an inline node (a text node or a node that can
    appear among text).
    */
    get isInline() { return this.type.isInline; }
    /**
    True when this is a text node.
    */
    get isText() { return this.type.isText; }
    /**
    True when this is a leaf node.
    */
    get isLeaf() { return this.type.isLeaf; }
    /**
    True when this is an atom, i.e. when it does not have directly
    editable content. This is usually the same as `isLeaf`, but can
    be configured with the [`atom` property](https://prosemirror.net/docs/ref/#model.NodeSpec.atom)
    on a node's spec (typically used when the node is displayed as
    an uneditable [node view](https://prosemirror.net/docs/ref/#view.NodeView)).
    */
    get isAtom() { return this.type.isAtom; }
    /**
    Return a string representation of this node for debugging
    purposes.
    */
    toString() {
        if (this.type.spec.toDebugString)
            return this.type.spec.toDebugString(this);
        let name = this.type.name;
        if (this.content.size)
            name += "(" + this.content.toStringInner() + ")";
        return wrapMarks(this.marks, name);
    }
    /**
    Get the content match in this node at the given index.
    */
    contentMatchAt(index) {
        let match = this.type.contentMatch.matchFragment(this.content, 0, index);
        if (!match)
            throw new Error("Called contentMatchAt on a node with invalid content");
        return match;
    }
    /**
    Test whether replacing the range between `from` and `to` (by
    child index) with the given replacement fragment (which defaults
    to the empty fragment) would leave the node's content valid. You
    can optionally pass `start` and `end` indices into the
    replacement fragment.
    */
    canReplace(from, to, replacement = Fragment.empty, start = 0, end = replacement.childCount) {
        let one = this.contentMatchAt(from).matchFragment(replacement, start, end);
        let two = one && one.matchFragment(this.content, to);
        if (!two || !two.validEnd)
            return false;
        for (let i = start; i < end; i++)
            if (!this.type.allowsMarks(replacement.child(i).marks))
                return false;
        return true;
    }
    /**
    Test whether replacing the range `from` to `to` (by index) with
    a node of the given type would leave the node's content valid.
    */
    canReplaceWith(from, to, type, marks) {
        if (marks && !this.type.allowsMarks(marks))
            return false;
        let start = this.contentMatchAt(from).matchType(type);
        let end = start && start.matchFragment(this.content, to);
        return end ? end.validEnd : false;
    }
    /**
    Test whether the given node's content could be appended to this
    node. If that node is empty, this will only return true if there
    is at least one node type that can appear in both nodes (to avoid
    merging completely incompatible nodes).
    */
    canAppend(other) {
        if (other.content.size)
            return this.canReplace(this.childCount, this.childCount, other.content);
        else
            return this.type.compatibleContent(other.type);
    }
    /**
    Check whether this node and its descendants conform to the
    schema, and raise an exception when they do not.
    */
    check() {
        this.type.checkContent(this.content);
        this.type.checkAttrs(this.attrs);
        let copy = Mark.none;
        for (let i = 0; i < this.marks.length; i++) {
            let mark = this.marks[i];
            mark.type.checkAttrs(mark.attrs);
            copy = mark.addToSet(copy);
        }
        if (!Mark.sameSet(copy, this.marks))
            throw new RangeError(`Invalid collection of marks for node ${this.type.name}: ${this.marks.map(m => m.type.name)}`);
        this.content.forEach(node => node.check());
    }
    /**
    Return a JSON-serializeable representation of this node.
    */
    toJSON() {
        let obj = { type: this.type.name };
        for (let _ in this.attrs) {
            obj.attrs = this.attrs;
            break;
        }
        if (this.content.size)
            obj.content = this.content.toJSON();
        if (this.marks.length)
            obj.marks = this.marks.map(n => n.toJSON());
        return obj;
    }
    /**
    Deserialize a node from its JSON representation.
    */
    static fromJSON(schema, json) {
        if (!json)
            throw new RangeError("Invalid input for Node.fromJSON");
        let marks = undefined;
        if (json.marks) {
            if (!Array.isArray(json.marks))
                throw new RangeError("Invalid mark data for Node.fromJSON");
            marks = json.marks.map(schema.markFromJSON);
        }
        if (json.type == "text") {
            if (typeof json.text != "string")
                throw new RangeError("Invalid text node in JSON");
            return schema.text(json.text, marks);
        }
        let content = Fragment.fromJSON(schema, json.content);
        let node = schema.nodeType(json.type).create(json.attrs, content, marks);
        node.type.checkAttrs(node.attrs);
        return node;
    }
}
Node.prototype.text = undefined;
class TextNode extends Node {
    /**
    @internal
    */
    constructor(type, attrs, content, marks) {
        super(type, attrs, null, marks);
        if (!content)
            throw new RangeError("Empty text nodes are not allowed");
        this.text = content;
    }
    toString() {
        if (this.type.spec.toDebugString)
            return this.type.spec.toDebugString(this);
        return wrapMarks(this.marks, JSON.stringify(this.text));
    }
    get textContent() { return this.text; }
    textBetween(from, to) { return this.text.slice(from, to); }
    get nodeSize() { return this.text.length; }
    mark(marks) {
        return marks == this.marks ? this : new TextNode(this.type, this.attrs, this.text, marks);
    }
    withText(text) {
        if (text == this.text)
            return this;
        return new TextNode(this.type, this.attrs, text, this.marks);
    }
    cut(from = 0, to = this.text.length) {
        if (from == 0 && to == this.text.length)
            return this;
        return this.withText(this.text.slice(from, to));
    }
    eq(other) {
        return this.sameMarkup(other) && this.text == other.text;
    }
    toJSON() {
        let base = super.toJSON();
        base.text = this.text;
        return base;
    }
}
function wrapMarks(marks, str) {
    for (let i = marks.length - 1; i >= 0; i--)
        str = marks[i].type.name + "(" + str + ")";
    return str;
}

/**
Instances of this class represent a match state of a node type's
[content expression](https://prosemirror.net/docs/ref/#model.NodeSpec.content), and can be used to
find out whether further content matches here, and whether a given
position is a valid end of the node.
*/
class ContentMatch {
    /**
    @internal
    */
    constructor(
    /**
    True when this match state represents a valid end of the node.
    */
    validEnd) {
        this.validEnd = validEnd;
        /**
        @internal
        */
        this.next = [];
        /**
        @internal
        */
        this.wrapCache = [];
    }
    /**
    @internal
    */
    static parse(string, nodeTypes) {
        let stream = new TokenStream(string, nodeTypes);
        if (stream.next == null)
            return ContentMatch.empty;
        let expr = parseExpr(stream);
        if (stream.next)
            stream.err("Unexpected trailing text");
        let match = dfa(nfa(expr));
        checkForDeadEnds(match, stream);
        return match;
    }
    /**
    Match a node type, returning a match after that node if
    successful.
    */
    matchType(type) {
        for (let i = 0; i < this.next.length; i++)
            if (this.next[i].type == type)
                return this.next[i].next;
        return null;
    }
    /**
    Try to match a fragment. Returns the resulting match when
    successful.
    */
    matchFragment(frag, start = 0, end = frag.childCount) {
        let cur = this;
        for (let i = start; cur && i < end; i++)
            cur = cur.matchType(frag.child(i).type);
        return cur;
    }
    /**
    @internal
    */
    get inlineContent() {
        return this.next.length != 0 && this.next[0].type.isInline;
    }
    /**
    Get the first matching node type at this match position that can
    be generated.
    */
    get defaultType() {
        for (let i = 0; i < this.next.length; i++) {
            let { type } = this.next[i];
            if (!(type.isText || type.hasRequiredAttrs()))
                return type;
        }
        return null;
    }
    /**
    @internal
    */
    compatible(other) {
        for (let i = 0; i < this.next.length; i++)
            for (let j = 0; j < other.next.length; j++)
                if (this.next[i].type == other.next[j].type)
                    return true;
        return false;
    }
    /**
    Try to match the given fragment, and if that fails, see if it can
    be made to match by inserting nodes in front of it. When
    successful, return a fragment of inserted nodes (which may be
    empty if nothing had to be inserted). When `toEnd` is true, only
    return a fragment if the resulting match goes to the end of the
    content expression.
    */
    fillBefore(after, toEnd = false, startIndex = 0) {
        let seen = [this];
        function search(match, types) {
            let finished = match.matchFragment(after, startIndex);
            if (finished && (!toEnd || finished.validEnd))
                return Fragment.from(types.map(tp => tp.createAndFill()));
            for (let i = 0; i < match.next.length; i++) {
                let { type, next } = match.next[i];
                if (!(type.isText || type.hasRequiredAttrs()) && seen.indexOf(next) == -1) {
                    seen.push(next);
                    let found = search(next, types.concat(type));
                    if (found)
                        return found;
                }
            }
            return null;
        }
        return search(this, []);
    }
    /**
    Find a set of wrapping node types that would allow a node of the
    given type to appear at this position. The result may be empty
    (when it fits directly) and will be null when no such wrapping
    exists.
    */
    findWrapping(target) {
        for (let i = 0; i < this.wrapCache.length; i += 2)
            if (this.wrapCache[i] == target)
                return this.wrapCache[i + 1];
        let computed = this.computeWrapping(target);
        this.wrapCache.push(target, computed);
        return computed;
    }
    /**
    @internal
    */
    computeWrapping(target) {
        let seen = Object.create(null), active = [{ match: this, type: null, via: null }];
        while (active.length) {
            let current = active.shift(), match = current.match;
            if (match.matchType(target)) {
                let result = [];
                for (let obj = current; obj.type; obj = obj.via)
                    result.push(obj.type);
                return result.reverse();
            }
            for (let i = 0; i < match.next.length; i++) {
                let { type, next } = match.next[i];
                if (!type.isLeaf && !type.hasRequiredAttrs() && !(type.name in seen) && (!current.type || next.validEnd)) {
                    active.push({ match: type.contentMatch, type, via: current });
                    seen[type.name] = true;
                }
            }
        }
        return null;
    }
    /**
    The number of outgoing edges this node has in the finite
    automaton that describes the content expression.
    */
    get edgeCount() {
        return this.next.length;
    }
    /**
    Get the _n_​th outgoing edge from this node in the finite
    automaton that describes the content expression.
    */
    edge(n) {
        if (n >= this.next.length)
            throw new RangeError(`There's no ${n}th edge in this content match`);
        return this.next[n];
    }
    /**
    @internal
    */
    toString() {
        let seen = [];
        function scan(m) {
            seen.push(m);
            for (let i = 0; i < m.next.length; i++)
                if (seen.indexOf(m.next[i].next) == -1)
                    scan(m.next[i].next);
        }
        scan(this);
        return seen.map((m, i) => {
            let out = i + (m.validEnd ? "*" : " ") + " ";
            for (let i = 0; i < m.next.length; i++)
                out += (i ? ", " : "") + m.next[i].type.name + "->" + seen.indexOf(m.next[i].next);
            return out;
        }).join("\n");
    }
}
/**
@internal
*/
ContentMatch.empty = new ContentMatch(true);
class TokenStream {
    constructor(string, nodeTypes) {
        this.string = string;
        this.nodeTypes = nodeTypes;
        this.inline = null;
        this.pos = 0;
        this.tokens = string.split(/\s*(?=\b|\W|$)/);
        if (this.tokens[this.tokens.length - 1] == "")
            this.tokens.pop();
        if (this.tokens[0] == "")
            this.tokens.shift();
    }
    get next() { return this.tokens[this.pos]; }
    eat(tok) { return this.next == tok && (this.pos++ || true); }
    err(str) { throw new SyntaxError(str + " (in content expression '" + this.string + "')"); }
}
function parseExpr(stream) {
    let exprs = [];
    do {
        exprs.push(parseExprSeq(stream));
    } while (stream.eat("|"));
    return exprs.length == 1 ? exprs[0] : { type: "choice", exprs };
}
function parseExprSeq(stream) {
    let exprs = [];
    do {
        exprs.push(parseExprSubscript(stream));
    } while (stream.next && stream.next != ")" && stream.next != "|");
    return exprs.length == 1 ? exprs[0] : { type: "seq", exprs };
}
function parseExprSubscript(stream) {
    let expr = parseExprAtom(stream);
    for (;;) {
        if (stream.eat("+"))
            expr = { type: "plus", expr };
        else if (stream.eat("*"))
            expr = { type: "star", expr };
        else if (stream.eat("?"))
            expr = { type: "opt", expr };
        else if (stream.eat("{"))
            expr = parseExprRange(stream, expr);
        else
            break;
    }
    return expr;
}
function parseNum(stream) {
    if (/\D/.test(stream.next))
        stream.err("Expected number, got '" + stream.next + "'");
    let result = Number(stream.next);
    stream.pos++;
    return result;
}
function parseExprRange(stream, expr) {
    let min = parseNum(stream), max = min;
    if (stream.eat(",")) {
        if (stream.next != "}")
            max = parseNum(stream);
        else
            max = -1;
    }
    if (!stream.eat("}"))
        stream.err("Unclosed braced range");
    return { type: "range", min, max, expr };
}
function resolveName(stream, name) {
    let types = stream.nodeTypes, type = types[name];
    if (type)
        return [type];
    let result = [];
    for (let typeName in types) {
        let type = types[typeName];
        if (type.isInGroup(name))
            result.push(type);
    }
    if (result.length == 0)
        stream.err("No node type or group '" + name + "' found");
    return result;
}
function parseExprAtom(stream) {
    if (stream.eat("(")) {
        let expr = parseExpr(stream);
        if (!stream.eat(")"))
            stream.err("Missing closing paren");
        return expr;
    }
    else if (!/\W/.test(stream.next)) {
        let exprs = resolveName(stream, stream.next).map(type => {
            if (stream.inline == null)
                stream.inline = type.isInline;
            else if (stream.inline != type.isInline)
                stream.err("Mixing inline and block content");
            return { type: "name", value: type };
        });
        stream.pos++;
        return exprs.length == 1 ? exprs[0] : { type: "choice", exprs };
    }
    else {
        stream.err("Unexpected token '" + stream.next + "'");
    }
}
// Construct an NFA from an expression as returned by the parser. The
// NFA is represented as an array of states, which are themselves
// arrays of edges, which are `{term, to}` objects. The first state is
// the entry state and the last node is the success state.
//
// Note that unlike typical NFAs, the edge ordering in this one is
// significant, in that it is used to contruct filler content when
// necessary.
function nfa(expr) {
    let nfa = [[]];
    connect(compile(expr, 0), node());
    return nfa;
    function node() { return nfa.push([]) - 1; }
    function edge(from, to, term) {
        let edge = { term, to };
        nfa[from].push(edge);
        return edge;
    }
    function connect(edges, to) {
        edges.forEach(edge => edge.to = to);
    }
    function compile(expr, from) {
        if (expr.type == "choice") {
            return expr.exprs.reduce((out, expr) => out.concat(compile(expr, from)), []);
        }
        else if (expr.type == "seq") {
            for (let i = 0;; i++) {
                let next = compile(expr.exprs[i], from);
                if (i == expr.exprs.length - 1)
                    return next;
                connect(next, from = node());
            }
        }
        else if (expr.type == "star") {
            let loop = node();
            edge(from, loop);
            connect(compile(expr.expr, loop), loop);
            return [edge(loop)];
        }
        else if (expr.type == "plus") {
            let loop = node();
            connect(compile(expr.expr, from), loop);
            connect(compile(expr.expr, loop), loop);
            return [edge(loop)];
        }
        else if (expr.type == "opt") {
            return [edge(from)].concat(compile(expr.expr, from));
        }
        else if (expr.type == "range") {
            let cur = from;
            for (let i = 0; i < expr.min; i++) {
                let next = node();
                connect(compile(expr.expr, cur), next);
                cur = next;
            }
            if (expr.max == -1) {
                connect(compile(expr.expr, cur), cur);
            }
            else {
                for (let i = expr.min; i < expr.max; i++) {
                    let next = node();
                    edge(cur, next);
                    connect(compile(expr.expr, cur), next);
                    cur = next;
                }
            }
            return [edge(cur)];
        }
        else if (expr.type == "name") {
            return [edge(from, undefined, expr.value)];
        }
        else {
            throw new Error("Unknown expr type");
        }
    }
}
function cmp(a, b) { return b - a; }
// Get the set of nodes reachable by null edges from `node`. Omit
// nodes with only a single null-out-edge, since they may lead to
// needless duplicated nodes.
function nullFrom(nfa, node) {
    let result = [];
    scan(node);
    return result.sort(cmp);
    function scan(node) {
        let edges = nfa[node];
        if (edges.length == 1 && !edges[0].term)
            return scan(edges[0].to);
        result.push(node);
        for (let i = 0; i < edges.length; i++) {
            let { term, to } = edges[i];
            if (!term && result.indexOf(to) == -1)
                scan(to);
        }
    }
}
// Compiles an NFA as produced by `nfa` into a DFA, modeled as a set
// of state objects (`ContentMatch` instances) with transitions
// between them.
function dfa(nfa) {
    let labeled = Object.create(null);
    return explore(nullFrom(nfa, 0));
    function explore(states) {
        let out = [];
        states.forEach(node => {
            nfa[node].forEach(({ term, to }) => {
                if (!term)
                    return;
                let set;
                for (let i = 0; i < out.length; i++)
                    if (out[i][0] == term)
                        set = out[i][1];
                nullFrom(nfa, to).forEach(node => {
                    if (!set)
                        out.push([term, set = []]);
                    if (set.indexOf(node) == -1)
                        set.push(node);
                });
            });
        });
        let state = labeled[states.join(",")] = new ContentMatch(states.indexOf(nfa.length - 1) > -1);
        for (let i = 0; i < out.length; i++) {
            let states = out[i][1].sort(cmp);
            state.next.push({ type: out[i][0], next: labeled[states.join(",")] || explore(states) });
        }
        return state;
    }
}
function checkForDeadEnds(match, stream) {
    for (let i = 0, work = [match]; i < work.length; i++) {
        let state = work[i], dead = !state.validEnd, nodes = [];
        for (let j = 0; j < state.next.length; j++) {
            let { type, next } = state.next[j];
            nodes.push(type.name);
            if (dead && !(type.isText || type.hasRequiredAttrs()))
                dead = false;
            if (work.indexOf(next) == -1)
                work.push(next);
        }
        if (dead)
            stream.err("Only non-generatable nodes (" + nodes.join(", ") + ") in a required position (see https://prosemirror.net/docs/guide/#generatable)");
    }
}

// For node types where all attrs have a default value (or which don't
// have any attributes), build up a single reusable default attribute
// object, and use it for all nodes that don't specify specific
// attributes.
function defaultAttrs(attrs) {
    let defaults = Object.create(null);
    for (let attrName in attrs) {
        let attr = attrs[attrName];
        if (!attr.hasDefault)
            return null;
        defaults[attrName] = attr.default;
    }
    return defaults;
}
function computeAttrs(attrs, value) {
    let built = Object.create(null);
    for (let name in attrs) {
        let given = value && value[name];
        if (given === undefined) {
            let attr = attrs[name];
            if (attr.hasDefault)
                given = attr.default;
            else
                throw new RangeError("No value supplied for attribute " + name);
        }
        built[name] = given;
    }
    return built;
}
function checkAttrs(attrs, values, type, name) {
    for (let name in values)
        if (!(name in attrs))
            throw new RangeError(`Unsupported attribute ${name} for ${type} of type ${name}`);
    for (let name in attrs) {
        let attr = attrs[name];
        if (attr.validate)
            attr.validate(values[name]);
    }
}
function initAttrs(typeName, attrs) {
    let result = Object.create(null);
    if (attrs)
        for (let name in attrs)
            result[name] = new Attribute(typeName, name, attrs[name]);
    return result;
}
/**
Node types are objects allocated once per `Schema` and used to
[tag](https://prosemirror.net/docs/ref/#model.Node.type) `Node` instances. They contain information
about the node type, such as its name and what kind of node it
represents.
*/
class NodeType {
    /**
    @internal
    */
    constructor(
    /**
    The name the node type has in this schema.
    */
    name, 
    /**
    A link back to the `Schema` the node type belongs to.
    */
    schema, 
    /**
    The spec that this type is based on
    */
    spec) {
        this.name = name;
        this.schema = schema;
        this.spec = spec;
        /**
        The set of marks allowed in this node. `null` means all marks
        are allowed.
        */
        this.markSet = null;
        this.groups = spec.group ? spec.group.split(" ") : [];
        this.attrs = initAttrs(name, spec.attrs);
        this.defaultAttrs = defaultAttrs(this.attrs);
        this.contentMatch = null;
        this.inlineContent = null;
        this.isBlock = !(spec.inline || name == "text");
        this.isText = name == "text";
    }
    /**
    True if this is an inline type.
    */
    get isInline() { return !this.isBlock; }
    /**
    True if this is a textblock type, a block that contains inline
    content.
    */
    get isTextblock() { return this.isBlock && this.inlineContent; }
    /**
    True for node types that allow no content.
    */
    get isLeaf() { return this.contentMatch == ContentMatch.empty; }
    /**
    True when this node is an atom, i.e. when it does not have
    directly editable content.
    */
    get isAtom() { return this.isLeaf || !!this.spec.atom; }
    /**
    Return true when this node type is part of the given
    [group](https://prosemirror.net/docs/ref/#model.NodeSpec.group).
    */
    isInGroup(group) {
        return this.groups.indexOf(group) > -1;
    }
    /**
    The node type's [whitespace](https://prosemirror.net/docs/ref/#model.NodeSpec.whitespace) option.
    */
    get whitespace() {
        return this.spec.whitespace || (this.spec.code ? "pre" : "normal");
    }
    /**
    Tells you whether this node type has any required attributes.
    */
    hasRequiredAttrs() {
        for (let n in this.attrs)
            if (this.attrs[n].isRequired)
                return true;
        return false;
    }
    /**
    Indicates whether this node allows some of the same content as
    the given node type.
    */
    compatibleContent(other) {
        return this == other || this.contentMatch.compatible(other.contentMatch);
    }
    /**
    @internal
    */
    computeAttrs(attrs) {
        if (!attrs && this.defaultAttrs)
            return this.defaultAttrs;
        else
            return computeAttrs(this.attrs, attrs);
    }
    /**
    Create a `Node` of this type. The given attributes are
    checked and defaulted (you can pass `null` to use the type's
    defaults entirely, if no required attributes exist). `content`
    may be a `Fragment`, a node, an array of nodes, or
    `null`. Similarly `marks` may be `null` to default to the empty
    set of marks.
    */
    create(attrs = null, content, marks) {
        if (this.isText)
            throw new Error("NodeType.create can't construct text nodes");
        return new Node(this, this.computeAttrs(attrs), Fragment.from(content), Mark.setFrom(marks));
    }
    /**
    Like [`create`](https://prosemirror.net/docs/ref/#model.NodeType.create), but check the given content
    against the node type's content restrictions, and throw an error
    if it doesn't match.
    */
    createChecked(attrs = null, content, marks) {
        content = Fragment.from(content);
        this.checkContent(content);
        return new Node(this, this.computeAttrs(attrs), content, Mark.setFrom(marks));
    }
    /**
    Like [`create`](https://prosemirror.net/docs/ref/#model.NodeType.create), but see if it is
    necessary to add nodes to the start or end of the given fragment
    to make it fit the node. If no fitting wrapping can be found,
    return null. Note that, due to the fact that required nodes can
    always be created, this will always succeed if you pass null or
    `Fragment.empty` as content.
    */
    createAndFill(attrs = null, content, marks) {
        attrs = this.computeAttrs(attrs);
        content = Fragment.from(content);
        if (content.size) {
            let before = this.contentMatch.fillBefore(content);
            if (!before)
                return null;
            content = before.append(content);
        }
        let matched = this.contentMatch.matchFragment(content);
        let after = matched && matched.fillBefore(Fragment.empty, true);
        if (!after)
            return null;
        return new Node(this, attrs, content.append(after), Mark.setFrom(marks));
    }
    /**
    Returns true if the given fragment is valid content for this node
    type.
    */
    validContent(content) {
        let result = this.contentMatch.matchFragment(content);
        if (!result || !result.validEnd)
            return false;
        for (let i = 0; i < content.childCount; i++)
            if (!this.allowsMarks(content.child(i).marks))
                return false;
        return true;
    }
    /**
    Throws a RangeError if the given fragment is not valid content for this
    node type.
    @internal
    */
    checkContent(content) {
        if (!this.validContent(content))
            throw new RangeError(`Invalid content for node ${this.name}: ${content.toString().slice(0, 50)}`);
    }
    /**
    @internal
    */
    checkAttrs(attrs) {
        checkAttrs(this.attrs, attrs, "node", this.name);
    }
    /**
    Check whether the given mark type is allowed in this node.
    */
    allowsMarkType(markType) {
        return this.markSet == null || this.markSet.indexOf(markType) > -1;
    }
    /**
    Test whether the given set of marks are allowed in this node.
    */
    allowsMarks(marks) {
        if (this.markSet == null)
            return true;
        for (let i = 0; i < marks.length; i++)
            if (!this.allowsMarkType(marks[i].type))
                return false;
        return true;
    }
    /**
    Removes the marks that are not allowed in this node from the given set.
    */
    allowedMarks(marks) {
        if (this.markSet == null)
            return marks;
        let copy;
        for (let i = 0; i < marks.length; i++) {
            if (!this.allowsMarkType(marks[i].type)) {
                if (!copy)
                    copy = marks.slice(0, i);
            }
            else if (copy) {
                copy.push(marks[i]);
            }
        }
        return !copy ? marks : copy.length ? copy : Mark.none;
    }
    /**
    @internal
    */
    static compile(nodes, schema) {
        let result = Object.create(null);
        nodes.forEach((name, spec) => result[name] = new NodeType(name, schema, spec));
        let topType = schema.spec.topNode || "doc";
        if (!result[topType])
            throw new RangeError("Schema is missing its top node type ('" + topType + "')");
        if (!result.text)
            throw new RangeError("Every schema needs a 'text' type");
        for (let _ in result.text.attrs)
            throw new RangeError("The text node type should not have attributes");
        return result;
    }
}
function validateType(typeName, attrName, type) {
    let types = type.split("|");
    return (value) => {
        let name = value === null ? "null" : typeof value;
        if (types.indexOf(name) < 0)
            throw new RangeError(`Expected value of type ${types} for attribute ${attrName} on type ${typeName}, got ${name}`);
    };
}
// Attribute descriptors
class Attribute {
    constructor(typeName, attrName, options) {
        this.hasDefault = Object.prototype.hasOwnProperty.call(options, "default");
        this.default = options.default;
        this.validate = typeof options.validate == "string" ? validateType(typeName, attrName, options.validate) : options.validate;
    }
    get isRequired() {
        return !this.hasDefault;
    }
}
// Marks
/**
Like nodes, marks (which are associated with nodes to signify
things like emphasis or being part of a link) are
[tagged](https://prosemirror.net/docs/ref/#model.Mark.type) with type objects, which are
instantiated once per `Schema`.
*/
class MarkType {
    /**
    @internal
    */
    constructor(
    /**
    The name of the mark type.
    */
    name, 
    /**
    @internal
    */
    rank, 
    /**
    The schema that this mark type instance is part of.
    */
    schema, 
    /**
    The spec on which the type is based.
    */
    spec) {
        this.name = name;
        this.rank = rank;
        this.schema = schema;
        this.spec = spec;
        this.attrs = initAttrs(name, spec.attrs);
        this.excluded = null;
        let defaults = defaultAttrs(this.attrs);
        this.instance = defaults ? new Mark(this, defaults) : null;
    }
    /**
    Create a mark of this type. `attrs` may be `null` or an object
    containing only some of the mark's attributes. The others, if
    they have defaults, will be added.
    */
    create(attrs = null) {
        if (!attrs && this.instance)
            return this.instance;
        return new Mark(this, computeAttrs(this.attrs, attrs));
    }
    /**
    @internal
    */
    static compile(marks, schema) {
        let result = Object.create(null), rank = 0;
        marks.forEach((name, spec) => result[name] = new MarkType(name, rank++, schema, spec));
        return result;
    }
    /**
    When there is a mark of this type in the given set, a new set
    without it is returned. Otherwise, the input set is returned.
    */
    removeFromSet(set) {
        for (var i = 0; i < set.length; i++)
            if (set[i].type == this) {
                set = set.slice(0, i).concat(set.slice(i + 1));
                i--;
            }
        return set;
    }
    /**
    Tests whether there is a mark of this type in the given set.
    */
    isInSet(set) {
        for (let i = 0; i < set.length; i++)
            if (set[i].type == this)
                return set[i];
    }
    /**
    @internal
    */
    checkAttrs(attrs) {
        checkAttrs(this.attrs, attrs, "mark", this.name);
    }
    /**
    Queries whether a given mark type is
    [excluded](https://prosemirror.net/docs/ref/#model.MarkSpec.excludes) by this one.
    */
    excludes(other) {
        return this.excluded.indexOf(other) > -1;
    }
}
/**
A document schema. Holds [node](https://prosemirror.net/docs/ref/#model.NodeType) and [mark
type](https://prosemirror.net/docs/ref/#model.MarkType) objects for the nodes and marks that may
occur in conforming documents, and provides functionality for
creating and deserializing such documents.

When given, the type parameters provide the names of the nodes and
marks in this schema.
*/
class Schema {
    /**
    Construct a schema from a schema [specification](https://prosemirror.net/docs/ref/#model.SchemaSpec).
    */
    constructor(spec) {
        /**
        The [linebreak
        replacement](https://prosemirror.net/docs/ref/#model.NodeSpec.linebreakReplacement) node defined
        in this schema, if any.
        */
        this.linebreakReplacement = null;
        /**
        An object for storing whatever values modules may want to
        compute and cache per schema. (If you want to store something
        in it, try to use property names unlikely to clash.)
        */
        this.cached = Object.create(null);
        let instanceSpec = this.spec = {};
        for (let prop in spec)
            instanceSpec[prop] = spec[prop];
        instanceSpec.nodes = dist.from(spec.nodes),
            instanceSpec.marks = dist.from(spec.marks || {}),
            this.nodes = NodeType.compile(this.spec.nodes, this);
        this.marks = MarkType.compile(this.spec.marks, this);
        let contentExprCache = Object.create(null);
        for (let prop in this.nodes) {
            if (prop in this.marks)
                throw new RangeError(prop + " can not be both a node and a mark");
            let type = this.nodes[prop], contentExpr = type.spec.content || "", markExpr = type.spec.marks;
            type.contentMatch = contentExprCache[contentExpr] ||
                (contentExprCache[contentExpr] = ContentMatch.parse(contentExpr, this.nodes));
            type.inlineContent = type.contentMatch.inlineContent;
            if (type.spec.linebreakReplacement) {
                if (this.linebreakReplacement)
                    throw new RangeError("Multiple linebreak nodes defined");
                if (!type.isInline || !type.isLeaf)
                    throw new RangeError("Linebreak replacement nodes must be inline leaf nodes");
                this.linebreakReplacement = type;
            }
            type.markSet = markExpr == "_" ? null :
                markExpr ? gatherMarks(this, markExpr.split(" ")) :
                    markExpr == "" || !type.inlineContent ? [] : null;
        }
        for (let prop in this.marks) {
            let type = this.marks[prop], excl = type.spec.excludes;
            type.excluded = excl == null ? [type] : excl == "" ? [] : gatherMarks(this, excl.split(" "));
        }
        this.nodeFromJSON = json => Node.fromJSON(this, json);
        this.markFromJSON = json => Mark.fromJSON(this, json);
        this.topNodeType = this.nodes[this.spec.topNode || "doc"];
        this.cached.wrappings = Object.create(null);
    }
    /**
    Create a node in this schema. The `type` may be a string or a
    `NodeType` instance. Attributes will be extended with defaults,
    `content` may be a `Fragment`, `null`, a `Node`, or an array of
    nodes.
    */
    node(type, attrs = null, content, marks) {
        if (typeof type == "string")
            type = this.nodeType(type);
        else if (!(type instanceof NodeType))
            throw new RangeError("Invalid node type: " + type);
        else if (type.schema != this)
            throw new RangeError("Node type from different schema used (" + type.name + ")");
        return type.createChecked(attrs, content, marks);
    }
    /**
    Create a text node in the schema. Empty text nodes are not
    allowed.
    */
    text(text, marks) {
        let type = this.nodes.text;
        return new TextNode(type, type.defaultAttrs, text, Mark.setFrom(marks));
    }
    /**
    Create a mark with the given type and attributes.
    */
    mark(type, attrs) {
        if (typeof type == "string")
            type = this.marks[type];
        return type.create(attrs);
    }
    /**
    @internal
    */
    nodeType(name) {
        let found = this.nodes[name];
        if (!found)
            throw new RangeError("Unknown node type: " + name);
        return found;
    }
}
function gatherMarks(schema, marks) {
    let found = [];
    for (let i = 0; i < marks.length; i++) {
        let name = marks[i], mark = schema.marks[name], ok = mark;
        if (mark) {
            found.push(mark);
        }
        else {
            for (let prop in schema.marks) {
                let mark = schema.marks[prop];
                if (name == "_" || (mark.spec.group && mark.spec.group.split(" ").indexOf(name) > -1))
                    found.push(ok = mark);
            }
        }
        if (!ok)
            throw new SyntaxError("Unknown mark type: '" + marks[i] + "'");
    }
    return found;
}

function isTagRule(rule) { return rule.tag != null; }
function isStyleRule(rule) { return rule.style != null; }
/**
A DOM parser represents a strategy for parsing DOM content into a
ProseMirror document conforming to a given schema. Its behavior is
defined by an array of [rules](https://prosemirror.net/docs/ref/#model.ParseRule).
*/
class DOMParser {
    /**
    Create a parser that targets the given schema, using the given
    parsing rules.
    */
    constructor(
    /**
    The schema into which the parser parses.
    */
    schema, 
    /**
    The set of [parse rules](https://prosemirror.net/docs/ref/#model.ParseRule) that the parser
    uses, in order of precedence.
    */
    rules) {
        this.schema = schema;
        this.rules = rules;
        /**
        @internal
        */
        this.tags = [];
        /**
        @internal
        */
        this.styles = [];
        let matchedStyles = this.matchedStyles = [];
        rules.forEach(rule => {
            if (isTagRule(rule)) {
                this.tags.push(rule);
            }
            else if (isStyleRule(rule)) {
                let prop = /[^=]*/.exec(rule.style)[0];
                if (matchedStyles.indexOf(prop) < 0)
                    matchedStyles.push(prop);
                this.styles.push(rule);
            }
        });
        // Only normalize list elements when lists in the schema can't directly contain themselves
        this.normalizeLists = !this.tags.some(r => {
            if (!/^(ul|ol)\b/.test(r.tag) || !r.node)
                return false;
            let node = schema.nodes[r.node];
            return node.contentMatch.matchType(node);
        });
    }
    /**
    Parse a document from the content of a DOM node.
    */
    parse(dom, options = {}) {
        let context = new ParseContext(this, options, false);
        context.addAll(dom, Mark.none, options.from, options.to);
        return context.finish();
    }
    /**
    Parses the content of the given DOM node, like
    [`parse`](https://prosemirror.net/docs/ref/#model.DOMParser.parse), and takes the same set of
    options. But unlike that method, which produces a whole node,
    this one returns a slice that is open at the sides, meaning that
    the schema constraints aren't applied to the start of nodes to
    the left of the input and the end of nodes at the end.
    */
    parseSlice(dom, options = {}) {
        let context = new ParseContext(this, options, true);
        context.addAll(dom, Mark.none, options.from, options.to);
        return Slice.maxOpen(context.finish());
    }
    /**
    @internal
    */
    matchTag(dom, context, after) {
        for (let i = after ? this.tags.indexOf(after) + 1 : 0; i < this.tags.length; i++) {
            let rule = this.tags[i];
            if (matches(dom, rule.tag) &&
                (rule.namespace === undefined || dom.namespaceURI == rule.namespace) &&
                (!rule.context || context.matchesContext(rule.context))) {
                if (rule.getAttrs) {
                    let result = rule.getAttrs(dom);
                    if (result === false)
                        continue;
                    rule.attrs = result || undefined;
                }
                return rule;
            }
        }
    }
    /**
    @internal
    */
    matchStyle(prop, value, context, after) {
        for (let i = after ? this.styles.indexOf(after) + 1 : 0; i < this.styles.length; i++) {
            let rule = this.styles[i], style = rule.style;
            if (style.indexOf(prop) != 0 ||
                rule.context && !context.matchesContext(rule.context) ||
                // Test that the style string either precisely matches the prop,
                // or has an '=' sign after the prop, followed by the given
                // value.
                style.length > prop.length &&
                    (style.charCodeAt(prop.length) != 61 || style.slice(prop.length + 1) != value))
                continue;
            if (rule.getAttrs) {
                let result = rule.getAttrs(value);
                if (result === false)
                    continue;
                rule.attrs = result || undefined;
            }
            return rule;
        }
    }
    /**
    @internal
    */
    static schemaRules(schema) {
        let result = [];
        function insert(rule) {
            let priority = rule.priority == null ? 50 : rule.priority, i = 0;
            for (; i < result.length; i++) {
                let next = result[i], nextPriority = next.priority == null ? 50 : next.priority;
                if (nextPriority < priority)
                    break;
            }
            result.splice(i, 0, rule);
        }
        for (let name in schema.marks) {
            let rules = schema.marks[name].spec.parseDOM;
            if (rules)
                rules.forEach(rule => {
                    insert(rule = copy(rule));
                    if (!(rule.mark || rule.ignore || rule.clearMark))
                        rule.mark = name;
                });
        }
        for (let name in schema.nodes) {
            let rules = schema.nodes[name].spec.parseDOM;
            if (rules)
                rules.forEach(rule => {
                    insert(rule = copy(rule));
                    if (!(rule.node || rule.ignore || rule.mark))
                        rule.node = name;
                });
        }
        return result;
    }
    /**
    Construct a DOM parser using the parsing rules listed in a
    schema's [node specs](https://prosemirror.net/docs/ref/#model.NodeSpec.parseDOM), reordered by
    [priority](https://prosemirror.net/docs/ref/#model.GenericParseRule.priority).
    */
    static fromSchema(schema) {
        return schema.cached.domParser ||
            (schema.cached.domParser = new DOMParser(schema, DOMParser.schemaRules(schema)));
    }
}
const blockTags = {
    address: true, article: true, aside: true, blockquote: true, canvas: true,
    dd: true, div: true, dl: true, fieldset: true, figcaption: true, figure: true,
    footer: true, form: true, h1: true, h2: true, h3: true, h4: true, h5: true,
    h6: true, header: true, hgroup: true, hr: true, li: true, noscript: true, ol: true,
    output: true, p: true, pre: true, section: true, table: true, tfoot: true, ul: true
};
const ignoreTags = {
    head: true, noscript: true, object: true, script: true, style: true, title: true
};
const listTags = { ol: true, ul: true };
// Using a bitfield for node context options
const OPT_PRESERVE_WS = 1, OPT_PRESERVE_WS_FULL = 2, OPT_OPEN_LEFT = 4;
function wsOptionsFor(type, preserveWhitespace, base) {
    if (preserveWhitespace != null)
        return (preserveWhitespace ? OPT_PRESERVE_WS : 0) |
            (preserveWhitespace === "full" ? OPT_PRESERVE_WS_FULL : 0);
    return type && type.whitespace == "pre" ? OPT_PRESERVE_WS | OPT_PRESERVE_WS_FULL : base & ~OPT_OPEN_LEFT;
}
class NodeContext {
    constructor(type, attrs, marks, solid, match, options) {
        this.type = type;
        this.attrs = attrs;
        this.marks = marks;
        this.solid = solid;
        this.options = options;
        this.content = [];
        // Marks applied to the node's children
        this.activeMarks = Mark.none;
        this.match = match || (options & OPT_OPEN_LEFT ? null : type.contentMatch);
    }
    findWrapping(node) {
        if (!this.match) {
            if (!this.type)
                return [];
            let fill = this.type.contentMatch.fillBefore(Fragment.from(node));
            if (fill) {
                this.match = this.type.contentMatch.matchFragment(fill);
            }
            else {
                let start = this.type.contentMatch, wrap;
                if (wrap = start.findWrapping(node.type)) {
                    this.match = start;
                    return wrap;
                }
                else {
                    return null;
                }
            }
        }
        return this.match.findWrapping(node.type);
    }
    finish(openEnd) {
        if (!(this.options & OPT_PRESERVE_WS)) { // Strip trailing whitespace
            let last = this.content[this.content.length - 1], m;
            if (last && last.isText && (m = /[ \t\r\n\u000c]+$/.exec(last.text))) {
                let text = last;
                if (last.text.length == m[0].length)
                    this.content.pop();
                else
                    this.content[this.content.length - 1] = text.withText(text.text.slice(0, text.text.length - m[0].length));
            }
        }
        let content = Fragment.from(this.content);
        if (!openEnd && this.match)
            content = content.append(this.match.fillBefore(Fragment.empty, true));
        return this.type ? this.type.create(this.attrs, content, this.marks) : content;
    }
    inlineContext(node) {
        if (this.type)
            return this.type.inlineContent;
        if (this.content.length)
            return this.content[0].isInline;
        return node.parentNode && !blockTags.hasOwnProperty(node.parentNode.nodeName.toLowerCase());
    }
}
class ParseContext {
    constructor(
    // The parser we are using.
    parser, 
    // The options passed to this parse.
    options, isOpen) {
        this.parser = parser;
        this.options = options;
        this.isOpen = isOpen;
        this.open = 0;
        this.localPreserveWS = false;
        let topNode = options.topNode, topContext;
        let topOptions = wsOptionsFor(null, options.preserveWhitespace, 0) | (isOpen ? OPT_OPEN_LEFT : 0);
        if (topNode)
            topContext = new NodeContext(topNode.type, topNode.attrs, Mark.none, true, options.topMatch || topNode.type.contentMatch, topOptions);
        else if (isOpen)
            topContext = new NodeContext(null, null, Mark.none, true, null, topOptions);
        else
            topContext = new NodeContext(parser.schema.topNodeType, null, Mark.none, true, null, topOptions);
        this.nodes = [topContext];
        this.find = options.findPositions;
        this.needsBlock = false;
    }
    get top() {
        return this.nodes[this.open];
    }
    // Add a DOM node to the content. Text is inserted as text node,
    // otherwise, the node is passed to `addElement` or, if it has a
    // `style` attribute, `addElementWithStyles`.
    addDOM(dom, marks) {
        if (dom.nodeType == 3)
            this.addTextNode(dom, marks);
        else if (dom.nodeType == 1)
            this.addElement(dom, marks);
    }
    addTextNode(dom, marks) {
        let value = dom.nodeValue;
        let top = this.top, preserveWS = (top.options & OPT_PRESERVE_WS_FULL) ? "full"
            : this.localPreserveWS || (top.options & OPT_PRESERVE_WS) > 0;
        let { schema } = this.parser;
        if (preserveWS === "full" ||
            top.inlineContext(dom) ||
            /[^ \t\r\n\u000c]/.test(value)) {
            if (!preserveWS) {
                value = value.replace(/[ \t\r\n\u000c]+/g, " ");
                // If this starts with whitespace, and there is no node before it, or
                // a hard break, or a text node that ends with whitespace, strip the
                // leading space.
                if (/^[ \t\r\n\u000c]/.test(value) && this.open == this.nodes.length - 1) {
                    let nodeBefore = top.content[top.content.length - 1];
                    let domNodeBefore = dom.previousSibling;
                    if (!nodeBefore ||
                        (domNodeBefore && domNodeBefore.nodeName == 'BR') ||
                        (nodeBefore.isText && /[ \t\r\n\u000c]$/.test(nodeBefore.text)))
                        value = value.slice(1);
                }
            }
            else if (preserveWS === "full") {
                value = value.replace(/\r\n?/g, "\n");
            }
            else if (schema.linebreakReplacement && /[\r\n]/.test(value) && this.top.findWrapping(schema.linebreakReplacement.create())) {
                let lines = value.split(/\r?\n|\r/);
                for (let i = 0; i < lines.length; i++) {
                    if (i)
                        this.insertNode(schema.linebreakReplacement.create(), marks, true);
                    if (lines[i])
                        this.insertNode(schema.text(lines[i]), marks, !/\S/.test(lines[i]));
                }
                value = "";
            }
            else {
                value = value.replace(/\r?\n|\r/g, " ");
            }
            if (value)
                this.insertNode(schema.text(value), marks, !/\S/.test(value));
            this.findInText(dom);
        }
        else {
            this.findInside(dom);
        }
    }
    // Try to find a handler for the given tag and use that to parse. If
    // none is found, the element's content nodes are added directly.
    addElement(dom, marks, matchAfter) {
        let outerWS = this.localPreserveWS, top = this.top;
        if (dom.tagName == "PRE" || /pre/.test(dom.style && dom.style.whiteSpace))
            this.localPreserveWS = true;
        let name = dom.nodeName.toLowerCase(), ruleID;
        if (listTags.hasOwnProperty(name) && this.parser.normalizeLists)
            normalizeList(dom);
        let rule = (this.options.ruleFromNode && this.options.ruleFromNode(dom)) ||
            (ruleID = this.parser.matchTag(dom, this, matchAfter));
        out: if (rule ? rule.ignore : ignoreTags.hasOwnProperty(name)) {
            this.findInside(dom);
            this.ignoreFallback(dom, marks);
        }
        else if (!rule || rule.skip || rule.closeParent) {
            if (rule && rule.closeParent)
                this.open = Math.max(0, this.open - 1);
            else if (rule && rule.skip.nodeType)
                dom = rule.skip;
            let sync, oldNeedsBlock = this.needsBlock;
            if (blockTags.hasOwnProperty(name)) {
                if (top.content.length && top.content[0].isInline && this.open) {
                    this.open--;
                    top = this.top;
                }
                sync = true;
                if (!top.type)
                    this.needsBlock = true;
            }
            else if (!dom.firstChild) {
                this.leafFallback(dom, marks);
                break out;
            }
            let innerMarks = rule && rule.skip ? marks : this.readStyles(dom, marks);
            if (innerMarks)
                this.addAll(dom, innerMarks);
            if (sync)
                this.sync(top);
            this.needsBlock = oldNeedsBlock;
        }
        else {
            let innerMarks = this.readStyles(dom, marks);
            if (innerMarks)
                this.addElementByRule(dom, rule, innerMarks, rule.consuming === false ? ruleID : undefined);
        }
        this.localPreserveWS = outerWS;
    }
    // Called for leaf DOM nodes that would otherwise be ignored
    leafFallback(dom, marks) {
        if (dom.nodeName == "BR" && this.top.type && this.top.type.inlineContent)
            this.addTextNode(dom.ownerDocument.createTextNode("\n"), marks);
    }
    // Called for ignored nodes
    ignoreFallback(dom, marks) {
        // Ignored BR nodes should at least create an inline context
        if (dom.nodeName == "BR" && (!this.top.type || !this.top.type.inlineContent))
            this.findPlace(this.parser.schema.text("-"), marks, true);
    }
    // Run any style parser associated with the node's styles. Either
    // return an updated array of marks, or null to indicate some of the
    // styles had a rule with `ignore` set.
    readStyles(dom, marks) {
        let styles = dom.style;
        // Because many properties will only show up in 'normalized' form
        // in `style.item` (i.e. text-decoration becomes
        // text-decoration-line, text-decoration-color, etc), we directly
        // query the styles mentioned in our rules instead of iterating
        // over the items.
        if (styles && styles.length)
            for (let i = 0; i < this.parser.matchedStyles.length; i++) {
                let name = this.parser.matchedStyles[i], value = styles.getPropertyValue(name);
                if (value)
                    for (let after = undefined;;) {
                        let rule = this.parser.matchStyle(name, value, this, after);
                        if (!rule)
                            break;
                        if (rule.ignore)
                            return null;
                        if (rule.clearMark)
                            marks = marks.filter(m => !rule.clearMark(m));
                        else
                            marks = marks.concat(this.parser.schema.marks[rule.mark].create(rule.attrs));
                        if (rule.consuming === false)
                            after = rule;
                        else
                            break;
                    }
            }
        return marks;
    }
    // Look up a handler for the given node. If none are found, return
    // false. Otherwise, apply it, use its return value to drive the way
    // the node's content is wrapped, and return true.
    addElementByRule(dom, rule, marks, continueAfter) {
        let sync, nodeType;
        if (rule.node) {
            nodeType = this.parser.schema.nodes[rule.node];
            if (!nodeType.isLeaf) {
                let inner = this.enter(nodeType, rule.attrs || null, marks, rule.preserveWhitespace);
                if (inner) {
                    sync = true;
                    marks = inner;
                }
            }
            else if (!this.insertNode(nodeType.create(rule.attrs), marks, dom.nodeName == "BR")) {
                this.leafFallback(dom, marks);
            }
        }
        else {
            let markType = this.parser.schema.marks[rule.mark];
            marks = marks.concat(markType.create(rule.attrs));
        }
        let startIn = this.top;
        if (nodeType && nodeType.isLeaf) {
            this.findInside(dom);
        }
        else if (continueAfter) {
            this.addElement(dom, marks, continueAfter);
        }
        else if (rule.getContent) {
            this.findInside(dom);
            rule.getContent(dom, this.parser.schema).forEach(node => this.insertNode(node, marks, false));
        }
        else {
            let contentDOM = dom;
            if (typeof rule.contentElement == "string")
                contentDOM = dom.querySelector(rule.contentElement);
            else if (typeof rule.contentElement == "function")
                contentDOM = rule.contentElement(dom);
            else if (rule.contentElement)
                contentDOM = rule.contentElement;
            this.findAround(dom, contentDOM, true);
            this.addAll(contentDOM, marks);
            this.findAround(dom, contentDOM, false);
        }
        if (sync && this.sync(startIn))
            this.open--;
    }
    // Add all child nodes between `startIndex` and `endIndex` (or the
    // whole node, if not given). If `sync` is passed, use it to
    // synchronize after every block element.
    addAll(parent, marks, startIndex, endIndex) {
        let index = startIndex || 0;
        for (let dom = startIndex ? parent.childNodes[startIndex] : parent.firstChild, end = endIndex == null ? null : parent.childNodes[endIndex]; dom != end; dom = dom.nextSibling, ++index) {
            this.findAtPoint(parent, index);
            this.addDOM(dom, marks);
        }
        this.findAtPoint(parent, index);
    }
    // Try to find a way to fit the given node type into the current
    // context. May add intermediate wrappers and/or leave non-solid
    // nodes that we're in.
    findPlace(node, marks, cautious) {
        let route, sync;
        for (let depth = this.open, penalty = 0; depth >= 0; depth--) {
            let cx = this.nodes[depth];
            let found = cx.findWrapping(node);
            if (found && (!route || route.length > found.length + penalty)) {
                route = found;
                sync = cx;
                if (!found.length)
                    break;
            }
            if (cx.solid) {
                if (cautious)
                    break;
                penalty += 2;
            }
        }
        if (!route)
            return null;
        this.sync(sync);
        for (let i = 0; i < route.length; i++)
            marks = this.enterInner(route[i], null, marks, false);
        return marks;
    }
    // Try to insert the given node, adjusting the context when needed.
    insertNode(node, marks, cautious) {
        if (node.isInline && this.needsBlock && !this.top.type) {
            let block = this.textblockFromContext();
            if (block)
                marks = this.enterInner(block, null, marks);
        }
        let innerMarks = this.findPlace(node, marks, cautious);
        if (innerMarks) {
            this.closeExtra();
            let top = this.top;
            if (top.match)
                top.match = top.match.matchType(node.type);
            let nodeMarks = Mark.none;
            for (let m of innerMarks.concat(node.marks))
                if (top.type ? top.type.allowsMarkType(m.type) : markMayApply(m.type, node.type))
                    nodeMarks = m.addToSet(nodeMarks);
            top.content.push(node.mark(nodeMarks));
            return true;
        }
        return false;
    }
    // Try to start a node of the given type, adjusting the context when
    // necessary.
    enter(type, attrs, marks, preserveWS) {
        let innerMarks = this.findPlace(type.create(attrs), marks, false);
        if (innerMarks)
            innerMarks = this.enterInner(type, attrs, marks, true, preserveWS);
        return innerMarks;
    }
    // Open a node of the given type
    enterInner(type, attrs, marks, solid = false, preserveWS) {
        this.closeExtra();
        let top = this.top;
        top.match = top.match && top.match.matchType(type);
        let options = wsOptionsFor(type, preserveWS, top.options);
        if ((top.options & OPT_OPEN_LEFT) && top.content.length == 0)
            options |= OPT_OPEN_LEFT;
        let applyMarks = Mark.none;
        marks = marks.filter(m => {
            if (top.type ? top.type.allowsMarkType(m.type) : markMayApply(m.type, type)) {
                applyMarks = m.addToSet(applyMarks);
                return false;
            }
            return true;
        });
        this.nodes.push(new NodeContext(type, attrs, applyMarks, solid, null, options));
        this.open++;
        return marks;
    }
    // Make sure all nodes above this.open are finished and added to
    // their parents
    closeExtra(openEnd = false) {
        let i = this.nodes.length - 1;
        if (i > this.open) {
            for (; i > this.open; i--)
                this.nodes[i - 1].content.push(this.nodes[i].finish(openEnd));
            this.nodes.length = this.open + 1;
        }
    }
    finish() {
        this.open = 0;
        this.closeExtra(this.isOpen);
        return this.nodes[0].finish(!!(this.isOpen || this.options.topOpen));
    }
    sync(to) {
        for (let i = this.open; i >= 0; i--) {
            if (this.nodes[i] == to) {
                this.open = i;
                return true;
            }
            else if (this.localPreserveWS) {
                this.nodes[i].options |= OPT_PRESERVE_WS;
            }
        }
        return false;
    }
    get currentPos() {
        this.closeExtra();
        let pos = 0;
        for (let i = this.open; i >= 0; i--) {
            let content = this.nodes[i].content;
            for (let j = content.length - 1; j >= 0; j--)
                pos += content[j].nodeSize;
            if (i)
                pos++;
        }
        return pos;
    }
    findAtPoint(parent, offset) {
        if (this.find)
            for (let i = 0; i < this.find.length; i++) {
                if (this.find[i].node == parent && this.find[i].offset == offset)
                    this.find[i].pos = this.currentPos;
            }
    }
    findInside(parent) {
        if (this.find)
            for (let i = 0; i < this.find.length; i++) {
                if (this.find[i].pos == null && parent.nodeType == 1 && parent.contains(this.find[i].node))
                    this.find[i].pos = this.currentPos;
            }
    }
    findAround(parent, content, before) {
        if (parent != content && this.find)
            for (let i = 0; i < this.find.length; i++) {
                if (this.find[i].pos == null && parent.nodeType == 1 && parent.contains(this.find[i].node)) {
                    let pos = content.compareDocumentPosition(this.find[i].node);
                    if (pos & (before ? 2 : 4))
                        this.find[i].pos = this.currentPos;
                }
            }
    }
    findInText(textNode) {
        if (this.find)
            for (let i = 0; i < this.find.length; i++) {
                if (this.find[i].node == textNode)
                    this.find[i].pos = this.currentPos - (textNode.nodeValue.length - this.find[i].offset);
            }
    }
    // Determines whether the given context string matches this context.
    matchesContext(context) {
        if (context.indexOf("|") > -1)
            return context.split(/\s*\|\s*/).some(this.matchesContext, this);
        let parts = context.split("/");
        let option = this.options.context;
        let useRoot = !this.isOpen && (!option || option.parent.type == this.nodes[0].type);
        let minDepth = -(option ? option.depth + 1 : 0) + (useRoot ? 0 : 1);
        let match = (i, depth) => {
            for (; i >= 0; i--) {
                let part = parts[i];
                if (part == "") {
                    if (i == parts.length - 1 || i == 0)
                        continue;
                    for (; depth >= minDepth; depth--)
                        if (match(i - 1, depth))
                            return true;
                    return false;
                }
                else {
                    let next = depth > 0 || (depth == 0 && useRoot) ? this.nodes[depth].type
                        : option && depth >= minDepth ? option.node(depth - minDepth).type
                            : null;
                    if (!next || (next.name != part && !next.isInGroup(part)))
                        return false;
                    depth--;
                }
            }
            return true;
        };
        return match(parts.length - 1, this.open);
    }
    textblockFromContext() {
        let $context = this.options.context;
        if ($context)
            for (let d = $context.depth; d >= 0; d--) {
                let deflt = $context.node(d).contentMatchAt($context.indexAfter(d)).defaultType;
                if (deflt && deflt.isTextblock && deflt.defaultAttrs)
                    return deflt;
            }
        for (let name in this.parser.schema.nodes) {
            let type = this.parser.schema.nodes[name];
            if (type.isTextblock && type.defaultAttrs)
                return type;
        }
    }
}
// Kludge to work around directly nested list nodes produced by some
// tools and allowed by browsers to mean that the nested list is
// actually part of the list item above it.
function normalizeList(dom) {
    for (let child = dom.firstChild, prevItem = null; child; child = child.nextSibling) {
        let name = child.nodeType == 1 ? child.nodeName.toLowerCase() : null;
        if (name && listTags.hasOwnProperty(name) && prevItem) {
            prevItem.appendChild(child);
            child = prevItem;
        }
        else if (name == "li") {
            prevItem = child;
        }
        else if (name) {
            prevItem = null;
        }
    }
}
// Apply a CSS selector.
function matches(dom, selector) {
    return (dom.matches || dom.msMatchesSelector || dom.webkitMatchesSelector || dom.mozMatchesSelector).call(dom, selector);
}
function copy(obj) {
    let copy = {};
    for (let prop in obj)
        copy[prop] = obj[prop];
    return copy;
}
// Used when finding a mark at the top level of a fragment parse.
// Checks whether it would be reasonable to apply a given mark type to
// a given node, by looking at the way the mark occurs in the schema.
function markMayApply(markType, nodeType) {
    let nodes = nodeType.schema.nodes;
    for (let name in nodes) {
        let parent = nodes[name];
        if (!parent.allowsMarkType(markType))
            continue;
        let seen = [], scan = (match) => {
            seen.push(match);
            for (let i = 0; i < match.edgeCount; i++) {
                let { type, next } = match.edge(i);
                if (type == nodeType)
                    return true;
                if (seen.indexOf(next) < 0 && scan(next))
                    return true;
            }
        };
        if (scan(parent.contentMatch))
            return true;
    }
}

/**
A DOM serializer knows how to convert ProseMirror nodes and
marks of various types to DOM nodes.
*/
class DOMSerializer {
    /**
    Create a serializer. `nodes` should map node names to functions
    that take a node and return a description of the corresponding
    DOM. `marks` does the same for mark names, but also gets an
    argument that tells it whether the mark's content is block or
    inline content (for typical use, it'll always be inline). A mark
    serializer may be `null` to indicate that marks of that type
    should not be serialized.
    */
    constructor(
    /**
    The node serialization functions.
    */
    nodes, 
    /**
    The mark serialization functions.
    */
    marks) {
        this.nodes = nodes;
        this.marks = marks;
    }
    /**
    Serialize the content of this fragment to a DOM fragment. When
    not in the browser, the `document` option, containing a DOM
    document, should be passed so that the serializer can create
    nodes.
    */
    serializeFragment(fragment, options = {}, target) {
        if (!target)
            target = doc(options).createDocumentFragment();
        let top = target, active = [];
        fragment.forEach(node => {
            if (active.length || node.marks.length) {
                let keep = 0, rendered = 0;
                while (keep < active.length && rendered < node.marks.length) {
                    let next = node.marks[rendered];
                    if (!this.marks[next.type.name]) {
                        rendered++;
                        continue;
                    }
                    if (!next.eq(active[keep][0]) || next.type.spec.spanning === false)
                        break;
                    keep++;
                    rendered++;
                }
                while (keep < active.length)
                    top = active.pop()[1];
                while (rendered < node.marks.length) {
                    let add = node.marks[rendered++];
                    let markDOM = this.serializeMark(add, node.isInline, options);
                    if (markDOM) {
                        active.push([add, top]);
                        top.appendChild(markDOM.dom);
                        top = markDOM.contentDOM || markDOM.dom;
                    }
                }
            }
            top.appendChild(this.serializeNodeInner(node, options));
        });
        return target;
    }
    /**
    @internal
    */
    serializeNodeInner(node, options) {
        let { dom, contentDOM } = renderSpec(doc(options), this.nodes[node.type.name](node), null, node.attrs);
        if (contentDOM) {
            if (node.isLeaf)
                throw new RangeError("Content hole not allowed in a leaf node spec");
            this.serializeFragment(node.content, options, contentDOM);
        }
        return dom;
    }
    /**
    Serialize this node to a DOM node. This can be useful when you
    need to serialize a part of a document, as opposed to the whole
    document. To serialize a whole document, use
    [`serializeFragment`](https://prosemirror.net/docs/ref/#model.DOMSerializer.serializeFragment) on
    its [content](https://prosemirror.net/docs/ref/#model.Node.content).
    */
    serializeNode(node, options = {}) {
        let dom = this.serializeNodeInner(node, options);
        for (let i = node.marks.length - 1; i >= 0; i--) {
            let wrap = this.serializeMark(node.marks[i], node.isInline, options);
            if (wrap) {
                (wrap.contentDOM || wrap.dom).appendChild(dom);
                dom = wrap.dom;
            }
        }
        return dom;
    }
    /**
    @internal
    */
    serializeMark(mark, inline, options = {}) {
        let toDOM = this.marks[mark.type.name];
        return toDOM && renderSpec(doc(options), toDOM(mark, inline), null, mark.attrs);
    }
    static renderSpec(doc, structure, xmlNS = null, blockArraysIn) {
        return renderSpec(doc, structure, xmlNS, blockArraysIn);
    }
    /**
    Build a serializer using the [`toDOM`](https://prosemirror.net/docs/ref/#model.NodeSpec.toDOM)
    properties in a schema's node and mark specs.
    */
    static fromSchema(schema) {
        return schema.cached.domSerializer ||
            (schema.cached.domSerializer = new DOMSerializer(this.nodesFromSchema(schema), this.marksFromSchema(schema)));
    }
    /**
    Gather the serializers in a schema's node specs into an object.
    This can be useful as a base to build a custom serializer from.
    */
    static nodesFromSchema(schema) {
        let result = gatherToDOM(schema.nodes);
        if (!result.text)
            result.text = node => node.text;
        return result;
    }
    /**
    Gather the serializers in a schema's mark specs into an object.
    */
    static marksFromSchema(schema) {
        return gatherToDOM(schema.marks);
    }
}
function gatherToDOM(obj) {
    let result = {};
    for (let name in obj) {
        let toDOM = obj[name].spec.toDOM;
        if (toDOM)
            result[name] = toDOM;
    }
    return result;
}
function doc(options) {
    return options.document || window.document;
}
const suspiciousAttributeCache = new WeakMap();
function suspiciousAttributes(attrs) {
    let value = suspiciousAttributeCache.get(attrs);
    if (value === undefined)
        suspiciousAttributeCache.set(attrs, value = suspiciousAttributesInner(attrs));
    return value;
}
function suspiciousAttributesInner(attrs) {
    let result = null;
    function scan(value) {
        if (value && typeof value == "object") {
            if (Array.isArray(value)) {
                if (typeof value[0] == "string") {
                    if (!result)
                        result = [];
                    result.push(value);
                }
                else {
                    for (let i = 0; i < value.length; i++)
                        scan(value[i]);
                }
            }
            else {
                for (let prop in value)
                    scan(value[prop]);
            }
        }
    }
    scan(attrs);
    return result;
}
function renderSpec(doc, structure, xmlNS, blockArraysIn) {
    if (typeof structure == "string")
        return { dom: doc.createTextNode(structure) };
    if (structure.nodeType != null)
        return { dom: structure };
    if (structure.dom && structure.dom.nodeType != null)
        return structure;
    let tagName = structure[0], suspicious;
    if (typeof tagName != "string")
        throw new RangeError("Invalid array passed to renderSpec");
    if (blockArraysIn && (suspicious = suspiciousAttributes(blockArraysIn)) &&
        suspicious.indexOf(structure) > -1)
        throw new RangeError("Using an array from an attribute object as a DOM spec. This may be an attempted cross site scripting attack.");
    let space = tagName.indexOf(" ");
    if (space > 0) {
        xmlNS = tagName.slice(0, space);
        tagName = tagName.slice(space + 1);
    }
    let contentDOM;
    let dom = (xmlNS ? doc.createElementNS(xmlNS, tagName) : doc.createElement(tagName));
    let attrs = structure[1], start = 1;
    if (attrs && typeof attrs == "object" && attrs.nodeType == null && !Array.isArray(attrs)) {
        start = 2;
        for (let name in attrs)
            if (attrs[name] != null) {
                let space = name.indexOf(" ");
                if (space > 0)
                    dom.setAttributeNS(name.slice(0, space), name.slice(space + 1), attrs[name]);
                else if (name == "style" && dom.style)
                    dom.style.cssText = attrs[name];
                else
                    dom.setAttribute(name, attrs[name]);
            }
    }
    for (let i = start; i < structure.length; i++) {
        let child = structure[i];
        if (child === 0) {
            if (i < structure.length - 1 || i > start)
                throw new RangeError("Content hole must be the only child of its parent node");
            return { dom, contentDOM: dom };
        }
        else {
            let { dom: inner, contentDOM: innerContent } = renderSpec(doc, child, xmlNS, blockArraysIn);
            dom.appendChild(inner);
            if (innerContent) {
                if (contentDOM)
                    throw new RangeError("Multiple content holes");
                contentDOM = innerContent;
            }
        }
    }
    return { dom, contentDOM };
}




/***/ }),

/***/ 3772:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $B: function() { return /* binding */ sinkListItem; },
/* harmony export */   Sd: function() { return /* binding */ wrapInList; },
/* harmony export */   T2: function() { return /* binding */ liftListItem; }
/* harmony export */ });
/* unused harmony exports addListNodes, bulletList, listItem, orderedList, splitListItem, splitListItemKeepMarks, wrapRangeInList */
/* harmony import */ var prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(38262);
/* harmony import */ var prosemirror_model__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(58903);




const olDOM = ["ol", 0], ulDOM = ["ul", 0], liDOM = ["li", 0];
/**
An ordered list [node spec](https://prosemirror.net/docs/ref/#model.NodeSpec). Has a single
attribute, `order`, which determines the number at which the list
starts counting, and defaults to 1. Represented as an `<ol>`
element.
*/
const orderedList = {
    attrs: { order: { default: 1, validate: "number" } },
    parseDOM: [{ tag: "ol", getAttrs(dom) {
                return { order: dom.hasAttribute("start") ? +dom.getAttribute("start") : 1 };
            } }],
    toDOM(node) {
        return node.attrs.order == 1 ? olDOM : ["ol", { start: node.attrs.order }, 0];
    }
};
/**
A bullet list node spec, represented in the DOM as `<ul>`.
*/
const bulletList = {
    parseDOM: [{ tag: "ul" }],
    toDOM() { return ulDOM; }
};
/**
A list item (`<li>`) spec.
*/
const listItem = {
    parseDOM: [{ tag: "li" }],
    toDOM() { return liDOM; },
    defining: true
};
function add(obj, props) {
    let copy = {};
    for (let prop in obj)
        copy[prop] = obj[prop];
    for (let prop in props)
        copy[prop] = props[prop];
    return copy;
}
/**
Convenience function for adding list-related node types to a map
specifying the nodes for a schema. Adds
[`orderedList`](https://prosemirror.net/docs/ref/#schema-list.orderedList) as `"ordered_list"`,
[`bulletList`](https://prosemirror.net/docs/ref/#schema-list.bulletList) as `"bullet_list"`, and
[`listItem`](https://prosemirror.net/docs/ref/#schema-list.listItem) as `"list_item"`.

`itemContent` determines the content expression for the list items.
If you want the commands defined in this module to apply to your
list structure, it should have a shape like `"paragraph block*"` or
`"paragraph (ordered_list | bullet_list)*"`. `listGroup` can be
given to assign a group name to the list node types, for example
`"block"`.
*/
function addListNodes(nodes, itemContent, listGroup) {
    return nodes.append({
        ordered_list: add(orderedList, { content: "list_item+", group: listGroup }),
        bullet_list: add(bulletList, { content: "list_item+", group: listGroup }),
        list_item: add(listItem, { content: itemContent })
    });
}
/**
Returns a command function that wraps the selection in a list with
the given type an attributes. If `dispatch` is null, only return a
value to indicate whether this is possible, but don't actually
perform the change.
*/
function wrapInList(listType, attrs = null) {
    return function (state, dispatch) {
        let { $from, $to } = state.selection;
        let range = $from.blockRange($to);
        if (!range)
            return false;
        let tr = dispatch ? state.tr : null;
        if (!wrapRangeInList(tr, range, listType, attrs))
            return false;
        if (dispatch)
            dispatch(tr.scrollIntoView());
        return true;
    };
}
/**
Try to wrap the given node range in a list of the given type.
Return `true` when this is possible, `false` otherwise. When `tr`
is non-null, the wrapping is added to that transaction. When it is
`null`, the function only queries whether the wrapping is
possible.
*/
function wrapRangeInList(tr, range, listType, attrs = null) {
    let doJoin = false, outerRange = range, doc = range.$from.doc;
    // This is at the top of an existing list item
    if (range.depth >= 2 && range.$from.node(range.depth - 1).type.compatibleContent(listType) && range.startIndex == 0) {
        // Don't do anything if this is the top of the list
        if (range.$from.index(range.depth - 1) == 0)
            return false;
        let $insert = doc.resolve(range.start - 2);
        outerRange = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .NodeRange */ .u$($insert, $insert, range.depth);
        if (range.endIndex < range.parent.childCount)
            range = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .NodeRange */ .u$(range.$from, doc.resolve(range.$to.end(range.depth)), range.depth);
        doJoin = true;
    }
    let wrap = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .findWrapping */ .oM)(outerRange, listType, attrs, range);
    if (!wrap)
        return false;
    if (tr)
        doWrapInList(tr, range, wrap, doJoin, listType);
    return true;
}
function doWrapInList(tr, range, wrappers, joinBefore, listType) {
    let content = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty;
    for (let i = wrappers.length - 1; i >= 0; i--)
        content = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(wrappers[i].type.create(wrappers[i].attrs, content));
    tr.step(new prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .ReplaceAroundStep */ .Wg(range.start - (joinBefore ? 2 : 0), range.end, range.start, range.end, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(content, 0, 0), wrappers.length, true));
    let found = 0;
    for (let i = 0; i < wrappers.length; i++)
        if (wrappers[i].type == listType)
            found = i + 1;
    let splitDepth = wrappers.length - found;
    let splitPos = range.start + wrappers.length - (joinBefore ? 2 : 0), parent = range.parent;
    for (let i = range.startIndex, e = range.endIndex, first = true; i < e; i++, first = false) {
        if (!first && (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .canSplit */ .zy)(tr.doc, splitPos, splitDepth)) {
            tr.split(splitPos, splitDepth);
            splitPos += 2 * splitDepth;
        }
        splitPos += parent.child(i).nodeSize;
    }
    return tr;
}
/**
Build a command that splits a non-empty textblock at the top level
of a list item by also splitting that list item.
*/
function splitListItem(itemType, itemAttrs) {
    return function (state, dispatch) {
        let { $from, $to, node } = state.selection;
        if ((node && node.isBlock) || $from.depth < 2 || !$from.sameParent($to))
            return false;
        let grandParent = $from.node(-1);
        if (grandParent.type != itemType)
            return false;
        if ($from.parent.content.size == 0 && $from.node(-1).childCount == $from.indexAfter(-1)) {
            // In an empty block. If this is a nested list, the wrapping
            // list item should be split. Otherwise, bail out and let next
            // command handle lifting.
            if ($from.depth == 3 || $from.node(-3).type != itemType ||
                $from.index(-2) != $from.node(-2).childCount - 1)
                return false;
            if (dispatch) {
                let wrap = Fragment.empty;
                let depthBefore = $from.index(-1) ? 1 : $from.index(-2) ? 2 : 3;
                // Build a fragment containing empty versions of the structure
                // from the outer list item to the parent node of the cursor
                for (let d = $from.depth - depthBefore; d >= $from.depth - 3; d--)
                    wrap = Fragment.from($from.node(d).copy(wrap));
                let depthAfter = $from.indexAfter(-1) < $from.node(-2).childCount ? 1
                    : $from.indexAfter(-2) < $from.node(-3).childCount ? 2 : 3;
                // Add a second list item with an empty default start node
                wrap = wrap.append(Fragment.from(itemType.createAndFill()));
                let start = $from.before($from.depth - (depthBefore - 1));
                let tr = state.tr.replace(start, $from.after(-depthAfter), new Slice(wrap, 4 - depthBefore, 0));
                let sel = -1;
                tr.doc.nodesBetween(start, tr.doc.content.size, (node, pos) => {
                    if (sel > -1)
                        return false;
                    if (node.isTextblock && node.content.size == 0)
                        sel = pos + 1;
                });
                if (sel > -1)
                    tr.setSelection(Selection.near(tr.doc.resolve(sel)));
                dispatch(tr.scrollIntoView());
            }
            return true;
        }
        let nextType = $to.pos == $from.end() ? grandParent.contentMatchAt(0).defaultType : null;
        let tr = state.tr.delete($from.pos, $to.pos);
        let types = nextType ? [itemAttrs ? { type: itemType, attrs: itemAttrs } : null, { type: nextType }] : undefined;
        if (!canSplit(tr.doc, $from.pos, 2, types))
            return false;
        if (dispatch)
            dispatch(tr.split($from.pos, 2, types).scrollIntoView());
        return true;
    };
}
/**
Acts like [`splitListItem`](https://prosemirror.net/docs/ref/#schema-list.splitListItem), but
without resetting the set of active marks at the cursor.
*/
function splitListItemKeepMarks(itemType, itemAttrs) {
    let split = splitListItem(itemType, itemAttrs);
    return (state, dispatch) => {
        return split(state, dispatch && (tr => {
            let marks = state.storedMarks || (state.selection.$to.parentOffset && state.selection.$from.marks());
            if (marks)
                tr.ensureMarks(marks);
            dispatch(tr);
        }));
    };
}
/**
Create a command to lift the list item around the selection up into
a wrapping list.
*/
function liftListItem(itemType) {
    return function (state, dispatch) {
        let { $from, $to } = state.selection;
        let range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild.type == itemType);
        if (!range)
            return false;
        if (!dispatch)
            return true;
        if ($from.node(range.depth - 1).type == itemType) // Inside a parent list
            return liftToOuterList(state, dispatch, itemType, range);
        else // Outer list node
            return liftOutOfList(state, dispatch, range);
    };
}
function liftToOuterList(state, dispatch, itemType, range) {
    let tr = state.tr, end = range.end, endOfList = range.$to.end(range.depth);
    if (end < endOfList) {
        // There are siblings after the lifted items, which must become
        // children of the last item
        tr.step(new prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .ReplaceAroundStep */ .Wg(end - 1, endOfList, end, endOfList, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(itemType.create(null, range.parent.copy())), 1, 0), 1, true));
        range = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .NodeRange */ .u$(tr.doc.resolve(range.$from.pos), tr.doc.resolve(endOfList), range.depth);
    }
    const target = (0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .liftTarget */ .jP)(range);
    if (target == null)
        return false;
    tr.lift(range, target);
    let $after = tr.doc.resolve(tr.mapping.map(end, -1) - 1);
    if ((0,prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .canJoin */ .n9)(tr.doc, $after.pos) && $after.nodeBefore.type == $after.nodeAfter.type)
        tr.join($after.pos);
    dispatch(tr.scrollIntoView());
    return true;
}
function liftOutOfList(state, dispatch, range) {
    let tr = state.tr, list = range.parent;
    // Merge the list items into a single big item
    for (let pos = range.end, i = range.endIndex - 1, e = range.startIndex; i > e; i--) {
        pos -= list.child(i).nodeSize;
        tr.delete(pos - 1, pos + 1);
    }
    let $start = tr.doc.resolve(range.start), item = $start.nodeAfter;
    if (tr.mapping.map(range.end) != range.start + $start.nodeAfter.nodeSize)
        return false;
    let atStart = range.startIndex == 0, atEnd = range.endIndex == list.childCount;
    let parent = $start.node(-1), indexBefore = $start.index(-1);
    if (!parent.canReplace(indexBefore + (atStart ? 0 : 1), indexBefore + 1, item.content.append(atEnd ? prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty : prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(list))))
        return false;
    let start = $start.pos, end = start + item.nodeSize;
    // Strip off the surrounding list. At the sides where we're not at
    // the end of the list, the existing list is closed. At sides where
    // this is the end, it is overwritten to its end.
    tr.step(new prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .ReplaceAroundStep */ .Wg(start - (atStart ? 1 : 0), end + (atEnd ? 1 : 0), start + 1, end - 1, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji((atStart ? prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty : prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(list.copy(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty)))
        .append(atEnd ? prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty : prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(list.copy(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty))), atStart ? 0 : 1, atEnd ? 0 : 1), atStart ? 0 : 1));
    dispatch(tr.scrollIntoView());
    return true;
}
/**
Create a command to sink the list item around the selection down
into an inner list.
*/
function sinkListItem(itemType) {
    return function (state, dispatch) {
        let { $from, $to } = state.selection;
        let range = $from.blockRange($to, node => node.childCount > 0 && node.firstChild.type == itemType);
        if (!range)
            return false;
        let startIndex = range.startIndex;
        if (startIndex == 0)
            return false;
        let parent = range.parent, nodeBefore = parent.child(startIndex - 1);
        if (nodeBefore.type != itemType)
            return false;
        if (dispatch) {
            let nestedBefore = nodeBefore.lastChild && nodeBefore.lastChild.type == parent.type;
            let inner = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(nestedBefore ? itemType.create() : null);
            let slice = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(itemType.create(null, prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(parent.type.create(null, inner)))), nestedBefore ? 3 : 1, 0);
            let before = range.start, after = range.end;
            dispatch(state.tr.step(new prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .ReplaceAroundStep */ .Wg(before - (nestedBefore ? 3 : 1), after, before, after, slice, 1, true))
                .scrollIntoView());
        }
        return true;
    };
}




/***/ }),

/***/ 42845:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $t: function() { return /* binding */ EditorState; },
/* harmony export */   LN: function() { return /* binding */ Selection; },
/* harmony export */   U3: function() { return /* binding */ TextSelection; },
/* harmony export */   hs: function() { return /* binding */ PluginKey; },
/* harmony export */   i5: function() { return /* binding */ AllSelection; },
/* harmony export */   k_: function() { return /* binding */ Plugin; },
/* harmony export */   nh: function() { return /* binding */ NodeSelection; }
/* harmony export */ });
/* unused harmony exports SelectionRange, Transaction */
/* harmony import */ var prosemirror_model__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(58903);
/* harmony import */ var prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(38262);



const classesById = Object.create(null);
/**
Superclass for editor selections. Every selection type should
extend this. Should not be instantiated directly.
*/
class Selection {
    /**
    Initialize a selection with the head and anchor and ranges. If no
    ranges are given, constructs a single range across `$anchor` and
    `$head`.
    */
    constructor(
    /**
    The resolved anchor of the selection (the side that stays in
    place when the selection is modified).
    */
    $anchor, 
    /**
    The resolved head of the selection (the side that moves when
    the selection is modified).
    */
    $head, ranges) {
        this.$anchor = $anchor;
        this.$head = $head;
        this.ranges = ranges || [new SelectionRange($anchor.min($head), $anchor.max($head))];
    }
    /**
    The selection's anchor, as an unresolved position.
    */
    get anchor() { return this.$anchor.pos; }
    /**
    The selection's head.
    */
    get head() { return this.$head.pos; }
    /**
    The lower bound of the selection's main range.
    */
    get from() { return this.$from.pos; }
    /**
    The upper bound of the selection's main range.
    */
    get to() { return this.$to.pos; }
    /**
    The resolved lower  bound of the selection's main range.
    */
    get $from() {
        return this.ranges[0].$from;
    }
    /**
    The resolved upper bound of the selection's main range.
    */
    get $to() {
        return this.ranges[0].$to;
    }
    /**
    Indicates whether the selection contains any content.
    */
    get empty() {
        let ranges = this.ranges;
        for (let i = 0; i < ranges.length; i++)
            if (ranges[i].$from.pos != ranges[i].$to.pos)
                return false;
        return true;
    }
    /**
    Get the content of this selection as a slice.
    */
    content() {
        return this.$from.doc.slice(this.from, this.to, true);
    }
    /**
    Replace the selection with a slice or, if no slice is given,
    delete the selection. Will append to the given transaction.
    */
    replace(tr, content = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty) {
        // Put the new selection at the position after the inserted
        // content. When that ended in an inline node, search backwards,
        // to get the position after that node. If not, search forward.
        let lastNode = content.content.lastChild, lastParent = null;
        for (let i = 0; i < content.openEnd; i++) {
            lastParent = lastNode;
            lastNode = lastNode.lastChild;
        }
        let mapFrom = tr.steps.length, ranges = this.ranges;
        for (let i = 0; i < ranges.length; i++) {
            let { $from, $to } = ranges[i], mapping = tr.mapping.slice(mapFrom);
            tr.replaceRange(mapping.map($from.pos), mapping.map($to.pos), i ? prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty : content);
            if (i == 0)
                selectionToInsertionEnd(tr, mapFrom, (lastNode ? lastNode.isInline : lastParent && lastParent.isTextblock) ? -1 : 1);
        }
    }
    /**
    Replace the selection with the given node, appending the changes
    to the given transaction.
    */
    replaceWith(tr, node) {
        let mapFrom = tr.steps.length, ranges = this.ranges;
        for (let i = 0; i < ranges.length; i++) {
            let { $from, $to } = ranges[i], mapping = tr.mapping.slice(mapFrom);
            let from = mapping.map($from.pos), to = mapping.map($to.pos);
            if (i) {
                tr.deleteRange(from, to);
            }
            else {
                tr.replaceRangeWith(from, to, node);
                selectionToInsertionEnd(tr, mapFrom, node.isInline ? -1 : 1);
            }
        }
    }
    /**
    Find a valid cursor or leaf node selection starting at the given
    position and searching back if `dir` is negative, and forward if
    positive. When `textOnly` is true, only consider cursor
    selections. Will return null when no valid selection position is
    found.
    */
    static findFrom($pos, dir, textOnly = false) {
        let inner = $pos.parent.inlineContent ? new TextSelection($pos)
            : findSelectionIn($pos.node(0), $pos.parent, $pos.pos, $pos.index(), dir, textOnly);
        if (inner)
            return inner;
        for (let depth = $pos.depth - 1; depth >= 0; depth--) {
            let found = dir < 0
                ? findSelectionIn($pos.node(0), $pos.node(depth), $pos.before(depth + 1), $pos.index(depth), dir, textOnly)
                : findSelectionIn($pos.node(0), $pos.node(depth), $pos.after(depth + 1), $pos.index(depth) + 1, dir, textOnly);
            if (found)
                return found;
        }
        return null;
    }
    /**
    Find a valid cursor or leaf node selection near the given
    position. Searches forward first by default, but if `bias` is
    negative, it will search backwards first.
    */
    static near($pos, bias = 1) {
        return this.findFrom($pos, bias) || this.findFrom($pos, -bias) || new AllSelection($pos.node(0));
    }
    /**
    Find the cursor or leaf node selection closest to the start of
    the given document. Will return an
    [`AllSelection`](https://prosemirror.net/docs/ref/#state.AllSelection) if no valid position
    exists.
    */
    static atStart(doc) {
        return findSelectionIn(doc, doc, 0, 0, 1) || new AllSelection(doc);
    }
    /**
    Find the cursor or leaf node selection closest to the end of the
    given document.
    */
    static atEnd(doc) {
        return findSelectionIn(doc, doc, doc.content.size, doc.childCount, -1) || new AllSelection(doc);
    }
    /**
    Deserialize the JSON representation of a selection. Must be
    implemented for custom classes (as a static class method).
    */
    static fromJSON(doc, json) {
        if (!json || !json.type)
            throw new RangeError("Invalid input for Selection.fromJSON");
        let cls = classesById[json.type];
        if (!cls)
            throw new RangeError(`No selection type ${json.type} defined`);
        return cls.fromJSON(doc, json);
    }
    /**
    To be able to deserialize selections from JSON, custom selection
    classes must register themselves with an ID string, so that they
    can be disambiguated. Try to pick something that's unlikely to
    clash with classes from other modules.
    */
    static jsonID(id, selectionClass) {
        if (id in classesById)
            throw new RangeError("Duplicate use of selection JSON ID " + id);
        classesById[id] = selectionClass;
        selectionClass.prototype.jsonID = id;
        return selectionClass;
    }
    /**
    Get a [bookmark](https://prosemirror.net/docs/ref/#state.SelectionBookmark) for this selection,
    which is a value that can be mapped without having access to a
    current document, and later resolved to a real selection for a
    given document again. (This is used mostly by the history to
    track and restore old selections.) The default implementation of
    this method just converts the selection to a text selection and
    returns the bookmark for that.
    */
    getBookmark() {
        return TextSelection.between(this.$anchor, this.$head).getBookmark();
    }
}
Selection.prototype.visible = true;
/**
Represents a selected range in a document.
*/
class SelectionRange {
    /**
    Create a range.
    */
    constructor(
    /**
    The lower bound of the range.
    */
    $from, 
    /**
    The upper bound of the range.
    */
    $to) {
        this.$from = $from;
        this.$to = $to;
    }
}
let warnedAboutTextSelection = false;
function checkTextSelection($pos) {
    if (!warnedAboutTextSelection && !$pos.parent.inlineContent) {
        warnedAboutTextSelection = true;
        console["warn"]("TextSelection endpoint not pointing into a node with inline content (" + $pos.parent.type.name + ")");
    }
}
/**
A text selection represents a classical editor selection, with a
head (the moving side) and anchor (immobile side), both of which
point into textblock nodes. It can be empty (a regular cursor
position).
*/
class TextSelection extends Selection {
    /**
    Construct a text selection between the given points.
    */
    constructor($anchor, $head = $anchor) {
        checkTextSelection($anchor);
        checkTextSelection($head);
        super($anchor, $head);
    }
    /**
    Returns a resolved position if this is a cursor selection (an
    empty text selection), and null otherwise.
    */
    get $cursor() { return this.$anchor.pos == this.$head.pos ? this.$head : null; }
    map(doc, mapping) {
        let $head = doc.resolve(mapping.map(this.head));
        if (!$head.parent.inlineContent)
            return Selection.near($head);
        let $anchor = doc.resolve(mapping.map(this.anchor));
        return new TextSelection($anchor.parent.inlineContent ? $anchor : $head, $head);
    }
    replace(tr, content = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty) {
        super.replace(tr, content);
        if (content == prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty) {
            let marks = this.$from.marksAcross(this.$to);
            if (marks)
                tr.ensureMarks(marks);
        }
    }
    eq(other) {
        return other instanceof TextSelection && other.anchor == this.anchor && other.head == this.head;
    }
    getBookmark() {
        return new TextBookmark(this.anchor, this.head);
    }
    toJSON() {
        return { type: "text", anchor: this.anchor, head: this.head };
    }
    /**
    @internal
    */
    static fromJSON(doc, json) {
        if (typeof json.anchor != "number" || typeof json.head != "number")
            throw new RangeError("Invalid input for TextSelection.fromJSON");
        return new TextSelection(doc.resolve(json.anchor), doc.resolve(json.head));
    }
    /**
    Create a text selection from non-resolved positions.
    */
    static create(doc, anchor, head = anchor) {
        let $anchor = doc.resolve(anchor);
        return new this($anchor, head == anchor ? $anchor : doc.resolve(head));
    }
    /**
    Return a text selection that spans the given positions or, if
    they aren't text positions, find a text selection near them.
    `bias` determines whether the method searches forward (default)
    or backwards (negative number) first. Will fall back to calling
    [`Selection.near`](https://prosemirror.net/docs/ref/#state.Selection^near) when the document
    doesn't contain a valid text position.
    */
    static between($anchor, $head, bias) {
        let dPos = $anchor.pos - $head.pos;
        if (!bias || dPos)
            bias = dPos >= 0 ? 1 : -1;
        if (!$head.parent.inlineContent) {
            let found = Selection.findFrom($head, bias, true) || Selection.findFrom($head, -bias, true);
            if (found)
                $head = found.$head;
            else
                return Selection.near($head, bias);
        }
        if (!$anchor.parent.inlineContent) {
            if (dPos == 0) {
                $anchor = $head;
            }
            else {
                $anchor = (Selection.findFrom($anchor, -bias, true) || Selection.findFrom($anchor, bias, true)).$anchor;
                if (($anchor.pos < $head.pos) != (dPos < 0))
                    $anchor = $head;
            }
        }
        return new TextSelection($anchor, $head);
    }
}
Selection.jsonID("text", TextSelection);
class TextBookmark {
    constructor(anchor, head) {
        this.anchor = anchor;
        this.head = head;
    }
    map(mapping) {
        return new TextBookmark(mapping.map(this.anchor), mapping.map(this.head));
    }
    resolve(doc) {
        return TextSelection.between(doc.resolve(this.anchor), doc.resolve(this.head));
    }
}
/**
A node selection is a selection that points at a single node. All
nodes marked [selectable](https://prosemirror.net/docs/ref/#model.NodeSpec.selectable) can be the
target of a node selection. In such a selection, `from` and `to`
point directly before and after the selected node, `anchor` equals
`from`, and `head` equals `to`..
*/
class NodeSelection extends Selection {
    /**
    Create a node selection. Does not verify the validity of its
    argument.
    */
    constructor($pos) {
        let node = $pos.nodeAfter;
        let $end = $pos.node(0).resolve($pos.pos + node.nodeSize);
        super($pos, $end);
        this.node = node;
    }
    map(doc, mapping) {
        let { deleted, pos } = mapping.mapResult(this.anchor);
        let $pos = doc.resolve(pos);
        if (deleted)
            return Selection.near($pos);
        return new NodeSelection($pos);
    }
    content() {
        return new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(this.node), 0, 0);
    }
    eq(other) {
        return other instanceof NodeSelection && other.anchor == this.anchor;
    }
    toJSON() {
        return { type: "node", anchor: this.anchor };
    }
    getBookmark() { return new NodeBookmark(this.anchor); }
    /**
    @internal
    */
    static fromJSON(doc, json) {
        if (typeof json.anchor != "number")
            throw new RangeError("Invalid input for NodeSelection.fromJSON");
        return new NodeSelection(doc.resolve(json.anchor));
    }
    /**
    Create a node selection from non-resolved positions.
    */
    static create(doc, from) {
        return new NodeSelection(doc.resolve(from));
    }
    /**
    Determines whether the given node may be selected as a node
    selection.
    */
    static isSelectable(node) {
        return !node.isText && node.type.spec.selectable !== false;
    }
}
NodeSelection.prototype.visible = false;
Selection.jsonID("node", NodeSelection);
class NodeBookmark {
    constructor(anchor) {
        this.anchor = anchor;
    }
    map(mapping) {
        let { deleted, pos } = mapping.mapResult(this.anchor);
        return deleted ? new TextBookmark(pos, pos) : new NodeBookmark(pos);
    }
    resolve(doc) {
        let $pos = doc.resolve(this.anchor), node = $pos.nodeAfter;
        if (node && NodeSelection.isSelectable(node))
            return new NodeSelection($pos);
        return Selection.near($pos);
    }
}
/**
A selection type that represents selecting the whole document
(which can not necessarily be expressed with a text selection, when
there are for example leaf block nodes at the start or end of the
document).
*/
class AllSelection extends Selection {
    /**
    Create an all-selection over the given document.
    */
    constructor(doc) {
        super(doc.resolve(0), doc.resolve(doc.content.size));
    }
    replace(tr, content = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty) {
        if (content == prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty) {
            tr.delete(0, tr.doc.content.size);
            let sel = Selection.atStart(tr.doc);
            if (!sel.eq(tr.selection))
                tr.setSelection(sel);
        }
        else {
            super.replace(tr, content);
        }
    }
    toJSON() { return { type: "all" }; }
    /**
    @internal
    */
    static fromJSON(doc) { return new AllSelection(doc); }
    map(doc) { return new AllSelection(doc); }
    eq(other) { return other instanceof AllSelection; }
    getBookmark() { return AllBookmark; }
}
Selection.jsonID("all", AllSelection);
const AllBookmark = {
    map() { return this; },
    resolve(doc) { return new AllSelection(doc); }
};
// FIXME we'll need some awareness of text direction when scanning for selections
// Try to find a selection inside the given node. `pos` points at the
// position where the search starts. When `text` is true, only return
// text selections.
function findSelectionIn(doc, node, pos, index, dir, text = false) {
    if (node.inlineContent)
        return TextSelection.create(doc, pos);
    for (let i = index - (dir > 0 ? 0 : 1); dir > 0 ? i < node.childCount : i >= 0; i += dir) {
        let child = node.child(i);
        if (!child.isAtom) {
            let inner = findSelectionIn(doc, child, pos + dir, dir < 0 ? child.childCount : 0, dir, text);
            if (inner)
                return inner;
        }
        else if (!text && NodeSelection.isSelectable(child)) {
            return NodeSelection.create(doc, pos - (dir < 0 ? child.nodeSize : 0));
        }
        pos += child.nodeSize * dir;
    }
    return null;
}
function selectionToInsertionEnd(tr, startLen, bias) {
    let last = tr.steps.length - 1;
    if (last < startLen)
        return;
    let step = tr.steps[last];
    if (!(step instanceof prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .ReplaceStep */ .Ln || step instanceof prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .ReplaceAroundStep */ .Wg))
        return;
    let map = tr.mapping.maps[last], end;
    map.forEach((_from, _to, _newFrom, newTo) => { if (end == null)
        end = newTo; });
    tr.setSelection(Selection.near(tr.doc.resolve(end), bias));
}

const UPDATED_SEL = 1, UPDATED_MARKS = 2, UPDATED_SCROLL = 4;
/**
An editor state transaction, which can be applied to a state to
create an updated state. Use
[`EditorState.tr`](https://prosemirror.net/docs/ref/#state.EditorState.tr) to create an instance.

Transactions track changes to the document (they are a subclass of
[`Transform`](https://prosemirror.net/docs/ref/#transform.Transform)), but also other state changes,
like selection updates and adjustments of the set of [stored
marks](https://prosemirror.net/docs/ref/#state.EditorState.storedMarks). In addition, you can store
metadata properties in a transaction, which are extra pieces of
information that client code or plugins can use to describe what a
transaction represents, so that they can update their [own
state](https://prosemirror.net/docs/ref/#state.StateField) accordingly.

The [editor view](https://prosemirror.net/docs/ref/#view.EditorView) uses a few metadata
properties: it will attach a property `"pointer"` with the value
`true` to selection transactions directly caused by mouse or touch
input, a `"composition"` property holding an ID identifying the
composition that caused it to transactions caused by composed DOM
input, and a `"uiEvent"` property of that may be `"paste"`,
`"cut"`, or `"drop"`.
*/
class Transaction extends prosemirror_transform__WEBPACK_IMPORTED_MODULE_1__/* .Transform */ .dL {
    /**
    @internal
    */
    constructor(state) {
        super(state.doc);
        // The step count for which the current selection is valid.
        this.curSelectionFor = 0;
        // Bitfield to track which aspects of the state were updated by
        // this transaction.
        this.updated = 0;
        // Object used to store metadata properties for the transaction.
        this.meta = Object.create(null);
        this.time = Date.now();
        this.curSelection = state.selection;
        this.storedMarks = state.storedMarks;
    }
    /**
    The transaction's current selection. This defaults to the editor
    selection [mapped](https://prosemirror.net/docs/ref/#state.Selection.map) through the steps in the
    transaction, but can be overwritten with
    [`setSelection`](https://prosemirror.net/docs/ref/#state.Transaction.setSelection).
    */
    get selection() {
        if (this.curSelectionFor < this.steps.length) {
            this.curSelection = this.curSelection.map(this.doc, this.mapping.slice(this.curSelectionFor));
            this.curSelectionFor = this.steps.length;
        }
        return this.curSelection;
    }
    /**
    Update the transaction's current selection. Will determine the
    selection that the editor gets when the transaction is applied.
    */
    setSelection(selection) {
        if (selection.$from.doc != this.doc)
            throw new RangeError("Selection passed to setSelection must point at the current document");
        this.curSelection = selection;
        this.curSelectionFor = this.steps.length;
        this.updated = (this.updated | UPDATED_SEL) & ~UPDATED_MARKS;
        this.storedMarks = null;
        return this;
    }
    /**
    Whether the selection was explicitly updated by this transaction.
    */
    get selectionSet() {
        return (this.updated & UPDATED_SEL) > 0;
    }
    /**
    Set the current stored marks.
    */
    setStoredMarks(marks) {
        this.storedMarks = marks;
        this.updated |= UPDATED_MARKS;
        return this;
    }
    /**
    Make sure the current stored marks or, if that is null, the marks
    at the selection, match the given set of marks. Does nothing if
    this is already the case.
    */
    ensureMarks(marks) {
        if (!prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Mark */ .CU.sameSet(this.storedMarks || this.selection.$from.marks(), marks))
            this.setStoredMarks(marks);
        return this;
    }
    /**
    Add a mark to the set of stored marks.
    */
    addStoredMark(mark) {
        return this.ensureMarks(mark.addToSet(this.storedMarks || this.selection.$head.marks()));
    }
    /**
    Remove a mark or mark type from the set of stored marks.
    */
    removeStoredMark(mark) {
        return this.ensureMarks(mark.removeFromSet(this.storedMarks || this.selection.$head.marks()));
    }
    /**
    Whether the stored marks were explicitly set for this transaction.
    */
    get storedMarksSet() {
        return (this.updated & UPDATED_MARKS) > 0;
    }
    /**
    @internal
    */
    addStep(step, doc) {
        super.addStep(step, doc);
        this.updated = this.updated & ~UPDATED_MARKS;
        this.storedMarks = null;
    }
    /**
    Update the timestamp for the transaction.
    */
    setTime(time) {
        this.time = time;
        return this;
    }
    /**
    Replace the current selection with the given slice.
    */
    replaceSelection(slice) {
        this.selection.replace(this, slice);
        return this;
    }
    /**
    Replace the selection with the given node. When `inheritMarks` is
    true and the content is inline, it inherits the marks from the
    place where it is inserted.
    */
    replaceSelectionWith(node, inheritMarks = true) {
        let selection = this.selection;
        if (inheritMarks)
            node = node.mark(this.storedMarks || (selection.empty ? selection.$from.marks() : (selection.$from.marksAcross(selection.$to) || prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Mark */ .CU.none)));
        selection.replaceWith(this, node);
        return this;
    }
    /**
    Delete the selection.
    */
    deleteSelection() {
        this.selection.replace(this);
        return this;
    }
    /**
    Replace the given range, or the selection if no range is given,
    with a text node containing the given string.
    */
    insertText(text, from, to) {
        let schema = this.doc.type.schema;
        if (from == null) {
            if (!text)
                return this.deleteSelection();
            return this.replaceSelectionWith(schema.text(text), true);
        }
        else {
            if (to == null)
                to = from;
            if (!text)
                return this.deleteRange(from, to);
            let marks = this.storedMarks;
            if (!marks) {
                let $from = this.doc.resolve(from);
                marks = to == from ? $from.marks() : $from.marksAcross(this.doc.resolve(to));
            }
            this.replaceRangeWith(from, to, schema.text(text, marks));
            if (!this.selection.empty && this.selection.to == from + text.length)
                this.setSelection(Selection.near(this.selection.$to));
            return this;
        }
    }
    /**
    Store a metadata property in this transaction, keyed either by
    name or by plugin.
    */
    setMeta(key, value) {
        this.meta[typeof key == "string" ? key : key.key] = value;
        return this;
    }
    /**
    Retrieve a metadata property for a given name or plugin.
    */
    getMeta(key) {
        return this.meta[typeof key == "string" ? key : key.key];
    }
    /**
    Returns true if this transaction doesn't contain any metadata,
    and can thus safely be extended.
    */
    get isGeneric() {
        for (let _ in this.meta)
            return false;
        return true;
    }
    /**
    Indicate that the editor should scroll the selection into view
    when updated to the state produced by this transaction.
    */
    scrollIntoView() {
        this.updated |= UPDATED_SCROLL;
        return this;
    }
    /**
    True when this transaction has had `scrollIntoView` called on it.
    */
    get scrolledIntoView() {
        return (this.updated & UPDATED_SCROLL) > 0;
    }
}

function bind(f, self) {
    return !self || !f ? f : f.bind(self);
}
class FieldDesc {
    constructor(name, desc, self) {
        this.name = name;
        this.init = bind(desc.init, self);
        this.apply = bind(desc.apply, self);
    }
}
const baseFields = [
    new FieldDesc("doc", {
        init(config) { return config.doc || config.schema.topNodeType.createAndFill(); },
        apply(tr) { return tr.doc; }
    }),
    new FieldDesc("selection", {
        init(config, instance) { return config.selection || Selection.atStart(instance.doc); },
        apply(tr) { return tr.selection; }
    }),
    new FieldDesc("storedMarks", {
        init(config) { return config.storedMarks || null; },
        apply(tr, _marks, _old, state) { return state.selection.$cursor ? tr.storedMarks : null; }
    }),
    new FieldDesc("scrollToSelection", {
        init() { return 0; },
        apply(tr, prev) { return tr.scrolledIntoView ? prev + 1 : prev; }
    })
];
// Object wrapping the part of a state object that stays the same
// across transactions. Stored in the state's `config` property.
class Configuration {
    constructor(schema, plugins) {
        this.schema = schema;
        this.plugins = [];
        this.pluginsByKey = Object.create(null);
        this.fields = baseFields.slice();
        if (plugins)
            plugins.forEach(plugin => {
                if (this.pluginsByKey[plugin.key])
                    throw new RangeError("Adding different instances of a keyed plugin (" + plugin.key + ")");
                this.plugins.push(plugin);
                this.pluginsByKey[plugin.key] = plugin;
                if (plugin.spec.state)
                    this.fields.push(new FieldDesc(plugin.key, plugin.spec.state, plugin));
            });
    }
}
/**
The state of a ProseMirror editor is represented by an object of
this type. A state is a persistent data structure—it isn't
updated, but rather a new state value is computed from an old one
using the [`apply`](https://prosemirror.net/docs/ref/#state.EditorState.apply) method.

A state holds a number of built-in fields, and plugins can
[define](https://prosemirror.net/docs/ref/#state.PluginSpec.state) additional fields.
*/
class EditorState {
    /**
    @internal
    */
    constructor(
    /**
    @internal
    */
    config) {
        this.config = config;
    }
    /**
    The schema of the state's document.
    */
    get schema() {
        return this.config.schema;
    }
    /**
    The plugins that are active in this state.
    */
    get plugins() {
        return this.config.plugins;
    }
    /**
    Apply the given transaction to produce a new state.
    */
    apply(tr) {
        return this.applyTransaction(tr).state;
    }
    /**
    @internal
    */
    filterTransaction(tr, ignore = -1) {
        for (let i = 0; i < this.config.plugins.length; i++)
            if (i != ignore) {
                let plugin = this.config.plugins[i];
                if (plugin.spec.filterTransaction && !plugin.spec.filterTransaction.call(plugin, tr, this))
                    return false;
            }
        return true;
    }
    /**
    Verbose variant of [`apply`](https://prosemirror.net/docs/ref/#state.EditorState.apply) that
    returns the precise transactions that were applied (which might
    be influenced by the [transaction
    hooks](https://prosemirror.net/docs/ref/#state.PluginSpec.filterTransaction) of
    plugins) along with the new state.
    */
    applyTransaction(rootTr) {
        if (!this.filterTransaction(rootTr))
            return { state: this, transactions: [] };
        let trs = [rootTr], newState = this.applyInner(rootTr), seen = null;
        // This loop repeatedly gives plugins a chance to respond to
        // transactions as new transactions are added, making sure to only
        // pass the transactions the plugin did not see before.
        for (;;) {
            let haveNew = false;
            for (let i = 0; i < this.config.plugins.length; i++) {
                let plugin = this.config.plugins[i];
                if (plugin.spec.appendTransaction) {
                    let n = seen ? seen[i].n : 0, oldState = seen ? seen[i].state : this;
                    let tr = n < trs.length &&
                        plugin.spec.appendTransaction.call(plugin, n ? trs.slice(n) : trs, oldState, newState);
                    if (tr && newState.filterTransaction(tr, i)) {
                        tr.setMeta("appendedTransaction", rootTr);
                        if (!seen) {
                            seen = [];
                            for (let j = 0; j < this.config.plugins.length; j++)
                                seen.push(j < i ? { state: newState, n: trs.length } : { state: this, n: 0 });
                        }
                        trs.push(tr);
                        newState = newState.applyInner(tr);
                        haveNew = true;
                    }
                    if (seen)
                        seen[i] = { state: newState, n: trs.length };
                }
            }
            if (!haveNew)
                return { state: newState, transactions: trs };
        }
    }
    /**
    @internal
    */
    applyInner(tr) {
        if (!tr.before.eq(this.doc))
            throw new RangeError("Applying a mismatched transaction");
        let newInstance = new EditorState(this.config), fields = this.config.fields;
        for (let i = 0; i < fields.length; i++) {
            let field = fields[i];
            newInstance[field.name] = field.apply(tr, this[field.name], this, newInstance);
        }
        return newInstance;
    }
    /**
    Accessor that constructs and returns a new [transaction](https://prosemirror.net/docs/ref/#state.Transaction) from this state.
    */
    get tr() { return new Transaction(this); }
    /**
    Create a new state.
    */
    static create(config) {
        let $config = new Configuration(config.doc ? config.doc.type.schema : config.schema, config.plugins);
        let instance = new EditorState($config);
        for (let i = 0; i < $config.fields.length; i++)
            instance[$config.fields[i].name] = $config.fields[i].init(config, instance);
        return instance;
    }
    /**
    Create a new state based on this one, but with an adjusted set
    of active plugins. State fields that exist in both sets of
    plugins are kept unchanged. Those that no longer exist are
    dropped, and those that are new are initialized using their
    [`init`](https://prosemirror.net/docs/ref/#state.StateField.init) method, passing in the new
    configuration object..
    */
    reconfigure(config) {
        let $config = new Configuration(this.schema, config.plugins);
        let fields = $config.fields, instance = new EditorState($config);
        for (let i = 0; i < fields.length; i++) {
            let name = fields[i].name;
            instance[name] = this.hasOwnProperty(name) ? this[name] : fields[i].init(config, instance);
        }
        return instance;
    }
    /**
    Serialize this state to JSON. If you want to serialize the state
    of plugins, pass an object mapping property names to use in the
    resulting JSON object to plugin objects. The argument may also be
    a string or number, in which case it is ignored, to support the
    way `JSON.stringify` calls `toString` methods.
    */
    toJSON(pluginFields) {
        let result = { doc: this.doc.toJSON(), selection: this.selection.toJSON() };
        if (this.storedMarks)
            result.storedMarks = this.storedMarks.map(m => m.toJSON());
        if (pluginFields && typeof pluginFields == 'object')
            for (let prop in pluginFields) {
                if (prop == "doc" || prop == "selection")
                    throw new RangeError("The JSON fields `doc` and `selection` are reserved");
                let plugin = pluginFields[prop], state = plugin.spec.state;
                if (state && state.toJSON)
                    result[prop] = state.toJSON.call(plugin, this[plugin.key]);
            }
        return result;
    }
    /**
    Deserialize a JSON representation of a state. `config` should
    have at least a `schema` field, and should contain array of
    plugins to initialize the state with. `pluginFields` can be used
    to deserialize the state of plugins, by associating plugin
    instances with the property names they use in the JSON object.
    */
    static fromJSON(config, json, pluginFields) {
        if (!json)
            throw new RangeError("Invalid input for EditorState.fromJSON");
        if (!config.schema)
            throw new RangeError("Required config field 'schema' missing");
        let $config = new Configuration(config.schema, config.plugins);
        let instance = new EditorState($config);
        $config.fields.forEach(field => {
            if (field.name == "doc") {
                instance.doc = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Node */ .bP.fromJSON(config.schema, json.doc);
            }
            else if (field.name == "selection") {
                instance.selection = Selection.fromJSON(instance.doc, json.selection);
            }
            else if (field.name == "storedMarks") {
                if (json.storedMarks)
                    instance.storedMarks = json.storedMarks.map(config.schema.markFromJSON);
            }
            else {
                if (pluginFields)
                    for (let prop in pluginFields) {
                        let plugin = pluginFields[prop], state = plugin.spec.state;
                        if (plugin.key == field.name && state && state.fromJSON &&
                            Object.prototype.hasOwnProperty.call(json, prop)) {
                            instance[field.name] = state.fromJSON.call(plugin, config, json[prop], instance);
                            return;
                        }
                    }
                instance[field.name] = field.init(config, instance);
            }
        });
        return instance;
    }
}

function bindProps(obj, self, target) {
    for (let prop in obj) {
        let val = obj[prop];
        if (val instanceof Function)
            val = val.bind(self);
        else if (prop == "handleDOMEvents")
            val = bindProps(val, self, {});
        target[prop] = val;
    }
    return target;
}
/**
Plugins bundle functionality that can be added to an editor.
They are part of the [editor state](https://prosemirror.net/docs/ref/#state.EditorState) and
may influence that state and the view that contains it.
*/
class Plugin {
    /**
    Create a plugin.
    */
    constructor(
    /**
    The plugin's [spec object](https://prosemirror.net/docs/ref/#state.PluginSpec).
    */
    spec) {
        this.spec = spec;
        /**
        The [props](https://prosemirror.net/docs/ref/#view.EditorProps) exported by this plugin.
        */
        this.props = {};
        if (spec.props)
            bindProps(spec.props, this, this.props);
        this.key = spec.key ? spec.key.key : createKey("plugin");
    }
    /**
    Extract the plugin's state field from an editor state.
    */
    getState(state) { return state[this.key]; }
}
const keys = Object.create(null);
function createKey(name) {
    if (name in keys)
        return name + "$" + ++keys[name];
    keys[name] = 0;
    return name + "$";
}
/**
A key is used to [tag](https://prosemirror.net/docs/ref/#state.PluginSpec.key) plugins in a way
that makes it possible to find them, given an editor state.
Assigning a key does mean only one plugin of that type can be
active in a state.
*/
class PluginKey {
    /**
    Create a plugin key.
    */
    constructor(name = "key") { this.key = createKey(name); }
    /**
    Get the active plugin with this key, if any, from an editor
    state.
    */
    get(state) { return state.config.pluginsByKey[this.key]; }
    /**
    Get the plugin's state from an editor state.
    */
    getState(state) { return state[this.key]; }
}




/***/ }),

/***/ 38262:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $L: function() { return /* binding */ replaceStep; },
/* harmony export */   Ln: function() { return /* binding */ ReplaceStep; },
/* harmony export */   N0: function() { return /* binding */ joinPoint; },
/* harmony export */   Um: function() { return /* binding */ dropPoint; },
/* harmony export */   Wg: function() { return /* binding */ ReplaceAroundStep; },
/* harmony export */   X9: function() { return /* binding */ Mapping; },
/* harmony export */   Ys: function() { return /* binding */ RemoveMarkStep; },
/* harmony export */   dL: function() { return /* binding */ Transform; },
/* harmony export */   jP: function() { return /* binding */ liftTarget; },
/* harmony export */   n9: function() { return /* binding */ canJoin; },
/* harmony export */   oM: function() { return /* binding */ findWrapping; },
/* harmony export */   zy: function() { return /* binding */ canSplit; }
/* harmony export */ });
/* unused harmony exports AddMarkStep, AddNodeMarkStep, AttrStep, DocAttrStep, MapResult, RemoveNodeMarkStep, Step, StepMap, StepResult, TransformError, insertPoint */
/* harmony import */ var prosemirror_model__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(58903);


// Recovery values encode a range index and an offset. They are
// represented as numbers, because tons of them will be created when
// mapping, for example, a large number of decorations. The number's
// lower 16 bits provide the index, the remaining bits the offset.
//
// Note: We intentionally don't use bit shift operators to en- and
// decode these, since those clip to 32 bits, which we might in rare
// cases want to overflow. A 64-bit float can represent 48-bit
// integers precisely.
const lower16 = 0xffff;
const factor16 = Math.pow(2, 16);
function makeRecover(index, offset) { return index + offset * factor16; }
function recoverIndex(value) { return value & lower16; }
function recoverOffset(value) { return (value - (value & lower16)) / factor16; }
const DEL_BEFORE = 1, DEL_AFTER = 2, DEL_ACROSS = 4, DEL_SIDE = 8;
/**
An object representing a mapped position with extra
information.
*/
class MapResult {
    /**
    @internal
    */
    constructor(
    /**
    The mapped version of the position.
    */
    pos, 
    /**
    @internal
    */
    delInfo, 
    /**
    @internal
    */
    recover) {
        this.pos = pos;
        this.delInfo = delInfo;
        this.recover = recover;
    }
    /**
    Tells you whether the position was deleted, that is, whether the
    step removed the token on the side queried (via the `assoc`)
    argument from the document.
    */
    get deleted() { return (this.delInfo & DEL_SIDE) > 0; }
    /**
    Tells you whether the token before the mapped position was deleted.
    */
    get deletedBefore() { return (this.delInfo & (DEL_BEFORE | DEL_ACROSS)) > 0; }
    /**
    True when the token after the mapped position was deleted.
    */
    get deletedAfter() { return (this.delInfo & (DEL_AFTER | DEL_ACROSS)) > 0; }
    /**
    Tells whether any of the steps mapped through deletes across the
    position (including both the token before and after the
    position).
    */
    get deletedAcross() { return (this.delInfo & DEL_ACROSS) > 0; }
}
/**
A map describing the deletions and insertions made by a step, which
can be used to find the correspondence between positions in the
pre-step version of a document and the same position in the
post-step version.
*/
class StepMap {
    /**
    Create a position map. The modifications to the document are
    represented as an array of numbers, in which each group of three
    represents a modified chunk as `[start, oldSize, newSize]`.
    */
    constructor(
    /**
    @internal
    */
    ranges, 
    /**
    @internal
    */
    inverted = false) {
        this.ranges = ranges;
        this.inverted = inverted;
        if (!ranges.length && StepMap.empty)
            return StepMap.empty;
    }
    /**
    @internal
    */
    recover(value) {
        let diff = 0, index = recoverIndex(value);
        if (!this.inverted)
            for (let i = 0; i < index; i++)
                diff += this.ranges[i * 3 + 2] - this.ranges[i * 3 + 1];
        return this.ranges[index * 3] + diff + recoverOffset(value);
    }
    mapResult(pos, assoc = 1) { return this._map(pos, assoc, false); }
    map(pos, assoc = 1) { return this._map(pos, assoc, true); }
    /**
    @internal
    */
    _map(pos, assoc, simple) {
        let diff = 0, oldIndex = this.inverted ? 2 : 1, newIndex = this.inverted ? 1 : 2;
        for (let i = 0; i < this.ranges.length; i += 3) {
            let start = this.ranges[i] - (this.inverted ? diff : 0);
            if (start > pos)
                break;
            let oldSize = this.ranges[i + oldIndex], newSize = this.ranges[i + newIndex], end = start + oldSize;
            if (pos <= end) {
                let side = !oldSize ? assoc : pos == start ? -1 : pos == end ? 1 : assoc;
                let result = start + diff + (side < 0 ? 0 : newSize);
                if (simple)
                    return result;
                let recover = pos == (assoc < 0 ? start : end) ? null : makeRecover(i / 3, pos - start);
                let del = pos == start ? DEL_AFTER : pos == end ? DEL_BEFORE : DEL_ACROSS;
                if (assoc < 0 ? pos != start : pos != end)
                    del |= DEL_SIDE;
                return new MapResult(result, del, recover);
            }
            diff += newSize - oldSize;
        }
        return simple ? pos + diff : new MapResult(pos + diff, 0, null);
    }
    /**
    @internal
    */
    touches(pos, recover) {
        let diff = 0, index = recoverIndex(recover);
        let oldIndex = this.inverted ? 2 : 1, newIndex = this.inverted ? 1 : 2;
        for (let i = 0; i < this.ranges.length; i += 3) {
            let start = this.ranges[i] - (this.inverted ? diff : 0);
            if (start > pos)
                break;
            let oldSize = this.ranges[i + oldIndex], end = start + oldSize;
            if (pos <= end && i == index * 3)
                return true;
            diff += this.ranges[i + newIndex] - oldSize;
        }
        return false;
    }
    /**
    Calls the given function on each of the changed ranges included in
    this map.
    */
    forEach(f) {
        let oldIndex = this.inverted ? 2 : 1, newIndex = this.inverted ? 1 : 2;
        for (let i = 0, diff = 0; i < this.ranges.length; i += 3) {
            let start = this.ranges[i], oldStart = start - (this.inverted ? diff : 0), newStart = start + (this.inverted ? 0 : diff);
            let oldSize = this.ranges[i + oldIndex], newSize = this.ranges[i + newIndex];
            f(oldStart, oldStart + oldSize, newStart, newStart + newSize);
            diff += newSize - oldSize;
        }
    }
    /**
    Create an inverted version of this map. The result can be used to
    map positions in the post-step document to the pre-step document.
    */
    invert() {
        return new StepMap(this.ranges, !this.inverted);
    }
    /**
    @internal
    */
    toString() {
        return (this.inverted ? "-" : "") + JSON.stringify(this.ranges);
    }
    /**
    Create a map that moves all positions by offset `n` (which may be
    negative). This can be useful when applying steps meant for a
    sub-document to a larger document, or vice-versa.
    */
    static offset(n) {
        return n == 0 ? StepMap.empty : new StepMap(n < 0 ? [0, -n, 0] : [0, 0, n]);
    }
}
/**
A StepMap that contains no changed ranges.
*/
StepMap.empty = new StepMap([]);
/**
A mapping represents a pipeline of zero or more [step
maps](https://prosemirror.net/docs/ref/#transform.StepMap). It has special provisions for losslessly
handling mapping positions through a series of steps in which some
steps are inverted versions of earlier steps. (This comes up when
‘[rebasing](https://prosemirror.net/docs/guide/#transform.rebasing)’ steps for
collaboration or history management.)
*/
class Mapping {
    /**
    Create a new mapping with the given position maps.
    */
    constructor(maps, 
    /**
    @internal
    */
    mirror, 
    /**
    The starting position in the `maps` array, used when `map` or
    `mapResult` is called.
    */
    from = 0, 
    /**
    The end position in the `maps` array.
    */
    to = maps ? maps.length : 0) {
        this.mirror = mirror;
        this.from = from;
        this.to = to;
        this._maps = maps || [];
        this.ownData = !(maps || mirror);
    }
    /**
    The step maps in this mapping.
    */
    get maps() { return this._maps; }
    /**
    Create a mapping that maps only through a part of this one.
    */
    slice(from = 0, to = this.maps.length) {
        return new Mapping(this._maps, this.mirror, from, to);
    }
    /**
    Add a step map to the end of this mapping. If `mirrors` is
    given, it should be the index of the step map that is the mirror
    image of this one.
    */
    appendMap(map, mirrors) {
        if (!this.ownData) {
            this._maps = this._maps.slice();
            this.mirror = this.mirror && this.mirror.slice();
            this.ownData = true;
        }
        this.to = this._maps.push(map);
        if (mirrors != null)
            this.setMirror(this._maps.length - 1, mirrors);
    }
    /**
    Add all the step maps in a given mapping to this one (preserving
    mirroring information).
    */
    appendMapping(mapping) {
        for (let i = 0, startSize = this._maps.length; i < mapping._maps.length; i++) {
            let mirr = mapping.getMirror(i);
            this.appendMap(mapping._maps[i], mirr != null && mirr < i ? startSize + mirr : undefined);
        }
    }
    /**
    Finds the offset of the step map that mirrors the map at the
    given offset, in this mapping (as per the second argument to
    `appendMap`).
    */
    getMirror(n) {
        if (this.mirror)
            for (let i = 0; i < this.mirror.length; i++)
                if (this.mirror[i] == n)
                    return this.mirror[i + (i % 2 ? -1 : 1)];
    }
    /**
    @internal
    */
    setMirror(n, m) {
        if (!this.mirror)
            this.mirror = [];
        this.mirror.push(n, m);
    }
    /**
    Append the inverse of the given mapping to this one.
    */
    appendMappingInverted(mapping) {
        for (let i = mapping.maps.length - 1, totalSize = this._maps.length + mapping._maps.length; i >= 0; i--) {
            let mirr = mapping.getMirror(i);
            this.appendMap(mapping._maps[i].invert(), mirr != null && mirr > i ? totalSize - mirr - 1 : undefined);
        }
    }
    /**
    Create an inverted version of this mapping.
    */
    invert() {
        let inverse = new Mapping;
        inverse.appendMappingInverted(this);
        return inverse;
    }
    /**
    Map a position through this mapping.
    */
    map(pos, assoc = 1) {
        if (this.mirror)
            return this._map(pos, assoc, true);
        for (let i = this.from; i < this.to; i++)
            pos = this._maps[i].map(pos, assoc);
        return pos;
    }
    /**
    Map a position through this mapping, returning a mapping
    result.
    */
    mapResult(pos, assoc = 1) { return this._map(pos, assoc, false); }
    /**
    @internal
    */
    _map(pos, assoc, simple) {
        let delInfo = 0;
        for (let i = this.from; i < this.to; i++) {
            let map = this._maps[i], result = map.mapResult(pos, assoc);
            if (result.recover != null) {
                let corr = this.getMirror(i);
                if (corr != null && corr > i && corr < this.to) {
                    i = corr;
                    pos = this._maps[corr].recover(result.recover);
                    continue;
                }
            }
            delInfo |= result.delInfo;
            pos = result.pos;
        }
        return simple ? pos : new MapResult(pos, delInfo, null);
    }
}

const stepsByID = Object.create(null);
/**
A step object represents an atomic change. It generally applies
only to the document it was created for, since the positions
stored in it will only make sense for that document.

New steps are defined by creating classes that extend `Step`,
overriding the `apply`, `invert`, `map`, `getMap` and `fromJSON`
methods, and registering your class with a unique
JSON-serialization identifier using
[`Step.jsonID`](https://prosemirror.net/docs/ref/#transform.Step^jsonID).
*/
class Step {
    /**
    Get the step map that represents the changes made by this step,
    and which can be used to transform between positions in the old
    and the new document.
    */
    getMap() { return StepMap.empty; }
    /**
    Try to merge this step with another one, to be applied directly
    after it. Returns the merged step when possible, null if the
    steps can't be merged.
    */
    merge(other) { return null; }
    /**
    Deserialize a step from its JSON representation. Will call
    through to the step class' own implementation of this method.
    */
    static fromJSON(schema, json) {
        if (!json || !json.stepType)
            throw new RangeError("Invalid input for Step.fromJSON");
        let type = stepsByID[json.stepType];
        if (!type)
            throw new RangeError(`No step type ${json.stepType} defined`);
        return type.fromJSON(schema, json);
    }
    /**
    To be able to serialize steps to JSON, each step needs a string
    ID to attach to its JSON representation. Use this method to
    register an ID for your step classes. Try to pick something
    that's unlikely to clash with steps from other modules.
    */
    static jsonID(id, stepClass) {
        if (id in stepsByID)
            throw new RangeError("Duplicate use of step JSON ID " + id);
        stepsByID[id] = stepClass;
        stepClass.prototype.jsonID = id;
        return stepClass;
    }
}
/**
The result of [applying](https://prosemirror.net/docs/ref/#transform.Step.apply) a step. Contains either a
new document or a failure value.
*/
class StepResult {
    /**
    @internal
    */
    constructor(
    /**
    The transformed document, if successful.
    */
    doc, 
    /**
    The failure message, if unsuccessful.
    */
    failed) {
        this.doc = doc;
        this.failed = failed;
    }
    /**
    Create a successful step result.
    */
    static ok(doc) { return new StepResult(doc, null); }
    /**
    Create a failed step result.
    */
    static fail(message) { return new StepResult(null, message); }
    /**
    Call [`Node.replace`](https://prosemirror.net/docs/ref/#model.Node.replace) with the given
    arguments. Create a successful result if it succeeds, and a
    failed one if it throws a `ReplaceError`.
    */
    static fromReplace(doc, from, to, slice) {
        try {
            return StepResult.ok(doc.replace(from, to, slice));
        }
        catch (e) {
            if (e instanceof prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .ReplaceError */ .vI)
                return StepResult.fail(e.message);
            throw e;
        }
    }
}

function mapFragment(fragment, f, parent) {
    let mapped = [];
    for (let i = 0; i < fragment.childCount; i++) {
        let child = fragment.child(i);
        if (child.content.size)
            child = child.copy(mapFragment(child.content, f, child));
        if (child.isInline)
            child = f(child, parent, i);
        mapped.push(child);
    }
    return prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.fromArray(mapped);
}
/**
Add a mark to all inline content between two positions.
*/
class AddMarkStep extends Step {
    /**
    Create a mark step.
    */
    constructor(
    /**
    The start of the marked range.
    */
    from, 
    /**
    The end of the marked range.
    */
    to, 
    /**
    The mark to add.
    */
    mark) {
        super();
        this.from = from;
        this.to = to;
        this.mark = mark;
    }
    apply(doc) {
        let oldSlice = doc.slice(this.from, this.to), $from = doc.resolve(this.from);
        let parent = $from.node($from.sharedDepth(this.to));
        let slice = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(mapFragment(oldSlice.content, (node, parent) => {
            if (!node.isAtom || !parent.type.allowsMarkType(this.mark.type))
                return node;
            return node.mark(this.mark.addToSet(node.marks));
        }, parent), oldSlice.openStart, oldSlice.openEnd);
        return StepResult.fromReplace(doc, this.from, this.to, slice);
    }
    invert() {
        return new RemoveMarkStep(this.from, this.to, this.mark);
    }
    map(mapping) {
        let from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1);
        if (from.deleted && to.deleted || from.pos >= to.pos)
            return null;
        return new AddMarkStep(from.pos, to.pos, this.mark);
    }
    merge(other) {
        if (other instanceof AddMarkStep &&
            other.mark.eq(this.mark) &&
            this.from <= other.to && this.to >= other.from)
            return new AddMarkStep(Math.min(this.from, other.from), Math.max(this.to, other.to), this.mark);
        return null;
    }
    toJSON() {
        return { stepType: "addMark", mark: this.mark.toJSON(),
            from: this.from, to: this.to };
    }
    /**
    @internal
    */
    static fromJSON(schema, json) {
        if (typeof json.from != "number" || typeof json.to != "number")
            throw new RangeError("Invalid input for AddMarkStep.fromJSON");
        return new AddMarkStep(json.from, json.to, schema.markFromJSON(json.mark));
    }
}
Step.jsonID("addMark", AddMarkStep);
/**
Remove a mark from all inline content between two positions.
*/
class RemoveMarkStep extends Step {
    /**
    Create a mark-removing step.
    */
    constructor(
    /**
    The start of the unmarked range.
    */
    from, 
    /**
    The end of the unmarked range.
    */
    to, 
    /**
    The mark to remove.
    */
    mark) {
        super();
        this.from = from;
        this.to = to;
        this.mark = mark;
    }
    apply(doc) {
        let oldSlice = doc.slice(this.from, this.to);
        let slice = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(mapFragment(oldSlice.content, node => {
            return node.mark(this.mark.removeFromSet(node.marks));
        }, doc), oldSlice.openStart, oldSlice.openEnd);
        return StepResult.fromReplace(doc, this.from, this.to, slice);
    }
    invert() {
        return new AddMarkStep(this.from, this.to, this.mark);
    }
    map(mapping) {
        let from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1);
        if (from.deleted && to.deleted || from.pos >= to.pos)
            return null;
        return new RemoveMarkStep(from.pos, to.pos, this.mark);
    }
    merge(other) {
        if (other instanceof RemoveMarkStep &&
            other.mark.eq(this.mark) &&
            this.from <= other.to && this.to >= other.from)
            return new RemoveMarkStep(Math.min(this.from, other.from), Math.max(this.to, other.to), this.mark);
        return null;
    }
    toJSON() {
        return { stepType: "removeMark", mark: this.mark.toJSON(),
            from: this.from, to: this.to };
    }
    /**
    @internal
    */
    static fromJSON(schema, json) {
        if (typeof json.from != "number" || typeof json.to != "number")
            throw new RangeError("Invalid input for RemoveMarkStep.fromJSON");
        return new RemoveMarkStep(json.from, json.to, schema.markFromJSON(json.mark));
    }
}
Step.jsonID("removeMark", RemoveMarkStep);
/**
Add a mark to a specific node.
*/
class AddNodeMarkStep extends Step {
    /**
    Create a node mark step.
    */
    constructor(
    /**
    The position of the target node.
    */
    pos, 
    /**
    The mark to add.
    */
    mark) {
        super();
        this.pos = pos;
        this.mark = mark;
    }
    apply(doc) {
        let node = doc.nodeAt(this.pos);
        if (!node)
            return StepResult.fail("No node at mark step's position");
        let updated = node.type.create(node.attrs, null, this.mark.addToSet(node.marks));
        return StepResult.fromReplace(doc, this.pos, this.pos + 1, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(updated), 0, node.isLeaf ? 0 : 1));
    }
    invert(doc) {
        let node = doc.nodeAt(this.pos);
        if (node) {
            let newSet = this.mark.addToSet(node.marks);
            if (newSet.length == node.marks.length) {
                for (let i = 0; i < node.marks.length; i++)
                    if (!node.marks[i].isInSet(newSet))
                        return new AddNodeMarkStep(this.pos, node.marks[i]);
                return new AddNodeMarkStep(this.pos, this.mark);
            }
        }
        return new RemoveNodeMarkStep(this.pos, this.mark);
    }
    map(mapping) {
        let pos = mapping.mapResult(this.pos, 1);
        return pos.deletedAfter ? null : new AddNodeMarkStep(pos.pos, this.mark);
    }
    toJSON() {
        return { stepType: "addNodeMark", pos: this.pos, mark: this.mark.toJSON() };
    }
    /**
    @internal
    */
    static fromJSON(schema, json) {
        if (typeof json.pos != "number")
            throw new RangeError("Invalid input for AddNodeMarkStep.fromJSON");
        return new AddNodeMarkStep(json.pos, schema.markFromJSON(json.mark));
    }
}
Step.jsonID("addNodeMark", AddNodeMarkStep);
/**
Remove a mark from a specific node.
*/
class RemoveNodeMarkStep extends Step {
    /**
    Create a mark-removing step.
    */
    constructor(
    /**
    The position of the target node.
    */
    pos, 
    /**
    The mark to remove.
    */
    mark) {
        super();
        this.pos = pos;
        this.mark = mark;
    }
    apply(doc) {
        let node = doc.nodeAt(this.pos);
        if (!node)
            return StepResult.fail("No node at mark step's position");
        let updated = node.type.create(node.attrs, null, this.mark.removeFromSet(node.marks));
        return StepResult.fromReplace(doc, this.pos, this.pos + 1, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(updated), 0, node.isLeaf ? 0 : 1));
    }
    invert(doc) {
        let node = doc.nodeAt(this.pos);
        if (!node || !this.mark.isInSet(node.marks))
            return this;
        return new AddNodeMarkStep(this.pos, this.mark);
    }
    map(mapping) {
        let pos = mapping.mapResult(this.pos, 1);
        return pos.deletedAfter ? null : new RemoveNodeMarkStep(pos.pos, this.mark);
    }
    toJSON() {
        return { stepType: "removeNodeMark", pos: this.pos, mark: this.mark.toJSON() };
    }
    /**
    @internal
    */
    static fromJSON(schema, json) {
        if (typeof json.pos != "number")
            throw new RangeError("Invalid input for RemoveNodeMarkStep.fromJSON");
        return new RemoveNodeMarkStep(json.pos, schema.markFromJSON(json.mark));
    }
}
Step.jsonID("removeNodeMark", RemoveNodeMarkStep);

/**
Replace a part of the document with a slice of new content.
*/
class ReplaceStep extends Step {
    /**
    The given `slice` should fit the 'gap' between `from` and
    `to`—the depths must line up, and the surrounding nodes must be
    able to be joined with the open sides of the slice. When
    `structure` is true, the step will fail if the content between
    from and to is not just a sequence of closing and then opening
    tokens (this is to guard against rebased replace steps
    overwriting something they weren't supposed to).
    */
    constructor(
    /**
    The start position of the replaced range.
    */
    from, 
    /**
    The end position of the replaced range.
    */
    to, 
    /**
    The slice to insert.
    */
    slice, 
    /**
    @internal
    */
    structure = false) {
        super();
        this.from = from;
        this.to = to;
        this.slice = slice;
        this.structure = structure;
    }
    apply(doc) {
        if (this.structure && contentBetween(doc, this.from, this.to))
            return StepResult.fail("Structure replace would overwrite content");
        return StepResult.fromReplace(doc, this.from, this.to, this.slice);
    }
    getMap() {
        return new StepMap([this.from, this.to - this.from, this.slice.size]);
    }
    invert(doc) {
        return new ReplaceStep(this.from, this.from + this.slice.size, doc.slice(this.from, this.to));
    }
    map(mapping) {
        let to = mapping.mapResult(this.to, -1);
        let from = this.from == this.to && ReplaceStep.MAP_BIAS < 0 ? to : mapping.mapResult(this.from, 1);
        if (from.deletedAcross && to.deletedAcross)
            return null;
        return new ReplaceStep(from.pos, Math.max(from.pos, to.pos), this.slice, this.structure);
    }
    merge(other) {
        if (!(other instanceof ReplaceStep) || other.structure || this.structure)
            return null;
        if (this.from + this.slice.size == other.from && !this.slice.openEnd && !other.slice.openStart) {
            let slice = this.slice.size + other.slice.size == 0 ? prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty
                : new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(this.slice.content.append(other.slice.content), this.slice.openStart, other.slice.openEnd);
            return new ReplaceStep(this.from, this.to + (other.to - other.from), slice, this.structure);
        }
        else if (other.to == this.from && !this.slice.openStart && !other.slice.openEnd) {
            let slice = this.slice.size + other.slice.size == 0 ? prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty
                : new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(other.slice.content.append(this.slice.content), other.slice.openStart, this.slice.openEnd);
            return new ReplaceStep(other.from, this.to, slice, this.structure);
        }
        else {
            return null;
        }
    }
    toJSON() {
        let json = { stepType: "replace", from: this.from, to: this.to };
        if (this.slice.size)
            json.slice = this.slice.toJSON();
        if (this.structure)
            json.structure = true;
        return json;
    }
    /**
    @internal
    */
    static fromJSON(schema, json) {
        if (typeof json.from != "number" || typeof json.to != "number")
            throw new RangeError("Invalid input for ReplaceStep.fromJSON");
        return new ReplaceStep(json.from, json.to, prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.fromJSON(schema, json.slice), !!json.structure);
    }
}
/**
By default, for backwards compatibility, an inserting step
mapped over an insertion at that same position fill move after
the inserted content. In a collaborative editing situation, that
can make redone insertions appear in unexpected places. You can
set this to -1 to make such mapping keep the step before the
insertion instead.
*/
ReplaceStep.MAP_BIAS = 1;
Step.jsonID("replace", ReplaceStep);
/**
Replace a part of the document with a slice of content, but
preserve a range of the replaced content by moving it into the
slice.
*/
class ReplaceAroundStep extends Step {
    /**
    Create a replace-around step with the given range and gap.
    `insert` should be the point in the slice into which the content
    of the gap should be moved. `structure` has the same meaning as
    it has in the [`ReplaceStep`](https://prosemirror.net/docs/ref/#transform.ReplaceStep) class.
    */
    constructor(
    /**
    The start position of the replaced range.
    */
    from, 
    /**
    The end position of the replaced range.
    */
    to, 
    /**
    The start of preserved range.
    */
    gapFrom, 
    /**
    The end of preserved range.
    */
    gapTo, 
    /**
    The slice to insert.
    */
    slice, 
    /**
    The position in the slice where the preserved range should be
    inserted.
    */
    insert, 
    /**
    @internal
    */
    structure = false) {
        super();
        this.from = from;
        this.to = to;
        this.gapFrom = gapFrom;
        this.gapTo = gapTo;
        this.slice = slice;
        this.insert = insert;
        this.structure = structure;
    }
    apply(doc) {
        if (this.structure && (contentBetween(doc, this.from, this.gapFrom) ||
            contentBetween(doc, this.gapTo, this.to)))
            return StepResult.fail("Structure gap-replace would overwrite content");
        let gap = doc.slice(this.gapFrom, this.gapTo);
        if (gap.openStart || gap.openEnd)
            return StepResult.fail("Gap is not a flat range");
        let inserted = this.slice.insertAt(this.insert, gap.content);
        if (!inserted)
            return StepResult.fail("Content does not fit in gap");
        return StepResult.fromReplace(doc, this.from, this.to, inserted);
    }
    getMap() {
        return new StepMap([this.from, this.gapFrom - this.from, this.insert,
            this.gapTo, this.to - this.gapTo, this.slice.size - this.insert]);
    }
    invert(doc) {
        let gap = this.gapTo - this.gapFrom;
        return new ReplaceAroundStep(this.from, this.from + this.slice.size + gap, this.from + this.insert, this.from + this.insert + gap, doc.slice(this.from, this.to).removeBetween(this.gapFrom - this.from, this.gapTo - this.from), this.gapFrom - this.from, this.structure);
    }
    map(mapping) {
        let from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1);
        let gapFrom = this.from == this.gapFrom ? from.pos : mapping.map(this.gapFrom, -1);
        let gapTo = this.to == this.gapTo ? to.pos : mapping.map(this.gapTo, 1);
        if ((from.deletedAcross && to.deletedAcross) || gapFrom < from.pos || gapTo > to.pos)
            return null;
        return new ReplaceAroundStep(from.pos, to.pos, gapFrom, gapTo, this.slice, this.insert, this.structure);
    }
    toJSON() {
        let json = { stepType: "replaceAround", from: this.from, to: this.to,
            gapFrom: this.gapFrom, gapTo: this.gapTo, insert: this.insert };
        if (this.slice.size)
            json.slice = this.slice.toJSON();
        if (this.structure)
            json.structure = true;
        return json;
    }
    /**
    @internal
    */
    static fromJSON(schema, json) {
        if (typeof json.from != "number" || typeof json.to != "number" ||
            typeof json.gapFrom != "number" || typeof json.gapTo != "number" || typeof json.insert != "number")
            throw new RangeError("Invalid input for ReplaceAroundStep.fromJSON");
        return new ReplaceAroundStep(json.from, json.to, json.gapFrom, json.gapTo, prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.fromJSON(schema, json.slice), json.insert, !!json.structure);
    }
}
Step.jsonID("replaceAround", ReplaceAroundStep);
function contentBetween(doc, from, to) {
    let $from = doc.resolve(from), dist = to - from, depth = $from.depth;
    while (dist > 0 && depth > 0 && $from.indexAfter(depth) == $from.node(depth).childCount) {
        depth--;
        dist--;
    }
    if (dist > 0) {
        let next = $from.node(depth).maybeChild($from.indexAfter(depth));
        while (dist > 0) {
            if (!next || next.isLeaf)
                return true;
            next = next.firstChild;
            dist--;
        }
    }
    return false;
}

function addMark(tr, from, to, mark) {
    let removed = [], added = [];
    let removing, adding;
    tr.doc.nodesBetween(from, to, (node, pos, parent) => {
        if (!node.isInline)
            return;
        let marks = node.marks;
        if (!mark.isInSet(marks) && parent.type.allowsMarkType(mark.type)) {
            let start = Math.max(pos, from), end = Math.min(pos + node.nodeSize, to);
            let newSet = mark.addToSet(marks);
            for (let i = 0; i < marks.length; i++) {
                if (!marks[i].isInSet(newSet)) {
                    if (removing && removing.to == start && removing.mark.eq(marks[i]))
                        removing.to = end;
                    else
                        removed.push(removing = new RemoveMarkStep(start, end, marks[i]));
                }
            }
            if (adding && adding.to == start)
                adding.to = end;
            else
                added.push(adding = new AddMarkStep(start, end, mark));
        }
    });
    removed.forEach(s => tr.step(s));
    added.forEach(s => tr.step(s));
}
function removeMark(tr, from, to, mark) {
    let matched = [], step = 0;
    tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline)
            return;
        step++;
        let toRemove = null;
        if (mark instanceof prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .MarkType */ .sX) {
            let set = node.marks, found;
            while (found = mark.isInSet(set)) {
                (toRemove || (toRemove = [])).push(found);
                set = found.removeFromSet(set);
            }
        }
        else if (mark) {
            if (mark.isInSet(node.marks))
                toRemove = [mark];
        }
        else {
            toRemove = node.marks;
        }
        if (toRemove && toRemove.length) {
            let end = Math.min(pos + node.nodeSize, to);
            for (let i = 0; i < toRemove.length; i++) {
                let style = toRemove[i], found;
                for (let j = 0; j < matched.length; j++) {
                    let m = matched[j];
                    if (m.step == step - 1 && style.eq(matched[j].style))
                        found = m;
                }
                if (found) {
                    found.to = end;
                    found.step = step;
                }
                else {
                    matched.push({ style, from: Math.max(pos, from), to: end, step });
                }
            }
        }
    });
    matched.forEach(m => tr.step(new RemoveMarkStep(m.from, m.to, m.style)));
}
function clearIncompatible(tr, pos, parentType, match = parentType.contentMatch, clearNewlines = true) {
    let node = tr.doc.nodeAt(pos);
    let replSteps = [], cur = pos + 1;
    for (let i = 0; i < node.childCount; i++) {
        let child = node.child(i), end = cur + child.nodeSize;
        let allowed = match.matchType(child.type);
        if (!allowed) {
            replSteps.push(new ReplaceStep(cur, end, prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty));
        }
        else {
            match = allowed;
            for (let j = 0; j < child.marks.length; j++)
                if (!parentType.allowsMarkType(child.marks[j].type))
                    tr.step(new RemoveMarkStep(cur, end, child.marks[j]));
            if (clearNewlines && child.isText && parentType.whitespace != "pre") {
                let m, newline = /\r?\n|\r/g, slice;
                while (m = newline.exec(child.text)) {
                    if (!slice)
                        slice = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(parentType.schema.text(" ", parentType.allowedMarks(child.marks))), 0, 0);
                    replSteps.push(new ReplaceStep(cur + m.index, cur + m.index + m[0].length, slice));
                }
            }
        }
        cur = end;
    }
    if (!match.validEnd) {
        let fill = match.fillBefore(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty, true);
        tr.replace(cur, cur, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(fill, 0, 0));
    }
    for (let i = replSteps.length - 1; i >= 0; i--)
        tr.step(replSteps[i]);
}

function canCut(node, start, end) {
    return (start == 0 || node.canReplace(start, node.childCount)) &&
        (end == node.childCount || node.canReplace(0, end));
}
/**
Try to find a target depth to which the content in the given range
can be lifted. Will not go across
[isolating](https://prosemirror.net/docs/ref/#model.NodeSpec.isolating) parent nodes.
*/
function liftTarget(range) {
    let parent = range.parent;
    let content = parent.content.cutByIndex(range.startIndex, range.endIndex);
    for (let depth = range.depth, contentBefore = 0, contentAfter = 0;; --depth) {
        let node = range.$from.node(depth);
        let index = range.$from.index(depth) + contentBefore, endIndex = range.$to.indexAfter(depth) - contentAfter;
        if (depth < range.depth && node.canReplace(index, endIndex, content))
            return depth;
        if (depth == 0 || node.type.spec.isolating || !canCut(node, index, endIndex))
            break;
        if (index)
            contentBefore = 1;
        if (endIndex < node.childCount)
            contentAfter = 1;
    }
    return null;
}
function lift(tr, range, target) {
    let { $from, $to, depth } = range;
    let gapStart = $from.before(depth + 1), gapEnd = $to.after(depth + 1);
    let start = gapStart, end = gapEnd;
    let before = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty, openStart = 0;
    for (let d = depth, splitting = false; d > target; d--)
        if (splitting || $from.index(d) > 0) {
            splitting = true;
            before = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from($from.node(d).copy(before));
            openStart++;
        }
        else {
            start--;
        }
    let after = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty, openEnd = 0;
    for (let d = depth, splitting = false; d > target; d--)
        if (splitting || $to.after(d + 1) < $to.end(d)) {
            splitting = true;
            after = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from($to.node(d).copy(after));
            openEnd++;
        }
        else {
            end++;
        }
    tr.step(new ReplaceAroundStep(start, end, gapStart, gapEnd, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(before.append(after), openStart, openEnd), before.size - openStart, true));
}
/**
Try to find a valid way to wrap the content in the given range in a
node of the given type. May introduce extra nodes around and inside
the wrapper node, if necessary. Returns null if no valid wrapping
could be found. When `innerRange` is given, that range's content is
used as the content to fit into the wrapping, instead of the
content of `range`.
*/
function findWrapping(range, nodeType, attrs = null, innerRange = range) {
    let around = findWrappingOutside(range, nodeType);
    let inner = around && findWrappingInside(innerRange, nodeType);
    if (!inner)
        return null;
    return around.map(withAttrs)
        .concat({ type: nodeType, attrs }).concat(inner.map(withAttrs));
}
function withAttrs(type) { return { type, attrs: null }; }
function findWrappingOutside(range, type) {
    let { parent, startIndex, endIndex } = range;
    let around = parent.contentMatchAt(startIndex).findWrapping(type);
    if (!around)
        return null;
    let outer = around.length ? around[0] : type;
    return parent.canReplaceWith(startIndex, endIndex, outer) ? around : null;
}
function findWrappingInside(range, type) {
    let { parent, startIndex, endIndex } = range;
    let inner = parent.child(startIndex);
    let inside = type.contentMatch.findWrapping(inner.type);
    if (!inside)
        return null;
    let lastType = inside.length ? inside[inside.length - 1] : type;
    let innerMatch = lastType.contentMatch;
    for (let i = startIndex; innerMatch && i < endIndex; i++)
        innerMatch = innerMatch.matchType(parent.child(i).type);
    if (!innerMatch || !innerMatch.validEnd)
        return null;
    return inside;
}
function wrap(tr, range, wrappers) {
    let content = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty;
    for (let i = wrappers.length - 1; i >= 0; i--) {
        if (content.size) {
            let match = wrappers[i].type.contentMatch.matchFragment(content);
            if (!match || !match.validEnd)
                throw new RangeError("Wrapper type given to Transform.wrap does not form valid content of its parent wrapper");
        }
        content = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(wrappers[i].type.create(wrappers[i].attrs, content));
    }
    let start = range.start, end = range.end;
    tr.step(new ReplaceAroundStep(start, end, start, end, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(content, 0, 0), wrappers.length, true));
}
function setBlockType(tr, from, to, type, attrs) {
    if (!type.isTextblock)
        throw new RangeError("Type given to setBlockType should be a textblock");
    let mapFrom = tr.steps.length;
    tr.doc.nodesBetween(from, to, (node, pos) => {
        let attrsHere = typeof attrs == "function" ? attrs(node) : attrs;
        if (node.isTextblock && !node.hasMarkup(type, attrsHere) &&
            canChangeType(tr.doc, tr.mapping.slice(mapFrom).map(pos), type)) {
            let convertNewlines = null;
            if (type.schema.linebreakReplacement) {
                let pre = type.whitespace == "pre", supportLinebreak = !!type.contentMatch.matchType(type.schema.linebreakReplacement);
                if (pre && !supportLinebreak)
                    convertNewlines = false;
                else if (!pre && supportLinebreak)
                    convertNewlines = true;
            }
            // Ensure all markup that isn't allowed in the new node type is cleared
            if (convertNewlines === false)
                replaceLinebreaks(tr, node, pos, mapFrom);
            clearIncompatible(tr, tr.mapping.slice(mapFrom).map(pos, 1), type, undefined, convertNewlines === null);
            let mapping = tr.mapping.slice(mapFrom);
            let startM = mapping.map(pos, 1), endM = mapping.map(pos + node.nodeSize, 1);
            tr.step(new ReplaceAroundStep(startM, endM, startM + 1, endM - 1, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(type.create(attrsHere, null, node.marks)), 0, 0), 1, true));
            if (convertNewlines === true)
                replaceNewlines(tr, node, pos, mapFrom);
            return false;
        }
    });
}
function replaceNewlines(tr, node, pos, mapFrom) {
    node.forEach((child, offset) => {
        if (child.isText) {
            let m, newline = /\r?\n|\r/g;
            while (m = newline.exec(child.text)) {
                let start = tr.mapping.slice(mapFrom).map(pos + 1 + offset + m.index);
                tr.replaceWith(start, start + 1, node.type.schema.linebreakReplacement.create());
            }
        }
    });
}
function replaceLinebreaks(tr, node, pos, mapFrom) {
    node.forEach((child, offset) => {
        if (child.type == child.type.schema.linebreakReplacement) {
            let start = tr.mapping.slice(mapFrom).map(pos + 1 + offset);
            tr.replaceWith(start, start + 1, node.type.schema.text("\n"));
        }
    });
}
function canChangeType(doc, pos, type) {
    let $pos = doc.resolve(pos), index = $pos.index();
    return $pos.parent.canReplaceWith(index, index + 1, type);
}
/**
Change the type, attributes, and/or marks of the node at `pos`.
When `type` isn't given, the existing node type is preserved,
*/
function setNodeMarkup(tr, pos, type, attrs, marks) {
    let node = tr.doc.nodeAt(pos);
    if (!node)
        throw new RangeError("No node at given position");
    if (!type)
        type = node.type;
    let newNode = type.create(attrs, null, marks || node.marks);
    if (node.isLeaf)
        return tr.replaceWith(pos, pos + node.nodeSize, newNode);
    if (!type.validContent(node.content))
        throw new RangeError("Invalid content for node type " + type.name);
    tr.step(new ReplaceAroundStep(pos, pos + node.nodeSize, pos + 1, pos + node.nodeSize - 1, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(newNode), 0, 0), 1, true));
}
/**
Check whether splitting at the given position is allowed.
*/
function canSplit(doc, pos, depth = 1, typesAfter) {
    let $pos = doc.resolve(pos), base = $pos.depth - depth;
    let innerType = (typesAfter && typesAfter[typesAfter.length - 1]) || $pos.parent;
    if (base < 0 || $pos.parent.type.spec.isolating ||
        !$pos.parent.canReplace($pos.index(), $pos.parent.childCount) ||
        !innerType.type.validContent($pos.parent.content.cutByIndex($pos.index(), $pos.parent.childCount)))
        return false;
    for (let d = $pos.depth - 1, i = depth - 2; d > base; d--, i--) {
        let node = $pos.node(d), index = $pos.index(d);
        if (node.type.spec.isolating)
            return false;
        let rest = node.content.cutByIndex(index, node.childCount);
        let overrideChild = typesAfter && typesAfter[i + 1];
        if (overrideChild)
            rest = rest.replaceChild(0, overrideChild.type.create(overrideChild.attrs));
        let after = (typesAfter && typesAfter[i]) || node;
        if (!node.canReplace(index + 1, node.childCount) || !after.type.validContent(rest))
            return false;
    }
    let index = $pos.indexAfter(base);
    let baseType = typesAfter && typesAfter[0];
    return $pos.node(base).canReplaceWith(index, index, baseType ? baseType.type : $pos.node(base + 1).type);
}
function split(tr, pos, depth = 1, typesAfter) {
    let $pos = tr.doc.resolve(pos), before = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty, after = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty;
    for (let d = $pos.depth, e = $pos.depth - depth, i = depth - 1; d > e; d--, i--) {
        before = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from($pos.node(d).copy(before));
        let typeAfter = typesAfter && typesAfter[i];
        after = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(typeAfter ? typeAfter.type.create(typeAfter.attrs, after) : $pos.node(d).copy(after));
    }
    tr.step(new ReplaceStep(pos, pos, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(before.append(after), depth, depth), true));
}
/**
Test whether the blocks before and after a given position can be
joined.
*/
function canJoin(doc, pos) {
    let $pos = doc.resolve(pos), index = $pos.index();
    return joinable($pos.nodeBefore, $pos.nodeAfter) &&
        $pos.parent.canReplace(index, index + 1);
}
function canAppendWithSubstitutedLinebreaks(a, b) {
    if (!b.content.size)
        a.type.compatibleContent(b.type);
    let match = a.contentMatchAt(a.childCount);
    let { linebreakReplacement } = a.type.schema;
    for (let i = 0; i < b.childCount; i++) {
        let child = b.child(i);
        let type = child.type == linebreakReplacement ? a.type.schema.nodes.text : child.type;
        match = match.matchType(type);
        if (!match)
            return false;
        if (!a.type.allowsMarks(child.marks))
            return false;
    }
    return match.validEnd;
}
function joinable(a, b) {
    return !!(a && b && !a.isLeaf && canAppendWithSubstitutedLinebreaks(a, b));
}
/**
Find an ancestor of the given position that can be joined to the
block before (or after if `dir` is positive). Returns the joinable
point, if any.
*/
function joinPoint(doc, pos, dir = -1) {
    let $pos = doc.resolve(pos);
    for (let d = $pos.depth;; d--) {
        let before, after, index = $pos.index(d);
        if (d == $pos.depth) {
            before = $pos.nodeBefore;
            after = $pos.nodeAfter;
        }
        else if (dir > 0) {
            before = $pos.node(d + 1);
            index++;
            after = $pos.node(d).maybeChild(index);
        }
        else {
            before = $pos.node(d).maybeChild(index - 1);
            after = $pos.node(d + 1);
        }
        if (before && !before.isTextblock && joinable(before, after) &&
            $pos.node(d).canReplace(index, index + 1))
            return pos;
        if (d == 0)
            break;
        pos = dir < 0 ? $pos.before(d) : $pos.after(d);
    }
}
function join(tr, pos, depth) {
    let convertNewlines = null;
    let { linebreakReplacement } = tr.doc.type.schema;
    let $before = tr.doc.resolve(pos - depth), beforeType = $before.node().type;
    if (linebreakReplacement && beforeType.inlineContent) {
        let pre = beforeType.whitespace == "pre";
        let supportLinebreak = !!beforeType.contentMatch.matchType(linebreakReplacement);
        if (pre && !supportLinebreak)
            convertNewlines = false;
        else if (!pre && supportLinebreak)
            convertNewlines = true;
    }
    let mapFrom = tr.steps.length;
    if (convertNewlines === false) {
        let $after = tr.doc.resolve(pos + depth);
        replaceLinebreaks(tr, $after.node(), $after.before(), mapFrom);
    }
    if (beforeType.inlineContent)
        clearIncompatible(tr, pos + depth - 1, beforeType, $before.node().contentMatchAt($before.index()), convertNewlines == null);
    let mapping = tr.mapping.slice(mapFrom), start = mapping.map(pos - depth);
    tr.step(new ReplaceStep(start, mapping.map(pos + depth, -1), prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty, true));
    if (convertNewlines === true) {
        let $full = tr.doc.resolve(start);
        replaceNewlines(tr, $full.node(), $full.before(), tr.steps.length);
    }
    return tr;
}
/**
Try to find a point where a node of the given type can be inserted
near `pos`, by searching up the node hierarchy when `pos` itself
isn't a valid place but is at the start or end of a node. Return
null if no position was found.
*/
function insertPoint(doc, pos, nodeType) {
    let $pos = doc.resolve(pos);
    if ($pos.parent.canReplaceWith($pos.index(), $pos.index(), nodeType))
        return pos;
    if ($pos.parentOffset == 0)
        for (let d = $pos.depth - 1; d >= 0; d--) {
            let index = $pos.index(d);
            if ($pos.node(d).canReplaceWith(index, index, nodeType))
                return $pos.before(d + 1);
            if (index > 0)
                return null;
        }
    if ($pos.parentOffset == $pos.parent.content.size)
        for (let d = $pos.depth - 1; d >= 0; d--) {
            let index = $pos.indexAfter(d);
            if ($pos.node(d).canReplaceWith(index, index, nodeType))
                return $pos.after(d + 1);
            if (index < $pos.node(d).childCount)
                return null;
        }
    return null;
}
/**
Finds a position at or around the given position where the given
slice can be inserted. Will look at parent nodes' nearest boundary
and try there, even if the original position wasn't directly at the
start or end of that node. Returns null when no position was found.
*/
function dropPoint(doc, pos, slice) {
    let $pos = doc.resolve(pos);
    if (!slice.content.size)
        return pos;
    let content = slice.content;
    for (let i = 0; i < slice.openStart; i++)
        content = content.firstChild.content;
    for (let pass = 1; pass <= (slice.openStart == 0 && slice.size ? 2 : 1); pass++) {
        for (let d = $pos.depth; d >= 0; d--) {
            let bias = d == $pos.depth ? 0 : $pos.pos <= ($pos.start(d + 1) + $pos.end(d + 1)) / 2 ? -1 : 1;
            let insertPos = $pos.index(d) + (bias > 0 ? 1 : 0);
            let parent = $pos.node(d), fits = false;
            if (pass == 1) {
                fits = parent.canReplace(insertPos, insertPos, content);
            }
            else {
                let wrapping = parent.contentMatchAt(insertPos).findWrapping(content.firstChild.type);
                fits = wrapping && parent.canReplaceWith(insertPos, insertPos, wrapping[0]);
            }
            if (fits)
                return bias == 0 ? $pos.pos : bias < 0 ? $pos.before(d + 1) : $pos.after(d + 1);
        }
    }
    return null;
}

/**
‘Fit’ a slice into a given position in the document, producing a
[step](https://prosemirror.net/docs/ref/#transform.Step) that inserts it. Will return null if
there's no meaningful way to insert the slice here, or inserting it
would be a no-op (an empty slice over an empty range).
*/
function replaceStep(doc, from, to = from, slice = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty) {
    if (from == to && !slice.size)
        return null;
    let $from = doc.resolve(from), $to = doc.resolve(to);
    // Optimization -- avoid work if it's obvious that it's not needed.
    if (fitsTrivially($from, $to, slice))
        return new ReplaceStep(from, to, slice);
    return new Fitter($from, $to, slice).fit();
}
function fitsTrivially($from, $to, slice) {
    return !slice.openStart && !slice.openEnd && $from.start() == $to.start() &&
        $from.parent.canReplace($from.index(), $to.index(), slice.content);
}
// Algorithm for 'placing' the elements of a slice into a gap:
//
// We consider the content of each node that is open to the left to be
// independently placeable. I.e. in <p("foo"), p("bar")>, when the
// paragraph on the left is open, "foo" can be placed (somewhere on
// the left side of the replacement gap) independently from p("bar").
//
// This class tracks the state of the placement progress in the
// following properties:
//
//  - `frontier` holds a stack of `{type, match}` objects that
//    represent the open side of the replacement. It starts at
//    `$from`, then moves forward as content is placed, and is finally
//    reconciled with `$to`.
//
//  - `unplaced` is a slice that represents the content that hasn't
//    been placed yet.
//
//  - `placed` is a fragment of placed content. Its open-start value
//    is implicit in `$from`, and its open-end value in `frontier`.
class Fitter {
    constructor($from, $to, unplaced) {
        this.$from = $from;
        this.$to = $to;
        this.unplaced = unplaced;
        this.frontier = [];
        this.placed = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty;
        for (let i = 0; i <= $from.depth; i++) {
            let node = $from.node(i);
            this.frontier.push({
                type: node.type,
                match: node.contentMatchAt($from.indexAfter(i))
            });
        }
        for (let i = $from.depth; i > 0; i--)
            this.placed = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from($from.node(i).copy(this.placed));
    }
    get depth() { return this.frontier.length - 1; }
    fit() {
        // As long as there's unplaced content, try to place some of it.
        // If that fails, either increase the open score of the unplaced
        // slice, or drop nodes from it, and then try again.
        while (this.unplaced.size) {
            let fit = this.findFittable();
            if (fit)
                this.placeNodes(fit);
            else
                this.openMore() || this.dropNode();
        }
        // When there's inline content directly after the frontier _and_
        // directly after `this.$to`, we must generate a `ReplaceAround`
        // step that pulls that content into the node after the frontier.
        // That means the fitting must be done to the end of the textblock
        // node after `this.$to`, not `this.$to` itself.
        let moveInline = this.mustMoveInline(), placedSize = this.placed.size - this.depth - this.$from.depth;
        let $from = this.$from, $to = this.close(moveInline < 0 ? this.$to : $from.doc.resolve(moveInline));
        if (!$to)
            return null;
        // If closing to `$to` succeeded, create a step
        let content = this.placed, openStart = $from.depth, openEnd = $to.depth;
        while (openStart && openEnd && content.childCount == 1) { // Normalize by dropping open parent nodes
            content = content.firstChild.content;
            openStart--;
            openEnd--;
        }
        let slice = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(content, openStart, openEnd);
        if (moveInline > -1)
            return new ReplaceAroundStep($from.pos, moveInline, this.$to.pos, this.$to.end(), slice, placedSize);
        if (slice.size || $from.pos != this.$to.pos) // Don't generate no-op steps
            return new ReplaceStep($from.pos, $to.pos, slice);
        return null;
    }
    // Find a position on the start spine of `this.unplaced` that has
    // content that can be moved somewhere on the frontier. Returns two
    // depths, one for the slice and one for the frontier.
    findFittable() {
        let startDepth = this.unplaced.openStart;
        for (let cur = this.unplaced.content, d = 0, openEnd = this.unplaced.openEnd; d < startDepth; d++) {
            let node = cur.firstChild;
            if (cur.childCount > 1)
                openEnd = 0;
            if (node.type.spec.isolating && openEnd <= d) {
                startDepth = d;
                break;
            }
            cur = node.content;
        }
        // Only try wrapping nodes (pass 2) after finding a place without
        // wrapping failed.
        for (let pass = 1; pass <= 2; pass++) {
            for (let sliceDepth = pass == 1 ? startDepth : this.unplaced.openStart; sliceDepth >= 0; sliceDepth--) {
                let fragment, parent = null;
                if (sliceDepth) {
                    parent = contentAt(this.unplaced.content, sliceDepth - 1).firstChild;
                    fragment = parent.content;
                }
                else {
                    fragment = this.unplaced.content;
                }
                let first = fragment.firstChild;
                for (let frontierDepth = this.depth; frontierDepth >= 0; frontierDepth--) {
                    let { type, match } = this.frontier[frontierDepth], wrap, inject = null;
                    // In pass 1, if the next node matches, or there is no next
                    // node but the parents look compatible, we've found a
                    // place.
                    if (pass == 1 && (first ? match.matchType(first.type) || (inject = match.fillBefore(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(first), false))
                        : parent && type.compatibleContent(parent.type)))
                        return { sliceDepth, frontierDepth, parent, inject };
                    // In pass 2, look for a set of wrapping nodes that make
                    // `first` fit here.
                    else if (pass == 2 && first && (wrap = match.findWrapping(first.type)))
                        return { sliceDepth, frontierDepth, parent, wrap };
                    // Don't continue looking further up if the parent node
                    // would fit here.
                    if (parent && match.matchType(parent.type))
                        break;
                }
            }
        }
    }
    openMore() {
        let { content, openStart, openEnd } = this.unplaced;
        let inner = contentAt(content, openStart);
        if (!inner.childCount || inner.firstChild.isLeaf)
            return false;
        this.unplaced = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(content, openStart + 1, Math.max(openEnd, inner.size + openStart >= content.size - openEnd ? openStart + 1 : 0));
        return true;
    }
    dropNode() {
        let { content, openStart, openEnd } = this.unplaced;
        let inner = contentAt(content, openStart);
        if (inner.childCount <= 1 && openStart > 0) {
            let openAtEnd = content.size - openStart <= openStart + inner.size;
            this.unplaced = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(dropFromFragment(content, openStart - 1, 1), openStart - 1, openAtEnd ? openStart - 1 : openEnd);
        }
        else {
            this.unplaced = new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(dropFromFragment(content, openStart, 1), openStart, openEnd);
        }
    }
    // Move content from the unplaced slice at `sliceDepth` to the
    // frontier node at `frontierDepth`. Close that frontier node when
    // applicable.
    placeNodes({ sliceDepth, frontierDepth, parent, inject, wrap }) {
        while (this.depth > frontierDepth)
            this.closeFrontierNode();
        if (wrap)
            for (let i = 0; i < wrap.length; i++)
                this.openFrontierNode(wrap[i]);
        let slice = this.unplaced, fragment = parent ? parent.content : slice.content;
        let openStart = slice.openStart - sliceDepth;
        let taken = 0, add = [];
        let { match, type } = this.frontier[frontierDepth];
        if (inject) {
            for (let i = 0; i < inject.childCount; i++)
                add.push(inject.child(i));
            match = match.matchFragment(inject);
        }
        // Computes the amount of (end) open nodes at the end of the
        // fragment. When 0, the parent is open, but no more. When
        // negative, nothing is open.
        let openEndCount = (fragment.size + sliceDepth) - (slice.content.size - slice.openEnd);
        // Scan over the fragment, fitting as many child nodes as
        // possible.
        while (taken < fragment.childCount) {
            let next = fragment.child(taken), matches = match.matchType(next.type);
            if (!matches)
                break;
            taken++;
            if (taken > 1 || openStart == 0 || next.content.size) { // Drop empty open nodes
                match = matches;
                add.push(closeNodeStart(next.mark(type.allowedMarks(next.marks)), taken == 1 ? openStart : 0, taken == fragment.childCount ? openEndCount : -1));
            }
        }
        let toEnd = taken == fragment.childCount;
        if (!toEnd)
            openEndCount = -1;
        this.placed = addToFragment(this.placed, frontierDepth, prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(add));
        this.frontier[frontierDepth].match = match;
        // If the parent types match, and the entire node was moved, and
        // it's not open, close this frontier node right away.
        if (toEnd && openEndCount < 0 && parent && parent.type == this.frontier[this.depth].type && this.frontier.length > 1)
            this.closeFrontierNode();
        // Add new frontier nodes for any open nodes at the end.
        for (let i = 0, cur = fragment; i < openEndCount; i++) {
            let node = cur.lastChild;
            this.frontier.push({ type: node.type, match: node.contentMatchAt(node.childCount) });
            cur = node.content;
        }
        // Update `this.unplaced`. Drop the entire node from which we
        // placed it we got to its end, otherwise just drop the placed
        // nodes.
        this.unplaced = !toEnd ? new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(dropFromFragment(slice.content, sliceDepth, taken), slice.openStart, slice.openEnd)
            : sliceDepth == 0 ? prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty
                : new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(dropFromFragment(slice.content, sliceDepth - 1, 1), sliceDepth - 1, openEndCount < 0 ? slice.openEnd : sliceDepth - 1);
    }
    mustMoveInline() {
        if (!this.$to.parent.isTextblock)
            return -1;
        let top = this.frontier[this.depth], level;
        if (!top.type.isTextblock || !contentAfterFits(this.$to, this.$to.depth, top.type, top.match, false) ||
            (this.$to.depth == this.depth && (level = this.findCloseLevel(this.$to)) && level.depth == this.depth))
            return -1;
        let { depth } = this.$to, after = this.$to.after(depth);
        while (depth > 1 && after == this.$to.end(--depth))
            ++after;
        return after;
    }
    findCloseLevel($to) {
        scan: for (let i = Math.min(this.depth, $to.depth); i >= 0; i--) {
            let { match, type } = this.frontier[i];
            let dropInner = i < $to.depth && $to.end(i + 1) == $to.pos + ($to.depth - (i + 1));
            let fit = contentAfterFits($to, i, type, match, dropInner);
            if (!fit)
                continue;
            for (let d = i - 1; d >= 0; d--) {
                let { match, type } = this.frontier[d];
                let matches = contentAfterFits($to, d, type, match, true);
                if (!matches || matches.childCount)
                    continue scan;
            }
            return { depth: i, fit, move: dropInner ? $to.doc.resolve($to.after(i + 1)) : $to };
        }
    }
    close($to) {
        let close = this.findCloseLevel($to);
        if (!close)
            return null;
        while (this.depth > close.depth)
            this.closeFrontierNode();
        if (close.fit.childCount)
            this.placed = addToFragment(this.placed, close.depth, close.fit);
        $to = close.move;
        for (let d = close.depth + 1; d <= $to.depth; d++) {
            let node = $to.node(d), add = node.type.contentMatch.fillBefore(node.content, true, $to.index(d));
            this.openFrontierNode(node.type, node.attrs, add);
        }
        return $to;
    }
    openFrontierNode(type, attrs = null, content) {
        let top = this.frontier[this.depth];
        top.match = top.match.matchType(type);
        this.placed = addToFragment(this.placed, this.depth, prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(type.create(attrs, content)));
        this.frontier.push({ type, match: type.contentMatch });
    }
    closeFrontierNode() {
        let open = this.frontier.pop();
        let add = open.match.fillBefore(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty, true);
        if (add.childCount)
            this.placed = addToFragment(this.placed, this.frontier.length, add);
    }
}
function dropFromFragment(fragment, depth, count) {
    if (depth == 0)
        return fragment.cutByIndex(count, fragment.childCount);
    return fragment.replaceChild(0, fragment.firstChild.copy(dropFromFragment(fragment.firstChild.content, depth - 1, count)));
}
function addToFragment(fragment, depth, content) {
    if (depth == 0)
        return fragment.append(content);
    return fragment.replaceChild(fragment.childCount - 1, fragment.lastChild.copy(addToFragment(fragment.lastChild.content, depth - 1, content)));
}
function contentAt(fragment, depth) {
    for (let i = 0; i < depth; i++)
        fragment = fragment.firstChild.content;
    return fragment;
}
function closeNodeStart(node, openStart, openEnd) {
    if (openStart <= 0)
        return node;
    let frag = node.content;
    if (openStart > 1)
        frag = frag.replaceChild(0, closeNodeStart(frag.firstChild, openStart - 1, frag.childCount == 1 ? openEnd - 1 : 0));
    if (openStart > 0) {
        frag = node.type.contentMatch.fillBefore(frag).append(frag);
        if (openEnd <= 0)
            frag = frag.append(node.type.contentMatch.matchFragment(frag).fillBefore(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty, true));
    }
    return node.copy(frag);
}
function contentAfterFits($to, depth, type, match, open) {
    let node = $to.node(depth), index = open ? $to.indexAfter(depth) : $to.index(depth);
    if (index == node.childCount && !type.compatibleContent(node.type))
        return null;
    let fit = match.fillBefore(node.content, true, index);
    return fit && !invalidMarks(type, node.content, index) ? fit : null;
}
function invalidMarks(type, fragment, start) {
    for (let i = start; i < fragment.childCount; i++)
        if (!type.allowsMarks(fragment.child(i).marks))
            return true;
    return false;
}
function definesContent(type) {
    return type.spec.defining || type.spec.definingForContent;
}
function replaceRange(tr, from, to, slice) {
    if (!slice.size)
        return tr.deleteRange(from, to);
    let $from = tr.doc.resolve(from), $to = tr.doc.resolve(to);
    if (fitsTrivially($from, $to, slice))
        return tr.step(new ReplaceStep(from, to, slice));
    let targetDepths = coveredDepths($from, $to);
    // Can't replace the whole document, so remove 0 if it's present
    if (targetDepths[targetDepths.length - 1] == 0)
        targetDepths.pop();
    // Negative numbers represent not expansion over the whole node at
    // that depth, but replacing from $from.before(-D) to $to.pos.
    let preferredTarget = -($from.depth + 1);
    targetDepths.unshift(preferredTarget);
    // This loop picks a preferred target depth, if one of the covering
    // depths is not outside of a defining node, and adds negative
    // depths for any depth that has $from at its start and does not
    // cross a defining node.
    for (let d = $from.depth, pos = $from.pos - 1; d > 0; d--, pos--) {
        let spec = $from.node(d).type.spec;
        if (spec.defining || spec.definingAsContext || spec.isolating)
            break;
        if (targetDepths.indexOf(d) > -1)
            preferredTarget = d;
        else if ($from.before(d) == pos)
            targetDepths.splice(1, 0, -d);
    }
    // Try to fit each possible depth of the slice into each possible
    // target depth, starting with the preferred depths.
    let preferredTargetIndex = targetDepths.indexOf(preferredTarget);
    let leftNodes = [], preferredDepth = slice.openStart;
    for (let content = slice.content, i = 0;; i++) {
        let node = content.firstChild;
        leftNodes.push(node);
        if (i == slice.openStart)
            break;
        content = node.content;
    }
    // Back up preferredDepth to cover defining textblocks directly
    // above it, possibly skipping a non-defining textblock.
    for (let d = preferredDepth - 1; d >= 0; d--) {
        let leftNode = leftNodes[d], def = definesContent(leftNode.type);
        if (def && !leftNode.sameMarkup($from.node(Math.abs(preferredTarget) - 1)))
            preferredDepth = d;
        else if (def || !leftNode.type.isTextblock)
            break;
    }
    for (let j = slice.openStart; j >= 0; j--) {
        let openDepth = (j + preferredDepth + 1) % (slice.openStart + 1);
        let insert = leftNodes[openDepth];
        if (!insert)
            continue;
        for (let i = 0; i < targetDepths.length; i++) {
            // Loop over possible expansion levels, starting with the
            // preferred one
            let targetDepth = targetDepths[(i + preferredTargetIndex) % targetDepths.length], expand = true;
            if (targetDepth < 0) {
                expand = false;
                targetDepth = -targetDepth;
            }
            let parent = $from.node(targetDepth - 1), index = $from.index(targetDepth - 1);
            if (parent.canReplaceWith(index, index, insert.type, insert.marks))
                return tr.replace($from.before(targetDepth), expand ? $to.after(targetDepth) : to, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(closeFragment(slice.content, 0, slice.openStart, openDepth), openDepth, slice.openEnd));
        }
    }
    let startSteps = tr.steps.length;
    for (let i = targetDepths.length - 1; i >= 0; i--) {
        tr.replace(from, to, slice);
        if (tr.steps.length > startSteps)
            break;
        let depth = targetDepths[i];
        if (depth < 0)
            continue;
        from = $from.before(depth);
        to = $to.after(depth);
    }
}
function closeFragment(fragment, depth, oldOpen, newOpen, parent) {
    if (depth < oldOpen) {
        let first = fragment.firstChild;
        fragment = fragment.replaceChild(0, first.copy(closeFragment(first.content, depth + 1, oldOpen, newOpen, first)));
    }
    if (depth > newOpen) {
        let match = parent.contentMatchAt(0);
        let start = match.fillBefore(fragment).append(fragment);
        fragment = start.append(match.matchFragment(start).fillBefore(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.empty, true));
    }
    return fragment;
}
function replaceRangeWith(tr, from, to, node) {
    if (!node.isInline && from == to && tr.doc.resolve(from).parent.content.size) {
        let point = insertPoint(tr.doc, from, node.type);
        if (point != null)
            from = to = point;
    }
    tr.replaceRange(from, to, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(node), 0, 0));
}
function deleteRange(tr, from, to) {
    let $from = tr.doc.resolve(from), $to = tr.doc.resolve(to);
    // When the deleted range spans from the start of one textblock to
    // the start of another one, move out of the start of both blocks.
    if ($from.parent.isTextblock && $to.parent.isTextblock && $from.start() != $to.start() &&
        $from.parentOffset == 0 && $to.parentOffset == 0) {
        let shared = $from.sharedDepth(to), isolated = false;
        for (let d = $from.depth; d > shared; d--)
            if ($from.node(d).type.spec.isolating)
                isolated = true;
        for (let d = $to.depth; d > shared; d--)
            if ($to.node(d).type.spec.isolating)
                isolated = true;
        if (!isolated) {
            for (let d = $from.depth; d > 0 && from == $from.start(d); d--)
                from = $from.before(d);
            for (let d = $to.depth; d > 0 && to == $to.start(d); d--)
                to = $to.before(d);
            $from = tr.doc.resolve(from);
            $to = tr.doc.resolve(to);
        }
    }
    let covered = coveredDepths($from, $to);
    for (let i = 0; i < covered.length; i++) {
        let depth = covered[i], last = i == covered.length - 1;
        if ((last && depth == 0) || $from.node(depth).type.contentMatch.validEnd)
            return tr.delete($from.start(depth), $to.end(depth));
        if (depth > 0 && (last || $from.node(depth - 1).canReplace($from.index(depth - 1), $to.indexAfter(depth - 1))))
            return tr.delete($from.before(depth), $to.after(depth));
    }
    for (let d = 1; d <= $from.depth && d <= $to.depth; d++) {
        if (from - $from.start(d) == $from.depth - d && to > $from.end(d) && $to.end(d) - to != $to.depth - d &&
            $from.start(d - 1) == $to.start(d - 1) && $from.node(d - 1).canReplace($from.index(d - 1), $to.index(d - 1)))
            return tr.delete($from.before(d), to);
    }
    tr.delete(from, to);
}
// Returns an array of all depths for which $from - $to spans the
// whole content of the nodes at that depth.
function coveredDepths($from, $to) {
    let result = [], minDepth = Math.min($from.depth, $to.depth);
    for (let d = minDepth; d >= 0; d--) {
        let start = $from.start(d);
        if (start < $from.pos - ($from.depth - d) ||
            $to.end(d) > $to.pos + ($to.depth - d) ||
            $from.node(d).type.spec.isolating ||
            $to.node(d).type.spec.isolating)
            break;
        if (start == $to.start(d) ||
            (d == $from.depth && d == $to.depth && $from.parent.inlineContent && $to.parent.inlineContent &&
                d && $to.start(d - 1) == start - 1))
            result.push(d);
    }
    return result;
}

/**
Update an attribute in a specific node.
*/
class AttrStep extends Step {
    /**
    Construct an attribute step.
    */
    constructor(
    /**
    The position of the target node.
    */
    pos, 
    /**
    The attribute to set.
    */
    attr, 
    // The attribute's new value.
    value) {
        super();
        this.pos = pos;
        this.attr = attr;
        this.value = value;
    }
    apply(doc) {
        let node = doc.nodeAt(this.pos);
        if (!node)
            return StepResult.fail("No node at attribute step's position");
        let attrs = Object.create(null);
        for (let name in node.attrs)
            attrs[name] = node.attrs[name];
        attrs[this.attr] = this.value;
        let updated = node.type.create(attrs, null, node.marks);
        return StepResult.fromReplace(doc, this.pos, this.pos + 1, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(updated), 0, node.isLeaf ? 0 : 1));
    }
    getMap() {
        return StepMap.empty;
    }
    invert(doc) {
        return new AttrStep(this.pos, this.attr, doc.nodeAt(this.pos).attrs[this.attr]);
    }
    map(mapping) {
        let pos = mapping.mapResult(this.pos, 1);
        return pos.deletedAfter ? null : new AttrStep(pos.pos, this.attr, this.value);
    }
    toJSON() {
        return { stepType: "attr", pos: this.pos, attr: this.attr, value: this.value };
    }
    static fromJSON(schema, json) {
        if (typeof json.pos != "number" || typeof json.attr != "string")
            throw new RangeError("Invalid input for AttrStep.fromJSON");
        return new AttrStep(json.pos, json.attr, json.value);
    }
}
Step.jsonID("attr", AttrStep);
/**
Update an attribute in the doc node.
*/
class DocAttrStep extends Step {
    /**
    Construct an attribute step.
    */
    constructor(
    /**
    The attribute to set.
    */
    attr, 
    // The attribute's new value.
    value) {
        super();
        this.attr = attr;
        this.value = value;
    }
    apply(doc) {
        let attrs = Object.create(null);
        for (let name in doc.attrs)
            attrs[name] = doc.attrs[name];
        attrs[this.attr] = this.value;
        let updated = doc.type.create(attrs, doc.content, doc.marks);
        return StepResult.ok(updated);
    }
    getMap() {
        return StepMap.empty;
    }
    invert(doc) {
        return new DocAttrStep(this.attr, doc.attrs[this.attr]);
    }
    map(mapping) {
        return this;
    }
    toJSON() {
        return { stepType: "docAttr", attr: this.attr, value: this.value };
    }
    static fromJSON(schema, json) {
        if (typeof json.attr != "string")
            throw new RangeError("Invalid input for DocAttrStep.fromJSON");
        return new DocAttrStep(json.attr, json.value);
    }
}
Step.jsonID("docAttr", DocAttrStep);

/**
@internal
*/
let TransformError = class extends Error {
};
TransformError = function TransformError(message) {
    let err = Error.call(this, message);
    err.__proto__ = TransformError.prototype;
    return err;
};
TransformError.prototype = Object.create(Error.prototype);
TransformError.prototype.constructor = TransformError;
TransformError.prototype.name = "TransformError";
/**
Abstraction to build up and track an array of
[steps](https://prosemirror.net/docs/ref/#transform.Step) representing a document transformation.

Most transforming methods return the `Transform` object itself, so
that they can be chained.
*/
class Transform {
    /**
    Create a transform that starts with the given document.
    */
    constructor(
    /**
    The current document (the result of applying the steps in the
    transform).
    */
    doc) {
        this.doc = doc;
        /**
        The steps in this transform.
        */
        this.steps = [];
        /**
        The documents before each of the steps.
        */
        this.docs = [];
        /**
        A mapping with the maps for each of the steps in this transform.
        */
        this.mapping = new Mapping;
    }
    /**
    The starting document.
    */
    get before() { return this.docs.length ? this.docs[0] : this.doc; }
    /**
    Apply a new step in this transform, saving the result. Throws an
    error when the step fails.
    */
    step(step) {
        let result = this.maybeStep(step);
        if (result.failed)
            throw new TransformError(result.failed);
        return this;
    }
    /**
    Try to apply a step in this transformation, ignoring it if it
    fails. Returns the step result.
    */
    maybeStep(step) {
        let result = step.apply(this.doc);
        if (!result.failed)
            this.addStep(step, result.doc);
        return result;
    }
    /**
    True when the document has been changed (when there are any
    steps).
    */
    get docChanged() {
        return this.steps.length > 0;
    }
    /**
    Return a single range, in post-transform document positions,
    that covers all content changed by this transform. Returns null
    if no replacements are made. Note that this will ignore changes
    that add/remove marks without replacing the underlying content.
    */
    changedRange() {
        let from = 1e9, to = -1e9;
        for (let i = 0; i < this.mapping.maps.length; i++) {
            let map = this.mapping.maps[i];
            if (i) {
                from = map.map(from, 1);
                to = map.map(to, -1);
            }
            map.forEach((_f, _t, fromB, toB) => {
                from = Math.min(from, fromB);
                to = Math.max(to, toB);
            });
        }
        return from == 1e9 ? null : { from, to };
    }
    /**
    @internal
    */
    addStep(step, doc) {
        this.docs.push(this.doc);
        this.steps.push(step);
        this.mapping.appendMap(step.getMap());
        this.doc = doc;
    }
    /**
    Replace the part of the document between `from` and `to` with the
    given `slice`.
    */
    replace(from, to = from, slice = prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty) {
        let step = replaceStep(this.doc, from, to, slice);
        if (step)
            this.step(step);
        return this;
    }
    /**
    Replace the given range with the given content, which may be a
    fragment, node, or array of nodes.
    */
    replaceWith(from, to, content) {
        return this.replace(from, to, new prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji(prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Fragment */ .FK.from(content), 0, 0));
    }
    /**
    Delete the content between the given positions.
    */
    delete(from, to) {
        return this.replace(from, to, prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Slice */ .Ji.empty);
    }
    /**
    Insert the given content at the given position.
    */
    insert(pos, content) {
        return this.replaceWith(pos, pos, content);
    }
    /**
    Replace a range of the document with a given slice, using
    `from`, `to`, and the slice's
    [`openStart`](https://prosemirror.net/docs/ref/#model.Slice.openStart) property as hints, rather
    than fixed start and end points. This method may grow the
    replaced area or close open nodes in the slice in order to get a
    fit that is more in line with WYSIWYG expectations, by dropping
    fully covered parent nodes of the replaced region when they are
    marked [non-defining as
    context](https://prosemirror.net/docs/ref/#model.NodeSpec.definingAsContext), or including an
    open parent node from the slice that _is_ marked as [defining
    its content](https://prosemirror.net/docs/ref/#model.NodeSpec.definingForContent).
    
    This is the method, for example, to handle paste. The similar
    [`replace`](https://prosemirror.net/docs/ref/#transform.Transform.replace) method is a more
    primitive tool which will _not_ move the start and end of its given
    range, and is useful in situations where you need more precise
    control over what happens.
    */
    replaceRange(from, to, slice) {
        replaceRange(this, from, to, slice);
        return this;
    }
    /**
    Replace the given range with a node, but use `from` and `to` as
    hints, rather than precise positions. When from and to are the same
    and are at the start or end of a parent node in which the given
    node doesn't fit, this method may _move_ them out towards a parent
    that does allow the given node to be placed. When the given range
    completely covers a parent node, this method may completely replace
    that parent node.
    */
    replaceRangeWith(from, to, node) {
        replaceRangeWith(this, from, to, node);
        return this;
    }
    /**
    Delete the given range, expanding it to cover fully covered
    parent nodes until a valid replace is found.
    */
    deleteRange(from, to) {
        deleteRange(this, from, to);
        return this;
    }
    /**
    Split the content in the given range off from its parent, if there
    is sibling content before or after it, and move it up the tree to
    the depth specified by `target`. You'll probably want to use
    [`liftTarget`](https://prosemirror.net/docs/ref/#transform.liftTarget) to compute `target`, to make
    sure the lift is valid.
    */
    lift(range, target) {
        lift(this, range, target);
        return this;
    }
    /**
    Join the blocks around the given position. If depth is 2, their
    last and first siblings are also joined, and so on.
    */
    join(pos, depth = 1) {
        join(this, pos, depth);
        return this;
    }
    /**
    Wrap the given [range](https://prosemirror.net/docs/ref/#model.NodeRange) in the given set of wrappers.
    The wrappers are assumed to be valid in this position, and should
    probably be computed with [`findWrapping`](https://prosemirror.net/docs/ref/#transform.findWrapping).
    */
    wrap(range, wrappers) {
        wrap(this, range, wrappers);
        return this;
    }
    /**
    Set the type of all textblocks (partly) between `from` and `to` to
    the given node type with the given attributes.
    */
    setBlockType(from, to = from, type, attrs = null) {
        setBlockType(this, from, to, type, attrs);
        return this;
    }
    /**
    Change the type, attributes, and/or marks of the node at `pos`.
    When `type` isn't given, the existing node type is preserved,
    */
    setNodeMarkup(pos, type, attrs = null, marks) {
        setNodeMarkup(this, pos, type, attrs, marks);
        return this;
    }
    /**
    Set a single attribute on a given node to a new value.
    The `pos` addresses the document content. Use `setDocAttribute`
    to set attributes on the document itself.
    */
    setNodeAttribute(pos, attr, value) {
        this.step(new AttrStep(pos, attr, value));
        return this;
    }
    /**
    Set a single attribute on the document to a new value.
    */
    setDocAttribute(attr, value) {
        this.step(new DocAttrStep(attr, value));
        return this;
    }
    /**
    Add a mark to the node at position `pos`.
    */
    addNodeMark(pos, mark) {
        this.step(new AddNodeMarkStep(pos, mark));
        return this;
    }
    /**
    Remove a mark (or all marks of the given type) from the node at
    position `pos`.
    */
    removeNodeMark(pos, mark) {
        let node = this.doc.nodeAt(pos);
        if (!node)
            throw new RangeError("No node at position " + pos);
        if (mark instanceof prosemirror_model__WEBPACK_IMPORTED_MODULE_0__/* .Mark */ .CU) {
            if (mark.isInSet(node.marks))
                this.step(new RemoveNodeMarkStep(pos, mark));
        }
        else {
            let set = node.marks, found, steps = [];
            while (found = mark.isInSet(set)) {
                steps.push(new RemoveNodeMarkStep(pos, found));
                set = found.removeFromSet(set);
            }
            for (let i = steps.length - 1; i >= 0; i--)
                this.step(steps[i]);
        }
        return this;
    }
    /**
    Split the node at the given position, and optionally, if `depth` is
    greater than one, any number of nodes above that. By default, the
    parts split off will inherit the node type of the original node.
    This can be changed by passing an array of types and attributes to
    use after the split (with the outermost nodes coming first).
    */
    split(pos, depth = 1, typesAfter) {
        split(this, pos, depth, typesAfter);
        return this;
    }
    /**
    Add the given mark to the inline content between `from` and `to`.
    */
    addMark(from, to, mark) {
        addMark(this, from, to, mark);
        return this;
    }
    /**
    Remove marks from inline nodes between `from` and `to`. When
    `mark` is a single mark, remove precisely that mark. When it is
    a mark type, remove all marks of that type. When it is null,
    remove all marks of any type.
    */
    removeMark(from, to, mark) {
        removeMark(this, from, to, mark);
        return this;
    }
    /**
    Removes all marks and nodes from the content of the node at
    `pos` that don't match the given new parent node type. Accepts
    an optional starting [content match](https://prosemirror.net/docs/ref/#model.ContentMatch) as
    third argument.
    */
    clearIncompatible(pos, parentType, match) {
        clearIncompatible(this, pos, parentType, match);
        return this;
    }
}




/***/ })

}]);
//# sourceMappingURL=68c0b443dfd65443ae81324a770418e8de40ae29-67adaba5ebe7442cfcf5.js.map