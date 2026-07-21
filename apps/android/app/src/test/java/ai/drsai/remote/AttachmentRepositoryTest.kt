package ai.drsai.remote

import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.AttachmentDraft
import ai.drsai.remote.data.AttachmentRepository
import ai.drsai.remote.data.AttachmentStatus
import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.AuthTokenStore
import ai.drsai.remote.data.AuthTokens
import ai.drsai.remote.data.TokenLifecycleClient
import ai.drsai.remote.data.User
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.TimeUnit

class AttachmentRepositoryTest {
    @get:Rule val temporary = TemporaryFolder()
    private lateinit var server: MockWebServer

    @Before fun start() { server = MockWebServer().also { it.start() } }
    @After fun stop() { server.shutdown() }

    @Test fun uploads_multipart_with_auth_idempotency_and_progress() = runTest {
        server.enqueue(MockResponse().setBody("""{"status":true,"data":{"id":"att_1","name":"x.txt","kind":"file","mime_type":"text/plain","size":5,"sha256":"hash","processing_status":"ready","expires_at":"tomorrow"}}"""))
        val file = temporary.newFile("x.txt").apply { writeText("hello") }
        val progress = mutableListOf<Int>()
        val result = AttachmentRepository(
            AccessTokenCoordinator(FakeAttachmentTokens(), FakeAttachmentLifecycle()),
            server.url("/").toString(),
        ).upload(
            AttachmentDraft("local", "x.txt", "text/plain", 5, "file", file.absolutePath, sha256 = "hash", status = AttachmentStatus.READY),
            "thread-1", "run-1", "request-1", progress::add,
        )
        assertEquals("att_1", result.id)
        assertEquals(100, progress.last())
        val request = server.takeRequest()
        assertEquals("Bearer token", request.getHeader("Authorization"))
        assertEquals("android-attachment-request-1", request.getHeader("Idempotency-Key"))
        assertTrue(request.body.readUtf8().contains("thread-1"))
    }

    @Test fun refreshes_once_on_explicit_token_expiry() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"detail":{"code":"token_expired"}}"""))
        server.enqueue(MockResponse().setBody("""{"status":true,"data":{"id":"att_2","name":"x.txt","kind":"file","mime_type":"text/plain","size":1,"sha256":"h","processing_status":"ready"}}"""))
        val tokens = FakeAttachmentTokens()
        val lifecycle = FakeAttachmentLifecycle()
        val file = temporary.newFile("x.txt").apply { writeText("x") }
        AttachmentRepository(AccessTokenCoordinator(tokens, lifecycle), server.url("/").toString()).upload(
            AttachmentDraft("l", "x.txt", "text/plain", 1, "file", file.absolutePath), "t", "r", "q", {},
        )
        assertEquals(1, lifecycle.refreshes)
        assertEquals("Bearer token", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer refreshed", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun downloads_result_file_with_auth_and_progress() = runTest {
        server.enqueue(MockResponse().setBody("generated file"))
        val target = temporary.root.resolve("results/result.txt")
        val progress = mutableListOf<Int>()
        AttachmentRepository(
            AccessTokenCoordinator(FakeAttachmentTokens(), FakeAttachmentLifecycle()), server.url("/").toString(),
        ).download("att_result", target, progress::add)
        assertEquals("generated file", target.readText())
        assertEquals(100, progress.last())
        val request = server.takeRequest()
        assertEquals("/api/native/v1/attachments/att_result/content", request.requestUrl?.encodedPath)
        assertEquals("Bearer token", request.getHeader("Authorization"))
    }

    @Test fun cancelling_coroutine_cancels_inflight_upload() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val file = temporary.newFile("cancel.txt").apply { writeText("cancel me") }
        val repository = AttachmentRepository(
            AccessTokenCoordinator(FakeAttachmentTokens(), FakeAttachmentLifecycle()), server.url("/").toString(),
        )
        val job = launch {
            repository.upload(
                AttachmentDraft("cancel", "cancel.txt", "text/plain", file.length(), "file", file.absolutePath),
                "thread", "run", "cancel", {},
            )
        }
        delay(150)
        job.cancelAndJoin()
        assertTrue(job.isCancelled)
    }

    @Test fun maps_network_timeout_without_retrying_or_losing_the_draft_file() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val file = temporary.newFile("timeout.txt").apply { writeText("keep me") }
        val lifecycle = FakeAttachmentLifecycle()
        val client = OkHttpClient.Builder().readTimeout(150, TimeUnit.MILLISECONDS).build()
        val repository = AttachmentRepository(
            AccessTokenCoordinator(FakeAttachmentTokens(), lifecycle), server.url("/").toString(), client,
        )

        val error = runCatching {
            repository.upload(
                AttachmentDraft("timeout", "timeout.txt", "text/plain", file.length(), "file", file.absolutePath),
                "thread", "run", "timeout", {},
            )
        }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals(0, (error as ApiException).status)
        assertTrue(file.isFile)
        assertEquals(0, lifecycle.refreshes)
        assertEquals(1, server.requestCount)
    }
}

private class FakeAttachmentTokens : AuthTokenStore {
    override var accessToken: String? = "token"
    override var refreshToken: String? = "refresh"
    override fun save(auth: AuthTokens) { accessToken = auth.accessToken; refreshToken = auth.refreshToken }
}

private class FakeAttachmentLifecycle : TokenLifecycleClient {
    var refreshes = 0
    override suspend fun refresh(refreshToken: String): AuthTokens {
        refreshes += 1
        return AuthTokens("refreshed", "refresh-2", User("u"))
    }
    override suspend fun revoke(refreshToken: String) = Unit
}
