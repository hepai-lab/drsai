# Remote Agent Human-in-the-Loop Integration Design

Status: implementation design, 2026-07-29

## 1. Goal

Allow a remote agent invoked through Desktop to pause safely, ask a person for
input, resume exactly once after a response, and continue streaming through the
same conversation.

The design reuses Desktop's existing interaction and approval surfaces. It does
not introduce a Magentic-UI-only dialog or a second approval authority.

Route:

```text
Desktop -> DDF /apiv2 -> worker
Desktop <- DDF SSE <- worker

Desktop -> DDF interaction response -> the worker that owns the paused chat
```

## 2. Evidence from the reported run

Thread `thread-6b501c75-d55a-48af-8cb0-9566fb82062c`, Desktop run
`9913a600-9c08-475c-9bba-7d8a0ba01ddd`, ended with:

1. streamed text ending in `Reflector ... Validating decay chain...`;
2. `step-0004` (`Reflector response`) marked completed;
3. a normal `[DONE]`;
4. no `agent.input_request` event.

Therefore Desktop did not suppress a received interaction in this run. The
worker or its adapter converted a paused/waiting state into a successful stream
termination.

## 3. Existing capabilities and gaps

Desktop already supports:

- `agent.input_request` SSE parsing;
- text and approval prompts;
- structured `interaction` parts with `approval`, `text_input`, `choice`, and
  `confirmation`;
- submitting a response through `respondChatInput`;
- durable thread snapshots and run-event replay;
- the Approval Center for privileged local operations.

Gaps:

- the SSE parser only retains `prompt` and `text_input | approval`;
- the remote `request_id` is discarded and confused with the Desktop run ID;
- choice metadata, defaults, custom input, cancellation and expiry are absent;
- the current remote reply API is a portal Native API route although execution
  uses DDF `base_url`;
- a received input request does not prevent a following accidental `completed`
  terminal from closing the turn;
- pending interactions do not have a defined restart/reconnect recovery path.

## 4. Canonical interaction contract

Worker emits:

```sse
event: agent.input_request
data: {
  "version": 1,
  "request_id": "input-uuid",
  "chat_id": "thread-uuid",
  "run_id": "run-uuid",
  "input_type": "choice",
  "prompt": "Which decay channel should be validated?",
  "options": [
    {"id": "mumu", "label": "J/psi -> mu+ mu-", "value": "mumu"},
    {"id": "ee", "label": "J/psi -> e+ e-", "value": "ee"}
  ],
  "default": "mumu",
  "allow_custom": true,
  "timeout_at": "2026-07-29T13:00:00Z",
  "metadata": {"source": "magentic-ui"}
}
```

Required fields are `version`, `request_id`, `chat_id`, `run_id`,
`input_type`, and `prompt`. Limits:

- prompt: 20,000 characters;
- options: at most 50;
- option ID: 200 characters, unique in the request;
- option label: 1,000 characters;
- option value: 10,000 characters;
- metadata: bounded, non-secret scalar values only.

Supported input types:

| Type | Desktop presentation | Response |
|---|---|---|
| `text_input` | inline text editor | `{"text":"..."}` |
| `choice` | option buttons/select, optional custom editor | `{"option_id":"...","value":"..."}` |
| `approval` | Approve / Reject | `{"decision":"approved"}` or `{"decision":"rejected"}` |
| `confirmation` | Continue / Cancel | `{"decision":"confirmed"}` or `{"decision":"cancelled"}` |

Worker then emits an `interaction` part update with status `completed` and the
redacted/display-safe response, resumes step/content streaming, emits one
terminal event, and finally `[DONE]`.

## 5. State machine

```text
running
  -> awaiting_input
      -> responding
          -> running
          -> awaiting_input       (retryable delivery failure)
          -> failed               (non-retryable rejection)
      -> cancelled                (user cancel)
      -> expired                  (timeout)
  -> completed | failed | cancelled
```

Rules:

1. `agent.input_request` is non-terminal. The worker must not emit
   `terminal:completed` or `[DONE]` while the request is pending.
2. At most one active input request exists per run in phase one. A later request
   replaces nothing; it is rejected until the active request is resolved.
3. The first valid response wins. Same request and same response is an
   idempotent replay. Same request and different response returns conflict.
4. Cancellation and response race atomically. Only one can win.
5. A worker restart must either recover the paused state or emit an explicit
   `interaction_lost` failure. It must never silently complete.

