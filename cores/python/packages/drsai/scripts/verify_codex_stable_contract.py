"""Fail-closed verifier for the reviewed Codex app-server contract."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
MANIFEST_PATH = ROOT / "cores/protocol/codex-app-server-stable-contract.json"


def _methods(path: Path) -> set[str]:
    schema = json.loads(path.read_text(encoding="utf-8"))
    methods: set[str] = set()
    for variant in schema.get("oneOf", []):
        values = variant.get("properties", {}).get("method", {}).get("enum", [])
        methods.update(value for value in values if isinstance(value, str))
    return methods


def _canonical_digest(path: Path) -> str:
    value = json.loads(path.read_text(encoding="utf-8"))
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _client_method_parameter_names(path: Path) -> dict[str, set[str]]:
    """Return every parameter name exposed by each generated client method."""
    schema = json.loads(path.read_text(encoding="utf-8"))
    definitions = schema.get("definitions", {})

    def collect(node: object, seen: set[str] | None = None) -> set[str]:
        if not isinstance(node, dict):
            return set()
        visited = set() if seen is None else set(seen)
        result = set(node.get("properties", {})) if isinstance(node.get("properties"), dict) else set()
        reference = node.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/definitions/"):
            name = reference.rsplit("/", 1)[-1]
            if name not in visited:
                visited.add(name)
                result.update(collect(definitions.get(name), visited))
        for keyword in ("oneOf", "anyOf", "allOf"):
            variants = node.get(keyword)
            if isinstance(variants, list):
                for variant in variants:
                    result.update(collect(variant, visited))
        return result

    result: dict[str, set[str]] = {}
    for variant in schema.get("oneOf", []):
        if not isinstance(variant, dict):
            continue
        properties = variant.get("properties", {})
        if not isinstance(properties, dict):
            continue
        methods = properties.get("method", {}).get("enum", []) if isinstance(properties.get("method"), dict) else []
        if len(methods) == 1 and isinstance(methods[0], str):
            result[methods[0]] = collect(properties.get("params"))
    return result


def verify() -> dict[str, object]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    baseline = manifest["generatedBaseline"]
    schema_root = ROOT / baseline["schemaPath"]
    bundle = schema_root / "codex_app_server_protocol.v2.schemas.json"
    digest = _canonical_digest(bundle)
    if digest != baseline["v2BundleCanonicalSha256"]:
        raise SystemExit("Codex schema bundle digest differs from the reviewed baseline.")

    notifications = manifest["notifications"]
    classified: dict[str, str] = {}
    for classification in ("semantic", "user_notice", "diagnostic", "known_ignored", "fatal"):
        for method in notifications[classification]:
            if method in classified:
                raise SystemExit(f"Codex notification has multiple classifications: {method}")
            classified[method] = classification
    schema_notifications = _methods(schema_root / "ServerNotification.json")
    missing = schema_notifications - classified.keys()
    extra = classified.keys() - schema_notifications
    if missing or extra:
        raise SystemExit(f"Codex notification coverage mismatch: missing={sorted(missing)}, extra={sorted(extra)}")

    dispositions = manifest.get("semanticDispositions")
    if not isinstance(dispositions, dict) or set(dispositions) != set(notifications["semantic"]):
        raise SystemExit("Every semantic notification must have exactly one disposition.")
    allowed_dispositions = {"mapped", "reviewed_ignored", "release_blocked"}
    disposition_counts = {value: 0 for value in sorted(allowed_dispositions)}
    for method, disposition in dispositions.items():
        if not isinstance(disposition, dict):
            raise SystemExit(f"Invalid semantic disposition for {method}.")
        if disposition.get("disposition") not in allowed_dispositions:
            raise SystemExit(f"Invalid semantic disposition kind for {method}.")
        for required in ("handler", "oaep", "reason"):
            if not isinstance(disposition.get(required), str) or not disposition[required].strip():
                raise SystemExit(f"Semantic disposition {method} is missing {required}.")
        disposition_counts[str(disposition["disposition"])] += 1

    requests = manifest["serverRequests"]
    reviewed_requests = set(requests["supported"]) | set(requests["denied"])
    schema_requests = _methods(schema_root / "ServerRequest.json")
    if reviewed_requests != schema_requests or set(requests["supported"]) & set(requests["denied"]):
        raise SystemExit("Codex server-request coverage is incomplete or overlapping.")

    schema_client_methods = _methods(schema_root / "ClientRequest.json")
    allowed = set(manifest["clientMethods"])
    required_params = manifest.get("clientRequiredParams")
    if not isinstance(required_params, dict) or set(required_params) != allowed:
        raise SystemExit("Every reviewed client method must declare required parameters.")
    for method, required in required_params.items():
        reviewed = manifest["clientMethods"][method]
        if not isinstance(required, list) or not set(required) <= set(reviewed):
            raise SystemExit(f"Required parameters are not a subset of reviewed parameters: {method}")
    unavailable = allowed - schema_client_methods - {"initialized"}
    if unavailable:
        raise SystemExit(f"Reviewed client methods are absent from the baseline schema: {sorted(unavailable)}")
    schema_parameter_names = _client_method_parameter_names(schema_root / "ClientRequest.json")
    stale_parameters = {
        method: sorted(set(parameters) - schema_parameter_names.get(method, set()))
        for method, parameters in manifest["clientMethods"].items()
        if method != "initialized" and set(parameters) - schema_parameter_names.get(method, set())
    }
    if stale_parameters:
        raise SystemExit(f"Reviewed client parameters are absent from the baseline schema: {stale_parameters}")
    return {
        "passed": True,
        "contractVersion": manifest["contractVersion"],
        "codexVersion": baseline["codexVersion"],
        "bundleSha256": digest,
        "clientMethods": len(allowed),
        "notifications": len(classified),
        "serverRequests": len(reviewed_requests),
        "semanticDispositions": len(dispositions),
        "semanticDispositionCounts": disposition_counts,
        "contentRetained": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.parse_args()
    print(json.dumps(verify(), ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
