from drsai.backend import run_cli
from drsai.configs.constant import VERSION


def test_version_command_omits_product_prefix(monkeypatch) -> None:
    output: list[str] = []
    monkeypatch.setattr(run_cli.typer, "echo", output.append)

    run_cli.version_cmd()

    assert output == [f"version: {VERSION}"]
