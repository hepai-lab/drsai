# Windows → Android 扫码连接验收报告

- 生成时间：2026-07-21T20:39:11.425Z
- 结果：**54/54 通过**
- 模块：9
- 门禁：`npm --prefix apps/desktop run verify:android-pairing-release --workspace opendrsai-windows-desktop`

| 功能点 | 状态 | 自动化证据 |
|---|---|---|
| M01-F01 | 通过 | shared JSON fixtures；Python fixture parser；Android JVM fixture parser；contract generation drift checks |
| M01-F02 | 通过 | shared JSON fixtures；Python fixture parser；Android JVM fixture parser；contract generation drift checks |
| M01-F03 | 通过 | shared JSON fixtures；Python fixture parser；Android JVM fixture parser；contract generation drift checks |
| M01-F04 | 通过 | shared JSON fixtures；Python fixture parser；Android JVM fixture parser；contract generation drift checks |
| M01-F05 | 通过 | shared JSON fixtures；Python fixture parser；Android JVM fixture parser；contract generation drift checks |
| M01-F06 | 通过 | shared JSON fixtures；Python fixture parser；Android JVM fixture parser；contract generation drift checks |
| M02-F01 | 通过 | test_relay_registry.py；test_relay_api.py |
| M02-F02 | 通过 | test_relay_registry.py；test_relay_api.py |
| M02-F03 | 通过 | test_relay_registry.py；test_relay_api.py |
| M02-F04 | 通过 | test_relay_registry.py；test_relay_api.py |
| M02-F05 | 通过 | test_relay_registry.py；test_relay_api.py |
| M02-F06 | 通过 | test_relay_registry.py；test_relay_api.py |
| M03-F01 | 通过 | test_mobile_pairing.py；Full Runtime TestClient control API |
| M03-F02 | 通过 | test_mobile_pairing.py；Full Runtime TestClient control API |
| M03-F03 | 通过 | test_mobile_pairing.py；Full Runtime TestClient control API |
| M03-F04 | 通过 | test_mobile_pairing.py；Full Runtime TestClient control API |
| M03-F05 | 通过 | test_mobile_pairing.py；Full Runtime TestClient control API |
| M03-F06 | 通过 | test_mobile_pairing.py；Full Runtime TestClient control API |
| M04-F01 | 通过 | Desktop node/web typecheck；verify-mobile-pairing-controller |
| M04-F02 | 通过 | Desktop node/web typecheck；verify-mobile-pairing-controller |
| M04-F03 | 通过 | Desktop node/web typecheck；verify-mobile-pairing-controller |
| M04-F04 | 通过 | Desktop node/web typecheck；verify-mobile-pairing-controller |
| M04-F05 | 通过 | Desktop node/web typecheck；verify-mobile-pairing-controller |
| M04-F06 | 通过 | Desktop node/web typecheck；verify-mobile-pairing-controller |
| M05-F01 | 通过 | verify-mobile-pairing-ui；independent jsQR decode；Electron visual screenshot |
| M05-F02 | 通过 | verify-mobile-pairing-ui；independent jsQR decode；Electron visual screenshot |
| M05-F03 | 通过 | verify-mobile-pairing-ui；independent jsQR decode；Electron visual screenshot |
| M05-F04 | 通过 | verify-mobile-pairing-ui；independent jsQR decode；Electron visual screenshot |
| M05-F05 | 通过 | verify-mobile-pairing-ui；independent jsQR decode；Electron visual screenshot |
| M05-F06 | 通过 | verify-mobile-pairing-ui；independent jsQR decode；Electron visual screenshot |
| M06-F01 | 通过 | controller lifecycle verifier；visible-only polling source contract；Electron Escape interaction |
| M06-F02 | 通过 | controller lifecycle verifier；visible-only polling source contract；Electron Escape interaction |
| M06-F03 | 通过 | controller lifecycle verifier；visible-only polling source contract；Electron Escape interaction |
| M06-F04 | 通过 | controller lifecycle verifier；visible-only polling source contract；Electron Escape interaction |
| M06-F05 | 通过 | controller lifecycle verifier；visible-only polling source contract；Electron Escape interaction |
| M06-F06 | 通过 | controller lifecycle verifier；visible-only polling source contract；Electron Escape interaction |
| M07-F01 | 通过 | verify-mobile-pairing-security；Python fault matrix；npm audit --omit=dev |
| M07-F02 | 通过 | verify-mobile-pairing-security；Python fault matrix；npm audit --omit=dev |
| M07-F03 | 通过 | verify-mobile-pairing-security；Python fault matrix；npm audit --omit=dev |
| M07-F04 | 通过 | verify-mobile-pairing-security；Python fault matrix；npm audit --omit=dev |
| M07-F05 | 通过 | verify-mobile-pairing-security；Python fault matrix；npm audit --omit=dev |
| M07-F06 | 通过 | verify-mobile-pairing-security；Python fault matrix；npm audit --omit=dev |
| M08-F01 | 通过 | Android 170 JVM tests；API 30 68 instrumentation tests；API 35 68 instrumentation tests |
| M08-F02 | 通过 | Android 170 JVM tests；API 30 68 instrumentation tests；API 35 68 instrumentation tests |
| M08-F03 | 通过 | Android 170 JVM tests；API 30 68 instrumentation tests；API 35 68 instrumentation tests |
| M08-F04 | 通过 | Android 170 JVM tests；API 30 68 instrumentation tests；API 35 68 instrumentation tests |
| M08-F05 | 通过 | Android 170 JVM tests；API 30 68 instrumentation tests；API 35 68 instrumentation tests |
| M08-F06 | 通过 | Android 170 JVM tests；API 30 68 instrumentation tests；API 35 68 instrumentation tests |
| M09-F01 | 通过 | closed-loop Runtime payload association；single-command release gate |
| M09-F02 | 通过 | closed-loop Runtime payload association；single-command release gate |
| M09-F03 | 通过 | closed-loop Runtime payload association；single-command release gate |
| M09-F04 | 通过 | closed-loop Runtime payload association；single-command release gate |
| M09-F05 | 通过 | closed-loop Runtime payload association；single-command release gate |
| M09-F06 | 通过 | closed-loop Runtime payload association；single-command release gate |
