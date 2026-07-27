package ai.drsai.remote

import ai.drsai.remote.remote.data.AssociationDeepLinkDecision
import ai.drsai.remote.remote.data.AssociationDeepLinkGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AssociationDeepLinkGateTest {
    private val issuer = "https://ai-dev.ihep.ac.cn"
    private val code = "abcdefghijklmnop"
    private val payload =
        "opendrsai://associate?v=1&environment=development&issuer=https%3A%2F%2Fai-dev.ihep.ac.cn&code=$code"

    @Test fun `valid association payload is accepted once`() {
        val gate = AssociationDeepLinkGate(issuer)
        assertEquals(AssociationDeepLinkDecision.Accept(code), gate.evaluate(payload))
        assertEquals(AssociationDeepLinkDecision.Duplicate, gate.evaluate(payload))
    }

    @Test fun `malicious authority path fragment and duplicate parameters fail closed`() {
        val gate = AssociationDeepLinkGate(issuer)
        val invalid = listOf(
            payload.replace("associate?", "evil.example/associate?"),
            payload.replace("associate?", "associate/path?"),
            "$payload#fragment",
            "$payload&code=otherabcdefghijkl",
            payload.replace("ai-dev.ihep.ac.cn", "ai.ihep.ac.cn"),
        )
        assertTrue(invalid.all { gate.evaluate(it) == AssociationDeepLinkDecision.Reject })
    }

    @Test fun `a new one time grant replaces an earlier in memory grant`() {
        val gate = AssociationDeepLinkGate(issuer)
        gate.evaluate(payload)
        val next = payload.replace(code, "ponmlkjihgfedcba")
        assertEquals(
            AssociationDeepLinkDecision.Accept("ponmlkjihgfedcba"),
            gate.evaluate(next),
        )
    }
}
