# Compile-only annotations referenced by AndroidX Test; no runtime behavior.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.MustBeClosed

# A release-like AndroidTest APK is minified independently from its target.
# The runner reaches these classes before JUnit discovers an individual test.
-keep class androidx.test.** { *; }
-keep class androidx.tracing.** { *; }
