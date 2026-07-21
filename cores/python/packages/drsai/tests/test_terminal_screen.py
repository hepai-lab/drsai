from __future__ import annotations

import importlib.util
import random
import sys
from pathlib import Path


MODULE = Path(__file__).parents[1] / "src" / "drsai" / "backend" / "terminal_screen.py"
SPEC = importlib.util.spec_from_file_location("terminal_screen_under_test", MODULE)
assert SPEC and SPEC.loader
screen_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = screen_module
SPEC.loader.exec_module(screen_module)
TerminalScreen = screen_module.TerminalScreen


def text(lines: list[list[dict]]) -> list[str]:
    return ["".join(run["text"] for run in line).rstrip() for line in lines]


def test_random_byte_splitting_has_identical_snapshot() -> None:
    stream = (
        b"primary\r\n\x1b[31;1mRED\x1b[0m \xe4\xb8\xad\xe6\x96\x87\r\n"
        b"\x1b[?2004h\x1b[?1049hALT\r\n\x1b[38;2;1;2;3mRGB\x1b[0m"
        b"\x1b[?1049l\x1b[2;4Hdone\x1b[?2004l"
    )
    expected = TerminalScreen(5, 16)
    expected.feed(stream)
    expected_snapshot = expected.snapshot(7, 2)
    for seed in range(40):
        actual = TerminalScreen(5, 16)
        randomizer, offset = random.Random(seed), 0
        while offset < len(stream):
            size = randomizer.randint(1, 7)
            actual.feed(stream[offset:offset + size])
            offset += size
        assert actual.snapshot(7, 2) == expected_snapshot


def test_scrollback_color_wide_clear_resize_alternate_and_bracketed_paste_golden() -> None:
    screen = TerminalScreen(3, 8, max_scrollback=5)
    screen.feed(b"one\r\ntwo\r\nthree\r\nfour")
    snapshot = screen.snapshot(1, 1)
    assert text(snapshot["scrollback"]) == ["one"]
    assert text(snapshot["screen"]) == ["two", "three", "four"]

    screen.feed("\r\n\x1b[31;1m红\x1b[0m".encode())
    colored = screen.snapshot(2, 1)
    red = colored["screen"][-1][0]
    assert red["text"] == "红" and red["style"] == {"fg": "ansi:1", "bold": True}
    assert colored["cursor"]["x"] == 2

    screen.feed(b"\x1b[?2004h\x1b[?1049hALT")
    alternate = screen.snapshot(3, 1)
    assert alternate["alternate_screen"] is True and alternate["bracketed_paste"] is True
    assert text(alternate["screen"])[0] == "ALT"
    screen.feed(b"\x1b[2J\x1b[?1049l")
    restored = screen.snapshot(4, 1)
    assert restored["alternate_screen"] is False
    assert any("红" in line for line in text(restored["screen"]))

    screen.resize(2, 5)
    resized = screen.snapshot(5, 1)
    assert resized["rows"] == 2 and resized["cols"] == 5
    assert resized["cursor"]["x"] < 5 and resized["cursor"]["y"] < 2


def test_cursor_addressing_erase_and_truecolor_are_deterministic() -> None:
    screen = TerminalScreen(4, 10)
    screen.feed(b"abcdefghij\r\n0123456789\x1b[2;4H\x1b[KX\x1b[38;2;10;20;30mY")
    snapshot = screen.snapshot(9, 3)
    assert text(snapshot["screen"])[1] == "012XY"
    assert snapshot["screen"][1][-1]["style"]["fg"] == "rgb:10,20,30"
    assert snapshot["snapshot_sequence"] == 9 and snapshot["generation"] == 3

