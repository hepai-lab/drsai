"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[4678],{

/***/ 74054:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: function() { return /* binding */ es_form; }
});

// EXTERNAL MODULE: ./node_modules/antd/es/form/context.js
var context = __webpack_require__(94241);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./node_modules/classnames/index.js
var classnames = __webpack_require__(46942);
var classnames_default = /*#__PURE__*/__webpack_require__.n(classnames);
// EXTERNAL MODULE: ./node_modules/rc-motion/es/index.js + 13 modules
var es = __webpack_require__(90754);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/motion.js
var motion = __webpack_require__(23723);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useCSSVarCls.js
var useCSSVarCls = __webpack_require__(20934);
;// ./node_modules/antd/es/form/hooks/useDebounce.js

function useDebounce(value) {
  const [cacheValue, setCacheValue] = react.useState(value);
  react.useEffect(() => {
    const timeout = setTimeout(() => {
      setCacheValue(value);
    }, value.length ? 0 : 10);
    return () => {
      clearTimeout(timeout);
    };
  }, [value]);
  return cacheValue;
}
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs/es/index.js + 37 modules
var cssinjs_es = __webpack_require__(52187);
// EXTERNAL MODULE: ./node_modules/antd/es/style/index.js
var style = __webpack_require__(25905);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/zoom.js
var zoom = __webpack_require__(99077);
// EXTERNAL MODULE: ./node_modules/antd/es/style/motion/collapse.js
var collapse = __webpack_require__(60977);
// EXTERNAL MODULE: ./node_modules/@ant-design/cssinjs-utils/es/index.js + 12 modules
var cssinjs_utils_es = __webpack_require__(14277);
// EXTERNAL MODULE: ./node_modules/antd/es/theme/util/genStyleUtils.js
var genStyleUtils = __webpack_require__(37358);
;// ./node_modules/antd/es/form/style/explain.js
const genFormValidateMotionStyle = token => {
  const {
    componentCls
  } = token;
  const helpCls = `${componentCls}-show-help`;
  const helpItemCls = `${componentCls}-show-help-item`;
  return {
    [helpCls]: {
      // Explain holder
      transition: `opacity ${token.motionDurationFast} ${token.motionEaseInOut}`,
      '&-appear, &-enter': {
        opacity: 0,
        '&-active': {
          opacity: 1
        }
      },
      '&-leave': {
        opacity: 1,
        '&-active': {
          opacity: 0
        }
      },
      // Explain
      [helpItemCls]: {
        overflow: 'hidden',
        transition: `height ${token.motionDurationFast} ${token.motionEaseInOut},
                     opacity ${token.motionDurationFast} ${token.motionEaseInOut},
                     transform ${token.motionDurationFast} ${token.motionEaseInOut} !important`,
        [`&${helpItemCls}-appear, &${helpItemCls}-enter`]: {
          transform: `translateY(-5px)`,
          opacity: 0,
          '&-active': {
            transform: 'translateY(0)',
            opacity: 1
          }
        },
        [`&${helpItemCls}-leave-active`]: {
          transform: `translateY(-5px)`
        }
      }
    }
  };
};
/* harmony default export */ var explain = (genFormValidateMotionStyle);
;// ./node_modules/antd/es/form/style/index.js





