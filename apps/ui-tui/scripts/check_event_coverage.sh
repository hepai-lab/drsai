#!/usr/bin/env bash
# check_event_coverage.sh — Verify frontend handles all backend-emitted events.
#
# Compares:
#   1. Backend _emit("event_name", ...) calls
#   2. Frontend case 'event_name': handlers in createGatewayEventHandler.ts
#
# Reports events that are emitted but not handled (potential silent data loss).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

BACKEND_DIR="$PROJECT_ROOT/cores/python/packages/drsai/src/drsai/backend/tui_gateway"
FRONTEND_FILE="$PROJECT_ROOT/apps/ui-tui/src/app/createGatewayEventHandler.ts"

# Extract backend events: all _emit("event.name", ...) calls
BACKEND_EVENTS=$(grep -roh '_emit("[a-z._]*"' "$BACKEND_DIR" 2>/dev/null | \
    sed 's/_emit("//;s/"//' | sort -u)

# Extract frontend events: all case 'event.name': handlers
FRONTEND_EVENTS=$(grep -oh "case '[a-z._]*'" "$FRONTEND_FILE" 2>/dev/null | \
    sed "s/case '//;s/'//" | sort -u)

echo "=== Event Coverage Check ==="
echo ""
echo "Backend events emitted: $(echo "$BACKEND_EVENTS" | wc -l)"
echo "Frontend events handled: $(echo "$FRONTEND_EVENTS" | wc -l)"
echo ""

# Find unhandled events
UNHANDLED=$(comm -23 \
    <(echo "$BACKEND_EVENTS") \
    <(echo "$FRONTEND_EVENTS"))

if [ -z "$UNHANDLED" ]; then
    echo "✅ All backend events are handled in the frontend."
else
    echo "⚠️  Backend events NOT handled in frontend:"
    echo "$UNHANDLED" | while read -r ev; do
        # Find where it's emitted
        LOC=$(grep -rn "_emit(\"$ev\"" "$BACKEND_DIR" 2>/dev/null | head -1 | cut -d: -f1-2)
        echo "  ❌ $ev  (emitted at: $LOC)"
    done
    echo ""
    echo "These events are emitted by the backend but silently dropped by the frontend."
    echo "Add case handlers in createGatewayEventHandler.ts to process them."
fi

# Find orphaned frontend handlers (handled but never emitted)
ORPHANED=$(comm -13 \
    <(echo "$BACKEND_EVENTS") \
    <(echo "$FRONTEND_EVENTS"))

if [ -n "$ORPHANED" ]; then
    echo ""
    echo "ℹ️  Frontend handlers with no backend emitter (may be future-proofing):"
    echo "$ORPHANED" | while read -r ev; do
        echo "  💡 $ev"
    done
fi
