# IP 与端口可达性验证

DrSai 服务启动后，需要确认：
1. 本机有哪些网络接口/IP
2. 服务端口是否在监听
3. 运行环境类型（物理机 / Docker / K8s Pod）
4. 防火墙或网络策略是否放行对应端口

> ⚠️ **重要**：用 `curl http://<本机IP>:端口` 自测永远能通，**不代表外部机器能访问**。
> 必须区分运行环境后再判断实际的访问控制层级。

## 前端如何找到后端（DEV 自动推导）

DEV 模式下前端(4290)与后端(4291)分离。前端 `getServerUrl()`（`frontend/src/components/utils.ts`）
**不写死后端地址**，而是按优先级推导：

1. 若设了 `GATSBY_API_URL` → 用它（一般不需要，除非后端在另一台主机）
2. DEV 模式 → `http://${window.location.hostname}:${GATSBY_DEV_API_PORT||4291}/api`
   —— 即跟随**浏览器访问前端所用的 host** 自动指向同主机的后端
3. PROD → 相对路径 `/api`（后端同源托管）

含义：从哪个 IP/域名访问前端，API 就自动走哪个 IP 的 4291。**所以请用对外可达的独立 IP
（下文的 net1）访问前端**，不要用容器内网 eth0 的地址，也不要在 `.env.development` 硬编码
`GATSBY_API_URL`（会覆盖自动推导）。

## 环境检测（必须先做）

```bash
# 判断是否在容器中
ls /.dockerenv 2>/dev/null && echo "Docker 容器" || echo "非 Docker"
cat /proc/1/cgroup 2>/dev/null | head -3

# 查看网络接口（veth/eth0@if* 说明在容器/K8s 中）
ip addr show | grep -E "inet |^[0-9]"

# 查看路由
ip route show
```

### 环境判断与对应访问控制层

| 环境 | 特征 | 端口控制层 |
|------|------|-----------|
| 物理机 | 无 `/.dockerenv`，网卡名 `ens3`/`eth0` 等 | 本机 firewalld / iptables / ufw |
| Docker 容器 | 有 `/.dockerenv`，网卡 `eth0@ifXX` | 宿主机 `-p` 端口映射 |
| K8s Pod | 有 `/.dockerenv`，多网卡（Multus）| K8s Service / NodePort / Ingress |

> 本项目运行在 **K8s Pod** 中（`eth0@if97` + `/.dockerenv`），容器内无防火墙。
> 端口能否被外部访问，取决于：
> - `net1` 网卡 (10.5.8.104) 是否通过 Multus CNI 直接暴露给外部网络
> - 宿主节点是否有 NodePort / Ingress 将 4290/4291 映射出去

## 完整验证脚本

执行以下脚本，自动完成全部检查并输出报告：

