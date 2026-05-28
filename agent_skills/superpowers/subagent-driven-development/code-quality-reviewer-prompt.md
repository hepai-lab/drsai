# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent via DrSai's `Delegate` tool.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Only dispatch after spec compliance review passes.**

```
Delegate:
  agent_type: "explore"
  description: "Review code quality for Task N: [task summary]"
  prompt: |
    You are reviewing code quality for a completed implementation task.

    ## Task Description

    [What the task was implementing]

    ## Review Scope

    BASE: [commit before task]
    HEAD: [current commit]

    ## Code Quality Checklist

    **Design:**
    - Does each file have one clear responsibility with a well-defined interface?
    - Are units decomposed so they can be understood and tested independently?
    - Is the implementation following the file structure from the plan?
    - Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)

    **Correctness:**
    - Does the code handle edge cases?
    - Is error handling appropriate?
    - Are there any race conditions or timing issues?

    **Testing:**
    - Are tests comprehensive and meaningful?
    - Do tests verify behavior (not mocks)?
    - Are edge cases tested?

    **Clarity:**
    - Are names clear and descriptive (describe what, not how)?
    - Is the code self-documenting?
    - Are comments used only where code can't speak for itself?

    **Discipline:**
    - Does the code follow DRY without premature abstraction?
    - Does it follow YAGNI (no speculative features)?
    - Does it follow existing patterns in the codebase?

    ## Report Format

    **Strengths:** What's well done

    **Issues:**
    - Critical: Must fix before merge (bugs, missing requirements)
    - Important: Should fix (design problems, maintainability)
    - Minor: Nice to fix (naming, style)

    **Assessment:** APPROVED / NEEDS_FIXES (list what)
  context: [Optional: path to plan file and relevant project context]
```