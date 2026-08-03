package ai.drsai.remote

import ai.drsai.remote.remote.model.RemoteRunIdentity
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class RemoteArchitectureBoundaryTest {
    @Test
    fun workspaceHasNoBackendOrConnectionSpecificIdentity() {
        val fields = RemoteWorkspaceRef::class.java.declaredFields.map { it.name }.toSet()
        assertFalse("backendId" in fields)
        assertFalse("threadId" in fields)
        assertFalse("turnId" in fields)
        assertFalse("sshHost" in fields)
    }

    @Test
    fun runIdentityCannotBeCopiedOrRebound() {
        val methodNames = RemoteRunIdentity::class.java.declaredMethods.map { it.name }
        assertFalse(methodNames.any { it == "copy" || it.startsWith("component") })
        val identityFields = RemoteRunIdentity::class.java.declaredFields
            .filterNot { it.isSynthetic || java.lang.reflect.Modifier.isStatic(it.modifiers) }
        assertTrue(identityFields.all { java.lang.reflect.Modifier.isPrivate(it.modifiers) })
        assertTrue(identityFields.all { java.lang.reflect.Modifier.isFinal(it.modifiers) })
    }

    @Test
    fun androidRemoteMainSourceDoesNotDependOnCodexPrivateProtocol() {
        val root = File("src/main/java/ai/drsai/remote/remote")
        // itemId is now part of the frozen, backend-neutral Session Conversation
        // contract. Codex-private thread/turn/app-server identities remain banned.
        val privateProtocolTokens = listOf("threadId", "turnId", "CodexAppServer", "app-server")
        val violations = root.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .flatMap { file -> privateProtocolTokens.asSequence().filter { token -> token in file.readText() }.map { file to it } }
            .toList()
        assertTrue("Codex private protocol leaked into Android: $violations", violations.isEmpty())
    }
}
