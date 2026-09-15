from pathlib import Path
import subprocess
import re
# import glob as glob_lib
import shutil
import platform
import threading
import time
import os
import signal
import uuid
import asyncio
import base64
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Union, List, Dict, Any, Optional
from datetime import datetime

import aiofiles

from .bash_task_persistence import BashTaskPersistence


# A Host-driven Runtime approval is deliberately scoped to one async tool
# execution. It is not the same as the TUI's session-wide `/dangerous on`
# switch and must never mutate that switch. ContextVar keeps concurrent runs
# isolated while allowing the Workbench call stack to consume the proof.
_RUNTIME_TOOL_APPROVAL_GRANTED: ContextVar[bool] = ContextVar(
    "drsai_runtime_tool_approval_granted", default=False,
)


@contextmanager
def runtime_tool_approval_scope(*, granted: bool):
    """Carry a Host-verified, single-call approval through the Workbench."""

    token = _RUNTIME_TOOL_APPROVAL_GRANTED.set(granted is True)
    try:
        yield
    finally:
        _RUNTIME_TOOL_APPROVAL_GRANTED.reset(token)

# Dangerous command patterns (regex)
_DANGEROUS_PATTERNS = [
    r'\bsudo\b',
    r'\bsu\s',
    r'\bshutdown\b',
    r'\breboot\b',
    r'\bhalt\b',
    r'\bmkfs\b',
    r'\bmknod\b',
    r'\bdd\b.+\bof=/dev\b',      # dd writing to block devices
    r'\bchmod\b.+\b[0-7]*[67]{1}[0-7]{2}\s+/',  # chmod with write perms on root paths
    r'\bchown\b.+/',
    r'\bcrontab\b',
    r'\bkillall\b',
    r'\biptables\b',
    r'>\s*/etc/',                 # redirect to /etc
    r'>\s*/dev/',                 # redirect to devices
    r'>\s*/sys/',
    r'>\s*/proc/',
    # --- rm variants ---
    r'\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+/',  # rm -rf /...
    r'\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+/',                             # rm -r /...
    r'\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+/',                             # rm -f /... (force, no recursion)
    # --- find with deletion actions ---
    r'\bfind\b.+\-delete\b',                    # find -delete
    r'\bfind\b.+\-exec\s+rm\b',                 # find -exec rm ...
    r'\bfind\b.+\-exec\s+unlink\b',             # find -exec unlink ...
    # --- xargs piped to rm/unlink ---
    r'\bxargs\b.*\brm\b',                        # xargs rm (e.g. find ... | xargs rm)
    r'\bxargs\b.*\bunlink\b',                    # xargs unlink
    # --- low-level / secure deletion tools ---
    r'\bunlink\b',                               # unlink (syscall wrapper, deletes file)
    r'\bshred\b',                                # shred (overwrite + delete)
    r'\bwipe\b',                                 # wipe (secure delete)
    r'\bsrm\b',                                  # srm (secure-delete package)
    # --- directory removal ---
    r'\brmdir\b',                                # rmdir (remove empty dirs)
    # --- file truncation to zero ---
    r'\btruncate\b.*(-s\s*0|--size[=\s]*0)\b',  # truncate --size 0 / -s 0
    # --- move to /dev/null (effectively destroys content) ---
    r'\bmv\b.+/dev/null\b',
]
_DANGEROUS_RE = re.compile('|'.join(_DANGEROUS_PATTERNS), re.IGNORECASE)

# Script execution patterns (regex) — commands that execute script files
_SCRIPT_EXEC_PATTERNS = [
    r'\bpython[3]?\s+(?!-)[^\s;|&><]+\.py\b',   # python script.py (must end with .py, excludes -c/-m flags)
    r'\bbash\s+(?!-)\S+',                        # bash script.sh (excludes bash -c '...')
    r'\bsh\s+(?!-)\S+',                          # sh script.sh (excludes sh -c '...')
    r'\bsource\s+\S+',                           # source script.sh
    r'\.\s+\./\S+',                              # . ./script (shell source shorthand)
]
_SCRIPT_EXEC_RE = re.compile('|'.join(_SCRIPT_EXEC_PATTERNS), re.IGNORECASE)

# Regex to extract Unix absolute paths from shell commands
_ABS_PATH_RE = re.compile(r'(?:^|[\s=\'",;|&<>(){}])(/(?:[^\s;|&><\'"\\{}()]+))')
# Regex to extract Windows absolute paths from commands (C:\, D:\, etc.)
_WIN_ABS_PATH_RE = re.compile(r'([A-Za-z]:\\[^\s;|&><\'"]+)')

# Cache for PowerShell path detection
_POWERSHELL_PATH_CACHE = None


def _win_subprocess_hide_kwargs() -> dict:
    """Return Windows-specific subprocess kwargs to prevent console window flash.

    On Windows, when a console subprocess (powershell.exe, cmd.exe, etc.)
    is launched from a windowed (no-console) parent process, Windows will
    allocate a new console window for it.  This function returns kwargs
    that suppress that behavior:

    - STARTUPINFO with STARTF_USESHOWWINDOW + SW_HIDE: tells CreateProcess
      to hide any allocated console window
    - CREATE_NO_WINDOW (0x08000000): tells CreateProcess not to allocate
      a console at all

    Both are applied for maximum reliability across all Windows configs.

    Returns an empty dict on non-Windows platforms.
    """
    if platform.system() != "Windows":
        return {}

    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = 0  # SW_HIDE
    return {
        "startupinfo": startupinfo,
        "creationflags": subprocess.CREATE_NO_WINDOW,
    }


# Allow child processes to leave Electron/Chromium job objects when the job
# permits breakaway. Without this, CreateProcess often returns WinError 5
# (Access Denied) for powershell.exe spawned from the Desktop gateway.
_CREATE_BREAKAWAY_FROM_JOB = 0x01000000


def _is_win_access_denied(exc: BaseException) -> bool:
    winerror = getattr(exc, "winerror", None)
    if winerror == 5:
        return True
    errno = getattr(exc, "errno", None)
    if errno == 13 and platform.system() == "Windows":
        return True
    text = str(exc).lower()
    return "winerror 5" in text or "access is denied" in text or "拒绝访问" in text


# GBK / CP936 bytes for "拒绝访问" — cmd.exe often emits OEM/ANSI, not UTF-8.
_GBK_ACCESS_DENIED = b"\xbe\xdc\xbe\xf8\xb7\xc3\xce\xca"


def _decode_subprocess_output(data: bytes | None) -> str:
    """Decode child stdout/stderr. Windows cmd often writes GBK, not UTF-8."""
    if not data:
        return ""
    if platform.system() == "Windows":
        for enc in ("utf-8", "gbk", "cp936", "mbcs"):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
    return data.decode("utf-8", errors="replace")


def _looks_like_win_access_denied_output(text: str) -> bool:
    low = (text or "").lower()
    if (
        "winerror 5" in low
        or "access is denied" in low
        or "拒绝访问" in (text or "")
    ):
        return True
    # UTF-8 mis-decode of GBK 拒绝访问 collapses to U+FFFD replacement chars.
    if text and "\ufffd" in text and len(text.strip()) <= 24:
        compact = "".join(ch for ch in text if not ch.isspace())
        if compact.count("\ufffd") >= 3 and len(compact) <= 16:
            return True
    return False


def _looks_like_win_access_denied_bytes(data: bytes | None) -> bool:
    if not data:
        return False
    low = data.lower()
    if b"access is denied" in low or b"winerror 5" in low:
        return True
    if _GBK_ACCESS_DENIED in data:
        return True
    return False


def _should_prefer_node_shell_trampoline() -> bool:
    """Prefer Node→powershell only when direct CreateProcess is known-blocked.

    Desktop Gateway now defaults to python.exe (not pythonw) so powershell can
    spawn directly. Force the trampoline when:
    - OPENDRSAI_SHELL_NODE_TRAMPOLINE=1 (explicit), or
    - the runtime is still pythonw.exe (legacy / OPENDRSAI_GATEWAY_PYTHONW=1).
    Cached Access Denied flips _PS_SPAWN_PREFER_NODE separately.
    """
    if platform.system() != "Windows":
        return False
    if os.environ.get("OPENDRSAI_SHELL_NODE_TRAMPOLINE") == "1":
        return True
    import sys

    return Path(sys.executable).name.lower() in {"pythonw.exe", "pythonw"}


# Cache: once we observe Access Denied for direct powershell, skip straight to Node.
_PS_SPAWN_PREFER_NODE: list[bool] = [False]


