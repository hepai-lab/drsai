"use strict";
(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[3567,5179],{

/***/ 34788:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": function() { return /* binding */ WelcomeScreen; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var _chat_chatinput__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(71127);
/* harmony import */ var _sampletasks__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(84152);



function WelcomeScreen(_ref) {
  let {
    currentRun,
    sessionId,
    error,
    isPlanMessage,
    chatInputRef,
    onSubmit,
    onCancel,
    onPause,
    onExecutePlan,
    serverFilesPrefill
  } = _ref;
  const [hasInputValue, setHasInputValue] = react__WEBPACK_IMPORTED_MODULE_0__.useState(false);
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-center w-full mx-auto px-2 sm:px-3 md:px-4"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "animate-fade-in text-center mb-10"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("h1", {
    className: "leading-tight"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
    className: "block text-5xl font-extrabold bg-gradient-to-br from-violet-500 via-purple-500 to-blue-500 bg-clip-text text-transparent",
    style: {
      letterSpacing: "-0.02em"
    }
  }, "Dr.Sai")), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("p", {
    className: "text-base text-secondary animate-slide-up max-w-sm mx-auto leading-relaxed",
    style: {
      animationDelay: "0.15s"
    }
  }, "\u8F93\u5165\u6D88\u606F\u5F00\u59CB\u5BF9\u8BDD\uFF0C\u6216\u4ECE\u4E0B\u65B9\u9009\u62E9\u793A\u4F8B\u4EFB\u52A1"))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-full space-y-6"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_chat_chatinput__WEBPACK_IMPORTED_MODULE_1__["default"], {
    ref: chatInputRef,
    onSubmit: function (query, files, accepted, plan, llm) {
      if (accepted === void 0) {
        accepted = false;
      }
      onSubmit(query, files, accepted, plan, llm);
    },
    error: error,
    onCancel: onCancel,
    runStatus: currentRun === null || currentRun === void 0 ? void 0 : currentRun.status,
    inputRequest: currentRun === null || currentRun === void 0 ? void 0 : currentRun.input_request,
    isPlanMessage: isPlanMessage,
    onPause: onPause,
    enable_upload: true,
    onExecutePlan: onExecutePlan,
    sessionId: sessionId,
    onTextChange: text => {
      setHasInputValue(text.trim().length > 0);
    },
    serverFilesPrefill: serverFilesPrefill
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(_sampletasks__WEBPACK_IMPORTED_MODULE_2__["default"], {
    hasInputValue: hasInputValue,
    onSelect: task => {
      setTimeout(() => {
        if (chatInputRef.current) {
          chatInputRef.current.setValue(task);
        }
      }, 200);
    }
  }));
}

/***/ }),

/***/ 7654:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ ChatView; }
});

// EXTERNAL MODULE: ./node_modules/@babel/runtime/helpers/esm/toConsumableArray.js + 2 modules
var toConsumableArray = __webpack_require__(60436);
// EXTERNAL MODULE: ./node_modules/antd/es/message/index.js + 4 modules
var message = __webpack_require__(69036);
// EXTERNAL MODULE: ./node_modules/react/index.js
var react = __webpack_require__(96540);
// EXTERNAL MODULE: ./src/hooks/provider.tsx
var provider = __webpack_require__(92744);
// EXTERNAL MODULE: ./node_modules/core-js/modules/es.object.from-entries.js
var es_object_from_entries = __webpack_require__(53921);
// EXTERNAL MODULE: ./node_modules/zustand/esm/react.mjs + 1 modules
var esm_react = __webpack_require__(71511);
// EXTERNAL MODULE: ./node_modules/zustand/esm/middleware.mjs
var middleware = __webpack_require__(87134);
// EXTERNAL MODULE: ./src/utils/storageUtils.ts
var storageUtils = __webpack_require__(73268);
;// ./src/store/messageCache.tsx
// 在模块加载时检查存储使用情况
(0,storageUtils/* checkAndCleanStorage */.cg)();// 辅助函数：清理消息内容以减少存储大小
const cleanMessageForStorage=message=>{const cleanedMessage=Object.assign({},message);// 如果消息内容过长，截断保留前1000字符
// if (typeof cleanedMessage.config.content === 'string' && cleanedMessage.config.content.length > 1000) {
//   cleanedMessage.config.content = cleanedMessage.config.content.substring(0, 1000) + '...[truncated]';
// }
// 保留 attached_files 在 metadata 中，因为需要显示附件列表
// 清理其他不必要的metadata（如果需要的话，可以在这里添加）
// if (cleanedMessage.config.metadata) {
//   const { attached_files, ...essentialMetadata } = cleanedMessage.config.metadata;
//   cleanedMessage.config.metadata = essentialMetadata;
// }
return cleanedMessage;};// 辅助函数：清理Run对象以减少存储大小
const cleanRunForStorage=run=>{const cleanedRun=Object.assign({},run);// 只保留最近50条消息
if(cleanedRun.messages.length>50){cleanedRun.messages=cleanedRun.messages.slice(-50);}// 清理每条消息
cleanedRun.messages=cleanedRun.messages.map(cleanMessageForStorage);return cleanedRun;};const useMessageCacheStore=(0,esm_react/* create */.v)()((0,middleware/* persist */.Zr)((set,get)=>({sessionRuns:{},setSessionRun:(sessionId,run)=>{try{const cleanedRun=cleanRunForStorage(run);set(state=>{// 限制缓存的会话数量，只保留最近的5个会话
const sessionIds=Object.keys(state.sessionRuns).map(Number);const newSessionRuns=Object.assign({},state.sessionRuns);if(sessionIds.length>=5&&!newSessionRuns[sessionId]){// 删除最旧的会话
const oldestSessionId=Math.min.apply(Math,(0,toConsumableArray/* default */.A)(sessionIds));delete newSessionRuns[oldestSessionId];}return{sessionRuns:Object.assign({},newSessionRuns,{[sessionId]:cleanedRun})};});}catch(error){console.warn('Failed to cache session run, clearing cache:',error);// 如果存储失败，清除缓存
set({sessionRuns:{}});}},getSessionRun:sessionId=>{const state=get();return state.sessionRuns[sessionId]||null;},updateSessionMessages:(sessionId,messages)=>{try{set(state=>{const existingRun=state.sessionRuns[sessionId];if(!existingRun)return state;// 限制消息数量并清理
const cleanedMessages=messages.slice(-50).map(cleanMessageForStorage);return{sessionRuns:Object.assign({},state.sessionRuns,{[sessionId]:Object.assign({},existingRun,{messages:cleanedMessages})})};});}catch(error){console.warn('Failed to update session messages:',error);}},addMessageToSession:(sessionId,message)=>{try{set(state=>{const existingRun=state.sessionRuns[sessionId];if(!existingRun)return state;const cleanedMessage=cleanMessageForStorage(message);let updatedMessages=[].concat((0,toConsumableArray/* default */.A)(existingRun.messages),[cleanedMessage]);// 限制消息数量
if(updatedMessages.length>50){updatedMessages=updatedMessages.slice(-50);}return{sessionRuns:Object.assign({},state.sessionRuns,{[sessionId]:Object.assign({},existingRun,{messages:updatedMessages})})};});}catch(error){console.warn('Failed to add message to session:',error);}},updateMessageInSession:(sessionId,messageIndex,message)=>{set(state=>{const existingRun=state.sessionRuns[sessionId];if(!existingRun||messageIndex>=existingRun.messages.length)return state;const updatedMessages=(0,toConsumableArray/* default */.A)(existingRun.messages);updatedMessages[messageIndex]=message;return{sessionRuns:Object.assign({},state.sessionRuns,{[sessionId]:Object.assign({},existingRun,{messages:updatedMessages})})};});},clearSessionCache:sessionId=>{set(state=>{const newSessionRuns=Object.assign({},state.sessionRuns);delete newSessionRuns[sessionId];return{sessionRuns:newSessionRuns};});},clearAllCache:()=>{set({sessionRuns:{}});}}),{name:'drsai-message-cache',// 只持久化必要的数据，避免存储过大
partialize:state=>({sessionRuns:Object.fromEntries(Object.entries(state.sessionRuns).slice(-3)// 只保留最近3个会话的缓存
.map(_ref=>{let[sessionId,run]=_ref;return[sessionId,cleanRunForStorage(run)];}))}),// 添加存储错误处理
onRehydrateStorage:()=>(_state,error)=>{if(error){console.warn('Failed to rehydrate message cache:',error);// 清除损坏的缓存
localStorage.removeItem('drsai-message-cache');}}}));
// EXTERNAL MODULE: ./src/components/store.tsx
var store = __webpack_require__(32134);
// EXTERNAL MODULE: ./src/components/views/api.ts
var api = __webpack_require__(39614);
;// ./src/pages/chat/config/agentConfigs.ts
/**
 * Agent Panel 配置接口
 * 定义了每个 agent 可以显示的侧边面板的配置
 *//**
 * Agent 配置接口
 *//**
 * Agent 类型枚举
 * 根据实际的 agent 类型来定义
 *//**
 * Agent 配置映射表
 */const AGENT_CONFIGS={// Magentic One - 使用 VNC 浏览器预览
'magentic-one':{name:'magentic-one',displayName:'Magentic One',panel:{type:'vnc',title:'Browser Preview',defaultMinimized:true,isMinimizable:true,componentName:'VNCViewer'}},// BESIII - 使用自定义分析面板（待开发）
'besiii':{name:'besiii',displayName:'BESIII Agent',panel:{type:'besiii',title:'BESIII Analysis Panel',defaultMinimized:false,isMinimizable:true,componentName:'BESIIIPanel'}},// 默认配置 - 无面板
'default':{name:'default',displayName:'Default Agent',panel:{type:'none',title:'',defaultMinimized:true,isMinimizable:false}}};/**
 * 获取 Agent 配置
 * 
 * 这个函数支持灵活的 agent 类型匹配：
 * - 精确匹配：'magentic-one', 'besiii', 'default'
 * - 模糊匹配：包含关键词的字符串
 * - 大小写不敏感
 * 
 * @param agentType Agent 类型标识，可以从以下来源获取：
 *   - run.task.metadata.agent_type
 *   - session.agent_mode_config.agent_type
 *   - session.agent_mode_config.type
 * @returns Agent 配置对象
 * 
 * @example
 * getAgentConfig('magentic-one') // 返回 magentic-one 配置
 * getAgentConfig('MagenticOneAgent') // 模糊匹配，返回 magentic-one 配置
 * getAgentConfig('BESIII_Analyzer') // 模糊匹配，返回 besiii 配置
 * getAgentConfig(null) // 返回 default 配置
 */function getAgentConfig(agentType){// 如果没有指定类型，返回默认配置
if(!agentType){return AGENT_CONFIGS.default;}// 尝试精确匹配
if(agentType in AGENT_CONFIGS){return AGENT_CONFIGS[agentType];}// 尝试模糊匹配已知的 agent 类型
const normalizedType=agentType.toLowerCase().trim();// Magentic One agent - 用于浏览器自动化
// 匹配: 'magentic', 'magnetic', 'magneticone' 等
if(normalizedType.includes('magentic')||normalizedType.includes('magnetic')){return AGENT_CONFIGS['magentic-one'];}// BESIII agent - 用于物理分析
// 匹配: 'besiii', 'bes3', 'bes-iii' 等
if(normalizedType.includes('besiii')||normalizedType.includes('bes3')||normalizedType.includes('bes-iii')){return AGENT_CONFIGS.besiii;}// 未匹配到任何已知类型，返回默认配置
return AGENT_CONFIGS.default;}/**
 * 判断 agent 是否需要显示面板
 * @param agentType Agent 类型标识
 * @returns 是否需要显示面板
 */function shouldShowPanel(agentType){const config=getAgentConfig(agentType);return config.panel.type!=='none';}/**
 * 获取面板的初始最小化状态
 * @param agentType Agent 类型标识
 * @returns 是否默认最小化
 */function getPanelDefaultMinimized(agentType){const config=getAgentConfig(agentType);return config.panel.defaultMinimized;}
