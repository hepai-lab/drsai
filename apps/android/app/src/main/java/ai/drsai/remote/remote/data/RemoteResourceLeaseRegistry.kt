package ai.drsai.remote.remote.data

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Process-local ownership diagnostics for borrowed remote resources.
 *
 * It deliberately records only opaque resource classes and counts. Session,
 * workspace, message, token and path values must never enter diagnostics.
 */
class RemoteResourceLeaseRegistry {
    private val counts = ConcurrentHashMap<String, AtomicInteger>()

    fun acquire(resourceClass: String): AutoCloseable {
        require(resourceClass.matches(Regex("[a-z][a-z0-9_.-]{0,63}"))) {
            "unsafe_resource_class"
        }
        val count = counts.computeIfAbsent(resourceClass) { AtomicInteger() }
        count.incrementAndGet()
        val closed = AtomicBoolean(false)
        return AutoCloseable {
            if (closed.compareAndSet(false, true)) {
                check(count.decrementAndGet() >= 0) { "resource_lease_underflow" }
            }
        }
    }

    fun snapshot(): Map<String, Int> = counts.entries
        .mapNotNull { (key, value) -> value.get().takeIf { it > 0 }?.let { key to it } }
        .toMap()

    fun activeCount(): Int = counts.values.sumOf(AtomicInteger::get)
}
