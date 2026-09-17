"""Composition root for the independently hosted DSH OAEP Runtime Bridge."""

from __future__ import annotations

import asyncio
import hashlib
import os
import secrets
import uuid
from dataclasses import dataclass
from pathlib import Path

from .approval import ApprovalCoordinator
from .control import RuntimeBinding, RuntimeControlService
from .driver import HarnessSdkDriver
from .mapper import NativeFactProjector
from .native_extension import DSH_RC5_EXTENSION_ID, NativeExtensionBundle
from .oaep import OaepJournal
from .process import HarnessProcessSpec, HarnessProcessSupervisor
from .profiles import ProtocolProfile, ProtocolProfileRegistry
from .registration import RuntimeRegistrationLease, write_runtime_registration
from .store import RuntimeAuthorityStore
from .store import RuntimeStoreError
from .transport import AsyncioLoopbackServer, ControlHttpApplication


@dataclass(frozen=True)
class BridgeRuntimeConfig:
    workspace_root: Path
    state_root: Path
    registry_root: Path
    carrier: Path
    provider: str
    model: str
    profile_id: str
    carrier_args: tuple[str, ...] = ()
    host: str = "127.0.0.1"
    port: int = 0
    max_tokens: int | None = None

    def __post_init__(self) -> None:
        for name in ("workspace_root", "state_root", "registry_root", "carrier"):
            value = Path(getattr(self, name)).expanduser().resolve(strict=False)
            if not value.is_absolute():
                raise ValueError(f"{name} must be absolute")
            object.__setattr__(self, name, value)
        if not self.workspace_root.is_dir():
            raise ValueError("workspace_root must exist")
        if not self.carrier.is_file():
            raise ValueError("carrier must be a file")
        if not self.provider.strip() or not self.model.strip() or not self.profile_id.strip():
            raise ValueError("provider, model and profile_id are required")
        if not all(isinstance(value, str) and value and "\0" not in value for value in self.carrier_args):
            raise ValueError("carrier_args are invalid")
        if self.max_tokens is not None and self.max_tokens < 1:
            raise ValueError("max_tokens must be positive")


