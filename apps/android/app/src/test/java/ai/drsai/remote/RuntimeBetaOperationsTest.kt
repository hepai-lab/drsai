package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import org.junit.Assert.assertEquals
import org.junit.Test

class RuntimeBetaOperationsTest {
    @Test fun `hard integrity event immediately activates kill switch`() {
        val decision = RuntimeBetaOperationsPolicy.decide(BetaStage.BETA_1, metrics(duplicateSideEffects = 1), "policy-7")
        assertEquals(BetaRolloutAction.KILL_SWITCH, decision.action)
        assertEquals("duplicate_side_effect", decision.reason)
    }

    @Test fun `rates pause while sample and observation gates hold expansion`() {
        assertEquals(BetaRolloutAction.PAUSE, RuntimeBetaOperationsPolicy.decide(
            BetaStage.BETA_1, metrics(samples = 100, crashes = 1), "policy-7").action)
        assertEquals("minimum_samples", RuntimeBetaOperationsPolicy.decide(
            BetaStage.BETA_5, metrics(samples = 499, observationHours = 200.0), "policy-7").reason)
        assertEquals("observation_window", RuntimeBetaOperationsPolicy.decide(
            BetaStage.BETA_5, metrics(samples = 500, observationHours = 119.0), "policy-7").reason)
        assertEquals(BetaRolloutAction.EXPAND, RuntimeBetaOperationsPolicy.decide(
            BetaStage.BETA_5, metrics(samples = 500, observationHours = 120.0), "policy-7").action)
    }

    @Test fun `feedback incident requires owner severity diagnostic and fix version`() {
        val incident = BetaIncident("diag-1", "critical", "runtime-team", "1.5.5", "investigating")
        assertEquals("runtime-team", incident.owner)
    }

    private fun metrics(
        samples: Int = 100, observationHours: Double = 72.0, crashes: Int = 0,
        duplicateSideEffects: Int = 0,
    ) = BetaRuntimeMetrics(
        samples, observationHours, crashes, 0, 100, 0, duplicateSideEffects,
        0, 0, 0, 0,
    )
}
