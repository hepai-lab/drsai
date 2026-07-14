package ai.drsai.remote.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.material3.rememberDrawerState
import ai.drsai.remote.AppViewModel
import ai.drsai.remote.R
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.Agent
import ai.drsai.remote.data.ChatMessage
import kotlinx.coroutines.launch

private val OpenDrSaiGreen = Color(0xFF25634A)
private val OpenDrSaiLime = Color(0xFFD8F58A)

@Composable
private fun BrandLogo(size: Dp) {
    Image(
        painter = painterResource(R.drawable.opendrsai_logo),
        contentDescription = stringResource(R.string.logo_content_description),
        modifier = Modifier.size(size),
        contentScale = ContentScale.Fit,
    )
}

@Composable
fun OpenDrSaiApp(viewModel: AppViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    val dark = state.darkTheme ?: isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) darkColorScheme(primary = OpenDrSaiLime) else lightColorScheme(primary = OpenDrSaiGreen),
    ) {
        Surface(Modifier.fillMaxSize()) {
            when (state.destination) {
                AppDestination.Splash -> SplashScreen()
                AppDestination.Login -> LoginScreen(state, viewModel)
                AppDestination.Chat -> ChatScreen(state, viewModel)
            }
        }
    }
}

@Composable
private fun SplashScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BrandLogo(112.dp)
            Spacer(Modifier.height(18.dp))
            Text("OpenDrSai", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("你的智能 Agent")
            Spacer(Modifier.height(24.dp))
            CircularProgressIndicator()
        }
    }
}

@Composable
private fun LoginScreen(state: AppState, viewModel: AppViewModel) {
    val context = LocalContext.current
    LaunchedEffect(state.loginUrl) {
        state.loginUrl?.let { url ->
            runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url)) }
                .onFailure { viewModel.cancelLogin() }
            viewModel.loginUrlOpened()
        }
    }
    Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            BrandLogo(148.dp)
            Spacer(Modifier.height(18.dp))
            Text("OpenDrSai", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("登录后开始与智能 Agent 对话", style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(42.dp))
            Button(
                onClick = viewModel::login,
                enabled = !state.loading && !state.waitingForLogin,
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) {
                if (state.loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Login, null)
                Spacer(Modifier.width(8.dp))
                Text(if (state.waitingForLogin) "等待浏览器授权" else "使用 HepAI 继续")
            }
            if (state.waitingForLogin) {
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = viewModel::cancelLogin, modifier = Modifier.fillMaxWidth()) { Text("取消登录") }
                Spacer(Modifier.height(8.dp))
                Text("请在浏览器完成授权，然后返回 OpenDrSai", style = MaterialTheme.typography.bodySmall)
            }
            state.error?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(28.dp))
            Text("登录即表示同意《用户协议》和《隐私政策》", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatScreen(state: AppState, viewModel: AppViewModel) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    fun closeDrawer() = scope.launch { drawerState.close() }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            NavigationDrawer(
                state = state,
                onNewConversation = {
                    viewModel.newConversation()
                    closeDrawer()
                },
                onOpenConversation = {
                    viewModel.openConversation(it)
                    closeDrawer()
                },
                onSelectAgent = {
                    viewModel.selectAgent(it)
                    closeDrawer()
                },
                onRefreshAgents = viewModel::refreshAgents,
                onOpenProfile = {
                    closeDrawer()
                    viewModel.toggleProfile(true)
                },
            )
        },
    ) {
        Scaffold { systemPadding ->
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(systemPadding)
                    .imePadding(),
            ) {
                if (state.messages.isEmpty()) {
                    Welcome(state.selectedAgent, Modifier.fillMaxSize().padding(top = 82.dp, bottom = 92.dp))
                } else {
                    Messages(state.messages, state.selectedAgent?.name ?: "OpenDrSai", Modifier.fillMaxSize())
                }

                Column(
                    Modifier.align(Alignment.TopCenter).padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FloatingHeader(
                        onOpenDrawer = { scope.launch { drawerState.open() } },
                        onNewConversation = viewModel::newConversation,
                        newConversationEnabled = !state.streaming,
                    )
                    state.error?.let { ErrorBar(it, viewModel::retry) }
                    state.runtimeStatus?.let { RuntimeBar(it) }
                    if (state.toolDowngraded) RuntimeBar("当前模型以纯对话模式运行，本地工具暂不可用")
                }

                Composer(
                    state = state,
                    onSend = viewModel::send,
                    onStop = viewModel::stop,
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
        }
    }
    if (state.profileOpen) ProfileSheet(state, viewModel)
}

