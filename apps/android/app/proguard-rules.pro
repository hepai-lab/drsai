# OpenDrSai uses org.json DTO parsing and does not require reflection keep rules.
# Tink references these compile-time-only annotations from security-crypto.
-dontwarn com.google.errorprone.annotations.**

# eddsa 0.3.0 contains a JVM-only compatibility branch which accepts
# sun.security.x509.X509Key. Android call sites construct EdDSAPublicKey
# directly, so that branch is unreachable and the JDK-internal type is not
# required at runtime.
-dontwarn sun.security.x509.X509Key

# Release-like APKs are exercised by a separately packaged instrumentation
# APK. Android de-duplicates Kotlin stdlib into the target APK and loads the
# target first, so the runner needs the complete stdlib ABI (including top-level
# LazyKt helpers) before JUnit discovers a test. Application packages remain
# fully shrinkable; only the shared Kotlin runtime ABI is stable.
-keep class kotlin.** { *; }

# Gradle de-duplicates dependencies which are shared by the target and its
# instrumentation APK. AndroidJUnitRunner calls this class during onCreate,
# before a test body can keep it reachable from the target's R8 graph.
-keep class androidx.tracing.** { *; }
