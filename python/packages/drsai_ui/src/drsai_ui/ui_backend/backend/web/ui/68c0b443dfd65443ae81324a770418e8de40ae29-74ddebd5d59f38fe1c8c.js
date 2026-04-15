"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[2302],{

/***/ 71758:
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
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/eye.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const Eye = (0,createLucideIcon/* default */.A)("Eye", [
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
// EXTERNAL MODULE: ./src/components/common/markdownrender.tsx + 213 modules
var markdownrender = __webpack_require__(57256);
;// ./src/pages/FilePreviewPage.tsx







const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
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
const FilePreviewPage = _ref => {
  let {
    file = null
  } = _ref;
  const [loading, setLoading] = react.useState(false);
  const [error, setError] = react.useState(null);
  const [originalText, setOriginalText] = react.useState("");
  const [editedText, setEditedText] = react.useState("");
  const [isEditing, setIsEditing] = react.useState(true);
  const dataUrl = react.useMemo(() => file ? fileToDataUrl(file) : null, [file]);
  const textMode = react.useMemo(() => file ? isTextFile(file) : false, [file]);
  const markdownMode = react.useMemo(() => file ? isMarkdownFile(file) : false, [file]);
  const imageMode = react.useMemo(() => file ? isImageFile(file) : false, [file]);
  const pdfMode = react.useMemo(() => file ? isPdfFile(file) : false, [file]);
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
  return /*#__PURE__*/react.createElement("div", {
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
  }, isEditing ? /*#__PURE__*/react.createElement(Eye, {
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
  }), "\u4FDD\u5B58\u4E3A\u526F\u672C"))), /*#__PURE__*/react.createElement("div", {
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
  }), !loading && !error && !textMode && !imageMode && !pdfMode && /*#__PURE__*/react.createElement("div", {
    className: "text-sm text-secondary"
  }, "\u5F53\u524D\u6587\u4EF6\u7C7B\u578B\u6682\u4E0D\u652F\u6301\u5728\u7EBF\u7F16\u8F91\uFF0C\u53EF\u4F7F\u7528\u4E0B\u8F7D\u6309\u94AE\u67E5\u770B\u3002")));
};
/* harmony default export */ var pages_FilePreviewPage = (FilePreviewPage);

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


/***/ })

}]);
//# sourceMappingURL=68c0b443dfd65443ae81324a770418e8de40ae29-74ddebd5d59f38fe1c8c.js.map