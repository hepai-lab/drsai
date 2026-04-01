

切记需要在`~/.openclaw/gateway/openclaw.json`设置chatCompletions为true：

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```