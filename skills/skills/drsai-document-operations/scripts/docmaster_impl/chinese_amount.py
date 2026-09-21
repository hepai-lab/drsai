"""
Deterministic Chinese ↔ Arabic money-amount conversion.

DocMaster fills contract templates where money is shown twice in the same
row — once in 大写 (capital Chinese numerals: 贰仟捌佰元整) and once in 小写
(Arabic with ¥). LLMs are unreliable at converting between these forms (a
classic failure: "贰仟捌佰" → 280000000000), so we keep the conversion out of
the model's hands.

Public API:
    chinese_to_decimal(s)     — parse 大写 / 小写中文 → Decimal, None on failure
    decimal_to_chinese(amt)   — Decimal → 大写 form, default capital=True
    parse_arabic_amount(s)    — "¥2,800.00" / "2800元" → Decimal, None on failure
    format_arabic_amount(amt) — Decimal → "¥2800" or "¥2800.56"

Supports integers and 角/分 (two decimal places). 0 ≤ amount < 1e16.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Optional


_DIGITS = {
    "零": 0, "〇": 0, "○": 0,
    "一": 1, "壹": 1,
    "二": 2, "贰": 2, "贰": 2, "两": 2,
    "三": 3, "叁": 3, "弎": 3,
    "四": 4, "肆": 4,
    "五": 5, "伍": 5,
    "六": 6, "陆": 6, "陸": 6,
    "七": 7, "柒": 7,
    "八": 8, "捌": 8,
    "九": 9, "玖": 9,
}

_UNIT_SMALL = {
    "十": 10, "拾": 10,
    "百": 100, "佰": 100,
    "千": 1000, "仟": 1000,
}

_UNIT_BIG_WAN = ("万", "萬")
_UNIT_BIG_YI = ("亿", "億")

_YUAN_CHARS = ("元", "圆", "圓")

_CAPITAL_DIGITS = "零壹贰叁肆伍陆柒捌玖"
_CAPITAL_SMALL_UNITS = ("", "拾", "佰", "仟")  # index = power of 10


def _parse_section(s: str) -> Optional[int]:
    """Parse a sub-myriad section (≤ 4 digits): '壹仟贰佰叁拾肆' → 1234.

    Empty string → 0. Returns None on malformed input.
    """
    if not s:
        return 0
    # Leading 拾/十 means "1拾" (e.g. 拾贰 = 12)
    if s[0] in _UNIT_SMALL:
        s = "壹" + s
    total = 0
    current = 0
    pending = False
    for ch in s:
        if ch in ("零", "〇", "○"):
            current = 0
            pending = False
        elif ch in _DIGITS:
            if pending:
                return None  # two digit chars in a row without a unit between
            current = _DIGITS[ch]
            pending = True
        elif ch in _UNIT_SMALL:
            if not pending and current == 0:
                return None  # unit without a preceding digit
            total += current * _UNIT_SMALL[ch]
            current = 0
            pending = False
        else:
            return None
    return total + current


def _split_first(s: str, chars: tuple) -> tuple:
    """Find the first occurrence of any char in `chars`; return (before, after)
    or (s, None) if none found."""
    for ch in chars:
        idx = s.find(ch)
        if idx >= 0:
            return s[:idx], s[idx + 1:]
    return s, None


def _parse_integer(s: str) -> Optional[int]:
    """Parse the integer part of a Chinese amount (text before 元/圆),
    splitting on 亿 and 万."""
    if not s:
        return 0
    # 亿 split (only one expected, but treat as outermost)
    yi_part, rest = _split_first(s, _UNIT_BIG_YI)
    if rest is None:
        yi_val = 0
        rest = yi_part
    else:
        yi_val = _parse_section(yi_part)
        if yi_val is None:
            return None
    wan_part, low_part = _split_first(rest, _UNIT_BIG_WAN)
    if low_part is None:
        wan_val = 0
        low_part = wan_part
    else:
        wan_val = _parse_section(wan_part)
        if wan_val is None:
            return None
    low_val = _parse_section(low_part)
    if low_val is None:
        return None
    return yi_val * 100_000_000 + wan_val * 10_000 + low_val


def _parse_decimal(s: str) -> Optional[Decimal]:
    """Parse the fractional part after 元/圆: '伍角陆分' → 0.56."""
    if not s:
        return Decimal(0)
    s = s.rstrip("整正")
    if not s:
        return Decimal(0)
    jiao = 0
    fen = 0
    idx = s.find("角")
    if idx >= 0:
        head = s[:idx].lstrip("零〇○")
        if head:
            if len(head) != 1 or head not in _DIGITS:
                return None
            jiao = _DIGITS[head]
        s = s[idx + 1:]
    idx = s.find("分")
    if idx >= 0:
        head = s[:idx].lstrip("零〇○")
        if head:
            if len(head) != 1 or head not in _DIGITS:
                return None
            fen = _DIGITS[head]
        s = s[idx + 1:]
    if s.strip():
        return None
    return Decimal(jiao) / 10 + Decimal(fen) / 100


_PREFIX_STRIPS = ("人民币", "RMB", "rmb", "Rmb", "￥", "¥")


def chinese_to_decimal(s: Optional[str]) -> Optional[Decimal]:
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return None
    for prefix in _PREFIX_STRIPS:
        if t.startswith(prefix):
            t = t[len(prefix):].lstrip()
            break
    yuan_idx = -1
    for u in _YUAN_CHARS:
        idx = t.find(u)
        if idx >= 0:
            yuan_idx = idx
            break
    if yuan_idx >= 0:
        int_part = t[:yuan_idx]
        dec_part = t[yuan_idx + 1:]
    else:
        # No 元: only accept if string contains Chinese-numeral chars (otherwise
        # this is likely an Arabic value the caller misrouted to us).
        if not any(ch in _DIGITS or ch in _UNIT_SMALL or ch in _UNIT_BIG_WAN or ch in _UNIT_BIG_YI for ch in t):
            return None
        int_part = t.rstrip("整正")
        dec_part = ""
    int_val = _parse_integer(int_part)
    if int_val is None:
        return None
    dec_val = _parse_decimal(dec_part)
    if dec_val is None:
        return None
    return Decimal(int_val) + dec_val


def _section_to_chinese(n: int, capital: bool) -> str:
    """0 ≤ n ≤ 9999 → e.g. 1006 → '壹仟零陆'."""
    if n == 0:
        return ""
    digits = _CAPITAL_DIGITS if capital else "〇一二三四五六七八九"
    units = _CAPITAL_SMALL_UNITS if capital else ("", "十", "百", "千")
    out = []
    started = False
    zero_pending = False
    for power, divisor in enumerate((1000, 100, 10, 1)):
        d = (n // divisor) % 10
        unit_idx = 3 - power  # 1000→3, 100→2, 10→1, 1→0
        if d == 0:
            if started:
                zero_pending = True
        else:
            if zero_pending:
                out.append(digits[0])
                zero_pending = False
            out.append(digits[d])
            out.append(units[unit_idx])
            started = True
    return "".join(out)


def _int_to_chinese(n: int, capital: bool) -> str:
    if n == 0:
        return (_CAPITAL_DIGITS if capital else "〇一二三四五六七八九")[0]
    yi = n // 100_000_000
    wan = (n // 10_000) % 10_000
    low = n % 10_000
    zero_ch = (_CAPITAL_DIGITS if capital else "〇一二三四五六七八九")[0]
    parts = []
    if yi:
        parts.append(_section_to_chinese(yi, capital) + "亿")
    if wan:
        if yi and wan < 1000:
            parts.append(zero_ch)
        parts.append(_section_to_chinese(wan, capital) + "万")
    if low:
        if (yi or wan) and low < 1000:
            parts.append(zero_ch)
        parts.append(_section_to_chinese(low, capital))
    return "".join(parts)


def decimal_to_chinese(amount: Decimal, capital: bool = True) -> str:
    if amount is None:
        raise ValueError("amount must not be None")
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    if amount < 0:
        raise ValueError("negative amounts not supported")
    if amount >= Decimal("1e16"):
        raise ValueError("amount too large (max < 1e16)")
    q = amount.quantize(Decimal("0.01"))
    int_part = int(q)
    cents = int((q * 100) - int_part * 100)
    jiao = cents // 10
    fen = cents % 10
    digits = _CAPITAL_DIGITS if capital else "〇一二三四五六七八九"
    yuan = "元" if capital else "元"
    out = _int_to_chinese(int_part, capital) + yuan
    if jiao == 0 and fen == 0:
        return out + "整"
    if jiao:
        out += digits[jiao] + "角"
        if fen:
            out += digits[fen] + "分"
        else:
            out += "整"
    else:
        out += digits[0] + digits[fen] + "分"
    return out


_ARABIC_SUFFIX_STRIPS = ("元整", "元正", "圆整", "圆正", "元", "圆", "圓")


def parse_arabic_amount(s: Optional[str]) -> Optional[Decimal]:
    """Parse '¥2,800.00' / '2800元' / '2,800.5' → Decimal."""
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return None
    for prefix in ("人民币", "RMB", "rmb", "Rmb", "￥", "¥", "$", "€", "£"):
        if t.startswith(prefix):
            t = t[len(prefix):].lstrip()
            break
    for suffix in _ARABIC_SUFFIX_STRIPS:
        if t.endswith(suffix):
            t = t[:-len(suffix)].rstrip()
            break
    t = t.replace(",", "").replace(" ", "").replace("　", "")
    if not t:
        return None
    if not re.fullmatch(r"[+]?\d+(?:\.\d+)?", t):
        return None
    try:
        return Decimal(t)
    except (InvalidOperation, ValueError):
        return None


def format_arabic_amount(amount: Decimal, prefix: str = "¥") -> str:
    """Decimal → '¥2800' (integer) or '¥2800.56' (2dp)."""
    if not isinstance(amount, Decimal):
        amount = Decimal(str(amount))
    q = amount.quantize(Decimal("0.01"))
    int_part = int(q)
    cents = int((q * 100) - int_part * 100)
    if cents == 0:
        return f"{prefix}{int_part}"
    return f"{prefix}{q:.2f}"
