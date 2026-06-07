#!/bin/bash
set -euo pipefail

BRIDGE=/aifs/user/home/zdzhang/VSProjects/drsai/examples/requests/zulip_python/for_claude_code/bridge_latest.py
LOG_DIR=/aifs/user/home/zdzhang/.claude/logs
LOG_FILE="$LOG_DIR/zulip_cc_bridge.log"
PID_FILE=/tmp/zulip_cc_bridge.pid
RESTART_DELAY=5   # seconds between restarts
MAX_RESTARTS=10   # max consecutive fast restarts before giving up
FAST_EXIT_THRESHOLD=10  # seconds; exit faster than this counts as "fast"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Prevent duplicate instances
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        log "ERROR: bridge already running (pid $OLD_PID). Exiting."
        exit 1
    else
        log "WARN: stale pid file found (pid $OLD_PID), removing."
        rm -f "$PID_FILE"
    fi
fi

# Dependency checks
if ! command -v python3 &>/dev/null; then
    log "ERROR: python3 not found in PATH."
    exit 1
fi

if [ ! -f "$BRIDGE" ]; then
    log "ERROR: bridge script not found: $BRIDGE"
    exit 1
fi

if ! python3 -c "import zulip" 2>/dev/null; then
    log "ERROR: Python package 'zulip' is not installed. Run: pip install zulip"
    exit 1
fi

echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"; log "Bridge stopped."' EXIT

log "Starting zulip_cc_bridge (pid $$)..."

consecutive_fast=0

while true; do
    start_ts=$(date +%s)

    python3 "$BRIDGE" >> "$LOG_FILE" 2>&1
    exit_code=$?

    end_ts=$(date +%s)
    elapsed=$(( end_ts - start_ts ))

    if [ $exit_code -eq 0 ]; then
        log "Bridge exited cleanly (code 0). Not restarting."
        break
    fi

    log "Bridge exited with code $exit_code after ${elapsed}s."

    if [ "$elapsed" -lt "$FAST_EXIT_THRESHOLD" ]; then
        consecutive_fast=$(( consecutive_fast + 1 ))
        log "WARN: fast exit #${consecutive_fast}/${MAX_RESTARTS}."
        if [ "$consecutive_fast" -ge "$MAX_RESTARTS" ]; then
            log "ERROR: too many fast exits. Giving up. Check $LOG_FILE for details."
            exit 1
        fi
    else
        consecutive_fast=0
    fi

    log "Restarting in ${RESTART_DELAY}s..."
    sleep "$RESTART_DELAY"
done
