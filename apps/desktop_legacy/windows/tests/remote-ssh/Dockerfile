FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server python3 python3-venv python3-pip git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash vscode && mkdir -p /run/sshd /home/vscode/.ssh /home/vscode/workspace /home/vscode/workspace-two && chown -R vscode:vscode /home/vscode && chmod 700 /home/vscode/.ssh
RUN printf 'remote fixture\n' > /home/vscode/workspace/remote.txt && chown vscode:vscode /home/vscode/workspace/remote.txt
RUN printf 'second workspace\n' > /home/vscode/workspace-two/second.txt && chown vscode:vscode /home/vscode/workspace-two/second.txt
RUN mkdir -p /home/vscode/workspace/nested /home/vscode/restricted && chown -R vscode:vscode /home/vscode/workspace/nested && ln -s /home/vscode/workspace /home/vscode/workspace-link && chown -h vscode:vscode /home/vscode/workspace-link && chmod 000 /home/vscode/restricted
COPY authorized_keys /home/vscode/.ssh/authorized_keys
COPY fixture_drsai /home/vscode/fixture_drsai
COPY fixture_drsai /usr/local/lib/python3.11/dist-packages
RUN chown vscode:vscode /home/vscode/.ssh/authorized_keys && chmod 600 /home/vscode/.ssh/authorized_keys && printf '%s\n' 'PasswordAuthentication no' 'PermitRootLogin no' 'AllowUsers vscode' >> /etc/ssh/sshd_config
RUN chown -R vscode:vscode /home/vscode/fixture_drsai && printf '%s\n' 'export PYTHONPATH=/home/vscode/fixture_drsai' >> /home/vscode/.profile
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
