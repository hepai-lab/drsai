"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[5956],{

/***/ 62858:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ library_LibraryPage; }
});

// EXTERNAL MODULE: ./node_modules/core-js/modules/es.array.sort.js
var es_array_sort = __webpack_require__(26910);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
;// ./src/assets/file-icons/office-docx.svg
/* harmony default export */ var office_docx = ("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyBjbGFzcz0iaWNvbiIgd2lkdGg9IjIwMHB4IiBoZWlnaHQ9IjIwMC4wMHB4IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTU5NC45NDQgMGwzMzUuMTI0IDM0MS4zMnY1NjMuMmMwIDY1Ljk5Ni01Mi41IDExOS40OC0xMTcuMjk0IDExOS40OEgyMDkuNTQ2Yy02NC43OTMgMC0xMTcuMjk5LTUzLjUzLTExNy4yOTktMTE5LjQ4VjExOS40OEM5Mi4yNTIgNTMuNDg0IDE0NC43NTcgMCAyMDkuNTUxIDBoMzg1LjM5M3oiIGZpbGw9IiM1ODk1RkYiIC8+PHBhdGggZD0iTTkzMC4wNjggMzQxLjMySDcxOC4xNTJjLTY0Ljc0OCAwLTEyMy4yMDgtNTkuNDktMTIzLjIwOC0xMjUuNDkyVjBsMzM1LjEyNCAzNDEuMzJ6IiBmaWxsPSIjRkZGRkZGIiBmaWxsLW9wYWNpdHk9Ii40IiAvPjxwYXRoIGQ9Ik00MjcuMzc3IDcyNS4zMlY3NjhIMjU5LjgxNHYtNDIuNjhoMTY3LjU2M3pNNTk0Ljk0NCA2NDB2NDIuNjhoLTMzNS4xM1Y2NDBoMzM1LjEzeiBtMC04NS4zMnY0Mi42NGgtMzM1LjEzdi00Mi42NGgzMzUuMTN6IG0wLTg1LjM2VjUxMmgtMzM1LjEzdi00Mi42OGgzMzUuMTN6IiBmaWxsPSIjRkZGRkZGIiAvPjwvc3ZnPg==");
;// ./src/assets/file-icons/office-els.svg
/* harmony default export */ var office_els = ("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyBjbGFzcz0iaWNvbiIgd2lkdGg9IjIwMHB4IiBoZWlnaHQ9IjIwMC4wMHB4IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE3MS40IDc0Ni40djQyLjhjMCAzNC44IDE0IDY4LjEgMzkgOTIuNyAyNSAyNC42IDU4LjggMzguNCA5NC4xIDM4LjRoNDE1YzM1LjMgMCA2OS4yLTEzLjggOTQuMS0zOC40IDI1LTI0LjYgMzktNTcuOSAzOS05Mi43di00Mi4zbC02ODEuMi0wLjV6IiBmaWxsPSIjNkZBRDQ5IiAvPjxwYXRoIGQ9Ik04NTIuOCA3NjBWMzc3Yy0wLjEtMTMuNC01LjUtMjYuMi0xNC45LTM1LjdMNjE0LjQgMTE3LjhjLTkuNS05LjUtMjIuMy0xNC43LTM1LjctMTQuN0gzMDQuNGMtNzMuNSAwLTEzMy4yIDU5LjYtMTMzLjIgMTMzLjJWNzYwIiBmaWxsPSIjNUZBNDM0IiAvPjxwYXRoIGQ9Ik02NTIuNiA2NDguNGgtNzcuNWwtNTUtODcuNWMtMy4zLTUtNy4xLTExLjMtMTEuMy0xOC44LTIuNSA1LjgtNS44IDEyLjEtMTAgMTguOGwtNTUgODcuNWgtNzIuNWw5Ny41LTEzNy41LTkyLjUtMTM3LjVoNzVsNDYuMyA4Mi41YzIuNSAzLjMgNS44IDguOCAxMCAxNi4zIDEuNyAzLjMgMi45IDUuOCAzLjggNy41IDcuNS0xNSAxMS43LTIyLjkgMTIuNS0yMy44bDQ1LTgyLjVoNzMuOGwtOTEuMyAxMzguOCAxMDEuMiAxMzYuMnoiIGZpbGw9IiNGRkZGRkYiIC8+PHBhdGggZD0iTTQ4Ny44IDg3Mi44aC04LjFMNDY0IDg1MC4zYy0wLjMtMC40LTEtMS41LTItMy4zLTAuMSAwLjItMC40IDAuNy0wLjcgMS4zLTAuNiAxLTEgMS43LTEuMyAybC0xNi40IDIyLjRINDM2bDIyLjItMjkuMi0xOS41LTI3LjVoNy40bDEzLjYgMTkuOWMwLjQgMC43IDEuMSAxLjggMiAzLjQgMC4zIDAuNSAwLjUgMC45IDAuNiAxLjEgMC41LTAuOCAxLjMtMi4zIDIuNi00LjNsMTMuNy0yMGg3LjVsLTIwIDI3LjQgMjEuNyAyOS4zek01MjkuNiA4NzIuOGgtMzUuNHYtNTYuN2g2LjN2NTEuMmgyOS4xdjUuNXpNNTM1LjcgODU2LjJsNi41LTJjMS41IDkuNiA3LjIgMTQuMiAxNy4zIDEzLjkgOS4yLTAuMiAxNC4xLTMuNyAxNC41LTEwLjYgMC45LTUuMy00LjMtOS4xLTE1LjctMTEuMy0xNC4zLTIuOC0yMS04LTIwLjMtMTUuOCAwLjctOS43IDcuNC0xNC43IDE5LjgtMTUuMiAxMi4yIDAgMTkuMyA1LjEgMjEuNCAxNS4zbC02LjggMmMtMS45LTcuOC02LjctMTEuNy0xNC4zLTExLjctOC43IDAuMi0xMy4zIDMuNC0xMy42IDkuNi0wLjEgNC42IDQuNyA3LjkgMTQuNCA5LjggMTUuMiAyLjkgMjIuNSA4LjggMjEuOCAxNy42LTAuOSAxMC4yLTcuOSAxNS41LTIwLjkgMTYtMTMuNSAwLjEtMjEuNi01LjctMjQuMS0xNy42eiIgZmlsbD0iI0ZGRkZGRiIgLz48cGF0aCBkPSJNODM2LjEgMzQwLjNMNjEyLjcgMTE2LjhjLTcuMS03LTE2LjEtMTEuNy0yNS45LTEzLjUtMS40LTAuMi0yLjkgMC4yLTQgMS4xLTEuMSAxLTEuNyAyLjMtMS43IDMuOHYxMDhjMCA0MS4zIDE2LjUgODEgNDUuNyAxMTAuMiAyOS4zIDI5LjIgNjkgNDUuNSAxMTAuMyA0NS40aDEwOGMxLjUgMCAyLjktMC42IDMuOC0xLjcgMS0xLjEgMS40LTIuNiAxLjMtNC0yLTkuOC02LjktMTguOC0xNC4xLTI1Ljh6IiBmaWxsPSIjNDU3RjIwIiAvPjxwYXRoIGQ9Ik03NDIuMiAzNDdoOTkuNWMtMS42LTIuNC0zLjUtNC43LTUuNS02LjdMNjEyLjcgMTE2LjhjLTIuMS0yLjEtNC4zLTMuOS02LjctNS41djk5LjVDNjA2IDI4NiA2NjcgMzQ3IDc0Mi4yIDM0N3oiIGZpbGw9IiM5OEQwNzQiIC8+PC9zdmc+");
;// ./src/assets/file-icons/office-pdf.svg
/* harmony default export */ var office_pdf = ("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyBjbGFzcz0iaWNvbiIgd2lkdGg9IjIwMHB4IiBoZWlnaHQ9IjIwMC4wMHB4IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE3MS40IDc0NC40djQ0LjhjMCAzNC44IDE0IDY4LjEgMzkgOTIuNyAyNSAyNC42IDU4LjggMzguNCA5NC4xIDM4LjRoNDE1YzM1LjMgMCA2OS4yLTEzLjggOTQuMS0zOC40IDI1LTI0LjYgMzktNTcuOSAzOS05Mi43di00NC4zbC02ODEuMi0wLjV6IiBmaWxsPSIjRTk2NjZCIiAvPjxwYXRoIGQ9Ik04NTIuOCA3NjBWMzc3Yy0wLjEtMTMuNC01LjUtMjYuMi0xNC45LTM1LjdMNjE0LjQgMTE3LjhjLTkuNS05LjUtMjIuMy0xNC43LTM1LjctMTQuN0gzMDQuNGMtNzMuNSAwLTEzMy4yIDU5LjYtMTMzLjIgMTMzLjJWNzYwIiBmaWxsPSIjRTY1NTVBIiAvPjxwYXRoIGQ9Ik00NjUuNSA4NDkuNWgtMTcuNHYyMy4zaC02LjN2LTU2LjdINDY2YzExLjUgMC42IDE3LjggNi4xIDE4LjkgMTYuNS0wLjQgMTEtNi45IDE2LjctMTkuNCAxNi45eiBtLTEuMS0yNy44SDQ0OHYyMi4yaDE2LjRjOS0wLjEgMTMuNi00IDEzLjctMTEuNi0wLjMtNi44LTQuOS0xMC40LTEzLjctMTAuNnpNNTEzLjQgODcyLjhINDk0di01Ni42aDIwYzE3LjQgMC42IDI2LjMgOS45IDI2LjkgMjguMSAwLjIgMTkuMy04LjkgMjguOC0yNy41IDI4LjV6IG0wLjMtNTEuMmgtMTMuNHY0NS44aDEzLjFjMTQuMSAwIDIxLjEtNy43IDIxLTIzLTAuNS0xNC43LTcuNC0yMi4yLTIwLjctMjIuOHpNNTg5IDgyMS43aC0zMS45djE4LjhoMjcuN2wwLjEgNS41aC0yNy44djI2LjhoLTYuM3YtNTYuN0g1ODl2NS42eiIgZmlsbD0iI0ZGRkZGRiIgLz48cGF0aCBkPSJNODM2LjEgMzQwLjNMNjEyLjcgMTE2LjhjLTcuMS03LTE2LjEtMTEuNy0yNS45LTEzLjUtMS40LTAuMi0yLjkgMC4yLTQgMS4xLTEuMSAxLTEuNyAyLjMtMS43IDMuOHYxMDhjMCA0MS4zIDE2LjUgODEgNDUuNyAxMTAuMiAyOS4zIDI5LjIgNjkgNDUuNSAxMTAuMyA0NS40aDEwOGMxLjUgMCAyLjktMC42IDMuOC0xLjcgMS0xLjEgMS40LTIuNiAxLjMtNC0yLTkuOC02LjktMTguOC0xNC4xLTI1Ljh6IiBmaWxsPSIjRDEzQjQ2IiAvPjxwYXRoIGQ9Ik03NDIuMiAzNDdoOTkuNWMtMS42LTIuNC0zLjUtNC43LTUuNS02LjdMNjEyLjcgMTE2LjhjLTIuMS0yLjEtNC4zLTMuOS02LjctNS41djk5LjVDNjA2IDI4NiA2NjcgMzQ3IDc0Mi4yIDM0N3oiIGZpbGw9IiNGRkE4QTgiIC8+PHBhdGggZD0iTTYzOC42IDUyNS43Yy0yMC43IDAtNDEuNyAyLjktNjIuNCA2LjktMjQuNy0yMi43LTQ1LjQtNDkuNS02MS4zLTc5LjEgMTYuNy01NS41IDE3LjgtOTMuMSA0LjktMTEwLjktNi04LTE2LTEyLjktMjUuOC0xMi45LTEyLjktMS4xLTI0LjcgNS0zMC44IDE1LjktMTcuOSAyOS42IDcuOSA4OCAxOS44IDExMS44LTEzLjkgNDIuNi0zMC42IDgzLjEtNTIuNCAxMjIuOC05NCA0MC41LTk2IDY1LjMtOTYgNzQuMiAwIDEwLjkgNiAyMS45IDE2LjkgMjYuOCA0IDMuMiAxMCA0IDE0LjkgNCAyNC43IDAgNTMuNC0yNy44IDg0LjItODIuMiAzOC43LTE1LjggNzcuMy0yOC44IDExNy44LTM3LjYgMjAuOSAxNy44IDQ2LjUgMjcuNiA3My4zIDI5LjYgMTYuNyAwIDQ5LjUgMCA0OS41LTMzLjYgMS0xMi45LTYtMzQuOC01Mi42LTM1Ljd6TTM2Ny4zIDY1NS40bC0yLjkgMC45YzguOS0xMi45IDIwLjktMjIuNyAzNS42LTI4LjUtNy45IDEyLjctMTguOCAyMi43LTMyLjcgMjcuNnogbTEyMi0yOTUuMWMwLjgtMiAxLjUtMy44IDQuMS0zLjUgMCAwIDEuNS0wLjEgMy4yIDMuMiA0IDcuMyA0LjQgMzMuOC0xLjMgNTAuOC02LjktMTUuNy0xMC0zMy42LTYtNTAuNXogbTU1LjkgMTg3LjNsLTEuNyAwLjhjLTIxLjggNC45LTQ1LjUgMTEuOC02Ny4zIDE5LjhsLTMuMiAxLjIgMS4yLTIuNGMxMC45LTIxLjggMjAuNy00NC41IDI5LjYtNjcuM2wwLjktMi40IDEgMS4zYzEwLjkgMTcgMjQuNyAzMy42IDM5LjggNDguOGwtMC4zIDAuMnogbTk2LjUgMTcuOGMtOS44LTEuMS0xOS44LTMuMi0yOS42LTggOC45LTIgMTYuOS0yIDI1LjgtMiAxOS44IDAgMjMuNiA0LjkgMjMuNiA4LTYgMi0xMi45IDIuOC0xOS44IDJ6IiBmaWxsPSIjRkZGRkZGIiAvPjwvc3ZnPg==");
;// ./src/assets/file-icons/office-ppt.svg
/* harmony default export */ var office_ppt = ("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyBjbGFzcz0iaWNvbiIgd2lkdGg9IjIwMHB4IiBoZWlnaHQ9IjIwMC4wMHB4IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE3MS40IDc0NS40djQzLjhjMCAzNC44IDE0IDY4LjEgMzkgOTIuNyAyNSAyNC42IDU4LjggMzguNCA5NC4xIDM4LjRoNDE1YzM1LjMgMCA2OS4yLTEzLjggOTQuMS0zOC40IDI1LTI0LjYgMzktNTcuOSAzOS05Mi43di00My4zbC02ODEuMi0wLjV6IiBmaWxsPSIjRTg3MzU2IiAvPjxwYXRoIGQ9Ik04NTIuOCA3NjBWMzc3Yy0wLjEtMTMuNC01LjUtMjYuMi0xNC45LTM1LjdMNjE0LjQgMTE3LjhjLTkuNS05LjUtMjIuMy0xNC43LTM1LjctMTQuN0gzMDQuNGMtNzMuNSAwLTEzMy4yIDU5LjYtMTMzLjIgMTMzLjJWNzYwIiBmaWxsPSIjRTU2MzQzIiAvPjxwYXRoIGQ9Ik01MTEuNCA1NTIuMmgtNDYuM3Y5Ni4zaC02Mi41di0yNzVoMTE1YzY2LjcgMS43IDEwMS4zIDMwLjQgMTAzLjggODYuMyAwLjggNjIuNC0zNS45IDkzLjItMTEwIDkyLjR6IG0tNS0xMzEuM2gtNDEuM3Y4My44aDQxLjNjMzIuNS0wLjggNDkuMi0xNSA1MC00Mi41LTAuOS0yNi43LTE3LjUtNDAuNC01MC00MS4zeiIgZmlsbD0iI0ZGRkZGRiIgLz48cGF0aCBkPSJNNDY1LjUgODQ5LjVoLTE3LjR2MjMuM2gtNi4zdi01Ni43SDQ2NmMxMS41IDAuNiAxNy44IDYuMSAxOC45IDE2LjUtMC40IDExLTYuOSAxNi43LTE5LjQgMTYuOXogbS0xLjEtMjcuOEg0NDh2MjIuMmgxNi40YzktMC4xIDEzLjYtNCAxMy43LTExLjYtMC4zLTYuOC00LjktMTAuNC0xMy43LTEwLjZ6TTUxNy44IDg0OS41aC0xNy40djIzLjNINDk0di01Ni43aDI0LjJjMTEuNSAwLjYgMTcuOCA2LjEgMTguOSAxNi41LTAuMyAxMS02LjcgMTYuNy0xOS4zIDE2Ljl6IG0tMS4xLTI3LjhoLTE2LjR2MjIuMmgxNi40YzktMC4xIDEzLjYtNCAxMy43LTExLjYtMC4zLTYuOC00LjktMTAuNC0xMy43LTEwLjZ6TTU4NyA4MTYuMXY1LjVoLTE5LjN2NTEuM2gtNi4zdi01MS4zaC0xOS4ydi01LjVINTg3eiIgZmlsbD0iI0ZGRkZGRiIgLz48cGF0aCBkPSJNODM2LjEgMzQwLjNMNjEyLjcgMTE2LjhjLTcuMS03LTE2LjEtMTEuNy0yNS45LTEzLjUtMS40LTAuMi0yLjkgMC4yLTQgMS4xLTEuMSAxLTEuNyAyLjMtMS43IDMuOHYxMDhjMCA0MS4zIDE2LjUgODEgNDUuNyAxMTAuMiAyOS4zIDI5LjIgNjkgNDUuNSAxMTAuMyA0NS40aDEwOGMxLjUgMCAyLjktMC42IDMuOC0xLjcgMS0xLjEgMS40LTIuNiAxLjMtNC0yLTkuOC02LjktMTguOC0xNC4xLTI1Ljh6IiBmaWxsPSIjQ0M0MjI3IiAvPjxwYXRoIGQ9Ik03NDIuMiAzNDdoOTkuNWMtMS42LTIuNC0zLjUtNC43LTUuNS02LjdMNjEyLjcgMTE2LjhjLTIuMS0yLjEtNC4zLTMuOS02LjctNS41djk5LjVDNjA2IDI4NiA2NjcgMzQ3IDc0Mi4yIDM0N3oiIGZpbGw9IiNGQ0IzQTEiIC8+PC9zdmc+");
;// ./src/assets/file-icons/office-txt.svg
/* harmony default export */ var office_txt = ("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyBjbGFzcz0iaWNvbiIgd2lkdGg9IjIwMHB4IiBoZWlnaHQ9IjIwMC4wMHB4IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiB2ZXJzaW9uPSIxLjEiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE3MS40IDc0Mi40djQ2LjhjMCAzNC44IDE0IDY4LjEgMzkgOTIuNyAyNSAyNC42IDU4LjggMzguNCA5NC4xIDM4LjRoNDE1YzM1LjMgMCA2OS4yLTEzLjggOTQuMS0zOC40IDI1LTI0LjYgMzktNTcuOSAzOS05Mi43di00Ni4zbC02ODEuMi0wLjV6IiBmaWxsPSIjQjJCN0MxIiAvPjxwYXRoIGQ9Ik04NTIuOCA3NjBWMzc3Yy0wLjEtMTMuNC01LjUtMjYuMi0xNC45LTM1LjdMNjE0LjQgMTE3LjhjLTkuNS05LjUtMjIuMy0xNC43LTM1LjctMTQuN0gzMDQuNGMtNzMuNSAwLTEzMy4yIDU5LjYtMTMzLjIgMTMzLjJWNzYwIiBmaWxsPSIjOUVBNUIyIiAvPjxwYXRoIGQ9Ik02MzMuMyA0MjQuN2gtODguOHYyMjMuOGgtNjMuOFY0MjQuN2gtOTB2LTUxLjNoMjQyLjVsMC4xIDUxLjN6IiBmaWxsPSIjRkZGRkZGIiAvPjxwYXRoIGQ9Ik00ODIuNCA4MTYuMXY1LjVINDYzdjUxLjNoLTYuM3YtNTEuM2gtMTkuMnYtNS41aDQ0Ljl6TTUzNiA4NzIuOGgtOC4xbC0xNS43LTIyLjVjLTAuMy0wLjQtMS0xLjUtMi0zLjMtMC4xIDAuMi0wLjQgMC43LTAuNyAxLjMtMC42IDEtMSAxLjctMS4zIDJsLTE2LjQgMjIuNEg0ODRsMjIuMi0yOS4yLTE5LjUtMjcuNWg3LjRsMTMuNiAxOS45YzAuNCAwLjcgMS4xIDEuOCAyIDMuNCAwLjMgMC41IDAuNSAwLjkgMC42IDEuMSAwLjUtMC44IDEuMy0yLjMgMi42LTQuM2wxMy43LTIwaDcuNWwtMjAgMjcuNCAyMS45IDI5LjN6TTU4My40IDgxNi4xdjUuNWgtMTkuM3Y1MS4zaC02LjN2LTUxLjNoLTE5LjJ2LTUuNWg0NC44eiIgZmlsbD0iI0ZGRkZGRiIgLz48cGF0aCBkPSJNODM2LjEgMzQwLjNMNjEyLjcgMTE2LjhjLTcuMS03LTE2LjEtMTEuNy0yNS45LTEzLjUtMS40LTAuMi0yLjkgMC4yLTQgMS4xLTEuMSAxLTEuNyAyLjMtMS43IDMuOHYxMDhjMCA0MS4zIDE2LjUgODEgNDUuNyAxMTAuMiAyOS4zIDI5LjIgNjkgNDUuNSAxMTAuMyA0NS40aDEwOGMxLjUgMCAyLjktMC42IDMuOC0xLjcgMS0xLjEgMS40LTIuNiAxLjMtNC0yLTkuOC02LjktMTguOC0xNC4xLTI1Ljh6IiBmaWxsPSIjN0U4NDhDIiAvPjxwYXRoIGQ9Ik03NDIuMiAzNDdoOTkuNWMtMS42LTIuNC0zLjUtNC43LTUuNS02LjdMNjEyLjcgMTE2LjhjLTIuMS0yLjEtNC4zLTMuOS02LjctNS41djk5LjVDNjA2IDI4NiA2NjcgMzQ3IDc0Mi4yIDM0N3oiIGZpbGw9IiNDNkNCREUiIC8+PC9zdmc+");
// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/antd/es/modal/index.js + 27 modules
var modal = __webpack_require__(48458);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/createLucideIcon.js + 3 modules
var createLucideIcon = __webpack_require__(9407);
;// ./node_modules/lucide-react/dist/esm/icons/file-image.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const FileImage = (0,createLucideIcon/* default */.A)("FileImage", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["circle", { cx: "10", cy: "12", r: "2", key: "737tya" }],
  ["path", { d: "m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22", key: "wt3hpn" }]
]);