## 6. DDF responsibilities

DDF forwards `agent.input_request` unchanged and records the owner mapping:

```text
authenticated user + model + chat_id + run_id + request_id -> worker_id
```

Recommended response API:

```http
POST /apiv2/agents/input
Authorization: Bearer <same user credential>
Idempotency-Key: <request_id>
Content-Type: application/json

{
  "model": "drsai_v3_test",
  "chat_id": "...",
  "run_id": "...",
  "request_id": "input-uuid",
  "response": {"option_id":"mumu","value":"mumu"}
}
```

Responses:

- `200 accepted` or idempotent replay;
- `400 invalid_response`;
- `403 interaction_forbidden`;
- `404 interaction_not_found`;
- `409 interaction_conflict`;
- `410 interaction_expired`;
- `503 worker_unavailable`.

DDF must route to the worker that owns the paused run, not perform a fresh model
selection. Authentication headers and user isolation match the original chat.

## 7. Desktop responsibilities

Desktop keeps two separate identities:

- `runRequestId`: local stream/run correlation;
- `interactionRequestId`: remote, one-time response correlation.

On an input request Desktop:

1. validates and bounds the payload;
2. persists the interaction part in the thread snapshot;
3. marks the assistant turn `awaiting_input`, not completed;
4. renders the existing structured interaction card inline;
5. sends privileged operations through the existing Approval Center;
6. sends ordinary text/choice/confirmation responses directly to DDF;
7. disables controls only after DDF accepts the response;
8. shows retryable delivery errors without losing the entered value;
9. restores pending cards after task switching or Desktop restart.

Raw payloads, IDs, timing, retry results, and transport errors go to Debug.
The conversation shows only the prompt, options, selected response, and status.

## 8. Compatibility policy

- Legacy `{input_type,prompt}` remains accepted. Desktop synthesizes a stable
  interaction ID from the run ID and sequence, but DDF response capability must
  be advertised before enabling its controls.
- WebUI `text_input` and `approval` map directly.
- Structured conversation `interaction` remains the Desktop UI model.
- Local Codex approvals continue using the Approval Center and are not sent to
  the remote-agent endpoint.
- Unknown future input types render as safe text input only when
  `allow_custom=true`; otherwise Desktop shows an unsupported-interaction error.

## 9. Failure handling

- Invalid input event: keep the stream running, write a Debug protocol error,
  and show a non-sensitive notice.
- Completed terminal while input is pending: treat as
  `protocol_violation`, preserve the prompt, and do not show success.
- Network loss while awaiting input: keep the interaction pending and reconnect.
- Response delivery timeout: keep controls enabled and offer retry.
- Worker gone: show `worker_unavailable`; preserve the response draft.
- Expired request: disable controls and offer a new user message to restart the
  decision.
- Duplicate or stale response: never start a second worker execution.

## 10. Automated acceptance

### Contract/unit

1. Parse all four input types and legacy payloads.
2. Reject missing/oversized/duplicate option fields.
3. Preserve remote `request_id`, `chat_id`, and `run_id`.
4. Prove run ID and interaction ID never alias accidentally.
5. Validate response bodies and redaction.
6. Verify same response replay and conflicting response behavior.

### Desktop integration

1. Stream content -> input request -> select option -> resumed content ->
   terminal completed -> `[DONE]`.
2. Switch tasks and return: one pending card remains pending.
3. Restart Desktop: pending card and draft are restored.
4. Delivery timeout: retry succeeds without a second execution.
5. Reject/cancel/expire paths produce one correct terminal state.
6. A terminal completed received while pending becomes a visible protocol
   failure, never success.

### Three-service E2E

1. Real `drsai_v3_test` produces a harmless choice request.
2. DDF logs one original invoke and one response dispatch, with the same
   chat/run/request IDs.
3. Worker logs one pause and one resume.
4. Desktop displays the prompt and options, then continued step/tool/result
   output.
5. Repeat response proves idempotency and no duplicate invoke/billing.
6. Cancel during awaiting input proves no late content or completed terminal.

## 11. Delivery gates

- Gate H1: freeze and test the SSE and response schemas.
- Gate H2: worker emits and resumes a synthetic harmless interaction.
- Gate H3: DDF forwards, owns, authenticates, and idempotently routes responses.
- Gate H4: Desktop renders, persists, responds, retries, and restores.
- Gate H5: real three-service choice, approval, text, cancel, restart, and
  protocol-violation tests pass.
