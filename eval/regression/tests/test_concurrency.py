from pathlib import Path
from opendrsai_regression.cli import main


ROOT = Path(__file__).resolve().parents[1]


def test_concurrency_range_is_validated(tmp_path: Path, capsys) -> None:
    code = main([
        "--root", str(ROOT), "run", "--case", "qa.greeting.hello", "--adapter", "fixture",
        "--fixture-dir", str(ROOT / "assets" / "evidence"), "--output", str(tmp_path), "--concurrency", "33",
    ])
    assert code == 2
    assert "--concurrency must be between 1 and 32" in capsys.readouterr().err
