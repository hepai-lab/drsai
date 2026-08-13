---
name: opendrsai-regression-testing
description: Query, run, monitor, stop, resume, and explain OpenDrSai agent regression tests through normal conversation. Use immediately when the user asks what regression tests exist, requests a test case or suite to run, asks for regression progress/history/failures/evidence, or wants failed tests rerun. Also use for Chinese requests such as “有哪些回归测试”“开始回归测试”“查看测试结果”“重跑失败项”.
---

# OpenDrSai Regression Testing

Use only the `regression_*` tools for catalog and evaluation facts. Never invent a case, result, status, Run ID, assertion, or evidence link from memory.

## Route the intent

1. For listing or filtering, call `regression_list_suites` and then `regression_list_cases`.
2. For a case explanation, resolve it from the current catalog and call `regression_get_case`.
3. For history, progress, failures, or reruns, call `regression_history` or `regression_get` before answering.
4. For execution, resolve the exact current case references, preflight them, apply the confirmation rules, and call `regression_start` once.
5. For stopping, call `regression_cancel`; do not merely say the run was stopped.

Accept stable IDs, titles, ordinal references such as “第三个”, tags, “全部”, and “上次失败项”. If selection is ambiguous, show the matches and ask one concise question.

## Confirm execution scope

Run a safe, explicit, single case without another confirmation. Ask for confirmation before starting when any condition applies:

- more than one case will run;
- the case can write data, request approval, create external side effects, or consume notable paid resources;
- preflight reports risk or requires a model, workspace, fixture, network, or Judge choice.

State the resolved cases and reported risks in the confirmation. Use the returned confirmation token; never fabricate one. Never approve an approval request on the user's behalf.

## Execute deterministically

1. Call `regression_preflight` with the resolved suite and case IDs.
2. Stop and explain exact missing requirements when preflight is blocked.
   When blocked, do not inspect repository files, invoke shell or workspace
   tools, run `run_regression.py`, switch to the fixture adapter, or construct
   a result by any alternate path. Only a later successful
   `regression_preflight` may permit `regression_start`.
3. Call `regression_start` with the current catalog revision and case references. Preserve the returned evaluation ID.
   Pass `options.failure_policy` as `stop` only when the user asks to stop after the first failure; otherwise use `continue` or omit options.
4. Read `regression_events` using its cursor and report only meaningful stage changes, case boundaries, approvals, artifacts, failures, and terminal results.
5. Call `regression_get` for the authoritative terminal result.
6. Treat only the assertion engine's terminal status as the verdict. Never turn `blocked`, missing Judge evidence, or a completed Run into `passed`.

Do not execute YAML as shell, accept arbitrary definition paths, edit baselines during a run, use a “most recent Run” heuristic, or retry beyond the declared policy.

## Report clearly

Lead with the verdict. Include:

- passed, failed, blocked, and cancelled counts;
- duration and attempts;
- each failed or blocked assertion with expected value, actual value, and next action;
- model and the evaluation/case revision/thread/run correlation;
- interactive citations for Result, Evidence Manifest, source evidence, and produced artifacts.

Distinguish execution failure from inability to evaluate. Use the citation/resource objects returned by tools; do not expose raw absolute paths or secrets.

Read [references/result-interpretation.md](references/result-interpretation.md) when explaining assertion groups, terminal states, rerun eligibility, or evidence citations.
