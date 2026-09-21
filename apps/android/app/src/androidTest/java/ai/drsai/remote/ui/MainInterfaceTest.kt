package ai.drsai.remote.ui

import ai.drsai.remote.R
import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.Agent
import ai.drsai.remote.data.ApprovalUiItem
import ai.drsai.remote.data.FullRuntimeDiagnosticUi
import ai.drsai.remote.data.RuntimePolicyDiagnosticUi
import ai.drsai.remote.data.DEFAULT_AGENT
import ai.drsai.remote.data.AttachmentDraft
import ai.drsai.remote.data.AttachmentStatus
import ai.drsai.remote.data.ChatMessage
import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.WorkbenchSessionItem
import ai.drsai.remote.data.WorkbenchWorkspaceItem
import ai.drsai.remote.data.WorkbenchSearchItem
import ai.drsai.remote.runtime.security.ApprovalDecision
import ai.drsai.remote.runtime.readiness.AgentReadiness
import ai.drsai.remote.runtime.readiness.ReadinessAction
import ai.drsai.remote.runtime.readiness.ReadinessKind
import ai.drsai.remote.runtime.readiness.CapabilityGuidancePolicy
import ai.drsai.remote.runtime.setup.SetupJourney
import ai.drsai.remote.runtime.setup.SetupStep
import ai.drsai.remote.runtime.setup.SetupStatus
import ai.drsai.remote.runtime.reliability.RecoveryRunItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.io.FileOutputStream

class MainInterfaceTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun capabilityGuidanceExplainsEveryUnavailableClassBeforeRun() {
        var workspace = 0
        var desktop = 0
        var models = 0
        val items = CapabilityGuidancePolicy.project(
            localToolIds = listOf("get_current_time", "web.search"),
            modelUnsupportedToolIds = listOf("web.search"),
        )
        composeRule.setContent {
            MaterialTheme {
                CapabilityGuidanceCard(items, { workspace++ }, { desktop++ }, { models++ })
            }
        }