;// ./src/utils/chatHelpers.ts
/**
 * Create a Message object from AgentMessageConfig
 */const createMessage=(config,runId,sessionId,userEmail)=>({created_at:new Date().toISOString(),updated_at:new Date().toISOString(),config,session_id:sessionId,run_id:runId,user_id:userEmail||undefined});
;// ./src/pages/chat/hooks/useChatWebSocket.ts
const useChatWebSocket=_ref=>{let{session,getSessionSocket,setCurrentRun,setSessionRun,userEmail}=_ref;const[activeSocket,setActiveSocket]=react.useState(null);const activeSocketRef=react.useRef(null);const inputTimeoutRef=react.useRef(null);const streamingMessageRef=react.useRef(null);const cacheSessionRun=react.useCallback((sessionId,run)=>{if(!setSessionRun)return;try{setSessionRun(sessionId,run);}catch(error){console.warn("Failed to cache message:",error);}},[setSessionRun]);const handleWebSocketMessage=react.useCallback(wsMessage=>{setCurrentRun(current=>{var _logData$send_level;if(!current||!(session!==null&&session!==void 0&&session.id))return null;let updatedRun=null;switch(wsMessage.type){case"error":if(inputTimeoutRef.current){clearTimeout(inputTimeoutRef.current);inputTimeoutRef.current=null;}if(activeSocket){activeSocket.close();setActiveSocket(null);activeSocketRef.current=null;}return current;case"message":if(!wsMessage.data)return current;const messageData=wsMessage.data;// Always add user messages, and non-user messages that passed deduplication
const newMessage=createMessage(messageData,current.id,session.id,userEmail);updatedRun=Object.assign({},current,{messages:[].concat((0,toConsumableArray/* default */.A)(current.messages),[newMessage])});cacheSessionRun(session.id,updatedRun);return updatedRun;case"message_task":if(!wsMessage.data)return current;const taskData=wsMessage.data;updatedRun=Object.assign({},current,{task:taskData});cacheSessionRun(session.id,updatedRun);return updatedRun;case"message_chunk":if(!wsMessage.data)return current;const chunkData=wsMessage.data;if(chunkData.content&&typeof chunkData.content==="string"){const processedContent=chunkData.content;const lastMsgIndex=current.messages.length-1;const chunkSource=typeof chunkData.source==="string"?chunkData.source:"assistant";const sanitizedChunkMetadata=chunkData.metadata&&typeof chunkData.metadata==="object"?Object.assign({},chunkData.metadata):undefined;const rawStartFlag=sanitizedChunkMetadata===null||sanitizedChunkMetadata===void 0?void 0:sanitizedChunkMetadata.start_flag;const startFlagValue=typeof rawStartFlag==="string"?rawStartFlag:undefined;const isStartChunk=(startFlagValue===null||startFlagValue===void 0?void 0:startFlagValue.toLowerCase())==="yes";if(isStartChunk){const newChunkMessage=createMessage({source:chunkSource,content:processedContent,metadata:Object.assign({},sanitizedChunkMetadata||{},{start_flag:startFlagValue,stream_source_label:chunkSource})},current.id,session.id,userEmail);streamingMessageRef.current={source:chunkSource,content:processedContent};updatedRun=Object.assign({},current,{messages:[].concat((0,toConsumableArray/* default */.A)(current.messages),[newChunkMessage])});cacheSessionRun(session.id,updatedRun);return updatedRun;}if(lastMsgIndex>=0){var _lastMessage$config$m,_lastMessage$config$m2;const lastMessage=current.messages[lastMsgIndex];// Check if last message is a log message - don't append chunk to log messages
const isLastMessageLog=((_lastMessage$config$m=lastMessage.config.metadata)===null||_lastMessage$config$m===void 0?void 0:_lastMessage$config$m.type)==="log"||lastMessage.config.content_type==="log"||lastMessage.config.type==="AgentLogEvent"||((_lastMessage$config$m2=lastMessage.config.metadata)===null||_lastMessage$config$m2===void 0?void 0:_lastMessage$config$m2.type)==="AgentLogEvent";if(!isLastMessageLog&&(lastMessage.config.source==="assistant"||lastMessage.config.source===chunkSource)){const updatedMessages=(0,toConsumableArray/* default */.A)(current.messages);const newContent=lastMessage.config.content+processedContent;updatedMessages[lastMsgIndex]=Object.assign({},lastMessage,{config:Object.assign({},lastMessage.config,{content:newContent,metadata:Object.assign({},lastMessage.config.metadata||{},sanitizedChunkMetadata||{})})});streamingMessageRef.current={source:chunkSource,content:newContent};updatedRun=Object.assign({},current,{messages:updatedMessages});cacheSessionRun(session.id,updatedRun);return updatedRun;}}const newChunkMessage=createMessage({source:chunkSource,content:processedContent,metadata:sanitizedChunkMetadata||{}},current.id,session.id,userEmail);streamingMessageRef.current={source:chunkSource,content:processedContent};updatedRun=Object.assign({},current,{messages:[].concat((0,toConsumableArray/* default */.A)(current.messages),[newChunkMessage])});cacheSessionRun(session.id,updatedRun);return updatedRun;}return current;case"message_log":if(!wsMessage.data)return current;const logData=wsMessage.data;// 提取 content 和 title 字段
const hasContent=logData.content&&typeof logData.content==="string";const hasTitle=logData.title&&typeof logData.title==="string";// 至少需要有 content 或 title 之一
if(!hasContent&&!hasTitle)return current;const timestamp=typeof logData.send_time_stamp==="number"?logData.send_time_stamp:typeof logData.send_time_stamp==="string"?Number(logData.send_time_stamp):undefined;const level=typeof logData.send_level==="string"?logData.send_level:typeof((_logData$send_level=logData.send_level)===null||_logData$send_level===void 0?void 0:_logData$send_level.value)==="string"?logData.send_level.value:undefined;// 创建日志条目，无论是否有 title 都添加到 run.logs
const logEntry={content:hasContent?logData.content:"",title:hasTitle?logData.title:undefined,source:typeof logData.source==="string"?logData.source:undefined,send_time_stamp:typeof timestamp==="number"&&Number.isFinite(timestamp)?timestamp:undefined,send_level:level,content_type:typeof logData.content_type==="string"?logData.content_type:undefined};// 确保 logs 数组存在，如果不存在则初始化为空数组
const currentLogsRaw=Array.isArray(current.logs)?current.logs:[];const normalizedLogs=currentLogsRaw.map(log=>typeof log==="string"?{content:log}:log);const updatedLogs=[].concat((0,toConsumableArray/* default */.A)(normalizedLogs),[logEntry]);// 如果有 title，在聊天区创建消息显示 title（用于聊天界面显示）
let updatedMessages=current.messages;if(hasTitle){const logSource=typeof logData.source==="string"?logData.source:"assistant";const logMetaType=logData.type==="AgentLogEvent"?"AgentLogEvent":"log";const logMessage=createMessage(Object.assign({source:logSource,content:logData.title},logData.type==="AgentLogEvent"?{type:"AgentLogEvent"}:{},typeof logData.content_type==="string"?{content_type:logData.content_type}:{},{metadata:Object.assign({type:logMetaType},hasContent?{log_content:logData.content}:{},typeof logData.content_type==="string"?{content_type:logData.content_type}:{})}),current.id,session.id,userEmail);updatedMessages=[].concat((0,toConsumableArray/* default */.A)(current.messages),[logMessage]);}updatedRun=Object.assign({},current,{messages:updatedMessages,logs:updatedLogs});cacheSessionRun(session.id,updatedRun);return updatedRun;case"message_files":if(!wsMessage.data)return current;const filesEvent=wsMessage.data;updatedRun=Object.assign({},current,{file_events:[].concat((0,toConsumableArray/* default */.A)(current.file_events||[]),[filesEvent])});cacheSessionRun(session.id,updatedRun);return updatedRun;case"input_request":let input_request;switch(wsMessage.input_type){case"approval":const input_request_message=wsMessage;input_request={input_type:"approval",prompt:input_request_message.prompt};break;case"text_input":case null:default:input_request={input_type:"text_input"};break;}updatedRun=Object.assign({},current,{status:"awaiting_input",input_request:input_request});cacheSessionRun(session.id,updatedRun);return updatedRun;case"system":updatedRun=Object.assign({},current,{status:wsMessage.status});cacheSessionRun(session.id,updatedRun);return updatedRun;case"result":case"completion":const status=wsMessage.status==="complete"?"complete":wsMessage.status==="error"?"error":"stopped";const isTeamResult=data=>{return data&&"task_result"in data&&"usage"in data&&"duration"in data;};if(activeSocket){activeSocket.close();setActiveSocket(null);activeSocketRef.current=null;}updatedRun=Object.assign({},current,{status,team_result:wsMessage.data&&isTeamResult(wsMessage.data)?wsMessage.data:null});cacheSessionRun(session.id,updatedRun);return updatedRun;default:return current;}});},[cacheSessionRun,session===null||session===void 0?void 0:session.id,activeSocket,setCurrentRun,userEmail]);const setupWebSocket=react.useCallback(function(runId,fresh_socket,only_retrieve_existing_socket){if(fresh_socket===void 0){fresh_socket=false;}if(only_retrieve_existing_socket===void 0){only_retrieve_existing_socket=false;}if(!(session!==null&&session!==void 0&&session.id)){throw new Error("Invalid session configuration");}const socket=getSessionSocket(session.id,runId,fresh_socket,only_retrieve_existing_socket);if(!socket){return null;}socket.onmessage=event=>{try{const message=JSON.parse(event.data);handleWebSocketMessage(message);}catch(error){console.error("WebSocket message parsing error:",error);}};// Capture sessionId and runId at the time of socket creation to avoid stale closures
const socketSessionId=session.id;const socketRunId=runId;socket.onclose=()=>{// Only process close event if this socket belongs to the current session and run
// This prevents old socket close events from affecting new sessions
setCurrentRun(current=>{if(!current||!(session!==null&&session!==void 0&&session.id))return current;// Check if this socket belongs to the current session and run
if(session.id!==socketSessionId||current.id!==socketRunId){return current;}// Only update if the socket is still the active one
if(activeSocketRef.current!==socket){return current;}if(current.status==="awaiting_input"){const updatedRun=Object.assign({},current,{status:"stopped",input_request:undefined,team_result:{task_result:{messages:[],stop_reason:"Cancelled by user"},usage:"",duration:0}});cacheSessionRun(session.id,updatedRun);return updatedRun;}return current;});// Only clear active socket if this is the current active socket
if(activeSocketRef.current===socket){activeSocketRef.current=null;setActiveSocket(null);}};socket.onerror=error=>{console.error("WebSocket error:",error);};setActiveSocket(socket);activeSocketRef.current=socket;return socket;},[cacheSessionRun,session===null||session===void 0?void 0:session.id,getSessionSocket,handleWebSocketMessage,setCurrentRun]);const ensureWebSocketConnection=react.useCallback(async runId=>{var _activeSocketRef$curr;if(((_activeSocketRef$curr=activeSocketRef.current)===null||_activeSocketRef$curr===void 0?void 0:_activeSocketRef$curr.readyState)===WebSocket.OPEN){return activeSocketRef.current;}message/* default */.Ay.loading("正在重新连接...",0.5);const socket=setupWebSocket(runId,true,false);if(!socket){throw new Error("Failed to establish WebSocket connection");}if(socket.readyState!==WebSocket.OPEN){await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{reject(new Error("WebSocket connection timeout"));},5000);const checkState=()=>{if(socket.readyState===WebSocket.OPEN){clearTimeout(timeout);message/* default */.Ay.success("重新连接成功",1);resolve();}else if(socket.readyState===WebSocket.CLOSED||socket.readyState===WebSocket.CLOSING){clearTimeout(timeout);reject(new Error("WebSocket connection failed"));}else{setTimeout(checkState,100);}};checkState();});}return socket;},[setupWebSocket]);return{activeSocket,activeSocketRef,setupWebSocket,ensureWebSocketConnection,inputTimeoutRef};};
;// ./src/pages/chat/hooks/usePlanManagement.ts
const defaultTeamConfig={name:"Default Team",participants:[],team_type:"RoundRobinGroupChat",component_type:"team"};const usePlanManagement=_ref=>{let{session,currentRun,settingsConfig,teamConfig,setupWebSocket,activeSocketRef,setNoMessagesYet}=_ref;const[localPlan,setLocalPlan]=react.useState(null);const[planProcessed,setPlanProcessed]=react.useState(false);const[updatedPlan,setUpdatedPlan]=react.useState([]);const processedPlanIds=react.useRef(new Set()).current;// Listen for plan events
react.useEffect(()=>{if(session!==null&&session!==void 0&&session.id){const handlePlanReady=event=>{if(event.detail.sessionId!==session.id){return;}const planId=event.detail.messageId||"plan_"+Date.now();if(!processedPlanIds.has(planId)){const planData=Object.assign({},event.detail.planData,{sessionId:session.id,messageId:planId});setLocalPlan(planData);setPlanProcessed(false);}};window.addEventListener("planReady",handlePlanReady);return()=>{window.removeEventListener("planReady",handlePlanReady);};}},[session===null||session===void 0?void 0:session.id,processedPlanIds]);const processPlan=react.useCallback(async newPlan=>{if(!currentRun||!(session!==null&&session!==void 0&&session.id))return;if(newPlan.sessionId!==session.id){return;}try{var _activeSocketRef$curr;const socket=((_activeSocketRef$curr=activeSocketRef.current)===null||_activeSocketRef$curr===void 0?void 0:_activeSocketRef$curr.readyState)===WebSocket.OPEN?activeSocketRef.current:setupWebSocket(currentRun.id,true,false);if(!socket||socket.readyState!==WebSocket.OPEN){console.error("WebSocket not available or not open");return;}const sessionSettingsConfig=Object.assign({},settingsConfig,{plan:{task:newPlan.task,steps:newPlan.steps,plan_summary:"Saved plan for task: "+newPlan.task}});const currentTeamConfig=teamConfig||defaultTeamConfig;const message={type:"start",id:"plan_"+Date.now(),task:newPlan.task,metadata:{team_config:currentTeamConfig,settings_config:sessionSettingsConfig},sessionId:session.id};socket.send(JSON.stringify(message));setNoMessagesYet(false);setPlanProcessed(true);if(newPlan.messageId){processedPlanIds.add(newPlan.messageId);}}catch(err){console.error("Error processing plan for session:",session.id,err);}},[currentRun,session===null||session===void 0?void 0:session.id,settingsConfig,teamConfig,setupWebSocket,activeSocketRef,setNoMessagesYet,processedPlanIds]);const handleExecutePlan=react.useCallback(plan=>{plan.sessionId=(session===null||session===void 0?void 0:session.id)||undefined;processPlan(plan);},[processPlan,session===null||session===void 0?void 0:session.id]);const handlePlanUpdate=react.useCallback(plan=>{setUpdatedPlan(plan);},[]);// Reset plan state when session changes
react.useEffect(()=>{setLocalPlan(null);setPlanProcessed(false);processedPlanIds.clear();setUpdatedPlan([]);},[session===null||session===void 0?void 0:session.id,processedPlanIds]);return{localPlan,planProcessed,updatedPlan,setLocalPlan,setPlanProcessed,processPlan,handleExecutePlan,handlePlanUpdate};};
// EXTERNAL MODULE: ./src/pages/chat/rendermessage.tsx + 9 modules
var rendermessage = __webpack_require__(27977);
;// ./src/pages/chat/hooks/useProgressTracking.ts
const useProgressTracking=currentRun=>{const[progress,setProgress]=react.useState({currentStep:-1,totalSteps:-1});const[isPlanning,setIsPlanning]=react.useState(false);const[hasFinalAnswer,setHasFinalAnswer]=react.useState(false);const[currentPlan,setCurrentPlan]=react.useState();// Extract current plan from messages
react.useEffect(()=>{if(!(currentRun!==null&&currentRun!==void 0&&currentRun.messages))return;const lastPlanMessage=(0,toConsumableArray/* default */.A)(currentRun.messages).reverse().find(msg=>{if(typeof msg.config.content!=="string")return false;return rendermessage.messageUtils.isPlanMessage(msg.config.metadata);});if(lastPlanMessage&&typeof lastPlanMessage.config.content==="string"){try{const content=JSON.parse(lastPlanMessage.config.content);if(rendermessage.messageUtils.isPlanMessage(lastPlanMessage.config.metadata)){var _content$steps;setCurrentPlan({task:content.task,steps:((_content$steps=content.steps)===null||_content$steps===void 0?void 0:_content$steps.map((step,index)=>Object.assign({},step,{index:index// 添加 index 字段
})))||[],response:content.response,plan_summary:content.plan_summary});}}catch(_unused){setCurrentPlan(undefined);}}},[currentRun===null||currentRun===void 0?void 0:currentRun.messages]);// Track progress and detect plan/final answer messages
react.useEffect(()=>{if(!(currentRun!==null&&currentRun!==void 0&&currentRun.messages.length))return;let currentStepIndex=-1;let planLength=0;// Find the last final answer index
const lastFinalAnswerIndex=currentRun.messages.findLastIndex(msg=>typeof msg.config.content==="string"&&rendermessage.messageUtils.isFinalAnswer(msg.config.metadata));// Calculate step progress only for messages after the last final answer
const relevantMessages=lastFinalAnswerIndex===-1?currentRun.messages:currentRun.messages.slice(lastFinalAnswerIndex+1);relevantMessages.forEach(msg=>{if(typeof msg.config.content==="string"){try{const content=JSON.parse(msg.config.content);if(content.index!==undefined){currentStepIndex=content.index;if(content.plan_length){planLength=content.plan_length;}}}catch(_unused2){// Skip if we can't parse the message
}}});setProgress({currentStep:currentStepIndex,totalSteps:planLength,plan:currentPlan});// Check if we have a final answer
const hasFinalAnswerExists=lastFinalAnswerIndex!==-1;// If we have a final answer, check for plans after it
if(hasFinalAnswerExists){const messagesAfterFinalAnswer=currentRun.messages.slice(lastFinalAnswerIndex+1);const hasPlanAfterFinalAnswer=messagesAfterFinalAnswer.some(msg=>typeof msg.config.content==="string"&&rendermessage.messageUtils.isPlanMessage(msg.config.metadata));if(hasPlanAfterFinalAnswer){setIsPlanning(currentStepIndex===-1);setHasFinalAnswer(false);}else{setIsPlanning(false);setHasFinalAnswer(true);}}else{// No final answer - check for recent plans
const recentMessages=currentRun.messages.slice(-3);const hasPlan=recentMessages.some(msg=>typeof msg.config.content==="string"&&rendermessage.messageUtils.isPlanMessage(msg.config.metadata));setHasFinalAnswer(false);setIsPlanning(hasPlan&&currentStepIndex===-1);}// Hide progress if run is not in an active state
if(currentRun.status!=="active"&&currentRun.status!=="awaiting_input"&&currentRun.status!=="paused"&&currentRun.status!=="pausing"){setIsPlanning(false);setProgress({currentStep:-1,totalSteps:-1});}},[currentRun===null||currentRun===void 0?void 0:currentRun.messages,currentRun===null||currentRun===void 0?void 0:currentRun.status,currentPlan]);return{progress,isPlanning,hasFinalAnswer,currentPlan};};
// EXTERNAL MODULE: ./src/components/types/plan.ts
var types_plan = __webpack_require__(4990);
// EXTERNAL MODULE: ./src/components/features/Agents/useAgentInfo.ts
var useAgentInfo = __webpack_require__(43044);
;// ./src/pages/chat/hooks/useTaskActions.ts
const buildLlmPayload=(llm,agentInfo)=>{const resolvedDefaultConfigName=(llm===null||llm===void 0?void 0:llm.label)||(agentInfo===null||agentInfo===void 0?void 0:agentInfo.defult_config_name);return Object.assign({},resolvedDefaultConfigName&&{defult_config_name:resolvedDefaultConfigName});};const useTaskActions=_ref=>{let{currentRun,session,teamConfig,settingsConfig,updatedPlan,userEmail,activeSocketRef,inputTimeoutRef,setCurrentRun,setNoMessagesYet,setError,setupWebSocket,ensureWebSocketConnection,onSessionNameChange}=_ref;const{agentInfo}=(0,useAgentInfo/* useAgentInfo */.B)(userEmail);const handleError=react.useCallback(error=>{console.error("Error:",error);message/* default */.Ay.error("Error during request processing");setError({status:false,message:error instanceof Error?error.message:"Unknown error occurred"});},[setError]);const handleInputResponse=react.useCallback(async function(response,accepted,plan,files,llm,inputMetadata){if(accepted===void 0){accepted=false;}if(files===void 0){files=[];}if(!currentRun){handleError(new Error("No active run"));return;}try{const needsReconnect=!activeSocketRef.current||activeSocketRef.current.readyState!==WebSocket.OPEN;const socket=await ensureWebSocketConnection(currentRun.id);const lastMessage=currentRun.messages.slice(-1)[0];let planString="";if(plan){planString=(0,types_plan/* convertPlanStepsToJsonString */.iQ)(plan.steps);}else if(lastMessage&&// lastMessage.config.metadata?.type === "plan"
rendermessage.messageUtils.isPlanMessage(lastMessage.config.metadata)){planString=(0,types_plan/* convertPlanStepsToJsonString */.iQ)(updatedPlan);}// Use files directly (already in the correct format from upload)
const processedFiles=files&&files.length>0?files:[];// Inner JSON (response field only): accepted, content, plan — no metadata here.
// BESIII Revise etc. pass inputMetadata as sibling on the WebSocket envelope.
const responseJson=Object.assign({accepted:accepted,content:response},planString!==""&&{plan:planString},buildLlmPayload(llm,agentInfo));const responseString=JSON.stringify(responseJson);const hasInputMetadata=inputMetadata!=null&&typeof inputMetadata==="object"&&Object.keys(inputMetadata).length>0;if(needsReconnect){let currentSettings=settingsConfig;if(userEmail){try{currentSettings=await api/* settingsAPI */.YP.getSettings(userEmail);store/* useSettingsStore */.C.getState().updateConfig(currentSettings);}catch(error){console.error("Failed to load settings:",error);}}if(currentRun){const continueMessage={type:"continue",task:responseString,metadata:Object.assign({team_config:teamConfig,settings_config:Object.assign({},currentSettings,{agent_mode_config:agentInfo},buildLlmPayload(llm,agentInfo))},processedFiles.length>0&&{files:processedFiles},hasInputMetadata?inputMetadata:{})};socket.send(JSON.stringify(continueMessage));}}else{const inputResponseMessage={type:"input_response",response:responseString,metadata:Object.assign({settings_config:Object.assign({},(agentInfo===null||agentInfo===void 0?void 0:agentInfo.id)&&{agent_id:agentInfo.id},buildLlmPayload(llm,agentInfo))},processedFiles.length>0&&{files:processedFiles},hasInputMetadata?inputMetadata:{})};socket.send(JSON.stringify(inputResponseMessage));setCurrentRun(current=>{if(!current)return null;return Object.assign({},current,{status:"active",input_request:undefined});});}}catch(error){handleError(error);}},[currentRun,activeSocketRef,ensureWebSocketConnection,updatedPlan,settingsConfig,userEmail,teamConfig,setCurrentRun,handleError,agentInfo]);const handleRegeneratePlan=react.useCallback(async()=>{if(!currentRun){handleError(new Error("No active run"));return;}try{var _lastMessage$config$m;const needsReconnect=!activeSocketRef.current||activeSocketRef.current.readyState!==WebSocket.OPEN;const socket=await ensureWebSocketConnection(currentRun.id);const lastMessage=currentRun.messages.slice(-1)[0];let planString="";if(lastMessage&&((_lastMessage$config$m=lastMessage.config.metadata)===null||_lastMessage$config$m===void 0?void 0:_lastMessage$config$m.type)==="plan"){planString=(0,types_plan/* convertPlanStepsToJsonString */.iQ)(updatedPlan);}const responseJson=Object.assign({content:"Regenerate a plan that improves on the current plan"},planString!==""&&{plan:planString});const responseString=JSON.stringify(responseJson);socket.send(JSON.stringify({type:"input_response",response:responseString}));}catch(error){handleError(error);}},[currentRun,activeSocketRef,ensureWebSocketConnection,updatedPlan,handleError]);const handleCancel=react.useCallback(async()=>{if(!currentRun)return;if(inputTimeoutRef.current){clearTimeout(inputTimeoutRef.current);inputTimeoutRef.current=null;}try{const socket=await ensureWebSocketConnection(currentRun.id);socket.send(JSON.stringify({type:"stop",reason:"Cancelled by user"}));setCurrentRun(current=>{if(!current)return null;return Object.assign({},current,{status:"stopped",input_request:undefined});});}catch(error){handleError(error);}},[currentRun,inputTimeoutRef,activeSocketRef,ensureWebSocketConnection,setCurrentRun,handleError]);const handlePause=react.useCallback(async()=>{if(!currentRun)return;try{if(currentRun.status==="awaiting_input"||currentRun.status==="connected"){return;}const needsReconnect=!activeSocketRef.current||activeSocketRef.current.readyState!==WebSocket.OPEN;const socket=await ensureWebSocketConnection(currentRun.id);socket.send(JSON.stringify({type:"pause"}));setCurrentRun(current=>{if(!current)return null;return Object.assign({},current,{status:"pausing"});});}catch(error){handleError(error);}},[currentRun,activeSocketRef,ensureWebSocketConnection,setCurrentRun,handleError]);const runTask=react.useCallback(async function(query,files,plan,fresh_socket,llm){if(files===void 0){files=[];}if(fresh_socket===void 0){fresh_socket=false;}setError(null);setNoMessagesYet(false);try{if(!currentRun){throw new Error("Could not setup run");}// 点击发送时：再请求全局setting配置 (API) - 确保获取最新配置
let currentSettings=settingsConfig;if(userEmail){try{// 请求最新的全局settings配置
currentSettings=await api/* settingsAPI */.YP.getSettings(userEmail);// 更新store中的配置
store/* useSettingsStore */.C.getState().updateConfig(currentSettings);}catch(error){console.error("Failed to load settings:",error);// 如果请求失败，使用当前的settingsConfig作为后备
}}// Setup websocket connection
const socket=setupWebSocket(currentRun.id,fresh_socket,false);if(!socket){throw new Error("WebSocket connection not available");}// Wait for socket to be ready
await new Promise((resolve,reject)=>{const checkState=()=>{if(socket.readyState===WebSocket.OPEN){resolve();}else if(socket.readyState===WebSocket.CLOSED||socket.readyState===WebSocket.CLOSING){reject(new Error("Socket failed to connect"));}else{setTimeout(checkState,100);}};checkState();});// Use files directly (already in the correct format from upload)
const processedFiles=files&&files.length>0?files:[];const planString=plan?(0,types_plan/* convertPlanStepsToJsonString */.iQ)(plan.steps):"";const taskJson=Object.assign({content:query},planString!==""&&{plan:planString});// 发送给后端：使用最新的settings配置（files / team / settings 均在 metadata）
const messageToSend={type:"start",task:JSON.stringify(taskJson),metadata:{files:processedFiles,team_config:teamConfig,settings_config:Object.assign({},currentSettings,{agent_id:(agentInfo===null||agentInfo===void 0?void 0:agentInfo.id)||""},buildLlmPayload(llm,agentInfo))}};socket.send(JSON.stringify(messageToSend));const sessionData={id:session===null||session===void 0?void 0:session.id,name:query.slice(0,50)};onSessionNameChange(sessionData);}catch(error){setError({status:false,message:error instanceof Error?error.message:"Failed to start task"});}},[currentRun,settingsConfig,userEmail,setupWebSocket,teamConfig,session===null||session===void 0?void 0:session.id,setError,setNoMessagesYet,onSessionNameChange,agentInfo===null||agentInfo===void 0?void 0:agentInfo.id]);const handleApprove=react.useCallback(()=>{if((currentRun===null||currentRun===void 0?void 0:currentRun.status)==="awaiting_input"){handleInputResponse("approve",true);}},[currentRun===null||currentRun===void 0?void 0:currentRun.status,handleInputResponse]);const handleDeny=react.useCallback(()=>{if((currentRun===null||currentRun===void 0?void 0:currentRun.status)==="awaiting_input"){handleInputResponse("deny",false);}},[currentRun===null||currentRun===void 0?void 0:currentRun.status,handleInputResponse]);const handleAcceptPlan=react.useCallback(text=>{if((currentRun===null||currentRun===void 0?void 0:currentRun.status)==="awaiting_input"){const query=text||"Plan Accepted";handleInputResponse(query,true).catch(error=>{console.error("handleAcceptPlan error:",error);handleError(error);});}},[currentRun===null||currentRun===void 0?void 0:currentRun.status,handleInputResponse,handleError]);return{handleInputResponse,handleRegeneratePlan,handleCancel,handlePause,runTask,handleApprove,handleDeny,handleAcceptPlan};};
// EXTERNAL MODULE: ./src/pages/chat/progressbar.tsx
var progressbar = __webpack_require__(67040);
// EXTERNAL MODULE: ./src/pages/chat/runview.tsx + 7 modules
var runview = __webpack_require__(96850);
// EXTERNAL MODULE: ./src/pages/chat/WelcomeScreen.tsx
var WelcomeScreen = __webpack_require__(34788);
;// ./src/pages/chat/chat.tsx

















