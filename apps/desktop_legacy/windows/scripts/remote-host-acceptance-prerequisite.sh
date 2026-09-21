#!/bin/sh
set -eu

mode=${1:-}
run_token=${2:-}
public_key_base64=${3:-}

case "$run_token" in
  ''|*[!A-Za-z0-9-]*)
    echo "A safe acceptance run token is required." >&2
    exit 2
    ;;
esac

python_root="$HOME/.cache/opendrsai/acceptance-python-$run_token"
runtime_root="$HOME/.local/share/opendrsai/remote"
python_marker="$python_root/.opendrsai-external-acceptance-owner"
runtime_marker="$runtime_root/.opendrsai-external-acceptance-owner"
authorized_keys="$HOME/.ssh/authorized_keys"
uv_version=0.11.29
uv_archive="https://releases.astral.sh/github/uv/releases/download/$uv_version/uv-x86_64-unknown-linux-gnu.tar.gz"

decode_public_key() {
  printf '%s' "$public_key_base64" | base64 -d
}

validate_public_key() {
  key=$(decode_public_key)
  case "$key" in
    'ssh-ed25519 '*" opendrsai-temporary-remote-3090-acceptance") ;;
    *)
      echo "The temporary acceptance public key has an invalid type or label." >&2
      exit 3
      ;;
  esac
}

install_public_key() {
  validate_public_key
  key=$(decode_public_key)
  umask 077
  mkdir -p "$HOME/.ssh"
  touch "$authorized_keys"
  if ! grep -qxF -- "$key" "$authorized_keys"; then
    printf '%s\n' "$key" >> "$authorized_keys"
  fi
  chmod 700 "$HOME/.ssh"
  chmod 600 "$authorized_keys"
}

remove_public_key() {
  [ -n "$public_key_base64" ] || return 0
  validate_public_key
  [ -f "$authorized_keys" ] || return 0
  key=$(decode_public_key)
  temporary="$authorized_keys.opendrsai.$run_token.$$"
  grep -vxF -- "$key" "$authorized_keys" > "$temporary" || true
  chmod 600 "$temporary"
  mv -f "$temporary" "$authorized_keys"
  if grep -qxF -- "$key" "$authorized_keys"; then
    echo "The temporary acceptance public key remains installed." >&2
    exit 4
  fi
}

remove_owned_roots() {
  if [ -e "$runtime_root" ]; then
    [ -f "$runtime_marker" ] && [ "$(cat "$runtime_marker")" = "$run_token" ] || {
      echo "Refusing to remove an unowned Runtime directory." >&2
      exit 5
    }
    if [ -f "$runtime_root/gateway.pid" ]; then
      pid=$(cat "$runtime_root/gateway.pid" 2>/dev/null || true)
      case "$pid" in
        ''|*[!0-9]*) ;;
        *)
          kill "$pid" 2>/dev/null || true
          count=0
          while kill -0 "$pid" 2>/dev/null && [ "$count" -lt 50 ]; do
            sleep .1
            count=$((count + 1))
          done
          kill -9 "$pid" 2>/dev/null || true
          ;;
      esac
    fi
    rm -rf -- "$runtime_root"
  fi
  if [ -e "$python_root" ]; then
    [ -f "$python_marker" ] && [ "$(cat "$python_marker")" = "$run_token" ] || {
      echo "Refusing to remove an unowned temporary Python directory." >&2
      exit 6
    }
    rm -rf -- "$python_root"
  fi
}

provision() {
  [ ! -e "$python_root" ] || { echo "Temporary Python directory already exists." >&2; exit 7; }
  [ ! -e "$runtime_root" ] || { echo "Runtime directory already exists; bootstrap cleanup cannot prove ownership." >&2; exit 8; }
  umask 077
  mkdir -p "$python_root" "$runtime_root"
  printf '%s\n' "$run_token" > "$python_marker"
  printf '%s\n' "$run_token" > "$runtime_marker"
  install_public_key

  curl --proto '=https' --tlsv1.2 -fLsS "$uv_archive" -o "$python_root/uv.tar.gz"
  curl --proto '=https' --tlsv1.2 -fLsS "$uv_archive.sha256" -o "$python_root/uv.tar.gz.sha256"
  expected=$(awk 'NR == 1 { print $1 }' "$python_root/uv.tar.gz.sha256")
  actual=$(sha256sum "$python_root/uv.tar.gz" | awk '{ print $1 }')
  [ -n "$expected" ] && [ "$actual" = "$expected" ] || { echo "uv archive SHA-256 verification failed." >&2; exit 9; }
  tar -xzf "$python_root/uv.tar.gz" -C "$python_root"
  uv="$python_root/uv-x86_64-unknown-linux-gnu/uv"
  [ -x "$uv" ] || { echo "The verified uv archive did not contain the expected executable." >&2; exit 10; }
  uv_version_output=$("$uv" --version)
  set -- $uv_version_output
  [ "${1:-}" = "uv" ] && [ "${2:-}" = "$uv_version" ] || { echo "The uv executable version is unexpected." >&2; exit 11; }

  UV_PYTHON_INSTALL_DIR="$python_root/python" UV_CACHE_DIR="$python_root/cache" "$uv" python install 3.11
  python=$(find "$python_root/python" \( -type f -o -type l \) -path '*/bin/python3' -perm -u+x | head -n 1)
  [ -n "$python" ] || { echo "uv did not install an executable Python 3." >&2; exit 12; }
  "$python" -c 'import sys; assert sys.version_info >= (3, 10)'
  ln -s "$python" "$python_root/python3"
  printf 'OPENDRSAI_PYTHON_PATH=%s\n' "$python_root/python3"
}

case "$mode" in
  provision)
    cleanup_on_failure() {
      status=$?
      trap - EXIT HUP INT TERM
      if [ "$status" -ne 0 ]; then
        remove_public_key || true
        remove_owned_roots || true
      fi
      exit "$status"
    }
    trap cleanup_on_failure EXIT HUP INT TERM
    provision
    trap - EXIT HUP INT TERM
    ;;
  cleanup)
    remove_public_key
    remove_owned_roots
    [ ! -e "$python_root" ] && [ ! -e "$runtime_root" ]
    printf 'REMOTE_TEMPORARY_RESOURCES_REMOVED\n'
    ;;
  *)
    echo "Usage: remote-host-acceptance-prerequisite.sh provision|cleanup RUN_TOKEN PUBLIC_KEY_BASE64" >&2
    exit 2
    ;;
esac
