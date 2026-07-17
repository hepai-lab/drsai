package ai.drsai.remote.remote

import ai.drsai.remote.remote.data.ReadOnlyWorkspaceOperation

object RemoteArchitecturePolicy {
    val allowedConnectionKinds: Set<String> = setOf("relay")
    val forbiddenAndroidV1Concepts: Set<String> = setOf(
        "ssh_private_key",
        "known_hosts",
        "proxy_jump",
        "runtime_install",
        "runtime_upgrade",
        "runtime_rollback",
    )
    val allowedWorkspaceOperations: Set<String> = ReadOnlyWorkspaceOperation.entries.mapTo(linkedSetOf()) { it.wireName }
    val forbiddenWriteOperations: Set<String> = setOf(
        "files.write",
        "files.move",
        "files.remove",
        "git.stage",
        "git.unstage",
        "git.revert",
        "git.commit",
        "git.push",
        "process.start",
        "pty.create",
        "checkpoint.restore",
        "checkpoint.accept",
    )

    fun requireAllowedOperation(operation: String) {
        require(operation in allowedWorkspaceOperations) { "android_v1_operation_not_allowed" }
    }

    fun requireAssociationGrant(
        alreadyRegistered: Boolean,
        opaqueCode: String,
        containsNetworkCoordinates: Boolean,
        containsLongLivedCredential: Boolean,
    ) {
        require(alreadyRegistered) { "runtime_must_be_registered_before_android_association" }
        require(opaqueCode.length in 16..512) { "association_code_invalid" }
        require(!containsNetworkCoordinates) { "association_must_not_contain_network_coordinates" }
        require(!containsLongLivedCredential) { "association_must_not_contain_long_lived_credential" }
    }
}

