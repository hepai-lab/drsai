FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-server git python3 python3-pip python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash vscode \
    && mkdir -p /run/sshd /home/vscode/.ssh /home/vscode/workspace /home/vscode/workspace-two \
    && chown -R vscode:vscode /home/vscode \
    && chmod 700 /home/vscode/.ssh

COPY cores/python/packages/drsai /opt/drsai
COPY cores/protocol /protocol
RUN python3 -m pip install --break-system-packages --no-cache-dir /opt/drsai

RUN su - vscode -c 'cd /home/vscode/workspace && git init -q && git config user.email demo@opendrsai.local && git config user.name OpenDrSai-Demo && printf "# OpenDrSai Remote Workspace Demo\n\nThis file lives inside the Linux container.\n" > README.md && printf "remote demo\n" > remote.txt && git add . && git commit -qm initial' \
    && su - vscode -c 'cd /home/vscode/workspace-two && git init -q && git config user.email demo@opendrsai.local && git config user.name OpenDrSai-Demo && printf "second workspace\n" > second.txt && git add . && git commit -qm initial'

RUN printf '%s\n' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PermitRootLogin no' \
    'AllowUsers vscode' \
    'AllowTcpForwarding yes' \
    >> /etc/ssh/sshd_config

COPY apps/desktop/windows/tests/remote-workspace-demo/entrypoint.sh /usr/local/bin/opendrsai-demo-entrypoint
RUN chmod 755 /usr/local/bin/opendrsai-demo-entrypoint

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/opendrsai-demo-entrypoint"]