//# sourceMappingURL=file-image.js.map

;// ./node_modules/lucide-react/dist/esm/icons/file-spreadsheet.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const FileSpreadsheet = (0,createLucideIcon/* default */.A)("FileSpreadsheet", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "M8 13h2", key: "yr2amv" }],
  ["path", { d: "M14 13h2", key: "un5t4a" }],
  ["path", { d: "M8 17h2", key: "2yhykz" }],
  ["path", { d: "M14 17h2", key: "10kma7" }]
]);


//# sourceMappingURL=file-spreadsheet.js.map

;// ./node_modules/lucide-react/dist/esm/icons/file-code-2.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const FileCode2 = (0,createLucideIcon/* default */.A)("FileCode2", [
  ["path", { d: "M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4", key: "1pf5j1" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "m5 12-3 3 3 3", key: "oke12k" }],
  ["path", { d: "m9 18 3-3-3-3", key: "112psh" }]
]);


//# sourceMappingURL=file-code-2.js.map

;// ./node_modules/lucide-react/dist/esm/icons/file-archive.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const FileArchive = (0,createLucideIcon/* default */.A)("FileArchive", [
  ["path", { d: "M10 12v-1", key: "v7bkov" }],
  ["path", { d: "M10 18v-2", key: "1cjy8d" }],
  ["path", { d: "M10 7V6", key: "dljcrl" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  [
    "path",
    { d: "M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01", key: "gkbcor" }
  ],
  ["circle", { cx: "10", cy: "20", r: "2", key: "1xzdoj" }]
]);


