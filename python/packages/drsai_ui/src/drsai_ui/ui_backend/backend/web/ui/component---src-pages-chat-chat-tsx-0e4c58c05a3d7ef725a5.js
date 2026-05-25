"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[8792],{

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
//# sourceMappingURL=component---src-pages-chat-chat-tsx-0e4c58c05a3d7ef725a5.js.map