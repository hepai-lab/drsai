#!/usr/bin/env bash
# Run the WebUI frontend in the foreground. Press Ctrl+C to stop it.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd -- "${SCRIPT_DIR}/../frontend" && pwd)"

export GATSBY_DEV_PORT="${DRSAI_FRONTEND_PORT:-4290}"

exec "${FRONTEND_DIR}/run_drsai_frontend.sh"
