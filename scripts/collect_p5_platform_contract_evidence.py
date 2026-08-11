"""Collect content-free evidence that a Relay deploys the exact P5 contract."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from finalize_remote_workspace_p5 import platform_contract_sha256


CATALOG = "/runtimes/{runtime_id}/workspaces/{workspace_id}/session-catalog-events/stream"
USAGE = "/metrics/protocol-usage"
DELETION_DECISION = "/metrics/protocol-usage/deletion-decision"
PUSH_REGISTRATION = "/associations/{runtime_id}/push-registration"
EXTENSION = "x-p5-platform-contract-sha256"


def collect(relay_url: str, environment_id: str, *, timeout: float = 20,
            openapi_output: Path | None = None) -> dict:
    base = relay_url.rstrip("/") + "/"
    if urlparse(base).scheme != "https" or not urlparse(base).netloc:
        raise RuntimeError("p5_contract_https_required")
    target = urljoin(base, "v2/openapi.json")
    with urlopen(Request(target, headers={"Accept": "application/json"}), timeout=timeout) as response:
        raw = response.read()
        final_url = response.geturl()
        status = getattr(response, "status", 200)
    if status != 200 or urlparse(final_url).scheme != "https" or not raw:
        raise RuntimeError("p5_contract_openapi_unavailable")
    try:
        document = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("p5_contract_openapi_invalid") from exc
    expected = platform_contract_sha256()
    if not expected:
        raise RuntimeError("p5_contract_local_missing")
    paths = document.get("paths") if isinstance(document, dict) else None
    schemas = (document.get("components") or {}).get("schemas") if isinstance(document, dict) else None
    if not isinstance(paths, dict) or not isinstance(schemas, dict):
        raise RuntimeError("p5_contract_openapi_invalid")
    catalog_get = (paths.get(CATALOG) or {}).get("get")
    usage_get = (paths.get(USAGE) or {}).get("get")
    deletion_get = (paths.get(DELETION_DECISION) or {}).get("get")
    push_put = (paths.get(PUSH_REGISTRATION) or {}).get("put")
    push_delete = (paths.get(PUSH_REGISTRATION) or {}).get("delete")
    operations = [catalog_get, usage_get, deletion_get, push_put, push_delete]
    if any(not isinstance(operation, dict) for operation in operations):
        raise RuntimeError("p5_contract_endpoints_missing")
    hashes = {operation.get(EXTENSION) for operation in operations}
    if hashes != {expected}:
        raise RuntimeError("p5_contract_deployment_drift")
    content = (((catalog_get.get("responses") or {}).get("200") or {}).get("content") or {})
    if "text/event-stream" not in content or "SessionCatalogEvent" not in schemas:
        raise RuntimeError("p5_contract_catalog_schema_missing")
    deletion_response = (((deletion_get.get("responses") or {}).get("200") or {})
                         .get("content") or {}).get("application/json") or {}
    deletion_ref = str((deletion_response.get("schema") or {}).get("$ref", ""))
    if not deletion_ref.endswith("/ProtocolDeletionDecision") or "ProtocolDeletionDecision" not in schemas:
        raise RuntimeError("p5_contract_deletion_decision_schema_missing")
    push_request = (((push_put.get("requestBody") or {}).get("content") or {})
                    .get("application/json") or {}).get("schema") or {}
    push_put_response = (((push_put.get("responses") or {}).get("200") or {})
                         .get("content") or {}).get("application/json") or {}
    push_delete_response = (((push_delete.get("responses") or {}).get("200") or {})
                            .get("content") or {}).get("application/json") or {}
    push_refs = [
        str(push_request.get("$ref", "")),
        str((push_put_response.get("schema") or {}).get("$ref", "")),
        str((push_delete_response.get("schema") or {}).get("$ref", "")),
    ]
    if not any(ref.endswith("/PushRegistrationRequest") for ref in push_refs) \
            or sum(ref.endswith("/PushRegistrationResult") for ref in push_refs) != 2 \
            or "PushRegistrationRequest" not in schemas \
            or "PushRegistrationResult" not in schemas:
        raise RuntimeError("p5_contract_push_schema_missing")
    if not environment_id.strip():
        raise RuntimeError("p5_contract_environment_required")
    if openapi_output is not None:
        openapi_output.parent.mkdir(parents=True, exist_ok=True)
        openapi_output.write_bytes(raw)
    return {
        "schema_version": "p5-contract-evidence/1", "environment_id": environment_id,
        "relay_url": relay_url.rstrip("/"), "platform_contract_sha256": expected,
        "openapi_sha256": hashlib.sha256(raw).hexdigest(), "openapi_bytes": len(raw),
        "verified_endpoints": [CATALOG, USAGE, DELETION_DECISION,
                               PUSH_REGISTRATION + "#PUT", PUSH_REGISTRATION + "#DELETE"],
        "passed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--relay-url", required=True)
    parser.add_argument("--environment-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--openapi-output", type=Path, required=True)
    args = parser.parse_args()
    result = collect(args.relay_url, args.environment_id, openapi_output=args.openapi_output)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
