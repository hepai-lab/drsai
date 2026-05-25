"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[2793],{

/***/ 12679:
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
// EXTERNAL MODULE: ./node_modules/antd/es/button/index.js + 27 modules
var es_button = __webpack_require__(81917);
// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/antd/es/modal/index.js + 28 modules
var modal = __webpack_require__(56426);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/file-text.js
var file_text = __webpack_require__(80827);
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

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/check.js
var check = __webpack_require__(45773);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/copy.js
var copy = __webpack_require__(35404);
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

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/message-square.js
var message_square = __webpack_require__(47504);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/x.js
var x = __webpack_require__(48697);
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
;// ./node_modules/lucide-react/dist/esm/icons/arrow-down-a-z.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const ArrowDownAZ = (0,createLucideIcon/* default */.A)("ArrowDownAZ", [
  ["path", { d: "m3 16 4 4 4-4", key: "1co6wj" }],
  ["path", { d: "M7 20V4", key: "1yoxec" }],
  ["path", { d: "M20 8h-5", key: "1vsyxs" }],
  ["path", { d: "M15 10V6.5a2.5 2.5 0 0 1 5 0V10", key: "ag13bf" }],
  ["path", { d: "M15 14h5l-5 6h5", key: "ur5jdg" }]
]);


//# sourceMappingURL=arrow-down-a-z.js.map

;// ./node_modules/lucide-react/dist/esm/icons/arrow-up-a-z.js
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const ArrowUpAZ = (0,createLucideIcon/* default */.A)("ArrowUpAZ", [
  ["path", { d: "m3 8 4-4 4 4", key: "11wl7u" }],
  ["path", { d: "M7 4v16", key: "1glfcx" }],
  ["path", { d: "M20 8h-5", key: "1vsyxs" }],
  ["path", { d: "M15 10V6.5a2.5 2.5 0 0 1 5 0V10", key: "ag13bf" }],
  ["path", { d: "M15 14h5l-5 6h5", key: "ur5jdg" }]
]);


//# sourceMappingURL=arrow-up-a-z.js.map

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

// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/loader-circle.js
var loader_circle = __webpack_require__(8723);
// EXTERNAL MODULE: ./node_modules/lucide-react/dist/esm/icons/folder-open.js
var folder_open = __webpack_require__(43242);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
;// ./src/pages/library/LibraryPage.tsx













