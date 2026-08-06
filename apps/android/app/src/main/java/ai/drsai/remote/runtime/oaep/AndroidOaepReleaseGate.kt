package ai.drsai.remote.runtime.oaep

/** Immutable v1.5.6 Debug contract for the fully OAEP Android Agent Runtime. */
object AndroidOaepReleaseGate {
    const val ANDROID_AGENT_RUNTIME_VERSION = "1.5.6"
    const val MINIMUM_ANDROID_AGENT_RUNTIME_VERSION = "1.5.6"
    const val OAEP_PROTOCOL_VERSION = "1.0"
    const val OAEP_STREAM_PROFILE = "oaep.session-stream/1"

    val requiredCapabilities: Set<String> = setOf(
        "oaep.v1",
        "oaep.session.snapshot",
        "oaep.session.events",
        "oaep.session.events.stream",
        "event.cursor_expired",
    )

    /** There is deliberately no mutable switch back to a private/legacy fact authority. */
    val factAuthority: AndroidFactAuthority = AndroidFactAuthority.OAEP_SNAPSHOT

    fun negotiate(
        androidRuntimeVersion: String,
        protocolVersion: String?,
        profiles: Set<String>,
        capabilities: Set<String>,
        legacyRemoteAvailable: Boolean,
    ): AndroidOaepCompatibility {
        val hasOaepSignal = protocolVersion != null || profiles.any { it.startsWith("oaep.") } ||
            capabilities.any { it.startsWith("oaep.") }
        if (compareVersions(androidRuntimeVersion, MINIMUM_ANDROID_AGENT_RUNTIME_VERSION) < 0) {
            return AndroidOaepCompatibility.REJECT
        }
        val complete = protocolVersion == OAEP_PROTOCOL_VERSION &&
            OAEP_STREAM_PROFILE in profiles && requiredCapabilities.all(capabilities::contains)
        return when {
            complete -> AndroidOaepCompatibility.FULL_OAEP
            hasOaepSignal -> AndroidOaepCompatibility.REJECT
            legacyRemoteAvailable -> AndroidOaepCompatibility.SAFE_REMOTE_ONLY
            else -> AndroidOaepCompatibility.REJECT
        }
    }

    private fun compareVersions(left: String, right: String): Int {
        fun parts(value: String) = value.substringBefore('-').split('.').map {
            it.toIntOrNull() ?: Int.MIN_VALUE
        }
        val a = parts(left)
        val b = parts(right)
        if (Int.MIN_VALUE in a) return -1
        repeat(maxOf(a.size, b.size)) { index ->
            val comparison = a.getOrElse(index) { 0 }.compareTo(b.getOrElse(index) { 0 })
            if (comparison != 0) return comparison
        }
        return 0
    }
}

enum class AndroidOaepCompatibility { FULL_OAEP, SAFE_REMOTE_ONLY, REJECT }
enum class AndroidFactAuthority { OAEP_SNAPSHOT }
