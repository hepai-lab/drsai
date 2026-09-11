"""The FastAPI application: config + runtime + audio + models + runs + sessions + workspaces + gfs.

This is a **separate app** from ``gateway_legacy``'s, deliberately. Mounting
these routers onto the legacy ``app`` would inherit its middleware stack and
break the three frozen route-order/OpenAPI snapshots that hold the legacy
surface still while it is retired. The two apps share the Runtime beneath them,
not the HTTP layer above it.

The ``config`` router provides V1-compatible ``/v1/config/*`` routes that the
Electron renderer calls during startup and for settings management.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import _auth, _state
from drsai.backend.skills_api import register_skills_routes

from .routes import (
    agent_backends,
    audio,
    capabilities,
    config,
    config_agents,
    config_providers,
    config_tools,
    config_knowledge,
    gfs,
    identity,
    models,
    runs,
    runtime,
    sessions,
    skills_square,
    workspaces,
)

DEFAULT_HOST = os.environ.get("DRSAI_DESKTOP_GATEWAY_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("DRSAI_DESKTOP_GATEWAY_PORT", "28643"))

ROUTERS = (
    runtime.router,
    workspaces.router,
    sessions.router,
    runs.router,
    models.router,
    audio.router,
    config.router,
    config_agents.router,
    config_providers.router,
    config_tools.router,
    config_knowledge.router,
    capabilities.router,
    agent_backends.router,
    identity.router,
    gfs.router,
    skills_square.router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed the default provider, model selection and Agent Model Policy that
    # the config surface (routes/config.py) reads.  V1 gateway_legacy does this
    # when OPENDRSAI_DESKTOP_RUNTIME == "1"; this gateway IS the desktop runtime,
    # so we always bootstrap.
    import asyncio
    import logging
    import json
    from pathlib import Path

    from drsai.config import ensure_desktop_runtime_config

    logger = logging.getLogger("drsai.desktop_gateway")
    try:
        bootstrap = await asyncio.to_thread(ensure_desktop_runtime_config)
        logger.info(
            "Desktop Runtime configuration ready (changed={}, actions={})",
            bootstrap.changed,
            ",".join(bootstrap.actions) or "none",
        )
    except Exception as exc:
        logger.exception(
            "Desktop Runtime configuration bootstrap failed: {}", type(exc).__name__,
        )

    async def _run_subprocess_selftest() -> None:
        # Keep this off the startup critical path: Office COM probes can hang
        # under endpoint security and must never delay /health readiness.
        home = Path(os.environ.get("DRSAI_HOME") or Path.home() / ".drsai")
        probe_path = home / "logs" / "subprocess-selftest.json"

        def _probe() -> dict:
            import subprocess
            import sys
            import time

            result: dict = {
                "pid": os.getpid(),
                "executable": sys.executable,
                "platform": sys.platform,
                "ts": time.time(),
                "tests": {},
            }
            if sys.platform != "win32":
                return result
            ps = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
            create_no_window = 0x08000000
            for name, args in [
                ("powershell_createprocess", [ps, "-NoProfile", "-Command", "echo ok"]),
                ("cmd_createprocess", ["cmd.exe", "/d", "/c", "echo ok"]),
                ("python_createprocess", [sys.executable, "-c", "print(123)"]),
            ]:
                try:
                    completed = subprocess.run(
                        args,
                        capture_output=True,
                        text=True,
                        timeout=15,
                        creationflags=create_no_window,
                    )
                    result["tests"][name] = {
                        "ok": completed.returncode == 0,
                        "returncode": completed.returncode,
                        "stdout": (completed.stdout or "")[:200],
                        "stderr": (completed.stderr or "")[:200],
                    }
                except Exception as exc:
                    result["tests"][name] = {
                        "ok": False,
                        "error": f"{type(exc).__name__}: {exc}",
                    }
            try:
                from drsai.modules.agents.skills_agent.managers.operater_funs import (
                    _run_via_wmi_file_capture,
                )

                code, out, err = _run_via_wmi_file_capture(
                    ps, ["-NoProfile", "-Command", "echo wmi-ok"], cwd=None, timeout=20,
                )
                result["tests"]["powershell_wmi"] = {
                    "ok": code == 0 and "wmi-ok" in out,
                    "returncode": code,
                    "stdout": out[:200],
                    "stderr": err[:200],
                }
            except Exception as exc:
                result["tests"]["powershell_wmi"] = {
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            probe_path.parent.mkdir(parents=True, exist_ok=True)
            probe_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            return result

        try:
            probe = await asyncio.to_thread(_probe)
            logger.info(
                "subprocess selftest written to logs/subprocess-selftest.json tests={}",
                probe.get("tests"),
            )
        except Exception as exc:
            logger.warning("subprocess selftest skipped: {}: {}", type(exc).__name__, exc)

    selftest_task = asyncio.create_task(_run_subprocess_selftest())

    yield
    selftest_task.cancel()
    try:
        await selftest_task
    except asyncio.CancelledError:
        pass
    service = _state.agent_service()
    for backend in service.backends.values():
        await backend.close()
    await _state.agent_manager().close()


def create_app() -> FastAPI:
    """Build the Desktop Runtime app."""
    app = FastAPI(
        title="OpenDrSai Desktop Runtime",
        version="2.0.0",
        lifespan=lifespan,
    )
    _auth.install(app)
    for factory in ROUTERS:
        app.include_router(factory())
    register_skills_routes(app)
    return app


app = create_app()


def main() -> None:
    """Run the Desktop Runtime gateway under uvicorn."""
    import uvicorn

    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT)


if __name__ == "__main__":
    main()
