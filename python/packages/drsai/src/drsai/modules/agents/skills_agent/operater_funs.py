from pathlib import Path
import subprocess


def get_operator_funcs(worker_dir: str )->list[callable]:

    WORKDIR = Path(worker_dir)

    def safe_path(p: str) -> Path:
        """Ensure path stays within workspace."""
        path = (WORKDIR / p).resolve()
        if not path.is_relative_to(WORKDIR):
            raise ValueError(f"Path escapes workspace: {p}")
        return path


    def run_bash(cmd: str) -> str:
        """Execute shell command."""
        if any(d in cmd for d in ["rm -rf /", "sudo", "shutdown"]):
            return "Error: Dangerous command"
        try:
            r = subprocess.run(
                cmd, shell=True, cwd=WORKDIR,
                capture_output=True, text=True, timeout=60
            )
            return ((r.stdout + r.stderr).strip() or "(no output)")[:50000]
        except Exception as e:
            return f"Error: {e}"


    def run_read(path: str, limit: int = None) -> str:
        """
        Read file contents.
        
        Args:
            path : Path to file.
            limit : Maximum number of lines to read.
        """
        try:
            lines = safe_path(path).read_text().splitlines()
            if limit:
                lines = lines[:limit]
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