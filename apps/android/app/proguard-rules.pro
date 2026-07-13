# OpenDrSai uses org.json DTO parsing and does not require reflection keep rules.
# Tink references these compile-time-only annotations from security-crypto.
-dontwarn com.google.errorprone.annotations.**