// Extend RunStatus for sidebar status reporting

const chat_defaultTeamConfig = {
  name: "Default Team",
  participants: [],
  team_type: "RoundRobinGroupChat",
  component_type: "team"
};
function ChatView(_ref) {
  var _currentRun$messages;
  let {
    session,
    onSessionNameChange,
    getSessionSocket,
    visible = true,
    onRunStatusChange,
    pendingFirstMessage,
    onPendingMessageSent,
    libraryServerFilesPrefill,
    onFileEventsChange
  } = _ref;
  // Context and store
  const settingsConfig = (0,store/* useSettingsStore */.C)(state => state.config);
  const {
    user
  } = react.useContext(provider/* appContext */.v);
  const setSessionRunCache = useMessageCacheStore(state => state.setSessionRun);
  const getSessionRunCache = useMessageCacheStore(state => state.getSessionRun);

  // Local state
  const [error, setError] = react.useState({
    status: true,
    message: "All good"
  });
  const [currentRun, setCurrentRun] = react.useState(null);
  const [messageApi, contextHolder] = message/* default */.Ay.useMessage();
  const [noMessagesYet, setNoMessagesYet] = react.useState(true);
  const chatContainerRef = react.useRef(null);
  const pendingMessageSentRef = react.useRef(false);

  // TODO: 根据当前run的task的metadata或session的agent_mode_config来确定agent类型
  // Panel state - initialized based on agent configuration
  // Dynamically detect agent type from session or current run
  const agentType = react.useMemo(() => {
    var _session$agent_mode_c, _session$agent_mode_c2;
    // 如果组件不可见，返回默认值，避免不必要的计算
    if (!visible) {
      return 'besiii';
    }

    // 根据 session 的 agent_mode_config 判断 agent 类型
    if ((session === null || session === void 0 ? void 0 : (_session$agent_mode_c = session.agent_mode_config) === null || _session$agent_mode_c === void 0 ? void 0 : _session$agent_mode_c.mode) === 'magentic-one') {
      return 'magentic-one';
    } else if ((session === null || session === void 0 ? void 0 : (_session$agent_mode_c2 = session.agent_mode_config) === null || _session$agent_mode_c2 === void 0 ? void 0 : _session$agent_mode_c2.mode) === 'besiii') {
      return 'besiii';
    } else {
      // 默认返回 besiii（如果 session 为空或没有配置）
      return 'besiii';
    }
  }, [visible, session]);
  const agentConfig = react.useMemo(() => getAgentConfig(agentType), [agentType]);
  const [isPanelMinimized, setIsPanelMinimized] = react.useState(agentConfig.panel.defaultMinimized);
  const [showPanel, setShowPanel] = react.useState(agentConfig.panel.type !== 'none');
  const [teamConfig, setTeamConfig] = react.useState(chat_defaultTeamConfig);

  // ChatInput ref
  const chatInputRef = react.useRef(null);

  // Custom hooks
  const {
    activeSocket,
    activeSocketRef,
    setupWebSocket,
    ensureWebSocketConnection,
    inputTimeoutRef
  } = useChatWebSocket({
    session,
    getSessionSocket,
    setCurrentRun,
    setSessionRun: setSessionRunCache,
    userEmail: user === null || user === void 0 ? void 0 : user.email
  });
  const {
    localPlan,
    planProcessed,
    updatedPlan,
    setLocalPlan,
    setPlanProcessed,
    processPlan,
    handleExecutePlan,
    handlePlanUpdate
  } = usePlanManagement({
    session,
    currentRun,
    settingsConfig,
    teamConfig,
    setupWebSocket,
    activeSocketRef,
    setNoMessagesYet
  });
  const {
    progress,
    isPlanning,
    hasFinalAnswer
  } = useProgressTracking(currentRun);

  // 添加滚动到指定 step 的函数
  const scrollToStep = react.useCallback(stepIndex => {
    // 查找对应的 step execution 元素
    const selector = "#step-execution-" + stepIndex;
    const stepElement = document.querySelector(selector);
    if (!stepElement) {
      console.warn("[scrollToStep] Step element not found for index " + stepIndex);
      return;
    }

    // 查找实际的滚动容器 - 向上查找父元素，找到有 overflow-y-auto 或 scroll 类的元素
    let scrollContainer = stepElement.parentElement;
    while (scrollContainer) {
      const style = window.getComputedStyle(scrollContainer);
      const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll' || scrollContainer.classList.contains('scroll') || scrollContainer.classList.contains('overflow-y-auto');
      if (hasOverflow || scrollContainer.scrollHeight > scrollContainer.clientHeight) {
        break;
      }
      scrollContainer = scrollContainer.parentElement;
    }
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elementRect = stepElement.getBoundingClientRect();

      // 计算滚动位置：元素相对于容器的位置，居中显示
      const scrollTop = scrollContainer.scrollTop + elementRect.top - containerRect.top - containerRect.height / 2 + elementRect.height / 2;
      scrollContainer.scrollTo({
        top: Math.max(0, scrollTop),
        // 确保不为负数
        behavior: "smooth"
      });
    } else {
      // 如果找不到滚动容器，使用标准的 scrollIntoView
      stepElement.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }, []);
  const {
    handleInputResponse,
    handleRegeneratePlan,
    handleCancel,
    handlePause,
    runTask,
    handleApprove,
    handleDeny,
    handleAcceptPlan
  } = useTaskActions({
    currentRun,
    session,
    teamConfig,
    settingsConfig,
    updatedPlan,
    userEmail: user === null || user === void 0 ? void 0 : user.email,
    activeSocketRef,
    inputTimeoutRef,
    setCurrentRun,
    setNoMessagesYet,
    setError,
    setupWebSocket,
    ensureWebSocketConnection,
    onSessionNameChange
  });

  // 从 messages 中提取 FilesEvent 类型的消息
  const extractFileEventsFromMessages = react.useCallback(run => {
    if (!run || !run.messages || !Array.isArray(run.messages)) {
      return [];
    }
    const fileEvents = [];
    run.messages.forEach(message => {
      var _ref2, _config$send_time_sta;
      const config = message.config || {};
      const content = config.content;
      const rawTimestamp = (_ref2 = (_config$send_time_sta = config.send_time_stamp) !== null && _config$send_time_sta !== void 0 ? _config$send_time_sta : content === null || content === void 0 ? void 0 : content.send_time_stamp) !== null && _ref2 !== void 0 ? _ref2 : message.created_at;

      // 检查是否是 FilesEvent 类型：content 是对象且包含 files 数组
      if (content && typeof content === 'object' && !Array.isArray(content) && content.files && Array.isArray(content.files)) {
        // 转换为 FilesEvent 格式
        const filesEvent = {
          source: config.source,
          models_usage: config.models_usage || null,
          metadata: config.metadata || {},
          content: {
            files: content.files,
            title: content.title,
            description: content.description,
            send_time_stamp: typeof rawTimestamp === "number" ? rawTimestamp : typeof rawTimestamp === "string" ? Number(rawTimestamp) || Date.parse(rawTimestamp) / 1000 : undefined
          },
          // 优先使用后端发送的 send_time_stamp；如果没有则回退到 message.created_at
          send_time_stamp: typeof rawTimestamp === "number" ? rawTimestamp : typeof rawTimestamp === "string" ? Number(rawTimestamp) || Date.parse(rawTimestamp) / 1000 : undefined,
          type: config.type || 'FilesEvent'
        };
        fileEvents.push(filesEvent);
      }
    });
    return fileEvents;
  }, []);

  // 从 messages 中提取 AgentLogEvent 类型的消息并转换为 RunLogEntry
  const extractLogEventsFromMessages = react.useCallback(run => {
    if (!run || !run.messages || !Array.isArray(run.messages)) {
      return [];
    }
    const logEntries = [];
    run.messages.forEach(message => {
      var _config$send_time_sta2, _message$metadata;
      const config = message.config || {};
      const messageAny = config;
      const rawTimestamp = (_config$send_time_sta2 = config.send_time_stamp) !== null && _config$send_time_sta2 !== void 0 ? _config$send_time_sta2 : message.created_at;

      // 检查是否是 AgentLogEvent 类型
      const isAgentLogEvent = messageAny.type === "AgentLogEvent" || ((_message$metadata = message.metadata) === null || _message$metadata === void 0 ? void 0 : _message$metadata.type) === "AgentLogEvent" || messageAny.content_type === "log";
      if (isAgentLogEvent) {
        // 提取 content（参考 rendermessage.tsx 的处理方式）
        // content 可能在 messageAny.content 中（直接在 config 对象中）
        let contentValue = "";

        // 优先使用 messageAny.content（在 config 对象中）
        if (messageAny.content) {
          if (typeof messageAny.content === "string") {
            contentValue = messageAny.content;
          } else if (typeof messageAny.content === "object" && messageAny.content !== null) {
            // 如果是对象，尝试提取文本内容
            contentValue = messageAny.content.content || messageAny.content.text || JSON.stringify(messageAny.content);
          } else {
            contentValue = String(messageAny.content);
          }
        }
        // 回退到 message.content
        else if (message.content) {
          if (typeof message.content === "string") {
            contentValue = message.content;
          } else {
            contentValue = String(message.content);
          }
        }

        // 提取其他字段
        const logEntry = {
          content: contentValue,
          title: messageAny.title,
          source: messageAny.source || config.source,
          send_time_stamp: typeof rawTimestamp === "number" ? rawTimestamp : typeof rawTimestamp === "string" ? Number(rawTimestamp) || Date.parse(rawTimestamp) / 1000 : undefined,
          send_level: messageAny.send_level,
          content_type: messageAny.content_type || "log"
        };
        logEntries.push(logEntry);
      }
    });
    return logEntries;
  }, []);
  const loadSessionRun = react.useCallback(async () => {
    if (!(session !== null && session !== void 0 && session.id) || !(user !== null && user !== void 0 && user.email)) return null;
    const applyExtractions = run => {
      run.file_events = extractFileEventsFromMessages(run);
      const extractedLogs = extractLogEventsFromMessages(run);
      if (extractedLogs.length > 0) {
        if (run.logs && Array.isArray(run.logs)) {
          const existingLogs = run.logs.map(log => typeof log === "string" ? {
            content: log
          } : log);
          const existingKeys = new Set(existingLogs.map(log => log.send_time_stamp + "-" + log.content));
          const newLogs = extractedLogs.filter(log => !existingKeys.has(log.send_time_stamp + "-" + log.content));
          run.logs = [].concat((0,toConsumableArray/* default */.A)(existingLogs), (0,toConsumableArray/* default */.A)(newLogs));
        } else {
          run.logs = extractedLogs;
        }
      }
      return run;
    };
    try {
      // Prefer cache when it has more messages (streamed content preserved from before switch)
      const cachedRun = getSessionRunCache(session.id);
      const response = await api/* sessionAPI */.jT.getSessionRuns(session.id, user === null || user === void 0 ? void 0 : user.email);
      let latestRun = response.runs[response.runs.length - 1];
      if (cachedRun && latestRun && cachedRun.id === latestRun.id) {
        if (cachedRun.messages.length >= latestRun.messages.length) {
          latestRun = Object.assign({}, cachedRun);
        }
      }
      if (latestRun) {
        applyExtractions(latestRun);
      }
      return latestRun;
    } catch (error) {
      console.error("Error loading session runs:", error);
      messageApi.error("Failed to load chat history");
      return null;
    }
  }, [session === null || session === void 0 ? void 0 : session.id, user === null || user === void 0 ? void 0 : user.email, messageApi, getSessionRunCache, extractFileEventsFromMessages, extractLogEventsFromMessages]);
  react.useEffect(() => {
    const initializeSession = async () => {
      if (session !== null && session !== void 0 && session.id) {
        // When not visible, skip load to avoid overwriting streamed messages in currentRun
        if (!visible) return;

        // When switching back: we already have currentRun (preserved when we switched away),
        // don't overwrite with API data - just ensure WebSocket is connected for further chunks
        let skipLoad = false;
        setCurrentRun(prev => {
          if (prev !== null && prev !== void 0 && prev.id) {
            setupWebSocket(prev.id, false, true);
            skipLoad = true;
            return prev;
          }
          return prev;
        });
        if (skipLoad) return;

        // Initial load: currentRun is null
        pendingMessageSentRef.current = false;
        setLocalPlan(null);
        setPlanProcessed(false);
        const latestRun = await loadSessionRun();
        if (latestRun) {
          setCurrentRun(latestRun);
          setNoMessagesYet(latestRun.messages.length === 0);
          if (latestRun.id) {
            setupWebSocket(latestRun.id, false, true);
          }
        } else {
          setError({
            status: false,
            message: "No run found"
          });
        }
      } else {
        setCurrentRun(null);
      }
    };
    initializeSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session === null || session === void 0 ? void 0 : session.id, visible, loadSessionRun]);

  // Update noMessagesYet when messages change
  react.useEffect(() => {
    if (currentRun) {
      setNoMessagesYet(currentRun.messages.length === 0);
    }
  }, [currentRun === null || currentRun === void 0 ? void 0 : (_currentRun$messages = currentRun.messages) === null || _currentRun$messages === void 0 ? void 0 : _currentRun$messages.length]);

  // Sync current run file events to parent for right-panel "files" tab rendering.
  react.useEffect(() => {
    if (!(session !== null && session !== void 0 && session.id) || !onFileEventsChange) return;
    onFileEventsChange(session.id, (currentRun === null || currentRun === void 0 ? void 0 : currentRun.file_events) || []);
  }, [session === null || session === void 0 ? void 0 : session.id, currentRun === null || currentRun === void 0 ? void 0 : currentRun.file_events, onFileEventsChange]);

  // Track previous status for sidebar updates
  const previousStatus = react.useRef(null);

  // Add effect to update run status when currentRun changes
  react.useEffect(() => {
    if (currentRun && session !== null && session !== void 0 && session.id) {
      var _currentRun$messages2, _currentRun$messages3, _lastMsg$config, _lastMsg$config2, _beforeLastMsg$config, _beforeLastMsg$config2;
      // Only call onRunStatusChange if the status has actually changed
      let statusToReport = currentRun.status;
      const lastMsg = (_currentRun$messages2 = currentRun.messages) === null || _currentRun$messages2 === void 0 ? void 0 : _currentRun$messages2[currentRun.messages.length - 1];
      const beforeLastMsg = (_currentRun$messages3 = currentRun.messages) === null || _currentRun$messages3 === void 0 ? void 0 : _currentRun$messages3[currentRun.messages.length - 2];
      if (lastMsg && (typeof ((_lastMsg$config = lastMsg.config) === null || _lastMsg$config === void 0 ? void 0 : _lastMsg$config.content) === "string" && rendermessage.messageUtils.isFinalAnswer((_lastMsg$config2 = lastMsg.config) === null || _lastMsg$config2 === void 0 ? void 0 : _lastMsg$config2.metadata) || beforeLastMsg && typeof ((_beforeLastMsg$config = beforeLastMsg.config) === null || _beforeLastMsg$config === void 0 ? void 0 : _beforeLastMsg$config.content) === "string" && rendermessage.messageUtils.isFinalAnswer((_beforeLastMsg$config2 = beforeLastMsg.config) === null || _beforeLastMsg$config2 === void 0 ? void 0 : _beforeLastMsg$config2.metadata)) && currentRun.status == "awaiting_input") {
        statusToReport = "final_answer_awaiting_input";
      }
      if (statusToReport !== previousStatus.current) {
        onRunStatusChange(session.id, statusToReport);
        previousStatus.current = statusToReport; // Update the previous status
        // Clear error state when status changes
        setError(null);
      }
    }
  }, [currentRun === null || currentRun === void 0 ? void 0 : currentRun.status, currentRun === null || currentRun === void 0 ? void 0 : currentRun.messages, session === null || session === void 0 ? void 0 : session.id, onRunStatusChange]);

  // Handle pending first message - auto-send when run is ready
  react.useEffect(() => {
    if (!pendingFirstMessage || !currentRun || !noMessagesYet || currentRun.status !== "created" && currentRun.status !== "connected") {
      return;
    }
    // Guard: prevent duplicate sends (e.g. from Strict Mode or rapid effect runs)
    if (pendingMessageSentRef.current) {
      return;
    }
    pendingMessageSentRef.current = true;
    const {
      query,
      files,
      plan
    } = pendingFirstMessage;
    runTask(query, files, plan, true);
    if (onPendingMessageSent) {
      onPendingMessageSent();
    }
  }, [pendingFirstMessage, currentRun, noMessagesYet, currentRun === null || currentRun === void 0 ? void 0 : currentRun.status, runTask, onPendingMessageSent]);

  // Add effect to focus input when session changes
  react.useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [session === null || session === void 0 ? void 0 : session.id]); // Focus when session changes

  // Add this effect to handle WebSocket messages even when not visible
  react.useEffect(() => {
    if (session !== null && session !== void 0 && session.id && !visible && activeSocket) {
      // Keep the socket connection alive but still process status updates
      const messageHandler = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "system" && message.status && session.id) {
            // Update the run status even when not visible
            onRunStatusChange(session.id, message.status);
          }
        } catch (error) {
          console.error("WebSocket message parsing error:", error);
        }
      };
      activeSocket.addEventListener("message", messageHandler);
      return () => {
        activeSocket.removeEventListener("message", messageHandler);
      };
    }
  }, [session === null || session === void 0 ? void 0 : session.id, visible, activeSocket, onRunStatusChange]);

  // Process plan when it becomes available
  react.useEffect(() => {
    if (localPlan && !planProcessed && visible && session !== null && session !== void 0 && session.id && currentRun) {
      if (localPlan.sessionId === session.id) {
        processPlan(localPlan);
      } else {
        setLocalPlan(null);
      }
    }
  }, [localPlan, planProcessed, visible, session === null || session === void 0 ? void 0 : session.id, currentRun, processPlan, setLocalPlan]);
  const lastMessage = currentRun === null || currentRun === void 0 ? void 0 : currentRun.messages.slice(-1)[0];
  const isPlanMessage = lastMessage && rendermessage.messageUtils.isPlanMessage(lastMessage.config.metadata);
  if (!visible) {
    return null;
  }
  return /*#__PURE__*/react.createElement("div", {
    className: "text-primary h-full bg-primary relative flex-1 w-full overflow-hidden"
  }, contextHolder, /*#__PURE__*/react.createElement("div", {
    className: "flex flex-col h-full w-full"
  }, /*#__PURE__*/react.createElement("div", {
    className: "progress-container w-full max-w-full overflow-hidden transition-all duration-300",
    style: {
      height: (currentRun === null || currentRun === void 0 ? void 0 : currentRun.status) === "active" || (currentRun === null || currentRun === void 0 ? void 0 : currentRun.status) === "awaiting_input" || (currentRun === null || currentRun === void 0 ? void 0 : currentRun.status) === "paused" || (currentRun === null || currentRun === void 0 ? void 0 : currentRun.status) === "pausing" ? "3.5rem" : "0"
    }
  }, /*#__PURE__*/react.createElement("div", {
    className: "transition-opacity duration-300"
  }, /*#__PURE__*/react.createElement(progressbar["default"], {
    isPlanning: isPlanning,
    progress: progress,
    hasFinalAnswer: hasFinalAnswer,
    onStepClick: scrollToStep
  }))), /*#__PURE__*/react.createElement("div", {
    ref: chatContainerRef,
    className: "flex-1 overflow-hidden min-h-0 relative w-full " + (noMessagesYet && currentRun ? "flex items-center justify-center" : "")
  }, /*#__PURE__*/react.createElement("div", {
    className: "w-full h-full " + (noMessagesYet && currentRun ? "hidden" : "")
  }, /*#__PURE__*/react.createElement(react.Fragment, null, currentRun && /*#__PURE__*/react.createElement(runview["default"], {
    run: currentRun,
    onSavePlan: handlePlanUpdate,
    onPause: handlePause,
    onRegeneratePlan: handleRegeneratePlan,
    isPanelMinimized: isPanelMinimized,
    setIsPanelMinimized: setIsPanelMinimized,
    showPanel: showPanel,
    setShowPanel: setShowPanel,
    agentConfig: agentConfig,
    onApprove: handleApprove,
    onDeny: handleDeny,
    onAcceptPlan: handleAcceptPlan,
    onInputResponse: handleInputResponse,
    onRunTask: runTask,
    onCancel: handleCancel,
    error: error,
    chatInputRef: chatInputRef,
    onExecutePlan: handleExecutePlan,
    enable_upload: true // Enable file upload functionality
    ,

    serverFilesPrefill: noMessagesYet ? null : libraryServerFilesPrefill !== null && libraryServerFilesPrefill !== void 0 ? libraryServerFilesPrefill : null
  }))), currentRun && noMessagesYet && teamConfig && (session === null || session === void 0 ? void 0 : session.id) && /*#__PURE__*/react.createElement(WelcomeScreen["default"], {
    currentRun: currentRun,
    sessionId: session.id,
    error: error,
    isPlanMessage: isPlanMessage,
    chatInputRef: chatInputRef,
    serverFilesPrefill: noMessagesYet ? libraryServerFilesPrefill !== null && libraryServerFilesPrefill !== void 0 ? libraryServerFilesPrefill : null : null,
    onSubmit: function (query, files, accepted, plan, llm) {
      if (accepted === void 0) {
        accepted = false;
      }
      if ((currentRun === null || currentRun === void 0 ? void 0 : currentRun.status) === "awaiting_input") {
        handleInputResponse(query, accepted, plan, files, llm);
      } else {
        runTask(query, files, plan, true, llm);
      }
    },
    onCancel: handleCancel,
    onPause: handlePause,
    onExecutePlan: handleExecutePlan
  }))));
}

