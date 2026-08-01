# AI Agent 轻量级沙盒方案调研报告

> **调研背景**: DrSaiAssistant 当前通过 `run_bash` / `run_powershell` 等闭包函数直接在 TUI 后端进程中执行 shell 命令，存在安全隐患和环境破坏风险。本报告调研可替代的沙盒化执行方案。
>
> **调研日期**: 2026-07-23
> **调研方法**: 浏览器自动化访问各方案官网/文档/GitHub 仓库

---

## 目录

1. [当前问题分析](#1-当前问题分析)
2. [方案全景图](#2-方案全景图)
3. [云沙盒 API 方案](#3-云沙盒-api-方案)
4. [本地轻量级沙盒方案](#4-本地轻量级沙盒方案)
5. [AI Agent 框架自带的沙盒方案](#5-ai-agent-框架自带的沙盒方案)
6. [综合对比矩阵](#6-综合对比矩阵)
7. [DrSai 集成建议](#7-drsai-集成建议)
8. [推荐方案详细设计](#8-推荐方案详细设计)

---

## 1. 当前问题分析

### 1.1 现状

DrSaiAssistant 的 OS 工具层 (`get_operator_funcs()`) 中的 `run_bash` 等函数直接通过 `asyncio.create_subprocess_shell()` 在**当前进程**中创建子进程执行命令：

```python
# operater_funs.py:659-661
proc = await asyncio.create_subprocess_shell(
    wrapped,
    cwd=str(_cwd[0]),
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
    preexec_fn=os.setsid  # 创建新会话
)
```

### 1.2 风险分析

| 风险类别 | 描述 | 当前缓解措施 | 不足 |
|----------|------|-------------|------|
| **进程逃逸** | Agent 执行的命令（如 `kill`、`pkill`）可终止 TUI 后端进程 | 危险命令正则拦截 (`_DANGEROUS_PATTERNS`) | 正则无法覆盖所有变体；`_dangerous_allowed=True` 时完全绕过 |
| **文件系统破坏** | Agent 可覆盖/删除 DrSai 自身的配置、代码、数据库 | 工作空间限制 (`only_in_workspace`) | `extra_work_dirs` 包含 storage_dir，间接暴露配置 |
| **环境污染** | Agent 安装/卸载包、修改环境变量影响宿主 Python 环境 | 无 | ✗ 完全暴露 |
| **资源耗尽** | Agent 执行 `fork bomb`、大文件操作等 | timeout 机制 | 仅超时控制，无 CPU/内存限制 |
| **网络风险** | Agent 可执行网络请求访问内部服务 | 无 | ✗ 完全暴露 |
| **权限提升** | 若以 root 运行，Agent 命令以 root 权限执行 | `_DANGEROUS_PATTERNS` 拦截 `sudo`/`su` | 非完整方案 |

### 1.3 需求定义

| 需求 | 优先级 | 说明 |
|------|--------|------|
| **进程隔离** | P0 | Agent 执行的命令不影响 TUI 后端进程 |
| **文件系统隔离** | P0 | Agent 无法修改 DrSai 自身文件，但可访问工作目录 |
| **网络隔离** | P1 | 可控制 Agent 的网络访问 |
| **资源限制** | P1 | CPU、内存、磁盘配额限制 |
| **低延迟** | P0 | 启动开销 < 1 秒（用户体验） |
| **无需 root** | P0 | 非特权运行 |
| **多语言支持** | P1 | Python、Shell、Node.js 等 |
| **可嵌入** | P0 | 通过 Python SDK 调用，非独立服务 |
| **本地运行** | P0 | 不依赖外部云服务 |
| **可选云端** | P2 | 需要更强隔离或多租户时可切换到云端 |

---

## 2. 方案全景图

```
                    ┌─────────────────────────────────────────────┐
                    │         AI Agent 沙盒方案分类                │
                    └─────────────────────┬───────────────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                           ▼
    ┌─────────────────┐        ┌──────────────────┐        ┌──────────────────┐
    │  云沙盒 API      │        │  本地轻量级沙盒   │        │ Agent 框架自带    │
    │  (SaaS / 自部署) │        │  (进程/容器/VM)   │        │ 沙盒              │
    └────────┬────────┘        └────────┬─────────┘        └────────┬─────────┘
             │                          │                          │
    ┌────────┴────────┐      ┌──────────┴──────────┐     ┌────────┴──────────┐
    │                 │      │                     │     │                   │
    ▼                 ▼      ▼                     ▼     ▼                   ▼
 ┌──────┐       ┌────────┐ ┌──────┐  ┌──────────┐ ┌───────┐ ┌──────────┐ ┌──────────┐
 │ E2B  │       │Daytona │ │gVisor│  │Firecracker│ │nsjail │ │Docker SDK│ │Open      │
 │      │       │        │ │      │  │          │ │       │ │          │ │Interpreter│
 │Apache│       │Apache  │ │Apache│  │Apache    │ │Apache │ │Apache    │ │Apache    │
 │80ms  │       │90ms    │ │100ms │  │125ms     │ │μs级   │ │1-3s     │ │ms级      │
 │VM    │       │容器/VM │ │用户态│  │microVM   │ │namespace│ │容器    │ │bwrap/   │
 │      │       │        │ │内核  │  │          │ │+seccomp│ │         │ │seatbelt  │
 └──────┘       └────────┘ └──────┘  └──────────┘ └───────┘ └──────────┘ └──────────┘
```

---

## 3. 云沙盒 API 方案

### 3.1 E2B

| 维度 | 详情 |
|------|------|
| **底层技术** | Firecracker microVM — 每个 sandbox 拥有独立内核、文件系统、网络栈 |
| **冷启动** | ~80ms |
| **SDK** | Python (`pip install e2b`), JavaScript/TypeScript (`npm i e2b`) |
| **开源/自部署** | ✅ Apache-2.0 (GitHub 13.1k⭐)，支持 Terraform 自部署到 AWS/GCP/Azure |
| **定价** | Hobby 免费 $100 额度；Pro $150/月；按量 $0.000014/s/vCPU |
| **文件持久化** | ✅ 快照（文件系统+内存）、Volumes、暂停/恢复、Fork |
| **实时输出** | ✅ `onStdout`/`onStderr` 回调 |
| **LLM 集成** | LLM 无关；LangChain、LlamaIndex；MCP Gateway |
| **GPU** | ❌ |
| **合规** | Firecracker 硬件级隔离 |

**关键代码示例:**
```python
from e2b import Sandbox

sandbox = Sandbox.create()
result = sandbox.commands.run('echo "Hello!"')
print(result.stdout)
sandbox.close()
```

### 3.2 Daytona

| 维度 | 详情 |
|------|------|
| **底层技术** | Linux 容器（默认）/ Linux VM / Windows VM / GPU 沙盒 |
| **冷启动** | <90ms |
| **SDK** | Python, TypeScript, Ruby, Go, Java（最丰富） |
| **开源/自部署** | ✅ Apache-2.0 (GitHub 72.2k⭐)；⚠️ 2026.06 起公共仓库不再维护；支持 BYOC |
| **定价** | vCPU $0.0504/h；内存 $0.0162/h/GiB；GPU H200 $4.54/h；$200 免费额度 |
| **文件持久化** | ✅ 快照、Volumes (S3)、暂停/恢复、归档 |
| **实时输出** | ✅ 日志流 + 进程 exec 实时输出 |
| **LLM 集成** | MCP Server (Claude/Cursor)；LangChain；LSP 支持 |
| **GPU** | ✅ H200, H100, RTX 5090/4090 等 |
| **合规** | HIPAA, SOC 2, GDPR |

### 3.3 Modal

| 维度 | 详情 |
|------|------|
| **底层技术** | gVisor 容器（默认）/ 完整 Linux VM (Beta) |
| **冷启动** | ~1s（官方称 sub-second） |
| **SDK** | Python（主力），JS/TS (Beta)，Go (Beta) |
| **开源/自部署** | ❌ 平台闭源，**不支持自部署** |
| **定价** | Starter 免费 $30/月额度；Team $250/月；CPU $0.00003942/core/s |
| **文件持久化** | ✅ Volumes、Cloud bucket mounts、快照 |
| **实时输出** | ✅ stdout/stderr 可迭代流 |
| **LLM 集成** | LangGraph, Claude Agent SDK, OpenAI |
| **GPU** | ✅ 最全：B300→T4 |

### 3.4 云沙盒方案对比

| 维度 | E2B | Daytona | Modal |
|------|-----|---------|-------|
| **适合 DrSai** | ★★★★☆ | ★★★☆☆ | ★★☆☆☆ |
| **自部署能力** | ✅ Terraform | ✅ BYOC | ❌ |
| **启动速度** | 80ms | 90ms | ~1s |
| **Python SDK** | ✅ | ✅ | ✅ |
| **隔离级别** | VM 级 | 容器/VM | 容器(gVisor) |
| **成本** | 低 | 中 | 中 |

---

## 4. 本地轻量级沙盒方案

### 4.1 Docker SDK — 最成熟的选择

| 维度 | 详情 |
|------|------|
| **技术原理** | Linux namespaces + cgroups + seccomp + UnionFS 容器 |
| **隔离级别** | 文件系统✓ 网络✓ 进程✓ Syscall✓ (seccomp) |
| **启动开销** | 1-3 秒（容器创建） |
| **需要 Root** | 需要 docker 组权限 |
| **Python 嵌入** | ✅ `pip install docker` — 成熟的 Python SDK |
| **文件持久化** | ✅ 卷挂载、镜像层 |
| **实时输出** | ✅ `stream=True` 获取 stdout/stderr |
| **开源协议** | Apache-2.0 (Docker SDK) |
| **Agent 集成案例** | SWE-agent, OpenHands, SWE-ReX, 无数 AI Agent 框架 |

**优势:**
- 最成熟的容器化方案，文档和社区支持极其丰富
- Python SDK 完善（`docker` 包），API 设计友好
- 支持 `runsc` (gVisor) 作为 runtime 替换，可升级隔离级别
- 可预构建镜像，包含常用工具链
- 支持卷挂载，可将用户工作目录映射到容器中

**劣势:**
- 需要安装 Docker 并加入 docker 组
- 启动开销 1-3 秒（可通过 warm pool 缓解）
- 非 root 用户需额外配置

**集成代码示例:**
```python
import docker

client = docker.from_env()
container = client.containers.run(
    "python:3.12-slim",
    command=["bash", "-c", cmd],
    volumes={work_dir: {"bind": "/workspace", "mode": "rw"}},
    working_dir="/workspace",
    mem_limit="512m",
    cpu_quota=100000,  # 1 CPU
    network_mode="none",  # 禁用网络
    detach=True,
    stdout=True,
    stderr=True,
    remove=True,
)
output = container.logs().decode()
```

### 4.2 gVisor — 用户态内核，最强容器隔离

| 维度 | 详情 |
|------|------|
| **技术原理** | Go 实现的用户态内核 (Sentry)，拦截所有 syscall 在用户空间处理 |
| **隔离级别** | 最强 — 沙盒进程无法直接接触主机内核 |
| **启动开销** | 100-200ms |
| **需要 Root** | 否（rootless 模式可用） |
| **Python 嵌入** | ⚠️ 无原生 Python SDK；通过 Docker `--runtime=runsc` 或 CLI 调用 |
| **开源协议** | Apache-2.0 |
| **Agent 集成案例** | Google 生产环境、GKE Sandbox |

**优势:**
- 与 Docker 无缝集成（`--runtime=runsc`）
- 比 Firecracker 更容易部署（无需 KVM）
- Google 生产环境验证
- 支持 rootless 模式

**劣势:**
- 系统调用拦截有性能开销（CPU 密集型应用慢 10-50%）
- 仅支持 Linux 主机
- 无原生 Python SDK

### 4.3 nsjail — 轻量级进程沙盒

| 维度 | 详情 |
|------|------|
| **技术原理** | Linux namespaces + seccomp-bpf (Kafel) + cgroups + rlimits |
| **隔离级别** | 文件系统✓ 网络✓ 进程✓ Syscall✓ |
| **启动开销** | 微秒级（进程 fork） |
| **需要 Root** | 否（利用 user namespaces） |
| **Python 嵌入** | ⚠️ 无 Python SDK；通过 CLI/subprocess 调用 |
| **开源协议** | Apache-2.0 |
| **Agent 集成案例** | Google 基础设施（CTF 等） |

**优势:**
- 极低启动开销
- 无需 root（user namespaces）
- Kafel 策略语言灵活定义 seccomp 规则
- 支持资源限制（cgroups + rlimits）

**劣势:**
- 无 Python SDK
- 社区较小
- 配置相对复杂

### 4.4 Firecracker — KVM microVM

| 维度 | 详情 |
|------|------|
| **技术原理** | Rust VMM，基于 KVM 创建轻量级 microVM |
| **隔离级别** | VM 级（最强） |
| **启动开销** | ~125ms (5 VM/s/core) |
| **需要 Root** | 需要访问 `/dev/kvm` |
| **Python 嵌入** | ⚠️ 无原生 Python SDK；通过 REST API |
| **开源协议** | Apache-2.0 |
| **Agent 集成案例** | AWS Lambda, Fargate, E2B, Fly.io |

### 4.5 Bubblewrap — Flatpak 的沙盒引擎

| 维度 | 详情 |
|------|------|
| **技术原理** | 非特权用户命名空间 + tmpfs 根 + bind mount |
| **隔离级别** | 文件系统✓ 网络✓(可选) 进程✓ Syscall✗ |
| **启动开销** | 微秒级 |
| **需要 Root** | 否 |
| **Python 嵌入** | ⚠️ 通过 CLI/subprocess 调用 |
| **开源协议** | LGPLv2+ |
| **Agent 集成案例** | Open Interpreter (Linux 后端) |

### 4.6 Pyodide — 浏览器内 WASM Python

| 维度 | 详情 |
|------|------|
| **技术原理** | CPython 编译为 WebAssembly |
| **隔离级别** | WASM 沙箱（无真实 syscall） |
| **启动开销** | ~100ms (WASM 初始化后) |
| **需要 Root** | 否 |
| **Python 嵌入** | ✅ JS SDK (`loadPyodide()`)，可嵌入 Node.js |
| **限制** | ❌ 无 Shell、❌ 无网络、❌ 包兼容性有限 |
| **Agent 集成案例** | JupyterLite, Hugging Face Spaces |

---

## 5. AI Agent 框架自带的沙盒方案

### 5.1 Open Interpreter (67k⭐)

专为 AI Agent 设计的代码执行器，内置沙盒：
- **Linux**: Bubblewrap
- **macOS**: seatbelt (sandbox-exec)
- **旧版回退**: Landlock
- 协议: ACP (Agent Communication Protocol)
- 可通过 Python subprocess 调用

### 5.2 SWE-agent + SWE-ReX

- Princeton NLP 开发的软件工程 Agent
- SWE-ReX 运行时提供沙盒化 Shell 执行
- 多后端支持: Docker / Local / Modal / Fargate / Daytona / Remote
- MIT 协议，`pip install` 安装
- 交互式 Shell 会话（支持 cd、环境变量等状态保持）

### 5.3 OpenHands (81.8k⭐)

- 完整的 AI Agent 平台
- Docker 沙盒选项 (`ghcr.io/openhands/agent-canvas` 镜像)
- 支持本地/VM/Modal/云部署
- MIT 协议

---

## 6. 综合对比矩阵

| 方案 | 隔离级别 | 启动开销 | 无需Root | Python嵌入 | 本地运行 | 文件隔离 | 网络隔离 | 资源限制 | 复杂度 | 适合DrSai |
|------|---------|---------|---------|-----------|---------|---------|---------|---------|--------|----------|
| **Docker SDK** | 容器级 | 1-3s ⚠️ | 需docker组 | ✅ | ✅ | ✅ | ✅ | ✅ | 低 | ★★★★★ |
| **gVisor (via Docker)** | 用户态内核 | 100-200ms ✅ | ✅ | ✅(via Docker) | ✅ | ✅ | ✅ | ✅ | 低 | ★★★★★ |
| **nsjail** | 进程级 | μs级 ✅ | ✅ | ⚠️CLI | ✅ | ✅ | ✅ | ✅ | 中 | ★★★★☆ |
| **Bubblewrap** | 命名空间 | μs级 ✅ | ✅ | ⚠️CLI | ✅ | ✅ | ⚠️可选 | ❌ | 中 | ★★★☆☆ |
| **Firecracker** | VM级 | 125ms ✅ | 需KVM | ⚠️REST | ✅ | ✅ | ✅ | ✅ | 高 | ★★★☆☆ |
| **E2B (自部署)** | VM级 | 80ms ✅ | N/A | ✅ | ⚠️需Terraform | ✅ | ✅ | ✅ | 高 | ★★★★☆ |
| **E2B (云)** | VM级 | 80ms ✅ | N/A | ✅ | ❌云依赖 | ✅ | ✅ | ✅ | 低 | ★★★☆☆ |
| **Daytona** | 容器/VM | 90ms ✅ | N/A | ✅ | ⚠️需部署 | ✅ | ✅ | ✅ | 高 | ★★★☆☆ |
| **Pyodide** | WASM | 100ms ✅ | ✅ | ✅(JS) | ✅ | ✅ | ❌ | ❌ | 低 | ★★☆☆☆ |
| **Open Interpreter** | 进程级 | ms级 ✅ | ✅ | ✅(subprocess) | ✅ | ✅ | ✅ | ⚠️ | 中 | ★★★☆☆ |

---

## 7. DrSai 集成建议

### 7.1 推荐方案: Docker + gVisor 双层架构

**理由:**

1. **Docker SDK** 是唯一同时满足以下条件的方案：
   - ✅ Python 可嵌入 (`pip install docker`)
   - ✅ 本地运行
   - ✅ 完整的文件系统/网络/进程隔离
   - ✅ 资源限制 (CPU/内存)
   - ✅ 生态成熟，已被大量 AI Agent 框架验证
   - ✅ 可通过 warm pool 缓解启动开销

2. **gVisor 作为可选 runtime** 提供升级路径：
   - 默认使用 Docker 标准 runtime（启动快）
   - 安全模式切换到 `runsc` runtime（隔离更强）
   - 用户无需修改代码，只需配置 `--runtime=runsc`

3. **E2B 作为云端备选**：
   - 当本地无 Docker 时回退到 E2B 云沙盒
   - 开源 Apache-2.0，可自部署
   - Python SDK 成熟

### 7.2 架构设计

```
                    ┌─────────────────────────────────────┐
                    │       DrSaiAssistant                 │
                    │  (run_bash, run_bash_background,     │
                    │   run_powershell, ...)               │
                    └──────────────┬──────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────────┐
                    │     SandboxManager (新)               │
                    │  - create_sandbox()                  │
                    │  - exec(cmd) → stdout, stderr, exit  │
                    │  - upload_file(path)                 │
                    │  - download_file(path)               │
                    │  - kill()                            │
                    │  - get_status()                      │
                    └──────────┬───────────┬───────────────┘
                               │           │
                    ┌──────────▼──┐  ┌────▼─────────┐
                    │ DockerBackend│  │ E2BBackend   │
                    │ (本地首选)    │  │ (云端备选)    │
                    │              │  │              │
                    │ - gVisor可选 │  │ - API key    │
                    │ - warm pool  │  │ - 自部署可选  │
                    │ - 资源限制   │  │              │
                    └──────────────┘  └──────────────┘
```

### 7.3 配置方案

```json
// cli_config.json 新增 sandbox 配置
{
  "sandbox": {
    "enabled": true,
    "backend": "docker",          // "docker" | "e2b" | "local"
    "docker": {
      "image": "python:3.12-slim",
      "runtime": "runc",         // "runc" (默认) | "runsc" (gVisor)
      "mem_limit": "2g",
      "cpu_quota": 200000,        // 2 CPUs
      "network_mode": "none",    // "none" | "bridge"
      "warm_pool_size": 2,       // 预热容器数
      "auto_remove": true
    },
    "e2b": {
      "api_key": "",
      "template": "base",
      "self_hosted": false,
      "self_hosted_url": ""
    }
  }
}
```

### 7.4 分阶段实施路线

| 阶段 | 目标 | 工作量 | 优先级 |
|------|------|--------|--------|
| **Phase 1** | Docker SDK 后端 — 替换 `run_bash` 内核 | 2-3 天 | P0 |
| **Phase 2** | Warm Pool + 环境持久化 — 缓解启动开销 | 1-2 天 | P1 |
| **Phase 3** | gVisor runtime 支持 — 安全模式切换 | 0.5 天 | P1 |
| **Phase 4** | E2B 云沙盒后端 — 无 Docker 时的回退 | 2-3 天 | P2 |
| **Phase 5** | 网络策略 + 资源配额精细化 | 1-2 天 | P2 |

---

## 8. 推荐方案详细设计

### 8.1 SandboxManager 接口

```python
from abc import ABC, abstractmethod
from typing import Optional, AsyncGenerator
from dataclasses import dataclass


@dataclass
class SandboxConfig:
    """沙盒配置"""
    backend: str = "docker"           # "docker" | "e2b" | "local"
    image: str = "python:3.12-slim"
    runtime: str = "runc"            # "runc" | "runsc"
    mem_limit: str = "2g"
    cpu_quota: int = 200000           # microseconds per period
    network_mode: str = "none"       # "none" | "bridge"
    work_dir_mount: str = "/workspace"
    warm_pool_size: int = 2
    auto_remove: bool = True
    timeout: int = 120


@dataclass
class ExecResult:
    """命令执行结果"""
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool = False


class SandboxBackend(ABC):
    """沙盒后端抽象接口"""

    @abstractmethod
    async def create(self, config: SandboxConfig) -> "SandboxBackend":
        """创建沙盒实例"""
        ...

    @abstractmethod
    async def exec(self, cmd: str, timeout: int = 60) -> ExecResult:
        """在沙盒中执行命令"""
        ...

    @abstractmethod
    async def exec_stream(self, cmd: str, timeout: int = 60) -> AsyncGenerator[str, None]:
        """流式执行命令，实时输出"""
        ...

    @abstractmethod
    async def upload_file(self, local_path: str, remote_path: str) -> str:
        """上传文件到沙盒"""
        ...

    @abstractmethod
    async def download_file(self, remote_path: str, local_path: str) -> str:
        """从沙盒下载文件"""
        ...

    @abstractmethod
    async def kill(self) -> None:
        """终止沙盒"""
        ...

    @abstractmethod
    async def get_status(self) -> dict:
        """获取沙盒状态"""
        ...
```

### 8.2 Docker 后端实现

```python
import docker
import asyncio
import functools
from typing import AsyncGenerator


class DockerSandboxBackend(SandboxBackend):
    """Docker 沙盒后端"""

    def __init__(self):
        self._client = docker.from_env()
        self._container = None
        self._config: SandboxConfig = None
        self._cwd = "/workspace"

    async def create(self, config: SandboxConfig) -> "DockerSandboxBackend":
        self._config = config

        # 创建容器（不启动，用于 warm pool）
        loop = asyncio.get_event_loop()
        create_fn = functools.partial(
            self._client.containers.create,
            image=config.image,
            runtime=config.runtime if config.runtime != "runc" else None,
            command=["sleep", "infinity"],  # 保持容器运行
            volumes={
                config.work_dir_mount: {
                    "bind": config.work_dir_mount,
                    "mode": "rw"
                }
            },
            working_dir=config.work_dir_mount,
            mem_limit=config.mem_limit,
            cpu_quota=config.cpu_quota,
            network_mode=config.network_mode,
            auto_remove=config.auto_remove,
            detach=True,
            tty=True,  # 保持 stdin 开放
        )
        self._container = await loop.run_in_executor(None, create_fn)
        await loop.run_in_executor(None, self._container.start)
        return self

    async def exec(self, cmd: str, timeout: int = 60) -> ExecResult:
        loop = asyncio.get_event_loop()

        # 使用 docker exec 执行命令
        exec_result = await loop.run_in_executor(
            None,
            functools.partial(
                self._container.exec_run,
                cmd=["bash", "-c", cmd],
                workdir=self._cwd,
                demux=True,
            )
        )

        exit_code, (stdout, stderr) = exec_result
        return ExecResult(
            stdout=stdout.decode() if stdout else "",
            stderr=stderr.decode() if stderr else "",
            exit_code=exit_code,
        )

    async def exec_stream(self, cmd: str, timeout: int = 60) -> AsyncGenerator[str, None]:
        loop = asyncio.get_event_loop()

        # 流式输出
        exec_handle = await loop.run_in_executor(
            None,
            functools.partial(
                self._container.exec_run,
                cmd=["bash", "-c", cmd],
                workdir=self._cwd,
                stream=True,
                demux=True,
            )
        )

        exit_code, output_generator = exec_handle
        for stdout_chunk, stderr_chunk in output_generator:
            if stdout_chunk:
                yield stdout_chunk.decode()
            if stderr_chunk:
                yield stderr_chunk.decode()

    async def upload_file(self, local_path: str, remote_path: str) -> str:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            functools.partial(
                self._container.put_archive,
                remote_path,
                open(local_path, "rb").read(),
            )
        )
        return f"Uploaded {local_path} -> {remote_path}"

    async def download_file(self, remote_path: str, local_path: str) -> str:
        loop = asyncio.get_event_loop()
        stream, stat = await loop.run_in_executor(
            None,
            functools.partial(self._container.get_archive, remote_path)
        )
        with open(local_path, "wb") as f:
            for chunk in stream:
                f.write(chunk)
        return f"Downloaded {remote_path} -> {local_path}"

    async def kill(self) -> None:
        if self._container:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._container.kill)

    async def get_status(self) -> dict:
        if not self._container:
            return {"status": "not_created"}
        loop = asyncio.get_event_loop()
        state = await loop.run_in_executor(None, self._container.attrs)
        return {
            "status": state["State"]["Status"],
            "running": state["State"]["Running"],
            "pid": state["State"]["Pid"],
        }
```

### 8.3 Warm Pool 实现

```python
import asyncio
from collections import deque


class SandboxWarmPool:
    """预热容器池，减少启动延迟"""

    def __init__(self, config: SandboxConfig, pool_size: int = 2):
        self._config = config
        self._pool_size = pool_size
        self._pool: deque[DockerSandboxBackend] = deque()
        self._lock = asyncio.Lock()
        self._filling = False

    async def get(self) -> DockerSandboxBackend:
        async with self._lock:
            if self._pool:
                sandbox = self._pool.popleft()
                # 异步补充池
                asyncio.create_task(self._fill_one())
                return sandbox
            # 池空，直接创建
            sandbox = DockerSandboxBackend()
            await sandbox.create(self._config)
            return sandbox

    async def _fill_one(self):
        """补充一个预热容器"""
        if len(self._pool) >= self._pool_size:
            return
        try:
            sandbox = DockerSandboxBackend()
            await sandbox.create(self._config)
            self._pool.append(sandbox)
        except Exception as e:
            pass  # 预热失败不影响主流程

    async def init(self):
        """初始化预热池"""
        tasks = [self._fill_one() for _ in range(self._pool_size)]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def cleanup(self):
        """清理所有预热容器"""
        while self._pool:
            sandbox = self._pool.popleft()
            await sandbox.kill()
```

### 8.4 与 DrSaiAssistant 集成方案

```python
# operater_funs.py 中 run_bash 的改造方向

async def run_bash(cmd: str, timeout: float = 60) -> str:
    """Execute a bash command in sandbox."""

    # 如果沙盒启用，走沙盒路径
    if _sandbox_manager and _sandbox_manager.is_enabled():
        try:
            result = await _sandbox_manager.exec(cmd, timeout=timeout)
            # 更新工作目录（解析 cd 命令）
            _update_cwd_from_output(result.stdout)
            return result.stdout + ("\n" + result.stderr if result.stderr else "")
        except Exception as e:
            return f"Error (sandbox): {e}"

    # 回退到直接执行（向后兼容）
    # ... 原有 run_bash 逻辑 ...
```

### 8.5 向后兼容策略

```python
# drsai_assistant.py __init__ 中新增沙盒初始化

class DrSaiAssistant(DrSaiAgent):
    def __init__(self, ..., sandbox_config: Optional[dict] = None):
        # ...
        self._sandbox_manager = None
        if sandbox_config and sandbox_config.get("enabled"):
            from drsai.modules.managers.sandbox import SandboxManager
            self._sandbox_manager = SandboxManager(sandbox_config)

        # 传递给 get_operator_funcs
        self._all_basic_funcs = get_operator_funcs(
            ...,
            sandbox_manager=self._sandbox_manager,  # 新参数
        )
```

**关键设计原则:**
- `sandbox_config.enabled=False` 或未配置时，行为完全不变（直接执行）
- `sandbox_config.enabled=True` 时，`run_bash` 等工具内部走沙盒路径
- 不改变工具的对外接口（LLM 调用方式不变）
- 支持 per-session 沙盒隔离（每个会话独立容器）

---

## 附录 A: 方案数据来源

| 方案 | 官网 | GitHub |
|------|------|--------|
| E2B | https://e2b.dev | https://github.com/e2b-dev/E2B |
| Daytona | https://www.daytona.io | https://github.com/daytonaio/daytona |
| Modal | https://modal.com | https://github.com/modal-labs/modal-client |
| gVisor | https://gvisor.dev | https://github.com/google/gvisor |
| Firecracker | https://firecracker-microvm.github.io | https://github.com/firecracker-microvm/firecracker |
| nsjail | https://nsjail.dev | https://github.com/google/nsjail |
| Bubblewrap | - | https://github.com/containers/bubblewrap |
| Docker SDK | https://docs.docker.com/engine/api/sdk/ | https://github.com/docker/docker-py |
| Pyodide | https://pyodide.org | https://github.com/pyodide/pyodide |
| Open Interpreter | - | https://github.com/openinterpreter/open-interpreter |
| SWE-agent | - | https://github.com/swe-agent/SWE-agent |
| OpenHands | https://docs.openhands.dev | https://github.com/All-Hands-AI/OpenHands |

## 附录 B: 选型决策树

```
DrSai 需要沙盒化命令执行
│
├── 有 Docker？
│   ├── 是 → Docker SDK + gVisor (可选 runtime)
│   │        ✅ 推荐: 最成熟、Python 原生、可升级隔离
│   │
│   └── 否 → 有 KVM？
│       ├── 是 → Firecracker (REST API)
│       │        ⚠️ 配置复杂，但隔离最强
│       │
│       └── 否 → nsjail 或 Bubblewrap
│                ⚠️ 无 Python SDK，需 subprocess 调用
│
├── 可接受云依赖？
│   ├── 是 → E2B (自部署或 SaaS)
│   │        ✅ 80ms 启动、VM 级隔离、Python SDK
│   │
│   └── 否 → 本地方案（见上）
│
└── 仅需 Python 代码执行（不需 Shell）？
    └── Pyodide (WASM)
            ✅ 零依赖、WASM 沙箱
```
