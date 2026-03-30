#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPDIR="$SCRIPT_DIR/tmp/drsai_ui"

mkdir -p "$APPDIR"

# Load .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# Write the env file that the app reads for configuration
# (mirrors what run_ui.py's ui() command writes before calling uvicorn)
ENV_FILE="$APPDIR/temp_env_vars.env"
cat > "$ENV_FILE" <<EOF
_HOST=0.0.0.0
_PORT=8081
_API_DOCS=True
_APPDIR=$APPDIR
DATABASE_URI=sqlite:////$APPDIR/drsai_ui.db
INSIDE_DOCKER=0
EXTERNAL_WORKSPACE_ROOT=$APPDIR
INTERNAL_WORKSPACE_ROOT=$APPDIR
EOF

# uvicorn --reload requires an import string, not an app object.
# Pass the env file explicitly via --env-file so the app gets its config.
exec uvicorn drsai_ui.ui_backend.backend.web.app:app \
    --reload \
    --env-file "$ENV_FILE" \
    --host 0.0.0.0 \
    --port 8081 \
    --reload-exclude "*/alembic/*" \
    --reload-exclude "*/alembic.ini" \
    --reload-exclude "*/versions/*"
