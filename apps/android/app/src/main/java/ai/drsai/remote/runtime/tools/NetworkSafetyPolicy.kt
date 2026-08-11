package ai.drsai.remote.runtime.tools

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import okhttp3.Dns

class NetworkSafetyPolicy(
    private val resolver: (String) -> List<InetAddress> = { host -> InetAddress.getAllByName(host).toList() },
    private val allowPrivateForTests: Boolean = false,
) {
    fun validateUrl(url: String, allowHttpForTests: Boolean = false): URI {
        val uri = runCatching { URI(url) }.getOrElse { throw IllegalArgumentException("network_url_invalid") }
        require(uri.scheme == "https" || (allowHttpForTests && uri.scheme == "http")) { "network_https_required" }
        require(uri.userInfo == null && !uri.host.isNullOrBlank()) { "network_authority_invalid" }
        if (!allowHttpForTests) require(uri.port in setOf(-1, 443)) { "network_port_denied" }
        resolvePublic(uri.host)
        return uri
    }

    fun resolvePublic(host: String): List<InetAddress> {
        require(host.lowercase() !in setOf("localhost", "localhost.localdomain", "ip6-localhost")) {
            "network_localhost_denied"
        }
        val addresses = resolver(host)
        require(addresses.isNotEmpty()) { "network_dns_empty" }
        if (!allowPrivateForTests) require(addresses.all(::isPublic)) { "network_private_address_denied" }
        return addresses
    }

    fun dns(): Dns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> = resolvePublic(hostname)
    }

    internal fun isPublic(address: InetAddress): Boolean {
        if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
            address.isSiteLocalAddress || address.isMulticastAddress) return false
        val bytes = address.address.map(Byte::toInt).map { it and 0xff }
        return when (address) {
            is Inet4Address -> when {
                bytes[0] == 0 || bytes[0] == 10 || bytes[0] == 127 -> false
                bytes[0] == 100 && bytes[1] in 64..127 -> false
                bytes[0] == 169 && bytes[1] == 254 -> false
                bytes[0] == 172 && bytes[1] in 16..31 -> false
                bytes[0] == 192 && bytes[1] == 168 -> false
                bytes[0] >= 224 -> false
                else -> true
            }
            is Inet6Address -> bytes.first() and 0xfe != 0xfc && !(bytes[0] == 0xfe && bytes[1] and 0xc0 == 0x80)
            else -> false
        }
    }
}