        composeRule.onNodeWithTag("capability-guidance-card").assertIsDisplayed()
        composeRule.onNodeWithText("当前能做什么").assertIsDisplayed()
        composeRule.onNodeWithTag("capability-guidance-toggle").performClick()
        composeRule.onNodeWithText("可直接使用").assertIsDisplayed()
        composeRule.onNodeWithText("需要本地权限").assertIsDisplayed()
        composeRule.onNodeWithText("需要 Desktop").assertIsDisplayed()
        composeRule.onNodeWithText("当前模型不支持").assertIsDisplayed()
        composeRule.onNodeWithTag("capability-grant-workspace").performClick()
        composeRule.onNodeWithTag("capability-open-desktop").performClick()
        composeRule.onNodeWithTag("capability-open-models").performClick()
        composeRule.runOnIdle {
            assertEquals(1, workspace)
            assertEquals(1, desktop)
            assertEquals(1, models)
        }
    }

    @Test
    fun workbenchDrawerUsesTheDocumentedWideScreenBreakpoint() {
        assertFalse(usesPermanentWorkbenchDrawer(839.dp))
        assertTrue(usesPermanentWorkbenchDrawer(840.dp))
        assertTrue(usesPermanentWorkbenchDrawer(1280.dp))
    }

    @Test
    fun recoveringDisablesComposerConflictsButKeepsCancelAvailable() {
        var stops = 0
        composeRule.setContent {
            MaterialTheme {
                Composer(
                    state = AppState(destination = AppDestination.Chat, recovering = true),
                    onSend = {}, onStop = { stops += 1 },
                )
            }
        }
        composeRule.onNodeWithTag("runtime-composer-input").assertIsNotEnabled()
        composeRule.onNodeWithTag("runtime-stop").assertIsEnabled().performClick()
        composeRule.runOnIdle { assertEquals(1, stops) }
    }

    @Test
    fun profileVersionInfoShowsVersionBuildChannelAndOaepRuntime() {
        composeRule.setContent {
            MaterialTheme {
                ProfileVersionInfo("1.5.7", 10507, "debug")
            }
        }

        composeRule.onNodeWithTag("profile-version-info").assertIsDisplayed()
        composeRule.onNodeWithText("版本信息").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai 1.5.7 (10507)").assertIsDisplayed()
        composeRule.onNodeWithText("构建渠道：Debug · Android Agent Runtime · OAEP 1.0").assertIsDisplayed()
    }

    @Test
    fun setupCardShowsOneActionableReadinessAndCanBeSkipped() {
        var opened = 0
        var skipped = 0
        composeRule.setContent {
            MaterialTheme {
                AgentSetupCard(
                    state = AppState(
                        agentReadiness = AgentReadiness(
                            ReadinessKind.CONFIGURATION_REQUIRED,
                            "添加模型密钥", "密钥只会保存在 Android 加密安全层。",
                            ReadinessAction.ADD_CREDENTIAL, false, "credential_missing",
                        ),
                        setupJourney = SetupJourney(status = SetupStatus.ACTIVE),
                    ),
                    onOpenModels = { opened += 1 },
                    onRetryRuntime = {},
                    onRunRuntimeCheck = {},
                    onRunExample = {},
                    onSkip = { skipped += 1 },
                )
            }
        }
        composeRule.onNodeWithTag("agent-setup-card").assertIsDisplayed()
        composeRule.onNodeWithText("添加模型密钥").assertIsDisplayed()
        composeRule.onNodeWithText("完成设置").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("稍后").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, opened); assertEquals(1, skipped) }
    }

    @Test
    fun setupCardRoutesRuntimeFailureToRetryInsteadOfModelSettings() {
        var retry = 0
        composeRule.setContent {
            MaterialTheme {
                AgentSetupCard(
                    state = AppState(
                        agentReadiness = AgentReadiness(
                            ReadinessKind.TEMPORARILY_UNAVAILABLE,
                            "Agent 暂时不可用", "可以重新启动 Runtime，不会切换到轻量模式。",
                            ReadinessAction.RETRY_RUNTIME, false, "runtime_unavailable",
                        ),
                    ),
                    onOpenModels = {},
                    onRetryRuntime = { retry += 1 },
                    onRunRuntimeCheck = {},
                    onRunExample = {},
                    onSkip = {},
                )
            }
        }
        composeRule.onNodeWithText("重新启动").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, retry) }
    }

    @Test
    fun setupCardRunsFunctionalSmokeBeforeClaimingAgentIsAvailable() {
        var checks = 0
        composeRule.setContent {
            MaterialTheme {
                AgentSetupCard(
                    state = AppState(agentReadiness = AgentReadiness(
                        ReadinessKind.CONFIGURATION_REQUIRED,
                        "检查 Agent 功能", "需要完成一次无副作用工具检查后才能开始任务。",
                        ReadinessAction.RUN_RUNTIME_CHECK, false, "runtime_smoke_required",
                    )),
                    onOpenModels = {}, onRetryRuntime = {},
                    onRunRuntimeCheck = { checks += 1 }, onRunExample = {}, onSkip = {},
                )
            }
        }
        composeRule.onNodeWithTag("agent-setup-primary").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, checks) }
    }

    @Test
    fun firstTaskOffersChatRetrievalAndSafeLocalToolWithoutLoginReset() {
        val prompts = mutableListOf<String>()
        composeRule.setContent {
            MaterialTheme {
                AgentSetupCard(
                    state = AppState(
                        agentReadiness = AgentReadiness(
                            ReadinessKind.READY, "Agent 可以使用", "已就绪",
                            ReadinessAction.NONE, true, "ready",
                        ),
                        setupJourney = SetupJourney(SetupStep.FIRST_TASK, SetupStatus.ACTIVE),
                        fullRuntimeDiagnostic = FullRuntimeDiagnosticUi(
                            availableTools = listOf("web.search", "get_device_info"),
                        ),
                    ),
                    onOpenModels = {}, onRetryRuntime = {}, onRunRuntimeCheck = {},
                    onRunExample = { prompts += it }, onSkip = {},
                )
            }
        }
        composeRule.onNodeWithTag("first-task-chat").assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("first-task-retrieval").assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("first-task-local_safe_tool").assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals(3, prompts.size)
            assertTrue(prompts[1].contains("来源引用"))
            assertTrue(prompts[2].contains("本机工具"))
        }
    }

    @Test
    fun deferredSetupShowsOnePrimaryActionAndResumes() {
        var resumed = 0
        composeRule.setContent {
            MaterialTheme { DeferredSetupCard(onResume = { resumed += 1 }) }
        }
        composeRule.onNodeWithTag("deferred-setup-card").assertIsDisplayed()
        composeRule.onNodeWithText("Agent 尚未就绪").assertIsDisplayed()
        composeRule.onNodeWithText("完成模型配置").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, resumed) }
    }

    @Test
    fun fullRuntimeDiagnosticShowsBindingRouteCapabilitiesAndNoKotlinFallback() {
        composeRule.setContent {
            MaterialTheme {
                FullRuntimeDiagnosticSection(
                    diagnostic = FullRuntimeDiagnosticUi(
                        buildEnabled = true,
                        bindingState = "READY",
                        health = "READY",
                        process = "ai.drsai.remote.debug:runtime · pid 4242",
                        starts = 3,
                        bindAttempts = 2,
                        bindSuccesses = 2,
                        route = "Full Local",
                        availableTools = listOf("get_current_time"),
                        permissionRequiredTools = listOf("workspace.read"),
                        availableSkills = listOf("core.plan"),
                        kernelVersion = "p9.1",
                        kernelSha256 = "a".repeat(64),
                        promptVersion = "p9-agent-kernel-v1",
                        toolManifestVersion = "p9-tools-v1",
                        skillManifestVersion = "p9-skill-manifest-v1",
                        skillManifestSha256 = "d".repeat(64),
                        capabilityManifestVersion = "p9-capabilities-v1",
                        capabilityManifestSha256 = "c".repeat(64),
                        activeRunId = "run-visible",
                        errorId = "err-visible",
                    ),
                    policy = RuntimePolicyDiagnosticUi("verified", "v1", null, 100, false, 1),
                    onRetry = {},
                )
            }
        }

        composeRule.onNodeWithTag("full-runtime-diagnostic").assertIsDisplayed()
        composeRule.onNodeWithText("高级诊断").assertIsDisplayed()
        composeRule.onAllNodesWithText("Kernel p9.1", substring = true).assertCountEquals(0)
        composeRule.onNodeWithTag("toggle-full-runtime-diagnostic").performClick()
        composeRule.onNodeWithText("kotlin_fallback_available=false").assertIsDisplayed()
        composeRule.onNodeWithText("路由 Full Local · 绑定 READY · 健康 READY").assertIsDisplayed()
        composeRule.onNodeWithText("Build enabled=true · 进程 ai.drsai.remote.debug:runtime · pid 4242").assertIsDisplayed()
        composeRule.onNodeWithText("Kernel p9.1 · ${"a".repeat(12)}").assertIsDisplayed()
        composeRule.onNodeWithText("Prompt p9-agent-kernel-v1 · Tool p9-tools-v1").assertIsDisplayed()
        composeRule.onNodeWithText("Skill p9-skill-manifest-v1 · ${"d".repeat(12)}").assertIsDisplayed()
        composeRule.onNodeWithText("Capability p9-capabilities-v1 · ${"c".repeat(12)}").assertIsDisplayed()
        composeRule.onNodeWithText("Run run-visible · Error err-visible").assertIsDisplayed()
        composeRule.onNodeWithTag("copy-full-runtime-diagnostic").assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("share-full-runtime-diagnostic").assertIsDisplayed()
        composeRule.runOnIdle {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            val copied = clipboard.primaryClip?.getItemAt(0)?.text?.toString().orEmpty()
            assertTrue(copied.contains("stable_code=err-visible"))
            assertTrue(copied.contains("run_ref="))
            assertTrue(copied.contains("feedback_digest="))
            assertFalse(copied.contains("run-visible"))
            clipboard.clearPrimaryClip()
        }
    }

    @Test
    fun diagnosticShareIntentContainsOnlyRedactedPlainText() {
        val secret = "sk-share-secret-canary"
        val intent = fullRuntimeDiagnosticShareIntent(FullRuntimeDiagnosticUi(
            bindReason = "Authorization: Bearer $secret",
            activeRunId = "run-share",
            errorId = "error-share",
        ))
        assertEquals(android.content.Intent.ACTION_SEND, intent.action)
        assertEquals("text/plain", intent.type)
        val text = intent.getStringExtra(android.content.Intent.EXTRA_TEXT).orEmpty()
        assertFalse(text.contains(secret))
        assertTrue(text.contains("stable_code=error-share"))
        assertTrue(text.contains("run_ref="))
        assertTrue(text.contains("feedback_digest="))
        assertFalse(text.contains("run-share"))
    }

    @Test
    fun permanentWorkbenchDrawerRendersItsPrimaryNavigation() {
        var searchOpened = 0
        var settingsOpened = 0
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(user = ai.drsai.remote.data.User("wide", "宽屏账户")),
                    modal = false,
                    onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                    onOpenProfile = {}, onOpenSettings = { settingsOpened += 1 },
                    onOpenSearch = { searchOpened += 1 }, onOpenRemoteWorkspaces = {},
                )
            }
        }
        composeRule.onNodeWithText("远程工作区").assertIsDisplayed()
        composeRule.onNodeWithText("宽屏账户").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("搜索").assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("open-settings").assertIsDisplayed().performClick()
        composeRule.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        composeRule.runOnIdle {
            assertEquals(1, searchOpened)
            assertEquals(1, settingsOpened)
        }
    }

    @Test
    fun floatingHeaderKeepsOnlyPrimaryActions() {
        composeRule.setContent {
            MaterialTheme {
                FloatingHeader({}, {}, true)
            }
        }

        composeRule.onNodeWithContentDescription("展开侧栏").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("新对话").assertIsDisplayed()
        composeRule.onAllNodesWithContentDescription("本机历史").assertCountEquals(0)
        composeRule.onAllNodesWithContentDescription("个人中心").assertCountEquals(0)
    }

    @Test fun headerAndComposerRemainOperableAtTwoHundredPercentFontScale() {
        composeRule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 2f)) {
                MaterialTheme {
                    Box(Modifier.fillMaxSize()) {
                        FloatingHeader({}, {}, true)
                        Composer(
                            state = AppState(destination = AppDestination.Chat),
                            onSend = {},
                            onStop = {},
                            modifier = Modifier.align(Alignment.BottomCenter),
                        )
                    }
                }
            }
        }

        composeRule.onNodeWithText("OpenDrSai").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("展开侧栏").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("新对话").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("添加附件").assertIsDisplayed()
        composeRule.onNode(hasSetTextAction()).assertIsDisplayed()
    }

    @Test fun workbenchDrawerRemainsNavigableAtOneHundredFiftyPercentFontScale() {
        composeRule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
                MaterialTheme {
                    NavigationDrawer(
                        state = AppState(destination = AppDestination.Chat),
                        onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                        onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                    )
                }
            }
        }
        composeRule.onNodeWithContentDescription("搜索").assertIsDisplayed()
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(4)
        composeRule.onNodeWithText("会话").assertIsDisplayed()
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(0)
        composeRule.onNodeWithText("智能体").assertIsDisplayed()
    }

    @Test fun primaryHeaderTouchTargetsAreAtLeastFortyEightDp() {
        composeRule.setContent { MaterialTheme { FloatingHeader({}, {}, true) } }
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        listOf("展开侧栏", "新对话").forEach { description ->
            val bounds = composeRule.onNodeWithContentDescription(description).fetchSemanticsNode().boundsInRoot
            assertTrue("$description width=${bounds.width}", bounds.width >= 48 * density)
            assertTrue("$description height=${bounds.height}", bounds.height >= 48 * density)
        }
    }

    @Test
    fun composerChangesFromVoiceToSendWhenTextIsEntered() {
        var sent = ""
        composeRule.setContent {
            MaterialTheme {
                Composer(
                    state = AppState(destination = AppDestination.Chat),
                    onSend = { sent = it },
                    onStop = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription("添加附件").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("语音输入").assertIsDisplayed()
        composeRule.onNode(hasSetTextAction()).performTextInput("你好")
        composeRule.onAllNodesWithContentDescription("语音输入").assertCountEquals(0)
        composeRule.onNodeWithContentDescription("发送").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals("你好", sent) }
    }

    @Test
    fun drawerExposesRemoteWorkspaceAsAProductEntry() {
        var opened = 0
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(destination = AppDestination.Chat),
                    onNewConversation = {},
                    onOpenConversation = {},
                    onSelectAgent = {},
                    onRefreshAgents = {},
                    onOpenProfile = {},
                    onOpenRemoteWorkspaces = { opened += 1 },
                )
            }
        }
        composeRule.onNodeWithText("远程工作区").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, opened) }
    }

    @Test
    fun drawerUsesDesktopNavigationAndKeepsSessionActions() {
        var agentsOpened = 0
        var pinned: Pair<String, Boolean>? = null
        var deleted = ""
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(WorkbenchWorkspaceItem(
                            "local", "android-local", "local", "OpenDrSai 本地", true,
                            listOf(
                                WorkbenchSessionItem("one", "android-local", "local", "Alpha", true, false, false, 1),
                                WorkbenchSessionItem("two", "android-local", "local", "Beta", true, true, true, 2, "WAITING_APPROVAL"),
                            ),
                        )),
                    ),
                    onNewConversation = {},
                    onOpenConversation = {},
                    onSelectAgent = {},
                    onRefreshAgents = {},
                    onOpenProfile = {},
                    onOpenRemoteWorkspaces = {},
                    onOpenAgentsAndSkills = { agentsOpened += 1 },
                    onSetSessionPinned = { id, value -> pinned = id to value },
                    onDeleteSession = { deleted = it },
                )
            }
        }
        composeRule.onNodeWithText("已安排").assertIsDisplayed()
        composeRule.onNodeWithText("远程工作区").assertIsDisplayed()
        composeRule.onAllNodesWithText("结果").assertCountEquals(0)
        composeRule.onAllNodesWithText("本地工作区").assertCountEquals(0)
        composeRule.onNodeWithText("智能体").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, agentsOpened) }
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(5)
        assertTrue(composeRule.onAllNodesWithText("Beta").fetchSemanticsNodes().isNotEmpty())
        composeRule.onNodeWithTag("session-action-two").performSemanticsAction(SemanticsActions.OnClick)
        composeRule.onNodeWithText("取消置顶").performClick()
        composeRule.runOnIdle { assertEquals("two" to false, pinned) }
        composeRule.onNodeWithTag("session-action-two").performSemanticsAction(SemanticsActions.OnClick)
        composeRule.onNodeWithText("删除").performClick()
        composeRule.onNodeWithText("删除会话？").assertIsDisplayed()
        composeRule.onNodeWithText("确认删除").performClick()
        composeRule.runOnIdle { assertEquals("two", deleted) }
    }

    @Test fun drawerHidesWorkspaceContainersWhenThereAreNoSessions() {
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(
                            WorkbenchWorkspaceItem("remote", "runtime", "workspace", "远程实验", false, emptyList(), "online"),
                        ),
                    ),
                    onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                    onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                )
            }
        }
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(4)
        composeRule.onNodeWithText("会话").assertIsDisplayed()
        composeRule.onAllNodesWithText("远程实验").assertCountEquals(0)
    }

    @Test fun drawerRequestsTheNextSessionPageForTheExactWorkspace() {
        var requested = ""
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(
                            WorkbenchWorkspaceItem(
                                "runtime:workspace", "runtime", "workspace", "分页工作区", false,
                                listOf(WorkbenchSessionItem("one", "runtime", "workspace", "第一页会话", false, false, false, 1)),
                                "online", sessionHasMore = true,
                            ),
                        ),
                    ),
                    onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                    onOpenProfile = {}, onOpenRemoteWorkspaces = {}, onLoadMoreSessions = { requested = it },
                )
            }
        }
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(6)
        composeRule.onNode(hasText("加载更多会话") and hasClickAction())
            .performSemanticsAction(SemanticsActions.OnClick)
        composeRule.runOnIdle { assertEquals("runtime:workspace", requested) }
    }

    @Test fun drawerListsSessionsWithoutWorkspaceContainerNames() {
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(
                            WorkbenchWorkspaceItem(
                                "restore", "runtime", "workspace", "恢复工作区", false,
                                listOf(WorkbenchSessionItem("session", "runtime", "workspace", "恢复会话", false, false, false, 1)),
                            ),
                        ),
                    ),
                    onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                    onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                )
            }
        }
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(5)
        composeRule.onNodeWithText("恢复会话").assertIsDisplayed()
        composeRule.onAllNodesWithText("恢复工作区").assertCountEquals(0)
    }

    @Test fun newTaskTargetSelectionIsExplicitAndUserCanOverrideTheRemoteSuggestion() {
        var selected = ""
        val remote = WorkbenchWorkspaceItem("remote", "runtime", "workspace", "计算节点", false, emptyList(), "online")
        composeRule.setContent {
            MaterialTheme {
                NewTaskTargetDialog(
                    remoteTargets = listOf(remote),
                    onDismiss = {},
                    onLocal = { selected = "local" },
                    onRemote = { selected = it.key },
                )
            }
        }
        composeRule.onNodeWithText("Run 创建后会固定到所选 Runtime，不会静默切换。").assertIsDisplayed()
        composeRule.onNodeWithText("计算节点 · 远程 Runtime").assertIsDisplayed()
        composeRule.onNodeWithText("Android 本地 · Full Agent Runtime").performClick()
        composeRule.runOnIdle { assertEquals("local", selected) }
    }

    @Test
    fun approvalCenterShowsPendingOperationAndEmitsExactDecision() {
        var decision: Pair<String, ApprovalDecision>? = null
        val approval = ApprovalUiItem(
            id = "approval-1",
            operation = "workspace.write",
            scope = "session",
            runtimeId = "android-local",
            sessionId = "session-1",
            expiresAt = "9999999999999",
            title = "修改工作区文件",
            reason = "需要更新任务使用的本地文件",
            objectLabel = "工作区文件",
            changeSummary = "创建文件\n+hello",
            riskSummary = "会修改本地工作区内容",
            reversibleLabel = "可撤销",
            advancedDetail = "Tool: workspace.write · Approval: approval-1 · Runtime: android-local",
        )
        composeRule.setContent {
            MaterialTheme {
                ApprovalsScreen(listOf(approval), onBack = {}) { id, value -> decision = id to value }
            }
        }
        composeRule.onNodeWithText("修改工作区文件").assertIsDisplayed()
        composeRule.onNodeWithText("为什么需要：需要更新任务使用的本地文件").assertIsDisplayed()
        composeRule.onNodeWithText("操作对象：工作区文件").assertIsDisplayed()
        composeRule.onNodeWithText("变更摘要：创建文件\n+hello").assertIsDisplayed()
        composeRule.onNodeWithText("风险：会修改本地工作区内容").assertIsDisplayed()
        composeRule.onNodeWithText("是否可撤销：可撤销").assertIsDisplayed()
        composeRule.onNodeWithText("Tool: workspace.write · Approval: approval-1 · Runtime: android-local").assertDoesNotExist()
        composeRule.onNodeWithText("高级详情").performClick()
        composeRule.onNodeWithText("Tool: workspace.write · Approval: approval-1 · Runtime: android-local").assertIsDisplayed()
        composeRule.onNodeWithText("本会话允许").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals("approval-1" to ApprovalDecision.ALLOW_SESSION, decision) }
    }

    @Test fun inlineApprovalCardUsesTheSameExactDecisionContract() {
        var decision: Pair<String, ApprovalDecision>? = null
        composeRule.setContent {
            MaterialTheme {
                PendingApprovalCard(
                    ApprovalUiItem("approval-inline", "workspace.write", "session", "android-local", "s", "9999999999999"),
                    count = 2,
                    onOpenAll = {},
                    onDecision = { id, value -> decision = id to value },
                )
            }
        }
        composeRule.onNodeWithText("workspace.write").assertIsDisplayed()
        composeRule.onNodeWithText("允许一次").performClick()
        composeRule.runOnIdle { assertEquals("approval-inline" to ApprovalDecision.ALLOW_ONCE, decision) }
    }

    @Test fun coreTaskSurfaceFitsSmallScreenAtTwoHundredPercentFontAndKeepsTouchTargets() {
        composeRule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 2f)) {
                MaterialTheme {
                    Column(Modifier.width(320.dp).height(700.dp)) {
                        FloatingHeader({}, {}, true)
                        UserFriendlyEmptyStateCard(
                            ai.drsai.remote.runtime.readiness.UserFriendlyEmptyStatePolicy.present(
                                ai.drsai.remote.runtime.readiness.EmptyStateKind.NO_SESSIONS,
                                setOf("chat"),
                            ),
                            {},
                        )
                        Composer(
                            AppState(selectedAgent = Agent("local", "OpenDrSai", chatSupported = true)),
                            onSend = {}, onStop = {},
                        )
                    }
                }
            }
        }
        composeRule.onNodeWithContentDescription("展开侧栏").assertIsDisplayed()
        composeRule.onNodeWithText("新建任务").assertIsDisplayed()
        composeRule.onNodeWithTag("runtime-composer-input").assertIsDisplayed()
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        listOf("展开侧栏", "新对话", "添加附件", "语音输入").forEach { description ->
            val bounds = composeRule.onNodeWithContentDescription(description).fetchSemanticsNode().boundsInRoot
            assertTrue("$description width=${bounds.width}", bounds.width >= 48 * density)
            assertTrue("$description height=${bounds.height}", bounds.height >= 48 * density)
        }
    }

    @Test fun primaryNavigationFitsTabletAtOneHundredFiftyPercentFont() {
        composeRule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
                MaterialTheme {
                    Box(Modifier.width(900.dp).height(700.dp)) {
                        NavigationDrawer(
                            state = AppState(user = ai.drsai.remote.data.User("tablet", "平板用户")),
                            modal = false,
                            onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                            onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                        )
                    }
                }
            }
        }
        composeRule.onNodeWithText("OpenDrSai").assertIsDisplayed()
        composeRule.onNodeWithText("新建任务").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("搜索").assertIsDisplayed()
    }

    @Test fun emptyStateHasOneRecommendedActionAndCapabilityFilteredExamples() {
        var actions = 0
        composeRule.setContent {
            MaterialTheme {
                UserFriendlyEmptyStateCard(
                    ai.drsai.remote.runtime.readiness.UserFriendlyEmptyStatePolicy.present(
                        ai.drsai.remote.runtime.readiness.EmptyStateKind.CAPABILITY_CHANGED,
                        setOf("chat"),
                    ),
                    onPrimaryAction = { actions += 1 },
                )
            }
        }
        composeRule.onNodeWithTag("user-friendly-empty-state").assertIsDisplayed()
        composeRule.onNodeWithText("帮我整理今天的任务", substring = true).assertIsDisplayed()
        composeRule.onAllNodesWithText("搜索最新资料并附上来源", substring = true).assertCountEquals(0)
        composeRule.onNodeWithText("查看能力").performClick()
        composeRule.runOnIdle { assertEquals(1, actions) }
    }

    @Test fun approvalCenterShowsAndRevokesSessionGrant() {
        var revoked = ""
        val grant = ai.drsai.remote.data.ApprovalGrantUiItem(
            stableId = "|android-local|session-1|workspace.write",
            title = "修改工作区文件",
            objectLabel = "工作区文件",
            runtimeId = "android-local",
            sessionId = "session-1",
            toolId = "workspace.write",
        )
        composeRule.setContent {
            MaterialTheme {
                ApprovalsScreen(
                    approvals = emptyList(),
                    grants = listOf(grant),
                    onBack = {},
                    onDecision = { _, _ -> },
                    onRevokeGrant = { revoked = it },
                )
            }
        }
        composeRule.onNodeWithText("本会话已授权").assertIsDisplayed()
        composeRule.onNodeWithText("对象：工作区文件").assertIsDisplayed()
        composeRule.onNodeWithText("撤销授权").performClick()
        composeRule.runOnIdle { assertEquals(grant.stableId, revoked) }
    }

    @Test fun capabilityFailureShowsRepairInsteadOfCreatingAnotherRun() {
        var repaired: ai.drsai.remote.runtime.errors.CapabilityRepairAction? = null
        var retries = 0
        val repair = requireNotNull(ai.drsai.remote.runtime.errors.CapabilityRepairPolicy.from("model_tools_unsupported"))
        composeRule.setContent {
            MaterialTheme {
                ErrorBar("当前模型不支持 Agent 工具", null, repair, retry = { retries += 1 }) { repaired = it }
            }
        }
        composeRule.onAllNodesWithText("重试").assertCountEquals(0)
        composeRule.onNodeWithText("选择支持工具的模型").performClick()
        composeRule.runOnIdle {
            assertEquals(ai.drsai.remote.runtime.errors.CapabilityRepairAction.CHOOSE_MODEL, repaired)
            assertEquals(0, retries)
        }
    }

    @Test fun recoveryCenterOffersOnlyLegalActionsForEachCandidate() {
        var continued = ""
        var cancelled = ""
        var archived = ""
        val runs = listOf(
            RecoveryRunItem("paused", "session-a", "PAUSED", "已暂停的任务", null, 3, true, true),
            RecoveryRunItem("failed", "session-b", "FAILED", "失败的任务", "provider_429", 2, false, false),
            RecoveryRunItem("waiting", "session-c", "WAITING_APPROVAL", "等待确认的任务", null, 1, false, true),
        )
        composeRule.setContent {
            MaterialTheme {
                RecoveryCenterScreen(runs, {}, { continued = it }, { cancelled = it }, { archived = it })
            }
        }
        composeRule.onNodeWithText("恢复中心").assertIsDisplayed()
        composeRule.onAllNodesWithText("继续").assertCountEquals(1)
        composeRule.onAllNodesWithText("取消").assertCountEquals(2)
        composeRule.onAllNodesWithText("归档").assertCountEquals(3)
        composeRule.onNodeWithText("继续").performClick()
        composeRule.runOnIdle { assertEquals("paused", continued) }
        composeRule.onAllNodesWithText("取消")[1].performClick()
        composeRule.runOnIdle { assertEquals("waiting", cancelled) }
        composeRule.onAllNodesWithText("归档")[1].performClick()
        composeRule.runOnIdle { assertEquals("failed", archived) }
    }

    @Test fun workspaceAuthorizationExplainsSelectedScopeBeforeOpeningPicker() {
        var dismissed = 0
        var picker = 0
        composeRule.setContent {
            MaterialTheme { WorkspaceAuthorizationDialog({ dismissed += 1 }, { picker += 1 }) }
        }
        composeRule.onNodeWithText("为当前任务选择工作区").assertIsDisplayed()
        composeRule.onNodeWithText("只会读取或修改你接下来选择的目录", substring = true).assertIsDisplayed()
        composeRule.onNodeWithText("授权后将继续原任务，不会新建 Run。", substring = true).assertIsDisplayed()
        composeRule.onNodeWithTag("workspace-choose-directory").performClick()
        composeRule.runOnIdle {
            assertEquals(1, picker)
            assertEquals(0, dismissed)
        }
    }

    @Test fun workspaceScopeAlwaysShowsSafeCurrentWorkspaceName() {
        composeRule.setContent { MaterialTheme { WorkspaceScopeBanner("我的项目") } }
        composeRule.onNodeWithTag("workspace-scope-banner").assertIsDisplayed()
        composeRule.onNodeWithText("当前工作区：我的项目").assertIsDisplayed()
        composeRule.onNodeWithText("工具只能访问此目录中的相对路径").assertIsDisplayed()
    }

    @Test fun artifactCardsShowTypeSizeSourceAndOnlyRegenerateAfterValidationFailure() {
        var opened = ""
        var regenerated = ""
        val artifacts = listOf(
            ai.drsai.remote.data.WorkbenchArtifactItem("text", "report.txt", "text/plain", 2048, "session", "run", "tool"),
            ai.drsai.remote.data.WorkbenchArtifactItem("expired", "old.bin", "application/octet-stream", 10, "session", source = "attachment", failureCode = "artifact_not_found"),
        )
        composeRule.setContent {
            MaterialTheme {
                WorkbenchResultsScreen(artifacts, {}, { opened = it.id }, {}, { regenerated = it.id })
            }
        }
        composeRule.onNodeWithText("文本 · 2.0 KB · 来源：Agent 工具结果", substring = true).assertIsDisplayed()
        composeRule.onNodeWithText("二进制文件 · 10 B · 来源：会话附件", substring = true).assertIsDisplayed()
        composeRule.onNodeWithText("结果已过期").assertIsDisplayed()
        composeRule.onNodeWithText("打开").performClick()
        composeRule.runOnIdle { assertEquals("text", opened) }
        composeRule.onNodeWithText("重新生成").performClick()
        composeRule.runOnIdle { assertEquals("expired", regenerated) }
    }

    @Test fun handoffPickerExplainsTransferAndRequiresUserTargetChoice() {
        var selected = ""
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val handoff = ai.drsai.remote.data.DesktopHandoffUi(
            "handoff", null, null, listOf("SHELL"), "需要电脑执行命令",
            targets = listOf(
                ai.drsai.remote.data.DesktopHandoffTargetUi("desktop-a", "书房电脑", true),
                ai.drsai.remote.data.DesktopHandoffTargetUi("desktop-off", "离线电脑", false),
            ),
            transferSummary = "任务说明、1 个附件引用与 digest、项目指令版本",
        )
        composeRule.setContent { MaterialTheme { HandoffTargetPicker(handoff) { selected = it } } }
        composeRule.onNodeWithText(context.getString(R.string.handoff_transfer_summary, handoff.transferSummary)).assertIsDisplayed()
        composeRule.onNodeWithText(context.getString(R.string.choose_execution_computer)).assertIsDisplayed()
        composeRule.onNodeWithTag("handoff-target-desktop-off").assertIsNotEnabled()
        composeRule.onNodeWithTag("handoff-target-desktop-a").assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)
        composeRule.runOnIdle { assertEquals("desktop-a", selected) }
    }

    @Test fun dedicatedSearchScreenKeepsInputBelowResultsAndOpensOwningSession() {
        val session = WorkbenchSessionItem("s1", "android-local", "local", "会话", true, false, false, 1)
        var opened = ""
        var searched = ""
        composeRule.setContent {
            MaterialTheme {
                WorkbenchSearchScreen(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(
                            WorkbenchWorkspaceItem("local", "android-local", "local", "本地", true, listOf(session)),
                        ),
                        workbenchSearchResults = listOf(WorkbenchSearchItem(session, "needle in message", true)),
                    ),
                    onBack = {},
                    onSearch = { searched = it },
                    onOpenSession = { opened = it.sessionId },
                    onSelectAgent = {},
                )
            }
        }
        composeRule.onNode(hasSetTextAction()).performTextInput("needle")
        composeRule.onNodeWithText("needle in message").performSemanticsAction(SemanticsActions.OnClick)
        val inputBottom = composeRule.onNode(hasSetTextAction()).fetchSemanticsNode().boundsInRoot.bottom
        val resultBottom = composeRule.onNodeWithText("needle in message").fetchSemanticsNode().boundsInRoot.bottom
        composeRule.runOnIdle {
            assertEquals("needle", searched)
            assertEquals("s1", opened)
            assertTrue(inputBottom > resultBottom)
        }
    }

    @Test
    fun attachmentMenuAndAttachmentOnlySendAreAvailable() {
        var sends = 0
        val draft = AttachmentDraft(
            id = "a1", name = "report.pdf", mimeType = "application/pdf", size = 1024,
            kind = "file", localPath = "/cache/report.pdf", status = AttachmentStatus.READY,
        )
        composeRule.setContent {
            MaterialTheme {
                Composer(
                    state = AppState(destination = AppDestination.Chat, attachmentDrafts = listOf(draft)),
                    onSend = { sends += 1 },
                    onStop = {},
                )
            }
        }
        composeRule.onNodeWithText("report.pdf").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("发送").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, sends) }
        composeRule.onNodeWithContentDescription("添加附件").performClick()
        composeRule.onNodeWithText("拍照").assertIsDisplayed()
        composeRule.onNodeWithText("从相册选择").assertIsDisplayed()
        composeRule.onNodeWithText("选择文件").assertIsDisplayed()
    }

    @Test
    fun attachmentSendKeepsTextUntilUploadsAreAccepted() {
        val draft = AttachmentDraft(
            id = "a1", name = "report.pdf", mimeType = "application/pdf", size = 1024,
            kind = "file", localPath = "/cache/report.pdf", status = AttachmentStatus.READY,
        )
        val currentState = mutableStateOf(AppState(destination = AppDestination.Chat, attachmentDrafts = listOf(draft)))
        composeRule.setContent {
            MaterialTheme {
                Composer(state = currentState.value, onSend = {}, onStop = {})
            }
        }

        composeRule.onNode(hasSetTextAction()).performTextInput("保留这段说明")
        composeRule.onNodeWithContentDescription("发送").performClick()
        composeRule.onNodeWithText("保留这段说明").assertIsDisplayed()

        composeRule.runOnIdle {
            currentState.value = currentState.value.copy(
                streaming = false,
                attachmentDrafts = listOf(draft.copy(status = AttachmentStatus.FAILED, error = "网络中断")),
            )
        }
        composeRule.onNodeWithText("保留这段说明").assertIsDisplayed()

        composeRule.runOnIdle {
            currentState.value = currentState.value.copy(
                streaming = true,
                attachmentDrafts = emptyList(),
                messages = listOf(ChatMessage("m1", "c1", "user", "保留这段说明")),
            )
        }
        composeRule.onAllNodesWithText("保留这段说明").assertCountEquals(0)
    }

    @Test fun attachmentDraftsPreviewIndependentlyAndFailedDraftCanRetryOrBeRemoved() {
        var removed = ""
        var retried = ""
        val currentState = mutableStateOf(AppState(
            destination = AppDestination.Chat,
            attachmentDrafts = listOf(
                AttachmentDraft("image", "photo.jpg", "image/jpeg", 2048, "image", "/cache/photo.jpg", status = AttachmentStatus.READY),
                AttachmentDraft("failed", "report.pdf", "application/pdf", 4096, "file", "/cache/report.pdf", status = AttachmentStatus.FAILED, error = "网络中断"),
            ),
        ))
        composeRule.setContent {
            MaterialTheme {
                Composer(
                    state = currentState.value, onSend = {}, onStop = {},
                    onRemoveAttachment = { removed = it }, onRetryAttachment = { retried = it },
                )
            }
        }
        composeRule.onNodeWithText("photo.jpg").assertIsDisplayed()
        composeRule.onNodeWithText("report.pdf").assertIsDisplayed()
        composeRule.onNodeWithText("网络中断").assertIsDisplayed()
        composeRule.onNodeWithTag("attachment-retry-failed").performScrollTo().performClick()
        composeRule.runOnIdle { assertEquals("failed", retried) }
        composeRule.onNodeWithTag("attachment-remove-failed").performScrollTo().performClick()
        composeRule.runOnIdle {
            assertEquals("failed", removed)
            currentState.value = currentState.value.copy(attachmentDrafts = currentState.value.attachmentDrafts.dropLast(1))
        }
        composeRule.onNodeWithText("photo.jpg").assertIsDisplayed()
        composeRule.onNodeWithText("report.pdf").assertDoesNotExist()
    }

    @Test
    fun mainInterfaceReferenceRenders() {
        composeRule.setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize()) {
                    Welcome(DEFAULT_AGENT, Modifier.fillMaxSize().padding(top = 82.dp, bottom = 92.dp))
                    FloatingHeader({}, {}, true, Modifier.align(Alignment.TopCenter).padding(12.dp))
                    Composer(
                        state = AppState(destination = AppDestination.Chat),
                        onSend = {},
                        onStop = {},
                        modifier = Modifier.align(Alignment.BottomCenter),
                    )
                }
            }
        }

        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val output = File(target.filesDir, "main-interface-reference.png")
        val captured = composeRule.onRoot().captureToImage().asAndroidBitmap()
        val scaled = Bitmap.createScaledBitmap(captured, 240, 533, true)
        FileOutputStream(output).use { stream ->
            scaled.compress(Bitmap.CompressFormat.PNG, 100, stream)
        }
    }
}