function FileTypeIcon(_ref) {
  let {
    Icon,
    iconSrc,
    toneCls,
    className = "w-7 h-7"
  } = _ref;
  const IconComponent = Icon !== null && Icon !== void 0 ? Icon : file_text/* default */.A;
  return iconSrc ? /*#__PURE__*/react.createElement("img", {
    src: iconSrc,
    alt: "",
    className: className + " object-contain"
  }) : /*#__PURE__*/react.createElement(IconComponent, {
    className: className + " " + toneCls.icon
  });
}
function LibraryImagePreview(_ref2) {
  let {
    src,
    onOpen,
    isDark
  } = _ref2;
  const {
    0: failed,
    1: setFailed
  } = (0,react.useState)(false);
  return /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: e => {
      e.stopPropagation();
      onOpen();
    },
    title: "\u70B9\u51FB\u67E5\u770B\u5B8C\u6574\u9884\u89C8",
    className: "group/preview relative block w-full overflow-hidden rounded-xl border outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent/40 " + (isDark ? "border-white/10 bg-black/25 hover:border-accent/30" : "border-[#e8eaf0] bg-[#f4f6fa] hover:border-[#cfc0e8]")
  }, /*#__PURE__*/react.createElement("div", {
    className: "aspect-[4/3] w-full"
  }, !failed ? /*#__PURE__*/react.createElement("img", {
    src: src,
    alt: "",
    loading: "lazy",
    onError: () => setFailed(true),
    className: "h-full w-full object-cover transition-transform duration-300 group-hover/preview:scale-[1.03]"
  }) : /*#__PURE__*/react.createElement("div", {
    className: "flex h-full flex-col items-center justify-center gap-2 text-secondary"
  }, /*#__PURE__*/react.createElement(FileImage, {
    className: "h-8 w-8 opacity-40",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("span", {
    className: "text-[11px] opacity-70"
  }, "\u9884\u89C8\u4E0D\u53EF\u7528"))), /*#__PURE__*/react.createElement("span", {
    className: "pointer-events-none absolute inset-x-0 bottom-0 px-2 py-1.5 text-[10px] font-medium tracking-wide opacity-0 transition-opacity group-hover/preview:opacity-100 " + (isDark ? "bg-gradient-to-t from-black/70 to-transparent text-white/90" : "bg-gradient-to-t from-black/55 to-transparent text-white")
  }, "\u67E5\u770B\u5927\u56FE"));
}
function LibraryFileGridCard(_ref3) {
  let {
    file,
    userId,
    isDark,
    isSelected,
    onToggleSelect,
    onCopyLink,
    onOpenImage
  } = _ref3;
  const {
    Icon,
    iconSrc,
    tone
  } = getFileVisual(file.suffix, file.name);
  const toneCls = getFileToneClasses(tone, isDark);
  const imagePreviewSrc = libraryImagePreviewSrc(file, userId);
  return /*#__PURE__*/react.createElement("div", {
    tabIndex: 0,
    onClick: onToggleSelect,
    onKeyDown: e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleSelect();
      }
    },
    "aria-label": "\u9009\u62E9\u6587\u4EF6 " + file.name,
    "aria-pressed": isSelected,
    className: "group relative flex cursor-pointer flex-col overflow-hidden rounded-[18px] border text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/35 hover:-translate-y-px " + (isSelected ? isDark ? "border-accent/50 bg-accent/10 shadow-[0_0_0_1px_rgba(167,139,250,0.18)_inset,0_12px_28px_rgba(0,0,0,0.28)]" : "border-accent/45 bg-accent/[0.06] shadow-[0_0_0_1px_rgba(167,139,250,0.16)_inset,0_12px_24px_rgba(52,61,88,0.08)]" : isDark ? "border-[#433a5e] bg-[rgba(167,139,250,0.08)] shadow-[0_8px_20px_rgba(0,0,0,0.22)] hover:border-[#5a4f7a] hover:shadow-[0_14px_28px_rgba(0,0,0,0.3)]" : "border-[#ddd3ef] bg-[#fafafe] shadow-[0_6px_16px_rgba(43,51,72,0.035)] hover:border-[#cfc0e8] hover:shadow-[0_12px_24px_rgba(52,61,88,0.065)]")
  }, /*#__PURE__*/react.createElement("span", {
    className: "absolute right-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full transition-all " + (isSelected ? "scale-100 bg-accent text-white opacity-100 shadow-sm" : "scale-90 border border-white/70 bg-white/85 text-transparent opacity-0 group-hover:scale-100 group-hover:opacity-100 dark:border-white/20 dark:bg-black/50"),
    "aria-hidden": true
  }, /*#__PURE__*/react.createElement(check/* default */.A, {
    className: "h-3.5 w-3.5",
    strokeWidth: 3
  })), /*#__PURE__*/react.createElement("div", {
    className: "p-3 pb-2"
  }, imagePreviewSrc ? /*#__PURE__*/react.createElement(LibraryImagePreview, {
    src: imagePreviewSrc,
    isDark: isDark,
    onOpen: () => onOpenImage(imagePreviewSrc, file.name)
  }) : /*#__PURE__*/react.createElement("div", {
    className: "flex aspect-[4/3] w-full items-center justify-center rounded-xl border " + toneCls.wrap
  }, /*#__PURE__*/react.createElement(FileTypeIcon, {
    Icon: Icon,
    iconSrc: iconSrc,
    toneCls: toneCls,
    className: "h-10 w-10"
  }))), /*#__PURE__*/react.createElement("div", {
    className: "mt-auto border-t px-3 py-2.5 " + (isDark ? "border-white/8" : "border-[#ebe7f1]")
  }, /*#__PURE__*/react.createElement("div", {
    className: "truncate text-sm font-medium text-primary",
    title: file.name
  }, file.name), /*#__PURE__*/react.createElement("div", {
    className: "mt-1 flex items-center gap-2"
  }, /*#__PURE__*/react.createElement("span", {
    className: "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide " + (isDark ? "bg-white/8 text-secondary" : "bg-[#f1eef7] text-[#6b6680]")
  }, extLabel(file.suffix, file.name)), /*#__PURE__*/react.createElement("span", {
    className: "min-w-0 flex-1 truncate text-xs text-secondary"
  }, formatSize(file.size)), /*#__PURE__*/react.createElement("button", {
    type: "button",
    className: "inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-secondary opacity-0 outline-none transition-all hover:bg-tertiary/35 hover:text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/35 group-hover:opacity-100",
    title: "\u590D\u5236\u6587\u4EF6\u94FE\u63A5",
    "aria-label": "\u590D\u5236\u6587\u4EF6\u94FE\u63A5",
    onClick: e => {
      e.stopPropagation();
      onCopyLink();
    }
  }, /*#__PURE__*/react.createElement(copy/* default */.A, {
    className: "h-3.5 w-3.5"
  })))));
}
function LibraryFileListRow(_ref4) {
  let {
    file,
    userId,
    isDark,
    isSelected,
    onToggleSelect,
    onCopyLink,
    onOpenImage
  } = _ref4;
  const {
    Icon,
    iconSrc,
    tone
  } = getFileVisual(file.suffix, file.name);
  const toneCls = getFileToneClasses(tone, isDark);
  const imagePreviewSrc = libraryImagePreviewSrc(file, userId);
  return /*#__PURE__*/react.createElement("div", {
    tabIndex: 0,
    onClick: onToggleSelect,
    onKeyDown: e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleSelect();
      }
    },
    "aria-label": "\u9009\u62E9\u6587\u4EF6 " + file.name,
    "aria-pressed": isSelected,
    className: "group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/35 " + (isSelected ? isDark ? "border-accent/50 bg-accent/10" : "border-accent/45 bg-accent/[0.06]" : isDark ? "border-[#433a5e] bg-[rgba(167,139,250,0.06)] hover:border-[#5a4f7a] hover:bg-[rgba(167,139,250,0.1)]" : "border-[#e7e7ef] bg-white hover:border-[#ddd3ef] hover:bg-[#fafafe]")
  }, /*#__PURE__*/react.createElement("span", {
    className: "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors " + (isSelected ? "bg-accent text-white shadow-sm" : "border border-primary/25 bg-tertiary/15 text-transparent"),
    "aria-hidden": true
  }, /*#__PURE__*/react.createElement(check/* default */.A, {
    className: "h-3.5 w-3.5",
    strokeWidth: 3
  })), imagePreviewSrc ? /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: e => {
      e.stopPropagation();
      onOpenImage(imagePreviewSrc, file.name);
    },
    title: "\u70B9\u51FB\u67E5\u770B\u5B8C\u6574\u9884\u89C8",
    className: "inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 " + toneCls.wrap
  }, /*#__PURE__*/react.createElement("img", {
    src: imagePreviewSrc,
    alt: "",
    loading: "lazy",
    className: "h-full w-full object-cover"
  })) : /*#__PURE__*/react.createElement("span", {
    className: "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border " + toneCls.wrap
  }, /*#__PURE__*/react.createElement(FileTypeIcon, {
    Icon: Icon,
    iconSrc: iconSrc,
    toneCls: toneCls,
    className: "h-5 w-5"
  })), /*#__PURE__*/react.createElement("div", {
    className: "min-w-0 flex-1"
  }, /*#__PURE__*/react.createElement("div", {
    className: "truncate text-sm font-medium text-primary",
    title: file.name
  }, file.name), /*#__PURE__*/react.createElement("div", {
    className: "mt-0.5 flex items-center gap-1.5 text-xs text-secondary"
  }, /*#__PURE__*/react.createElement("span", null, extLabel(file.suffix, file.name)), /*#__PURE__*/react.createElement("span", {
    "aria-hidden": true
  }, "\xB7"), /*#__PURE__*/react.createElement("span", null, formatSize(file.size)))), /*#__PURE__*/react.createElement("button", {
    type: "button",
    className: "inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-secondary opacity-0 outline-none transition-all hover:bg-tertiary/35 hover:text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/35 group-hover:opacity-100",
    title: "\u590D\u5236\u6587\u4EF6\u94FE\u63A5",
    "aria-label": "\u590D\u5236\u6587\u4EF6\u94FE\u63A5",
    onClick: e => {
      e.stopPropagation();
      onCopyLink();
    }
  }, /*#__PURE__*/react.createElement(copy/* default */.A, {
    className: "h-3.5 w-3.5"
  })));
}
function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
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