def _win_subprocess_spawn_variants(base_kwargs: dict) -> list[dict]:
    """Ordered CreateProcess kwargs to try when spawning shell tools on Windows.

    Desktop gateway runs under Electron and is often assigned to a Job Object.
    Endpoint security (e.g. Sangfor) may also deny pythonw→powershell. The first
    attempt keeps the normal hidden-console flags; later attempts break away
    and/or drop CREATE_NO_WINDOW so WinError 5 does not permanently block
    Agent tool execution.
    """
    variants = [dict(base_kwargs)]
    if platform.system() != "Windows":
        return variants

    breakaway = dict(base_kwargs)
    flags = int(breakaway.get("creationflags") or 0) | _CREATE_BREAKAWAY_FROM_JOB
    breakaway["creationflags"] = flags
    variants.append(breakaway)

    visible = dict(base_kwargs)
    visible.pop("startupinfo", None)
    visible_flags = int(visible.get("creationflags") or 0)
    visible_flags = (visible_flags & ~subprocess.CREATE_NO_WINDOW) | _CREATE_BREAKAWAY_FROM_JOB
    if visible_flags:
        visible["creationflags"] = visible_flags
    else:
        visible.pop("creationflags", None)
    variants.append(visible)

    # De-dupe while preserving order.
    unique: list[dict] = []
    seen: set[tuple] = set()
    for item in variants:
        key = (
            int(item.get("creationflags") or 0),
            "startupinfo" in item,
            item.get("cwd"),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def _wmi_create_process(command_line: str, cwd: Optional[str] = None) -> int:
    """Create a process via WMI so parent is WmiPrvSE, not the Electron job tree.

    Endpoint agents that deny CreateProcess(powershell) from pythonw under
    Electron often still allow Win32_Process.Create. Returns the new PID.
    """
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    locator = win32com.client.Dispatch("WbemScripting.SWbemLocator")
    service = locator.ConnectServer(".", r"root\cimv2")
    process = service.Get("Win32_Process")
    in_params = process.Methods_("Create").InParameters.SpawnInstance_()
    in_params.CommandLine = command_line
    if cwd:
        in_params.CurrentDirectory = cwd
    startup = service.Get("Win32_ProcessStartup").SpawnInstance_()
    startup.Properties_("ShowWindow").Value = 0  # SW_HIDE
    in_params.ProcessStartupInformation = startup
    out_params = process.ExecMethod_("Create", in_params)
    return_value = int(out_params.Properties_("ReturnValue").Value)
    if return_value != 0:
        raise OSError(return_value, f"WMI Win32_Process.Create failed (ReturnValue={return_value})")
    return int(out_params.Properties_("ProcessId").Value)


def _resolve_spawn_cwd(cwd: Optional[str]) -> str:
    """Prefer a non-Temp cwd; endpoint agents often deny shells started under Temp."""
    if cwd and Path(cwd).exists():
        return str(Path(cwd).resolve())
    home = str(Path.home())
    if Path(home).exists():
        return home
    return os.environ.get("SystemRoot", r"C:\Windows") + r"\System32"


def _windows_path_dirs_from_registry() -> list[Path]:
    """Return Machine+User PATH entries (endpoint-stripped process PATH often omits these)."""
    if platform.system() != "Windows":
        return []
    dirs: list[Path] = []
    try:
        import winreg
    except ImportError:
        return dirs

    for root, subkey in (
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        (winreg.HKEY_CURRENT_USER, r"Environment"),
    ):
        try:
            with winreg.OpenKey(root, subkey) as key:
                raw, _ = winreg.QueryValueEx(key, "Path")
        except OSError:
            continue
        for part in str(raw or "").split(";"):
            part = part.strip().strip('"')
            if not part:
                continue
            expanded = os.path.expandvars(part)
            if expanded:
                dirs.append(Path(expanded))
    return dirs


def _detect_node_executable() -> Optional[str]:
    """Locate node.exe for Access Denied trampolines (same pattern as desktop .cmd)."""
    for name in ("node", "node.exe"):
        found = shutil.which(name)
        if found:
            return found

    candidates: list[Path] = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "nodejs" / "node.exe",
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "nodejs" / "node.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "node" / "node.exe",
    ]
    for entry in _windows_path_dirs_from_registry():
        candidates.append(entry / "node.exe")

    # Last resort: common WinGet OpenJS.NodeJS package roots.
    local_app = Path(os.environ.get("LOCALAPPDATA", ""))
    winget_root = local_app / "Microsoft" / "WinGet" / "Packages"
    if winget_root.is_dir():
        try:
            for pkg in winget_root.glob("OpenJS.NodeJS*"):
                for node_exe in pkg.glob("node-*/node.exe"):
                    candidates.append(node_exe)
                    break
        except OSError:
            pass

    seen: set[str] = set()
    for candidate in candidates:
        try:
            resolved = str(candidate.resolve()) if candidate.exists() else ""
        except OSError:
            continue
        if not resolved or resolved in seen:
            continue
        seen.add(resolved)
        if Path(resolved).is_file():
            return resolved
    return None


def _is_powershell_executable(exe: str) -> bool:
    low = str(exe or "").lower()
    return low.endswith("powershell.exe") or low.endswith("pwsh.exe") or low in {
        "powershell", "powershell.exe", "pwsh", "pwsh.exe",
    }


def _run_via_wmi_file_capture(
    exe: str,
    argv: list[str],
    *,
    cwd: Optional[str],
    timeout: float,
) -> tuple[int, str, str]:
    """Run exe+argv through WMI with stdout/stderr captured to temp files."""
    import tempfile
    import time

    tmp_dir = Path(tempfile.mkdtemp(prefix="drsai_wmi_"))
    out_path = tmp_dir / "out.txt"
    err_path = tmp_dir / "err.txt"
    code_path = tmp_dir / "code.txt"
    process_cwd = _resolve_spawn_cwd(cwd)
    try:
        # Prefer creating the target exe directly. A cmd.exe trampoline that then
        # starts powershell.exe is often still denied by endpoint agents even when
        # the parent is WmiPrvSE (cmd→powershell CreateProcess hooks).
        if _is_powershell_executable(exe):
            wrap_ps1 = tmp_dir / "wrap.ps1"
            # Capture all streams inside PowerShell — CreateProcess has no redirects.
            wrap_ps1.write_text(
                "\r\n".join(
                    [
                        "$ErrorActionPreference = 'Continue'",
                        f"$outFile = {repr(str(out_path))}",
                        f"$errFile = {repr(str(err_path))}",
                        f"$codeFile = {repr(str(code_path))}",
                        "$argv = @(",
                        *[f"  {repr(arg)}" for arg in argv],
                        ")",
                        "try {",
                        f"  $p = Start-Process -FilePath {repr(str(exe))} -ArgumentList $argv "
                        "-NoNewWindow -Wait -PassThru "
                        "-RedirectStandardOutput $outFile -RedirectStandardError $errFile",
                        "  $code = if ($null -eq $p.ExitCode) { 1 } else { $p.ExitCode }",
                        "} catch {",
                        "  $_ | Out-File -FilePath $errFile -Encoding utf8",
                        "  $code = 1",
                        "}",
                        "Set-Content -Path $codeFile -Value $code -Encoding ascii",
                    ]
                )
                + "\r\n",
                encoding="utf-8",
            )
            # WmiPrvSE → powershell (wrapper) → Start-Process target. The outer
            # powershell is often allowlisted when pythonw/Electron are not.
            command_line = subprocess.list2cmdline(
                [exe, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(wrap_ps1)]
            )
        else:
            bat_path = tmp_dir / "run.cmd"
            bat_lines = [
                "@echo off",
                "setlocal",
                f"cd /d {subprocess.list2cmdline([process_cwd])}",
                (
                    f"{subprocess.list2cmdline([exe, *argv])} "
                    f"> {subprocess.list2cmdline([str(out_path)])} "
                    f"2> {subprocess.list2cmdline([str(err_path)])}"
                ),
                "set RC=%ERRORLEVEL%",
                f"> {subprocess.list2cmdline([str(code_path)])} echo %RC%",
            ]
            bat_path.write_text("\r\n".join(bat_lines) + "\r\n", encoding="utf-8")
            command_line = f"cmd.exe /d /c {subprocess.list2cmdline([str(bat_path)])}"
        pid = _wmi_create_process(command_line, process_cwd)
        deadline = time.monotonic() + max(1.0, float(timeout))
        while time.monotonic() < deadline:
            try:
                import ctypes

                SYNCHRONIZE = 0x00100000
                handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, int(pid))
                if handle:
                    wait = ctypes.windll.kernel32.WaitForSingleObject(handle, 200)
                    ctypes.windll.kernel32.CloseHandle(handle)
                    if wait == 0:  # WAIT_OBJECT_0 — exited
                        break
                else:
                    if code_path.exists():
                        break
                    time.sleep(0.1)
            except Exception:
                time.sleep(0.2)
                if code_path.exists():
                    break
        else:
            try:
                _kill_process_tree(pid)
            except Exception:
                pass
            raise TimeoutError(f"WMI-spawned process {pid} timed out after {timeout}s")

        time.sleep(0.05)
        stdout = out_path.read_text(encoding="utf-8", errors="replace") if out_path.exists() else ""
        stderr = err_path.read_text(encoding="utf-8", errors="replace") if err_path.exists() else ""
        code_text = code_path.read_text(encoding="utf-8", errors="replace").strip() if code_path.exists() else "1"
        try:
            returncode = int(code_text.splitlines()[-1].strip())
        except Exception:
            returncode = 1
        if _looks_like_win_access_denied_output(stdout + stderr):
            raise OSError(5, "Access is denied (WMI child reported 拒绝访问)")
        return returncode, stdout, stderr
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


_NODE_TRAMPOLINE_JS = r"""
const fs = require('fs');
const {spawnSync} = require('child_process');
const req = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const r = spawnSync(req.exe, req.argv, {
  cwd: req.cwd || undefined,
  windowsHide: true,
  timeout: req.timeoutMs,
  maxBuffer: 32 * 1024 * 1024,
  env: process.env,
});
const out = r.stdout || Buffer.alloc(0);
const errParts = [];
if (r.stderr && r.stderr.length) errParts.push(r.stderr);
if (r.error) errParts.push(Buffer.from(String(r.error.message || r.error), 'utf8'));
fs.writeFileSync(req.out, out);
fs.writeFileSync(req.err, Buffer.concat(errParts));
let code = 1;
if (r.status !== null && r.status !== undefined) code = r.status;
else if (r.error && r.error.code === 'ETIMEDOUT') code = 124;
else if (r.signal) code = 1;
fs.writeFileSync(req.code, String(code));
process.exit(0);
"""


