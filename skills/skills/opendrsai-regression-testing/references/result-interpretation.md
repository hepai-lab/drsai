# Result interpretation

## Terminal states

- `passed`: every required assertion completed and passed.
- `failed`: execution or at least one required assertion definitively failed.
- `blocked`: a required environment, permission, tool, model, Judge, or trustworthy evidence source was unavailable.
- `cancelled`: cancellation was acknowledged; report completed cases and known side effects separately.

Never describe `running`, `collecting_evidence`, `evaluating`, or a completed Agent Run as a regression-test pass.

## Assertion order

Explain failures in this order: Run terminal state; environment and input; tool/Skill/knowledge/approval behavior; output structure and deterministic content; citations and artifacts; semantic or media evaluation; Desktop user-experience evidence.

For every failed assertion, report its stable assertion ID or group, expected value, observed value, evidence reference, and the smallest actionable next step.

## Reruns

Resolve “rerun failed tests” from a persisted evaluation. Include only cases whose current revision and definition hash match that evaluation. If a definition changed, report it as a new version and request confirmation before running it.

Do not silently widen the scope, retry past the case policy, or overwrite an earlier result.

## Citations

Prefer controlled resource links returned by the regression service. Link the Result and Evidence Manifest once, then link assertion-specific evidence or artifacts next to the claims they support. Do not cite inaccessible local paths, unverified model prose, or the case definition as proof that runtime behavior occurred.
