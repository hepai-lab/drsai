# OpenDrSai uses org.json DTO parsing and does not require reflection keep rules.
# Tink references these compile-time-only annotations from security-crypto.
-dontwarn com.google.errorprone.annotations.**

# eddsa 0.3.0 contains a JVM-only compatibility branch which accepts
# sun.security.x509.X509Key. Android call sites construct EdDSAPublicKey
# directly, so that branch is unreachable and the JDK-internal type is not
# required at runtime.
-dontwarn sun.security.x509.X509Key
