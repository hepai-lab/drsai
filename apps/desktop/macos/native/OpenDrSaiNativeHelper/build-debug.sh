#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="${ROOT}/.build/debug"
MODULE="OpenDrSaiNativeProtocol"
SDK="${OPENDRSAI_SWIFT_SDK:-$(/usr/bin/xcrun --sdk macosx --show-sdk-path)}"
SWIFTC="${OPENDRSAI_SWIFTC:-$(/usr/bin/xcrun --find swiftc)}"
CACHE="${ROOT}/.build/module-cache"
ARCH="$(uname -m)"
if [[ "${ARCH}" != "arm64" ]]; then
  echo "OpenDrSaiNativeHelper Debug builds require arm64; found ${ARCH}." >&2
  exit 2
fi
if [[ ! -d "${SDK}" ]]; then echo "Compatible macOS SDK is missing: ${SDK}" >&2; exit 3; fi
if [[ ! -x "${SWIFTC}" ]]; then echo "Swift compiler is missing: ${SWIFTC}" >&2; exit 4; fi
mkdir -p "${OUTPUT}" "${CACHE}"
"${SWIFTC}" -sdk "${SDK}" -module-cache-path "${CACHE}" -Onone -target arm64-apple-macosx11.0 \
  -Xlinker -no_uuid \
  -Xlinker -install_name -Xlinker "@rpath/lib${MODULE}.dylib" \
  -emit-library -emit-module -module-name "${MODULE}" \
  -emit-module-path "${OUTPUT}/${MODULE}.swiftmodule" \
  "${ROOT}/Sources/${MODULE}/NativeProtocol.swift" "${ROOT}/Sources/${MODULE}/Keychain.swift" "${ROOT}/Sources/${MODULE}/SystemPermissions.swift" -framework Security -framework AVFoundation -framework ApplicationServices -framework CoreGraphics -framework CoreServices -framework AppKit \
  -o "${OUTPUT}/lib${MODULE}.dylib"
"${SWIFTC}" -sdk "${SDK}" -module-cache-path "${CACHE}" -Onone -target arm64-apple-macosx11.0 \
  -Xlinker -no_uuid \
  -I "${OUTPUT}" -L "${OUTPUT}" -l"${MODULE}" \
  -Xlinker -rpath -Xlinker @executable_path \
  "${ROOT}/Sources/OpenDrSaiNativeHelper/main.swift" \
  -o "${OUTPUT}/OpenDrSaiNativeHelper"
/usr/bin/file "${OUTPUT}/OpenDrSaiNativeHelper"
