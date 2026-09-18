from autogen_agentchat.messages import TextMessage

from drsai_ui.ui_backend.backend.web.interrupted_run_history import (
    attach_recap_to_task,
    build_interrupted_run_recap,
)


def test_recap_includes_user_task_and_skips_error_bubble() -> None:
    recap = build_interrupted_run_recap(
        [
            {
                "source": "user_proxy",
                "content": '{"content": "perform image reconstruction on scan_10003.h5"}',
                "metadata": {"internal": "no"},
            },
            {
                "source": "assistant",
                "content": "I'll start reconstruction.",
                "metadata": {"internal": "no", "turn_plane": "final"},
            },
            {
                "source": "system",
                "content": "这次回复出错了，已经安全结束。请重新发送，或输入 continue。",
                "metadata": {"internal": "no"},
            },
            {
                "source": "assistant",
                "content": "run_bash recon.py",
                "metadata": {"internal": "no", "turn_plane": "process"},
            },
        ]
    )
    assert recap is not None
    assert "scan_10003.h5" in recap
    assert "I'll start reconstruction." in recap
    assert "这次回复出错了" not in recap
    assert "run_bash" not in recap
    assert "Do not claim there was no previous conversation" in recap


def test_recap_unwraps_json_user_content() -> None:
    recap = build_interrupted_run_recap(
        [
            {
                "source": "user",
                "content": {"content": "continue the ptycho job", "accepted": False},
            }
        ]
    )
    assert recap is not None
    assert "continue the ptycho job" in recap
    assert "accepted" not in recap


def test_empty_history_returns_none() -> None:
    assert build_interrupted_run_recap([]) is None
    assert (
        build_interrupted_run_recap(
            [
                {
                    "source": "system",
                    "content": "这次回复出错了，已经安全结束。",
                }
            ]
        )
        is None
    )


def test_attach_recap_is_hidden_and_keeps_user_turn() -> None:
    recap = "Prior conversation:\nUser: reconstruct scan.h5"
    task = [TextMessage(source="user_proxy", content="continue")]
    attached = attach_recap_to_task(task, recap)
    assert len(attached) == 2
    assert attached[0].metadata["internal"] == "yes"
    assert attached[0].metadata["type"] == "interrupted_run_recap"
    assert attached[1].content == "continue"


def test_attach_recap_to_plain_string() -> None:
    attached = attach_recap_to_task("continue", "recap body")
    assert attached[0].content == "recap body"
    assert attached[1].source == "user_proxy"
    assert attached[1].content == "continue"
