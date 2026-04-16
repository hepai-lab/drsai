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
from typing import Union, List, Dict, Any, Optional
from datetime import datetime

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

# Regex to extract absolute paths from shell commands
_ABS_PATH_RE = re.compile(r'(?:^|[\s=\'",;|&<>(){}])(/(?:[^\s;|&><\'"\\{}()]+))')

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

    # No PowerShell found
    _POWERSHELL_PATH_CACHE = False
    return None


def get_operator_funcs(
        worker_dir: str|Path, 
        extra_dirs: list[str|Path] = None, 
        only_in_workspace: bool = True,
        is_powershell: bool = False, 
        allolow_dangrous_cmd: bool = False,
        )->list[callable]:

    WORKDIR = Path(worker_dir).resolve()
    ALLOWED_DIRS = [WORKDIR] + [Path(d).resolve() for d in (extra_dirs or [])]

    def safe_path(p: str) -> Path:
        """Ensure path stays within workspace or allowed directories."""
        resolved = Path(p).resolve()
        # If path is absolute, check directly against allowed dirs
        if Path(p).is_absolute():
            if only_in_workspace and not any(resolved.is_relative_to(d) for d in ALLOWED_DIRS):
                raise ValueError(f"Path escapes workspace: {p}")
            return resolved
        # Relative path: resolve against WORKDIR
        path = (WORKDIR / p).resolve()
        if only_in_workspace and not any(path.is_relative_to(d) for d in ALLOWED_DIRS):
            raise ValueError(f"Path escapes workspace: {p}")
        return path

    def _check_cmd_paths(cmd: str) -> str | None:
        """Return an error string if any absolute path in cmd escapes allowed dirs, else None."""
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
        return None

    # Mutable current directory state (persists across run_bash calls)
    _cwd = [WORKDIR]

    # Background tasks storage
    _bash_tasks = {}
    _task_counter = [0]

    def run_bash(
        cmd: str,
        timeout: int = 200,
        run_in_background: bool = False,
        warn_before: int = 30
    ) -> Union[str, Dict[str, Any]]:
        """Execute shell command in workspace directory.

        The working directory persists across calls: cd commands take effect
        for subsequent invocations, as long as the target stays within the
        allowed workspace.

        Args:
            cmd: Shell command to execute
            timeout: Maximum execution time in seconds (default 300, max 600)
            run_in_background: If True, run command in background and return task info
            warn_before: Seconds before timeout to check if process should continue (default 30)

        Returns:
            If run_in_background=False: Command output as string
            If run_in_background=True: Dict with task_id, pid, and pgid
        """
        # Check dangerous patterns
        if not allolow_dangrous_cmd and _DANGEROUS_RE.search(cmd):
            return "Error: Dangerous command detected"
        # Check absolute paths referenced in command
        if only_in_workspace:
            path_err = _check_cmd_paths(cmd)
            if path_err:
                return path_err

        # Clamp timeout
        timeout = min(max(10, timeout), 600)
        warn_before = min(warn_before, timeout - 5)

        # Append a sentinel so we can capture the resulting directory
        wrapped = f'{cmd}\necho "__DRSAI_CWD__:$(pwd)"'

        # Background execution
        if run_in_background:
            task_id = f"bash_task_{_task_counter[0]}"
            _task_counter[0] += 1

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

            def run_bg_task():
                try:
                    # Create new process group for proper cleanup
                    proc = subprocess.Popen(
                        wrapped,
                        shell=True,
                        cwd=str(_cwd[0]),
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        preexec_fn=os.setsid  # Create new session
                    )

                    task_info["pid"] = proc.pid
                    task_info["pgid"] = os.getpgid(proc.pid)

                    # Wait with timeout
                    try:
                        stdout, stderr = proc.communicate(timeout=timeout)
                        raw_output = stdout + stderr

                        # Parse output
                        lines = raw_output.splitlines()
                        out_lines = []
                        for line in lines:
                            if line.startswith("__DRSAI_CWD__:"):
                                new_dir_str = line[len("__DRSAI_CWD__:"):].strip()
                                try:
                                    new_dir = Path(new_dir_str).resolve()
                                    if any(new_dir.is_relative_to(d) for d in ALLOWED_DIRS):
                                        _cwd[0] = new_dir
                                except Exception:
                                    pass
                            else:
                                out_lines.append(line)

                        output = "\n".join(out_lines).strip() or "(no output)"
                        task_info["output"] = output[:50000]
                        task_info["status"] = "completed"
                        task_info["exit_code"] = proc.returncode

                    except subprocess.TimeoutExpired:
                        # Kill entire process group
                        try:
                            os.killpg(task_info["pgid"], signal.SIGTERM)
                            time.sleep(2)  # Grace period
                            try:
                                os.killpg(task_info["pgid"], signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                        except Exception as e:
                            task_info["error"] = f"Error killing process group: {e}"

                        task_info["error"] = f"Command timed out after {timeout}s (all child processes terminated)"
                        task_info["status"] = "timeout"

                except Exception as e:
                    task_info["error"] = f"Error: {e}"
                    task_info["status"] = "failed"
                finally:
                    task_info["end_time"] = datetime.now().isoformat()

            thread = threading.Thread(target=run_bg_task, daemon=True)
            thread.start()

            return {
                "task_id": task_id,
                "status": "running",
                "message": f"Task {task_id} started in background (timeout: {timeout}s)",
                "timeout": timeout,
            }

        # Foreground execution with process group management
        try:
            # Create new process group
            proc = subprocess.Popen(
                wrapped,
                shell=True,
                cwd=str(_cwd[0]),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                preexec_fn=os.setsid
            )

            pgid = os.getpgid(proc.pid)

            try:
                stdout, stderr = proc.communicate(timeout=timeout)
                raw_output = stdout + stderr

            except subprocess.TimeoutExpired:
                # Kill entire process group
                try:
                    os.killpg(pgid, signal.SIGTERM)
                    time.sleep(2)  # Grace period for clean shutdown
                    try:
                        # Force kill if still alive
                        os.killpg(pgid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass  # Already dead
                except ProcessLookupError:
                    pass  # Process group already gone
                except Exception as e:
                    return f"Error: Timeout after {timeout}s. Failed to kill process group: {e}"

                return f"Error: Command timed out after {timeout}s. All processes in the process group have been terminated."

            # Parse and strip the sentinel line
            lines = raw_output.splitlines()
            out_lines = []
            for line in lines:
                if line.startswith("__DRSAI_CWD__:"):
                    new_dir = Path(line[len("__DRSAI_CWD__:"):]).resolve()
                    # Only update cwd if still within allowed dirs
                    if any(new_dir.is_relative_to(d) for d in ALLOWED_DIRS):
                        _cwd[0] = new_dir
                    elif only_in_workspace:
                        out_lines.append(
                            f"Warning: cd target '{new_dir}' is outside workspace; "
                            "cwd not updated"
                        )
                else:
                    out_lines.append(line)
            return ("\n".join(out_lines).strip() or "(no output)")[:50000]

        except Exception as e:
            return f"Error: {e}"


    def run_read(path: str, minilimit: int = None, maxlimit: int = -1) -> str:
        """
        Read file contents.
        
        Args:
            path : Path to file.
            minilimit : The start of  Maximum number of lines to read.
            maxlimit : The end of  Maximum number of lines to read.
        """
        try:
            lines = safe_path(path).read_text().splitlines()
            if minilimit:
                lines = lines[minilimit:maxlimit]
            return "\n".join(lines)[:50000]
        except Exception as e:
            return f"Error: {e}"


    def run_write(path: str, content: str) -> str:
        """Write content to file."""
        try:
            fp = safe_path(path)
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(content)
            return f"Wrote {len(content)} bytes to {path}"
        except Exception as e:
            return f"Error: {e}"


    def run_edit(path: str, old_text: str, new_text: str) -> str:
        """Replace exact text in file."""
        try:
            fp = safe_path(path)
            text = fp.read_text()
            if old_text not in text:
                return f"Error: Text not found in {path}"
            fp.write_text(text.replace(old_text, new_text, 1))
            return f"Edited {path}"
        except Exception as e:
            return f"Error: {e}"


    def run_grep(
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
            # Use ripgrep if available, fallback to grep
            rg_available = subprocess.run(
                ["which", "rg"], capture_output=True, text=True
            ).returncode == 0

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

                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=30
                )
                output = result.stdout

            else:
                # Fallback to grep
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

                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=30
                )
                output = result.stdout

            if not output:
                return "No matches found"

            # Limit results
            lines = output.strip().split("\n")
            if len(lines) > max_results:
                limited = "\n".join(lines[:max_results])
                return f"{limited}\n\n[Showing first {max_results} of {len(lines)} results]"

            return output.strip()[:50000]

        except subprocess.TimeoutExpired:
            return "Error: Search timeout"
        except Exception as e:
            return f"Error: {e}"


    def get_bash_task(task_id: str) -> Dict[str, Any]:
        """
        Get status and output of a background bash task.

        Args:
            task_id: Task ID returned by run_bash with run_in_background=True

        Returns:
            Dict with task status and output:
            {
                "task_id": str,
                "command": str,
                "status": "running"|"completed"|"timeout"|"failed",
                "output": str (if completed),
                "error": str (if failed/timeout),
                "pid": int,
                "pgid": int,
                "start_time": str,
                "end_time": str (if completed)
            }
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


    def list_bash_tasks() -> str:
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


    def kill_bash_task(task_id: str, force: bool = False) -> str:
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
                time.sleep(2)
                # Check if still alive, then force kill
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass  # Already dead
                task_info["status"] = "killed"
                task_info["error"] = "Terminated by user (SIGTERM)"

            task_info["end_time"] = datetime.now().isoformat()
            return f"Task {task_id} (PGID: {pgid}) has been terminated"

        except ProcessLookupError:
            task_info["status"] = "completed"
            task_info["error"] = "Process already terminated"
            return f"Task {task_id} process group already terminated"
        except Exception as e:
            return f"Error killing task {task_id}: {e}"


    def run_glob(
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

            # Use pathlib.glob for pattern matching
            matches = []
            if "**" in pattern:
                # Recursive glob
                matches = list(base_path.glob(pattern))
            else:
                # Non-recursive glob
                matches = list(base_path.glob(pattern))

            # Sort by modification time (newest first)
            matches.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)

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
    _ps_task_counter = [0]

    def run_powershell(
        command: str,
        timeout: int = 200,
        run_in_background: bool = False,
        # dangerous_allowed: bool = False # dangerous_allowed: Allow dangerous commands (default False)
    ) -> Union[str, Dict[str, Any]]:
        """
        Execute PowerShell command in workspace directory.

        The working directory persists across calls, similar to run_bash.
        Supports both PowerShell Core (pwsh) and Windows PowerShell.

        Args:
            command: PowerShell command to execute
            timeout: Timeout in seconds (default 300, max 600)
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

        # Check dangerous patterns (unless explicitly allowed)
        if not allolow_dangrous_cmd and _DANGEROUS_RE.search(command):
            return "Error: Dangerous command detected"

        # Check absolute paths referenced in command
        if only_in_workspace:
            # Also check Windows-style paths (C:\, D:\, etc.)
            win_path_re = re.compile(r'[A-Za-z]:\\')
            if win_path_re.search(command):
                # Extract Windows paths and validate
                for match in re.finditer(r'([A-Za-z]:\\[^\s;|&><\'"]+)', command):
                    path_str = match.group(1)
                    try:
                        resolved = Path(path_str).resolve()
                        if not any(resolved.is_relative_to(d) for d in ALLOWED_DIRS):
                            return f"Error: Path '{path_str}' is outside the allowed workspace"
                    except Exception:
                        pass

            path_err = _check_cmd_paths(command)
            if path_err:
                return path_err

        # Clamp timeout
        timeout = min(max(1, timeout), 600)

        # Background execution
        if run_in_background:
            task_id = f"ps_task_{_ps_task_counter[0]}"
            _ps_task_counter[0] += 1

            task_info = {
                "task_id": task_id,
                "status": "running",
                "output": None,
                "error": None,
                "process": None
            }
            _ps_background_tasks[task_id] = task_info

            def run_bg_task():
                try:
                    # Build PowerShell command with cwd tracking
                    ps_command = f"""
$ErrorActionPreference = 'Continue'
Set-Location '{_ps_cwd[0]}'
{command}
Write-Host "__DRSAI_PS_CWD__:$(Get-Location)"
"""
                    result = subprocess.run(
                        [ps_path, "-NoProfile", "-NonInteractive", "-Command", ps_command],
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        cwd=str(_ps_cwd[0])
                    )

                    raw_output = result.stdout + result.stderr
                    output_lines = []
                    lines = raw_output.splitlines()

                    for line in lines:
                        if line.startswith("__DRSAI_PS_CWD__:"):
                            new_dir_str = line[len("__DRSAI_PS_CWD__:"):].strip()
                            try:
                                new_dir = Path(new_dir_str).resolve()
                                if any(new_dir.is_relative_to(d) for d in ALLOWED_DIRS):
                                    _ps_cwd[0] = new_dir
                            except Exception:
                                pass
                        else:
                            output_lines.append(line)

                    output = "\n".join(output_lines).strip() or "(no output)"
                    task_info["output"] = output[:50000]
                    task_info["status"] = "completed"

                except subprocess.TimeoutExpired:
                    task_info["error"] = f"Command timeout after {timeout}s"
                    task_info["status"] = "failed"
                except Exception as e:
                    task_info["error"] = f"Error: {e}"
                    task_info["status"] = "failed"

            thread = threading.Thread(target=run_bg_task, daemon=True)
            thread.start()

            return {
                "task_id": task_id,
                "status": "running",
                "message": f"Task {task_id} started in background"
            }

        # Foreground execution
        try:
            # Build PowerShell command with cwd tracking
            ps_command = f"""
$ErrorActionPreference = 'Continue'
Set-Location '{_ps_cwd[0]}'
{command}
Write-Host "__DRSAI_PS_CWD__:$(Get-Location)"
"""

            result = subprocess.run(
                [ps_path, "-NoProfile", "-NonInteractive", "-Command", ps_command],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=str(_ps_cwd[0])
            )

            raw_output = result.stdout + result.stderr
            output_lines = []
            lines = raw_output.splitlines()

            for line in lines:
                if line.startswith("__DRSAI_PS_CWD__:"):
                    new_dir_str = line[len("__DRSAI_PS_CWD__:"):].strip()
                    try:
                        new_dir = Path(new_dir_str).resolve()
                        if any(new_dir.is_relative_to(d) for d in ALLOWED_DIRS):
                            _ps_cwd[0] = new_dir
                        elif only_in_workspace:
                            output_lines.append(
                                f"Warning: cd target '{new_dir}' is outside workspace; cwd not updated"
                            )
                    except Exception:
                        pass
                else:
                    output_lines.append(line)

            return ("\n".join(output_lines).strip() or "(no output)")[:50000]

        except subprocess.TimeoutExpired:
            return f"Error: Command timeout after {timeout}s"
        except Exception as e:
            return f"Error: {e}"


    def get_powershell_task(task_id: str) -> Dict[str, Any]:
        """
        Get status and output of a background PowerShell task.

        Args:
            task_id: Task ID returned by run_powershell with run_in_background=True

        Returns:
            Dict with task status and output:
            {
                "task_id": str,
                "status": "running"|"completed"|"failed",
                "output": str (if completed),
                "error": str (if failed)
            }
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
            "status": task_info["status"]
        }

        if task_info["status"] == "completed" and task_info["output"]:
            result["output"] = task_info["output"]
        elif task_info["status"] == "failed" and task_info["error"]:
            result["error"] = task_info["error"]

        return result


    def list_powershell_tasks() -> str:
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
            lines.append(f"  {task_id}: {status}")

        return "\n".join(lines)


    if is_powershell:
        return [
            run_read,
            run_write,
            run_edit,
            run_grep,
            run_glob,
            run_powershell,
            get_powershell_task,
            list_powershell_tasks
            ]
    else:
        return [
            run_bash,
            run_read,
            run_write,
            run_edit,
            run_grep,
            run_glob,
            get_bash_task,
            list_bash_tasks,
            kill_bash_task,
        ]