package ai.drsai.remote.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test

class RemoteMarkdownUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun completeMarkdownRendersWithoutRawSyntaxMarkers() {
        compose.setContent {
            MaterialTheme {
                RemoteMarkdownContent(
                    """
                    ## 二级标题

                    **加粗**、*斜体* 和 `inline`

                    - [x] 已完成
                    - 普通事项

                    | 名称 | 值 |
                    | --- | --- |
                    | answer | 42 |

                    ```kotlin
                    val answer = 42
                    ```
                    """.trimIndent(),
                )
            }
        }

        compose.onNodeWithText("二级标题").assertIsDisplayed()
        compose.onNodeWithText("## 二级标题").assertDoesNotExist()
        compose.onNodeWithText("加粗、斜体 和 inline").assertIsDisplayed()
        compose.onNodeWithText("☑").assertIsDisplayed()
        compose.onNodeWithText("已完成").assertIsDisplayed()
        compose.onNodeWithText("名称").assertIsDisplayed()
        compose.onNodeWithText("42").assertIsDisplayed()
        compose.onNodeWithContentDescription("复制表格").assertIsDisplayed()
        compose.onNodeWithText("val answer = 42").assertIsDisplayed()
        compose.onNodeWithContentDescription("复制代码").assertIsDisplayed()
    }
}
