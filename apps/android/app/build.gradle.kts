import com.android.build.api.variant.impl.VariantOutputImpl
import groovy.json.JsonSlurper

val systemVersionFile = rootProject.file(
    "../webui/backend/src/drsai_ui/ui_backend/version.py"
)
val systemVersion = Regex("""(?m)^VERSION\s*=\s*[\"']([^\"']+)[\"']""")
    .find(systemVersionFile.readText())
    ?.groupValues
    ?.get(1)
    ?: error("Unable to read OpenDrSai VERSION from $systemVersionFile")
fun versionCodeFor(version: String): Int {
    val parts = version.split(".").map { part -> part.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
    return (parts.getOrElse(0) { 0 } * 10_000) +
        (parts.getOrElse(1) { 0 } * 100) + parts.getOrElse(2) { 0 }
}
val systemVersionCode = versionCodeFor(systemVersion)
val androidBuildPython = providers.gradleProperty("opendrsai.android.buildPython")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_BUILD_PYTHON"))
    .getOrElse(rootProject.file("../../.venv/Scripts/python.exe").absolutePath)
val pythonRuntimeEnabled = providers.gradleProperty("opendrsai.android.pythonRuntimeEnabled")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_PYTHON_RUNTIME_ENABLED"))
    .map(String::toBooleanStrict)
    .getOrElse(false)
val runtimePolicyPublicKey = providers.gradleProperty("opendrsai.android.runtimePolicyPublicKey")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_RUNTIME_POLICY_PUBLIC_KEY"))
    .getOrElse("")
val acceptanceVersion = providers.gradleProperty("opendrsai.android.acceptanceVersion").orNull?.also {
    require(Regex("\\d+\\.\\d+\\.\\d+").matches(it)) { "Invalid acceptance version: $it" }
}
val androidOidcClientId = providers.gradleProperty("opendrsai.oidc.clientId")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_OIDC_CLIENT_ID"))
    .getOrElse("opendrsai-android")
val androidOidcRedirectUri = providers.gradleProperty("opendrsai.oidc.redirectUri")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_OIDC_REDIRECT_URI"))
    .getOrElse("ai.drsai.remote:/oauth2redirect")
val haiBaseUrl = providers.gradleProperty("opendrsai.hai.baseUrl")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_HAI_BASE_URL"))
    .getOrElse("https://ai.ihep.ac.cn")
val developmentHaiBaseUrl = providers.gradleProperty("opendrsai.hai.developmentBaseUrl")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_DEVELOPMENT_HAI_BASE_URL"))
    .getOrElse("https://ai-dev.ihep.ac.cn")
val oidcIssuer = providers.gradleProperty("opendrsai.oidc.issuer")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_OIDC_ISSUER"))
    .getOrElse("$haiBaseUrl/api")
val oidcDiscoveryUrl = providers.gradleProperty("opendrsai.oidc.discoveryUrl")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_OIDC_DISCOVERY_URL"))
    .getOrElse("$oidcIssuer/.well-known/openid-configuration")
    .trimEnd('/')
val developmentOidcIssuer = providers.gradleProperty("opendrsai.oidc.developmentIssuer")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_DEVELOPMENT_OIDC_ISSUER"))
    .getOrElse("$developmentHaiBaseUrl/api")
val developmentOidcDiscoveryUrl = providers.gradleProperty("opendrsai.oidc.developmentDiscoveryUrl")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_DEVELOPMENT_OIDC_DISCOVERY_URL"))
    .getOrElse("$developmentOidcIssuer/.well-known/openid-configuration")
    .trimEnd('/')
val androidUpdateManifestUrlOverride = providers.gradleProperty("opendrsai.android.updateManifestUrl")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_UPDATE_MANIFEST_URL"))
    .orNull
val androidUpdateFallbackManifestUrlOverride = providers.gradleProperty("opendrsai.android.updateFallbackManifestUrl")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_UPDATE_FALLBACK_MANIFEST_URL"))
    .orNull
val androidUpdateChannelOverride = providers.gradleProperty("opendrsai.android.updateChannel")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_UPDATE_CHANNEL"))
    .orNull
val androidUpdateAllowInsecureLocal = providers.gradleProperty("opendrsai.android.updateAllowInsecureLocal")
    .map(String::toBooleanStrict)
    .getOrElse(false)
val stableUpdateManifestUrl = "https://download-opendrsai.ihep.ac.cn/channels/stable/latest-android.json"
val stableUpdateFallbackManifestUrl = "https://github.com/hepai-lab/drsai/releases/latest/download/latest-android.json"
val betaUpdateManifestUrl = "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-android.json"
val betaUpdateFallbackManifestUrl = "https://github.com/hepai-lab/drsai/releases/download/android-beta/latest-android.json"
val devUpdateManifestUrl = androidUpdateManifestUrlOverride
    ?: "https://download-opendrsai.ihep.ac.cn/channels/dev/latest-android.json"
val devUpdateFallbackManifestUrl = androidUpdateFallbackManifestUrlOverride
    ?: "https://github.com/hepai-lab/drsai/releases/download/android-dev/latest-android.json"
val betaKeystorePath = providers.gradleProperty("opendrsai.android.beta.keystore")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_BETA_KEYSTORE"))
    .orNull
val betaKeystorePassword = providers.gradleProperty("opendrsai.android.beta.storePassword")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_BETA_STORE_PASSWORD"))
    .orNull
val betaKeyAlias = providers.gradleProperty("opendrsai.android.beta.keyAlias")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_BETA_KEY_ALIAS"))
    .orNull
val betaKeyPassword = providers.gradleProperty("opendrsai.android.beta.keyPassword")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_BETA_KEY_PASSWORD"))
    .orNull
val releaseKeystorePath = providers.gradleProperty("opendrsai.android.release.keystore")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_RELEASE_KEYSTORE"))
    .orNull
val releaseKeystorePassword = providers.gradleProperty("opendrsai.android.release.storePassword")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_RELEASE_STORE_PASSWORD"))
    .orNull
val releaseKeyAlias = providers.gradleProperty("opendrsai.android.release.keyAlias")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_RELEASE_KEY_ALIAS"))
    .orNull
val releaseKeyPassword = providers.gradleProperty("opendrsai.android.release.keyPassword")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_RELEASE_KEY_PASSWORD"))
    .orNull
fun String.asBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

plugins {
    id("com.android.application")
    id("com.chaquo.python")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.kapt")
}

chaquopy {
    defaultConfig {
        version = "3.11"
        buildPython(androidBuildPython)
    }
    sourceSets {
        getByName("main") {
            srcDir(rootProject.file("../../cores/python/packages/drsai/src/drsai/backend/runtime"))
        }
    }
}

android {
    namespace = "ai.drsai.remote"
    sourceSets.getByName("test").resources.srcDir(
        rootProject.file("../../cores/protocol/android-runtime/fixtures")
    )
    compileSdk = 35
    testBuildType = providers.gradleProperty("opendrsai.android.testBuildType").getOrElse("debug")

    defaultConfig {
        applicationId = "ai.drsai.remote"
        minSdk = 26
        targetSdk = 35
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        testProguardFiles("proguard-android-test.pro")
        versionCode = systemVersionCode
        versionName = systemVersion
        buildConfigField("String", "HAI_BASE_URL", haiBaseUrl.asBuildConfigString())
        buildConfigField("String", "OIDC_ISSUER", oidcIssuer.asBuildConfigString())
        buildConfigField("String", "OIDC_DISCOVERY_URL", oidcDiscoveryUrl.asBuildConfigString())
        buildConfigField("String", "MODEL_BASE_URL", "$haiBaseUrl/apiv2/v1".asBuildConfigString())
        buildConfigField("String", "RELAY_BASE_URL", "$haiBaseUrl/api/runtime-relay".asBuildConfigString())
        buildConfigField("String", "OIDC_CLIENT_ID", androidOidcClientId.asBuildConfigString())
        buildConfigField("String", "OIDC_REDIRECT_URI", androidOidcRedirectUri.asBuildConfigString())
        buildConfigField("String", "ANDROID_UPDATE_MANIFEST_URL", stableUpdateManifestUrl.asBuildConfigString())
        buildConfigField("String", "ANDROID_UPDATE_FALLBACK_MANIFEST_URL", stableUpdateFallbackManifestUrl.asBuildConfigString())
        buildConfigField("String", "ANDROID_UPDATE_CHANNEL", "stable".asBuildConfigString())
        buildConfigField("boolean", "ANDROID_UPDATE_ALLOW_INSECURE_LOCAL", "false")
        buildConfigField("boolean", "PYTHON_LOCAL_RUNTIME_ENABLED", "false")
        buildConfigField("String", "RUNTIME_POLICY_URL", "$haiBaseUrl/api/runtime-policy/android".asBuildConfigString())
        buildConfigField("String", "RUNTIME_POLICY_PUBLIC_KEY", runtimePolicyPublicKey.asBuildConfigString())
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        manifestPlaceholders["appLabel"] = "OpenDrSai"
    }

    signingConfigs {
        if (listOf(
                betaKeystorePath,
                betaKeystorePassword,
                betaKeyAlias,
                betaKeyPassword,
            ).all { !it.isNullOrBlank() }
        ) {
            create("beta") {
                storeFile = file(betaKeystorePath!!)
                storePassword = betaKeystorePassword!!
                keyAlias = betaKeyAlias!!
                keyPassword = betaKeyPassword!!
            }
        }
        if (listOf(
                releaseKeystorePath,
                releaseKeystorePassword,
                releaseKeyAlias,
                releaseKeyPassword,
            ).all { !it.isNullOrBlank() }
        ) {
            create("production") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword!!
                keyAlias = releaseKeyAlias!!
                keyPassword = releaseKeyPassword!!
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["appLabel"] = "OpenDrSai.Debug"
            buildConfigField("String", "HAI_BASE_URL", developmentHaiBaseUrl.asBuildConfigString())
            buildConfigField("String", "OIDC_ISSUER", developmentOidcIssuer.asBuildConfigString())
            buildConfigField("String", "OIDC_DISCOVERY_URL", developmentOidcDiscoveryUrl.asBuildConfigString())
            buildConfigField("String", "MODEL_BASE_URL", "$developmentHaiBaseUrl/apiv2/v1".asBuildConfigString())
            buildConfigField("String", "RELAY_BASE_URL", "$developmentHaiBaseUrl/api/runtime-relay".asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_MANIFEST_URL", devUpdateManifestUrl.asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_FALLBACK_MANIFEST_URL", devUpdateFallbackManifestUrl.asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_CHANNEL", (androidUpdateChannelOverride ?: "dev").asBuildConfigString())
            buildConfigField("boolean", "ANDROID_UPDATE_ALLOW_INSECURE_LOCAL", androidUpdateAllowInsecureLocal.toString())
            buildConfigField("boolean", "PYTHON_LOCAL_RUNTIME_ENABLED", pythonRuntimeEnabled.toString())
            buildConfigField("String", "RUNTIME_POLICY_URL", "$developmentHaiBaseUrl/api/runtime-policy/android".asBuildConfigString())
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            signingConfig = signingConfigs.findByName("production")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        create("mvp") {
            initWith(getByName("release"))
            buildConfigField("String", "HAI_BASE_URL", developmentHaiBaseUrl.asBuildConfigString())
            buildConfigField("String", "OIDC_ISSUER", developmentOidcIssuer.asBuildConfigString())
            buildConfigField("String", "OIDC_DISCOVERY_URL", developmentOidcDiscoveryUrl.asBuildConfigString())
            buildConfigField("String", "MODEL_BASE_URL", "$developmentHaiBaseUrl/apiv2/v1".asBuildConfigString())
            buildConfigField("String", "RELAY_BASE_URL", "$developmentHaiBaseUrl/api/runtime-relay".asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_MANIFEST_URL", betaUpdateManifestUrl.asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_FALLBACK_MANIFEST_URL", betaUpdateFallbackManifestUrl.asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_CHANNEL", "beta".asBuildConfigString())
            buildConfigField("boolean", "ANDROID_UPDATE_ALLOW_INSECURE_LOCAL", "false")
            // Installable internal-test artifact. Replace with the organization
            // release keystore before public distribution.
            signingConfig = signingConfigs.findByName("beta")
                ?: signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
        }
        create("acceptance") {
            initWith(getByName("release"))
            isDebuggable = true
            applicationIdSuffix = ".acceptance"
            buildConfigField("String", "HAI_BASE_URL", developmentHaiBaseUrl.asBuildConfigString())
            buildConfigField("String", "OIDC_ISSUER", developmentOidcIssuer.asBuildConfigString())
            buildConfigField("String", "OIDC_DISCOVERY_URL", developmentOidcDiscoveryUrl.asBuildConfigString())
            buildConfigField("String", "MODEL_BASE_URL", "$developmentHaiBaseUrl/apiv2/v1".asBuildConfigString())
            buildConfigField("String", "RELAY_BASE_URL", "$developmentHaiBaseUrl/api/runtime-relay".asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_MANIFEST_URL", devUpdateManifestUrl.asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_FALLBACK_MANIFEST_URL", devUpdateFallbackManifestUrl.asBuildConfigString())
            buildConfigField("String", "ANDROID_UPDATE_CHANNEL", (androidUpdateChannelOverride ?: "dev").asBuildConfigString())
            buildConfigField("boolean", "ANDROID_UPDATE_ALLOW_INSECURE_LOCAL", androidUpdateAllowInsecureLocal.toString())
            buildConfigField("boolean", "PYTHON_LOCAL_RUNTIME_ENABLED", "true")
            buildConfigField("String", "RUNTIME_POLICY_URL", "$developmentHaiBaseUrl/api/runtime-policy/android".asBuildConfigString())
            isMinifyEnabled = false
            isShrinkResources = false
            isDebuggable = true
            signingConfig = signingConfigs.getByName("debug")
            // Test-only old-version builds may use an emulator-hosted update feed.
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            matchingFallbacks += listOf("release")
        }
    }

    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    // lifecycle 2.8's detector is binary-incompatible with this Kotlin 2.x UAST.
    // Other lint checks remain enabled.
    lint { disable += "NullSafeMutableLiveData" }
}

androidComponents {
    onVariants(selector().all()) { variant ->
        // Chaquopy resolves its native runtimes from defaultConfig, so keep x86_64
        // available for emulator acceptance builds and remove it only from
        // production-derived artifacts at packaging time.
        if (variant.buildType == "release" || variant.buildType == "mvp") {
            variant.packaging.jniLibs.excludes.add("**/x86_64/*.so")
        }
        val variantVersion = if (variant.buildType == "acceptance") acceptanceVersion ?: systemVersion else systemVersion
        variant.outputs.forEach { output ->
            (output as VariantOutputImpl).apply {
                versionName.set(variantVersion)
                versionCode.set(versionCodeFor(variantVersion))
                outputFileName.set("OpenDrSai-Android-v$variantVersion.apk")
            }
        }
    }
}

val owopSchemaFile = rootProject.file("../../cores/protocol/owop/owop.schema.json")
val generatedOwopFile = file(
    "src/main/java/ai/drsai/remote/remote/generated/OwopSchemaGenerated.kt"
)
val relaySchemaFile = rootProject.file("../../cores/protocol/relay/runtime-relay.schema.json")
val generatedRelayFile = file(
    "src/main/java/ai/drsai/remote/remote/generated/RelayContractGenerated.kt"
)

fun renderAndroidOwopBindings(): String {
    @Suppress("UNCHECKED_CAST")
    val schema = JsonSlurper().parse(owopSchemaFile) as Map<String, Any?>
    val version = schema["version"] as String
    val operations = (schema["x-owop-operations"] as Map<*, *>).keys.map(Any?::toString).sorted()
    val bindings = (schema["x-owop-bindings"] as List<*>).map(Any?::toString).sorted()
    fun quoted(values: List<String>) = values.joinToString(",\n") { "        \"$it\"" }
    return """
        // Generated from cores/protocol/owop/owop.schema.json. Do not edit.
        package ai.drsai.remote.remote.generated

        object OwopSchemaGenerated {
            const val VERSION: String = "$version"
            val OPERATIONS: Set<String> = setOf(
        ${quoted(operations)}
            )
            val BINDINGS: Set<String> = setOf(
        ${quoted(bindings)}
            )
        }
    """.trimIndent() + "\n"
}

tasks.register("generateAndroidOwopBindings") {
    inputs.file(owopSchemaFile)
    outputs.file(generatedOwopFile)
    doLast {
        generatedOwopFile.parentFile.mkdirs()
        generatedOwopFile.writeText(renderAndroidOwopBindings())
    }
}

tasks.register("verifyAndroidOwopBindings") {
    mustRunAfter("generateAndroidOwopBindings")
    inputs.file(owopSchemaFile)
    inputs.file(generatedOwopFile)
    doLast {
        check(generatedOwopFile.exists()) {
            "Missing generated Android OWOP bindings. Run generateAndroidOwopBindings."
        }
        check(generatedOwopFile.readText().replace("\r\n", "\n") == renderAndroidOwopBindings().replace("\r\n", "\n")) {
            "Android OWOP bindings drifted from cores/protocol/owop/owop.schema.json. Run generateAndroidOwopBindings."
        }
    }
}

fun renderAndroidRelayBindings(): String {
    @Suppress("UNCHECKED_CAST")
    val schema = JsonSlurper().parse(relaySchemaFile) as Map<String, Any?>
    val endpoints = (schema["x-relay-endpoints"] as Map<*, *>)
        .mapKeys { it.key.toString() }.mapValues { it.value.toString() }.toSortedMap()
    val capabilities = (schema["x-relay-capabilities"] as List<*>).map(Any?::toString).sorted()
    val capabilityProfiles = (schema["x-relay-capability-profiles"] as Map<*, *>)
        .entries.associate { entry ->
            entry.key.toString() to (entry.value as List<*>).map(Any?::toString).sorted()
        }.toSortedMap()
    val minimumVersions = (schema["x-relay-minimum-versions"] as Map<*, *>)
        .entries.associate { entry ->
            entry.key.toString() to (entry.value as Map<*, *>)
                .entries.associate { it.key.toString() to it.value.toString() }.toSortedMap()
        }.toSortedMap()
    val sessionEventKinds = (schema["x-session-event-kinds"] as List<*>)
        .map(Any?::toString).sorted()
    val endpointLines = endpoints.entries.joinToString(",\n") { "        \"${it.key}\" to \"${it.value}\"" }
    val capabilityLines = capabilities.joinToString(",\n") { "        \"$it\"" }
    val profileLines = capabilityProfiles.entries.joinToString(",\n") { (profile, values) ->
        "        \"$profile\" to setOf(${values.joinToString(", ") { "\"$it\"" }})"
    }
    val minimumVersionLines = minimumVersions.entries.joinToString(",\n") { (profile, versions) ->
        "        \"$profile\" to mapOf(${versions.entries.joinToString(", ") { "\"${it.key}\" to \"${it.value}\"" }})"
    }
    val sessionEventKindLines = sessionEventKinds.joinToString(",\n") { "        \"$it\"" }
    return """// Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit.
package ai.drsai.remote.remote.generated

object RelayContractGenerated {
    const val SCHEMA_VERSION: String = "${schema["version"]}"
    const val PROTOCOL_VERSION: String = "${schema["protocol_version"]}"
    val ENDPOINTS: Map<String, String> = mapOf(
$endpointLines
    )
    val CAPABILITIES: Set<String> = setOf(
$capabilityLines
    )
    val CAPABILITY_PROFILES: Map<String, Set<String>> = mapOf(
$profileLines
    )
    val MINIMUM_VERSIONS: Map<String, Map<String, String>> = mapOf(
$minimumVersionLines
    )
    val SESSION_EVENT_KINDS: Set<String> = setOf(
$sessionEventKindLines
    )
}

data class GeneratedControlRequest(
    val requestId: String,
    val correlationId: String,
    val idempotencyKey: String? = null,
)

data class GeneratedErrorEnvelope(
    val code: String,
    val message: String,
    val correlationId: String,
    val retryable: Boolean,
    val details: Map<String, Any?>,
    val source: String,
)

data class GeneratedRelayEvent(
    val eventId: String,
    val sequence: Long,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val timestamp: String,
    val kind: String,
    val payload: Map<String, Any?>,
)

data class GeneratedSessionConversationItem(
    val itemId: String,
    val sessionId: String,
    val runId: String?,
    val kind: String,
    val role: String?,
    val revision: Long,
    val sessionSequence: Long,
    val sourceClient: String,
    val sourceMessageId: String?,
    val createdAt: String,
    val updatedAt: String,
    val payload: Map<String, Any?>,
)

data class GeneratedConversationSnapshot(
    val sessionId: String,
    val snapshotSequence: Long,
    val items: List<GeneratedSessionConversationItem>,
    val nextCursor: String?,
)

data class GeneratedSessionEvent(
    val eventId: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String?,
    val sessionSequence: Long,
    val kind: String,
    val timestamp: String,
    val payload: Map<String, Any?>,
    val itemId: String? = null,
    val itemRevision: Long? = null,
)

data class GeneratedRuntimeSessionEventFrame(
    val type: String = "event",
    val scope: String = "session",
    val sessionId: String,
    val sessionSequence: Long,
    val event: GeneratedSessionEvent,
)
"""
}

