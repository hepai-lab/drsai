"""
KeyBindings for DrSai TUI.

参考 hermes-agent/cli.py handle_enter() 模式：
- Enter: 路由到当前激活状态的处理逻辑
  - approval 模式 → 提交选中项
  - clarify 模式 → 提交选择或 freetext
  - 命令运行中 → 中断
  - 空闲状态 → 提交输入到 state._pending_input
- Alt+Enter / Esc+Enter: 插入换行（多行输入）
- Ctrl+C: 中断信号（不退出 REPL）
- Ctrl+D: 退出 REPL
- Ctrl+L: 清屏
"""

from __future__ import annotations

from prompt_toolkit.filters import Condition
from prompt_toolkit.key_binding import KeyBindings

from .app import DrSaiTUIState


def build_keybindings(state: DrSaiTUIState) -> KeyBindings:
    kb = KeyBindings()

    # ── Enter: submit or route ──────────────────────────────────────────────
    @kb.add("c-m", filter=~Condition(lambda: state.command_running), eager=True)
    def handle_enter(event):
        """Handle Enter when command is NOT running.

        Note: We use 'c-m' (Control-M, which is Enter) with eager=True to
        ensure this binding takes precedence over the default multiline Enter behavior.
        """
        # ── Approval mode: submit selected choice ─────────────────────────
        if state.approval_state:
            approval = state.approval_state
            choices = approval.choices
            # For approval, we submit the first choice (typically "approve")
            if choices:
                choice = choices[0]
                _submit_approval(state, choice)
            event.app.invalidate()
            return

        # ── Clarify mode ──────────────────────────────────────────────────
        if state.clarify_state:
            clarify = state.clarify_state
            choices = clarify.choices
            rq = clarify.response_queue
            # For clarify, we submit the first choice
            if choices and rq:
                rq.put(choices[0])
            state.clarify_state = None
            event.app.invalidate()
            return

        # ── Normal input: submit to pending_input queue ───────────────────
        text = event.app.current_buffer.text.strip()
        if text:
            state._pending_input.put(text)
        event.app.current_buffer.reset(append_to_history=True)
        event.app.invalidate()

    @kb.add("enter", filter=Condition(lambda: state.command_running))
    def handle_enter_while_running(event):
        """Handle Enter when command IS running (interrupt)."""
        text = event.app.current_buffer.text.strip()
        # Route as interrupt payload
        state._pending_input.put(("interrupt", text))
        event.app.current_buffer.reset()
        event.app.invalidate()

    # ── Esc+Enter: insert newline (multiline input) ─────────────────────
    # Alt+Enter maps to the same escape+enter sequence in most terminals.
    # prompt_toolkit 3.x doesn't have "alt-enter" as a named key, so we
    # use "escape" + "enter" which covers both Alt+Enter and Esc+Enter.
    @kb.add("escape", "enter")
    def insert_newline(event):
        event.app.current_buffer.insert_text("\n")

    # ── Ctrl+C: interrupt (don't quit) ────────────────────────────────────
    @kb.add("c-c", eager=True)
    def handle_ctrl_c(event):
        """Ctrl+C: set interrupt flag, reset buffer, don't exit."""
        event.app.current_buffer.reset()
        event.app.invalidate()

    # ── Ctrl+D: EOF / exit REPL ────────────────────────────────────────────
    @kb.add("c-d", eager=True)
    def handle_ctrl_d(event):
        """Ctrl+D: exit the REPL."""
        state.should_exit = True
        if event.app.is_running:
            event.app.exit()

    # ── Ctrl+L: clear screen ───────────────────────────────────────────────
    @kb.add("c-l")
    def handle_ctrl_l(event):
        """Ctrl+L: clear message history."""
        state.clear_messages()
        event.app.invalidate()

    # ── ↑/↓: history search ────────────────────────────────────────────────
    # prompt_toolkit's FileHistory + AutoSuggestFromHistory handle ↑↓ natively.
    # No custom bindings needed for basic history navigation.
    #
    # Custom history bindings (↑/↓ with prefix filter) can be added here if needed:
    #
    # @kb.add("up", filter=~Condition(lambda: state.command_running))
    # def history_up(event):
    #     b = event.app.current_buffer
    #     if b.on_up_history():
    #         event.prevent_default = True
    #
    # @kb.add("down", filter=~Condition(lambda: state.command_running))
    # def history_down(event):
    #     b = event.app.current_buffer
    #     if b.on_down_history():
    #         event.prevent_default = True

    # ── Approval navigation: 数字键 1-9 快速选择 ─────────────────────────
    # Note: Arrow key navigation removed - approval panels now use numbered choices
    # User presses 1, 2, 3, etc. to select (handled by normal input → approval callback)

    # ── Escape: close approval / clarify panels ────────────────────────────
    @kb.add("escape", eager=True)
    def escape_close(event):
        if state.approval_state:
            _submit_approval(state, "deny")
            event.app.invalidate()
        elif state.clarify_state:
            state.clarify_state = None
            event.app.invalidate()

    return kb


# ── Internal helpers ──────────────────────────────────────────────────────────


def _submit_approval(state: DrSaiTUIState, choice: str) -> None:
    """Submit an approval choice and close the approval panel."""
    if state.approval_state:
        rq = state.approval_state.response_queue
        if rq:
            rq.put(choice)
        state.approval_state = None
