"""Desktop/CLI first Runtime registration. Android never invokes this command."""
from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path
from urllib.parse import urlparse

from .device_identity import DeviceIdentityStore
from .runtime_client import AiohttpRegistrationTransport, RuntimeCredentialStore, RuntimeEnrollmentClient


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(prog="opendrsai-runtime-enroll")
    value.add_argument("--relay", required=True, help="HTTPS Runtime Relay base URL")
    value.add_argument("--registration-code", required=True)
    value.add_argument("--name", required=True)
    value.add_argument("--version", required=True)
    value.add_argument("--state-dir", type=Path,
                       default=Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))) / "runtime" / "relay")
    return value


async def enroll(arguments: argparse.Namespace) -> str:
    identity = DeviceIdentityStore(arguments.state_dir / "device-identity.dpapi")
    client = RuntimeEnrollmentClient(identity, AiohttpRegistrationTransport(arguments.relay))
    credential = await client.enroll(arguments.registration_code, arguments.name, arguments.version)
    RuntimeCredentialStore(arguments.state_dir / "credential.dpapi").save(credential)
    parsed = urlparse(arguments.relay)
    relay_wss = parsed._replace(scheme="wss", path=f"{parsed.path.rstrip('/')}/v1/runtime-connect").geturl()
    arguments.state_dir.mkdir(parents=True, exist_ok=True)
    (arguments.state_dir / "relay-wss-url").write_text(relay_wss, encoding="utf-8")
    return credential.runtime_id


def main() -> int:
    runtime_id = asyncio.run(enroll(parser().parse_args()))
    print(f"Runtime registered: {runtime_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