/***/ }),

/***/ 67040:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": function() { return /* binding */ ProgressBar; }
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(96540);
/* harmony import */ var lucide_react__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(79804);
/* harmony import */ var lucide_react__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(85265);
/* harmony import */ var antd__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(40367);



function ProgressBar(_ref) {
  var _adjustedProgress$pla3, _adjustedProgress$pla4, _adjustedProgress$pla5, _adjustedProgress$pla6, _adjustedProgress$pla7;
  let {
    isPlanning,
    progress,
    hasFinalAnswer,
    onStepClick
  } = _ref;
  // Adjust progress when we have final answer
  const adjustedProgress = react__WEBPACK_IMPORTED_MODULE_0__.useMemo(() => {
    var _progress$plan;
    if (hasFinalAnswer && (_progress$plan = progress.plan) !== null && _progress$plan !== void 0 && _progress$plan.steps) {
      return Object.assign({}, progress, {
        currentStep: progress.plan.steps.length - 1,
        totalSteps: progress.plan.steps.length
      });
    }
    return progress;
  }, [hasFinalAnswer, progress]);
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-3/5 max-w-3xl mx-auto overflow-hidden flex flex-col"
  }, isPlanning ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex justify-center w-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-full max-w-xs px-4 py-2"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-sm text-gray-500 mt-1 text-center font-medium"
  }, "Planning..."))) : adjustedProgress.totalSteps > 0 && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "flex justify-center w-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-full px-4 py-2"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "relative w-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "w-full bg-gray-200 rounded-full h-1 dark:bg-gray-700"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "relative w-full h-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute bg-green-600 h-1 rounded-full transition-all duration-300",
    style: {
      width: hasFinalAnswer ? "100%" : adjustedProgress.currentStep / adjustedProgress.totalSteps * 100 + "%"
    }
  }), !hasFinalAnswer && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute bg-magenta-800 h-1 transition-all duration-300",
    style: {
      left: adjustedProgress.currentStep / adjustedProgress.totalSteps * 100 + "%",
      width: 1 / adjustedProgress.totalSteps * 100 + "%"
    }
  }), !hasFinalAnswer && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute bg-gray-300 h-1 rounded-r-full transition-all duration-300",
    style: {
      left: (adjustedProgress.currentStep + 1) / adjustedProgress.totalSteps * 100 + "%",
      width: (adjustedProgress.totalSteps - adjustedProgress.currentStep - 1) / adjustedProgress.totalSteps * 100 + "%"
    }
  }))), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute w-full flex",
    style: {
      top: "-12px",
      height: "24px"
    }
  }, Array.from({
    length: adjustedProgress.totalSteps
  }, (_, index) => {
    var _adjustedProgress$pla;
    const step = (_adjustedProgress$pla = adjustedProgress.plan) === null || _adjustedProgress$pla === void 0 ? void 0 : _adjustedProgress$pla.steps[index];
    const tooltipContent = step ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "font-medium"
    }, "Step ", index + 1, ": ", step.title), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "text-xs mt-1"
    }, step.details)) : "Step " + (index + 1);
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A, {
      key: index,
      title: tooltipContent,
      placement: "top",
      overlayStyle: {
        maxWidth: "300px"
      }
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "absolute h-full " + (onStepClick ? "cursor-pointer" : "cursor-help"),
      style: {
        left: index / adjustedProgress.totalSteps * 100 + "%",
        width: 1 / adjustedProgress.totalSteps * 100 + "%"
      },
      onClick: () => onStepClick === null || onStepClick === void 0 ? void 0 : onStepClick(index)
    }));
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "absolute w-full flex justify-between px-2",
    style: {
      top: "-7px"
    }
  }, Array.from({
    length: adjustedProgress.totalSteps
  }, (_, index) => {
    var _adjustedProgress$pla2;
    const step = (_adjustedProgress$pla2 = adjustedProgress.plan) === null || _adjustedProgress$pla2 === void 0 ? void 0 : _adjustedProgress$pla2.steps[index];
    const tooltipContent = step ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", null, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "font-medium"
    }, "Step ", index + 1, ": ", step.title), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "text-xs mt-1"
    }, step.details)) : "Step " + (index + 1);
    return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      key: index,
      className: "absolute",
      style: {
        left: (index + 0.5) / adjustedProgress.totalSteps * 100 + "%",
        transform: "translateX(-50%)"
      }
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(antd__WEBPACK_IMPORTED_MODULE_1__/* ["default"] */ .A, {
      title: tooltipContent,
      placement: "top",
      overlayStyle: {
        maxWidth: "300px"
      }
    }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
      className: "w-5 h-5 rounded-full flex items-center justify-center " + (onStepClick ? "cursor-pointer" : "cursor-help") + "\n                              " + (hasFinalAnswer || index < adjustedProgress.currentStep ? "bg-green-600 text-white" : index === adjustedProgress.currentStep ? "bg-magenta-800 text-white" : "bg-gray-400 text-white"),
      onClick: () => onStepClick === null || onStepClick === void 0 ? void 0 : onStepClick(index)
    }, hasFinalAnswer || index < adjustedProgress.currentStep ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A, {
      className: "w-4 h-4"
    }) : index === adjustedProgress.currentStep ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement(lucide_react__WEBPACK_IMPORTED_MODULE_3__/* ["default"] */ .A, {
      className: "w-4 h-4 animate-spin"
    }) : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
      className: "text-xs font-medium"
    }, index + 1))));
  })), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("div", {
    className: "text-sm text-gray-500 mt-5 text-center"
  }, hasFinalAnswer ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", {
    className: "text-green-600 font-medium"
  }, "Task Completed") : (_adjustedProgress$pla3 = adjustedProgress.plan) !== null && _adjustedProgress$pla3 !== void 0 && _adjustedProgress$pla3.task ? /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", null, "Step ", adjustedProgress.currentStep + 1, " of", " ", adjustedProgress.totalSteps, ((_adjustedProgress$pla4 = adjustedProgress.plan) === null || _adjustedProgress$pla4 === void 0 ? void 0 : (_adjustedProgress$pla5 = _adjustedProgress$pla4.steps[adjustedProgress.currentStep]) === null || _adjustedProgress$pla5 === void 0 ? void 0 : _adjustedProgress$pla5.title) && ": " + adjustedProgress.plan.steps[adjustedProgress.currentStep].title.substring(0, 30) + "...") : /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_0__.createElement("span", null, "Step ", adjustedProgress.currentStep + 1, " of", " ", adjustedProgress.totalSteps, ((_adjustedProgress$pla6 = adjustedProgress.plan) === null || _adjustedProgress$pla6 === void 0 ? void 0 : (_adjustedProgress$pla7 = _adjustedProgress$pla6.steps[adjustedProgress.currentStep]) === null || _adjustedProgress$pla7 === void 0 ? void 0 : _adjustedProgress$pla7.title) && ": " + adjustedProgress.plan.steps[adjustedProgress.currentStep].title.substring(0, 30) + "..."))))));
}