def _run_via_node_file_capture(
    exe: str,
    argv: list[str],
    *,
    cwd: Optional[str],
    timeout: float,
) -> tuple[int, str, str]:
    """Run exe+argv via node child_process when CreateProcess is blocked for this parent.

    Matches apps/desktop/windows-desktop-dev.cmd: on machines where cmd/pythonw→
    powershell is denied (WinError 5), node→powershell is often still allowed.
    """
    import json
    import tempfile

    node = _detect_node_executable()
    if not node:
        raise FileNotFoundError("node.exe not found for Access Denied trampoline")

    process_cwd = _resolve_spawn_cwd(cwd)
    tmp_dir = Path(tempfile.mkdtemp(prefix="drsai_node_"))
    try:
        req_path = tmp_dir / "req.json"
        out_path = tmp_dir / "out.bin"
        err_path = tmp_dir / "err.bin"
        code_path = tmp_dir / "code.txt"
        js_path = tmp_dir / "run.js"
        req_path.write_text(
            json.dumps(
                {
                    "exe": exe,
                    "argv": list(argv),
                    "cwd": process_cwd,
                    "timeoutMs": int(max(1.0, float(timeout)) * 1000),
                    "out": str(out_path),
                    "err": str(err_path),
                    "code": str(code_path),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        js_path.write_text(_NODE_TRAMPOLINE_JS, encoding="utf-8")

        # Spawn node with the same hide/breakaway variants used for shells.
        node_argv = [node, str(js_path), str(req_path)]
        hide = _win_subprocess_hide_kwargs()
        last_error: BaseException | None = None
        completed = False
        for variant in _win_subprocess_spawn_variants(
            {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "stdin": subprocess.DEVNULL,
                "cwd": process_cwd,
                **hide,
            }
        ):
            try:
                result = subprocess.run(
                    node_argv,
                    timeout=max(5.0, float(timeout) + 5.0),
                    **variant,
                )
                completed = True
                if result.returncode not in (0, None) and not code_path.exists():
                    err = (result.stderr or b"").decode("utf-8", errors="replace")
                    raise OSError(result.returncode or 5, f"node trampoline failed: {err[:500]}")
                break
            except Exception as exc:
                last_error = exc
                if _is_win_access_denied(exc):
                    continue
                raise
        if not completed:
            raise last_error or OSError(5, "Access is denied (node trampoline)")

        stdout = out_path.read_bytes().decode("utf-8", errors="replace") if out_path.exists() else ""
        stderr = err_path.read_bytes().decode("utf-8", errors="replace") if err_path.exists() else ""
        code_text = code_path.read_text(encoding="utf-8", errors="replace").strip() if code_path.exists() else "1"
        try:
            returncode = int(code_text.splitlines()[-1].strip())
        except Exception:
            returncode = 1
        if _looks_like_win_access_denied_output(stdout + stderr):
            raise OSError(5, "Access is denied (node child reported 拒绝访问)")
        return returncode, stdout, stderr
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


def _run_win_access_denied_fallbacks(
    exe: str,
    argv: list[str],
    *,
    cwd: Optional[str],
    timeout: float,
) -> tuple[int, str, str, str]:
    """Try Node and/or WMI trampolines. Returns (code, stdout, stderr, via_label).

    For powershell.exe, prefer Node first: many endpoint agents deny
    cmd/pythonw→powershell (and even WMI cmd trampolines) while still allowing
    node→powershell — same escalation as windows-desktop-dev.cmd.
    """
    errors: list[str] = []
    steps: list[tuple[str, Any]] = []
    if _is_powershell_executable(exe):
        steps = [("node-trampoline", _run_via_node_file_capture), ("wmi-fallback", _run_via_wmi_file_capture)]
    else:
        steps = [("wmi-fallback", _run_via_wmi_file_capture), ("node-trampoline", _run_via_node_file_capture)]

    for label, runner in steps:
        try:
            code, out, err = runner(exe, argv, cwd=cwd, timeout=timeout)
            return code, out, err, label
        except Exception as exc:
            errors.append(f"{label}:{exc}")
    raise OSError(5, "Access is denied (" + "; ".join(errors) + ")")


async def _create_subprocess_exec_with_win_fallback(
    *args: str,
    **kwargs,
):
    """Spawn a process, retrying Windows Access Denied with alternate flags."""
    variants = _win_subprocess_spawn_variants(kwargs)
    last_error: BaseException | None = None
    for index, variant in enumerate(variants):
        try:
            return await asyncio.create_subprocess_exec(*args, **variant)
        except Exception as exc:
            last_error = exc
            if index + 1 < len(variants) and _is_win_access_denied(exc):
                continue
            # Fall through to cmd trampoline / sync when Access Denied exhausted.
            if not _is_win_access_denied(exc):
                raise
            break

    if platform.system() == "Windows" and args:
        # Many endpoint agents deny pythonw→powershell but allow pythonw→cmd.
        exe = args[0]
        is_ps = _is_powershell_executable(str(exe))
        if is_ps:
            cmd_path = os.environ.get("ComSpec") or r"C:\Windows\System32\cmd.exe"
            wrapped = (cmd_path, "/d", "/s", "/c", subprocess.list2cmdline(list(args)))
            cmd_variants = _win_subprocess_spawn_variants(kwargs)
            for index, variant in enumerate(cmd_variants):
                try:
                    return await asyncio.create_subprocess_exec(*wrapped, **variant)
                except Exception as exc:
                    last_error = exc
                    if index + 1 < len(cmd_variants) and _is_win_access_denied(exc):
                        continue
                    if not _is_win_access_denied(exc):
                        raise
                    break

        # Sync CreateProcess in a worker thread (different code path than asyncio).
        def _sync_popen():
            sync_kwargs = {
                k: v for k, v in kwargs.items()
                if k in {"cwd", "env", "startupinfo", "creationflags"}
            }
            sync_kwargs["stdout"] = subprocess.PIPE
            sync_kwargs["stderr"] = subprocess.PIPE
            sync_kwargs["stdin"] = subprocess.DEVNULL
            for variant in _win_subprocess_spawn_variants(sync_kwargs):
                try:
                    return subprocess.Popen(list(args), **variant)
                except Exception as exc:
                    if _is_win_access_denied(exc):
                        continue
                    raise
            if is_ps:
                cmd_path = os.environ.get("ComSpec") or r"C:\Windows\System32\cmd.exe"
                wrapped = [cmd_path, "/d", "/s", "/c", subprocess.list2cmdline(list(args))]
                for variant in _win_subprocess_spawn_variants(sync_kwargs):
                    try:
                        return subprocess.Popen(wrapped, **variant)
                    except Exception as exc:
                        if _is_win_access_denied(exc):
                            continue
                        raise
            raise last_error or OSError(5, "Access is denied")

        try:
            popen = await asyncio.to_thread(_sync_popen)

            class _ThreadProcessAdapter:
                def __init__(self, proc: subprocess.Popen):
                    self._proc = proc
                    self.pid = proc.pid
                    self.returncode = None

                async def communicate(self):
                    stdout, stderr = await asyncio.to_thread(self._proc.communicate)
                    self.returncode = self._proc.returncode
                    return stdout, stderr

            return _ThreadProcessAdapter(popen)
        except Exception as exc:
            last_error = exc
            if not _is_win_access_denied(exc):
                raise

    assert last_error is not None
    raise last_error


def _windows_python_executable() -> str:
    import sys

    current = Path(sys.executable)
    if current.name.lower() == "pythonw.exe":
        sibling = current.with_name("python.exe")
        if sibling.exists():
            return str(sibling)
    return sys.executable


def _parse_direct_python_command(command: str) -> Optional[list[str]]:
    """Return argv for a direct python.exe spawn, or None if not a python command.

    Skill workflows (pptx create/validate/render) almost always invoke
    ``python script.py ...``. Running those through PowerShell on Desktop is
    both slower and more likely to hit endpoint CreateProcess blocks.
    """
    import shlex
    import sys

    text = (command or "").strip()
    if not text:
        return None
    # Reject obvious PowerShell pipelines / multi-statements.
    if any(token in text for token in ("|", ";", "&&", "||", "`", "\n")):
        return None
    try:
        # Agent commands use shell-style quoting; posix=True strips quotes the
        # way Python expects for ``-c`` payloads even on Windows.
        parts = shlex.split(text, posix=True)
    except ValueError:
        return None
    if not parts:
        return None
    launcher = parts[0].lower().rstrip(".exe")
    if launcher not in {"python", "python3", "py"}:
        return None
    # Prefer the runtime interpreter over whatever "python" resolves to on PATH.
    exe = _windows_python_executable() if sys.platform == "win32" else sys.executable
    return [exe, *parts[1:]]


async def _run_direct_python_command(
    argv: list[str],
    *,
    cwd: Optional[str],
    timeout: float,
) -> tuple[int, str]:
    hide = _win_subprocess_hide_kwargs()
    kwargs = {
        "stdout": asyncio.subprocess.PIPE,
        "stderr": asyncio.subprocess.PIPE,
        "stdin": asyncio.subprocess.DEVNULL,
        **hide,
    }
    if cwd:
        kwargs["cwd"] = cwd
    proc = await _create_subprocess_exec_with_win_fallback(*argv, **kwargs)
    async with asyncio.timeout(timeout):
        stdout, stderr = await proc.communicate()
    raw = _decode_subprocess_output(stdout) + _decode_subprocess_output(stderr)
    return int(proc.returncode or 0), raw


def _detect_powershell() -> Optional[str]:
    """Detect available PowerShell executable (pwsh or powershell)."""
    global _POWERSHELL_PATH_CACHE

    if _POWERSHELL_PATH_CACHE is not None:
        return _POWERSHELL_PATH_CACHE if _POWERSHELL_PATH_CACHE else None

    # Prefer the absolute System32 host on Windows. A bare "powershell" name is
    # sometimes denied by endpoint CreateProcess hooks (WinError 5 / 拒绝访问).
    if platform.system() == "Windows":
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        system_ps = Path(system_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        if system_ps.exists():
            _POWERSHELL_PATH_CACHE = str(system_ps)
            return _POWERSHELL_PATH_CACHE

    # Try PowerShell Core (cross-platform)
    pwsh_path = shutil.which("pwsh")
    if pwsh_path:
        _POWERSHELL_PATH_CACHE = pwsh_path
        return pwsh_path

    # Fall back to Windows PowerShell on PATH
    if platform.system() == "Windows":
        ps_path = shutil.which("powershell.exe") or shutil.which("powershell")
        if ps_path:
            _POWERSHELL_PATH_CACHE = ps_path
            return ps_path

    # No PowerShell found
    _POWERSHELL_PATH_CACHE = False
    return None


def _kill_process_tree(pid: int) -> bool:
    """Kill a process and its children, cross-platform.

    On Windows: uses ``taskkill /F /T /PID`` for tree kill.
    On Unix: uses ``os.killpg`` for process group kill, falls back to ``os.kill``.

    Returns True if the kill was successful (or process already gone).
    """
    try:
        if platform.system() == "Windows":
            result = subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True, timeout=5,
                **_win_subprocess_hide_kwargs(),
            )
            return result.returncode == 0 or "not found" in (result.stderr or "").lower()
        else:
            # Unix: try process group kill first
            try:
                pgid = os.getpgid(pid)
                os.killpg(pgid, signal.SIGTERM)
                time.sleep(2)
                try:
                    os.killpg(pgid, 0)  # Check if still alive
                    os.killpg(pgid, signal.SIGKILL)  # Force kill
                except ProcessLookupError:
                    pass  # Already dead
                return True
            except ProcessLookupError:
                # Process group not found, try direct kill
                try:
                    os.kill(pid, signal.SIGTERM)
                    time.sleep(2)
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    return True
                except ProcessLookupError:
                    return True  # Already dead
    except Exception as e:
        return False


# TODO: 增加前台运行
def get_operator_funcs(
        worker_dir: str|Path,
        thread_id: str,
        extra_dirs: list[str|Path] = None,
        only_in_workspace: bool = True,
        is_powershell: bool = False,
        allolow_dangrous_cmd: bool = False,
        storage_dir: str|Path = None,
        )->list[callable]:

    WORKDIR = Path(worker_dir).resolve()
    ALLOWED_DIRS = [WORKDIR] + [Path(d).resolve() for d in (extra_dirs or [])]

    # Mutable workspace-restriction flag (list wrapper so closures can read/write)
    # Toggle from CLI via /workspace on|off  — all tool functions consult this list.
    _only_in_workspace = [only_in_workspace]

    # Mutable dangerous-command flag (list wrapper so closures can read/write)
    # When _dangerous_allowed[0] = True: _DANGEROUS_PATTERNS check is skipped
    # When _dangerous_allowed[0] = False: both _DANGEROUS_PATTERNS and _SCRIPT_EXEC_PATTERNS are enforced
    # Toggle from CLI via /dangerous on|off
    _dangerous_allowed = [allolow_dangrous_cmd]

    async def _request_dangerous_approval(cmd: str, kind: str) -> bool:
        """Block until the UI user approves / denies a flagged command.

        ``kind`` is one of ``"dangerous"`` / ``"script"`` — only used to label
        the prompt that the UI shows.

        Returns ``True`` if the user explicitly approved this single
        execution. Any other outcome (deny, timeout, no UI bound, callback
        not available because we are running headless / under the legacy
        REPL) returns ``False`` so the caller falls back to the previous
        hard-block behavior.

        The callback itself is a blocking ``threading.Event.wait`` call
        inside ``server._block`` — we MUST wrap it in ``asyncio.to_thread``
        so it does not freeze the agent's event loop while the user is
        thinking about whether to approve.
        """
        # Lazy import — operater_funs is a generic module and must not
        # hard-depend on the tui_gateway adapter. If the import fails we
        # are running outside the TUI gateway (legacy REPL, unit test,
        # standalone use); fall back to the original hard-block.
        try:
            from drsai.backend.tui_gateway.adapter.callbacks import (
                approval_callback,
            )
        except Exception:
            return False

        label = (
            "Dangerous shell command"
            if kind == "dangerous"
            else "Script execution"
        )
        try:
            response = await asyncio.to_thread(
                approval_callback,
                command=cmd,
                description=(
                    f"{label} flagged by safety rules. Approve once to run "
                    "this single command. To grant the agent blanket "
                    "permission for the rest of this session, deny here "
                    "and then run /dangerous on at the prompt."
                ),
                choices=["approve", "deny"],
                timeout=300,
            )
        except Exception:
            # Network drop, UI process exited, etc. — fail closed.
            return False
        return response == "approve"

    # Initialize persistence manager — use storage_dir for internal files if provided,
    # otherwise fall back to WORKDIR (the tool workspace).
    _persistence_dir = Path(storage_dir).resolve() if storage_dir else WORKDIR
    task_persistence = BashTaskPersistence(worker_dir=_persistence_dir, thread_id=thread_id)

    def safe_path(p: str) -> Path:
        """Ensure path stays within workspace or allowed directories."""
        resolved = Path(p).resolve()
        # If path is absolute, check directly against allowed dirs
        if Path(p).is_absolute():
            if _only_in_workspace[0] and not any(resolved.is_relative_to(d) for d in ALLOWED_DIRS):
                raise ValueError(f"Path escapes workspace: {p}")
            return resolved
        # Relative path: resolve against WORKDIR
        path = (WORKDIR / p).resolve()
        if _only_in_workspace[0] and not any(path.is_relative_to(d) for d in ALLOWED_DIRS):
            raise ValueError(f"Path escapes workspace: {p}")
        return path

    def _check_cmd_paths(cmd: str) -> str | None:
        """Return an error string if any absolute path in cmd escapes allowed dirs, else None.
        
        Checks both Unix-style paths (/foo/bar) and Windows-style paths (C:\\foo\\bar).
        """
        # Check Unix-style absolute paths
        for match in _ABS_PATH_RE.finditer(cmd):
            raw = match.group(1).rstrip('/')
            if not raw:
                continue
            try:
                resolved = Path(raw).resolve()
            except Exception:
                continue
            if not any(resolved.is_relative_to(d) for d in ALLOWED_DIRS):
                return f"Error: Path '{raw}' is outside the allowed workspace"

        # Check Windows-style absolute paths (C:\, D:\, etc.)
        for match in _WIN_ABS_PATH_RE.finditer(cmd):
            raw = match.group(1)
            try:
                resolved = Path(raw).resolve()
            except Exception:
                continue
            if not any(resolved.is_relative_to(d) for d in ALLOWED_DIRS):
                return f"Error: Path '{raw}' is outside the allowed workspace"

        return None

    # Mutable current directory state (persists across exec calls)
    _cwd = [WORKDIR]

    # Background tasks storage - load from persistent storage on initialization
    _bash_tasks = task_persistence.load_all_tasks()

    # Clean up old completed tasks (older than 7 days)
    task_persistence.cleanup_old_tasks(max_age_days=7)

    async def read(path: str, minilimit: int = None, maxlimit: int = -1, timeout: float = 30.0) -> str:
        """
        Read file contents.
        """
        try:
            fp = safe_path(path)
            async with asyncio.timeout(timeout):
                if os.name == "nt":
                    # Lazy import avoids coupling Agent module initialization to
                    # backend package initialization; the Tool contract stays unchanged.
                    from drsai.backend.runtime.security_boundary.filesystem import WindowsWorkspaceFilesystem
                    roots = [root for root in ALLOWED_DIRS if fp.is_relative_to(root)]
                    if not roots:
                        raise ValueError(f"Path escapes workspace: {path}")
                    root = max(roots, key=lambda value: len(value.parts))
                    relative = fp.relative_to(root).as_posix()
                    if relative.split("/", 1)[0].casefold() in {
                        ".git", ".agents", ".codex", ".opendrsai-trash",
                    }:
                        raise ValueError("Agent control paths cannot be read")
                    raw = await asyncio.to_thread(
                        WindowsWorkspaceFilesystem(root).read_bytes,
                        relative,
                        max_bytes=16 * 1024 * 1024,
                    )
                    text = raw.decode("utf-8")
                else:
                    async with aiofiles.open(fp, 'r', encoding='utf-8') as f:
                        text = await f.read()
                lines = text.splitlines()
                if minilimit:
                    lines = lines[minilimit:maxlimit]
                return "\n".join(lines)
        except asyncio.TimeoutError:
            return f"Error: Read operation timed out after {timeout}s"
        except Exception as e:
            return f"Error: {e}"


    async def write(path: str, content: str, timeout: float = 30.0) -> str:
        """
        Write content to file.
        """
        try:
            # Check content size before writing
            content_size_mb = len(content.encode('utf-8')) / (1024 * 1024)
            
            fp = safe_path(path)
            # Create parent directories synchronously (quick operation)
            fp.parent.mkdir(parents=True, exist_ok=True)

            async with asyncio.timeout(timeout):
                async with aiofiles.open(fp, 'w', encoding='utf-8') as f:
                    await f.write(content)
                    return f"Wrote {len(content)} bytes ({content_size_mb:.2f}MB) to {path}"
                    
        except asyncio.TimeoutError:
            return f"Error: Write operation timed out after {timeout}s (file may be partially written)"
        except Exception as e:
            return f"Error: {e}"


    async def edit(path: str, old_text: str, new_text: str, timeout: float = 30.0) -> str:
        """
        Replace exact text in file.
        """
        import unicodedata

        def _normalise(s: str) -> str:
            """Normalise to NFC + Unix line endings for robust matching."""
            s = unicodedata.normalize("NFC", s)
            return s.replace("\r\n", "\n").replace("\r", "\n")

        try:
            fp = safe_path(path)

            async with asyncio.timeout(timeout):
                # Read operation
                async with aiofiles.open(fp, 'r', encoding='utf-8') as f:
                    text = await f.read()

                if old_text in text:
                    # Write operation
                    new_content = text.replace(old_text, new_text, 1)
                    async with aiofiles.open(fp, 'w', encoding='utf-8') as f:
                        await f.write(new_content)

                    return f"Edited {path}"

                # Unicode-normalised match (NFC + newline normalisation)
                norm_text = _normalise(text)
                norm_old = _normalise(old_text)
                norm_new = _normalise(new_text)

                if norm_old in norm_text:
                    norm_result = norm_text.replace(norm_old, norm_new, 1)
                    async with aiofiles.open(fp, 'w', encoding='utf-8') as f:
                        await f.write(norm_result)

                    return f"Edited {path} (Unicode-normalised match)"

                return f"Error: Text not found in {path}"

        except asyncio.TimeoutError:
            return f"Error: Operation timed out after {timeout}s (file may be partially written)"

        except Exception as e:
            return f"Error: {e}"


    async def grep(
        pattern: str,
        path: str = None,
        glob: str = None,
        mode: str = "files",
        context: int = 0,
        case_insensitive: bool = False,
        max_results: int = 100,
    ) -> str:
        """Search files for a regular expression.

        Use this to locate symbols, text, or references before reading files.
        By default it returns matching file paths. Set ``mode`` to ``content``
        for matching lines or ``count`` for per-file match counts.

        Args:
            pattern: Regular expression to search for.
            path: File or directory to search; defaults to the workspace root.
            glob: Optional comma-separated file patterns, such as ``*.py``.
            mode: ``files``, ``content``, or ``count``.
            context: Number of context lines before and after each match.
            case_insensitive: Match without regard to letter case.
            max_results: Maximum number of returned lines or entries.
        """
        try:
            mode_map = {
                "files": "files_with_matches",
                "content": "content",
                "count": "count",
            }
            if mode not in mode_map:
                return "Error: mode must be one of: files, content, count"
            output_mode = mode_map[mode]
            context_before = max(0, context)
            context_after = max(0, context)
            show_line_numbers = mode == "content"

            # Resolve search path once — safe_path may raise ValueError if
            # the path escapes the workspace; that propagates as a clean error.
            search_path = str(safe_path(path)) if path else str(WORKDIR)
            _hide_kwargs = _win_subprocess_hide_kwargs()

            # ── Tool availability checks (each guarded so a missing binary
            #    sets the flag to False instead of raising FileNotFoundError) ──

            rg_bin = shutil.which("rg")          # None if not installed
            rg_available = False
            if rg_bin:
                try:
                    rg_check = await asyncio.create_subprocess_exec(
                        rg_bin, "--version",
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        **_hide_kwargs,
                    )
                    await rg_check.communicate()
                    rg_available = rg_check.returncode == 0
                except Exception:
                    rg_available = False

            grep_available = False
            if not rg_available and platform.system() != "Windows":
                grep_bin = shutil.which("grep")
                if grep_bin:
                    try:
                        grep_check = await asyncio.create_subprocess_exec(
                            grep_bin, "--version",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )
                        await grep_check.communicate()
                        grep_available = grep_check.returncode == 0
                    except Exception:
                        grep_available = False

            output = None  # set by whichever provider succeeds

            # ── 1. ripgrep ──────────────────────────────────────────────
            if rg_available:
                try:
                    cmd = [rg_bin, "--hidden", "--max-columns", "500"]

                    # Output mode
                    if output_mode == "files_with_matches":
                        cmd.append("-l")
                    elif output_mode == "count":
                        cmd.append("-c")

                    # Options
                    if case_insensitive:
                        cmd.append("-i")
                    if show_line_numbers and output_mode == "content":
                        cmd.append("-n")

                    # Context
                    if context_before > 0 and output_mode == "content":
                        cmd.extend(["-B", str(context_before)])
                    if context_after > 0 and output_mode == "content":
                        cmd.extend(["-A", str(context_after)])

                    # Glob pattern
                    if glob:
                        for pattern_item in glob.split(","):
                            cmd.extend(["--glob", pattern_item.strip()])

                    # Pattern + search path
                    cmd.append(pattern)
                    cmd.append(search_path)

                    proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        **_hide_kwargs,
                    )

                    async with asyncio.timeout(30):
                        stdout, stderr = await proc.communicate()
                        # errors='replace' prevents UnicodeDecodeError when
                        # rg outputs bytes in a non-UTF-8 encoding (e.g. GBK
                        # on Chinese Windows with --max-columns truncation).
                        output = stdout.decode('utf-8', errors='replace')

                except Exception:
                    # rg failed (e.g. invalid regex, timeout, encoding) —
                    # fall through to the next provider instead of crashing.
                    output = None

            # ── 2. GNU grep (Unix only, fast) ────────────────────────────
            #   PowerShell Select-String was removed: it is ~10× slower than
            #   the Python re fallback due to PS process startup + pipeline
            #   object serialization overhead.  On Windows without ripgrep,
            #   the optimized Python fallback (section 3) is dramatically
            #   faster than spawning a PowerShell child process.
            if output is None and grep_available:
                try:
                    cmd = [shutil.which("grep"), "-r"]
                    if case_insensitive:
                        cmd.append("-i")
                    if show_line_numbers:
                        cmd.append("-n")
                    if output_mode == "files_with_matches":
                        cmd.append("-l")
                    elif output_mode == "count":
                        cmd.append("-c")

                    if context_before > 0:
                        cmd.extend(["-B", str(context_before)])
                    if context_after > 0:
                        cmd.extend(["-A", str(context_after)])

                    if glob:
                        cmd.extend(["--include", glob])

                    cmd.extend([pattern, search_path])

                    proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )

                    async with asyncio.timeout(30):
                        stdout, stderr = await proc.communicate()
                        output = stdout.decode('utf-8', errors='replace')

                except Exception:
                    output = None

            # ── 3. Optimized Python re fallback (always available) ──────
            #   Uses os.scandir (faster than pathlib.rglob), skips binary
            #   files by extension + null-byte detection, skips common
            #   ignore directories, uses mmap for large files, and
            #   terminates early at max_results.
            if output is None:

                def _pygrep_sync():
                    import re as re_lib
                    import fnmatch as fnmatch_lib
                    import os as os_lib
                    import mmap as mmap_lib

                    _BINARY_EXTS = frozenset({
                        '.pyc', '.pyo', '.exe', '.dll', '.so', '.dylib', '.bin',
                        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
                        '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar', '.bz2',
                        '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flv',
                        '.o', '.a', '.lib', '.obj', '.class', '.jar', '.war',
                        '.wasm', '.dat', '.db', '.sqlite', '.pdb', '.node',
                    })
                    _SKIP_DIRS = frozenset({
                        '__pycache__', 'node_modules', '.git', '.svn', '.hg',
                        'venv', '.venv', 'env', '.env', '.tox', '.mypy_cache',
                        '.pytest_cache', '.ruff_cache', 'dist', 'build',
                    })
                    _MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
                    _MMAP_THRESHOLD = 64 * 1024  # Use mmap for files > 64KB
                    _BINARY_CHECK_SIZE = 8192  # Check first 8KB for null bytes

                    flags = re_lib.IGNORECASE if case_insensitive else 0
                    try:
                        compiled = re_lib.compile(pattern, flags)
                    except re_lib.error as e:
                        return f"Error: Invalid regex pattern: {e}"

                    results = []
                    glob_patterns = [g.strip() for g in glob.split(",")] if glob else None
                    base_str = search_path

                    def _matches_glob(name):
                        if not glob_patterns:
                            return True
                        return any(fnmatch_lib.fnmatch(name, gp) for gp in glob_patterns)

                    def _is_binary(ext, fpath):
                        if ext in _BINARY_EXTS:
                            return True
                        try:
                            with open(fpath, 'rb') as fb:
                                return b'\x00' in fb.read(_BINARY_CHECK_SIZE)
                        except (OSError, PermissionError):
                            return True  # skip on error

                    def _scan_file(fpath, name, size):
                        """Scan a single file for pattern matches."""
                        if not _matches_glob(name):
                            return
                        ext = os_lib.path.splitext(name)[1].lower()
                        if _is_binary(ext, fpath):
                            return

                        file_matches = []
                        try:
                            if size > _MMAP_THRESHOLD:
                                # mmap for large files: line-by-line without
                                # loading entire file into memory
                                with open(fpath, 'rb') as f:
                                    with mmap_lib.mmap(f.fileno(), 0, access=mmap_lib.ACCESS_READ) as mm:
                                        for i, raw_line in enumerate(iter(mm.readline, b''), 1):
                                            line = raw_line.decode('utf-8', errors='ignore').rstrip()
                                            if compiled.search(line):
                                                file_matches.append((i, line))
                                                if len(file_matches) >= max_results:
                                                    break
                            else:
                                with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                                    for i, line in enumerate(f, 1):
                                        if compiled.search(line):
                                            file_matches.append((i, line.rstrip()))
                                            if len(file_matches) >= max_results:
                                                break
                        except (OSError, PermissionError, ValueError):
                            return

                        if not file_matches:
                            return

                        rel = os_lib.path.relpath(fpath, base_str)

                        if output_mode == "files_with_matches":
                            results.append(rel)
                        elif output_mode == "count":
                            results.append(f"{rel}:{len(file_matches)}")
                        else:  # content mode
                            for ln, lt in file_matches[:max_results]:
                                results.append(f"{rel}:{ln}:{lt}" if show_line_numbers else f"{rel}:{lt}")

                    def _scan_dir(dir_path):
                        """Recursively scan directory using os.scandir."""
                        try:
                            with os_lib.scandir(dir_path) as entries:
                                for entry in entries:
                                    if len(results) >= max_results:
                                        return
                                    try:
                                        if entry.is_dir(follow_symlinks=False):
                                            if entry.name.startswith('.') or entry.name in _SKIP_DIRS:
                                                continue
                                            _scan_dir(entry.path)
                                        elif entry.is_file(follow_symlinks=False):
                                            stat = entry.stat()
                                            if stat.st_size == 0 or stat.st_size > _MAX_FILE_SIZE:
                                                continue
                                            _scan_file(entry.path, entry.name, stat.st_size)
                                    except (OSError, PermissionError):
                                        continue
                        except (OSError, PermissionError):
                            return

                    # Entry point: single file or directory scan
                    bp = Path(base_str)
                    if bp.is_file():
                        try:
                            stat = os_lib.stat(base_str)
                            _scan_file(base_str, os_lib.path.basename(base_str), stat.st_size)
                        except OSError:
                            pass
                    else:
                        _scan_dir(base_str)

                    return "\n".join(results) if results else ""

                output = await asyncio.get_event_loop().run_in_executor(None, _pygrep_sync)

            if not output:
                return "No matches found"

            # Limit results
            lines = output.strip().split("\n")
            if len(lines) > max_results:
                limited = "\n".join(lines[:max_results])
                return f"{limited}\n\n[Showing first {max_results} of {len(lines)} results]"

            return output.strip()[:5000]

        except asyncio.TimeoutError:
            return "Error: Search timeout"
        except Exception as e:
            return f"Error: {e}"

    async def bash_exec(
        command: str,
        timeout: float = 60,
    ) -> str:
        """Execute a Bash command asynchronously and wait for completion.

        **IMPORTANT: This is the default and preferred function for most shell commands.**
        timeout: Timeout in seconds (max: 120).

        Example workflow:
            1. Try: exec("npm test")  # Try synchronous first
            2. If timeout → Use: exec_background("npm test", timeout=300)
        """

        # Check dangerous patterns. If matched, prompt the UI user for a
        # single-shot approval before falling back to a hard block.
        # (Was previously a hard "return Error" — that meant the agent
        # never even got the chance to ask the user.)
        if not _dangerous_allowed[0] and _DANGEROUS_RE.search(command):
            if not await _request_dangerous_approval(command, "dangerous"):
                return (
                    "Error: Dangerous command denied by user. "
                    "Use /dangerous on to authorize for the rest of the session."
                )

        # Same for script-execution patterns.
        if not _dangerous_allowed[0] and _SCRIPT_EXEC_RE.search(command):
            if not await _request_dangerous_approval(command, "script"):
                return (
                    "Error: Script execution denied by user. "
                    "Use /dangerous on to authorize for the rest of the session."
                )

        # Check absolute paths referenced in command
        if _only_in_workspace[0]:
            path_err = _check_cmd_paths(command)
            if path_err:
                return path_err

        task_info = {
            "process": None,
            "pgid": None,
            "pid": None,
            "output": "",
            "error": "",
            "status": "running",
            "start_time": time.time(),
            "timeout": timeout,
        }
        try:
             # Append a sentinel so we can capture the resulting directory
            wrapped = f'{command}\necho "__DRSAI_CWD__:$(pwd)"'
            # Create new process group for proper cleanup
            proc = await asyncio.create_subprocess_shell(
                wrapped,
                cwd=str(_cwd[0]),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                preexec_fn=os.setsid  # Create new session
            )

            task_info["pid"] = proc.pid
            task_info["pgid"] = os.getpgid(proc.pid)

            # Wait with timeout
            try:
                async with asyncio.timeout(timeout):
                    stdout, stderr = await proc.communicate()
                    raw_output = (stdout.decode('utf-8') if stdout else '') + (stderr.decode('utf-8') if stderr else '')

                    # Parse output and update working directory
                    lines = raw_output.splitlines()
                    out_lines = []
                    for line in lines:
                        if line.startswith("__DRSAI_CWD__:"):
                            new_dir_str = line[len("__DRSAI_CWD__:"):].strip()
                            try:
                                new_dir = Path(new_dir_str).resolve()
                                # Update cwd based on workspace restriction setting
                                if _only_in_workspace[0]:
                                    # Only update if within allowed directories
                                    if any(new_dir.is_relative_to(d) for d in ALLOWED_DIRS):
                                        _cwd[0] = new_dir
                                    else:
                                        out_lines.append(
                                            f"Warning: cd target '{new_dir}' is outside workspace; cwd not updated"
                                        )
                                else:
                                    # Allow cd to any directory when workspace restriction is off
                                    _cwd[0] = new_dir
                            except Exception:
                                pass
                        else:
                            out_lines.append(line)

                    output = "\n".join(out_lines).strip() or "(no output)"
                    return output[:50000]

            except asyncio.TimeoutError:
                # Kill entire process group on timeout
                try:
                    # First try graceful termination
                    os.killpg(task_info["pgid"], signal.SIGTERM)
                    await asyncio.sleep(2)  # Grace period for clean shutdown

                    # Check if process group still exists
                    try:
                        os.killpg(task_info["pgid"], 0)  # Signal 0 checks existence
                        # Still alive, force kill
                        os.killpg(task_info["pgid"], signal.SIGKILL)
                    except ProcessLookupError:
                        pass  # Already terminated gracefully
                except ProcessLookupError:
                    pass  # Process group already gone
                except Exception as e:
                    return f"Error: Command timed out after {timeout}s and failed to kill process group: {e}"

                return f"Error: Command timed out after {timeout}s (all child processes terminated)"

        except Exception as e:
            return f"Error: {e}"
            

    async def bash_exec_background(
        command: str,
        timeout: float = 500.0,
        wait_time: float = 10.0,
    ) -> Union[str, Dict[str, Any]]:
        """Execute shell command with smart background mode for LONG-RUNNING tasks.

        **⚠️ WARNING: Use this function ONLY when:**
        1. exec() returned a timeout error, OR
        2. You know the command will take > 2 minutes (e.g., long builds, extensive tests)
        **For most commands, use exec() first!**
        Important Notes:
            - Background tasks persist in storage and can be queried across sessions
            - Don't use sleep commands after launching background tasks
            - Use task_get(task_id) to check status and retrieve output
        """
        # Check dangerous patterns. If matched, ask the user before falling
        # back to a hard block (see exec for context).
        if not _dangerous_allowed[0] and _DANGEROUS_RE.search(command):
            if not await _request_dangerous_approval(command, "dangerous"):
                return (
                    "Error: Dangerous command denied by user. "
                    "Use /dangerous on to authorize for the rest of the session."
                )

        if not _dangerous_allowed[0] and _SCRIPT_EXEC_RE.search(command):
            if not await _request_dangerous_approval(command, "script"):
                return (
                    "Error: Script execution denied by user. "
                    "Use /dangerous on to authorize for the rest of the session."
                )

        # Check absolute paths referenced in command
        if _only_in_workspace[0]:
            path_err = _check_cmd_paths(command)
            if path_err:
                return path_err

        # Clamp timeout to reasonable range
        timeout = min(max(10.0, timeout), 600.0)
        wait_time = min(max(1.0, wait_time), timeout)  # wait_time should not exceed timeout

        # Append a sentinel so we can capture the resulting directory
        wrapped = f'{command}\necho "__DRSAI_CWD__:$(pwd)"'

        # Create task ID with short UUID (first 8 characters)
        task_id = f"bash_task_{uuid.uuid4().hex[:8]}"

        task_info = {
            "task_id": task_id,
            "command": command,
            "status": "running",
            "output": None,
            "error": None,
            "pid": None,
            "pgid": None,
            "start_time": datetime.now().isoformat(),
            "timeout": timeout,
        }
        _bash_tasks[task_id] = task_info
        # Save to persistent storage
        task_persistence.save_task(task_id, task_info)

        async def run_bg_task():
            """Background task execution with timeout protection."""
            try:
                # Create new process group for proper cleanup
                proc = await asyncio.create_subprocess_shell(
                    wrapped,
                    cwd=str(_cwd[0]),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    preexec_fn=os.setsid  # Create new session
                )

                task_info["pid"] = proc.pid
                task_info["pgid"] = os.getpgid(proc.pid)

                # Wait with timeout
                try:
                    async with asyncio.timeout(timeout):
                        stdout, stderr = await proc.communicate()
                        raw_output = (stdout.decode('utf-8') if stdout else '') + (stderr.decode('utf-8') if stderr else '')

                        # Parse output and update working directory
                        lines = raw_output.splitlines()
                        out_lines = []
                        for line in lines:
                            if line.startswith("__DRSAI_CWD__:"):
                                new_dir_str = line[len("__DRSAI_CWD__:"):].strip()
                                try:
                                    new_dir = Path(new_dir_str).resolve()
                                    # Update cwd based on workspace restriction setting
                                    if _only_in_workspace[0]:
                                        # Only update if within allowed directories
                                        if any(new_dir.is_relative_to(d) for d in ALLOWED_DIRS):
                                            _cwd[0] = new_dir
                                        else:
                                            out_lines.append(
                                                f"Warning: cd target '{new_dir}' is outside workspace; cwd not updated"
                                            )
                                    else:
                                        # Allow cd to any directory when workspace restriction is off
                                        _cwd[0] = new_dir
                                except Exception:
                                    pass
                            else:
                                out_lines.append(line)

                        output = "\n".join(out_lines).strip() or "(no output)"
                        task_info["output"] = output[:50000]
                        task_info["status"] = "completed"
                        task_info["exit_code"] = proc.returncode
                        # Update persistent storage
                        task_persistence.update_task_status(task_id, "completed", output=task_info["output"])

                except asyncio.TimeoutError:
                    # Kill entire process group on timeout
                    try:
                        # First try graceful termination
                        os.killpg(task_info["pgid"], signal.SIGTERM)
                        await asyncio.sleep(2)  # Grace period for clean shutdown

                        # Check if process group still exists
                        try:
                            os.killpg(task_info["pgid"], 0)  # Signal 0 checks existence
                            # Still alive, force kill
                            os.killpg(task_info["pgid"], signal.SIGKILL)
                        except ProcessLookupError:
                            pass  # Already terminated gracefully
                    except ProcessLookupError:
                        pass  # Process group already gone
                    except Exception as e:
                        task_info["error"] = f"Error killing process group: {e}"

                    task_info["error"] = f"Command timed out after {timeout}s (all child processes terminated)"
                    task_info["status"] = "timeout"
                    # Update persistent storage
                    task_persistence.update_task_status(task_id, "timeout", error=task_info["error"])

            except Exception as e:
                task_info["error"] = f"Error: {e}"
                task_info["status"] = "failed"
                # Update persistent storage
                task_persistence.update_task_status(task_id, "failed", error=task_info["error"])
            finally:
                task_info["end_time"] = datetime.now().isoformat()

        # Start background task
        asyncio.create_task(run_bg_task())

        # Wait for wait_time to see if task completes quickly
        await asyncio.sleep(wait_time)

        # Check if task completed during wait period
        if task_info["status"] == "completed":
            # Task completed successfully - return output directly
            return task_info["output"]
        elif task_info["status"] in ["timeout", "failed"]:
            # Task failed during wait period - return error directly
            error_msg = task_info.get("error", "Unknown error")
            return f"Error: {error_msg}"
        else:
            # Task still running - return task info for background querying
            cmd_preview = command[:50] + "..." if len(command) > 50 else command
            return {
                "task_id": task_id,
                "status": "running",
                "command": cmd_preview,
                "timeout": timeout,
                "message": f"Task '{task_id}' is still running after {wait_time}s.\nUse task_get('{task_id}') to check status and retrieve output.",
                "pid": task_info.get("pid"),
                "pgid": task_info.get("pgid"),
            }

    async def bash_get_task(task_id: str) -> Dict[str, Any]:
        """
        Get status and output of a background bash task.

        Args:
            task_id: Task ID returned by exec with run_in_background=True

        Note:
            If a query is still running after being executed once, it should not be executed again. Instead, users should be prompted to actively query again later, or a scheduled task can be set.
        """
        if task_id not in _bash_tasks:
            return {
                "task_id": task_id,
                "status": "not_found",
                "error": f"Task {task_id} not found"
            }

        task_info = _bash_tasks[task_id]
        result = {
            "task_id": task_id,
            "command": task_info["command"],
            "status": task_info["status"],
            "start_time": task_info["start_time"],
        }

        if task_info.get("pid"):
            result["pid"] = task_info["pid"]
        if task_info.get("pgid"):
            result["pgid"] = task_info["pgid"]
        if task_info.get("end_time"):
            result["end_time"] = task_info["end_time"]
        if task_info.get("exit_code") is not None:
            result["exit_code"] = task_info["exit_code"]

        if task_info["status"] == "completed" and task_info.get("output"):
            result["output"] = task_info["output"]
        elif task_info.get("error"):
            result["error"] = task_info["error"]

        return result


    async def bash_list_tasks() -> str:
        """
        List all bash background tasks.

        Returns:
            Formatted string listing all tasks and their status
        """
        if not _bash_tasks:
            return "No background bash tasks"

        lines = ["Bash Background Tasks:"]
        for task_id, info in _bash_tasks.items():
            status = info["status"]
            cmd_preview = info["command"][:50] + "..." if len(info["command"]) > 50 else info["command"]
            lines.append(f"  {task_id}: {status} - {cmd_preview}")
            if info.get("pid"):
                lines.append(f"    PID: {info['pid']}, PGID: {info.get('pgid', 'N/A')}")

        return "\n".join(lines)


    async def bash_kill_task(task_id: str, force: bool = False) -> str:
        """
        Kill a running background bash task and its entire process group.

        Args:
            task_id: Task ID to kill
            force: If True, use SIGKILL immediately; if False, try SIGTERM first

        Returns:
            Status message
        """
        if task_id not in _bash_tasks:
            return f"Error: Task {task_id} not found"

        task_info = _bash_tasks[task_id]

        if task_info["status"] not in ["running"]:
            return f"Task {task_id} is not running (status: {task_info['status']})"

        pgid = task_info.get("pgid")
        if not pgid:
            return f"Error: No process group ID found for task {task_id}"

        try:
            if force:
                # Force kill
                os.killpg(pgid, signal.SIGKILL)
                task_info["status"] = "killed"
                task_info["error"] = "Killed by user (SIGKILL)"
            else:
                # Graceful termination
                os.killpg(pgid, signal.SIGTERM)
                await asyncio.sleep(2)
                # Check if still alive, then force kill
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass  # Already dead
                task_info["status"] = "killed"
                task_info["error"] = "Terminated by user (SIGTERM)"

            task_info["end_time"] = datetime.now().isoformat()
            # Update persistent storage
            task_persistence.update_task_status(task_id, "killed", error=task_info["error"])
            return f"Task {task_id} (PGID: {pgid}) has been terminated"

        except ProcessLookupError:
            task_info["status"] = "completed"
            task_info["error"] = "Process already terminated"
            # Update persistent storage
            task_persistence.update_task_status(task_id, "completed", error=task_info["error"])
            return f"Task {task_id} process group already terminated"
        except Exception as e:
            return f"Error killing task {task_id}: {e}"


    async def glob(
        pattern: str,
        search_path: str = None,
        max_results: int = 100
    ) -> str:
        """
        Find files matching glob pattern.

        Args:
            pattern: Glob pattern to match (e.g. "**/*.py", "src/**/*.ts")
            search_path: Directory to search in (defaults to workspace root)
            max_results: Maximum number of files to return

        Returns:
            Newline-separated list of matching file paths
        """
        try:
            base_path = safe_path(search_path) if search_path else WORKDIR

            # Use pathlib.glob for pattern matching (runs in executor to avoid blocking)
            def _glob_sync():
                matches = []
                if "**" in pattern:
                    # Recursive glob
                    matches = list(base_path.glob(pattern))
                else:
                    # Non-recursive glob
                    matches = list(base_path.glob(pattern))

                # Sort by modification time (newest first)
                matches.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)
                return matches

            matches = await asyncio.get_event_loop().run_in_executor(None, _glob_sync)

            # Convert to relative paths
            rel_matches = []
            for match in matches[:max_results]:
                try:
                    rel_path = match.relative_to(WORKDIR)
                    rel_matches.append(str(rel_path))
                except ValueError:
                    rel_matches.append(str(match))

            if not rel_matches:
                return "No files found"

            truncated = len(matches) > max_results
            result = "\n".join(rel_matches)

            if truncated:
                result += f"\n\n[Results truncated. Showing {max_results} of {len(matches)} files]"

            return result

        except Exception as e:
            return f"Error: {e}"


    # Mutable current directory state for PowerShell (separate from bash)
    _ps_cwd = [WORKDIR]
    # Background tasks storage
    _ps_background_tasks = {}

    # ── Helper: build PowerShell command with cwd tracking ──────────────
    def _build_ps_command(command: str) -> str:
        """Build a PowerShell script string with cwd tracking and error handling.

        Escapes single quotes in the cwd path (PowerShell: '' inside single-quoted strings).
        Wraps Set-Location in try/catch so a bad cwd doesn't silently fail.

        UTF-8 preamble: forces the child process's stdout encoding to UTF-8 so
        Python/Node output on Win10 zh-CN PowerShell 5.1 (default OEM/CP936)
        doesn't garble or hang when emitting multi-byte sequences. PYTHONUTF8
        and PYTHONIOENCODING also nudge any Python child to emit UTF-8 directly.
        """
        escaped_cwd = str(_ps_cwd[0]).replace("'", "''")
        return f"""
$ErrorActionPreference = 'Continue'
try {{ [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() }} catch {{}}
try {{ $OutputEncoding = [System.Text.UTF8Encoding]::new() }} catch {{}}
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
try {{
    Set-Location '{escaped_cwd}'
}} catch {{
    Write-Error "Set-Location failed: $_"
}}
{command}
Write-Host "__DRSAI_PS_CWD__:$(Get-Location)"
"""

    def _ps_args(ps_path: str, script: str) -> list:
        """Return the argument list for invoking PowerShell with ``script``.

        Legacy ``powershell.exe`` (PS 5.x) is faster and parses more reliably
        with ``-EncodedCommand <base64-UTF16LE>``. It also bypasses quoting
        issues that intermittently hang multi-line ``-Command`` strings on
        Windows 10's conhost. Modern ``pwsh`` already handles UTF-8 and
        complex quoted scripts well, so we keep readable ``-Command`` args
        there for easier debugging.
        """
        base = ["-NoLogo", "-NoProfile", "-NonInteractive"]
        low = ps_path.lower()
        is_legacy_ps = (
            platform.system() == "Windows"
            and (low.endswith("\\powershell.exe") or low.endswith("/powershell.exe")
                 or low == "powershell.exe" or low == "powershell")
        )
        if is_legacy_ps:
            encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
            return base + ["-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]
        return base + ["-Command", script]

    def _ps_subprocess_kwargs() -> dict:
        """Return asyncio.create_subprocess_exec kwargs for PowerShell.
        
        Only includes ``cwd`` if the current _ps_cwd exists on this platform,
        so Unix-style paths on Windows don't cause subprocess startup failure.
        
        On Windows: adds STARTUPINFO + CREATE_NO_WINDOW to prevent a console
        window from flashing when PowerShell is launched from a windowed
        (no-console) parent process (e.g. PyInstaller --windowed exe,
        pythonw.exe, or tkinter GUI app).
        """
        kwargs = dict(
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # Connect stdin to /dev/null (NUL on Windows) so that any child
            # process which tries to read from stdin immediately receives EOF
            # instead of blocking forever.  This is critical when the parent
            # process has no interactive console (CREATE_NO_WINDOW / GUI app):
            # without it, ``python -c`` can enter REPL mode on a quoting error
            # and hang indefinitely waiting for input that never arrives.
            stdin=asyncio.subprocess.DEVNULL,
        )
        try:
            if _ps_cwd[0].exists():
                kwargs["cwd"] = str(_ps_cwd[0])
        except Exception:
            pass  # Skip cwd if path validation fails (e.g. Unix path on Windows)

        # ── Windows: hide console window (see _win_subprocess_hide_kwargs) ──
        kwargs.update(_win_subprocess_hide_kwargs())

        return kwargs

    def _parse_ps_output(raw_output: str) -> tuple[str, str]:
        """Parse PowerShell output: extract cwd sentinel and return (clean_output, new_cwd_str).
        
        Returns:
            (clean_output, new_cwd_str) — new_cwd_str is empty if no sentinel found.
        """
        output_lines = []
        new_cwd_str = ""
        for line in raw_output.splitlines():
            if line.startswith("__DRSAI_PS_CWD__:"):
                new_cwd_str = line[len("__DRSAI_PS_CWD__:"):].strip()
            else:
                output_lines.append(line)
        clean_output = "\n".join(output_lines).strip() or "(no output)"
        return clean_output, new_cwd_str

    def _update_ps_cwd(new_cwd_str: str, output_lines: list[str]) -> None:
        """Try to update _ps_cwd from the sentinel value, respecting workspace restriction."""
        if not new_cwd_str:
            return
        try:
            new_dir = Path(new_cwd_str).resolve()
            if any(new_dir.is_relative_to(d) for d in ALLOWED_DIRS):
                _ps_cwd[0] = new_dir
            elif _only_in_workspace[0]:
                output_lines.append(
                    f"Warning: cd target '{new_dir}' is outside workspace; cwd not updated"
                )
            else:
                _ps_cwd[0] = new_dir
        except Exception:
            pass

    async def powershell_exec(
        command: str,
        timeout: int = 200,
        run_in_background: bool = False,
    ) -> Union[str, Dict[str, Any]]:
        """
        Execute PowerShell command in workspace directory.

        The working directory persists across calls, similar to exec.
        Supports both PowerShell Core (pwsh) and Windows PowerShell.

        Args:
            command: PowerShell command to execute
            timeout: Timeout in seconds (default 200, max 600)
            run_in_background: Run command in background (returns task info)

        Returns:
            If run_in_background=False: Command output as string
            If run_in_background=True: Dict with task_id and status

        Background task dict format:
            {
                "task_id": str,
                "status": "running"|"completed"|"failed",
                "output": str (when completed),
                "error": str (when failed)
            }
        """
        # Check if PowerShell is available
        ps_path = _detect_powershell()
        if not ps_path:
            return "Error: PowerShell not found. Please install PowerShell Core (pwsh) or use exec for Unix commands."

        # Check dangerous patterns. Same approval flow as exec.
        if not _dangerous_allowed[0] and _DANGEROUS_RE.search(command):
            if not await _request_dangerous_approval(command, "dangerous"):
                return (
                    "Error: Dangerous command denied by user. "
                    "Use /dangerous on to authorize for the rest of the session."
                )

        if not _dangerous_allowed[0] and not _RUNTIME_TOOL_APPROVAL_GRANTED.get() and _SCRIPT_EXEC_RE.search(command):
            if not await _request_dangerous_approval(command, "script"):
                return (
                    "Error: Script execution denied by user. "
                    "Use /dangerous on to authorize for the rest of the session."
                )

        # Check absolute paths referenced in command (both Unix and Windows style)
        if _only_in_workspace[0]:
            path_err = _check_cmd_paths(command)
            if path_err:
                return path_err

        # Clamp timeout
        timeout = min(max(1, timeout), 600)

        ps_command = _build_ps_command(command)
        subproc_kwargs = _ps_subprocess_kwargs()

        # Fast path: skill scripts are almost always `python …`. Spawning
        # python.exe directly avoids PowerShell CreateProcess denials and the
        # multi-second WMI fallback on Desktop Windows.
        if not run_in_background:
            direct_argv = _parse_direct_python_command(command)
            if direct_argv:
                try:
                    cwd = subproc_kwargs.get("cwd")
                    code, raw = await _run_direct_python_command(
                        direct_argv,
                        cwd=str(cwd) if cwd else None,
                        timeout=float(timeout),
                    )
                    extra = ["[spawn=direct-python]"]
                    clean_output, new_cwd_str = _parse_ps_output(raw)
                    _update_ps_cwd(new_cwd_str, extra)
                    if extra:
                        clean_output = "\n".join(extra + [clean_output])
                    if code != 0:
                        clean_output += f"\n[exit code: {code}]"
                    return clean_output[:50000]
                except Exception as direct_error:
                    if platform.system() == "Windows" and _is_win_access_denied(direct_error):
                        try:
                            cwd = subproc_kwargs.get("cwd")
                            code, stdout, stderr, via = await asyncio.to_thread(
                                _run_win_access_denied_fallbacks,
                                direct_argv[0],
                                list(direct_argv[1:]),
                                cwd=str(cwd) if cwd else None,
                                timeout=float(timeout),
                            )
                            extra = [f"[spawn=direct-python-{via}]"]
                            clean_output, new_cwd_str = _parse_ps_output(stdout + stderr)
                            _update_ps_cwd(new_cwd_str, extra)
                            if extra:
                                clean_output = "\n".join(extra + [clean_output])
                            if code != 0:
                                clean_output += f"\n[exit code: {code}]"
                            return clean_output[:50000]
                        except Exception:
                            pass
                    # Fall through to PowerShell / WMI / Node for other failures.

        # Shared helpers for foreground + background (same Access Denied escalation).
        ps_argv = list(_ps_args(ps_path, ps_command))

        def _finish_from_raw(raw_output: str, returncode: int | None, *, via: str | None = None) -> str:
            extra_lines = []
            if via:
                extra_lines.append(f"[spawn={via}]")
            clean_output, new_cwd_str = _parse_ps_output(raw_output)
            _update_ps_cwd(new_cwd_str, extra_lines)
            if extra_lines:
                clean_output = "\n".join(extra_lines + [clean_output])
            if returncode not in (None, 0):
                clean_output += f"\n[exit code: {returncode}]"
            return clean_output[:50000]

        def _raw_looks_denied(stdout_b: bytes | None, stderr_b: bytes | None, raw_output: str) -> bool:
            return platform.system() == "Windows" and (
                _looks_like_win_access_denied_output(raw_output)
                or _looks_like_win_access_denied_bytes(stdout_b)
                or _looks_like_win_access_denied_bytes(stderr_b)
            )

        async def _run_denied_fallbacks() -> tuple[str, int]:
            # Node trampoline first for powershell; WMI second. cmd→powershell often
            # still denied and may hide GBK "拒绝访问" behind a fake CreateProcess success.
            cwd = subproc_kwargs.get("cwd")
            returncode, stdout, stderr, via = await asyncio.to_thread(
                _run_win_access_denied_fallbacks,
                ps_path,
                ps_argv,
                cwd=str(cwd) if cwd else None,
                timeout=float(timeout),
            )
            _PS_SPAWN_PREFER_NODE[0] = True
            code = int(returncode or 0)
            return _finish_from_raw(stdout + stderr, code, via=via), code

        # Background execution
        if run_in_background:
            task_id = f"ps_task_{uuid.uuid4().hex[:8]}"

            task_info = {
                "task_id": task_id,
                "command": command,
                "status": "running",
                "output": None,
                "error": None,
                "pid": None,
                "start_time": datetime.now().isoformat(),
                "timeout": timeout,
            }
            _ps_background_tasks[task_id] = task_info

            async def run_bg_task():
                proc = None
                try:
                    prefer_node = (
                        _PS_SPAWN_PREFER_NODE[0]
                        or _should_prefer_node_shell_trampoline()
                    )
                    if prefer_node:
                        output, code = await _run_denied_fallbacks()
                        task_info["output"] = output
                        task_info["status"] = "completed"
                        task_info["exit_code"] = code
                        return

                    proc = await _create_subprocess_exec_with_win_fallback(
                        ps_path, *ps_argv,
                        **subproc_kwargs,
                    )
                    task_info["pid"] = proc.pid

                    async with asyncio.timeout(timeout):
                        stdout_b, stderr_b = await proc.communicate()
                        raw_output = (
                            _decode_subprocess_output(stdout_b)
                            + _decode_subprocess_output(stderr_b)
                        )
                        if _raw_looks_denied(stdout_b, stderr_b, raw_output):
                            output, code = await _run_denied_fallbacks()
                            task_info["output"] = output
                            task_info["status"] = "completed"
                            task_info["exit_code"] = code
                            return

                        task_info["output"] = _finish_from_raw(raw_output, proc.returncode)
                        task_info["status"] = "completed"
                        task_info["exit_code"] = proc.returncode

                except asyncio.TimeoutError:
                    if proc and proc.pid:
                        _kill_process_tree(proc.pid)
                    task_info["error"] = f"Command timeout after {timeout}s (process terminated)"
                    task_info["status"] = "timeout"
                except Exception as e:
                    if proc and proc.pid:
                        _kill_process_tree(proc.pid)
                    if platform.system() == "Windows" and _is_win_access_denied(e):
                        try:
                            output, code = await _run_denied_fallbacks()
                            task_info["output"] = output
                            task_info["status"] = "completed"
                            task_info["exit_code"] = code
                            return
                        except Exception as fallback_error:
                            task_info["error"] = (
                                f"Error: {e} (access-denied fallbacks also failed: {fallback_error})"
                            )
                            task_info["status"] = "failed"
                            return
                    task_info["error"] = f"Error: {e}"
                    task_info["status"] = "failed"
                finally:
                    task_info["end_time"] = datetime.now().isoformat()

            asyncio.create_task(run_bg_task())

            cmd_preview = command[:50] + "..." if len(command) > 50 else command
            return {
                "task_id": task_id,
                "status": "running",
                "command": cmd_preview,
                "timeout": timeout,
                "message": f"Task '{task_id}' is running.\nUse task_get('{task_id}') to check status and retrieve output.",
            }

        # Foreground execution
        # Fast path: known-denied hosts (pythonw / explicit env) skip CreateProcess.
        if _PS_SPAWN_PREFER_NODE[0] or _should_prefer_node_shell_trampoline():
            try:
                output, _code = await _run_denied_fallbacks()
                return output
            except Exception:
                # Fall through to CreateProcess as a secondary path.
                pass

        proc = None
        try:
            proc = await _create_subprocess_exec_with_win_fallback(
                ps_path, *ps_argv,
                **subproc_kwargs,
            )

            async with asyncio.timeout(timeout):
                stdout_b, stderr_b = await proc.communicate()
                raw_output = (
                    _decode_subprocess_output(stdout_b)
                    + _decode_subprocess_output(stderr_b)
                )
                # cmd.exe trampoline can start successfully while the inner
                # powershell.exe is still denied — detect GBK/UTF-8 forms and escalate.
                if _raw_looks_denied(stdout_b, stderr_b, raw_output):
                    try:
                        output, _code = await _run_denied_fallbacks()
                        return output
                    except Exception as fallback_error:
                        return (
                            _finish_from_raw(raw_output, proc.returncode)
                            + f"\n(access-denied fallbacks also failed: {fallback_error})"
                        )[:50000]
                return _finish_from_raw(raw_output, proc.returncode)

        except asyncio.TimeoutError:
            if proc and proc.pid:
                _kill_process_tree(proc.pid)
            return f"Error: Command timeout after {timeout}s (process terminated)"
        except Exception as e:
            if platform.system() == "Windows" and _is_win_access_denied(e):
                try:
                    output, _code = await _run_denied_fallbacks()
                    return output
                except Exception as fallback_error:
                    return f"Error: {e} (access-denied fallbacks also failed: {fallback_error})"
            return f"Error: {e}"


    async def powershell_get_task(task_id: str) -> Dict[str, Any]:
        """
        Get status and output of a background PowerShell task.

        Args:
            task_id: Task ID returned by exec with run_in_background=True

        Note:
            If a query is still running after being executed once, it should not be executed again. Instead, users should be prompted to actively query again later, or a scheduled task can be set.
        """
        if task_id not in _ps_background_tasks:
            return {
                "task_id": task_id,
                "status": "not_found",
                "error": f"Task {task_id} not found"
            }

        task_info = _ps_background_tasks[task_id]
        result = {
            "task_id": task_id,
            "command": task_info.get("command", ""),
            "status": task_info["status"],
            "start_time": task_info.get("start_time", ""),
        }

        if task_info.get("pid"):
            result["pid"] = task_info["pid"]
        if task_info.get("end_time"):
            result["end_time"] = task_info["end_time"]
        if task_info.get("exit_code") is not None:
            result["exit_code"] = task_info["exit_code"]

        if task_info["status"] == "completed" and task_info.get("output"):
            result["output"] = task_info["output"]
        elif task_info.get("error"):
            result["error"] = task_info["error"]

        return result


    async def powershell_list_tasks() -> str:
        """
        List all PowerShell background tasks.

        Returns:
            Formatted string listing all tasks and their status
        """
        if not _ps_background_tasks:
            return "No background PowerShell tasks"

        lines = ["PowerShell Background Tasks:"]
        for task_id, info in _ps_background_tasks.items():
            status = info["status"]
            cmd_preview = info.get("command", "")[:50] + "..." if len(info.get("command", "")) > 50 else info.get("command", "")
            lines.append(f"  {task_id}: {status} - {cmd_preview}")
            if info.get("pid"):
                lines.append(f"    PID: {info['pid']}")

        return "\n".join(lines)


    async def powershell_kill_task(task_id: str) -> str:
        """
        Kill a running background PowerShell task and its process tree.

        Uses cross-platform process termination:
        - On Windows: taskkill /F /T /PID (force tree kill)
        - On Unix: SIGTERM → SIGKILL fallback

        Args:
            task_id: Task ID to kill

        Returns:
            Status message
        """
        if task_id not in _ps_background_tasks:
            return f"Error: Task {task_id} not found"

        task_info = _ps_background_tasks[task_id]

        if task_info["status"] not in ["running"]:
            return f"Task {task_id} is not running (status: {task_info['status']})"

        pid = task_info.get("pid")
        if not pid:
            return f"Error: No PID found for task {task_id}"

        success = _kill_process_tree(pid)
        if success:
            task_info["status"] = "killed"
            task_info["error"] = "Killed by user"
            task_info["end_time"] = datetime.now().isoformat()
            return f"Task {task_id} (PID: {pid}) has been terminated"
        else:
            return f"Error: Failed to kill task {task_id} (PID: {pid})"


    # ── Workspace-restriction toggle helpers ───────────────────────────────
    # These are NOT registered as agent tools — they're called from CLI slash
    # commands (/workspace on|off|status) to dynamically toggle the restriction.

    def set_workspace_restriction(enabled: bool) -> str:
        """Toggle only_in_workspace for all tool functions (called by /workspace command)."""
        _only_in_workspace[0] = enabled
        return f"workspace restriction {'enabled' if enabled else 'disabled'}"

    def get_workspace_status() -> Dict[str, Any]:
        """Return current workspace restriction info (called by /workspace status)."""
        return {
            "only_in_workspace": _only_in_workspace[0],
            "work_dir": str(WORKDIR),
            "allowed_dirs": [str(d) for d in ALLOWED_DIRS],
        }

    # ── Dangerous-command toggle helpers ───────────────────────────────────
    # These are NOT registered as agent tools — they're called from CLI slash
    # commands (/dangerous on|off|status) to dynamically toggle the restriction.

    def set_dangerous_allowed(enabled: bool) -> str:
        """Toggle dangerous_command_allowed for all tool functions (called by /dangerous command)."""
        _dangerous_allowed[0] = enabled
        return f"dangerous command execution {'allowed' if enabled else 'blocked'}"

    def get_dangerous_status() -> Dict[str, Any]:
        """Return current dangerous command restriction info (called by /dangerous status)."""
        return {
            "dangerous_allowed": _dangerous_allowed[0],
        }

    # Model-facing names are intentionally concise and shell-neutral.
    # Keep implementation names distinct because Bash and PowerShell expose
    # different task stores, while both use the same public task API.
    read.__name__ = "read"
    write.__name__ = "write"
    edit.__name__ = "edit"
    grep.__name__ = "grep"
    glob.__name__ = "glob"
    bash_exec.__name__ = "exec"
    bash_exec_background.__name__ = "exec_background"
    bash_get_task.__name__ = "task_get"
    bash_list_tasks.__name__ = "task_list"
    bash_kill_task.__name__ = "task_kill"
    powershell_exec.__name__ = "exec"
    powershell_get_task.__name__ = "task_get"
    powershell_list_tasks.__name__ = "task_list"
    powershell_kill_task.__name__ = "task_kill"

    if is_powershell:
        return [
            read,
            write,
            edit,
            grep,
            glob,
            powershell_exec,
            powershell_get_task,
            powershell_list_tasks,
            powershell_kill_task,
            # toggles (not agent tools — for CLI use only)
            set_workspace_restriction,
            get_workspace_status,
            set_dangerous_allowed,
            get_dangerous_status,
            ]
    else:
        return [
            bash_exec,
            bash_exec_background,
            read,
            write,
            edit,
            grep,
            glob,
            bash_get_task,
            bash_list_tasks,
            bash_kill_task,
            # toggles (not agent tools — for CLI use only)
            set_workspace_restriction,
            get_workspace_status,
            set_dangerous_allowed,
            get_dangerous_status,
            ]
