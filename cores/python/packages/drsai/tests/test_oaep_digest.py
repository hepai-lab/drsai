from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from drsai.oaep.digest import canonical_oaep_items, oaep_items_digest


ROOT = Path(__file__).resolve().parents[5]


def fixture_items():
    return json.loads((ROOT / "cores/protocol/oaep/examples.json").read_text(encoding="utf-8"))["items"]


def test_oaep_digest_is_order_independent_and_content_sensitive() -> None:
    items = fixture_items()
    assert oaep_items_digest(items) == "868d42660d23d7934cdff0faa5bc1258908ce68edc034e3b50e9f473838eed02"
    assert oaep_items_digest(items) == oaep_items_digest(list(reversed(items)))
    changed = json.loads(json.dumps(items))
    changed[0]["content"]["text"] += " changed"
    assert oaep_items_digest(changed) != oaep_items_digest(items)


def test_oaep_digest_rejects_nonfinite_or_incomplete_values() -> None:
    with pytest.raises(ValueError, match="oaep_digest_item_invalid"):
        canonical_oaep_items([{"id": "only"}])
    items = fixture_items()
    items[0]["content"]["score"] = float("nan")
    with pytest.raises(ValueError, match="oaep_digest_number_invalid"):
        canonical_oaep_items(items)


def test_optional_null_and_absent_are_same_but_required_null_is_preserved() -> None:
    tool = next(item for item in fixture_items() if item["type"] == "tool_call")
    absent = json.loads(json.dumps(tool))
    absent["content"].pop("server", None)
    explicit_null = json.loads(json.dumps(absent))
    explicit_null["content"]["server"] = None
    assert oaep_items_digest([absent]) == oaep_items_digest([explicit_null])

    required_null = json.loads(json.dumps(absent))
    required_null["content"]["result"] = None
    required_absent = json.loads(json.dumps(required_null))
    required_absent["content"].pop("result")
    assert oaep_items_digest([required_null]) != oaep_items_digest([required_absent])


def test_python_and_desktop_oaep_digests_match() -> None:
    items = fixture_items()
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "apps/desktop/windows/scripts/digest-oaep-items.mts")],
        cwd=ROOT / "apps/desktop/windows",
        input=json.dumps({"items": items}, ensure_ascii=False),
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout == oaep_items_digest(items)
