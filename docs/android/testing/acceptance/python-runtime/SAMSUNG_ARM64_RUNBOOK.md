# Samsung arm64 final gate

Prerequisites: a physical Samsung arm64 device with USB debugging enabled, an unlocked screen, and authorization granted to this workstation. The collector rejects emulators, non-Samsung devices, non-arm64 devices, offline devices, and API levels below 26 before installing anything.

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$serial = "<adb-serial>"
.\.venv\Scripts\python.exe apps/android/scripts/collect-python-runtime-samsung-evidence.py `
  --adb $adb `
  --serial $serial `
  --app-apk apps/android/app/build/outputs/apk/acceptance/OpenDrSai-Android-v1.5.4.apk `
  --test-apk apps/android/app/build/outputs/apk/androidTest/acceptance/app-acceptance-androidTest.apk `
  --output docs/android/testing/acceptance/python-runtime/device-performance.json
```

After the collector passes, regenerate the feature matrix with `--physical-device-tests` set to the reported instrumentation count, then run `verify-python-runtime-acceptance.py`. Do not manually set `physical_samsung_arm64_verified`.

The collector executes the complete Acceptance instrumentation suite and records cold-start, PSS, CPU, storage, battery, temperature, thermal status, ANR, crashes, and runtime-process release. It writes evidence only after device identity is verified.
