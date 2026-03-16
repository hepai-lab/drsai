from pathlib import Path
import subprocess
import re

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
    r'\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+/',  # rm -rf /...
    r'\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+/',                             # rm -r /...
]
_DANGEROUS_RE = re.compile('|'.join(_DANGEROUS_PATTERNS), re.IGNORECASE)

# Regex to extract absolute paths from shell commands
_ABS_PATH_RE = re.compile(r'(?:^|[\s=\'",;|&<>(){}])(/(?:[^\s;|&><\'"\\{}()]+))')


def get_operator_funcs(worker_dir: str|Path, extra_dirs: list[str|Path] = None, only_in_workspace: bool = True )->list[callable]:

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

    def run_bash(cmd: str) -> str:
        """Execute shell command in workspace directory.

        The working directory persists across calls: cd commands take effect
        for subsequent invocations, as long as the target stays within the
        allowed workspace.
        """
        # Check dangerous patterns
        if _DANGEROUS_RE.search(cmd):
            return "Error: Dangerous command detected"
        # Check absolute paths referenced in command
        if only_in_workspace:
            path_err = _check_cmd_paths(cmd)
            if path_err:
                return path_err
        try:
            # Append a sentinel so we can capture the resulting directory
            wrapped = f'{cmd}\necho "__DRSAI_CWD__:$(pwd)"'
            r = subprocess.run(
                wrapped, shell=True, cwd=_cwd[0],
                capture_output=True, text=True, timeout=90
            )
            raw = r.stdout + r.stderr
            # Parse and strip the sentinel line
            lines = raw.splitlines()
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
    
    return [run_bash, run_read, run_write, run_edit]