//# sourceMappingURL=file-archive.js.map

;// ./node_modules/lucide-react/dist/esm/icons/file-audio-2.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const FileAudio2 = (0,createLucideIcon/* default */.A)("FileAudio2", [
  ["path", { d: "M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v2", key: "17k7jt" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["circle", { cx: "3", cy: "17", r: "1", key: "vo6nti" }],
  ["path", { d: "M2 17v-3a4 4 0 0 1 8 0v3", key: "1ggdre" }],
  ["circle", { cx: "9", cy: "17", r: "1", key: "bc1fq4" }]
]);


//# sourceMappingURL=file-audio-2.js.map

;// ./node_modules/lucide-react/dist/esm/icons/file-video-2.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const FileVideo2 = (0,createLucideIcon/* default */.A)("FileVideo2", [
  ["path", { d: "M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4", key: "1pf5j1" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["rect", { width: "8", height: "6", x: "2", y: "12", rx: "1", key: "1a6c1e" }],
  ["path", { d: "m10 15.5 4 2.5v-6l-4 2.5", key: "t7cp39" }]
]);


//# sourceMappingURL=file-video-2.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/message-square.js
var message_square = __webpack_require__(47504);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/x.js
var x = __webpack_require__(48697);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/loader-circle.js
var loader_circle = __webpack_require__(8723);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/send.js
var send = __webpack_require__(27775);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/search.js
var search = __webpack_require__(98445);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/upload.js
var upload = __webpack_require__(94796);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/download.js
var download = __webpack_require__(48309);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/trash-2.js
var trash_2 = __webpack_require__(32708);
;// ./node_modules/lucide-react/dist/esm/icons/sliders-horizontal.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const SlidersHorizontal = (0,createLucideIcon/* default */.A)("SlidersHorizontal", [
  ["line", { x1: "21", x2: "14", y1: "4", y2: "4", key: "obuewd" }],
  ["line", { x1: "10", x2: "3", y1: "4", y2: "4", key: "1q6298" }],
  ["line", { x1: "21", x2: "12", y1: "12", y2: "12", key: "1iu8h1" }],
  ["line", { x1: "8", x2: "3", y1: "12", y2: "12", key: "ntss68" }],
  ["line", { x1: "21", x2: "16", y1: "20", y2: "20", key: "14d8ph" }],
  ["line", { x1: "12", x2: "3", y1: "20", y2: "20", key: "m0wm8r" }],
  ["line", { x1: "14", x2: "14", y1: "2", y2: "6", key: "14e1ph" }],
  ["line", { x1: "8", x2: "8", y1: "10", y2: "14", key: "1i6ji0" }],
  ["line", { x1: "16", x2: "16", y1: "18", y2: "22", key: "1lctlv" }]
]);