/***/ }),

/***/ 84152:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _components_features_Agents_useAgentInfo__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(43044);
/* harmony import */ var _hooks_provider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(92744);
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(96540);



const SampleTasks = _ref => {
  var _agentInfo$examples, _agentInfo$examples2;
  let {
    onSelect
  } = _ref;
  const {
    0: isLoading,
    1: setIsLoading
  } = (0,react__WEBPACK_IMPORTED_MODULE_2__.useState)(false);
  const {
    0: isInputFocused,
    1: setIsInputFocused
  } = (0,react__WEBPACK_IMPORTED_MODULE_2__.useState)(true);
  const dropdownRef = (0,react__WEBPACK_IMPORTED_MODULE_2__.useRef)(null);
  const truncateText = function (text, maxWords) {
    if (maxWords === void 0) {
      maxWords = 20;
    }
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ") + "...";
  };
  const {
    user,
    darkMode
  } = (0,react__WEBPACK_IMPORTED_MODULE_2__.useContext)(_hooks_provider__WEBPACK_IMPORTED_MODULE_1__/* .appContext */ .v);
  const {
    agentInfo
  } = (0,_components_features_Agents_useAgentInfo__WEBPACK_IMPORTED_MODULE_0__/* .useAgentInfo */ .B)(user === null || user === void 0 ? void 0 : user.email);

  // 监听输入框焦点
  (0,react__WEBPACK_IMPORTED_MODULE_2__.useEffect)(() => {
    const handleFocus = () => {
      if (agentInfo !== null && agentInfo !== void 0 && agentInfo.examples && agentInfo.examples.length > 3) {
        setIsInputFocused(true);
      }
    };
    const handleBlur = e => {
      if (dropdownRef.current && dropdownRef.current.contains(e.relatedTarget)) {
        return;
      }
      setIsInputFocused(false);
    };
    const findTextarea = () => document.querySelector("#queryInput");
    const attach = ta => {
      ta.addEventListener("focus", handleFocus);
      ta.addEventListener("blur", handleBlur);
    };
    const textarea = findTextarea();
    if (textarea) {
      attach(textarea);
      return () => {
        textarea.removeEventListener("focus", handleFocus);
        textarea.removeEventListener("blur", handleBlur);
      };
    }
    const observer = new MutationObserver(() => {
      const ta = findTextarea();
      if (ta) {
        attach(ta);
        observer.disconnect();
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    return () => observer.disconnect();
  }, [agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.examples]);

  // 点击外部隐藏
  (0,react__WEBPACK_IMPORTED_MODULE_2__.useEffect)(() => {
    if (!isInputFocused) return;
    const handleClickOutside = event => {
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) return;
      const textarea = document.querySelector("#queryInput");
      if (textarea && textarea.contains(event.target)) return;
      setIsInputFocused(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isInputFocused]);
  const handleTaskSelect = async task => {
    try {
      setIsLoading(true);
      onSelect(task);
      setIsInputFocused(false);
    } catch (_unused) {
      onSelect(task);
      setIsInputFocused(false);
    } finally {
      setIsLoading(false);
    }
  };
  const shouldShowDropdown = (agentInfo === null || agentInfo === void 0 ? void 0 : agentInfo.examples) && agentInfo.examples.length > 3;
  return /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "w-full"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("style", null, "\n        .sample-tasks-scrollbar::-webkit-scrollbar { width: 6px; }\n        .sample-tasks-scrollbar::-webkit-scrollbar-track { background: transparent; }\n        .sample-tasks-scrollbar::-webkit-scrollbar-thumb {\n          background: rgba(156,163,175,0.3); border-radius: 3px;\n        }\n        .sample-tasks-scrollbar::-webkit-scrollbar-thumb:hover {\n          background: rgba(156,163,175,0.5);\n        }\n        .sample-tasks-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(156,163,175,0.3) transparent; }\n      "), shouldShowDropdown && isInputFocused && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    ref: dropdownRef,
    className: "w-full rounded-b-2xl overflow-hidden border-border-primary mt-1"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "max-h-[400px] flex flex-col items-center overflow-y-auto sample-tasks-scrollbar"
  }, agentInfo === null || agentInfo === void 0 ? void 0 : (_agentInfo$examples = agentInfo.examples) === null || _agentInfo$examples === void 0 ? void 0 : _agentInfo$examples.map((task, idx) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("button", {
    key: idx,
    className: "w-[94%] px-4 py-3 text-left transition-smooth text-primary hover:text-accent border-b last:border-b-0 group " + (darkMode === "dark" ? "hover:bg-[#1a1a1a] hover:rounded-lg" : "hover:bg-gray-50 hover:rounded-lg"),
    style: {
      borderBottomColor: "#434141"
    },
    onClick: () => handleTaskSelect(task),
    disabled: isLoading,
    type: "button",
    title: task
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "text-sm leading-loose line-clamp-2"
  }, truncateText(task, 22)))))), !shouldShowDropdown && /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex flex-wrap justify-center gap-3 w-full mt-2"
  }, agentInfo === null || agentInfo === void 0 ? void 0 : (_agentInfo$examples2 = agentInfo.examples) === null || _agentInfo$examples2 === void 0 ? void 0 : _agentInfo$examples2.map((task, idx) => /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("button", {
    key: idx,
    className: "flex-1 min-w-[260px] max-w-[380px] rounded-2xl px-5 py-4 text-left transition-all duration-200 animate-fade-in group border " + (darkMode === "dark" ? "bg-white/[0.03] border-border-primary/50 hover:border-accent/40 hover:bg-white/[0.06]" : "bg-white/80 border-gray-200/70 hover:border-violet-300/70 hover:bg-violet-50/60") + " shadow-sm hover:shadow-modern",
    style: {
      animationDelay: idx * 0.08 + "s"
    },
    onClick: () => handleTaskSelect(task),
    disabled: isLoading,
    type: "button",
    title: "\u70B9\u51FB\u586B\u5145\u5230\u8F93\u5165\u6846\uFF0C\u53EF\u7F16\u8F91\u540E\u53D1\u9001"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "text-sm leading-relaxed text-secondary group-hover:text-primary transition-colors line-clamp-3"
  }, task), /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("div", {
    className: "flex items-center gap-1.5 mt-3"
  }, /*#__PURE__*/react__WEBPACK_IMPORTED_MODULE_2__.createElement("span", {
    className: "text-[10px] font-medium text-secondary/50 group-hover:text-accent/70 transition-colors uppercase tracking-wide"
  }, isLoading ? "处理中..." : "点击使用"))))));
};
/* harmony default export */ __webpack_exports__["default"] = (SampleTasks);

