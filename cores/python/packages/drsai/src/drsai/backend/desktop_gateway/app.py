"""The FastAPI application: config + runtime + audio + models + runs + sessions + workspaces + gfs + skills + channels.

This is a **separate app** from ``gateway_legacy``'s, deliberately. Mounting
these routers onto the legacy ``app`` would inherit its middleware stack and
break the three frozen route-order/OpenAPI snapshots that hold the legacy
surface still while it is retired. The two apps share the Runtime beneath them,
not the HTTP layer above it.

The ``config`` router provides V1-compatible ``/v1/config/*`` routes that the
Electron renderer calls during startup and for settings management.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import _auth, _state

from .routes import (
    agent_backends,
    audio,
    capabilities,
    channels_wechat,
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
    remote_workers,
    sessions,
    skills,
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
    remote_workers.router,
    identity.router,
    gfs.router,
    skills_square.router,
    channels_wechat.router,
    # Last on purpose: these routes used to be attached after every router by
    # ``register_skills_routes(app)``, so keeping the factory here holds the
    # app's route-declaration order (and the frozen OpenAPI snapshot) still.
    skills.router,
)

#: Uvicorn's access records carry their arguments positionally, in this order
#: (``uvicorn/protocols/http/httptools_impl.py`` and ``h11_impl.py``):
#: ``(client_addr, method, full_path, http_version, status_code)``.
_ACCESS_LOG_PATH_ARG_INDEX = 2

#: Escape hatch: set to a truthy value to keep ``/health`` in the access log.
_ACCESS_LOG_HEALTH_ENV = "OPENDRSAI_GATEWAY_ACCESS_LOG_HEALTH"


class _SuppressHealthAccessLog(logging.Filter):
    """Drop the ``/health`` probe from uvicorn's access log.

    The Desktop shell probes ``/health`` for the entire session (every couple of
    seconds) to observe Runtime readiness, so under uvicorn's default access log
    that single route dominated ``logs/gateway.log`` (~83% of its lines).

    Dropping the lines costs nothing: uvicorn runs ``lifespan.startup()``
    *before* it creates the listening socket (``uvicorn/server.py``), so while
    the Runtime is still starting no ``/health`` request can be served and no
    access line can exist.  Every line removed here was written *after* the
    Gateway was already answering, and the renderer learns readiness from its
    own probe result, never from this log.

    Only ``/health`` is dropped; other routes keep their access lines.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple) or len(args) <= _ACCESS_LOG_PATH_ARG_INDEX:
            return True
        # The probe is unauthenticated and has no query string, but tolerate one.
        path = str(args[_ACCESS_LOG_PATH_ARG_INDEX]).partition("?")[0]
        return path != "/health"


def suppress_health_access_logging() -> None:
    """Silence ``/health`` in the ``uvicorn.access`` logger (idempotent).

    A logger-level filter survives uvicorn's own ``logging.config.dictConfig``,
    which only reinstalls handlers, so this can be applied at import time and
    still hold once the server configures logging.
    """

    if os.environ.get(_ACCESS_LOG_HEALTH_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
        return
    access_logger = logging.getLogger("uvicorn.access")
    if any(isinstance(installed, _SuppressHealthAccessLog) for installed in access_logger.filters):
        return
    access_logger.addFilter(_SuppressHealthAccessLog())


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
            "Desktop Runtime configuration bootstrap failed: %s", type(exc).__name__,
        )
        # Configuration is a hard dependency for every authenticated route.
        # Advertising a healthy Gateway here leaves the renderer polling
        # endpoints that can only return 500 and looks like an endless startup.
        raise RuntimeError("Desktop Runtime configuration bootstrap failed") from exc

    # Re-arm the WeChat channel only when the user left it enabled.  A channel
    # that cannot be restored must never keep the gateway from becoming ready.
    try:
        await channels_wechat.restore()
    except Exception as exc:
        logger.warning("WeChat channel restore skipped: %s", type(exc).__name__)

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

    # At startup the gateway is running no turns, so any thread still marked
    # ACTIVE in the shared drsai.db is a residue from the previous process
    # (crash, force-kill, or a turn abandoned by an old lock bug). Reset them
    # so no session view claims a turn is still running.
    try:
        await asyncio.to_thread(_state.agent_manager().reset_stale_active_threads)
        logger.info("Startup: residual active thread statuses reset")
    except Exception as exc:
        logger.warning("Startup: residual active thread reset skipped: %s", type(exc).__name__)

    # Cancel detached runs whose session has no live SSE subscriber anymore
    # (desktop closed / renderer crashed mid-turn). Bounded by the grace env.
    from .routes import runs as _runs_routes

    orphan_reaper_task = _runs_routes.start_orphan_reaper()

    yield
    orphan_reaper_task.cancel()
    try:
        await orphan_reaper_task
    except asyncio.CancelledError:
        pass
    selftest_task.cancel()
    try:
        await selftest_task
    except asyncio.CancelledError:
        pass
    # Stop the channel before the Agent backends it drives are closed.  The
    # persisted enabled flag is left untouched, so a restart resumes it.
    try:
        await channels_wechat.shutdown()
    except Exception as exc:
        logger.warning("WeChat channel shutdown failed: %s", type(exc).__name__)
    service = _state.agent_service()
    for backend in service.backends.values():
        await backend.close()
    await _state.agent_manager().close()
    await asyncio.to_thread(_state.runtime_engine().close)


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
    return app


app = create_app()

# Applied at import time so every launch path is covered, including the
# hot-reload one (``uvicorn drsai.backend.desktop_gateway.app:app --reload``,
# see ``apps/desktop/shared/main/gateway.ts``) which imports this module and
# never calls ``main()``.
suppress_health_access_logging()


def main() -> None:
    """Run the Desktop Runtime gateway under uvicorn."""
    import uvicorn

    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT)


if __name__ == "__main__":
    main()