const resetForm = token => ({
  legend: {
    display: 'block',
    width: '100%',
    marginBottom: token.marginLG,
    padding: 0,
    color: token.colorTextDescription,
    fontSize: token.fontSizeLG,
    lineHeight: 'inherit',
    border: 0,
    borderBottom: `${(0,cssinjs_es/* unit */.zA)(token.lineWidth)} ${token.lineType} ${token.colorBorder}`
  },
  'input[type="search"]': {
    boxSizing: 'border-box'
  },
  // Position radios and checkboxes better
  'input[type="radio"], input[type="checkbox"]': {
    lineHeight: 'normal'
  },
  'input[type="file"]': {
    display: 'block'
  },
  // Make range inputs behave like textual form controls
  'input[type="range"]': {
    display: 'block',
    width: '100%'
  },
  // Make multiple select elements height not fixed
  'select[multiple], select[size]': {
    height: 'auto'
  },
  // Focus for file, radio, and checkbox
  [`input[type='file']:focus,
  input[type='radio']:focus,
  input[type='checkbox']:focus`]: {
    outline: 0,
    boxShadow: `0 0 0 ${(0,cssinjs_es/* unit */.zA)(token.controlOutlineWidth)} ${token.controlOutline}`
  },
  // Adjust output element
  output: {
    display: 'block',
    paddingTop: 15,
    color: token.colorText,
    fontSize: token.fontSize,
    lineHeight: token.lineHeight
  }
});
const genFormSize = (token, height) => {
  const {
    formItemCls
  } = token;
  return {
    [formItemCls]: {
      [`${formItemCls}-label > label`]: {
        height
      },
      [`${formItemCls}-control-input`]: {
        minHeight: height
      }
    }
  };
};
const genFormStyle = token => {
  const {
    componentCls
  } = token;
  return {
    [token.componentCls]: Object.assign(Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), resetForm(token)), {
      [`${componentCls}-text`]: {
        display: 'inline-block',
        paddingInlineEnd: token.paddingSM
      },
      // ================================================================
      // =                             Size                             =
      // ================================================================
      '&-small': Object.assign({}, genFormSize(token, token.controlHeightSM)),
      '&-large': Object.assign({}, genFormSize(token, token.controlHeightLG))
    })
  };
};
const genFormItemStyle = token => {
  const {
    formItemCls,
    iconCls,
    componentCls,
    rootPrefixCls,
    antCls,
    labelRequiredMarkColor,
    labelColor,
    labelFontSize,
    labelHeight,
    labelColonMarginInlineStart,
    labelColonMarginInlineEnd,
    itemMarginBottom
  } = token;
  return {
    [formItemCls]: Object.assign(Object.assign({}, (0,style/* resetComponent */.dF)(token)), {
      marginBottom: itemMarginBottom,
      verticalAlign: 'top',
      '&-with-help': {
        transition: 'none'
      },
      [`&-hidden,
        &-hidden${antCls}-row`]: {
        // https://github.com/ant-design/ant-design/issues/26141
        display: 'none'
      },
      '&-has-warning': {
        [`${formItemCls}-split`]: {
          color: token.colorError
        }
      },
      '&-has-error': {
        [`${formItemCls}-split`]: {
          color: token.colorWarning
        }
      },
      // ==============================================================
      // =                            Label                           =
      // ==============================================================
      [`${formItemCls}-label`]: {
        flexGrow: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textAlign: 'end',
        verticalAlign: 'middle',
        '&-left': {
          textAlign: 'start'
        },
        '&-wrap': {
          overflow: 'unset',
          lineHeight: token.lineHeight,
          whiteSpace: 'unset'
        },
        '> label': {
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          maxWidth: '100%',
          height: labelHeight,
          color: labelColor,
          fontSize: labelFontSize,
          [`> ${iconCls}`]: {
            fontSize: token.fontSize,
            verticalAlign: 'top'
          },
          // Required mark
          [`&${formItemCls}-required:not(${formItemCls}-required-mark-optional)::before`]: {
            display: 'inline-block',
            marginInlineEnd: token.marginXXS,
            color: labelRequiredMarkColor,
            fontSize: token.fontSize,
            fontFamily: 'SimSun, sans-serif',
            lineHeight: 1,
            content: '"*"',
            [`${componentCls}-hide-required-mark &`]: {
              display: 'none'
            }
          },
          // Optional mark
          [`${formItemCls}-optional`]: {
            display: 'inline-block',
            marginInlineStart: token.marginXXS,
            color: token.colorTextDescription,
            [`${componentCls}-hide-required-mark &`]: {
              display: 'none'
            }
          },
          // Optional mark
          [`${formItemCls}-tooltip`]: {
            color: token.colorTextDescription,
            cursor: 'help',
            writingMode: 'horizontal-tb',
            marginInlineStart: token.marginXXS
          },
          '&::after': {
            content: '":"',
            position: 'relative',
            marginBlock: 0,
            marginInlineStart: labelColonMarginInlineStart,
            marginInlineEnd: labelColonMarginInlineEnd
          },
          [`&${formItemCls}-no-colon::after`]: {
            content: '"\\a0"'
          }
        }
      },
      // ==============================================================
      // =                            Input                           =
      // ==============================================================
      [`${formItemCls}-control`]: {
        ['--ant-display']: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        [`&:first-child:not([class^="'${rootPrefixCls}-col-'"]):not([class*="' ${rootPrefixCls}-col-'"])`]: {
          width: '100%'
        },
        '&-input': {
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          minHeight: token.controlHeight,
          '&-content': {
            flex: 'auto',
            maxWidth: '100%'
          }
        }
      },
      // ==============================================================
      // =                           Explain                          =
      // ==============================================================
      [formItemCls]: {
        '&-additional': {
          display: 'flex',
          flexDirection: 'column'
        },
        '&-explain, &-extra': {
          clear: 'both',
          color: token.colorTextDescription,
          fontSize: token.fontSize,
          lineHeight: token.lineHeight
        },
        '&-explain-connected': {
          width: '100%'
        },
        '&-extra': {
          minHeight: token.controlHeightSM,
          transition: `color ${token.motionDurationMid} ${token.motionEaseOut}` // sync input color transition
        },
        '&-explain': {
          '&-error': {
            color: token.colorError
          },
          '&-warning': {
            color: token.colorWarning
          }
        }
      },
      [`&-with-help ${formItemCls}-explain`]: {
        height: 'auto',
        opacity: 1
      },
      // ==============================================================
      // =                        Feedback Icon                       =
      // ==============================================================
      [`${formItemCls}-feedback-icon`]: {
        fontSize: token.fontSize,
        textAlign: 'center',
        visibility: 'visible',
        animationName: zoom/* zoomIn */.nF,
        animationDuration: token.motionDurationMid,
        animationTimingFunction: token.motionEaseOutBack,
        pointerEvents: 'none',
        '&-success': {
          color: token.colorSuccess
        },
        '&-error': {
          color: token.colorError
        },
        '&-warning': {
          color: token.colorWarning
        },
        '&-validating': {
          color: token.colorPrimary
        }
      }
    })
  };
};
const genHorizontalStyle = (token, className) => {
  const {
    formItemCls
  } = token;
  return {
    [`${className}-horizontal`]: {
      [`${formItemCls}-label`]: {
        flexGrow: 0
      },
      [`${formItemCls}-control`]: {
        flex: '1 1 0',
        // https://github.com/ant-design/ant-design/issues/32777
        // https://github.com/ant-design/ant-design/issues/33773
        minWidth: 0
      },
      // Do not change this to `ant-col-24`! `-24` match all the responsive rules
      // https://github.com/ant-design/ant-design/issues/32980
      // https://github.com/ant-design/ant-design/issues/34903
      // https://github.com/ant-design/ant-design/issues/44538
      [`${formItemCls}-label[class$='-24'], ${formItemCls}-label[class*='-24 ']`]: {
        [`& + ${formItemCls}-control`]: {
          minWidth: 'unset'
        }
      }
    }
  };
};
const genInlineStyle = token => {
  const {
    componentCls,
    formItemCls,
    inlineItemMarginBottom
  } = token;
  return {
    [`${componentCls}-inline`]: {
      display: 'flex',
      flexWrap: 'wrap',
      [formItemCls]: {
        flex: 'none',
        marginInlineEnd: token.margin,
        marginBottom: inlineItemMarginBottom,
        '&-row': {
          flexWrap: 'nowrap'
        },
        [`> ${formItemCls}-label,
        > ${formItemCls}-control`]: {
          display: 'inline-block',
          verticalAlign: 'top'
        },
        [`> ${formItemCls}-label`]: {
          flex: 'none'
        },
        [`${componentCls}-text`]: {
          display: 'inline-block'
        },
        [`${formItemCls}-has-feedback`]: {
          display: 'inline-block'
        }
      }
    }
  };
};
const makeVerticalLayoutLabel = token => ({
  padding: token.verticalLabelPadding,
  margin: token.verticalLabelMargin,
  whiteSpace: 'initial',
  textAlign: 'start',
  '> label': {
    margin: 0,
    '&::after': {
      // https://github.com/ant-design/ant-design/issues/43538
      visibility: 'hidden'
    }
  }
});
const makeVerticalLayout = token => {
  const {
    componentCls,
    formItemCls,
    rootPrefixCls
  } = token;
  return {
    [`${formItemCls} ${formItemCls}-label`]: makeVerticalLayoutLabel(token),
    // ref: https://github.com/ant-design/ant-design/issues/45122
    [`${componentCls}:not(${componentCls}-inline)`]: {
      [formItemCls]: {
        flexWrap: 'wrap',
        [`${formItemCls}-label, ${formItemCls}-control`]: {
          // When developer pass `xs: { span }`,
          // It should follow the `xs` screen config
          // ref: https://github.com/ant-design/ant-design/issues/44386
          [`&:not([class*=" ${rootPrefixCls}-col-xs"])`]: {
            flex: '0 0 100%',
            maxWidth: '100%'
          }
        }
      }
    }
  };
};
const genVerticalStyle = token => {
  const {
    componentCls,
    formItemCls,
    antCls
  } = token;
  return {
    [`${componentCls}-vertical`]: {
      [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
        [`${formItemCls}-row`]: {
          flexDirection: 'column'
        },
        [`${formItemCls}-label > label`]: {
          height: 'auto'
        },
        [`${formItemCls}-control`]: {
          width: '100%'
        },
        [`${formItemCls}-label,
        ${antCls}-col-24${formItemCls}-label,
        ${antCls}-col-xl-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    },
    [`@media (max-width: ${(0,cssinjs_es/* unit */.zA)(token.screenXSMax)})`]: [makeVerticalLayout(token), {
      [componentCls]: {
        [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
          [`${antCls}-col-xs-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
        }
      }
    }],
    [`@media (max-width: ${(0,cssinjs_es/* unit */.zA)(token.screenSMMax)})`]: {
      [componentCls]: {
        [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
          [`${antCls}-col-sm-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
        }
      }
    },
    [`@media (max-width: ${(0,cssinjs_es/* unit */.zA)(token.screenMDMax)})`]: {
      [componentCls]: {
        [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
          [`${antCls}-col-md-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
        }
      }
    },
    [`@media (max-width: ${(0,cssinjs_es/* unit */.zA)(token.screenLGMax)})`]: {
      [componentCls]: {
        [`${formItemCls}:not(${formItemCls}-horizontal)`]: {
          [`${antCls}-col-lg-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
        }
      }
    }
  };
};
const genItemVerticalStyle = token => {
  const {
    formItemCls,
    antCls
  } = token;
  return {
    [`${formItemCls}-vertical`]: {
      [`${formItemCls}-row`]: {
        flexDirection: 'column'
      },
      [`${formItemCls}-label > label`]: {
        height: 'auto'
      },
      [`${formItemCls}-control`]: {
        width: '100%'
      }
    },
    [`${formItemCls}-vertical ${formItemCls}-label,
      ${antCls}-col-24${formItemCls}-label,
      ${antCls}-col-xl-24${formItemCls}-label`]: makeVerticalLayoutLabel(token),
    [`@media (max-width: ${(0,cssinjs_es/* unit */.zA)(token.screenXSMax)})`]: [makeVerticalLayout(token), {
      [formItemCls]: {
        [`${antCls}-col-xs-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    }],
    [`@media (max-width: ${(0,cssinjs_es/* unit */.zA)(token.screenSMMax)})`]: {
      [formItemCls]: {
        [`${antCls}-col-sm-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    },
    [`@media (max-width: ${(0,cssinjs_es/* unit */.zA)(token.screenMDMax)})`]: {
      [formItemCls]: {
        [`${antCls}-col-md-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    },
    [`@media (max-width: ${(0,cssinjs_es/* unit */.zA)(token.screenLGMax)})`]: {
      [formItemCls]: {
        [`${antCls}-col-lg-24${formItemCls}-label`]: makeVerticalLayoutLabel(token)
      }
    }
  };
};
// ============================== Export ==============================
const prepareComponentToken = token => ({
  labelRequiredMarkColor: token.colorError,
  labelColor: token.colorTextHeading,
  labelFontSize: token.fontSize,
  labelHeight: token.controlHeight,
  labelColonMarginInlineStart: token.marginXXS / 2,
  labelColonMarginInlineEnd: token.marginXS,
  itemMarginBottom: token.marginLG,
  verticalLabelPadding: `0 0 ${token.paddingXS}px`,
  verticalLabelMargin: 0,
  inlineItemMarginBottom: 0
});
const prepareToken = (token, rootPrefixCls) => {
  const formToken = (0,cssinjs_utils_es/* mergeToken */.oX)(token, {
    formItemCls: `${token.componentCls}-item`,
    rootPrefixCls
  });
  return formToken;
};
/* harmony default export */ var form_style = ((0,genStyleUtils/* genStyleHooks */.OF)('Form', (token, _ref) => {
  let {
    rootPrefixCls
  } = _ref;
  const formToken = prepareToken(token, rootPrefixCls);
  return [genFormStyle(formToken), genFormItemStyle(formToken), explain(formToken), genHorizontalStyle(formToken, formToken.componentCls), genHorizontalStyle(formToken, formToken.formItemCls), genInlineStyle(formToken), genVerticalStyle(formToken), genItemVerticalStyle(formToken), (0,collapse/* default */.A)(formToken), zoom/* zoomIn */.nF];
}, prepareComponentToken, {
  // Let From style before the Grid
  // ref https://github.com/ant-design/ant-design/issues/44386
  order: -1000
}));
;// ./node_modules/antd/es/form/ErrorList.js
"use client";











const EMPTY_LIST = [];
function toErrorEntity(error, prefix, errorStatus) {
  let index = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;
  return {
    key: typeof error === 'string' ? error : `${prefix}-${index}`,
    error,
    errorStatus
  };
}
const ErrorList = _ref => {
  let {
    help,
    helpStatus,
    errors = EMPTY_LIST,
    warnings = EMPTY_LIST,
    className: rootClassName,
    fieldId,
    onVisibleChanged
  } = _ref;
  const {
    prefixCls
  } = react.useContext(context/* FormItemPrefixContext */.hb);
  const baseClassName = `${prefixCls}-item-explain`;
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = form_style(prefixCls, rootCls);
  const collapseMotion = (0,react.useMemo)(() => (0,motion/* default */.A)(prefixCls), [prefixCls]);
  // We have to debounce here again since somewhere use ErrorList directly still need no shaking
  // ref: https://github.com/ant-design/ant-design/issues/36336
  const debounceErrors = useDebounce(errors);
  const debounceWarnings = useDebounce(warnings);
  const fullKeyList = react.useMemo(() => {
    if (help !== undefined && help !== null) {
      return [toErrorEntity(help, 'help', helpStatus)];
    }
    return [].concat((0,toConsumableArray/* default */.A)(debounceErrors.map((error, index) => toErrorEntity(error, 'error', 'error', index))), (0,toConsumableArray/* default */.A)(debounceWarnings.map((warning, index) => toErrorEntity(warning, 'warning', 'warning', index))));
  }, [help, helpStatus, debounceErrors, debounceWarnings]);
  const filledKeyFullKeyList = react.useMemo(() => {
    const keysCount = {};
    fullKeyList.forEach(_ref2 => {
      let {
        key
      } = _ref2;
      keysCount[key] = (keysCount[key] || 0) + 1;
    });
    return fullKeyList.map((entity, index) => Object.assign(Object.assign({}, entity), {
      key: keysCount[entity.key] > 1 ? `${entity.key}-fallback-${index}` : entity.key
    }));
  }, [fullKeyList]);
  const helpProps = {};
  if (fieldId) {
    helpProps.id = `${fieldId}_help`;
  }
  return wrapCSSVar(/*#__PURE__*/react.createElement(es/* default */.Ay, {
    motionDeadline: collapseMotion.motionDeadline,
    motionName: `${prefixCls}-show-help`,
    visible: !!filledKeyFullKeyList.length,
    onVisibleChanged: onVisibleChanged
  }, holderProps => {
    const {
      className: holderClassName,
      style: holderStyle
    } = holderProps;
    return /*#__PURE__*/react.createElement("div", Object.assign({}, helpProps, {
      className: classnames_default()(baseClassName, holderClassName, cssVarCls, rootCls, rootClassName, hashId),
      style: holderStyle,
      role: "alert"
    }), /*#__PURE__*/react.createElement(es/* CSSMotionList */.aF, Object.assign({
      keys: filledKeyFullKeyList
    }, (0,motion/* default */.A)(prefixCls), {
      motionName: `${prefixCls}-show-help-item`,
      component: false
    }), itemProps => {
      const {
        key,
        error,
        errorStatus,
        className: itemClassName,
        style: itemStyle
      } = itemProps;
      return /*#__PURE__*/react.createElement("div", {
        key: key,
        className: classnames_default()(itemClassName, {
          [`${baseClassName}-${errorStatus}`]: errorStatus
        }),
        style: itemStyle
      }, error);
    }));
  }));
};
/* harmony default export */ var form_ErrorList = (ErrorList);
// EXTERNAL MODULE: ./node_modules/rc-field-form/es/index.js + 41 modules
var rc_field_form_es = __webpack_require__(93592);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/context.js
var config_provider_context = __webpack_require__(62279);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/DisabledContext.js
var DisabledContext = __webpack_require__(98119);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/hooks/useSize.js
var useSize = __webpack_require__(829);
// EXTERNAL MODULE: ./node_modules/antd/es/config-provider/SizeContext.js
var SizeContext = __webpack_require__(48224);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/findDOMNode.js
var findDOMNode = __webpack_require__(66588);
;// ./node_modules/compute-scroll-into-view/dist/index.js
const t=t=>"object"==typeof t&&null!=t&&1===t.nodeType,e=(t,e)=>(!e||"hidden"!==t)&&("visible"!==t&&"clip"!==t),n=(t,n)=>{if(t.clientHeight<t.scrollHeight||t.clientWidth<t.scrollWidth){const o=getComputedStyle(t,null);return e(o.overflowY,n)||e(o.overflowX,n)||(t=>{const e=(t=>{if(!t.ownerDocument||!t.ownerDocument.defaultView)return null;try{return t.ownerDocument.defaultView.frameElement}catch(t){return null}})(t);return!!e&&(e.clientHeight<t.scrollHeight||e.clientWidth<t.scrollWidth)})(t)}return!1},o=(t,e,n,o,l,r,i,s)=>r<t&&i>e||r>t&&i<e?0:r<=t&&s<=n||i>=e&&s>=n?r-t-o:i>e&&s<n||r<t&&s>n?i-e+l:0,l=t=>{const e=t.parentElement;return null==e?t.getRootNode().host||null:e},dist_r=(e,r)=>{var i,s,d,h;if("undefined"==typeof document)return[];const{scrollMode:c,block:f,inline:u,boundary:a,skipOverflowHiddenElements:g}=r,p="function"==typeof a?a:t=>t!==a;if(!t(e))throw new TypeError("Invalid target");const m=document.scrollingElement||document.documentElement,w=[];let W=e;for(;t(W)&&p(W);){if(W=l(W),W===m){w.push(W);break}null!=W&&W===document.body&&n(W)&&!n(document.documentElement)||null!=W&&n(W,g)&&w.push(W)}const b=null!=(s=null==(i=window.visualViewport)?void 0:i.width)?s:innerWidth,H=null!=(h=null==(d=window.visualViewport)?void 0:d.height)?h:innerHeight,{scrollX:y,scrollY:M}=window,{height:v,width:E,top:x,right:C,bottom:I,left:R}=e.getBoundingClientRect(),{top:T,right:B,bottom:F,left:V}=(t=>{const e=window.getComputedStyle(t);return{top:parseFloat(e.scrollMarginTop)||0,right:parseFloat(e.scrollMarginRight)||0,bottom:parseFloat(e.scrollMarginBottom)||0,left:parseFloat(e.scrollMarginLeft)||0}})(e);let k="start"===f||"nearest"===f?x-T:"end"===f?I+F:x+v/2-T+F,D="center"===u?R+E/2-V+B:"end"===u?C+B:R-V;const L=[];for(let t=0;t<w.length;t++){const e=w[t],{height:n,width:l,top:r,right:i,bottom:s,left:d}=e.getBoundingClientRect();if("if-needed"===c&&x>=0&&R>=0&&I<=H&&C<=b&&x>=r&&I<=s&&R>=d&&C<=i)return L;const h=getComputedStyle(e),a=parseInt(h.borderLeftWidth,10),g=parseInt(h.borderTopWidth,10),p=parseInt(h.borderRightWidth,10),W=parseInt(h.borderBottomWidth,10);let T=0,B=0;const F="offsetWidth"in e?e.offsetWidth-e.clientWidth-a-p:0,V="offsetHeight"in e?e.offsetHeight-e.clientHeight-g-W:0,S="offsetWidth"in e?0===e.offsetWidth?0:l/e.offsetWidth:0,X="offsetHeight"in e?0===e.offsetHeight?0:n/e.offsetHeight:0;if(m===e)T="start"===f?k:"end"===f?k-H:"nearest"===f?o(M,M+H,H,g,W,M+k,M+k+v,v):k-H/2,B="start"===u?D:"center"===u?D-b/2:"end"===u?D-b:o(y,y+b,b,a,p,y+D,y+D+E,E),T=Math.max(0,T+M),B=Math.max(0,B+y);else{T="start"===f?k-r-g:"end"===f?k-s+W+V:"nearest"===f?o(r,s,n,g,W+V,k,k+v,v):k-(r+n/2)+V/2,B="start"===u?D-d-a:"center"===u?D-(d+l/2)+F/2:"end"===u?D-i+p+F:o(d,i,l,a,p+F,D,D+E,E);const{scrollLeft:t,scrollTop:h}=e;T=0===X?0:Math.max(0,Math.min(h+T/X,e.scrollHeight-n/X+V)),B=0===S?0:Math.max(0,Math.min(t+B/S,e.scrollWidth-l/S+F)),k+=h-T,D+=t-B}L.push({el:e,top:T,left:B})}return L};//# sourceMappingURL=index.js.map

;// ./node_modules/scroll-into-view-if-needed/dist/index.js
const dist_o=t=>!1===t?{block:"end",inline:"nearest"}:(t=>t===Object(t)&&0!==Object.keys(t).length)(t)?t:{block:"start",inline:"nearest"};function dist_e(e,r){if(!e.isConnected||!(t=>{let o=t;for(;o&&o.parentNode;){if(o.parentNode===document)return!0;o=o.parentNode instanceof ShadowRoot?o.parentNode.host:o.parentNode}return!1})(e))return;const n=(t=>{const o=window.getComputedStyle(t);return{top:parseFloat(o.scrollMarginTop)||0,right:parseFloat(o.scrollMarginRight)||0,bottom:parseFloat(o.scrollMarginBottom)||0,left:parseFloat(o.scrollMarginLeft)||0}})(e);if((t=>"object"==typeof t&&"function"==typeof t.behavior)(r))return r.behavior(dist_r(e,r));const l="boolean"==typeof r||null==r?void 0:r.behavior;for(const{el:a,top:i,left:s}of dist_r(e,dist_o(r))){const t=i-n.top+n.bottom,o=s-n.left+n.right;a.scroll({top:t,left:o,behavior:l})}}//# sourceMappingURL=index.js.map

;// ./node_modules/antd/es/form/util.js
// form item name black list.  in form ,you can use form.id get the form item element.
// use object hasOwnProperty will get better performance if black list is longer.
const formItemNameBlackList = ['parentNode'];
// default form item id prefix.
const defaultItemNamePrefixCls = 'form_item';
function toArray(candidate) {
  if (candidate === undefined || candidate === false) return [];
  return Array.isArray(candidate) ? candidate : [candidate];
}
function getFieldId(namePath, formName) {
  if (!namePath.length) {
    return undefined;
  }
  const mergedId = namePath.join('_');
  if (formName) {
    return `${formName}_${mergedId}`;
  }
  const isIllegalName = formItemNameBlackList.includes(mergedId);
  return isIllegalName ? `${defaultItemNamePrefixCls}_${mergedId}` : mergedId;
}
/**
 * Get merged status by meta or passed `validateStatus`.
 */
function getStatus(errors, warnings, meta, defaultValidateStatus, hasFeedback, validateStatus) {
  let status = defaultValidateStatus;
  if (validateStatus !== undefined) {
    status = validateStatus;
  } else if (meta.validating) {
    status = 'validating';
  } else if (errors.length) {
    status = 'error';
  } else if (warnings.length) {
    status = 'warning';
  } else if (meta.touched || hasFeedback && meta.validated) {
    // success feedback should display when pass hasFeedback prop and current value is valid value
    status = 'success';
  }
  return status;
}
;// ./node_modules/antd/es/form/hooks/useForm.js





function toNamePathStr(name) {
  const namePath = toArray(name);
  return namePath.join('_');
}
function getFieldDOMNode(name, wrapForm) {
  const field = wrapForm.getFieldInstance(name);
  const fieldDom = (0,findDOMNode/* getDOM */.rb)(field);
  if (fieldDom) {
    return fieldDom;
  }
  const fieldId = getFieldId(toArray(name), wrapForm.__INTERNAL__.name);
  if (fieldId) {
    return document.getElementById(fieldId);
  }
}
function useForm(form) {
  const [rcForm] = (0,rc_field_form_es/* useForm */.mN)();
  const itemsRef = react.useRef({});
  const wrapForm = react.useMemo(() => form !== null && form !== void 0 ? form : Object.assign(Object.assign({}, rcForm), {
    __INTERNAL__: {
      itemRef: name => node => {
        const namePathStr = toNamePathStr(name);
        if (node) {
          itemsRef.current[namePathStr] = node;
        } else {
          delete itemsRef.current[namePathStr];
        }
      }
    },
    scrollToField: function (name) {
      let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      const node = getFieldDOMNode(name, wrapForm);
      if (node) {
        dist_e(node, Object.assign({
          scrollMode: 'if-needed',
          block: 'nearest'
        }, options));
      }
    },
    focusField: name => {
      var _a;
      const node = getFieldDOMNode(name, wrapForm);
      if (node) {
        (_a = node.focus) === null || _a === void 0 ? void 0 : _a.call(node);
      }
    },
    getFieldInstance: name => {
      const namePathStr = toNamePathStr(name);
      return itemsRef.current[namePathStr];
    }
  }), [form, rcForm]);
  return [wrapForm];
}
// EXTERNAL MODULE: ./node_modules/antd/es/form/validateMessagesContext.js
var validateMessagesContext = __webpack_require__(69407);
;// ./node_modules/antd/es/form/Form.js
"use client";

var __rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};














const InternalForm = (props, ref) => {
  const contextDisabled = react.useContext(DisabledContext/* default */.A);
  const {
    getPrefixCls,
    direction,
    form: contextForm
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const {
      prefixCls: customizePrefixCls,
      className,
      rootClassName,
      size,
      disabled = contextDisabled,
      form,
      colon,
      labelAlign,
      labelWrap,
      labelCol,
      wrapperCol,
      hideRequiredMark,
      layout = 'horizontal',
      scrollToFirstError,
      requiredMark,
      onFinishFailed,
      name,
      style,
      feedbackIcons,
      variant
    } = props,
    restFormProps = __rest(props, ["prefixCls", "className", "rootClassName", "size", "disabled", "form", "colon", "labelAlign", "labelWrap", "labelCol", "wrapperCol", "hideRequiredMark", "layout", "scrollToFirstError", "requiredMark", "onFinishFailed", "name", "style", "feedbackIcons", "variant"]);
  const mergedSize = (0,useSize/* default */.A)(size);
  const contextValidateMessages = react.useContext(validateMessagesContext/* default */.A);
  if (false) {}
  const mergedRequiredMark = (0,react.useMemo)(() => {
    if (requiredMark !== undefined) {
      return requiredMark;
    }
    if (hideRequiredMark) {
      return false;
    }
    if (contextForm && contextForm.requiredMark !== undefined) {
      return contextForm.requiredMark;
    }
    return true;
  }, [hideRequiredMark, requiredMark, contextForm]);
  const mergedColon = colon !== null && colon !== void 0 ? colon : contextForm === null || contextForm === void 0 ? void 0 : contextForm.colon;
  const prefixCls = getPrefixCls('form', customizePrefixCls);
  // Style
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = form_style(prefixCls, rootCls);
  const formClassName = classnames_default()(prefixCls, `${prefixCls}-${layout}`, {
    [`${prefixCls}-hide-required-mark`]: mergedRequiredMark === false,
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-${mergedSize}`]: mergedSize
  }, cssVarCls, rootCls, hashId, contextForm === null || contextForm === void 0 ? void 0 : contextForm.className, className, rootClassName);
  const [wrapForm] = useForm(form);
  const {
    __INTERNAL__
  } = wrapForm;
  __INTERNAL__.name = name;
  const formContextValue = (0,react.useMemo)(() => ({
    name,
    labelAlign,
    labelCol,
    labelWrap,
    wrapperCol,
    vertical: layout === 'vertical',
    colon: mergedColon,
    requiredMark: mergedRequiredMark,
    itemRef: __INTERNAL__.itemRef,
    form: wrapForm,
    feedbackIcons
  }), [name, labelAlign, labelCol, wrapperCol, layout, mergedColon, mergedRequiredMark, wrapForm, feedbackIcons]);
  const nativeElementRef = react.useRef(null);
  react.useImperativeHandle(ref, () => {
    var _a;
    return Object.assign(Object.assign({}, wrapForm), {
      nativeElement: (_a = nativeElementRef.current) === null || _a === void 0 ? void 0 : _a.nativeElement
    });
  });
  const scrollToField = (options, fieldName) => {
    if (options) {
      let defaultScrollToFirstError = {
        block: 'nearest'
      };
      if (typeof options === 'object') {
        defaultScrollToFirstError = Object.assign(Object.assign({}, defaultScrollToFirstError), options);
      }
      wrapForm.scrollToField(fieldName, defaultScrollToFirstError);
      if (defaultScrollToFirstError.focus) {
        wrapForm.focusField(fieldName);
      }
    }
  };
  const onInternalFinishFailed = errorInfo => {
    onFinishFailed === null || onFinishFailed === void 0 ? void 0 : onFinishFailed(errorInfo);
    if (errorInfo.errorFields.length) {
      const fieldName = errorInfo.errorFields[0].name;
      if (scrollToFirstError !== undefined) {
        scrollToField(scrollToFirstError, fieldName);
        return;
      }
      if (contextForm && contextForm.scrollToFirstError !== undefined) {
        scrollToField(contextForm.scrollToFirstError, fieldName);
      }
    }
  };
  return wrapCSSVar(/*#__PURE__*/react.createElement(context/* VariantContext */.Pp.Provider, {
    value: variant
  }, /*#__PURE__*/react.createElement(DisabledContext/* DisabledContextProvider */.X, {
    disabled: disabled
  }, /*#__PURE__*/react.createElement(SizeContext/* default */.A.Provider, {
    value: mergedSize
  }, /*#__PURE__*/react.createElement(context/* FormProvider */.Op, {
    // This is not list in API, we pass with spread
    validateMessages: contextValidateMessages
  }, /*#__PURE__*/react.createElement(context/* FormContext */.cK.Provider, {
    value: formContextValue
  }, /*#__PURE__*/react.createElement(rc_field_form_es/* default */.Ay, Object.assign({
    id: name
  }, restFormProps, {
    name: name,
    onFinishFailed: onInternalFinishFailed,
    form: wrapForm,
    ref: nativeElementRef,
    style: Object.assign(Object.assign({}, contextForm === null || contextForm === void 0 ? void 0 : contextForm.style), style),
    className: formClassName
  }))))))));
};
const Form = /*#__PURE__*/react.forwardRef(InternalForm);
if (false) {}

/* harmony default export */ var form_Form = (Form);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useState.js
var useState = __webpack_require__(1233);
// EXTERNAL MODULE: ./node_modules/rc-util/es/ref.js
var ref = __webpack_require__(8719);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/reactNode.js
var reactNode = __webpack_require__(40682);
// EXTERNAL MODULE: ./node_modules/antd/es/_util/warning.js
var _util_warning = __webpack_require__(18877);
// EXTERNAL MODULE: ./node_modules/rc-util/es/Children/toArray.js
var Children_toArray = __webpack_require__(82546);
;// ./node_modules/antd/es/form/hooks/useChildren.js

function useChildren(children) {
  if (typeof children === 'function') {
    return children;
  }
  const childList = (0,Children_toArray/* default */.A)(children);
  return childList.length <= 1 ? childList[0] : childList;
}
;// ./node_modules/antd/es/form/hooks/useFormItemStatus.js



const useFormItemStatus = () => {
  const {
    status,
    errors = [],
    warnings = []
  } = (0,react.useContext)(context/* FormItemInputContext */.$W);
  if (false) {}
  return {
    status,
    errors,
    warnings
  };
};
// Only used for compatible package. Not promise this will work on future version.
useFormItemStatus.Context = context/* FormItemInputContext */.$W;
/* harmony default export */ var hooks_useFormItemStatus = (useFormItemStatus);
// EXTERNAL MODULE: ./node_modules/rc-util/es/raf.js
var raf = __webpack_require__(25371);
;// ./node_modules/antd/es/form/hooks/useFrameState.js



function useFrameState(defaultValue) {
  const [value, setValue] = react.useState(defaultValue);
  const frameRef = (0,react.useRef)(null);
  const batchRef = (0,react.useRef)([]);
  const destroyRef = (0,react.useRef)(false);
  react.useEffect(() => {
    destroyRef.current = false;
    return () => {
      destroyRef.current = true;
      raf/* default */.A.cancel(frameRef.current);
      frameRef.current = null;
    };
  }, []);
  function setFrameValue(updater) {
    if (destroyRef.current) {
      return;
    }
    if (frameRef.current === null) {
      batchRef.current = [];
      frameRef.current = (0,raf/* default */.A)(() => {
        frameRef.current = null;
        setValue(prevValue => {
          let current = prevValue;
          batchRef.current.forEach(func => {
            current = func(current);
          });
          return current;
        });
      });
    }
    batchRef.current.push(updater);
  }
  return [value, setFrameValue];
}
;// ./node_modules/antd/es/form/hooks/useItemRef.js



function useItemRef() {
  const {
    itemRef
  } = react.useContext(context/* FormContext */.cK);
  const cacheRef = react.useRef({});
  function getRef(name, children) {
    // Outer caller already check the `supportRef`
    const childrenRef = children && typeof children === 'object' && (0,ref/* getNodeRef */.A9)(children);
    const nameStr = name.join('_');
    if (cacheRef.current.name !== nameStr || cacheRef.current.originRef !== childrenRef) {
      cacheRef.current.name = nameStr;
      cacheRef.current.originRef = childrenRef;
      cacheRef.current.ref = (0,ref/* composeRef */.K4)(itemRef(name), childrenRef);
    }
    return cacheRef.current.ref;
  }
  return getRef;
}
// EXTERNAL MODULE: ./node_modules/rc-util/es/Dom/isVisible.js
var isVisible = __webpack_require__(42467);
// EXTERNAL MODULE: ./node_modules/rc-util/es/hooks/useLayoutEffect.js
var useLayoutEffect = __webpack_require__(30981);
// EXTERNAL MODULE: ./node_modules/rc-util/es/omit.js
var omit = __webpack_require__(19853);
// EXTERNAL MODULE: ./node_modules/antd/es/grid/row.js
var row = __webpack_require__(74948);
// EXTERNAL MODULE: ./node_modules/rc-util/es/index.js
var rc_util_es = __webpack_require__(81470);
// EXTERNAL MODULE: ./node_modules/antd/es/grid/col.js
var col = __webpack_require__(26606);
;// ./node_modules/antd/es/form/style/fallbackCmp.js
/**
 * Fallback of IE.
 * Safe to remove.
 */
// Style as inline component


// ============================= Fallback =============================
const genFallbackStyle = token => {
  const {
    formItemCls
  } = token;
  return {
    '@media screen and (-ms-high-contrast: active), (-ms-high-contrast: none)': {
      // Fallback for IE, safe to remove we not support it anymore
      [`${formItemCls}-control`]: {
        display: 'flex'
      }
    }
  };
};
// ============================== Export ==============================
/* harmony default export */ var fallbackCmp = ((0,genStyleUtils/* genSubStyleComponent */.bf)(['Form', 'item-item'], (token, _ref) => {
  let {
    rootPrefixCls
  } = _ref;
  const formToken = prepareToken(token, rootPrefixCls);
  return [genFallbackStyle(formToken)];
}));
;// ./node_modules/antd/es/form/FormItemInput.js
"use client";

var FormItemInput_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};








const GRID_MAX = 24;
const FormItemInput = props => {
  const {
    prefixCls,
    status,
    labelCol,
    wrapperCol,
    children,
    errors,
    warnings,
    _internalItemRender: formItemRender,
    extra,
    help,
    fieldId,
    marginBottom,
    onErrorVisibleChanged,
    label
  } = props;
  const baseClassName = `${prefixCls}-item`;
  const formContext = react.useContext(context/* FormContext */.cK);
  const mergedWrapperCol = react.useMemo(() => {
    let mergedWrapper = Object.assign({}, wrapperCol || formContext.wrapperCol || {});
    if (label === null && !labelCol && !wrapperCol && formContext.labelCol) {
      const list = [undefined, 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
      list.forEach(size => {
        const _size = size ? [size] : [];
        const formLabel = (0,rc_util_es/* get */.Jt)(formContext.labelCol, _size);
        const formLabelObj = typeof formLabel === 'object' ? formLabel : {};
        const wrapper = (0,rc_util_es/* get */.Jt)(mergedWrapper, _size);
        const wrapperObj = typeof wrapper === 'object' ? wrapper : {};
        if ('span' in formLabelObj && !('offset' in wrapperObj) && formLabelObj.span < GRID_MAX) {
          mergedWrapper = (0,rc_util_es/* set */.hZ)(mergedWrapper, [].concat(_size, ['offset']), formLabelObj.span);
        }
      });
    }
    return mergedWrapper;
  }, [wrapperCol, formContext]);
  const className = classnames_default()(`${baseClassName}-control`, mergedWrapperCol.className);
  // Pass to sub FormItem should not with col info
  const subFormContext = react.useMemo(() => {
    const {
        labelCol,
        wrapperCol
      } = formContext,
      rest = FormItemInput_rest(formContext, ["labelCol", "wrapperCol"]);
    return rest;
  }, [formContext]);
  const extraRef = react.useRef(null);
  const [extraHeight, setExtraHeight] = react.useState(0);
  (0,useLayoutEffect/* default */.A)(() => {
    if (extra && extraRef.current) {
      setExtraHeight(extraRef.current.clientHeight);
    } else {
      setExtraHeight(0);
    }
  }, [extra]);
  const inputDom = /*#__PURE__*/react.createElement("div", {
    className: `${baseClassName}-control-input`
  }, /*#__PURE__*/react.createElement("div", {
    className: `${baseClassName}-control-input-content`
  }, children));
  const formItemContext = react.useMemo(() => ({
    prefixCls,
    status
  }), [prefixCls, status]);
  const errorListDom = marginBottom !== null || errors.length || warnings.length ? (/*#__PURE__*/react.createElement(context/* FormItemPrefixContext */.hb.Provider, {
    value: formItemContext
  }, /*#__PURE__*/react.createElement(form_ErrorList, {
    fieldId: fieldId,
    errors: errors,
    warnings: warnings,
    help: help,
    helpStatus: status,
    className: `${baseClassName}-explain-connected`,
    onVisibleChanged: onErrorVisibleChanged
  }))) : null;
  const extraProps = {};
  if (fieldId) {
    extraProps.id = `${fieldId}_extra`;
  }
  // If extra = 0, && will goes wrong
  // 0&&error -> 0
  const extraDom = extra ? (/*#__PURE__*/react.createElement("div", Object.assign({}, extraProps, {
    className: `${baseClassName}-extra`,
    ref: extraRef
  }), extra)) : null;
  const additionalDom = errorListDom || extraDom ? (/*#__PURE__*/react.createElement("div", {
    className: `${baseClassName}-additional`,
    style: marginBottom ? {
      minHeight: marginBottom + extraHeight
    } : {}
  }, errorListDom, extraDom)) : null;
  const dom = formItemRender && formItemRender.mark === 'pro_table_render' && formItemRender.render ? formItemRender.render(props, {
    input: inputDom,
    errorList: errorListDom,
    extra: extraDom
  }) : (/*#__PURE__*/react.createElement(react.Fragment, null, inputDom, additionalDom));
  return /*#__PURE__*/react.createElement(context/* FormContext */.cK.Provider, {
    value: subFormContext
  }, /*#__PURE__*/react.createElement(col/* default */.A, Object.assign({}, mergedWrapperCol, {
    className: className
  }), dom), /*#__PURE__*/react.createElement(fallbackCmp, {
    prefixCls: prefixCls
  }));
};
/* harmony default export */ var form_FormItemInput = (FormItemInput);
// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/extends.js
var esm_extends = __webpack_require__(58168);
;// ./node_modules/@ant-design/icons-svg/es/asn/QuestionCircleOutlined.js
// This icon file is generated automatically.
var QuestionCircleOutlined = { "icon": { "tag": "svg", "attrs": { "viewBox": "64 64 896 896", "focusable": "false" }, "children": [{ "tag": "path", "attrs": { "d": "M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z" } }, { "tag": "path", "attrs": { "d": "M623.6 316.7C593.6 290.4 554 276 512 276s-81.6 14.5-111.6 40.7C369.2 344 352 380.7 352 420v7.6c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V420c0-44.1 43.1-80 96-80s96 35.9 96 80c0 31.1-22 59.6-56.1 72.7-21.2 8.1-39.2 22.3-52.1 40.9-13.1 19-19.9 41.8-19.9 64.9V620c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8v-22.7a48.3 48.3 0 0130.9-44.8c59-22.7 97.1-74.7 97.1-132.5.1-39.3-17.1-76-48.3-103.3zM472 732a40 40 0 1080 0 40 40 0 10-80 0z" } }] }, "name": "question-circle", "theme": "outlined" };
/* harmony default export */ var asn_QuestionCircleOutlined = (QuestionCircleOutlined);

// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/components/AntdIcon.js + 3 modules
var AntdIcon = __webpack_require__(87064);
;// ./node_modules/@ant-design/icons/es/icons/QuestionCircleOutlined.js

// GENERATE BY ./scripts/generate.ts
// DON NOT EDIT IT MANUALLY




var QuestionCircleOutlined_QuestionCircleOutlined = function QuestionCircleOutlined(props, ref) {
  return /*#__PURE__*/react.createElement(AntdIcon/* default */.A, (0,esm_extends/* default */.A)({}, props, {
    ref: ref,
    icon: asn_QuestionCircleOutlined
  }));
};

/**![question-circle](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNjYWNhY2EiIHZpZXdCb3g9IjY0IDY0IDg5NiA4OTYiIGZvY3VzYWJsZT0iZmFsc2UiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTUxMiA2NEMyNjQuNiA2NCA2NCAyNjQuNiA2NCA1MTJzMjAwLjYgNDQ4IDQ0OCA0NDggNDQ4LTIwMC42IDQ0OC00NDhTNzU5LjQgNjQgNTEyIDY0em0wIDgyMGMtMjA1LjQgMC0zNzItMTY2LjYtMzcyLTM3MnMxNjYuNi0zNzIgMzcyLTM3MiAzNzIgMTY2LjYgMzcyIDM3Mi0xNjYuNiAzNzItMzcyIDM3MnoiIC8+PHBhdGggZD0iTTYyMy42IDMxNi43QzU5My42IDI5MC40IDU1NCAyNzYgNTEyIDI3NnMtODEuNiAxNC41LTExMS42IDQwLjdDMzY5LjIgMzQ0IDM1MiAzODAuNyAzNTIgNDIwdjcuNmMwIDQuNCAzLjYgOCA4IDhoNDhjNC40IDAgOC0zLjYgOC04VjQyMGMwLTQ0LjEgNDMuMS04MCA5Ni04MHM5NiAzNS45IDk2IDgwYzAgMzEuMS0yMiA1OS42LTU2LjEgNzIuNy0yMS4yIDguMS0zOS4yIDIyLjMtNTIuMSA0MC45LTEzLjEgMTktMTkuOSA0MS44LTE5LjkgNjQuOVY2MjBjMCA0LjQgMy42IDggOCA4aDQ4YzQuNCAwIDgtMy42IDgtOHYtMjIuN2E0OC4zIDQ4LjMgMCAwMTMwLjktNDQuOGM1OS0yMi43IDk3LjEtNzQuNyA5Ny4xLTEzMi41LjEtMzkuMy0xNy4xLTc2LTQ4LjMtMTAzLjN6TTQ3MiA3MzJhNDAgNDAgMCAxMDgwIDAgNDAgNDAgMCAxMC04MCAweiIgLz48L3N2Zz4=) */
var RefIcon = /*#__PURE__*/react.forwardRef(QuestionCircleOutlined_QuestionCircleOutlined);
if (false) {}
/* harmony default export */ var icons_QuestionCircleOutlined = (RefIcon);
// EXTERNAL MODULE: ./node_modules/antd/es/locale/useLocale.js
var useLocale = __webpack_require__(19155);
// EXTERNAL MODULE: ./node_modules/antd/es/locale/en_US.js + 5 modules
var en_US = __webpack_require__(80436);
// EXTERNAL MODULE: ./node_modules/antd/es/tooltip/index.js + 7 modules
var es_tooltip = __webpack_require__(40367);
;// ./node_modules/antd/es/form/FormItemLabel.js
"use client";

var FormItemLabel_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};








function toTooltipProps(tooltip) {
  if (!tooltip) {
    return null;
  }
  if (typeof tooltip === 'object' && ! /*#__PURE__*/react.isValidElement(tooltip)) {
    return tooltip;
  }
  return {
    title: tooltip
  };
}
const FormItemLabel = _ref => {
  let {
    prefixCls,
    label,
    htmlFor,
    labelCol,
    labelAlign,
    colon,
    required,
    requiredMark,
    tooltip,
    vertical
  } = _ref;
  var _a;
  const [formLocale] = (0,useLocale/* default */.A)('Form');
  const {
    labelAlign: contextLabelAlign,
    labelCol: contextLabelCol,
    labelWrap,
    colon: contextColon
  } = react.useContext(context/* FormContext */.cK);
  if (!label) {
    return null;
  }
  const mergedLabelCol = labelCol || contextLabelCol || {};
  const mergedLabelAlign = labelAlign || contextLabelAlign;
  const labelClsBasic = `${prefixCls}-item-label`;
  const labelColClassName = classnames_default()(labelClsBasic, mergedLabelAlign === 'left' && `${labelClsBasic}-left`, mergedLabelCol.className, {
    [`${labelClsBasic}-wrap`]: !!labelWrap
  });
  let labelChildren = label;
  // Keep label is original where there should have no colon
  const computedColon = colon === true || contextColon !== false && colon !== false;
  const haveColon = computedColon && !vertical;
  // Remove duplicated user input colon
  if (haveColon && typeof label === 'string' && label.trim()) {
    labelChildren = label.replace(/[:|：]\s*$/, '');
  }
  // Tooltip
  const tooltipProps = toTooltipProps(tooltip);
  if (tooltipProps) {
    const {
        icon = /*#__PURE__*/react.createElement(icons_QuestionCircleOutlined, null)
      } = tooltipProps,
      restTooltipProps = FormItemLabel_rest(tooltipProps, ["icon"]);
    const tooltipNode = /*#__PURE__*/react.createElement(es_tooltip/* default */.A, Object.assign({}, restTooltipProps), /*#__PURE__*/react.cloneElement(icon, {
      className: `${prefixCls}-item-tooltip`,
      title: '',
      onClick: e => {
        // Prevent label behavior in tooltip icon
        // https://github.com/ant-design/ant-design/issues/46154
        e.preventDefault();
      },
      tabIndex: null
    }));
    labelChildren = /*#__PURE__*/react.createElement(react.Fragment, null, labelChildren, tooltipNode);
  }
  // Required Mark
  const isOptionalMark = requiredMark === 'optional';
  const isRenderMark = typeof requiredMark === 'function';
  if (isRenderMark) {
    labelChildren = requiredMark(labelChildren, {
      required: !!required
    });
  } else if (isOptionalMark && !required) {
    labelChildren = /*#__PURE__*/react.createElement(react.Fragment, null, labelChildren, /*#__PURE__*/react.createElement("span", {
      className: `${prefixCls}-item-optional`,
      title: ""
    }, (formLocale === null || formLocale === void 0 ? void 0 : formLocale.optional) || ((_a = en_US/* default */.A.Form) === null || _a === void 0 ? void 0 : _a.optional)));
  }
  const labelClassName = classnames_default()({
    [`${prefixCls}-item-required`]: required,
    [`${prefixCls}-item-required-mark-optional`]: isOptionalMark || isRenderMark,
    [`${prefixCls}-item-no-colon`]: !computedColon
  });
  return /*#__PURE__*/react.createElement(col/* default */.A, Object.assign({}, mergedLabelCol, {
    className: labelColClassName
  }), /*#__PURE__*/react.createElement("label", {
    htmlFor: htmlFor,
    className: labelClassName,
    title: typeof label === 'string' ? label : ''
  }, labelChildren));
};
/* harmony default export */ var form_FormItemLabel = (FormItemLabel);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CheckCircleFilled.js + 1 modules
var CheckCircleFilled = __webpack_require__(38811);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/CloseCircleFilled.js + 1 modules
var CloseCircleFilled = __webpack_require__(36029);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/ExclamationCircleFilled.js + 1 modules
var ExclamationCircleFilled = __webpack_require__(7541);
// EXTERNAL MODULE: ./node_modules/@ant-design/icons/es/icons/LoadingOutlined.js + 1 modules
var LoadingOutlined = __webpack_require__(93567);
;// ./node_modules/antd/es/form/FormItem/StatusProvider.js
"use client";









const iconMap = {
  success: CheckCircleFilled/* default */.A,
  warning: ExclamationCircleFilled/* default */.A,
  error: CloseCircleFilled/* default */.A,
  validating: LoadingOutlined/* default */.A
};
function StatusProvider(_ref) {
  let {
    children,
    errors,
    warnings,
    hasFeedback,
    validateStatus,
    prefixCls,
    meta,
    noStyle
  } = _ref;
  const itemPrefixCls = `${prefixCls}-item`;
  const {
    feedbackIcons
  } = react.useContext(context/* FormContext */.cK);
  const mergedValidateStatus = getStatus(errors, warnings, meta, null, !!hasFeedback, validateStatus);
  const {
    isFormItemInput: parentIsFormItemInput,
    status: parentStatus,
    hasFeedback: parentHasFeedback,
    feedbackIcon: parentFeedbackIcon
  } = react.useContext(context/* FormItemInputContext */.$W);
  // ====================== Context =======================
  const formItemStatusContext = react.useMemo(() => {
    var _a;
    let feedbackIcon;
    if (hasFeedback) {
      const customIcons = hasFeedback !== true && hasFeedback.icons || feedbackIcons;
      const customIconNode = mergedValidateStatus && ((_a = customIcons === null || customIcons === void 0 ? void 0 : customIcons({
        status: mergedValidateStatus,
        errors,
        warnings
      })) === null || _a === void 0 ? void 0 : _a[mergedValidateStatus]);
      const IconNode = mergedValidateStatus && iconMap[mergedValidateStatus];
      feedbackIcon = customIconNode !== false && IconNode ? (/*#__PURE__*/react.createElement("span", {
        className: classnames_default()(`${itemPrefixCls}-feedback-icon`, `${itemPrefixCls}-feedback-icon-${mergedValidateStatus}`)
      }, customIconNode || /*#__PURE__*/react.createElement(IconNode, null))) : null;
    }
    const context = {
      status: mergedValidateStatus || '',
      errors,
      warnings,
      hasFeedback: !!hasFeedback,
      feedbackIcon,
      isFormItemInput: true
    };
    // No style will follow parent context
    if (noStyle) {
      context.status = (mergedValidateStatus !== null && mergedValidateStatus !== void 0 ? mergedValidateStatus : parentStatus) || '';
      context.isFormItemInput = parentIsFormItemInput;
      context.hasFeedback = !!(hasFeedback !== null && hasFeedback !== void 0 ? hasFeedback : parentHasFeedback);
      context.feedbackIcon = hasFeedback !== undefined ? context.feedbackIcon : parentFeedbackIcon;
    }
    return context;
  }, [mergedValidateStatus, hasFeedback, noStyle, parentIsFormItemInput, parentStatus]);
  // ======================= Render =======================
  return /*#__PURE__*/react.createElement(context/* FormItemInputContext */.$W.Provider, {
    value: formItemStatusContext
  }, children);
}
;// ./node_modules/antd/es/form/FormItem/ItemHolder.js
"use client";

var ItemHolder_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};












function ItemHolder(props) {
  const {
      prefixCls,
      className,
      rootClassName,
      style,
      help,
      errors,
      warnings,
      validateStatus,
      meta,
      hasFeedback,
      hidden,
      children,
      fieldId,
      required,
      isRequired,
      onSubItemMetaChange,
      layout
    } = props,
    restProps = ItemHolder_rest(props, ["prefixCls", "className", "rootClassName", "style", "help", "errors", "warnings", "validateStatus", "meta", "hasFeedback", "hidden", "children", "fieldId", "required", "isRequired", "onSubItemMetaChange", "layout"]);
  const itemPrefixCls = `${prefixCls}-item`;
  const {
    requiredMark,
    vertical: formVertical
  } = react.useContext(context/* FormContext */.cK);
  const vertical = formVertical || layout === 'vertical';
  // ======================== Margin ========================
  const itemRef = react.useRef(null);
  const debounceErrors = useDebounce(errors);
  const debounceWarnings = useDebounce(warnings);
  const hasHelp = help !== undefined && help !== null;
  const hasError = !!(hasHelp || errors.length || warnings.length);
  const isOnScreen = !!itemRef.current && (0,isVisible/* default */.A)(itemRef.current);
  const [marginBottom, setMarginBottom] = react.useState(null);
  (0,useLayoutEffect/* default */.A)(() => {
    if (hasError && itemRef.current) {
      // The element must be part of the DOMTree to use getComputedStyle
      // https://stackoverflow.com/questions/35360711/getcomputedstyle-returns-a-cssstyledeclaration-but-all-properties-are-empty-on-a
      const itemStyle = getComputedStyle(itemRef.current);
      setMarginBottom(parseInt(itemStyle.marginBottom, 10));
    }
  }, [hasError, isOnScreen]);
  const onErrorVisibleChanged = nextVisible => {
    if (!nextVisible) {
      setMarginBottom(null);
    }
  };
  // ======================== Status ========================
  const getValidateState = function () {
    let isDebounce = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
    const _errors = isDebounce ? debounceErrors : meta.errors;
    const _warnings = isDebounce ? debounceWarnings : meta.warnings;
    return getStatus(_errors, _warnings, meta, '', !!hasFeedback, validateStatus);
  };
  const mergedValidateStatus = getValidateState();
  // ======================== Render ========================
  const itemClassName = classnames_default()(itemPrefixCls, className, rootClassName, {
    [`${itemPrefixCls}-with-help`]: hasHelp || debounceErrors.length || debounceWarnings.length,
    // Status
    [`${itemPrefixCls}-has-feedback`]: mergedValidateStatus && hasFeedback,
    [`${itemPrefixCls}-has-success`]: mergedValidateStatus === 'success',
    [`${itemPrefixCls}-has-warning`]: mergedValidateStatus === 'warning',
    [`${itemPrefixCls}-has-error`]: mergedValidateStatus === 'error',
    [`${itemPrefixCls}-is-validating`]: mergedValidateStatus === 'validating',
    [`${itemPrefixCls}-hidden`]: hidden,
    // Layout
    [`${itemPrefixCls}-${layout}`]: layout
  });
  return /*#__PURE__*/react.createElement("div", {
    className: itemClassName,
    style: style,
    ref: itemRef
  }, /*#__PURE__*/react.createElement(row/* default */.A, Object.assign({
    className: `${itemPrefixCls}-row`
  }, (0,omit/* default */.A)(restProps, ['_internalItemRender', 'colon', 'dependencies', 'extra', 'fieldKey', 'getValueFromEvent', 'getValueProps', 'htmlFor', 'id',
  // It is deprecated because `htmlFor` is its replacement.
  'initialValue', 'isListField', 'label', 'labelAlign', 'labelCol', 'labelWrap', 'messageVariables', 'name', 'normalize', 'noStyle', 'preserve', 'requiredMark', 'rules', 'shouldUpdate', 'trigger', 'tooltip', 'validateFirst', 'validateTrigger', 'valuePropName', 'wrapperCol', 'validateDebounce'])), /*#__PURE__*/react.createElement(form_FormItemLabel, Object.assign({
    htmlFor: fieldId
  }, props, {
    requiredMark: requiredMark,
    required: required !== null && required !== void 0 ? required : isRequired,
    prefixCls: prefixCls,
    vertical: vertical
  })), /*#__PURE__*/react.createElement(form_FormItemInput, Object.assign({}, props, meta, {
    errors: debounceErrors,
    warnings: debounceWarnings,
    prefixCls: prefixCls,
    status: mergedValidateStatus,
    help: help,
    marginBottom: marginBottom,
    onErrorVisibleChanged: onErrorVisibleChanged
  }), /*#__PURE__*/react.createElement(context/* NoStyleItemContext */.jC.Provider, {
    value: onSubItemMetaChange
  }, /*#__PURE__*/react.createElement(StatusProvider, {
    prefixCls: prefixCls,
    meta: meta,
    errors: meta.errors,
    warnings: meta.warnings,
    hasFeedback: hasFeedback,
    // Already calculated
    validateStatus: mergedValidateStatus
  }, children)))), !!marginBottom && (/*#__PURE__*/react.createElement("div", {
    className: `${itemPrefixCls}-margin-offset`,
    style: {
      marginBottom: -marginBottom
    }
  })));
}
;// ./node_modules/antd/es/form/FormItem/index.js
"use client";




















const NAME_SPLIT = '__SPLIT__';
const _ValidateStatuses = (/* unused pure expression or super */ null && (['success', 'warning', 'error', 'validating', '']));
// https://github.com/ant-design/ant-design/issues/46417
// `getValueProps` may modify the value props name,
// we should check if the control is similar.
function isSimilarControl(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every(key => {
    const propValueA = a[key];
    const propValueB = b[key];
    return propValueA === propValueB || typeof propValueA === 'function' || typeof propValueB === 'function';
  });
}
const MemoInput = /*#__PURE__*/react.memo(_ref => {
  let {
    children
  } = _ref;
  return children;
}, (prev, next) => isSimilarControl(prev.control, next.control) && prev.update === next.update && prev.childProps.length === next.childProps.length && prev.childProps.every((value, index) => value === next.childProps[index]));
function genEmptyMeta() {
  return {
    errors: [],
    warnings: [],
    touched: false,
    validating: false,
    name: [],
    validated: false
  };
}
function InternalFormItem(props) {
  const {
    name,
    noStyle,
    className,
    dependencies,
    prefixCls: customizePrefixCls,
    shouldUpdate,
    rules,
    children,
    required,
    label,
    messageVariables,
    trigger = 'onChange',
    validateTrigger,
    hidden,
    help,
    layout
  } = props;
  const {
    getPrefixCls
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const {
    name: formName
  } = react.useContext(context/* FormContext */.cK);
  const mergedChildren = useChildren(children);
  const isRenderProps = typeof mergedChildren === 'function';
  const notifyParentMetaChange = react.useContext(context/* NoStyleItemContext */.jC);
  const {
    validateTrigger: contextValidateTrigger
  } = react.useContext(rc_field_form_es/* FieldContext */._z);
  const mergedValidateTrigger = validateTrigger !== undefined ? validateTrigger : contextValidateTrigger;
  const hasName = !(name === undefined || name === null);
  const prefixCls = getPrefixCls('form', customizePrefixCls);
  // Style
  const rootCls = (0,useCSSVarCls/* default */.A)(prefixCls);
  const [wrapCSSVar, hashId, cssVarCls] = form_style(prefixCls, rootCls);
  // ========================= Warn =========================
  const warning = (0,_util_warning/* devUseWarning */.rJ)('Form.Item');
  if (false) {}
  // ========================= MISC =========================
  // Get `noStyle` required info
  const listContext = react.useContext(rc_field_form_es/* ListContext */.EF);
  const fieldKeyPathRef = react.useRef();
  // ======================== Errors ========================
  // >>>>> Collect sub field errors
  const [subFieldErrors, setSubFieldErrors] = useFrameState({});
  // >>>>> Current field errors
  const [meta, setMeta] = (0,useState/* default */.A)(() => genEmptyMeta());
  const onMetaChange = nextMeta => {
    // This keyInfo is not correct when field is removed
    // Since origin keyManager no longer keep the origin key anymore
    // Which means we need cache origin one and reuse when removed
    const keyInfo = listContext === null || listContext === void 0 ? void 0 : listContext.getKey(nextMeta.name);
    // Destroy will reset all the meta
    setMeta(nextMeta.destroy ? genEmptyMeta() : nextMeta, true);
    // Bump to parent since noStyle
    if (noStyle && help !== false && notifyParentMetaChange) {
      let namePath = nextMeta.name;
      if (!nextMeta.destroy) {
        if (keyInfo !== undefined) {
          const [fieldKey, restPath] = keyInfo;
          namePath = [fieldKey].concat((0,toConsumableArray/* default */.A)(restPath));
          fieldKeyPathRef.current = namePath;
        }
      } else {
        // Use origin cache data
        namePath = fieldKeyPathRef.current || namePath;
      }
      notifyParentMetaChange(nextMeta, namePath);
    }
  };
  // >>>>> Collect noStyle Field error to the top FormItem
  const onSubItemMetaChange = (subMeta, uniqueKeys) => {
    // Only `noStyle` sub item will trigger
    setSubFieldErrors(prevSubFieldErrors => {
      const clone = Object.assign({}, prevSubFieldErrors);
      // name: ['user', 1] + key: [4] = ['user', 4]
      const mergedNamePath = [].concat((0,toConsumableArray/* default */.A)(subMeta.name.slice(0, -1)), (0,toConsumableArray/* default */.A)(uniqueKeys));
      const mergedNameKey = mergedNamePath.join(NAME_SPLIT);
      if (subMeta.destroy) {
        // Remove
        delete clone[mergedNameKey];
      } else {
        // Update
        clone[mergedNameKey] = subMeta;
      }
      return clone;
    });
  };
  // >>>>> Get merged errors
  const [mergedErrors, mergedWarnings] = react.useMemo(() => {
    const errorList = (0,toConsumableArray/* default */.A)(meta.errors);
    const warningList = (0,toConsumableArray/* default */.A)(meta.warnings);
    Object.values(subFieldErrors).forEach(subFieldError => {
      errorList.push.apply(errorList, (0,toConsumableArray/* default */.A)(subFieldError.errors || []));
      warningList.push.apply(warningList, (0,toConsumableArray/* default */.A)(subFieldError.warnings || []));
    });
    return [errorList, warningList];
  }, [subFieldErrors, meta.errors, meta.warnings]);
  // ===================== Children Ref =====================
  const getItemRef = useItemRef();
  // ======================== Render ========================
  function renderLayout(baseChildren, fieldId, isRequired) {
    if (noStyle && !hidden) {
      return /*#__PURE__*/react.createElement(StatusProvider, {
        prefixCls: prefixCls,
        hasFeedback: props.hasFeedback,
        validateStatus: props.validateStatus,
        meta: meta,
        errors: mergedErrors,
        warnings: mergedWarnings,
        noStyle: true
      }, baseChildren);
    }
    return /*#__PURE__*/react.createElement(ItemHolder, Object.assign({
      key: "row"
    }, props, {
      className: classnames_default()(className, cssVarCls, rootCls, hashId),
      prefixCls: prefixCls,
      fieldId: fieldId,
      isRequired: isRequired,
      errors: mergedErrors,
      warnings: mergedWarnings,
      meta: meta,
      onSubItemMetaChange: onSubItemMetaChange,
      layout: layout
    }), baseChildren);
  }
  if (!hasName && !isRenderProps && !dependencies) {
    return wrapCSSVar(renderLayout(mergedChildren));
  }
  let variables = {};
  if (typeof label === 'string') {
    variables.label = label;
  } else if (name) {
    variables.label = String(name);
  }
  if (messageVariables) {
    variables = Object.assign(Object.assign({}, variables), messageVariables);
  }
  // >>>>> With Field
  return wrapCSSVar(/*#__PURE__*/react.createElement(rc_field_form_es/* Field */.D0, Object.assign({}, props, {
    messageVariables: variables,
    trigger: trigger,
    validateTrigger: mergedValidateTrigger,
    onMetaChange: onMetaChange
  }), (control, renderMeta, context) => {
    const mergedName = toArray(name).length && renderMeta ? renderMeta.name : [];
    const fieldId = getFieldId(mergedName, formName);
    const isRequired = required !== undefined ? required : !!(rules === null || rules === void 0 ? void 0 : rules.some(rule => {
      if (rule && typeof rule === 'object' && rule.required && !rule.warningOnly) {
        return true;
      }
      if (typeof rule === 'function') {
        const ruleEntity = rule(context);
        return (ruleEntity === null || ruleEntity === void 0 ? void 0 : ruleEntity.required) && !(ruleEntity === null || ruleEntity === void 0 ? void 0 : ruleEntity.warningOnly);
      }
      return false;
    }));
    // ======================= Children =======================
    const mergedControl = Object.assign({}, control);
    let childNode = null;
     false ? 0 : void 0;
    if (Array.isArray(mergedChildren) && hasName) {
       false ? 0 : void 0;
      childNode = mergedChildren;
    } else if (isRenderProps && (!(shouldUpdate || dependencies) || hasName)) {
       false ? 0 : void 0;
       false ? 0 : void 0;
    } else if (dependencies && !isRenderProps && !hasName) {
       false ? 0 : void 0;
    } else if (/*#__PURE__*/react.isValidElement(mergedChildren)) {
       false ? 0 : void 0;
      const childProps = Object.assign(Object.assign({}, mergedChildren.props), mergedControl);
      if (!childProps.id) {
        childProps.id = fieldId;
      }
      if (help || mergedErrors.length > 0 || mergedWarnings.length > 0 || props.extra) {
        const describedbyArr = [];
        if (help || mergedErrors.length > 0) {
          describedbyArr.push(`${fieldId}_help`);
        }
        if (props.extra) {
          describedbyArr.push(`${fieldId}_extra`);
        }
        childProps['aria-describedby'] = describedbyArr.join(' ');
      }
      if (mergedErrors.length > 0) {
        childProps['aria-invalid'] = 'true';
      }
      if (isRequired) {
        childProps['aria-required'] = 'true';
      }
      if ((0,ref/* supportRef */.f3)(mergedChildren)) {
        childProps.ref = getItemRef(mergedName, mergedChildren);
      }
      // We should keep user origin event handler
      const triggers = new Set([].concat((0,toConsumableArray/* default */.A)(toArray(trigger)), (0,toConsumableArray/* default */.A)(toArray(mergedValidateTrigger))));
      triggers.forEach(eventName => {
        childProps[eventName] = function () {
          var _a2, _c2;
          var _a, _b, _c;
          for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
          }
          (_a = mergedControl[eventName]) === null || _a === void 0 ? void 0 : (_a2 = _a).call.apply(_a2, [mergedControl].concat(args));
          (_c = (_b = mergedChildren.props)[eventName]) === null || _c === void 0 ? void 0 : (_c2 = _c).call.apply(_c2, [_b].concat(args));
        };
      });
      // List of props that need to be watched for changes -> if changes are detected in MemoInput -> rerender
      const watchingChildProps = [childProps['aria-required'], childProps['aria-invalid'], childProps['aria-describedby']];
      childNode = /*#__PURE__*/react.createElement(MemoInput, {
        control: mergedControl,
        update: mergedChildren,
        childProps: watchingChildProps
      }, (0,reactNode/* cloneElement */.Ob)(mergedChildren, childProps));
    } else if (isRenderProps && (shouldUpdate || dependencies) && !hasName) {
      childNode = mergedChildren(context);
    } else {
       false ? 0 : void 0;
      childNode = mergedChildren;
    }
    return renderLayout(childNode, fieldId, isRequired);
  }));
}
const FormItem = InternalFormItem;
FormItem.useStatus = hooks_useFormItemStatus;
/* harmony default export */ var form_FormItem = (FormItem);
;// ./node_modules/antd/es/form/FormList.js
"use client";

var FormList_rest = undefined && undefined.__rest || function (s, e) {
  var t = {};
  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
    if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];
  }
  return t;
};





const FormList = _a => {
  var {
      prefixCls: customizePrefixCls,
      children
    } = _a,
    props = FormList_rest(_a, ["prefixCls", "children"]);
  if (false) {}
  const {
    getPrefixCls
  } = react.useContext(config_provider_context/* ConfigContext */.QO);
  const prefixCls = getPrefixCls('form', customizePrefixCls);
  const contextValue = react.useMemo(() => ({
    prefixCls,
    status: 'error'
  }), [prefixCls]);
  return /*#__PURE__*/react.createElement(rc_field_form_es/* List */.B8, Object.assign({}, props), (fields, operation, meta) => (/*#__PURE__*/react.createElement(context/* FormItemPrefixContext */.hb.Provider, {
    value: contextValue
  }, children(fields.map(field => Object.assign(Object.assign({}, field), {
    fieldKey: field.key
  })), operation, {
    errors: meta.errors,
    warnings: meta.warnings
  }))));
};
/* harmony default export */ var form_FormList = (FormList);
;// ./node_modules/antd/es/form/hooks/useFormInstance.js


function useFormInstance() {
  const {
    form
  } = (0,react.useContext)(context/* FormContext */.cK);
  return form;
}
;// ./node_modules/antd/es/form/index.js
"use client";








const es_form_Form = form_Form;
es_form_Form.Item = form_FormItem;
es_form_Form.List = form_FormList;
es_form_Form.ErrorList = form_ErrorList;
es_form_Form.useForm = useForm;
es_form_Form.useFormInstance = useFormInstance;
es_form_Form.useWatch = rc_field_form_es/* useWatch */.FH;
es_form_Form.Provider = context/* FormProvider */.Op;
es_form_Form.create = () => {
   false ? 0 : void 0;
};
/* harmony default export */ var es_form = (es_form_Form);

/***/ }),

/***/ 19378:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _babel_runtime_helpers_esm_toConsumableArray__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(60436);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(69036);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(74054);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(81917);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(48458);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(56914);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(10277);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(85319);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(29799);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_12__ = __webpack_require__(46789);
/* harmony import */ var _hooks_provider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(92744);
/* harmony import */ var _components_views_api__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(39614);





const CooperationManagementPage = () => {
  var _access$org4, _access$org5;
  const {
    user
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useContext)(_hooks_provider__WEBPACK_IMPORTED_MODULE_1__/* .appContext */ .v);
  const uid = (user === null || user === void 0 ? void 0 : user.email) || "";
  const [msgApi, holder] = antd__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .Ay.useMessage();
  const {
    0: access,
    1: setAccess
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
  const {
    0: orgs,
    1: setOrgs
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);
  const {
    0: selectedOrgId,
    1: setSelectedOrgId
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(null);
  const {
    0: members,
    1: setMembers
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);
  const {
    0: orgAgents,
    1: setOrgAgents
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);
  const {
    0: pending,
    1: setPending
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)([]);
  const {
    0: loading,
    1: setLoading
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
  const {
    0: createOpen,
    1: setCreateOpen
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
  const {
    0: memberOpen,
    1: setMemberOpen
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
  const {
    0: agentOpen,
    1: setAgentOpen
  } = (0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(false);
  const [createForm] = antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.useForm();
  const [memberForm] = antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.useForm();
  const [agentForm] = antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.useForm();
  const loadAccess = (0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async () => {
    if (!uid) return;
    try {
      const a = await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.getAccess(uid);
      setAccess(a);
    } catch (_unused) {
      setAccess({
        is_platform_admin: false,
        org: null
      });
    }
  }, [uid]);
  const loadOrgs = (0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async () => {
    if (!uid || !(access !== null && access !== void 0 && access.is_platform_admin)) return;
    setLoading(true);
    try {
      const list = await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.listOrgs(uid);
      setOrgs(list);
      setSelectedOrgId(prev => prev == null && list.length ? list[0].id : prev);
    } catch (e) {
      msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "加载合作组失败");
    } finally {
      setLoading(false);
    }
  }, [uid, access === null || access === void 0 ? void 0 : access.is_platform_admin, msgApi]);
  const loadDetail = (0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async () => {
    var _access$org, _access$org2;
    if (!uid || !selectedOrgId || !access) return;
    const can = access.is_platform_admin || ((_access$org = access.org) === null || _access$org === void 0 ? void 0 : _access$org.org_id) === selectedOrgId && ((_access$org2 = access.org) === null || _access$org2 === void 0 ? void 0 : _access$org2.is_org_admin);
    if (!can) return;
    setLoading(true);
    try {
      const [m, a] = await Promise.all([_components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.listMembers(uid, selectedOrgId), _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.listOrgAgents(selectedOrgId)]);
      setMembers(m);
      setOrgAgents(a);
    } catch (e) {
      msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "加载详情失败");
    } finally {
      setLoading(false);
    }
  }, [uid, selectedOrgId, access, msgApi]);
  const loadPending = (0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(async () => {
    if (!uid || !(access !== null && access !== void 0 && access.is_platform_admin)) return;
    try {
      const p = await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.plazaPending(uid);
      setPending(p);
    } catch (_unused2) {
      setPending([]);
    }
  }, [uid, access === null || access === void 0 ? void 0 : access.is_platform_admin]);
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    void loadAccess();
  }, [loadAccess]);
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    if (access !== null && access !== void 0 && access.is_platform_admin) void loadOrgs();
  }, [access === null || access === void 0 ? void 0 : access.is_platform_admin, loadOrgs]);
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    var _access$org3;
    if (access !== null && access !== void 0 && (_access$org3 = access.org) !== null && _access$org3 !== void 0 && _access$org3.is_org_admin && !(access !== null && access !== void 0 && access.is_platform_admin) && access.org.org_id) {
      setSelectedOrgId(access.org.org_id);
    }
  }, [access]);
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    void loadDetail();
  }, [loadDetail]);
  (0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)(() => {
    void loadPending();
  }, [loadPending]);
  const orgOptions = (0,react__WEBPACK_IMPORTED_MODULE_0__.useMemo)(() => orgs.map(o => ({
    label: (o.display_name || o.slug) + " (" + o.slug + ")",
    value: o.id
  })), [orgs]);
  const onCreateOrg = async () => {
    try {
      const v = await createForm.validateFields();
      await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.createOrg(uid, {
        slug: String(v.slug).trim().toLowerCase(),
        display_name: v.display_name || ""
      });
      msgApi.success("已创建合作组");
      setCreateOpen(false);
      createForm.resetFields();
      await loadOrgs();
    } catch (e) {
      if (e !== null && e !== void 0 && e.errorFields) return;
      msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "创建失败");
    }
  };
  const onAddMember = async () => {
    if (!selectedOrgId) return;
    try {
      const v = await memberForm.validateFields();
      await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.addMember(uid, selectedOrgId, v.user_id.trim(), v.role || "member");
      msgApi.success("已添加成员");
      setMemberOpen(false);
      memberForm.resetFields();
      await loadDetail();
    } catch (e) {
      if (e !== null && e !== void 0 && e.errorFields) return;
      msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "添加失败");
    }
  };
  const onSaveOrgAgent = async () => {
    if (!selectedOrgId) return;
    try {
      const v = await agentForm.validateFields();
      const raw = v.snapshot_json.trim();
      let snapshot;
      try {
        snapshot = JSON.parse(raw);
      } catch (_unused3) {
        msgApi.error("snapshot 需为合法 JSON");
        return;
      }
      const agentId = String(v.agent_id || snapshot.id || "").trim();
      if (!agentId) {
        msgApi.error("请填写 agent_id 或在 JSON 内提供 id");
        return;
      }
      snapshot.id = agentId;
      await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.upsertOrgAgent(uid, selectedOrgId, agentId, snapshot);
      msgApi.success("已保存组内智能体");
      setAgentOpen(false);
      agentForm.resetFields();
      await loadDetail();
    } catch (e) {
      if (e !== null && e !== void 0 && e.errorFields) return;
      msgApi.error((e === null || e === void 0 ? void 0 : e.message) || "保存失败");
    }
  };
  const orgColumns = [{
    title: "ID",
    dataIndex: "id",
    width: 72
  }, {
    title: "标识",
    dataIndex: "slug",
    render: s => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "font-mono text-xs"
    }, s)
  }, {
    title: "名称",
    dataIndex: "display_name"
  }, {
    title: "默认智能体",
    dataIndex: "default_agent_id",
    render: x => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "font-mono text-xs"
    }, x || "-")
  }, {
    title: "操作",
    key: "act",
    width: 100,
    render: (_, r) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .Ay, {
      type: "link",
      danger: true,
      size: "small",
      onClick: async () => {
        antd__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A.confirm({
          title: "删除合作组？",
          content: "将级联删除成员与组内智能体配置。",
          onOk: async () => {
            await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.deleteOrg(uid, r.id);
            msgApi.success("已删除");
            if (selectedOrgId === r.id) setSelectedOrgId(null);
            await loadOrgs();
          }
        });
      }
    }, "\u5220\u9664")
  }];
  const memberColumns = [{
    title: "用户",
    dataIndex: "user_id",
    render: x => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "font-mono text-xs"
    }, x)
  }, {
    title: "角色",
    dataIndex: "role",
    width: 120,
    render: r => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_7__/* ["default"] */ .A, null, r)
  }, {
    title: "操作",
    key: "rm",
    width: 100,
    render: (_, r) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .Ay, {
      type: "link",
      danger: true,
      size: "small",
      onClick: async () => {
        if (!selectedOrgId) return;
        await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.removeMember(uid, selectedOrgId, r.user_id);
        msgApi.success("已移除");
        await loadDetail();
      }
    }, "\u79FB\u9664")
  }];
  const agentColumns = [{
    title: "agent_id",
    dataIndex: "agent_id",
    render: x => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "font-mono text-xs"
    }, x)
  }, {
    title: "名称",
    render: (_, r) => {
      var _r$snapshot;
      return ((_r$snapshot = r.snapshot) === null || _r$snapshot === void 0 ? void 0 : _r$snapshot.name) || "-";
    }
  }, {
    title: "操作",
    key: "da",
    width: 100,
    render: (_, r) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .Ay, {
      type: "link",
      danger: true,
      size: "small",
      onClick: async () => {
        if (!selectedOrgId) return;
        await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.deleteOrgAgent(uid, selectedOrgId, r.agent_id);
        msgApi.success("已删除");
        await loadDetail();
      }
    }, "\u5220\u9664")
  }];
  const pendingColumns = [{
    title: "申请人",
    dataIndex: "applicant_user_id",
    render: x => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "font-mono text-xs"
    }, x)
  }, {
    title: "目标组",
    dataIndex: "target_org_id",
    width: 88
  }, {
    title: "智能体",
    dataIndex: "requested_agent_id",
    render: x => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "font-mono text-xs"
    }, x)
  }, {
    title: "操作",
    key: "ap",
    width: 160,
    render: (_, r) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "flex gap-1"
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .Ay, {
      type: "primary",
      size: "small",
      onClick: async () => {
        await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.plazaApprove(uid, r.uuid);
        msgApi.success("已通过");
        await loadPending();
      }
    }, "\u901A\u8FC7"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .Ay, {
      size: "small",
      onClick: async () => {
        await _components_views_api__WEBPACK_IMPORTED_MODULE_2__/* .organizationsAPI */ .PB.plazaReject(uid, r.uuid);
        msgApi.info("已驳回");
        await loadPending();
      }
    }, "\u9A73\u56DE"))
  }];
  const canManageSelected = (access === null || access === void 0 ? void 0 : access.is_platform_admin) || (access === null || access === void 0 ? void 0 : (_access$org4 = access.org) === null || _access$org4 === void 0 ? void 0 : _access$org4.org_id) === selectedOrgId && (access === null || access === void 0 ? void 0 : (_access$org5 = access.org) === null || _access$org5 === void 0 ? void 0 : _access$org5.is_org_admin);
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "h-full min-h-0 flex flex-col p-4 overflow-auto"
  }, holder, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-base font-semibold text-primary mb-1"
  }, "\u5408\u4F5C\u7EC4\u7BA1\u7406"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-xs text-secondary mb-4"
  }, "\u5E73\u53F0\u7BA1\u7406\u5458\u53EF\u521B\u5EFA\u5408\u4F5C\u7EC4\u3001\u5BA1\u6279\u5E7F\u573A\u8DE8\u7EC4\u7533\u8BF7\uFF1B\u7EC4\u7BA1\u7406\u5458\u53EF\u7EF4\u62A4\u672C\u7EC4\u6210\u5458\u4E0E\u7EC4\u5185\u667A\u80FD\u4F53\u767D\u540D\u5355\u3002"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_8__/* ["default"] */ .A, {
    items: [{
      key: "mine",
      label: "我的合作组",
      children: /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
        className: "max-w-xl text-sm"
      }, access == null ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
        className: "text-secondary"
      }, "\u52A0\u8F7D\u4E2D\u2026") : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("pre", {
        className: "bg-tertiary/30 rounded-lg p-3 text-xs overflow-auto"
      }, JSON.stringify(access.org ? Object.assign({}, access.org, {
        is_platform_admin: access.is_platform_admin
      }) : {
        message: "未加入合作组",
        is_platform_admin: access.is_platform_admin
      }, null, 2)))
    }].concat((0,_babel_runtime_helpers_esm_toConsumableArray__WEBPACK_IMPORTED_MODULE_9__/* ["default"] */ .A)(access !== null && access !== void 0 && access.is_platform_admin ? [{
      key: "orgs",
      label: "全部合作组",
      children: /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
        className: "space-y-3"
      }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
        className: "flex gap-2"
      }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .Ay, {
        type: "primary",
        onClick: () => setCreateOpen(true)
      }, "\u65B0\u5EFA\u5408\u4F5C\u7EC4"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_10__/* ["default"] */ .A, {
        className: "min-w-[220px]",
        placeholder: "\u9009\u62E9\u8981\u7F16\u8F91\u7684\u5408\u4F5C\u7EC4",
        options: orgOptions,
        value: selectedOrgId !== null && selectedOrgId !== void 0 ? selectedOrgId : undefined,
        onChange: v => setSelectedOrgId(v),
        allowClear: true
      })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_11__/* ["default"] */ .A, {
        size: "small",
        rowKey: "id",
        loading: loading,
        columns: orgColumns,
        dataSource: orgs,
        pagination: false
      }))
    }, {
      key: "pending",
      label: "广场申请",
      children: /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_11__/* ["default"] */ .A, {
        size: "small",
        rowKey: "uuid",
        columns: pendingColumns,
        dataSource: pending,
        pagination: false
      })
    }] : []), (0,_babel_runtime_helpers_esm_toConsumableArray__WEBPACK_IMPORTED_MODULE_9__/* ["default"] */ .A)(canManageSelected && selectedOrgId ? [{
      key: "detail",
      label: "成员与组内智能体",
      children: /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
        className: "space-y-4"
      }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
        className: "flex gap-2"
      }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .Ay, {
        onClick: () => setMemberOpen(true)
      }, "\u6DFB\u52A0\u6210\u5458"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_5__/* ["default"] */ .Ay, {
        onClick: () => setAgentOpen(true)
      }, "\u6DFB\u52A0\u7EC4\u5185\u667A\u80FD\u4F53")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
        className: "text-sm font-medium mb-2"
      }, "\u6210\u5458"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_11__/* ["default"] */ .A, {
        size: "small",
        rowKey: r => r.user_id + "-" + r.org_id,
        columns: memberColumns,
        dataSource: members,
        pagination: false
      })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
        className: "text-sm font-medium mb-2"
      }, "\u7EC4\u5185\u667A\u80FD\u4F53\uFF08\u767D\u540D\u5355\uFF09"), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_11__/* ["default"] */ .A, {
        size: "small",
        rowKey: "agent_id",
        columns: agentColumns,
        dataSource: orgAgents,
        pagination: false
      })))
    }] : []))
  }), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A, {
    title: "\u65B0\u5EFA\u5408\u4F5C\u7EC4",
    open: createOpen,
    onOk: onCreateOrg,
    onCancel: () => setCreateOpen(false)
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
    form: createForm,
    layout: "vertical"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.Item, {
    name: "slug",
    label: "\u6807\u8BC6 slug",
    rules: [{
      required: true,
      message: "必填"
    }]
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_12__/* ["default"] */ .A, {
    placeholder: "\u4F8B\u5982 drsai"
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.Item, {
    name: "display_name",
    label: "\u663E\u793A\u540D\u79F0"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_12__/* ["default"] */ .A, {
    placeholder: "\u663E\u793A\u540D\u79F0"
  })))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A, {
    title: "\u6DFB\u52A0\u6210\u5458",
    open: memberOpen,
    onOk: onAddMember,
    onCancel: () => setMemberOpen(false)
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
    form: memberForm,
    layout: "vertical"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.Item, {
    name: "user_id",
    label: "\u7528\u6237\u90AE\u7BB1 user_id",
    rules: [{
      required: true
    }]
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_12__/* ["default"] */ .A, {
    placeholder: "user@example.com"
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.Item, {
    name: "role",
    label: "\u89D2\u8272",
    initialValue: "member"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_10__/* ["default"] */ .A, {
    options: [{
      value: "member",
      label: "member"
    }, {
      value: "org_admin",
      label: "org_admin"
    }]
  })))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_6__/* ["default"] */ .A, {
    title: "\u6DFB\u52A0\u7EC4\u5185\u667A\u80FD\u4F53",
    open: agentOpen,
    onOk: onSaveOrgAgent,
    onCancel: () => setAgentOpen(false),
    width: 640
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A, {
    form: agentForm,
    layout: "vertical"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.Item, {
    name: "agent_id",
    label: "agent_id\uFF08\u53EF\u4E0E JSON \u5185 id \u4E00\u81F4\uFF09",
    rules: [{
      required: false
    }]
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_12__/* ["default"] */ .A, {
    placeholder: "UUID \u6216\u552F\u4E00 id"
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_4__/* ["default"] */ .A.Item, {
    name: "snapshot_json",
    label: "snapshot\uFF08\u5B8C\u6574\u667A\u80FD\u4F53 JSON\uFF0C\u4E0E\u4FA7\u8FB9\u680F\u6761\u76EE\u4E00\u81F4\uFF09",
    rules: [{
      required: true,
      message: "必填"
    }]
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_12__/* ["default"] */ .A.TextArea, {
    rows: 10,
    placeholder: "{\"id\":\"...\",\"mode\":\"magentic-one\",\"name\":\"...\"}"
  })))));
};
/* harmony default export */ __webpack_exports__["default"] = (CooperationManagementPage);

/***/ })

}]);
//# sourceMappingURL=9fad982499e7c56d6ce304906c1fc61f3493761c-355f219ceb7db4afd14c.js.map