#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../../.." && pwd)"
OUTPUT="$APP_ROOT/resources/runtime"
STAGING="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/opendrsai-runtime-arm64"
VERSION="$(node -p "require('$APP_ROOT/package.json').version")"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Runtime artifact must be built on Apple Silicon macOS." >&2
  exit 1
fi

rm -rf "$STAGING"
mkdir -p "$STAGING/drsai-agent" "$OUTPUT"
python3 -m venv "$STAGING/drsai-agent/venv"
"$STAGING/drsai-agent/venv/bin/python" -m pip install --disable-pip-version-check --no-input --upgrade pip
"$STAGING/drsai-agent/venv/bin/python" -m pip install --disable-pip-version-check --no-input "$REPO_ROOT/cores/python/packages/drsai"
"$STAGING/drsai-agent/venv/bin/python" -c "import drsai; print(drsai.__file__)"

cat > "$STAGING/drsai-agent/drsai" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec "$ROOT/venv/bin/python" -m drsai.backend.gateway "$@"
EOF
chmod 0755 "$STAGING/drsai-agent/drsai"

ARCHIVE="opendrsai-runtime-macos-arm64-${VERSION}.tar.gz"
tar -C "$STAGING" -czf "$OUTPUT/$ARCHIVE" drsai-agent
SHA256="$(shasum -a 256 "$OUTPUT/$ARCHIVE" | awk '{print $1}')"
node -e 'const fs=require("fs"); const [path,archive,sha,version]=process.argv.slice(1); fs.writeFileSync(path, JSON.stringify({schemaVersion:1,platform:"darwin",arch:"arm64",version,archive,sha256:sha,root:"drsai-agent",python:"venv/bin/python",launcher:"drsai"},null,2)+"\n")' "$OUTPUT/runtime-manifest.json" "$ARCHIVE" "$SHA256" "$VERSION"
echo "Built $OUTPUT/$ARCHIVE ($SHA256)"
