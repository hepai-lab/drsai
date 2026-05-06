"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[5358],{

/***/ 76726:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   VncScreen: function() { return /* binding */ yi; }
/* harmony export */ });
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(74848);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(96540);


function Rn(P) {
  return P && P.__esModule && Object.prototype.hasOwnProperty.call(P, "default") ? P.default : P;
}
var Mt = {}, wt = {}, vr;
function dn() {
  if (vr) return wt;
  vr = 1, Object.defineProperty(wt, "__esModule", {
    value: !0
  }), wt.toSigned32bit = h, wt.toUnsigned32bit = P;
  function P(Y) {
    return Y >>> 0;
  }
  function h(Y) {
    return Y | 0;
  }
  return wt;
}
var Je = {}, yr;
function ht() {
  if (yr) return Je;
  yr = 1, Object.defineProperty(Je, "__esModule", {
    value: !0
  }), Je.Warn = Je.Info = Je.Error = Je.Debug = void 0, Je.getLogging = Y, Je.initLogging = h;
  var P = "warn";
  Je.Debug = function() {
  }, Je.Info = function() {
  }, Je.Warn = function() {
  }, Je.Error = function() {
  };
  function h(A) {
    if (typeof A > "u" ? A = P : P = A, Je.Debug = Je.Info = Je.Warn = Je.Error = function() {
    }, typeof window.console < "u")
      switch (A) {
        case "debug":
          Je.Debug = console.debug.bind(window.console);
        case "info":
          Je.Info = console.info.bind(window.console);
        case "warn":
          Je.Warn = console.warn.bind(window.console);
        case "error":
          Je.Error = console.error.bind(window.console);
        case "none":
          break;
        default:
          throw new window.Error("invalid logging type '" + A + "'");
      }
  }
  function Y() {
    return P;
  }
  return h(), Je;
}
var kt = {}, xr;
function _n() {
  if (xr) return kt;
  xr = 1, Object.defineProperty(kt, "__esModule", {
    value: !0
  }), kt.decodeUTF8 = P, kt.encodeUTF8 = h;
  function P(Y) {
    var A = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !1;
    try {
      return decodeURIComponent(escape(Y));
    } catch (K) {
      if (K instanceof URIError && A)
        return Y;
      throw K;
    }
  }
  function h(Y) {
    return unescape(encodeURIComponent(Y));
  }
  return kt;
}
var Ve = {}, gr;
function Ct() {
  if (gr) return Ve;
  gr = 1;
  function P(S) {
    "@babel/helpers - typeof";
    return P = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(X) {
      return typeof X;
    } : function(X) {
      return X && typeof Symbol == "function" && X.constructor === Symbol && X !== Symbol.prototype ? "symbol" : typeof X;
    }, P(S);
  }
  Object.defineProperty(Ve, "__esModule", {
    value: !0
  }), Ve.hasScrollbarGutter = Ve.dragThreshold = void 0, Ve.isAndroid = r, Ve.isBlink = g, Ve.isChrome = n, Ve.isChromeOS = i, Ve.isChromium = c, Ve.isEdge = v, Ve.isFirefox = a, Ve.isGecko = b, Ve.isIOS = f, Ve.isMac = s, Ve.isOpera = x, Ve.isSafari = l, Ve.isTouchDevice = void 0, Ve.isWebKit = y, Ve.isWindows = p, Ve.supportsCursorURIs = void 0;
  var h = A(ht());
  function Y(S) {
    if (typeof WeakMap != "function") return null;
    var X = /* @__PURE__ */ new WeakMap(), F = /* @__PURE__ */ new WeakMap();
    return (Y = function(Q) {
      return Q ? F : X;
    })(S);
  }
  function A(S, X) {
    if (S && S.__esModule) return S;
    if (S === null || P(S) != "object" && typeof S != "function") return { default: S };
    var F = Y(X);
    if (F && F.has(S)) return F.get(S);
    var T = { __proto__: null }, Q = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var D in S) if (D !== "default" && {}.hasOwnProperty.call(S, D)) {
      var j = Q ? Object.getOwnPropertyDescriptor(S, D) : null;
      j && (j.get || j.set) ? Object.defineProperty(T, D, j) : T[D] = S[D];
    }
    return T.default = S, F && F.set(S, T), T;
  }
  Ve.isTouchDevice = "ontouchstart" in document.documentElement || // requried for Chrome debugger
  document.ontouchstart !== void 0 || // required for MS Surface
  navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0, window.addEventListener("touchstart", function S() {
    Ve.isTouchDevice = !0, window.removeEventListener("touchstart", S, !1);
  }, !1), Ve.dragThreshold = 10 * (window.devicePixelRatio || 1);
  var K = !1;
  try {
    var I = document.createElement("canvas");
    I.style.cursor = 'url("data:image/x-icon;base64,AAACAAEACAgAAAIAAgA4AQAAFgAAACgAAAAIAAAAEAAAAAEAIAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAA==") 2 2, default', I.style.cursor.indexOf("url") === 0 ? (h.Info("Data URI scheme cursor supported"), K = !0) : h.Warn("Data URI scheme cursor not supported");
  } catch (S) {
    h.Error("Data URI scheme cursor test exception: " + S);
  }
  Ve.supportsCursorURIs = K;
  var L = !0;
  try {
    var C = document.createElement("div");
    C.style.visibility = "hidden", C.style.overflow = "scroll", document.body.appendChild(C);
    var u = document.createElement("div");
    C.appendChild(u);
    var _ = C.offsetWidth - u.offsetWidth;
    C.parentNode.removeChild(C), L = _ != 0;
  } catch (S) {
    h.Error("Scrollbar test exception: " + S);
  }
  Ve.hasScrollbarGutter = L;
  function s() {
    return !!/mac/i.exec(navigator.platform);
  }
  function p() {
    return !!/win/i.exec(navigator.platform);
  }
  function f() {
    return !!/ipad/i.exec(navigator.platform) || !!/iphone/i.exec(navigator.platform) || !!/ipod/i.exec(navigator.platform);
  }
  function r() {
    return !!navigator.userAgent.match("Android ");
  }
  function i() {
    return !!navigator.userAgent.match(" CrOS ");
  }
  function l() {
    return !!navigator.userAgent.match("Safari/...") && !navigator.userAgent.match("Chrome/...") && !navigator.userAgent.match("Chromium/...") && !navigator.userAgent.match("Epiphany/...");
  }
  function a() {
    return !!navigator.userAgent.match("Firefox/...") && !navigator.userAgent.match("Seamonkey/...");
  }
  function n() {
    return !!navigator.userAgent.match("Chrome/...") && !navigator.userAgent.match("Chromium/...") && !navigator.userAgent.match("Edg/...") && !navigator.userAgent.match("OPR/...");
  }
  function c() {
    return !!navigator.userAgent.match("Chromium/...");
  }
  function x() {
    return !!navigator.userAgent.match("OPR/...");
  }
  function v() {
    return !!navigator.userAgent.match("Edg/...");
  }
  function b() {
    return !!navigator.userAgent.match("Gecko/...");
  }
  function y() {
    return !!navigator.userAgent.match("AppleWebKit/...") && !navigator.userAgent.match("Chrome/...");
  }
  function g() {
    return !!navigator.userAgent.match("Chrome/...");
  }
  return Ve;
}
var Xt = {}, br;
function Tn() {
  if (br) return Xt;
  br = 1, Object.defineProperty(Xt, "__esModule", {
    value: !0
  }), Xt.clientToElement = P;
  function P(h, Y, A) {
    var K = A.getBoundingClientRect(), I = {
      x: 0,
      y: 0
    };
    return h < K.left ? I.x = 0 : h >= K.right ? I.x = K.width - 1 : I.x = h - K.left, Y < K.top ? I.y = 0 : Y >= K.bottom ? I.y = K.height - 1 : I.y = Y - K.top, I;
  }
  return Xt;
}
var pt = {}, mr;
function pn() {
  if (mr) return pt;
  mr = 1, Object.defineProperty(pt, "__esModule", {
    value: !0
  }), pt.getPointerEvent = P, pt.releaseCapture = u, pt.setCapture = C, pt.stopEvent = h;
  function P(_) {
    return _.changedTouches ? _.changedTouches[0] : _.touches ? _.touches[0] : _;
  }
  function h(_) {
    _.stopPropagation(), _.preventDefault();
  }
  var Y = !1, A = null;
  document.captureElement = null;
  function K(_) {
    if (!Y) {
      var s = new _.constructor(_.type, _);
      Y = !0, document.captureElement ? document.captureElement.dispatchEvent(s) : A.dispatchEvent(s), Y = !1, _.stopPropagation(), s.defaultPrevented && _.preventDefault(), _.type === "mouseup" && u();
    }
  }
  function I() {
    var _ = document.getElementById("noVNC_mouse_capture_elem");
    _.style.cursor = window.getComputedStyle(document.captureElement).cursor;
  }
  var L = new MutationObserver(I);
  function C(_) {
    if (_.setCapture)
      _.setCapture(), document.captureElement = _;
    else {
      u();
      var s = document.getElementById("noVNC_mouse_capture_elem");
      s === null && (s = document.createElement("div"), s.id = "noVNC_mouse_capture_elem", s.style.position = "fixed", s.style.top = "0px", s.style.left = "0px", s.style.width = "100%", s.style.height = "100%", s.style.zIndex = 1e4, s.style.display = "none", document.body.appendChild(s), s.addEventListener("contextmenu", K), s.addEventListener("mousemove", K), s.addEventListener("mouseup", K)), document.captureElement = _, L.observe(_, {
        attributes: !0
      }), I(), s.style.display = "", window.addEventListener("mousemove", K), window.addEventListener("mouseup", K);
    }
  }
  function u() {
    if (document.releaseCapture)
      document.releaseCapture(), document.captureElement = null;
    else {
      if (!document.captureElement)
        return;
      A = document.captureElement, document.captureElement = null, L.disconnect();
      var _ = document.getElementById("noVNC_mouse_capture_elem");
      _.style.display = "none", window.removeEventListener("mousemove", K), window.removeEventListener("mouseup", K);
    }
  }
  return pt;
}
var Dt = {}, wr;
function vn() {
  return wr || (wr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    function h(C) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(u) {
        return typeof u;
      } : function(u) {
        return u && typeof Symbol == "function" && u.constructor === Symbol && u !== Symbol.prototype ? "symbol" : typeof u;
      }, h(C);
    }
    function Y(C, u) {
      if (!(C instanceof u)) throw new TypeError("Cannot call a class as a function");
    }
    function A(C, u) {
      for (var _ = 0; _ < u.length; _++) {
        var s = u[_];
        s.enumerable = s.enumerable || !1, s.configurable = !0, "value" in s && (s.writable = !0), Object.defineProperty(C, I(s.key), s);
      }
    }
    function K(C, u, _) {
      return u && A(C.prototype, u), Object.defineProperty(C, "prototype", { writable: !1 }), C;
    }
    function I(C) {
      var u = L(C, "string");
      return h(u) == "symbol" ? u : u + "";
    }
    function L(C, u) {
      if (h(C) != "object" || !C) return C;
      var _ = C[Symbol.toPrimitive];
      if (_ !== void 0) {
        var s = _.call(C, u);
        if (h(s) != "object") return s;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(C);
    }
    P.default = /* @__PURE__ */ function() {
      function C() {
        Y(this, C), this._listeners = /* @__PURE__ */ new Map();
      }
      return K(C, [{
        key: "addEventListener",
        value: function(_, s) {
          this._listeners.has(_) || this._listeners.set(_, /* @__PURE__ */ new Set()), this._listeners.get(_).add(s);
        }
      }, {
        key: "removeEventListener",
        value: function(_, s) {
          this._listeners.has(_) && this._listeners.get(_).delete(s);
        }
      }, {
        key: "dispatchEvent",
        value: function(_) {
          var s = this;
          return this._listeners.has(_.type) ? (this._listeners.get(_.type).forEach(function(p) {
            return p.call(s, _);
          }), !_.defaultPrevented) : !0;
        }
      }]);
    }();
  }(Dt)), Dt;
}
var Ot = {}, Bt = {}, kr;
function yn() {
  return kr || (kr = 1, function(P) {
    function h(I) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(L) {
        return typeof L;
      } : function(L) {
        return L && typeof Symbol == "function" && L.constructor === Symbol && L !== Symbol.prototype ? "symbol" : typeof L;
      }, h(I);
    }
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var Y = K(ht());
    function A(I) {
      if (typeof WeakMap != "function") return null;
      var L = /* @__PURE__ */ new WeakMap(), C = /* @__PURE__ */ new WeakMap();
      return (A = function(_) {
        return _ ? C : L;
      })(I);
    }
    function K(I, L) {
      if (I && I.__esModule) return I;
      if (I === null || h(I) != "object" && typeof I != "function") return { default: I };
      var C = A(L);
      if (C && C.has(I)) return C.get(I);
      var u = { __proto__: null }, _ = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var s in I) if (s !== "default" && {}.hasOwnProperty.call(I, s)) {
        var p = _ ? Object.getOwnPropertyDescriptor(I, s) : null;
        p && (p.get || p.set) ? Object.defineProperty(u, s, p) : u[s] = I[s];
      }
      return u.default = I, C && C.set(I, u), u;
    }
    P.default = {
      /* Convert data (an array of integers) to a Base64 string. */
      toBase64Table: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".split(""),
      base64Pad: "=",
      encode: function(L) {
        for (var C = "", u = L.length, _ = u % 3, s = 0; s < u - 2; s += 3)
          C += this.toBase64Table[L[s] >> 2], C += this.toBase64Table[((L[s] & 3) << 4) + (L[s + 1] >> 4)], C += this.toBase64Table[((L[s + 1] & 15) << 2) + (L[s + 2] >> 6)], C += this.toBase64Table[L[s + 2] & 63];
        var p = u - _;
        return _ === 2 ? (C += this.toBase64Table[L[p] >> 2], C += this.toBase64Table[((L[p] & 3) << 4) + (L[p + 1] >> 4)], C += this.toBase64Table[(L[p + 1] & 15) << 2], C += this.toBase64Table[64]) : _ === 1 && (C += this.toBase64Table[L[p] >> 2], C += this.toBase64Table[(L[p] & 3) << 4], C += this.toBase64Table[64], C += this.toBase64Table[64]), C;
      },
      /* Convert Base64 data to a string */
      /* eslint-disable comma-spacing */
      toBinaryTable: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 62, -1, -1, -1, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, 0, -1, -1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, -1, -1, -1, -1, -1, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1],
      /* eslint-enable comma-spacing */
      decode: function(L) {
        var C = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0, u = L.indexOf("=") - C;
        u < 0 && (u = L.length - C);
        for (var _ = (u >> 2) * 3 + Math.floor(u % 4 / 1.5), s = new Array(_), p = 0, f = 0, r = 0, i = C; i < L.length; i++) {
          var l = this.toBinaryTable[L.charCodeAt(i) & 127], a = L.charAt(i) === this.base64Pad;
          if (l === -1) {
            Y.Error("Illegal character code " + L.charCodeAt(i) + " at position " + i);
            continue;
          }
          f = f << 6 | l, p += 6, p >= 8 && (p -= 8, a || (s[r++] = f >> p & 255), f &= (1 << p) - 1);
        }
        if (p) {
          var n = new Error("Corrupted base64 string");
          throw n.name = "Base64-Error", n;
        }
        return s;
      }
    };
  }(Bt)), Bt;
}
var Sr;
function Pn() {
  return Sr || (Sr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = L(ht()), Y = K(yn()), A = dn();
    function K(r) {
      return r && r.__esModule ? r : { default: r };
    }
    function I(r) {
      if (typeof WeakMap != "function") return null;
      var i = /* @__PURE__ */ new WeakMap(), l = /* @__PURE__ */ new WeakMap();
      return (I = function(n) {
        return n ? l : i;
      })(r);
    }
    function L(r, i) {
      if (r && r.__esModule) return r;
      if (r === null || C(r) != "object" && typeof r != "function") return { default: r };
      var l = I(i);
      if (l && l.has(r)) return l.get(r);
      var a = { __proto__: null }, n = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var c in r) if (c !== "default" && {}.hasOwnProperty.call(r, c)) {
        var x = n ? Object.getOwnPropertyDescriptor(r, c) : null;
        x && (x.get || x.set) ? Object.defineProperty(a, c, x) : a[c] = r[c];
      }
      return a.default = r, l && l.set(r, a), a;
    }
    function C(r) {
      "@babel/helpers - typeof";
      return C = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(i) {
        return typeof i;
      } : function(i) {
        return i && typeof Symbol == "function" && i.constructor === Symbol && i !== Symbol.prototype ? "symbol" : typeof i;
      }, C(r);
    }
    function u(r, i) {
      if (!(r instanceof i)) throw new TypeError("Cannot call a class as a function");
    }
    function _(r, i) {
      for (var l = 0; l < i.length; l++) {
        var a = i[l];
        a.enumerable = a.enumerable || !1, a.configurable = !0, "value" in a && (a.writable = !0), Object.defineProperty(r, p(a.key), a);
      }
    }
    function s(r, i, l) {
      return i && _(r.prototype, i), Object.defineProperty(r, "prototype", { writable: !1 }), r;
    }
    function p(r) {
      var i = f(r, "string");
      return C(i) == "symbol" ? i : i + "";
    }
    function f(r, i) {
      if (C(r) != "object" || !r) return r;
      var l = r[Symbol.toPrimitive];
      if (l !== void 0) {
        var a = l.call(r, i);
        if (C(a) != "object") return a;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(r);
    }
    P.default = /* @__PURE__ */ function() {
      function r(i) {
        if (u(this, r), this._drawCtx = null, this._renderQ = [], this._flushPromise = null, this._fbWidth = 0, this._fbHeight = 0, this._prevDrawStyle = "", h.Debug(">> Display.constructor"), this._target = i, !this._target)
          throw new Error("Target must be set");
        if (typeof this._target == "string")
          throw new Error("target must be a DOM element");
        if (!this._target.getContext)
          throw new Error("no getContext method");
        this._targetCtx = this._target.getContext("2d"), this._viewportLoc = {
          x: 0,
          y: 0,
          w: this._target.width,
          h: this._target.height
        }, this._backbuffer = document.createElement("canvas"), this._drawCtx = this._backbuffer.getContext("2d"), this._damageBounds = {
          left: 0,
          top: 0,
          right: this._backbuffer.width,
          bottom: this._backbuffer.height
        }, h.Debug("User Agent: " + navigator.userAgent), h.Debug("<< Display.constructor"), this._scale = 1, this._clipViewport = !1;
      }
      return s(r, [{
        key: "scale",
        get: function() {
          return this._scale;
        },
        set: function(l) {
          this._rescale(l);
        }
      }, {
        key: "clipViewport",
        get: function() {
          return this._clipViewport;
        },
        set: function(l) {
          this._clipViewport = l;
          var a = this._viewportLoc;
          this.viewportChangeSize(a.w, a.h), this.viewportChangePos(0, 0);
        }
      }, {
        key: "width",
        get: function() {
          return this._fbWidth;
        }
      }, {
        key: "height",
        get: function() {
          return this._fbHeight;
        }
        // ===== PUBLIC METHODS =====
      }, {
        key: "viewportChangePos",
        value: function(l, a) {
          var n = this._viewportLoc;
          l = Math.floor(l), a = Math.floor(a), this._clipViewport || (l = -n.w, a = -n.h);
          var c = n.x + n.w - 1, x = n.y + n.h - 1;
          l < 0 && n.x + l < 0 && (l = -n.x), c + l >= this._fbWidth && (l -= c + l - this._fbWidth + 1), n.y + a < 0 && (a = -n.y), x + a >= this._fbHeight && (a -= x + a - this._fbHeight + 1), !(l === 0 && a === 0) && (h.Debug("viewportChange deltaX: " + l + ", deltaY: " + a), n.x += l, n.y += a, this._damage(n.x, n.y, n.w, n.h), this.flip());
        }
      }, {
        key: "viewportChangeSize",
        value: function(l, a) {
          (!this._clipViewport || typeof l > "u" || typeof a > "u") && (h.Debug("Setting viewport to full display region"), l = this._fbWidth, a = this._fbHeight), l = Math.floor(l), a = Math.floor(a), l > this._fbWidth && (l = this._fbWidth), a > this._fbHeight && (a = this._fbHeight);
          var n = this._viewportLoc;
          if (n.w !== l || n.h !== a) {
            n.w = l, n.h = a;
            var c = this._target;
            c.width = l, c.height = a, this.viewportChangePos(0, 0), this._damage(n.x, n.y, n.w, n.h), this.flip(), this._rescale(this._scale);
          }
        }
      }, {
        key: "absX",
        value: function(l) {
          return this._scale === 0 ? 0 : (0, A.toSigned32bit)(l / this._scale + this._viewportLoc.x);
        }
      }, {
        key: "absY",
        value: function(l) {
          return this._scale === 0 ? 0 : (0, A.toSigned32bit)(l / this._scale + this._viewportLoc.y);
        }
      }, {
        key: "resize",
        value: function(l, a) {
          this._prevDrawStyle = "", this._fbWidth = l, this._fbHeight = a;
          var n = this._backbuffer;
          if (n.width !== l || n.height !== a) {
            var c = null;
            n.width > 0 && n.height > 0 && (c = this._drawCtx.getImageData(0, 0, n.width, n.height)), n.width !== l && (n.width = l), n.height !== a && (n.height = a), c && this._drawCtx.putImageData(c, 0, 0);
          }
          var x = this._viewportLoc;
          this.viewportChangeSize(x.w, x.h), this.viewportChangePos(0, 0);
        }
      }, {
        key: "getImageData",
        value: function() {
          return this._drawCtx.getImageData(0, 0, this.width, this.height);
        }
      }, {
        key: "toDataURL",
        value: function(l, a) {
          return this._backbuffer.toDataURL(l, a);
        }
      }, {
        key: "toBlob",
        value: function(l, a, n) {
          return this._backbuffer.toBlob(l, a, n);
        }
        // Track what parts of the visible canvas that need updating
      }, {
        key: "_damage",
        value: function(l, a, n, c) {
          l < this._damageBounds.left && (this._damageBounds.left = l), a < this._damageBounds.top && (this._damageBounds.top = a), l + n > this._damageBounds.right && (this._damageBounds.right = l + n), a + c > this._damageBounds.bottom && (this._damageBounds.bottom = a + c);
        }
        // Update the visible canvas with the contents of the
        // rendering canvas
      }, {
        key: "flip",
        value: function(l) {
          if (this._renderQ.length !== 0 && !l)
            this._renderQPush({
              type: "flip"
            });
          else {
            var a = this._damageBounds.left, n = this._damageBounds.top, c = this._damageBounds.right - a, x = this._damageBounds.bottom - n, v = a - this._viewportLoc.x, b = n - this._viewportLoc.y;
            v < 0 && (c += v, a -= v, v = 0), b < 0 && (x += b, n -= b, b = 0), v + c > this._viewportLoc.w && (c = this._viewportLoc.w - v), b + x > this._viewportLoc.h && (x = this._viewportLoc.h - b), c > 0 && x > 0 && this._targetCtx.drawImage(this._backbuffer, a, n, c, x, v, b, c, x), this._damageBounds.left = this._damageBounds.top = 65535, this._damageBounds.right = this._damageBounds.bottom = 0;
          }
        }
      }, {
        key: "pending",
        value: function() {
          return this._renderQ.length > 0;
        }
      }, {
        key: "flush",
        value: function() {
          var l = this;
          return this._renderQ.length === 0 ? Promise.resolve() : (this._flushPromise === null && (this._flushPromise = new Promise(function(a) {
            l._flushResolve = a;
          })), this._flushPromise);
        }
      }, {
        key: "fillRect",
        value: function(l, a, n, c, x, v) {
          this._renderQ.length !== 0 && !v ? this._renderQPush({
            type: "fill",
            x: l,
            y: a,
            width: n,
            height: c,
            color: x
          }) : (this._setFillColor(x), this._drawCtx.fillRect(l, a, n, c), this._damage(l, a, n, c));
        }
      }, {
        key: "copyImage",
        value: function(l, a, n, c, x, v, b) {
          this._renderQ.length !== 0 && !b ? this._renderQPush({
            type: "copy",
            oldX: l,
            oldY: a,
            x: n,
            y: c,
            width: x,
            height: v
          }) : (this._drawCtx.mozImageSmoothingEnabled = !1, this._drawCtx.webkitImageSmoothingEnabled = !1, this._drawCtx.msImageSmoothingEnabled = !1, this._drawCtx.imageSmoothingEnabled = !1, this._drawCtx.drawImage(this._backbuffer, l, a, x, v, n, c, x, v), this._damage(n, c, x, v));
        }
      }, {
        key: "imageRect",
        value: function(l, a, n, c, x, v) {
          if (!(n === 0 || c === 0)) {
            var b = new Image();
            b.src = "data: " + x + ";base64," + Y.default.encode(v), this._renderQPush({
              type: "img",
              img: b,
              x: l,
              y: a,
              width: n,
              height: c
            });
          }
        }
      }, {
        key: "blitImage",
        value: function(l, a, n, c, x, v, b) {
          if (this._renderQ.length !== 0 && !b) {
            var y = new Uint8Array(n * c * 4);
            y.set(new Uint8Array(x.buffer, 0, y.length)), this._renderQPush({
              type: "blit",
              data: y,
              x: l,
              y: a,
              width: n,
              height: c
            });
          } else {
            var g = new Uint8ClampedArray(x.buffer, x.byteOffset + v, n * c * 4), S = new ImageData(g, n, c);
            this._drawCtx.putImageData(S, l, a), this._damage(l, a, n, c);
          }
        }
      }, {
        key: "drawImage",
        value: function(l, a, n) {
          this._drawCtx.drawImage(l, a, n), this._damage(a, n, l.width, l.height);
        }
      }, {
        key: "autoscale",
        value: function(l, a) {
          var n;
          if (l === 0 || a === 0)
            n = 0;
          else {
            var c = this._viewportLoc, x = l / a, v = c.w / c.h;
            v >= x ? n = l / c.w : n = a / c.h;
          }
          this._rescale(n);
        }
        // ===== PRIVATE METHODS =====
      }, {
        key: "_rescale",
        value: function(l) {
          this._scale = l;
          var a = this._viewportLoc, n = l * a.w + "px", c = l * a.h + "px";
          (this._target.style.width !== n || this._target.style.height !== c) && (this._target.style.width = n, this._target.style.height = c);
        }
      }, {
        key: "_setFillColor",
        value: function(l) {
          var a = "rgb(" + l[0] + "," + l[1] + "," + l[2] + ")";
          a !== this._prevDrawStyle && (this._drawCtx.fillStyle = a, this._prevDrawStyle = a);
        }
      }, {
        key: "_renderQPush",
        value: function(l) {
          this._renderQ.push(l), this._renderQ.length === 1 && this._scanRenderQ();
        }
      }, {
        key: "_resumeRenderQ",
        value: function() {
          this.removeEventListener("load", this._noVNCDisplay._resumeRenderQ), this._noVNCDisplay._scanRenderQ();
        }
      }, {
        key: "_scanRenderQ",
        value: function() {
          for (var l = !0; l && this._renderQ.length > 0; ) {
            var a = this._renderQ[0];
            switch (a.type) {
              case "flip":
                this.flip(!0);
                break;
              case "copy":
                this.copyImage(a.oldX, a.oldY, a.x, a.y, a.width, a.height, !0);
                break;
              case "fill":
                this.fillRect(a.x, a.y, a.width, a.height, a.color, !0);
                break;
              case "blit":
                this.blitImage(a.x, a.y, a.width, a.height, a.data, 0, !0);
                break;
              case "img":
                if (a.img.complete) {
                  if (a.img.width !== a.width || a.img.height !== a.height) {
                    h.Error("Decoded image has incorrect dimensions. Got " + a.img.width + "x" + a.img.height + ". Expected " + a.width + "x" + a.height + ".");
                    return;
                  }
                  this.drawImage(a.img, a.x, a.y);
                } else
                  a.img._noVNCDisplay = this, a.img.addEventListener("load", this._resumeRenderQ), l = !1;
                break;
            }
            l && this._renderQ.shift();
          }
          this._renderQ.length === 0 && this._flushPromise !== null && (this._flushResolve(), this._flushPromise = null, this._flushResolve = null);
        }
      }]);
    }();
  }(Ot)), Ot;
}
var Qt = {}, je = {}, st = {}, Kr;
function At() {
  if (Kr) return st;
  Kr = 1, Object.defineProperty(st, "__esModule", {
    value: !0
  }), st.Buf8 = st.Buf32 = st.Buf16 = void 0, st.arraySet = h, st.flattenChunks = Y, st.shrinkBuf = P;
  function P(A, K) {
    return A.length === K ? A : A.subarray ? A.subarray(0, K) : (A.length = K, A);
  }
  function h(A, K, I, L, C) {
    if (K.subarray && A.subarray) {
      A.set(K.subarray(I, I + L), C);
      return;
    }
    for (var u = 0; u < L; u++)
      A[C + u] = K[I + u];
  }
  function Y(A) {
    var K, I, L, C, u, _;
    for (L = 0, K = 0, I = A.length; K < I; K++)
      L += A[K].length;
    for (_ = new Uint8Array(L), C = 0, K = 0, I = A.length; K < I; K++)
      u = A[K], _.set(u, C), C += u.length;
    return _;
  }
  return st.Buf8 = Uint8Array, st.Buf16 = Uint16Array, st.Buf32 = Int32Array, st;
}
var It = {}, Er;
function xn() {
  return Er || (Er = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = h;
    function h(Y, A, K, I) {
      for (var L = Y & 65535 | 0, C = Y >>> 16 & 65535 | 0, u = 0; K !== 0; ) {
        u = K > 2e3 ? 2e3 : K, K -= u;
        do
          L = L + A[I++] | 0, C = C + L | 0;
        while (--u);
        L %= 65521, C %= 65521;
      }
      return L | C << 16 | 0;
    }
  }(It)), It;
}
var Ut = {}, Xr;
function gn() {
  return Xr || (Xr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = h;
    function h() {
      for (var Y, A = [], K = 0; K < 256; K++) {
        Y = K;
        for (var I = 0; I < 8; I++)
          Y = Y & 1 ? 3988292384 ^ Y >>> 1 : Y >>> 1;
        A[K] = Y;
      }
      return A;
    }
    h();
  }(Ut)), Ut;
}
var Nt = {}, Fr;
function Ln() {
  return Fr || (Fr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = A;
    var h = 30, Y = 12;
    function A(K, I) {
      var L, C, u, _, s, p, f, r, i, l, a, n, c, x, v, b, y, g, S, X, F, T, Q, D, j;
      L = K.state, C = K.next_in, D = K.input, u = C + (K.avail_in - 5), _ = K.next_out, j = K.output, s = _ - (I - K.avail_out), p = _ + (K.avail_out - 257), f = L.dmax, r = L.wsize, i = L.whave, l = L.wnext, a = L.window, n = L.hold, c = L.bits, x = L.lencode, v = L.distcode, b = (1 << L.lenbits) - 1, y = (1 << L.distbits) - 1;
      e: do {
        c < 15 && (n += D[C++] << c, c += 8, n += D[C++] << c, c += 8), g = x[n & b];
        t: for (; ; ) {
          if (S = g >>> 24, n >>>= S, c -= S, S = g >>> 16 & 255, S === 0)
            j[_++] = g & 65535;
          else if (S & 16) {
            X = g & 65535, S &= 15, S && (c < S && (n += D[C++] << c, c += 8), X += n & (1 << S) - 1, n >>>= S, c -= S), c < 15 && (n += D[C++] << c, c += 8, n += D[C++] << c, c += 8), g = v[n & y];
            r: for (; ; ) {
              if (S = g >>> 24, n >>>= S, c -= S, S = g >>> 16 & 255, S & 16) {
                if (F = g & 65535, S &= 15, c < S && (n += D[C++] << c, c += 8, c < S && (n += D[C++] << c, c += 8)), F += n & (1 << S) - 1, F > f) {
                  K.msg = "invalid distance too far back", L.mode = h;
                  break e;
                }
                if (n >>>= S, c -= S, S = _ - s, F > S) {
                  if (S = F - S, S > i && L.sane) {
                    K.msg = "invalid distance too far back", L.mode = h;
                    break e;
                  }
                  if (T = 0, Q = a, l === 0) {
                    if (T += r - S, S < X) {
                      X -= S;
                      do
                        j[_++] = a[T++];
                      while (--S);
                      T = _ - F, Q = j;
                    }
                  } else if (l < S) {
                    if (T += r + l - S, S -= l, S < X) {
                      X -= S;
                      do
                        j[_++] = a[T++];
                      while (--S);
                      if (T = 0, l < X) {
                        S = l, X -= S;
                        do
                          j[_++] = a[T++];
                        while (--S);
                        T = _ - F, Q = j;
                      }
                    }
                  } else if (T += l - S, S < X) {
                    X -= S;
                    do
                      j[_++] = a[T++];
                    while (--S);
                    T = _ - F, Q = j;
                  }
                  for (; X > 2; )
                    j[_++] = Q[T++], j[_++] = Q[T++], j[_++] = Q[T++], X -= 3;
                  X && (j[_++] = Q[T++], X > 1 && (j[_++] = Q[T++]));
                } else {
                  T = _ - F;
                  do
                    j[_++] = j[T++], j[_++] = j[T++], j[_++] = j[T++], X -= 3;
                  while (X > 2);
                  X && (j[_++] = j[T++], X > 1 && (j[_++] = j[T++]));
                }
              } else if ((S & 64) === 0) {
                g = v[(g & 65535) + (n & (1 << S) - 1)];
                continue r;
              } else {
                K.msg = "invalid distance code", L.mode = h;
                break e;
              }
              break;
            }
          } else if ((S & 64) === 0) {
            g = x[(g & 65535) + (n & (1 << S) - 1)];
            continue t;
          } else if (S & 32) {
            L.mode = Y;
            break e;
          } else {
            K.msg = "invalid literal/length code", L.mode = h;
            break e;
          }
          break;
        }
      } while (C < u && _ < p);
      X = c >> 3, C -= X, c -= X << 3, n &= (1 << c) - 1, K.next_in = C, K.next_out = _, K.avail_in = C < u ? 5 + (u - C) : 5 - (C - u), K.avail_out = _ < p ? 257 + (p - _) : 257 - (_ - p), L.hold = n, L.bits = c;
    }
  }(Nt)), Nt;
}
var jt = {}, Cr;
function Mn() {
  return Cr || (Cr = 1, function(P) {
    function h(a) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(n) {
        return typeof n;
      } : function(n) {
        return n && typeof Symbol == "function" && n.constructor === Symbol && n !== Symbol.prototype ? "symbol" : typeof n;
      }, h(a);
    }
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = l;
    var Y = K(At());
    function A(a) {
      if (typeof WeakMap != "function") return null;
      var n = /* @__PURE__ */ new WeakMap(), c = /* @__PURE__ */ new WeakMap();
      return (A = function(v) {
        return v ? c : n;
      })(a);
    }
    function K(a, n) {
      if (a && a.__esModule) return a;
      if (a === null || h(a) != "object" && typeof a != "function") return { default: a };
      var c = A(n);
      if (c && c.has(a)) return c.get(a);
      var x = { __proto__: null }, v = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var b in a) if (b !== "default" && {}.hasOwnProperty.call(a, b)) {
        var y = v ? Object.getOwnPropertyDescriptor(a, b) : null;
        y && (y.get || y.set) ? Object.defineProperty(x, b, y) : x[b] = a[b];
      }
      return x.default = a, c && c.set(a, x), x;
    }
    var I = 15, L = 852, C = 592, u = 0, _ = 1, s = 2, p = [
      /* Length codes 257..285 base */
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      13,
      15,
      17,
      19,
      23,
      27,
      31,
      35,
      43,
      51,
      59,
      67,
      83,
      99,
      115,
      131,
      163,
      195,
      227,
      258,
      0,
      0
    ], f = [
      /* Length codes 257..285 extra */
      16,
      16,
      16,
      16,
      16,
      16,
      16,
      16,
      17,
      17,
      17,
      17,
      18,
      18,
      18,
      18,
      19,
      19,
      19,
      19,
      20,
      20,
      20,
      20,
      21,
      21,
      21,
      21,
      16,
      72,
      78
    ], r = [
      /* Distance codes 0..29 base */
      1,
      2,
      3,
      4,
      5,
      7,
      9,
      13,
      17,
      25,
      33,
      49,
      65,
      97,
      129,
      193,
      257,
      385,
      513,
      769,
      1025,
      1537,
      2049,
      3073,
      4097,
      6145,
      8193,
      12289,
      16385,
      24577,
      0,
      0
    ], i = [
      /* Distance codes 0..29 extra */
      16,
      16,
      16,
      16,
      17,
      17,
      18,
      18,
      19,
      19,
      20,
      20,
      21,
      21,
      22,
      22,
      23,
      23,
      24,
      24,
      25,
      25,
      26,
      26,
      27,
      27,
      28,
      28,
      29,
      29,
      64,
      64
    ];
    function l(a, n, c, x, v, b, y, g) {
      var S = g.bits, X = 0, F = 0, T = 0, Q = 0, D = 0, j = 0, te = 0, he = 0, ge = 0, pe = 0, we, Ae, de, ke, Ce, Oe = null, J = 0, $, re = new Y.Buf16(I + 1), z = new Y.Buf16(I + 1), B = null, U = 0, ue, le, H;
      for (X = 0; X <= I; X++)
        re[X] = 0;
      for (F = 0; F < x; F++)
        re[n[c + F]]++;
      for (D = S, Q = I; Q >= 1 && re[Q] === 0; Q--)
        ;
      if (D > Q && (D = Q), Q === 0)
        return v[b++] = 1 << 24 | 64 << 16 | 0, v[b++] = 1 << 24 | 64 << 16 | 0, g.bits = 1, 0;
      for (T = 1; T < Q && re[T] === 0; T++)
        ;
      for (D < T && (D = T), he = 1, X = 1; X <= I; X++)
        if (he <<= 1, he -= re[X], he < 0)
          return -1;
      if (he > 0 && (a === u || Q !== 1))
        return -1;
      for (z[1] = 0, X = 1; X < I; X++)
        z[X + 1] = z[X] + re[X];
      for (F = 0; F < x; F++)
        n[c + F] !== 0 && (y[z[n[c + F]]++] = F);
      if (a === u ? (Oe = B = y, $ = 19) : a === _ ? (Oe = p, J -= 257, B = f, U -= 257, $ = 256) : (Oe = r, B = i, $ = -1), pe = 0, F = 0, X = T, Ce = b, j = D, te = 0, de = -1, ge = 1 << D, ke = ge - 1, a === _ && ge > L || a === s && ge > C)
        return 1;
      for (; ; ) {
        ue = X - te, y[F] < $ ? (le = 0, H = y[F]) : y[F] > $ ? (le = B[U + y[F]], H = Oe[J + y[F]]) : (le = 96, H = 0), we = 1 << X - te, Ae = 1 << j, T = Ae;
        do
          Ae -= we, v[Ce + (pe >> te) + Ae] = ue << 24 | le << 16 | H | 0;
        while (Ae !== 0);
        for (we = 1 << X - 1; pe & we; )
          we >>= 1;
        if (we !== 0 ? (pe &= we - 1, pe += we) : pe = 0, F++, --re[X] === 0) {
          if (X === Q)
            break;
          X = n[c + y[F]];
        }
        if (X > D && (pe & ke) !== de) {
          for (te === 0 && (te = D), Ce += T, j = X - te, he = 1 << j; j + te < Q && (he -= re[j + te], !(he <= 0)); )
            j++, he <<= 1;
          if (ge += 1 << j, a === _ && ge > L || a === s && ge > C)
            return 1;
          de = pe & ke, v[de] = D << 24 | j << 16 | Ce - b | 0;
        }
      }
      return pe !== 0 && (v[Ce + pe] = X - te << 24 | 64 << 16 | 0), g.bits = D, 0;
    }
  }(jt)), jt;
}
var Ar;
function Dn() {
  if (Ar) return je;
  Ar = 1;
  function P(R) {
    "@babel/helpers - typeof";
    return P = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(Z) {
      return typeof Z;
    } : function(Z) {
      return Z && typeof Symbol == "function" && Z.constructor === Symbol && Z !== Symbol.prototype ? "symbol" : typeof Z;
    }, P(R);
  }
  Object.defineProperty(je, "__esModule", {
    value: !0
  }), je.Z_TREES = je.Z_STREAM_ERROR = je.Z_STREAM_END = je.Z_OK = je.Z_NEED_DICT = je.Z_MEM_ERROR = je.Z_FINISH = je.Z_DEFLATED = je.Z_DATA_ERROR = je.Z_BUF_ERROR = je.Z_BLOCK = void 0, je.inflate = se, je.inflateEnd = fe, je.inflateGetHeader = ye, je.inflateInfo = void 0, je.inflateInit = Ye, je.inflateInit2 = We, je.inflateReset = qe, je.inflateReset2 = xe, je.inflateResetKeep = Ge, je.inflateSetDictionary = Fe;
  var h = u(At()), Y = L(xn()), A = L(gn()), K = L(Ln()), I = L(Mn());
  function L(R) {
    return R && R.__esModule ? R : { default: R };
  }
  function C(R) {
    if (typeof WeakMap != "function") return null;
    var Z = /* @__PURE__ */ new WeakMap(), w = /* @__PURE__ */ new WeakMap();
    return (C = function(Ee) {
      return Ee ? w : Z;
    })(R);
  }
  function u(R, Z) {
    if (R && R.__esModule) return R;
    if (R === null || P(R) != "object" && typeof R != "function") return { default: R };
    var w = C(Z);
    if (w && w.has(R)) return w.get(R);
    var ce = { __proto__: null }, Ee = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var e in R) if (e !== "default" && {}.hasOwnProperty.call(R, e)) {
      var k = Ee ? Object.getOwnPropertyDescriptor(R, e) : null;
      k && (k.get || k.set) ? Object.defineProperty(ce, e, k) : ce[e] = R[e];
    }
    return ce.default = R, w && w.set(R, ce), ce;
  }
  var _ = 0, s = 1, p = 2, f = je.Z_FINISH = 4, r = je.Z_BLOCK = 5, i = je.Z_TREES = 6, l = je.Z_OK = 0, a = je.Z_STREAM_END = 1, n = je.Z_NEED_DICT = 2, c = je.Z_STREAM_ERROR = -2, x = je.Z_DATA_ERROR = -3, v = je.Z_MEM_ERROR = -4, b = je.Z_BUF_ERROR = -5, y = je.Z_DEFLATED = 8, g = 1, S = 2, X = 3, F = 4, T = 5, Q = 6, D = 7, j = 8, te = 9, he = 10, ge = 11, pe = 12, we = 13, Ae = 14, de = 15, ke = 16, Ce = 17, Oe = 18, J = 19, $ = 20, re = 21, z = 22, B = 23, U = 24, ue = 25, le = 26, H = 27, q = 28, ee = 29, ie = 30, be = 31, V = 32, W = 852, ae = 592, O = 15, ne = O;
  function ve(R) {
    return (R >>> 24 & 255) + (R >>> 8 & 65280) + ((R & 65280) << 8) + ((R & 255) << 24);
  }
  function Te() {
    this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new h.Buf16(320), this.work = new h.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
  }
  function Ge(R) {
    var Z;
    return !R || !R.state ? c : (Z = R.state, R.total_in = R.total_out = Z.total = 0, R.msg = "", Z.wrap && (R.adler = Z.wrap & 1), Z.mode = g, Z.last = 0, Z.havedict = 0, Z.dmax = 32768, Z.head = null, Z.hold = 0, Z.bits = 0, Z.lencode = Z.lendyn = new h.Buf32(W), Z.distcode = Z.distdyn = new h.Buf32(ae), Z.sane = 1, Z.back = -1, l);
  }
  function qe(R) {
    var Z;
    return !R || !R.state ? c : (Z = R.state, Z.wsize = 0, Z.whave = 0, Z.wnext = 0, Ge(R));
  }
  function xe(R, Z) {
    var w, ce;
    return !R || !R.state || (ce = R.state, Z < 0 ? (w = 0, Z = -Z) : (w = (Z >> 4) + 1, Z < 48 && (Z &= 15)), Z && (Z < 8 || Z > 15)) ? c : (ce.window !== null && ce.wbits !== Z && (ce.window = null), ce.wrap = w, ce.wbits = Z, qe(R));
  }
  function We(R, Z) {
    var w, ce;
    return R ? (ce = new Te(), R.state = ce, ce.window = null, w = xe(R, Z), w !== l && (R.state = null), w) : c;
  }
  function Ye(R) {
    return We(R, ne);
  }
  var lt = !0, ut, tt;
  function at(R) {
    if (lt) {
      var Z;
      for (ut = new h.Buf32(512), tt = new h.Buf32(32), Z = 0; Z < 144; )
        R.lens[Z++] = 8;
      for (; Z < 256; )
        R.lens[Z++] = 9;
      for (; Z < 280; )
        R.lens[Z++] = 7;
      for (; Z < 288; )
        R.lens[Z++] = 8;
      for ((0, I.default)(s, R.lens, 0, 288, ut, 0, R.work, {
        bits: 9
      }), Z = 0; Z < 32; )
        R.lens[Z++] = 5;
      (0, I.default)(p, R.lens, 0, 32, tt, 0, R.work, {
        bits: 5
      }), lt = !1;
    }
    R.lencode = ut, R.lenbits = 9, R.distcode = tt, R.distbits = 5;
  }
  function E(R, Z, w, ce) {
    var Ee, e = R.state;
    return e.window === null && (e.wsize = 1 << e.wbits, e.wnext = 0, e.whave = 0, e.window = new h.Buf8(e.wsize)), ce >= e.wsize ? (h.arraySet(e.window, Z, w - e.wsize, e.wsize, 0), e.wnext = 0, e.whave = e.wsize) : (Ee = e.wsize - e.wnext, Ee > ce && (Ee = ce), h.arraySet(e.window, Z, w - ce, Ee, e.wnext), ce -= Ee, ce ? (h.arraySet(e.window, Z, w - ce, ce, 0), e.wnext = ce, e.whave = e.wsize) : (e.wnext += Ee, e.wnext === e.wsize && (e.wnext = 0), e.whave < e.wsize && (e.whave += Ee))), 0;
  }
  function se(R, Z) {
    var w, ce, Ee, e, k, m, t, d, o, M, N, G, oe, Le, Pe = 0, Xe, Re, Be, Ke, Ie, Ze, ze, Ne, He = new h.Buf8(4), et, rt, ot = (
      /* permutation of code lengths */
      [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
    );
    if (!R || !R.state || !R.output || !R.input && R.avail_in !== 0)
      return c;
    w = R.state, w.mode === pe && (w.mode = we), k = R.next_out, Ee = R.output, t = R.avail_out, e = R.next_in, ce = R.input, m = R.avail_in, d = w.hold, o = w.bits, M = m, N = t, Ne = l;
    e:
      for (; ; )
        switch (w.mode) {
          case g:
            if (w.wrap === 0) {
              w.mode = we;
              break;
            }
            for (; o < 16; ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            if (w.wrap & 2 && d === 35615) {
              w.check = 0, He[0] = d & 255, He[1] = d >>> 8 & 255, w.check = (0, A.default)(w.check, He, 2, 0), d = 0, o = 0, w.mode = S;
              break;
            }
            if (w.flags = 0, w.head && (w.head.done = !1), !(w.wrap & 1) || /* check if zlib header allowed */
            (((d & 255) << 8) + (d >> 8)) % 31) {
              R.msg = "incorrect header check", w.mode = ie;
              break;
            }
            if ((d & 15) !== y) {
              R.msg = "unknown compression method", w.mode = ie;
              break;
            }
            if (d >>>= 4, o -= 4, ze = (d & 15) + 8, w.wbits === 0)
              w.wbits = ze;
            else if (ze > w.wbits) {
              R.msg = "invalid window size", w.mode = ie;
              break;
            }
            w.dmax = 1 << ze, R.adler = w.check = 1, w.mode = d & 512 ? he : pe, d = 0, o = 0;
            break;
          case S:
            for (; o < 16; ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            if (w.flags = d, (w.flags & 255) !== y) {
              R.msg = "unknown compression method", w.mode = ie;
              break;
            }
            if (w.flags & 57344) {
              R.msg = "unknown header flags set", w.mode = ie;
              break;
            }
            w.head && (w.head.text = d >> 8 & 1), w.flags & 512 && (He[0] = d & 255, He[1] = d >>> 8 & 255, w.check = (0, A.default)(w.check, He, 2, 0)), d = 0, o = 0, w.mode = X;
          /* falls through */
          case X:
            for (; o < 32; ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            w.head && (w.head.time = d), w.flags & 512 && (He[0] = d & 255, He[1] = d >>> 8 & 255, He[2] = d >>> 16 & 255, He[3] = d >>> 24 & 255, w.check = (0, A.default)(w.check, He, 4, 0)), d = 0, o = 0, w.mode = F;
          /* falls through */
          case F:
            for (; o < 16; ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            w.head && (w.head.xflags = d & 255, w.head.os = d >> 8), w.flags & 512 && (He[0] = d & 255, He[1] = d >>> 8 & 255, w.check = (0, A.default)(w.check, He, 2, 0)), d = 0, o = 0, w.mode = T;
          /* falls through */
          case T:
            if (w.flags & 1024) {
              for (; o < 16; ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              w.length = d, w.head && (w.head.extra_len = d), w.flags & 512 && (He[0] = d & 255, He[1] = d >>> 8 & 255, w.check = (0, A.default)(w.check, He, 2, 0)), d = 0, o = 0;
            } else w.head && (w.head.extra = null);
            w.mode = Q;
          /* falls through */
          case Q:
            if (w.flags & 1024 && (G = w.length, G > m && (G = m), G && (w.head && (ze = w.head.extra_len - w.length, w.head.extra || (w.head.extra = new Array(w.head.extra_len)), h.arraySet(
              w.head.extra,
              ce,
              e,
              // extra field is limited to 65536 bytes
              // - no need for additional size check
              G,
              /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
              ze
            )), w.flags & 512 && (w.check = (0, A.default)(w.check, ce, G, e)), m -= G, e += G, w.length -= G), w.length))
              break e;
            w.length = 0, w.mode = D;
          /* falls through */
          case D:
            if (w.flags & 2048) {
              if (m === 0)
                break e;
              G = 0;
              do
                ze = ce[e + G++], w.head && ze && w.length < 65536 && (w.head.name += String.fromCharCode(ze));
              while (ze && G < m);
              if (w.flags & 512 && (w.check = (0, A.default)(w.check, ce, G, e)), m -= G, e += G, ze)
                break e;
            } else w.head && (w.head.name = null);
            w.length = 0, w.mode = j;
          /* falls through */
          case j:
            if (w.flags & 4096) {
              if (m === 0)
                break e;
              G = 0;
              do
                ze = ce[e + G++], w.head && ze && w.length < 65536 && (w.head.comment += String.fromCharCode(ze));
              while (ze && G < m);
              if (w.flags & 512 && (w.check = (0, A.default)(w.check, ce, G, e)), m -= G, e += G, ze)
                break e;
            } else w.head && (w.head.comment = null);
            w.mode = te;
          /* falls through */
          case te:
            if (w.flags & 512) {
              for (; o < 16; ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              if (d !== (w.check & 65535)) {
                R.msg = "header crc mismatch", w.mode = ie;
                break;
              }
              d = 0, o = 0;
            }
            w.head && (w.head.hcrc = w.flags >> 9 & 1, w.head.done = !0), R.adler = w.check = 0, w.mode = pe;
            break;
          case he:
            for (; o < 32; ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            R.adler = w.check = ve(d), d = 0, o = 0, w.mode = ge;
          /* falls through */
          case ge:
            if (w.havedict === 0)
              return R.next_out = k, R.avail_out = t, R.next_in = e, R.avail_in = m, w.hold = d, w.bits = o, n;
            R.adler = w.check = 1, w.mode = pe;
          /* falls through */
          case pe:
            if (Z === r || Z === i)
              break e;
          /* falls through */
          case we:
            if (w.last) {
              d >>>= o & 7, o -= o & 7, w.mode = H;
              break;
            }
            for (; o < 3; ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            switch (w.last = d & 1, d >>>= 1, o -= 1, d & 3) {
              case 0:
                w.mode = Ae;
                break;
              case 1:
                if (at(w), w.mode = $, Z === i) {
                  d >>>= 2, o -= 2;
                  break e;
                }
                break;
              case 2:
                w.mode = Ce;
                break;
              case 3:
                R.msg = "invalid block type", w.mode = ie;
            }
            d >>>= 2, o -= 2;
            break;
          case Ae:
            for (d >>>= o & 7, o -= o & 7; o < 32; ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            if ((d & 65535) !== (d >>> 16 ^ 65535)) {
              R.msg = "invalid stored block lengths", w.mode = ie;
              break;
            }
            if (w.length = d & 65535, d = 0, o = 0, w.mode = de, Z === i)
              break e;
          /* falls through */
          case de:
            w.mode = ke;
          /* falls through */
          case ke:
            if (G = w.length, G) {
              if (G > m && (G = m), G > t && (G = t), G === 0)
                break e;
              h.arraySet(Ee, ce, e, G, k), m -= G, e += G, t -= G, k += G, w.length -= G;
              break;
            }
            w.mode = pe;
            break;
          case Ce:
            for (; o < 14; ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            if (w.nlen = (d & 31) + 257, d >>>= 5, o -= 5, w.ndist = (d & 31) + 1, d >>>= 5, o -= 5, w.ncode = (d & 15) + 4, d >>>= 4, o -= 4, w.nlen > 286 || w.ndist > 30) {
              R.msg = "too many length or distance symbols", w.mode = ie;
              break;
            }
            w.have = 0, w.mode = Oe;
          /* falls through */
          case Oe:
            for (; w.have < w.ncode; ) {
              for (; o < 3; ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              w.lens[ot[w.have++]] = d & 7, d >>>= 3, o -= 3;
            }
            for (; w.have < 19; )
              w.lens[ot[w.have++]] = 0;
            if (w.lencode = w.lendyn, w.lenbits = 7, et = {
              bits: w.lenbits
            }, Ne = (0, I.default)(_, w.lens, 0, 19, w.lencode, 0, w.work, et), w.lenbits = et.bits, Ne) {
              R.msg = "invalid code lengths set", w.mode = ie;
              break;
            }
            w.have = 0, w.mode = J;
          /* falls through */
          case J:
            for (; w.have < w.nlen + w.ndist; ) {
              for (; Pe = w.lencode[d & (1 << w.lenbits) - 1], Xe = Pe >>> 24, Re = Pe >>> 16 & 255, Be = Pe & 65535, !(Xe <= o); ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              if (Be < 16)
                d >>>= Xe, o -= Xe, w.lens[w.have++] = Be;
              else {
                if (Be === 16) {
                  for (rt = Xe + 2; o < rt; ) {
                    if (m === 0)
                      break e;
                    m--, d += ce[e++] << o, o += 8;
                  }
                  if (d >>>= Xe, o -= Xe, w.have === 0) {
                    R.msg = "invalid bit length repeat", w.mode = ie;
                    break;
                  }
                  ze = w.lens[w.have - 1], G = 3 + (d & 3), d >>>= 2, o -= 2;
                } else if (Be === 17) {
                  for (rt = Xe + 3; o < rt; ) {
                    if (m === 0)
                      break e;
                    m--, d += ce[e++] << o, o += 8;
                  }
                  d >>>= Xe, o -= Xe, ze = 0, G = 3 + (d & 7), d >>>= 3, o -= 3;
                } else {
                  for (rt = Xe + 7; o < rt; ) {
                    if (m === 0)
                      break e;
                    m--, d += ce[e++] << o, o += 8;
                  }
                  d >>>= Xe, o -= Xe, ze = 0, G = 11 + (d & 127), d >>>= 7, o -= 7;
                }
                if (w.have + G > w.nlen + w.ndist) {
                  R.msg = "invalid bit length repeat", w.mode = ie;
                  break;
                }
                for (; G--; )
                  w.lens[w.have++] = ze;
              }
            }
            if (w.mode === ie)
              break;
            if (w.lens[256] === 0) {
              R.msg = "invalid code -- missing end-of-block", w.mode = ie;
              break;
            }
            if (w.lenbits = 9, et = {
              bits: w.lenbits
            }, Ne = (0, I.default)(s, w.lens, 0, w.nlen, w.lencode, 0, w.work, et), w.lenbits = et.bits, Ne) {
              R.msg = "invalid literal/lengths set", w.mode = ie;
              break;
            }
            if (w.distbits = 6, w.distcode = w.distdyn, et = {
              bits: w.distbits
            }, Ne = (0, I.default)(p, w.lens, w.nlen, w.ndist, w.distcode, 0, w.work, et), w.distbits = et.bits, Ne) {
              R.msg = "invalid distances set", w.mode = ie;
              break;
            }
            if (w.mode = $, Z === i)
              break e;
          /* falls through */
          case $:
            w.mode = re;
          /* falls through */
          case re:
            if (m >= 6 && t >= 258) {
              R.next_out = k, R.avail_out = t, R.next_in = e, R.avail_in = m, w.hold = d, w.bits = o, (0, K.default)(R, N), k = R.next_out, Ee = R.output, t = R.avail_out, e = R.next_in, ce = R.input, m = R.avail_in, d = w.hold, o = w.bits, w.mode === pe && (w.back = -1);
              break;
            }
            for (w.back = 0; Pe = w.lencode[d & (1 << w.lenbits) - 1], Xe = Pe >>> 24, Re = Pe >>> 16 & 255, Be = Pe & 65535, !(Xe <= o); ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            if (Re && (Re & 240) === 0) {
              for (Ke = Xe, Ie = Re, Ze = Be; Pe = w.lencode[Ze + ((d & (1 << Ke + Ie) - 1) >> Ke)], Xe = Pe >>> 24, Re = Pe >>> 16 & 255, Be = Pe & 65535, !(Ke + Xe <= o); ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              d >>>= Ke, o -= Ke, w.back += Ke;
            }
            if (d >>>= Xe, o -= Xe, w.back += Xe, w.length = Be, Re === 0) {
              w.mode = le;
              break;
            }
            if (Re & 32) {
              w.back = -1, w.mode = pe;
              break;
            }
            if (Re & 64) {
              R.msg = "invalid literal/length code", w.mode = ie;
              break;
            }
            w.extra = Re & 15, w.mode = z;
          /* falls through */
          case z:
            if (w.extra) {
              for (rt = w.extra; o < rt; ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              w.length += d & (1 << w.extra) - 1, d >>>= w.extra, o -= w.extra, w.back += w.extra;
            }
            w.was = w.length, w.mode = B;
          /* falls through */
          case B:
            for (; Pe = w.distcode[d & (1 << w.distbits) - 1], Xe = Pe >>> 24, Re = Pe >>> 16 & 255, Be = Pe & 65535, !(Xe <= o); ) {
              if (m === 0)
                break e;
              m--, d += ce[e++] << o, o += 8;
            }
            if ((Re & 240) === 0) {
              for (Ke = Xe, Ie = Re, Ze = Be; Pe = w.distcode[Ze + ((d & (1 << Ke + Ie) - 1) >> Ke)], Xe = Pe >>> 24, Re = Pe >>> 16 & 255, Be = Pe & 65535, !(Ke + Xe <= o); ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              d >>>= Ke, o -= Ke, w.back += Ke;
            }
            if (d >>>= Xe, o -= Xe, w.back += Xe, Re & 64) {
              R.msg = "invalid distance code", w.mode = ie;
              break;
            }
            w.offset = Be, w.extra = Re & 15, w.mode = U;
          /* falls through */
          case U:
            if (w.extra) {
              for (rt = w.extra; o < rt; ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              w.offset += d & (1 << w.extra) - 1, d >>>= w.extra, o -= w.extra, w.back += w.extra;
            }
            if (w.offset > w.dmax) {
              R.msg = "invalid distance too far back", w.mode = ie;
              break;
            }
            w.mode = ue;
          /* falls through */
          case ue:
            if (t === 0)
              break e;
            if (G = N - t, w.offset > G) {
              if (G = w.offset - G, G > w.whave && w.sane) {
                R.msg = "invalid distance too far back", w.mode = ie;
                break;
              }
              G > w.wnext ? (G -= w.wnext, oe = w.wsize - G) : oe = w.wnext - G, G > w.length && (G = w.length), Le = w.window;
            } else
              Le = Ee, oe = k - w.offset, G = w.length;
            G > t && (G = t), t -= G, w.length -= G;
            do
              Ee[k++] = Le[oe++];
            while (--G);
            w.length === 0 && (w.mode = re);
            break;
          case le:
            if (t === 0)
              break e;
            Ee[k++] = w.length, t--, w.mode = re;
            break;
          case H:
            if (w.wrap) {
              for (; o < 32; ) {
                if (m === 0)
                  break e;
                m--, d |= ce[e++] << o, o += 8;
              }
              if (N -= t, R.total_out += N, w.total += N, N && (R.adler = w.check = /*UPDATE(state.check, put - _out, _out);*/
              w.flags ? (0, A.default)(w.check, Ee, N, k - N) : (0, Y.default)(w.check, Ee, N, k - N)), N = t, (w.flags ? d : ve(d)) !== w.check) {
                R.msg = "incorrect data check", w.mode = ie;
                break;
              }
              d = 0, o = 0;
            }
            w.mode = q;
          /* falls through */
          case q:
            if (w.wrap && w.flags) {
              for (; o < 32; ) {
                if (m === 0)
                  break e;
                m--, d += ce[e++] << o, o += 8;
              }
              if (d !== (w.total & 4294967295)) {
                R.msg = "incorrect length check", w.mode = ie;
                break;
              }
              d = 0, o = 0;
            }
            w.mode = ee;
          /* falls through */
          case ee:
            Ne = a;
            break e;
          case ie:
            Ne = x;
            break e;
          case be:
            return v;
          case V:
          /* falls through */
          default:
            return c;
        }
    return R.next_out = k, R.avail_out = t, R.next_in = e, R.avail_in = m, w.hold = d, w.bits = o, (w.wsize || N !== R.avail_out && w.mode < ie && (w.mode < H || Z !== f)) && E(R, R.output, R.next_out, N - R.avail_out), M -= R.avail_in, N -= R.avail_out, R.total_in += M, R.total_out += N, w.total += N, w.wrap && N && (R.adler = w.check = /*UPDATE(state.check, strm.next_out - _out, _out);*/
    w.flags ? (0, A.default)(w.check, Ee, N, R.next_out - N) : (0, Y.default)(w.check, Ee, N, R.next_out - N)), R.data_type = w.bits + (w.last ? 64 : 0) + (w.mode === pe ? 128 : 0) + (w.mode === $ || w.mode === de ? 256 : 0), (M === 0 && N === 0 || Z === f) && Ne === l && (Ne = b), Ne;
  }
  function fe(R) {
    if (!R || !R.state)
      return c;
    var Z = R.state;
    return Z.window && (Z.window = null), R.state = null, l;
  }
  function ye(R, Z) {
    var w;
    return !R || !R.state || (w = R.state, (w.wrap & 2) === 0) ? c : (w.head = Z, Z.done = !1, l);
  }
  function Fe(R, Z) {
    var w = Z.length, ce, Ee, e;
    return !R || !R.state || (ce = R.state, ce.wrap !== 0 && ce.mode !== ge) ? c : ce.mode === ge && (Ee = 1, Ee = (0, Y.default)(Ee, Z, w, 0), Ee !== ce.check) ? x : (e = E(R, Z, w, w), e ? (ce.mode = be, v) : (ce.havedict = 1, l));
  }
  return je.inflateInfo = "pako inflate (from Nodeca project)", je;
}
var Ht = {}, Rr;
function bn() {
  return Rr || (Rr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = h;
    function h() {
      this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
    }
  }(Ht)), Ht;
}
var Tr;
function dr() {
  return Tr || (Tr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = Dn(), Y = A(bn());
    function A(s) {
      return s && s.__esModule ? s : { default: s };
    }
    function K(s) {
      "@babel/helpers - typeof";
      return K = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(p) {
        return typeof p;
      } : function(p) {
        return p && typeof Symbol == "function" && p.constructor === Symbol && p !== Symbol.prototype ? "symbol" : typeof p;
      }, K(s);
    }
    function I(s, p) {
      if (!(s instanceof p)) throw new TypeError("Cannot call a class as a function");
    }
    function L(s, p) {
      for (var f = 0; f < p.length; f++) {
        var r = p[f];
        r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(s, u(r.key), r);
      }
    }
    function C(s, p, f) {
      return p && L(s.prototype, p), Object.defineProperty(s, "prototype", { writable: !1 }), s;
    }
    function u(s) {
      var p = _(s, "string");
      return K(p) == "symbol" ? p : p + "";
    }
    function _(s, p) {
      if (K(s) != "object" || !s) return s;
      var f = s[Symbol.toPrimitive];
      if (f !== void 0) {
        var r = f.call(s, p);
        if (K(r) != "object") return r;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(s);
    }
    P.default = /* @__PURE__ */ function() {
      function s() {
        I(this, s), this.strm = new Y.default(), this.chunkSize = 1024 * 10 * 10, this.strm.output = new Uint8Array(this.chunkSize), (0, h.inflateInit)(this.strm);
      }
      return C(s, [{
        key: "setInput",
        value: function(f) {
          f ? (this.strm.input = f, this.strm.avail_in = this.strm.input.length, this.strm.next_in = 0) : (this.strm.input = null, this.strm.avail_in = 0, this.strm.next_in = 0);
        }
      }, {
        key: "inflate",
        value: function(f) {
          f > this.chunkSize && (this.chunkSize = f, this.strm.output = new Uint8Array(this.chunkSize)), this.strm.next_out = 0, this.strm.avail_out = f;
          var r = (0, h.inflate)(this.strm, 0);
          if (r < 0)
            throw new Error("zlib inflate failed");
          if (this.strm.next_out != f)
            throw new Error("Incomplete zlib block");
          return new Uint8Array(this.strm.output.buffer, 0, this.strm.next_out);
        }
      }, {
        key: "reset",
        value: function() {
          (0, h.inflateReset)(this.strm);
        }
      }]);
    }();
  }(Qt)), Qt;
}
var zt = {}, Me = {}, ct = {}, Pr;
function On() {
  if (Pr) return ct;
  Pr = 1;
  function P(E) {
    "@babel/helpers - typeof";
    return P = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(se) {
      return typeof se;
    } : function(se) {
      return se && typeof Symbol == "function" && se.constructor === Symbol && se !== Symbol.prototype ? "symbol" : typeof se;
    }, P(E);
  }
  Object.defineProperty(ct, "__esModule", {
    value: !0
  }), ct._tr_align = ut, ct._tr_flush_block = tt, ct._tr_init = Ye, ct._tr_stored_block = lt, ct._tr_tally = at;
  var h = A(At());
  function Y(E) {
    if (typeof WeakMap != "function") return null;
    var se = /* @__PURE__ */ new WeakMap(), fe = /* @__PURE__ */ new WeakMap();
    return (Y = function(Fe) {
      return Fe ? fe : se;
    })(E);
  }
  function A(E, se) {
    if (E && E.__esModule) return E;
    if (E === null || P(E) != "object" && typeof E != "function") return { default: E };
    var fe = Y(se);
    if (fe && fe.has(E)) return fe.get(E);
    var ye = { __proto__: null }, Fe = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var R in E) if (R !== "default" && {}.hasOwnProperty.call(E, R)) {
      var Z = Fe ? Object.getOwnPropertyDescriptor(E, R) : null;
      Z && (Z.get || Z.set) ? Object.defineProperty(ye, R, Z) : ye[R] = E[R];
    }
    return ye.default = E, fe && fe.set(E, ye), ye;
  }
  var K = 4, I = 0, L = 1, C = 2;
  function u(E) {
    for (var se = E.length; --se >= 0; )
      E[se] = 0;
  }
  var _ = 0, s = 1, p = 2, f = 3, r = 258, i = 29, l = 256, a = l + 1 + i, n = 30, c = 19, x = 2 * a + 1, v = 15, b = 16, y = 7, g = 256, S = 16, X = 17, F = 18, T = (
    /* extra bits for each length code */
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
  ), Q = (
    /* extra bits for each distance code */
    [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
  ), D = (
    /* extra bits for each bit length code */
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7]
  ), j = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], te = 512, he = new Array((a + 2) * 2);
  u(he);
  var ge = new Array(n * 2);
  u(ge);
  var pe = new Array(te);
  u(pe);
  var we = new Array(r - f + 1);
  u(we);
  var Ae = new Array(i);
  u(Ae);
  var de = new Array(n);
  u(de);
  function ke(E, se, fe, ye, Fe) {
    this.static_tree = E, this.extra_bits = se, this.extra_base = fe, this.elems = ye, this.max_length = Fe, this.has_stree = E && E.length;
  }
  var Ce, Oe, J;
  function $(E, se) {
    this.dyn_tree = E, this.max_code = 0, this.stat_desc = se;
  }
  function re(E) {
    return E < 256 ? pe[E] : pe[256 + (E >>> 7)];
  }
  function z(E, se) {
    E.pending_buf[E.pending++] = se & 255, E.pending_buf[E.pending++] = se >>> 8 & 255;
  }
  function B(E, se, fe) {
    E.bi_valid > b - fe ? (E.bi_buf |= se << E.bi_valid & 65535, z(E, E.bi_buf), E.bi_buf = se >> b - E.bi_valid, E.bi_valid += fe - b) : (E.bi_buf |= se << E.bi_valid & 65535, E.bi_valid += fe);
  }
  function U(E, se, fe) {
    B(
      E,
      fe[se * 2],
      fe[se * 2 + 1]
      /*.Len*/
    );
  }
  function ue(E, se) {
    var fe = 0;
    do
      fe |= E & 1, E >>>= 1, fe <<= 1;
    while (--se > 0);
    return fe >>> 1;
  }
  function le(E) {
    E.bi_valid === 16 ? (z(E, E.bi_buf), E.bi_buf = 0, E.bi_valid = 0) : E.bi_valid >= 8 && (E.pending_buf[E.pending++] = E.bi_buf & 255, E.bi_buf >>= 8, E.bi_valid -= 8);
  }
  function H(E, se) {
    var fe = se.dyn_tree, ye = se.max_code, Fe = se.stat_desc.static_tree, R = se.stat_desc.has_stree, Z = se.stat_desc.extra_bits, w = se.stat_desc.extra_base, ce = se.stat_desc.max_length, Ee, e, k, m, t, d, o = 0;
    for (m = 0; m <= v; m++)
      E.bl_count[m] = 0;
    for (fe[E.heap[E.heap_max] * 2 + 1] = 0, Ee = E.heap_max + 1; Ee < x; Ee++)
      e = E.heap[Ee], m = fe[fe[e * 2 + 1] * 2 + 1] + 1, m > ce && (m = ce, o++), fe[e * 2 + 1] = m, !(e > ye) && (E.bl_count[m]++, t = 0, e >= w && (t = Z[e - w]), d = fe[e * 2], E.opt_len += d * (m + t), R && (E.static_len += d * (Fe[e * 2 + 1] + t)));
    if (o !== 0) {
      do {
        for (m = ce - 1; E.bl_count[m] === 0; )
          m--;
        E.bl_count[m]--, E.bl_count[m + 1] += 2, E.bl_count[ce]--, o -= 2;
      } while (o > 0);
      for (m = ce; m !== 0; m--)
        for (e = E.bl_count[m]; e !== 0; )
          k = E.heap[--Ee], !(k > ye) && (fe[k * 2 + 1] !== m && (E.opt_len += (m - fe[k * 2 + 1]) * fe[k * 2], fe[k * 2 + 1] = m), e--);
    }
  }
  function q(E, se, fe) {
    var ye = new Array(v + 1), Fe = 0, R, Z;
    for (R = 1; R <= v; R++)
      ye[R] = Fe = Fe + fe[R - 1] << 1;
    for (Z = 0; Z <= se; Z++) {
      var w = E[Z * 2 + 1];
      w !== 0 && (E[Z * 2] = ue(ye[w]++, w));
    }
  }
  function ee() {
    var E, se, fe, ye, Fe, R = new Array(v + 1);
    for (fe = 0, ye = 0; ye < i - 1; ye++)
      for (Ae[ye] = fe, E = 0; E < 1 << T[ye]; E++)
        we[fe++] = ye;
    for (we[fe - 1] = ye, Fe = 0, ye = 0; ye < 16; ye++)
      for (de[ye] = Fe, E = 0; E < 1 << Q[ye]; E++)
        pe[Fe++] = ye;
    for (Fe >>= 7; ye < n; ye++)
      for (de[ye] = Fe << 7, E = 0; E < 1 << Q[ye] - 7; E++)
        pe[256 + Fe++] = ye;
    for (se = 0; se <= v; se++)
      R[se] = 0;
    for (E = 0; E <= 143; )
      he[E * 2 + 1] = 8, E++, R[8]++;
    for (; E <= 255; )
      he[E * 2 + 1] = 9, E++, R[9]++;
    for (; E <= 279; )
      he[E * 2 + 1] = 7, E++, R[7]++;
    for (; E <= 287; )
      he[E * 2 + 1] = 8, E++, R[8]++;
    for (q(he, a + 1, R), E = 0; E < n; E++)
      ge[E * 2 + 1] = 5, ge[E * 2] = ue(E, 5);
    Ce = new ke(he, T, l + 1, a, v), Oe = new ke(ge, Q, 0, n, v), J = new ke(new Array(0), D, 0, c, y);
  }
  function ie(E) {
    var se;
    for (se = 0; se < a; se++)
      E.dyn_ltree[se * 2] = 0;
    for (se = 0; se < n; se++)
      E.dyn_dtree[se * 2] = 0;
    for (se = 0; se < c; se++)
      E.bl_tree[se * 2] = 0;
    E.dyn_ltree[g * 2] = 1, E.opt_len = E.static_len = 0, E.last_lit = E.matches = 0;
  }
  function be(E) {
    E.bi_valid > 8 ? z(E, E.bi_buf) : E.bi_valid > 0 && (E.pending_buf[E.pending++] = E.bi_buf), E.bi_buf = 0, E.bi_valid = 0;
  }
  function V(E, se, fe, ye) {
    be(E), z(E, fe), z(E, ~fe), h.arraySet(E.pending_buf, E.window, se, fe, E.pending), E.pending += fe;
  }
  function W(E, se, fe, ye) {
    var Fe = se * 2, R = fe * 2;
    return E[Fe] < E[R] || E[Fe] === E[R] && ye[se] <= ye[fe];
  }
  function ae(E, se, fe) {
    for (var ye = E.heap[fe], Fe = fe << 1; Fe <= E.heap_len && (Fe < E.heap_len && W(se, E.heap[Fe + 1], E.heap[Fe], E.depth) && Fe++, !W(se, ye, E.heap[Fe], E.depth)); )
      E.heap[fe] = E.heap[Fe], fe = Fe, Fe <<= 1;
    E.heap[fe] = ye;
  }
  function O(E, se, fe) {
    var ye, Fe, R = 0, Z, w;
    if (E.last_lit !== 0)
      do
        ye = E.pending_buf[E.d_buf + R * 2] << 8 | E.pending_buf[E.d_buf + R * 2 + 1], Fe = E.pending_buf[E.l_buf + R], R++, ye === 0 ? U(E, Fe, se) : (Z = we[Fe], U(E, Z + l + 1, se), w = T[Z], w !== 0 && (Fe -= Ae[Z], B(E, Fe, w)), ye--, Z = re(ye), U(E, Z, fe), w = Q[Z], w !== 0 && (ye -= de[Z], B(E, ye, w)));
      while (R < E.last_lit);
    U(E, g, se);
  }
  function ne(E, se) {
    var fe = se.dyn_tree, ye = se.stat_desc.static_tree, Fe = se.stat_desc.has_stree, R = se.stat_desc.elems, Z, w, ce = -1, Ee;
    for (E.heap_len = 0, E.heap_max = x, Z = 0; Z < R; Z++)
      fe[Z * 2] !== 0 ? (E.heap[++E.heap_len] = ce = Z, E.depth[Z] = 0) : fe[Z * 2 + 1] = 0;
    for (; E.heap_len < 2; )
      Ee = E.heap[++E.heap_len] = ce < 2 ? ++ce : 0, fe[Ee * 2] = 1, E.depth[Ee] = 0, E.opt_len--, Fe && (E.static_len -= ye[Ee * 2 + 1]);
    for (se.max_code = ce, Z = E.heap_len >> 1; Z >= 1; Z--)
      ae(E, fe, Z);
    Ee = R;
    do
      Z = E.heap[
        1
        /*SMALLEST*/
      ], E.heap[
        1
        /*SMALLEST*/
      ] = E.heap[E.heap_len--], ae(
        E,
        fe,
        1
        /*SMALLEST*/
      ), w = E.heap[
        1
        /*SMALLEST*/
      ], E.heap[--E.heap_max] = Z, E.heap[--E.heap_max] = w, fe[Ee * 2] = fe[Z * 2] + fe[w * 2], E.depth[Ee] = (E.depth[Z] >= E.depth[w] ? E.depth[Z] : E.depth[w]) + 1, fe[Z * 2 + 1] = fe[w * 2 + 1] = Ee, E.heap[
        1
        /*SMALLEST*/
      ] = Ee++, ae(
        E,
        fe,
        1
        /*SMALLEST*/
      );
    while (E.heap_len >= 2);
    E.heap[--E.heap_max] = E.heap[
      1
      /*SMALLEST*/
    ], H(E, se), q(fe, ce, E.bl_count);
  }
  function ve(E, se, fe) {
    var ye, Fe = -1, R, Z = se[0 * 2 + 1], w = 0, ce = 7, Ee = 4;
    for (Z === 0 && (ce = 138, Ee = 3), se[(fe + 1) * 2 + 1] = 65535, ye = 0; ye <= fe; ye++)
      R = Z, Z = se[(ye + 1) * 2 + 1], !(++w < ce && R === Z) && (w < Ee ? E.bl_tree[R * 2] += w : R !== 0 ? (R !== Fe && E.bl_tree[R * 2]++, E.bl_tree[S * 2]++) : w <= 10 ? E.bl_tree[X * 2]++ : E.bl_tree[F * 2]++, w = 0, Fe = R, Z === 0 ? (ce = 138, Ee = 3) : R === Z ? (ce = 6, Ee = 3) : (ce = 7, Ee = 4));
  }
  function Te(E, se, fe) {
    var ye, Fe = -1, R, Z = se[0 * 2 + 1], w = 0, ce = 7, Ee = 4;
    for (Z === 0 && (ce = 138, Ee = 3), ye = 0; ye <= fe; ye++)
      if (R = Z, Z = se[(ye + 1) * 2 + 1], !(++w < ce && R === Z)) {
        if (w < Ee)
          do
            U(E, R, E.bl_tree);
          while (--w !== 0);
        else R !== 0 ? (R !== Fe && (U(E, R, E.bl_tree), w--), U(E, S, E.bl_tree), B(E, w - 3, 2)) : w <= 10 ? (U(E, X, E.bl_tree), B(E, w - 3, 3)) : (U(E, F, E.bl_tree), B(E, w - 11, 7));
        w = 0, Fe = R, Z === 0 ? (ce = 138, Ee = 3) : R === Z ? (ce = 6, Ee = 3) : (ce = 7, Ee = 4);
      }
  }
  function Ge(E) {
    var se;
    for (ve(E, E.dyn_ltree, E.l_desc.max_code), ve(E, E.dyn_dtree, E.d_desc.max_code), ne(E, E.bl_desc), se = c - 1; se >= 3 && E.bl_tree[j[se] * 2 + 1] === 0; se--)
      ;
    return E.opt_len += 3 * (se + 1) + 5 + 5 + 4, se;
  }
  function qe(E, se, fe, ye) {
    var Fe;
    for (B(E, se - 257, 5), B(E, fe - 1, 5), B(E, ye - 4, 4), Fe = 0; Fe < ye; Fe++)
      B(E, E.bl_tree[j[Fe] * 2 + 1], 3);
    Te(E, E.dyn_ltree, se - 1), Te(E, E.dyn_dtree, fe - 1);
  }
  function xe(E) {
    var se = 4093624447, fe;
    for (fe = 0; fe <= 31; fe++, se >>>= 1)
      if (se & 1 && E.dyn_ltree[fe * 2] !== 0)
        return I;
    if (E.dyn_ltree[9 * 2] !== 0 || E.dyn_ltree[10 * 2] !== 0 || E.dyn_ltree[13 * 2] !== 0)
      return L;
    for (fe = 32; fe < l; fe++)
      if (E.dyn_ltree[fe * 2] !== 0)
        return L;
    return I;
  }
  var We = !1;
  function Ye(E) {
    We || (ee(), We = !0), E.l_desc = new $(E.dyn_ltree, Ce), E.d_desc = new $(E.dyn_dtree, Oe), E.bl_desc = new $(E.bl_tree, J), E.bi_buf = 0, E.bi_valid = 0, ie(E);
  }
  function lt(E, se, fe, ye) {
    B(E, (_ << 1) + (ye ? 1 : 0), 3), V(E, se, fe);
  }
  function ut(E) {
    B(E, s << 1, 3), U(E, g, he), le(E);
  }
  function tt(E, se, fe, ye) {
    var Fe, R, Z = 0;
    E.level > 0 ? (E.strm.data_type === C && (E.strm.data_type = xe(E)), ne(E, E.l_desc), ne(E, E.d_desc), Z = Ge(E), Fe = E.opt_len + 3 + 7 >>> 3, R = E.static_len + 3 + 7 >>> 3, R <= Fe && (Fe = R)) : Fe = R = fe + 5, fe + 4 <= Fe && se !== -1 ? lt(E, se, fe, ye) : E.strategy === K || R === Fe ? (B(E, (s << 1) + (ye ? 1 : 0), 3), O(E, he, ge)) : (B(E, (p << 1) + (ye ? 1 : 0), 3), qe(E, E.l_desc.max_code + 1, E.d_desc.max_code + 1, Z + 1), O(E, E.dyn_ltree, E.dyn_dtree)), ie(E), ye && be(E);
  }
  function at(E, se, fe) {
    return E.pending_buf[E.d_buf + E.last_lit * 2] = se >>> 8 & 255, E.pending_buf[E.d_buf + E.last_lit * 2 + 1] = se & 255, E.pending_buf[E.l_buf + E.last_lit] = fe & 255, E.last_lit++, se === 0 ? E.dyn_ltree[fe * 2]++ : (E.matches++, se--, E.dyn_ltree[(we[fe] + l + 1) * 2]++, E.dyn_dtree[re(se) * 2]++), E.last_lit === E.lit_bufsize - 1;
  }
  return ct;
}
var Gt = {}, Lr;
function Bn() {
  return Lr || (Lr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0, P.default = {
      2: "need dictionary",
      /* Z_NEED_DICT       2  */
      1: "stream end",
      /* Z_STREAM_END      1  */
      0: "",
      /* Z_OK              0  */
      "-1": "file error",
      /* Z_ERRNO         (-1) */
      "-2": "stream error",
      /* Z_STREAM_ERROR  (-2) */
      "-3": "data error",
      /* Z_DATA_ERROR    (-3) */
      "-4": "insufficient memory",
      /* Z_MEM_ERROR     (-4) */
      "-5": "buffer error",
      /* Z_BUF_ERROR     (-5) */
      "-6": "incompatible version"
      /* Z_VERSION_ERROR (-6) */
    };
  }(Gt)), Gt;
}
var Mr;
function Qn() {
  if (Mr) return Me;
  Mr = 1;
  function P(e) {
    "@babel/helpers - typeof";
    return P = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(k) {
      return typeof k;
    } : function(k) {
      return k && typeof Symbol == "function" && k.constructor === Symbol && k !== Symbol.prototype ? "symbol" : typeof k;
    }, P(e);
  }
  Object.defineProperty(Me, "__esModule", {
    value: !0
  }), Me.Z_UNKNOWN = Me.Z_STREAM_ERROR = Me.Z_STREAM_END = Me.Z_RLE = Me.Z_PARTIAL_FLUSH = Me.Z_OK = Me.Z_NO_FLUSH = Me.Z_HUFFMAN_ONLY = Me.Z_FULL_FLUSH = Me.Z_FIXED = Me.Z_FINISH = Me.Z_FILTERED = Me.Z_DEFLATED = Me.Z_DEFAULT_STRATEGY = Me.Z_DEFAULT_COMPRESSION = Me.Z_DATA_ERROR = Me.Z_BUF_ERROR = Me.Z_BLOCK = void 0, Me.deflate = w, Me.deflateEnd = ce, Me.deflateInfo = void 0, Me.deflateInit = Z, Me.deflateInit2 = R, Me.deflateReset = ye, Me.deflateResetKeep = fe, Me.deflateSetDictionary = Ee, Me.deflateSetHeader = Fe;
  var h = u(At()), Y = u(On()), A = L(xn()), K = L(gn()), I = L(Bn());
  function L(e) {
    return e && e.__esModule ? e : { default: e };
  }
  function C(e) {
    if (typeof WeakMap != "function") return null;
    var k = /* @__PURE__ */ new WeakMap(), m = /* @__PURE__ */ new WeakMap();
    return (C = function(d) {
      return d ? m : k;
    })(e);
  }
  function u(e, k) {
    if (e && e.__esModule) return e;
    if (e === null || P(e) != "object" && typeof e != "function") return { default: e };
    var m = C(k);
    if (m && m.has(e)) return m.get(e);
    var t = { __proto__: null }, d = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var o in e) if (o !== "default" && {}.hasOwnProperty.call(e, o)) {
      var M = d ? Object.getOwnPropertyDescriptor(e, o) : null;
      M && (M.get || M.set) ? Object.defineProperty(t, o, M) : t[o] = e[o];
    }
    return t.default = e, m && m.set(e, t), t;
  }
  var _ = Me.Z_NO_FLUSH = 0, s = Me.Z_PARTIAL_FLUSH = 1, p = Me.Z_FULL_FLUSH = 3, f = Me.Z_FINISH = 4, r = Me.Z_BLOCK = 5, i = Me.Z_OK = 0, l = Me.Z_STREAM_END = 1, a = Me.Z_STREAM_ERROR = -2, n = Me.Z_DATA_ERROR = -3, c = Me.Z_BUF_ERROR = -5, x = Me.Z_DEFAULT_COMPRESSION = -1, v = Me.Z_FILTERED = 1, b = Me.Z_HUFFMAN_ONLY = 2, y = Me.Z_RLE = 3, g = Me.Z_FIXED = 4, S = Me.Z_DEFAULT_STRATEGY = 0, X = Me.Z_UNKNOWN = 2, F = Me.Z_DEFLATED = 8, T = 9, Q = 15, D = 8, j = 29, te = 256, he = te + 1 + j, ge = 30, pe = 19, we = 2 * he + 1, Ae = 15, de = 3, ke = 258, Ce = ke + de + 1, Oe = 32, J = 42, $ = 69, re = 73, z = 91, B = 103, U = 113, ue = 666, le = 1, H = 2, q = 3, ee = 4, ie = 3;
  function be(e, k) {
    return e.msg = I.default[k], k;
  }
  function V(e) {
    return (e << 1) - (e > 4 ? 9 : 0);
  }
  function W(e) {
    for (var k = e.length; --k >= 0; )
      e[k] = 0;
  }
  function ae(e) {
    var k = e.state, m = k.pending;
    m > e.avail_out && (m = e.avail_out), m !== 0 && (h.arraySet(e.output, k.pending_buf, k.pending_out, m, e.next_out), e.next_out += m, k.pending_out += m, e.total_out += m, e.avail_out -= m, k.pending -= m, k.pending === 0 && (k.pending_out = 0));
  }
  function O(e, k) {
    Y._tr_flush_block(e, e.block_start >= 0 ? e.block_start : -1, e.strstart - e.block_start, k), e.block_start = e.strstart, ae(e.strm);
  }
  function ne(e, k) {
    e.pending_buf[e.pending++] = k;
  }
  function ve(e, k) {
    e.pending_buf[e.pending++] = k >>> 8 & 255, e.pending_buf[e.pending++] = k & 255;
  }
  function Te(e, k, m, t) {
    var d = e.avail_in;
    return d > t && (d = t), d === 0 ? 0 : (e.avail_in -= d, h.arraySet(k, e.input, e.next_in, d, m), e.state.wrap === 1 ? e.adler = (0, A.default)(e.adler, k, d, m) : e.state.wrap === 2 && (e.adler = (0, K.default)(e.adler, k, d, m)), e.next_in += d, e.total_in += d, d);
  }
  function Ge(e, k) {
    var m = e.max_chain_length, t = e.strstart, d, o, M = e.prev_length, N = e.nice_match, G = e.strstart > e.w_size - Ce ? e.strstart - (e.w_size - Ce) : 0, oe = e.window, Le = e.w_mask, Pe = e.prev, Xe = e.strstart + ke, Re = oe[t + M - 1], Be = oe[t + M];
    e.prev_length >= e.good_match && (m >>= 2), N > e.lookahead && (N = e.lookahead);
    do
      if (d = k, !(oe[d + M] !== Be || oe[d + M - 1] !== Re || oe[d] !== oe[t] || oe[++d] !== oe[t + 1])) {
        t += 2, d++;
        do
          ;
        while (oe[++t] === oe[++d] && oe[++t] === oe[++d] && oe[++t] === oe[++d] && oe[++t] === oe[++d] && oe[++t] === oe[++d] && oe[++t] === oe[++d] && oe[++t] === oe[++d] && oe[++t] === oe[++d] && t < Xe);
        if (o = ke - (Xe - t), t = Xe - ke, o > M) {
          if (e.match_start = k, M = o, o >= N)
            break;
          Re = oe[t + M - 1], Be = oe[t + M];
        }
      }
    while ((k = Pe[k & Le]) > G && --m !== 0);
    return M <= e.lookahead ? M : e.lookahead;
  }
  function qe(e) {
    var k = e.w_size, m, t, d, o, M;
    do {
      if (o = e.window_size - e.lookahead - e.strstart, e.strstart >= k + (k - Ce)) {
        h.arraySet(e.window, e.window, k, k, 0), e.match_start -= k, e.strstart -= k, e.block_start -= k, t = e.hash_size, m = t;
        do
          d = e.head[--m], e.head[m] = d >= k ? d - k : 0;
        while (--t);
        t = k, m = t;
        do
          d = e.prev[--m], e.prev[m] = d >= k ? d - k : 0;
        while (--t);
        o += k;
      }
      if (e.strm.avail_in === 0)
        break;
      if (t = Te(e.strm, e.window, e.strstart + e.lookahead, o), e.lookahead += t, e.lookahead + e.insert >= de)
        for (M = e.strstart - e.insert, e.ins_h = e.window[M], e.ins_h = (e.ins_h << e.hash_shift ^ e.window[M + 1]) & e.hash_mask; e.insert && (e.ins_h = (e.ins_h << e.hash_shift ^ e.window[M + de - 1]) & e.hash_mask, e.prev[M & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = M, M++, e.insert--, !(e.lookahead + e.insert < de)); )
          ;
    } while (e.lookahead < Ce && e.strm.avail_in !== 0);
  }
  function xe(e, k) {
    var m = 65535;
    for (m > e.pending_buf_size - 5 && (m = e.pending_buf_size - 5); ; ) {
      if (e.lookahead <= 1) {
        if (qe(e), e.lookahead === 0 && k === _)
          return le;
        if (e.lookahead === 0)
          break;
      }
      e.strstart += e.lookahead, e.lookahead = 0;
      var t = e.block_start + m;
      if ((e.strstart === 0 || e.strstart >= t) && (e.lookahead = e.strstart - t, e.strstart = t, O(e, !1), e.strm.avail_out === 0) || e.strstart - e.block_start >= e.w_size - Ce && (O(e, !1), e.strm.avail_out === 0))
        return le;
    }
    return e.insert = 0, k === f ? (O(e, !0), e.strm.avail_out === 0 ? q : ee) : (e.strstart > e.block_start && (O(e, !1), e.strm.avail_out === 0), le);
  }
  function We(e, k) {
    for (var m, t; ; ) {
      if (e.lookahead < Ce) {
        if (qe(e), e.lookahead < Ce && k === _)
          return le;
        if (e.lookahead === 0)
          break;
      }
      if (m = 0, e.lookahead >= de && (e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + de - 1]) & e.hash_mask, m = e.prev[e.strstart & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = e.strstart), m !== 0 && e.strstart - m <= e.w_size - Ce && (e.match_length = Ge(e, m)), e.match_length >= de)
        if (t = Y._tr_tally(e, e.strstart - e.match_start, e.match_length - de), e.lookahead -= e.match_length, e.match_length <= e.max_lazy_match && e.lookahead >= de) {
          e.match_length--;
          do
            e.strstart++, e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + de - 1]) & e.hash_mask, m = e.prev[e.strstart & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = e.strstart;
          while (--e.match_length !== 0);
          e.strstart++;
        } else
          e.strstart += e.match_length, e.match_length = 0, e.ins_h = e.window[e.strstart], e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + 1]) & e.hash_mask;
      else
        t = Y._tr_tally(e, 0, e.window[e.strstart]), e.lookahead--, e.strstart++;
      if (t && (O(e, !1), e.strm.avail_out === 0))
        return le;
    }
    return e.insert = e.strstart < de - 1 ? e.strstart : de - 1, k === f ? (O(e, !0), e.strm.avail_out === 0 ? q : ee) : e.last_lit && (O(e, !1), e.strm.avail_out === 0) ? le : H;
  }
  function Ye(e, k) {
    for (var m, t, d; ; ) {
      if (e.lookahead < Ce) {
        if (qe(e), e.lookahead < Ce && k === _)
          return le;
        if (e.lookahead === 0)
          break;
      }
      if (m = 0, e.lookahead >= de && (e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + de - 1]) & e.hash_mask, m = e.prev[e.strstart & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = e.strstart), e.prev_length = e.match_length, e.prev_match = e.match_start, e.match_length = de - 1, m !== 0 && e.prev_length < e.max_lazy_match && e.strstart - m <= e.w_size - Ce && (e.match_length = Ge(e, m), e.match_length <= 5 && (e.strategy === v || e.match_length === de && e.strstart - e.match_start > 4096) && (e.match_length = de - 1)), e.prev_length >= de && e.match_length <= e.prev_length) {
        d = e.strstart + e.lookahead - de, t = Y._tr_tally(e, e.strstart - 1 - e.prev_match, e.prev_length - de), e.lookahead -= e.prev_length - 1, e.prev_length -= 2;
        do
          ++e.strstart <= d && (e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + de - 1]) & e.hash_mask, m = e.prev[e.strstart & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = e.strstart);
        while (--e.prev_length !== 0);
        if (e.match_available = 0, e.match_length = de - 1, e.strstart++, t && (O(e, !1), e.strm.avail_out === 0))
          return le;
      } else if (e.match_available) {
        if (t = Y._tr_tally(e, 0, e.window[e.strstart - 1]), t && O(e, !1), e.strstart++, e.lookahead--, e.strm.avail_out === 0)
          return le;
      } else
        e.match_available = 1, e.strstart++, e.lookahead--;
    }
    return e.match_available && (t = Y._tr_tally(e, 0, e.window[e.strstart - 1]), e.match_available = 0), e.insert = e.strstart < de - 1 ? e.strstart : de - 1, k === f ? (O(e, !0), e.strm.avail_out === 0 ? q : ee) : e.last_lit && (O(e, !1), e.strm.avail_out === 0) ? le : H;
  }
  function lt(e, k) {
    for (var m, t, d, o, M = e.window; ; ) {
      if (e.lookahead <= ke) {
        if (qe(e), e.lookahead <= ke && k === _)
          return le;
        if (e.lookahead === 0)
          break;
      }
      if (e.match_length = 0, e.lookahead >= de && e.strstart > 0 && (d = e.strstart - 1, t = M[d], t === M[++d] && t === M[++d] && t === M[++d])) {
        o = e.strstart + ke;
        do
          ;
        while (t === M[++d] && t === M[++d] && t === M[++d] && t === M[++d] && t === M[++d] && t === M[++d] && t === M[++d] && t === M[++d] && d < o);
        e.match_length = ke - (o - d), e.match_length > e.lookahead && (e.match_length = e.lookahead);
      }
      if (e.match_length >= de ? (m = Y._tr_tally(e, 1, e.match_length - de), e.lookahead -= e.match_length, e.strstart += e.match_length, e.match_length = 0) : (m = Y._tr_tally(e, 0, e.window[e.strstart]), e.lookahead--, e.strstart++), m && (O(e, !1), e.strm.avail_out === 0))
        return le;
    }
    return e.insert = 0, k === f ? (O(e, !0), e.strm.avail_out === 0 ? q : ee) : e.last_lit && (O(e, !1), e.strm.avail_out === 0) ? le : H;
  }
  function ut(e, k) {
    for (var m; ; ) {
      if (e.lookahead === 0 && (qe(e), e.lookahead === 0)) {
        if (k === _)
          return le;
        break;
      }
      if (e.match_length = 0, m = Y._tr_tally(e, 0, e.window[e.strstart]), e.lookahead--, e.strstart++, m && (O(e, !1), e.strm.avail_out === 0))
        return le;
    }
    return e.insert = 0, k === f ? (O(e, !0), e.strm.avail_out === 0 ? q : ee) : e.last_lit && (O(e, !1), e.strm.avail_out === 0) ? le : H;
  }
  function tt(e, k, m, t, d) {
    this.good_length = e, this.max_lazy = k, this.nice_length = m, this.max_chain = t, this.func = d;
  }
  var at;
  at = [
    /*      good lazy nice chain */
    new tt(0, 0, 0, 0, xe),
    /* 0 store only */
    new tt(4, 4, 8, 4, We),
    /* 1 max speed, no lazy matches */
    new tt(4, 5, 16, 8, We),
    /* 2 */
    new tt(4, 6, 32, 32, We),
    /* 3 */
    new tt(4, 4, 16, 16, Ye),
    /* 4 lazy matches */
    new tt(8, 16, 32, 32, Ye),
    /* 5 */
    new tt(8, 16, 128, 128, Ye),
    /* 6 */
    new tt(8, 32, 128, 256, Ye),
    /* 7 */
    new tt(32, 128, 258, 1024, Ye),
    /* 8 */
    new tt(32, 258, 258, 4096, Ye)
    /* 9 max compression */
  ];
  function E(e) {
    e.window_size = 2 * e.w_size, W(e.head), e.max_lazy_match = at[e.level].max_lazy, e.good_match = at[e.level].good_length, e.nice_match = at[e.level].nice_length, e.max_chain_length = at[e.level].max_chain, e.strstart = 0, e.block_start = 0, e.lookahead = 0, e.insert = 0, e.match_length = e.prev_length = de - 1, e.match_available = 0, e.ins_h = 0;
  }
  function se() {
    this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = F, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new h.Buf16(we * 2), this.dyn_dtree = new h.Buf16((2 * ge + 1) * 2), this.bl_tree = new h.Buf16((2 * pe + 1) * 2), W(this.dyn_ltree), W(this.dyn_dtree), W(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new h.Buf16(Ae + 1), this.heap = new h.Buf16(2 * he + 1), W(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new h.Buf16(2 * he + 1), W(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
  }
  function fe(e) {
    var k;
    return !e || !e.state ? be(e, a) : (e.total_in = e.total_out = 0, e.data_type = X, k = e.state, k.pending = 0, k.pending_out = 0, k.wrap < 0 && (k.wrap = -k.wrap), k.status = k.wrap ? J : U, e.adler = k.wrap === 2 ? 0 : 1, k.last_flush = _, Y._tr_init(k), i);
  }
  function ye(e) {
    var k = fe(e);
    return k === i && E(e.state), k;
  }
  function Fe(e, k) {
    return !e || !e.state || e.state.wrap !== 2 ? a : (e.state.gzhead = k, i);
  }
  function R(e, k, m, t, d, o) {
    if (!e)
      return a;
    var M = 1;
    if (k === x && (k = 6), t < 0 ? (M = 0, t = -t) : t > 15 && (M = 2, t -= 16), d < 1 || d > T || m !== F || t < 8 || t > 15 || k < 0 || k > 9 || o < 0 || o > g)
      return be(e, a);
    t === 8 && (t = 9);
    var N = new se();
    return e.state = N, N.strm = e, N.wrap = M, N.gzhead = null, N.w_bits = t, N.w_size = 1 << N.w_bits, N.w_mask = N.w_size - 1, N.hash_bits = d + 7, N.hash_size = 1 << N.hash_bits, N.hash_mask = N.hash_size - 1, N.hash_shift = ~~((N.hash_bits + de - 1) / de), N.window = new h.Buf8(N.w_size * 2), N.head = new h.Buf16(N.hash_size), N.prev = new h.Buf16(N.w_size), N.lit_bufsize = 1 << d + 6, N.pending_buf_size = N.lit_bufsize * 4, N.pending_buf = new h.Buf8(N.pending_buf_size), N.d_buf = 1 * N.lit_bufsize, N.l_buf = 3 * N.lit_bufsize, N.level = k, N.strategy = o, N.method = m, ye(e);
  }
  function Z(e, k) {
    return R(e, k, F, Q, D, S);
  }
  function w(e, k) {
    var m, t, d, o;
    if (!e || !e.state || k > r || k < 0)
      return e ? be(e, a) : a;
    if (t = e.state, !e.output || !e.input && e.avail_in !== 0 || t.status === ue && k !== f)
      return be(e, e.avail_out === 0 ? c : a);
    if (t.strm = e, m = t.last_flush, t.last_flush = k, t.status === J)
      if (t.wrap === 2)
        e.adler = 0, ne(t, 31), ne(t, 139), ne(t, 8), t.gzhead ? (ne(t, (t.gzhead.text ? 1 : 0) + (t.gzhead.hcrc ? 2 : 0) + (t.gzhead.extra ? 4 : 0) + (t.gzhead.name ? 8 : 0) + (t.gzhead.comment ? 16 : 0)), ne(t, t.gzhead.time & 255), ne(t, t.gzhead.time >> 8 & 255), ne(t, t.gzhead.time >> 16 & 255), ne(t, t.gzhead.time >> 24 & 255), ne(t, t.level === 9 ? 2 : t.strategy >= b || t.level < 2 ? 4 : 0), ne(t, t.gzhead.os & 255), t.gzhead.extra && t.gzhead.extra.length && (ne(t, t.gzhead.extra.length & 255), ne(t, t.gzhead.extra.length >> 8 & 255)), t.gzhead.hcrc && (e.adler = (0, K.default)(e.adler, t.pending_buf, t.pending, 0)), t.gzindex = 0, t.status = $) : (ne(t, 0), ne(t, 0), ne(t, 0), ne(t, 0), ne(t, 0), ne(t, t.level === 9 ? 2 : t.strategy >= b || t.level < 2 ? 4 : 0), ne(t, ie), t.status = U);
      else {
        var M = F + (t.w_bits - 8 << 4) << 8, N = -1;
        t.strategy >= b || t.level < 2 ? N = 0 : t.level < 6 ? N = 1 : t.level === 6 ? N = 2 : N = 3, M |= N << 6, t.strstart !== 0 && (M |= Oe), M += 31 - M % 31, t.status = U, ve(t, M), t.strstart !== 0 && (ve(t, e.adler >>> 16), ve(t, e.adler & 65535)), e.adler = 1;
      }
    if (t.status === $)
      if (t.gzhead.extra) {
        for (d = t.pending; t.gzindex < (t.gzhead.extra.length & 65535) && !(t.pending === t.pending_buf_size && (t.gzhead.hcrc && t.pending > d && (e.adler = (0, K.default)(e.adler, t.pending_buf, t.pending - d, d)), ae(e), d = t.pending, t.pending === t.pending_buf_size)); )
          ne(t, t.gzhead.extra[t.gzindex] & 255), t.gzindex++;
        t.gzhead.hcrc && t.pending > d && (e.adler = (0, K.default)(e.adler, t.pending_buf, t.pending - d, d)), t.gzindex === t.gzhead.extra.length && (t.gzindex = 0, t.status = re);
      } else
        t.status = re;
    if (t.status === re)
      if (t.gzhead.name) {
        d = t.pending;
        do {
          if (t.pending === t.pending_buf_size && (t.gzhead.hcrc && t.pending > d && (e.adler = (0, K.default)(e.adler, t.pending_buf, t.pending - d, d)), ae(e), d = t.pending, t.pending === t.pending_buf_size)) {
            o = 1;
            break;
          }
          t.gzindex < t.gzhead.name.length ? o = t.gzhead.name.charCodeAt(t.gzindex++) & 255 : o = 0, ne(t, o);
        } while (o !== 0);
        t.gzhead.hcrc && t.pending > d && (e.adler = (0, K.default)(e.adler, t.pending_buf, t.pending - d, d)), o === 0 && (t.gzindex = 0, t.status = z);
      } else
        t.status = z;
    if (t.status === z)
      if (t.gzhead.comment) {
        d = t.pending;
        do {
          if (t.pending === t.pending_buf_size && (t.gzhead.hcrc && t.pending > d && (e.adler = (0, K.default)(e.adler, t.pending_buf, t.pending - d, d)), ae(e), d = t.pending, t.pending === t.pending_buf_size)) {
            o = 1;
            break;
          }
          t.gzindex < t.gzhead.comment.length ? o = t.gzhead.comment.charCodeAt(t.gzindex++) & 255 : o = 0, ne(t, o);
        } while (o !== 0);
        t.gzhead.hcrc && t.pending > d && (e.adler = (0, K.default)(e.adler, t.pending_buf, t.pending - d, d)), o === 0 && (t.status = B);
      } else
        t.status = B;
    if (t.status === B && (t.gzhead.hcrc ? (t.pending + 2 > t.pending_buf_size && ae(e), t.pending + 2 <= t.pending_buf_size && (ne(t, e.adler & 255), ne(t, e.adler >> 8 & 255), e.adler = 0, t.status = U)) : t.status = U), t.pending !== 0) {
      if (ae(e), e.avail_out === 0)
        return t.last_flush = -1, i;
    } else if (e.avail_in === 0 && V(k) <= V(m) && k !== f)
      return be(e, c);
    if (t.status === ue && e.avail_in !== 0)
      return be(e, c);
    if (e.avail_in !== 0 || t.lookahead !== 0 || k !== _ && t.status !== ue) {
      var G = t.strategy === b ? ut(t, k) : t.strategy === y ? lt(t, k) : at[t.level].func(t, k);
      if ((G === q || G === ee) && (t.status = ue), G === le || G === q)
        return e.avail_out === 0 && (t.last_flush = -1), i;
      if (G === H && (k === s ? Y._tr_align(t) : k !== r && (Y._tr_stored_block(t, 0, 0, !1), k === p && (W(t.head), t.lookahead === 0 && (t.strstart = 0, t.block_start = 0, t.insert = 0))), ae(e), e.avail_out === 0))
        return t.last_flush = -1, i;
    }
    return k !== f ? i : t.wrap <= 0 ? l : (t.wrap === 2 ? (ne(t, e.adler & 255), ne(t, e.adler >> 8 & 255), ne(t, e.adler >> 16 & 255), ne(t, e.adler >> 24 & 255), ne(t, e.total_in & 255), ne(t, e.total_in >> 8 & 255), ne(t, e.total_in >> 16 & 255), ne(t, e.total_in >> 24 & 255)) : (ve(t, e.adler >>> 16), ve(t, e.adler & 65535)), ae(e), t.wrap > 0 && (t.wrap = -t.wrap), t.pending !== 0 ? i : l);
  }
  function ce(e) {
    var k;
    return !e || !e.state ? a : (k = e.state.status, k !== J && k !== $ && k !== re && k !== z && k !== B && k !== U && k !== ue ? be(e, a) : (e.state = null, k === U ? be(e, n) : i));
  }
  function Ee(e, k) {
    var m = k.length, t, d, o, M, N, G, oe, Le;
    if (!e || !e.state || (t = e.state, M = t.wrap, M === 2 || M === 1 && t.status !== J || t.lookahead))
      return a;
    for (M === 1 && (e.adler = (0, A.default)(e.adler, k, m, 0)), t.wrap = 0, m >= t.w_size && (M === 0 && (W(t.head), t.strstart = 0, t.block_start = 0, t.insert = 0), Le = new h.Buf8(t.w_size), h.arraySet(Le, k, m - t.w_size, t.w_size, 0), k = Le, m = t.w_size), N = e.avail_in, G = e.next_in, oe = e.input, e.avail_in = m, e.next_in = 0, e.input = k, qe(t); t.lookahead >= de; ) {
      d = t.strstart, o = t.lookahead - (de - 1);
      do
        t.ins_h = (t.ins_h << t.hash_shift ^ t.window[d + de - 1]) & t.hash_mask, t.prev[d & t.w_mask] = t.head[t.ins_h], t.head[t.ins_h] = d, d++;
      while (--o);
      t.strstart = d, t.lookahead = de - 1, qe(t);
    }
    return t.strstart += t.lookahead, t.block_start = t.strstart, t.insert = t.lookahead, t.lookahead = 0, t.match_length = t.prev_length = de - 1, t.match_available = 0, e.next_in = G, e.input = oe, e.avail_in = N, t.wrap = M, i;
  }
  return Me.deflateInfo = "pako deflate (from Nodeca project)", Me;
}
var Dr;
function In() {
  return Dr || (Dr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = Qn(), Y = A(bn());
    function A(s) {
      return s && s.__esModule ? s : { default: s };
    }
    function K(s) {
      "@babel/helpers - typeof";
      return K = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(p) {
        return typeof p;
      } : function(p) {
        return p && typeof Symbol == "function" && p.constructor === Symbol && p !== Symbol.prototype ? "symbol" : typeof p;
      }, K(s);
    }
    function I(s, p) {
      if (!(s instanceof p)) throw new TypeError("Cannot call a class as a function");
    }
    function L(s, p) {
      for (var f = 0; f < p.length; f++) {
        var r = p[f];
        r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(s, u(r.key), r);
      }
    }
    function C(s, p, f) {
      return p && L(s.prototype, p), Object.defineProperty(s, "prototype", { writable: !1 }), s;
    }
    function u(s) {
      var p = _(s, "string");
      return K(p) == "symbol" ? p : p + "";
    }
    function _(s, p) {
      if (K(s) != "object" || !s) return s;
      var f = s[Symbol.toPrimitive];
      if (f !== void 0) {
        var r = f.call(s, p);
        if (K(r) != "object") return r;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(s);
    }
    P.default = /* @__PURE__ */ function() {
      function s() {
        I(this, s), this.strm = new Y.default(), this.chunkSize = 1024 * 10 * 10, this.outputBuffer = new Uint8Array(this.chunkSize), (0, h.deflateInit)(this.strm, h.Z_DEFAULT_COMPRESSION);
      }
      return C(s, [{
        key: "deflate",
        value: function(f) {
          this.strm.input = f, this.strm.avail_in = this.strm.input.length, this.strm.next_in = 0, this.strm.output = this.outputBuffer, this.strm.avail_out = this.chunkSize, this.strm.next_out = 0;
          var r = (0, h.deflate)(this.strm, h.Z_FULL_FLUSH), i = new Uint8Array(this.strm.output.buffer, 0, this.strm.next_out);
          if (r < 0)
            throw new Error("zlib deflate failed");
          if (this.strm.avail_in > 0) {
            var l = [i], a = i.length;
            do {
              if (this.strm.output = new Uint8Array(this.chunkSize), this.strm.next_out = 0, this.strm.avail_out = this.chunkSize, r = (0, h.deflate)(this.strm, h.Z_FULL_FLUSH), r < 0)
                throw new Error("zlib deflate failed");
              var n = new Uint8Array(this.strm.output.buffer, 0, this.strm.next_out);
              a += n.length, l.push(n);
            } while (this.strm.avail_in > 0);
            for (var c = new Uint8Array(a), x = 0, v = 0; v < l.length; v++)
              c.set(l[v], x), x += l[v].length;
            i = c;
          }
          return this.strm.input = null, this.strm.avail_in = 0, this.strm.next_in = 0, i;
        }
      }]);
    }();
  }(zt)), zt;
}
var qt = {}, xt = {}, Wt = {}, Or;
function Rt() {
  return Or || (Or = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0, P.default = {
      XK_VoidSymbol: 16777215,
      /* Void symbol */
      XK_BackSpace: 65288,
      /* Back space, back char */
      XK_Tab: 65289,
      XK_Linefeed: 65290,
      /* Linefeed, LF */
      XK_Clear: 65291,
      XK_Return: 65293,
      /* Return, enter */
      XK_Pause: 65299,
      /* Pause, hold */
      XK_Scroll_Lock: 65300,
      XK_Sys_Req: 65301,
      XK_Escape: 65307,
      XK_Delete: 65535,
      /* Delete, rubout */
      /* International & multi-key character composition */
      XK_Multi_key: 65312,
      /* Multi-key character compose */
      XK_Codeinput: 65335,
      XK_SingleCandidate: 65340,
      XK_MultipleCandidate: 65341,
      XK_PreviousCandidate: 65342,
      /* Japanese keyboard support */
      XK_Kanji: 65313,
      /* Kanji, Kanji convert */
      XK_Muhenkan: 65314,
      /* Cancel Conversion */
      XK_Henkan_Mode: 65315,
      /* Start/Stop Conversion */
      XK_Henkan: 65315,
      /* Alias for Henkan_Mode */
      XK_Romaji: 65316,
      /* to Romaji */
      XK_Hiragana: 65317,
      /* to Hiragana */
      XK_Katakana: 65318,
      /* to Katakana */
      XK_Hiragana_Katakana: 65319,
      /* Hiragana/Katakana toggle */
      XK_Zenkaku: 65320,
      /* to Zenkaku */
      XK_Hankaku: 65321,
      /* to Hankaku */
      XK_Zenkaku_Hankaku: 65322,
      /* Zenkaku/Hankaku toggle */
      XK_Touroku: 65323,
      /* Add to Dictionary */
      XK_Massyo: 65324,
      /* Delete from Dictionary */
      XK_Kana_Lock: 65325,
      /* Kana Lock */
      XK_Kana_Shift: 65326,
      /* Kana Shift */
      XK_Eisu_Shift: 65327,
      /* Alphanumeric Shift */
      XK_Eisu_toggle: 65328,
      /* Alphanumeric toggle */
      XK_Kanji_Bangou: 65335,
      /* Codeinput */
      XK_Zen_Koho: 65341,
      /* Multiple/All Candidate(s) */
      XK_Mae_Koho: 65342,
      /* Previous Candidate */
      /* Cursor control & motion */
      XK_Home: 65360,
      XK_Left: 65361,
      /* Move left, left arrow */
      XK_Up: 65362,
      /* Move up, up arrow */
      XK_Right: 65363,
      /* Move right, right arrow */
      XK_Down: 65364,
      /* Move down, down arrow */
      XK_Prior: 65365,
      /* Prior, previous */
      XK_Page_Up: 65365,
      XK_Next: 65366,
      /* Next */
      XK_Page_Down: 65366,
      XK_End: 65367,
      /* EOL */
      XK_Begin: 65368,
      /* BOL */
      /* Misc functions */
      XK_Select: 65376,
      /* Select, mark */
      XK_Print: 65377,
      XK_Execute: 65378,
      /* Execute, run, do */
      XK_Insert: 65379,
      /* Insert, insert here */
      XK_Undo: 65381,
      XK_Redo: 65382,
      /* Redo, again */
      XK_Menu: 65383,
      XK_Find: 65384,
      /* Find, search */
      XK_Cancel: 65385,
      /* Cancel, stop, abort, exit */
      XK_Help: 65386,
      /* Help */
      XK_Break: 65387,
      XK_Mode_switch: 65406,
      /* Character set switch */
      XK_script_switch: 65406,
      /* Alias for mode_switch */
      XK_Num_Lock: 65407,
      /* Keypad functions, keypad numbers cleverly chosen to map to ASCII */
      XK_KP_Space: 65408,
      /* Space */
      XK_KP_Tab: 65417,
      XK_KP_Enter: 65421,
      /* Enter */
      XK_KP_F1: 65425,
      /* PF1, KP_A, ... */
      XK_KP_F2: 65426,
      XK_KP_F3: 65427,
      XK_KP_F4: 65428,
      XK_KP_Home: 65429,
      XK_KP_Left: 65430,
      XK_KP_Up: 65431,
      XK_KP_Right: 65432,
      XK_KP_Down: 65433,
      XK_KP_Prior: 65434,
      XK_KP_Page_Up: 65434,
      XK_KP_Next: 65435,
      XK_KP_Page_Down: 65435,
      XK_KP_End: 65436,
      XK_KP_Begin: 65437,
      XK_KP_Insert: 65438,
      XK_KP_Delete: 65439,
      XK_KP_Equal: 65469,
      /* Equals */
      XK_KP_Multiply: 65450,
      XK_KP_Add: 65451,
      XK_KP_Separator: 65452,
      /* Separator, often comma */
      XK_KP_Subtract: 65453,
      XK_KP_Decimal: 65454,
      XK_KP_Divide: 65455,
      XK_KP_0: 65456,
      XK_KP_1: 65457,
      XK_KP_2: 65458,
      XK_KP_3: 65459,
      XK_KP_4: 65460,
      XK_KP_5: 65461,
      XK_KP_6: 65462,
      XK_KP_7: 65463,
      XK_KP_8: 65464,
      XK_KP_9: 65465,
      /*
       * Auxiliary functions; note the duplicate definitions for left and right
       * function keys;  Sun keyboards and a few other manufacturers have such
       * function key groups on the left and/or right sides of the keyboard.
       * We've not found a keyboard with more than 35 function keys total.
       */
      XK_F1: 65470,
      XK_F2: 65471,
      XK_F3: 65472,
      XK_F4: 65473,
      XK_F5: 65474,
      XK_F6: 65475,
      XK_F7: 65476,
      XK_F8: 65477,
      XK_F9: 65478,
      XK_F10: 65479,
      XK_F11: 65480,
      XK_L1: 65480,
      XK_F12: 65481,
      XK_L2: 65481,
      XK_F13: 65482,
      XK_L3: 65482,
      XK_F14: 65483,
      XK_L4: 65483,
      XK_F15: 65484,
      XK_L5: 65484,
      XK_F16: 65485,
      XK_L6: 65485,
      XK_F17: 65486,
      XK_L7: 65486,
      XK_F18: 65487,
      XK_L8: 65487,
      XK_F19: 65488,
      XK_L9: 65488,
      XK_F20: 65489,
      XK_L10: 65489,
      XK_F21: 65490,
      XK_R1: 65490,
      XK_F22: 65491,
      XK_R2: 65491,
      XK_F23: 65492,
      XK_R3: 65492,
      XK_F24: 65493,
      XK_R4: 65493,
      XK_F25: 65494,
      XK_R5: 65494,
      XK_F26: 65495,
      XK_R6: 65495,
      XK_F27: 65496,
      XK_R7: 65496,
      XK_F28: 65497,
      XK_R8: 65497,
      XK_F29: 65498,
      XK_R9: 65498,
      XK_F30: 65499,
      XK_R10: 65499,
      XK_F31: 65500,
      XK_R11: 65500,
      XK_F32: 65501,
      XK_R12: 65501,
      XK_F33: 65502,
      XK_R13: 65502,
      XK_F34: 65503,
      XK_R14: 65503,
      XK_F35: 65504,
      XK_R15: 65504,
      /* Modifiers */
      XK_Shift_L: 65505,
      /* Left shift */
      XK_Shift_R: 65506,
      /* Right shift */
      XK_Control_L: 65507,
      /* Left control */
      XK_Control_R: 65508,
      /* Right control */
      XK_Caps_Lock: 65509,
      /* Caps lock */
      XK_Shift_Lock: 65510,
      /* Shift lock */
      XK_Meta_L: 65511,
      /* Left meta */
      XK_Meta_R: 65512,
      /* Right meta */
      XK_Alt_L: 65513,
      /* Left alt */
      XK_Alt_R: 65514,
      /* Right alt */
      XK_Super_L: 65515,
      /* Left super */
      XK_Super_R: 65516,
      /* Right super */
      XK_Hyper_L: 65517,
      /* Left hyper */
      XK_Hyper_R: 65518,
      /* Right hyper */
      /*
       * Keyboard (XKB) Extension function and modifier keys
       * (from Appendix C of "The X Keyboard Extension: Protocol Specification")
       * Byte 3 = 0xfe
       */
      XK_ISO_Level3_Shift: 65027,
      /* AltGr */
      XK_ISO_Next_Group: 65032,
      XK_ISO_Prev_Group: 65034,
      XK_ISO_First_Group: 65036,
      XK_ISO_Last_Group: 65038,
      /*
       * Latin 1
       * (ISO/IEC 8859-1: Unicode U+0020..U+00FF)
       * Byte 3: 0
       */
      XK_space: 32,
      /* U+0020 SPACE */
      XK_exclam: 33,
      /* U+0021 EXCLAMATION MARK */
      XK_quotedbl: 34,
      /* U+0022 QUOTATION MARK */
      XK_numbersign: 35,
      /* U+0023 NUMBER SIGN */
      XK_dollar: 36,
      /* U+0024 DOLLAR SIGN */
      XK_percent: 37,
      /* U+0025 PERCENT SIGN */
      XK_ampersand: 38,
      /* U+0026 AMPERSAND */
      XK_apostrophe: 39,
      /* U+0027 APOSTROPHE */
      XK_quoteright: 39,
      /* deprecated */
      XK_parenleft: 40,
      /* U+0028 LEFT PARENTHESIS */
      XK_parenright: 41,
      /* U+0029 RIGHT PARENTHESIS */
      XK_asterisk: 42,
      /* U+002A ASTERISK */
      XK_plus: 43,
      /* U+002B PLUS SIGN */
      XK_comma: 44,
      /* U+002C COMMA */
      XK_minus: 45,
      /* U+002D HYPHEN-MINUS */
      XK_period: 46,
      /* U+002E FULL STOP */
      XK_slash: 47,
      /* U+002F SOLIDUS */
      XK_0: 48,
      /* U+0030 DIGIT ZERO */
      XK_1: 49,
      /* U+0031 DIGIT ONE */
      XK_2: 50,
      /* U+0032 DIGIT TWO */
      XK_3: 51,
      /* U+0033 DIGIT THREE */
      XK_4: 52,
      /* U+0034 DIGIT FOUR */
      XK_5: 53,
      /* U+0035 DIGIT FIVE */
      XK_6: 54,
      /* U+0036 DIGIT SIX */
      XK_7: 55,
      /* U+0037 DIGIT SEVEN */
      XK_8: 56,
      /* U+0038 DIGIT EIGHT */
      XK_9: 57,
      /* U+0039 DIGIT NINE */
      XK_colon: 58,
      /* U+003A COLON */
      XK_semicolon: 59,
      /* U+003B SEMICOLON */
      XK_less: 60,
      /* U+003C LESS-THAN SIGN */
      XK_equal: 61,
      /* U+003D EQUALS SIGN */
      XK_greater: 62,
      /* U+003E GREATER-THAN SIGN */
      XK_question: 63,
      /* U+003F QUESTION MARK */
      XK_at: 64,
      /* U+0040 COMMERCIAL AT */
      XK_A: 65,
      /* U+0041 LATIN CAPITAL LETTER A */
      XK_B: 66,
      /* U+0042 LATIN CAPITAL LETTER B */
      XK_C: 67,
      /* U+0043 LATIN CAPITAL LETTER C */
      XK_D: 68,
      /* U+0044 LATIN CAPITAL LETTER D */
      XK_E: 69,
      /* U+0045 LATIN CAPITAL LETTER E */
      XK_F: 70,
      /* U+0046 LATIN CAPITAL LETTER F */
      XK_G: 71,
      /* U+0047 LATIN CAPITAL LETTER G */
      XK_H: 72,
      /* U+0048 LATIN CAPITAL LETTER H */
      XK_I: 73,
      /* U+0049 LATIN CAPITAL LETTER I */
      XK_J: 74,
      /* U+004A LATIN CAPITAL LETTER J */
      XK_K: 75,
      /* U+004B LATIN CAPITAL LETTER K */
      XK_L: 76,
      /* U+004C LATIN CAPITAL LETTER L */
      XK_M: 77,
      /* U+004D LATIN CAPITAL LETTER M */
      XK_N: 78,
      /* U+004E LATIN CAPITAL LETTER N */
      XK_O: 79,
      /* U+004F LATIN CAPITAL LETTER O */
      XK_P: 80,
      /* U+0050 LATIN CAPITAL LETTER P */
      XK_Q: 81,
      /* U+0051 LATIN CAPITAL LETTER Q */
      XK_R: 82,
      /* U+0052 LATIN CAPITAL LETTER R */
      XK_S: 83,
      /* U+0053 LATIN CAPITAL LETTER S */
      XK_T: 84,
      /* U+0054 LATIN CAPITAL LETTER T */
      XK_U: 85,
      /* U+0055 LATIN CAPITAL LETTER U */
      XK_V: 86,
      /* U+0056 LATIN CAPITAL LETTER V */
      XK_W: 87,
      /* U+0057 LATIN CAPITAL LETTER W */
      XK_X: 88,
      /* U+0058 LATIN CAPITAL LETTER X */
      XK_Y: 89,
      /* U+0059 LATIN CAPITAL LETTER Y */
      XK_Z: 90,
      /* U+005A LATIN CAPITAL LETTER Z */
      XK_bracketleft: 91,
      /* U+005B LEFT SQUARE BRACKET */
      XK_backslash: 92,
      /* U+005C REVERSE SOLIDUS */
      XK_bracketright: 93,
      /* U+005D RIGHT SQUARE BRACKET */
      XK_asciicircum: 94,
      /* U+005E CIRCUMFLEX ACCENT */
      XK_underscore: 95,
      /* U+005F LOW LINE */
      XK_grave: 96,
      /* U+0060 GRAVE ACCENT */
      XK_quoteleft: 96,
      /* deprecated */
      XK_a: 97,
      /* U+0061 LATIN SMALL LETTER A */
      XK_b: 98,
      /* U+0062 LATIN SMALL LETTER B */
      XK_c: 99,
      /* U+0063 LATIN SMALL LETTER C */
      XK_d: 100,
      /* U+0064 LATIN SMALL LETTER D */
      XK_e: 101,
      /* U+0065 LATIN SMALL LETTER E */
      XK_f: 102,
      /* U+0066 LATIN SMALL LETTER F */
      XK_g: 103,
      /* U+0067 LATIN SMALL LETTER G */
      XK_h: 104,
      /* U+0068 LATIN SMALL LETTER H */
      XK_i: 105,
      /* U+0069 LATIN SMALL LETTER I */
      XK_j: 106,
      /* U+006A LATIN SMALL LETTER J */
      XK_k: 107,
      /* U+006B LATIN SMALL LETTER K */
      XK_l: 108,
      /* U+006C LATIN SMALL LETTER L */
      XK_m: 109,
      /* U+006D LATIN SMALL LETTER M */
      XK_n: 110,
      /* U+006E LATIN SMALL LETTER N */
      XK_o: 111,
      /* U+006F LATIN SMALL LETTER O */
      XK_p: 112,
      /* U+0070 LATIN SMALL LETTER P */
      XK_q: 113,
      /* U+0071 LATIN SMALL LETTER Q */
      XK_r: 114,
      /* U+0072 LATIN SMALL LETTER R */
      XK_s: 115,
      /* U+0073 LATIN SMALL LETTER S */
      XK_t: 116,
      /* U+0074 LATIN SMALL LETTER T */
      XK_u: 117,
      /* U+0075 LATIN SMALL LETTER U */
      XK_v: 118,
      /* U+0076 LATIN SMALL LETTER V */
      XK_w: 119,
      /* U+0077 LATIN SMALL LETTER W */
      XK_x: 120,
      /* U+0078 LATIN SMALL LETTER X */
      XK_y: 121,
      /* U+0079 LATIN SMALL LETTER Y */
      XK_z: 122,
      /* U+007A LATIN SMALL LETTER Z */
      XK_braceleft: 123,
      /* U+007B LEFT CURLY BRACKET */
      XK_bar: 124,
      /* U+007C VERTICAL LINE */
      XK_braceright: 125,
      /* U+007D RIGHT CURLY BRACKET */
      XK_asciitilde: 126,
      /* U+007E TILDE */
      XK_nobreakspace: 160,
      /* U+00A0 NO-BREAK SPACE */
      XK_exclamdown: 161,
      /* U+00A1 INVERTED EXCLAMATION MARK */
      XK_cent: 162,
      /* U+00A2 CENT SIGN */
      XK_sterling: 163,
      /* U+00A3 POUND SIGN */
      XK_currency: 164,
      /* U+00A4 CURRENCY SIGN */
      XK_yen: 165,
      /* U+00A5 YEN SIGN */
      XK_brokenbar: 166,
      /* U+00A6 BROKEN BAR */
      XK_section: 167,
      /* U+00A7 SECTION SIGN */
      XK_diaeresis: 168,
      /* U+00A8 DIAERESIS */
      XK_copyright: 169,
      /* U+00A9 COPYRIGHT SIGN */
      XK_ordfeminine: 170,
      /* U+00AA FEMININE ORDINAL INDICATOR */
      XK_guillemotleft: 171,
      /* U+00AB LEFT-POINTING DOUBLE ANGLE QUOTATION MARK */
      XK_notsign: 172,
      /* U+00AC NOT SIGN */
      XK_hyphen: 173,
      /* U+00AD SOFT HYPHEN */
      XK_registered: 174,
      /* U+00AE REGISTERED SIGN */
      XK_macron: 175,
      /* U+00AF MACRON */
      XK_degree: 176,
      /* U+00B0 DEGREE SIGN */
      XK_plusminus: 177,
      /* U+00B1 PLUS-MINUS SIGN */
      XK_twosuperior: 178,
      /* U+00B2 SUPERSCRIPT TWO */
      XK_threesuperior: 179,
      /* U+00B3 SUPERSCRIPT THREE */
      XK_acute: 180,
      /* U+00B4 ACUTE ACCENT */
      XK_mu: 181,
      /* U+00B5 MICRO SIGN */
      XK_paragraph: 182,
      /* U+00B6 PILCROW SIGN */
      XK_periodcentered: 183,
      /* U+00B7 MIDDLE DOT */
      XK_cedilla: 184,
      /* U+00B8 CEDILLA */
      XK_onesuperior: 185,
      /* U+00B9 SUPERSCRIPT ONE */
      XK_masculine: 186,
      /* U+00BA MASCULINE ORDINAL INDICATOR */
      XK_guillemotright: 187,
      /* U+00BB RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK */
      XK_onequarter: 188,
      /* U+00BC VULGAR FRACTION ONE QUARTER */
      XK_onehalf: 189,
      /* U+00BD VULGAR FRACTION ONE HALF */
      XK_threequarters: 190,
      /* U+00BE VULGAR FRACTION THREE QUARTERS */
      XK_questiondown: 191,
      /* U+00BF INVERTED QUESTION MARK */
      XK_Agrave: 192,
      /* U+00C0 LATIN CAPITAL LETTER A WITH GRAVE */
      XK_Aacute: 193,
      /* U+00C1 LATIN CAPITAL LETTER A WITH ACUTE */
      XK_Acircumflex: 194,
      /* U+00C2 LATIN CAPITAL LETTER A WITH CIRCUMFLEX */
      XK_Atilde: 195,
      /* U+00C3 LATIN CAPITAL LETTER A WITH TILDE */
      XK_Adiaeresis: 196,
      /* U+00C4 LATIN CAPITAL LETTER A WITH DIAERESIS */
      XK_Aring: 197,
      /* U+00C5 LATIN CAPITAL LETTER A WITH RING ABOVE */
      XK_AE: 198,
      /* U+00C6 LATIN CAPITAL LETTER AE */
      XK_Ccedilla: 199,
      /* U+00C7 LATIN CAPITAL LETTER C WITH CEDILLA */
      XK_Egrave: 200,
      /* U+00C8 LATIN CAPITAL LETTER E WITH GRAVE */
      XK_Eacute: 201,
      /* U+00C9 LATIN CAPITAL LETTER E WITH ACUTE */
      XK_Ecircumflex: 202,
      /* U+00CA LATIN CAPITAL LETTER E WITH CIRCUMFLEX */
      XK_Ediaeresis: 203,
      /* U+00CB LATIN CAPITAL LETTER E WITH DIAERESIS */
      XK_Igrave: 204,
      /* U+00CC LATIN CAPITAL LETTER I WITH GRAVE */
      XK_Iacute: 205,
      /* U+00CD LATIN CAPITAL LETTER I WITH ACUTE */
      XK_Icircumflex: 206,
      /* U+00CE LATIN CAPITAL LETTER I WITH CIRCUMFLEX */
      XK_Idiaeresis: 207,
      /* U+00CF LATIN CAPITAL LETTER I WITH DIAERESIS */
      XK_ETH: 208,
      /* U+00D0 LATIN CAPITAL LETTER ETH */
      XK_Eth: 208,
      /* deprecated */
      XK_Ntilde: 209,
      /* U+00D1 LATIN CAPITAL LETTER N WITH TILDE */
      XK_Ograve: 210,
      /* U+00D2 LATIN CAPITAL LETTER O WITH GRAVE */
      XK_Oacute: 211,
      /* U+00D3 LATIN CAPITAL LETTER O WITH ACUTE */
      XK_Ocircumflex: 212,
      /* U+00D4 LATIN CAPITAL LETTER O WITH CIRCUMFLEX */
      XK_Otilde: 213,
      /* U+00D5 LATIN CAPITAL LETTER O WITH TILDE */
      XK_Odiaeresis: 214,
      /* U+00D6 LATIN CAPITAL LETTER O WITH DIAERESIS */
      XK_multiply: 215,
      /* U+00D7 MULTIPLICATION SIGN */
      XK_Oslash: 216,
      /* U+00D8 LATIN CAPITAL LETTER O WITH STROKE */
      XK_Ooblique: 216,
      /* U+00D8 LATIN CAPITAL LETTER O WITH STROKE */
      XK_Ugrave: 217,
      /* U+00D9 LATIN CAPITAL LETTER U WITH GRAVE */
      XK_Uacute: 218,
      /* U+00DA LATIN CAPITAL LETTER U WITH ACUTE */
      XK_Ucircumflex: 219,
      /* U+00DB LATIN CAPITAL LETTER U WITH CIRCUMFLEX */
      XK_Udiaeresis: 220,
      /* U+00DC LATIN CAPITAL LETTER U WITH DIAERESIS */
      XK_Yacute: 221,
      /* U+00DD LATIN CAPITAL LETTER Y WITH ACUTE */
      XK_THORN: 222,
      /* U+00DE LATIN CAPITAL LETTER THORN */
      XK_Thorn: 222,
      /* deprecated */
      XK_ssharp: 223,
      /* U+00DF LATIN SMALL LETTER SHARP S */
      XK_agrave: 224,
      /* U+00E0 LATIN SMALL LETTER A WITH GRAVE */
      XK_aacute: 225,
      /* U+00E1 LATIN SMALL LETTER A WITH ACUTE */
      XK_acircumflex: 226,
      /* U+00E2 LATIN SMALL LETTER A WITH CIRCUMFLEX */
      XK_atilde: 227,
      /* U+00E3 LATIN SMALL LETTER A WITH TILDE */
      XK_adiaeresis: 228,
      /* U+00E4 LATIN SMALL LETTER A WITH DIAERESIS */
      XK_aring: 229,
      /* U+00E5 LATIN SMALL LETTER A WITH RING ABOVE */
      XK_ae: 230,
      /* U+00E6 LATIN SMALL LETTER AE */
      XK_ccedilla: 231,
      /* U+00E7 LATIN SMALL LETTER C WITH CEDILLA */
      XK_egrave: 232,
      /* U+00E8 LATIN SMALL LETTER E WITH GRAVE */
      XK_eacute: 233,
      /* U+00E9 LATIN SMALL LETTER E WITH ACUTE */
      XK_ecircumflex: 234,
      /* U+00EA LATIN SMALL LETTER E WITH CIRCUMFLEX */
      XK_ediaeresis: 235,
      /* U+00EB LATIN SMALL LETTER E WITH DIAERESIS */
      XK_igrave: 236,
      /* U+00EC LATIN SMALL LETTER I WITH GRAVE */
      XK_iacute: 237,
      /* U+00ED LATIN SMALL LETTER I WITH ACUTE */
      XK_icircumflex: 238,
      /* U+00EE LATIN SMALL LETTER I WITH CIRCUMFLEX */
      XK_idiaeresis: 239,
      /* U+00EF LATIN SMALL LETTER I WITH DIAERESIS */
      XK_eth: 240,
      /* U+00F0 LATIN SMALL LETTER ETH */
      XK_ntilde: 241,
      /* U+00F1 LATIN SMALL LETTER N WITH TILDE */
      XK_ograve: 242,
      /* U+00F2 LATIN SMALL LETTER O WITH GRAVE */
      XK_oacute: 243,
      /* U+00F3 LATIN SMALL LETTER O WITH ACUTE */
      XK_ocircumflex: 244,
      /* U+00F4 LATIN SMALL LETTER O WITH CIRCUMFLEX */
      XK_otilde: 245,
      /* U+00F5 LATIN SMALL LETTER O WITH TILDE */
      XK_odiaeresis: 246,
      /* U+00F6 LATIN SMALL LETTER O WITH DIAERESIS */
      XK_division: 247,
      /* U+00F7 DIVISION SIGN */
      XK_oslash: 248,
      /* U+00F8 LATIN SMALL LETTER O WITH STROKE */
      XK_ooblique: 248,
      /* U+00F8 LATIN SMALL LETTER O WITH STROKE */
      XK_ugrave: 249,
      /* U+00F9 LATIN SMALL LETTER U WITH GRAVE */
      XK_uacute: 250,
      /* U+00FA LATIN SMALL LETTER U WITH ACUTE */
      XK_ucircumflex: 251,
      /* U+00FB LATIN SMALL LETTER U WITH CIRCUMFLEX */
      XK_udiaeresis: 252,
      /* U+00FC LATIN SMALL LETTER U WITH DIAERESIS */
      XK_yacute: 253,
      /* U+00FD LATIN SMALL LETTER Y WITH ACUTE */
      XK_thorn: 254,
      /* U+00FE LATIN SMALL LETTER THORN */
      XK_ydiaeresis: 255,
      /* U+00FF LATIN SMALL LETTER Y WITH DIAERESIS */
      /*
       * Korean
       * Byte 3 = 0x0e
       */
      XK_Hangul: 65329,
      /* Hangul start/stop(toggle) */
      XK_Hangul_Hanja: 65332,
      /* Start Hangul->Hanja Conversion */
      XK_Hangul_Jeonja: 65336,
      /* Jeonja mode */
      /*
       * XFree86 vendor specific keysyms.
       *
       * The XFree86 keysym range is 0x10080001 - 0x1008FFFF.
       */
      XF86XK_ModeLock: 269025025,
      XF86XK_MonBrightnessUp: 269025026,
      XF86XK_MonBrightnessDown: 269025027,
      XF86XK_KbdLightOnOff: 269025028,
      XF86XK_KbdBrightnessUp: 269025029,
      XF86XK_KbdBrightnessDown: 269025030,
      XF86XK_Standby: 269025040,
      XF86XK_AudioLowerVolume: 269025041,
      XF86XK_AudioMute: 269025042,
      XF86XK_AudioRaiseVolume: 269025043,
      XF86XK_AudioPlay: 269025044,
      XF86XK_AudioStop: 269025045,
      XF86XK_AudioPrev: 269025046,
      XF86XK_AudioNext: 269025047,
      XF86XK_HomePage: 269025048,
      XF86XK_Mail: 269025049,
      XF86XK_Start: 269025050,
      XF86XK_Search: 269025051,
      XF86XK_AudioRecord: 269025052,
      XF86XK_Calculator: 269025053,
      XF86XK_Memo: 269025054,
      XF86XK_ToDoList: 269025055,
      XF86XK_Calendar: 269025056,
      XF86XK_PowerDown: 269025057,
      XF86XK_ContrastAdjust: 269025058,
      XF86XK_RockerUp: 269025059,
      XF86XK_RockerDown: 269025060,
      XF86XK_RockerEnter: 269025061,
      XF86XK_Back: 269025062,
      XF86XK_Forward: 269025063,
      XF86XK_Stop: 269025064,
      XF86XK_Refresh: 269025065,
      XF86XK_PowerOff: 269025066,
      XF86XK_WakeUp: 269025067,
      XF86XK_Eject: 269025068,
      XF86XK_ScreenSaver: 269025069,
      XF86XK_WWW: 269025070,
      XF86XK_Sleep: 269025071,
      XF86XK_Favorites: 269025072,
      XF86XK_AudioPause: 269025073,
      XF86XK_AudioMedia: 269025074,
      XF86XK_MyComputer: 269025075,
      XF86XK_VendorHome: 269025076,
      XF86XK_LightBulb: 269025077,
      XF86XK_Shop: 269025078,
      XF86XK_History: 269025079,
      XF86XK_OpenURL: 269025080,
      XF86XK_AddFavorite: 269025081,
      XF86XK_HotLinks: 269025082,
      XF86XK_BrightnessAdjust: 269025083,
      XF86XK_Finance: 269025084,
      XF86XK_Community: 269025085,
      XF86XK_AudioRewind: 269025086,
      XF86XK_BackForward: 269025087,
      XF86XK_Launch0: 269025088,
      XF86XK_Launch1: 269025089,
      XF86XK_Launch2: 269025090,
      XF86XK_Launch3: 269025091,
      XF86XK_Launch4: 269025092,
      XF86XK_Launch5: 269025093,
      XF86XK_Launch6: 269025094,
      XF86XK_Launch7: 269025095,
      XF86XK_Launch8: 269025096,
      XF86XK_Launch9: 269025097,
      XF86XK_LaunchA: 269025098,
      XF86XK_LaunchB: 269025099,
      XF86XK_LaunchC: 269025100,
      XF86XK_LaunchD: 269025101,
      XF86XK_LaunchE: 269025102,
      XF86XK_LaunchF: 269025103,
      XF86XK_ApplicationLeft: 269025104,
      XF86XK_ApplicationRight: 269025105,
      XF86XK_Book: 269025106,
      XF86XK_CD: 269025107,
      XF86XK_Calculater: 269025108,
      XF86XK_Clear: 269025109,
      XF86XK_Close: 269025110,
      XF86XK_Copy: 269025111,
      XF86XK_Cut: 269025112,
      XF86XK_Display: 269025113,
      XF86XK_DOS: 269025114,
      XF86XK_Documents: 269025115,
      XF86XK_Excel: 269025116,
      XF86XK_Explorer: 269025117,
      XF86XK_Game: 269025118,
      XF86XK_Go: 269025119,
      XF86XK_iTouch: 269025120,
      XF86XK_LogOff: 269025121,
      XF86XK_Market: 269025122,
      XF86XK_Meeting: 269025123,
      XF86XK_MenuKB: 269025125,
      XF86XK_MenuPB: 269025126,
      XF86XK_MySites: 269025127,
      XF86XK_New: 269025128,
      XF86XK_News: 269025129,
      XF86XK_OfficeHome: 269025130,
      XF86XK_Open: 269025131,
      XF86XK_Option: 269025132,
      XF86XK_Paste: 269025133,
      XF86XK_Phone: 269025134,
      XF86XK_Q: 269025136,
      XF86XK_Reply: 269025138,
      XF86XK_Reload: 269025139,
      XF86XK_RotateWindows: 269025140,
      XF86XK_RotationPB: 269025141,
      XF86XK_RotationKB: 269025142,
      XF86XK_Save: 269025143,
      XF86XK_ScrollUp: 269025144,
      XF86XK_ScrollDown: 269025145,
      XF86XK_ScrollClick: 269025146,
      XF86XK_Send: 269025147,
      XF86XK_Spell: 269025148,
      XF86XK_SplitScreen: 269025149,
      XF86XK_Support: 269025150,
      XF86XK_TaskPane: 269025151,
      XF86XK_Terminal: 269025152,
      XF86XK_Tools: 269025153,
      XF86XK_Travel: 269025154,
      XF86XK_UserPB: 269025156,
      XF86XK_User1KB: 269025157,
      XF86XK_User2KB: 269025158,
      XF86XK_Video: 269025159,
      XF86XK_WheelButton: 269025160,
      XF86XK_Word: 269025161,
      XF86XK_Xfer: 269025162,
      XF86XK_ZoomIn: 269025163,
      XF86XK_ZoomOut: 269025164,
      XF86XK_Away: 269025165,
      XF86XK_Messenger: 269025166,
      XF86XK_WebCam: 269025167,
      XF86XK_MailForward: 269025168,
      XF86XK_Pictures: 269025169,
      XF86XK_Music: 269025170,
      XF86XK_Battery: 269025171,
      XF86XK_Bluetooth: 269025172,
      XF86XK_WLAN: 269025173,
      XF86XK_UWB: 269025174,
      XF86XK_AudioForward: 269025175,
      XF86XK_AudioRepeat: 269025176,
      XF86XK_AudioRandomPlay: 269025177,
      XF86XK_Subtitle: 269025178,
      XF86XK_AudioCycleTrack: 269025179,
      XF86XK_CycleAngle: 269025180,
      XF86XK_FrameBack: 269025181,
      XF86XK_FrameForward: 269025182,
      XF86XK_Time: 269025183,
      XF86XK_Select: 269025184,
      XF86XK_View: 269025185,
      XF86XK_TopMenu: 269025186,
      XF86XK_Red: 269025187,
      XF86XK_Green: 269025188,
      XF86XK_Yellow: 269025189,
      XF86XK_Blue: 269025190,
      XF86XK_Suspend: 269025191,
      XF86XK_Hibernate: 269025192,
      XF86XK_TouchpadToggle: 269025193,
      XF86XK_TouchpadOn: 269025200,
      XF86XK_TouchpadOff: 269025201,
      XF86XK_AudioMicMute: 269025202,
      XF86XK_Switch_VT_1: 269024769,
      XF86XK_Switch_VT_2: 269024770,
      XF86XK_Switch_VT_3: 269024771,
      XF86XK_Switch_VT_4: 269024772,
      XF86XK_Switch_VT_5: 269024773,
      XF86XK_Switch_VT_6: 269024774,
      XF86XK_Switch_VT_7: 269024775,
      XF86XK_Switch_VT_8: 269024776,
      XF86XK_Switch_VT_9: 269024777,
      XF86XK_Switch_VT_10: 269024778,
      XF86XK_Switch_VT_11: 269024779,
      XF86XK_Switch_VT_12: 269024780,
      XF86XK_Ungrab: 269024800,
      XF86XK_ClearGrab: 269024801,
      XF86XK_Next_VMode: 269024802,
      XF86XK_Prev_VMode: 269024803,
      XF86XK_LogWindowTree: 269024804,
      XF86XK_LogGrabInfo: 269024805
    };
  }(Wt)), Wt;
}
var Vt = {}, Br;
function Un() {
  return Br || (Br = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = {
      256: 960,
      // XK_Amacron
      257: 992,
      // XK_amacron
      258: 451,
      // XK_Abreve
      259: 483,
      // XK_abreve
      260: 417,
      // XK_Aogonek
      261: 433,
      // XK_aogonek
      262: 454,
      // XK_Cacute
      263: 486,
      // XK_cacute
      264: 710,
      // XK_Ccircumflex
      265: 742,
      // XK_ccircumflex
      266: 709,
      // XK_Cabovedot
      267: 741,
      // XK_cabovedot
      268: 456,
      // XK_Ccaron
      269: 488,
      // XK_ccaron
      270: 463,
      // XK_Dcaron
      271: 495,
      // XK_dcaron
      272: 464,
      // XK_Dstroke
      273: 496,
      // XK_dstroke
      274: 938,
      // XK_Emacron
      275: 954,
      // XK_emacron
      278: 972,
      // XK_Eabovedot
      279: 1004,
      // XK_eabovedot
      280: 458,
      // XK_Eogonek
      281: 490,
      // XK_eogonek
      282: 460,
      // XK_Ecaron
      283: 492,
      // XK_ecaron
      284: 728,
      // XK_Gcircumflex
      285: 760,
      // XK_gcircumflex
      286: 683,
      // XK_Gbreve
      287: 699,
      // XK_gbreve
      288: 725,
      // XK_Gabovedot
      289: 757,
      // XK_gabovedot
      290: 939,
      // XK_Gcedilla
      291: 955,
      // XK_gcedilla
      292: 678,
      // XK_Hcircumflex
      293: 694,
      // XK_hcircumflex
      294: 673,
      // XK_Hstroke
      295: 689,
      // XK_hstroke
      296: 933,
      // XK_Itilde
      297: 949,
      // XK_itilde
      298: 975,
      // XK_Imacron
      299: 1007,
      // XK_imacron
      302: 967,
      // XK_Iogonek
      303: 999,
      // XK_iogonek
      304: 681,
      // XK_Iabovedot
      305: 697,
      // XK_idotless
      308: 684,
      // XK_Jcircumflex
      309: 700,
      // XK_jcircumflex
      310: 979,
      // XK_Kcedilla
      311: 1011,
      // XK_kcedilla
      312: 930,
      // XK_kra
      313: 453,
      // XK_Lacute
      314: 485,
      // XK_lacute
      315: 934,
      // XK_Lcedilla
      316: 950,
      // XK_lcedilla
      317: 421,
      // XK_Lcaron
      318: 437,
      // XK_lcaron
      321: 419,
      // XK_Lstroke
      322: 435,
      // XK_lstroke
      323: 465,
      // XK_Nacute
      324: 497,
      // XK_nacute
      325: 977,
      // XK_Ncedilla
      326: 1009,
      // XK_ncedilla
      327: 466,
      // XK_Ncaron
      328: 498,
      // XK_ncaron
      330: 957,
      // XK_ENG
      331: 959,
      // XK_eng
      332: 978,
      // XK_Omacron
      333: 1010,
      // XK_omacron
      336: 469,
      // XK_Odoubleacute
      337: 501,
      // XK_odoubleacute
      338: 5052,
      // XK_OE
      339: 5053,
      // XK_oe
      340: 448,
      // XK_Racute
      341: 480,
      // XK_racute
      342: 931,
      // XK_Rcedilla
      343: 947,
      // XK_rcedilla
      344: 472,
      // XK_Rcaron
      345: 504,
      // XK_rcaron
      346: 422,
      // XK_Sacute
      347: 438,
      // XK_sacute
      348: 734,
      // XK_Scircumflex
      349: 766,
      // XK_scircumflex
      350: 426,
      // XK_Scedilla
      351: 442,
      // XK_scedilla
      352: 425,
      // XK_Scaron
      353: 441,
      // XK_scaron
      354: 478,
      // XK_Tcedilla
      355: 510,
      // XK_tcedilla
      356: 427,
      // XK_Tcaron
      357: 443,
      // XK_tcaron
      358: 940,
      // XK_Tslash
      359: 956,
      // XK_tslash
      360: 989,
      // XK_Utilde
      361: 1021,
      // XK_utilde
      362: 990,
      // XK_Umacron
      363: 1022,
      // XK_umacron
      364: 733,
      // XK_Ubreve
      365: 765,
      // XK_ubreve
      366: 473,
      // XK_Uring
      367: 505,
      // XK_uring
      368: 475,
      // XK_Udoubleacute
      369: 507,
      // XK_udoubleacute
      370: 985,
      // XK_Uogonek
      371: 1017,
      // XK_uogonek
      376: 5054,
      // XK_Ydiaeresis
      377: 428,
      // XK_Zacute
      378: 444,
      // XK_zacute
      379: 431,
      // XK_Zabovedot
      380: 447,
      // XK_zabovedot
      381: 430,
      // XK_Zcaron
      382: 446,
      // XK_zcaron
      402: 2294,
      // XK_function
      466: 16777681,
      // XK_Ocaron
      711: 439,
      // XK_caron
      728: 418,
      // XK_breve
      729: 511,
      // XK_abovedot
      731: 434,
      // XK_ogonek
      733: 445,
      // XK_doubleacute
      901: 1966,
      // XK_Greek_accentdieresis
      902: 1953,
      // XK_Greek_ALPHAaccent
      904: 1954,
      // XK_Greek_EPSILONaccent
      905: 1955,
      // XK_Greek_ETAaccent
      906: 1956,
      // XK_Greek_IOTAaccent
      908: 1959,
      // XK_Greek_OMICRONaccent
      910: 1960,
      // XK_Greek_UPSILONaccent
      911: 1963,
      // XK_Greek_OMEGAaccent
      912: 1974,
      // XK_Greek_iotaaccentdieresis
      913: 1985,
      // XK_Greek_ALPHA
      914: 1986,
      // XK_Greek_BETA
      915: 1987,
      // XK_Greek_GAMMA
      916: 1988,
      // XK_Greek_DELTA
      917: 1989,
      // XK_Greek_EPSILON
      918: 1990,
      // XK_Greek_ZETA
      919: 1991,
      // XK_Greek_ETA
      920: 1992,
      // XK_Greek_THETA
      921: 1993,
      // XK_Greek_IOTA
      922: 1994,
      // XK_Greek_KAPPA
      923: 1995,
      // XK_Greek_LAMDA
      924: 1996,
      // XK_Greek_MU
      925: 1997,
      // XK_Greek_NU
      926: 1998,
      // XK_Greek_XI
      927: 1999,
      // XK_Greek_OMICRON
      928: 2e3,
      // XK_Greek_PI
      929: 2001,
      // XK_Greek_RHO
      931: 2002,
      // XK_Greek_SIGMA
      932: 2004,
      // XK_Greek_TAU
      933: 2005,
      // XK_Greek_UPSILON
      934: 2006,
      // XK_Greek_PHI
      935: 2007,
      // XK_Greek_CHI
      936: 2008,
      // XK_Greek_PSI
      937: 2009,
      // XK_Greek_OMEGA
      938: 1957,
      // XK_Greek_IOTAdieresis
      939: 1961,
      // XK_Greek_UPSILONdieresis
      940: 1969,
      // XK_Greek_alphaaccent
      941: 1970,
      // XK_Greek_epsilonaccent
      942: 1971,
      // XK_Greek_etaaccent
      943: 1972,
      // XK_Greek_iotaaccent
      944: 1978,
      // XK_Greek_upsilonaccentdieresis
      945: 2017,
      // XK_Greek_alpha
      946: 2018,
      // XK_Greek_beta
      947: 2019,
      // XK_Greek_gamma
      948: 2020,
      // XK_Greek_delta
      949: 2021,
      // XK_Greek_epsilon
      950: 2022,
      // XK_Greek_zeta
      951: 2023,
      // XK_Greek_eta
      952: 2024,
      // XK_Greek_theta
      953: 2025,
      // XK_Greek_iota
      954: 2026,
      // XK_Greek_kappa
      955: 2027,
      // XK_Greek_lamda
      956: 2028,
      // XK_Greek_mu
      957: 2029,
      // XK_Greek_nu
      958: 2030,
      // XK_Greek_xi
      959: 2031,
      // XK_Greek_omicron
      960: 2032,
      // XK_Greek_pi
      961: 2033,
      // XK_Greek_rho
      962: 2035,
      // XK_Greek_finalsmallsigma
      963: 2034,
      // XK_Greek_sigma
      964: 2036,
      // XK_Greek_tau
      965: 2037,
      // XK_Greek_upsilon
      966: 2038,
      // XK_Greek_phi
      967: 2039,
      // XK_Greek_chi
      968: 2040,
      // XK_Greek_psi
      969: 2041,
      // XK_Greek_omega
      970: 1973,
      // XK_Greek_iotadieresis
      971: 1977,
      // XK_Greek_upsilondieresis
      972: 1975,
      // XK_Greek_omicronaccent
      973: 1976,
      // XK_Greek_upsilonaccent
      974: 1979,
      // XK_Greek_omegaaccent
      1025: 1715,
      // XK_Cyrillic_IO
      1026: 1713,
      // XK_Serbian_DJE
      1027: 1714,
      // XK_Macedonia_GJE
      1028: 1716,
      // XK_Ukrainian_IE
      1029: 1717,
      // XK_Macedonia_DSE
      1030: 1718,
      // XK_Ukrainian_I
      1031: 1719,
      // XK_Ukrainian_YI
      1032: 1720,
      // XK_Cyrillic_JE
      1033: 1721,
      // XK_Cyrillic_LJE
      1034: 1722,
      // XK_Cyrillic_NJE
      1035: 1723,
      // XK_Serbian_TSHE
      1036: 1724,
      // XK_Macedonia_KJE
      1038: 1726,
      // XK_Byelorussian_SHORTU
      1039: 1727,
      // XK_Cyrillic_DZHE
      1040: 1761,
      // XK_Cyrillic_A
      1041: 1762,
      // XK_Cyrillic_BE
      1042: 1783,
      // XK_Cyrillic_VE
      1043: 1767,
      // XK_Cyrillic_GHE
      1044: 1764,
      // XK_Cyrillic_DE
      1045: 1765,
      // XK_Cyrillic_IE
      1046: 1782,
      // XK_Cyrillic_ZHE
      1047: 1786,
      // XK_Cyrillic_ZE
      1048: 1769,
      // XK_Cyrillic_I
      1049: 1770,
      // XK_Cyrillic_SHORTI
      1050: 1771,
      // XK_Cyrillic_KA
      1051: 1772,
      // XK_Cyrillic_EL
      1052: 1773,
      // XK_Cyrillic_EM
      1053: 1774,
      // XK_Cyrillic_EN
      1054: 1775,
      // XK_Cyrillic_O
      1055: 1776,
      // XK_Cyrillic_PE
      1056: 1778,
      // XK_Cyrillic_ER
      1057: 1779,
      // XK_Cyrillic_ES
      1058: 1780,
      // XK_Cyrillic_TE
      1059: 1781,
      // XK_Cyrillic_U
      1060: 1766,
      // XK_Cyrillic_EF
      1061: 1768,
      // XK_Cyrillic_HA
      1062: 1763,
      // XK_Cyrillic_TSE
      1063: 1790,
      // XK_Cyrillic_CHE
      1064: 1787,
      // XK_Cyrillic_SHA
      1065: 1789,
      // XK_Cyrillic_SHCHA
      1066: 1791,
      // XK_Cyrillic_HARDSIGN
      1067: 1785,
      // XK_Cyrillic_YERU
      1068: 1784,
      // XK_Cyrillic_SOFTSIGN
      1069: 1788,
      // XK_Cyrillic_E
      1070: 1760,
      // XK_Cyrillic_YU
      1071: 1777,
      // XK_Cyrillic_YA
      1072: 1729,
      // XK_Cyrillic_a
      1073: 1730,
      // XK_Cyrillic_be
      1074: 1751,
      // XK_Cyrillic_ve
      1075: 1735,
      // XK_Cyrillic_ghe
      1076: 1732,
      // XK_Cyrillic_de
      1077: 1733,
      // XK_Cyrillic_ie
      1078: 1750,
      // XK_Cyrillic_zhe
      1079: 1754,
      // XK_Cyrillic_ze
      1080: 1737,
      // XK_Cyrillic_i
      1081: 1738,
      // XK_Cyrillic_shorti
      1082: 1739,
      // XK_Cyrillic_ka
      1083: 1740,
      // XK_Cyrillic_el
      1084: 1741,
      // XK_Cyrillic_em
      1085: 1742,
      // XK_Cyrillic_en
      1086: 1743,
      // XK_Cyrillic_o
      1087: 1744,
      // XK_Cyrillic_pe
      1088: 1746,
      // XK_Cyrillic_er
      1089: 1747,
      // XK_Cyrillic_es
      1090: 1748,
      // XK_Cyrillic_te
      1091: 1749,
      // XK_Cyrillic_u
      1092: 1734,
      // XK_Cyrillic_ef
      1093: 1736,
      // XK_Cyrillic_ha
      1094: 1731,
      // XK_Cyrillic_tse
      1095: 1758,
      // XK_Cyrillic_che
      1096: 1755,
      // XK_Cyrillic_sha
      1097: 1757,
      // XK_Cyrillic_shcha
      1098: 1759,
      // XK_Cyrillic_hardsign
      1099: 1753,
      // XK_Cyrillic_yeru
      1100: 1752,
      // XK_Cyrillic_softsign
      1101: 1756,
      // XK_Cyrillic_e
      1102: 1728,
      // XK_Cyrillic_yu
      1103: 1745,
      // XK_Cyrillic_ya
      1105: 1699,
      // XK_Cyrillic_io
      1106: 1697,
      // XK_Serbian_dje
      1107: 1698,
      // XK_Macedonia_gje
      1108: 1700,
      // XK_Ukrainian_ie
      1109: 1701,
      // XK_Macedonia_dse
      1110: 1702,
      // XK_Ukrainian_i
      1111: 1703,
      // XK_Ukrainian_yi
      1112: 1704,
      // XK_Cyrillic_je
      1113: 1705,
      // XK_Cyrillic_lje
      1114: 1706,
      // XK_Cyrillic_nje
      1115: 1707,
      // XK_Serbian_tshe
      1116: 1708,
      // XK_Macedonia_kje
      1118: 1710,
      // XK_Byelorussian_shortu
      1119: 1711,
      // XK_Cyrillic_dzhe
      1168: 1725,
      // XK_Ukrainian_GHE_WITH_UPTURN
      1169: 1709,
      // XK_Ukrainian_ghe_with_upturn
      1488: 3296,
      // XK_hebrew_aleph
      1489: 3297,
      // XK_hebrew_bet
      1490: 3298,
      // XK_hebrew_gimel
      1491: 3299,
      // XK_hebrew_dalet
      1492: 3300,
      // XK_hebrew_he
      1493: 3301,
      // XK_hebrew_waw
      1494: 3302,
      // XK_hebrew_zain
      1495: 3303,
      // XK_hebrew_chet
      1496: 3304,
      // XK_hebrew_tet
      1497: 3305,
      // XK_hebrew_yod
      1498: 3306,
      // XK_hebrew_finalkaph
      1499: 3307,
      // XK_hebrew_kaph
      1500: 3308,
      // XK_hebrew_lamed
      1501: 3309,
      // XK_hebrew_finalmem
      1502: 3310,
      // XK_hebrew_mem
      1503: 3311,
      // XK_hebrew_finalnun
      1504: 3312,
      // XK_hebrew_nun
      1505: 3313,
      // XK_hebrew_samech
      1506: 3314,
      // XK_hebrew_ayin
      1507: 3315,
      // XK_hebrew_finalpe
      1508: 3316,
      // XK_hebrew_pe
      1509: 3317,
      // XK_hebrew_finalzade
      1510: 3318,
      // XK_hebrew_zade
      1511: 3319,
      // XK_hebrew_qoph
      1512: 3320,
      // XK_hebrew_resh
      1513: 3321,
      // XK_hebrew_shin
      1514: 3322,
      // XK_hebrew_taw
      1548: 1452,
      // XK_Arabic_comma
      1563: 1467,
      // XK_Arabic_semicolon
      1567: 1471,
      // XK_Arabic_question_mark
      1569: 1473,
      // XK_Arabic_hamza
      1570: 1474,
      // XK_Arabic_maddaonalef
      1571: 1475,
      // XK_Arabic_hamzaonalef
      1572: 1476,
      // XK_Arabic_hamzaonwaw
      1573: 1477,
      // XK_Arabic_hamzaunderalef
      1574: 1478,
      // XK_Arabic_hamzaonyeh
      1575: 1479,
      // XK_Arabic_alef
      1576: 1480,
      // XK_Arabic_beh
      1577: 1481,
      // XK_Arabic_tehmarbuta
      1578: 1482,
      // XK_Arabic_teh
      1579: 1483,
      // XK_Arabic_theh
      1580: 1484,
      // XK_Arabic_jeem
      1581: 1485,
      // XK_Arabic_hah
      1582: 1486,
      // XK_Arabic_khah
      1583: 1487,
      // XK_Arabic_dal
      1584: 1488,
      // XK_Arabic_thal
      1585: 1489,
      // XK_Arabic_ra
      1586: 1490,
      // XK_Arabic_zain
      1587: 1491,
      // XK_Arabic_seen
      1588: 1492,
      // XK_Arabic_sheen
      1589: 1493,
      // XK_Arabic_sad
      1590: 1494,
      // XK_Arabic_dad
      1591: 1495,
      // XK_Arabic_tah
      1592: 1496,
      // XK_Arabic_zah
      1593: 1497,
      // XK_Arabic_ain
      1594: 1498,
      // XK_Arabic_ghain
      1600: 1504,
      // XK_Arabic_tatweel
      1601: 1505,
      // XK_Arabic_feh
      1602: 1506,
      // XK_Arabic_qaf
      1603: 1507,
      // XK_Arabic_kaf
      1604: 1508,
      // XK_Arabic_lam
      1605: 1509,
      // XK_Arabic_meem
      1606: 1510,
      // XK_Arabic_noon
      1607: 1511,
      // XK_Arabic_ha
      1608: 1512,
      // XK_Arabic_waw
      1609: 1513,
      // XK_Arabic_alefmaksura
      1610: 1514,
      // XK_Arabic_yeh
      1611: 1515,
      // XK_Arabic_fathatan
      1612: 1516,
      // XK_Arabic_dammatan
      1613: 1517,
      // XK_Arabic_kasratan
      1614: 1518,
      // XK_Arabic_fatha
      1615: 1519,
      // XK_Arabic_damma
      1616: 1520,
      // XK_Arabic_kasra
      1617: 1521,
      // XK_Arabic_shadda
      1618: 1522,
      // XK_Arabic_sukun
      3585: 3489,
      // XK_Thai_kokai
      3586: 3490,
      // XK_Thai_khokhai
      3587: 3491,
      // XK_Thai_khokhuat
      3588: 3492,
      // XK_Thai_khokhwai
      3589: 3493,
      // XK_Thai_khokhon
      3590: 3494,
      // XK_Thai_khorakhang
      3591: 3495,
      // XK_Thai_ngongu
      3592: 3496,
      // XK_Thai_chochan
      3593: 3497,
      // XK_Thai_choching
      3594: 3498,
      // XK_Thai_chochang
      3595: 3499,
      // XK_Thai_soso
      3596: 3500,
      // XK_Thai_chochoe
      3597: 3501,
      // XK_Thai_yoying
      3598: 3502,
      // XK_Thai_dochada
      3599: 3503,
      // XK_Thai_topatak
      3600: 3504,
      // XK_Thai_thothan
      3601: 3505,
      // XK_Thai_thonangmontho
      3602: 3506,
      // XK_Thai_thophuthao
      3603: 3507,
      // XK_Thai_nonen
      3604: 3508,
      // XK_Thai_dodek
      3605: 3509,
      // XK_Thai_totao
      3606: 3510,
      // XK_Thai_thothung
      3607: 3511,
      // XK_Thai_thothahan
      3608: 3512,
      // XK_Thai_thothong
      3609: 3513,
      // XK_Thai_nonu
      3610: 3514,
      // XK_Thai_bobaimai
      3611: 3515,
      // XK_Thai_popla
      3612: 3516,
      // XK_Thai_phophung
      3613: 3517,
      // XK_Thai_fofa
      3614: 3518,
      // XK_Thai_phophan
      3615: 3519,
      // XK_Thai_fofan
      3616: 3520,
      // XK_Thai_phosamphao
      3617: 3521,
      // XK_Thai_moma
      3618: 3522,
      // XK_Thai_yoyak
      3619: 3523,
      // XK_Thai_rorua
      3620: 3524,
      // XK_Thai_ru
      3621: 3525,
      // XK_Thai_loling
      3622: 3526,
      // XK_Thai_lu
      3623: 3527,
      // XK_Thai_wowaen
      3624: 3528,
      // XK_Thai_sosala
      3625: 3529,
      // XK_Thai_sorusi
      3626: 3530,
      // XK_Thai_sosua
      3627: 3531,
      // XK_Thai_hohip
      3628: 3532,
      // XK_Thai_lochula
      3629: 3533,
      // XK_Thai_oang
      3630: 3534,
      // XK_Thai_honokhuk
      3631: 3535,
      // XK_Thai_paiyannoi
      3632: 3536,
      // XK_Thai_saraa
      3633: 3537,
      // XK_Thai_maihanakat
      3634: 3538,
      // XK_Thai_saraaa
      3635: 3539,
      // XK_Thai_saraam
      3636: 3540,
      // XK_Thai_sarai
      3637: 3541,
      // XK_Thai_saraii
      3638: 3542,
      // XK_Thai_saraue
      3639: 3543,
      // XK_Thai_sarauee
      3640: 3544,
      // XK_Thai_sarau
      3641: 3545,
      // XK_Thai_sarauu
      3642: 3546,
      // XK_Thai_phinthu
      3647: 3551,
      // XK_Thai_baht
      3648: 3552,
      // XK_Thai_sarae
      3649: 3553,
      // XK_Thai_saraae
      3650: 3554,
      // XK_Thai_sarao
      3651: 3555,
      // XK_Thai_saraaimaimuan
      3652: 3556,
      // XK_Thai_saraaimaimalai
      3653: 3557,
      // XK_Thai_lakkhangyao
      3654: 3558,
      // XK_Thai_maiyamok
      3655: 3559,
      // XK_Thai_maitaikhu
      3656: 3560,
      // XK_Thai_maiek
      3657: 3561,
      // XK_Thai_maitho
      3658: 3562,
      // XK_Thai_maitri
      3659: 3563,
      // XK_Thai_maichattawa
      3660: 3564,
      // XK_Thai_thanthakhat
      3661: 3565,
      // XK_Thai_nikhahit
      3664: 3568,
      // XK_Thai_leksun
      3665: 3569,
      // XK_Thai_leknung
      3666: 3570,
      // XK_Thai_leksong
      3667: 3571,
      // XK_Thai_leksam
      3668: 3572,
      // XK_Thai_leksi
      3669: 3573,
      // XK_Thai_lekha
      3670: 3574,
      // XK_Thai_lekhok
      3671: 3575,
      // XK_Thai_lekchet
      3672: 3576,
      // XK_Thai_lekpaet
      3673: 3577,
      // XK_Thai_lekkao
      8194: 2722,
      // XK_enspace
      8195: 2721,
      // XK_emspace
      8196: 2723,
      // XK_em3space
      8197: 2724,
      // XK_em4space
      8199: 2725,
      // XK_digitspace
      8200: 2726,
      // XK_punctspace
      8201: 2727,
      // XK_thinspace
      8202: 2728,
      // XK_hairspace
      8210: 2747,
      // XK_figdash
      8211: 2730,
      // XK_endash
      8212: 2729,
      // XK_emdash
      8213: 1967,
      // XK_Greek_horizbar
      8215: 3295,
      // XK_hebrew_doublelowline
      8216: 2768,
      // XK_leftsinglequotemark
      8217: 2769,
      // XK_rightsinglequotemark
      8218: 2813,
      // XK_singlelowquotemark
      8220: 2770,
      // XK_leftdoublequotemark
      8221: 2771,
      // XK_rightdoublequotemark
      8222: 2814,
      // XK_doublelowquotemark
      8224: 2801,
      // XK_dagger
      8225: 2802,
      // XK_doubledagger
      8226: 2790,
      // XK_enfilledcircbullet
      8229: 2735,
      // XK_doubbaselinedot
      8230: 2734,
      // XK_ellipsis
      8240: 2773,
      // XK_permille
      8242: 2774,
      // XK_minutes
      8243: 2775,
      // XK_seconds
      8248: 2812,
      // XK_caret
      8254: 1150,
      // XK_overline
      8361: 3839,
      // XK_Korean_Won
      8364: 8364,
      // XK_EuroSign
      8453: 2744,
      // XK_careof
      8470: 1712,
      // XK_numerosign
      8471: 2811,
      // XK_phonographcopyright
      8478: 2772,
      // XK_prescription
      8482: 2761,
      // XK_trademark
      8531: 2736,
      // XK_onethird
      8532: 2737,
      // XK_twothirds
      8533: 2738,
      // XK_onefifth
      8534: 2739,
      // XK_twofifths
      8535: 2740,
      // XK_threefifths
      8536: 2741,
      // XK_fourfifths
      8537: 2742,
      // XK_onesixth
      8538: 2743,
      // XK_fivesixths
      8539: 2755,
      // XK_oneeighth
      8540: 2756,
      // XK_threeeighths
      8541: 2757,
      // XK_fiveeighths
      8542: 2758,
      // XK_seveneighths
      8592: 2299,
      // XK_leftarrow
      8593: 2300,
      // XK_uparrow
      8594: 2301,
      // XK_rightarrow
      8595: 2302,
      // XK_downarrow
      8658: 2254,
      // XK_implies
      8660: 2253,
      // XK_ifonlyif
      8706: 2287,
      // XK_partialderivative
      8711: 2245,
      // XK_nabla
      8728: 3018,
      // XK_jot
      8730: 2262,
      // XK_radical
      8733: 2241,
      // XK_variation
      8734: 2242,
      // XK_infinity
      8743: 2270,
      // XK_logicaland
      8744: 2271,
      // XK_logicalor
      8745: 2268,
      // XK_intersection
      8746: 2269,
      // XK_union
      8747: 2239,
      // XK_integral
      8756: 2240,
      // XK_therefore
      8764: 2248,
      // XK_approximate
      8771: 2249,
      // XK_similarequal
      8773: 16785992,
      // XK_approxeq
      8800: 2237,
      // XK_notequal
      8801: 2255,
      // XK_identical
      8804: 2236,
      // XK_lessthanequal
      8805: 2238,
      // XK_greaterthanequal
      8834: 2266,
      // XK_includedin
      8835: 2267,
      // XK_includes
      8866: 3068,
      // XK_righttack
      8867: 3036,
      // XK_lefttack
      8868: 3010,
      // XK_downtack
      8869: 3022,
      // XK_uptack
      8968: 3027,
      // XK_upstile
      8970: 3012,
      // XK_downstile
      8981: 2810,
      // XK_telephonerecorder
      8992: 2212,
      // XK_topintegral
      8993: 2213,
      // XK_botintegral
      9109: 3020,
      // XK_quad
      9115: 2219,
      // XK_topleftparens
      9117: 2220,
      // XK_botleftparens
      9118: 2221,
      // XK_toprightparens
      9120: 2222,
      // XK_botrightparens
      9121: 2215,
      // XK_topleftsqbracket
      9123: 2216,
      // XK_botleftsqbracket
      9124: 2217,
      // XK_toprightsqbracket
      9126: 2218,
      // XK_botrightsqbracket
      9128: 2223,
      // XK_leftmiddlecurlybrace
      9132: 2224,
      // XK_rightmiddlecurlybrace
      9143: 2209,
      // XK_leftradical
      9146: 2543,
      // XK_horizlinescan1
      9147: 2544,
      // XK_horizlinescan3
      9148: 2546,
      // XK_horizlinescan7
      9149: 2547,
      // XK_horizlinescan9
      9225: 2530,
      // XK_ht
      9226: 2533,
      // XK_lf
      9227: 2537,
      // XK_vt
      9228: 2531,
      // XK_ff
      9229: 2532,
      // XK_cr
      9251: 2732,
      // XK_signifblank
      9252: 2536,
      // XK_nl
      9472: 2211,
      // XK_horizconnector
      9474: 2214,
      // XK_vertconnector
      9484: 2210,
      // XK_topleftradical
      9488: 2539,
      // XK_uprightcorner
      9492: 2541,
      // XK_lowleftcorner
      9496: 2538,
      // XK_lowrightcorner
      9500: 2548,
      // XK_leftt
      9508: 2549,
      // XK_rightt
      9516: 2551,
      // XK_topt
      9524: 2550,
      // XK_bott
      9532: 2542,
      // XK_crossinglines
      9618: 2529,
      // XK_checkerboard
      9642: 2791,
      // XK_enfilledsqbullet
      9643: 2785,
      // XK_enopensquarebullet
      9644: 2779,
      // XK_filledrectbullet
      9645: 2786,
      // XK_openrectbullet
      9646: 2783,
      // XK_emfilledrect
      9647: 2767,
      // XK_emopenrectangle
      9650: 2792,
      // XK_filledtribulletup
      9651: 2787,
      // XK_opentribulletup
      9654: 2781,
      // XK_filledrighttribullet
      9655: 2765,
      // XK_rightopentriangle
      9660: 2793,
      // XK_filledtribulletdown
      9661: 2788,
      // XK_opentribulletdown
      9664: 2780,
      // XK_filledlefttribullet
      9665: 2764,
      // XK_leftopentriangle
      9670: 2528,
      // XK_soliddiamond
      9675: 2766,
      // XK_emopencircle
      9679: 2782,
      // XK_emfilledcircle
      9702: 2784,
      // XK_enopencircbullet
      9734: 2789,
      // XK_openstar
      9742: 2809,
      // XK_telephone
      9747: 2762,
      // XK_signaturemark
      9756: 2794,
      // XK_leftpointer
      9758: 2795,
      // XK_rightpointer
      9792: 2808,
      // XK_femalesymbol
      9794: 2807,
      // XK_malesymbol
      9827: 2796,
      // XK_club
      9829: 2798,
      // XK_heart
      9830: 2797,
      // XK_diamond
      9837: 2806,
      // XK_musicalflat
      9839: 2805,
      // XK_musicalsharp
      10003: 2803,
      // XK_checkmark
      10007: 2804,
      // XK_ballotcross
      10013: 2777,
      // XK_latincross
      10016: 2800,
      // XK_maltesecross
      10216: 2748,
      // XK_leftanglebracket
      10217: 2750,
      // XK_rightanglebracket
      12289: 1188,
      // XK_kana_comma
      12290: 1185,
      // XK_kana_fullstop
      12300: 1186,
      // XK_kana_openingbracket
      12301: 1187,
      // XK_kana_closingbracket
      12443: 1246,
      // XK_voicedsound
      12444: 1247,
      // XK_semivoicedsound
      12449: 1191,
      // XK_kana_a
      12450: 1201,
      // XK_kana_A
      12451: 1192,
      // XK_kana_i
      12452: 1202,
      // XK_kana_I
      12453: 1193,
      // XK_kana_u
      12454: 1203,
      // XK_kana_U
      12455: 1194,
      // XK_kana_e
      12456: 1204,
      // XK_kana_E
      12457: 1195,
      // XK_kana_o
      12458: 1205,
      // XK_kana_O
      12459: 1206,
      // XK_kana_KA
      12461: 1207,
      // XK_kana_KI
      12463: 1208,
      // XK_kana_KU
      12465: 1209,
      // XK_kana_KE
      12467: 1210,
      // XK_kana_KO
      12469: 1211,
      // XK_kana_SA
      12471: 1212,
      // XK_kana_SHI
      12473: 1213,
      // XK_kana_SU
      12475: 1214,
      // XK_kana_SE
      12477: 1215,
      // XK_kana_SO
      12479: 1216,
      // XK_kana_TA
      12481: 1217,
      // XK_kana_CHI
      12483: 1199,
      // XK_kana_tsu
      12484: 1218,
      // XK_kana_TSU
      12486: 1219,
      // XK_kana_TE
      12488: 1220,
      // XK_kana_TO
      12490: 1221,
      // XK_kana_NA
      12491: 1222,
      // XK_kana_NI
      12492: 1223,
      // XK_kana_NU
      12493: 1224,
      // XK_kana_NE
      12494: 1225,
      // XK_kana_NO
      12495: 1226,
      // XK_kana_HA
      12498: 1227,
      // XK_kana_HI
      12501: 1228,
      // XK_kana_FU
      12504: 1229,
      // XK_kana_HE
      12507: 1230,
      // XK_kana_HO
      12510: 1231,
      // XK_kana_MA
      12511: 1232,
      // XK_kana_MI
      12512: 1233,
      // XK_kana_MU
      12513: 1234,
      // XK_kana_ME
      12514: 1235,
      // XK_kana_MO
      12515: 1196,
      // XK_kana_ya
      12516: 1236,
      // XK_kana_YA
      12517: 1197,
      // XK_kana_yu
      12518: 1237,
      // XK_kana_YU
      12519: 1198,
      // XK_kana_yo
      12520: 1238,
      // XK_kana_YO
      12521: 1239,
      // XK_kana_RA
      12522: 1240,
      // XK_kana_RI
      12523: 1241,
      // XK_kana_RU
      12524: 1242,
      // XK_kana_RE
      12525: 1243,
      // XK_kana_RO
      12527: 1244,
      // XK_kana_WA
      12530: 1190,
      // XK_kana_WO
      12531: 1245,
      // XK_kana_N
      12539: 1189,
      // XK_kana_conjunctive
      12540: 1200
      // XK_prolongedsound
    };
    P.default = {
      lookup: function(A) {
        if (A >= 32 && A <= 255)
          return A;
        var K = h[A];
        return K !== void 0 ? K : 16777216 | A;
      }
    };
  }(Vt)), Vt;
}
var Zt = {}, Qr;
function Nn() {
  return Qr || (Qr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0, P.default = {
      8: "Backspace",
      9: "Tab",
      10: "NumpadClear",
      13: "Enter",
      16: "ShiftLeft",
      17: "ControlLeft",
      18: "AltLeft",
      19: "Pause",
      20: "CapsLock",
      21: "Lang1",
      25: "Lang2",
      27: "Escape",
      28: "Convert",
      29: "NonConvert",
      32: "Space",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      41: "Select",
      44: "PrintScreen",
      45: "Insert",
      46: "Delete",
      47: "Help",
      48: "Digit0",
      49: "Digit1",
      50: "Digit2",
      51: "Digit3",
      52: "Digit4",
      53: "Digit5",
      54: "Digit6",
      55: "Digit7",
      56: "Digit8",
      57: "Digit9",
      91: "MetaLeft",
      92: "MetaRight",
      93: "ContextMenu",
      95: "Sleep",
      96: "Numpad0",
      97: "Numpad1",
      98: "Numpad2",
      99: "Numpad3",
      100: "Numpad4",
      101: "Numpad5",
      102: "Numpad6",
      103: "Numpad7",
      104: "Numpad8",
      105: "Numpad9",
      106: "NumpadMultiply",
      107: "NumpadAdd",
      108: "NumpadDecimal",
      109: "NumpadSubtract",
      110: "NumpadDecimal",
      // Duplicate, because buggy on Windows
      111: "NumpadDivide",
      112: "F1",
      113: "F2",
      114: "F3",
      115: "F4",
      116: "F5",
      117: "F6",
      118: "F7",
      119: "F8",
      120: "F9",
      121: "F10",
      122: "F11",
      123: "F12",
      124: "F13",
      125: "F14",
      126: "F15",
      127: "F16",
      128: "F17",
      129: "F18",
      130: "F19",
      131: "F20",
      132: "F21",
      133: "F22",
      134: "F23",
      135: "F24",
      144: "NumLock",
      145: "ScrollLock",
      166: "BrowserBack",
      167: "BrowserForward",
      168: "BrowserRefresh",
      169: "BrowserStop",
      170: "BrowserSearch",
      171: "BrowserFavorites",
      172: "BrowserHome",
      173: "AudioVolumeMute",
      174: "AudioVolumeDown",
      175: "AudioVolumeUp",
      176: "MediaTrackNext",
      177: "MediaTrackPrevious",
      178: "MediaStop",
      179: "MediaPlayPause",
      180: "LaunchMail",
      181: "MediaSelect",
      182: "LaunchApp1",
      183: "LaunchApp2",
      225: "AltRight"
      // Only when it is AltGraph
    };
  }(Zt)), Zt;
}
var Yt = {}, Ir;
function jn() {
  return Ir || (Ir = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0, P.default = {
      // 3.1.1.1. Writing System Keys
      Backspace: "Backspace",
      // 3.1.1.2. Functional Keys
      AltLeft: "Alt",
      AltRight: "Alt",
      // This could also be 'AltGraph'
      CapsLock: "CapsLock",
      ContextMenu: "ContextMenu",
      ControlLeft: "Control",
      ControlRight: "Control",
      Enter: "Enter",
      MetaLeft: "Meta",
      MetaRight: "Meta",
      ShiftLeft: "Shift",
      ShiftRight: "Shift",
      Tab: "Tab",
      // FIXME: Japanese/Korean keys
      // 3.1.2. Control Pad Section
      Delete: "Delete",
      End: "End",
      Help: "Help",
      Home: "Home",
      Insert: "Insert",
      PageDown: "PageDown",
      PageUp: "PageUp",
      // 3.1.3. Arrow Pad Section
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      ArrowUp: "ArrowUp",
      // 3.1.4. Numpad Section
      NumLock: "NumLock",
      NumpadBackspace: "Backspace",
      NumpadClear: "Clear",
      // 3.1.5. Function Section
      Escape: "Escape",
      F1: "F1",
      F2: "F2",
      F3: "F3",
      F4: "F4",
      F5: "F5",
      F6: "F6",
      F7: "F7",
      F8: "F8",
      F9: "F9",
      F10: "F10",
      F11: "F11",
      F12: "F12",
      F13: "F13",
      F14: "F14",
      F15: "F15",
      F16: "F16",
      F17: "F17",
      F18: "F18",
      F19: "F19",
      F20: "F20",
      F21: "F21",
      F22: "F22",
      F23: "F23",
      F24: "F24",
      F25: "F25",
      F26: "F26",
      F27: "F27",
      F28: "F28",
      F29: "F29",
      F30: "F30",
      F31: "F31",
      F32: "F32",
      F33: "F33",
      F34: "F34",
      F35: "F35",
      PrintScreen: "PrintScreen",
      ScrollLock: "ScrollLock",
      Pause: "Pause",
      // 3.1.6. Media Keys
      BrowserBack: "BrowserBack",
      BrowserFavorites: "BrowserFavorites",
      BrowserForward: "BrowserForward",
      BrowserHome: "BrowserHome",
      BrowserRefresh: "BrowserRefresh",
      BrowserSearch: "BrowserSearch",
      BrowserStop: "BrowserStop",
      Eject: "Eject",
      LaunchApp1: "LaunchMyComputer",
      LaunchApp2: "LaunchCalendar",
      LaunchMail: "LaunchMail",
      MediaPlayPause: "MediaPlay",
      MediaStop: "MediaStop",
      MediaTrackNext: "MediaTrackNext",
      MediaTrackPrevious: "MediaTrackPrevious",
      Power: "Power",
      Sleep: "Sleep",
      AudioVolumeDown: "AudioVolumeDown",
      AudioVolumeMute: "AudioVolumeMute",
      AudioVolumeUp: "AudioVolumeUp",
      WakeUp: "WakeUp"
    };
  }(Yt)), Yt;
}
var $t = {}, Ur;
function Hn() {
  return Ur || (Ur = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = Y(Rt());
    function Y(C) {
      return C && C.__esModule ? C : { default: C };
    }
    var A = {};
    function K(C, u) {
      if (u === void 0) throw new Error('Undefined keysym for key "' + C + '"');
      if (C in A) throw new Error('Duplicate entry for key "' + C + '"');
      A[C] = [u, u, u, u];
    }
    function I(C, u, _) {
      if (u === void 0) throw new Error('Undefined keysym for key "' + C + '"');
      if (_ === void 0) throw new Error('Undefined keysym for key "' + C + '"');
      if (C in A) throw new Error('Duplicate entry for key "' + C + '"');
      A[C] = [u, u, _, u];
    }
    function L(C, u, _) {
      if (u === void 0) throw new Error('Undefined keysym for key "' + C + '"');
      if (_ === void 0) throw new Error('Undefined keysym for key "' + C + '"');
      if (C in A) throw new Error('Duplicate entry for key "' + C + '"');
      A[C] = [u, u, u, _];
    }
    I("Alt", h.default.XK_Alt_L, h.default.XK_Alt_R), K("AltGraph", h.default.XK_ISO_Level3_Shift), K("CapsLock", h.default.XK_Caps_Lock), I("Control", h.default.XK_Control_L, h.default.XK_Control_R), I("Meta", h.default.XK_Super_L, h.default.XK_Super_R), K("NumLock", h.default.XK_Num_Lock), K("ScrollLock", h.default.XK_Scroll_Lock), I("Shift", h.default.XK_Shift_L, h.default.XK_Shift_R), L("Enter", h.default.XK_Return, h.default.XK_KP_Enter), K("Tab", h.default.XK_Tab), L(" ", h.default.XK_space, h.default.XK_KP_Space), L("ArrowDown", h.default.XK_Down, h.default.XK_KP_Down), L("ArrowLeft", h.default.XK_Left, h.default.XK_KP_Left), L("ArrowRight", h.default.XK_Right, h.default.XK_KP_Right), L("ArrowUp", h.default.XK_Up, h.default.XK_KP_Up), L("End", h.default.XK_End, h.default.XK_KP_End), L("Home", h.default.XK_Home, h.default.XK_KP_Home), L("PageDown", h.default.XK_Next, h.default.XK_KP_Next), L("PageUp", h.default.XK_Prior, h.default.XK_KP_Prior), K("Backspace", h.default.XK_BackSpace), L("Clear", h.default.XK_Clear, h.default.XK_KP_Begin), K("Copy", h.default.XF86XK_Copy), K("Cut", h.default.XF86XK_Cut), L("Delete", h.default.XK_Delete, h.default.XK_KP_Delete), L("Insert", h.default.XK_Insert, h.default.XK_KP_Insert), K("Paste", h.default.XF86XK_Paste), K("Redo", h.default.XK_Redo), K("Undo", h.default.XK_Undo), K("Cancel", h.default.XK_Cancel), K("ContextMenu", h.default.XK_Menu), K("Escape", h.default.XK_Escape), K("Execute", h.default.XK_Execute), K("Find", h.default.XK_Find), K("Help", h.default.XK_Help), K("Pause", h.default.XK_Pause), K("Select", h.default.XK_Select), K("ZoomIn", h.default.XF86XK_ZoomIn), K("ZoomOut", h.default.XF86XK_ZoomOut), K("BrightnessDown", h.default.XF86XK_MonBrightnessDown), K("BrightnessUp", h.default.XF86XK_MonBrightnessUp), K("Eject", h.default.XF86XK_Eject), K("LogOff", h.default.XF86XK_LogOff), K("Power", h.default.XF86XK_PowerOff), K("PowerOff", h.default.XF86XK_PowerDown), K("PrintScreen", h.default.XK_Print), K("Hibernate", h.default.XF86XK_Hibernate), K("Standby", h.default.XF86XK_Standby), K("WakeUp", h.default.XF86XK_WakeUp), K("AllCandidates", h.default.XK_MultipleCandidate), K("Alphanumeric", h.default.XK_Eisu_toggle), K("CodeInput", h.default.XK_Codeinput), K("Compose", h.default.XK_Multi_key), K("Convert", h.default.XK_Henkan), K("GroupFirst", h.default.XK_ISO_First_Group), K("GroupLast", h.default.XK_ISO_Last_Group), K("GroupNext", h.default.XK_ISO_Next_Group), K("GroupPrevious", h.default.XK_ISO_Prev_Group), K("NonConvert", h.default.XK_Muhenkan), K("PreviousCandidate", h.default.XK_PreviousCandidate), K("SingleCandidate", h.default.XK_SingleCandidate), K("HangulMode", h.default.XK_Hangul), K("HanjaMode", h.default.XK_Hangul_Hanja), K("JunjaMode", h.default.XK_Hangul_Jeonja), K("Eisu", h.default.XK_Eisu_toggle), K("Hankaku", h.default.XK_Hankaku), K("Hiragana", h.default.XK_Hiragana), K("HiraganaKatakana", h.default.XK_Hiragana_Katakana), K("KanaMode", h.default.XK_Kana_Shift), K("KanjiMode", h.default.XK_Kanji), K("Katakana", h.default.XK_Katakana), K("Romaji", h.default.XK_Romaji), K("Zenkaku", h.default.XK_Zenkaku), K("ZenkakuHankaku", h.default.XK_Zenkaku_Hankaku), K("F1", h.default.XK_F1), K("F2", h.default.XK_F2), K("F3", h.default.XK_F3), K("F4", h.default.XK_F4), K("F5", h.default.XK_F5), K("F6", h.default.XK_F6), K("F7", h.default.XK_F7), K("F8", h.default.XK_F8), K("F9", h.default.XK_F9), K("F10", h.default.XK_F10), K("F11", h.default.XK_F11), K("F12", h.default.XK_F12), K("F13", h.default.XK_F13), K("F14", h.default.XK_F14), K("F15", h.default.XK_F15), K("F16", h.default.XK_F16), K("F17", h.default.XK_F17), K("F18", h.default.XK_F18), K("F19", h.default.XK_F19), K("F20", h.default.XK_F20), K("F21", h.default.XK_F21), K("F22", h.default.XK_F22), K("F23", h.default.XK_F23), K("F24", h.default.XK_F24), K("F25", h.default.XK_F25), K("F26", h.default.XK_F26), K("F27", h.default.XK_F27), K("F28", h.default.XK_F28), K("F29", h.default.XK_F29), K("F30", h.default.XK_F30), K("F31", h.default.XK_F31), K("F32", h.default.XK_F32), K("F33", h.default.XK_F33), K("F34", h.default.XK_F34), K("F35", h.default.XK_F35), K("Close", h.default.XF86XK_Close), K("MailForward", h.default.XF86XK_MailForward), K("MailReply", h.default.XF86XK_Reply), K("MailSend", h.default.XF86XK_Send), K("MediaFastForward", h.default.XF86XK_AudioForward), K("MediaPause", h.default.XF86XK_AudioPause), K("MediaPlay", h.default.XF86XK_AudioPlay), K("MediaRecord", h.default.XF86XK_AudioRecord), K("MediaRewind", h.default.XF86XK_AudioRewind), K("MediaStop", h.default.XF86XK_AudioStop), K("MediaTrackNext", h.default.XF86XK_AudioNext), K("MediaTrackPrevious", h.default.XF86XK_AudioPrev), K("New", h.default.XF86XK_New), K("Open", h.default.XF86XK_Open), K("Print", h.default.XK_Print), K("Save", h.default.XF86XK_Save), K("SpellCheck", h.default.XF86XK_Spell), K("AudioVolumeDown", h.default.XF86XK_AudioLowerVolume), K("AudioVolumeUp", h.default.XF86XK_AudioRaiseVolume), K("AudioVolumeMute", h.default.XF86XK_AudioMute), K("MicrophoneVolumeMute", h.default.XF86XK_AudioMicMute), K("LaunchApplication1", h.default.XF86XK_MyComputer), K("LaunchApplication2", h.default.XF86XK_Calculator), K("LaunchCalendar", h.default.XF86XK_Calendar), K("LaunchMail", h.default.XF86XK_Mail), K("LaunchMediaPlayer", h.default.XF86XK_AudioMedia), K("LaunchMusicPlayer", h.default.XF86XK_Music), K("LaunchPhone", h.default.XF86XK_Phone), K("LaunchScreenSaver", h.default.XF86XK_ScreenSaver), K("LaunchSpreadsheet", h.default.XF86XK_Excel), K("LaunchWebBrowser", h.default.XF86XK_WWW), K("LaunchWebCam", h.default.XF86XK_WebCam), K("LaunchWordProcessor", h.default.XF86XK_Word), K("BrowserBack", h.default.XF86XK_Back), K("BrowserFavorites", h.default.XF86XK_Favorites), K("BrowserForward", h.default.XF86XK_Forward), K("BrowserHome", h.default.XF86XK_HomePage), K("BrowserRefresh", h.default.XF86XK_Refresh), K("BrowserSearch", h.default.XF86XK_Search), K("BrowserStop", h.default.XF86XK_Stop), K("Dimmer", h.default.XF86XK_BrightnessAdjust), K("MediaAudioTrack", h.default.XF86XK_AudioCycleTrack), K("RandomToggle", h.default.XF86XK_AudioRandomPlay), K("SplitScreenToggle", h.default.XF86XK_SplitScreen), K("Subtitle", h.default.XF86XK_Subtitle), K("VideoModeNext", h.default.XF86XK_Next_VMode), L("=", h.default.XK_equal, h.default.XK_KP_Equal), L("+", h.default.XK_plus, h.default.XK_KP_Add), L("-", h.default.XK_minus, h.default.XK_KP_Subtract), L("*", h.default.XK_asterisk, h.default.XK_KP_Multiply), L("/", h.default.XK_slash, h.default.XK_KP_Divide), L(".", h.default.XK_period, h.default.XK_KP_Decimal), L(",", h.default.XK_comma, h.default.XK_KP_Separator), L("0", h.default.XK_0, h.default.XK_KP_0), L("1", h.default.XK_1, h.default.XK_KP_1), L("2", h.default.XK_2, h.default.XK_KP_2), L("3", h.default.XK_3, h.default.XK_KP_3), L("4", h.default.XK_4, h.default.XK_KP_4), L("5", h.default.XK_5, h.default.XK_KP_5), L("6", h.default.XK_6, h.default.XK_KP_6), L("7", h.default.XK_7, h.default.XK_KP_7), L("8", h.default.XK_8, h.default.XK_KP_8), L("9", h.default.XK_9, h.default.XK_KP_9), P.default = A;
  }($t)), $t;
}
var Nr;
function zn() {
  if (Nr) return xt;
  Nr = 1;
  function P(r) {
    "@babel/helpers - typeof";
    return P = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(i) {
      return typeof i;
    } : function(i) {
      return i && typeof Symbol == "function" && i.constructor === Symbol && i !== Symbol.prototype ? "symbol" : typeof i;
    }, P(r);
  }
  Object.defineProperty(xt, "__esModule", {
    value: !0
  }), xt.getKey = p, xt.getKeycode = s, xt.getKeysym = f;
  var h = _(Rt()), Y = _(Un()), A = _(Nn()), K = _(jn()), I = _(Hn()), L = u(Ct());
  function C(r) {
    if (typeof WeakMap != "function") return null;
    var i = /* @__PURE__ */ new WeakMap(), l = /* @__PURE__ */ new WeakMap();
    return (C = function(n) {
      return n ? l : i;
    })(r);
  }
  function u(r, i) {
    if (r && r.__esModule) return r;
    if (r === null || P(r) != "object" && typeof r != "function") return { default: r };
    var l = C(i);
    if (l && l.has(r)) return l.get(r);
    var a = { __proto__: null }, n = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for (var c in r) if (c !== "default" && {}.hasOwnProperty.call(r, c)) {
      var x = n ? Object.getOwnPropertyDescriptor(r, c) : null;
      x && (x.get || x.set) ? Object.defineProperty(a, c, x) : a[c] = r[c];
    }
    return a.default = r, l && l.set(r, a), a;
  }
  function _(r) {
    return r && r.__esModule ? r : { default: r };
  }
  function s(r) {
    if (r.code) {
      switch (r.code) {
        case "OSLeft":
          return "MetaLeft";
        case "OSRight":
          return "MetaRight";
      }
      return r.code;
    }
    if (r.keyCode in A.default) {
      var i = A.default[r.keyCode];
      if (L.isMac() && i === "ContextMenu" && (i = "MetaRight"), r.location === 2)
        switch (i) {
          case "ShiftLeft":
            return "ShiftRight";
          case "ControlLeft":
            return "ControlRight";
          case "AltLeft":
            return "AltRight";
        }
      if (r.location === 3)
        switch (i) {
          case "Delete":
            return "NumpadDecimal";
          case "Insert":
            return "Numpad0";
          case "End":
            return "Numpad1";
          case "ArrowDown":
            return "Numpad2";
          case "PageDown":
            return "Numpad3";
          case "ArrowLeft":
            return "Numpad4";
          case "ArrowRight":
            return "Numpad6";
          case "Home":
            return "Numpad7";
          case "ArrowUp":
            return "Numpad8";
          case "PageUp":
            return "Numpad9";
          case "Enter":
            return "NumpadEnter";
        }
      return i;
    }
    return "Unidentified";
  }
  function p(r) {
    if (r.key !== void 0 && r.key !== "Unidentified") {
      switch (r.key) {
        case "OS":
          return "Meta";
        case "LaunchMyComputer":
          return "LaunchApplication1";
        case "LaunchCalculator":
          return "LaunchApplication2";
      }
      switch (r.key) {
        case "UIKeyInputUpArrow":
          return "ArrowUp";
        case "UIKeyInputDownArrow":
          return "ArrowDown";
        case "UIKeyInputLeftArrow":
          return "ArrowLeft";
        case "UIKeyInputRightArrow":
          return "ArrowRight";
        case "UIKeyInputEscape":
          return "Escape";
      }
      return r.key === "\0" && r.code === "NumpadDecimal" ? "Delete" : r.key;
    }
    var i = s(r);
    return i in K.default ? K.default[i] : r.charCode ? String.fromCharCode(r.charCode) : "Unidentified";
  }
  function f(r) {
    var i = p(r);
    if (i === "Unidentified")
      return null;
    if (i in I.default) {
      var l = r.location;
      if (i === "Meta" && l === 0 && (l = 2), i === "Clear" && l === 3) {
        var a = s(r);
        a === "NumLock" && (l = 0);
      }
      if ((l === void 0 || l > 3) && (l = 0), i === "Meta") {
        var n = s(r);
        if (n === "AltLeft")
          return h.default.XK_Meta_L;
        if (n === "AltRight")
          return h.default.XK_Meta_R;
      }
      if (i === "Clear") {
        var c = s(r);
        if (c === "NumLock")
          return h.default.XK_Num_Lock;
      }
      if (L.isWindows())
        switch (i) {
          case "Zenkaku":
          case "Hankaku":
            return h.default.XK_Zenkaku_Hankaku;
          case "Romaji":
          case "KanaMode":
            return h.default.XK_Romaji;
        }
      return I.default[i][l];
    }
    if (i.length !== 1)
      return null;
    var x = i.charCodeAt();
    return x ? Y.default.lookup(x) : null;
  }
  return xt;
}
var jr;
function Gn() {
  return jr || (jr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = u(ht()), Y = pn(), A = u(zn()), K = L(Rt()), I = u(Ct());
    function L(l) {
      return l && l.__esModule ? l : { default: l };
    }
    function C(l) {
      if (typeof WeakMap != "function") return null;
      var a = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (C = function(x) {
        return x ? n : a;
      })(l);
    }
    function u(l, a) {
      if (l && l.__esModule) return l;
      if (l === null || _(l) != "object" && typeof l != "function") return { default: l };
      var n = C(a);
      if (n && n.has(l)) return n.get(l);
      var c = { __proto__: null }, x = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var v in l) if (v !== "default" && {}.hasOwnProperty.call(l, v)) {
        var b = x ? Object.getOwnPropertyDescriptor(l, v) : null;
        b && (b.get || b.set) ? Object.defineProperty(c, v, b) : c[v] = l[v];
      }
      return c.default = l, n && n.set(l, c), c;
    }
    function _(l) {
      "@babel/helpers - typeof";
      return _ = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(a) {
        return typeof a;
      } : function(a) {
        return a && typeof Symbol == "function" && a.constructor === Symbol && a !== Symbol.prototype ? "symbol" : typeof a;
      }, _(l);
    }
    function s(l, a) {
      if (!(l instanceof a)) throw new TypeError("Cannot call a class as a function");
    }
    function p(l, a) {
      for (var n = 0; n < a.length; n++) {
        var c = a[n];
        c.enumerable = c.enumerable || !1, c.configurable = !0, "value" in c && (c.writable = !0), Object.defineProperty(l, r(c.key), c);
      }
    }
    function f(l, a, n) {
      return a && p(l.prototype, a), Object.defineProperty(l, "prototype", { writable: !1 }), l;
    }
    function r(l) {
      var a = i(l, "string");
      return _(a) == "symbol" ? a : a + "";
    }
    function i(l, a) {
      if (_(l) != "object" || !l) return l;
      var n = l[Symbol.toPrimitive];
      if (n !== void 0) {
        var c = n.call(l, a);
        if (_(c) != "object") return c;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(l);
    }
    P.default = /* @__PURE__ */ function() {
      function l(a) {
        s(this, l), this._target = a || null, this._keyDownList = {}, this._altGrArmed = !1, this._eventHandlers = {
          keyup: this._handleKeyUp.bind(this),
          keydown: this._handleKeyDown.bind(this),
          blur: this._allKeysUp.bind(this)
        }, this.onkeyevent = function() {
        };
      }
      return f(l, [{
        key: "_sendKeyEvent",
        value: function(n, c, x) {
          var v = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : null, b = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : null;
          if (x)
            this._keyDownList[c] = n;
          else {
            if (!(c in this._keyDownList))
              return;
            delete this._keyDownList[c];
          }
          h.Debug("onkeyevent " + (x ? "down" : "up") + ", keysym: " + n, ", code: " + c + ", numlock: " + v + ", capslock: " + b), this.onkeyevent(n, c, x, v, b);
        }
      }, {
        key: "_getKeyCode",
        value: function(n) {
          var c = A.getKeycode(n);
          if (c !== "Unidentified")
            return c;
          if (n.keyCode && n.keyCode !== 229)
            return "Platform" + n.keyCode;
          if (n.keyIdentifier) {
            if (n.keyIdentifier.substr(0, 2) !== "U+")
              return n.keyIdentifier;
            var x = parseInt(n.keyIdentifier.substr(2), 16), v = String.fromCharCode(x).toUpperCase();
            return "Platform" + v.charCodeAt();
          }
          return "Unidentified";
        }
      }, {
        key: "_handleKeyDown",
        value: function(n) {
          var c = this._getKeyCode(n), x = A.getKeysym(n), v = n.getModifierState("NumLock"), b = n.getModifierState("CapsLock");
          if ((I.isMac() || I.isIOS()) && (v = null), this._altGrArmed && (this._altGrArmed = !1, clearTimeout(this._altGrTimeout), c === "AltRight" && n.timeStamp - this._altGrCtrlTime < 50 ? x = K.default.XK_ISO_Level3_Shift : this._sendKeyEvent(K.default.XK_Control_L, "ControlLeft", !0, v, b)), c === "Unidentified") {
            x && (this._sendKeyEvent(x, c, !0, v, b), this._sendKeyEvent(x, c, !1, v, b)), (0, Y.stopEvent)(n);
            return;
          }
          if (I.isMac() || I.isIOS())
            switch (x) {
              case K.default.XK_Super_L:
                x = K.default.XK_Alt_L;
                break;
              case K.default.XK_Super_R:
                x = K.default.XK_Super_L;
                break;
              case K.default.XK_Alt_L:
                x = K.default.XK_Mode_switch;
                break;
              case K.default.XK_Alt_R:
                x = K.default.XK_ISO_Level3_Shift;
                break;
            }
          if (c in this._keyDownList && (x = this._keyDownList[c]), (I.isMac() || I.isIOS()) && n.metaKey && c !== "MetaLeft" && c !== "MetaRight") {
            this._sendKeyEvent(x, c, !0, v, b), this._sendKeyEvent(x, c, !1, v, b), (0, Y.stopEvent)(n);
            return;
          }
          if ((I.isMac() || I.isIOS()) && c === "CapsLock") {
            this._sendKeyEvent(K.default.XK_Caps_Lock, "CapsLock", !0, v, b), this._sendKeyEvent(K.default.XK_Caps_Lock, "CapsLock", !1, v, b), (0, Y.stopEvent)(n);
            return;
          }
          var y = [K.default.XK_Zenkaku_Hankaku, K.default.XK_Eisu_toggle, K.default.XK_Katakana, K.default.XK_Hiragana, K.default.XK_Romaji];
          if (I.isWindows() && y.includes(x)) {
            this._sendKeyEvent(x, c, !0, v, b), this._sendKeyEvent(x, c, !1, v, b), (0, Y.stopEvent)(n);
            return;
          }
          if ((0, Y.stopEvent)(n), c === "ControlLeft" && I.isWindows() && !("ControlLeft" in this._keyDownList)) {
            this._altGrArmed = !0, this._altGrTimeout = setTimeout(this._handleAltGrTimeout.bind(this), 100), this._altGrCtrlTime = n.timeStamp;
            return;
          }
          this._sendKeyEvent(x, c, !0, v, b);
        }
      }, {
        key: "_handleKeyUp",
        value: function(n) {
          (0, Y.stopEvent)(n);
          var c = this._getKeyCode(n);
          if (this._altGrArmed && (this._altGrArmed = !1, clearTimeout(this._altGrTimeout), this._sendKeyEvent(K.default.XK_Control_L, "ControlLeft", !0)), (I.isMac() || I.isIOS()) && c === "CapsLock") {
            this._sendKeyEvent(K.default.XK_Caps_Lock, "CapsLock", !0), this._sendKeyEvent(K.default.XK_Caps_Lock, "CapsLock", !1);
            return;
          }
          this._sendKeyEvent(this._keyDownList[c], c, !1), I.isWindows() && (c === "ShiftLeft" || c === "ShiftRight") && ("ShiftRight" in this._keyDownList && this._sendKeyEvent(this._keyDownList.ShiftRight, "ShiftRight", !1), "ShiftLeft" in this._keyDownList && this._sendKeyEvent(this._keyDownList.ShiftLeft, "ShiftLeft", !1));
        }
      }, {
        key: "_handleAltGrTimeout",
        value: function() {
          this._altGrArmed = !1, clearTimeout(this._altGrTimeout), this._sendKeyEvent(K.default.XK_Control_L, "ControlLeft", !0);
        }
      }, {
        key: "_allKeysUp",
        value: function() {
          h.Debug(">> Keyboard.allKeysUp");
          for (var n in this._keyDownList)
            this._sendKeyEvent(this._keyDownList[n], n, !1);
          h.Debug("<< Keyboard.allKeysUp");
        }
        // ===== PUBLIC METHODS =====
      }, {
        key: "grab",
        value: function() {
          this._target.addEventListener("keydown", this._eventHandlers.keydown), this._target.addEventListener("keyup", this._eventHandlers.keyup), window.addEventListener("blur", this._eventHandlers.blur);
        }
      }, {
        key: "ungrab",
        value: function() {
          this._target.removeEventListener("keydown", this._eventHandlers.keydown), this._target.removeEventListener("keyup", this._eventHandlers.keyup), window.removeEventListener("blur", this._eventHandlers.blur), this._allKeysUp();
        }
      }]);
    }();
  }(qt)), qt;
}
var Jt = {}, Hr;
function qn() {
  return Hr || (Hr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    function h(y) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(g) {
        return typeof g;
      } : function(g) {
        return g && typeof Symbol == "function" && g.constructor === Symbol && g !== Symbol.prototype ? "symbol" : typeof g;
      }, h(y);
    }
    function Y(y, g) {
      if (!(y instanceof g)) throw new TypeError("Cannot call a class as a function");
    }
    function A(y, g) {
      for (var S = 0; S < g.length; S++) {
        var X = g[S];
        X.enumerable = X.enumerable || !1, X.configurable = !0, "value" in X && (X.writable = !0), Object.defineProperty(y, I(X.key), X);
      }
    }
    function K(y, g, S) {
      return g && A(y.prototype, g), Object.defineProperty(y, "prototype", { writable: !1 }), y;
    }
    function I(y) {
      var g = L(y, "string");
      return h(g) == "symbol" ? g : g + "";
    }
    function L(y, g) {
      if (h(y) != "object" || !y) return y;
      var S = y[Symbol.toPrimitive];
      if (S !== void 0) {
        var X = S.call(y, g);
        if (h(X) != "object") return X;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(y);
    }
    var C = 0, u = 1, _ = 2, s = 4, p = 8, f = 16, r = 32, i = 64, l = 127, a = 50, n = 90, c = 250, x = 1e3, v = 1e3, b = 50;
    P.default = /* @__PURE__ */ function() {
      function y() {
        Y(this, y), this._target = null, this._state = l, this._tracked = [], this._ignored = [], this._waitingRelease = !1, this._releaseStart = 0, this._longpressTimeoutId = null, this._twoTouchTimeoutId = null, this._boundEventHandler = this._eventHandler.bind(this);
      }
      return K(y, [{
        key: "attach",
        value: function(S) {
          this.detach(), this._target = S, this._target.addEventListener("touchstart", this._boundEventHandler), this._target.addEventListener("touchmove", this._boundEventHandler), this._target.addEventListener("touchend", this._boundEventHandler), this._target.addEventListener("touchcancel", this._boundEventHandler);
        }
      }, {
        key: "detach",
        value: function() {
          this._target && (this._stopLongpressTimeout(), this._stopTwoTouchTimeout(), this._target.removeEventListener("touchstart", this._boundEventHandler), this._target.removeEventListener("touchmove", this._boundEventHandler), this._target.removeEventListener("touchend", this._boundEventHandler), this._target.removeEventListener("touchcancel", this._boundEventHandler), this._target = null);
        }
      }, {
        key: "_eventHandler",
        value: function(S) {
          var X;
          switch (S.stopPropagation(), S.preventDefault(), S.type) {
            case "touchstart":
              X = this._touchStart;
              break;
            case "touchmove":
              X = this._touchMove;
              break;
            case "touchend":
            case "touchcancel":
              X = this._touchEnd;
              break;
          }
          for (var F = 0; F < S.changedTouches.length; F++) {
            var T = S.changedTouches[F];
            X.call(this, T.identifier, T.clientX, T.clientY);
          }
        }
      }, {
        key: "_touchStart",
        value: function(S, X, F) {
          if (this._hasDetectedGesture() || this._state === C) {
            this._ignored.push(S);
            return;
          }
          if (this._tracked.length > 0 && Date.now() - this._tracked[0].started > c) {
            this._state = C, this._ignored.push(S);
            return;
          }
          if (this._waitingRelease) {
            this._state = C, this._ignored.push(S);
            return;
          }
          switch (this._tracked.push({
            id: S,
            started: Date.now(),
            active: !0,
            firstX: X,
            firstY: F,
            lastX: X,
            lastY: F,
            angle: 0
          }), this._tracked.length) {
            case 1:
              this._startLongpressTimeout();
              break;
            case 2:
              this._state &= -26, this._stopLongpressTimeout();
              break;
            case 3:
              this._state &= -99;
              break;
            default:
              this._state = C;
          }
        }
      }, {
        key: "_touchMove",
        value: function(S, X, F) {
          var T = this._tracked.find(function(ge) {
            return ge.id === S;
          });
          if (T !== void 0) {
            T.lastX = X, T.lastY = F;
            var Q = X - T.firstX, D = F - T.firstY;
            if ((T.firstX !== T.lastX || T.firstY !== T.lastY) && (T.angle = Math.atan2(D, Q) * 180 / Math.PI), !this._hasDetectedGesture()) {
              if (Math.hypot(Q, D) < a)
                return;
              if (this._state &= -24, this._stopLongpressTimeout(), this._tracked.length !== 1 && (this._state &= -9), this._tracked.length !== 2 && (this._state &= -97), this._tracked.length === 2) {
                var j = this._tracked.find(function(ge) {
                  return ge.id !== S;
                }), te = Math.hypot(j.firstX - j.lastX, j.firstY - j.lastY);
                if (te > a) {
                  var he = Math.abs(T.angle - j.angle);
                  he = Math.abs((he + 180) % 360 - 180), he > n ? this._state &= -33 : this._state &= -65, this._isTwoTouchTimeoutRunning() && this._stopTwoTouchTimeout();
                } else this._isTwoTouchTimeoutRunning() || this._startTwoTouchTimeout();
              }
              if (!this._hasDetectedGesture())
                return;
              this._pushEvent("gesturestart");
            }
            this._pushEvent("gesturemove");
          }
        }
      }, {
        key: "_touchEnd",
        value: function(S, X, F) {
          if (this._ignored.indexOf(S) !== -1) {
            this._ignored.splice(this._ignored.indexOf(S), 1), this._ignored.length === 0 && this._tracked.length === 0 && (this._state = l, this._waitingRelease = !1);
            return;
          }
          if (!this._hasDetectedGesture() && this._isTwoTouchTimeoutRunning() && (this._stopTwoTouchTimeout(), this._state = C), !this._hasDetectedGesture() && (this._state &= -105, this._state &= -17, this._stopLongpressTimeout(), !this._waitingRelease))
            switch (this._releaseStart = Date.now(), this._waitingRelease = !0, this._tracked.length) {
              case 1:
                this._state &= -7;
                break;
              case 2:
                this._state &= -6;
                break;
            }
          if (this._waitingRelease) {
            Date.now() - this._releaseStart > c && (this._state = C), this._tracked.some(function(D) {
              return Date.now() - D.started > x;
            }) && (this._state = C);
            var T = this._tracked.find(function(D) {
              return D.id === S;
            });
            if (T.active = !1, this._hasDetectedGesture())
              this._pushEvent("gesturestart");
            else if (this._state !== C)
              return;
          }
          this._hasDetectedGesture() && this._pushEvent("gestureend");
          for (var Q = 0; Q < this._tracked.length; Q++)
            this._tracked[Q].active && this._ignored.push(this._tracked[Q].id);
          this._tracked = [], this._state = C, this._ignored.indexOf(S) !== -1 && this._ignored.splice(this._ignored.indexOf(S), 1), this._ignored.length === 0 && (this._state = l, this._waitingRelease = !1);
        }
      }, {
        key: "_hasDetectedGesture",
        value: function() {
          return !(this._state === C || this._state & this._state - 1 || this._state & (u | _ | s) && this._tracked.some(function(S) {
            return S.active;
          }));
        }
      }, {
        key: "_startLongpressTimeout",
        value: function() {
          var S = this;
          this._stopLongpressTimeout(), this._longpressTimeoutId = setTimeout(function() {
            return S._longpressTimeout();
          }, v);
        }
      }, {
        key: "_stopLongpressTimeout",
        value: function() {
          clearTimeout(this._longpressTimeoutId), this._longpressTimeoutId = null;
        }
      }, {
        key: "_longpressTimeout",
        value: function() {
          if (this._hasDetectedGesture())
            throw new Error("A longpress gesture failed, conflict with a different gesture");
          this._state = f, this._pushEvent("gesturestart");
        }
      }, {
        key: "_startTwoTouchTimeout",
        value: function() {
          var S = this;
          this._stopTwoTouchTimeout(), this._twoTouchTimeoutId = setTimeout(function() {
            return S._twoTouchTimeout();
          }, b);
        }
      }, {
        key: "_stopTwoTouchTimeout",
        value: function() {
          clearTimeout(this._twoTouchTimeoutId), this._twoTouchTimeoutId = null;
        }
      }, {
        key: "_isTwoTouchTimeoutRunning",
        value: function() {
          return this._twoTouchTimeoutId !== null;
        }
      }, {
        key: "_twoTouchTimeout",
        value: function() {
          if (this._tracked.length === 0)
            throw new Error("A pinch or two drag gesture failed, no tracked touches");
          var S = this._getAverageMovement(), X = Math.abs(S.x), F = Math.abs(S.y), T = this._getAverageDistance(), Q = Math.abs(Math.hypot(T.first.x, T.first.y) - Math.hypot(T.last.x, T.last.y));
          F < Q && X < Q ? this._state = i : this._state = r, this._pushEvent("gesturestart"), this._pushEvent("gesturemove");
        }
      }, {
        key: "_pushEvent",
        value: function(S) {
          var X = {
            type: this._stateToGesture(this._state)
          }, F = this._getPosition(), T = F.last;
          switch (S === "gesturestart" && (T = F.first), this._state) {
            case r:
            case i:
              T = F.first;
              break;
          }
          if (X.clientX = T.x, X.clientY = T.y, this._state === i) {
            var Q = this._getAverageDistance();
            S === "gesturestart" ? (X.magnitudeX = Q.first.x, X.magnitudeY = Q.first.y) : (X.magnitudeX = Q.last.x, X.magnitudeY = Q.last.y);
          } else if (this._state === r)
            if (S === "gesturestart")
              X.magnitudeX = 0, X.magnitudeY = 0;
            else {
              var D = this._getAverageMovement();
              X.magnitudeX = D.x, X.magnitudeY = D.y;
            }
          var j = new CustomEvent(S, {
            detail: X
          });
          this._target.dispatchEvent(j);
        }
      }, {
        key: "_stateToGesture",
        value: function(S) {
          switch (S) {
            case u:
              return "onetap";
            case _:
              return "twotap";
            case s:
              return "threetap";
            case p:
              return "drag";
            case f:
              return "longpress";
            case r:
              return "twodrag";
            case i:
              return "pinch";
          }
          throw new Error("Unknown gesture state: " + S);
        }
      }, {
        key: "_getPosition",
        value: function() {
          if (this._tracked.length === 0)
            throw new Error("Failed to get gesture position, no tracked touches");
          for (var S = this._tracked.length, X = 0, F = 0, T = 0, Q = 0, D = 0; D < this._tracked.length; D++)
            X += this._tracked[D].firstX, F += this._tracked[D].firstY, T += this._tracked[D].lastX, Q += this._tracked[D].lastY;
          return {
            first: {
              x: X / S,
              y: F / S
            },
            last: {
              x: T / S,
              y: Q / S
            }
          };
        }
      }, {
        key: "_getAverageMovement",
        value: function() {
          if (this._tracked.length === 0)
            throw new Error("Failed to get gesture movement, no tracked touches");
          var S, X;
          S = X = 0;
          for (var F = this._tracked.length, T = 0; T < this._tracked.length; T++)
            S += this._tracked[T].lastX - this._tracked[T].firstX, X += this._tracked[T].lastY - this._tracked[T].firstY;
          return {
            x: S / F,
            y: X / F
          };
        }
      }, {
        key: "_getAverageDistance",
        value: function() {
          if (this._tracked.length === 0)
            throw new Error("Failed to get gesture distance, no tracked touches");
          var S = this._tracked[0], X = this._tracked[this._tracked.length - 1], F = Math.abs(X.firstX - S.firstX), T = Math.abs(X.firstY - S.firstY), Q = Math.abs(X.lastX - S.lastX), D = Math.abs(X.lastY - S.lastY);
          return {
            first: {
              x: F,
              y: T
            },
            last: {
              x: Q,
              y: D
            }
          };
        }
      }]);
    }();
  }(Jt)), Jt;
}
var er = {}, zr;
function Wn() {
  return zr || (zr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = Ct();
    function Y(_) {
      "@babel/helpers - typeof";
      return Y = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(s) {
        return typeof s;
      } : function(s) {
        return s && typeof Symbol == "function" && s.constructor === Symbol && s !== Symbol.prototype ? "symbol" : typeof s;
      }, Y(_);
    }
    function A(_, s) {
      if (!(_ instanceof s)) throw new TypeError("Cannot call a class as a function");
    }
    function K(_, s) {
      for (var p = 0; p < s.length; p++) {
        var f = s[p];
        f.enumerable = f.enumerable || !1, f.configurable = !0, "value" in f && (f.writable = !0), Object.defineProperty(_, L(f.key), f);
      }
    }
    function I(_, s, p) {
      return s && K(_.prototype, s), Object.defineProperty(_, "prototype", { writable: !1 }), _;
    }
    function L(_) {
      var s = C(_, "string");
      return Y(s) == "symbol" ? s : s + "";
    }
    function C(_, s) {
      if (Y(_) != "object" || !_) return _;
      var p = _[Symbol.toPrimitive];
      if (p !== void 0) {
        var f = p.call(_, s);
        if (Y(f) != "object") return f;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(_);
    }
    var u = !h.supportsCursorURIs || h.isTouchDevice;
    P.default = /* @__PURE__ */ function() {
      function _() {
        A(this, _), this._target = null, this._canvas = document.createElement("canvas"), u && (this._canvas.style.position = "fixed", this._canvas.style.zIndex = "65535", this._canvas.style.pointerEvents = "none", this._canvas.style.userSelect = "none", this._canvas.style.WebkitUserSelect = "none", this._canvas.style.visibility = "hidden"), this._position = {
          x: 0,
          y: 0
        }, this._hotSpot = {
          x: 0,
          y: 0
        }, this._eventHandlers = {
          mouseover: this._handleMouseOver.bind(this),
          mouseleave: this._handleMouseLeave.bind(this),
          mousemove: this._handleMouseMove.bind(this),
          mouseup: this._handleMouseUp.bind(this)
        };
      }
      return I(_, [{
        key: "attach",
        value: function(p) {
          if (this._target && this.detach(), this._target = p, u) {
            document.body.appendChild(this._canvas);
            var f = {
              capture: !0,
              passive: !0
            };
            this._target.addEventListener("mouseover", this._eventHandlers.mouseover, f), this._target.addEventListener("mouseleave", this._eventHandlers.mouseleave, f), this._target.addEventListener("mousemove", this._eventHandlers.mousemove, f), this._target.addEventListener("mouseup", this._eventHandlers.mouseup, f);
          }
          this.clear();
        }
      }, {
        key: "detach",
        value: function() {
          if (this._target) {
            if (u) {
              var p = {
                capture: !0,
                passive: !0
              };
              this._target.removeEventListener("mouseover", this._eventHandlers.mouseover, p), this._target.removeEventListener("mouseleave", this._eventHandlers.mouseleave, p), this._target.removeEventListener("mousemove", this._eventHandlers.mousemove, p), this._target.removeEventListener("mouseup", this._eventHandlers.mouseup, p), document.contains(this._canvas) && document.body.removeChild(this._canvas);
            }
            this._target = null;
          }
        }
      }, {
        key: "change",
        value: function(p, f, r, i, l) {
          if (i === 0 || l === 0) {
            this.clear();
            return;
          }
          this._position.x = this._position.x + this._hotSpot.x - f, this._position.y = this._position.y + this._hotSpot.y - r, this._hotSpot.x = f, this._hotSpot.y = r;
          var a = this._canvas.getContext("2d");
          this._canvas.width = i, this._canvas.height = l;
          var n = new ImageData(new Uint8ClampedArray(p), i, l);
          if (a.clearRect(0, 0, i, l), a.putImageData(n, 0, 0), u)
            this._updatePosition();
          else {
            var c = this._canvas.toDataURL();
            this._target.style.cursor = "url(" + c + ")" + f + " " + r + ", default";
          }
        }
      }, {
        key: "clear",
        value: function() {
          this._target.style.cursor = "none", this._canvas.width = 0, this._canvas.height = 0, this._position.x = this._position.x + this._hotSpot.x, this._position.y = this._position.y + this._hotSpot.y, this._hotSpot.x = 0, this._hotSpot.y = 0;
        }
        // Mouse events might be emulated, this allows
        // moving the cursor in such cases
      }, {
        key: "move",
        value: function(p, f) {
          if (u) {
            window.visualViewport ? (this._position.x = p + window.visualViewport.offsetLeft, this._position.y = f + window.visualViewport.offsetTop) : (this._position.x = p, this._position.y = f), this._updatePosition();
            var r = document.elementFromPoint(p, f);
            this._updateVisibility(r);
          }
        }
      }, {
        key: "_handleMouseOver",
        value: function(p) {
          this._handleMouseMove(p);
        }
      }, {
        key: "_handleMouseLeave",
        value: function(p) {
          this._updateVisibility(p.relatedTarget);
        }
      }, {
        key: "_handleMouseMove",
        value: function(p) {
          this._updateVisibility(p.target), this._position.x = p.clientX - this._hotSpot.x, this._position.y = p.clientY - this._hotSpot.y, this._updatePosition();
        }
      }, {
        key: "_handleMouseUp",
        value: function(p) {
          var f = this, r = document.elementFromPoint(p.clientX, p.clientY);
          this._updateVisibility(r), this._captureIsActive() && window.setTimeout(function() {
            f._target && (r = document.elementFromPoint(p.clientX, p.clientY), f._updateVisibility(r));
          }, 0);
        }
      }, {
        key: "_showCursor",
        value: function() {
          this._canvas.style.visibility === "hidden" && (this._canvas.style.visibility = "");
        }
      }, {
        key: "_hideCursor",
        value: function() {
          this._canvas.style.visibility !== "hidden" && (this._canvas.style.visibility = "hidden");
        }
        // Should we currently display the cursor?
        // (i.e. are we over the target, or a child of the target without a
        // different cursor set)
      }, {
        key: "_shouldShowCursor",
        value: function(p) {
          return p ? p === this._target ? !0 : !(!this._target.contains(p) || window.getComputedStyle(p).cursor !== "none") : !1;
        }
      }, {
        key: "_updateVisibility",
        value: function(p) {
          this._captureIsActive() && (p = document.captureElement), this._shouldShowCursor(p) ? this._showCursor() : this._hideCursor();
        }
      }, {
        key: "_updatePosition",
        value: function() {
          this._canvas.style.left = this._position.x + "px", this._canvas.style.top = this._position.y + "px";
        }
      }, {
        key: "_captureIsActive",
        value: function() {
          return document.captureElement && document.documentElement.contains(document.captureElement);
        }
      }]);
    }();
  }(er)), er;
}
var tr = {}, Gr;
function Vn() {
  return Gr || (Gr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = A(ht());
    function Y(v) {
      if (typeof WeakMap != "function") return null;
      var b = /* @__PURE__ */ new WeakMap(), y = /* @__PURE__ */ new WeakMap();
      return (Y = function(S) {
        return S ? y : b;
      })(v);
    }
    function A(v, b) {
      if (v && v.__esModule) return v;
      if (v === null || K(v) != "object" && typeof v != "function") return { default: v };
      var y = Y(b);
      if (y && y.has(v)) return y.get(v);
      var g = { __proto__: null }, S = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var X in v) if (X !== "default" && {}.hasOwnProperty.call(v, X)) {
        var F = S ? Object.getOwnPropertyDescriptor(v, X) : null;
        F && (F.get || F.set) ? Object.defineProperty(g, X, F) : g[X] = v[X];
      }
      return g.default = v, y && y.set(v, g), g;
    }
    function K(v) {
      "@babel/helpers - typeof";
      return K = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(b) {
        return typeof b;
      } : function(b) {
        return b && typeof Symbol == "function" && b.constructor === Symbol && b !== Symbol.prototype ? "symbol" : typeof b;
      }, K(v);
    }
    function I(v) {
      return _(v) || u(v) || C(v) || L();
    }
    function L() {
      throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
    }
    function C(v, b) {
      if (v) {
        if (typeof v == "string") return s(v, b);
        var y = {}.toString.call(v).slice(8, -1);
        return y === "Object" && v.constructor && (y = v.constructor.name), y === "Map" || y === "Set" ? Array.from(v) : y === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(y) ? s(v, b) : void 0;
      }
    }
    function u(v) {
      if (typeof Symbol < "u" && v[Symbol.iterator] != null || v["@@iterator"] != null) return Array.from(v);
    }
    function _(v) {
      if (Array.isArray(v)) return s(v);
    }
    function s(v, b) {
      (b == null || b > v.length) && (b = v.length);
      for (var y = 0, g = Array(b); y < b; y++) g[y] = v[y];
      return g;
    }
    function p(v, b) {
      if (!(v instanceof b)) throw new TypeError("Cannot call a class as a function");
    }
    function f(v, b) {
      for (var y = 0; y < b.length; y++) {
        var g = b[y];
        g.enumerable = g.enumerable || !1, g.configurable = !0, "value" in g && (g.writable = !0), Object.defineProperty(v, i(g.key), g);
      }
    }
    function r(v, b, y) {
      return b && f(v.prototype, b), Object.defineProperty(v, "prototype", { writable: !1 }), v;
    }
    function i(v) {
      var b = l(v, "string");
      return K(b) == "symbol" ? b : b + "";
    }
    function l(v, b) {
      if (K(v) != "object" || !v) return v;
      var y = v[Symbol.toPrimitive];
      if (y !== void 0) {
        var g = y.call(v, b);
        if (K(g) != "object") return g;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(v);
    }
    var a = 40 * 1024 * 1024, n = {
      CONNECTING: "connecting",
      OPEN: "open",
      CLOSING: "closing",
      CLOSED: "closed"
    }, c = {
      CONNECTING: [WebSocket.CONNECTING, n.CONNECTING],
      OPEN: [WebSocket.OPEN, n.OPEN],
      CLOSING: [WebSocket.CLOSING, n.CLOSING],
      CLOSED: [WebSocket.CLOSED, n.CLOSED]
    }, x = ["send", "close", "binaryType", "onerror", "onmessage", "onopen", "protocol", "readyState"];
    P.default = /* @__PURE__ */ function() {
      function v() {
        p(this, v), this._websocket = null, this._rQi = 0, this._rQlen = 0, this._rQbufferSize = 1024 * 1024 * 4, this._rQ = null, this._sQbufferSize = 1024 * 10, this._sQlen = 0, this._sQ = null, this._eventHandlers = {
          message: function() {
          },
          open: function() {
          },
          close: function() {
          },
          error: function() {
          }
        };
      }
      return r(v, [{
        key: "readyState",
        get: function() {
          var y;
          return this._websocket === null ? "unused" : (y = this._websocket.readyState, c.CONNECTING.includes(y) ? "connecting" : c.OPEN.includes(y) ? "open" : c.CLOSING.includes(y) ? "closing" : c.CLOSED.includes(y) ? "closed" : "unknown");
        }
        // Receive Queue
      }, {
        key: "rQpeek8",
        value: function() {
          return this._rQ[this._rQi];
        }
      }, {
        key: "rQskipBytes",
        value: function(y) {
          this._rQi += y;
        }
      }, {
        key: "rQshift8",
        value: function() {
          return this._rQshift(1);
        }
      }, {
        key: "rQshift16",
        value: function() {
          return this._rQshift(2);
        }
      }, {
        key: "rQshift32",
        value: function() {
          return this._rQshift(4);
        }
        // TODO(directxman12): test performance with these vs a DataView
      }, {
        key: "_rQshift",
        value: function(y) {
          for (var g = 0, S = y - 1; S >= 0; S--)
            g += this._rQ[this._rQi++] << S * 8;
          return g >>> 0;
        }
      }, {
        key: "rQshiftStr",
        value: function(y) {
          for (var g = "", S = 0; S < y; S += 4096) {
            var X = this.rQshiftBytes(Math.min(4096, y - S), !1);
            g += String.fromCharCode.apply(null, X);
          }
          return g;
        }
      }, {
        key: "rQshiftBytes",
        value: function(y) {
          var g = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !0;
          return this._rQi += y, g ? this._rQ.slice(this._rQi - y, this._rQi) : this._rQ.subarray(this._rQi - y, this._rQi);
        }
      }, {
        key: "rQshiftTo",
        value: function(y, g) {
          y.set(new Uint8Array(this._rQ.buffer, this._rQi, g)), this._rQi += g;
        }
      }, {
        key: "rQpeekBytes",
        value: function(y) {
          var g = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : !0;
          return g ? this._rQ.slice(this._rQi, this._rQi + y) : this._rQ.subarray(this._rQi, this._rQi + y);
        }
        // Check to see if we must wait for 'num' bytes (default to FBU.bytes)
        // to be available in the receive queue. Return true if we need to
        // wait (and possibly print a debug message), otherwise false.
      }, {
        key: "rQwait",
        value: function(y, g, S) {
          if (this._rQlen - this._rQi < g) {
            if (S) {
              if (this._rQi < S)
                throw new Error("rQwait cannot backup " + S + " bytes");
              this._rQi -= S;
            }
            return !0;
          }
          return !1;
        }
        // Send Queue
      }, {
        key: "sQpush8",
        value: function(y) {
          this._sQensureSpace(1), this._sQ[this._sQlen++] = y;
        }
      }, {
        key: "sQpush16",
        value: function(y) {
          this._sQensureSpace(2), this._sQ[this._sQlen++] = y >> 8 & 255, this._sQ[this._sQlen++] = y >> 0 & 255;
        }
      }, {
        key: "sQpush32",
        value: function(y) {
          this._sQensureSpace(4), this._sQ[this._sQlen++] = y >> 24 & 255, this._sQ[this._sQlen++] = y >> 16 & 255, this._sQ[this._sQlen++] = y >> 8 & 255, this._sQ[this._sQlen++] = y >> 0 & 255;
        }
      }, {
        key: "sQpushString",
        value: function(y) {
          var g = y.split("").map(function(S) {
            return S.charCodeAt(0);
          });
          this.sQpushBytes(new Uint8Array(g));
        }
      }, {
        key: "sQpushBytes",
        value: function(y) {
          for (var g = 0; g < y.length; ) {
            this._sQensureSpace(1);
            var S = this._sQbufferSize - this._sQlen;
            S > y.length - g && (S = y.length - g), this._sQ.set(y.subarray(g, S), this._sQlen), this._sQlen += S, g += S;
          }
        }
      }, {
        key: "flush",
        value: function() {
          this._sQlen > 0 && this.readyState === "open" && (this._websocket.send(new Uint8Array(this._sQ.buffer, 0, this._sQlen)), this._sQlen = 0);
        }
      }, {
        key: "_sQensureSpace",
        value: function(y) {
          this._sQbufferSize - this._sQlen < y && this.flush();
        }
        // Event Handlers
      }, {
        key: "off",
        value: function(y) {
          this._eventHandlers[y] = function() {
          };
        }
      }, {
        key: "on",
        value: function(y, g) {
          this._eventHandlers[y] = g;
        }
      }, {
        key: "_allocateBuffers",
        value: function() {
          this._rQ = new Uint8Array(this._rQbufferSize), this._sQ = new Uint8Array(this._sQbufferSize);
        }
      }, {
        key: "init",
        value: function() {
          this._allocateBuffers(), this._rQi = 0, this._websocket = null;
        }
      }, {
        key: "open",
        value: function(y, g) {
          this.attach(new WebSocket(y, g));
        }
      }, {
        key: "attach",
        value: function(y) {
          var g = this;
          this.init();
          for (var S = [].concat(I(Object.keys(y)), I(Object.getOwnPropertyNames(Object.getPrototypeOf(y)))), X = 0; X < x.length; X++) {
            var F = x[X];
            if (S.indexOf(F) < 0)
              throw new Error("Raw channel missing property: " + F);
          }
          this._websocket = y, this._websocket.binaryType = "arraybuffer", this._websocket.onmessage = this._recvMessage.bind(this), this._websocket.onopen = function() {
            h.Debug(">> WebSock.onopen"), g._websocket.protocol && h.Info("Server choose sub-protocol: " + g._websocket.protocol), g._eventHandlers.open(), h.Debug("<< WebSock.onopen");
          }, this._websocket.onclose = function(T) {
            h.Debug(">> WebSock.onclose"), g._eventHandlers.close(T), h.Debug("<< WebSock.onclose");
          }, this._websocket.onerror = function(T) {
            h.Debug(">> WebSock.onerror: " + T), g._eventHandlers.error(T), h.Debug("<< WebSock.onerror: " + T);
          };
        }
      }, {
        key: "close",
        value: function() {
          this._websocket && ((this.readyState === "connecting" || this.readyState === "open") && (h.Info("Closing WebSocket connection"), this._websocket.close()), this._websocket.onmessage = function() {
          });
        }
        // private methods
        // We want to move all the unread data to the start of the queue,
        // e.g. compacting.
        // The function also expands the receive que if needed, and for
        // performance reasons we combine these two actions to avoid
        // unnecessary copying.
      }, {
        key: "_expandCompactRQ",
        value: function(y) {
          var g = (this._rQlen - this._rQi + y) * 8, S = this._rQbufferSize < g;
          if (S && (this._rQbufferSize = Math.max(this._rQbufferSize * 2, g)), this._rQbufferSize > a && (this._rQbufferSize = a, this._rQbufferSize - (this._rQlen - this._rQi) < y))
            throw new Error("Receive Queue buffer exceeded " + a + " bytes, and the new message could not fit");
          if (S) {
            var X = this._rQ.buffer;
            this._rQ = new Uint8Array(this._rQbufferSize), this._rQ.set(new Uint8Array(X, this._rQi, this._rQlen - this._rQi));
          } else
            this._rQ.copyWithin(0, this._rQi, this._rQlen);
          this._rQlen = this._rQlen - this._rQi, this._rQi = 0;
        }
        // push arraybuffer values onto the end of the receive que
      }, {
        key: "_recvMessage",
        value: function(y) {
          this._rQlen == this._rQi && (this._rQlen = 0, this._rQi = 0);
          var g = new Uint8Array(y.data);
          g.length > this._rQbufferSize - this._rQlen && this._expandCompactRQ(g.length), this._rQ.set(g, this._rQlen), this._rQlen += g.length, this._rQlen - this._rQi > 0 ? this._eventHandlers.message() : h.Debug("Ignoring empty message");
        }
      }]);
    }();
  }(tr)), tr;
}
var rr = {}, qr;
function Zn() {
  return qr || (qr = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0, P.default = {
      Again: 57349,
      /* html:Again (Again) -> linux:129 (KEY_AGAIN) -> atset1:57349 */
      AltLeft: 56,
      /* html:AltLeft (AltLeft) -> linux:56 (KEY_LEFTALT) -> atset1:56 */
      AltRight: 57400,
      /* html:AltRight (AltRight) -> linux:100 (KEY_RIGHTALT) -> atset1:57400 */
      ArrowDown: 57424,
      /* html:ArrowDown (ArrowDown) -> linux:108 (KEY_DOWN) -> atset1:57424 */
      ArrowLeft: 57419,
      /* html:ArrowLeft (ArrowLeft) -> linux:105 (KEY_LEFT) -> atset1:57419 */
      ArrowRight: 57421,
      /* html:ArrowRight (ArrowRight) -> linux:106 (KEY_RIGHT) -> atset1:57421 */
      ArrowUp: 57416,
      /* html:ArrowUp (ArrowUp) -> linux:103 (KEY_UP) -> atset1:57416 */
      AudioVolumeDown: 57390,
      /* html:AudioVolumeDown (AudioVolumeDown) -> linux:114 (KEY_VOLUMEDOWN) -> atset1:57390 */
      AudioVolumeMute: 57376,
      /* html:AudioVolumeMute (AudioVolumeMute) -> linux:113 (KEY_MUTE) -> atset1:57376 */
      AudioVolumeUp: 57392,
      /* html:AudioVolumeUp (AudioVolumeUp) -> linux:115 (KEY_VOLUMEUP) -> atset1:57392 */
      Backquote: 41,
      /* html:Backquote (Backquote) -> linux:41 (KEY_GRAVE) -> atset1:41 */
      Backslash: 43,
      /* html:Backslash (Backslash) -> linux:43 (KEY_BACKSLASH) -> atset1:43 */
      Backspace: 14,
      /* html:Backspace (Backspace) -> linux:14 (KEY_BACKSPACE) -> atset1:14 */
      BracketLeft: 26,
      /* html:BracketLeft (BracketLeft) -> linux:26 (KEY_LEFTBRACE) -> atset1:26 */
      BracketRight: 27,
      /* html:BracketRight (BracketRight) -> linux:27 (KEY_RIGHTBRACE) -> atset1:27 */
      BrowserBack: 57450,
      /* html:BrowserBack (BrowserBack) -> linux:158 (KEY_BACK) -> atset1:57450 */
      BrowserFavorites: 57446,
      /* html:BrowserFavorites (BrowserFavorites) -> linux:156 (KEY_BOOKMARKS) -> atset1:57446 */
      BrowserForward: 57449,
      /* html:BrowserForward (BrowserForward) -> linux:159 (KEY_FORWARD) -> atset1:57449 */
      BrowserHome: 57394,
      /* html:BrowserHome (BrowserHome) -> linux:172 (KEY_HOMEPAGE) -> atset1:57394 */
      BrowserRefresh: 57447,
      /* html:BrowserRefresh (BrowserRefresh) -> linux:173 (KEY_REFRESH) -> atset1:57447 */
      BrowserSearch: 57445,
      /* html:BrowserSearch (BrowserSearch) -> linux:217 (KEY_SEARCH) -> atset1:57445 */
      BrowserStop: 57448,
      /* html:BrowserStop (BrowserStop) -> linux:128 (KEY_STOP) -> atset1:57448 */
      CapsLock: 58,
      /* html:CapsLock (CapsLock) -> linux:58 (KEY_CAPSLOCK) -> atset1:58 */
      Comma: 51,
      /* html:Comma (Comma) -> linux:51 (KEY_COMMA) -> atset1:51 */
      ContextMenu: 57437,
      /* html:ContextMenu (ContextMenu) -> linux:127 (KEY_COMPOSE) -> atset1:57437 */
      ControlLeft: 29,
      /* html:ControlLeft (ControlLeft) -> linux:29 (KEY_LEFTCTRL) -> atset1:29 */
      ControlRight: 57373,
      /* html:ControlRight (ControlRight) -> linux:97 (KEY_RIGHTCTRL) -> atset1:57373 */
      Convert: 121,
      /* html:Convert (Convert) -> linux:92 (KEY_HENKAN) -> atset1:121 */
      Copy: 57464,
      /* html:Copy (Copy) -> linux:133 (KEY_COPY) -> atset1:57464 */
      Cut: 57404,
      /* html:Cut (Cut) -> linux:137 (KEY_CUT) -> atset1:57404 */
      Delete: 57427,
      /* html:Delete (Delete) -> linux:111 (KEY_DELETE) -> atset1:57427 */
      Digit0: 11,
      /* html:Digit0 (Digit0) -> linux:11 (KEY_0) -> atset1:11 */
      Digit1: 2,
      /* html:Digit1 (Digit1) -> linux:2 (KEY_1) -> atset1:2 */
      Digit2: 3,
      /* html:Digit2 (Digit2) -> linux:3 (KEY_2) -> atset1:3 */
      Digit3: 4,
      /* html:Digit3 (Digit3) -> linux:4 (KEY_3) -> atset1:4 */
      Digit4: 5,
      /* html:Digit4 (Digit4) -> linux:5 (KEY_4) -> atset1:5 */
      Digit5: 6,
      /* html:Digit5 (Digit5) -> linux:6 (KEY_5) -> atset1:6 */
      Digit6: 7,
      /* html:Digit6 (Digit6) -> linux:7 (KEY_6) -> atset1:7 */
      Digit7: 8,
      /* html:Digit7 (Digit7) -> linux:8 (KEY_7) -> atset1:8 */
      Digit8: 9,
      /* html:Digit8 (Digit8) -> linux:9 (KEY_8) -> atset1:9 */
      Digit9: 10,
      /* html:Digit9 (Digit9) -> linux:10 (KEY_9) -> atset1:10 */
      Eject: 57469,
      /* html:Eject (Eject) -> linux:162 (KEY_EJECTCLOSECD) -> atset1:57469 */
      End: 57423,
      /* html:End (End) -> linux:107 (KEY_END) -> atset1:57423 */
      Enter: 28,
      /* html:Enter (Enter) -> linux:28 (KEY_ENTER) -> atset1:28 */
      Equal: 13,
      /* html:Equal (Equal) -> linux:13 (KEY_EQUAL) -> atset1:13 */
      Escape: 1,
      /* html:Escape (Escape) -> linux:1 (KEY_ESC) -> atset1:1 */
      F1: 59,
      /* html:F1 (F1) -> linux:59 (KEY_F1) -> atset1:59 */
      F10: 68,
      /* html:F10 (F10) -> linux:68 (KEY_F10) -> atset1:68 */
      F11: 87,
      /* html:F11 (F11) -> linux:87 (KEY_F11) -> atset1:87 */
      F12: 88,
      /* html:F12 (F12) -> linux:88 (KEY_F12) -> atset1:88 */
      F13: 93,
      /* html:F13 (F13) -> linux:183 (KEY_F13) -> atset1:93 */
      F14: 94,
      /* html:F14 (F14) -> linux:184 (KEY_F14) -> atset1:94 */
      F15: 95,
      /* html:F15 (F15) -> linux:185 (KEY_F15) -> atset1:95 */
      F16: 85,
      /* html:F16 (F16) -> linux:186 (KEY_F16) -> atset1:85 */
      F17: 57347,
      /* html:F17 (F17) -> linux:187 (KEY_F17) -> atset1:57347 */
      F18: 57463,
      /* html:F18 (F18) -> linux:188 (KEY_F18) -> atset1:57463 */
      F19: 57348,
      /* html:F19 (F19) -> linux:189 (KEY_F19) -> atset1:57348 */
      F2: 60,
      /* html:F2 (F2) -> linux:60 (KEY_F2) -> atset1:60 */
      F20: 90,
      /* html:F20 (F20) -> linux:190 (KEY_F20) -> atset1:90 */
      F21: 116,
      /* html:F21 (F21) -> linux:191 (KEY_F21) -> atset1:116 */
      F22: 57465,
      /* html:F22 (F22) -> linux:192 (KEY_F22) -> atset1:57465 */
      F23: 109,
      /* html:F23 (F23) -> linux:193 (KEY_F23) -> atset1:109 */
      F24: 111,
      /* html:F24 (F24) -> linux:194 (KEY_F24) -> atset1:111 */
      F3: 61,
      /* html:F3 (F3) -> linux:61 (KEY_F3) -> atset1:61 */
      F4: 62,
      /* html:F4 (F4) -> linux:62 (KEY_F4) -> atset1:62 */
      F5: 63,
      /* html:F5 (F5) -> linux:63 (KEY_F5) -> atset1:63 */
      F6: 64,
      /* html:F6 (F6) -> linux:64 (KEY_F6) -> atset1:64 */
      F7: 65,
      /* html:F7 (F7) -> linux:65 (KEY_F7) -> atset1:65 */
      F8: 66,
      /* html:F8 (F8) -> linux:66 (KEY_F8) -> atset1:66 */
      F9: 67,
      /* html:F9 (F9) -> linux:67 (KEY_F9) -> atset1:67 */
      Find: 57409,
      /* html:Find (Find) -> linux:136 (KEY_FIND) -> atset1:57409 */
      Help: 57461,
      /* html:Help (Help) -> linux:138 (KEY_HELP) -> atset1:57461 */
      Hiragana: 119,
      /* html:Hiragana (Lang4) -> linux:91 (KEY_HIRAGANA) -> atset1:119 */
      Home: 57415,
      /* html:Home (Home) -> linux:102 (KEY_HOME) -> atset1:57415 */
      Insert: 57426,
      /* html:Insert (Insert) -> linux:110 (KEY_INSERT) -> atset1:57426 */
      IntlBackslash: 86,
      /* html:IntlBackslash (IntlBackslash) -> linux:86 (KEY_102ND) -> atset1:86 */
      IntlRo: 115,
      /* html:IntlRo (IntlRo) -> linux:89 (KEY_RO) -> atset1:115 */
      IntlYen: 125,
      /* html:IntlYen (IntlYen) -> linux:124 (KEY_YEN) -> atset1:125 */
      KanaMode: 112,
      /* html:KanaMode (KanaMode) -> linux:93 (KEY_KATAKANAHIRAGANA) -> atset1:112 */
      Katakana: 120,
      /* html:Katakana (Lang3) -> linux:90 (KEY_KATAKANA) -> atset1:120 */
      KeyA: 30,
      /* html:KeyA (KeyA) -> linux:30 (KEY_A) -> atset1:30 */
      KeyB: 48,
      /* html:KeyB (KeyB) -> linux:48 (KEY_B) -> atset1:48 */
      KeyC: 46,
      /* html:KeyC (KeyC) -> linux:46 (KEY_C) -> atset1:46 */
      KeyD: 32,
      /* html:KeyD (KeyD) -> linux:32 (KEY_D) -> atset1:32 */
      KeyE: 18,
      /* html:KeyE (KeyE) -> linux:18 (KEY_E) -> atset1:18 */
      KeyF: 33,
      /* html:KeyF (KeyF) -> linux:33 (KEY_F) -> atset1:33 */
      KeyG: 34,
      /* html:KeyG (KeyG) -> linux:34 (KEY_G) -> atset1:34 */
      KeyH: 35,
      /* html:KeyH (KeyH) -> linux:35 (KEY_H) -> atset1:35 */
      KeyI: 23,
      /* html:KeyI (KeyI) -> linux:23 (KEY_I) -> atset1:23 */
      KeyJ: 36,
      /* html:KeyJ (KeyJ) -> linux:36 (KEY_J) -> atset1:36 */
      KeyK: 37,
      /* html:KeyK (KeyK) -> linux:37 (KEY_K) -> atset1:37 */
      KeyL: 38,
      /* html:KeyL (KeyL) -> linux:38 (KEY_L) -> atset1:38 */
      KeyM: 50,
      /* html:KeyM (KeyM) -> linux:50 (KEY_M) -> atset1:50 */
      KeyN: 49,
      /* html:KeyN (KeyN) -> linux:49 (KEY_N) -> atset1:49 */
      KeyO: 24,
      /* html:KeyO (KeyO) -> linux:24 (KEY_O) -> atset1:24 */
      KeyP: 25,
      /* html:KeyP (KeyP) -> linux:25 (KEY_P) -> atset1:25 */
      KeyQ: 16,
      /* html:KeyQ (KeyQ) -> linux:16 (KEY_Q) -> atset1:16 */
      KeyR: 19,
      /* html:KeyR (KeyR) -> linux:19 (KEY_R) -> atset1:19 */
      KeyS: 31,
      /* html:KeyS (KeyS) -> linux:31 (KEY_S) -> atset1:31 */
      KeyT: 20,
      /* html:KeyT (KeyT) -> linux:20 (KEY_T) -> atset1:20 */
      KeyU: 22,
      /* html:KeyU (KeyU) -> linux:22 (KEY_U) -> atset1:22 */
      KeyV: 47,
      /* html:KeyV (KeyV) -> linux:47 (KEY_V) -> atset1:47 */
      KeyW: 17,
      /* html:KeyW (KeyW) -> linux:17 (KEY_W) -> atset1:17 */
      KeyX: 45,
      /* html:KeyX (KeyX) -> linux:45 (KEY_X) -> atset1:45 */
      KeyY: 21,
      /* html:KeyY (KeyY) -> linux:21 (KEY_Y) -> atset1:21 */
      KeyZ: 44,
      /* html:KeyZ (KeyZ) -> linux:44 (KEY_Z) -> atset1:44 */
      Lang1: 114,
      /* html:Lang1 (Lang1) -> linux:122 (KEY_HANGEUL) -> atset1:114 */
      Lang2: 113,
      /* html:Lang2 (Lang2) -> linux:123 (KEY_HANJA) -> atset1:113 */
      Lang3: 120,
      /* html:Lang3 (Lang3) -> linux:90 (KEY_KATAKANA) -> atset1:120 */
      Lang4: 119,
      /* html:Lang4 (Lang4) -> linux:91 (KEY_HIRAGANA) -> atset1:119 */
      Lang5: 118,
      /* html:Lang5 (Lang5) -> linux:85 (KEY_ZENKAKUHANKAKU) -> atset1:118 */
      LaunchApp1: 57451,
      /* html:LaunchApp1 (LaunchApp1) -> linux:157 (KEY_COMPUTER) -> atset1:57451 */
      LaunchApp2: 57377,
      /* html:LaunchApp2 (LaunchApp2) -> linux:140 (KEY_CALC) -> atset1:57377 */
      LaunchMail: 57452,
      /* html:LaunchMail (LaunchMail) -> linux:155 (KEY_MAIL) -> atset1:57452 */
      MediaPlayPause: 57378,
      /* html:MediaPlayPause (MediaPlayPause) -> linux:164 (KEY_PLAYPAUSE) -> atset1:57378 */
      MediaSelect: 57453,
      /* html:MediaSelect (MediaSelect) -> linux:226 (KEY_MEDIA) -> atset1:57453 */
      MediaStop: 57380,
      /* html:MediaStop (MediaStop) -> linux:166 (KEY_STOPCD) -> atset1:57380 */
      MediaTrackNext: 57369,
      /* html:MediaTrackNext (MediaTrackNext) -> linux:163 (KEY_NEXTSONG) -> atset1:57369 */
      MediaTrackPrevious: 57360,
      /* html:MediaTrackPrevious (MediaTrackPrevious) -> linux:165 (KEY_PREVIOUSSONG) -> atset1:57360 */
      MetaLeft: 57435,
      /* html:MetaLeft (MetaLeft) -> linux:125 (KEY_LEFTMETA) -> atset1:57435 */
      MetaRight: 57436,
      /* html:MetaRight (MetaRight) -> linux:126 (KEY_RIGHTMETA) -> atset1:57436 */
      Minus: 12,
      /* html:Minus (Minus) -> linux:12 (KEY_MINUS) -> atset1:12 */
      NonConvert: 123,
      /* html:NonConvert (NonConvert) -> linux:94 (KEY_MUHENKAN) -> atset1:123 */
      NumLock: 69,
      /* html:NumLock (NumLock) -> linux:69 (KEY_NUMLOCK) -> atset1:69 */
      Numpad0: 82,
      /* html:Numpad0 (Numpad0) -> linux:82 (KEY_KP0) -> atset1:82 */
      Numpad1: 79,
      /* html:Numpad1 (Numpad1) -> linux:79 (KEY_KP1) -> atset1:79 */
      Numpad2: 80,
      /* html:Numpad2 (Numpad2) -> linux:80 (KEY_KP2) -> atset1:80 */
      Numpad3: 81,
      /* html:Numpad3 (Numpad3) -> linux:81 (KEY_KP3) -> atset1:81 */
      Numpad4: 75,
      /* html:Numpad4 (Numpad4) -> linux:75 (KEY_KP4) -> atset1:75 */
      Numpad5: 76,
      /* html:Numpad5 (Numpad5) -> linux:76 (KEY_KP5) -> atset1:76 */
      Numpad6: 77,
      /* html:Numpad6 (Numpad6) -> linux:77 (KEY_KP6) -> atset1:77 */
      Numpad7: 71,
      /* html:Numpad7 (Numpad7) -> linux:71 (KEY_KP7) -> atset1:71 */
      Numpad8: 72,
      /* html:Numpad8 (Numpad8) -> linux:72 (KEY_KP8) -> atset1:72 */
      Numpad9: 73,
      /* html:Numpad9 (Numpad9) -> linux:73 (KEY_KP9) -> atset1:73 */
      NumpadAdd: 78,
      /* html:NumpadAdd (NumpadAdd) -> linux:78 (KEY_KPPLUS) -> atset1:78 */
      NumpadComma: 126,
      /* html:NumpadComma (NumpadComma) -> linux:121 (KEY_KPCOMMA) -> atset1:126 */
      NumpadDecimal: 83,
      /* html:NumpadDecimal (NumpadDecimal) -> linux:83 (KEY_KPDOT) -> atset1:83 */
      NumpadDivide: 57397,
      /* html:NumpadDivide (NumpadDivide) -> linux:98 (KEY_KPSLASH) -> atset1:57397 */
      NumpadEnter: 57372,
      /* html:NumpadEnter (NumpadEnter) -> linux:96 (KEY_KPENTER) -> atset1:57372 */
      NumpadEqual: 89,
      /* html:NumpadEqual (NumpadEqual) -> linux:117 (KEY_KPEQUAL) -> atset1:89 */
      NumpadMultiply: 55,
      /* html:NumpadMultiply (NumpadMultiply) -> linux:55 (KEY_KPASTERISK) -> atset1:55 */
      NumpadParenLeft: 57462,
      /* html:NumpadParenLeft (NumpadParenLeft) -> linux:179 (KEY_KPLEFTPAREN) -> atset1:57462 */
      NumpadParenRight: 57467,
      /* html:NumpadParenRight (NumpadParenRight) -> linux:180 (KEY_KPRIGHTPAREN) -> atset1:57467 */
      NumpadSubtract: 74,
      /* html:NumpadSubtract (NumpadSubtract) -> linux:74 (KEY_KPMINUS) -> atset1:74 */
      Open: 100,
      /* html:Open (Open) -> linux:134 (KEY_OPEN) -> atset1:100 */
      PageDown: 57425,
      /* html:PageDown (PageDown) -> linux:109 (KEY_PAGEDOWN) -> atset1:57425 */
      PageUp: 57417,
      /* html:PageUp (PageUp) -> linux:104 (KEY_PAGEUP) -> atset1:57417 */
      Paste: 101,
      /* html:Paste (Paste) -> linux:135 (KEY_PASTE) -> atset1:101 */
      Pause: 57414,
      /* html:Pause (Pause) -> linux:119 (KEY_PAUSE) -> atset1:57414 */
      Period: 52,
      /* html:Period (Period) -> linux:52 (KEY_DOT) -> atset1:52 */
      Power: 57438,
      /* html:Power (Power) -> linux:116 (KEY_POWER) -> atset1:57438 */
      PrintScreen: 84,
      /* html:PrintScreen (PrintScreen) -> linux:99 (KEY_SYSRQ) -> atset1:84 */
      Props: 57350,
      /* html:Props (Props) -> linux:130 (KEY_PROPS) -> atset1:57350 */
      Quote: 40,
      /* html:Quote (Quote) -> linux:40 (KEY_APOSTROPHE) -> atset1:40 */
      ScrollLock: 70,
      /* html:ScrollLock (ScrollLock) -> linux:70 (KEY_SCROLLLOCK) -> atset1:70 */
      Semicolon: 39,
      /* html:Semicolon (Semicolon) -> linux:39 (KEY_SEMICOLON) -> atset1:39 */
      ShiftLeft: 42,
      /* html:ShiftLeft (ShiftLeft) -> linux:42 (KEY_LEFTSHIFT) -> atset1:42 */
      ShiftRight: 54,
      /* html:ShiftRight (ShiftRight) -> linux:54 (KEY_RIGHTSHIFT) -> atset1:54 */
      Slash: 53,
      /* html:Slash (Slash) -> linux:53 (KEY_SLASH) -> atset1:53 */
      Sleep: 57439,
      /* html:Sleep (Sleep) -> linux:142 (KEY_SLEEP) -> atset1:57439 */
      Space: 57,
      /* html:Space (Space) -> linux:57 (KEY_SPACE) -> atset1:57 */
      Suspend: 57381,
      /* html:Suspend (Suspend) -> linux:205 (KEY_SUSPEND) -> atset1:57381 */
      Tab: 15,
      /* html:Tab (Tab) -> linux:15 (KEY_TAB) -> atset1:15 */
      Undo: 57351,
      /* html:Undo (Undo) -> linux:131 (KEY_UNDO) -> atset1:57351 */
      WakeUp: 57443
      /* html:WakeUp (WakeUp) -> linux:143 (KEY_WAKEUP) -> atset1:57443 */
    };
  }(rr)), rr;
}
var gt = {}, Wr;
function Yn() {
  if (Wr) return gt;
  Wr = 1, Object.defineProperty(gt, "__esModule", {
    value: !0
  }), gt.encodingName = h, gt.encodings = void 0;
  var P = gt.encodings = {
    encodingRaw: 0,
    encodingCopyRect: 1,
    encodingRRE: 2,
    encodingHextile: 5,
    encodingTight: 7,
    encodingZRLE: 16,
    encodingTightPNG: -260,
    encodingJPEG: 21,
    pseudoEncodingQualityLevel9: -23,
    pseudoEncodingQualityLevel0: -32,
    pseudoEncodingDesktopSize: -223,
    pseudoEncodingLastRect: -224,
    pseudoEncodingCursor: -239,
    pseudoEncodingQEMUExtendedKeyEvent: -258,
    pseudoEncodingQEMULedEvent: -261,
    pseudoEncodingDesktopName: -307,
    pseudoEncodingExtendedDesktopSize: -308,
    pseudoEncodingXvp: -309,
    pseudoEncodingFence: -312,
    pseudoEncodingContinuousUpdates: -313,
    pseudoEncodingCompressLevel9: -247,
    pseudoEncodingCompressLevel0: -256,
    pseudoEncodingVMwareCursor: 1464686180,
    pseudoEncodingExtendedClipboard: 3231835598
  };
  function h(Y) {
    switch (Y) {
      case P.encodingRaw:
        return "Raw";
      case P.encodingCopyRect:
        return "CopyRect";
      case P.encodingRRE:
        return "RRE";
      case P.encodingHextile:
        return "Hextile";
      case P.encodingTight:
        return "Tight";
      case P.encodingZRLE:
        return "ZRLE";
      case P.encodingTightPNG:
        return "TightPNG";
      case P.encodingJPEG:
        return "JPEG";
      default:
        return "[unknown encoding " + Y + "]";
    }
  }
  return gt;
}
var nr = {}, ir = {}, vt = {}, Vr;
function $n() {
  if (Vr) return vt;
  Vr = 1, Object.defineProperty(vt, "__esModule", {
    value: !0
  }), vt.AESECBCipher = vt.AESEAXCipher = void 0;
  function P(_) {
    "@babel/helpers - typeof";
    return P = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(s) {
      return typeof s;
    } : function(s) {
      return s && typeof Symbol == "function" && s.constructor === Symbol && s !== Symbol.prototype ? "symbol" : typeof s;
    }, P(_);
  }
  function h() {
    /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */
    h = function() {
      return s;
    };
    var _, s = {}, p = Object.prototype, f = p.hasOwnProperty, r = Object.defineProperty || function(J, $, re) {
      J[$] = re.value;
    }, i = typeof Symbol == "function" ? Symbol : {}, l = i.iterator || "@@iterator", a = i.asyncIterator || "@@asyncIterator", n = i.toStringTag || "@@toStringTag";
    function c(J, $, re) {
      return Object.defineProperty(J, $, { value: re, enumerable: !0, configurable: !0, writable: !0 }), J[$];
    }
    try {
      c({}, "");
    } catch {
      c = function(re, z, B) {
        return re[z] = B;
      };
    }
    function x(J, $, re, z) {
      var B = $ && $.prototype instanceof F ? $ : F, U = Object.create(B.prototype), ue = new Ce(z || []);
      return r(U, "_invoke", { value: we(J, re, ue) }), U;
    }
    function v(J, $, re) {
      try {
        return { type: "normal", arg: J.call($, re) };
      } catch (z) {
        return { type: "throw", arg: z };
      }
    }
    s.wrap = x;
    var b = "suspendedStart", y = "suspendedYield", g = "executing", S = "completed", X = {};
    function F() {
    }
    function T() {
    }
    function Q() {
    }
    var D = {};
    c(D, l, function() {
      return this;
    });
    var j = Object.getPrototypeOf, te = j && j(j(Oe([])));
    te && te !== p && f.call(te, l) && (D = te);
    var he = Q.prototype = F.prototype = Object.create(D);
    function ge(J) {
      ["next", "throw", "return"].forEach(function($) {
        c(J, $, function(re) {
          return this._invoke($, re);
        });
      });
    }
    function pe(J, $) {
      function re(B, U, ue, le) {
        var H = v(J[B], J, U);
        if (H.type !== "throw") {
          var q = H.arg, ee = q.value;
          return ee && P(ee) == "object" && f.call(ee, "__await") ? $.resolve(ee.__await).then(function(ie) {
            re("next", ie, ue, le);
          }, function(ie) {
            re("throw", ie, ue, le);
          }) : $.resolve(ee).then(function(ie) {
            q.value = ie, ue(q);
          }, function(ie) {
            return re("throw", ie, ue, le);
          });
        }
        le(H.arg);
      }
      var z;
      r(this, "_invoke", { value: function(U, ue) {
        function le() {
          return new $(function(H, q) {
            re(U, ue, H, q);
          });
        }
        return z = z ? z.then(le, le) : le();
      } });
    }
    function we(J, $, re) {
      var z = b;
      return function(B, U) {
        if (z === g) throw Error("Generator is already running");
        if (z === S) {
          if (B === "throw") throw U;
          return { value: _, done: !0 };
        }
        for (re.method = B, re.arg = U; ; ) {
          var ue = re.delegate;
          if (ue) {
            var le = Ae(ue, re);
            if (le) {
              if (le === X) continue;
              return le;
            }
          }
          if (re.method === "next") re.sent = re._sent = re.arg;
          else if (re.method === "throw") {
            if (z === b) throw z = S, re.arg;
            re.dispatchException(re.arg);
          } else re.method === "return" && re.abrupt("return", re.arg);
          z = g;
          var H = v(J, $, re);
          if (H.type === "normal") {
            if (z = re.done ? S : y, H.arg === X) continue;
            return { value: H.arg, done: re.done };
          }
          H.type === "throw" && (z = S, re.method = "throw", re.arg = H.arg);
        }
      };
    }
    function Ae(J, $) {
      var re = $.method, z = J.iterator[re];
      if (z === _) return $.delegate = null, re === "throw" && J.iterator.return && ($.method = "return", $.arg = _, Ae(J, $), $.method === "throw") || re !== "return" && ($.method = "throw", $.arg = new TypeError("The iterator does not provide a '" + re + "' method")), X;
      var B = v(z, J.iterator, $.arg);
      if (B.type === "throw") return $.method = "throw", $.arg = B.arg, $.delegate = null, X;
      var U = B.arg;
      return U ? U.done ? ($[J.resultName] = U.value, $.next = J.nextLoc, $.method !== "return" && ($.method = "next", $.arg = _), $.delegate = null, X) : U : ($.method = "throw", $.arg = new TypeError("iterator result is not an object"), $.delegate = null, X);
    }
    function de(J) {
      var $ = { tryLoc: J[0] };
      1 in J && ($.catchLoc = J[1]), 2 in J && ($.finallyLoc = J[2], $.afterLoc = J[3]), this.tryEntries.push($);
    }
    function ke(J) {
      var $ = J.completion || {};
      $.type = "normal", delete $.arg, J.completion = $;
    }
    function Ce(J) {
      this.tryEntries = [{ tryLoc: "root" }], J.forEach(de, this), this.reset(!0);
    }
    function Oe(J) {
      if (J || J === "") {
        var $ = J[l];
        if ($) return $.call(J);
        if (typeof J.next == "function") return J;
        if (!isNaN(J.length)) {
          var re = -1, z = function B() {
            for (; ++re < J.length; ) if (f.call(J, re)) return B.value = J[re], B.done = !1, B;
            return B.value = _, B.done = !0, B;
          };
          return z.next = z;
        }
      }
      throw new TypeError(P(J) + " is not iterable");
    }
    return T.prototype = Q, r(he, "constructor", { value: Q, configurable: !0 }), r(Q, "constructor", { value: T, configurable: !0 }), T.displayName = c(Q, n, "GeneratorFunction"), s.isGeneratorFunction = function(J) {
      var $ = typeof J == "function" && J.constructor;
      return !!$ && ($ === T || ($.displayName || $.name) === "GeneratorFunction");
    }, s.mark = function(J) {
      return Object.setPrototypeOf ? Object.setPrototypeOf(J, Q) : (J.__proto__ = Q, c(J, n, "GeneratorFunction")), J.prototype = Object.create(he), J;
    }, s.awrap = function(J) {
      return { __await: J };
    }, ge(pe.prototype), c(pe.prototype, a, function() {
      return this;
    }), s.AsyncIterator = pe, s.async = function(J, $, re, z, B) {
      B === void 0 && (B = Promise);
      var U = new pe(x(J, $, re, z), B);
      return s.isGeneratorFunction($) ? U : U.next().then(function(ue) {
        return ue.done ? ue.value : U.next();
      });
    }, ge(he), c(he, n, "Generator"), c(he, l, function() {
      return this;
    }), c(he, "toString", function() {
      return "[object Generator]";
    }), s.keys = function(J) {
      var $ = Object(J), re = [];
      for (var z in $) re.push(z);
      return re.reverse(), function B() {
        for (; re.length; ) {
          var U = re.pop();
          if (U in $) return B.value = U, B.done = !1, B;
        }
        return B.done = !0, B;
      };
    }, s.values = Oe, Ce.prototype = { constructor: Ce, reset: function($) {
      if (this.prev = 0, this.next = 0, this.sent = this._sent = _, this.done = !1, this.delegate = null, this.method = "next", this.arg = _, this.tryEntries.forEach(ke), !$) for (var re in this) re.charAt(0) === "t" && f.call(this, re) && !isNaN(+re.slice(1)) && (this[re] = _);
    }, stop: function() {
      this.done = !0;
      var $ = this.tryEntries[0].completion;
      if ($.type === "throw") throw $.arg;
      return this.rval;
    }, dispatchException: function($) {
      if (this.done) throw $;
      var re = this;
      function z(q, ee) {
        return ue.type = "throw", ue.arg = $, re.next = q, ee && (re.method = "next", re.arg = _), !!ee;
      }
      for (var B = this.tryEntries.length - 1; B >= 0; --B) {
        var U = this.tryEntries[B], ue = U.completion;
        if (U.tryLoc === "root") return z("end");
        if (U.tryLoc <= this.prev) {
          var le = f.call(U, "catchLoc"), H = f.call(U, "finallyLoc");
          if (le && H) {
            if (this.prev < U.catchLoc) return z(U.catchLoc, !0);
            if (this.prev < U.finallyLoc) return z(U.finallyLoc);
          } else if (le) {
            if (this.prev < U.catchLoc) return z(U.catchLoc, !0);
          } else {
            if (!H) throw Error("try statement without catch or finally");
            if (this.prev < U.finallyLoc) return z(U.finallyLoc);
          }
        }
      }
    }, abrupt: function($, re) {
      for (var z = this.tryEntries.length - 1; z >= 0; --z) {
        var B = this.tryEntries[z];
        if (B.tryLoc <= this.prev && f.call(B, "finallyLoc") && this.prev < B.finallyLoc) {
          var U = B;
          break;
        }
      }
      U && ($ === "break" || $ === "continue") && U.tryLoc <= re && re <= U.finallyLoc && (U = null);
      var ue = U ? U.completion : {};
      return ue.type = $, ue.arg = re, U ? (this.method = "next", this.next = U.finallyLoc, X) : this.complete(ue);
    }, complete: function($, re) {
      if ($.type === "throw") throw $.arg;
      return $.type === "break" || $.type === "continue" ? this.next = $.arg : $.type === "return" ? (this.rval = this.arg = $.arg, this.method = "return", this.next = "end") : $.type === "normal" && re && (this.next = re), X;
    }, finish: function($) {
      for (var re = this.tryEntries.length - 1; re >= 0; --re) {
        var z = this.tryEntries[re];
        if (z.finallyLoc === $) return this.complete(z.completion, z.afterLoc), ke(z), X;
      }
    }, catch: function($) {
      for (var re = this.tryEntries.length - 1; re >= 0; --re) {
        var z = this.tryEntries[re];
        if (z.tryLoc === $) {
          var B = z.completion;
          if (B.type === "throw") {
            var U = B.arg;
            ke(z);
          }
          return U;
        }
      }
      throw Error("illegal catch attempt");
    }, delegateYield: function($, re, z) {
      return this.delegate = { iterator: Oe($), resultName: re, nextLoc: z }, this.method === "next" && (this.arg = _), X;
    } }, s;
  }
  function Y(_, s, p, f, r, i, l) {
    try {
      var a = _[i](l), n = a.value;
    } catch (c) {
      return void p(c);
    }
    a.done ? s(n) : Promise.resolve(n).then(f, r);
  }
  function A(_) {
    return function() {
      var s = this, p = arguments;
      return new Promise(function(f, r) {
        var i = _.apply(s, p);
        function l(n) {
          Y(i, f, r, l, a, "next", n);
        }
        function a(n) {
          Y(i, f, r, l, a, "throw", n);
        }
        l(void 0);
      });
    };
  }
  function K(_, s) {
    if (!(_ instanceof s)) throw new TypeError("Cannot call a class as a function");
  }
  function I(_, s) {
    for (var p = 0; p < s.length; p++) {
      var f = s[p];
      f.enumerable = f.enumerable || !1, f.configurable = !0, "value" in f && (f.writable = !0), Object.defineProperty(_, C(f.key), f);
    }
  }
  function L(_, s, p) {
    return s && I(_.prototype, s), p && I(_, p), Object.defineProperty(_, "prototype", { writable: !1 }), _;
  }
  function C(_) {
    var s = u(_, "string");
    return P(s) == "symbol" ? s : s + "";
  }
  function u(_, s) {
    if (P(_) != "object" || !_) return _;
    var p = _[Symbol.toPrimitive];
    if (p !== void 0) {
      var f = p.call(_, s);
      if (P(f) != "object") return f;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return String(_);
  }
  return vt.AESECBCipher = /* @__PURE__ */ function() {
    function _() {
      K(this, _), this._key = null;
    }
    return L(_, [{
      key: "algorithm",
      get: function() {
        return {
          name: "AES-ECB"
        };
      }
    }, {
      key: "_importKey",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i, l) {
          return h().wrap(function(n) {
            for (; ; ) switch (n.prev = n.next) {
              case 0:
                return n.next = 2, window.crypto.subtle.importKey("raw", r, {
                  name: "AES-CBC"
                }, i, l);
              case 2:
                this._key = n.sent;
              case 3:
              case "end":
                return n.stop();
            }
          }, f, this);
        }));
        function p(f, r, i) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }, {
      key: "encrypt",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i) {
          var l, a, n, c;
          return h().wrap(function(v) {
            for (; ; ) switch (v.prev = v.next) {
              case 0:
                if (l = new Uint8Array(i), !(l.length % 16 !== 0 || this._key === null)) {
                  v.next = 3;
                  break;
                }
                return v.abrupt("return", null);
              case 3:
                a = l.length / 16, n = 0;
              case 5:
                if (!(n < a)) {
                  v.next = 15;
                  break;
                }
                return v.t0 = Uint8Array, v.next = 9, window.crypto.subtle.encrypt({
                  name: "AES-CBC",
                  iv: new Uint8Array(16)
                }, this._key, l.slice(n * 16, n * 16 + 16));
              case 9:
                v.t1 = v.sent, c = new v.t0(v.t1).slice(0, 16), l.set(c, n * 16);
              case 12:
                n++, v.next = 5;
                break;
              case 15:
                return v.abrupt("return", l);
              case 16:
              case "end":
                return v.stop();
            }
          }, f, this);
        }));
        function p(f, r) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }], [{
      key: "importKey",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i, l, a) {
          var n;
          return h().wrap(function(x) {
            for (; ; ) switch (x.prev = x.next) {
              case 0:
                return n = new _(), x.next = 3, n._importKey(r, l, a);
              case 3:
                return x.abrupt("return", n);
              case 4:
              case "end":
                return x.stop();
            }
          }, f);
        }));
        function p(f, r, i, l) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }]);
  }(), vt.AESEAXCipher = /* @__PURE__ */ function() {
    function _() {
      K(this, _), this._rawKey = null, this._ctrKey = null, this._cbcKey = null, this._zeroBlock = new Uint8Array(16), this._prefixBlock0 = this._zeroBlock, this._prefixBlock1 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), this._prefixBlock2 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    }
    return L(_, [{
      key: "algorithm",
      get: function() {
        return {
          name: "AES-EAX"
        };
      }
    }, {
      key: "_encryptBlock",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r) {
          var i;
          return h().wrap(function(a) {
            for (; ; ) switch (a.prev = a.next) {
              case 0:
                return a.next = 2, window.crypto.subtle.encrypt({
                  name: "AES-CBC",
                  iv: this._zeroBlock
                }, this._cbcKey, r);
              case 2:
                return i = a.sent, a.abrupt("return", new Uint8Array(i).slice(0, 16));
              case 4:
              case "end":
                return a.stop();
            }
          }, f, this);
        }));
        function p(f) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }, {
      key: "_initCMAC",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f() {
          var r, i, l, a, n;
          return h().wrap(function(x) {
            for (; ; ) switch (x.prev = x.next) {
              case 0:
                return x.next = 2, this._encryptBlock(this._zeroBlock);
              case 2:
                for (r = x.sent, i = new Uint8Array(16), l = r[0] >>> 6, a = 0; a < 15; a++)
                  i[a] = r[a + 1] >> 6 | r[a] << 2, r[a] = r[a + 1] >> 7 | r[a] << 1;
                n = [0, 135, 14, 137], i[14] ^= l >>> 1, i[15] = r[15] << 2 ^ n[l], r[15] = r[15] << 1 ^ n[l >> 1], this._k1 = r, this._k2 = i;
              case 12:
              case "end":
                return x.stop();
            }
          }, f, this);
        }));
        function p() {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }, {
      key: "_encryptCTR",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i) {
          var l;
          return h().wrap(function(n) {
            for (; ; ) switch (n.prev = n.next) {
              case 0:
                return n.next = 2, window.crypto.subtle.encrypt({
                  name: "AES-CTR",
                  counter: i,
                  length: 128
                }, this._ctrKey, r);
              case 2:
                return l = n.sent, n.abrupt("return", new Uint8Array(l));
              case 4:
              case "end":
                return n.stop();
            }
          }, f, this);
        }));
        function p(f, r) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }, {
      key: "_decryptCTR",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i) {
          var l;
          return h().wrap(function(n) {
            for (; ; ) switch (n.prev = n.next) {
              case 0:
                return n.next = 2, window.crypto.subtle.decrypt({
                  name: "AES-CTR",
                  counter: i,
                  length: 128
                }, this._ctrKey, r);
              case 2:
                return l = n.sent, n.abrupt("return", new Uint8Array(l));
              case 4:
              case "end":
                return n.stop();
            }
          }, f, this);
        }));
        function p(f, r) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }, {
      key: "_computeCMAC",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i) {
          var l, a, n, c, x, v, b, y;
          return h().wrap(function(S) {
            for (; ; ) switch (S.prev = S.next) {
              case 0:
                if (i.length === 16) {
                  S.next = 2;
                  break;
                }
                return S.abrupt("return", null);
              case 2:
                if (l = Math.floor(r.length / 16), a = Math.ceil(r.length / 16), n = r.length - l * 16, c = new Uint8Array((a + 1) * 16), c.set(i), c.set(r, 16), n === 0)
                  for (x = 0; x < 16; x++)
                    c[l * 16 + x] ^= this._k1[x];
                else
                  for (c[(l + 1) * 16 + n] = 128, v = 0; v < 16; v++)
                    c[(l + 1) * 16 + v] ^= this._k2[v];
                return S.next = 11, window.crypto.subtle.encrypt({
                  name: "AES-CBC",
                  iv: this._zeroBlock
                }, this._cbcKey, c);
              case 11:
                return b = S.sent, b = new Uint8Array(b), y = b.slice(b.length - 32, b.length - 16), S.abrupt("return", y);
              case 15:
              case "end":
                return S.stop();
            }
          }, f, this);
        }));
        function p(f, r) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }, {
      key: "_importKey",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r) {
          return h().wrap(function(l) {
            for (; ; ) switch (l.prev = l.next) {
              case 0:
                return this._rawKey = r, l.next = 3, window.crypto.subtle.importKey("raw", r, {
                  name: "AES-CTR"
                }, !1, ["encrypt", "decrypt"]);
              case 3:
                return this._ctrKey = l.sent, l.next = 6, window.crypto.subtle.importKey("raw", r, {
                  name: "AES-CBC"
                }, !1, ["encrypt"]);
              case 6:
                return this._cbcKey = l.sent, l.next = 9, this._initCMAC();
              case 9:
              case "end":
                return l.stop();
            }
          }, f, this);
        }));
        function p(f) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }, {
      key: "encrypt",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i) {
          var l, a, n, c, x, v, b, y;
          return h().wrap(function(S) {
            for (; ; ) switch (S.prev = S.next) {
              case 0:
                return l = r.additionalData, a = r.iv, S.next = 4, this._computeCMAC(a, this._prefixBlock0);
              case 4:
                return n = S.sent, S.next = 7, this._encryptCTR(i, n);
              case 7:
                return c = S.sent, S.next = 10, this._computeCMAC(l, this._prefixBlock1);
              case 10:
                return x = S.sent, S.next = 13, this._computeCMAC(c, this._prefixBlock2);
              case 13:
                for (v = S.sent, b = 0; b < 16; b++)
                  v[b] ^= n[b] ^ x[b];
                return y = new Uint8Array(16 + c.length), y.set(c), y.set(v, c.length), S.abrupt("return", y);
              case 19:
              case "end":
                return S.stop();
            }
          }, f, this);
        }));
        function p(f, r) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }, {
      key: "decrypt",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i) {
          var l, a, n, c, x, v, b, y, g, S;
          return h().wrap(function(F) {
            for (; ; ) switch (F.prev = F.next) {
              case 0:
                return l = i.slice(0, i.length - 16), a = r.additionalData, n = r.iv, c = i.slice(i.length - 16), F.next = 6, this._computeCMAC(n, this._prefixBlock0);
              case 6:
                return x = F.sent, F.next = 9, this._computeCMAC(a, this._prefixBlock1);
              case 9:
                return v = F.sent, F.next = 12, this._computeCMAC(l, this._prefixBlock2);
              case 12:
                for (b = F.sent, y = 0; y < 16; y++)
                  b[y] ^= x[y] ^ v[y];
                if (b.length === c.length) {
                  F.next = 16;
                  break;
                }
                return F.abrupt("return", null);
              case 16:
                g = 0;
              case 17:
                if (!(g < c.length)) {
                  F.next = 23;
                  break;
                }
                if (b[g] === c[g]) {
                  F.next = 20;
                  break;
                }
                return F.abrupt("return", null);
              case 20:
                g++, F.next = 17;
                break;
              case 23:
                return F.next = 25, this._decryptCTR(l, x);
              case 25:
                return S = F.sent, F.abrupt("return", S);
              case 27:
              case "end":
                return F.stop();
            }
          }, f, this);
        }));
        function p(f, r) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }], [{
      key: "importKey",
      value: function() {
        var s = A(/* @__PURE__ */ h().mark(function f(r, i, l, a) {
          var n;
          return h().wrap(function(x) {
            for (; ; ) switch (x.prev = x.next) {
              case 0:
                return n = new _(), x.next = 3, n._importKey(r);
              case 3:
                return x.abrupt("return", n);
              case 4:
              case "end":
                return x.stop();
            }
          }, f);
        }));
        function p(f, r, i, l) {
          return s.apply(this, arguments);
        }
        return p;
      }()
    }]);
  }(), vt;
}
var yt = {}, Zr;
function Jn() {
  if (Zr) return yt;
  Zr = 1, Object.defineProperty(yt, "__esModule", {
    value: !0
  }), yt.DESECBCipher = yt.DESCBCCipher = void 0;
  function P(S) {
    "@babel/helpers - typeof";
    return P = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(X) {
      return typeof X;
    } : function(X) {
      return X && typeof Symbol == "function" && X.constructor === Symbol && X !== Symbol.prototype ? "symbol" : typeof X;
    }, P(S);
  }
  function h(S, X) {
    if (!(S instanceof X)) throw new TypeError("Cannot call a class as a function");
  }
  function Y(S, X) {
    for (var F = 0; F < X.length; F++) {
      var T = X[F];
      T.enumerable = T.enumerable || !1, T.configurable = !0, "value" in T && (T.writable = !0), Object.defineProperty(S, K(T.key), T);
    }
  }
  function A(S, X, F) {
    return X && Y(S.prototype, X), F && Y(S, F), Object.defineProperty(S, "prototype", { writable: !1 }), S;
  }
  function K(S) {
    var X = I(S, "string");
    return P(X) == "symbol" ? X : X + "";
  }
  function I(S, X) {
    if (P(S) != "object" || !S) return S;
    var F = S[Symbol.toPrimitive];
    if (F !== void 0) {
      var T = F.call(S, X);
      if (P(T) != "object") return T;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return String(S);
  }
  var L = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31], C = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28], u = 0, _, s, p, f, r, i;
  _ = 65536, s = 1 << 24, p = _ | s, f = 4, r = 1024, i = f | r;
  var l = [p | r, u | u, _ | u, p | i, p | f, _ | i, u | f, _ | u, u | r, p | r, p | i, u | r, s | i, p | f, s | u, u | f, u | i, s | r, s | r, _ | r, _ | r, p | u, p | u, s | i, _ | f, s | f, s | f, _ | f, u | u, u | i, _ | i, s | u, _ | u, p | i, u | f, p | u, p | r, s | u, s | u, u | r, p | f, _ | u, _ | r, s | f, u | r, u | f, s | i, _ | i, p | i, _ | f, p | u, s | i, s | f, u | i, _ | i, p | r, u | i, s | r, s | r, u | u, _ | f, _ | r, u | u, p | f];
  _ = 1 << 20, s = 1 << 31, p = _ | s, f = 32, r = 32768, i = f | r;
  var a = [p | i, s | r, u | r, _ | i, _ | u, u | f, p | f, s | i, s | f, p | i, p | r, s | u, s | r, _ | u, u | f, p | f, _ | r, _ | f, s | i, u | u, s | u, u | r, _ | i, p | u, _ | f, s | f, u | u, _ | r, u | i, p | r, p | u, u | i, u | u, _ | i, p | f, _ | u, s | i, p | u, p | r, u | r, p | u, s | r, u | f, p | i, _ | i, u | f, u | r, s | u, u | i, p | r, _ | u, s | f, _ | f, s | i, s | f, _ | f, _ | r, u | u, s | r, u | i, s | u, p | f, p | i, _ | r];
  _ = 1 << 17, s = 1 << 27, p = _ | s, f = 8, r = 512, i = f | r;
  var n = [u | i, p | r, u | u, p | f, s | r, u | u, _ | i, s | r, _ | f, s | f, s | f, _ | u, p | i, _ | f, p | u, u | i, s | u, u | f, p | r, u | r, _ | r, p | u, p | f, _ | i, s | i, _ | r, _ | u, s | i, u | f, p | i, u | r, s | u, p | r, s | u, _ | f, u | i, _ | u, p | r, s | r, u | u, u | r, _ | f, p | i, s | r, s | f, u | r, u | u, p | f, s | i, _ | u, s | u, p | i, u | f, _ | i, _ | r, s | f, p | u, s | i, u | i, p | u, _ | i, u | f, p | f, _ | r];
  _ = 8192, s = 1 << 23, p = _ | s, f = 1, r = 128, i = f | r;
  var c = [p | f, _ | i, _ | i, u | r, p | r, s | i, s | f, _ | f, u | u, p | u, p | u, p | i, u | i, u | u, s | r, s | f, u | f, _ | u, s | u, p | f, u | r, s | u, _ | f, _ | r, s | i, u | f, _ | r, s | r, _ | u, p | r, p | i, u | i, s | r, s | f, p | u, p | i, u | i, u | u, u | u, p | u, _ | r, s | r, s | i, u | f, p | f, _ | i, _ | i, u | r, p | i, u | i, u | f, _ | u, s | f, _ | f, p | r, s | i, _ | f, _ | r, s | u, p | f, u | r, s | u, _ | u, p | r];
  _ = 1 << 25, s = 1 << 30, p = _ | s, f = 256, r = 1 << 19, i = f | r;
  var x = [u | f, _ | i, _ | r, p | f, u | r, u | f, s | u, _ | r, s | i, u | r, _ | f, s | i, p | f, p | r, u | i, s | u, _ | u, s | r, s | r, u | u, s | f, p | i, p | i, _ | f, p | r, s | f, u | u, p | u, _ | i, _ | u, p | u, u | i, u | r, p | f, u | f, _ | u, s | u, _ | r, p | f, s | i, _ | f, s | u, p | r, _ | i, s | i, u | f, _ | u, p | r, p | i, u | i, p | u, p | i, _ | r, u | u, s | r, p | u, u | i, _ | f, s | f, u | r, u | u, s | r, _ | i, s | f];
  _ = 1 << 22, s = 1 << 29, p = _ | s, f = 16, r = 16384, i = f | r;
  var v = [s | f, p | u, u | r, p | i, p | u, u | f, p | i, _ | u, s | r, _ | i, _ | u, s | f, _ | f, s | r, s | u, u | i, u | u, _ | f, s | i, u | r, _ | r, s | i, u | f, p | f, p | f, u | u, _ | i, p | r, u | i, _ | r, p | r, s | u, s | r, u | f, p | f, _ | r, p | i, _ | u, u | i, s | f, _ | u, s | r, s | u, u | i, s | f, p | i, _ | r, p | u, _ | i, p | r, u | u, p | f, u | f, u | r, p | u, _ | i, u | r, _ | f, s | i, u | u, p | r, s | u, _ | f, s | i];
  _ = 1 << 21, s = 1 << 26, p = _ | s, f = 2, r = 2048, i = f | r;
  var b = [_ | u, p | f, s | i, u | u, u | r, s | i, _ | i, p | r, p | i, _ | u, u | u, s | f, u | f, s | u, p | f, u | i, s | r, _ | i, _ | f, s | r, s | f, p | u, p | r, _ | f, p | u, u | r, u | i, p | i, _ | r, u | f, s | u, _ | r, s | u, _ | r, _ | u, s | i, s | i, p | f, p | f, u | f, _ | f, s | u, s | r, _ | u, p | r, u | i, _ | i, p | r, u | i, s | f, p | i, p | u, _ | r, u | u, u | f, p | i, u | u, _ | i, p | u, u | r, s | f, s | r, u | r, _ | f];
  _ = 1 << 18, s = 1 << 28, p = _ | s, f = 64, r = 4096, i = f | r;
  var y = [s | i, u | r, _ | u, p | i, s | u, s | i, u | f, s | u, _ | f, p | u, p | i, _ | r, p | r, _ | i, u | r, u | f, p | u, s | f, s | r, u | i, _ | r, _ | f, p | f, p | r, u | i, u | u, u | u, p | f, s | f, s | r, _ | i, _ | u, _ | i, _ | u, p | r, u | r, u | f, p | f, u | r, _ | i, s | r, u | f, s | f, p | u, p | f, s | u, _ | u, s | i, u | u, p | i, _ | f, s | f, p | u, s | r, s | i, u | u, p | i, _ | r, _ | r, u | i, u | i, _ | f, s | u, p | r], g = /* @__PURE__ */ function() {
    function S(X) {
      h(this, S), this.keys = [];
      for (var F = [], T = [], Q = [], D = 0, j = 56; D < 56; ++D, j -= 8) {
        j += j < -5 ? 65 : j < -3 ? 31 : j < -1 ? 63 : j === 27 ? 35 : 0;
        var te = j & 7;
        F[D] = (X[j >>> 3] & 1 << te) !== 0 ? 1 : 0;
      }
      for (var he = 0; he < 16; ++he) {
        var ge = he << 1, pe = ge + 1;
        Q[ge] = Q[pe] = 0;
        for (var we = 28; we < 59; we += 28)
          for (var Ae = we - 28; Ae < we; ++Ae) {
            var de = Ae + C[he];
            T[Ae] = de < we ? F[de] : F[de - 28];
          }
        for (var ke = 0; ke < 24; ++ke)
          T[L[ke]] !== 0 && (Q[ge] |= 1 << 23 - ke), T[L[ke + 24]] !== 0 && (Q[pe] |= 1 << 23 - ke);
      }
      for (var Ce = 0, Oe = 0, J = 0; Ce < 16; ++Ce) {
        var $ = Q[Oe++], re = Q[Oe++];
        this.keys[J] = ($ & 16515072) << 6, this.keys[J] |= ($ & 4032) << 10, this.keys[J] |= (re & 16515072) >>> 10, this.keys[J] |= (re & 4032) >>> 6, ++J, this.keys[J] = ($ & 258048) << 12, this.keys[J] |= ($ & 63) << 16, this.keys[J] |= (re & 258048) >>> 4, this.keys[J] |= re & 63, ++J;
      }
    }
    return A(S, [{
      key: "enc8",
      value: function(F) {
        var T = F.slice(), Q = 0, D, j, te;
        D = T[Q++] << 24 | T[Q++] << 16 | T[Q++] << 8 | T[Q++], j = T[Q++] << 24 | T[Q++] << 16 | T[Q++] << 8 | T[Q++], te = (D >>> 4 ^ j) & 252645135, j ^= te, D ^= te << 4, te = (D >>> 16 ^ j) & 65535, j ^= te, D ^= te << 16, te = (j >>> 2 ^ D) & 858993459, D ^= te, j ^= te << 2, te = (j >>> 8 ^ D) & 16711935, D ^= te, j ^= te << 8, j = j << 1 | j >>> 31 & 1, te = (D ^ j) & 2863311530, D ^= te, j ^= te, D = D << 1 | D >>> 31 & 1;
        for (var he = 0, ge = 0; he < 8; ++he) {
          te = j << 28 | j >>> 4, te ^= this.keys[ge++];
          var pe = b[te & 63];
          pe |= x[te >>> 8 & 63], pe |= n[te >>> 16 & 63], pe |= l[te >>> 24 & 63], te = j ^ this.keys[ge++], pe |= y[te & 63], pe |= v[te >>> 8 & 63], pe |= c[te >>> 16 & 63], pe |= a[te >>> 24 & 63], D ^= pe, te = D << 28 | D >>> 4, te ^= this.keys[ge++], pe = b[te & 63], pe |= x[te >>> 8 & 63], pe |= n[te >>> 16 & 63], pe |= l[te >>> 24 & 63], te = D ^ this.keys[ge++], pe |= y[te & 63], pe |= v[te >>> 8 & 63], pe |= c[te >>> 16 & 63], pe |= a[te >>> 24 & 63], j ^= pe;
        }
        for (j = j << 31 | j >>> 1, te = (D ^ j) & 2863311530, D ^= te, j ^= te, D = D << 31 | D >>> 1, te = (D >>> 8 ^ j) & 16711935, j ^= te, D ^= te << 8, te = (D >>> 2 ^ j) & 858993459, j ^= te, D ^= te << 2, te = (j >>> 16 ^ D) & 65535, D ^= te, j ^= te << 16, te = (j >>> 4 ^ D) & 252645135, D ^= te, j ^= te << 4, te = [j, D], Q = 0; Q < 8; Q++)
          T[Q] = (te[Q >>> 2] >>> 8 * (3 - Q % 4)) % 256, T[Q] < 0 && (T[Q] += 256);
        return T;
      }
    }]);
  }();
  return yt.DESECBCipher = /* @__PURE__ */ function() {
    function S() {
      h(this, S), this._cipher = null;
    }
    return A(S, [{
      key: "algorithm",
      get: function() {
        return {
          name: "DES-ECB"
        };
      }
    }, {
      key: "_importKey",
      value: function(F, T, Q) {
        this._cipher = new g(F);
      }
    }, {
      key: "encrypt",
      value: function(F, T) {
        var Q = new Uint8Array(T);
        if (Q.length % 8 !== 0 || this._cipher === null)
          return null;
        for (var D = Q.length / 8, j = 0; j < D; j++)
          Q.set(this._cipher.enc8(Q.slice(j * 8, j * 8 + 8)), j * 8);
        return Q;
      }
    }], [{
      key: "importKey",
      value: function(F, T, Q, D) {
        var j = new S();
        return j._importKey(F), j;
      }
    }]);
  }(), yt.DESCBCCipher = /* @__PURE__ */ function() {
    function S() {
      h(this, S), this._cipher = null;
    }
    return A(S, [{
      key: "algorithm",
      get: function() {
        return {
          name: "DES-CBC"
        };
      }
    }, {
      key: "_importKey",
      value: function(F) {
        this._cipher = new g(F);
      }
    }, {
      key: "encrypt",
      value: function(F, T) {
        var Q = new Uint8Array(T), D = new Uint8Array(F.iv);
        if (Q.length % 8 !== 0 || this._cipher === null)
          return null;
        for (var j = Q.length / 8, te = 0; te < j; te++) {
          for (var he = 0; he < 8; he++)
            D[he] ^= T[te * 8 + he];
          D = this._cipher.enc8(D), Q.set(D, te * 8);
        }
        return Q;
      }
    }], [{
      key: "importKey",
      value: function(F, T, Q, D) {
        var j = new S();
        return j._importKey(F), j;
      }
    }]);
  }(), yt;
}
var St = {}, bt = {}, Yr;
function mn() {
  if (Yr) return bt;
  Yr = 1, Object.defineProperty(bt, "__esModule", {
    value: !0
  }), bt.bigIntToU8Array = h, bt.modPow = P, bt.u8ArrayToBigInt = Y;
  function P(A, K, I) {
    var L = 1n;
    for (A = A % I; K > 0n; )
      (K & 1n) === 1n && (L = L * A % I), K = K >> 1n, A = A * A % I;
    return L;
  }
  function h(A) {
    var K = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0, I = A.toString(16);
    K === 0 && (K = Math.ceil(I.length / 2)), I = I.padStart(K * 2, "0");
    for (var L = I.length / 2, C = new Uint8Array(L), u = 0; u < L; u++)
      C[u] = parseInt(I.slice(u * 2, u * 2 + 2), 16);
    return C;
  }
  function Y(A) {
    for (var K = "0x", I = 0; I < A.length; I++)
      K += A[I].toString(16).padStart(2, "0");
    return BigInt(K);
  }
  return bt;
}
var $r;
function ei() {
  if ($r) return St;
  $r = 1, Object.defineProperty(St, "__esModule", {
    value: !0
  }), St.RSACipher = void 0;
  var P = Y(yn()), h = mn();
  function Y(f) {
    return f && f.__esModule ? f : { default: f };
  }
  function A(f) {
    "@babel/helpers - typeof";
    return A = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(r) {
      return typeof r;
    } : function(r) {
      return r && typeof Symbol == "function" && r.constructor === Symbol && r !== Symbol.prototype ? "symbol" : typeof r;
    }, A(f);
  }
  function K() {
    /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */
    K = function() {
      return r;
    };
    var f, r = {}, i = Object.prototype, l = i.hasOwnProperty, a = Object.defineProperty || function(z, B, U) {
      z[B] = U.value;
    }, n = typeof Symbol == "function" ? Symbol : {}, c = n.iterator || "@@iterator", x = n.asyncIterator || "@@asyncIterator", v = n.toStringTag || "@@toStringTag";
    function b(z, B, U) {
      return Object.defineProperty(z, B, { value: U, enumerable: !0, configurable: !0, writable: !0 }), z[B];
    }
    try {
      b({}, "");
    } catch {
      b = function(U, ue, le) {
        return U[ue] = le;
      };
    }
    function y(z, B, U, ue) {
      var le = B && B.prototype instanceof D ? B : D, H = Object.create(le.prototype), q = new $(ue || []);
      return a(H, "_invoke", { value: ke(z, U, q) }), H;
    }
    function g(z, B, U) {
      try {
        return { type: "normal", arg: z.call(B, U) };
      } catch (ue) {
        return { type: "throw", arg: ue };
      }
    }
    r.wrap = y;
    var S = "suspendedStart", X = "suspendedYield", F = "executing", T = "completed", Q = {};
    function D() {
    }
    function j() {
    }
    function te() {
    }
    var he = {};
    b(he, c, function() {
      return this;
    });
    var ge = Object.getPrototypeOf, pe = ge && ge(ge(re([])));
    pe && pe !== i && l.call(pe, c) && (he = pe);
    var we = te.prototype = D.prototype = Object.create(he);
    function Ae(z) {
      ["next", "throw", "return"].forEach(function(B) {
        b(z, B, function(U) {
          return this._invoke(B, U);
        });
      });
    }
    function de(z, B) {
      function U(le, H, q, ee) {
        var ie = g(z[le], z, H);
        if (ie.type !== "throw") {
          var be = ie.arg, V = be.value;
          return V && A(V) == "object" && l.call(V, "__await") ? B.resolve(V.__await).then(function(W) {
            U("next", W, q, ee);
          }, function(W) {
            U("throw", W, q, ee);
          }) : B.resolve(V).then(function(W) {
            be.value = W, q(be);
          }, function(W) {
            return U("throw", W, q, ee);
          });
        }
        ee(ie.arg);
      }
      var ue;
      a(this, "_invoke", { value: function(H, q) {
        function ee() {
          return new B(function(ie, be) {
            U(H, q, ie, be);
          });
        }
        return ue = ue ? ue.then(ee, ee) : ee();
      } });
    }
    function ke(z, B, U) {
      var ue = S;
      return function(le, H) {
        if (ue === F) throw Error("Generator is already running");
        if (ue === T) {
          if (le === "throw") throw H;
          return { value: f, done: !0 };
        }
        for (U.method = le, U.arg = H; ; ) {
          var q = U.delegate;
          if (q) {
            var ee = Ce(q, U);
            if (ee) {
              if (ee === Q) continue;
              return ee;
            }
          }
          if (U.method === "next") U.sent = U._sent = U.arg;
          else if (U.method === "throw") {
            if (ue === S) throw ue = T, U.arg;
            U.dispatchException(U.arg);
          } else U.method === "return" && U.abrupt("return", U.arg);
          ue = F;
          var ie = g(z, B, U);
          if (ie.type === "normal") {
            if (ue = U.done ? T : X, ie.arg === Q) continue;
            return { value: ie.arg, done: U.done };
          }
          ie.type === "throw" && (ue = T, U.method = "throw", U.arg = ie.arg);
        }
      };
    }
    function Ce(z, B) {
      var U = B.method, ue = z.iterator[U];
      if (ue === f) return B.delegate = null, U === "throw" && z.iterator.return && (B.method = "return", B.arg = f, Ce(z, B), B.method === "throw") || U !== "return" && (B.method = "throw", B.arg = new TypeError("The iterator does not provide a '" + U + "' method")), Q;
      var le = g(ue, z.iterator, B.arg);
      if (le.type === "throw") return B.method = "throw", B.arg = le.arg, B.delegate = null, Q;
      var H = le.arg;
      return H ? H.done ? (B[z.resultName] = H.value, B.next = z.nextLoc, B.method !== "return" && (B.method = "next", B.arg = f), B.delegate = null, Q) : H : (B.method = "throw", B.arg = new TypeError("iterator result is not an object"), B.delegate = null, Q);
    }
    function Oe(z) {
      var B = { tryLoc: z[0] };
      1 in z && (B.catchLoc = z[1]), 2 in z && (B.finallyLoc = z[2], B.afterLoc = z[3]), this.tryEntries.push(B);
    }
    function J(z) {
      var B = z.completion || {};
      B.type = "normal", delete B.arg, z.completion = B;
    }
    function $(z) {
      this.tryEntries = [{ tryLoc: "root" }], z.forEach(Oe, this), this.reset(!0);
    }
    function re(z) {
      if (z || z === "") {
        var B = z[c];
        if (B) return B.call(z);
        if (typeof z.next == "function") return z;
        if (!isNaN(z.length)) {
          var U = -1, ue = function le() {
            for (; ++U < z.length; ) if (l.call(z, U)) return le.value = z[U], le.done = !1, le;
            return le.value = f, le.done = !0, le;
          };
          return ue.next = ue;
        }
      }
      throw new TypeError(A(z) + " is not iterable");
    }
    return j.prototype = te, a(we, "constructor", { value: te, configurable: !0 }), a(te, "constructor", { value: j, configurable: !0 }), j.displayName = b(te, v, "GeneratorFunction"), r.isGeneratorFunction = function(z) {
      var B = typeof z == "function" && z.constructor;
      return !!B && (B === j || (B.displayName || B.name) === "GeneratorFunction");
    }, r.mark = function(z) {
      return Object.setPrototypeOf ? Object.setPrototypeOf(z, te) : (z.__proto__ = te, b(z, v, "GeneratorFunction")), z.prototype = Object.create(we), z;
    }, r.awrap = function(z) {
      return { __await: z };
    }, Ae(de.prototype), b(de.prototype, x, function() {
      return this;
    }), r.AsyncIterator = de, r.async = function(z, B, U, ue, le) {
      le === void 0 && (le = Promise);
      var H = new de(y(z, B, U, ue), le);
      return r.isGeneratorFunction(B) ? H : H.next().then(function(q) {
        return q.done ? q.value : H.next();
      });
    }, Ae(we), b(we, v, "Generator"), b(we, c, function() {
      return this;
    }), b(we, "toString", function() {
      return "[object Generator]";
    }), r.keys = function(z) {
      var B = Object(z), U = [];
      for (var ue in B) U.push(ue);
      return U.reverse(), function le() {
        for (; U.length; ) {
          var H = U.pop();
          if (H in B) return le.value = H, le.done = !1, le;
        }
        return le.done = !0, le;
      };
    }, r.values = re, $.prototype = { constructor: $, reset: function(B) {
      if (this.prev = 0, this.next = 0, this.sent = this._sent = f, this.done = !1, this.delegate = null, this.method = "next", this.arg = f, this.tryEntries.forEach(J), !B) for (var U in this) U.charAt(0) === "t" && l.call(this, U) && !isNaN(+U.slice(1)) && (this[U] = f);
    }, stop: function() {
      this.done = !0;
      var B = this.tryEntries[0].completion;
      if (B.type === "throw") throw B.arg;
      return this.rval;
    }, dispatchException: function(B) {
      if (this.done) throw B;
      var U = this;
      function ue(be, V) {
        return q.type = "throw", q.arg = B, U.next = be, V && (U.method = "next", U.arg = f), !!V;
      }
      for (var le = this.tryEntries.length - 1; le >= 0; --le) {
        var H = this.tryEntries[le], q = H.completion;
        if (H.tryLoc === "root") return ue("end");
        if (H.tryLoc <= this.prev) {
          var ee = l.call(H, "catchLoc"), ie = l.call(H, "finallyLoc");
          if (ee && ie) {
            if (this.prev < H.catchLoc) return ue(H.catchLoc, !0);
            if (this.prev < H.finallyLoc) return ue(H.finallyLoc);
          } else if (ee) {
            if (this.prev < H.catchLoc) return ue(H.catchLoc, !0);
          } else {
            if (!ie) throw Error("try statement without catch or finally");
            if (this.prev < H.finallyLoc) return ue(H.finallyLoc);
          }
        }
      }
    }, abrupt: function(B, U) {
      for (var ue = this.tryEntries.length - 1; ue >= 0; --ue) {
        var le = this.tryEntries[ue];
        if (le.tryLoc <= this.prev && l.call(le, "finallyLoc") && this.prev < le.finallyLoc) {
          var H = le;
          break;
        }
      }
      H && (B === "break" || B === "continue") && H.tryLoc <= U && U <= H.finallyLoc && (H = null);
      var q = H ? H.completion : {};
      return q.type = B, q.arg = U, H ? (this.method = "next", this.next = H.finallyLoc, Q) : this.complete(q);
    }, complete: function(B, U) {
      if (B.type === "throw") throw B.arg;
      return B.type === "break" || B.type === "continue" ? this.next = B.arg : B.type === "return" ? (this.rval = this.arg = B.arg, this.method = "return", this.next = "end") : B.type === "normal" && U && (this.next = U), Q;
    }, finish: function(B) {
      for (var U = this.tryEntries.length - 1; U >= 0; --U) {
        var ue = this.tryEntries[U];
        if (ue.finallyLoc === B) return this.complete(ue.completion, ue.afterLoc), J(ue), Q;
      }
    }, catch: function(B) {
      for (var U = this.tryEntries.length - 1; U >= 0; --U) {
        var ue = this.tryEntries[U];
        if (ue.tryLoc === B) {
          var le = ue.completion;
          if (le.type === "throw") {
            var H = le.arg;
            J(ue);
          }
          return H;
        }
      }
      throw Error("illegal catch attempt");
    }, delegateYield: function(B, U, ue) {
      return this.delegate = { iterator: re(B), resultName: U, nextLoc: ue }, this.method === "next" && (this.arg = f), Q;
    } }, r;
  }
  function I(f, r, i, l, a, n, c) {
    try {
      var x = f[n](c), v = x.value;
    } catch (b) {
      return void i(b);
    }
    x.done ? r(v) : Promise.resolve(v).then(l, a);
  }
  function L(f) {
    return function() {
      var r = this, i = arguments;
      return new Promise(function(l, a) {
        var n = f.apply(r, i);
        function c(v) {
          I(n, l, a, c, x, "next", v);
        }
        function x(v) {
          I(n, l, a, c, x, "throw", v);
        }
        c(void 0);
      });
    };
  }
  function C(f, r) {
    if (!(f instanceof r)) throw new TypeError("Cannot call a class as a function");
  }
  function u(f, r) {
    for (var i = 0; i < r.length; i++) {
      var l = r[i];
      l.enumerable = l.enumerable || !1, l.configurable = !0, "value" in l && (l.writable = !0), Object.defineProperty(f, s(l.key), l);
    }
  }
  function _(f, r, i) {
    return r && u(f.prototype, r), i && u(f, i), Object.defineProperty(f, "prototype", { writable: !1 }), f;
  }
  function s(f) {
    var r = p(f, "string");
    return A(r) == "symbol" ? r : r + "";
  }
  function p(f, r) {
    if (A(f) != "object" || !f) return f;
    var i = f[Symbol.toPrimitive];
    if (i !== void 0) {
      var l = i.call(f, r);
      if (A(l) != "object") return l;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return String(f);
  }
  return St.RSACipher = /* @__PURE__ */ function() {
    function f() {
      C(this, f), this._keyLength = 0, this._keyBytes = 0, this._n = null, this._e = null, this._d = null, this._nBigInt = null, this._eBigInt = null, this._dBigInt = null, this._extractable = !1;
    }
    return _(f, [{
      key: "algorithm",
      get: function() {
        return {
          name: "RSA-PKCS1-v1_5"
        };
      }
    }, {
      key: "_base64urlDecode",
      value: function(i) {
        return i = i.replace(/-/g, "+").replace(/_/g, "/"), i = i.padEnd(Math.ceil(i.length / 4) * 4, "="), P.default.decode(i);
      }
    }, {
      key: "_padArray",
      value: function(i, l) {
        var a = new Uint8Array(l);
        return a.set(i, l - i.length), a;
      }
    }, {
      key: "_generateKey",
      value: function() {
        var r = L(/* @__PURE__ */ K().mark(function l(a, n) {
          var c, x;
          return K().wrap(function(b) {
            for (; ; ) switch (b.prev = b.next) {
              case 0:
                return this._keyLength = a.modulusLength, this._keyBytes = Math.ceil(this._keyLength / 8), b.next = 4, window.crypto.subtle.generateKey({
                  name: "RSA-OAEP",
                  modulusLength: a.modulusLength,
                  publicExponent: a.publicExponent,
                  hash: {
                    name: "SHA-256"
                  }
                }, !0, ["encrypt", "decrypt"]);
              case 4:
                return c = b.sent, b.next = 7, window.crypto.subtle.exportKey("jwk", c.privateKey);
              case 7:
                x = b.sent, this._n = this._padArray(this._base64urlDecode(x.n), this._keyBytes), this._nBigInt = (0, h.u8ArrayToBigInt)(this._n), this._e = this._padArray(this._base64urlDecode(x.e), this._keyBytes), this._eBigInt = (0, h.u8ArrayToBigInt)(this._e), this._d = this._padArray(this._base64urlDecode(x.d), this._keyBytes), this._dBigInt = (0, h.u8ArrayToBigInt)(this._d), this._extractable = n;
              case 15:
              case "end":
                return b.stop();
            }
          }, l, this);
        }));
        function i(l, a) {
          return r.apply(this, arguments);
        }
        return i;
      }()
    }, {
      key: "_importKey",
      value: function() {
        var r = L(/* @__PURE__ */ K().mark(function l(a, n) {
          var c, x;
          return K().wrap(function(b) {
            for (; ; ) switch (b.prev = b.next) {
              case 0:
                if (c = a.n, x = a.e, c.length === x.length) {
                  b.next = 4;
                  break;
                }
                throw new Error("the sizes of modulus and public exponent do not match");
              case 4:
                this._keyBytes = c.length, this._keyLength = this._keyBytes * 8, this._n = new Uint8Array(this._keyBytes), this._e = new Uint8Array(this._keyBytes), this._n.set(c), this._e.set(x), this._nBigInt = (0, h.u8ArrayToBigInt)(this._n), this._eBigInt = (0, h.u8ArrayToBigInt)(this._e), this._extractable = n;
              case 13:
              case "end":
                return b.stop();
            }
          }, l, this);
        }));
        function i(l, a) {
          return r.apply(this, arguments);
        }
        return i;
      }()
    }, {
      key: "encrypt",
      value: function() {
        var r = L(/* @__PURE__ */ K().mark(function l(a, n) {
          var c, x, v, b, y;
          return K().wrap(function(S) {
            for (; ; ) switch (S.prev = S.next) {
              case 0:
                if (!(n.length > this._keyBytes - 11)) {
                  S.next = 2;
                  break;
                }
                return S.abrupt("return", null);
              case 2:
                for (c = new Uint8Array(this._keyBytes - n.length - 3), window.crypto.getRandomValues(c), x = 0; x < c.length; x++)
                  c[x] = Math.floor(c[x] * 254 / 255 + 1);
                return v = new Uint8Array(this._keyBytes), v[1] = 2, v.set(c, 2), v.set(n, c.length + 3), b = (0, h.u8ArrayToBigInt)(v), y = (0, h.modPow)(b, this._eBigInt, this._nBigInt), S.abrupt("return", (0, h.bigIntToU8Array)(y, this._keyBytes));
              case 12:
              case "end":
                return S.stop();
            }
          }, l, this);
        }));
        function i(l, a) {
          return r.apply(this, arguments);
        }
        return i;
      }()
    }, {
      key: "decrypt",
      value: function() {
        var r = L(/* @__PURE__ */ K().mark(function l(a, n) {
          var c, x, v, b;
          return K().wrap(function(g) {
            for (; ; ) switch (g.prev = g.next) {
              case 0:
                if (n.length === this._keyBytes) {
                  g.next = 2;
                  break;
                }
                return g.abrupt("return", null);
              case 2:
                if (c = (0, h.u8ArrayToBigInt)(n), x = (0, h.modPow)(c, this._dBigInt, this._nBigInt), v = (0, h.bigIntToU8Array)(x, this._keyBytes), !(v[0] !== 0 || v[1] !== 2)) {
                  g.next = 7;
                  break;
                }
                return g.abrupt("return", null);
              case 7:
                b = 2;
              case 8:
                if (!(b < v.length)) {
                  g.next = 14;
                  break;
                }
                if (v[b] !== 0) {
                  g.next = 11;
                  break;
                }
                return g.abrupt("break", 14);
              case 11:
                b++, g.next = 8;
                break;
              case 14:
                if (b !== v.length) {
                  g.next = 16;
                  break;
                }
                return g.abrupt("return", null);
              case 16:
                return g.abrupt("return", v.slice(b + 1, v.length));
              case 17:
              case "end":
                return g.stop();
            }
          }, l, this);
        }));
        function i(l, a) {
          return r.apply(this, arguments);
        }
        return i;
      }()
    }, {
      key: "exportKey",
      value: function() {
        var r = L(/* @__PURE__ */ K().mark(function l() {
          return K().wrap(function(n) {
            for (; ; ) switch (n.prev = n.next) {
              case 0:
                if (this._extractable) {
                  n.next = 2;
                  break;
                }
                throw new Error("key is not extractable");
              case 2:
                return n.abrupt("return", {
                  n: this._n,
                  e: this._e,
                  d: this._d
                });
              case 3:
              case "end":
                return n.stop();
            }
          }, l, this);
        }));
        function i() {
          return r.apply(this, arguments);
        }
        return i;
      }()
    }], [{
      key: "generateKey",
      value: function() {
        var r = L(/* @__PURE__ */ K().mark(function l(a, n, c) {
          var x;
          return K().wrap(function(b) {
            for (; ; ) switch (b.prev = b.next) {
              case 0:
                return x = new f(), b.next = 3, x._generateKey(a, n);
              case 3:
                return b.abrupt("return", {
                  privateKey: x
                });
              case 4:
              case "end":
                return b.stop();
            }
          }, l);
        }));
        function i(l, a, n) {
          return r.apply(this, arguments);
        }
        return i;
      }()
    }, {
      key: "importKey",
      value: function() {
        var r = L(/* @__PURE__ */ K().mark(function l(a, n, c, x) {
          var v;
          return K().wrap(function(y) {
            for (; ; ) switch (y.prev = y.next) {
              case 0:
                if (!(x.length !== 1 || x[0] !== "encrypt")) {
                  y.next = 2;
                  break;
                }
                throw new Error("only support importing RSA public key");
              case 2:
                return v = new f(), y.next = 5, v._importKey(a, c);
              case 5:
                return y.abrupt("return", v);
              case 6:
              case "end":
                return y.stop();
            }
          }, l);
        }));
        function i(l, a, n, c) {
          return r.apply(this, arguments);
        }
        return i;
      }()
    }]);
  }(), St;
}
var Kt = {}, Jr;
function ti() {
  if (Jr) return Kt;
  Jr = 1, Object.defineProperty(Kt, "__esModule", {
    value: !0
  }), Kt.DHCipher = void 0;
  var P = mn();
  function h(u) {
    "@babel/helpers - typeof";
    return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(_) {
      return typeof _;
    } : function(_) {
      return _ && typeof Symbol == "function" && _.constructor === Symbol && _ !== Symbol.prototype ? "symbol" : typeof _;
    }, h(u);
  }
  function Y(u, _) {
    if (!(u instanceof _)) throw new TypeError("Cannot call a class as a function");
  }
  function A(u, _) {
    for (var s = 0; s < _.length; s++) {
      var p = _[s];
      p.enumerable = p.enumerable || !1, p.configurable = !0, "value" in p && (p.writable = !0), Object.defineProperty(u, I(p.key), p);
    }
  }
  function K(u, _, s) {
    return _ && A(u.prototype, _), s && A(u, s), Object.defineProperty(u, "prototype", { writable: !1 }), u;
  }
  function I(u) {
    var _ = L(u, "string");
    return h(_) == "symbol" ? _ : _ + "";
  }
  function L(u, _) {
    if (h(u) != "object" || !u) return u;
    var s = u[Symbol.toPrimitive];
    if (s !== void 0) {
      var p = s.call(u, _);
      if (h(p) != "object") return p;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return String(u);
  }
  var C = /* @__PURE__ */ function() {
    function u(_) {
      Y(this, u), this._key = _;
    }
    return K(u, [{
      key: "algorithm",
      get: function() {
        return {
          name: "DH"
        };
      }
    }, {
      key: "exportKey",
      value: function() {
        return this._key;
      }
    }]);
  }();
  return Kt.DHCipher = /* @__PURE__ */ function() {
    function u() {
      Y(this, u), this._g = null, this._p = null, this._gBigInt = null, this._pBigInt = null, this._privateKey = null;
    }
    return K(u, [{
      key: "algorithm",
      get: function() {
        return {
          name: "DH"
        };
      }
    }, {
      key: "_generateKey",
      value: function(s) {
        var p = s.g, f = s.p;
        this._keyBytes = f.length, this._gBigInt = (0, P.u8ArrayToBigInt)(p), this._pBigInt = (0, P.u8ArrayToBigInt)(f), this._privateKey = window.crypto.getRandomValues(new Uint8Array(this._keyBytes)), this._privateKeyBigInt = (0, P.u8ArrayToBigInt)(this._privateKey), this._publicKey = (0, P.bigIntToU8Array)((0, P.modPow)(this._gBigInt, this._privateKeyBigInt, this._pBigInt), this._keyBytes);
      }
    }, {
      key: "deriveBits",
      value: function(s, p) {
        var f = Math.ceil(p / 8), r = new Uint8Array(s.public), i = f > this._keyBytes ? f : this._keyBytes, l = (0, P.modPow)((0, P.u8ArrayToBigInt)(r), this._privateKeyBigInt, this._pBigInt);
        return (0, P.bigIntToU8Array)(l, i).slice(0, i);
      }
    }], [{
      key: "generateKey",
      value: function(s, p) {
        var f = new u();
        return f._generateKey(s), {
          privateKey: f,
          publicKey: new C(f._publicKey)
        };
      }
    }]);
  }(), Kt;
}
var Ft = {}, en;
function ri() {
  if (en) return Ft;
  en = 1, Object.defineProperty(Ft, "__esModule", {
    value: !0
  }), Ft.MD5 = K;
  function P(n) {
    "@babel/helpers - typeof";
    return P = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(c) {
      return typeof c;
    } : function(c) {
      return c && typeof Symbol == "function" && c.constructor === Symbol && c !== Symbol.prototype ? "symbol" : typeof c;
    }, P(n);
  }
  function h() {
    /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */
    h = function() {
      return c;
    };
    var n, c = {}, x = Object.prototype, v = x.hasOwnProperty, b = Object.defineProperty || function(H, q, ee) {
      H[q] = ee.value;
    }, y = typeof Symbol == "function" ? Symbol : {}, g = y.iterator || "@@iterator", S = y.asyncIterator || "@@asyncIterator", X = y.toStringTag || "@@toStringTag";
    function F(H, q, ee) {
      return Object.defineProperty(H, q, { value: ee, enumerable: !0, configurable: !0, writable: !0 }), H[q];
    }
    try {
      F({}, "");
    } catch {
      F = function(ee, ie, be) {
        return ee[ie] = be;
      };
    }
    function T(H, q, ee, ie) {
      var be = q && q.prototype instanceof pe ? q : pe, V = Object.create(be.prototype), W = new ue(ie || []);
      return b(V, "_invoke", { value: re(H, ee, W) }), V;
    }
    function Q(H, q, ee) {
      try {
        return { type: "normal", arg: H.call(q, ee) };
      } catch (ie) {
        return { type: "throw", arg: ie };
      }
    }
    c.wrap = T;
    var D = "suspendedStart", j = "suspendedYield", te = "executing", he = "completed", ge = {};
    function pe() {
    }
    function we() {
    }
    function Ae() {
    }
    var de = {};
    F(de, g, function() {
      return this;
    });
    var ke = Object.getPrototypeOf, Ce = ke && ke(ke(le([])));
    Ce && Ce !== x && v.call(Ce, g) && (de = Ce);
    var Oe = Ae.prototype = pe.prototype = Object.create(de);
    function J(H) {
      ["next", "throw", "return"].forEach(function(q) {
        F(H, q, function(ee) {
          return this._invoke(q, ee);
        });
      });
    }
    function $(H, q) {
      function ee(be, V, W, ae) {
        var O = Q(H[be], H, V);
        if (O.type !== "throw") {
          var ne = O.arg, ve = ne.value;
          return ve && P(ve) == "object" && v.call(ve, "__await") ? q.resolve(ve.__await).then(function(Te) {
            ee("next", Te, W, ae);
          }, function(Te) {
            ee("throw", Te, W, ae);
          }) : q.resolve(ve).then(function(Te) {
            ne.value = Te, W(ne);
          }, function(Te) {
            return ee("throw", Te, W, ae);
          });
        }
        ae(O.arg);
      }
      var ie;
      b(this, "_invoke", { value: function(V, W) {
        function ae() {
          return new q(function(O, ne) {
            ee(V, W, O, ne);
          });
        }
        return ie = ie ? ie.then(ae, ae) : ae();
      } });
    }
    function re(H, q, ee) {
      var ie = D;
      return function(be, V) {
        if (ie === te) throw Error("Generator is already running");
        if (ie === he) {
          if (be === "throw") throw V;
          return { value: n, done: !0 };
        }
        for (ee.method = be, ee.arg = V; ; ) {
          var W = ee.delegate;
          if (W) {
            var ae = z(W, ee);
            if (ae) {
              if (ae === ge) continue;
              return ae;
            }
          }
          if (ee.method === "next") ee.sent = ee._sent = ee.arg;
          else if (ee.method === "throw") {
            if (ie === D) throw ie = he, ee.arg;
            ee.dispatchException(ee.arg);
          } else ee.method === "return" && ee.abrupt("return", ee.arg);
          ie = te;
          var O = Q(H, q, ee);
          if (O.type === "normal") {
            if (ie = ee.done ? he : j, O.arg === ge) continue;
            return { value: O.arg, done: ee.done };
          }
          O.type === "throw" && (ie = he, ee.method = "throw", ee.arg = O.arg);
        }
      };
    }
    function z(H, q) {
      var ee = q.method, ie = H.iterator[ee];
      if (ie === n) return q.delegate = null, ee === "throw" && H.iterator.return && (q.method = "return", q.arg = n, z(H, q), q.method === "throw") || ee !== "return" && (q.method = "throw", q.arg = new TypeError("The iterator does not provide a '" + ee + "' method")), ge;
      var be = Q(ie, H.iterator, q.arg);
      if (be.type === "throw") return q.method = "throw", q.arg = be.arg, q.delegate = null, ge;
      var V = be.arg;
      return V ? V.done ? (q[H.resultName] = V.value, q.next = H.nextLoc, q.method !== "return" && (q.method = "next", q.arg = n), q.delegate = null, ge) : V : (q.method = "throw", q.arg = new TypeError("iterator result is not an object"), q.delegate = null, ge);
    }
    function B(H) {
      var q = { tryLoc: H[0] };
      1 in H && (q.catchLoc = H[1]), 2 in H && (q.finallyLoc = H[2], q.afterLoc = H[3]), this.tryEntries.push(q);
    }
    function U(H) {
      var q = H.completion || {};
      q.type = "normal", delete q.arg, H.completion = q;
    }
    function ue(H) {
      this.tryEntries = [{ tryLoc: "root" }], H.forEach(B, this), this.reset(!0);
    }
    function le(H) {
      if (H || H === "") {
        var q = H[g];
        if (q) return q.call(H);
        if (typeof H.next == "function") return H;
        if (!isNaN(H.length)) {
          var ee = -1, ie = function be() {
            for (; ++ee < H.length; ) if (v.call(H, ee)) return be.value = H[ee], be.done = !1, be;
            return be.value = n, be.done = !0, be;
          };
          return ie.next = ie;
        }
      }
      throw new TypeError(P(H) + " is not iterable");
    }
    return we.prototype = Ae, b(Oe, "constructor", { value: Ae, configurable: !0 }), b(Ae, "constructor", { value: we, configurable: !0 }), we.displayName = F(Ae, X, "GeneratorFunction"), c.isGeneratorFunction = function(H) {
      var q = typeof H == "function" && H.constructor;
      return !!q && (q === we || (q.displayName || q.name) === "GeneratorFunction");
    }, c.mark = function(H) {
      return Object.setPrototypeOf ? Object.setPrototypeOf(H, Ae) : (H.__proto__ = Ae, F(H, X, "GeneratorFunction")), H.prototype = Object.create(Oe), H;
    }, c.awrap = function(H) {
      return { __await: H };
    }, J($.prototype), F($.prototype, S, function() {
      return this;
    }), c.AsyncIterator = $, c.async = function(H, q, ee, ie, be) {
      be === void 0 && (be = Promise);
      var V = new $(T(H, q, ee, ie), be);
      return c.isGeneratorFunction(q) ? V : V.next().then(function(W) {
        return W.done ? W.value : V.next();
      });
    }, J(Oe), F(Oe, X, "Generator"), F(Oe, g, function() {
      return this;
    }), F(Oe, "toString", function() {
      return "[object Generator]";
    }), c.keys = function(H) {
      var q = Object(H), ee = [];
      for (var ie in q) ee.push(ie);
      return ee.reverse(), function be() {
        for (; ee.length; ) {
          var V = ee.pop();
          if (V in q) return be.value = V, be.done = !1, be;
        }
        return be.done = !0, be;
      };
    }, c.values = le, ue.prototype = { constructor: ue, reset: function(q) {
      if (this.prev = 0, this.next = 0, this.sent = this._sent = n, this.done = !1, this.delegate = null, this.method = "next", this.arg = n, this.tryEntries.forEach(U), !q) for (var ee in this) ee.charAt(0) === "t" && v.call(this, ee) && !isNaN(+ee.slice(1)) && (this[ee] = n);
    }, stop: function() {
      this.done = !0;
      var q = this.tryEntries[0].completion;
      if (q.type === "throw") throw q.arg;
      return this.rval;
    }, dispatchException: function(q) {
      if (this.done) throw q;
      var ee = this;
      function ie(ne, ve) {
        return W.type = "throw", W.arg = q, ee.next = ne, ve && (ee.method = "next", ee.arg = n), !!ve;
      }
      for (var be = this.tryEntries.length - 1; be >= 0; --be) {
        var V = this.tryEntries[be], W = V.completion;
        if (V.tryLoc === "root") return ie("end");
        if (V.tryLoc <= this.prev) {
          var ae = v.call(V, "catchLoc"), O = v.call(V, "finallyLoc");
          if (ae && O) {
            if (this.prev < V.catchLoc) return ie(V.catchLoc, !0);
            if (this.prev < V.finallyLoc) return ie(V.finallyLoc);
          } else if (ae) {
            if (this.prev < V.catchLoc) return ie(V.catchLoc, !0);
          } else {
            if (!O) throw Error("try statement without catch or finally");
            if (this.prev < V.finallyLoc) return ie(V.finallyLoc);
          }
        }
      }
    }, abrupt: function(q, ee) {
      for (var ie = this.tryEntries.length - 1; ie >= 0; --ie) {
        var be = this.tryEntries[ie];
        if (be.tryLoc <= this.prev && v.call(be, "finallyLoc") && this.prev < be.finallyLoc) {
          var V = be;
          break;
        }
      }
      V && (q === "break" || q === "continue") && V.tryLoc <= ee && ee <= V.finallyLoc && (V = null);
      var W = V ? V.completion : {};
      return W.type = q, W.arg = ee, V ? (this.method = "next", this.next = V.finallyLoc, ge) : this.complete(W);
    }, complete: function(q, ee) {
      if (q.type === "throw") throw q.arg;
      return q.type === "break" || q.type === "continue" ? this.next = q.arg : q.type === "return" ? (this.rval = this.arg = q.arg, this.method = "return", this.next = "end") : q.type === "normal" && ee && (this.next = ee), ge;
    }, finish: function(q) {
      for (var ee = this.tryEntries.length - 1; ee >= 0; --ee) {
        var ie = this.tryEntries[ee];
        if (ie.finallyLoc === q) return this.complete(ie.completion, ie.afterLoc), U(ie), ge;
      }
    }, catch: function(q) {
      for (var ee = this.tryEntries.length - 1; ee >= 0; --ee) {
        var ie = this.tryEntries[ee];
        if (ie.tryLoc === q) {
          var be = ie.completion;
          if (be.type === "throw") {
            var V = be.arg;
            U(ie);
          }
          return V;
        }
      }
      throw Error("illegal catch attempt");
    }, delegateYield: function(q, ee, ie) {
      return this.delegate = { iterator: le(q), resultName: ee, nextLoc: ie }, this.method === "next" && (this.arg = n), ge;
    } }, c;
  }
  function Y(n, c, x, v, b, y, g) {
    try {
      var S = n[y](g), X = S.value;
    } catch (F) {
      return void x(F);
    }
    S.done ? c(X) : Promise.resolve(X).then(v, b);
  }
  function A(n) {
    return function() {
      var c = this, x = arguments;
      return new Promise(function(v, b) {
        var y = n.apply(c, x);
        function g(X) {
          Y(y, v, b, g, S, "next", X);
        }
        function S(X) {
          Y(y, v, b, g, S, "throw", X);
        }
        g(void 0);
      });
    };
  }
  function K(n) {
    return I.apply(this, arguments);
  }
  function I() {
    return I = A(/* @__PURE__ */ h().mark(function n(c) {
      var x, v;
      return h().wrap(function(y) {
        for (; ; ) switch (y.prev = y.next) {
          case 0:
            for (x = "", v = 0; v < c.length; v++)
              x += String.fromCharCode(c[v]);
            return y.abrupt("return", L(u(_(C(x), 8 * x.length))));
          case 3:
          case "end":
            return y.stop();
        }
      }, n);
    })), I.apply(this, arguments);
  }
  function L(n) {
    for (var c = new Uint8Array(n.length), x = 0; x < n.length; x++)
      c[x] = n.charCodeAt(x);
    return c;
  }
  function C(n) {
    for (var c = Array(n.length >> 2), x = 0; x < c.length; x++) c[x] = 0;
    for (var v = 0; v < 8 * n.length; v += 8) c[v >> 5] |= (255 & n.charCodeAt(v / 8)) << v % 32;
    return c;
  }
  function u(n) {
    for (var c = "", x = 0; x < 32 * n.length; x += 8) c += String.fromCharCode(n[x >> 5] >>> x % 32 & 255);
    return c;
  }
  function _(n, c) {
    n[c >> 5] |= 128 << c % 32, n[14 + (c + 64 >>> 9 << 4)] = c;
    for (var x = 1732584193, v = -271733879, b = -1732584194, y = 271733878, g = 0; g < n.length; g += 16) {
      var S = x, X = v, F = b, T = y;
      v = i(v = i(v = i(v = i(v = r(v = r(v = r(v = r(v = f(v = f(v = f(v = f(v = p(v = p(v = p(v = p(v, b = p(b, y = p(y, x = p(x, v, b, y, n[g + 0], 7, -680876936), v, b, n[g + 1], 12, -389564586), x, v, n[g + 2], 17, 606105819), y, x, n[g + 3], 22, -1044525330), b = p(b, y = p(y, x = p(x, v, b, y, n[g + 4], 7, -176418897), v, b, n[g + 5], 12, 1200080426), x, v, n[g + 6], 17, -1473231341), y, x, n[g + 7], 22, -45705983), b = p(b, y = p(y, x = p(x, v, b, y, n[g + 8], 7, 1770035416), v, b, n[g + 9], 12, -1958414417), x, v, n[g + 10], 17, -42063), y, x, n[g + 11], 22, -1990404162), b = p(b, y = p(y, x = p(x, v, b, y, n[g + 12], 7, 1804603682), v, b, n[g + 13], 12, -40341101), x, v, n[g + 14], 17, -1502002290), y, x, n[g + 15], 22, 1236535329), b = f(b, y = f(y, x = f(x, v, b, y, n[g + 1], 5, -165796510), v, b, n[g + 6], 9, -1069501632), x, v, n[g + 11], 14, 643717713), y, x, n[g + 0], 20, -373897302), b = f(b, y = f(y, x = f(x, v, b, y, n[g + 5], 5, -701558691), v, b, n[g + 10], 9, 38016083), x, v, n[g + 15], 14, -660478335), y, x, n[g + 4], 20, -405537848), b = f(b, y = f(y, x = f(x, v, b, y, n[g + 9], 5, 568446438), v, b, n[g + 14], 9, -1019803690), x, v, n[g + 3], 14, -187363961), y, x, n[g + 8], 20, 1163531501), b = f(b, y = f(y, x = f(x, v, b, y, n[g + 13], 5, -1444681467), v, b, n[g + 2], 9, -51403784), x, v, n[g + 7], 14, 1735328473), y, x, n[g + 12], 20, -1926607734), b = r(b, y = r(y, x = r(x, v, b, y, n[g + 5], 4, -378558), v, b, n[g + 8], 11, -2022574463), x, v, n[g + 11], 16, 1839030562), y, x, n[g + 14], 23, -35309556), b = r(b, y = r(y, x = r(x, v, b, y, n[g + 1], 4, -1530992060), v, b, n[g + 4], 11, 1272893353), x, v, n[g + 7], 16, -155497632), y, x, n[g + 10], 23, -1094730640), b = r(b, y = r(y, x = r(x, v, b, y, n[g + 13], 4, 681279174), v, b, n[g + 0], 11, -358537222), x, v, n[g + 3], 16, -722521979), y, x, n[g + 6], 23, 76029189), b = r(b, y = r(y, x = r(x, v, b, y, n[g + 9], 4, -640364487), v, b, n[g + 12], 11, -421815835), x, v, n[g + 15], 16, 530742520), y, x, n[g + 2], 23, -995338651), b = i(b, y = i(y, x = i(x, v, b, y, n[g + 0], 6, -198630844), v, b, n[g + 7], 10, 1126891415), x, v, n[g + 14], 15, -1416354905), y, x, n[g + 5], 21, -57434055), b = i(b, y = i(y, x = i(x, v, b, y, n[g + 12], 6, 1700485571), v, b, n[g + 3], 10, -1894986606), x, v, n[g + 10], 15, -1051523), y, x, n[g + 1], 21, -2054922799), b = i(b, y = i(y, x = i(x, v, b, y, n[g + 8], 6, 1873313359), v, b, n[g + 15], 10, -30611744), x, v, n[g + 6], 15, -1560198380), y, x, n[g + 13], 21, 1309151649), b = i(b, y = i(y, x = i(x, v, b, y, n[g + 4], 6, -145523070), v, b, n[g + 11], 10, -1120210379), x, v, n[g + 2], 15, 718787259), y, x, n[g + 9], 21, -343485551), x = l(x, S), v = l(v, X), b = l(b, F), y = l(y, T);
    }
    return Array(x, v, b, y);
  }
  function s(n, c, x, v, b, y) {
    return l(a(l(l(c, n), l(v, y)), b), x);
  }
  function p(n, c, x, v, b, y, g) {
    return s(c & x | ~c & v, n, c, b, y, g);
  }
  function f(n, c, x, v, b, y, g) {
    return s(c & v | x & ~v, n, c, b, y, g);
  }
  function r(n, c, x, v, b, y, g) {
    return s(c ^ x ^ v, n, c, b, y, g);
  }
  function i(n, c, x, v, b, y, g) {
    return s(x ^ (c | ~v), n, c, b, y, g);
  }
  function l(n, c) {
    var x = (65535 & n) + (65535 & c);
    return (n >> 16) + (c >> 16) + (x >> 16) << 16 | 65535 & x;
  }
  function a(n, c) {
    return n << c | n >>> 32 - c;
  }
  return Ft;
}
var tn;
function wn() {
  return tn || (tn = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = $n(), Y = Jn(), A = ei(), K = ti(), I = ri();
    function L(r) {
      "@babel/helpers - typeof";
      return L = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(i) {
        return typeof i;
      } : function(i) {
        return i && typeof Symbol == "function" && i.constructor === Symbol && i !== Symbol.prototype ? "symbol" : typeof i;
      }, L(r);
    }
    function C(r, i) {
      if (!(r instanceof i)) throw new TypeError("Cannot call a class as a function");
    }
    function u(r, i) {
      for (var l = 0; l < i.length; l++) {
        var a = i[l];
        a.enumerable = a.enumerable || !1, a.configurable = !0, "value" in a && (a.writable = !0), Object.defineProperty(r, s(a.key), a);
      }
    }
    function _(r, i, l) {
      return i && u(r.prototype, i), Object.defineProperty(r, "prototype", { writable: !1 }), r;
    }
    function s(r) {
      var i = p(r, "string");
      return L(i) == "symbol" ? i : i + "";
    }
    function p(r, i) {
      if (L(r) != "object" || !r) return r;
      var l = r[Symbol.toPrimitive];
      if (l !== void 0) {
        var a = l.call(r, i);
        if (L(a) != "object") return a;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(r);
    }
    var f = /* @__PURE__ */ function() {
      function r() {
        C(this, r), this._algorithms = {
          "AES-ECB": h.AESECBCipher,
          "AES-EAX": h.AESEAXCipher,
          "DES-ECB": Y.DESECBCipher,
          "DES-CBC": Y.DESCBCCipher,
          "RSA-PKCS1-v1_5": A.RSACipher,
          DH: K.DHCipher,
          MD5: I.MD5
        };
      }
      return _(r, [{
        key: "encrypt",
        value: function(l, a, n) {
          if (a.algorithm.name !== l.name)
            throw new Error("algorithm does not match");
          if (typeof a.encrypt != "function")
            throw new Error("key does not support encryption");
          return a.encrypt(l, n);
        }
      }, {
        key: "decrypt",
        value: function(l, a, n) {
          if (a.algorithm.name !== l.name)
            throw new Error("algorithm does not match");
          if (typeof a.decrypt != "function")
            throw new Error("key does not support encryption");
          return a.decrypt(l, n);
        }
      }, {
        key: "importKey",
        value: function(l, a, n, c, x) {
          if (l !== "raw")
            throw new Error("key format is not supported");
          var v = this._algorithms[n.name];
          if (typeof v > "u" || typeof v.importKey != "function")
            throw new Error("algorithm is not supported");
          return v.importKey(a, n, c, x);
        }
      }, {
        key: "generateKey",
        value: function(l, a, n) {
          var c = this._algorithms[l.name];
          if (typeof c > "u" || typeof c.generateKey != "function")
            throw new Error("algorithm is not supported");
          return c.generateKey(l, a, n);
        }
      }, {
        key: "exportKey",
        value: function(l, a) {
          if (l !== "raw")
            throw new Error("key format is not supported");
          if (typeof a.exportKey != "function")
            throw new Error("key does not support exportKey");
          return a.exportKey();
        }
      }, {
        key: "digest",
        value: function(l, a) {
          var n = this._algorithms[l];
          if (typeof n != "function")
            throw new Error("algorithm is not supported");
          return n(a);
        }
      }, {
        key: "deriveBits",
        value: function(l, a, n) {
          if (a.algorithm.name !== l.name)
            throw new Error("algorithm does not match");
          if (typeof a.deriveBits != "function")
            throw new Error("key does not support deriveBits");
          return a.deriveBits(l, n);
        }
      }]);
    }();
    P.default = new f();
  }(ir)), ir;
}
var rn;
function ni() {
  return rn || (rn = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = _n(), Y = K(vn()), A = K(wn());
    function K(y) {
      return y && y.__esModule ? y : { default: y };
    }
    function I(y, g, S) {
      return g = _(g), L(y, u() ? Reflect.construct(g, [], _(y).constructor) : g.apply(y, S));
    }
    function L(y, g) {
      if (g && (f(g) == "object" || typeof g == "function")) return g;
      if (g !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
      return C(y);
    }
    function C(y) {
      if (y === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
      return y;
    }
    function u() {
      try {
        var y = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
        }));
      } catch {
      }
      return (u = function() {
        return !!y;
      })();
    }
    function _(y) {
      return _ = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(g) {
        return g.__proto__ || Object.getPrototypeOf(g);
      }, _(y);
    }
    function s(y, g) {
      if (typeof g != "function" && g !== null) throw new TypeError("Super expression must either be null or a function");
      y.prototype = Object.create(g && g.prototype, { constructor: { value: y, writable: !0, configurable: !0 } }), Object.defineProperty(y, "prototype", { writable: !1 }), g && p(y, g);
    }
    function p(y, g) {
      return p = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(S, X) {
        return S.__proto__ = X, S;
      }, p(y, g);
    }
    function f(y) {
      "@babel/helpers - typeof";
      return f = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(g) {
        return typeof g;
      } : function(g) {
        return g && typeof Symbol == "function" && g.constructor === Symbol && g !== Symbol.prototype ? "symbol" : typeof g;
      }, f(y);
    }
    function r() {
      /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */
      r = function() {
        return g;
      };
      var y, g = {}, S = Object.prototype, X = S.hasOwnProperty, F = Object.defineProperty || function(V, W, ae) {
        V[W] = ae.value;
      }, T = typeof Symbol == "function" ? Symbol : {}, Q = T.iterator || "@@iterator", D = T.asyncIterator || "@@asyncIterator", j = T.toStringTag || "@@toStringTag";
      function te(V, W, ae) {
        return Object.defineProperty(V, W, { value: ae, enumerable: !0, configurable: !0, writable: !0 }), V[W];
      }
      try {
        te({}, "");
      } catch {
        te = function(ae, O, ne) {
          return ae[O] = ne;
        };
      }
      function he(V, W, ae, O) {
        var ne = W && W.prototype instanceof Ce ? W : Ce, ve = Object.create(ne.prototype), Te = new ie(O || []);
        return F(ve, "_invoke", { value: le(V, ae, Te) }), ve;
      }
      function ge(V, W, ae) {
        try {
          return { type: "normal", arg: V.call(W, ae) };
        } catch (O) {
          return { type: "throw", arg: O };
        }
      }
      g.wrap = he;
      var pe = "suspendedStart", we = "suspendedYield", Ae = "executing", de = "completed", ke = {};
      function Ce() {
      }
      function Oe() {
      }
      function J() {
      }
      var $ = {};
      te($, Q, function() {
        return this;
      });
      var re = Object.getPrototypeOf, z = re && re(re(be([])));
      z && z !== S && X.call(z, Q) && ($ = z);
      var B = J.prototype = Ce.prototype = Object.create($);
      function U(V) {
        ["next", "throw", "return"].forEach(function(W) {
          te(V, W, function(ae) {
            return this._invoke(W, ae);
          });
        });
      }
      function ue(V, W) {
        function ae(ne, ve, Te, Ge) {
          var qe = ge(V[ne], V, ve);
          if (qe.type !== "throw") {
            var xe = qe.arg, We = xe.value;
            return We && f(We) == "object" && X.call(We, "__await") ? W.resolve(We.__await).then(function(Ye) {
              ae("next", Ye, Te, Ge);
            }, function(Ye) {
              ae("throw", Ye, Te, Ge);
            }) : W.resolve(We).then(function(Ye) {
              xe.value = Ye, Te(xe);
            }, function(Ye) {
              return ae("throw", Ye, Te, Ge);
            });
          }
          Ge(qe.arg);
        }
        var O;
        F(this, "_invoke", { value: function(ve, Te) {
          function Ge() {
            return new W(function(qe, xe) {
              ae(ve, Te, qe, xe);
            });
          }
          return O = O ? O.then(Ge, Ge) : Ge();
        } });
      }
      function le(V, W, ae) {
        var O = pe;
        return function(ne, ve) {
          if (O === Ae) throw Error("Generator is already running");
          if (O === de) {
            if (ne === "throw") throw ve;
            return { value: y, done: !0 };
          }
          for (ae.method = ne, ae.arg = ve; ; ) {
            var Te = ae.delegate;
            if (Te) {
              var Ge = H(Te, ae);
              if (Ge) {
                if (Ge === ke) continue;
                return Ge;
              }
            }
            if (ae.method === "next") ae.sent = ae._sent = ae.arg;
            else if (ae.method === "throw") {
              if (O === pe) throw O = de, ae.arg;
              ae.dispatchException(ae.arg);
            } else ae.method === "return" && ae.abrupt("return", ae.arg);
            O = Ae;
            var qe = ge(V, W, ae);
            if (qe.type === "normal") {
              if (O = ae.done ? de : we, qe.arg === ke) continue;
              return { value: qe.arg, done: ae.done };
            }
            qe.type === "throw" && (O = de, ae.method = "throw", ae.arg = qe.arg);
          }
        };
      }
      function H(V, W) {
        var ae = W.method, O = V.iterator[ae];
        if (O === y) return W.delegate = null, ae === "throw" && V.iterator.return && (W.method = "return", W.arg = y, H(V, W), W.method === "throw") || ae !== "return" && (W.method = "throw", W.arg = new TypeError("The iterator does not provide a '" + ae + "' method")), ke;
        var ne = ge(O, V.iterator, W.arg);
        if (ne.type === "throw") return W.method = "throw", W.arg = ne.arg, W.delegate = null, ke;
        var ve = ne.arg;
        return ve ? ve.done ? (W[V.resultName] = ve.value, W.next = V.nextLoc, W.method !== "return" && (W.method = "next", W.arg = y), W.delegate = null, ke) : ve : (W.method = "throw", W.arg = new TypeError("iterator result is not an object"), W.delegate = null, ke);
      }
      function q(V) {
        var W = { tryLoc: V[0] };
        1 in V && (W.catchLoc = V[1]), 2 in V && (W.finallyLoc = V[2], W.afterLoc = V[3]), this.tryEntries.push(W);
      }
      function ee(V) {
        var W = V.completion || {};
        W.type = "normal", delete W.arg, V.completion = W;
      }
      function ie(V) {
        this.tryEntries = [{ tryLoc: "root" }], V.forEach(q, this), this.reset(!0);
      }
      function be(V) {
        if (V || V === "") {
          var W = V[Q];
          if (W) return W.call(V);
          if (typeof V.next == "function") return V;
          if (!isNaN(V.length)) {
            var ae = -1, O = function ne() {
              for (; ++ae < V.length; ) if (X.call(V, ae)) return ne.value = V[ae], ne.done = !1, ne;
              return ne.value = y, ne.done = !0, ne;
            };
            return O.next = O;
          }
        }
        throw new TypeError(f(V) + " is not iterable");
      }
      return Oe.prototype = J, F(B, "constructor", { value: J, configurable: !0 }), F(J, "constructor", { value: Oe, configurable: !0 }), Oe.displayName = te(J, j, "GeneratorFunction"), g.isGeneratorFunction = function(V) {
        var W = typeof V == "function" && V.constructor;
        return !!W && (W === Oe || (W.displayName || W.name) === "GeneratorFunction");
      }, g.mark = function(V) {
        return Object.setPrototypeOf ? Object.setPrototypeOf(V, J) : (V.__proto__ = J, te(V, j, "GeneratorFunction")), V.prototype = Object.create(B), V;
      }, g.awrap = function(V) {
        return { __await: V };
      }, U(ue.prototype), te(ue.prototype, D, function() {
        return this;
      }), g.AsyncIterator = ue, g.async = function(V, W, ae, O, ne) {
        ne === void 0 && (ne = Promise);
        var ve = new ue(he(V, W, ae, O), ne);
        return g.isGeneratorFunction(W) ? ve : ve.next().then(function(Te) {
          return Te.done ? Te.value : ve.next();
        });
      }, U(B), te(B, j, "Generator"), te(B, Q, function() {
        return this;
      }), te(B, "toString", function() {
        return "[object Generator]";
      }), g.keys = function(V) {
        var W = Object(V), ae = [];
        for (var O in W) ae.push(O);
        return ae.reverse(), function ne() {
          for (; ae.length; ) {
            var ve = ae.pop();
            if (ve in W) return ne.value = ve, ne.done = !1, ne;
          }
          return ne.done = !0, ne;
        };
      }, g.values = be, ie.prototype = { constructor: ie, reset: function(W) {
        if (this.prev = 0, this.next = 0, this.sent = this._sent = y, this.done = !1, this.delegate = null, this.method = "next", this.arg = y, this.tryEntries.forEach(ee), !W) for (var ae in this) ae.charAt(0) === "t" && X.call(this, ae) && !isNaN(+ae.slice(1)) && (this[ae] = y);
      }, stop: function() {
        this.done = !0;
        var W = this.tryEntries[0].completion;
        if (W.type === "throw") throw W.arg;
        return this.rval;
      }, dispatchException: function(W) {
        if (this.done) throw W;
        var ae = this;
        function O(xe, We) {
          return Te.type = "throw", Te.arg = W, ae.next = xe, We && (ae.method = "next", ae.arg = y), !!We;
        }
        for (var ne = this.tryEntries.length - 1; ne >= 0; --ne) {
          var ve = this.tryEntries[ne], Te = ve.completion;
          if (ve.tryLoc === "root") return O("end");
          if (ve.tryLoc <= this.prev) {
            var Ge = X.call(ve, "catchLoc"), qe = X.call(ve, "finallyLoc");
            if (Ge && qe) {
              if (this.prev < ve.catchLoc) return O(ve.catchLoc, !0);
              if (this.prev < ve.finallyLoc) return O(ve.finallyLoc);
            } else if (Ge) {
              if (this.prev < ve.catchLoc) return O(ve.catchLoc, !0);
            } else {
              if (!qe) throw Error("try statement without catch or finally");
              if (this.prev < ve.finallyLoc) return O(ve.finallyLoc);
            }
          }
        }
      }, abrupt: function(W, ae) {
        for (var O = this.tryEntries.length - 1; O >= 0; --O) {
          var ne = this.tryEntries[O];
          if (ne.tryLoc <= this.prev && X.call(ne, "finallyLoc") && this.prev < ne.finallyLoc) {
            var ve = ne;
            break;
          }
        }
        ve && (W === "break" || W === "continue") && ve.tryLoc <= ae && ae <= ve.finallyLoc && (ve = null);
        var Te = ve ? ve.completion : {};
        return Te.type = W, Te.arg = ae, ve ? (this.method = "next", this.next = ve.finallyLoc, ke) : this.complete(Te);
      }, complete: function(W, ae) {
        if (W.type === "throw") throw W.arg;
        return W.type === "break" || W.type === "continue" ? this.next = W.arg : W.type === "return" ? (this.rval = this.arg = W.arg, this.method = "return", this.next = "end") : W.type === "normal" && ae && (this.next = ae), ke;
      }, finish: function(W) {
        for (var ae = this.tryEntries.length - 1; ae >= 0; --ae) {
          var O = this.tryEntries[ae];
          if (O.finallyLoc === W) return this.complete(O.completion, O.afterLoc), ee(O), ke;
        }
      }, catch: function(W) {
        for (var ae = this.tryEntries.length - 1; ae >= 0; --ae) {
          var O = this.tryEntries[ae];
          if (O.tryLoc === W) {
            var ne = O.completion;
            if (ne.type === "throw") {
              var ve = ne.arg;
              ee(O);
            }
            return ve;
          }
        }
        throw Error("illegal catch attempt");
      }, delegateYield: function(W, ae, O) {
        return this.delegate = { iterator: be(W), resultName: ae, nextLoc: O }, this.method === "next" && (this.arg = y), ke;
      } }, g;
    }
    function i(y, g, S, X, F, T, Q) {
      try {
        var D = y[T](Q), j = D.value;
      } catch (te) {
        return void S(te);
      }
      D.done ? g(j) : Promise.resolve(j).then(X, F);
    }
    function l(y) {
      return function() {
        var g = this, S = arguments;
        return new Promise(function(X, F) {
          var T = y.apply(g, S);
          function Q(j) {
            i(T, X, F, Q, D, "next", j);
          }
          function D(j) {
            i(T, X, F, Q, D, "throw", j);
          }
          Q(void 0);
        });
      };
    }
    function a(y, g) {
      if (!(y instanceof g)) throw new TypeError("Cannot call a class as a function");
    }
    function n(y, g) {
      for (var S = 0; S < g.length; S++) {
        var X = g[S];
        X.enumerable = X.enumerable || !1, X.configurable = !0, "value" in X && (X.writable = !0), Object.defineProperty(y, x(X.key), X);
      }
    }
    function c(y, g, S) {
      return g && n(y.prototype, g), Object.defineProperty(y, "prototype", { writable: !1 }), y;
    }
    function x(y) {
      var g = v(y, "string");
      return f(g) == "symbol" ? g : g + "";
    }
    function v(y, g) {
      if (f(y) != "object" || !y) return y;
      var S = y[Symbol.toPrimitive];
      if (S !== void 0) {
        var X = S.call(y, g);
        if (f(X) != "object") return X;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(y);
    }
    var b = /* @__PURE__ */ function() {
      function y() {
        a(this, y), this._cipher = null, this._counter = new Uint8Array(16);
      }
      return c(y, [{
        key: "setKey",
        value: function() {
          var g = l(/* @__PURE__ */ r().mark(function X(F) {
            return r().wrap(function(Q) {
              for (; ; ) switch (Q.prev = Q.next) {
                case 0:
                  return Q.next = 2, A.default.importKey("raw", F, {
                    name: "AES-EAX"
                  }, !1, ["encrypt, decrypt"]);
                case 2:
                  this._cipher = Q.sent;
                case 3:
                case "end":
                  return Q.stop();
              }
            }, X, this);
          }));
          function S(X) {
            return g.apply(this, arguments);
          }
          return S;
        }()
      }, {
        key: "makeMessage",
        value: function() {
          var g = l(/* @__PURE__ */ r().mark(function X(F) {
            var T, Q, D, j;
            return r().wrap(function(he) {
              for (; ; ) switch (he.prev = he.next) {
                case 0:
                  return T = new Uint8Array([(F.length & 65280) >>> 8, F.length & 255]), he.next = 3, A.default.encrypt({
                    name: "AES-EAX",
                    iv: this._counter,
                    additionalData: T
                  }, this._cipher, F);
                case 3:
                  for (Q = he.sent, D = 0; D < 16 && this._counter[D]++ === 255; D++) ;
                  return j = new Uint8Array(F.length + 2 + 16), j.set(T), j.set(Q, 2), he.abrupt("return", j);
                case 9:
                case "end":
                  return he.stop();
              }
            }, X, this);
          }));
          function S(X) {
            return g.apply(this, arguments);
          }
          return S;
        }()
      }, {
        key: "receiveMessage",
        value: function() {
          var g = l(/* @__PURE__ */ r().mark(function X(F, T) {
            var Q, D, j;
            return r().wrap(function(he) {
              for (; ; ) switch (he.prev = he.next) {
                case 0:
                  return Q = new Uint8Array([(F & 65280) >>> 8, F & 255]), he.next = 3, A.default.decrypt({
                    name: "AES-EAX",
                    iv: this._counter,
                    additionalData: Q
                  }, this._cipher, T);
                case 3:
                  for (D = he.sent, j = 0; j < 16 && this._counter[j]++ === 255; j++) ;
                  return he.abrupt("return", D);
                case 6:
                case "end":
                  return he.stop();
              }
            }, X, this);
          }));
          function S(X, F) {
            return g.apply(this, arguments);
          }
          return S;
        }()
      }]);
    }();
    P.default = /* @__PURE__ */ function(y) {
      function g(S, X) {
        var F;
        return a(this, g), F = I(this, g), F._hasStarted = !1, F._checkSock = null, F._checkCredentials = null, F._approveServerResolve = null, F._sockReject = null, F._credentialsReject = null, F._approveServerReject = null, F._sock = S, F._getCredentials = X, F;
      }
      return s(g, y), c(g, [{
        key: "_waitSockAsync",
        value: function(X) {
          var F = this;
          return new Promise(function(T, Q) {
            var D = function() {
              return !F._sock.rQwait("RA2", X);
            };
            D() ? T() : (F._checkSock = function() {
              D() && (T(), F._checkSock = null, F._sockReject = null);
            }, F._sockReject = Q);
          });
        }
      }, {
        key: "_waitApproveKeyAsync",
        value: function() {
          var X = this;
          return new Promise(function(F, T) {
            X._approveServerResolve = F, X._approveServerReject = T;
          });
        }
      }, {
        key: "_waitCredentialsAsync",
        value: function(X) {
          var F = this, T = function() {
            return X === 1 && F._getCredentials().username !== void 0 && F._getCredentials().password !== void 0 ? !0 : X === 2 && F._getCredentials().password !== void 0;
          };
          return new Promise(function(Q, D) {
            T() ? Q() : (F._checkCredentials = function() {
              T() && (Q(), F._checkCredentials = null, F._credentialsReject = null);
            }, F._credentialsReject = D);
          });
        }
      }, {
        key: "checkInternalEvents",
        value: function() {
          this._checkSock !== null && this._checkSock(), this._checkCredentials !== null && this._checkCredentials();
        }
      }, {
        key: "approveServer",
        value: function() {
          this._approveServerResolve !== null && (this._approveServerResolve(), this._approveServerResolve = null);
        }
      }, {
        key: "disconnect",
        value: function() {
          this._sockReject !== null && (this._sockReject(new Error("disconnect normally")), this._sockReject = null), this._credentialsReject !== null && (this._credentialsReject(new Error("disconnect normally")), this._credentialsReject = null), this._approveServerReject !== null && (this._approveServerReject(new Error("disconnect normally")), this._approveServerReject = null);
        }
      }, {
        key: "negotiateRA2neAuthAsync",
        value: function() {
          var S = l(/* @__PURE__ */ r().mark(function F() {
            var T, Q, D, j, te, he, ge, pe, we, Ae, de, ke, Ce, Oe, J, $, re, z, B, U, ue, le, H, q, ee, ie, be, V, W, ae, O, ne, ve, Te, Ge;
            return r().wrap(function(xe) {
              for (; ; ) switch (xe.prev = xe.next) {
                case 0:
                  return this._hasStarted = !0, xe.next = 3, this._waitSockAsync(4);
                case 3:
                  if (T = this._sock.rQpeekBytes(4), Q = this._sock.rQshift32(), !(Q < 1024)) {
                    xe.next = 9;
                    break;
                  }
                  throw new Error("RA2: server public key is too short: " + Q);
                case 9:
                  if (!(Q > 8192)) {
                    xe.next = 11;
                    break;
                  }
                  throw new Error("RA2: server public key is too long: " + Q);
                case 11:
                  return D = Math.ceil(Q / 8), xe.next = 14, this._waitSockAsync(D * 2);
                case 14:
                  return j = this._sock.rQshiftBytes(D), te = this._sock.rQshiftBytes(D), xe.next = 18, A.default.importKey("raw", {
                    n: j,
                    e: te
                  }, {
                    name: "RSA-PKCS1-v1_5"
                  }, !1, ["encrypt"]);
                case 18:
                  return he = xe.sent, ge = new Uint8Array(4 + D * 2), ge.set(T), ge.set(j, 4), ge.set(te, 4 + D), pe = this._waitApproveKeyAsync(), this.dispatchEvent(new CustomEvent("serververification", {
                    detail: {
                      type: "RSA",
                      publickey: ge
                    }
                  })), xe.next = 27, pe;
                case 27:
                  return we = 2048, Ae = Math.ceil(we / 8), xe.next = 31, A.default.generateKey({
                    name: "RSA-PKCS1-v1_5",
                    modulusLength: we,
                    publicExponent: new Uint8Array([1, 0, 1])
                  }, !0, ["encrypt"]);
                case 31:
                  return de = xe.sent.privateKey, xe.next = 34, A.default.exportKey("raw", de);
                case 34:
                  return ke = xe.sent, Ce = ke.n, Oe = ke.e, J = new Uint8Array(4 + Ae * 2), J[0] = (we & 4278190080) >>> 24, J[1] = (we & 16711680) >>> 16, J[2] = (we & 65280) >>> 8, J[3] = we & 255, J.set(Ce, 4), J.set(Oe, 4 + Ae), this._sock.sQpushBytes(J), this._sock.flush(), $ = new Uint8Array(16), window.crypto.getRandomValues($), xe.next = 50, A.default.encrypt({
                    name: "RSA-PKCS1-v1_5"
                  }, he, $);
                case 50:
                  return re = xe.sent, z = new Uint8Array(2 + D), z[0] = (D & 65280) >>> 8, z[1] = D & 255, z.set(re, 2), this._sock.sQpushBytes(z), this._sock.flush(), xe.next = 59, this._waitSockAsync(2);
                case 59:
                  if (this._sock.rQshift16() === Ae) {
                    xe.next = 61;
                    break;
                  }
                  throw new Error("RA2: wrong encrypted message length");
                case 61:
                  return B = this._sock.rQshiftBytes(Ae), xe.next = 64, A.default.decrypt({
                    name: "RSA-PKCS1-v1_5"
                  }, de, B);
                case 64:
                  if (U = xe.sent, !(U === null || U.length !== 16)) {
                    xe.next = 67;
                    break;
                  }
                  throw new Error("RA2: corrupted server encrypted random");
                case 67:
                  return ue = new Uint8Array(32), le = new Uint8Array(32), ue.set(U), ue.set($, 16), le.set($), le.set(U, 16), xe.next = 75, window.crypto.subtle.digest("SHA-1", ue);
                case 75:
                  return ue = xe.sent, ue = new Uint8Array(ue).slice(0, 16), xe.next = 79, window.crypto.subtle.digest("SHA-1", le);
                case 79:
                  return le = xe.sent, le = new Uint8Array(le).slice(0, 16), H = new b(), xe.next = 84, H.setKey(ue);
                case 84:
                  return q = new b(), xe.next = 87, q.setKey(le);
                case 87:
                  return ee = new Uint8Array(8 + D * 2 + Ae * 2), ie = new Uint8Array(8 + D * 2 + Ae * 2), ee.set(ge), ee.set(J, 4 + D * 2), ie.set(J), ie.set(ge, 4 + Ae * 2), xe.next = 95, window.crypto.subtle.digest("SHA-1", ee);
                case 95:
                  return ee = xe.sent, xe.next = 98, window.crypto.subtle.digest("SHA-1", ie);
                case 98:
                  return ie = xe.sent, ee = new Uint8Array(ee), ie = new Uint8Array(ie), xe.t0 = this._sock, xe.next = 104, H.makeMessage(ie);
                case 104:
                  return xe.t1 = xe.sent, xe.t0.sQpushBytes.call(xe.t0, xe.t1), this._sock.flush(), xe.next = 109, this._waitSockAsync(38);
                case 109:
                  if (this._sock.rQshift16() === 20) {
                    xe.next = 111;
                    break;
                  }
                  throw new Error("RA2: wrong server hash");
                case 111:
                  return xe.next = 113, q.receiveMessage(20, this._sock.rQshiftBytes(36));
                case 113:
                  if (be = xe.sent, be !== null) {
                    xe.next = 116;
                    break;
                  }
                  throw new Error("RA2: failed to authenticate the message");
                case 116:
                  V = 0;
                case 117:
                  if (!(V < 20)) {
                    xe.next = 123;
                    break;
                  }
                  if (be[V] === ee[V]) {
                    xe.next = 120;
                    break;
                  }
                  throw new Error("RA2: wrong server hash");
                case 120:
                  V++, xe.next = 117;
                  break;
                case 123:
                  return xe.next = 125, this._waitSockAsync(19);
                case 125:
                  if (this._sock.rQshift16() === 1) {
                    xe.next = 127;
                    break;
                  }
                  throw new Error("RA2: wrong subtype");
                case 127:
                  return xe.next = 129, q.receiveMessage(1, this._sock.rQshiftBytes(17));
                case 129:
                  if (W = xe.sent, W !== null) {
                    xe.next = 132;
                    break;
                  }
                  throw new Error("RA2: failed to authenticate the message");
                case 132:
                  if (W = W[0], ae = this._waitCredentialsAsync(W), W !== 1) {
                    xe.next = 138;
                    break;
                  }
                  (this._getCredentials().username === void 0 || this._getCredentials().password === void 0) && this.dispatchEvent(new CustomEvent("credentialsrequired", {
                    detail: {
                      types: ["username", "password"]
                    }
                  })), xe.next = 143;
                  break;
                case 138:
                  if (W !== 2) {
                    xe.next = 142;
                    break;
                  }
                  this._getCredentials().password === void 0 && this.dispatchEvent(new CustomEvent("credentialsrequired", {
                    detail: {
                      types: ["password"]
                    }
                  })), xe.next = 143;
                  break;
                case 142:
                  throw new Error("RA2: wrong subtype");
                case 143:
                  return xe.next = 145, ae;
                case 145:
                  for (W === 1 ? O = (0, h.encodeUTF8)(this._getCredentials().username).slice(0, 255) : O = "", ne = (0, h.encodeUTF8)(this._getCredentials().password).slice(0, 255), ve = new Uint8Array(O.length + ne.length + 2), ve[0] = O.length, ve[O.length + 1] = ne.length, Te = 0; Te < O.length; Te++)
                    ve[Te + 1] = O.charCodeAt(Te);
                  for (Ge = 0; Ge < ne.length; Ge++)
                    ve[O.length + 2 + Ge] = ne.charCodeAt(Ge);
                  return xe.t2 = this._sock, xe.next = 155, H.makeMessage(ve);
                case 155:
                  xe.t3 = xe.sent, xe.t2.sQpushBytes.call(xe.t2, xe.t3), this._sock.flush();
                case 158:
                case "end":
                  return xe.stop();
              }
            }, F, this);
          }));
          function X() {
            return S.apply(this, arguments);
          }
          return X;
        }()
      }, {
        key: "hasStarted",
        get: function() {
          return this._hasStarted;
        },
        set: function(X) {
          this._hasStarted = X;
        }
      }]);
    }(Y.default);
  }(nr)), nr;
}
var ar = {}, nn;
function ii() {
  return nn || (nn = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    function h(C) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(u) {
        return typeof u;
      } : function(u) {
        return u && typeof Symbol == "function" && u.constructor === Symbol && u !== Symbol.prototype ? "symbol" : typeof u;
      }, h(C);
    }
    function Y(C, u) {
      if (!(C instanceof u)) throw new TypeError("Cannot call a class as a function");
    }
    function A(C, u) {
      for (var _ = 0; _ < u.length; _++) {
        var s = u[_];
        s.enumerable = s.enumerable || !1, s.configurable = !0, "value" in s && (s.writable = !0), Object.defineProperty(C, I(s.key), s);
      }
    }
    function K(C, u, _) {
      return u && A(C.prototype, u), Object.defineProperty(C, "prototype", { writable: !1 }), C;
    }
    function I(C) {
      var u = L(C, "string");
      return h(u) == "symbol" ? u : u + "";
    }
    function L(C, u) {
      if (h(C) != "object" || !C) return C;
      var _ = C[Symbol.toPrimitive];
      if (_ !== void 0) {
        var s = _.call(C, u);
        if (h(s) != "object") return s;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(C);
    }
    P.default = /* @__PURE__ */ function() {
      function C() {
        Y(this, C), this._lines = 0;
      }
      return K(C, [{
        key: "decodeRect",
        value: function(_, s, p, f, r, i, l) {
          if (p === 0 || f === 0)
            return !0;
          this._lines === 0 && (this._lines = f);
          for (var a = l == 8 ? 1 : 4, n = p * a; this._lines > 0; ) {
            if (r.rQwait("RAW", n))
              return !1;
            var c = s + (f - this._lines), x = r.rQshiftBytes(n, !1);
            if (l == 8) {
              for (var v = new Uint8Array(p * 4), b = 0; b < p; b++)
                v[b * 4 + 0] = (x[b] >> 0 & 3) * 255 / 3, v[b * 4 + 1] = (x[b] >> 2 & 3) * 255 / 3, v[b * 4 + 2] = (x[b] >> 4 & 3) * 255 / 3, v[b * 4 + 3] = 255;
              x = v;
            }
            for (var y = 0; y < p; y++)
              x[y * 4 + 3] = 255;
            i.blitImage(_, c, p, 1, x, 0), this._lines--;
          }
          return !0;
        }
      }]);
    }();
  }(ar)), ar;
}
var or = {}, an;
function ai() {
  return an || (an = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    function h(C) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(u) {
        return typeof u;
      } : function(u) {
        return u && typeof Symbol == "function" && u.constructor === Symbol && u !== Symbol.prototype ? "symbol" : typeof u;
      }, h(C);
    }
    function Y(C, u) {
      if (!(C instanceof u)) throw new TypeError("Cannot call a class as a function");
    }
    function A(C, u) {
      for (var _ = 0; _ < u.length; _++) {
        var s = u[_];
        s.enumerable = s.enumerable || !1, s.configurable = !0, "value" in s && (s.writable = !0), Object.defineProperty(C, I(s.key), s);
      }
    }
    function K(C, u, _) {
      return u && A(C.prototype, u), Object.defineProperty(C, "prototype", { writable: !1 }), C;
    }
    function I(C) {
      var u = L(C, "string");
      return h(u) == "symbol" ? u : u + "";
    }
    function L(C, u) {
      if (h(C) != "object" || !C) return C;
      var _ = C[Symbol.toPrimitive];
      if (_ !== void 0) {
        var s = _.call(C, u);
        if (h(s) != "object") return s;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(C);
    }
    P.default = /* @__PURE__ */ function() {
      function C() {
        Y(this, C);
      }
      return K(C, [{
        key: "decodeRect",
        value: function(_, s, p, f, r, i, l) {
          if (r.rQwait("COPYRECT", 4))
            return !1;
          var a = r.rQshift16(), n = r.rQshift16();
          return p === 0 || f === 0 || i.copyImage(a, n, _, s, p, f), !0;
        }
      }]);
    }();
  }(or)), or;
}
var sr = {}, on;
function oi() {
  return on || (on = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    function h(C) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(u) {
        return typeof u;
      } : function(u) {
        return u && typeof Symbol == "function" && u.constructor === Symbol && u !== Symbol.prototype ? "symbol" : typeof u;
      }, h(C);
    }
    function Y(C, u) {
      if (!(C instanceof u)) throw new TypeError("Cannot call a class as a function");
    }
    function A(C, u) {
      for (var _ = 0; _ < u.length; _++) {
        var s = u[_];
        s.enumerable = s.enumerable || !1, s.configurable = !0, "value" in s && (s.writable = !0), Object.defineProperty(C, I(s.key), s);
      }
    }
    function K(C, u, _) {
      return u && A(C.prototype, u), Object.defineProperty(C, "prototype", { writable: !1 }), C;
    }
    function I(C) {
      var u = L(C, "string");
      return h(u) == "symbol" ? u : u + "";
    }
    function L(C, u) {
      if (h(C) != "object" || !C) return C;
      var _ = C[Symbol.toPrimitive];
      if (_ !== void 0) {
        var s = _.call(C, u);
        if (h(s) != "object") return s;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(C);
    }
    P.default = /* @__PURE__ */ function() {
      function C() {
        Y(this, C), this._subrects = 0;
      }
      return K(C, [{
        key: "decodeRect",
        value: function(_, s, p, f, r, i, l) {
          if (this._subrects === 0) {
            if (r.rQwait("RRE", 8))
              return !1;
            this._subrects = r.rQshift32();
            var a = r.rQshiftBytes(4);
            i.fillRect(_, s, p, f, a);
          }
          for (; this._subrects > 0; ) {
            if (r.rQwait("RRE", 12))
              return !1;
            var n = r.rQshiftBytes(4), c = r.rQshift16(), x = r.rQshift16(), v = r.rQshift16(), b = r.rQshift16();
            i.fillRect(_ + c, s + x, v, b, n), this._subrects--;
          }
          return !0;
        }
      }]);
    }();
  }(sr)), sr;
}
var ur = {}, sn;
function si() {
  return sn || (sn = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = A(ht());
    function Y(s) {
      if (typeof WeakMap != "function") return null;
      var p = /* @__PURE__ */ new WeakMap(), f = /* @__PURE__ */ new WeakMap();
      return (Y = function(i) {
        return i ? f : p;
      })(s);
    }
    function A(s, p) {
      if (s && s.__esModule) return s;
      if (s === null || K(s) != "object" && typeof s != "function") return { default: s };
      var f = Y(p);
      if (f && f.has(s)) return f.get(s);
      var r = { __proto__: null }, i = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var l in s) if (l !== "default" && {}.hasOwnProperty.call(s, l)) {
        var a = i ? Object.getOwnPropertyDescriptor(s, l) : null;
        a && (a.get || a.set) ? Object.defineProperty(r, l, a) : r[l] = s[l];
      }
      return r.default = s, f && f.set(s, r), r;
    }
    function K(s) {
      "@babel/helpers - typeof";
      return K = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(p) {
        return typeof p;
      } : function(p) {
        return p && typeof Symbol == "function" && p.constructor === Symbol && p !== Symbol.prototype ? "symbol" : typeof p;
      }, K(s);
    }
    function I(s, p) {
      if (!(s instanceof p)) throw new TypeError("Cannot call a class as a function");
    }
    function L(s, p) {
      for (var f = 0; f < p.length; f++) {
        var r = p[f];
        r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(s, u(r.key), r);
      }
    }
    function C(s, p, f) {
      return p && L(s.prototype, p), Object.defineProperty(s, "prototype", { writable: !1 }), s;
    }
    function u(s) {
      var p = _(s, "string");
      return K(p) == "symbol" ? p : p + "";
    }
    function _(s, p) {
      if (K(s) != "object" || !s) return s;
      var f = s[Symbol.toPrimitive];
      if (f !== void 0) {
        var r = f.call(s, p);
        if (K(r) != "object") return r;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(s);
    }
    P.default = /* @__PURE__ */ function() {
      function s() {
        I(this, s), this._tiles = 0, this._lastsubencoding = 0, this._tileBuffer = new Uint8Array(16 * 16 * 4);
      }
      return C(s, [{
        key: "decodeRect",
        value: function(f, r, i, l, a, n, c) {
          for (this._tiles === 0 && (this._tilesX = Math.ceil(i / 16), this._tilesY = Math.ceil(l / 16), this._totalTiles = this._tilesX * this._tilesY, this._tiles = this._totalTiles); this._tiles > 0; ) {
            var x = 1;
            if (a.rQwait("HEXTILE", x))
              return !1;
            var v = a.rQpeek8();
            if (v > 30)
              throw new Error("Illegal hextile subencoding (subencoding: " + v + ")");
            var b = this._totalTiles - this._tiles, y = b % this._tilesX, g = Math.floor(b / this._tilesX), S = f + y * 16, X = r + g * 16, F = Math.min(16, f + i - S), T = Math.min(16, r + l - X);
            if (v & 1)
              x += F * T * 4;
            else if (v & 2 && (x += 4), v & 4 && (x += 4), v & 8) {
              if (x++, a.rQwait("HEXTILE", x))
                return !1;
              var Q = a.rQpeekBytes(x).at(-1);
              v & 16 ? x += Q * 6 : x += Q * 2;
            }
            if (a.rQwait("HEXTILE", x))
              return !1;
            if (a.rQshift8(), v === 0)
              this._lastsubencoding & 1 ? h.Debug("     Ignoring blank after RAW") : n.fillRect(S, X, F, T, this._background);
            else if (v & 1) {
              for (var D = F * T, j = a.rQshiftBytes(D * 4, !1), te = 0; te < D; te++)
                j[te * 4 + 3] = 255;
              n.blitImage(S, X, F, T, j, 0);
            } else {
              if (v & 2 && (this._background = new Uint8Array(a.rQshiftBytes(4))), v & 4 && (this._foreground = new Uint8Array(a.rQshiftBytes(4))), this._startTile(S, X, F, T, this._background), v & 8)
                for (var he = a.rQshift8(), ge = 0; ge < he; ge++) {
                  var pe = void 0;
                  v & 16 ? pe = a.rQshiftBytes(4) : pe = this._foreground;
                  var we = a.rQshift8(), Ae = we >> 4, de = we & 15, ke = a.rQshift8(), Ce = (ke >> 4) + 1, Oe = (ke & 15) + 1;
                  this._subTile(Ae, de, Ce, Oe, pe);
                }
              this._finishTile(n);
            }
            this._lastsubencoding = v, this._tiles--;
          }
          return !0;
        }
        // start updating a tile
      }, {
        key: "_startTile",
        value: function(f, r, i, l, a) {
          this._tileX = f, this._tileY = r, this._tileW = i, this._tileH = l;
          for (var n = a[0], c = a[1], x = a[2], v = this._tileBuffer, b = 0; b < i * l * 4; b += 4)
            v[b] = n, v[b + 1] = c, v[b + 2] = x, v[b + 3] = 255;
        }
        // update sub-rectangle of the current tile
      }, {
        key: "_subTile",
        value: function(f, r, i, l, a) {
          for (var n = a[0], c = a[1], x = a[2], v = f + i, b = r + l, y = this._tileBuffer, g = this._tileW, S = r; S < b; S++)
            for (var X = f; X < v; X++) {
              var F = (X + S * g) * 4;
              y[F] = n, y[F + 1] = c, y[F + 2] = x, y[F + 3] = 255;
            }
        }
        // draw the current tile to the screen
      }, {
        key: "_finishTile",
        value: function(f) {
          f.blitImage(this._tileX, this._tileY, this._tileW, this._tileH, this._tileBuffer, 0);
        }
      }]);
    }();
  }(ur)), ur;
}
var lr = {}, un;
function kn() {
  return un || (un = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = I(ht()), Y = A(dr());
    function A(f) {
      return f && f.__esModule ? f : { default: f };
    }
    function K(f) {
      if (typeof WeakMap != "function") return null;
      var r = /* @__PURE__ */ new WeakMap(), i = /* @__PURE__ */ new WeakMap();
      return (K = function(a) {
        return a ? i : r;
      })(f);
    }
    function I(f, r) {
      if (f && f.__esModule) return f;
      if (f === null || L(f) != "object" && typeof f != "function") return { default: f };
      var i = K(r);
      if (i && i.has(f)) return i.get(f);
      var l = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var n in f) if (n !== "default" && {}.hasOwnProperty.call(f, n)) {
        var c = a ? Object.getOwnPropertyDescriptor(f, n) : null;
        c && (c.get || c.set) ? Object.defineProperty(l, n, c) : l[n] = f[n];
      }
      return l.default = f, i && i.set(f, l), l;
    }
    function L(f) {
      "@babel/helpers - typeof";
      return L = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(r) {
        return typeof r;
      } : function(r) {
        return r && typeof Symbol == "function" && r.constructor === Symbol && r !== Symbol.prototype ? "symbol" : typeof r;
      }, L(f);
    }
    function C(f, r) {
      if (!(f instanceof r)) throw new TypeError("Cannot call a class as a function");
    }
    function u(f, r) {
      for (var i = 0; i < r.length; i++) {
        var l = r[i];
        l.enumerable = l.enumerable || !1, l.configurable = !0, "value" in l && (l.writable = !0), Object.defineProperty(f, s(l.key), l);
      }
    }
    function _(f, r, i) {
      return r && u(f.prototype, r), Object.defineProperty(f, "prototype", { writable: !1 }), f;
    }
    function s(f) {
      var r = p(f, "string");
      return L(r) == "symbol" ? r : r + "";
    }
    function p(f, r) {
      if (L(f) != "object" || !f) return f;
      var i = f[Symbol.toPrimitive];
      if (i !== void 0) {
        var l = i.call(f, r);
        if (L(l) != "object") return l;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(f);
    }
    P.default = /* @__PURE__ */ function() {
      function f() {
        C(this, f), this._ctl = null, this._filter = null, this._numColors = 0, this._palette = new Uint8Array(1024), this._len = 0, this._zlibs = [];
        for (var r = 0; r < 4; r++)
          this._zlibs[r] = new Y.default();
      }
      return _(f, [{
        key: "decodeRect",
        value: function(i, l, a, n, c, x, v) {
          if (this._ctl === null) {
            if (c.rQwait("TIGHT compression-control", 1))
              return !1;
            this._ctl = c.rQshift8();
            for (var b = 0; b < 4; b++)
              this._ctl >> b & 1 && (this._zlibs[b].reset(), h.Info("Reset zlib stream " + b));
            this._ctl = this._ctl >> 4;
          }
          var y;
          if (this._ctl === 8)
            y = this._fillRect(i, l, a, n, c, x, v);
          else if (this._ctl === 9)
            y = this._jpegRect(i, l, a, n, c, x, v);
          else if (this._ctl === 10)
            y = this._pngRect(i, l, a, n, c, x, v);
          else if ((this._ctl & 8) == 0)
            y = this._basicRect(this._ctl, i, l, a, n, c, x, v);
          else
            throw new Error("Illegal tight compression received (ctl: " + this._ctl + ")");
          return y && (this._ctl = null), y;
        }
      }, {
        key: "_fillRect",
        value: function(i, l, a, n, c, x, v) {
          if (c.rQwait("TIGHT", 3))
            return !1;
          var b = c.rQshiftBytes(3);
          return x.fillRect(i, l, a, n, b, !1), !0;
        }
      }, {
        key: "_jpegRect",
        value: function(i, l, a, n, c, x, v) {
          var b = this._readData(c);
          return b === null ? !1 : (x.imageRect(i, l, a, n, "image/jpeg", b), !0);
        }
      }, {
        key: "_pngRect",
        value: function(i, l, a, n, c, x, v) {
          throw new Error("PNG received in standard Tight rect");
        }
      }, {
        key: "_basicRect",
        value: function(i, l, a, n, c, x, v, b) {
          if (this._filter === null)
            if (i & 4) {
              if (x.rQwait("TIGHT", 1))
                return !1;
              this._filter = x.rQshift8();
            } else
              this._filter = 0;
          var y = i & 3, g;
          switch (this._filter) {
            case 0:
              g = this._copyFilter(y, l, a, n, c, x, v, b);
              break;
            case 1:
              g = this._paletteFilter(y, l, a, n, c, x, v, b);
              break;
            case 2:
              g = this._gradientFilter(y, l, a, n, c, x, v, b);
              break;
            default:
              throw new Error("Illegal tight filter received (ctl: " + this._filter + ")");
          }
          return g && (this._filter = null), g;
        }
      }, {
        key: "_copyFilter",
        value: function(i, l, a, n, c, x, v, b) {
          var y = n * c * 3, g;
          if (y === 0)
            return !0;
          if (y < 12) {
            if (x.rQwait("TIGHT", y))
              return !1;
            g = x.rQshiftBytes(y);
          } else {
            if (g = this._readData(x), g === null)
              return !1;
            this._zlibs[i].setInput(g), g = this._zlibs[i].inflate(y), this._zlibs[i].setInput(null);
          }
          for (var S = new Uint8Array(n * c * 4), X = 0, F = 0; X < n * c * 4; X += 4, F += 3)
            S[X] = g[F], S[X + 1] = g[F + 1], S[X + 2] = g[F + 2], S[X + 3] = 255;
          return v.blitImage(l, a, n, c, S, 0, !1), !0;
        }
      }, {
        key: "_paletteFilter",
        value: function(i, l, a, n, c, x, v, b) {
          if (this._numColors === 0) {
            if (x.rQwait("TIGHT palette", 1))
              return !1;
            var y = x.rQpeek8() + 1, g = y * 3;
            if (x.rQwait("TIGHT palette", 1 + g))
              return !1;
            this._numColors = y, x.rQskipBytes(1), x.rQshiftTo(this._palette, g);
          }
          var S = this._numColors <= 2 ? 1 : 8, X = Math.floor((n * S + 7) / 8), F = X * c, T;
          if (F === 0)
            return !0;
          if (F < 12) {
            if (x.rQwait("TIGHT", F))
              return !1;
            T = x.rQshiftBytes(F);
          } else {
            if (T = this._readData(x), T === null)
              return !1;
            this._zlibs[i].setInput(T), T = this._zlibs[i].inflate(F), this._zlibs[i].setInput(null);
          }
          return this._numColors == 2 ? this._monoRect(l, a, n, c, T, this._palette, v) : this._paletteRect(l, a, n, c, T, this._palette, v), this._numColors = 0, !0;
        }
      }, {
        key: "_monoRect",
        value: function(i, l, a, n, c, x, v) {
          for (var b = this._getScratchBuffer(a * n * 4), y = Math.floor((a + 7) / 8), g = Math.floor(a / 8), S = 0; S < n; S++) {
            var X = void 0, F = void 0, T = void 0;
            for (T = 0; T < g; T++)
              for (var Q = 7; Q >= 0; Q--)
                X = (S * a + T * 8 + 7 - Q) * 4, F = (c[S * y + T] >> Q & 1) * 3, b[X] = x[F], b[X + 1] = x[F + 1], b[X + 2] = x[F + 2], b[X + 3] = 255;
            for (var D = 7; D >= 8 - a % 8; D--)
              X = (S * a + T * 8 + 7 - D) * 4, F = (c[S * y + T] >> D & 1) * 3, b[X] = x[F], b[X + 1] = x[F + 1], b[X + 2] = x[F + 2], b[X + 3] = 255;
          }
          v.blitImage(i, l, a, n, b, 0, !1);
        }
      }, {
        key: "_paletteRect",
        value: function(i, l, a, n, c, x, v) {
          for (var b = this._getScratchBuffer(a * n * 4), y = a * n * 4, g = 0, S = 0; g < y; g += 4, S++) {
            var X = c[S] * 3;
            b[g] = x[X], b[g + 1] = x[X + 1], b[g + 2] = x[X + 2], b[g + 3] = 255;
          }
          v.blitImage(i, l, a, n, b, 0, !1);
        }
      }, {
        key: "_gradientFilter",
        value: function(i, l, a, n, c, x, v, b) {
          var y = n * c * 3, g;
          if (y === 0)
            return !0;
          if (y < 12) {
            if (x.rQwait("TIGHT", y))
              return !1;
            g = x.rQshiftBytes(y);
          } else {
            if (g = this._readData(x), g === null)
              return !1;
            this._zlibs[i].setInput(g), g = this._zlibs[i].inflate(y), this._zlibs[i].setInput(null);
          }
          for (var S = new Uint8Array(4 * n * c), X = 0, F = 0, T = new Uint8Array(3), Q = 0; Q < n; Q++) {
            for (var D = 0; D < 3; D++) {
              var j = T[D], te = g[F++] + j;
              S[X++] = te, T[D] = te;
            }
            S[X++] = 255;
          }
          for (var he = 0, ge = new Uint8Array(3), pe = new Uint8Array(3), we = 1; we < c; we++) {
            T.fill(0), pe.fill(0);
            for (var Ae = 0; Ae < n; Ae++) {
              for (var de = 0; de < 3; de++) {
                ge[de] = S[he++];
                var ke = T[de] + ge[de] - pe[de];
                ke < 0 ? ke = 0 : ke > 255 && (ke = 255);
                var Ce = g[F++] + ke;
                S[X++] = Ce, pe[de] = ge[de], T[de] = Ce;
              }
              S[X++] = 255, he++;
            }
          }
          return v.blitImage(l, a, n, c, S, 0, !1), !0;
        }
      }, {
        key: "_readData",
        value: function(i) {
          if (this._len === 0) {
            if (i.rQwait("TIGHT", 3))
              return null;
            var l;
            l = i.rQshift8(), this._len = l & 127, l & 128 && (l = i.rQshift8(), this._len |= (l & 127) << 7, l & 128 && (l = i.rQshift8(), this._len |= l << 14));
          }
          if (i.rQwait("TIGHT", this._len))
            return null;
          var a = i.rQshiftBytes(this._len, !1);
          return this._len = 0, a;
        }
      }, {
        key: "_getScratchBuffer",
        value: function(i) {
          return (!this._scratchBuffer || this._scratchBuffer.length < i) && (this._scratchBuffer = new Uint8Array(i)), this._scratchBuffer;
        }
      }]);
    }();
  }(lr)), lr;
}
var fr = {}, ln;
function ui() {
  return ln || (ln = 1, function(P) {
    function h(a) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(n) {
        return typeof n;
      } : function(n) {
        return n && typeof Symbol == "function" && n.constructor === Symbol && n !== Symbol.prototype ? "symbol" : typeof n;
      }, h(a);
    }
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var Y = A(kn());
    function A(a) {
      return a && a.__esModule ? a : { default: a };
    }
    function K(a, n) {
      if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
    }
    function I(a, n) {
      for (var c = 0; c < n.length; c++) {
        var x = n[c];
        x.enumerable = x.enumerable || !1, x.configurable = !0, "value" in x && (x.writable = !0), Object.defineProperty(a, C(x.key), x);
      }
    }
    function L(a, n, c) {
      return n && I(a.prototype, n), Object.defineProperty(a, "prototype", { writable: !1 }), a;
    }
    function C(a) {
      var n = u(a, "string");
      return h(n) == "symbol" ? n : n + "";
    }
    function u(a, n) {
      if (h(a) != "object" || !a) return a;
      var c = a[Symbol.toPrimitive];
      if (c !== void 0) {
        var x = c.call(a, n);
        if (h(x) != "object") return x;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(a);
    }
    function _(a, n, c) {
      return n = r(n), s(a, f() ? Reflect.construct(n, c || [], r(a).constructor) : n.apply(a, c));
    }
    function s(a, n) {
      if (n && (h(n) == "object" || typeof n == "function")) return n;
      if (n !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
      return p(a);
    }
    function p(a) {
      if (a === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
      return a;
    }
    function f() {
      try {
        var a = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
        }));
      } catch {
      }
      return (f = function() {
        return !!a;
      })();
    }
    function r(a) {
      return r = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(n) {
        return n.__proto__ || Object.getPrototypeOf(n);
      }, r(a);
    }
    function i(a, n) {
      if (typeof n != "function" && n !== null) throw new TypeError("Super expression must either be null or a function");
      a.prototype = Object.create(n && n.prototype, { constructor: { value: a, writable: !0, configurable: !0 } }), Object.defineProperty(a, "prototype", { writable: !1 }), n && l(a, n);
    }
    function l(a, n) {
      return l = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(c, x) {
        return c.__proto__ = x, c;
      }, l(a, n);
    }
    P.default = /* @__PURE__ */ function(a) {
      function n() {
        return K(this, n), _(this, n, arguments);
      }
      return i(n, a), L(n, [{
        key: "_pngRect",
        value: function(x, v, b, y, g, S, X) {
          var F = this._readData(g);
          return F === null ? !1 : (S.imageRect(x, v, b, y, "image/png", F), !0);
        }
      }, {
        key: "_basicRect",
        value: function(x, v, b, y, g, S, X, F) {
          throw new Error("BasicCompression received in TightPNG rect");
        }
      }]);
    }(Y.default);
  }(fr)), fr;
}
var cr = {}, fn;
function li() {
  return fn || (fn = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var h = Y(dr());
    function Y(p) {
      return p && p.__esModule ? p : { default: p };
    }
    function A(p) {
      "@babel/helpers - typeof";
      return A = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(f) {
        return typeof f;
      } : function(f) {
        return f && typeof Symbol == "function" && f.constructor === Symbol && f !== Symbol.prototype ? "symbol" : typeof f;
      }, A(p);
    }
    function K(p, f) {
      if (!(p instanceof f)) throw new TypeError("Cannot call a class as a function");
    }
    function I(p, f) {
      for (var r = 0; r < f.length; r++) {
        var i = f[r];
        i.enumerable = i.enumerable || !1, i.configurable = !0, "value" in i && (i.writable = !0), Object.defineProperty(p, C(i.key), i);
      }
    }
    function L(p, f, r) {
      return f && I(p.prototype, f), Object.defineProperty(p, "prototype", { writable: !1 }), p;
    }
    function C(p) {
      var f = u(p, "string");
      return A(f) == "symbol" ? f : f + "";
    }
    function u(p, f) {
      if (A(p) != "object" || !p) return p;
      var r = p[Symbol.toPrimitive];
      if (r !== void 0) {
        var i = r.call(p, f);
        if (A(i) != "object") return i;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(p);
    }
    var _ = 64, s = 64;
    P.default = /* @__PURE__ */ function() {
      function p() {
        K(this, p), this._length = 0, this._inflator = new h.default(), this._pixelBuffer = new Uint8Array(_ * s * 4), this._tileBuffer = new Uint8Array(_ * s * 4);
      }
      return L(p, [{
        key: "decodeRect",
        value: function(r, i, l, a, n, c, x) {
          if (this._length === 0) {
            if (n.rQwait("ZLib data length", 4))
              return !1;
            this._length = n.rQshift32();
          }
          if (n.rQwait("Zlib data", this._length))
            return !1;
          var v = n.rQshiftBytes(this._length, !1);
          this._inflator.setInput(v);
          for (var b = i; b < i + a; b += s)
            for (var y = Math.min(s, i + a - b), g = r; g < r + l; g += _) {
              var S = Math.min(_, r + l - g), X = S * y, F = this._inflator.inflate(1)[0];
              if (F === 0) {
                var T = this._readPixels(X);
                c.blitImage(g, b, S, y, T, 0, !1);
              } else if (F === 1) {
                var Q = this._readPixels(1);
                c.fillRect(g, b, S, y, [Q[0], Q[1], Q[2]]);
              } else if (F >= 2 && F <= 16) {
                var D = this._decodePaletteTile(F, X, S, y);
                c.blitImage(g, b, S, y, D, 0, !1);
              } else if (F === 128) {
                var j = this._decodeRLETile(X);
                c.blitImage(g, b, S, y, j, 0, !1);
              } else if (F >= 130 && F <= 255) {
                var te = this._decodeRLEPaletteTile(F - 128, X);
                c.blitImage(g, b, S, y, te, 0, !1);
              } else
                throw new Error("Unknown subencoding: " + F);
            }
          return this._length = 0, !0;
        }
      }, {
        key: "_getBitsPerPixelInPalette",
        value: function(r) {
          if (r <= 2)
            return 1;
          if (r <= 4)
            return 2;
          if (r <= 16)
            return 4;
        }
      }, {
        key: "_readPixels",
        value: function(r) {
          for (var i = this._pixelBuffer, l = this._inflator.inflate(3 * r), a = 0, n = 0; a < r * 4; a += 4, n += 3)
            i[a] = l[n], i[a + 1] = l[n + 1], i[a + 2] = l[n + 2], i[a + 3] = 255;
          return i;
        }
      }, {
        key: "_decodePaletteTile",
        value: function(r, i, l, a) {
          for (var n = this._tileBuffer, c = this._readPixels(r), x = this._getBitsPerPixelInPalette(r), v = (1 << x) - 1, b = 0, y = this._inflator.inflate(1)[0], g = 0; g < a; g++) {
            for (var S = 8 - x, X = 0; X < l; X++) {
              S < 0 && (S = 8 - x, y = this._inflator.inflate(1)[0]);
              var F = y >> S & v;
              n[b] = c[F * 4], n[b + 1] = c[F * 4 + 1], n[b + 2] = c[F * 4 + 2], n[b + 3] = c[F * 4 + 3], b += 4, S -= x;
            }
            S < 8 - x && g < a - 1 && (y = this._inflator.inflate(1)[0]);
          }
          return n;
        }
      }, {
        key: "_decodeRLETile",
        value: function(r) {
          for (var i = this._tileBuffer, l = 0; l < r; )
            for (var a = this._readPixels(1), n = this._readRLELength(), c = 0; c < n; c++)
              i[l * 4] = a[0], i[l * 4 + 1] = a[1], i[l * 4 + 2] = a[2], i[l * 4 + 3] = a[3], l++;
          return i;
        }
      }, {
        key: "_decodeRLEPaletteTile",
        value: function(r, i) {
          for (var l = this._tileBuffer, a = this._readPixels(r), n = 0; n < i; ) {
            var c = this._inflator.inflate(1)[0], x = 1;
            if (c >= 128 && (c -= 128, x = this._readRLELength()), c > r)
              throw new Error("Too big index in palette: " + c + ", palette size: " + r);
            if (n + x > i)
              throw new Error("Too big rle length in palette mode: " + x + ", allowed length is: " + (i - n));
            for (var v = 0; v < x; v++)
              l[n * 4] = a[c * 4], l[n * 4 + 1] = a[c * 4 + 1], l[n * 4 + 2] = a[c * 4 + 2], l[n * 4 + 3] = a[c * 4 + 3], n++;
          }
          return l;
        }
      }, {
        key: "_readRLELength",
        value: function() {
          var r = 0, i = 0;
          do
            i = this._inflator.inflate(1)[0], r += i;
          while (i === 255);
          return r + 1;
        }
      }]);
    }();
  }(cr)), cr;
}
var hr = {}, cn;
function fi() {
  return cn || (cn = 1, function(P) {
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    function h(i) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(l) {
        return typeof l;
      } : function(l) {
        return l && typeof Symbol == "function" && l.constructor === Symbol && l !== Symbol.prototype ? "symbol" : typeof l;
      }, h(i);
    }
    function Y(i) {
      return I(i) || K(i) || C(i) || A();
    }
    function A() {
      throw new TypeError(`Invalid attempt to spread non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
    }
    function K(i) {
      if (typeof Symbol < "u" && i[Symbol.iterator] != null || i["@@iterator"] != null) return Array.from(i);
    }
    function I(i) {
      if (Array.isArray(i)) return u(i);
    }
    function L(i, l) {
      var a = typeof Symbol < "u" && i[Symbol.iterator] || i["@@iterator"];
      if (!a) {
        if (Array.isArray(i) || (a = C(i)) || l) {
          a && (i = a);
          var n = 0, c = function() {
          };
          return { s: c, n: function() {
            return n >= i.length ? { done: !0 } : { done: !1, value: i[n++] };
          }, e: function(g) {
            throw g;
          }, f: c };
        }
        throw new TypeError(`Invalid attempt to iterate non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
      }
      var x, v = !0, b = !1;
      return { s: function() {
        a = a.call(i);
      }, n: function() {
        var g = a.next();
        return v = g.done, g;
      }, e: function(g) {
        b = !0, x = g;
      }, f: function() {
        try {
          v || a.return == null || a.return();
        } finally {
          if (b) throw x;
        }
      } };
    }
    function C(i, l) {
      if (i) {
        if (typeof i == "string") return u(i, l);
        var a = {}.toString.call(i).slice(8, -1);
        return a === "Object" && i.constructor && (a = i.constructor.name), a === "Map" || a === "Set" ? Array.from(i) : a === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(a) ? u(i, l) : void 0;
      }
    }
    function u(i, l) {
      (l == null || l > i.length) && (l = i.length);
      for (var a = 0, n = Array(l); a < l; a++) n[a] = i[a];
      return n;
    }
    function _(i, l) {
      if (!(i instanceof l)) throw new TypeError("Cannot call a class as a function");
    }
    function s(i, l) {
      for (var a = 0; a < l.length; a++) {
        var n = l[a];
        n.enumerable = n.enumerable || !1, n.configurable = !0, "value" in n && (n.writable = !0), Object.defineProperty(i, f(n.key), n);
      }
    }
    function p(i, l, a) {
      return l && s(i.prototype, l), Object.defineProperty(i, "prototype", { writable: !1 }), i;
    }
    function f(i) {
      var l = r(i, "string");
      return h(l) == "symbol" ? l : l + "";
    }
    function r(i, l) {
      if (h(i) != "object" || !i) return i;
      var a = i[Symbol.toPrimitive];
      if (a !== void 0) {
        var n = a.call(i, l);
        if (h(n) != "object") return n;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(i);
    }
    P.default = /* @__PURE__ */ function() {
      function i() {
        _(this, i), this._cachedQuantTables = [], this._cachedHuffmanTables = [], this._segments = [];
      }
      return p(i, [{
        key: "decodeRect",
        value: function(a, n, c, x, v, b, y) {
          for (; ; ) {
            var g = this._readSegment(v);
            if (g === null)
              return !1;
            if (this._segments.push(g), g[1] === 217)
              break;
          }
          var S = [], X = [], F = L(this._segments), T;
          try {
            for (F.s(); !(T = F.n()).done; ) {
              var Q = T.value, D = Q[1];
              D === 196 ? S.push(Q) : D === 219 && X.push(Q);
            }
          } catch (J) {
            F.e(J);
          } finally {
            F.f();
          }
          var j = this._segments.findIndex(function(J) {
            return J[1] == 192 || J[1] == 194;
          });
          if (j == -1)
            throw new Error("Illegal JPEG image without SOF");
          if (X.length === 0) {
            var te;
            (te = this._segments).splice.apply(te, [j + 1, 0].concat(Y(this._cachedQuantTables)));
          }
          if (S.length === 0) {
            var he;
            (he = this._segments).splice.apply(he, [j + 1, 0].concat(Y(this._cachedHuffmanTables)));
          }
          var ge = 0, pe = L(this._segments), we;
          try {
            for (pe.s(); !(we = pe.n()).done; ) {
              var Ae = we.value;
              ge += Ae.length;
            }
          } catch (J) {
            pe.e(J);
          } finally {
            pe.f();
          }
          var de = new Uint8Array(ge);
          ge = 0;
          var ke = L(this._segments), Ce;
          try {
            for (ke.s(); !(Ce = ke.n()).done; ) {
              var Oe = Ce.value;
              de.set(Oe, ge), ge += Oe.length;
            }
          } catch (J) {
            ke.e(J);
          } finally {
            ke.f();
          }
          return b.imageRect(a, n, c, x, "image/jpeg", de), S.length !== 0 && (this._cachedHuffmanTables = S), X.length !== 0 && (this._cachedQuantTables = X), this._segments = [], !0;
        }
      }, {
        key: "_readSegment",
        value: function(a) {
          if (a.rQwait("JPEG", 2))
            return null;
          var n = a.rQshift8();
          if (n != 255)
            throw new Error("Illegal JPEG marker received (byte: " + n + ")");
          var c = a.rQshift8();
          if (c >= 208 && c <= 217 || c == 1)
            return new Uint8Array([n, c]);
          if (a.rQwait("JPEG", 2, 2))
            return null;
          var x = a.rQshift16();
          if (x < 2)
            throw new Error("Illegal JPEG length received (length: " + x + ")");
          if (a.rQwait("JPEG", x - 2, 4))
            return null;
          var v = 0;
          if (c === 218)
            for (v += 2; ; ) {
              if (a.rQwait("JPEG", x - 2 + v, 4))
                return null;
              var b = a.rQpeekBytes(x - 2 + v, !1);
              if (b.at(-2) === 255 && b.at(-1) !== 0 && !(b.at(-1) >= 208 && b.at(-1) <= 215)) {
                v -= 2;
                break;
              }
              v++;
            }
          var y = new Uint8Array(2 + x + v);
          return y[0] = n, y[1] = c, y[2] = x >> 8, y[3] = x, y.set(a.rQshiftBytes(x - 2 + v, !1), 4), y;
        }
      }]);
    }();
  }(hr)), hr;
}
var hn;
function ci() {
  return hn || (hn = 1, function(P) {
    function h(e) {
      "@babel/helpers - typeof";
      return h = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(k) {
        return typeof k;
      } : function(k) {
        return k && typeof Symbol == "function" && k.constructor === Symbol && k !== Symbol.prototype ? "symbol" : typeof k;
      }, h(e);
    }
    Object.defineProperty(P, "__esModule", {
      value: !0
    }), P.default = void 0;
    var Y = dn(), A = te(ht()), K = _n(), I = Ct(), L = Tn(), C = pn(), u = D(vn()), _ = D(Pn()), s = D(dr()), p = D(In()), f = D(Gn()), r = D(qn()), i = D(Wn()), l = D(Vn()), a = D(Rt()), n = D(Zn()), c = Yn(), x = D(ni()), v = D(wn()), b = D(ii()), y = D(ai()), g = D(oi()), S = D(si()), X = D(kn()), F = D(ui()), T = D(li()), Q = D(fi());
    function D(e) {
      return e && e.__esModule ? e : { default: e };
    }
    function j(e) {
      if (typeof WeakMap != "function") return null;
      var k = /* @__PURE__ */ new WeakMap(), m = /* @__PURE__ */ new WeakMap();
      return (j = function(d) {
        return d ? m : k;
      })(e);
    }
    function te(e, k) {
      if (e && e.__esModule) return e;
      if (e === null || h(e) != "object" && typeof e != "function") return { default: e };
      var m = j(k);
      if (m && m.has(e)) return m.get(e);
      var t = { __proto__: null }, d = Object.defineProperty && Object.getOwnPropertyDescriptor;
      for (var o in e) if (o !== "default" && {}.hasOwnProperty.call(e, o)) {
        var M = d ? Object.getOwnPropertyDescriptor(e, o) : null;
        M && (M.get || M.set) ? Object.defineProperty(t, o, M) : t[o] = e[o];
      }
      return t.default = e, m && m.set(e, t), t;
    }
    function he() {
      /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */
      he = function() {
        return k;
      };
      var e, k = {}, m = Object.prototype, t = m.hasOwnProperty, d = Object.defineProperty || function(Se, _e, me) {
        Se[_e] = me.value;
      }, o = typeof Symbol == "function" ? Symbol : {}, M = o.iterator || "@@iterator", N = o.asyncIterator || "@@asyncIterator", G = o.toStringTag || "@@toStringTag";
      function oe(Se, _e, me) {
        return Object.defineProperty(Se, _e, { value: me, enumerable: !0, configurable: !0, writable: !0 }), Se[_e];
      }
      try {
        oe({}, "");
      } catch {
        oe = function(me, De, Ue) {
          return me[De] = Ue;
        };
      }
      function Le(Se, _e, me, De) {
        var Ue = _e && _e.prototype instanceof Ze ? _e : Ze, Qe = Object.create(Ue.prototype), $e = new Pt(De || []);
        return d(Qe, "_invoke", { value: Sn(Se, me, $e) }), Qe;
      }
      function Pe(Se, _e, me) {
        try {
          return { type: "normal", arg: Se.call(_e, me) };
        } catch (De) {
          return { type: "throw", arg: De };
        }
      }
      k.wrap = Le;
      var Xe = "suspendedStart", Re = "suspendedYield", Be = "executing", Ke = "completed", Ie = {};
      function Ze() {
      }
      function ze() {
      }
      function Ne() {
      }
      var He = {};
      oe(He, M, function() {
        return this;
      });
      var et = Object.getPrototypeOf, rt = et && et(et(Lt([])));
      rt && rt !== m && t.call(rt, M) && (He = rt);
      var ot = Ne.prototype = Ze.prototype = Object.create(He);
      function _r(Se) {
        ["next", "throw", "return"].forEach(function(_e) {
          oe(Se, _e, function(me) {
            return this._invoke(_e, me);
          });
        });
      }
      function Et(Se, _e) {
        function me(Ue, Qe, $e, nt) {
          var it = Pe(Se[Ue], Se, Qe);
          if (it.type !== "throw") {
            var dt = it.arg, ft = dt.value;
            return ft && h(ft) == "object" && t.call(ft, "__await") ? _e.resolve(ft.__await).then(function(_t) {
              me("next", _t, $e, nt);
            }, function(_t) {
              me("throw", _t, $e, nt);
            }) : _e.resolve(ft).then(function(_t) {
              dt.value = _t, $e(dt);
            }, function(_t) {
              return me("throw", _t, $e, nt);
            });
          }
          nt(it.arg);
        }
        var De;
        d(this, "_invoke", { value: function(Qe, $e) {
          function nt() {
            return new _e(function(it, dt) {
              me(Qe, $e, it, dt);
            });
          }
          return De = De ? De.then(nt, nt) : nt();
        } });
      }
      function Sn(Se, _e, me) {
        var De = Xe;
        return function(Ue, Qe) {
          if (De === Be) throw Error("Generator is already running");
          if (De === Ke) {
            if (Ue === "throw") throw Qe;
            return { value: e, done: !0 };
          }
          for (me.method = Ue, me.arg = Qe; ; ) {
            var $e = me.delegate;
            if ($e) {
              var nt = pr($e, me);
              if (nt) {
                if (nt === Ie) continue;
                return nt;
              }
            }
            if (me.method === "next") me.sent = me._sent = me.arg;
            else if (me.method === "throw") {
              if (De === Xe) throw De = Ke, me.arg;
              me.dispatchException(me.arg);
            } else me.method === "return" && me.abrupt("return", me.arg);
            De = Be;
            var it = Pe(Se, _e, me);
            if (it.type === "normal") {
              if (De = me.done ? Ke : Re, it.arg === Ie) continue;
              return { value: it.arg, done: me.done };
            }
            it.type === "throw" && (De = Ke, me.method = "throw", me.arg = it.arg);
          }
        };
      }
      function pr(Se, _e) {
        var me = _e.method, De = Se.iterator[me];
        if (De === e) return _e.delegate = null, me === "throw" && Se.iterator.return && (_e.method = "return", _e.arg = e, pr(Se, _e), _e.method === "throw") || me !== "return" && (_e.method = "throw", _e.arg = new TypeError("The iterator does not provide a '" + me + "' method")), Ie;
        var Ue = Pe(De, Se.iterator, _e.arg);
        if (Ue.type === "throw") return _e.method = "throw", _e.arg = Ue.arg, _e.delegate = null, Ie;
        var Qe = Ue.arg;
        return Qe ? Qe.done ? (_e[Se.resultName] = Qe.value, _e.next = Se.nextLoc, _e.method !== "return" && (_e.method = "next", _e.arg = e), _e.delegate = null, Ie) : Qe : (_e.method = "throw", _e.arg = new TypeError("iterator result is not an object"), _e.delegate = null, Ie);
      }
      function Kn(Se) {
        var _e = { tryLoc: Se[0] };
        1 in Se && (_e.catchLoc = Se[1]), 2 in Se && (_e.finallyLoc = Se[2], _e.afterLoc = Se[3]), this.tryEntries.push(_e);
      }
      function Tt(Se) {
        var _e = Se.completion || {};
        _e.type = "normal", delete _e.arg, Se.completion = _e;
      }
      function Pt(Se) {
        this.tryEntries = [{ tryLoc: "root" }], Se.forEach(Kn, this), this.reset(!0);
      }
      function Lt(Se) {
        if (Se || Se === "") {
          var _e = Se[M];
          if (_e) return _e.call(Se);
          if (typeof Se.next == "function") return Se;
          if (!isNaN(Se.length)) {
            var me = -1, De = function Ue() {
              for (; ++me < Se.length; ) if (t.call(Se, me)) return Ue.value = Se[me], Ue.done = !1, Ue;
              return Ue.value = e, Ue.done = !0, Ue;
            };
            return De.next = De;
          }
        }
        throw new TypeError(h(Se) + " is not iterable");
      }
      return ze.prototype = Ne, d(ot, "constructor", { value: Ne, configurable: !0 }), d(Ne, "constructor", { value: ze, configurable: !0 }), ze.displayName = oe(Ne, G, "GeneratorFunction"), k.isGeneratorFunction = function(Se) {
        var _e = typeof Se == "function" && Se.constructor;
        return !!_e && (_e === ze || (_e.displayName || _e.name) === "GeneratorFunction");
      }, k.mark = function(Se) {
        return Object.setPrototypeOf ? Object.setPrototypeOf(Se, Ne) : (Se.__proto__ = Ne, oe(Se, G, "GeneratorFunction")), Se.prototype = Object.create(ot), Se;
      }, k.awrap = function(Se) {
        return { __await: Se };
      }, _r(Et.prototype), oe(Et.prototype, N, function() {
        return this;
      }), k.AsyncIterator = Et, k.async = function(Se, _e, me, De, Ue) {
        Ue === void 0 && (Ue = Promise);
        var Qe = new Et(Le(Se, _e, me, De), Ue);
        return k.isGeneratorFunction(_e) ? Qe : Qe.next().then(function($e) {
          return $e.done ? $e.value : Qe.next();
        });
      }, _r(ot), oe(ot, G, "Generator"), oe(ot, M, function() {
        return this;
      }), oe(ot, "toString", function() {
        return "[object Generator]";
      }), k.keys = function(Se) {
        var _e = Object(Se), me = [];
        for (var De in _e) me.push(De);
        return me.reverse(), function Ue() {
          for (; me.length; ) {
            var Qe = me.pop();
            if (Qe in _e) return Ue.value = Qe, Ue.done = !1, Ue;
          }
          return Ue.done = !0, Ue;
        };
      }, k.values = Lt, Pt.prototype = { constructor: Pt, reset: function(_e) {
        if (this.prev = 0, this.next = 0, this.sent = this._sent = e, this.done = !1, this.delegate = null, this.method = "next", this.arg = e, this.tryEntries.forEach(Tt), !_e) for (var me in this) me.charAt(0) === "t" && t.call(this, me) && !isNaN(+me.slice(1)) && (this[me] = e);
      }, stop: function() {
        this.done = !0;
        var _e = this.tryEntries[0].completion;
        if (_e.type === "throw") throw _e.arg;
        return this.rval;
      }, dispatchException: function(_e) {
        if (this.done) throw _e;
        var me = this;
        function De(dt, ft) {
          return $e.type = "throw", $e.arg = _e, me.next = dt, ft && (me.method = "next", me.arg = e), !!ft;
        }
        for (var Ue = this.tryEntries.length - 1; Ue >= 0; --Ue) {
          var Qe = this.tryEntries[Ue], $e = Qe.completion;
          if (Qe.tryLoc === "root") return De("end");
          if (Qe.tryLoc <= this.prev) {
            var nt = t.call(Qe, "catchLoc"), it = t.call(Qe, "finallyLoc");
            if (nt && it) {
              if (this.prev < Qe.catchLoc) return De(Qe.catchLoc, !0);
              if (this.prev < Qe.finallyLoc) return De(Qe.finallyLoc);
            } else if (nt) {
              if (this.prev < Qe.catchLoc) return De(Qe.catchLoc, !0);
            } else {
              if (!it) throw Error("try statement without catch or finally");
              if (this.prev < Qe.finallyLoc) return De(Qe.finallyLoc);
            }
          }
        }
      }, abrupt: function(_e, me) {
        for (var De = this.tryEntries.length - 1; De >= 0; --De) {
          var Ue = this.tryEntries[De];
          if (Ue.tryLoc <= this.prev && t.call(Ue, "finallyLoc") && this.prev < Ue.finallyLoc) {
            var Qe = Ue;
            break;
          }
        }
        Qe && (_e === "break" || _e === "continue") && Qe.tryLoc <= me && me <= Qe.finallyLoc && (Qe = null);
        var $e = Qe ? Qe.completion : {};
        return $e.type = _e, $e.arg = me, Qe ? (this.method = "next", this.next = Qe.finallyLoc, Ie) : this.complete($e);
      }, complete: function(_e, me) {
        if (_e.type === "throw") throw _e.arg;
        return _e.type === "break" || _e.type === "continue" ? this.next = _e.arg : _e.type === "return" ? (this.rval = this.arg = _e.arg, this.method = "return", this.next = "end") : _e.type === "normal" && me && (this.next = me), Ie;
      }, finish: function(_e) {
        for (var me = this.tryEntries.length - 1; me >= 0; --me) {
          var De = this.tryEntries[me];
          if (De.finallyLoc === _e) return this.complete(De.completion, De.afterLoc), Tt(De), Ie;
        }
      }, catch: function(_e) {
        for (var me = this.tryEntries.length - 1; me >= 0; --me) {
          var De = this.tryEntries[me];
          if (De.tryLoc === _e) {
            var Ue = De.completion;
            if (Ue.type === "throw") {
              var Qe = Ue.arg;
              Tt(De);
            }
            return Qe;
          }
        }
        throw Error("illegal catch attempt");
      }, delegateYield: function(_e, me, De) {
        return this.delegate = { iterator: Lt(_e), resultName: me, nextLoc: De }, this.method === "next" && (this.arg = e), Ie;
      } }, k;
    }
    function ge(e, k, m, t, d, o, M) {
      try {
        var N = e[o](M), G = N.value;
      } catch (oe) {
        return void m(oe);
      }
      N.done ? k(G) : Promise.resolve(G).then(t, d);
    }
    function pe(e) {
      return function() {
        var k = this, m = arguments;
        return new Promise(function(t, d) {
          var o = e.apply(k, m);
          function M(G) {
            ge(o, t, d, M, N, "next", G);
          }
          function N(G) {
            ge(o, t, d, M, N, "throw", G);
          }
          M(void 0);
        });
      };
    }
    function we(e, k) {
      return ke(e) || de(e, k) || Oe(e, k) || Ae();
    }
    function Ae() {
      throw new TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
    }
    function de(e, k) {
      var m = e == null ? null : typeof Symbol < "u" && e[Symbol.iterator] || e["@@iterator"];
      if (m != null) {
        var t, d, o, M, N = [], G = !0, oe = !1;
        try {
          if (o = (m = m.call(e)).next, k !== 0) for (; !(G = (t = o.call(m)).done) && (N.push(t.value), N.length !== k); G = !0) ;
        } catch (Le) {
          oe = !0, d = Le;
        } finally {
          try {
            if (!G && m.return != null && (M = m.return(), Object(M) !== M)) return;
          } finally {
            if (oe) throw d;
          }
        }
        return N;
      }
    }
    function ke(e) {
      if (Array.isArray(e)) return e;
    }
    function Ce(e, k) {
      var m = typeof Symbol < "u" && e[Symbol.iterator] || e["@@iterator"];
      if (!m) {
        if (Array.isArray(e) || (m = Oe(e)) || k) {
          m && (e = m);
          var t = 0, d = function() {
          };
          return { s: d, n: function() {
            return t >= e.length ? { done: !0 } : { done: !1, value: e[t++] };
          }, e: function(oe) {
            throw oe;
          }, f: d };
        }
        throw new TypeError(`Invalid attempt to iterate non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`);
      }
      var o, M = !0, N = !1;
      return { s: function() {
        m = m.call(e);
      }, n: function() {
        var oe = m.next();
        return M = oe.done, oe;
      }, e: function(oe) {
        N = !0, o = oe;
      }, f: function() {
        try {
          M || m.return == null || m.return();
        } finally {
          if (N) throw o;
        }
      } };
    }
    function Oe(e, k) {
      if (e) {
        if (typeof e == "string") return J(e, k);
        var m = {}.toString.call(e).slice(8, -1);
        return m === "Object" && e.constructor && (m = e.constructor.name), m === "Map" || m === "Set" ? Array.from(e) : m === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(m) ? J(e, k) : void 0;
      }
    }
    function J(e, k) {
      (k == null || k > e.length) && (k = e.length);
      for (var m = 0, t = Array(k); m < k; m++) t[m] = e[m];
      return t;
    }
    function $(e, k) {
      if (!(e instanceof k)) throw new TypeError("Cannot call a class as a function");
    }
    function re(e, k) {
      for (var m = 0; m < k.length; m++) {
        var t = k[m];
        t.enumerable = t.enumerable || !1, t.configurable = !0, "value" in t && (t.writable = !0), Object.defineProperty(e, B(t.key), t);
      }
    }
    function z(e, k, m) {
      return k && re(e.prototype, k), m && re(e, m), Object.defineProperty(e, "prototype", { writable: !1 }), e;
    }
    function B(e) {
      var k = U(e, "string");
      return h(k) == "symbol" ? k : k + "";
    }
    function U(e, k) {
      if (h(e) != "object" || !e) return e;
      var m = e[Symbol.toPrimitive];
      if (m !== void 0) {
        var t = m.call(e, k);
        if (h(t) != "object") return t;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return String(e);
    }
    function ue(e, k, m) {
      return k = ee(k), le(e, q() ? Reflect.construct(k, [], ee(e).constructor) : k.apply(e, m));
    }
    function le(e, k) {
      if (k && (h(k) == "object" || typeof k == "function")) return k;
      if (k !== void 0) throw new TypeError("Derived constructors may only return object or undefined");
      return H(e);
    }
    function H(e) {
      if (e === void 0) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
      return e;
    }
    function q() {
      try {
        var e = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
        }));
      } catch {
      }
      return (q = function() {
        return !!e;
      })();
    }
    function ee(e) {
      return ee = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(k) {
        return k.__proto__ || Object.getPrototypeOf(k);
      }, ee(e);
    }
    function ie(e, k) {
      if (typeof k != "function" && k !== null) throw new TypeError("Super expression must either be null or a function");
      e.prototype = Object.create(k && k.prototype, { constructor: { value: e, writable: !0, configurable: !0 } }), Object.defineProperty(e, "prototype", { writable: !1 }), k && be(e, k);
    }
    function be(e, k) {
      return be = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(m, t) {
        return m.__proto__ = t, m;
      }, be(e, k);
    }
    var V = 3, W = "rgb(40, 40, 40)", ae = 17, O = 50, ne = 19, ve = 75, Te = 50, Ge = 1e3, qe = 50, xe = 1, We = 2, Ye = 6, lt = 16, ut = 19, tt = 22, at = 30, E = 113, se = 129, fe = 256, ye = 1, Fe = 1 << 24, R = 1 << 25, Z = 1 << 26, w = 1 << 27, ce = 1 << 28, Ee = P.default = /* @__PURE__ */ function(e) {
      function k(m, t, d) {
        var o;
        if ($(this, k), !m)
          throw new Error("Must specify target");
        if (!t)
          throw new Error("Must specify URL, WebSocket or RTCDataChannel");
        window.isSecureContext || A.Error("noVNC requires a secure context (TLS). Expect crashes!"), o = ue(this, k), o._target = m, typeof t == "string" ? o._url = t : (o._url = null, o._rawChannel = t), d = d || {}, o._rfbCredentials = d.credentials || {}, o._shared = "shared" in d ? !!d.shared : !0, o._repeaterID = d.repeaterID || "", o._wsProtocols = d.wsProtocols || [], o._rfbConnectionState = "", o._rfbInitState = "", o._rfbAuthScheme = -1, o._rfbCleanDisconnect = !0, o._rfbRSAAESAuthenticationState = null, o._rfbVersion = 0, o._rfbMaxVersion = 3.8, o._rfbTightVNC = !1, o._rfbVeNCryptState = 0, o._rfbXvpVer = 0, o._fbWidth = 0, o._fbHeight = 0, o._fbName = "", o._capabilities = {
          power: !1
        }, o._supportsFence = !1, o._supportsContinuousUpdates = !1, o._enabledContinuousUpdates = !1, o._supportsSetDesktopSize = !1, o._screenID = 0, o._screenFlags = 0, o._qemuExtKeyEventSupported = !1, o._clipboardText = null, o._clipboardServerCapabilitiesActions = {}, o._clipboardServerCapabilitiesFormats = {}, o._sock = null, o._display = null, o._flushing = !1, o._keyboard = null, o._gestures = null, o._resizeObserver = null, o._disconnTimer = null, o._resizeTimeout = null, o._mouseMoveTimer = null, o._decoders = {}, o._FBU = {
          rects: 0,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          encoding: null
        }, o._mousePos = {}, o._mouseButtonMask = 0, o._mouseLastMoveTime = 0, o._viewportDragging = !1, o._viewportDragPos = {}, o._viewportHasMoved = !1, o._accumulatedWheelDeltaX = 0, o._accumulatedWheelDeltaY = 0, o._gestureLastTapTime = null, o._gestureFirstDoubleTapEv = null, o._gestureLastMagnitudeX = 0, o._gestureLastMagnitudeY = 0, o._eventHandlers = {
          focusCanvas: o._focusCanvas.bind(o),
          handleResize: o._handleResize.bind(o),
          handleMouse: o._handleMouse.bind(o),
          handleWheel: o._handleWheel.bind(o),
          handleGesture: o._handleGesture.bind(o),
          handleRSAAESCredentialsRequired: o._handleRSAAESCredentialsRequired.bind(o),
          handleRSAAESServerVerification: o._handleRSAAESServerVerification.bind(o)
        }, A.Debug(">> RFB.constructor"), o._screen = document.createElement("div"), o._screen.style.display = "flex", o._screen.style.width = "100%", o._screen.style.height = "100%", o._screen.style.overflow = "auto", o._screen.style.background = W, o._canvas = document.createElement("canvas"), o._canvas.style.margin = "auto", o._canvas.style.outline = "none", o._canvas.width = 0, o._canvas.height = 0, o._canvas.tabIndex = -1, o._screen.appendChild(o._canvas), o._cursor = new i.default(), o._cursorImage = k.cursors.none, o._decoders[c.encodings.encodingRaw] = new b.default(), o._decoders[c.encodings.encodingCopyRect] = new y.default(), o._decoders[c.encodings.encodingRRE] = new g.default(), o._decoders[c.encodings.encodingHextile] = new S.default(), o._decoders[c.encodings.encodingTight] = new X.default(), o._decoders[c.encodings.encodingTightPNG] = new F.default(), o._decoders[c.encodings.encodingZRLE] = new T.default(), o._decoders[c.encodings.encodingJPEG] = new Q.default();
        try {
          o._display = new _.default(o._canvas);
        } catch (M) {
          throw A.Error("Display exception: " + M), M;
        }
        return o._keyboard = new f.default(o._canvas), o._keyboard.onkeyevent = o._handleKeyEvent.bind(o), o._remoteCapsLock = null, o._remoteNumLock = null, o._gestures = new r.default(), o._sock = new l.default(), o._sock.on("open", o._socketOpen.bind(o)), o._sock.on("close", o._socketClose.bind(o)), o._sock.on("message", o._handleMessage.bind(o)), o._sock.on("error", o._socketError.bind(o)), o._expectedClientWidth = null, o._expectedClientHeight = null, o._resizeObserver = new ResizeObserver(o._eventHandlers.handleResize), o._updateConnectionState("connecting"), A.Debug("<< RFB.constructor"), o.dragViewport = !1, o.focusOnClick = !0, o._viewOnly = !1, o._clipViewport = !1, o._clippingViewport = !1, o._scaleViewport = !1, o._resizeSession = !1, o._showDotCursor = !1, d.showDotCursor !== void 0 && (A.Warn("Specifying showDotCursor as a RFB constructor argument is deprecated"), o._showDotCursor = d.showDotCursor), o._qualityLevel = 6, o._compressionLevel = 2, o;
      }
      return ie(k, e), z(k, [{
        key: "viewOnly",
        get: function() {
          return this._viewOnly;
        },
        set: function(t) {
          this._viewOnly = t, (this._rfbConnectionState === "connecting" || this._rfbConnectionState === "connected") && (t ? this._keyboard.ungrab() : this._keyboard.grab());
        }
      }, {
        key: "capabilities",
        get: function() {
          return this._capabilities;
        }
      }, {
        key: "clippingViewport",
        get: function() {
          return this._clippingViewport;
        }
      }, {
        key: "_setClippingViewport",
        value: function(t) {
          t !== this._clippingViewport && (this._clippingViewport = t, this.dispatchEvent(new CustomEvent("clippingviewport", {
            detail: this._clippingViewport
          })));
        }
      }, {
        key: "touchButton",
        get: function() {
          return 0;
        },
        set: function(t) {
          A.Warn("Using old API!");
        }
      }, {
        key: "clipViewport",
        get: function() {
          return this._clipViewport;
        },
        set: function(t) {
          this._clipViewport = t, this._updateClip();
        }
      }, {
        key: "scaleViewport",
        get: function() {
          return this._scaleViewport;
        },
        set: function(t) {
          this._scaleViewport = t, t && this._clipViewport && this._updateClip(), this._updateScale(), !t && this._clipViewport && this._updateClip();
        }
      }, {
        key: "resizeSession",
        get: function() {
          return this._resizeSession;
        },
        set: function(t) {
          this._resizeSession = t, t && this._requestRemoteResize();
        }
      }, {
        key: "showDotCursor",
        get: function() {
          return this._showDotCursor;
        },
        set: function(t) {
          this._showDotCursor = t, this._refreshCursor();
        }
      }, {
        key: "background",
        get: function() {
          return this._screen.style.background;
        },
        set: function(t) {
          this._screen.style.background = t;
        }
      }, {
        key: "qualityLevel",
        get: function() {
          return this._qualityLevel;
        },
        set: function(t) {
          if (!Number.isInteger(t) || t < 0 || t > 9) {
            A.Error("qualityLevel must be an integer between 0 and 9");
            return;
          }
          this._qualityLevel !== t && (this._qualityLevel = t, this._rfbConnectionState === "connected" && this._sendEncodings());
        }
      }, {
        key: "compressionLevel",
        get: function() {
          return this._compressionLevel;
        },
        set: function(t) {
          if (!Number.isInteger(t) || t < 0 || t > 9) {
            A.Error("compressionLevel must be an integer between 0 and 9");
            return;
          }
          this._compressionLevel !== t && (this._compressionLevel = t, this._rfbConnectionState === "connected" && this._sendEncodings());
        }
        // ===== PUBLIC METHODS =====
      }, {
        key: "disconnect",
        value: function() {
          this._updateConnectionState("disconnecting"), this._sock.off("error"), this._sock.off("message"), this._sock.off("open"), this._rfbRSAAESAuthenticationState !== null && this._rfbRSAAESAuthenticationState.disconnect();
        }
      }, {
        key: "approveServer",
        value: function() {
          this._rfbRSAAESAuthenticationState !== null && this._rfbRSAAESAuthenticationState.approveServer();
        }
      }, {
        key: "sendCredentials",
        value: function(t) {
          this._rfbCredentials = t, this._resumeAuthentication();
        }
      }, {
        key: "sendCtrlAltDel",
        value: function() {
          this._rfbConnectionState !== "connected" || this._viewOnly || (A.Info("Sending Ctrl-Alt-Del"), this.sendKey(a.default.XK_Control_L, "ControlLeft", !0), this.sendKey(a.default.XK_Alt_L, "AltLeft", !0), this.sendKey(a.default.XK_Delete, "Delete", !0), this.sendKey(a.default.XK_Delete, "Delete", !1), this.sendKey(a.default.XK_Alt_L, "AltLeft", !1), this.sendKey(a.default.XK_Control_L, "ControlLeft", !1));
        }
      }, {
        key: "machineShutdown",
        value: function() {
          this._xvpOp(1, 2);
        }
      }, {
        key: "machineReboot",
        value: function() {
          this._xvpOp(1, 3);
        }
      }, {
        key: "machineReset",
        value: function() {
          this._xvpOp(1, 4);
        }
        // Send a key press. If 'down' is not specified then send a down key
        // followed by an up key.
      }, {
        key: "sendKey",
        value: function(t, d, o) {
          if (!(this._rfbConnectionState !== "connected" || this._viewOnly)) {
            if (o === void 0) {
              this.sendKey(t, d, !0), this.sendKey(t, d, !1);
              return;
            }
            var M = n.default[d];
            if (this._qemuExtKeyEventSupported && M)
              t = t || 0, A.Info("Sending key (" + (o ? "down" : "up") + "): keysym " + t + ", scancode " + M), k.messages.QEMUExtendedKeyEvent(this._sock, t, o, M);
            else {
              if (!t)
                return;
              A.Info("Sending keysym (" + (o ? "down" : "up") + "): " + t), k.messages.keyEvent(this._sock, t, o ? 1 : 0);
            }
          }
        }
      }, {
        key: "focus",
        value: function(t) {
          this._canvas.focus(t);
        }
      }, {
        key: "blur",
        value: function() {
          this._canvas.blur();
        }
      }, {
        key: "clipboardPasteFrom",
        value: function(t) {
          if (!(this._rfbConnectionState !== "connected" || this._viewOnly))
            if (this._clipboardServerCapabilitiesFormats[ye] && this._clipboardServerCapabilitiesActions[w])
              this._clipboardText = t, k.messages.extendedClipboardNotify(this._sock, [ye]);
            else {
              var d, o, M;
              d = 0;
              var N = Ce(t), G;
              try {
                for (N.s(); !(G = N.n()).done; ) {
                  var oe = G.value;
                  d++;
                }
              } catch (Be) {
                N.e(Be);
              } finally {
                N.f();
              }
              M = new Uint8Array(d), o = 0;
              var Le = Ce(t), Pe;
              try {
                for (Le.s(); !(Pe = Le.n()).done; ) {
                  var Xe = Pe.value, Re = Xe.codePointAt(0);
                  Re > 255 && (Re = 63), M[o++] = Re;
                }
              } catch (Be) {
                Le.e(Be);
              } finally {
                Le.f();
              }
              k.messages.clientCutText(this._sock, M);
            }
        }
      }, {
        key: "getImageData",
        value: function() {
          return this._display.getImageData();
        }
      }, {
        key: "toDataURL",
        value: function(t, d) {
          return this._display.toDataURL(t, d);
        }
      }, {
        key: "toBlob",
        value: function(t, d, o) {
          return this._display.toBlob(t, d, o);
        }
        // ===== PRIVATE METHODS =====
      }, {
        key: "_connect",
        value: function() {
          if (A.Debug(">> RFB.connect"), this._url)
            A.Info("connecting to ".concat(this._url)), this._sock.open(this._url, this._wsProtocols);
          else {
            if (A.Info("attaching ".concat(this._rawChannel, " to Websock")), this._sock.attach(this._rawChannel), this._sock.readyState === "closed")
              throw Error("Cannot use already closed WebSocket/RTCDataChannel");
            this._sock.readyState === "open" && this._socketOpen();
          }
          this._target.appendChild(this._screen), this._gestures.attach(this._canvas), this._cursor.attach(this._canvas), this._refreshCursor(), this._resizeObserver.observe(this._screen), this._canvas.addEventListener("mousedown", this._eventHandlers.focusCanvas), this._canvas.addEventListener("touchstart", this._eventHandlers.focusCanvas), this._canvas.addEventListener("mousedown", this._eventHandlers.handleMouse), this._canvas.addEventListener("mouseup", this._eventHandlers.handleMouse), this._canvas.addEventListener("mousemove", this._eventHandlers.handleMouse), this._canvas.addEventListener("click", this._eventHandlers.handleMouse), this._canvas.addEventListener("contextmenu", this._eventHandlers.handleMouse), this._canvas.addEventListener("wheel", this._eventHandlers.handleWheel), this._canvas.addEventListener("gesturestart", this._eventHandlers.handleGesture), this._canvas.addEventListener("gesturemove", this._eventHandlers.handleGesture), this._canvas.addEventListener("gestureend", this._eventHandlers.handleGesture), A.Debug("<< RFB.connect");
        }
      }, {
        key: "_disconnect",
        value: function() {
          A.Debug(">> RFB.disconnect"), this._cursor.detach(), this._canvas.removeEventListener("gesturestart", this._eventHandlers.handleGesture), this._canvas.removeEventListener("gesturemove", this._eventHandlers.handleGesture), this._canvas.removeEventListener("gestureend", this._eventHandlers.handleGesture), this._canvas.removeEventListener("wheel", this._eventHandlers.handleWheel), this._canvas.removeEventListener("mousedown", this._eventHandlers.handleMouse), this._canvas.removeEventListener("mouseup", this._eventHandlers.handleMouse), this._canvas.removeEventListener("mousemove", this._eventHandlers.handleMouse), this._canvas.removeEventListener("click", this._eventHandlers.handleMouse), this._canvas.removeEventListener("contextmenu", this._eventHandlers.handleMouse), this._canvas.removeEventListener("mousedown", this._eventHandlers.focusCanvas), this._canvas.removeEventListener("touchstart", this._eventHandlers.focusCanvas), this._resizeObserver.disconnect(), this._keyboard.ungrab(), this._gestures.detach(), this._sock.close();
          try {
            this._target.removeChild(this._screen);
          } catch (t) {
            if (t.name !== "NotFoundError") throw t;
          }
          clearTimeout(this._resizeTimeout), clearTimeout(this._mouseMoveTimer), A.Debug("<< RFB.disconnect");
        }
      }, {
        key: "_socketOpen",
        value: function() {
          this._rfbConnectionState === "connecting" && this._rfbInitState === "" ? (this._rfbInitState = "ProtocolVersion", A.Debug("Starting VNC handshake")) : this._fail("Unexpected server connection while " + this._rfbConnectionState);
        }
      }, {
        key: "_socketClose",
        value: function(t) {
          A.Debug("WebSocket on-close event");
          var d = "";
          switch (t.code && (d = "(code: " + t.code, t.reason && (d += ", reason: " + t.reason), d += ")"), this._rfbConnectionState) {
            case "connecting":
              this._fail("Connection closed " + d);
              break;
            case "connected":
              this._updateConnectionState("disconnecting"), this._updateConnectionState("disconnected");
              break;
            case "disconnecting":
              this._updateConnectionState("disconnected");
              break;
            case "disconnected":
              this._fail("Unexpected server disconnect when already disconnected " + d);
              break;
            default:
              this._fail("Unexpected server disconnect before connecting " + d);
              break;
          }
          this._sock.off("close"), this._rawChannel = null;
        }
      }, {
        key: "_socketError",
        value: function(t) {
          A.Warn("WebSocket on-error event");
        }
      }, {
        key: "_focusCanvas",
        value: function(t) {
          this.focusOnClick && this.focus({
            preventScroll: !0
          });
        }
      }, {
        key: "_setDesktopName",
        value: function(t) {
          this._fbName = t, this.dispatchEvent(new CustomEvent("desktopname", {
            detail: {
              name: this._fbName
            }
          }));
        }
      }, {
        key: "_saveExpectedClientSize",
        value: function() {
          this._expectedClientWidth = this._screen.clientWidth, this._expectedClientHeight = this._screen.clientHeight;
        }
      }, {
        key: "_currentClientSize",
        value: function() {
          return [this._screen.clientWidth, this._screen.clientHeight];
        }
      }, {
        key: "_clientHasExpectedSize",
        value: function() {
          var t = this._currentClientSize(), d = we(t, 2), o = d[0], M = d[1];
          return o == this._expectedClientWidth && M == this._expectedClientHeight;
        }
      }, {
        key: "_handleResize",
        value: function() {
          var t = this;
          this._clientHasExpectedSize() || (window.requestAnimationFrame(function() {
            t._updateClip(), t._updateScale();
          }), this._resizeSession && (clearTimeout(this._resizeTimeout), this._resizeTimeout = setTimeout(this._requestRemoteResize.bind(this), 500)));
        }
        // Update state of clipping in Display object, and make sure the
        // configured viewport matches the current screen size
      }, {
        key: "_updateClip",
        value: function() {
          var t = this._display.clipViewport, d = this._clipViewport;
          if (this._scaleViewport && (d = !1), t !== d && (this._display.clipViewport = d), d) {
            var o = this._screenSize();
            this._display.viewportChangeSize(o.w, o.h), this._fixScrollbars(), this._setClippingViewport(o.w < this._display.width || o.h < this._display.height);
          } else
            this._setClippingViewport(!1);
          t !== d && this._saveExpectedClientSize();
        }
      }, {
        key: "_updateScale",
        value: function() {
          if (!this._scaleViewport)
            this._display.scale = 1;
          else {
            var t = this._screenSize();
            this._display.autoscale(t.w, t.h);
          }
          this._fixScrollbars();
        }
        // Requests a change of remote desktop size. This message is an extension
        // and may only be sent if we have received an ExtendedDesktopSize message
      }, {
        key: "_requestRemoteResize",
        value: function() {
          if (clearTimeout(this._resizeTimeout), this._resizeTimeout = null, !(!this._resizeSession || this._viewOnly || !this._supportsSetDesktopSize)) {
            var t = this._screenSize();
            k.messages.setDesktopSize(this._sock, Math.floor(t.w), Math.floor(t.h), this._screenID, this._screenFlags), A.Debug("Requested new desktop size: " + t.w + "x" + t.h);
          }
        }
        // Gets the the size of the available screen
      }, {
        key: "_screenSize",
        value: function() {
          var t = this._screen.getBoundingClientRect();
          return {
            w: t.width,
            h: t.height
          };
        }
      }, {
        key: "_fixScrollbars",
        value: function() {
          var t = this._screen.style.overflow;
          this._screen.style.overflow = "hidden", this._screen.getBoundingClientRect(), this._screen.style.overflow = t;
        }
        /*
         * Connection states:
         *   connecting
         *   connected
         *   disconnecting
         *   disconnected - permanent state
         */
      }, {
        key: "_updateConnectionState",
        value: function(t) {
          var d = this, o = this._rfbConnectionState;
          if (t === o) {
            A.Debug("Already in state '" + t + "', ignoring");
            return;
          }
          if (o === "disconnected") {
            A.Error("Tried changing state of a disconnected RFB object");
            return;
          }
          switch (t) {
            case "connected":
              if (o !== "connecting") {
                A.Error("Bad transition to connected state, previous connection state: " + o);
                return;
              }
              break;
            case "disconnected":
              if (o !== "disconnecting") {
                A.Error("Bad transition to disconnected state, previous connection state: " + o);
                return;
              }
              break;
            case "connecting":
              if (o !== "") {
                A.Error("Bad transition to connecting state, previous connection state: " + o);
                return;
              }
              break;
            case "disconnecting":
              if (o !== "connected" && o !== "connecting") {
                A.Error("Bad transition to disconnecting state, previous connection state: " + o);
                return;
              }
              break;
            default:
              A.Error("Unknown connection state: " + t);
              return;
          }
          switch (this._rfbConnectionState = t, A.Debug("New state '" + t + "', was '" + o + "'."), this._disconnTimer && t !== "disconnecting" && (A.Debug("Clearing disconnect timer"), clearTimeout(this._disconnTimer), this._disconnTimer = null, this._sock.off("close")), t) {
            case "connecting":
              this._connect();
              break;
            case "connected":
              this.dispatchEvent(new CustomEvent("connect", {
                detail: {}
              }));
              break;
            case "disconnecting":
              this._disconnect(), this._disconnTimer = setTimeout(function() {
                A.Error("Disconnection timed out."), d._updateConnectionState("disconnected");
              }, V * 1e3);
              break;
            case "disconnected":
              this.dispatchEvent(new CustomEvent("disconnect", {
                detail: {
                  clean: this._rfbCleanDisconnect
                }
              }));
              break;
          }
        }
        /* Print errors and disconnect
         *
         * The parameter 'details' is used for information that
         * should be logged but not sent to the user interface.
         */
      }, {
        key: "_fail",
        value: function(t) {
          switch (this._rfbConnectionState) {
            case "disconnecting":
              A.Error("Failed when disconnecting: " + t);
              break;
            case "connected":
              A.Error("Failed while connected: " + t);
              break;
            case "connecting":
              A.Error("Failed when connecting: " + t);
              break;
            default:
              A.Error("RFB failure: " + t);
              break;
          }
          return this._rfbCleanDisconnect = !1, this._updateConnectionState("disconnecting"), this._updateConnectionState("disconnected"), !1;
        }
      }, {
        key: "_setCapability",
        value: function(t, d) {
          this._capabilities[t] = d, this.dispatchEvent(new CustomEvent("capabilities", {
            detail: {
              capabilities: this._capabilities
            }
          }));
        }
      }, {
        key: "_handleMessage",
        value: function() {
          if (this._sock.rQwait("message", 1)) {
            A.Warn("handleMessage called on an empty receive queue");
            return;
          }
          switch (this._rfbConnectionState) {
            case "disconnected":
              A.Error("Got data while disconnected");
              break;
            case "connected":
              for (; !(this._flushing || !this._normalMsg() || this._sock.rQwait("message", 1)); )
                ;
              break;
            case "connecting":
              for (; this._rfbConnectionState === "connecting" && this._initMsg(); )
                ;
              break;
            default:
              A.Error("Got data while in an invalid state");
              break;
          }
        }
      }, {
        key: "_handleKeyEvent",
        value: function(t, d, o, M, N) {
          d == "CapsLock" && o && (this._remoteCapsLock = null), this._remoteCapsLock !== null && N !== null && this._remoteCapsLock !== N && o && (A.Debug("Fixing remote caps lock"), this.sendKey(a.default.XK_Caps_Lock, "CapsLock", !0), this.sendKey(a.default.XK_Caps_Lock, "CapsLock", !1), this._remoteCapsLock = null), d == "NumLock" && o && (this._remoteNumLock = null), this._remoteNumLock !== null && M !== null && this._remoteNumLock !== M && o && (A.Debug("Fixing remote num lock"), this.sendKey(a.default.XK_Num_Lock, "NumLock", !0), this.sendKey(a.default.XK_Num_Lock, "NumLock", !1), this._remoteNumLock = null), this.sendKey(t, d, o);
        }
      }, {
        key: "_handleMouse",
        value: function(t) {
          if (!(t.type === "click" && t.target !== this._canvas) && (t.stopPropagation(), t.preventDefault(), !(t.type === "click" || t.type === "contextmenu"))) {
            var d = (0, L.clientToElement)(t.clientX, t.clientY, this._canvas);
            switch (t.type) {
              case "mousedown":
                (0, C.setCapture)(this._canvas), this._handleMouseButton(d.x, d.y, !0, 1 << t.button);
                break;
              case "mouseup":
                this._handleMouseButton(d.x, d.y, !1, 1 << t.button);
                break;
              case "mousemove":
                this._handleMouseMove(d.x, d.y);
                break;
            }
          }
        }
      }, {
        key: "_handleMouseButton",
        value: function(t, d, o, M) {
          if (this.dragViewport)
            if (o && !this._viewportDragging) {
              this._viewportDragging = !0, this._viewportDragPos = {
                x: t,
                y: d
              }, this._viewportHasMoved = !1;
              return;
            } else {
              if (this._viewportDragging = !1, this._viewportHasMoved)
                return;
              this._sendMouse(t, d, M);
            }
          this._mouseMoveTimer !== null && (clearTimeout(this._mouseMoveTimer), this._mouseMoveTimer = null, this._sendMouse(t, d, this._mouseButtonMask)), o ? this._mouseButtonMask |= M : this._mouseButtonMask &= ~M, this._sendMouse(t, d, this._mouseButtonMask);
        }
      }, {
        key: "_handleMouseMove",
        value: function(t, d) {
          var o = this;
          if (this._viewportDragging) {
            var M = this._viewportDragPos.x - t, N = this._viewportDragPos.y - d;
            (this._viewportHasMoved || Math.abs(M) > I.dragThreshold || Math.abs(N) > I.dragThreshold) && (this._viewportHasMoved = !0, this._viewportDragPos = {
              x: t,
              y: d
            }, this._display.viewportChangePos(M, N));
            return;
          }
          if (this._mousePos = {
            x: t,
            y: d
          }, this._mouseMoveTimer == null) {
            var G = Date.now() - this._mouseLastMoveTime;
            G > ae ? (this._sendMouse(t, d, this._mouseButtonMask), this._mouseLastMoveTime = Date.now()) : this._mouseMoveTimer = setTimeout(function() {
              o._handleDelayedMouseMove();
            }, ae - G);
          }
        }
      }, {
        key: "_handleDelayedMouseMove",
        value: function() {
          this._mouseMoveTimer = null, this._sendMouse(this._mousePos.x, this._mousePos.y, this._mouseButtonMask), this._mouseLastMoveTime = Date.now();
        }
      }, {
        key: "_sendMouse",
        value: function(t, d, o) {
          this._rfbConnectionState === "connected" && (this._viewOnly || k.messages.pointerEvent(this._sock, this._display.absX(t), this._display.absY(d), o));
        }
      }, {
        key: "_handleWheel",
        value: function(t) {
          if (this._rfbConnectionState === "connected" && !this._viewOnly) {
            t.stopPropagation(), t.preventDefault();
            var d = (0, L.clientToElement)(t.clientX, t.clientY, this._canvas), o = t.deltaX, M = t.deltaY;
            t.deltaMode !== 0 && (o *= ne, M *= ne), this._accumulatedWheelDeltaX += o, this._accumulatedWheelDeltaY += M, Math.abs(this._accumulatedWheelDeltaX) >= O && (this._accumulatedWheelDeltaX < 0 ? (this._handleMouseButton(d.x, d.y, !0, 32), this._handleMouseButton(d.x, d.y, !1, 32)) : this._accumulatedWheelDeltaX > 0 && (this._handleMouseButton(d.x, d.y, !0, 64), this._handleMouseButton(d.x, d.y, !1, 64)), this._accumulatedWheelDeltaX = 0), Math.abs(this._accumulatedWheelDeltaY) >= O && (this._accumulatedWheelDeltaY < 0 ? (this._handleMouseButton(d.x, d.y, !0, 8), this._handleMouseButton(d.x, d.y, !1, 8)) : this._accumulatedWheelDeltaY > 0 && (this._handleMouseButton(d.x, d.y, !0, 16), this._handleMouseButton(d.x, d.y, !1, 16)), this._accumulatedWheelDeltaY = 0);
          }
        }
      }, {
        key: "_fakeMouseMove",
        value: function(t, d, o) {
          this._handleMouseMove(d, o), this._cursor.move(t.detail.clientX, t.detail.clientY);
        }
      }, {
        key: "_handleTapEvent",
        value: function(t, d) {
          var o = (0, L.clientToElement)(t.detail.clientX, t.detail.clientY, this._canvas);
          if (this._gestureLastTapTime !== null && Date.now() - this._gestureLastTapTime < Ge && this._gestureFirstDoubleTapEv.detail.type === t.detail.type) {
            var M = this._gestureFirstDoubleTapEv.detail.clientX - t.detail.clientX, N = this._gestureFirstDoubleTapEv.detail.clientY - t.detail.clientY, G = Math.hypot(M, N);
            G < qe ? o = (0, L.clientToElement)(this._gestureFirstDoubleTapEv.detail.clientX, this._gestureFirstDoubleTapEv.detail.clientY, this._canvas) : this._gestureFirstDoubleTapEv = t;
          } else
            this._gestureFirstDoubleTapEv = t;
          this._gestureLastTapTime = Date.now(), this._fakeMouseMove(this._gestureFirstDoubleTapEv, o.x, o.y), this._handleMouseButton(o.x, o.y, !0, d), this._handleMouseButton(o.x, o.y, !1, d);
        }
      }, {
        key: "_handleGesture",
        value: function(t) {
          var d, o = (0, L.clientToElement)(t.detail.clientX, t.detail.clientY, this._canvas);
          switch (t.type) {
            case "gesturestart":
              switch (t.detail.type) {
                case "onetap":
                  this._handleTapEvent(t, 1);
                  break;
                case "twotap":
                  this._handleTapEvent(t, 4);
                  break;
                case "threetap":
                  this._handleTapEvent(t, 2);
                  break;
                case "drag":
                  this._fakeMouseMove(t, o.x, o.y), this._handleMouseButton(o.x, o.y, !0, 1);
                  break;
                case "longpress":
                  this._fakeMouseMove(t, o.x, o.y), this._handleMouseButton(o.x, o.y, !0, 4);
                  break;
                case "twodrag":
                  this._gestureLastMagnitudeX = t.detail.magnitudeX, this._gestureLastMagnitudeY = t.detail.magnitudeY, this._fakeMouseMove(t, o.x, o.y);
                  break;
                case "pinch":
                  this._gestureLastMagnitudeX = Math.hypot(t.detail.magnitudeX, t.detail.magnitudeY), this._fakeMouseMove(t, o.x, o.y);
                  break;
              }
              break;
            case "gesturemove":
              switch (t.detail.type) {
                case "onetap":
                case "twotap":
                case "threetap":
                  break;
                case "drag":
                case "longpress":
                  this._fakeMouseMove(t, o.x, o.y);
                  break;
                case "twodrag":
                  for (this._fakeMouseMove(t, o.x, o.y); t.detail.magnitudeY - this._gestureLastMagnitudeY > Te; )
                    this._handleMouseButton(o.x, o.y, !0, 8), this._handleMouseButton(o.x, o.y, !1, 8), this._gestureLastMagnitudeY += Te;
                  for (; t.detail.magnitudeY - this._gestureLastMagnitudeY < -50; )
                    this._handleMouseButton(o.x, o.y, !0, 16), this._handleMouseButton(o.x, o.y, !1, 16), this._gestureLastMagnitudeY -= Te;
                  for (; t.detail.magnitudeX - this._gestureLastMagnitudeX > Te; )
                    this._handleMouseButton(o.x, o.y, !0, 32), this._handleMouseButton(o.x, o.y, !1, 32), this._gestureLastMagnitudeX += Te;
                  for (; t.detail.magnitudeX - this._gestureLastMagnitudeX < -50; )
                    this._handleMouseButton(o.x, o.y, !0, 64), this._handleMouseButton(o.x, o.y, !1, 64), this._gestureLastMagnitudeX -= Te;
                  break;
                case "pinch":
                  if (this._fakeMouseMove(t, o.x, o.y), d = Math.hypot(t.detail.magnitudeX, t.detail.magnitudeY), Math.abs(d - this._gestureLastMagnitudeX) > ve) {
                    for (this._handleKeyEvent(a.default.XK_Control_L, "ControlLeft", !0); d - this._gestureLastMagnitudeX > ve; )
                      this._handleMouseButton(o.x, o.y, !0, 8), this._handleMouseButton(o.x, o.y, !1, 8), this._gestureLastMagnitudeX += ve;
                    for (; d - this._gestureLastMagnitudeX < -75; )
                      this._handleMouseButton(o.x, o.y, !0, 16), this._handleMouseButton(o.x, o.y, !1, 16), this._gestureLastMagnitudeX -= ve;
                  }
                  this._handleKeyEvent(a.default.XK_Control_L, "ControlLeft", !1);
                  break;
              }
              break;
            case "gestureend":
              switch (t.detail.type) {
                case "onetap":
                case "twotap":
                case "threetap":
                case "pinch":
                case "twodrag":
                  break;
                case "drag":
                  this._fakeMouseMove(t, o.x, o.y), this._handleMouseButton(o.x, o.y, !1, 1);
                  break;
                case "longpress":
                  this._fakeMouseMove(t, o.x, o.y), this._handleMouseButton(o.x, o.y, !1, 4);
                  break;
              }
              break;
          }
        }
        // Message Handlers
      }, {
        key: "_negotiateProtocolVersion",
        value: function() {
          if (this._sock.rQwait("version", 12))
            return !1;
          var t = this._sock.rQshiftStr(12).substr(4, 7);
          A.Info("Server ProtocolVersion: " + t);
          var d = 0;
          switch (t) {
            case "000.000":
              d = 1;
              break;
            case "003.003":
            case "003.006":
              this._rfbVersion = 3.3;
              break;
            case "003.007":
              this._rfbVersion = 3.7;
              break;
            case "003.008":
            case "003.889":
            // Apple Remote Desktop
            case "004.000":
            // Intel AMT KVM
            case "004.001":
            // RealVNC 4.6
            case "005.000":
              this._rfbVersion = 3.8;
              break;
            default:
              return this._fail("Invalid server version " + t);
          }
          if (d) {
            for (var o = "ID:" + this._repeaterID; o.length < 250; )
              o += "\0";
            return this._sock.sQpushString(o), this._sock.flush(), !0;
          }
          this._rfbVersion > this._rfbMaxVersion && (this._rfbVersion = this._rfbMaxVersion);
          var M = "00" + parseInt(this._rfbVersion, 10) + ".00" + this._rfbVersion * 10 % 10;
          this._sock.sQpushString("RFB " + M + `
`), this._sock.flush(), A.Debug("Sent ProtocolVersion: " + M), this._rfbInitState = "Security";
        }
      }, {
        key: "_isSupportedSecurityType",
        value: function(t) {
          var d = [xe, We, Ye, lt, ut, tt, at, E, fe];
          return d.includes(t);
        }
      }, {
        key: "_negotiateSecurity",
        value: function() {
          if (this._rfbVersion >= 3.7) {
            var t = this._sock.rQshift8();
            if (this._sock.rQwait("security type", t, 1))
              return !1;
            if (t === 0)
              return this._rfbInitState = "SecurityReason", this._securityContext = "no security types", this._securityStatus = 1, !0;
            var d = this._sock.rQshiftBytes(t);
            A.Debug("Server security types: " + d), this._rfbAuthScheme = -1;
            var o = Ce(d), M;
            try {
              for (o.s(); !(M = o.n()).done; ) {
                var N = M.value;
                if (this._isSupportedSecurityType(N)) {
                  this._rfbAuthScheme = N;
                  break;
                }
              }
            } catch (G) {
              o.e(G);
            } finally {
              o.f();
            }
            if (this._rfbAuthScheme === -1)
              return this._fail("Unsupported security types (types: " + d + ")");
            this._sock.sQpush8(this._rfbAuthScheme), this._sock.flush();
          } else {
            if (this._sock.rQwait("security scheme", 4))
              return !1;
            if (this._rfbAuthScheme = this._sock.rQshift32(), this._rfbAuthScheme == 0)
              return this._rfbInitState = "SecurityReason", this._securityContext = "authentication scheme", this._securityStatus = 1, !0;
          }
          return this._rfbInitState = "Authentication", A.Debug("Authenticating using scheme: " + this._rfbAuthScheme), !0;
        }
      }, {
        key: "_handleSecurityReason",
        value: function() {
          if (this._sock.rQwait("reason length", 4))
            return !1;
          var t = this._sock.rQshift32(), d = "";
          if (t > 0) {
            if (this._sock.rQwait("reason", t, 4))
              return !1;
            d = this._sock.rQshiftStr(t);
          }
          return d !== "" ? (this.dispatchEvent(new CustomEvent("securityfailure", {
            detail: {
              status: this._securityStatus,
              reason: d
            }
          })), this._fail("Security negotiation failed on " + this._securityContext + " (reason: " + d + ")")) : (this.dispatchEvent(new CustomEvent("securityfailure", {
            detail: {
              status: this._securityStatus
            }
          })), this._fail("Security negotiation failed on " + this._securityContext));
        }
        // authentication
      }, {
        key: "_negotiateXvpAuth",
        value: function() {
          return this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0 || this._rfbCredentials.target === void 0 ? (this.dispatchEvent(new CustomEvent("credentialsrequired", {
            detail: {
              types: ["username", "password", "target"]
            }
          })), !1) : (this._sock.sQpush8(this._rfbCredentials.username.length), this._sock.sQpush8(this._rfbCredentials.target.length), this._sock.sQpushString(this._rfbCredentials.username), this._sock.sQpushString(this._rfbCredentials.target), this._sock.flush(), this._rfbAuthScheme = We, this._negotiateAuthentication());
        }
        // VeNCrypt authentication, currently only supports version 0.2 and only Plain subtype
      }, {
        key: "_negotiateVeNCryptAuth",
        value: function() {
          if (this._rfbVeNCryptState == 0) {
            if (this._sock.rQwait("vencrypt version", 2))
              return !1;
            var t = this._sock.rQshift8(), d = this._sock.rQshift8();
            if (!(t == 0 && d == 2))
              return this._fail("Unsupported VeNCrypt version " + t + "." + d);
            this._sock.sQpush8(0), this._sock.sQpush8(2), this._sock.flush(), this._rfbVeNCryptState = 1;
          }
          if (this._rfbVeNCryptState == 1) {
            if (this._sock.rQwait("vencrypt ack", 1))
              return !1;
            var o = this._sock.rQshift8();
            if (o != 0)
              return this._fail("VeNCrypt failure " + o);
            this._rfbVeNCryptState = 2;
          }
          if (this._rfbVeNCryptState == 2) {
            if (this._sock.rQwait("vencrypt subtypes length", 1))
              return !1;
            var M = this._sock.rQshift8();
            if (M < 1)
              return this._fail("VeNCrypt subtypes empty");
            this._rfbVeNCryptSubtypesLength = M, this._rfbVeNCryptState = 3;
          }
          if (this._rfbVeNCryptState == 3) {
            if (this._sock.rQwait("vencrypt subtypes", 4 * this._rfbVeNCryptSubtypesLength))
              return !1;
            for (var N = [], G = 0; G < this._rfbVeNCryptSubtypesLength; G++)
              N.push(this._sock.rQshift32());
            this._rfbAuthScheme = -1;
            for (var oe = 0, Le = N; oe < Le.length; oe++) {
              var Pe = Le[oe];
              if (Pe !== ut && this._isSupportedSecurityType(Pe)) {
                this._rfbAuthScheme = Pe;
                break;
              }
            }
            return this._rfbAuthScheme === -1 ? this._fail("Unsupported security types (types: " + N + ")") : (this._sock.sQpush32(this._rfbAuthScheme), this._sock.flush(), this._rfbVeNCryptState = 4, !0);
          }
        }
      }, {
        key: "_negotiatePlainAuth",
        value: function() {
          if (this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0)
            return this.dispatchEvent(new CustomEvent("credentialsrequired", {
              detail: {
                types: ["username", "password"]
              }
            })), !1;
          var t = (0, K.encodeUTF8)(this._rfbCredentials.username), d = (0, K.encodeUTF8)(this._rfbCredentials.password);
          return this._sock.sQpush32(t.length), this._sock.sQpush32(d.length), this._sock.sQpushString(t), this._sock.sQpushString(d), this._sock.flush(), this._rfbInitState = "SecurityResult", !0;
        }
      }, {
        key: "_negotiateStdVNCAuth",
        value: function() {
          if (this._sock.rQwait("auth challenge", 16))
            return !1;
          if (this._rfbCredentials.password === void 0)
            return this.dispatchEvent(new CustomEvent("credentialsrequired", {
              detail: {
                types: ["password"]
              }
            })), !1;
          var t = Array.prototype.slice.call(this._sock.rQshiftBytes(16)), d = k.genDES(this._rfbCredentials.password, t);
          return this._sock.sQpushBytes(d), this._sock.flush(), this._rfbInitState = "SecurityResult", !0;
        }
      }, {
        key: "_negotiateARDAuth",
        value: function() {
          if (this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0)
            return this.dispatchEvent(new CustomEvent("credentialsrequired", {
              detail: {
                types: ["username", "password"]
              }
            })), !1;
          if (this._rfbCredentials.ardPublicKey != null && this._rfbCredentials.ardCredentials != null)
            return this._sock.sQpushBytes(this._rfbCredentials.ardCredentials), this._sock.sQpushBytes(this._rfbCredentials.ardPublicKey), this._sock.flush(), this._rfbCredentials.ardCredentials = null, this._rfbCredentials.ardPublicKey = null, this._rfbInitState = "SecurityResult", !0;
          if (this._sock.rQwait("read ard", 4))
            return !1;
          var t = this._sock.rQshiftBytes(2), d = this._sock.rQshift16();
          if (this._sock.rQwait("read ard keylength", d * 2, 4))
            return !1;
          var o = this._sock.rQshiftBytes(d), M = this._sock.rQshiftBytes(d), N = v.default.generateKey({
            name: "DH",
            g: t,
            p: o
          }, !1, ["deriveBits"]);
          return this._negotiateARDAuthAsync(d, M, N), !1;
        }
      }, {
        key: "_negotiateARDAuthAsync",
        value: function() {
          var m = pe(/* @__PURE__ */ he().mark(function d(o, M, N) {
            var G, oe, Le, Pe, Xe, Re, Be, Ke, Ie, Ze;
            return he().wrap(function(Ne) {
              for (; ; ) switch (Ne.prev = Ne.next) {
                case 0:
                  for (G = v.default.exportKey("raw", N.publicKey), oe = v.default.deriveBits({
                    name: "DH",
                    public: M
                  }, N.privateKey, o * 8), Le = (0, K.encodeUTF8)(this._rfbCredentials.username).substring(0, 63), Pe = (0, K.encodeUTF8)(this._rfbCredentials.password).substring(0, 63), Xe = window.crypto.getRandomValues(new Uint8Array(128)), Re = 0; Re < Le.length; Re++)
                    Xe[Re] = Le.charCodeAt(Re);
                  for (Xe[Le.length] = 0, Be = 0; Be < Pe.length; Be++)
                    Xe[64 + Be] = Pe.charCodeAt(Be);
                  return Xe[64 + Pe.length] = 0, Ne.next = 11, v.default.digest("MD5", oe);
                case 11:
                  return Ke = Ne.sent, Ne.next = 14, v.default.importKey("raw", Ke, {
                    name: "AES-ECB"
                  }, !1, ["encrypt"]);
                case 14:
                  return Ie = Ne.sent, Ne.next = 17, v.default.encrypt({
                    name: "AES-ECB"
                  }, Ie, Xe);
                case 17:
                  Ze = Ne.sent, this._rfbCredentials.ardCredentials = Ze, this._rfbCredentials.ardPublicKey = G, this._resumeAuthentication();
                case 21:
                case "end":
                  return Ne.stop();
              }
            }, d, this);
          }));
          function t(d, o, M) {
            return m.apply(this, arguments);
          }
          return t;
        }()
      }, {
        key: "_negotiateTightUnixAuth",
        value: function() {
          return this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0 ? (this.dispatchEvent(new CustomEvent("credentialsrequired", {
            detail: {
              types: ["username", "password"]
            }
          })), !1) : (this._sock.sQpush32(this._rfbCredentials.username.length), this._sock.sQpush32(this._rfbCredentials.password.length), this._sock.sQpushString(this._rfbCredentials.username), this._sock.sQpushString(this._rfbCredentials.password), this._sock.flush(), this._rfbInitState = "SecurityResult", !0);
        }
      }, {
        key: "_negotiateTightTunnels",
        value: function(t) {
          for (var d = {
            0: {
              vendor: "TGHT",
              signature: "NOTUNNEL"
            }
          }, o = {}, M = 0; M < t; M++) {
            var N = this._sock.rQshift32(), G = this._sock.rQshiftStr(4), oe = this._sock.rQshiftStr(8);
            o[N] = {
              vendor: G,
              signature: oe
            };
          }
          return A.Debug("Server Tight tunnel types: " + o), o[1] && o[1].vendor === "SICR" && o[1].signature === "SCHANNEL" && (A.Debug("Detected Siemens server. Assuming NOTUNNEL support."), o[0] = {
            vendor: "TGHT",
            signature: "NOTUNNEL"
          }), o[0] ? o[0].vendor != d[0].vendor || o[0].signature != d[0].signature ? this._fail("Client's tunnel type had the incorrect vendor or signature") : (A.Debug("Selected tunnel type: " + d[0]), this._sock.sQpush32(0), this._sock.flush(), !1) : this._fail("Server wanted tunnels, but doesn't support the notunnel type");
        }
      }, {
        key: "_negotiateTightAuth",
        value: function() {
          if (!this._rfbTightVNC) {
            if (this._sock.rQwait("num tunnels", 4))
              return !1;
            var t = this._sock.rQshift32();
            if (t > 0 && this._sock.rQwait("tunnel capabilities", 16 * t, 4))
              return !1;
            if (this._rfbTightVNC = !0, t > 0)
              return this._negotiateTightTunnels(t), !1;
          }
          if (this._sock.rQwait("sub auth count", 4))
            return !1;
          var d = this._sock.rQshift32();
          if (d === 0)
            return this._rfbInitState = "SecurityResult", !0;
          if (this._sock.rQwait("sub auth capabilities", 16 * d, 4))
            return !1;
          for (var o = {
            STDVNOAUTH__: 1,
            STDVVNCAUTH_: 2,
            TGHTULGNAUTH: 129
          }, M = [], N = 0; N < d; N++) {
            this._sock.rQshift32();
            var G = this._sock.rQshiftStr(12);
            M.push(G);
          }
          A.Debug("Server Tight authentication types: " + M);
          for (var oe in o)
            if (M.indexOf(oe) != -1)
              switch (this._sock.sQpush32(o[oe]), this._sock.flush(), A.Debug("Selected authentication type: " + oe), oe) {
                case "STDVNOAUTH__":
                  return this._rfbInitState = "SecurityResult", !0;
                case "STDVVNCAUTH_":
                  return this._rfbAuthScheme = We, !0;
                case "TGHTULGNAUTH":
                  return this._rfbAuthScheme = se, !0;
                default:
                  return this._fail("Unsupported tiny auth scheme (scheme: " + oe + ")");
              }
          return this._fail("No supported sub-auth types!");
        }
      }, {
        key: "_handleRSAAESCredentialsRequired",
        value: function(t) {
          this.dispatchEvent(t);
        }
      }, {
        key: "_handleRSAAESServerVerification",
        value: function(t) {
          this.dispatchEvent(t);
        }
      }, {
        key: "_negotiateRA2neAuth",
        value: function() {
          var t = this;
          return this._rfbRSAAESAuthenticationState === null && (this._rfbRSAAESAuthenticationState = new x.default(this._sock, function() {
            return t._rfbCredentials;
          }), this._rfbRSAAESAuthenticationState.addEventListener("serververification", this._eventHandlers.handleRSAAESServerVerification), this._rfbRSAAESAuthenticationState.addEventListener("credentialsrequired", this._eventHandlers.handleRSAAESCredentialsRequired)), this._rfbRSAAESAuthenticationState.checkInternalEvents(), this._rfbRSAAESAuthenticationState.hasStarted || this._rfbRSAAESAuthenticationState.negotiateRA2neAuthAsync().catch(function(d) {
            d.message !== "disconnect normally" && t._fail(d.message);
          }).then(function() {
            return t._rfbInitState = "SecurityResult", !0;
          }).finally(function() {
            t._rfbRSAAESAuthenticationState.removeEventListener("serververification", t._eventHandlers.handleRSAAESServerVerification), t._rfbRSAAESAuthenticationState.removeEventListener("credentialsrequired", t._eventHandlers.handleRSAAESCredentialsRequired), t._rfbRSAAESAuthenticationState = null;
          }), !1;
        }
      }, {
        key: "_negotiateMSLogonIIAuth",
        value: function() {
          if (this._sock.rQwait("mslogonii dh param", 24))
            return !1;
          if (this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0)
            return this.dispatchEvent(new CustomEvent("credentialsrequired", {
              detail: {
                types: ["username", "password"]
              }
            })), !1;
          var t = this._sock.rQshiftBytes(8), d = this._sock.rQshiftBytes(8), o = this._sock.rQshiftBytes(8), M = v.default.generateKey({
            name: "DH",
            g: t,
            p: d
          }, !0, ["deriveBits"]), N = v.default.exportKey("raw", M.publicKey), G = v.default.deriveBits({
            name: "DH",
            public: o
          }, M.privateKey, 64), oe = v.default.importKey("raw", G, {
            name: "DES-CBC"
          }, !1, ["encrypt"]), Le = (0, K.encodeUTF8)(this._rfbCredentials.username).substring(0, 255), Pe = (0, K.encodeUTF8)(this._rfbCredentials.password).substring(0, 63), Xe = new Uint8Array(256), Re = new Uint8Array(64);
          window.crypto.getRandomValues(Xe), window.crypto.getRandomValues(Re);
          for (var Be = 0; Be < Le.length; Be++)
            Xe[Be] = Le.charCodeAt(Be);
          Xe[Le.length] = 0;
          for (var Ke = 0; Ke < Pe.length; Ke++)
            Re[Ke] = Pe.charCodeAt(Ke);
          return Re[Pe.length] = 0, Xe = v.default.encrypt({
            name: "DES-CBC",
            iv: G
          }, oe, Xe), Re = v.default.encrypt({
            name: "DES-CBC",
            iv: G
          }, oe, Re), this._sock.sQpushBytes(N), this._sock.sQpushBytes(Xe), this._sock.sQpushBytes(Re), this._sock.flush(), this._rfbInitState = "SecurityResult", !0;
        }
      }, {
        key: "_negotiateAuthentication",
        value: function() {
          switch (this._rfbAuthScheme) {
            case xe:
              return this._rfbVersion >= 3.8 ? this._rfbInitState = "SecurityResult" : this._rfbInitState = "ClientInitialisation", !0;
            case tt:
              return this._negotiateXvpAuth();
            case at:
              return this._negotiateARDAuth();
            case We:
              return this._negotiateStdVNCAuth();
            case lt:
              return this._negotiateTightAuth();
            case ut:
              return this._negotiateVeNCryptAuth();
            case fe:
              return this._negotiatePlainAuth();
            case se:
              return this._negotiateTightUnixAuth();
            case Ye:
              return this._negotiateRA2neAuth();
            case E:
              return this._negotiateMSLogonIIAuth();
            default:
              return this._fail("Unsupported auth scheme (scheme: " + this._rfbAuthScheme + ")");
          }
        }
      }, {
        key: "_handleSecurityResult",
        value: function() {
          if (this._sock.rQwait("VNC auth response ", 4))
            return !1;
          var t = this._sock.rQshift32();
          return t === 0 ? (this._rfbInitState = "ClientInitialisation", A.Debug("Authentication OK"), !0) : this._rfbVersion >= 3.8 ? (this._rfbInitState = "SecurityReason", this._securityContext = "security result", this._securityStatus = t, !0) : (this.dispatchEvent(new CustomEvent("securityfailure", {
            detail: {
              status: t
            }
          })), this._fail("Security handshake failed"));
        }
      }, {
        key: "_negotiateServerInit",
        value: function() {
          if (this._sock.rQwait("server initialization", 24))
            return !1;
          var t = this._sock.rQshift16(), d = this._sock.rQshift16(), o = this._sock.rQshift8(), M = this._sock.rQshift8(), N = this._sock.rQshift8(), G = this._sock.rQshift8(), oe = this._sock.rQshift16(), Le = this._sock.rQshift16(), Pe = this._sock.rQshift16(), Xe = this._sock.rQshift8(), Re = this._sock.rQshift8(), Be = this._sock.rQshift8();
          this._sock.rQskipBytes(3);
          var Ke = this._sock.rQshift32();
          if (this._sock.rQwait("server init name", Ke, 24))
            return !1;
          var Ie = this._sock.rQshiftStr(Ke);
          if (Ie = (0, K.decodeUTF8)(Ie, !0), this._rfbTightVNC) {
            if (this._sock.rQwait("TightVNC extended server init header", 8, 24 + Ke))
              return !1;
            var Ze = this._sock.rQshift16(), ze = this._sock.rQshift16(), Ne = this._sock.rQshift16();
            this._sock.rQskipBytes(2);
            var He = (Ze + ze + Ne) * 16;
            if (this._sock.rQwait("TightVNC extended server init header", He, 32 + Ke))
              return !1;
            this._sock.rQskipBytes(16 * Ze), this._sock.rQskipBytes(16 * ze), this._sock.rQskipBytes(16 * Ne);
          }
          return A.Info("Screen: " + t + "x" + d + ", bpp: " + o + ", depth: " + M + ", bigEndian: " + N + ", trueColor: " + G + ", redMax: " + oe + ", greenMax: " + Le + ", blueMax: " + Pe + ", redShift: " + Xe + ", greenShift: " + Re + ", blueShift: " + Be), this._setDesktopName(Ie), this._resize(t, d), this._viewOnly || this._keyboard.grab(), this._fbDepth = 24, this._fbName === "Intel(r) AMT KVM" && (A.Warn("Intel AMT KVM only supports 8/16 bit depths. Using low color mode."), this._fbDepth = 8), k.messages.pixelFormat(this._sock, this._fbDepth, !0), this._sendEncodings(), k.messages.fbUpdateRequest(this._sock, !1, 0, 0, this._fbWidth, this._fbHeight), this._updateConnectionState("connected"), !0;
        }
      }, {
        key: "_sendEncodings",
        value: function() {
          var t = [];
          t.push(c.encodings.encodingCopyRect), this._fbDepth == 24 && (t.push(c.encodings.encodingTight), t.push(c.encodings.encodingTightPNG), t.push(c.encodings.encodingZRLE), t.push(c.encodings.encodingJPEG), t.push(c.encodings.encodingHextile), t.push(c.encodings.encodingRRE)), t.push(c.encodings.encodingRaw), t.push(c.encodings.pseudoEncodingQualityLevel0 + this._qualityLevel), t.push(c.encodings.pseudoEncodingCompressLevel0 + this._compressionLevel), t.push(c.encodings.pseudoEncodingDesktopSize), t.push(c.encodings.pseudoEncodingLastRect), t.push(c.encodings.pseudoEncodingQEMUExtendedKeyEvent), t.push(c.encodings.pseudoEncodingQEMULedEvent), t.push(c.encodings.pseudoEncodingExtendedDesktopSize), t.push(c.encodings.pseudoEncodingXvp), t.push(c.encodings.pseudoEncodingFence), t.push(c.encodings.pseudoEncodingContinuousUpdates), t.push(c.encodings.pseudoEncodingDesktopName), t.push(c.encodings.pseudoEncodingExtendedClipboard), this._fbDepth == 24 && (t.push(c.encodings.pseudoEncodingVMwareCursor), t.push(c.encodings.pseudoEncodingCursor)), k.messages.clientEncodings(this._sock, t);
        }
        /* RFB protocol initialization states:
         *   ProtocolVersion
         *   Security
         *   Authentication
         *   SecurityResult
         *   ClientInitialization - not triggered by server message
         *   ServerInitialization
         */
      }, {
        key: "_initMsg",
        value: function() {
          switch (this._rfbInitState) {
            case "ProtocolVersion":
              return this._negotiateProtocolVersion();
            case "Security":
              return this._negotiateSecurity();
            case "Authentication":
              return this._negotiateAuthentication();
            case "SecurityResult":
              return this._handleSecurityResult();
            case "SecurityReason":
              return this._handleSecurityReason();
            case "ClientInitialisation":
              return this._sock.sQpush8(this._shared ? 1 : 0), this._sock.flush(), this._rfbInitState = "ServerInitialisation", !0;
            case "ServerInitialisation":
              return this._negotiateServerInit();
            default:
              return this._fail("Unknown init state (state: " + this._rfbInitState + ")");
          }
        }
        // Resume authentication handshake after it was paused for some
        // reason, e.g. waiting for a password from the user
      }, {
        key: "_resumeAuthentication",
        value: function() {
          setTimeout(this._initMsg.bind(this), 0);
        }
      }, {
        key: "_handleSetColourMapMsg",
        value: function() {
          return A.Debug("SetColorMapEntries"), this._fail("Unexpected SetColorMapEntries message");
        }
      }, {
        key: "_handleServerCutText",
        value: function() {
          if (A.Debug("ServerCutText"), this._sock.rQwait("ServerCutText header", 7, 1))
            return !1;
          this._sock.rQskipBytes(3);
          var t = this._sock.rQshift32();
          if (t = (0, Y.toSigned32bit)(t), this._sock.rQwait("ServerCutText content", Math.abs(t), 8))
            return !1;
          if (t >= 0) {
            var d = this._sock.rQshiftStr(t);
            if (this._viewOnly)
              return !0;
            this.dispatchEvent(new CustomEvent("clipboard", {
              detail: {
                text: d
              }
            }));
          } else {
            t = Math.abs(t);
            var o = this._sock.rQshift32(), M = o & 65535, N = o & 4278190080, G = !!(N & Fe);
            if (G) {
              this._clipboardServerCapabilitiesFormats = {}, this._clipboardServerCapabilitiesActions = {};
              for (var oe = 0; oe <= 15; oe++) {
                var Le = 1 << oe;
                M & Le && (this._clipboardServerCapabilitiesFormats[Le] = !0, this._sock.rQshift32());
              }
              for (var Pe = 24; Pe <= 31; Pe++) {
                var Xe = 1 << Pe;
                this._clipboardServerCapabilitiesActions[Xe] = !!(N & Xe);
              }
              var Re = [Fe, R, Z, w, ce];
              k.messages.extendedClipboardCaps(this._sock, Re, {
                extendedClipboardFormatText: 0
              });
            } else if (N === R) {
              if (this._viewOnly)
                return !0;
              this._clipboardText != null && this._clipboardServerCapabilitiesActions[ce] && M & ye && k.messages.extendedClipboardProvide(this._sock, [ye], [this._clipboardText]);
            } else if (N === Z) {
              if (this._viewOnly)
                return !0;
              this._clipboardServerCapabilitiesActions[w] && (this._clipboardText != null ? k.messages.extendedClipboardNotify(this._sock, [ye]) : k.messages.extendedClipboardNotify(this._sock, []));
            } else if (N === w) {
              if (this._viewOnly)
                return !0;
              this._clipboardServerCapabilitiesActions[R] && M & ye && k.messages.extendedClipboardRequest(this._sock, [ye]);
            } else if (N === ce) {
              if (this._viewOnly || !(M & ye))
                return !0;
              this._clipboardText = null;
              var Be = this._sock.rQshiftBytes(t - 4), Ke = new s.default(), Ie = null;
              Ke.setInput(Be);
              for (var Ze = 0; Ze <= 15; Ze++) {
                var ze = 1 << Ze;
                if (M & ze) {
                  var Ne = 0, He = Ke.inflate(4);
                  Ne |= He[0] << 24, Ne |= He[1] << 16, Ne |= He[2] << 8, Ne |= He[3];
                  var et = Ke.inflate(Ne);
                  ze === ye && (Ie = et);
                }
              }
              if (Ke.setInput(null), Ie !== null) {
                for (var rt = "", ot = 0; ot < Ie.length; ot++)
                  rt += String.fromCharCode(Ie[ot]);
                Ie = rt, Ie = (0, K.decodeUTF8)(Ie), Ie.length > 0 && Ie.charAt(Ie.length - 1) === "\0" && (Ie = Ie.slice(0, -1)), Ie = Ie.replaceAll(`\r
`, `
`), this.dispatchEvent(new CustomEvent("clipboard", {
                  detail: {
                    text: Ie
                  }
                }));
              }
            } else
              return this._fail("Unexpected action in extended clipboard message: " + N);
          }
          return !0;
        }
      }, {
        key: "_handleServerFenceMsg",
        value: function() {
          if (this._sock.rQwait("ServerFence header", 8, 1))
            return !1;
          this._sock.rQskipBytes(3);
          var t = this._sock.rQshift32(), d = this._sock.rQshift8();
          if (this._sock.rQwait("ServerFence payload", d, 9))
            return !1;
          d > 64 && (A.Warn("Bad payload length (" + d + ") in fence response"), d = 64);
          var o = this._sock.rQshiftStr(d);
          return this._supportsFence = !0, t & 1 << 31 ? (t &= 3, k.messages.clientFence(this._sock, t, o), !0) : this._fail("Unexpected fence response");
        }
      }, {
        key: "_handleXvpMsg",
        value: function() {
          if (this._sock.rQwait("XVP version and message", 3, 1))
            return !1;
          this._sock.rQskipBytes(1);
          var t = this._sock.rQshift8(), d = this._sock.rQshift8();
          switch (d) {
            case 0:
              A.Error("XVP Operation Failed");
              break;
            case 1:
              this._rfbXvpVer = t, A.Info("XVP extensions enabled (version " + this._rfbXvpVer + ")"), this._setCapability("power", !0);
              break;
            default:
              this._fail("Illegal server XVP message (msg: " + d + ")");
              break;
          }
          return !0;
        }
      }, {
        key: "_normalMsg",
        value: function() {
          var t;
          this._FBU.rects > 0 ? t = 0 : t = this._sock.rQshift8();
          var d, o;
          switch (t) {
            case 0:
              return o = this._framebufferUpdate(), o && !this._enabledContinuousUpdates && k.messages.fbUpdateRequest(this._sock, !0, 0, 0, this._fbWidth, this._fbHeight), o;
            case 1:
              return this._handleSetColourMapMsg();
            case 2:
              return A.Debug("Bell"), this.dispatchEvent(new CustomEvent("bell", {
                detail: {}
              })), !0;
            case 3:
              return this._handleServerCutText();
            case 150:
              return d = !this._supportsContinuousUpdates, this._supportsContinuousUpdates = !0, this._enabledContinuousUpdates = !1, d && (this._enabledContinuousUpdates = !0, this._updateContinuousUpdates(), A.Info("Enabling continuous updates.")), !0;
            case 248:
              return this._handleServerFenceMsg();
            case 250:
              return this._handleXvpMsg();
            default:
              return this._fail("Unexpected server message (type " + t + ")"), A.Debug("sock.rQpeekBytes(30): " + this._sock.rQpeekBytes(30)), !0;
          }
        }
      }, {
        key: "_framebufferUpdate",
        value: function() {
          var t = this;
          if (this._FBU.rects === 0) {
            if (this._sock.rQwait("FBU header", 3, 1))
              return !1;
            if (this._sock.rQskipBytes(1), this._FBU.rects = this._sock.rQshift16(), this._display.pending())
              return this._flushing = !0, this._display.flush().then(function() {
                t._flushing = !1, t._sock.rQwait("message", 1) || t._handleMessage();
              }), !1;
          }
          for (; this._FBU.rects > 0; ) {
            if (this._FBU.encoding === null) {
              if (this._sock.rQwait("rect header", 12))
                return !1;
              this._FBU.x = this._sock.rQshift16(), this._FBU.y = this._sock.rQshift16(), this._FBU.width = this._sock.rQshift16(), this._FBU.height = this._sock.rQshift16(), this._FBU.encoding = this._sock.rQshift32(), this._FBU.encoding >>= 0;
            }
            if (!this._handleRect())
              return !1;
            this._FBU.rects--, this._FBU.encoding = null;
          }
          return this._display.flip(), !0;
        }
      }, {
        key: "_handleRect",
        value: function() {
          switch (this._FBU.encoding) {
            case c.encodings.pseudoEncodingLastRect:
              return this._FBU.rects = 1, !0;
            case c.encodings.pseudoEncodingVMwareCursor:
              return this._handleVMwareCursor();
            case c.encodings.pseudoEncodingCursor:
              return this._handleCursor();
            case c.encodings.pseudoEncodingQEMUExtendedKeyEvent:
              return this._qemuExtKeyEventSupported = !0, !0;
            case c.encodings.pseudoEncodingDesktopName:
              return this._handleDesktopName();
            case c.encodings.pseudoEncodingDesktopSize:
              return this._resize(this._FBU.width, this._FBU.height), !0;
            case c.encodings.pseudoEncodingExtendedDesktopSize:
              return this._handleExtendedDesktopSize();
            case c.encodings.pseudoEncodingQEMULedEvent:
              return this._handleLedEvent();
            default:
              return this._handleDataRect();
          }
        }
      }, {
        key: "_handleVMwareCursor",
        value: function() {
          var t = this._FBU.x, d = this._FBU.y, o = this._FBU.width, M = this._FBU.height;
          if (this._sock.rQwait("VMware cursor encoding", 1))
            return !1;
          var N = this._sock.rQshift8();
          this._sock.rQshift8();
          var G, oe = 4;
          if (N == 0) {
            var Le = -256;
            if (G = new Array(o * M * oe), this._sock.rQwait("VMware cursor classic encoding", o * M * oe * 2, 2))
              return !1;
            for (var Pe = new Array(o * M), Xe = 0; Xe < o * M; Xe++)
              Pe[Xe] = this._sock.rQshift32();
            for (var Re = new Array(o * M), Be = 0; Be < o * M; Be++)
              Re[Be] = this._sock.rQshift32();
            for (var Ke = 0; Ke < o * M; Ke++)
              if (Pe[Ke] == 0) {
                var Ie = Re[Ke], Ze = Ie >> 8 & 255, ze = Ie >> 16 & 255, Ne = Ie >> 24 & 255;
                G[Ke * oe] = Ze, G[Ke * oe + 1] = ze, G[Ke * oe + 2] = Ne, G[Ke * oe + 3] = 255;
              } else (Pe[Ke] & Le) == Le ? Re[Ke] == 0 ? (G[Ke * oe] = 0, G[Ke * oe + 1] = 0, G[Ke * oe + 2] = 0, G[Ke * oe + 3] = 0) : ((Re[Ke] & Le) == Le, G[Ke * oe] = 0, G[Ke * oe + 1] = 0, G[Ke * oe + 2] = 0, G[Ke * oe + 3] = 255) : (G[Ke * oe] = 0, G[Ke * oe + 1] = 0, G[Ke * oe + 2] = 0, G[Ke * oe + 3] = 255);
          } else if (N == 1) {
            if (this._sock.rQwait("VMware cursor alpha encoding", o * M * 4, 2))
              return !1;
            G = new Array(o * M * oe);
            for (var He = 0; He < o * M; He++) {
              var et = this._sock.rQshift32();
              G[He * 4] = et >> 24 & 255, G[He * 4 + 1] = et >> 16 & 255, G[He * 4 + 2] = et >> 8 & 255, G[He * 4 + 3] = et & 255;
            }
          } else
            return A.Warn("The given cursor type is not supported: " + N + " given."), !1;
          return this._updateCursor(G, t, d, o, M), !0;
        }
      }, {
        key: "_handleCursor",
        value: function() {
          var t = this._FBU.x, d = this._FBU.y, o = this._FBU.width, M = this._FBU.height, N = o * M * 4, G = Math.ceil(o / 8) * M, oe = N + G;
          if (this._sock.rQwait("cursor encoding", oe))
            return !1;
          for (var Le = this._sock.rQshiftBytes(N), Pe = this._sock.rQshiftBytes(G), Xe = new Uint8Array(o * M * 4), Re = 0, Be = 0; Be < M; Be++)
            for (var Ke = 0; Ke < o; Ke++) {
              var Ie = Be * Math.ceil(o / 8) + Math.floor(Ke / 8), Ze = Pe[Ie] << Ke % 8 & 128 ? 255 : 0;
              Xe[Re] = Le[Re + 2], Xe[Re + 1] = Le[Re + 1], Xe[Re + 2] = Le[Re], Xe[Re + 3] = Ze, Re += 4;
            }
          return this._updateCursor(Xe, t, d, o, M), !0;
        }
      }, {
        key: "_handleDesktopName",
        value: function() {
          if (this._sock.rQwait("DesktopName", 4))
            return !1;
          var t = this._sock.rQshift32();
          if (this._sock.rQwait("DesktopName", t, 4))
            return !1;
          var d = this._sock.rQshiftStr(t);
          return d = (0, K.decodeUTF8)(d, !0), this._setDesktopName(d), !0;
        }
      }, {
        key: "_handleLedEvent",
        value: function() {
          if (this._sock.rQwait("LED Status", 1))
            return !1;
          var t = this._sock.rQshift8(), d = !!(t & 2), o = !!(t & 4);
          return this._remoteCapsLock = o, this._remoteNumLock = d, !0;
        }
      }, {
        key: "_handleExtendedDesktopSize",
        value: function() {
          if (this._sock.rQwait("ExtendedDesktopSize", 4))
            return !1;
          var t = this._sock.rQpeek8(), d = 4 + t * 16;
          if (this._sock.rQwait("ExtendedDesktopSize", d))
            return !1;
          var o = !this._supportsSetDesktopSize;
          this._supportsSetDesktopSize = !0, this._sock.rQskipBytes(1), this._sock.rQskipBytes(3);
          for (var M = 0; M < t; M += 1)
            M === 0 ? (this._screenID = this._sock.rQshift32(), this._sock.rQskipBytes(2), this._sock.rQskipBytes(2), this._sock.rQskipBytes(2), this._sock.rQskipBytes(2), this._screenFlags = this._sock.rQshift32()) : this._sock.rQskipBytes(16);
          if (this._FBU.x === 1 && this._FBU.y !== 0) {
            var N = "";
            switch (this._FBU.y) {
              case 1:
                N = "Resize is administratively prohibited";
                break;
              case 2:
                N = "Out of resources";
                break;
              case 3:
                N = "Invalid screen layout";
                break;
              default:
                N = "Unknown reason";
                break;
            }
            A.Warn("Server did not accept the resize request: " + N);
          } else
            this._resize(this._FBU.width, this._FBU.height);
          return o && this._requestRemoteResize(), !0;
        }
      }, {
        key: "_handleDataRect",
        value: function() {
          var t = this._decoders[this._FBU.encoding];
          if (!t)
            return this._fail("Unsupported encoding (encoding: " + this._FBU.encoding + ")"), !1;
          try {
            return t.decodeRect(this._FBU.x, this._FBU.y, this._FBU.width, this._FBU.height, this._sock, this._display, this._fbDepth);
          } catch (d) {
            return this._fail("Error decoding rect: " + d), !1;
          }
        }
      }, {
        key: "_updateContinuousUpdates",
        value: function() {
          this._enabledContinuousUpdates && k.messages.enableContinuousUpdates(this._sock, !0, 0, 0, this._fbWidth, this._fbHeight);
        }
      }, {
        key: "_resize",
        value: function(t, d) {
          this._fbWidth = t, this._fbHeight = d, this._display.resize(this._fbWidth, this._fbHeight), this._updateClip(), this._updateScale(), this._updateContinuousUpdates(), this._saveExpectedClientSize();
        }
      }, {
        key: "_xvpOp",
        value: function(t, d) {
          this._rfbXvpVer < t || (A.Info("Sending XVP operation " + d + " (version " + t + ")"), k.messages.xvpOp(this._sock, t, d));
        }
      }, {
        key: "_updateCursor",
        value: function(t, d, o, M, N) {
          this._cursorImage = {
            rgbaPixels: t,
            hotx: d,
            hoty: o,
            w: M,
            h: N
          }, this._refreshCursor();
        }
      }, {
        key: "_shouldShowDotCursor",
        value: function() {
          if (!this._showDotCursor)
            return !1;
          for (var t = 3; t < this._cursorImage.rgbaPixels.length; t += 4)
            if (this._cursorImage.rgbaPixels[t])
              return !1;
          return !0;
        }
      }, {
        key: "_refreshCursor",
        value: function() {
          if (!(this._rfbConnectionState !== "connecting" && this._rfbConnectionState !== "connected")) {
            var t = this._shouldShowDotCursor() ? k.cursors.dot : this._cursorImage;
            this._cursor.change(t.rgbaPixels, t.hotx, t.hoty, t.w, t.h);
          }
        }
      }], [{
        key: "genDES",
        value: function(t, d) {
          var o = t.split("").map(function(N) {
            return N.charCodeAt(0);
          }), M = v.default.importKey("raw", o, {
            name: "DES-ECB"
          }, !1, ["encrypt"]);
          return v.default.encrypt({
            name: "DES-ECB"
          }, M, d);
        }
      }]);
    }(u.default);
    Ee.messages = {
      keyEvent: function(k, m, t) {
        k.sQpush8(4), k.sQpush8(t), k.sQpush16(0), k.sQpush32(m), k.flush();
      },
      QEMUExtendedKeyEvent: function(k, m, t, d) {
        function o(N) {
          var G = d >> 8, oe = d & 255;
          return G === 224 && oe < 127 ? oe | 128 : N;
        }
        k.sQpush8(255), k.sQpush8(0), k.sQpush16(t), k.sQpush32(m);
        var M = o(d);
        k.sQpush32(M), k.flush();
      },
      pointerEvent: function(k, m, t, d) {
        k.sQpush8(5), k.sQpush8(d), k.sQpush16(m), k.sQpush16(t), k.flush();
      },
      // Used to build Notify and Request data.
      _buildExtendedClipboardFlags: function(k, m) {
        for (var t = new Uint8Array(4), d = 0, o = 0, M = 0; M < k.length; M++)
          o |= k[M];
        for (var N = 0; N < m.length; N++)
          d |= m[N];
        return t[0] = o >> 24, t[1] = 0, t[2] = 0, t[3] = d, t;
      },
      extendedClipboardProvide: function(k, m, t) {
        for (var d = new p.default(), o = [], M = 0; M < m.length; M++) {
          if (m[M] != ye)
            throw new Error("Unsupported extended clipboard format for Provide message.");
          t[M] = t[M].replace(/\r\n|\r|\n/gm, `\r
`);
          var N = (0, K.encodeUTF8)(t[M] + "\0");
          o.push(N.length >> 24 & 255, N.length >> 16 & 255, N.length >> 8 & 255, N.length & 255);
          for (var G = 0; G < N.length; G++)
            o.push(N.charCodeAt(G));
        }
        var oe = d.deflate(new Uint8Array(o)), Le = new Uint8Array(4 + oe.length);
        Le.set(Ee.messages._buildExtendedClipboardFlags([ce], m)), Le.set(oe, 4), Ee.messages.clientCutText(k, Le, !0);
      },
      extendedClipboardNotify: function(k, m) {
        var t = Ee.messages._buildExtendedClipboardFlags([w], m);
        Ee.messages.clientCutText(k, t, !0);
      },
      extendedClipboardRequest: function(k, m) {
        var t = Ee.messages._buildExtendedClipboardFlags([R], m);
        Ee.messages.clientCutText(k, t, !0);
      },
      extendedClipboardCaps: function(k, m, t) {
        var d = Object.keys(t), o = new Uint8Array(4 + 4 * d.length);
        d.map(function(G) {
          return parseInt(G);
        }), d.sort(function(G, oe) {
          return G - oe;
        }), o.set(Ee.messages._buildExtendedClipboardFlags(m, []));
        for (var M = 4, N = 0; N < d.length; N++)
          o[M] = t[d[N]] >> 24, o[M + 1] = t[d[N]] >> 16, o[M + 2] = t[d[N]] >> 8, o[M + 3] = t[d[N]] >> 0, M += 4, o[3] |= 1 << d[N];
        Ee.messages.clientCutText(k, o, !0);
      },
      clientCutText: function(k, m) {
        var t = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : !1;
        k.sQpush8(6), k.sQpush8(0), k.sQpush8(0), k.sQpush8(0);
        var d;
        t ? d = (0, Y.toUnsigned32bit)(-m.length) : d = m.length, k.sQpush32(d), k.sQpushBytes(m), k.flush();
      },
      setDesktopSize: function(k, m, t, d, o) {
        k.sQpush8(251), k.sQpush8(0), k.sQpush16(m), k.sQpush16(t), k.sQpush8(1), k.sQpush8(0), k.sQpush32(d), k.sQpush16(0), k.sQpush16(0), k.sQpush16(m), k.sQpush16(t), k.sQpush32(o), k.flush();
      },
      clientFence: function(k, m, t) {
        k.sQpush8(248), k.sQpush8(0), k.sQpush8(0), k.sQpush8(0), k.sQpush32(m), k.sQpush8(t.length), k.sQpushString(t), k.flush();
      },
      enableContinuousUpdates: function(k, m, t, d, o, M) {
        k.sQpush8(150), k.sQpush8(m), k.sQpush16(t), k.sQpush16(d), k.sQpush16(o), k.sQpush16(M), k.flush();
      },
      pixelFormat: function(k, m, t) {
        var d;
        m > 16 ? d = 32 : m > 8 ? d = 16 : d = 8;
        var o = Math.floor(m / 3);
        k.sQpush8(0), k.sQpush8(0), k.sQpush8(0), k.sQpush8(0), k.sQpush8(d), k.sQpush8(m), k.sQpush8(0), k.sQpush8(t ? 1 : 0), k.sQpush16((1 << o) - 1), k.sQpush16((1 << o) - 1), k.sQpush16((1 << o) - 1), k.sQpush8(o * 0), k.sQpush8(o * 1), k.sQpush8(o * 2), k.sQpush8(0), k.sQpush8(0), k.sQpush8(0), k.flush();
      },
      clientEncodings: function(k, m) {
        k.sQpush8(2), k.sQpush8(0), k.sQpush16(m.length);
        for (var t = 0; t < m.length; t++)
          k.sQpush32(m[t]);
        k.flush();
      },
      fbUpdateRequest: function(k, m, t, d, o, M) {
        typeof t > "u" && (t = 0), typeof d > "u" && (d = 0), k.sQpush8(3), k.sQpush8(m ? 1 : 0), k.sQpush16(t), k.sQpush16(d), k.sQpush16(o), k.sQpush16(M), k.flush();
      },
      xvpOp: function(k, m, t) {
        k.sQpush8(250), k.sQpush8(0), k.sQpush8(m), k.sQpush8(t), k.flush();
      }
    }, Ee.cursors = {
      none: {
        rgbaPixels: new Uint8Array(),
        w: 0,
        h: 0,
        hotx: 0,
        hoty: 0
      },
      dot: {
        /* eslint-disable indent */
        rgbaPixels: new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
        /* eslint-enable indent */
        w: 3,
        h: 3,
        hotx: 1,
        hoty: 1
      }
    };
  }(Mt)), Mt;
}
var hi = ci();
const di = /* @__PURE__ */ Rn(hi), _i = (P, h) => {
  const Y = (0,react__WEBPACK_IMPORTED_MODULE_1__.useRef)(null), A = (0,react__WEBPACK_IMPORTED_MODULE_1__.useRef)(P.autoConnect ?? !0), K = (0,react__WEBPACK_IMPORTED_MODULE_1__.useRef)([]), I = (0,react__WEBPACK_IMPORTED_MODULE_1__.useRef)({}), L = (0,react__WEBPACK_IMPORTED_MODULE_1__.useRef)(null), [C, u] = (0,react__WEBPACK_IMPORTED_MODULE_1__.useState)(!0), {
    url: _,
    style: s,
    className: p,
    viewOnly: f,
    rfbOptions: r,
    focusOnClick: i,
    clipViewport: l,
    dragViewport: a,
    scaleViewport: n,
    resizeSession: c,
    showDotCursor: x,
    background: v,
    qualityLevel: b,
    compressionLevel: y,
    autoConnect: g = !0,
    retryDuration: S = 3e3,
    debug: X = !1,
    onConnect: F,
    onDisconnect: T,
    onCredentialsRequired: Q,
    onSecurityFailure: D,
    onClipboard: j,
    onBell: te,
    onDesktopName: he,
    onCapabilities: ge
  } = P, pe = {
    log: (...O) => {
      X && console.log(...O);
    },
    info: (...O) => {
      X && console.info(...O);
    },
    error: (...O) => {
      X && console.error(...O);
    }
  }, we = () => Y.current, Ae = (O) => {
    Y.current = O;
  }, de = () => A.current, ke = (O) => {
    A.current = O;
  }, Ce = (O) => {
    if (F) {
      F(O), u(!1);
      return;
    }
    pe.info("Connected to remote VNC."), u(!1);
  }, Oe = (O) => {
    if (T) {
      T(O), u(!0);
      return;
    }
    de() ? (pe.info(`Unexpectedly disconnected from remote VNC, retrying in ${S / 1e3} seconds.`), K.current.push(setTimeout(z, S))) : pe.info("Disconnected from remote VNC."), u(!0);
  }, J = (O) => {
    var qe, xe, We;
    const ne = we();
    if (Q) {
      Q(O);
      return;
    }
    const ve = ((qe = r == null ? void 0 : r.credentials) == null ? void 0 : qe.username) ?? "", Te = ((xe = r == null ? void 0 : r.credentials) == null ? void 0 : xe.password) ?? "", Ge = ((We = r == null ? void 0 : r.credentials) == null ? void 0 : We.target) ?? "";
    ne == null || ne.sendCredentials({ password: Te, username: ve, target: Ge });
  }, $ = (O) => {
    if (he) {
      he(O);
      return;
    }
    pe.info(`Desktop name is ${O.detail.name}`);
  }, re = () => {
    const O = we();
    try {
      if (!O)
        return;
      K.current.forEach(clearTimeout), Object.keys(I.current).forEach((ne) => {
        I.current[ne] && (O.removeEventListener(ne, I.current[ne]), I.current[ne] = void 0);
      }), O.disconnect(), Ae(null), ke(!1), Oe(new CustomEvent("disconnect", { detail: { clean: !0 } }));
    } catch (ne) {
      pe.error(ne), Ae(null), ke(!1);
    }
  }, z = () => {
    try {
      if (A && Y && re(), !L.current)
        return;
      L.current.innerHTML = "";
      const O = new di(L.current, _, r);
      O.viewOnly = f ?? !1, O.focusOnClick = i ?? !1, O.clipViewport = l ?? !1, O.dragViewport = a ?? !1, O.resizeSession = c ?? !1, O.scaleViewport = n ?? !1, O.showDotCursor = x ?? !1, O.background = v ?? "", O.qualityLevel = b ?? 6, O.compressionLevel = y ?? 2, Ae(O), I.current.connect = Ce, I.current.disconnect = Oe, I.current.credentialsrequired = J, I.current.securityfailure = D, I.current.clipboard = j, I.current.bell = te, I.current.desktopname = $, I.current.capabilities = ge, Object.keys(I.current).forEach((ne) => {
        I.current[ne] && O.addEventListener(ne, I.current[ne]);
      }), ke(!0);
    } catch (O) {
      pe.error(O);
    }
  }, B = (O) => {
    const ne = we(), ve = {
      username: (O == null ? void 0 : O.username) ?? "",
      password: (O == null ? void 0 : O.password) ?? "",
      target: (O == null ? void 0 : O.target) ?? ""
    };
    ne == null || ne.sendCredentials(ve);
  }, U = (O, ne, ve) => {
    const Te = we();
    Te == null || Te.sendKey(O, ne, ve);
  }, ue = () => {
    const O = we();
    O == null || O.sendCtrlAltDel();
  }, le = () => {
    const O = we();
    O == null || O.focus();
  }, H = () => {
    const O = we();
    O == null || O.blur();
  }, q = () => {
    const O = we();
    O == null || O.machineShutdown();
  }, ee = () => {
    const O = we();
    O == null || O.machineReboot();
  }, ie = () => {
    const O = we();
    O == null || O.machineReset();
  }, be = (O) => {
    const ne = we();
    ne == null || ne.clipboardPasteFrom(O);
  };
  (0,react__WEBPACK_IMPORTED_MODULE_1__.useImperativeHandle)(h, () => ({
    connect: z,
    disconnect: re,
    connected: A.current,
    sendCredentials: B,
    sendKey: U,
    sendCtrlAltDel: ue,
    focus: le,
    blur: H,
    machineShutdown: q,
    machineReboot: ee,
    machineReset: ie,
    clipboardPaste: be,
    rfb: Y.current,
    loading: C,
    eventListeners: I.current
  })), (0,react__WEBPACK_IMPORTED_MODULE_1__.useEffect)(() => (g && z(), re), []);
  const V = () => {
    const O = we();
    O && O.focus();
  };
  return /* @__PURE__ */ (0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_0__.jsx)(
    "div",
    {
      style: s,
      className: p,
      ref: L,
      onMouseEnter: () => {
        document.activeElement && document.activeElement instanceof HTMLElement && document.activeElement.blur(), V();
      },
      onMouseLeave: () => {
        const O = we();
        O && O.blur();
      }
    }
  );
}, yi = (0,react__WEBPACK_IMPORTED_MODULE_1__.forwardRef)(_i);



/***/ })

}]);
//# sourceMappingURL=586eae61-03a4de0ab2345507ffc4.js.map