@Composable
internal fun FloatingHeader(
    onOpenDrawer: () -> Unit,
    onNewConversation: () -> Unit,
    newConversationEnabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val controlColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.60f)
    Row(
        modifier = modifier.fillMaxWidth().height(52.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(52.dp),
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            tonalElevation = 2.dp,
            shadowElevation = 5.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            IconButton(onClick = onOpenDrawer) { Icon(Icons.Default.Menu, "展开侧栏") }
        }
        Spacer(Modifier.width(6.dp))
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            tonalElevation = 2.dp,
            shadowElevation = 5.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Box(
                Modifier.height(52.dp).padding(horizontal = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("OpenDrSai", fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(Modifier.weight(1f))
        Surface(
            modifier = Modifier.size(52.dp),
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            tonalElevation = 2.dp,
            shadowElevation = 5.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            IconButton(onClick = onNewConversation, enabled = newConversationEnabled) {
                Icon(Icons.Default.Add, "新对话")
            }
        }
    }
}

@Composable
private fun NavigationDrawer(
    state: AppState,
    onNewConversation: () -> Unit,
    onOpenConversation: (String) -> Unit,
    onSelectAgent: (String) -> Unit,
    onRefreshAgents: () -> Unit,
    onOpenProfile: () -> Unit,
) {
    ModalDrawerSheet(Modifier.fillMaxHeight().widthIn(max = 320.dp)) {
        Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BrandLogo(38.dp)
                Spacer(Modifier.width(10.dp))
                Text("OpenDrSai", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(18.dp))
            Button(onClick = onNewConversation, modifier = Modifier.fillMaxWidth(), enabled = !state.streaming) {
                Icon(Icons.Default.Add, null)
                Spacer(Modifier.width(8.dp))
                Text("新对话")
            }
            Spacer(Modifier.height(18.dp))
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("智能体", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                        IconButton(
                            onClick = onRefreshAgents,
                            enabled = state.agentCatalogStatus.state != "loading" && !state.streaming,
                            modifier = Modifier.size(36.dp),
                        ) {
                            if (state.agentCatalogStatus.state == "loading") {
                                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.Refresh, "刷新智能体", Modifier.size(19.dp))
                            }
                        }
                    }
                }
                items(state.agents, key = { "agent:${it.id}" }) { agent ->
                    NavigationDrawerItem(
                        label = {
                            Column {
                                Text(agent.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    agentStatus(agent),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        },
                        badge = { if (agent.isDefault) Text("默认", style = MaterialTheme.typography.labelSmall) },
                        selected = state.selectedAgent?.id == agent.id,
                        onClick = { if (!state.streaming) onSelectAgent(agent.id) },
                    )
                }
                item {
                    state.agentCatalogStatus.message?.let { message ->
                        Text(
                            message,
                            Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (state.agentCatalogStatus.state == "error") {
                                MaterialTheme.colorScheme.error
                            } else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    HorizontalDivider(Modifier.padding(vertical = 10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.History, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("本机会话", style = MaterialTheme.typography.labelLarge)
                    }
                    Spacer(Modifier.height(8.dp))
                }
                if (state.conversations.isEmpty()) {
                    item { Text("还没有本地对话", Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium) }
                } else {
                    items(state.conversations, key = { it.id }) { conversation ->
                        NavigationDrawerItem(
                            label = { Text(conversation.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                            selected = state.currentConversation?.id == conversation.id,
                            onClick = { onOpenConversation(conversation.id) },
                        )
                    }
                }
            }
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            Text(if (state.selectedAgent?.source == "platform") "当前智能体" else "当前模型", style = MaterialTheme.typography.labelMedium)
            Text(
                if (state.selectedAgent?.source == "platform") state.selectedAgent.name
                else state.selectedModel?.name ?: "正在加载 HAI 模型",
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(8.dp))
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.AccountCircle, null) },
                label = { Text(state.user?.name ?: "个人中心", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                selected = false,
                onClick = onOpenProfile,
            )
        }
    }
}

private fun agentStatus(agent: Agent): String = when {
    !agent.available -> "当前不可用"
    !agent.chatSupported -> "暂不支持对话"
    agent.source == "local" -> "Android 本机运行"
    agent.mode == "ddf" -> "HAI 平台运行"
    else -> "远程智能体"
}

@Composable
private fun RuntimeBar(message: String) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer) {
        Text(message, Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp))
    }
}

@Composable
internal fun Welcome(agent: Agent?, modifier: Modifier) {
    Box(modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BrandLogo(132.dp)
            Spacer(Modifier.height(20.dp))
            Text("你好，我是 ${agent?.name ?: "OpenDrSai"}", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(agent?.description?.takeIf(String::isNotBlank) ?: "在下方输入你想完成的事情")
        }
    }
}

@Composable
private fun Messages(messages: List<ChatMessage>, assistantName: String, modifier: Modifier) {
    val listState = rememberLazyListState()
    val density = LocalDensity.current
    val imeBottom = WindowInsets.ime.getBottom(density)
    LaunchedEffect(messages.size, messages.lastOrNull()?.text, imeBottom) {
        if (messages.isNotEmpty()) {
            if (imeBottom > 0) listState.scrollToItem(messages.lastIndex)
            else listState.animateScrollToItem(messages.lastIndex)
        }
    }
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        state = listState,
        contentPadding = PaddingValues(start = 16.dp, top = 94.dp, end = 16.dp, bottom = 104.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        items(messages, key = { it.id }) { MessageBubble(it, assistantName) }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage, assistantName: String) {
    val isUser = message.role == "user"
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (isUser) Alignment.End else Alignment.Start) {
        Text(if (isUser) "你" else assistantName, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        val content: @Composable () -> Unit = {
            Column(Modifier.padding(if (isUser) 14.dp else 4.dp)) {
                if (message.text.contains("```")) CodeAwareText(message.text)
                else Text(message.text.ifBlank { "正在思考…" })
                if (!isUser && message.text.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    IconButton(
                        onClick = {
                            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                                .setPrimaryClip(ClipData.newPlainText("OpenDrSai", message.text))
                        },
                        modifier = Modifier.size(30.dp),
                    ) { Icon(Icons.Default.ContentCopy, "复制", Modifier.size(16.dp)) }
                }
                if (message.status != "complete" && message.status != "streaming") {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        when (message.status) {
                            "paused" -> "已暂停"
                            "stopped" -> "已停止"
                            "failed" -> "生成失败"
                            else -> message.status
                        },
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
        if (isUser) {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.widthIn(max = 620.dp),
                content = content,
            )
        } else {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) { content() }
        }
    }
}

@Composable
private fun CodeAwareText(text: String) {
    val parts = text.split("```")
    Column {
        parts.forEachIndexed { index, part ->
            if (index % 2 == 1) {
                Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(8.dp)) {
                    Text(
                        part.trim().substringAfter('\n', part.trim()),
                        Modifier.fillMaxWidth().padding(12.dp),
                        fontFamily = FontFamily.Monospace,
                    )
                }
            } else if (part.isNotBlank()) Text(part.trim())
        }
    }
}

@Composable
internal fun Composer(
    state: AppState,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var text by remember { mutableStateOf("") }
    val context = LocalContext.current
    val send = {
        if (text.isNotBlank() && state.selectedAgent?.chatSupported == true && !state.streaming) {
            onSend(text)
            text = ""
        }
    }
    val speechLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { text = it }
        }
    }
    val startSpeechRecognition: () -> Unit = {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
            putExtra(RecognizerIntent.EXTRA_PROMPT, "请说出要发送给 OpenDrSai 的内容")
        }
        runCatching { speechLauncher.launch(intent) }
            .onFailure { Toast.makeText(context, "当前设备没有可用的语音识别服务", Toast.LENGTH_SHORT).show() }
        Unit
    }

    Surface(
        modifier = modifier
            .padding(start = 12.dp, top = 10.dp, end = 12.dp)
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .heightIn(min = 60.dp),
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp,
        shadowElevation = 6.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            IconButton(
                onClick = { Toast.makeText(context, "附件功能即将支持", Toast.LENGTH_SHORT).show() },
                enabled = !state.streaming,
            ) { Icon(Icons.Default.Add, "添加附件或工具") }
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f).padding(vertical = 5.dp),
                enabled = !state.streaming && state.selectedAgent?.chatSupported == true,
                maxLines = 5,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
                decorationBox = { innerTextField ->
                    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.CenterStart) {
                        if (text.isEmpty()) Text("给 ${state.selectedAgent?.name ?: "OpenDrSai"} 发消息", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        innerTextField()
                    }
                },
            )
            when {
                state.streaming -> FilledIconButton(onClick = onStop) {
                    Icon(Icons.Default.Stop, "停止")
                }
                text.isNotBlank() -> FilledIconButton(onClick = send, enabled = state.selectedAgent?.chatSupported == true) {
                    Icon(Icons.Default.ArrowUpward, "发送")
                }
                else -> IconButton(onClick = startSpeechRecognition, enabled = state.selectedAgent?.chatSupported == true) {
                    Icon(Icons.Default.Mic, "语音输入")
                }
            }
        }
    }
}

@Composable
private fun ErrorBar(message: String, retry: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.errorContainer) {
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, Modifier.weight(1f), color = MaterialTheme.colorScheme.onErrorContainer)
            TextButton(onClick = retry) { Text("重试") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProfileSheet(state: AppState, viewModel: AppViewModel) {
    ModalBottomSheet(onDismissRequest = { viewModel.toggleProfile(false) }) {
        Column(Modifier.fillMaxWidth().padding(22.dp)) {
            Text("个人中心", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(16.dp))
            Text(state.user?.name.orEmpty(), fontWeight = FontWeight.Bold)
            Text(state.user?.id.orEmpty())
            state.selectedModel?.takeIf { state.selectedAgent?.source == "local" }
                ?.let { Text("模型：${it.name}", style = MaterialTheme.typography.bodySmall) }
            Text(
                "Runtime：${if (state.selectedAgent?.source == "platform") "HAI 平台" else "Android 本机"}",
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(18.dp))
            TextButton(
                onClick = { viewModel.logout(); viewModel.toggleProfile(false) },
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, null)
                Spacer(Modifier.width(8.dp))
                Text("退出登录")
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}
