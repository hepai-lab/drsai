package ai.drsai.remote

import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelProviderSecretRedactionTest {
    @Test fun redactsProviderHeadersJsonFieldsAndCommonKeyPrefixes() {
        val secrets = listOf(
            "openai-secret-value",
            "anthropic-secret-value",
            "sk-proj-1234567890abcdef",
            "sk-ant-api03-1234567890abcdef",
        )
        val raw = "Authorization: Bearer ${secrets[0]} x-api-key=${secrets[1]} " +
            "{\"api_key\":\"${secrets[2]}\",\"x-api-key\":\"${secrets[3]}\"}"

        val redacted = SensitiveDataRedactor.redact(raw)

        secrets.forEach { assertFalse(redacted.contains(it)) }
        assertTrue(redacted.contains("[REDACTED]"))
    }
}
