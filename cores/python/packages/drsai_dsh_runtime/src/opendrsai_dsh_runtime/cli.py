"""Command-line surface used by installers and generic integration settings."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from collections.abc import Sequence
from pathlib import Path

from . import __version__
from .contracts import runtime_protocol_description
from .discovery import discover_dsh_installation
from .profiles import ProtocolProfileRegistry
from .native_extension import NativeExtensionBundle


def status_payload() -> dict[str, object]:
    installation = discover_dsh_installation()
    profiles = ProtocolProfileRegistry.bundled().profiles
    return {
        "bridge": {
            "name": "opendrsai-dsh-oaep-runtime",
            "version": __version__,
        },
        "installation": installation.as_dict(),
        "protocols": runtime_protocol_description(),
        "profiles": [
            {
                "profile_id": profile.profile_id,
                "supported_versions": list(profile.supported_versions),
                "mapping_version": profile.mapping_version,
                "production_ready": profile.production_ready,
                "profile_sha256": profile.profile_sha256,
                "blockers": list(profile.blockers),
            }
            for profile in profiles
        ],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="opendrsai-dsh-runtime")
    parser.add_argument("--version", action="version", version=__version__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    status = subcommands.add_parser("status", help="print side-effect-free installation status")
    status.add_argument("--pretty", action="store_true", help="indent the JSON result")
    stage = subcommands.add_parser(
        "stage-extension", help="stage a version-pinned OpenDrSai extension before DSH carrier packaging"
    )
    stage.add_argument("--carrier-root", type=Path, required=True)
    stage.add_argument("--source-commit", required=True)
    serve = subcommands.add_parser("serve", help="host the standalone loopback Runtime Bridge")
    serve.add_argument("--workspace-root", type=Path, required=True)
    serve.add_argument("--state-root", type=Path, required=True)
    serve.add_argument("--registry-root", type=Path, default=Path.home() / ".drsai" / "runtime-registry")
    serve.add_argument("--carrier", type=Path, default=os.environ.get("OPENDRSAI_DSH_RUNTIME_BIN"))
    serve.add_argument("--carrier-arg", action="append", default=[])
    serve.add_argument("--provider", required=True)
    serve.add_argument("--model", required=True)
    serve.add_argument("--profile", dest="profile_id", required=True)
    serve.add_argument("--host", choices=("127.0.0.1", "::1"), default="127.0.0.1")
    serve.add_argument("--port", type=int, default=0)
    serve.add_argument("--max-tokens", type=int)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "status":
        print(json.dumps(status_payload(), ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=True))
        return 0
    if args.command == "stage-extension":
        result = NativeExtensionBundle.rc5().stage(
            args.carrier_root, source_commit=args.source_commit,
        )
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    if args.command == "serve":
        if args.carrier is None:
            raise SystemExit("--carrier or OPENDRSAI_DSH_RUNTIME_BIN is required")
        from .bootstrap import BridgeRuntimeConfig, serve_bridge

        config = BridgeRuntimeConfig(
            workspace_root=args.workspace_root,
            state_root=args.state_root,
            registry_root=args.registry_root,
            carrier=args.carrier,
            provider=args.provider,
            model=args.model,
            profile_id=args.profile_id,
            carrier_args=tuple(args.carrier_arg),
            host=args.host,
            port=args.port,
            max_tokens=args.max_tokens,
        )
        try:
            asyncio.run(serve_bridge(config))
        except KeyboardInterrupt:
            pass
        return 0
    raise AssertionError("argparse accepted an unknown command")


if __name__ == "__main__":
    raise SystemExit(main())
