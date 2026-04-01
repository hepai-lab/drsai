curl http://****:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ****" \
  -d '{
    "model": "openclaw",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'