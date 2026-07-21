#!/bin/sh
set -eu

if [ -z "${OPENDRSAI_TEMPORARY_AUTHORIZED_KEY:-}" ]; then
  echo "OPENDRSAI_TEMPORARY_AUTHORIZED_KEY is required" >&2
  exit 64
fi

printf '%s\n' "$OPENDRSAI_TEMPORARY_AUTHORIZED_KEY" > /home/vscode/.ssh/authorized_keys
chown vscode:vscode /home/vscode/.ssh/authorized_keys
chmod 600 /home/vscode/.ssh/authorized_keys
ssh-keygen -A
exec /usr/sbin/sshd -D -e
