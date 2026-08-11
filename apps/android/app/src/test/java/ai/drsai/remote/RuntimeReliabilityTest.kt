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

    @Test fun resourcePressureBlocksOrOffersExplicitRemoteWithoutAnyLiteRoute() {
        val healthy = DeviceConstraints(80, true, ThermalLevel.NORMAL, false, true)
        assertEquals("python_local", RuntimeResourcePolicy.decide(healthy, 256, 1024).route)
        assertEquals(2, RuntimeResourcePolicy.decide(healthy, 256, 1024).maxParallelAgents)
        val lowMemory = RuntimeResourcePolicy.decide(healthy.copy(lowMemory = true), 256, 1024)
        assertEquals("full_runtime_blocked", lowMemory.route)
        assertEquals(0, lowMemory.maxParallelAgents)
        assertEquals("remote_full_offer", RuntimeResourcePolicy.decide(healthy.copy(thermal = ThermalLevel.SEVERE), 256, 1024).route)
        val oversizedArtifact = RuntimeResourcePolicy.decide(healthy, 256, 65L * 1024 * 1024)
        assertEquals("full_runtime_blocked", oversizedArtifact.route)
        assertEquals("resource_artifact_limit", oversizedArtifact.reason)
        listOf(lowMemory, oversizedArtifact).forEach { decision ->
            assertFalse(decision.route.contains("lite", ignoreCase = true))
        }
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
        val pathBundle = DiagnosticBundleFactory.create(
            RuntimeFailureCatalog.classify(null, "python_failed"), "request", WorkbenchId("run"),
            RuntimeAuthority.LOCAL_DEVICE, "https://host/private C:\\Users\\alice\\secret.txt",
        )
        assertFalse(pathBundle.details.contains("https://"))
        assertFalse(pathBundle.details.contains("C:\\Users"))
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
            RuntimeFailureCatalog.classify(null, "python_failed"),
            RuntimeFailureCatalog.classify(null, "binder_died"),
            RuntimeFailureCatalog.classify(null, "model_timeout"),
            RuntimeFailureCatalog.classify(null, "tool_failed"),
            RuntimeFailureCatalog.classify(null, "approval_expired"),
            RuntimeFailureCatalog.classify(null, "room_write_failed"),
            RuntimeFailureCatalog.classify(null, "policy_invalid"),
            RuntimeFailureCatalog.classify(null, "resource_low_memory"),
            RuntimeFailureCatalog.classify(null, "unexpected"),
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
