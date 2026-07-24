#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="${ROOT}/.build/debug"
MODULE="OpenDrSaiNativeProtocol"
SDK="${OPENDRSAI_SWIFT_SDK:-/Library/Developer/CommandLineTools/SDKs/MacOSX11.3.sdk}"
CACHE="${ROOT}/.build/module-cache"
ARCH="$(uname -m)"
if [[ "${ARCH}" != "arm64" ]]; then
  echo "OpenDrSaiNativeHelper Debug builds require arm64; found ${ARCH}." >&2
  exit 2
fi
if [[ ! -d "${SDK}" ]]; then echo "Compatible macOS SDK is missing: ${SDK}" >&2; exit 3; fi
mkdir -p "${OUTPUT}" "${CACHE}"
/usr/bin/xcrun swiftc -sdk "${SDK}" -module-cache-path "${CACHE}" -Onone -target arm64-apple-macosx11.0 \
  -Xlinker -no_uuid \
  -emit-library -emit-module -module-name "${MODULE}" \
  -emit-module-path "${OUTPUT}/${MODULE}.swiftmodule" \
  "${ROOT}/Sources/${MODULE}/NativeProtocol.swift" "${ROOT}/Sources/${MODULE}/Keychain.swift" "${ROOT}/Sources/${MODULE}/SystemPermissions.swift" -framework Security -framework AVFoundation -framework ApplicationServices -framework CoreGraphics -framework AppKit \
  -o "${OUTPUT}/lib${MODULE}.dylib"
/usr/bin/xcrun swiftc -sdk "${SDK}" -module-cache-path "${CACHE}" -Onone -target arm64-apple-macosx11.0 \
  -Xlinker -no_uuid \
  -I "${OUTPUT}" -L "${OUTPUT}" -l"${MODULE}" \
  -Xlinker -rpath -Xlinker @executable_path \
  "${ROOT}/Sources/OpenDrSaiNativeHelper/main.swift" \
  -o "${OUTPUT}/OpenDrSaiNativeHelper"
/usr/bin/file "${OUTPUT}/OpenDrSaiNativeHelper"