//# sourceMappingURL=sliders-horizontal.js.map

;// ./node_modules/lucide-react/dist/esm/icons/layout-grid.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const LayoutGrid = (0,createLucideIcon/* default */.A)("LayoutGrid", [
  ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1", key: "1g98yp" }],
  ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1", key: "6d4xhi" }],
  ["rect", { width: "7", height: "7", x: "14", y: "14", rx: "1", key: "nxv5o0" }],
  ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1", key: "1bb6yr" }]
]);


//# sourceMappingURL=layout-grid.js.map

;// ./node_modules/lucide-react/dist/esm/icons/list.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const List = (0,createLucideIcon/* default */.A)("List", [
  ["path", { d: "M3 12h.01", key: "nlz23k" }],
  ["path", { d: "M3 18h.01", key: "1tta3j" }],
  ["path", { d: "M3 6h.01", key: "1rqtza" }],
  ["path", { d: "M8 12h13", key: "1za7za" }],
  ["path", { d: "M8 18h13", key: "1lx6n3" }],
  ["path", { d: "M8 6h13", key: "ik3vkj" }]
]);


//# sourceMappingURL=list.js.map

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/check.js
var check = __webpack_require__(45773);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./src/pages/library/LibraryPage.tsx













function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function extLabel(suffix, name) {
  if (suffix && suffix.length > 0) {
    return suffix.replace(/^\./, "").toUpperCase() || "FILE";
  }
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toUpperCase() : "FILE";
}
function normalizeExt(suffix, name) {
  if (suffix && suffix.length > 0) return suffix.replace(/^\./, "").toLowerCase();
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}
function getFileVisual(suffix, name) {
  const ext = normalizeExt(suffix, name);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) {
    return {
      Icon: FileImage,
      tone: "image"
    };
  }
  if (["doc", "docx"].includes(ext)) {
    return {
      iconSrc: office_docx,
      tone: "word"
    };
  }
  if (["pdf"].includes(ext)) {
    return {
      iconSrc: office_pdf,
      tone: "pdf"
    };
  }
  if (["ppt", "pptx"].includes(ext)) {
    return {
      iconSrc: office_ppt,
      tone: "ppt"
    };
  }
  if (["xls", "xlsx"].includes(ext)) {
    return {
      iconSrc: office_els,
      tone: "sheet"
    };
  }
  if (["csv"].includes(ext)) {
    return {
      Icon: FileSpreadsheet,
      tone: "sheet"
    };
  }
  if (["txt"].includes(ext)) {
    return {
      iconSrc: office_txt,
      tone: "txt"
    };
  }
  if (["ts", "tsx", "js", "jsx", "py", "java", "go", "cpp", "c", "h", "css", "json", "yaml", "yml", "md"].includes(ext)) {
    return {
      Icon: FileCode2,
      tone: "code"
    };
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return {
      Icon: FileArchive,
      tone: "archive"
    };
  }
  if (["mp3", "wav", "flac", "aac", "ogg", "mp4", "mov", "mkv", "webm", "avi"].includes(ext)) {
    return {
      Icon: ["mp3", "wav", "flac", "aac", "ogg"].includes(ext) ? FileAudio2 : FileVideo2,
      tone: "media"
    };
  }
  return {
    Icon: file_text/* default */.A,
    tone: "doc"
  };
}
function getFileToneClasses(tone, isDark) {
  const toneMap = {
    image: isDark ? {
      wrap: "bg-cyan-500/15 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-cyan-200"
    } : {
      wrap: "bg-cyan-50 border-cyan-200",
      icon: "text-cyan-700"
    },
    sheet: isDark ? {
      wrap: "bg-emerald-500/15 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-emerald-200"
    } : {
      wrap: "bg-emerald-50 border-emerald-200",
      icon: "text-emerald-700"
    },
    code: isDark ? {
      wrap: "bg-violet-500/15 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-violet-200"
    } : {
      wrap: "bg-violet-50 border-violet-200",
      icon: "text-violet-700"
    },
    archive: isDark ? {
      wrap: "bg-amber-500/15 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-amber-200"
    } : {
      wrap: "bg-amber-50 border-amber-200",
      icon: "text-amber-700"
    },
    media: isDark ? {
      wrap: "bg-pink-500/15 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-pink-200"
    } : {
      wrap: "bg-pink-50 border-pink-200",
      icon: "text-pink-700"
    },
    word: isDark ? {
      wrap: "bg-blue-500/20 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-blue-200"
    } : {
      wrap: "bg-blue-50 border-blue-200",
      icon: "text-blue-700"
    },
    pdf: isDark ? {
      wrap: "bg-red-500/20 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-red-200"
    } : {
      wrap: "bg-red-50 border-red-200",
      icon: "text-red-700"
    },
    ppt: isDark ? {
      wrap: "bg-orange-500/20 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-orange-200"
    } : {
      wrap: "bg-orange-50 border-orange-200",
      icon: "text-orange-700"
    },
    txt: isDark ? {
      wrap: "bg-slate-500/20 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-slate-200"
    } : {
      wrap: "bg-slate-50 border-slate-200",
      icon: "text-slate-700"
    },
    doc: isDark ? {
      wrap: "bg-white/10 border-transparent ring-1 ring-inset ring-white/10",
      icon: "text-secondary"
    } : {
      wrap: "bg-gray-50 border-gray-200",
      icon: "text-gray-600"
    }
  };
  return toneMap[tone];
}

