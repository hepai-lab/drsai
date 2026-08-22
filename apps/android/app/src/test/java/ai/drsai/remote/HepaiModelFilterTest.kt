package ai.drsai.remote

import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.retainDefaultHepaiModels
import org.junit.Assert.assertEquals
import org.junit.Test

class HepaiModelFilterTest {
    @Test fun keepsOnlyApprovedDeepSeekModelsInRequestedOrder() {
        val result = retainDefaultHepaiModels(
            listOf(
                ModelInfo("openai/gpt-5.4"),
                ModelInfo("deepseek-ai/deepseek-v4-pro"),
                ModelInfo("anthropic/claude-sonnet-4-5"),
                ModelInfo("deepseek-ai/deepseek-v4-flash"),
                ModelInfo("deepseek-v4-pro"),
            ),
        )

        assertEquals(
            listOf("deepseek-ai/deepseek-v4-pro", "deepseek-ai/deepseek-v4-flash"),
            result.map(ModelInfo::id),
        )
    }
}
