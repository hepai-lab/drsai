from drsai.backend.run_drsai_agent_factory import normalize_provider_model_name


def test_official_openai_endpoint_uses_native_model_id() -> None:
    assert normalize_provider_model_name(
        "openai/gpt-5.4",
        "https://api.openai.com/v1",
    ) == "gpt-5.4"


def test_hepai_endpoint_keeps_provider_qualified_model_id() -> None:
    assert normalize_provider_model_name(
        "openai/gpt-5.4",
        "https://aiapi.ihep.ac.cn/apiv2",
    ) == "openai/gpt-5.4"


def test_hepai_endpoint_qualifies_native_openai_model_id() -> None:
    assert normalize_provider_model_name(
        "gpt-5.4",
        "https://aiapi.ihep.ac.cn/apiv2",
    ) == "openai/gpt-5.4"


def test_unqualified_model_id_is_unchanged() -> None:
    assert normalize_provider_model_name(
        "gpt-5.4",
        "https://api.openai.com/v1/",
    ) == "gpt-5.4"
