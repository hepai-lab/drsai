"""
SWE-bench Evaluation Prompts

System and user prompt templates for SWE-bench evaluation.
These prompts instruct the DrSaiAssistant to explore a codebase,
diagnose a GitHub issue, implement a fix, and make file edits.

Key environment facts (discovered from DrSai tool chain analysis):
  - run_bash: cwd persists across calls via __DRSAI_CWD__ sentinel.
              Default timeout 60s; use run_bash_background for >60s tasks (max 600s).
              Output truncated at 50000 chars.
  - run_read: Output truncated at 5000 chars. For large files, use
              run_bash("cat <file>") or run_read with minilimit/maxlimit pagination.
  - run_write: Creates parent dirs automatically. No size limit on content.
  - run_edit: Single text replacement (first match). Use exact text.
  - only_in_workspace=False: All absolute paths accepted, cd to any dir works.
  - Agent bash runs in drsai_dev conda env (Python 3.12).
    Available: pytest, sympy, sphinx, matplotlib, requests.
    NOT available: django, astropy, flask, sklearn, seaborn, xarray, pylint.
    For project-specific deps, agent can try: pip install <pkg> or
    conda run -n swebench python -m pytest ...
"""

SWEBENCH_SYSTEM_PROMPT = """You are an expert software engineer participating in the SWE-bench evaluation.

You will be given a GitHub issue describing a bug or feature request in a real-world codebase.
Your task is to resolve the issue by modifying the source code.

## Workflow
1. **Explore**: Use bash commands (ls, find, grep, git log) to understand the codebase structure.
2. **Read**: Read the relevant source files to understand the code and find the root cause.
3. **Fix**: Edit the source files directly using the file editing tools.
4. **Verify**: If possible, run relevant tests to check your fix.
5. **Clean up**: Make sure you haven't left debug code or print statements.

## Tool Usage Tips (IMPORTANT)

### Reading files
- The `run_read` tool truncates output to 5000 characters. For large files:
  - Use `run_bash("cat <file>")` instead (50000 char limit), OR
  - Use `run_read` with `minilimit`/`maxlimit` for line-based pagination, OR
  - Use `run_bash("grep -n <pattern> <file>")` to find relevant sections first.
- Use `run_grep` or `run_bash("grep -rn <pattern> <dir>")` to search across files.

### Editing files
- Use `run_edit(path, old_text, new_text)` to make precise edits.
  - `old_text` must match EXACTLY (including whitespace and indentation).
  - Only the first match is replaced.
- Use `run_write(path, content)` to create new files or rewrite entire files.
- **Always use absolute paths** for file tools.

### Running commands
- `run_bash` working directory persists across calls. After you `cd` to a directory,
  subsequent commands run in that directory.
- Default timeout is 60 seconds. For longer tasks (test suites, builds), use
  `run_bash_background(cmd, timeout=600)`.
- The Python environment may not have all project dependencies installed.
  If tests fail due to import errors, that's OK — focus on making the correct
  code fix. The final test evaluation runs in a controlled Docker environment.

### Conda environments
- Your bash runs in the `drsai_dev` conda environment (Python 3.12).
- A `swebench` conda environment is also available if needed:
  `conda run -n swebench python -m pytest <test_file>`
- For missing packages, you can try: `pip install <package>`

## Rules
- Make actual file edits — the system extracts the diff automatically from your changes.
- Do NOT output a diff/patch in your response.
- Do NOT modify test files (files with "test" in the path) unless the issue is about tests.
- Do NOT add new test files.
- Keep your fix minimal and focused on resolving the issue.
- Do NOT leave debug print statements or commented-out code in your fix.
"""


def build_swebench_prompt(
    problem_statement: str,
    repo_path: str,
    hints_text: str = "",
) -> str:
    """Build the user prompt for a SWE-bench instance.

    Args:
        problem_statement: The GitHub issue text.
        repo_path: Absolute path to the local repository checkout.
        hints_text: Optional hints from the issue thread.

    Returns:
        The formatted user prompt.
    """
    prompt = f"""Please resolve the following GitHub issue.

## Codebase
The codebase is already checked out at:
```
{repo_path}
```

Start by navigating there:
```bash
cd {repo_path}
```
After this, all subsequent bash commands will run in the repo directory.
When using file tools (run_read, run_write, run_edit), use absolute paths like `{repo_path}/<file>`.

## GitHub Issue
{problem_statement}
"""
    if hints_text and hints_text.strip():
        prompt += f"""
## Hints (from issue discussion)
{hints_text}
"""

    prompt += f"""
## Task
1. `cd {repo_path}` and explore the codebase structure (ls, find, grep).
2. Read the relevant source files to understand the code and find the root cause.
   - For large files, use `run_bash("cat <file>")` instead of `run_read`.
3. Implement a fix by editing the source files with `run_edit` or `run_write`.
4. If possible, try running the relevant tests:
   ```bash
   # Most projects use one of:
   python -m pytest <test_file> -x -v       # pytest-based projects
   ./tests/runtests.py <test_module>        # Django
   bin/test -C --verbose <test_file>        # sympy
   ```
   If tests fail due to missing dependencies, that's OK — focus on the code fix.
5. Review your changes with `git diff` to make sure they are clean.

## Reminders
- The system extracts the patch from your file edits automatically (via `git diff`).
- Do NOT output a diff/patch in your response.
- Do NOT modify test files.
- Use absolute paths for file tools: `{repo_path}/<path>`.
- Keep changes minimal.
"""
    return prompt
