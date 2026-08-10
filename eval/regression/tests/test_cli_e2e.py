import json
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from opendrsai_regression.cli import main


ROOT = Path(__file__).resolve().parents[1]


def test_fixture_cli_end_to_end_generates_consistent_reports(tmp_path: Path) -> None:
    exit_code = main([
        "--root", str(ROOT), "run", "--case", "qa.greeting.hello", "--adapter", "fixture",
        "--fixture-dir", str(ROOT / "assets" / "evidence"), "--output", str(tmp_path), "--execution-id", "e2e",
    ])
    assert exit_code == 0
    summary = json.loads((tmp_path / "e2e" / "summary.json").read_text(encoding="utf-8"))
    assert summary["total"] == summary["passed"] == 1
    assert summary["results"][0]["evidence"]["adapter"] == "fixture"
    assert (tmp_path / "e2e" / "execution-manifest.json").is_file()
    assert len(list((tmp_path / "e2e" / "cases").glob("qa.greeting.hello-rev1-*.json"))) == 1
    suite = ET.parse(tmp_path / "e2e" / "junit.xml").getroot()
    assert suite.attrib["tests"] == "1"


def test_gateway_cli_preflight_is_clear(tmp_path: Path, capsys) -> None:
    exit_code = main(["--root", str(ROOT), "run", "--case", "qa.greeting.hello", "--output", str(tmp_path)])
    assert exit_code == 2
    assert "gateway run requires --gateway-url" in capsys.readouterr().err


def test_desktop_cli_requires_a_real_transport_command(tmp_path: Path, capsys) -> None:
    with pytest.raises(SystemExit) as raised:
        main(["--root", str(ROOT), "desktop-run", "--case", "qa.greeting.hello", "--output", str(tmp_path)])
    assert raised.value.code == 2
    assert "--transport-command" in capsys.readouterr().err
