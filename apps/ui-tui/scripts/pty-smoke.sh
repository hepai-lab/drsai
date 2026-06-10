#!/usr/bin/env bash
# PTY-driven test: launches the Ink UI, sends a brief prompt, captures output.
#
# Uses script(1) to allocate a PTY so Ink renders in real "interactive" mode.
# Sends keystrokes through a fifo so we can drive the composer.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOGFILE="$(mktemp)"
trap 'rm -f "$LOGFILE"' EXIT

# Simulate: type "hi" + Enter, wait, then Ctrl+D to exit.
# Wrap pnpm dev in `script` so stdin is a PTY. The "feeder" pipes keystrokes.
INPUT="$(printf 'say hi in 3 words\r')"

# The trick: script -q -c "...cmd..." /dev/null reads from current stdin, which
# we feed via a heredoc. Use timeout so we don't hang if Ink wedges.
echo ">>> launching Ink UI under PTY (timeout 240s)..."
timeout 240 script -qfc "pnpm dev" /dev/null > "$LOGFILE" <<< "$INPUT" || true

echo ">>> first 100 lines of output:"
head -n 100 "$LOGFILE"
echo ">>> ..."
echo ">>> last 30 lines:"
tail -n 30 "$LOGFILE"

# Success signals (any one is enough)
if grep -q "DrSai" "$LOGFILE" && grep -q "assistant" "$LOGFILE"; then
  echo ">>> PASS: saw banner + assistant turn"
  exit 0
fi
echo ">>> FAIL: missing expected output"
exit 1