/* ------------------------------------------------------------------ */
/* ChatModal：展示选中文件列表 + 底部聊天输入                           */
/* ------------------------------------------------------------------ */

const ChatModal = _ref => {
  let {
    open,
    files,
    isDark,
    onClose,
    onSubmit
  } = _ref;
  const {
    0: text,
    1: setText
  } = (0,react.useState)("");
  const {
    0: submitting,
    1: setSubmitting
  } = (0,react.useState)(false);
  const textareaRef = (0,react.useRef)(null);
  (0,react.useEffect)(() => {
    if (open) {
      setText("");
      setSubmitting(false);
      setTimeout(() => {
        var _textareaRef$current;
        return (_textareaRef$current = textareaRef.current) === null || _textareaRef$current === void 0 ? void 0 : _textareaRef$current.focus();
      }, 80);
    }
  }, [open]);
  const handleSubmit = async () => {
    const q = text.trim();
    if (!q || submitting) return;
    setSubmitting(true);
    try {
      onSubmit(q);
    } finally {
      setSubmitting(false);
    }
  };
  const handleKeyDown = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };
  if (!open) return null;
  const bg = isDark ? "bg-[#11151c] border-transparent text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_26px_70px_rgba(0,0,0,0.75)] ring-1 ring-white/10" : "bg-white border-gray-200 text-gray-900";
  const overlay = isDark ? "bg-black/60" : "bg-black/40";
  const fileBg = isDark ? "bg-white/[0.035] border-transparent ring-1 ring-inset ring-white/10 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]" : "bg-gray-50 border-gray-200";
  const inputBg = isDark ? "bg-white/[0.04] border-transparent ring-1 ring-inset ring-white/10 focus-within:ring-white/20 placeholder:text-secondary/60 text-white" : "bg-white border-gray-200 placeholder:text-gray-400 text-gray-900";
  const sendBtn = text.trim() ? isDark ? "bg-white text-gray-900 hover:bg-gray-100" : "bg-gray-900 text-white hover:bg-gray-800" : isDark ? "bg-white/10 text-secondary cursor-not-allowed" : "bg-gray-100 text-gray-400 cursor-not-allowed";
  return /*#__PURE__*/react.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center px-4 " + overlay,
    onClick: e => e.target === e.currentTarget && onClose()
  }, /*#__PURE__*/react.createElement("div", {
    className: "relative w-full max-w-2xl rounded-2xl border shadow-2xl flex flex-col max-h-[85vh] " + bg,
    role: "dialog",
    "aria-modal": "true"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/react.createElement(message_square/* default */.A, {
    className: "w-5 h-5 opacity-70",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("span", {
    className: "font-semibold text-base"
  }, "\u5F00\u59CB\u804A\u5929 \xB7 ", files.length, " \u4E2A\u6587\u4EF6")), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onClose,
    className: "p-1.5 rounded-lg transition-colors " + (isDark ? "hover:bg-white/10 text-secondary" : "hover:bg-gray-100 text-gray-500"),
    "aria-label": "\u5173\u95ED"
  }, /*#__PURE__*/react.createElement(x/* default */.A, {
    className: "w-4 h-4"
  }))), /*#__PURE__*/react.createElement("div", {
    className: "mx-6 mb-4 rounded-xl border overflow-hidden flex-shrink-0 " + fileBg
  }, /*#__PURE__*/react.createElement("div", {
    className: "max-h-[240px] overflow-y-auto divide-y divide-inherit"
  }, files.map(f => /*#__PURE__*/react.createElement("div", {
    key: f.uuid,
    className: "flex items-center gap-3 px-4 py-3"
  }, /*#__PURE__*/react.createElement(file_text/* default */.A, {
    className: "w-5 h-5 flex-shrink-0 " + (isDark ? "text-secondary/70" : "text-gray-400"),
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/react.createElement("div", {
    className: "text-sm font-medium truncate"
  }, f.name), /*#__PURE__*/react.createElement("div", {
    className: "text-xs mt-0.5 " + (isDark ? "text-secondary/60" : "text-gray-400")
  }, extLabel(f.suffix, f.name), " \xB7 ", formatSize(f.size))))))), /*#__PURE__*/react.createElement("p", {
    className: "px-6 mb-3 text-xs flex-shrink-0 " + (isDark ? "text-secondary/60" : "text-gray-400")
  }, "\u6587\u4EF6\u5DF2\u5C31\u7EEA\uFF0C\u65E0\u9700\u91CD\u65B0\u4E0A\u4F20\u3002\u8F93\u5165\u4F60\u7684\u95EE\u9898\uFF0C\u6309 Enter \u53D1\u9001\uFF08Shift+Enter \u6362\u884C\uFF09\u3002"), /*#__PURE__*/react.createElement("div", {
    className: "px-6 pb-6 flex gap-3 items-end flex-shrink-0"
  }, /*#__PURE__*/react.createElement("textarea", {
    ref: textareaRef,
    rows: 3,
    value: text,
    onChange: e => setText(e.target.value),
    onKeyDown: handleKeyDown,
    placeholder: "\u8BF7\u8F93\u5165\u4F60\u60F3\u4E86\u89E3\u7684\u95EE\u9898\u2026",
    className: "flex-1 resize-none rounded-xl border px-4 py-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-offset-0 " + (isDark ? "focus:ring-white/20" : "focus:ring-gray-900/10") + " " + inputBg
  }), /*#__PURE__*/react.createElement("button", {
    type: "button",
    disabled: !text.trim() || submitting,
    onClick: () => void handleSubmit(),
    className: "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors " + sendBtn,
    "aria-label": "\u53D1\u9001"
  }, submitting ? /*#__PURE__*/react.createElement(loader_circle/* default */.A, {
    className: "w-4 h-4 animate-spin"
  }) : /*#__PURE__*/react.createElement(send/* default */.A, {
    className: "w-4 h-4"
  })))));
};

