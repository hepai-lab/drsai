package ai.drsai.remote

import ai.drsai.remote.runtime.reliability.*
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.WorkbenchId
import org.junit.Assert.*
import org.junit.Test

class RuntimeReliabilityTest {
    @Test fun retriesOnlyClassifiedIdempotentFailuresWithinBudget() {
        val policy = RuntimeRetryPolicy(maxAttempts = 3, baseDelayMillis = 100, maxDelayMillis = 250)
        val retryable = RuntimeFailureCatalog.classify(503)
        assertEquals(RetryDecision(true, 100, "server_unavailable"), policy.decide(retryable, 0, "key"))
        assertEquals(200, policy.decide(retryable, 1, "key").delayMillis)
        assertEquals(250, policy.decide(retryable, 2, "key").delayMillis)
        assertFalse(policy.decide(retryable, 3, "key").retry)
        assertFalse(policy.decide(retryable, 0, null).retry)
        assertFalse(policy.decide(RuntimeFailureCatalog.classify(400), 0, "key").retry)
        assertFalse(policy.decide(RuntimeFailureCatalog.classify(503, sideEffectStarted = true), 0, "key").retry)
    }

    @Test fun quotaEvictionIsStableAndNeverRemovesPinnedOrActiveResources() {
        val records = listOf(
            ResourceRecord("pinned", 100, 0, pinned = true),
            ResourceRecord("active", 100, 0, active = true),
            ResourceRecord("old", 100, 1),
            ResourceRecord("new", 100, 2),
        )
        assertEquals(listOf("old", "new"), ResourceRetentionPolicy.evictions(records, 200, 2).map { it.id })
    }

    @Test fun deviceConstraintsPauseOrOfferRemoteHandoffInsteadOfForcingBackgroundExecution() {
        assertEquals(ConstraintDecision.PAUSE, DeviceConstraintPolicy.decide(
            DeviceConstraints(80, true, ThermalLevel.CRITICAL, false, true), true))
        assertEquals(ConstraintDecision.OFFER_HANDOFF, DeviceConstraintPolicy.decide(
            DeviceConstraints(10, false, ThermalLevel.NORMAL, false, true), true))
        assertEquals(ConstraintDecision.REQUIRE_FOREGROUND, DeviceConstraintPolicy.decide(
            DeviceConstraints(80, true, ThermalLevel.NORMAL, false, false), true))
    }

    @Test fun cursorMergeDropsDuplicatesAndReportsTheFirstGap() {
        val result = EventCursorReconciler.merge(2, setOf("old"), listOf(
            CursorEvent("old", 2), CursorEvent("three", 3), CursorEvent("five", 5),
        ))
        assertEquals(listOf("three"), result.accepted.map { it.eventId })
        assertEquals(3, result.cursor)
        assertEquals(4L, result.gapAt)
    }

    @Test fun diagnosticsAreBoundedAndRedactedAndWorkNamesAreRunScoped() {
        val bundle = DiagnosticBundleFactory.create(
            RuntimeFailureCatalog.classify(401), "request", WorkbenchId("run"), RuntimeAuthority.LOCAL_DEVICE,
            "Bearer very-secret api_key=also-secret",
        )
        assertFalse(bundle.details.contains("very-secret"))
        assertFalse(bundle.details.contains("also-secret"))
        assertNotEquals(
            BackgroundRunKeys.uniqueWorkName("alice", WorkbenchId("run")),
            BackgroundRunKeys.uniqueWorkName("alice", WorkbenchId("other")),
        )
    }

    @Test fun unknownFailuresAreNotMisreportedAsNetworkFailures() {
        assertEquals(FailureCategory.UNKNOWN, RuntimeFailureCatalog.classify(null).category)
        assertEquals(FailureCategory.NETWORK, RuntimeFailureCatalog.classify(0).category)
    }

    @Test fun everyTerminalFailureClassHasARecoveryActionAndCorrelatableDiagnostic() {
        val failures = listOf(
            RuntimeFailureCatalog.classify(0),
            RuntimeFailureCatalog.classify(401),
            RuntimeFailureCatalog.classify(422, "context_budget_exceeded"),
            RuntimeFailureCatalog.classify(429),
            RuntimeFailureCatalog.classify(503),
            RuntimeFailureCatalog.classify(null, "cancelled"),
            RuntimeFailureCatalog.classify(null, "journal_write_failed"),
            RuntimeFailureCatalog.classify(500, sideEffectStarted = true),
        )
        assertEquals(FailureCategory.entries.toSet(), failures.map { it.category }.toSet())
        failures.forEachIndexed { index, failure ->
            assertTrue(failure.code.isNotBlank())
            assertTrue(failure.userAction.isNotBlank())
            val bundle = DiagnosticBundleFactory.create(
                failure,
                requestId = "request-$index",
                runId = WorkbenchId("run-$index"),
                authority = RuntimeAuthority.LOCAL_DEVICE,
                rawDetails = "failure=${failure.code}",
            )
            assertEquals("request-$index", bundle.requestId)
            assertEquals("run-$index", bundle.runId!!.value)
        }
    }
}
