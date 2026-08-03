package ai.drsai.remote.remote.data

import kotlinx.coroutines.Job
import java.util.concurrent.ConcurrentHashMap

private val BEARER_PATTERN = Regex("(?i)\\b(Bearer\\s+)[A-Za-z0-9._~+/=-]+")
private val QUERY_SECRET_PATTERN = Regex(
    "(?i)([?&](?:code|state|token|access_token|refresh_token|id_token|client_secret)=)[^&#\\s]+"
)
private val SECRET_PATTERN = Regex(
    """(?ix)(
        ["']?
        (?:authorization|cookie|token|secret|code|state|api[_-]?key|
           access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|
           registration[_-]?token|access[_-]?grant[_-]?code|password|
           file[_-]?content|message|prompt|command|arguments)
        ["']?\s*[:=]\s*["']?
    )([^\s"',;&}\]]+)"""
)

fun redactRemoteSecrets(value: String): String {
    val bearerSafe = BEARER_PATTERN.replace(value) { "${it.groupValues[1]}[REDACTED]" }
    val querySafe = QUERY_SECRET_PATTERN.replace(bearerSafe) { "${it.groupValues[1]}[REDACTED]" }
    return SECRET_PATTERN.replace(querySafe) { "${it.groupValues[1]}[REDACTED]" }
}

/** Process-local subscription ownership, cleared synchronously on logout/account switch. */
object RemoteSubscriptionRegistry {
    private val jobs = ConcurrentHashMap<String, MutableSet<Job>>()
    fun register(subject: String, job: Job) { jobs.computeIfAbsent(subject) { ConcurrentHashMap.newKeySet() }.add(job) }
    fun unregister(subject: String, job: Job) { jobs[subject]?.remove(job) }
    fun cancelSubject(subject: String) { jobs.remove(subject)?.forEach(Job::cancel) }
    fun activeCount(subject: String): Int = jobs[subject]?.count(Job::isActive) ?: 0
}
