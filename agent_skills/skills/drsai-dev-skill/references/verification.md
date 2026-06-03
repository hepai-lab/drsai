# 服务验证流程

服务启动后，按以下步骤逐步验证服务是否真正可用。

## 验证后端（端口 4291）

### Step 1：确认端口已监听

```bash
ss -tlnp | grep 4291
```

预期输出中应有 `python` 或 `uvicorn` 进程。如果无输出，说明后端未启动。

### Step 2：验证 HTTP 响应

```bash
curl -s -o /dev/null -w "Backend HTTP status: %{http_code}\n" http://localhost:4291/
```

### Step 3：验证 API 端点

```bash
curl -s http://localhost:4291/api/health 2>/dev/null | python3 -m json.tool
```

### 判断标准

| 结果 | 状态 |
|------|------|
| HTTP 200，返回 JSON | ✅ 正常 |
| HTTP 200，返回 HTML（静态前端页面） | ✅ 正常（静态前端已内嵌） |
| `Connection refused` | ❌ 后端未启动 |
| HTTP 500 / 422 | ⚠️ 启动了但有配置错误，检查日志 |
| HTTP 401 / 403 | ⚠️ API Key 未配置或无效 |

## 验证前端开发服务器（端口 4290）

### Step 1：确认端口已监听

```bash
ss -tlnp | grep 4290
```

预期输出中应有 `node` 进程。

### Step 2：验证 HTTP 响应

```bash
curl -s -o /dev/null -w "Frontend HTTP status: %{http_code}\n" http://localhost:4290/
```

Gatsby 开发服务器首次启动编译需要 1-3 分钟，在此期间请等待后重试。

### 判断标准

| 结果 | 状态 |
|------|------|
| HTTP 200，包含 HTML | ✅ 正常 |
| `Connection refused` | ❌ 前端未启动或仍在编译中 |
| HTTP 404 | ⚠️ 路由配置问题 |

## 验证 pm2 管理的服务

```bash
pm2 list
pm2 logs drsai_backend --lines 50
pm2 logs drsai_frontend --lines 50
```

pm2 进程状态说明：

| 状态 | 含义 |
|------|------|
| `online` | ✅ 正在运行 |
| `stopped` | ❌ 已停止 |
| `errored` | ❌ 启动出错，查看日志 |
| `launching` | ⏳ 启动中 |

## 本地快速验证脚本

```bash
echo "=== 检查后端端口 4291 ==="
ss -tlnp | grep 4291 && echo "✅ 后端端口 4291 正在监听" || echo "❌ 后端端口 4291 未监听"

echo ""
echo "=== 检查前端端口 4290 ==="
ss -tlnp | grep 4290 && echo "✅ 前端端口 4290 正在监听" || echo "❌ 前端端口 4290 未监听"

echo ""
echo "=== 验证后端 HTTP ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://localhost:4291/ 2>/dev/null)
[ "$STATUS" = "200" ] && echo "✅ 后端响应正常 (HTTP $STATUS)" || echo "⚠️  后端响应异常 (HTTP $STATUS)"

echo ""
echo "=== 验证前端 HTTP ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://localhost:4290/ 2>/dev/null)
[ "$STATUS" = "200" ] && echo "✅ 前端响应正常 (HTTP $STATUS)" || echo "⚠️  前端响应异常 (HTTP $STATUS)"
```

## IP 与防火墙验证

包含本机 IP 获取、各网卡可达性测试、防火墙规则检查，见 [network.md](network.md)。
