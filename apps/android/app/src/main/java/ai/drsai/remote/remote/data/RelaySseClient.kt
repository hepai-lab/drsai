package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.EventId
import ai.drsai.remote.remote.model.RemoteRunIdentity
import ai.drsai.remote.remote.model.RemoteRunStatus
import ai.drsai.remote.remote.model.RemoteRuntimeEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

data class RelayStreamEvent(val event: RemoteRuntimeEvent, val payload: JSONObject)

class RelaySseClient(
    baseUrl: String,
    private val accessToken: () -> String,
    private val http: OkHttpClient = OkHttpClient(),
) {
    private val root = baseUrl.trimEnd('/').toHttpUrl()

    fun stream(identity: RemoteRunIdentity, afterSequence: Long): Flow<RelayStreamEvent> = channelFlow {
        require(afterSequence >= 0) { "after_sequence_invalid" }
        val call = http.newCall(Request.Builder().url(root.newBuilder()
            .addPathSegments("v1/runtimes/${identity.runtimeId.value}/runs/${identity.runId.value}/events/stream")
            .addQueryParameter("after_sequence", afterSequence.toString()).build())
            .header("Accept", "text/event-stream")
            .header("Authorization", "Bearer ${accessToken()}").build())
        val reader = launch(Dispatchers.IO) {
            call.execute().use { response ->
                if (!response.isSuccessful) throw RelayHttpException(response.code, response.header("X-Correlation-Id"))
                val source = response.body?.source() ?: error("relay_sse_empty")
                var data: String? = null
                while (!source.exhausted()) {
                    val line = source.readUtf8Line() ?: break
                    when {
                        line.startsWith("data:") -> data = line.removePrefix("data:").trim()
                        line.isEmpty() && data != null -> {
                            val root = JSONObject(data!!)
                            val returned = RemoteRunIdentity(
                                ai.drsai.remote.remote.model.RuntimeId(root.getString("runtime_id")),
                                ai.drsai.remote.remote.model.WorkspaceId(root.getString("workspace_id")),
                                ai.drsai.remote.remote.model.SessionId(root.getString("session_id")),
                                ai.drsai.remote.remote.model.RunId(root.getString("run_id")),
                                identity.backendId,
                            )
                            identity.requireSameScope(returned)
                            val payload = root.getJSONObject("payload")
                            val status = payload.optString("status").takeIf(String::isNotBlank)?.let {
                                runCatching { RemoteRunStatus.valueOf(it.uppercase()) }.getOrNull()
                            }
                            send(RelayStreamEvent(RemoteRuntimeEvent(EventId(root.getString("event_id")), returned,
                                root.getLong("sequence"), root.getString("kind"), root.getString("timestamp"), status), payload))
                            data = null
                        }
                    }
                }
            }
            close()
        }
        awaitClose { call.cancel(); reader.cancel() }
    }
}
