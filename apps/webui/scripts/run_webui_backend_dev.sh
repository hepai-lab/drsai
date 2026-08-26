#!/usr/bin/env bash
# Run the WebUI backend in the foreground. Press Ctrl+C to stop it.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEBUI_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${WEBUI_DIR}/../.." && pwd)"
VENV_DIR="${DRSAI_VENV_DIR:-${REPO_ROOT}/.venv}"

BACKEND_HOST="${DRSAI_BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${DRSAI_BACKEND_PORT:-4291}"
export OPENDRSAI_RELEASE_CHANNELS="${OPENDRSAI_RELEASE_CHANNELS:-beta,stable}"

if [[ ! -x "${VENV_DIR}/bin/drsai-ui" ]]; then
    echo "Error: drsai-ui is not installed in ${VENV_DIR}." >&2
    echo "Install the repository runtime dependencies before starting the backend." >&2
    exit 1
fi

if [[ -f "${WEBUI_DIR}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${WEBUI_DIR}/.env"
    set +a
else
    echo "Info: ${WEBUI_DIR}/.env was not found; using the current environment."
fi

cd "${WEBUI_DIR}"
exec "${VENV_DIR}/bin/drsai-ui" ui \
    --host "${BACKEND_HOST}" \
    --port "${BACKEND_PORT}" \
    --reload
