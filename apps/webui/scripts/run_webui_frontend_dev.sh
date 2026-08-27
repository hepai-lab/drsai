#!/usr/bin/env bash
# Run the WebUI frontend development server in the foreground for PM2.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd -- "${SCRIPT_DIR}/../frontend" && pwd)"

export GATSBY_DEV_PORT="${DRSAI_FRONTEND_PORT:-4290}"
# Polling is more reliable through institutional/mobile proxies than forcing
# Gatsby's development HMR client to start with a WebSocket connection.
export GATSBY_SOCKET_IO_DEFAULT_TRANSPORT="${GATSBY_SOCKET_IO_DEFAULT_TRANSPORT:-polling}"

cd "${FRONTEND_DIR}"
exec yarn dev
