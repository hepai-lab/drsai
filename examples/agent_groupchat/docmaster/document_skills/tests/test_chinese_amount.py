"""Tests for chinese_amount.py and docx_template_skill._reconcile_amount_pairs.

Plain-assert style so it runs with `python test_chinese_amount.py` without
pytest, but pytest will still discover the `test_*` functions if available.
"""
from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

# Allow running as a script from the tests/ directory.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from chinese_amount import (
    chinese_to_decimal,
    decimal_to_chinese,
    format_arabic_amount,
    parse_arabic_amount,
)
import docx_template_skill as dts


def test_chinese_to_decimal_basic():
    assert chinese_to_decimal("贰仟捌佰元整") == Decimal(2800)
    assert chinese_to_decimal("壹仟元整") == Decimal(1000)
    assert chinese_to_decimal("壹佰万元整") == Decimal(1_000_000)
    assert chinese_to_decimal("壹亿贰仟叁佰肆拾伍万元整") == Decimal(123_450_000)
    assert chinese_to_decimal("壹仟零陆元整") == Decimal(1006)
    assert chinese_to_decimal("壹佰零陆元整") == Decimal(106)


def test_chinese_to_decimal_with_jiao_fen():
    assert chinese_to_decimal("贰仟捌佰元伍角陆分") == Decimal("2800.56")
    assert chinese_to_decimal("贰仟捌佰元伍角") == Decimal("2800.5")
    assert chinese_to_decimal("壹仟元零伍分") == Decimal("1000.05")
    assert chinese_to_decimal("零元伍角") == Decimal("0.5")


def test_chinese_to_decimal_rejects_garbage():
    assert chinese_to_decimal("hello") is None
    assert chinese_to_decimal("贰仟x佰") is None
    assert chinese_to_decimal("") is None
    assert chinese_to_decimal(None) is None
    # Arabic-only text should not be interpreted by the Chinese parser
    assert chinese_to_decimal("2800") is None


def test_chinese_to_decimal_prefix_tolerant():
    assert chinese_to_decimal("人民币贰仟捌佰元整") == Decimal(2800)
    assert chinese_to_decimal("¥贰仟捌佰元整") == Decimal(2800)
    assert chinese_to_decimal("RMB 壹仟元整") == Decimal(1000)


def test_decimal_to_chinese_basic():
    assert decimal_to_chinese(Decimal(0)) == "零元整"
    assert decimal_to_chinese(Decimal(1)) == "壹元整"
    assert decimal_to_chinese(Decimal(100)) == "壹佰元整"
    assert decimal_to_chinese(Decimal(1006)) == "壹仟零陆元整"
    assert decimal_to_chinese(Decimal(2800)) == "贰仟捌佰元整"
    assert decimal_to_chinese(Decimal(1_230_000)) == "壹佰贰拾叁万元整"
    assert decimal_to_chinese(Decimal(100_000_000)) == "壹亿元整"


def test_decimal_to_chinese_jiao_fen():
    assert decimal_to_chinese(Decimal("2800.56")) == "贰仟捌佰元伍角陆分"
    assert decimal_to_chinese(Decimal("2800.50")) == "贰仟捌佰元伍角整"
    assert decimal_to_chinese(Decimal("1000.05")) == "壹仟元零伍分"


def test_roundtrip_decimal_chinese():
    for amt in [
        Decimal(0),
        Decimal(1),
        Decimal(100),
        Decimal(106),
        Decimal(1006),
        Decimal(2800),
        Decimal(1_230_000),
        Decimal(100_000_000),
        Decimal("2800.56"),
        Decimal("1000.05"),
    ]:
        s = decimal_to_chinese(amt)
        back = chinese_to_decimal(s)
        assert back == amt, f"roundtrip failed for {amt}: {s!r} → {back}"


def test_parse_arabic_amount():
    assert parse_arabic_amount("¥2,800.00") == Decimal("2800.00")
    assert parse_arabic_amount("2800元") == Decimal(2800)
    assert parse_arabic_amount("¥2800") == Decimal(2800)
    assert parse_arabic_amount("2,800") == Decimal(2800)
    assert parse_arabic_amount("RMB 1,000.50") == Decimal("1000.50")
    # Bad cases
    assert parse_arabic_amount("hello") is None
    assert parse_arabic_amount("") is None
    assert parse_arabic_amount(None) is None
    # The bug fixture: this DOES parse — it's a numerically valid Decimal —
    # but reconciliation against 大写 will overwrite it.
    assert parse_arabic_amount("¥280000000000") == Decimal(280_000_000_000)


