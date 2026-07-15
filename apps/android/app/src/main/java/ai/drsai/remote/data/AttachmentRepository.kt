package ai.drsai.remote.data

import ai.drsai.remote.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class AttachmentContext(val id: String, val kind: String, val mimeType: String, val text: String?, val truncated: Boolean)

interface AttachmentContextGateway {
    suspend fun context(remoteId: String): AttachmentContext
}

class AttachmentRepository(
    private val auth: AccessTokenCoordinator,
    private val baseUrl: String = BuildConfig.HAI_BASE_URL,
    private val http: OkHttpClient = platformHttpClient(readTimeoutSeconds = 180),
) : AttachmentContextGateway {
    suspend fun upload(
        draft: AttachmentDraft,
        threadId: String,
        runId: String,
        requestId: String,
        onProgress: (Int) -> Unit,
    ): RemoteAttachment = withContext(Dispatchers.IO) {
        val file = File(draft.localPath)
        if (!file.isFile) throw ApiException(400, "附件缓存已失效", false)
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("thread_id", threadId)
            .addFormDataPart("run_id", runId)
            .addFormDataPart("file", draft.name, ProgressFileBody(file, draft.mimeType, onProgress))
            .build()
        val response = authenticated { token ->
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/native/v1/attachments")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer $token")
                .header("Idempotency-Key", "android-attachment-$requestId")
                .post(body)
                .build()
        }
        response.use { parseRemoteAttachment(it) }
    }

    suspend fun delete(remoteId: String) = withContext(Dispatchers.IO) {
        authenticated { token ->
            Request.Builder().url("${baseUrl.trimEnd('/')}/api/native/v1/attachments/$remoteId")
                .header("Authorization", "Bearer $token").delete().build()
        }.use { response -> if (!response.isSuccessful && response.code != 404) throw nativeApiError(response.code, response.body?.string().orEmpty()) }
    }

    suspend fun download(remoteId: String, target: File, onProgress: (Int) -> Unit = {}): File = withContext(Dispatchers.IO) {
        val response = authenticated { token ->
            Request.Builder().url("${baseUrl.trimEnd('/')}/api/native/v1/attachments/$remoteId/content")
                .header("Authorization", "Bearer $token").get().build()
        }
        response.use {
            if (!it.isSuccessful) throw nativeApiError(it.code, it.body?.string().orEmpty())
            target.parentFile?.mkdirs()
            val expected = it.body?.contentLength()?.takeIf { size -> size > 0 } ?: 0
            var received = 0L
            try {
                val source = it.body?.byteStream() ?: throw ApiException(502, "结果文件内容为空")
                source.use { input ->
                    FileOutputStream(target).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            received += count
                            if (received > MAX_ATTACHMENT_BYTES) throw ApiException(413, "结果文件超过 10 MB 限制", false)
                            output.write(buffer, 0, count)
                            if (expected > 0) onProgress(((received * 100) / expected).toInt().coerceIn(0, 100))
                        }
                    }
                }
                if (received == 0L) throw ApiException(502, "结果文件内容为空")
                onProgress(100)
                target
            } catch (error: Throwable) {
                target.delete()
                throw error
            }
        }
    }

    override suspend fun context(remoteId: String): AttachmentContext = withContext(Dispatchers.IO) {
        authenticated { token ->
            Request.Builder().url("${baseUrl.trimEnd('/')}/api/native/v1/attachments/$remoteId/context")
                .header("Accept", "application/json").header("Authorization", "Bearer $token").get().build()
        }.use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw nativeApiError(response.code, raw)
            val data = JSONObject(raw).getJSONObject("data")
            AttachmentContext(
                id = data.getString("id"), kind = data.getString("kind"), mimeType = data.getString("mime_type"),
                text = if (data.isNull("text")) null else data.getString("text"), truncated = data.optBoolean("truncated"),
            )
        }
    }

    private suspend fun authenticated(factory: (String) -> Request): Response {
        val initial = auth.current()
        var response = execute(factory(initial))
        if (response.code == 401) {
            val raw = response.body?.string().orEmpty()
            val code = nativeErrorCode(raw)
            response.close()
            if (code != "token_expired") throw nativeApiError(401, raw)
            val refreshed = auth.refreshAfter(initial) ?: throw ApiException(401, "HAI 登录已过期，请重新登录", false)
            response = execute(factory(refreshed))
        }
        return response
    }

    private suspend fun execute(request: Request): Response = suspendCancellableCoroutine { continuation ->
        val call = http.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) {
                if (!continuation.isActive) return
                if (call.isCanceled()) continuation.resumeWithException(CancellationException("附件任务已取消"))
                else continuation.resumeWithException(ApiException(0, error.message ?: "附件上传连接中断"))
            }

            override fun onResponse(call: Call, response: Response) {
                if (continuation.isActive) continuation.resume(response)
                else response.close()
            }
        })
    }

    private fun parseRemoteAttachment(response: Response): RemoteAttachment {
        val raw = response.body?.string().orEmpty()
        if (!response.isSuccessful) throw nativeApiError(response.code, raw)
        val data = runCatching { JSONObject(raw).getJSONObject("data") }
            .getOrElse { throw ApiException(502, "附件服务返回了无效数据") }
        return RemoteAttachment(
            id = data.getString("id"), name = data.getString("name"), kind = data.getString("kind"),
            mimeType = data.getString("mime_type"), size = data.getLong("size"), sha256 = data.getString("sha256"),
            processingStatus = data.getString("processing_status"), expiresAt = data.optString("expires_at").ifBlank { null },
        )
    }
}

private class ProgressFileBody(
    private val file: File,
    private val mimeType: String,
    private val progress: (Int) -> Unit,
) : RequestBody() {
    override fun contentType() = mimeType.toMediaType()
    override fun contentLength() = file.length()
    override fun writeTo(sink: BufferedSink) {
        var sent = 0L
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                sink.write(buffer, 0, count)
                sent += count
                progress(((sent * 100) / contentLength().coerceAtLeast(1)).toInt().coerceIn(0, 100))
            }
        }
    }
}
