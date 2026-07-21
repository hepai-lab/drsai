"""
Here are constant values that are used in the project
"""

import os, sys
from pathlib import Path
here = Path(__file__).parent

from ..version import __appname__, __version__, __author__

## Basic Info
APPNAME = __appname__
AUTHOR = __author__
VERSION = __version__

## User INFO
try:
    USERNAME = os.getlogin()  # 当前用户名
except:
    USERNAME = os.getenv('USER') or os.getenv('LOGNAME') or os.getenv('USERNAME')  # 适配WSL和windows环境

DEFAULT_USERNAME = "anonymous"  # for 创建assistant和获取assistant

## Paths
REPO_ROOT = f'{here.parent.parent}'  # 项目根目录
FS_DIR = str(Path(os.environ.get("DRSAI_HOME", str(Path.home() / f".{APPNAME}"))).expanduser())

# --- Legacy / fallback dirs (kept for backward compatibility) ---
RUNS_DIR = f'{FS_DIR}/runs'  # 旧的 runs 兜底目录
CONFIG_DIR = f'{FS_DIR}/configs'  # 全局应用配置 (LLM 默认配置 / CLI 配置)，非 per-user
FILE_DIR = f'{FS_DIR}/files'   # 旧的 file 兜底目录 (DrSaiAgent 无 db_manager 时使用)
WECHAT_DIR = f'{FS_DIR}/wechat'   # 微信模块数据目录

# --- Workspace dirs ---
WORKSPACE_DIR = f'{FS_DIR}/workspace'
WORKSPACE_RUNS_DIR = f'{WORKSPACE_DIR}/runs'

directories = [
    FS_DIR, RUNS_DIR, CONFIG_DIR, FILE_DIR, WECHAT_DIR,
    WORKSPACE_DIR, WORKSPACE_RUNS_DIR,
]
for directory in directories:
    path = Path(directory)
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)
            

## logger
LOGGER_DIR = f'{FS_DIR}/logs'  # 日志目录
LOGGER_LEVEL = "INFO"  # 日志级别
# LOGGER_LEVEL = "DEBUG"
# LOGGER_LEVEL = "WARNING"

## event
EVENT_TIMEOUT = 60  # 事件等待超时时间
EVENT_INTERVAL = 0.05  # 事件返回间隔时间
