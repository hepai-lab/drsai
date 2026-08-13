"""Content-free probe for construction of the Runtime Relay bridge.

The probe deliberately does not open a WebSocket.  It exercises the same
credential, identity, Runtime, control-handler, capability and connector
construction stages used by the Desktop Runtime startup hook, while emitting
only a fixed stage and exception class on failure.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", type=Path, default=Path.home() / ".drsai-dev")
    parser.add_argument("--port", type=int, default=28642)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        raise SystemExit("runtime_relay_probe_port_invalid")

    state_root = args.state_root.expanduser().resolve()
    os.environ["DRSAI_HOME"] = str(state_root)
    stage = "imports"
    try:
        from drsai.backend import gateway
        from drsai.relay.device_identity import DeviceIdentityStore
        from drsai.relay.gateway_control import AiohttpGatewayTransport, GatewayRuntimeControlHandler
        from drsai.relay.runtime_client import (
            RuntimeCredentialStore,
            RuntimeOutboundConnector,
            resolve_runtime_version,
        )

        relay_state = state_root / "runtime" / "relay"
        stage = "local_configuration"
        configured_url = (relay_state / "relay-wss-url").read_text(encoding="utf-8").strip()
        parsed = urlparse(configured_url)
        if parsed.scheme != "wss" or not parsed.hostname or parsed.username or parsed.password:
            raise RuntimeError("runtime_relay_probe_url_invalid")
        gateway_token = (state_root / "runtime" / "instance-token").read_text(encoding="utf-8").strip()
        if not gateway_token:
            raise RuntimeError("runtime_relay_probe_gateway_token_missing")

        stage = "credential"
        credential = RuntimeCredentialStore(relay_state / "credential.dpapi").load()
        stage = "device_identity"
        identity = DeviceIdentityStore(relay_state / "device-identity.dpapi").load_or_create()
        stage = "runtime_identity"
        runtime = gateway._runtime_registry().identity
        stage = "control_handler"
        handler = GatewayRuntimeControlHandler(
            credential.runtime_id,
            AiohttpGatewayTransport(f"http://127.0.0.1:{args.port}", gateway_token),
            state_root / "runtime",
        )
        stage = "execution_capabilities"
        execution_capabilities = gateway._runtime_execution_capabilities(gateway._read_tools_config())
        stage = "runtime_engine"
        observability = gateway._runtime_engine().observability
        stage = "connector"
        RuntimeOutboundConnector(
            configured_url,
            credential,
            identity,
            runtime.instance_id,
            resolve_runtime_version(os.environ.get("OPENDRSAI_RUNTIME_VERSION")),
            request_handler=handler,
            http_request_handler=handler.handle_http_request,
            event_provider=handler.relay_events,
            session_event_provider=handler.relay_session_events,
            oaep_event_provider=handler.relay_oaep_events,
            oaep_event_ack=handler.ack_relay_oaep_event,
            oaep_events_ack=handler.ack_relay_oaep_events,
            workspace_provider=handler.published_workspaces,
            conversation_latency_observability=observability,
            backend_health={"opendrsai": "healthy"},
            execution_capabilities=execution_capabilities,
            wire_protocol=(
                "hai-http"
                if "/api/runtime-relay/" in parsed.path
                else "legacy-operation"
            ),
        )
    except Exception as exc:
        print(json.dumps({
            "status": "failed",
            "error_code": "runtime_relay_bridge_startup_failed",
            "stage": stage,
            "error_type": type(exc).__name__,
        }, sort_keys=True))
        return 1
    print(json.dumps({"status": "passed", "stage": "connector"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
