package ai.drsai.remote.runtime.setup

import ai.drsai.remote.R
import androidx.annotation.StringRes

enum class FirstTaskKind { CHAT, RETRIEVAL, LOCAL_SAFE_TOOL }

data class FirstTaskExample(
    val kind: FirstTaskKind,
    @StringRes val title: Int,
    @StringRes val description: Int,
    @StringRes val prompt: Int,
    val requiredTool: String? = null,
)

object FirstTaskExamples {
    val all = listOf(
        FirstTaskExample(
            FirstTaskKind.CHAT,
            R.string.first_task_chat_title,
            R.string.first_task_chat_description,
            R.string.first_task_chat_prompt,
        ),
        FirstTaskExample(
            FirstTaskKind.RETRIEVAL,
            R.string.first_task_retrieval_title,
            R.string.first_task_retrieval_description,
            R.string.first_task_retrieval_prompt,
            "web.search",
        ),
        FirstTaskExample(
            FirstTaskKind.LOCAL_SAFE_TOOL,
            R.string.first_task_local_title,
            R.string.first_task_local_description,
            R.string.first_task_local_prompt,
            "get_device_info",
        ),
    )

    fun available(toolNames: Collection<String>): List<FirstTaskExample> =
        all.filter { it.requiredTool == null || it.requiredTool in toolNames }
}
