package ai.drsai.remote

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import ai.drsai.remote.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.WebSocket
import org.json.JSONObject
import java.util.UUID

class AppViewModel(app: Application): AndroidViewModel(app) {
    private val tokenStore = SecureTokenStore(app)
    private val db = Room.databaseBuilder(app, ChatDatabase::class.java, "opendrsai.db").build()
    private val api = OpenDrSaiApi(tokens=tokenStore)
    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()
    private var socket: WebSocket? = null
    private var runId: String? = null
    private var streamText = ""
    private var loginJob: Job? = null

    init { bootstrap() }
    private fun update(block:(AppState)->AppState) { _state.value=block(_state.value) }

    fun bootstrap() = viewModelScope.launch {
        update { it.copy(destination=AppDestination.Splash,error=null) }
        if(tokenStore.accessToken==null) { update { it.copy(destination=AppDestination.Login) }; return@launch }
        runCatching { api.me() }.onSuccess { enter(it) }.onFailure { tokenStore.clear(); update { it.copy(destination=AppDestination.Login,error="登录已过期，请重新登录") } }
    }
    fun login() = viewModelScope.launch {
        if(loginJob?.isActive==true) return@launch
        update { it.copy(loading=true,error=null) }
        runCatching { api.startLogin() }.onSuccess { p ->
            update { it.copy(loading=false,loginUrl=p.loginUrl) }
            getApplication<Application>().startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(p.loginUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            loginJob=viewModelScope.launch { runCatching { api.pollLogin(p) }.onSuccess { a -> tokenStore.accessToken=a.accessToken;tokenStore.refreshToken=a.refreshToken;tokenStore.userId=a.user.id;enter(a.user) }.onFailure { e->update{it.copy(loading=false,error=e.message)} } }
        }.onFailure { e -> update { it.copy(loading=false,error=e.message) } }
    }
    fun devLogin() = viewModelScope.launch { update{it.copy(loading=true,error=null)};runCatching{api.devLogin()}.onSuccess{a->tokenStore.accessToken=a.accessToken;tokenStore.refreshToken=a.refreshToken;tokenStore.userId=a.user.id;enter(a.user)}.onFailure{e->update{it.copy(loading=false,error="本地登录失败：${e.message}")}} }
    private fun enter(user: User) = viewModelScope.launch {
        update { it.copy(destination=AppDestination.Chat,user=user,loading=true,error=null) }
        val cached = db.dao().conversationSnapshot().map { Conversation(it.id,it.title,it.updatedAt,it.agentId) }
        if (cached.isNotEmpty()) update { it.copy(conversations=cached) }
        val agents=runCatching { api.agents(user.id) }.getOrElse { emptyList() }
        val sessions=runCatching { api.conversations(user.id) }.getOrElse { cached }
        db.dao().saveConversations(sessions.map{ConversationEntity(it.id,it.title,it.updatedAt,it.agentId)})
        val selected=agents.firstOrNull{it.id==tokenStore.defaultAgentId} ?: agents.firstOrNull{it.available}
        update { it.copy(agents=agents,selectedAgent=selected,conversations=sessions,loading=false,error=if(agents.isEmpty()) "没有可用的 Agent" else null) }
    }
    fun selectAgent(agent: Agent) { tokenStore.defaultAgentId=agent.id; update{it.copy(selectedAgent=agent)};viewModelScope.launch{runCatching{api.setDefaultAgent(agent.id)}.onFailure{e->update{it.copy(error=e.message)}}} }
    fun newConversation() { socket?.cancel();runId=null;update{it.copy(currentConversation=null,messages=emptyList(),historyOpen=false,error=null)} }
    fun openConversation(c: Conversation) = viewModelScope.launch {
        val u=_state.value.user?:return@launch; update{it.copy(loading=true,currentConversation=c,historyOpen=false,error=null)}
        val cached=db.dao().messageSnapshot(c.id).map{ChatMessage(it.id,it.conversationId,it.role,it.text,it.createdAt,it.status)}
        if(cached.isNotEmpty()) update{it.copy(messages=cached)}
        runCatching { api.history(c,u.id) }.onSuccess { (messages,run)->runId=run;db.dao().saveMessages(messages.map{MessageEntity(it.id,it.conversationId,it.role,it.text,it.createdAt,it.status)});update{it.copy(messages=messages,loading=false)} }.onFailure{e->update{it.copy(loading=false,error=e.message)}}
    }
    fun send(text:String) = viewModelScope.launch {
        val clean=text.trim(); val s=_state.value; val u=s.user?:return@launch; val agent=s.selectedAgent?:return@launch
        if(clean.isEmpty()||s.streaming)return@launch
        var conversation=s.currentConversation
        if(conversation==null) { runCatching { api.createConversation(u.id,agent) }.onSuccess { (c,r)->conversation=c;runId=r;update{it.copy(currentConversation=c,conversations=listOf(c)+it.conversations)} }.onFailure{e->update{it.copy(error=e.message)};return@launch} }
        var c=conversation?:return@launch
        if(c.title=="新对话") { val title=clean.replace("\n"," ").take(32);c=c.copy(title=title);conversation=c;update{it.copy(currentConversation=c,conversations=it.conversations.map{x->if(x.id==c.id)c else x})};db.dao().saveConversations(listOf(ConversationEntity(c.id,c.title,c.updatedAt,c.agentId)));launch{runCatching{api.renameConversation(c.id,title)}} }
        val userMsg=ChatMessage(UUID.randomUUID().toString(),c.id,"user",clean); val assistant=ChatMessage("stream-${UUID.randomUUID()}",c.id,"assistant","",status="streaming")
        streamText="";update{it.copy(messages=it.messages+userMsg+assistant,streaming=true,error=null)}
        db.dao().saveMessages(listOf(userMsg,assistant).map{MessageEntity(it.id,it.conversationId,it.role,it.text,it.createdAt,it.status)})
        socket=api.stream(runId?:return@launch,clean,agent,::handleEvent){e->if(_state.value.streaming)update{it.copy(streaming=false,error=e?.message?:"连接已结束")}}
    }
    private fun handleEvent(type:String,data:String) { viewModelScope.launch(Dispatchers.Main) {
        when(type) {
            "message_chunk" -> append(extractText(data))
            "message", "message_task" -> { val t=extractText(data);if(t.isNotBlank())append(t) }
            "completion", "result" -> { val t=extractCompletion(data);if(t.isNotBlank())replaceLast(t);finish() }
            "message_log", "tool_call_summary" -> update{it.copy(error=null)}
            "error" -> { update{it.copy(streaming=false,error=extractText(data).ifBlank{"生成失败"})} }
        }
    } }
    private fun extractText(raw:String):String { val j=runCatching{JSONObject(raw)}.getOrNull()?:return raw.trim('"'); return j.optString("content",j.optString("text")) }
    private fun extractCompletion(raw:String):String { val j=runCatching{JSONObject(raw)}.getOrNull()?:return raw.trim('"'); val messages=j.optJSONObject("task_result")?.optJSONArray("messages")?:return extractText(raw); for(i in messages.length()-1 downTo 0){val m=messages.optJSONObject(i)?:continue;val t=m.optString("content");if(t.isNotBlank())return t};return "" }
    private fun append(delta:String){if(delta.isBlank())return;streamText+=delta;replaceLast(streamText)}
    private fun replaceLast(text:String){update{ val list=it.messages.toMutableList();if(list.isNotEmpty()){val m=list.last();list[list.lastIndex]=m.copy(text=text)};it.copy(messages=list)}}
    private fun finish(){socket?.close(1000,"complete");socket=null;update{it.copy(streaming=false)};val m=_state.value.messages.lastOrNull()?:return;viewModelScope.launch{db.dao().saveMessages(listOf(MessageEntity(m.id,m.conversationId,m.role,m.text,m.createdAt,"complete")))}}
    fun stop(){socket?.send(JSONObject().put("type","stop").put("reason","User requested stop").toString());socket?.close(1000,"stopped");socket=null;update{it.copy(streaming=false)}}
    fun retry(){val last=_state.value.messages.lastOrNull{it.role=="user"}?.text?:return;send(last)}
    fun deleteConversation(c:Conversation)=viewModelScope.launch{val u=_state.value.user?:return@launch;runCatching{api.deleteConversation(c.id,u.id)}.onSuccess{db.dao().deleteMessages(c.id);db.dao().deleteConversation(c.id);update{it.copy(conversations=it.conversations.filterNot{x->x.id==c.id},currentConversation=if(it.currentConversation?.id==c.id)null else it.currentConversation,messages=if(it.currentConversation?.id==c.id)emptyList() else it.messages)}}}
    fun toggleHistory(open:Boolean){update{it.copy(historyOpen=open)}};fun toggleProfile(open:Boolean){update{it.copy(profileOpen=open)}}
    fun setTheme(value:Boolean?){update{it.copy(darkTheme=value)}}
    fun logout(){socket?.cancel();viewModelScope.launch{runCatching{api.logout()};tokenStore.clear();update{AppState(destination=AppDestination.Login)}}}
}