/***/ }),

/***/ 79804:
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: function() { return /* binding */ CircleCheck; }
/* harmony export */ });
/* harmony import */ var _createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9407);
/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */



const CircleCheck = (0,_createLucideIcon_js__WEBPACK_IMPORTED_MODULE_0__/* ["default"] */ .A)("CircleCheck", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
]);


//# sourceMappingURL=circle-check.js.map


/***/ }),

/***/ 97040:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var DESCRIPTORS = __webpack_require__(43724);
var definePropertyModule = __webpack_require__(24913);
var createPropertyDescriptor = __webpack_require__(6980);

module.exports = function (object, key, value) {
  if (DESCRIPTORS) definePropertyModule.f(object, key, createPropertyDescriptor(0, value));
  else object[key] = value;
};


/***/ }),

/***/ 76080:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var uncurryThis = __webpack_require__(27476);
var aCallable = __webpack_require__(79306);
var NATIVE_BIND = __webpack_require__(40616);

var bind = uncurryThis(uncurryThis.bind);

// optional / simple context binding
module.exports = function (fn, that) {
  aCallable(fn);
  return that === undefined ? fn : NATIVE_BIND ? bind(fn, that) : function (/* ...args */) {
    return fn.apply(that, arguments);
  };
};


/***/ }),

