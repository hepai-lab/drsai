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
val versionParts = systemVersion.split(".").map { part ->
    part.takeWhile(Char::isDigit).toIntOrNull() ?: 0
}
val systemVersionCode = (versionParts.getOrElse(0) { 0 } * 10_000) +
    (versionParts.getOrElse(1) { 0 } * 100) +
    versionParts.getOrElse(2) { 0 }
val androidOidcClientId = providers.gradleProperty("opendrsai.oidc.clientId")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_OIDC_CLIENT_ID"))
    .getOrElse("opendrsai-android")
val androidOidcRedirectUri = providers.gradleProperty("opendrsai.oidc.redirectUri")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_OIDC_REDIRECT_URI"))
    .getOrElse("ai.drsai.remote:/oauth2redirect")
val haiBaseUrl = providers.gradleProperty("opendrsai.hai.baseUrl")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_HAI_BASE_URL"))
    .getOrElse("https://ai.ihep.ac.cn")
val oidcIssuer = providers.gradleProperty("opendrsai.oidc.issuer")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_OIDC_ISSUER"))
    .getOrElse("$haiBaseUrl/api")
val oidcDiscoveryUrl = providers.gradleProperty("opendrsai.oidc.discoveryUrl")
    .orElse(providers.environmentVariable("OPENDRSAI_ANDROID_OIDC_DISCOVERY_URL"))
    .getOrElse("$oidcIssuer/.well-known/openid-configuration")
    .trimEnd('/')
fun String.asBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.kapt")
}

android {
    namespace = "ai.drsai.remote"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.drsai.remote"
        minSdk = 26
        targetSdk = 35
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = systemVersionCode
        versionName = systemVersion
        buildConfigField("String", "HAI_BASE_URL", haiBaseUrl.asBuildConfigString())
        buildConfigField("String", "OIDC_ISSUER", oidcIssuer.asBuildConfigString())
        buildConfigField("String", "OIDC_DISCOVERY_URL", oidcDiscoveryUrl.asBuildConfigString())
        buildConfigField("String", "MODEL_BASE_URL", "$haiBaseUrl/apiv2/v1".asBuildConfigString())
        buildConfigField("String", "RELAY_BASE_URL", "$haiBaseUrl/api/runtime-relay".asBuildConfigString())
        buildConfigField("String", "OIDC_CLIENT_ID", androidOidcClientId.asBuildConfigString())
        buildConfigField("String", "OIDC_REDIRECT_URI", androidOidcRedirectUri.asBuildConfigString())
        manifestPlaceholders["usesCleartextTraffic"] = "false"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        create("mvp") {
            initWith(getByName("release"))
            // Installable internal-test artifact. Replace with the organization
            // release keystore before public distribution.
            signingConfig = signingConfigs.getByName("debug")
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
        variant.outputs.forEach { output ->
            (output as VariantOutputImpl).outputFileName.set("OpenDrSai-Android-v$systemVersion.apk")
        }
    }
}

val owopSchemaFile = rootProject.file("../../protocol/owop/owop.schema.json")
val generatedOwopFile = file(
    "src/main/java/ai/drsai/remote/remote/generated/OwopSchemaGenerated.kt"
)
val relaySchemaFile = rootProject.file("../../protocol/relay/runtime-relay.schema.json")
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
        // Generated from protocol/owop/owop.schema.json. Do not edit.
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
        check(generatedOwopFile.readText() == renderAndroidOwopBindings()) {
            "Android OWOP bindings drifted from protocol/owop/owop.schema.json. Run generateAndroidOwopBindings."
        }
    }
}

fun renderAndroidRelayBindings(): String {
    @Suppress("UNCHECKED_CAST")
    val schema = JsonSlurper().parse(relaySchemaFile) as Map<String, Any?>
    val endpoints = (schema["x-relay-endpoints"] as Map<*, *>)
        .mapKeys { it.key.toString() }.mapValues { it.value.toString() }.toSortedMap()
    val capabilities = (schema["x-relay-capabilities"] as List<*>).map(Any?::toString).sorted()
    val endpointLines = endpoints.entries.joinToString(",\n") { "        \"${it.key}\" to \"${it.value}\"" }
    val capabilityLines = capabilities.joinToString(",\n") { "        \"$it\"" }
    return """// Generated from protocol/relay/runtime-relay.schema.json. Do not edit.
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
        check(generatedRelayFile.readText() == renderAndroidRelayBindings()) {
            "Android Relay bindings drifted from protocol/relay/runtime-relay.schema.json."
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
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    implementation("androidx.navigation:navigation-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    kapt("androidx.room:room-compiler:2.7.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.06.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
