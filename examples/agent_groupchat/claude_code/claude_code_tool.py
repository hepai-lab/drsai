"""
Claude Code 后台执行工具

基于 drsai_ext.tools.LongTaskManager，将 `claude --print` 命令包装为
可后台执行、可查询状态的长任务工具函数。

用法示例：
    task_id, result = run_claude_code(prompt="分析 main.py 中的安全问题", cwd="/path/to/project")
    status = query_claude_code_status(task_id)
"""

import subprocess
import shlex
from uuid import uuid4
from typing import Optional
from drsai_ext.tools import LongTaskManager


# ─────────────────────────────────────────────
# 全局任务管理器（time_limit=5s 超时即返回 IN_PROGRESS）
# ─────────────────────────────────────────────
task_manager = LongTaskManager(time_limit=10)


# ─────────────────────────────────────────────
# 核心执行函数（同步，跑在子进程里）
# ─────────────────────────────────────────────
def _run_claude_print_sync(
    prompt: str,
    cwd: str,
    model: Optional[str],
    output_format: str,
    permission_mode: str,
    allowed_tools: Optional[list[str]],
    disallowed_tools: Optional[list[str]],
    system_prompt: Optional[str],
    append_system_prompt: Optional[str],
    max_budget_usd: Optional[float],
    add_dir: Optional[list[str]],
    effort: Optional[str],
    verbose: bool,
    extra_args: Optional[list[str]],
) -> dict:
    """
    构造并执行 `claude --print ...` 命令，返回结构化结果。
    此函数在独立子进程中运行，不会阻塞事件循环。
    """
    cmd = ["claude", "--print"]

    # 模型
    if model:
        cmd += ["--model", model]

    # 输出格式
    cmd += ["--output-format", output_format]

    # 权限模式
    cmd += ["--permission-mode", permission_mode]

    # 允许/禁止的工具
    if allowed_tools:
        cmd += ["--allowed-tools"] + allowed_tools
    if disallowed_tools:
        cmd += ["--disallowed-tools"] + disallowed_tools

    # System prompt
    if system_prompt:
        cmd += ["--system-prompt", system_prompt]
    if append_system_prompt:
        cmd += ["--append-system-prompt", append_system_prompt]

    # 预算上限
    if max_budget_usd is not None:
        cmd += ["--max-budget-usd", str(max_budget_usd)]

    # 额外目录访问权限
    if add_dir:
        cmd += ["--add-dir"] + add_dir

    # 努力等级
    if effort:
        cmd += ["--effort", effort]

    # verbose
    if verbose:
        cmd += ["--verbose"]

    # 用户自定义扩展参数（原样追加）
    if extra_args:
        cmd += extra_args

    # prompt 放最后
    cmd.append(prompt)

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=600,          # 最长 10 分钟
        )
        return {
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "cmd": shlex.join(cmd),
        }
    except subprocess.TimeoutExpired:
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": "Claude Code 执行超时（600s）",
            "cmd": shlex.join(cmd),
        }
    except FileNotFoundError:
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": "未找到 claude 命令，请确认已安装 Claude Code CLI",
            "cmd": shlex.join(cmd),
        }
    except Exception as e:
        return {
            "returncode": -1,
            "stdout": "",
            "stderr": str(e),
            "cmd": shlex.join(cmd),
        }


