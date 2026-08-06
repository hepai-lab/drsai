package ai.drsai.remote

import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.mergeDiscoveredModels
import org.junit.Assert.assertEquals
import org.junit.Test

class ModelDiscoveryMergeTest {
    @Test fun mergeReportsChangesAndNeverSilentlyDeletesMissingManualModels() {
        val manual = ModelInfo("manual-id", "Manual name", upstreamId = "manual", tools = true, source = "MANUAL")
        val retained = ModelInfo("retained-id", "Edited name", upstreamId = "RETAINED", vision = true, source = "PRESET")

        val result = mergeDiscoveredModels(listOf(manual, retained), listOf("retained", "new", "NEW", ""))

        assertEquals(1, result.added)
        assertEquals(1, result.retained)
        assertEquals(1, result.missing)
        assertEquals(listOf("RETAINED", "new", "manual"), result.models.map(ModelInfo::upstreamId))
        assertEquals("Edited name", result.models[0].name)
        assertEquals(true, result.models[0].vision)
        assertEquals("DISCOVERED", result.models[1].source)
        assertEquals("MANUAL", result.models[2].source)
        assertEquals(true, result.models[2].tools)
    }
}
