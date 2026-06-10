---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session
---

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Why subagents:** You delegate tasks to specialized agents with isolated context via the `Delegate` tool. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**DrSai Delegate tool:** Use `agent_type="general"` for implementation, `agent_type="explore"` for review. The `prompt` parameter contains the full task instructions. Use `context` for optional background information.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

**Continuous execution:** Do not pause to check in with your human partner between tasks. Execute all tasks from the plan without stopping. The only reasons to stop are: BLOCKED status you cannot resolve, ambiguity that genuinely prevents progress, or all tasks complete. "Should I continue?" prompts and progress summaries waste their time — they asked you to execute the plan, so execute it.

## When to Use

- You have an implementation plan with independent tasks
- You want to stay in the current session (vs. separate session for executing-plans)
- Tasks are mostly independent (no tight coupling)

**vs. Executing Plans:**
- Same session (no context switch)
- Fresh subagent per task (no context pollution)
- Two-stage review after each task: spec compliance first, then code quality
- Faster iteration (no human-in-loop between tasks)

## The Process

### Step 1: Read and Parse Plan
1. Read the plan file
2. Extract all tasks with full text
3. Note any shared context needed across tasks
4. Create TodoWrite with all tasks

### Step 2: Per-Task Loop

For each task:
1. **Dispatch implementer subagent** using `Delegate` with the implementer-prompt instructions (from `./implementer-prompt.md`)
2. If implementer asks questions: answer and re-dispatch
3. If implementer reports DONE: proceed to spec review
4. **Dispatch spec reviewer subagent** using `Delegate` with spec-reviewer instructions (from `./spec-reviewer-prompt.md`)
5. If spec gaps found: implementer fixes, re-review
6. **Dispatch code quality reviewer subagent** using `Delegate` with code-quality-reviewer instructions (from `./code-quality-reviewer-prompt.md`)
7. If quality issues found: implementer fixes, re-review
8. Mark task complete in TodoWrite

### Step 3: Completion

After all tasks:
- Dispatch a final code reviewer subagent for the entire implementation
- Run the full test suite to confirm everything passes
- Report completion to user

## Model Selection

Use the least powerful model that can handle each role to conserve cost and increase speed.

**Mechanical implementation tasks** (isolated functions, clear specs, 1-2 files): use a fast, cheap model. Most implementation tasks are mechanical when the plan is well-specified.

**Integration and judgment tasks** (multi-file coordination, pattern matching, debugging): use a standard model.

**Architecture, design, and review tasks**: use the most capable available model.

**Task complexity signals:**
- Touches 1-2 files with a complete spec → cheap model
- Touches multiple files with integration concerns → standard model
- Requires design judgment or broad codebase understanding → most capable model

## Handling Implementer Status

Implementer subagents report one of four statuses. Handle each appropriately:

**DONE:** Proceed to spec compliance review.

**DONE_WITH_CONCERNS:** The implementer completed the work but flagged doubts. Read the concerns before proceeding. If the concerns are about correctness or scope, address them before review. If they're observations (e.g., "this file is getting large"), note them and proceed to review.

**NEEDS_CONTEXT:** The implementer needs information that wasn't provided. Provide the missing context and re-dispatch.

**BLOCKED:** The implementer cannot complete the task. Assess the blocker:
1. If it's a context problem, provide more context and re-dispatch
2. If the task requires more reasoning, re-dispatch with a more capable subagent type
3. If the task is too large, break it into smaller pieces
4. If the plan itself is wrong, escalate to the human

**Never** ignore an escalation or force the same approach to retry without changes. If the implementer said it's stuck, something needs to change.

## Prompt Templates

- `./implementer-prompt.md` - Use as `prompt` for `Delegate` with `agent_type="general"`
- `./spec-reviewer-prompt.md` - Use as `prompt` for `Delegate` with `agent_type="explore"`
- `./code-quality-reviewer-prompt.md` - Use as `prompt` for `Delegate` with `agent_type="explore"`

## Example Workflow

```
You: I'm using Subagent-Driven Development to execute this plan.

[Read plan file once: docs/superpowers/plans/feature-plan.md]
[Extract all 5 tasks with full text and context]
[Create TodoWrite with all tasks]

Task 1: Hook installation script

[Get Task 1 text and context (already extracted)]
[Delegate: agent_type="general", prompt=<implementer-prompt.md + task text>]

Implementer: "Before I begin - should the hook be installed at user or system level?"

You: "User level (~/.config/superpowers/hooks/)"

Implementer: "Got it. Implementing now..."
[Later] Implementer:
  - Implemented install-hook command
  - Added tests, 5/5 passing
  - Self-review: Found I missed --force flag, added it
  - Committed

[Delegate: agent_type="explore", prompt=<spec-reviewer-prompt.md + task context>]
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra

[Delegate: agent_type="explore", prompt=<code-quality-reviewer-prompt.md>]
Code reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Mark Task 1 complete]

Task 2: Recovery modes

[Delegate: agent_type="general", prompt=<implementer-prompt.md + task text>]

Implementer: [No questions, proceeds]
Implementer:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Delegate: agent_type="explore", prompt=<spec-reviewer-prompt.md>]
Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)

[Implementer fixes issues]
Implementer: Removed --json flag, added progress reporting

[Spec reviewer reviews again]
Spec reviewer: ✅ Spec compliant now

[Delegate: agent_type="explore", prompt=<code-quality-reviewer-prompt.md>]
Code reviewer: Strengths: Solid. Issues (Important): Magic number (100)

[Implementer fixes]
Implementer: Extracted PROGRESS_INTERVAL constant

[Code reviewer reviews again]
Code reviewer: ✅ Approved

[Mark Task 2 complete]

...

[After all tasks]
[Dispatch final code-reviewer]
Final reviewer: All requirements met, ready to merge

Done!
```

## Advantages

**vs. Manual execution:**
- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Parallel-safe (subagents don't interfere)
- Subagent can ask questions (before AND during work)

**Efficiency gains:**
- No file reading overhead (controller provides full text)
- Controller curates exactly what context is needed
- Subagent gets complete information upfront