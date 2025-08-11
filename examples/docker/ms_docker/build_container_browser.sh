# docker build \
#     --no-cache \
#     --build-arg http_proxy=http://192.168.32.148:8118 \
#     --build-arg https_proxy=http://192.168.32.148:8118 \
#     -t magentic-ui-vnc-browser:latest ./magentic-ui-browser-docker


docker build \
    --no-cache \
    -t magentic-ui-vnc-browser:latest ./magentic-ui-browser-docker