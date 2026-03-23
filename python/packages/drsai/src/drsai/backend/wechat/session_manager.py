"""
session_manager.py — 微信会话状态管理
======================================
管理微信用户 <-> chat_id (agent 实例) 的映射关系，
并持久化到 WECHAT_DIR/sessions.json。

数据结构（sessions.json）：
{
    "counter": 3,
    "sessions": {
        "session_1": {
            "owner": "ilink_user_id_xxx",
            "created_at": 1700000000.0,
            "last_active": 1700000060.0
        }
    },
    "current": {
        "ilink_user_id_xxx": "session_1"
    }
}
"""

import json
import os
import time


class SessionManager:
    """
    管理微信用户与 chat_id 的会话映射。

    - 每个微信用户（by ilink_user_id）在同一时刻有一个"当前 session"
    - 用户可以通过命令新建或切换 session
    - 所有状态持久化到 sessions.json，重启后可恢复
    """

    def __init__(self, sessions_file: str):
        self._file = sessions_file
        self._counter: int = 0
        self._sessions: dict[str, dict] = {}   # chat_id -> {owner, created_at, last_active}
        self._current: dict[str, str] = {}     # user_id -> chat_id
        self.load()

    # ── 持久化 ────────────────────────────────────────────────────────────────

    def load(self) -> None:
        """从文件加载状态，文件不存在则初始化空状态。"""
        if not os.path.exists(self._file):
            return
        try:
            with open(self._file, encoding="utf-8") as f:
                data = json.load(f)
            self._counter = data.get("counter", 0)
            self._sessions = data.get("sessions", {})
            self._current = data.get("current", {})
        except (json.JSONDecodeError, OSError):
            pass  # 文件损坏时从空状态开始

    def save(self) -> None:
        """将当前状态写入文件。"""
        os.makedirs(os.path.dirname(self._file), exist_ok=True)
        data = {
            "counter": self._counter,
            "sessions": self._sessions,
            "current": self._current,
        }
        with open(self._file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    # ── 查询 ──────────────────────────────────────────────────────────────────

    def get_current(self, user_id: str) -> str | None:
        """返回用户当前绑定的 chat_id，未绑定返回 None。"""
        return self._current.get(user_id)

    def list_sessions(self, user_id: str) -> list[str]:
        """返回该用户拥有的所有 chat_id 列表（按创建时间排序）。"""
        owned = [
            (cid, info)
            for cid, info in self._sessions.items()
            if info.get("owner") == user_id
        ]
        owned.sort(key=lambda x: x[1].get("created_at", 0))
        return [cid for cid, _ in owned]

    def get_idle(self, idle_seconds: int) -> list[str]:
        """返回超过 idle_seconds 未活跃的 chat_id 列表。"""
        now = time.time()
        return [
            cid
            for cid, info in self._sessions.items()
            if (now - info.get("last_active", 0)) > idle_seconds
        ]

    # ── 变更 ──────────────────────────────────────────────────────────────────

    def new_session(self, user_id: str) -> str:
        """
        为用户创建新 session，返回新 chat_id（格式：session_{n}）。
        同时将该用户的当前 session 切换到新建的。
        """
        self._counter += 1
        chat_id = f"session_{self._counter}"
        now = time.time()
        self._sessions[chat_id] = {
            "owner": user_id,
            "created_at": now,
            "last_active": now,
        }
        self._current[user_id] = chat_id
        self.save()
        return chat_id

    def get_or_create_session(self, user_id: str) -> str:
        """
        返回用户当前 session；若无则自动新建。
        首次与 Bot 对话时调用。
        """
        chat_id = self.get_current(user_id)
        if chat_id is None or chat_id not in self._sessions:
            chat_id = self.new_session(user_id)
        return chat_id

    def switch_session(self, user_id: str, chat_id: str) -> bool:
        """
        切换到指定 chat_id。
        返回 True 表示成功，False 表示 chat_id 不存在或不属于该用户。
        """
        info = self._sessions.get(chat_id)
        if info is None or info.get("owner") != user_id:
            return False
        self._current[user_id] = chat_id
        self.save()
        return True

    def touch(self, chat_id: str) -> None:
        """更新 chat_id 的最后活跃时间（每次收发消息后调用）。"""
        if chat_id in self._sessions:
            self._sessions[chat_id]["last_active"] = time.time()
            self.save()
