package ai.drsai.remote.runtime.oaep

/** Strong identities at the backend -> Android authority -> OAEP boundary. */
@JvmInline
value class BackendItemId private constructor(val value: String) {
    companion object {
        fun of(value: String) = BackendItemId(value.requireOaepIdentity("backend_item"))
    }
}

@JvmInline
value class AndroidRuntimeScopeId private constructor(val value: String) {
    companion object {
        fun of(value: String) = AndroidRuntimeScopeId(value.requireOaepIdentity("android_runtime_scope"))
    }
}

@JvmInline
value class OaepRuntimeId private constructor(val value: String) {
    companion object {
        fun of(value: String) = OaepRuntimeId(value.requireOaepIdentity("oaep_runtime"))
    }
}

@JvmInline
value class OaepItemId private constructor(val value: String) {
    companion object {
        fun of(value: String) = OaepItemId(value.requireOaepIdentity("oaep_item"))
    }
}

data class AndroidOaepItemBinding(
    val backendItemId: BackendItemId,
    val oaepItemId: OaepItemId,
)

private fun String.requireOaepIdentity(kind: String): String = trim().also {
    require(it.isNotEmpty() && it.length <= 256 && '\u0000' !in it) { "${kind}_id_invalid" }
}
