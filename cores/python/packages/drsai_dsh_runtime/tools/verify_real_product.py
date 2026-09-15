"""Launch the real bridge and exercise it through the Desktop OAEP adapter."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

from opendrsai_dsh_runtime.bootstrap import BridgeRuntimeConfig, BridgeRuntimeHost
from opendrsai_dsh_runtime.client import OaepRuntimeClient, RuntimeEndpoint
from verify_real_extension import MockDeepSeek


async def run(args: argparse.Namespace) -> dict[str, object]:
    workspace = args.workspace.resolve(strict=True)
    state = args.state_root.resolve(strict=False)
    registry = args.registry_root.resolve(strict=False)
    mock = MockDeepSeek()
    base_url = await mock.start()
    old = {name: os.environ.get(name) for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL")}
    os.environ["DEEPSEEK_API_KEY"] = "test-key"
    os.environ["DEEPSEEK_BASE_URL"] = base_url
    host = BridgeRuntimeHost(BridgeRuntimeConfig(
        workspace_root=workspace,
        state_root=state,
        registry_root=registry,
        carrier=args.carrier.resolve(strict=True),
        carrier_args=tuple(str(path.resolve(strict=True)) for path in (args.bin, args.config)),
        provider="deepseek-official",
        model="deepseek-v4-flash",
        profile_id="dsh-sdk/0.1.0-rc.5+opendrsai.1",
        max_tokens=256,
    ))
    try:
        started = await host.start()
        registration = host.registration
        if registration is None:
            raise AssertionError("bridge did not publish a registration")
        python_initialize = await OaepRuntimeClient(RuntimeEndpoint(
            str(started["base_url"]), registration.bearer_token,
        )).initialize()
        process = await asyncio.create_subprocess_exec(
            str(args.tsx.resolve(strict=True)), str(args.desktop_probe.resolve(strict=True)), str(registry),
            cwd=str(workspace), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=35)
        except TimeoutError as exc:
            process.kill()
            stdout, stderr = await process.communicate()
            projector = host._fact_task
            projector_state = (
                repr(projector.exception()) if projector is not None and projector.done() and not projector.cancelled()
                else "running"
            )
            raise RuntimeError(
                f"Desktop product probe timed out: {stderr.decode(errors='replace')}\n"
                f"projector={projector_state}"
            ) from exc
        if process.returncode != 0:
            manifest = registration.manifest_path.read_text(encoding="utf-8")
            raise RuntimeError(
                f"Desktop product probe failed: {stderr.decode(errors='replace')}\n"
                f"registration={manifest}\npython_initialize={python_initialize}"
            )
        desktop = json.loads(stdout)
        result = {"schema_version": 1, "accepted": True, "bridge": started, "desktop": desktop}
        args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
        return result
    finally:
        await host.close()
        await mock.close()
        for name, value in old.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("workspace", "state_root", "registry_root", "carrier", "bin", "config", "tsx", "desktop_probe", "output"):
        parser.add_argument(f"--{name.replace('_', '-')}", dest=name, type=Path, required=True)
    result = asyncio.run(run(parser.parse_args()))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
