package ai.drsai.remote.remote.data

import kotlinx.coroutines.Job
import java.util.concurrent.ConcurrentHashMap

private val SECRET_PATTERN = Regex(
    "(?i)(authorization|cookie|token|secret|code|file_content)(\\s*[:=]\\s*)([^\\s,;}]+)"
)

fun redactRemoteSecrets(value: String): String = SECRET_PATTERN.replace(value) { match ->
    "${match.groupValues[1]}${match.groupValues[2]}[REDACTED]"
}

/** Process-local subscription ownership, cleared synchronously on logout/account switch. */
object RemoteSubscriptionRegistry {
    private val jobs = ConcurrentHashMap<String, MutableSet<Job>>()
    fun register(subject: String, job: Job) { jobs.computeIfAbsent(subject) { ConcurrentHashMap.newKeySet() }.add(job) }
    fun unregister(subject: String, job: Job) { jobs[subject]?.remove(job) }
    fun cancelSubject(subject: String) { jobs.remove(subject)?.forEach(Job::cancel) }
    fun activeCount(subject: String): Int = jobs[subject]?.count(Job::isActive) ?: 0
}
