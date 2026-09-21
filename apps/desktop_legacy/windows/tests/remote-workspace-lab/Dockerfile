FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-server git python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash opendrsai \
    && mkdir -p /run/sshd /home/opendrsai/.ssh /workspaces/alpha /workspaces/beta \
    && printf 'alpha workspace\n' > /workspaces/alpha/README.txt \
    && printf 'beta workspace\n' > /workspaces/beta/README.txt \
    && chown -R opendrsai:opendrsai /home/opendrsai /workspaces \
    && chmod 700 /home/opendrsai/.ssh \
    && printf '%s\n' \
       'PasswordAuthentication no' \
       'KbdInteractiveAuthentication no' \
       'PermitRootLogin no' \
       'AllowUsers opendrsai' \
       'AllowTcpForwarding yes' \
       'KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group14-sha256' \
       >> /etc/ssh/sshd_config

COPY entrypoint.sh /usr/local/bin/opendrsai-lab-entrypoint
RUN chmod 755 /usr/local/bin/opendrsai-lab-entrypoint

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/opendrsai-lab-entrypoint"]
