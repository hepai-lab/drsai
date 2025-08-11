docker run -it --rm \
  -p 6080:6080 \
  -p 37367:37367 \
  -p 52000:52000 \
  -p 53000:53000 \
  --name magentic-ui-browser-dev \
  --security-opt seccomp=unconfined \
  -e PLAYWRIGHT_WS_PATH=yccbbedfegjrdasjfet123r4 \
  -e PLAYWRIGHT_PORT=52000 \
  -e NO_VNC_PORT=53000 \
  magentic-ui-vnc-browser:latest \
  bash