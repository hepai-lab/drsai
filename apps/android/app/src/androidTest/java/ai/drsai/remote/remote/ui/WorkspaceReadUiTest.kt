package ai.drsai.remote.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import ai.drsai.remote.remote.data.*
import org.junit.Rule
import org.junit.Test
import android.graphics.Bitmap
import java.io.ByteArrayOutputStream

class WorkspaceReadUiTest {
    @get:Rule val rule = createComposeRule()

    @Test fun fileTreeShowsMetadataPagingSearchAndTruncation() {
        val node = RemoteFileNode("opaque", "src/Main.kt", "file", 42, "今天", "modified")
        rule.setContent { MaterialTheme { WorkspaceFilesScreen(FileTreeUiState("Project", nodes = listOf(node), nextCursor = "next", truncated = true,
            ignoredHint = "已应用 Runtime 忽略规则"), {}, {}, {}, {}, {}) } }
        rule.onNodeWithText("src/Main.kt").assertIsDisplayed(); rule.onNodeWithText("file · 42 B · 今天 · modified").assertIsDisplayed()
        rule.onNodeWithText("加载更多").assertIsDisplayed(); rule.onNodeWithText("结果已截断，请缩小范围").assertIsDisplayed()
        rule.onNodeWithText("在工作区中搜索").assertIsDisplayed()
    }

    @Test fun previewAndGitCommunicateBoundariesAndExposeNoWriteControls() {
        rule.setContent { MaterialTheme { WorkspaceGitScreen(GitReadUiState(GitStatusUi("main", "abc", listOf(GitChangeUi("a.bin", "modified"))),
            BoundedDiff(null, binary = true, truncated = false, staleRevision = false)), {}, {}) } }
        rule.onNodeWithText("Git · main").assertIsDisplayed(); rule.onNodeWithText("二进制文件无法显示 Diff").assertIsDisplayed()
        listOf("暂存", "撤销", "提交", "stage", "revert", "commit").forEach { rule.onAllNodesWithText(it).assertCountEquals(0) }
    }

    @Test fun unsupportedPreviewOffersExternalOpenAndCancel() {
        rule.setContent { MaterialTheme { FilePreviewScreen(FilePreviewUiState("x.xyz", PreviewKind.UNSUPPORTED, loading = true), {}, {}, {}) } }
        rule.onNodeWithText("暂不支持此格式预览").assertIsDisplayed(); rule.onNodeWithText("下载并使用其他应用打开").assertIsDisplayed(); rule.onNodeWithText("取消").assertIsDisplayed()
    }

    @Test fun imagePreviewDecodesBoundedBytes() {
        val bytes = ByteArrayOutputStream().also { Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        rule.setContent { MaterialTheme { FilePreviewScreen(FilePreviewUiState("image.png", PreviewKind.IMAGE, imageBytes = bytes), {}, {}, {}) } }
        rule.onNodeWithContentDescription("image.png").assertIsDisplayed()
    }
}