/* ------------------------------------------------------------------ */
/* LibraryPage                                                          */
/* ------------------------------------------------------------------ */
const LibraryPage = _ref2 => {
  let {
    onStartChat
  } = _ref2;
  const {
    user,
    darkMode
  } = (0,react.useContext)(provider/* appContext */.v);
  const userId = (user === null || user === void 0 ? void 0 : user.email) || "";
  const isDark = darkMode === "dark";
  const {
    0: items,
    1: setItems
  } = (0,react.useState)([]);
  const {
    0: loading,
    1: setLoading
  } = (0,react.useState)(true);
  const {
    0: query,
    1: setQuery
  } = (0,react.useState)("");
  const {
    0: selected,
    1: setSelected
  } = (0,react.useState)(new Set());
  const {
    0: viewMode,
    1: setViewMode
  } = (0,react.useState)("grid");
  const {
    0: chatModalOpen,
    1: setChatModalOpen
  } = (0,react.useState)(false);
  const uploadRef = (0,react.useRef)(null);
  const load = (0,react.useCallback)(async () => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api/* fileAPI */.jp.listUserFiles(userId, 0);
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error(e);
      message/* default */.Ay.error("加载库文件失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);
  (0,react.useEffect)(() => {
    void load();
  }, [load]);
  const filtered = (0,react.useMemo)(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(f => (f.name || "").toLowerCase().includes(q));
  }, [items, query]);
  const sorted = (0,react.useMemo)(() => {
    return (0,toConsumableArray/* default */.A)(filtered).sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-CN"));
  }, [filtered]);
  const toggleSelect = uuid => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);else next.add(uuid);
      return next;
    });
  };
  const selectedFiles = (0,react.useMemo)(() => items.filter(f => selected.has(f.uuid)), [items, selected]);
  const handleUploadPick = () => {
    var _uploadRef$current;
    return (_uploadRef$current = uploadRef.current) === null || _uploadRef$current === void 0 ? void 0 : _uploadRef$current.click();
  };
  const handleUploadChange = async e => {
    const files = e.target.files;
    if (!(files !== null && files !== void 0 && files.length) || !userId) return;
    try {
      await api/* fileAPI */.jp.saveFilesToServer(userId, Array.from(files), 0);
      message/* default */.Ay.success("上传成功");
      await load();
    } catch (err) {
      console.error(err);
      message/* default */.Ay.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      e.target.value = "";
    }
  };
  const handleDownload = async () => {
    if (!userId || selectedFiles.length === 0) return;
    for (const f of selectedFiles) {
      if (f.url) {
        window.open(f.url, "_blank", "noopener,noreferrer");
      } else {
        const url = api/* fileAPI */.jp.getDownloadUrl(userId, f.uuid);
        window.open(url, "_blank", "noopener,noreferrer");
      }
      await new Promise(r => setTimeout(r, 200));
    }
  };
  const handleRemove = () => {
    if (!userId || selectedFiles.length === 0) return;
    modal/* default */.A.confirm({
      title: "移除所选文件？",
      content: "将从库中删除，且无法恢复。",
      okText: "移除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          for (const f of selectedFiles) {
            await api/* fileAPI */.jp.deleteUserFile(userId, f.uuid);
          }
          message/* default */.Ay.success("已移除");
          setSelected(new Set());
          await load();
        } catch (err) {
          console.error(err);
          message/* default */.Ay.error(err instanceof Error ? err.message : "删除失败");
        }
      }
    });
  };
  const handleChatSubmit = chatQuery => {
    setChatModalOpen(false);
    onStartChat(selectedFiles, chatQuery);
  };
  const cardBase = isDark ? "border border-transparent bg-white/[0.03] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_14px_34px_rgba(0,0,0,0.55)] ring-1 ring-white/10" : "border border-gray-200 bg-white";
  const cardHover = isDark ? "hover:bg-white/[0.05] hover:shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_22px_52px_rgba(0,0,0,0.65)] hover:ring-white/15" : "hover:bg-gray-50 hover:shadow-sm";
  const toolbarBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors";
  return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("div", {
    className: "h-full min-h-0 flex flex-col " + (isDark ? "bg-primary text-primary" : "bg-white text-gray-900")
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex-shrink-0 px-6 pt-6 pb-4 flex flex-wrap items-center gap-4"
  }, /*#__PURE__*/react.createElement("h1", {
    className: "text-2xl font-bold tracking-tight mr-auto"
  }, "\u5E93"), /*#__PURE__*/react.createElement("div", {
    className: "flex flex-1 min-w-[200px] max-w-md items-center gap-2"
  }, /*#__PURE__*/react.createElement("div", {
    className: "relative flex-1"
  }, /*#__PURE__*/react.createElement(search/* default */.A, {
    className: "absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("input", {
    type: "search",
    value: query,
    onChange: e => setQuery(e.target.value),
    placeholder: "\u641C\u7D22",
    className: "w-full rounded-full pl-9 pr-3 py-2 text-sm border outline-none transition-shadow " + (isDark ? "border-transparent bg-white/[0.04] ring-1 ring-inset ring-white/10 focus:ring-white/20 placeholder:text-secondary/60" : "border-gray-200 bg-gray-50/80 placeholder:text-gray-400")
  }))), /*#__PURE__*/react.createElement("div", {
    className: "flex flex-shrink-0 items-center gap-2"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: handleUploadPick,
    className: "rounded-full px-5 py-2 text-sm font-semibold text-white " + (isDark ? "bg-white text-gray-900 hover:bg-gray-100" : "bg-gray-900 hover:bg-gray-800")
  }, /*#__PURE__*/react.createElement("span", {
    className: "inline-flex items-center gap-2"
  }, /*#__PURE__*/react.createElement(upload/* default */.A, {
    className: "w-4 h-4"
  }), "\u4E0A\u4F20"))), /*#__PURE__*/react.createElement("input", {
    ref: uploadRef,
    type: "file",
    multiple: true,
    className: "hidden",
    onChange: handleUploadChange
  })), /*#__PURE__*/react.createElement("div", {
    className: "flex-shrink-0 px-6 pb-4 flex flex-wrap items-center gap-3 border-b " + (isDark ? "border-transparent shadow-[0_-1px_0_rgba(255,255,255,0.06)_inset,0_10px_34px_rgba(0,0,0,0.35)]" : "border-gray-100")
  }, selected.size > 0 ? /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: () => setChatModalOpen(true),
    className: toolbarBtn + " " + (isDark ? "bg-white text-gray-900 hover:bg-gray-100" : "bg-gray-900 text-white hover:bg-gray-800")
  }, /*#__PURE__*/react.createElement(message_square/* default */.A, {
    className: "w-4 h-4"
  }), "\u5F00\u59CB\u804A\u5929"), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: () => void handleDownload(),
    className: toolbarBtn + " " + (isDark ? "text-primary hover:bg-white/5" : "text-gray-700 hover:bg-gray-100")
  }, /*#__PURE__*/react.createElement(download/* default */.A, {
    className: "w-4 h-4"
  }), "\u4E0B\u8F7D"), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: handleRemove,
    className: toolbarBtn + " text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
  }, /*#__PURE__*/react.createElement(trash_2/* default */.A, {
    className: "w-4 h-4"
  }), "\u79FB\u9664"), /*#__PURE__*/react.createElement("span", {
    className: "ml-auto text-sm " + (isDark ? "text-secondary" : "text-gray-500")
  }, "\u5DF2\u9009 ", selected.size, " \u4E2A")) : /*#__PURE__*/react.createElement("div", {
    className: "flex-1 min-w-[1px]",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("button", {
    type: "button",
    title: "\u6392\u5E8F\uFF08\u6309\u540D\u79F0\uFF09",
    className: "p-2 rounded-lg " + (isDark ? "hover:bg-white/5 text-secondary" : "hover:bg-gray-100 text-gray-500"),
    onClick: () => message/* default */.Ay.info("当前按名称排序")
  }, /*#__PURE__*/react.createElement(SlidersHorizontal, {
    className: "w-4 h-4"
  })), /*#__PURE__*/react.createElement("div", {
    className: "flex rounded-lg border overflow-hidden " + (isDark ? "border-transparent ring-1 ring-inset ring-white/10 bg-white/[0.02]" : "border-gray-200")
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    title: "\u7F51\u683C",
    onClick: () => setViewMode("grid"),
    className: "p-2 " + (viewMode === "grid" ? isDark ? "bg-white/10" : "bg-gray-100" : "")
  }, /*#__PURE__*/react.createElement(LayoutGrid, {
    className: "w-4 h-4"
  })), /*#__PURE__*/react.createElement("button", {
    type: "button",
    title: "\u5217\u8868",
    onClick: () => setViewMode("list"),
    className: "p-2 " + (viewMode === "list" ? isDark ? "bg-white/10" : "bg-gray-100" : "")
  }, /*#__PURE__*/react.createElement(List, {
    className: "w-4 h-4"
  })))), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 min-h-0 overflow-auto px-6 py-6"
  }, loading ? /*#__PURE__*/react.createElement("div", {
    className: "flex items-center justify-center py-24 text-secondary gap-2"
  }, /*#__PURE__*/react.createElement(loader_circle/* default */.A, {
    className: "w-6 h-6 animate-spin"
  }), /*#__PURE__*/react.createElement("span", null, "\u52A0\u8F7D\u4E2D\u2026")) : sorted.length === 0 ? /*#__PURE__*/react.createElement("div", {
    className: "text-center py-24 text-secondary text-sm"
  }, items.length === 0 ? "对话中上传的文件会出现在这里" : "没有匹配的文件") : viewMode === "grid" ? /*#__PURE__*/react.createElement("div", {
    className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
  }, sorted.map(f => {
    const isSel = selected.has(f.uuid);
    const {
      Icon,
      iconSrc,
      tone
    } = getFileVisual(f.suffix, f.name);
    const IconComponent = Icon !== null && Icon !== void 0 ? Icon : file_text/* default */.A;
    const toneCls = getFileToneClasses(tone, isDark);
    return /*#__PURE__*/react.createElement("button", {
      key: f.uuid,
      type: "button",
      onClick: () => toggleSelect(f.uuid),
      className: "relative text-left rounded-xl p-4 min-h-[132px] flex flex-col transition-all " + cardBase + " " + cardHover
    }, isSel && /*#__PURE__*/react.createElement("span", {
      className: "absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center " + (isDark ? "bg-white text-gray-900" : "bg-gray-900 text-white")
    }, /*#__PURE__*/react.createElement(check/* default */.A, {
      className: "w-3.5 h-3.5",
      strokeWidth: 3
    })), /*#__PURE__*/react.createElement("div", {
      className: "text-[15px] font-semibold leading-6 pr-8 break-all"
    }, f.name), /*#__PURE__*/react.createElement("div", {
      className: "mt-4 flex items-center gap-3"
    }, /*#__PURE__*/react.createElement("span", {
      className: "inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border " + toneCls.wrap
    }, iconSrc ? /*#__PURE__*/react.createElement("img", {
      src: iconSrc,
      alt: "",
      className: "w-5 h-5 object-contain"
    }) : /*#__PURE__*/react.createElement(IconComponent, {
      className: "w-5 h-5 " + toneCls.icon
    })), /*#__PURE__*/react.createElement("div", {
      className: "text-xs " + (isDark ? "text-secondary/70" : "text-gray-400")
    }, extLabel(f.suffix, f.name), " \xB7 ", formatSize(f.size))));
  })) : /*#__PURE__*/react.createElement("div", {
    className: "space-y-2"
  }, sorted.map(f => {
    const isSel = selected.has(f.uuid);
    const {
      Icon,
      iconSrc,
      tone
    } = getFileVisual(f.suffix, f.name);
    const IconComponent = Icon !== null && Icon !== void 0 ? Icon : file_text/* default */.A;
    const toneCls = getFileToneClasses(tone, isDark);
    return /*#__PURE__*/react.createElement("button", {
      key: f.uuid,
      type: "button",
      onClick: () => toggleSelect(f.uuid),
      className: "w-full flex items-center gap-4 rounded-xl px-4 py-3 text-left transition-all " + cardBase + " " + cardHover
    }, isSel ? /*#__PURE__*/react.createElement("span", {
      className: "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center " + (isDark ? "bg-white text-gray-900" : "bg-gray-900 text-white")
    }, /*#__PURE__*/react.createElement(check/* default */.A, {
      className: "w-3.5 h-3.5",
      strokeWidth: 3
    })) : /*#__PURE__*/react.createElement("span", {
      className: "w-6 h-6 flex-shrink-0"
    }), /*#__PURE__*/react.createElement("span", {
      className: "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border " + toneCls.wrap
    }, iconSrc ? /*#__PURE__*/react.createElement("img", {
      src: iconSrc,
      alt: "",
      className: "w-5 h-5 object-contain"
    }) : /*#__PURE__*/react.createElement(IconComponent, {
      className: "w-5 h-5 " + toneCls.icon
    })), /*#__PURE__*/react.createElement("div", {
      className: "flex-1 min-w-0"
    }, /*#__PURE__*/react.createElement("div", {
      className: "text-[15px] font-semibold truncate"
    }, f.name), /*#__PURE__*/react.createElement("div", {
      className: "text-xs text-secondary mt-0.5 flex items-center gap-1.5"
    }, extLabel(f.suffix, f.name), " \xB7 ", formatSize(f.size))));
  })))), /*#__PURE__*/react.createElement(ChatModal, {
    open: chatModalOpen,
    files: selectedFiles,
    isDark: isDark,
    onClose: () => setChatModalOpen(false),
    onSubmit: handleChatSubmit
  }));
};
/* harmony default export */ var library_LibraryPage = (LibraryPage);

/***/ })

}]);
//# sourceMappingURL=e2b8dfba6ee9c1a38957200bc8f1403ba3aecb8a-e27742f55b9e0159fed5.js.map