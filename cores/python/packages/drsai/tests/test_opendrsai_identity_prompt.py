from drsai.backend.run_drsai_agent_factory import (
    OPENDRSAI_ASSISTANT_NAME,
    OPENDRSAI_IDENTITY_SYSTEM_PROMPT,
    _build_cwd_prompt,
)


def test_identity_prompt_names_opendrsai_assistant() -> None:
    assert OPENDRSAI_ASSISTANT_NAME == "OpenDrSai Assistant"
    assert "You are OpenDrSai Assistant" in OPENDRSAI_IDENTITY_SYSTEM_PROMPT
    assert "identify yourself as OpenDrSai Assistant" in OPENDRSAI_IDENTITY_SYSTEM_PROMPT


def test_identity_prompt_is_always_injected_without_working_directory() -> None:
    prompt = _build_cwd_prompt({}, work_dir="")
    assert prompt.startswith("## Identity")
    assert "OpenDrSai Assistant" in prompt


def test_identity_prompt_precedes_environment_context() -> None:
    prompt = _build_cwd_prompt({}, work_dir="C:/workspace/example")
    assert prompt.index("## Identity") < prompt.index("## Environment")
    assert "C:/workspace/example" in prompt
