"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[1453],{

/***/ 70731:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Head: function() { return /* binding */ Head; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var gatsby__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(64810);


const containerStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  padding: "2rem",
  textAlign: "center",
  backgroundColor: "#f8f9fa",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif"
};
const headingStyle = {
  fontSize: "6rem",
  margin: 0,
  color: "#343a40",
  fontWeight: 700
};
const subheadingStyle = {
  fontSize: "2rem",
  margin: "1rem 0 2rem",
  color: "#495057",
  fontWeight: 500
};
const textStyle = {
  fontSize: "1.2rem",
  marginBottom: "2rem",
  color: "#6c757d",
  maxWidth: "600px"
};
const linkStyle = {
  display: "inline-block",
  padding: "0.75rem 1.5rem",
  backgroundColor: "#007bff",
  color: "white",
  textDecoration: "none",
  borderRadius: "4px",
  fontWeight: 500,
  transition: "background-color 0.2s ease"
};
const NotFoundPage = () => {
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("main", {
    style: containerStyle
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h1", {
    style: headingStyle
  }, "404"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h2", {
    style: subheadingStyle
  }, "Page Not Found"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
    style: textStyle
  }, "Sorry, we couldn't find the page you're looking for. The page might have been moved, deleted, or never existed."), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(gatsby__WEBPACK_IMPORTED_MODULE_1__.Link, {
    to: "/",
    style: linkStyle,
    onMouseOver: e => {
      e.currentTarget.style.backgroundColor = "#0069d9";
    },
    onMouseOut: e => {
      e.currentTarget.style.backgroundColor = "#007bff";
    }
  }, "Return to Home"));
};
/* harmony default export */ __webpack_exports__["default"] = (NotFoundPage);
const Head = () => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("title", null, "Page Not Found | Magentic-UI ");

/***/ })

}]);
//# sourceMappingURL=component---src-pages-404-tsx-6289d10b647aca46033b.js.map