# ─────────────────────────────────────────────
# 对外工具函数
# ─────────────────────────────────────────────
def run_claude_code(
    prompt: str,
    cwd: str = ".",
    model: Optional[str] = None,
    output_format: str = "text",
    permission_mode: str = "default",
    allowed_tools: Optional[list[str]] = None,
    disallowed_tools: Optional[list[str]] = None,
    system_prompt: Optional[str] = None,
    append_system_prompt: Optional[str] = None,
    max_budget_usd: Optional[float] = None,
    add_dir: Optional[list[str]] = None,
    effort: Optional[str] = None,
    verbose: bool = False,
    extra_args: Optional[list[str]] = None,
    task_id: Optional[str] = None,
) -> tuple[str, dict]:
    """
    在后台启动一个 `claude --print` 任务并立即返回。

    Args:
        prompt          : 发给 Claude Code 的指令或问题（必填）
        cwd             : 工作目录，Claude Code 在此目录下操作文件（默认当前目录）
        model           : 模型别名或完整名称，如 "sonnet"、"opus"、
                          "claude-sonnet-4-6"（默认使用 Claude Code 自身配置）
        output_format   : 输出格式，"text"（默认）| "json" | "stream-json"
        permission_mode : 权限模式，"default"（默认）| "acceptEdits" |
                          "bypassPermissions" | "dontAsk" | "plan" | "auto"
        allowed_tools   : 白名单工具列表，如 ["Bash", "Read", "Edit"]
        disallowed_tools: 黑名单工具列表，如 ["Bash(rm:*)"]
        system_prompt   : 完全替换默认系统提示词
        append_system_prompt: 追加到默认系统提示词末尾
        max_budget_usd  : 本次调用的最大花费上限（美元）
        add_dir         : 额外授权访问的目录列表
        effort          : 努力等级 "low" | "medium" | "high" | "max"
        verbose         : 是否开启详细日志
        extra_args      : 原样追加到命令末尾的任意参数列表（用于传递未封装的参数）
        task_id         : 自定义任务 ID（不传则自动生成 UUID）

    Returns:
        (task_id, status_dict)
            task_id    : 任务唯一标识符，用于后续查询
            status_dict: 任务当前状态，包含 id / status / result / message 字段
                         status 取值：TODO | IN_PROGRESS | DONE | ERROR
    """
    if task_id is None:
        task_id = str(uuid4())

    status = task_manager.run_sync_task(
        func=_run_claude_print_sync,
        task_id=task_id,
        prompt=prompt,
        cwd=cwd,
        model=model,
        output_format=output_format,
        permission_mode=permission_mode,
        allowed_tools=allowed_tools,
        disallowed_tools=disallowed_tools,
        system_prompt=system_prompt,
        append_system_prompt=append_system_prompt,
        max_budget_usd=max_budget_usd,
        add_dir=add_dir,
        effort=effort,
        verbose=verbose,
        extra_args=extra_args,
    )
    return task_id, status


def query_claude_code_status(task_id: str) -> dict:
    """
    查询 claude --print 后台任务的执行状态与结果。

    Args:
        task_id: run_claude_code() 返回的任务 ID

    Returns:
        dict 包含：
            - id      : 任务 ID
            - status  : TODO | IN_PROGRESS | DONE | ERROR
            - result  : 任务完成后为执行结果字典（stdout/stderr/returncode/cmd），
                        未完成时为 None
            - message : 附加信息
    """
    return task_manager.get_task_status(task_id)


# ─────────────────────────────────────────────
# 快速验证
# ─────────────────────────────────────────────
if __name__ == "__main__":
    import time, json

    task_id, init_status = run_claude_code(
        prompt="用一句话描述当前目录下有哪些 Python 文件",
        cwd="/home/xiongdb/drsai_dev/examples/agent_groupchat/claude_code",
        model="sonnet",
        output_format="text",
        permission_mode="dontAsk",
        allowed_tools=["Bash", "Read"],
        effort="low",
    )
    print(f"[提交] task_id={task_id}")
    print(f"[初始状态] {json.dumps(init_status, ensure_ascii=False, indent=2)}")

    # 轮询直到完成
    for _ in range(60):
        time.sleep(3)
        status = query_claude_code_status(task_id)
        print(f"[查询] status={status['status']}")
        if status["status"] in ("DONE", "ERROR"):
            print(f"[结果]\n{json.dumps(status, ensure_ascii=False, indent=2)}")
            break
