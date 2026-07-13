package ai.drsai.remote.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import ai.drsai.remote.AppViewModel
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.data.*
import kotlinx.coroutines.launch

private val Green=androidx.compose.ui.graphics.Color(0xFF25634A)
private val Lime=androidx.compose.ui.graphics.Color(0xFFD8F58A)

@Composable fun OpenDrSaiApp(vm:AppViewModel=viewModel()) {
    val state by vm.state.collectAsState()
    val dark=state.darkTheme ?: androidx.compose.foundation.isSystemInDarkTheme()
    MaterialTheme(colorScheme=if(dark) darkColorScheme(primary=Lime,secondary=Green) else lightColorScheme(primary=Green,secondary=Lime)) {
        Surface(Modifier.fillMaxSize()) { when(state.destination){AppDestination.Splash->Splash();AppDestination.Login->Login(state,vm);AppDestination.Chat->ChatHome(state,vm)} }
    }
}

@Composable private fun Splash(){Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally){Text("OpenDrSai",style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.Bold);Spacer(Modifier.height(8.dp));Text("Your personal AI agents");Spacer(Modifier.height(24.dp));CircularProgressIndicator()}}}

@Composable private fun Login(s:AppState,vm:AppViewModel){
    Box(Modifier.fillMaxSize().padding(28.dp),contentAlignment=Alignment.Center){Column(Modifier.widthIn(max=420.dp),horizontalAlignment=Alignment.CenterHorizontally){
        Text("OpenDrSai",style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.Bold);Text("登录后开始与智能 Agent 对话",style=MaterialTheme.typography.bodyLarge);Spacer(Modifier.height(42.dp))
        Button(onClick=vm::login,enabled=!s.loading,modifier=Modifier.fillMaxWidth().height(54.dp)){if(s.loading)CircularProgressIndicator(Modifier.size(22.dp),strokeWidth=2.dp) else Icon(Icons.Default.Login,null);Spacer(Modifier.width(8.dp));Text(if(s.loginUrl==null)"使用 HAI 账号登录" else "等待浏览器授权")}
        if(BuildConfig.DEBUG){Spacer(Modifier.height(10.dp));OutlinedButton(onClick=vm::devLogin,enabled=!s.loading,modifier=Modifier.fillMaxWidth()){Text("本地开发登录")}}
        s.error?.let{Spacer(Modifier.height(16.dp));Text(it,color=MaterialTheme.colorScheme.error)}
        Spacer(Modifier.height(28.dp));Text("登录即表示同意《用户协议》和《隐私政策》",style=MaterialTheme.typography.bodySmall)
    }}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ChatHome(s:AppState,vm:AppViewModel){
    val drawer=rememberDrawerState(if(s.historyOpen)DrawerValue.Open else DrawerValue.Closed)
    LaunchedEffect(s.historyOpen){if(s.historyOpen)drawer.open() else drawer.close()}
    ModalNavigationDrawer(drawerState=drawer,drawerContent={HistoryDrawer(s,vm)}){
        Scaffold(topBar={TopAppBar(title={Text(s.currentConversation?.title?:"OpenDrSai",maxLines=1)},navigationIcon={IconButton({vm.toggleHistory(true)}){Icon(Icons.Default.Menu,"历史会话")}},actions={IconButton(vm::newConversation){Icon(Icons.Default.Add,"新对话")};IconButton({vm.toggleProfile(true)}){Icon(Icons.Default.AccountCircle,"个人中心")}})}){pad->
            Column(Modifier.fillMaxSize().padding(pad)){s.error?.let{ErrorBar(it,vm::retry)};if(s.messages.isEmpty())Welcome(s,vm,Modifier.weight(1f))else Messages(s,Modifier.weight(1f));Composer(s,vm)}
        }
        if(s.profileOpen)Profile(s,vm)
    }
}

@Composable private fun Welcome(s:AppState,vm:AppViewModel,modifier:Modifier){Box(modifier.fillMaxWidth().padding(24.dp),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally){Text("你好，我是 OpenDrSai",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold);Text("今天想完成什么？",style=MaterialTheme.typography.bodyLarge);Spacer(Modifier.height(32.dp));listOf("帮我制定一个工作计划","解释一段代码","总结一篇技术文章").forEach{OutlinedButton({vm.send(it)},Modifier.fillMaxWidth()){Text(it)}}}}}

@Composable private fun Messages(s:AppState,modifier:Modifier){val list=rememberLazyListState();LaunchedEffect(s.messages.size,s.messages.lastOrNull()?.text){if(s.messages.isNotEmpty())list.animateScrollToItem(s.messages.lastIndex)};LazyColumn(modifier.fillMaxWidth(),state=list,contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){items(s.messages,key={it.id}){MessageBubble(it)}}}

