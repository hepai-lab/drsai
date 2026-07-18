"""Small deterministic VT/xterm-compatible screen model for Runtime snapshots."""

from __future__ import annotations

import codecs
import copy
import unicodedata
from dataclasses import dataclass, asdict
from typing import Any


@dataclass
class Cell:
    text: str = " "
    width: int = 1
    fg: str | None = None
    bg: str | None = None
    bold: bool = False
    underline: bool = False
    inverse: bool = False


def _blank(cols: int) -> list[Cell]:
    return [Cell() for _ in range(cols)]


class TerminalScreen:
    VERSION = 1

    def __init__(self, rows: int, cols: int, *, max_scrollback: int = 2000):
        self.rows, self.cols = rows, cols
        self.max_scrollback = max(0, max_scrollback)
        self.primary = [_blank(cols) for _ in range(rows)]
        self.alternate = [_blank(cols) for _ in range(rows)]
        self.scrollback: list[list[Cell]] = []
        self.cursor_x = self.cursor_y = 0
        self.saved_cursor = (0, 0)
        self.alternate_active = False
        self.bracketed_paste = False
        self.style = Cell()
        self._state = "normal"
        self._control = ""
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")

    @property
    def grid(self) -> list[list[Cell]]:
        return self.alternate if self.alternate_active else self.primary

    def feed(self, data: bytes) -> None:
        for char in self._decoder.decode(data, final=False):
            self._feed_char(char)

    def _feed_char(self, char: str) -> None:
        if self._state == "normal":
            if char == "\x1b": self._state = "esc"
            elif char == "\r": self.cursor_x = 0
            elif char in {"\n", "\x0b", "\x0c"}: self._linefeed()
            elif char == "\b": self.cursor_x = max(0, self.cursor_x - 1)
            elif char == "\t": self.cursor_x = min(self.cols - 1, ((self.cursor_x // 8) + 1) * 8)
            elif ord(char) >= 32 and char != "\x7f": self._print(char)
            return
        if self._state == "esc":
            if char == "[": self._state, self._control = "csi", ""
            elif char == "]": self._state, self._control = "osc", ""
            elif char == "7": self.saved_cursor, self._state = (self.cursor_x, self.cursor_y), "normal"
            elif char == "8": self.cursor_x, self.cursor_y, self._state = *self.saved_cursor, "normal"
            elif char == "D": self._linefeed(); self._state = "normal"
            elif char == "M": self._reverse_index(); self._state = "normal"
            elif char == "c": self.reset(); self._state = "normal"
            else: self._state = "normal"
            return
        if self._state == "osc":
            if char == "\x07": self._state = "normal"
            elif char == "\x1b": self._state = "osc_esc"
            elif len(self._control) < 4096: self._control += char
            return
        if self._state == "osc_esc":
            self._state = "normal" if char == "\\" else "osc"
            return
        if self._state == "csi":
            if "@" <= char <= "~":
                self._csi(self._control, char)
                self._state, self._control = "normal", ""
            elif len(self._control) < 256:
                self._control += char

    def _print(self, char: str) -> None:
        width = 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
        if unicodedata.combining(char):
            x = max(0, self.cursor_x - 1)
            self.grid[self.cursor_y][x].text += char
            return
        if self.cursor_x >= self.cols or (width == 2 and self.cursor_x == self.cols - 1):
            self.cursor_x = 0
            self._linefeed()
        cell = copy.copy(self.style)
        cell.text, cell.width = char, width
        self.grid[self.cursor_y][self.cursor_x] = cell
        if width == 2:
            self.grid[self.cursor_y][self.cursor_x + 1] = Cell("", 0, cell.fg, cell.bg, cell.bold, cell.underline, cell.inverse)
        self.cursor_x += width

    def _linefeed(self) -> None:
        if self.cursor_y < self.rows - 1:
            self.cursor_y += 1
            return
        removed = self.grid.pop(0)
        self.grid.append(_blank(self.cols))
        if not self.alternate_active and self.max_scrollback:
            self.scrollback.append(removed)
            del self.scrollback[:-self.max_scrollback]

    def _reverse_index(self) -> None:
        if self.cursor_y > 0: self.cursor_y -= 1
        else: self.grid.insert(0, _blank(self.cols)); self.grid.pop()

    @staticmethod
    def _params(raw: str) -> tuple[bool, list[int]]:
        private = raw.startswith("?")
        raw = raw[1:] if private else raw
        return private, [int(item) if item.isdigit() else 0 for item in raw.split(";")] if raw else [0]

    def _csi(self, raw: str, final: str) -> None:
        private, params = self._params(raw)
        first = params[0] or 1
        if final == "A": self.cursor_y = max(0, self.cursor_y - first)
        elif final == "B": self.cursor_y = min(self.rows - 1, self.cursor_y + first)
        elif final == "C": self.cursor_x = min(self.cols - 1, self.cursor_x + first)
        elif final == "D": self.cursor_x = max(0, self.cursor_x - first)
        elif final == "G": self.cursor_x = min(self.cols - 1, first - 1)
        elif final in {"H", "f"}:
            self.cursor_y = min(self.rows - 1, (params[0] or 1) - 1)
            self.cursor_x = min(self.cols - 1, (params[1] if len(params) > 1 and params[1] else 1) - 1)
        elif final == "J": self._erase_display(params[0])
        elif final == "K": self._erase_line(params[0])
        elif final == "m": self._sgr(params)
        elif final == "s": self.saved_cursor = (self.cursor_x, self.cursor_y)
        elif final == "u": self.cursor_x, self.cursor_y = self.saved_cursor
        elif private and final in {"h", "l"}:
            enabled = final == "h"
            if 1049 in params: self._alternate(enabled)
            if 2004 in params: self.bracketed_paste = enabled

    def _erase_display(self, mode: int) -> None:
        if mode in {2, 3}:
            self.grid[:] = [_blank(self.cols) for _ in range(self.rows)]
            if mode == 3: self.scrollback.clear()
        elif mode == 0:
            self._erase_line(0)
            for row in range(self.cursor_y + 1, self.rows): self.grid[row] = _blank(self.cols)
        elif mode == 1:
            self._erase_line(1)
            for row in range(self.cursor_y): self.grid[row] = _blank(self.cols)

    def _erase_line(self, mode: int) -> None:
        start, end = (0, self.cursor_x + 1) if mode == 1 else (0, self.cols) if mode == 2 else (self.cursor_x, self.cols)
        for index in range(start, end): self.grid[self.cursor_y][index] = Cell()

    def _sgr(self, params: list[int]) -> None:
        if params == [0]: self.style = Cell(); return
        index = 0
        while index < len(params):
            code = params[index]
            if code == 0: self.style = Cell()
            elif code == 1: self.style.bold = True
            elif code == 4: self.style.underline = True
            elif code == 7: self.style.inverse = True
            elif code == 22: self.style.bold = False
            elif code == 24: self.style.underline = False
            elif code == 27: self.style.inverse = False
            elif 30 <= code <= 37: self.style.fg = f"ansi:{code - 30}"
            elif 40 <= code <= 47: self.style.bg = f"ansi:{code - 40}"
            elif 90 <= code <= 97: self.style.fg = f"ansi:{code - 90 + 8}"
            elif 100 <= code <= 107: self.style.bg = f"ansi:{code - 100 + 8}"
            elif code in {39, 49}: setattr(self.style, "fg" if code == 39 else "bg", None)
            elif code in {38, 48} and index + 2 < len(params) and params[index + 1] == 5:
                setattr(self.style, "fg" if code == 38 else "bg", f"index:{params[index + 2]}"); index += 2
            elif code in {38, 48} and index + 4 < len(params) and params[index + 1] == 2:
                color = f"rgb:{params[index + 2]},{params[index + 3]},{params[index + 4]}"
                setattr(self.style, "fg" if code == 38 else "bg", color); index += 4
            index += 1

    def _alternate(self, enabled: bool) -> None:
        if enabled == self.alternate_active: return
        if enabled:
            self.saved_cursor = (self.cursor_x, self.cursor_y)
            self.alternate = [_blank(self.cols) for _ in range(self.rows)]
            self.cursor_x = self.cursor_y = 0
        else:
            self.cursor_x, self.cursor_y = self.saved_cursor
        self.alternate_active = enabled

    def resize(self, rows: int, cols: int) -> None:
        for grid in (self.primary, self.alternate):
            if rows < len(grid): del grid[:len(grid) - rows]
            while len(grid) < rows: grid.append(_blank(self.cols))
            for line in grid:
                if cols < len(line): del line[cols:]
                else: line.extend(Cell() for _ in range(cols - len(line)))
        self.rows, self.cols = rows, cols
        self.cursor_x, self.cursor_y = min(self.cursor_x, cols - 1), min(self.cursor_y, rows - 1)

    def reset(self) -> None:
        self.primary = [_blank(self.cols) for _ in range(self.rows)]
        self.alternate = [_blank(self.cols) for _ in range(self.rows)]
        self.scrollback.clear(); self.cursor_x = self.cursor_y = 0
        self.alternate_active = self.bracketed_paste = False; self.style = Cell()

    @staticmethod
    def _runs(line: list[Cell]) -> list[dict[str, Any]]:
        runs: list[dict[str, Any]] = []
        for cell in line:
            if cell.width == 0: continue
            style = {key: value for key, value in asdict(cell).items() if key not in {"text", "width"} and value not in {None, False}}
            if runs and runs[-1]["style"] == style: runs[-1]["text"] += cell.text
            else: runs.append({"text": cell.text, "style": style})
        while runs and not runs[-1]["text"].rstrip(): runs.pop()
        return runs

    def snapshot(self, sequence: int, generation: int) -> dict[str, Any]:
        return {
            "version": self.VERSION, "snapshot_sequence": sequence, "generation": generation,
            "rows": self.rows, "cols": self.cols,
            "cursor": {"x": self.cursor_x, "y": self.cursor_y},
            "alternate_screen": self.alternate_active, "bracketed_paste": self.bracketed_paste,
            "scrollback": [self._runs(line) for line in self.scrollback],
            "screen": [self._runs(line) for line in self.grid],
        }