tasks.register("generateAndroidRelayBindings") {
    inputs.file(relaySchemaFile)
    outputs.file(generatedRelayFile)
    doLast {
        generatedRelayFile.parentFile.mkdirs()
        generatedRelayFile.writeText(renderAndroidRelayBindings())
    }
}

tasks.register("verifyAndroidRelayBindings") {
    mustRunAfter("generateAndroidRelayBindings")
    inputs.file(relaySchemaFile)
    inputs.file(generatedRelayFile)
    doLast {
        check(generatedRelayFile.exists()) {
            "Missing generated Android Relay bindings. Run generateAndroidRelayBindings."
        }
        check(generatedRelayFile.readText().replace("\r\n", "\n") == renderAndroidRelayBindings().replace("\r\n", "\n")) {
            "Android Relay bindings drifted from cores/protocol/relay/runtime-relay.schema.json."
        }
    }
}

tasks.named("preBuild").configure {
    dependsOn("verifyAndroidOwopBindings", "verifyAndroidRelayBindings")
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    add("acceptanceImplementation", "androidx.compose.ui:ui-test-manifest")
    implementation("androidx.navigation:navigation-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("net.i2p.crypto:eddsa:0.3.0")
    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    kapt("androidx.room:room-compiler:2.7.2")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.06.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
