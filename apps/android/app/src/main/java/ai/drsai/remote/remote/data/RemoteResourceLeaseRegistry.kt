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
data class RemoteResourceOwnershipSnapshot(
    val resourceClass: String,
    val ownerCount: Int,
    val activeLeases: Int,
    val capacity: Int,
)

class RemoteResourceLeaseRegistry(
    private val maxResourceClasses: Int = 32,
) {
    private data class OwnedResource(
        val owner: Any,
        val capacity: Int,
        val active: AtomicInteger = AtomicInteger(),
    )

    private val resources = ConcurrentHashMap<String, OwnedResource>()

    /** Register exactly one process owner before a resource can be borrowed. */
    fun registerOwner(resourceClass: String, owner: Any, capacity: Int = 1) {
        validateClass(resourceClass)
        require(capacity in 1..MAX_RESOURCE_CAPACITY) { "resource_capacity_invalid" }
        synchronized(resources) {
            val current = resources[resourceClass]
            if (current != null) {
                check(current.owner === owner && current.capacity == capacity) {
                    "resource_owner_conflict"
                }
                return
            }
            check(resources.size < maxResourceClasses) { "resource_catalog_capacity_exceeded" }
            resources[resourceClass] = OwnedResource(owner, capacity)
        }
    }

    fun acquire(resourceClass: String): AutoCloseable {
        validateClass(resourceClass)
        val resource = resources[resourceClass] ?: error("resource_owner_required")
        while (true) {
            val current = resource.active.get()
            check(current < resource.capacity) { "resource_capacity_exceeded" }
            if (resource.active.compareAndSet(current, current + 1)) break
        }
        val closed = AtomicBoolean(false)
        return AutoCloseable {
            if (closed.compareAndSet(false, true)) {
                check(resource.active.decrementAndGet() >= 0) { "resource_lease_underflow" }
            }
        }
    }

    /** Content-free active lease diagnostics. */
    fun snapshot(): Map<String, Int> = resources.entries
        .mapNotNull { (key, value) -> value.active.get().takeIf { it > 0 }?.let { key to it } }
        .toMap()

    fun ownershipSnapshot(): List<RemoteResourceOwnershipSnapshot> = resources.entries
        .sortedBy(Map.Entry<String, OwnedResource>::key)
        .map { (key, value) ->
            RemoteResourceOwnershipSnapshot(key, ownerCount = 1, value.active.get(), value.capacity)
        }

    fun activeCount(): Int = resources.values.sumOf { it.active.get() }

    private fun validateClass(resourceClass: String) {
        require(resourceClass.matches(SAFE_RESOURCE_CLASS)) { "unsafe_resource_class" }
    }

    private companion object {
        val SAFE_RESOURCE_CLASS = Regex("[a-z][a-z0-9_.-]{0,63}")
        const val MAX_RESOURCE_CAPACITY = 4096
    }
}
