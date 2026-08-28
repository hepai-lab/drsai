"""Exercise a real Realtime Provider session without exposing credentials.

The runner creates Provider speech, loops the returned PCM back through the
input-audio channel, interrupts a second response, and completes a no-op tool
round trip. It emits bounded observations and a WAV attachment; transcript
content and raw Provider events are intentionally never persisted.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import time
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--agent", default="opendrsai")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--audio-output", type=Path, required=True)
    return parser.parse_args()


def event_type(event: dict[str, Any]) -> str:
    return str(event.get("type") or "")


def provider_error(event: dict[str, Any]) -> RuntimeError:
    error = event.get("error") if isinstance(event.get("error"), dict) else {}
    code = str(error.get("code") or "provider_error")[:120]
    return RuntimeError(f"Realtime Provider returned {code}")


async def next_matching(
    events: Any,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout: float,
    observe: Callable[[dict[str, Any]], None],
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Timed out waiting for a bounded Realtime event")
        event = await asyncio.wait_for(events.__anext__(), timeout=remaining)
        if event_type(event) == "error":
            raise provider_error(event)
        observe(event)
        if predicate(event):
            return event


async def run() -> int:
    args = parse_args()
    os.environ["DRSAI_HOME"] = str(args.home.expanduser().resolve())

    from drsai.config import load_agent_model_policy, load_user_config as load_model_provider_config, resolve_model_ref
    from drsai.config.realtime_audio_adapter import OpenAIRealtimeAudioAdapter

    policy = (await asyncio.to_thread(load_agent_model_policy, args.agent)).policy
    selection = policy.realtime_voice_model
    if selection is None or selection.ref is None or selection.mode != "explicit":
        raise RuntimeError("Agent has no explicit Realtime voice model")
    config = await asyncio.to_thread(load_model_provider_config)
    resolved = await asyncio.to_thread(
        resolve_model_ref,
        config,
        provider_id=selection.ref.provider_id,
        model_id=selection.ref.model_id,
        require_credentials=True,
    )

    observed: dict[str, Any] = {
        "sessionReady": False,
        "inputAudio": False,
        "inputTranscript": False,
        "outputAudio": False,
        "outputTranscript": False,
        "interruption": False,
        "conversationTruncation": False,
        "toolCall": False,
        "toolRoundTrip": False,
    }
    metrics: dict[str, Any] = {"outputAudioBytes": 0, "sessionReadyMs": None, "firstAudioMs": None, "cancelMs": None}
    audio = bytearray()
    active_response_id: str | None = None
    active_item_id: str | None = None
    response_done_count = 0
    phase_started = time.monotonic()

    def observe(event: dict[str, Any]) -> None:
        nonlocal active_response_id, active_item_id, response_done_count
        kind = event_type(event)
        if kind in {"session.created", "session.updated"}:
            observed["sessionReady"] = True
            metrics["sessionReadyMs"] = round((time.monotonic() - phase_started) * 1000)
        if kind == "response.created" and isinstance(event.get("response"), dict):
            value = event["response"].get("id")
            if isinstance(value, str):
                active_response_id = value
        if kind in {"response.audio.delta", "response.output_audio.delta"}:
            delta = event.get("delta")
            if isinstance(delta, str):
                decoded = base64.b64decode(delta, validate=True)
                if decoded:
                    if not observed["outputAudio"]:
                        metrics["firstAudioMs"] = round((time.monotonic() - phase_started) * 1000)
                    observed["outputAudio"] = True
                    audio.extend(decoded)
            item = event.get("item_id")
            if isinstance(item, str):
                active_item_id = item
        if kind in {"response.audio_transcript.done", "response.output_audio_transcript.done"}:
            observed["outputTranscript"] = isinstance(event.get("transcript"), str) and bool(event["transcript"].strip())
        if kind == "conversation.item.input_audio_transcription.completed":
            observed["inputTranscript"] = isinstance(event.get("transcript"), str) and bool(event["transcript"].strip())
        if kind == "response.done":
            response_done_count += 1

    adapter = OpenAIRealtimeAudioAdapter()
    try:
        await adapter.connect(resolved)
        events = adapter.events().__aiter__()
        await adapter.send_json({
            "type": "session.update",
            "session": {
                "type": "realtime",
                "model": selection.ref.model_id,
                "instructions": "Keep acceptance-test replies short. Use the requested tool whenever explicitly asked.",
                "output_modalities": ["audio"],
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "transcription": {"model": "gpt-4o-mini-transcribe"},
                        "turn_detection": None,
                    },
                    "output": {"format": {"type": "audio/pcm", "rate": 24000}},
                },
                "tool_choice": "auto",
                "tools": [{
                    "type": "function",
                    "name": "realtime_probe_noop",
                    "description": "No-op used only for a bounded acceptance test.",
                    "parameters": {"type": "object", "additionalProperties": False, "properties": {}},
                }],
            },
        })
        await next_matching(events, lambda event: event_type(event) == "session.updated", timeout=20, observe=observe)

        # Generate a short Provider-owned speech fixture and retain only PCM.
        phrase_item = f"acceptance-{uuid.uuid4().hex[:12]}"
        await adapter.send_json({
            "type": "conversation.item.create",
            "item": {"id": phrase_item, "type": "message", "role": "user", "content": [{"type": "input_text", "text": "Speak exactly this short phrase: Open Dr Sai realtime acceptance one two three."}]},
        })
        await adapter.send_json({"type": "response.create"})
        await next_matching(events, lambda event: event_type(event) == "response.done", timeout=45, observe=observe)
        if not audio:
            raise RuntimeError("Realtime Provider returned no output audio")
        seed_audio = bytes(audio)
        metrics["outputAudioBytes"] = len(seed_audio)

        # Loop the real Provider PCM through the audio-input and transcription path.
        for sequence, offset in enumerate(range(0, len(seed_audio), 24_000)):
            chunk = seed_audio[offset:offset + 24_000]
            await adapter.send_json({
                "type": "input_audio_buffer.append",
                "event_id": f"opendrsai_live_audio_{sequence}",
                "audio": base64.b64encode(chunk).decode("ascii"),
            })
        await adapter.send_json({"type": "input_audio_buffer.commit"})
        observed["inputAudio"] = True
        replay_response_floor = response_done_count
        await adapter.send_json({"type": "response.create"})
        await next_matching(events, lambda _event: observed["inputTranscript"] and response_done_count > replay_response_floor, timeout=60, observe=observe)

        # Start a deliberately long answer, cancel after first audio, then truncate.
        active_response_id = None
        active_item_id = None
        await adapter.send_json({
            "type": "conversation.item.create",
            "item": {"id": f"cancel-{uuid.uuid4().hex[:12]}", "type": "message", "role": "user", "content": [{"type": "input_text", "text": "Count slowly from one to fifty, with a pause between every number."}]},
        })
        await adapter.send_json({"type": "response.create"})
        await next_matching(events, lambda event: event_type(event) in {"response.audio.delta", "response.output_audio.delta"}, timeout=30, observe=observe)
        if not active_response_id:
            raise RuntimeError("Realtime cancel test has no response identity")
        cancel_started = time.monotonic()
        await adapter.send_json({"type": "response.cancel", "response_id": active_response_id})
        cancelled = await next_matching(
            events,
            lambda event: event_type(event) == "response.done" and isinstance(event.get("response"), dict) and event["response"].get("id") == active_response_id,
            timeout=15,
            observe=observe,
        )
        cancel_status = cancelled.get("response", {}).get("status") if isinstance(cancelled.get("response"), dict) else None
        observed["interruption"] = cancel_status in {"cancelled", "incomplete"}
        metrics["cancelMs"] = round((time.monotonic() - cancel_started) * 1000)
        if active_item_id:
            await adapter.send_json({"type": "conversation.item.truncate", "item_id": active_item_id, "content_index": 0, "audio_end_ms": 40})
            observed["conversationTruncation"] = True

        # Require the declared no-op tool and complete its result round trip.
        await adapter.send_json({
            "type": "conversation.item.create",
            "item": {"id": f"tool-{uuid.uuid4().hex[:12]}", "type": "message", "role": "user", "content": [{"type": "input_text", "text": "Call realtime_probe_noop now, then briefly confirm completion."}]},
        })
        await adapter.send_json({"type": "response.create", "response": {"tool_choice": "required"}})
        tool = await next_matching(events, lambda event: event_type(event) == "response.function_call_arguments.done", timeout=30, observe=observe)
        call_id = tool.get("call_id")
        observed["toolCall"] = isinstance(call_id, str) and bool(call_id)
        if not observed["toolCall"]:
            raise RuntimeError("Realtime Provider tool call omitted call_id")
        await adapter.send_json({
            "type": "conversation.item.create",
            "item": {"type": "function_call_output", "call_id": call_id, "output": json.dumps({"ok": True}, separators=(",", ":"))},
        })
        await adapter.send_json({"type": "response.create", "response": {"tool_choice": "none"}})
        await next_matching(events, lambda event: event_type(event) == "response.done", timeout=30, observe=observe)
        observed["toolRoundTrip"] = True
    finally:
        await adapter.close()

    audio_path = args.audio_output.resolve()
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(audio_path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(seed_audio)
    audio_sha = hashlib.sha256(audio_path.read_bytes()).hexdigest()
    report = {
        "schemaVersion": 1,
        "kind": "duplex-live-provider-run",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "providerId": selection.ref.provider_id,
        "modelId": selection.ref.model_id,
        "observed": observed,
        "metrics": metrics,
        "attachments": [{"uri": audio_path.as_uri(), "sha256": audio_sha}],
        "privacy": {"rawEventsPersisted": False, "transcriptTextPersisted": False, "credentialsPersisted": False},
    }
    report_path = args.output.resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if all(observed.values()) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