```bash
#!/bin/bash
BACKEND_PORT=4291
FRONTEND_PORT=4290

echo "========================================"
echo "  DrSai 网络访问验证"
echo "========================================"

# Step 1: 获取本机所有非回环 IP，容器中识别独立 IP（Multus CNI 附加网卡）
echo ""
echo "【Step 1】本机网络接口 IP"
LOCALHOST="127.0.0.1"

# 识别独立 IP：接口名不是 eth0（容器主网卡），MTU=1500（非 overlay），且不是回环
# eth0 是 K8s 分配的 overlay 网卡（MTU 1450），net1 等是 Multus 附加的独立网卡（MTU 1500）
CONTAINER_IP=""   # eth0 的 IP，容器内部网络
EXTERNAL_IP=""    # 独立网卡的 IP，对外可访问

while IFS= read -r line; do
    if [[ "$line" =~ ^[0-9]+:\ ([^:@]+) ]]; then
        IFACE="${BASH_REMATCH[1]}"
        MTU=$(echo "$line" | grep -o "mtu [0-9]*" | awk '{print $2}')
    elif [[ "$line" =~ inet\ ([0-9.]+) ]]; then
        IP="${BASH_REMATCH[1]}"
        [[ "$IP" == "127.0.0.1" ]] && continue
        if [[ "$IFACE" == "eth0" ]]; then
            CONTAINER_IP="$IP"
            echo "  $IP  ($IFACE, 容器内部网络 MTU=$MTU)"
        else
            EXTERNAL_IP="$IP"
            echo "  $IP  ($IFACE, 独立网卡 MTU=$MTU ← 对外访问地址)"
        fi
    fi
done < <(ip addr show 2>/dev/null)

# 如果没检测到独立网卡，回退到所有非回环 IP
if [ -z "$EXTERNAL_IP" ]; then
    EXTERNAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

ALL_IPS="$LOCALHOST $CONTAINER_IP $EXTERNAL_IP"

# Step 2: 确认端口监听
echo ""
echo "【Step 2】端口监听状态"
ss -tlnp | grep ":${BACKEND_PORT} " > /dev/null 2>&1 \
    && echo "  ✅ 后端端口 ${BACKEND_PORT} 正在监听" \
    || echo "  ❌ 后端端口 ${BACKEND_PORT} 未监听 — 请先启动后端"

ss -tlnp | grep ":${FRONTEND_PORT} " > /dev/null 2>&1 \
    && echo "  ✅ 前端端口 ${FRONTEND_PORT} 正在监听" \
    || echo "  ❌ 前端端口 ${FRONTEND_PORT} 未监听 — 请先启动前端"

# Step 3: 从每个 IP 验证可达性
echo ""
echo "【Step 3】各 IP 端口可达性（模拟外部访问）"
for ip in $ALL_IPS; do
    for port in $BACKEND_PORT $FRONTEND_PORT; do
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://${ip}:${port}/" 2>/dev/null)
        if [ "$STATUS" = "200" ] || [ "$STATUS" = "301" ] || [ "$STATUS" = "302" ]; then
            echo "  ✅ http://${ip}:${port}/  →  HTTP $STATUS  可访问"
        elif [ -z "$STATUS" ] || [ "$STATUS" = "000" ]; then
            echo "  ❌ http://${ip}:${port}/  →  连接超时/拒绝 （端口未开放或防火墙拦截）"
        else
            echo "  ⚠️  http://${ip}:${port}/  →  HTTP $STATUS  （服务异常）"
        fi
    done
done

# Step 4: 环境与防火墙检测
echo ""
echo "【Step 4】运行环境与防火墙"
IN_CONTAINER=false
ls /.dockerenv &>/dev/null && IN_CONTAINER=true

if $IN_CONTAINER; then
    echo "  检测到容器环境（Docker / K8s Pod）"
    NIC_COUNT=$(ip addr show | grep "^[0-9]" | grep -v "lo:" | wc -l)
    if [ "$NIC_COUNT" -gt 1 ]; then
        echo "  检测到多网卡（可能使用 Multus CNI）："
        ip addr show | grep "inet " | grep -v "127.0.0.1" | grep -v "::1" | awk '{print "    "$2}' | cut -d'/' -f1
    fi
    # 容器内可能有 iptables，需要 sudo
    echo "  检查容器内 iptables（需 sudo）："
    if sudo -n iptables -L INPUT -n &>/dev/null; then
        POLICY=$(sudo -n iptables -L INPUT -n | head -1 | grep -o "policy [A-Z]*" | awk '{print $2}')
        echo "  INPUT 链默认策略: $POLICY"
        for port in $BACKEND_PORT $FRONTEND_PORT; do
            if sudo -n iptables -L INPUT -n | grep -q "dpt:${port}"; then
                echo "  ✅ iptables: 端口 ${port}/tcp 已放行"
            else
                if [ "$POLICY" = "DROP" ]; then
                    echo "  ❌ iptables: 端口 ${port}/tcp 未放行（INPUT policy DROP）"
                    echo "     修复: sudo iptables -I INPUT 1 -p tcp --dport ${port} -j ACCEPT"
                else
                    echo "  ✅ iptables: INPUT policy ACCEPT，端口 ${port} 默认放行"
                fi
            fi
        done
    else
        echo "  无法读取 iptables（sudo 不可用），请手动确认防火墙规则"
    fi
elif command -v firewall-cmd &>/dev/null && firewall-cmd --state 2>/dev/null | grep -q "running"; then
    echo "  检测到 firewalld 运行中"
    for port in $BACKEND_PORT $FRONTEND_PORT; do
        firewall-cmd --query-port=${port}/tcp 2>/dev/null | grep -q "yes" \
            && echo "  ✅ firewalld: 端口 ${port}/tcp 已放行" \
            || echo "  ❌ firewalld: 端口 ${port}/tcp 未放行 — 执行: sudo firewall-cmd --add-port=${port}/tcp --permanent && sudo firewall-cmd --reload"
    done
elif command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "active"; then
    echo "  检测到 ufw 运行中"
    for port in $BACKEND_PORT $FRONTEND_PORT; do
        ufw status 2>/dev/null | grep -q "${port}" \
            && echo "  ✅ ufw: 端口 ${port} 已放行" \
            || echo "  ❌ ufw: 端口 ${port} 未放行 — 执行: sudo ufw allow ${port}/tcp"
    done
elif command -v iptables &>/dev/null && cat /proc/net/ip_tables_names &>/dev/null; then
    echo "  检测到 iptables"
    for port in $BACKEND_PORT $FRONTEND_PORT; do
        iptables -C INPUT -p tcp --dport ${port} -j ACCEPT 2>/dev/null \
            && echo "  ✅ iptables: 端口 ${port} 已放行" \
            || echo "  ⚠️  iptables: 未找到明确放行规则（可能依赖默认 ACCEPT 策略）"
    done
else
    echo "  物理机环境，未检测到活跃防火墙（firewalld/ufw/iptables）"
    echo "  → 端口应直接可访问，以 Step 3 连通性为准"
fi

echo ""
echo "========================================"
echo "  访问地址汇总"
echo "========================================"
if [ -n "$EXTERNAL_IP" ]; then
    echo "  ★ 推荐外部访问地址（独立网卡）："
    echo "    前端: http://${EXTERNAL_IP}:${FRONTEND_PORT}"
    echo "    后端: http://${EXTERNAL_IP}:${BACKEND_PORT}"
    echo ""
    echo "  本地访问："
    echo "    前端: http://localhost:${FRONTEND_PORT}"
    echo "    后端: http://localhost:${BACKEND_PORT}"
else
    for ip in $ALL_IPS; do
        echo "  前端: http://${ip}:${FRONTEND_PORT}"
        echo "  后端: http://${ip}:${BACKEND_PORT}"
    done
fi
echo ""
```

## 单独命令参考

### 获取本机 IP
```bash
hostname -I
# 或
ip addr show | grep "inet " | grep -v "127.0.0.1"
```

### 检查端口监听
```bash
ss -tlnp | grep -E "4290|4291"
```

### 测试特定 IP:端口 可达性
```bash
curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 http://10.42.1.113:4291/
```

### 防火墙放行端口（如需要）

```bash
# firewalld
sudo firewall-cmd --add-port=4291/tcp --permanent
sudo firewall-cmd --add-port=4290/tcp --permanent
sudo firewall-cmd --reload

# ufw
sudo ufw allow 4291/tcp
sudo ufw allow 4290/tcp

# iptables
sudo iptables -A INPUT -p tcp --dport 4291 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 4290 -j ACCEPT
```