/***/ 27476:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var classofRaw = __webpack_require__(22195);
var uncurryThis = __webpack_require__(79504);

module.exports = function (fn) {
  // Nashorn bug:
  //   https://github.com/zloirock/core-js/issues/1128
  //   https://github.com/zloirock/core-js/issues/1130
  if (classofRaw(fn) === 'Function') return uncurryThis(fn);
};


/***/ }),

/***/ 50851:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var classof = __webpack_require__(36955);
var getMethod = __webpack_require__(55966);
var isNullOrUndefined = __webpack_require__(64117);
var Iterators = __webpack_require__(26269);
var wellKnownSymbol = __webpack_require__(78227);

var ITERATOR = wellKnownSymbol('iterator');

module.exports = function (it) {
  if (!isNullOrUndefined(it)) return getMethod(it, ITERATOR)
    || getMethod(it, '@@iterator')
    || Iterators[classof(it)];
};


/***/ }),

/***/ 70081:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var call = __webpack_require__(69565);
var aCallable = __webpack_require__(79306);
var anObject = __webpack_require__(28551);
var tryToString = __webpack_require__(16823);
var getIteratorMethod = __webpack_require__(50851);

var $TypeError = TypeError;

module.exports = function (argument, usingIterator) {
  var iteratorMethod = arguments.length < 2 ? getIteratorMethod(argument) : usingIterator;
  if (aCallable(iteratorMethod)) return anObject(call(iteratorMethod, argument));
  throw new $TypeError(tryToString(argument) + ' is not iterable');
};


