package ai.drsai.remote

import ai.drsai.remote.remote.security.RelayAssociationDevice
import ai.drsai.remote.remote.security.RelayDeviceSigner
import ai.drsai.remote.runtime.oaep.AndroidRuntimeEnrollmentClient
import ai.drsai.remote.runtime.oaep.AndroidRuntimeEnrollmentStore
import ai.drsai.remote.runtime.oaep.StoredAndroidRuntimeEnrollment
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class AndroidOaepRelayEnrollmentTest {
    @Test
    fun enrollment_uses_runtime_public_key_and_persists_account_bound_credential() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(
            """{"runtime_id":"runtime-enrolled","registration_token":"runtime-secret"}""",
        ).setHeader("Content-Type", "application/json"))
        server.start()
        val store = RecordingStore()
        val signer = object : RelayDeviceSigner {
            override val associationDevice = RelayAssociationDevice(
                "android-device", "Android", "registered-public-key",
            )
            override fun sign(message: ByteArray) = ByteArray(64)
        }
        try {
            val result = AndroidRuntimeEnrollmentClient(
                requestId = { "request-1234" }, instanceId = { "android-instance-1" },
            ).enroll(
                server.url("/").toString().trimEnd('/'), "registration-code", "subject-1",
                "Android Agent Runtime", "1.5.6", signer, store,
            )
            assertSame(result, store.saved)
            assertEquals("runtime-enrolled", result.runtimeId)
            assertEquals("subject-1", result.ownerSubject)
            assertEquals("android-instance-1", result.instanceId)
            assertEquals("ws", result.connectorCredential().wssUrl.substringBefore("://"))

            val request = server.takeRequest()
            assertEquals("registration-code", request.getHeader("X-Registration-Code"))
            assertEquals("/v1/runtimes/register", request.path)
            val body = JSONObject(request.body.readUtf8())
            assertEquals("request-1234", body.getString("request_id"))
            assertEquals("android-runtime-request-1234", body.getString("idempotency_key"))
            assertEquals("registered-public-key", body.getString("public_key"))
        } finally {
            server.shutdown()
        }
    }

    private class RecordingStore : AndroidRuntimeEnrollmentStore {
        var saved: StoredAndroidRuntimeEnrollment? = null
        override fun load(ownerSubject: String) = saved?.takeIf { it.ownerSubject == ownerSubject }
        override fun save(value: StoredAndroidRuntimeEnrollment) { saved = value }
        override fun clear(ownerSubject: String) { if (saved?.ownerSubject == ownerSubject) saved = null }
    }
}
