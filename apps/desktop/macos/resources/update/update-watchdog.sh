#!/bin/sh
set -eu

OLD_PID="$1"
CURRENT_APP="$2"
BACKUP_APP="$3"
HEALTH_FILE="$4"
EXPECTED_VERSION="$5"

while kill -0 "$OLD_PID" 2>/dev/null; do sleep 1; done

attempt=0
while [ "$attempt" -lt 180 ]; do
  if [ -f "$HEALTH_FILE" ] && grep -q "\"version\":\"$EXPECTED_VERSION\"" "$HEALTH_FILE"; then
    rm -rf "$BACKUP_APP"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ ! -d "$BACKUP_APP" ]; then exit 2; fi
FAILED_APP="${CURRENT_APP}.failed-update"
rm -rf "$FAILED_APP"
if [ -d "$CURRENT_APP" ]; then mv "$CURRENT_APP" "$FAILED_APP"; fi
if /usr/bin/ditto "$BACKUP_APP" "$CURRENT_APP"; then
  rm -rf "$FAILED_APP" "$BACKUP_APP"
  /usr/bin/open "$CURRENT_APP"
  exit 0
fi
if [ -d "$FAILED_APP" ] && [ ! -d "$CURRENT_APP" ]; then mv "$FAILED_APP" "$CURRENT_APP"; fi
exit 3
