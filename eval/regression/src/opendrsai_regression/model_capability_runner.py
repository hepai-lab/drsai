from __future__ import annotations

import ast
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request
import uuid
from xml.etree import ElementTree

import yaml


class ModelCapabilityError(RuntimeError):
    pass


def load_profile(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema_version") != "opendrsai.model-capability-profile/1":
        raise ModelCapabilityError("Unsupported model capability profile")
    if not isinstance(value.get("models"), list) or not value["models"]:
        raise ModelCapabilityError("Model capability profile has no models")
    seen: set[tuple[str, str]] = set()
    for model in value["models"]:
        if not isinstance(model, dict) or not isinstance(model.get("role"), str) or not isinstance(model.get("model_id"), str):
            raise ModelCapabilityError("Model capability profile contains an invalid model")
        operations = model.get("required_operations")
        if not isinstance(operations, list) or not operations or not all(isinstance(item, str) for item in operations):
            raise ModelCapabilityError("Model capability profile contains invalid operations")
        runtime_operations = model.get("runtime_required_operations", operations)
        if (not isinstance(runtime_operations, list)
                or not all(isinstance(item, str) for item in runtime_operations)
                or not set(runtime_operations).issubset(set(operations))):
            raise ModelCapabilityError("Model capability profile contains invalid Runtime operations")
        identity = (model["role"], model["model_id"])
        if identity in seen:
            raise ModelCapabilityError("Model capability profile contains a duplicate model role")
        seen.add(identity)
    return value


def run_profile(
    profile_path: Path,
    *,
    gateway_url: str,
    gateway_token: str | None,
    output_root: Path,
) -> Path:
    profile = load_profile(profile_path)
    execution_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    target = output_root / "model-capabilities" / execution_id
    target.mkdir(parents=True, exist_ok=False)
    results: list[dict[str, Any]] = []
    attempts: list[dict[str, Any]] = []
    for model in profile["models"]:
        for operation in model["required_operations"]:
            selected: dict[str, Any] | None = None
            routes = model.get("routes", {}).get(operation) or ["auto"]
            for protocol in routes:
                payload = {
                    "agent_id": profile["agent_id"], "role": model["role"],
                    "operation": operation, "protocol": protocol,
                }
                response = _request(
                    gateway_url, gateway_token,
                    f"/v1/config/model-providers/{profile['provider_id']}/capability-probes", payload,
                )
                result = response.get("result")
                if not isinstance(result, dict):
                    raise ModelCapabilityError("Gateway capability probe response omitted result")
                if result.get("model_id") != model["model_id"]:
                    raise ModelCapabilityError(
                        f"Agent model mismatch for {model['role']}: expected {model['model_id']}, got {result.get('model_id')}"
                    )
                attempts.append(result)
                selected = selected or result
                if result.get("status") in {"verified", "runtime_verified"}:
                    selected = result
                    break
            assert selected is not None
            results.append(selected)
    revisions = {
        "profile": "sha256:" + hashlib.sha256(profile_path.read_bytes()).hexdigest(),
        "gateway": "local-opendrsai-runtime",
    }
    core = {
        "schema_version": "opendrsai.model-capability-snapshot/1",
        "agent_id": profile["agent_id"], "created_at": datetime.now(timezone.utc).isoformat(),
        "revisions": revisions, "results": results,
    }
    canonical = _stable_snapshot_payload(core)
    snapshot = {**core, "digest": "sha256:" + hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}
    _atomic_write(target / "capability-snapshot.json", json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    _atomic_write(target / "results.jsonl", "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in attempts))
    _atomic_write(target / "report.md", _report(profile, attempts))
    _atomic_write(target / "junit.xml", _junit_report(profile, results))
    return target


def _stable_snapshot_payload(snapshot: dict[str, Any]) -> dict[str, Any]:
    stable = dict(snapshot)
    stable.pop("digest", None)
    stable["created_at"] = None
    stable["results"] = []
    for raw_row in snapshot.get("results", []):
        if not isinstance(raw_row, dict):
            stable["results"].append(raw_row)
            continue
        row = dict(raw_row)
        for key in ("probe_id", "started_at", "duration_ms"):
            row.pop(key, None)
        stable["results"].append(row)
    return stable


def _atomic_write(path: Path, content: str) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def _junit_report(profile: dict[str, Any], results: list[dict[str, Any]]) -> str:
    failures = sum(1 for row in results if row.get("status") not in {"verified", "runtime_verified"})
    suite = ElementTree.Element("testsuite", {
        "name": str(profile["id"]), "tests": str(len(results)), "failures": str(failures),
        "errors": "0", "time": str(sum(float(row.get("duration_ms", 0)) for row in results) / 1000),
    })
    for row in results:
        case = ElementTree.SubElement(suite, "testcase", {
            "classname": f"{row.get('provider_id')}.{row.get('model_id')}",
            "name": str(row.get("operation")), "time": str(float(row.get("duration_ms", 0)) / 1000),
        })
        if row.get("status") not in {"verified", "runtime_verified"}:
            failure = ElementTree.SubElement(case, "failure", {
                "type": str(row.get("error_code") or row.get("status") or "capability_failed"),
                "message": f"status={row.get('status')}",
            })
            failure.text = json.dumps(row.get("assertions") or [], ensure_ascii=False)[:2000]
    return ElementTree.tostring(suite, encoding="unicode", xml_declaration=True) + "\n"


def evaluate_model_capability_gate(profile_path: Path, snapshot_path: Path) -> tuple[bool, list[str]]:
    profile = load_profile(profile_path)
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    rows = snapshot.get("results") if isinstance(snapshot, dict) else None
    if not isinstance(rows, list):
        raise ModelCapabilityError("Capability snapshot has no results")
    reasons: list[str] = []
    if snapshot.get("schema_version") != "opendrsai.model-capability-snapshot/1":
        reasons.append("capability snapshot schema version is invalid")
    expected_digest = "sha256:" + hashlib.sha256(json.dumps(
        _stable_snapshot_payload(snapshot), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    if snapshot.get("digest") != expected_digest:
        reasons.append("capability snapshot digest is missing or invalid")
    if snapshot.get("agent_id") != profile.get("agent_id"):
        reasons.append(f"agent mismatch: expected {profile.get('agent_id')}, got {snapshot.get('agent_id')}")
    expected_profile_revision = "sha256:" + hashlib.sha256(profile_path.read_bytes()).hexdigest()
    snapshot_revisions = snapshot.get("revisions")
    if not isinstance(snapshot_revisions, dict) or snapshot_revisions.get("profile") != expected_profile_revision:
        reasons.append("capability snapshot profile revision is stale or missing")
    max_age = profile.get("gate", {}).get("max_snapshot_age_hours")
    if max_age is not None:
        try:
            created = datetime.fromisoformat(str(snapshot["created_at"]).replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - created.astimezone(timezone.utc) > timedelta(hours=float(max_age)):
                reasons.append(f"capability snapshot is stale: older than {max_age} hours")
        except (KeyError, TypeError, ValueError):
            reasons.append("capability snapshot has invalid created_at")
    indexed = {(row.get("model_id"), row.get("operation")): row for row in rows if isinstance(row, dict)}
    for model in profile["models"]:
        for operation in model["required_operations"]:
            key = (model["model_id"], operation)
            row = indexed.get(key)
            if row is None:
                reasons.append(f"missing capability result: {key[0]}/{key[1]}")
                continue
            if row.get("status") not in {"verified", "runtime_verified"}:
                reasons.append(f"capability not verified: {key[0]}/{key[1]} status={row.get('status')}")
            if not row.get("assertions") or not all(item.get("passed") is True for item in row["assertions"] if isinstance(item, dict)):
                reasons.append(f"capability assertions incomplete: {key[0]}/{key[1]}")
            if row.get("provider_id") != profile.get("provider_id"):
                reasons.append(f"provider mismatch: {key[0]}/{key[1]}")
            if profile.get("gate", {}).get("require_real_provider") and row.get("evidence_kind") != "real_provider":
                reasons.append(f"real Provider evidence missing: {key[0]}/{key[1]}")
            revisions = row.get("revisions")
            if not isinstance(revisions, dict) or any(not revisions.get(name) or revisions.get(name) == "unknown" for name in (
                "provider_config", "agent_policy", "model_catalog", "route_rules", "probe_definition",
            )):
                reasons.append(f"capability revisions incomplete: {key[0]}/{key[1]}")
    if profile.get("gate", {}).get("require_runtime_verification"):
        runtime_required = {
            (model["model_id"], operation)
            for model in profile["models"]
            for operation in model.get("runtime_required_operations", model["required_operations"])
        }
        for model_id, operation in sorted(runtime_required):
            row = indexed.get((model_id, operation))
            if row is None or row.get("status") != "runtime_verified":
                reasons.append(f"runtime verification missing: {model_id}/{operation}")
            else:
                evidence = row.get("runtime_evidence")
                run_evidence = isinstance(evidence, dict) and evidence.get("run_id") and evidence.get("manifest_digest")
                operation_evidence = isinstance(evidence, dict) and evidence.get("operation_id") and evidence.get("evidence_digest")
                if not run_evidence and not operation_evidence:
                    reasons.append(f"runtime evidence reference missing: {model_id}/{operation}")
    return not reasons, reasons


def bind_runtime_run_evidence(
    profile_path: Path,
    snapshot_path: Path,
    *,
    model_id: str,
    operation: str,
    run_id: str,
    gateway_url: str,
    gateway_token: str | None,
) -> dict[str, Any]:
    """Verify a formal Runtime Run, then atomically bind its safe manifest to a probe row."""
    profile = load_profile(profile_path)
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    expected_digest = "sha256:" + hashlib.sha256(json.dumps(
        _stable_snapshot_payload(snapshot), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    if snapshot.get("digest") != expected_digest:
        raise ModelCapabilityError("Capability snapshot digest is missing or invalid")
    rows = snapshot.get("results")
    row = next((item for item in rows or [] if isinstance(item, dict)
                and item.get("model_id") == model_id and item.get("operation") == operation), None)
    if row is None:
        raise ModelCapabilityError(f"Capability snapshot has no result for {model_id}/{operation}")
    if row.get("status") not in {"verified", "runtime_verified"}:
        raise ModelCapabilityError(f"Provider capability is not verified for {model_id}/{operation}")
    run = _get(gateway_url, gateway_token, f"/v1/runs/{run_id}")
    manifest_envelope = _get(gateway_url, gateway_token, f"/v1/runs/{run_id}/reproduction-manifest")
    manifest = manifest_envelope.get("manifest")
    if run.get("status") != "completed" or not isinstance(manifest, dict) or manifest.get("outcome", {}).get("status") != "completed":
        raise ModelCapabilityError("Runtime Run is not completed")
    model = manifest.get("model") if isinstance(manifest.get("model"), dict) else {}
    if model.get("id") == model_id and model.get("provider") == profile.get("provider_id"):
        if operation not in (model.get("operations") or []):
            raise ModelCapabilityError("Runtime Run manifest does not declare the verified operation")
    elif operation == "chat" and _verified_image_understanding_manifest(
        manifest, row=row, model_id=model_id, provider_id=str(profile.get("provider_id") or ""),
    ):
        pass
    elif operation in {"image_generation", "image_edit"}:
        events = _get(gateway_url, gateway_token, f"/v1/runs/{run_id}/events?after_sequence=0&limit=500").get("data")
        if not isinstance(events, list) or not _verified_image_tool_event(
            events, operation=operation, model_id=model_id, provider_id=str(profile.get("provider_id") or ""),
        ):
            raise ModelCapabilityError("Runtime image tool evidence does not match the capability result")
    else:
        raise ModelCapabilityError("Runtime Run model does not match the capability result")
    safe_digest = str(manifest_envelope.get("safe_manifest_digest") or "").strip()
    if not safe_digest:
        raise ModelCapabilityError("Runtime Run safe manifest digest is missing")
    row["status"] = "runtime_verified"
    row["runtime_evidence"] = {
        "run_id": run_id,
        "manifest_digest": "sha256:" + safe_digest.removeprefix("sha256:"),
    }
    snapshot["digest"] = "sha256:" + hashlib.sha256(json.dumps(
        _stable_snapshot_payload(snapshot), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    _atomic_write(snapshot_path, json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    return dict(row)


def _verified_image_understanding_manifest(
    manifest: dict[str, Any], *, row: dict[str, Any], model_id: str, provider_id: str,
) -> bool:
    evidence = manifest.get("image_understanding")
    if not isinstance(evidence, dict):
        return False
    ref = evidence.get("model_ref")
    protocols = evidence.get("protocols")
    return bool(
        isinstance(ref, dict)
        and ref.get("provider_id") == provider_id
        and ref.get("model_id") == model_id
        and evidence.get("upstream_model_id") == model_id
        and evidence.get("operation") == "image_understanding"
        and isinstance(protocols, list)
        and row.get("protocol") in protocols
        and int(evidence.get("resource_count") or 0) > 0
    )


def verify_audio_product_runtime(
    profile_path: Path, snapshot_path: Path, *, gateway_url: str, gateway_token: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Execute the formal TTS->STT Gateway product path and atomically bind bounded evidence."""
    profile = load_profile(profile_path)
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    expected = "sha256:" + hashlib.sha256(json.dumps(
        _stable_snapshot_payload(snapshot), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    if snapshot.get("digest") != expected:
        raise ModelCapabilityError("Capability snapshot digest is missing or invalid")
    evidence = _audio_product_roundtrip(gateway_url, gateway_token)
    rows = snapshot.get("results") if isinstance(snapshot.get("results"), list) else []
    bound: list[dict[str, Any]] = []
    for model_id, operation, item in (
        ("tts-1", "text_to_speech", evidence["speech"]),
        ("whisper-1", "speech_to_text", evidence["transcription"]),
    ):
        row = next((value for value in rows if isinstance(value, dict)
                    and value.get("model_id") == model_id and value.get("operation") == operation), None)
        if row is None or row.get("status") not in {"verified", "runtime_verified"}:
            raise ModelCapabilityError(f"Provider capability is not verified for {model_id}/{operation}")
        if item.get("model_id") != model_id:
            raise ModelCapabilityError(f"Audio product model mismatch for {model_id}/{operation}")
        row["status"] = "runtime_verified"
        row["runtime_evidence"] = {
            "operation_id": item["operation_id"], "evidence_digest": item["evidence_digest"],
        }
        bound.append(dict(row))
    snapshot["digest"] = "sha256:" + hashlib.sha256(json.dumps(
        _stable_snapshot_payload(snapshot), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    _atomic_write(snapshot_path, json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    return bound[0], bound[1]


def _audio_product_roundtrip(base_url: str, token: str | None) -> dict[str, Any]:
    headers = {"Accept": "audio/mpeg", "Content-Type": "application/json"}
    if token:
        headers["X-OpenDrSai-Gateway-Token"] = token
    request = urllib.request.Request(
        base_url.rstrip("/") + "/v1/audio/speech",
        data=json.dumps({"text": "OpenDrSai capability test forty two", "voice": "alloy", "format": "mp3"}).encode(),
        headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            audio = response.read(10 * 1024 * 1024 + 1)
            speech_model = response.headers.get("X-OpenDrSai-Model-Id")
            speech_protocol = response.headers.get("X-OpenDrSai-Model-Protocol")
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ModelCapabilityError(f"Audio speech product request failed: {exc}") from exc
    if not audio or len(audio) > 10 * 1024 * 1024 or speech_model != "tts-1" or speech_protocol != "openai_audio_speech":
        raise ModelCapabilityError("Audio speech product response failed validation")
    boundary = "opendrsai-" + uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"p2.mp3\"\r\n"
        "Content-Type: audio/mpeg\r\n\r\n"
    ).encode() + audio + f"\r\n--{boundary}--\r\n".encode()
    transcription_headers = {"Accept": "application/json", "Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        transcription_headers["X-OpenDrSai-Gateway-Token"] = token
    transcription_request = urllib.request.Request(
        base_url.rstrip("/") + "/v1/audio/transcriptions", data=body,
        headers=transcription_headers, method="POST",
    )
    try:
        with urllib.request.urlopen(transcription_request, timeout=120) as response:
            transcription = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ModelCapabilityError(f"Audio transcription product request failed: {exc}") from exc
    text = str(transcription.get("text") or "") if isinstance(transcription, dict) else ""
    ref = transcription.get("model_ref") if isinstance(transcription, dict) else None
    if (not isinstance(ref, dict) or ref.get("model_id") != "whisper-1"
            or not text.strip() or not ("42" in text or "forty two" in text.casefold() or "forty-two" in text.casefold())):
        raise ModelCapabilityError("Audio transcription product response failed validation")
    audio_digest = hashlib.sha256(audio).hexdigest()
    transcript_digest = hashlib.sha256(text.encode()).hexdigest()
    return {
        "speech": {
            "model_id": "tts-1", "operation_id": "audio-speech-" + uuid.uuid4().hex,
            "evidence_digest": "sha256:" + hashlib.sha256(f"tts-1|openai_audio_speech|{len(audio)}|{audio_digest}".encode()).hexdigest(),
        },
        "transcription": {
            "model_id": "whisper-1", "operation_id": "audio-transcription-" + uuid.uuid4().hex,
            "evidence_digest": "sha256:" + hashlib.sha256(f"whisper-1|openai_audio_transcriptions|{transcript_digest}".encode()).hexdigest(),
        },
    }


def _verified_image_tool_event(
    events: list[Any], *, operation: str, model_id: str, provider_id: str,
) -> bool:
    artifact_created = any(isinstance(event, dict) and event.get("type") == "artifact.created" for event in events)
    for event in events:
        if not isinstance(event, dict) or event.get("type") != "tool.completed":
            continue
        data = event.get("data")
        if not isinstance(data, dict) or data.get("name") != operation or data.get("is_error") is True:
            continue
        try:
            envelope = json.loads(str(data.get("result") or ""))
            result = ast.literal_eval(str(envelope.get("content") or ""))
        except (ValueError, SyntaxError, TypeError, json.JSONDecodeError):
            continue
        ref = result.get("model_ref") if isinstance(result, dict) else None
        if (artifact_created and isinstance(ref, dict) and ref.get("provider_id") == provider_id
                and ref.get("model_id") == model_id and result.get("operation") == operation):
            return True
    return False


_CASE_CAPABILITY_REQUIREMENTS: dict[str, tuple[tuple[str, str], ...]] = {
    "image_input": (("gpt-5.6-luna", "chat"),),
    "image_generation": (("gemini-3.1-flash-lite-image", "image_generation"),),
    "speech_to_text": (("whisper-1", "speech_to_text"),),
    "text_to_speech": (("tts-1", "text_to_speech"),),
    "web_search": (("deepseek-v4-flash", "chat"), ("deepseek-v4-flash", "tool_calling")),
    "knowledge_search": (("deepseek-v4-flash", "chat"), ("deepseek-v4-flash", "tool_calling")),
    "run_inspect": (("deepseek-v4-flash", "chat"),),
    "run_manifest_read": (("deepseek-v4-flash", "chat"),),
    "run_compare": (("deepseek-v4-flash", "reasoning"),),
    "regression.controlled_write": (("deepseek-v4-flash", "tool_calling"),),
}


def evaluate_case_model_preflight(cases: list[Any], snapshot_path: Path) -> tuple[bool, list[str]]:
    """Fail closed only for model-backed capabilities required by selected cases."""
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    rows = snapshot.get("results") if isinstance(snapshot, dict) else None
    if not isinstance(rows, list):
        raise ModelCapabilityError("Capability snapshot has no results")
    indexed = {(row.get("model_id"), row.get("operation")): row for row in rows if isinstance(row, dict)}
    required: set[tuple[str, str]] = set()
    for case in cases:
        environment = case.data.get("environment", {})
        for capability in environment.get("required_capabilities", []):
            required.update(_CASE_CAPABILITY_REQUIREMENTS.get(str(capability), ()))
    reasons: list[str] = []
    for model_id, operation in sorted(required):
        row = indexed.get((model_id, operation))
        if row is None:
            reasons.append(f"missing model prerequisite: {model_id}/{operation}")
        elif row.get("status") != "runtime_verified":
            reasons.append(f"model prerequisite not runtime verified: {model_id}/{operation} status={row.get('status')}")
    return not reasons, reasons


def _request(base_url: str, token: str | None, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["X-OpenDrSai-Gateway-Token"] = token
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=json.dumps(payload).encode(), headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            value = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ModelCapabilityError(f"Capability probe request failed: {exc}") from exc
    if not isinstance(value, dict):
        raise ModelCapabilityError("Capability probe returned a non-object response")
    return value


def _get(base_url: str, token: str | None, path: str) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["X-OpenDrSai-Gateway-Token"] = token
    request = urllib.request.Request(base_url.rstrip("/") + path, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ModelCapabilityError(f"Runtime evidence request failed: {exc}") from exc
    if not isinstance(value, dict):
        raise ModelCapabilityError("Runtime evidence endpoint returned a non-object response")
    return value


def _report(profile: dict[str, Any], results: list[dict[str, Any]]) -> str:
    lines = [f"# Model capability report: {profile['id']}", "", "| Model | Operation | Protocol | Status | Duration |", "|---|---|---|---|---:|"]
    for row in results:
        lines.append(f"| `{row.get('model_id')}` | `{row.get('operation')}` | `{row.get('protocol')}` | `{row.get('status')}` | {row.get('duration_ms', 0)} ms |")
    return "\n".join(lines) + "\n"