/** 文件可访问地址：与「下载」一致，优先已有 url，否则拼接后端下载地址。 */
function libraryFileAddress(f, userId) {
  var _f$url;
  const u = (_f$url = f.url) === null || _f$url === void 0 ? void 0 : _f$url.trim();
  if (u) return u;
  if (userId && f.uuid) return api/* fileAPI */.jp.getDownloadUrl(userId, f.uuid);
  return null;
}

/** 网格/列表内联缩略图 URL（图片类型）。 */
function libraryImagePreviewSrc(f, userId) {
  var _f$url2;
  const ext = normalizeExt(f.suffix, f.name);
  if (!["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return null;
  const u = (_f$url2 = f.url) === null || _f$url2 === void 0 ? void 0 : _f$url2.trim();
  if (u) return u;
  if (userId && f.uuid) return api/* fileAPI */.jp.getDownloadUrl(userId, f.uuid);
  return null;
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

const ChatModal = _ref5 => {
  let {
    open,
    files,
    onClose,
    onSubmit
  } = _ref5;
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
  const panel = "relative w-full max-w-2xl rounded-xl border border-primary bg-primary text-primary shadow-modern flex flex-col max-h-[85vh]";
  const fileWrap = "mx-4 mb-3 rounded-lg border border-primary/40 bg-tertiary/15 dark:bg-white/[0.04] overflow-hidden flex-shrink-0";
  const inputCls = "flex-1 resize-none rounded-lg border border-primary/40 bg-tertiary/10 dark:bg-white/[0.04] px-3 py-2.5 text-sm text-primary outline-none transition-colors placeholder:text-secondary/60 focus:border-accent/50 focus:ring-1 focus:ring-accent/30";
  return /*#__PURE__*/react.createElement("div", {
    className: "fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50",
    onClick: e => e.target === e.currentTarget && onClose()
  }, /*#__PURE__*/react.createElement("div", {
    className: panel,
    role: "dialog",
    "aria-modal": "true"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0 border-b border-primary/30"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex items-center gap-2 min-w-0"
  }, /*#__PURE__*/react.createElement(message_square/* default */.A, {
    className: "w-4 h-4 text-accent shrink-0",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("span", {
    className: "font-medium text-sm sm:text-base text-primary truncate"
  }, "\u5F00\u59CB\u804A\u5929 \xB7 ", files.length, " \u4E2A\u6587\u4EF6")), /*#__PURE__*/react.createElement("button", {
    type: "button",
    onClick: onClose,
    className: "p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-tertiary/40 transition-colors",
    "aria-label": "\u5173\u95ED"
  }, /*#__PURE__*/react.createElement(x/* default */.A, {
    className: "w-4 h-4"
  }))), /*#__PURE__*/react.createElement("div", {
    className: fileWrap
  }, /*#__PURE__*/react.createElement("div", {
    className: "max-h-[240px] overflow-y-auto divide-y divide-primary/20"
  }, files.map(f => /*#__PURE__*/react.createElement("div", {
    key: f.uuid,
    className: "flex items-center gap-3 px-3 py-2.5"
  }, /*#__PURE__*/react.createElement(file_text/* default */.A, {
    className: "w-4 h-4 flex-shrink-0 text-secondary",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 min-w-0"
  }, /*#__PURE__*/react.createElement("div", {
    className: "text-sm font-medium text-primary truncate"
  }, f.name), /*#__PURE__*/react.createElement("div", {
    className: "text-xs mt-0.5 text-secondary"
  }, extLabel(f.suffix, f.name), " \xB7 ", formatSize(f.size))))))), /*#__PURE__*/react.createElement("p", {
    className: "px-4 mb-2 text-xs flex-shrink-0 text-secondary"
  }, "\u6587\u4EF6\u5DF2\u5C31\u7EEA\uFF0C\u65E0\u9700\u91CD\u65B0\u4E0A\u4F20\u3002Enter \u53D1\u9001\uFF0CShift+Enter \u6362\u884C\u3002"), /*#__PURE__*/react.createElement("div", {
    className: "px-4 pb-4 flex gap-2 items-end flex-shrink-0"
  }, /*#__PURE__*/react.createElement("textarea", {
    ref: textareaRef,
    rows: 3,
    value: text,
    onChange: e => setText(e.target.value),
    onKeyDown: handleKeyDown,
    placeholder: "\u8F93\u5165\u95EE\u9898\u2026",
    className: inputCls
  }), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    type: "primary",
    htmlType: "button",
    loading: submitting,
    disabled: !text.trim() || submitting,
    onClick: () => void handleSubmit(),
    className: "shrink-0",
    "aria-label": "\u53D1\u9001",
    icon: /*#__PURE__*/react.createElement(send/* default */.A, {
      className: "w-4 h-4"
    })
  }))));
};

/* ------------------------------------------------------------------ */
/* LibraryPage                                                          */
/* ------------------------------------------------------------------ */
const LibraryPage = _ref6 => {
  let {
    onStartChat
  } = _ref6;
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
    0: sortOrder,
    1: setSortOrder
  } = (0,react.useState)("asc");
  const {
    0: chatModalOpen,
    1: setChatModalOpen
  } = (0,react.useState)(false);
  const {
    0: imageLightbox,
    1: setImageLightbox
  } = (0,react.useState)(null);
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
    return (0,toConsumableArray/* default */.A)(filtered).sort((a, b) => {
      const cmp = (a.name || "").localeCompare(b.name || "", "zh-CN");
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortOrder]);
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
      okText: "删除",
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
  const copyLibraryFileAddress = (0,react.useCallback)(async f => {
    const addr = libraryFileAddress(f, userId);
    if (!addr) {
      message/* default */.Ay.warning("无法获取文件链接");
      return;
    }
    try {
      var _navigator$clipboard;
      if ((_navigator$clipboard = navigator.clipboard) !== null && _navigator$clipboard !== void 0 && _navigator$clipboard.writeText) {
        await navigator.clipboard.writeText(addr);
      } else {
        const ta = document.createElement("textarea");
        ta.value = addr;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      message/* default */.Ay.success("已复制文件链接");
    } catch (_unused) {
      message/* default */.Ay.error("复制失败");
    }
  }, [userId]);
  const handleChatSubmit = chatQuery => {
    setChatModalOpen(false);
    onStartChat(selectedFiles, chatQuery);
  };
  const iconToggle = "p-2 text-secondary transition-colors hover:text-primary hover:bg-tertiary/30 rounded-md";
  const iconToggleActive = "bg-accent/15 text-accent";
  const fileCardProps = f => ({
    file: f,
    userId,
    isDark,
    isSelected: selected.has(f.uuid),
    onToggleSelect: () => toggleSelect(f.uuid),
    onCopyLink: () => void copyLibraryFileAddress(f),
    onOpenImage: (src, name) => setImageLightbox({
      src,
      name
    })
  });
  return /*#__PURE__*/react.createElement(react.Fragment, null, /*#__PURE__*/react.createElement("div", {
    className: "h-full min-h-0 flex flex-col bg-primary p-4 text-primary sm:p-5"
  }, /*#__PURE__*/react.createElement("div", {
    className: "flex-shrink-0 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4"
  }, /*#__PURE__*/react.createElement("div", {
    className: "min-w-0"
  }, /*#__PURE__*/react.createElement("div", {
    className: "text-base font-semibold tracking-[-0.01em] text-primary"
  }, "\u5E93"), /*#__PURE__*/react.createElement("div", {
    className: "mt-0.5 text-sm text-secondary"
  }, "\u7BA1\u7406\u4E0A\u4F20\u6587\u4EF6\uFF1B\u9009\u4E2D\u540E\u53EF\u53D1\u8D77\u5BF9\u8BDD\u6216\u4E0B\u8F7D\u3002"), !loading && /*#__PURE__*/react.createElement("div", {
    className: "mt-1 text-xs text-secondary/80"
  }, items.length === 0 ? "暂无文件" : query.trim() ? "\u5171 " + items.length + " \u4E2A\u6587\u4EF6 \xB7 \u5339\u914D " + sorted.length + " \u4E2A" : "\u5171 " + items.length + " \u4E2A\u6587\u4EF6")), /*#__PURE__*/react.createElement("div", {
    className: "flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end min-w-0"
  }, /*#__PURE__*/react.createElement("div", {
    className: "relative flex-1 sm:max-w-xs min-w-[180px]"
  }, /*#__PURE__*/react.createElement(search/* default */.A, {
    className: "absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("input", {
    type: "search",
    value: query,
    onChange: e => setQuery(e.target.value),
    placeholder: "\u641C\u7D22\u6587\u4EF6\u540D",
    className: "w-full rounded-md border border-primary/40 bg-tertiary/10 dark:bg-white/[0.04] pl-9 pr-3 py-1.5 text-sm text-primary outline-none placeholder:text-secondary/60 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
  })), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    type: "primary",
    htmlType: "button",
    onClick: handleUploadPick,
    icon: /*#__PURE__*/react.createElement(upload/* default */.A, {
      className: "w-4 h-4"
    })
  }, "\u4E0A\u4F20")), /*#__PURE__*/react.createElement("input", {
    ref: uploadRef,
    type: "file",
    multiple: true,
    className: "hidden",
    onChange: handleUploadChange
  })), selected.size > 0 ? /*#__PURE__*/react.createElement("div", {
    className: "mt-3 flex flex-shrink-0 flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 " + (isDark ? "border-accent/25 bg-accent/10" : "border-accent/20 bg-accent/[0.05]")
  }, /*#__PURE__*/react.createElement("span", {
    className: "mr-1 text-sm font-medium text-primary"
  }, "\u5DF2\u9009 ", selected.size, " \u4E2A"), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    type: "primary",
    htmlType: "button",
    size: "small",
    onClick: () => setChatModalOpen(true),
    icon: /*#__PURE__*/react.createElement(message_square/* default */.A, {
      className: "w-4 h-4"
    })
  }, "\u5F00\u59CB\u804A\u5929"), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    htmlType: "button",
    size: "small",
    onClick: () => void handleDownload(),
    icon: /*#__PURE__*/react.createElement(download/* default */.A, {
      className: "w-4 h-4"
    })
  }, "\u4E0B\u8F7D"), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    color: "danger",
    variant: "outlined",
    htmlType: "button",
    size: "small",
    onClick: handleRemove,
    icon: /*#__PURE__*/react.createElement(trash_2/* default */.A, {
      className: "w-4 h-4"
    }),
    className: "!border-[var(--color-error-primary)] !text-[var(--color-error-primary)] hover:!text-[var(--color-error-primary)] hover:!border-[var(--color-error-primary)]"
  }, "\u5220\u9664"), /*#__PURE__*/react.createElement(es_button/* default */.Ay, {
    htmlType: "button",
    size: "small",
    onClick: () => setSelected(new Set()),
    icon: /*#__PURE__*/react.createElement(x/* default */.A, {
      className: "w-4 h-4"
    })
  }, "\u53D6\u6D88")) : null, /*#__PURE__*/react.createElement("div", {
    className: "mt-3 flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-primary/30 pb-3"
  }, /*#__PURE__*/react.createElement("div", {
    className: "text-xs font-semibold tracking-wide text-secondary"
  }, query.trim() ? "搜索结果" : "全部文件"), /*#__PURE__*/react.createElement("div", {
    className: "ml-auto flex items-center gap-2"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    title: sortOrder === "asc" ? "按名称升序" : "按名称降序",
    className: iconToggle + " inline-flex items-center gap-1.5 px-2.5",
    onClick: () => setSortOrder(prev => prev === "asc" ? "desc" : "asc")
  }, sortOrder === "asc" ? /*#__PURE__*/react.createElement(ArrowDownAZ, {
    className: "h-4 w-4"
  }) : /*#__PURE__*/react.createElement(ArrowUpAZ, {
    className: "h-4 w-4"
  }), /*#__PURE__*/react.createElement("span", {
    className: "hidden text-xs sm:inline"
  }, sortOrder === "asc" ? "名称 A→Z" : "名称 Z→A")), /*#__PURE__*/react.createElement("div", {
    className: "flex overflow-hidden rounded-lg border border-primary/40 bg-tertiary/10 p-0.5 gap-0.5 dark:bg-white/[0.03]"
  }, /*#__PURE__*/react.createElement("button", {
    type: "button",
    title: "\u7F51\u683C",
    onClick: () => setViewMode("grid"),
    className: iconToggle + " rounded-md " + (viewMode === "grid" ? iconToggleActive : "")
  }, /*#__PURE__*/react.createElement(LayoutGrid, {
    className: "w-4 h-4"
  })), /*#__PURE__*/react.createElement("button", {
    type: "button",
    title: "\u5217\u8868",
    onClick: () => setViewMode("list"),
    className: iconToggle + " rounded-md " + (viewMode === "list" ? iconToggleActive : "")
  }, /*#__PURE__*/react.createElement(List, {
    className: "w-4 h-4"
  }))))), /*#__PURE__*/react.createElement("div", {
    className: "flex-1 min-h-0 overflow-auto py-4"
  }, loading ? /*#__PURE__*/react.createElement("div", {
    className: "flex items-center justify-center gap-2 py-24 text-secondary"
  }, /*#__PURE__*/react.createElement(loader_circle/* default */.A, {
    className: "h-6 w-6 animate-spin"
  }), /*#__PURE__*/react.createElement("span", null, "\u52A0\u8F7D\u4E2D\u2026")) : sorted.length === 0 ? /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col items-center justify-center py-24 text-secondary"
  }, /*#__PURE__*/react.createElement(folder_open/* default */.A, {
    className: "mb-3 h-10 w-10 opacity-25",
    "aria-hidden": true
  }), /*#__PURE__*/react.createElement("p", {
    className: "text-sm"
  }, items.length === 0 ? "对话中上传的文件会出现在这里" : "没有匹配的文件")) : viewMode === "grid" ? /*#__PURE__*/react.createElement("div", {
    className: "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4"
  }, sorted.map(f => /*#__PURE__*/react.createElement(LibraryFileGridCard, Object.assign({
    key: f.uuid
  }, fileCardProps(f))))) : /*#__PURE__*/react.createElement("div", {
    className: "space-y-2"
  }, sorted.map(f => /*#__PURE__*/react.createElement(LibraryFileListRow, Object.assign({
    key: f.uuid
  }, fileCardProps(f))))))), /*#__PURE__*/react.createElement(ChatModal, {
    open: chatModalOpen,
    files: selectedFiles,
    onClose: () => setChatModalOpen(false),
    onSubmit: handleChatSubmit
  }), /*#__PURE__*/react.createElement(modal/* default */.A, {
    open: Boolean(imageLightbox),
    title: imageLightbox === null || imageLightbox === void 0 ? void 0 : imageLightbox.name,
    footer: null,
    centered: true,
    width: "fit-content",
    onCancel: () => setImageLightbox(null),
    styles: {
      body: {
        paddingBottom: "1rem",
        maxHeight: "90vh",
        overflow: "auto"
      }
    },
    destroyOnClose: true
  }, imageLightbox ? /*#__PURE__*/react.createElement("img", {
    src: imageLightbox.src,
    alt: imageLightbox.name,
    className: "block max-h-[85vh] max-w-[90vw] w-auto mx-auto object-contain"
  }) : null));
};
/* harmony default export */ var library_LibraryPage = (LibraryPage);

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


/***/ })

}]);
//# sourceMappingURL=056edf75a53fad974a7fcb0dc0e60c74aac42910-6cb82790d72aad50a418.js.map