def test_format_arabic_amount():
    assert format_arabic_amount(Decimal(2800)) == "¥2800"
    assert format_arabic_amount(Decimal("2800.56")) == "¥2800.56"
    assert format_arabic_amount(Decimal("2800.00")) == "¥2800"
    assert format_arabic_amount(Decimal(0)) == "¥0"


# ── Reconciliation integration ──────────────────────────────────────────────


def _paired_slots():
    """Two slots in the same fake table cell — the contract row layout."""
    cell = object()
    return [
        {
            "id": "slot_0",
            "kind": "underscores",
            "label": "合同金额（大写）",
            "context": "合同金额（大写）______",
            "_meta": {"cell": cell},
        },
        {
            "id": "slot_1",
            "kind": "underscores",
            "label": "（小写）¥",
            "context": "（小写）¥______",
            "_meta": {"cell": cell},
        },
    ]


def test_reconcile_bug_repro():
    """The original failure: 大写=贰仟捌佰元整, 小写=¥280000000000 → 小写 corrected to ¥2800."""
    slots = _paired_slots()
    sv, notes = dts._reconcile_amount_pairs(
        slots, {"slot_0": "贰仟捌佰元整", "slot_1": "¥280000000000"}
    )
    assert sv["slot_1"] == "¥2800"
    assert sv["slot_0"] == "贰仟捌佰元整"
    assert len(notes) == 1 and "reconciled" in notes[0].lower()


def test_reconcile_infer_xiaoxie():
    slots = _paired_slots()
    sv, notes = dts._reconcile_amount_pairs(slots, {"slot_0": "壹仟元整"})
    assert sv["slot_1"] == "¥1000"
    assert len(notes) == 1


def test_reconcile_infer_daxie():
    slots = _paired_slots()
    sv, notes = dts._reconcile_amount_pairs(slots, {"slot_1": "¥2800"})
    assert sv["slot_0"] == "贰仟捌佰元整"
    assert len(notes) == 1


def test_reconcile_agree_noop():
    slots = _paired_slots()
    inp = {"slot_0": "贰仟捌佰元整", "slot_1": "¥2800"}
    sv, notes = dts._reconcile_amount_pairs(slots, inp)
    assert sv == inp
    assert notes == []


def test_reconcile_neither_parses():
    slots = _paired_slots()
    inp = {"slot_0": "garbage", "slot_1": "also bad"}
    sv, notes = dts._reconcile_amount_pairs(slots, inp)
    assert sv == inp
    assert len(notes) == 1 and "neither" in notes[0]


def test_reconcile_different_containers_no_pairing():
    """Slots in different paragraphs aren't a pair."""
    slots = [
        {"id": "a", "kind": "underscores", "label": "（大写）", "context": "",
         "_meta": {"paragraph": object()}},
        {"id": "b", "kind": "underscores", "label": "（小写）", "context": "",
         "_meta": {"paragraph": object()}},
    ]
    inp = {"a": "贰仟捌佰元整", "b": "¥9999"}
    sv, notes = dts._reconcile_amount_pairs(slots, inp)
    assert sv == inp
    assert notes == []


# ── Plain-assert runner ─────────────────────────────────────────────────────


def _run_all():
    failed = []
    fns = [(name, fn) for name, fn in globals().items()
           if name.startswith("test_") and callable(fn)]
    for name, fn in fns:
        try:
            fn()
            print(f"  OK   {name}")
        except AssertionError as exc:
            print(f"  FAIL {name}: {exc}")
            failed.append(name)
        except Exception as exc:
            print(f"  ERR  {name}: {type(exc).__name__}: {exc}")
            failed.append(name)
    print()
    if failed:
        print(f"{len(failed)} of {len(fns)} test(s) failed: {failed}")
        return 1
    print(f"All {len(fns)} tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