@Composable private fun MessageBubble(m:ChatMessage){val user=m.role=="user";val ctx=LocalContext.current;Column(Modifier.fillMaxWidth(),horizontalAlignment=if(user)Alignment.End else Alignment.Start){Text(if(user)"你" else "OpenDrSai",style=MaterialTheme.typography.labelMedium,fontWeight=FontWeight.Bold);Surface(color=if(user)MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,shape=RoundedCornerShape(16.dp),modifier=Modifier.widthIn(max=620.dp)){Column(Modifier.padding(14.dp)){if(m.text.contains("```"))CodeAwareText(m.text) else Text(m.text.ifBlank{"正在思考…"});if(!user&&m.text.isNotBlank()){Spacer(Modifier.height(8.dp));IconButton({(ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("OpenDrSai",m.text))},Modifier.size(30.dp)){Icon(Icons.Default.ContentCopy,"复制",Modifier.size(16.dp))}}}}}}

@Composable private fun CodeAwareText(text:String){val parts=text.split("```");Column{parts.forEachIndexed{i,p->if(i%2==1)Surface(color=MaterialTheme.colorScheme.surface,shape=RoundedCornerShape(8.dp)){Text(p.trim().substringAfter('\n',p.trim()),Modifier.fillMaxWidth().padding(12.dp),fontFamily=FontFamily.Monospace)}else if(p.isNotBlank())Text(p.trim())}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun Composer(s:AppState,vm:AppViewModel){var text by remember{mutableStateOf("")};var agents by remember{mutableStateOf(false)};Column(Modifier.fillMaxWidth().imePadding().padding(12.dp)){TextButton({agents=true}){Icon(Icons.Default.SmartToy,null);Spacer(Modifier.width(5.dp));Text(s.selectedAgent?.name?:"选择 Agent");Icon(Icons.Default.ArrowDropDown,null)};Row(verticalAlignment=Alignment.Bottom){OutlinedTextField(text,{text=it},Modifier.weight(1f),placeholder={Text("给 Agent 发送消息…")},maxLines=6,enabled=!s.streaming);Spacer(Modifier.width(8.dp));FilledIconButton(onClick={if(s.streaming)vm.stop() else {vm.send(text);text=""}},enabled=s.streaming||text.isNotBlank()){Icon(if(s.streaming)Icons.Default.Stop else Icons.Default.ArrowUpward,if(s.streaming)"停止" else "发送")}}}
    if(agents)ModalBottomSheet({agents=false}){Text("选择 Agent",Modifier.padding(20.dp),style=MaterialTheme.typography.titleLarge);s.agents.forEach{a->ListItem(headlineContent={Text(a.name)},supportingContent={Text(a.description)},leadingContent={Icon(Icons.Default.SmartToy,null)},trailingContent={if(a.id==s.selectedAgent?.id)Icon(Icons.Default.Check,null)},modifier=Modifier.clickable(enabled=a.available){vm.selectAgent(a);agents=false})};Spacer(Modifier.height(24.dp))}}

@Composable private fun HistoryDrawer(s:AppState,vm:AppViewModel){ModalDrawerSheet(Modifier.widthIn(max=340.dp)){Row(Modifier.fillMaxWidth().padding(16.dp),verticalAlignment=Alignment.CenterVertically){Text("历史会话",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f));IconButton(vm::newConversation){Icon(Icons.Default.Add,"新对话")}};HorizontalDivider();if(s.conversations.isEmpty())Text("暂无会话",Modifier.padding(24.dp));LazyColumn{items(s.conversations,key={it.id}){c->ListItem(headlineContent={Text(c.title,maxLines=1)},supportingContent={Text(c.updatedAt,maxLines=1)},trailingContent={IconButton({vm.deleteConversation(c)}){Icon(Icons.Default.Delete,"删除")}},modifier=Modifier.clickable{vm.openConversation(c)})}}}}

@Composable private fun ErrorBar(text:String,retry:()->Unit){Surface(color=MaterialTheme.colorScheme.errorContainer){Row(Modifier.fillMaxWidth().padding(10.dp),verticalAlignment=Alignment.CenterVertically){Text(text,Modifier.weight(1f),color=MaterialTheme.colorScheme.onErrorContainer);TextButton(retry){Text("重试")}}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun Profile(s:AppState,vm:AppViewModel){ModalBottomSheet({vm.toggleProfile(false)}){Column(Modifier.fillMaxWidth().padding(22.dp)){Text("个人中心",style=MaterialTheme.typography.headlineSmall);Spacer(Modifier.height(16.dp));Text(s.user?.name.orEmpty(),fontWeight=FontWeight.Bold);Text(s.user?.id.orEmpty());HorizontalDivider(Modifier.padding(vertical=16.dp));Text("主题",fontWeight=FontWeight.Bold);Row{FilterChip(s.darkTheme==null,{vm.setTheme(null)},{Text("跟随系统")});Spacer(Modifier.width(8.dp));FilterChip(s.darkTheme==false,{vm.setTheme(false)},{Text("浅色")});Spacer(Modifier.width(8.dp));FilterChip(s.darkTheme==true,{vm.setTheme(true)},{Text("深色")})};ListItem(headlineContent={Text("默认 Agent")},supportingContent={Text(s.selectedAgent?.name?:"未选择")});TextButton(onClick={vm.logout();vm.toggleProfile(false)},colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)){Icon(Icons.Default.Logout,null);Spacer(Modifier.width(8.dp));Text("退出登录")};Spacer(Modifier.height(20.dp))}}}