class BridgeRuntimeHost:
    def __init__(self, config: BridgeRuntimeConfig):
        self.config = config
        self.store: RuntimeAuthorityStore | None = None
        self.control: RuntimeControlService | None = None
        self.server: AsyncioLoopbackServer | None = None
        self.registration: RuntimeRegistrationLease | None = None
        self.supervisor: HarnessProcessSupervisor | None = None
        self._fact_task: asyncio.Task[None] | None = None

    async def start(self) -> dict[str, object]:
        if self.server is not None:
            raise RuntimeError("Bridge Runtime is already started")
        self.config.state_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        profile = self._profile()
        runtime_id = f"runtime-{uuid.uuid5(uuid.NAMESPACE_URL, str(self.config.state_root)).hex}"
        store = RuntimeAuthorityStore(self.config.state_root / "runtime.sqlite3")
        journal = OaepJournal(store)
        generation = 1
        approvals = ApprovalCoordinator(
            store, journal, runtime_id=runtime_id, generation=generation,
        )
        managed_environment = {
            key: value for key, value in {
                "DEEPSEEK_API_KEY": os.environ.get("DEEPSEEK_API_KEY"),
                "DEEPSEEK_BASE_URL": os.environ.get("DEEPSEEK_BASE_URL"),
                "DSH_CWD": str(self.config.workspace_root),
                "DSH_SESSION_ROOT": str(self.config.state_root / "native-sessions"),
            }.items() if value
        }
        carrier_args = self.config.carrier_args
        if not carrier_args and profile.profile_id == DSH_RC5_EXTENSION_ID:
            config_path = NativeExtensionBundle.rc5().materialize_config(
                self.config.state_root / "native-config" / "opendrsai.cordis.yml"
            )
            carrier_args = (str(config_path),)
        spec = HarnessProcessSpec.create(
            [str(self.config.carrier), *carrier_args],
            cwd=self.config.workspace_root,
            inherited_environment=os.environ,
            managed_environment=managed_environment,
        )
        supervisor = HarnessProcessSupervisor(spec)
        process = await supervisor.start(server_request_handler=approvals.handle_server_request)
        driver = HarnessSdkDriver(process.peer, contract_sha256=profile.native_contract_sha256)
        server: AsyncioLoopbackServer | None = None
        try:
            identity = await driver.initialize(
                cwd=self.config.workspace_root,
                provider=self.config.provider,
                model=self.config.model,
                max_tokens=self.config.max_tokens,
            )
            compatibility = ProtocolProfileRegistry.bundled().decide(
                server_name=identity.server_name,
                version=identity.server_version,
                native_contract_sha256=identity.contract_sha256,
                methods=identity.methods,
                notifications=identity.notifications,
                capabilities=identity.capabilities,
            )
            binding = RuntimeBinding(
                runtime_id=runtime_id,
                generation=process.generation,
                workspace_root=self.config.workspace_root,
                workspace_id=f"workspace-{self._workspace_fingerprint()[:32]}",
                workspace_fingerprint=self._workspace_fingerprint(),
                native_profile=profile.profile_id,
                mapping_version=profile.mapping_version,
            )
            projector = NativeFactProjector(
                store, journal, runtime_id=runtime_id, approvals=approvals,
            )
            control = RuntimeControlService(
                store=store,
                journal=journal,
                driver=driver,
                native_identity=identity,
                compatibility=compatibility,
                binding=binding,
                approvals=approvals,
            )
            bearer_token = secrets.token_urlsafe(48)
            server = AsyncioLoopbackServer(
                ControlHttpApplication(control, bearer_token=bearer_token),
                host=self.config.host,
                port=self.config.port,
            )
            host, port = await server.start()
            initialize_result = control.initialize()
            registration = write_runtime_registration(
                registry_root=self.config.registry_root,
                base_url=f"http://{'[' + host + ']' if ':' in host else host}:{port}",
                initialize_result=initialize_result,
                bearer_token=bearer_token,
            )
        except Exception:
            if server is not None:
                await server.close()
            await supervisor.close()
            store.close()
            raise
        self.store = store
        self.control = control
        self.server = server
        self.registration = registration
        self.supervisor = supervisor
        self._fact_task = asyncio.create_task(
            self._project_facts(driver, projector), name=f"dsh-projector-{process.generation}",
        )
        return {
            "base_url": f"http://{'[' + host + ']' if ':' in host else host}:{port}",
            "runtime_id": runtime_id,
            "availability": compatibility.state,
            "profile_id": profile.profile_id,
        }

    async def close(self) -> None:
        registration, self.registration = self.registration, None
        registration and registration.close()
        if self.server is not None:
            await self.server.close()
            self.server = None
        if self.control is not None:
            await self.control.shutdown()
            self.control = None
        if self.supervisor is not None:
            await self.supervisor.close()
            self.supervisor = None
        if self._fact_task is not None:
            self._fact_task.cancel()
            await asyncio.gather(self._fact_task, return_exceptions=True)
            self._fact_task = None
        if self.store is not None:
            self.store.close()
            self.store = None

    def _profile(self) -> ProtocolProfile:
        matches = [
            profile for profile in ProtocolProfileRegistry.bundled().profiles
            if profile.profile_id == self.config.profile_id
        ]
        if len(matches) != 1:
            raise ValueError("Configured native protocol profile is unavailable")
        return matches[0]

    def _workspace_fingerprint(self) -> str:
        canonical = os.path.normcase(str(self.config.workspace_root)).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()

    @staticmethod
    async def _project_facts(driver: HarnessSdkDriver, projector: NativeFactProjector) -> None:
        while True:
            notification = await driver.next_fact()
            if notification.method == "session.event":
                # DSH may commit turn/start synchronously before its
                # session/prompt JSON-RPC result is written. Preserve source
                # order while the sibling Control coroutine durably binds the
                # returned messageId; no other projection error is retried.
                for attempt in range(100):
                    try:
                        projector.project(notification)
                        break
                    except RuntimeStoreError as exc:
                        if exc.code != "native_run_unknown" or attempt == 99:
                            params = notification.params if isinstance(notification.params, dict) else {}
                            event = params.get("event") if isinstance(params.get("event"), dict) else {}
                            raise RuntimeStoreError(
                                exc.code,
                                f"{exc.message}; native_event={event.get('type')} seq={event.get('seq')} data={event.get('data')}",
                            ) from exc
                        await asyncio.sleep(0.01)


async def serve_bridge(config: BridgeRuntimeConfig) -> None:
    host = BridgeRuntimeHost(config)
    await host.start()
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in ("SIGINT", "SIGTERM"):
        signal_value = getattr(__import__("signal"), name)
        try:
            loop.add_signal_handler(signal_value, stopped.set)
        except (NotImplementedError, RuntimeError):
            pass
    try:
        await stopped.wait()
    finally:
        await host.close()
