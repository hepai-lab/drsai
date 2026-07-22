#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../../.." && pwd)"
OUTPUT="$APP_ROOT/resources/runtime"
STAGING="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/opendrsai-runtime-arm64"
VERSION="$(node -p "require('$APP_ROOT/package.json').version")"
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$REPO_ROOT" log -1 --format=%ct)}"
LOCK_FILE="$APP_ROOT/resources/runtime/runtime-requirements.lock"
BROWSER_LOCK_FILE="$APP_ROOT/resources/runtime/browser-requirements.lock"
EXPECTED_PYTHON="3.11.9"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Runtime artifact must be built on Apple Silicon macOS." >&2
  exit 1
fi
if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
  echo "SOURCE_DATE_EPOCH or Git history is required for a reproducible artifact." >&2
  exit 1
fi
if [[ ! -f "$LOCK_FILE" || ! -f "$BROWSER_LOCK_FILE" ]]; then
  echo "Missing reviewed Runtime dependency lock: $LOCK_FILE or $BROWSER_LOCK_FILE" >&2
  exit 1
fi

rm -rf "$STAGING"
mkdir -p "$STAGING/drsai-agent" "$OUTPUT"
python3 -m venv "$STAGING/drsai-agent/venv"
PYTHON="$STAGING/drsai-agent/venv/bin/python"
PYTHON_VERSION="$("$PYTHON" -c 'import platform; print(platform.python_version())')"
if [[ "$PYTHON_VERSION" != "$EXPECTED_PYTHON" ]]; then
  echo "Runtime requires Python $EXPECTED_PYTHON, got $PYTHON_VERSION." >&2
  exit 1
fi
"$PYTHON" -m pip install --disable-pip-version-check --no-input --require-hashes -r "$LOCK_FILE"
"$PYTHON" -m pip install --disable-pip-version-check --no-input --no-deps "$REPO_ROOT/cores/python/packages/drsai"
"$PYTHON" -c "import drsai; print(drsai.__file__)"

python3 -m venv "$STAGING/drsai-agent/browser-venv"
BROWSER_PYTHON="$STAGING/drsai-agent/browser-venv/bin/python"
"$BROWSER_PYTHON" -m pip install --disable-pip-version-check --no-input --require-hashes -r "$BROWSER_LOCK_FILE"
PLAYWRIGHT_BROWSERS_PATH="$STAGING/drsai-agent/browser-browsers" "$BROWSER_PYTHON" -m playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$STAGING/drsai-agent/browser-browsers" "$BROWSER_PYTHON" -c "from browser_use import Agent, ChatBrowserUse; from playwright.async_api import async_playwright; print(Agent, ChatBrowserUse, async_playwright)"
if [[ ! -d "$STAGING/drsai-agent/browser-browsers" ]]; then
  echo "Playwright Chromium was not installed into the Runtime artifact." >&2
  exit 1
fi

cat > "$STAGING/drsai-agent/drsai" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/venv/bin/python" -m drsai.backend.gateway "$@"
EOF
chmod 0755 "$STAGING/drsai-agent/drsai"

SBOM="runtime-sbom-${VERSION}.json"
PROVENANCE="runtime-provenance-${VERSION}.json"
"$PYTHON" -m pip inspect > "$OUTPUT/$SBOM"
GIT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
LOCK_SHA256="$(shasum -a 256 "$LOCK_FILE" | awk '{print $1}')"
BROWSER_LOCK_SHA256="$(shasum -a 256 "$BROWSER_LOCK_FILE" | awk '{print $1}')"
node -e 'const fs=require("fs"); const [path,version,pythonVersion,commit,epoch,lockSha256,browserLockSha256]=process.argv.slice(1); fs.writeFileSync(path,JSON.stringify({schemaVersion:1,builder:"apps/desktop/macos/scripts/build-runtime-artifact.sh",version,pythonVersion,platform:"darwin",arch:"arm64",gitCommit:commit,sourceDateEpoch:Number(epoch),dependencyLock:"runtime-requirements.lock",dependencyLockSha256:lockSha256,browserDependencyLock:"browser-requirements.lock",browserDependencyLockSha256:browserLockSha256},null,2)+"\n")' "$OUTPUT/$PROVENANCE" "$VERSION" "$PYTHON_VERSION" "$GIT_COMMIT" "$SOURCE_DATE_EPOCH" "$LOCK_SHA256" "$BROWSER_LOCK_SHA256"

# Normalize mtimes and entry order; COPYFILE_DISABLE prevents macOS AppleDouble files.
find "$STAGING/drsai-agent" -exec touch -h -t "$(date -r "$SOURCE_DATE_EPOCH" +%Y%m%d%H%M.%S)" {} +
ARCHIVE="opendrsai-runtime-macos-arm64-${VERSION}.tar.gz"
(cd "$STAGING" && find drsai-agent -print | LC_ALL=C sort | COPYFILE_DISABLE=1 tar -cf - -T -) | gzip -n > "$OUTPUT/$ARCHIVE"
SHA256="$(shasum -a 256 "$OUTPUT/$ARCHIVE" | awk '{print $1}')"
ARCHIVE_SIZE="$(stat -f %z "$OUTPUT/$ARCHIVE")"

"$PYTHON" - "$STAGING/drsai-agent" "$OUTPUT/runtime-files.json" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
files = []
for path in sorted(item for item in root.rglob("*") if item.is_file() and not item.is_symlink()):
    files.append({"path": path.relative_to(root).as_posix(), "size": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
pathlib.Path(sys.argv[2]).write_text(json.dumps(files, separators=(",", ":")) + "\n")
PY
node -e 'const fs=require("fs"); const [path,filesPath,archive,archiveSize,sha,version,pythonVersion,sbom,provenance]=process.argv.slice(1); const files=JSON.parse(fs.readFileSync(filesPath,"utf8")); fs.writeFileSync(path,JSON.stringify({schemaVersion:2,platform:"darwin",arch:"arm64",version,pythonVersion,archive,archiveSize:Number(archiveSize),sha256:sha,root:"drsai-agent",python:"venv/bin/python",browserPython:"browser-venv/bin/python",browserPath:"browser-browsers",launcher:"drsai",sbom,provenance,files},null,2)+"\n")' "$OUTPUT/runtime-manifest.json" "$OUTPUT/runtime-files.json" "$ARCHIVE" "$ARCHIVE_SIZE" "$SHA256" "$VERSION" "$PYTHON_VERSION" "$SBOM" "$PROVENANCE"
rm "$OUTPUT/runtime-files.json"
echo "Built $OUTPUT/$ARCHIVE ($SHA256)"
