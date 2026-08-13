#!/usr/bin/env bash
# Load reviewed local macOS/OSS release credentials without printing values or
# modifying the user's global ossutil configuration, then execute one command.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 2
fi

KEY_DIR="${OPENDRSAI_MACOS_KEY_DIR:-$HOME/.keys/mac_developer}"
OSS_CSV="${OPENDRSAI_OSS_CREDENTIALS_CSV:-$HOME/.keys/aliyun_oss/AccessKey.csv}"
OSSUTIL="${OPENDRSAI_OSSUTIL_BIN:-$HOME/.local/bin/ossutil}"

required_files=(
  "$KEY_DIR/developerID_application.p12"
  "$KEY_DIR/MACOS_CSC_KEY_PASSWORD"
  "$KEY_DIR/AuthKey_77ZK2H4MK3.p8"
  "$KEY_DIR/APPLE_API_KEY_ID"
  "$KEY_DIR/Issuer_ID"
  "$OSS_CSV"
)
for path in "${required_files[@]}"; do
  [[ -f "$path" ]] || { echo "Missing release credential file: $path" >&2; exit 1; }
  mode="$(stat -f '%Lp' "$path")"
  [[ "$mode" == "600" ]] || { echo "Release credential must use mode 0600: $path (mode $mode)" >&2; exit 1; }
done
[[ -x "$OSSUTIL" ]] || { echo "ossutil is not executable: $OSSUTIL" >&2; exit 1; }

export MACOS_CSC_LINK="$KEY_DIR/developerID_application.p12"
export MACOS_CSC_KEY_PASSWORD="$(tr -d '\r\n' < "$KEY_DIR/MACOS_CSC_KEY_PASSWORD")"
export CSC_LINK="$MACOS_CSC_LINK"
export CSC_KEY_PASSWORD="$MACOS_CSC_KEY_PASSWORD"
export APPLE_API_KEY="$KEY_DIR/AuthKey_77ZK2H4MK3.p8"
export APPLE_API_KEY_ID="$(tr -d '\r\n' < "$KEY_DIR/APPLE_API_KEY_ID")"
export APPLE_API_ISSUER="$(tr -d '\r\n' < "$KEY_DIR/Issuer_ID")"
export OPENDRSAI_OSSUTIL_BIN="$OSSUTIL"
export OPENDRSAI_OSS_BUCKET="${OPENDRSAI_OSS_BUCKET:-hepai-release}"

oss_id="$(awk -F',' 'NR==2 {gsub(/^"|"$/, "", $1); print $1}' "$OSS_CSV")"
oss_secret="$(awk -F',' 'NR==2 {gsub(/^"|"$/, "", $2); gsub(/\r$/, "", $2); print $2}' "$OSS_CSV")"
[[ -n "$oss_id" && -n "$oss_secret" ]] || { echo "OSS credential CSV is incomplete." >&2; exit 1; }

oss_config="$(mktemp /private/tmp/opendrsai-ossutil.XXXXXX)"
chmod 600 "$oss_config"
cleanup() { rm -f -- "$oss_config"; }
trap cleanup EXIT INT TERM
"$OSSUTIL" config -e "${OPENDRSAI_OSS_ENDPOINT:-oss-cn-beijing.aliyuncs.com}" -i "$oss_id" -k "$oss_secret" -L EN -c "$oss_config" >/dev/null
unset oss_id oss_secret
export OPENDRSAI_OSSUTIL_CONFIG="$oss_config"

"$@"
