package ai.drsai.remote

import ai.drsai.remote.runtime.tools.NetworkSafetyPolicy
import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkSafetyPolicyTest {
    @Test fun localhostPrivateLinkLocalCarrierNatAndIpv6UlaAreDenied() {
        val denied = listOf(
            "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1",
        )
        denied.forEach { literal ->
            val policy = NetworkSafetyPolicy(resolver = { listOf(InetAddress.getByName(literal)) })
            val failure = runCatching { policy.validateUrl("https://example.test/") }.exceptionOrNull()
            assertTrue("expected denied: $literal", failure?.message in setOf("network_private_address_denied", "network_localhost_denied"))
        }
        val localhost = NetworkSafetyPolicy(resolver = { listOf(InetAddress.getByName("93.184.216.34")) })
        assertEquals("network_localhost_denied", runCatching { localhost.validateUrl("https://localhost/") }.exceptionOrNull()?.message)
    }

    @Test fun disabledSchemesCredentialsAndNonStandardPortsAreDeniedBeforeRequest() {
        val policy = NetworkSafetyPolicy(resolver = { listOf(InetAddress.getByName("93.184.216.34")) })
        mapOf(
            "http://example.test" to "network_https_required",
            "file:///etc/passwd" to "network_https_required",
            "https://user:pass@example.test" to "network_authority_invalid",
            "https://example.test:8443" to "network_port_denied",
        ).forEach { (url, code) -> assertEquals(code, runCatching { policy.validateUrl(url) }.exceptionOrNull()?.message) }
    }

    @Test fun dnsRebindingSecondResolutionCannotReturnPrivateAddress() {
        var resolution = 0
        val policy = NetworkSafetyPolicy(resolver = {
            resolution += 1
            listOf(InetAddress.getByName(if (resolution == 1) "93.184.216.34" else "127.0.0.1"))
        })
        policy.validateUrl("https://example.test/")
        assertEquals("network_private_address_denied", runCatching { policy.dns().lookup("example.test") }.exceptionOrNull()?.message)
        assertEquals(2, resolution)
    }

    @Test fun publicIpv4AndIpv6AreAllowedAndPinnedIntoDnsResult() {
        val expected = listOf(InetAddress.getByName("93.184.216.34"), InetAddress.getByName("2606:2800:220:1:248:1893:25c8:1946"))
        val policy = NetworkSafetyPolicy(resolver = { expected })
        assertEquals(expected, policy.resolvePublic("example.test"))
        assertEquals(expected, policy.dns().lookup("example.test"))
    }
}
