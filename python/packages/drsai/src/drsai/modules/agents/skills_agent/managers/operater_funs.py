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
from typing import Union, List, Dict, Any, Optional
from datetime import datetime

import aiofiles

from .bash_task_persistence import BashTaskPersistence

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

def _detect_powershell() -> Optional[str]:
    """Detect available PowerShell executable (pwsh or powershell)."""
    global _POWERSHELL_PATH_CACHE

    if _POWERSHELL_PATH_CACHE is not None:
        return _POWERSHELL_PATH_CACHE

    # Try PowerShell Core (cross-platform) first
    pwsh_path = shutil.which("pwsh")
    if pwsh_path:
        _POWERSHELL_PATH_CACHE = pwsh_path
        return pwsh_path

    # Fall back to Windows PowerShell on Windows
    if platform.system() == "Windows":
        ps_path = shutil.which("powershell.exe")
        if ps_path:
            _POWERSHELL_PATH_CACHE = ps_path
            return ps_path
        # Also try just "powershell" (without .exe extension)
        ps_path = shutil.which("powershell")
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

    # Mutable current directory state (persists across run_bash calls)
    _cwd = [WORKDIR]

    # Background tasks storage - load from persistent storage on initialization
    _bash_tasks = task_persistence.load_all_tasks()

    # Clean up old completed tasks (older than 7 days)
    task_persistence.cleanup_old_tasks(max_age_days=7)

    async def run_read(path: str, minilimit: int = None, maxlimit: int = -1, timeout: float = 30.0) -> str:
        """
        Read file contents.
        """
        try:
            fp = safe_path(path)
            async with asyncio.timeout(timeout):
                async with aiofiles.open(fp, 'r', encoding='utf-8') as f:
                    text = await f.read()
                    lines = text.splitlines()
                    if minilimit:
                        lines = lines[minilimit:maxlimit]
                    return "\n".join(lines)[:50000]
        except asyncio.TimeoutError:
            return f"Error: Read operation timed out after {timeout}s"
        except Exception as e:
            return f"Error: {e}"


    async def run_write(path: str, content: str, timeout: float = 30.0) -> str:
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


    async def run_edit(path: str, old_text: str, new_text: str, timeout: float = 30.0) -> str:
        """
        Replace exact text in file.
        """
        try:
            fp = safe_path(path)

            async with asyncio.timeout(timeout):
                # Read operation
                async with aiofiles.open(fp, 'r', encoding='utf-8') as f:
                    text = await f.read()

                if old_text not in text:
                    return f"Error: Text not found in {path}"

                # Write operation
                new_content = text.replace(old_text, new_text, 1)
                async with aiofiles.open(fp, 'w', encoding='utf-8') as f:
                    await f.write(new_content)

                return f"Edited {path}"
        except asyncio.TimeoutError:
            return f"Error: Operation timed out after {timeout}s (file may be partially written)"

        except Exception as e:
            return f"Error: {e}"


    async def run_grep(
        pattern: str,
        path: str = None,
        glob: str = None,
        output_mode: str = "files_with_matches",
        context_before: int = 0,
        context_after: int = 0,
        show_line_numbers: bool = True,
        case_insensitive: bool = False,
        file_type: str = None,
        max_results: int = 250
    ) -> str:
        """
        Search for pattern in file contents using grep/ripgrep.

        Args:
            pattern: Regular expression pattern to search for
            path: File or directory to search (defaults to workspace root)
            glob: Glob pattern to filter files (e.g. "*.py", "*.{js,ts}")
            output_mode: Output format - "content" (matching lines),
                        "files_with_matches" (file paths), "count" (match counts)
            context_before: Number of lines before each match
            context_after: Number of lines after each match
            show_line_numbers: Show line numbers in output
            case_insensitive: Case insensitive search
            file_type: File type filter (e.g. "py", "js")
            max_results: Maximum results to return

        Returns:
            Search results as string
        """
        try:
            # Use ripgrep if available, fallback to grep, then Python re fallback
            rg_available = False
            grep_available = False

            # Check for ripgrep
            rg_check = await asyncio.create_subprocess_exec(
                shutil.which("rg") or "rg",
                "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await rg_check.communicate()
            rg_available = rg_check.returncode == 0

            # Check for grep (only on non-Windows platforms)
            if not rg_available and platform.system() != "Windows":
                grep_check = await asyncio.create_subprocess_exec(
                    "grep", "--version",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await grep_check.communicate()
                grep_available = grep_check.returncode == 0

            search_path = str(safe_path(path)) if path else str(WORKDIR)

            if rg_available:
                cmd = ["rg", "--hidden", "--max-columns", "500"]

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

                # File type
                if file_type:
                    cmd.extend(["--type", file_type])

                # Glob pattern
                if glob:
                    for pattern_item in glob.split(","):
                        cmd.extend(["--glob", pattern_item.strip()])

                # Pattern
                cmd.append(pattern)
                cmd.append(search_path)

                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )

                async with asyncio.timeout(30):
                    stdout, stderr = await proc.communicate()
                    output = stdout.decode('utf-8')

            elif grep_available:
                # Fallback to grep (Unix only)
                cmd = ["grep", "-r"]
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

                # Include pattern for file filtering
                if glob:
                    cmd.extend(["--include", glob])

                cmd.extend([pattern, search_path])

                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )

                async with asyncio.timeout(30):
                    stdout, stderr = await proc.communicate()
                    output = stdout.decode('utf-8')

            else:
                # Python re fallback (cross-platform, no external tools needed)
                # Run in executor to avoid blocking the asyncio event loop
                def _pygrep_sync():
                    import re as re_lib
                    import fnmatch
                    base = Path(search_path)
                    flags = re_lib.IGNORECASE if case_insensitive else 0
                    try:
                        compiled = re_lib.compile(pattern, flags)
                    except re_lib.error as e:
                        return f"Error: Invalid regex pattern: {e}"

                    results = []

                    for fpath in base.rglob("*"):
                        if not fpath.is_file():
                            continue
                        if file_type and fpath.suffix.lstrip(".") != file_type:
                            continue
                        if glob:
                            # fnmatch matches shell-style globs against filenames only
                            matched = False
                            for pattern_item in glob.split(","):
                                if fnmatch.fnmatch(fpath.name, pattern_item.strip()):
                                    matched = True
                                    break
                            if not matched:
                                continue

                        try:
                            with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                                lines = f.readlines()
                        except Exception:
                            continue

                        file_matches = []
                        for i, line in enumerate(lines, 1):
                            if compiled.search(line):
                                file_matches.append((i, line.rstrip()))

                        if not file_matches:
                            continue

                        rel = str(fpath.relative_to(base)) if fpath.is_relative_to(base) else str(fpath)

                        if output_mode == "files_with_matches":
                            results.append(rel)
                        elif output_mode == "count":
                            results.append(f"{rel}:{len(file_matches)}")
                        else:  # content mode
                            for line_no, line_text in file_matches[:max_results]:
                                if show_line_numbers:
                                    results.append(f"{rel}:{line_no}:{line_text}")
                                else:
                                    results.append(f"{rel}:{line_text}")

                        if len(results) >= max_results:
                            break

                    return "\n".join(results) if results else ""

                output = await asyncio.get_event_loop().run_in_executor(None, _pygrep_sync)
                if not output:
                    return "No matches found"

            if not output:
                return "No matches found"

            # Limit results
            lines = output.strip().split("\n")
            if len(lines) > max_results:
                limited = "\n".join(lines[:max_results])
                return f"{limited}\n\n[Showing first {max_results} of {len(lines)} results]"

            return output.strip()[:50000]

        except asyncio.TimeoutError:
            return "Error: Search timeout"
        except Exception as e:
            return f"Error: {e}"

    async def run_bash(
        cmd: str,
        timeout: float = 60,
    ) -> str:
        """Execute a bash command asynchronously and wait for completion.

        **IMPORTANT: This is the default and preferred function for most shell commands.**
        timeout: Timeout in seconds (max: 120).

        Example workflow:
            1. Try: run_bash("npm test")  # Try synchronous first
            2. If timeout → Use: run_bash_background("npm test", timeout=300)
        """

        # Check dangerous patterns (unless explicitly allowed via /dangerous on)
        if not _dangerous_allowed[0] and _DANGEROUS_RE.search(cmd):
            return "Error: Dangerous command detected. Use /dangerous on to authorize."

        # Check script execution patterns (unless explicitly allowed via /dangerous on)
        if not _dangerous_allowed[0] and _SCRIPT_EXEC_RE.search(cmd):
            return "Error: Script execution command detected. Use /dangerous on to authorize."

        # Check absolute paths referenced in command
        if _only_in_workspace[0]:
            path_err = _check_cmd_paths(cmd)
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
            wrapped = f'{cmd}\necho "__DRSAI_CWD__:$(pwd)"'
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
            

    async def run_bash_background(
        cmd: str,
        timeout: float = 500.0,
        wait_time: float = 10.0,
    ) -> Union[str, Dict[str, Any]]:
        """Execute shell command with smart background mode for LONG-RUNNING tasks.

        **⚠️ WARNING: Use this function ONLY when:**
        1. run_bash() returned a timeout error, OR
        2. You know the command will take > 2 minutes (e.g., long builds, extensive tests)
        **For most commands, use run_bash() first!**
        Important Notes:
            - Background tasks persist in storage and can be queried across sessions
            - Don't use sleep commands after launching background tasks
            - Use get_bash_task(task_id) to check status and retrieve output
        """
        # Check dangerous patterns (unless explicitly allowed via /dangerous on)
        if not _dangerous_allowed[0] and _DANGEROUS_RE.search(cmd):
            return "Error: Dangerous command detected. Use /dangerous on to authorize."

        # Check script execution patterns (unless explicitly allowed via /dangerous on)
        if not _dangerous_allowed[0] and _SCRIPT_EXEC_RE.search(cmd):
            return "Error: Script execution command detected. Use /dangerous on to authorize."

        # Check absolute paths referenced in command
        if _only_in_workspace[0]:
            path_err = _check_cmd_paths(cmd)
            if path_err:
                return path_err

        # Clamp timeout to reasonable range
        timeout = min(max(10.0, timeout), 600.0)
        wait_time = min(max(1.0, wait_time), timeout)  # wait_time should not exceed timeout

        # Append a sentinel so we can capture the resulting directory
        wrapped = f'{cmd}\necho "__DRSAI_CWD__:$(pwd)"'

        # Create task ID with short UUID (first 8 characters)
        task_id = f"bash_task_{uuid.uuid4().hex[:8]}"

        task_info = {
            "task_id": task_id,
            "command": cmd,
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
            cmd_preview = cmd[:50] + "..." if len(cmd) > 50 else cmd
            return {
                "task_id": task_id,
                "status": "running",
                "command": cmd_preview,
                "timeout": timeout,
                "message": f"Task '{task_id}' is still running after {wait_time}s.\nUse get_bash_task('{task_id}') to check status and retrieve output.",
                "pid": task_info.get("pid"),
                "pgid": task_info.get("pgid"),
            }

    async def get_bash_task(task_id: str) -> Dict[str, Any]:
        """
        Get status and output of a background bash task.

        Args:
            task_id: Task ID returned by run_bash with run_in_background=True

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


    async def list_bash_tasks() -> str:
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


    async def kill_bash_task(task_id: str, force: bool = False) -> str:
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


    async def run_glob(
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
        """
        escaped_cwd = str(_ps_cwd[0]).replace("'", "''")
        return f"""
$ErrorActionPreference = 'Continue'
try {{
    Set-Location '{escaped_cwd}'
}} catch {{
    Write-Error "Set-Location failed: $_"
}}
{command}
Write-Host "__DRSAI_PS_CWD__:$(Get-Location)"
"""

    def _ps_subprocess_kwargs() -> dict:
        """Return asyncio.create_subprocess_exec kwargs for PowerShell.
        
        Only includes ``cwd`` if the current _ps_cwd exists on this platform,
        so Unix-style paths on Windows don't cause subprocess startup failure.
        """
        kwargs = dict(
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            if _ps_cwd[0].exists():
                kwargs["cwd"] = str(_ps_cwd[0])
        except Exception:
            pass  # Skip cwd if path validation fails (e.g. Unix path on Windows)
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

    async def run_powershell(
        command: str,
        timeout: int = 200,
        run_in_background: bool = False,
    ) -> Union[str, Dict[str, Any]]:
        """
        Execute PowerShell command in workspace directory.

        The working directory persists across calls, similar to run_bash.
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
            return "Error: PowerShell not found. Please install PowerShell Core (pwsh) or use run_bash for Unix commands."

        # Check dangerous patterns (unless explicitly allowed via /dangerous on)
        if not _dangerous_allowed[0] and _DANGEROUS_RE.search(command):
            return "Error: Dangerous command detected. Use /dangerous on to authorize."

        # Check script execution patterns (unless explicitly allowed via /dangerous on)
        if not _dangerous_allowed[0] and _SCRIPT_EXEC_RE.search(command):
            return "Error: Script execution command detected. Use /dangerous on to authorize."

        # Check absolute paths referenced in command (both Unix and Windows style)
        if _only_in_workspace[0]:
            path_err = _check_cmd_paths(command)
            if path_err:
                return path_err

        # Clamp timeout
        timeout = min(max(1, timeout), 600)

        ps_command = _build_ps_command(command)
        subproc_kwargs = _ps_subprocess_kwargs()

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
                    proc = await asyncio.create_subprocess_exec(
                        ps_path, "-NoProfile", "-NonInteractive", "-Command", ps_command,
                        **subproc_kwargs,
                    )
                    task_info["pid"] = proc.pid

                    async with asyncio.timeout(timeout):
                        stdout, stderr = await proc.communicate()
                        raw_output = (stdout.decode('utf-8') if stdout else '') + (stderr.decode('utf-8') if stderr else '')
                        clean_output, new_cwd_str = _parse_ps_output(raw_output)
                        
                        # Update cwd
                        extra_lines = []
                        _update_ps_cwd(new_cwd_str, extra_lines)
                        if extra_lines:
                            clean_output = "\n".join(extra_lines + [clean_output])

                        # Append exit code for non-zero exits
                        if proc.returncode != 0:
                            clean_output += f"\n[exit code: {proc.returncode}]"

                        task_info["output"] = clean_output[:50000]
                        task_info["status"] = "completed"
                        task_info["exit_code"] = proc.returncode

                except asyncio.TimeoutError:
                    # Kill process on timeout (cross-platform)
                    if proc and proc.pid:
                        _kill_process_tree(proc.pid)
                    task_info["error"] = f"Command timeout after {timeout}s (process terminated)"
                    task_info["status"] = "timeout"
                except Exception as e:
                    if proc and proc.pid:
                        _kill_process_tree(proc.pid)
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
                "message": f"Task '{task_id}' is running.\nUse get_powershell_task('{task_id}') to check status and retrieve output.",
            }

        # Foreground execution
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                ps_path, "-NoProfile", "-NonInteractive", "-Command", ps_command,
                **subproc_kwargs,
            )

            async with asyncio.timeout(timeout):
                stdout, stderr = await proc.communicate()
                raw_output = (stdout.decode('utf-8') if stdout else '') + (stderr.decode('utf-8') if stderr else '')
                extra_lines = []
                clean_output, new_cwd_str = _parse_ps_output(raw_output)
                _update_ps_cwd(new_cwd_str, extra_lines)

                if extra_lines:
                    clean_output = "\n".join(extra_lines + [clean_output])

                # Append exit code for non-zero exits so LLM knows the command failed
                if proc.returncode != 0:
                    clean_output += f"\n[exit code: {proc.returncode}]"

                return clean_output[:50000]

        except asyncio.TimeoutError:
            # Kill process on timeout (cross-platform)
            if proc and proc.pid:
                _kill_process_tree(proc.pid)
            return f"Error: Command timeout after {timeout}s (process terminated)"
        except Exception as e:
            return f"Error: {e}"


    async def get_powershell_task(task_id: str) -> Dict[str, Any]:
        """
        Get status and output of a background PowerShell task.

        Args:
            task_id: Task ID returned by run_powershell with run_in_background=True

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


    async def list_powershell_tasks() -> str:
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


    async def kill_powershell_task(task_id: str) -> str:
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

    if is_powershell:
        return [
            run_read,
            run_write,
            run_edit,
            run_grep,
            run_glob,
            run_powershell,
            get_powershell_task,
            list_powershell_tasks,
            kill_powershell_task,
            # toggles (not agent tools — for CLI use only)
            set_workspace_restriction,
            get_workspace_status,
            set_dangerous_allowed,
            get_dangerous_status,
            ]
    else:
        return [
            run_bash,
            run_bash_background,
            run_read,
            run_write,
            run_edit,
            run_grep,
            run_glob,
            get_bash_task,
            list_bash_tasks,
            kill_bash_task,
            # toggles (not agent tools — for CLI use only)
            set_workspace_restriction,
            get_workspace_status,
            set_dangerous_allowed,
            get_dangerous_status,
            ]