/***/ }),

/***/ 44209:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var wellKnownSymbol = __webpack_require__(78227);
var Iterators = __webpack_require__(26269);

var ITERATOR = wellKnownSymbol('iterator');
var ArrayPrototype = Array.prototype;

// check on default Array iterator
module.exports = function (it) {
  return it !== undefined && (Iterators.Array === it || ArrayPrototype[ITERATOR] === it);
};


/***/ }),

/***/ 72652:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var bind = __webpack_require__(76080);
var call = __webpack_require__(69565);
var anObject = __webpack_require__(28551);
var tryToString = __webpack_require__(16823);
var isArrayIteratorMethod = __webpack_require__(44209);
var lengthOfArrayLike = __webpack_require__(26198);
var isPrototypeOf = __webpack_require__(1625);
var getIterator = __webpack_require__(70081);
var getIteratorMethod = __webpack_require__(50851);
var iteratorClose = __webpack_require__(9539);

var $TypeError = TypeError;

var Result = function (stopped, result) {
  this.stopped = stopped;
  this.result = result;
};

var ResultPrototype = Result.prototype;

module.exports = function (iterable, unboundFunction, options) {
  var that = options && options.that;
  var AS_ENTRIES = !!(options && options.AS_ENTRIES);
  var IS_RECORD = !!(options && options.IS_RECORD);
  var IS_ITERATOR = !!(options && options.IS_ITERATOR);
  var INTERRUPTED = !!(options && options.INTERRUPTED);
  var fn = bind(unboundFunction, that);
  var iterator, iterFn, index, length, result, next, step;

  var stop = function (condition) {
    if (iterator) iteratorClose(iterator, 'normal', condition);
    return new Result(true, condition);
  };

  var callFn = function (value) {
    if (AS_ENTRIES) {
      anObject(value);
      return INTERRUPTED ? fn(value[0], value[1], stop) : fn(value[0], value[1]);
    } return INTERRUPTED ? fn(value, stop) : fn(value);
  };

  if (IS_RECORD) {
    iterator = iterable.iterator;
  } else if (IS_ITERATOR) {
    iterator = iterable;
  } else {
    iterFn = getIteratorMethod(iterable);
    if (!iterFn) throw new $TypeError(tryToString(iterable) + ' is not iterable');
    // optimisation for array iterators
    if (isArrayIteratorMethod(iterFn)) {
      for (index = 0, length = lengthOfArrayLike(iterable); length > index; index++) {
        result = callFn(iterable[index]);
        if (result && isPrototypeOf(ResultPrototype, result)) return result;
      } return new Result(false);
    }
    iterator = getIterator(iterable, iterFn);
  }

  next = IS_RECORD ? iterable.next : iterator.next;
  while (!(step = call(next, iterator)).done) {
    try {
      result = callFn(step.value);
    } catch (error) {
      iteratorClose(iterator, 'throw', error);
    }
    if (typeof result == 'object' && result && isPrototypeOf(ResultPrototype, result)) return result;
  } return new Result(false);
};


/***/ }),

/***/ 9539:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {


var call = __webpack_require__(69565);
var anObject = __webpack_require__(28551);
var getMethod = __webpack_require__(55966);

module.exports = function (iterator, kind, value) {
  var innerResult, innerError;
  anObject(iterator);
  try {
    innerResult = getMethod(iterator, 'return');
    if (!innerResult) {
      if (kind === 'throw') throw value;
      return value;
    }
    innerResult = call(innerResult, iterator);
  } catch (error) {
    innerError = true;
    innerResult = error;
  }
  if (kind === 'throw') throw value;
  if (innerError) throw innerResult;
  anObject(innerResult);
  return value;
};


/***/ }),

/***/ 26269:
/***/ (function(module) {


module.exports = {};


/***/ }),

/***/ 53921:
/***/ (function(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {


var $ = __webpack_require__(46518);
var iterate = __webpack_require__(72652);
var createProperty = __webpack_require__(97040);

// `Object.fromEntries` method
// https://tc39.es/ecma262/#sec-object.fromentries
$({ target: 'Object', stat: true }, {
  fromEntries: function fromEntries(iterable) {
    var obj = {};
    iterate(iterable, function (k, v) {
      createProperty(obj, k, v);
    }, { AS_ENTRIES: true });
    return obj;
  }
});


/***/ })

}]);
//# sourceMappingURL=fc61beafdeb0d0e1e0522f1acdd90236a9b28374-0f794cd02690411c488c.js.map